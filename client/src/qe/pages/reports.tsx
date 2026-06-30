import { useState } from "react";
import { Link } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { DashboardHeader } from "@/components/dashboard/header";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { 
  BarChart3, 
  TrendingUp, 
  TrendingDown,
  PieChart, 
  FileText, 
  Download,
  Calendar,
  Filter,
  RefreshCw,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Target,
  Layers,
  Activity,
  Clock,
  Loader2,
  Inbox
} from "lucide-react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar, PieChart as RechartsPie, Pie, Cell, Legend } from 'recharts';

// ─── Response shape types ─────────────────────────────────────────────────────

interface OverviewResp {
  range: string;
  testCasesGenerated: number;
  testCasesGeneratedDelta: number | null;
  executionsRun: number;
  executionsRunDelta: number | null;
  passRate: number;
  passRateDelta: number | null;
  coverage: number;
  coverageTarget: number;
}
interface TrendResp { range: string; data: Array<{ day: string; testCases: number; executions: number }>; }
interface TypeDistResp { range: string; data: Array<{ name: string; value: number; color: string }>; }
interface ExecResultsResp { range: string; data: Array<{ project: string; passed: number; failed: number; skipped: number }>; }
interface ExecSummaryResp { range: string; totalRuns: number; passed: number; failed: number; skipped: number; avgDurationMs: number; avgDurationLabel: string; }
interface ExecHistoryResp { range: string; data: Array<{ id: string; date: string; project: string; source: string; tests: number; passed: number; failed: number; duration: string; status: string }>; }
interface CoverageByProjectResp { range: string; data: Array<{ project: string; source: string; stories: number; testCases: number; coverage: number }>; }
interface CoverageSummaryResp {
  overallCoverage: number;
  userStoriesCovered: number;
  userStoriesTotal: number;
  testCases: number;
  coverageGaps: number;
}

// ─── Small UI helpers ─────────────────────────────────────────────────────────

function DeltaBadge({ value }: { value: number | null }) {
  if (value === null) return <span className="text-xs text-muted-foreground mt-1">No prior period to compare</span>;
  const isUp = value >= 0;
  return (
    <p className={`text-xs mt-1 flex items-center gap-1 ${isUp ? 'text-emerald-400' : 'text-red-400'}`}>
      {isUp ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
      {isUp ? '+' : ''}{value}% vs previous period
    </p>
  );
}

/** Recharts pie tooltips often render blank because `name` is the dataKey ("value"), not the slice label. */
function TypeDistributionTooltipContent({
  active,
  payload,
}: {
  active?: boolean;
  payload?: ReadonlyArray<{
    value?: number | string;
    payload?: { name?: string; value?: number };
  }>;
}) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload ?? {};
  const displayName =
    row.name != null && String(row.name).trim() !== "" ? String(row.name) : "—";
  const raw =
    typeof row.value === "number"
      ? row.value
      : typeof payload[0].value === "number"
        ? payload[0].value
        : Number(payload[0].value ?? 0);
  const count = Number.isFinite(raw) ? raw : 0;
  return (
    <div
      className="rounded-md border px-3 py-2 text-xs shadow-md"
      style={{ backgroundColor: "#1a1a2e", borderColor: "#333", color: "#fff" }}
    >
      <p className="font-semibold">{displayName}</p>
      <p className="mt-0.5 opacity-90">
        <span className="font-mono font-semibold tabular-nums">{count}</span>{" "}
        {count === 1 ? "test case" : "test cases"}
      </p>
    </div>
  );
}

