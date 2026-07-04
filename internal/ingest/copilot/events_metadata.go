package copilot

import (
	"bufio"
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
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
	scanner := bufio.NewScanner(f)
	scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)

	for scanner.Scan() {
		line := scanner.Bytes()

		// Count messages using byte search (fast path, no JSON parse)
		if len(line) >= 20 {
			if bytes.Contains(line, userMsgPrefix) || bytes.Contains(line, assistantMsgPrefix) {
				msgCount++
			}
		}

		// Parse metadata events
		var env struct {
			Type string          `json:"type"`
			Data json.RawMessage `json:"data"`
		}
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
			var data struct {
				CurrentModel string `json:"currentModel"`
				CodeChanges  *struct {
					LinesAdded    int      `json:"linesAdded"`
					LinesRemoved  int      `json:"linesRemoved"`
					FilesModified []string `json:"filesModified"`
				} `json:"codeChanges"`
				ModelMetrics map[string]*struct {
					Requests *struct {
						Cost float64 `json:"cost"`
					} `json:"requests"`
					Usage *struct {
						InputTokens      int `json:"inputTokens"`
						OutputTokens     int `json:"outputTokens"`
						ReasoningTokens  int `json:"reasoningTokens"`
						CacheReadTokens  int `json:"cacheReadTokens"`
						CacheWriteTokens int `json:"cacheWriteTokens"`
					} `json:"usage"`
				} `json:"modelMetrics"`
			}
			if json.Unmarshal(env.Data, &data) != nil {
				continue
			}
			if data.CurrentModel != "" {
				meta.Model = data.CurrentModel
			}
			if data.CodeChanges != nil {
				meta.DiffAdditions = data.CodeChanges.LinesAdded
				meta.DiffDeletions = data.CodeChanges.LinesRemoved
				if n := len(data.CodeChanges.FilesModified); n > 0 {
					meta.DiffFiles = n
				}
			}
			if data.ModelMetrics != nil {
				for _, m := range data.ModelMetrics {
					if m.Requests != nil {
						meta.Cost += m.Requests.Cost
					}
					if m.Usage != nil {
						meta.TokensInput += m.Usage.InputTokens
						meta.TokensOutput += m.Usage.OutputTokens
						meta.TokensReasoning += m.Usage.ReasoningTokens
						meta.TokensCacheRead += m.Usage.CacheReadTokens
						meta.TokensCacheWrite += m.Usage.CacheWriteTokens
					}
				}
			}
		}
	}

	return meta, msgCount
}

var (
	userMsgPrefix      = []byte(`"user.message"`)
	assistantMsgPrefix = []byte(`"assistant.message"`)
)
