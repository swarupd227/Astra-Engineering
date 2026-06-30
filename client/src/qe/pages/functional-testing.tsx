import { useState, useRef, useCallback, useEffect } from 'react';
import { useToast } from '@/hooks/use-toast';
import { motion, AnimatePresence } from 'framer-motion';
import Editor from '@monaco-editor/react';
import { useLocation } from 'wouter';
import JSZip from 'jszip';
import { DashboardHeader } from '@/components/dashboard/header';
import { FRAMEWORK_PRESETS, findPreset, isPresetId } from '@/lib/framework-presets';
import {
  Globe, Loader2, CheckCircle2, XCircle, ChevronRight,
  Play, Download, RefreshCw, Terminal, AlertCircle,
  FileCode2, Layers, ClipboardList, Zap, Check, Square,
  ExternalLink, ChevronDown, ChevronUp, ArrowLeft, Clock, RotateCcw,
  Search, GitBranch, Code2, Activity, Cpu, Network, Scan, Bot,
  Eye, EyeOff, Lock, KeyRound, ShieldCheck, UserCircle2,
} from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────

type Step = 'configure' | 'crawl' | 'pages' | 'testcases' | 'scripts';

interface PageSummary {
  url: string;
  title: string;
  forms: number;
  buttons: number;
  inputs: number;
  links: number;
}

interface TestCase {
  id: string;
  title: string;
  description: string;
  pageUrl: string;
  priority: 'P0' | 'P1' | 'P2' | 'P3';
  category: string;
  steps: string[];
  expectedResult: string;
  locatorHints?: Record<string, string>;
}

