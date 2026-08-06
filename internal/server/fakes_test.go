package server

import (
	"context"
	"encoding/json"
	"fmt"
	"maps"
	"os"
	"sort"
	"sync"
	"time"

	"github.com/stevencrawford/omnivue/internal/ingest"
	"github.com/stevencrawford/omnivue/internal/store"
)

// In-memory fakes for the store role interfaces (ATH-03 D3). Handler-scaffolding
// tests use these instead of a real SQLite store; the poll/index/classify
// integration tests keep the real store.

type fakeSourceStore struct {
	mu      sync.Mutex
	sources map[string]ingest.Source
}

func newFakeSourceStore() *fakeSourceStore {
	return &fakeSourceStore{sources: map[string]ingest.Source{}}
}

func (f *fakeSourceStore) AddSource(src ingest.Source) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.sources[src.ID] = src
	return nil
}

func (f *fakeSourceStore) ListSources() ([]ingest.Source, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	out := make([]ingest.Source, 0, len(f.sources))
	for _, s := range f.sources {
		out = append(out, s)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ID < out[j].ID })
	return out, nil
}

func (f *fakeSourceStore) RemoveSource(id string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	delete(f.sources, id)
	return nil
}

func (f *fakeSourceStore) UpdateSource(id, path, agentType, label string, enabled bool) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	src, ok := f.sources[id]
	if !ok {
		return os.ErrNotExist
	}
	src.Path = path
	src.AgentType = ingest.AgentType(agentType)
	src.Label = label
	src.Enabled = enabled
	f.sources[id] = src
	return nil
}

func (f *fakeSourceStore) Source(id string) (*ingest.Source, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	src, ok := f.sources[id]
	if !ok {
		return nil, os.ErrNotExist
	}
	return &src, nil
}

type fakeConfigStore struct {
	mu     sync.Mutex
	values map[string]string
}

func newFakeConfigStore() *fakeConfigStore {
	return &fakeConfigStore{values: map[string]string{}}
}

func (f *fakeConfigStore) Config(key string) (string, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.values[key], nil
}

func (f *fakeConfigStore) SetConfig(key, value string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.values[key] = value
	return nil
}

func (f *fakeConfigStore) AllConfig() (map[string]string, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	return maps.Clone(f.values), nil
}

func (f *fakeConfigStore) RecentSearches() ([]string, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	raw, ok := f.values["recent_searches"]
	if !ok {
		return nil, nil
	}
	var searches []string
	if err := json.Unmarshal([]byte(raw), &searches); err != nil {
		return nil, err
	}
	return searches, nil
}

func (f *fakeConfigStore) SetRecentSearches(searches []string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	data, err := json.Marshal(searches)
	if err != nil {
		return err
	}
	f.values["recent_searches"] = string(data)
	return nil
}

type fakeScratchStore struct {
	mu     sync.Mutex
	files  map[string]store.ScratchFile
	nextID int
}

func newFakeScratchStore() *fakeScratchStore {
	return &fakeScratchStore{files: map[string]store.ScratchFile{}}
}

func (f *fakeScratchStore) CreateScratchFile(file store.ScratchFile) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if file.ID == "" {
		f.nextID++
		file.ID = fmt.Sprintf("scratch_%d", f.nextID)
	}
	f.files[file.ID] = file
	return nil
}

func (f *fakeScratchStore) ListScratchFiles(sessionID string) ([]store.ScratchFile, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	var out []store.ScratchFile
	for _, file := range f.files {
		if file.SessionID == sessionID {
			out = append(out, file)
		}
	}
	return out, nil
}

func (f *fakeScratchStore) ListAllScratchFiles() ([]store.ScratchFile, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	out := make([]store.ScratchFile, 0, len(f.files))
	for _, file := range f.files {
		out = append(out, file)
	}
	return out, nil
}

