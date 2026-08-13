package ingest

// WithPositions attaches the canonical Position to every message and tool call
// in msgs. Message-level positions carry only MessageID; tool-call positions
// carry both MessageID and ToolCallID. Existing positions are not overwritten.
//
// This is the single chokepoint that makes the backend the source of truth for
// identity, so bookmarks, notifications, and jump targets all reference the
// same stable Position shape regardless of adapter.
func WithPositions(msgs []Message) []Message {
	for i := range msgs {
		msg := &msgs[i]
		if msg.Position == (Position{}) {
			msg.Position = Position{MessageID: msg.ID}
		}
		for j := range msg.ToolCalls {
			tc := &msg.ToolCalls[j]
			if tc.Position == (Position{}) {
				tc.Position = Position{MessageID: msg.ID, ToolCallID: tc.ID}
			}
			if tc.MessageID == "" {
				tc.MessageID = msg.ID
			}
		}
	}
	return msgs
}
