import { motion, AnimatePresence } from 'framer-motion';
import { CheckCircle, XCircle, Loader2, Clock, LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

export type AgentStatus = 'idle' | 'thinking' | 'working' | 'completed' | 'error';

export interface AgentCardProps {
  name: string;
  role: string;
  icon: LucideIcon;
  status: AgentStatus;
  activity?: string;
  progress?: number;
  elapsed?: number;
  stats?: { label: string; value: string | number }[];
  className?: string;
}

const statusConfig = {
  idle: { color: 'text-muted-foreground', bg: 'bg-muted/30', border: 'border-border', dot: 'bg-gray-400' },
  thinking: { color: 'text-blue-600', bg: 'bg-blue-50 dark:bg-blue-950/30', border: 'border-blue-200 dark:border-blue-800', dot: 'bg-blue-500' },
  working: { color: 'text-emerald-600', bg: 'bg-emerald-50 dark:bg-emerald-950/30', border: 'border-emerald-200 dark:border-emerald-800', dot: 'bg-emerald-500' },
  completed: { color: 'text-emerald-700', bg: 'bg-emerald-50 dark:bg-emerald-950/30', border: 'border-emerald-300 dark:border-emerald-700', dot: 'bg-emerald-600' },
  error: { color: 'text-red-600', bg: 'bg-red-50 dark:bg-red-950/30', border: 'border-red-200 dark:border-red-800', dot: 'bg-red-500' },
};

function StatusIcon({ status }: { status: AgentStatus }) {
  if (status === 'completed') return <CheckCircle className="w-4 h-4 text-emerald-600" />;
  if (status === 'error') return <XCircle className="w-4 h-4 text-red-500" />;
  if (status === 'working') return <Loader2 className="w-4 h-4 text-emerald-600 animate-spin" />;
  if (status === 'thinking') return (
    <motion.div className="flex gap-0.5 items-center">
      {[0, 1, 2].map(i => (
        <motion.span key={i} className="w-1.5 h-1.5 rounded-full bg-blue-500"
          animate={{ scale: [1, 1.4, 1], opacity: [0.5, 1, 0.5] }}
          transition={{ duration: 0.8, repeat: Infinity, delay: i * 0.15 }}
        />
      ))}
    </motion.div>
  );
  return <span className="w-2 h-2 rounded-full bg-gray-400 inline-block" />;
}

function formatElapsed(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
}

export function AgentCard({ name, role, icon: Icon, status, activity, progress, elapsed, stats, className }: AgentCardProps) {
  const cfg = statusConfig[status];

  return (
    <motion.div
      layout
      className={cn(
        'rounded-xl border p-3 transition-all duration-300',
        cfg.bg, cfg.border,
        status === 'idle' && 'opacity-60',
        className
      )}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: status === 'idle' ? 0.6 : 1, y: 0 }}
    >
      <div className="flex items-start gap-2">
        {/* Icon */}
        <motion.div
          className={cn('rounded-lg p-1.5 flex-shrink-0',
            status === 'working' ? 'bg-emerald-100 dark:bg-emerald-900/50' :
            status === 'thinking' ? 'bg-blue-100 dark:bg-blue-900/50' :
            status === 'completed' ? 'bg-emerald-100 dark:bg-emerald-900/50' :
            status === 'error' ? 'bg-red-100 dark:bg-red-900/50' :
            'bg-muted'
          )}
          animate={status === 'working' ? { rotate: [0, 5, -5, 0] } : {}}
          transition={{ duration: 1.5, repeat: Infinity }}
        >
          <Icon className={cn('w-4 h-4', cfg.color)} />
        </motion.div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <div>
              <p className="text-xs font-semibold text-foreground leading-tight">{name}</p>
              <p className="text-[10px] text-muted-foreground">{role}</p>
            </div>
            <StatusIcon status={status} />
          </div>

          {/* Activity line */}
          <AnimatePresence mode="popLayout">
            {activity && status !== 'idle' && (
              <motion.p
                key={activity}
                initial={{ opacity: 0, x: -4 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0 }}
                className={cn('text-[10px] mt-1 truncate font-mono', cfg.color)}
              >
                {activity}
              </motion.p>
            )}
          </AnimatePresence>

          {/* Progress bar */}
          {progress !== undefined && progress > 0 && status === 'working' && (
            <div className="mt-2 h-1 bg-muted rounded-full overflow-hidden">
              <motion.div
                className="h-full bg-emerald-500 rounded-full"
                initial={{ width: 0 }}
                animate={{ width: `${Math.min(progress, 100)}%` }}
                transition={{ duration: 0.4 }}
              />
            </div>
          )}

          {/* Stats row */}
          {stats && stats.length > 0 && status !== 'idle' && (
            <div className="flex gap-2 mt-1.5 flex-wrap">
              {stats.map(s => (
                <span key={s.label} className="text-[10px] bg-background/60 rounded px-1.5 py-0.5 border border-border/50">
                  <span className="text-muted-foreground">{s.label}: </span>
                  <span className="font-semibold text-foreground">{s.value}</span>
                </span>
              ))}
            </div>
          )}

          {/* Elapsed time */}
          {elapsed !== undefined && status !== 'idle' && (
            <div className="flex items-center gap-1 mt-1">
              <Clock className="w-2.5 h-2.5 text-muted-foreground" />
              <span className="text-[10px] text-muted-foreground font-mono">{formatElapsed(elapsed)}</span>
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}
