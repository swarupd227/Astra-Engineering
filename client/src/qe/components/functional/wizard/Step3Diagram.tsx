import { useState } from 'react';
import { motion } from 'framer-motion';
import { Loader2, GitBranch, RefreshCw, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { MermaidDiagram } from '../MermaidDiagram';
import { AgentPanel } from '../AgentPanel';
import type { AgentState } from '../AgentPanel';

interface Step3DiagramProps {
  agentStates: Partial<AgentState>;
  agentActivity: Record<string, string>;
  mermaidChart: string | null;
  isGenerating: boolean;
  workflowCount: number;
  pageCount: number;
  onRegenerate: () => void;
  onContinue: () => void;
}

export function Step3Diagram({
  agentStates, agentActivity,
  mermaidChart, isGenerating, workflowCount, pageCount,
  onRegenerate, onContinue
}: Step3DiagramProps) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="grid grid-cols-1 lg:grid-cols-[240px_1fr] gap-4"
    >
      {/* Left: Diagram Architect agent */}
      <div className="flex flex-col gap-3">
        <AgentPanel
          agentStates={agentStates}
          agentActivity={agentActivity}
          visibleAgents={['diagram_architect']}
        />

        {/* Stats */}
        {mermaidChart && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="rounded-xl border border-border bg-muted/20 p-3 space-y-2"
          >
            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Diagram Stats</h4>
            <div className="space-y-1">
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">Pages mapped</span>
                <span className="font-semibold">{pageCount}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">Workflows</span>
                <span className="font-semibold">{workflowCount}</span>
              </div>
            </div>
          </motion.div>
        )}

        <div className="flex flex-col gap-2">
          <Button variant="outline" size="sm" onClick={onRegenerate} disabled={isGenerating}>
            <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${isGenerating ? 'animate-spin' : ''}`} />
            Regenerate
          </Button>
          {mermaidChart && (
            <Button size="sm" onClick={onContinue}
              className="bg-gradient-to-r from-primary to-violet-600 hover:from-primary/90 hover:to-violet-500"
            >
              Generate Test Cases
              <ChevronRight className="w-3.5 h-3.5 ml-1.5" />
            </Button>
          )}
        </div>
      </div>

      {/* Right: Diagram */}
      <div>
        {isGenerating && !mermaidChart ? (
          <div className="flex flex-col items-center justify-center h-64 gap-3 border border-border rounded-xl bg-muted/10">
            <motion.div
              animate={{ rotate: 360 }}
              transition={{ duration: 2, repeat: Infinity, ease: 'linear' }}
            >
              <GitBranch className="w-8 h-8 text-primary" />
            </motion.div>
            <p className="text-sm text-muted-foreground">Diagram Architect is mapping your workflows...</p>
          </div>
        ) : mermaidChart ? (
          <MermaidDiagram chart={mermaidChart} />
        ) : (
          <div className="flex items-center justify-center h-48 border border-border rounded-xl bg-muted/10">
            <p className="text-sm text-muted-foreground">No diagram yet</p>
          </div>
        )}
      </div>
    </motion.div>
  );
}
