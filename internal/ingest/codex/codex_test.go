package codex_test

import (
	"context"
	"path/filepath"
	"strings"
	"testing"

	"github.com/stevencrawford/sess/internal/ingest/codex"
)

func testdataPath() string {
	return filepath.Join("testdata")
}

func TestAdapter_Detect(t *testing.T) {
	adapter, err := codex.New(testdataPath())
	if err != nil {
		t.Fatalf("New() failed: %v", err)
	}
	defer adapter.Close()

	if !adapter.Detect(testdataPath()) {
		t.Error("Detect() should return true for testdata directory")
	}

	tmpDir := t.TempDir()
	if adapter.Detect(tmpDir) {
		t.Error("Detect() should return false for empty directory")
	}
}

func TestAdapter_ListSessions(t *testing.T) {
	adapter, err := codex.New(testdataPath())
	if err != nil {
		t.Fatalf("New() failed: %v", err)
	}
	defer adapter.Close()

	ctx := context.Background()
	sessions, err := adapter.ListSessions(ctx)
	if err != nil {
		t.Fatalf("ListSessions() failed: %v", err)
	}

	if len(sessions) != 2 {
		t.Fatalf("expected 2 sessions, got %d", len(sessions))
	}

	session := sessions[0]
	if session.ID == "" {
		t.Error("session ID should not be empty")
	}
	if session.Agent != "codex" {
		t.Errorf("expected agent 'codex', got %q", session.Agent)
	}
	if session.Title == "" {
		t.Error("session title should not be empty")
	}
	if session.CreatedAt.IsZero() {
		t.Error("session CreatedAt should not be zero")
	}
	if session.UpdatedAt.IsZero() {
		t.Error("session UpdatedAt should not be zero")
	}
}

func TestAdapter_GetSession(t *testing.T) {
	adapter, err := codex.New(testdataPath())
	if err != nil {
		t.Fatalf("New() failed: %v", err)
	}
	defer adapter.Close()

	ctx := context.Background()
	session, err := adapter.GetSession(ctx, "019ee1dc-d721-7933-adff-18b07b510043")
	if err != nil {
		t.Fatalf("GetSession() failed: %v", err)
	}

	if session.ID != "019ee1dc-d721-7933-adff-18b07b510043" {
		t.Errorf("expected ID '019ee1dc-d721-7933-adff-18b07b510043', got %q", session.ID)
	}
	if session.Title != "Explain project purpose" {
		t.Errorf("expected title 'Explain project purpose', got %q", session.Title)
	}
	if session.Directory != "/Users/test/project" {
		t.Errorf("expected directory '/Users/test/project', got %q", session.Directory)
	}
	if session.Repository != "project" {
		t.Errorf("expected repository 'project', got %q", session.Repository)
	}
	if session.Branch != "main" {
		t.Errorf("expected branch 'main', got %q", session.Branch)
	}
	if session.Model != "gpt-5.4-mini" {
		t.Errorf("expected model 'gpt-5.4-mini', got %q", session.Model)
	}
}

func TestAdapter_GetMessages(t *testing.T) {
	adapter, err := codex.New(testdataPath())
	if err != nil {
		t.Fatalf("New() failed: %v", err)
	}
	defer adapter.Close()

	ctx := context.Background()
	messages, err := adapter.GetMessages(ctx, "019ee1dc-d721-7933-adff-18b07b510043")
	if err != nil {
		t.Fatalf("GetMessages() failed: %v", err)
	}

	if len(messages) == 0 {
		t.Fatal("expected at least one message")
	}

	hasUser := false
	hasAssistant := false
	hasSystem := false
	hasToolCalls := false

	for _, msg := range messages {
		switch msg.Role {
		case "user":
			hasUser = true
		case "assistant":
			hasAssistant = true
			if len(msg.ToolCalls) > 0 {
				hasToolCalls = true
			}
		case "system":
			hasSystem = true
		}
	}

	if !hasUser {
		t.Error("expected at least one user message")
	}
	if !hasAssistant {
		t.Error("expected at least one assistant message")
	}
	if !hasSystem {
		t.Error("expected system message for developer role content")
	}
	if !hasToolCalls {
		t.Error("expected tool calls on assistant messages")
	}

	firstUser := messages[0]
	if firstUser.Role == "user" && firstUser.Content == "" {
		t.Error("user message should have content")
	}
}

