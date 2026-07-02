package claudecode

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/stevencrawford/omnivue/internal/ingest"
)

func TestAdapter_WithRealSessions(t *testing.T) {
	basePath := os.ExpandEnv("$HOME/.claude")
	if _, err := os.Stat(basePath); os.IsNotExist(err) {
		t.Skip("Claude Code directory not found")
	}

	a, err := New(basePath)
	if err != nil {
		t.Fatal(err)
	}
	defer a.Close()

	ctx := context.Background()

	if !a.Detect(basePath) {
		t.Fatal("Detect() returned false on expected directory")
	}

	sessions, err := a.ListSessions(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(sessions) < 1 {
		t.Fatal("expected at least one session")
	}

	var parentIDs []string
	for _, s := range sessions {
		t.Logf("Session: ID=%s Title=%s Model=%s Messages=%d Agent=%s ParentID=%s SubAgent=%s Cost=%.4f Branch=%s",
			s.ID, s.Title, s.Model, s.MessageCount, s.Agent, s.ParentID, s.SubAgent, s.Cost, s.Branch)

		if s.ID == "" {
			t.Error("expected non-empty session ID")
		}
		if s.Agent != "claude-code" {
			t.Errorf("expected agent claude-code, got %s", s.Agent)
		}

		if s.ParentID == "" {
			parentIDs = append(parentIDs, s.ID)
		}

		got, err := a.Session(ctx, s.ID)
		if err != nil {
			t.Fatal(err)
		}
		if got.ID != s.ID {
			t.Errorf("Session returned wrong ID: %s != %s", got.ID, s.ID)
		}

		msgs, err := a.Messages(ctx, s.ID)
		if err != nil {
			t.Fatal(err)
		}
		if len(msgs) < 1 && s.MessageCount > 0 {
			t.Logf("session %s: expected messages but got 0 (MessageCount=%d)", s.ID, s.MessageCount)
		}

		for _, m := range msgs {
			switch m.Role {
			case "user":
				if m.Content == "" && len(m.ToolCalls) == 0 {
					t.Log("user message with empty content and no tool calls")
				}
			case "assistant":
				if len(m.ToolCalls) > 0 {
					for _, tc := range m.ToolCalls {
						if tc.ID == "" {
							t.Error("tool call has empty ID")
						}
						t.Logf("  tool call: name=%s id=%s has_input=%v has_output=%d status=%s",
							tc.Name, tc.ID, tc.Input != "", len(tc.Output), tc.Status)
					}
				}
				if m.Reasoning != "" {
					t.Logf("  reasoning: %d chars", len(m.Reasoning))
				}
			}
		}

		edits, err := a.Edits(ctx, s.ID)
		if err != nil {
			t.Fatal(err)
		}
		for _, e := range edits {
			t.Logf("  edit: file=%s tool=%s newStr_len=%d", e.FilePath, e.ToolName, len(e.NewStr))
		}

		plan, err := a.Plan(ctx, s.ID)
		if err != nil {
			t.Fatal(err)
		}
		if plan != nil {
			t.Logf("  plan: source=%s len=%d", plan.Source, len(plan.Markdown))
		}

		diffs, err := a.Diffs(ctx, s.ID)
		if err != nil {
			t.Fatal(err)
		}
		if len(diffs) > 0 {
			t.Logf("  diffs: %d files", len(diffs))
		}
	}

	for _, pid := range parentIDs {
		children := 0
		for _, s := range sessions {
			if s.ParentID == pid {
				children++
			}
		}
		if children > 0 {
			t.Logf("parent session %s has %d subagents", pid, children)
		}
	}

	lm, err := a.LastModified(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if lm == 0 {
		t.Error("expected non-zero last modified")
	}

	for _, s := range sessions {
		cmd := a.ResumeCommand(&s)
		if !strings.Contains(cmd, "claude") {
			t.Errorf("unexpected resume command: %s", cmd)
		}
	}
}

func TestDetect(t *testing.T) {
	tests := []struct {
		name     string
		setup    func(t *testing.T, dir string)
		want     bool
	}{
		{
			name: "no projects directory",
			setup: func(t *testing.T, dir string) {
			},
			want: false,
		},
		{
			name: "projects directory with no sessions",
			setup: func(t *testing.T, dir string) {
				if err := os.MkdirAll(filepath.Join(dir, "projects", "encoded-dir"), 0755); err != nil {
					t.Fatal(err)
				}
			},
			want: false,
		},
		{
			name: "projects directory with session file",
			setup: func(t *testing.T, dir string) {
				projectDir := filepath.Join(dir, "projects", "encoded-dir")
				if err := os.MkdirAll(projectDir, 0755); err != nil {
					t.Fatal(err)
				}
				writeJSONL(t, filepath.Join(projectDir, "session-123.jsonl"), []json.RawMessage{})
			},
			want: true,
		},
		{
			name: "projects directory with sessions in project root",
			setup: func(t *testing.T, dir string) {
				if err := os.MkdirAll(filepath.Join(dir, "projects", "encoded-dir"), 0755); err != nil {
					t.Fatal(err)
				}
				writeJSONL(t, filepath.Join(dir, "projects", "encoded-dir", "session-123.jsonl"), []json.RawMessage{})
			},
			want: true,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			dir := t.TempDir()
			tc.setup(t, dir)
			a, err := New(dir)
			if err != nil {
				t.Fatal(err)
			}
			defer a.Close()

			got := a.Detect(dir)
			if got != tc.want {
				t.Errorf("Detect() = %v, want %v", got, tc.want)
			}
		})
	}
}

func TestSessionParsing(t *testing.T) {
	now := time.Now().UTC().Format(time.RFC3339)
	lines := []json.RawMessage{
		json.RawMessage(`{"type":"user","sessionId":"sess-001","slug":"fix-auth-bug","cwd":"/home/user/project","gitBranch":"main","timestamp":"` + now + `","message":{"role":"user","content":"hello"}}`),
		json.RawMessage(`{"type":"assistant","sessionId":"sess-001","slug":"fix-auth-bug","cwd":"/home/user/project","gitBranch":"main","timestamp":"` + now + `","message":{"role":"assistant","content":"Let me fix that","model":"anthropic/claude-sonnet-4-5-20250929","usage":{"input_tokens":50,"output_tokens":100,"cache_creation_input_tokens":10,"cache_read_input_tokens":5}}}`),
		json.RawMessage(`{"type":"user","sessionId":"sess-001","timestamp":"` + now + `","message":{"role":"user","content":"thanks"}}`),
	}

	a := setupAdapter(t, "test-proj", "sess-001.jsonl", lines)
	ctx := context.Background()

	sessions, err := a.ListSessions(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(sessions) != 1 {
		t.Fatalf("expected 1 session, got %d", len(sessions))
	}

	s := sessions[0]
	if s.ID != "sess-001" {
		t.Errorf("ID = %q, want %q", s.ID, "sess-001")
	}
	if s.Title != "fix-auth-bug" {
		t.Errorf("Title = %q, want %q", s.Title, "fix-auth-bug")
	}
	if s.Directory != "/home/user/project" {
		t.Errorf("Directory = %q, want %q", s.Directory, "/home/user/project")
	}
	if s.Branch != "main" {
		t.Errorf("Branch = %q, want %q", s.Branch, "main")
	}
	if s.Model != "claude-sonnet-4-5-20250929" {
		t.Errorf("Model = %q, want %q", s.Model, "claude-sonnet-4-5-20250929")
	}
	if s.TokensInput != 50 {
		t.Errorf("TokensInput = %d, want 50", s.TokensInput)
	}
	if s.TokensOutput != 100 {
		t.Errorf("TokensOutput = %d, want 100", s.TokensOutput)
	}
	if s.TokensCacheRead != 5 {
		t.Errorf("TokensCacheRead = %d, want 5", s.TokensCacheRead)
	}
	if s.TokensCacheWrite != 10 {
		t.Errorf("TokensCacheWrite = %d, want 10", s.TokensCacheWrite)
	}
	if s.MessageCount != 3 {
		t.Errorf("MessageCount = %d, want 3", s.MessageCount)
	}
	if s.Agent != ingest.AgentClaudeCode {
		t.Errorf("Agent = %q, want %q", s.Agent, ingest.AgentClaudeCode)
	}
	if s.Cost <= 0 {
		t.Error("Cost should be > 0")
	}
}

func TestSessionParsing_NoSlug(t *testing.T) {
	now := time.Now().UTC().Format(time.RFC3339)
	lines := []json.RawMessage{
		json.RawMessage(`{"type":"user","sessionId":"sess-002","timestamp":"` + now + `","message":{"role":"user","content":"hello"}}`),
	}

	a := setupAdapter(t, "test-proj", "sess-002.jsonl", lines)
	ctx := context.Background()

	sessions, err := a.ListSessions(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(sessions) != 1 {
		t.Fatalf("expected 1 session, got %d", len(sessions))
	}
	if sessions[0].Title != "sess-002" {
		t.Errorf("Title = %q, want %q", sessions[0].Title, "sess-002")
	}
}

func TestMessageParsing_Basic(t *testing.T) {
	now := time.Now().UTC().Format(time.RFC3339)
	lines := []json.RawMessage{
		json.RawMessage(`{"type":"user","uuid":"u1","timestamp":"` + now + `","message":{"role":"user","content":"Hello"}}`),
		json.RawMessage(`{"type":"assistant","uuid":"a1","timestamp":"` + now + `","message":{"role":"assistant","content":[{"type":"text","text":"Hi there"}]}}`),
		json.RawMessage(`{"type":"user","uuid":"u2","timestamp":"` + now + `","message":{"role":"user","content":"Fix this bug"}}`),
	}

	a := setupAdapter(t, "proj", "sid-1.jsonl", lines)
	ctx := context.Background()

	msgs, err := a.Messages(ctx, "sid-1")
	if err != nil {
		t.Fatal(err)
	}
	if len(msgs) != 3 {
		t.Fatalf("expected 3 messages, got %d", len(msgs))
	}

	if msgs[0].Role != "user" || msgs[0].Content != "Hello" {
		t.Errorf("msg[0] role=%q content=%q", msgs[0].Role, msgs[0].Content)
	}
	if msgs[1].Role != "assistant" || msgs[1].Content != "Hi there" {
		t.Errorf("msg[1] role=%q content=%q", msgs[1].Role, msgs[1].Content)
	}
	if msgs[2].Role != "user" || msgs[2].Content != "Fix this bug" {
		t.Errorf("msg[2] role=%q content=%q", msgs[2].Role, msgs[2].Content)
	}
}

func TestMessageParsing_Thinking(t *testing.T) {
	now := time.Now().UTC().Format(time.RFC3339)
	lines := []json.RawMessage{
		json.RawMessage(`{"type":"assistant","uuid":"a1","timestamp":"` + now + `","message":{"role":"assistant","content":[{"type":"thinking","thinking":"I should use binary search"},{"type":"text","text":"Let me solve this"}]}}`),
	}

	a := setupAdapter(t, "proj", "sid-2.jsonl", lines)
	ctx := context.Background()

	msgs, err := a.Messages(ctx, "sid-2")
	if err != nil {
		t.Fatal(err)
	}
	if len(msgs) != 1 {
		t.Fatalf("expected 1 message, got %d", len(msgs))
	}

	if msgs[0].Content != "Let me solve this" {
		t.Errorf("Content = %q, want %q", msgs[0].Content, "Let me solve this")
	}
	if msgs[0].Reasoning != "I should use binary search" {
		t.Errorf("Reasoning = %q, want %q", msgs[0].Reasoning, "I should use binary search")
	}
}

func TestMessageParsing_ToolCalls(t *testing.T) {
	now := time.Now().UTC().Format(time.RFC3339)
	inputJSON := `{"file_path":"src/main.go","old_str":"foo","new_str":"bar"}`
	lines := []json.RawMessage{
		json.RawMessage(`{"type":"assistant","uuid":"a1","timestamp":"` + now + `","message":{"role":"assistant","content":[{"type":"text","text":"Let me edit that"},{"type":"tool_use","id":"tu1","name":"Edit","input":` + inputJSON + `}]}}`),
	}

	a := setupAdapter(t, "proj", "sid-3.jsonl", lines)
	ctx := context.Background()

	msgs, err := a.Messages(ctx, "sid-3")
	if err != nil {
		t.Fatal(err)
	}
	if len(msgs) != 1 {
		t.Fatalf("expected 1 message, got %d", len(msgs))
	}

	if len(msgs[0].ToolCalls) != 1 {
		t.Fatalf("expected 1 tool call, got %d", len(msgs[0].ToolCalls))
	}

	tc := msgs[0].ToolCalls[0]
	if tc.ID != "tu1" {
		t.Errorf("ToolCall ID = %q, want %q", tc.ID, "tu1")
	}
	if tc.Name != "edit" {
		t.Errorf("ToolCall Name = %q, want %q (normalized)", tc.Name, "edit")
	}
	if tc.Input != inputJSON {
		t.Errorf("ToolCall Input = %q, want %q", tc.Input, inputJSON)
	}
	if tc.Status != "running" {
		t.Errorf("ToolCall Status = %q, want %q", tc.Status, "running")
	}
}

func TestToolResultMatching(t *testing.T) {
	now := time.Now().UTC().Format(time.RFC3339)
	lines := []json.RawMessage{
		json.RawMessage(`{"type":"assistant","uuid":"a1","timestamp":"` + now + `","message":{"role":"assistant","content":[{"type":"tool_use","id":"tu1","name":"Read","input":"{}"}]}}`),
		json.RawMessage(`{"type":"tool_result","tool_use_id":"tu1","content":"file contents here","timestamp":"` + now + `"}`),
	}

	a := setupAdapter(t, "proj", "sid-4.jsonl", lines)
	ctx := context.Background()

	msgs, err := a.Messages(ctx, "sid-4")
	if err != nil {
		t.Fatal(err)
	}
	if len(msgs) != 1 {
		t.Fatalf("expected 1 message (assistant with tool call), got %d", len(msgs))
	}

	if len(msgs[0].ToolCalls) != 1 {
		t.Fatalf("expected 1 tool call, got %d", len(msgs[0].ToolCalls))
	}

	tc := msgs[0].ToolCalls[0]
	if tc.Output != "file contents here" {
		t.Errorf("ToolCall Output = %q, want %q", tc.Output, "file contents here")
	}
	if tc.Status != "completed" {
		t.Errorf("ToolCall Status = %q, want %q", tc.Status, "completed")
	}
}

func TestToolResultWithError(t *testing.T) {
	now := time.Now().UTC().Format(time.RFC3339)
	lines := []json.RawMessage{
		json.RawMessage(`{"type":"assistant","uuid":"a1","timestamp":"` + now + `","message":{"role":"assistant","content":[{"type":"tool_use","id":"tu1","name":"Bash","input":"{}"}]}}`),
		json.RawMessage(`{"type":"tool_result","tool_use_id":"tu1","content":"command not found","is_error":true,"timestamp":"` + now + `"}`),
	}

	a := setupAdapter(t, "proj", "sid-5.jsonl", lines)
	ctx := context.Background()

	msgs, err := a.Messages(ctx, "sid-5")
	if err != nil {
		t.Fatal(err)
	}
	if len(msgs[0].ToolCalls) != 1 {
		t.Fatalf("expected 1 tool call, got %d", len(msgs[0].ToolCalls))
	}

	tc := msgs[0].ToolCalls[0]
	if tc.Status != "failed" {
		t.Errorf("ToolCall Status = %q, want %q", tc.Status, "failed")
	}
}

func TestToolNameNormalization(t *testing.T) {
	tests := []struct {
		input    string
		expected string
	}{
		{"Read", "read"},
		{"Write", "write"},
		{"Edit", "edit"},
		{"Bash", "bash"},
		{"Glob", "glob"},
		{"Grep", "grep"},
		{"Task", "task"},
		{"Delete", "delete"},
		{"WebFetch", "webfetch"},
		{"WebSearch", "websearch"},
		{"ExitPlanMode", "exit_plan_mode"},
		{"UnknownTool", "UnknownTool"},
		{"", ""},
	}

	for _, tc := range tests {
		call := &ingest.ToolCall{Name: tc.input}
		normalizeToolCall(call)
		if call.Name != tc.expected {
			t.Errorf("normalizeToolCall(%q) = %q, want %q", tc.input, call.Name, tc.expected)
		}
	}
}

func TestCostCalculation(t *testing.T) {
	tests := []struct {
		model                  string
		tokensIn, tokensOut    int
		cacheWrite, cacheRead  int
		want                   float64
	}{
		{"claude-sonnet-4-5-20250929", 1000, 500, 200, 100, 1000.0/1e6*3 + 500.0/1e6*15 + 200.0/1e6*3.75 + 100.0/1e6*0.30},
		{"claude-opus-4-5-20251101", 1000, 500, 200, 100, 1000.0/1e6*15 + 500.0/1e6*75 + 200.0/1e6*18.75 + 100.0/1e6*1.50},
		{"claude-haiku-4-5-20251001", 1000, 500, 200, 100, 1000.0/1e6*0.25 + 500.0/1e6*1.25 + 200.0/1e6*0.3125 + 100.0/1e6*0.025},
		{"unknown-model", 1000, 500, 0, 0, 0},
		{"", 1000, 500, 0, 0, 0},
	}

	for _, tc := range tests {
		got := calculateCost(tc.model, tc.tokensIn, tc.tokensOut, tc.cacheWrite, tc.cacheRead)
		diff := got - tc.want
		if diff < 0 {
			diff = -diff
		}
		if diff > 0.0001 {
			t.Errorf("calculateCost(%q, %d, %d, %d, %d) = %f, want %f",
				tc.model, tc.tokensIn, tc.tokensOut, tc.cacheWrite, tc.cacheRead, got, tc.want)
		}
	}
}

func TestCostCalculation_KnownModels(t *testing.T) {
	tests := []struct {
		model string
		want  float64
	}{
		{"claude-4-5-sonnet-20250929", 3.00},
		{"claude-sonnet-4-5-20250929", 3.00},
		{"claude-4-5-opus-20251101", 15.00},
		{"claude-opus-4-5-20251101", 15.00},
		{"claude-4-5-haiku-20251001", 0.25},
		{"claude-haiku-4-5-20251001", 0.25},
		{"claude-3-5-sonnet-20241022", 3.00},
		{"claude-3-5-haiku-20241022", 0.80},
		{"claude-3-opus-20240229", 15.00},
		{"claude-3-sonnet-20240229", 3.00},
		{"claude-3-haiku-20240307", 0.25},
	}

	for _, tc := range tests {
		got := calculateCost(tc.model, 1_000_000, 0, 0, 0)
		if got != tc.want {
			t.Errorf("calculateCost(%q, 1M input) = %f, want %f", tc.model, got, tc.want)
		}
	}
}

func TestEditExtraction(t *testing.T) {
	now := time.Now().UTC().Format(time.RFC3339)
	dir := t.TempDir()
	projDir := filepath.Join(dir, "projects", "proj")
	if err := os.MkdirAll(projDir, 0755); err != nil {
		t.Fatal(err)
	}

	writeInput := json.RawMessage(`{"file_path":"src/main.go","content":"package main\n\nfunc main() {\n\tprintln(\"hello\")\n}\n"}`)
	editInput := json.RawMessage(`{"file_path":"src/utils.go","old_str":"func old()","new_str":"func new()"}`)

	lines := []json.RawMessage{
		json.RawMessage(`{"type":"assistant","uuid":"a1","timestamp":"` + now + `","message":{"role":"assistant","content":[{"type":"text","text":"Writing file"},{"type":"tool_use","id":"tu1","name":"Write","input":` + string(writeInput) + `}]}}`),
		json.RawMessage(`{"type":"tool_result","tool_use_id":"tu1","content":"done","timestamp":"` + now + `"}`),
		json.RawMessage(`{"type":"assistant","uuid":"a2","timestamp":"` + now + `","message":{"role":"assistant","content":[{"type":"tool_use","id":"tu2","name":"Edit","input":` + string(editInput) + `}]}}`),
		json.RawMessage(`{"type":"tool_result","tool_use_id":"tu2","content":"done","timestamp":"` + now + `"}`),
	}

	writeJSONL(t, filepath.Join(projDir, "sid-6.jsonl"), lines)

	a, err := New(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer a.Close()

	ctx := context.Background()
	edits, err := a.Edits(ctx, "sid-6")
	if err != nil {
		t.Fatal(err)
	}
	if len(edits) != 2 {
		t.Fatalf("expected 2 edits, got %d", len(edits))
	}

	if edits[0].FilePath != "src/main.go" {
		t.Errorf("edits[0].FilePath = %q, want %q", edits[0].FilePath, "src/main.go")
	}
	if edits[0].ToolName != "write" {
		t.Errorf("edits[0].ToolName = %q, want %q", edits[0].ToolName, "write")
	}
	if edits[0].NewStr != "package main\n\nfunc main() {\n\tprintln(\"hello\")\n}\n" {
		t.Errorf("edits[0].NewStr = %q, want file content", edits[0].NewStr)
	}

	if edits[1].FilePath != "src/utils.go" {
		t.Errorf("edits[1].FilePath = %q, want %q", edits[1].FilePath, "src/utils.go")
	}
	if edits[1].ToolName != "edit" {
		t.Errorf("edits[1].ToolName = %q, want %q", edits[1].ToolName, "edit")
	}
	if edits[1].NewStr != "func new()" {
		t.Errorf("edits[1].NewStr = %q, want %q", edits[1].NewStr, "func new()")
	}
}

func TestSkipMetaMessages(t *testing.T) {
	now := time.Now().UTC().Format(time.RFC3339)
	lines := []json.RawMessage{
		json.RawMessage(`{"type":"file-history-snapshot","timestamp":"` + now + `"}`),
		json.RawMessage(`{"type":"progress","timestamp":"` + now + `"}`),
		json.RawMessage(`{"type":"system","timestamp":"` + now + `","subtype":"local_command"}`),
		json.RawMessage(`{"type":"queue-operation","timestamp":"` + now + `"}`),
		json.RawMessage(`{"type":"user","uuid":"u1","timestamp":"` + now + `","isMeta":true,"message":{"role":"user","content":"meta"}}`),
		json.RawMessage(`{"type":"user","uuid":"u2","timestamp":"` + now + `","message":{"role":"user","content":"real user message"}}`),
	}

	a := setupAdapter(t, "proj", "sid-7.jsonl", lines)
	ctx := context.Background()

	msgs, err := a.Messages(ctx, "sid-7")
	if err != nil {
		t.Fatal(err)
	}
	if len(msgs) != 1 {
		t.Fatalf("expected 1 message (skipping meta), got %d", len(msgs))
	}
	if msgs[0].Content != "real user message" {
		t.Errorf("Content = %q, want %q", msgs[0].Content, "real user message")
	}
}

func TestResumeCommand(t *testing.T) {
	a, err := New("/tmp/test")
	if err != nil {
		t.Fatal(err)
	}
	defer a.Close()

	s := &ingest.Session{
		ID:        "sess-001",
		Directory: "/home/user/project",
	}

	cmd := a.ResumeCommand(s)
	expected := `cd /home/user/project && claude -p /home/user/project -s sess-001`
	if cmd != expected {
		t.Errorf("ResumeCommand() = %q, want %q", cmd, expected)
	}
}

func TestSimplifyModelName(t *testing.T) {
	tests := []struct {
		input    string
		expected string
	}{
		{"anthropic/claude-sonnet-4-5-20250929", "claude-sonnet-4-5-20250929"},
		{"claude-sonnet-4-5-20250929", "claude-sonnet-4-5-20250929"},
		{"", ""},
	}

	for _, tc := range tests {
		got := simplifyModelName(tc.input)
		if got != tc.expected {
			t.Errorf("simplifyModelName(%q) = %q, want %q", tc.input, got, tc.expected)
		}
	}
}

func TestGetDiffsReturnsNil(t *testing.T) {
	a, err := New("/tmp/test")
	if err != nil {
		t.Fatal(err)
	}
	defer a.Close()

	diffs, err := a.Diffs(context.Background(), "any-id")
	if err != nil {
		t.Fatal(err)
	}
	if len(diffs) > 0 {
		t.Error("Diffs should return nil for Claude Code")
	}
}

func TestGetPlanNoFile(t *testing.T) {
	dir := t.TempDir()
	a, err := New(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer a.Close()

	plan, err := a.Plan(context.Background(), "nonexistent")
	if err != nil {
		t.Fatal(err)
	}
	if plan != nil {
		t.Error("Plan should return nil when no plan file exists")
	}
}

func TestContentTruncation(t *testing.T) {
	now := time.Now().UTC().Format(time.RFC3339)
	longContent := strings.Repeat("a", 5000)
	contentJSON, err := json.Marshal(longContent)
	if err != nil {
		t.Fatal(err)
	}

	lines := []json.RawMessage{
		json.RawMessage(`{"type":"assistant","uuid":"a1","timestamp":"` + now + `","message":{"role":"assistant","content":[{"type":"tool_use","id":"tu1","name":"Read","input":"{}"}]}}`),
		json.RawMessage(`{"type":"tool_result","tool_use_id":"tu1","content":` + string(contentJSON) + `,"timestamp":"` + now + `"}`),
	}

	a := setupAdapter(t, "proj", "sid-trunc.jsonl", lines)
	ctx := context.Background()

	msgs, err := a.Messages(ctx, "sid-trunc")
	if err != nil {
		t.Fatal(err)
	}
	if len(msgs) != 1 {
		t.Fatalf("expected 1 message, got %d", len(msgs))
	}
	if len(msgs[0].ToolCalls) != 1 {
		t.Fatalf("expected 1 tool call, got %d", len(msgs[0].ToolCalls))
	}

	output := msgs[0].ToolCalls[0].Output
	if len(output) >= 5000 {
		t.Errorf("ToolCall Output should be truncated, length = %d", len(output))
	}
	if !strings.HasSuffix(output, "(truncated)") {
		t.Errorf("ToolCall Output should end with truncation marker, got: %s", output)
	}
}

func TestUserContentExtraction(t *testing.T) {
	now := time.Now().UTC().Format(time.RFC3339)
	lines := []json.RawMessage{
		json.RawMessage(`{"type":"user","uuid":"u1","timestamp":"` + now + `","message":{"role":"user","content":"plain text"}}`),
		json.RawMessage(`{"type":"user","uuid":"u2","timestamp":"` + now + `","message":{"role":"user","content":[{"type":"text","text":"array text 1"},{"type":"text","text":"array text 2"}]}}`),
	}

	a := setupAdapter(t, "proj", "sid-8.jsonl", lines)
	ctx := context.Background()

	msgs, err := a.Messages(ctx, "sid-8")
	if err != nil {
		t.Fatal(err)
	}
	if len(msgs) != 2 {
		t.Fatalf("expected 2 messages, got %d", len(msgs))
	}

	if msgs[0].Content != "plain text" {
		t.Errorf("msg[0].Content = %q, want %q", msgs[0].Content, "plain text")
	}
	if msgs[1].Content != "array text 1\narray text 2" {
		t.Errorf("msg[1].Content = %q, want %q", msgs[1].Content, "array text 1\narray text 2")
	}
}

func TestGetSession_NotFound(t *testing.T) {
	dir := t.TempDir()
	if err := os.MkdirAll(filepath.Join(dir, "projects", "proj"), 0755); err != nil {
		t.Fatal(err)
	}

	a, err := New(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer a.Close()

	_, err = a.Session(context.Background(), "nonexistent-id")
	if err == nil {
		t.Error("expected error for nonexistent session")
	}
}

func TestLastModified_NoSessions(t *testing.T) {
	dir := t.TempDir()
	if err := os.MkdirAll(filepath.Join(dir, "projects", "proj"), 0755); err != nil {
		t.Fatal(err)
	}

	a, err := New(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer a.Close()

	lm, err := a.LastModified(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if lm == 0 {
		t.Error("expected non-zero LastModified even with no sessions")
	}
}

func TestSubagentSessionID(t *testing.T) {
	now := time.Now().UTC().Format(time.RFC3339)
	parentLines := []json.RawMessage{
		json.RawMessage(`{"type":"user","sessionId":"parent-1","slug":"main-session","timestamp":"` + now + `","message":{"role":"user","content":"hello"}}`),
		json.RawMessage(`{"type":"assistant","sessionId":"parent-1","timestamp":"` + now + `","message":{"role":"assistant","content":"hi","model":"claude-sonnet-4-5-20250929","usage":{"input_tokens":10,"output_tokens":20}}}`),
	}

	subLines := []json.RawMessage{
		json.RawMessage(`{"type":"user","sessionId":"parent-1","agentId":"sub-1","timestamp":"` + now + `","message":{"role":"user","content":"sub task"}}`),
		json.RawMessage(`{"type":"assistant","sessionId":"parent-1","agentId":"sub-1","timestamp":"` + now + `","message":{"role":"assistant","content":"sub done","model":"claude-sonnet-4-5-20250929","usage":{"input_tokens":5,"output_tokens":10}}}`),
	}

	dir := t.TempDir()
	projDir := filepath.Join(dir, "projects", "encoded-proj")
	if err := os.MkdirAll(projDir, 0755); err != nil {
		t.Fatal(err)
	}

	writeJSONL(t, filepath.Join(projDir, "parent-1.jsonl"), parentLines)

	sessionDir := filepath.Join(projDir, "parent-1")
	subDir := filepath.Join(sessionDir, "subagents")
	if err := os.MkdirAll(subDir, 0755); err != nil {
		t.Fatal(err)
	}
	writeJSONL(t, filepath.Join(subDir, "agent-sub-1.jsonl"), subLines)

	a, err := New(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer a.Close()

	ctx := context.Background()
	sessions, err := a.ListSessions(ctx)
	if err != nil {
		t.Fatal(err)
	}

	var parent, sub *ingest.Session
	for i := range sessions {
		if sessions[i].ID == "parent-1" {
			parent = &sessions[i]
		}
		if sessions[i].ID == "parent-1-agent-sub-1" {
			sub = &sessions[i]
		}
	}

	if parent == nil {
		t.Fatal("parent session not found")
	}
	if sub == nil {
		t.Fatal("subagent session not found")
	}
	if sub.ParentID != "parent-1" {
		t.Errorf("subagent ParentID = %q, want %q", sub.ParentID, "parent-1")
	}
	if sub.SubAgent != "agent-sub-1" {
		t.Errorf("subagent SubAgent = %q, want %q", sub.SubAgent, "agent-sub-1")
	}
}

func TestToolResultInUserMessage(t *testing.T) {
	now := time.Now().UTC().Format(time.RFC3339)
	lines := []json.RawMessage{
		json.RawMessage(`{"type":"assistant","uuid":"a1","timestamp":"` + now + `","message":{"role":"assistant","content":[{"type":"tool_use","id":"tu1","name":"Bash","input":"{}"}]}}`),
		json.RawMessage(`{"type":"user","uuid":"u1","timestamp":"` + now + `","message":{"role":"user","content":[{"tool_use_id":"tu1","type":"tool_result","content":"bash output"}]}}`),
	}

	a := setupAdapter(t, "proj", "sid-9.jsonl", lines)
	ctx := context.Background()

	msgs, err := a.Messages(ctx, "sid-9")
	if err != nil {
		t.Fatal(err)
	}
	if len(msgs) != 1 {
		t.Fatalf("expected 1 message (tool_result skipped), got %d", len(msgs))
	}

	if len(msgs[0].ToolCalls) != 1 {
		t.Fatalf("expected 1 tool call, got %d", len(msgs[0].ToolCalls))
	}
	if msgs[0].ToolCalls[0].Output != "bash output" {
		t.Errorf("ToolCall output = %q, want %q", msgs[0].ToolCalls[0].Output, "bash output")
	}
	if msgs[0].ToolCalls[0].Status != "completed" {
		t.Errorf("ToolCall status = %q, want %q", msgs[0].ToolCalls[0].Status, "completed")
	}
}

func TestResolveParentSessionID(t *testing.T) {
	tests := []struct {
		input    string
		expected string
	}{
		{"parent-1-agent-sub-1", "parent-1"},
		{"parent-agent-sub", "parent"},
		{"plain-session", "plain-session"},
		{"", ""},
	}

	for _, tc := range tests {
		got := resolveParentSessionID(tc.input)
		if got != tc.expected {
			t.Errorf("resolveParentSessionID(%q) = %q, want %q", tc.input, got, tc.expected)
		}
	}
}

func TestToolResultFileContent(t *testing.T) {
	now := time.Now().UTC().Format(time.RFC3339)
	lines := []json.RawMessage{
		json.RawMessage(`{"type":"assistant","uuid":"a1","timestamp":"` + now + `","message":{"role":"assistant","content":[{"type":"tool_use","id":"tu1","name":"Read","input":"{}"}]}}`),
	}

	dir := t.TempDir()
	projDir := filepath.Join(dir, "projects", "encoded-proj")
	if err := os.MkdirAll(projDir, 0755); err != nil {
		t.Fatal(err)
	}
	writeJSONL(t, filepath.Join(projDir, "sess.jsonl"), lines)

	toolResDir := filepath.Join(projDir, "sess", "tool-results")
	if err := os.MkdirAll(toolResDir, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(toolResDir, "tu1.txt"), []byte("file content from disk"), 0600); err != nil {
		t.Fatal(err)
	}

	a, err := New(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer a.Close()

	ctx := context.Background()
	msgs, err := a.Messages(ctx, "sess")
	if err != nil {
		t.Fatal(err)
	}
	if len(msgs) != 1 || len(msgs[0].ToolCalls) != 1 {
		t.Fatalf("expected 1 message with 1 tool call")
	}

	if msgs[0].ToolCalls[0].Output != "file content from disk" {
		t.Errorf("ToolCall Output = %q, want %q", msgs[0].ToolCalls[0].Output, "file content from disk")
	}
}

func TestGetEdits_NoEdits(t *testing.T) {
	now := time.Now().UTC().Format(time.RFC3339)
	lines := []json.RawMessage{
		json.RawMessage(`{"type":"user","uuid":"u1","timestamp":"` + now + `","message":{"role":"user","content":"hello"}}`),
	}

	a := setupAdapter(t, "proj", "sid-10.jsonl", lines)
	ctx := context.Background()

	edits, err := a.Edits(ctx, "sid-10")
	if err != nil {
		t.Fatal(err)
	}
	if len(edits) > 0 {
		t.Errorf("expected nil edits, got %d", len(edits))
	}
}

// --- helpers ---

func setupAdapter(t *testing.T, projName, filename string, lines []json.RawMessage) *Adapter {
	t.Helper()
	dir := t.TempDir()

	projDir := filepath.Join(dir, "projects", projName)
	if err := os.MkdirAll(projDir, 0755); err != nil {
		t.Fatal(err)
	}

	writeJSONL(t, filepath.Join(projDir, filename), lines)

	a, err := New(dir)
	if err != nil {
		t.Fatal(err)
	}
	return a
}

func writeJSONL(t *testing.T, path string, lines []json.RawMessage) {
	t.Helper()
	var b strings.Builder
	for _, l := range lines {
		b.WriteString(string(l))
		b.WriteByte('\n')
	}
	if err := os.WriteFile(path, []byte(b.String()), 0600); err != nil {
		t.Fatal(err)
	}
}
