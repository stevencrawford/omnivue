package server

import (
	"context"
	"encoding/json"
	"log/slog"
	"sync"

	"github.com/stevencrawford/omnivue/internal/ingest"
	"github.com/stevencrawford/omnivue/internal/store"
)

// Dep bundles the collaborators and narrowed role interfaces an HTTP handler
// may need. It is the wiring seam between the server lifecycle and the handler
// set; individual handlers read only the slices they serve. Store-backed
// endpoints operate on distinct role interfaces (ATH-02), so no handler ever
// reaches for a monolithic store.
type Dep struct {
	Hub      *SessionHub
	Indexer  *Indexer
	Notifier *Notifier
	Bus      *EventBus
	Pipeline *Pipeline

	Sources   store.SourceStore
	Tags      store.TagStore
	Bookmarks store.BookmarkStore
	Scratch   store.ScratchStore
	Config    store.ConfigStore
	Notifs    store.NotificationStore
	Prompts   store.PromptStore
	Search    store.SearchStore
	Meta      store.SchemaVersioner
	Reset     store.Resetter

	// Shutdown and Restart signal the parent process to act on these events.
	Shutdown func()
	Restart  func(string)
}

// State is the thin process-level facade returned by NewState. It owns the
// collaborators and the lifecycle signals, starts the poller, and holds the
// Dep used to wire handlers. It is intentionally not the object handlers
// execute against.
type State struct {
	dep     Dep
	stop    context.CancelFunc
	stateCh *lifecycle
}

// lifecycle carries the process-level signal channels shared between State and
// the shutdown/restart handlers.
type lifecycle struct {
	shutdownCh chan struct{}
	restartCh  chan string
}

// NewState builds the SessionHub, Indexer, Notifier, Poller, and EventBus,
// loads configured sources, and begins background polling.
func NewState(ctx context.Context) *State {
	st, err := store.New()
	if err != nil {
		slog.Error("failed to open store", "error", err)
		st = nil
	}
	roles := storeRolesOf(st)

	bus := NewEventBus()
	hub := NewSessionHub(roles.names)
	index := NewIndexer(hub, hub, roles.search, roles.scratch)
	notif := NewNotifier(hub, roles.notifs, roles.config, roles.tags, bus)
	p := newPipeline(hub, index, notif, bus)
	poller := NewPoller(hub, p)

	// Load configured sources and create adapters.
	if st != nil {
		sources, lerr := st.ListSources()
		if lerr != nil {
			slog.Error("failed to list sources", "error", lerr)
		} else {
			for _, src := range sources {
				if !src.Enabled {
					continue
				}
				adapter, aerr := ingest.CreateAdapter(src)
				if aerr != nil {
					slog.Warn("failed to create adapter", "source", src.Path, "error", aerr)
					continue
				}
				hub.AddAdapter(src.ID, adapter)
				slog.Info("loaded source", "type", src.AgentType, "path", src.Path)
			}
		}
	}

	shutdownCh := make(chan struct{}, 1)
	restartCh := make(chan string, 1)

	dep := newDep(p, roles)
	dep.Shutdown = func() {
		select {
		case shutdownCh <- struct{}{}:
		default:
		}
	}
	dep.Restart = func(restoreFile string) { restartCh <- restoreFile }

	s := &State{
		dep:     dep,
		stateCh: &lifecycle{shutdownCh: shutdownCh, restartCh: restartCh},
	}

	// Initial session load and indexing (background, non-blocking).
	go p.Refresh(ctx)

	// Start poller.
	pollCtx, pollCancel := context.WithCancel(ctx)
	s.stop = pollCancel
	go poller.Run(pollCtx)

	return s
}

// Deps returns the handler wiring for this State.
func (s *State) Deps() Dep { return s.dep }

// storeRoles bundles the narrowed store role interfaces (ATH-02) so a nil
// store is never boxed into an interface: storeRolesOf returns all-nil roles
// when the store failed to open, keeping handlers' `!= nil` guards honest. A
// typed-nil *store.Store stored into an interface is non-nil, which would make
// every guard pass and every call panic on the nil receiver.
type storeRoles struct {
	sources   store.SourceStore
	tags      store.TagStore
	bookmarks store.BookmarkStore
	scratch   store.ScratchStore
	config    store.ConfigStore
	notifs    store.NotificationStore
	prompts   store.PromptStore
	search    store.SearchStore
	meta      store.SchemaVersioner
	reset     store.Resetter
	names     store.SessionNameStore
}

