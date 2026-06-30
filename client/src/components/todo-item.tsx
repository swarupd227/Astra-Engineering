import { Checkbox } from "@/components/ui/checkbox";
import { useState } from "react";

interface TodoItemProps {
  id: string;
  text: string;
  completed?: boolean;
  onToggle?: (id: string, completed: boolean) => void;
}

export function TodoItem({ id, text, completed = false, onToggle }: TodoItemProps) {
  const [isCompleted, setIsCompleted] = useState(completed);

  const handleToggle = (checked: boolean) => {
    setIsCompleted(checked);
    onToggle?.(id, checked);
    console.log(`Todo ${id} ${checked ? 'completed' : 'uncompleted'}`);
  };

  return (
    <div className="flex items-center gap-3 py-2" data-testid={`todo-${id}`}>
      <Checkbox
        checked={isCompleted}
        onCheckedChange={handleToggle}
        data-testid={`checkbox-todo-${id}`}
      />
      <span className={`text-sm ${isCompleted ? 'text-muted-foreground line-through' : ''}`}>
        {text}
      </span>
    </div>
  );
}
