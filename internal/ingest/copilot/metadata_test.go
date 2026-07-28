package copilot

import (
	"math"
	"os"
	"path/filepath"
	"testing"
)

func approxEq(a, b float64) bool {
	return math.Abs(a-b) < 0.0001
}

func writeEventsJSONL(t *testing.T, dir, sessionID string, lines []string) {
	t.Helper()
	sessionDir := filepath.Join(dir, "session-state", sessionID)
	if err := os.MkdirAll(sessionDir, 0755); err != nil {
		t.Fatal(err)
	}
	f, err := os.Create(filepath.Join(sessionDir, "events.jsonl"))
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	for _, line := range lines {
		if _, err := f.WriteString(line + "\n"); err != nil {
			t.Fatal(err)
		}
	}
}

func TestMetadataFromEvents_NoShutdown(t *testing.T) {
	dir := t.TempDir()
	writeEventsJSONL(t, dir, "sess-1", []string{
		`{"type":"session.model_change","data":{"newModel":"gpt-4"}}`,
		`{"type":"user.message","data":{"content":"hello"}}`,
		`{"type":"assistant.message","data":{"content":"hi","messageId":"m1"}}`,
	})
	a := &Adapter{basePath: dir, syntheticSessions: make(map[string]*syntheticSession)}
	meta, count := a.metadataFromEvents("sess-1")
	if meta == nil {
		t.Fatal("expected non-nil metadata")
	}
	if meta.Cost != 0 {
		t.Errorf("expected cost 0, got %f", meta.Cost)
	}
	if count != 2 {
		t.Errorf("expected 2 messages, got %d", count)
	}
}

func TestMetadataFromEvents_SingleShutdown(t *testing.T) {
	dir := t.TempDir()
	writeEventsJSONL(t, dir, "sess-1", []string{
		`{"type":"session.shutdown","data":{"modelMetrics":{"gpt-4":{"requests":{"cost":0.15},"usage":{"inputTokens":100,"outputTokens":50}}}}}`,
	})
	a := &Adapter{basePath: dir, syntheticSessions: make(map[string]*syntheticSession)}
	meta, _ := a.metadataFromEvents("sess-1")
	if meta == nil {
		t.Fatal("expected non-nil metadata")
	}
	if !approxEq(meta.Cost, 0.15) {
		t.Errorf("expected cost 0.15, got %f", meta.Cost)
	}
	if meta.TokensInput != 100 {
		t.Errorf("expected TokensInput 100, got %d", meta.TokensInput)
	}
	if meta.TokensOutput != 50 {
		t.Errorf("expected TokensOutput 50, got %d", meta.TokensOutput)
	}
}

func TestMetadataFromEvents_MultipleShutdown(t *testing.T) {
	dir := t.TempDir()
	writeEventsJSONL(t, dir, "sess-1", []string{
		`{"type":"session.shutdown","data":{"modelMetrics":{"gpt-4":{"requests":{"cost":0.05},"usage":{"inputTokens":30,"outputTokens":20}}}}}`,
		`{"type":"session.shutdown","data":{"modelMetrics":{"gpt-4":{"requests":{"cost":0.12},"usage":{"inputTokens":80,"outputTokens":40}}}}}`,
		`{"type":"session.shutdown","data":{"modelMetrics":{"gpt-4":{"requests":{"cost":0.20},"usage":{"inputTokens":150,"outputTokens":70}}}}}`,
	})
	a := &Adapter{basePath: dir, syntheticSessions: make(map[string]*syntheticSession)}
	meta, _ := a.metadataFromEvents("sess-1")
	if meta == nil {
		t.Fatal("expected non-nil metadata")
	}
	// Should be the last event's cumulative values, not the sum
	if !approxEq(meta.Cost, 0.20) {
		t.Errorf("expected cost 0.20 (last cumulative), got %f", meta.Cost)
	}
	if meta.TokensInput != 150 {
		t.Errorf("expected TokensInput 150 (last cumulative), got %d", meta.TokensInput)
	}
	if meta.TokensOutput != 70 {
		t.Errorf("expected TokensOutput 70 (last cumulative), got %d", meta.TokensOutput)
	}
}

func TestMetadataFromEvents_MultipleModelsInOneEvent(t *testing.T) {
	dir := t.TempDir()
	writeEventsJSONL(t, dir, "sess-1", []string{
		`{"type":"session.shutdown","data":{"modelMetrics":{"gpt-4":{"requests":{"cost":0.10},"usage":{"inputTokens":80,"outputTokens":40}},"gpt-4-turbo":{"requests":{"cost":0.05},"usage":{"inputTokens":30,"outputTokens":20}}}}}`,
	})
	a := &Adapter{basePath: dir, syntheticSessions: make(map[string]*syntheticSession)}
	meta, _ := a.metadataFromEvents("sess-1")
	if meta == nil {
		t.Fatal("expected non-nil metadata")
	}
	// Within a single event, costs across models should still be summed
	if !approxEq(meta.Cost, 0.15) {
		t.Errorf("expected cost 0.15 (sum of models), got %f", meta.Cost)
	}
	if meta.TokensInput != 110 {
		t.Errorf("expected TokensInput 110, got %d", meta.TokensInput)
	}
	if meta.TokensOutput != 60 {
		t.Errorf("expected TokensOutput 60, got %d", meta.TokensOutput)
	}
}

func TestMetadataFromEvents_MultipleShutdownWithMultipleModels(t *testing.T) {
	dir := t.TempDir()
	writeEventsJSONL(t, dir, "sess-1", []string{
		// First shutdown: gpt-4 only
		`{"type":"session.shutdown","data":{"modelMetrics":{"gpt-4":{"requests":{"cost":0.10},"usage":{"inputTokens":80,"outputTokens":40}}}}}`,
		// Second shutdown: gpt-4 + gpt-4-turbo (cumulative totals)
		`{"type":"session.shutdown","data":{"modelMetrics":{"gpt-4":{"requests":{"cost":0.15},"usage":{"inputTokens":120,"outputTokens":60}},"gpt-4-turbo":{"requests":{"cost":0.05},"usage":{"inputTokens":30,"outputTokens":20}}}}}`,
	})
	a := &Adapter{basePath: dir, syntheticSessions: make(map[string]*syntheticSession)}
	meta, _ := a.metadataFromEvents("sess-1")
	if meta == nil {
		t.Fatal("expected non-nil metadata")
	}
	// Should be the last event's totals (gpt-4: 0.15 + gpt-4-turbo: 0.05 = 0.20)
	if !approxEq(meta.Cost, 0.20) {
		t.Errorf("expected cost 0.20 (last event cumulative), got %f", meta.Cost)
	}
	if meta.TokensInput != 150 {
		t.Errorf("expected TokensInput 150, got %d", meta.TokensInput)
	}
	if meta.TokensOutput != 80 {
		t.Errorf("expected TokensOutput 80, got %d", meta.TokensOutput)
	}
}
