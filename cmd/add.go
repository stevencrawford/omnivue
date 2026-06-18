package cmd

import (
	"fmt"
	"os"
	"time"

	"github.com/stevencrawford/sess/internal/ingest"
	"github.com/stevencrawford/sess/internal/store"
	"github.com/spf13/cobra"
)

var addSourceType string

var addCmd = &cobra.Command{
	Use:   "add <path>",
	Short: "Add an AI agent session source",
	Long: `Adds a session data source to sess. The path should point to the
agent's data directory (e.g., ~/.local/share/opencode or ~/.copilot).

By default, sess will auto-detect the agent type. Use --type to force.`,
	Args: cobra.ExactArgs(1),
	RunE: runAdd,
}

func init() {
	addCmd.Flags().StringVar(&addSourceType, "type", "", "Force agent type (opencode, copilot, cursor)")
	rootCmd.AddCommand(addCmd)
}

func runAdd(cmd *cobra.Command, args []string) error {
	path := args[0]

	// Expand ~ in path
	if len(path) > 1 && path[:2] == "~/" {
		home, err := os.UserHomeDir()
		if err != nil {
			return err
		}
		path = home + path[1:]
	}

	// Verify path exists
	if _, err := os.Stat(path); err != nil {
		return fmt.Errorf("path does not exist: %s", path)
	}

	// Detect agent type
	var agentType ingest.AgentType
	var label string

	if addSourceType != "" {
		agentType = ingest.AgentType(addSourceType)
		switch agentType {
		case ingest.AgentOpenCode:
			label = "OpenCode"
		case ingest.AgentCopilot:
			label = "GitHub Copilot"
		case ingest.AgentCursor:
			label = "Cursor"
		default:
			return fmt.Errorf("unknown agent type: %s (valid: opencode, copilot, cursor)", addSourceType)
		}
	} else {
		// Auto-detect
		discovered := ingest.AutoDiscover()
		var found bool
		for _, d := range discovered {
			if d.Path == path {
				agentType = d.AgentType
				label = d.Label
				found = true
				break
			}
		}
		if !found {
			return fmt.Errorf("could not auto-detect agent type for %s\n  Use --type to specify (opencode, copilot, cursor)", path)
		}
	}

	s, err := store.New()
	if err != nil {
		return fmt.Errorf("failed to open sess database: %w", err)
	}
	defer s.Close()

	src := ingest.Source{
		ID:        generateSourceID(path),
		Path:      path,
		AgentType: agentType,
		Label:     label,
		Enabled:   true,
		CreatedAt: time.Now(),
	}

	if err := s.AddSource(src); err != nil {
		return fmt.Errorf("failed to add source: %w", err)
	}

	fmt.Fprintf(os.Stderr, "sess: added %s source at %s\n", label, path)
	return nil
}
