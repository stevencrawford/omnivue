package server

import (
	"encoding/json"
	"log/slog"
	"net/http"
)

// writeJSON encodes v as a JSON response with the given status code. The
// encode-error tail is owned here so handlers never repeat it.
func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(v); err != nil {
		slog.Warn("failed to encode response", "error", err)
	}
}

// writeError writes a plain-text error response with the given status.
func writeError(w http.ResponseWriter, status int, message string) {
	http.Error(w, message, status)
}

// decodeJSON decodes the JSON request body into v. Callers respond with 400 on
// error; the concrete decode error is surfaced as-is.
func decodeJSON(r *http.Request, v any) error {
	return json.NewDecoder(r.Body).Decode(v)
}
