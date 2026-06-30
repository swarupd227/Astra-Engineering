/**
 * TaskExecutionAccordion - Expandable task rows with live status updates.
 * Each task shows status, when expanded shows summary, altered files, and verification notes.
 */

import { useState, useEffect } from "react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CheckCircle2, Loader2, XCircle, Clock, FileCode2, AlertTriangle, RotateCw } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";

interface TaskExecutionResult {
  taskId: string;
  status: "pending" | "in_progress" | "completed" | "failed" | "skipped";
  summary: string;
  alteredFiles: Array<{
    path: string;
    changeDescription: string;
    linesChanged: number;
  }>;
  fixedIssues: string[];
  verificationFiles: string[];
  startedAt?: string;
  completedAt?: string;
  error?: string;
}

interface UpgradeTask {
  id: string;
  title: string;
  description: string;
  phase: string;
  riskLevel: "low" | "medium" | "high";
  estimatedTime: string;
  autoFixable: boolean;
  steps: string[];
  verificationCriteria: string[];
  affectedFiles: string[];
  status: string;
}

export interface TaskExecutionAccordionProps {
  tasks: UpgradeTask[];
  executionResults: TaskExecutionResult[];
  analysisId?: string;
  onRetryStarted?: () => void;
  className?: string;
}

const RISK_COLORS: Record<string, string> = {
  low: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
  medium: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400",
  high: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
};

function TaskStatusIcon({ status }: { status: string }) {
  switch (status) {
    case "completed":
      return <CheckCircle2 className="h-5 w-5 text-green-500 shrink-0" />;
    case "in_progress":
      return <Loader2 className="h-5 w-5 text-blue-500 animate-spin shrink-0" />;
    case "failed":
      return <XCircle className="h-5 w-5 text-red-500 shrink-0" />;
    case "skipped":
      return <AlertTriangle className="h-5 w-5 text-muted-foreground shrink-0" />;
    default:
      return <Clock className="h-5 w-5 text-muted-foreground/50 shrink-0" />;
  }
}

function formatDuration(start?: string, end?: string): string {
  if (!start) return "";
  const s = new Date(start).getTime();
  const e = end ? new Date(end).getTime() : Date.now();
  const diff = Math.round((e - s) / 1000);
  if (diff < 60) return `${diff}s`;
  return `${Math.round(diff / 60)}m ${diff % 60}s`;
}

