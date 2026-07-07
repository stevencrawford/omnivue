package cursor

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"os"
	"strings"

	"github.com/stevencrawford/omnivue/internal/ingest"
	"github.com/stevencrawford/omnivue/internal/ingest/ingestkit"
)

func (a *Adapter) Messages(ctx context.Context, sessionID string) ([]ingest.Message, error) {
	if msgs, err := a.readBubbleMessages(ctx, sessionID); err == nil {
		if len(msgs) > 0 {
			return msgs, nil
		}
	} else {
		slog.Debug("cursor: bubble messages unavailable", "session", sessionID, "error", err)
	}
	if msgs := a.readTranscriptMessages(ctx, sessionID); len(msgs) > 0 {
		return msgs, nil
	}
	return nil, nil
}

// parseEditContent extracts file path and old/new content from a tool call,
// handling Cursor's various edit formats:
//   - inline content fields (contents, streamingContent, content, newStr)
//   - content-ID references (beforeContentId/afterContentId in output)
//   - output-embedded diff chunks
func (a *Adapter) parseEditContent(ctx context.Context, tc ingest.ToolCall) (filePath, oldStr, newStr string) {
	var input struct {
		RelativeWorkspacePath string `json:"relativeWorkspacePath"`
		FilePath              string `json:"filePath"`
		Path                  string `json:"path"`
		Contents              string `json:"contents"`
		Content               string `json:"content"`
		NewStr                string `json:"newStr"`
		NewString             string `json:"newString"`
		NewStringSnake        string `json:"new_string"`
		StreamingContent      string `json:"streamingContent"`
		OldStr                string `json:"oldStr"`
		OldString             string `json:"oldString"`
		OldStringSnake        string `json:"old_string"`
	}
	if err := json.Unmarshal([]byte(tc.Input), &input); err != nil {
		return
	}

	filePath = input.FilePath
	if filePath == "" {
		filePath = input.Path
	}
	if filePath == "" {
		filePath = input.RelativeWorkspacePath
	}
	if filePath == "" {
		return
	}

	oldStr = input.OldStr
	if oldStr == "" {
		oldStr = input.OldString
	}
	if oldStr == "" {
		oldStr = input.OldStringSnake
	}

	newStr = input.NewStr
	if newStr == "" {
		newStr = input.StreamingContent
	}
	if newStr == "" {
		newStr = input.NewString
	}
	if newStr == "" {
		newStr = input.NewStringSnake
	}
	if newStr == "" {
		newStr = input.Content
	}
	if newStr == "" {
		newStr = input.Contents
	}

	var output struct {
		BeforeContentID string `json:"beforeContentId"`
		AfterContentID  string `json:"afterContentId"`
		Diff            *struct {
			Chunks []struct {
				DiffString string `json:"diffString"`
			} `json:"chunks"`
		} `json:"diff"`
		Contents string `json:"contents"`
	}
	if err := json.Unmarshal([]byte(tc.Output), &output); err == nil {
		if output.BeforeContentID != "" {
			if c := a.readContentBlock(ctx, output.BeforeContentID); c != "" {
				oldStr = ingestkit.TruncateContent(c, 2000)
			}
		}
		if output.AfterContentID != "" {
			if c := a.readContentBlock(ctx, output.AfterContentID); c != "" {
				newStr = ingestkit.TruncateContent(c, 2000)
			}
		}
		if newStr == "" && output.Contents != "" {
			newStr = output.Contents
		}
	}

	return
}

func (a *Adapter) readContentBlock(ctx context.Context, contentID string) string {
	key := contentID
	if !strings.HasPrefix(key, "composer.content.") {
		key = "composer.content." + key
	}
	var value []byte
	err := a.db.QueryRowContext(ctx,
		`SELECT value FROM cursorDiskKV WHERE key = ?`, key).Scan(&value)
	if err != nil {
		return ""
	}
	return string(value)
}

func (a *Adapter) enrichToolCall(ctx context.Context, tc *ingest.ToolCall) {
	if tc.Name != "edit" {
		return
	}
	var output struct {
		BeforeContentID string `json:"beforeContentId"`
		AfterContentID  string `json:"afterContentId"`
	}
	if err := json.Unmarshal([]byte(tc.Output), &output); err != nil {
		return
	}
	if output.AfterContentID == "" && output.BeforeContentID == "" {
		return
	}
	var input map[string]any
	if err := json.Unmarshal([]byte(tc.Input), &input); err != nil {
		return
	}
	if after := a.readContentBlock(ctx, output.AfterContentID); after != "" {
		if _, exists := input["newString"]; !exists {
			input["newString"] = ingestkit.TruncateContent(after, 2000)
			delete(input, "noCodeblock")
			delete(input, "cloudAgentEdit")
		}
	}
	if before := a.readContentBlock(ctx, output.BeforeContentID); before != "" {
		if _, exists := input["oldString"]; !exists {
			input["oldString"] = ingestkit.TruncateContent(before, 2000)
		}
	}
	if out, err := json.Marshal(input); err == nil {
		tc.Input = string(out)
	}
}

