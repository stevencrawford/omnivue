package ingest

import "github.com/stevencrawford/omnivue/internal/ingest/ingestkit"

// DefaultMessageContentBytes is the default maximum size, in bytes, of a
// single message's Content or Reasoning before it is truncated for delivery.
// A single oversized text part (e.g. corrupted multi-megabyte streaming
// output) would otherwise stall the frontend's synchronous markdown renderer.
const DefaultMessageContentBytes = 512 * 1024

// CapMessage truncates msg.Content and msg.Reasoning to maxBytes each. Tool
// calls and other metadata are preserved unchanged. Zero or negative maxBytes
// falls back to DefaultMessageContentBytes.
func CapMessage(msg Message, maxBytes int) Message {
	if maxBytes <= 0 {
		maxBytes = DefaultMessageContentBytes
	}
	if len(msg.Content) > maxBytes {
		msg.Content = ingestkit.TruncateContent(msg.Content, maxBytes)
	}
	if len(msg.Reasoning) > maxBytes {
		msg.Reasoning = ingestkit.TruncateContent(msg.Reasoning, maxBytes)
	}
	return msg
}

// CapMessages truncates each message's Content and Reasoning in place using
// the given byte limit.
func CapMessages(msgs []Message, maxBytes int) {
	if len(msgs) == 0 {
		return
	}
	for i := range msgs {
		msgs[i] = CapMessage(msgs[i], maxBytes)
	}
}
