package ingestkit

import (
	"slices"
)

// ToolKind classifies the semantic role a tool call name signals to downstream
// consumers (the notifier and the search indexer). It is distinct from the
// canonical name: a name can signal more than one kind, and consumers agree on
// classification because they share this vocabulary instead of maintaining
// their own literal sets.
type ToolKind string

const (
	// KindQuestion marks tool calls that ask the human a question.
	KindQuestion ToolKind = "question"
	// KindPermission marks tool calls that request permission to act.
	KindPermission ToolKind = "permission_request"
	// KindTaskComplete marks tool calls that signal task completion.
	KindTaskComplete ToolKind = "task_complete"
	// KindPlan marks tool calls whose input is searchable plan content.
	KindPlan ToolKind = "plan"
)

// toolKinds is the single declaration of every tool-call name (lowercased)
// that maps to one or more semantic kinds. It is the union of the literal
// sets previously hand-wrote in the notifier (question/permission/task
// complete) and the search indexer (plan); editing a name here updates every
// consumer at once.
var toolKinds = map[string][]ToolKind{
	"question":           {KindQuestion},
	"ask":                {KindQuestion},
	"permission_request": {KindPermission},
	"task_complete":      {KindTaskComplete, KindPlan},
	"task-complete":      {KindTaskComplete, KindPlan},
	"taskcomplete":       {KindTaskComplete},
	"todowrite":          {KindPlan},
	"task":               {KindPlan},
}

// KindsOf returns the semantic kinds the given tool call name signals. Names
// are matched exactly against the canonical (lowercased) form; callers pass the
// name as it appears after CanonicalizeToolName. An unknown name yields an
// empty slice.
func KindsOf(name string) []ToolKind {
	return toolKinds[name]
}

// HasKind reports whether the given tool call name signals the given kind.
func HasKind(name string, kind ToolKind) bool {
	return slices.Contains(KindsOf(name), kind)
}
