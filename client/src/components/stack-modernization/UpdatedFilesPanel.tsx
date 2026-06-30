/**
 * Modal dialog for viewing upgraded files and generated test scripts.
 * Opens as a large overlay instead of an inline side panel.
 */

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FileCode2, ChevronRight, FolderOpen, TestTube2, Download, FileText, Package } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { CodeDiffViewer } from "./CodeDiffViewer";

export interface ModifiedFileForPanel {
  path: string;
  content?: string;
  originalContent?: string;
  filePath?: string;
  changes?: Array<{ package: string; oldVersion: string; newVersion: string }>;
  /** True when this file was created by the upgrade (not present in the original repo). */
  isNew?: boolean;
}

export interface GeneratedTestForPanel {
  filePath?: string;
  testCode?: string;
  testFramework?: string;
}

interface UpdatedFilesPanelProps {
  modifiedFiles: ModifiedFileForPanel[];
  generatedTests?: GeneratedTestForPanel[];
  /** Comprehensive migration report markdown (generated after completeness verification). */
  migrationReportMarkdown?: string;
  onDownloadZip?: () => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function normalizeFile(f: ModifiedFileForPanel): { path: string; content: string; originalContent: string; changes?: ModifiedFileForPanel["changes"]; isNew: boolean } {
  const path = f.path ?? (f as any).filePath ?? "";
  const originalContent = f.originalContent ?? "";
  const content = f.content ?? "";
  return {
    path,
    content,
    originalContent,
    changes: f.changes,
    isNew: f.isNew ?? (!originalContent && !!content),
  };
}

/** Check if a file is a vendor/library file based on its path */
function isVendorFile(path: string): boolean {
  const lower = path.toLowerCase().replace(/\\/g, "/");
  return /\/(wwwroot\/lib|bower_components|vendor\/assets|static\/vendor|public\/assets\/vendor|node_modules)\//.test(lower)
    || /\.(min\.js|min\.css|bundle\.min\.js)$/.test(lower);
}

/** Extract package upgrade info from a vendor file's changes */
function getVendorUpgradeLabel(f: { changes?: Array<{ package: string; oldVersion: string; newVersion: string }> }): string | null {
  if (!f.changes?.length) return null;
  return f.changes.map(c => `${c.package} ${c.oldVersion} → ${c.newVersion}`).join(", ");
}

export function UpdatedFilesPanel({ modifiedFiles, generatedTests = [], migrationReportMarkdown, onDownloadZip, open, onOpenChange }: UpdatedFilesPanelProps) {
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [selectedTestPath, setSelectedTestPath] = useState<string | null>(null);
  const normalized = modifiedFiles.map(normalizeFile).filter((f) => f.path);
  const selectedFile = normalized.find((f) => f.path === selectedPath) ?? null;

  // Separate vendor library files from code files
  const vendorFiles = normalized.filter(f => isVendorFile(f.path));
  const codeFiles = normalized.filter(f => !isVendorFile(f.path));

  const normalizedTests = generatedTests
    .map((t) => ({ path: t.filePath ?? "", testCode: t.testCode ?? "", framework: t.testFramework ?? "" }))
    .filter((t) => t.path);
  const selectedTest = normalizedTests.find((t) => t.path === selectedTestPath) ?? null;

  const totalFiles = normalized.length + normalizedTests.length;

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => onOpenChange(true)}
        className="shrink-0 gap-2"
        title="View upgraded files and generated tests"
      >
        <FolderOpen className="h-4 w-4" />
        Files {totalFiles > 0 && `(${totalFiles})`}
      </Button>

      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-5xl w-[95vw] max-h-[85vh] flex flex-col p-0 gap-0">
          <DialogHeader className="px-6 pt-5 pb-3 border-b">
            <DialogTitle className="flex items-center gap-2">
              <FolderOpen className="h-5 w-5" />
              Project Files
              <span className="text-sm font-normal text-muted-foreground ml-2">
                {codeFiles.length} code, {vendorFiles.length} packages, {normalized.filter(f => f.isNew).length} new, {normalizedTests.length} tests
              </span>
            </DialogTitle>
          </DialogHeader>

          <Tabs defaultValue="upgraded" className="flex-1 flex flex-col min-h-0">
            <TabsList className="mx-6 mt-3 w-fit">
              <TabsTrigger value="upgraded" className="gap-2">
                <FileCode2 className="h-3.5 w-3.5" />
                Upgraded Files ({normalized.length})
              </TabsTrigger>
              <TabsTrigger value="tests" className="gap-2">
                <TestTube2 className="h-3.5 w-3.5" />
                Generated Tests ({normalizedTests.length})
              </TabsTrigger>
              {migrationReportMarkdown && (
                <TabsTrigger value="report" className="gap-2">
                  <FileText className="h-3.5 w-3.5" />
                  Migration Report
                </TabsTrigger>
              )}
            </TabsList>