interface ExecutionResult {
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  tests: Array<{ title: string; status: string; duration: number; error?: string }>;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const STEPS: Array<{ key: Step; label: string; icon: React.ReactNode }> = [
  { key: 'configure', label: 'Configure',    icon: <Globe className="w-4 h-4" /> },
  { key: 'crawl',     label: 'Crawl',        icon: <Layers className="w-4 h-4" /> },
  { key: 'pages',     label: 'Pages',        icon: <FileCode2 className="w-4 h-4" /> },
  { key: 'testcases', label: 'Test Cases',   icon: <ClipboardList className="w-4 h-4" /> },
  { key: 'scripts',   label: 'Scripts & Run', icon: <Zap className="w-4 h-4" /> },
];

const PRIORITY_COLORS: Record<string, string> = {
  P0: 'bg-red-50 text-red-600 border-red-200',
  P1: 'bg-orange-50 text-orange-600 border-orange-200',
  P2: 'bg-yellow-50 text-yellow-600 border-yellow-200',
  P3: 'bg-gray-100 text-gray-600 border-gray-200',
};

const CATEGORY_COLORS: Record<string, string> = {
  smoke:         'bg-indigo-50 text-indigo-600 border border-indigo-200',
  functional:    'bg-blue-50 text-blue-700 border border-blue-200',
  negative:      'bg-rose-50 text-rose-600 border border-rose-200',
  edge:          'bg-orange-50 text-orange-600 border border-orange-200',
  security:      'bg-red-50 text-red-700 border border-red-200',
  accessibility: 'bg-purple-50 text-purple-700 border border-purple-200',
  // legacy
  navigation:    'bg-blue-50 text-blue-600',
  form:          'bg-purple-50 text-purple-600',
  content:       'bg-green-50 text-green-700',
  workflow:      'bg-indigo-50 text-indigo-700',
};

// ─── Helper ───────────────────────────────────────────────────────────────────

function ensureHttp(url: string): string {
  if (!url) return url;
  return url.startsWith('http://') || url.startsWith('https://') ? url : `https://${url}`;
}

function stepIndex(s: Step): number {
  return STEPS.findIndex(x => x.key === s);
}

// ─── AGENTS_DEF (module-level — after helpers so Icon refs work) ──────────────

const AGENTS_DEF = [
  { id: 'Scout',           name: 'Scout',           role: 'Web Crawler',        desc: 'Navigates all pages, discovers URLs and site structure',                           color: '#10b981', bg: '#ecfdf5', border: '#86efac', text: '#065f46', Icon: Globe },
  { id: 'DOM Analyst',     name: 'DOM Analyst',     role: 'Element Extractor',  desc: 'Captures all interactive elements with CSS selectors & XPaths',                   color: '#7c3aed', bg: '#f5f3ff', border: '#c4b5fd', text: '#4c1d95', Icon: Layers },
  { id: 'Workflow Analyst', name: 'Workflow Analyst', role: 'Flow Mapper',      desc: 'Maps user journeys, interaction patterns & navigation flows',                      color: '#2563eb', bg: '#eff6ff', border: '#93c5fd', text: '#1e3a8a', Icon: GitBranch },
  { id: 'Test Architect',  name: 'Test Architect',  role: 'Test Strategist',    desc: 'Designs functional, negative, edge, security & accessibility tests',              color: '#d97706', bg: '#fffbeb', border: '#fcd34d', text: '#78350f', Icon: ClipboardList },
  { id: 'Script Forge',    name: 'Script Forge',    role: 'Automation Engineer', desc: 'Writes complete Playwright automation scripts per test case',                     color: 'hsl(var(--primary))', bg: 'hsl(var(--primary) / 0.08)', border: '#a5b4fc', text: '#1e1b4b', Icon: FileCode2 },
];

// ─── Code preview syntax highlighter ─────────────────────────────────────────

function highlightCode(code: string): string {
  return code
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(
      /\b(class|extends|await|public|void|return|import|export|function|const|let|var|async|from|default)\b/g,
      '<span style="color:#185FA5;font-weight:500">$1</span>'
    )
    .replace(
      /\b(this\.)/g,
      '<span style="color:#854F0B">$1</span>'
    )
    .replace(
      /\b([a-zA-Z][a-zA-Z0-9_]*)(?=\()/g,
      '<span style="color:#3B6D11;font-weight:500">$1</span>'
    )
    .replace(
      /(\/\/[^\n]*)/g,
      '<span style="color:#888780">$1</span>'
    );
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function FunctionalTesting() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [step, setStep]               = useState<Step>('configure');
  const [url, setUrl]                 = useState('');
  const [maxPages, setMaxPages]       = useState(50);
  const [runId, setRunId]             = useState<string | null>(null);
  const [hasAuth, setHasAuth]           = useState(false);
  const [authUsername, setAuthUsername] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authLoginUrl, setAuthLoginUrl] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [authAdvanced, setAuthAdvanced] = useState(false);
  const [authUsernameSelector, setAuthUsernameSelector] = useState('');
  const [authPasswordSelector, setAuthPasswordSelector] = useState('');
  const [authSubmitSelector, setAuthSubmitSelector]     = useState('');
  const [crawlHadAuth, setCrawlHadAuth] = useState(false);

  // Crawl
  const [crawlStatus, setCrawlStatus] = useState<'idle'|'crawling'|'done'|'error'>('idle');
  const [crawlProgress, setCrawlProgress] = useState({
    pagesVisited: 0, pagesQueued: 0, formsFound: 0, buttonsFound: 0, currentUrl: '',
  });
  const [crawlAgentStatuses, setCrawlAgentStatuses] = useState<Record<string, { status: string; message: string; details?: string }>>({});
  const [crawledPages, setCrawledPages]   = useState<PageSummary[]>([]);
  const [crawlError, setCrawlError]       = useState('');

  // Test cases
  const [isGenCases, setIsGenCases]       = useState(false);
  const [testCases, setTestCases]         = useState<TestCase[]>([]);
  const [selectedIds, setSelectedIds]     = useState<Set<string>>(new Set());
  const [expandedCases, setExpandedCases] = useState<Set<string>>(new Set());
  const [casesError, setCasesError]       = useState('');

  // Scripts — new POM multi-file format
  const [isGenScript, setIsGenScript]     = useState(false);
  const [scriptFiles, setScriptFiles]     = useState<Record<string, string>>({});
  const [selectedFile, setSelectedFile]   = useState<string>('');
  const [previewIndex, setPreviewIndex]   = useState(0);
  const [scriptId, setScriptId]           = useState<string | null>(null);
  const [scriptError, setScriptError]     = useState('');
  // Legacy single-script (for old runs / display only)
  const [script, setScript]               = useState('');

  // Test case filter
  const [tcCategory, setTcCategory]       = useState<string>('all');

  // Framework catalog
  interface FrameworkConfigOption {
    id:               string;
    name:             string;
    framework:        string;
    language:         string;
    functionCount:    number;
    detectedPattern:  string | null;
    detectedLanguage: string | null;
    detectedTool:     string | null;
  }
  const [frameworkConfigs, setFrameworkConfigs]     = useState<FrameworkConfigOption[]>([]);
  const [frameworkConfigId, setFrameworkConfigId]   = useState<string>('');
  // URL-seeded framework metadata — shown immediately before API response arrives
  const urlParams = new URLSearchParams(window.location.search);
  const [urlFrameworkMeta] = useState<{ name: string; tool: string; lang: string; pattern: string } | null>(() => {
    const id   = urlParams.get('frameworkConfigId');
    const name = urlParams.get('frameworkName');
    if (!id || !name) return null;
    return {
      name,
      tool:    urlParams.get('frameworkTool')    ?? '',
      lang:    urlParams.get('frameworkLang')    ?? '',
      pattern: urlParams.get('frameworkPattern') ?? 'POM',
    };
  });

  // User stories
  interface UserStoryOption { id: string; title: string; acceptanceCriteria?: string; state?: string }
  const [availableStories, setAvailableStories]     = useState<UserStoryOption[]>([]);
  const [selectedStoryIds, setSelectedStoryIds]     = useState<Set<string>>(new Set());
  const [showStoryPicker, setShowStoryPicker]       = useState(false);

  // Execute
  const [isExecuting, setIsExecuting]     = useState(false);
  const [execLogs, setExecLogs]           = useState<string[]>([]);
  const [execResults, setExecResults]     = useState<ExecutionResult | null>(null);
  const [execError, setExecError]         = useState('');
  const execIdRef                          = useRef<string | null>(null);
  const [isStopping, setIsStopping]       = useState(false);

  // Past runs
  interface PastRun { id: string; url: string; status: string; pageCount: number; createdAt: string }
  const [pastRuns, setPastRuns]           = useState<PastRun[]>([]);
  const [isLoadingRuns, setIsLoadingRuns] = useState(false);
  const [isLoadingRun, setIsLoadingRun]   = useState(false);

  // Activity log + timer
  const [activityLog, setActivityLog] = useState<Array<{agent: string; message: string; ts: number; color: string}>>([]);
  const [crawlStartTime, setCrawlStartTime] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const activityRef = useRef<HTMLDivElement>(null);

  // AWS API Gateway terminates SSE at 29s in production, so we poll the
  // /api/autotest/status/:runId endpoint instead. Refs cancel cleanly on unmount.
  const pollingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSeqRef = useRef<number>(0);
  const pollingActiveRef = useRef<boolean>(false);
  const logsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (logsRef.current) logsRef.current.scrollTop = logsRef.current.scrollHeight;
  }, [execLogs]);

  // Stop polling on unmount so we don't leak setTimeout chains
  useEffect(() => {
    return () => {
      pollingActiveRef.current = false;
      if (pollingTimeoutRef.current) {
        clearTimeout(pollingTimeoutRef.current);
        pollingTimeoutRef.current = null;
      }
    };
  }, []);

  // Load past runs on mount
  useEffect(() => {
    setIsLoadingRuns(true);
    fetch('/api/autotest/runs')
      .then(r => r.json())
      .then(d => setPastRuns(d.runs || []))
      .catch(() => {})
      .finally(() => setIsLoadingRuns(false));

    // Load framework catalog configs; auto-select if frameworkConfigId is in URL.
    // Errors are non-fatal — built-in presets are always available even when
    // the catalog API is unreachable — but we log them so empty dropdowns can
    // be debugged from devtools instead of silently dropping the failure.
    fetch('/api/framework-config')
      .then(async r => {
        if (!r.ok) {
          console.warn(`[functional-testing] /api/framework-config returned ${r.status}; falling back to built-in presets only.`);
          return [];
        }
        return r.json();
      })
      .then((d: any[]) => {
        const configs: FrameworkConfigOption[] = Array.isArray(d)
          ? d.map(fc => ({
              id:               fc.id,
              name:             fc.name,
              framework:        fc.framework,
              language:         fc.language,
              functionCount:    fc.functionCount ?? 0,
              detectedPattern:  fc.detectedPattern  ?? null,
              detectedLanguage: fc.detectedLanguage ?? null,
              detectedTool:     fc.detectedTool     ?? null,
            }))
          : [];
        setFrameworkConfigs(configs);
        // Auto-select framework passed via ?frameworkConfigId=<id> from catalog page
        const incomingId = new URLSearchParams(window.location.search).get('frameworkConfigId');
        if (incomingId) {
          const match = configs.find(c => c.id === incomingId);
          if (match) setFrameworkConfigId(incomingId);
          else if (isPresetId(incomingId)) setFrameworkConfigId(incomingId);
        }
      })
      .catch((err) => {
        console.warn('[functional-testing] failed to load /api/framework-config — built-in presets will still be selectable:', err);
      });

    // Load user stories for generation context
    fetch('/api/autotest/user-stories')
      .then(r => r.ok ? r.json() : { stories: [] })
      .then((d: { stories: UserStoryOption[] }) => setAvailableStories(d.stories ?? []))
      .catch(() => {});
  }, []);

  // Elapsed timer
  useEffect(() => {
    if (crawlStatus !== 'crawling' || !crawlStartTime) {
      if (crawlStatus !== 'crawling') setElapsed(0);
      return;
    }
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - crawlStartTime) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [crawlStatus, crawlStartTime]);

  // Auto-scroll activity log
  useEffect(() => {
    if (activityRef.current) activityRef.current.scrollTop = activityRef.current.scrollHeight;
  }, [activityLog]);

  // ── Load a past run for re-execution ────────────────────────────────────────

  const loadPastRun = useCallback(async (pastRunId: string, pastRunUrl: string) => {
    setIsLoadingRun(true);
    try {
      const r = await fetch(`/api/autotest/runs/${pastRunId}/load`);
      const data = await r.json();
      if (data.error) throw new Error(data.error);

      setUrl(pastRunUrl.replace(/^https?:\/\//, ''));
      setRunId(pastRunId);
      setCrawledPages(data.pages || []);
      setCrawlStatus('done');
      setCrawlError('');

      if (data.testCases?.length) {
        setTestCases(data.testCases.map((tc: any) => ({
          ...tc,
          id: tc.id.replace(`${pastRunId}_`, ''), // strip run prefix
        })));
        setSelectedIds(new Set(data.testCases.map((tc: any) => tc.id.replace(`${pastRunId}_`, ''))));
      }

      if (data.files && Object.keys(data.files).length > 0) {
        setScriptFiles(data.files);
        setPreviewIndex(0);
        const firstSpec = Object.keys(data.files).find(f => f.endsWith('.spec.ts')) || Object.keys(data.files)[0] || '';
        setSelectedFile(firstSpec);
        setScriptId(data.scriptId || null);
        setStep('scripts');
      } else if (data.script) {
        setScript(data.script);
        setScriptId(data.scriptId || null);
        setStep('scripts');
      } else if (data.testCases?.length) {
        setStep('testcases');
      } else {
        setStep('pages');
      }
    } catch (err: any) {
      alert(`Failed to load run: ${err.message}`);
    } finally {
      setIsLoadingRun(false);
    }
  }, []);

  // ── Polling event handler + loop ───────────────────────────────────────────

  const handleAutotestEvent = useCallback((evt: any) => {
    if (evt.type === 'progress') {
      setCrawlProgress({
        pagesVisited: evt.pagesVisited || 0,
        pagesQueued:  evt.pagesQueued  || 0,
        formsFound:   evt.formsFound   || 0,
        buttonsFound: evt.buttonsFound || 0,
        currentUrl:   evt.currentUrl   || '',
      });
    } else if (evt.type === 'agent_status') {
      setCrawlAgentStatuses(prev => ({
        ...prev,
        [evt.agent]: { status: evt.status, message: evt.message || '', details: evt.details || '' },
      }));
      if (evt.message && evt.status !== 'idle') {
        const agentDef = AGENTS_DEF.find(a => a.id === evt.agent);
        // Auth Agent color is cyan when not in AGENTS_DEF
        const color = agentDef?.color || (evt.agent === 'Auth Agent' ? '#0891b2' : 'hsl(var(--muted-foreground))');
        setActivityLog(prev => [
          ...prev.slice(-99),
          { agent: evt.agent, message: evt.message, ts: Date.now(), color }
        ]);
      }
    }
  }, []);

  const pollAutotestStatus = useCallback(async (rid: string) => {
    if (!pollingActiveRef.current) return;
    try {
      const r = await fetch(`/api/autotest/status/${rid}?since=${lastSeqRef.current}`);
      if (!r.ok) {
        if (r.status === 404) {
          setCrawlError('Run not found (server may have restarted)');
          setCrawlStatus('error');
          pollingActiveRef.current = false;
          return;
        }
        throw new Error(`Status ${r.status}`);
      }
      const data = await r.json();

      // Process new events in order
      for (const item of (data.events ?? [])) {
        handleAutotestEvent(item.event);
        lastSeqRef.current = item.seq + 1;
      }

      if (data.status === 'done') {
        setCrawledPages(data.pages || []);
        setCrawlStatus('done');
        pollingActiveRef.current = false;
        return;
      }
      if (data.status === 'error') {
        setCrawlError(data.error || 'Crawl failed');
        setCrawlStatus('error');
        pollingActiveRef.current = false;
        return;
      }

      // Still crawling — schedule next poll
      pollingTimeoutRef.current = setTimeout(() => pollAutotestStatus(rid), 2000);
    } catch {
      // Transient error — back off and retry
      if (pollingActiveRef.current) {
        pollingTimeoutRef.current = setTimeout(() => pollAutotestStatus(rid), 4000);
      }
    }
  }, [handleAutotestEvent]);

  // ── Start Crawl ─────────────────────────────────────────────────────────────

  const startCrawl = useCallback(async () => {
    const targetUrl = ensureHttp(url.trim());
    if (!targetUrl) return;

    setCrawlStatus('crawling');
    setCrawledPages([]);
    setCrawlProgress({ pagesVisited: 0, pagesQueued: 0, formsFound: 0, buttonsFound: 0, currentUrl: '' });
    setCrawlAgentStatuses({});
    setCrawlError('');
    setTestCases([]);
    setSelectedIds(new Set());
    setScript('');
    setScriptFiles({});
    setPreviewIndex(0);
    setSelectedFile('');
    setScriptId(null);
    setExecLogs([]);
    setExecResults(null);
    setActivityLog([]);
    setCrawlStartTime(Date.now());
    setElapsed(0);
    setCrawlHadAuth(hasAuth && !!authUsername && !!authPassword);

    try {
      const r = await fetch('/api/autotest/crawl', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: targetUrl,
          maxPages,
          ...(hasAuth && authUsername && authPassword ? {
            credentials: {
              username: authUsername,
              password: authPassword,
              loginUrl: authLoginUrl.trim() ? (authLoginUrl.startsWith('http') ? authLoginUrl.trim() : `https://${authLoginUrl.trim()}`) : undefined,
              usernameSelector: authUsernameSelector.trim() || undefined,
              passwordSelector: authPasswordSelector.trim() || undefined,
              loginButtonSelector: authSubmitSelector.trim() || undefined,
            }
          } : {}),
        }),
      });
      const { runId: rid, error } = await r.json();
      if (error) throw new Error(error);
      setRunId(rid);
      setStep('crawl');

      // Cancel any prior polling and kick off a new poll loop. The /status
      // endpoint replaces the SSE stream — see pollAutotestStatus above.
      if (pollingTimeoutRef.current) {
        clearTimeout(pollingTimeoutRef.current);
        pollingTimeoutRef.current = null;
      }
      lastSeqRef.current = 0;
      pollingActiveRef.current = true;
      pollAutotestStatus(rid);
    } catch (err: any) {
      setCrawlError(err.message);
      setCrawlStatus('error');
    }
  }, [url, maxPages, hasAuth, authUsername, authPassword, authLoginUrl, authUsernameSelector, authPasswordSelector, authSubmitSelector, pollAutotestStatus]);

  // ── Generate Test Cases ──────────────────────────────────────────────────────

  const generateTestCases = useCallback(async () => {
    if (!runId) {
      toast({ title: 'No active run', description: 'Please crawl the site first.', variant: 'destructive' });
      return;
    }
    setIsGenCases(true);
    setCasesError('');
    try {
      const r = await fetch(`/api/autotest/test-cases/${runId}`, { method: 'POST' });
      const data = await r.json();
      if (!r.ok || data.error) throw new Error(data.error || `Server error ${r.status}`);
      const tcs: TestCase[] = data.testCases || [];
      if (tcs.length === 0) throw new Error('No test cases generated — the crawl may have found no interactive pages.');
      setTestCases(tcs);
      setSelectedIds(new Set(tcs.map(tc => tc.id)));
      setStep('testcases');
    } catch (err: any) {
      setCasesError(err.message);
      toast({ title: 'Test case generation failed', description: err.message, variant: 'destructive' });
    } finally {
      setIsGenCases(false);
    }
  }, [runId, toast]);

  // ── Generate Scripts ─────────────────────────────────────────────────────────

  const generateScripts = useCallback(async () => {
    if (!runId) {
      toast({ title: 'No active run', description: 'Please crawl the site first before generating scripts.', variant: 'destructive' });
      return;
    }
    const selected = testCases.filter(tc => selectedIds.has(tc.id));
    if (!selected.length) {
      toast({ title: 'No test cases selected', description: 'Select at least one test case to generate scripts.', variant: 'destructive' });
      return;
    }

    setIsGenScript(true);
    setScriptError('');
    setScriptFiles({});
    setPreviewIndex(0);
    setScript('');
    setExecLogs([]);
    setExecResults(null);

    try {
      // Presets are virtual catalogs — they have no DB-side row, so we send
      // their metadata as `frameworkPreset` and leave `frameworkConfigId`
      // unset so the server doesn't attempt (and silently skip) a DB lookup.
      const presetForSelection = findPreset(frameworkConfigId);

      const r = await fetch('/api/autotest/scripts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          runId,
          testCases: selected,
          frameworkConfigId: !isPresetId(frameworkConfigId) && frameworkConfigId
            ? frameworkConfigId
            : undefined,
          frameworkPreset: presetForSelection
            ? {
                name: presetForSelection.name,
                framework: presetForSelection.framework,
                language: presetForSelection.language,
                pattern: presetForSelection.detectedPattern,
                detectedLanguage: presetForSelection.detectedLanguage,
                detectedTool: presetForSelection.detectedTool,
              }
            : undefined,
          userStoryIds: selectedStoryIds.size > 0 ? [...selectedStoryIds] : undefined,
        }),
      });
      const data = await r.json();
      if (!r.ok || data.error) throw new Error(data.error || `Server error ${r.status}`);

      if (data.files && Object.keys(data.files).length > 0) {
        setScriptFiles(data.files);
        setPreviewIndex(0);
        // Default to showing first spec file
        const firstSpec = Object.keys(data.files).find(f => f.endsWith('.spec.ts')) || Object.keys(data.files)[0] || '';
        setSelectedFile(firstSpec);
        const specCount = Object.keys(data.files).filter(f => f.endsWith('.spec.ts') || f.endsWith('.feature')).length;
        const selectedFw = frameworkConfigs.find(f => f.id === frameworkConfigId);
        const selectedPreset = findPreset(frameworkConfigId);
        const fwLabel = selectedFw ? ` · ${selectedFw.name}` : selectedPreset ? ` · ${selectedPreset.name}` : '';
        toast({ title: '✓ Suite Generated', description: `${Object.keys(data.files).length} files — ${specCount} spec/feature files${fwLabel}` });
      } else if (data.script) {
        setScript(data.script);
        toast({ title: 'Scripts generated', description: `Playwright script ready for ${selected.length} test case(s).` });
      }

      setScriptId(data.scriptId || null);
      setStep('scripts');
    } catch (err: any) {
      setScriptError(err.message);
      toast({ title: 'Script generation failed', description: err.message, variant: 'destructive' });
    } finally {
      setIsGenScript(false);
    }
  }, [runId, testCases, selectedIds, frameworkConfigId, selectedStoryIds, toast]);

  // ── Execute Tests ────────────────────────────────────────────────────────────

  const executeTests = useCallback(async () => {
    const hasFiles = Object.keys(scriptFiles).length > 0;
    if (!hasFiles && !script) return;

    // Generate execId CLIENT-SIDE before fetch — eliminates SSE timing race where
    // user clicks Stop before 'started' event arrives through the buffered stream.
    const execId = `exec_${Date.now()}`;
    execIdRef.current = execId;   // set immediately, no SSE dependency

    setIsExecuting(true);
    setIsStopping(false);
    setExecLogs([]);
    setExecResults(null);
    setExecError('');

    try {
      const response = await fetch('/api/autotest/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          execId,                            // tell server which id to use
          files: hasFiles ? scriptFiles : undefined,
          script: !hasFiles ? script : undefined,
          baseUrl: ensureHttp(url.trim()),
          runId,
          scriptId,
        }),
      });

      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      let shouldBreak = false;

      while (true) {
        const { done, value } = await reader.read();
        if (done || shouldBreak) break;
        buf += decoder.decode(value, { stream: true });
        const parts = buf.split('\n\n');
        buf = parts.pop() || '';
        for (const part of parts) {
          const line = part.replace(/^data:\s*/, '').trim();
          if (!line) continue;
          try {
            const evt = JSON.parse(line);
            if (evt.type === 'started') {
              // execId already set client-side; this is just for backward compat / logging
              if (evt.execId && !execIdRef.current) execIdRef.current = evt.execId;
            } else if (evt.type === 'log') {
              setExecLogs(prev => [...prev, evt.message]);
            } else if (evt.type === 'complete') {
              if (evt.results) setExecResults(evt.results);
              setIsExecuting(false);
              execIdRef.current = null;
              setIsStopping(false);
              shouldBreak = true;
            } else if (evt.type === 'stopped') {
              setExecLogs(prev => [...prev, '\n⛔  Execution stopped by user.\n']);
              setIsExecuting(false);
              execIdRef.current = null;
              setIsStopping(false);
              shouldBreak = true;
            } else if (evt.type === 'error') {
              setExecError(evt.message);
              setIsExecuting(false);
              execIdRef.current = null;
              setIsStopping(false);
              shouldBreak = true;
            }
          } catch {}
          if (shouldBreak) break;
        }
      }
      // Cancel the reader to release the connection immediately
      try { reader.cancel(); } catch {}
    } catch (err: any) {
      // AbortError / cancelled stream is expected when the user stops — not an error
      if ((err as any).name !== 'AbortError' && (err as any).name !== 'TypeError') {
        setExecError(err.message);
      }
    } finally {
      // Always reset execution state — handles stream-closed, network errors, and stop
      setIsExecuting(false);
      execIdRef.current = null;
      setIsStopping(false);
    }
  }, [script, scriptFiles, url, runId, scriptId]);

  const stopExecution = useCallback(async () => {
    const currentExecId = execIdRef.current;
    if (!currentExecId || isStopping) return;
    setIsStopping(true);
    setExecLogs(prev => [...prev, '\n⛔  Stopping execution…\n']);
    try {
      const res = await fetch(`/api/autotest/execute/${currentExecId}`, { method: 'DELETE' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        console.warn('[Stop] DELETE returned', res.status, body);
      }
    } catch (err) {
      // If the DELETE fails the SSE stream will still close and clean up
      console.warn('[Stop] DELETE failed:', err);
    }
  }, [isStopping]);

  // ── Download ──────────────────────────────────────────────────────────────────

  // Build a Playwright POM suite ZIP from the in-memory `scriptFiles` map and
  // trigger a browser download. Centralised here so both the server-zip path
  // and the client-side fallback share the same archive layout.
  const buildAndDownloadZipFromMemory = async (files: Record<string, string>) => {
    const zip = new JSZip();
    const folder = zip.folder('playwright-pom-suite')!;
    for (const [filePath, content] of Object.entries(files)) {
      folder.file(filePath, content);
    }
    const blob = await zip.generateAsync({
      type: 'blob',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 },
    });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'playwright-pom-suite.zip';
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const downloadScript = async () => {
    const hasFiles = Object.keys(scriptFiles).length > 0;

    if (hasFiles && scriptId) {
      // Try server-built ZIP first via fetch so we can fall back gracefully
      // when CloudFront / API Gateway returns an error (otherwise the browser
      // would happily save the error response under the ZIP filename).
      try {
        const r = await fetch(`/api/autotest/scripts/${scriptId}/download`);
        const ct = r.headers.get('Content-Type') || '';
        if (!r.ok || !ct.toLowerCase().includes('zip')) {
          throw new Error(`server zip endpoint returned ${r.status} ${ct}`);
        }
        const blob = await r.blob();
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'playwright-pom-suite.zip';
        a.click();
        URL.revokeObjectURL(a.href);
        return;
      } catch (err) {
        console.warn('[downloadScript] server zip failed, building client-side:', err);
        // Fall through to client-side zip below.
      }
    }

    if (hasFiles) {
      // Client-side build using the in-memory files. JSZip is statically
      // imported so it can never fail to load (no separate Vite chunk).
      try {
        await buildAndDownloadZipFromMemory(scriptFiles);
        return;
      } catch (err) {
        console.error('[downloadScript] client-side zip failed:', err);
        toast({
          title: 'Download failed',
          description: 'Could not build the test suite ZIP. Please try again or use Regenerate.',
          variant: 'destructive',
        });
        return;
      }
    }

    // Legacy single-script path (no POM suite present at all).
    const blob = new Blob([script], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'auto.spec.ts';
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const toggleId = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    const visible = tcCategory === 'all' ? testCases : testCases.filter(tc => tc.category === tcCategory);
    const visibleIds = visible.map(tc => tc.id);
    const allVisible = visibleIds.every(id => selectedIds.has(id));
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (allVisible) { visibleIds.forEach(id => next.delete(id)); }
      else { visibleIds.forEach(id => next.add(id)); }
      return next;
    });
  };

  const toggleExpand = (id: string) => {
    setExpandedCases(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const currentIdx = stepIndex(step);

  // ─── AgentPipelineCard sub-component ─────────────────────────────────────────

  function AgentPipelineCard() {
    return (
      <div className="rounded-2xl overflow-hidden mb-6" style={{ border: '1px solid hsl(var(--border))', boxShadow: '0 4px 24px #0000000d' }}>
        {/* Mission Control Header */}
        <div className="px-5 py-4 flex items-center justify-between"
          style={{ background: 'linear-gradient(135deg, #0f172a 0%, #1e1b4b 50%, #0f172a 100%)' }}>
          <div className="flex items-center gap-3">
            <div className="flex gap-1.5">
              <div className="w-3 h-3 rounded-full bg-red-400/80" />
              <div className="w-3 h-3 rounded-full bg-yellow-400/80" />
              <div className="w-3 h-3 rounded-full bg-green-400/80" />
            </div>
            <div className="w-px h-5 bg-white/10" />
            <div>
              <p className="text-white font-bold text-sm tracking-wide">ASTRA QE — AUTONOMOUS AGENTIC AI PIPELINE</p>
              <p className="text-indigo-300 text-xs font-mono">{ensureHttp(url)}</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {crawlStatus === 'crawling' && (
              <>
                <div className="flex items-center gap-1.5 px-2 py-1 rounded-full" style={{ background: '#10b98120', border: '1px solid #10b98140' }}>
                  <motion.div className="w-1.5 h-1.5 rounded-full bg-emerald-400"
                    animate={{ opacity: [1, 0.3, 1] }} transition={{ duration: 0.8, repeat: Infinity }} />
                  <span className="text-emerald-400 text-xs font-bold">LIVE</span>
                </div>
                <span className="text-white/40 text-xs font-mono">{elapsed}s elapsed</span>
              </>
            )}
            {crawlStatus === 'done' && (
              <div className="flex items-center gap-1.5 px-2 py-1 rounded-full" style={{ background: '#10b98120', border: '1px solid #10b98140' }}>
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                <span className="text-emerald-400 text-xs font-bold">COMPLETE — {crawledPages.length} pages</span>
              </div>
            )}
          </div>
        </div>

        {/* Agent Pipeline */}
        <div className="bg-white px-5 py-5">
          <div className="flex items-stretch gap-0">
            {(() => {
              const AUTH_AGENT = { id: 'Auth Agent', name: 'Auth Agent', role: 'Login Handler', desc: 'Logs into the website before crawling', color: '#0891b2', bg: '#ecfeff', border: '#a5f3fc', text: '#164e63', Icon: Lock };
              const effectiveAgents = crawlHadAuth ? [AUTH_AGENT, ...AGENTS_DEF] : AGENTS_DEF;
              return effectiveAgents.map((agent, idx) => {
              const st = crawlAgentStatuses[agent.id];
              const status = st?.status || 'idle';
              const message = st?.message || '';
              const isWorking = status === 'working';
              const isDone    = status === 'completed';
              const isError   = status === 'error';

              // Agent-specific stats
              const stats: {label: string; value: string | number}[] = agent.id === 'Auth Agent'
                ? [{ label: 'Status', value: crawlAgentStatuses['Auth Agent']?.status === 'completed' ? 'Done' : 'Active' }, { label: 'Method', value: 'Form' }]
                : agent.id === 'Scout'
                ? [{ label: 'Visited', value: crawlProgress.pagesVisited }, { label: 'Queued', value: crawlProgress.pagesQueued }]
                : agent.id === 'DOM Analyst'
                ? [{ label: 'Forms', value: crawlProgress.formsFound }, { label: 'Buttons', value: crawlProgress.buttonsFound }]
                : agent.id === 'Workflow Analyst'
                ? [{ label: 'Pages', value: crawlStatus === 'done' ? crawledPages.length : crawlProgress.pagesVisited }, { label: 'Inputs', value: crawledPages.reduce((a, p) => a + p.inputs, 0) }]
                : agent.id === 'Test Architect'
                ? [{ label: 'Tests', value: testCases.length }, { label: 'Types', value: testCases.length > 0 ? '5' : '—' }]
                : [{ label: 'Scripts', value: script ? '1' : '—' }, { label: 'Cases', value: script ? testCases.length : '—' }];

              return (
                <div key={agent.id} className="flex items-center flex-1 min-w-0">
                  {/* Agent Card */}
                  <motion.div
                    className="flex-1 min-w-0 rounded-2xl p-4 relative overflow-hidden cursor-default"
                    style={{
                      background: isDone ? '#f0fdf4' : isError ? '#fff1f2' : isWorking ? agent.bg : 'hsl(var(--muted))',
                      border: `2px solid ${isDone ? '#86efac' : isError ? '#fda4af' : isWorking ? agent.color : 'hsl(var(--border))'}`,
                      transition: 'all 0.4s ease',
                    }}
                    animate={isWorking ? {
                      boxShadow: [`0 0 0px ${agent.color}30`, `0 0 20px ${agent.color}40`, `0 0 0px ${agent.color}30`]
                    } : isError ? {
                      boxShadow: ['0 0 0px #ef444430', '0 0 16px #ef444445', '0 0 0px #ef444430']
                    } : {}}
                    transition={{ duration: 2, repeat: (isWorking || isError) ? Infinity : 0 }}
                  >
                    {/* Shimmer on active */}
                    {isWorking && (
                      <motion.div className="absolute inset-0 pointer-events-none"
                        style={{ background: `linear-gradient(105deg, transparent 40%, ${agent.color}0a 50%, transparent 60%)` }}
                        animate={{ x: ['-100%', '200%'] }}
                        transition={{ duration: 2.5, repeat: Infinity, ease: 'linear' }}
                      />
                    )}

                    {/* Top row: status + icon */}
                    <div className="flex items-start justify-between mb-3">
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                        style={{
                          background: isDone ? '#dcfce7' : isError ? '#fee2e2' : isWorking ? `${agent.color}18` : 'hsl(var(--muted))',
                          color:      isDone ? '#15803d' : isError ? '#dc2626' : isWorking ? agent.color : 'hsl(var(--muted-foreground) / 0.7)',
                          border:     `1px solid ${isDone ? '#bbf7d0' : isError ? '#fca5a5' : isWorking ? `${agent.color}40` : 'hsl(var(--border))'}`,
                        }}>
                        {isDone ? '✓ Done' : isError ? '✗ Failed' : isWorking ? '⟳ Active' : 'Queued'}
                      </span>

                      {/* Icon with animated ring */}
                      <div className="relative flex-shrink-0">
                        {isWorking && (
                          <motion.div className="absolute inset-[-4px] rounded-full"
                            style={{ border: `2px solid ${agent.color}60` }}
                            animate={{ rotate: 360 }}
                            transition={{ duration: 3, repeat: Infinity, ease: 'linear' }}
                          />
                        )}
                        <div className="w-9 h-9 rounded-xl flex items-center justify-center"
                          style={{ background: isDone ? '#dcfce7' : isError ? '#fee2e2' : isWorking ? `${agent.color}18` : 'hsl(var(--muted))' }}>
                          <agent.Icon className="w-5 h-5" style={{ color: isDone ? '#15803d' : isError ? '#dc2626' : isWorking ? agent.color : '#d1d5db' }} />
                        </div>
                      </div>
                    </div>

                    {/* Name + Role */}
                    <p className="text-sm font-bold mb-0.5 leading-tight"
                      style={{ color: isDone ? '#166534' : isError ? '#991b1b' : isWorking ? agent.text : 'hsl(var(--foreground))' }}>
                      {agent.name}
                    </p>
                    <p className="text-[11px] mb-3" style={{ color: 'hsl(var(--muted-foreground) / 0.7)' }}>{agent.role}</p>

                    {/* Stats */}
                    {(isWorking || isDone) && stats.some(s => s.value !== '—' && s.value !== 0) ? (
                      <div className="grid grid-cols-2 gap-1.5 mb-2">
                        {stats.map(s => (
                          <div key={s.label} className="rounded-lg p-1.5 text-center"
                            style={{ background: isDone ? '#f0fdf4' : `${agent.color}0c` }}>
                            <div className="text-base font-bold font-mono leading-none"
                              style={{ color: isDone ? '#15803d' : agent.color }}>{s.value}</div>
                            <div className="text-[9px] text-gray-400 mt-0.5">{s.label}</div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="h-12 rounded-lg mb-2 flex items-center justify-center"
                        style={{ background: 'hsl(var(--muted) / 0.5)', border: '1px dashed hsl(var(--border))' }}>
                        <span className="text-[10px] text-gray-400">Awaiting activation</span>
                      </div>
                    )}

                    {/* Activity message */}
                    {message && (
                      <p className="text-[10px] leading-tight font-mono truncate"
                        style={{ color: isDone ? '#4ade80' : isError ? '#f87171' : isWorking ? agent.color : 'hsl(var(--muted-foreground) / 0.7)' }}>
                        {message.length > 42 ? message.slice(0, 42) + '…' : message}
                      </p>
                    )}
                    {/* Detail line — shown for error state */}
                    {isError && st?.message && (
                      <p className="text-[9px] leading-tight text-red-400 truncate mt-0.5">
                        {(st as any).details?.length > 50 ? (st as any).details.slice(0, 50) + '…' : (st as any).details || ''}
                      </p>
                    )}
                  </motion.div>

                  {/* Arrow between agents */}
                  {idx < effectiveAgents.length - 1 && (
                    <div className="flex-shrink-0 px-2">
                      <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                        <path d="M4 10h12M12 6l4 4-4 4"
                          stroke={(() => {
                            const nextSt = crawlAgentStatuses[effectiveAgents[idx + 1].id]?.status;
                            return nextSt === 'working' || nextSt === 'completed' ? effectiveAgents[idx + 1].color : '#d1d5db';
                          })()}
                          strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </div>
                  )}
                </div>
              );
            });
            })()}
          </div>
        </div>

        {/* Activity Stream + Discovered Pages - two column */}
        <div className="grid grid-cols-2 gap-0 border-t border-gray-100">
          {/* Activity Stream */}
          <div className="p-4 border-r border-gray-100">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-xs font-bold text-gray-700">Live Activity Stream</span>
              <span className="text-[10px] text-gray-400 font-mono ml-auto">{activityLog.length} events</span>
            </div>
            <div ref={activityRef} className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
              {activityLog.length === 0 ? (
                <p className="text-xs text-gray-400 italic py-2">Waiting for agents to start…</p>
              ) : (
                activityLog.map((entry, i) => (
                  <div key={i} className="flex items-start gap-2 text-[11px] leading-relaxed">
                    <span className="font-bold shrink-0 font-mono text-[10px] px-1.5 py-0.5 rounded"
                      style={{ background: `${entry.color}15`, color: entry.color }}>
                      {entry.agent.split(' ')[0]}
                    </span>
                    <span className="text-gray-600 font-mono">{entry.message}</span>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Discovered Pages */}
          <div className="p-4">
            <div className="flex items-center gap-2 mb-3">
              <FileCode2 className="w-3.5 h-3.5 text-indigo-400" />
              <span className="text-xs font-bold text-gray-700">Discovered Pages</span>
              <span className="text-[10px] text-gray-400 font-mono ml-auto">
                {crawlStatus === 'crawling' ? `${crawlProgress.pagesVisited} found` : `${crawledPages.length} total`}
              </span>
            </div>
            <div className="space-y-1 max-h-48 overflow-y-auto pr-1">
              {crawlStatus === 'crawling' && crawlProgress.currentUrl && (
                <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[11px]"
                  style={{ background: '#eff6ff', border: '1px solid #bfdbfe' }}>
                  <motion.div className="w-1.5 h-1.5 rounded-full bg-blue-400 shrink-0"
                    animate={{ opacity: [1, 0.3, 1] }} transition={{ duration: 0.8, repeat: Infinity }} />
                  <span className="font-mono text-blue-600 truncate">{crawlProgress.currentUrl.replace(/^https?:\/\/[^/]+/, '') || '/'}</span>
                </div>
              )}
              {crawlStatus === 'crawling' && [...Array(Math.min(3, 3))].map((_, i) => (
                <div key={i} className="h-7 rounded-lg animate-pulse" style={{ background: 'hsl(var(--muted))', opacity: 1 - i * 0.3 }} />
              ))}
              {crawledPages.slice(0, 20).map((p, i) => (
                <div key={i} className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg"
                  style={{ background: 'hsl(var(--muted) / 0.5)', border: '1px solid hsl(var(--muted))' }}>
                  <CheckCircle2 className="w-3 h-3 text-emerald-500 shrink-0" />
                  <span className="text-[11px] text-gray-700 font-mono truncate flex-1">
                    {p.url.replace(/^https?:\/\/[^/]+/, '') || '/'}
                  </span>
                  <div className="flex gap-1 text-[10px] shrink-0">
                    {p.forms > 0 && <span className="text-violet-400">{p.forms}f</span>}
                    {p.buttons > 0 && <span className="text-amber-400">{p.buttons}b</span>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Stats Bar */}
        <div className="grid grid-cols-4 divide-x divide-gray-100 border-t border-gray-100">
          {[
            { label: 'Pages',   value: crawlStatus === 'done' ? crawledPages.length : crawlProgress.pagesVisited, color: 'hsl(var(--primary))' },
            { label: 'Forms',   value: crawlProgress.formsFound,   color: '#7c3aed' },
            { label: 'Buttons', value: crawlProgress.buttonsFound, color: '#d97706' },
            { label: 'Inputs',  value: crawledPages.reduce((a, p) => a + p.inputs, 0), color: '#10b981' },
          ].map(s => (
            <div key={s.label} className="py-3 flex flex-col items-center">
              <span className="text-xl font-bold font-mono" style={{ color: s.color }}>{s.value}</span>
              <span className="text-[10px] text-gray-400 mt-0.5">{s.label}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // ─── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="h-full flex flex-col text-gray-900" style={{ background: 'hsl(var(--muted) / 0.5)' }}>

      <DashboardHeader />

      {/* ── Page Title Bar ── */}
      <div style={{ background: 'hsl(var(--card))', borderBottom: '1px solid hsl(var(--border))' }}
        className="px-6 py-4 flex-shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button
              onClick={() => setLocation('/dashboard')}
              className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-indigo-600 transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
              Dashboard
            </button>
            <div className="w-px h-5 bg-[hsl(var(--border))]" />
            <div>
              <h1 className="text-xl font-semibold text-gray-900">Autonomous Testing</h1>
              <p className="text-sm" style={{ color: 'hsl(var(--primary))' }}>AI-powered · Crawl · Understand · Generate · Execute</p>
            </div>
          </div>
          {url && (
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full text-sm"
              style={{ background: 'hsl(var(--primary) / 0.08)', border: '1px solid hsl(var(--primary) / 0.3)' }}>
              <Globe className="w-3.5 h-3.5 text-indigo-500" />
              <span className="font-mono text-indigo-700 text-xs">{ensureHttp(url)}</span>
            </div>
          )}
        </div>
      </div>

      {/* ── Step bar ── */}
      <div style={{ background: 'hsl(var(--card))', borderBottom: '1px solid hsl(var(--border))' }} className="px-6 py-3 flex-shrink-0">
        <div className="flex items-center gap-1">
          {STEPS.map((s, i) => (
            <div key={s.key} className="flex items-center gap-1">
              <button
                onClick={() => { if (i < currentIdx) setStep(s.key); }}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
                  s.key === step
                    ? 'font-semibold'
                    : i < currentIdx
                    ? 'cursor-pointer'
                    : 'cursor-default opacity-40'
                }`}
                style={
                  s.key === step
                    ? { background: 'hsl(var(--card))', border: '1px solid hsl(var(--primary))', color: 'hsl(var(--primary))', boxShadow: '0 0 12px hsl(var(--primary) / 0.13)' }
                    : i < currentIdx
                    ? { color: '#10b981' }
                    : { color: 'hsl(var(--muted-foreground) / 0.7)' }
                }
              >
                {i < currentIdx
                  ? <CheckCircle2 className="w-4 h-4" style={{ color: '#10b981' }} />
                  : s.icon}
                {s.label}
              </button>
              {i < STEPS.length - 1 && <ChevronRight className="w-4 h-4 flex-shrink-0" style={{ color: 'hsl(var(--border))' }} />}
            </div>
          ))}
        </div>
      </div>

      {/* ── Content ── */}
      <div className="flex-1 overflow-y-auto">
      <div className="px-6 py-8">
        <AnimatePresence mode="wait">

          {/* ─ Step 1: Configure ─ */}
          {step === 'configure' && (
            <motion.div key="configure"
              initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -16 }}
              className="space-y-5"
            >
              {/* ── Hero Banner ── */}
              <div className="rounded-2xl overflow-hidden relative"
                style={{ background: 'linear-gradient(135deg, #0f172a 0%, #1e1b4b 55%, #0c1a3a 100%)', minHeight: 190 }}>
                {/* Subtle grid overlay */}
                <div className="absolute inset-0 pointer-events-none"
                  style={{ backgroundImage: 'repeating-linear-gradient(0deg,rgba(255,255,255,0.025) 0,rgba(255,255,255,0.025) 1px,transparent 1px,transparent 44px),repeating-linear-gradient(90deg,rgba(255,255,255,0.025) 0,rgba(255,255,255,0.025) 1px,transparent 1px,transparent 44px)' }} />
                {/* Glow orbs */}
                <div className="absolute top-0 left-1/4 w-64 h-64 rounded-full pointer-events-none"
                  style={{ background: 'radial-gradient(circle,hsl(var(--primary) / 0.13) 0%,transparent 70%)', transform: 'translateY(-50%)' }} />
                <div className="absolute bottom-0 right-1/3 w-48 h-48 rounded-full pointer-events-none"
                  style={{ background: 'radial-gradient(circle,#7c3aed18 0%,transparent 70%)', transform: 'translateY(40%)' }} />

                <div className="relative z-10 px-8 py-8">
                  <div className="flex items-start justify-between mb-6">
                    <div>
                      <div className="flex items-center gap-2 mb-3">
                        <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: 'hsl(var(--primary) / 0.15)', border: '1px solid hsl(var(--primary) / 0.28)' }}>
                          <Zap className="w-3.5 h-3.5 text-indigo-400" />
                        </div>
                        <span className="text-indigo-400 text-xs font-bold tracking-widest uppercase">Astra QE</span>
                      </div>
                      <h1 className="text-2xl font-bold text-white mb-1.5 tracking-tight">Autonomous Agentic AI Pipeline</h1>
                      <p className="text-white/45 text-sm leading-relaxed max-w-lg">
                        Enter any URL — 5 specialized AI agents crawl, extract elements, map workflows,<br />design test suites and generate Playwright scripts automatically.
                      </p>
                    </div>
                    <div className="hidden lg:flex flex-col gap-2 shrink-0 ml-4">
                      {[
                        { icon: Globe,        label: '5 AI Agents',        color: '#10b981' },
                        { icon: FileCode2,    label: 'Playwright Scripts', color: '#7c3aed' },
                        { icon: ClipboardList, label: '5 Test Categories', color: '#d97706' },
                      ].map(({ icon: Icon, label, color }) => (
                        <div key={label} className="flex items-center gap-2 px-3 py-1.5 rounded-full"
                          style={{ background: `${color}12`, border: `1px solid ${color}30` }}>
                          <Icon className="w-3 h-3" style={{ color }} />
                          <span className="text-xs font-medium" style={{ color: `${color}dd` }}>{label}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Agent pipeline teaser */}
                  <div className="flex items-center gap-2 flex-wrap">
                    {AGENTS_DEF.map((agent, idx) => (
                      <div key={agent.id} className="flex items-center gap-2">
                        <motion.div
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-full cursor-default"
                          style={{ background: `${agent.color}18`, border: `1px solid ${agent.color}35` }}
                          whileHover={{ scale: 1.04 }}
                        >
                          <agent.Icon className="w-3 h-3" style={{ color: agent.color }} />
                          <span className="text-[11px] font-semibold" style={{ color: `${agent.color}cc` }}>{agent.name}</span>
                          <span className="text-[9px]" style={{ color: `${agent.color}60` }}>{agent.role}</span>
                        </motion.div>
                        {idx < AGENTS_DEF.length - 1 && (
                          <svg width="18" height="10" viewBox="0 0 18 10">
                            <path d="M0 5h14M10 2l4 3-4 3" stroke="rgba(255,255,255,0.18)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* ── Active Framework Context Banner — shown when arriving from Framework Catalog ── */}
              {frameworkConfigId && (() => {
                const fw = frameworkConfigs.find(c => c.id === frameworkConfigId);
                const preset = findPreset(frameworkConfigId);
                // Use loaded config or fall back to URL-seeded metadata (shown instantly on navigate)
                const meta = fw
                  ? { name: fw.name, lang: fw.detectedLanguage ?? fw.language, tool: fw.detectedTool ?? fw.framework, pattern: fw.detectedPattern ?? 'POM', functionCount: fw.functionCount }
                  : preset
                    ? { name: preset.name, lang: preset.detectedLanguage, tool: preset.detectedTool, pattern: preset.detectedPattern, functionCount: null }
                    : urlFrameworkMeta
                      ? { name: urlFrameworkMeta.name, lang: urlFrameworkMeta.lang, tool: urlFrameworkMeta.tool, pattern: urlFrameworkMeta.pattern, functionCount: null }
                      : null;
                if (!meta) return null;
                const { name, lang, tool, pattern, functionCount } = meta;
                return (
                  <div className="flex items-center gap-3 px-5 py-3 rounded-2xl"
                    style={{ background: 'linear-gradient(90deg, hsl(var(--primary) / 0.08) 0%, hsl(var(--primary) / 0.04) 100%)', border: '1.5px solid hsl(var(--primary) / 0.3)', boxShadow: '0 2px 12px hsl(var(--primary) / 0.07)' }}>
                    {/* Icon */}
                    <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
                      style={{ background: 'linear-gradient(135deg,hsl(var(--primary)),#7c3aed)', boxShadow: '0 2px 8px hsl(var(--primary) / 0.25)' }}>
                      <Bot className="w-4.5 h-4.5 text-white" style={{ width: 18, height: 18 }} />
                    </div>
                    {/* Labels */}
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-indigo-600 uppercase tracking-wider mb-0.5">Active Framework</p>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-bold text-gray-900 text-sm">{name}</span>
                        <span className="text-gray-400 text-xs">·</span>
                        <span className="text-xs px-2 py-0.5 rounded-full font-medium"
                          style={{ background: 'hsl(var(--primary) / 0.1)', color: 'hsl(var(--primary))' }}>{lang}</span>
                        <span className="text-xs px-2 py-0.5 rounded-full font-medium"
                          style={{ background: '#7c3aed15', color: '#6d28d9' }}>{tool}</span>
                        <span className="text-xs px-2 py-0.5 rounded-full font-medium"
                          style={{ background: '#0891b215', color: '#0e7490' }}>{pattern}</span>
                        {functionCount != null && <span className="text-xs text-gray-500">{functionCount} functions</span>}
                      </div>
                    </div>
                    {/* Info + Dismiss */}
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span className="text-xs text-indigo-500 bg-indigo-50 border border-indigo-200 rounded-lg px-2.5 py-1 font-medium">
                        ✓ Scripts will use this framework pattern
                      </span>
                      <a href="/qe/framework-config"
                        className="text-xs text-indigo-400 hover:text-indigo-600 underline whitespace-nowrap">
                        Change →
                      </a>
                      <button
                        onClick={() => setFrameworkConfigId('')}
                        className="w-6 h-6 rounded-full flex items-center justify-center text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
                        title="Clear framework selection">
                        ✕
                      </button>
                    </div>
                  </div>
                );
              })()}

              {/* ── Main Row: Form (3) + Saved Runs (2) ── */}
              <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">

                {/* Configure Form */}
                <div className="lg:col-span-3 rounded-2xl p-7" style={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', boxShadow: '0 2px 16px #0000000a' }}>
                  <div className="flex items-center gap-3 mb-7">
                    <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: 'linear-gradient(135deg,hsl(var(--primary) / 0.08),hsl(var(--primary) / 0.08))', border: '1px solid hsl(var(--primary) / 0.3)' }}>
                      <Globe className="w-5 h-5 text-indigo-500" />
                    </div>
                    <div>
                      <h2 className="text-base font-bold text-gray-900">Configure Target Website</h2>
                      <p className="text-xs text-gray-400 mt-0.5">Paste any public URL — agents handle the rest</p>
                    </div>
                  </div>

                  {/* URL Input */}
                  <div className="mb-6">
                    <label className="block text-sm font-semibold text-gray-700 mb-2">Target URL</label>
                    <div className="relative">
                      <div className="flex items-center gap-3 rounded-xl px-4 py-4 transition-all"
                        style={{ background: 'linear-gradient(135deg, hsl(var(--primary) / 0.05), hsl(var(--primary) / 0.08))', border: '2px solid hsl(var(--primary) / 0.2)' }}>
                        <Globe className="w-5 h-5 text-indigo-400 flex-shrink-0" />
                        <input
                          type="text"
                          value={url}
                          onChange={e => setUrl(e.target.value)}
                          onKeyDown={e => { if (e.key === 'Enter' && url.trim()) startCrawl(); }}
                          placeholder="nousinfosystems.com"
                          className="flex-1 bg-transparent text-foreground placeholder:text-muted-foreground/50 outline-none text-base font-mono"
                          autoFocus
                        />
                        {url.trim() && (
                          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                            className="flex items-center gap-1 px-2 py-0.5 rounded-full shrink-0"
                            style={{ background: '#10b98118', border: '1px solid #10b98130' }}>
                            <div className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                            <span className="text-[10px] text-emerald-600 font-mono">ready</span>
                          </motion.div>
                        )}
                      </div>
                    </div>
                    <p className="text-xs text-gray-400 mt-1.5 ml-1">https:// prepended automatically · Enter key to launch</p>
                  </div>

                  {/* Crawl Depth Slider */}
                  <div className="mb-7">
                    <div className="flex items-center justify-between mb-3">
                      <label className="text-sm font-semibold text-gray-700">Crawl Depth</label>
                      <div className="flex items-center gap-1.5 px-3 py-1 rounded-full" style={{ background: 'hsl(var(--primary) / 0.08)', border: '1px solid hsl(var(--primary) / 0.3)' }}>
                        <span className="text-xs text-gray-500">Max</span>
                        <span className="text-sm font-bold text-indigo-600 font-mono">{maxPages}</span>
                        <span className="text-xs text-gray-400">pages</span>
                      </div>
                    </div>
                    <input type="range" min={10} max={300} step={10} value={maxPages}
                      onChange={e => setMaxPages(Number(e.target.value))}
                      className="w-full accent-indigo-500 mb-2" />
                    <div className="grid grid-cols-4 text-[10px] text-gray-400">
                      <span>Demo (10)</span>
                      <span className="text-center">Quick (50)</span>
                      <span className="text-center">Standard (150)</span>
                      <span className="text-right">Deep (300)</span>
                    </div>
                  </div>

                  {/* Authentication Section */}
                  <div className="mb-6">
                    <button
                      type="button"
                      onClick={() => setHasAuth(v => !v)}
                      className="flex items-center gap-3 w-full px-4 py-3 rounded-xl transition-all text-left"
                      style={{
                        background: hasAuth ? 'linear-gradient(135deg,#f0fdf4,#ecfdf5)' : 'hsl(var(--muted) / 0.5)',
                        border: `1.5px solid ${hasAuth ? '#86efac' : 'hsl(var(--border))'}`,
                      }}
                    >
                      <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
                        style={{ background: hasAuth ? '#dcfce7' : 'hsl(var(--muted))' }}>
                        <Lock className="w-4 h-4" style={{ color: hasAuth ? '#16a34a' : 'hsl(var(--muted-foreground) / 0.7)' }} />
                      </div>
                      <div className="flex-1">
                        <p className="text-sm font-semibold" style={{ color: hasAuth ? '#15803d' : 'hsl(var(--foreground))' }}>
                          Website requires login
                        </p>
                        <p className="text-xs text-gray-400 mt-0.5">
                          {hasAuth ? 'Auth Agent will log in before crawling' : 'Enable to enter credentials for authenticated crawl'}
                        </p>
                      </div>
                      <div className="w-10 h-5 rounded-full shrink-0 relative transition-all"
                        style={{ background: hasAuth ? '#22c55e' : '#d1d5db' }}>
                        <div className="absolute top-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-all"
                          style={{ left: hasAuth ? '22px' : '2px' }} />
                      </div>
                    </button>

                    <AnimatePresence>
                      {hasAuth && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
                          className="overflow-hidden"
                        >
                          <div className="pt-4 space-y-3">
                            {/* Login URL (optional) */}
                            <div>
                              <label className="block text-xs font-semibold text-gray-600 mb-1.5">
                                Login URL <span className="font-normal text-gray-400">(optional — auto-detected if blank)</span>
                              </label>
                              <input
                                type="text"
                                value={authLoginUrl}
                                onChange={e => setAuthLoginUrl(e.target.value)}
                                placeholder="e.g. example.com/login"
                                className="w-full px-3 py-2.5 rounded-lg text-sm font-mono text-gray-700 outline-none transition-all"
                                style={{ background: 'hsl(var(--muted) / 0.5)', border: '1.5px solid hsl(var(--border))' }}
                              />
                            </div>

                            {/* Username + Password row */}
                            <div className="grid grid-cols-2 gap-3">
                              <div>
                                <label className="block text-xs font-semibold text-gray-600 mb-1.5">Username / Email</label>
                                <div className="relative">
                                  <UserCircle2 className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                                  <input
                                    type="text"
                                    value={authUsername}
                                    onChange={e => setAuthUsername(e.target.value)}
                                    placeholder="admin@example.com"
                                    className="w-full pl-9 pr-3 py-2.5 rounded-lg text-sm text-gray-700 outline-none transition-all"
                                    style={{ background: 'hsl(var(--muted) / 0.5)', border: '1.5px solid hsl(var(--border))' }}
                                    autoComplete="username"
                                  />
                                </div>
                              </div>
                              <div>
                                <label className="block text-xs font-semibold text-gray-600 mb-1.5">Password</label>
                                <div className="relative">
                                  <KeyRound className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                                  <input
                                    type={showPassword ? 'text' : 'password'}
                                    value={authPassword}
                                    onChange={e => setAuthPassword(e.target.value)}
                                    placeholder="••••••••"
                                    className="w-full pl-9 pr-9 py-2.5 rounded-lg text-sm text-gray-700 outline-none transition-all"
                                    style={{ background: 'hsl(var(--muted) / 0.5)', border: '1.5px solid hsl(var(--border))' }}
                                    autoComplete="current-password"
                                  />
                                  <button type="button" onClick={() => setShowPassword(v => !v)}
                                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                                  </button>
                                </div>
                              </div>
                            </div>

                            {/* Advanced selectors toggle */}
                            <button type="button" onClick={() => setAuthAdvanced(v => !v)}
                              className="flex items-center gap-1.5 text-xs text-indigo-500 hover:text-indigo-600 transition-colors">
                              <ChevronRight className={`w-3.5 h-3.5 transition-transform ${authAdvanced ? 'rotate-90' : ''}`} />
                              Advanced — custom CSS selectors (optional)
                            </button>

                            <AnimatePresence>
                              {authAdvanced && (
                                <motion.div
                                  initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
                                  className="overflow-hidden"
                                >
                                  <div className="pt-2 space-y-2 pl-3 border-l-2 border-indigo-100">
                                    <p className="text-[11px] text-gray-400">Leave blank — Auth Agent auto-detects the login form</p>
                                    {[
                                      { label: 'Username field selector', value: authUsernameSelector, set: setAuthUsernameSelector, placeholder: 'e.g. input[name="email"]' },
                                      { label: 'Password field selector', value: authPasswordSelector, set: setAuthPasswordSelector, placeholder: 'e.g. input[type="password"]' },
                                      { label: 'Submit button selector', value: authSubmitSelector,    set: setAuthSubmitSelector,   placeholder: 'e.g. button[type="submit"]' },
                                    ].map(f => (
                                      <div key={f.label}>
                                        <label className="block text-[11px] text-gray-500 mb-1">{f.label}</label>
                                        <input type="text" value={f.value} onChange={e => f.set(e.target.value)}
                                          placeholder={f.placeholder}
                                          className="w-full px-3 py-2 rounded-lg text-xs font-mono text-gray-700 outline-none"
                                          style={{ background: 'hsl(var(--muted) / 0.5)', border: '1.5px solid hsl(var(--border))' }}
                                        />
                                      </div>
                                    ))}
                                  </div>
                                </motion.div>
                              )}
                            </AnimatePresence>

                            {/* Security note */}
                            <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg"
                              style={{ background: '#fefce8', border: '1px solid #fef08a' }}>
                              <ShieldCheck className="w-3.5 h-3.5 text-yellow-600 shrink-0 mt-0.5" />
                              <p className="text-[11px] text-yellow-700 leading-relaxed">
                                Credentials are used only for this crawl session and never stored to disk. Session cookies are discarded when the crawl ends.
                              </p>
                            </div>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>

                  {/* Launch Button */}
                  <motion.button
                    onClick={startCrawl}
                    disabled={!url.trim()}
                    className="w-full flex items-center justify-center gap-3 disabled:opacity-40 disabled:cursor-not-allowed font-bold py-4 rounded-xl transition-all text-base text-white mb-6"
                    style={{ background: url.trim() ? 'linear-gradient(90deg,hsl(var(--primary)) 0%,#7c3aed 100%)' : '#cbd5e1', boxShadow: url.trim() ? '0 6px 28px hsl(var(--primary) / 0.28)' : 'none' }}
                    whileHover={url.trim() ? { scale: 1.01, boxShadow: '0 8px 32px hsl(var(--primary) / 0.33)' } : {}}
                    whileTap={url.trim() ? { scale: 0.99 } : {}}
                  >
                    <Zap className="w-5 h-5" />
                    Launch Autonomous Testing
                    <ChevronRight className="w-5 h-5" />
                  </motion.button>

                  {/* Feature list */}
                  <div className="pt-5 grid grid-cols-2 gap-2.5" style={{ borderTop: '1px solid hsl(var(--muted))' }}>
                    {[
                      ['Navigate all pages',         AGENTS_DEF[0].color],
                      ['Extract locators & XPaths',  AGENTS_DEF[1].color],
                      ['Map user workflows',          AGENTS_DEF[2].color],
                      ['Generate all test types',     AGENTS_DEF[3].color],
                      ['Full Playwright scripts',     AGENTS_DEF[4].color],
                      ['Execute in real Chromium',    '#6366f1'],
                    ].map(([feature, color]) => (
                      <div key={feature} className="flex items-center gap-2">
                        <div className="w-4 h-4 rounded-full flex items-center justify-center shrink-0" style={{ background: `${color}18` }}>
                          <Check className="w-2.5 h-2.5" style={{ color }} />
                        </div>
                        <span className="text-xs text-gray-600">{feature}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Saved Runs */}
                <div className="lg:col-span-2 rounded-2xl p-6 flex flex-col" style={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', boxShadow: '0 2px 16px #0000000a' }}>
                  <div className="flex items-center gap-3 mb-5">
                    <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: '#f0fdf4', border: '1px solid #bbf7d0' }}>
                      <RotateCcw className="w-4 h-4 text-emerald-500" />
                    </div>
                    <div>
                      <h3 className="text-sm font-bold text-gray-900">Saved Runs</h3>
                      <p className="text-xs text-gray-400 mt-0.5">Reload for regression testing</p>
                    </div>
                    {pastRuns.length > 0 && (
                      <span className="ml-auto text-[10px] font-semibold px-2 py-0.5 rounded-full" style={{ background: 'hsl(var(--primary) / 0.08)', color: 'hsl(var(--primary))', border: '1px solid hsl(var(--primary) / 0.3)' }}>
                        {pastRuns.length}
                      </span>
                    )}
                  </div>

                  <div className="flex-1">
                    {isLoadingRuns ? (
                      <div className="flex items-center gap-2 text-xs text-gray-400 py-6 justify-center">
                        <Loader2 className="w-4 h-4 animate-spin text-indigo-400" />
                        Loading runs…
                      </div>
                    ) : pastRuns.length === 0 ? (
                      <div className="flex flex-col items-center justify-center py-10 text-center">
                        <div className="w-14 h-14 rounded-2xl flex items-center justify-center mb-3" style={{ background: 'hsl(var(--muted) / 0.5)', border: '2px dashed hsl(var(--border))' }}>
                          <Clock className="w-6 h-6 text-gray-300" />
                        </div>
                        <p className="text-sm font-semibold text-gray-500">No saved runs yet</p>
                        <p className="text-xs text-gray-400 mt-1 leading-relaxed max-w-[160px]">Complete your first crawl — it saves automatically</p>
                      </div>
                    ) : (
                      <div className="space-y-2.5 max-h-72 overflow-y-auto pr-1">
                        {pastRuns.map(run => (
                          <div key={run.id} className="rounded-xl p-3.5 transition-all hover:shadow-sm"
                            style={{ background: 'hsl(var(--muted) / 0.5)', border: '1px solid hsl(var(--muted))' }}>
                            <div className="flex items-start justify-between gap-2 mb-2">
                              <div className="flex items-center gap-2 min-w-0">
                                <motion.div
                                  className="w-2 h-2 rounded-full flex-shrink-0"
                                  style={{ background: run.status === 'done' ? '#10b981' : run.status === 'error' ? '#ef4444' : '#f59e0b' }}
                                  animate={run.status === 'done' ? { scale: [1, 1.3, 1] } : {}}
                                  transition={{ duration: 2, repeat: Infinity }}
                                />
                                <span className="text-xs font-mono font-semibold text-gray-700 truncate">
                                  {run.url.replace(/^https?:\/\//, '')}
                                </span>
                              </div>
                              <button
                                onClick={() => loadPastRun(run.id, run.url)}
                                disabled={isLoadingRun || run.status !== 'done'}
                                className="flex items-center gap-1.5 text-xs font-bold px-2.5 py-1 rounded-lg transition-all flex-shrink-0 disabled:opacity-40 disabled:cursor-not-allowed"
                                style={{ color: 'hsl(var(--primary))', background: 'hsl(var(--primary) / 0.08)', border: '1px solid hsl(var(--primary) / 0.3)' }}
                              >
                                {isLoadingRun ? <Loader2 className="w-3 h-3 animate-spin" /> : <RotateCcw className="w-3 h-3" />}
                                Load
                              </button>
                            </div>
                            <div className="flex items-center gap-3 ml-4">
                              <span className="text-[10px] text-gray-400 flex items-center gap-1">
                                <FileCode2 className="w-2.5 h-2.5" />
                                {run.pageCount ?? 0} pages
                              </span>
                              <span className="text-[10px] text-gray-300">·</span>
                              <span className="text-[10px] text-gray-400">{new Date(run.createdAt).toLocaleString()}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* ── Agent Showcase ── */}
              <div className="rounded-2xl p-6" style={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', boxShadow: '0 2px 16px #0000000a' }}>
                <div className="flex items-center gap-3 mb-5">
                  <h3 className="text-sm font-bold text-gray-800">How It Works — 5 Agents, One Pipeline</h3>
                  <div className="flex-1 h-px bg-gray-100" />
                  <span className="text-[10px] text-gray-400 font-mono whitespace-nowrap">Sequential · Automated · Zero Coding</span>
                </div>
                <div className="grid grid-cols-5 gap-3">
                  {AGENTS_DEF.map((agent, idx) => (
                    <div key={agent.id} className="relative">
                      {/* Connecting line to next */}
                      {idx < AGENTS_DEF.length - 1 && (
                        <div className="absolute top-8 left-full z-10 flex items-center" style={{ width: 12 }}>
                          <svg width="12" height="12" viewBox="0 0 12 12">
                            <path d="M0 6h8M5 3l3 3-3 3" stroke={agent.color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.4" />
                          </svg>
                        </div>
                      )}
                      <motion.div
                        className="rounded-xl p-4 text-center h-full"
                        style={{ background: `${agent.color}08`, border: `1.5px solid ${agent.color}20` }}
                        whileHover={{ y: -2, boxShadow: `0 8px 20px ${agent.color}20`, borderColor: `${agent.color}50` }}
                        transition={{ duration: 0.15 }}
                      >
                        <div className="w-10 h-10 rounded-xl flex items-center justify-center mx-auto mb-3"
                          style={{ background: `${agent.color}18`, border: `1px solid ${agent.color}30` }}>
                          <agent.Icon className="w-5 h-5" style={{ color: agent.color }} />
                        </div>
                        <div className="flex items-center justify-center gap-1 mb-1">
                          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full"
                            style={{ background: `${agent.color}15`, color: agent.color }}>
                            Step {idx + 1}
                          </span>
                        </div>
                        <p className="text-xs font-bold mb-0.5" style={{ color: agent.text }}>{agent.name}</p>
                        <p className="text-[10px] text-gray-400 leading-relaxed">{agent.role}</p>
                        <p className="text-[9px] text-gray-400 mt-1.5 leading-tight">{agent.desc}</p>
                      </motion.div>
                    </div>
                  ))}
                </div>
              </div>
            </motion.div>
          )}

          {/* ─ Step 2: Crawl ─ */}
          {step === 'crawl' && (
            <motion.div key="crawl"
              initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -16 }}
            >
              {/* Framework pill — persistent reminder during crawl */}
              {frameworkConfigId && (() => {
                const fw = frameworkConfigs.find(c => c.id === frameworkConfigId);
                const preset = findPreset(frameworkConfigId);
                const meta = fw
                  ? { name: fw.name, lang: fw.detectedLanguage ?? fw.language, tool: fw.detectedTool ?? fw.framework, pattern: fw.detectedPattern ?? 'POM' }
                  : preset
                    ? { name: preset.name, lang: preset.detectedLanguage, tool: preset.detectedTool, pattern: preset.detectedPattern }
                    : null;
                if (!meta) return null;
                const { name, lang, tool, pattern } = meta;
                return (
                  <div className="flex items-center gap-2 mb-4 px-4 py-2.5 rounded-xl"
                    style={{ background: 'hsl(var(--primary) / 0.08)', border: '1px solid hsl(var(--primary) / 0.3)' }}>
                    <Bot className="w-3.5 h-3.5 text-indigo-500 flex-shrink-0" />
                    <span className="text-xs font-semibold text-indigo-700">Framework:</span>
                    <span className="text-xs font-bold text-gray-800">{name}</span>
                    <span className="text-xs text-gray-400">·</span>
                    <span className="text-xs text-indigo-600">{lang} · {tool} · {pattern}</span>
                    <span className="ml-auto text-xs text-indigo-500 font-medium">✓ Scripts will use this pattern</span>
                  </div>
                );
              })()}

              {/* Mission Control Pipeline */}
              <AgentPipelineCard />

              {/* Errors */}
              {crawlError && (
                <div className="flex items-start gap-2 rounded-xl p-4 mb-4 text-sm text-red-600"
                  style={{ background: '#fef2f2', border: '1px solid #fecaca' }}>
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-red-500" />
                  <div>
                    {crawlError.split('\n').map((line, i) => (
                      <p key={i} className={i === 0 ? 'font-semibold' : 'text-red-400 text-xs mt-1'}>{line}</p>
                    ))}
                    <button
                      onClick={() => { setCrawlError(''); setCrawlStatus('idle'); setStep('configure'); }}
                      className="mt-2 text-xs text-red-500 underline hover:text-red-700"
                    >← Back to Configure</button>
                  </div>
                </div>
              )}
              {casesError && (
                <div className="flex items-start gap-2 rounded-xl p-3 mb-4 text-sm text-red-400"
                  style={{ background: '#fef2f2', border: '1px solid #fecaca' }}>
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />{casesError}
                </div>
              )}

              {/* Action buttons */}
              {crawlStatus === 'done' && crawledPages.length > 0 && (
                <div className="flex items-center gap-3">
                  <button
                    onClick={generateTestCases}
                    disabled={isGenCases}
                    className="flex-1 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed font-semibold py-3.5 rounded-xl transition-all text-sm text-white"
                    style={{ background: 'linear-gradient(90deg, hsl(var(--primary)), #7c3aed)', boxShadow: '0 0 24px hsl(var(--primary) / 0.19)' }}
                  >
                    {isGenCases ? (
                      <><Loader2 className="w-4 h-4 animate-spin" /> Test Architect is writing test cases…</>
                    ) : (
                      <><ClipboardList className="w-4 h-4" /> Generate Test Cases with AI <ChevronRight className="w-4 h-4" /></>
                    )}
                  </button>
                  <button
                    onClick={() => setStep('pages')}
                    className="flex items-center gap-1.5 text-sm text-indigo-500 hover:text-indigo-600 px-4 py-3.5 rounded-xl transition-colors whitespace-nowrap"
                    style={{ background: 'hsl(var(--primary) / 0.08)', border: '1px solid hsl(var(--primary) / 0.3)' }}
                  >
                    <ExternalLink className="w-3.5 h-3.5" /> View Pages
                  </button>
                </div>
              )}
            </motion.div>
          )}

          {/* ─ Step 3: Pages ─ */}
          {step === 'pages' && (
            <motion.div key="pages"
              initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -16 }}
            >
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-lg font-semibold text-gray-900">
                  Discovered Pages <span className="text-gray-500 font-normal text-base">({crawledPages.length})</span>
                </h2>
                <button
                  onClick={generateTestCases}
                  disabled={isGenCases}
                  className="flex items-center gap-2 disabled:opacity-50 font-semibold px-5 py-2 rounded-xl text-sm text-white"
                  style={{ background: 'linear-gradient(90deg, hsl(var(--primary)), #6366f1)', boxShadow: '0 0 16px hsl(var(--primary) / 0.16)' }}
                >
                  {isGenCases
                    ? <><Loader2 className="w-4 h-4 animate-spin" /> Generating…</>
                    : <><ClipboardList className="w-4 h-4" /> Generate Test Cases</>}
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {crawledPages.map((p, i) => (
                  <div key={i} className="rounded-xl p-4 transition-colors"
                    style={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }}>
                    <div className="flex items-start justify-between gap-2 mb-3">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-gray-900 truncate">{p.title || 'Untitled'}</p>
                        <p className="text-xs text-gray-500 font-mono truncate mt-0.5">
                          {p.url.replace(/^https?:\/\/[^/]+/, '') || '/'}
                        </p>
                      </div>
                      <Globe className="w-4 h-4 text-gray-400 flex-shrink-0 mt-0.5" />
                    </div>
                    <div className="grid grid-cols-4 gap-2 text-center">
                      {[
                        { label: 'Forms',   v: p.forms,   c: 'text-purple-400' },
                        { label: 'Inputs',  v: p.inputs,  c: 'text-green-400'  },
                        { label: 'Buttons', v: p.buttons, c: 'text-yellow-400' },
                        { label: 'Links',   v: p.links,   c: 'text-blue-500'   },
                      ].map(s => (
                        <div key={s.label}>
                          <div className={`text-sm font-bold ${s.c}`}>{s.v}</div>
                          <div className="text-xs text-gray-500">{s.label}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>

              {casesError && (
                <div className="mt-4 flex items-start gap-2 rounded-xl p-4 text-sm text-red-400"
                  style={{ background: '#fef2f2', border: '1px solid #fecaca' }}>
                  <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />{casesError}
                </div>
              )}
            </motion.div>
          )}

          {/* ─ Step 4: Test Cases ─ */}
          {step === 'testcases' && (
            <motion.div key="testcases"
              initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -16 }}
            >
              <div className="flex items-center justify-between mb-5">
                <div>
                  <h2 className="text-lg font-semibold text-gray-900">
                    Test Cases <span className="text-gray-500 font-normal text-base">({testCases.length} generated)</span>
                  </h2>
                  <p className="text-sm text-gray-500">
                    <span style={{ color: selectedIds.size === 0 ? 'hsl(var(--muted-foreground) / 0.7)' : selectedIds.size === testCases.length ? '#10b981' : 'hsl(var(--primary))', fontWeight: 600 }}>
                      {selectedIds.size}
                    </span>
                    {' of '}{testCases.length} selected for script generation
                  </p>
                </div>
                <div className="flex items-center gap-3 flex-wrap">
                  <button onClick={toggleAll} className="text-sm text-indigo-500 hover:text-indigo-600 flex items-center gap-1.5 transition-colors">
                    {(() => {
                      const visible = tcCategory === 'all' ? testCases : testCases.filter(tc => tc.category === tcCategory);
                      const allSel = visible.length > 0 && visible.every(tc => selectedIds.has(tc.id));
                      return allSel
                        ? <><Square className="w-3.5 h-3.5" /> Deselect {tcCategory === 'all' ? 'All' : 'Visible'}</>
                        : <><Check className="w-3.5 h-3.5" /> Select {tcCategory === 'all' ? 'All' : 'Visible'}</>;
                    })()}
                  </button>

                  {/* Framework Catalog Selector */}
                  <div className="flex flex-col gap-1.5">
                    <div className="flex items-center gap-1.5"
                      title="Use an uploaded framework catalog to shape generated scripts">
                      <Bot className="w-3.5 h-3.5 text-indigo-400 flex-shrink-0" />
                      <select
                        value={frameworkConfigId}
                        onChange={e => setFrameworkConfigId(e.target.value)}
                        className="text-xs border border-indigo-200 rounded-lg px-2 py-1.5 bg-white text-gray-700 focus:outline-none focus:ring-1 focus:ring-indigo-400 max-w-[260px]"
                      >
                        <option value="">
                          No framework — TypeScript + Playwright (default)
                        </option>
                        <optgroup label="Built-in presets">
                          {FRAMEWORK_PRESETS.map(p => (
                            <option key={p.id} value={p.id}>
                              {p.name}
                            </option>
                          ))}
                        </optgroup>
                        {frameworkConfigs.length > 0 && (
                          <optgroup label="Your uploaded catalogs">
                            {frameworkConfigs.map(fc => {
                              const detected = fc.detectedLanguage && fc.detectedTool
                                ? `${fc.detectedLanguage} • ${fc.detectedTool} • ${fc.detectedPattern ?? 'POM'}`
                                : `${fc.framework} • ${fc.language}`;
                              return (
                                <option key={fc.id} value={fc.id}>
                                  {fc.name} — {detected} ({fc.functionCount} fns)
                                </option>
                              );
                            })}
                          </optgroup>
                        )}
                      </select>
                    </div>

                    {/* Detection banner — shown when a framework is selected */}
                    {frameworkConfigId && (() => {
                      const selected = frameworkConfigs.find(
                        c => c.id === frameworkConfigId
                      );
                      const preset = findPreset(frameworkConfigId);
                      if (!selected && !preset) return null;
                      const lang    = selected ? (selected.detectedLanguage ?? selected.language) : preset!.detectedLanguage;
                      const tool    = selected ? (selected.detectedTool     ?? selected.framework) : preset!.detectedTool;
                      const pattern = selected ? (selected.detectedPattern  ?? 'POM') : preset!.detectedPattern;
                      return (
                        <div className="flex items-center gap-1.5 text-xs bg-indigo-50 border border-indigo-200 rounded-lg px-2 py-1.5">
                          <span className="text-indigo-500">🔍</span>
                          <span className="text-indigo-700">
                            Scripts will be generated in{' '}
                            <strong>{lang}</strong> +{' '}
                            <strong>{tool}</strong> +{' '}
                            <strong>{pattern}</strong>
                          </span>
                          <button
                            onClick={() => setFrameworkConfigId('')}
                            className="ml-auto text-indigo-400 hover:text-indigo-600 text-xs"
                          >
                            Clear
                          </button>
                        </div>
                      );
                    })()}

                    {/* No-uploaded-catalog notice — presets always available */}
                    {frameworkConfigs.length === 0 && (
                      <div className="text-xs text-gray-500 flex items-center gap-1">
                        <span>Using built-in presets.</span>
                        <a
                          href="/framework-config"
                          className="text-indigo-500 hover:underline"
                        >
                          Upload your own catalog →
                        </a>
                      </div>
                    )}
                  </div>

                  {/* User Story Picker */}
                  {availableStories.length > 0 && (
                    <div className="relative">
                      <button
                        onClick={() => setShowStoryPicker(p => !p)}
                        className="flex items-center gap-1.5 text-xs border border-purple-200 rounded-lg px-2 py-1.5 bg-white text-purple-700 hover:bg-purple-50 transition-colors"
                        title="Attach user stories to generate story-aware tests"
                      >
                        <ClipboardList className="w-3.5 h-3.5" />
                        User Stories {selectedStoryIds.size > 0 && <span className="bg-purple-100 text-purple-700 rounded-full px-1.5 font-bold">{selectedStoryIds.size}</span>}
                        {showStoryPicker ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                      </button>
                      {showStoryPicker && (
                        <div className="absolute right-0 top-full mt-1 z-50 w-80 bg-white border border-purple-100 rounded-xl shadow-xl p-3 max-h-64 overflow-y-auto">
                          <p className="text-xs text-gray-500 mb-2 font-medium">Select user stories to include in generated tests:</p>
                          {availableStories.map(story => (
                            <label key={story.id} className="flex items-start gap-2 py-1.5 cursor-pointer hover:bg-purple-50 rounded px-1 group">
                              <input
                                type="checkbox"
                                checked={selectedStoryIds.has(story.id)}
                                onChange={e => {
                                  setSelectedStoryIds(prev => {
                                    const next = new Set(prev);
                                    if (e.target.checked) next.add(story.id);
                                    else next.delete(story.id);
                                    return next;
                                  });
                                }}
                                className="mt-0.5 accent-purple-600"
                              />
                              <div className="flex-1 min-w-0">
                                <span className="text-xs text-gray-800 font-medium block truncate">{story.title}</span>
                                {story.state && <span className="text-[10px] text-gray-400">{story.state}</span>}
                              </div>
                            </label>
                          ))}
                          <div className="flex justify-between mt-2 pt-2 border-t border-gray-100">
                            <button onClick={() => setSelectedStoryIds(new Set(availableStories.map(s => s.id)))} className="text-[10px] text-purple-600 hover:underline">Select All</button>
                            <button onClick={() => setSelectedStoryIds(new Set())} className="text-[10px] text-gray-400 hover:underline">Clear</button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  <button
                    onClick={generateScripts}
                    disabled={isGenScript || selectedIds.size === 0}
                    className="flex items-center gap-2 disabled:cursor-not-allowed font-semibold px-5 py-2 rounded-xl text-sm text-white transition-all duration-200"
                    style={
                      selectedIds.size === 0
                        ? { background: 'linear-gradient(90deg, #9ca3af, #d1d5db)', boxShadow: 'none', opacity: 0.7 }
                        : { background: 'linear-gradient(90deg, hsl(var(--primary)), #6366f1)', boxShadow: '0 0 16px hsl(var(--primary) / 0.16)' }
                    }
                  >
                    {isGenScript
                      ? <><Loader2 className="w-4 h-4 animate-spin" /> Generating scripts…</>
                      : selectedIds.size === 0
                        ? <><FileCode2 className="w-4 h-4" /> Select test cases to generate</>
                        : <><FileCode2 className="w-4 h-4" /> Generate Scripts ({selectedIds.size})</>}
                  </button>
                </div>
              </div>

              {/* Category filter tabs + priority summary */}
              <div className="flex items-center gap-2 mb-4 flex-wrap">
                {[
                  { key: 'all',           label: 'All',            color: 'hsl(var(--primary))' },
                  { key: 'smoke',         label: '🔥 Smoke',       color: 'hsl(var(--primary))' },
                  { key: 'functional',    label: '✅ Functional',  color: '#2563eb' },
                  { key: 'negative',      label: '❌ Negative',    color: '#e11d48' },
                  { key: 'edge',          label: '⚡ Edge',        color: '#ea580c' },
                  { key: 'security',      label: '🔒 Security',    color: '#dc2626' },
                  { key: 'accessibility', label: '♿ A11y',        color: '#7c3aed' },
                ].map(cat => {
                  const count = cat.key === 'all' ? testCases.length : testCases.filter(tc => tc.category === cat.key).length;
                  if (count === 0 && cat.key !== 'all') return null;
                  const isActive = tcCategory === cat.key;
                  return (
                    <button key={cat.key}
                      onClick={() => setTcCategory(cat.key)}
                      className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full transition-all"
                      style={{
                        background: isActive ? cat.color : 'hsl(var(--muted) / 0.5)',
                        color: isActive ? 'hsl(var(--card))' : 'hsl(var(--muted-foreground))',
                        border: `1px solid ${isActive ? cat.color : 'hsl(var(--border))'}`,
                        boxShadow: isActive ? `0 0 12px ${cat.color}30` : 'none',
                      }}
                    >
                      {cat.label} <span className="opacity-75">({count})</span>
                    </button>
                  );
                })}
                <div className="flex-1" />
                {(['P0','P1','P2','P3'] as const).map(p => {
                  const count = testCases.filter(tc => tc.priority === p).length;
                  return count > 0 ? (
                    <span key={p} className={`text-xs font-medium px-2 py-1 rounded-full border ${PRIORITY_COLORS[p]}`}>
                      {p}: {count}
                    </span>
                  ) : null;
                })}
              </div>

              <div className="space-y-2">
                {testCases.filter(tc => tcCategory === 'all' || tc.category === tcCategory).map(tc => (
                  <div key={tc.id}
                    className="rounded-xl transition-all"
                    style={{
                      background: 'hsl(var(--card))',
                      border: `1px solid ${selectedIds.has(tc.id) ? 'hsl(var(--primary))' : 'hsl(var(--border))'}`,
                      boxShadow: selectedIds.has(tc.id) ? '0 0 12px hsl(var(--primary) / 0.08)' : 'none',
                    }}
                  >
                    <div className="flex items-center gap-3 p-4 cursor-pointer" onClick={() => toggleId(tc.id)}>
                      <div className="w-5 h-5 rounded border flex items-center justify-center flex-shrink-0 transition-all"
                        style={{
                          background: selectedIds.has(tc.id) ? 'hsl(var(--primary))' : 'transparent',
                          borderColor: selectedIds.has(tc.id) ? 'hsl(var(--primary))' : '#d1d5db',
                        }}>
                        {selectedIds.has(tc.id) && <Check className="w-3 h-3 text-white" />}
                      </div>
                      <span className="text-xs font-mono text-gray-500 w-14 flex-shrink-0">{tc.id}</span>
                      <span className="flex-1 text-sm font-medium text-gray-900">{tc.title}</span>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <span className={`text-xs font-medium px-2 py-0.5 rounded-full border ${PRIORITY_COLORS[tc.priority]}`}>
                          {tc.priority}
                        </span>
                        <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${CATEGORY_COLORS[tc.category] || 'bg-gray-500/20 text-gray-400'}`}>
                          {tc.category}
                        </span>
                      </div>
                      <button
                        onClick={e => { e.stopPropagation(); toggleExpand(tc.id); }}
                        className="text-gray-400 hover:text-gray-600 flex-shrink-0 transition-colors"
                      >
                        {expandedCases.has(tc.id) ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                      </button>
                    </div>

                    <AnimatePresence>
                      {expandedCases.has(tc.id) && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
                          className="overflow-hidden"
                        >
                          <div className="px-4 pb-4 pt-3 grid grid-cols-1 md:grid-cols-2 gap-4"
                            style={{ borderTop: '1px solid hsl(var(--border))' }}>
                            <div>
                              <p className="text-xs text-gray-500 mb-1">Description</p>
                              <p className="text-sm text-gray-700">{tc.description}</p>
                              <p className="text-xs text-gray-500 mb-1 mt-3">Page URL</p>
                              <p className="text-xs font-mono text-indigo-600 truncate">{tc.pageUrl}</p>
                            </div>
                            <div>
                              <p className="text-xs text-gray-500 mb-1">Steps</p>
                              <ol className="space-y-1">
                                {tc.steps.map((s, i) => (
                                  <li key={i} className="text-sm text-gray-700 flex gap-2">
                                    <span className="text-gray-400 flex-shrink-0">{i+1}.</span>{s}
                                  </li>
                                ))}
                              </ol>
                              <p className="text-xs text-gray-500 mb-1 mt-3">Expected Result</p>
                              <p className="text-sm text-green-700">{tc.expectedResult}</p>
                            </div>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                ))}
              </div>

              {scriptError && (
                <div className="mt-4 flex items-start gap-2 rounded-xl p-4 text-sm text-red-400"
                  style={{ background: '#fef2f2', border: '1px solid #fecaca' }}>
                  <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />{scriptError}
                </div>
              )}
            </motion.div>
          )}

          {/* ─ Step 5: Scripts & Execute ─ */}
          {step === 'scripts' && (
            <motion.div key="scripts"
              initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -16 }}
            >
              {/* ── Code Preview Panel ── */}
              {Object.keys(scriptFiles).length > 0 && (() => {
                const filePaths = Object.keys(scriptFiles);
                const activeKey = filePaths[previewIndex] ?? filePaths[0] ?? '';
                return (
                  <div style={{ border: '1px solid hsl(var(--border))', borderRadius: 12, overflow: 'hidden', marginBottom: 20 }}>
                    {/* Panel header */}
                    <div style={{ padding: '10px 16px', background: 'hsl(var(--muted) / 0.5)', borderBottom: '1px solid hsl(var(--border))', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <span style={{ fontSize: 12, color: 'hsl(var(--muted-foreground))' }}>
                        {filePaths.length} files generated
                      </span>
                      <span style={{ fontSize: 11, color: '#6366f1', fontFamily: 'ui-monospace, monospace' }}>
                        preview before download
                      </span>
                    </div>
                    {/* File tabs */}
                    <div style={{ display: 'flex', overflowX: 'auto', borderBottom: '1px solid hsl(var(--border))', background: 'hsl(var(--card))' }}>
                      {filePaths.slice(0, 8).map((fp, i) => {
                        const name = fp.split('/').pop() ?? fp;
                        return (
                          <div key={i} onClick={() => setPreviewIndex(i)}
                            style={{ padding: '7px 12px', fontSize: 11, cursor: 'pointer', borderRight: '1px solid hsl(var(--border))', background: previewIndex === i ? '#eff6ff' : 'transparent', color: previewIndex === i ? 'hsl(var(--primary))' : 'hsl(var(--muted-foreground))', whiteSpace: 'nowrap', fontFamily: 'ui-monospace, monospace', flexShrink: 0 }}>
                            {name}
                          </div>
                        );
                      })}
                      {filePaths.length > 8 && (
                        <div style={{ padding: '7px 12px', fontSize: 11, color: 'hsl(var(--muted-foreground) / 0.7)', flexShrink: 0 }}>
                          +{filePaths.length - 8} more
                        </div>
                      )}
                    </div>
                    {/* Code preview */}
                    <pre
                      style={{ margin: 0, padding: 16, fontSize: 12, lineHeight: 1.6, fontFamily: 'ui-monospace, monospace', background: 'hsl(var(--muted) / 0.5)', overflowX: 'auto', overflowY: 'auto', maxHeight: 380, color: '#1f2937' }}
                      dangerouslySetInnerHTML={{ __html: highlightCode(scriptFiles[activeKey] ?? '') }}
                    />
                    {/* File path footer */}
                    <div style={{ padding: '6px 16px', fontSize: 11, color: 'hsl(var(--muted-foreground) / 0.7)', borderTop: '1px solid hsl(var(--border))', background: 'hsl(var(--card))', fontFamily: 'ui-monospace, monospace' }}>
                      {activeKey}
                    </div>
                  </div>
                );
              })()}
              {/* Header */}
              <div className="flex items-center justify-between mb-5">
                <div>
                  {(() => {
                    const fw = frameworkConfigs.find(c => c.id === frameworkConfigId);
                    const preset = findPreset(frameworkConfigId);
                    const display = fw
                      ? { name: fw.name, lang: fw.detectedLanguage ?? fw.language, tool: fw.detectedTool ?? fw.framework, pattern: fw.detectedPattern ?? 'POM' }
                      : preset
                        ? { name: preset.name, lang: preset.detectedLanguage, tool: preset.detectedTool, pattern: preset.detectedPattern }
                        : null;
                    return display ? (
                      <>
                        <div className="flex items-center gap-2 mb-1">
                          <h2 className="text-lg font-semibold text-gray-900">{display.name} Test Suite</h2>
                          <span className="text-xs px-2 py-0.5 rounded-full font-medium"
                            style={{ background: 'hsl(var(--primary) / 0.1)', color: 'hsl(var(--primary))' }}>{display.lang}</span>
                          <span className="text-xs px-2 py-0.5 rounded-full font-medium"
                            style={{ background: '#7c3aed15', color: '#6d28d9' }}>{display.tool}</span>
                          <span className="text-xs px-2 py-0.5 rounded-full font-medium"
                            style={{ background: '#0891b215', color: '#0e7490' }}>{display.pattern}</span>
                        </div>
                        <p className="text-sm text-gray-500">
                          {display.pattern} · 6 test categories (smoke, functional, negative, edge, security, a11y) ·
                          Generated using <span className="font-medium text-indigo-600">{display.name}</span> patterns
                        </p>
                      </>
                    ) : (
                      <>
                        <h2 className="text-lg font-semibold text-gray-900">POM Playwright Test Suite</h2>
                        <p className="text-sm text-gray-500">
                          Page Object Model · 6 test categories (smoke, functional, negative, edge, security, a11y) ·
                          Runs in <span className="font-medium text-indigo-600">headed Chrome</span>
                        </p>
                      </>
                    );
                  })()}
                </div>
                <div className="flex items-center gap-3">
                  <button
                    onClick={downloadScript}
                    className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm transition-colors"
                    style={{ background: 'hsl(var(--muted) / 0.5)', border: '1px solid hsl(var(--border))', color: 'hsl(var(--foreground))' }}
                  >
                    <Download className="w-4 h-4" />
                    {Object.keys(scriptFiles).length > 0 ? 'Download ZIP' : 'Download'}
                  </button>
                  <button
                    onClick={() => setStep('testcases')}
                    className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm transition-colors"
                    style={{ background: 'hsl(var(--muted) / 0.5)', border: '1px solid hsl(var(--border))', color: 'hsl(var(--foreground))' }}
                  >
                    <RefreshCw className="w-4 h-4" /> Regenerate
                  </button>
                  {/* In-app headed test execution removed by product decision —
                      the recommended flow is Download ZIP and run the suite in
                      the user's own Playwright project. The /execute endpoint
                      and underlying runner remain available server-side, but no
                      UI affordance is exposed. */}
                </div>
              </div>

              {/* File summary badges */}
              {Object.keys(scriptFiles).length > 0 && (() => {
                const cats = ['smoke', 'functional', 'negative', 'edge', 'security', 'accessibility'];
                const catColors: Record<string, string> = {
                  smoke: '#6366f1', functional: '#2563eb', negative: '#dc2626',
                  edge: '#d97706', security: '#7c3aed', accessibility: '#059669',
                };
                return (
                  <div className="flex flex-wrap gap-2 mb-4">
                    {cats.map(cat => {
                      const cnt = Object.keys(scriptFiles).filter(f => f.includes(`/specs/${cat}/`)).length;
                      if (!cnt) return null;
                      return (
                        <span key={cat} className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium text-white"
                          style={{ background: catColors[cat] }}>
                          <FileCode2 className="w-3 h-3" /> {cnt} {cat}
                        </span>
                      );
                    })}
                    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium"
                      style={{ background: 'hsl(var(--muted))', color: 'hsl(var(--foreground))', border: '1px solid hsl(var(--border))' }}>
                      {Object.keys(scriptFiles).filter(f => f.includes('/pages/')).length} page objects
                    </span>
                    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium"
                      style={{ background: 'hsl(var(--muted))', color: 'hsl(var(--foreground))', border: '1px solid hsl(var(--border))' }}>
                      {Object.keys(scriptFiles).filter(f => f.includes('/helpers/')).length} helpers
                    </span>
                  </div>
                );
              })()}

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">

                {/* File Tree */}
                <div className="rounded-2xl overflow-hidden"
                  style={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }}>
                  <div className="flex items-center gap-2 px-4 py-3"
                    style={{ background: 'hsl(var(--muted) / 0.5)', borderBottom: '1px solid hsl(var(--border))' }}>
                    <Layers className="w-4 h-4 text-indigo-500" />
                    <span className="text-sm font-semibold text-gray-700">Files</span>
                    <span className="ml-auto text-xs text-gray-400 font-mono">{Object.keys(scriptFiles).length || (script ? 1 : 0)}</span>
                  </div>
                  <div className="overflow-y-auto" style={{ maxHeight: '560px' }}>
                    {Object.keys(scriptFiles).length > 0 ? (() => {
                      // Group files by directory
                      const groups: Record<string, string[]> = {};
                      for (const f of Object.keys(scriptFiles).sort()) {
                        const parts = f.split('/');
                        const dir = parts.length > 1 ? parts.slice(0, -1).join('/') : '';
                        if (!groups[dir]) groups[dir] = [];
                        groups[dir].push(f);
                      }
                      return Object.entries(groups).map(([dir, groupFiles]) => (
                        <div key={dir}>
                          {dir && (
                            <div className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-gray-400"
                              style={{ background: 'hsl(var(--muted) / 0.5)', borderBottom: '1px solid hsl(var(--muted))' }}>
                              {dir}
                            </div>
                          )}
                          {groupFiles.map(f => {
                            const fname = f.split('/').pop() || f;
                            const isSelected = f === selectedFile;
                            const isSpec = f.endsWith('.spec.ts');
                            const isPage = f.includes('/pages/');
                            const isHelper = f.includes('/helpers/');
                            const isConfig = f === 'playwright.config.ts' || f === 'tsconfig.json';
                            const iconColor = isSpec ? 'hsl(var(--primary))' : isPage ? '#7c3aed' : isHelper ? '#059669' : isConfig ? '#d97706' : 'hsl(var(--muted-foreground))';
                            return (
                              <button key={f} onClick={() => setSelectedFile(f)}
                                className="w-full text-left flex items-center gap-2 px-3 py-2 text-xs transition-colors"
                                style={{
                                  background: isSelected ? '#eff6ff' : 'transparent',
                                  borderLeft: isSelected ? '2px solid #6366f1' : '2px solid transparent',
                                  color: isSelected ? '#1e40af' : 'hsl(var(--foreground))',
                                }}>
                                <FileCode2 className="w-3 h-3 flex-shrink-0" style={{ color: iconColor }} />
                                <span className="truncate font-mono">{fname}</span>
                              </button>
                            );
                          })}
                        </div>
                      ));
                    })() : script ? (
                      <button onClick={() => setSelectedFile('auto.spec.ts')}
                        className="w-full text-left flex items-center gap-2 px-3 py-2 text-xs"
                        style={{ background: '#eff6ff', borderLeft: '2px solid #6366f1', color: '#1e40af' }}>
                        <FileCode2 className="w-3 h-3 flex-shrink-0 text-indigo-500" />
                        <span className="font-mono">auto.spec.ts</span>
                      </button>
                    ) : (
                      <p className="text-xs text-gray-400 p-4 italic">No files generated yet</p>
                    )}
                  </div>
                </div>

                {/* Monaco Editor */}
                <div className="rounded-2xl overflow-hidden lg:col-span-2"
                  style={{ background: '#1e1e1e', border: '1px solid hsl(var(--border))' }}>
                  <div className="flex items-center justify-between px-4 py-3"
                    style={{ background: 'hsl(var(--card))', borderBottom: '1px solid hsl(var(--border))' }}>
                    <div className="flex items-center gap-2">
                      <FileCode2 className="w-4 h-4 text-indigo-500" />
                      <span className="text-sm font-medium text-gray-700 font-mono">
                        {selectedFile || 'auto.spec.ts'}
                      </span>
                    </div>
                    <span className="text-xs text-gray-500">TypeScript · Playwright Test</span>
                  </div>
                  <Editor
                    height="540px"
                    language="typescript"
                    theme="vs-dark"
                    value={
                      Object.keys(scriptFiles).length > 0
                        ? (scriptFiles[selectedFile] || '')
                        : script
                    }
                    onChange={v => {
                      if (Object.keys(scriptFiles).length > 0 && selectedFile) {
                        setScriptFiles(prev => ({ ...prev, [selectedFile]: v || '' }));
                      } else {
                        setScript(v || '');
                      }
                    }}
                    options={{
                      fontSize: 12,
                      minimap: { enabled: false },
                      lineNumbers: 'on',
                      wordWrap: 'on',
                      scrollBeyondLastLine: false,
                      tabSize: 2,
                      padding: { top: 12, bottom: 12 },
                    }}
                  />
                </div>
              </div>

              {/* Results + terminal (below editor) */}
              <div className="mt-5 flex flex-col gap-4">
                {execResults && (
                  <div className="rounded-2xl p-5"
                    style={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }}>
                    <h3 className="text-sm font-semibold mb-4 flex items-center gap-2 text-gray-900">
                      <CheckCircle2 className="w-4 h-4 text-green-500" /> Test Results
                    </h3>
                    <div className="grid grid-cols-4 gap-3 mb-4">
                      {[
                        { label: 'Total',   v: execResults.total,   c: 'text-gray-900'   },
                        { label: 'Passed',  v: execResults.passed,  c: 'text-green-600'  },
                        { label: 'Failed',  v: execResults.failed,  c: 'text-red-500'    },
                        { label: 'Skipped', v: execResults.skipped, c: 'text-yellow-600' },
                      ].map(s => (
                        <div key={s.label} className="rounded-xl p-3 text-center"
                          style={{ background: 'hsl(var(--muted) / 0.5)', border: '1px solid hsl(var(--border))' }}>
                          <div className={`text-2xl font-bold ${s.c}`}>{s.v}</div>
                          <div className="text-xs text-gray-500 mt-0.5">{s.label}</div>
                        </div>
                      ))}
                    </div>
                    <div className="space-y-1.5 max-h-52 overflow-y-auto">
                      {execResults.tests.map((t, i) => (
                        <div key={i} className="flex items-center gap-2 text-sm">
                          {t.status === 'passed'
                            ? <CheckCircle2 className="w-3.5 h-3.5 text-green-400 flex-shrink-0" />
                            : t.status === 'failed'
                            ? <XCircle className="w-3.5 h-3.5 text-red-400 flex-shrink-0" />
                            : <AlertCircle className="w-3.5 h-3.5 text-yellow-400 flex-shrink-0" />}
                          <span className={`flex-1 truncate ${t.status === 'passed' ? 'text-gray-700' : t.status === 'failed' ? 'text-red-600' : 'text-yellow-600'}`}>
                            {t.title}
                          </span>
                          <span className="text-xs text-gray-600 flex-shrink-0">{(t.duration / 1000).toFixed(1)}s</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="rounded-2xl overflow-hidden"
                  style={{ background: '#1a1a2e', border: '1px solid hsl(var(--border))' }}>
                  <div className="flex items-center gap-2 px-4 py-3"
                    style={{ background: 'hsl(var(--card))', borderBottom: '1px solid hsl(var(--border))' }}>
                    <Terminal className="w-4 h-4 text-gray-500" />
                    <span className="text-sm font-medium text-gray-700">Terminal Output</span>
                    {isExecuting && <Loader2 className="w-3.5 h-3.5 text-indigo-500 animate-spin ml-auto" />}
                  </div>
                  <div ref={logsRef} className="p-4 overflow-y-auto font-mono text-xs text-gray-400 space-y-0.5"
                    style={{ height: '240px' }}
                  >
                    {execLogs.length === 0 && !isExecuting ? (
                      <p className="text-gray-500">Download the generated suite as a ZIP and run it inside your own Playwright project — terminal output from those runs is not streamed back here.</p>
                    ) : (
                      execLogs.map((log, i) => (
                        <div key={i}
                          className={`whitespace-pre-wrap break-all ${
                            log.includes('passed') || log.includes('✓') ? 'text-green-400' :
                            log.includes('failed') || log.includes('✗') || log.includes('Error') ? 'text-red-400' :
                            'text-gray-400'
                          }`}
                        >{log}</div>
                      ))
                    )}
                  </div>
                </div>

                {execError && (
                  <div className="flex items-start gap-2 rounded-xl p-4 text-sm text-red-400"
                    style={{ background: '#fef2f2', border: '1px solid #fecaca' }}>
                    <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />{execError}
                  </div>
                )}
              </div>
            </motion.div>
          )}

        </AnimatePresence>
      </div>
      </div>
    </div>
  );
}
