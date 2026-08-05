package resumecmd

import (
	"testing"
)

func TestSpecCommand(t *testing.T) {
	cases := []struct {
		name  string
		spec  Spec
		dir   string
		id    string
		want  string
	}{
		{"space separated", Spec{Binary: "opencode", Flag: "-s"}, "/proj", "abc", "cd /proj && opencode -s abc"},
		{"attached flag", Spec{Binary: "copilot", Flag: "--resume", Sep: "="}, "/proj", "abc", "cd /proj && copilot --resume=abc"},
		{"flagless", Spec{Binary: "codex", Flag: "resume"}, "/proj", "abc", "cd /proj && codex resume abc"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := c.spec.Command(c.dir, c.id); got != c.want {
				t.Errorf("Command(%q, %q) = %q, want %q", c.dir, c.id, got, c.want)
			}
		})
	}
}

func TestSpecCommandNoCD(t *testing.T) {
	cases := []struct {
		name string
		spec Spec
		id   string
		want string
	}{
		{"space separated", Spec{Binary: "claude", Flag: "-r"}, "abc", "claude -r abc"},
		{"attached flag", Spec{Binary: "copilot", Flag: "--resume", Sep: "="}, "abc", "copilot --resume=abc"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := c.spec.CommandNoCD(c.id); got != c.want {
				t.Errorf("CommandNoCD(%q) = %q, want %q", c.id, got, c.want)
			}
		})
	}
}

func TestSpecAgentCommand(t *testing.T) {
	cases := []struct {
		name string
		spec Spec
		id   string
		want string
	}{
		{"default verb", Spec{Binary: "pi", Flag: "--session"}, "abc", "/resume abc"},
		{"custom verb", Spec{Binary: "opencode", Flag: "-s", Verb: "/session"}, "abc", "/session abc"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := c.spec.AgentCommand(c.id); got != c.want {
				t.Errorf("AgentCommand(%q) = %q, want %q", c.id, got, c.want)
			}
		})
	}
}
