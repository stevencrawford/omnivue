package notify

import (
	"testing"
	"time"

	"github.com/stevencrawford/omnivue/internal/ingest"
)

func msg(id, content string, ts time.Time, tools ...ingest.ToolCall) ingest.Message {
	return ingest.Message{ID: id, Role: "assistant", Content: content, Timestamp: ts, ToolCalls: tools}
}

func tool(name, id, input string) ingest.ToolCall {
	return ingest.ToolCall{ID: id, Name: name, Input: input, Output: "", Status: "completed"}
}

func enabledSettings(kinds ...Kind) Settings {
	return Settings{
		Enabled:    true,
		Kinds:      kinds,
		EnabledAt:  1, // epoch so nothing is suppressed by first-run flood
		Scope:      "all",
		InAppToast: true,
	}
}

func TestClassify_QuestionToolCall(t *testing.T) {
	ts := time.UnixMilli(2000)
	msgs := []ingest.Message{
		msg("m1", "old", time.UnixMilli(1000)),
		msg("m2", "should I refactor?", ts, tool("question", "tc-1", "pick a plan")),
	}
	settings := enabledSettings(KindQuestion)

	cands := Classify("", "active", msgs, 1, settings)
	if len(cands) != 1 {
		t.Fatalf("expected 1 candidate, got %d", len(cands))
	}
	c := cands[0]
	if c.Kind != KindQuestion {
		t.Errorf("expected kind question, got %s", c.Kind)
	}
	if c.DedupKey != "tc-1" {
		t.Errorf("expected dedup tc-1, got %s", c.DedupKey)
	}
	if c.Severity != SeverityAttention {
		t.Errorf("expected attention severity, got %s", c.Severity)
	}
}

func TestClassify_QuestionDisabled(t *testing.T) {
	msgs := []ingest.Message{
		msg("m1", "x", time.UnixMilli(2000), tool("question", "tc-1", "")),
	}
	settings := enabledSettings(KindNewToolCall) // questions not enabled
	cands := Classify("", "active", msgs, 0, settings)
	for _, c := range cands {
		if c.Kind == KindQuestion {
			t.Fatalf("question candidate emitted despite not being enabled")
		}
	}
}

func TestClassify_DedupKeyFallbackWhenNoToolID(t *testing.T) {
	msgs := []ingest.Message{
		msg("m1", "x", time.UnixMilli(2000), tool("question", "", "pick a plan")),
	}
	settings := enabledSettings(KindQuestion)
	cands := Classify("", "active", msgs, 0, settings)
	if len(cands) != 1 {
		t.Fatalf("expected 1 candidate, got %d", len(cands))
	}
	if cands[0].DedupKey == "" {
		t.Fatal("expected non-empty fallback dedup key")
	}
	if cands[0].DedupKey == "" || cands[0].DedupKey[:5] != "hash:" {
		t.Fatalf("expected hash: prefix on fallback dedup key, got %q", cands[0].DedupKey)
	}
}

func TestClassify_NewMessages(t *testing.T) {
	msgs := []ingest.Message{
		msg("m1", "old", time.UnixMilli(1000)),
		msg("m2", "first new", time.UnixMilli(2000)),
		msg("m3", "second new", time.UnixMilli(3000)),
	}
	settings := enabledSettings(KindNewMessages)
	cands := Classify("", "active", msgs, 1, settings)
	if len(cands) != 1 {
		t.Fatalf("expected 1 new_messages candidate, got %d", len(cands))
	}
	if cands[0].Kind != KindNewMessages {
		t.Errorf("expected new_messages, got %s", cands[0].Kind)
	}
	if cands[0].DedupKey != "m3" {
		t.Errorf("expected dedup=m3 (last message), got %s", cands[0].DedupKey)
	}
	if cands[0].Payload["count"] != 2 {
		t.Errorf("expected count=2, got %v", cands[0].Payload["count"])
	}
}

func TestClassify_StatusTransitions(t *testing.T) {
	settings := enabledSettings(KindStatusActive, KindStatusDone, KindStatusError)
	msgs := []ingest.Message{msg("m1", "x", time.UnixMilli(1000))}

	cands := Classify("completed", "active", msgs, 1, settings)
	if !hasKind(cands, KindStatusActive) {
		t.Errorf("expected status_active candidate, got %v", cands)
	}

	cands = Classify("active", "completed", msgs, 1, settings)
	if !hasKind(cands, KindStatusDone) {
		t.Errorf("expected status_completed candidate, got %v", cands)
	}

	cands = Classify("active", "error", msgs, 1, settings)
	if !hasKind(cands, KindStatusError) {
		t.Errorf("expected status_error candidate, got %v", cands)
	}

	// No transition -> no status candidate.
	cands = Classify("active", "active", msgs, 1, settings)
	if hasKind(cands, KindStatusActive) || hasKind(cands, KindStatusDone) {
		t.Errorf("expected no status candidate on unchanged status, got %v", cands)
	}
}

func TestClassify_FirstRunFloodSuppressed(t *testing.T) {
	// EnabledAt is "now"; older messages must be ignored.
	enabledAt := time.UnixMilli(5000)
	settings := Settings{
		Enabled: true, Kinds: []Kind{KindNewMessages}, EnabledAt: enabledAt.UnixMilli(),
	}
	msgs := []ingest.Message{
		msg("m1", "old", time.UnixMilli(1000)),
		msg("m2", "older", time.UnixMilli(2000)),
	}
	// All messages are older than EnabledAt -> no candidates.
	cands := Classify("", "active", msgs, 0, settings)
	if len(cands) != 0 {
		t.Fatalf("expected 0 candidates due to first-run flood, got %d", len(cands))
	}
}

