package claudecode

import (
	"context"
	"os"
	"path/filepath"

	"github.com/stevencrawford/omnivue/internal/ingest"
	"github.com/stevencrawford/omnivue/internal/ingest/ingestkit"
)

func (a *Adapter) Plan(ctx context.Context, sessionID string) (*ingest.Plan, error) {
	fpath := a.findSessionFile(sessionID)
	if fpath == "" {
		return nil, nil
	}

	slug := a.findSlugFromSession(fpath)
	if slug == "" {
		return nil, nil
	}

	planPath := filepath.Join(a.claudeDir, planDir, slug+".md")
	if ingestkit.PathExists(planPath) {
		content, err := os.ReadFile(planPath)
		if err != nil {
			return nil, nil
		}
		return &ingest.Plan{
			Markdown: string(content),
			Source:   ingest.PlanDataFile,
		}, nil
	}

	return nil, nil
}
