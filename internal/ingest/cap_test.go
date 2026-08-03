package ingest

import (
	"strings"
	"testing"
)

func TestCapMessage(t *testing.T) {
	t.Run("small content unchanged", func(t *testing.T) {
		msg := Message{Content: "hello", Reasoning: "thinking"}
		got := CapMessage(msg, 1024)
		if got.Content != "hello" || got.Reasoning != "thinking" {
			t.Fatalf("expected unchanged content, got %q / %q", got.Content, got.Reasoning)
		}
	})

	t.Run("large content truncated", func(t *testing.T) {
		msg := Message{Content: strings.Repeat("a", 10_000), ID: "m1"}
		got := CapMessage(msg, 1024)
		if got.Content == msg.Content {
			t.Fatal("expected content to be truncated")
		}
		if len(got.Content) > 1024+32 {
			t.Fatalf("expected content within limit, got %d bytes", len(got.Content))
		}
		if !strings.HasSuffix(got.Content, "… (truncated)") {
			t.Fatalf("expected truncation marker, got suffix %q", got.Content[len(got.Content)-20:])
		}
		if got.ID != "m1" {
			t.Fatalf("expected metadata preserved, got id %q", got.ID)
		}
	})

	t.Run("reasoning truncated independently", func(t *testing.T) {
		msg := Message{Content: "short", Reasoning: strings.Repeat("r", 5_000)}
		got := CapMessage(msg, 1024)
		if got.Content != "short" {
			t.Fatalf("expected content untouched, got len %d", len(got.Content))
		}
		if len(got.Reasoning) >= 5000 {
			t.Fatal("expected reasoning to be truncated")
		}
	})

	t.Run("zero limit falls back to default", func(t *testing.T) {
		msg := Message{Content: strings.Repeat("x", DefaultMessageContentBytes+100)}
		got := CapMessage(msg, 0)
		if len(got.Content) >= len(msg.Content) {
			t.Fatal("expected default limit to truncate oversized content")
		}
	})

	t.Run("CapMessages caps all", func(t *testing.T) {
		msgs := []Message{
			{Content: strings.Repeat("x", 2_000)},
			{Content: "tiny", Reasoning: strings.Repeat("y", 2_000)},
		}
		CapMessages(msgs, 512)
		if len(msgs[0].Content) > 512+32 {
			t.Fatalf("message 0 content not capped: %d", len(msgs[0].Content))
		}
		if len(msgs[1].Reasoning) > 512+32 {
			t.Fatalf("message 1 reasoning not capped: %d", len(msgs[1].Reasoning))
		}
	})

	t.Run("empty slice no-op", func(t *testing.T) {
		CapMessages(nil, 512)
	})
}
