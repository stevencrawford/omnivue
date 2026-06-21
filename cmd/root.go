package cmd

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/k1LoW/donegroup"
	"github.com/stevencrawford/sess/internal/logfile"
	"github.com/stevencrawford/sess/internal/server"
	"github.com/stevencrawford/sess/version"
	"github.com/pkg/browser"
	"github.com/spf13/cobra"
)

const (
	probeTimeoutFast    = 500 * time.Millisecond
	probeTimeoutDefault = 2 * time.Second
)

var (
	port           int
	bind           string
	open           bool
	noOpen         bool
	shutdownServer bool
	restartServer  bool
	foreground     bool
	statusServer   bool
	jsonOutput     bool
)

var rootCmd = &cobra.Command{
	Use:   "sess [flags]",
	Short: "sess is an AI/LLM session manager for coding agents",
	Long: `	sess watches AI coding agent sessions (OpenCode, Copilot, Cursor, Codex, Pi) and
presents them in a browser UI for easy browsing, searching, and management.

Quick Start:
  sess init                      Discover and configure agent sources
  sess                           Start the sess server and open browser
  sess add ~/.codex              Manually add a source (or path to another agent)

Management:
  sess --status                  Show running sess servers
  sess --shutdown                Stop the server
  sess --restart                 Restart the server

The server runs in the background by default. Use --foreground to keep it
in the foreground.`,
	Args:    cobra.NoArgs,
	RunE:    run,
	Version: version.Version,
}

func Execute() {
	if err := rootCmd.Execute(); err != nil {
		os.Exit(1)
	}
}

func init() {
	rootCmd.Flags().IntVarP(&port, "port", "p", 6275, "Server port")
	rootCmd.Flags().StringVarP(&bind, "bind", "b", "localhost", "Bind address")
	rootCmd.Flags().BoolVar(&open, "open", false, "Always open browser")
	rootCmd.Flags().BoolVar(&noOpen, "no-open", false, "Do not open browser")
	rootCmd.MarkFlagsMutuallyExclusive("open", "no-open")
	rootCmd.Flags().BoolVar(&shutdownServer, "shutdown", false, "Shut down the running sess server")
	rootCmd.Flags().BoolVar(&restartServer, "restart", false, "Restart the running sess server")
	rootCmd.MarkFlagsMutuallyExclusive("shutdown", "restart")
	rootCmd.Flags().BoolVar(&foreground, "foreground", false, "Run server in foreground")
	rootCmd.Flags().BoolVar(&statusServer, "status", false, "Show status of running servers")
	rootCmd.Flags().BoolVar(&jsonOutput, "json", false, "Output structured data as JSON")
}

func run(cmd *cobra.Command, args []string) error {
	if !foreground {
		logCleanup, err := logfile.Setup(port)
		if err != nil {
			slog.Warn("failed to setup log file, using stderr", "error", err)
		} else {
			defer logCleanup()
		}
	}

	bind = strings.Trim(bind, "[]")
	addr := net.JoinHostPort(bind, strconv.Itoa(port))

	if statusServer {
		return doStatus(addr)
	}
	if shutdownServer {
		return doShutdown(addr)
	}
	if restartServer {
		return doRestart(addr)
	}

	// If server already running, just open the browser
	if _, err := probeServer(addr, probeTimeoutFast); err == nil {
		if !noOpen {
			openBrowser(addr)
		}
		fmt.Fprintf(os.Stderr, "sess: server already running at http://%s\n", addr)
		return nil
	}

	if foreground {
		return startServer(cmd.Context(), addr)
	}
	return startBackground(addr)
}

func startServer(ctx context.Context, addr string) error {
	sigCtx, stop := signal.NotifyContext(ctx, syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	ctx, cancel := donegroup.WithCancel(sigCtx)
	cleanedUp := false
	cleanup := func() {
		if cleanedUp {
			return
		}
		cleanedUp = true
		cancel()
		if err := donegroup.WaitWithTimeout(ctx, 5*time.Second); err != nil {
			slog.Error("shutdown error", "error", err)
		}
	}
	defer cleanup()

	state := server.NewState(ctx)
	handler := server.NewHandler(state)

	srv := &http.Server{
		Addr:              addr,
		Handler:           handler,
		ReadHeaderTimeout: 10 * time.Second,
	}

	ln, err := net.Listen("tcp", addr)
	if err != nil {
		return fmt.Errorf("cannot listen on %s: %w", addr, err)
	}

	if err := donegroup.Cleanup(ctx, func() error {
		state.CloseAllSubscribers()
		shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer shutdownCancel()
		return srv.Shutdown(shutdownCtx)
	}); err != nil {
		return fmt.Errorf("failed to register cleanup: %w", err)
	}

	go func() {
		slog.Info("serving", "url", fmt.Sprintf("http://%s", addr))
		if err := srv.Serve(ln); err != nil && err != http.ErrServerClosed {
			slog.Error("server error", "error", err)
		}
	}()

	fmt.Fprintf(os.Stderr, "sess: serving at http://%s\n", addr)

	if !noOpen {
		openBrowser(addr)
	}

	select {
	case <-ctx.Done():
		slog.Info("shutting down")
	case <-state.ShutdownCh():
		slog.Info("shutting down (requested via API)")
	case restoreFile := <-state.RestartCh():
		slog.Info("restarting")
		cleanup()
		_, err := spawnNewProcess(addr, restoreFile)
		return err
	}

	return nil
}

func startBackground(addr string) error {
	proc, err := spawnNewProcess(addr, "")
	if err != nil {
		return err
	}
	pid := proc.Pid
	if err := proc.Release(); err != nil {
		slog.Warn("failed to release process", "error", err)
	}

	// Wait for server to be ready
	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		if _, err := probeServer(addr, probeTimeoutFast); err == nil {
			fmt.Fprintf(os.Stderr, "sess: server started at http://%s (pid %d)\n", addr, pid)
			if !noOpen {
				openBrowser(addr)
			}
			return nil
		}
		time.Sleep(50 * time.Millisecond)
	}
	return fmt.Errorf("server did not start within 10s (pid %d)", pid)
}

