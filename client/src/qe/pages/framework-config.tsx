import { useState, useRef, useCallback, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { DashboardHeader } from "@/components/dashboard/header";
import {
  Loader2,
  AlertCircle,
  RefreshCw,
  ArrowLeft,
  Plus,
  Trash2,
  Edit2,
  Settings2,
  Code2,
} from "lucide-react";

// ─────────────────────────────────────────────────────────────
// CSS Animations
// ─────────────────────────────────────────────────────────────
function GlobalAnimations() {
  return (
    <style>{`
      @keyframes fwScan {
        0%   { top: 0%;   opacity: 0.6; }
        45%  { opacity: 0.6; }
        50%  { top: 100%; opacity: 0; }
        51%  { top: 0%;   opacity: 0; }
        55%  { opacity: 0.6; }
        100% { top: 0%;   opacity: 0.6; }
      }
      @keyframes fwPulse {
        0%, 100% { opacity: 1;   transform: scale(1); }
        50%      { opacity: 0.4; transform: scale(0.85); }
      }
      @keyframes fwFadeIn {
        from { opacity: 0; transform: translateY(8px); }
        to   { opacity: 1; transform: translateY(0); }
      }
      @media (prefers-reduced-motion: reduce) {
        * { animation: none !important; transition: none !important; }
      }
    `}</style>
  );
}

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────
interface FrameworkConfig {
  id: string;
  projectId: string | null;
  name: string;
  framework: string;
  language: string;
  description: string | null;
  isGlobal: number;
  baseClass: string | null;
  sampleScript: string | null;
  createdAt: string;
  updatedAt: string;
  functionCount: number;
  fileCount: number;
  detectedPattern: string | null;
  detectedLanguage: string | null;
  detectedTool: string | null;
}

interface FrameworkFunction {
  id: string;
  configId: string;
  name: string;
  signature: string;
  description: string | null;
  category: string;
  returnType: string | null;
  parameters: Array<{ name: string; type: string }>;
  sourceFile: string | null;
  isCustom: number;
  createdAt: string;
}

interface FrameworkFile {
  id: string;
  configId: string;
  filename: string;
  content: string;
  fileType: string;
  parsedAt: string;
}

interface ConfigDetail extends FrameworkConfig {
  functions: FrameworkFunction[];
  files: FrameworkFile[];
}

interface SampleFramework {
  name: string;
  filename: string;
  description: string;
  language: string;
  tool: string;
  pattern: string;
  fileCount: number;
  keyClasses: string[];
  downloadUrl: string;
}

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────
async function apiFetch(url: string, opts?: RequestInit) {
  const res = await fetch(url, { headers: { "Content-Type": "application/json" }, ...opts });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error || "Request failed");
  }
  return res.json();
}

function relativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins  = Math.floor(diff / 60_000);
  const hours = Math.floor(diff / 3_600_000);
  const days  = Math.floor(diff / 86_400_000);
  if (mins  <  1) return "just now";
  if (mins  < 60) return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  return `${days}d ago`;
}

function getOrbStyle(lang: string | null): { bg: string; color: string; abbr: string } {
  const l = (lang ?? "").toLowerCase();
  if (l === "typescript") return { bg: "#E8F0FB", color: "hsl(var(--primary))", abbr: "TS" };
  if (l === "java")       return { bg: "#E6EDF9", color: "#1A4A8A", abbr: "JV" };
  if (l === "javascript") return { bg: "#FDF3DC", color: "#8A5A00", abbr: "JS" };
  if (l === "python")     return { bg: "#EAF3DE", color: "#2E6010", abbr: "PY" };
  if (l === "csharp")     return { bg: "#F3E8FB", color: "#6A1A9A", abbr: "C#" };
  return { bg: "hsl(var(--muted))", color: "hsl(var(--muted-foreground))", abbr: l.substring(0, 2).toUpperCase() || "?" };
}

function getFnPill(fnName: string, category: string): { label: string; bg: string; color: string } {
  const text = (fnName + " " + category).toLowerCase();
  if (/fill|type|enter|input|set/.test(text))    return { label: "fill",     bg: "#E1F5EE", color: "#085041" };
  if (/click|tap|press|select/.test(text))        return { label: "click",    bg: "#E6EDF9", color: "#0C447C" };
  if (/navigat|goto|visit|open/.test(text))       return { label: "navigate", bg: "#FAEEDA", color: "#633806" };
  if (/assert|verify|check|expect/.test(text))    return { label: "assert",   bg: "#EAF3DE", color: "#27500A" };
  return { label: "other", bg: "hsl(var(--muted))", color: "hsl(var(--muted-foreground))" };
}

