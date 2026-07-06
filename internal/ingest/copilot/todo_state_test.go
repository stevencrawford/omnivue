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
	}
	for _, c := range cases {
		got := todoTableRe.MatchString(c.query)
		if got != c.match {
			t.Errorf("todoTableRe.MatchString(%q) = %v, want %v", c.query, got, c.match)
		}
	}
}
