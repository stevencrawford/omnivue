package githubcloud

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/stevencrawford/omnivue/internal/ingest"
)

const (
	apiBase       = "https://api.github.com"
	apiVersion    = "2022-11-28"
	agentTasksURL = apiBase + "/agents/tasks"
	pollInterval  = 30 * time.Second
)

// apiTaskSession maps the session object nested inside each task.
type apiTaskSession struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	State       string `json:"state"`
	CreatedAt   string `json:"created_at"`
	UpdatedAt   string `json:"updated_at"`
	CompletedAt string `json:"completed_at,omitempty"`
	Prompt      string `json:"prompt,omitempty"`
	HeadRef     string `json:"head_ref,omitempty"`
	BaseRef     string `json:"base_ref,omitempty"`
	Model       string `json:"model,omitempty"`
}

// apiTask maps the task object from GET /agents/tasks.
type apiTask struct {
	ID           string           `json:"id"`
	Name         string           `json:"name"`
	State        string           `json:"state"`
	SessionCount int              `json:"session_count"`
	Sessions     []apiTaskSession `json:"sessions,omitempty"`
	Artifact     *apiTaskArtifact `json:"artifact,omitempty"`
	CreatedAt    string           `json:"created_at"`
	UpdatedAt    string           `json:"updated_at"`
}

type apiTaskArtifact struct {
	Provider string          `json:"provider"`
	Type     string          `json:"type"`
	Data     json.RawMessage `json:"data"`
}

// Adapter implements ingest.Adapter for GitHub Copilot cloud agent sessions.
type Adapter struct {
	mu     sync.RWMutex
	token  string
	client *http.Client

	muCache  sync.RWMutex
	cache    []ingest.Session
	lastPoll time.Time
}

// New creates a new githubcloud adapter with the given PAT.
// The token is not validated until the first API call.
func New(token string) *Adapter {
	return &Adapter{
		token:  token,
		client: &http.Client{Timeout: 30 * time.Second},
	}
}

// Type returns the agent type identifier.
func (a *Adapter) Type() ingest.AgentType {
	return ingest.AgentGitHubCloud
}

// Detect always returns nil — cloud sources are never auto-discovered.
func (a *Adapter) Detect(path string) bool {
	return false
}

// Close is a no-op for the cloud adapter.
func (a *Adapter) Close() error {
	return nil
}

// apiStateToOmnivue maps GitHub API task states to Omnivue session statuses.
func apiStateToOmnivue(state string) ingest.SessionStatus {
	switch state {
	case "queued":
		return ingest.SessionStatusPending
	case "in_progress", "idle":
		return ingest.SessionStatusActive
	case "waiting_for_user":
		return ingest.SessionStatusWaiting
	case "completed":
		return ingest.SessionStatusCompleted
	case "failed", "timed_out":
		return ingest.SessionStatusCompleted
	case "canceled":
		return ingest.SessionStatusArchived
	default:
		return ingest.SessionStatusPending
	}
}

// buildSessions converts API tasks and their nested sessions to unified Session objects.
func buildSessions(tasks []apiTask) []ingest.Session {
	var sessions []ingest.Session

	for _, task := range tasks {
		taskCreatedAt := parseTime(task.CreatedAt)
		taskUpdatedAt := parseTime(task.UpdatedAt)

		for _, s := range task.Sessions {
			repo := ""
			title := s.Name
			if title == "" {
				title = task.Name
			}

			session := ingest.Session{
				ID:           s.ID,
				SourceID:     "", // set by server
				Title:        title,
				Repository:   repo,
				Branch:       s.HeadRef,
				Agent:        ingest.AgentGitHubCloud,
				Model:        s.Model,
				Directory:    fmt.Sprintf("https://github.com/copilot/tasks/%s", s.ID),
				Status:       apiStateToOmnivue(s.State),
				CreatedAt:    parseTime(s.CreatedAt),
				UpdatedAt:    parseTime(s.UpdatedAt),
				MessageCount: 0,
				// Store additional metadata in metadata-like fields
				TODOs: []ingest.Todo{
					{
						ID:     "initial_prompt",
						Title:  s.Prompt,
						Status: string(s.State),
					},
					{
						ID:     "task_id",
						Title:  task.ID,
						Status: "",
					},
				},
			}

			if session.CreatedAt.IsZero() {
				session.CreatedAt = taskCreatedAt
			}
			if session.UpdatedAt.IsZero() {
				session.UpdatedAt = taskUpdatedAt
			}

			sessions = append(sessions, session)
		}
	}

	sort.Slice(sessions, func(i, j int) bool {
		return sessions[i].UpdatedAt.After(sessions[j].UpdatedAt)
	})

	return sessions
}

// parseTime parses an RFC3339 timestamp string.
func parseTime(s string) time.Time {
	if s == "" {
		return time.Time{}
	}
	t, err := time.Parse(time.RFC3339, s)
	if err != nil {
		t, err = time.Parse(time.RFC3339Nano, s)
		if err != nil {
			return time.Time{}
		}
	}
	return t
}

