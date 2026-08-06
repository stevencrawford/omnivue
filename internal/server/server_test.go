package server

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stevencrawford/omnivue/internal/ingest"
	"github.com/stevencrawford/omnivue/internal/notify"
	"github.com/stevencrawford/omnivue/internal/resumecmd"
	"github.com/stevencrawford/omnivue/internal/store"
	"github.com/stevencrawford/omnivue/version"
)

type mockAdapter struct {
	sessions []ingest.Session
	messages []ingest.Message

	// listCalls counts ListSessions invocations for cadence tests.
	listCalls atomic.Int64
	// liveUpdatedAt lets a test force ListSessions to return a fresh UpdatedAt
	// each call (simulating an actively-streaming session).
	liveUpdatedAt time.Time
}

func (m *mockAdapter) Type() ingest.AgentType  { return ingest.AgentOpenCode }
func (m *mockAdapter) Detect(path string) bool { return false }
func (m *mockAdapter) ListSessions(context.Context) ([]ingest.Session, error) {
	m.listCalls.Add(1)
	if !m.liveUpdatedAt.IsZero() {
		out := make([]ingest.Session, len(m.sessions))
		copy(out, m.sessions)
		for i := range out {
			out[i].UpdatedAt = m.liveUpdatedAt
		}
		return out, nil
	}
	return m.sessions, nil
}
func (m *mockAdapter) Session(ctx context.Context, id string) (*ingest.Session, error) {
	for _, s := range m.sessions {
		if s.ID == id {
			return &s, nil
		}
	}
	return nil, os.ErrNotExist
}
func (m *mockAdapter) Messages(context.Context, string) ([]ingest.Message, error) {
	return m.messages, nil
}
func (m *mockAdapter) Plan(context.Context, string) (*ingest.Plan, error)       { return nil, nil }
func (m *mockAdapter) Diffs(context.Context, string) ([]ingest.DiffFile, error) { return nil, nil }
func (m *mockAdapter) Edits(context.Context, string) ([]ingest.FileEdit, error) { return nil, nil }
func (m *mockAdapter) ResumeCommand() resumecmd.Spec {
	return resumecmd.Spec{Binary: "echo", Flag: "resume"}
}
func (m *mockAdapter) LastModified(context.Context) (int64, error) { return 0, nil }
func (m *mockAdapter) Close() error                                { return nil }

// tickingAdapter wraps mockAdapter and lets a test inject a LastModified
// implementation, so we can simulate a source that bumps on every call.
type tickingAdapter struct {
	mockAdapter
	lastModFn func() (int64, error)
}

func (a *tickingAdapter) LastModified(context.Context) (int64, error) {
	return a.lastModFn()
}

