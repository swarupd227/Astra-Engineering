"use client";

import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSessionIdentity } from "@/utils/msal-user";
import { getApiUrl } from "@/lib/api-config";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  ResponsiveContainer,
} from "recharts";
import {
  Loader2,
  PlayCircle,
  FileText,
  Clock,
  DollarSign,
  Calendar,
  Circle,
  CheckCircle2,
  Pencil,
  Trash2,
  Check,
} from "lucide-react";

export interface SessionListItem {
  id: string;
  title: string;
  status: "IN_PROGRESS" | "PAUSED" | "COMPLETED" | "INACTIVE";
  currentScreen?: string | null;
  lastAccessedAt?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  cost?: {
    totalCost: number;
    totalInputTokens?: number;
    totalOutputTokens?: number;
    totalCalls?: number;
  } | null;
}

interface WorkflowSessionsPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string | null;
  onResume: (sessionId: string) => void;
}

function formatRelativeTime(dateStr: string | null | undefined): string {
  if (!dateStr) return "—";
  try {
    const d = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);
    if (diffMins < 1) return "Just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return d.toLocaleDateString();
  } catch {
    return "—";
  }
}

export function WorkflowSessionsPanel({
  open,
  onOpenChange,
  projectId,
  onResume,
}: WorkflowSessionsPanelProps) {
  const identity = useSessionIdentity();
  const queryClient = useQueryClient();

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState<string>("");
  const [showAnalysis, setShowAnalysis] = useState(false);
  const [costChartType, setCostChartType] = useState<"column" | "line">("column");

  const { data, isLoading, error } = useQuery<{
    success?: boolean;
    sessions?: SessionListItem[];
  }>({
    queryKey: ["workflow-sessions", projectId, identity?.aadObjectId],
    queryFn: async () => {
      if (!projectId || !identity) return { sessions: [] };
      const res = await fetch(
        getApiUrl(`/api/projects/${encodeURIComponent(projectId)}/sessions`),
        {
          credentials: "include",
          headers: {
            "X-AAD-Object-ID": identity.aadObjectId,
            "X-User-Email": identity.userEmail,
            "X-User-Name": identity.userName,
          },
        }
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error ?? res.statusText);
      }
      return res.json();
    },
    enabled: open && !!projectId && !!identity,
    staleTime: 30_000,
  });

  const { data: totalCostData } = useQuery<{
    totalCost: number;
    sessionCount: number;
  }>({
    queryKey: ["workflow-sessions-total-cost", identity?.aadObjectId],
    queryFn: async () => {
      if (!identity) return { totalCost: 0, sessionCount: 0 };
      const res = await fetch(getApiUrl("/api/sessions/cost/total"), {
        credentials: "include",
        headers: {
          "X-AAD-Object-ID": identity.aadObjectId,
          "X-User-Email": identity.userEmail,
          "X-User-Name": identity.userName,
        },
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error ?? res.statusText);
      }
      return res.json();
    },
    enabled: open && !!identity,
    staleTime: 30_000,
  });

  const sessions: SessionListItem[] = data?.sessions ?? [];

  // Cost and count for this project only (from the project-scoped sessions list)
  const projectStats = useMemo(() => {
    const totalCost = sessions.reduce((sum, s) => sum + (s.cost?.totalCost ?? 0), 0);
    return { totalCost, sessionCount: sessions.length };
  }, [sessions]);

  const analysisData = useMemo(() => {
    if (!sessions.length) return [];

    const sorted = [...sessions].sort((a, b) => {
      const da = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const db = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return da - db;
    });

    return sorted.map((s, index) => ({
      index: index + 1,
      label: s.createdAt
        ? new Date(s.createdAt).toLocaleDateString(undefined, {
            month: "short",
            day: "numeric",
          })
        : `Session ${index + 1}`,
      title: s.title || "Untitled session",
      cost: s.cost?.totalCost ?? 0,
    }));
  }, [sessions]);

  const chartConfig = useMemo<ChartConfig>(
    () => ({
      cost: {
        label: "Session Cost (USD)",
        color: "hsl(217, 91%, 60%)",
      },
    }),
    []
  );

  const invalidateSessions = () => {
    if (!identity) return;
    queryClient.invalidateQueries({
      queryKey: ["workflow-sessions", projectId, identity.aadObjectId],
    });
    queryClient.invalidateQueries({
      queryKey: ["workflow-sessions-total-cost", identity.aadObjectId],
    });
  };

  const startEditing = (session: SessionListItem) => {
    setEditingId(session.id);
    setEditingTitle(session.title || "");
  };

  const commitRename = async () => {
    if (!identity || !editingId) {
      setEditingId(null);
      return;
    }
    const sessionId = editingId;
    const newTitle = editingTitle.trim();
    if (!newTitle) {
      setEditingId(null);
      return;
    }

    // Optimistically exit edit mode so the icon flips back immediately
    setEditingId(null);

    try {
      const res = await fetch(getApiUrl(`/api/sessions/${sessionId}/rename`), {
        method: "PATCH",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "X-AAD-Object-ID": identity.aadObjectId,
          "X-User-Email": identity.userEmail,
          "X-User-Name": identity.userName,
        },
        // Backend expects `title` field
        body: JSON.stringify({ title: newTitle }),
      });

      if (res.ok) {
        invalidateSessions();
      } else {
        const err = await res.json().catch(() => ({}));
        // eslint-disable-next-line no-alert
        alert((err as { error?: string }).error ?? "Failed to rename session");
      }
    } catch (e) {
      // eslint-disable-next-line no-alert
      alert("Failed to rename session");
    }
  };

  const handleDelete = async (session: SessionListItem) => {
    if (!identity) return;
    const confirmed = window.confirm(
      `Delete session "${session.title || "Untitled session"}"? This will remove it from the list.`
    );
    if (!confirmed) return;

    const res = await fetch(getApiUrl(`/api/sessions/${session.id}`), {
      method: "DELETE",
      credentials: "include",
      headers: {
        "X-AAD-Object-ID": identity.aadObjectId,
        "X-User-Email": identity.userEmail,
        "X-User-Name": identity.userName,
      },
    });

    if (res.ok) {
      invalidateSessions();
    } else {
      const err = await res.json().catch(() => ({}));
      // eslint-disable-next-line no-alert
      alert((err as { error?: string }).error ?? "Failed to delete session");
    }
  };

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          side="right"
          className="w-full sm:max-w-md flex flex-col"
        >
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              My Sessions
            </SheetTitle>
            <SheetDescription>
              Resume a workflow or view session details. Sessions are stored per
              project.
            </SheetDescription>
            {projectId && (
              <div className="mt-2 text-xs text-muted-foreground space-y-1">
                <span className="flex items-center gap-1">
                  <DollarSign className="h-3 w-3" />
                  <span>
                    Total cost for this project:{" "}
                    <span className="font-medium">
                      {projectStats.totalCost.toFixed(4)}
                    </span>{" "}
                    ({projectStats.sessionCount} session
                    {projectStats.sessionCount === 1 ? "" : "s"})
                  </span>
                </span>
                {sessions.length > 0 && (
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] text-muted-foreground">
                      Visualize per-session AI spend.
                    </span>
                    <Button
                      variant="outline"
                      size="xs"
                      onClick={() => setShowAnalysis(true)}
                    >
                      Analyse
                    </Button>
                  </div>
                )}
              </div>
            )}
          </SheetHeader>

          {!projectId ? (
            <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
              Select a project to see sessions.
            </div>
          ) : !identity ? (
            <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
              Sign in to view sessions.
            </div>
          ) : (
            <ScrollArea className="flex-1 -mx-6 px-6 mt-4">
              {isLoading && (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
              )}
              {error && (
                <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
                  {(error as Error).message}
                </div>
              )}
              {!isLoading && !error && sessions.length === 0 && (
                <div className="py-8 text-center text-sm text-muted-foreground">
                  No sessions yet. Start a workflow to create one.
                </div>
              )}
              {!isLoading && !error && sessions.length > 0 && (
                <ul className="space-y-3 pr-3">
                  {sessions.map((s) => (
                    <li
                      key={s.id}
                      className="rounded-lg border bg-card p-4 hover:bg-muted/30 transition-colors"
                    >
                      <div className="flex items-start justify-between gap-2 min-w-0">
                        <div className="min-w-0 flex-1 overflow-hidden">
                          {editingId === s.id ? (
                            <input
                              autoFocus
                              className="w-full bg-transparent border-b border-primary text-sm font-medium outline-none"
                              value={editingTitle}
                              onChange={(e) => setEditingTitle(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                  e.preventDefault();
                                  void commitRename();
                                } else if (e.key === "Escape") {
                                  setEditingId(null);
                                }
                              }}
                            />
                          ) : (
                          <p className="font-medium" title={s.title}>
                              {s.title || "Untitled session"}
                            </p>
                          )}
                          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                            <Badge
                              variant={
                                s.status === "COMPLETED" ? "secondary" : "default"
                              }
                              className="gap-1"
                            >
                              {s.status === "COMPLETED" ? (
                                <>
                                  <CheckCircle2 className="h-3 w-3" />
                                  Completed
                                </>
                              ) : s.status === "PAUSED" ? (
                                <>
                                  <Circle className="h-3 w-3" />
                                  Paused
                                </>
                              ) : s.status === "INACTIVE" ? (
                                <>
                                  <Circle className="h-3 w-3" />
                                  Inactive
                                </>
                              ) : (
                                <>
                                  <Circle className="h-3 w-3" />
                                  In progress
                                </>
                              )}
                            </Badge>
                            {s.cost != null && s.cost.totalCost > 0 && (
                              <span className="flex items-center gap-1">
                                <DollarSign className="h-3 w-3" />
                                {s.cost.totalCost.toFixed(4)}
                              </span>
                            )}
                            <span
                              className="flex items-center gap-1"
                              title={s.lastAccessedAt ?? undefined}
                            >
                              <Clock className="h-3 w-3" />
                              {formatRelativeTime(s.lastAccessedAt)}
                            </span>
                          </div>
                          {s.currentScreen && (
                            <p
                              className="mt-1 text-xs text-muted-foreground truncate"
                              title={s.currentScreen}
                            >
                              Screen: {s.currentScreen}
                            </p>
                          )}
                        </div>
                        <div className="flex flex-shrink-0 flex-col items-end gap-2">
                          <Button
                            size="sm"
                            onClick={() => {
                              onResume(s.id);
                              onOpenChange(false);
                            }}
                            className="shrink-0 gap-1 min-w-0"
                            data-testid={
                              s.status === "IN_PROGRESS" || s.status === "COMPLETED"
                                ? `button-continue-session-${s.id}`
                                : `button-resume-session-${s.id}`
                            }
                          >
                            <PlayCircle className="h-4 w-4" />
                            {s.status === "IN_PROGRESS" || s.status === "COMPLETED" ? "Continue" : "Resume"}
                          </Button>
                          <div className="flex gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() =>
                                editingId === s.id ? void commitRename() : startEditing(s)
                              }
                              title={editingId === s.id ? "Save title" : "Rename session"}
                            >
                              {editingId === s.id ? (
                                <Check className="h-3 w-3" />
                              ) : (
                                <Pencil className="h-3 w-3" />
                              )}
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => handleDelete(s)}
                              title="Delete session"
                            >
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </div>
                        </div>
                      </div>
                      <div className="mt-2 pt-2 border-t flex items-center gap-2 text-xs text-muted-foreground">
                        <Calendar className="h-3 w-3" />
                        Created {formatRelativeTime(s.createdAt)}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </ScrollArea>
          )}
        </SheetContent>
      </Sheet>

      {/* Full-size analysis modal */}
      <Dialog open={showAnalysis} onOpenChange={setShowAnalysis}>
        <DialogContent className="max-w-3xl w-full">
          <DialogHeader>
            <DialogTitle>AI Cost Analysis</DialogTitle>
            <DialogDescription>
              Approximate AI spend per workflow session. Toggle between column and line chart.
            </DialogDescription>
          </DialogHeader>
          {analysisData.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No sessions with cost data yet. Run a generation to populate this chart.
            </p>
          ) : (
            <>
              <div className="flex items-center gap-2 mt-2">
                <span className="text-sm text-muted-foreground">Chart:</span>
                <div className="flex rounded-md border border-input bg-muted/50 p-0.5">
                  <Button
                    variant={costChartType === "column" ? "secondary" : "ghost"}
                    size="sm"
                    className="h-8 px-3 rounded"
                    onClick={() => setCostChartType("column")}
                  >
                    Column
                  </Button>
                  <Button
                    variant={costChartType === "line" ? "secondary" : "ghost"}
                    size="sm"
                    className="h-8 px-3 rounded"
                    onClick={() => setCostChartType("line")}
                  >
                    Line
                  </Button>
                </div>
              </div>
              <div className="mt-4 h-72">
                <ChartContainer config={chartConfig} className="h-full w-full">
                  {costChartType === "column" ? (
                    <BarChart data={analysisData} margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} />
                      <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                      <YAxis
                        tick={{ fontSize: 11 }}
                        tickFormatter={(v) => Number(v).toFixed(3)}
                      />
                      <ChartTooltip
                        content={
                          <ChartTooltipContent
                            labelKey="label"
                            formatter={(value, _name, _item, _index, payload) => {
                              const p: any = payload || {};
                              return (
                                <div className="flex flex-col gap-0.5">
                                  <span className="font-medium">
                                    {p.title || "Session"}
                                  </span>
                                  <span className="text-muted-foreground">
                                    Cost: ${Number(value).toFixed(4)}
                                  </span>
                                </div>
                              );
                            }}
                          />
                        }
                      />
                      <Bar
                        dataKey="cost"
                        fill="var(--color-cost)"
                        radius={[4, 4, 0, 0]}
                      />
                    </BarChart>
                  ) : (
                    <LineChart data={analysisData}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                      <YAxis
                        tick={{ fontSize: 11 }}
                        tickFormatter={(v) => Number(v).toFixed(3)}
                      />
                      <ChartTooltip
                        content={
                          <ChartTooltipContent
                            labelKey="label"
                            formatter={(value, _name, _item, _index, payload) => {
                              const p: any = payload || {};
                              return (
                                <div className="flex flex-col gap-0.5">
                                  <span className="font-medium">
                                    {p.title || "Session"}
                                  </span>
                                  <span className="text-muted-foreground">
                                    Cost: ${Number(value).toFixed(4)}
                                  </span>
                                </div>
                              );
                            }}
                          />
                        }
                      />
                      <Line
                        type="monotone"
                        dataKey="cost"
                        stroke="var(--color-cost)"
                        strokeWidth={2}
                        dot={{ r: 3 }}
                        activeDot={{ r: 5 }}
                      />
                    </LineChart>
                  )}
                </ChartContainer>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

