import { useState, useEffect, useCallback, useMemo } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { DashboardHeader } from "@/components/dashboard/header";
import { useProject } from "@/contexts/ProjectContext";
import { tmOverviewQueryKey } from "@/lib/tm-overview";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Loader2, ClipboardList, BarChart3, Layers, Link2, Globe, Settings2, CheckCircle2, Target, AlertTriangle, Clock, Plus, RefreshCw } from "lucide-react";
import { fetchTmOverview } from "../lib/tm-overview-api";

// ─── Types ────────────────────────────────────────────────────────────────────

interface OverviewData {
  metrics: Metrics;
  trends: TrendPoint[];
  flakiness: FlakinessEntry[];
  history: HistoryEntry[];
  fetchedAt?: number;
  source?: "tm-api" | "legacy-fallback";
}

interface Metrics {
  totalRuns: number;
  executionsLast30?: number;
  passRate30: number;
  passedLast30: number;
  failedLast30: number;
  skippedLast30?: number;
  totalTests: number;
  flakyCount: number;
  suiteCount: number;
  requirementCount: number;
  linkedTests: number;
  /** Requirements that have at least one linked test */
  requirementsWithCoverage?: number;
  coverage: number;
  avgDurationSec: number;
  lastRunAt: number | null;
}

interface TrendPoint {
  date: string;
  passed: number;
  failed: number;
  skipped?: number;
  total: number;
  passRate: number | null;
}

interface FlakinessEntry {
  testId: string;
  testName: string;
  stability: number;
  isFlaky: boolean;
  runCount: number;
  lastStatus: string;
  lastRunAt: number;
}

interface HistoryEntry {
  id: string;
  testId: string;
  testName: string;
  suiteId?: string;
  status: string;
  duration: number;
  environment: string;
  errorMessage?: string;
  runAt: number;
}

interface Suite {
  id: string;
  name: string;
  type: string;
  testIds: string[];
  tags: string[];
  createdAt: number;
  updatedAt: number;
}

interface Requirement {
  id: string;
  title: string;
  description?: string;
  source: string;
  ticketId?: string;
  priority: string;
  createdAt: number;
  linkedTests?: Array<{ testId: string; testName: string; lastStatus?: string }>;
  coverage?: string;
}

interface RTMRow {
  id: string;
  title: string;
  priority: string;
  ticketId?: string;
  tests: Array<{ testId: string; testName: string; lastStatus: string; lastRunAt?: number }>;
  coverage: string;
}

interface Environment {
  id: string;
  name: string;
  baseUrl: string;
  type: string;
  isDefault: boolean;
  createdAt: number;
}

// ─── Sparkline SVG ────────────────────────────────────────────────────────────

const SPARKLINE_COLORS: Record<string, string> = {
  emerald: '#10b981',
  amber: '#f59e0b',
  red: '#ef4444',
  blue: '#3b82f6',
  cyan: '#06b6d4',
};

