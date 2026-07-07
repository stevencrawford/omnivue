package copilot

import (
	"encoding/json"
	"testing"
)

func TestTodoState_InsertParsesTaskNames(t *testing.T) {
	ts := newTodoState()
	ts.applySQL(`INSERT INTO "todos" (id, title, description) VALUES ('1', 'Fix login bug', 'The login form crashes')`)
	ts.applySQL(`INSERT INTO todos (id, title) VALUES ('2', 'Add dark mode')`)

	result := ts.synthesizeInput()
	if result == "" || result == "{}" {
		t.Fatal("expected non-empty result")
	}

	var parsed struct {
		Todos []struct {
			ID      string `json:"id"`
			Content string `json:"content"`
			Status  string `json:"status"`
		} `json:"todos"`
	}
	if err := json.Unmarshal([]byte(result), &parsed); err != nil {
		t.Fatalf("invalid JSON: %v", err)
	}
	if len(parsed.Todos) != 2 {
		t.Fatalf("expected 2 todos, got %d", len(parsed.Todos))
	}

	if parsed.Todos[0].ID != "1" || parsed.Todos[0].Content != "Fix login bug: The login form crashes" {
		t.Errorf("first item: id=%q content=%q", parsed.Todos[0].ID, parsed.Todos[0].Content)
	}
	if parsed.Todos[1].ID != "2" || parsed.Todos[1].Content != "Add dark mode" {
		t.Errorf("second item: id=%q content=%q", parsed.Todos[1].ID, parsed.Todos[1].Content)
	}
	if parsed.Todos[1].Status != "pending" {
		t.Errorf("expected pending status, got %q", parsed.Todos[1].Status)
	}
}

func TestTodoState_UpdateChangesStatus(t *testing.T) {
	ts := newTodoState()
	ts.applySQL(`INSERT INTO todos (id, title) VALUES ('1', 'Task A')`)
	ts.applySQL(`INSERT INTO todos (id, title) VALUES ('2', 'Task B')`)
	ts.applySQL(`UPDATE todos SET status = 'in_progress' WHERE id = '1'`)
	ts.applySQL(`UPDATE todos SET status = 'done', updated_at = datetime() WHERE id = '2'`)

	result := ts.synthesizeInput()
	var parsed struct {
		Todos []struct {
			ID     string `json:"id"`
			Status string `json:"status"`
		} `json:"todos"`
	}
	if err := json.Unmarshal([]byte(result), &parsed); err != nil {
		t.Fatalf("invalid JSON: %v", err)
	}

	for _, todo := range parsed.Todos {
		switch todo.ID {
		case "1":
			if todo.Status != "in_progress" {
				t.Errorf("expected in_progress for task 1, got %q", todo.Status)
			}
		case "2":
			if todo.Status != "completed" {
				t.Errorf("expected completed for task 2 (done), got %q", todo.Status)
			}
		}
	}
}

func TestTodoState_MultipleStatementsInOneCall(t *testing.T) {
	// In production, events.go splits on ";" before calling applySQL
	ts := newTodoState()
	ts.applySQL(`INSERT INTO todos (id, title) VALUES ('1', 'Task A')`)
	ts.applySQL(`INSERT INTO todos (id, title) VALUES ('2', 'Task B')`)
	ts.applySQL(`UPDATE todos SET status = 'done' WHERE id = '1'`)

	result := ts.synthesizeInput()
	var parsed struct {
		Todos []struct {
			ID     string `json:"id"`
			Status string `json:"status"`
		} `json:"todos"`
	}
	if err := json.Unmarshal([]byte(result), &parsed); err != nil {
		t.Fatalf("invalid JSON: %v", err)
	}
	if len(parsed.Todos) != 2 {
		t.Fatalf("expected 2 todos, got %d", len(parsed.Todos))
	}
	if parsed.Todos[0].ID != "1" || parsed.Todos[0].Status != "completed" {
		t.Errorf("expected task 1 completed, got status=%q", parsed.Todos[0].Status)
	}
}

func TestTodoState_DeleteClearsItems(t *testing.T) {
	ts := newTodoState()
	ts.applySQL(`INSERT INTO todos (id, title) VALUES ('1', 'Task A')`)
	ts.applySQL(`DELETE FROM todos`)

	result := ts.synthesizeInput()
	var parsed struct {
		Todos []struct{} `json:"todos"`
	}
	if err := json.Unmarshal([]byte(result), &parsed); err != nil {
		t.Fatalf("invalid JSON: %v", err)
	}
	if len(parsed.Todos) != 0 {
		t.Fatalf("expected empty after delete, got %d items", len(parsed.Todos))
	}
}

