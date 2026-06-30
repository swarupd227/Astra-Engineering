import React from "react";
import { useQuery } from "@tanstack/react-query";
import { getApiUrl } from "@/lib/api-config";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
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
  Activity, AlertCircle,
  Ticket, Clock, ServerCrash, Thermometer, DatabaseZap
} from "lucide-react";

type IntegrationMetadata = {
  provider: "datadog" | "servicenow";
  source: "live" | "fallback";
  fetchedAt: string;
  notes?: string[];
  fieldSources?: Record<string, "live" | "calculated" | "fallback">;
};

function FieldSourceBadge({
  source,
  light = false,
}: {
  source?: "live" | "calculated" | "fallback";
  light?: boolean;
}) {
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

  const label =
    source === "live" ? "Live" : source === "calculated" ? "Calculated" : "Fallback";

  return (
    <div className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${className}`}>
      <DatabaseZap className="h-3 w-3" />
      {label}
    </div>
  );
}

function formatOpenDuration(startedAt: string) {
  const start = new Date(startedAt);
  if (Number.isNaN(start.getTime())) {
    return "Open duration unavailable";
  }

  const diffMs = Date.now() - start.getTime();
  if (diffMs < 0) {
    return "Open just now";
  }

  const totalHours = Math.floor(diffMs / (1000 * 60 * 60));
  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;

  if (days > 0) {
    return `Open for ${days}d ${hours}h`;
  }

  return `Open for ${hours}h`;
}

function getSystemHealthTooltip(systemState: string, notes?: string[]) {
  if (notes && notes.length > 0) {
    return notes[0];
  }

  if (systemState === "GREEN") {
    return "All monitored Datadog checks are healthy right now.";
  }

  if (systemState === "YELLOW") {
    return "At least one Datadog monitor is in warning state, so attention may be needed.";
  }

  return "At least one Datadog monitor is in alert state and needs action.";
}

// ─── Monitoring Dashboard ───────────────────────────────────────────────────

export function MonitoringDashboard({ projectId }: { projectId?: string }) {
  const [eventsDialogOpen, setEventsDialogOpen] = React.useState(false);

  const { data, isLoading, error } = useQuery({
    queryKey: ["/api/monitoring/system-health", projectId ?? "__none__"],
    queryFn: async () => {
      const url = getApiUrl("/api/monitoring/system-health");
      const headers: Record<string, string> = {};
      if (projectId) headers["x-project-id"] = projectId;
      const res = await fetch(url, { credentials: "include", headers });
      if (!res.ok) throw new Error("Failed to load monitoring data");
      return res.json();
    },
    enabled: !!projectId,
    refetchInterval: 60000,
  });

  if (isLoading) {
    return (
      <Card className="h-full min-h-[260px] rounded-2xl shadow-sm border border-border/40 border-l-[3px] border-l-blue-500 bg-card text-foreground">
        <CardHeader className="pb-2">
          <Skeleton className="h-5 w-40" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-full w-full rounded-xl min-h-[200px]" />
        </CardContent>
      </Card>
    );
  }

  if (!projectId) {
    return (
      <Card className="h-full min-h-[260px] rounded-2xl shadow-sm border border-border/40 border-l-[3px] border-l-blue-500 bg-card text-foreground">
        <CardContent className="flex flex-col items-center justify-center p-6 text-center text-muted-foreground min-h-[200px]">
          <AlertCircle className="h-8 w-8 mb-2 opacity-50" />
          <p>Select a project to view Datadog metrics.</p>
        </CardContent>
      </Card>
    );
  }

  if (error || !data) {
    return (
      <Card className="h-full min-h-[260px] rounded-2xl shadow-sm border border-border/40 border-l-[3px] border-l-blue-500 bg-card text-foreground">
        <CardContent className="flex flex-col items-center justify-center p-6 text-center text-muted-foreground min-h-[200px]">
          <AlertCircle className="h-8 w-8 mb-2 opacity-50" />
          <p>Monitoring integration not configured for this project.</p>
        </CardContent>
      </Card>
    );
  }

  const { systemState, uptimePercentage, criticalEvents, metadata } = data;
  const systemStateSource = metadata?.fieldSources?.systemState;
  const uptimeSource = metadata?.fieldSources?.uptimePercentage;
  const recentEventsSource = metadata?.fieldSources?.criticalEvents;
  const hasCriticalEvents = Array.isArray(criticalEvents) && criticalEvents.length > 0;
  const systemHealthTooltip = getSystemHealthTooltip(systemState, metadata?.notes);
  
  const stateColor = 
    systemState === "GREEN" ? "text-emerald-500 bg-emerald-500/10 border-emerald-500/20" : 
    systemState === "YELLOW" ? "text-amber-500 bg-amber-500/10 border-amber-500/20" : 
    "text-rose-500 bg-rose-500/10 border-rose-500/20";

  return (
    <>
    <Card className="card-animate relative h-full min-h-[260px] overflow-hidden rounded-2xl border border-border/40 border-l-[3px] bg-card text-foreground shadow-sm group">
      <div className={`absolute inset-y-0 left-0 w-[3px] ${systemState === 'GREEN' ? 'bg-emerald-500' : systemState === 'YELLOW' ? 'bg-amber-500' : 'bg-rose-500'}`} />
      <CardHeader className="pb-1.5 flex flex-row items-center justify-between">
        <div>
          <CardTitle className="text-lg font-semibold flex items-center gap-2">
            <Activity className="h-5 w-5 text-blue-500" /> System Health
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
              <TooltipContent className="max-w-sm whitespace-normal break-words text-left leading-relaxed" sideOffset={8}>
                <p>{systemHealthTooltip}</p>
              </TooltipContent>
            </Tooltip>
          </div>
        </TooltipProvider>
      </CardHeader>
      <CardContent className="flex h-full min-h-0 flex-col space-y-2.5">
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
            <TooltipContent className="max-w-sm whitespace-normal break-words text-left leading-relaxed" sideOffset={8}>
              <p>This uptime is derived from the selected Datadog SLO for this project.</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="mb-2 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <h4 className="text-xs tracking-wider uppercase text-muted-foreground font-semibold">Recent Events</h4>
              <FieldSourceBadge source={recentEventsSource} />
            </div>
            {hasCriticalEvents && (
              <button
                type="button"
                onClick={() => setEventsDialogOpen(true)}
                className="text-[11px] font-medium text-muted-foreground underline underline-offset-4 hover:text-foreground"
              >
                View all
              </button>
            )}
          </div>
          <div className={hasCriticalEvents ? "min-h-[72px] max-h-[120px] flex-1 space-y-1.5 overflow-y-auto pr-2 pb-2 [scrollbar-gutter:stable] [scrollbar-width:auto]" : "min-h-[72px] max-h-[120px] flex-1 overflow-y-auto pr-2 pb-2 [scrollbar-gutter:stable] [scrollbar-width:auto] flex items-center justify-center"}>
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
          <DialogDescription>
            Latest events returned by the connected Datadog account for this project.
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-[60vh] space-y-2 overflow-y-auto pr-2">
          {criticalEvents && criticalEvents.length > 0 ? (
            criticalEvents.map((evt: any) => (
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
            ))
          ) : (
            <p className="text-sm text-muted-foreground">No critical events reported.</p>
          )}
        </div>
      </DialogContent>
    </Dialog>
    </>
  );
}

// ─── Operations Dashboard ───────────────────────────────────────────────────

export function OperationsDashboard({ projectId }: { projectId?: string }) {
  const [outagesDialogOpen, setOutagesDialogOpen] = React.useState(false);

  const { data, isLoading, error } = useQuery({
    queryKey: ["/api/operations/ticket-metrics", projectId ?? "__none__"],
    queryFn: async () => {
      const url = getApiUrl("/api/operations/ticket-metrics");
      const headers: Record<string, string> = {};
      if (projectId) headers["x-project-id"] = projectId;
      const res = await fetch(url, { credentials: "include", headers });
      if (!res.ok) throw new Error("Failed to load operations data");
      return res.json();
    },
    enabled: !!projectId,
    refetchInterval: 120000,
  });

  if (isLoading) {
    return (
      <Card className="h-full min-h-[260px] rounded-2xl shadow-sm border border-border/40 border-l-[3px] border-l-violet-500 bg-card text-foreground">
        <CardHeader className="pb-2">
           <Skeleton className="h-5 w-40" />
        </CardHeader>
        <CardContent>
           <Skeleton className="h-full w-full rounded-xl min-h-[200px]" />
        </CardContent>
      </Card>
    );
  }

  if (!projectId) {
    return (
      <Card className="h-full min-h-[260px] rounded-2xl shadow-sm border border-border/40 border-l-[3px] border-l-violet-500 bg-card text-foreground">
        <CardContent className="flex flex-col items-center justify-center p-6 text-center text-muted-foreground min-h-[200px]">
          <Ticket className="h-8 w-8 mb-2 opacity-50" />
          <p>Select a project to view ServiceNow metrics.</p>
        </CardContent>
      </Card>
    );
  }

  if (error || !data) {
    return (
      <Card className="h-full min-h-[260px] rounded-2xl shadow-sm border border-border/40 border-l-[3px] border-l-violet-500 bg-card text-foreground">
        <CardContent className="flex flex-col items-center justify-center p-6 text-center text-muted-foreground min-h-[200px]">
           <Ticket className="h-8 w-8 mb-2 opacity-50" />
           <p>Operations integration not configured for this project.</p>
        </CardContent>
      </Card>
    );
  }

  const { ticketsRaisedToday, ticketsNewOrOpen, ticketsInProgress, ticketsResolvedToday, mttrDays, activeOutages, metadata } = data;
  const mttrSource = metadata?.fieldSources?.mttrDays;
  const outagesSource = metadata?.fieldSources?.activeOutages;
  const visibleOutages = activeOutages;

  return (
    <>
    <Card className="card-animate relative h-full min-h-[300px] min-w-0 overflow-hidden rounded-2xl border border-border/40 border-l-[3px] border-l-violet-500 bg-card text-foreground shadow-sm">
      <CardHeader className="relative min-w-0 pb-1">
        <CardTitle className="text-lg font-semibold flex items-center gap-2">
          <Ticket className="h-5 w-5 text-violet-500" /> Operations Metrics
        </CardTitle>
        <p className="text-xs text-muted-foreground mt-1">Powered by ServiceNow</p>
      </CardHeader>
      <CardContent className="relative flex min-h-0 flex-1 min-w-0 flex-col space-y-2 overflow-hidden">
        {metadata?.notes && metadata.notes.length > 0 && (
        <div className="min-w-0 rounded-xl border border-border/60 bg-muted/30 px-3 py-2 text-xs text-foreground break-words">
            {metadata.notes[0]}
          </div>
        )}
        {/* Ticket Counters */}
        <TooltipProvider delayDuration={150}>
          <div className="grid grid-cols-4 gap-1.5">
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="min-w-0 cursor-help p-1.5 rounded-xl bg-muted/30 border border-border/60 flex flex-col items-center text-center">
                  <span className="text-sm font-bold leading-tight">{ticketsRaisedToday}</span>
                  <span className="text-[8px] uppercase tracking-wider text-muted-foreground mt-0.5">Raised</span>
                </div>
              </TooltipTrigger>
              <TooltipContent className="max-w-sm whitespace-normal break-words text-left leading-relaxed" sideOffset={8}><p>Incidents created today.</p></TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="min-w-0 cursor-help p-1.5 rounded-xl bg-muted/30 border border-border/60 flex flex-col items-center text-center">
                   <span className="text-sm font-bold leading-tight">{ticketsNewOrOpen}</span>
                   <span className="text-[8px] uppercase tracking-wider text-muted-foreground mt-0.5">Open</span>
                </div>
              </TooltipTrigger>
              <TooltipContent className="max-w-sm whitespace-normal break-words text-left leading-relaxed" sideOffset={8}><p>Incidents that are currently new or open.</p></TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="min-w-0 cursor-help p-1.5 rounded-xl bg-muted/30 border border-border/60 flex flex-col items-center text-center">
                   <span className="text-sm font-bold leading-tight">{ticketsInProgress}</span>
                   <span className="text-[8px] uppercase tracking-wider text-muted-foreground mt-0.5">Working</span>
                </div>
              </TooltipTrigger>
              <TooltipContent className="max-w-sm whitespace-normal break-words text-left leading-relaxed" sideOffset={8}><p>Incidents actively being worked by the team.</p></TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="min-w-0 cursor-help p-1.5 rounded-xl bg-muted/30 border border-border/60 flex flex-col items-center text-center">
                   <span className="text-sm font-bold leading-tight">{ticketsResolvedToday}</span>
                   <span className="text-[8px] uppercase tracking-wider text-muted-foreground mt-0.5">Resolved</span>
                </div>
              </TooltipTrigger>
              <TooltipContent className="max-w-sm whitespace-normal break-words text-left leading-relaxed" sideOffset={8}><p>Incidents resolved today.</p></TooltipContent>
            </Tooltip>
          </div>
        </TooltipProvider>

        {/* Velocity Stats */}
        <TooltipProvider delayDuration={150}>
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="flex cursor-help flex-wrap items-start justify-between gap-1.5 p-2 rounded-xl bg-muted/30 border border-border/60">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <Clock className="h-4 w-4 text-violet-500" />
                  <span className="min-w-0 text-xs font-medium">MTTR (Mean Time to Resolve)</span>
                  <FieldSourceBadge source={mttrSource} light />
                </div>
                <span className="shrink-0 text-xs font-bold">{mttrDays} days</span>
              </div>
            </TooltipTrigger>
            <TooltipContent className="max-w-sm whitespace-normal break-words text-left leading-relaxed" sideOffset={8}>
              <p>Average time taken to resolve recent incidents for this project.</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>

        {/* Active Outages Grid */}
        <div className="flex min-h-0 flex-1 flex-col">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <h4 className="text-xs tracking-wider uppercase text-muted-foreground font-semibold">Active High-Priority</h4>
                <FieldSourceBadge source={outagesSource} light />
              </div>
              {activeOutages.length > 0 && (
                <button
                  type="button"
                  onClick={() => setOutagesDialogOpen(true)}
                 className="shrink-0 text-[11px] font-medium text-muted-foreground underline underline-offset-4 hover:text-foreground"
                >
                  View all
                </button>
              )}
            </div>
            <div className="h-[184px] space-y-1 overflow-y-auto overscroll-contain pr-2 pb-4 [scrollbar-gutter:stable] [scrollbar-width:auto]">
              {visibleOutages.length > 0 ? (
                visibleOutages.map((outage: any) => (
                  <div key={outage.id} className="rounded border border-border/60 bg-muted/20 p-1.5 text-[11px] transition-colors hover:bg-muted/40">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-rose-300 w-16">{outage.id}</span>
                      <span className="truncate flex-1">{outage.title}</span>
                    </div>
                    <div className="mt-0.5 flex items-center justify-between gap-2 text-[9px] text-muted-foreground">
                      <span className="truncate">Assignee: {outage.assignedTo || "Unassigned"}</span>
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
          <DialogDescription>
            Current P1 incidents returned by the connected ServiceNow instance for this project.
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-[60vh] space-y-2 overflow-y-auto pr-2">
          {activeOutages && activeOutages.length > 0 ? (
            activeOutages.map((outage: any) => (
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
            ))
          ) : (
            <p className="text-sm text-muted-foreground">No active high-priority incidents reported.</p>
          )}
        </div>
      </DialogContent>
    </Dialog>
    </>
  );
}
