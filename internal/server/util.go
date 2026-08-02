package server

import "strings"

// isSQLiteBusy reports whether an error is a transient SQLITE_BUSY failure.
func isSQLiteBusy(err error) bool {
	return err != nil && strings.Contains(err.Error(), "SQLITE_BUSY")
}

// retryOnBusy retries fn up to 3 times while the database reports a busy lock.
func retryOnBusy(fn func() error) error {
	var err error
	for range 3 {
		err = fn()
		if err == nil || !isSQLiteBusy(err) {
			return err
		}
	}
	return err
}

// isPlanTool returns true for tool call names whose Input should be included
// in the search index.
func isPlanTool(name string) bool {
	switch name {
	case "todowrite", "task", "task_complete", "task-complete":
		return true
	}
	return false
}

// shortID returns a short suffix of a key, used to derive a stable suffix for
// generated IDs.
func shortID(key string) string {
	if len(key) <= 12 {
		return key
	}
	return key[len(key)-12:]
}
