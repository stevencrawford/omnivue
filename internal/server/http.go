package server

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
)

// apiError carries an HTTP status alongside a message so handlers can return a
// domain error and let the error-map decide the status.
type apiError struct {
	status  int
	message string
}

func (e *apiError) Error() string { return e.message }

// badRequest returns a 400 error for invalid client input.
func badRequest(msg string) error { return &apiError{http.StatusBadRequest, msg} }

// notFound returns a 404 error for a missing resource.
func notFound(msg string) error { return &apiError{http.StatusNotFound, msg} }

// internalError returns a 500 error for a server-side failure.
func internalError(msg string) error { return &apiError{http.StatusInternalServerError, msg} }

// writeJSON encodes v as a JSON response with the given status code. The
// encode-error tail is owned here so handlers never repeat it.
func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(v); err != nil {
		slog.Warn("failed to encode response", "error", err)
	}
}

// writeError maps err to an HTTP status and writes it. Errors typed with the
// apiError constructors keep their status; anything else defaults to 500, so
// handlers never hand-pick status literals.
func writeError(w http.ResponseWriter, err error) {
	http.Error(w, err.Error(), errorStatus(err))
}

// errorStatus maps a domain error to an HTTP status.
func errorStatus(err error) int {
	var ae *apiError
	if errors.As(err, &ae) {
		return ae.status
	}
	return http.StatusInternalServerError
}

// decodeJSON decodes the JSON request body into v. Callers respond with 400 on
// error; the concrete decode error is surfaced as-is.
func decodeJSON(r *http.Request, v any) error {
	return json.NewDecoder(r.Body).Decode(v)
}
