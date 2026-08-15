package server

import (
	"context"
	"log/slog"
	"maps"
	"sync"
	"time"

	"github.com/stevencrawford/omnivue/internal/ingest"
	"github.com/stevencrawford/omnivue/internal/store"
)

// SessionHub owns the cached session list and the collection of adapters,
// and is the single seam through which callers query or mutate session data.
// Query methods that call into an adapter release the lock before the call to
// avoid RLock → Lock deadlocks.
type SessionHub struct {
	mu       sync.RWMutex
	sessions []ingest.Session
	adapters map[string]ingest.Adapter

	// names persists session display-name overrides used during refresh.
	names store.SessionNameStore
}

func NewSessionHub(names store.SessionNameStore) *SessionHub {
	return &SessionHub{
		adapters: make(map[string]ingest.Adapter),
		names:    names,
	}
}

// Adapters returns a copy of the adapter map.
func (h *SessionHub) Adapters() map[string]ingest.Adapter {
	h.mu.RLock()
	defer h.mu.RUnlock()
	out := make(map[string]ingest.Adapter, len(h.adapters))
	maps.Copy(out, h.adapters)
	return out
}

// AddAdapter registers an adapter for a source id.
func (h *SessionHub) AddAdapter(sourceID string, adapter ingest.Adapter) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.adapters[sourceID] = adapter
}

// RemoveAdapter closes and removes the adapter for a source id.
func (h *SessionHub) RemoveAdapter(sourceID string) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if adapter, ok := h.adapters[sourceID]; ok {
		adapter.Close()
		delete(h.adapters, sourceID)
	}
}

// CloseAdapters closes every registered adapter and clears the cache.
func (h *SessionHub) CloseAdapters() {
	h.mu.Lock()
	defer h.mu.Unlock()
	for id, adapter := range h.adapters {
		adapter.Close()
		delete(h.adapters, id)
	}
	h.sessions = nil
}

// Sessions returns a copy of the cached session list.
func (h *SessionHub) Sessions() []ingest.Session {
	h.mu.RLock()
	defer h.mu.RUnlock()
	result := make([]ingest.Session, len(h.sessions))
	copy(result, h.sessions)
	return result
}

// TitleMap returns a map of session id → display title for the current cache.
func (h *SessionHub) TitleMap() map[string]string {
	h.mu.RLock()
	defer h.mu.RUnlock()
	titles := make(map[string]string, len(h.sessions))
	for _, sess := range h.sessions {
		titles[sess.ID] = sess.Title
	}
	return titles
}

// Session returns a single session by ID.
func (h *SessionHub) Session(ctx context.Context, id string) (*ingest.Session, error) {
	sess, _, err := h.Resolve(ctx, id)
	if err != nil {
		return nil, err
	}
	return sess, nil
}

// Resolve finds the session and the adapter that owns it. It consults the
// cached session list first, then falls back to querying each adapter directly
// so sessions absent from the cache (e.g. freshly-created sub-agent or research
// report sessions) can still be resolved.
func (h *SessionHub) Resolve(ctx context.Context, id string) (*ingest.Session, ingest.Adapter, error) {
	h.mu.RLock()
	var found *ingest.Session
	var adapter ingest.Adapter
	for i := range h.sessions {
		if h.sessions[i].ID == id {
			found = &h.sessions[i]
			adapter = h.adapters[found.SourceID]
			break
		}
	}
	adapters := make(map[string]ingest.Adapter, len(h.adapters))
	maps.Copy(adapters, h.adapters)
	h.mu.RUnlock()

	if found != nil && adapter != nil {
		return found, adapter, nil
	}

	for sourceID, candidate := range adapters {
		sess, err := candidate.Session(ctx, id)
		if err != nil {
			slog.Debug("adapter failed to resolve session", "source", sourceID, "session_id", id, "error", err)
			continue
		}
		if sess == nil {
			continue
		}
		sess.SourceID = sourceID
		enrichSession(sess, h.names)
		// Only append to the cache when the session was genuinely absent; a
		// cached-but-adapter-less session must not be duplicated.
		if found == nil {
			h.mu.Lock()
			h.sessions = append(h.sessions, *sess)
			h.mu.Unlock()
		}
		return sess, candidate, nil
	}
	return nil, nil, notFound("session not found: " + id)
}

