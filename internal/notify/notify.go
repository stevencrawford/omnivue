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
	"maps"
	"slices"
	"strings"
	"time"

	"github.com/stevencrawford/omnivue/internal/ingest"
	"github.com/stevencrawford/omnivue/internal/ingest/ingestkit"
)

// Kind identifies the type of a notification.
type Kind string

const (
	KindQuestion          Kind = "question"
	KindPermissionRequest Kind = "permission_request"
	KindExitPlanMode      Kind = "exit_plan_mode"
	KindTaskComplete      Kind = "task_complete"
	KindNewMessages       Kind = "new_messages"
	KindNewToolCall       Kind = "new_tool_call"
	KindStatusActive      Kind = "status_active"
	KindStatusDone        Kind = "status_completed"
	KindStatusError       Kind = "status_error"
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
	Enabled           bool   `json:"enabled"`
	Kinds             []Kind `json:"kinds"`
	Scope             string `json:"scope"` // "all" | "opened" | "pinned"
	InAppToast        bool   `json:"inAppToast"`
	SidebarBadge      bool   `json:"sidebarBadge"`
	BrowserNotify     bool   `json:"browserNotify"`
	ExcludeActiveView bool   `json:"excludeActiveView"`
	EnabledAt         int64  `json:"enabledAt"` // unix ms when notifications were enabled
}

// DefaultSettings returns the default settings: everything off (opt-in). The
// frontend controls enabling; once enabled, EnabledAt is stamped so the
// classifier can suppress the first-run flood of pre-existing messages.
func DefaultSettings() Settings {
	return Settings{
		Enabled:           false,
		Kinds:             []Kind{KindQuestion, KindPermissionRequest, KindExitPlanMode, KindTaskComplete},
		Scope:             "all",
		InAppToast:        true,
		SidebarBadge:      true,
		BrowserNotify:     false,
		ExcludeActiveView: true,
	}
}

// ResolveEnabledAt decides the EnabledAt value for a settings save. The first
// time the user enables notifications (or re-enables after disabling), now is
// stamped so the classifier can suppress the flood of pre-existing messages;
// disabling clears the boundary; an unchanged save keeps the previous one. The
// HTTP handler calls this instead of embedding the rule.
func ResolveEnabledAt(prev, next Settings, now time.Time) int64 {
	switch {
	case next.Enabled && (!prev.Enabled || prev.EnabledAt == 0):
		return now.UnixMilli()
	case !next.Enabled:
		return 0
	default:
		return prev.EnabledAt
	}
}

// suppresses reports whether a message timestamp is older than the moment
// notifications were enabled and should therefore be skipped by the first-run
// flood suppression.
func (s *Settings) suppresses(t time.Time) bool {
	return !t.IsZero() && s.EnabledAt > 0 && t.Before(time.UnixMilli(s.EnabledAt))
}

