package cursor

import (
	"encoding/json"
	"time"

	"github.com/stevencrawford/omnivue/internal/ingest"
)

type composerContext struct {
	Mentions *mentionsData `json:"mentions,omitempty"`
}

type mentionsData struct {
	FolderSelections map[string][]any `json:"folderSelections,omitempty"`
}

type composerData struct {
	V                             int                    `json:"_v"`
	ComposerID                    string                 `json:"composerId"`
	Name                          string                 `json:"name"`
	CreatedAt                     json.Number            `json:"createdAt"`
	LastUpdatedAt                 json.Number            `json:"lastUpdatedAt"`
	Status                        string                 `json:"status"`
	IsAgentic                     bool                   `json:"isAgentic"`
	LatestConversationSummary     *conversationSummary   `json:"latestConversationSummary,omitempty"`
	FullConversationHeadersOnly   []bubbleReference      `json:"fullConversationHeadersOnly,omitempty"`
	UsageData                     json.RawMessage        `json:"usageData,omitempty"`
	Context                       *composerContext       `json:"context,omitempty"`
	ConversationState             string                 `json:"conversationState,omitempty"`
	UnifiedMode                   string                 `json:"unifiedMode,omitempty"`
	AllAttachedFileCodeChunksUris []string               `json:"allAttachedFileCodeChunksUris,omitempty"`
}

type conversationSummary struct {
	Summary      *conversationSummaryInner `json:"summary,omitempty"`
	LastBubbleID string                    `json:"lastBubbleId,omitempty"`
}

type conversationSummaryInner struct {
	Summary string `json:"summary"`
}

type bubbleReference struct {
	BubbleID string `json:"bubbleId"`
	Type     int    `json:"type"`
}

type usageStat struct {
	CostInCents float64 `json:"costInCents"`
	Amount      float64 `json:"amount"`
}

type bubbleData struct {
	V                 int              `json:"_v"`
	Type              int              `json:"type"`
	BubbleID          string           `json:"bubbleId"`
	Text              string           `json:"text"`
	RichText          json.RawMessage  `json:"richText,omitempty"`
	IsAgentic         bool             `json:"isAgentic"`
	TokenCount        *tokenData       `json:"tokenCount,omitempty"`
	ToolFormerData    *toolData        `json:"toolFormerData,omitempty"`
	Capabilities      []capabilityData `json:"capabilities,omitempty"`
	CodeBlocks        []codeBlockData  `json:"codeBlocks,omitempty"`
	RelevantFiles     []string         `json:"relevantFiles,omitempty"`
	CreatedAt         string           `json:"createdAt"`
	ConversationState string           `json:"conversationState,omitempty"`
}

type tokenData struct {
	InputTokens  int `json:"inputTokens"`
	OutputTokens int `json:"outputTokens"`
}

type toolData struct {
	Tool        int    `json:"tool"`
	ToolIndex   int    `json:"toolIndex"`
	ModelCallID string `json:"modelCallId"`
	ToolCallID  string `json:"toolCallId"`
	Status      string `json:"status"`
	Name        string `json:"name"`
	Params      string `json:"params"`
	Result      string `json:"result"`
}

type capabilityData struct {
	Name   string `json:"name"`
	Status string `json:"status"`
}

type codeBlockData struct {
	ID   string `json:"id"`
	Code string `json:"code"`
	Path string `json:"path"`
}

type transcriptSession struct {
	ID        string
	CreatedAt time.Time
	UpdatedAt time.Time
	Status    string
	Messages  []ingest.Message
}
