package copilot

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"

	"github.com/stevencrawford/omnivue/internal/ingest/ingestkit"
)

// metadataFromEvents reads a session's events.jsonl and extracts model, cost,
// token, diff information, and message count in a single pass.
func (a *Adapter) metadataFromEvents(sessionID string) (*eventsMetadata, int) {
	eventsPath := filepath.Join(a.basePath, "session-state", sessionID, "events.jsonl")
	f, err := os.Open(eventsPath)
	if err != nil {
		return nil, 0
	}
	defer f.Close()

	meta := &eventsMetadata{}
	var msgCount int
	shutdowns := newShutdownParser()
	scanner := ingestkit.NewJSONLScanner(f)

	for scanner.Scan() {
		line := scanner.Bytes()

		// Count messages using byte search (fast path, no JSON parse)
		if len(line) >= 20 {
			if bytes.Contains(line, userMsgPrefix) || bytes.Contains(line, assistantMsgPrefix) {
				msgCount++
			}
		}

		// Parse metadata events
		var env eventEnvelope
		if err := json.Unmarshal(line, &env); err != nil {
			continue
		}

		switch env.Type {
		case "session.model_change":
			var data struct {
				NewModel string `json:"newModel"`
			}
			if json.Unmarshal(env.Data, &data) == nil && data.NewModel != "" {
				meta.Model = data.NewModel
			}

		case "session.shutdown":
			shutdowns.record(env)
		}
	}

	// Closing summary: the metadata path reads the latest cumulative totals and
	// code-change summary through the single shutdown parser.
	totals := shutdowns.totals()
	meta.Cost = totals.Cost
	meta.TokensInput = totals.TokensInput
	meta.TokensOutput = totals.TokensOutput
	meta.TokensReasoning = totals.TokensReasoning
	meta.TokensCacheRead = totals.TokensCacheRead
	meta.TokensCacheWrite = totals.TokensCacheWrite
	if m := shutdowns.model(); m != "" {
		meta.Model = m
	}
	if present, add, del, files := shutdowns.codeChanges(); present {
		meta.DiffAdditions = add
		meta.DiffDeletions = del
		if files > 0 {
			meta.DiffFiles = files
		}
	}

	return meta, msgCount
}

var (
	userMsgPrefix      = []byte(`"user.message"`)
	assistantMsgPrefix = []byte(`"assistant.message"`)
)
