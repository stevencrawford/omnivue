package opencode

import (
	"fmt"
	"regexp"
	"strings"
)

// stripToolCalledLine removes the synthetic "Called the ..." tool header line
// from the text preceding a <file-context> block. This line is verbose and
// redundant since the file-context block header already shows the filename.
func stripToolCalledLine(text string) string {
	lines := strings.Split(text, "\n")
	var kept []string
	for _, line := range lines {
		trimmed := strings.TrimSpace(line)
		if strings.HasPrefix(trimmed, "Called the ") {
			continue
		}
		kept = append(kept, line)
	}
	return strings.Join(kept, "\n")
}

// wrapEmbeddedFileContent scans user message text for patterns that suggest
// auto-included file content and wraps them in <file-context> tags for
// collapsible rendering in the frontend. This serves as a fallback heuristic
// for agents that don't set the synthetic flag on auto-included content.
func wrapEmbeddedFileContent(text string) string {
	if len(text) < 200 {
		return text
	}

	// Match OpenCode's XML file read format: <path>...</path>\n<type>...</type>\n<content>...</content>
	xmlRe := regexp.MustCompile(`(?s)(.*?)<path>(.*?)</path>\s*<type>(.*?)</type>\s*<content>\n?(.*?)</content>`)
	text = xmlRe.ReplaceAllStringFunc(text, func(match string) string {
		parts := xmlRe.FindStringSubmatch(match)
		if len(parts) < 5 {
			return match
		}
		before := parts[1]
		filePath := strings.TrimSpace(parts[2])
		content := parts[4]
		// Strip the "Called the Read tool..." header line — it's verbose and
		// redundant since the file-context block header already shows the filename.
		before = stripToolCalledLine(before)
		label := filePath
		if idx := strings.LastIndexAny(filePath, "/\\"); idx >= 0 {
			label = filePath[idx+1:]
		}
		result := before
		if trimmed := strings.TrimSpace(content); trimmed != "" {
			result += fmt.Sprintf("<file-context path=%q>%s</file-context>\n", label, trimmed)
		}
		return result
	})

	// Match code blocks where the language tag includes a file path via colon,
	// e.g. ```typescript:src/foo.ts ... ```
	reLangWithPath := regexp.MustCompile("(?s)```(\\w+):([^\\n]+?)\\n(.+?)```\\n?")
	text = reLangWithPath.ReplaceAllStringFunc(text, func(match string) string {
		parts := reLangWithPath.FindStringSubmatch(match)
		if len(parts) < 4 {
			return match
		}
		filePath := strings.TrimSpace(parts[2])
		content := parts[3]
		if strings.Count(content, "\n") < 10 {
			return match
		}
		return fmt.Sprintf("<file-context path=%q>%s</file-context>\n", filePath, content)
	})

	// Match code blocks preceded by a line that looks like a file path,
	// e.g. "src/foo.ts\n```typescript\n...content...\n```"
	rePathBeforeBlock := regexp.MustCompile("(?s)([^\\n]+/(?:[^\\n]+\\.[a-zA-Z]+|[^\\n]+/))\\n(```\\w+\\n.+?```)\\n?")
	const blockMinLines = 20
	text = rePathBeforeBlock.ReplaceAllStringFunc(text, func(match string) string {
		parts := rePathBeforeBlock.FindStringSubmatch(match)
		if len(parts) < 3 {
			return match
		}
		filePath := strings.TrimSpace(parts[1])
		codeBlock := parts[2]
		lines := strings.Count(codeBlock, "\n")
		if lines < blockMinLines {
			return match
		}
		return fmt.Sprintf("<file-context path=%q>%s</file-context>\n", filePath, codeBlock)
	})

	return text
}
