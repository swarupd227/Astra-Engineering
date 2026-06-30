import { useState } from 'react';
import { motion } from 'framer-motion';
import { Loader2, FileText, ChevronRight, ChevronDown, Edit3, Check, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { AgentPanel } from '../AgentPanel';
import { cn } from '@/lib/utils';
import type { AgentState } from '../AgentPanel';

interface TestCase {
  id: string;
  testId: string;
  name: string;
  category: string;
  priority: string;
  objective?: string;
  testSteps?: { step_number: number; action: string; expected_behavior: string }[];
  expectedResult?: string;
  testData?: Record<string, any>;
}

interface Step4TestCasesProps {
  agentStates: Partial<AgentState>;
  agentActivity: Record<string, string>;
  agentProgress: Record<string, number>;
  testCases: TestCase[];
  isGenerating: boolean;
  runId: string | null;
  onContinue: () => void;
}

const PRIORITY_COLORS: Record<string, string> = {
  P0: 'bg-red-100 text-red-700 border-red-200',
  P1: 'bg-orange-100 text-orange-700 border-orange-200',
  P2: 'bg-yellow-100 text-yellow-700 border-yellow-200',
  P3: 'bg-blue-100 text-blue-700 border-blue-200',
};

const CATEGORY_COLORS: Record<string, string> = {
  functional: 'bg-emerald-100 text-emerald-700',
  negative: 'bg-red-100 text-red-700',
  edge_case: 'bg-purple-100 text-purple-700',
  workflow: 'bg-blue-100 text-blue-700',
  text_validation: 'bg-gray-100 text-gray-700',
};

function TestCaseRow({ tc, onUpdate }: { tc: TestCase; onUpdate: (id: string, updates: Partial<TestCase>) => void }) {
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(tc.name);

  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <div
        className="flex items-center gap-2 p-3 cursor-pointer hover:bg-muted/30 transition-colors"
        onClick={() => setExpanded(e => !e)}
      >
        {expanded ? <ChevronDown className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" /> : <ChevronRight className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />}
        <span className="text-[10px] font-mono text-muted-foreground">{tc.testId}</span>

        {editing ? (
          <div className="flex-1 flex items-center gap-1" onClick={e => e.stopPropagation()}>
            <input
              value={editName}
              onChange={e => setEditName(e.target.value)}
              className="flex-1 text-xs border border-border rounded px-2 py-0.5 bg-background"
              autoFocus
            />
            <button onClick={() => { onUpdate(tc.id, { name: editName }); setEditing(false); }}>
              <Check className="w-3.5 h-3.5 text-emerald-500" />
            </button>
            <button onClick={() => { setEditName(tc.name); setEditing(false); }}>
              <X className="w-3.5 h-3.5 text-red-500" />
            </button>
          </div>
        ) : (
          <>
            <span className="flex-1 text-xs font-medium truncate">{tc.name}</span>
            <button
              onClick={e => { e.stopPropagation(); setEditing(true); }}
              className="opacity-0 group-hover:opacity-100 p-0.5 hover:bg-muted rounded"
            >
              <Edit3 className="w-3 h-3 text-muted-foreground" />
            </button>
          </>
        )}

        <Badge className={cn('text-[10px] h-4 px-1.5 border', PRIORITY_COLORS[tc.priority] || PRIORITY_COLORS.P2)}>
          {tc.priority}
        </Badge>
        <span className={cn('text-[10px] px-1.5 py-0.5 rounded-full font-medium', CATEGORY_COLORS[tc.category] || CATEGORY_COLORS.functional)}>
          {tc.category}
        </span>
      </div>

      {expanded && (
        <motion.div
          initial={{ height: 0 }}
          animate={{ height: 'auto' }}
          className="border-t border-border bg-muted/10 p-3 space-y-3"
        >
          {tc.objective && (
            <div>
              <p className="text-[10px] font-semibold text-muted-foreground uppercase mb-1">Objective</p>
              <p className="text-xs">{tc.objective}</p>
            </div>
          )}
          {tc.testSteps && tc.testSteps.length > 0 && (
            <div>
              <p className="text-[10px] font-semibold text-muted-foreground uppercase mb-1">Test Steps</p>
              <div className="space-y-1">
                {tc.testSteps.slice(0, 6).map(step => (
                  <div key={step.step_number} className="flex gap-2 text-xs">
                    <span className="w-4 h-4 rounded-full bg-primary/10 text-primary flex items-center justify-center text-[10px] font-bold flex-shrink-0 mt-0.5">{step.step_number}</span>
                    <div>
                      <p>{step.action}</p>
                      <p className="text-muted-foreground text-[10px]">Expected: {step.expected_behavior}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </motion.div>
      )}
    </div>
  );
}

export function Step4TestCases({
  agentStates, agentActivity, agentProgress,
  testCases, isGenerating, onContinue
}: Step4TestCasesProps) {
  const [localCases, setLocalCases] = useState(testCases);

  // Update when new cases arrive
  if (testCases.length !== localCases.length) {
    setLocalCases(testCases);
  }

  const handleUpdate = (id: string, updates: Partial<TestCase>) => {
    setLocalCases(prev => prev.map(tc => tc.id === id ? { ...tc, ...updates } : tc));
  };

  const categories = [...new Set(localCases.map(tc => tc.category))];

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="grid grid-cols-1 lg:grid-cols-[240px_1fr] gap-4"
    >
      {/* Left */}
      <div className="flex flex-col gap-3">
        <AgentPanel
          agentStates={agentStates}
          agentActivity={agentActivity}
          agentProgress={agentProgress}
          visibleAgents={['test_strategist', 'test_writer']}
        />

        {/* Category summary */}
        {localCases.length > 0 && (
          <div className="rounded-xl border border-border bg-muted/20 p-3 space-y-2">
            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              {localCases.length} Test Cases
            </h4>
            {categories.map(cat => {
              const count = localCases.filter(tc => tc.category === cat).length;
              return (
                <div key={cat} className="flex justify-between text-xs">
                  <span className="text-muted-foreground capitalize">{cat.replace('_', ' ')}</span>
                  <span className="font-semibold">{count}</span>
                </div>
              );
            })}
          </div>
        )}

        {!isGenerating && localCases.length > 0 && (
          <Button size="sm" onClick={onContinue}
            className="bg-gradient-to-r from-primary to-violet-600 hover:from-primary/90 hover:to-violet-500"
          >
            Generate Scripts
            <ChevronRight className="w-3.5 h-3.5 ml-1.5" />
          </Button>
        )}
      </div>

      {/* Right: Test case list */}
      <div>
        {isGenerating && localCases.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 gap-3 border border-border rounded-xl bg-muted/10">
            <Loader2 className="w-8 h-8 text-primary animate-spin" />
            <p className="text-sm text-muted-foreground">AI agents are generating test cases...</p>
          </div>
        ) : (
          <ScrollArea className="h-[500px]">
            <div className="space-y-2 pr-2">
              {localCases.map(tc => (
                <motion.div
                  key={tc.id}
                  initial={{ opacity: 0, x: 8 }}
                  animate={{ opacity: 1, x: 0 }}
                >
                  <div className="group">
                    <TestCaseRow tc={tc} onUpdate={handleUpdate} />
                  </div>
                </motion.div>
              ))}
              {isGenerating && localCases.length > 0 && (
                <div className="flex items-center gap-2 py-2 text-xs text-muted-foreground">
                  <Loader2 className="w-3 h-3 animate-spin" />
                  Generating more test cases...
                </div>
              )}
            </div>
          </ScrollArea>
        )}
      </div>
    </motion.div>
  );
}
