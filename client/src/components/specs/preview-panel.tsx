import { useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Check,
  Copy,
  Download,
  GitBranch,
  Loader2,
  Maximize2,
  Minimize2,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { useJiraOnlyWorkItems } from "@/hooks/use-hosting-config";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import { AiEnhanceWithDiff } from "@/components/AiEnhanceWithDiff";
import { syncStatusConfig } from "./types";
import type { GeneratedFile, SyncFileStatus, ADOProject } from "./types";

export interface PreviewPanelProps {
  selectedFile: GeneratedFile | null;
  isLoadingSpecsFiles: boolean;
  isPreviewExpanded: boolean;
  setIsPreviewExpanded: React.Dispatch<React.SetStateAction<boolean>>;
  setSelectedFileId: (id: string | null) => void;
  repoFileContent: string | null;
  isLoadingRepoContent: boolean;
  syncStatus: Map<string, SyncFileStatus>;
  isGenerating: boolean;
  specsProgress: number | null;
  specsTotalFeatures: number;
  specsProcessedFeatures: number;
  diffLocalRef: React.RefObject<HTMLDivElement>;
  diffRepoRef: React.RefObject<HTMLDivElement>;
  diffSyncingRef: React.MutableRefObject<boolean>;
  copiedPreview: boolean;
  setCopiedPreview: (v: boolean) => void;
  setGeneratedFiles: React.Dispatch<React.SetStateAction<GeneratedFile[]>>;
  handleDiscardLocal: (fileId: string) => void;
  handlePullFromRepo: (paths: string[]) => void;
  setPushScope: (scope: "selected" | "all") => void;
  setAlreadyPushedIncludeIds: React.Dispatch<React.SetStateAction<Set<string>>>;
  setIsPushDialogOpen: (open: boolean) => void;
  pushRepoId: string;
  adoRepos: any[];
  projectId: string;
  adoProject?: ADOProject;
}

export function PreviewPanel({
  selectedFile,
  isLoadingSpecsFiles,
  isPreviewExpanded,
  setIsPreviewExpanded,
  setSelectedFileId,
  repoFileContent,
  isLoadingRepoContent,
  syncStatus,
  isGenerating,
  specsProgress,
  specsTotalFeatures,
  specsProcessedFeatures,
  diffLocalRef,
  diffRepoRef,
  diffSyncingRef,
  copiedPreview,
  setCopiedPreview,
  setGeneratedFiles,
  handleDiscardLocal,
  handlePullFromRepo,
  setPushScope,
  setAlreadyPushedIncludeIds,
  setIsPushDialogOpen,
  pushRepoId,
  adoRepos,
  projectId,
  adoProject,
}: PreviewPanelProps) {
  const { toast } = useToast();
  const jiraOnly = useJiraOnlyWorkItems();
  const platformName = jiraOnly ? "GitHub" : "Azure DevOps";

  if (isLoadingSpecsFiles && !selectedFile) {
    return (
      <Card className="h-full overflow-hidden flex flex-col bg-card">
        <CardHeader className="pb-2 flex-shrink-0 flex items-center justify-between gap-2">
          <CardTitle className="text-sm">Preview</CardTitle>
        </CardHeader>
        <CardContent className="pt-6 flex-1 flex items-center justify-center">
          <div className="flex flex-col items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
            <span>Loading specs content...</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!selectedFile) {
    return (
      <Card className="h-full overflow-hidden flex flex-col bg-card">
        <CardHeader className="pb-2 flex-shrink-0">
          <div className="flex items-center justify-between gap-2">
            <CardTitle className="text-sm">Preview</CardTitle>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 p-0"
              onClick={() => setIsPreviewExpanded((v) => !v)}
              title={
                isPreviewExpanded ? "Collapse preview" : "Expand preview"
              }
            >
              {isPreviewExpanded ? (
                <Minimize2 className="h-4 w-4" />
              ) : (
                <Maximize2 className="h-4 w-4" />
              )}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="pt-4 flex-1 min-h-0">
          <p className="text-xs text-muted-foreground">
            Click on any generated <code>.md</code> file in the tree to
            preview its content here.
          </p>
        </CardContent>
      </Card>
    );
  }

  const handleDownloadSelectedFile = () => {
    if (!selectedFile) return;

    try {
      const blob = new Blob([selectedFile.content], {
        type: "text/markdown;charset=utf-8",
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = selectedFile.fileName || "spec.md";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error(
        "[DevelopmentSpecsModal] Failed to download file locally:",
        error,
      );
      toast({
        title: "Download failed",
        description:
          error instanceof Error
            ? error.message
            : "An unexpected error occurred while downloading the file.",
        variant: "destructive",
      });
    }
  };

  const handleCopy = async () => {
    if (!selectedFile) return;

    try {
      await navigator.clipboard.writeText(selectedFile.content);
      setCopiedPreview(true);
      toast({
        title: "Copied to clipboard",
        description: `${selectedFile.fileName} content has been copied.`,
      });
      setTimeout(() => setCopiedPreview(false), 2000);
    } catch (error) {
      console.error("[DevelopmentSpecsModal] Failed to copy content:", error);
      toast({
        title: "Copy failed",
        description:
          "Could not copy content to clipboard. Please try again or copy manually.",
        variant: "destructive",
      });
    }
  };

  const openPushDialogForSelected = () => {
    if (!selectedFile) {
      toast({
        title: "No file selected",
        description:
          `Select a spec or requirements file before pushing to ${platformName}.`,
      });
      return;
    }
    setPushScope("selected");
    setAlreadyPushedIncludeIds(new Set());
    setIsPushDialogOpen(true);
  };

  return (
    <Card className="h-full overflow-hidden flex flex-col bg-card">
      <CardHeader className="pb-2 flex-shrink-0">
        <div className="flex items-center justify-between gap-2">
          <div className="flex flex-col gap-0.5 min-w-0">
            <CardTitle className="text-sm flex flex-col gap-1">
              <span className="truncate">{selectedFile.fileName}</span>
              <span className="text-xs font-normal text-muted-foreground truncate">
                {selectedFile.path}
              </span>
            </CardTitle>
            {isGenerating && (
              <span className="text-[11px] text-muted-foreground">
                Generating specs
                {specsTotalFeatures > 0
                  ? ` · ${specsProcessedFeatures}/${specsTotalFeatures} features`
                  : ""}
                {typeof specsProgress === "number"
                  ? ` · ${specsProgress.toFixed(0)}%`
                  : ""}
              </span>
            )}
            {(() => {
              const filePath = selectedFile.path.startsWith("/") ? selectedFile.path.slice(1) : selectedFile.path;
              const fileSyncInfo = syncStatus.get(filePath);
              if (!fileSyncInfo) return null;
              const cfg = syncStatusConfig[fileSyncInfo.status];
              const Icon = cfg.icon;
              return (
                <span className={cn("flex items-center gap-1 text-[11px] font-medium", cfg.color)}>
                  <Icon className="h-3 w-3" />
                  {cfg.label}
                </span>
              );
            })()}
          </div>
          <div className="flex items-center gap-1">
            {(() => {
              const filePath = selectedFile.path.startsWith("/") ? selectedFile.path.slice(1) : selectedFile.path;
              const fileSyncInfo = syncStatus.get(filePath);
              if (!fileSyncInfo) return null;
              if (fileSyncInfo.status === "local-only" || fileSyncInfo.status === "modified-locally") {
                return (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 gap-1.5 text-xs text-destructive border-destructive/40 hover:bg-destructive/10"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (window.confirm("Discard this local file? This cannot be undone.")) {
                        handleDiscardLocal(selectedFile.id);
                      }
                    }}
                  >
                    <X className="h-3.5 w-3.5" />
                    Discard
                  </Button>
                );
              }
              if (fileSyncInfo.status === "modified-in-repo" || fileSyncInfo.status === "repo-only" || fileSyncInfo.status === "conflict") {
                const isConflict = fileSyncInfo.status === "conflict";
                return (
                  <>
                    {isConflict && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 gap-1.5 text-xs text-blue-600 border-blue-500/40 hover:bg-blue-500/10"
                        onClick={async (e) => {
                          e.stopPropagation();
                          // Keep local = push local version to repo
                          const repoId = pushRepoId || adoRepos[0]?.id;
                          if (!repoId) return;
                          setPushScope("selected");
                          setIsPushDialogOpen(true);
                        }}
                      >
                        <ArrowUpFromLine className="h-3.5 w-3.5" />
                        Keep Local
                      </Button>
                    )}
                    <Button
                      variant="outline"
                      size="sm"
                      className={cn(
                        "h-7 gap-1.5 text-xs",
                        isConflict
                          ? "text-red-600 border-red-500/40 hover:bg-red-500/10"
                          : "text-orange-600 border-orange-500/40 hover:bg-orange-500/10",
                      )}
                      onClick={(e) => {
                        e.stopPropagation();
                        e.preventDefault();
                        handlePullFromRepo([filePath]);
                      }}
                    >
                      <ArrowDownToLine className="h-3.5 w-3.5" />
                      {isConflict ? "Accept Repo" : "Pull"}
                    </Button>
                  </>
                );
              }
              return null;
            })()}
            <Button
              variant="outline"
              size="icon"
              className="h-7 w-7 p-0"
              onClick={handleDownloadSelectedFile}
              title="Download this file"
            >
              <Download className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="h-7 w-7 p-0"
              onClick={openPushDialogForSelected}
              title={`Push this file to ${platformName} Git`}
            >
              <GitBranch className="h-4 w-4" />
            </Button>
            <AiEnhanceWithDiff
              value={selectedFile.content}
              locationKey="brd.field"
              onEnhanced={(enhancedText) => {
                setGeneratedFiles((prev) =>
                  prev.map((file) =>
                    file.id === selectedFile.id
                      ? { ...file, content: enhancedText }
                      : file,
                  ),
                );
              }}
              itemName={
                selectedFile.type === "requirements"
                  ? "Requirements checklist"
                  : "Specification"
              }
              buttonSize="sm"
              buttonVariant="outline"
              className="ml-1"
            />
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 p-0"
              onClick={() => void handleCopy()}
              title="Copy content to clipboard"
            >
              {copiedPreview ? (
                <Check className="h-4 w-4" />
              ) : (
                <Copy className="h-4 w-4" />
              )}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 p-0"
              onClick={() => setIsPreviewExpanded((v) => !v)}
              title={
                isPreviewExpanded ? "Collapse preview" : "Expand preview"
              }
            >
              {isPreviewExpanded ? (
                <Minimize2 className="h-4 w-4" />
              ) : (
                <Maximize2 className="h-4 w-4" />
              )}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 p-0"
              onClick={() => {
                setSelectedFileId(null);
                setIsPreviewExpanded(false);
              }}
              title="Close preview"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-2 flex-1 min-h-0 overflow-hidden flex flex-col">
        {repoFileContent !== null && !isLoadingRepoContent ? (
          /* Side-by-side diff view with line highlighting */
          (() => {
            const localLines = selectedFile.content.replace(/\r\n/g, "\n").split("\n");
            const repoLines = repoFileContent.replace(/\r\n/g, "\n").split("\n");
            const maxLines = Math.max(localLines.length, repoLines.length);

            // Build a simple line-by-line diff
            const diffLines: Array<{
              localLine: string;
              repoLine: string;
              status: "same" | "modified" | "added" | "removed";
            }> = [];

            for (let i = 0; i < maxLines; i++) {
              const local = i < localLines.length ? localLines[i] : undefined;
              const repo = i < repoLines.length ? repoLines[i] : undefined;

              if (local === repo) {
                diffLines.push({ localLine: local ?? "", repoLine: repo ?? "", status: "same" });
              } else if (local !== undefined && repo !== undefined) {
                diffLines.push({ localLine: local, repoLine: repo, status: "modified" });
              } else if (local !== undefined) {
                diffLines.push({ localLine: local, repoLine: "", status: "removed" });
              } else {
                diffLines.push({ localLine: "", repoLine: repo ?? "", status: "added" });
              }
            }

            return (
              <div className="flex-1 min-h-0 flex gap-0 overflow-hidden border rounded-md">
                {/* Local version */}
                <div className="flex-1 min-w-0 flex flex-col border-r">
                  <div className="flex items-center gap-2 px-3 py-1.5 bg-blue-500/10 border-b text-xs font-medium text-blue-700 dark:text-blue-300 shrink-0">
                    <ArrowUpFromLine className="h-3 w-3" />
                    Local (yours)
                  </div>
                  <div
                    ref={diffLocalRef}
                    className="flex-1 min-h-0 overflow-auto"
                    onScroll={() => {
                      if (diffSyncingRef.current) return;
                      diffSyncingRef.current = true;
                      if (diffLocalRef.current && diffRepoRef.current) {
                        diffRepoRef.current.scrollTop = diffLocalRef.current.scrollTop;
                        diffRepoRef.current.scrollLeft = diffLocalRef.current.scrollLeft;
                      }
                      diffSyncingRef.current = false;
                    }}
                  >
                    <pre className="text-xs font-mono p-0 m-0">
                      {diffLines.map((line, i) => (
                        <div
                          key={`local-${i}`}
                          className={cn(
                            "px-3 py-0.5 min-h-[1.375rem] whitespace-pre-wrap break-all",
                            line.status === "modified" && "bg-blue-500/15",
                            line.status === "removed" && "bg-red-500/15",
                            line.status === "added" && "bg-transparent opacity-30",
                          )}
                        >
                          <span className="text-muted-foreground/40 inline-block w-8 text-right mr-2 select-none">{i + 1}</span>
                          {line.localLine}
                        </div>
                      ))}
                    </pre>
                  </div>
                </div>
                {/* Repo version */}
                <div className="flex-1 min-w-0 flex flex-col">
                  <div className="flex items-center gap-2 px-3 py-1.5 bg-orange-500/10 border-b text-xs font-medium text-orange-700 dark:text-orange-300 shrink-0">
                    <ArrowDownToLine className="h-3 w-3" />
                    Remote (repo)
                  </div>
                  <div
                    ref={diffRepoRef}
                    className="flex-1 min-h-0 overflow-auto"
                    onScroll={() => {
                      if (diffSyncingRef.current) return;
                      diffSyncingRef.current = true;
                      if (diffLocalRef.current && diffRepoRef.current) {
                        diffLocalRef.current.scrollTop = diffRepoRef.current.scrollTop;
                        diffLocalRef.current.scrollLeft = diffRepoRef.current.scrollLeft;
                      }
                      diffSyncingRef.current = false;
                    }}
                  >
                    <pre className="text-xs font-mono p-0 m-0">
                      {diffLines.map((line, i) => (
                        <div
                          key={`repo-${i}`}
                          className={cn(
                            "px-3 py-0.5 min-h-[1.375rem] whitespace-pre-wrap break-all",
                            line.status === "modified" && "bg-orange-500/15",
                            line.status === "added" && "bg-green-500/15",
                            line.status === "removed" && "bg-transparent opacity-30",
                          )}
                        >
                          <span className="text-muted-foreground/40 inline-block w-8 text-right mr-2 select-none">{i + 1}</span>
                          {line.repoLine}
                        </div>
                      ))}
                    </pre>
                  </div>
                </div>
              </div>
            );
          })()
        ) : isLoadingRepoContent ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading repo version for comparison...
            </div>
          </div>
        ) : (
          /* Normal preview */
          <ScrollArea className="flex-1 min-h-0">
            <div className="prose prose-sm dark:prose-invert max-w-none">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                rehypePlugins={[rehypeRaw]}
              >
                {selectedFile.content}
              </ReactMarkdown>
            </div>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}