function Sparkline({ data, color = 'emerald', height = 32, width = 120 }: {
  data: number[]; color?: keyof typeof SPARKLINE_COLORS; height?: number; width?: number;
}) {
  if (data.length === 0) return <div style={{ width, height }} className="opacity-20 bg-muted rounded" />;
  const max = Math.max(...data, 1);
  if (data.length === 1) {
    const v = data[0];
    const y = height - (v / max) * height;
    const cx = width / 2;
    return (
      <svg width={width} height={height} className="overflow-visible">
        <circle cx={cx} cy={y} r={3} fill={SPARKLINE_COLORS[color] ?? SPARKLINE_COLORS.emerald} />
      </svg>
    );
  }
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * width;
    const y = height - (v / max) * height;
    return `${x},${y}`;
  }).join(' ');
  return (
    <svg width={width} height={height} className="overflow-visible">
      <polyline points={pts} fill="none" stroke={SPARKLINE_COLORS[color] ?? SPARKLINE_COLORS.emerald} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

function kpiValueClass(metric: 'passRate' | 'coverage' | 'flaky', value: number): string {
  if (metric === 'passRate') {
    if (value >= 80) return 'text-emerald-400';
    if (value >= 60) return 'text-amber-400';
    return 'text-red-400';
  }
  if (metric === 'coverage') return value >= 80 ? 'text-emerald-400' : 'text-amber-400';
  return value === 0 ? 'text-emerald-400' : 'text-amber-400';
}

function sparklineColor(metric: 'passRate' | 'coverage' | 'flaky', value: number): keyof typeof SPARKLINE_COLORS {
  if (metric === 'passRate') {
    if (value >= 80) return 'emerald';
    if (value >= 60) return 'amber';
    return 'red';
  }
  if (metric === 'coverage') return value >= 80 ? 'emerald' : 'amber';
  return value === 0 ? 'emerald' : 'amber';
}

function KpiCard({ label, value, sub, trend, trendColor, valueClass, icon: Icon, iconBg, iconColor }: {
  label: string; value: string | number; sub?: string;
  trend?: number[]; trendColor?: keyof typeof SPARKLINE_COLORS;
  valueClass?: string;
  icon: React.ComponentType<{ className?: string }>;
  iconBg: string;
  iconColor: string;
}) {
  return (
    <Card className="bg-card/50 border-border/50">
      <CardContent className="p-6">
        <div className="flex items-center justify-between gap-4">
          <div className="flex-1 min-w-0">
            <p className="text-sm text-muted-foreground">{label}</p>
            <p className={`text-3xl font-bold mt-1 ${valueClass ?? 'text-foreground'}`}>{value}</p>
            {sub && <p className="text-xs text-muted-foreground mt-1">{sub}</p>}
            {trend && trend.length >= 1 && (
              <div className="mt-3">
                <Sparkline data={trend} color={trendColor ?? 'emerald'} />
              </div>
            )}
          </div>
          <div className={`w-12 h-12 rounded-xl ${iconBg} flex items-center justify-center shrink-0`}>
            <Icon className={`w-6 h-6 ${iconColor}`} />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function TestManagementPage() {
  const { selectedProjectId, devxContext } = useProject();
  const [activeTab, setActiveTab] = useState<'overview' | 'suites' | 'rtm' | 'environments' | 'cicd'>('overview');

  // ── Overview (loaded via react-query for live refresh) ──

  // ── Suites state ──
  const [suites, setSuites] = useState<Suite[]>([]);
  const [newSuiteName, setNewSuiteName] = useState('');
  const [newSuiteType, setNewSuiteType] = useState('regression');
  const [suiteRunLog, setSuiteRunLog] = useState<{ suiteId: string; lines: string[]; status: string }>({ suiteId: '', lines: [], status: '' });
  const [runningSuiteId, setRunningSuiteId] = useState<string | null>(null);

  // ── RTM state ──
  const [rtm, setRtm] = useState<RTMRow[]>([]);
  const [newReqTitle, setNewReqTitle] = useState('');
  const [newReqPriority, setNewReqPriority] = useState('P2');
  const [newReqTicket, setNewReqTicket] = useState('');
  const [linkTestId, setLinkTestId] = useState('');
  const [linkTestName, setLinkTestName] = useState('');
  const [linkReqId, setLinkReqId] = useState('');

  // ── Environments state ──
  const [environments, setEnvironments] = useState<Environment[]>([]);
  const [newEnvName, setNewEnvName] = useState('');
  const [newEnvUrl, setNewEnvUrl] = useState('');
  const [newEnvType, setNewEnvType] = useState<'dev' | 'staging' | 'production'>('staging');

  // ── CI/CD state ──
  const [cicdType, setCicdType] = useState<'github' | 'azure' | 'gitlab' | 'jenkins'>('github');
  const [cicdYaml, setCicdYaml] = useState('');
  const [cicdCopied, setCicdCopied] = useState(false);
  const [cicdProjectName, setCicdProjectName] = useState('my-tests');
  const [cicdSuiteType, setCicdSuiteType] = useState('');

  // ── Data loading ────────────────────────────────────────────────────────────

  const tmQuery = useMemo(() => {
    const params = new URLSearchParams();
    if (selectedProjectId) params.set('projectId', selectedProjectId);
    if (devxContext.sdlcProjectId) params.set('sdlcProjectId', devxContext.sdlcProjectId);
    const qs = params.toString();
    return qs ? `?${qs}` : '';
  }, [selectedProjectId, devxContext.sdlcProjectId]);

  const overviewQueryKey = tmOverviewQueryKey(tmQuery);

  const fetchOverview = useCallback(async (): Promise<OverviewData & { fetchedAt: number }> => {
    const data = await fetchTmOverview(tmQuery, selectedProjectId, devxContext.sdlcProjectId);
    return {
      metrics: data.metrics as Metrics,
      trends: data.trends as TrendPoint[],
      flakiness: data.flakiness as FlakinessEntry[],
      history: data.history as HistoryEntry[],
      fetchedAt: data.fetchedAt,
      source: data.source,
    };
  }, [tmQuery, selectedProjectId, devxContext.sdlcProjectId]);

  const {
    data: overview,
    isLoading: overviewLoading,
    isFetching: overviewFetching,
    refetch: refetchOverview,
    dataUpdatedAt,
  } = useQuery({
    queryKey: overviewQueryKey,
    queryFn: fetchOverview,
    enabled: activeTab === 'overview',
    refetchInterval: activeTab === 'overview' ? 5_000 : false,
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: true,
    staleTime: 0,
    gcTime: 0,
    structuralSharing: false,
  });

  useEffect(() => {
    const onUpdated = () => {
      void refetchOverview();
    };
    window.addEventListener('tm-overview-updated', onUpdated);
    return () => window.removeEventListener('tm-overview-updated', onUpdated);
  }, [refetchOverview]);

  const metrics = overview?.metrics ?? null;
  const trends = overview?.trends ?? [];
  const flakiness = overview?.flakiness ?? [];
  const history = overview?.history ?? [];
  const loadingMetrics = overviewLoading && !overview;
  const usingLegacyOverview = overview?.source === "legacy-fallback";

  const loadSuites = useCallback(async () => {
    const data = await fetch('/api/tm/suites').then(r => r.json()).catch(() => []);
    setSuites(data);
  }, []);

  const loadRTM = useCallback(async () => {
    const data = await fetch('/api/tm/rtm').then(r => r.json()).catch(() => []);
    setRtm(data);
  }, []);

  const loadEnvironments = useCallback(async () => {
    const data = await fetch('/api/tm/environments').then(r => r.json()).catch(() => []);
    setEnvironments(data);
  }, []);

  useEffect(() => {
    if (activeTab === 'suites') loadSuites();
    else if (activeTab === 'rtm') loadRTM();
    else if (activeTab === 'environments') loadEnvironments();
  }, [activeTab, loadSuites, loadRTM, loadEnvironments]);

  // ── Suite actions ───────────────────────────────────────────────────────────

  const createSuite = async () => {
    if (!newSuiteName.trim()) return;
    await fetch('/api/tm/suites', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newSuiteName.trim(), type: newSuiteType }),
    });
    setNewSuiteName('');
    loadSuites();
  };

  const deleteSuite = async (id: string) => {
    await fetch(`/api/tm/suites/${id}`, { method: 'DELETE' });
    loadSuites();
  };

  const runSuite = (suite: Suite) => {
    setRunningSuiteId(suite.id);
    setSuiteRunLog({ suiteId: suite.id, lines: [`▶ Starting suite: ${suite.name}`], status: 'running' });

    const es = new EventSource(`/api/tm/suites/${suite.id}/run`);
    // Note: POST with SSE requires a different approach — use fetch with streaming
    fetch(`/api/tm/suites/${suite.id}/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    }).then(async res => {
      const reader = res.body!.getReader();
      const dec = new TextDecoder();
      let buf = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const parts = buf.split('\n\n'); buf = parts.pop() || '';
        for (const part of parts) {
          const line = part.replace(/^data: /, '').trim();
          if (!line) continue;
          try {
            const evt = JSON.parse(line);
            if (evt.type === 'test_start')  setSuiteRunLog(prev => ({ ...prev, lines: [...prev.lines, `⏳ Running: ${evt.testId}`] }));
            if (evt.type === 'test_done')   setSuiteRunLog(prev => ({ ...prev, lines: [...prev.lines, `${evt.status === 'passed' ? '✅' : '❌'} ${evt.testName} (${Math.round(evt.duration/1000)}s)`] }));
            if (evt.type === 'suite_done') {
              setSuiteRunLog(prev => ({ ...prev, status: 'done', lines: [...prev.lines, `\n✅ ${evt.passed} passed  ❌ ${evt.failed} failed`] }));
              setRunningSuiteId(null);
              refetchOverview();
            }
            if (evt.type === 'log') setSuiteRunLog(prev => ({ ...prev, lines: [...prev.lines.slice(-50)] })); // trim log
          } catch {}
        }
      }
    }).catch(err => {
      setSuiteRunLog(prev => ({ ...prev, status: 'error', lines: [...prev.lines, `❌ Error: ${err.message}`] }));
      setRunningSuiteId(null);
    });
  };

  // ── RTM actions ─────────────────────────────────────────────────────────────

  const createRequirement = async () => {
    if (!newReqTitle.trim()) return;
    await fetch('/api/tm/requirements', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: newReqTitle.trim(), priority: newReqPriority, ticketId: newReqTicket || undefined }),
    });
    setNewReqTitle(''); setNewReqTicket('');
    loadRTM();
  };

  const deleteRequirement = async (id: string) => {
    await fetch(`/api/tm/requirements/${id}`, { method: 'DELETE' });
    loadRTM();
  };

  const linkTest = async () => {
    if (!linkReqId || !linkTestId.trim()) return;
    await fetch('/api/tm/rtm/link', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requirementId: linkReqId, testId: linkTestId.trim(), testName: linkTestName.trim() || linkTestId.trim() }),
    });
    setLinkTestId(''); setLinkTestName(''); setLinkReqId('');
    loadRTM();
  };

  const unlinkTest = async (requirementId: string, testId: string) => {
    await fetch('/api/tm/rtm/link', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requirementId, testId }),
    });
    loadRTM();
  };

  // ── Environment actions ──────────────────────────────────────────────────────

  const createEnvironment = async () => {
    if (!newEnvName.trim() || !newEnvUrl.trim()) return;
    await fetch('/api/tm/environments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newEnvName.trim(), baseUrl: newEnvUrl.trim(), type: newEnvType }),
    });
    setNewEnvName(''); setNewEnvUrl('');
    loadEnvironments();
  };

  const deleteEnvironment = async (id: string) => {
    await fetch(`/api/tm/environments/${id}`, { method: 'DELETE' });
    loadEnvironments();
  };

  const setDefaultEnvironment = async (id: string) => {
    await fetch(`/api/tm/environments/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isDefault: true }),
    });
    loadEnvironments();
  };

  // ── CI/CD actions ────────────────────────────────────────────────────────────

  const generateCICD = async () => {
    const data = await fetch('/api/tm/cicd/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: cicdType, projectName: cicdProjectName, suiteType: cicdSuiteType || undefined }),
    }).then(r => r.json());
    setCicdYaml(data.yaml || '');
  };

  const copyCICD = () => {
    navigator.clipboard.writeText(cicdYaml);
    setCicdCopied(true);
    setTimeout(() => setCicdCopied(false), 2000);
  };

  // ── Coverage badge ───────────────────────────────────────────────────────────

  const coverageBadge = (cov: string) => {
    if (cov === 'covered')  return <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">✅ Covered</span>;
    if (cov === 'failing')  return <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-500/20 text-red-400 border border-red-500/30">❌ Failing</span>;
    if (cov === 'partial')  return <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/20 text-amber-400 border border-amber-500/30">⚠ Partial</span>;
    return <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-muted text-muted-foreground">○ No Tests</span>;
  };

  return (
    <>
      <DashboardHeader />
      <main className="flex-1 overflow-y-auto p-6">
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
            <Link href="/dashboard">
              <button className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-muted hover:bg-muted/80 text-muted-foreground hover:text-foreground text-xs transition-colors border border-border">
                ← Dashboard
              </button>
            </Link>
            <div>
                <h1 className="text-2xl font-bold text-foreground flex items-center gap-3">
                  <ClipboardList className="w-7 h-7 text-primary" />
                  Test Management
                </h1>
                <p className="text-muted-foreground mt-1">Coverage • Traceability • Suites • Environments • CI/CD</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {metrics && (
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 inline-block" />
                  {metrics.passRate30}% pass rate
                </span>
                <span>{metrics.executionsLast30 ?? metrics.totalRuns} runs (30d)</span>
                {overviewFetching && (
                  <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" />
                )}
              </div>
            )}
            <Button asChild>
              <Link href="/recorder">
                <Plus className="w-4 h-4 mr-2" />
                Record New Test
              </Link>
            </Button>
          </div>
        </div>

          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as typeof activeTab)} className="space-y-6">
            <TabsList className="bg-card border">
              <TabsTrigger
                value="overview"
                data-testid="tab-overview"
                className="data-[state=active]:bg-blue-600 data-[state=active]:text-white data-[state=active]:shadow-sm data-[state=active]:border-blue-600"
              >
                <BarChart3 className="w-4 h-4 mr-2" />
                Overview
              </TabsTrigger>
              <TabsTrigger
                value="suites"
                data-testid="tab-suites"
                className="data-[state=active]:bg-blue-600 data-[state=active]:text-white data-[state=active]:shadow-sm data-[state=active]:border-blue-600"
              >
                <Layers className="w-4 h-4 mr-2" />
                Suites
              </TabsTrigger>
              <TabsTrigger
                value="rtm"
                data-testid="tab-rtm"
                className="data-[state=active]:bg-blue-600 data-[state=active]:text-white data-[state=active]:shadow-sm data-[state=active]:border-blue-600"
              >
                <Link2 className="w-4 h-4 mr-2" />
                RTM
              </TabsTrigger>
              <TabsTrigger
                value="environments"
                data-testid="tab-environments"
                className="data-[state=active]:bg-blue-600 data-[state=active]:text-white data-[state=active]:shadow-sm data-[state=active]:border-blue-600"
              >
                <Globe className="w-4 h-4 mr-2" />
                Environments
              </TabsTrigger>
              <TabsTrigger
                value="cicd"
                data-testid="tab-cicd"
                className="data-[state=active]:bg-blue-600 data-[state=active]:text-white data-[state=active]:shadow-sm data-[state=active]:border-blue-600"
              >
                <Settings2 className="w-4 h-4 mr-2" />
                CI/CD
              </TabsTrigger>
            </TabsList>

            <TabsContent value="overview" className="space-y-6">
            {usingLegacyOverview && (
              <Card className="rounded-2xl shadow-sm border border-amber-500/40 border-l-[3px] border-l-amber-500 bg-amber-500/5">
                <CardContent className="py-4 px-5 text-sm text-muted-foreground">
                  <p className="font-medium text-foreground flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 text-amber-500" />
                    Overview built from legacy execution APIs
                  </p>
                  <p className="mt-1 text-xs">
                    <code className="text-xs">/api/tm/overview</code> failed or is unavailable on this server. Metrics are
                    derived from <code className="text-xs">/api/execution-runs</code> when a project is selected.
                    Suites, RTM, and environments still need the full Test Management backend.
                  </p>
                </CardContent>
              </Card>
            )}
            {loadingMetrics ? (
              <div className="flex items-center justify-center h-40 text-muted-foreground text-sm gap-2">
                <Loader2 className="w-5 h-5 animate-spin" />
                Loading metrics...
              </div>
            ) : metrics ? (
              <>
                {/* KPI Cards */}
                <div
                  key={`overview-kpi-${overview?.fetchedAt ?? dataUpdatedAt}`}
                  className="grid grid-cols-2 md:grid-cols-4 gap-4"
                >
                  <KpiCard
                    label="Pass Rate (30d)"
                    value={`${metrics.passRate30}%`}
                    sub={(() => {
                      const sk = metrics.skippedLast30 ?? 0;
                      const base = `${metrics.passedLast30} passed / ${metrics.failedLast30} failed`;
                      return sk > 0 ? `${base} / ${sk} skipped` : base;
                    })()}
                    trend={trends.map((t) => t.passRate ?? 0)}
                    trendColor={sparklineColor('passRate', metrics.passRate30)}
                    valueClass={kpiValueClass('passRate', metrics.passRate30)}
                    icon={CheckCircle2}
                    iconBg="bg-emerald-500/20"
                    iconColor="text-emerald-400"
                  />
                  <KpiCard
                    label="Coverage"
                    value={`${metrics.coverage}%`}
                    sub={
                      metrics.requirementCount > 0
                        ? `${metrics.requirementsWithCoverage ?? 0} of ${metrics.requirementCount} requirements with linked tests · ${metrics.linkedTests} linked test${metrics.linkedTests === 1 ? '' : 's'}`
                        : 'Add requirements in RTM to track coverage'
                    }
                    valueClass={kpiValueClass('coverage', metrics.coverage)}
                    icon={Target}
                    iconBg="bg-cyan-500/20"
                    iconColor="text-cyan-400"
                  />
                  <KpiCard
                    label="Flaky Tests"
                    value={metrics.flakyCount}
                    sub={`of ${metrics.totalTests} total tests`}
                    valueClass={kpiValueClass('flaky', metrics.flakyCount)}
                    icon={AlertTriangle}
                    iconBg="bg-amber-500/20"
                    iconColor="text-amber-400"
                  />
                  <KpiCard
                    label="Avg Duration"
                    value={`${metrics.avgDurationSec}s`}
                    sub={`${metrics.executionsLast30 ?? metrics.totalRuns} executions (30d)`}
                    icon={Clock}
                    iconBg="bg-violet-500/20"
                    iconColor="text-violet-400"
                  />
                </div>

                {/* Trend Chart */}
                <Card
                  key={`overview-chart-${overview?.fetchedAt ?? dataUpdatedAt}`}
                  className="bg-card/50 border-border/50 border-l-[3px] border-l-blue-500"
                >
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between">
                      <div>
                        <CardTitle className="text-base">Pass Rate Trend (Last 30 Days)</CardTitle>
                        <CardDescription>
                          Daily pass/fail breakdown
                          {dataUpdatedAt > 0 && (
                            <span className="ml-2 text-muted-foreground/70">
                              · Updated {new Date(dataUpdatedAt).toLocaleTimeString()}
                            </span>
                          )}
                        </CardDescription>
                      </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-8 text-xs"
                        onClick={() => refetchOverview()}
                        disabled={overviewFetching}
                      >
                        <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${overviewFetching ? 'animate-spin' : ''}`} />
                        Refresh
                      </Button>
                      <span className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1.5"><span className="w-3 h-1 bg-emerald-400 rounded inline-block" /> Passed</span>
                      <span className="flex items-center gap-1.5"><span className="w-3 h-1 bg-red-400 rounded inline-block" /> Failed</span>
                      <span className="flex items-center gap-1.5"><span className="w-3 h-1 bg-slate-400 rounded inline-block" /> Skipped</span>
                      </span>
                    </div>
                    </div>
                  </CardHeader>
                  <CardContent>
                  <div className="relative h-32">
                    {(() => {
                      const trendExecutions = trends.reduce((s, t) => s + (t.total ?? 0), 0);
                      if (!Array.isArray(trends) || trends.length === 0 || trendExecutions === 0) {
                        return (
                          <div className="flex flex-col items-center justify-center h-full text-muted-foreground/70 text-sm gap-1 px-4 text-center">
                            <span>No execution data for this period.</span>
                            {selectedProjectId ? (
                              <span className="text-xs text-muted-foreground/80">
                                Runs from Execution Mode / functional testing appear here when tied to this project.
                              </span>
                            ) : (
                              <span className="text-xs text-muted-foreground/80">
                                Select a project in the header or run tests from Test Library / Recorder.
                              </span>
                            )}
                          </div>
                        );
                      }
                      const maxTotal = Math.max(...trends.map((t) => t.total), 1);
                      const W = 800;
                      const H = 128;
                      const denom = Math.max(trends.length - 1, 1);
                      const step = W / denom;
                      const yAt = (count: number) => H - (count / maxTotal) * H;
                      const passedPts = trends.map((t, i) => `${i * step},${yAt(t.passed)}`).join(' ');
                      const failedPts = trends.map((t, i) => `${i * step},${yAt(t.failed)}`).join(' ');
                      const skippedPts = trends
                        .map((t, i) => `${i * step},${yAt(t.skipped ?? 0)}`)
                        .join(' ');
                      return (
                        <svg width="100%" height="100%" viewBox="0 0 800 148" preserveAspectRatio="none" className="overflow-visible">
                          <polyline points={passedPts} fill="none" stroke="#10b981" strokeWidth="2" strokeLinejoin="round" />
                          <polyline points={failedPts} fill="none" stroke="#ef4444" strokeWidth="2" strokeLinejoin="round" />
                          {(trends.some((t) => (t.skipped ?? 0) > 0)) && (
                            <polyline points={skippedPts} fill="none" stroke="#94a3b8" strokeWidth="2" strokeLinejoin="round" strokeDasharray="4 3" />
                          )}
                          {trends.map((t, i) => {
                            if (i % 7 !== 0) return null;
                            return (
                              <text key={t.date} x={i * step} y={H + 16} fontSize="9" className="fill-muted-foreground" textAnchor="middle">
                                {t.date.slice(5)}
                              </text>
                            );
                          })}
                        </svg>
                      );
                    })()}
                  </div>
                  </CardContent>
                </Card>

                {/* Two-column: Flakiness + Recent Runs */}
                <div className="grid grid-cols-2 gap-4">

                  {/* Flakiness Table */}
                  <Card className="bg-card/50 border-border/50 border-l-[3px] border-l-amber-500 overflow-hidden">
                    <CardHeader className="py-3 px-4 border-b border-border flex-row items-center justify-between space-y-0">
                      <CardTitle className="text-sm font-bold flex items-center gap-2">
                        <AlertTriangle className="w-4 h-4 text-amber-400" />
                        Flakiness Report
                      </CardTitle>
                      <span className="text-[10px] text-muted-foreground">Stability based on last 10 runs</span>
                    </CardHeader>
                    <CardContent className="p-0">
                    <div className="overflow-auto max-h-52">
                      {flakiness.length === 0 ? (
                        <div className="p-4 text-xs text-muted-foreground text-center">No history yet</div>
                      ) : flakiness.map(f => (
                        <div key={f.testId} className="flex items-center gap-3 px-4 py-2.5 border-b border-border/60 hover:bg-muted/40 transition-colors">
                          <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${f.stability >= 80 ? 'bg-emerald-400' : f.stability >= 50 ? 'bg-amber-400' : 'bg-red-400'}`} />
                          <div className="flex-1 min-w-0">
                            <p className="text-xs text-foreground truncate">{f.testName}</p>
                            <p className="text-[10px] text-muted-foreground">{f.runCount} runs</p>
                          </div>
                          <div className="flex-shrink-0 text-right">
                            <p className={`text-xs font-bold ${f.stability >= 80 ? 'text-emerald-400' : f.stability >= 50 ? 'text-amber-400' : 'text-red-400'}`}>{f.stability}%</p>
                            <p className="text-[10px] text-muted-foreground">stability</p>
                          </div>
                        </div>
                      ))}
                    </div>
                    </CardContent>
                  </Card>

                  <Card className="bg-card/50 border-border/50 border-l-[3px] border-l-violet-500 overflow-hidden">
                    <CardHeader className="py-3 px-4 border-b border-border">
                      <CardTitle className="text-sm font-bold flex items-center gap-2">
                        <Clock className="w-4 h-4 text-violet-400" />
                        Recent Executions
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="p-0">
                    <div className="overflow-auto max-h-52">
                      {history.length === 0 ? (
                        <div className="p-4 text-xs text-muted-foreground text-center">No history yet — run a test to see results</div>
                      ) : history.slice(0, 20).map(h => (
                        <div key={h.id} className="flex items-center gap-3 px-4 py-2.5 border-b border-border/60">
                          <span className="text-sm">{h.status === 'passed' ? '✅' : h.status === 'failed' ? '❌' : '⊘'}</span>
                          <div className="flex-1 min-w-0">
                            <p className="text-xs text-foreground truncate">{h.testName}</p>
                            <p className="text-[10px] text-muted-foreground">{h.environment} · {new Date(h.runAt).toLocaleString()}</p>
                          </div>
                          <span className="text-[10px] text-muted-foreground flex-shrink-0">{Math.round(h.duration / 1000)}s</span>
                        </div>
                      ))}
                    </div>
                    </CardContent>
                  </Card>
                </div>
              </>
            ) : (
              <div className="flex items-center justify-center h-40 text-muted-foreground">No metrics available yet</div>
            )}
            </TabsContent>

            <TabsContent value="suites" className="space-y-4">
            {/* Create Suite */}
            <div className="rounded-2xl border border-border/40 bg-card shadow-sm p-4">
              <h3 className="text-sm font-bold text-foreground mb-3">+ Create Test Suite</h3>
              <div className="flex items-center gap-3">
                <input
                  value={newSuiteName} onChange={e => setNewSuiteName(e.target.value)}
                  placeholder="Suite name (e.g. Sprint 24 Regression)"
                  className="flex-1 bg-muted border border-border focus:border-primary rounded-lg px-3 py-2 text-sm text-foreground outline-none"
                />
                <select value={newSuiteType} onChange={e => setNewSuiteType(e.target.value)}
                  className="bg-muted border border-border rounded-lg px-3 py-2 text-sm text-foreground outline-none">
                  <option value="smoke">🔥 Smoke</option>
                  <option value="regression">📦 Regression</option>
                  <option value="sanity">✅ Sanity</option>
                  <option value="sprint">🏃 Sprint</option>
                  <option value="custom">⚙️ Custom</option>
                </select>
                <button onClick={createSuite}
                  className="px-4 py-2 rounded-lg bg-primary hover:bg-primary/90 text-foreground text-sm font-semibold transition-colors">
                  Create
                </button>
              </div>
            </div>

            {/* Suite Run Log */}
            {suiteRunLog.suiteId && (
              <div className="bg-muted border border-border rounded-xl p-4">
                <div className="flex items-center gap-2 mb-2">
                  <div className={`w-2 h-2 rounded-full ${suiteRunLog.status === 'running' ? 'bg-yellow-400 animate-pulse' : suiteRunLog.status === 'done' ? 'bg-emerald-400' : 'bg-red-400'}`} />
                  <span className="text-xs font-bold text-foreground">Suite Execution Log</span>
                </div>
                <div className="font-mono text-[11px] text-muted-foreground space-y-0.5 max-h-40 overflow-auto">
                  {suiteRunLog.lines.map((l, i) => <div key={i}>{l}</div>)}
                </div>
              </div>
            )}

            {/* Suite Cards */}
            {suites.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border p-12 text-center">
                <p className="text-muted-foreground text-sm">No suites yet — create your first test suite above</p>
                <p className="text-muted-foreground/70 text-xs mt-2">Suites let you group related tests and run them together</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {suites.map(suite => (
                  <div key={suite.id} className="rounded-2xl border border-border/40 bg-card shadow-sm p-4 flex flex-col gap-3">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <h4 className="text-sm font-bold text-foreground">{suite.name}</h4>
                        <div className="flex items-center gap-2 mt-1">
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-primary/20 text-primary border border-primary/30 capitalize">{suite.type}</span>
                          <span className="text-[10px] text-muted-foreground">{suite.testIds.length} tests</span>
                        </div>
                      </div>
                      <div className="flex gap-1">
                        <button onClick={() => deleteSuite(suite.id)}
                          className="px-2 py-1.5 rounded-lg hover:bg-red-500/20 text-muted-foreground hover:text-red-400 text-xs transition-colors">
                          🗑
                        </button>
                      </div>
                    </div>
                    {suite.testIds.length === 0 ? (
                      <p className="text-[11px] text-muted-foreground/70 italic">No tests added yet — save tests from the recorder with suite assignment</p>
                    ) : (
                      <div className="text-[10px] text-muted-foreground space-y-0.5 max-h-20 overflow-auto">
                        {suite.testIds.map(id => <div key={id} className="flex items-center gap-1"><span className="text-muted-foreground/50">·</span> {id}</div>)}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
            </TabsContent>

            <TabsContent value="rtm" className="space-y-4">
            {/* RTM Summary Bar */}
            {rtm.length > 0 && (
              <div className="grid grid-cols-4 gap-3">
                {[
                  { label: 'Total', count: rtm.length, color: 'text-foreground' },
                  { label: 'Covered', count: rtm.filter(r => r.coverage === 'covered').length, color: 'text-emerald-400' },
                  { label: 'Failing', count: rtm.filter(r => r.coverage === 'failing').length, color: 'text-red-400' },
                  { label: 'No Tests', count: rtm.filter(r => r.coverage === 'none').length, color: 'text-muted-foreground' },
                ].map(s => (
                  <div key={s.label} className="rounded-2xl border border-border/40 bg-card shadow-sm px-4 py-2.5 text-center">
                    <p className={`text-xl font-bold ${s.color}`}>{s.count}</p>
                    <p className="text-[10px] text-muted-foreground">{s.label}</p>
                  </div>
                ))}
              </div>
            )}

            {/* Add Requirement */}
            <div className="rounded-2xl border border-border/40 bg-card shadow-sm p-4">
              <h3 className="text-sm font-bold text-foreground mb-3">+ Add Requirement</h3>
              <div className="flex items-center gap-2 flex-wrap">
                <input value={newReqTitle} onChange={e => setNewReqTitle(e.target.value)}
                  placeholder="Requirement title"
                  className="flex-1 min-w-48 bg-muted border border-border focus:border-primary rounded-lg px-3 py-2 text-sm text-foreground outline-none" />
                <input value={newReqTicket} onChange={e => setNewReqTicket(e.target.value)}
                  placeholder="JIRA/ADO ticket (optional)"
                  className="w-44 bg-muted border border-border rounded-lg px-3 py-2 text-sm text-foreground outline-none" />
                <select value={newReqPriority} onChange={e => setNewReqPriority(e.target.value)}
                  className="bg-muted border border-border rounded-lg px-3 py-2 text-sm text-foreground outline-none">
                  <option>P0</option><option>P1</option><option>P2</option><option>P3</option>
                </select>
                <button onClick={createRequirement}
                  className="px-4 py-2 rounded-lg bg-primary hover:bg-primary/90 text-foreground text-sm font-semibold">Add</button>
              </div>
            </div>

            {/* Link Test to Requirement */}
            <div className="rounded-2xl border border-border/40 bg-card shadow-sm p-4">
              <h3 className="text-sm font-bold text-foreground mb-3">🔗 Link Test to Requirement</h3>
              <div className="flex items-center gap-2 flex-wrap">
                <select value={linkReqId} onChange={e => setLinkReqId(e.target.value)}
                  className="flex-1 min-w-48 bg-muted border border-border rounded-lg px-3 py-2 text-sm text-foreground outline-none">
                  <option value="">— Select requirement —</option>
                  {rtm.map(r => <option key={r.id} value={r.id}>{r.title}</option>)}
                </select>
                <input value={linkTestId} onChange={e => setLinkTestId(e.target.value)}
                  placeholder="Test ID (from recorder)"
                  className="w-44 bg-muted border border-border rounded-lg px-3 py-2 text-sm text-foreground outline-none" />
                <input value={linkTestName} onChange={e => setLinkTestName(e.target.value)}
                  placeholder="Test name (optional)"
                  className="w-44 bg-muted border border-border rounded-lg px-3 py-2 text-sm text-foreground outline-none" />
                <button onClick={linkTest}
                  className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-foreground text-sm font-semibold">Link</button>
              </div>
            </div>

            {/* RTM Matrix */}
            {rtm.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border p-12 text-center">
                <p className="text-muted-foreground text-sm">No requirements yet</p>
                <p className="text-muted-foreground/70 text-xs mt-2">Add requirements above and link them to your recorded tests to build a traceability matrix</p>
              </div>
            ) : (
              <div className="rounded-2xl border border-border/40 bg-card shadow-sm overflow-hidden">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border bg-muted/50">
                      <th className="text-left px-4 py-3 text-muted-foreground font-semibold">Priority</th>
                      <th className="text-left px-4 py-3 text-muted-foreground font-semibold">Requirement</th>
                      <th className="text-left px-4 py-3 text-muted-foreground font-semibold">Ticket</th>
                      <th className="text-left px-4 py-3 text-muted-foreground font-semibold">Linked Tests</th>
                      <th className="text-left px-4 py-3 text-muted-foreground font-semibold">Coverage</th>
                      <th className="px-4 py-3" />
                    </tr>
                  </thead>
                  <tbody>
                    {rtm.map(row => (
                      <tr key={row.id} className="border-b border-border hover:bg-muted/40 transition-colors">
                        <td className="px-4 py-3">
                          <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${row.priority === 'P0' ? 'bg-red-500/20 text-red-400' : row.priority === 'P1' ? 'bg-orange-500/20 text-orange-400' : row.priority === 'P2' ? 'bg-blue-500/20 text-blue-400' : 'bg-muted text-muted-foreground'}`}>
                            {row.priority}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-foreground font-medium">{row.title}</td>
                        <td className="px-4 py-3 text-muted-foreground">{row.ticketId ? (
                          <span className="font-mono text-blue-400">{row.ticketId}</span>
                        ) : '—'}</td>
                        <td className="px-4 py-3">
                          <div className="space-y-1">
                            {row.tests.length === 0 ? (
                              <span className="text-muted-foreground/70 italic">No tests linked</span>
                            ) : row.tests.map(t => (
                              <div key={t.testId} className="flex items-center gap-2">
                                <span>{t.lastStatus === 'passed' ? '✅' : t.lastStatus === 'failed' ? '❌' : '○'}</span>
                                <span className="text-foreground truncate max-w-32">{t.testName}</span>
                                <button onClick={() => unlinkTest(row.id, t.testId)} className="text-muted-foreground/50 hover:text-red-400 text-[10px] transition-colors">✕</button>
                              </div>
                            ))}
                          </div>
                        </td>
                        <td className="px-4 py-3">{coverageBadge(row.coverage)}</td>
                        <td className="px-4 py-3">
                          <button onClick={() => deleteRequirement(row.id)} className="text-muted-foreground/50 hover:text-red-400 text-xs transition-colors">🗑</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            </TabsContent>

            <TabsContent value="environments" className="space-y-4">
            {/* Add Environment */}
            <div className="rounded-2xl border border-border/40 bg-card shadow-sm p-4">
              <h3 className="text-sm font-bold text-foreground mb-3">+ Add Environment</h3>
              <div className="flex items-center gap-2 flex-wrap">
                <input value={newEnvName} onChange={e => setNewEnvName(e.target.value)}
                  placeholder="Name (e.g. Staging)"
                  className="w-44 bg-muted border border-border focus:border-primary rounded-lg px-3 py-2 text-sm text-foreground outline-none" />
                <input value={newEnvUrl} onChange={e => setNewEnvUrl(e.target.value)}
                  placeholder="Base URL (https://staging.app.com)"
                  className="flex-1 min-w-64 bg-muted border border-border rounded-lg px-3 py-2 text-sm text-foreground outline-none" />
                <select value={newEnvType} onChange={e => setNewEnvType(e.target.value as any)}
                  className="bg-muted border border-border rounded-lg px-3 py-2 text-sm text-foreground outline-none">
                  <option value="dev">🔧 Dev</option>
                  <option value="staging">🧪 Staging</option>
                  <option value="production">🚀 Production</option>
                  <option value="custom">⚙️ Custom</option>
                </select>
                <button onClick={createEnvironment}
                  className="px-4 py-2 rounded-lg bg-primary hover:bg-primary/90 text-foreground text-sm font-semibold">Add</button>
              </div>
            </div>

            {environments.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border p-12 text-center">
                <p className="text-muted-foreground text-sm">No environments configured</p>
                <p className="text-muted-foreground/70 text-xs mt-2">Add Dev, Staging, and Production URLs to run the same tests across environments</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {environments.map(env => (
                  <div key={env.id} className={`rounded-2xl border bg-card shadow-sm p-4 flex flex-col gap-3 ${env.isDefault ? 'border-primary/50 border-l-[3px] border-l-primary' : 'border-border/40'}`}>
                    <div className="flex items-start justify-between">
                      <div>
                        <div className="flex items-center gap-2">
                          <h4 className="text-sm font-bold text-foreground">{env.name}</h4>
                          {env.isDefault && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-primary/20 text-primary border border-primary/30">default</span>}
                        </div>
                        <span className="text-[10px] text-muted-foreground capitalize">{env.type}</span>
                      </div>
                      <button onClick={() => deleteEnvironment(env.id)} className="text-muted-foreground/70 hover:text-red-400 text-xs transition-colors">🗑</button>
                    </div>
                    <div className="bg-muted/60 rounded-lg px-3 py-2 font-mono text-xs text-primary break-all">{env.baseUrl}</div>
                    {!env.isDefault && (
                      <button onClick={() => setDefaultEnvironment(env.id)}
                        className="w-full py-1.5 rounded-lg border border-border hover:border-primary text-muted-foreground hover:text-primary text-xs transition-all">
                        Set as Default
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
            </TabsContent>

            <TabsContent value="cicd" className="space-y-4">
            {/* Config */}
            <div className="rounded-2xl border border-border/40 bg-card shadow-sm p-5">
              <h3 className="text-sm font-bold text-foreground mb-4">Generate CI/CD Pipeline</h3>
              <div className="grid grid-cols-2 gap-4 mb-4">
                <div>
                  <label className="text-xs text-muted-foreground mb-1.5 block">CI/CD Platform</label>
                  <div className="grid grid-cols-2 gap-2">
                    {([['github', '🐙 GitHub Actions'], ['azure', '🔷 Azure Pipelines'], ['gitlab', '🦊 GitLab CI'], ['jenkins', '🔨 Jenkins']] as const).map(([id, label]) => (
                      <button key={id} onClick={() => setCicdType(id)}
                        className={`py-2 px-3 rounded-lg border text-xs font-semibold transition-all ${cicdType === id ? 'bg-primary border-primary text-foreground' : 'border-border text-muted-foreground hover:border-border'}`}>
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="space-y-3">
                  <div>
                    <label className="text-xs text-muted-foreground mb-1.5 block">Project Name</label>
                    <input value={cicdProjectName} onChange={e => setCicdProjectName(e.target.value)}
                      className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-sm text-foreground outline-none" />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground mb-1.5 block">Suite / Test Command Override (optional)</label>
                    <input value={cicdSuiteType} onChange={e => setCicdSuiteType(e.target.value)}
                      placeholder="e.g. regression, smoke"
                      className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-sm text-foreground outline-none" />
                  </div>
                </div>
              </div>
              <button onClick={generateCICD}
                className="px-6 py-2 rounded-lg bg-gradient-to-r from-primary to-primary/80 hover:from-primary/90 hover:to-primary/70 text-foreground text-sm font-bold transition-all">
                ⚙️ Generate YAML
              </button>
            </div>

            {/* YAML Output */}
            {cicdYaml && (
              <div className="bg-muted border border-border rounded-xl overflow-hidden">
                <div className="flex items-center justify-between px-4 py-2.5 border-b border-border bg-muted/50">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-foreground">
                      {cicdType === 'github' ? '🐙 .github/workflows/playwright.yml' :
                       cicdType === 'azure' ? '🔷 azure-pipelines.yml' :
                       cicdType === 'gitlab' ? '🦊 .gitlab-ci.yml' :
                       '🔨 Jenkinsfile'}
                    </span>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={copyCICD}
                      className="px-3 py-1 rounded-lg bg-muted hover:bg-muted/80 text-xs text-foreground transition-colors">
                      {cicdCopied ? '✓ Copied!' : '📋 Copy'}
                    </button>
                    <a href={`data:text/plain;charset=utf-8,${encodeURIComponent(cicdYaml)}`}
                      download={cicdType === 'github' ? 'playwright.yml' : cicdType === 'azure' ? 'azure-pipelines.yml' : cicdType === 'gitlab' ? '.gitlab-ci.yml' : 'Jenkinsfile'}
                      className="px-3 py-1 rounded-lg bg-muted hover:bg-muted/80 text-xs text-foreground transition-colors">
                      ↓ Download
                    </a>
                  </div>
                </div>
                <pre className="p-4 text-[11px] font-mono text-foreground overflow-auto max-h-[600px] leading-relaxed whitespace-pre">{cicdYaml}</pre>
              </div>
            )}

            {/* Instructions */}
            <div className="rounded-2xl border border-border/40 bg-card/50 shadow-sm p-5">
              <h4 className="text-sm font-bold text-foreground mb-3">📋 Setup Instructions</h4>
              <div className="space-y-3 text-xs text-muted-foreground">
                {cicdType === 'github' && <>
                  <p>1. Save the YAML to <code className="text-blue-300">.github/workflows/playwright.yml</code> in your project repo</p>
                  <p>2. Add secrets: <code className="text-blue-300">Settings → Secrets → Actions → New secret</code> → <code className="text-amber-300">TEST_PASSWORD</code></p>
                  <p>3. Add variables: <code className="text-blue-300">Settings → Variables → Actions</code> → <code className="text-amber-300">BASE_URL</code></p>
                  <p>4. Push to main or create a PR — tests will run automatically</p>
                </>}
                {cicdType === 'azure' && <>
                  <p>1. Save the YAML to <code className="text-blue-300">azure-pipelines.yml</code> in your repository root</p>
                  <p>2. Create pipeline: Azure DevOps → Pipelines → New Pipeline → select your repo</p>
                  <p>3. Add variables: Pipeline → Edit → Variables → <code className="text-amber-300">TEST_PASSWORD</code>, <code className="text-amber-300">BASE_URL</code></p>
                  <p>4. Enable "Allow access to all pipelines" for variable groups if used</p>
                </>}
                {cicdType === 'gitlab' && <>
                  <p>1. Save as <code className="text-blue-300">.gitlab-ci.yml</code> in your repository root</p>
                  <p>2. Add CI/CD variables: Settings → CI/CD → Variables → <code className="text-amber-300">TEST_PASSWORD</code>, <code className="text-amber-300">BASE_URL</code></p>
                  <p>3. Pipelines will trigger automatically on push and merge requests</p>
                </>}
                {cicdType === 'jenkins' && <>
                  <p>1. Save as <code className="text-blue-300">Jenkinsfile</code> in your repository root</p>
                  <p>2. Create credentials: Jenkins → Manage → Credentials → <code className="text-amber-300">TEST_PASSWORD</code></p>
                  <p>3. Create pipeline job pointing to your repository</p>
                  <p>4. Install the NodeJS and Docker plugins if not already installed</p>
                </>}
              </div>
            </div>
            </TabsContent>
          </Tabs>
        </div>
      </main>
    </>
  );
}
