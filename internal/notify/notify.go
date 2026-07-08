// Package notify implements notification classification for the Omnivue
// notification system.
//
// Classification is a pure function over already-fetched session data: given the
// previous and current session status, the full chronological message list, the
// count of messages the user has already "seen", and the user's notification
// settings, it returns the set of notification candidates that should be
// persisted and surfaced to the UI. All I/O (persisting rows, emitting SSE
// events) is the responsibility of the caller in internal/server.
package notify

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"slices"
	"strings"
	"time"

	"github.com/stevencrawford/omnivue/internal/ingest"
)

// Kind identifies the type of a notification.
type Kind string

const (
	KindQuestion           Kind = "question"
	KindPermissionRequest  Kind = "permission_request"
	KindTaskComplete       Kind = "task_complete"
	KindNewMessages        Kind = "new_messages"
	KindNewToolCall        Kind = "new_tool_call"
	KindStatusActive       Kind = "status_active"
	KindStatusDone         Kind = "status_completed"
	KindStatusError        Kind = "status_error"
)

// Severity indicates how prominently a notification should be surfaced.
type Severity string

const (
	SeverityInfo      Severity = "info"
	SeverityAttention Severity = "attention"
)

// Settings mirrors the frontend notification settings form. It is persisted as a
// JSON blob in the config table under key "notifications.settings".
type Settings struct {
	Enabled           bool     `json:"enabled"`
	Kinds             []Kind   `json:"kinds"`
	Scope             string   `json:"scope"` // "all" | "opened" | "pinned"
	InAppToast        bool     `json:"inAppToast"`
	SidebarBadge      bool     `json:"sidebarBadge"`
	BrowserNotify     bool     `json:"browserNotify"`
	QuietHoursEnabled bool     `json:"quietHoursEnabled"`
	QuietHoursStart   string   `json:"quietHoursStart"` // "22:00"
	QuietHoursEnd     string   `json:"quietHoursEnd"`   // "08:00"
	AutoDismissSec    int      `json:"autoDismissSec"`
	ExcludeActiveView bool     `json:"excludeActiveView"`
	EnabledAt         int64    `json:"enabledAt"` // unix ms when notifications were enabled
}

// DefaultSettings returns the default settings: everything off (opt-in). The
// frontend controls enabling; once enabled, EnabledAt is stamped so the
// classifier can suppress the first-run flood of pre-existing messages.
func DefaultSettings() Settings {
	return Settings{
		Enabled:           false,
		Kinds:             []Kind{KindQuestion, KindPermissionRequest, KindTaskComplete},
		Scope:             "all",
		InAppToast:        true,
		SidebarBadge:      true,
		BrowserNotify:     false,
		QuietHoursEnabled: false,
		QuietHoursStart:   "22:00",
		QuietHoursEnd:     "08:00",
		AutoDismissSec:    8,
		ExcludeActiveView: true,
	}
}

// has reports whether the given kind is enabled in settings.
func (s *Settings) has(k Kind) bool {
	return slices.Contains(s.Kinds, k)
}

// QuestionToolNames is the set of tool-call names that count as the agent asking
// the human a question. Centralized here so adding a new agent is a one-line
// change. Names are lowercased before lookup.
var QuestionToolNames = map[string]struct{}{
	"question":       {},
	"ask":            {},
	"exit_plan_mode": {},
}

// PermissionToolNames is the set of tool-call names that count as the agent
// requesting permission to perform an action. Names are lowercased before lookup.
var PermissionToolNames = map[string]struct{}{
	"permission_request": {},
}

// TaskCompleteToolNames is the set of tool-call names signaling task
// completion.
var TaskCompleteToolNames = map[string]struct{}{
	"task_complete":  {},
	"task-complete":  {},
	"taskcomplete":   {},
}

// Candidate is a classification result. The caller persists one notification
// row per candidate, deduplicated by (SessionID, Kind, DedupKey).
type Candidate struct {
	Kind     Kind
	DedupKey string
	Title    string
	Preview  string
	Severity Severity
	Payload  map[string]any
}

