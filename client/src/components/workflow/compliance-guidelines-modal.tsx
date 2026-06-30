import { useState, useEffect, useRef } from "react";
import { GenericModal } from "@/components/ui/generic-modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Loader2,
  ChevronRight,
  ChevronDown,
  FileText,
  Folder,
  Search,
  X,
  AlertCircle,
  Eye,
} from "lucide-react";
import { useSDLCProject } from "@/context/sdlc-project-context";
import {
  useWorkflow,
  type ComplianceGuideline,
} from "@/context/workflow-context";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Alert, AlertDescription } from "@/components/ui/alert";
import ReactMarkdown from "react-markdown";
import {
  buildGoldenRepoConfigFromProject,
} from "@/lib/golden-repositories";

interface FileTreeNode {
  name: string;
  path: string;
  type: "folder" | "file";
  size?: number;
  children?: FileTreeNode[];
}

interface RepositoryConfig {
  repositoryId: string | null;
  organization: string;
  projectName: string;
  patToken: string;
  provider?: "ado" | "github" | "gitlab";
  url?: string;
}

interface ComplianceGuidelinesModalProps {
  open: boolean;
  onClose: () => void;
  /** Markdown file paths from project's goldenRepoReference.filePaths (used when tree API returns empty) */
  goldenRepoFilePaths?: string[];
  /** Golden repo config from details API (avoids relying on context timing) */
  repositoryConfigFromProject?: RepositoryConfig | null;
  /** Project identifier (adoProjectId or projectId) – when set and no config from props/context, modal fetches details to get golden repo config */
  projectIdentifier?: string | null;
}

function buildFileApiUrl(config: RepositoryConfig, filePath: string): string {
  const prov = config.provider || "ado";
  const params = new URLSearchParams();
  params.append("path", filePath);

  if (prov === "github" && config.url) {
    try {
      const parts = new URL(config.url).pathname.split("/").filter(Boolean);
      if (parts.length >= 2) {
        return `/api/github/repository/${encodeURIComponent(parts[0])}/${encodeURIComponent(parts[1])}/file?${params.toString()}`;
      }
    } catch { /* fall through */ }
  }
  if (prov === "gitlab") {
    return `/api/gitlab/repository/${encodeURIComponent(config.repositoryId!)}/file?${params.toString()}&isGoldenRepo=true`;
  }

  if (config.organization) {
    params.append("organization", config.organization);
    params.append("linkedGoldenRepoOrg", config.organization);
  }
  if (config.projectName) {
    params.append("projectName", config.projectName);
    params.append("linkedGoldenRepoProject", config.projectName);
  }
  return `/api/ado/repository/${config.repositoryId}/file?${params.toString()}`;
}

const GUIDELINE_EXTENSIONS = [".md", ".txt", ".yml", ".yaml", ".pdf"];

function isGuidelineFile(name: string): boolean {
  const lower = name.toLowerCase();
  if (GUIDELINE_EXTENSIONS.some((ext) => lower.endsWith(ext))) return true;
  // Extension-less files (e.g. CODEOWNERS, Dockerfile, LICENSE) are plain text
  // and are chunkable, so allow selecting them as guidelines too.
  const baseName = lower.split("/").pop() || "";
  return baseName.lastIndexOf(".") <= 0;
}

function normalizeGuidelinePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\/+/, "");
}