// has reports whether the given kind is enabled in settings.
func (s *Settings) has(k Kind) bool {
	return slices.Contains(s.Kinds, k)
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

// toolPayload builds the jump payload for a tool-call notification. It carries
// the canonical Position (messageID + toolCallID) so the frontend can land
// unconditionally on the exact tool call, mirroring bookmark jumps. No raw
// message index is emitted, since indexes are not stable identity.
func toolPayload(m ingest.Message, tc ingest.ToolCall, extra map[string]any) map[string]any {
	p := map[string]any{
		"position": map[string]any{
			"messageID":  m.ID,
			"toolCallID": tc.ID,
		},
		"toolCallId": tc.ID,
		"messageId":  m.ID,
		"tabHint":    "session",
	}
	maps.Copy(p, extra)
	return p
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
	for _, m := range newMsgs {
		// First-run flood suppression: ignore messages older than the moment
		// notifications were enabled. (Status transitions below are not
		// suppressed, since they reflect current state.)
		if settings.suppresses(m.Timestamp) {
			continue
		}
		newMessageCount++

		for _, tc := range m.ToolCalls {
			name := strings.ToLower(tc.Name)
			if ingestkit.HasKind(name, ingestkit.KindQuestion) {
				// When the tool name is "question", check if it's actually a
				// permission request (choices contain Allow/Deny) and route to
				// KindPermissionRequest instead.
				if name == "question" && isPermissionInput(tc.Input) && settings.has(KindPermissionRequest) {
					candidates = append(candidates, Candidate{
						Kind:     KindPermissionRequest,
						DedupKey: toolDedupKey(tc.ID, m.ID, name),
						Title:    "Permission needed",
						Preview:  previewForPermission(m.Content, tc.Input),
						Severity: SeverityAttention,
						Payload:  toolPayload(m, tc, nil),
					})
				} else if settings.has(KindQuestion) {
					candidates = append(candidates, Candidate{
						Kind:     KindQuestion,
						DedupKey: toolDedupKey(tc.ID, m.ID, name),
						Title:    "Question Asked",
						Preview:  previewForQuestion(m.Content, tc.Input),
						Severity: SeverityAttention,
						Payload:  toolPayload(m, tc, nil),
					})
				}
				continue // a question/permission tool call is not also a "new tool call"
			}
			if name == "exit_plan_mode" && settings.has(KindExitPlanMode) {
				candidates = append(candidates, Candidate{
					Kind:     KindExitPlanMode,
					DedupKey: toolDedupKey(tc.ID, m.ID, name),
					Title:    "Proposed Plan",
					Preview:  previewForExitPlanMode(tc.Input, tc.Output),
					Severity: SeverityAttention,
					Payload:  toolPayload(m, tc, nil),
				})
				continue
			}
			if ingestkit.HasKind(name, ingestkit.KindPermission) {
				if settings.has(KindPermissionRequest) {
					candidates = append(candidates, Candidate{
						Kind:     KindPermissionRequest,
						DedupKey: toolDedupKey(tc.ID, m.ID, name),
						Title:    "Permission needed",
						Preview:  previewForPermission(m.Content, tc.Input),
						Severity: SeverityAttention,
						Payload:  toolPayload(m, tc, nil),
					})
				}
				continue
			}
			if ingestkit.HasKind(name, ingestkit.KindTaskComplete) {
				if settings.has(KindTaskComplete) {
					candidates = append(candidates, Candidate{
						Kind:     KindTaskComplete,
						DedupKey: toolDedupKey(tc.ID, m.ID, name),
						Title:    "Task complete",
						Preview:  previewForTaskComplete(m.Content, tc.Output),
						Severity: SeverityInfo,
						Payload:  toolPayload(m, tc, nil),
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
					Payload:  toolPayload(m, tc, map[string]any{"toolName": tc.Name}),
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
				"position": map[string]any{
					"messageID": last.ID,
				},
				"messageId": last.ID,
				"count":     newMessageCount,
				"tabHint":   "session",
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
// It prefers the question text carried by the tool input (the actual ask),
// then the message content, and falls back to a descriptive default. Some
// agents (e.g. OpenCode) embed the question in the tool input while the
// message content holds the assistant's preceding narrative.
func previewForQuestion(content, input string) string {
	var data map[string]any
	if json.Unmarshal([]byte(input), &data) == nil {
		if s := questionTextFromInput(data); s != "" {
			return previewText(s, "")
		}
	}
	if s := strings.TrimSpace(content); s != "" && s != "{}" {
		return previewText(s, "")
	}
	return "Agent asked you a question"
}

// previewForPermission builds a preview for permission request notifications.
// It prefers the requested "command" or the question text from the tool input,
// then the message content, and falls back to a descriptive default.
func previewForPermission(content, input string) string {
	var data map[string]any
	if json.Unmarshal([]byte(input), &data) == nil {
		if s, ok := data["command"].(string); ok && s != "" {
			return previewText(s, "")
		}
		if s := questionTextFromInput(data); s != "" {
			return previewText(s, "")
		}
	}
	if s := strings.TrimSpace(content); s != "" && s != "{}" {
		return previewText(s, "")
	}
	return "Session is blocked awaiting permissions"
}

// questionTextFromInput extracts the text of the first question from a
// question/permission tool input. Supported shapes:
//
//   - a top-level "question" string,
//   - a "questions" array whose first entry has "question" or "header", or
//   - top-level "text", "prompt", or "message" strings.
func questionTextFromInput(data map[string]any) string {
	if s, ok := data["question"].(string); ok && s != "" {
		return s
	}
	if qs, ok := data["questions"].([]any); ok && len(qs) > 0 {
		if q, ok := qs[0].(map[string]any); ok {
			for _, key := range []string{"question", "header"} {
				if s, ok := q[key].(string); ok && s != "" {
					return s
				}
			}
		}
	}
	for _, key := range []string{"text", "prompt", "message"} {
		if s, ok := data[key].(string); ok && s != "" {
			return s
		}
	}
	return ""
}

// isPermissionInput reports whether the tool input represents a permission
// request — a question-like tool call whose choices contain "Allow"/"Deny".
func isPermissionInput(input string) bool {
	var raw struct {
		Choices   []string `json:"choices"`
		Questions []struct {
			Question string `json:"question"`
			Options  []struct {
				Label string `json:"label"`
			} `json:"options"`
		} `json:"questions"`
	}
	if err := json.Unmarshal([]byte(input), &raw); err != nil {
		return false
	}
	if slices.ContainsFunc(raw.Choices, isPermissionKeyword) {
		return true
	}
	for _, q := range raw.Questions {
		for _, opt := range q.Options {
			if isPermissionKeyword(opt.Label) {
				return true
			}
		}
	}
	return false
}

func isPermissionKeyword(s string) bool {
	switch strings.ToLower(s) {
	case "allow", "deny", "allow once", "allow once for this session":
		return true
	}
	return false
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

// previewForExitPlanMode builds a preview for exit_plan_mode notifications.
// It tries to extract the plan summary from the tool input or output JSON,
// which typically stores content under "summary", "plan", or "content" keys.
func previewForExitPlanMode(input, output string) string {
	if s := strings.TrimSpace(output); s != "" {
		return previewText(s, "")
	}
	var data map[string]any
	if json.Unmarshal([]byte(input), &data) == nil {
		for _, key := range []string{"summary", "plan", "content"} {
			if s, ok := data[key].(string); ok && s != "" {
				return previewText(s, "")
			}
		}
	}
	return "Plan mode exited"
}
