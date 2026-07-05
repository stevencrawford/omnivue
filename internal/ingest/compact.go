package ingest

import "encoding/json"

type compactionInput struct {
	Kind  string `json:"kind"`
	Count int    `json:"count"`
}

// InsertCompactionMarkers compacts consecutive same-name tool calls within each message
// into a single compaction marker. For example:
//
//	[read, read, read, grep, grep, read]
//	→ [compaction{kind:read,count:3}, compaction{kind:grep,count:2}, read]
func InsertCompactionMarkers(messages []Message) []Message {
	result := make([]Message, len(messages))
	for i, msg := range messages {
		result[i] = msg
		result[i].ToolCalls = compactToolCalls(msg.ToolCalls)
	}
	return result
}

func compactToolCalls(tcs []ToolCall) []ToolCall {
	if len(tcs) == 0 {
		return tcs
	}

	var result []ToolCall
	runStart := 0
	for i := 1; i <= len(tcs); i++ {
		if i < len(tcs) && tcs[i].Name == tcs[runStart].Name {
			continue
		}
		count := i - runStart
		if count > 1 {
			kind := tcs[runStart].Name
			input, _ := json.Marshal(compactionInput{
				Kind:  kind,
				Count: count,
			})
			result = append(result, ToolCall{
				ID:     tcs[runStart].ID + "_compacted",
				Name:   "compaction",
				Input:  string(input),
				Status: ToolCallCompleted,
			})
		} else {
			result = append(result, tcs[runStart])
		}
		runStart = i
	}
	return result
}
