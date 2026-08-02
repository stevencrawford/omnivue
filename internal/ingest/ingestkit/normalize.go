package ingestkit

import (
	"slices"
	"strings"
)

// canonicalToolNames is the set of standard tool call names that all adapters
// normalize to. Each adapter's normalize.go maps its native names to this set.
var canonicalToolNames = []string{
	"read", "write", "edit", "bash", "grep", "glob", "task",
	"todowrite", "task_complete", "question", "websearch",
	"webfetch", "delete", "model_switch", "compaction",
}

// CanonicalToolNames returns the set of standard tool call names.
func CanonicalToolNames() []string {
	out := make([]string, len(canonicalToolNames))
	copy(out, canonicalToolNames)
	return out
}

// IsCanonicalToolName reports whether name is one of the standard tool call
// names that adapters normalize to.
func IsCanonicalToolName(name string) bool {
	return slices.Contains(canonicalToolNames, name)
}

// toolAliases is the single declaration of every agent-native tool call name
// that maps to a canonical ingest name. It is the union of the aliases the
// Cursor, Pi, Claude Code, and Codex adapters previously hand-wrote in their
// own switches; editing an alias here updates every adapter at once.
var toolAliases = map[string]string{
	// Cursor
	"edit_file_v2":            "edit",
	"edit_file":               "edit",
	"StrReplace":              "edit",
	"read_file_v2":            "read",
	"read_file":               "read",
	"Read":                    "read",
	"glob_file_search":        "glob",
	"list_dir":                "glob",
	"Glob":                    "glob",
	"ripgrep_raw_search":      "grep",
	"grep_search":             "grep",
	"Grep":                    "grep",
	"GrepSearch":              "grep",
	"run_terminal_command_v2": "bash",
	"run_terminal_command":    "bash",
	"Shell":                   "bash",
	"delete_file":             "delete",
	"Write":                   "write",
	"Task":                    "task",
	"task_v2":                 "task",
	"explore:task_v2":         "task",
	"ReadLints":               "read_lints",
	"UpdateCurrentStep":       "task_complete",

	// Pi
	"read_files":        "read",
	"view_file":         "read",
	"write":             "write",
	"write_file":        "write",
	"create_file":       "write",
	"new_file":          "write",
	"edit":              "edit",
	"edit_file_content": "edit",
	"modify_file":       "edit",
	"apply_diff":        "edit",
	"replace_text":      "edit",
	"remove_file":       "delete",
	"run_command":       "bash",
	"execute_command":   "bash",
	"shell":             "bash",
	"run_terminal":      "bash",
	"search_files":      "grep",
	"find_text":         "grep",
	"search_text":       "grep",
	"list_files":        "glob",
	"list_directory":    "glob",
	"find_file":         "glob",
	"ask_question":      "question",
	"ask_user":          "question",
	"prompt_user":       "question",
	"fetch_url":         "webfetch",
	"http_request":      "webfetch",
	"make_request":      "webfetch",
	"web_fetch":         "webfetch",
	"web_search":        "websearch",
	"search_web":        "websearch",
	"search_internet":   "websearch",

	// Claude Code
	"Edit":         "edit",
	"Bash":         "bash",
	"Delete":       "delete",
	"ExitPlanMode": "exit_plan_mode",
	"WebFetch":     "webfetch",
	"WebSearch":    "websearch",
	"TaskCreate":   "todowrite",
	"TaskUpdate":   "todowrite",
	"TaskOutput":   "task_complete",
	"Agent":        "task",

	// Codex
	"exec_command":       "bash",
	"apply_patch":        "edit",
	"request_user_input": "question",
}

// CanonicalizeToolName maps an agent-native tool call name to the canonical
// ingest name. Resolution order:
//  1. exact alias match in toolAliases
//  2. Codex prefix/suffix rules: exec_*, edit_* / *_patch, read_*
//  3. Claude Code harness rule: "X:X" -> "x"
//  4. otherwise the name is returned unchanged
func CanonicalizeToolName(name string) string {
	if canon, ok := toolAliases[name]; ok {
		return canon
	}
	switch {
	case strings.HasPrefix(name, "exec_"):
		return "bash"
	case strings.HasPrefix(name, "edit_"), strings.HasSuffix(name, "_patch"):
		return "edit"
	case strings.HasPrefix(name, "read_"):
		return "read"
	}
	if idx := strings.Index(name, ":"); idx > 0 && idx+1 < len(name) && name[:idx] == name[idx+1:] {
		return strings.ToLower(name[:idx])
	}
	return name
}

// RenameRules describes how to canonicalize the JSON fields of a tool call
// input for one tool kind. Each adapter declares its own conservative rule
// set so per-adapter behavior is preserved exactly; only the mechanism is
// shared.
type RenameRules struct {
	// FilePath moves each listed key to "filePath" (deleting the source).
	FilePath []string
	// NewString moves each listed key to "newString" (deleting the source).
	NewString []string
	// OldString moves each listed key to "oldString" (deleting the source).
	OldString []string
	// Query moves each listed key to "query" (deleting the source).
	Query []string
	// Pattern moves each listed key to "pattern" (deleting the source).
	Pattern []string
	// Directory moves each listed key to "directory" (deleting the source).
	Directory []string
	// CopyNewString copies each listed key to "newString" without deleting
	// the source (Pi keeps "content" alongside the canonical key).
	CopyNewString []string
	// Drop deletes each listed key outright.
	Drop []string
}

// RenameToolKeys applies rules to the JSON object m in place.
func RenameToolKeys(m map[string]any, rules RenameRules) {
	move := func(from, to string) {
		v, ok := m[from]
		if !ok {
			return
		}
		if _, exists := m[to]; !exists {
			m[to] = v
		}
		delete(m, from)
	}
	for _, from := range rules.FilePath {
		move(from, "filePath")
	}
	for _, from := range rules.NewString {
		move(from, "newString")
	}
	for _, from := range rules.OldString {
		move(from, "oldString")
	}
	for _, from := range rules.Query {
		move(from, "query")
	}
	for _, from := range rules.Pattern {
		move(from, "pattern")
	}
	for _, from := range rules.Directory {
		move(from, "directory")
	}
	for _, from := range rules.CopyNewString {
		if v, ok := m[from]; ok {
			if _, exists := m["newString"]; !exists {
				m["newString"] = v
			}
		}
	}
	for _, k := range rules.Drop {
		delete(m, k)
	}
}
