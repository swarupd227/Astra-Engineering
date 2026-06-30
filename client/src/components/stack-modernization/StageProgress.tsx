/**
 * Stage progress from API - shows backend pipeline stages (pending / in_progress / completed).
 */

import { CheckCircle2, Circle } from "lucide-react";

export interface StageItem {
  name: string;
  status: "pending" | "in_progress" | "completed";
  progress?: number;
}

interface StageProgressProps {
  stages: StageItem[];
  className?: string;
}

export function StageProgress({ stages, className = "" }: StageProgressProps) {
  if (!stages || stages.length === 0) return null;

  return (
    <div className={`rounded-lg border bg-muted/30 p-3 ${className}`}>
      <p className="text-sm font-medium mb-2">Pipeline stages</p>
      <ul className="space-y-1.5">
        {stages.map((s, i) => (
          <li key={i} className="flex items-center gap-2 text-sm">
            {s.status === "completed" ? (
              <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400 shrink-0" />
            ) : s.status === "in_progress" ? (
              <div className="h-4 w-4 rounded-full bg-primary shrink-0" title="In progress" />
            ) : (
              <Circle className="h-4 w-4 text-muted-foreground shrink-0" />
            )}
            <span
              className={
                s.status === "completed"
                  ? "text-muted-foreground"
                  : s.status === "in_progress"
                    ? "font-medium text-foreground"
                    : "text-muted-foreground"
              }
            >
              {s.name}
            </span>
            {s.progress != null && s.status !== "completed" && (
              <span className="text-xs text-muted-foreground ml-auto">{s.progress}%</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
