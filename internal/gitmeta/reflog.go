package gitmeta

import (
	"bufio"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

type checkoutEvent struct {
	at   time.Time
	from string
	to   string
}

type reflogTimeline struct {
	events []checkoutEvent
}

// branchFromReflog returns the branch checked out at the supplied time. It
// replays only "checkout: moving from X to Y" entries; commits and resets do
// not change the branch.
func (r *Resolver) branchFromReflog(info Info, at time.Time) (string, bool) {
	if !info.Found || info.GitDir == "" {
		return "", false
	}
	path := filepath.Join(info.GitDir, "logs", "HEAD")
	fi, err := os.Stat(path)
	if err != nil {
		return "", false
	}

	r.mu.Lock()
	cached, ok := r.reflogs[path]
	r.mu.Unlock()

	if !ok || cached.size != fi.Size() || !cached.mod.Equal(fi.ModTime()) {
		timeline, err := parseReflog(path)
		if err != nil {
			return "", false
		}
		cached = reflogCacheEntry{timeline: timeline, size: fi.Size(), mod: fi.ModTime()}
		r.mu.Lock()
		r.reflogs[path] = cached
		r.mu.Unlock()
	}

	return cached.timeline.branchAt(at)
}

func parseReflog(path string) (reflogTimeline, error) {
	file, err := os.Open(path)
	if err != nil {
		return reflogTimeline{}, err
	}
	defer file.Close()

	var timeline reflogTimeline
	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		event, ok := parseReflogLine(scanner.Text())
		if !ok {
			continue
		}
		timeline.events = append(timeline.events, event)
	}
	if err := scanner.Err(); err != nil {
		return reflogTimeline{}, err
	}
	return timeline, nil
}

// parseReflogLine parses "<old> <new> <name> <email> <unix> <tz>\t<message>".
// The timestamp is the second-to-last whitespace field, so author names that
// contain spaces do not confuse the parser.
func parseReflogLine(line string) (checkoutEvent, bool) {
	prefix, message, ok := strings.Cut(line, "\t")
	if !ok {
		return checkoutEvent{}, false
	}
	fields := strings.Fields(prefix)
	if len(fields) < 3 {
		return checkoutEvent{}, false
	}
	seconds, err := strconv.ParseInt(fields[len(fields)-2], 10, 64)
	if err != nil {
		return checkoutEvent{}, false
	}
	from, to, ok := parseCheckoutMessage(message)
	if !ok {
		return checkoutEvent{}, false
	}
	return checkoutEvent{at: time.Unix(seconds, 0), from: from, to: to}, true
}

func parseCheckoutMessage(message string) (from, to string, ok bool) {
	const prefix = "checkout: moving from "
	rest, ok := strings.CutPrefix(message, prefix)
	if !ok {
		return "", "", false
	}
	index := strings.LastIndex(rest, " to ")
	if index < 0 {
		return "", "", false
	}
	from = rest[:index]
	to = rest[index+len(" to "):]
	if from == "" || to == "" {
		return "", "", false
	}
	return from, to, true
}

// branchAt returns the branch in effect at the supplied time. When the session
// predates the oldest checkout entry, the branch it moved from is used.
func (t *reflogTimeline) branchAt(at time.Time) (string, bool) {
	if len(t.events) == 0 {
		return "", false
	}
	branch := t.events[0].from
	for _, event := range t.events {
		if event.at.After(at) {
			break
		}
		branch = event.to
	}
	if branch == "" {
		return "", false
	}
	return branch, true
}
