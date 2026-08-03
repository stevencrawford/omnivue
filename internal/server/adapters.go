package server

// Adapter registration. Each adapter package registers its factory and
// detector with the ingest registry from an init() function; these blank
// imports force that side effect to run so ingest.CreateAdapter can resolve a
// source's agent type. Without them the registry stays empty and every source
// fails to create an adapter with "unknown agent type".
import (
	_ "github.com/stevencrawford/omnivue/internal/ingest/claude-code"
	_ "github.com/stevencrawford/omnivue/internal/ingest/codex"
	_ "github.com/stevencrawford/omnivue/internal/ingest/copilot"
	_ "github.com/stevencrawford/omnivue/internal/ingest/cursor"
	_ "github.com/stevencrawford/omnivue/internal/ingest/opencode"
	_ "github.com/stevencrawford/omnivue/internal/ingest/pi"
)
