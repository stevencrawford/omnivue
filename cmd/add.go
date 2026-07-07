package cmd

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/spf13/cobra"
	"github.com/stevencrawford/omnivue/internal/ingest"
	"github.com/stevencrawford/omnivue/internal/store"
)

var addSourceType string

var addCmd = &cobra.Command{
	Use:   "add <path>",
	Short: "Add an AI agent session source",
	Long: `Adds a session data source to Omnivue. The path should point to the
agent's data directory (e.g., ~/.local/share/opencode, ~/.copilot, ~/.codex, or ~/.claude).

By default, Omnivue will auto-detect the agent type. Use --type to force.`,
	Args: cobra.ExactArgs(1),
	RunE: runAdd,
}

func init() {
	addCmd.Flags().StringVar(&addSourceType, "type", "", "Force agent type")
	rootCmd.AddCommand(addCmd)
}

func runAdd(cmd *cobra.Command, args []string) error {
	path := args[0]

	// Cloud sources have no filesystem path — they use a token instead.
	if addSourceType != string(ingest.AgentGitHubCloud) {
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
	}

	// Detect agent type
	var agentType ingest.AgentType
	var label string

	if addSourceType != "" {
		agentType = ingest.AgentType(addSourceType)
		var found bool
		for _, ai := range ingest.KnownAgentTypes() {
			if ai.Type == agentType {
				label = ai.Label
				found = true
				break
			}
		}
		if !found {
			valid := make([]string, 0)
			for _, ai := range ingest.KnownAgentTypes() {
				valid = append(valid, string(ai.Type))
			}
			return fmt.Errorf("unknown agent type: %s (valid: %s)", addSourceType, strings.Join(valid, ", "))
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
			valid := make([]string, 0)
			for _, ai := range ingest.KnownAgentTypes() {
				valid = append(valid, string(ai.Type))
			}
			return fmt.Errorf("could not auto-detect agent type for %s\n  Use --type to specify (%s)", path, strings.Join(valid, ", "))
		}
	}

	// If an Omnivue server is running, add via API so it picks up immediately
	addr := net.JoinHostPort(strings.Trim(bind, "[]"), strconv.Itoa(port))
	if result, err := probeServer(addr, probeTimeoutFast); err == nil {
		return addViaAPI(result.client, addr, path, string(agentType), label)
	}

	// No server running, write directly to store
	s, err := store.New()
	if err != nil {
		return fmt.Errorf("failed to open Omnivue database: %w", err)
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

	fmt.Fprintf(os.Stderr, "omnivue: added %s source at %s\n", label, path)
	return nil
}

func addViaAPI(client *http.Client, addr, path, agentType, label string) error {
	body := map[string]any{
		"path":      path,
		"agentType": agentType,
		"label":     label,
		"enabled":   true,
	}
	var buf bytes.Buffer
	if err := json.NewEncoder(&buf).Encode(body); err != nil {
		return fmt.Errorf("failed to encode request: %w", err)
	}
	resp, err := client.Post(fmt.Sprintf("http://%s/_/api/sources", addr), "application/json", &buf)
	if err != nil {
		return fmt.Errorf("failed to contact running server: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusCreated {
		return fmt.Errorf("server returned %s", resp.Status)
	}
	fmt.Fprintf(os.Stderr, "omnivue: added %s source at %s (live)\n", label, path)
	return nil
}
