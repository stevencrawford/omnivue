package pi

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/stevencrawford/omnivue/internal/ingest"
)

func TestMessages_MessageAttributedUsage(t *testing.T) {
	dir := t.TempDir()
	fpath := filepath.Join(dir, "s1.jsonl")
	content := strings.Join([]string{
		`{"type":"session","version":1,"id":"s1","timestamp":"2025-01-01T00:00:00Z","cwd":"/x"}`,
		`{"type":"message","timestamp":"2025-01-01T00:00:01Z","message":{"role":"assistant","model":"gpt-5","usage":{"input":100,"output":50,"reasoning":5,"cacheRead":20,"cacheWrite":10,"totalTokens":185,"cost":{"total":0.0123}},"content":[{"type":"text","text":"reading"},{"type":"toolCall","id":"tc1","name":"read","arguments":{"filePath":"a.go"}}]}}`,
		`{"type":"message","timestamp":"2025-01-01T00:00:06Z","message":{"role":"toolResult","toolCallId":"tc1","toolName":"read","content":"file data"}}`,
	}, "\n") + "\n"
	if err := os.WriteFile(fpath, []byte(content), 0600); err != nil {
		t.Fatal(err)
	}

	a := &Adapter{}
	messages, err := a.loadMessages(fpath)
	if err != nil {
		t.Fatal(err)
	}
	if len(messages) != 1 {
		t.Fatalf("expected 1 message, got %d", len(messages))
	}
	if len(messages[0].ToolCalls) != 1 {
		t.Fatalf("expected 1 tool call, got %d", len(messages[0].ToolCalls))
	}

	tc := messages[0].ToolCalls[0]
	if tc.Output != "file data" {
		t.Errorf("tool call output = %q, want %q", tc.Output, "file data")
	}
	if tc.Duration != 5000 {
		t.Errorf("tool call duration = %dms, want 5000", tc.Duration)
	}
	if tc.Usage == nil {
		t.Fatal("expected attributed usage on tool call")
	}
	if tc.Usage.Source != ingest.UsageMessage {
		t.Errorf("usage source = %q, want %q", tc.Usage.Source, ingest.UsageMessage)
	}
	if tc.Usage.Tokens.Input != 100 || tc.Usage.Tokens.Output != 50 || tc.Usage.Tokens.Reasoning != 5 {
		t.Errorf("unexpected token usage: %+v", tc.Usage.Tokens)
	}
	if tc.Usage.Tokens.CacheRead != 20 || tc.Usage.Tokens.CacheWrite != 10 {
		t.Errorf("unexpected cache tokens: %+v", tc.Usage.Tokens)
	}
	if tc.Usage.Cost != 0.0123 {
		t.Errorf("usage cost = %v, want 0.0123", tc.Usage.Cost)
	}
}

func TestAdapter_WithSampleSession(t *testing.T) {
	basePath := "/Users/stcrawfo/.pi/agent/sessions/--Users-stcrawfo-Development-javascript-sess--"
	if _, err := os.Stat(basePath); os.IsNotExist(err) {
		t.Skip("Pi sample session directory not found")
	}
	a, err := New(basePath)
	if err != nil {
		t.Fatal(err)
	}
	defer a.Close()

	ctx := context.Background()
	sessions, err := a.ListSessions(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(sessions) < 1 {
		t.Fatal("expected at least one session")
	}

	// Verify every session has valid metadata
	for _, s := range sessions {
		t.Logf("Session: ID=%s Title=%s Model=%s Messages=%d Dir=%s Agent=%s",
			s.ID, s.Title, s.Model, s.MessageCount, s.Directory, s.Agent)

		if s.ID == "" {
			t.Error("expected non-empty session ID")
		}
		if s.Agent != "pi" {
			t.Errorf("expected agent pi, got %s", s.Agent)
		}
		if s.MessageCount < 1 {
			t.Errorf("expected >=1 messages, got %d", s.MessageCount)
		}

		msgs, err := a.Messages(ctx, s.ID)
		if err != nil {
			t.Fatal(err)
		}
		if len(msgs) < 1 {
			t.Fatal("expected at least one message, got 0")
		}

		toolCallsWithOutput := 0
		hasAnyToolCalls := false
		toolResultsAfterMerge := 0
		for _, m := range msgs {
			switch m.Role {
			case "user":
				if m.Content == "" && len(m.ToolCalls) == 0 {
					t.Log("user message with empty content and no tool calls")
				}
			case "assistant":
				if len(m.ToolCalls) > 0 {
					hasAnyToolCalls = true
					for _, tc := range m.ToolCalls {
						if tc.Name == "" {
							t.Error("tool call has empty name")
						}
						if tc.ID == "" {
							t.Error("tool call has empty ID")
						}
						if tc.Output != "" {
							toolCallsWithOutput++
						}
						t.Logf("  tool call: name=%s id=%s has_input=%v has_output=%d",
							tc.Name, tc.ID, tc.Input != "", len(tc.Output))
					}
				}
				if m.Reasoning != "" {
					t.Logf("  reasoning: %d chars", len(m.Reasoning))
				}
				if m.Model == "" {
					t.Log("assistant message has no model set")
				}
			case "toolResult":
				toolResultsAfterMerge++
			}
		}

		// hasAnyToolCalls guards against sessions with no tool calls (e.g. pure chat).
		// Without this guard, a session with zero tool calls would falsely assert.
		if hasAnyToolCalls && toolCallsWithOutput == 0 {
			t.Error("expected tool calls to have output merged from toolResult messages")
		}
		if toolResultsAfterMerge > 0 {
			t.Errorf("expected toolResult messages to be filtered out, got %d", toolResultsAfterMerge)
		}

		// Verify we can read model_change events through model tracking
		if s.Model == "" {
			t.Log("session has no model recorded")
		}
	}

	lm, err := a.LastModified(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if lm == 0 {
		t.Error("expected non-zero last modified")
	}

	// Verify resume command for each session
	spec := a.ResumeCommand()
	for _, s := range sessions {
		cmd := spec.Command(s.Directory, s.ID)
		if !strings.Contains(cmd, "pi --session") {
			t.Errorf("unexpected resume command: %s", cmd)
		}
		agent := spec.AgentCommand(s.ID)
		if agent != "/resume "+s.ID {
			t.Errorf("unexpected agent command: %s", agent)
		}
	}
}
