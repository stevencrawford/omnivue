package cursor

import (
	"encoding/json"
	"strings"
)

// formatGlobOutput parses Cursor's glob output JSON and returns a
// newline-separated list of file paths suitable for the frontend.
// Returns "" if the JSON doesn't match the expected format.
func formatGlobOutput(raw string) string {
	var resp struct {
		Directories []struct {
			AbsPath string `json:"absPath"`
			Files   []struct {
				RelPath string `json:"relPath"`
			} `json:"files"`
		} `json:"directories"`
	}
	if err := json.Unmarshal([]byte(raw), &resp); err != nil {
		return ""
	}
	var lines []string
	for _, dir := range resp.Directories {
		for _, f := range dir.Files {
			p := f.RelPath
			if dir.AbsPath != "" && !strings.HasPrefix(p, "/") {
				p = dir.AbsPath + "/" + p
			}
			lines = append(lines, p)
		}
	}
	return strings.Join(lines, "\n")
}

// extractBashOutput parses Cursor's run_terminal output JSON and returns the
// text output plus whether the command was rejected (non-zero exit).
func extractBashOutput(raw string) (text string, rejected bool) {
	var resp struct {
		Output   string `json:"output"`
		Rejected bool   `json:"rejected"`
	}
	if err := json.Unmarshal([]byte(raw), &resp); err != nil {
		return raw, false
	}
	return resp.Output, resp.Rejected
}

// formatLegacyGlobOutput parses Cursor's legacy list_dir output JSON:
//
//	{"files":[{"name":"...","isDirectory":true}],"directoryRelativeWorkspacePath":"..."}
//
// -> newline-separated file paths. Returns "" on mismatch.
func formatLegacyGlobOutput(raw string) string {
	var resp struct {
		Files []struct {
			Name string `json:"name"`
		} `json:"files"`
		DirectoryRelWorkspacePath string `json:"directoryRelativeWorkspacePath"`
	}
	if err := json.Unmarshal([]byte(raw), &resp); err != nil {
		return ""
	}
	if len(resp.Files) == 0 {
		return ""
	}
	var lines []string
	for _, f := range resp.Files {
		p := f.Name
		if resp.DirectoryRelWorkspacePath != "" {
			p = resp.DirectoryRelWorkspacePath + "/" + p
		}
		lines = append(lines, p)
	}
	return strings.Join(lines, "\n")
}

// formatGrepOutput parses Cursor's output JSON and extracts plain text.
// Legacy grep_search: {"files":[{"uri":"..."}],"numResults":N} -> newline-separated URIs.
// Modern ripgrep output is already plain text - returned as-is.
func formatGrepOutput(raw string) string {
	// Modern ripgrep output is plain text (not JSON), return as-is unless it's the JSON format
	if raw == "" {
		return ""
	}
	if raw[0] != '{' {
		return raw
	}
	var resp struct {
		Files []struct {
			URI string `json:"uri"`
		} `json:"files"`
	}
	if err := json.Unmarshal([]byte(raw), &resp); err != nil {
		return raw
	}
	if len(resp.Files) == 0 {
		return raw
	}
	var lines []string
	for _, f := range resp.Files {
		lines = append(lines, f.URI)
	}
	return strings.Join(lines, "\n") + "\n"
}