func TestTodoState_NonTodoSQLIsIgnored(t *testing.T) {
	ts := newTodoState()
	ts.applySQL(`INSERT INTO todos (id, title) VALUES ('1', 'Task A')`)
	ts.applySQL(`SELECT * FROM sessions`)

	result := ts.synthesizeInput()
	var parsed struct {
		Todos []struct {
			ID string `json:"id"`
		} `json:"todos"`
	}
	if err := json.Unmarshal([]byte(result), &parsed); err != nil {
		t.Fatalf("invalid JSON: %v", err)
	}
	if len(parsed.Todos) != 1 {
		t.Fatalf("expected 1 todo (non-todo SQL ignored), got %d", len(parsed.Todos))
	}
}

func TestTodoState_EmptyStateReturnsEmptyArray(t *testing.T) {
	ts := newTodoState()
	result := ts.synthesizeInput()
	var parsed struct {
		Todos []struct{} `json:"todos"`
	}
	if err := json.Unmarshal([]byte(result), &parsed); err != nil {
		t.Fatalf("invalid JSON: %v", err)
	}
	if len(parsed.Todos) != 0 {
		t.Fatalf("expected empty array, got %d items", len(parsed.Todos))
	}
}

func TestTodoState_CopilotNoSpaceWherePattern(t *testing.T) {
	// Copilot uses "WHERE id='value'" (no spaces around =) in real output
	ts := newTodoState()
	ts.applySQL(`INSERT INTO todos (id, title) VALUES ('tests', 'Writing tests')`)
	ts.applySQL(`INSERT INTO todos (id, title) VALUES ('docs', 'Writing docs')`)
	ts.applySQL(`UPDATE todos SET status='done' WHERE id='tests'`)
	ts.applySQL(`UPDATE todos SET status='in_progress' WHERE id='docs'`)

	result := ts.synthesizeInput()
	var parsed struct {
		Todos []struct {
			ID     string `json:"id"`
			Status string `json:"status"`
		} `json:"todos"`
	}
	if err := json.Unmarshal([]byte(result), &parsed); err != nil {
		t.Fatalf("invalid JSON: %v", err)
	}

	for _, todo := range parsed.Todos {
		switch todo.ID {
		case "tests":
			if todo.Status != "completed" {
				t.Errorf("expected tests=completed, got %q", todo.Status)
			}
		case "docs":
			if todo.Status != "in_progress" {
				t.Errorf("expected docs=in_progress, got %q", todo.Status)
			}
		}
	}
}

func TestTodoState_DescriptionUpdate(t *testing.T) {
	ts := newTodoState()
	ts.applySQL(`INSERT INTO todos (id, title, description) VALUES ('task1', 'Implement feature', 'Initial description')`)
	ts.applySQL(`UPDATE todos SET description = 'Refined: add error handling and validation' WHERE id = 'task1'`)

	result := ts.synthesizeInput()
	var parsed struct {
		Todos []struct {
			ID      string `json:"id"`
			Content string `json:"content"`
			Status  string `json:"status"`
		} `json:"todos"`
	}
	if err := json.Unmarshal([]byte(result), &parsed); err != nil {
		t.Fatalf("invalid JSON: %v", err)
	}
	if len(parsed.Todos) != 1 {
		t.Fatalf("expected 1 todo, got %d", len(parsed.Todos))
	}
	if parsed.Todos[0].Content != "Implement feature: Refined: add error handling and validation" {
		t.Errorf("expected updated content, got %q", parsed.Todos[0].Content)
	}
	if parsed.Todos[0].Status != "pending" {
		t.Errorf("expected pending status, got %q", parsed.Todos[0].Status)
	}
}

func TestTodoState_DescriptionUpdateNoSpaceWhere(t *testing.T) {
	// Copilot may write "WHERE id='value'" (no space) in description updates too
	ts := newTodoState()
	ts.applySQL(`INSERT INTO todos (id, title, description) VALUES ('task1', 'Implement feature', 'Initial')`)
	ts.applySQL(`UPDATE todos SET description = 'Refined description' WHERE id='task1'`)

	result := ts.synthesizeInput()
	var parsed struct {
		Todos []struct {
			ID      string `json:"id"`
			Content string `json:"content"`
		} `json:"todos"`
	}
	if err := json.Unmarshal([]byte(result), &parsed); err != nil {
		t.Fatalf("invalid JSON: %v", err)
	}
	if parsed.Todos[0].Content != "Implement feature: Refined description" {
		t.Errorf("expected updated content, got %q", parsed.Todos[0].Content)
	}
}

