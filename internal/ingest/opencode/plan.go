package opencode

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/stevencrawford/omnivue/internal/ingest"
	"github.com/stevencrawford/omnivue/internal/ingest/ingestkit"
)

func (a *Adapter) planFromLastMessage(ctx context.Context, sessionID string) (*ingest.Plan, error) {
	// Get the last assistant message
	var lastMsgID string
	err := a.db.QueryRowContext(ctx, `
		SELECT id FROM message
		WHERE session_id = ? AND json_extract(data, '$.role') = 'assistant'
		ORDER BY time_created DESC, id DESC
		LIMIT 1
	`, sessionID).Scan(&lastMsgID)
	if err != nil {
		return nil, nil
	}

	// Get text and reasoning parts from the last message
	rows, err := a.db.QueryContext(ctx, `
		SELECT data FROM part
		WHERE message_id = ? AND json_extract(data, '$.type') IN ('text', 'reasoning')
		ORDER BY time_created ASC, id ASC
	`, lastMsgID)
	if err != nil {
		return nil, fmt.Errorf("querying last message parts: %w", err)
	}
	defer rows.Close()

	var sections []string
	for rows.Next() {
		var dataJSON string
		if err := rows.Scan(&dataJSON); err != nil {
			continue
		}
		var p partData
		if err := json.Unmarshal([]byte(dataJSON), &p); err != nil {
			continue
		}
		if strings.Contains(p.Text, "## ") && len(p.Text) > 200 {
			sections = append(sections, p.Text)
		}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	if len(sections) == 0 {
		return nil, nil
	}

	md := strings.Join(sections, "\n\n---\n\n")
	return &ingest.Plan{Markdown: md, Source: "synthesized"}, nil
}

func (a *Adapter) findTaskOutput(ctx context.Context, parentID, childID string) (string, error) {
	rows, err := a.db.QueryContext(ctx, `
		SELECT p.data
		FROM part p
		JOIN message m ON p.message_id = m.id
		WHERE m.session_id = ?
		  AND json_extract(m.data, '$.role') = 'assistant'
		  AND json_extract(p.data, '$.type') = 'tool'
		  AND json_extract(p.data, '$.tool') = 'task'
	`, parentID)
	if err != nil {
		return "", fmt.Errorf("querying task parts: %w", err)
	}
	defer rows.Close()

	for rows.Next() {
		var dataJSON string
		if err := rows.Scan(&dataJSON); err != nil {
			continue
		}
		var p partData
		if err := json.Unmarshal([]byte(dataJSON), &p); err != nil {
			continue
		}
		if p.State.Metadata == nil {
			continue
		}
		meta, ok := p.State.Metadata.(map[string]any)
		if !ok {
			continue
		}
		sid, _ := meta["sessionId"].(string)
		if sid == childID {
			return p.State.Output, nil
		}
	}
	return "", rows.Err()
}

func (a *Adapter) planFromMessages(ctx context.Context, sessionID string) (*ingest.Plan, error) {
	rows, err := a.db.QueryContext(ctx, `
		SELECT p.data
		FROM part p
		JOIN message m ON p.message_id = m.id
		WHERE p.session_id = ?
		  AND json_extract(m.data, '$.role') = 'assistant'
		  AND json_extract(p.data, '$.type') = 'text'
		ORDER BY m.time_created ASC, p.time_created ASC
	`, sessionID)
	if err != nil {
		return nil, fmt.Errorf("querying plan parts: %w", err)
	}

	var sections []string
	for rows.Next() {
		var dataJSON string
		if err := rows.Scan(&dataJSON); err != nil {
			continue
		}
		var p partData
		if err := json.Unmarshal([]byte(dataJSON), &p); err != nil {
			continue
		}
		if ingestkit.HasPlanContent(p.Text) {
			sections = append(sections, p.Text)
		}
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}

	// Also include plan items from todowrite tool call inputs
	todoRows, err := a.db.QueryContext(ctx, `
		SELECT p.data
		FROM part p
		WHERE p.session_id = ?
		  AND json_extract(p.data, '$.type') = 'tool'
		  AND json_extract(p.data, '$.tool') = 'todowrite'
		ORDER BY p.time_created ASC
	`, sessionID)
	if err == nil {
		var todoSections []string
		for todoRows.Next() {
			var dataJSON string
			if err := todoRows.Scan(&dataJSON); err != nil {
				continue
			}
			var p partData
			if err := json.Unmarshal([]byte(dataJSON), &p); err != nil {
				continue
			}
			if p.State.Input == nil {
				continue
			}
			inputJSON := ingestkit.MarshalJSON(p.State.Input)
			if inputJSON == "" {
				continue
			}
			var items []todoItem
			if err := json.Unmarshal([]byte(inputJSON), &items); err != nil {
				continue
			}
			for _, item := range items {
				if item.Content != "" {
					prefix := "- [ ]"
					switch item.Status {
					case "completed":
						prefix = "- [x]"
					case "in_progress":
						prefix = "- [/]"
					case "canceled":
						prefix = "- [-]"
					}
					content := item.Content
					if !strings.HasPrefix(strings.TrimSpace(content), "- [") {
						content = prefix + " " + content
					}
					todoSections = append(todoSections, content)
				}
			}
		}
		todoRows.Close()
		if len(todoSections) > 0 {
			sections = append(sections, "## Plan Items\n\n"+strings.Join(todoSections, "\n"))
		}
	}

	if len(sections) == 0 {
		return nil, nil
	}

	md := strings.Join(sections, "\n\n---\n\n")
	return &ingest.Plan{
		Markdown: md,
		Source:   "synthesized",
	}, nil
}

func stripTaskWrapper(output string) string {
	lines := strings.Split(output, "\n")
	var result []string
	for _, line := range lines {
		trimmed := strings.TrimSpace(line)
		if trimmed == "" || trimmed == "<task_result>" || trimmed == "</task_result>" || trimmed == "</task>" {
			continue
		}
		if strings.HasPrefix(trimmed, "<task ") && strings.HasSuffix(trimmed, ">") {
			continue
		}
		result = append(result, line)
	}
	return strings.TrimSpace(strings.Join(result, "\n"))
}
