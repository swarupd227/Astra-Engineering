import { motion, AnimatePresence } from 'framer-motion';
import { Globe, RefreshCw, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

interface LiveBrowserViewProps {
  screenshotBase64?: string;
  currentUrl?: string;
  isLoading?: boolean;
  isError?: boolean;
  label?: string;
  className?: string;
}

export function LiveBrowserView({ screenshotBase64, currentUrl, isLoading, isError, label = 'Live Browser', className }: LiveBrowserViewProps) {
  return (
    <div className={cn('flex flex-col rounded-xl border border-border overflow-hidden bg-background shadow-md', className)}>
      {/* Browser chrome - top bar */}
      <div className="flex items-center gap-2 bg-muted/80 border-b border-border px-3 py-2 flex-shrink-0">
        {/* Traffic lights */}
        <div className="flex gap-1.5">
          <span className="w-3 h-3 rounded-full bg-red-400/80" />
          <span className="w-3 h-3 rounded-full bg-yellow-400/80" />
          <span className="w-3 h-3 rounded-full bg-green-400/80" />
        </div>

        {/* URL bar */}
        <div className="flex-1 flex items-center gap-1.5 bg-background/70 rounded-md px-2 py-1 border border-border/50">
          {isLoading ? (
            <RefreshCw className="w-3 h-3 text-muted-foreground animate-spin flex-shrink-0" />
          ) : (
            <Globe className="w-3 h-3 text-muted-foreground flex-shrink-0" />
          )}
          <span className="text-[11px] text-muted-foreground truncate font-mono">
            {currentUrl || 'about:blank'}
          </span>
        </div>

        {/* Label badge */}
        <span className="text-[10px] font-medium text-muted-foreground bg-background/50 px-2 py-0.5 rounded-full border border-border/50 flex-shrink-0">
          {label}
        </span>
      </div>

      {/* Browser content */}
      <div className="relative flex-1 min-h-0 bg-[#0f1117] overflow-hidden" style={{ minHeight: '280px' }}>
        <AnimatePresence mode="crossfade">
          {screenshotBase64 ? (
            <motion.img
              key={screenshotBase64.slice(-20)}
              src={screenshotBase64}
              alt="Live browser screenshot"
              className="w-full h-full object-cover object-top"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.3 }}
              style={{ maxHeight: '400px' }}
            />
          ) : isError ? (
            <motion.div
              key="error"
              className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-red-400"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
            >
              <AlertCircle className="w-8 h-8" />
              <p className="text-sm font-medium">Failed to capture screenshot</p>
            </motion.div>
          ) : isLoading ? (
            /* Loading skeleton — contrasting colours so it's visible on dark background */
            <motion.div
              key="loading"
              className="absolute inset-0 flex flex-col gap-3 p-5"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
            >
              {/* Simulated browser nav bar */}
              <div className="h-7 rounded bg-[#1e2535] animate-pulse w-full" />
              {/* Hero block */}
              <div className="h-24 rounded bg-[#1e2535] animate-pulse w-full" />
              {/* Content rows */}
              <div className="h-4 rounded bg-[#1e2535] animate-pulse w-5/6" />
              <div className="h-4 rounded bg-[#1e2535] animate-pulse w-full" />
              <div className="h-4 rounded bg-[#1e2535] animate-pulse w-4/6" />
              {/* Two-column cards */}
              <div className="grid grid-cols-2 gap-3 mt-1">
                <div className="h-14 rounded bg-[#1e2535] animate-pulse" />
                <div className="h-14 rounded bg-[#1e2535] animate-pulse" />
              </div>
              <div className="h-4 rounded bg-[#1e2535] animate-pulse w-3/4" />
              {/* Status label */}
              <div className="flex items-center gap-2 mt-auto">
                <RefreshCw className="w-3.5 h-3.5 text-cyan-400 animate-spin flex-shrink-0" />
                <span className="text-[11px] text-cyan-400 font-mono">Rendering {currentUrl}…</span>
              </div>
            </motion.div>
          ) : (
            <motion.div
              key="empty"
              className="absolute inset-0 flex flex-col items-center justify-center gap-3"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
            >
              <Globe className="w-10 h-10 text-slate-600" />
              <p className="text-sm text-slate-500">Waiting for browser activity…</p>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Loading overlay */}
        {isLoading && screenshotBase64 && (
          <motion.div
            className="absolute top-2 right-2 bg-background/80 backdrop-blur-sm rounded-full p-1 shadow-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
          >
            <RefreshCw className="w-3 h-3 text-emerald-600 animate-spin" />
          </motion.div>
        )}
      </div>
    </div>
  );
}