func TestAdapter_ToolCallNormalization(t *testing.T) {
	adapter, err := codex.New(testdataPath())
	if err != nil {
		t.Fatalf("New() failed: %v", err)
	}
	defer adapter.Close()

	ctx := context.Background()
	messages, err := adapter.GetMessages(ctx, "019ee1dc-d721-7933-adff-18b07b510043")
	if err != nil {
		t.Fatalf("GetMessages() failed: %v", err)
	}

	for _, msg := range messages {
		for _, tc := range msg.ToolCalls {
			if tc.Name == "exec_command" {
				t.Errorf("tool call name 'exec_command' should be normalized to 'bash', got %q", tc.Name)
			}
			if tc.ID == "" {
				t.Error("tool call ID should not be empty")
			}
			if tc.Input == "" {
				t.Error("tool call Input should not be empty")
			}
			if tc.Output == "" {
				t.Error("tool call Output should not be empty")
			}
		}
	}
}

func TestAdapter_ToolCallOutputMerging(t *testing.T) {
	adapter, err := codex.New(testdataPath())
	if err != nil {
		t.Fatalf("New() failed: %v", err)
	}
	defer adapter.Close()

	ctx := context.Background()
	messages, err := adapter.GetMessages(ctx, "019ee2ab-c812-7a33-beee-29c07b620054")
	if err != nil {
		t.Fatalf("GetMessages() failed: %v", err)
	}

	for _, msg := range messages {
		for _, tc := range msg.ToolCalls {
			if tc.Output == "" {
				t.Errorf("tool call %s (%s) should have merged output", tc.ID, tc.Name)
			}
			if tc.Status != "completed" {
				t.Errorf("tool call %s should have status 'completed', got %q", tc.ID, tc.Status)
			}
		}
	}
}

func TestAdapter_GetPlan(t *testing.T) {
	adapter, err := codex.New(testdataPath())
	if err != nil {
		t.Fatalf("New() failed: %v", err)
	}
	defer adapter.Close()

	ctx := context.Background()

	plan, err := adapter.GetPlan(ctx, "019ee2ab-c812-7a33-beee-29c07b620054")
	if err != nil {
		t.Fatalf("GetPlan() failed: %v", err)
	}
	if plan == nil {
		t.Fatal("expected a plan for session with item_completed Plan record")
	}
	if !strings.Contains(plan.Markdown, "Implementation Plan") {
		t.Errorf("plan should contain 'Implementation Plan', got: %s", plan.Markdown)
	}
	if plan.Source != "codex" {
		t.Errorf("expected source 'codex', got %q", plan.Source)
	}

	plan2, err := adapter.GetPlan(ctx, "019ee1dc-d721-7933-adff-18b07b510043")
	if err != nil {
		t.Fatalf("GetPlan() for non-plan session failed: %v", err)
	}
	if plan2 != nil {
		t.Error("expected nil plan for session without plan records")
	}
}

func TestAdapter_GetDiffs(t *testing.T) {
	adapter, err := codex.New(testdataPath())
	if err != nil {
		t.Fatalf("New() failed: %v", err)
	}
	defer adapter.Close()

	ctx := context.Background()
	diffs, err := adapter.GetDiffs(ctx, "019ee2ab-c812-7a33-beee-29c07b620054")
	if err != nil {
		t.Fatalf("GetDiffs() failed: %v", err)
	}
	if len(diffs) == 0 {
		t.Fatal("expected diff entries for session with patch_apply_end")
	}

	hasAuthGo := false
	hasMainGo := false
	for _, d := range diffs {
		if d.Path == "auth.go" {
			hasAuthGo = true
		}
		if d.Path == "main.go" {
			hasMainGo = true
		}
		if d.Path != "" && d.Status == "" {
			t.Errorf("diff file %s should have a status", d.Path)
		}
	}
	if !hasAuthGo {
		t.Error("expected diff for auth.go")
	}
	if !hasMainGo {
		t.Error("expected diff for main.go")
	}
}

