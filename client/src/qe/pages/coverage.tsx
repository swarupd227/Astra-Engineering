import { useState, useEffect, useRef, useCallback } from "react";
import { Link } from "wouter";
import { DashboardHeader } from "@/components/dashboard/header";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import {
  Target,
  RefreshCw,
  Library,
  CircleDot,
  Bot,
  Sparkles,
  Loader2,
  Inbox,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Globe,
  ShoppingCart,
  Search,
  LayoutDashboard,
  Package,
  User,
  Headphones,
  BarChart3,
  Settings,
  Lock,
  FileText,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────

interface PageCoverage {
  path: string;
  domain: string;
  testCount: number;
  passCount: number;
  failCount: number;
  neverCount: number;
  lastRunAt: number | null;
  testNames: string[];
}

interface DomainCoverage {
  domain: string;
  testCount: number;
  passRate: number;
  pageCount: number;
}

interface CoverageReport {
  totalTests: number;
  totalDiscoveredPages: number;
  coveredPages: number;
  coveragePct: number;
  passRate: number;
  executedRate: number;
  byPage: PageCoverage[];
  byDomain: DomainCoverage[];
  uncoveredPages: string[];
  generatedAt: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const GAUGE_VARIANTS = {
  emerald: { track: "text-emerald-500/25", fill: "text-emerald-500" },
  blue: { track: "text-blue-500/25", fill: "text-blue-500" },
  violet: { track: "text-violet-500/25", fill: "text-violet-500" },
} as const;

function CoverageGauge({
  pct,
  label,
  variant,
}: {
  pct: number;
  label: string;
  variant: keyof typeof GAUGE_VARIANTS;
}) {
  const r = 36;
  const circ = 2 * Math.PI * r;
  const dash = (pct / 100) * circ;
  const { track, fill } = GAUGE_VARIANTS[variant];

  return (
    <div className="flex flex-col items-center gap-1">
      <svg width="88" height="88" viewBox="0 0 88 88" className={fill}>
        <circle cx="44" cy="44" r={r} fill="none" stroke="currentColor" strokeWidth="8" className={track} />
        <circle
          cx="44"
          cy="44"
          r={r}
          fill="none"
          stroke="currentColor"
          strokeWidth="8"
          strokeDasharray={`${dash} ${circ}`}
          strokeDashoffset={circ / 4}
          strokeLinecap="round"
          style={{ transition: "stroke-dasharray 0.8s ease" }}
        />
        <text x="44" y="48" textAnchor="middle" className="fill-foreground" fontSize="14" fontWeight="bold">
          {pct}%
        </text>
      </svg>
      <span className="text-[10px] text-muted-foreground text-center">{label}</span>
    </div>
  );
}

const DOMAIN_ICONS: Record<string, LucideIcon> = {
  auth: Lock,
  checkout: ShoppingCart,
  registration: FileText,
  search: Search,
  dashboard: LayoutDashboard,
  catalog: Package,
  profile: User,
  support: Headphones,
  reporting: BarChart3,
  admin: Settings,
  general: Globe,
};

function DomainIcon({ domain, className }: { domain: string; className?: string }) {
  const Icon = DOMAIN_ICONS[domain] ?? Globe;
  return <Icon className={cn("w-4 h-4 text-muted-foreground", className)} />;
}

function passRateColor(rate: number): string {
  if (rate >= 80) return "text-emerald-500";
  if (rate >= 50) return "text-amber-500";
  return "text-red-500";
}

function coverageAccent(pct: number): string {
  if (pct >= 80) return "text-emerald-500";
  if (pct >= 50) return "text-amber-500";
  return "text-red-500";
}

function statusBadge(pass: number, fail: number, never: number) {
  if (fail > 0) {
    return (
      <Badge variant="outline" className="text-[10px] border-red-500/30 text-red-500 bg-red-500/10">
        FAILING
      </Badge>
    );
  }
  if (never > 0 && pass === 0) {
    return (
      <Badge variant="outline" className="text-[10px] text-muted-foreground">
        NEVER RUN
      </Badge>
    );
  }
  if (pass > 0) {
    return (
      <Badge variant="outline" className="text-[10px] border-emerald-500/30 text-emerald-500 bg-emerald-500/10">
        PASSING
      </Badge>
    );
  }
  return null;
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function CoveragePage() {
  const [report, setReport] = useState<CoverageReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [insightsText, setInsightsText] = useState("");
  const [insightsDone, setInsightsDone] = useState(false);
  const [insightsLoading, setInsightsLoading] = useState(false);
  const [activeTab, setActiveTab] = useState("pages");
  const [domainFilter, setDomainFilter] = useState("all");
  const insightsRef = useRef<HTMLDivElement>(null);

  const loadReport = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/coverage/report");
      if (!res.ok) {
        setReport(null);
        return;
      }
      const data = (await res.json()) as CoverageReport;
      if (typeof data.totalTests !== "number") {
        setReport(null);
        return;
      }
      setReport(data);
    } catch {
      setReport(null);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    loadReport();
  }, [loadReport]);

  useEffect(() => {
    if (insightsRef.current) insightsRef.current.scrollTop = insightsRef.current.scrollHeight;
  }, [insightsText]);

  const fetchInsights = useCallback(async () => {
    setInsightsText("");
    setInsightsDone(false);
    setInsightsLoading(true);
    try {
      const res = await fetch("/api/coverage/insights");
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const parts = buf.split("\n\n");
        buf = parts.pop() || "";
        for (const part of parts) {
          const line = part.replace(/^data: /, "").trim();
          if (!line) continue;
          try {
            const evt = JSON.parse(line);
            if (evt.type === "chunk") setInsightsText((prev) => prev + evt.text);
            if (evt.type === "done") setInsightsDone(true);
          } catch {
            /* ignore malformed SSE chunks */
          }
        }
      }
    } catch (e: unknown) {
      setInsightsText(`Error: ${e instanceof Error ? e.message : "Analysis failed"}`);
    }
    setInsightsLoading(false);
  }, []);

  const filteredPages =
    report?.byPage?.filter((p) => domainFilter === "all" || p.domain === domainFilter) ?? [];

  const domains = [...new Set(report?.byPage?.map((p) => p.domain) ?? [])].sort();
  const empty = !report || !report.totalTests;

  return (
    <>
      <DashboardHeader />

      <main className="flex-1 overflow-y-auto p-6">
        <div className="space-y-6">
          {/* Page header */}
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <Link href="/dashboard">
                <Button variant="outline" size="sm" className="text-xs">
                  ← Dashboard
                </Button>
              </Link>
              <div>
                <h1 className="text-2xl font-bold text-foreground flex items-center gap-3">
                  <Target className="w-7 h-7 text-primary" />
                  Coverage Reporter
                </h1>
                <p className="text-muted-foreground mt-1 text-sm">
                  Page-level coverage from your recorded test library
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={loadReport} disabled={loading}>
                <RefreshCw className={cn("w-4 h-4 mr-2", loading && "animate-spin")} />
                Refresh
              </Button>
              <Link href="/test-library">
                <Button variant="outline" size="sm">
                  <Library className="w-4 h-4 mr-2" />
                  Test Library
                </Button>
              </Link>
              <Link href="/recorder">
                <Button size="sm">
                  <CircleDot className="w-4 h-4 mr-2" />
                  Record Test
                </Button>
              </Link>
            </div>
          </div>

          {loading ? (
            <div className="flex flex-col items-center justify-center gap-4 py-24 text-muted-foreground">
              <Loader2 className="w-8 h-8 animate-spin text-primary" />
              <span className="text-sm">Loading coverage report…</span>
            </div>
          ) : empty ? (
            <Card className="rounded-2xl shadow-sm border border-border/40 border-l-[3px] border-l-violet-500 bg-card/50">
              <CardContent className="flex flex-col items-center justify-center gap-4 py-16">
                <div className="w-14 h-14 rounded-xl bg-violet-500/20 flex items-center justify-center">
                  <Target className="w-7 h-7 text-violet-400" />
                </div>
                <CardTitle className="text-lg">No tests recorded yet</CardTitle>
                <CardDescription className="text-center max-w-sm">
                  Record user flows in the Test Library to start tracking page coverage and pass rates.
                </CardDescription>
                <Link href="/recorder">
                  <Button>
                    <CircleDot className="w-4 h-4 mr-2" />
                    Record First Test
                  </Button>
                </Link>
              </CardContent>
            </Card>
          ) : (
            <>
              {/* KPI row */}
              <Card className="rounded-2xl shadow-sm border border-border/40 border-l-[3px] border-l-emerald-500 bg-card/50">
                <CardContent className="p-6">
                  <div className="flex flex-wrap items-center justify-between gap-8">
                    <div className="flex items-center gap-8">
                      <CoverageGauge pct={report!.coveragePct} label="Page Coverage" variant="emerald" />
                      <CoverageGauge pct={report!.passRate} label="Pass Rate" variant="blue" />
                      <CoverageGauge pct={report!.executedRate} label="Tests Executed" variant="violet" />
                    </div>

                    <div className="flex flex-wrap items-center gap-6">
                      {[
                        { val: report?.totalTests ?? 0, label: "Total Tests", color: "text-foreground" },
                        { val: report?.coveredPages ?? 0, label: "Pages Covered", color: "text-emerald-500" },
                        { val: report?.totalDiscoveredPages ?? 0, label: "Pages Found", color: "text-muted-foreground" },
                        { val: report?.uncoveredPages?.length ?? 0, label: "Untested Pages", color: "text-amber-500" },
                      ].map((s) => (
                        <div key={s.label} className="text-center">
                          <div className={cn("text-2xl font-bold", s.color)}>{s.val}</div>
                          <div className="text-[10px] text-muted-foreground">{s.label}</div>
                        </div>
                      ))}
                    </div>

                    <Card className="bg-muted/30 border-border/50 min-w-[160px]">
                      <CardContent className="p-4 flex flex-col items-center gap-1">
                        <p className="text-[10px] text-primary font-semibold uppercase tracking-wider">
                          Overall Coverage
                        </p>
                        <p className={cn("text-5xl font-black", coverageAccent(report!.coveragePct))}>
                          {report!.coveragePct}%
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {report!.coveredPages} / {report!.totalDiscoveredPages} pages
                        </p>
                        <Progress value={report!.coveragePct} className="w-32 h-1.5 mt-2" />
                      </CardContent>
                    </Card>
                  </div>
                </CardContent>
              </Card>

              {/* Detail + insights */}
              <div className="grid grid-cols-1 xl:grid-cols-[1fr_380px] gap-6">
                <Card className="rounded-2xl shadow-sm border border-border/40 border-l-[3px] border-l-blue-500 bg-card/50 overflow-hidden flex flex-col min-h-[420px]">
                  <Tabs value={activeTab} onValueChange={setActiveTab} className="flex flex-col flex-1 min-h-0">
                  <CardHeader className="pb-3 border-b border-border/40">
                      <div className="flex flex-wrap items-center gap-3">
                        <TabsList className="bg-muted/50 border border-border/40">
                          <TabsTrigger value="pages">
                            Pages ({report?.byPage?.length ?? 0})
                          </TabsTrigger>
                          <TabsTrigger value="domains">
                            Domains ({report?.byDomain?.length ?? 0})
                          </TabsTrigger>
                          <TabsTrigger value="uncovered">
                            Untested ({report?.uncoveredPages?.length ?? 0})
                          </TabsTrigger>
                        </TabsList>
                        {activeTab === "pages" && domains.length > 1 && (
                          <Select value={domainFilter} onValueChange={setDomainFilter}>
                            <SelectTrigger className="w-40 h-8 ml-auto text-xs">
                              <SelectValue placeholder="All domains" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="all">All domains</SelectItem>
                              {domains.map((d) => (
                                <SelectItem key={d} value={d}>
                                  {d}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        )}
                      </div>
                  </CardHeader>

                  <CardContent className="flex-1 overflow-auto p-4 space-y-2 max-h-[520px]">
                      <TabsContent value="pages" className="mt-0 space-y-2">
                        {filteredPages.length === 0 ? (
                          <div className="flex flex-col items-center justify-center h-40 text-muted-foreground gap-2">
                            <Inbox className="w-8 h-8 opacity-50" />
                            <p className="text-sm">No pages match filter</p>
                          </div>
                        ) : (
                          filteredPages.map((page, i) => {
                            const total = page.passCount + page.failCount + page.neverCount;
                            const passPct = total > 0 ? Math.round((page.passCount / total) * 100) : 0;
                            return (
                              <div
                                key={i}
                                className="rounded-xl border border-border/40 bg-muted/20 p-3 hover:bg-muted/30 transition-colors"
                              >
                                <div className="flex items-start gap-3">
                                  <DomainIcon domain={page.domain} className="mt-0.5 shrink-0" />
                                  <div className="flex-1 min-w-0">
                                    <div className="flex flex-wrap items-center gap-2 mb-1">
                                      <span className="font-mono text-xs text-primary font-semibold truncate">
                                        {page.path}
                                      </span>
                                      <Badge variant="secondary" className="text-[10px] capitalize">
                                        {page.domain}
                                      </Badge>
                                      {statusBadge(page.passCount, page.failCount, page.neverCount)}
                                    </div>
                                    <div className="flex items-center gap-2 mb-1.5">
                                      <Progress value={passPct} className="flex-1 h-1" />
                                      <span className={cn("text-[10px] font-bold shrink-0", passRateColor(passPct))}>
                                        {passPct}%
                                      </span>
                                    </div>
                                    <div className="flex flex-wrap gap-1">
                                      {page.testNames?.slice(0, 4).map((name, j) => (
                                        <Badge key={j} variant="outline" className="text-[10px] font-normal max-w-[180px] truncate">
                                          {name}
                                        </Badge>
                                      ))}
                                      {(page.testNames?.length ?? 0) > 4 && (
                                        <span className="text-[10px] text-muted-foreground">
                                          +{(page.testNames?.length ?? 0) - 4} more
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                  <div className="shrink-0 text-right">
                                    <div className="text-sm font-bold text-foreground">{page.testCount}</div>
                                    <div className="text-[10px] text-muted-foreground">tests</div>
                                    <div className="flex gap-1 mt-1 justify-end text-[10px]">
                                      {page.passCount > 0 && (
                                        <span className="text-emerald-500 flex items-center gap-0.5">
                                          <CheckCircle2 className="w-3 h-3" />
                                          {page.passCount}
                                        </span>
                                      )}
                                      {page.failCount > 0 && (
                                        <span className="text-red-500 flex items-center gap-0.5">
                                          <XCircle className="w-3 h-3" />
                                          {page.failCount}
                                        </span>
                                      )}
                                      {page.neverCount > 0 && (
                                        <span className="text-muted-foreground">{page.neverCount} pending</span>
                                      )}
                                    </div>
                                  </div>
                                </div>
                              </div>
                            );
                          })
                        )}
                      </TabsContent>

                      <TabsContent value="domains" className="mt-0 space-y-2">
                        {(report?.byDomain ?? []).map((dom, i) => (
                          <div
                            key={i}
                            className="rounded-xl border border-border/40 bg-muted/20 p-3 hover:bg-muted/30 transition-colors"
                          >
                            <div className="flex items-center gap-3">
                              <DomainIcon domain={dom.domain} className="w-5 h-5" />
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 mb-1.5">
                                  <span className="text-sm font-bold text-foreground capitalize">{dom.domain}</span>
                                  <span className="text-[10px] text-muted-foreground">
                                    {dom.pageCount} page{dom.pageCount !== 1 ? "s" : ""}
                                  </span>
                                </div>
                                <div className="flex items-center gap-2">
                                  <Progress value={dom.passRate} className="flex-1 h-1.5" />
                                  <span className={cn("text-[10px] font-bold shrink-0", passRateColor(dom.passRate))}>
                                    {dom.passRate}% pass
                                  </span>
                                </div>
                              </div>
                              <div className="text-right shrink-0">
                                <div className="text-xl font-black text-foreground">{dom.testCount}</div>
                                <div className="text-[10px] text-muted-foreground">tests</div>
                              </div>
                            </div>
                          </div>
                        ))}
                      </TabsContent>

                      <TabsContent value="uncovered" className="mt-0 space-y-2">
                        {(report?.uncoveredPages?.length ?? 0) === 0 ? (
                          <div className="flex flex-col items-center justify-center h-40 gap-3 text-muted-foreground">
                            <CheckCircle2 className="w-10 h-10 text-emerald-500/50" />
                            <p className="text-sm">No uncovered pages detected in navigation</p>
                          </div>
                        ) : (
                          <>
                            <div className="px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/20 text-xs text-amber-600 dark:text-amber-400 flex items-start gap-2">
                              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                              These pages were visited during recorded tests but have no dedicated test starting from them.
                            </div>
                            {(report?.uncoveredPages ?? []).map((pagePath, i) => (
                              <div
                                key={i}
                                className="flex items-center gap-3 px-3 py-2.5 rounded-xl border border-amber-500/20 bg-amber-500/5 hover:bg-amber-500/10 transition-colors"
                              >
                                <span className="text-amber-500 text-xs">○</span>
                                <span className="font-mono text-xs text-foreground flex-1">{pagePath}</span>
                                <Link href="/recorder">
                                  <Button variant="outline" size="sm" className="h-7 text-xs">
                                    <CircleDot className="w-3 h-3 mr-1" />
                                    Record
                                  </Button>
                                </Link>
                              </div>
                            ))}
                          </>
                        )}
                      </TabsContent>
                  </CardContent>
                  </Tabs>
                </Card>

                {/* Insights panel */}
                <Card className="rounded-2xl shadow-sm border border-border/40 border-l-[3px] border-l-violet-500 bg-card/50 flex flex-col min-h-[420px]">
                  <CardHeader className="pb-3 border-b border-border/40">
                    <div className="flex items-center gap-2">
                      <Bot className="w-4 h-4 text-primary" />
                      <CardTitle className="text-sm">Claude Coverage Insights</CardTitle>
                      {insightsLoading && <Loader2 className="w-3 h-3 animate-spin text-primary ml-1" />}
                      {insightsDone && (
                        <Badge variant="outline" className="text-[10px] ml-1 text-primary border-primary/30">
                          done
                        </Badge>
                      )}
                      <Button
                        size="sm"
                        variant="secondary"
                        className="ml-auto h-8 text-xs"
                        onClick={fetchInsights}
                        disabled={insightsLoading}
                      >
                        <Sparkles className="w-3 h-3 mr-1.5" />
                        {insightsLoading ? "Analysing…" : insightsText ? "Re-analyse" : "Analyse Gaps"}
                      </Button>
                    </div>
                  </CardHeader>

                  <CardContent className="flex-1 overflow-auto p-4 max-h-[460px]">
                    <div ref={insightsRef} className="h-full min-h-[200px]">
                    {!insightsText && !insightsLoading && (
                      <div className="flex flex-col items-center justify-center h-full min-h-[200px] gap-4 text-muted-foreground">
                        <Bot className="w-10 h-10 opacity-40" />
                        <p className="text-xs text-center max-w-[260px]">
                          Click <strong className="text-foreground">Analyse Gaps</strong> to let Claude review your
                          coverage and recommend which flows to test next.
                        </p>
                      </div>
                    )}

                    {insightsLoading && !insightsText && (
                      <div className="flex flex-col items-center justify-center h-full min-h-[200px] gap-3 text-muted-foreground">
                        <Loader2 className="w-6 h-6 animate-spin text-primary" />
                        <span className="text-xs">Analysing your test suite…</span>
                      </div>
                    )}

                    {insightsText && (
                      <Card className="bg-primary/5 border-primary/20">
                        <CardHeader className="py-2 px-3 border-b border-primary/10">
                          <CardDescription className="text-[10px] font-bold text-primary uppercase tracking-wide flex items-center gap-1.5">
                            <Sparkles className="w-3 h-3" />
                            Coverage gap analysis
                          </CardDescription>
                        </CardHeader>
                        <CardContent className="px-4 py-3 text-xs text-foreground leading-relaxed whitespace-pre-wrap">
                          {insightsText.split(/^(#{1,3} .+)$/m).map((part, i) => {
                            if (/^#{1,3} /.test(part)) {
                              return (
                                <div key={i} className="font-semibold text-primary mt-3 mb-1">
                                  {part.replace(/^#{1,3} /, "")}
                                </div>
                              );
                            }
                            return <span key={i}>{part}</span>;
                          })}
                        </CardContent>
                      </Card>
                    )}
                    </div>
                  </CardContent>

                  {report && (
                    <div className="px-4 py-2 border-t border-border/40 text-[10px] text-muted-foreground">
                      Report generated {new Date(report.generatedAt).toLocaleTimeString()}
                    </div>
                  )}
                </Card>
              </div>
            </>
          )}
        </div>
      </main>
    </>
  );
}
