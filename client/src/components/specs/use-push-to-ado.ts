import { useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { useJiraOnlyWorkItems } from "@/hooks/use-hosting-config";
import { getApiUrl } from "@/lib/api-config";
import type { ADOProject, GeneratedFile } from "./types";

interface UsePushToAdoParams {
  projectId: string;
  adoProject?: ADOProject;
  queryString: string;
  generatedFiles: GeneratedFile[];
  latestGeneratedFileIds?: Set<string>;
  onPushComplete: (pushedFileIds: string[], pushedFeatureIds: Set<number>) => void;
  onDialogClose: () => void;
  runRepoSync: () => void;
}

export function usePushToAdo({
  projectId,
  adoProject,
  queryString,
  generatedFiles,
  latestGeneratedFileIds,
  onPushComplete,
  onDialogClose,
  runRepoSync,
}: UsePushToAdoParams) {
  const { toast } = useToast();
  const jiraOnly = useJiraOnlyWorkItems();
  const platformName = jiraOnly ? "GitHub" : "Azure DevOps";
  const [isPushing, setIsPushing] = useState(false);

  const handlePushToAdo = async ({
    pushRepoId,
    pushBranch,
    pushBasePath,
    pushScope,
    selectedFileId,
    selectedPushFileIds,
    alreadyPushedIncludeIds,
  }: {
    pushRepoId: string;
    pushBranch: string;
    pushBasePath: string;
    pushScope: "selected" | "all";
    selectedFileId: string | null;
    selectedPushFileIds?: Set<string>;
    alreadyPushedIncludeIds: Set<string>;
  }) => {
    if (!projectId || !pushRepoId.trim()) {
      toast({
        title: "Repository required",
        description: `Enter the ${platformName} repository ID before pushing.`,
        variant: "destructive",
      });
      return;
    }

    const basePath = pushBasePath.trim().replace(/^\/+|\/+$/g, "");
    const selectedFile = selectedFileId ? generatedFiles.find((f) => f.id === selectedFileId) : null;

    if (
      pushScope === "selected" &&
      selectedFile?.pushedToAdo &&
      typeof window !== "undefined" &&
      !window.confirm(
        `This file was already pushed${selectedFile.pushedToAdoAt ? ` on ${new Date(selectedFile.pushedToAdoAt).toLocaleString()}` : ""}. Do you want to push it again?`,
      )
    ) {
      return;
    }

    const filesToPush =
      pushScope === "selected"
        ? selectedFile
          ? [{ id: selectedFile.id, fileName: selectedFile.fileName, path: selectedFile.path, content: selectedFile.content }]
          : []
        : generatedFiles
            .filter((f) => {
              const inLatestBatch = !latestGeneratedFileIds?.size || latestGeneratedFileIds.has(f.id);
              const explicitlySelected = !selectedPushFileIds?.size || selectedPushFileIds.has(f.id);
              return explicitlySelected && inLatestBatch && (!f.pushedToAdo || alreadyPushedIncludeIds.has(f.id));
            })
            .map((f) => ({ id: f.id, fileName: f.fileName, path: f.path, content: f.content }));

    if (!filesToPush.length) {
      toast({
        title: "Nothing to push",
        description:
          pushScope === "selected"
            ? "Select a file before pushing."
            : "All generated specs have already been pushed.",
        variant: "destructive",
      });
      return;
    }

    setIsPushing(true);
    try {
      const payloadFiles = filesToPush.map((file) => {
        const pathAlreadyHasBase = basePath && (file.path === basePath || file.path.startsWith(`${basePath}/`));
        const relativePath = pathAlreadyHasBase ? file.path : basePath ? `${basePath}/${file.path}` : file.path;
        const normalized = relativePath.startsWith("/") ? relativePath : `/${relativePath}`;
        const base64Content =
          typeof window !== "undefined"
            ? window.btoa(unescape(encodeURIComponent(file.content)))
            : Buffer.from(file.content, "utf-8").toString("base64");
        return { name: file.fileName, content: `data:text/markdown;base64,${base64Content}`, path: normalized };
      });

      const uploadParams = new URLSearchParams(queryString);
      if (pushBranch) uploadParams.set("branch", pushBranch);
      const uploadUrl = getApiUrl(
        `/api/ado/repository/${pushRepoId}/upload${uploadParams.toString() ? `?${uploadParams.toString()}` : ""}`,
      );
      const response = await fetch(uploadUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ files: payloadFiles, basePath: basePath ? `/${basePath}` : "/" }),
      });

      const result = await response.json();
      if (!response.ok) throw new Error(result?.error || result?.message || `Failed to push specs to ${platformName}.`);

      // Collect pushed feature IDs
      const pushedFeatureIds = new Set<number>();
      filesToPush.forEach((f) => {
        const match = generatedFiles.find((gf) => gf.path === f.path || gf.fileName === f.fileName);
        if (match) pushedFeatureIds.add(match.featureId);
      });

      // Mark features as pushed in DB
      const pushedFeatureIdsArray = Array.from(pushedFeatureIds);
      if (pushedFeatureIdsArray.length > 0) {
        await fetch(getApiUrl(`/api/sdlc/projects/${projectId}/specs/mark-pushed`), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ featureIds: pushedFeatureIdsArray }),
        }).catch(() => {});
      }

      // Mark individual files as pushed in DB
      const pushedFileIds = filesToPush.map((f) => f.id).filter(Boolean);
      if (pushedFileIds.length > 0) {
        await fetch(getApiUrl(`/api/sdlc/projects/${projectId}/specs/files/mark-pushed`), {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ fileIds: pushedFileIds }),
        }).catch(() => {});
      }

      onPushComplete(pushedFileIds, pushedFeatureIds);
      toast({
        title: `Pushed to ${platformName}`,
        description: result?.message || `Successfully pushed ${filesToPush.length} file(s) to the repository.`,
      });
      onDialogClose();
      runRepoSync();
    } catch (error) {
      toast({
        title: "Push failed",
        description: error instanceof Error ? error.message : "An unexpected error occurred.",
        variant: "destructive",
      });
    } finally {
      setIsPushing(false);
    }
  };

  return { isPushing, handlePushToAdo };
}
