import { useParams, Link, useSearch } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { getApiUrl } from "@/lib/api-config";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Activity, Ticket, ArrowLeft, AlertCircle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import React from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Activity as ActivityIcon,
  AlertCircle as AlertCircleIcon,
  ServerCrash,
  Thermometer,
  DatabaseZap,
  Clock,
} from "lucide-react";

// ─────────────────────────────────────────────
// Shared helper components
// ─────────────────────────────────────────────
type FieldSource = "live" | "calculated" | "fallback";

function FieldSourceBadge({ source, light = false }: { source?: FieldSource; light?: boolean }) {
  if (!source) return null;
  const className = light
    ? source === "live"
      ? "border border-emerald-200/30 bg-emerald-100/15 text-emerald-50"
      : source === "calculated"
        ? "border border-sky-200/30 bg-sky-100/15 text-sky-50"
        : "border border-amber-200/30 bg-amber-100/15 text-amber-50"
    : source === "live"
      ? "border border-emerald-500/20 bg-emerald-500/10 text-emerald-600"
      : source === "calculated"
        ? "border border-sky-500/20 bg-sky-500/10 text-sky-600"
        : "border border-amber-500/20 bg-amber-500/10 text-amber-600";
  const label = source === "live" ? "Live" : source === "calculated" ? "Calculated" : "Fallback";
  return (
    <div className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${className}`}>
      <DatabaseZap className="h-3 w-3" />
      {label}
    </div>
  );
}

function formatOpenDuration(startedAt: string) {
  const start = new Date(startedAt);
  if (Number.isNaN(start.getTime())) return "Open duration unavailable";
  const diffMs = Date.now() - start.getTime();
  if (diffMs < 0) return "Open just now";
  const totalHours = Math.floor(diffMs / (1000 * 60 * 60));
  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;
  return days > 0 ? `Open for ${days}d ${hours}h` : `Open for ${hours}h`;
}

// ─────────────────────────────────────────────
// Monitoring (Datadog) panel
// ─────────────────────────────────────────────
export function MonitoringPanel({ projectId }: { projectId: string }) {
  const [eventsDialogOpen, setEventsDialogOpen] = React.useState(false);
  const { data, isLoading, error } = useQuery({
    queryKey: ["/api/monitoring/system-health", projectId],
    queryFn: async () => {
      const url = getApiUrl("/api/monitoring/system-health");
      const res = await fetch(url, {
        credentials: "include",
        headers: { "x-project-id": projectId },
      });
      if (!res.ok) throw new Error("Failed to load monitoring data");
      return res.json();
    },
    refetchInterval: 60000,
  });

  if (isLoading) {
    return (
      <Card className="h-full min-h-[300px] rounded-2xl shadow-sm border border-border/40 border-l-[3px] border-l-blue-500 bg-card text-foreground">
        <CardHeader className="pb-2"><Skeleton className="h-5 w-40" /></CardHeader>
        <CardContent><Skeleton className="h-full w-full rounded-xl min-h-[230px]" /></CardContent>
      </Card>
    );
  }

  if (error || !data) {
    return (
      <Card className="h-full min-h-[300px] rounded-2xl shadow-sm border border-border/40 border-l-[3px] border-l-blue-500 bg-card text-foreground">
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <ActivityIcon className="h-5 w-5 text-blue-500" /> System Health
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col items-center justify-center py-10 text-center text-muted-foreground">
          <AlertCircleIcon className="h-8 w-8 mb-2 opacity-50" />
          <p className="text-sm">Monitoring integration not configured for this project.</p>
          <p className="text-xs mt-1 text-muted-foreground/60">Configure Datadog in Settings → Third-Party Integrations.</p>
        </CardContent>
      </Card>
    );
  }

  const { systemState, uptimePercentage, criticalEvents, metadata } = data;
  const systemStateSource = metadata?.fieldSources?.systemState;
  const uptimeSource = metadata?.fieldSources?.uptimePercentage;
  const recentEventsSource = metadata?.fieldSources?.criticalEvents;
  const hasCriticalEvents = Array.isArray(criticalEvents) && criticalEvents.length > 0;
  const stateColor =
    systemState === "GREEN" ? "text-emerald-500 bg-emerald-500/10 border-emerald-500/20" :
    systemState === "YELLOW" ? "text-amber-500 bg-amber-500/10 border-amber-500/20" :
    "text-rose-500 bg-rose-500/10 border-rose-500/20";

  return (
    <>
      <Card className="relative h-full min-h-[300px] overflow-hidden rounded-2xl border border-border/40 border-l-[3px] bg-card text-foreground shadow-sm">
        <div className={`absolute inset-y-0 left-0 w-[3px] ${systemState === 'GREEN' ? 'bg-emerald-500' : systemState === 'YELLOW' ? 'bg-amber-500' : 'bg-rose-500'}`} />
        <CardHeader className="pb-1.5 flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <ActivityIcon className="h-5 w-5 text-blue-500" /> System Health
            </CardTitle>
            <p className="text-xs text-muted-foreground mt-1">Powered by Datadog</p>
          </div>
          <TooltipProvider delayDuration={150}>
            <div className="flex items-center gap-2">
              <FieldSourceBadge source={systemStateSource} />
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className={`cursor-help px-3 py-1 rounded-full border flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider ${stateColor}`}>
                    <div className={`w-2 h-2 rounded-full ${systemState === 'GREEN' ? 'bg-emerald-500' : systemState === 'YELLOW' ? 'bg-amber-500' : 'bg-rose-500'} animate-pulse`} />
                    {systemState}
                  </div>
                </TooltipTrigger>
                <TooltipContent className="max-w-sm whitespace-normal text-left leading-relaxed" sideOffset={8}>
                  <p>{metadata?.notes?.[0] || `System is ${systemState.toLowerCase()}.`}</p>
                </TooltipContent>
              </Tooltip>
            </div>
          </TooltipProvider>
        </CardHeader>
        <CardContent className="flex flex-col space-y-2.5">
          {metadata?.notes && metadata.notes.length > 0 && (
            <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
              {metadata.notes[0]}
            </div>
          )}
          <TooltipProvider delayDuration={150}>
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="flex cursor-help items-center justify-between p-2 rounded-xl border border-border/60 bg-muted/30">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium">Service Uptime</span>
                    <FieldSourceBadge source={uptimeSource} />
                  </div>
                  <span className="text-sm font-bold">{uptimePercentage}%</span>
                </div>
              </TooltipTrigger>
              <TooltipContent sideOffset={8}><p>Uptime derived from the Datadog SLO for this project.</p></TooltipContent>
            </Tooltip>
          </TooltipProvider>
          <div className="flex flex-col">
            <div className="mb-2 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <h4 className="text-xs tracking-wider uppercase text-muted-foreground font-semibold">Recent Events</h4>
                <FieldSourceBadge source={recentEventsSource} />
              </div>
              {hasCriticalEvents && (
                <button type="button" onClick={() => setEventsDialogOpen(true)} className="text-[11px] font-medium text-muted-foreground underline underline-offset-4 hover:text-foreground">
                  View all
                </button>
              )}
            </div>
            <div className={hasCriticalEvents ? "max-h-[180px] space-y-1.5 overflow-y-auto pr-2 pb-2" : "max-h-[180px] flex items-center justify-center"}>
              {hasCriticalEvents ? (
                criticalEvents.map((evt: any) => (
                  <div key={evt.id} className="flex gap-2 text-xs items-start p-1.5 rounded-lg bg-muted/20 hover:bg-muted/40 transition-colors">
                    {evt.severity === 'CRITICAL' || evt.severity === 'ERROR' ?
                      <ServerCrash className="h-4 w-4 text-rose-500 mt-0.5 shrink-0" /> :
                      <Thermometer className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
                    }
                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate">{evt.message}</p>
                      <p className="text-[10px] text-muted-foreground">{new Date(evt.timestamp).toLocaleString()}</p>
                    </div>
                  </div>
                ))
              ) : (
                <p className="text-xs text-muted-foreground text-center">No critical events reported.</p>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
      <Dialog open={eventsDialogOpen} onOpenChange={setEventsDialogOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Datadog Recent Events</DialogTitle>
            <DialogDescription>Latest events returned by the connected Datadog account for this project.</DialogDescription>
          </DialogHeader>
          <div className="max-h-[60vh] space-y-2 overflow-y-auto pr-2">
            {criticalEvents?.map((evt: any) => (
              <div key={evt.id} className="flex gap-3 rounded-lg border border-border/60 p-3">
                {evt.severity === 'CRITICAL' || evt.severity === 'ERROR' ?
                  <ServerCrash className="h-4 w-4 text-rose-500 mt-0.5 shrink-0" /> :
                  <Thermometer className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
                }
                <div className="min-w-0 flex-1">
                  <p className="font-medium break-words">{evt.message}</p>
                  <p className="text-xs text-muted-foreground mt-1">{new Date(evt.timestamp).toLocaleString()}</p>
                </div>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ─────────────────────────────────────────────
// Operations (ServiceNow) panel
// ─────────────────────────────────────────────
export function OperationsPanel({ projectId }: { projectId: string }) {
  const [outagesDialogOpen, setOutagesDialogOpen] = React.useState(false);
  const { data, isLoading, error } = useQuery({
    queryKey: ["/api/operations/ticket-metrics", projectId],
    queryFn: async () => {
      const url = getApiUrl("/api/operations/ticket-metrics");
      const res = await fetch(url, {
        credentials: "include",
        headers: { "x-project-id": projectId },
      });
      if (!res.ok) throw new Error("Failed to load operations data");
      return res.json();
    },
    refetchInterval: 120000,
  });

  if (isLoading) {
    return (
      <Card className="h-full min-h-[300px] rounded-2xl shadow-sm border border-border/40 border-l-[3px] border-l-violet-500 bg-card text-foreground">
        <CardHeader className="pb-2"><Skeleton className="h-5 w-40" /></CardHeader>
        <CardContent><Skeleton className="h-full w-full rounded-xl min-h-[230px]" /></CardContent>
      </Card>
    );
  }

  if (error || !data) {
    return (
      <Card className="h-full min-h-[300px] rounded-2xl shadow-sm border border-border/40 border-l-[3px] border-l-violet-500 bg-card text-foreground">
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <Ticket className="h-5 w-5 text-violet-500" /> Operations Metrics
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col items-center justify-center py-10 text-center text-muted-foreground">
          <Ticket className="h-8 w-8 mb-2 opacity-50" />
          <p className="text-sm">Operations integration not configured for this project.</p>
          <p className="text-xs mt-1 text-muted-foreground/60">Configure ServiceNow in Settings → Third-Party Integrations.</p>
        </CardContent>
      </Card>
    );
  }

  const { ticketsRaisedToday, ticketsNewOrOpen, ticketsInProgress, ticketsResolvedToday, mttrDays, activeOutages, metadata } = data;
  const mttrSource = metadata?.fieldSources?.mttrDays;
  const outagesSource = metadata?.fieldSources?.activeOutages;

  return (
    <>
      <Card className="relative h-full min-h-[300px] overflow-hidden rounded-2xl border border-border/40 border-l-[3px] border-l-violet-500 bg-card text-foreground shadow-sm">
        <CardHeader className="pb-1.5">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <Ticket className="h-5 w-5 text-violet-500" /> Operations Metrics
          </CardTitle>
          <p className="text-xs text-muted-foreground">Powered by ServiceNow</p>
        </CardHeader>
        <CardContent className="flex flex-col space-y-2">
          {metadata?.notes && metadata.notes.length > 0 && (
            <div className="rounded-xl border border-border/60 bg-muted/30 px-3 py-2 text-xs">{metadata.notes[0]}</div>
          )}
          <TooltipProvider delayDuration={150}>
            <div className="grid grid-cols-4 gap-1.5">
              {[
                { value: ticketsRaisedToday, label: "Raised", tooltip: "Incidents created today." },
                { value: ticketsNewOrOpen, label: "Open", tooltip: "Currently new or open incidents." },
                { value: ticketsInProgress, label: "Working", tooltip: "Actively being worked by the team." },
                { value: ticketsResolvedToday, label: "Resolved", tooltip: "Resolved today." },
              ].map(({ value, label, tooltip }) => (
                <Tooltip key={label}>
                  <TooltipTrigger asChild>
                    <div className="cursor-help p-1.5 rounded-xl bg-muted/30 border border-border/60 flex flex-col items-center text-center">
                      <span className="text-sm font-bold leading-tight">{value}</span>
                      <span className="text-[8px] uppercase tracking-wider text-muted-foreground mt-0.5">{label}</span>
                    </div>
                  </TooltipTrigger>
                  <TooltipContent sideOffset={8}><p>{tooltip}</p></TooltipContent>
                </Tooltip>
              ))}
            </div>
          </TooltipProvider>
          <TooltipProvider delayDuration={150}>
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="flex cursor-help items-center justify-between gap-1.5 p-2 rounded-xl bg-muted/30 border border-border/60">
                  <div className="flex items-center gap-2">
                    <Clock className="h-4 w-4 text-violet-500" />
                    <span className="text-xs font-medium">MTTR</span>
                    <FieldSourceBadge source={mttrSource} light />
                  </div>
                  <span className="text-xs font-bold">{mttrDays} days</span>
                </div>
              </TooltipTrigger>
              <TooltipContent sideOffset={8}><p>Average time to resolve recent incidents for this project.</p></TooltipContent>
            </Tooltip>
          </TooltipProvider>
          <div className="flex flex-col">
            <div className="mb-2 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <h4 className="text-xs tracking-wider uppercase text-muted-foreground font-semibold">Active High-Priority</h4>
                <FieldSourceBadge source={outagesSource} light />
              </div>
              {activeOutages?.length > 0 && (
                <button type="button" onClick={() => setOutagesDialogOpen(true)} className="text-[11px] font-medium text-muted-foreground underline underline-offset-4 hover:text-foreground">
                  View all
                </button>
              )}
            </div>
            <div className="max-h-[200px] space-y-1 overflow-y-auto pr-2 pb-2">
              {activeOutages?.length > 0 ? (
                activeOutages.map((outage: any) => (
                  <div key={outage.id} className="rounded border border-border/60 bg-muted/20 p-1.5 text-[11px] hover:bg-muted/40 transition-colors">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-rose-300 w-16">{outage.id}</span>
                      <span className="truncate flex-1">{outage.title}</span>
                    </div>
                    <div className="mt-0.5 flex items-center justify-between gap-2 text-[9px] text-muted-foreground">
                      <span>Assignee: {outage.assignedTo || "Unassigned"}</span>
                      <span>{formatOpenDuration(outage.startedAt)}</span>
                    </div>
                  </div>
                ))
              ) : (
                <p className="text-xs text-muted-foreground">No active high-priority incidents reported.</p>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
      <Dialog open={outagesDialogOpen} onOpenChange={setOutagesDialogOpen}>
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Active High-Priority Incidents</DialogTitle>
            <DialogDescription>Current P1 incidents from the ServiceNow instance connected to this project.</DialogDescription>
          </DialogHeader>
          <div className="max-h-[60vh] space-y-2 overflow-y-auto pr-2">
            {activeOutages?.map((outage: any) => (
              <div key={outage.id} className="rounded-lg border border-border/60 p-3">
                <div className="flex items-start gap-3">
                  <span className="font-semibold text-rose-500 w-24 shrink-0">{outage.id}</span>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium break-words">{outage.title}</p>
                    <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                      <span>Assignee: {outage.assignedTo || "Unassigned"}</span>
                      <span>{formatOpenDuration(outage.startedAt)}</span>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ─────────────────────────────────────────────
// Main page
// ─────────────────────────────────────────────
export default function ProjectIntegrationsPage() {
  const params = useParams<{ projectId: string }>();
  const search = useSearch();
  const projectId = params.projectId;

  // Extract project name from URL query params (passed from SDLC page)
  const queryParams = new URLSearchParams(search);
  const queryProjectName = queryParams.get("projectName");

  // Fallback: Fetch project name if not provided in URL
  const { data: projectData } = useQuery<{ id: string; name: string } | null>({
    queryKey: ["/api/sdlc/projects", projectId],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/sdlc/projects/${projectId}`);
      return res.json();
    },
    enabled: !!projectId && !queryProjectName,
  });

  if (!projectId) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-muted-foreground">Invalid project.</p>
      </div>
    );
  }

  const projectName = queryProjectName || projectData?.name || "Project";

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/sdlc">
            <ArrowLeft className="h-4 w-4 mr-1" />
            Back to SDLC
          </Link>
        </Button>
      </div>

      <PageHeader
        icon={Activity}
        title={`${projectName} — Metrics`}
        subtitle="Live Datadog and ServiceNow metrics scoped to this project"
        color="blue"
      />

      <div className="grid gap-6 md:grid-cols-2">
        <MonitoringPanel projectId={projectId} />
        <OperationsPanel projectId={projectId} />
      </div>
    </div>
  );
}