function computeConfidence(cfg: FrameworkConfig): { level: string; color: string } {
  const n = [cfg.detectedPattern, cfg.detectedLanguage, cfg.detectedTool].filter(Boolean).length;
  if (n === 3) return { level: "High",    color: "#27500A" };
  if (n  >  0) return { level: "Partial", color: "#633806" };
  return          { level: "None",     color: "hsl(var(--muted-foreground))" };
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function highlightCode(code: string): string {
  const escaped = escapeHtml(code);
  return escaped
    // keywords
    .replace(/\b(class|extends|await|public|void|return)\b/g,
      '<span style="color:#185FA5;font-weight:500">$1</span>')
    // this.
    .replace(/\b(this\.)/g,
      '<span style="color:#854F0B">$1</span>')
    // function names before (
    .replace(/([a-zA-Z_$][a-zA-Z0-9_$]*)(?=\()/g,
      '<span style="color:#3B6D11;font-weight:500">$1</span>')
    // curly braces
    .replace(/([{}])/g,
      '<span style="color:#888780">$1</span>');
}

function buildBox1Code(cfg: ConfigDetail): string {
  const fns = cfg.functions;
  if (fns.length === 0) return "// Upload files to see\n// your code here";
  const base = cfg.baseClass || "BasePage";
  const pattern = (cfg.detectedPattern ?? "").toUpperCase();
  if (pattern === "BDD" || pattern === "BDD+POM") {
    const fn = fns[0];
    if (pattern === "BDD+POM") {
      return `// BDD step using POM method\nGiven('login scenario', async () => {\n  await loginPage.${fn.name}();\n});`;
    }
    return `Given('scenario', () => {\n  ${fn.name}();\n});`;
  }
  const fill  = fns.find(f => /fill|type|enter|input|set/i.test(f.name + " " + f.category));
  const click = fns.find(f => /click|tap|press/i.test(f.name + " " + f.category));
  const nav   = fns.find(f => /navigat|goto|visit/i.test(f.name + " " + f.category));
  const lines = [`class ${base} {`];
  if (fill)  lines.push(`  ${fill.name}(el, val)`);
  if (click) lines.push(`  ${click.name}(el)`);
  if (nav)   lines.push(`  ${nav.name}(url)`);
  lines.push("}");
  return lines.join("\n");
}

function buildBox3Code(cfg: ConfigDetail): string {
  const lang = (cfg.detectedLanguage ?? "").toLowerCase();
  const base = cfg.baseClass || "BasePage";
  const fill = cfg.functions.find(f => /fill|type|enter/i.test(f.name + " " + f.category));
  const fillName = fill?.name ?? "fillInput";
  if (!lang && !cfg.baseClass && cfg.functions.length === 0) {
    return "// Select a framework\n// to preview output";
  }
  if (lang === "java") {
    return `public class LoginPage\n  extends ${base} {\n  ${fillName}(field, value);\n}`;
  }
  const pattern = (cfg.detectedPattern ?? "").toUpperCase();
  if (pattern === "BDD+POM") {
    return `Feature: Login\nScenario: Valid login\n  Given I am on login page\n\n// LoginPage.ts (POM)\nclass LoginPage extends ${base} {\n  async ${fillName}(email, val) {}\n}`;
  }
  if (pattern === "BDD") {
    return `Feature: Login\nScenario: Valid login\n  Given I am on login page`;
  }
  return `class LoginPage extends ${base} {\n  await this.${fillName}(\n    email, val\n  )\n}`;
}

// ─────────────────────────────────────────────────────────────
// Create Config Dialog (preserved)
// ─────────────────────────────────────────────────────────────
interface CreateDialogProps {
  open: boolean;
  onClose: () => void;
  onCreated: (id?: string) => void;
}

function CreateConfigDialog({ open, onClose, onCreated }: CreateDialogProps) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [form, setForm] = useState({ name: "", framework: "", language: "", description: "", baseClass: "", isGlobal: false });
  const set = (k: keyof typeof form) => (v: string | boolean) => setForm(prev => ({ ...prev, [k]: v }));
  const createMut = useMutation({
    mutationFn: () => apiFetch("/api/framework-config", { method: "POST", body: JSON.stringify({ ...form, isGlobal: form.isGlobal ? 1 : 0 }) }),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["framework-configs"] });
      toast({ title: "Framework created", description: `"${form.name}" is ready for file upload.` });
      setForm({ name: "", framework: "", language: "", description: "", baseClass: "", isGlobal: false });
      onCreated(data?.id);
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Settings2 className="w-5 h-5" /> New Framework
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label>Name <span className="text-red-500">*</span></Label>
            <Input placeholder="e.g. Insurance Portal Selenium Suite" value={form.name} onChange={e => set("name")(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Framework <span className="text-red-500">*</span></Label>
              <Select value={form.framework} onValueChange={set("framework")}>
                <SelectTrigger><SelectValue placeholder="Select framework" /></SelectTrigger>
                <SelectContent>
                  {["Selenium","Playwright","TestComplete","Cypress","All Frameworks"].map(f => <SelectItem key={f} value={f}>{f}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Language <span className="text-red-500">*</span></Label>
              <Select value={form.language} onValueChange={set("language")}>
                <SelectTrigger><SelectValue placeholder="Select language" /></SelectTrigger>
                <SelectContent>
                  {["Java","TypeScript","JavaScript","Python","C#"].map(l => <SelectItem key={l} value={l}>{l}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Description</Label>
            <Textarea placeholder="Briefly describe this framework…" rows={2} value={form.description} onChange={e => set("description")(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Base Class Name (optional)</Label>
            <Input placeholder="e.g. BaseTest, BasePage" value={form.baseClass} onChange={e => set("baseClass")(e.target.value)} />
          </div>
          <div className="flex items-center justify-between rounded-lg border p-3">
            <div>
              <p className="text-sm font-medium">Global Golden Repo</p>
              <p className="text-xs text-muted-foreground">Available to all projects</p>
            </div>
            <Switch checked={form.isGlobal} onCheckedChange={v => set("isGlobal")(v)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => createMut.mutate()} disabled={createMut.isPending || !form.name || !form.framework || !form.language}>
            {createMut.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />} Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─────────────────────────────────────────────────────────────
// Add / Edit Function Dialog (preserved)
// ─────────────────────────────────────────────────────────────
interface AddFunctionDialogProps {
  configId: string;
  open: boolean;
  existing: FrameworkFunction | null;
  onClose: () => void;
  onSaved: () => void;
}

function AddFunctionDialog({ configId, open, existing, onClose, onSaved }: AddFunctionDialogProps) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [form, setForm] = useState({ name: existing?.name ?? "", signature: existing?.signature ?? "", description: existing?.description ?? "", category: existing?.category ?? "generic", returnType: existing?.returnType ?? "void" });
  const prevRef = useRef(open);
  if (open !== prevRef.current) {
    prevRef.current = open;
    if (open) setForm({ name: existing?.name ?? "", signature: existing?.signature ?? "", description: existing?.description ?? "", category: existing?.category ?? "generic", returnType: existing?.returnType ?? "void" });
  }
  const set = (k: keyof typeof form) => (v: string) => setForm(p => ({ ...p, [k]: v }));
  const saveMut = useMutation({
    mutationFn: () => existing
      ? apiFetch(`/api/framework-config/${configId}/functions/${existing.id}`, { method: "PUT", body: JSON.stringify(form) })
      : apiFetch(`/api/framework-config/${configId}/functions`, { method: "POST", body: JSON.stringify(form) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["framework-config", configId] }); toast({ title: existing ? "Function updated" : "Function added", description: form.name }); onSaved(); },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>{existing ? "Edit Function" : "Add Function"}</DialogTitle></DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label>Name <span className="text-red-500">*</span></Label>
            <Input placeholder="e.g. clickLoginButton" value={form.name} onChange={e => set("name")(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Signature <span className="text-red-500">*</span></Label>
            <Input placeholder="e.g. clickLoginButton(el: Locator): Promise<void>" value={form.signature} onChange={e => set("signature")(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Category</Label>
              <Select value={form.category} onValueChange={set("category")}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["generic","navigation","assertion","setup","data","business"].map(c => <SelectItem key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Return Type</Label>
              <Input placeholder="void" value={form.returnType} onChange={e => set("returnType")(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Description</Label>
            <Textarea placeholder="What does this function do?" rows={2} value={form.description} onChange={e => set("description")(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => saveMut.mutate()} disabled={saveMut.isPending || !form.name || !form.signature}>
            {saveMut.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />} {existing ? "Save" : "Add"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─────────────────────────────────────────────────────────────
// Section 2 — Sidebar Card
// ─────────────────────────────────────────────────────────────
interface SidebarCardProps {
  cfg: FrameworkConfig;
  active: boolean;
  onClick: () => void;
}

function FunctionBar({ count }: { count: number }) {
  const [w, setW] = useState(0);
  useEffect(() => {
    const t = setTimeout(() => setW(Math.min((count / 20) * 100, 100)), 150);
    return () => clearTimeout(t);
  }, [count]);
  return (
    <div style={{ height: 3, borderRadius: 2, background: "hsl(var(--muted))", overflow: "hidden" }}>
      <div style={{ height: "100%", width: `${w}%`, background: "hsl(var(--primary))", borderRadius: 2, transition: "width 0.6s cubic-bezier(0.4,0,0.2,1)" }} />
    </div>
  );
}

function SidebarCard({ cfg, active, onClick }: SidebarCardProps) {
  const orb = getOrbStyle(cfg.detectedLanguage ?? cfg.language);
  const detected = [cfg.detectedPattern, cfg.detectedLanguage, cfg.detectedTool].filter(Boolean).length;
  const stackLine = cfg.detectedLanguage
    ? [cfg.detectedLanguage, cfg.detectedTool, cfg.detectedPattern].filter(Boolean).join(" · ")
    : [cfg.language, cfg.framework].filter(Boolean).join(" · ");

  const dotColor = detected === 3 ? "hsl(var(--primary))" : detected > 0 ? "#EF9F27" : "hsl(var(--muted-foreground))";
  const statusText = detected === 3
    ? "Auto-detected · high confidence"
    : detected > 0
    ? "Partially detected · add more files"
    : "Upload files to activate detection";

  return (
    <button
      onClick={onClick}
      style={{
        width: "100%",
        minWidth: 0,
        maxWidth: "100%",
        overflow: "hidden",
        textAlign: "left",
        borderRadius: 12,
        padding: 12,
        marginBottom: 8,
        cursor: "pointer",
        border: active ? "1.5px solid #185FA5" : "0.5px solid #E5E4E2",
        background: active ? "#E6F1FB" : "transparent",
        transition: "border-color 0.15s, background 0.15s",
      }}
      onMouseEnter={e => { if (!active) { (e.currentTarget as HTMLButtonElement).style.borderColor = "hsl(var(--border))"; (e.currentTarget as HTMLButtonElement).style.background = "hsl(var(--muted) / 0.5)"; } }}
      onMouseLeave={e => { if (!active) { (e.currentTarget as HTMLButtonElement).style.borderColor = "hsl(var(--border))"; (e.currentTarget as HTMLButtonElement).style.background = "transparent"; } }}
    >
      {/* Row 1 — orb + name + stack */}
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10, marginBottom: 8 }}>
        <div style={{ width: 32, height: 32, borderRadius: "50%", background: orb.bg || "hsl(var(--muted))", color: orb.color, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 700, flexShrink: 0, letterSpacing: "0.03em" }}>
          {orb.abbr}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 500, color: active ? "#0C447C" : "inherit", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "100%", display: "block" }}>
            {cfg.name}
          </div>
          <div style={{ fontSize: 11, color: "hsl(var(--muted-foreground))", marginTop: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {stackLine}
          </div>
        </div>
      </div>

      {/* Row 2 — detection status */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
        <div
          style={{ width: 5, height: 5, borderRadius: "50%", background: dotColor, flexShrink: 0, animation: detected === 3 ? "fwPulse 2s ease-in-out infinite" : undefined }}
        />
        <span style={{ fontSize: 10, color: "hsl(var(--muted-foreground))" }}>{statusText}</span>
      </div>

      {/* Row 3 — function absorption bar */}
      <div>
        <FunctionBar count={cfg.functionCount} />
        <div style={{ fontSize: 10, color: "hsl(var(--muted-foreground))", textAlign: "right", marginTop: 3 }}>
          {cfg.functionCount} {cfg.functionCount === 1 ? "function" : "functions"}
        </div>
      </div>
    </button>
  );
}

// ─────────────────────────────────────────────────────────────
// Section 3 — Sample Frameworks Sidebar Bottom
// ─────────────────────────────────────────────────────────────
function SampleSidebarSection() {
  const { toast } = useToast();
  const [dlg, setDlg] = useState<string | null>(null);

  const { data: samples } = useQuery<SampleFramework[]>({
    queryKey: ["sample-frameworks"],
    queryFn: () => apiFetch("/api/sample-frameworks"),
    staleTime: Infinity,
  });

  const dotColors: Record<string, string> = { java: "#1A4A8A", typescript: "hsl(var(--primary))", javascript: "#8A5A00" };

  const download = async (fw: SampleFramework) => {
    setDlg(fw.filename);
    try {
      const res = await fetch(fw.downloadUrl);
      if (!res.ok) throw new Error("Download failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = fw.filename; a.click();
      URL.revokeObjectURL(url);
      toast({ title: "Downloaded", description: fw.filename });
    } catch (e: unknown) {
      toast({ title: "Download failed", description: e instanceof Error ? e.message : "Unknown error", variant: "destructive" });
    } finally { setDlg(null); }
  };

  if (!samples || samples.length === 0) return null;

  return (
    <div style={{ marginTop: "auto", borderTop: "0.5px solid #E5E4E2", padding: "12px 16px" }}>
      <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.06em", color: "hsl(var(--muted-foreground))", marginBottom: 4 }}>
        Start with a sample
      </div>
      <div style={{ fontSize: 11, color: "hsl(var(--muted-foreground))", lineHeight: 1.5, marginBottom: 10 }}>
        Download a production-ready framework, upload it, and start generating immediately.
      </div>
      {samples.map(fw => (
        <button
          key={fw.filename}
          onClick={() => download(fw)}
          disabled={dlg === fw.filename}
          style={{ width: "100%", display: "flex", alignItems: "center", gap: 8, padding: "5px 0", background: "none", border: "none", cursor: "pointer" }}
        >
          <div style={{ width: 6, height: 6, borderRadius: "50%", background: dotColors[fw.language] ?? "hsl(var(--muted-foreground))", flexShrink: 0 }} />
          <span style={{ flex: 1, fontSize: 11, color: "hsl(var(--muted-foreground))", textAlign: "left" }}>
            {fw.name.replace("NAT2.0 ", "").replace(" + NameMapping", "")}
          </span>
          {dlg === fw.filename
            ? <Loader2 style={{ width: 10, height: 10, color: "hsl(var(--primary))" }} className="animate-spin" />
            : <span style={{ fontSize: 10, color: "hsl(var(--primary))" }}>↓</span>
          }
        </button>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Section 5 — Transformation Strip
// ─────────────────────────────────────────────────────────────
interface TransformationStripProps { config: ConfigDetail; }

function CodeBox({ label, code, accent, scanning }: { label: string; code: string; accent?: boolean; scanning?: boolean }) {
  return (
    <div style={{ flex: 1, minWidth: 0, border: accent ? "1px solid #185FA5" : "0.5px solid #E5E4E2", borderRadius: 8, padding: "10px 12px", minHeight: 90, position: "relative", overflow: "hidden", background: accent ? "transparent" : "hsl(var(--muted) / 0.5)" }}>
      <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.06em", color: accent ? "hsl(var(--primary))" : "hsl(var(--muted-foreground))", marginBottom: 8 }}>{label}</div>
      <pre style={{ fontFamily: "var(--font-mono, ui-monospace, monospace)", fontSize: 12, lineHeight: 1.6, margin: 0, whiteSpace: "pre-wrap", color: "hsl(var(--foreground))" }} dangerouslySetInnerHTML={{ __html: highlightCode(code) }} />
      {scanning && (
        <div
          style={{ position: "absolute", left: 0, right: 0, height: 2, background: "hsl(var(--primary))", opacity: 0.5, pointerEvents: "none", animation: "fwScan 2.4s ease-in-out infinite" }}
        />
      )}
    </div>
  );
}

function ArrowConnector({ top, bottom }: { top: string; bottom: string }) {
  return (
    <div style={{ flexShrink: 0, width: 52, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 4 }}>
      <div style={{ display: "flex", alignItems: "center", width: "100%", paddingLeft: 4, paddingRight: 4 }}>
        <div style={{ flex: 1, height: 1, backgroundColor: "hsl(var(--border))" }} />
        <div style={{ width: 0, height: 0, borderTop: "5px solid transparent", borderBottom: "5px solid transparent", borderLeft: "7px solid #C0BDB8" }} />
      </div>
      <div style={{ fontSize: 9, color: "hsl(var(--muted-foreground))", textAlign: "center" as const, lineHeight: 1.4, marginTop: 2 }}>
        {top}<br />{bottom}
      </div>
    </div>
  );
}

function TransformationStrip({ config }: TransformationStripProps) {
  const box1 = buildBox1Code(config);
  const box3 = buildBox3Code(config);
  const scanning = !!config.detectedLanguage;

  const intelligenceItems = ["Detects language", "Maps function roles", "Learns conventions", "Stores base class"];

  return (
    <div style={{ borderTop: "0.5px solid #E5E4E2", borderBottom: "0.5px solid #E5E4E2", padding: "20px 32px 0" }}>
      <div style={{ fontSize: 11, fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.05em", color: "hsl(var(--muted-foreground))", marginBottom: 14 }}>
        How NAT uses this framework when generating
      </div>
      <div style={{ display: "flex", alignItems: "stretch", gap: 0, width: "100%", overflow: "hidden", padding: "0 0 20px" }}>
        <CodeBox label="Your uploaded code" code={box1} scanning={scanning} />
        <ArrowConnector top="NAT learns" bottom="your patterns" />
        <div style={{ flex: 1, minWidth: 0, overflow: "hidden", border: "0.5px solid #E5E4E2", borderRadius: 8, padding: "10px 12px", minHeight: 90, background: "hsl(var(--muted))" }}>
          <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.06em", color: "hsl(var(--muted-foreground))", marginBottom: 8 }}>NAT intelligence layer</div>
          {intelligenceItems.map(item => (
            <div key={item} style={{ fontSize: 12, color: "hsl(var(--muted-foreground))", lineHeight: 1.7 }}>{item}</div>
          ))}
        </div>
        <ArrowConnector top="Generates in" bottom="your language" />
        <CodeBox label="Generated output" code={box3} accent />
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Section 5b — File Breakdown Panel
// ─────────────────────────────────────────────────────────────
const CODE_EXTS = ['ts', 'tsx', 'js', 'jsx', 'java', 'py', 'cs', 'rb', 'kt', 'groovy', 'feature'];

function FileBreakdownPanel({ config, onRefresh }: { config: ConfigDetail; onRefresh: () => void }) {
  const { toast } = useToast();
  const [settingFile, setSettingFile] = useState<string | null>(null);
  const [sampleSet, setSampleSet]   = useState<string | null>(null); // filename that was last set as sample

  const files = config.files;
  if (!files || files.length === 0) return null;

  const extIcon: Record<string, string> = {
    ts: '🔷', tsx: '🔷', js: '🟡', jsx: '🟡',
    java: '☕', py: '🐍', cs: '🔵', feature: '🥒',
    xml: '📄', gradle: '🐘', json: '📦', yml: '⚙️', yaml: '⚙️',
  };

  const rows = files.map(f => {
    const fnCount = config.functions.filter(fn => fn.sourceFile === f.filename).length;
    const ext = f.filename.split('.').pop()?.toLowerCase() ?? '';
    const icon = extIcon[ext] ?? '📄';
    // Shorten long paths: keep last 2 segments
    const parts = f.filename.replace(/\\/g, '/').split('/');
    const label = parts.length > 2 ? `…/${parts.slice(-2).join('/')}` : f.filename;
    const isCode = CODE_EXTS.includes(ext);
    return { icon, label, full: f.filename, fnCount, ext, type: f.fileType ?? ext, isCode, content: f.content };
  });

  const totalFns = config.functions.length;
  const skippedFiles = rows.filter(r => r.fnCount === 0 && !['json', 'xml', 'yml', 'yaml', 'gradle'].includes(r.ext));

  // Current sampleScript filename detection (first 120 chars match)
  const currentSamplePrefix = config.sampleScript ? config.sampleScript.slice(0, 120) : null;

  async function handleSetAsSample(row: typeof rows[0]) {
    if (!row.content) { toast({ title: "No content", description: "File has no readable content.", variant: "destructive" }); return; }
    setSettingFile(row.full);
    try {
      const res = await fetch(`/api/framework-config/${config.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sampleScript: row.content }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: "Request failed" }));
        throw new Error(body.error || "Failed");
      }
      setSampleSet(row.full);
      toast({ title: "Sample set ✓", description: `"${row.label}" is now the reference sample for AI generation.` });
      onRefresh();
    } catch (e: any) {
      toast({ title: "Failed to set sample", description: e.message, variant: "destructive" });
    } finally {
      setSettingFile(null);
    }
  }

  return (
    <div style={{ padding: "0 32px 16px" }}>
      <div style={{ border: "0.5px solid #E5E4E2", borderRadius: 10, overflow: "hidden", background: "hsl(var(--card))" }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 14px", borderBottom: "0.5px solid #E5E4E2", background: "hsl(var(--muted) / 0.5)" }}>
          <div style={{ fontSize: 12, fontWeight: 500, color: "hsl(var(--foreground))", display: "flex", alignItems: "center", gap: 6 }}>
            <span>📁</span> {files.length} {files.length === 1 ? "file" : "files"} uploaded
          </div>
          <div style={{ fontSize: 11, color: "hsl(var(--muted-foreground))", display: "flex", alignItems: "center", gap: 8 }}>
            {totalFns} {totalFns === 1 ? "function" : "functions"} extracted
            {skippedFiles.length > 0 && (
              <span style={{ color: "#EF9F27" }}>
                · {skippedFiles.length} parsed with 0 functions
              </span>
            )}
            {config.sampleScript && (
              <span style={{ color: "#27500A", fontWeight: 500 }}>· sample set ✓</span>
            )}
          </div>
        </div>
        {/* File rows */}
        <div style={{ maxHeight: 220, overflowY: "auto" }}>
          {rows.map((r, i) => {
            const isCurrent = !!(currentSamplePrefix && r.content && r.content.slice(0, 120) === currentSamplePrefix);
            const justSet   = sampleSet === r.full;
            const loading   = settingFile === r.full;
            return (
              <div
                key={i}
                title={r.full}
                style={{
                  display: "flex", alignItems: "center", justifyContent: "space-between",
                  padding: "6px 14px", borderBottom: i < rows.length - 1 ? "0.5px solid #F0EFED" : "none",
                  fontSize: 11, color: "hsl(var(--foreground))",
                  background: isCurrent ? "#F0FBF0" : undefined,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
                  <span style={{ fontSize: 13 }}>{r.icon}</span>
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 300, fontFamily: "monospace" }}>
                    {r.label}
                  </span>
                  {isCurrent && (
                    <span style={{ fontSize: 9, background: "#D4EDDA", color: "#27500A", borderRadius: 3, padding: "1px 4px", fontWeight: 600, flexShrink: 0 }}>
                      SAMPLE
                    </span>
                  )}
                </div>
                <div style={{ flexShrink: 0, marginLeft: 12, display: "flex", alignItems: "center", gap: 6 }}>
                  {/* fn count badge */}
                  {r.fnCount > 0 ? (
                    <span style={{ background: "#EBF4FF", color: "hsl(var(--primary))", borderRadius: 4, padding: "1px 6px", fontSize: 10, fontWeight: 500 }}>
                      {r.fnCount} fn{r.fnCount > 1 ? "s" : ""}
                    </span>
                  ) : ['json', 'xml', 'yml', 'yaml', 'gradle'].includes(r.ext) ? (
                    <span style={{ background: "hsl(var(--muted))", color: "hsl(var(--muted-foreground))", borderRadius: 4, padding: "1px 6px", fontSize: 10 }}>config</span>
                  ) : (
                    <span style={{ background: "#FEF3E2", color: "#EF9F27", borderRadius: 4, padding: "1px 6px", fontSize: 10 }}>0 fns</span>
                  )}
                  {/* Set as sample button — only for code files */}
                  {r.isCode && !isCurrent && (
                    <button
                      onClick={() => handleSetAsSample(r)}
                      disabled={loading || !!settingFile}
                      style={{
                        background: justSet ? "#D4EDDA" : "hsl(var(--muted) / 0.5)",
                        color: justSet ? "#27500A" : "hsl(var(--muted-foreground))",
                        border: `0.5px solid ${justSet ? "#A8D5B5" : "hsl(var(--border))"}`,
                        borderRadius: 4, padding: "1px 7px", fontSize: 10, cursor: loading ? "wait" : "pointer",
                        whiteSpace: "nowrap", fontWeight: 500,
                        opacity: settingFile && !loading ? 0.5 : 1,
                      }}
                    >
                      {loading ? "Setting…" : justSet ? "Sample set ✓" : "Use as sample →"}
                    </button>
                  )}
                  {r.isCode && isCurrent && (
                    <button
                      onClick={() => handleSetAsSample(r)}
                      disabled={true}
                      style={{
                        background: "#D4EDDA", color: "#27500A",
                        border: "0.5px solid #A8D5B5",
                        borderRadius: 4, padding: "1px 7px", fontSize: 10,
                        cursor: "default", whiteSpace: "nowrap", fontWeight: 500,
                      }}
                    >
                      Sample ✓
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Section 6 — Function Panel
// ─────────────────────────────────────────────────────────────
interface FunctionPanelProps {
  config: ConfigDetail;
  onRefresh: () => void;
}

function FunctionPanel({ config, onRefresh }: FunctionPanelProps) {
  const [addOpen, setAddOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<FrameworkFunction | null>(null);

  const shown = config.functions.slice(0, 4);
  const remaining = config.functions.length - 4;

  return (
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <div style={{ fontSize: 13, fontWeight: 500, color: "hsl(var(--foreground))" }}>
          Extracted functions
          <span style={{ fontSize: 12, color: "hsl(var(--muted-foreground))", fontWeight: 400, marginLeft: 6 }}>· {config.functions.length} total</span>
        </div>
        <button
          onClick={() => { setEditTarget(null); setAddOpen(true); }}
          style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: "hsl(var(--primary))", background: "none", border: "none", cursor: "pointer", padding: "2px 0" }}
        >
          <Plus style={{ width: 11, height: 11 }} /> Add
        </button>
      </div>

      {config.functions.length === 0 ? (
        <div style={{ padding: "24px 0", textAlign: "center", color: "hsl(var(--muted-foreground))", fontSize: 12 }}>
          No functions yet — upload files to extract automatically.
        </div>
      ) : (
        <>
          {shown.map((fn, i) => {
            const pill = getFnPill(fn.name, fn.category);
            return (
              <div key={fn.id} style={{ padding: "9px 0", borderBottom: i < shown.length - 1 ? "0.5px solid #E5E4E2" : "none", display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 500, color: "hsl(var(--foreground))", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{fn.name}</div>
                  <div style={{ fontSize: 10, fontFamily: "ui-monospace, monospace", color: "hsl(var(--muted-foreground))", marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{fn.signature}</div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
                  <span style={{ fontSize: 10, fontWeight: 500, background: pill.bg, color: pill.color, borderRadius: 4, padding: "2px 7px" }}>{pill.label}</span>
                </div>
              </div>
            );
          })}
          {remaining > 0 && (
            <div style={{ marginTop: 10, fontSize: 11, color: "hsl(var(--primary))", cursor: "pointer" }}>
              + {remaining} more functions →
            </div>
          )}
        </>
      )}

      <AddFunctionDialog
        configId={config.id}
        open={addOpen}
        existing={editTarget}
        onClose={() => { setAddOpen(false); setEditTarget(null); }}
        onSaved={() => { setAddOpen(false); setEditTarget(null); onRefresh(); }}
      />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Helper — recursively read a dragged FileSystemDirectoryEntry
// ─────────────────────────────────────────────────────────────
const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '.next',
  'coverage', '__pycache__', 'target', '.gradle',
]);

async function readDirectory(
  dirEntry: FileSystemDirectoryEntry,
  path = '',
): Promise<File[]> {
  const allFiles: File[] = [];
  const reader = dirEntry.createReader();

  // readAllEntries: loops until readEntries returns an empty batch (FileSystem API
  // only guarantees up to 100 entries per call)
  const readAllEntries = (): Promise<FileSystemEntry[]> =>
    new Promise((res, rej) => {
      const batch: FileSystemEntry[] = [];
      function nextBatch() {
        reader.readEntries((entries) => {
          if (entries.length === 0) { res(batch); return; }
          batch.push(...entries);
          nextBatch();
        }, rej);
      }
      nextBatch();
    });

  const entries = await readAllEntries();

  // Process all entries in parallel for speed
  await Promise.all(entries.map(async (entry) => {
    if (entry.isFile) {
      const file = await new Promise<File>((res, rej) => {
        (entry as FileSystemFileEntry).file(
          (f) => res(new File([f], `${path}${entry.name}`, { type: f.type })),
          rej,
        );
      });
      allFiles.push(file);
    } else if (entry.isDirectory && !SKIP_DIRS.has(entry.name)) {
      const sub = await readDirectory(
        entry as FileSystemDirectoryEntry,
        `${path}${entry.name}/`,
      );
      allFiles.push(...sub);
    }
  }));

  return allFiles;
}

// ─────────────────────────────────────────────────────────────
// Section 6 — Drop Zone Panel
// ─────────────────────────────────────────────────────────────
interface DropZonePanelProps { configId: string; onRefresh: () => void; }

type UploadStatus = 'idle' | 'reading' | 'uploading' | 'analysing' | 'done';
interface UploadProgress { status: UploadStatus; fileCount: number; }

function DropZonePanel({ configId, onRefresh }: DropZonePanelProps) {
  const { toast } = useToast();
  const [dragging, setDragging] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<UploadProgress>({ status: 'idle', fileCount: 0 });
  const fileRef = useRef<HTMLInputElement>(null);

  const uploadFiles = useCallback(async (files: File[]) => {
    if (files.length === 0) return;
    const fd = new FormData();
    files.forEach(f => fd.append("files", f));
    setUploadProgress({ status: 'uploading', fileCount: files.length });
    try {
      const res = await fetch(`/api/framework-config/${configId}/upload-files`, { method: "POST", body: fd });
      if (!res.ok) { const b = await res.json().catch(() => ({ error: "Upload failed" })); throw new Error(b.error || "Upload failed"); }
      setUploadProgress({ status: 'analysing', fileCount: files.length });
      const result = await res.json();
      const s = result.summary;
      const processed = s?.totalProcessed ?? result.files?.length ?? files.length;
      setUploadProgress({ status: 'done', fileCount: processed });
      const fnsFound = s?.functionsFound ?? result.newFunctionsAdded ?? 0;
      const detectedStack = [s?.detectedLanguage, s?.detectedTool, s?.detectedPattern].filter(Boolean).join(' + ');
      const skipped = s?.totalSkipped ?? 0;
      if (fnsFound > 0) {
        toast({
          title: `✓ ${fnsFound} function${fnsFound > 1 ? 's' : ''} extracted`,
          description: `${processed} file${processed > 1 ? 's' : ''} processed${detectedStack ? ` · ${detectedStack}` : ''}${skipped > 0 ? ` · ${skipped} skipped` : ''}`,
        });
      } else if (detectedStack) {
        toast({
          title: "Framework detected — no functions found",
          description: `Stack: ${detectedStack} · ${processed} file${processed > 1 ? 's' : ''} processed. Try uploading source files (.ts, .js, .java, .py) rather than config files.`,
          variant: "default",
        });
      } else {
        toast({
          title: "Files uploaded",
          description: `${processed} file${processed > 1 ? 's' : ''} stored. Stack detection failed — check that source files were included.`,
          variant: "destructive",
        });
      }
      onRefresh();
      setTimeout(() => setUploadProgress({ status: 'idle', fileCount: 0 }), 3000);
    } catch (e: unknown) {
      toast({ title: "Upload error", description: e instanceof Error ? e.message : "Unknown error", variant: "destructive" });
      setUploadProgress({ status: 'idle', fileCount: 0 });
    }
  }, [configId, onRefresh, toast]);

  const handleFolderDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const items = Array.from(e.dataTransfer.items);
    const files: File[] = [];
    setUploadProgress({ status: 'reading', fileCount: 0 });
    for (const item of items) {
      if (item.kind === 'file') {
        const entry = item.webkitGetAsEntry?.();
        if (entry) {
          if (entry.isDirectory) {
            const folderFiles = await readDirectory(entry as FileSystemDirectoryEntry);
            files.push(...folderFiles);
            setUploadProgress({ status: 'reading', fileCount: files.length });
          } else {
            const file = item.getAsFile();
            if (file) files.push(file);
          }
        } else {
          const file = item.getAsFile();
          if (file) files.push(file);
        }
      }
    }
    if (files.length > 0) {
      await uploadFiles(files);
    } else {
      setUploadProgress({ status: 'idle', fileCount: 0 });
    }
  }, [uploadFiles]);

  const { status, fileCount } = uploadProgress;
  const isActive = status !== 'idle';

  const progressText =
    status === 'reading'   ? `Reading folder… ${fileCount} files found` :
    status === 'uploading' ? `Uploading ${fileCount} files…` :
    status === 'analysing' ? `Analysing framework… detecting language and patterns` :
    status === 'done'      ? `Done — ${fileCount} files processed` : null;

  return (
    <div style={{ flex: 1, minWidth: 0, minHeight: 180 }}>
      <div
        onClick={() => !isActive && fileRef.current?.click()}
        onDragOver={e => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleFolderDrop}
        style={{
          border: dragging ? "0.5px dashed #185FA5" : "0.5px dashed #C0BDB8",
          borderRadius: 12,
          background: dragging ? "#E6F1FB" : "hsl(var(--muted) / 0.5)",
          minHeight: 180,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 10,
          cursor: isActive ? "default" : "pointer",
          transition: "border-color 0.15s, background 0.15s",
          padding: 16,
        }}
        onMouseEnter={e => { if (!dragging && !isActive) { (e.currentTarget as HTMLDivElement).style.borderColor = "hsl(var(--primary))"; (e.currentTarget as HTMLDivElement).style.background = "#E6F1FB"; } }}
        onMouseLeave={e => { if (!dragging) { (e.currentTarget as HTMLDivElement).style.borderColor = "hsl(var(--border))"; (e.currentTarget as HTMLDivElement).style.background = "hsl(var(--muted) / 0.5)"; } }}
      >
        <input
          ref={fileRef}
          type="file"
          multiple
          webkitdirectory
          accept=".ts,.tsx,.js,.jsx,.java,.py,.cs,.feature,.json,.xml,.gradle,.properties,.yml,.yaml,.zip"
          style={{ display: 'none' }}
          onChange={e => {
            if (!e.target.files) return;
            const filesWithPath = Array.from(e.target.files).map(f =>
              f.webkitRelativePath
                ? new File([f], f.webkitRelativePath, { type: f.type })
                : f
            );
            uploadFiles(filesWithPath);
          }}
        />
        {isActive ? (
          <>
            <Loader2 style={{ width: 28, height: 28, color: "hsl(var(--primary))" }} className="animate-spin" />
            <div style={{ fontSize: 12, color: "hsl(var(--primary))", textAlign: "center", lineHeight: 1.6 }}>{progressText}</div>
          </>
        ) : (
          <>
            <div style={{ width: 40, height: 40, borderRadius: "50%", border: "0.5px solid #C0BDB8", background: "hsl(var(--muted))", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, color: "hsl(var(--muted-foreground))", flexShrink: 0 }}>+</div>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 12, color: "hsl(var(--foreground))", fontWeight: 500, lineHeight: 1.5 }}>Drop your framework folder here</div>
              <div style={{ fontSize: 11, color: "hsl(var(--muted-foreground))", marginTop: 4, lineHeight: 1.5 }}>or click to browse files</div>
              <div style={{ fontSize: 11, color: "hsl(var(--muted-foreground))", lineHeight: 1.5 }}>Supports folders, ZIP files, and individual .ts .js .java .py .cs files</div>
              <div style={{ fontSize: 11, color: "hsl(var(--primary))", marginTop: 6 }}>Re-runs detection automatically</div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Section 4 — Hero Section
// ─────────────────────────────────────────────────────────────
interface HeroSectionProps { config: ConfigDetail; onRedetect: () => void; }

function HeroSection({ config, onRedetect }: HeroSectionProps) {
  const { toast } = useToast();
  const [redetecting, setRedetecting] = useState(false);
  const conf = computeConfidence(config);
  const detected = [config.detectedPattern, config.detectedLanguage, config.detectedTool].filter(Boolean).length;
  const hasDetection = detected > 0;

  const runRedetect = async () => {
    setRedetecting(true);
    try {
      const res = await fetch(`/api/framework-config/${config.id}/redetect`, { method: "POST" });
      if (!res.ok) { const b = await res.json().catch(() => ({ error: "Failed" })); throw new Error(b.error); }
      toast({ title: "Detection complete", description: "Stack re-detected from file content." });
      onRedetect();
    } catch (e: unknown) {
      toast({ title: "Detection failed", description: e instanceof Error ? e.message : "Unknown error", variant: "destructive" });
    } finally { setRedetecting(false); }
  };

  const detectionBg     = hasDetection ? "#E6F1FB" : "#FFFBE6";
  const detectionBorder = hasDetection ? "#85B7EB" : "#F0C05A";
  const detectionCircle = hasDetection ? "hsl(var(--primary))" : "#EF9F27";
  const detectionLine1  = hasDetection
    ? [config.detectedLanguage, config.detectedTool, config.detectedPattern].filter(Boolean).join(" · ")
    : "Stack not detected yet";
  const detectionLine2  = hasDetection
    ? "Detected from file content · high confidence"
    : "Upload files to detect automatically";
  const detectionTextColor  = hasDetection ? "#0C447C" : "#7A5000";
  const detectionText2Color = hasDetection ? "hsl(var(--primary))" : "#7A5000";

  return (
    <div style={{ padding: "20px 32px", borderBottom: "0.5px solid #E5E4E2" }}>
      {/* Title row */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, marginBottom: 20 }}>
        <div>
          <div style={{ fontSize: 22, fontWeight: 500, color: "hsl(var(--foreground))", lineHeight: 1.2 }}>{config.name}</div>
          <div style={{ fontSize: 13, color: "hsl(var(--muted-foreground))", marginTop: 4 }}>
            Last updated {relativeTime(config.updatedAt)} · {config.fileCount} {config.fileCount === 1 ? "file" : "files"} uploaded
          </div>
        </div>
        {/* Detection confirmation card */}
        <div style={{ background: detectionBg, border: `1px solid ${detectionBorder}`, borderRadius: 12, padding: "10px 16px", display: "flex", alignItems: "center", gap: 10, flexShrink: 0, maxWidth: 280 }}>
          <div style={{ width: 24, height: 24, borderRadius: "50%", background: detectionCircle, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            {hasDetection && (
              <div style={{ width: 10, height: 10, borderLeft: "2px solid white", borderBottom: "2px solid white", transform: "rotate(-45deg) translate(1px,-2px)" }} />
            )}
            {!hasDetection && (
              <span style={{ color: "white", fontSize: 12, fontWeight: 700 }}>!</span>
            )}
          </div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 500, color: detectionTextColor }}>{detectionLine1}</div>
            <div style={{ fontSize: 11, color: detectionText2Color, marginTop: 2 }}>{detectionLine2}</div>
            {!hasDetection && config.fileCount > 0 && (
              <button
                onClick={runRedetect}
                disabled={redetecting}
                style={{ fontSize: 11, color: "hsl(var(--primary))", background: "transparent", border: "0.5px solid #85B7EB", borderRadius: 6, padding: "3px 8px", cursor: "pointer", marginTop: 8, display: "flex", alignItems: "center", gap: 4, width: "fit-content" }}
              >
                {redetecting && <Loader2 style={{ width: 10, height: 10 }} className="animate-spin" />}
                Re-run detection
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Stats row */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10 }}>
        {[
          { value: String(config.functionCount), label: "Functions extracted" },
          { value: String(config.fileCount), label: "Files analysed" },
          { value: config.baseClass || "—", label: "Base class" },
          { value: conf.level, label: "Confidence", color: conf.color },
        ].map(s => (
          <div key={s.label} style={{ background: "hsl(var(--muted) / 0.5)", borderRadius: 8, padding: "12px 14px" }}>
            <div style={{ fontSize: s.value.length > 8 ? 14 : 20, fontWeight: 600, color: s.color ?? "hsl(var(--foreground))", fontFamily: s.value.length > 8 ? "inherit" : undefined }}>{s.value}</div>
            <div style={{ fontSize: 11, color: "hsl(var(--muted-foreground))", marginTop: 3 }}>{s.label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Section 7 — Bottom Action Bar
// ─────────────────────────────────────────────────────────────
interface ActionBarProps { configId: string; configName?: string; configFramework?: string; configLanguage?: string; configPattern?: string; onDelete: () => void; onEdit: () => void; }

function ActionBar({ configId, configName, configFramework, configLanguage, configPattern, onDelete, onEdit }: ActionBarProps) {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const qc = useQueryClient();
  const deleteMut = useMutation({
    mutationFn: () => apiFetch(`/api/framework-config/${configId}`, { method: "DELETE" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["framework-configs"] }); toast({ title: "Deleted" }); onDelete(); },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const handleGenerateScripts = () => {
    const params = new URLSearchParams({ frameworkConfigId: configId });
    if (configName)     params.set('frameworkName', configName);
    if (configFramework) params.set('frameworkTool', configFramework);
    if (configLanguage) params.set('frameworkLang', configLanguage);
    if (configPattern)  params.set('frameworkPattern', configPattern);
    navigate(`/functional-testing?${params.toString()}`);
  };

  return (
    <div style={{ borderTop: "0.5px solid #E5E4E2", padding: "16px 32px", display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0, background: "hsl(var(--card))" }}>
      <button
        onClick={handleGenerateScripts}
        style={{ background: "hsl(var(--primary))", color: "white", border: "none", borderRadius: 8, padding: "9px 20px", fontSize: 13, fontWeight: 500, cursor: "pointer", letterSpacing: "0.01em", display: "flex", alignItems: "center", gap: 8 }}
      >
        <span>⚡</span> Generate scripts using this framework →
      </button>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Button size="sm" variant="outline" onClick={onEdit}>
          <Edit2 className="w-3.5 h-3.5 mr-1.5" /> Edit
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="text-destructive border-destructive/30 hover:bg-destructive/10"
          onClick={() => deleteMut.mutate()}
          disabled={deleteMut.isPending}
        >
          {deleteMut.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5 mr-1.5" />}
          Delete
        </Button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Section 8 — Empty State
// ─────────────────────────────────────────────────────────────
interface EmptyStateProps { configId?: string; configName?: string; onCreateOpen: () => void; }

function EmptyState({ configId, configName, onCreateOpen }: EmptyStateProps) {
  const { toast } = useToast();
  const [dragging, setDragging] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<UploadProgress>({ status: 'idle', fileCount: 0 });
  const fileRef = useRef<HTMLInputElement>(null);
  const qc = useQueryClient();

  const uploadFiles = useCallback(async (files: File[]) => {
    if (!configId || files.length === 0) return;
    const fd = new FormData();
    files.forEach(f => fd.append("files", f));
    setUploadProgress({ status: 'uploading', fileCount: files.length });
    try {
      const res = await fetch(`/api/framework-config/${configId}/upload-files`, { method: "POST", body: fd });
      if (!res.ok) { const b = await res.json().catch(() => ({ error: "Upload failed" })); throw new Error(b.error); }
      setUploadProgress({ status: 'analysing', fileCount: files.length });
      const result = await res.json();
      const s = result.summary;
      const processed = s?.totalProcessed ?? result.files?.length ?? files.length;
      setUploadProgress({ status: 'done', fileCount: processed });
      const fnsFound = s?.functionsFound ?? result.newFunctionsAdded ?? 0;
      const detectedStack = [s?.detectedLanguage, s?.detectedTool, s?.detectedPattern].filter(Boolean).join(' + ');
      const skipped = s?.totalSkipped ?? 0;
      if (fnsFound > 0) {
        toast({
          title: `✓ ${fnsFound} function${fnsFound > 1 ? 's' : ''} extracted`,
          description: `${processed} file${processed > 1 ? 's' : ''} processed${detectedStack ? ` · ${detectedStack}` : ''}${skipped > 0 ? ` · ${skipped} skipped` : ''}`,
        });
      } else if (detectedStack) {
        toast({
          title: "Framework detected — no functions found",
          description: `Stack: ${detectedStack} · ${processed} file${processed > 1 ? 's' : ''} processed. Try uploading source files (.ts, .js, .java, .py) rather than config files.`,
          variant: "default",
        });
      } else {
        toast({
          title: "Files uploaded",
          description: `${processed} file${processed > 1 ? 's' : ''} stored. Stack detection failed — check that source files were included.`,
          variant: "destructive",
        });
      }
      qc.invalidateQueries({ queryKey: ["framework-config", configId] });
      setTimeout(() => setUploadProgress({ status: 'idle', fileCount: 0 }), 3000);
    } catch (e: unknown) {
      toast({ title: "Upload error", description: e instanceof Error ? e.message : "Unknown error", variant: "destructive" });
      setUploadProgress({ status: 'idle', fileCount: 0 });
    }
  }, [configId, qc, toast]);

  const handleFolderDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    if (!configId) return;
    const items = Array.from(e.dataTransfer.items);
    const files: File[] = [];
    setUploadProgress({ status: 'reading', fileCount: 0 });
    for (const item of items) {
      if (item.kind === 'file') {
        const entry = item.webkitGetAsEntry?.();
        if (entry) {
          if (entry.isDirectory) {
            const folderFiles = await readDirectory(entry as FileSystemDirectoryEntry);
            files.push(...folderFiles);
            setUploadProgress({ status: 'reading', fileCount: files.length });
          } else {
            const file = item.getAsFile();
            if (file) files.push(file);
          }
        } else {
          const file = item.getAsFile();
          if (file) files.push(file);
        }
      }
    }
    if (files.length > 0) {
      await uploadFiles(files);
    } else {
      setUploadProgress({ status: 'idle', fileCount: 0 });
    }
  }, [configId, uploadFiles]);

  const { status: upStatus, fileCount: upCount } = uploadProgress;
  const isActive = upStatus !== 'idle';
  const progressText =
    upStatus === 'reading'   ? `Reading folder… ${upCount} files found` :
    upStatus === 'uploading' ? `Uploading ${upCount} files…` :
    upStatus === 'analysing' ? `Analysing framework… detecting language and patterns` :
    upStatus === 'done'      ? `Done — ${upCount} files processed` : null;

  const title = configName ? `${configName} has no files yet` : "Select a framework to get started";

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 20, padding: "40px 32px", textAlign: "center", height: "100%", minWidth: 0, overflow: "hidden" }}>
      <div style={{ width: 56, height: 56, borderRadius: "50%", border: "0.5px solid #E5E4E2", background: "hsl(var(--muted))", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22, color: "hsl(var(--muted-foreground))" }}>+</div>
      <div>
        <div style={{ fontSize: 16, fontWeight: 500, color: "hsl(var(--foreground))", marginBottom: 8 }}>{title}</div>
        <div style={{ fontSize: 13, color: "hsl(var(--muted-foreground))", maxWidth: 320, lineHeight: 1.6 }}>
          Drop your entire project folder and NAT will detect your language, tool, and pattern automatically — then generate scripts that match your exact coding style.
        </div>
      </div>

      {configId && (
        <div
          onClick={() => !isActive && fileRef.current?.click()}
          onDragOver={e => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleFolderDrop}
          style={{ width: "100%", maxWidth: 360, border: dragging ? "0.5px dashed #185FA5" : "0.5px dashed #C0BDB8", borderRadius: 12, background: dragging ? "#E6F1FB" : "hsl(var(--muted) / 0.5)", padding: "28px 16px", display: "flex", flexDirection: "column", alignItems: "center", gap: 8, cursor: isActive ? "default" : "pointer", transition: "border-color 0.15s, background 0.15s" }}
        >
          <input
            ref={fileRef}
            type="file"
            multiple
            webkitdirectory
            accept=".ts,.tsx,.js,.jsx,.java,.py,.cs,.feature,.json,.xml,.gradle,.properties,.yml,.yaml,.zip"
            style={{ display: 'none' }}
            onChange={e => {
              if (!e.target.files) return;
              const filesWithPath = Array.from(e.target.files).map(f =>
                f.webkitRelativePath
                  ? new File([f], f.webkitRelativePath, { type: f.type })
                  : f
              );
              uploadFiles(filesWithPath);
            }}
          />
          {isActive ? (
            <>
              <Loader2 style={{ width: 24, height: 24, color: "hsl(var(--primary))" }} className="animate-spin" />
              <span style={{ fontSize: 12, color: "hsl(var(--primary))", lineHeight: 1.6 }}>{progressText}</span>
            </>
          ) : (
            <>
              <span style={{ fontSize: 12, color: "hsl(var(--foreground))", fontWeight: 500 }}>Drop your framework folder here</span>
              <span style={{ fontSize: 11, color: "hsl(var(--muted-foreground))" }}>or click to browse files</span>
            </>
          )}
          <span style={{ fontSize: 11, color: "hsl(var(--primary))" }}>Folders · ZIP files · .ts .js .java .py .cs</span>
        </div>
      )}

      {!configId && (
        <Button variant="outline" onClick={onCreateOpen}>
          <Plus className="w-4 h-4 mr-1.5" /> Create New Framework
        </Button>
      )}

      <div style={{ fontSize: 12, color: "hsl(var(--muted-foreground))" }}>
        Or download a{" "}
        <span style={{ color: "hsl(var(--primary))", cursor: "pointer" }}
          onClick={() => { /* sidebar scroll handled via layout */ }}>
          sample framework
        </span>
        {" "}to get started instantly
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Config Detail Panel
// ─────────────────────────────────────────────────────────────
interface ConfigDetailPanelProps { configId: string; onDelete: () => void; }

function ConfigDetailPanel({ configId, onDelete }: ConfigDetailPanelProps) {
  const { toast } = useToast();
  const [editOpen, setEditOpen] = useState(false);
  const qc = useQueryClient();

  const { data: config, isLoading, isError, error, refetch } = useQuery<ConfigDetail>({
    queryKey: ["framework-config", configId],
    queryFn: () => apiFetch(`/api/framework-config/${configId}`),
  });

  // Edit dialog — reuses CreateConfigDialog pattern
  const updateMut = useMutation({
    mutationFn: (body: Partial<FrameworkConfig>) =>
      apiFetch(`/api/framework-config/${configId}`, { method: "PUT", body: JSON.stringify(body) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["framework-config", configId] }); qc.invalidateQueries({ queryKey: ["framework-configs"] }); toast({ title: "Updated" }); setEditOpen(false); refetch(); },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });
  void updateMut;

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="w-7 h-7 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (isError || !config) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3">
        <AlertCircle className="w-7 h-7 text-destructive" />
        <p className="text-sm text-muted-foreground">{(error as Error)?.message ?? "Failed to load"}</p>
        <Button size="sm" variant="outline" onClick={() => refetch()}><RefreshCw className="w-4 h-4 mr-1" />Retry</Button>
      </div>
    );
  }

  const hasFiles = config.fileCount > 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden", minWidth: 0, animation: "fwFadeIn 0.2s ease-out" }}>
      {hasFiles ? (
        <>
          {/* Hero */}
          <div style={{ flex: 1, overflowY: "auto", minHeight: 0 }}>
            <HeroSection config={config} onRedetect={refetch} />
            <TransformationStrip config={config} />
            <FileBreakdownPanel config={config} onRefresh={refetch} />
            {/* Content panels */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, padding: "20px 32px" }}>
              <FunctionPanel config={config} onRefresh={refetch} />
              <DropZonePanel configId={config.id} onRefresh={refetch} />
            </div>
          </div>
        </>
      ) : (
        <EmptyState configId={config.id} configName={config.name} onCreateOpen={() => {}} />
      )}

      {/* Bottom action bar */}
      <ActionBar
        configId={config.id}
        configName={config.name}
        configFramework={config.detectedTool ?? config.framework}
        configLanguage={config.detectedLanguage ?? config.language}
        configPattern={config.detectedPattern ?? 'POM'}
        onDelete={onDelete}
        onEdit={() => setEditOpen(true)}
      />

      {/* Edit dialog — minimal inline */}
      <Dialog open={editOpen} onOpenChange={v => { if (!v) setEditOpen(false); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Edit · {config.name}</DialogTitle></DialogHeader>
          <div className="py-2 text-sm text-muted-foreground">
            Use the Create dialog to make a new configuration.<br />
            To rename or change settings, delete and recreate.
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Main Page
// ─────────────────────────────────────────────────────────────
export default function FrameworkConfigPage() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const { data: configs, isLoading, isError, error, refetch } = useQuery<FrameworkConfig[]>({
    queryKey: ["framework-configs"],
    queryFn: () => apiFetch("/api/framework-config"),
  });

  // Auto-trigger re-detection for configs that have files but no detected values
  useEffect(() => {
    if (!configs) return;
    const needsDetection = configs.filter(c => c.fileCount > 0 && !c.detectedLanguage);
    if (needsDetection.length === 0) return;
    let ran = false;
    (async () => {
      for (const cfg of needsDetection) {
        try {
          await fetch(`/api/framework-config/${cfg.id}/redetect`, { method: "POST" });
          ran = true;
        } catch { /* silent — detection is best-effort on load */ }
      }
      if (ran) refetch();
    })();
  }, [configs, refetch]);

  // Auto-select first framework that has actual content; fall back to configs[0]
  useEffect(() => {
    if (!configs || configs.length === 0) return;
    if (selectedId) return; // already have a selection — don't override
    const firstWithFiles = configs.find(c =>
      (c.fileCount ?? 0) > 0 ||
      (c.functionCount ?? 0) > 0
    );
    const defaultSelection = firstWithFiles ?? configs[0];
    setSelectedId(defaultSelection?.id ?? null);
  }, [configs]); // intentionally omit selectedId — only run when configs first loads

  return (
    <>
      <GlobalAnimations />
      <div style={{ display: "flex", flexDirection: "column", height: "100vh", background: "hsl(var(--background))" }}>

        <DashboardHeader />

        {/* ── Page Title Bar ── */}
        <div style={{ flexShrink: 0, padding: "0 24px", height: 52, display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "0.5px solid #E5E4E2", background: "hsl(var(--card))" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 0 }}>
            <Link href="/dashboard">
              <a style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "hsl(var(--muted-foreground))", textDecoration: "none", paddingRight: 16 }}>
                <ArrowLeft style={{ width: 14, height: 14 }} />
                Dashboard
              </a>
            </Link>
            <div style={{ width: 1, height: 20, background: "hsl(var(--border))", marginRight: 16 }} />
            <div>
              <div style={{ fontSize: 16, fontWeight: 500, color: "hsl(var(--foreground))", lineHeight: 1.1 }}>Framework catalog</div>
              <div style={{ fontSize: 12, color: "hsl(var(--muted-foreground))", lineHeight: 1 }}>Teach NAT your language — it generates in yours</div>
            </div>
          </div>
          <button
            onClick={() => setCreateOpen(true)}
            style={{ background: "hsl(var(--primary))", color: "white", border: "none", borderRadius: 7, padding: "6px 14px", fontSize: 12, fontWeight: 500, cursor: "pointer" }}
          >
            + New framework
          </button>
        </div>

        {/* ── Body ── */}
        <div style={{ display: "grid", gridTemplateColumns: "280px minmax(0, 1fr)", height: "calc(100vh - 52px)", overflow: "hidden" }}>

          {/* Left Sidebar */}
          <div style={{ width: "280px", minWidth: "280px", maxWidth: "280px", flexShrink: 0, borderRight: "0.5px solid #E5E4E2", background: "hsl(var(--card))", display: "flex", flexDirection: "column", overflowX: "hidden", overflowY: "hidden" }}>
            <div style={{ flex: 1, overflowY: "auto", overflowX: "hidden", minHeight: 0, width: "100%" }}>
              <div style={{ padding: "12px 12px 0", width: "100%", boxSizing: "border-box" }}>
                {isLoading ? (
                  <div className="flex justify-center py-10"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
                ) : isError ? (
                  <div className="flex flex-col items-center gap-2 py-10 px-4 text-center">
                    <AlertCircle className="w-5 h-5 text-destructive" />
                    <p className="text-xs text-muted-foreground">{(error as Error)?.message}</p>
                    <Button size="sm" variant="outline" onClick={() => refetch()}>Retry</Button>
                  </div>
                ) : !configs || configs.length === 0 ? (
                  <div className="flex flex-col items-center gap-3 py-12 px-4 text-center">
                    <Code2 className="w-8 h-8 text-muted-foreground/40" />
                    <p className="text-xs text-muted-foreground">No frameworks yet.</p>
                    <Button size="sm" onClick={() => setCreateOpen(true)}><Plus className="w-3.5 h-3.5 mr-1" />Add first</Button>
                  </div>
                ) : (
                  configs.map(cfg => (
                    <SidebarCard
                      key={cfg.id}
                      cfg={cfg}
                      active={selectedId === cfg.id}
                      onClick={() => setSelectedId(cfg.id)}
                    />
                  ))
                )}
              </div>
            </div>

            {/* Sample frameworks at bottom */}
            <SampleSidebarSection />
          </div>

          {/* Right Panel */}
          {selectedId ? (
            <ConfigDetailPanel
              key={selectedId}
              configId={selectedId}
              onDelete={() => setSelectedId(null)}
            />
          ) : (
            <EmptyState onCreateOpen={() => setCreateOpen(true)} />
          )}
        </div>

        {/* Create Dialog */}
        <CreateConfigDialog
          open={createOpen}
          onClose={() => setCreateOpen(false)}
          onCreated={(id) => { setCreateOpen(false); if (id) setSelectedId(id); }}
        />
      </div>
    </>
  );
}
