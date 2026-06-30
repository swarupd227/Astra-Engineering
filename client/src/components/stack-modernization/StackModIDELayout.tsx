/**
 * Stack Mod IDE-style layout: file tree (left), code content (center), agent/engine (right), terminal (bottom).
 * Shown only after unit tests are generated (generating_tests with tests, validating, complete).
 */

import { useState, useRef, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { FileCode2, TestTube2, CheckCircle2, AlertTriangle, Loader2, Terminal, Play, XCircle, Pencil, Save, FilePlus, Trash2, ChevronRight, ChevronDown, ChevronUp, Folder, FolderOpen, Download, PanelRight, PanelBottom } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

export interface StackModIDELayoutProps {
  analysisId?: string;
  onClose?: () => void;
  onRunValidation?: () => void;
  /** Call after file create/update/delete so parent can refresh progress (tree). */
  onRefresh?: () => void;
  progressData: {
    modifiedFiles?: Array<{ path?: string; filePath?: string; content?: string; originalContent?: string }>;
    generatedTests?: Array<{ filePath?: string; testCode?: string; testFramework?: string }>;
    extractedFilePaths?: string[];
    currentStage?: string;
    stages?: Array<{ name: string; status: string; progress?: number }>;
    activityLog?: Array<{ timestamp?: string; agent?: string; action?: string; details?: string; status?: string }>;
    validationRun?: { status?: string; lastLogs?: string; exitCode?: number; testSummary?: string };
    validationAttempts?: number;
    validationPassed?: boolean;
    stack?: "dotnet" | "python" | null;
    projectPath?: string;
  } | null;
  stage: string;
  className?: string;
}

type SelectedFile = { type: "modified"; path: string } | { type: "test"; path: string } | { type: "extracted"; path: string } | null;

interface TreeNode {
  name: string;
  fullPath?: string;
  children: TreeNode[];
  isFile: boolean;
}

function buildFileTree(paths: Array<{ path: string }>): TreeNode[] {
  const root: TreeNode = { name: "", children: [], isFile: false };
  for (const { path } of paths) {
    const segments = path.split("/").filter(Boolean);
    let current = root;
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      const isLast = i === segments.length - 1;
      const fullPath = segments.slice(0, i + 1).join("/");
      let child = current.children.find((c) => c.name === seg);
      if (!child) {
        child = { name: seg, fullPath, children: [], isFile: isLast };
        current.children.push(child);
      }
      current = child;
    }
  }
  const sortNodes = (nodes: TreeNode[]) => {
    nodes.sort((a, b) => {
      if (a.isFile && !b.isFile) return 1;
      if (!a.isFile && b.isFile) return -1;
      return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
    });
    nodes.forEach((n) => sortNodes(n.children));
  };
  sortNodes(root.children);
  return root.children;
}

function TreeLevel({
  node,
  depth,
  expandedFolders,
  toggleFolder,
  fileTreeItems,
  selectedFile,
  selectFile,
}: {
  node: TreeNode;
  depth: number;
  expandedFolders: Set<string>;
  toggleFolder: (path: string) => void;
  fileTreeItems: Array<{ path: string; isTest: boolean; isModified: boolean }>;
  selectedFile: SelectedFile | null;
  selectFile: (path: string) => void;
}) {
  const paddingLeft = depth * 12 + 8;
  if (node.isFile && node.fullPath) {
    const item = fileTreeItems.find((i) => i.path === node.fullPath);
    const isSelected = selectedFile?.path === node.fullPath;
    return (
      <button
        type="button"
        onClick={() => selectFile(node.fullPath!)}
        className={`w-full text-left text-xs font-mono truncate py-1.5 rounded flex items-center gap-1.5 ${
          isSelected ? "bg-muted" : "hover:bg-muted/50"
        }`}
        style={{ paddingLeft }}
        title={node.fullPath}
      >
        {item?.isTest ? (
          <TestTube2 className="h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
        ) : (
          <FileCode2 className="h-3.5 w-3.5 shrink-0" />
        )}
        <span className="truncate">{node.name}</span>
        {item?.isModified && (
          <Badge variant="secondary" className="ml-auto shrink-0 text-[10px] px-1">upgraded</Badge>
        )}
      </button>
    );
  }
  const folderPath = node.fullPath ?? node.name;
  const isExpanded = expandedFolders.has(folderPath);
  return (
    <div key={node.name}>
      <button
        type="button"
        onClick={() => toggleFolder(folderPath)}
        className="w-full text-left text-xs font-mono truncate py-1.5 rounded flex items-center gap-1 hover:bg-muted/50"
        style={{ paddingLeft }}
        title={folderPath}
      >
        {isExpanded ? (
          <ChevronDown className="h-3.5 w-3.5 shrink-0" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 shrink-0" />
        )}
        {isExpanded ? (
          <FolderOpen className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        ) : (
          <Folder className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        )}
        <span className="truncate">{node.name}</span>
      </button>
      {isExpanded &&
        node.children.map((child) => (
          <TreeLevel
            key={child.fullPath ?? child.name}
            node={child}
            depth={depth + 1}
            expandedFolders={expandedFolders}
            toggleFolder={toggleFolder}
            fileTreeItems={fileTreeItems}
            selectedFile={selectedFile}
            selectFile={selectFile}
          />
        ))}
    </div>
  );
}

