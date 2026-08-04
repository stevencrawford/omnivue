package copilot

import (
	"encoding/json"
	"testing"

	"github.com/stevencrawford/omnivue/internal/ingest"
)

func shutdownEvent(t *testing.T, model string, cost float64, input, output, reasoning, cache int) eventEnvelope {
	t.Helper()
	data, err := json.Marshal(map[string]any{
		"currentModel": model,
		"modelMetrics": map[string]any{
			"gpt-4": map[string]any{
				"requests": map[string]any{"cost": cost},
				"usage": map[string]any{
					"inputTokens":      input,
					"outputTokens":     output,
					"reasoningTokens":  reasoning,
					"cacheReadTokens":  cache,
					"cacheWriteTokens": cache,
				},
			},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	return eventEnvelope{Type: "session.shutdown", Data: data}
}

func TestShutdownParser_TotalsKeepsLastCumulative(t *testing.T) {
	p := newShutdownParser()

	// A single fixture that previously produced the cost double-count: the
	// metadata path must read the LAST event's cumulative totals, never a sum
	// of all events.
	p.record(shutdownEvent(t, "gpt-4", 0.05, 30, 20, 5, 10))
	p.record(shutdownEvent(t, "gpt-4", 0.12, 80, 40, 10, 20))
	p.record(shutdownEvent(t, "gpt-4", 0.20, 150, 70, 15, 30))

	totals := p.totals()
	if totals.Cost != 0.20 {
		t.Errorf("totals.Cost = %f, want 0.20 (last cumulative)", totals.Cost)
	}
	if totals.TokensInput != 150 {
		t.Errorf("totals.TokensInput = %d, want 150", totals.TokensInput)
	}
	if totals.TokensOutput != 70 {
		t.Errorf("totals.TokensOutput = %d, want 70", totals.TokensOutput)
	}
	if totals.TokensCacheWrite != 30 {
		t.Errorf("totals.TokensCacheWrite = %d, want 30", totals.TokensCacheWrite)
	}
	if p.model() != "gpt-4" {
		t.Errorf("model() = %q, want gpt-4", p.model())
	}
}

func TestShutdownParser_RecordEmitsIntervalDeltas(t *testing.T) {
	p := newShutdownParser()

	// First snapshot: no delta yet.
	if step := p.record(shutdownEvent(t, "", 0.05, 30, 20, 5, 10)); step != nil {
		t.Fatalf("first record() = %+v, want nil", step)
	}

	// Second snapshot: delta is the difference, not the cumulative value.
	step := p.record(shutdownEvent(t, "", 0.12, 80, 40, 10, 20))
	if step == nil {
		t.Fatal("second record() = nil, want a step event")
	}
	if step.Step != ingest.StepEventFinish {
		t.Errorf("step.Step = %q, want %q", step.Step, ingest.StepEventFinish)
	}
	if step.Tokens.Input != 50 {
		t.Errorf("step.Tokens.Input = %d, want 50", step.Tokens.Input)
	}
	if step.Tokens.Output != 20 {
		t.Errorf("step.Tokens.Output = %d, want 20", step.Tokens.Output)
	}
	if step.Tokens.CacheRead != 10 {
		t.Errorf("step.Tokens.CacheRead = %d, want 10", step.Tokens.CacheRead)
	}
	if !approxEq(step.Cost, 0.07) {
		t.Errorf("step.Cost = %f, want 0.07", step.Cost)
	}

	// Totals still reflect the latest cumulative snapshot.
	if totals := p.totals(); totals.Cost != 0.12 {
		t.Errorf("totals.Cost = %f, want 0.12", totals.Cost)
	}
}

func TestShutdownParser_NoDeltaWhenTotalsFlat(t *testing.T) {
	p := newShutdownParser()
	p.record(shutdownEvent(t, "", 0.10, 80, 40, 5, 10))
	if step := p.record(shutdownEvent(t, "", 0.10, 80, 40, 5, 10)); step != nil {
		t.Fatalf("record() with no growth = %+v, want nil", step)
	}
}

func TestShutdownParser_CodeChangesLastPresentWins(t *testing.T) {
	p := newShutdownParser()

	shutdownWithCode := func(linesAdded, linesRemoved int, files []string) eventEnvelope {
		data, err := json.Marshal(map[string]any{
			"codeChanges": map[string]any{
				"linesAdded":    linesAdded,
				"linesRemoved":  linesRemoved,
				"filesModified": files,
			},
		})
		if err != nil {
			t.Fatal(err)
		}
		return eventEnvelope{Type: "session.shutdown", Data: data}
	}

	p.record(shutdownWithCode(10, 2, []string{"a.go", "b.go"}))
	// A later shutdown WITHOUT a code-change summary must not clobber it.
	p.record(shutdownEvent(t, "", 0, 0, 0, 0, 0))

	present, add, del, files := p.codeChanges()
	if !present {
		t.Fatal("codeChanges() present = false, want true")
	}
	if add != 10 || del != 2 || files != 2 {
		t.Errorf("codeChanges() = (%d,%d,%d), want (10,2,2)", add, del, files)
	}
}