// doJSON performs a JSON request against the handler and decodes the response
// body into out, asserting the expected status. A nil body sends an empty
// request; out may be nil to skip decoding.
func doJSON(t *testing.T, mux http.Handler, method, path string, body any, wantStatus int, out any) {
	t.Helper()
	var rdr io.Reader
	if body != nil {
		data, err := json.Marshal(body)
		if err != nil {
			t.Fatal(err)
		}
		rdr = bytes.NewReader(data)
	}
	req, err := http.NewRequest(method, path, rdr)
	if err != nil {
		t.Fatal(err)
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if rec.Code != wantStatus {
		t.Fatalf("expected status %d, got %d (body: %s)", wantStatus, rec.Code, rec.Body.String())
	}
	if out != nil {
		if err := json.Unmarshal(rec.Body.Bytes(), out); err != nil {
			t.Fatalf("failed to decode response: %v (body: %s)", err, rec.Body.String())
		}
	}
}

func TestHandleStatus(t *testing.T) {
	dep := newFakeDep(map[string]ingest.Adapter{
		"src-1": &mockAdapter{sessions: []ingest.Session{{ID: "ses-1"}}},
	}, []ingest.Session{{ID: "ses-1", SourceID: "src-1"}})

	var body map[string]any
	doJSON(t, NewHandler(dep), http.MethodGet, "/_/api/status", nil, http.StatusOK, &body)
	if body["version"] != version.Version {
		t.Errorf("expected version %q, got %v", version.Version, body["version"])
	}
	if body["sessions"] != float64(1) {
		t.Errorf("expected 1 session, got %v", body["sessions"])
	}
}

func TestHandleSessions(t *testing.T) {
	sess := []ingest.Session{{ID: "ses-1", SourceID: "src-1", Title: "Test Session"}}
	dep := newFakeDep(map[string]ingest.Adapter{
		"src-1": &mockAdapter{sessions: sess},
	}, sess)

	var sessions []ingest.Session
	doJSON(t, NewHandler(dep), http.MethodGet, "/_/api/sessions", nil, http.StatusOK, &sessions)
	if len(sessions) != 1 || sessions[0].Title != "Test Session" {
		t.Fatalf("unexpected sessions: %+v", sessions)
	}
}

func TestHandleGetSession_NotFound(t *testing.T) {
	dep := newFakeDep(nil, nil)
	doJSON(t, NewHandler(dep), http.MethodGet, "/_/api/sessions/nonexistent", nil, http.StatusNotFound, nil)
}

func TestResolveSession_FallsBackToAdapterAndRegisters(t *testing.T) {
	adapter := &mockAdapter{
		sessions: []ingest.Session{{ID: "sub-1", ParentID: "par-1", Title: "Sub Agent"}},
		messages: []ingest.Message{{ID: "m1", Content: "hello"}},
	}
	hub := &SessionHub{
		adapters: map[string]ingest.Adapter{"src-1": adapter},
		sessions: []ingest.Session{{ID: "par-1", SourceID: "src-1"}},
	}

	ctx := context.Background()
	sess, got, err := hub.Resolve(ctx, "sub-1")
	if err != nil {
		t.Fatal(err)
	}
	if sess.ID != "sub-1" || got == nil || sess.SourceID != "src-1" {
		t.Fatalf("unexpected resolution: %+v (%v)", sess, got)
	}
	hub.mu.RLock()
	found := false
	for _, s := range hub.sessions {
		if s.ID == "sub-1" {
			found = true
		}
	}
	hub.mu.RUnlock()
	if !found {
		t.Error("expected fallback session to be registered in hub.sessions")
	}
	msgs, err := hub.Messages(ctx, "sub-1")
	if err != nil || len(msgs) != 1 || msgs[0].Content != "hello" {
		t.Errorf("expected message to be returned, got %d messages", len(msgs))
	}
	if _, err := hub.Session(ctx, "nonexistent"); err == nil {
		t.Error("expected error for nonexistent session")
	}
}

func TestResolveSession_FallbackEnrichesLivenessAndName(t *testing.T) {
	names := newFakeNameStore()
	if err := names.SetSessionName("sub-2", "Overridden Title"); err != nil {
		t.Fatal(err)
	}

	adapter := &mockAdapter{
		sessions: []ingest.Session{{ID: "sub-2", Title: "Raw Title", UpdatedAt: time.Now(), Status: ingest.SessionStatusCompleted}},
	}
	hub := &SessionHub{
		adapters: map[string]ingest.Adapter{"src-1": adapter},
		names:    names,
	}

	sess, _, err := hub.Resolve(context.Background(), "sub-2")
	if err != nil {
		t.Fatal(err)
	}
	if sess.Title != "Overridden Title" {
		t.Errorf("expected name override on fallback resolution, got %q", sess.Title)
	}
	if sess.Status != ingest.SessionStatusActive {
		t.Errorf("expected liveness heuristic to set status active, got %q", sess.Status)
	}
}

func TestResolveSession_CachedWithoutAdapterNotDuplicated(t *testing.T) {
	adapter := &mockAdapter{
		sessions: []ingest.Session{{ID: "cached-1", SourceID: "src-1", Title: "Cached"}},
	}
	hub := &SessionHub{
		adapters: map[string]ingest.Adapter{"src-1": adapter},
		sessions: []ingest.Session{{ID: "cached-1", SourceID: "gone"}},
	}

	sess, _, err := hub.Resolve(context.Background(), "cached-1")
	if err != nil {
		t.Fatal(err)
	}
	if sess.SourceID != "src-1" {
		t.Errorf("expected fallback source, got %q", sess.SourceID)
	}
	hub.mu.RLock()
	count := 0
	for _, s := range hub.sessions {
		if s.ID == "cached-1" {
			count++
		}
	}
	hub.mu.RUnlock()
	if count != 1 {
		t.Errorf("expected session not to be duplicated, found %d entries", count)
	}
}

func TestHandleTags_StoreUnavailable(t *testing.T) {
	dep := newFakeDep(nil, nil)
	var tags []store.Tag
	doJSON(t, NewHandler(dep), http.MethodGet, "/_/api/tags", nil, http.StatusOK, &tags)
	if len(tags) != 0 {
		t.Errorf("expected empty list, got %d", len(tags))
	}
}

func TestHandleSearch_EmptyQuery(t *testing.T) {
	hub := &SessionHub{adapters: make(map[string]ingest.Adapter)}
	dep := Dep{Hub: hub}
	doJSON(t, NewHandler(dep), http.MethodGet, "/_/api/search", nil, http.StatusOK, nil)
}

func TestRefreshSessions_ConcurrencySafe(t *testing.T) {
	hub := &SessionHub{
		adapters: map[string]ingest.Adapter{
			"src-1": &mockAdapter{sessions: []ingest.Session{{ID: "ses-1"}}},
			"src-2": &mockAdapter{sessions: []ingest.Session{{ID: "ses-2"}}},
		},
	}
	hub.refreshSessions(context.Background())
	if len(hub.Sessions()) != 2 {
		t.Fatalf("expected 2 sessions, got %d", len(hub.Sessions()))
	}
	ids := make(map[string]bool)
	for _, s := range hub.Sessions() {
		ids[s.ID] = true
	}
	if !ids["ses-1"] || !ids["ses-2"] {
		t.Error("expected both ses-1 and ses-2 to be present")
	}
}

func TestSessions_ReturnsCopy(t *testing.T) {
	hub := &SessionHub{sessions: []ingest.Session{{ID: "ses-1"}}}
	got := hub.Sessions()
	got[0].ID = "modified"
	if hub.Sessions()[0].ID != "ses-1" {
		t.Error("Sessions should return a copy, not a reference")
	}
}

func TestRefreshSessions_MarksLiveWithinWindow(t *testing.T) {
	now := time.Now()
	hub := &SessionHub{
		adapters: map[string]ingest.Adapter{
			"src-1": &mockAdapter{sessions: []ingest.Session{
				{ID: "ses-fresh", Status: ingest.SessionStatusCompleted, UpdatedAt: now.Add(-30 * time.Second)},
				{ID: "ses-stale", Status: ingest.SessionStatusCompleted, UpdatedAt: now.Add(-10 * time.Minute)},
			}},
		},
	}
	changed, live, _ := hub.refreshSessions(context.Background())
	if live != 1 {
		t.Errorf("expected 1 live session, got %d", live)
	}
	statusByID := map[string]ingest.SessionStatus{}
	for _, s := range hub.Sessions() {
		statusByID[s.ID] = s.Status
	}
	if statusByID["ses-fresh"] != ingest.SessionStatusActive || statusByID["ses-stale"] != ingest.SessionStatusCompleted {
		t.Errorf("unexpected statuses: %+v", statusByID)
	}
	if len(changed) != 2 {
		t.Errorf("expected 2 changed IDs on first refresh, got %d", len(changed))
	}
}

func TestRefreshSessions_RevertsToCompletedOutsideWindow(t *testing.T) {
	fresh := time.Now()
	hub := &SessionHub{
		adapters: map[string]ingest.Adapter{
			"src-1": &mockAdapter{sessions: []ingest.Session{
				{ID: "ses-1", Status: ingest.SessionStatusActive, UpdatedAt: fresh},
			}},
		},
		sessions: []ingest.Session{{ID: "ses-1", Status: ingest.SessionStatusActive, UpdatedAt: fresh}},
	}
	if ma, ok := hub.adapters["src-1"].(*mockAdapter); ok {
		ma.sessions[0].UpdatedAt = fresh.Add(-5 * time.Minute)
	}
	changed, live, _ := hub.refreshSessions(context.Background())
	if live != 0 {
		t.Errorf("expected 0 live sessions after staleness, got %d", live)
	}
	if hub.Sessions()[0].Status != ingest.SessionStatusCompleted {
		t.Errorf("expected status reverted to completed, got %q", hub.Sessions()[0].Status)
	}
	if len(changed) != 1 || changed[0] != "ses-1" {
		t.Errorf("expected ses-1 in changed IDs, got %v", changed)
	}
}

func TestRefreshSessions_StableSecondCallProducesNoChanges(t *testing.T) {
	adapter := &mockAdapter{sessions: []ingest.Session{
		{ID: "ses-1", Status: ingest.SessionStatusCompleted, UpdatedAt: time.Now().Add(-time.Minute)},
	}}
	hub := &SessionHub{adapters: map[string]ingest.Adapter{"src-1": adapter}}
	if _, live, _ := hub.refreshSessions(context.Background()); live != 1 {
		t.Fatalf("first refresh: expected 1 live, got %d", live)
	}
	changed, live, _ := hub.refreshSessions(context.Background())
	if live != 1 || len(changed) != 0 {
		t.Errorf("second refresh: expected 1 live and 0 changed, got live=%d changed=%v", live, changed)
	}
}

func TestEventBus_SendAndDelivery(t *testing.T) {
	bus := NewEventBus()
	ch := bus.Subscribe()
	defer bus.Unsubscribe(ch)

	data, err := json.Marshal(map[string]any{"ids": []string{"ses-1", "ses-2"}})
	if err != nil {
		t.Fatal(err)
	}
	bus.Send(sseEvent{Name: "session-changed", Data: string(data)})

	select {
	case ev := <-ch:
		if ev.Name != "session-changed" {
			t.Errorf("expected name session-changed, got %q", ev.Name)
		}
		var payload struct {
			IDs []string `json:"ids"`
		}
		if err := json.Unmarshal([]byte(ev.Data), &payload); err != nil {
			t.Fatalf("data is not valid JSON: %v", err)
		}
		if len(payload.IDs) != 2 || payload.IDs[0] != "ses-1" || payload.IDs[1] != "ses-2" {
			t.Errorf("unexpected ids payload: %v", payload.IDs)
		}
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for event")
	}
}

func TestPollInterval_PicksLiveCadenceWhenSessionIsActive(t *testing.T) {
	if got := pollInterval(0); got != pollCadenceIdle {
		t.Errorf("expected idle cadence with 0 live, got %s", got)
	}
	if got := pollInterval(1); got != pollCadenceLive {
		t.Errorf("expected live cadence with 1 live, got %s", got)
	}
	if got := pollInterval(42); got != pollCadenceLive {
		t.Errorf("expected live cadence with many live, got %s", got)
	}
}

// fakeAdapterProvider is an in-memory AdapterProvider for driving the Poller's
// source-watch logic through the seam, independently of the hub's real adapter
// set.
type fakeAdapterProvider struct {
	adapters map[string]ingest.Adapter
}

func (f *fakeAdapterProvider) Adapters() map[string]ingest.Adapter {
	return f.adapters
}

// TestPollerTick_ReadsSourcesThroughAdapterProvider pins the Poller to its
// AdapterProvider seam: the source-watch pass must read from the provider, not
// the concrete hub. The hub still registers a changing source, but the fake
// provider omits it, so a correct poller observes nothing and emits no events.
func TestPollerTick_ReadsSourcesThroughAdapterProvider(t *testing.T) {
	adapter := &tickingAdapter{
		mockAdapter: mockAdapter{
			sessions: []ingest.Session{{ID: "ses-live", SourceID: "src-1", UpdatedAt: time.Now().Add(-time.Minute)}},
		},
		lastModFn: func() (int64, error) { return 2, nil },
	}

	bus := NewEventBus()
	hub := &SessionHub{adapters: map[string]ingest.Adapter{"src-1": adapter}}
	notif := NewNotifier(hub, nil, nil, nil, bus)
	index := NewIndexer(hub, hub, nil, nil)
	// The provider the poller watches is empty, so the hub's changing source is
	// invisible to the watch pass.
	poller := NewPoller(&fakeAdapterProvider{adapters: map[string]ingest.Adapter{}}, newPipeline(hub, index, notif, bus))
	// Seed a previous observation for the source the poller cannot see.
	poller.lastMod["src-1"] = 1

	ch := bus.Subscribe()
	defer bus.Unsubscribe(ch)

	poller.tick(context.Background())

	// No source is visible through the provider, so no refresh/broadcast may fire.
	select {
	case ev := <-ch:
		t.Fatalf("expected no events when the provider sees no source, got %q", ev.Name)
	case <-time.After(100 * time.Millisecond):
	}
}

// TestPollPath drives the poll → refresh → SSE path synchronously through the
// Poller.tick method, without waiting on the 30s idle cadence. The indexer and
// notifier run as their own collaborators so the full pipeline is reachable
// without a live HTTP server.
func TestPollerTick_DrivesRefreshAndBroadcast(t *testing.T) {
	adapter := &tickingAdapter{
		mockAdapter: mockAdapter{
			sessions: []ingest.Session{{ID: "ses-live", SourceID: "src-1", UpdatedAt: time.Now().Add(-time.Minute)}},
		},
		lastModFn: func() (int64, error) { return 2, nil },
	}

	bus := NewEventBus()
	hub := &SessionHub{
		adapters: map[string]ingest.Adapter{"src-1": adapter},
	}
	notif := NewNotifier(hub, nil, nil, nil, bus)
	index := NewIndexer(hub, hub, nil, nil)
	poller := NewPoller(hub, newPipeline(hub, index, notif, bus))
	// Seed the previous observation so the next tick is a real change.
	poller.lastMod["src-1"] = 1

	ch := bus.Subscribe()
	defer bus.Unsubscribe(ch)

	poller.tick(context.Background())

	// We should observe at least the update event and a session-changed event.
	var sawUpdate, sawChanged bool
	deadline := time.After(time.Second)
	for !sawChanged {
		select {
		case ev := <-ch:
			if ev.Name == "update" {
				sawUpdate = true
			}
			if ev.Name == "session-changed" {
				var payload struct {
					IDs []string `json:"ids"`
				}
				if err := json.Unmarshal([]byte(ev.Data), &payload); err == nil {
					if len(payload.IDs) == 1 && payload.IDs[0] == "ses-live" {
						sawChanged = true
					}
				}
			}
		case <-deadline:
			t.Fatal("did not receive session-changed event in time")
		}
	}
	if !sawUpdate {
		t.Error("expected an update event to be broadcast")
	}
}

// TestPipelineRefresh_DrivesIndexAndClassify drives the full refresh → index →
// classify → SSE path through the Pipeline with a real store backing the
// Indexer and Notifier, synchronously. It asserts the indexed content is
// searchable and the classified notification is both persisted and broadcast.
// ATH-18: the pipeline is synchronous, so the assertions run immediately after
// Refresh returns instead of deadline-polling background goroutines.
func TestPipelineRefresh_DrivesIndexAndClassify(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("XDG_STATE_HOME", tmpDir)
	st, err := store.New()
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()

	now := time.Now()
	adapter := &mockAdapter{
		sessions: []ingest.Session{{ID: "ses-live", SourceID: "src-1", Title: "poll path", UpdatedAt: now}},
		messages: []ingest.Message{{
			ID: "m1", Content: "zephyr poll path marker", Timestamp: now,
			ToolCalls: []ingest.ToolCall{{ID: "tc-1", Name: "question", Status: "completed"}},
		}},
	}

	bus := NewEventBus()
	hub := &SessionHub{
		adapters: map[string]ingest.Adapter{"src-1": adapter},
	}
	index := NewIndexer(hub, hub, st, st)
	notif := NewNotifier(hub, st, st, st, bus)
	pipeline := newPipeline(hub, index, notif, bus)

	settings := notify.DefaultSettings()
	settings.Enabled = true
	settings.Kinds = []notify.Kind{notify.KindQuestion}
	settings.Scope = "all"
	if err := notif.SaveSettings(settings); err != nil {
		t.Fatal(err)
	}

	ch := bus.Subscribe()
	defer bus.Unsubscribe(ch)

	pipeline.Refresh(context.Background())

	// 1) A notification reached the SSE bus during the synchronous pass. The
	// "update" and "session-changed" events precede it, so drain until it shows.
	var sawNotification bool
	for !sawNotification {
		select {
		case ev := <-ch:
			if ev.Name == "notification" {
				sawNotification = true
			}
		case <-time.After(time.Second):
			t.Fatal("expected a notification SSE event from the refresh pass")
		}
	}

	// 2) The indexed message content is searchable in the real FTS store.
	results, err := st.Search("zephyr", 10, "")
	if err != nil {
		t.Fatal(err)
	}
	if len(results) == 0 {
		t.Fatal("expected indexed search results after refresh")
	}

	// 3) The notification was persisted in the real store.
	list, err := st.ListNotifications(50, false)
	if err != nil {
		t.Fatal(err)
	}
	if len(list) != 1 {
		t.Fatalf("expected 1 persisted notification, got %d", len(list))
	}
	if list[0].Kind != "question" {
		t.Errorf("expected kind question, got %s", list[0].Kind)
	}
}

// TestPipelineRefreshLiveness_BroadcastsOnlyOnChange pins the Pipeline's
// liveness pass: it broadcasts an "update" only when the live session count
// moved relative to the caller's previous observation, and stays quiet when
// nothing changed. The previous live count is caller-supplied, keeping the
// pipeline stateless and the test deterministic.
func TestPipelineRefreshLiveness_BroadcastsOnlyOnChange(t *testing.T) {
	adapter := &mockAdapter{
		sessions: []ingest.Session{{ID: "ses-live", SourceID: "src-1", UpdatedAt: time.Now().Add(-time.Minute)}},
	}

	bus := NewEventBus()
	hub := &SessionHub{adapters: map[string]ingest.Adapter{"src-1": adapter}}
	pipeline := newPipeline(hub, NewIndexer(hub, hub, nil, nil), NewNotifier(hub, nil, nil, nil, bus), bus)

	ch := bus.Subscribe()
	defer bus.Unsubscribe(ch)

	// First pass: previous live count 0, now 1 → a live session appeared.
	live := pipeline.RefreshLiveness(context.Background(), 0)
	if live != 1 {
		t.Fatalf("expected 1 live session, got %d", live)
	}
	select {
	case ev := <-ch:
		if ev.Name != "update" {
			t.Fatalf("expected an update event, got %q", ev.Name)
		}
	case <-time.After(time.Second):
		t.Fatal("expected an update event when the live count changed")
	}

	// Second pass: live count unchanged → no broadcast.
	live = pipeline.RefreshLiveness(context.Background(), live)
	if live != 1 {
		t.Fatalf("expected 1 live session, got %d", live)
	}
	select {
	case ev := <-ch:
		t.Fatalf("expected no events when the live count is unchanged, got %q", ev.Name)
	case <-time.After(100 * time.Millisecond):
	}
}

// TestPipeline_SerializesConcurrentRefreshPasses pins the ATH-18 follow-up: the
// "no overlap" guarantee between the poller goroutine and the handlers'
// `go p.Refresh(...)` calls is code-backed by the Pipeline mutex, not just by
// convention. Many goroutines refresh concurrently; the tracking search store
// fails if any two index passes interleave their store writes.
func TestPipeline_SerializesConcurrentRefreshPasses(t *testing.T) {
	now := time.Now()
	adapter := &mockAdapter{
		sessions: []ingest.Session{
			{ID: "ses-a", SourceID: "src-1", Title: "a", UpdatedAt: now},
			{ID: "ses-b", SourceID: "src-1", Title: "b", UpdatedAt: now},
			{ID: "ses-c", SourceID: "src-1", Title: "c", UpdatedAt: now},
		},
		messages: []ingest.Message{{ID: "m1", Content: "concurrent index marker", Timestamp: now}},
	}

	bus := NewEventBus()
	hub := &SessionHub{adapters: map[string]ingest.Adapter{"src-1": adapter}}
	search := newTrackingSearchStore()
	pipeline := newPipeline(hub, NewIndexer(hub, hub, search, nil), NewNotifier(hub, nil, nil, nil, bus), bus)

	const goroutines = 8
	start := make(chan struct{})
	var wg sync.WaitGroup
	for range goroutines {
		wg.Go(func() {
			<-start
			pipeline.Refresh(context.Background())
		})
	}
	close(start)
	wg.Wait()

	if max := search.maxConcurrent(); max != 1 {
		t.Fatalf("expected index passes to never overlap, observed %d concurrent writes", max)
	}
}

// --- Notification integration tests ---

func TestClassifyChanges_EmitsQuestionNotification(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("XDG_STATE_HOME", tmpDir)
	st, err := store.New()
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()

	bus := NewEventBus()
	sess := []ingest.Session{{ID: "ses-1", SourceID: "src-1", Status: ingest.SessionStatusActive}}
	reader := &fakeSessionReader{
		sessions: sess,
		messages: map[string][]ingest.Message{
			"ses-1": {{
				ID: "m1", Content: "q?", Timestamp: time.Now(),
				ToolCalls: []ingest.ToolCall{{ID: "tc-1", Name: "question", Status: "completed"}},
			}},
		},
	}
	notif := NewNotifier(reader, st, st, st, bus)

	settings := notify.DefaultSettings()
	settings.Enabled = true
	settings.Kinds = []notify.Kind{notify.KindQuestion}
	settings.Scope = "all"
	settings.ExcludeActiveView = false
	if err := notif.SaveSettings(settings); err != nil {
		t.Fatal(err)
	}

	notif.ClassifyChanges(context.Background(), []string{"ses-1"}, []statusTransition{{sessionID: "ses-1", from: "completed", to: "active"}})

	list, err := st.ListNotifications(50, false)
	if err != nil {
		t.Fatal(err)
	}
	if len(list) != 1 {
		t.Fatalf("expected 1 notification, got %d", len(list))
	}
	if list[0].Kind != "question" {
		t.Errorf("expected kind question, got %s", list[0].Kind)
	}
}

func TestClassifyChanges_ExcludeActiveView(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("XDG_STATE_HOME", tmpDir)
	st, err := store.New()
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()

	bus := NewEventBus()
	sess := []ingest.Session{{ID: "ses-1", SourceID: "src-1", Status: ingest.SessionStatusActive}}
	reader := &fakeSessionReader{
		sessions: sess,
		messages: map[string][]ingest.Message{
			"ses-1": {{
				ID: "m1", Content: "q?", Timestamp: time.Now(),
				ToolCalls: []ingest.ToolCall{{ID: "tc-1", Name: "question", Status: "completed"}},
			}},
		},
	}
	notif := NewNotifier(reader, st, st, st, bus)

	settings := notify.DefaultSettings()
	settings.Enabled = true
	settings.Kinds = []notify.Kind{notify.KindQuestion}
	settings.Scope = "all"
	settings.ExcludeActiveView = true
	if err := notif.SaveSettings(settings); err != nil {
		t.Fatal(err)
	}

	notif.ReportActiveView("ses-1")
	notif.ClassifyChanges(context.Background(), []string{"ses-1"}, nil)

	list, err := st.ListNotifications(50, false)
	if err != nil {
		t.Fatal(err)
	}
	if len(list) != 0 {
		t.Fatalf("expected 0 notifications for an actively-viewed session, got %d", len(list))
	}
}

func TestHandleListNotifications_StoreUnavailable(t *testing.T) {
	dep := newFakeDep(nil, nil)

	var list []store.Notification
	doJSON(t, NewHandler(dep), http.MethodGet, "/_/api/notifications", nil, http.StatusOK, &list)
	if len(list) != 0 {
		t.Errorf("expected empty list, got %d", len(list))
	}
}

func TestHandleNotifySettings_RoundTrip(t *testing.T) {
	dep := newFakeDep(nil, nil)

	// GET defaults.
	var defaults notify.Settings
	doJSON(t, NewHandler(dep), http.MethodGet, "/_/api/notifications/settings", nil, http.StatusOK, &defaults)
	if defaults.Enabled {
		t.Error("expected disabled by default")
	}

	// PUT enabled.
	var saved notify.Settings
	doJSON(t, NewHandler(dep), http.MethodPut, "/_/api/notifications/settings", notify.Settings{
		Enabled: true, Kinds: []notify.Kind{notify.KindQuestion}, Scope: "all",
		InAppToast: true, SidebarBadge: true,
	}, http.StatusOK, &saved)
	if !saved.Enabled {
		t.Error("expected saved settings to be enabled")
	}
	if saved.EnabledAt == 0 {
		t.Error("expected EnabledAt to be stamped on first enable")
	}
}

func TestHandleGetResumeCommand(t *testing.T) {
	dep := newFakeDep(map[string]ingest.Adapter{
		"src-1": &mockAdapter{
			sessions: []ingest.Session{{ID: "ses-1", Directory: "/tmp/proj"}},
		},
	}, []ingest.Session{{ID: "ses-1", SourceID: "src-1", Directory: "/tmp/proj"}})

	var resp map[string]string
	doJSON(t, NewHandler(dep), http.MethodGet, "/_/api/sessions/ses-1/resume", nil, http.StatusOK, &resp)
	if resp["directory"] != "/tmp/proj" {
		t.Errorf("expected directory /tmp/proj, got %q", resp["directory"])
	}
	if resp["absolute"] != "cd /tmp/proj && echo resume ses-1" {
		t.Errorf("expected absolute cd /tmp/proj && echo resume ses-1, got %q", resp["absolute"])
	}
	if resp["relative"] != "echo resume ses-1" {
		t.Errorf("expected relative echo resume ses-1, got %q", resp["relative"])
	}
	if resp["agentCommand"] != "/resume ses-1" {
		t.Errorf("expected agentCommand /resume ses-1, got %q", resp["agentCommand"])
	}
}

// --- Fake role store (ATH-02 seam) ---

type fakeTagStore struct {
	tags map[string]store.Tag
}

func (f *fakeTagStore) CreateTag(t store.Tag) error {
	if f.tags == nil {
		f.tags = map[string]store.Tag{}
	}
	f.tags[t.Name] = t
	return nil
}
func (f *fakeTagStore) ListTags() ([]store.Tag, error) {
	out := make([]store.Tag, 0, len(f.tags))
	for _, t := range f.tags {
		out = append(out, t)
	}
	return out, nil
}
func (f *fakeTagStore) UpdateTag(id, name, color string) error  { return nil }
func (f *fakeTagStore) DeleteTag(id string) error               { return nil }
func (f *fakeTagStore) AssignTag(tagID, sessionID string) error { return nil }
func (f *fakeTagStore) UnassignTag(tagID, sessionID string) error {
	return nil
}
func (f *fakeTagStore) TagSessions(tagID string) ([]string, error) { return nil, nil }
func (f *fakeTagStore) SessionTags(sessionID string) ([]store.Tag, error) {
	return nil, nil
}

func TestHandleCreateTag_FakeStore(t *testing.T) {
	dep := newTestDep(t, &fakeTagStore{})
	var tag store.Tag
	doJSON(t, NewHandler(dep), http.MethodPost, "/_/api/tags", map[string]string{"name": "backend"}, http.StatusCreated, &tag)
	if tag.Name != "backend" {
		t.Errorf("expected name backend, got %q", tag.Name)
	}
}

func newTestDep(_ *testing.T, tags store.TagStore) Dep {
	bus := NewEventBus()
	hub := &SessionHub{adapters: make(map[string]ingest.Adapter)}
	dep := newDep(newPipeline(hub, NewIndexer(hub, hub, nil, nil), NewNotifier(hub, nil, nil, nil, bus), bus), storeRolesOf(nil))
	dep.Tags = tags
	return dep
}

// TestHandleCreateBookmark_Kind verifies plan bookmarks are created with their
// kind, that a missing kind defaults to 'message', that an invalid kind is
// rejected, and that creating the same ref again toggles it off.
func TestHandleCreateBookmark_Kind(t *testing.T) {
	dep := newTestDep(t, &fakeTagStore{})
	fakes := newFakeBookmarkStore()
	dep.Bookmarks = fakes

	var bm store.Bookmark
	doJSON(t, NewHandler(dep), http.MethodPost, "/_/api/bookmarks",
		map[string]any{
			"sessionId": "s-1", "messageIndex": -1, "label": "Plan", "kind": "plan",
		},
		http.StatusCreated, &bm)
	if bm.Kind != "plan" {
		t.Errorf("expected kind plan, got %q", bm.Kind)
	}
	if bm.MessageIndex != -1 {
		t.Errorf("expected messageIndex -1, got %d", bm.MessageIndex)
	}

	doJSON(t, NewHandler(dep), http.MethodPost, "/_/api/bookmarks",
		map[string]any{
			"sessionId": "s-2", "messageIndex": 0, "toolCallId": "tc-1", "label": "Output",
		},
		http.StatusCreated, &bm)
	if bm.Kind != "message" {
		t.Errorf("expected default kind message, got %q", bm.Kind)
	}

	doJSON(t, NewHandler(dep), http.MethodPost, "/_/api/bookmarks",
		map[string]any{
			"sessionId": "s-1", "messageIndex": -1, "label": "Plan", "kind": "scratch",
		},
		http.StatusBadRequest, nil)

	// Same ref again toggles off (deletes the plan bookmark created above).
	var toggled map[string]any
	doJSON(t, NewHandler(dep), http.MethodPost, "/_/api/bookmarks",
		map[string]any{
			"sessionId": "s-1", "messageIndex": -1, "label": "Plan", "kind": "plan",
		},
		http.StatusOK, &toggled)
	if toggled["deleted"] != true {
		t.Errorf("expected toggle to delete, got %v", toggled)
	}
	if len(fakes.bookmarks) != 1 {
		t.Errorf("expected 1 bookmark after toggle, got %d", len(fakes.bookmarks))
	}
} // TestStoreRoles_NilStoreStaysNil guards against boxing a typed-nil *store.Store
// into the role interfaces: an interface wrapping a nil pointer is non-nil, so
// every `!= nil` guard would pass and the call would panic on the nil receiver.
func TestStoreRoles_NilStoreStaysNil(t *testing.T) {
	dep := newDep(newPipeline(nil, nil, nil, NewEventBus()), storeRolesOf(nil))
	for name, v := range map[string]any{
		"Sources":   dep.Sources,
		"Tags":      dep.Tags,
		"Bookmarks": dep.Bookmarks,
		"Scratch":   dep.Scratch,
		"Config":    dep.Config,
		"Notifs":    dep.Notifs,
		"Prompts":   dep.Prompts,
		"Search":    dep.Search,
		"Meta":      dep.Meta,
		"Reset":     dep.Reset,
	} {
		if v != nil {
			t.Errorf("expected %s to be nil with no store, got %v", name, v)
		}
	}
}

// TestHandleSetConfig_StoreUnavailable_NoPanic exercises a write handler with a
// genuinely-nil store role: it must return 500 "store not available" instead of
// panicking on the nil receiver.
func TestHandleSetConfig_StoreUnavailable_NoPanic(t *testing.T) {
	dep := newDep(newPipeline(nil, nil, nil, NewEventBus()), storeRolesOf(nil))
	doJSON(t, NewHandler(dep), http.MethodPut, "/_/api/config",
		map[string]string{"key": "k", "value": "v"}, http.StatusInternalServerError, nil)
}

// TestIndexer_IndexSessions drives the Indexer through its SessionCatalog +
// SessionReader seam (no hub, no adapter) against a real store, asserting the
// message content lands in the FTS index. This exercises the collapsed
// single-path indexing after the hub-role split.
func TestIndexer_IndexSessions(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("XDG_STATE_HOME", tmpDir)
	st, err := store.New()
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()

	now := time.Now()
	catalog := &fakeSessionCatalog{
		sessions: []ingest.Session{{ID: "ses-1", SourceID: "src-1", Repository: "r1", Title: "idx me", UpdatedAt: now}},
	}
	reader := &fakeSessionReader{
		sessions: catalog.sessions,
		messages: map[string][]ingest.Message{
			"ses-1": {{ID: "m1", Content: "unique idx marker", Timestamp: now}},
		},
	}

	ix := NewIndexer(catalog, reader, st, st)
	ix.IndexSessions(context.Background())

	results, err := st.Search("unique", 10, "")
	if err != nil {
		t.Fatal(err)
	}
	if len(results) == 0 {
		t.Fatal("expected indexed search results")
	}
	if results[0].SessionID != "ses-1" {
		t.Errorf("expected index row for ses-1, got %s", results[0].SessionID)
	}
}

// TestIndexer_ReindexSessionScratch exercises the scratch-only reindex path,
// which resolves sourceID/repository through the SessionReader instead of a
// linear scan of the cached session list.
func TestIndexer_ReindexSessionScratch(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("XDG_STATE_HOME", tmpDir)
	st, err := store.New()
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()

	now := time.Now()
	catalog := &fakeSessionCatalog{
		sessions: []ingest.Session{{ID: "ses-1", SourceID: "src-1", Repository: "r1", Title: "s", UpdatedAt: now}},
	}
	if err := st.CreateScratchFile(store.ScratchFile{
		SessionID: "ses-1", ID: "sc-1", Title: "note", Content: "scratch reindex marker",
	}); err != nil {
		t.Fatal(err)
	}
	reader := &fakeSessionReader{
		sessions: catalog.sessions,
		messages: map[string][]ingest.Message{"ses-1": nil},
	}

	ix := NewIndexer(catalog, reader, st, st)
	ix.ReindexSessionScratch("ses-1")

	results, err := st.Search("scratch", 10, "")
	if err != nil {
		t.Fatal(err)
	}
	if len(results) == 0 {
		t.Fatal("expected scratch content indexed")
	}
}
