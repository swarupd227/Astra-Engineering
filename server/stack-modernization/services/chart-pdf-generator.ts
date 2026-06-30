/**
 * Chart PDF Generator - Business-grade PDF reports with visual charts,
 * detailed breakdowns, and professional styling using PDFKit primitives.
 *
 * Layout rule: each chart/section starts on its own page. No awkward spacing.
 */

import PDFDocument from "pdfkit";
import { stateStore } from "./state-store";

type PhaseKey = "assessment" | "planning" | "tasks" | "execution" | "tests" | "all";

interface ChartPdfRequest {
  analysisId: string;
  phase: PhaseKey;
  chartId?: string;
}

const C = {
  primary: "#4f46e5",
  primaryLight: "#818cf8",
  success: "#22c55e",
  successLight: "#86efac",
  warning: "#f59e0b",
  danger: "#ef4444",
  info: "#06b6d4",
  orange: "#f97316",
  purple: "#8b5cf6",
  pink: "#ec4899",
  slate900: "#0f172a",
  slate800: "#1e293b",
  slate700: "#334155",
  slate600: "#475569",
  slate500: "#64748b",
  slate400: "#94a3b8",
  slate200: "#e2e8f0",
  slate100: "#f1f5f9",
  slate50: "#f8fafc",
  white: "#ffffff",
};

const PALETTE = [C.primary, C.success, C.warning, C.danger, C.info, C.orange, C.purple, C.pink, C.primaryLight, C.successLight];

const SEV_COLOR: Record<string, string> = {
  critical: C.danger, high: C.danger, major: C.orange,
  medium: C.warning, minor: C.info, low: C.success,
  conflict: C.danger, "anti-pattern": C.orange, required: C.danger,
};

const METH: Record<string, string> = {
  stackDetection: "Analyzes manifests (package.json, .csproj, pom.xml), file extensions, and framework configs. Languages weighted by file count.",
  dependencies: "Parses package manifests for direct/transitive dependencies. Peer conflicts from version constraint comparison.",
  versionIntelligence: "Queries official registries for latest stable/LTS versions. Risk assigned by EOL status and major version gap.",
  security: "Score = 100 − weighted vuln count (Critical ×4, High ×3, Medium ×2, Low ×1). 100 = no known CVEs.",
  codeQuality: "Cyclomatic complexity, maintainability index, and tech debt items. Range 0−100, higher = better.",
  breakingChanges: "API signature comparison via migration guides. Critical = removal, Major = signature change, Minor = deprecation.",
  database: "Scans config files, connection strings, ORM configs for engines, versions, migration files.",
  requirements: "Identifies runtime prerequisites, build tools, CI/CD configs, environment constraints.",
  perStackScores: "Per-stack compatibility/risk from breaking changes, API compatibility, and migration complexity.",
  overallHealth: "Radar: Security, Compatibility, Effort, Risk, Test Coverage (each 0−100).",
  effortDistribution: "Trivial (<1h), Low (1−4h), Medium (4−8h), High (8−16h), Very High (>16h).",
  severityDistribution: "Critical = blocks build, High = runtime impact, Medium = deprecation, Low = cosmetic.",
  tasksByPhase: "Tasks grouped by upgrade phase from dependency graph impact.",
  riskAndAutomation: "Risk from change complexity, file count, automation path availability.",
  executionResults: "Success rate of automated transformations, verified against compilation.",
  testFrameworks: "Tests grouped by framework; coverage = tested files / total modified files.",
};

// ─── Helpers ───

let pageNum = 0;

function fmt(n: number): string {
  if (!n && n !== 0) return "—";
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return String(n);
}

