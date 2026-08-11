// Package resumecmd owns the session resume-command templates. Adapters
// declare the structured parts of their CLI (binary, flag, in-harness verb);
// this pure module renders the three command variants from those parts. It has
// no I/O and no PTY dependency, so the server tier can depend on it without
// pulling process-spawning code into the domain.
package resumecmd

import (
	"fmt"
)

// Spec is the adapter-declared, structured resume-command data. It is fully
// static per adapter; the directory and session id come from the session at
// render time.
type Spec struct {
	// Binary is the CLI binary name, e.g. "opencode".
	Binary string
	// Flag is the resume flag token without the id, e.g. "-s", "--resume",
	// "--composer".
	Flag string
	// Sep joins Flag and id: " " for space-separated flags, "=" for
	// value-attached flags such as copilot's "--resume=<id>". Empty means
	// space-separated.
	Sep string
	// Verb is the in-harness slash command, e.g. "/session". Empty means
	// the default "/resume".
	Verb string
}

// Command renders the full filesystem command:
// `cd <dir> && <binary> <flag><sep><id>`. An empty dir falls back to "."
// (the current directory), matching how agents report cwd-less sessions.
func (s *Spec) Command(dir, id string) string {
	if dir == "" {
		dir = "."
	}
	return fmt.Sprintf("cd %s && %s %s", dir, s.Binary, s.flagAndID(id))
}

// CommandNoCD renders the same invocation with the `cd <dir> && ` prefix
// stripped, for running in a shell already positioned at the session's
// directory.
func (s *Spec) CommandNoCD(id string) string {
	return fmt.Sprintf("%s %s", s.Binary, s.flagAndID(id))
}

// AgentCommand renders the in-harness resume command, e.g. `/resume <id>`.
func (s *Spec) AgentCommand(id string) string {
	verb := s.Verb
	if verb == "" {
		verb = "/resume"
	}
	return fmt.Sprintf("%s %s", verb, id)
}

func (s *Spec) flagAndID(id string) string {
	sep := s.Sep
	if sep == "" {
		sep = " "
	}
	return s.Flag + sep + id
}