export function TaskExecutionAccordion({ tasks, executionResults, analysisId, onRetryStarted, className = "" }: TaskExecutionAccordionProps) {
  const [retryingTasks, setRetryingTasks] = useState<Set<string>>(new Set());

  // Clear retrying indicator when the task finishes (status changes from in_progress)
  useEffect(() => {
    if (retryingTasks.size === 0) return;
    setRetryingTasks((prev) => {
      const next = new Set(prev);
      for (const taskId of prev) {
        const result = executionResults.find((r) => r.taskId === taskId);
        if (result && result.status !== "in_progress") {
          next.delete(taskId);
        }
      }
      return next.size !== prev.size ? next : prev;
    });
  }, [executionResults, retryingTasks.size]);

  const handleRetry = async (taskId: string) => {
    if (!analysisId) return;
    setRetryingTasks((prev) => new Set(prev).add(taskId));
    try {
      const res = await apiRequest("POST", `/api/stack-modernization/analysis/${analysisId}/retry-task/${taskId}`);
      if (res.ok) {
        onRetryStarted?.();
      }
    } catch (err) {
      console.error("Retry failed:", err);
      setRetryingTasks((prev) => {
        const next = new Set(prev);
        next.delete(taskId);
        return next;
      });
    }
  };

  if (!tasks || tasks.length === 0) {
    return (
      <div className={`flex flex-col items-center justify-center py-12 text-muted-foreground ${className}`}>
        <p className="text-sm font-medium">No upgrade tasks available</p>
        <p className="text-xs mt-1">Tasks may still be generating, or the task planner encountered an issue.</p>
      </div>
    );
  }

  return (
    <div className={`space-y-3 min-w-0 max-w-full overflow-hidden ${className}`}>
      {/* Task accordion */}
      <Accordion type="multiple" className="space-y-2">
        {tasks.map((task, index) => {
          // Robust fallbacks — ensure we always have a usable id and title
          const result = executionResults.find((r) => r.taskId === task.id) || executionResults[index];
          const status = result?.status || "pending";

          return (
            <AccordionItem
              key={task.id || `task-${index}`}
              value={task.id || `task-${index}`}
              className="border rounded-lg px-4 data-[state=open]:bg-muted/30 min-w-0 overflow-hidden"
            >
              <AccordionTrigger className="hover:no-underline py-3">
                <div className="flex items-center gap-3 w-full min-w-0">
                  <TaskStatusIcon status={status} />
                  <div className="flex-1 text-left min-w-0">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="font-medium text-sm truncate">
                        {task.title || task.description?.slice(0, 80) || `Task ${index + 1}`}
                      </span>
                      <Badge variant="outline" className={`text-[10px] shrink-0 ${RISK_COLORS[task.riskLevel] || ""}`}>
                        {task.riskLevel || "medium"}
                      </Badge>
                      {task.estimatedTime && (
                        <span className="text-[10px] text-muted-foreground">{task.estimatedTime}</span>
                      )}
                    </div>
                    {status === "in_progress" && (
                      <span className="text-xs text-blue-500">Executing...</span>
                    )}
                    {status === "completed" && result?.summary && (
                      <span className="text-xs text-green-600 dark:text-green-400 line-clamp-1">{result.summary}</span>
                    )}
                    {status === "failed" && result?.error && (
                      <span className="text-xs text-red-500 line-clamp-1">{result.error}</span>
                    )}
                    {retryingTasks.has(task.id) && (
                      <span className="text-xs text-blue-500 animate-pulse">Retrying...</span>
                    )}
                  </div>
                  {result?.startedAt && (
                    <span className="text-[10px] text-muted-foreground shrink-0">
                      {formatDuration(result.startedAt, result.completedAt)}
                    </span>
                  )}
                </div>
              </AccordionTrigger>

              <AccordionContent className="pt-2 pb-4 space-y-3 min-w-0">
                {/* Task description: long lines scroll inside this block only, never expand the page */}
                <div className="text-sm text-muted-foreground min-w-0 max-w-full overflow-x-auto overflow-y-hidden rounded border border-border/50 bg-muted/20 p-2">
                  <pre className="whitespace-pre font-sans text-inherit m-0 text-xs">{task.description}</pre>
                </div>

                {/* Steps */}
                {task.steps?.length > 0 && (
                  <div className="min-w-0 overflow-x-auto">
                    <p className="text-xs font-medium mb-1">Steps:</p>
                    <ol className="text-xs text-muted-foreground list-decimal list-inside space-y-0.5 break-words">
                      {task.steps.map((step, i) => (
                        <li key={i} className="break-words">{step}</li>
                      ))}
                    </ol>
                  </div>
                )}

                {/* Execution result details */}
                {result && status !== "pending" && (
                  <div className="border-t pt-3 space-y-2">
                    {/* Retry button for failed tasks */}
                    {status === "failed" && analysisId && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-xs gap-1.5 border-red-200 text-red-600 hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950/30"
                        onClick={() => handleRetry(task.id)}
                        disabled={retryingTasks.has(task.id)}
                      >
                        {retryingTasks.has(task.id) ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <RotateCw className="h-3 w-3" />
                        )}
                        Retry This Task
                      </Button>
                    )}

                    {/* Summary */}
                    {result.summary && (
                      <div className="bg-muted/50 rounded p-2 text-xs min-w-0 overflow-x-auto break-words">
                        <span className="font-medium">Summary: </span>
                        <span className="break-words">{result.summary}</span>
                      </div>
                    )}

                    {/* Altered files */}
                    {result.alteredFiles?.length > 0 && (
                      <div className="min-w-0 overflow-x-auto">
                        <p className="text-xs font-medium mb-1">Files Changed ({result.alteredFiles.length}):</p>
                        <div className="space-y-1">
                          {result.alteredFiles.map((f, i) => (
                            <div key={i} className="flex items-start gap-2 text-xs min-w-0">
                              <FileCode2 className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                              <div className="min-w-0 overflow-x-auto">
                                <span className="font-mono break-all">{f.path}</span>
                                <span className="text-muted-foreground ml-1">
                                  ({f.linesChanged > 0 ? `${f.linesChanged} lines` : "modified"})
                                </span>
                                {f.changeDescription && (
                                  <p className="text-muted-foreground break-words">{f.changeDescription}</p>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Fixed issues */}
                    {result.fixedIssues?.length > 0 && (
                      <div className="min-w-0 overflow-x-auto break-words">
                        <p className="text-xs font-medium mb-1">Issues Fixed:</p>
                        <ul className="text-xs text-muted-foreground list-disc list-inside break-words">
                          {result.fixedIssues.map((issue, i) => (
                            <li key={i} className="break-words">{issue}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {/* Verification files */}
                    {result.verificationFiles?.length > 0 && (
                      <div className="min-w-0 overflow-x-auto">
                        <p className="text-xs font-medium mb-1">Verify in:</p>
                        <ul className="text-xs text-muted-foreground font-mono list-disc list-inside break-all">
                          {result.verificationFiles.map((f, i) => (
                            <li key={i} className="break-all">{f}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                )}

                {/* Verification criteria (from task definition) */}
                {task.verificationCriteria?.length > 0 && (
                  <div className="text-xs min-w-0 overflow-x-auto break-words">
                    <p className="font-medium mb-1">Verification Criteria:</p>
                    <ul className="text-muted-foreground list-disc list-inside break-words">
                      {task.verificationCriteria.map((vc, i) => (
                        <li key={i} className="break-words">{vc}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </AccordionContent>
            </AccordionItem>
          );
        })}
      </Accordion>
    </div>
  );
}
