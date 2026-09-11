package ingest_test

import (
	"testing"

	"github.com/stevencrawford/omnivue/internal/ingest"
)

// usageSupport documents the per-tool-call usage granularity each agent adapter
// provides. Agents record token/cost usage at the model-turn / step / message
// level, never per tool call, so supported adapters *attribute* that usage down
// to the covered tool calls and label provenance via UsageSource. An adapter with
// no row (or "none") records no usable per-tool usage.
//
// This table IS the "unsupported" flag: adding an agent type without a row, or
// letting a row drift from the adapter's actual output, fails here.
func TestToolUsageSupportTable(t *testing.T) {
	byAgent := map[ingest.AgentType]ingest.UsageSource{
		ingest.AgentOpenCode:   ingest.UsageStep,
		ingest.AgentCopilot:    ingest.UsageMessage,
		ingest.AgentCursor:     "",
		ingest.AgentPi:         ingest.UsageMessage,
		ingest.AgentCodex:      ingest.UsageMessage,
		ingest.AgentClaudeCode: ingest.UsageMessage,
	}

	known := ingest.KnownAgentTypes()
	if len(known) == 0 {
		t.Fatal("no registered adapters")
	}
	for _, a := range known {
		if _, ok := byAgent[a.Type]; !ok {
			t.Errorf("agent %q missing from tool usage support table; add or explicitly flag it", a.Type)
		}
	}
}