import { useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { getApiUrl } from "@/lib/api-config";
import { pollAsyncJob } from "@/lib/async-job-poller";
import type { GeneratedFile } from "./types";

interface UsePushToGitParams {
  projectId: string;
  generatedFiles: GeneratedFile[];
  latestGeneratedFileIds?: Set<string>;
  onPushComplete: (pushedFileIds: string[], pushedFeatureIds: Set<number>) => void;
  onDialogClose: () => void;
  runRepoSync: () => void;
}

export function usePushToGit({
  projectId,
  generatedFiles,
  latestGeneratedFileIds,
  onPushComplete,
  onDialogClose,
  runRepoSync,
}: UsePushToGitParams) {
  const { toast } = useToast();
  const [isPushing, setIsPushing] = useState(false);

  const handlePushToGit = async ({
    pushBranch,
    pushBasePath,
    pushScope,
    selectedFileId,
    selectedPushFileIds,
    alreadyPushedIncludeIds,
    pushRepoId,
    repoName,
  }: {
    pushBranch: string;
    pushBasePath: string;
    pushScope: "selected" | "all";
    selectedFileId: string | null;
    selectedPushFileIds?: Set<string>;
    alreadyPushedIncludeIds: Set<string>;
    pushRepoId?: string;
    repoName?: string;
  }) => {
    if (!projectId) return;

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
          ? [selectedFile.id]
          : []
        : generatedFiles
            .filter((f) => {
              const inLatestBatch = !latestGeneratedFileIds?.size || latestGeneratedFileIds.has(f.id);
              const explicitlySelected = !selectedPushFileIds?.size || selectedPushFileIds.has(f.id);
              return explicitlySelected && inLatestBatch && (!f.pushedToAdo || alreadyPushedIncludeIds.has(f.id));
            })
            .map((f) => f.id);

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
      const response = await fetch(getApiUrl(`/api/sdlc/projects/${projectId}/specs/push`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          fileIds: filesToPush,
          basePath: pushBasePath.trim() || undefined,
          branch: pushBranch.trim() || undefined,
          repoId: pushRepoId || undefined,
          repoName: repoName?.trim() || undefined,
          commitMessage: `Push generated SDLC specs for project ${projectId}`,
        }),
      });

      const result = await response.json();
      if (!response.ok) throw new Error(result?.error || result?.message || "Failed to push specs to repository.");

      // The server now returns 202 + jobId immediately (to avoid AWS API
      // Gateway's 29s timeout on multi-file Git pushes). Poll the job until
      // it reports completed/failed, then proceed.
      if (response.status === 202 && result?.jobId) {
        await pollAsyncJob("specs-push", result.jobId);
      }

      // Collect pushed feature IDs for UI update
      const pushedFeatureIds = new Set<number>();
      filesToPush.forEach((id) => {
        const match = generatedFiles.find((gf) => gf.id === id);
        if (match) pushedFeatureIds.add(match.featureId);
      });

      onPushComplete(filesToPush, pushedFeatureIds);
      toast({
        title: "Pushed to Repository",
        description: `Successfully pushed ${filesToPush.length} file(s) to the repository.`,
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

  return { isPushing, handlePushToGit };
}