func (a *Adapter) readBubbleMessages(ctx context.Context, sessionID string) ([]ingest.Message, error) {
	var value []byte
	err := a.db.QueryRowContext(ctx,
		`SELECT value FROM cursorDiskKV WHERE key = 'composerData:`+sessionID+`'`).Scan(&value)
	if err != nil {
		return nil, fmt.Errorf("composer session not found: %w", err)
	}

	var cd composerData
	if err := json.Unmarshal(value, &cd); err != nil {
		return nil, fmt.Errorf("parsing composer data: %w", err)
	}

	bubbles := cd.FullConversationHeadersOnly

	var messages []ingest.Message
	for _, ref := range bubbles {
		bubbleKey := fmt.Sprintf("bubbleId:%s:%s", sessionID, ref.BubbleID)
		var bValue []byte
		err := a.db.QueryRowContext(ctx,
			`SELECT value FROM cursorDiskKV WHERE key = ?`, bubbleKey).Scan(&bValue)
		if err != nil {
			continue
		}

		var bd bubbleData
		if err := json.Unmarshal(bValue, &bd); err != nil {
			continue
		}

		role := ingest.MessageRoleUser
		if bd.Type == 2 {
			role = ingest.MessageRoleAssistant
		}

		content := bd.Text
		if content == "" && bd.RichText != nil {
			content = extractTextFromRichText(bd.RichText)
		}

		msg := ingest.Message{
			ID:        bd.BubbleID,
			Role:      role,
			Content:   content,
			Timestamp: ingestkit.ParseTime(bd.CreatedAt),
		}

		if content == "" && role == "assistant" {
			if msg.Metadata == nil {
				msg.Metadata = make(map[string]string)
			}
			msg.Metadata["privacy"] = "true"
		}

		if bd.ToolFormerData != nil {
			tc := ingest.ToolCall{
				ID:     bd.ToolFormerData.ToolCallID,
				Name:   bd.ToolFormerData.Name,
				Input:  bd.ToolFormerData.Params,
				Output: bd.ToolFormerData.Result,
				Status: mapToolStatus(bd.ToolFormerData.Status),
			}
			normalizeToolCall(&tc)
			a.enrichToolCall(ctx, &tc)
			msg.ToolCalls = append(msg.ToolCalls, tc)
		}

		messages = append(messages, msg)
	}

	return messages, nil
}

func parseTranscriptJSONL(path string) []ingest.Message {
	f, err := os.Open(path)
	if err != nil {
		return nil
	}
	defer f.Close()

	var messages []ingest.Message
	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		line := scanner.Bytes()
		if len(line) == 0 {
			continue
		}

		var envelope struct {
			Role    string `json:"role"`
			Message struct {
				Content []struct {
					Type  string          `json:"type"`
					Text  string          `json:"text"`
					Name  string          `json:"name,omitempty"`
					Input json.RawMessage `json:"input,omitempty"`
				} `json:"content"`
			} `json:"message"`
		}
		if err := json.Unmarshal(line, &envelope); err != nil {
			continue
		}

		var contentParts []string
		var toolCalls []ingest.ToolCall
		for _, c := range envelope.Message.Content {
			switch c.Type {
			case "text":
				contentParts = append(contentParts, c.Text)
			case "tool_use":
				tc := ingest.ToolCall{
					ID:     fmt.Sprintf("tool-%d", len(toolCalls)),
					Name:   c.Name,
					Input:  string(c.Input),
					Status: ingest.ToolCallCompleted,
				}
				normalizeToolCall(&tc)
				toolCalls = append(toolCalls, tc)
			}
		}

		messages = append(messages, ingest.Message{
			ID:        fmt.Sprintf("msg-%d", len(messages)),
			Role:      ingest.MessageRole(envelope.Role),
			Content:   strings.Join(contentParts, "\n"),
			ToolCalls: toolCalls,
		})
	}

	return messages
}

func extractTextFromRichText(rt json.RawMessage) string {
	var node struct {
		Text     string            `json:"text"`
		Children []json.RawMessage `json:"children"`
	}
	if err := json.Unmarshal(rt, &node); err != nil {
		return ""
	}
	if node.Text != "" {
		return node.Text
	}
	var parts []string
	for _, child := range node.Children {
		if t := extractTextFromRichText(child); t != "" {
			parts = append(parts, t)
		}
	}
	return strings.Join(parts, "\n")
}
