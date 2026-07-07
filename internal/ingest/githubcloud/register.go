package githubcloud

import (
	"github.com/stevencrawford/omnivue/internal/ingest"
)

func init() {
	ingest.Register(
		ingest.AgentGitHubCloud,
		"GitHub Cloud",
		"",
		func(path string) (ingest.Adapter, error) {
			return New(""), nil
		},
		func(path string) *ingest.DiscoveredSource {
			return nil
		},
	)
}
