package backup

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"

	"github.com/stevencrawford/sess/internal/xdg"
)

// Dir returns the path to the backup directory.
func Dir() (string, error) {
	stateHome, err := xdg.StateHome()
	if err != nil {
		return "", err
	}
	return filepath.Join(stateHome, "mo", "backup"), nil
}

// Path returns the backup file path for the given port.
func Path(port int) (string, error) {
	dir, err := Dir()
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, fmt.Sprintf("mo-%d.json", port)), nil
}

// Save atomically writes data to the backup file for the given port.
func Save(port int, data any) (retErr error) {
	p, err := Path(port)
	if err != nil {
		return err
	}
	dir := filepath.Dir(p)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return fmt.Errorf("failed to create backup directory: %w", err)
	}

	b, err := json.Marshal(data)
	if err != nil {
		return fmt.Errorf("failed to marshal backup data: %w", err)
	}

	tmp, err := os.CreateTemp(dir, "mo-backup-*.tmp")
	if err != nil {
		return fmt.Errorf("failed to create temp file: %w", err)
	}
	tmpName := tmp.Name()
	defer func() {
		if retErr != nil {
			os.Remove(tmpName) //nolint:gosec // Path is from our own CreateTemp, not user-supplied
		}
	}()

	if _, err := tmp.Write(b); err != nil {
		tmp.Close()
		return fmt.Errorf("failed to write backup data: %w", err)
	}
	if err := tmp.Close(); err != nil {
		return fmt.Errorf("failed to close temp file: %w", err)
	}

	if err := os.Rename(tmpName, p); err != nil { //nolint:gosec // Both paths are from our own Path() and CreateTemp
		return fmt.Errorf("failed to rename temp file: %w", err)
	}

	return nil
}

// Load reads the backup file for the given port.
// Returns a nil error if the file does not exist.
func Load(port int, dest any) error {
	p, err := Path(port)
	if err != nil {
		return err
	}

	data, err := os.ReadFile(p) //nolint:gosec
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return fmt.Errorf("failed to read backup file: %w", err)
	}

	if err := json.Unmarshal(data, dest); err != nil {
		return fmt.Errorf("failed to unmarshal backup data: %w", err)
	}

	return nil
}

// Exists reports whether the backup file for the given port exists.
func Exists(port int) bool {
	p, err := Path(port)
	if err != nil {
		return false
	}
	_, err = os.Stat(p)
	return err == nil
}

// Remove deletes the backup file for the given port.
// Returns nil if the file does not exist.
func Remove(port int) error {
	p, err := Path(port)
	if err != nil {
		return err
	}
	if err := os.Remove(p); err != nil && !os.IsNotExist(err) {
		return fmt.Errorf("failed to remove backup file: %w", err)
	}
	return nil
}
