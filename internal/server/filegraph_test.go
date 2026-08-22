package server

import (
	"slices"
	"testing"

	"github.com/stevencrawford/omnivue/internal/store"
)

func activityRow(sessionID, path string, reads, writes int) store.FileActivityRow {
	return store.FileActivityRow{
		SessionID: sessionID,
		SourceID:  "src-1",
		Path:      path,
		Reads:     reads,
		Writes:    writes,
	}
}

func nodeByPath(t *testing.T, g FileGraph, path string) FileGraphNode {
	t.Helper()
	i := slices.IndexFunc(g.Nodes, func(n FileGraphNode) bool { return n.Path == path })
	if i < 0 {
		t.Fatalf("expected node %q in %+v", path, g.Nodes)
	}
	return g.Nodes[i]
}

// TestBuildFileGraph_Aggregation pins node aggregation across sessions: touch
// counts sum, Sessions counts distinct sessions, and SessionIDs lists them
// sorted so the UI drill-down is stable.
func TestBuildFileGraph_Aggregation(t *testing.T) {
	rows := []store.FileActivityRow{
		activityRow("s2", "a.go", 1, 0),
		activityRow("s1", "a.go", 3, 1),
		activityRow("s1", "b.go", 2, 0),
		// Zero-touch rows carry no information and must be dropped.
		activityRow("s1", "empty.go", 0, 0),
	}

	g := buildFileGraph(rows)

	a := nodeByPath(t, g, "a.go")
	if a.Reads != 4 || a.Writes != 1 || a.Total != 5 {
		t.Fatalf("a.go = reads %d writes %d total %d, want 4/1/5", a.Reads, a.Writes, a.Total)
	}
	if a.Sessions != 2 {
		t.Fatalf("a.go sessions = %d, want 2", a.Sessions)
	}
	if want := []string{"s1", "s2"}; !slices.Equal(a.SessionIDs, want) {
		t.Fatalf("a.go sessionIds = %v, want %v", a.SessionIDs, want)
	}

	b := nodeByPath(t, g, "b.go")
	if b.Total != 2 || b.Sessions != 1 {
		t.Fatalf("b.go = total %d sessions %d, want 2/1", b.Total, b.Sessions)
	}

	if slices.ContainsFunc(g.Nodes, func(n FileGraphNode) bool { return n.Path == "empty.go" }) {
		t.Fatal("expected zero-touch row to be skipped")
	}
}

// TestBuildFileGraph_Edges pins edge semantics: weights count shared sessions
// and pairs co-touched in fewer than two sessions are dropped.
func TestBuildFileGraph_Edges(t *testing.T) {
	rows := []store.FileActivityRow{
		// a+b co-touched in two sessions -> edge weight 2.
		activityRow("s1", "a.go", 1, 0),
		activityRow("s1", "b.go", 1, 0),
		activityRow("s2", "a.go", 1, 0),
		activityRow("s2", "b.go", 1, 0),
		// c only ever co-occurs once -> its pairs drop below the threshold.
		activityRow("s1", "c.go", 1, 0),
		activityRow("s3", "c.go", 1, 0),
	}

	g := buildFileGraph(rows)

	var ab *FileGraphEdge
	for i := range g.Edges {
		e := g.Edges[i]
		if (e.Source == "a.go" && e.Target == "b.go") || (e.Source == "b.go" && e.Target == "a.go") {
			ab = &g.Edges[i]
		}
		if e.Source == "c.go" || e.Target == "c.go" {
			t.Fatalf("unexpected edge involving singly co-touched c.go: %+v", e)
		}
	}
	if ab == nil {
		t.Fatalf("expected a.go/b.go edge, got %+v", g.Edges)
	}
	if ab.Weight != 2 {
		t.Fatalf("a/b edge weight = %d, want 2", ab.Weight)
	}
}

// TestBuildFileGraph_Empty verifies an empty population yields empty, non-nil
// node and edge lists so the API serializes [] rather than null.
func TestBuildFileGraph_Empty(t *testing.T) {
	g := buildFileGraph(nil)
	if len(g.Nodes) != 0 || len(g.Edges) != 0 {
		t.Fatalf("expected empty graph, got %+v", g)
	}
}
