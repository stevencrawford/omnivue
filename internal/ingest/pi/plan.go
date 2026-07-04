package pi

import (
	"strings"

	"github.com/stevencrawford/omnivue/internal/ingest"
	"github.com/stevencrawford/omnivue/internal/ingest/ingestkit"
)

// planFromMessages synthesizes a plan from assistant messages that contain
// structured plan markers (task lists, step-by-step plans, etc.).
func planFromMessages(msgs []ingest.Message) *ingest.Plan {
	var sections []string
	for _, msg := range msgs {
		if msg.Role != "assistant" {
			continue
		}
		if msg.Content != "" && ingestkit.HasPlanContent(msg.Content) {
			sections = append(sections, msg.Content)
		}
	}

	if len(sections) == 0 {
		return nil
	}

	md := strings.Join(sections, "\n\n---\n\n")
	return &ingest.Plan{
		Markdown: md,
		Source:   ingest.PlanDataSynthesized,
	}
}
