package ingest

import (
	"github.com/stevencrawford/omnivue/internal/ingest/internal/ingestutil"
)

// AutoDiscover scans known paths for AI agent session sources
// by iterating all registered detectors.
func AutoDiscover() []DiscoveredSource {
	var discovered []DiscoveredSource

	for _, r := range registry {
		path := ingestutil.ExpandHome(r.defaultPath)
		if !ingestutil.PathExists(path) {
			continue
		}
		if d := r.detector(path); d != nil {
			discovered = append(discovered, *d)
		}
	}

	return discovered
}


