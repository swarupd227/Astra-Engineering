/**
 * Professional Code Diff Viewer
 * Single-scroll architecture, synchronized split panels,
 * muted color palette, GitHub-quality design.
 */

import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import {
  FileCode2,
  Download,
  Columns2,
  AlignJustify,
  ChevronRight,
  ChevronDown,
  Copy,
  Check,
  FileText,
} from "lucide-react";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface ModifiedFile {
  path: string;
  content: string;
  originalContent: string;
  changes: Array<{ package: string; oldVersion: string; newVersion: string }>;
  /** True when this file was created by the upgrade (not present in the original repo). */
  isNew?: boolean;
}

interface CodeDiffViewerProps {
  modifiedFiles: ModifiedFile[];
  onDownloadZip: () => void;
}

type ViewMode = "unified" | "split";

interface DiffLine {
  type: "added" | "removed" | "unchanged";
  content: string;
  oldLineNum?: number;
  newLineNum?: number;
}

interface FileStats { additions: number; deletions: number; }

/* ------------------------------------------------------------------ */
/*  Diff Algorithm (LCS)                                               */
/* ------------------------------------------------------------------ */

function computeLCS(a: string[], b: string[]): number[][] {
  const m = a.length, n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
  return dp;
}

function computeDiff(original: string, modified: string): DiffLine[] {
  const norm = (s: string) => s.replace(/\r/g, "").replace(/\n+$/, "");
  const a = norm(original).split("\n"), b = norm(modified).split("\n");

  if (a.length === b.length && a.every((line, idx) => line === b[idx])) {
    return a.map((line, idx) => ({ type: "unchanged" as const, content: line, oldLineNum: idx + 1, newLineNum: idx + 1 }));
  }

  const dp = computeLCS(a, b);
  const stack: DiffLine[] = [];
  let i = a.length, j = b.length;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && a[i - 1] === b[j - 1]) {
      stack.push({ type: "unchanged", content: a[i - 1], oldLineNum: i, newLineNum: j });
      i--; j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      stack.push({ type: "added", content: b[j - 1], newLineNum: j });
      j--;
    } else if (i > 0) {
      stack.push({ type: "removed", content: a[i - 1], oldLineNum: i });
      i--;
    }
  }
  return stack.reverse();
}

function getStats(lines: DiffLine[]): FileStats {
  let additions = 0, deletions = 0;
  for (const l of lines) { if (l.type === "added") additions++; else if (l.type === "removed") deletions++; }
  return { additions, deletions };
}

/* ------------------------------------------------------------------ */
/*  Word-level inline diff                                             */
/* ------------------------------------------------------------------ */

interface Seg { text: string; hl: boolean; }

function wordDiff(oldStr: string, newStr: string): { oldSegs: Seg[]; newSegs: Seg[] } {
  const tok = (s: string) => {
    const r: string[] = []; let c = "";
    for (const ch of s) {
      if (/[\s{}()\[\];,.<>:=+\-*\/&|!@#$%^~`"'\\]/.test(ch)) { if (c) r.push(c); r.push(ch); c = ""; }
      else c += ch;
    }
    if (c) r.push(c); return r;
  };
  const a = tok(oldStr), b = tok(newStr);
  const dp = computeLCS(a, b);
  const so: Seg[] = [], sn: Seg[] = [];
  let i = a.length, j = b.length;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && a[i - 1] === b[j - 1]) { so.push({ text: a[i - 1], hl: false }); sn.push({ text: b[j - 1], hl: false }); i--; j--; }
    else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) { sn.push({ text: b[j - 1], hl: true }); j--; }
    else if (i > 0) { so.push({ text: a[i - 1], hl: true }); i--; }
  }
  return { oldSegs: so.reverse(), newSegs: sn.reverse() };
}

/* ------------------------------------------------------------------ */
/*  Context collapsing                                                 */
/* ------------------------------------------------------------------ */

const CTX = 3;

interface Chunk { kind: "lines" | "fold"; lines: DiffLine[]; count: number; }