func TestClassify_DisabledNoCandidates(t *testing.T) {
	settings := DefaultSettings() // Enabled=false
	msgs := []ingest.Message{msg("m1", "x", time.UnixMilli(2000), tool("question", "tc", ""))}
	if cands := Classify("", "active", msgs, 0, settings); len(cands) != 0 {
		t.Fatalf("expected no candidates when disabled, got %d", len(cands))
	}
}

func TestClassify_TaskComplete(t *testing.T) {
	msgs := []ingest.Message{
		msg("m1", "done", time.UnixMilli(2000), tool("task_complete", "tc-done", "")),
	}
	settings := enabledSettings(KindTaskComplete)
	cands := Classify("", "active", msgs, 0, settings)
	if len(cands) != 1 || cands[0].Kind != KindTaskComplete {
		t.Fatalf("expected one task_complete candidate, got %v", cands)
	}
}

func TestClassify_ExitPlanMode(t *testing.T) {
	msgs := []ingest.Message{
		msg("m1", "plan summary", time.UnixMilli(2000), tool("exit_plan_mode", "tc-epm", `{"summary":"refactor the widget"}`)),
	}
	settings := enabledSettings(KindExitPlanMode)
	cands := Classify("", "active", msgs, 0, settings)
	if len(cands) != 1 || cands[0].Kind != KindExitPlanMode {
		t.Fatalf("expected one exit_plan_mode candidate, got %v", cands)
	}
	c := cands[0]
	if c.DedupKey != "tc-epm" {
		t.Errorf("expected dedup tc-epm, got %s", c.DedupKey)
	}
	if c.Severity != SeverityAttention {
		t.Errorf("expected attention severity, got %s", c.Severity)
	}
	if c.Preview != "refactor the widget" {
		t.Errorf("expected preview 'refactor the widget', got %s", c.Preview)
	}
}

func TestClassify_ExitPlanModeDisabled(t *testing.T) {
	msgs := []ingest.Message{
		msg("m1", "x", time.UnixMilli(2000), tool("exit_plan_mode", "tc-epm", "")),
	}
	settings := enabledSettings(KindQuestion) // exit_plan_mode not enabled
	cands := Classify("", "active", msgs, 0, settings)
	for _, c := range cands {
		if c.Kind == KindExitPlanMode {
			t.Fatalf("exit_plan_mode candidate emitted despite not being enabled")
		}
	}
}

func TestClassify_NewToolCallSkipsQuestionAndTask(t *testing.T) {
	msgs := []ingest.Message{
		msg("m1", "x", time.UnixMilli(2000),
			tool("question", "tc-q", ""),
			tool("bash", "tc-bash", "ls"),
		),
	}
	settings := enabledSettings(KindQuestion, KindNewToolCall, KindTaskComplete)
	cands := Classify("", "active", msgs, 0, settings)
	var q, task, bash int
	for _, c := range cands {
		switch c.Kind {
		case KindQuestion:
			q++
		case KindTaskComplete:
			task++
		case KindNewToolCall:
			bash++
		}
	}
	if q != 1 {
		t.Errorf("expected 1 question, got %d", q)
	}
	if task != 0 {
		t.Errorf("expected 0 task_complete, got %d", task)
	}
	if bash != 1 {
		t.Errorf("expected 1 new_tool_call (bash), got %d", bash)
	}
}

func TestInQuietHours_Overnight(t *testing.T) {
	settings := Settings{QuietHoursEnabled: true, QuietHoursStart: "22:00", QuietHoursEnd: "08:00"}
	if !InQuietHours(time.Date(2026, 7, 4, 23, 30, 0, 0, time.Local), settings) {
		t.Error("expected 23:30 to be in quiet hours")
	}
	if !InQuietHours(time.Date(2026, 7, 4, 2, 0, 0, 0, time.Local), settings) {
		t.Error("expected 02:00 to be in quiet hours (overnight)")
	}
	if InQuietHours(time.Date(2026, 7, 4, 12, 0, 0, 0, time.Local), settings) {
		t.Error("expected 12:00 to be outside quiet hours")
	}
}

func TestInQuietHours_SameDay(t *testing.T) {
	settings := Settings{QuietHoursEnabled: true, QuietHoursStart: "13:00", QuietHoursEnd: "14:00"}
	if !InQuietHours(time.Date(2026, 7, 4, 13, 30, 0, 0, time.Local), settings) {
		t.Error("expected 13:30 to be in quiet hours")
	}
	if InQuietHours(time.Date(2026, 7, 4, 14, 0, 0, 0, time.Local), settings) {
		t.Error("expected 14:00 to be outside (end is exclusive)")
	}
}

func TestInQuietHours_Disabled(t *testing.T) {
	settings := Settings{QuietHoursEnabled: false}
	if InQuietHours(time.Now(), settings) {
		t.Error("expected false when quiet hours disabled")
	}
}

func hasKind(cands []Candidate, k Kind) bool {
	for _, c := range cands {
		if c.Kind == k {
			return true
		}
	}
	return false
}
