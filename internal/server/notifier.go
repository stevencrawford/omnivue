package server

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"sync"
	"time"

	"github.com/stevencrawford/omnivue/internal/ingest"
	"github.com/stevencrawford/omnivue/internal/notify"
	"github.com/stevencrawford/omnivue/internal/store"
)

const notifySettingsKey = "notifications.settings"

// activeViewWindow is how long a session stays excluded from notifications
// after it was last reported as actively viewed. The frontend re-reports the
// active view on a heartbeat while a session is open, so this window only needs
// to bridge the gap between reports.
const activeViewWindow = 5 * time.Minute

// Notifier classifies changed sessions into notifications, advances the
// seen-message cursors, and emits results over the EventBus. It operates on
// the distinct store roles it needs so it can be driven in isolation from the
// poll loop.
type Notifier struct {
	hub   *SessionHub
	notif store.NotificationStore
	cfg   store.ConfigStore
	tags  store.TagStore
	bus   *EventBus

	activeViewsMu sync.Mutex
	activeViews   map[string]time.Time
}

func NewNotifier(hub *SessionHub, notifs store.NotificationStore, cfg store.ConfigStore, tags store.TagStore, bus *EventBus) *Notifier {
	return &Notifier{
		hub:         hub,
		notif:       notifs,
		cfg:         cfg,
		tags:        tags,
		bus:         bus,
		activeViews: make(map[string]time.Time),
	}
}

// LoadSettings loads notification settings from the config table, falling back
// to defaults on any error or missing row.
func (n *Notifier) LoadSettings() notify.Settings {
	if n.cfg == nil {
		return notify.DefaultSettings()
	}
	raw, err := n.cfg.Config(notifySettingsKey)
	if err != nil || raw == "" {
		return notify.DefaultSettings()
	}
	var settings notify.Settings
	if err := json.Unmarshal([]byte(raw), &settings); err != nil {
		return notify.DefaultSettings()
	}
	return settings
}

// SaveSettings persists notification settings.
func (n *Notifier) SaveSettings(settings notify.Settings) error {
	if n.cfg == nil {
		return fmt.Errorf("store not available")
	}
	data, err := json.Marshal(settings)
	if err != nil {
		return fmt.Errorf("marshal settings: %w", err)
	}
	if err := n.cfg.SetConfig(notifySettingsKey, string(data)); err != nil {
		return fmt.Errorf("save settings: %w", err)
	}
	return nil
}

// ReportActiveView records that the given session is currently being viewed by
// the user. Used by the ExcludeActiveView notification setting.
func (n *Notifier) ReportActiveView(sessionID string) {
	if sessionID == "" {
		return
	}
	n.activeViewsMu.Lock()
	n.activeViews[sessionID] = time.Now()
	n.activeViewsMu.Unlock()
}

// ClassifyChanges inspects the changed sessions, runs the pure classifier, and
// persists+emits any resulting notifications. It must not block the poll loop,
// so callers always invoke it in a goroutine.
func (n *Notifier) ClassifyChanges(ctx context.Context, changedIDs []string, transitions []statusTransition) {
	defer func() {
		if r := recover(); r != nil {
			slog.Error("panic in ClassifyChanges", "recover", r)
		}
	}()
	if n.notif == nil || len(changedIDs) == 0 {
		return
	}
	settings := n.LoadSettings()
	if !settings.Enabled {
		// Even when disabled, advance the seen-message cursor so we don't
		// flood the user with a backlog of pre-existing messages the moment
		// they re-enable notifications.
		n.AdvanceSeenCursors(ctx, changedIDs)
		return
	}

	// Cap per-tick work to protect against a first-load burst.
	if len(changedIDs) > 50 {
		slog.Warn("ClassifyChanges: capping changed sessions", "count", len(changedIDs))
		n.AdvanceSeenCursors(ctx, changedIDs[50:])
		changedIDs = changedIDs[:50]
	}

	// Index transitions by session id for quick lookup.
	transBySession := make(map[string]statusTransition, len(transitions))
	for _, t := range transitions {
		transBySession[t.sessionID] = t
	}

	var emittedAny bool
	for _, sid := range changedIDs {
		sess, err := n.hub.Session(ctx, sid)
		if err != nil || sess == nil {
			continue
		}
		// Scope filter: only sessions the user has opened / pinned.
		if !n.SessionInScope(ctx, sess.ID, settings.Scope) {
			n.AdvanceSeenCursor(ctx, sess)
			continue
		}
		msgs, err := n.hub.Messages(ctx, sess.ID)
		if err != nil {
			continue
		}

		st, err := n.notif.NotificationState(sess.ID)
		if err != nil {
			slog.Warn("failed to load notification state", "session", sess.ID, "error", err)
			continue
		}

		prevStatus := ""
		if t, ok := transBySession[sess.ID]; ok {
			prevStatus = t.from
		}

		candidates := notify.Classify(prevStatus, string(sess.Status), msgs, st.LastSeenMessageCount, settings)

		// ExcludeActiveView: don't notify about the session the user is currently
		// looking at. The seen-cursor still advances below so no backlog forms.
		if settings.ExcludeActiveView && n.isActiveView(sess.ID) {
			candidates = nil
		}

		for _, c := range candidates {
			nraw := store.Notification{
				ID:        fmt.Sprintf("notif_%d_%s", time.Now().UnixNano(), shortID(c.DedupKey)),
				SessionID: sess.ID,
				SourceID:  sess.SourceID,
				Kind:      string(c.Kind),
				Title:     c.Title,
				Preview:   c.Preview,
				Severity:  string(c.Severity),
				CreatedAt: time.Now().UnixMilli(),
			}
			if c.Payload != nil {
				if data, err := json.Marshal(c.Payload); err == nil {
					nraw.Payload = string(data)
				}
			}
			inserted, err := n.notif.InsertNotification(nraw, c.DedupKey)
			if err != nil {
				slog.Warn("failed to insert notification", "session", sess.ID, "error", err)
				continue
			}
			if inserted {
				emittedAny = true
				n.emitNotification(nraw, c.Payload)
			}
		}

		// Advance the seen-message cursor regardless of whether we emitted.
		if len(msgs) != st.LastSeenMessageCount {
			if err := n.notif.SetNotificationState(sess.ID, len(msgs), time.Now()); err != nil {
				slog.Warn("failed to set notification state", "session", sess.ID, "error", err)
			}
		}
	}

	if emittedAny {
		// Opportunistically prune old notifications so the table stays bounded.
		if err := n.notif.PruneNotifications(500); err != nil {
			slog.Warn("failed to prune notifications", "error", err)
		}
	}
}

