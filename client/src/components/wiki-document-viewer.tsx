import { useEffect, useMemo, useRef, useState } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import mermaid from "mermaid";
import { Calendar } from "lucide-react";
import { getApiUrl } from "@/lib/api-config";

// Initialize mermaid at module level so it is configured before any MermaidBlock
// useEffect fires. React child effects run before parent effects, meaning
// mermaid.render() inside MermaidBlock would otherwise execute before the
// initialize() call inside WikiDocumentViewer's useEffect, causing render
// promises to be queued against the default (startOnLoad: true) config and
// then orphaned when initialize() resets internal state mid-flight.
mermaid.initialize({
  startOnLoad: false,
  theme: "default",
  securityLevel: "loose",
  fontFamily: "inherit",
  flowchart: {
    useMaxWidth: false,
    htmlLabels: true,
  },
  sequence: {
    useMaxWidth: false,
  },
  er: {
    useMaxWidth: false,
  },
  themeVariables: {
    fontSize: "14px",
    fontFamily: "Inter, system-ui, -apple-system, sans-serif",
  },
});

// Helper function to escape special regex characters
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const MERMAID_KEYWORDS = /^(graph|flowchart|sequenceDiagram|classDiagram|stateDiagram|erDiagram|gantt|pie|gitGraph|mindmap|timeline|quadrantChart|requirementDiagram|journey)\b/i;

interface MermaidBlockProps {
  code: string;
  /** Called with the full updated markdown when AI fixes a diagram. */
  onContentChange?: (content: string) => void;
  /** Page title forwarded to the AI fix API as context. */
  title?: string;
  /** Ref to the raw markdown string so fixes can be spliced in. */
  contentRef?: React.MutableRefObject<string>;
}

/** Self-contained component that renders a Mermaid diagram with a Diagram/Code tab switcher.
 *  When rendering fails, shows "AI Enhance" and "Regenerate" buttons that call
 *  POST /api/wiki/fix-mermaid and re-attempt rendering with the corrected code.
 */