function ChartEmptyState({ label }: { label: string }) {
  return (
    <div className="h-full w-full flex flex-col items-center justify-center text-muted-foreground gap-2">
      <Inbox className="w-8 h-8 opacity-50" />
      <p className="text-sm">No {label} for this period</p>
    </div>
  );
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function escapeCsvCell(value: unknown): string {
  const s = String(value ?? "");
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function executionHistoryToCsv(rows: ExecHistoryResp["data"]): string {
  const headers = ["Run ID", "Date", "Project", "Source", "Tests", "Passed", "Failed", "Duration", "Status"];
  const lines = [
    headers.map(escapeCsvCell).join(","),
    ...rows.map((row) =>
      [
        row.id,
        row.date,
        row.project,
        row.source,
        row.tests,
        row.passed,
        row.failed,
        row.duration,
        row.status,
      ]
        .map(escapeCsvCell)
        .join(","),
    ),
  ];
  return lines.join("\r\n");
}

export default function ReportsPage() {
  const [dateRange, setDateRange] = useState('week');
  const [activeTab, setActiveTab] = useState('overview');
  const queryClient = useQueryClient();
  const { toast } = useToast();

  // ── Data queries — all keyed by `dateRange` so they auto-refetch on filter change ──
  const overview = useQuery<OverviewResp>({
    queryKey: ['/api/qe/reports/overview', dateRange],
    queryFn: async () => (await fetch(`/api/qe/reports/overview?range=${dateRange}`)).json(),
  });
  const trend = useQuery<TrendResp>({
    queryKey: ['/api/qe/reports/trend', dateRange],
    queryFn: async () => (await fetch(`/api/qe/reports/trend?range=${dateRange}`)).json(),
  });
  const typeDist = useQuery<TypeDistResp>({
    queryKey: ['/api/qe/reports/type-distribution', dateRange],
    queryFn: async () => (await fetch(`/api/qe/reports/type-distribution?range=${dateRange}`)).json(),
  });
  const execResults = useQuery<ExecResultsResp>({
    queryKey: ['/api/qe/reports/execution-results', dateRange],
    queryFn: async () => (await fetch(`/api/qe/reports/execution-results?range=${dateRange}`)).json(),
  });
  const execSummary = useQuery<ExecSummaryResp>({
    queryKey: ['/api/qe/reports/execution-summary', dateRange],
    queryFn: async () => (await fetch(`/api/qe/reports/execution-summary?range=${dateRange}`)).json(),
  });
  const execHistory = useQuery<ExecHistoryResp>({
    queryKey: ['/api/qe/reports/execution-history', dateRange],
    queryFn: async () => (await fetch(`/api/qe/reports/execution-history?range=${dateRange}&limit=20`)).json(),
  });
  const coverageByProject = useQuery<CoverageByProjectResp>({
    queryKey: ['/api/qe/reports/coverage-by-project', dateRange],
    queryFn: async () => (await fetch(`/api/qe/reports/coverage-by-project?range=${dateRange}`)).json(),
  });
  const coverageSummary = useQuery<CoverageSummaryResp>({
    queryKey: ['/api/qe/reports/coverage-summary'],
    queryFn: async () => (await fetch(`/api/qe/reports/coverage-summary`)).json(),
  });

  const isLoading = overview.isLoading || trend.isLoading || typeDist.isLoading || execResults.isLoading;

  const refreshAll = () => {
    queryClient.invalidateQueries({ queryKey: ['/api/qe/reports/overview'] });
    queryClient.invalidateQueries({ queryKey: ['/api/qe/reports/trend'] });
    queryClient.invalidateQueries({ queryKey: ['/api/qe/reports/type-distribution'] });
    queryClient.invalidateQueries({ queryKey: ['/api/qe/reports/execution-results'] });
    queryClient.invalidateQueries({ queryKey: ['/api/qe/reports/execution-summary'] });
    queryClient.invalidateQueries({ queryKey: ['/api/qe/reports/execution-history'] });
    queryClient.invalidateQueries({ queryKey: ['/api/qe/reports/coverage-by-project'] });
    queryClient.invalidateQueries({ queryKey: ['/api/qe/reports/coverage-summary'] });
  };

  const exportFullReport = () => {
    try {
      const payload = {
        exportedAt: new Date().toISOString(),
        dateRange,
        activeTab,
        overview: overview.data ?? null,
        trend: trend.data ?? null,
        typeDistribution: typeDist.data ?? null,
        executionResults: execResults.data ?? null,
        executionSummary: execSummary.data ?? null,
        executionHistory: execHistory.data ?? null,
        coverageByProject: coverageByProject.data ?? null,
        coverageSummary: coverageSummary.data ?? null,
      };
      const blob = new Blob([JSON.stringify(payload, null, 2)], {
        type: "application/json;charset=utf-8",
      });
      const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
      triggerDownload(blob, `reports-analytics-${dateRange}-${stamp}.json`);
      toast({
        title: "Report exported",
        description: "A JSON file with all metrics for the selected range was saved to your downloads folder.",
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Export failed";
      toast({ title: "Export failed", description: message, variant: "destructive" });
    }
  };

  const exportExecutionHistoryCsv = () => {
    const rows = execHistory.data?.data ?? [];
    if (rows.length === 0) {
      toast({
        title: "Nothing to export",
        description: "No execution history rows for this period.",
        variant: "destructive",
      });
      return;
    }
    try {
      const csv = executionHistoryToCsv(rows);
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
      const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
      triggerDownload(blob, `execution-history-${dateRange}-${stamp}.csv`);
      toast({
        title: "History exported",
        description: "CSV saved to your downloads folder.",
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Export failed";
      toast({ title: "Export failed", description: message, variant: "destructive" });
    }
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
                    <BarChart3 className="w-7 h-7 text-primary" />
                    Reports & Analytics
                  </h1>
                  <p className="text-muted-foreground mt-1">Comprehensive testing insights and metrics</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Select value={dateRange} onValueChange={setDateRange}>
                  <SelectTrigger className="w-40" data-testid="select-date-range">
                    <Calendar className="w-4 h-4 mr-2" />
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="today">Today</SelectItem>
                    <SelectItem value="week">This Week</SelectItem>
                    <SelectItem value="month">This Month</SelectItem>
                    <SelectItem value="quarter">This Quarter</SelectItem>
                  </SelectContent>
                </Select>
                <Button
                  variant="outline"
                  size="icon"
                  data-testid="button-refresh-reports"
                  onClick={refreshAll}
                  disabled={isLoading}
                  title="Refresh all reports"
                >
                  <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
                </Button>
                <Button data-testid="button-export-report" onClick={exportFullReport}>
                  <Download className="w-4 h-4 mr-2" />
                  Export Report
                </Button>
              </div>
            </div>

            <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
              <TabsList className="bg-card border">
                <TabsTrigger value="overview" data-testid="tab-overview">Overview</TabsTrigger>
                <TabsTrigger value="coverage" data-testid="tab-coverage">Coverage Reports</TabsTrigger>
                <TabsTrigger value="execution" data-testid="tab-execution">Execution Reports</TabsTrigger>
                <TabsTrigger value="custom" data-testid="tab-custom">Custom Reports</TabsTrigger>
              </TabsList>

              <TabsContent value="overview" className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                  <Card className="bg-card/50 border-border/50">
                    <CardContent className="p-6">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm text-muted-foreground">Test Cases Generated</p>
                          <p className="text-3xl font-bold text-foreground mt-1">
                            {overview.isLoading ? <Loader2 className="w-6 h-6 animate-spin" /> : (overview.data?.testCasesGenerated ?? 0)}
                          </p>
                          {!overview.isLoading && <DeltaBadge value={overview.data?.testCasesGeneratedDelta ?? null} />}
                        </div>
                        <div className="w-12 h-12 rounded-xl bg-primary/20 flex items-center justify-center">
                          <FileText className="w-6 h-6 text-primary" />
                        </div>
                      </div>
                    </CardContent>
                  </Card>

                  <Card className="bg-card/50 border-border/50">
                    <CardContent className="p-6">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm text-muted-foreground">Executions Run</p>
                          <p className="text-3xl font-bold text-foreground mt-1">
                            {overview.isLoading ? <Loader2 className="w-6 h-6 animate-spin" /> : (overview.data?.executionsRun ?? 0)}
                          </p>
                          {!overview.isLoading && <DeltaBadge value={overview.data?.executionsRunDelta ?? null} />}
                        </div>
                        <div className="w-12 h-12 rounded-xl bg-violet-500/20 flex items-center justify-center">
                          <Activity className="w-6 h-6 text-violet-400" />
                        </div>
                      </div>
                    </CardContent>
                  </Card>

                  <Card className="bg-card/50 border-border/50">
                    <CardContent className="p-6">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm text-muted-foreground">Pass Rate</p>
                          <p className="text-3xl font-bold text-foreground mt-1">
                            {overview.isLoading ? <Loader2 className="w-6 h-6 animate-spin" /> : `${overview.data?.passRate ?? 0}%`}
                          </p>
                          {!overview.isLoading && <DeltaBadge value={overview.data?.passRateDelta ?? null} />}
                        </div>
                        <div className="w-12 h-12 rounded-xl bg-emerald-500/20 flex items-center justify-center">
                          <CheckCircle2 className="w-6 h-6 text-emerald-400" />
                        </div>
                      </div>
                    </CardContent>
                  </Card>

                  <Card className="bg-card/50 border-border/50">
                    <CardContent className="p-6">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm text-muted-foreground">Coverage</p>
                          <p className="text-3xl font-bold text-foreground mt-1">
                            {overview.isLoading ? <Loader2 className="w-6 h-6 animate-spin" /> : `${overview.data?.coverage ?? 0}%`}
                          </p>
                          {!overview.isLoading && (
                            (overview.data?.coverage ?? 0) >= (overview.data?.coverageTarget ?? 85)
                              ? <p className="text-xs text-emerald-400 mt-1 flex items-center gap-1"><CheckCircle2 className="w-3 h-3" /> Target met ({overview.data?.coverageTarget ?? 85}%)</p>
                              : <p className="text-xs text-amber-400 mt-1 flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> Target: {overview.data?.coverageTarget ?? 85}%</p>
                          )}
                        </div>
                        <div className="w-12 h-12 rounded-xl bg-cyan-500/20 flex items-center justify-center">
                          <Target className="w-6 h-6 text-cyan-400" />
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  <Card className="bg-card/50 border-border/50">
                    <CardHeader>
                      <CardTitle className="text-lg flex items-center gap-2">
                        <TrendingUp className="w-5 h-5 text-primary" />
                        Generation Trend
                      </CardTitle>
                      <CardDescription>Test cases generated over the past week</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="h-64">
                        {trend.isLoading ? (
                          <div className="h-full flex items-center justify-center"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
                        ) : (trend.data?.data || []).every((p) => p.testCases === 0 && p.executions === 0) ? (
                          <ChartEmptyState label="generation activity" />
                        ) : (
                          <ResponsiveContainer width="100%" height="100%">
                            <LineChart data={trend.data?.data || []}>
                              <CartesianGrid strokeDasharray="3 3" stroke="#333" />
                              <XAxis dataKey="day" stroke="#888" />
                              <YAxis stroke="#888" />
                              <Tooltip
                                contentStyle={{ backgroundColor: '#1a1a2e', border: '1px solid #333' }}
                                labelStyle={{ color: '#fff' }}
                                itemStyle={{ color: '#fff' }}
                              />
                              <Legend />
                              <Line type="monotone" dataKey="testCases" name="Test Cases" stroke="#f97316" strokeWidth={2} dot={{ fill: '#f97316' }} />
                              <Line type="monotone" dataKey="executions" name="Executions" stroke="#8b5cf6" strokeWidth={2} dot={{ fill: '#8b5cf6' }} />
                            </LineChart>
                          </ResponsiveContainer>
                        )}
                      </div>
                    </CardContent>
                  </Card>

                  <Card className="bg-card/50 border-border/50">
                    <CardHeader>
                      <CardTitle className="text-lg flex items-center gap-2">
                        <PieChart className="w-5 h-5 text-primary" />
                        Test Type Distribution
                      </CardTitle>
                      <CardDescription>Breakdown by test category</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="h-64">
                        {typeDist.isLoading ? (
                          <div className="h-full flex items-center justify-center"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
                        ) : (typeDist.data?.data || []).length === 0 ? (
                          <ChartEmptyState label="categorised test cases" />
                        ) : (
                          <ResponsiveContainer width="100%" height="100%">
                            <RechartsPie>
                              <Pie
                                data={typeDist.data?.data || []}
                                cx="50%"
                                cy="50%"
                                innerRadius={60}
                                outerRadius={80}
                                paddingAngle={5}
                                dataKey="value"
                                label={({ name, percent }: any) => `${name} ${(percent * 100).toFixed(0)}%`}
                              >
                                {(typeDist.data?.data || []).map((entry, index) => (
                                  <Cell key={`cell-${index}`} fill={entry.color} />
                                ))}
                              </Pie>
                              <Tooltip
                                content={TypeDistributionTooltipContent}
                                wrapperStyle={{ zIndex: 100 }}
                              />
                            </RechartsPie>
                          </ResponsiveContainer>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                </div>

                <Card className="bg-card/50 border-border/50">
                  <CardHeader>
                    <CardTitle className="text-lg flex items-center gap-2">
                      <BarChart3 className="w-5 h-5 text-primary" />
                      Execution Results by Project
                    </CardTitle>
                    <CardDescription>Pass/Fail/Skip breakdown per project</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="h-64">
                      {execResults.isLoading ? (
                        <div className="h-full flex items-center justify-center"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
                      ) : (execResults.data?.data || []).length === 0 ? (
                        <ChartEmptyState label="execution runs by project" />
                      ) : (
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={execResults.data?.data || []} layout="vertical">
                            <CartesianGrid strokeDasharray="3 3" stroke="#333" />
                            <XAxis type="number" stroke="#888" />
                            <YAxis dataKey="project" type="category" stroke="#888" width={120} />
                            <Tooltip
                              contentStyle={{ backgroundColor: '#1a1a2e', border: '1px solid #333' }}
                              labelStyle={{ color: '#fff' }}
                              itemStyle={{ color: '#fff' }}
                            />
                            <Legend />
                            <Bar dataKey="passed" stackId="a" fill="#22c55e" name="Passed" />
                            <Bar dataKey="failed" stackId="a" fill="#ef4444" name="Failed" />
                            <Bar dataKey="skipped" stackId="a" fill="#6b7280" name="Skipped" />
                          </BarChart>
                        </ResponsiveContainer>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="coverage" className="space-y-6">
                <Card className="bg-card/50 border-border/50">
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <div>
                        <CardTitle className="text-lg flex items-center gap-2">
                          <Target className="w-5 h-5 text-primary" />
                          Coverage Summary
                        </CardTitle>
                        <CardDescription>Overall test coverage metrics</CardDescription>
                      </div>
                      <div className="text-right">
                        <p className="text-4xl font-bold text-foreground">
                          {coverageSummary.isLoading ? <Loader2 className="w-7 h-7 animate-spin inline-block" /> : `${coverageSummary.data?.overallCoverage ?? 0}%`}
                        </p>
                        <p className="text-sm text-muted-foreground">Overall Coverage</p>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-3 gap-6">
                      <div className="text-center p-4 rounded-lg bg-background/50">
                        <p className="text-2xl font-bold text-foreground">
                          {coverageSummary.isLoading ? '—' : (coverageSummary.data?.userStoriesCovered ?? 0)}
                        </p>
                        <p className="text-sm text-muted-foreground">Pages Covered</p>
                        <p className="text-xs text-emerald-400">of {coverageSummary.data?.userStoriesTotal ?? 0} total</p>
                      </div>
                      <div className="text-center p-4 rounded-lg bg-background/50">
                        <p className="text-2xl font-bold text-foreground">
                          {coverageSummary.isLoading ? '—' : (coverageSummary.data?.testCases ?? 0)}
                        </p>
                        <p className="text-sm text-muted-foreground">Test Cases</p>
                        <p className="text-xs text-muted-foreground">Recorded in library</p>
                      </div>
                      <div className="text-center p-4 rounded-lg bg-background/50">
                        <p className="text-2xl font-bold text-foreground">
                          {coverageSummary.isLoading ? '—' : (coverageSummary.data?.coverageGaps ?? 0)}
                        </p>
                        <p className="text-sm text-muted-foreground">Coverage Gaps</p>
                        <p className={`text-xs ${(coverageSummary.data?.coverageGaps ?? 0) > 0 ? 'text-amber-400' : 'text-emerald-400'}`}>
                          {(coverageSummary.data?.coverageGaps ?? 0) > 0 ? 'Needs attention' : 'All caught up'}
                        </p>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                <Card className="bg-card/50 border-border/50">
                  <CardHeader>
                    <CardTitle className="text-lg flex items-center gap-2">
                      <Layers className="w-5 h-5 text-primary" />
                      Coverage by Project
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    {coverageByProject.isLoading ? (
                      <div className="py-8 flex items-center justify-center"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
                    ) : (coverageByProject.data?.data || []).length === 0 ? (
                      <div className="text-center py-8 text-muted-foreground">
                        <Inbox className="w-12 h-12 mx-auto mb-3 opacity-50" />
                        <p>No project coverage data for this period</p>
                        <p className="text-sm">Generate tests via Autonomous Testing or User Stories to populate this view.</p>
                      </div>
                    ) : (
                      <div className="space-y-4">
                        {(coverageByProject.data?.data || []).map((item, index) => (
                          <div key={index} className="flex items-center gap-4 p-4 rounded-lg bg-background/50">
                            <div className="flex-1">
                              <div className="flex items-center justify-between mb-2">
                                <div>
                                  <p className="font-medium text-foreground">{item.project}</p>
                                  <p className="text-xs text-muted-foreground">{item.stories} stories | {item.testCases} test cases</p>
                                </div>
                                <Badge variant={item.source === 'User Stories' ? 'default' : 'secondary'}>
                                  {item.source}
                                </Badge>
                              </div>
                              <div className="flex items-center gap-3">
                                <Progress value={item.coverage} className="flex-1 h-2" />
                                <span className="text-sm font-medium text-foreground w-12">{item.coverage}%</span>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="execution" className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <Card className="bg-card/50 border-border/50">
                    <CardContent className="p-6 text-center">
                      <p className="text-4xl font-bold text-foreground">
                        {execSummary.isLoading ? <Loader2 className="w-7 h-7 animate-spin inline-block" /> : (execSummary.data?.totalRuns ?? 0)}
                      </p>
                      <p className="text-sm text-muted-foreground mt-1">Total Runs</p>
                    </CardContent>
                  </Card>
                  <Card className="bg-card/50 border-border/50">
                    <CardContent className="p-6">
                      <div className="flex items-center justify-center gap-6">
                        <div className="text-center">
                          <p className="text-2xl font-bold text-emerald-400">{execSummary.isLoading ? '—' : (execSummary.data?.passed ?? 0)}</p>
                          <p className="text-xs text-muted-foreground">Passed</p>
                        </div>
                        <div className="text-center">
                          <p className="text-2xl font-bold text-red-400">{execSummary.isLoading ? '—' : (execSummary.data?.failed ?? 0)}</p>
                          <p className="text-xs text-muted-foreground">Failed</p>
                        </div>
                        <div className="text-center">
                          <p className="text-2xl font-bold text-gray-400">{execSummary.isLoading ? '—' : (execSummary.data?.skipped ?? 0)}</p>
                          <p className="text-xs text-muted-foreground">Skipped</p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                  <Card className="bg-card/50 border-border/50">
                    <CardContent className="p-6 text-center">
                      <p className="text-4xl font-bold text-foreground">
                        {execSummary.isLoading ? <Loader2 className="w-7 h-7 animate-spin inline-block" /> : (execSummary.data?.avgDurationLabel || '—')}
                      </p>
                      <p className="text-sm text-muted-foreground mt-1">Avg Duration</p>
                    </CardContent>
                  </Card>
                </div>

                <Card className="bg-card/50 border-border/50">
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-lg flex items-center gap-2">
                        <Clock className="w-5 h-5 text-primary" />
                        Execution History
                      </CardTitle>
                      <Button
                        variant="outline"
                        size="sm"
                        data-testid="button-export-history"
                        onClick={exportExecutionHistoryCsv}
                      >
                        <Download className="w-4 h-4 mr-2" />
                        Export
                      </Button>
                    </div>
                  </CardHeader>
                  <CardContent>
                    {execHistory.isLoading ? (
                      <div className="py-8 flex items-center justify-center"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
                    ) : (execHistory.data?.data || []).length === 0 ? (
                      <div className="text-center py-8 text-muted-foreground">
                        <Inbox className="w-12 h-12 mx-auto mb-3 opacity-50" />
                        <p>No execution runs for this period</p>
                        <p className="text-sm">Try a wider date range or run some tests in Execution Mode.</p>
                      </div>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full">
                          <thead>
                            <tr className="border-b border-border">
                              <th className="text-left py-3 px-4 text-sm font-medium text-muted-foreground">Run ID</th>
                              <th className="text-left py-3 px-4 text-sm font-medium text-muted-foreground">Date</th>
                              <th className="text-left py-3 px-4 text-sm font-medium text-muted-foreground">Project</th>
                              <th className="text-left py-3 px-4 text-sm font-medium text-muted-foreground">Source</th>
                              <th className="text-left py-3 px-4 text-sm font-medium text-muted-foreground">Tests</th>
                              <th className="text-left py-3 px-4 text-sm font-medium text-muted-foreground">Passed</th>
                              <th className="text-left py-3 px-4 text-sm font-medium text-muted-foreground">Failed</th>
                              <th className="text-left py-3 px-4 text-sm font-medium text-muted-foreground">Duration</th>
                            </tr>
                          </thead>
                          <tbody>
                            {(execHistory.data?.data || []).map((item, index) => (
                              <tr key={item.id || index} className="border-b border-border/50 hover:bg-muted/50">
                                <td className="py-3 px-4 text-sm font-medium text-primary font-mono">{item.id.slice(0, 8)}</td>
                                <td className="py-3 px-4 text-sm text-muted-foreground">{item.date}</td>
                                <td className="py-3 px-4 text-sm text-foreground">{item.project}</td>
                                <td className="py-3 px-4">
                                  <Badge variant={item.source === 'User Stories' ? 'default' : 'secondary'} className="text-xs">
                                    {item.source}
                                  </Badge>
                                </td>
                                <td className="py-3 px-4 text-sm text-foreground">{item.tests}</td>
                                <td className="py-3 px-4 text-sm text-emerald-400">{item.passed}</td>
                                <td className="py-3 px-4 text-sm text-red-400">{item.failed}</td>
                                <td className="py-3 px-4 text-sm text-muted-foreground">{item.duration}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="custom" className="space-y-6">
                <Card className="bg-card/50 border-border/50">
                  <CardHeader>
                    <CardTitle className="text-lg flex items-center gap-2">
                      <Filter className="w-5 h-5 text-primary" />
                      Custom Report Builder
                    </CardTitle>
                    <CardDescription>Create custom reports with specific data and filters</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <div className="space-y-4">
                        <div>
                          <label className="text-sm font-medium text-foreground mb-2 block">Data Source</label>
                          <Select defaultValue="all">
                            <SelectTrigger data-testid="select-data-source">
                              <SelectValue placeholder="Select source" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="all">All Sources</SelectItem>
                              <SelectItem value="autonomous">Autonomous Testing</SelectItem>
                              <SelectItem value="stories">Generate from User Stories</SelectItem>
                              <SelectItem value="execution">Execution Mode</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div>
                          <label className="text-sm font-medium text-foreground mb-2 block">Chart Type</label>
                          <Select defaultValue="line">
                            <SelectTrigger data-testid="select-chart-type">
                              <SelectValue placeholder="Select chart type" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="line">Line Chart</SelectItem>
                              <SelectItem value="bar">Bar Chart</SelectItem>
                              <SelectItem value="pie">Pie Chart</SelectItem>
                              <SelectItem value="table">Table View</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                      <div className="space-y-4">
                        <div>
                          <label className="text-sm font-medium text-foreground mb-2 block">Metrics</label>
                          <Select defaultValue="testcases">
                            <SelectTrigger data-testid="select-metrics">
                              <SelectValue placeholder="Select metrics" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="testcases">Test Cases Generated</SelectItem>
                              <SelectItem value="executions">Executions</SelectItem>
                              <SelectItem value="coverage">Coverage</SelectItem>
                              <SelectItem value="passrate">Pass Rate</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div>
                          <label className="text-sm font-medium text-foreground mb-2 block">Group By</label>
                          <Select defaultValue="day">
                            <SelectTrigger data-testid="select-group-by">
                              <SelectValue placeholder="Select grouping" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="day">Daily</SelectItem>
                              <SelectItem value="week">Weekly</SelectItem>
                              <SelectItem value="month">Monthly</SelectItem>
                              <SelectItem value="project">By Project</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                    </div>
                    <div className="flex gap-3">
                      <Button data-testid="button-generate-report">
                        <BarChart3 className="w-4 h-4 mr-2" />
                        Generate Report
                      </Button>
                      <Button variant="outline" data-testid="button-save-report">
                        Save Report Template
                      </Button>
                    </div>
                  </CardContent>
                </Card>

                <Card className="bg-card/50 border-border/50">
                  <CardHeader>
                    <CardTitle className="text-lg">Saved Reports</CardTitle>
                    <CardDescription>Your custom report templates</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="text-center py-8 text-muted-foreground">
                      <FileText className="w-12 h-12 mx-auto mb-3 opacity-50" />
                      <p>No saved reports yet</p>
                      <p className="text-sm">Create a custom report above to save it as a template</p>
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>
        </div>
      </main>
    </>
  );
}
