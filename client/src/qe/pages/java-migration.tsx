import { useState, useEffect, useRef, useCallback } from "react";
import { DashboardHeader } from "@/components/dashboard/header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { parseQeApiJson, qeApiFetch } from "@/lib/qe-api-fetch";
import { Link } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowLeft,
  Upload,
  FileArchive,
  Scan,
  Brain,
  Cpu,
  Shield,
  Package,
  Download,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Loader2,
  FileCode,
  FileText,
  FolderTree,
  Sparkles,
  Zap,
  Play,
  ChevronRight,
  Clock,
  Code2,
  ArrowRight,
  BarChart3,
  Layers,
  Settings,
  Coffee,
  GitBranch,
  RefreshCw,
  Eye,
  Copy,
  Check,
  File,
  Folder,
} from "lucide-react";

// ─── Types ───────────────────────────────────────────────────────────────────

interface MigrationEvent {
  agent: string;
  status: "idle" | "thinking" | "working" | "completed" | "error";
  message: string;
  details?: string;
  progress?: number;
  data?: any;
}

interface FileClassification {
  path: string;
  name: string;
  type: string;
  lines: number;
  size: number;
}

interface ConvertedFile {
  originalPath: string;
  convertedPath: string;
  originalCode: string;
  convertedCode: string;
  type: string;
  stats: {
    locatorsConverted: number;
    actionsConverted: number;
    waitsRemoved: number;
    assertionsConverted: number;
  };
}

interface MigrationStats {
  totalFiles: number;
  convertedFiles: number;
  totalLines: number;
  convertedLines: number;
  locatorsConverted: number;
  actionsConverted: number;
  waitsRemoved: number;
  assertionsConverted: number;
  conversionRate: number;
  timeTaken: number;
}

// ─── Agent Definitions ───────────────────────────────────────────────────────

const AGENTS = [
  {
    id: "scanner",
    name: "Scanner",
    icon: Scan,
    color: "violet",
    gradient: "from-violet-500 to-purple-600",
    bgGlow: "shadow-violet-500/20",
    description: "Unpacks & inventories all source files",
    skills: ["ZIP extraction", "File tree building", "Size analysis", "Encoding detection"],
  },
  {
    id: "classifier",
    name: "Classifier",
    icon: Brain,
    color: "blue",
    gradient: "from-blue-500 to-cyan-500",
    bgGlow: "shadow-blue-500/20",
    description: "Identifies file types & framework patterns",
    skills: ["Page Object detection", "Step Definition parsing", "Gherkin recognition", "Pattern matching"],
  },
  {
    id: "architect",
    name: "Architect",
    icon: Layers,
    color: "amber",
    gradient: "from-amber-500 to-orange-500",
    bgGlow: "shadow-amber-500/20",
    description: "Analyzes patterns & designs migration plan",
    skills: ["Framework analysis", "Dependency mapping", "Strategy design", "Risk assessment"],
  },
  {
    id: "converter",
    name: "Converter",
    icon: Cpu,
    color: "emerald",
    gradient: "from-emerald-500 to-green-500",
    bgGlow: "shadow-emerald-500/20",
    description: "Transforms Java → TypeScript / Playwright",
    skills: ["Locator mapping", "API translation", "Type conversion", "Import rewriting"],
  },
  {
    id: "validator",
    name: "Validator",
    icon: Shield,
    color: "rose",
    gradient: "from-rose-500 to-pink-500",
    bgGlow: "shadow-rose-500/20",
    description: "Checks converted code for correctness",
    skills: ["Syntax validation", "Import verification", "Pattern compliance", "Quality scoring"],
  },
  {
    id: "packager",
    name: "Packager",
    icon: Package,
    color: "cyan",
    gradient: "from-cyan-500 to-teal-500",
    bgGlow: "shadow-cyan-500/20",
    description: "Assembles final Playwright project & ZIP",
    skills: ["Project scaffolding", "Config generation", "Dependency setup", "ZIP packaging"],
  },
];

const CLASSIFICATION_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  pageObject: { bg: "bg-emerald-500/15", text: "text-emerald-400", border: "border-emerald-500/30" },
  stepDefinition: { bg: "bg-blue-500/15", text: "text-blue-400", border: "border-blue-500/30" },
  featureFile: { bg: "bg-orange-500/15", text: "text-orange-400", border: "border-orange-500/30" },
  hookFile: { bg: "bg-purple-500/15", text: "text-purple-400", border: "border-purple-500/30" },
  testRunner: { bg: "bg-rose-500/15", text: "text-rose-400", border: "border-rose-500/30" },
  baseClass: { bg: "bg-amber-500/15", text: "text-amber-400", border: "border-amber-500/30" },
  utility: { bg: "bg-cyan-500/15", text: "text-cyan-400", border: "border-cyan-500/30" },
  config: { bg: "bg-slate-500/15", text: "text-slate-400", border: "border-slate-500/30" },
  testData: { bg: "bg-pink-500/15", text: "text-pink-400", border: "border-pink-500/30" },
  pom: { bg: "bg-red-500/15", text: "text-red-400", border: "border-red-500/30" },
  unknown: { bg: "bg-gray-500/15", text: "text-gray-400", border: "border-gray-500/30" },
};