export function StackModIDELayout({ analysisId, progressData, stage, onClose, onRunValidation, onRefresh, className = "" }: StackModIDELayoutProps) {
  const [selectedFile, setSelectedFile] = useState<SelectedFile>(null);
  const [fetchedContent, setFetchedContent] = useState<Record<string, string>>({});
  const [contentLoading, setContentLoading] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState("");
  const [saveLoading, setSaveLoading] = useState(false);
  const [newFileOpen, setNewFileOpen] = useState(false);
  const [newFilePath, setNewFilePath] = useState("");
  const [newFileContent, setNewFileContent] = useState("");
  const [createLoading, setCreateLoading] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [terminalInput, setTerminalInput] = useState("");
  const [terminalRunOutput, setTerminalRunOutput] = useState("");
  const [runCommandLoading, setRunCommandLoading] = useState(false);
  const [showAgentGraph, setShowAgentGraph] = useState(true);
  const [showTerminal, setShowTerminal] = useState(true);
  const terminalRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();

  const downloadTerminalLogs = () => {
    const logs = [progressData?.validationRun?.lastLogs ?? "", terminalRunOutput].filter(Boolean).join("\n");
    if (!logs.trim()) { toast({ title: "No logs", description: "Terminal is empty." }); return; }
    const blob = new Blob([logs], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `terminal-logs-${Date.now()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const toggleFolder = (folderPath: string) => {
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(folderPath)) next.delete(folderPath);
      else next.add(folderPath);
      return next;
    });
  };

  const modifiedFiles = progressData?.modifiedFiles ?? [];
  const generatedTests = progressData?.generatedTests ?? [];
  const extractedFilePaths = progressData?.extractedFilePaths ?? [];
  const stages = progressData?.stages ?? [];
  const currentStage = progressData?.currentStage ?? "";
  const activityLog = progressData?.activityLog ?? [];
  const validationRun = progressData?.validationRun;
  const validationAttempts = progressData?.validationAttempts ?? 0;
  const validationPassed = progressData?.validationPassed;

  // Auto-scroll terminal to bottom when new logs or run-command output
  useEffect(() => {
    terminalRef.current?.scrollTo({ top: terminalRef.current.scrollHeight, behavior: "smooth" });
  }, [validationRun?.lastLogs, terminalRunOutput]);

  // Build a set of normalized extracted paths for robust matching
  const extractedPathsNormalized = extractedFilePaths.map((p) => p.replace(/\\/g, "/"));
  const extractedPathSet = new Set(extractedPathsNormalized);

  // Resolve a path (from modifiedFiles/tests) to a canonical extracted path via suffix matching
  function resolveToExtractedPath(raw: string): string {
    const normalized = raw.replace(/\\/g, "/");
    if (extractedPathSet.has(normalized)) return normalized;
    const lower = normalized.toLowerCase();
    for (const ep of extractedPathsNormalized) {
      if (ep.toLowerCase() === lower) return ep;
      if (ep.toLowerCase().endsWith("/" + lower)) return ep;
    }
    return normalized;
  }

  const normalizedModified = modifiedFiles.map((f) => ({
    path: resolveToExtractedPath((f.path ?? f.filePath ?? "")),
    content: f.content ?? "",
    originalContent: f.originalContent ?? "",
  }));
  const normalizedTests = generatedTests.map((t) => ({
    path: (t.filePath ?? "").replace(/\\/g, "/"),
    testCode: t.testCode ?? "",
    testFramework: t.testFramework ?? "",
  }));

  const allPaths = new Set<string>();
  extractedPathsNormalized.forEach((p) => allPaths.add(p));
  normalizedModified.forEach((m) => allPaths.add(m.path));
  normalizedTests.forEach((t) => allPaths.add(t.path));
  const sortedPaths = Array.from(allPaths).sort();

  const modifiedPathSet = new Set(normalizedModified.map((m) => m.path));
  const testPathSet = new Set(normalizedTests.map((t) => t.path));
  const fileTreeItems = sortedPaths.map((path) => ({
    path,
    isTest: testPathSet.has(path),
    isModified: modifiedPathSet.has(path),
  }));

  const fileTree = buildFileTree(fileTreeItems);
  const stack = progressData?.stack ?? null;
  const projectPath = progressData?.projectPath ?? "";

  const runCommand = async (command: string) => {
    if (!analysisId || !command.trim()) return;
    setRunCommandLoading(true);
    setTerminalRunOutput((prev) => prev + "\n$ " + command.trim() + "\n");
    try {
      const res = await apiRequest("POST", `/api/stack-modernization/analysis/${analysisId}/run-command`, {
        command: command.trim(),
      });
      const data = await res.json().catch(() => ({}));
      const out = [data.stdout, data.stderr].filter(Boolean).join("\n").trim();
      setTerminalRunOutput((prev) => prev + (out || "(no output)") + "\n");
      if (!res.ok) toast({ title: "Command failed", description: data.error || data.message, variant: "destructive" });
    } catch (e) {
      setTerminalRunOutput((prev) => prev + (e instanceof Error ? e.message : "Unknown error") + "\n");
      toast({ title: "Run failed", description: e instanceof Error ? e.message : "Unknown error", variant: "destructive" });
    } finally {
      setRunCommandLoading(false);
    }
  };

  const selectFile = (path: string) => {
    if (normalizedModified.some((m) => m.path === path)) {
      setSelectedFile({ type: "modified", path });
      return;
    }
    if (normalizedTests.some((t) => t.path === path)) {
      setSelectedFile({ type: "test", path });
      return;
    }
    setSelectedFile({ type: "extracted", path });
    if (fetchedContent[path] !== undefined) return;
    if (!analysisId) return;
    setContentLoading(true);
    apiRequest("GET", `/api/stack-modernization/analysis/${analysisId}/file-content?path=${encodeURIComponent(path)}`)
      .then((r) => r.json())
      .then((data: { content?: string }) => {
        setFetchedContent((prev) => ({ ...prev, [path]: data.content ?? "" }));
      })
      .catch(() => setFetchedContent((prev) => ({ ...prev, [path]: "(failed to load)" })))
      .finally(() => setContentLoading(false));
  };

  const selectedContent = ((): string => {
    if (!selectedFile) return "";
    if (selectedFile.type === "modified") {
      const f = normalizedModified.find((x) => x.path === selectedFile.path);
      return f?.content ?? "";
    }
    if (selectedFile.type === "test") {
      const t = normalizedTests.find((x) => x.path === selectedFile.path);
      return t?.testCode ?? "";
    }
    return fetchedContent[selectedFile.path] ?? (contentLoading ? "Loading…" : "");
  })();

  const handleStartEdit = () => {
    setEditContent(selectedContent);
    setIsEditing(true);
  };

  const handleSave = async () => {
    if (!selectedFile || !analysisId) return;
    setSaveLoading(true);
    try {
      const res = await apiRequest("PUT", `/api/stack-modernization/analysis/${analysisId}/file`, {
        path: selectedFile.path,
        content: editContent,
      });
      if (!res.ok) throw new Error("Save failed");
      setFetchedContent((prev) => ({ ...prev, [selectedFile.path]: editContent }));
      setIsEditing(false);
      onRefresh?.();
      toast({ title: "Saved", description: `${selectedFile.path} updated.` });
    } catch (e) {
      toast({
        title: "Save failed",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setSaveLoading(false);
    }
  };

  const handleCreateFile = async () => {
    const path = newFilePath.trim().replace(/\\/g, "/");
    if (!path || !analysisId) return;
    setCreateLoading(true);
    try {
      const res = await apiRequest("PUT", `/api/stack-modernization/analysis/${analysisId}/file`, {
        path,
        content: newFileContent,
      });
      if (!res.ok) throw new Error("Create failed");
      setNewFileOpen(false);
      setNewFilePath("");
      setNewFileContent("");
      setFetchedContent((prev) => ({ ...prev, [path]: newFileContent }));
      onRefresh?.();
      selectFile(path);
      toast({ title: "File created", description: path });
    } catch (e) {
      toast({
        title: "Create failed",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setCreateLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!selectedFile || !analysisId || !window.confirm(`Delete ${selectedFile.path}?`)) return;
    setDeleteLoading(true);
    try {
      const res = await apiRequest("DELETE", `/api/stack-modernization/analysis/${analysisId}/file?path=${encodeURIComponent(selectedFile.path)}`);
      if (!res.ok) throw new Error("Delete failed");
      setSelectedFile(null);
      setFetchedContent((prev) => {
        const next = { ...prev };
        delete next[selectedFile.path];
        return next;
      });
      onRefresh?.();
      toast({ title: "Deleted", description: selectedFile.path });
    } catch (e) {
      toast({
        title: "Delete failed",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setDeleteLoading(false);
    }
  };

  return (
    <div className={`flex flex-col gap-2 ${className}`}>
      {/* Header: Close and Run again when in validation view */}
      {(onClose || (validationRun != null && onRunValidation)) && (
        <div className="flex items-center justify-end gap-2 flex-wrap">
          {validationRun != null && onRunValidation && (
            <Button variant="outline" size="sm" onClick={onRunValidation}>
              <Play className="h-3.5 w-3.5 mr-1.5" />
              Run validation again
            </Button>
          )}
          {onClose && (
            <Button variant="ghost" size="sm" onClick={onClose}>
              <XCircle className="h-3.5 w-3.5 mr-1.5" />
              Close
            </Button>
          )}
        </div>
      )}
      {/* Main area: left + center + right */}
      <div className="flex flex-wrap gap-2 min-h-0 flex-1 min-h-[360px]">
        {/* Left: File tree */}
        <Card className="w-[240px] shrink-0 flex flex-col overflow-hidden">
          <CardHeader className="py-2 px-3">
            <CardTitle className="text-sm font-medium">Files</CardTitle>
          </CardHeader>
          <CardContent className="flex-1 overflow-hidden p-0">
            <ScrollArea className="h-[320px]">
              {fileTree.length > 0 ? (
                <div className="px-2 pb-2">
                  <p className="text-xs font-medium text-muted-foreground px-2 py-1">Repository</p>
                  {fileTree.map((node) => (
                    <TreeLevel
                      key={node.name}
                      node={node}
                      depth={0}
                      expandedFolders={expandedFolders}
                      toggleFolder={toggleFolder}
                      fileTreeItems={fileTreeItems}
                      selectedFile={selectedFile}
                      selectFile={selectFile}
                    />
                  ))}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground px-3 py-4">No files to show.</p>
              )}
            </ScrollArea>
          </CardContent>
        </Card>

        {/* Center: Code content */}
        <Card className="flex-1 min-w-0 flex flex-col overflow-hidden">
          <CardHeader className="py-2 px-3 flex flex-row items-center justify-between gap-2 flex-wrap">
            <CardTitle className="text-sm font-medium truncate">
              {selectedFile
                ? (selectedFile.type === "test" ? "Test: " : selectedFile.type === "extracted" ? "File: " : "") + selectedFile.path
                : "Code"}
            </CardTitle>
            <div className="flex items-center gap-1.5 flex-shrink-0 flex-wrap">
              {stack && (
                <>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={!analysisId || runCommandLoading}
                    onClick={async () => {
                      if (!analysisId) return;
                      setRunCommandLoading(true);
                      setTerminalRunOutput((prev) => prev + "\n$ [Smart Build with Fix Loop]\n");
                      try {
                        const res = await apiRequest("POST", `/api/stack-modernization/analysis/${analysisId}/build-with-fix-loop`, { maxAttempts: 3 });
                        const data = await res.json().catch(() => ({}));
                        const logs = data.stdout || data.message || "(no output)";
                        setTerminalRunOutput((prev) => prev + logs + "\n");
                        if (data.success) {
                          setTerminalRunOutput((prev) => prev + `\n✓ Build succeeded in ${data.attempts} attempt(s).\n`);
                        } else {
                          setTerminalRunOutput((prev) => prev + `\n✗ Build failed after ${data.attempts} attempt(s).\n`);
                        }
                        if (data.fixesApplied?.length > 0) {
                          setTerminalRunOutput((prev) => prev + `Fixes applied to: ${data.fixesApplied.join(", ")}\n`);
                        }
                        onRefresh?.();
                      } catch (e) {
                        setTerminalRunOutput((prev) => prev + (e instanceof Error ? e.message : "Unknown error") + "\n");
                      } finally {
                        setRunCommandLoading(false);
                      }
                    }}
                    title={stack === "dotnet" ? "Build project (with auto-fix)" : "Install & build (with auto-fix)"}
                  >
                    {runCommandLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                    Build
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={!analysisId || runCommandLoading}
                    onClick={() => {
                      const cmd = stack === "dotnet" ? "dotnet run" : "python main.py";
                      runCommand(cmd);
                    }}
                    title="Run entire project"
                  >
                    Run project
                  </Button>
                  {selectedFile?.path && (
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={runCommandLoading}
                      onClick={() => {
                        const p = selectedFile.path;
                        const cmd =
                          stack === "python"
                            ? `python ${p}`
                            : p.endsWith(".csproj")
                              ? `dotnet run --project ${p}`
                              : "dotnet run";
                        runCommand(cmd);
                      }}
                      title="Run selected file"
                    >
                      Run file
                    </Button>
                  )}
                </>
              )}
              <Dialog open={newFileOpen} onOpenChange={setNewFileOpen}>
                <DialogTrigger asChild>
                  <Button variant="ghost" size="sm" disabled={!analysisId}>
                    <FilePlus className="h-3.5 w-3.5 mr-1" />
                    New file
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>New file</DialogTitle>
                    <DialogDescription>Path relative to project root (e.g. src/foo.ts)</DialogDescription>
                  </DialogHeader>
                  <div className="space-y-2">
                    <input
                      className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm"
                      placeholder="path/to/file.ts"
                      value={newFilePath}
                      onChange={(e) => setNewFilePath(e.target.value)}
                    />
                    <Textarea
                      className="min-h-[120px] font-mono text-xs"
                      placeholder="Initial content"
                      value={newFileContent}
                      onChange={(e) => setNewFileContent(e.target.value)}
                    />
                  </div>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setNewFileOpen(false)}>Cancel</Button>
                    <Button onClick={handleCreateFile} disabled={!newFilePath.trim() || createLoading}>
                      {createLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Create"}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
              {selectedFile && (
                <>
                  {!isEditing ? (
                    <Button variant="ghost" size="sm" onClick={handleStartEdit}>
                      <Pencil className="h-3.5 w-3.5 mr-1" />
                      Edit
                    </Button>
                  ) : (
                    <Button variant="ghost" size="sm" onClick={handleSave} disabled={saveLoading}>
                      {saveLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5 mr-1" />}
                      Save
                    </Button>
                  )}
                  <Button variant="ghost" size="sm" onClick={handleDelete} disabled={deleteLoading}>
                    {deleteLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                    Delete
                  </Button>
                </>
              )}
            </div>
          </CardHeader>
          <CardContent className="flex-1 overflow-hidden p-0">
            {!selectedFile ? (
              <div className="h-[320px] flex items-center justify-center text-sm text-muted-foreground px-4">
                Select a file from the left to view its content.
              </div>
            ) : isEditing ? (
              <div className="h-[320px] flex flex-col">
                <Textarea
                  className="flex-1 min-h-0 font-mono text-xs rounded-none border-0 resize-none"
                  value={editContent}
                  onChange={(e) => setEditContent(e.target.value)}
                />
              </div>
            ) : (
              <ScrollArea className="h-[320px]">
                <pre className="text-xs font-mono p-3 overflow-x-auto whitespace-pre">
                  {selectedContent || "(empty)"}
                </pre>
              </ScrollArea>
            )}
          </CardContent>
        </Card>

        {/* Right: Agent Graph / Engine status (collapsible) */}
        {showAgentGraph && (
        <Card className="w-[300px] shrink-0 flex flex-col overflow-hidden">
          <CardHeader className="py-2 px-3 flex flex-row items-center justify-between gap-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              Agent Graph
              {validationRun?.status === "running" && (
                <Loader2 className="h-3 w-3 animate-spin text-primary" />
              )}
            </CardTitle>
            <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => setShowAgentGraph(false)} title="Hide Agent Graph">
              <XCircle className="h-3.5 w-3.5" />
            </Button>
          </CardHeader>
          <CardContent className="flex-1 overflow-hidden p-0">
            <ScrollArea className="h-[320px]">
              <div className="px-3 py-2 space-y-3">
                {validationRun == null && onRunValidation && (
                  <div className="rounded-lg border bg-muted/30 p-2">
                    <p className="text-xs font-medium text-muted-foreground mb-2">Run code execution</p>
                    <Button size="sm" className="w-full" onClick={onRunValidation}>
                      <Play className="h-3.5 w-3.5 mr-1.5" />
                      Execute validation
                    </Button>
                    <p className="text-xs text-muted-foreground mt-2">Install deps, run tests in container/local.</p>
                  </div>
                )}

                {/* Validation outcome badge */}
                {validationRun != null && (
                  <div className="rounded-lg border p-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      {validationRun.status === "passed" && (
                        <Badge className="bg-green-600 dark:bg-green-700">
                          <CheckCircle2 className="h-3 w-3 mr-1" />
                          Passed
                        </Badge>
                      )}
                      {validationRun.status === "failed" && (
                        <Badge variant="destructive">
                          <AlertTriangle className="h-3 w-3 mr-1" />
                          Failed
                        </Badge>
                      )}
                      {validationRun.status === "running" && (
                        <Badge variant="secondary">
                          <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                          Running
                        </Badge>
                      )}
                      {validationRun.status === "skipped" && (
                        <Badge variant="secondary">Skipped</Badge>
                      )}
                      {validationAttempts > 0 && (
                        <span className="text-xs text-muted-foreground">
                          {validationAttempts} attempt(s)
                        </span>
                      )}
                    </div>
                    {validationRun.testSummary && (
                      <p className="text-xs text-muted-foreground mt-1">{validationRun.testSummary}</p>
                    )}
                  </div>
                )}

                {/* Live agent flow — parsed from validation logs */}
                {(() => {
                  const logs = validationRun?.lastLogs ?? "";
                  const agentPattern = /\[(\w+(?:Agent|Analysis|Orchestrator))\]\s*(.+)/g;
                  const agentEvents: Array<{ agent: string; message: string; isError: boolean }> = [];
                  let match: RegExpExecArray | null;
                  while ((match = agentPattern.exec(logs)) !== null) {
                    const msg = match[2].trim();
                    agentEvents.push({
                      agent: match[1],
                      message: msg.length > 100 ? msg.slice(0, 100) + "…" : msg,
                      isError: /fail|error/i.test(msg),
                    });
                  }

                  if (agentEvents.length === 0 && (stage === "validating" || validationRun?.status === "running")) {
                    return (
                      <div className="rounded-lg border bg-muted/30 p-2 flex items-center gap-2">
                        <Loader2 className="h-4 w-4 animate-spin shrink-0" />
                        <span className="text-xs">Initializing agents…</span>
                      </div>
                    );
                  }

                  if (agentEvents.length === 0) return null;

                  const agentOrder = ["Orchestrator", "DependencyInstallAgent", "BuildRunAgent", "TerminalAnalysis", "FixValidationAgent"];
                  const agentColors: Record<string, string> = {
                    Orchestrator: "bg-blue-100 dark:bg-blue-900/40 text-blue-800 dark:text-blue-300 border-blue-300 dark:border-blue-700",
                    DependencyInstallAgent: "bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-300 border-amber-300 dark:border-amber-700",
                    BuildRunAgent: "bg-purple-100 dark:bg-purple-900/40 text-purple-800 dark:text-purple-300 border-purple-300 dark:border-purple-700",
                    TerminalAnalysis: "bg-cyan-100 dark:bg-cyan-900/40 text-cyan-800 dark:text-cyan-300 border-cyan-300 dark:border-cyan-700",
                    FixValidationAgent: "bg-emerald-100 dark:bg-emerald-900/40 text-emerald-800 dark:text-emerald-300 border-emerald-300 dark:border-emerald-700",
                  };

                  const latestByAgent = new Map<string, { message: string; isError: boolean; count: number }>();
                  for (const ev of agentEvents) {
                    const existing = latestByAgent.get(ev.agent);
                    latestByAgent.set(ev.agent, {
                      message: ev.message,
                      isError: ev.isError,
                      count: (existing?.count ?? 0) + 1,
                    });
                  }

                  const sortedAgents = [...latestByAgent.entries()].sort(
                    (a, b) => (agentOrder.indexOf(a[0]) === -1 ? 99 : agentOrder.indexOf(a[0])) - (agentOrder.indexOf(b[0]) === -1 ? 99 : agentOrder.indexOf(b[0]))
                  );

                  return (
                    <div className="space-y-1.5">
                      <p className="text-xs font-medium text-muted-foreground">Agent flow</p>
                      {sortedAgents.map(([agent, data], idx) => (
                        <div key={agent}>
                          <div
                            className={`rounded-md border p-2 ${
                              agentColors[agent] ?? "bg-muted/30 border-border"
                            }`}
                          >
                            <div className="flex items-center gap-1.5">
                              {data.isError ? (
                                <AlertTriangle className="h-3 w-3 shrink-0 text-red-500" />
                              ) : validationRun?.status === "running" && idx === sortedAgents.length - 1 ? (
                                <Loader2 className="h-3 w-3 shrink-0 animate-spin" />
                              ) : (
                                <CheckCircle2 className="h-3 w-3 shrink-0 text-green-600 dark:text-green-400" />
                              )}
                              <span className="text-xs font-semibold">{agent}</span>
                              <span className="ml-auto text-[10px] text-muted-foreground">{data.count} event(s)</span>
                            </div>
                            <p className="text-[11px] mt-0.5 leading-tight">{data.message}</p>
                          </div>
                          {idx < sortedAgents.length - 1 && (
                            <div className="flex justify-center py-0.5">
                              <div className="w-px h-3 bg-border" />
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  );
                })()}

                {/* Pipeline phases */}
                {stages.length > 0 && (
                  <div className="pt-2 border-t border-border">
                    <p className="text-xs font-medium text-muted-foreground px-1 mb-1">Pipeline</p>
                    <ul className="space-y-1">
                      {stages.map((s, i) => (
                        <li key={i} className="flex items-center gap-2 text-xs">
                          {s.status === "completed" ? (
                            <CheckCircle2 className="h-3.5 w-3.5 text-green-600 dark:text-green-400 shrink-0" />
                          ) : s.status === "in_progress" ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />
                          ) : (
                            <span className="w-3.5 h-3.5 rounded-full border border-muted-foreground shrink-0" />
                          )}
                          <span className="truncate">{s.name}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Current step display */}
                {currentStage && (
                  <div className="rounded-lg border bg-muted/30 p-2">
                    <p className="text-xs font-medium text-muted-foreground">Current step</p>
                    <p className="text-xs mt-0.5">{currentStage}</p>
                  </div>
                )}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
        )}
        {!showAgentGraph && (
          <Button variant="outline" size="sm" className="h-8 shrink-0 gap-1.5" onClick={() => setShowAgentGraph(true)} title="Show Agent Graph">
            <PanelRight className="h-3.5 w-3.5" />
            Agent Graph
          </Button>
        )}
      </div>

      {/* Bottom: Terminal — build/test logs + interactive command input (collapsible) */}
      {!showTerminal ? (
        <Button variant="outline" size="sm" className="self-start gap-1.5" onClick={() => setShowTerminal(true)} title="Show Terminal">
          <PanelBottom className="h-3.5 w-3.5" />
          Terminal
        </Button>
      ) : (
      <Card className="flex flex-col overflow-hidden">
        <CardHeader className="py-2 px-3 flex flex-row items-center gap-2">
          <Terminal className="h-4 w-4 text-muted-foreground" />
          <CardTitle className="text-sm font-medium">Terminal</CardTitle>
          {projectPath && (
            <span className="text-xs font-mono text-muted-foreground truncate max-w-[320px]" title={projectPath}>
              {projectPath}
            </span>
          )}
          {/* Test results summary badges */}
          {(validationRun?.testsRun != null && validationRun.testsRun > 0) && (
            <div className="ml-auto flex items-center gap-1.5">
              <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-semibold bg-muted text-muted-foreground">
                {validationRun.testsRun} tests
              </span>
              {validationRun.testsPassed > 0 && (
                <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-semibold bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300">
                  {validationRun.testsPassed} passed
                </span>
              )}
              {validationRun.testsFailed > 0 && (
                <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-semibold bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300">
                  {validationRun.testsFailed} failed
                </span>
              )}
              {validationRun.testsSkipped > 0 && (
                <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-semibold bg-yellow-100 dark:bg-yellow-900/40 text-yellow-700 dark:text-yellow-300">
                  {validationRun.testsSkipped} skipped
                </span>
              )}
            </div>
          )}
          <div className="ml-auto flex items-center gap-1">
            <Button variant="ghost" size="sm" className="h-6 px-2 gap-1" onClick={downloadTerminalLogs} title="Download terminal logs">
              <Download className="h-3 w-3" />
              <span className="text-[10px]">Logs</span>
            </Button>
            <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => setShowTerminal(false)} title="Hide Terminal">
              <ChevronDown className="h-3.5 w-3.5" />
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-0 flex flex-col">
          <div
            ref={terminalRef}
            className="min-h-[180px] max-h-[240px] overflow-auto bg-muted/50 dark:bg-muted/30 font-mono text-xs p-3 flex flex-col"
          >
            {!validationRun?.lastLogs && !terminalRunOutput && (
              <p className="text-muted-foreground">
                Run & Validate output appears here. Type a command below and press Enter to run (e.g. python main.py, dotnet run).
              </p>
            )}
            {validationRun?.status === "running" && validationRun?.lastLogs && (
              <p className="text-muted-foreground mb-2">Running build and tests…</p>
            )}
            {(validationRun?.lastLogs || terminalRunOutput) && (
              <pre className="whitespace-pre-wrap break-all text-muted-foreground flex-1">
                {[validationRun?.lastLogs ?? "", terminalRunOutput].filter(Boolean).join("\n")}
              </pre>
            )}
          </div>
          <div className="flex items-center gap-2 border-t bg-background px-3 py-2">
            <span className="text-muted-foreground font-mono text-xs shrink-0">
              {projectPath ? ">" : "$"}
            </span>
            <input
              type="text"
              className="flex-1 min-w-0 font-mono text-xs bg-transparent border-0 outline-none focus:ring-0"
              placeholder={stack === "dotnet" ? "dotnet run" : stack === "python" ? "python main.py" : "Enter command…"}
              value={terminalInput}
              onChange={(e) => setTerminalInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  runCommand(terminalInput);
                  setTerminalInput("");
                }
              }}
              disabled={!analysisId || runCommandLoading}
            />
            <Button
              size="sm"
              variant="secondary"
              disabled={!analysisId || runCommandLoading || !terminalInput.trim()}
              onClick={() => {
                runCommand(terminalInput);
                setTerminalInput("");
              }}
            >
              {runCommandLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Run"}
            </Button>
          </div>
        </CardContent>
      </Card>
      )}
    </div>
  );
}
