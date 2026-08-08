package cmd

import (
	"archive/tar"
	"archive/zip"
	"bytes"
	"compress/gzip"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"

	"github.com/stevencrawford/omnivue/version"
	"github.com/spf13/cobra"
)

var upgradeCheck bool

var upgradeCmd = &cobra.Command{
	Use:   "upgrade",
	Short: "Upgrade Omnivue to the latest release",
	Long: `Checks the GitHub releases for a newer version and performs
an in-place upgrade of the current binary.

The current binary is backed up as <name>.bak before replacement.
On macOS, the binary is re-signed after installation.`,
	Args: cobra.NoArgs,
	RunE: runUpgrade,
}

func init() {
	upgradeCmd.Flags().BoolVarP(&upgradeCheck, "check", "c", false, "Check for latest version without downloading")
	rootCmd.AddCommand(upgradeCmd)
}

func runUpgrade(_ *cobra.Command, _ []string) error {
	asset := assetName()
	if asset == "" {
		return fmt.Errorf("unsupported platform: %s/%s", runtime.GOOS, runtime.GOARCH)
	}

	latestTag, err := fetchLatestVersion(asset)
	if err != nil {
		return fmt.Errorf("checking for updates: %w", err)
	}

	currentTag := "v" + version.Version
	cmp := compareVersions(latestTag, currentTag)

	if upgradeCheck {
		if cmp > 0 {
			fmt.Fprintf(os.Stderr, "omnivue: update available: %s (current: %s)\n", latestTag, currentTag)
		} else if cmp == 0 {
			fmt.Fprintf(os.Stderr, "omnivue: already up to date (%s)\n", currentTag)
		} else {
			fmt.Fprintf(os.Stderr, "omnivue: current version (%s) is newer than latest release (%s)\n", currentTag, latestTag)
		}
		return nil
	}

	if cmp <= 0 {
		if cmp == 0 {
			fmt.Fprintf(os.Stderr, "omnivue: already up to date (%s)\n", currentTag)
		} else {
			fmt.Fprintf(os.Stderr, "omnivue: current version (%s) is newer than latest release (%s)\n", currentTag, latestTag)
		}
		return nil
	}

	downloadURL := fmt.Sprintf("https://github.com/stevencrawford/omnivue/releases/latest/download/%s", asset)
	fmt.Fprintf(os.Stderr, "omnivue: downloading %s ...\n", latestTag)

	data, err := downloadAndExtract(downloadURL)
	if err != nil {
		return fmt.Errorf("download failed: %w", err)
	}

	binPath, err := os.Executable()
	if err != nil {
		return fmt.Errorf("cannot find binary path: %w", err)
	}
	binDir := filepath.Dir(binPath)

	tmpFile, err := os.CreateTemp(binDir, ".omnivue-"+latestTag+"-*")
	if err != nil {
		return fmt.Errorf("cannot create temp file: %w", err)
	}
	tmpPath := tmpFile.Name()

	if _, err := tmpFile.Write(data); err != nil {
		tmpFile.Close()
		os.Remove(tmpPath)
		return fmt.Errorf("cannot write binary: %w", err)
	}
	if err := tmpFile.Chmod(0o755); err != nil {
		tmpFile.Close()
		os.Remove(tmpPath)
		return fmt.Errorf("cannot set permissions: %w", err)
	}
	tmpFile.Close()

	bakPath := binPath + ".bak"
	if err := os.Rename(binPath, bakPath); err != nil {
		os.Remove(tmpPath)
		return fmt.Errorf("cannot backup current binary: %w", err)
	}

	if err := os.Rename(tmpPath, binPath); err != nil {
		if rerr := os.Rename(bakPath, binPath); rerr != nil {
			fmt.Fprintf(os.Stderr, "omnivue: failed to restore backup: %v\n", rerr)
		}
		os.Remove(tmpPath)
		return fmt.Errorf("cannot replace binary: %w", err)
	}

	if runtime.GOOS == "darwin" {
		if err := exec.Command("codesign", "-s", "-", "--force", "--timestamp", binPath).Run(); err != nil {
			fmt.Fprintf(os.Stderr, "omnivue: warning: codesign failed: %v\n", err)
		}
	}

	os.Remove(bakPath)

	fmt.Fprintf(os.Stderr, "omnivue: upgraded from %s to %s\n", currentTag, latestTag)
	fmt.Fprintf(os.Stderr, "omnivue: restart the server if it is currently running\n")
	return nil
}