func (f *fakeScratchStore) ScratchFile(id string) (*store.ScratchFile, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	file, ok := f.files[id]
	if !ok {
		return nil, os.ErrNotExist
	}
	return &file, nil
}

func (f *fakeScratchStore) UpdateScratchFile(id, title, content string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	file, ok := f.files[id]
	if !ok {
		return os.ErrNotExist
	}
	file.Title = title
	file.Content = content
	f.files[id] = file
	return nil
}

func (f *fakeScratchStore) RenameScratchFile(id, title string) error {
	return f.UpdateScratchFile(id, title, "")
}

func (f *fakeScratchStore) DeleteScratchFile(id string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	delete(f.files, id)
	return nil
}

type fakeNotificationStore struct {
	mu            sync.Mutex
	notifications []store.Notification
}

func newFakeNotificationStore() *fakeNotificationStore {
	return &fakeNotificationStore{}
}

func (f *fakeNotificationStore) InsertNotification(n store.Notification, _ string) (bool, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.notifications = append(f.notifications, n)
	return true, nil
}

func (f *fakeNotificationStore) ListNotifications(limit int, unreadOnly bool) ([]store.Notification, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	out := make([]store.Notification, 0, len(f.notifications))
	for _, n := range f.notifications {
		if unreadOnly && n.ReadAt != nil {
			continue
		}
		out = append(out, n)
	}
	if limit > 0 && len(out) > limit {
		out = out[:limit]
	}
	return out, nil
}

func (f *fakeNotificationStore) MarkNotificationRead(id string) error { return nil }

func (f *fakeNotificationStore) MarkAllNotificationsRead(_ []string) error { return nil }

func (f *fakeNotificationStore) ClearNotifications(_ time.Time) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.notifications = nil
	return nil
}

func (f *fakeNotificationStore) PruneNotifications(_ int) error { return nil }

func (f *fakeNotificationStore) NotificationState(_ string) (store.NotificationState, error) {
	return store.NotificationState{}, nil
}

func (f *fakeNotificationStore) SetNotificationState(_ string, _ int, _ time.Time) error {
	return nil
}

func (f *fakeNotificationStore) MarkSessionViewed(_ string) error { return nil }

type fakePromptStore struct {
	mu      sync.Mutex
	prompts map[string]store.QueuedPrompt
}

func newFakePromptStore() *fakePromptStore {
	return &fakePromptStore{prompts: map[string]store.QueuedPrompt{}}
}

func (f *fakePromptStore) CreatePrompt(p store.QueuedPrompt) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.prompts[p.ID] = p
	return nil
}

func (f *fakePromptStore) Prompt(id string) (*store.QueuedPrompt, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	p, ok := f.prompts[id]
	if !ok {
		return nil, os.ErrNotExist
	}
	return &p, nil
}

func (f *fakePromptStore) ListPrompts(_, _ string, _ int) ([]store.QueuedPrompt, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	out := make([]store.QueuedPrompt, 0, len(f.prompts))
	for _, p := range f.prompts {
		out = append(out, p)
	}
	return out, nil
}

func (f *fakePromptStore) UpdatePromptStatus(id, status string, dispatchedAt *int64) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	p, ok := f.prompts[id]
	if !ok {
		return os.ErrNotExist
	}
	p.Status = status
	p.DispatchedAt = dispatchedAt
	f.prompts[id] = p
	return nil
}

func (f *fakePromptStore) UpdatePromptContent(id, promptText, tags string, priority int) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	p, ok := f.prompts[id]
	if !ok {
		return os.ErrNotExist
	}
	p.PromptText = promptText
	p.Tags = tags
	p.Priority = priority
	f.prompts[id] = p
	return nil
}

func (f *fakePromptStore) DeletePrompt(id string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	delete(f.prompts, id)
	return nil
}

func (f *fakePromptStore) BatchDeletePrompts(ids []string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	for _, id := range ids {
		delete(f.prompts, id)
	}
	return nil
}

