import { useRef, useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { getApiUrl } from "@/lib/api-config";
import { persistSpecsJob, clearSpecsJob, sanitizeSlug } from "./utils";
import type {
  ADOProject,
  FeatureNode,
  UserStoryNode,
  GeneratedFile,
  GeneratedFileType,
  SpecsArchitectureStyle,
  SpecsDeliveryOrder,
  ValidationResult,
  SyncFileStatus,
} from "./types";

interface UseSpecsGenerationParams {
  projectId: string;
  enableTdd: boolean;
  specsArchitectureStyle: SpecsArchitectureStyle;
  specsDeliveryOrder: SpecsDeliveryOrder;
  featureNodes: FeatureNode[];
  orphanUserStories: UserStoryNode[];
  selectedFeatureIds: Set<number>;
  selectedStoryIds: Set<number>;
  syncStatus: Map<string, SyncFileStatus>;
  adoRepos: any[];
  adoProject?: ADOProject;
  pushRepoId: string;
  integrationType?: string;
  /** Called when new files arrive mid-generation */
  onFilesGenerated: (
    files: GeneratedFile[],
    newFeatureIds: Set<number>,
  ) => void;
  onFileSelected: (id: string | null) => void;
  onFoldersExpanded: (featureIds: number[]) => void;
  onRecentlyAdded: (featureIds: number[]) => void;
  /** Called on job completion with the full reloaded file list */
  onGenerationComplete: (
    files: GeneratedFile[],
    featureIds: Set<number>,
    pushedIds: Set<number>,
  ) => void;
  runRepoSync: () => void;
}

function parseAllFiles(files: any[]): {
  parsed: GeneratedFile[];
  featureIds: Set<number>;
  pushedIds: Set<number>;
} {
  const featureIds = new Set<number>();
  const pushedIds = new Set<number>();
  const parsed: GeneratedFile[] = files.map((f: any) => {
    const fId =
      typeof f.featureId === "number"
        ? f.featureId
        : typeof f.feature_id === "number"
          ? f.feature_id
          : 0;
    const fTitle = f.featureTitle ?? f.feature_title ?? `Feature ${fId}`;
    const ftRaw = String(f.fileType ?? f.file_type ?? "specs").toLowerCase();
    const ft: GeneratedFileType =
      ftRaw === "requirements"
        ? "requirements"
        : ftRaw === "tdd-tests"
          ? "tdd-tests"
          : ftRaw === "devx-context"
            ? "devx-context"
            : ftRaw === "prompt"
              ? "prompt"
              : "specs";
    const fn = f.fileName ?? f.file_name ?? `${ft}.md`;
    const isPushed = f.pushedToAdo ?? f.pushed_to_ado ?? false;
    if (fId) featureIds.add(fId);
    if (isPushed) pushedIds.add(fId);
    return {
      id: f.id ?? `${fId}-${ft}`,
      featureId: fId,
      featureTitle: fTitle,
      type: ft,
      fileName: fn,
      path: f.path ?? `specs/${sanitizeSlug(fTitle)}/${fn}`,
      content: String(f.content ?? ""),
      pushedToAdo: isPushed,
      pushedToAdoAt: f.pushedToAdoAt ?? f.pushed_to_ado_at ?? null,
    };
  });
  return { parsed, featureIds, pushedIds };
}

export function useSpecsGeneration({
  projectId,
  enableTdd,
  specsArchitectureStyle,
  specsDeliveryOrder,
  featureNodes,
  orphanUserStories,
  selectedFeatureIds,
  selectedStoryIds,
  syncStatus,
  adoRepos,
  adoProject,
  pushRepoId,
  integrationType,
  onFilesGenerated,
  onFileSelected,
  onFoldersExpanded,
  onRecentlyAdded,
  onGenerationComplete,
  runRepoSync,
}: UseSpecsGenerationParams) {
  const { toast } = useToast();
  const isJira = integrationType === "jira";

  const [isGenerating, setIsGenerating] = useState(false);
  const [isValidating, setIsValidating] = useState(false);
  const [specsProgress, setSpecsProgress] = useState<number | null>(null);
  const [specsProcessedFeatures, setSpecsProcessedFeatures] = useState(0);
  const [specsTotalFeatures, setSpecsTotalFeatures] = useState(0);
  const [specsCurrentStep, setSpecsCurrentStep] = useState("");
  const [specsJobId, setSpecsJobId] = useState<string | null>(null);
  const specsPollingTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Validation dialog
  const [validationResult, setValidationResult] = useState<ValidationResult | null>(null);
  const [showValidationDialog, setShowValidationDialog] = useState(false);
  const [skipIdempotent, setSkipIdempotent] = useState(true);
  const [pendingFeatures, setPendingFeatures] = useState<
    Array<{ id: number; title: string; state: string; description?: string; userStories: UserStoryNode[] }>
  >([]);
  const [removedAutoAddedIds, setRemovedAutoAddedIds] = useState<Set<number>>(new Set());

  const stopPolling = () => {
    if (specsPollingTimeoutRef.current) {
      clearTimeout(specsPollingTimeoutRef.current);
      specsPollingTimeoutRef.current = null;
    }
  };

  const pollSpecsJobStatus = async (jobId: string): Promise<void> => {
    try {
      const url = getApiUrl(`/api/sdlc/specs/generate/status/${jobId}`);
      const resp = await fetch(url, { credentials: "include" });

      if (!resp.ok) {
        const errorData = await resp.json().catch(() => ({}));
        const errorMessage =
          (errorData as any)?.error || `Failed to fetch specs job status (${resp.status})`;
        stopPolling();
        setIsGenerating(false);
        setSpecsJobId(null);
        clearSpecsJob(projectId);

        toast({
          title: resp.status === 404 ? "Specs job not found" : "Failed to check specs generation status",
          description: resp.status === 404
            ? "Specs generation job not found. It may have expired."
            : errorMessage,
          variant: "destructive",
        });
        return;
      }

      const status = await resp.json();
      const result = (status as any).result;
      const filesFromServer: Array<{
        featureId: number;
        featureTitle: string;
        specsContent: string;
        requirementsContent: string;
        tddTestsContent?: string;
      }> = Array.isArray(result?.files) ? result.files : [];

      if (typeof (status as any).progress === "number") setSpecsProgress((status as any).progress);
      if (typeof (status as any).step === "string") setSpecsCurrentStep((status as any).step);
      if (typeof result?.processedFeatures === "number") setSpecsProcessedFeatures(result.processedFeatures);
      if (typeof result?.totalFeatures === "number") setSpecsTotalFeatures(result.totalFeatures);

      if (filesFromServer.length > 0) {
        const files: GeneratedFile[] = [];
        const newlyGeneratedFeatureIds = new Set<number>();

        filesFromServer.forEach((file) => {
          const slug = sanitizeSlug(file.featureTitle || `feature-${file.featureId}`);
          const basePath = `specs/${slug}`;

          files.push({
            id: `${basePath}/specs.md`,
            featureId: file.featureId,
            featureTitle: file.featureTitle,
            type: "specs",
            fileName: "specs.md",
            path: `${basePath}/specs.md`,
            content: file.specsContent,
          });
          files.push({
            id: `${basePath}/requirements.md`,
            featureId: file.featureId,
            featureTitle: file.featureTitle,
            type: "requirements",
            fileName: "requirements.md",
            path: `${basePath}/requirements.md`,
            content: file.requirementsContent,
          });
          if (file.tddTestsContent) {
            files.push({
              id: `${basePath}/tdd-tests.md`,
              featureId: file.featureId,
              featureTitle: file.featureTitle,
              type: "tdd-tests",
              fileName: "tdd-tests.md",
              path: `${basePath}/tdd-tests.md`,
              content: file.tddTestsContent,
            });
          }
          if (typeof file.featureId === "number") newlyGeneratedFeatureIds.add(file.featureId);
        });

        onFilesGenerated(files, newlyGeneratedFeatureIds);
        onFileSelected(null);

        const featureIdsArray = Array.from(newlyGeneratedFeatureIds);
        if (featureIdsArray.length > 0) {
          onFoldersExpanded(featureIdsArray);
          onRecentlyAdded(featureIdsArray);
        }
      }

      if (status.status === "completed") {
        stopPolling();
        setIsGenerating(false);
        setSpecsJobId(null);
        setSpecsProgress(100);
        setSpecsCurrentStep("");
        clearSpecsJob(projectId);

        setTimeout(() => onRecentlyAdded([]), 3000);

        const totalFeatures = result?.totalFeatures ?? filesFromServer.length;
        toast({
          title: "Specs generated",
          description: `Generated specs and requirements for ${totalFeatures} feature(s).`,
        });

        // Reload full file list from DB (includes .devx/ and prompt.md)
        try {
          const specsRes = await fetch(
            getApiUrl(`/api/sdlc/projects/${projectId}/specs/files`),
            { credentials: "include" },
          );
          if (specsRes.ok) {
            const specsData = await specsRes.json();
            const allFiles = Array.isArray(specsData.files) ? specsData.files : [];
            const { parsed, featureIds, pushedIds } = parseAllFiles(allFiles);
            onGenerationComplete(parsed, featureIds, pushedIds);
          }
        } catch {}

        runRepoSync();
      } else if (status.status === "failed") {
        stopPolling();
        setIsGenerating(false);
        setSpecsJobId(null);
        clearSpecsJob(projectId);
        toast({
          title: "Failed to generate specs",
          description: status.error || "Unknown error",
          variant: "destructive",
        });
      } else if (status.status === "processing" || status.status === "pending") {
        specsPollingTimeoutRef.current = setTimeout(() => void pollSpecsJobStatus(jobId), 2000);
      } else {
        stopPolling();
        setIsGenerating(false);
        setSpecsJobId(null);
        clearSpecsJob(projectId);
        toast({
          title: "Specs generation stopped",
          description: `Unknown job status "${status.status}"`,
          variant: "destructive",
        });
      }
    } catch (error: any) {
      stopPolling();
      setIsGenerating(false);
      setSpecsJobId(null);
      setSpecsProgress(null);
      toast({
        title: "Failed to check specs generation status",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive",
      });
    }
  };

  const generateSpecsForFeatures = async (
    featuresToGenerate: Array<{
      id: number;
      title: string;
      state: string;
      description?: string;
      userStories: UserStoryNode[];
    }>,
    skipIdempotentOverride?: boolean,
  ) => {
    if (featuresToGenerate.length === 0) {
      toast({
        title: "Nothing to generate",
        description: isJira
          ? "All selected work items already have generated specs. Use Regenerate on a specific item to refresh."
          : "All selected Features already have generated specs. Use Regenerate on a specific Feature to refresh.",
        variant: "destructive",
      });
      return;
    }

    setIsGenerating(true);
    try {
      const url = getApiUrl(`/api/sdlc/projects/${projectId}/specs/generate-from-backlog/async`);
      const resp = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          features: featuresToGenerate,
          enableTdd,
          specsArchitectureStyle,
          specsDeliveryOrder,
          skipIdempotent: skipIdempotentOverride ?? true,
        }),
      });

      if (!resp.ok) {
        const text = await resp.text();
        throw new Error(text || `Failed to start specs generation (${resp.status})`);
      }

      const data = await resp.json();
      const jobId = (data as any).jobId as string | undefined;
      if (!jobId) throw new Error("Specs generation jobId missing from response");

      setSpecsJobId(jobId);
      setSpecsProgress(0);
      setSpecsProcessedFeatures(0);
      setSpecsTotalFeatures(featuresToGenerate.length);
      persistSpecsJob(projectId, jobId);
      specsPollingTimeoutRef.current = setTimeout(() => void pollSpecsJobStatus(jobId), 1000);
    } catch (error: any) {
      setIsGenerating(false);
      setSpecsJobId(null);
      toast({
        title: "Failed to generate specs",
        description: error instanceof Error ? error.message : "An unexpected error occurred while starting specs generation.",
        variant: "destructive",
      });
    }
  };

  const handleGenerate = async () => {
    if (selectedFeatureIds.size === 0 && selectedStoryIds.size === 0) {
      toast({
        title: isJira ? "No work items selected" : "No features selected",
        description: isJira
          ? "Please select at least one work item to generate specs."
          : "Please select at least one Feature or User Story to generate specs.",
        variant: "destructive",
      });
      return;
    }

    // Auto-pull repo changes before generating
    const repoId = pushRepoId || adoRepos[0]?.id;
    if (repoId && syncStatus.size > 0) {
      const filesToAutoPull = [...syncStatus.entries()]
        .filter(([, s]) => s.status === "modified-in-repo")
        .map(([path, s]) => ({ path, repoObjectId: s.repoObjectId || "", action: "pull" as const }))
        .filter((f) => f.repoObjectId);

      if (filesToAutoPull.length > 0) {
        try {
          const pullRes = await fetch(
            getApiUrl(`/api/sdlc/projects/${projectId}/specs/sync-pull`),
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              credentials: "include",
              body: JSON.stringify({
                repositoryId: repoId,
                ...(adoProject?.organization ? { organization: adoProject.organization } : {}),
                ...(adoProject?.name ? { projectName: adoProject.name } : {}),
                files: filesToAutoPull,
              }),
            },
          );
          if (pullRes.ok) {
            toast({
              title: "Synced from repo",
              description: `Pulled ${filesToAutoPull.length} updated file(s) before generation.`,
            });
          }
        } catch {
          // Non-fatal — continue with generation
        }
      }
    }

    // Build feature list from selection
    const selectedFeaturesFromNodes = featureNodes
      .map((feature) => {
        const matchingStories = feature.userStories.filter(
          (s) => selectedStoryIds.has(s.id) || selectedFeatureIds.has(feature.id),
        );
        // For Jira features without children, treat the feature itself as a story
        if (isJira && matchingStories.length === 0 && selectedFeatureIds.has(feature.id)) {
          return {
            id: feature.id,
            title: feature.title,
            state: feature.state,
            description: feature.description,
            userStories: [{
              id: feature.id,
              title: feature.title,
              state: feature.state,
              description: feature.description ?? "",
              acceptanceCriteria: "",
              storyPoints: null,
              workItemUrl: feature.workItemUrl,
            }],
          };
        }
        return {
          id: feature.id,
          title: feature.title,
          state: feature.state,
          description: feature.description,
          userStories: matchingStories,
        };
      })
      .filter((f) => f.userStories.length > 0);

    const selectedFeatures = [
      ...selectedFeaturesFromNodes,
      ...orphanUserStories
        .filter((s) => selectedStoryIds.has(s.id))
        .map((story) => ({
          id: -story.id,
          title: story.title,
          state: story.state,
          description: story.description ?? "",
          userStories: [story],
        })),
    ];

    if (selectedFeatures.length === 0) {
      toast({
        title: isJira ? "No work items selected" : "No user stories selected",
        description: isJira
          ? "Please select at least one work item to generate specs."
          : "Please select at least one User Story or Feature to generate specs.",
        variant: "destructive",
      });
      return;
    }

    // Pre-generation validation
    setIsValidating(true);
    try {
      const validationRes = await fetch(
        getApiUrl(`/api/sdlc/projects/${projectId}/specs/validate-selection`),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ features: selectedFeatures }),
        },
      );
      const validation = await validationRes.json() as {
        valid: boolean;
        errors: { type: string; message: string }[];
        warnings: { featureId?: number; featureTitle?: string; type: string; message: string }[];
        idempotentFeatures: number[];
        autoAdded: { id: number; title: string; reason: string }[];
      };

      if (!validation.valid) {
        toast({
          title: "Cannot generate",
          description: validation.errors[0]?.message ?? "Please fix the selection errors before generating.",
          variant: "destructive",
        });
        return;
      }

      if (validation.autoAdded.length === 0 && validation.warnings.length === 0 && validation.idempotentFeatures.length === 0) {
        await generateSpecsForFeatures(selectedFeatures, true);
        return;
      }

      const autoAddedFeatures = validation.autoAdded.map((a) => {
        const found = featureNodes.find((f) => f.id === a.id);
        if (found) return { id: found.id, title: found.title, state: found.state, description: found.description, userStories: found.userStories };
        return { id: a.id, title: a.title, state: "New", userStories: [] as UserStoryNode[] };
      });

      setPendingFeatures([...selectedFeatures, ...autoAddedFeatures]);
      setRemovedAutoAddedIds(new Set());
      setValidationResult(validation);
      setSkipIdempotent(true);
      setShowValidationDialog(true);
    } catch {
      // Validation failure is non-fatal — proceed without it
      await generateSpecsForFeatures(selectedFeatures, true);
    } finally {
      setIsValidating(false);
    }
  };

  return {
    isGenerating,
    setIsGenerating,
    isValidating,
    specsProgress,
    setSpecsProgress,
    specsProcessedFeatures,
    setSpecsProcessedFeatures,
    specsTotalFeatures,
    setSpecsTotalFeatures,
    specsCurrentStep,
    setSpecsCurrentStep,
    specsJobId,
    setSpecsJobId,
    specsPollingTimeoutRef,
    // Validation dialog
    validationResult,
    showValidationDialog,
    setShowValidationDialog,
    skipIdempotent,
    setSkipIdempotent,
    pendingFeatures,
    removedAutoAddedIds,
    setRemovedAutoAddedIds,
    // Actions
    pollSpecsJobStatus,
    generateSpecsForFeatures,
    handleGenerate,
  };
}
