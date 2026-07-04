package ingest

import (
	"github.com/stevencrawford/omnivue/internal/ingest/ingestkit"
)

// AutoDiscover scans known paths for AI agent session sources
// by iterating all registered detectors.
func AutoDiscover() []DiscoveredSource {
	var discovered []DiscoveredSource

	for _, r := range registry {
		path := ingestkit.ExpandHome(r.defaultPath)
		if !ingestkit.PathExists(path) {
			continue
		}
		if d := r.detector(path); d != nil {
			discovered = append(discovered, *d)
		}
	}

	return discovered
}


