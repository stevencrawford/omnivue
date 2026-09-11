package cmd

import (
	"encoding/json"
	"fmt"
	"os"

	"github.com/stevencrawford/omnivue/version"
	"github.com/spf13/cobra"
)

var versionCmd = &cobra.Command{
	Use:   "version",
	Short: "Print the current version",
	Args:  cobra.NoArgs,
	RunE:  runVersion,
}

func init() {
	rootCmd.AddCommand(versionCmd)
}

func runVersion(_ *cobra.Command, _ []string) error {
	if jsonOutput {
		return json.NewEncoder(os.Stdout).Encode(map[string]string{
			"name":     version.Name,
			"version":  version.Version,
			"revision": version.Revision,
		})
	}
	fmt.Printf("%s v%s (revision %s)\n", version.Name, version.Version, version.Revision)
	return nil
}
