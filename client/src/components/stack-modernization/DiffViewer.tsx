import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { 
  FileCode, 
  ChevronDown, 
  ChevronRight, 
  Download, 
  CheckCircle2,
  AlertTriangle,
  Info,
  GitCompare
} from "lucide-react";

interface ModifiedFile {
  path: string;
  content: string;
  originalContent: string;
  changes: Array<{
    package: string;
    oldVersion: string;
    newVersion: string;
    description: string;
  }>;
}

interface DiffViewerProps {
  files: ModifiedFile[];
  summary?: {
    totalFilesModified: number;
    totalPackagesUpgraded: number;
    success: boolean;
  };
}

export function DiffViewer({ files, summary }: DiffViewerProps) {
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set());
  const [selectedFile, setSelectedFile] = useState<string | null>(files[0]?.path || null);

  const toggleFile = (path: string) => {
    const newExpanded = new Set(expandedFiles);
    if (newExpanded.has(path)) {
      newExpanded.delete(path);
    } else {
      newExpanded.add(path);
    }
    setExpandedFiles(newExpanded);
  };

  const generateUnifiedDiff = (original: string, modified: string, filename: string): string => {
    const originalLines = original.split('\n');
    const modifiedLines = modified.split('\n');
    
    let diff = `--- ${filename} (original)\n`;
    diff += `+++ ${filename} (modified)\n`;
    diff += `@@ -1,${originalLines.length} +1,${modifiedLines.length} @@\n`;
    
    // Simple line-by-line diff
    const maxLines = Math.max(originalLines.length, modifiedLines.length);
    for (let i = 0; i < maxLines; i++) {
      const origLine = originalLines[i];
      const modLine = modifiedLines[i];
      
      if (origLine === modLine) {
        diff += ` ${origLine || ''}\n`;
      } else {
        if (origLine !== undefined) {
          diff += `-${origLine}\n`;
        }
        if (modLine !== undefined) {
          diff += `+${modLine}\n`;
        }
      }
    }
    
    return diff;
  };

  const calculateStats = (file: ModifiedFile) => {
    const originalLines = file.originalContent.split('\n');
    const modifiedLines = file.content.split('\n');
    
    let additions = 0;
    let deletions = 0;
    
    // Simple diff stats
    const maxLines = Math.max(originalLines.length, modifiedLines.length);
    for (let i = 0; i < maxLines; i++) {
      const origLine = originalLines[i];
      const modLine = modifiedLines[i];
      
      if (origLine !== modLine) {
        if (origLine !== undefined) deletions++;
        if (modLine !== undefined) additions++;
      }
    }
    
    return { additions, deletions };
  };

  const downloadDiff = (file: ModifiedFile) => {
    const diff = generateUnifiedDiff(file.originalContent, file.content, file.path);
    const blob = new Blob([diff], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${file.path.replace(/\//g, '_')}.diff`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const downloadAllDiffs = () => {
    let allDiffs = '';
    for (const file of files) {
      allDiffs += generateUnifiedDiff(file.originalContent, file.content, file.path);
      allDiffs += '\n\n';
    }
    
    const blob = new Blob([allDiffs], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'upgrade-changes.diff';
    a.click();
    URL.revokeObjectURL(url);
  };

  if (files.length === 0) {
    return (
      <Alert>
        <Info className="h-4 w-4" />
        <AlertTitle>No Changes</AlertTitle>
        <AlertDescription>
          No files were modified during the upgrade process.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-4">
      {/* Summary */}
      {summary && (
        <Card className="border-l-4 border-l-primary">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <CheckCircle2 className="h-5 w-5 text-green-500" />
                  Upgrade Complete
                </CardTitle>
                <CardDescription className="mt-2">
                  Modified {summary.totalFilesModified} file{summary.totalFilesModified !== 1 ? 's' : ''} • 
                  Upgraded {summary.totalPackagesUpgraded} package{summary.totalPackagesUpgraded !== 1 ? 's' : ''}
                </CardDescription>
              </div>
              <Button onClick={downloadAllDiffs} variant="outline">
                <Download className="h-4 w-4 mr-2" />
                Download All Diffs
              </Button>
            </div>
          </CardHeader>
        </Card>
      )}

      {/* File List & Diff Viewer */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <GitCompare className="h-5 w-5" />
            File Changes
          </CardTitle>
          <CardDescription>
            Review code changes and package upgrades
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 gap-4">
            {/* File Tree */}
            <div className="col-span-1 border-r pr-4">
              <ScrollArea className="h-[600px]">
                <div className="space-y-1">
                  {files.map((file) => {
                    const stats = calculateStats(file);
                    const isSelected = selectedFile === file.path;
                    
                    return (
                      <div
                        key={file.path}
                        className={`
                          p-2 rounded cursor-pointer hover:bg-accent
                          ${isSelected ? 'bg-accent' : ''}
                        `}
                        onClick={() => setSelectedFile(file.path)}
                      >
                        <div className="flex items-start gap-2">
                          <FileCode className="h-4 w-4 mt-0.5 flex-shrink-0 text-muted-foreground" />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-mono truncate">{file.path}</p>
                            <div className="flex items-center gap-2 mt-1">
                              <Badge variant="outline" className="text-xs">
                                <span className="text-green-600">+{stats.additions}</span>
                                <span className="mx-1">/</span>
                                <span className="text-red-600">-{stats.deletions}</span>
                              </Badge>
                              {file.changes.length > 0 && (
                                <Badge variant="secondary" className="text-xs">
                                  {file.changes.length} pkg{file.changes.length !== 1 ? 's' : ''}
                                </Badge>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </ScrollArea>
            </div>

            {/* Diff Display */}
            <div className="col-span-2">
              {selectedFile && (() => {
                const file = files.find(f => f.path === selectedFile);
                if (!file) return null;

                return (
                  <div className="space-y-4">
                    {/* File Header */}
                    <div className="flex items-center justify-between">
                      <div>
                        <h4 className="font-mono text-sm font-semibold">{file.path}</h4>
                        {file.changes.length > 0 && (
                          <div className="flex flex-wrap gap-2 mt-2">
                            {file.changes.map((change, idx) => (
                              <Badge key={idx} variant="outline" className="font-mono text-xs">
                                {change.package}: {change.oldVersion} → {change.newVersion}
                              </Badge>
                            ))}
                          </div>
                        )}
                      </div>
                      <Button onClick={() => downloadDiff(file)} variant="outline" size="sm">
                        <Download className="h-3 w-3 mr-1" />
                        Download
                      </Button>
                    </div>

                    {/* Tabbed View: Side-by-side vs Unified */}
                    <Tabs defaultValue="sidebyside" className="w-full">
                      <TabsList>
                        <TabsTrigger value="sidebyside">Side by Side</TabsTrigger>
                        <TabsTrigger value="unified">Unified Diff</TabsTrigger>
                      </TabsList>

                      <TabsContent value="sidebyside" className="mt-4">
                        <div className="grid grid-cols-2 gap-2 border rounded-lg">
                          {/* Original */}
                          <div className="border-r">
                            <div className="bg-muted px-3 py-2 font-semibold text-sm border-b">
                              Original
                            </div>
                            <ScrollArea className="h-[500px]">
                              <pre className="p-4 text-xs font-mono">
                                <code>{file.originalContent}</code>
                              </pre>
                            </ScrollArea>
                          </div>

                          {/* Modified */}
                          <div>
                            <div className="bg-primary/10 px-3 py-2 font-semibold text-sm border-b">
                              Modified
                            </div>
                            <ScrollArea className="h-[500px]">
                              <pre className="p-4 text-xs font-mono">
                                <code>{file.content}</code>
                              </pre>
                            </ScrollArea>
                          </div>
                        </div>
                      </TabsContent>

                      <TabsContent value="unified" className="mt-4">
                        <ScrollArea className="h-[500px] border rounded-lg">
                          <pre className="p-4 text-xs font-mono bg-muted/30">
                            <code>
                              {generateUnifiedDiff(file.originalContent, file.content, file.path)}
                            </code>
                          </pre>
                        </ScrollArea>
                      </TabsContent>
                    </Tabs>
                  </div>
                );
              })()}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
