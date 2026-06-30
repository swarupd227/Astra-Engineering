/**
 * Professional Markdown Viewer Modal for Stack Modernization
 * Supports dark mode, download, copy, and optional streaming report (SSE).
 */

import { useState, useCallback } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Download, Copy, Check } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { StreamingReportViewer, type ReportStreamType } from "./StreamingReportViewer";

interface MarkdownViewerProps {
  open: boolean;
  onClose: () => void;
  title: string;
  content: string;
  onDownload?: () => void;
  /** When set, report is streamed via SSE instead of using content */
  streamConfig?: { analysisId: string; reportType: ReportStreamType };
}

export function MarkdownViewer({ open, onClose, title, content, onDownload, streamConfig }: MarkdownViewerProps) {
  const [copied, setCopied] = useState(false);
  const [streamedContent, setStreamedContent] = useState("");

  const displayContent = streamConfig ? streamedContent : content;

  const handleCopy = async () => {
    if (!displayContent) return;
    try {
      await navigator.clipboard.writeText(displayContent);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  const handleStreamContentChange = useCallback((c: string) => {
    setStreamedContent(c);
  }, []);

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-5xl h-[85vh] p-0 gap-0 flex flex-col">
        <DialogHeader className="px-6 py-4 pr-12 border-b shrink-0">
          <div className="flex items-center justify-between">
            <DialogTitle className="text-xl font-semibold">{title}</DialogTitle>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handleCopy}
                disabled={!displayContent}
              >
                {copied ? <Check className="h-4 w-4 mr-2" /> : <Copy className="h-4 w-4 mr-2" />}
                {copied ? "Copied" : "Copy full report"}
              </Button>
              {onDownload && (
                <Button variant="outline" size="sm" onClick={onDownload}>
                  <Download className="h-4 w-4 mr-2" />
                  Download
                </Button>
              )}
            </div>
          </div>
        </DialogHeader>

        {streamConfig ? (
          <StreamingReportViewer
            analysisId={streamConfig.analysisId}
            reportType={streamConfig.reportType}
            onContentChange={handleStreamContentChange}
          />
        ) : (
          <ScrollArea className="flex-1 px-6 py-4">
            <div className="markdown-content prose prose-slate dark:prose-invert max-w-none">
              <ReactMarkdown>{content}</ReactMarkdown>
            </div>
          </ScrollArea>
        )}
      </DialogContent>
    </Dialog>
  );
}
