import type { TodoItem } from "../types";

interface Props {
  todos: TodoItem[];
}

const STATUS_ICON: Record<TodoItem["status"], string> = {
  pending: "○",
  in_progress: "◉",
  completed: "✓",
};

export function TodoCard({ todos }: Props) {
  return (
    <div className="todo-card">
      <div className="todo-card-head">
        <span className="todo-card-icon">📋</span>
        <span className="todo-card-label">TodoWrite</span>
        <span className="todo-card-count">
          {todos.filter((t) => t.status === "completed").length}/{todos.length}
        </span>
      </div>
      <div className="todo-card-body">
        {todos.map((t) => (
          <div
            key={t.index}
            className={`todo-item${t.status === "completed" ? " done" : ""}${t.status === "in_progress" ? " active" : ""}`}
          >
            <span className={`todo-status ${t.status}`}>
              {STATUS_ICON[t.status]}
            </span>
            <span className="todo-text">{t.content}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
