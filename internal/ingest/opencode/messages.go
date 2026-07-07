package opencode

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/stevencrawford/omnivue/internal/ingest"
	"github.com/stevencrawford/omnivue/internal/ingest/ingestkit"
)

func (a *Adapter) Messages(ctx context.Context, sessionID string) ([]ingest.Message, error) {
	rows, err := a.db.QueryContext(ctx, `
		SELECT id, data, time_created
		FROM message
		WHERE session_id = ?
		ORDER BY time_created ASC, id ASC
	`, sessionID)
	if err != nil {
		return nil, fmt.Errorf("querying messages: %w", err)
	}
	defer rows.Close()

	type msgRow struct {
		id          string
		dataJSON    string
		timeCreated int64
	}
	var msgRows []msgRow
	for rows.Next() {
		var m msgRow
		if err := rows.Scan(&m.id, &m.dataJSON, &m.timeCreated); err != nil {
			return nil, fmt.Errorf("scanning message: %w", err)
		}
		msgRows = append(msgRows, m)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	rows.Close()

	if len(msgRows) == 0 {
		return nil, nil
	}

	// Batch-load parts for all messages in a single query
	msgIDSet := make(map[string]int, len(msgRows))
	msgOrder := make([]string, len(msgRows))
	for i, m := range msgRows {
		msgIDSet[m.id] = i
		msgOrder[i] = m.id
	}

	partRows, err := a.db.QueryContext(ctx, `
		SELECT message_id, data FROM part
		WHERE message_id IN (SELECT id FROM message WHERE session_id = ?)
		ORDER BY message_id, time_created ASC, id ASC
	`, sessionID)
	if err != nil {
		return nil, fmt.Errorf("querying parts: %w", err)
	}
	defer partRows.Close()

	partsByMsg := make(map[string][]partData, len(msgRows))
	for partRows.Next() {
		var messageID, dataJSON string
		if err := partRows.Scan(&messageID, &dataJSON); err != nil {
			continue
		}
		var p partData
		if err := json.Unmarshal([]byte(dataJSON), &p); err == nil {
			partsByMsg[messageID] = append(partsByMsg[messageID], p)
		}
	}

	messages := make([]ingest.Message, 0, len(msgRows))
	var pendingCompaction *ingest.ToolCall
	var prevModel string

	for _, m := range msgRows {
		msg := ingest.Message{
			ID:        m.id,
			Timestamp: time.UnixMilli(m.timeCreated),
		}

		var data messageData
		var curModel string
		var curProvider string
		if err := json.Unmarshal([]byte(m.dataJSON), &data); err == nil {
			msg.Role = ingest.MessageRole(data.Role)
			msg.Agent = data.Agent
			if data.Model != nil {
				modelJSON := ingestkit.MarshalJSON(data.Model)
				msg.Model = extractModelID(modelJSON)
				if mi, ok := extractModelInfo(modelJSON); ok {
					curModel = mi.ID
					curProvider = mi.Provider
				}
			} else if data.ModelID != "" {
				msg.Model = data.ModelID
				curModel = data.ModelID
			}
		}

		for _, p := range partsByMsg[m.id] {
			switch p.Type {
			case "text":
				if msg.Content == "" {
					msg.Content = p.Text
				} else {
					msg.Content += "\n" + p.Text
				}
			case "reasoning":
				if msg.Reasoning == "" {
					msg.Reasoning = p.Text
				} else {
					msg.Reasoning += "\n" + p.Text
				}
			case "step-start":
				msg.StepEvents = append(msg.StepEvents, ingest.StepEvent{
					Step:     ingest.StepEventStart,
					Snapshot: p.Snapshot,
				})
			case "step-finish":
				se := ingest.StepEvent{
					Step:     ingest.StepEventFinish,
					Snapshot: p.Snapshot,
					Reason:   p.Reason,
					Cost:     p.Cost,
				}
				if p.Tokens != nil {
					se.Tokens = ingest.StepTokens{
						Input:     p.Tokens.Input,
						Output:    p.Tokens.Output,
						Reasoning: p.Tokens.Reasoning,
					}
					if p.Tokens.Cache != nil {
						se.Tokens.CacheRead = p.Tokens.Cache.Read
						se.Tokens.CacheWrite = p.Tokens.Cache.Write
					}
				}
				msg.StepEvents = append(msg.StepEvents, se)
			case "tool":
				tc := ingest.ToolCall{
					ID:     p.CallID,
					Name:   p.Tool,
					Input:  ingestkit.MarshalJSON(p.State.Input),
					Output: p.State.Output,
					Status: ingest.ToolCallStatus(p.State.Status),
				}
				if p.State.Metadata != nil {
					tc.Metadata = ingestkit.MarshalJSON(p.State.Metadata)
				}
				if p.State.Time != nil {
					tc.Duration = p.State.Time.End - p.State.Time.Start
				}
				msg.ToolCalls = append(msg.ToolCalls, tc)
			case "compaction":
				inputJSON := marshalCompactionInput(p)
				pendingCompaction = &ingest.ToolCall{
					ID:     p.CallID,
					Name:   "compaction",
					Input:  inputJSON,
					Status: ingest.ToolCallCompleted,
				}
				msg.Content = ""
				msg.Reasoning = ""
				msg.StepEvents = nil
				msg.ToolCalls = nil
			}
		}

		if curModel != "" && prevModel != "" && curModel != prevModel && msg.Role == ingest.MessageRoleAssistant {
			modelInput := map[string]string{"model": curModel}
			if curProvider != "" {
				modelInput["provider"] = curProvider
			}
			tc := ingest.ToolCall{
				ID:     fmt.Sprintf("model-switch-%s", msg.ID),
				Name:   "model_switch",
				Input:  ingestkit.MarshalJSON(modelInput),
				Status: ingest.ToolCallCompleted,
			}
			msg.ToolCalls = append([]ingest.ToolCall{tc}, msg.ToolCalls...)
		}
		if curModel != "" && msg.Role == ingest.MessageRoleAssistant {
			prevModel = curModel
		}

		if pendingCompaction != nil && msg.Role == ingest.MessageRoleAssistant {
			if msg.Content != "" {
				pendingCompaction.Output = msg.Content
				msg.Content = ""
			}
			msg.ToolCalls = append([]ingest.ToolCall{*pendingCompaction}, msg.ToolCalls...)
			pendingCompaction = nil
		}

		if msg.Role == ingest.MessageRoleUser {
			msg.Content = wrapEmbeddedFileContent(msg.Content)
		}

		if msg.Content == "" && len(msg.ToolCalls) == 0 {
			continue
		}

		messages = append(messages, msg)
	}

	return messages, nil
}
