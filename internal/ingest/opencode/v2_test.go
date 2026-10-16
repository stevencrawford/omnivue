package opencode_test

import (
	"context"
	"database/sql"
	"encoding/json"
	"path/filepath"
	"strings"
	"testing"

	"github.com/stevencrawford/omnivue/internal/ingest"
	"github.com/stevencrawford/omnivue/internal/ingest/opencode"
)

// newV2Fixture creates a temp OpenCode database with the v2 schema (session_v2
// + session_message) and returns its directory plus an open handle for the test
// to seed rows. The caller must close the handle before opening the adapter.
func newV2Fixture(t *testing.T) (string, *sql.DB) {
	t.Helper()
	dir := t.TempDir()
	db, err := sql.Open("sqlite", filepath.Join(dir, "opencode.db"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`
		CREATE TABLE project (id text PRIMARY KEY, name text, worktree text);
		CREATE TABLE session_v2 (
			id text PRIMARY KEY,
			project_id text NOT NULL,
			parent_id text,
			slug text NOT NULL,
			directory text NOT NULL,
			title text,
			version text NOT NULL,
			agent text,
			model text,
			cost real DEFAULT 0 NOT NULL,
			tokens_input integer DEFAULT 0 NOT NULL,
			tokens_output integer DEFAULT 0 NOT NULL,
			tokens_reasoning integer DEFAULT 0 NOT NULL,
			tokens_cache_read integer DEFAULT 0 NOT NULL,
			tokens_cache_write integer DEFAULT 0 NOT NULL,
			summary_files integer,
			summary_additions integer,
			summary_deletions integer,
			time_created integer NOT NULL,
			time_updated integer NOT NULL
		);
		CREATE TABLE session_message (
			id text PRIMARY KEY,
			session_id text NOT NULL,
			type text NOT NULL,
			seq integer NOT NULL,
			time_created integer NOT NULL,
			time_updated integer NOT NULL,
			data text NOT NULL
		);
	`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`PRAGMA journal_mode = WAL`); err != nil {
		t.Fatal(err)
	}
	return dir, db
}

func execFixture(t *testing.T, db *sql.DB, query string, args ...any) {
	t.Helper()
	if _, err := db.Exec(query, args...); err != nil {
		t.Fatal(err)
	}
}

func TestListSessions_V2(t *testing.T) {
	dir, db := newV2Fixture(t)
	execFixture(t, db, `INSERT INTO project (id, name) VALUES ('p1', 'omnivue')`)
	execFixture(t, db, `INSERT INTO session_v2
		(id, project_id, slug, directory, title, version, agent, model,
		 cost, tokens_input, tokens_output, tokens_reasoning, tokens_cache_read, tokens_cache_write,
		 time_created, time_updated)
		VALUES ('ses_a', 'p1', 'slug-a', '/proj', 'Alpha', '2.0.31', 'build',
			'{"id":"m1","providerID":"openai"}', 0.5, 10, 20, 5, 3, 1, 1000, 2000)`)
	// Nullable title: v2 allows an empty title, so it must fall back to the slug.
	execFixture(t, db, `INSERT INTO session_v2
		(id, project_id, slug, directory, title, version, time_created, time_updated)
		VALUES ('ses_b', 'p1', 'slug-b', '/proj', NULL, '2.0.31', 900, 950)`)
	execFixture(t, db, `INSERT INTO session_message (id, session_id, type, seq, time_created, time_updated, data)
		VALUES ('m1', 'ses_a', 'user', 1, 1500, 1500, '{"text":"hi"}')`)
	execFixture(t, db, `INSERT INTO session_message (id, session_id, type, seq, time_created, time_updated, data)
		VALUES ('m2', 'ses_a', 'assistant', 2, 1600, 1600, '{"content":[{"type":"text","text":"done"}],"time":{"created":1600,"completed":1650}}')`)
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}

	adapter, err := opencode.New(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer adapter.Close()

	sessions, err := adapter.ListSessions(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if len(sessions) != 2 {
		t.Fatalf("expected 2 sessions, got %d", len(sessions))
	}
	// Ordered by time_updated DESC: ses_a (2000) before ses_b (950).
	byID := map[string]ingest.Session{}
	for _, s := range sessions {
		byID[s.ID] = s
	}
	a := byID["ses_a"]
	if a.Title != "Alpha" {
		t.Errorf("ses_a title = %q, want Alpha", a.Title)
	}
	if a.Model != "m1" {
		t.Errorf("ses_a model = %q, want m1", a.Model)
	}
	if a.Repository != "omnivue" {
		t.Errorf("ses_a repository = %q, want omnivue", a.Repository)
	}
	if a.MessageCount != 2 {
		t.Errorf("ses_a message count = %d, want 2", a.MessageCount)
	}
	if a.TokensInput != 10 || a.TokensOutput != 20 || a.TokensCacheRead != 3 {
		t.Errorf("ses_a tokens = %d/%d/%d, want 10/20/3", a.TokensInput, a.TokensOutput, a.TokensCacheRead)
	}
	if got := byID["ses_b"].Title; got != "slug-b" {
		t.Errorf("ses_b title = %q, want slug-b fallback", got)
	}
}

func TestListSessions_V2_OpenStepMarksInProgress(t *testing.T) {
	dir, db := newV2Fixture(t)
	execFixture(t, db, `INSERT INTO project (id, name) VALUES ('p1', 'repo')`)
	for _, id := range []string{"ses_open", "ses_closed"} {
		execFixture(t, db, `INSERT INTO session_v2 (id, project_id, slug, directory, title, version, time_created, time_updated)
			VALUES (?, 'p1', 's', '/proj', 't', '2.0.31', 1000, 1000)`, id)
	}
	// Open: the newest assistant turn has no time.completed (model mid-think).
	execFixture(t, db, `INSERT INTO session_message (id, session_id, type, seq, time_created, time_updated, data)
		VALUES ('o1', 'ses_open', 'assistant', 1, 1000, 1000, '{"content":[],"time":{"created":1000}}')`)
	// Closed: the newest assistant turn finished.
	execFixture(t, db, `INSERT INTO session_message (id, session_id, type, seq, time_created, time_updated, data)
		VALUES ('c1', 'ses_closed', 'assistant', 1, 1000, 1000, '{"content":[],"time":{"created":1000,"completed":1100}}')`)
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}

	adapter, err := opencode.New(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer adapter.Close()

	sessions, err := adapter.ListSessions(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	byID := map[string]ingest.Session{}
	for _, s := range sessions {
		byID[s.ID] = s
	}
	if !byID["ses_open"].InProgress {
		t.Error("ses_open: expected InProgress=true (assistant turn not completed)")
	}
	if byID["ses_closed"].InProgress {
		t.Error("ses_closed: expected InProgress=false (assistant turn completed)")
	}
}

func TestMessages_V2(t *testing.T) {
	dir, db := newV2Fixture(t)
	execFixture(t, db, `INSERT INTO project (id, name) VALUES ('p1', 'repo')`)
	execFixture(t, db, `INSERT INTO session_v2 (id, project_id, slug, directory, title, version, time_created, time_updated)
		VALUES ('ses_a', 'p1', 's', '/proj', 't', '2.0.31', 1000, 2000)`)
	insert := func(id, kind string, seq int, data string) {
		execFixture(t, db, `INSERT INTO session_message (id, session_id, type, seq, time_created, time_updated, data)
			VALUES (?, 'ses_a', ?, ?, ?, ?, ?)`, id, kind, seq, 1000+seq, 1000+seq, data)
	}
	insert("m1", "synthetic", 1, `{"text":"<system-reminder>noise</system-reminder>"}`)
	insert("m2", "user", 2, `{"text":"hello there"}`)
	insert("m3", "assistant", 3, `{
		"agent":"build",
		"model":{"id":"m1","providerID":"openai"},
		"content":[
			{"type":"reasoning","text":"thinking","time":{"created":1200,"completed":1300}},
			{"type":"text","text":"here you go"},
			{"type":"tool","id":"call_1","name":"edit","state":{
				"status":"completed",
				"input":{"filePath":"/a.go","oldString":"x","newString":"y\nz"},
				"content":[{"type":"text","text":"ok"}],
				"metadata":{"truncated":false}
			},"time":{"created":1310,"completed":1320}}
		],
		"cost":0.01,
		"tokens":{"input":10,"output":20,"reasoning":5,"cache":{"read":3,"write":1}},
		"finish":"tool-calls"
	}`)
	insert("m4", "system", 4, `{"text":"system note"}`)
	insert("m5", "compaction", 5, `{"status":"completed","reason":"auto","summary":"## Summary\ncompacted"}`)
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}

	adapter, err := opencode.New(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer adapter.Close()

	messages, err := adapter.Messages(context.Background(), "ses_a")
	if err != nil {
		t.Fatal(err)
	}

	// synthetic is skipped; user, assistant, system, and a surfaced compaction remain.
	if len(messages) != 4 {
		t.Fatalf("expected 4 messages, got %d: %+v", len(messages), roles(messages))
	}
	if messages[0].Role != ingest.MessageRoleUser || messages[0].Content != "hello there" {
		t.Errorf("user message = %+v", messages[0])
	}

	assistant := messages[1]
	if assistant.Role != ingest.MessageRoleAssistant {
		t.Fatalf("expected assistant, got %s", assistant.Role)
	}
	if assistant.Content != "here you go" {
		t.Errorf("assistant content = %q", assistant.Content)
	}
	if assistant.Reasoning != "thinking" {
		t.Errorf("assistant reasoning = %q", assistant.Reasoning)
	}
	if assistant.Model != "m1" || assistant.Agent != "build" {
		t.Errorf("assistant model/agent = %q/%q", assistant.Model, assistant.Agent)
	}
	if len(assistant.ToolCalls) != 1 {
		t.Fatalf("assistant tool calls = %d, want 1", len(assistant.ToolCalls))
	}
	tc := assistant.ToolCalls[0]
	if tc.Name != "edit" || tc.ID != "call_1" {
		t.Errorf("tool call = %+v", tc)
	}
	if tc.Output != "ok" {
		t.Errorf("tool output = %q, want ok", tc.Output)
	}
	if tc.Duration != 10 {
		t.Errorf("tool duration = %d, want 10", tc.Duration)
	}
	if tc.Usage == nil || tc.Usage.Cost != 0.01 || tc.Usage.Tokens.Input != 10 {
		t.Errorf("tool usage = %+v", tc.Usage)
	}

	if len(assistant.StepEvents) != 1 {
		t.Fatalf("assistant step events = %d, want 1", len(assistant.StepEvents))
	}
	se := assistant.StepEvents[0]
	if se.Step != ingest.StepEventFinish || se.Cost != 0.01 {
		t.Errorf("step event = %+v", se)
	}
	if se.Tokens.Input != 10 || se.Tokens.CacheRead != 3 || se.Tokens.CacheWrite != 1 {
		t.Errorf("step tokens = %+v", se.Tokens)
	}

	if messages[2].Role != ingest.MessageRoleSystem || messages[2].Content != "system note" {
		t.Errorf("system message = %+v", messages[2])
	}
	comp := messages[3]
	if len(comp.ToolCalls) != 1 || comp.ToolCalls[0].Name != "compaction" {
		t.Errorf("compaction message = %+v", comp)
	}
	if comp.ToolCalls[0].Output != "## Summary\ncompacted" {
		t.Errorf("compaction output = %q", comp.ToolCalls[0].Output)
	}
}

func TestEdits_DiffMetrics_V2(t *testing.T) {
	dir, db := newV2Fixture(t)
	execFixture(t, db, `INSERT INTO project (id, name) VALUES ('p1', 'repo')`)
	execFixture(t, db, `INSERT INTO session_v2 (id, project_id, slug, directory, title, version, time_created, time_updated)
		VALUES ('ses_a', 'p1', 's', '/proj', 't', '2.0.31', 1000, 2000)`)
	execFixture(t, db, `INSERT INTO session_message (id, session_id, type, seq, time_created, time_updated, data)
		VALUES ('m1', 'ses_a', 'assistant', 1, 1100, 1100, ?)`, `{"content":[{"type":"tool","id":"call_1","name":"edit","state":{"status":"completed","input":{"filePath":"/a.go","oldString":"x","newString":"y\nz"},"content":[{"type":"text","text":"ok"}]}}],"time":{"created":1100,"completed":1150}}`)
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}

	adapter, err := opencode.New(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer adapter.Close()

	edits, err := adapter.Edits(context.Background(), "ses_a")
	if err != nil {
		t.Fatal(err)
	}
	if len(edits) != 1 {
		t.Fatalf("expected 1 edit, got %d", len(edits))
	}
	if edits[0].FilePath != "/a.go" || edits[0].ToolName != "edit" {
		t.Errorf("edit = %+v", edits[0])
	}
	if edits[0].NewStr != "y\nz" || edits[0].OldStr != "x" {
		t.Errorf("edit strings = %q / %q", edits[0].OldStr, edits[0].NewStr)
	}

	sessions, err := adapter.ListSessions(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if len(sessions) != 1 {
		t.Fatalf("expected 1 session, got %d", len(sessions))
	}
	s := sessions[0]
	if s.DiffFiles != 1 || s.DiffAdditions != 2 || s.DiffDeletions != 1 {
		t.Errorf("diff metrics = files %d, +%d, -%d; want 1, +2, -1", s.DiffFiles, s.DiffAdditions, s.DiffDeletions)
	}
}

func TestPlan_V2(t *testing.T) {
	dir, db := newV2Fixture(t)
	execFixture(t, db, `INSERT INTO project (id, name) VALUES ('p1', 'repo')`)
	execFixture(t, db, `INSERT INTO session_v2 (id, project_id, slug, directory, title, version, agent, time_created, time_updated)
		VALUES ('ses_plan', 'p1', 's', '/proj', 't', '2.0.31', 'plan', 1000, 2000)`)
	long := "## Objective\n\n" + strings.Repeat("Detailed plan step. ", 20)
	execFixture(t, db, `INSERT INTO session_message (id, session_id, type, seq, time_created, time_updated, data)
		VALUES ('m1', 'ses_plan', 'assistant', 1, 1100, 1100, ?)`,
		`{"content":[{"type":"text","text":`+jsonString(t, long)+`}],"time":{"created":1100,"completed":1150}}`)
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}

	adapter, err := opencode.New(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer adapter.Close()

	plan, err := adapter.Plan(context.Background(), "ses_plan")
	if err != nil {
		t.Fatal(err)
	}
	if plan == nil {
		t.Fatal("expected a plan, got nil")
		return
	}
	if !strings.Contains(plan.Markdown, "## Objective") {
		t.Errorf("plan markdown missing objective: %q", plan.Markdown)
	}
}

func TestLastModified_V2(t *testing.T) {
	dir, db := newV2Fixture(t)
	execFixture(t, db, `INSERT INTO project (id, name) VALUES ('p1', 'repo')`)
	execFixture(t, db, `INSERT INTO session_v2 (id, project_id, slug, directory, title, version, time_created, time_updated)
		VALUES ('ses_a', 'p1', 's', '/proj', 't', '2.0.31', 1000, 1000)`)
	// The message's time_updated is newer than the session and must drive the
	// change-detection signal, mirroring the v1 part-update contract.
	execFixture(t, db, `INSERT INTO session_message (id, session_id, type, seq, time_created, time_updated, data)
		VALUES ('m1', 'ses_a', 'assistant', 1, 1000, 5000, '{"content":[{"type":"text","text":"x"}]}')`)
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}

	adapter, err := opencode.New(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer adapter.Close()

	ts, err := adapter.LastModified(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if ts != 5000 {
		t.Errorf("LastModified() = %d, want 5000", ts)
	}

	sessions, err := adapter.ListSessions(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if got := sessions[0].UpdatedAt.UnixMilli(); got != 5000 {
		t.Errorf("UpdatedAt = %d, want 5000", got)
	}
}

func roles(messages []ingest.Message) []string {
	out := make([]string, len(messages))
	for i, m := range messages {
		out[i] = string(m.Role)
	}
	return out
}

func jsonString(t *testing.T, s string) string {
	t.Helper()
	b, err := json.Marshal(s)
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}
