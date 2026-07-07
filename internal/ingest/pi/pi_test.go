package pi

import (
	"context"
	"os"
	"strings"
	"testing"
)

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
	for _, s := range sessions {
		cmd := a.ResumeCommand(&s)
		if !strings.Contains(cmd, "pi --session") {
			t.Errorf("unexpected resume command: %s", cmd)
		}
	}
}
