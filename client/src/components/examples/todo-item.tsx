import { TodoItem } from "../todo-item";

export default function TodoItemExample() {
  return (
    <div className="p-4 max-w-md space-y-2">
      <TodoItem id="1" text="Review pull requests" completed={false} />
      <TodoItem id="2" text="Update documentation" completed={true} />
    </div>
  );
}
