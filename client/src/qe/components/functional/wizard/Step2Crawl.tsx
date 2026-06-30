import { motion } from 'framer-motion';
import { FileText, CheckCircle, Clock, Globe } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { AgentPanel } from '../AgentPanel';
import { LiveBrowserView } from '../LiveBrowserView';
import { cn } from '@/lib/utils';
import type { AgentState } from '../AgentPanel';

export interface CrawledPage {
  url: string;
  title: string;
  status: 'crawling' | 'done' | 'queued';
}

interface Step2CrawlProps {
  agentStates: Partial<AgentState>;
  agentActivity: Record<string, string>;
  agentStats: Record<string, { label: string; value: string | number }[]>;
  agentElapsed: Record<string, number>;
  pages: CrawledPage[];
  screenshot?: string;
  currentUrl?: string;
  isComplete: boolean;
  stats: { pages: number; forms: number; workflows: number };
  loginSuccess?: boolean;
  requiresAuth?: boolean;
  onContinue: () => void;
}

export function Step2Crawl({
  agentStates, agentActivity, agentStats, agentElapsed,
  pages, screenshot, currentUrl, isComplete, stats, loginSuccess, requiresAuth, onContinue
}: Step2CrawlProps) {
  const visibleAgents: (keyof AgentState)[] = requiresAuth
    ? ['auth_agent', 'scout_agent', 'workflow_analyst']
    : ['scout_agent', 'workflow_analyst'];

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-4"
    >
      {/* Left: Agent panel */}
      <div className="flex flex-col gap-3">
        <AgentPanel
          agentStates={agentStates}
          agentActivity={agentActivity}
          agentStats={agentStats}
          agentElapsed={agentElapsed}
          visibleAgents={visibleAgents}
        />

        {/* Stats summary */}
        {(stats.pages > 0 || stats.forms > 0) && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="rounded-xl border border-border bg-muted/20 p-3 space-y-2"
          >
            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Discovery Summary</h4>
            <div className="grid grid-cols-3 gap-2">
              {[
                { label: 'Pages', value: stats.pages },
                { label: 'Forms', value: stats.forms },
                { label: 'Workflows', value: stats.workflows },
              ].map(s => (
                <div key={s.label} className="text-center">
                  <p className="text-lg font-bold text-foreground">{s.value}</p>
                  <p className="text-[10px] text-muted-foreground">{s.label}</p>
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </div>

      {/* Right: Browser view + page list */}
      <div className="flex flex-col gap-4">
        {/* Live browser */}
        <LiveBrowserView
          screenshotBase64={screenshot}
          currentUrl={currentUrl}
          isLoading={!isComplete && !!currentUrl}
          label="Scout Agent"
          className="flex-shrink-0"
        />

        {/* Page tree */}
        {pages.length > 0 && (
          <div className="border border-border rounded-xl overflow-hidden">
            <div className="flex items-center justify-between px-3 py-2 bg-muted/30 border-b border-border">
              <span className="text-xs font-semibold">Discovered Pages</span>
              <Badge variant="secondary" className="text-[10px] h-4">{pages.length}</Badge>
            </div>
            <ScrollArea className="max-h-48">
              <div className="divide-y divide-border/50">
                {pages.map((page, i) => (
                  <motion.div
                    key={page.url}
                    initial={{ opacity: 0, x: -8 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: Math.min(i * 0.03, 0.5) }}
                    className="flex items-center gap-2 px-3 py-2"
                  >
                    {page.status === 'done' ? (
                      <CheckCircle className="w-3 h-3 text-emerald-500 flex-shrink-0" />
                    ) : page.status === 'crawling' ? (
                      <Globe className="w-3 h-3 text-blue-500 flex-shrink-0 animate-pulse" />
                    ) : (
                      <Clock className="w-3 h-3 text-muted-foreground flex-shrink-0" />
                    )}
                    <div className="min-w-0">
                      <p className="text-xs font-medium truncate">{page.title || new URL(page.url).pathname || '/'}</p>
                      <p className="text-[10px] text-muted-foreground truncate font-mono">{page.url}</p>
                    </div>
                  </motion.div>
                ))}
              </div>
            </ScrollArea>
          </div>
        )}

        {/* Continue button */}
        {isComplete && (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
            <Button
              size="lg"
              onClick={onContinue}
              className="w-full bg-gradient-to-r from-primary to-violet-600 hover:from-primary/90 hover:to-violet-500"
            >
              <FileText className="w-4 h-4 mr-2" />
              Generate Workflow Diagram
            </Button>
          </motion.div>
        )}
      </div>
    </motion.div>
  );
}
