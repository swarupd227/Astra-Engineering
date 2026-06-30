import { useState, useEffect, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2, Search, X, Folder, File, Eye } from "lucide-react";
import { getApiUrl } from "@/lib/api-config";
import { useToast } from "@/hooks/use-toast";
import { GenericModal } from "@/components/ui/generic-modal";
import ReactMarkdown from "react-markdown";

interface GoldenRepoGuidelineSelectorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelectFiles: (
    files: { name: string; path: string; content: string }[],
  ) => void;
  selectedRepoId?: string;
  selectedRepoName?: string;
  linkedGoldenRepoOrg?: string;
  linkedGoldenRepoProject?: string;
  projectId?: string;
  scope?: "all" | "design";
  preselectedPaths?: string[];
  provider?: "ado" | "github" | "gitlab";
  repoUrl?: string;
  defaultBranch?: string;
}

function extractGitHubOwnerRepo(url?: string, repoName?: string): { owner: string; repo: string } {
  if (url) {
    try {
      const parts = new URL(url).pathname.split("/").filter(Boolean);
      if (parts.length >= 2) return { owner: parts[0], repo: parts[1] };
    } catch { /* invalid URL */ }
  }
  return { owner: "", repo: repoName || "" };
}

function getTreeUrl(
  provider: string,
  repoId: string,
  queryParams: URLSearchParams,
  ghOwner: string,
  ghRepo: string,
  defaultBranch?: string,
): string {
  if (defaultBranch) queryParams.set("branch", defaultBranch);
  const qs = queryParams.toString() ? `?${queryParams.toString()}` : "";
  if (provider === "github") return getApiUrl(`/api/github/repository/${encodeURIComponent(ghOwner)}/${encodeURIComponent(ghRepo)}/tree`) + qs;
  if (provider === "gitlab") return getApiUrl(`/api/gitlab/repository/${encodeURIComponent(repoId)}/tree`) + qs;
  return getApiUrl(`/api/ado/repository/${repoId}/tree`) + qs;
}

function getFileUrl(
  provider: string,
  repoId: string,
  params: URLSearchParams,
  ghOwner: string,
  ghRepo: string,
  defaultBranch?: string,
): string {
  if (defaultBranch && !params.has("branch")) params.set("branch", defaultBranch);
  const qs = params.toString();
  if (provider === "github") return `${getApiUrl(`/api/github/repository/${encodeURIComponent(ghOwner)}/${encodeURIComponent(ghRepo)}/file`)}?${qs}`;
  if (provider === "gitlab") return `${getApiUrl(`/api/gitlab/repository/${encodeURIComponent(repoId)}/file`)}?${qs}`;
  return `${getApiUrl(`/api/ado/repository/${repoId}/file`)}?${qs}`;
}