// ─── Agent Card Component ────────────────────────────────────────────────────

function AgentCard({
  agent,
  status,
  message,
  progress,
  index,
  isActive,
}: {
  agent: typeof AGENTS[0];
  status: "idle" | "thinking" | "working" | "completed" | "error";
  message: string;
  progress: number;
  index: number;
  isActive: boolean;
}) {
  const Icon = agent.icon;
  const statusColors = {
    idle: "border-muted/30 opacity-50",
    thinking: "border-amber-500/50 shadow-lg shadow-amber-500/10",
    working: `border-${agent.color}-500/50 shadow-lg ${agent.bgGlow}`,
    completed: "border-emerald-500/50 shadow-lg shadow-emerald-500/10",
    error: "border-red-500/50 shadow-lg shadow-red-500/10",
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ delay: index * 0.08, duration: 0.4, ease: "easeOut" }}
    >
      <div
        className={`relative rounded-xl border backdrop-blur-sm transition-all duration-500 ${statusColors[status]} ${
          isActive ? "bg-card/80" : "bg-card/40"
        }`}
      >
        {/* Animated glow ring for active agent */}
        {(status === "thinking" || status === "working") && (
          <motion.div
            className={`absolute inset-0 rounded-xl bg-gradient-to-r ${agent.gradient} opacity-10`}
            animate={{ opacity: [0.05, 0.15, 0.05] }}
            transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
          />
        )}

        <div className="relative p-4 space-y-3">
          {/* Header */}
          <div className="flex items-center gap-3">
            <div
              className={`relative w-10 h-10 rounded-lg bg-gradient-to-br ${agent.gradient} flex items-center justify-center shadow-lg`}
            >
              <Icon className="w-5 h-5 text-white" />
              {/* Pulse ring */}
              {status === "working" && (
                <motion.div
                  className={`absolute inset-0 rounded-lg bg-gradient-to-br ${agent.gradient}`}
                  animate={{ scale: [1, 1.4, 1], opacity: [0.4, 0, 0.4] }}
                  transition={{ duration: 1.5, repeat: Infinity }}
                />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-sm">{agent.name}</span>
                <AgentStatusBadge status={status} />
              </div>
              <p className="text-xs text-muted-foreground truncate">{agent.description}</p>
            </div>
          </div>

          {/* Message */}
          <AnimatePresence mode="wait">
            {message && (
              <motion.div
                key={message}
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                className="text-xs text-muted-foreground bg-muted/30 rounded-lg px-3 py-2 font-mono"
              >
                {status === "working" && (
                  <motion.span
                    className="inline-block w-1.5 h-1.5 rounded-full bg-current mr-2"
                    animate={{ opacity: [1, 0.3, 1] }}
                    transition={{ duration: 0.8, repeat: Infinity }}
                  />
                )}
                {message}
              </motion.div>
            )}
          </AnimatePresence>

          {/* Progress bar */}
          {(status === "working" || status === "completed") && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
              <div className="flex items-center justify-between text-xs mb-1">
                <span className="text-muted-foreground">Progress</span>
                <span className={`font-mono font-bold ${status === "completed" ? "text-emerald-400" : `text-${agent.color}-400`}`}>
                  {Math.round(progress)}%
                </span>
              </div>
              <div className="h-1.5 rounded-full bg-muted/50 overflow-hidden">
                <motion.div
                  className={`h-full rounded-full bg-gradient-to-r ${agent.gradient}`}
                  initial={{ width: 0 }}
                  animate={{ width: `${progress}%` }}
                  transition={{ duration: 0.5, ease: "easeOut" }}
                />
              </div>
            </motion.div>
          )}
        </div>
      </div>
    </motion.div>
  );
}