func TestAdapter_GetEdits(t *testing.T) {
	adapter, err := codex.New(testdataPath())
	if err != nil {
		t.Fatalf("New() failed: %v", err)
	}
	defer adapter.Close()

	ctx := context.Background()
	edits, err := adapter.GetEdits(ctx, "019ee2ab-c812-7a33-beee-29c07b620054")
	if err != nil {
		t.Fatalf("GetEdits() failed: %v", err)
	}
	if len(edits) == 0 {
		t.Fatal("expected edit entries for session with patch_apply_end and custom_tool_call apply_patch")
	}

	hasAuthGo := false
	hasToolName := false
	for _, e := range edits {
		if e.FilePath == "auth.go" {
			hasAuthGo = true
		}
		if e.ToolName != "" {
			hasToolName = true
		}
	}
	if !hasAuthGo {
		t.Error("expected edit for auth.go")
	}
	if !hasToolName {
		t.Error("edits should have ToolName set")
	}
}

func TestAdapter_ResumeCommand(t *testing.T) {
	adapter, err := codex.New(testdataPath())
	if err != nil {
		t.Fatalf("New() failed: %v", err)
	}
	defer adapter.Close()

	ctx := context.Background()
	session, err := adapter.GetSession(ctx, "019ee1dc-d721-7933-adff-18b07b510043")
	if err != nil {
		t.Fatalf("GetSession() failed: %v", err)
	}

	cmd := adapter.ResumeCommand(session)
	if !strings.HasPrefix(cmd, "cd ") {
		t.Errorf("resume command should start with 'cd ', got %q", cmd)
	}
	if !strings.Contains(cmd, "codex resume") {
		t.Errorf("resume command should contain 'codex resume', got %q", cmd)
	}
	if !strings.Contains(cmd, session.ID) {
		t.Errorf("resume command should contain session ID %q, got %q", session.ID, cmd)
	}
}

func TestAdapter_LastModified(t *testing.T) {
	adapter, err := codex.New(testdataPath())
	if err != nil {
		t.Fatalf("New() failed: %v", err)
	}
	defer adapter.Close()

	ctx := context.Background()
	mod, err := adapter.LastModified(ctx)
	if err != nil {
		t.Fatalf("LastModified() failed: %v", err)
	}
	if mod == 0 {
		t.Error("LastModified() should return non-zero timestamp")
	}
}

func TestAdapter_MissingSession(t *testing.T) {
	adapter, err := codex.New(testdataPath())
	if err != nil {
		t.Fatalf("New() failed: %v", err)
	}
	defer adapter.Close()

	ctx := context.Background()
	_, err = adapter.GetSession(ctx, "nonexistent-id")
	if err == nil {
		t.Error("GetSession() should return error for nonexistent session")
	}

	_, err = adapter.GetMessages(ctx, "nonexistent-id")
	if err == nil {
		t.Error("GetMessages() should return error for nonexistent session")
	}
}

func TestAdapter_Close(t *testing.T) {
	adapter, err := codex.New(testdataPath())
	if err != nil {
		t.Fatalf("New() failed: %v", err)
	}
	if err := adapter.Close(); err != nil {
		t.Errorf("Close() should not error: %v", err)
	}
}

func TestAdapter_EmptyDirectory(t *testing.T) {
	tmpDir := t.TempDir()
	_, err := codex.New(tmpDir)
	if err == nil {
		t.Error("New() should fail for directory without session_index.jsonl")
	}
}

func TestAdapter_SessionOrder(t *testing.T) {
	adapter, err := codex.New(testdataPath())
	if err != nil {
		t.Fatalf("New() failed: %v", err)
	}
	defer adapter.Close()

	ctx := context.Background()
	sessions, err := adapter.ListSessions(ctx)
	if err != nil {
		t.Fatalf("ListSessions() failed: %v", err)
	}

	for i := 1; i < len(sessions); i++ {
		if sessions[i].UpdatedAt.After(sessions[i-1].UpdatedAt) {
			t.Errorf("sessions should be sorted by UpdatedAt descending: %v > %v",
				sessions[i].UpdatedAt, sessions[i-1].UpdatedAt)
		}
	}
}