type fakeBookmarkStore struct {
	mu        sync.Mutex
	bookmarks map[string]store.Bookmark
}

func newFakeBookmarkStore() *fakeBookmarkStore {
	return &fakeBookmarkStore{bookmarks: map[string]store.Bookmark{}}
}

func (f *fakeBookmarkStore) CreateBookmark(b store.Bookmark) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.bookmarks[b.ID] = b
	return nil
}

func (f *fakeBookmarkStore) ListBookmarks() ([]store.Bookmark, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	out := make([]store.Bookmark, 0, len(f.bookmarks))
	for _, b := range f.bookmarks {
		out = append(out, b)
	}
	return out, nil
}

func (f *fakeBookmarkStore) BookmarkByRef(sessionID string, messageIndex int, toolCallID string) (*store.Bookmark, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	for _, b := range f.bookmarks {
		if b.SessionID == sessionID && b.MessageIndex == messageIndex && b.ToolCallID == toolCallID {
			copy := b
			return &copy, nil
		}
	}
	return nil, nil
}

func (f *fakeBookmarkStore) DeleteBookmark(id string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	delete(f.bookmarks, id)
	return nil
}

type fakeSearchStore struct{}

func newFakeSearchStore() *fakeSearchStore { return &fakeSearchStore{} }

func (f *fakeSearchStore) ClearSessionIndex(_ string) error { return nil }
func (f *fakeSearchStore) ClearSessionChunkType(_, _ string) error {
	return nil
}
func (f *fakeSearchStore) IndexSession(_, _, _, _, _ string) error { return nil }
func (f *fakeSearchStore) IndexSessionAt(_, _, _, _, _, _, _, _ string, _ int) error {
	return nil
}
func (f *fakeSearchStore) UpdateIndexState(_, _, _ string) error { return nil }
func (f *fakeSearchStore) IndexState(_ string) (string, error)   { return "", nil }
func (f *fakeSearchStore) Search(_ string, _ int, _ string) ([]store.SearchResult, error) {
	return nil, nil
}
func (f *fakeSearchStore) SearchTags(_ string, _ int) []store.SearchResult { return nil }

// trackingSearchStore wraps fakeSearchStore with a concurrency counter around
// the per-session index writes. A single IndexSessions pass issues these calls
// strictly sequentially, so two overlapping passes would interleave them and
// bump maxConcurrent above 1. The Pipeline's serialization tests assert that
// never happens (ATH-18 follow-up: the "no overlap" guarantee is code-backed).
type trackingSearchStore struct {
	fakeSearchStore

	mu        sync.Mutex
	active    int
	maxActive int
}

func newTrackingSearchStore() *trackingSearchStore { return &trackingSearchStore{} }

func (t *trackingSearchStore) IndexSessionAt(_, _, _, _, _, _, _, _ string, _ int) error {
	t.enter()
	defer t.leave()
	time.Sleep(2 * time.Millisecond) // widen the race window so overlap is detectable
	return nil
}

func (t *trackingSearchStore) UpdateIndexState(_, _, _ string) error {
	t.enter()
	defer t.leave()
	time.Sleep(2 * time.Millisecond)
	return nil
}

func (t *trackingSearchStore) enter() {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.active++
	if t.active > t.maxActive {
		t.maxActive = t.active
	}
}

func (t *trackingSearchStore) leave() {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.active--
}

// maxConcurrent returns the largest number of simultaneously-in-flight index
// writes observed, which is 1 iff every index pass ran non-overlapping.
func (t *trackingSearchStore) maxConcurrent() int {
	t.mu.Lock()
	defer t.mu.Unlock()
	return t.maxActive
}

type fakeNameStore struct {
	mu    sync.Mutex
	names map[string]string
}

func newFakeNameStore() *fakeNameStore {
	return &fakeNameStore{names: map[string]string{}}
}

func (f *fakeNameStore) SetSessionName(sessionID, displayName string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.names[sessionID] = displayName
	return nil
}

