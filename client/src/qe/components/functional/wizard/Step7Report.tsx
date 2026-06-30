import { motion } from 'framer-motion';
import { CheckCircle, XCircle, Download, FileText, Code, BarChart2, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { AgentPanel } from '../AgentPanel';
import type { AgentState } from '../AgentPanel';

interface ReportStats {
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  passRate: number;
  duration: number;
  testCasesGenerated: number;
  scriptsGenerated: number;
  pagesDiscovered: number;
  workflowsFound: number;
}

interface Step7ReportProps {
  agentStates: Partial<AgentState>;
  agentActivity: Record<string, string>;
  stats: ReportStats;
  runId: string | null;
  onDownloadReport: () => void;
  onDownloadScripts: () => void;
  onStartNew: () => void;
}

export function Step7Report({ agentStates, agentActivity, stats, runId, onDownloadReport, onDownloadScripts, onStartNew }: Step7ReportProps) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="grid grid-cols-1 lg:grid-cols-[240px_1fr] gap-4"
    >
      {/* Left: QA Analyst */}
      <div className="flex flex-col gap-3">
        <AgentPanel
          agentStates={agentStates}
          agentActivity={agentActivity}
          visibleAgents={['qa_analyst']}
        />
        <div className="flex flex-col gap-2">
          <Button variant="outline" size="sm" onClick={onDownloadReport}>
            <FileText className="w-3.5 h-3.5 mr-1.5" />
            Download Report
          </Button>
          <Button variant="outline" size="sm" onClick={onDownloadScripts}>
            <Code className="w-3.5 h-3.5 mr-1.5" />
            Download Scripts (ZIP)
          </Button>
          <Button size="sm" onClick={onStartNew}
            className="bg-gradient-to-r from-primary to-violet-600 hover:from-primary/90 hover:to-violet-500"
          >
            <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
            Test Another URL
          </Button>
        </div>
      </div>

      {/* Right: Report */}
      <div className="space-y-4">
        {/* Pass rate hero */}
        <motion.div
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className="rounded-2xl border border-border p-6 bg-gradient-to-br from-background to-muted/30 text-center"
        >
          <div className={`text-6xl font-black mb-2 ${stats.passRate >= 80 ? 'text-emerald-600' : stats.passRate >= 50 ? 'text-yellow-600' : 'text-red-600'}`}>
            {stats.passRate}%
          </div>
          <p className="text-lg font-semibold text-foreground">Pass Rate</p>
          <div className="flex justify-center gap-4 mt-3">
            <div className="flex items-center gap-1.5 text-emerald-600">
              <CheckCircle className="w-4 h-4" />
              <span className="text-sm font-medium">{stats.passed} passed</span>
            </div>
            <div className="flex items-center gap-1.5 text-red-500">
              <XCircle className="w-4 h-4" />
              <span className="text-sm font-medium">{stats.failed} failed</span>
            </div>
          </div>
        </motion.div>

        {/* Metrics grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: 'Pages Discovered', value: stats.pagesDiscovered, icon: '🔍' },
            { label: 'Workflows Found', value: stats.workflowsFound, icon: '⚡' },
            { label: 'Test Cases', value: stats.testCasesGenerated, icon: '📝' },
            { label: 'Scripts Generated', value: stats.scriptsGenerated, icon: '💻' },
          ].map(metric => (
            <motion.div
              key={metric.label}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className="rounded-xl border border-border bg-muted/20 p-3 text-center"
            >
              <div className="text-2xl mb-1">{metric.icon}</div>
              <p className="text-xl font-bold text-foreground">{metric.value}</p>
              <p className="text-[10px] text-muted-foreground">{metric.label}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </motion.div>
  );
}