func spawnNewProcess(addr string, restoreFile string) (*os.Process, error) {
	binPath, err := os.Executable()
	if err != nil {
		return nil, fmt.Errorf("cannot find binary: %w", err)
	}

	h, p, err := net.SplitHostPort(addr)
	if err != nil {
		return nil, fmt.Errorf("cannot parse addr: %w", err)
	}

	args := []string{"--port", p, "--bind", h, "--no-open", "--foreground"}
	cmd := exec.Command(binPath, args...)
	setSysProcAttr(cmd)
	_ = restoreFile // Not used in sess (no restore file mechanism yet)
	if err := cmd.Start(); err != nil {
		return nil, fmt.Errorf("failed to start new process: %w", err)
	}

	slog.Info("new process started", "pid", cmd.Process.Pid)
	return cmd.Process, nil
}

func openBrowser(addr string) {
	if noOpen {
		return
	}
	url := fmt.Sprintf("http://%s", addr)
	if err := browser.OpenURL(url); err != nil {
		slog.Warn("failed to open browser", "error", err)
	}
}

// --- Server probe and lifecycle ---

type probeResult struct {
	client *http.Client
}

func probeServer(addr string, timeout ...time.Duration) (*probeResult, error) {
	t := probeTimeoutDefault
	if len(timeout) > 0 {
		t = timeout[0]
	}
	client := &http.Client{Timeout: t}
	resp, err := client.Get(fmt.Sprintf("http://%s/_/api/status", addr))
	if err != nil {
		return nil, fmt.Errorf("no sess server found on %s", addr)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("server on %s returned %s", addr, resp.Status)
	}

	var status struct {
		Version string `json:"version"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&status); err != nil || status.Version == "" {
		return nil, fmt.Errorf("server on %s is not a sess instance", addr)
	}

	return &probeResult{client: client}, nil
}

func doShutdown(addr string) error {
	result, err := probeServer(addr)
	if err != nil {
		return err
	}
	resp, err := result.client.Post(fmt.Sprintf("http://%s/_/api/shutdown", addr), "application/json", nil)
	if err != nil {
		return fmt.Errorf("failed to send shutdown request: %w", err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusAccepted {
		return fmt.Errorf("unexpected response: %s", resp.Status)
	}
	fmt.Fprintf(os.Stderr, "sess: shutdown request sent to http://%s\n", addr)
	return nil
}

func doRestart(addr string) error {
	result, err := probeServer(addr)
	if err != nil {
		return err
	}
	resp, err := result.client.Post(fmt.Sprintf("http://%s/_/api/restart", addr), "application/json", nil)
	if err != nil {
		return fmt.Errorf("failed to send restart request: %w", err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusAccepted {
		return fmt.Errorf("unexpected response: %s", resp.Status)
	}
	fmt.Fprintf(os.Stderr, "sess: restart request sent to http://%s\n", addr)
	return nil
}

func doStatus(addr string) error {
	result, err := probeServer(addr)
	if err != nil {
		fmt.Fprintf(os.Stderr, "sess: no server running on %s\n", addr)
		return nil
	}

	resp, err := result.client.Get(fmt.Sprintf("http://%s/_/api/status", addr))
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	var status map[string]interface{}
	if err := json.NewDecoder(resp.Body).Decode(&status); err != nil {
		return err
	}

	if jsonOutput {
		enc := json.NewEncoder(os.Stdout)
		enc.SetIndent("", "  ")
		return enc.Encode(status)
	}

	fmt.Fprintf(os.Stderr, "sess: server running at http://%s\n", addr)
	if v, ok := status["version"]; ok {
		fmt.Fprintf(os.Stderr, "  version: %v\n", v)
	}
	if v, ok := status["pid"]; ok {
		fmt.Fprintf(os.Stderr, "  pid: %v\n", v)
	}
	if sources, ok := status["sources"]; ok {
		fmt.Fprintf(os.Stderr, "  sources: %v\n", sources)
	}
	return nil
}
