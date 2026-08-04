package server

import (
	"context"
	"encoding/json"
	"log/slog"

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
	f := newFanout(hub, index, notif, bus)
	poller := NewPoller(f)

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

	dep := newDep(f, roles)
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
	go f.refreshAndIndex(ctx)

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

// fanout bundles the collaborators that turn a session refresh into a
// re-index, an SSE broadcast, and a notification pass. The Poller embeds it
// and the HTTP add/update-source handlers use it, so the two paths share the
// exact same fan-out instead of passing the same four collaborators around.
type fanout struct {
	hub     *SessionHub
	indexer *Indexer
	notif   *Notifier
	bus     *EventBus
}

// newFanout builds the session fan-out bundle.
func newFanout(hub *SessionHub, indexer *Indexer, notif *Notifier, bus *EventBus) *fanout {
	return &fanout{hub: hub, indexer: indexer, notif: notif, bus: bus}
}

// refreshAndIndex runs a session refresh followed by background indexing and
// emits the SSE events the frontend expects. It is used when a source is added
// or updated so the HTTP handler is never blocked by adapter I/O.
func (f *fanout) refreshAndIndex(ctx context.Context) {
	ids, _, transitions := f.hub.refreshSessions(ctx)
	f.fanoutSessions(ctx, ids, transitions)
}

// fanoutSessions broadcasts the result of a session refresh: a background
// re-index, an SSE "update" pulse, a "session-changed" event carrying the
// changed IDs, and a notification classification pass. Shared by refreshAndIndex
// and the Poller's changed tick so the two paths cannot drift.
func (f *fanout) fanoutSessions(ctx context.Context, ids []string, transitions []statusTransition) {
	go f.indexer.IndexSessions(ctx)
	f.bus.Send(sseEvent{Name: "update"})
	if len(ids) == 0 {
		return
	}
	data, err := json.Marshal(map[string]any{"ids": ids})
	if err != nil {
		slog.Warn("failed to marshal session change event", "error", err)
	} else {
		f.bus.Send(sseEvent{Name: "session-changed", Data: string(data)})
	}
	go f.notif.ClassifyChanges(ctx, ids, transitions)
}

func newDep(f *fanout, roles storeRoles) Dep {
	return Dep{
		Hub:       f.hub,
		Indexer:   f.indexer,
		Notifier:  f.notif,
		Bus:       f.bus,
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
