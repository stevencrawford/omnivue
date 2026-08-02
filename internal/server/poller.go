package server

import (
	"context"
	"time"
)

// liveWindow defines how recently a session must have been updated to be
// considered "active" (live). Used as a server-side liveness heuristic since
// neither OpenCode nor Copilot expose an explicit in-progress flag.
const liveWindow = 2 * time.Minute

// pollCadenceLive / pollCadenceIdle control the adaptive poll interval. When
// at least one session is live, the server polls every 5s so the UI feels
// real-time; otherwise it backs off to 30s to save DB queries.
const (
	pollCadenceLive = 5 * time.Second
	pollCadenceIdle = 30 * time.Second
)

// pollInterval returns the cadence to use for the next poll tick, based on
// the number of currently-live sessions.
func pollInterval(liveCount int) time.Duration {
	if liveCount > 0 {
		return pollCadenceLive
	}
	return pollCadenceIdle
}

// Poller drives the adaptive polling loop that watches for source changes,
// refreshes the SessionHub, re-indexes content, and notifies via the Notifier.
type Poller struct {
	hub     *SessionHub
	indexer *Indexer
	notif   *Notifier
	bus     *EventBus

	// lastMod tracks the last known modification timestamp per source so a
	// change is only acted on once. liveCount adapts the poll cadence.
	lastMod   map[string]int64
	liveCount int
}

func NewPoller(hub *SessionHub, indexer *Indexer, notif *Notifier, bus *EventBus) *Poller {
	return &Poller{
		hub:     hub,
		indexer: indexer,
		notif:   notif,
		bus:     bus,
		lastMod: make(map[string]int64),
	}
}

// Run blocks until the context is canceled, polling each configured source and
// triggering a refresh, re-index, and notification pass on detected changes.
func (p *Poller) Run(ctx context.Context) {
	for {
		timer := time.NewTimer(pollInterval(p.liveCount))
		select {
		case <-ctx.Done():
			timer.Stop()
			return
		case <-timer.C:
			p.tick(ctx)
		}
	}
}

// tick performs a single poll pass: compares each source's last-modified time
// against the previous snapshot and, when something changed, refreshes the hub
// and fans out via the indexer and notifier. It is split out so tests can drive
// the poll → index → classify → SSE path without waiting on the idle cadence.
func (p *Poller) tick(ctx context.Context) {
	changed := false
	for sourceID, adapter := range p.hub.Adapters() {
		ts, err := adapter.LastModified(ctx)
		if err != nil {
			continue
		}
		if prev, ok := p.lastMod[sourceID]; !ok || ts > prev {
			p.lastMod[sourceID] = ts
			if ok { // skip first observation
				changed = true
			}
		}
	}

	if changed {
		ids, lc, transitions := p.hub.refreshSessions(ctx)
		p.liveCount = lc
		fanoutSessions(ctx, p.hub, p.indexer, p.notif, p.bus, ids, transitions)
		return
	}

	// No source-level change, but liveness windows may have expired since the
	// last refresh (e.g. a session went idle). Re-run the heuristic to keep
	// Status fresh without the heavier full reload cost.
	if p.liveCount > 0 {
		_, lc, transitions := p.hub.refreshSessions(ctx)
		if lc != p.liveCount {
			// Status transitions are visible to clients; push an update.
			p.bus.Send(sseEvent{Name: "update"})
			if len(transitions) > 0 {
				var tids []string
				for _, t := range transitions {
					tids = append(tids, t.sessionID)
				}
				go p.notif.ClassifyChanges(ctx, tids, transitions)
			}
		}
		p.liveCount = lc
	}
}
