import { useState, useEffect } from "react";
import {
  ChevronRight,
  ChevronDown,
  Folder,
  FolderOpen,
  File,
  FileCode,
  FileText,
  FileJson,
  FileImage,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { isInStarterCode, normalizePath } from "@/contexts/golden-repo-selection-context";
import { Checkbox } from "@/components/ui/checkbox";

interface FileTreeNodeProps {
  node: {
    name: string;
    type: "file" | "folder";
    path: string;
    children?: any[];
    size?: number;
  };
  onFileSelect: (path: string) => void;
  selectedPath: string | null;
  searchQuery?: string;
  level?: number;
  repoId?: string;
  repoName?: string;
  preselectedPaths?: string[];
  chunkedPaths?: string[];
  onChunkFile?: (path: string) => void;
  isChunking?: boolean;
  chunkingPath?: string;
  chunkElapsedMs?: number;
  selectedPaths?: string[];
  onTogglePathSelection?: (path: string, checked: boolean) => void;
}

const getFileIcon = (fileName: string | undefined) => {
  if (!fileName) return <File className="h-4 w-4 text-gray-400" />;
  const ext = fileName.split(".").pop()?.toLowerCase();

  switch (ext) {
    case "js":
    case "jsx":
    case "ts":
    case "tsx":
    case "py":
    case "java":
    case "cpp":
    case "c":
    case "cs":
    case "go":
    case "rs":
    case "rb":
    case "php":
      return <FileCode className="h-4 w-4 text-blue-500" />;
    case "json":
    case "yaml":
    case "yml":
    case "xml":
      return <FileJson className="h-4 w-4 text-amber-500" />;
    case "md":
    case "txt":
    case "doc":
    case "docx":
      return <FileText className="h-4 w-4 text-gray-500" />;
    case "png":
    case "jpg":
    case "jpeg":
    case "gif":
    case "svg":
      return <FileImage className="h-4 w-4 text-emerald-500" />;
    default:
      return <File className="h-4 w-4 text-gray-400" />;
  }
};

function collectSelectableFilePaths(node: FileTreeNodeProps["node"]): string[] {
  if (node.type === "file") {
    const normalized = normalizePath(node.path);
    return isInStarterCode(normalized) ? [] : [normalized];
  }

  return (node.children ?? []).flatMap((child) => collectSelectableFilePaths(child));
}

function getFolderSelectionState(
  paths: string[],
  selectedPaths: string[],
): boolean | "indeterminate" {
  if (paths.length === 0) return false;
  const selected = new Set(selectedPaths);
  const selectedCount = paths.filter((path) => selected.has(path)).length;
  if (selectedCount === 0) return false;
  if (selectedCount === paths.length) return true;
  return "indeterminate";
}

export function FileTreeNode({
  node,
  onFileSelect,
  selectedPath,
  searchQuery = "",
  level = 0,
  repoId,
  repoName,
  preselectedPaths = [],
  chunkedPaths = [],
  onChunkFile,
  isChunking = false,
  chunkingPath,
  chunkElapsedMs = 0,
  selectedPaths = [],
  onTogglePathSelection,
}: FileTreeNodeProps) {
  const normalizedPath = normalizePath(node.path);
  const isDisabled = isInStarterCode(normalizedPath);
  const isPreselected = preselectedPaths.includes(normalizedPath);
  const isChunked =
    node.type === "file" &&
    chunkedPaths.includes(normalizedPath);
  const isMultiSelected =
    node.type === "file" && selectedPaths.includes(normalizedPath);
  const selectableChildPaths =
    node.type === "folder" ? collectSelectableFilePaths(node) : [];
  const folderSelectionState =
    node.type === "folder"
      ? getFolderSelectionState(selectableChildPaths, selectedPaths)
      : false;
  // Check if this folder contains any preselected files (for auto-expansion)
  const hasPreselectedChild = (folderNode: any): boolean => {
    if (!folderNode.children || !Array.isArray(folderNode.children)) {
      return false;
    }
    for (const child of folderNode.children) {
      const childPath = normalizePath(child.path);
      if (preselectedPaths.includes(childPath)) {
        return true;
      }
      if (child.type === "folder" && hasPreselectedChild(child)) {
        return true;
      }
    }
    return false;
  };
  // Helper function to check if any child matches search
  const checkChildrenMatch = (childNode: any): boolean => {
    if (childNode.name.toLowerCase().includes(searchQuery.toLowerCase())) {
      return true;
    }
    if (childNode.children) {
      return childNode.children.some((c: any) => checkChildrenMatch(c));
    }
    return false;
  };

  // Filter logic for search
  const shouldShow = () => {
    if (!searchQuery) return true;

    const matchesSearch = node.name
      .toLowerCase()
      .includes(searchQuery.toLowerCase());
    if (matchesSearch) return true;

    // Check if any children match
    if (node.children) {
      return node.children.some(
        (child: any) =>
          child.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
          (child.children && checkChildrenMatch(child))
      );
    }

    return false;
  };

  // Auto-expand based on search query, preselected files, or if we're at root level
  const shouldAutoExpand = () => {
    if (level === 0) return true;

    // Always collapse "Starter Code" folder (case-insensitive check)
    if (
      node.type === "folder" &&
      (node.name === "starterCode" ||
        node.name === "Starter Code" ||
        node.name.toLowerCase() === "starter code")
    ) {
      return false;
    }

    // By default, expand "Process" folder (case-insensitive)
    if (node.type === "folder" && node.name.toLowerCase() === "process") {
      return true;
    }

    // By default, expand "requirements" folder (case-insensitive)
    if (node.type === "folder" && node.name.toLowerCase() === "requirements") {
      return true;
    }

    // Expand if this folder contains preselected files (but not Starter Code)
    if (node.type === "folder" && preselectedPaths.length > 0) {
      // Check if any preselected file path starts with this folder's path
      const folderPath = normalizedPath.endsWith("/")
        ? normalizedPath
        : normalizedPath + "/";
      const hasPreselectedFile = preselectedPaths.some((preselectedPath) =>
        preselectedPath.startsWith(folderPath)
      );
      if (hasPreselectedFile || hasPreselectedChild(node)) {
        return true;
      }
    }

    // Expand if this folder or any descendant matches the search
    if (searchQuery) {
      if (node.name.toLowerCase().includes(searchQuery.toLowerCase()))
        return true;
      if (node.children) {
        return node.children.some((child: any) => checkChildrenMatch(child));
      }
    }

    return false;
  };

  const [isExpanded, setIsExpanded] = useState(shouldAutoExpand());
  const [hasBeenManuallyToggled, setHasBeenManuallyToggled] = useState(false);

  // Update expansion state when search query or preselected paths change.
  // Never auto-collapse after mount; manual toggles must remain stable.
  useEffect(() => {
    if (hasBeenManuallyToggled) {
      // Don't auto-expand/collapse if user has manually interacted
      return;
    }

    // Always collapse Starter Code folder (case-insensitive, unless manually toggled)
    if (
      node.type === "folder" &&
      (node.name === "starterCode" ||
        node.name === "Starter Code" ||
        node.name.toLowerCase() === "starter code")
    ) {
      setIsExpanded(false);
      return;
    }

    if (searchQuery || preselectedPaths.length > 0) {
      const nextAutoExpanded = shouldAutoExpand();
      // Avoid UI flicker on first interaction by only auto-expanding nodes.
      // Auto-collapsing here can fight with user clicks while data is settling.
      if (nextAutoExpanded) {
        setIsExpanded(true);
      }
    }
  }, [
    searchQuery,
    preselectedPaths,
    hasBeenManuallyToggled,
    node.name,
    node.type,
  ]);

  if (!shouldShow()) return null;

  const handleToggle = () => {
    if (node.type === "folder") {
      setIsExpanded((prev) => !prev);
      setHasBeenManuallyToggled(true); // Mark as manually toggled to prevent auto-collapse
    } else {
      onFileSelect(node.path);
    }
  };

  const handleFolderSelectionToggle = (checked: boolean | "indeterminate") => {
    if (!onTogglePathSelection || selectableChildPaths.length === 0) return;
    const shouldSelect = checked === true || checked === "indeterminate";
    for (const path of selectableChildPaths) {
      onTogglePathSelection(path, shouldSelect);
    }
  };

  const isFileSelected = selectedPath === node.path;
  const highlightMatch =
    searchQuery && node.name.toLowerCase().includes(searchQuery.toLowerCase());

  return (
    <div>
      <div
        className={cn(
          "flex items-center gap-2 py-1.5 px-2 rounded-md",
          node.type === "file"
            ? "cursor-pointer hover-elevate active-elevate-2"
            : "cursor-pointer",
          isFileSelected && "bg-primary/10 text-primary font-medium",
          highlightMatch && "bg-amber-50 dark:bg-amber-950/20",
          isDisabled && node.type === "file" && "opacity-50 cursor-not-allowed",
          isPreselected &&
            node.type === "file" &&
            "bg-blue-50 dark:bg-blue-950/30 border-l-2 border-blue-500"
        )}
        style={{ paddingLeft: `${level * 12 + 8}px` }}
        onClick={handleToggle}
        data-testid={`tree-node-${node.type}-${node.path}`}
      >
        {node.type === "folder" ? (
          <>
            {isExpanded ? (
              <ChevronDown className="h-4 w-4 text-muted-foreground flex-shrink-0" />
            ) : (
              <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />
            )}
            {onTogglePathSelection && (
              <Checkbox
                checked={folderSelectionState}
                className="ml-1"
                onClick={(e) => e.stopPropagation()}
                onCheckedChange={handleFolderSelectionToggle}
                disabled={selectableChildPaths.length === 0}
              />
            )}
            {isExpanded ? (
              <FolderOpen className="h-4 w-4 text-amber-500 flex-shrink-0" />
            ) : (
              <Folder className="h-4 w-4 text-amber-500 flex-shrink-0" />
            )}
          </>
        ) : (
          <>
            <div className="w-4" />
            {onTogglePathSelection && (
              <Checkbox
                checked={isMultiSelected}
                className="ml-1"
                onClick={(e) => e.stopPropagation()}
                onCheckedChange={(checked) =>
                  onTogglePathSelection(
                    normalizedPath,
                    checked === true || checked === "indeterminate",
                  )
                }
                disabled={isDisabled}
              />
            )}
            {getFileIcon(node.name)}
          </>
        )}
        <span
          className={cn(
            "text-sm truncate flex-1",
            isPreselected &&
              node.type === "file" &&
              "font-medium text-blue-700 dark:text-blue-300"
          )}
        >
          {searchQuery && highlightMatch ? (
            <HighlightedText text={node.name} highlight={searchQuery} />
          ) : (
            node.name
          )}
        </span>
        {/* Default badge for preselected files only - shown after name */}
        {isPreselected && node.type === "file" && (
          <span className="text-xs bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300 px-2 py-0.5 rounded-full font-medium whitespace-nowrap flex-shrink-0 ml-2">
            Default
          </span>
        )}
        {/* Chunking status + action */}
        {node.type === "file" && (
          <div className="flex items-center gap-1 ml-2">
            {isChunked && (
              <span
                className={cn(
                  "text-[10px] px-1.5 py-0.5 rounded-full font-medium whitespace-nowrap",
                  "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
                )}
              >
                Chunked
              </span>
            )}

            {!isChunked && onChunkFile && (
              <button
                type="button"
                className="text-[10px] px-1.5 py-0.5 rounded-full font-medium whitespace-nowrap border border-emerald-500/60 text-emerald-600 bg-transparent hover:bg-emerald-50 dark:hover:bg-emerald-900/30 disabled:opacity-60 disabled:cursor-not-allowed"
                disabled={isChunking}
                onClick={(e) => {
                  e.stopPropagation();
                  onChunkFile(normalizedPath);
                }}
              >
                {isChunking && chunkingPath === normalizedPath
                  ? (() => {
                      const seconds = Math.floor(chunkElapsedMs / 1000);
                      const pct = Math.min(
                        99,
                        Math.max(5, Math.floor((seconds / 60) * 100) || 5)
                      );
                      return `Chunking ${pct}% (${seconds}s)`;
                    })()
                  : "Chunk"}
              </button>
            )}
          </div>
        )}
        {node.type === "file" && typeof node.size === "number" && node.size > 0 && (
          <span
            className={cn(
              "text-xs whitespace-nowrap ml-auto",
              isPreselected
                ? "text-blue-600 dark:text-blue-400"
                : "text-muted-foreground"
            )}
          >
            {formatFileSize(node.size)}
          </span>
        )}
      </div>

      {node.type === "folder" && isExpanded && node.children && (
        <div>
          {node.children.map((child: any) => (
            <FileTreeNode
              key={child.path}
              node={child}
              onFileSelect={onFileSelect}
              selectedPath={selectedPath}
              searchQuery={searchQuery}
              level={level + 1}
              repoId={repoId}
              repoName={repoName}
              preselectedPaths={preselectedPaths}
              chunkedPaths={chunkedPaths}
              onChunkFile={onChunkFile}
              isChunking={isChunking}
              chunkingPath={chunkingPath}
              chunkElapsedMs={chunkElapsedMs}
              selectedPaths={selectedPaths}
              onTogglePathSelection={onTogglePathSelection}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function HighlightedText({
  text,
  highlight,
}: {
  text: string;
  highlight: string;
}) {
  const parts = text.split(new RegExp(`(${highlight})`, "gi"));
  return (
    <>
      {parts.map((part, index) =>
        part.toLowerCase() === highlight.toLowerCase() ? (
          <mark
            key={index}
            className="bg-amber-300 dark:bg-amber-700 text-foreground"
          >
            {part}
          </mark>
        ) : (
          <span key={index}>{part}</span>
        )
      )}
    </>
  );
}

function formatFileSize(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}
