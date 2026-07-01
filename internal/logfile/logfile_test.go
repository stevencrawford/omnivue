package logfile

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestNewRotatingWriter(t *testing.T) {
	dir := t.TempDir()
	filename := filepath.Join(dir, "test.log")

	w, err := newRotatingWriter(filename, 1024, 3)
	if err != nil {
		t.Fatalf("newRotatingWriter: %v", err)
	}
	defer w.Close()

	if w.size != 0 {
		t.Errorf("initial size = %d, want 0", w.size)
	}

	// Write some data and verify size tracking
	data := []byte("hello\n")
	n, err := w.Write(data)
	if err != nil {
		t.Fatalf("Write: %v", err)
	}
	if n != len(data) {
		t.Errorf("Write returned %d, want %d", n, len(data))
	}
	if w.size != int64(len(data)) {
		t.Errorf("size after write = %d, want %d", w.size, len(data))
	}
}

func TestNewRotatingWriterResumesSize(t *testing.T) {
	dir := t.TempDir()
	filename := filepath.Join(dir, "test.log")

	// Pre-create a file with some content
	if err := os.WriteFile(filename, []byte("existing content\n"), 0o600); err != nil {
		t.Fatal(err)
	}

	w, err := newRotatingWriter(filename, 1024, 3)
	if err != nil {
		t.Fatalf("newRotatingWriter: %v", err)
	}
	defer w.Close()

	if w.size == 0 {
		t.Error("expected non-zero initial size for pre-existing file")
	}
}

func TestRotation(t *testing.T) {
	dir := t.TempDir()
	filename := filepath.Join(dir, "test.log")
	maxSize := int64(50)

	w, err := newRotatingWriter(filename, maxSize, 2)
	if err != nil {
		t.Fatalf("newRotatingWriter: %v", err)
	}
	defer w.Close()

	// Fill up the file past maxSize to trigger rotation
	line := strings.Repeat("x", 30) + "\n"
	for range 3 {
		if _, err := w.Write([]byte(line)); err != nil {
			t.Fatalf("Write: %v", err)
		}
	}

	// After writes that exceed maxSize, backup .1 should exist
	if _, err := os.Stat(filename + ".1"); err != nil {
		t.Errorf("expected backup .1 to exist: %v", err)
	}

	// Current file should have been reset and contain only the latest write
	info, err := os.Stat(filename)
	if err != nil {
		t.Fatalf("stat current file: %v", err)
	}
	if info.Size() > maxSize {
		t.Errorf("current file size %d exceeds maxSize %d", info.Size(), maxSize)
	}
}

func TestRotationShiftsBackups(t *testing.T) {
	dir := t.TempDir()
	filename := filepath.Join(dir, "test.log")
	maxSize := int64(20)
	maxBackups := 2

	w, err := newRotatingWriter(filename, maxSize, maxBackups)
	if err != nil {
		t.Fatalf("newRotatingWriter: %v", err)
	}
	defer w.Close()

	line := strings.Repeat("a", 21) + "\n"

	// Write enough to trigger multiple rotations
	for range 5 {
		if _, err := w.Write([]byte(line)); err != nil {
			t.Fatalf("Write: %v", err)
		}
	}

	// .1 and .2 should exist, .3 should not (maxBackups=2)
	if _, err := os.Stat(filename + ".1"); err != nil {
		t.Errorf("expected .1 backup: %v", err)
	}
	if _, err := os.Stat(filename + ".2"); err != nil {
		t.Errorf("expected .2 backup: %v", err)
	}
	if _, err := os.Stat(filename + ".3"); !os.IsNotExist(err) {
		t.Error("expected .3 backup to not exist")
	}
}

func TestBackupName(t *testing.T) {
	w := &rotatingWriter{filename: "/tmp/test.log"}
	got := w.backupName(2)
	want := "/tmp/test.log.2"
	if got != want {
		t.Errorf("backupName(2) = %q, want %q", got, want)
	}
}

func TestCleanOldLogs(t *testing.T) {
	dir := t.TempDir()

	// Create an "old" log file
	oldFile := filepath.Join(dir, "omnivue-1234.log")
	if err := os.WriteFile(oldFile, []byte("old"), 0o600); err != nil {
		t.Fatal(err)
	}
	// Set its mod time to 10 days ago
	oldTime := time.Now().Add(-10 * 24 * time.Hour)
	if err := os.Chtimes(oldFile, oldTime, oldTime); err != nil {
		t.Fatal(err)
	}

	// Create a "recent" log file
	recentFile := filepath.Join(dir, "omnivue-5678.log")
	if err := os.WriteFile(recentFile, []byte("recent"), 0o600); err != nil {
		t.Fatal(err)
	}

	// Create a non-log file (should not be deleted)
	otherFile := filepath.Join(dir, "other.txt")
	if err := os.WriteFile(otherFile, []byte("keep"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.Chtimes(otherFile, oldTime, oldTime); err != nil {
		t.Fatal(err)
	}

	cleanOldLogs(dir, 7*24*time.Hour)

	if _, err := os.Stat(oldFile); !os.IsNotExist(err) {
		t.Error("expected old log file to be removed")
	}
	if _, err := os.Stat(recentFile); err != nil {
		t.Error("expected recent log file to remain")
	}
	if _, err := os.Stat(otherFile); err != nil {
		t.Error("expected non-log file to remain")
	}
}

func TestSetup(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("XDG_STATE_HOME", dir)

	cleanup, err := Setup(19999)
	if err != nil {
		t.Fatalf("Setup: %v", err)
	}
	cleanup()

	logFile := filepath.Join(dir, "omnivue", "log", "omnivue-19999.log")
	if _, err := os.Stat(logFile); err != nil {
		t.Errorf("expected log file to be created: %v", err)
	}
}

func TestCleanOldLogsNonexistentDir(t *testing.T) {
	// Should not panic on nonexistent directory
	cleanOldLogs("/nonexistent/path/that/does/not/exist", time.Hour)
}
