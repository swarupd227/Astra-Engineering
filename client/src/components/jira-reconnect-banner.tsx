import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { AlertTriangle, X } from "lucide-react";

// Tracks which integration credentials need the user's attention. A single
// banner covers both JIRA and GitLab since both are reconnected from the same
// Profile Setup page.
const _needsAttention = new Set<"jira" | "gitlab">();
const _listeners = new Set<() => void>();

function notify() {
  _listeners.forEach((fn) => fn());
}

export function setCredentialReconnectNeeded(provider: "jira" | "gitlab", needed: boolean) {
  const had = _needsAttention.has(provider);
  if (needed && !had) {
    _needsAttention.add(provider);
    notify();
  } else if (!needed && had) {
    _needsAttention.delete(provider);
    notify();
  }
}

// Backwards-compatible helper used by existing Jira call sites.
export function setJiraReconnectNeeded(needed: boolean) {
  setCredentialReconnectNeeded("jira", needed);
}

export function getReconnectNeeded() {
  return _needsAttention.size > 0;
}

function useReconnectState() {
  const [, setTick] = useState(0);
  useEffect(() => {
    const listener = () => setTick((t) => t + 1);
    _listeners.add(listener);
    return () => {
      _listeners.delete(listener);
    };
  }, []);
  return Array.from(_needsAttention);
}

export function JiraReconnectBanner() {
  const providers = useReconnectState();
  const needed = providers.length > 0;
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (needed) setDismissed(false);
  }, [needed]);

  if (!needed || dismissed) return null;

  const label =
    providers.length === 2
      ? "Your JIRA and GitLab connections"
      : providers[0] === "gitlab"
      ? "Your GitLab connection"
      : "Your Jira connection";

  return (
    <div className="bg-amber-500/10 border-b border-amber-500/20 px-4 py-2 flex items-center justify-between gap-4">
      <div className="flex items-center gap-2 text-sm text-amber-700 dark:text-amber-400">
        <AlertTriangle className="h-4 w-4 shrink-0" />
        <span>{label} {providers.length === 2 ? "need" : "needs"} attention. Actions may fail until you reconnect.</span>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs border-amber-500/30 text-amber-700 dark:text-amber-400 hover:bg-amber-500/10"
          onClick={() => {
            window.location.href = "/profile-setup";
          }}
        >
          Reconnect
        </Button>
        <button
          onClick={() => setDismissed(true)}
          className="text-amber-600 dark:text-amber-500 hover:text-amber-800 dark:hover:text-amber-300"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