function foldContext(diff: DiffLine[]): Chunk[] {
  if (diff.length <= 12) return [{ kind: "lines", lines: diff, count: diff.length }];
  const hot = new Set<number>();
  diff.forEach((l, i) => { if (l.type !== "unchanged") hot.add(i); });
  const vis = new Set<number>();
  hot.forEach(i => { for (let k = i - CTX; k <= i + CTX; k++) if (k >= 0 && k < diff.length) vis.add(k); });
  for (let k = 0; k < Math.min(CTX, diff.length); k++) vis.add(k);
  for (let k = Math.max(0, diff.length - CTX); k < diff.length; k++) vis.add(k);

  const chunks: Chunk[] = [];
  let buf: DiffLine[] = [], hidden: DiffLine[] = [];
  for (let i = 0; i < diff.length; i++) {
    if (vis.has(i)) {
      if (hidden.length) { if (buf.length) { chunks.push({ kind: "lines", lines: buf, count: buf.length }); buf = []; } chunks.push({ kind: "fold", lines: hidden, count: hidden.length }); hidden = []; }
      buf.push(diff[i]);
    } else { hidden.push(diff[i]); }
  }
  if (hidden.length) { if (buf.length) { chunks.push({ kind: "lines", lines: buf, count: buf.length }); buf = []; } chunks.push({ kind: "fold", lines: hidden, count: hidden.length }); }
  if (buf.length) chunks.push({ kind: "lines", lines: buf, count: buf.length });
  return chunks;
}

/* ------------------------------------------------------------------ */
/*  Split pairs                                                        */
/* ------------------------------------------------------------------ */

interface Pair { left?: DiffLine; right?: DiffLine; kind: "same" | "mod" | "add" | "del"; }