// Classify examines new messages (those at or beyond lastSeenCount) and the
// session status transition, and returns the notification candidates that
// should be emitted under the given settings.
//
// msgs must be the full chronological message list from the adapter. New
// messages are msgs[lastSeenCount:]. prevStatus is the session's status as of
// the previous poll (empty if unknown); currStatus is the current status.
//
// Classify performs no I/O and is safe to call concurrently.
func Classify(prevStatus, currStatus string, msgs []ingest.Message, lastSeenCount int, settings Settings) []Candidate {
	if !settings.Enabled || len(msgs) == 0 {
		return nil
	}

	enabledAt := time.UnixMilli(settings.EnabledAt)
	if lastSeenCount > len(msgs) {
		lastSeenCount = len(msgs)
	}
	if lastSeenCount < 0 {
		lastSeenCount = 0
	}
	newMsgs := msgs[lastSeenCount:]

	var candidates []Candidate

	// --- Message-level kinds ---
	newMessageCount := 0
	for i, m := range newMsgs {
		// First-run flood suppression: ignore messages older than the moment
		// notifications were enabled. (Status transitions below are not
		// suppressed, since they reflect current state.)
		if !m.Timestamp.IsZero() && settings.EnabledAt > 0 && m.Timestamp.Before(enabledAt) {
			continue
		}
		newMessageCount++

		for _, tc := range m.ToolCalls {
			name := strings.ToLower(tc.Name)
			if _, ok := QuestionToolNames[name]; ok {
				if settings.has(KindQuestion) {
					candidates = append(candidates, Candidate{
						Kind:     KindQuestion,
						DedupKey: toolDedupKey(tc.ID, m.ID, name),
						Title:    "Asked a question",
						Preview:  previewForQuestion(m.Content, tc.Input),
						Severity: SeverityAttention,
						Payload: map[string]any{
							"toolCallId":   tc.ID,
							"messageId":    m.ID,
							"messageIndex": lastSeenCount + i,
							"tabHint":      "session",
						},
					})
				}
				continue // a question tool call is not also a "new tool call"
			}
			if _, ok := PermissionToolNames[name]; ok {
				if settings.has(KindPermissionRequest) {
					candidates = append(candidates, Candidate{
						Kind:     KindPermissionRequest,
						DedupKey: toolDedupKey(tc.ID, m.ID, name),
						Title:    "Permission needed",
						Preview:  previewForPermission(m.Content, tc.Input),
						Severity: SeverityAttention,
						Payload: map[string]any{
							"toolCallId":   tc.ID,
							"messageId":    m.ID,
							"messageIndex": lastSeenCount + i,
							"tabHint":      "session",
						},
					})
				}
				continue
			}
			if _, ok := TaskCompleteToolNames[name]; ok {
				if settings.has(KindTaskComplete) {
					candidates = append(candidates, Candidate{
						Kind:     KindTaskComplete,
						DedupKey: toolDedupKey(tc.ID, m.ID, name),
						Title:    "Task complete",
						Preview:  previewForTaskComplete(m.Content, tc.Output),
						Severity: SeverityInfo,
						Payload: map[string]any{
							"toolCallId":   tc.ID,
							"messageId":    m.ID,
							"messageIndex": lastSeenCount + i,
							"tabHint":      "session",
						},
					})
				}
				continue
			}
			if settings.has(KindNewToolCall) {
				candidates = append(candidates, Candidate{
					Kind:     KindNewToolCall,
					DedupKey: toolDedupKey(tc.ID, m.ID, name),
					Title:    fmt.Sprintf("Tool call: %s", tc.Name),
					Preview:  previewText("", tc.Input),
					Severity: SeverityInfo,
					Payload: map[string]any{
						"toolCallId":   tc.ID,
						"messageId":    m.ID,
						"messageIndex": lastSeenCount + i,
						"toolName":     tc.Name,
						"tabHint":      "session",
					},
				})
			}
		}
	}

	if newMessageCount > 0 && settings.has(KindNewMessages) {
		last := newMsgs[len(newMsgs)-1]
		candidates = append(candidates, Candidate{
			Kind:     KindNewMessages,
			DedupKey: last.ID,
			Title:    fmt.Sprintf("%d new message(s)", newMessageCount),
			Preview:  previewText(last.Content, ""),
			Severity: SeverityInfo,
			Payload: map[string]any{
				"messageId":    last.ID,
				"messageIndex": len(msgs) - 1,
				"count":        newMessageCount,
				"tabHint":      "session",
			},
		})
	}

	// --- Status transitions ---
	if prevStatus != currStatus && currStatus != "" {
		switch {
		case currStatus == string(ingest.SessionStatusActive) && settings.has(KindStatusActive):
			candidates = append(candidates, statusCandidate(KindStatusActive, "Session became active", "is now active"))
		case currStatus == string(ingest.SessionStatusCompleted) && settings.has(KindStatusDone):
			candidates = append(candidates, statusCandidate(KindStatusDone, "Session completed", "completed"))
		case isStatusError(currStatus) && settings.has(KindStatusError):
			candidates = append(candidates, statusCandidate(KindStatusError, "Session errored", "errored"))
		}
	}

	return candidates
}