function fmtDur(ms: number): string {
  if (!ms) return "—";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

function sColor(s: number): string {
  return s >= 70 ? C.success : s >= 40 ? C.warning : C.danger;
}

function trunc(s: string, m: number): string {
  return !s ? "" : s.length > m ? s.slice(0, m - 1) + "…" : s;
}

function newPage(doc: PDFKit.PDFDocument) {
  doc.addPage();
  pageNum++;
  doc.x = 60;
  doc.y = 60;
}

function pageBreakIfNeeded(doc: PDFKit.PDFDocument, needed: number) {
  if (doc.y + needed > doc.page.height - 60) {
    newPage(doc);
  }
}

function chartPage(doc: PDFKit.PDFDocument, title: string, methodology?: string) {
  newPage(doc);
  doc.rect(0, 0, doc.page.width, 50).fill(C.slate800);
  doc.save();
  doc.fontSize(14).fillColor(C.white);
  doc.text(title, 60, 16, { width: 340, lineBreak: false });
  doc.fontSize(7).fillColor(C.slate400);
  doc.text(`Page ${pageNum}`, doc.page.width - 100, 20, { width: 40, align: "right", lineBreak: false });
  doc.restore();
  doc.x = 60;
  doc.y = 65;
  if (methodology) {
    doc.fontSize(7.5).fillColor(C.slate500).text(`Methodology: ${methodology}`, 60, doc.y, { width: doc.page.width - 120 });
    doc.moveDown(0.6);
  }
}

// ─── Drawing Primitives ───

function drawArc(
  doc: PDFKit.PDFDocument, cx: number, cy: number,
  oR: number, iR: number, sa: number, ea: number, color: string,
) {
  const steps = Math.max(24, Math.ceil(Math.abs(ea - sa) * 20));
  const step = (ea - sa) / steps;
  doc.save();
  doc.moveTo(cx + oR * Math.cos(sa), cy + oR * Math.sin(sa));
  for (let i = 1; i <= steps; i++) { const a = sa + step * i; doc.lineTo(cx + oR * Math.cos(a), cy + oR * Math.sin(a)); }
  for (let i = steps; i >= 0; i--) { const a = sa + step * i; doc.lineTo(cx + iR * Math.cos(a), cy + iR * Math.sin(a)); }
  doc.closePath().fill(color);
  doc.restore();
}

function donut(
  doc: PDFKit.PDFDocument,
  data: { label: string; value: number; color: string }[],
  cx: number, cy: number, oR: number, iR: number,
) {
  const total = data.reduce((s, d) => s + d.value, 0);
  if (total === 0) return;
  let sa = -Math.PI / 2;
  for (const seg of data) {
    if (seg.value === 0) continue;
    const ea = sa + (seg.value / total) * 2 * Math.PI;
    drawArc(doc, cx, cy, oR, iR, sa, ea, seg.color);
    sa = ea;
  }
}

function gauge(doc: PDFKit.PDFDocument, score: number, label: string, cx: number, cy: number, r: number) {
  const c = sColor(score);
  const savedY = doc.y;
  drawArc(doc, cx, cy, r, r - 10, -Math.PI, 0, C.slate200);
  if (score > 0) drawArc(doc, cx, cy, r, r - 10, -Math.PI, -Math.PI + (score / 100) * Math.PI, c);
  doc.save();
  doc.fontSize(16).fillColor(c);
  doc.text(String(score), cx - 18, cy - 15, { width: 36, align: "center", lineBreak: false });
  doc.fontSize(7).fillColor(C.slate500);
  doc.text("/100", cx - 14, cy + 1, { width: 28, align: "center", lineBreak: false });
  doc.fontSize(8).fillColor(C.slate600);
  doc.text(label, cx - r, cy + 15, { width: r * 2, align: "center", lineBreak: false });
  doc.restore();
  doc.x = 60;
  doc.y = savedY;
}

function hBar(
  doc: PDFKit.PDFDocument,
  data: { label: string; value: number; color?: string }[],
  opts: { x?: number; w?: number; barH?: number; max?: number; showVal?: boolean },
) {
  if (!data.length) return;
  const x = opts.x ?? 60, w = opts.w ?? 420, barH = opts.barH ?? 16, gap = 3;
  const lblW = 130, barW = w - lblW - 45;
  const max = opts.max || Math.max(...data.map(d => d.value), 1);

  for (let i = 0; i < data.length; i++) {
    pageBreakIfNeeded(doc, barH + gap);
    const y = doc.y;
    const bw = Math.max(2, (data[i].value / max) * barW);
    const c = data[i].color || PALETTE[i % PALETTE.length];
    doc.save();
    doc.fontSize(7.5).fillColor(C.slate600);
    doc.text(trunc(data[i].label, 22), x, y + 3, { width: lblW, lineBreak: false });
    doc.restore();
    doc.roundedRect(x + lblW, y + 1, bw, barH - 2, 2).fill(c);
    if (opts.showVal !== false) {
      doc.save();
      doc.fontSize(7.5).fillColor(C.slate700);
      doc.text(String(data[i].value), x + lblW + bw + 5, y + 3, { width: 40, lineBreak: false });
      doc.restore();
    }
    doc.x = 60;
    doc.y = y + barH + gap;
  }
}

function legend(doc: PDFKit.PDFDocument, items: { label: string; color: string }[]) {
  let cx = 60;
  let ly = doc.y;
  for (const it of items) {
    doc.roundedRect(cx, ly + 1, 7, 7, 1.5).fill(it.color);
    doc.save();
    doc.fontSize(7).fillColor(C.slate600);
    doc.text(it.label, cx + 10, ly, { width: 120, lineBreak: false });
    doc.restore();
    cx += 10 + Math.min(doc.widthOfString(it.label), 120) + 12;
    if (cx > doc.page.width - 80) { cx = 60; ly += 12; }
  }
  doc.x = 60;
  doc.y = ly + 14;
}

function kpis(doc: PDFKit.PDFDocument, items: { label: string; value: string; color?: string }[]) {
  const bw = Math.min(110, (doc.page.width - 120 - (items.length - 1) * 8) / items.length);
  const y = doc.y;
  for (let i = 0; i < items.length; i++) {
    const x = 60 + i * (bw + 8);
    doc.roundedRect(x, y, bw, 46, 5).fill(C.slate50);
    doc.roundedRect(x, y, bw, 3, 0).fill(items[i].color || C.primary);
    doc.save();
    doc.fontSize(6.5).fillColor(C.slate500);
    doc.text(items[i].label, x + 7, y + 10, { width: bw - 14, lineBreak: false });
    doc.fontSize(13).fillColor(C.slate900);
    doc.text(items[i].value, x + 7, y + 24, { width: bw - 14, lineBreak: false });
    doc.restore();
  }
  doc.x = 60;
  doc.y = y + 56;
}

function sanitizeVal(v: any): string {
  if (v == null || v === undefined || v === "" || v === "null" || v === "undefined") return "---";
  return String(v);
}

function table(doc: PDFKit.PDFDocument, rows: [string, string | number][]) {
  // Filter out rows with null/undefined keys
  const cleanRows = rows.filter(([k]) => k != null && k !== "" && k !== "undefined");
  if (!cleanRows.length) return;
  const tX = 60;
  const usable = doc.page.width - 120;
  const c1 = Math.floor(usable * 0.55);
  const c2 = usable - c1;
  const minH = 18;
  let y = doc.y;

  // Header
  doc.roundedRect(tX, y, c1 + c2, minH, 2).fill(C.slate800);
  doc.save();
  doc.fontSize(7.5).fillColor(C.white);
  doc.text("Metric", tX + 8, y + 4, { width: c1 - 16, lineBreak: false });
  doc.text("Value", tX + c1 + 8, y + 4, { width: c2 - 16, align: "right", lineBreak: false });
  doc.restore();
  y += minH;

  for (let i = 0; i < cleanRows.length; i++) {
    const metricText = trunc(sanitizeVal(cleanRows[i][0]), 50);
    const valueText = trunc(sanitizeVal(cleanRows[i][1]), 40);

    // Measure text height for wrapping support
    doc.fontSize(8);
    const metricH = doc.heightOfString(metricText, { width: c1 - 16 });
    doc.fontSize(8.5);
    const valueH = doc.heightOfString(valueText, { width: c2 - 16 });
    const rH = Math.max(minH, Math.ceil(Math.max(metricH, valueH)) + 8);

    if (y + rH > doc.page.height - 60) { doc.y = y; newPage(doc); y = 60; }

    doc.rect(tX, y, c1 + c2, rH).fill(i % 2 === 0 ? C.white : C.slate50);
    doc.save();
    doc.fontSize(8).fillColor(C.slate700);
    doc.text(metricText, tX + 8, y + 4, { width: c1 - 16 });
    doc.fontSize(8.5).fillColor(C.slate900);
    doc.text(valueText, tX + c1 + 8, y + 4, { width: c2 - 16, align: "right" });
    doc.restore();
    y += rH;
  }
  doc.x = 60;
  doc.y = y + 6;
}

function planningTable(doc: PDFKit.PDFDocument, heading: string, ps: any[]) {
  if (!ps.length) return;
  pageBreakIfNeeded(doc, 30);
  doc.fontSize(9.5).fillColor(C.slate800).text(heading, 60, doc.y, { width: doc.page.width - 120 });
  doc.moveDown(0.3);

  const tX = 60;
  const usable = doc.page.width - 120;
  const cols = [
    { label: "Package", w: Math.floor(usable * 0.25) },
    { label: "Current", w: Math.floor(usable * 0.12) },
    { label: "Target", w: Math.floor(usable * 0.12) },
    { label: "Compat %", w: Math.floor(usable * 0.12) },
    { label: "Risk %", w: Math.floor(usable * 0.12) },
    { label: "Breaking", w: Math.floor(usable * 0.12) },
    { label: "Effort", w: usable - Math.floor(usable * 0.25) - Math.floor(usable * 0.12) * 5 },
  ];
  const rowH = 18;

  // Header
  let x = tX;
  doc.roundedRect(tX, doc.y, usable, rowH, 2).fill(C.slate800);
  const hy = doc.y;
  doc.save();
  doc.fontSize(6.5).fillColor(C.white);
  for (const col of cols) {
    doc.text(col.label, x + 3, hy + 5, { width: col.w - 6, lineBreak: false });
    x += col.w;
  }
  doc.restore();
  doc.y = hy + rowH;

  for (let i = 0; i < ps.length; i++) {
    const s = ps[i];
    if (doc.y + rowH > doc.page.height - 60) { newPage(doc); }
    const y = doc.y;
    doc.rect(tX, y, usable, rowH).fill(i % 2 === 0 ? C.white : C.slate50);

    doc.save();
    x = tX;
    doc.fontSize(7).fillColor(C.slate800);
    doc.text(trunc(s.name || "?", 24), x + 3, y + 5, { width: cols[0].w - 6, lineBreak: false });
    x += cols[0].w;
    doc.fillColor(C.slate600).text(sanitizeVal(s.currentVersion), x + 3, y + 5, { width: cols[1].w - 6, lineBreak: false });
    x += cols[1].w;
    doc.fillColor(C.primary).text(sanitizeVal(s.targetVersion), x + 3, y + 5, { width: cols[2].w - 6, lineBreak: false });
    x += cols[2].w;
    doc.fillColor(sColor(s.compatibilityScore)).text(`${s.compatibilityScore}%`, x + 3, y + 5, { width: cols[3].w - 6, lineBreak: false });
    x += cols[3].w;
    const rc = s.riskScore >= 60 ? C.danger : s.riskScore >= 30 ? C.warning : C.success;
    doc.fillColor(rc).text(`${s.riskScore}%`, x + 3, y + 5, { width: cols[4].w - 6, lineBreak: false });
    x += cols[4].w;
    doc.fillColor(C.slate700).text(String(s.breakingChangesCount || 0), x + 3, y + 5, { width: cols[5].w - 6, lineBreak: false });
    x += cols[5].w;
    doc.fillColor(C.slate600).text(trunc(sanitizeVal(s.effort), 12), x + 3, y + 5, { width: cols[6].w - 6, lineBreak: false });
    doc.restore();

    doc.x = 60;
    doc.y = y + rowH;
  }
  doc.y += 6;
}

function versionTable(doc: PDFKit.PDFDocument, heading: string, vi: any[]) {
  if (!vi.length) return;
  pageBreakIfNeeded(doc, 30);
  doc.fontSize(9.5).fillColor(C.slate800).text(heading, 60, doc.y, { width: doc.page.width - 120 });
  doc.moveDown(0.3);

  const tX = 60;
  const usable = doc.page.width - 120;
  // Columns: Package (35%), Current (15%), Target (15%), Risk (12%), Reason (23%)
  const cols = [
    { label: "Package", w: Math.floor(usable * 0.32) },
    { label: "Current", w: Math.floor(usable * 0.15) },
    { label: "Target", w: Math.floor(usable * 0.15) },
    { label: "Risk", w: Math.floor(usable * 0.12) },
    { label: "Reason", w: usable - Math.floor(usable * 0.32) - Math.floor(usable * 0.15) - Math.floor(usable * 0.15) - Math.floor(usable * 0.12) },
  ];
  const rowH = 18;

  // Header
  let x = tX;
  doc.roundedRect(tX, doc.y, usable, rowH, 2).fill(C.slate800);
  const hy = doc.y;
  doc.save();
  doc.fontSize(7).fillColor(C.white);
  for (const col of cols) {
    doc.text(col.label, x + 4, hy + 5, { width: col.w - 8, lineBreak: false });
    x += col.w;
  }
  doc.restore();
  doc.y = hy + rowH;

  // Rows
  for (let i = 0; i < vi.length; i++) {
    const v = vi[i];
    const pkg = trunc(sanitizeVal(v.packageName || v.name || "?"), 30);
    const curr = sanitizeVal(v.currentVersion || "?");
    const target = sanitizeVal(v.targetVersion || "?");
    const risk = (v.riskLevel || "unknown").toLowerCase();
    const reason = trunc(sanitizeVal(v.reason || "—"), 35);

    // Measure height
    doc.fontSize(7.5);
    const rH = Math.max(rowH, doc.heightOfString(reason, { width: cols[4].w - 8 }) + 8);

    if (doc.y + rH > doc.page.height - 60) { newPage(doc); }
    const y = doc.y;

    doc.rect(tX, y, usable, rH).fill(i % 2 === 0 ? C.white : C.slate50);

    doc.save();
    x = tX;
    doc.fontSize(7.5).fillColor(C.slate800);
    doc.text(pkg, x + 4, y + 5, { width: cols[0].w - 8, lineBreak: false });
    x += cols[0].w;

    doc.fillColor(C.slate600);
    doc.text(curr, x + 4, y + 5, { width: cols[1].w - 8, lineBreak: false });
    x += cols[1].w;

    doc.fillColor(C.primary);
    doc.text(target, x + 4, y + 5, { width: cols[2].w - 8, lineBreak: false });
    x += cols[2].w;

    // Risk badge
    const rc = risk === "high" ? C.danger : risk === "medium" ? C.warning : C.success;
    doc.roundedRect(x + 4, y + 3, cols[3].w - 12, 12, 2).fill(rc);
    doc.fontSize(6).fillColor(C.white);
    doc.text(risk.toUpperCase(), x + 4, y + 5, { width: cols[3].w - 12, align: "center", lineBreak: false });
    x += cols[3].w;

    doc.fontSize(7).fillColor(C.slate500);
    doc.text(reason, x + 4, y + 5, { width: cols[4].w - 8 });
    doc.restore();

    doc.x = 60;
    doc.y = y + rH;
  }
  doc.y += 6;
}

function detailList(
  doc: PDFKit.PDFDocument,
  heading: string,
  items: { title: string; subtitle?: string; badge?: string; extra?: string }[],
) {
  if (!items.length) return;
  pageBreakIfNeeded(doc, 30);
  doc.fontSize(9.5).fillColor(C.slate800).text(heading, 60, doc.y, { width: doc.page.width - 120 });
  doc.moveDown(0.2);

  for (let i = 0; i < items.length; i++) {
    pageBreakIfNeeded(doc, 22);
    const y = doc.y, it = items[i], tX = 82, tW = doc.page.width - tX - 75;

    doc.save();
    doc.fontSize(7.5).fillColor(C.slate400);
    doc.text(`${i + 1}.`, 62, y, { width: 16, lineBreak: false });
    doc.fontSize(8).fillColor(C.slate800);
    doc.text(trunc(sanitizeVal(it.title), 85), tX, y, { width: tW, lineBreak: false });
    doc.restore();

    if (it.badge) {
      const bc = SEV_COLOR[it.badge.toLowerCase()] || C.slate500;
      const bx = doc.page.width - 115;
      doc.roundedRect(bx, y, 48, 11, 2).fill(bc);
      doc.save();
      doc.fontSize(6).fillColor(C.white);
      doc.text(it.badge.toUpperCase(), bx + 2, y + 2, { width: 44, align: "center", lineBreak: false });
      doc.restore();
    }

    let cy = y + 12;
    if (it.subtitle) {
      doc.save();
      doc.fontSize(6.5).fillColor(C.slate500);
      doc.text(trunc(it.subtitle, 100), tX, cy, { width: tW, lineBreak: false });
      doc.restore();
      cy += 9;
    }
    if (it.extra) {
      doc.save();
      doc.fontSize(6).fillColor(C.slate400);
      doc.text(trunc(it.extra, 110), tX, cy, { width: tW, lineBreak: false });
      doc.restore();
      cy += 9;
    }
    doc.x = 60;
    doc.y = cy + 2;
  }
  doc.y += 4;
}

// ─── Phase Renderers ───

function renderAssessment(doc: PDFKit.PDFDocument, state: any) {
  // Stack Detection
  if (state.repoProfile) {
    const d = state.repoProfile;
    chartPage(doc, "Stack Detection", METH.stackDetection);
    kpis(doc, [
      { label: "Project Type", value: d.projectType || "—" },
      { label: "Total Files", value: String(d.fileStructure?.totalFiles || 0) },
      { label: "Frameworks", value: String((d.frameworks || []).length) },
      { label: "Languages", value: String((d.languages || []).length) },
    ]);
    const langs = (d.languages || []).map((l: string, i: number) => ({ label: l, value: 1, color: PALETTE[i % PALETTE.length] }));
    if (langs.length > 0) {
      hBar(doc, langs, { max: 1, showVal: false });
      legend(doc, langs.map((l: any) => ({ label: l.label, color: l.color })));
    }
    if ((d.frameworks || []).length > 0)
      detailList(doc, "Detected Frameworks", (d.frameworks as string[]).map((f: string) => ({ title: f })));
  }

  // Dependencies
  if (state.dependencyGraph) {
    const d = state.dependencyGraph;
    const dir = d.directDependencies?.length || 0, trans = d.transitiveDependencies?.length || 0;
    chartPage(doc, "Dependencies", METH.dependencies);
    kpis(doc, [
      { label: "Direct", value: String(dir), color: C.primary },
      { label: "Transitive", value: String(trans), color: C.purple },
      { label: "Total", value: String(dir + trans), color: C.info },
      { label: "Peer Conflicts", value: String(d.peerConflicts?.length || 0), color: d.peerConflicts?.length ? C.danger : C.success },
    ]);
    hBar(doc, [{ label: "Direct", value: dir, color: C.primary }, { label: "Transitive", value: trans, color: C.purple }], {});
    if ((d.directDependencies || []).length > 0) {
      detailList(doc, "Direct Dependencies", (d.directDependencies as any[]).slice(0, 30).map((dep: any) => ({
        title: typeof dep === "string" ? dep : (dep.name || dep.package || String(dep)),
        subtitle: typeof dep === "object" && dep.version ? `v${dep.version}` : undefined,
      })));
    }
    if ((d.peerConflicts || []).length > 0) {
      detailList(doc, "Peer Conflicts", (d.peerConflicts as any[]).map((c: any) => ({
        title: typeof c === "string" ? c : (c.package || c.name || String(c)),
        subtitle: typeof c === "object" ? c.reason : undefined,
        badge: "conflict",
      })));
    }
  }

  // Version Intelligence
  if (state.versionIntelligence?.length > 0) {
    const vi = state.versionIntelligence;
    const rc = { high: 0, medium: 0, low: 0 };
    for (const v of vi) { const r = (v.riskLevel || "low").toLowerCase(); if (r in rc) rc[r as keyof typeof rc]++; }

    chartPage(doc, "Version Intelligence", METH.versionIntelligence);
    kpis(doc, [
      { label: "Total Packages", value: String(vi.length) },
      { label: "High Risk", value: String(rc.high), color: C.danger },
      { label: "Medium Risk", value: String(rc.medium), color: C.warning },
      { label: "Low Risk", value: String(rc.low), color: C.success },
    ]);

    const pd = [
      { label: "High", value: rc.high, color: C.danger },
      { label: "Medium", value: rc.medium, color: C.warning },
      { label: "Low", value: rc.low, color: C.success },
    ].filter(d => d.value > 0);
    if (pd.length > 0) {
      const py = doc.y + 40;
      donut(doc, pd, 140, py, 35, 18);
      legend(doc, pd.map(d => ({ label: `${d.label}: ${d.value}`, color: d.color })));
      doc.y = Math.max(doc.y, py + 50);
    }

    // Version Intelligence table — clean tabular format
    versionTable(doc, "Package Version Details", vi);
  }

  // Security
  if (state.securityAssessment) {
    const d = state.securityAssessment;
    chartPage(doc, "Security Analysis", METH.security);

    const gy = doc.y + 35;
    gauge(doc, d.score ?? 0, "Security Score", 140, gy, 38);

    const vd = [
      { label: `Critical: ${d.critical || 0}`, value: d.critical || 0, color: C.danger },
      { label: `High: ${d.high || 0}`, value: d.high || 0, color: C.orange },
      { label: `Medium: ${d.medium || 0}`, value: d.medium || 0, color: C.warning },
      { label: `Low: ${d.low || 0}`, value: d.low || 0, color: C.success },
    ].filter(v => v.value > 0);
    if (vd.length > 0) { donut(doc, vd, 360, gy, 35, 18); }
    else { doc.save(); doc.fontSize(8).fillColor(C.success); doc.text("No vulnerabilities", 300, gy - 5, { lineBreak: false }); doc.restore(); }

    doc.y = gy + 55;
    table(doc, [
      ["Security Score", `${d.score ?? 0}/100`],
      ["Critical", d.critical || 0], ["High", d.high || 0],
      ["Medium", d.medium || 0], ["Low", d.low || 0],
      ["Total", d.totalVulnerabilities || 0],
    ]);
    if ((d.cves || []).length > 0) {
      detailList(doc, "Known Vulnerabilities (CVEs)", (d.cves as any[]).map((c: any) => ({
        title: `${c.id} — ${c.title || "No title"}`,
        subtitle: c.package ? `Package: ${c.package}${c.fixedIn ? ` (fix in ${c.fixedIn})` : ""}` : undefined,
        badge: c.severity,
      })));
    }
    if ((d.advisories || []).length > 0)
      detailList(doc, "Security Advisories", (d.advisories as string[]).map((a: string) => ({ title: a })));
  }

  // Code Quality
  if (state.codeQuality) {
    const d = state.codeQuality, cm = d.complexityMetrics || {};
    chartPage(doc, "Code Quality", METH.codeQuality);

    const gy = doc.y + 35;
    gauge(doc, d.qualityScore || 0, "Quality Score", 140, gy, 38);
    gauge(doc, d.maintainabilityIndex || 0, "Maintainability", 340, gy, 38);
    doc.y = gy + 55;

    table(doc, [
      ["Quality Score", `${d.qualityScore || 0}/100`],
      ["Maintainability Index", d.maintainabilityIndex || 0],
      ["Avg Complexity", cm.averageCyclomaticComplexity || 0],
      ["Max Complexity", cm.maxCyclomaticComplexity || 0],
      ["Lines of Code", cm.linesOfCode || 0],
      ["Duplicate Code", cm.duplicateCodePercentage ? `${cm.duplicateCodePercentage}%` : "0%"],
      ["Test Coverage", d.patterns?.testCoverage || "unknown"],
      ["Debt Items", d.debtItems?.length || 0],
    ]);
    if ((d.debtItems || []).length > 0) {
      detailList(doc, "Technical Debt Items", (d.debtItems as any[]).map((it: any) => ({
        title: it.description || "Unnamed issue",
        badge: it.severity || it.type,
        extra: it.file,
      })));
    }
    if ((d.patterns?.antiPatterns || []).length > 0)
      detailList(doc, "Anti-Patterns", (d.patterns.antiPatterns as string[]).map((p: string) => ({ title: p, badge: "anti-pattern" })));
  }

  // Breaking Changes
  if (state.breakingChangesPreview) {
    const d = state.breakingChangesPreview, dist = d.severityDistribution || {};
    chartPage(doc, "Breaking Changes", METH.breakingChanges);
    kpis(doc, [
      { label: "Total", value: String(d.totalBreakingChanges || 0), color: C.orange },
      { label: "Critical", value: String(dist.critical || 0), color: C.danger },
      { label: "Major", value: String(dist.major || 0), color: C.orange },
      { label: "Minor", value: String(dist.minor || 0), color: C.info },
    ]);
    const bd = [
      { label: "Critical", value: dist.critical || 0, color: C.danger },
      { label: "Major", value: dist.major || 0, color: C.orange },
      { label: "Minor", value: dist.minor || 0, color: C.info },
    ].filter(d => d.value > 0);
    if (bd.length > 0) hBar(doc, bd, {});

    for (const pkg of (d.byPackage || [])) {
      const hl = pkg.highlights || [];
      detailList(
        doc,
        `${pkg.package} (${pkg.currentVersion || "?"} → ${pkg.latestVersion || "?"})`,
        hl.length > 0
          ? hl.map((h: string) => ({ title: h, badge: pkg.severity }))
          : [{ title: `${pkg.breakingChangesCount || 0} breaking change(s)`, badge: pkg.severity, subtitle: `${pkg.currentVersion || "?"} → ${pkg.latestVersion || "?"}` }],
      );
    }
  }

  // Database
  if (state.databaseDependencies) {
    const d = state.databaseDependencies;
    chartPage(doc, "Database Analysis", METH.database);
    table(doc, [
      ["Databases", d.databases?.length || 0],
      ["ORMs", (d.orms || []).map((o: any) => o.name).join(", ") || "None"],
      ["Migration Files", d.migrationFiles?.length || 0],
      ["Connection Strings", d.connectionStrings || 0],
      ["Has DB Migrations", d.hasDbMigrations ? "Yes" : "No"],
    ]);
    if ((d.databases || []).length > 0) {
      detailList(doc, "Detected Databases", (d.databases as any[]).map((db: any) => ({
        title: `${(db.type || "unknown").toUpperCase()}${db.version ? ` v${db.version}` : ""}`,
        subtitle: db.detectedFrom ? `From: ${db.detectedFrom}` : undefined,
      })));
    }
  }

  // Requirements
  if (state.requirementsAnalysis) {
    const d = state.requirementsAnalysis;
    chartPage(doc, "Requirements Analysis", METH.requirements);
    table(doc, [
      ["Runtimes", d.runtimePrereqs?.length || 0],
      ["SDKs", (d.sdks || []).join(", ") || "None"],
      ["Build Tools", (d.buildTools || []).join(", ") || "None"],
      ["Containerized", d.containerized ? "Yes" : "No"],
      ["CI/CD", d.cicdPlatform || "None"],
      ["OS", (d.osRequirements || []).join(", ") || "Any"],
      ["Env Vars", d.envConstraints?.length || 0],
    ]);
    if ((d.runtimePrereqs || []).length > 0) {
      detailList(doc, "Runtime Prerequisites", (d.runtimePrereqs as any[]).map((r: any) => ({
        title: r.runtime,
        subtitle: `Min: ${r.minVersion}${r.currentVersion ? ` (current: ${r.currentVersion})` : ""}`,
      })));
    }
    if ((d.envConstraints || []).length > 0) {
      detailList(doc, "Environment Variables", (d.envConstraints as any[]).map((e: any) => ({
        title: e.name, subtitle: e.description, badge: e.type,
      })));
    }
  }
}

function renderPlanning(doc: PDFKit.PDFDocument, state: any) {
  const viz = state.planningVisualizationData;
  if (!viz) return;

  const ps = viz.perStackScores || [];
  const totalPkgs = ps.length;
  const highRisk = ps.filter((s: any) => s.riskScore >= 60).length;
  const avgC = totalPkgs > 0 ? Math.round(ps.reduce((a: number, s: any) => a + s.compatibilityScore, 0) / totalPkgs) : 0;

  // Compatibility & Risk
  if (ps.length > 0) {
    chartPage(doc, "Compatibility & Risk by Package", METH.perStackScores);
    kpis(doc, [
      { label: "Recommendation", value: (viz.recommendation || "—").replace(/_/g, " ").toUpperCase(), color: viz.recommendation === "proceed" ? C.success : C.warning },
      { label: "Packages", value: String(totalPkgs), color: C.primary },
      { label: "Breaking Changes", value: String(viz.totalBreakingChanges || 0), color: C.orange },
      { label: "Avg Compatibility", value: `${avgC}%`, color: sColor(avgC) },
    ]);
    hBar(doc, ps.map((s: any) => ({ label: trunc(s.name, 20), value: s.compatibilityScore, color: sColor(s.compatibilityScore) })), { max: 100 });
    legend(doc, [{ label: "≥70% = Good", color: C.success }, { label: "40−69% = Moderate", color: C.warning }, { label: "<40% = Poor", color: C.danger }]);
    // Package breakdown as a proper table
    planningTable(doc, "Package Breakdown", ps);
  }

  // Health
  if (viz.overallHealth) {
    chartPage(doc, "Overall Upgrade Health", METH.overallHealth);
    const h = viz.overallHealth;
    hBar(doc, [
      { label: "Security", value: h.security, color: sColor(h.security) },
      { label: "Compatibility", value: h.compatibility, color: sColor(h.compatibility) },
      { label: "Low Effort", value: h.effort, color: sColor(h.effort) },
      { label: "Low Risk", value: h.risk, color: sColor(h.risk) },
      { label: "Test Coverage", value: h.testCoverage, color: sColor(h.testCoverage) },
    ], { max: 100 });
  }

  // Effort + Severity on one page
  if ((viz.effortDistribution || []).length > 0 || (viz.severityDistribution || []).length > 0) {
    chartPage(doc, "Effort & Severity Distribution", METH.effortDistribution);
    if ((viz.effortDistribution || []).length > 0) {
      doc.fontSize(10).fillColor(C.slate800).text("Effort Distribution", 60); doc.moveDown(0.3);
      const ed = (viz.effortDistribution as any[]).map((e: any, i: number) => ({
        label: e.label.charAt(0).toUpperCase() + e.label.slice(1), value: e.count, color: PALETTE[i % PALETTE.length],
      }));
      hBar(doc, ed, {});
      legend(doc, ed.map(e => ({ label: `${e.label}: ${e.value}`, color: e.color })));
    }
    if ((viz.severityDistribution || []).length > 0) {
      doc.fontSize(10).fillColor(C.slate800).text("Breaking Change Severity", 60); doc.moveDown(0.3);
      hBar(doc, (viz.severityDistribution as any[]).map((s: any) => ({
        label: s.label, value: s.count, color: s.color || C.warning,
      })), {});
    }
  }

  // Upgrade Order + Insights on one page
  if ((viz.upgradeOrder || []).length > 0 || (viz.keyInsights || []).length > 0) {
    chartPage(doc, "Upgrade Strategy");
    if ((viz.upgradeOrder || []).length > 0) {
      doc.fontSize(10).fillColor(C.slate800).text("Recommended Upgrade Order", 60); doc.moveDown(0.3);
      (viz.upgradeOrder as string[]).forEach((pkg: string, i: number) => {
        pageBreakIfNeeded(doc, 16);
        doc.fontSize(8.5).fillColor(C.primary).text(`${i + 1}.`, 64, doc.y, { width: 18, continued: true });
        doc.fillColor(C.slate800).text(` ${pkg}`);
        doc.moveDown(0.05);
      });
      doc.moveDown(0.5);
    }
    if ((viz.keyInsights || []).length > 0) {
      doc.fontSize(10).fillColor(C.slate800).text("Key Insights", 60); doc.moveDown(0.3);
      for (const ins of (viz.keyInsights as string[]).slice(0, 8)) {
        pageBreakIfNeeded(doc, 14);
        doc.fontSize(8).fillColor(C.warning).text("•", 64, doc.y, { width: 10, continued: true });
        doc.fillColor(C.slate700).text(` ${ins}`, { width: doc.page.width - 140 });
        doc.moveDown(0.1);
      }
    }
  }
}

function renderTasks(doc: PDFKit.PDFDocument, state: any) {
  const tasks = state.upgradeTasks || [];
  if (!tasks.length) return;

  const phaseMap: Record<string, number> = {}, riskMap: Record<string, number> = {};
  let autoFix = 0, manual = 0;
  const filesSet = new Set<string>();
  for (const t of tasks) {
    phaseMap[t.phase || "General"] = (phaseMap[t.phase || "General"] || 0) + 1;
    const r = ((t.riskLevel || t.priority || "medium") as string).toLowerCase();
    const rl = r === "high" || r === "critical" ? "High" : r === "low" ? "Low" : "Medium";
    riskMap[rl] = (riskMap[rl] || 0) + 1;
    if (t.autoFixable) autoFix++; else manual++;
    for (const f of (t.affectedFiles || [])) filesSet.add(typeof f === "string" ? f : f.path || f.filePath);
  }

  // Tasks by phase
  chartPage(doc, "Tasks by Upgrade Phase", METH.tasksByPhase);
  kpis(doc, [
    { label: "Total Tasks", value: String(tasks.length), color: C.primary },
    { label: "Auto-fixable", value: String(autoFix), color: C.success },
    { label: "Manual", value: String(manual), color: C.warning },
    { label: "Files Affected", value: String(filesSet.size), color: C.info },
  ]);
  const pd = Object.entries(phaseMap).map(([n, c], i) => ({ label: trunc(n, 22), value: c, color: PALETTE[i % PALETTE.length] }));
  hBar(doc, pd, {});
  legend(doc, pd.map(d => ({ label: `${d.label}: ${d.value}`, color: d.color })));

  // Risk & Automation
  chartPage(doc, "Risk Level & Automation", METH.riskAndAutomation);
  const rd = [
    { label: "High Risk", value: riskMap["High"] || 0, color: C.danger },
    { label: "Medium Risk", value: riskMap["Medium"] || 0, color: C.warning },
    { label: "Low Risk", value: riskMap["Low"] || 0, color: C.success },
  ], ad = [
    { label: "Auto-fixable", value: autoFix, color: C.success },
    { label: "Manual", value: manual, color: C.warning },
  ];

  const py = doc.y + 40;
  donut(doc, rd.filter(d => d.value > 0), 140, py, 38, 20);
  donut(doc, ad.filter(d => d.value > 0), 360, py, 38, 20);
  doc.y = py + 50;
  legend(doc, [...rd, ...ad].filter(d => d.value > 0));

  // Task list
  detailList(doc, "All Tasks", tasks.slice(0, 50).map((t: any, i: number) => ({
    title: trunc(t.title || t.description || `Task ${i + 1}`, 80),
    subtitle: t.phase ? `Phase: ${t.phase}` : undefined,
    badge: (t.riskLevel || t.priority || "medium"),
    extra: t.autoFixable ? "Auto-fixable" : "Manual review",
  })));
}

function renderExecution(doc: PDFKit.PDFDocument, state: any) {
  const results = state.taskExecutionResults || [];
  const tasks = state.upgradeTasks || [];
  const modFiles = state.modifiedFiles || [];
  if (!results.length && !tasks.length) return;

  const ok = results.filter((r: any) => r.status === "completed" || r.status === "success").length;
  const fail = results.filter((r: any) => r.status === "failed" || r.status === "error").length;
  const other = Math.max(0, tasks.length - ok - fail);
  const rate = tasks.length > 0 ? Math.round((ok / tasks.length) * 100) : 0;

  chartPage(doc, "Execution Results", METH.executionResults);
  kpis(doc, [
    { label: "Completed", value: String(ok), color: C.success },
    { label: "Failed", value: String(fail), color: fail > 0 ? C.danger : C.success },
    { label: "Files Modified", value: String(modFiles.length), color: C.info },
    { label: "Success Rate", value: `${rate}%`, color: sColor(rate) },
  ]);

  const gy = doc.y + 35;
  gauge(doc, rate, "Success Rate", 150, gy, 42);
  const ed = [
    { label: "Completed", value: ok, color: C.success },
    { label: "Failed", value: fail, color: C.danger },
    { label: "Other", value: other, color: C.slate400 },
  ].filter(d => d.value > 0);
  donut(doc, ed, 370, gy, 38, 20);
  doc.y = gy + 55;
  legend(doc, ed);

  table(doc, [
    ["Completed", ok], ["Failed", fail], ["Other", other],
    ["Total Tasks", tasks.length], ["Files Modified", modFiles.length], ["Success Rate", `${rate}%`],
  ]);

  if (modFiles.length > 0)
    detailList(doc, "Modified Files", modFiles.slice(0, 40).map((f: any) => ({ title: f.path || f.filePath || String(f) })));
}

function renderTests(doc: PDFKit.PDFDocument, state: any) {
  const tests = state.generatedTests || [];
  if (!tests.length) return;

  const fwMap: Record<string, number> = {};
  for (const t of tests) { fwMap[t.testFramework || t.framework || "Unknown"] = (fwMap[t.testFramework || t.framework || "Unknown"] || 0) + 1; }
  const srcFiles = new Set(tests.map((t: any) => t.sourceFile || t.filePath).filter(Boolean));
  const totalCases = tests.reduce((s: number, t: any) => s + (t.testCases?.length || 0), 0);

  chartPage(doc, "Test Generation Analytics", METH.testFrameworks);
  kpis(doc, [
    { label: "Test Files", value: String(tests.length), color: C.primary },
    { label: "Test Cases", value: String(totalCases), color: C.success },
    { label: "Source Coverage", value: String(srcFiles.size), color: C.info },
    { label: "Frameworks", value: String(Object.keys(fwMap).length), color: C.purple },
  ]);

  const fd = Object.entries(fwMap).map(([n, c], i) => ({ label: n, value: c, color: PALETTE[i % PALETTE.length] }));
  if (fd.length > 0) {
    const py = doc.y + 40;
    donut(doc, fd, 140, py, 40, 22);
    doc.y = py + 50;
    legend(doc, fd.map(d => ({ label: `${d.label}: ${d.value}`, color: d.color })));
  }

  for (const [fw, count] of Object.entries(fwMap)) {
    const fwTests = tests.filter((t: any) => (t.testFramework || t.framework || "Unknown") === fw);
    detailList(doc, `${fw} (${count} files)`, fwTests.slice(0, 20).map((t: any) => ({
      title: t.filePath || "Unknown file",
      subtitle: t.testCases?.length ? `${t.testCases.length} case(s): ${t.testCases.slice(0, 3).join(", ")}${t.testCases.length > 3 ? "..." : ""}` : undefined,
      extra: t.taskTitle ? `Task: ${t.taskTitle}` : undefined,
    })));
  }
}

// ─── Cover & Summary ───

function addCoverPage(doc: PDFKit.PDFDocument, state: any) {
  doc.rect(0, 0, doc.page.width, doc.page.height).fill(C.slate900);
  doc.rect(0, 0, 6, doc.page.height).fill(C.primary);

  doc.save();
  doc.fontSize(34).fillColor(C.white);
  doc.text("Stack Modernization", 60, 160, { lineBreak: false });
  doc.fontSize(15).fillColor(C.slate400);
  doc.text("Analytics Report", 60, 205, { lineBreak: false });
  doc.restore();
  doc.moveTo(60, 240).lineTo(540, 240).strokeColor(C.slate700).lineWidth(0.5).stroke();

  const meta = [
    ["Organization", state.adoOrg || "—"],
    ["Project", state.adoProjectName || "—"],
    ["Repository", state.repoName || "—"],
    ["Analysis ID", state.analysisId || "—"],
    ["Generated", new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" })],
  ];
  let y = 260;
  for (const [l, v] of meta) {
    doc.save();
    doc.fontSize(8).fillColor(C.slate400);
    doc.text(l, 60, y, { width: 110, lineBreak: false });
    doc.fontSize(10).fillColor(C.white);
    doc.text(String(v), 175, y, { width: 300, lineBreak: false });
    doc.restore();
    y += 22;
  }

  if (state.tokenUsage) {
    y += 25;
    doc.save();
    doc.fontSize(12).fillColor(C.primaryLight);
    doc.text("Pipeline Metrics", 60, y, { lineBreak: false });
    doc.restore();
    y += 22;
    const md = [
      ["Total Tokens", fmt(state.tokenUsage.totalTokens)],
      ["LLM Calls", String(state.tokenUsage.totalLLMCalls)],
      ["Duration", fmtDur(state.tokenUsage.totalDurationMs)],
    ];
    const bw = 105;
    for (let i = 0; i < md.length; i++) {
      const mx = 60 + i * (bw + 10);
      doc.roundedRect(mx, y, bw, 48, 5).fill(C.slate800);
      doc.save();
      doc.fontSize(7).fillColor(C.slate400);
      doc.text(md[i][0], mx + 8, y + 8, { width: bw - 16, lineBreak: false });
      doc.fontSize(13).fillColor(C.white);
      doc.text(md[i][1], mx + 8, y + 24, { width: bw - 16, lineBreak: false });
      doc.restore();
    }
  }

  doc.save();
  doc.fontSize(7).fillColor(C.slate600);
  doc.text("Generated by DevX 2.0 Stack Modernization Platform", 60, doc.page.height - 40, { lineBreak: false });
  doc.restore();
  doc.x = 60;
  doc.y = 60;
  pageNum = 1;
}

function addSummaryPage(doc: PDFKit.PDFDocument, state: any) {
  newPage(doc);
  doc.rect(0, 0, doc.page.width, 50).fill(C.slate900);
  doc.save();
  doc.fontSize(16).fillColor(C.white);
  doc.text("Report Summary", 60, 16, { lineBreak: false });
  doc.fontSize(7).fillColor(C.slate400);
  doc.text(`Page ${pageNum}`, doc.page.width - 100, 20, { width: 40, align: "right", lineBreak: false });
  doc.restore();
  doc.x = 60;
  doc.y = 70;

  doc.fontSize(9).fillColor(C.slate700).text(
    "This report was generated by the DevX 2.0 Stack Modernization Platform. " +
    "All data is derived from automated static analysis, dependency graph traversal, " +
    "and LLM-assisted evaluation of the source code repository.",
    60, doc.y, { width: doc.page.width - 120 },
  );
  doc.moveDown(1);

  if (state.tokenUsage) {
    doc.fontSize(10).fillColor(C.primary).text("Resource Utilization", 60, doc.y, { width: doc.page.width - 120 });
    doc.moveDown(0.4);
    kpis(doc, [
      { label: "Total Tokens", value: fmt(state.tokenUsage.totalTokens) },
      { label: "LLM Calls", value: String(state.tokenUsage.totalLLMCalls) },
      { label: "Duration", value: fmtDur(state.tokenUsage.totalDurationMs) },
    ]);
  }

  doc.save();
  doc.fontSize(7).fillColor(C.slate400);
  doc.text(
    `Generated ${new Date().toISOString()} | DevX 2.0 | ${pageNum} pages`,
    60, doc.page.height - 40,
    { align: "center", width: doc.page.width - 120, lineBreak: false },
  );
  doc.restore();
}

// ─── Main Export ───

export async function generateChartsPdf(request: ChartPdfRequest): Promise<Buffer> {
  const state = stateStore.get(request.analysisId);
  if (!state) throw new Error(`Analysis ${request.analysisId} not found`);

  return new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 0, bufferPages: true });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    pageNum = 0;
    addCoverPage(doc, state);

    const renderers: Record<string, (d: PDFKit.PDFDocument, s: any) => void> = {
      assessment: renderAssessment, planning: renderPlanning,
      tasks: renderTasks, execution: renderExecution, tests: renderTests,
    };

    const phases = request.phase === "all"
      ? ["assessment", "planning", "tasks", "execution", "tests"]
      : [request.phase];

    for (const p of phases) { renderers[p]?.(doc, state); }

    addSummaryPage(doc, state);
    doc.end();
  });
}