            {/* Tab 1: Upgraded files with diff viewer */}
            <TabsContent value="upgraded" className="flex-1 min-h-0 flex flex-col mt-0 px-0">
              {normalized.length === 0 ? (
                <div className="p-8 text-sm text-muted-foreground text-center">
                  No files upgraded yet. Files will appear as tasks are executed.
                </div>
              ) : (
                <div className="flex flex-1 min-h-0">
                  <ScrollArea className="w-[280px] shrink-0 border-r">
                    {/* Vendor Package Summary */}
                    {vendorFiles.length > 0 && (
                      <div className="mx-2 mt-2 mb-1 p-2.5 rounded-lg bg-violet-500/10 border border-violet-500/20">
                        <div className="flex items-center gap-1.5 mb-1.5">
                          <Package className="h-3.5 w-3.5 text-violet-500" />
                          <span className="text-[11px] font-semibold text-violet-500">Packages Downloaded ({vendorFiles.length})</span>
                        </div>
                        <ul className="space-y-0.5">
                          {vendorFiles.map(f => {
                            const label = getVendorUpgradeLabel(f);
                            return (
                              <li key={f.path} className="text-[10px] text-muted-foreground truncate">
                                {label ? (
                                  <span className="text-violet-400">{label}</span>
                                ) : (
                                  <span>{f.path.split("/").pop()}</span>
                                )}
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                    )}

                    <ul className="p-2 space-y-0.5">
                      {normalized.map((f) => {
                        const isVendor = isVendorFile(f.path);
                        return (
                          <li key={f.path}>
                            <button
                              type="button"
                              onClick={() => setSelectedPath(selectedPath === f.path ? null : f.path)}
                              className={`w-full text-left flex items-center gap-2 px-2 py-1.5 rounded text-xs font-mono truncate transition-colors ${
                                selectedPath === f.path ? "bg-muted" : "hover:bg-muted/50"
                              }`}
                            >
                              <ChevronRight
                                className={`h-3.5 w-3.5 shrink-0 transition-transform ${selectedPath === f.path ? "rotate-90" : ""}`}
                              />
                              {isVendor ? (
                                <Package className="h-3.5 w-3.5 shrink-0 text-violet-500" />
                              ) : (
                                <FileCode2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                              )}
                              <span className="truncate">{f.path}</span>
                              {isVendor && (
                                <span className="ml-auto shrink-0 text-[10px] px-1.5 py-0.5 rounded bg-violet-500/15 text-violet-500 font-medium">
                                  PKG
                                </span>
                              )}
                              {f.isNew && !isVendor && (
                                <span className="ml-auto shrink-0 text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-500 font-medium">
                                  NEW
                                </span>
                              )}
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </ScrollArea>
                  <div className="flex-1 min-w-0 overflow-auto">
                    {selectedFile ? (
                      <CodeDiffViewer
                        modifiedFiles={[{ ...selectedFile, changes: selectedFile.changes ?? [] }]}
                        onDownloadZip={onDownloadZip ?? (() => {})}
                      />
                    ) : (
                      <div className="h-full flex items-center justify-center text-sm text-muted-foreground p-4">
                        Select a file from the left to view its diff.
                      </div>
                    )}
                  </div>
                </div>
              )}
              {onDownloadZip && normalized.length > 0 && (
                <div className="border-t px-4 py-2 flex justify-end">
                  <Button variant="outline" size="sm" onClick={onDownloadZip}>
                    <Download className="h-3.5 w-3.5 mr-2" />
                    Download Upgraded Code (ZIP)
                  </Button>
                </div>
              )}
            </TabsContent>

            {/* Tab 2: Generated test scripts */}
            <TabsContent value="tests" className="flex-1 min-h-0 flex flex-col mt-0 px-0">
              {normalizedTests.length === 0 ? (
                <div className="p-8 text-sm text-muted-foreground text-center">
                  No test scripts generated yet.
                </div>
              ) : (
                <div className="flex flex-1 min-h-0">
                  <ScrollArea className="w-[260px] shrink-0 border-r">
                    <ul className="p-2 space-y-0.5">
                      {normalizedTests.map((t) => (
                        <li key={t.path}>
                          <button
                            type="button"
                            onClick={() => setSelectedTestPath(selectedTestPath === t.path ? null : t.path)}
                            className={`w-full text-left flex items-center gap-2 px-2 py-1.5 rounded text-xs font-mono truncate transition-colors ${
                              selectedTestPath === t.path ? "bg-muted" : "hover:bg-muted/50"
                            }`}
                          >
                            <TestTube2 className="h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
                            <span className="truncate">{t.path}</span>
                            {t.framework && (
                              <span className="ml-auto text-[10px] text-muted-foreground shrink-0">{t.framework}</span>
                            )}
                          </button>
                        </li>
                      ))}
                    </ul>
                  </ScrollArea>
                  <div className="flex-1 min-w-0 overflow-auto">
                    {selectedTest ? (
                      <ScrollArea className="h-full">
                        <pre className="text-xs font-mono p-4 whitespace-pre overflow-x-auto">
                          {selectedTest.testCode || "(empty)"}
                        </pre>
                      </ScrollArea>
                    ) : (
                      <div className="h-full flex items-center justify-center text-sm text-muted-foreground p-4">
                        Select a test file from the left to view its code.
                      </div>
                    )}
                  </div>
                </div>
              )}
            </TabsContent>
            {/* Tab 3: Migration Report */}
            {migrationReportMarkdown && (
              <TabsContent value="report" className="flex-1 min-h-0 flex flex-col mt-0 px-0">
                <ScrollArea className="flex-1">
                  <div className="p-6 prose prose-sm dark:prose-invert max-w-none">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{migrationReportMarkdown}</ReactMarkdown>
                  </div>
                </ScrollArea>
              </TabsContent>
            )}
          </Tabs>
        </DialogContent>
      </Dialog>
    </>
  );
}