func (f *fakeNameStore) ClearSessionName(sessionID string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	delete(f.names, sessionID)
	return nil
}

func (f *fakeNameStore) SessionName(sessionID string) (string, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.names[sessionID], nil
}

func (f *fakeNameStore) AllSessionNames() (map[string]string, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	return maps.Clone(f.names), nil
}

type fakeMetaStore struct {
	version int
}

func (f *fakeMetaStore) SchemaVersion() (int, error) { return f.version, nil }

type fakeResetter struct{}

func (f *fakeResetter) Reset() error { return nil }

// fakeRoles returns a storeRoles with every role backed by an in-memory fake.
func fakeRoles() storeRoles {
	return storeRoles{
		sources:   newFakeSourceStore(),
		tags:      &fakeTagStore{},
		bookmarks: newFakeBookmarkStore(),
		scratch:   newFakeScratchStore(),
		config:    newFakeConfigStore(),
		notifs:    newFakeNotificationStore(),
		prompts:   newFakePromptStore(),
		search:    newFakeSearchStore(),
		meta:      &fakeMetaStore{},
		reset:     &fakeResetter{},
		names:     newFakeNameStore(),
	}
}

// newFakeDep builds a Dep with a hub (seeded with the given adapters and
// sessions) plus all-fake store roles, for handler-scaffolding tests that do
// not exercise the real store semantics.
func newFakeDep(adapters map[string]ingest.Adapter, sessions []ingest.Session) Dep {
	bus := NewEventBus()
	hub := &SessionHub{adapters: adapters, sessions: sessions}
	roles := fakeRoles()
	return newDep(newPipeline(hub, NewIndexer(hub, hub, roles.search, roles.scratch), NewNotifier(hub, roles.notifs, roles.config, roles.tags, bus), bus), roles)
}

// fakeSessionReader is an in-memory SessionReader for unit-driving the Notifier
// and Indexer without a live hub or any adapter. Sessions index by ID; per-ID
// reads render their fields from the canned values.
type fakeSessionReader struct {
	sessions []ingest.Session
	messages map[string][]ingest.Message
	plans    map[string]*ingest.Plan
	diffs    map[string][]ingest.DiffFile
	edits    map[string][]ingest.FileEdit
}

func (f *fakeSessionReader) Session(_ context.Context, id string) (*ingest.Session, error) {
	for _, s := range f.sessions {
		if s.ID == id {
			return &s, nil
		}
	}
	return nil, notFound("session not found: " + id)
}

func (f *fakeSessionReader) Messages(_ context.Context, id string) ([]ingest.Message, error) {
	return f.messages[id], nil
}

func (f *fakeSessionReader) Plan(_ context.Context, id string) (*ingest.Plan, error) {
	return f.plans[id], nil
}

func (f *fakeSessionReader) Diffs(_ context.Context, id string) ([]ingest.DiffFile, error) {
	return f.diffs[id], nil
}

func (f *fakeSessionReader) Edits(_ context.Context, id string) ([]ingest.FileEdit, error) {
	return f.edits[id], nil
}

func (f *fakeSessionReader) ResumeCommand(_ context.Context, id string) (*ResumeSpec, error) {
	for _, s := range f.sessions {
		if s.ID == id {
			return &ResumeSpec{
				Directory:    s.Directory,
				Command:      "resume " + id,
				CommandNoCD:  "absolute " + id,
				AgentCommand: "agent " + id,
			}, nil
		}
	}
	return nil, notFound("session not found: " + id)
}

// fakeSessionCatalog is an in-memory SessionCatalog for driving the Indexer.
type fakeSessionCatalog struct {
	sessions []ingest.Session
	titles   map[string]string
}

func (f *fakeSessionCatalog) Sessions() []ingest.Session {
	return f.sessions
}

func (f *fakeSessionCatalog) TitleMap() map[string]string {
	return f.titles
}
