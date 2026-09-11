package copilot

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/stevencrawford/omnivue/internal/ingest"
)

const requestedSchemaInput = `{
  "message": "I recommend (A). Which do you want?",
  "requestedSchema": {
    "properties": {
      "scope": {
        "type": "string",
        "title": "Context enrichment scope",
        "oneOf": [
          {"const": "carpool_only", "title": "A) Carpool events only (recommended, minimal blast radius)"},
          {"const": "all_supplies", "title": "B) All supply sources (more strategic, wider blast radius)"}
        ],
        "default": "carpool_only"
      },
      "visitor_id_ok": {
        "type": "boolean",
        "title": "OK to leave x-visitor-id as default empty string?",
        "default": true
      }
    }
  }
}`

func decodeQuestions(t *testing.T, input string) []struct {
	Question string `json:"question"`
	Header   string `json:"header"`
	Options  []struct {
		Label       string `json:"label"`
		Description string `json:"description"`
	} `json:"options"`
} {
	t.Helper()
	var decoded struct {
		Questions []struct {
			Question string `json:"question"`
			Header   string `json:"header"`
			Options  []struct {
				Label       string `json:"label"`
				Description string `json:"description"`
			} `json:"options"`
		} `json:"questions"`
	}
	if err := json.Unmarshal([]byte(input), &decoded); err != nil {
		t.Fatalf("unmarshal normalized input: %v", err)
	}
	return decoded.Questions
}

func TestNormalizeAskUserInput_RequestedSchema(t *testing.T) {
	out := normalizeAskUserInput(requestedSchemaInput)
	questions := decodeQuestions(t, out)
	if len(questions) != 2 {
		t.Fatalf("expected 2 questions, got %d: %s", len(questions), out)
	}
	if questions[0].Header != "Context enrichment scope" {
		t.Errorf("expected scope header first (sorted keys), got %q", questions[0].Header)
	}
	if !strings.Contains(questions[0].Question, "I recommend (A)") {
		t.Errorf("expected shared message in first question, got %q", questions[0].Question)
	}
	if len(questions[0].Options) != 2 {
		t.Fatalf("expected 2 scope options, got %d", len(questions[0].Options))
	}
	if questions[0].Options[0].Label != "A) Carpool events only (recommended, minimal blast radius)" {
		t.Errorf("expected human title as label, got %q", questions[0].Options[0].Label)
	}
	if questions[0].Options[0].Description != "carpool_only" {
		t.Errorf("expected const value as description, got %q", questions[0].Options[0].Description)
	}
	if questions[1].Header != "OK to leave x-visitor-id as default empty string?" {
		t.Errorf("expected visitor header, got %q", questions[1].Header)
	}
	if len(questions[1].Options) != 2 ||
		questions[1].Options[0].Label != "Yes" ||
		questions[1].Options[1].Label != "No" {
		t.Errorf("expected Yes/No options for boolean, got %+v", questions[1].Options)
	}
}

func TestNormalizeAskUserInput_ChoicesUnchanged(t *testing.T) {
	out := normalizeAskUserInput(`{"question":"Proceed?","choices":["Yes","No"],"allow_freeform":false}`)
	questions := decodeQuestions(t, out)
	if len(questions) != 1 || questions[0].Question != "Proceed?" {
		t.Fatalf("expected single choice question, got %s", out)
	}
	if len(questions[0].Options) != 2 {
		t.Fatalf("expected 2 options, got %s", out)
	}
}

func TestNormalizeAskUserInput_Passthrough(t *testing.T) {
	for _, input := range []string{`{}`, `not json`, `{"message":"no schema"}`} {
		if got := normalizeAskUserInput(input); got != input {
			t.Errorf("expected passthrough for %q, got %q", input, got)
		}
	}
}

func TestIsPermissionAskUser_RequestedSchemaNeverPermission(t *testing.T) {
	if isPermissionAskUser(requestedSchemaInput) {
		t.Error("expected requestedSchema input to never classify as permission")
	}
}

func TestNormalizeToolCall_RequestedSchemaBecomesQuestion(t *testing.T) {
	tc := &ingest.ToolCall{Name: "ask_user", Input: requestedSchemaInput}
	normalizeToolCall(tc, json.RawMessage(requestedSchemaInput))
	if tc.Name != "question" {
		t.Fatalf("expected question name, got %q", tc.Name)
	}
	questions := decodeQuestions(t, tc.Input)
	if len(questions) != 2 {
		t.Fatalf("expected 2 normalized questions, got %s", tc.Input)
	}
}
