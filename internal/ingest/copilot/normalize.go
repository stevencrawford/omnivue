package copilot

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"sort"
	"strings"

	"github.com/stevencrawford/omnivue/internal/ingest"
	"github.com/stevencrawford/omnivue/internal/ingest/ingestkit"
)

// normalizeToolCall normalizes copilot-native tool names and input fields to
// the canonical ingest set. Called during assistant message parsing.
func normalizeToolCall(tc *ingest.ToolCall, rawArgs json.RawMessage) {
	if tc.Name == "ask_user" {
		if isPermissionAskUser(tc.Input) {
			tc.Name = "permission_request"
			tc.Input = normalizePermissionInput(tc.Input)
		} else {
			tc.Name = "question"
			tc.Input = normalizeAskUserInput(tc.Input)
		}
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
			filePath, _ := ingestkit.ParseApplyPatch(patchText)
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

// normalizeAskUserInput transforms Copilot's ask_user input formats to the
// standard QuestionToolDiff format
// {questions: [{question, header, options: [{label, description}]}]}.
// Supported shapes:
//
//   - {question, choices, allow_freeform} — single-choice question
//   - {message, requestedSchema} — structured input request where each entry
//     in requestedSchema.properties becomes one question tab; the shared
//     message is prepended to the first tab as context
func normalizeAskUserInput(input string) string {
	if out, ok := normalizeChoiceInput(input); ok {
		return out
	}
	if out, ok := normalizeRequestedSchemaInput(input); ok {
		return out
	}
	return input
}

// normalizeChoiceInput handles the {question, choices} shape. It reports
// false when the input does not match so the caller can try other shapes.
func normalizeChoiceInput(input string) (string, bool) {
	var raw struct {
		Question      string   `json:"question"`
		Choices       []string `json:"choices"`
		AllowFreeform bool     `json:"allow_freeform"`
	}
	if err := json.Unmarshal([]byte(input), &raw); err != nil || raw.Question == "" {
		return "", false
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
		return "{}", true
	}
	return string(out), true
}

// schemaOption is one selectable value inside a requestedSchema property.
type schemaOption struct {
	Value       any    `json:"const"`
	Title       string `json:"title"`
	Description string `json:"description"`
}

// schemaProperty mirrors one entry of requestedSchema.properties.
type schemaProperty struct {
	Type        string         `json:"type"`
	Title       string         `json:"title"`
	Description string         `json:"description"`
	Enum        []any          `json:"enum"`
	OneOf       []schemaOption `json:"oneOf"`
	AnyOf       []schemaOption `json:"anyOf"`
}

// normalizeRequestedSchemaInput handles the {message, requestedSchema} shape
// where requestedSchema.properties maps field names to JSON Schema fragments.
// Each property becomes one question tab; the shared message is prepended to
// the first tab as context. It reports false when the input does not match.
func normalizeRequestedSchemaInput(input string) (string, bool) {
	var raw struct {
		Message         string `json:"message"`
		RequestedSchema struct {
			Properties map[string]schemaProperty `json:"properties"`
		} `json:"requestedSchema"`
	}
	if err := json.Unmarshal([]byte(input), &raw); err != nil {
		return "", false
	}
	if raw.Message == "" || len(raw.RequestedSchema.Properties) == 0 {
		return "", false
	}
	keys := make([]string, 0, len(raw.RequestedSchema.Properties))
	for key := range raw.RequestedSchema.Properties {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	questions := make([]map[string]any, 0, len(keys))
	for i, key := range keys {
		prop := raw.RequestedSchema.Properties[key]
		header := prop.Title
		if header == "" {
			header = key
		}
		prompt := prop.Description
		if prompt == "" {
			prompt = prop.Title
		}
		if prompt == "" {
			prompt = key
		}
		text := prompt
		if i == 0 {
			text = raw.Message + "\n\n---\n\n**" + prompt + "**"
		}
		questions = append(questions, map[string]any{
			"question": text,
			"header":   header,
			"options":  schemaOptions(prop),
		})
	}
	out, err := json.Marshal(map[string]any{"questions": questions})
	if err != nil {
		slog.Warn("failed to marshal requestedSchema input", "error", err)
		return "{}", true
	}
	return string(out), true
}

// schemaOptions derives question options from a schema property. oneOf/anyOf
// entries keep the human title as label and the const value as description so
// answers arriving as raw values still match. Booleans render as Yes/No.
func schemaOptions(prop schemaProperty) []map[string]string {
	choices := prop.OneOf
	if len(choices) == 0 {
		choices = prop.AnyOf
	}
	if len(choices) > 0 {
		options := make([]map[string]string, 0, len(choices))
		for _, c := range choices {
			value := stringifySchemaValue(c.Value)
			label := c.Title
			if label == "" {
				label = value
			}
			option := map[string]string{"label": label}
			desc := c.Description
			if value != "" && value != label {
				if desc != "" {
					desc = value + " — " + desc
				} else {
					desc = value
				}
			}
			if desc != "" {
				option["description"] = desc
			}
			options = append(options, option)
		}
		return options
	}
	if len(prop.Enum) > 0 {
		options := make([]map[string]string, 0, len(prop.Enum))
		for _, v := range prop.Enum {
			if s := stringifySchemaValue(v); s != "" {
				options = append(options, map[string]string{"label": s})
			}
		}
		return options
	}
	if prop.Type == "boolean" {
		return []map[string]string{{"label": "Yes"}, {"label": "No"}}
	}
	return []map[string]string{}
}

// stringifySchemaValue renders a JSON Schema const/enum/default value for
// display and answer matching.
func stringifySchemaValue(v any) string {
	switch value := v.(type) {
	case nil:
		return ""
	case string:
		return value
	case bool:
		if value {
			return "true"
		}
		return "false"
	case float64:
		return fmt.Sprintf("%v", value)
	default:
		out, err := json.Marshal(value)
		if err != nil {
			slog.Warn("failed to marshal schema value", "error", err)
			return ""
		}
		return string(out)
	}
}

// isPermissionAskUser checks whether an ask_user tool call is asking for
// permission to run a command (rather than a general question). Permission
// requests have choices containing "Allow" or "Deny". Structured
// {message, requestedSchema} inputs are never permission requests.
func isPermissionAskUser(input string) bool {
	if strings.Contains(input, `"requestedSchema"`) {
		return false
	}
	var raw struct {
		Question string   `json:"question"`
		Choices  []string `json:"choices"`
	}
	if err := json.Unmarshal([]byte(input), &raw); err != nil || len(raw.Choices) == 0 {
		return false
	}
	for _, c := range raw.Choices {
		lower := strings.ToLower(c)
		if lower == "allow" || lower == "deny" || lower == "allow once" || lower == "allow once for this session" {
			return true
		}
	}
	return false
}

// normalizePermissionInput transforms Copilot's ask_user permission input to
// a standardized format for the permission_request renderer.
func normalizePermissionInput(input string) string {
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
		"command":  raw.Question,
		"options":  options,
	}
	out, err := json.Marshal(transformed)
	if err != nil {
		slog.Warn("failed to marshal permission input", "error", err)
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