function AgentStatusBadge({ status }: { status: string }) {
  const config = {
    idle: { label: "Idle", className: "bg-muted/50 text-muted-foreground" },
    thinking: { label: "Thinking", className: "bg-amber-500/20 text-amber-400 border-amber-500/30" },
    working: { label: "Working", className: "bg-blue-500/20 text-blue-400 border-blue-500/30" },
    completed: { label: "Done", className: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30" },
    error: { label: "Error", className: "bg-red-500/20 text-red-400 border-red-500/30" },
  }[status] || { label: status, className: "bg-muted/50 text-muted-foreground" };

  return (
    <Badge variant="outline" className={`text-[10px] px-1.5 py-0 h-4 ${config.className}`}>
      {status === "working" && (
        <Loader2 className="w-2.5 h-2.5 mr-1 animate-spin" />
      )}
      {status === "completed" && <CheckCircle2 className="w-2.5 h-2.5 mr-1" />}
      {config.label}
    </Badge>
  );
}

// ─── Connection Line Between Agents ──────────────────────────────────────────

function AgentConnector({ fromStatus, toStatus }: { fromStatus: string; toStatus: string }) {
  const isActive = fromStatus === "completed" && (toStatus === "thinking" || toStatus === "working");
  const isDone = fromStatus === "completed" && toStatus === "completed";
  return (
    <div className="flex items-center justify-center py-1">
      <motion.div
        className={`w-0.5 h-6 rounded-full transition-all duration-500 ${
          isDone
            ? "bg-emerald-500/60"
            : isActive
            ? "bg-blue-500/60"
            : "bg-muted/20"
        }`}
        animate={isActive ? { opacity: [0.4, 1, 0.4] } : {}}
        transition={{ duration: 1, repeat: Infinity }}
      />
    </div>
  );
}

// ─── Upload Zone ─────────────────────────────────────────────────────────────

function UploadZone({
  onFileSelect,
  onDemoMode,
  isProcessing,
}: {
  onFileSelect: (file: File) => void;
  onDemoMode: () => void;
  isProcessing: boolean;
}) {
  const { toast } = useToast();
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragOver(false);
      const file = e.dataTransfer.files[0];
      if (file && (file.name.endsWith(".zip") || file.name.endsWith(".jar"))) {
        onFileSelect(file);
      }
    },
    [onFileSelect]
  );

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
    >
      <Card className="border-dashed border-2 overflow-hidden relative">
        {/* Animated gradient background */}
        <div className="absolute inset-0 bg-gradient-to-br from-violet-500/5 via-transparent to-cyan-500/5" />
        <motion.div
          className="absolute inset-0 bg-gradient-to-r from-blue-500/10 via-purple-500/10 to-pink-500/10"
          animate={{ backgroundPosition: ["0% 50%", "100% 50%", "0% 50%"] }}
          transition={{ duration: 8, repeat: Infinity, ease: "linear" }}
          style={{ backgroundSize: "200% 200%" }}
        />

        <CardContent className="relative p-12">
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setIsDragOver(true);
            }}
            onDragLeave={() => setIsDragOver(false)}
            onDrop={handleDrop}
            className={`flex flex-col items-center justify-center text-center space-y-6 transition-all duration-300 ${
              isDragOver ? "scale-105" : ""
            }`}
          >
            <motion.div
              className="relative"
              animate={isDragOver ? { scale: 1.1, y: -10 } : { scale: 1, y: 0 }}
            >
              <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-primary/20 to-primary/10 flex items-center justify-center">
                <FileArchive className="w-10 h-10 text-primary" />
              </div>
              {isDragOver && (
                <motion.div
                  className="absolute inset-0 rounded-2xl border-2 border-violet-400"
                  animate={{ scale: [1, 1.2, 1], opacity: [0.6, 0, 0.6] }}
                  transition={{ duration: 1, repeat: Infinity }}
                />
              )}
            </motion.div>

            <div className="space-y-2">
              <h3 className="text-xl font-bold">Upload Java+Selenium+BDD Framework</h3>
              <p className="text-sm text-muted-foreground max-w-md">
                Drop your project ZIP file here — our AI agents will scan, classify, convert, and package
                your entire framework into Playwright + TypeScript
              </p>
            </div>

            <div className="flex items-center gap-4">
              <Button
                size="lg"
                onClick={() => fileInputRef.current?.click()}
                disabled={isProcessing}
                className="bg-gradient-to-r from-primary to-primary/80 hover:from-primary/90 hover:to-primary/70 text-primary-foreground shadow-lg shadow-primary/25"
              >
                <Upload className="w-5 h-5 mr-2" />
                Browse ZIP File
              </Button>

              <span className="text-sm text-muted-foreground">or</span>

              <Button
                size="lg"
                variant="outline"
                onClick={onDemoMode}
                disabled={isProcessing}
                className="border-cyan-500/30 hover:bg-cyan-500/10 hover:border-cyan-500/50"
              >
                <Sparkles className="w-5 h-5 mr-2 text-cyan-400" />
                Run Demo Framework
              </Button>
            </div>

            <p className="text-xs text-muted-foreground">
              Supports: .zip containing Java+Maven+Cucumber projects • .jar files • Individual .java files
            </p>

            <input
              ref={fileInputRef}
              type="file"
              accept=".zip,.jar"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) onFileSelect(file);
              }}
            />
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}

// ─── Classification Tree View ────────────────────────────────────────────────