function splitPairs(diff: DiffLine[]): Pair[] {
  const out: Pair[] = []; let i = 0;
  while (i < diff.length) {
    if (diff[i].type === "unchanged") { out.push({ left: diff[i], right: diff[i], kind: "same" }); i++; }
    else if (diff[i].type === "removed") {
      const rm: DiffLine[] = [], ad: DiffLine[] = [];
      while (i < diff.length && diff[i].type === "removed") { rm.push(diff[i]); i++; }
      while (i < diff.length && diff[i].type === "added") { ad.push(diff[i]); i++; }
      const mx = Math.max(rm.length, ad.length);
      for (let k = 0; k < mx; k++) {
        const l = rm[k], r = ad[k];
        if (l && r) out.push({ left: l, right: r, kind: "mod" });
        else if (l) out.push({ left: l, kind: "del" });
        else if (r) out.push({ right: r, kind: "add" });
      }
    } else if (diff[i].type === "added") { out.push({ right: diff[i], kind: "add" }); i++; }
    else i++;
  }
  return out;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function extLabel(p: string) {
  const e = p.split(".").pop()?.toLowerCase() || "";
  const m: Record<string, string> = { cs: "C#", csproj: ".csproj", config: "Config", json: "JSON", xml: "XML", ts: "TypeScript", tsx: "TSX", js: "JavaScript", java: "Java", py: "Python" };
  return m[e] || e.toUpperCase();
}

/* ------------------------------------------------------------------ */
/*  Inline word highlight                                              */
/* ------------------------------------------------------------------ */

function HL({ segs, kind }: { segs: Seg[]; kind: "add" | "del" }) {
  return <>{segs.map((s, i) => s.hl
    ? <span key={i} className={kind === "add" ? "bg-emerald-200/50 dark:bg-emerald-700/30 rounded-[2px]" : "bg-rose-200/50 dark:bg-rose-700/30 rounded-[2px]"}>{s.text}</span>
    : <span key={i}>{s.text}</span>
  )}</>;
}

/* ================================================================== */
/*  MAIN COMPONENT                                                     */
/* ================================================================== */

export function CodeDiffViewer({ modifiedFiles, onDownloadZip }: CodeDiffViewerProps) {
  const [fileIdx, setFileIdx] = useState(0);
  const [view, setView] = useState<ViewMode>("split");
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [copied, setCopied] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const file = modifiedFiles[fileIdx];

  const diffData = useMemo(() => {
    if (!file) return { diff: [], stats: { additions: 0, deletions: 0 }, chunks: [] as Chunk[], pairs: [] as Pair[] };
    const diff = computeDiff(file.originalContent || "", file.content || "");
    return { diff, stats: getStats(diff), chunks: foldContext(diff), pairs: splitPairs(diff) };
  }, [file]);

  const allStats = useMemo(() => modifiedFiles.map(f => getStats(computeDiff(f.originalContent || "", f.content || ""))), [modifiedFiles]);
  const total = useMemo(() => allStats.reduce((a, s) => ({ additions: a.additions + s.additions, deletions: a.deletions + s.deletions }), { additions: 0, deletions: 0 }), [allStats]);

  useEffect(() => { setExpanded(new Set()); scrollRef.current?.scrollTo(0, 0); }, [fileIdx]);

  const toggle = useCallback((i: number) => setExpanded(p => { const n = new Set(p); n.has(i) ? n.delete(i) : n.add(i); return n; }), []);
  const doCopy = useCallback(() => { if (file) { navigator.clipboard.writeText(file.path); setCopied(true); setTimeout(() => setCopied(false), 1200); } }, [file]);

  if (!modifiedFiles.length) return (
    <div className="rounded-lg border border-dashed border-border p-10 text-center">
      <FileText className="mx-auto h-10 w-10 text-muted-foreground/30 mb-2" />
      <p className="text-sm text-muted-foreground">No modified files to display</p>
    </div>
  );

  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden w-full min-w-0" style={{ maxWidth: "100%" }}>
      {/* ── Top bar ── */}
      <div className="flex items-center justify-between px-4 h-10 border-b border-border bg-muted/30 text-xs min-w-0">
        <div className="flex items-center gap-3">
          <span className="font-medium text-foreground">{modifiedFiles.length} file{modifiedFiles.length > 1 ? "s" : ""} changed</span>
          <span className="text-emerald-600 dark:text-emerald-400 font-medium">+{total.additions}</span>
          <span className="text-rose-600 dark:text-rose-400 font-medium">&minus;{total.deletions}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="flex rounded-md border border-border overflow-hidden">
            <button onClick={() => setView("unified")} className={`px-2.5 py-1 text-[11px] font-medium flex items-center gap-1 ${view === "unified" ? "bg-foreground/10 text-foreground" : "text-muted-foreground hover:text-foreground hover:bg-muted/50"}`}>
              <AlignJustify className="h-3 w-3" /> Unified
            </button>
            <button onClick={() => setView("split")} className={`px-2.5 py-1 text-[11px] font-medium flex items-center gap-1 border-l border-border ${view === "split" ? "bg-foreground/10 text-foreground" : "text-muted-foreground hover:text-foreground hover:bg-muted/50"}`}>
              <Columns2 className="h-3 w-3" /> Split
            </button>
          </div>
          <Button variant="ghost" size="sm" onClick={onDownloadZip} className="h-7 text-[11px] gap-1 text-muted-foreground hover:text-foreground">
            <Download className="h-3 w-3" /> Download All
          </Button>
        </div>
      </div>

      <div className="flex min-w-0" style={{ height: "calc(100vh - 280px)", minHeight: 420, maxWidth: "100%" }}>
        {/* ── File sidebar ── */}
        <div className="w-64 flex-shrink-0 border-r border-border overflow-y-auto bg-card min-w-0">
          {modifiedFiles.map((f, i) => {
            const s = allStats[i]; const on = fileIdx === i;
            const name = f.path.split("/").pop() || f.path;
            const dir = f.path.split("/").slice(0, -1).join("/");
            return (
              <button key={i} onClick={() => setFileIdx(i)}
                className={`w-full text-left px-3 py-2 border-b border-border/40 transition-colors ${on ? "bg-muted/60 border-l-[3px] border-l-foreground/50" : "border-l-[3px] border-l-transparent hover:bg-muted/30"}`}>
                <div className="flex items-start gap-2">
                  <FileCode2 className={`h-3.5 w-3.5 mt-[3px] flex-shrink-0 ${on ? "text-foreground" : "text-muted-foreground"}`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className={`text-[12.5px] font-medium truncate ${on ? "text-foreground" : "text-foreground/80"}`}>{name}</span>
                      {(f.isNew || (!f.originalContent && f.content)) && (
                        <span className="shrink-0 text-[9px] px-1 py-0.5 rounded bg-emerald-500/15 text-emerald-500 font-semibold">NEW</span>
                      )}
                    </div>
                    {dir && <div className="text-[10.5px] text-muted-foreground/70 truncate">{dir}</div>}
                    <div className="flex items-center gap-1.5 mt-1">
                      <span className="text-[10.5px] font-medium text-emerald-600 dark:text-emerald-400">+{s?.additions || 0}</span>
                      <span className="text-[10.5px] font-medium text-rose-600 dark:text-rose-400">-{s?.deletions || 0}</span>
                      <div className="flex-1 h-[3px] rounded-full bg-border overflow-hidden flex ml-1">
                        {s && (s.additions + s.deletions > 0) && <>
                          <div className="h-full bg-emerald-500/70" style={{ width: `${s.additions / (s.additions + s.deletions) * 100}%` }} />
                          <div className="h-full bg-rose-500/70" style={{ width: `${s.deletions / (s.additions + s.deletions) * 100}%` }} />
                        </>}
                      </div>
                    </div>
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        {/* ── Main diff area ── */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* File path header */}
          <div className="flex items-center justify-between px-3 h-9 border-b border-border bg-muted/20 flex-shrink-0">
            <div className="flex items-center gap-2 min-w-0">
              <button onClick={doCopy} className="flex items-center gap-1 min-w-0 group" title="Copy path">
                {copied ? <Check className="h-3 w-3 text-emerald-500 flex-shrink-0" /> : <Copy className="h-3 w-3 text-muted-foreground/50 group-hover:text-muted-foreground flex-shrink-0" />}
                <span className="text-xs font-mono text-foreground/80 truncate">{file?.path}</span>
              </button>
              <span className="text-[10px] font-medium text-muted-foreground bg-muted px-1.5 py-0.5 rounded flex-shrink-0">{extLabel(file?.path || "")}</span>
              {file && (file.isNew || (!file.originalContent && file.content)) && (
                <span className="text-[10px] font-semibold text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded flex-shrink-0">New File</span>
              )}
            </div>
            <div className="flex items-center gap-2 text-[11px] flex-shrink-0">
              <span className="text-emerald-600 dark:text-emerald-400 font-medium">+{diffData.stats.additions}</span>
              <span className="text-rose-600 dark:text-rose-400 font-medium">-{diffData.stats.deletions}</span>
            </div>
          </div>

          {/* Change badges */}
          {file?.changes?.length > 0 && (
            <div className="flex items-center gap-1.5 px-3 h-7 border-b border-border bg-muted/10 flex-shrink-0">
              <span className="text-[10px] text-muted-foreground">Changes:</span>
              {file.changes.map((c, i) => (
                <span key={i} className="inline-flex items-center gap-1 text-[10px] text-foreground/70 bg-muted/60 px-1.5 py-0.5 rounded">
                  {c.package} <span className="text-muted-foreground">{c.oldVersion}</span> <span className="text-[9px]">→</span> <span className="font-medium text-foreground/90">{c.newVersion}</span>
                </span>
              ))}
            </div>
          )}

          {/* ═══ THE SINGLE SCROLL CONTAINER ═══ */}
          <div ref={scrollRef} className="flex-1 overflow-auto min-w-0">
            {view === "unified"
              ? <UnifiedTable chunks={diffData.chunks} diff={diffData.diff} expanded={expanded} toggle={toggle} />
              : <SplitTable pairs={diffData.pairs} />
            }
          </div>
        </div>
      </div>
    </div>
  );
}

/* ================================================================== */
/*  UNIFIED VIEW — rendered as a <table> for perfect column alignment */
/* ================================================================== */

function UnifiedTable({ chunks, diff, expanded, toggle }: {
  chunks: Chunk[]; diff: DiffLine[]; expanded: Set<number>; toggle: (i: number) => void;
}) {
  return (
    <table className="min-w-full border-collapse font-mono text-[12.5px] leading-[20px]">
      <colgroup>
        <col style={{ width: 52 }} />
        <col style={{ width: 52 }} />
        <col style={{ width: 20 }} />
        <col />
      </colgroup>
      <tbody>
        {chunks.map((chunk, ci) => {
          if (chunk.kind === "fold" && !expanded.has(ci)) {
            return (
              <tr key={ci} className="cursor-pointer group" onClick={() => toggle(ci)}>
                <td colSpan={4} className="py-[3px] px-3 text-[11px] text-muted-foreground bg-muted/20 border-y border-border/30 hover:bg-muted/40 transition-colors">
                  <span className="flex items-center gap-1.5 font-sans">
                    <ChevronRight className="h-3 w-3" />
                    {chunk.count} unchanged lines
                  </span>
                </td>
              </tr>
            );
          }
          const lines = chunk.kind === "fold" ? chunk.lines : chunk.lines;
          return lines.map((line, li) => {
            const isAdd = line.type === "added", isDel = line.type === "removed";
            let content: React.ReactNode = line.content;

            if (isAdd || isDel) {
              const pIdx = findPair(line, diff);
              if (pIdx !== null) {
                const p = diff[pIdx];
                const { oldSegs, newSegs } = wordDiff(isDel ? line.content : p.content, isAdd ? line.content : p.content);
                content = <HL segs={isDel ? oldSegs : newSegs} kind={isDel ? "del" : "add"} />;
              }
            }

            return (
              <tr key={`${ci}-${li}`}
                className={isAdd ? "bg-emerald-50/40 dark:bg-emerald-950/15" : isDel ? "bg-rose-50/40 dark:bg-rose-950/15" : "hover:bg-muted/20"}>
                <td className={`text-right pr-2 select-none text-[11px] text-muted-foreground/40 border-r border-border/20 ${isAdd ? "bg-emerald-100/30 dark:bg-emerald-900/15" : isDel ? "bg-rose-100/30 dark:bg-rose-900/15" : ""}`}>
                  {line.oldLineNum ?? ""}
                </td>
                <td className={`text-right pr-2 select-none text-[11px] text-muted-foreground/40 border-r border-border/20 ${isAdd ? "bg-emerald-100/30 dark:bg-emerald-900/15" : isDel ? "bg-rose-100/30 dark:bg-rose-900/15" : ""}`}>
                  {line.newLineNum ?? ""}
                </td>
                <td className={`text-center select-none font-medium ${isAdd ? "text-emerald-600/70 dark:text-emerald-400/70" : isDel ? "text-rose-600/70 dark:text-rose-400/70" : "text-transparent"}`}>
                  {isAdd ? "+" : isDel ? "-" : " "}
                </td>
                <td className="whitespace-pre pl-1 pr-4">{content}</td>
              </tr>
            );
          });
        })}
      </tbody>
    </table>
  );
}

/* ================================================================== */
/*  SPLIT VIEW — two side-by-side panels with synchronized scrolling  */
/*  Left = original, Right = modified. Both visible at all times.     */
/*  Scrolling either panel (horizontal or vertical) syncs the other.  */
/* ================================================================== */

function SplitTable({ pairs }: { pairs: Pair[] }) {
  const leftRef = useRef<HTMLDivElement>(null);
  const rightRef = useRef<HTMLDivElement>(null);
  const ticking = useRef(false);

  const syncScroll = useCallback((source: "left" | "right") => {
    if (ticking.current) return;
    ticking.current = true;
    requestAnimationFrame(() => {
      const src = source === "left" ? leftRef.current : rightRef.current;
      const tgt = source === "left" ? rightRef.current : leftRef.current;
      if (src && tgt) {
        tgt.scrollTop = src.scrollTop;
        tgt.scrollLeft = src.scrollLeft;
      }
      ticking.current = false;
    });
  }, []);

  const enriched = useMemo(() => pairs.map(p => {
    let lContent: React.ReactNode = p.left?.content ?? "";
    let rContent: React.ReactNode = p.right?.content ?? "";
    if (p.kind === "mod" && p.left && p.right) {
      const { oldSegs, newSegs } = wordDiff(p.left.content, p.right.content);
      lContent = <HL segs={oldSegs} kind="del" />;
      rContent = <HL segs={newSegs} kind="add" />;
    }
    return { ...p, lContent, rContent };
  }), [pairs]);

  return (
    <div className="flex h-full">
      {/* ─ LEFT PANEL (original) ─ */}
      <div
        ref={leftRef}
        className="w-1/2 overflow-auto border-r border-border/40"
        onScroll={() => syncScroll("left")}
      >
        <table className="min-w-full border-collapse font-mono text-[12.5px] leading-[20px]">
          <colgroup>
            <col style={{ width: 44 }} />
            <col style={{ width: 16 }} />
            <col />
          </colgroup>
          <tbody>
            {enriched.map((p, i) => {
              const isDel = p.kind === "del" || p.kind === "mod";
              const lRowBg = isDel ? "bg-rose-50/30 dark:bg-rose-950/10" : p.kind === "add" ? "bg-muted/5" : "";
              const lGut = isDel ? "bg-rose-100/20 dark:bg-rose-900/10" : "";
              return (
                <tr key={i} className="hover:bg-muted/10">
                  <td className={`text-right pr-1.5 select-none text-[11px] text-muted-foreground/40 border-r border-border/15 ${lGut} ${lRowBg}`}>
                    {p.left?.oldLineNum ?? ""}
                  </td>
                  <td className={`text-center select-none font-medium ${isDel ? "text-rose-500/60 dark:text-rose-400/60" : "text-transparent"} ${lRowBg}`}>
                    {isDel ? "-" : " "}
                  </td>
                  <td className={`whitespace-pre pl-1 pr-2 ${lRowBg}`}>
                    {p.left ? p.lContent : ""}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* ─ RIGHT PANEL (modified) ─ */}
      <div
        ref={rightRef}
        className="w-1/2 overflow-auto"
        onScroll={() => syncScroll("right")}
      >
        <table className="min-w-full border-collapse font-mono text-[12.5px] leading-[20px]">
          <colgroup>
            <col style={{ width: 44 }} />
            <col style={{ width: 16 }} />
            <col />
          </colgroup>
          <tbody>
            {enriched.map((p, i) => {
              const isAdd = p.kind === "add" || p.kind === "mod";
              const rRowBg = isAdd ? "bg-emerald-50/30 dark:bg-emerald-950/10" : p.kind === "del" ? "bg-muted/5" : "";
              const rGut = isAdd ? "bg-emerald-100/20 dark:bg-emerald-900/10" : "";
              return (
                <tr key={i} className="hover:bg-muted/10">
                  <td className={`text-right pr-1.5 select-none text-[11px] text-muted-foreground/40 border-r border-border/15 ${rGut} ${rRowBg}`}>
                    {p.right?.newLineNum ?? ""}
                  </td>
                  <td className={`text-center select-none font-medium ${isAdd ? "text-emerald-500/60 dark:text-emerald-400/60" : "text-transparent"} ${rRowBg}`}>
                    {isAdd ? "+" : " "}
                  </td>
                  <td className={`whitespace-pre pl-1 pr-2 ${rRowBg}`}>
                    {p.right ? p.rContent : ""}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Helper: find paired add/remove for word-level diff                 */
/* ------------------------------------------------------------------ */

function findPair(line: DiffLine, diff: DiffLine[]): number | null {
  const idx = diff.indexOf(line);
  if (idx === -1) return null;
  if (line.type === "removed") {
    let k = idx + 1;
    while (k < diff.length && diff[k].type === "removed") k++;
    return k < diff.length && diff[k].type === "added" ? k : null;
  }
  if (line.type === "added") {
    let k = idx - 1;
    while (k >= 0 && diff[k].type === "added") k--;
    return k >= 0 && diff[k].type === "removed" ? k : null;
  }
  return null;
}
