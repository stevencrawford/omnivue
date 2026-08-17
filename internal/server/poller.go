package server

import (
	"context"
	"time"
)

// liveWindow defines how recently a session must have been updated to be
// considered "active" (live). Used as a server-side liveness heuristic since
// neither OpenCode nor Copilot expose an explicit in-progress flag. Reasoning
// updates count: OpenCode's UpdatedAt tracks the newest part write, so a model
// mid-think keeps the session live without any new message.
const liveWindow = 1 * time.Minute

// openStepWindow bounds how long an adapter-reported in-progress session
// (open step, e.g. a model mid-think) is kept active regardless of writes.
// OpenCode writes nothing while thinking, so a frozen timestamp alone cannot
// distinguish a live think from a crashed step; a session whose open step is
// older than this window is treated as stale again.
const openStepWindow = 30 * time.Minute

// pollCadenceLive / pollCadenceIdle control the adaptive poll interval. When
// at least one session is live, the server polls every 2.5s so the UI feels
// real-time; otherwise it backs off to 30s to save DB queries.
const (
	pollCadenceLive = 2500 * time.Millisecond
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
// It depends on the AdapterProvider seam to watch sources, and drives the
// Pipeline for every refresh so both cadences share the same orchestration.
type Poller struct {
	pipeline *Pipeline
	catalog  AdapterProvider

	// lastMod tracks the last known modification timestamp per source so a
	// change is only acted on once. liveCount adapts the poll cadence.
	lastMod   map[string]int64
	liveCount int
}

func NewPoller(catalog AdapterProvider, p *Pipeline) *Poller {
	return &Poller{
		pipeline: p,
		catalog:  catalog,
		lastMod:  make(map[string]int64),
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
	for sourceID, adapter := range p.catalog.Adapters() {
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
		p.liveCount = p.pipeline.Refresh(ctx)
		return
	}

	// No source-level change, but liveness windows may have expired since the
	// last refresh (e.g. a session went idle). Re-run the heuristic to keep
	// Status fresh without the heavier full reload cost. The pipeline broadcasts
	// only when the live count actually moved.
	if p.liveCount > 0 {
		p.liveCount = p.pipeline.RefreshLiveness(ctx, p.liveCount)
	}
}