export function GoldenRepoGuidelineSelector({
  open,
  onOpenChange,
  onSelectFiles,
  selectedRepoId,
  selectedRepoName,
  linkedGoldenRepoOrg,
  linkedGoldenRepoProject,
  projectId,
  scope = "all",
  preselectedPaths,
  provider = "ado",
  repoUrl,
  defaultBranch,
}: GoldenRepoGuidelineSelectorProps) {
  const { owner: ghOwner, repo: ghRepo } = extractGitHubOwnerRepo(repoUrl, selectedRepoName);
  const [, setLocation] = useLocation();

  const openFullPreview = () => {
    if (!selectedRepoId) return;
    const params = new URLSearchParams({ repoId: selectedRepoId, provider });
    if (projectId) params.set("projectId", projectId);
    if (provider === "github" && repoUrl) {
      try {
        const parts = new URL(repoUrl).pathname.split("/").filter(Boolean);
        if (parts.length >= 2) {
          params.set("owner", parts[0]);
          params.set("name", parts[1]);
        }
      } catch { /* ignore */ }
    } else if (provider === "gitlab" && selectedRepoName) {
      params.set("name", selectedRepoName);
    }
    setLocation(`/golden-repos/preview?${params.toString()}`);
  };
  const { toast } = useToast();
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(
    new Set([scope === "design" ? "Design" : ""]),
  );

  // Preview functionality
  const [previewFile, setPreviewFile] = useState<{
    path: string;
    name: string;
    content: string;
  } | null>(null);
  const [isLoadingPreview, setIsLoadingPreview] = useState(false);

  // Reset/seed state when dialog opens/closes
  useEffect(() => {
    if (!open) {
      setSelectedPaths(new Set());
      setSearchQuery("");
      return;
    }
    // Seed selections on open (so checkboxes reflect saved project filePaths)
    if (preselectedPaths && preselectedPaths.length > 0) {
      setSelectedPaths(new Set(preselectedPaths.map(normalize)));
    }
  }, [open, preselectedPaths]);

  const normalize = (p: string): string =>
    String(p || "").replace(/\\/g, "/").replace(/^\/+/, "").replace(/\/+/g, "/");

  // Fetch repository file tree - optionally filtered to Design folder only
  const { data: repositoryData, isLoading: isRepositoryLoading } = useQuery({
    queryKey: [
      "repository-tree",
      selectedRepoId,
      "design-folder",
      linkedGoldenRepoOrg,
      linkedGoldenRepoProject,
      provider,
      defaultBranch,
    ],
    queryFn: async () => {
      const queryParams = new URLSearchParams({ isGoldenRepo: "true" });
      if (linkedGoldenRepoOrg)
        queryParams.append("linkedGoldenRepoOrg", linkedGoldenRepoOrg);
      if (linkedGoldenRepoProject)
        queryParams.append("linkedGoldenRepoProject", linkedGoldenRepoProject);

      const url = getTreeUrl(provider, selectedRepoId!, queryParams, ghOwner, ghRepo, defaultBranch);
      console.log("Fetching repository tree with URL:", url);

      const response = await fetch(url, {
        credentials: "include",
      });
      if (!response.ok) throw new Error("Failed to fetch file tree");
      const fullData = await response.json();

      if (scope === "all") {
        return {
          tree: fullData.tree || [],
          isEmpty: !fullData.tree || fullData.tree.length === 0,
          message: !fullData.tree || fullData.tree.length === 0 ? "No files found" : undefined,
        };
      }

      // Look for Design folder with multiple criteria - be more strict for design-only filtering
      const designFolder = fullData.tree?.find((node: any) => {
        const name = (node.name || "").toLowerCase();
        const path = (node.path || "").toLowerCase();
        console.log(
          `Checking node: name='${node.name}', path='${node.path}', type='${node.type}'`,
        );

        // Strict design folder matching
        const isDesignFolder =
          name === "design" ||
          name === "designs" ||
          name === "design-system" ||
          name === "ui-design" ||
          name === "ux" ||
          name === "mockups" ||
          name === "wireframes" ||
          path === "design" ||
          path === "designs" ||
          path.endsWith("/design") ||
          path.endsWith("\\design") ||
          path.endsWith("/designs") ||
          path.endsWith("\\designs") ||
          path.includes("/design/") ||
          path.includes("\\design\\") ||
          path.includes("/designs/") ||
          path.includes("\\designs\\") ||
          path.includes("/ui-design/") ||
          path.includes("\\ui-design\\") ||
          path.includes("/design-system/") ||
          path.includes("\\design-system\\");

        return (
          isDesignFolder &&
          (node.type === "folder" ||
            node.type === "tree" ||
            node.type === "dir")
        );
      });

      console.log("Found design folder:", designFolder);

      if (!designFolder) {
        // If no Design folder found, show all available folders for debugging
        const folders =
          fullData.tree?.filter(
            (node: any) => node.type === "folder" || node.type === "tree",
          ) || [];
        console.log(
          "Available folders:",
          folders.map((f: any) => f.name || f.path),
        );

        // Also check for design files in root level
        const designFiles =
          fullData.tree?.filter((node: any) => {
            const name = (node.name || "").toLowerCase();
            const isDesignFile =
              (node.type === "file" || node.type === "blob") &&
              (name.includes("design") ||
                name.includes("guideline") ||
                name.includes("component") ||
                name.includes("style") ||
                name.endsWith(".md") ||
                name.endsWith(".txt"));
            return isDesignFile;
          }) || [];

        if (designFiles.length > 0) {
          console.log("Found design files in root:", designFiles);
          return {
            tree: designFiles,
            isEmpty: false,
            message: undefined,
          };
        }

        return {
          tree: [],
          isEmpty: true,
          message: `Design folder not found. Available folders: ${folders.map((f: any) => f.name || f.path).join(", ")}`,
        };
      }

      // Use children if they exist, otherwise return empty (don't make another API call)
      let designFiles = [];
      if (designFolder.children && designFolder.children.length > 0) {
        // Filter for design-related files only
        designFiles = designFolder.children.filter((item: any) => {
          const name = (item.name || "").toLowerCase();
          const isFile = item.type === "file" || item.type === "blob";
          const isDesignFile =
            isFile &&
            (name.includes("design") ||
              name.includes("guideline") ||
              name.includes("component") ||
              name.includes("style") ||
              name.includes("pattern") ||
              name.includes("ui") ||
              name.includes("theme") ||
              name.includes("brand") ||
              name.endsWith(".md") ||
              name.endsWith(".txt") ||
              name.endsWith(".json") ||
              name.endsWith(".yml") ||
              name.endsWith(".yaml"));

          // Also include subfolders within design folder
          const isSubfolder =
            (item.type === "folder" || item.type === "tree") &&
            (name.includes("component") ||
              name.includes("pattern") ||
              name.includes("guideline") ||
              name.includes("style") ||
              name.includes("ui") ||
              name.includes("theme"));

          return isDesignFile || isSubfolder;
        });
        console.log("Filtered design files:", designFiles);
      }

      return {
        tree: designFiles,
        isEmpty: designFiles.length === 0,
        message:
          designFiles.length === 0
            ? "No files found in Design folder"
            : undefined,
      };
    },
    enabled: !!selectedRepoId && open,
    staleTime: 10 * 60 * 1000, // Cache for 10 minutes
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    retry: 1, // Only retry once
    retryOnMount: false,
  });

  // Create stable query key for file contents
  const selectedPathsString = Array.from(selectedPaths).sort().join(",");

  // Fetch file content
  const { data: fileContents } = useQuery({
    queryKey: ["file-contents", selectedRepoId, selectedPathsString],
    queryFn: async () => {
      const contents: Record<string, string> = {};

      for (const path of selectedPaths) {
        try {
          const fileParams = new URLSearchParams({ path });
          const response = await fetch(
            getFileUrl(provider, selectedRepoId!, fileParams, ghOwner, ghRepo, defaultBranch),
            { credentials: "include" },
          );
          if (response.ok) {
            const data = await response.json();
            contents[path] = data.content || "";
          }
        } catch (error) {
          console.error(`Failed to fetch file: ${path}`, error);
        }
      }
      return contents;
    },
    enabled: selectedPaths.size > 0 && !!selectedRepoId && open,
    staleTime: 10 * 60 * 1000, // Cache for 10 minutes
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    retry: 1,
    retryOnMount: false,
  });

  const handleTogglePath = useCallback(
    (path: string) => {
      const newSelected = new Set(selectedPaths);
      if (newSelected.has(path)) {
        newSelected.delete(path);
      } else {
        newSelected.add(path);
      }
      setSelectedPaths(newSelected);
    },
    [selectedPaths],
  );

  const collectSelectablePaths = useCallback((node: any, parentPath: string = scope === "design" ? "/Design" : ""): string[] => {
    if (!node) return [];

    const currentPath = normalize(node.path || `${parentPath}/${node.name}`);
    const isFolder =
      node.type === "folder" || node.type === "tree" || node.type === "dir";

    if (!isFolder) return [currentPath];

    return (node.children ?? []).flatMap((child: any) =>
      collectSelectablePaths(child, currentPath),
    );
  }, [scope]);

  const getFolderSelectionState = useCallback((paths: string[]): boolean | "indeterminate" => {
    if (paths.length === 0) return false;
    const selectedCount = paths.filter((path) => selectedPaths.has(path)).length;
    if (selectedCount === 0) return false;
    if (selectedCount === paths.length) return true;
    return "indeterminate";
  }, [selectedPaths]);

  const handleToggleFolderSelection = useCallback((node: any, parentPath?: string) => {
    const paths = collectSelectablePaths(node, parentPath);
    if (paths.length === 0) return;

    const allSelected = paths.every((path) => selectedPaths.has(path));
    const newSelected = new Set(selectedPaths);

    for (const path of paths) {
      if (allSelected) {
        newSelected.delete(path);
      } else {
        newSelected.add(path);
      }
    }

    setSelectedPaths(newSelected);
  }, [collectSelectablePaths, selectedPaths]);

  const handleToggleFolder = useCallback(
    (folderPath: string) => {
      const newExpanded = new Set(expandedFolders);
      if (newExpanded.has(folderPath)) {
        newExpanded.delete(folderPath);
      } else {
        newExpanded.add(folderPath);
      }
      setExpandedFolders(newExpanded);
    },
    [expandedFolders],
  );

  const handleSelectFiles = async () => {
    if (selectedPaths.size === 0) {
      toast({
        title: "No Files Selected",
        description: "Please select at least one guideline file",
        variant: "destructive",
      });
      return;
    }

    const selectedFiles = Array.from(selectedPaths).map((path) => ({
      name: path.split("/").pop() || path,
      path,
      content: fileContents?.[path] || "",
    }));

    onSelectFiles(selectedFiles);
    setSelectedPaths(new Set());
    onOpenChange(false);
  };

  // Handle file preview
  const handlePreviewFile = async (path: string, fileName: string) => {
    if (!selectedRepoId) {
      toast({
        title: "Preview Not Available",
        description: "Repository information not available",
        variant: "destructive",
      });
      return;
    }

    setIsLoadingPreview(true);
    try {
      const params = new URLSearchParams({ isGoldenRepo: "true" });
      params.append("path", path);
      if (linkedGoldenRepoOrg) {
        params.append("linkedGoldenRepoOrg", linkedGoldenRepoOrg);
      }
      if (linkedGoldenRepoProject) {
        params.append("linkedGoldenRepoProject", linkedGoldenRepoProject);
      }

      const url = getFileUrl(provider, selectedRepoId!, params, ghOwner, ghRepo, defaultBranch);
      console.log("[Preview] Fetching file content from:", url);

      const response = await fetch(url, {
        credentials: "include",
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      console.log("[Preview] File content loaded:", {
        path,
        contentLength: data.content?.length,
      });

      setPreviewFile({
        path,
        name: fileName,
        content: data.content || "No content available",
      });
    } catch (error: any) {
      console.error("[Preview] Error loading file:", error);
      toast({
        title: "Preview Failed",
        description: `Failed to load ${fileName}: ${error.message || "Unknown error"}`,
        variant: "destructive",
      });
    } finally {
      setIsLoadingPreview(false);
    }
  };

  const renderFileTree = (node: any, parentPath: string = scope === "design" ? "/Design" : "") => {
    if (!node) return null;

    const currentPath = normalize(node.path || `${parentPath}/${node.name}`);
    const isExpanded = expandedFolders.has(currentPath);
    const isFolder =
      node.type === "folder" || node.type === "tree" || node.type === "dir";
    const selectablePaths = isFolder ? collectSelectablePaths(node, parentPath) : [];
    const folderSelectionState = isFolder
      ? getFolderSelectionState(selectablePaths)
      : false;

    // Apply search filter
    const matchesSearch =
      !searchQuery ||
      node.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (scope === "design" &&
        ((node.name.toLowerCase().includes("design") &&
          searchQuery.toLowerCase().includes("design")) ||
          (node.name.toLowerCase().includes("guideline") &&
            searchQuery.toLowerCase().includes("guide")) ||
          (node.name.toLowerCase().includes("component") &&
            searchQuery.toLowerCase().includes("comp")) ||
          (node.name.toLowerCase().includes("style") &&
            searchQuery.toLowerCase().includes("style")) ||
          (node.name.toLowerCase().includes("pattern") &&
            searchQuery.toLowerCase().includes("pattern"))));

    if (!matchesSearch) return null;

    console.log(
      `Rendering node: ${node.name}, type: ${node.type}, isFolder: ${isFolder}`,
    );

    return (
      <div key={currentPath}>
        <div className="flex items-center gap-2 py-1 px-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded">
          {isFolder && (
            <Button
              size="sm"
              variant="ghost"
              className="h-5 w-5 p-0"
              onClick={() => handleToggleFolder(currentPath)}
            >
              {isExpanded ? "▼" : "▶"}
            </Button>
          )}
          {!isFolder && <div className="w-5" />}

          {isFolder && (
            <Checkbox
              checked={folderSelectionState}
              onClick={(e) => e.stopPropagation()}
              onCheckedChange={() => handleToggleFolderSelection(node, parentPath)}
              disabled={selectablePaths.length === 0}
            />
          )}

          {isFolder ? (
            <Folder className="h-4 w-4 text-blue-500" />
          ) : (
            <File className="h-4 w-4 text-gray-500" />
          )}

          {!isFolder && (
            <Checkbox
              checked={selectedPaths.has(currentPath)}
              onCheckedChange={() => handleTogglePath(currentPath)}
            />
          )}

          <span className="text-sm flex-1">{node.name}</span>

          {!isFolder && (
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 flex-shrink-0 bg-black hover:bg-gray-800 border border-gray-600"
              onClick={(e) => {
                e.stopPropagation();
                console.log(
                  "[Preview] Clicking preview for:",
                  currentPath,
                  node.name,
                );
                handlePreviewFile(currentPath, node.name);
              }}
              disabled={isLoadingPreview}
              title="Preview content"
            >
              {isLoadingPreview ? (
                <Loader2 className="h-4 w-4 animate-spin text-white" />
              ) : (
                <Eye className="h-4 w-4 text-white" />
              )}
            </Button>
          )}
        </div>

        {isFolder && isExpanded && node.children && (
          <div className="ml-4">
            {node.children.map((child: any) =>
              renderFileTree(child, currentPath),
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-hidden">
        <DialogHeader>
          <div className="flex justify-between items-center w-full">
            <DialogTitle>
              Select Design Guidelines from {selectedRepoName}
            </DialogTitle>
            {selectedRepoId && (
              <Button
                size="sm"
                variant="ghost"
                onClick={openFullPreview}
                className="flex items-center gap-1"
              >
                <Eye className="h-4 w-4" />
                <span>Full Preview</span>
              </Button>
            )}
          </div>
        </DialogHeader>

        <div className="space-y-4">
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-500" />
            <Input
              placeholder="Search design guidelines, components, styles..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
            />
          </div>

          {/* File Tree */}
          <div className="border border-gray-200 dark:border-gray-700 rounded-lg p-4 max-h-[400px] overflow-y-auto bg-gray-50 dark:bg-gray-900">
            {isRepositoryLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-blue-600" />
              </div>
            ) : repositoryData?.tree && repositoryData.tree.length > 0 ? (
              <div className="space-y-1">
                {repositoryData.tree.map((node: any) => renderFileTree(node))}
              </div>
            ) : (
              <div className="text-sm text-gray-500 py-8 text-center">
                No design guidelines found in repository
                {repositoryData?.message && (
                  <div className="mt-2 text-xs">{repositoryData.message}</div>
                )}
              </div>
            )}
          </div>

          {/* Selected count */}
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-600 dark:text-gray-400">
              {selectedPaths.size} file(s) selected
            </span>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button
                onClick={handleSelectFiles}
                disabled={selectedPaths.size === 0 || !fileContents}
                className="bg-blue-600 hover:bg-blue-700 text-white"
              >
                {!fileContents ? (
                  <>
                    <Loader2 className="h-3 w-3 mr-2 animate-spin" />
                    Loading...
                  </>
                ) : (
                  "Add Guidelines"
                )}
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>

      {/* Preview Modal */}
      <GenericModal
        open={!!previewFile}
        onOpenChange={(isOpen) => !isOpen && setPreviewFile(null)}
        title={previewFile ? `Preview: ${previewFile.name}` : "Preview"}
        description={previewFile?.path}
        icon={Eye}
        iconClassName="bg-gradient-to-br from-purple-500 to-purple-600"
        width="1200px"
        maxHeight="90vh"
        contentClassName="flex flex-col"
        footerButtons={[
          {
            label: "Close",
            onClick: () => setPreviewFile(null),
            variant: "outline",
          },
        ]}
      >
        {/*
          flex-1 + min-h-0 lets the bordered preview box fill the entire modal
          content area instead of being capped at h-[70vh] (which left a blank
          gap below the preview and made long markdown look truncated).
        */}
        <div className="flex-1 min-h-0 w-full border rounded-lg overflow-y-auto p-6 scrollbar-thin">
          {isLoadingPreview ? (
            <div className="flex items-center justify-center h-32">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : previewFile ? (
            <div className="prose prose-lg dark:prose-invert max-w-none">
              <ReactMarkdown>{previewFile.content}</ReactMarkdown>
            </div>
          ) : null}
        </div>
      </GenericModal>
    </Dialog>
  );
}
