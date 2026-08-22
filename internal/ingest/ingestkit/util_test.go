package ingestkit

import "testing"

// TestExtractFilePath pins the field-resolution order used to pull a file path
// out of the various agents' tool call input shapes.
func TestExtractFilePath(t *testing.T) {
	tests := []struct {
		name string
		raw  string
		want string
	}{
		// Each key in filePathKeys resolves, in declaration order when a
		// single key is present.
		{"filePath", `{"filePath":"src/a.go"}`, "src/a.go"},
		{"path", `{"path":"src/b.go"}`, "src/b.go"},
		{"file_path", `{"file_path":"src/c.go"}`, "src/c.go"},
		{"filename", `{"filename":"d.go"}`, "d.go"},
		{"file", `{"file":"e.go"}`, "e.go"},
		{"targetFile", `{"targetFile":"f.go"}`, "f.go"},
		{"effectiveUri", `{"effectiveUri":"g.go"}`, "g.go"},
		{"relativeWorkspacePath", `{"relativeWorkspacePath":"h.go"}`, "h.go"},
		{"uri", `{"uri":"i.go"}`, "i.go"},

		// Earlier keys win when several are present.
		{"first match wins", `{"path":"p.go","uri":"u.go"}`, "p.go"},

		// Non-string values are skipped in favor of later string keys.
		{"non-string skipped", `{"path":42,"filePath":"real.go"}`, "real.go"},
		{"empty string value", `{"filePath":""}`, ""},

		// No usable path.
		{"no known keys", `{"command":"ls -la"}`, ""},
		{"empty object", `{}`, ""},
		{"invalid json", `not-json`, ""},
		{"empty input", "", ""},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if got := ExtractFilePath(tc.raw); got != tc.want {
				t.Errorf("ExtractFilePath(%q) = %q, want %q", tc.raw, got, tc.want)
			}
		})
	}
}