// ListSessions fetches all cloud agent tasks and returns unified sessions.
func (a *Adapter) ListSessions(ctx context.Context) ([]ingest.Session, error) {
	tasks, err := a.fetchTasks(ctx)
	if err != nil {
		return nil, err
	}

	sessions := buildSessions(tasks)

	a.muCache.Lock()
	a.cache = sessions
	a.lastPoll = time.Now()
	a.muCache.Unlock()

	return sessions, nil
}

// Session returns a single session by ID.
func (a *Adapter) Session(ctx context.Context, id string) (*ingest.Session, error) {
	a.muCache.RLock()
	for _, s := range a.cache {
		if s.ID == id {
			sess := s
			a.muCache.RUnlock()
			return &sess, nil
		}
	}
	cachedCount := len(a.cache)
	a.muCache.RUnlock()

	// Not in cache — refresh from API
	sessions, err := a.ListSessions(ctx)
	if err != nil {
		return nil, fmt.Errorf("github-cloud adapter: session %s not found (cached: %d): %w", id, cachedCount, err)
	}
	for _, s := range sessions {
		if s.ID == id {
			return &s, nil
		}
	}
	return nil, fmt.Errorf("github-cloud adapter: session %s not found", id)
}

// Messages returns nil — cloud sessions have no downloadable conversation data.
func (a *Adapter) Messages(ctx context.Context, sessionID string) ([]ingest.Message, error) {
	return nil, nil
}

// Plan returns nil — cloud sessions have no downloadable plan data.
func (a *Adapter) Plan(ctx context.Context, sessionID string) (*ingest.Plan, error) {
	return nil, nil
}

// Diffs returns nil — cloud sessions have no downloadable diff data.
func (a *Adapter) Diffs(ctx context.Context, sessionID string) ([]ingest.DiffFile, error) {
	return nil, nil
}

// Edits returns nil — cloud sessions have no downloadable edit data.
func (a *Adapter) Edits(ctx context.Context, sessionID string) ([]ingest.FileEdit, error) {
	return nil, nil
}

// ResumeCommand returns the GitHub URL to view this cloud session.
func (a *Adapter) ResumeCommand(session *ingest.Session) string {
	if session.Directory != "" && strings.HasPrefix(session.Directory, "https://") {
		return "open " + session.Directory
	}
	// Fallback: try to reconstruct from session ID.
	return fmt.Sprintf("open https://github.com/copilot/tasks/%s", session.ID)
}

// LastModified returns the latest update timestamp across all cached sessions.
func (a *Adapter) LastModified(ctx context.Context) (int64, error) {
	a.muCache.RLock()
	defer a.muCache.RUnlock()

	if len(a.cache) == 0 {
		return 0, nil
	}

	var latest time.Time
	for _, s := range a.cache {
		if s.UpdatedAt.After(latest) {
			latest = s.UpdatedAt
		}
	}

	if latest.IsZero() {
		return 0, nil
	}
	return latest.UnixMilli(), nil
}

// VerifyToken tests the configured PAT by making a single API call.
func VerifyToken(token string) (string, error) {
	if token == "" {
		return "", fmt.Errorf("token is required")
	}

	client := &http.Client{Timeout: 15 * time.Second}
	req, err := http.NewRequest(http.MethodGet, agentTasksURL, nil)
	if err != nil {
		return "", fmt.Errorf("creating verification request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("X-GitHub-Api-Version", apiVersion)

	resp, err := client.Do(req)
	if err != nil {
		return "", fmt.Errorf("api request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusOK {
		body, err := io.ReadAll(resp.Body)
		if err != nil {
			return "Token is valid", nil
		}
		var tasks []apiTask
		if err := json.Unmarshal(body, &tasks); err == nil {
			return fmt.Sprintf("Token is valid — found %d task(s)", len(tasks)), nil
		}
		return "Token is valid", nil
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", fmt.Errorf("api returned status %d (reading body: %w)", resp.StatusCode, err)
	}
	return "", fmt.Errorf("api returned %d: %s", resp.StatusCode, string(body))
}

// SetToken updates the PAT at runtime.
func (a *Adapter) SetToken(token string) {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.token = token
}

// doRequest performs an authenticated GET request to the GitHub API.
func (a *Adapter) doRequest(ctx context.Context, url string) ([]byte, error) {
	a.mu.RLock()
	token := a.token
	a.mu.RUnlock()
	if token == "" {
		return nil, fmt.Errorf("github-cloud adapter: no token configured")
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, fmt.Errorf("github-cloud adapter: creating request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("X-GitHub-Api-Version", apiVersion)

	resp, err := a.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("github-cloud adapter: API request: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("github-cloud adapter: reading response: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("github-cloud adapter: API returned %d: %s", resp.StatusCode, string(body))
	}

	return body, nil
}

// fetchTasks calls GET /agents/tasks and returns the parsed tasks.
func (a *Adapter) fetchTasks(ctx context.Context) ([]apiTask, error) {
	body, err := a.doRequest(ctx, agentTasksURL)
	if err != nil {
		return nil, err
	}

	// The API returns an array of tasks at the top level.
	var tasks []apiTask
	if err := json.Unmarshal(body, &tasks); err != nil {
		return nil, fmt.Errorf("github-cloud adapter: parsing tasks: %w", err)
	}

	return tasks, nil
}

// Ensure Adapter implements ingest.Adapter.
var _ ingest.Adapter = (*Adapter)(nil)
