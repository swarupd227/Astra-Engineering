import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Download, Copy, Check, FileCode, AlertTriangle } from "lucide-react";
import { useState } from "react";
import { useToast } from "@/hooks/use-toast";

interface FileViewerProps {
  file: {
    path: string;
    name: string;
    content: string;
    language: string;
    size: number;
  } | null;
  isLoading: boolean;
}

export function FileViewer({ file, isLoading }: FileViewerProps) {
  const [copied, setCopied] = useState(false);
  const [heavyConfirmed, setHeavyConfirmed] = useState(false);
  const { toast } = useToast();

  if (isLoading) {
    return (
      <Card className="h-full flex flex-col">
        <CardHeader className="border-b">
          <div className="space-y-2">
            <Skeleton className="h-6 w-1/3" />
            <Skeleton className="h-4 w-1/4" />
          </div>
        </CardHeader>
        <CardContent className="flex-1 p-6">
          <Skeleton className="h-full w-full" />
        </CardContent>
      </Card>
    );
  }

  if (!file) {
    return (
      <Card className="h-full flex items-center justify-center">
        <CardContent className="text-center space-y-4 py-12">
          <div className="inline-flex p-6 rounded-full bg-muted">
            <FileCode className="h-16 w-16 text-muted-foreground" />
          </div>
          <div>
            <h3
              className="text-lg font-semibold"
              data-testid="text-no-file-title"
            >
              Select a file to preview
            </h3>
            <p
              className="text-sm text-muted-foreground mt-2"
              data-testid="text-no-file-subtitle"
            >
              Click on any file in the tree to view its contents
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Treat very large files as "download-only or partial preview" to avoid freezing
  const HEAVY_SIZE_BYTES = 350 * 1024; // ~350 KB threshold for "heavy" preview
  const isHeavy = file.size >= HEAVY_SIZE_BYTES;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(file.content);
      setCopied(true);
      toast({
        title: "Copied to clipboard",
        description: `File content has been copied`,
      });
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      toast({
        title: "Failed to copy",
        description: "Could not copy to clipboard",
        variant: "destructive",
      });
    }
  };

  const handleDownload = () => {
    const filename = file.path?.split("/").pop() || file.name || "file.txt";

    // Best-effort MIME type based on extension to help browsers keep the name
    const ext = filename.split(".").pop()?.toLowerCase();
    const mimeMap: Record<string, string> = {
      js: "text/javascript",
      jsx: "text/javascript",
      ts: "text/plain",
      tsx: "text/plain",
      json: "application/json",
      md: "text/markdown",
      txt: "text/plain",
      html: "text/html",
      css: "text/css",
      yml: "text/yaml",
      yaml: "text/yaml",
      xml: "application/xml",
      java: "text/plain",
      py: "text/plain",
      rb: "text/plain",
      go: "text/plain",
      rs: "text/plain",
      cs: "text/plain",
      c: "text/plain",
      cpp: "text/plain",
    };
    const mimeType = (ext && mimeMap[ext]) || "text/plain";

    const blob = new Blob([file.content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    toast({
      title: "Download started",
      description: `Downloading ${filename}`,
    });
  };

  if (isHeavy && !heavyConfirmed) {
    return (
      <Card className="h-full flex flex-col">
        <CardHeader className="border-b">
          <div className="flex items-center gap-3">
            <AlertTriangle className="h-5 w-5 text-amber-500 flex-shrink-0" />
            <div className="space-y-1">
              <h3 className="text-sm font-semibold">
                Large file detected – preview may be slow
              </h3>
              <p className="text-xs text-muted-foreground">
                This file is {formatFileSize(file.size)}. Rendering the full content inline may freeze or slow down your browser.
              </p>
            </div>
          </div>
        </CardHeader>
        <CardContent className="flex-1 flex flex-col items-center justify-center gap-4">
          <div className="text-center space-y-2 max-w-md">
            <p className="text-sm text-muted-foreground">
              Do you want to load this file in the preview, or download it instead?
            </p>
          </div>
          <div className="flex gap-3">
            <Button
              variant="outline"
              size="sm"
              onClick={handleDownload}
              data-testid="button-download-heavy-file"
            >
              <Download className="h-4 w-4 mr-2" />
              Download file
            </Button>
            <Button
              variant="default"
              size="sm"
              onClick={() => setHeavyConfirmed(true)}
              data-testid="button-load-heavy-file"
            >
              View first part only
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  // For heavy files, we only render a partial, plain-text preview (no syntax highlighting)
  const displayContent =
    isHeavy && heavyConfirmed ? file.content.slice(0, 20000) : file.content;
  const useSyntaxHighlighter = !isHeavy;

  return (
    <Card
      className="h-full flex flex-col"
      style={{ overflow: "hidden", position: "relative" }}
    >
      <CardHeader className="border-b space-y-0 pb-4">
        <div className="flex items-center justify-between gap-4">
          <div className="flex-1 min-w-0">
            <h3
              className="text-lg font-semibold truncate"
              data-testid="text-file-name"
            >
              {file.name}
            </h3>
            <p
              className="text-xs text-muted-foreground truncate mt-1"
              data-testid="text-file-path"
            >
              {file.path}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <Badge variant="outline" className="text-xs">
              {file.language}
            </Badge>
            <Badge variant="secondary" className="text-xs">
              {formatFileSize(file.size)}
            </Badge>
            <Button
              size="icon"
              variant="ghost"
              onClick={handleCopy}
              data-testid="button-copy-content"
            >
              {copied ? (
                <Check className="h-4 w-4 text-emerald-500" />
              ) : (
                <Copy className="h-4 w-4" />
              )}
            </Button>
            <Button
              size="icon"
              variant="ghost"
              onClick={handleDownload}
              data-testid="button-download-file"
            >
              <Download className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent
        className="flex-1 p-0"
        style={{
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
          position: "relative",
        }}
      >
        <div
          className="overflow-y-auto overflow-x-auto"
          style={{
            flex: 1,
            minWidth: 0,
            maxWidth: "100%",
            overscrollBehavior: "contain",
            position: "relative",
          }}
        >
          {useSyntaxHighlighter ? (
            <SyntaxHighlighter
              language={file.language}
              style={oneDark}
              showLineNumbers
              wrapLines={true}
              wrapLongLines={true}
              customStyle={{
                margin: 0,
                padding: "1.5rem",
                fontSize: "0.875rem",
                lineHeight: "1.5",
                borderRadius: 0,
                minHeight: "100%",
                display: "block",
                width: "100%",
                maxWidth: "100%",
                boxSizing: "border-box",
                overflow: "visible",
              }}
              codeTagProps={{
                style: {
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                  overflowWrap: "break-word",
                  display: "block",
                  width: "100%",
                  maxWidth: "100%",
                },
              }}
              data-testid="code-viewer"
            >
              {displayContent}
            </SyntaxHighlighter>
          ) : (
            <pre
              className="text-xs p-4"
              style={{ margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-word" }}
              data-testid="code-viewer-plain"
            >
              {displayContent}
            </pre>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function formatFileSize(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}
