import { useState, useRef } from "react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

interface FileTreeNode {
  name: string;
  path: string;
  type: "folder" | "file";
  children?: FileTreeNode[];
}

interface FolderPickerProps {
  value: string;
  onChange: (path: string) => void;
  repositoryTree: FileTreeNode[] | null;
  label?: string;
  disabled?: boolean;
}

export function FolderPicker({
  value,
  onChange,
  repositoryTree,
  label = "Browse folders",
  disabled = false,
}: FolderPickerProps) {
  const [folderPopoverOpen, setFolderPopoverOpen] = useState(false);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(
    () => new Set(["/"])
  );
  const scrollAreaRef = useRef<HTMLDivElement>(null);

  const handleSelectFolder = (path: string) => {
    onChange(path || "/");
    setFolderPopoverOpen(false);
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

  const renderFolderTree = (node: any, depth = 0): ReactNode => {
    if (!node) return null;
    const isFolderNode = node.type === "folder" || node.name === "root";
    if (!isFolderNode) return null;

    const pathValue =
      node.path ||
      (node.name === "root" || depth === 0 ? "/" : `/${node.name}`);
    const displayName =
      pathValue === "/" ? "Root (/)" : node.name || pathValue;

    const childFolders =
      node.children?.filter((child: any) => child.type === "folder") || [];
    const hasChildren = childFolders.length > 0;
    const isExpanded = expandedFolders.has(pathValue);

    return (
      <div key={pathValue}>
        <div
          className={cn(
            "flex items-center gap-2 rounded px-2 py-1 cursor-pointer hover:bg-muted text-sm",
            value === pathValue && "bg-primary/10 text-primary"
          )}
          style={{ paddingLeft: `${depth * 14}px` }}
          onClick={() => handleSelectFolder(pathValue)}
        >
          {hasChildren ? (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                toggleFolder(pathValue);
              }}
              className="h-4 w-4 flex items-center justify-center text-muted-foreground"
            >
              {isExpanded ? (
                <ChevronDown className="h-4 w-4" />
              ) : (
                <ChevronRight className="h-4 w-4" />
              )}
            </button>
          ) : (
            <span className="h-4 w-4" />
          )}
          <span className="truncate">{displayName}</span>
        </div>
        {hasChildren && isExpanded && (
          <div>
            {childFolders.map((child: any) =>
              renderFolderTree(child, depth + 1)
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <Popover
      open={disabled ? false : folderPopoverOpen}
      onOpenChange={(open) => {
        if (!disabled) {
          setFolderPopoverOpen(open);
        }
      }}
    >
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          className="w-full justify-between"
          disabled={disabled || !repositoryTree || repositoryTree.length === 0}
        >
          <span className="truncate">{value || "/"}</span>
          <ChevronDown className="h-4 w-4 ml-2" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="p-0 w-80" align="start">
        <div className="border-b px-4 py-2 text-sm font-medium">
          {label}
        </div>
        <ScrollArea ref={scrollAreaRef} className="h-64">
          <div className="p-2">
            {repositoryTree && repositoryTree.length > 0 ? (
              renderFolderTree({
                name: "root",
                path: "/",
                type: "folder",
                children: repositoryTree,
              })
            ) : (
              <p className="text-sm text-muted-foreground">
                No folders available
              </p>
            )}
          </div>
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}


