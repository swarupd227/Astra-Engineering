/**
 * Streaming Report Viewer - connects to report-stream SSE via apiRequest
 * and appends chunks with markdown rendering.
 * Uses fetch streaming (ReadableStream) instead of EventSource so that
 * auth headers (MSAL x-user-* headers) are included in cloud deployments.
 */

import { useState, useEffect, useRef } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import ReactMarkdown from "react-markdown";
import { apiRequest } from "@/lib/queryClient";

export type ReportStreamType = "assessment" | "risk" | "compatibility" | "plan";

interface StreamingReportViewerProps {
  analysisId: string;
  reportType: ReportStreamType;
  onContentChange?: (content: string) => void;
}

export function StreamingReportViewer({ analysisId, reportType, onContentChange }: StreamingReportViewerProps) {
  const [content, setContent] = useState("");
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const contentRef = useRef("");
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!analysisId || !reportType) return;
    setContent("");
    setDone(false);
    setError(null);
    contentRef.current = "";

    const abortController = new AbortController();
    abortRef.current = abortController;

    (async () => {
      try {
        const response = await apiRequest(
          "GET",
          `/api/stack-modernization/analysis/${analysisId}/report-stream?type=${encodeURIComponent(reportType)}`,
          undefined,
          abortController.signal,
        );

        const reader = response.body?.getReader();
        if (!reader) {
          setError("Streaming not supported");
          return;
        }

        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done: streamDone, value } = await reader.read();
          if (streamDone) {
            setDone(true);
            onContentChange?.(contentRef.current);
            break;
          }

          buffer += decoder.decode(value, { stream: true });

          // Parse SSE lines: each message is "data: {...}\n\n"
          const lines = buffer.split("\n");
          buffer = "";

          for (let i = 0; i < lines.length; i++) {
            const line = lines[i];

            // If this is the last element and doesn't end with newline, it's an incomplete chunk
            if (i === lines.length - 1 && line !== "") {
              buffer = line;
              break;
            }

            if (!line.startsWith("data: ")) continue;

            try {
              const jsonStr = line.slice(6);
              if (!jsonStr.trim()) continue;
              const data = JSON.parse(jsonStr);

              if (data.type === "chunk" && typeof data.content === "string") {
                contentRef.current += data.content;
                setContent(contentRef.current);
                onContentChange?.(contentRef.current);
              } else if (data.type === "done") {
                setDone(true);
                onContentChange?.(contentRef.current);
                reader.cancel();
                return;
              }
            } catch {
              // skip unparseable lines
            }
          }
        }
      } catch (err: any) {
        if (err?.name === "AbortError") return;
        console.error("[StreamingReportViewer] Error:", err);
        setError("Connection error");
      }
    })();

    return () => {
      abortController.abort();
    };
  }, [analysisId, reportType]);

  return (
    <ScrollArea className="flex-1 h-full">
      <div className="px-6 py-4">
        {error && (
          <p className="text-destructive text-sm mb-4">{error}</p>
        )}
        {!done && !content && !error && (
          <p className="text-muted-foreground text-sm">Loading report…</p>
        )}
        <div className="markdown-content prose prose-slate dark:prose-invert max-w-none">
          <ReactMarkdown>{content}</ReactMarkdown>
        </div>
      </div>
    </ScrollArea>
  );
}