function ClassificationPanel({ files }: { files: FileClassification[] }) {
  const grouped = files.reduce<Record<string, FileClassification[]>>((acc, f) => {
    acc[f.type] = acc[f.type] || [];
    acc[f.type].push(f);
    return acc;
  }, {});

  const total = files.length;
  const typeStats = Object.entries(grouped).map(([type, items]) => ({
    type,
    count: items.length,
    percentage: Math.round((items.length / total) * 100),
  }));

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
    >
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <FolderTree className="w-5 h-5 text-blue-400" />
            Framework Classification
            <Badge variant="outline" className="ml-auto text-xs">
              {total} files
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Category cards */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
            {typeStats.map(({ type, count, percentage }) => {
              const colors = CLASSIFICATION_COLORS[type] || CLASSIFICATION_COLORS.unknown;
              return (
                <motion.div
                  key={type}
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className={`rounded-lg border ${colors.border} ${colors.bg} p-3 text-center`}
                >
                  <p className={`text-2xl font-bold ${colors.text}`}>{count}</p>
                  <p className="text-xs text-muted-foreground capitalize mt-1">
                    {type.replace(/([A-Z])/g, " $1").trim()}
                  </p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">{percentage}%</p>
                </motion.div>
              );
            })}
          </div>

          {/* File tree */}
          <ScrollArea className="h-48">
            <div className="space-y-1">
              {Object.entries(grouped).map(([type, items]) => {
                const colors = CLASSIFICATION_COLORS[type] || CLASSIFICATION_COLORS.unknown;
                return (
                  <div key={type}>
                    <div className={`flex items-center gap-2 px-2 py-1 rounded ${colors.bg}`}>
                      <Folder className={`w-3.5 h-3.5 ${colors.text}`} />
                      <span className={`text-xs font-semibold ${colors.text} capitalize`}>
                        {type.replace(/([A-Z])/g, " $1").trim()}
                      </span>
                      <Badge variant="outline" className={`ml-auto text-[10px] ${colors.border} ${colors.text}`}>
                        {items.length}
                      </Badge>
                    </div>
                    {items.map((f, i) => (
                      <div key={i} className="flex items-center gap-2 pl-8 pr-2 py-0.5 text-xs text-muted-foreground hover:bg-muted/20 rounded">
                        <File className="w-3 h-3 flex-shrink-0" />
                        <span className="truncate flex-1 font-mono">{f.name}</span>
                        <span className="text-[10px] tabular-nums">{f.lines} lines</span>
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>
    </motion.div>
  );
}

// ─── Code Comparison Panel ───────────────────────────────────────────────────

function CodeComparisonPanel({ files }: { files: ConvertedFile[] }) {
  const [selectedFile, setSelectedFile] = useState(0);
  const [copiedCode, setCopiedCode] = useState(false);
  const current = files[selectedFile];

  const copyCode = async () => {
    if (!current) return;
    await navigator.clipboard.writeText(current.convertedCode);
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 2000);
  };

  if (!files.length) return null;

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <Code2 className="w-5 h-5 text-emerald-400" />
              Code Transformation
            </CardTitle>
            <div className="flex items-center gap-2">
              <select
                value={selectedFile}
                onChange={(e) => setSelectedFile(Number(e.target.value))}
                className="text-xs bg-muted/30 border border-border rounded-md px-2 py-1"
              >
                {files.map((f, i) => (
                  <option key={i} value={i}>
                    {f.originalPath.split("/").pop()}
                  </option>
                ))}
              </select>
              <Button variant="outline" size="sm" onClick={copyCode}>
                {copiedCode ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {current && (
            <>
              {/* Stats row */}
              <div className="flex gap-3 mb-3">
                {[
                  { label: "Locators", count: current.stats.locatorsConverted, color: "text-blue-400" },
                  { label: "Actions", count: current.stats.actionsConverted, color: "text-purple-400" },
                  { label: "Waits Removed", count: current.stats.waitsRemoved, color: "text-amber-400" },
                  { label: "Assertions", count: current.stats.assertionsConverted, color: "text-emerald-400" },
                ].map((s) => (
                  <div key={s.label} className="flex items-center gap-1.5 text-xs">
                    <span className={`font-bold ${s.color}`}>{s.count}</span>
                    <span className="text-muted-foreground">{s.label}</span>
                  </div>
                ))}
              </div>

              {/* Side by side code */}
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-lg overflow-hidden border border-red-500/20">
                  <div className="bg-red-500/10 px-3 py-1.5 flex items-center gap-2 border-b border-red-500/20">
                    <Coffee className="w-3.5 h-3.5 text-red-400" />
                    <span className="text-xs font-semibold text-red-400">Java + Selenium</span>
                  </div>
                  <ScrollArea className="h-64">
                    <pre className="text-[11px] font-mono p-3 text-muted-foreground leading-relaxed whitespace-pre-wrap">
                      {current.originalCode}
                    </pre>
                  </ScrollArea>
                </div>
                <div className="rounded-lg overflow-hidden border border-emerald-500/20">
                  <div className="bg-emerald-500/10 px-3 py-1.5 flex items-center gap-2 border-b border-emerald-500/20">
                    <Zap className="w-3.5 h-3.5 text-emerald-400" />
                    <span className="text-xs font-semibold text-emerald-400">TypeScript + Playwright</span>
                  </div>
                  <ScrollArea className="h-64">
                    <pre className="text-[11px] font-mono p-3 text-muted-foreground leading-relaxed whitespace-pre-wrap">
                      {current.convertedCode}
                    </pre>
                  </ScrollArea>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </motion.div>
  );
}

// ─── Final Stats Panel ───────────────────────────────────────────────────────

function FinalStatsPanel({ stats, onDownload, isDownloading }: { stats: MigrationStats; onDownload: () => void; isDownloading: boolean }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.6 }}
    >
      <Card className="border-emerald-500/30 overflow-hidden relative">
        {/* Celebration background */}
        <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/5 via-transparent to-cyan-500/5" />
        <motion.div
          className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-emerald-500 via-cyan-500 to-blue-500"
          initial={{ scaleX: 0, transformOrigin: "left" }}
          animate={{ scaleX: 1 }}
          transition={{ duration: 1, delay: 0.3 }}
        />

        <CardContent className="relative p-8">
          <div className="flex items-center gap-4 mb-8">
            <motion.div
              initial={{ scale: 0, rotate: -180 }}
              animate={{ scale: 1, rotate: 0 }}
              transition={{ type: "spring", stiffness: 200, damping: 15 }}
              className="w-14 h-14 rounded-2xl bg-gradient-to-br from-emerald-500 to-cyan-500 flex items-center justify-center shadow-lg shadow-emerald-500/30"
            >
              <CheckCircle2 className="w-8 h-8 text-white" />
            </motion.div>
            <div>
              <h3 className="text-xl font-bold text-emerald-400">Migration Complete!</h3>
              <p className="text-sm text-muted-foreground">
                Your Playwright + TypeScript framework is ready for download
              </p>
            </div>
          </div>

          {/* Stats grid */}
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-4 mb-8">
            {[
              { label: "Files Converted", value: stats.convertedFiles, icon: FileCode, color: "text-blue-400" },
              { label: "Total Lines", value: stats.convertedLines.toLocaleString(), icon: Code2, color: "text-purple-400" },
              { label: "Locators Mapped", value: stats.locatorsConverted, icon: Eye, color: "text-cyan-400" },
              { label: "Actions Converted", value: stats.actionsConverted, icon: Zap, color: "text-emerald-400" },
              { label: "Waits Removed", value: stats.waitsRemoved, icon: Clock, color: "text-amber-400" },
              { label: "Assertions", value: stats.assertionsConverted, icon: Shield, color: "text-rose-400" },
              { label: "Conversion Rate", value: `${stats.conversionRate}%`, icon: BarChart3, color: "text-green-400" },
              { label: "Time Taken", value: `${stats.timeTaken}s`, icon: Clock, color: "text-orange-400" },
            ].map((stat, i) => {
              const StatIcon = stat.icon;
              return (
                <motion.div
                  key={stat.label}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.1 * i }}
                  className="bg-muted/30 rounded-xl p-3 text-center border border-border/50"
                >
                  <StatIcon className={`w-4 h-4 mx-auto mb-1 ${stat.color}`} />
                  <p className={`text-xl font-bold ${stat.color}`}>{stat.value}</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">{stat.label}</p>
                </motion.div>
              );
            })}
          </div>

          {/* Download button */}
          <div className="flex justify-center">
            <motion.div whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}>
              <Button
                size="lg"
                onClick={onDownload}
                disabled={isDownloading}
                className="bg-primary hover:bg-primary/90 shadow-xl shadow-primary/30 px-10 h-14 text-base"
              >
                {isDownloading ? (
                  <>
                    <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                    Packaging...
                  </>
                ) : (
                  <>
                    <Download className="w-5 h-5 mr-2" />
                    Download Playwright Framework
                    <ArrowRight className="w-5 h-5 ml-2" />
                  </>
                )}
              </Button>
            </motion.div>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}

// ─── Main Page ───────────────────────────────────────────────────────────────

export default function JavaMigrationPage() {
  const { toast } = useToast();

  // Pipeline state
  const [phase, setPhase] = useState<"upload" | "processing" | "complete">("upload");
  const [agentStates, setAgentStates] = useState<
    Record<string, { status: "idle" | "thinking" | "working" | "completed" | "error"; message: string; progress: number }>
  >(Object.fromEntries(AGENTS.map((a) => [a.id, { status: "idle", message: "", progress: 0 }])));
  const [classifiedFiles, setClassifiedFiles] = useState<FileClassification[]>([]);
  const [convertedFiles, setConvertedFiles] = useState<ConvertedFile[]>([]);
  const [migrationStats, setMigrationStats] = useState<MigrationStats | null>(null);
  const [migrationPlan, setMigrationPlan] = useState<any>(null);
  const [isDownloading, setIsDownloading] = useState(false);
  const [elapsedTime, setElapsedTime] = useState(0);
  const [eventLog, setEventLog] = useState<string[]>([]);
  const startTimeRef = useRef<number>(0);
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const jobIdRef = useRef<string | null>(null);
  const eventCursorRef = useRef<number>(0);

  // Elapsed time tracker
  useEffect(() => {
    if (phase !== "processing") return;
    const interval = setInterval(() => {
      setElapsedTime(Math.floor((Date.now() - startTimeRef.current) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [phase]);

  const stopPolling = useCallback(() => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
  }, []);

  // Apply a single migration event to UI state. Same logic that used to live
  // in handleSSE, but takes a parsed event directly (the polling endpoint
  // returns JSON, not raw SSE text).
  const applyEvent = useCallback((data: MigrationEvent) => {
    setAgentStates((prev) => ({
      ...prev,
      [data.agent]: {
        status: data.status,
        message: data.message,
        progress: data.progress ?? prev[data.agent]?.progress ?? 0,
      },
    }));

    setEventLog((prev) => [...prev.slice(-50), `[${data.agent}] ${data.message}`]);

    if (data.data) {
      if (data.agent === "classifier" && data.status === "completed") {
        const classData = data.data;
        if (classData.files) {
          setClassifiedFiles(classData.files.map((f: any) => ({
            path: f.path,
            name: f.name || f.path.split("/").pop(),
            type: f.classification || f.type,
            lines: f.lineCount || f.lines || 0,
            size: f.sizeBytes || f.size || 0,
          })));
        }
      }
      if (data.agent === "architect" && data.status === "completed") {
        const plan = data.data;
        setMigrationPlan({
          autoConvertible: plan.entries?.length || 0,
          needsReview: plan.entries?.filter((e: any) => e.strategy === "manual" || e.strategy?.includes("manual")).length || 0,
          newFiles: plan.generatedFiles?.length || 0,
          strategies: plan.entries?.slice(0, 10).map((e: any) =>
            `${e.source || "?"} → ${e.target || "?"} (${e.strategy || e.classification || "auto"})`
          ) || [],
        });
      }
      if (data.agent === "converter" && data.data.convertedFiles) {
        setConvertedFiles(data.data.convertedFiles);
      }
      if (data.agent === "packager" && data.data.stats) {
        setMigrationStats(data.data.stats);
      }
    }
  }, []);

  // Poll the server for progress. Each request returns only events newer than
  // the cursor we've already consumed, so responses stay tiny and well under
  // any proxy timeout (AWS API Gateway caps integration responses at ~30s,
  // which is why we can't use SSE end-to-end).
  const startPolling = useCallback((jobId: string) => {
    jobIdRef.current = jobId;
    eventCursorRef.current = 0;
    stopPolling();

    const poll = async () => {
      const id = jobIdRef.current;
      if (!id) return;
      try {
        const res = await qeApiFetch(`/api/java-migration/status/${id}?since=${eventCursorRef.current}`);
        if (!res.ok) {
          if (res.status === 404) {
            stopPolling();
            toast({
              title: "Job expired",
              description:
                "The migration job was lost (server restart or deploy). Please upload and run again.",
              variant: "destructive",
            });
            setPhase("upload");
          } else if (res.status === 502 || res.status === 503) {
            // Transient gateway errors — keep polling
            console.warn("[JavaMigration] poll gateway error:", res.status);
          }
          return;
        }
        const data = await parseQeApiJson<{
          events?: MigrationEvent[];
          totalEvents?: number;
          phase?: string;
          error?: string;
        }>(res);

        if (Array.isArray(data.events) && data.events.length > 0) {
          for (const ev of data.events) {
            applyEvent(ev as MigrationEvent);
          }
          eventCursorRef.current = data.totalEvents ?? eventCursorRef.current + data.events.length;
        }

        if (data.phase === "complete") {
          stopPolling();
          setPhase("complete");
          toast({ title: "Migration Complete!", description: "Your Playwright framework is ready for download" });
        } else if (data.phase === "error") {
          stopPolling();
          toast({ title: "Migration Failed", description: data.error || "Unknown error", variant: "destructive" });
          setPhase("upload");
        }
      } catch (err) {
        // Transient network errors are fine — next tick will retry. Only log
        // so we don't spam the toast system during brief blips.
        console.error("[JavaMigration] poll error:", err);
      }
    };

    void poll();
    pollIntervalRef.current = setInterval(poll, 1500);
  }, [applyEvent, stopPolling, toast]);

  const startMigration = useCallback(
    async (file?: File) => {
      setPhase("processing");
      startTimeRef.current = Date.now();
      setElapsedTime(0);
      setEventLog([]);
      setClassifiedFiles([]);
      setConvertedFiles([]);
      setMigrationStats(null);
      setMigrationPlan(null);
      setAgentStates(Object.fromEntries(AGENTS.map((a) => [a.id, { status: "idle", message: "", progress: 0 }])));

      try {
        let startBody: { sessionId?: string; demo?: boolean };

        if (file) {
          const formData = new FormData();
          formData.append("framework", file);
          const uploadRes = await qeApiFetch("/api/java-migration/upload", { method: "POST", body: formData });
          if (!uploadRes.ok) {
            const hint =
              uploadRes.status === 502 || uploadRes.status === 503
                ? "API gateway error — the upload may be too large or the backend is unavailable."
                : `Upload failed (${uploadRes.status})`;
            toast({ title: "Upload Failed", description: hint, variant: "destructive" });
            setPhase("upload");
            return;
          }
          const uploadData = await parseQeApiJson<{ success?: boolean; sessionId?: string; error?: string }>(uploadRes);
          if (!uploadData.success || !uploadData.sessionId) {
            toast({ title: "Upload Failed", description: uploadData.error || "Upload rejected", variant: "destructive" });
            setPhase("upload");
            return;
          }
          startBody = { sessionId: uploadData.sessionId };
        } else {
          startBody = { demo: true };
        }

        const startRes = await qeApiFetch("/api/java-migration/start", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(startBody),
        });
        if (!startRes.ok) {
          const hint =
            startRes.status === 404
              ? "Upload session expired — re-upload the ZIP and try again."
              : startRes.status === 502 || startRes.status === 503
                ? "API gateway error — backend unavailable."
                : `Failed to start (${startRes.status})`;
          toast({ title: "Error", description: hint, variant: "destructive" });
          setPhase("upload");
          return;
        }
        const startData = await parseQeApiJson<{ success?: boolean; jobId?: string; error?: string }>(startRes);
        if (!startData.success || !startData.jobId) {
          toast({ title: "Error", description: startData.error || "Failed to start migration", variant: "destructive" });
          setPhase("upload");
          return;
        }
        startPolling(startData.jobId);
      } catch (err: unknown) {
        const message =
          err instanceof Error && err.message.includes("HTML instead of JSON")
            ? "API returned HTML (502) — request hit the static site instead of the App Service API."
            : err instanceof Error
              ? err.message
              : "Failed to start migration";
        toast({ title: "Error", description: message, variant: "destructive" });
        setPhase("upload");
      }
    },
    [startPolling, toast]
  );

  const handleDownload = async () => {
    setIsDownloading(true);
    try {
      const url = jobIdRef.current
        ? `/api/java-migration/download?jobId=${encodeURIComponent(jobIdRef.current)}`
        : "/api/java-migration/download";
      const res = await qeApiFetch(url);
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = "playwright-framework.zip";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(blobUrl);
      toast({ title: "Downloaded!", description: "playwright-framework.zip saved" });
    } catch (err) {
      toast({ title: "Download Failed", variant: "destructive" });
    } finally {
      setIsDownloading(false);
    }
  };

  const resetMigration = () => {
    stopPolling();
    jobIdRef.current = null;
    eventCursorRef.current = 0;
    setPhase("upload");
    setAgentStates(Object.fromEntries(AGENTS.map((a) => [a.id, { status: "idle", message: "", progress: 0 }])));
    setClassifiedFiles([]);
    setConvertedFiles([]);
    setMigrationStats(null);
    setMigrationPlan(null);
    setEventLog([]);
  };

  // Cleanup polling on unmount
  useEffect(() => () => stopPolling(), [stopPolling]);

  const overallProgress =
    AGENTS.reduce((sum, a) => sum + (agentStates[a.id]?.progress || 0), 0) / AGENTS.length;

  const activeAgentIdx = AGENTS.findIndex(
    (a) => agentStates[a.id]?.status === "working" || agentStates[a.id]?.status === "thinking"
  );

  return (
    <>
      <DashboardHeader />

      <main className="flex-1 overflow-y-auto">
        <div className="p-6 space-y-6">
            {/* Page Header */}
            <div className="flex items-center gap-4">
              <Link href="/nradiverse">
                <Button variant="ghost" size="icon">
                  <ArrowLeft className="w-5 h-5" />
                </Button>
              </Link>
              <div className="flex-1">
                <h1 className="text-2xl font-bold flex items-center gap-3">
                  <div className="p-2.5 rounded-xl bg-gradient-to-br from-violet-500/20 to-blue-500/20 shadow-lg shadow-violet-500/10">
                    <Coffee className="w-7 h-7 text-violet-400" />
                  </div>
                  Java + Selenium + BDD
                  <ArrowRight className="w-5 h-5 text-muted-foreground" />
                  Playwright + TypeScript
                </h1>
                <p className="text-muted-foreground mt-1">
                  AI-powered migration agents — upload your Java framework and get a production-ready Playwright project
                </p>
              </div>

              {phase !== "upload" && (
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-2 bg-muted/30 rounded-lg px-3 py-1.5">
                    <Clock className="w-4 h-4 text-muted-foreground" />
                    <span className="font-mono text-sm tabular-nums">
                      {Math.floor(elapsedTime / 60)}:{String(elapsedTime % 60).padStart(2, "0")}
                    </span>
                  </div>
                  <Button variant="outline" size="sm" onClick={resetMigration}>
                    <RefreshCw className="w-4 h-4 mr-1" />
                    Reset
                  </Button>
                </div>
              )}
            </div>

            {/* Overall progress bar (during processing) */}
            {phase === "processing" && (
              <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}>
                <Card className="border-blue-500/20 bg-blue-500/5">
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <Loader2 className="w-4 h-4 animate-spin text-blue-400" />
                        <span className="text-sm font-medium">Migration in progress...</span>
                      </div>
                      <span className="text-sm font-bold text-blue-400">{Math.round(overallProgress)}%</span>
                    </div>
                    <div className="h-2 rounded-full bg-muted/30 overflow-hidden">
                      <motion.div
                        className="h-full rounded-full bg-gradient-to-r from-violet-500 via-blue-500 to-cyan-500"
                        animate={{ width: `${overallProgress}%` }}
                        transition={{ duration: 0.5 }}
                      />
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            )}

            {/* Upload Phase */}
            {phase === "upload" && (
              <UploadZone
                onFileSelect={(file) => startMigration(file)}
                onDemoMode={() => startMigration()}
                isProcessing={false}
              />
            )}

            {/* Agent Pipeline + Results */}
            {(phase === "processing" || phase === "complete") && (
              <div className="grid grid-cols-12 gap-6">
                {/* Left: Agent Pipeline */}
                <div className="col-span-12 lg:col-span-4 xl:col-span-3">
                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-base flex items-center gap-2">
                        <GitBranch className="w-5 h-5 text-violet-400" />
                        Agent Pipeline
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-0">
                      {AGENTS.map((agent, idx) => (
                        <div key={agent.id}>
                          <AgentCard
                            agent={agent}
                            status={agentStates[agent.id]?.status || "idle"}
                            message={agentStates[agent.id]?.message || ""}
                            progress={agentStates[agent.id]?.progress || 0}
                            index={idx}
                            isActive={idx === activeAgentIdx}
                          />
                          {idx < AGENTS.length - 1 && (
                            <AgentConnector
                              fromStatus={agentStates[AGENTS[idx].id]?.status || "idle"}
                              toStatus={agentStates[AGENTS[idx + 1].id]?.status || "idle"}
                            />
                          )}
                        </div>
                      ))}
                    </CardContent>
                  </Card>

                  {/* Live log */}
                  <Card className="mt-4">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-xs flex items-center gap-2 text-muted-foreground">
                        <Settings className="w-3.5 h-3.5" />
                        Live Agent Log
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <ScrollArea className="h-32">
                        <div className="space-y-0.5">
                          {eventLog.map((log, i) => (
                            <p key={i} className="text-[10px] font-mono text-muted-foreground leading-tight">
                              {log}
                            </p>
                          ))}
                        </div>
                      </ScrollArea>
                    </CardContent>
                  </Card>
                </div>

                {/* Right: Results */}
                <div className="col-span-12 lg:col-span-8 xl:col-span-9 space-y-6">
                  {/* Classification Results */}
                  <AnimatePresence>
                    {classifiedFiles.length > 0 && <ClassificationPanel files={classifiedFiles} />}
                  </AnimatePresence>

                  {/* Migration Plan */}
                  <AnimatePresence>
                    {migrationPlan && (
                      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
                        <Card>
                          <CardHeader className="pb-3">
                            <CardTitle className="text-base flex items-center gap-2">
                              <Layers className="w-5 h-5 text-amber-400" />
                              Migration Plan
                            </CardTitle>
                          </CardHeader>
                          <CardContent>
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                              <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-4">
                                <h4 className="text-sm font-semibold text-emerald-400 mb-2">Auto-Convertible</h4>
                                <p className="text-2xl font-bold text-emerald-400">{migrationPlan.autoConvertible || 0}</p>
                                <p className="text-xs text-muted-foreground mt-1">Files with direct mapping</p>
                              </div>
                              <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-4">
                                <h4 className="text-sm font-semibold text-amber-400 mb-2">Needs Review</h4>
                                <p className="text-2xl font-bold text-amber-400">{migrationPlan.needsReview || 0}</p>
                                <p className="text-xs text-muted-foreground mt-1">Complex patterns detected</p>
                              </div>
                              <div className="bg-blue-500/10 border border-blue-500/20 rounded-xl p-4">
                                <h4 className="text-sm font-semibold text-blue-400 mb-2">New Files</h4>
                                <p className="text-2xl font-bold text-blue-400">{migrationPlan.newFiles || 0}</p>
                                <p className="text-xs text-muted-foreground mt-1">Config & scaffold files</p>
                              </div>
                            </div>
                            {migrationPlan.strategies && (
                              <div className="mt-4 space-y-2">
                                {migrationPlan.strategies.map((s: string, i: number) => (
                                  <div key={i} className="flex items-start gap-2 text-xs text-muted-foreground">
                                    <ChevronRight className="w-3.5 h-3.5 mt-0.5 text-amber-400 flex-shrink-0" />
                                    {s}
                                  </div>
                                ))}
                              </div>
                            )}
                          </CardContent>
                        </Card>
                      </motion.div>
                    )}
                  </AnimatePresence>

                  {/* Code Comparison */}
                  <AnimatePresence>
                    {convertedFiles.length > 0 && <CodeComparisonPanel files={convertedFiles} />}
                  </AnimatePresence>

                  {/* Final Stats + Download */}
                  <AnimatePresence>
                    {phase === "complete" && migrationStats && (
                      <FinalStatsPanel
                        stats={migrationStats}
                        onDownload={handleDownload}
                        isDownloading={isDownloading}
                      />
                    )}
                  </AnimatePresence>
                </div>
              </div>
            )}
        </div>
      </main>
    </>
  );
}
