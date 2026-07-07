package opencode

import (
	"encoding/json"
	"strings"

	"github.com/stevencrawford/omnivue/internal/ingest/ingestkit"
)

type modelInfo struct {
	ID       string `json:"id"`
	Provider string `json:"providerID"`
	Variant  string `json:"variant"`
}

func extractModelID(modelJSON string) string {
	if modelJSON == "" {
		return ""
	}
	var m struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal([]byte(modelJSON), &m); err == nil && m.ID != "" {
		return m.ID
	}
	var s string
	if err := json.Unmarshal([]byte(modelJSON), &s); err == nil {
		return s
	}
	return modelJSON
}

func extractModelInfo(modelJSON string) (modelInfo, bool) {
	if modelJSON == "" || modelJSON == "null" {
		return modelInfo{}, false
	}
	var m modelInfo
	if err := json.Unmarshal([]byte(modelJSON), &m); err == nil && m.ID != "" {
		return m, true
	}
	var s string
	if err := json.Unmarshal([]byte(modelJSON), &s); err == nil && s != "" {
		return modelInfo{ID: s}, true
	}
	return modelInfo{}, false
}

func extractSubAgentFromTitle(title string) string {
	idx := strings.Index(title, "(@")
	if idx == -1 {
		return ""
	}
	endIdx := strings.Index(title[idx+2:], " ")
	if endIdx == -1 {
		return ""
	}
	return title[idx+2 : idx+2+endIdx]
}

type compactionInput struct {
	Kind     string `json:"kind"`
	Label    string `json:"label"`
	Auto     bool   `json:"auto"`
	Overflow bool   `json:"overflow"`
}

func marshalCompactionInput(p partData) string {
	auto := false
	if p.Auto != nil {
		auto = *p.Auto
	}
	overflow := false
	if p.Overflow != nil {
		overflow = *p.Overflow
	}
	input := compactionInput{
		Kind:     "context_compaction",
		Label:    "Compaction",
		Auto:     auto,
		Overflow: overflow,
	}
	return ingestkit.MarshalJSON(input)
}
