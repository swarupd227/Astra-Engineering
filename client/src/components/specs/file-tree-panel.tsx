import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  ArrowDownToLine,
  ChevronRight,
  ChevronDown,
  Download,
  FileText,
  FolderTree,
  ListChecks,
  Loader2,
  RefreshCw,
  Search,
  Upload,
  X,
} from "lucide-react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { sanitizeSlug } from "./utils";
import { syncStatusConfig } from "./types";
import type { FeatureNode, GeneratedFile, SyncFileStatus, SyncStatusType } from "./types";

export interface FileTreePanelProps {
  generatedFiles: GeneratedFile[];
  featureNodes: FeatureNode[];
  isLoadingSpecsFiles: boolean;
  selectedFileId: string | null;
  setSelectedFileId: (id: string | null) => void;
  expandedFolders: Set<string>;
  setExpandedFolders: React.Dispatch<React.SetStateAction<Set<string>>>;
  fileTreeSearchQuery: string;
  setFileTreeSearchQuery: (v: string) => void;
  syncStatus: Map<string, SyncFileStatus>;
  recentlyAddedFeatureIds: Set<number>;
  isSyncing: boolean;
  isDownloadingZip: boolean;
  isPushing: boolean;
  isGenerating: boolean;
  runRepoSync: () => void;
  handleDownloadAllAsZip: () => void;
  handleDiscardAllLocal: () => void;
  handlePullFolder: (featureId: number) => void;
  handleDiscardFolder: (featureId: number) => void;
  handlePullFromRepo: (paths: string[]) => void;
  handleDiscardLocal: (fileId: string) => void;
  setPushScope: (scope: "selected" | "all") => void;
  setIsPushDialogOpen: (open: boolean) => void;
  integrationType?: string;
}

