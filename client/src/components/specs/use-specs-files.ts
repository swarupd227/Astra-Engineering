import { useEffect, useState } from "react";
import { getApiUrl } from "@/lib/api-config";
import { sanitizeSlug } from "./utils";
import type {
  BacklogContextResponse,
  GeneratedFile,
  GeneratedFileType,
  SpecsArchitectureStyle,
  SpecsDeliveryOrder,
  UserStoryNode,
} from "./types";

interface UseSpecsFilesParams {
  projectId: string;
  open: boolean;
  backlogData: BacklogContextResponse | null | undefined;
  generatedFilesLength: number;
  onFilesLoaded: (
    files: GeneratedFile[],
    featureIds: Set<number>,
    pushedIds: Set<number>,
    enableTdd: boolean | undefined,
    specsArchitectureStyle: SpecsArchitectureStyle | undefined,
    specsDeliveryOrder: SpecsDeliveryOrder | undefined,
  ) => void;
}

export function useSpecsFiles({
  projectId,
  open,
  backlogData,
  generatedFilesLength,
  onFilesLoaded,
}: UseSpecsFilesParams) {
  const [isLoadingSpecsFiles, setIsLoadingSpecsFiles] = useState(false);

  // ── Load existing specs files on open ────────────────────────────────────
  useEffect(() => {
    if (!open || !projectId) return;
    const abortController = new AbortController();

    const loadExistingSpecs = async () => {
      try {
        setIsLoadingSpecsFiles(true);
        const url = getApiUrl(`/api/sdlc/projects/${projectId}/specs/files`);
        const res = await fetch(url, { credentials: "include", signal: abortController.signal });
        if (!res.ok) return;

        const data = await res.json();
        const files = Array.isArray(data.files) ? data.files : [];
        const enableTdd: boolean | undefined = typeof data.enableTdd === "boolean" ? data.enableTdd : undefined;
        const styleRaw = String(data.specsArchitectureStyle ?? "").trim().toLowerCase();
        const specsArchitectureStyle: SpecsArchitectureStyle | undefined =
          styleRaw === "microservices" || styleRaw === "microservice"
            ? "microservices"
            : styleRaw === "monolith" || styleRaw === "monolithic"
              ? "monolith"
              : undefined;
        const orderRaw = String(data.specsDeliveryOrder ?? "").trim().toLowerCase().replace("_", "-");
        const specsDeliveryOrder: SpecsDeliveryOrder | undefined =
          orderRaw === "api-first" || orderRaw === "apifirst"
            ? "api-first"
            : orderRaw === "ui-first" || orderRaw === "uifirst"
              ? "ui-first"
              : undefined;

        const featureIdSet = new Set<number>();
        const pushedIdSet = new Set<number>();
        const restoredFiles: GeneratedFile[] = files.map((f: any) => {
          const featureId =
            typeof f.featureId === "number" ? f.featureId
            : typeof f.feature_id === "number" ? f.feature_id : NaN;
          const featureTitle =
            f.featureTitle ?? f.feature_title ??
            (Number.isFinite(featureId) ? `Feature ${featureId}` : "Feature");
          const fileTypeRaw = String(f.fileType ?? f.file_type ?? "specs").toLowerCase();
          const fileType: GeneratedFileType =
            fileTypeRaw === "requirements" ? "requirements"
            : fileTypeRaw === "tdd-tests" ? "tdd-tests"
            : fileTypeRaw === "devx-context" ? "devx-context"
            : fileTypeRaw === "prompt" ? "prompt"
            : "specs";
          const fileName =
            f.fileName ?? f.file_name ??
            (fileType === "requirements" ? "requirements.md"
            : fileType === "tdd-tests" ? "tdd-tests.md"
            : "specs.md");
          const pathValue = f.path ?? `specs/${sanitizeSlug(featureTitle)}/${fileName}`;
          const isPushed = f.pushedToAdo ?? f.pushed_to_ado ?? false;

          if (Number.isFinite(featureId)) {
            featureIdSet.add(featureId as number);
            if (isPushed) pushedIdSet.add(featureId as number);
          }

          return {
            id: f.id ?? `${featureId}-${fileType}`,
            featureId: Number.isFinite(featureId) ? (featureId as number) : 0,
            featureTitle,
            type: fileType,
            fileName,
            path: pathValue,
            content: String(f.content ?? ""),
            pushedToAdo: isPushed,
            pushedToAdoAt: f.pushedToAdoAt ?? f.pushed_to_ado_at ?? null,
          };
        });

        onFilesLoaded(
          restoredFiles,
          featureIdSet,
          pushedIdSet,
          enableTdd,
          specsArchitectureStyle,
          specsDeliveryOrder,
        );
      } catch (error) {
        if ((error as any)?.name === "AbortError") return;
        console.warn("[useSpecsFiles] Failed to load specs files:", error);
      } finally {
        setIsLoadingSpecsFiles(false);
      }
    };

    loadExistingSpecs();
    return () => abortController.abort();
  }, [open, projectId]);

  // ── Backfill user stories from ADO backlog ───────────────────────────────
  useEffect(() => {
    if (!open || !projectId || isLoadingSpecsFiles || !generatedFilesLength || !backlogData?.artifactsByState) return;

    const allAdoFeatures = new Map<number, { id: number; userStories: UserStoryNode[] }>();
    Object.values(backlogData.artifactsByState).forEach(({ features, userStories }: any) => {
      features?.forEach((f: any) => {
        const id = typeof f.id === "string" ? parseInt(f.id, 10) : f.id;
        if (!id || Number.isNaN(id)) return;
        if (!allAdoFeatures.has(id)) allAdoFeatures.set(id, { id, userStories: [] });
      });
      userStories?.forEach((s: any) => {
        const sId = typeof s.id === "string" ? parseInt(s.id, 10) : s.id;
        const parentRel = s.relations?.find((r: any) => r.rel === "System.LinkTypes.Hierarchy-Reverse");
        let parentId: number | null = null;
        if (parentRel?.url) {
          const match = parentRel.url.match(/\/(\d+)(?:\?|$)/);
          if (match) parentId = parseInt(match[1]);
        }
        if (parentId && allAdoFeatures.has(parentId)) {
          allAdoFeatures.get(parentId)!.userStories.push({
            id: sId, title: s.title || s.fields?.["System.Title"] || `Story ${sId}`,
            state: s.state || s.fields?.["System.State"] || "New",
            description: s.description || s.fields?.["System.Description"],
            acceptanceCriteria: s.acceptanceCriteria || s.fields?.["Microsoft.VSTS.Common.AcceptanceCriteria"],
            storyPoints: s.storyPoints ?? s.fields?.["Microsoft.VSTS.Scheduling.StoryPoints"] ?? null,
          });
        }
      });
    });

    // We don't have generatedFiles here directly, so we rely on the caller
    // having passed generatedFilesLength > 0 as the gate; backfill-stories
    // will no-op server-side if there's nothing to do.
    const featureIds = Array.from(allAdoFeatures.values()).filter((f) => f.userStories.length > 0);
    if (!featureIds.length) return;

    fetch(getApiUrl(`/api/sdlc/projects/${projectId}/specs/backfill-stories`), {
      method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
      body: JSON.stringify({ features: featureIds.map((f) => ({ id: f.id, userStories: f.userStories })) }),
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, projectId, isLoadingSpecsFiles, generatedFilesLength, backlogData]);

  // ── Backfill registry (silent fire-and-forget) ───────────────────────────
  useEffect(() => {
    if (!open || !projectId || !generatedFilesLength) return;
    fetch(getApiUrl(`/api/sdlc/projects/${projectId}/specs/backfill-registry`), {
      method: "POST", credentials: "include",
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, projectId, generatedFilesLength]);

  return { isLoadingSpecsFiles };
}