func statusCandidate(kind Kind, title, dedupSuffix string) Candidate {
	return Candidate{
		Kind:     kind,
		DedupKey: dedupSuffix,
		Title:    title,
		Preview:  "",
		Severity: SeverityInfo,
		Payload:  map[string]any{"tabHint": "session"},
	}
}

func isStatusError(status string) bool {
	s := strings.ToLower(status)
	return strings.Contains(s, "error") || strings.Contains(s, "failed")
}

// toolDedupKey returns a stable dedup key for a tool-call notification. It
// prefers the tool call's own ID; when that is empty (some adapters don't
// provide stable IDs), it falls back to a hash of the message ID and tool
// name. The input is intentionally excluded to keep the key stable and bounded
// in size, since input may be large and varies across polls for some adapters.
func toolDedupKey(toolCallID, messageID, toolName string) string {
	if toolCallID != "" {
		return toolCallID
	}
	h := sha256.Sum256([]byte(messageID + "|" + toolName))
	return "hash:" + hex.EncodeToString(h[:8])
}

// previewText builds a single-line preview, preferring the message content and
// falling back to the tool input/output. It is clamped to ~200 chars and has
// newlines collapsed to spaces.
func previewText(content, fallback string) string {
	s := strings.TrimSpace(content)
	if s == "" {
		s = strings.TrimSpace(fallback)
	}
	s = strings.ReplaceAll(s, "\n", " ")
	s = strings.ReplaceAll(s, "\r", " ")
	if len(s) > 200 {
		s = s[:200] + "…"
	}
	return s
}

// previewForQuestion builds a preview for question tool call notifications.
// It prefers the message content, then tries to extract text from the tool
// input JSON (which may contain a "question", "text", "prompt", or "message"
// field), and falls back to a descriptive default.
func previewForQuestion(content, input string) string {
	if s := strings.TrimSpace(content); s != "" && s != "{}" {
		return previewText(s, "")
	}
	var data map[string]any
	if json.Unmarshal([]byte(input), &data) == nil {
		for _, key := range []string{"question", "text", "prompt", "message"} {
			if s, ok := data[key].(string); ok && s != "" {
				return previewText(s, "")
			}
		}
	}
	return "Agent asked you a question"
}

// previewForPermission builds a preview for permission request notifications.
// It prefers the message content, then tries to extract a "command" field from
// the tool input JSON, and falls back to a descriptive default.
func previewForPermission(content, input string) string {
	if s := strings.TrimSpace(content); s != "" && s != "{}" {
		return previewText(s, "")
	}
	var data map[string]any
	if json.Unmarshal([]byte(input), &data) == nil {
		if s, ok := data["command"].(string); ok && s != "" {
			return previewText(s, "")
		}
	}
	return "Session is blocked awaiting permissions"
}

// previewForTaskComplete builds a preview for task-complete notifications.
// It prefers the message content, then tries to extract text from the tool
// output, and falls back to a descriptive default.
func previewForTaskComplete(content, output string) string {
	if s := strings.TrimSpace(content); s != "" {
		return previewText(s, "")
	}
	if s := strings.TrimSpace(output); s != "" {
		return previewText("", s)
	}
	return "Task completed successfully"
}

// InQuietHours reports whether the given time falls within the configured quiet
// hours window. Quiet hours may cross midnight (e.g. 22:00→08:00). Times are
// interpreted in the server's local timezone, matching how the user specifies
// them in the settings UI.
func InQuietHours(now time.Time, settings Settings) bool {
	if !settings.QuietHoursEnabled {
		return false
	}
	start, ok1 := parseHHMM(settings.QuietHoursStart)
	end, ok2 := parseHHMM(settings.QuietHoursEnd)
	if !ok1 || !ok2 {
		return false
	}
	cur := now.Hour()*60 + now.Minute()
	if start == end {
		return false
	}
	if start < end {
		return cur >= start && cur < end
	}
	// Overnight window (crosses midnight).
	return cur >= start || cur < end
}

func parseHHMM(s string) (minutes int, ok bool) {
	parts := strings.Split(s, ":")
	if len(parts) != 2 {
		return 0, false
	}
	h, err1 := atoi(parts[0])
	m, err2 := atoi(parts[1])
	if err1 != nil || err2 != nil {
		return 0, false
	}
	if h < 0 || h > 23 || m < 0 || m > 59 {
		return 0, false
	}
	return h*60 + m, true
}

func atoi(s string) (int, error) {
	s = strings.TrimSpace(s)
	if s == "" {
		return 0, fmt.Errorf("empty")
	}
	n := 0
	for _, r := range s {
		if r < '0' || r > '9' {
			return 0, fmt.Errorf("non-digit")
		}
		n = n*10 + int(r-'0')
	}
	return n, nil
}
