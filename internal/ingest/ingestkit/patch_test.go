package ingestkit

import "testing"

func TestParseApplyPatch(t *testing.T) {
	tests := []struct {
		name           string
		input          string
		wantFilePath   string
		wantContent    string
	}{
		{
			name: "codex add file with content",
			input: "*** Begin Patch\n" +
				"*** Add File: auth.go\n" +
				"+package main\n" +
				"+func auth() {\n" +
				"*** End Patch\n",
			wantFilePath: "auth.go",
			wantContent:  "+package main\n+func auth() {",
		},
		{
			name: "codex modify file with chunk",
			input: "*** Begin Patch\n" +
				"*** Modify File: server.go\n" +
				"*** Chunk: server.go : update handler\n" +
				" change\n" +
				"*** End Patch\n",
			wantFilePath: "server.go",
			wantContent:  " change",
		},
		{
			name: "dash variants",
			input: "--- Update File: x.txt\n" +
				"*** Begin Patch\n" +
				"body\n" +
				"*** End Patch\n",
			wantFilePath: "x.txt",
			wantContent:  "body",
		},
		{
			name: "copilot bare path only",
			input: "*** Begin Patch\n*** Update File: cli.go\n...\n*** End Patch\n",
			wantFilePath: "cli.go",
			wantContent:  "...",
		},
		{
			name:        "no patch markers",
			input:       "plain text\n",
			wantFilePath: "",
			wantContent:  "",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			gotPath, gotContent := ParseApplyPatch(tt.input)
			if gotPath != tt.wantFilePath {
				t.Errorf("ParseApplyPatch(%q) filePath = %q, want %q", tt.input, gotPath, tt.wantFilePath)
			}
			if gotContent != tt.wantContent {
				t.Errorf("ParseApplyPatch(%q) content = %q, want %q", tt.input, gotContent, tt.wantContent)
			}
		})
	}
}