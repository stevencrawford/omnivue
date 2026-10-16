package server

import (
	"bytes"
	"net/http"
	"os"
	"path/filepath"
	"strings"
)

// maxSessionFileBytes caps how much file content the markdown viewer will load
// in a single request. Anything larger is refused rather than streamed.
const maxSessionFileBytes = 2 << 20 // 2 MiB

// handleGetSessionFile serves the contents of one file from a session's working
// directory so the frontend can render markdown files (read or edited during
// the session) in the expanded markdown viewer. Reads are confined to the
// session directory and never written back.
func handleGetSessionFile(reader SessionReader) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		rel := r.URL.Query().Get("path")
		if rel == "" {
			writeError(w, badRequest("path is required"))
			return
		}
		session, err := reader.Session(r.Context(), r.PathValue("id"))
		if err != nil {
			writeError(w, err)
			return
		}
		if session.Directory == "" {
			writeError(w, badRequest("session has no working directory"))
			return
		}
		content, err := readSessionFile(session.Directory, rel)
		if err != nil {
			writeError(w, err)
			return
		}
		writeOK(w, map[string]string{"path": rel, "content": content})
	}
}

// readSessionFile reads a text file from dir. Absolute paths and paths that
// climb out of dir are rejected up front, and os.Root confines the actual read
// so escaping symlinks cannot slip through either. Directories, binary content,
// and files above maxSessionFileBytes are refused.
func readSessionFile(dir, rel string) (string, error) {
	cleaned := filepath.Clean(rel)
	if filepath.IsAbs(cleaned) || cleaned == ".." || strings.HasPrefix(cleaned, ".."+string(filepath.Separator)) {
		return "", badRequest("path must stay within the session directory")
	}
	root, err := os.OpenRoot(dir)
	if err != nil {
		return "", badRequest("session directory is unavailable")
	}
	defer root.Close()

	info, err := root.Stat(cleaned)
	if err != nil {
		return "", notFound("file not found")
	}
	if info.IsDir() {
		return "", badRequest("path is a directory")
	}
	if info.Size() > maxSessionFileBytes {
		return "", badRequest("file is too large to preview")
	}
	data, err := root.ReadFile(cleaned)
	if err != nil {
		return "", notFound("file not found")
	}
	if bytes.IndexByte(data, 0) >= 0 {
		return "", badRequest("file is not text")
	}
	return string(data), nil
}
