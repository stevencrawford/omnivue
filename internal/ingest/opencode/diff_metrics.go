package opencode

import (
	"context"
	"fmt"
	"strings"
)

func (a *Adapter) computeDiffMetrics(ctx context.Context, ids []string) (map[string][3]int, error) {
	if len(ids) == 0 {
		return nil, nil
	}

	placeholders := make([]string, len(ids))
	args := make([]any, len(ids))
	for i, id := range ids {
		placeholders[i] = "?"
		args[i] = id
	}

	//nolint:gosec
	query := fmt.Sprintf(`
		SELECT
			m.session_id,
			COUNT(DISTINCT COALESCE(
				json_extract(p.data, '$.state.input.filePath'),
				json_extract(p.data, '$.state.input.file_path'),
				json_extract(p.data, '$.state.input.path')
			)) as file_count,
			COALESCE(SUM(CASE
				WHEN json_extract(p.data, '$.tool') = 'edit'
					THEN CASE
						WHEN json_extract(p.data, '$.state.input.newString') IS NOT NULL
						 AND json_extract(p.data, '$.state.input.newString') != ''
						THEN LENGTH(json_extract(p.data, '$.state.input.newString'))
						   - LENGTH(REPLACE(json_extract(p.data, '$.state.input.newString'), CHAR(10), '')) + 1
						ELSE 0
					END
				WHEN json_extract(p.data, '$.tool') = 'write'
					THEN CASE
						WHEN json_extract(p.data, '$.state.input.content') IS NOT NULL
						 AND json_extract(p.data, '$.state.input.content') != ''
						THEN LENGTH(json_extract(p.data, '$.state.input.content'))
						   - LENGTH(REPLACE(json_extract(p.data, '$.state.input.content'), CHAR(10), '')) + 1
						ELSE 0
					END
				ELSE 0
			END), 0) as total_additions,
			COALESCE(SUM(CASE
				WHEN json_extract(p.data, '$.tool') = 'edit'
					THEN CASE
						WHEN json_extract(p.data, '$.state.input.oldString') IS NOT NULL
						 AND json_extract(p.data, '$.state.input.oldString') != ''
						THEN LENGTH(json_extract(p.data, '$.state.input.oldString'))
						   - LENGTH(REPLACE(json_extract(p.data, '$.state.input.oldString'), CHAR(10), '')) + 1
						ELSE 0
					END
				ELSE 0
			END), 0) as total_deletions
		FROM part p
		JOIN message m ON p.message_id = m.id
		WHERE m.session_id IN (%s)
		  AND json_extract(p.data, '$.type') = 'tool'
		  AND json_extract(p.data, '$.tool') IN ('edit', 'write')
		GROUP BY m.session_id
	`, strings.Join(placeholders, ","))

	rows, err := a.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("computing diff metrics: %w", err)
	}
	defer rows.Close()

	computed := make(map[string][3]int, len(ids))
	for rows.Next() {
		var sid string
		var files, adds, dels int
		if err := rows.Scan(&sid, &files, &adds, &dels); err != nil {
			continue
		}
		computed[sid] = [3]int{files, adds, dels}
	}

	return computed, rows.Err()
}
