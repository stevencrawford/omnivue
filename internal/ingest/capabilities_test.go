package ingest_test

import (
	"testing"

	"github.com/stevencrawford/omnivue/internal/ingest"
	"github.com/stevencrawford/omnivue/internal/ingest/claude-code"
	"github.com/stevencrawford/omnivue/internal/ingest/codex"
	"github.com/stevencrawford/omnivue/internal/ingest/copilot"
	"github.com/stevencrawford/omnivue/internal/ingest/cursor"
	"github.com/stevencrawford/omnivue/internal/ingest/opencode"
	"github.com/stevencrawford/omnivue/internal/ingest/pi"
)

// TestAdapterCapabilities pins each adapter's declared capability set. The
// Planner/Differ/Editor seams are optional: an adapter that does not implement
// an interface must not carry a stub method, and one that does must be
// detectable by the hub's type assertions. Adding or removing a capability is
// an intentional change to the table and the adapter's behavior together.
func TestAdapterCapabilities(t *testing.T) {
	cases := []struct {
		name    string
		adapter ingest.Adapter
		planner bool
		differ  bool
		editor  bool
	}{
		{"opencode", &opencode.Adapter{}, true, true, true},
		{"copilot", &copilot.Adapter{}, true, true, true},
		{"cursor", &cursor.Adapter{}, false, true, true},
		{"pi", &pi.Adapter{}, false, true, true},
		{"codex", &codex.Adapter{}, true, true, true},
		{"claude-code", &claudecode.Adapter{}, true, true, true},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			_, isPlanner := c.adapter.(ingest.Planner)
			_, isDiffer := c.adapter.(ingest.Differ)
			_, isEditor := c.adapter.(ingest.Editor)
			if isPlanner != c.planner {
				t.Errorf("Planner = %v, want %v", isPlanner, c.planner)
			}
			if isDiffer != c.differ {
				t.Errorf("Differ = %v, want %v", isDiffer, c.differ)
			}
			if isEditor != c.editor {
				t.Errorf("Editor = %v, want %v", isEditor, c.editor)
			}
		})
	}
}