// enrichSession applies the liveness heuristic and display-name override that
// the refresh path uses, so a fallback-resolved session behaves identically to
// one surfaced by a normal poll.
func enrichSession(sess *ingest.Session, names store.SessionNameStore) {
	applyLiveness(sess)
	if names != nil {
		if name, err := names.SessionName(sess.ID); err == nil && name != "" {
			sess.Title = name
		}
	}
}

// applyLiveness flips a session's status between active and completed based on
// the liveWindow heuristic, returning whether the session is currently live.
// Shared by enrichSession and refreshSessions so the two paths cannot drift.
func applyLiveness(sess *ingest.Session) bool {
	if !sess.UpdatedAt.IsZero() && time.Since(sess.UpdatedAt) < liveWindow {
		if sess.Status != ingest.SessionStatusActive {
			sess.Status = ingest.SessionStatusActive
		}
		return true
	}
	if sess.Status == ingest.SessionStatusActive {
		sess.Status = ingest.SessionStatusCompleted
	}
	return false
}

// Messages returns messages for a session.
func (h *SessionHub) Messages(ctx context.Context, sessionID string) ([]ingest.Message, error) {
	_, adapter, err := h.Resolve(ctx, sessionID)
	if err != nil {
		return nil, err
	}
	msgs, err := adapter.Messages(ctx, sessionID)
	if err != nil {
		return nil, err
	}
	return ingest.WithPositions(msgs), nil
}

// Plan returns the plan for a session.
func (h *SessionHub) Plan(ctx context.Context, sessionID string) (*ingest.Plan, error) {
	_, adapter, err := h.Resolve(ctx, sessionID)
	if err != nil {
		return nil, err
	}
	if ps, ok := adapter.(ingest.Planner); ok {
		return ps.Plan(ctx, sessionID)
	}
	return nil, nil
}

// Diffs returns file diffs for a session.
func (h *SessionHub) Diffs(ctx context.Context, sessionID string) ([]ingest.DiffFile, error) {
	_, adapter, err := h.Resolve(ctx, sessionID)
	if err != nil {
		return nil, err
	}
	if ds, ok := adapter.(ingest.Differ); ok {
		return ds.Diffs(ctx, sessionID)
	}
	return []ingest.DiffFile{}, nil
}

// Edits returns raw edit tool call data for a session.
func (h *SessionHub) Edits(ctx context.Context, sessionID string) ([]ingest.FileEdit, error) {
	_, adapter, err := h.Resolve(ctx, sessionID)
	if err != nil {
		return nil, err
	}
	if es, ok := adapter.(ingest.Editor); ok {
		return es.Edits(ctx, sessionID)
	}
	return []ingest.FileEdit{}, nil
}

// ResumeCommand returns the CLI resume data for a session.
func (h *SessionHub) ResumeCommand(ctx context.Context, sessionID string) (*ResumeSpec, error) {
	sess, adapter, err := h.Resolve(ctx, sessionID)
	if err != nil {
		return nil, err
	}
	spec := adapter.ResumeCommand()
	return &ResumeSpec{
		Directory:    sess.Directory,
		Command:      spec.Command(sess.Directory, sess.ID),
		CommandNoCD:  spec.CommandNoCD(sess.ID),
		AgentCommand: spec.AgentCommand(sess.ID),
	}, nil
}

// SetName applies a display-name override and updates the cached session list
// so the change takes effect immediately.
func (h *SessionHub) SetName(sessionID, displayName string) error {
	if h.names != nil {
		if err := h.names.SetSessionName(sessionID, displayName); err != nil {
			return err
		}
	}
	h.mu.Lock()
	for i := range h.sessions {
		if h.sessions[i].ID == sessionID {
			h.sessions[i].Title = displayName
			break
		}
	}
	h.mu.Unlock()
	return nil
}

// ClearName removes a display name override.
func (h *SessionHub) ClearName(sessionID string) error {
	if h.names != nil {
		if err := h.names.ClearSessionName(sessionID); err != nil {
			return err
		}
	}
	h.mu.Lock()
	for i := range h.sessions {
		if h.sessions[i].ID == sessionID {
			h.sessions[i].Title = ""
			break
		}
	}
	h.mu.Unlock()
	return nil
}

