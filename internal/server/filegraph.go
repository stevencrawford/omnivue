package server

import (
	"net/http"
	"sort"
	"time"

	"github.com/stevencrawford/omnivue/internal/store"
)

// FileGraphNode is a single file in the activity graph. Total is the sum of
// read and write touches across the filtered sessions; Sessions is the count of
// distinct sessions that touched the file.
type FileGraphNode struct {
	Path     string `json:"path"`
	Reads    int    `json:"reads"`
	Writes   int    `json:"writes"`
	Total    int    `json:"total"`
	Sessions int    `json:"sessions"`
}

// FileGraphEdge links two files co-touched within the same session. Weight is
// the number of sessions in which both files appear.
type FileGraphEdge struct {
	Source string `json:"source"`
	Target string `json:"target"`
	Weight int    `json:"weight"`
}

// FileGraph is the aggregated file-activity graph for the filtered sessions.
type FileGraph struct {
	Nodes []FileGraphNode `json:"nodes"`
	Edges []FileGraphEdge `json:"edges"`
}

// handleFileGraph builds the cross-session file graph. It filters the cached
// session list by agent/repo/date, loads the persisted file-activity rows for
// the matching sessions, and aggregates them into nodes (files) and edges
// (co-touched file pairs). Persisted aggregation keeps this O(rows), not
// O(sessions × messages).
func handleFileGraph(hub *SessionHub, activity store.FileActivityStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if activity == nil {
			writeOK(w, FileGraph{Nodes: []FileGraphNode{}, Edges: []FileGraphEdge{}})
			return
		}
		q := r.URL.Query()
		agent := q.Get("agent")
		repo := q.Get("repo")
		from := parseGraphTime(q.Get("from"))
		to := parseGraphTime(q.Get("to"))

		allowed := make([]string, 0)
		for _, sess := range hub.Sessions() {
			if agent != "" && string(sess.Agent) != agent {
				continue
			}
			if repo != "" && sess.Repository != repo {
				continue
			}
			if !from.IsZero() && sess.UpdatedAt.Before(from) {
				continue
			}
			if !to.IsZero() && sess.UpdatedAt.After(to) {
				continue
			}
			allowed = append(allowed, sess.ID)
		}

		rows, err := activity.FileActivityRows(allowed)
		if err != nil {
			writeError(w, internalError("failed to load file activity"))
			return
		}
		writeOK(w, buildFileGraph(rows))
	}
}

// parseGraphTime parses an RFC3339 timestamp, returning the zero time on empty
// or unparseable input so callers can treat it as "no bound".
func parseGraphTime(s string) time.Time {
	if s == "" {
		return time.Time{}
	}
	if t, err := time.Parse(time.RFC3339, s); err == nil {
		return t
	}
	return time.Time{}
}

// buildFileGraph aggregates persisted file-activity rows into a node/edge graph.
// Nodes are capped to the most-touched files and edges to pairs co-touched in at
// least two sessions, keeping large histories legible.
func buildFileGraph(rows []store.FileActivityRow) FileGraph {
	type acc struct {
		reads    int
		writes   int
		sessions map[string]struct{}
	}
	nodes := make(map[string]*acc)
	// sessionFiles maps session id -> set of file paths touched in that session.
	sessionFiles := make(map[string]map[string]struct{})

	for _, r := range rows {
		if r.Reads == 0 && r.Writes == 0 {
			continue
		}
		a, ok := nodes[r.Path]
		if !ok {
			a = &acc{sessions: make(map[string]struct{})}
			nodes[r.Path] = a
		}
		a.reads += r.Reads
		a.writes += r.Writes
		a.sessions[r.SessionID] = struct{}{}

		files, ok := sessionFiles[r.SessionID]
		if !ok {
			files = make(map[string]struct{})
			sessionFiles[r.SessionID] = files
		}
		files[r.Path] = struct{}{}
	}

	// Cap nodes to the top N by total touches to keep the graph legible.
	const maxNodes = 500
	type ranked struct {
		path  string
		total int
	}
	rankedNodes := make([]ranked, 0, len(nodes))
	for path, a := range nodes {
		rankedNodes = append(rankedNodes, ranked{path: path, total: a.reads + a.writes})
	}
	sort.Slice(rankedNodes, func(i, j int) bool {
		if rankedNodes[i].total == rankedNodes[j].total {
			return rankedNodes[i].path < rankedNodes[j].path
		}
		return rankedNodes[i].total > rankedNodes[j].total
	})
	kept := make(map[string]struct{}, min(len(rankedNodes), maxNodes))
	for i, rn := range rankedNodes {
		if i >= maxNodes {
			break
		}
		kept[rn.path] = struct{}{}
	}

	graphNodes := make([]FileGraphNode, 0, len(kept))
	for path := range kept {
		a := nodes[path]
		graphNodes = append(graphNodes, FileGraphNode{
			Path:     path,
			Reads:    a.reads,
			Writes:   a.writes,
			Total:    a.reads + a.writes,
			Sessions: len(a.sessions),
		})
	}

	// Edges: count sessions where each file pair co-occurs.
	type edgeKey struct{ a, b string }
	edgeWeights := make(map[edgeKey]int)
	for _, files := range sessionFiles {
		paths := make([]string, 0, len(files))
		for p := range files {
			if _, ok := kept[p]; ok {
				paths = append(paths, p)
			}
		}
		sort.Strings(paths)
		for i := 0; i < len(paths); i++ {
			for j := i + 1; j < len(paths); j++ {
				k := edgeKey{a: paths[i], b: paths[j]}
				edgeWeights[k]++
			}
		}
	}

	edges := make([]FileGraphEdge, 0, len(edgeWeights))
	for k, w := range edgeWeights {
		if w < 2 {
			continue
		}
		edges = append(edges, FileGraphEdge{Source: k.a, Target: k.b, Weight: w})
	}
	// Sort edges by weight desc for stable, meaningful ordering in the UI.
	sort.Slice(edges, func(i, j int) bool { return edges[i].Weight > edges[j].Weight })

	return FileGraph{Nodes: graphNodes, Edges: edges}
}
