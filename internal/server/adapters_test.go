package server

import (
	"testing"

	"github.com/stevencrawford/omnivue/internal/ingest"
)

// TestAdapterRegistration guards the blank imports in adapters.go: each adapter
// package registers its factory via init(), and if those imports ever go
// missing the registry stays empty and every source fails at runtime with
// "unknown agent type".
func TestAdapterRegistration(t *testing.T) {
	infos := ingest.KnownAgentTypes()
	registered := make(map[ingest.AgentType]bool, len(infos))
	for _, info := range infos {
		registered[info.Type] = true
	}
	want := []ingest.AgentType{
		ingest.AgentOpenCode,
		ingest.AgentCopilot,
		ingest.AgentCursor,
		ingest.AgentPi,
		ingest.AgentCodex,
		ingest.AgentClaudeCode,
	}
	for _, at := range want {
		if !registered[at] {
			t.Errorf("adapter for agent type %q is not registered; blank imports in adapters.go are missing", at)
		}
	}
}
