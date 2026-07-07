package terminal

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"strings"
	"sync"

	"github.com/coder/websocket"
	"github.com/creack/pty"
)

type serverMessage struct {
	Type string `json:"type"`
	Data string `json:"data"`
}

type clientMessage struct {
	Type string          `json:"type"`
	Data json.RawMessage `json:"data"`
}

type resizePayload struct {
	Cols int `json:"cols"`
	Rows int `json:"rows"`
}

// Run spawns the agent command in a PTY and bidirectionally pipes between
// the PTY and WebSocket connection. The command is run through the user's
// login shell so that shell profile (PATH, aliases, etc.) is loaded.
// Blocks until the process exits or context is canceled.
func Run(ctx context.Context, ws *websocket.Conn, dir string, cmdline string) error {
	if cmdline == "" {
		return fmt.Errorf("terminal: empty command")
	}

	shell := os.Getenv("SHELL")
	if shell == "" {
		shell = "/bin/zsh"
	}

	cmd := exec.CommandContext(ctx, shell, "-l", "-i", "-c", cmdline) //nolint:gosec // agent command from adapter, safe in local app
	cmd.Dir = dir
	cmd.Env = append(os.Environ(), "TERM=xterm-256color")

	f, err := pty.StartWithSize(cmd, &pty.Winsize{Rows: 24, Cols: 80})
	if err != nil {
		return fmt.Errorf("terminal: start pty: %w", err)
	}
	defer f.Close() //nolint:errcheck

	ctx, cancel := context.WithCancel(ctx)
	defer cancel()

	if err := writeMsg(ctx, ws, "status", "connected"); err != nil {
		return fmt.Errorf("terminal: write status: %w", err)
	}

	var wg sync.WaitGroup

	// PTY stdout -> WebSocket
	wg.Add(1)
	go func() { //nolint:contextcheck,modernize // ctx used in writeMsg below; sync.WaitGroup has no Go method
		defer wg.Done()
		buf := make([]byte, 32*1024)
		for {
			n, err := f.Read(buf)
			if err != nil {
				cancel()
				return
			}
			if err := writeMsg(ctx, ws, "output", string(buf[:n])); err != nil {
				cancel()
				return
			}
		}
	}()

	// WebSocket -> PTY stdin
	wg.Add(1)
	go func() { //nolint:modernize // sync.WaitGroup has no Go method
		defer wg.Done()
		for {
			_, msg, err := ws.Read(ctx)
			if err != nil {
				cancel()
				return
			}

			var req clientMessage
			if err := json.Unmarshal(msg, &req); err != nil {
				continue
			}

			switch req.Type {
			case "input":
				var input string
				if err := json.Unmarshal(req.Data, &input); err != nil {
					continue
				}
				if _, err := f.Write([]byte(input)); err != nil {
					cancel()
					return
				}
			case "resize":
				var p resizePayload
				if err := json.Unmarshal(req.Data, &p); err != nil {
					continue
				}
				rows := clampUint16(p.Rows, 1)
				cols := clampUint16(p.Cols, 1)
				pty.Setsize(f, &pty.Winsize{Rows: rows, Cols: cols}) //nolint:errcheck
			}
		}
	}()

	wg.Wait()
	return nil
}

// ExtractCmd extracts the agent command portion from a resume command string.
// Resume commands follow the pattern: "cd <dir> && <command>".
func ExtractCmd(resumeCmd string) string {
	prefix, cmd, ok := strings.Cut(resumeCmd, " && ")
	if ok && strings.HasPrefix(prefix, "cd ") {
		return cmd
	}
	return resumeCmd
}

func writeMsg(ctx context.Context, ws *websocket.Conn, typ, data string) error {
	return ws.Write(ctx, websocket.MessageText, mustJSON(serverMessage{Type: typ, Data: data}))
}

func mustJSON(v any) []byte {
	b, err := json.Marshal(v)
	if err != nil {
		return []byte("{}")
	}
	return b
}

func clampUint16(v, min int) uint16 {
	if v < min {
		v = min
	}
	if v > 65535 {
		v = 65535
	}
	return uint16(v)
}