function MermaidBlock({ code, onContentChange, title, contentRef }: MermaidBlockProps) {
  const [activeTab, setActiveTab] = useState<"diagram" | "code">("diagram");
  const [editedCode, setEditedCode] = useState(code);
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isFixing, setIsFixing] = useState(false);
  const [fixStatus, setFixStatus] = useState<{ message: string; ok: boolean } | null>(null);
  // Tracks whether the user just hit Apply so we can show inline status on the Code tab
  const [applyStatus, setApplyStatus] = useState<"rendering" | "rendered" | "failed" | null>(null);
  const applyPendingRef = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Keep editedCode in sync when the code prop changes (e.g. after AI fix or parent update)
  useEffect(() => {
    setEditedCode(code);
  }, [code]);

  // Resolve applyStatus once the mermaid render settles (svg or error changes)
  useEffect(() => {
    if (!applyPendingRef.current) return;
    if (svg !== null) {
      applyPendingRef.current = false;
      setApplyStatus("rendered");
    }
  }, [svg]);

  useEffect(() => {
    if (!applyPendingRef.current) return;
    if (error !== null) {
      applyPendingRef.current = false;
      setApplyStatus("failed");
    }
  }, [error]);

  useEffect(() => {
    let cancelled = false;
    setSvg(null);
    setError(null);
    setFixStatus(null);

    // mermaid.render() v11 needs a real DOM element attached to document.body.
    // Without one the internal promise hangs. We:
    //   1. Fresh unique ID per attempt (avoids stale-ID queue deadlock in mermaid v11)
    //   2. Hidden off-screen container on document.body (satisfies v11 DOM requirement)
    //   3. 5s timeout — faster user feedback on invalid LLM-generated syntax
    const uid = `mermaid-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const stale = document.getElementById(uid);
    if (stale) stale.remove();

    const host = document.createElement("div");
    host.id = `host-${uid}`;
    host.style.cssText = "position:absolute;top:-9999px;left:-9999px;visibility:hidden;";
    document.body.appendChild(host);

    const timeoutId = setTimeout(() => {
      if (!cancelled) {
        cancelled = true;
        setError("Diagram syntax could not be parsed. Use AI Enhance or Regenerate to fix it.");
        host.remove();
      }
    }, 5_000);

    mermaid
      .render(uid, code.trim(), host)
      .then(({ svg: rendered }) => {
        clearTimeout(timeoutId);
        host.remove();
        if (!cancelled) setSvg(rendered);
      })
      .catch((err) => {
        clearTimeout(timeoutId);
        host.remove();
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });

    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
      host.remove();
    };
  }, [code]);

  const handleFix = async (regenerate: boolean) => {
    setIsFixing(true);
    setFixStatus(null);
    try {
      const response = await fetch(getApiUrl("/api/wiki/fix-mermaid"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ mermaidCode: code, context: title ?? "", regenerate }),
      });

      if (!response.ok) {
        const ct = response.headers.get("content-type") ?? "";
        const msg = ct.includes("application/json")
          ? ((await response.json()).error ?? `HTTP ${response.status}`)
          : await response.text();
        throw new Error(String(msg) || `HTTP ${response.status}`);
      }

      const data = await response.json();
      if (!data?.fixedCode) throw new Error(data?.error ?? "No fixed code returned");
      const fixedCode = String(data.fixedCode).trim();

      // Re-render with the corrected code
      const fixHost = document.createElement("div");
      fixHost.style.cssText = "position:absolute;top:-9999px;left:-9999px;visibility:hidden;";
      document.body.appendChild(fixHost);
      const fixUid = `mermaid-fix-${Date.now()}`;
      try {
        const { svg: fixedSvg } = await mermaid.render(fixUid, fixedCode, fixHost);
        fixHost.remove();
        setSvg(fixedSvg);
        setError(null);
        setFixStatus({
          message: regenerate ? "Diagram regenerated successfully." : "Diagram fixed successfully.",
          ok: true,
        });

        // Splice the fixed code back into the parent markdown so saves persist it
        if (onContentChange && contentRef?.current) {
          const current = contentRef.current;
          const replaced = current
            .replace(
              new RegExp("(```mermaid\\s*\\n)" + escapeRegex(code) + "(\\s*\\n```)", "s"),
              `$1${fixedCode}$2`
            )
            .replace(
              new RegExp("(:::\\s*mermaid\\s*\\n)" + escapeRegex(code) + "(\\s*\\n:::)", "s"),
              `$1${fixedCode}$2`
            );
          if (replaced !== current) onContentChange(replaced);
        }
      } catch {
        fixHost.remove();
        throw new Error("AI returned corrected code, but it still could not be rendered. Try Regenerate.");
      }
    } catch (err) {
      setFixStatus({
        message: err instanceof Error ? err.message : "Fix failed. Please try again.",
        ok: false,
      });
    } finally {
      setIsFixing(false);
    }
  };

  const applyCodeEdit = () => {
    const trimmed = editedCode.trim();
    if (trimmed === code.trim() || !onContentChange || !contentRef?.current) return;
    const current = contentRef.current;
    const replaced = current
      .replace(
        new RegExp("(```mermaid\\s*\\n)" + escapeRegex(code) + "(\\s*\\n```)", "s"),
        `$1${trimmed}$2`
      )
      .replace(
        new RegExp("(:::\\s*mermaid\\s*\\n)" + escapeRegex(code) + "(\\s*\\n:::)", "s"),
        `$1${trimmed}$2`
      );
    if (replaced !== current) {
      applyPendingRef.current = true;
      setApplyStatus("rendering");
      onContentChange(replaced);
      // Stay on Code tab — status badge shows render progress inline
    }
  };

  return (
    <div className="my-4 rounded-lg border border-border overflow-hidden">
      {/* Tab bar */}
      <div className="flex items-center gap-0 border-b border-border bg-muted/60 px-2">
        <button
          type="button"
          onClick={() => setActiveTab("diagram")}
          className={`px-4 py-2 text-xs font-medium transition-colors ${
            activeTab === "diagram"
              ? "text-foreground border-b-2 border-primary bg-background -mb-px"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          Diagram
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("code")}
          className={`px-4 py-2 text-xs font-medium transition-colors ${
            activeTab === "code"
              ? "text-foreground border-b-2 border-primary bg-background -mb-px"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          Code
        </button>
      </div>

      {/* Diagram panel */}
      {activeTab === "diagram" && (
        <div className="p-4 bg-background overflow-x-auto min-h-[80px] flex items-center justify-center">
          {svg ? (
            <div ref={containerRef} dangerouslySetInnerHTML={{ __html: svg }} className="w-full" />
          ) : error ? (
            <div className="w-full space-y-3">
              <div className="text-sm text-destructive bg-destructive/10 p-3 rounded border border-destructive/20">
                <p className="font-medium mb-0.5">Failed to render diagram.</p>
                <p className="opacity-70 text-xs">Use AI Enhance to fix the syntax, or Regenerate to create a new diagram.</p>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <button
                  type="button"
                  disabled={isFixing}
                  onClick={() => handleFix(false)}
                  className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground shadow-sm hover:bg-primary/90 disabled:opacity-60 disabled:cursor-wait transition-colors"
                >
                  {isFixing ? "Fixing…" : "AI Enhance"}
                </button>
                <button
                  type="button"
                  disabled={isFixing}
                  onClick={() => handleFix(true)}
                  className="inline-flex items-center gap-1.5 rounded-md bg-secondary px-3 py-1.5 text-xs font-medium text-secondary-foreground shadow-sm hover:bg-secondary/90 disabled:opacity-60 disabled:cursor-wait transition-colors"
                >
                  {isFixing ? "Regenerating…" : "Regenerate"}
                </button>
                {fixStatus && (
                  <span className={`text-xs ${fixStatus.ok ? "text-emerald-500" : "text-destructive"}`}>
                    {fixStatus.message}
                  </span>
                )}
              </div>
            </div>
          ) : (
            <span className="text-xs text-muted-foreground animate-pulse">Rendering diagram…</span>
          )}
        </div>
      )}

      {/* Code panel — editable textarea, applies changes back to parent markdown */}
      {activeTab === "code" && (
        <div className="bg-muted p-4 space-y-3">
          <textarea
            value={editedCode}
            onChange={(e) => setEditedCode(e.target.value)}
            rows={Math.max(6, editedCode.split("\n").length + 1)}
            spellCheck={false}
            className="w-full resize-y rounded-md border border-border bg-background px-3 py-2 font-mono text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 leading-relaxed"
          />
          {onContentChange && (
            <div className="flex items-center gap-3 flex-wrap">
              <button
                type="button"
                onClick={applyCodeEdit}
                disabled={applyStatus === "rendering"}
                className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground shadow-sm hover:bg-primary/90 disabled:opacity-60 disabled:cursor-wait transition-colors"
              >
                {applyStatus === "rendering" ? "Rendering…" : "Apply & Re-render"}
              </button>
              <button
                type="button"
                onClick={() => { setEditedCode(code); setApplyStatus(null); }}
                className="inline-flex items-center gap-1.5 rounded-md bg-secondary px-3 py-1.5 text-xs font-medium text-secondary-foreground shadow-sm hover:bg-secondary/90 transition-colors"
              >
                Reset
              </button>
              {applyStatus === "rendered" && (
                <span className="text-xs text-emerald-500 font-medium">✓ Rendered — switch to Diagram to view</span>
              )}
              {applyStatus === "failed" && (
                <span className="text-xs text-destructive font-medium">✗ Render failed — switch to Diagram for fix options</span>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

interface WikiDocumentViewerProps {
  content: string;
  title: string;
  createdAt?: string;
  updatedAt?: string;
  author?: string;
  /**
   * Optional callback used when the viewer needs to update the underlying
   * markdown content (for example, when AI fixes a Mermaid diagram).
   */
  onContentChange?: (nextContent: string) => void;
}

export function WikiDocumentViewer({
  content,
  title,
  createdAt,
  updatedAt,
  author,
  onContentChange,
}: WikiDocumentViewerProps) {
  const contentRef = useRef<HTMLDivElement>(null);
  const contentStateRef = useRef<string>(content);

  // Stable refs for props used inside the memoized components object.
  // This avoids recreating the components object (and thus remounting MermaidBlock)
  // whenever the parent passes a new onContentChange or title reference.
  const onContentChangeRef = useRef(onContentChange);
  const titleRef = useRef(title);

  useEffect(() => { onContentChangeRef.current = onContentChange; }, [onContentChange]);
  useEffect(() => { titleRef.current = title; }, [title]);

  // Keep a ref of the latest content so DOM event handlers can use it
  useEffect(() => {
    contentStateRef.current = content;
  }, [content]);

  // NOTE: Mermaid rendering is handled by the MermaidBlock component above.
  // Initialization is at module level to guarantee it runs before any render() call.

  // Periodic DOM cleanup for stray mermaid error text nodes injected directly
  // by the old DOM-mutation rendering path (pre-MermaidBlock). Safe to keep
  // as a defensive measure without any side effects on the React-managed path.
  useEffect(() => {
    // Cleanup function to remove any Mermaid error messages from DOM
    const cleanupMermaidErrors = () => {
      if (!contentRef.current) return;

      // Remove any text nodes or elements containing Mermaid error messages
      const walker = document.createTreeWalker(
        contentRef.current,
        NodeFilter.SHOW_TEXT,
        {
          acceptNode: (node) => {
            const text = node.textContent || '';
            if (text.includes('mermaid version') ||
              text.includes('error in text') ||
              text.includes('Syntax error in text')) {
              return NodeFilter.FILTER_ACCEPT;
            }
            return NodeFilter.FILTER_REJECT;
          }
        }
      );

      const nodesToRemove: Node[] = [];
      let node;
      while (node = walker.nextNode()) {
        nodesToRemove.push(node);
      }

      nodesToRemove.forEach(node => {
        if (node.parentNode) {
          node.parentNode.removeChild(node);
        }
      });

      // Also remove any divs or elements containing error messages
      const allElements = contentRef.current.querySelectorAll('div, span, p, pre');
      allElements.forEach(el => {
        const text = el.textContent || '';
        if ((text.includes('mermaid version') ||
          text.includes('error in text') ||
          text.includes('Syntax error in text')) &&
          !el.closest('.mermaid-diagram') && // Don't remove actual diagram containers
          !el.closest('.mermaid-rendered')) { // Don't remove rendered diagrams
          el.remove();
        }
      });
    };

    const renderMermaid = async () => {
      if (!contentRef.current) return;

      // Clean up any existing error messages first
      cleanupMermaidErrors();

      const allCodeElements = contentRef.current.querySelectorAll("code");
      const mermaidElements = Array.from(allCodeElements).filter(el => {
        if (el.classList.contains("language-mermaid")) return true;
        const text = (el.textContent || "").trim();
        return /^(graph|flowchart|sequenceDiagram|classDiagram|stateDiagram|erDiagram|gantt|pie|gitGraph|mindmap|timeline|quadrantChart|requirementDiagram|journey)\b/i.test(text);
      });

      for (let i = 0; i < mermaidElements.length; i++) {
        const element = mermaidElements[i] as HTMLElement;
        const code = element.textContent || "";
        const pre = element.closest('pre');

        if (!pre) continue;

        // Check if it actually has the rendered output inside it.
        // React might re-render and wipe our custom innerHTML while preserving classes.
        const hasRenderedOutput = pre.querySelector('.mermaid-diagram') || pre.querySelector('.text-destructive');
        const isRendering = pre.classList.contains('mermaid-rendering');

        if (code.trim() && !hasRenderedOutput && !isRendering) {
          // Store the block index for later replacement
          const blockIndex = i;
          
          // Lock to prevent parallel renders of the same block
          pre.classList.add('mermaid-rendering');
          
          try {
            // Clear any existing error messages in the pre element
            const existingErrors = pre.querySelectorAll('.mermaid-error, [class*="error"]');
            existingErrors.forEach(el => el.remove());

            const { svg } = await mermaid.render(
              `mermaid-${i}-${Date.now()}`,
              code
            );
            
            // Clear any error messages that might have been inserted
            pre.innerHTML = "";
            pre.innerHTML = `<div class="mermaid-diagram">${svg}</div>`;
          } catch (err) {
            // Silently handle Mermaid errors - don't log version/syntax errors
            const errorMessage =
              err instanceof Error ? err.message : String(err);
            if (
              !errorMessage.includes("mermaid version") &&
              !errorMessage.includes("error in text") &&
              !errorMessage.includes("Syntax error in text")
            ) {
              console.error("Mermaid rendering error:", err);
            }

            // Mark as rendered to avoid repeated attempts on the same block
            pre.classList.add("mermaid-rendered");

            // When we don't have an edit callback, fall back to a simple message
            if (!onContentChange) {
              pre.innerHTML = "";
              pre.innerHTML =
                '<div class="text-sm text-destructive bg-destructive/10 p-3 rounded border border-destructive/20">Failed to render diagram</div>';
              return;
            }

            // When an edit callback is available, show an inline AI fix action
            // and allow the user to repair the diagram syntax.
            pre.innerHTML = "";
            const container = document.createElement("div");
            container.className =
              "space-y-2 text-sm rounded border border-destructive/20 bg-destructive/10 p-3";

            const message = document.createElement("div");
            message.className = "text-destructive font-medium";
            message.textContent = "Failed to render diagram";

            const actionsRow = document.createElement("div");
            actionsRow.className = "flex items-center gap-3 flex-wrap";

            const fixButton = document.createElement("button");
            fixButton.type = "button";
            fixButton.className =
              "inline-flex items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground shadow-sm hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2";
            fixButton.textContent = "AI fix diagram";

            const regenerateButton = document.createElement("button");
            regenerateButton.type = "button";
            regenerateButton.className =
              "inline-flex items-center gap-2 rounded-md bg-secondary px-3 py-1.5 text-xs font-medium text-secondary-foreground shadow-sm hover:bg-secondary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-secondary focus-visible:ring-offset-2";
            regenerateButton.textContent = "Regenerate diagram";

            const statusText = document.createElement("span");
            statusText.className =
              "text-[11px] text-muted-foreground hidden";

            actionsRow.appendChild(fixButton);
            actionsRow.appendChild(regenerateButton);
            actionsRow.appendChild(statusText);

            container.appendChild(message);
            container.appendChild(actionsRow);

            pre.appendChild(container);

            // Helper function to process diagram fix/regeneration
            const processDiagram = async (regenerate: boolean = false) => {
              const activeButton = regenerate ? regenerateButton : fixButton;
              if (activeButton.getAttribute("data-loading") === "true") return;

              // Disable both buttons during processing
              fixButton.setAttribute("data-loading", "true");
              regenerateButton.setAttribute("data-loading", "true");
              const originalFixLabel = fixButton.textContent || "AI fix diagram";
              const originalRegenLabel = regenerateButton.textContent || "Regenerate diagram";

              activeButton.textContent = regenerate ? "Regenerating..." : "Fixing diagram...";
              fixButton.classList.add("opacity-80", "cursor-wait");
              regenerateButton.classList.add("opacity-80", "cursor-wait");
              statusText.classList.add("hidden");

              try {
                const response = await fetch(getApiUrl("/api/wiki/fix-mermaid"), {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json",
                  },
                  credentials: "include",
                  body: JSON.stringify({
                    mermaidCode: code,
                    context: title || "",
                    regenerate: regenerate,
                  }),
                });

                // Check if response is ok before parsing
                if (!response.ok) {
                  // Try to get error message from response
                  let errorMessage = `Request failed with status ${response.status}`;
                  try {
                    const contentType = response.headers.get("content-type");
                    if (contentType && contentType.includes("application/json")) {
                      const errorData = await response.json();
                      errorMessage = errorData?.error || errorData?.details || errorMessage;
                    } else {
                      const errorText = await response.text();
                      if (errorText) {
                        errorMessage = errorText;
                      }
                    }
                  } catch (parseError) {
                    // If we can't parse the error, use the default message
                    console.error("Failed to parse error response:", parseError);
                  }
                  throw new Error(errorMessage);
                }

                // Check if response has content before parsing JSON
                const contentType = response.headers.get("content-type");
                if (!contentType || !contentType.includes("application/json")) {
                  throw new Error("Server returned non-JSON response");
                }

                // Get response text first to check if it's empty
                const responseText = await response.text();
                if (!responseText || responseText.trim().length === 0) {
                  throw new Error("Server returned empty response");
                }

                // Parse JSON
                let data;
                try {
                  data = JSON.parse(responseText);
                } catch (jsonError) {
                  console.error("Failed to parse JSON response:", jsonError);
                  console.error("Response text:", responseText);
                  throw new Error("Server returned invalid JSON response");
                }

                if (!data?.fixedCode) {
                  throw new Error(
                    data?.error || data?.details || (regenerate ? "Failed to regenerate Mermaid diagram" : "Failed to fix Mermaid diagram")
                  );
                }

                const fixedCode = String(data.fixedCode);

                // First, try rendering the fixed/regenerated code immediately so the
                // user sees the corrected diagram without waiting for a
                // full markdown re-render.
                try {
                  const { svg } = await mermaid.render(
                    `mermaid-${regenerate ? 'regenerated' : 'fixed'}-${i}-${Date.now()}`,
                    fixedCode
                  );
                  pre.classList.add("mermaid-rendered");
                  pre.innerHTML = "";
                  pre.innerHTML = `<div class="mermaid-diagram">${svg}</div>`;
                } catch (renderError) {
                  // If even the fixed/regenerated code can't be rendered, show error with regenerate option
                  console.error(
                    `Mermaid rendering still failed after AI ${regenerate ? 'regeneration' : 'fix'}:`,
                    renderError
                  );
                  pre.innerHTML = "";
                  const errorContainer = document.createElement("div");
                  errorContainer.className = "space-y-2 text-sm rounded border border-destructive/20 bg-destructive/10 p-3";

                  const errorMessage = document.createElement("div");
                  errorMessage.className = "text-destructive font-medium";
                  errorMessage.textContent = regenerate
                    ? "AI attempted to regenerate this diagram, but it still cannot be rendered."
                    : "AI attempted to fix this diagram, but it still cannot be rendered.";

                  const retryActions = document.createElement("div");
                  retryActions.className = "flex items-center gap-3 flex-wrap mt-2";

                  const retryRegenerateBtn = document.createElement("button");
                  retryRegenerateBtn.type = "button";
                  retryRegenerateBtn.className = "inline-flex items-center gap-2 rounded-md bg-secondary px-3 py-1.5 text-xs font-medium text-secondary-foreground shadow-sm hover:bg-secondary/90";
                  retryRegenerateBtn.textContent = "Try regenerate again";
                  retryRegenerateBtn.addEventListener("click", () => {
                    processDiagram(true);
                  });

                  retryActions.appendChild(retryRegenerateBtn);
                  errorContainer.appendChild(errorMessage);
                  errorContainer.appendChild(retryActions);
                  pre.appendChild(errorContainer);
                }

                // Update the underlying markdown content so any future loads
                // and the Save action use the corrected Mermaid block.
                const currentContent = contentStateRef.current;

                if (!currentContent || !code) {
                  throw new Error("No content available to update");
                }

                // Find the specific Mermaid block by index (more reliable than content matching)
                // Parse the markdown to find all Mermaid blocks and replace the one at blockIndex
                const lines = currentContent.split('\n');
                let mermaidBlockCount = 0;
                let inMermaidBlock = false;
                let blockStartIndex = -1;
                let blockEndIndex = -1;
                let foundTargetBlock = false;

                for (let idx = 0; idx < lines.length; idx++) {
                  const line = lines[idx];
                  const trimmedLine = line.trim();

                  // Check for mermaid block start
                  if (trimmedLine === '```mermaid' || trimmedLine === ':::mermaid' || trimmedLine === '::: mermaid') {
                    if (mermaidBlockCount === blockIndex) {
                      // This is the block we want to replace
                      inMermaidBlock = true;
                      blockStartIndex = idx;
                    }
                    mermaidBlockCount++;
                    continue;
                  }

                  // Check for mermaid block end
                  if (inMermaidBlock && (trimmedLine === '```' || trimmedLine === ':::')) {
                    blockEndIndex = idx;
                    foundTargetBlock = true;
                    break;
                  }
                }

                let updatedContent = currentContent;

                if (foundTargetBlock && blockStartIndex >= 0 && blockEndIndex >= 0) {
                  // Replace the entire code block (including fences) with the fixed code
                  const newLines = [...lines];
                  const startMarker = lines[blockStartIndex];
                  const endMarker = lines[blockEndIndex];

                  // Determine the format (```mermaid or ::: mermaid)
                  const isMarkdownFormat = startMarker.trim().startsWith('```');

                  // Replace the block content, keeping the markers
                  if (isMarkdownFormat) {
                    // Markdown format: ```mermaid\n<code>\n```
                    newLines.splice(
                      blockStartIndex + 1,
                      blockEndIndex - blockStartIndex - 1,
                      fixedCode
                    );
                  } else {
                    // Azure DevOps format: ::: mermaid\n<code>\n:::
                    newLines.splice(
                      blockStartIndex + 1,
                      blockEndIndex - blockStartIndex - 1,
                      fixedCode
                    );
                  }

                  updatedContent = newLines.join('\n');
                } else {
                  // Fallback: try to find and replace by content matching
                  // This handles edge cases where block counting might fail
                  const codeBlockPatterns = [
                    // Standard markdown format: ```mermaid\n<code>\n```
                    new RegExp(`(\`\`\`mermaid\\s*\\n)(${escapeRegex(code)})(\\s*\\n\`\`\`)`, 's'),
                    // Azure DevOps format: ::: mermaid\n<code>\n:::
                    new RegExp(`(:::\\s*mermaid\\s*\\n)(${escapeRegex(code)})(\\s*\\n:::)`, 's'),
                  ];

                  let replaced = false;
                  for (const pattern of codeBlockPatterns) {
                    if (pattern.test(currentContent)) {
                      updatedContent = currentContent.replace(
                        pattern,
                        (match, prefix, oldCode, suffix) => {
                          replaced = true;
                          return prefix + fixedCode + suffix;
                        }
                      );
                      break;
                    }
                  }

                  if (!replaced) {
                    // Last resort: try flexible content matching
                    const normalizedCode = code.trim().replace(/\s+/g, ' ');
                    const contentMatches = currentContent.match(/```mermaid\s*\n([\s\S]*?)\n```/g) ||
                      currentContent.match(/:::\s*mermaid\s*\n([\s\S]*?)\n:::/g);

                    if (contentMatches && contentMatches[blockIndex]) {
                      const match = contentMatches[blockIndex];
                      const normalizedMatch = match.replace(/\s+/g, ' ');
                      if (normalizedMatch.includes(normalizedCode)) {
                        updatedContent = currentContent.replace(match, match.replace(
                          /(```mermaid\s*\n|:::\s*mermaid\s*\n)[\s\S]*?(\n```|\n:::)/,
                          `$1${fixedCode}$2`
                        ));
                      }
                    } else {
                      console.warn('[WikiDocumentViewer] Could not find Mermaid block to replace. Content may not be saved correctly.');
                    }
                  }
                }

                // Update the ref and notify parent
                contentStateRef.current = updatedContent;

                // Verify the update was successful by checking if content changed
                if (updatedContent !== currentContent && onContentChange) {
                  onContentChange(updatedContent);
                  console.log('[WikiDocumentViewer] Mermaid diagram updated in content');
                } else if (!onContentChange) {
                  console.warn('[WikiDocumentViewer] onContentChange not provided - diagram fix will not be saved');
                }

                // Show a short success hint while the re-render happens
                statusText.textContent = regenerate
                  ? "Diagram regenerated. Preview updating…"
                  : "Diagram syntax fixed. Preview updating…";
                statusText.classList.remove("hidden");
                statusText.classList.remove("text-destructive");
                statusText.classList.add("text-emerald-600");
              } catch (error) {
                console.error(`Failed to ${regenerate ? 'regenerate' : 'AI-fix'} Mermaid diagram:`, error);
                statusText.textContent =
                  error instanceof Error
                    ? error.message
                    : (regenerate ? "Regeneration failed. Please try again." : "AI fix failed. Please try again.");
                statusText.classList.remove("hidden");
                statusText.classList.remove("text-emerald-600");
                statusText.classList.add("text-destructive");
              } finally {
                fixButton.setAttribute("data-loading", "false");
                regenerateButton.setAttribute("data-loading", "false");
                fixButton.textContent = originalFixLabel;
                regenerateButton.textContent = originalRegenLabel;
                fixButton.classList.remove("opacity-80", "cursor-wait");
                regenerateButton.classList.remove("opacity-80", "cursor-wait");
                pre.classList.remove('mermaid-rendering');
              }
            };

            // Attach click handlers
            fixButton.addEventListener("click", () => processDiagram(false));
            regenerateButton.addEventListener("click", () => processDiagram(true));
          } finally {
            pre.classList.remove('mermaid-rendering');
          }
        }
      }

      // Clean up any error messages that might have been inserted after rendering
      cleanupMermaidErrors();
    };

    // Periodic cleanup to remove stray Mermaid error text nodes
    const cleanupInterval = setInterval(cleanupMermaidErrors, 2000);
    return () => clearInterval(cleanupInterval);
  }, [content]);

  // Stable code-block renderer — must NOT be recreated on each render.
  // ReactMarkdown calls React.createElement(components.code, props) for every code
  // fence. If `components.code` is a new function reference each render, React sees
  // a new component TYPE, unmounts the old tree (including MermaidBlock + its timer),
  // and mounts a fresh one — resetting the render timer indefinitely.
  // useCallback with [] gives a permanent stable reference; props that may change
  // (onContentChange, title) are read through refs so the closure never goes stale.
  const codeRenderer = useMemo(() => function CodeRenderer({ inline, className, children, ...props }: any) {
    if (inline) {
      return (
        <code className="px-1.5 py-0.5 rounded bg-muted text-sm font-mono text-foreground" {...props}>
          {children}
        </code>
      );
    }

    let codeText = "";
    if (Array.isArray(children)) {
      codeText = children.map((c: any) => (typeof c === "string" ? c : "")).join("").trim();
    } else {
      codeText = String(children ?? "").trim();
    }

    const isMermaid =
      /language-mermaid/i.test(className || "") ||
      MERMAID_KEYWORDS.test(codeText);

    if (isMermaid) {
      return (
        <MermaidBlock
          code={codeText}
          onContentChange={onContentChangeRef.current}
          title={titleRef.current}
          contentRef={contentStateRef}
        />
      );
    }

    return (
      <pre className="my-4 p-4 rounded-lg bg-muted border border-border overflow-x-auto">
        <code className={className} {...props}>
          {children}
        </code>
      </pre>
    );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Process content to handle Azure DevOps Wiki mermaid syntax (::: mermaid)
  // Supports both multi-line and single-line ::: mermaid blocks.
  const processedContent = content
    // Multi-line blocks:
    // ::: mermaid\n<code>\n:::
    .replace(/:::\s*mermaid\s*\n([\s\S]*?)\n:::/gi, (_, code) => {
      return "```mermaid\n" + String(code).trim() + "\n```";
    })
    // Single-line blocks:
    // ::: mermaid <code> :::
    .replace(/:::\s*mermaid\s+([\s\S]*?):::/gi, (_, code) => {
      return "```mermaid\n" + String(code).trim() + "\n```";
    });

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Wiki-style Header */}
      <div className="border-b bg-card">
        <div className="px-8 py-6">
          <h1 className="text-3xl font-semibold text-foreground mb-3">
            {title}
          </h1>
          {(updatedAt || createdAt || author) && (
            <div className="flex items-center gap-4 text-sm text-muted-foreground">
              {author && (
                <div className="flex items-center gap-2">
                  <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center text-xs font-medium text-primary">
                    {author.charAt(0).toUpperCase()}
                  </div>
                  <span>{author}</span>
                </div>
              )}
              {(updatedAt || createdAt) && (
                <div className="flex items-center gap-2">
                  <Calendar className="h-4 w-4" />
                  <span>
                    {updatedAt
                      ? new Date(updatedAt).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                      })
                      : createdAt
                        ? new Date(createdAt).toLocaleDateString("en-US", {
                          month: "short",
                          day: "numeric",
                          year: "numeric",
                        })
                        : ""}
                  </span>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Wiki Content */}
      <ScrollArea className="flex-1">
        <div className="max-w-5xl mx-auto px-8 py-8">
          <div
            ref={contentRef}
            className="wiki-content prose prose-slate dark:prose-invert max-w-none"
          >
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                // Custom heading styling
                h1: ({ children }) => (
                  <h1 className="text-3xl font-bold mt-8 mb-4 pb-2 border-b border-border">
                    {children}
                  </h1>
                ),
                h2: ({ children }) => (
                  <h2 className="text-2xl font-semibold mt-8 mb-4 pb-2 border-b border-border/50">
                    {children}
                  </h2>
                ),
                h3: ({ children }) => (
                  <h3 className="text-xl font-semibold mt-6 mb-3">
                    {children}
                  </h3>
                ),
                h4: ({ children }) => (
                  <h4 className="text-lg font-semibold mt-4 mb-2">
                    {children}
                  </h4>
                ),
                // Tables
                table: ({ children }) => (
                  <div className="my-6 overflow-x-auto">
                    <table className="min-w-full divide-y divide-border border border-border rounded-lg">
                      {children}
                    </table>
                  </div>
                ),
                thead: ({ children }) => (
                  <thead className="bg-muted">{children}</thead>
                ),
                th: ({ children }) => (
                  <th className="px-4 py-3 text-left text-sm font-semibold text-foreground">
                    {children}
                  </th>
                ),
                td: ({ children }) => (
                  <td className="px-4 py-3 text-sm text-muted-foreground border-t border-border">
                    {children}
                  </td>
                ),
                // Code blocks — uses stable memoized renderer above to prevent
                // MermaidBlock from unmounting on every WikiDocumentViewer re-render.
                code: codeRenderer,
                // Lists
                ul: ({ children }) => (
                  <ul className="my-4 ml-6 list-disc space-y-2">{children}</ul>
                ),
                ol: ({ children }) => (
                  <ol className="my-4 ml-6 list-decimal space-y-2">
                    {children}
                  </ol>
                ),
                li: ({ children }) => (
                  <li className="text-muted-foreground leading-relaxed">
                    {children}
                  </li>
                ),
                // Paragraphs
                p: ({ children }) => (
                  <p className="my-4 text-muted-foreground leading-relaxed">
                    {children}
                  </p>
                ),
                // Blockquotes
                blockquote: ({ children }) => (
                  <blockquote className="my-4 pl-4 border-l-4 border-primary/50 italic text-muted-foreground bg-muted/30 py-2 pr-4 rounded-r">
                    {children}
                  </blockquote>
                ),
                // Links
                a: ({ children, href }) => (
                  <a
                    href={href}
                    className="text-primary hover:underline font-medium"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {children}
                  </a>
                ),
                // Horizontal rule
                hr: () => <hr className="my-8 border-border" />,
                // Images
                img: ({ src, alt }) => (
                  <img
                    src={src}
                    alt={alt || ""}
                    className="my-6 rounded-lg border border-border max-w-full h-auto"
                  />
                ),
              }}
            >
              {processedContent}
            </ReactMarkdown>
          </div>
        </div>
      </ScrollArea>
    </div>
  );
}

