package copilot

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"

	"github.com/stevencrawford/omnivue/internal/gitmeta"
	"github.com/stevencrawford/omnivue/internal/ingest"
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

		case "session.start":
			var data sessionStartData
			if json.Unmarshal(env.Data, &data) == nil && data.Context != nil {
				meta.BranchStart = data.Context.Branch
				meta.BranchEnd = data.Context.Branch
				meta.CWDStart = data.Context.CWD
				meta.CWDEnd = data.Context.CWD
				meta.addSample(env.Timestamp, data.Context.Branch, data.Context.CWD)
			}

		case "session.context_changed":
			var data sessionContextChangedData
			if json.Unmarshal(env.Data, &data) == nil {
				if data.Branch != "" {
					if meta.BranchStart == "" {
						meta.BranchStart = data.Branch
					}
					meta.BranchEnd = data.Branch
					meta.addSample(env.Timestamp, data.Branch, data.CWD)
				}
				if data.CWD != "" {
					if meta.CWDStart == "" {
						meta.CWDStart = data.CWD
					}
					meta.CWDEnd = data.CWD
				}
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

func (m *eventsMetadata) addSample(timestamp, branch, cwd string) {
	if branch == "" {
		return
	}
	// Record only branch transitions: consecutive duplicates add memory
	// without changing the branch BranchAt reconstructs at session end.
	if n := len(m.BranchSamples); n > 0 && m.BranchSamples[n-1].Branch == branch {
		return
	}
	m.BranchSamples = append(m.BranchSamples, gitmeta.BranchSample{
		Time:   ingestkit.ParseTime(timestamp),
		Branch: branch,
		CWD:    cwd,
	})
}

// applyEventsMetadata copies the summary and git placement observed in
// events.jsonl onto a session. All Copilot construction paths use it so list,
// detail, and DB-less sessions agree.
func applyEventsMetadata(s *ingest.Session, meta *eventsMetadata) {
	if meta == nil {
		return
	}
	s.Model = meta.Model
	s.Cost = meta.Cost
	s.TokensInput = meta.TokensInput
	s.TokensOutput = meta.TokensOutput
	s.TokensReasoning = meta.TokensReasoning
	s.TokensCacheRead = meta.TokensCacheRead
	s.TokensCacheWrite = meta.TokensCacheWrite
	s.DiffAdditions = meta.DiffAdditions
	s.DiffDeletions = meta.DiffDeletions
	if meta.DiffFiles > 0 {
		s.DiffFiles = meta.DiffFiles
	}

	if meta.BranchStart != "" {
		s.BranchStart = meta.BranchStart
	}
	if meta.BranchEnd != "" {
		s.BranchEnd = meta.BranchEnd
	}
	if meta.CWDStart != "" {
		s.DirectoryStart = meta.CWDStart
	}
	if meta.CWDEnd != "" {
		s.DirectoryEnd = meta.CWDEnd
	}
	if len(meta.BranchSamples) > 0 {
		s.BranchSamples = meta.BranchSamples
	}
	s.FillProjectDefaults()
}