// storeRolesOf derives the role interfaces from a concrete store, or all-nil
// interfaces when the store is unavailable.
func storeRolesOf(st *store.Store) storeRoles {
	if st == nil {
		return storeRoles{}
	}
	return storeRoles{
		sources:   st,
		tags:      st,
		bookmarks: st,
		scratch:   st,
		config:    st,
		notifs:    st,
		prompts:   st,
		search:    st,
		meta:      st,
		reset:     st,
		names:     st,
	}
}

// Pipeline is the session refresh pipeline: the single module that turns a
// session refresh into a re-index, an SSE broadcast, and a notification pass.
// Both poll cadences and the HTTP add/update/remove-source handlers cross its
// seam, so the refresh→broadcast orchestration lives in exactly one place.
// Pipeline methods are synchronous; callers own concurrency (the Poller runs
// in its own goroutine, handlers wrap calls in `go`). mu serializes the whole
// pass so refresh → index → classify → broadcast cannot overlap across
// callers: the poller goroutine and any in-flight handler refresh all line up
// behind a single lock, and index passes are provably non-overlapping.
type Pipeline struct {
	mu      sync.Mutex
	hub     *SessionHub
	indexer *Indexer
	notif   *Notifier
	bus     *EventBus
}

// newPipeline builds the session refresh pipeline.
func newPipeline(hub *SessionHub, indexer *Indexer, notif *Notifier, bus *EventBus) *Pipeline {
	return &Pipeline{hub: hub, indexer: indexer, notif: notif, bus: bus}
}

// Refresh runs a full refresh pass: re-read sessions from every adapter,
// broadcast "update" + "session-changed" so clients can discover the fresh
// cache immediately, then re-index search content and classify notifications.
// It returns the current live session count so the Poller can adapt its
// cadence.
func (p *Pipeline) Refresh(ctx context.Context) (liveCount int) {
	p.mu.Lock()
	defer p.mu.Unlock()
	ids, liveCount, transitions := p.hub.refreshSessions(ctx)

	// Broadcast right after the refresh: the hub cache that /api/sessions
	// serves is already populated, so clients must not wait on the heavier
	// index + classify passes before their session list appears.
	p.bus.Send(sseEvent{Name: "update"})
	if len(ids) > 0 {
		data, err := json.Marshal(map[string]any{"ids": ids})
		if err != nil {
			slog.Warn("failed to marshal session change event", "error", err)
		} else {
			p.bus.Send(sseEvent{Name: "session-changed", Data: string(data)})
		}
	}

	p.indexer.IndexSessions(ctx)
	p.notif.ClassifyChanges(ctx, ids, transitions)
	return liveCount
}

// RefreshLiveness refreshes and broadcasts only liveness/status changes: when
// the live session count moved (e.g. a session went idle), it pushes an
// "update" pulse and classifies any status transitions, without re-indexing or
// emitting a session-changed event. prevLive is the caller's last-known live
// count; the returned value is the current one. This absorbs what used to be
// the Poller's hand-rolled idle branch so both cadences share the pipeline.
func (p *Pipeline) RefreshLiveness(ctx context.Context, prevLive int) (liveCount int) {
	p.mu.Lock()
	defer p.mu.Unlock()
	_, liveCount, transitions := p.hub.refreshSessions(ctx)
	if liveCount == prevLive {
		return liveCount
	}
	p.bus.Send(sseEvent{Name: "update"})
	if len(transitions) > 0 {
		ids := make([]string, 0, len(transitions))
		for _, t := range transitions {
			ids = append(ids, t.sessionID)
		}
		p.notif.ClassifyChanges(ctx, ids, transitions)
	}
	return liveCount
}

func newDep(p *Pipeline, roles storeRoles) Dep {
	return Dep{
		Hub:       p.hub,
		Indexer:   p.indexer,
		Notifier:  p.notif,
		Bus:       p.bus,
		Pipeline:  p,
		Sources:   roles.sources,
		Tags:      roles.tags,
		Bookmarks: roles.bookmarks,
		Scratch:   roles.scratch,
		Config:    roles.config,
		Notifs:    roles.notifs,
		Prompts:   roles.prompts,
		Search:    roles.search,
		Meta:      roles.meta,
		Reset:     roles.reset,
	}
}

// ShutdownCh returns the shutdown signal channel.
func (s *State) ShutdownCh() <-chan struct{} { return s.stateCh.shutdownCh }

// RestartCh returns the restart signal channel.
func (s *State) RestartCh() <-chan string { return s.stateCh.restartCh }

// CloseAllSubscribers stops the poller and closes every SSE subscriber channel.
func (s *State) CloseAllSubscribers() {
	if s.stop != nil {
		s.stop()
	}
	s.dep.Bus.CloseAll()
}
