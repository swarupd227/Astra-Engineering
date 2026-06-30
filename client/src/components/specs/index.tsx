import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { BackButton } from "@/components/ui/back-button";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { getApiUrl } from "@/lib/api-config";
import { Download } from "lucide-react";
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@/components/ui/resizable";

import { persistSpecsJob, clearSpecsJob, loadSpecsJob } from "./utils";
import type {
  DevelopmentSpecsModalProps,
  GeneratedFile,
  SpecsArchitectureStyle,
  SpecsDeliveryOrder,
} from "./types";
import { useBacklogData } from "./use-backlog-data";
import { useRepoSync } from "./use-repo-sync";
import { useSpecsGeneration } from "./use-specs-generation";
import { useSpecsFiles } from "./use-specs-files";
import { usePushToAdo } from "./use-push-to-ado";
import { usePushToGit } from "./use-push-to-git";
import { ArtifactsPanel } from "./artifacts-panel";
import { FileTreePanel } from "./file-tree-panel";
import { PreviewPanel } from "./preview-panel";
import { ValidationDialog } from "./validation-dialog";
import { PushDialog } from "./push-dialog";
import { LoadingSkeleton } from "./loading-skeleton";

export function DevelopmentSpecsModal({
  projectId,
  adoProject,
  open,
  onClose,
  integrationType,
}: DevelopmentSpecsModalProps) {
  const { toast } = useToast();

  // ── Shared UI state ────────────────────────────────────────────────────────
  const [selectedFeatureIds, setSelectedFeatureIds] = useState<Set<number>>(() => new Set());
  const [selectedStoryIds, setSelectedStoryIds] = useState<Set<number>>(() => new Set());
  const [generatedFiles, setGeneratedFiles] = useState<GeneratedFile[]>([]);
  const [expandedFeatures, setExpandedFeatures] = useState<Set<number>>(() => new Set());
  const [selectedFileId, setSelectedFileId] = useState<string | null>(null);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(() => new Set(["specs"]));
  const [isPreviewExpanded, setIsPreviewExpanded] = useState(false);
  const [generatedFeatureIds, setGeneratedFeatureIds] = useState<Set<number>>(() => new Set());
  const [pushedFeatureIds, setPushedFeatureIds] = useState<Set<number>>(() => new Set());
  const [selectedIterationPath, setSelectedIterationPath] = useState("");
  const [artifactSearchQuery, setArtifactSearchQuery] = useState("");
  const [artifactGeneratedFilter, setArtifactGeneratedFilter] = useState<"all" | "generated" | "not-generated">("all");
  const [fileTreeSearchQuery, setFileTreeSearchQuery] = useState("");
  const [isDownloadingZip, setIsDownloadingZip] = useState(false);
  const [isDownloadingBundle, setIsDownloadingBundle] = useState(false);
  const [showMissingGoldenRepoDialog, setShowMissingGoldenRepoDialog] = useState(false);
  const [showGoldenRepoSetupDialog, setShowGoldenRepoSetupDialog] = useState(false);
  const [copiedPreview, setCopiedPreview] = useState(false);
  const [isPushDialogOpen, setIsPushDialogOpen] = useState(false);
  const [pushScope, setPushScope] = useState<"selected" | "all">("selected");
  const [pushRepoId, setPushRepoId] = useState("");
  const [pushBranch, setPushBranch] = useState("");
  const [pushBasePath, setPushBasePath] = useState("specs");
  const [enableTdd, setEnableTdd] = useState(false);
  const [specsArchitectureStyle, setSpecsArchitectureStyle] = useState<SpecsArchitectureStyle | null>(null);
  const [specsDeliveryOrder, setSpecsDeliveryOrder] = useState<SpecsDeliveryOrder | null>(null);
  const [repoFileContent, setRepoFileContent] = useState<string | null>(null);
  const [isLoadingRepoContent, setIsLoadingRepoContent] = useState(false);
  const [recentlyAddedFeatureIds, setRecentlyAddedFeatureIds] = useState<Set<number>>(() => new Set());
  const [alreadyPushedIncludeIds, setAlreadyPushedIncludeIds] = useState<Set<string>>(new Set());
  const [latestGeneratedFileIds, setLatestGeneratedFileIds] = useState<Set<string>>(() => new Set());
  const [selectedPushFileIds, setSelectedPushFileIds] = useState<Set<string>>(() => new Set());

  const diffLocalRef = useRef<HTMLDivElement>(null);
  const diffRepoRef = useRef<HTMLDivElement>(null);
  const diffSyncingRef = useRef(false);

  // ── ADO data & feature hierarchy ──────────────────────────────────────────
  const {
    adoRepos, isLoadingRepos, reposError,
    adoBranches, isLoadingBranches, branchesError,
    iterationsData,
    backlogData, isLoading,
    queryString,
    featureNodes, orphanUserStories, epicNodes,
    filteredFeatureNodes, filteredOrphanUserStories,     allFeatureIds,
    specsGitProvider,
    usesGenericGitPush,
    usesAdoPush,
    isJiraProject,
  } = useBacklogData({
    projectId, adoProject, open, isPushDialogOpen,
    selectedIterationPath, artifactSearchQuery,
    artifactGeneratedFilter, generatedFeatureIds,
    pushRepoId, setPushRepoId,
    pushBranch, setPushBranch,
    integrationType,
  });

  const { data: projectDetails } = useQuery<{
    project?: {
      linkedGoldenRepoOrg?: string | null;
      linkedGoldenRepoProject?: string | null;
      goldenRepoReference?: { repoId?: string; repoName?: string; filePaths?: string[] } | null;
      golden_repo_reference?: { repoId?: string; repoName?: string; filePaths?: string[] } | null;
    };
  }>({
    queryKey: ["/api/sdlc/projects", projectId, "details", "specs-modal"],
    queryFn: async () => {
      const res = await fetch(getApiUrl(`/api/sdlc/projects/${projectId}/details`), {
        credentials: "include",
      });
      if (!res.ok) return {};
      return res.json();
    },
    enabled: open && !!projectId,
    staleTime: 60 * 1000,
  });

  const linkedGoldenRepoLabel = useMemo(() => {
    const project = projectDetails?.project;
    const ref = project?.goldenRepoReference || project?.golden_repo_reference;
    const repoName = ref?.repoName || ref?.repoId;
    const org = project?.linkedGoldenRepoOrg || "";
    const proj = project?.linkedGoldenRepoProject || "";
    if (!repoName) return "Not linked";
    const scope = [org, proj].filter(Boolean).join("/");
    return scope ? `${scope}: ${repoName}` : repoName;
  }, [projectDetails]);

  // ── File loading + backfill effects ──────────────────────────────────────
  const { isLoadingSpecsFiles } = useSpecsFiles({
    projectId, open, backlogData,
    generatedFilesLength: generatedFiles.length,
    onFilesLoaded: (files, featureIds, pushedIds, enableTddFlag, architectureStyle, deliveryOrder) => {
      if (featureIds.size > 0) { setGeneratedFeatureIds(featureIds); setPushedFeatureIds(pushedIds); }
      if (files.length > 0) setGeneratedFiles(files);
      if (enableTddFlag !== undefined) setEnableTdd(enableTddFlag);
      if (architectureStyle) setSpecsArchitectureStyle(architectureStyle);
      if (deliveryOrder) setSpecsDeliveryOrder(deliveryOrder);
    },
  });

  // ── Repo sync ─────────────────────────────────────────────────────────────
  const {
    syncStatus, isSyncing,
    runRepoSync,
    handlePullFromRepo, handleDiscardLocal,
    handleDiscardFolder, handlePullFolder, handleDiscardAllLocal,
  } = useRepoSync({
    projectId, adoProject, pushRepoId, adoRepos,
    open, isLoadingSpecsFiles, generatedFiles,
    onFilesReloaded: (files, featureIds, pushedIds) => {
      setGeneratedFiles(files);
      setGeneratedFeatureIds(featureIds);
      setPushedFeatureIds(pushedIds);
    },
    onFileDiscarded: (fileId) => setGeneratedFiles((prev) => prev.filter((f) => f.id !== fileId)),
    onFilesDiscarded: (ids) => setGeneratedFiles((prev) => prev.filter((f) => !ids.has(f.id))),
    onFileSelected: setSelectedFileId,
  });

  // ── Specs generation ──────────────────────────────────────────────────────
  const {
    isGenerating, setIsGenerating,
    isValidating,
    specsProgress, setSpecsProgress,
    specsProcessedFeatures, setSpecsProcessedFeatures,
    specsTotalFeatures, setSpecsTotalFeatures,
    specsCurrentStep, setSpecsCurrentStep,
    specsJobId, setSpecsJobId,
    specsPollingTimeoutRef,
    validationResult, showValidationDialog, setShowValidationDialog,
    skipIdempotent, setSkipIdempotent,
    pendingFeatures, removedAutoAddedIds, setRemovedAutoAddedIds,
    pollSpecsJobStatus, generateSpecsForFeatures, handleGenerate,
  } = useSpecsGeneration({
    projectId,
    enableTdd,
    specsArchitectureStyle: specsArchitectureStyle ?? "monolith",
    specsDeliveryOrder:
      specsArchitectureStyle === "microservices"
        ? (specsDeliveryOrder ?? "ui-first")
        : "ui-first",
    featureNodes,
    orphanUserStories,
    selectedFeatureIds, selectedStoryIds, syncStatus,
    adoRepos, adoProject, pushRepoId, integrationType,
    onFilesGenerated: (newFiles, newFeatureIds) => {
      setGeneratedFiles((prev) => [
        ...prev.filter((f) => !newFeatureIds.has(f.featureId)),
        ...newFiles,
      ]);
      setLatestGeneratedFileIds(new Set(newFiles.map((f) => f.id)));
      setGeneratedFeatureIds((prev) => {
        const next = new Set(prev);
        newFeatureIds.forEach((id) => next.add(id));
        return next;
      });
      setPushedFeatureIds((prev) => {
        const next = new Set(prev);
        newFeatureIds.forEach((id) => next.delete(id));
        return next;
      });
    },
    onFileSelected: setSelectedFileId,
    onFoldersExpanded: (featureIds) => {
      setExpandedFolders((prev) => {
        const next = new Set(prev);
        next.add("specs");
        featureIds.forEach((id) => next.add(`feature-${id}`));
        return next;
      });
    },
    onRecentlyAdded: (featureIds) => {
      if (featureIds.length === 0) {
        setRecentlyAddedFeatureIds(new Set());
      } else {
        setRecentlyAddedFeatureIds((prev) => {
          const next = new Set(prev);
          featureIds.forEach((id) => next.add(id));
          return next;
        });
      }
    },
    onGenerationComplete: (files, featureIds, pushedIds) => {
      setGeneratedFiles(files);
      setLatestGeneratedFileIds(new Set(files.map((f) => f.id)));
      setGeneratedFeatureIds(featureIds);
      setPushedFeatureIds(pushedIds);
    },
    runRepoSync,
  });

  // ── Reset on close ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!open) {
      setSelectedFeatureIds(new Set());
      setSelectedStoryIds(new Set());
      setGeneratedFiles([]);
      setLatestGeneratedFileIds(new Set());
      setSelectedPushFileIds(new Set());
      setExpandedFeatures(new Set());
      setSelectedFileId(null);
      setSelectedIterationPath("");
      setArtifactSearchQuery("");
      setArtifactGeneratedFilter("all");
      setFileTreeSearchQuery("");
      setSpecsJobId(null);
      setSpecsProgress(null);
      setSpecsProcessedFeatures(0);
      setSpecsTotalFeatures(0);
      setSpecsArchitectureStyle(null);
      setSpecsDeliveryOrder(null);
      if (specsPollingTimeoutRef.current) {
        clearTimeout(specsPollingTimeoutRef.current);
        specsPollingTimeoutRef.current = null;
      }
    }
  }, [open]);

  useEffect(() => {
    if (!isPushDialogOpen || pushScope !== "all") return;
    const latestBatchFiles = generatedFiles.filter((f) => latestGeneratedFileIds.size === 0 || latestGeneratedFileIds.has(f.id));
    setSelectedPushFileIds(new Set(latestBatchFiles.filter((f) => !f.pushedToAdo).map((f) => f.id)));
    setAlreadyPushedIncludeIds(new Set());
  }, [isPushDialogOpen, pushScope, generatedFiles, latestGeneratedFileIds]);

  useEffect(() => {
    if (!open || !projectId || !specsArchitectureStyle) return;
    if (specsArchitectureStyle === "microservices" && !specsDeliveryOrder) return;
    const controller = new AbortController();
    const timeout = setTimeout(async () => {
      try {
        await fetch(getApiUrl(`/api/sdlc/projects/${projectId}/specs/preferences`), {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          signal: controller.signal,
          body: JSON.stringify({
            enableTdd,
            specsArchitectureStyle,
            specsDeliveryOrder:
              specsArchitectureStyle === "microservices" ? specsDeliveryOrder : null,
          }),
        });
      } catch {
        // keep local UI responsive even if save fails
      }
    }, 300);

    return () => {
      controller.abort();
      clearTimeout(timeout);
    };
  }, [open, projectId, enableTdd, specsArchitectureStyle, specsDeliveryOrder]);

  // ── Resume in-flight job on open ──────────────────────────────────────────
  useEffect(() => {
    if (!open || !projectId || specsJobId) return;
    const saved = loadSpecsJob(projectId);
    if (!saved?.jobId) return;
    setIsGenerating(true);
    setSpecsJobId(saved.jobId);
    if (!specsPollingTimeoutRef.current) {
      specsPollingTimeoutRef.current = setTimeout(() => void pollSpecsJobStatus(saved.jobId), 500);
    }
  }, [open, projectId, specsJobId]);

  // ── Fetch repo content for diff view ─────────────────────────────────────
  const selectedFile = useMemo(
    () => generatedFiles.find((f) => f.id === selectedFileId) || null,
    [generatedFiles, selectedFileId],
  );

  useEffect(() => {
    if (!selectedFile) { setRepoFileContent(null); return; }
    const filePath = selectedFile.path.startsWith("/") ? selectedFile.path.slice(1) : selectedFile.path;
    const fileSyncInfo = syncStatus.get(filePath);
    if (!fileSyncInfo || (fileSyncInfo.status !== "conflict" && fileSyncInfo.status !== "modified-in-repo")) {
      setRepoFileContent(null); return;
    }
    const repoId = pushRepoId || adoRepos[0]?.id;
    if (!repoId || !adoProject?.organization || !adoProject?.name) { setRepoFileContent(null); return; }

    let cancelled = false;
    setIsLoadingRepoContent(true);
    (async () => {
      try {
        const params = new URLSearchParams();
        params.set("path", filePath);
        params.set("repositoryId", repoId);
        params.set("organization", adoProject!.organization);
        params.set("projectName", adoProject!.name);
        const res = await fetch(
          getApiUrl(`/api/sdlc/projects/${projectId}/specs/repo-file?${params.toString()}`),
          { credentials: "include" },
        );
        if (!cancelled && res.ok) {
          const data = await res.json();
          setRepoFileContent(data.content || null);
        }
      } catch {
        if (!cancelled) setRepoFileContent(null);
      } finally {
        if (!cancelled) setIsLoadingRepoContent(false);
      }
    })();
    return () => { cancelled = true; };
  }, [selectedFile, selectedFileId, syncStatus, pushRepoId, adoRepos, adoProject, projectId]);

  // ── Selection handlers ────────────────────────────────────────────────────
  const selectedAll =
    (allFeatureIds.length > 0 || filteredOrphanUserStories.length > 0) &&
    allFeatureIds.every((id) => selectedFeatureIds.has(id)) &&
    filteredOrphanUserStories.every((s) => selectedStoryIds.has(s.id));

  const handleToggleFeature = (featureId: number) => {
    const feature = featureNodes.find((f) => f.id === featureId);
    if (feature) {
      const childIds = feature.userStories.map((s) => s.id);
      const allChildrenSelected = childIds.length > 0 && childIds.every((id) => selectedStoryIds.has(id));
      if (selectedFeatureIds.has(featureId) && allChildrenSelected) {
        setSelectedFeatureIds((prev) => { const n = new Set(prev); n.delete(featureId); return n; });
        setSelectedStoryIds((prev) => { const n = new Set(prev); childIds.forEach((id) => n.delete(id)); return n; });
      } else {
        setSelectedFeatureIds((prev) => { const n = new Set(prev); n.add(featureId); return n; });
        setSelectedStoryIds((prev) => { const n = new Set(prev); childIds.forEach((id) => n.add(id)); return n; });
      }
    } else {
      setSelectedFeatureIds((prev) => {
        const n = new Set(prev);
        if (n.has(featureId)) n.delete(featureId); else n.add(featureId);
        return n;
      });
    }
    setExpandedFeatures((prev) => { const n = new Set(prev); n.add(featureId); return n; });
  };

  const handleToggleEpic = (features: Array<{ id: number; userStories: Array<{ id: number }> }>) => {
    const featureIds = features.map((feature) => feature.id);
    const storyIds = features.flatMap((feature) => feature.userStories.map((story) => story.id));
    const allSelected =
      featureIds.length > 0 &&
      featureIds.every((id) => selectedFeatureIds.has(id)) &&
      storyIds.every((id) => selectedStoryIds.has(id));

    setSelectedFeatureIds((previous) => {
      const next = new Set(previous);
      featureIds.forEach((id) => {
        if (allSelected) next.delete(id);
        else next.add(id);
      });
      return next;
    });
    setSelectedStoryIds((previous) => {
      const next = new Set(previous);
      storyIds.forEach((id) => {
        if (allSelected) next.delete(id);
        else next.add(id);
      });
      return next;
    });
    if (!allSelected) {
      setExpandedFeatures((previous) => {
        const next = new Set(previous);
        featureIds.forEach((id) => next.add(id));
        return next;
      });
    }
  };

  const handleToggleStory = (_featureId: number, storyId: number) => {
    setSelectedStoryIds((prev) => {
      const n = new Set(prev);
      if (n.has(storyId)) n.delete(storyId); else n.add(storyId);
      return n;
    });
  };

  const handleSelectAll = () => {
    setSelectedFeatureIds(new Set(allFeatureIds));
    setSelectedStoryIds(new Set([
      ...filteredFeatureNodes.flatMap((f) => f.userStories.map((s) => s.id)),
      ...filteredOrphanUserStories.map((s) => s.id),
    ]));
    setExpandedFeatures(new Set(allFeatureIds));
  };

  const handleDeselectAll = () => {
    setSelectedFeatureIds(new Set());
    setSelectedStoryIds(new Set());
  };

  // ── ZIP download ──────────────────────────────────────────────────────────
  const handleDownloadAllAsZip = async () => {
    if (!projectId) return;
    if (generatedFiles.length === 0) {
      toast({ title: "Nothing to download", description: "Generate specs and requirements before downloading the ZIP archive." });
      return;
    }
    setIsDownloadingZip(true);
    try {
      const resp = await fetch(getApiUrl(`/api/sdlc/projects/${projectId}/specs/export-zip`), {
        method: "GET", credentials: "include",
      });
      if (!resp.ok) {
        const text = await resp.text();
        throw new Error(text || `Failed to download ZIP archive (${resp.status})`);
      }
      const blob = await resp.blob();
      const disposition = resp.headers.get("Content-Disposition") || "";
      const match = disposition.match(/filename="?([^"]+)"?/i);
      const filename = match?.[1] || `specs-${projectId}.zip`;
      const urlObject = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = urlObject; link.download = filename;
      document.body.appendChild(link); link.click(); document.body.removeChild(link);
      URL.revokeObjectURL(urlObject);
    } catch (error) {
      toast({
        title: "ZIP download failed",
        description: error instanceof Error ? error.message : "An unexpected error occurred.",
        variant: "destructive",
      });
    } finally {
      setIsDownloadingZip(false);
    }
  };

  const downloadPluginBundle = async (includeWithoutGoldenRepo: boolean) => {
    if (!projectId) return;
    setIsDownloadingBundle(true);

    try {
      const params = new URLSearchParams();
      if (includeWithoutGoldenRepo) {
        params.set("includeWithoutGoldenRepo", "true");
      }
      const response = await fetch(
        getApiUrl(
          `/api/sdlc/projects/${projectId}/specs-to-code/download-bundle${params.toString() ? `?${params.toString()}` : ""}`,
        ),
        { method: "GET", credentials: "include" },
      );

      if (response.status === 409) {
        setShowMissingGoldenRepoDialog(true);
        return;
      }

      if (!response.ok) {
        const message = await response.text();
        throw new Error(message || `Failed to download plugin bundle (${response.status})`);
      }

      const blob = await response.blob();
      const disposition = response.headers.get("Content-Disposition") || "";
      const match = disposition.match(/filename="?([^"]+)"?/i);
      const filename = match?.[1] || `specs-to-code-bundle-${projectId}.zip`;
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (error) {
      toast({
        title: "Bundle download failed",
        description: error instanceof Error ? error.message : "An unexpected error occurred.",
        variant: "destructive",
      });
    } finally {
      setIsDownloadingBundle(false);
    }
  };

  // ── Push to ADO ───────────────────────────────────────────────────────────
  const { isPushing, handlePushToAdo } = usePushToAdo({
    projectId, adoProject, queryString, generatedFiles, latestGeneratedFileIds,
    onPushComplete: (pushedFileIds, pushedFeatureIdSet) => {
      setPushedFeatureIds((prev) => { const n = new Set(prev); pushedFeatureIdSet.forEach((id) => n.add(id)); return n; });
      if (pushedFileIds.length > 0) {
        const now = new Date().toISOString();
        setGeneratedFiles((prev) => prev.map((f) => pushedFileIds.includes(f.id) ? { ...f, pushedToAdo: true, pushedToAdoAt: now } : f));
      }
    },
    onDialogClose: () => setIsPushDialogOpen(false),
    runRepoSync,
  });

  const { isPushing: isPushingGit, handlePushToGit } = usePushToGit({
    projectId, generatedFiles, latestGeneratedFileIds,
    onPushComplete: (pushedFileIds, pushedFeatureIdSet) => {
      setPushedFeatureIds((prev) => { const n = new Set(prev); pushedFeatureIdSet.forEach((id) => n.add(id)); return n; });
      if (pushedFileIds.length > 0) {
        const now = new Date().toISOString();
        setGeneratedFiles((prev) => prev.map((f) => pushedFileIds.includes(f.id) ? { ...f, pushedToAdo: true, pushedToAdoAt: now } : f));
      }
    },
    onDialogClose: () => setIsPushDialogOpen(false),
    runRepoSync,
  });

  const isJira = isJiraProject;

  // ── Layout ────────────────────────────────────────────────────────────────
  return (
    <>
      <div className="flex flex-col h-full bg-background overflow-hidden min-w-0 w-full max-w-full">
        <div className="flex items-center gap-3 px-4 py-3 border-b min-w-0 shrink-0">
          <BackButton label="Back to SDLC" onClick={onClose} />
          <div className="flex flex-col min-w-0 overflow-hidden">
            <span className="font-semibold text-sm truncate">Development Specs Generator</span>
            <span className="text-xs text-muted-foreground truncate">
              {adoProject?.organization && adoProject?.name
                ? `${adoProject.organization} / ${adoProject.name}`
                : integrationType === "jira"
                  ? "Generate specs and requirements checklists from Jira work items."
                  : "Generate feature-level specs and requirements checklists from Azure DevOps Features and User Stories."}
            </span>
          </div>
          <div className="ml-auto shrink-0">
            <Button
              size="sm"
              variant="outline"
              className="gap-2"
              disabled={isDownloadingBundle}
              onClick={() => void downloadPluginBundle(false)}
            >
              <Download className="h-4 w-4" />
              {isDownloadingBundle ? "Preparing..." : "Download Plugin Bundle"}
            </Button>
          </div>
        </div>

        <div className="flex-1 min-h-0 flex flex-col px-4 pb-3 pt-3 overflow-hidden min-w-0 max-w-full">
          {isLoading ? (
            <LoadingSkeleton />
          ) : isPreviewExpanded && selectedFile ? (
            <div className="flex-1 min-h-0 pr-2 pb-2 overflow-hidden flex flex-col">
              <PreviewPanel {...previewProps()} />
            </div>
          ) : (
            <ResizablePanelGroup direction="horizontal" className="min-h-0 flex-1 pr-2 pb-2 gap-0 min-w-0 w-full max-w-full overflow-hidden" style={{ minWidth: 0 }}>
              <ResizablePanel defaultSize={20} minSize={15} maxSize={40} className="min-w-0">
                <div className="h-full flex flex-col min-h-0 overflow-hidden pr-2 min-w-0">
                  <FileTreePanel
                    generatedFiles={generatedFiles}
                    featureNodes={featureNodes}
                    isLoadingSpecsFiles={isLoadingSpecsFiles}
                    selectedFileId={selectedFileId}
                    setSelectedFileId={setSelectedFileId}
                    expandedFolders={expandedFolders}
                    setExpandedFolders={setExpandedFolders}
                    fileTreeSearchQuery={fileTreeSearchQuery}
                    setFileTreeSearchQuery={setFileTreeSearchQuery}
                    syncStatus={syncStatus}
                    recentlyAddedFeatureIds={recentlyAddedFeatureIds}
                    isSyncing={isSyncing}
                    isDownloadingZip={isDownloadingZip}
                    isPushing={usesGenericGitPush ? isPushingGit : isPushing}
                    isGenerating={isGenerating}
                    runRepoSync={runRepoSync}
                    handleDownloadAllAsZip={handleDownloadAllAsZip}
                    handleDiscardAllLocal={handleDiscardAllLocal}
                    handlePullFolder={handlePullFolder}
                    handleDiscardFolder={handleDiscardFolder}
                    handlePullFromRepo={handlePullFromRepo}
                    handleDiscardLocal={handleDiscardLocal}
                    setPushScope={setPushScope}
                    setIsPushDialogOpen={setIsPushDialogOpen}
                    integrationType={integrationType}
                  />
                </div>
              </ResizablePanel>
              <ResizableHandle withHandle className="bg-border" />
              <ResizablePanel defaultSize={80} minSize={50} className="min-w-0 overflow-hidden">
                <div className="h-full min-h-0 overflow-hidden flex flex-col">
                  {selectedFile ? (
                    <PreviewPanel {...previewProps()} />
                  ) : (
                    <div className="h-full min-h-0 overflow-hidden flex flex-col gap-3">
                      <div className="rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex items-center gap-2 font-medium text-foreground">
                            <span>DevOps Artifacts</span>
                            <span className="text-muted-foreground/70">|</span>
                            <span className="text-muted-foreground">BRD Documents</span>
                          </div>
                          <div className="truncate text-right">
                            <span className="font-medium text-foreground">Golden Repo:</span>{" "}
                            <span className="text-muted-foreground">{linkedGoldenRepoLabel}</span>
                          </div>
                        </div>
                      </div>
                      <div className="flex-1 min-h-0 overflow-hidden">
                        <ArtifactsPanel
                          epicNodes={epicNodes}
                          featureNodes={featureNodes}
                          orphanUserStories={orphanUserStories}
                          filteredFeatureNodes={filteredFeatureNodes}
                          filteredOrphanUserStories={filteredOrphanUserStories}
                          selectedFeatureIds={selectedFeatureIds}
                          selectedStoryIds={selectedStoryIds}
                          setSelectedStoryIds={setSelectedStoryIds}
                          expandedFeatures={expandedFeatures}
                          setExpandedFeatures={setExpandedFeatures}
                          generatedFeatureIds={generatedFeatureIds}
                          pushedFeatureIds={pushedFeatureIds}
                          isLoading={isLoading}
                          isGenerating={isGenerating}
                          isValidating={isValidating}
                          enableTdd={enableTdd}
                          setEnableTdd={setEnableTdd}
                          specsArchitectureStyle={specsArchitectureStyle}
                          setSpecsArchitectureStyle={setSpecsArchitectureStyle}
                          specsDeliveryOrder={specsDeliveryOrder}
                          setSpecsDeliveryOrder={setSpecsDeliveryOrder}
                          specsProgress={specsProgress}
                          specsTotalFeatures={specsTotalFeatures}
                          specsProcessedFeatures={specsProcessedFeatures}
                          specsCurrentStep={specsCurrentStep}
                          selectedAll={selectedAll}
                          artifactSearchQuery={artifactSearchQuery}
                          setArtifactSearchQuery={setArtifactSearchQuery}
                          selectedIterationPath={selectedIterationPath}
                          setSelectedIterationPath={setSelectedIterationPath}
                          artifactGeneratedFilter={artifactGeneratedFilter}
                          setArtifactGeneratedFilter={setArtifactGeneratedFilter}
                          iterationsData={iterationsData}
                          projectId={projectId}
                          specsPollingTimeoutRef={specsPollingTimeoutRef}
                          setIsGenerating={setIsGenerating}
                          setSpecsJobId={setSpecsJobId}
                          setSpecsProgress={setSpecsProgress}
                          setSpecsProcessedFeatures={setSpecsProcessedFeatures}
                          setSpecsTotalFeatures={setSpecsTotalFeatures}
                          setSpecsCurrentStep={setSpecsCurrentStep}
                          handleToggleEpic={handleToggleEpic}
                          handleToggleFeature={handleToggleFeature}
                          handleToggleStory={handleToggleStory}
                          handleSelectAll={handleSelectAll}
                          handleDeselectAll={handleDeselectAll}
                          handleGenerate={handleGenerate}
                          clearSpecsJob={clearSpecsJob}
                          toast={toast}
                          integrationType={integrationType}
                        />
                      </div>
                    </div>
                  )}
                </div>
              </ResizablePanel>
            </ResizablePanelGroup>
          )}
        </div>
      </div>

      <ValidationDialog
        showValidationDialog={showValidationDialog}
        setShowValidationDialog={setShowValidationDialog}
        validationResult={validationResult}
        pendingFeatures={pendingFeatures}
        removedAutoAddedIds={removedAutoAddedIds}
        setRemovedAutoAddedIds={setRemovedAutoAddedIds}
        skipIdempotent={skipIdempotent}
        setSkipIdempotent={setSkipIdempotent}
        generateSpecsForFeatures={generateSpecsForFeatures}
      />

      <PushDialog
        isPushDialogOpen={isPushDialogOpen}
        setIsPushDialogOpen={setIsPushDialogOpen}
        pushScope={pushScope}
        selectedFile={selectedFile}
        pushRepoId={pushRepoId}
        setPushRepoId={setPushRepoId}
        setPushBranch={setPushBranch}
        isLoadingRepos={isLoadingRepos}
        adoRepos={adoRepos}
        reposError={reposError}
        isLoadingBranches={isLoadingBranches}
        branchesError={branchesError}
        adoBranches={adoBranches}
        pushBranch={pushBranch}
        pushBasePath={pushBasePath}
        setPushBasePath={setPushBasePath}
        isPushing={usesGenericGitPush ? isPushingGit : isPushing}
        generatedFiles={generatedFiles}
        latestBatchFiles={generatedFiles.filter((f) => latestGeneratedFileIds.size === 0 || latestGeneratedFileIds.has(f.id))}
        selectedPushFileIds={selectedPushFileIds}
        setSelectedPushFileIds={setSelectedPushFileIds}
        alreadyPushedIncludeIds={alreadyPushedIncludeIds}
        setAlreadyPushedIncludeIds={setAlreadyPushedIncludeIds}
        handlePushToAdo={() =>
          handlePushToAdo({ pushRepoId, pushBranch, pushBasePath, pushScope, selectedFileId, selectedPushFileIds, alreadyPushedIncludeIds })
        }
        usesGenericGitPush={usesGenericGitPush}
        specsGitProvider={specsGitProvider}
        projectId={projectId}
        handlePushToGit={() => {
          const selectedRepo = adoRepos.find((r: { id: string }) => String(r.id) === String(pushRepoId));
          handlePushToGit({
            pushBranch,
            pushBasePath,
            pushScope,
            selectedFileId,
            selectedPushFileIds,
            alreadyPushedIncludeIds,
            pushRepoId,
            repoName: selectedRepo?.name,
          });
        }}
      />

      <Dialog
        open={showMissingGoldenRepoDialog}
        onOpenChange={setShowMissingGoldenRepoDialog}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Golden repo not linked</DialogTitle>
            <DialogDescription>
              Golden repo is not linked for this project. Do you want to continue without it?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setShowMissingGoldenRepoDialog(false);
                setShowGoldenRepoSetupDialog(true);
              }}
            >
              No
            </Button>
            <Button
              onClick={() => {
                setShowMissingGoldenRepoDialog(false);
                void downloadPluginBundle(true);
              }}
            >
              Yes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={showGoldenRepoSetupDialog}
        onOpenChange={setShowGoldenRepoSetupDialog}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Configure golden repo</DialogTitle>
            <DialogDescription>
              To include golden repo in the bundle, link it to this project from project setup:
              choose the golden repository and save the project configuration.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button onClick={() => setShowGoldenRepoSetupDialog(false)}>
              I have read this
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );

  // ── Helper to build PreviewPanel props (avoids repetition) ───────────────
  function previewProps() {
    return {
      selectedFile: selectedFile!,
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
    };
  }
}
