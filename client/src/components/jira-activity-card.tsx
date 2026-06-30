import { useQuery } from "@tanstack/react-query";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Activity, Loader2 } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";

interface JiraActivityLog {
  id: string;
  userId: string;
  sdlcProjectId: string | null;
  jiraProjectKey: string | null;
  action: string;
  issueKey: string | null;
  status: string;
  errorMessage: string | null;
  createdAt: string;
}

interface Props {
  projectId: string;
}

export function JiraActivityCard({ projectId }: Props) {
  const { data, isLoading } = useQuery<{ logs: JiraActivityLog[] }>({
    queryKey: [`/api/projects/${projectId}/jira-activity?limit=20`],
    enabled: !!projectId,
  });

  const logs = data?.logs ?? [];

  return (
    <Card className="rounded-2xl shadow-sm border border-border/40 border-l-[3px] border-l-violet-500">
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-violet-500" />
          <CardTitle className="text-sm font-semibold">Jira Activity</CardTitle>
        </div>
        <CardDescription className="text-xs">Recent Jira actions for this project</CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex items-center justify-center py-6">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        ) : logs.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">No activity yet</p>
        ) : (
          <ScrollArea className="h-48">
            <div className="space-y-2">
              {logs.map((log) => (
                <div key={log.id} className="flex items-center justify-between gap-2 text-xs py-1.5 border-b border-border/20 last:border-0">
                  <div className="flex items-center gap-2 min-w-0">
                    <Badge
                      variant="outline"
                      className={`shrink-0 text-[10px] h-4 px-1.5 ${
                        log.status === "success"
                          ? "bg-emerald-500/10 text-emerald-600 border-emerald-500/20"
                          : "bg-red-500/10 text-red-600 border-red-500/20"
                      }`}
                    >
                      {log.status}
                    </Badge>
                    <span className="truncate text-muted-foreground">{log.action}</span>
                    {log.issueKey && (
                      <span className="font-mono text-foreground shrink-0">{log.issueKey}</span>
                    )}
                  </div>
                  <span className="text-muted-foreground shrink-0">
                    {new Date(log.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </span>
                </div>
              ))}
            </div>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}
