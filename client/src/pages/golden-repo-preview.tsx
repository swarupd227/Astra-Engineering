import { useState, useEffect, useRef, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearch } from "wouter";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { FileTreeNode } from "@/components/golden-repo/file-tree-node";
import { FileViewer } from "@/components/golden-repo/file-viewer";
import { normalizePath, isInStarterCode } from "@/contexts/golden-repo-selection-context";
import {
  Search,
  X,
  FolderGit2,
  ArrowLeft,
  Download,
  Upload,
  Trash2,
  Eye,
} from "lucide-react";
import { Link } from "wouter";
import { PageHeader } from "@/components/ui/page-header";
import { useToast } from "@/hooks/use-toast";
import { getApiUrl } from "@/lib/api-config";
import { FileUploadDialog } from "@/components/golden-repo/file-upload-dialog";
import { useQueryClient } from "@tanstack/react-query";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

/**
 * Helper function to collect files for preselection based on criteria:
 * - All files under Compliance/
 * - All files under General/
 * - All leaf files under requirements/insurance-usecases/
 * - requirements/risk-assesment.md or requirements/risk-assessment.md
 * - Process/requirements/insurance-usecases.md
 * - Process/requirements/risk-assessment.md
 * - insurance_persona.md (at root level)
 * - Excludes anything in Starter Code folder
 */
function collectPreselectionFiles(
  node: any,
  collectedPaths: string[] = [],
): string[] {
  if (!node) return collectedPaths;

  const normalizedNodePath = normalizePath(node.path);
  const pathLower = normalizedNodePath.toLowerCase();

  // Skip if in Starter Code folder
  if (isInStarterCode(normalizedNodePath)) {
    return collectedPaths;
  }

  // If it's a file, check if it matches our criteria
  if (node.type === "file") {
    // Check if file is insurance_persona.md at root level
    if (pathLower === "insurance_persona.md") {
      collectedPaths.push(normalizedNodePath);
    }
    // Check if file is under Compliance/
    else if (pathLower.startsWith("compliance/")) {
      collectedPaths.push(normalizedNodePath);
    }
    // Check if file is under General/
    else if (pathLower.startsWith("general/")) {
      collectedPaths.push(normalizedNodePath);
    }
    // Check if file is under Process/requirements/ but exclude files in artifacts/ subfolder
    else if (pathLower.startsWith("process/requirements/")) {
      // Exclude files under Process/requirements/artifacts/
      if (!pathLower.startsWith("process/requirements/artifacts/")) {
        // Include all files under Process/requirements/ except those in artifacts/
        collectedPaths.push(normalizedNodePath);
      }
    }
  }

  // Recursively process children
  if (node.children && Array.isArray(node.children)) {
    for (const child of node.children) {
      collectPreselectionFiles(child, collectedPaths);
    }
  }

  return collectedPaths;
}

