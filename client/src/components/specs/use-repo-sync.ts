import { useEffect, useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { getApiUrl } from "@/lib/api-config";
import { sanitizeSlug } from "./utils";
import type { ADOProject, GeneratedFile, GeneratedFileType, SyncFileStatus } from "./types";

interface UseRepoSyncParams {
  projectId: string;
  adoProject?: ADOProject;
  pushRepoId: string;
  adoRepos: any[];
  open: boolean;
  isLoadingSpecsFiles: boolean;
  generatedFiles: GeneratedFile[];
  /** Called after a successful pull — provides reloaded file list */
  onFilesReloaded: (
    files: GeneratedFile[],
    featureIds: Set<number>,
    pushedIds: Set<number>,
  ) => void;
  /** Called after a single file is discarded */
  onFileDiscarded: (fileId: string) => void;
  /** Called after a batch of files is discarded */
  onFilesDiscarded: (fileIds: Set<string>) => void;
  onFileSelected: (fileId: string | null) => void;
}

function parseFilesFromServer(files: any[]): {
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

export function useRepoSync({
  projectId,
  adoProject,
  pushRepoId,
  adoRepos,
  open,
  isLoadingSpecsFiles,
  generatedFiles,
  onFilesReloaded,
  onFileDiscarded,
  onFilesDiscarded,
  onFileSelected,
}: UseRepoSyncParams) {
  const { toast } = useToast();
  const [syncStatus, setSyncStatus] = useState<Map<string, SyncFileStatus>>(() => new Map());
  const [isSyncing, setIsSyncing] = useState(false);

  const runRepoSync = async () => {
    const repoId = pushRepoId || adoRepos[0]?.id;
    if (!repoId || !projectId) return;

    setIsSyncing(true);
    try {
      const res = await fetch(
        getApiUrl(`/api/sdlc/projects/${projectId}/specs/sync-status`),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            repositoryId: repoId,
            ...(adoProject?.organization ? { organization: adoProject.organization } : {}),
            ...(adoProject?.name ? { projectName: adoProject.name } : {}),
            basePath: "specs",
          }),
        },
      );
      if (!res.ok) return;
      const data = await res.json();
      const map = new Map<string, SyncFileStatus>();
      for (const r of data.syncResults) map.set(r.path, r);
      setSyncStatus(map);
    } catch (err) {
      console.warn("[useRepoSync] Sync status check failed:", err);
    } finally {
      setIsSyncing(false);
    }
  };

  // Auto-sync on modal open (after files are loaded)
  useEffect(() => {
    if (!open || !projectId || isLoadingSpecsFiles) return;
    const repoId = pushRepoId || adoRepos[0]?.id;
    if (!repoId) return;
    runRepoSync();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, projectId, isLoadingSpecsFiles, adoRepos, adoProject, pushRepoId]);

  const handlePullFromRepo = async (filePaths: string[]) => {
    const repoId = pushRepoId || adoRepos[0]?.id;
    if (!repoId) return;

    const filesToPull = filePaths
      .map((path) => {
        const status = syncStatus.get(path);
        if (!status?.repoObjectId) return null;
        return { path, repoObjectId: status.repoObjectId, action: "pull" as const };
      })
      .filter(Boolean);

    if (!filesToPull.length) return;

    try {
      const res = await fetch(
        getApiUrl(`/api/sdlc/projects/${projectId}/specs/sync-pull`),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            repositoryId: repoId,
            ...(adoProject?.organization ? { organization: adoProject.organization } : {}),
            ...(adoProject?.name ? { projectName: adoProject.name } : {}),
            files: filesToPull,
          }),
        },
      );
      const pullData = await res.json();
      if (res.ok) {
        toast({
          title: "Pulled from repo",
          description: `Pulled ${pullData.pulledCount || filesToPull.length} file(s) from the repository.`,
        });
        // Reload files from DB
        const specsRes = await fetch(
          getApiUrl(`/api/sdlc/projects/${projectId}/specs/files`),
          { credentials: "include" },
        );
        if (specsRes.ok) {
          const specsData = await specsRes.json();
          const files = Array.isArray(specsData.files) ? specsData.files : [];
          const { parsed, featureIds, pushedIds } = parseFilesFromServer(files);
          onFilesReloaded(parsed, featureIds, pushedIds);
        }
        await runRepoSync();
      } else {
        toast({ title: "Pull failed", description: "Server returned an error.", variant: "destructive" });
      }
    } catch {
      toast({ title: "Pull failed", description: "Failed to pull files from repo.", variant: "destructive" });
    }
  };

  const handleDiscardLocal = async (fileId: string) => {
    try {
      const res = await fetch(
        getApiUrl(`/api/sdlc/projects/${projectId}/specs/files/${fileId}`),
        { method: "DELETE", credentials: "include" },
      );
      if (res.ok) {
        onFileDiscarded(fileId);
        onFileSelected(null);
        toast({ title: "File discarded", description: "Local file has been removed." });
        await runRepoSync();
      } else {
        toast({ title: "Discard failed", description: "Could not delete the file.", variant: "destructive" });
      }
    } catch {
      toast({ title: "Discard failed", description: "An error occurred.", variant: "destructive" });
    }
  };

  const handleDiscardFolder = async (featureId: number) => {
    const folderFiles = generatedFiles.filter((f) => f.featureId === featureId);
    if (!folderFiles.length) return;
    if (!window.confirm(`Discard all ${folderFiles.length} local file(s) for this feature? This cannot be undone.`)) return;

    let discardedCount = 0;
    for (const file of folderFiles) {
      try {
        const res = await fetch(
          getApiUrl(`/api/sdlc/projects/${projectId}/specs/files/${file.id}`),
          { method: "DELETE", credentials: "include" },
        );
        if (res.ok) discardedCount++;
      } catch {
        // continue with remaining files
      }
    }
    onFilesDiscarded(new Set(folderFiles.map((f) => f.id)));
    onFileSelected(null);
    toast({ title: "Folder discarded", description: `Removed ${discardedCount} file(s).` });
    await runRepoSync();
  };

  const handlePullFolder = async (featureId: number) => {
    const folderFiles = generatedFiles.filter((f) => f.featureId === featureId);
    const paths = folderFiles
      .map((f) => (f.path.startsWith("/") ? f.path.slice(1) : f.path))
      .filter((p) => {
        const s = syncStatus.get(p);
        return s?.status === "modified-in-repo" || s?.status === "conflict" || s?.status === "repo-only";
      });
    if (paths.length) await handlePullFromRepo(paths);
  };

  const handleDiscardAllLocal = async () => {
    const discardableFiles = generatedFiles.filter((f) => {
      const p = f.path.startsWith("/") ? f.path.slice(1) : f.path;
      const s = syncStatus.get(p);
      return !s || s.status === "local-only" || s.status === "modified-locally";
    });
    if (!discardableFiles.length) {
      toast({ title: "Nothing to discard", description: "No local-only or modified files found." });
      return;
    }
    if (!window.confirm(`Discard all ${discardableFiles.length} locally modified/new file(s)? This cannot be undone.`)) return;

    let discardedCount = 0;
    for (const file of discardableFiles) {
      try {
        const res = await fetch(
          getApiUrl(`/api/sdlc/projects/${projectId}/specs/files/${file.id}`),
          { method: "DELETE", credentials: "include" },
        );
        if (res.ok) discardedCount++;
      } catch {
        // continue
      }
    }
    onFilesDiscarded(new Set(discardableFiles.map((f) => f.id)));
    onFileSelected(null);
    toast({ title: "Discarded local changes", description: `Removed ${discardedCount} file(s).` });
    await runRepoSync();
  };

  return {
    syncStatus,
    isSyncing,
    runRepoSync,
    handlePullFromRepo,
    handleDiscardLocal,
    handleDiscardFolder,
    handlePullFolder,
    handleDiscardAllLocal,
  };
}
