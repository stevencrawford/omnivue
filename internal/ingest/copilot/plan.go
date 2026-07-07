package copilot

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"path/filepath"

	"github.com/stevencrawford/omnivue/internal/ingest"
)

func (a *Adapter) Plan(ctx context.Context, sessionID string) (*ingest.Plan, error) {
	planPath := filepath.Join(a.basePath, "session-state", sessionID, "plan.md")
	data, err := os.ReadFile(planPath)
	if err == nil && len(data) > 0 {
		return &ingest.Plan{
			Markdown: string(data),
			Source:   ingest.PlanDataFile,
		}, nil
	}

	rows, err := a.db.QueryContext(ctx, `
		SELECT title, overview, next_steps
		FROM checkpoints
		WHERE session_id = ?
		ORDER BY checkpoint_number DESC
		LIMIT 1
	`, sessionID)
	if err != nil {
		return nil, fmt.Errorf("querying checkpoints: %w", err)
	}
	defer rows.Close()

	if !rows.Next() {
		return nil, nil
	}

	var title, overview, nextSteps sql.NullString
	if err := rows.Scan(&title, &overview, &nextSteps); err != nil {
		return nil, fmt.Errorf("scanning checkpoint: %w", err)
	}

	var md string
	if title.Valid && title.String != "" {
		md += "# " + title.String + "\n\n"
	}
	if overview.Valid && overview.String != "" {
		md += "## Overview\n\n" + overview.String + "\n\n"
	}
	if nextSteps.Valid && nextSteps.String != "" {
		md += "## Next Steps\n\n" + nextSteps.String + "\n"
	}

	if md == "" {
		return nil, nil
	}

	return &ingest.Plan{
		Markdown: md,
		Source:   ingest.PlanDataSynthesized,
	}, nil
}