export default function GoldenRepoPreview() {
  const search = useSearch();
  const params = new URLSearchParams(search);
  const repoId = params.get("repoId") || "default";
  const repoProvider = params.get("provider") || "ado";
  const repoOwner = params.get("owner") || "";
  const repoName = params.get("name") || "";
  const gitlabProjectId = params.get("projectId") && repoProvider === "gitlab" ? params.get("projectId")! : "";
  const isGitHub = repoProvider === "github";
  const isGitLab = repoProvider === "gitlab";
  const projectId = repoProvider !== "gitlab" ? (params.get("projectId") || null) : null;
  const { toast } = useToast();

  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [isDownloading, setIsDownloading] = useState(false);
  const [isUploadDialogOpen, setIsUploadDialogOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [fileToDelete, setFileToDelete] = useState<string | null>(null);
  const [linkedProjects, setLinkedProjects] = useState<
    { id: string; name: string; description?: string }[] | null
  >(null);
  const [isLoadingLinkedProjects, setIsLoadingLinkedProjects] =
    useState(false);
  const queryClient = useQueryClient();
  const [preselectedPaths, setPreselectedPaths] = useState<string[]>([]);
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());

  const treeQueryKey = isGitHub
    ? ["/api/github/repository", repoOwner, repoName, "tree"]
    : isGitLab
      ? ["/api/gitlab/repository", gitlabProjectId || repoId, "tree"]
      : ["/api/ado/repository", repoId, "tree"];
  const fileQueryKeyPrefix = isGitHub
    ? ["/api/github/repository", repoOwner, repoName, "file"]
    : isGitLab
      ? ["/api/gitlab/repository", gitlabProjectId || repoId, "file"]
      : ["/api/ado/repository", repoId, "file"];

  const { data: repositoriesData } = useQuery({
    queryKey: ["/api/golden-repositories"],
    queryFn: async () => {
      const response = await fetch(getApiUrl("/api/golden-repositories"), { credentials: "include" });
      if (!response.ok) return null;
      return response.json();
    },
  });

  const repositoryName = (isGitHub || isGitLab)
    ? repoName || "Repository"
    : repositoriesData?.repositories?.find((repo: any) => repo.id === repoId)?.name || "Repository";

  const repoBranch: string =
    repositoriesData?.repositories?.find((repo: any) => repo.id === repoId)?.defaultBranch || "main";

  const [projectData, setProjectData] = useState<any>(null);

  // If a projectId is provided, fetch its details so we can show link info
  useEffect(() => {
    if (!projectId || !repoId) return;

    (async () => {
      try {
        const resp = await fetch(
          getApiUrl(`/api/sdlc/projects/${projectId}/details`),
          {
            credentials: "include",
          },
        );
        if (!resp.ok) return;
        const json = await resp.json();
        setProjectData(json.project);
      } catch (err) {
        console.error("[Golden Preview] Failed to load project details:", err);
      }
    })();
  }, [projectId, repoId, repositoryName]);

  const { data: repositoryData, isLoading: isRepositoryLoading } = useQuery({
    queryKey: treeQueryKey,
    queryFn: async () => {
      const url = isGitHub
        ? `/api/github/repository/${encodeURIComponent(repoOwner)}/${encodeURIComponent(repoName)}/tree`
        : isGitLab
          ? `/api/gitlab/repository/${encodeURIComponent(gitlabProjectId || repoId)}/tree?isGoldenRepo=true`
          : `/api/ado/repository/${repoId}/tree`;
      const response = await fetch(getApiUrl(url), { credentials: "include" });
      if (!response.ok) throw new Error("Failed to fetch file tree");
      return response.json();
    },
  });

  const isEmptyRepository = repositoryData?.isEmpty || false;
  const emptyRepositoryMessage =
    repositoryData?.message || "This repository is empty";

  const repositoryTree = repositoryData
    ? {
        name: "root",
        path: "/",
        type: "folder" as const,
        children: repositoryData.tree || [],
      }
    : null;

  // Chunking status from backend (devx_vectorized_guidelines)
  const chunkedPaths: string[] = repositoryData?.chunkedPaths || [];
  const allChunked: boolean = repositoryData?.allChunked === true;

  const { data: fileContent, isLoading: isFileLoading } = useQuery({
    queryKey: [...fileQueryKeyPrefix, selectedPath],
    queryFn: async () => {
      if (!selectedPath) return null;

      const url = isGitHub
        ? `/api/github/repository/${encodeURIComponent(repoOwner)}/${encodeURIComponent(repoName)}/file?path=${encodeURIComponent(selectedPath)}`
        : isGitLab
          ? `/api/gitlab/repository/${encodeURIComponent(gitlabProjectId || repoId)}/file?path=${encodeURIComponent(selectedPath)}&isGoldenRepo=true`
          : `/api/ado/repository/${repoId}/file?path=${encodeURIComponent(selectedPath)}`;
      const response = await fetch(getApiUrl(url), { credentials: "include" });
      if (!response.ok) throw new Error("Failed to fetch file content");
      return response.json();
    },
    enabled: !!selectedPath,
  });

  // Auto-select README.md on initial load
  useEffect(() => {
    if (repositoryTree && !selectedPath) {
      const findReadme = (node: any): string | null => {
        if (node.type === "file" && node.name.toLowerCase() === "readme.md") {
          return node.path;
        }
        if (node.children) {
          for (const child of node.children) {
            const result = findReadme(child);
            if (result) return result;
          }
        }
        return null;
      };

      const readmePath = findReadme(repositoryTree);
      if (readmePath) {
        setSelectedPath(readmePath);
      }
    }
  }, [repositoryTree, selectedPath]);

  // Preselect files client-side for highlighting (does not affect backend usage)
  useEffect(() => {
    if (!repositoryTree || !repoId || !repositoryName || repositoryName === "Repository") {
      return;
    }

    const collectedPaths = collectPreselectionFiles(repositoryTree);
    setPreselectedPaths(collectedPaths);
  }, [repositoryTree, repoId, repositoryName]);

  const handleFileSelect = (path: string) => {
    setSelectedPath(path);
  };

  const handleTogglePathSelection = useCallback(
    (path: string, checked: boolean) => {
      const normalized = normalizePath(path);
      setSelectedPaths((prev) => {
        const next = new Set(prev);
        if (checked) {
          next.add(normalized);
        } else {
          next.delete(normalized);
        }
        return next;
      });
    },
    [],
  );

  const clearSelectedPaths = useCallback(() => {
    setSelectedPaths(new Set());
  }, []);

  // Whenever a file is selected in the tree, fetch the list of linked projects
  useEffect(() => {
    if (!selectedPath) {
      setLinkedProjects(null);
      setIsLoadingLinkedProjects(false);
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        setIsLoadingLinkedProjects(true);
        const response = await fetch(
          getApiUrl(
            `/api/golden-repo/${repoId}/file/projects?path=${encodeURIComponent(
              selectedPath,
            )}`,
          ),
          { credentials: "include" },
        );
        if (!response.ok) {
          throw new Error("Failed to load linked projects");
        }
        const data = await response.json();
        if (!cancelled) {
          setLinkedProjects(data.projects || []);
        }
      } catch (err) {
        console.error(
          "[Golden Preview] Failed to load linked projects for selected file:",
          selectedPath,
          err,
        );
        if (!cancelled) {
          setLinkedProjects([]);
        }
      } finally {
        if (!cancelled) {
          setIsLoadingLinkedProjects(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [selectedPath, repoId]);

  const handleClearSearch = () => {
    setSearchQuery("");
  };

  const handleDownload = async () => {
    try {
      setIsDownloading(true);

      const downloadUrl = isGitHub
        ? `/api/github/repository/${encodeURIComponent(repoOwner)}/${encodeURIComponent(repoName)}/download`
        : isGitLab
          ? `/api/gitlab/repository/${encodeURIComponent(gitlabProjectId || repoId)}/download`
          : `/api/ado/repository/${repoId}/download`;

      const response = await fetch(
        getApiUrl(downloadUrl),
        {
          credentials: "include",
        },
      );

      if (!response.ok) {
        throw new Error(
          `Failed to download repository: ${response.status} ${response.statusText}`,
        );
      }

      const contentDisposition = response.headers.get("Content-Disposition");
      let filename = `${repoName || "repository"}.zip`;
      if (contentDisposition) {
        const matches = /filename="?([^"]+)"?/.exec(contentDisposition);
        if (matches && matches[1]) {
          filename = matches[1];
        }
      }

      const blob = await response.blob();

      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

      toast({
        title: "Download started",
        description: `Downloading ${filename}`,
      });
    } catch (error) {
      toast({
        title: "Download failed",
        description:
          error instanceof Error
            ? error.message
            : "Failed to download repository. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsDownloading(false);
    }
  };

  const handleDeleteClick = () => {
    if (!selectedPath) {
      toast({
        title: "No file selected",
        description: "Please select a file to delete",
        variant: "destructive",
      });
      return;
    }
    setFileToDelete(selectedPath);
    setIsDeleteDialogOpen(true);
  };

  // Whenever a file is selected for deletion, fetch the list of linked projects
  useEffect(() => {
    if (!fileToDelete) {
      setLinkedProjects(null);
      setIsLoadingLinkedProjects(false);
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        setIsLoadingLinkedProjects(true);
        const response = await fetch(
          getApiUrl(
            `/api/golden-repo/${repoId}/file/projects?path=${encodeURIComponent(
              fileToDelete,
            )}`,
          ),
          { credentials: "include" },
        );
        if (!response.ok) {
          throw new Error("Failed to load linked projects");
        }
        const data = await response.json();
        if (!cancelled) {
          setLinkedProjects(data.projects || []);
        }
      } catch (err) {
        console.error(
          "[Golden Preview] Failed to load linked projects for file:",
          fileToDelete,
          err,
        );
        if (!cancelled) {
          setLinkedProjects([]);
        }
      } finally {
        if (!cancelled) {
          setIsLoadingLinkedProjects(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [fileToDelete, repoId]);

  // Helper function to recursively remove a file from the tree
  const removeFileFromTree = (node: any, targetPath: string): any | null => {
    if (!node) return null;

    // Normalize paths for comparison (handle both with and without leading slash)
    const nodePath = normalizePath(node.path);
    const normalizedTargetPath = normalizePath(targetPath);

    // If this is the file we want to delete, return null to remove it
    if (nodePath === normalizedTargetPath && node.type === "file") {
      return null;
    }

    // If this is a folder, recursively process children
    if (node.children && Array.isArray(node.children)) {
      const filteredChildren = node.children
        .map((child: any) => removeFileFromTree(child, targetPath))
        .filter((child: any) => child !== null);

      // Return the node with filtered children
      return {
        ...node,
        children: filteredChildren,
      };
    }

    // For files that don't match, return as-is
    return node;
  };

  const handleDeleteConfirm = async () => {
    if (!fileToDelete) return;

    setIsDeleting(true);
    const wasFileOpen = selectedPath === fileToDelete;

    try {
      const deleteUrl = isGitHub
        ? `/api/github/repository/${encodeURIComponent(repoOwner)}/${encodeURIComponent(repoName)}/delete`
        : isGitLab
          ? `/api/gitlab/repository/${encodeURIComponent(gitlabProjectId || repoId)}/delete`
          : `/api/ado/repository/${repoId}/delete`;

      const response = await fetch(
        getApiUrl(deleteUrl),
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            filePaths: [fileToDelete],
          }),
          credentials: "include",
        },
      );

      if (!response.ok) {
        const error = await response.json();
        throw new Error(
          error.error || error.details || "Failed to delete file",
        );
      }

      const result = await response.json();

      // Optimistically update the tree cache to remove the file immediately
      queryClient.setQueryData(
        treeQueryKey,
        (oldData: any) => {
          if (!oldData) return oldData;

          // Create a new tree structure with the file removed
          const updatedTree = oldData.tree
            ? oldData.tree
                .map((child: any) => removeFileFromTree(child, fileToDelete))
                .filter((child: any) => child !== null)
            : [];

          return {
            ...oldData,
            tree: updatedTree,
          };
        },
      );

      // If the deleted file was open, close the preview and remove it from cache
      if (wasFileOpen) {
        setSelectedPath(null);
        // Remove the file content from cache since it no longer exists
        queryClient.removeQueries({
          queryKey: [...fileQueryKeyPrefix, fileToDelete],
        });
        toast({
          title: "File deleted",
          description: `The file "${fileToDelete}" has been deleted and is no longer available.`,
        });
      } else {
        toast({
          title: "File deleted",
          description: `Successfully deleted ${fileToDelete}`,
        });
      }

      // Close dialog and reset state
      setIsDeleteDialogOpen(false);
      setFileToDelete(null);
      setLinkedProjects(null);

      // Invalidate and refetch the repository tree to ensure consistency
      await queryClient.invalidateQueries({
        queryKey: treeQueryKey,
      });
    } catch (error) {
      console.error("Delete error:", error);

      queryClient.invalidateQueries({
        queryKey: treeQueryKey,
      });

      toast({
        title: "Delete failed",
        description:
          error instanceof Error
            ? error.message
            : "Failed to delete file. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsDeleting(false);
    }
  };

  const [chunkLog, setChunkLog] = useState<string[]>([]);
  const [isChunking, setIsChunking] = useState(false);
  const [chunkingPath, setChunkingPath] = useState<string | null>(null);
  const [chunkStartTime, setChunkStartTime] = useState<number | null>(null);
  const [chunkElapsedMs, setChunkElapsedMs] = useState(0);

  const appendChunkLog = useCallback((message: string) => {
    setChunkLog((prev) => [
      ...prev,
      `${new Date().toLocaleTimeString()} • ${message}`,
    ]);
  }, []);

  useEffect(() => {
    if (!isChunking || !chunkStartTime) {
      setChunkElapsedMs(0);
      return;
    }
    const interval = window.setInterval(() => {
      setChunkElapsedMs(Date.now() - chunkStartTime);
    }, 1000);
    return () => {
      window.clearInterval(interval);
    };
  }, [isChunking, chunkStartTime]);

  const handleChunkFile = async (path: string) => {
    setIsChunking(true);
    setChunkingPath(path);
    setChunkStartTime(Date.now());
    appendChunkLog(`Starting chunking for "${path}"...`);
    try {
      appendChunkLog("Calling chunk API...");
      const response = await fetch(
        getApiUrl(`/api/golden-repo/${repoId}/chunk`),
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          credentials: "include",
          body: JSON.stringify({
            filePath: path,
          }),
        },
      );
      const result = await response.json();
      if (!response.ok || !result.success) {
        const message =
          result.error || result.details || "Failed to chunk file";
        appendChunkLog(`Chunking failed: ${message}`);
        throw new Error(message);
      }
      appendChunkLog(
        `Chunking completed for "${path}" with ${result.chunkCount ?? "n"} chunks.`,
      );
      toast({
        title: "File chunked",
        description: `Successfully chunked ${path}`,
      });
      await queryClient.invalidateQueries({
        queryKey: treeQueryKey,
      });
    } catch (error) {
      console.error("[Golden Preview] Chunk error:", error);
      const message =
        error instanceof Error
          ? error.message
          : "Failed to chunk file. Please try again.";
      appendChunkLog(`Chunking failed for "${path}": ${message}`);
      toast({
        title: "Chunking failed",
        description: message,
        variant: "destructive",
      });
    } finally {
      setIsChunking(false);
      setChunkingPath(null);
      setChunkStartTime(null);
    }
  };

  return (
    <div
      className="h-screen flex flex-col bg-background"
      style={{ overflowX: "hidden", overflowY: "hidden" }}
    >
      {/* Header */}
      <div className="border-b bg-card">
        <div className="flex items-center justify-between p-6">
          <div className="flex items-center gap-4">
            <Link href="/golden-repos">
              <Button
                variant="ghost"
                size="sm"
                data-testid="button-back-to-repos"
                className="text-xl font-semibold h-auto py-2"
              >
                <ArrowLeft className="h-4 w-4 mr-2" />
                {repositoryName}
                {allChunked && (
                  <Badge
                    variant="outline"
                    className="ml-2 text-[11px] px-2 py-0 border-emerald-500/60 text-emerald-600"
                  >
                    Chunked
                  </Badge>
                )}
              </Button>
            </Link>
            <Separator orientation="vertical" className="h-6" />
            <PageHeader
              icon={Eye}
              title="Repository Preview"
              subtitle={
                projectData && projectData.project
                  ? `Linked to project: ${projectData.project.name}`
                  : "Browse and explore repository files"
              }
              color="slate"
              data-testid="heading-preview-title"
            />
          </div>
          <div className="flex items-center gap-3">
            {!isGitHub && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setIsUploadDialogOpen(true)}
                data-testid="button-upload-files"
              >
                <Upload className="h-4 w-4 mr-2" />
                Upload File
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={handleDeleteClick}
              disabled={!selectedPath || isDeleting}
              data-testid="button-delete-file"
            >
              <Trash2 className="h-4 w-4 mr-2" />
              Delete
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleDownload}
              disabled={isDownloading}
              data-testid="button-download-repo"
            >
              <Download className="h-4 w-4 mr-2" />
              {isDownloading ? "Downloading..." : "Download ZIP"}
            </Button>
            <Badge variant="secondary" data-testid="badge-read-only">
              Read-Only Mode
            </Badge>
          </div>
        </div>
      </div>

      {/* Main Content - Split Pane */}
      <div
        className="flex-1 flex"
        style={{
          overflowX: "hidden",
          overflowY: "hidden",
          position: "relative",
        }}
      >
        {/* Left Sidebar - File Tree */}
        <div
          className="w-96 flex-shrink-0 border-r bg-card flex flex-col"
          style={{
            overflowX: "hidden",
            overflowY: "hidden",
            position: "relative",
            maxWidth: "24rem",
            minWidth: "24rem",
            width: "24rem",
          }}
        >
          {/* Header */}
          <div className="border-b px-4 py-3">
            <div className="flex items-center gap-2">
              <FolderGit2 className="h-4 w-4 text-muted-foreground" />
              <h2 className="font-semibold text-sm">Repository Files</h2>
            </div>
          </div>

          {/* Search Bar */}
          <div className="p-4 border-b">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search files..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9 pr-9"
                data-testid="input-search-files"
              />
              {searchQuery && (
                <Button
                  size="icon"
                  variant="ghost"
                  className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7"
                  onClick={handleClearSearch}
                  data-testid="button-clear-search"
                >
                  <X className="h-4 w-4" />
                </Button>
              )}
            </div>
          </div>

          {/* File Tree */}
          <div
            className="flex-1 overflow-y-auto overflow-x-hidden p-2"
            style={{ overscrollBehavior: "contain" }}
          >
            {isRepositoryLoading ? (
              <div className="space-y-2 p-2">
                {[...Array(8)].map((_, i) => (
                  <Skeleton key={i} className="h-8 w-full" />
                ))}
              </div>
            ) : repositoryTree ? (
              <div
                data-testid="file-tree-repository"
                style={{ minWidth: 0, maxWidth: "100%" }}
              >
            {repositoryTree.children &&
            repositoryTree.children.length > 0 ? (
              repositoryTree.children.map((child: any) => (
                  <FileTreeNode
                    key={child.path}
                    node={child}
                    onFileSelect={handleFileSelect}
                    selectedPath={selectedPath}
                    searchQuery={searchQuery}
                    repoId={repoId}
                    repoName={repositoryName}
                    preselectedPaths={preselectedPaths}
                    chunkedPaths={chunkedPaths}
                    onChunkFile={handleChunkFile}
                    isChunking={isChunking}
                    chunkingPath={chunkingPath ?? undefined}
                    chunkElapsedMs={chunkElapsedMs}
                    selectedPaths={Array.from(selectedPaths)}
                    onTogglePathSelection={handleTogglePathSelection}
                  />
              ))
            ) : (
                  <div className="text-center py-8 px-4">
                    <div className="inline-flex p-3 rounded-full bg-muted mb-3">
                      <FolderGit2 className="h-6 w-6 text-muted-foreground" />
                    </div>
                    <p className="text-sm font-medium text-muted-foreground mb-1">
                      {isEmptyRepository
                        ? "Empty Repository"
                        : "No Files Found"}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {isEmptyRepository
                        ? emptyRepositoryMessage
                        : "This repository doesn't contain any files yet"}
                    </p>
                  </div>
                )}
              </div>
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                <p>Failed to load repository files</p>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="border-t p-3 bg-muted/50 space-y-2">
            <p className="text-xs text-muted-foreground text-center">
              {repositoryTree?.children?.length || 0} items in repository
            </p>
            {selectedPaths.size > 0 && (
              <div className="flex items-center justify-between gap-2 rounded-md border border-border/60 bg-background px-2 py-1.5">
                <p className="text-xs text-muted-foreground">
                  {selectedPaths.size} file{selectedPaths.size > 1 ? "s" : ""} selected
                </p>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 px-2 text-xs"
                  onClick={clearSelectedPaths}
                >
                  Clear
                </Button>
              </div>
            )}
            {repositoryName && repositoryName !== "Repository" && (
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs text-muted-foreground">
                  All files in this repository are used as golden guidelines.
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Right Panel - File Viewer + Linked Projects + Chunk Log */}
        <div className="flex-1 min-w-0 flex flex-col">
          <div
            className="flex-1 p-6 space-y-3"
            style={{
              overflow: "hidden",
              position: "relative",
              maxWidth: "100%",
              width: "100%",
            }}
          >
            {/* Linked projects for selected file */}
            {selectedPath && (
              <div className="rounded-xl border border-border/60 bg-card px-3 py-2">
                <div className="flex items-center justify-between">
                  <div className="text-xs font-medium text-muted-foreground">
                    Linked projects for this file
                  </div>
                  {isLoadingLinkedProjects && (
                    <span className="text-[11px] text-muted-foreground">
                      Checking…
                    </span>
                  )}
                </div>
                {!isLoadingLinkedProjects && (
                  <>
                    {linkedProjects && linkedProjects.length > 0 ? (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {linkedProjects.map((p) => (
                          <span
                            key={p.id}
                            className="inline-flex items-center rounded-full border border-border/60 bg-muted/60 px-2.5 py-0.5 text-[11px] font-medium text-muted-foreground max-w-full truncate"
                            title={p.description ? `${p.name} — ${p.description}` : p.name}
                          >
                            {p.name}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <p className="mt-1 text-xs text-muted-foreground">
                        This file is not currently linked to any SDLC projects.
                      </p>
                    )}
                  </>
                )}
              </div>
            )}
            {selectedPath && (
              <div className="flex items-center justify-between mb-1">
                <div
                  className="text-xs font-medium text-muted-foreground truncate max-w-[70%]"
                  title={selectedPath}
                >
                  {selectedPath.split("/").slice(-1)[0]}
                </div>
                <span className="text-[11px] text-muted-foreground">
                  File preview
                </span>
              </div>
            )}
            <FileViewer file={fileContent} isLoading={isFileLoading} />
          </div>
          <div className="border-t border-border/60 bg-card/60 px-4 py-2 h-40 flex flex-col">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-medium text-muted-foreground">
                Chunking log
              </span>
              {isChunking && (
                <span className="text-[11px] text-amber-500">
                  Running chunking...
                </span>
              )}
            </div>
            <div className="flex-1 rounded-md bg-background/80 border border-border/40 px-3 py-2 text-xs font-mono overflow-y-auto">
              {chunkLog.length === 0 ? (
                <span className="text-muted-foreground">
                  Chunk activity will appear here when you run chunking.
                </span>
              ) : (
                <ul className="space-y-1">
                  {chunkLog.map((line, idx) => (
                    <li key={idx} className="text-[11px] leading-snug">
                      {line}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* File Upload Dialog - ADO and GitLab supported */}
      {repositoryTree && !isGitHub && (
        <FileUploadDialog
          open={isUploadDialogOpen}
          onOpenChange={setIsUploadDialogOpen}
          repoId={repoId}
          repositoryTree={repositoryTree}
          provider={repoProvider}
          branch={repoBranch}
          onUploadSuccess={() => {
            queryClient.invalidateQueries({ queryKey: treeQueryKey });
            if (selectedPath) {
              queryClient.invalidateQueries({
                queryKey: [...fileQueryKeyPrefix, selectedPath],
              });
            }
          }}
        />
      )}

      {/* Delete Confirmation Dialog */}
      <AlertDialog
        open={isDeleteDialogOpen}
        onOpenChange={setIsDeleteDialogOpen}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete File</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete <strong>{fileToDelete}</strong>?
              This action cannot be undone.
              {isLoadingLinkedProjects && (
                <div className="mt-2 text-sm text-muted-foreground">
                  Checking linked projects for this file...
                </div>
              )}
              {!isLoadingLinkedProjects && linkedProjects && (
                <>
                  {linkedProjects.length > 0 ? (
                    <div className="mt-3 space-y-1 text-sm text-amber-700 dark:text-amber-300">
                      <div className="font-semibold">
                        Warning: this file is linked to{" "}
                        {linkedProjects.length} project
                        {linkedProjects.length > 1 ? "s" : ""}. Deleting it
                        will remove this file from their golden‑repo
                        reference.
                      </div>
                      <ul className="list-disc list-inside space-y-0.5">
                        {linkedProjects.map((p) => (
                          <li key={p.id}>
                            <span className="font-medium">{p.name}</span>
                            {p.description && (
                              <span className="text-muted-foreground">
                                {" "}
                                – {p.description}
                              </span>
                            )}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : (
                    <div className="mt-2 text-sm text-muted-foreground">
                      This file is not currently linked to any SDLC projects.
                    </div>
                  )}
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteConfirm}
              disabled={isDeleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeleting ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// exported for testing/debugging
export { collectPreselectionFiles };
