package copilot

import (
	"encoding/json"

	"github.com/stevencrawford/omnivue/internal/ingest"
)

// shutdownParser owns the single interpretation of session.shutdown events.
// A shutdown event carries cumulative model totals; interpreting it two ways
// (metadata-by-last-value vs. message-step-by-delta) is what produced the
// Copilot cost double-counting bug. This type is the only place that read
// happens: record() yields the per-interval delta for the messages path while
// retaining the latest cumulative totals and code-change summary for the
// metadata path, so both consumers share one parse and one aggregation rule.
type shutdownParser struct {
	last     shutdownSnapshot
	haveLast bool

	modelName string
	hadCode   bool
	add       int
	del       int
	files     int
}

// newShutdownParser returns a parser with no snapshots recorded yet.
func newShutdownParser() *shutdownParser {
	return &shutdownParser{}
}

// record consumes one session.shutdown event. It returns a cumulative-delta
// step event for the messages path (nil for the first snapshot, and nil when
// the interval adds no tokens), and updates the retained latest totals for the
// metadata path.
func (p *shutdownParser) record(event eventEnvelope) *ingest.StepEvent {
	snap, hasCode, ok := parseShutdownEvent(event)
	if !ok {
		return nil
	}

	var step *ingest.StepEvent
	if p.haveLast {
		prev := p.last
		// A shutdown snapshot's modelMetrics are not always session-cumulative:
		// after a context compaction or resume, Copilot re-bases the usage
		// counters, so a later snapshot can be SMALLER than the prior one.
		// clampDelta emits the raw value for such a field instead of clamping
		// the (negative) difference to zero, so real usage is never dropped and
		// the timeline never appears to reset. Monotonic totals keep their
		// delta behavior unchanged.
		dInput := intervalDelta(snap.TokensInput, prev.TokensInput)
		dOutput := intervalDelta(snap.TokensOutput, prev.TokensOutput)
		dReasoning := intervalDelta(snap.TokensReasoning, prev.TokensReasoning)
		dCache := intervalDelta(snap.TokensCacheRead, prev.TokensCacheRead)
		dCost := intervalDeltaFloat(snap.Cost, prev.Cost)
		if dInput > 0 || dOutput > 0 || dReasoning > 0 || dCache > 0 {
			step = &ingest.StepEvent{
				Step: ingest.StepEventFinish,
				Tokens: ingest.StepTokens{
					Input:     dInput,
					Output:    dOutput,
					Reasoning: dReasoning,
					CacheRead: dCache,
				},
				Cost: dCost,
			}
		}
	}

	p.last = snap
	p.haveLast = true
	if snap.Model != "" {
		p.modelName = snap.Model
	}
	if hasCode {
		p.hadCode = true
		p.add = snap.DiffAdditions
		p.del = snap.DiffDeletions
		p.files = snap.DiffFiles
	}
	return step
}

// totals returns the latest snapshot's cumulative token/cost values.
func (p *shutdownParser) totals() shutdownSnapshot {
	return p.last
}

// model returns the latest non-empty model observed across shutdown events.
func (p *shutdownParser) model() string {
	return p.modelName
}

// codeChanges returns the latest code-change summary seen across shutdown
// events, guarded by a presence flag so a shutdown without a summary does not
// clobber an earlier one.
func (p *shutdownParser) codeChanges() (present bool, additions, deletions, files int) {
	if !p.hadCode {
		return false, 0, 0, 0
	}
	return true, p.add, p.del, p.files
}

// intervalDelta computes the token interval between two shutdown snapshots.
// When the current snapshot is cumulative (>= previous) the interval is the
// difference; when Copilot has re-based the counters (current < previous), the
// interval is the current value itself, so a reset never looks like negative
// usage.
func intervalDelta(cur, prev int) int {
	if cur >= prev {
		return cur - prev
	}
	return cur
}

// intervalDeltaFloat is intervalDelta for float64 cost values.
func intervalDeltaFloat(cur, prev float64) float64 {
	if cur >= prev {
		return cur - prev
	}
	return cur
}

// parseShutdownEvent extracts the cumulative model/code data from one
// session.shutdown event. It is the single parse of that event shape; both the
// delta and the last-value paths read through it.
func parseShutdownEvent(event eventEnvelope) (snap shutdownSnapshot, hasCode bool, ok bool) {
	var data struct {
		Model       string `json:"currentModel"`
		CodeChanges *struct {
			LinesAdded    int      `json:"linesAdded"`
			LinesRemoved  int      `json:"linesRemoved"`
			FilesModified []string `json:"filesModified"`
		} `json:"codeChanges"`
		ModelMetrics map[string]*struct {
			Requests *struct {
				Cost float64 `json:"cost"`
			} `json:"requests"`
			Usage *struct {
				InputTokens      int `json:"inputTokens"`
				OutputTokens     int `json:"outputTokens"`
				ReasoningTokens  int `json:"reasoningTokens"`
				CacheReadTokens  int `json:"cacheReadTokens"`
				CacheWriteTokens int `json:"cacheWriteTokens"`
			} `json:"usage"`
		} `json:"modelMetrics"`
	}
	if err := json.Unmarshal(event.Data, &data); err != nil {
		return shutdownSnapshot{}, false, false
	}

	snap = shutdownSnapshot{Model: data.Model}
	if data.CodeChanges != nil {
		hasCode = true
		snap.DiffAdditions = data.CodeChanges.LinesAdded
		snap.DiffDeletions = data.CodeChanges.LinesRemoved
		snap.DiffFiles = len(data.CodeChanges.FilesModified)
	}
	for _, m := range data.ModelMetrics {
		if m.Requests != nil {
			snap.Cost += m.Requests.Cost
		}
		if m.Usage != nil {
			snap.TokensInput += m.Usage.InputTokens
			snap.TokensOutput += m.Usage.OutputTokens
			snap.TokensReasoning += m.Usage.ReasoningTokens
			snap.TokensCacheRead += m.Usage.CacheReadTokens
			snap.TokensCacheWrite += m.Usage.CacheWriteTokens
		}
	}
	return snap, hasCode, true
}