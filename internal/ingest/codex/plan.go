package codex

import (
	"context"
	"encoding/json"
	"os"
	"strings"

	"github.com/stevencrawford/omnivue/internal/ingest"
	"github.com/stevencrawford/omnivue/internal/ingest/ingestkit"
)

func (a *Adapter) Plan(ctx context.Context, sessionID string) (*ingest.Plan, error) {
	fpath := a.sessionFilePath(sessionID)
	if fpath == "" {
		return nil, nil
	}

	f, err := os.Open(fpath)
	if err != nil {
		return nil, nil
	}
	defer f.Close()

	var sections []string
	scanner := ingestkit.NewJSONLScanner(f)
	for scanner.Scan() {
		line := scanner.Bytes()
		if len(line) == 0 {
			continue
		}

		var env codexEnvelope
		if err := json.Unmarshal(line, &env); err != nil {
			continue
		}
		if env.Type != "event_msg" {
			continue
		}

		var pl eventMsgPayload
		if err := json.Unmarshal(env.Payload, &pl); err != nil {
			continue
		}
		if pl.Type != "item_completed" || pl.Item == nil || pl.Item.Type != "Plan" {
			continue
		}

		text := strings.TrimSpace(pl.Item.Text)
		if text != "" {
			sections = append(sections, text)
		}
	}

	if len(sections) == 0 {
		return nil, nil
	}

	return &ingest.Plan{
		Markdown: strings.Join(sections, "\n\n---\n\n"),
		Source:   ingest.PlanDataSynthesized,
	}, nil
}