function getKnownFileSize(size: unknown): number | null {
  if (typeof size !== "number" || !Number.isFinite(size) || size <= 0) return null;
  return size;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function buildTreeFromFilePaths(filePaths: string[]): FileTreeNode[] {
  const paths = filePaths.filter((p) => isGuidelineFile(p));
  return paths.map((rawPath) => {
    const normalized = normalizeGuidelinePath(rawPath);
    const parts = normalized.split("/");
    const name = parts[parts.length - 1] || normalized;
    return { name, path: normalized, type: "file" as const };
  });
}

export function ComplianceGuidelinesModal({
  open,
  onClose,
  goldenRepoFilePaths,
  repositoryConfigFromProject,
  projectIdentifier,
}: ComplianceGuidelinesModalProps) {
  const { repositoryConfig } = useWorkflow();
  const { setComplianceGuidelines } = useWorkflow();
  const { toast } = useToast();

  // Config from context, props, or fetched by modal when opening with projectIdentifier
  const [fetchedProjectConfig, setFetchedProjectConfig] = useState<RepositoryConfig | null>(null);
  const effectiveRepositoryConfig =
    repositoryConfigFromProject ?? fetchedProjectConfig ?? repositoryConfig ?? null;

  const [isLoadingTree, setIsLoadingTree] = useState(false);
  const [isFetchingContent, setIsFetchingContent] = useState(false);
  const [tree, setTree] = useState<FileTreeNode[]>([]);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(
    new Set()
  );
  const [selectedFiles, setSelectedFiles] = useState<Map<string, FileTreeNode>>(
    new Map()
  );
  const [searchQuery, setSearchQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [previewFile, setPreviewFile] = useState<{
    node: FileTreeNode;
    content: string;
  } | null>(null);
  const [isLoadingPreview, setIsLoadingPreview] = useState(false);
  const [loadedConfig, setLoadedConfig] = useState<RepositoryConfig | null>(
    null
  );
  const [isLoadingConfig, setIsLoadingConfig] = useState(false);
  const [isFetchingProjectDetails, setIsFetchingProjectDetails] = useState(false);

  // Fallback list from project's goldenRepoReference.filePaths (.md and .txt)
  const treeFromFilePaths =
    goldenRepoFilePaths?.length ? buildTreeFromFilePaths(goldenRepoFilePaths) : [];
  const displayTree = tree.length > 0 ? tree : treeFromFilePaths;

  // Initialize selection from sdlc_projects.golden_repo_reference.filePaths when the modal opens.
  // This makes previously-saved selections show as pre-checked in the UI.
  const seededSelectionKeyRef = useRef<string | null>(null);
  useEffect(() => {
    // Debug logging to verify data flowing into modal
    // NOTE: keep this while verifying goldenRepoReference wiring; safe to remove later if too noisy.
    console.log(
      "[ComplianceGuidelinesModal] open=",
      open,
      "goldenRepoFilePaths=",
      goldenRepoFilePaths,
    );

    if (!open) {
      seededSelectionKeyRef.current = null;
      setSelectedFiles(new Map());
      return;
    }

    const paths = (goldenRepoFilePaths ?? [])
      .filter((p) => isGuidelineFile(p))
      .map((p) => normalizeGuidelinePath(p));
    const key = [...paths].sort().join("|");
    if (seededSelectionKeyRef.current === key) return;
    seededSelectionKeyRef.current = key;

    const initial = new Map<string, FileTreeNode>();
    for (const path of paths) {
      const parts = path.split("/");
      const name = parts[parts.length - 1] || path;
      initial.set(path, { name, path, type: "file" });
    }
    setSelectedFiles(initial);
  }, [open, goldenRepoFilePaths]);

  // When modal opens without config but with projectIdentifier, fetch project details to get golden repo config
  useEffect(() => {
    if (!open) {
      setFetchedProjectConfig(null);
      return;
    }
    if (effectiveRepositoryConfig?.repositoryId || !projectIdentifier) return;

    let cancelled = false;
    setIsFetchingProjectDetails(true);
    setError(null);
    apiRequest("GET", `/api/sdlc/projects/by-ado/${encodeURIComponent(projectIdentifier)}/details`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("Failed to load project"))))
      .then((data) => {
        if (cancelled) return;
        const p = data?.project as Record<string, unknown> | undefined;
        const effectiveAdoRepositoryId = (data as { effectiveAdoRepositoryId?: string })?.effectiveAdoRepositoryId;
        const config = p ? buildGoldenRepoConfigFromProject(p, effectiveAdoRepositoryId) : null;
        if (config) setFetchedProjectConfig(config);
      })
      .catch(() => {
        if (!cancelled) setFetchedProjectConfig(null);
      })
      .finally(() => {
        if (!cancelled) setIsFetchingProjectDetails(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, projectIdentifier, effectiveRepositoryConfig?.repositoryId]);

  // Fetch tree when effective config is available (from context, props, or fetched by modal)
  useEffect(() => {
    if (!open) return;
    if (effectiveRepositoryConfig?.repositoryId) {
      setError(null);
      fetchRepositoryConfigAndTree();
    } else if (goldenRepoFilePaths?.length) {
      setError(null);
    } else if (!isFetchingProjectDetails) {
      setError(
        "No linked Golden Repository. Edit this project (from Projects or SDLC) and link a Golden Repo to select guidelines."
      );
    } else {
      setError(null);
    }
  }, [open, effectiveRepositoryConfig?.repositoryId, effectiveRepositoryConfig?.organization, effectiveRepositoryConfig?.projectName, goldenRepoFilePaths?.length, isFetchingProjectDetails]);

  // Use effective config (context or props from details API). Server resolves PAT from org/project when calling tree/file APIs.
  const fetchRepositoryConfigAndTree = async () => {
    if (!effectiveRepositoryConfig?.repositoryId) {
      setError("Please select a Golden Repository first");
      return;
    }

    setIsLoadingConfig(true);
    setError(null);

    try {
      setLoadedConfig(effectiveRepositoryConfig);
      await fetchRepositoryTree(effectiveRepositoryConfig);
    } catch (err) {
      const errorMessage =
        err instanceof Error
          ? err.message
          : "Failed to load repository";
      if (goldenRepoFilePaths?.length) {
        setError(null);
      } else {
        setError(errorMessage);
        toast({
          title: "Error",
          description: errorMessage,
          variant: "destructive",
        });
      }
    } finally {
      setIsLoadingConfig(false);
    }
  };

  const fetchRepositoryTree = async (config?: RepositoryConfig) => {
    const activeConfig = config || loadedConfig || effectiveRepositoryConfig;

    if (!activeConfig?.repositoryId) {
      setError("Please select a Golden Repository first");
      return;
    }

    setIsLoadingTree(true);
    setError(null);

    try {
      const url = (() => {
        const prov = activeConfig.provider || "ado";
        const params = new URLSearchParams();

        if (prov === "github" && activeConfig.url) {
          try {
            const parts = new URL(activeConfig.url).pathname.split("/").filter(Boolean);
            if (parts.length >= 2) {
              return `/api/github/repository/${encodeURIComponent(parts[0])}/${encodeURIComponent(parts[1])}/tree`;
            }
          } catch { /* fall through */ }
        }
        if (prov === "gitlab") {
          return `/api/gitlab/repository/${encodeURIComponent(activeConfig.repositoryId!)}/tree?isGoldenRepo=true`;
        }

        const base = `/api/ado/repository/${activeConfig.repositoryId}/tree`;
        if (activeConfig.organization) {
          params.append("organization", activeConfig.organization);
          params.append("linkedGoldenRepoOrg", activeConfig.organization);
        }
        if (activeConfig.projectName) {
          params.append("projectName", activeConfig.projectName);
          params.append("linkedGoldenRepoProject", activeConfig.projectName);
        }
        return params.toString() ? `${base}?${params.toString()}` : base;
      })();

      const response = await apiRequest("GET", url);

      if (!response.ok) {
        if (response.status === 401) {
          throw new Error("Invalid PAT token");
        } else if (response.status === 404) {
          throw new Error("Repository not found");
        } else if (response.status === 403) {
          throw new Error("PAT token needs Code (Read) permission");
        }
        throw new Error("Failed to load repository");
      }

      const data = await response.json();
      setTree(data.tree || []);
    } catch (err) {
      const errorMessage =
        err instanceof Error
          ? err.message
          : "Failed to load repository. Please try again";
      setError(errorMessage);
      toast({
        title: "Error",
        description: errorMessage,
        variant: "destructive",
      });
    } finally {
      setIsLoadingTree(false);
    }
  };

  const toggleFolder = (path: string) => {
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  };

  const toggleFileSelection = (node: FileTreeNode) => {
    const normalizedPath = normalizeGuidelinePath(node.path);
    const normalizedNode: FileTreeNode = { ...node, path: normalizedPath };
    setSelectedFiles((prev) => {
      const next = new Map(prev);
      if (next.has(normalizedPath)) {
        next.delete(normalizedPath);
      } else {
        next.set(normalizedPath, normalizedNode);
      }
      return next;
    });
  };

  const collectSelectableFiles = (node: FileTreeNode): FileTreeNode[] => {
    if (node.type === "file") {
      return isGuidelineFile(node.name)
        ? [{ ...node, path: normalizeGuidelinePath(node.path) }]
        : [];
    }

    return (node.children ?? []).flatMap((child) => collectSelectableFiles(child));
  };

  const getFolderSelectionState = (node: FileTreeNode): boolean | "indeterminate" => {
    const files = collectSelectableFiles(node);
    if (files.length === 0) return false;

    const selectedCount = files.filter((file) =>
      selectedFiles.has(normalizeGuidelinePath(file.path))
    ).length;

    if (selectedCount === 0) return false;
    if (selectedCount === files.length) return true;
    return "indeterminate";
  };

  const toggleFolderSelection = (node: FileTreeNode) => {
    const files = collectSelectableFiles(node);
    if (files.length === 0) return;

    setSelectedFiles((prev) => {
      const next = new Map(prev);
      const allSelected = files.every((file) =>
        next.has(normalizeGuidelinePath(file.path))
      );

      for (const file of files) {
        const normalizedPath = normalizeGuidelinePath(file.path);
        if (allSelected) {
          next.delete(normalizedPath);
        } else {
          next.set(normalizedPath, { ...file, path: normalizedPath });
        }
      }

      return next;
    });
  };

  const removeSelectedFile = (path: string) => {
    setSelectedFiles((prev) => {
      const next = new Map(prev);
      next.delete(path);
      return next;
    });
  };

  const handlePreviewFile = async (node: FileTreeNode) => {
    const activeConfig = loadedConfig || effectiveRepositoryConfig;

    if (!activeConfig?.repositoryId) {
      toast({
        title: "Error",
        description: "Repository configuration not available",
        variant: "destructive",
      });
      return;
    }

    setIsLoadingPreview(true);
    try {
      const response = await apiRequest(
        "GET",
        buildFileApiUrl(activeConfig, node.path)
      );

      if (!response.ok) {
        throw new Error(`Failed to fetch ${node.name}`);
      }

      const data = await response.json();
      setPreviewFile({ node, content: data.content || "" });
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : "Failed to load preview";
      toast({
        title: "Preview Error",
        description: errorMessage,
        variant: "destructive",
      });
    } finally {
      setIsLoadingPreview(false);
    }
  };

  const handleApplyGuidelines = async () => {
    if (selectedFiles.size === 0) {
      toast({
        title: "No files selected",
        description: "Please select at least one guideline file",
        variant: "destructive",
      });
      return;
    }

    // Validate file count and size limits
    if (selectedFiles.size > 10) {
      toast({
        title: "Too many files",
        description: "Maximum 10 files can be selected",
        variant: "destructive",
      });
      return;
    }

    setIsFetchingContent(true);
    setError(null);

    try {
      const activeConfig = loadedConfig || effectiveRepositoryConfig;

      if (!activeConfig?.repositoryId) {
        throw new Error("Repository configuration not available");
      }

      const guidelines: ComplianceGuideline[] = [];
      let totalSize = 0;

      const filesArray = Array.from(selectedFiles);
      for (const [path, node] of filesArray) {
        try {
          const response = await apiRequest(
            "GET",
            buildFileApiUrl(activeConfig, path)
          );

          if (!response.ok) {
            throw new Error(`Failed to fetch ${node.name}`);
          }

          const data = await response.json();
          const content = data.content || "";

          // Check individual file size (500KB max)
          const fileSize = new Blob([content]).size;
          if (fileSize > 500 * 1024) {
            throw new Error(`File ${node.name} exceeds 500KB limit`);
          }

          totalSize += fileSize;

          // Check total size (2MB max)
          if (totalSize > 2 * 1024 * 1024) {
            throw new Error("Total file size exceeds 2MB limit");
          }

          guidelines.push({
            id: path,
            name: node.name,
            path: path,
            content: content,
          });
        } catch (err) {
          console.error(`Error fetching file ${path}:`, err);
          throw err;
        }
      }

      setComplianceGuidelines(guidelines);

      toast({
        title: "Guidelines Applied",
        description: `${guidelines.length} compliance guideline${
          guidelines.length > 1 ? "s" : ""
        } have been applied`,
      });

      onClose();
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : "Failed to fetch file contents";
      setError(errorMessage);
      toast({
        title: "Error",
        description: errorMessage,
        variant: "destructive",
      });
    } finally {
      setIsFetchingContent(false);
    }
  };

  const handleSkip = () => {
    onClose();
  };

  const renderTreeNode = (
    node: FileTreeNode,
    level: number = 0
  ): JSX.Element | null => {
    const isGuideline =
      node.type === "file" && isGuidelineFile(node.name);
    const isFolder = node.type === "folder";
    const normalizedPath = normalizeGuidelinePath(node.path);
    const isExpanded = expandedFolders.has(normalizedPath);
    const isSelected = selectedFiles.has(normalizedPath);
    const folderSelectionState = isFolder ? getFolderSelectionState(node) : false;
    const knownSize = getKnownFileSize(node.size);

    // Apply search filter
    const matchesSearch =
      !searchQuery ||
      node.name.toLowerCase().includes(searchQuery.toLowerCase());

    if (!matchesSearch && !isFolder) {
      return null;
    }

    // Show all folders; show all files. .md and .txt are selectable as guidelines
    const isSelectableFile = isGuideline;

    const hasMatchingChildren =
      isFolder &&
      node.children?.some((child) => renderTreeNode(child, level + 1) !== null);

    if (!matchesSearch && !hasMatchingChildren) {
      return null;
    }

    return (
      <div key={normalizedPath} className="select-none">
        <div
          className={`flex items-center gap-2 px-3 py-2 hover-elevate rounded-md ${
            isFolder ? "cursor-pointer" : isSelectableFile ? "cursor-pointer" : "cursor-default opacity-75"
          } ${isSelected ? "bg-primary/10" : ""}`}
          style={{ paddingLeft: `${level * 16 + 12}px` }}
          onClick={() => {
            if (isFolder) {
              toggleFolder(normalizedPath);
            } else if (isSelectableFile) {
              toggleFileSelection(node);
            }
          }}
          data-testid={isFolder ? `folder-${node.name}` : `file-${node.name}`}
        >
          {isFolder && (
            <>
              <div className="w-4 h-4 flex items-center justify-center">
                {isExpanded ? (
                  <ChevronDown className="h-4 w-4 text-muted-foreground" />
                ) : (
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                )}
              </div>
              <Checkbox
                checked={folderSelectionState}
                onCheckedChange={() => toggleFolderSelection(node)}
                onClick={(e) => e.stopPropagation()}
                disabled={collectSelectableFiles(node).length === 0}
                data-testid={`checkbox-folder-${node.name}`}
              />
            </>
          )}
          {!isFolder && (
            isSelectableFile ? (
              <Checkbox
                checked={isSelected}
                onCheckedChange={() => toggleFileSelection(node)}
                onClick={(e) => e.stopPropagation()}
                data-testid={`checkbox-file-${node.name}`}
              />
            ) : (
              <span className="w-4 h-4 flex items-center justify-center flex-shrink-0" />
            )
          )}
          {isFolder ? (
            <Folder className="h-4 w-4 text-blue-500" />
          ) : (
            <FileText className="h-4 w-4 text-muted-foreground" />
          )}
          <span className="text-sm flex-1 min-w-0 truncate">{node.name}</span>
          {knownSize !== null && (
            <span className="text-xs text-muted-foreground flex-shrink-0">
              {formatFileSize(knownSize)}
            </span>
          )}
        </div>

        {isFolder && isExpanded && node.children && (
          <div>
            {node.children.map((child) => renderTreeNode(child, level + 1))}
          </div>
        )}
      </div>
    );
  };

  return (
    <>
      <GenericModal
        open={open}
        onOpenChange={(isOpen) => !isOpen && onClose()}
        title="Select Compliance Guidelines"
        description="Select guideline files (.md, .txt, .yml/.yaml, .pdf, or files with no extension like CODEOWNERS) from your Golden Repository to use as compliance guidelines for artifact generation"
        icon={FileText}
        iconClassName="bg-gradient-to-br from-blue-500 to-blue-600"
        width="1280px"
        maxHeight="80vh"
        contentClassName="space-y-4"
        footerButtons={[
          {
            label: "Skip",
            onClick: handleSkip,
            variant: "outline",
            disabled: isFetchingContent,
            "data-testid": "button-skip-guidelines",
          },
          {
            label: isFetchingContent
              ? "Fetching Content..."
              : `Apply Guidelines (${selectedFiles.size})`,
            onClick: handleApplyGuidelines,
            disabled: selectedFiles.size === 0 || isFetchingContent,
            loading: isFetchingContent,
            "data-testid": "button-apply-guidelines",
          },
        ]}
      >
        {error && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {/* 
          Critical: min-h-0 on flex containers allows proper scrolling in flexbox.
          Without it, flex children won't shrink below their content size, preventing overflow.
        */}
        <div className="flex gap-4 flex-1 min-h-0">
          {/* Left Panel: Repository Tree */}
          <div className="flex-1 border rounded-lg flex flex-col min-h-0 overflow-hidden">
            <div className="p-3 border-b flex-shrink-0">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search files..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9"
                  data-testid="input-search-files"
                />
              </div>
            </div>

            {/* Scrollable tree container with min-h-0 to allow flex shrinking */}
            <div className="flex-1 min-h-0 overflow-y-auto p-2 scrollbar-thin">
              {isFetchingProjectDetails || isLoadingConfig || isLoadingTree ? (
                <div className="flex items-center justify-center h-32">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : displayTree.length === 0 ? (
                <div className="flex items-center justify-center h-32 text-muted-foreground text-sm">
                  No guideline files found
                </div>
              ) : (
                <div className="space-y-1 pr-2">
                  {displayTree.map((node) => renderTreeNode(node))}
                </div>
              )}
            </div>
          </div>

          {/* Right Panel: Selected Files */}
          <div className="flex-1 border rounded-lg flex flex-col min-h-0 overflow-hidden">
            <div className="p-3 border-b flex-shrink-0">
              <h3 className="font-medium text-sm">
                Selected Files ({selectedFiles.size})
              </h3>
            </div>

            {/* Scrollable selected files container with min-h-0 to allow flex shrinking */}
            <div className="flex-1 min-h-0 overflow-y-auto p-2 scrollbar-thin">
              {selectedFiles.size === 0 ? (
                <div className="flex items-center justify-center h-32 text-muted-foreground text-sm">
                  No files selected
                </div>
              ) : (
                <div className="space-y-2 pr-2">
                  {Array.from(selectedFiles).map(([path, node]) => (
                    <div
                      key={path}
                      className="flex items-center gap-2 p-2 border rounded-md bg-card hover-elevate"
                      data-testid={`selected-file-${node.name}`}
                    >
                      <FileText className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium truncate">
                          {node.name}
                        </div>
                        <div className="text-xs text-muted-foreground truncate">
                          {path}
                        </div>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 flex-shrink-0"
                        onClick={() => handlePreviewFile(node)}
                        data-testid={`button-preview-${node.name}`}
                        title="Preview content"
                      >
                        <Eye className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 flex-shrink-0"
                        onClick={() => removeSelectedFile(path)}
                        data-testid={`button-remove-${node.name}`}
                        title="Remove"
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {selectedFiles.size > 0 && (
              <div className="p-3 border-t flex-shrink-0 text-xs text-muted-foreground">
                Maximum 10 files, 500KB each, 2MB total
              </div>
            )}
          </div>
        </div>
      </GenericModal>

      {/* Preview Dialog */}
      <GenericModal
        open={!!previewFile}
        onOpenChange={(isOpen) => !isOpen && setPreviewFile(null)}
        title={previewFile ? `Preview: ${previewFile.node.name}` : "Preview"}
        description={previewFile?.node.path}
        icon={Eye}
        iconClassName="bg-gradient-to-br from-purple-500 to-purple-600"
        width="1024px"
        maxHeight="90vh"
        contentClassName="flex flex-col"
        footerButtons={[
          {
            label: "Close",
            onClick: () => setPreviewFile(null),
            variant: "outline",
            "data-testid": "button-close-preview",
          },
        ]}
      >
        {/*
          Fill the entire modal content area with a single scrollable bordered box
          (flex-1 + min-h-0 lets it shrink/grow inside the flex column instead of
          being capped at an arbitrary max-h-[60vh], which was leaving a big blank
          gap below the preview and making long markdown look "chopped").
        */}
        <div className="flex-1 min-h-0 border rounded-lg overflow-y-auto p-4 scrollbar-thin">
          {isLoadingPreview ? (
            <div className="flex items-center justify-center h-32">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : previewFile ? (
            <div className="prose prose-sm dark:prose-invert max-w-none">
              {previewFile.node.name.toLowerCase().endsWith(".md") ? (
                <ReactMarkdown>{previewFile.content}</ReactMarkdown>
              ) : (
                <pre className="whitespace-pre-wrap font-sans text-sm bg-muted/50 p-4 rounded-lg overflow-x-auto">
                  {previewFile.content}
                </pre>
              )}
            </div>
          ) : null}
        </div>
      </GenericModal>
    </>
  );
}
