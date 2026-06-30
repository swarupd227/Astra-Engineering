import { useEffect, useState } from "react";
import { useRoute, Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import type { TestSessionWithResults, AgentTask, LiveMetric, TestResults } from "@shared/qe-schema";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Play, Pause, RotateCcw } from "lucide-react";
import { AgentTimeline } from "@/components/dashboard/agent-timeline";
import { LiveMetrics } from "@/components/dashboard/live-metrics";
import { VisualComparison } from "@/components/dashboard/visual-comparison";
import { ResultsPanel } from "@/components/dashboard/results-panel";
import { DashboardHeader } from "@/components/dashboard/header";

export default function ReplaySession() {
  const [, params] = useRoute("/replay/:id");
  const sessionId = params?.id;

  const { data: session, isLoading } = useQuery<TestSessionWithResults>({
    queryKey: ['/api/sessions', sessionId],
    enabled: !!sessionId,
  });

  const [currentTaskIndex, setCurrentTaskIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);

  useEffect(() => {
    if (!session || !isPlaying || !session.tasks) return;

    if (currentTaskIndex >= session.tasks.length) {
      setIsPlaying(false);
      return;
    }

    const timer = setTimeout(() => {
      setCurrentTaskIndex(prev => prev + 1);
    }, 1000 / playbackSpeed);

    return () => clearTimeout(timer);
  }, [currentTaskIndex, isPlaying, session, playbackSpeed]);

  if (isLoading || !session) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-muted-foreground">Loading session...</p>
      </div>
    );
  }

  const visibleTasks = session.tasks?.slice(0, currentTaskIndex + 1) || [];
  const showComparison = currentTaskIndex >= 6;
  const hasMetrics = session.metrics && session.metrics.length > 0;
  
  const hasResults = !!session.testResults;
  
  const finalResults: TestResults | null = hasResults && session.testResults ? {
    completionTime: session.testResults.completionTime,
    designCompliance: session.testResults.designCompliance,
    accessibilityWarnings: session.testResults.accessibilityWarnings,
    testCasesGenerated: session.testResults.testCasesGenerated,
    visualDifferences: session.testResults.visualDifferences || [],
  } : null;

  return (
    <div className="flex flex-col h-full">
      <DashboardHeader />
      <header className="border-b p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/history">
              <Button variant="ghost" size="icon" data-testid="button-back-to-history">
                <ArrowLeft className="w-4 h-4" />
              </Button>
            </Link>
            <div>
              <h1 className="text-lg font-bold" data-testid="heading-session-replay">Session Replay</h1>
              <p className="text-sm text-muted-foreground" data-testid="text-session-date">
                {new Date(session.createdAt).toLocaleString()}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setCurrentTaskIndex(0);
                setIsPlaying(false);
              }}
              data-testid="button-replay-restart"
            >
              <RotateCcw className="w-4 h-4 mr-2" />
              Restart
            </Button>

            <select
              value={playbackSpeed}
              onChange={(e) => setPlaybackSpeed(Number(e.target.value))}
              className="px-3 py-1.5 rounded-md border bg-background text-sm"
              data-testid="select-playback-speed"
            >
              <option value={0.5}>0.5x</option>
              <option value={1}>1x</option>
              <option value={2}>2x</option>
              <option value={4}>4x</option>
            </select>

            <Button
              onClick={() => setIsPlaying(!isPlaying)}
              disabled={currentTaskIndex >= (session.tasks?.length || 0)}
              data-testid="button-replay-play-pause"
            >
              {isPlaying ? (
                <>
                  <Pause className="w-4 h-4 mr-2" />
                  Pause
                </>
              ) : (
                <>
                  <Play className="w-4 h-4 mr-2" />
                  Play
                </>
              )}
            </Button>
          </div>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto">
        <div className="px-8 py-8">
          <div className="mb-6 p-4 rounded-md border bg-card">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-xs text-muted-foreground mb-1">Figma URL</p>
                <p className="text-sm text-foreground" data-testid="text-replay-figma-url">{session.figmaUrl}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1">Website URL</p>
                <p className="text-sm text-foreground" data-testid="text-replay-website-url">{session.websiteUrl}</p>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            <div className="lg:col-span-2 space-y-8">
              <AgentTimeline tasks={visibleTasks} />

              {showComparison && <VisualComparison />}

              {currentTaskIndex >= (session.tasks?.length || 0) && session.status === "completed" && finalResults && (
                <ResultsPanel 
                  results={finalResults} 
                  onRunAnother={() => {}}
                />
              )}
            </div>

            <div className="lg:col-span-1">
              {hasMetrics && session.metrics && <LiveMetrics metrics={session.metrics} />}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
