"use client";

import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

export interface WizardProgressProps {
  currentStepIndex: number;
  totalSteps: number;
  stepLabels: readonly string[];
  className?: string;
}

export function WizardProgress({
  currentStepIndex,
  totalSteps,
  stepLabels,
  className,
}: WizardProgressProps) {
  const pct = Math.round(((currentStepIndex + 1) / totalSteps) * 100);

  return (
    <div className={cn("space-y-3", className)}>
      <div className="flex items-center justify-between gap-3 text-xs">
        <span className="text-muted-foreground font-medium tracking-wide uppercase">
          Progress
        </span>
        <span className="text-foreground tabular-nums">
          Step {currentStepIndex + 1} of {totalSteps}
        </span>
      </div>
      <div className="bg-muted h-2 overflow-hidden rounded-full">
        <div
          className="from-primary to-primary/80 h-full rounded-full bg-gradient-to-r transition-all duration-500 ease-out"
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="-mx-1 flex gap-1 overflow-x-auto pb-1 pt-0.5">
        {stepLabels.map((label, i) => {
          const done = i < currentStepIndex;
          const active = i === currentStepIndex;
          return (
            <div
              key={`${label}-${i}`}
              className={cn(
                "flex min-w-0 shrink-0 items-center gap-1.5 rounded-lg px-2 py-1 text-[11px] font-medium transition-colors",
                done && "text-muted-foreground",
                active && "bg-accent text-foreground ring-1 ring-border",
                !done && !active && "text-muted-foreground/70",
              )}
              title={label}
            >
              <span
                className={cn(
                  "flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px]",
                  done && "bg-primary/15 text-primary",
                  active && "bg-primary text-primary-foreground",
                  !done && !active && "bg-muted text-muted-foreground",
                )}
              >
                {done ? (
                  <Check className="text-primary h-3 w-3" strokeWidth={3} />
                ) : (
                  i + 1
                )}
              </span>
              <span className="max-w-[5.5rem] truncate sm:max-w-[7rem]">
                {label}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