func TestTodoState_DescriptionThenStatusUpdate(t *testing.T) {
	// Description refined mid-session, then marked done
	ts := newTodoState()
	ts.applySQL(`INSERT INTO todos (id, title, description) VALUES ('task', 'My task', 'Original')`)
	ts.applySQL(`UPDATE todos SET description = 'Refined: add error handling' WHERE id='task'`)

	// After description update, verify content updated but status still pending
	descResult := ts.synthesizeInput()
	var descParsed struct {
		Todos []struct {
			ID      string `json:"id"`
			Content string `json:"content"`
			Status  string `json:"status"`
		} `json:"todos"`
	}
	if err := json.Unmarshal([]byte(descResult), &descParsed); err != nil {
		t.Fatalf("unmarshal desc result: %v", err)
	}
	if descParsed.Todos[0].Content != "My task: Refined: add error handling" {
		t.Errorf("after desc update, content=%q", descParsed.Todos[0].Content)
	}
	if descParsed.Todos[0].Status != "pending" {
		t.Errorf("after desc update, status=%q", descParsed.Todos[0].Status)
	}

	// Now mark done
	ts.applySQL(`UPDATE todos SET status='done' WHERE id='task'`)

	doneResult := ts.synthesizeInput()
	var doneParsed struct {
		Todos []struct {
			ID      string `json:"id"`
			Content string `json:"content"`
			Status  string `json:"status"`
		} `json:"todos"`
	}
	if err := json.Unmarshal([]byte(doneResult), &doneParsed); err != nil {
		t.Fatalf("unmarshal done result: %v", err)
	}
	if doneParsed.Todos[0].Status != "completed" {
		t.Errorf("expected completed, got %q", doneParsed.Todos[0].Status)
	}
	if doneParsed.Todos[0].Content != "My task: Refined: add error handling" {
		t.Errorf("content regressed after status update, got %q", doneParsed.Todos[0].Content)
	}
}

func TestTodoState_FullSessionLifecycle(t *testing.T) {
	// Simulates the actual SQL from the reviewed session
	ts := newTodoState()

	// Initial INSERT
	ts.applySQL(`INSERT INTO todos (id, title) VALUES ('ff-resolver-v13', 'Adding resolver')`)
	ts.applySQL(`INSERT INTO todos (id, title) VALUES ('controller', 'Creating controller')`)
	ts.applySQL(`INSERT INTO todos (id, title) VALUES ('tests', 'Writing tests')`)

	// Description refinement
	ts.applySQL(`UPDATE todos SET description = 'Add method following existing patterns' WHERE id = 'ff-resolver-v13'`)
	ts.applySQL(`UPDATE todos SET description = 'GET endpoint with params' WHERE id = 'controller'`)

	// Multiple status transitions
	ts.applySQL(`UPDATE todos SET status='done' WHERE id='ff-resolver-v13'`)
	ts.applySQL(`UPDATE todos SET status='in_progress' WHERE id='controller'`)

	// Final done with no-space pattern
	ts.applySQL(`UPDATE todos SET status='done' WHERE id='controller'`)
	ts.applySQL(`UPDATE todos SET status='done' WHERE id='tests'`)

	result := ts.synthesizeInput()
	var parsed struct {
		Todos []struct {
			ID      string `json:"id"`
			Content string `json:"content"`
			Status  string `json:"status"`
		} `json:"todos"`
	}
	if err := json.Unmarshal([]byte(result), &parsed); err != nil {
		t.Fatalf("invalid JSON: %v", err)
	}

	states := make(map[string]string)
	contents := make(map[string]string)
	for _, todo := range parsed.Todos {
		states[todo.ID] = todo.Status
		contents[todo.ID] = todo.Content
	}

	if states["ff-resolver-v13"] != "completed" {
		t.Errorf("ff-resolver-v13 expected completed, got %q", states["ff-resolver-v13"])
	}
	if states["controller"] != "completed" {
		t.Errorf("controller expected completed, got %q", states["controller"])
	}
	if states["tests"] != "completed" {
		t.Errorf("tests expected completed, got %q", states["tests"])
	}
	if contents["ff-resolver-v13"] != "Adding resolver: Add method following existing patterns" {
		t.Errorf("ff-resolver-v13 content wrong: %q", contents["ff-resolver-v13"])
	}
	if contents["controller"] != "Creating controller: GET endpoint with params" {
		t.Errorf("controller content wrong: %q", contents["controller"])
	}
}

func TestTodoState_TodoTableReMatches(t *testing.T) {
	cases := []struct {
		query string
		match bool
	}{
		{`SELECT * FROM todos`, true},
		{`SELECT * FROM "todos"`, true},
		{`INSERT INTO todos (id, title) VALUES (1, 'x')`, true},
		{`INSERT INTO "todos" (id, title) VALUES (1, 'x')`, true},
		{`UPDATE todos SET status = 'done'`, true},
		{`DELETE FROM todos`, true},
		{`CREATE TABLE todos (id TEXT)`, true},
		{`ALTER TABLE todos ADD COLUMN x TEXT`, true},
		{`SELECT * FROM sessions`, false},
		{`INSERT INTO users (id) VALUES (1)`, false},
		{`INSERT INTO todo_deps (todo_id, depends_on) VALUES ('a','b')`, false},
	}
	for _, c := range cases {
		got := todoTableRe.MatchString(c.query)
		if got != c.match {
			t.Errorf("todoTableRe.MatchString(%q) = %v, want %v", c.query, got, c.match)
		}
	}
}
