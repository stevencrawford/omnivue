package copilot

import (
	"context"
	"database/sql"
	"fmt"

	"github.com/stevencrawford/omnivue/internal/ingest"
	"github.com/stevencrawford/omnivue/internal/ingest/ingestkit"
)

func (a *Adapter) Messages(ctx context.Context, sessionID string) ([]ingest.Message, error) {
	a.mu.Lock()
	if syn, ok := a.syntheticSessions[sessionID]; ok {
		a.mu.Unlock()
		return syn.messages, nil
	}
	a.mu.Unlock()

	messages, err := a.messagesFromEvents(sessionID)
	if err == nil && len(messages) > 0 {
		return messages, nil
	}

	return a.messagesFromTurns(ctx, sessionID)
}

func (a *Adapter) messagesFromTurns(ctx context.Context, sessionID string) ([]ingest.Message, error) {
	rows, err := a.db.QueryContext(ctx, `
		SELECT turn_index, user_message, assistant_response, timestamp
		FROM turns
		WHERE session_id = ?
		ORDER BY turn_index ASC
	`, sessionID)
	if err != nil {
		return nil, fmt.Errorf("querying turns: %w", err)
	}
	defer rows.Close()

	var messages []ingest.Message
	for rows.Next() {
		var (
			turnIndex int
			userMsg   sql.NullString
			assistMsg sql.NullString
			timestamp string
		)
		if err := rows.Scan(&turnIndex, &userMsg, &assistMsg, &timestamp); err != nil {
			return nil, fmt.Errorf("scanning turn: %w", err)
		}

		ts := ingestkit.ParseTime(timestamp)

		if userMsg.Valid && userMsg.String != "" {
			messages = append(messages, ingest.Message{
				ID:        fmt.Sprintf("%s-turn-%d-user", sessionID, turnIndex),
				Role:      ingest.MessageRoleUser,
				Content:   userMsg.String,
				Timestamp: ts,
			})
		}

		if assistMsg.Valid && assistMsg.String != "" {
			messages = append(messages, ingest.Message{
				ID:        fmt.Sprintf("%s-turn-%d-assistant", sessionID, turnIndex),
				Role:      ingest.MessageRoleAssistant,
				Content:   assistMsg.String,
				Timestamp: ts,
			})
		}
	}

	return messages, rows.Err()
}