export function FileTreePanel({
  generatedFiles,
  featureNodes,
  isLoadingSpecsFiles,
  selectedFileId,
  setSelectedFileId,
  expandedFolders,
  setExpandedFolders,
  fileTreeSearchQuery,
  setFileTreeSearchQuery,
  syncStatus,
  recentlyAddedFeatureIds,
  isSyncing,
  isDownloadingZip,
  isPushing,
  isGenerating,
  runRepoSync,
  handleDownloadAllAsZip,
  handleDiscardAllLocal,
  handlePullFolder,
  handleDiscardFolder,
  handlePullFromRepo,
  handleDiscardLocal,
  setPushScope,
  setIsPushDialogOpen,
  integrationType,
}: FileTreePanelProps) {
  const isJira = integrationType === "jira";
  if (isLoadingSpecsFiles) {
    return (
      <Card className="h-full">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <FolderTree className="h-4 w-4 text-muted-foreground" />
            Loading generated files...
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-4 flex items-center justify-center">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>Fetching existing specs and requirements from server.</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!generatedFiles.length) {
    return (
      <Card className="h-full">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <ListChecks className="h-4 w-4 text-muted-foreground" />
            Generated Specs &amp; Requirements
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-4">
          <p className="text-xs text-muted-foreground">
            No files generated yet. Select one or more {isJira ? "work items" : "Features"} and click{" "}
            <strong>Generate</strong> to create markdown specs and
            requirements checklists.
          </p>
        </CardContent>
      </Card>
    );
  }

  // Include real features that have generated files, plus virtual entries for orphan user stories (featureId < 0)
  const realFeaturesWithFiles = featureNodes.filter((f) =>
    generatedFiles.some((g) => g.featureId === f.id),
  );
  const orphanFeatureIds = [
    ...new Set(
      generatedFiles
        .map((g) => g.featureId)
        .filter((id) => !featureNodes.some((f) => f.id === id)),
    ),
  ];
  const virtualFeaturesForOrphans: Pick<FeatureNode, "id" | "title">[] =
    orphanFeatureIds.map((id) => {
      const file = generatedFiles.find((g) => g.featureId === id);
      return {
        id,
        title: file?.featureTitle ?? `User Story ${id}`,
      };
    });
  const featuresWithFiles: Array<Pick<FeatureNode, "id" | "title">> = [
    ...realFeaturesWithFiles,
    ...virtualFeaturesForOrphans,
  ].sort((a, b) => {
    // .devx (featureId 0) always first
    if (a.id === 0) return -1;
    if (b.id === 0) return 1;
    return 0;
  });

  const fileTreeQuery = fileTreeSearchQuery.trim().toLowerCase();
  const filteredFeaturesWithFiles = fileTreeQuery
    ? featuresWithFiles.filter((f) =>
        (f.title || "").toLowerCase().includes(fileTreeQuery),
      )
    : featuresWithFiles;

  const folderCount = featuresWithFiles.length;
  const fileCount = generatedFiles.length;

  return (
    <Card className="h-full min-w-0 overflow-hidden flex flex-col">
      <CardHeader className="pb-1 min-w-0 flex-shrink-0">
        <CardTitle className="text-sm flex items-center justify-between gap-2">
          <span className="flex items-center gap-2 min-w-0">
            <FolderTree className="h-4 w-4 text-muted-foreground shrink-0" />
            <span className="truncate min-w-0">Specs File Tree</span>
          </span>
          <span className="flex items-center gap-1.5 shrink-0">
            <span className="text-[11px] text-muted-foreground">
              {folderCount} folder{folderCount === 1 ? "" : "s"} · {fileCount}{" "}
              file{fileCount === 1 ? "" : "s"}
            </span>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={() => void handleDownloadAllAsZip()}
              disabled={isDownloadingZip || generatedFiles.length === 0}
              title="Download all (.zip)"
            >
              <Download className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={runRepoSync}
              disabled={isSyncing}
              title="Sync with repo"
            >
              <RefreshCw className={cn("h-3.5 w-3.5", isSyncing && "animate-spin")} />
            </Button>
            {(() => {
              const discardableCount = generatedFiles.filter((f) => {
                const p = f.path.startsWith("/") ? f.path.slice(1) : f.path;
                const s = syncStatus.get(p);
                return !s || s.status === "local-only" || s.status === "modified-locally";
              }).length;
              return discardableCount > 0 ? (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 text-destructive hover:text-destructive hover:bg-destructive/10"
                  onClick={() => void handleDiscardAllLocal()}
                  title={`Discard all local changes (${discardableCount} file${discardableCount === 1 ? "" : "s"})`}
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              ) : null;
            })()}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0 min-w-0 flex-1 min-h-0 flex flex-col">
        <div className="relative mb-2 w-full min-w-0">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
          <Input
            placeholder="Search folder name..."
            value={fileTreeSearchQuery}
            onChange={(e) => setFileTreeSearchQuery(e.target.value)}
            className="h-8 pl-8 text-xs w-full min-w-0"
          />
        </div>
        <ScrollArea className="flex-1 min-h-0">
          <div className="pt-2 pr-3 text-xs">
            {/* Root folder: specs */}
            <div className="space-y-1">
              <button
                type="button"
                onClick={() =>
                  setExpandedFolders((prev) => {
                    const next = new Set(prev);
                    if (next.has("specs")) {
                      next.delete("specs");
                    } else {
                      next.add("specs");
                    }
                    return next;
                  })
                }
                className="w-full flex items-center gap-2 px-2 py-1 rounded-md hover:bg-accent text-foreground"
              >
                {expandedFolders.has("specs") ? (
                  <ChevronDown className="h-3.5 w-3.5 flex-shrink-0" />
                ) : (
                  <ChevronRight className="h-3.5 w-3.5 flex-shrink-0" />
                )}
                <FolderTree className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
                <span className="font-semibold truncate">specs</span>
              </button>

              {expandedFolders.has("specs") && (
                <div className="ml-5 space-y-1">
                  {filteredFeaturesWithFiles.length === 0 && fileTreeQuery ? (
                    <p className="py-2 text-muted-foreground text-xs">
                      No folders match your search.
                    </p>
                  ) : (
                    filteredFeaturesWithFiles.map((feature) => {
                      const slug = feature.id === 0 ? ".devx" : sanitizeSlug(feature.title);
                      const folderKey = `feature-${feature.id}`;
                      const featureFiles = generatedFiles.filter(
                        (f) => f.featureId === feature.id,
                      );
                      const isFolderExpanded = expandedFolders.has(folderKey);

                      // Compute aggregate sync status for the folder
                      const folderFileStatuses = featureFiles.map((f) => {
                        const p = f.path.startsWith("/") ? f.path.slice(1) : f.path;
                        return syncStatus.get(p)?.status;
                      }).filter(Boolean) as SyncStatusType[];

                      // Priority: conflict > modified-in-repo > modified-locally > local-only > repo-only > in-sync
                      const folderSyncStatus: SyncStatusType | null =
                        folderFileStatuses.length === 0
                          ? null
                          : folderFileStatuses.includes("conflict")
                            ? "conflict"
                            : folderFileStatuses.includes("modified-in-repo")
                              ? "modified-in-repo"
                              : folderFileStatuses.includes("modified-locally")
                                ? "modified-locally"
                                : folderFileStatuses.includes("local-only")
                                  ? "local-only"
                                  : folderFileStatuses.includes("repo-only")
                                    ? "repo-only"
                                    : "in-sync";

                      const folderColorMap: Record<SyncStatusType, string> = {
                        "in-sync": "",
                        "modified-locally": "bg-blue-500/10 border-l-[3px] border-l-blue-500",
                        "modified-in-repo": "bg-orange-500/10 border-l-[3px] border-l-orange-500",
                        "conflict": "bg-red-500/10 border-l-[3px] border-l-red-500",
                        "local-only": "bg-amber-500/10 border-l-[3px] border-l-amber-500",
                        "repo-only": "bg-purple-500/10 border-l-[3px] border-l-purple-500",
                      };

                      const isRecentlyAdded = recentlyAddedFeatureIds.has(feature.id);

                      const folderHasPullable = folderFileStatuses.some(
                        (s) => s === "modified-in-repo" || s === "conflict" || s === "repo-only",
                      );
                      const folderHasDiscardable = folderFileStatuses.some(
                        (s) => s === "local-only" || s === "modified-locally",
                      ) || folderFileStatuses.length === 0;

                      return (
                        <div
                          key={feature.id}
                          className={cn(
                            "space-y-1",
                            isRecentlyAdded && "animate-in slide-in-from-left-5 fade-in duration-500",
                          )}
                        >
                          <ContextMenu>
                            <ContextMenuTrigger asChild>
                              <button
                                type="button"
                                onClick={() =>
                                  setExpandedFolders((prev) => {
                                    const next = new Set(prev);
                                    if (next.has(folderKey)) {
                                      next.delete(folderKey);
                                    } else {
                                      next.add(folderKey);
                                    }
                                    return next;
                                  })
                                }
                                className={cn(
                                  "w-full flex items-center gap-2 px-2 py-1 rounded-md hover:bg-accent text-foreground",
                                  folderSyncStatus && folderColorMap[folderSyncStatus],
                                )}
                              >
                                {isFolderExpanded ? (
                                  <ChevronDown className="h-3 w-3 flex-shrink-0" />
                                ) : (
                                  <ChevronRight className="h-3 w-3 flex-shrink-0" />
                                )}
                                <FolderTree className="h-3 w-3 flex-shrink-0 text-muted-foreground" />
                                <span className="truncate">{slug}</span>
                              </button>
                            </ContextMenuTrigger>
                            <ContextMenuContent>
                              {folderHasPullable && (
                                <ContextMenuItem onClick={() => void handlePullFolder(feature.id)}>
                                  <ArrowDownToLine className="h-3.5 w-3.5 mr-2 text-orange-500" />
                                  Pull all from repo
                                </ContextMenuItem>
                              )}
                              {folderHasDiscardable && (
                                <>
                                  {folderHasPullable && <ContextMenuSeparator />}
                                  <ContextMenuItem
                                    className="text-destructive focus:text-destructive"
                                    onClick={() => void handleDiscardFolder(feature.id)}
                                  >
                                    <X className="h-3.5 w-3.5 mr-2" />
                                    Discard local changes
                                  </ContextMenuItem>
                                </>
                              )}
                            </ContextMenuContent>
                          </ContextMenu>

                          {isFolderExpanded && (
                            <div className="ml-5 space-y-1">
                              {feature.id === 0 ? (() => {
                                type DevxTreeNode = {
                                  folders: Map<string, DevxTreeNode>;
                                  files: GeneratedFile[];
                                };

                                const makeNode = (): DevxTreeNode => ({ folders: new Map(), files: [] });
                                const root = makeNode();

                                for (const file of featureFiles) {
                                  const relativePath = (file.path || "")
                                    .replace(/^\/?specs\/\.devx\/?/, "")
                                    .replace(/^\/+/, "");
                                  const parts = relativePath.split("/").filter(Boolean);
                                  if (!parts.length) continue;
                                  let node = root;
                                  for (let i = 0; i < parts.length - 1; i++) {
                                    const part = parts[i];
                                    if (!node.folders.has(part)) node.folders.set(part, makeNode());
                                    node = node.folders.get(part)!;
                                  }
                                  node.files.push(file);
                                }

                                const renderFile = (file: GeneratedFile) => {
                                  const isActive = selectedFileId === file.id;
                                  const fileSyncInfo = syncStatus.get(file.path.startsWith("/") ? file.path.slice(1) : file.path);
                                  const syncCfg = fileSyncInfo ? syncStatusConfig[fileSyncInfo.status] : null;
                                  const SyncIcon = syncCfg?.icon;
                                  return (
                                    <button
                                      key={file.id}
                                      type="button"
                                      onClick={() => setSelectedFileId(file.id)}
                                      className={cn(
                                        "w-full text-left px-2 py-1 rounded-md flex items-center gap-2 transition-colors hover:bg-accent",
                                        isActive && "bg-primary/10 text-primary",
                                      )}
                                    >
                                      <FileText className="h-3.5 w-3.5 flex-shrink-0" />
                                      <span className="truncate flex-1">{file.fileName}</span>
                                      {SyncIcon && (
                                        <span title={syncCfg!.label}>
                                          <SyncIcon className={cn("h-3 w-3 flex-shrink-0", syncCfg!.color)} />
                                        </span>
                                      )}
                                    </button>
                                  );
                                };

                                const renderNode = (node: DevxTreeNode, trail: string[] = []) => {
                                  const folderEntries = [...node.folders.entries()].sort(([a], [b]) => a.localeCompare(b));
                                  const filesSorted = [...node.files].sort((a, b) => a.fileName.localeCompare(b.fileName));

                                  return (
                                    <div className="space-y-1">
                                      {folderEntries.map(([folderName, child]) => {
                                        const folderTrail = [...trail, folderName];
                                        const nestedFolderKey = `devx-${folderTrail.join("/")}`;
                                        const isNestedExpanded = expandedFolders.has(nestedFolderKey);
                                        return (
                                          <div key={nestedFolderKey} className="space-y-1">
                                            <button
                                              type="button"
                                              onClick={() =>
                                                setExpandedFolders((prev) => {
                                                  const next = new Set(prev);
                                                  if (next.has(nestedFolderKey)) {
                                                    next.delete(nestedFolderKey);
                                                  } else {
                                                    next.add(nestedFolderKey);
                                                  }
                                                  return next;
                                                })
                                              }
                                              className="w-full text-left px-2 py-1 rounded-md flex items-center gap-2 transition-colors hover:bg-accent"
                                            >
                                              {isNestedExpanded ? (
                                                <ChevronDown className="h-3 w-3 flex-shrink-0" />
                                              ) : (
                                                <ChevronRight className="h-3 w-3 flex-shrink-0" />
                                              )}
                                              <FolderTree className="h-3 w-3 flex-shrink-0 text-muted-foreground" />
                                              <span className="truncate">{folderName}</span>
                                            </button>
                                            {isNestedExpanded && (
                                              <div className="ml-4 space-y-1">
                                                {renderNode(child, folderTrail)}
                                              </div>
                                            )}
                                          </div>
                                        );
                                      })}
                                      {filesSorted.map(renderFile)}
                                    </div>
                                  );
                                };

                                return renderNode(root);
                              })() : featureFiles.map((file) => {
                                const isActive = selectedFileId === file.id;
                                const isFileUnpushed = folderSyncStatus === "local-only";
                                const fileSyncInfo = syncStatus.get(file.path.startsWith("/") ? file.path.slice(1) : file.path);
                                const syncCfg = fileSyncInfo ? syncStatusConfig[fileSyncInfo.status] : null;
                                const SyncIcon = syncCfg?.icon;
                                const fileStatus = fileSyncInfo?.status;
                                const fileCanDiscard = !fileStatus || fileStatus === "local-only" || fileStatus === "modified-locally";
                                const fileCanPull = fileStatus === "modified-in-repo" || fileStatus === "conflict" || fileStatus === "repo-only";
                                return (
                                  <ContextMenu key={file.id}>
                                    <ContextMenuTrigger asChild>
                                      <button
                                        type="button"
                                        onClick={() => setSelectedFileId(file.id)}
                                        className={cn(
                                          "w-full text-left px-2 py-1 rounded-md flex items-center gap-2 transition-colors",
                                          isActive
                                            ? "bg-primary/10 text-primary"
                                            : isFileUnpushed
                                              ? "text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/10"
                                              : "hover:bg-accent",
                                        )}
                                      >
                                        <FileText className={cn("h-3.5 w-3.5 flex-shrink-0", isFileUnpushed && !isActive && "text-emerald-500")} />
                                        <span className="truncate flex-1">
                                          {(() => {
                                            const parts = file.path.split("/");
                                            if (parts.length >= 2 && file.fileName === "SKILL.md") {
                                              return `${parts[parts.length - 2]}/SKILL.md`;
                                            }
                                            return file.fileName;
                                          })()}
                                        </span>
                                        {SyncIcon && (
                                          <span title={syncCfg!.label}>
                                            <SyncIcon
                                              className={cn("h-3 w-3 flex-shrink-0", syncCfg!.color)}
                                            />
                                          </span>
                                        )}
                                      </button>
                                    </ContextMenuTrigger>
                                    <ContextMenuContent>
                                      <ContextMenuItem onClick={() => setSelectedFileId(file.id)}>
                                        <FileText className="h-3.5 w-3.5 mr-2 text-muted-foreground" />
                                        Preview
                                      </ContextMenuItem>
                                      {fileCanPull && (
                                        <>
                                          <ContextMenuSeparator />
                                          <ContextMenuItem
                                            onClick={() => {
                                              const p = file.path.startsWith("/") ? file.path.slice(1) : file.path;
                                              void handlePullFromRepo([p]);
                                            }}
                                          >
                                            <ArrowDownToLine className="h-3.5 w-3.5 mr-2 text-orange-500" />
                                            Pull from repo
                                          </ContextMenuItem>
                                        </>
                                      )}
                                      {fileCanDiscard && (
                                        <>
                                          <ContextMenuSeparator />
                                          <ContextMenuItem
                                            className="text-destructive focus:text-destructive"
                                            onClick={() => {
                                              if (window.confirm("Discard this local file? This cannot be undone.")) {
                                                void handleDiscardLocal(file.id);
                                              }
                                            }}
                                          >
                                            <X className="h-3.5 w-3.5 mr-2" />
                                            Discard local file
                                          </ContextMenuItem>
                                        </>
                                      )}
                                    </ContextMenuContent>
                                  </ContextMenu>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              )}
            </div>
          </div>
        </ScrollArea>
      </CardContent>
      {generatedFiles.length > 0 && (
        <div className="p-3 border-t border-border flex-shrink-0">
          <Button
            size="sm"
            className="w-full gap-2 bg-primary text-primary-foreground hover:bg-primary/90"
            onClick={() => {
              setPushScope("all");
              setIsPushDialogOpen(true);
            }}
            disabled={isPushing || isGenerating}
          >
            <Upload className="h-3.5 w-3.5" />
            Push to Repo
          </Button>
        </div>
      )}
    </Card>
  );
}
