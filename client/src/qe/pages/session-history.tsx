import { useQuery } from "@tanstack/react-query";
import type { TestSession } from "@shared/qe-schema";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Link } from "wouter";
import { Clock, ExternalLink, CheckCircle2, Loader2 } from "lucide-react";
import { DashboardHeader } from "@/components/dashboard/header";

export default function SessionHistory() {
  const { data: sessions, isLoading } = useQuery<TestSession[]>({
    queryKey: ['/api/sessions'],
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <Loader2 className="w-8 h-8 animate-spin mx-auto mb-4 text-primary" />
          <p className="text-muted-foreground">Loading session history...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
    <DashboardHeader />
    <div className="flex-1 overflow-auto">
    <div className="px-8 py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-foreground mb-2" data-testid="heading-session-history">Session History</h1>
        <p className="text-muted-foreground" data-testid="text-session-history-description">View and replay past test sessions</p>
      </div>

      {sessions && sessions.length === 0 ? (
        <Card className="p-12 text-center" data-testid="card-empty-state">
          <p className="text-muted-foreground mb-4" data-testid="text-empty-message">No test sessions found</p>
          <Link href="/">
            <Button data-testid="button-run-first-test">Run Your First Test</Button>
          </Link>
        </Card>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
          {sessions?.map((session) => (
            <Card key={session.id} className="p-6 hover-elevate transition-all" data-testid={`session-card-${session.id}`}>
              <div className="flex items-start justify-between mb-4">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-2">
                    {session.status === "completed" ? (
                      <CheckCircle2 className="w-4 h-4 text-chart-3" />
                    ) : (
                      <Loader2 className="w-4 h-4 text-primary animate-spin" />
                    )}
                    <Badge variant={session.status === "completed" ? "default" : "outline"} data-testid={`session-status-${session.id}`}>
                      {session.status}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Clock className="w-3 h-3" />
                    <span data-testid={`text-session-date-${session.id}`}>{new Date(session.createdAt).toLocaleString()}</span>
                  </div>
                </div>
              </div>

              <div className="space-y-2 mb-4">
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Figma URL</p>
                  <p className="text-sm text-foreground truncate" title={session.figmaUrl} data-testid={`text-figma-url-${session.id}`}>{session.figmaUrl}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Website URL</p>
                  <p className="text-sm text-foreground truncate" title={session.websiteUrl} data-testid={`text-website-url-${session.id}`}>{session.websiteUrl}</p>
                </div>
              </div>

              <div className="flex items-center gap-2 text-xs text-muted-foreground mb-4">
                <Badge variant="outline" className="text-xs" data-testid={`badge-test-scope-${session.id}`}>
                  {session.testScope}
                </Badge>
                <Badge variant="outline" className="text-xs" data-testid={`badge-browser-${session.id}`}>
                  {session.browserTarget}
                </Badge>
              </div>

              {session.tasks && session.tasks.length > 0 && (
                <p className="text-xs text-muted-foreground mb-4" data-testid={`text-task-count-${session.id}`}>
                  {session.tasks.length} tasks completed
                </p>
              )}

              <Link href={`/replay/${session.id}`}>
                <Button variant="outline" className="w-full gap-2" data-testid={`button-replay-${session.id}`}>
                  <ExternalLink className="w-4 h-4" />
                  Replay Session
                </Button>
              </Link>
            </Card>
          ))}
        </div>
      )}
    </div>
    </div>
    </div>
  );
}
