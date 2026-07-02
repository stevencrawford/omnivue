package util

import (
	"bufio"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

const (
	// DefaultJSONLBufferSize is the initial buffer size for bufio.Scanner when reading JSONL lines.
	// File content embedded in JSONL lines can exceed the default 64KB limit.
	DefaultJSONLBufferSize = 512 * 1024
)

// ParseTime tries multiple ISO 8601 format layouts to parse a timestamp string.
// Returns zero time if parsing fails.
func ParseTime(s string) time.Time {
	layouts := []string{
		time.RFC3339Nano,
		time.RFC3339,
		"2006-01-02T15:04:05.999Z07:00",
		"2006-01-02T15:04:05.000Z",
		"2006-01-02T15:04:05.999Z",
		"2006-01-02T15:04:05Z",
		"2006-01-02T15:04:05Z07:00",
		"2006-01-02T15:04:05.999999999Z",
		"2006-01-02T15:04:05.999999Z",
		"2006-01-02 15:04:05.999",
		"2006-01-02 15:04:05",
	}
	for _, layout := range layouts {
		if t, err := time.Parse(layout, s); err == nil {
			return t
		}
	}
	return time.Time{}
}

// ParseMillis parses a string as milliseconds since Unix epoch.
// Accepts integer (milliseconds) or float (seconds).
func ParseMillis(s string) int64 {
	if s == "" {
		return 0
	}
	// Try integer (milliseconds)
	var n int64
	if _, err := fmt.Sscanf(s, "%d", &n); err == nil {
		return n
	}
	// Try float (seconds with decimals)
	var f float64
	if _, err := fmt.Sscanf(s, "%f", &f); err == nil {
		return int64(f) //nolint:gosec
	}
	return 0
}

// UnixMillis converts milliseconds since Unix epoch to time.Time.
// Returns zero time if ms <= 0.
func UnixMillis(ms int64) time.Time {
	if ms <= 0 {
		return time.Time{}
	}
	return time.UnixMilli(ms)
}

// ExtractJSONString extracts a string value from a JSON field, returning empty
// if the field is missing, not a string, or if the input is not valid JSON.
func ExtractJSONString(raw, field string) string {
	if raw == "" {
		return ""
	}
	var m map[string]any
	if err := json.Unmarshal([]byte(raw), &m); err != nil {
		return ""
	}
	v, ok := m[field]
	if !ok {
		return ""
	}
	if s, ok := v.(string); ok {
		return s
	}
	return ""
}

// MarshalJSON marshals v to a JSON string, falling back to fmt.Sprintf.
func MarshalJSON(v any) string {
	if v == nil {
		return ""
	}
	if s, ok := v.(string); ok {
		return s
	}
	b, err := json.Marshal(v)
	if err != nil {
		return fmt.Sprintf("%v", v)
	}
	return string(b)
}

// NewJSONLScanner creates a bufio.Scanner with a buffer sized for long JSONL lines.
func NewJSONLScanner(f *os.File) *bufio.Scanner {
	scanner := bufio.NewScanner(f)
	scanner.Buffer(make([]byte, 0, DefaultJSONLBufferSize), DefaultJSONLBufferSize)
	return scanner
}

// OpenJSONL opens a file and returns a scanner for it.
// The caller must close the returned *os.File when done.
func OpenJSONL(path string) (*bufio.Scanner, *os.File, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, nil, err
	}
	return NewJSONLScanner(f), f, nil
}

// PathExists reports whether a filesystem path exists.
func PathExists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}

// ExpandHome replaces a leading "~/" with the user's home directory.
// Returns the original path if expansion fails or the path doesn't start with "~/".
func ExpandHome(path string) string {
	if len(path) > 1 && path[:2] == "~/" {
		home, err := os.UserHomeDir()
		if err != nil {
			return path
		}
		return filepath.Join(home, path[2:])
	}
	return path
}

// DeriveRepository creates a repository identifier from directory and project name.
func DeriveRepository(directory, projectName string) string {
	if projectName != "" {
		return projectName
	}
	return filepath.Base(directory)
}

// DeriveRepoFromURL extracts a repository name from a git URL.
func DeriveRepoFromURL(repoURL string) string {
	if repoURL == "" {
		return ""
	}
	repoURL = strings.TrimSuffix(repoURL, ".git")
	if idx := strings.LastIndex(repoURL, "/"); idx >= 0 {
		return repoURL[idx+1:]
	}
	return repoURL
}

// TruncateContent truncates content to maxBytes, breaking at the last newline
// within the limit so we don't split mid-line.
func TruncateContent(s string, maxBytes int) string {
	if len(s) <= maxBytes {
		return s
	}
	end := strings.LastIndex(s[:maxBytes], "\n")
	if end < 0 {
		end = maxBytes
	}
	return s[:end] + "\n… (truncated)"
}

// FindCursorVscdbPath resolves a Cursor entry path (directory or file) to the
// actual state.vscdb database path. It searches common locations relative to
// the entry point and falls back to macOS/Linux App Support paths.
// Returns the resolved path or empty string if not found.
func FindCursorVscdbPath(entry string) string {
	if entry == "" {
		return ""
	}
	candidates := []string{
		entry,
		filepath.Join(entry, "state.vscdb"),
		filepath.Join(entry, "User", "globalStorage", "state.vscdb"),
	}
	home, err := os.UserHomeDir()
	if err == nil {
		candidates = append(candidates,
			filepath.Join(home, "Library", "Application Support", "Cursor", "User", "globalStorage", "state.vscdb"),
			filepath.Join(home, ".config", "Cursor", "User", "globalStorage", "state.vscdb"),
		)
	}
	for _, c := range candidates {
		if PathExists(c) {
			if fi, err := os.Stat(c); err == nil && fi.IsDir() {
				c = filepath.Join(c, "state.vscdb")
				if !PathExists(c) {
					continue
				}
			}
			return c
		}
	}
	return ""
}
