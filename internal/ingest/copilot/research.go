package copilot

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/stevencrawford/omnivue/internal/ingest"
)

// researchReports scans a session's research/ directory for markdown report
// files and returns them as synthetic child sessions. Reading agent data is
// strictly read-only.
func (a *Adapter) researchReports(sessionID string) []*syntheticSession {
	researchDir := filepath.Join(a.basePath, "session-state", sessionID, "research")
	entries, err := os.ReadDir(researchDir)
	if err != nil {
		return nil
	}
	var reports []*syntheticSession
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(strings.ToLower(entry.Name()), ".md") {
			continue
		}
		info, err := entry.Info()
		if err != nil {
			continue
		}
		data, err := os.ReadFile(filepath.Join(researchDir, entry.Name()))
		if err != nil {
			continue
		}
		title := markdownTitle(string(data))
		if title == "" {
			title = strings.TrimSuffix(entry.Name(), filepath.Ext(entry.Name()))
		}
		id := fmt.Sprintf("%s-research-%s", sessionID, entry.Name())
		if len(id) > 100 {
			id = id[:100]
		}
		reports = append(reports, &syntheticSession{
			session: ingest.Session{
				ID:           id,
				ParentID:     sessionID,
				Agent:        ingest.AgentCopilot,
				SubAgent:     "research",
				Title:        title,
				Status:       ingest.SessionStatusCompleted,
				CreatedAt:    info.ModTime(),
				UpdatedAt:    info.ModTime(),
				MessageCount: 1,
			},
			messages: []ingest.Message{{
				ID:        id + "-report",
				Role:      ingest.MessageRoleAssistant,
				Content:   string(data),
				Timestamp: info.ModTime(),
			}},
		})
	}
	return reports
}

// discoverResearchSessions scans every session's research/ directory and
// registers markdown reports as synthetic child sessions. Callers must not
// hold a.sessionsMu.
func (a *Adapter) discoverResearchSessions() {
	stateDir := filepath.Join(a.basePath, "session-state")
	entries, err := os.ReadDir(stateDir)
	if err != nil {
		return
	}
	var newReports []*syntheticSession
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		newReports = append(newReports, a.researchReports(entry.Name())...)
	}
	if len(newReports) == 0 {
		return
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	for _, syn := range newReports {
		if _, ok := a.syntheticSessions[syn.session.ID]; !ok {
			a.syntheticSessions[syn.session.ID] = syn
		}
	}
}

// markdownTitle extracts the first level-1 heading from markdown content.
func markdownTitle(content string) string {
	for line := range strings.SplitSeq(content, "\n") {
		trimmed := strings.TrimSpace(line)
		if title, ok := strings.CutPrefix(trimmed, "# "); ok {
			return strings.TrimSpace(title)
		}
	}
	return ""
}
