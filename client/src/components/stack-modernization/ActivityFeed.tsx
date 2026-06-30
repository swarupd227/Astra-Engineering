/**
 * Live activity feed for Stack Modernization - shows backend agent actions in real time.
 */

import { useEffect, useRef } from "react";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { CheckCircle2, AlertCircle, AlertTriangle, Info } from "lucide-react";

export interface ActivityEntry {
  timestamp: string | Date;
  agent: string;
  action: string;
  details?: string;
  status?: "info" | "success" | "warning" | "error";
}

interface ActivityFeedProps {
  activities: ActivityEntry[];
  className?: string;
  maxHeight?: string;
}

function formatTime(ts: string | Date): string {
  const d = typeof ts === "string" ? new Date(ts) : ts;
  const now = new Date();
  const sec = Math.floor((now.getTime() - d.getTime()) / 1000);
  if (sec < 60) return "just now";
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  return d.toLocaleTimeString();
}

function StatusIcon({ status }: { status?: string }) {
  switch (status) {
    case "success":
      return <CheckCircle2 className="h-3.5 w-3.5 text-green-600 dark:text-green-400 shrink-0" />;
    case "warning":
      return <AlertTriangle className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400 shrink-0" />;
    case "error":
      return <AlertCircle className="h-3.5 w-3.5 text-red-600 dark:text-red-400 shrink-0" />;
    default:
      return <Info className="h-3.5 w-3.5 text-muted-foreground shrink-0" />;
  }
}

export function ActivityFeed({
  activities,
  className = "",
  maxHeight = "200px",
}: ActivityFeedProps) {

  const innerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (innerRef.current && activities.length) {
      innerRef.current.scrollTop = innerRef.current.scrollHeight;
    }
  }, [activities.length]);

  if (!activities || activities.length === 0) {
    return (
      <div className={`rounded-lg border bg-muted/30 p-3 text-sm text-muted-foreground ${className}`}>
        <span className="font-medium text-foreground">Live activity</span>
        <p className="mt-1">Waiting for activity…</p>
      </div>
    );
  }

  return (
    <div className={`rounded-lg border bg-muted/30 ${className}`}>
      <div className="px-3 py-2 border-b bg-muted/50">
        <span className="text-sm font-medium">Live activity</span>
        <span className="ml-2 text-xs text-muted-foreground">({activities.length} entries)</span>
      </div>
      <div ref={innerRef} style={{ maxHeight }} className="overflow-y-auto p-2">
        <TooltipProvider>
          <ul className="space-y-1.5 pr-2">
            {activities.map((entry, i) => (
              <li
                key={i}
                className="flex items-start gap-2 text-xs rounded-md px-2 py-1.5 hover:bg-muted/50"
              >
                <StatusIcon status={entry.status} />
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge variant="secondary" className="text-[10px] font-normal">
                      {entry.agent}
                    </Badge>
                    <span className="text-muted-foreground">{formatTime(entry.timestamp)}</span>
                  </div>
                  <p className="mt-0.5 font-medium text-foreground">{entry.action}</p>
                  {entry.details && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <p className="text-muted-foreground truncate max-w-full cursor-default">
                          {entry.details}
                        </p>
                      </TooltipTrigger>
                      <TooltipContent side="bottom" className="max-w-sm">
                        {entry.details}
                      </TooltipContent>
                    </Tooltip>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </TooltipProvider>
      </div>
    </div>
  );
}
