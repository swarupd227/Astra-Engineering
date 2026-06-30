import { useState, useCallback, useRef, useEffect } from "react";
import type { ReactNode } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Upload, X, File, Folder, Loader2, ChevronDown, ChevronRight } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { getApiUrl } from "@/lib/api-config";

interface FileUploadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  repoId: string;
  repositoryTree: any;
  provider?: string; // "ado" | "gitlab" | "github"
  branch?: string;   // default branch (used by GitLab)
  onUploadSuccess?: () => void;
}

interface FileWithPath {
  file: File;
  targetPath: string;
}

const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB per file
const MAX_FILE_COUNT = 10; // max total files

export function FileUploadDialog({
  open,
  onOpenChange,
  repoId,
  repositoryTree,
  provider = "ado",
  branch = "main",
  onUploadSuccess,
}: FileUploadDialogProps) {
  const { toast } = useToast();
  const [files, setFiles] = useState<FileWithPath[]>([]);
  const [targetPath, setTargetPath] = useState<string>("/");
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [progressText, setProgressText] = useState<string>("");
  const [progressDone, setProgressDone] = useState<number>(0);
  const [progressTotal, setProgressTotal] = useState<number>(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const [folderPopoverOpen, setFolderPopoverOpen] = useState(false);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set(["/"]));

  const readFileAsDataUrl = (file: File): Promise<string> =>
    new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });

  // Fix mouse wheel scrolling in ScrollArea
  useEffect(() => {
    if (!folderPopoverOpen) return;
    
    let cleanup: (() => void) | undefined;
    
    const timer = setTimeout(() => {
      // Find the actual scrollable element (Radix ScrollArea viewport)
      // Try multiple selectors to find the viewport
      let scrollableElement: HTMLDivElement | null = null;
      
      if (scrollAreaRef.current) {
        scrollableElement = scrollAreaRef.current.querySelector('[data-radix-scroll-area-viewport]') as HTMLDivElement;
        if (!scrollableElement) {
          scrollableElement = scrollAreaRef.current.querySelector('.h-full.w-full') as HTMLDivElement;
        }
        if (!scrollableElement) {
          scrollableElement = scrollAreaRef.current.querySelector('div[style*="overflow"]') as HTMLDivElement;
        }
      }
      
      if (scrollableElement) {
        const el = scrollableElement;
        const handleWheel = (e: WheelEvent) => {
          // Check if we can scroll
          const canScrollUp = el.scrollTop > 0;
          const canScrollDown = el.scrollTop < el.scrollHeight - el.clientHeight;
          
          if ((e.deltaY < 0 && canScrollUp) || (e.deltaY > 0 && canScrollDown)) {
            el.scrollTop += e.deltaY;
            e.preventDefault();
            e.stopPropagation();
          }
        };
        
        el.addEventListener('wheel', handleWheel, { passive: false });
        
        cleanup = () => {
          el.removeEventListener('wheel', handleWheel);
        };
      } else {
        // Fallback: try to find any scrollable div within the ScrollArea
        const allDivs = scrollAreaRef.current?.querySelectorAll('div');
        if (allDivs) {
          for (const div of Array.from(allDivs)) {
            const style = window.getComputedStyle(div);
            if (style.overflowY === 'auto' || style.overflowY === 'scroll' || 
                style.overflow === 'auto' || style.overflow === 'scroll') {
              const handleWheel = (e: WheelEvent) => {
                const canScrollUp = div.scrollTop > 0;
                const canScrollDown = div.scrollTop < div.scrollHeight - div.clientHeight;
                
                if ((e.deltaY < 0 && canScrollUp) || (e.deltaY > 0 && canScrollDown)) {
                  div.scrollTop += e.deltaY;
                  e.preventDefault();
                  e.stopPropagation();
                }
              };
              
              div.addEventListener('wheel', handleWheel, { passive: false });
              
              cleanup = () => {
                div.removeEventListener('wheel', handleWheel);
              };
              break;
            }
          }
        }
      }
    }, 100);
    
    return () => {
      clearTimeout(timer);
      if (cleanup) cleanup();
    };
  }, [folderPopoverOpen]);

  const handleSelectFolder = (path: string) => {
    setTargetPath(path || "/");
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
            targetPath === pathValue && "bg-primary/10 text-primary"
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
          <Folder className="h-4 w-4 text-muted-foreground" />
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

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const addFiles = useCallback(
    (incoming: File[]) => {
      if (incoming.length === 0) return;

      const oversized = incoming.filter((file) => file.size > MAX_FILE_SIZE_BYTES);
      const withinSize = incoming.filter((file) => file.size <= MAX_FILE_SIZE_BYTES);

      if (oversized.length > 0) {
        toast({
          title: "File too large",
          description: `Each file must be 5 MB or smaller. Skipped: ${oversized
            .map((f) => f.name)
            .join(", ")}`,
          variant: "destructive",
        });
      }

      setFiles((prev) => {
        const remainingSlots = MAX_FILE_COUNT - prev.length;
        if (remainingSlots <= 0) {
          toast({
            title: "File limit reached",
            description: `You can upload a maximum of ${MAX_FILE_COUNT} files.`,
            variant: "destructive",
          });
          return prev;
        }

        const accepted = withinSize.slice(0, remainingSlots);
        if (withinSize.length > remainingSlots) {
          toast({
            title: "File limit reached",
            description: `Only ${remainingSlots} more file(s) can be added (max ${MAX_FILE_COUNT}). Extra files were skipped.`,
            variant: "destructive",
          });
        }

        return [
          ...prev,
          ...accepted.map((file) => ({ file, targetPath })),
        ];
      });
    },
    [targetPath, toast]
  );

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    addFiles(Array.from(e.dataTransfer.files));
  }, [addFiles]);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    addFiles(Array.from(e.target.files || []));
    e.target.value = "";
  };

  const removeFile = (index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const updateFilePath = (index: number, newPath: string) => {
    setFiles((prev) =>
      prev.map((item, i) => (i === index ? { ...item, targetPath: newPath } : item))
    );
  };

  const handleUpload = async () => {
    if (files.length === 0) {
      toast({
        title: "No files selected",
        description: "Please select at least one file to upload",
        variant: "destructive",
      });
      return;
    }

    if (files.length > MAX_FILE_COUNT) {
      toast({
        title: "Too many files",
        description: `You can upload a maximum of ${MAX_FILE_COUNT} files.`,
        variant: "destructive",
      });
      return;
    }

    const oversized = files.filter((f) => f.file.size > MAX_FILE_SIZE_BYTES);
    if (oversized.length > 0) {
      toast({
        title: "File too large",
        description: `Each file must be 5 MB or smaller. Remove: ${oversized
          .map((f) => f.file.name)
          .join(", ")}`,
        variant: "destructive",
      });
      return;
    }

    setIsUploading(true);
    setProgressDone(0);
    setProgressTotal(files.length);
    setProgressText(`Preparing upload of ${files.length} file(s)...`);

    try {
      let uploaded = 0;
      let chunked = 0;
      let skipped = 0;

      // Sequential: upload one file, chunk it, then move to next file.
      for (let i = 0; i < files.length; i++) {
        const fileWithPath = files[i];
        const fileIndex = i + 1;

        const fullPath = fileWithPath.targetPath.endsWith("/")
          ? `${fileWithPath.targetPath}${fileWithPath.file.name}`
          : fileWithPath.targetPath === "/"
            ? `/${fileWithPath.file.name}`
            : `${fileWithPath.targetPath}/${fileWithPath.file.name}`;

        // 1) Upload single file
        setProgressText(`Uploading (${fileIndex}/${files.length}): ${fileWithPath.file.name}`);
        const fileContent = await readFileAsDataUrl(fileWithPath.file);

        const uploadUrl = provider === "gitlab"
          ? getApiUrl(`/api/gitlab/repository/${repoId}/upload`)
          : getApiUrl(`/api/ado/repository/${repoId}/upload`);

        const uploadBody = provider === "gitlab"
          ? JSON.stringify({
              files: [{ name: fileWithPath.file.name, content: fileContent, path: fullPath }],
              branch,
            })
          : JSON.stringify({
              files: [{ name: fileWithPath.file.name, content: fileContent, path: fullPath }],
              basePath: fileWithPath.targetPath,
            });

        const uploadResponse = await fetch(uploadUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: uploadBody,
            credentials: "include",
          });

        if (!uploadResponse.ok) {
          const error = await uploadResponse.json().catch(() => null);
          throw new Error(error?.message || `Failed to upload ${fileWithPath.file.name}`);
        }

        const uploadResult = await uploadResponse.json().catch(() => null);
        const storedPath = uploadResult?.files?.[0] || fullPath;

        uploaded++;

        // 2) Chunk the stored file path (use server-returned path to avoid ext mismatches)
        const chunkPath = storedPath;
        setProgressText(`Chunking (${fileIndex}/${files.length}): ${fileWithPath.file.name}`);

        const chunkResponse = await fetch(getApiUrl(`/api/golden-repo/${repoId}/chunk`), {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          credentials: "include",
          body: JSON.stringify({ filePath: chunkPath }),
        });

        const chunkResult = await chunkResponse.json().catch(() => null);
        if (!chunkResponse.ok || !chunkResult?.success) {
          skipped++;
          setProgressText(`Chunk failed (skipped) (${fileIndex}/${files.length}): ${fileWithPath.file.name}`);
        } else {
          chunked++;
          setProgressText(`Chunked (${fileIndex}/${files.length}): ${fileWithPath.file.name}`);
        }

        setProgressDone(fileIndex);
      }

      toast({
        title: "Upload + chunk complete",
        description: `Uploaded ${uploaded} file(s); chunked ${chunked} file(s); skipped ${skipped}.`,
      });

      // Reset form
      setFiles([]);
      setTargetPath("/");
      onOpenChange(false);
      onUploadSuccess?.();
    } catch (error) {
      console.error("Upload error:", error);
      toast({
        title: "Upload failed",
        description: error instanceof Error ? error.message : "Failed to upload files. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsUploading(false);
      setProgressText("");
    }
  };

  const handleClose = () => {
    if (!isUploading) {
      setFiles([]);
      setTargetPath("/");
      onOpenChange(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Upload Files to Repository</DialogTitle>
          <DialogDescription>
            {provider === "gitlab"
              ? "Upload files directly to the GitLab repository. PDF, DOCX, and TXT files are auto-converted to Markdown."
              : "Upload one or multiple files to the repository. You can drag and drop files or select them manually."}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto space-y-4">
          {isUploading && (
            <div className="rounded-lg border p-3 bg-muted/20">
              <div className="text-sm font-medium">Progress</div>
              <div className="text-xs text-muted-foreground mt-1">{progressText}</div>
              <div className="text-xs text-muted-foreground mt-2">
                {progressDone}/{progressTotal} files processed
              </div>
            </div>
          )}

          {/* Target Path Selection */}
          <div className="space-y-2">
            <Label>Target Location</Label>
            <Popover
              open={folderPopoverOpen}
              onOpenChange={(open) => {
                setFolderPopoverOpen(open);
                if (open) {
                  setExpandedFolders((prev) => {
                    const next = new Set(prev);
                    next.add("/");
                    return next;
                  });
                }
              }}
            >
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  className="w-full justify-between"
                >
                  <span className="truncate">{targetPath}</span>
                  <ChevronDown className="h-4 w-4 ml-2" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="p-0 w-80" align="start">
                <div className="border-b px-4 py-2 text-sm font-medium">
                  Browse folders
                </div>
                <ScrollArea ref={scrollAreaRef} className="h-64">
                  <div className="p-2">
                    {repositoryTree ? renderFolderTree(repositoryTree) : (
                      <p className="text-sm text-muted-foreground">No folders available</p>
                    )}
                  </div>
                </ScrollArea>
              </PopoverContent>
            </Popover>
            <p className="text-xs text-muted-foreground">
              Browse and select the folder where files should be uploaded.
            </p>
          </div>

          {/* Drag and Drop Area */}
          <div
            className={cn(
              "border-2 border-dashed rounded-lg p-8 text-center transition-colors",
              isDragging ? "border-primary bg-primary/5" : "border-muted-foreground/25",
              "cursor-pointer"
            )}
            onDragEnter={handleDragEnter}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
          >
            <Upload className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
            <p className="text-sm font-medium mb-2">
              Drag and drop files here, or click to select
            </p>
            <p className="text-xs text-muted-foreground">
              Supported conversions: .pdf, .docx, .txt (auto-uploaded as .md)
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              Max 10 files, up to 5 MB each
            </p>
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.doc,.docx,.txt,.md"
              multiple
              className="hidden"
              onChange={handleFileSelect}
            />
          </div>

          {/* Selected Files List */}
          {files.length > 0 && (
            <div className="space-y-2">
              <Label>Selected Files ({files.length}/{MAX_FILE_COUNT})</Label>
              <div className="border rounded-lg divide-y max-h-64 overflow-y-auto">
                {files.map((fileWithPath, index) => (
                  <div key={index} className="p-3 flex items-center gap-3 hover:bg-muted/50">
                    <File className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{fileWithPath.file.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {(fileWithPath.file.size / 1024).toFixed(2)} KB
                      </p>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <Input
                        value={fileWithPath.targetPath}
                        onChange={(e) => updateFilePath(index, e.target.value)}
                        placeholder="/path/to/file"
                        className="w-48 h-8 text-xs"
                        onClick={(e) => e.stopPropagation()}
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => removeFile(index)}
                        disabled={isUploading}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={handleClose}
            disabled={isUploading}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={handleUpload}
            disabled={files.length === 0 || isUploading}
          >
            {isUploading ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Uploading...
              </>
            ) : (
              <>
                <Upload className="h-4 w-4 mr-2" />
                Upload {files.length} File{files.length !== 1 ? "s" : ""}
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