// refreshSessions re-reads the session list from every adapter, applies the
// liveness heuristic (sets Status="active" when UpdatedAt is within liveWindow),
// and returns the set of session IDs whose UpdatedAt changed since the last
// refresh plus the total live count.
func (h *SessionHub) refreshSessions(ctx context.Context) (changedIDs []string, liveCount int, transitions []statusTransition) {
	h.mu.RLock()
	adapters := make(map[string]ingest.Adapter, len(h.adapters))
	maps.Copy(adapters, h.adapters)
	prev := make(map[string]time.Time, len(h.sessions))
	prevStatus := make(map[string]string, len(h.sessions))
	for _, sess := range h.sessions {
		prev[sess.ID] = sess.UpdatedAt
		prevStatus[sess.ID] = string(sess.Status)
	}
	names := h.names
	h.mu.RUnlock()

	var allSessions []ingest.Session
	for sourceID, adapter := range adapters {
		start := time.Now()
		sessions, err := adapter.ListSessions(ctx)
		if err != nil {
			slog.Warn("failed to list sessions", "source", sourceID, "error", err)
			continue
		}
		slog.Debug("listed source sessions", "source", sourceID, "count", len(sessions), "ms", time.Since(start).Milliseconds())
		for i := range sessions {
			sessions[i].SourceID = sourceID
			// Liveness heuristic: a session is "active" if its last update is
			// within liveWindow. We override whatever the adapter hardcoded so
			// the frontend gets a single source of truth.
			if applyLiveness(&sessions[i]) {
				liveCount++
			}
		}
		allSessions = append(allSessions, sessions...)
	}

	// Propagate "active" status and latest UpdatedAt from children to parents
	// so parent sessions reflect sub-agent activity and don't appear "stuck".
	propagateActive(allSessions)

	// Filter out Copilot sessions with no messages (e.g. sessions created on CLI launch).
	filtered := allSessions[:0]
	for _, sess := range allSessions {
		if sess.Agent == ingest.AgentCopilot && sess.MessageCount == 0 {
			continue
		}
		filtered = append(filtered, sess)
	}
	allSessions = filtered

	// Apply display name overrides.
	if names != nil {
		overrides, err := names.AllSessionNames()
		if err == nil {
			for i := range allSessions {
				if name, ok := overrides[allSessions[i].ID]; ok {
					allSessions[i].Title = name
				}
			}
		}
	}

	// Diff against the previous snapshot to identify sessions whose content
	// has changed since the last refresh.
	for _, sess := range allSessions {
		if prevTime, ok := prev[sess.ID]; !ok || !sess.UpdatedAt.Equal(prevTime) {
			changedIDs = append(changedIDs, sess.ID)
		}
		if old, ok := prevStatus[sess.ID]; ok && old != string(sess.Status) {
			transitions = append(transitions, statusTransition{sessionID: sess.ID, from: old, to: string(sess.Status)})
		}
	}

	// Also include parent IDs in changedIDs when a child changed, so the
	// frontend re-fetches the parent's hub view with updated child data.
	changedSet := make(map[string]struct{}, len(changedIDs))
	for _, id := range changedIDs {
		changedSet[id] = struct{}{}
	}
	for _, sess := range allSessions {
		if sess.ParentID != "" {
			if _, ok := changedSet[sess.ID]; ok {
				if _, ok := changedSet[sess.ParentID]; !ok {
					changedIDs = append(changedIDs, sess.ParentID)
					changedSet[sess.ParentID] = struct{}{}
				}
			}
		}
	}

	h.mu.Lock()
	h.sessions = allSessions
	h.mu.Unlock()
	return changedIDs, liveCount, transitions
}

// propagateChildren marks a parent session active when any descendant is
// active, so parent sessions reflect sub-agent activity.
func propagateActive(allSessions []ingest.Session) {
	childMap := make(map[string][]*ingest.Session)
	for i := range allSessions {
		if allSessions[i].ParentID != "" {
			childMap[allSessions[i].ParentID] = append(childMap[allSessions[i].ParentID], &allSessions[i])
		}
	}
	var propagate func(id string) bool
	propagate = func(id string) bool {
		children := childMap[id]
		if len(children) == 0 {
			return false
		}
		anyActive := false
		for _, c := range children {
			if c.Status == ingest.SessionStatusActive {
				anyActive = true
			}
			if propagate(c.ID) {
				anyActive = true
			}
		}
		if anyActive {
			for i := range allSessions {
				if allSessions[i].ID == id {
					if allSessions[i].Status != ingest.SessionStatusActive {
						allSessions[i].Status = ingest.SessionStatusActive
					}
					break
				}
			}
		}
		return anyActive
	}
	for i := range allSessions {
		propagate(allSessions[i].ID)
	}
}

// statusTransition records a single session status change detected during a
// refresh, used by notification classification.
type statusTransition struct {
	sessionID string
	from      string
	to        string
}
