package ingestkit

import (
	"maps"
	"reflect"
	"testing"
)

// TestCanonicalizeToolName covers every alias the Cursor, Pi, Claude Code,
// and Codex adapters previously hand-wrote in their own normalize switches,
// plus the shared prefix/harness rules.
func TestCanonicalizeToolName(t *testing.T) {
	tests := []struct {
		name string
		want string
	}{
		// Cursor
		{"edit_file_v2", "edit"},
		{"edit_file", "edit"},
		{"StrReplace", "edit"},
		{"read_file_v2", "read"},
		{"read_file", "read"},
		{"Read", "read"},
		{"glob_file_search", "glob"},
		{"list_dir", "glob"},
		{"Glob", "glob"},
		{"ripgrep_raw_search", "grep"},
		{"grep_search", "grep"},
		{"Grep", "grep"},
		{"GrepSearch", "grep"},
		{"run_terminal_command_v2", "bash"},
		{"run_terminal_command", "bash"},
		{"Shell", "bash"},
		{"delete_file", "delete"},
		{"Write", "write"},
		{"Task", "task"},
		{"task_v2", "task"},
		{"explore:task_v2", "task"},
		{"ReadLints", "read_lints"},
		{"UpdateCurrentStep", "task_complete"},

		// Pi
		{"read_files", "read"},
		{"view_file", "read"},
		{"write", "write"},
		{"write_file", "write"},
		{"create_file", "write"},
		{"new_file", "write"},
		{"edit", "edit"},
		{"edit_file_content", "edit"},
		{"modify_file", "edit"},
		{"apply_diff", "edit"},
		{"replace_text", "edit"},
		{"remove_file", "delete"},
		{"run_command", "bash"},
		{"execute_command", "bash"},
		{"shell", "bash"},
		{"run_terminal", "bash"},
		{"search_files", "grep"},
		{"find_text", "grep"},
		{"search_text", "grep"},
		{"list_files", "glob"},
		{"list_directory", "glob"},
		{"find_file", "glob"},
		{"ask_question", "question"},
		{"ask_user", "question"},
		{"prompt_user", "question"},
		{"fetch_url", "webfetch"},
		{"http_request", "webfetch"},
		{"make_request", "webfetch"},
		{"web_fetch", "webfetch"},
		{"web_search", "websearch"},
		{"search_web", "websearch"},
		{"search_internet", "websearch"},

		// Claude Code
		{"Edit", "edit"},
		{"Bash", "bash"},
		{"Delete", "delete"},
		{"ExitPlanMode", "exit_plan_mode"},
		{"WebFetch", "webfetch"},
		{"WebSearch", "websearch"},
		{"TaskCreate", "todowrite"},
		{"TaskUpdate", "todowrite"},
		{"TaskOutput", "task_complete"},
		{"Agent", "task"},

		// Codex
		{"exec_command", "bash"},
		{"apply_patch", "edit"},
		{"request_user_input", "question"},

		// Codex prefix/suffix rules
		{"exec_ls", "bash"},
		{"edit_some_tool", "edit"},
		{"custom_patch", "edit"},
		{"read_logs", "read"},

		// Claude Code harness rule
		{"Bash:Bash", "bash"},
		{"Task:Task", "task"},
		{"Read:Read", "read"},

		// Unmapped names pass through unchanged
		{"multi_tool_use.parallel", "multi_tool_use.parallel"},
		{"unknown_tool", "unknown_tool"},
		{"", ""},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if got := CanonicalizeToolName(tc.name); got != tc.want {
				t.Errorf("CanonicalizeToolName(%q) = %q, want %q", tc.name, got, tc.want)
			}
		})
	}
}

