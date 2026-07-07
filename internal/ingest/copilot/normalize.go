package copilot

import (
	"encoding/json"
	"log/slog"

	"github.com/stevencrawford/omnivue/internal/ingest"
)

// normalizeToolCall normalizes copilot-native tool names and input fields to
// the canonical ingest set. Called during assistant message parsing.
func normalizeToolCall(tc *ingest.ToolCall, rawArgs json.RawMessage) {
	if tc.Name == "ask_user" {
		tc.Name = "question"
		tc.Input = normalizeAskUserInput(tc.Input)
		return
	}
	if tc.Name == "atlassian-getJiraIssue" || tc.Name == "atlassian_getJiraIssue" {
		tc.Name = "jira"
		return
	}
	if tc.Name == "apply_patch" {
		tc.Name = "edit"
		var patchText string
		if err := json.Unmarshal(rawArgs, &patchText); err == nil && patchText != "" {
			filePath := extractCopilotPatchPath(patchText)
			if filePath != "" {
				newInput, err := json.Marshal(map[string]string{
					"filePath": filePath,
					"content":  patchText,
				})
				if err != nil {
					slog.Warn("failed to marshal patch input", "error", err)
					newInput = []byte("{}")
				}
				tc.Input = string(newInput)
			}
		}
		return
	}
	if tc.Name == "create" {
		tc.Name = "write"
		var args toolEditArgs
		if err := json.Unmarshal(rawArgs, &args); err == nil && args.FileText != "" {
			newInput, err := json.Marshal(map[string]string{
				"filePath": args.Path,
				"content":  args.FileText,
			})
			if err != nil {
				slog.Warn("failed to marshal create input", "error", err)
				newInput = []byte("{}")
			}
			tc.Input = string(newInput)
		}
		return
	}
	if tc.Name == "web_fetch" {
		tc.Name = "webfetch"
		return
	}
	if tc.Name == "read_bash" || tc.Name == "stop_bash" {
		tc.Name = "bash"
		return
	}
	if tc.Name == "read_agent" {
		tc.Name = "task"
		return
	}
}

// normalizeSQLToTodoWrite checks whether a sql tool call targets the todos
// table and if so renames it to todowrite, applies the SQL statements to the
// todoState, and regenerates the input from the synthesized state.
// Returns true when the tool call was converted to todowrite.
func normalizeSQLToTodoWrite(tc *ingest.ToolCall, ts *todoState) bool {
	if tc.Name != "sql" {
		return false
	}
	var args struct {
		Query string `json:"query"`
	}
	if err := json.Unmarshal([]byte(tc.Input), &args); err != nil || args.Query == "" {
		return false
	}
	if !todoTableRe.MatchString(args.Query) {
		return false
	}
	tc.Name = "todowrite"
	for _, stmt := range splitSQLStatements(args.Query) {
		ts.applySQL(stmt)
	}
	tc.Input = ts.synthesizeInput()
	return true
}

// normalizeAskUserInput transforms Copilot's ask_user input format
// {question, choices, allow_freeform} to the standard QuestionToolDiff format
// {questions: [{question, header, options: [{label}]}]}.
func normalizeAskUserInput(input string) string {
	var raw struct {
		Question      string   `json:"question"`
		Choices       []string `json:"choices"`
		AllowFreeform bool     `json:"allow_freeform"`
	}
	if err := json.Unmarshal([]byte(input), &raw); err != nil || raw.Question == "" {
		return input
	}
	options := make([]map[string]string, len(raw.Choices))
	for i, c := range raw.Choices {
		options[i] = map[string]string{"label": c}
	}
	transformed := map[string]any{
		"questions": []map[string]any{
			{
				"question": raw.Question,
				"header":   "Question for you",
				"options":  options,
			},
		},
	}
	out, err := json.Marshal(transformed)
	if err != nil {
		slog.Warn("failed to marshal ask_user input", "error", err)
		return "{}"
	}
	return string(out)
}

// splitSQLStatements splits a multi-statement SQL string on semicolons.
func splitSQLStatements(query string) []string {
	var stmts []string
	start := 0
	for i := 0; i < len(query); i++ {
		if query[i] == ';' {
			s := query[start:i]
			s = trimSpace(s)
			if s != "" {
				stmts = append(stmts, s)
			}
			start = i + 1
		}
	}
	s := query[start:]
	s = trimSpace(s)
	if s != "" {
		stmts = append(stmts, s)
	}
	return stmts
}

func trimSpace(s string) string {
	i, j := 0, len(s)-1
	for i <= j && (s[i] == ' ' || s[i] == '\t' || s[i] == '\n' || s[i] == '\r') {
		i++
	}
	for j >= i && (s[j] == ' ' || s[j] == '\t' || s[j] == '\n' || s[j] == '\r') {
		j--
	}
	if i > j {
		return ""
	}
	return s[i : j+1]
}
