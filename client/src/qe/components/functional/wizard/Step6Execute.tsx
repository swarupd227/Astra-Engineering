import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Play, CheckCircle, XCircle, Clock, Loader2, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { LiveBrowserView } from '../LiveBrowserView';
import { AgentPanel } from '../AgentPanel';
import { cn } from '@/lib/utils';
import type { AgentState } from '../AgentPanel';

interface TestResult {
  testId: string;
  name: string;
  status: 'pending' | 'running' | 'passed' | 'failed' | 'skipped';
  duration?: number;
  error?: string;
}

interface Step6ExecuteProps {
  agentStates: Partial<AgentState>;
  agentActivity: Record<string, string>;
  testResults: TestResult[];
  screenshot?: string;
  currentUrl?: string;
  isRunning: boolean;
  isComplete: boolean;
  runId: string | null;
  onStartExecution: () => void;
  onContinue: () => void;
}

export function Step6Execute({
  agentStates, agentActivity,
  testResults, screenshot, currentUrl,
  isRunning, isComplete, onStartExecution, onContinue
}: Step6ExecuteProps) {
  const passed = testResults.filter(r => r.status === 'passed').length;
  const failed = testResults.filter(r => r.status === 'failed').length;
  const total = testResults.length;
  const passRate = total > 0 ? Math.round((passed / total) * 100) : 0;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="grid grid-cols-1 lg:grid-cols-[240px_1fr] gap-4"
    >
      {/* Left: Agents */}
      <div className="flex flex-col gap-3">
        <AgentPanel
          agentStates={agentStates}
          agentActivity={agentActivity}
          visibleAgents={['executor_agent', 'qa_analyst']}
        />

        {/* Stats */}
        {total > 0 && (
          <div className="rounded-xl border border-border bg-muted/20 p-3 space-y-2">
            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Results</h4>
            <div className="flex items-center gap-2">
              <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                <motion.div
                  className="h-full bg-emerald-500 rounded-full"
                  animate={{ width: `${passRate}%` }}
                  transition={{ duration: 0.5 }}
                />
              </div>
              <span className="text-xs font-bold text-emerald-600">{passRate}%</span>
            </div>
            <div className="grid grid-cols-2 gap-1">
              <div className="text-center">
                <p className="text-base font-bold text-emerald-600">{passed}</p>
                <p className="text-[10px] text-muted-foreground">Passed</p>
              </div>
              <div className="text-center">
                <p className="text-base font-bold text-red-500">{failed}</p>
                <p className="text-[10px] text-muted-foreground">Failed</p>
              </div>
            </div>
          </div>
        )}

        {!isRunning && !isComplete && (
          <Button onClick={onStartExecution}
            className="bg-gradient-to-r from-emerald-600 to-green-500 hover:from-emerald-500 hover:to-green-400"
          >
            <Play className="w-4 h-4 mr-2" />
            Run All Tests
          </Button>
        )}

        {isComplete && (
          <Button onClick={onContinue}
            className="bg-gradient-to-r from-primary to-violet-600 hover:from-primary/90 hover:to-violet-500"
          >
            View Report
            <ChevronRight className="w-3.5 h-3.5 ml-1.5" />
          </Button>
        )}
      </div>

      {/* Right: Browser + results */}
      <div className="flex flex-col gap-4">
        {/* Virtual browser */}
        <LiveBrowserView
          screenshotBase64={screenshot}
          currentUrl={currentUrl}
          isLoading={isRunning}
          label="Executor Agent"
        />

        {/* Test results list */}
        {testResults.length > 0 && (
          <div className="border border-border rounded-xl overflow-hidden">
            <div className="flex items-center justify-between px-3 py-2 bg-muted/30 border-b border-border">
              <span className="text-xs font-semibold">Test Execution Results</span>
              <div className="flex gap-2">
                <Badge className="text-[10px] h-4 bg-emerald-100 text-emerald-700">{passed} passed</Badge>
                {failed > 0 && <Badge className="text-[10px] h-4 bg-red-100 text-red-700">{failed} failed</Badge>}
              </div>
            </div>
            <ScrollArea className="max-h-48">
              <div className="divide-y divide-border/50">
                {testResults.map(result => (
                  <AnimatePresence key={result.testId}>
                    <motion.div
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className="flex items-center gap-2 px-3 py-2"
                    >
                      {result.status === 'passed' && <CheckCircle className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0" />}
                      {result.status === 'failed' && <XCircle className="w-3.5 h-3.5 text-red-500 flex-shrink-0" />}
                      {result.status === 'running' && <Loader2 className="w-3.5 h-3.5 text-blue-500 animate-spin flex-shrink-0" />}
                      {result.status === 'pending' && <Clock className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />}
                      <span className="flex-1 text-xs truncate">{result.name}</span>
                      {result.duration && <span className="text-[10px] text-muted-foreground font-mono">{result.duration}ms</span>}
                    </motion.div>
                  </AnimatePresence>
                ))}
              </div>
            </ScrollArea>
          </div>
        )}
      </div>
    </motion.div>
  );
}