// TestRenameToolKeys exercises the shared field-rename mechanism with the
// conservative rule sets the Cursor and Pi adapters apply.
func TestRenameToolKeys(t *testing.T) {
	editRules := RenameRules{
		FilePath:  []string{"relativeWorkspacePath", "path", "file", "file_path"},
		NewString: []string{"contents", "streamingContent", "newStr", "new_string", "new_content", "updated_content"},
		OldString: []string{"oldStr", "old_string", "old_content"},
	}
	readRules := RenameRules{
		FilePath: []string{"targetFile", "effectiveUri", "relativeWorkspacePath", "path"},
		Drop:     []string{"charsLimit"},
	}
	// Pi's read aliases are ordered file-before-path so "file" wins when both exist.
	piReadRules := RenameRules{
		FilePath: []string{"file", "path"},
	}
	writeRules := RenameRules{
		FilePath:      []string{"file", "path", "file_path"},
		NewString:     []string{"new_content", "updated_content"},
		OldString:     []string{"old_content"},
		CopyNewString: []string{"content"},
	}
	grepRules := RenameRules{Query: []string{"pattern"}}
	globRules := RenameRules{
		Pattern:   []string{"globPattern"},
		Directory: []string{"targetDirectory"},
	}

	tests := []struct {
		name  string
		rules RenameRules
		in    map[string]any
		want  map[string]any
	}{
		// Cursor read
		{"cursor read targetFile", readRules, map[string]any{"targetFile": "a.txt", "charsLimit": 2000}, map[string]any{"filePath": "a.txt"}},
		{"cursor read effectiveUri", readRules, map[string]any{"effectiveUri": "a.txt"}, map[string]any{"filePath": "a.txt"}},
		{"cursor read relativeWorkspacePath", readRules, map[string]any{"relativeWorkspacePath": "a.txt"}, map[string]any{"filePath": "a.txt"}},
		{"cursor read path", readRules, map[string]any{"path": "a.txt"}, map[string]any{"filePath": "a.txt"}},

		// Cursor edit
		{"cursor edit renames", editRules, map[string]any{"relativeWorkspacePath": "f", "contents": "new", "oldStr": "old"}, map[string]any{"filePath": "f", "newString": "new", "oldString": "old"}},
		{"cursor edit streamingContent", editRules, map[string]any{"path": "f", "streamingContent": "n"}, map[string]any{"filePath": "f", "newString": "n"}},
		{"cursor edit keeps existing filePath", editRules, map[string]any{"filePath": "f", "contents": "n"}, map[string]any{"filePath": "f", "newString": "n"}},

		// Cursor grep/glob
		{"grep pattern to query", grepRules, map[string]any{"pattern": "foo"}, map[string]any{"query": "foo"}},
		{"cursor glob renames", globRules, map[string]any{"globPattern": "**/*.ts", "targetDirectory": "src"}, map[string]any{"pattern": "**/*.ts", "directory": "src"}},

		// Pi read
		{"pi read file wins", piReadRules, map[string]any{"file": "a.txt", "path": "b.txt"}, map[string]any{"filePath": "a.txt"}},

		// Pi edit/write
		{"pi edit file_path", editRules, map[string]any{"file_path": "f", "new_content": "n", "old_content": "o"}, map[string]any{"filePath": "f", "newString": "n", "oldString": "o"}},
		{"pi write keeps content", writeRules, map[string]any{"file_path": "f", "content": "n"}, map[string]any{"filePath": "f", "newString": "n", "content": "n"}},
		{"pi write moved newString wins", writeRules, map[string]any{"file_path": "f", "updated_content": "n", "content": "c"}, map[string]any{"filePath": "f", "newString": "n", "content": "c"}},

		// No-op
		{"empty input", editRules, map[string]any{}, map[string]any{}},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			in := make(map[string]any, len(tc.in))
			maps.Copy(in, tc.in)
			RenameToolKeys(in, tc.rules)
			if !reflect.DeepEqual(in, tc.want) {
				t.Errorf("RenameToolKeys(%v) = %v, want %v", tc.in, in, tc.want)
			}
		})
	}
}
