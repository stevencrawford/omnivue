package cmd

import (
	"os"
	"testing"
)

func TestGenerateSourceID(t *testing.T) {
	id1 := generateSourceID("/home/user/.local/share/opencode")
	id2 := generateSourceID("/home/user/.copilot")
	id3 := generateSourceID("/home/user/.local/share/opencode")

	if id1 == "" {
		t.Error("expected non-empty source ID")
	}
	if id1 == id2 {
		t.Error("expected different IDs for different paths")
	}
	if id1 != id3 {
		t.Error("expected same ID for same path")
	}
	if len(id1) != 12 {
		t.Errorf("expected 12-char ID, got %d chars: %s", len(id1), id1)
	}
}

func TestRunInit_NoSources(t *testing.T) {
	// Redirect stderr to avoid noise
	oldStderr := os.Stderr
	os.Stderr = nil
	defer func() { os.Stderr = oldStderr }()

	tmpDir := t.TempDir()
	t.Setenv("XDG_STATE_HOME", tmpDir)

	err := runInit(nil, nil)
	if err != nil {
		t.Fatalf("expected no error, got: %v", err)
	}
}

func TestRootCmd_Flags(t *testing.T) {
	rootCmd.SetArgs([]string{"--help"})
	err := rootCmd.Execute()
	if err != nil {
		t.Fatalf("help should not error: %v", err)
	}
}

func TestAddCmd_Help(t *testing.T) {
	rootCmd.SetArgs([]string{"add", "--help"})
	err := rootCmd.Execute()
	if err != nil {
		t.Fatalf("add help should not error: %v", err)
	}
}
