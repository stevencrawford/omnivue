package server

import (
	"net/http"
	"os"
	"path/filepath"
	"testing"

	"github.com/stevencrawford/omnivue/internal/ingest"
)

func TestHandleGetSessionFile(t *testing.T) {
	parent := t.TempDir()
	dir := filepath.Join(parent, "repo")
	if err := os.Mkdir(dir, 0o750); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "README.md"), []byte("# Hello\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(filepath.Join(dir, "sub"), 0o750); err != nil {
		t.Fatal(err)
	}
	// A sibling file outside the session directory, reachable only via "..".
	if err := os.WriteFile(filepath.Join(parent, "secret.md"), []byte("secret"), 0o600); err != nil {
		t.Fatal(err)
	}
	binary := filepath.Join(dir, "binary.bin")
	if err := os.WriteFile(binary, []byte{0x00, 0x01, 0x02}, 0o600); err != nil {
		t.Fatal(err)
	}

	reader := &fakeSessionReader{sessions: []ingest.Session{{ID: "ses-1", Directory: dir}}}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /_/api/sessions/{id}/file", handleGetSessionFile(reader))

	var ok map[string]string
	doJSON(t, mux, http.MethodGet, "/_/api/sessions/ses-1/file?path=README.md", nil, http.StatusOK, &ok)
	if ok["content"] != "# Hello\n" || ok["path"] != "README.md" {
		t.Fatalf("unexpected body: %+v", ok)
	}

	cases := []struct {
		name   string
		target string
		status int
	}{
		{"missing path", "/_/api/sessions/ses-1/file", http.StatusBadRequest},
		{"traversal", "/_/api/sessions/ses-1/file?path=../secret.md", http.StatusBadRequest},
		{"directory", "/_/api/sessions/ses-1/file?path=sub", http.StatusBadRequest},
		{"binary", "/_/api/sessions/ses-1/file?path=binary.bin", http.StatusBadRequest},
		{"absent", "/_/api/sessions/ses-1/file?path=missing.md", http.StatusNotFound},
		{"unknown session", "/_/api/sessions/nope/file?path=README.md", http.StatusNotFound},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			doJSON(t, mux, http.MethodGet, tc.target, nil, tc.status, nil)
		})
	}
}

func TestReadSessionFileTooLarge(t *testing.T) {
	dir := t.TempDir()
	big := filepath.Join(dir, "big.md")
	f, err := os.Create(big)
	if err != nil {
		t.Fatal(err)
	}
	if err := f.Truncate(int64(maxSessionFileBytes) + 1); err != nil {
		t.Fatal(err)
	}
	if err := f.Close(); err != nil {
		t.Fatal(err)
	}
	if _, err := readSessionFile(dir, "big.md"); err == nil {
		t.Fatal("expected an error for a file above the size cap")
	}
}

func TestReadSessionFileRejectsAbsolutePath(t *testing.T) {
	dir := t.TempDir()
	if _, err := readSessionFile(dir, "/etc/hosts"); err == nil {
		t.Fatal("expected an error for an absolute path")
	}
}
