import { useState } from "react";
import { DashboardHeader } from "@/components/dashboard/header";
import { TestConfiguration } from "@/components/dashboard/test-configuration";
import { AgentTimeline } from "@/components/dashboard/agent-timeline";
import { LiveMetrics } from "@/components/dashboard/live-metrics";
import { VisualComparison } from "@/components/dashboard/visual-comparison";
import { ResultsPanel } from "@/components/dashboard/results-panel";
import { useProject } from "@/contexts/ProjectContext";
import type { AgentTask, LiveMetric, TestResults } from "@shared/qe-schema";

export default function VisualRegressionPage() {
  const { selectedProjectId } = useProject();
  const [isConfiguring, setIsConfiguring] = useState(true);
  const [isRunning, setIsRunning] = useState(false);
  const [tasks, setTasks] = useState<AgentTask[]>([]);
  const [metrics, setMetrics] = useState<LiveMetric[]>([]);
  const [results, setResults] = useState<TestResults | null>(null);
  const [showComparison, setShowComparison] = useState(false);

  const handleStartDemo = async (config: { figmaUrl: string; websiteUrl: string; testScope: string; browserTarget: string }) => {
    setIsConfiguring(false);
    setIsRunning(true);
    setTasks([]);
    setMetrics([]);
    setResults(null);
    setShowComparison(false);

    try {
      const sessionResponse = await fetch('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...config,
          ...(selectedProjectId && { projectId: selectedProjectId }),
        }),
      });

      if (!sessionResponse.ok) {
        const error = await sessionResponse.json();
        console.error('Failed to create session:', error);
        setIsRunning(false);
        setIsConfiguring(true);
        return;
      }

      const session = await sessionResponse.json();
      const sessionId = session.id;

      const eventSource = new EventSource(`/api/demo/start?sessionId=${sessionId}`);

      eventSource.onmessage = (event) => {
        const update = JSON.parse(event.data);

        if (update.type === "task") {
          const taskData: AgentTask = {
            id: update.task.taskId,
            taskName: update.task.taskName,
            agentName: update.task.agentName,
            status: update.task.status,
            progress: update.task.progress,
            details: update.task.details,
            timestamp: update.task.timestamp,
          };

          setTasks(prev => {
            const existing = prev.find(t => t.id === taskData.id);
            if (existing) {
              return prev.map(t => t.id === taskData.id ? taskData : t);
            }
            return [...prev, taskData];
          });

          if (update.metrics) {
            setMetrics(update.metrics);
          }

          if (update.task.taskName === "Fetching Live Website & Comparing Layouts" && update.task.status === "in-progress") {
            setShowComparison(true);
          }
        }

        if (update.type === "complete") {
          setResults(update.results);
          setIsRunning(false);
          eventSource.close();
        }
      };

      eventSource.onerror = () => {
        eventSource.close();
        setIsRunning(false);
      };
    } catch (error) {
      console.error('Error starting demo:', error);
      setIsRunning(false);
      setIsConfiguring(true);
    }
  };

  const handleRunAnother = () => {
    setIsConfiguring(true);
    setIsRunning(false);
    setTasks([]);
    setMetrics([]);
    setResults(null);
    setShowComparison(false);
  };

  return (
    <>
      <DashboardHeader />
      
      <main className="flex-1 overflow-y-auto">
          {isConfiguring && (
            <TestConfiguration onStartDemo={handleStartDemo} />
          )}

          {!isConfiguring && (
            <div className="px-8 py-8" style={{ maxWidth: "1600px", margin: "0 auto" }}>
              <div className="flex gap-8">
                <div className="flex-[2] space-y-8">
                  <AgentTimeline tasks={tasks} />

                  {showComparison && (
                    <VisualComparison />
                  )}

                  {results && (
                    <ResultsPanel results={results} onRunAnother={handleRunAnother} />
                  )}
                </div>

                <div className="flex-1 min-w-0">
                  {metrics.length > 0 && <LiveMetrics metrics={metrics} />}
                </div>
              </div>
            </div>
          )}
      </main>
    </>
  );
}
