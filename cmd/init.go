package cmd

import (
	"bufio"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/stevencrawford/sess/internal/ingest"
	"github.com/stevencrawford/sess/internal/store"
	"github.com/spf13/cobra"
)

var initCmd = &cobra.Command{
	Use:   "init",
	Short: "Discover and configure AI agent session sources",
	Long: `Scans known paths for AI coding agent session data and prompts
which sources to add for monitoring.

Known locations:
  ~/.local/share/opencode   (OpenCode)
  ~/.copilot                (GitHub Copilot)

Sources are saved to the sess database and will be loaded automatically
on subsequent launches.`,
	RunE: runInit,
}

func init() {
	rootCmd.AddCommand(initCmd)
}

func runInit(cmd *cobra.Command, args []string) error {
	fmt.Fprintln(os.Stderr, "sess: scanning for AI agent sessions...")

	discovered := ingest.AutoDiscover()
	if len(discovered) == 0 {
		fmt.Fprintln(os.Stderr, "sess: no AI agent session sources found")
		fmt.Fprintln(os.Stderr, "")
		fmt.Fprintln(os.Stderr, "  Use 'sess add <path>' to manually add a source.")
		return nil
	}

	fmt.Fprintf(os.Stderr, "sess: found %d source(s):\n\n", len(discovered))

	s, err := store.New()
	if err != nil {
		return fmt.Errorf("failed to open sess database: %w", err)
	}
	defer s.Close()

	scanner := bufio.NewScanner(os.Stdin)
	var added int

	for _, d := range discovered {
		sessCount := ""
		if d.Sessions > 0 {
			sessCount = fmt.Sprintf(" (%d sessions)", d.Sessions)
		}
		fmt.Fprintf(os.Stderr, "  [%s] %s%s\n", d.AgentType, d.Path, sessCount)
		fmt.Fprintf(os.Stderr, "  Add this source? [Y/n] ")

		if !scanner.Scan() {
			break
		}
		ans := strings.TrimSpace(scanner.Text())
		if ans != "" && strings.ToLower(ans) != "y" && strings.ToLower(ans) != "yes" {
			fmt.Fprintln(os.Stderr, "  Skipped.")
			fmt.Fprintln(os.Stderr)
			continue
		}

		src := ingest.Source{
			ID:        generateSourceID(d.Path),
			Path:      d.Path,
			AgentType: d.AgentType,
			Label:     d.Label,
			Enabled:   true,
			CreatedAt: time.Now(),
		}

		if err := s.AddSource(src); err != nil {
			fmt.Fprintf(os.Stderr, "  Error: %v\n", err)
			continue
		}

		added++
		fmt.Fprintf(os.Stderr, "  Added.\n\n")
	}

	if added > 0 {
		fmt.Fprintf(os.Stderr, "sess: configured %d source(s). Run 'sess' to start.\n", added)
	} else {
		fmt.Fprintln(os.Stderr, "sess: no sources added. Use 'sess add <path>' to add manually.")
	}

	return nil
}

func generateSourceID(path string) string {
	h := sha256.Sum256([]byte(path))
	return hex.EncodeToString(h[:])[:12]
}
