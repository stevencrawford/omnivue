package ingest

import (
	"fmt"
	"sort"
)

// AdapterFactory creates an Adapter for a given source path.
type AdapterFactory func(path string) (Adapter, error)

// Detector checks whether a path contains session data for an agent type.
// The path is already expanded and verified to exist.
type Detector func(path string) *DiscoveredSource

type registration struct {
	agentType   AgentType
	label       string
	defaultPath string
	factory     AdapterFactory
	detector    Detector
}

var registry []registration

// Register adds an agent type to the global registry.
// Called from adapter package init() functions.
func Register(t AgentType, label, defaultPath string, f AdapterFactory, d Detector) {
	registry = append(registry, registration{t, label, defaultPath, f, d})
}

// CreateAdapter creates an Adapter for the given Source by looking up the
// registered adapter factory for the source's agent type.
func CreateAdapter(src Source) (Adapter, error) {
	for _, r := range registry {
		if r.agentType == src.AgentType {
			return r.factory(src.Path)
		}
	}
	return nil, fmt.Errorf("unknown agent type: %s", src.AgentType)
}

// AgentInfo holds information about a registered agent type.
type AgentInfo struct {
	Type  AgentType `json:"type"`
	Label string    `json:"label"`
}

// AgentPathInfo holds information about a registered agent type with its default path.
type AgentPathInfo struct {
	Type        AgentType `json:"type"`
	Label       string    `json:"label"`
	DefaultPath string    `json:"defaultPath"`
}

// KnownAgentTypes returns all registered agent types with their labels,
// sorted by agent type for deterministic ordering across builds.
func KnownAgentTypes() []AgentInfo {
	infos := make([]AgentInfo, len(registry))
	for i, r := range registry {
		infos[i] = AgentInfo{Type: r.agentType, Label: r.label}
	}
	sort.Slice(infos, func(i, j int) bool { return infos[i].Type < infos[j].Type })
	return infos
}

// DefaultPaths returns all registered agent types with their default discovery paths,
// sorted by agent type for deterministic ordering across builds.
func DefaultPaths() []AgentPathInfo {
	infos := make([]AgentPathInfo, len(registry))
	for i, r := range registry {
		infos[i] = AgentPathInfo{Type: r.agentType, Label: r.label, DefaultPath: r.defaultPath}
	}
	sort.Slice(infos, func(i, j int) bool { return infos[i].Type < infos[j].Type })
	return infos
}
