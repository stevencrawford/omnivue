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
		SELECT message_id, data, time_created, time_updated FROM part
		WHERE message_id IN (SELECT id FROM message WHERE session_id = ?)
		ORDER BY message_id, time_created ASC, id ASC
	`, sessionID)
	if err != nil {
		return nil, fmt.Errorf("querying parts: %w", err)
	}
	defer partRows.Close()

	type partRow struct {
		messageID   string
		dataJSON    string
		timeCreated int64
		timeUpdated int64
		partData
	}
	partsByMsg := make(map[string][]partRow, len(msgRows))
	for partRows.Next() {
		var pr partRow
		if err := partRows.Scan(&pr.messageID, &pr.dataJSON, &pr.timeCreated, &pr.timeUpdated); err != nil {
			continue
		}
		var p partData
		if err := json.Unmarshal([]byte(pr.dataJSON), &p); err == nil {
			pr.partData = p
			partsByMsg[pr.messageID] = append(partsByMsg[pr.messageID], pr)
		}
	}

	messages := make([]ingest.Message, 0, len(msgRows))
	var pendingCompaction *ingest.ToolCall
	var prevModel string

	// Step-attributed token/cost tracking. OpenCode records token usage at the
	// step level (step-finish parts), not per tool call. We assign each tool part
	// to the step open when it was emitted, then back-fill that step's totals once
	// its step-finish arrives. toolStep maps a tool callID to its step; stepUsage
	// holds the totals for each closed step.
	type stepUsageT struct {
		tokens ingest.StepTokens
		cost   float64
		has    bool
	}
	type stepTracker struct {
		curStep   int
		toolStep  map[string]int
		stepUsage map[int]stepUsageT
	}
	trk := stepTracker{toolStep: make(map[string]int, len(msgRows)*2), stepUsage: make(map[int]stepUsageT)}

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

		var reasoningUpdated int64
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
				if p.timeUpdated > reasoningUpdated {
					reasoningUpdated = p.timeUpdated
				}
			case "step-start":
				trk.curStep++
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
				su := stepUsageT{cost: p.Cost, has: p.Cost != 0}
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
					su.tokens = se.Tokens
					if se.Tokens.Input != 0 || se.Tokens.Output != 0 || se.Tokens.CacheRead != 0 || se.Tokens.CacheWrite != 0 {
						su.has = true
					}
				}
				if su.has {
					trk.stepUsage[trk.curStep] = su
				}
				msg.StepEvents = append(msg.StepEvents, se)
			case "tool":
				trk.toolStep[p.CallID] = trk.curStep
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
				inputJSON := marshalCompactionInput(p.partData)
				pendingCompaction = &ingest.ToolCall{
					ID:     p.CallID,
					Name:   "compaction",
					Input:  inputJSON,
					Status: ingest.ToolCallCompleted,
				}
				msg.Content = ""
				msg.Reasoning = ""
				reasoningUpdated = 0
				msg.StepEvents = nil
				msg.ToolCalls = nil
			}
		}

		if reasoningUpdated > 0 {
			t := time.UnixMilli(reasoningUpdated)
			msg.ReasoningAt = &t
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

	// Back-fill per-tool-call usage from the closed step totals recorded above.
	for mi := range messages {
		for ci := range messages[mi].ToolCalls {
			tc := &messages[mi].ToolCalls[ci]
			step, ok := trk.toolStep[tc.ID]
			if !ok {
				continue
			}
			su, ok := trk.stepUsage[step]
			if !ok {
				continue
			}
			usage := ingest.ToolUsage{Tokens: su.tokens, Cost: su.cost, Source: ingest.UsageStep}
			tc.Usage = &usage
		}
	}

	return messages, nil
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
