package opencode

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"time"

	"github.com/stevencrawford/omnivue/internal/ingest"
	"github.com/stevencrawford/omnivue/internal/ingest/ingestkit"
)

func (a *Adapter) Edits(ctx context.Context, sessionID string) ([]ingest.FileEdit, error) {
	rows, err := a.db.QueryContext(ctx, `
		SELECT p.data, m.time_created, m.id,
			(SELECT COUNT(*) FROM message m2 WHERE m2.session_id = m.session_id AND (m2.time_created < m.time_created OR (m2.time_created = m.time_created AND m2.id < m.id))) AS message_index
		FROM part p
		JOIN message m ON p.message_id = m.id
		WHERE p.session_id = ?
		  AND json_extract(p.data, '$.type') = 'tool'
		  AND json_extract(p.data, '$.tool') IN ('edit', 'write')
		ORDER BY m.time_created ASC, p.time_created ASC, p.id ASC
	`, sessionID)
	if err != nil {
		return nil, fmt.Errorf("querying edit parts: %w", err)
	}
	defer rows.Close()

	var edits []ingest.FileEdit
	for rows.Next() {
		var dataJSON string
		var timeCreated int64
		var messageID string
		var messageIndex int
		if err := rows.Scan(&dataJSON, &timeCreated, &messageID, &messageIndex); err != nil {
			continue
		}

		var p partData
		if err := json.Unmarshal([]byte(dataJSON), &p); err != nil {
			continue
		}

		if p.Tool != "edit" && p.Tool != "write" {
			continue
		}

		inputJSON := ingestkit.MarshalJSON(p.State.Input)
		if inputJSON == "" {
			continue
		}

		var in editInput
		if err := json.Unmarshal([]byte(inputJSON), &in); err != nil {
			continue
		}

		filePath := in.FilePathResolved()
		if filePath == "" {
			continue
		}

		edits = append(edits, ingest.FileEdit{
			FilePath:     filePath,
			ToolName:     p.Tool,
			OldStr:       in.OldStrResolved(),
			NewStr:       in.NewStrResolved(),
			Content:      in.Content,
			ViewRange:    in.ViewRange,
			Timestamp:    time.UnixMilli(timeCreated),
			MessageIndex: messageIndex,
			MessageID:    messageID,
		})
	}

	return edits, rows.Err()
}

func (a *Adapter) Diffs(ctx context.Context, sessionID string) ([]ingest.DiffFile, error) {
	var diffsJSON sql.NullString
	err := a.db.QueryRowContext(ctx, `
		SELECT summary_diffs FROM session WHERE id = ?
	`, sessionID).Scan(&diffsJSON)
	if err != nil {
		return nil, fmt.Errorf("querying session diffs: %w", err)
	}

	if !diffsJSON.Valid || diffsJSON.String == "" {
		return nil, nil
	}

	var diffs []ingest.DiffFile
	if err := json.Unmarshal([]byte(diffsJSON.String), &diffs); err != nil {
		return []ingest.DiffFile{{Patch: diffsJSON.String}}, nil
	}
	return diffs, nil
}

func (e *editInput) FilePathResolved() string {
	switch {
	case e.FilePath != "":
		return e.FilePath
	case e.FilePath2 != "":
		return e.FilePath2
	default:
		return e.Path
	}
}

func (e *editInput) OldStrResolved() string {
	if e.OldStr != "" {
		return e.OldStr
	}
	return e.OldString
}

func (e *editInput) NewStrResolved() string {
	if e.NewStr != "" {
		return e.NewStr
	}
	return e.NewString
}
