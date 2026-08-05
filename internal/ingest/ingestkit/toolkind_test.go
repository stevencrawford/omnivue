package ingestkit

import (
	"slices"
	"testing"
)

// TestToolKinds pins the vocabulary to the union of the literal sets the
// notifier (question/permission/task complete) and the search indexer (plan)
// previously maintained independently. Editing a name here changes every
// consumer at once.
func TestToolKinds(t *testing.T) {
	tests := []struct {
		name string
		want []ToolKind
	}{
		// Notifier question kinds
		{"question", []ToolKind{KindQuestion}},
		{"ask", []ToolKind{KindQuestion}},
		// Notifier permission kinds
		{"permission_request", []ToolKind{KindPermission}},
		// Shared task-complete kinds (also searchable plan content for the indexer)
		{"task_complete", []ToolKind{KindTaskComplete, KindPlan}},
		{"task-complete", []ToolKind{KindTaskComplete, KindPlan}},
		// Notifier-only task-complete spelling
		{"taskcomplete", []ToolKind{KindTaskComplete}},
		// Indexer-only plan kinds
		{"todowrite", []ToolKind{KindPlan}},
		{"task", []ToolKind{KindPlan}},
		// Unknown names signal nothing
		{"bash", []ToolKind{}},
		{"", []ToolKind{}},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := KindsOf(tc.name)
			if want := tc.want; !slices.Equal(got, want) {
				t.Errorf("KindsOf(%q) = %v, want %v", tc.name, got, want)
			}
		})
	}
}

// TestHasKind exercises the membership helper over the shared and per-consumer
// kinds.
func TestHasKind(t *testing.T) {
	tests := []struct {
		name string
		kind ToolKind
		want bool
	}{
		{"question", KindQuestion, true},
		{"question", KindPlan, false},
		{"task_complete", KindTaskComplete, true},
		{"task_complete", KindPlan, true},
		{"taskcomplete", KindPlan, false},
		{"todowrite", KindPlan, true},
		{"todowrite", KindTaskComplete, false},
		{"permission_request", KindPermission, true},
		{"exit_plan_mode", KindPlan, false},
		{"Question", KindQuestion, true},
	}

	for _, tc := range tests {
		t.Run(tc.name+"-"+string(tc.kind), func(t *testing.T) {
			if got := HasKind(tc.name, tc.kind); got != tc.want {
				t.Errorf("HasKind(%q, %q) = %v, want %v", tc.name, tc.kind, got, tc.want)
			}
		})
	}
}
