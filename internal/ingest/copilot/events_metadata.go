package copilot

import (
	"bufio"
	"encoding/json"
	"os"
	"path/filepath"
)

// scanEventsMetadata reads a session's events.jsonl and extracts model, cost, token, and diff
// information from session.model_change and session.shutdown events.
func (a *Adapter) scanEventsMetadata(sessionID string) *eventsMetadata {
	eventsPath := filepath.Join(a.basePath, "session-state", sessionID, "events.jsonl")
	f, err := os.Open(eventsPath)
	if err != nil {
		return nil
	}
	defer f.Close()

	meta := &eventsMetadata{}
	scanner := bufio.NewScanner(f)
	scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)

	for scanner.Scan() {
		var env struct {
			Type string          `json:"type"`
			Data json.RawMessage `json:"data"`
		}
		if err := json.Unmarshal(scanner.Bytes(), &env); err != nil {
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

	return meta
}

// countMessagesFromEvents counts user.message and assistant.message events
// in a session's events.jsonl file. Returns 0 if the file doesn't exist.
func (a *Adapter) countMessagesFromEvents(sessionID string) int {
	eventsPath := filepath.Join(a.basePath, "session-state", sessionID, "events.jsonl")
	f, err := os.Open(eventsPath)
	if err != nil {
		return 0
	}
	defer f.Close()

	var count int
	scanner := bufio.NewScanner(f)
	scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)
	for scanner.Scan() {
		line := scanner.Bytes()
		if len(line) < 20 {
			continue
		}
		if contains(line, `"user.message"`) || contains(line, `"assistant.message"`) {
			count++
		}
	}
	return count
}

// contains reports whether sub is a substring of b.
func contains(b []byte, sub string) bool {
	return len(b) >= len(sub) && searchBytes(b, sub) >= 0
}

// searchBytes finds the first occurrence of sub in b, or -1.
func searchBytes(b []byte, sub string) int {
	for i := 0; i <= len(b)-len(sub); i++ {
		match := true
		for j := 0; j < len(sub); j++ {
			if b[i+j] != sub[j] {
				match = false
				break
			}
		}
		if match {
			return i
		}
	}
	return -1
}