func assetName() string {
	arch := runtime.GOARCH
	switch runtime.GOOS {
	case "darwin":
		return fmt.Sprintf("omnivue_darwin_%s.zip", arch)
	case "linux":
		return fmt.Sprintf("omnivue_linux_%s.tar.gz", arch)
	case "windows":
		return fmt.Sprintf("omnivue_windows_%s.tar.gz", arch)
	default:
		return ""
	}
}

func fetchLatestVersion(asset string) (string, error) {
	url := fmt.Sprintf("https://github.com/stevencrawford/omnivue/releases/latest/download/%s", asset)

	client := &http.Client{
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			return http.ErrUseLastResponse
		},
	}

	resp, err := client.Head(url)
	if err != nil {
		return "", err
	}
	resp.Body.Close()

	if resp.StatusCode != http.StatusFound {
		return "", fmt.Errorf("unexpected response: %s", resp.Status)
	}

	loc := resp.Header.Get("Location")
	if loc == "" {
		return "", fmt.Errorf("empty Location header")
	}

	parts := strings.Split(loc, "/")
	for i, p := range parts {
		if p == "download" && i+1 < len(parts) {
			return parts[i+1], nil
		}
	}

	return "", fmt.Errorf("could not parse version from: %s", loc)
}

func compareVersions(a, b string) int {
	a = strings.TrimPrefix(a, "v")
	b = strings.TrimPrefix(b, "v")
	if i := strings.Index(a, "-"); i >= 0 {
		a = a[:i]
	}
	if i := strings.Index(b, "-"); i >= 0 {
		b = b[:i]
	}
	va := strings.Split(a, ".")
	vb := strings.Split(b, ".")
	max := len(va)
	if len(vb) > max {
		max = len(vb)
	}
	for i := 0; i < max; i++ {
		var av, bv int
		if i < len(va) {
			if n, err := strconv.Atoi(va[i]); err == nil {
				av = n
			}
		}
		if i < len(vb) {
			if n, err := strconv.Atoi(vb[i]); err == nil {
				bv = n
			}
		}
		if av < bv {
			return -1
		}
		if av > bv {
			return 1
		}
	}
	return 0
}

func downloadAndExtract(url string) ([]byte, error) {
	resp, err := http.Get(url) //nolint:gosec // URL is constructed from trusted base
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("http %s", resp.Status)
	}

	data, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("reading response: %w", err)
	}

	if strings.HasSuffix(url, ".zip") {
		return extractFromZip(data)
	}
	return extractFromTarGz(data)
}

func extractFromZip(data []byte) ([]byte, error) {
	zr, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return nil, fmt.Errorf("opening zip: %w", err)
	}
	for _, f := range zr.File {
		if f.Name == "omnivue" {
			rc, err := f.Open()
			if err != nil {
				return nil, fmt.Errorf("opening %s: %w", f.Name, err)
			}
			defer rc.Close()
			bin, err := io.ReadAll(rc)
			if err != nil {
				return nil, fmt.Errorf("reading %s: %w", f.Name, err)
			}
			return bin, nil
		}
	}
	return nil, fmt.Errorf("omnivue binary not found in archive")
}

func extractFromTarGz(data []byte) ([]byte, error) {
	gzr, err := gzip.NewReader(bytes.NewReader(data))
	if err != nil {
		return nil, fmt.Errorf("opening gzip: %w", err)
	}
	defer gzr.Close()

	tr := tar.NewReader(gzr)
	for {
		hdr, err := tr.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			return nil, fmt.Errorf("reading tar: %w", err)
		}
		name := filepath.Base(hdr.Name)
		if name == "omnivue" || name == "omnivue.exe" {
			bin, err := io.ReadAll(tr)
			if err != nil {
				return nil, fmt.Errorf("reading %s: %w", hdr.Name, err)
			}
			return bin, nil
		}
	}
	return nil, fmt.Errorf("omnivue binary not found in archive")
}
