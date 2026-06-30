import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  PieChart, Pie, Cell, ResponsiveContainer, BarChart, Bar,
  XAxis, YAxis, Tooltip, CartesianGrid, Legend,
} from "recharts";
import {
  Shield, Target, AlertTriangle, CheckCircle2, XCircle,
  TrendingUp, Eye, ChevronDown, ChevronUp, Zap,
  FileText, Brain, Layers, BarChart3, Activity,
} from "lucide-react";

interface CoverageDashboardProps {
  testCases: any[];
  traceabilityReport: any;
  coverageSummary?: any;
  acceptanceCriteria?: string;
}

// ─── Score Gauge (animated SVG) ──────────────────────────────────────────

function ScoreGauge({ value, size = 100, label, sublabel }: { value: number; size?: number; label: string; sublabel?: string }) {
  const r = (size - 12) / 2;
  const circumference = 2 * Math.PI * r;
  const offset = circumference - (value / 100) * circumference;
  const color = value >= 80 ? "#10b981" : value >= 50 ? "#f59e0b" : "#ef4444";
  const bg = value >= 80 ? "from-emerald-500/10 to-emerald-500/5" : value >= 50 ? "from-amber-500/10 to-amber-500/5" : "from-red-500/10 to-red-500/5";

  return (
    <div className="flex flex-col items-center">
      <div className="relative" style={{ width: size, height: size }}>
        <svg className="w-full h-full -rotate-90" viewBox={`0 0 ${size} ${size}`}>
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth="6" stroke="currentColor" className="text-muted/10" />
          <circle
            cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth="6" strokeLinecap="round"
            stroke={color}
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            style={{ transition: "stroke-dashoffset 1s ease-out" }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-2xl font-bold" style={{ color }}>{value}</span>
          <span className="text-[9px] text-muted-foreground">/ 100</span>
        </div>
      </div>
      <p className="text-xs font-semibold mt-2">{label}</p>
      {sublabel && <p className="text-[10px] text-muted-foreground">{sublabel}</p>}
    </div>
  );
}

// ─── Heatmap Cell ────────────────────────────────────────────────────────

function HeatmapCell({ depth, label }: { depth: number; label: string }) {
  const bg = depth === 0 ? "bg-red-500/80" : depth === 1 ? "bg-orange-500/60" : depth <= 3 ? "bg-amber-500/40" : "bg-emerald-500/60";
  const text = depth === 0 ? "text-white" : depth === 1 ? "text-white" : "text-white";
  return (
    <div className={`${bg} ${text} rounded px-2 py-0.5 text-center text-[10px] font-mono font-bold min-w-[28px]`} title={`${depth} tests: ${label}`}>
      {depth}
    </div>
  );
}

/** Recharts default tooltips often show blank labels because `name` is the dataKey ("value" / "count"). */
function DistributionTooltipContent({
  active,
  payload,
  label,
}: {
  active?: boolean;
  label?: string;
  payload?: ReadonlyArray<{
    value?: number | string;
    name?: string;
    payload?: { name?: string; value?: number; count?: number; key?: string };
  }>;
}) {
  if (!active || !payload?.length) return null;
  const first = payload[0];
  const row = first.payload ?? {};
  const displayName =
    (row.name != null && String(row.name).trim() !== "" ? String(row.name) : null) ??
    (label != null && String(label).trim() !== "" ? String(label) : null) ??
    "—";
  const raw =
    typeof row.count === "number"
      ? row.count
      : typeof row.value === "number"
        ? row.value
        : typeof first.value === "number"
          ? first.value
          : Number(first.value ?? 0);
  const count = Number.isFinite(raw) ? raw : 0;
  const unit = count === 1 ? "test" : "tests";
  return (
    <div className="z-[100] min-w-[120px] rounded-md border border-border bg-card px-3 py-2 text-xs shadow-md">
      <p className="font-semibold text-foreground">{displayName}</p>
      <p className="mt-0.5 text-muted-foreground">
        <span className="font-mono font-semibold tabular-nums text-foreground">{count}</span> {unit}
      </p>
    </div>
  );
}

// ─── Main Dashboard ──────────────────────────────────────────────────────

export function CoverageIntelligenceDashboard({ testCases, traceabilityReport, coverageSummary, acceptanceCriteria }: CoverageDashboardProps) {
  const [expanded, setExpanded] = useState(true);

  if (!testCases?.length && !traceabilityReport) return null;

  // ══════════════════════════════════════════════════════════════════
  // COVERAGE ENGINE — Requirements come from Acceptance Criteria (top-down)
  // ══════════════════════════════════════════════════════════════════

  const backendReport = traceabilityReport || {};
  const backendReqs = backendReport.requirements || [];

  // Step 1: Parse requirements from acceptance criteria TEXT (the source of truth)
  // Aggressively filter structural lines (section headers, markdown headings,
  // pure labels) so the parser doesn't promote "SUCCESS METRICS:", "## Design
  // Prompt", "Components:", etc. into phantom "ZERO test coverage" rows when
  // the user pastes a full user story with description + AC + design notes
  // into the textarea and the backend traceability report is absent.
  const BULLET_PREFIX_RE = /^(?:[-*•]\s*|\d+[.)]\s*|AC\s*\d+\s*[:.)]\s*|>\s*)+/i;

  const isStructuralLine = (raw: string): boolean => {
    let s = raw.trim();
    if (!s) return true;
    if (/^#+\s/.test(s)) return true;
    s = s.replace(BULLET_PREFIX_RE, "").trim();
    if (!s) return true;
    if (/^[^.!?]+:\s*$/.test(s) && s.length < 80) return true;
    if (/^[A-Z][A-Z\s&\/_\-:]+$/.test(s) && s.length < 50) return true;
    if (!/[.!?]/.test(s) && s.length < 80) {
      const words = s.split(/\s+/);
      const titleCount = words.filter(w => /^[A-Z][a-z0-9]+$/.test(w)).length;
      if (titleCount >= 3 && titleCount / words.length >= 0.6) return true;
    }
    return false;
  };

  // Section headers that mark the END of acceptance criteria. Anything below
  // these is design guidance (Figma instructions, UI flow steps, mockup
  // notes), not testable criteria, so we truncate the AC text at the first
  // such header. Mirrors the server-side filter in claude-test-generator.ts.
  const SECTION_BOUNDARY_RE = /^(?:#+\s*)?(?:design\s+prompt|figma(?:\s+make)?\s+instructions?|interaction\s+flow|user\s+interaction\s+flow|wireframe|mockup|create\s+(?:page|component|system\s+state|admin\s+page)|layout|components?|sections?|behavior|responsive\s+behavior|error\s+state|states|validation\s+rules|feedback\s+states|out\s+of\s+scope|technical\s+considerations|key\s+functionality|user\s+story\s+title|description|context\s*&\s*background|current\s+state|desired\s+state)\b\s*:?\s*$/i;
  const MAX_REQS = 25;

  let parsedReqs: { id: string; text: string; source: string }[] = [];
  if (acceptanceCriteria && acceptanceCriteria.trim()) {
    const allLines = acceptanceCriteria.split(/\n/).map(l => l.trim());

    let endIdx = allLines.length;
    for (let i = 0; i < allLines.length; i++) {
      if (SECTION_BOUNDARY_RE.test(allLines[i])) { endIdx = i; break; }
    }
    let region = allLines.slice(0, endIdx);

    const acHeaderRe = /^(?:#+\s*)?acceptance\s+criteria\s*:?\s*$/i;
    for (let i = region.length - 1; i >= 0; i--) {
      if (acHeaderRe.test(region[i])) { region = region.slice(i + 1); break; }
    }

    const lines = region.filter(l => l.length > 3 && !isStructuralLine(l));
    const seen = new Set<string>();
    const rawReqs = lines
      .map((line, idx) => {
        const cleaned = line.replace(BULLET_PREFIX_RE, "").trim();
        const id = line.match(/^AC\s*(\d+)/i) ? `AC${line.match(/^AC\s*(\d+)/i)![1]}` : `AC-${idx + 1}`;
        return { id, text: cleaned, source: "acceptance_criteria" };
      })
      .filter(r => r.text.length > 15 && !isStructuralLine(r.text))
      .filter(r => {
        const key = r.text.toLowerCase().slice(0, 60);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    parsedReqs = rawReqs.slice(0, MAX_REQS);
  }

  // Step 2: Map test cases to requirements using fuzzy matching
  // Stop words — these are too common and cause false matches
  const STOP_WORDS = new Set([
    "the", "that", "this", "with", "from", "have", "been", "will", "shall", "must",
    "should", "when", "then", "than", "each", "every", "into", "upon", "after",
    "before", "during", "between", "through", "system", "user", "page", "field",
    "button", "click", "enter", "display", "show", "verify", "confirm", "validate",
    "ensure", "check", "test", "action", "expected", "result", "data", "input",
    "output", "error", "message", "status", "value", "form", "submit", "save",
    "update", "delete", "create", "view", "list", "select", "option", "allow",
    "require", "process", "complete", "success", "fail", "invalid", "valid",
    "application", "screen", "navigate", "relevant", "module", "main", "perform",
  ]);

  const requirements = backendReqs.length > 0
    ? backendReqs
    : parsedReqs.map(req => {
        const coveredBy: string[] = [];
        // Extract MEANINGFUL words only (no stop words, length > 4)
        const reqWords = new Set(
          req.text.toLowerCase().split(/\s+/)
            .filter(w => w.length > 4 && !STOP_WORDS.has(w))
        );

        if (reqWords.size === 0) return { ...req, isCovered: false, coveredBy: [] };

        for (const tc of testCases) {
          // Check traceability field FIRST — direct match is strongest signal
          const traceText = (tc.traceability || "").toLowerCase();
          if (traceText.length > 10) {
            // Direct substring match in traceability field
            const reqLower = req.text.toLowerCase();
            const traceWords = new Set(traceText.split(/\s+/).filter((w: string) => w.length > 4 && !STOP_WORDS.has(w)));
            const directOverlap = [...reqWords].filter(w => traceWords.has(w)).length;
            const directRatio = directOverlap / reqWords.size;
            if (directRatio >= 0.5) {
              coveredBy.push(tc.testCaseId || tc.id || `TC-${testCases.indexOf(tc) + 1}`);
              continue;
            }
          }

          // Fallback: check objective + title with STRICT threshold
          const tcText = [tc.objective || "", tc.title || ""].join(" ").toLowerCase();
          const tcWords = new Set(tcText.split(/\s+/).filter((w: string) => w.length > 4 && !STOP_WORDS.has(w)));
          const overlap = [...reqWords].filter(w => tcWords.has(w)).length;
          const matchRatio = reqWords.size > 0 ? overlap / reqWords.size : 0;
          // Require >50% meaningful word overlap — much stricter
          if (matchRatio >= 0.5 && overlap >= 3) {
            coveredBy.push(tc.testCaseId || tc.id || `TC-${testCases.indexOf(tc) + 1}`);
          }
        }
        return { ...req, isCovered: coveredBy.length > 0, coveredBy };
      });

  const totalReqs = backendReport.totalRequirements || requirements.length;
  const coveredReqs = backendReport.coveredCount || requirements.filter((r: any) => r.isCovered).length;
  const uncoveredReqs = totalReqs - coveredReqs;
  const coveragePct = totalReqs > 0 ? Math.round((coveredReqs / totalReqs) * 100) : 0;
  const confidenceScore = backendReport.confidenceScore || (totalReqs > 0 ? Math.min(95, Math.round(65 + (coveredReqs / totalReqs) * 30)) : 0);

  // ── Category distribution ─────────────────────────────────────────
  const categories = ["functional", "negative", "edge_case", "security", "accessibility", "regression"];
  const categoryData = categories.map(cat => ({
    name: cat.replace("_", " ").replace(/\b\w/g, c => c.toUpperCase()),
    value: testCases.filter(tc => tc.category === cat).length,
    key: cat,
  })).filter(d => d.value > 0);

  const CATEGORY_COLORS: Record<string, string> = {
    functional: "#3b82f6", negative: "#f97316", "edge_case": "#8b5cf6",
    security: "#10b981", accessibility: "#06b6d4", regression: "#f43f5e",
  };
  const categoryChartColors = categoryData.map(d => CATEGORY_COLORS[d.key] || "#64748b");

  // ── Priority distribution ─────────────────────────────────────────
  const priorities = ["P0", "P1", "P2", "P3"];
  const priorityData = priorities.map(p => ({
    name: p,
    count: testCases.filter(tc => tc.priority === p).length,
  }));
  const PRIORITY_COLORS = ["#ef4444", "#f97316", "#f59e0b", "#3b82f6"];

  // ── Coverage depth per requirement ────────────────────────────────
  const reqDepth = requirements.map((req: any) => ({
    ...req,
    depth: req.coveredBy?.length || 0,
    depthLabel: !req.isCovered ? "None"
      : (req.coveredBy?.length || 0) <= 1 ? "Shallow"
      : (req.coveredBy?.length || 0) <= 3 ? "Moderate"
      : "Deep",
  }));

  // ── Risk analysis (intelligent) ───────────────────────────────────
  const risks: { text: string; severity: "critical" | "warning" | "info" }[] = [];

  // Uncovered requirements
  reqDepth.filter((r: any) => !r.isCovered).forEach((r: any) => {
    risks.push({ text: `"${(r.text || "").substring(0, 80)}${r.text?.length > 80 ? "..." : ""}" has ZERO test coverage`, severity: "critical" });
  });

  // Shallow coverage
  reqDepth.filter((r: any) => r.isCovered && r.depth === 1).forEach((r: any) => {
    risks.push({ text: `"${(r.text || "").substring(0, 60)}..." covered by only 1 test — shallow coverage`, severity: "warning" });
  });

  // Category balance checks
  const negCount = testCases.filter(tc => tc.category === "negative").length;
  const funCount = testCases.filter(tc => tc.category === "functional").length;
  const edgeCount = testCases.filter(tc => tc.category === "edge_case").length;
  const secCount = testCases.filter(tc => tc.category === "security").length;
  const a11yCount = testCases.filter(tc => tc.category === "accessibility").length;

  if (negCount === 0 && funCount > 0) {
    risks.push({ text: "No NEGATIVE tests generated — error paths and invalid inputs are untested", severity: "critical" });
  } else if (negCount > 0 && negCount < funCount * 0.3) {
    risks.push({ text: `Only ${negCount} negative tests vs ${funCount} functional — negative ratio is ${Math.round(negCount/funCount*100)}%, target is ≥30%`, severity: "warning" });
  } else if (negCount >= funCount * 0.3) {
    risks.push({ text: `Good negative-to-functional ratio: ${negCount}/${funCount} (${Math.round(negCount/funCount*100)}%)`, severity: "info" });
  }

  if (edgeCount === 0 && testCases.length > 10) {
    risks.push({ text: "No EDGE CASE tests — boundary values, limits, and concurrency scenarios untested", severity: "warning" });
  }
  if (secCount === 0 && testCases.length > 10) {
    risks.push({ text: "No SECURITY tests — authentication, authorization, injection, and XSS paths untested", severity: "warning" });
  } else if (secCount > 0) {
    risks.push({ text: `${secCount} security tests covering auth, injection, and access control`, severity: "info" });
  }
  if (a11yCount > 0) {
    risks.push({ text: `${a11yCount} accessibility tests covering WCAG compliance`, severity: "info" });
  }

  // Priority balance
  const p0Count = testCases.filter(tc => tc.priority === "P0").length;
  const p1Count = testCases.filter(tc => tc.priority === "P1").length;
  if (p0Count === 0 && testCases.length > 5) {
    risks.push({ text: "No P0 (critical) priority tests — ensure critical business paths are prioritized", severity: "warning" });
  }
  if (p1Count > testCases.length * 0.7) {
    risks.push({ text: `${Math.round(p1Count/testCases.length*100)}% of tests are P1 — consider spreading across priority levels`, severity: "warning" });
  }

  // Coverage achievements
  if (coveragePct >= 90) {
    risks.push({ text: `Excellent requirement coverage: ${coveragePct}% (${coveredReqs}/${totalReqs})`, severity: "info" });
  } else if (coveragePct >= 70) {
    risks.push({ text: `Good requirement coverage: ${coveragePct}% — ${uncoveredReqs} requirements need additional tests`, severity: "info" });
  }
  if (categoryData.length >= 4) {
    risks.push({ text: `Strong test diversity: ${categoryData.length} categories covered (${categoryData.map(d => d.name).join(", ")})`, severity: "info" });
  }
  if (p0Count === 0) {
    risks.push({ text: "No P0 (critical) priority tests — ensure critical paths are prioritized", severity: "warning" });
  }
  // Positive findings
  if (coveragePct >= 90) {
    risks.push({ text: `Excellent requirement coverage at ${coveragePct}%`, severity: "info" });
  }
  if (negCount >= funCount * 0.5) {
    risks.push({ text: `Good negative test ratio (${negCount}/${funCount})`, severity: "info" });
  }

  // ── Quality Score (intelligent, multi-factor) ──────────────────────
  // Factor 1: Requirement coverage (if we have requirements)
  const depthScore = totalReqs > 0
    ? reqDepth.reduce((s: number, r: any) => s + Math.min(r.depth, 3), 0) / Math.max(totalReqs * 3, 1) * 100
    : 50; // If no requirements traced, give neutral score

  // Factor 2: Category diversity (more categories = better testing)
  const categoryScore = Math.min(100, categoryData.length * 20); // 5 categories = 100

  // Factor 3: Priority balance (spread across P0-P3 is better)
  const activePriorities = priorityData.filter(p => p.count > 0).length;
  const priorityScore = Math.min(100, activePriorities * 30); // 3+ priorities = 90-100

  // Factor 4: Negative/Edge ratio (should be ≥20% of total)
  const negEdgeRatio = testCases.length > 0 ? (negCount + edgeCount) / testCases.length : 0;
  const ratioScore = Math.min(100, Math.round(negEdgeRatio * 300)); // 33% neg+edge = 100

  // Factor 5: Test volume adequacy (more tests per requirement = better)
  const volumeScore = totalReqs > 0
    ? Math.min(100, Math.round((testCases.length / totalReqs) * 25)) // 4 tests/req = 100
    : Math.min(100, Math.round(testCases.length * 2)); // Without reqs, score by volume

  // Weighted quality score
  const qualityScore = totalReqs > 0
    ? Math.round((coveragePct * 0.30) + (depthScore * 0.20) + (categoryScore * 0.20) + (ratioScore * 0.15) + (priorityScore * 0.15))
    : Math.round((categoryScore * 0.30) + (ratioScore * 0.25) + (priorityScore * 0.20) + (volumeScore * 0.25));

  return (
    <div className="space-y-4" data-testid="coverage-intelligence-dashboard">

      {/* ─── ROW 1: Score Gauges ──────────────────────────────────── */}
      <Card className="overflow-hidden shadow-lg border border-border/50">
        <div className="h-1.5 bg-gradient-to-r from-blue-500 via-emerald-500 via-amber-500 to-violet-500" />
        <CardContent className="p-6">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-2">
              <BarChart3 className="w-5 h-5 text-blue-400" />
              <h3 className="text-base font-bold">Coverage Intelligence</h3>
            </div>
            <Badge variant="outline" className="text-xs">{testCases.length} test cases • {totalReqs} requirements</Badge>
          </div>

          {/* Row 1: Score gauges — responsive grid */}
          <div className="flex items-center justify-around gap-2 mb-4">
            <ScoreGauge value={qualityScore} size={80} label="Quality Score" sublabel="Overall test quality" />
            <ScoreGauge value={coveragePct} size={80} label="Req Coverage" sublabel={`${coveredReqs}/${totalReqs} covered`} />
            <ScoreGauge value={confidenceScore} size={80} label="Confidence" sublabel="Traceability" />
            <ScoreGauge value={Math.round(depthScore)} size={80} label="Depth" sublabel="Tests/requirement" />
          </div>

          {/* Row 2: Quick stat pills */}
          <div className="flex flex-wrap gap-3">
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-red-500/10 border border-red-500/20">
              <XCircle className="w-3.5 h-3.5 text-red-400" />
              <span className="text-sm font-bold text-red-400">{uncoveredReqs}</span>
              <span className="text-[10px] text-muted-foreground">Uncovered</span>
            </div>
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-amber-500/10 border border-amber-500/20">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
              <span className="text-sm font-bold text-amber-400">{risks.filter(r => r.severity === "critical" || r.severity === "warning").length}</span>
              <span className="text-[10px] text-muted-foreground">Risks</span>
            </div>
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
              <span className="text-sm font-bold text-emerald-400">{testCases.length}</span>
              <span className="text-[10px] text-muted-foreground">Test Cases</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ─── ROW 2: Charts ────────────────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">

        {/* Category Distribution (Donut) */}
        <Card>
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-sm flex items-center gap-2">
              <Layers className="w-4 h-4 text-blue-400" />
              Test Category Distribution
            </CardTitle>
          </CardHeader>
          <CardContent className="px-2 pb-2">
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie
                  data={categoryData}
                  cx="50%"
                  cy="50%"
                  innerRadius={50}
                  outerRadius={75}
                  paddingAngle={3}
                  dataKey="value"
                  nameKey="name"
                  stroke="none"
                >
                  {categoryData.map((_, idx) => (
                    <Cell key={idx} fill={categoryChartColors[idx]} />
                  ))}
                </Pie>
                <Tooltip content={DistributionTooltipContent} wrapperStyle={{ zIndex: 100 }} />
              </PieChart>
            </ResponsiveContainer>
            <div className="flex flex-wrap gap-2 px-2">
              {categoryData.map((d, i) => (
                <div key={d.key} className="flex items-center gap-1.5 text-[10px]">
                  <div className="w-2 h-2 rounded-full" style={{ backgroundColor: categoryChartColors[i] }} />
                  <span className="text-muted-foreground">{d.name}</span>
                  <span className="font-bold">{d.value}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Priority Distribution (Bar) */}
        <Card>
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-sm flex items-center gap-2">
              <Target className="w-4 h-4 text-amber-400" />
              Priority Distribution
            </CardTitle>
          </CardHeader>
          <CardContent className="px-2 pb-2">
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={priorityData} barSize={32}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                <XAxis dataKey="name" tick={{ fontSize: 11, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
                <Tooltip content={DistributionTooltipContent} wrapperStyle={{ zIndex: 100 }} />
                <Bar dataKey="count" name="Tests" radius={[6, 6, 0, 0]}>
                  {priorityData.map((_, idx) => (
                    <Cell key={idx} fill={PRIORITY_COLORS[idx]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
            <div className="flex justify-around px-2">
              {priorityData.map((d, i) => (
                <div key={d.name} className="text-center">
                  <span className="text-xs font-bold" style={{ color: PRIORITY_COLORS[i] }}>{d.count}</span>
                  <p className="text-[9px] text-muted-foreground">{d.name === "P0" ? "Critical" : d.name === "P1" ? "High" : d.name === "P2" ? "Medium" : "Low"}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Risk Analysis */}
        <Card>
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-sm flex items-center gap-2">
              <Brain className="w-4 h-4 text-violet-400" />
              Risk Analysis
              <Badge variant="outline" className="text-[10px] ml-auto flex-shrink-0">{risks.length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="px-3 pb-3">
            <ScrollArea className="h-[220px]">
              <div className="space-y-2">
                {risks.map((risk, i) => (
                  <div key={i} className={`p-2.5 rounded-lg border text-xs ${
                    risk.severity === "critical" ? "bg-red-500/10 border-red-500/30" :
                    risk.severity === "warning" ? "bg-amber-500/10 border-amber-500/30" :
                    "bg-muted/30 border-border/30"
                  }`}>
                    <div className="flex items-start gap-2">
                      {risk.severity === "critical" ? <XCircle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0 text-red-400" /> :
                       risk.severity === "warning" ? <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0 text-amber-400" /> :
                       <CheckCircle2 className="w-3.5 h-3.5 mt-0.5 flex-shrink-0 text-emerald-400" />}
                      <span className={`break-words ${
                        risk.severity === "critical" ? "text-red-400" :
                        risk.severity === "warning" ? "text-amber-400" :
                        "text-foreground"
                      }`}>{risk.text}</span>
                    </div>
                  </div>
                ))}
                {risks.length === 0 && (
                  <p className="text-xs text-muted-foreground text-center py-4">No risk findings</p>
                )}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
      </div>

      {/* ─── ROW 3: Requirement Heatmap ───────────────────────────── */}
      <Card>
        <CardHeader className="pb-2 pt-4 px-5">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm flex items-center gap-2">
              <Activity className="w-4 h-4 text-cyan-400" />
              Requirement Coverage Heatmap
            </CardTitle>
            <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
              <span className="flex items-center gap-1"><div className="w-3 h-3 rounded bg-red-500/80" /> 0 tests</span>
              <span className="flex items-center gap-1"><div className="w-3 h-3 rounded bg-orange-500/60" /> 1 test</span>
              <span className="flex items-center gap-1"><div className="w-3 h-3 rounded bg-amber-500/40" /> 2-3 tests</span>
              <span className="flex items-center gap-1"><div className="w-3 h-3 rounded bg-emerald-500/60" /> 4+ tests</span>
            </div>
          </div>
        </CardHeader>
        <CardContent className="px-5 pb-4">
          <div className="space-y-2">
            {reqDepth.map((req: any, i: number) => (
              <div key={i} className={`p-3 rounded-lg border transition-colors ${
                req.depth === 0 ? "bg-red-500/5 border-red-500/20" :
                req.depth === 1 ? "bg-orange-500/5 border-orange-500/20" :
                req.depth <= 3 ? "bg-amber-500/5 border-amber-500/15" :
                "bg-emerald-500/5 border-emerald-500/20"
              }`}>
                <div className="flex items-start gap-3">
                  {/* Depth indicator */}
                  <HeatmapCell depth={req.depth} label={req.text || ""} />

                  {/* Depth badge */}
                  <Badge variant="outline" className={`text-[9px] w-16 justify-center flex-shrink-0 ${
                    req.depthLabel === "None" ? "text-red-400 border-red-500/30" :
                    req.depthLabel === "Shallow" ? "text-orange-400 border-orange-500/30" :
                    req.depthLabel === "Moderate" ? "text-amber-400 border-amber-500/30" :
                    "text-emerald-400 border-emerald-500/30"
                  }`}>
                    {req.depthLabel}
                  </Badge>

                {/* Requirement text */}
                <div className="flex-1 min-w-0">
                  <p className="text-xs" style={{ wordBreak: 'normal', overflowWrap: 'anywhere' }}>{req.text}</p>
                  <p className="text-[10px] text-muted-foreground capitalize">{(req.source || "").replace("_", " ")}</p>
                </div>

                </div>
                {/* Test case chips — second row */}
                {(req.coveredBy?.length || 0) > 0 && (
                  <div className="flex flex-wrap gap-1 mt-2 ml-10">
                    {(req.coveredBy || []).slice(0, 8).map((tcId: string) => (
                      <span key={tcId} className="text-[9px] px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-300 font-mono">{tcId}</span>
                    ))}
                    {(req.coveredBy?.length || 0) > 8 && (
                      <span className="text-[9px] text-muted-foreground">+{req.coveredBy.length - 8} more</span>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* ─── ROW 4: Full Traceability Matrix Grid ─────────────────── */}
      <Card>
        <CardHeader className="pb-2 pt-4 px-5">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm flex items-center gap-2">
              <Shield className="w-4 h-4 text-emerald-400" />
              Traceability Matrix
              <Badge variant="outline" className="text-[10px]">{coveredReqs}/{totalReqs} requirements covered</Badge>
            </CardTitle>
            <Button variant="ghost" size="sm" onClick={() => setExpanded(e => !e)}>
              {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              {expanded ? "Collapse" : "Expand"}
            </Button>
          </div>
        </CardHeader>
        {expanded && (
          <CardContent className="px-5 pb-4">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border/30">
                    <th className="text-left py-2 px-2 text-muted-foreground font-medium w-[40%]">Requirement</th>
                    <th className="text-center py-2 px-2 text-muted-foreground font-medium w-[10%]">Status</th>
                    <th className="text-center py-2 px-2 text-muted-foreground font-medium w-[10%]">Depth</th>
                    <th className="text-left py-2 px-2 text-muted-foreground font-medium w-[40%]">Linked Test Cases</th>
                  </tr>
                </thead>
                <tbody>
                  {reqDepth.map((req: any, i: number) => (
                    <tr key={i} className="border-b border-border/10 hover:bg-muted/20">
                      <td className="py-2 px-2">
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] font-mono text-muted-foreground">{req.id}</span>
                          <span style={{ wordBreak: 'normal', overflowWrap: 'anywhere' }}>{req.text}</span>
                        </div>
                      </td>
                      <td className="py-2 px-2 text-center">
                        {req.isCovered
                          ? <CheckCircle2 className="w-4 h-4 text-emerald-400 mx-auto" />
                          : <XCircle className="w-4 h-4 text-red-400 mx-auto" />}
                      </td>
                      <td className="py-2 px-2 text-center">
                        <HeatmapCell depth={req.depth} label="" />
                      </td>
                      <td className="py-2 px-2">
                        <div className="flex flex-wrap gap-1">
                          {(req.coveredBy || []).map((tcId: string) => {
                            const tc = testCases.find(t => t.testCaseId === tcId);
                            const catColor = tc ? (CATEGORY_COLORS[tc.category] || "#64748b") : "#64748b";
                            return (
                              <span key={tcId} className="text-[9px] px-1.5 py-0.5 rounded font-mono" style={{ background: catColor + "25", color: catColor }}>
                                {tcId}
                              </span>
                            );
                          })}
                          {!req.isCovered && <span className="text-[9px] text-red-400 italic">No tests</span>}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        )}
      </Card>
    </div>
  );
}