// AdvanceSeenCursors advances the seen-message cursor for every changed
// session without classifying. Used when notifications are disabled.
func (n *Notifier) AdvanceSeenCursors(ctx context.Context, changedIDs []string) {
	for _, sid := range changedIDs {
		sess, err := n.hub.Session(ctx, sid)
		if err != nil || sess == nil {
			continue
		}
		n.AdvanceSeenCursor(ctx, sess)
	}
}

func (n *Notifier) AdvanceSeenCursor(ctx context.Context, sess *ingest.Session) {
	if n.notif == nil || sess == nil {
		return
	}
	msgs, err := n.hub.Messages(ctx, sess.ID)
	if err != nil {
		return
	}
	st, err := n.notif.NotificationState(sess.ID)
	if err != nil {
		return
	}
	if len(msgs) != st.LastSeenMessageCount {
		if err := n.notif.SetNotificationState(sess.ID, len(msgs), time.Now()); err != nil {
			slog.Warn("failed to set notification state", "session", sess.ID, "error", err)
		}
	}
}

// SessionInScope reports whether the session passes the configured scope
// filter. "all" passes everything; "opened" requires the user to have opened
// the session at least once; "pinned" requires the session to have a tag.
func (n *Notifier) SessionInScope(ctx context.Context, sessionID, scope string) bool {
	switch scope {
	case "opened":
		st, err := n.notif.NotificationState(sessionID)
		if err != nil || st.FirstViewedAt == nil {
			return false
		}
		return true
	case "pinned":
		if n.tags == nil {
			return false
		}
		tags, err := n.tags.SessionTags(sessionID)
		if err != nil {
			return false
		}
		return len(tags) > 0
	default: // "all"
		return true
	}
}

// EmitNotification broadcasts a single notification via the event bus.
func (n *Notifier) emitNotification(notification store.Notification, payload map[string]any) {
	if n.bus == nil {
		return
	}
	evt := map[string]any{
		"id":        notification.ID,
		"sessionId": notification.SessionID,
		"sourceId":  notification.SourceID,
		"kind":      notification.Kind,
		"title":     notification.Title,
		"preview":   notification.Preview,
		"severity":  notification.Severity,
		"createdAt": notification.CreatedAt,
		"payload":   payload,
	}
	data, err := json.Marshal(evt)
	if err != nil {
		slog.Warn("failed to marshal notification event", "error", err)
		return
	}
	n.bus.Send(sseEvent{Name: "notification", Data: string(data)})
}

// isActiveView reports whether the session was viewed recently enough to still
// count as actively viewed, evicting the entry once it ages out.
func (n *Notifier) isActiveView(sessionID string) bool {
	n.activeViewsMu.Lock()
	defer n.activeViewsMu.Unlock()
	last, ok := n.activeViews[sessionID]
	if !ok {
		return false
	}
	if time.Since(last) > activeViewWindow {
		delete(n.activeViews, sessionID)
		return false
	}
	return true
}
