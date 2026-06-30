import { useState, useEffect, useRef, useMemo } from "react";
import { createPortal } from "react-dom";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import {
  FileText,
  Download,
  Copy,
  Check,
  Clock3,
  CheckCircle2,
  CircleSlash2,
  Loader2,
  ChevronRight,
  FileDown,
  Printer,
  Maximize2,
  Minimize2,
  ChevronDown,
  File,
  FileUp,
  Link2,
  Info,
} from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { MarkdownTextarea } from "@/components/ui/markdown-textarea";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { apiRequest } from "@/lib/queryClient";
import { getApiUrl } from "@/lib/api-config";
import { useToast } from "@/hooks/use-toast";
import { AiEnhanceWithDiff } from "@/components/AiEnhanceWithDiff";

export interface BRDSubSection {
  title: string;
  content: string;
  originalIndex: number;
  originalIndices?: number[];
  subsections?: BRDSubSection[];
}

export interface BRDSection {
  title: string;
  content: string;
  subsections?: BRDSubSection[];
  originalIndex?: number;
  originalIndices?: number[];
}

export interface BRDDocument {
  title: string;
  version: string;
  date: string;
  sections: BRDSection[];
  rawMarkdown: string;
  brdTemplateId?: string;
}

interface BRDPreviewProps {
  brd: BRDDocument | null;
  isLoading?: boolean;
  /**
   * Optional generation-progress payload.
   * When provided, the loading panel shows a timer + checklist inside BRDPreview.
   */
  brdJobProgress?: {
    elapsedMs: number;
    progressFloor: number;
    step?: string | null;
    stepKey?: string;
    stepDurationsMs?: Record<string, number>;
  };
  brdLastGenerationSummary?: {
    totalDurationMs: number;
    stepDurationsMs: Record<string, number>;
    sectionOutcomes?: Record<number, "Generated" | "Skipped (TBD)">;
  } | null;
  /** Called when user accepts AI-enhanced text. sectionId = index in brd.sections (flat). */
  onEnhanceSection?: (
    sectionId: number,
    enhancedText: string,
    originalText?: string
  ) => void;
  onApprove?: () => Promise<void>;
  isApproving?: boolean;
  onSendToReview?: () => Promise<void>;
  isSendingToReview?: boolean;
  brdStatus?: string; // Current BRD status: "draft", "review", "approved", etc.
  brdFileName?: string | null;
  brdFileType?: string | null;
  brdId?: string;
  goldenRepoName?: string | null;
  canApprove?: boolean;
  onCancel?: () => Promise<void>;
  isCancelling?: boolean;
}

export function BRDPreview({
  brd,
  isLoading = false,
  brdJobProgress,
  brdLastGenerationSummary,
  onEnhanceSection,
  onApprove,
  isApproving = false,
  onSendToReview,
  isSendingToReview = false,
  brdStatus,
  brdFileName,
  brdFileType,
  brdId,
  goldenRepoName,
  canApprove = true,
  onCancel,
  isCancelling = false,
}: BRDPreviewProps) {
  const [copiedSection, setCopiedSection] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState("sections");
  const [sectionPageIndex, setSectionPageIndex] = useState(0);
  const [isFullScreen, setIsFullScreen] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [exportFormat, setExportFormat] = useState<"docx" | "pdf">(() => {
    // Load last used format from localStorage
    const saved = localStorage.getItem("brd-export-format");
    return (saved === "pdf" || saved === "docx" ? saved : "docx") as
      | "docx"
      | "pdf";
  });
  const { toast } = useToast();

  // Manual edit dialog state (non-AI inline edits for sections); sectionId = index in brd.sections
  const [manualEditOpen, setManualEditOpen] = useState(false);
  const [manualEditSectionId, setManualEditSectionId] = useState<number | null>(null);
  const [manualEditOriginalIndices, setManualEditOriginalIndices] = useState<number[]>([]);
  const [manualEditTitle, setManualEditTitle] = useState<string | null>(null);
  const [manualEditContent, setManualEditContent] = useState("");
  const [manualEditOriginalContent, setManualEditOriginalContent] = useState("");
  const manualEditRef = useRef<HTMLTextAreaElement>(null);

  // When the manual-edit dialog opens, Radix autofocuses the textarea and the
  // caret lands at position 0. Defer one frame so that autofocus runs first,
  // then move the caret to the end and scroll it into view.
  useEffect(() => {
    if (!manualEditOpen) return;
    const frame = requestAnimationFrame(() => {
      const el = manualEditRef.current;
      if (!el) return;
      const end = el.value.length;
      el.focus();
      el.setSelectionRange(end, end);
      el.scrollTop = el.scrollHeight;
    });
    return () => cancelAnimationFrame(frame);
  }, [manualEditOpen]);

  const openManualEdit = (originalIndices: number[], title: string, content: string) => {
    // Resolve the primary index for the edit
    const primaryId = originalIndices[0];
    const resolvedSectionId = resolveSectionIdForEdit(primaryId, title, content);

    setManualEditSectionId(resolvedSectionId);
    setManualEditOriginalIndices(originalIndices);
    setManualEditTitle(title);
    setManualEditOriginalContent(content);
    setManualEditContent(content);
    setManualEditOpen(true);
  };

  const handleManualEditSave = () => {
    if (manualEditSectionId == null || !onEnhanceSection) {
      setManualEditOpen(false);
      return;
    }

    // Update the primary section
    onEnhanceSection(
      manualEditSectionId,
      manualEditContent,
      manualEditOriginalContent
    );

    // Clear any other folded indices
    if (manualEditOriginalIndices.length > 1) {
      for (const idx of manualEditOriginalIndices) {
        if (idx !== manualEditSectionId) {
          onEnhanceSection(idx, "");
        }
      }
    }

    setManualEditOpen(false);
    setManualEditSectionId(null);
    setManualEditOriginalIndices([]);
    setManualEditOriginalContent("");
    toast({
      title: "Section updated",
      description: "Your manual changes have been applied to this BRD section.",
    });
  };

  const normalizeContentForMatch = (text: string): string => {
    const t = (text || "").trim();
    if (!t) return "";
    const withoutTopHeading = t.replace(/^#{1,6}\s+.+\n+/, "");
    return withoutTopHeading.replace(/\s+/g, " ").trim().toLowerCase();
  };

  const isStrongContentMatch = (a: string, b: string): boolean => {
    const aa = normalizeContentForMatch(a);
    const bb = normalizeContentForMatch(b);
    if (!aa || !bb) return false;
    if (aa === bb) return true;
    const minLen = Math.min(aa.length, bb.length);
    if (minLen < 40) return false;
    return aa.includes(bb) || bb.includes(aa);
  };

  const resolveSectionIdForEdit = (
    preferredId: number | undefined,
    title: string,
    clickedContent: string
  ): number => {
    const sections = brd?.sections || [];
    if (!sections.length) return preferredId ?? -1;

    if (
      preferredId !== undefined &&
      preferredId >= 0 &&
      preferredId < sections.length &&
      (isStrongContentMatch(sections[preferredId]?.content || "", clickedContent) ||
        normalizeTitle(sections[preferredId]?.title || "") === normalizeTitle(title || ""))
    ) {
      return preferredId;
    }

    const byContent = sections.findIndex((s) =>
      isStrongContentMatch(s?.content || "", clickedContent)
    );
    if (byContent >= 0) return byContent;

    const byTitle = sections.findIndex(
      (s) => normalizeTitle(s?.title || "") === normalizeTitle(title || "")
    );
    if (byTitle >= 0) return byTitle;

    if (preferredId !== undefined && preferredId >= 0 && preferredId < sections.length) {
      return preferredId;
    }
    return 0;
  };

  // Reset full screen when BRD changes
  useEffect(() => {
    if (!brd) {
      setIsFullScreen(false);
    }
  }, [brd]);

  // z-[100] must sit above Dialog overlays (z-50) when preview is opened inside a modal
  const fullScreenZIndex = 100;

  // Prevent body scroll when in full screen mode
  useEffect(() => {
    if (isFullScreen) {
      // Prevent body scroll
      document.body.style.overflow = "hidden";
      return () => {
        // Restore body scroll when exiting full screen
        document.body.style.overflow = "";
      };
    }
  }, [isFullScreen]);

  useEffect(() => {
    if (!isFullScreen) return;
    const frame = requestAnimationFrame(() => {
      document
        .querySelector<HTMLElement>('[data-testid="brd-fullscreen-root"]')
        ?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [isFullScreen]);

  // Helper to escape special regex characters
  const escapeRegex = (str: string): string => {
    return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  };

  // Clean section title for display (remove trailing "**:" or "**" from LLM output)
  const cleanSectionTitleForDisplay = (title: string): string => {
    if (!title) return "";
    return title
      .replace(/\*\*:?\s*$/g, "")
      .replace(/^\*\*|\*\*$/g, "")
      .trim();
  };

  // Normalize text by removing leading numbers and formatting
  // Used to compare titles for duplicate detection
  const normalizeTitle = (text: string): string => {
    if (!text) return "";
    // Remove leading markdown heading markers (#, ##, ###, etc.)
    let normalized = text.replace(/^#+\s+/, "");
    // Remove leading numbers and dots/parentheses (e.g., "1.", "3.1", "2)", "1.1.1", "2.1 Business Goals")
    // Pattern matches: "1.", "1.1.", "2.1.1.", "2)", "2.1 ", "1.1 Business"
    normalized = normalized.replace(/^\d+(?:\.\d+)*(?:[.)]\s*|\s+)/, "");
    // Remove bold markers (both at start/end and standalone)
    normalized = normalized.replace(/^\*\*|\*\*$/g, "");
    normalized = normalized.replace(/\*\*/g, "");
    // Remove italic markers
    normalized = normalized.replace(/^_|_$/g, "");
    // Remove trailing colons (for label patterns like "Purpose:")
    normalized = normalized.replace(/:\s*$/, "");
    // Remove extra whitespace
    normalized = normalized.replace(/\s+/g, " ");
    // Trim and lowercase
    let result = normalized.trim().toLowerCase();

    // Standardize plural/singular for common words to improve matching
    result = result.replace(/\bgoals\b/g, "goal")
      .replace(/\brequirements\b/g, "requirement")
      .replace(/\brules\b/g, "rule")
      .replace(/\bpolicies\b/g, "policy")
      .replace(/\bentities\b/g, "entity")
      .replace(/\bpersonas\b/g, "persona")
      .replace(/\bobjectives\b/g, "objective")
      .replace(/\bstakeholders\b/g, "stakeholder")
      .replace(/\bdocuments\b/g, "document")
      .replace(/\bconstraints\b/g, "constraint")
      .replace(/\bassumptions\b/g, "assumption")
      .replace(/\bdependencies\b/g, "dependency")
      .replace(/\brisks\b/g, "risk")
      .replace(/\bmilestones\b/g, "milestone")
      .replace(/\bsummaries\b/g, "summary");

    return result;
  };

  // Extract numbered heading from content (e.g., "2.1 Business Goals" from "## 2.1 Business Goals")
  // Returns the numbered heading if found, otherwise returns null
  const extractNumberedHeading = (content: string): string | null => {
    if (!content) return null;
    const lines = content.split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      // Check for markdown heading with numbered prefix (e.g., "## 2.1 Business Goals")
      const headingMatch = trimmed.match(
        /^(#{1,6})\s+(\d+(?:\.\d+)*[.)]?\s*.+)$/
      );
      if (headingMatch) {
        return headingMatch[2].trim(); // Return "2.1 Business Goals"
      }

      // Check for plain numbered line (e.g., "2.1 Business Goals")
      const numberedMatch = trimmed.match(/^(\d+(?:\.\d+)*[.)]?\s*.+)$/);
      if (numberedMatch) {
        return numberedMatch[1].trim(); // Return "2.1 Business Goals"
      }

      // Only check first non-empty line
      break;
    }
    return null;
  };

  // Strip duplicate top heading from markdown content
  // Finds the first markdown heading/label and removes it if it matches the expected title
  // Handles:
  // - Markdown headings: #, ##, ###, etc. (e.g., ### 1.1 Purpose)
  // - Bold labels: **Purpose**, **1.1 Purpose**
  // - Label lines with colons: Purpose:, Scope:, Definitions and Acronyms:
  // - Plain lines with only the title (after removing numeric prefixes)
  // - Numbered labels: 1.1 Purpose, 2.3 Scope
  const stripDuplicatedTopHeading = (
    md: string,
    expectedTitle: string
  ): string => {
    if (!md || !expectedTitle) return md;

    const lines = md.split("\n");
    const normalizedExpected = normalizeTitle(expectedTitle);

    // Find the first non-empty line and check if it matches any duplicate pattern
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue; // Skip empty lines

      let lineText = line;
      let normalizedLine = "";
      let hasPattern = false;

      // Pattern 1: Markdown heading (^#{1,6}\s+.+$)
      // Matches: ### 1.1 Purpose, ## Introduction, # Title, ## 2.1 Business Goals
      const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
      if (headingMatch) {
        // Extract text after the heading markers (e.g., "2.1 Business Goals" from "## 2.1 Business Goals")
        lineText = headingMatch[2];
        // Normalize will remove the "2.1 " prefix automatically
        normalizedLine = normalizeTitle(lineText);
        hasPattern = true;
      } else {
        // Pattern 2: Bold label (**Purpose** or **1.1 Purpose**)
        // Matches: **Purpose**, **1.1 Purpose**, **Scope**
        const boldMatch = line.match(/^\*\*(.+?)\*\*\s*$/);
        if (boldMatch) {
          lineText = boldMatch[1];
          normalizedLine = normalizeTitle(lineText);
          hasPattern = true;
        } else {
          // Pattern 3: Label with colon (Purpose:, Scope:, etc.)
          // Matches: Purpose:, Scope:, Definitions and Acronyms:
          const colonMatch = line.match(/^(.+?):\s*$/);
          if (colonMatch) {
            lineText = colonMatch[1];
            normalizedLine = normalizeTitle(lineText);
            hasPattern = true;
          } else {
            // Pattern 4: Numbered label at start (1.1 Purpose, 2.3 Scope)
            // Matches: 1.1 Purpose, 2.3.1 Deep, 3 Scope
            const numberedMatch = line.match(/^(\d+(?:\.\d+)*[.)]\s*)?(.+)$/);
            if (numberedMatch && numberedMatch[1]) {
              // Only treat as pattern if it has a number prefix
              lineText = numberedMatch[2];
              normalizedLine = normalizeTitle(lineText);
              hasPattern = true;
            } else {
              // Pattern 5: Plain line (just the title, possibly with numeric prefix)
              normalizedLine = normalizeTitle(line);
            }
          }
        }
      }

      // If normalized line matches expected title, remove this line
      // Use fuzzy matching: match if one is a substring of the other or they are identical normalized
      if (normalizedLine && (
        normalizedLine === normalizedExpected ||
        normalizedLine.includes(normalizedExpected) ||
        normalizedExpected.includes(normalizedLine)
      )) {
        // Remove this line and any following empty lines
        const result = lines.slice(i + 1).join("\n");
        // Remove leading empty lines
        return result.replace(/^\n+/, "");
      }

      // If we found a heading/pattern but it doesn't match, stop looking
      // (we only want to remove the first line if it's a duplicate)
      // Exception: if it's Pattern 5 (plain line), continue checking in case there's a heading later
      if (hasPattern) {
        break;
      }
    }

    return md;
  };

  // Remove duplicate title from section content if it starts with the section title as a heading
  const removeDuplicateTitle = (
    content: string,
    sectionTitle: string
  ): string => {
    if (!content || !sectionTitle) return content;

    const lines = content.split("\n");
    const trimmedTitle = sectionTitle.trim();

    // Patterns to match: "# Title", "## Title", "### Title", "**Title**", "1. Title", etc.
    const titlePatterns = [
      new RegExp(`^#+\\s+${escapeRegex(trimmedTitle)}\\s*$`, "i"),
      new RegExp(`^\\*\\*${escapeRegex(trimmedTitle)}\\*\\*\\s*$`, "i"),
      new RegExp(`^\\d+[.)]\\s*${escapeRegex(trimmedTitle)}\\s*$`, "i"),
      new RegExp(`^${escapeRegex(trimmedTitle)}\\s*$`, "i"),
    ];

    // Check if first non-empty line matches any title pattern
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue; // Skip empty lines

      // Check if this line matches any title pattern
      const matchesTitle = titlePatterns.some((pattern) => pattern.test(line));

      if (matchesTitle) {
        // Remove this line and any following empty lines
        const result = lines.slice(i + 1).join("\n");
        // Remove leading empty lines
        return result.replace(/^\n+/, "");
      }

      // If we've checked a few lines and none match, stop looking
      if (i > 2) break;
    }

    return content;
  };

  const normalizeMarkdownTablesForSectionView = (markdown: string): string => {
    if (!markdown) return markdown;

    const inferHeaderForSeparator = (separatorLine: string): string | null => {
      const colCount = separatorLine.split("|").filter((cell) => cell.trim().length > 0).length;
      if (colCount === 3) return "| ID | Requirement Description | Priority |";
      if (colCount === 4) return "| ID | Requirement Description | Priority | Traceability |";
      if (colCount === 5) return "| ID | Requirement Description | Priority | Traceability | Notes |";
      return null;
    };

    const normalizePipeRuns = (line: string): string[] => {
      const trimmed = line.trim();
      if (!trimmed.includes("|")) return [line];

      const hasMultipleRowsOnOneLine =
        /\|\s*\|\s*(?=[A-Z]{1,6}-?\d+\b)/.test(trimmed) ||
        /\|\s*(?=[A-Z]{1,6}-?\d+\s*\|)/.test(trimmed.slice(1));
      if (!hasMultipleRowsOnOneLine) return [line];

      return trimmed
        .replace(/\|\s*\|\s*(?=([A-Z]{1,6}-?\d+)\b)/g, "|\n| ")
        .replace(/([^\n])\s+\|\s*(?=([A-Z]{1,6}-?\d+)\s*\|)/g, "$1\n| ")
        .split("\n")
        .map((part) => part.trim())
        .filter(Boolean);
    };

    const inputLines = markdown.split("\n");
    const expandedLines = inputLines.flatMap(normalizePipeRuns);
    const output: string[] = [];

    for (let i = 0; i < expandedLines.length; i++) {
      const line = expandedLines[i];
      const trimmed = line.trim();
      const isSeparator = /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(trimmed);
      const previous = output[output.length - 1]?.trim() || "";
      const previousIsPipeRow = previous.startsWith("|") && previous.endsWith("|");

      if (isSeparator && !previousIsPipeRow) {
        const inferredHeader = inferHeaderForSeparator(trimmed);
        if (inferredHeader) output.push(inferredHeader);
      }

      output.push(line);
    }

    return output.join("\n");
  };

  const prepareSectionMarkdownForRender = (markdown: string, title: string): string => {
    return normalizeMarkdownTablesForSectionView(stripDuplicatedTopHeading(markdown, title));
  };

  // Mapper function to convert flat sections array to hierarchical structure
  // Builds a numbering-based hierarchy:
  // - Level 1: ^\d+\.          (e.g. "4. ...")
  // - Level 2: ^\d+\.\d+       (e.g. "4.1 ...")
  // - Level 3: ^\d+\.\d+\.\d+  (e.g. "4.1.1 ...")
  const buildHierarchicalSections = (
    flatSections: Array<{ title: string; content: string }>
  ): BRDSection[] => {
    const getNumbering = (section: { title: string; content: string }): string | null => {
      const t = section.title.trim();
      const titleMatch = t.match(/^(\d+(?:\.\d+){0,2})\s*[.)]?\s+/);
      if (titleMatch) return titleMatch[1];
      const contentMatch = section.content.match(/^(#{1,6})\s+(\d+(?:\.\d+){0,2})\s*[.)]?\s+/m);
      if (contentMatch) return contentMatch[2];
      return null;
    };

    const getLevel = (num: string | null): 1 | 2 | 3 => {
      if (!num) return 1;
      const dots = (num.match(/\./g) || []).length;
      if (dots === 0) return 1;
      if (dots === 1) return 2;
      return 3;
    };

    // IMPORTANT: Keep numbering in titles (e.g. "6.1 Functional Requirements") so the BRD
    // preview can render the fixed 1–13 outline exactly as required.
    const keepTitleAsIs = (title: string): string => title.trim() || title;

    const hierarchicalSections: BRDSection[] = [];
    const stack: Array<{ level: 1 | 2 | 3; node: BRDSection | BRDSubSection }> = [];

    for (let i = 0; i < flatSections.length; i++) {
      const s = flatSections[i] as any;
      const num = getNumbering(s);
      const level = getLevel(num);

      if (level === 1) {
        const node: BRDSection = {
          title: s.title,
          content: s.content,
          subsections: [],
          originalIndex: s.originalIndex ?? i,
          originalIndices: s.originalIndices || [s.originalIndex ?? i],
        };
        hierarchicalSections.push(node);
        stack.length = 0;
        stack.push({ level: 1, node });
        continue;
      }

      const child: BRDSubSection = {
        title: keepTitleAsIs(s.title),
        content: s.content,
        originalIndex: s.originalIndex ?? i,
        originalIndices: s.originalIndices || [s.originalIndex ?? i],
        subsections: [],
      };

      // Pop until we find a parent with smaller level
      while (stack.length > 0 && stack[stack.length - 1].level >= level) {
        stack.pop();
      }

      // Fallback parent resolution
      const parent = stack[stack.length - 1]?.node;
      if (!parent) {
        // No parent found, treat as top-level for safety
        hierarchicalSections.push({
          title: s.title,
          content: s.content,
          originalIndex: i,
        });
        continue;
      }

      if ("subsections" in parent) {
        parent.subsections = parent.subsections || [];
        parent.subsections.push(child);
      }

      stack.push({ level, node: child });
    }

    // Remove empty subsections arrays to keep payload small/clean
    const prune = (nodes: Array<BRDSection | BRDSubSection>) => {
      for (const n of nodes) {
        if (n.subsections && n.subsections.length > 0) prune(n.subsections);
        if (n.subsections && n.subsections.length === 0) delete (n as any).subsections;
      }
    };
    prune(hierarchicalSections);

    return hierarchicalSections;
  };

  // BRD preview structure normalizer (UI-only).
  // Forces the fixed 1–13 outline, preserves 6.1–6.4 exactly, routes requirement-like
  // content into Section 6, and appends unmatched extra sections only after 13.
  const withHeading = (
    numberedTitle: string,
    content: string,
    level: 2 | 3,
    skipTbd: boolean = false
  ): string => {
    const clean = (content || "").trim();
    const headingPrefix = level === 2 ? "##" : "###";
    if (!clean || clean.toLowerCase() === "tbd") {
      return skipTbd ? `${headingPrefix} ${numberedTitle}` : `${headingPrefix} ${numberedTitle}\n\nTBD`;
    }

    // Strip any duplicated copy of the section title at the top of the content
    // (matches "# Title", "## 1. Title", "**Title**", "Title:", "1. Title", or plain "Title").
    // This prevents duplicate headings in the printed/exported output when the LLM
    // emitted the section title inside the content itself.
    const stripped = stripDuplicatedTopHeading(clean, numberedTitle).trim();
    const contentToUse = stripped || clean;

    return `${headingPrefix} ${numberedTitle}\n\n${contentToUse}`;
  };

  const normalizeBrdStructureForPreview = (
    flatSections: Array<{ title: string; content: string }>
  ): Array<{ title: string; content: string; originalIndices: number[] }> => {
    const FIXED: Array<{
      n: string;
      title: string;
      subs?: Array<{ n: string; title: string }>;
    }> = [
        { n: "1", title: "Document Information" },
        { n: "2", title: "Executive Summary" },
        {
          n: "3",
          title: "Introduction",
          subs: [
            { n: "3.1", title: "Purpose" },
            { n: "3.2", title: "Scope" },
            { n: "3.3", title: "Definitions and Acronyms" },
          ],
        },
        {
          n: "4",
          title: "Business Objectives",
          subs: [
            { n: "4.1", title: "Business Goals" },
            { n: "4.2", title: "Success Criteria" },
            { n: "4.3", title: "Key Performance Indicators (KPIs)" },
          ],
        },
        {
          n: "5",
          title: "Stakeholder Analysis",
          subs: [
            { n: "5.1", title: "Key Stakeholders" },
            { n: "5.2", title: "User Personas" },
          ],
        },
        {
          n: "6",
          title: "Requirements",
          subs: [
            { n: "6.1", title: "Functional Requirements" },
            { n: "6.2", title: "Non-Functional Requirements" },
            { n: "6.3", title: "Technical Requirements" },
            { n: "6.4", title: "Integration Requirements" },
          ],
        },
        {
          n: "7",
          title: "Business Rules",
          subs: [
            { n: "7.1", title: "Business Rules Overview" },
          ]
        },
        {
          n: "8",
          title: "Data Requirements",
          subs: [
            { n: "8.1", title: "Data Entities" },
            { n: "8.2", title: "Data Migration" },
          ],
        },
        {
          n: "9",
          title: "Constraints and Assumptions",
          subs: [
            { n: "9.1", title: "Constraints" },
            { n: "9.2", title: "Assumptions" },
            { n: "9.3", title: "Dependencies" },
          ],
        },
        { n: "10", title: "Risks and Mitigation" },
        { n: "11", title: "Timeline and Milestones" },
        {
          n: "12",
          title: "Appendices",
          subs: [
            { n: "12.1", title: "Reference Documents" },
            { n: "12.2", title: "Approval Matrix" },
          ],
        },
        { n: "13", title: "Additional Organizational Guidelines" },
      ];

    const isRequirementLikeTitle = (tNorm: string): boolean => {
      return (
        tNorm.includes("requirement") ||
        tNorm.includes("validation") ||
        tNorm.includes("field modification") ||
        tNorm.includes("message tag") ||
        tNorm.includes("integration point") ||
        tNorm.includes("system architecture") ||
        tNorm.includes("authentication") ||
        tNorm.includes("api strategy") ||
        tNorm.includes("third party") ||
        tNorm.includes("third-party") ||
        tNorm.includes("single sign on") ||
        tNorm.includes("sso") ||
        tNorm.includes("proxy service") ||
        tNorm.includes("technical specification") ||
        tNorm.includes("interface") ||
        tNorm.includes("api") ||
        tNorm.includes("non functional") ||
        tNorm.includes("functional")
      );
    };

    const mapRequirementSubsection = (
      tNorm: string
    ): "6.1" | "6.2" | "6.3" | "6.4" | "6.x" => {
      if (
        tNorm.includes("non functional") ||
        tNorm.includes("nfr") ||
        tNorm.includes("performance") ||
        tNorm.includes("security") ||
        tNorm.includes("availability") ||
        tNorm.includes("scalability")
      ) {
        return "6.2";
      }
      if (
        tNorm.includes("integration") ||
        tNorm.includes("interface") ||
        tNorm.includes("api") ||
        tNorm.includes("authentication") ||
        tNorm.includes("single sign on") ||
        tNorm.includes("sso") ||
        tNorm.includes("token") ||
        tNorm.includes("third party") ||
        tNorm.includes("third-party") ||
        tNorm.includes("external system") ||
        tNorm.includes("salesforce") ||
        tNorm.includes("whisper") ||
        tNorm.includes("proxy service") ||
        tNorm.includes("backend service") ||
        tNorm.includes("internal api") ||
        tNorm.includes("endpoint") ||
        tNorm.includes("service") ||
        tNorm.includes("downstream") ||
        tNorm.includes("upstream")
      ) {
        return "6.4";
      }
      if (
        tNorm.includes("technical") ||
        tNorm.includes("specification") ||
        tNorm.includes("architecture") ||
        tNorm.includes("technology") ||
        tNorm.includes("platform")
      ) {
        return "6.3";
      }
      if (
        tNorm.includes("functional") ||
        tNorm.includes("business requirement") ||
        tNorm.includes("user story") ||
        tNorm.includes("use case") ||
        tNorm.includes("validation") ||
        tNorm.includes("field") ||
        tNorm.includes("message tag")
      ) {
        return "6.1";
      }
      return "6.x";
    };

    const mapFixedKey = (tNorm: string, content?: string): string | null => {
      // STAGE 0: Very specific keywords that identify the section content
      // These override any numeric prefixes in the original document.
      if (tNorm === "data entity" || tNorm === "data model" || tNorm === "data entities") {
        return "8.1";
      }
      if (tNorm.includes("data migration")) return "8.2";
      if (tNorm.includes("functional") && tNorm.includes("requirement")) return "6.1";
      if (tNorm.includes("non functional") || tNorm.includes("nfr")) return "6.2";
      if (tNorm.includes("integration") && tNorm.includes("requirement")) return "6.4";
      if (
        tNorm.includes("system architecture") ||
        tNorm.includes("authentication") ||
        tNorm.includes("api strategy") ||
        tNorm.includes("third party") ||
        tNorm.includes("third-party") ||
        tNorm.includes("single sign on") ||
        tNorm.includes("sso") ||
        tNorm.includes("proxy service") ||
        tNorm.includes("backend service") ||
        tNorm.includes("internal api") ||
        tNorm.includes("external system")
      ) {
        return "6.4";
      }
      if (tNorm.includes("technical") && tNorm.includes("requirement")) return "6.3";

      // STAGE 1: Standard top-level keywords
      if (tNorm.includes("document information")) return "1";
      if (tNorm.includes("executive summary") || tNorm.includes("project summary") || tNorm === "summary") return "2";
      if (tNorm.includes("introduction")) return "3";
      if (tNorm.includes("business objective")) return "4";
      if (tNorm.includes("stakeholder analysis") || tNorm.includes("user persona")) return "5";
      if (tNorm.includes("business rule") || tNorm.endsWith(" rule") || tNorm.includes("operational policy")) return "7";
      // Map "Data Requirements" explicitly to Section 8 (parent), not 8.1
      if (tNorm === "data requirement" || tNorm === "data requirements") return "8";
      if (tNorm.includes("constraints") || tNorm.includes("assumptions") || tNorm.includes("dependencies")) return "9";
      if (tNorm.includes("risks and mitigation") || tNorm.includes("risk analysis")) return "10";
      if (tNorm.includes("timeline") || tNorm.includes("milestone") || tNorm.includes("project plan")) return "11";
      if (tNorm.includes("appendices") || tNorm.includes("appendix")) return "12";
      if (tNorm.includes("organizational guidelines")) return "13";

      // STAGE 2: Subsections
      if (tNorm === "purpose") return "3.1";
      if (tNorm === "scope") return "3.2";
      if (tNorm.includes("definitions and acronyms") || tNorm.includes("glossary")) return "3.3";
      if (tNorm.includes("business goal")) return "4.1";
      if (tNorm.includes("success criteria")) return "4.2";
      if (tNorm.includes("kpi") || tNorm.includes("performance indicator") || tNorm.includes("monitoring")) return "4.3";
      if (tNorm.includes("key stakeholder")) return "5.1";
      if (tNorm.includes("user persona")) return "5.2";
      if (tNorm === "data entities") return "8.1";
      if (tNorm === "data migration") return "8.2";
      if (tNorm === "constraints") return "9.1";
      if (tNorm === "assumptions") return "9.2";
      if (tNorm === "dependencies") return "9.3";
      if (tNorm.includes("reference documents")) return "12.1";
      if (tNorm.includes("approval matrix")) return "12.2";

      // Business Rules Subsections
      if (tNorm.includes("overview") && tNorm.includes("business rule")) return "7.1";
      if (tNorm.includes("core business rule")) return "7.1";

      return null;
    };

    const fixedTitlesByNum = new Map<string, string>();
    const fixedSubTitlesByNum = new Map<string, string>();
    for (const s of FIXED) {
      fixedTitlesByNum.set(s.n, `${s.n}. ${s.title}`);
      for (const sub of s.subs || []) {
        fixedSubTitlesByNum.set(sub.n, `${sub.n} ${sub.title}`);
      }
    }

    const bucket: Record<
      string,
      { title: string; contentParts: string[]; originalIndices: number[] }
    > = {};

    const isPlaceholder = (c: string): boolean => {
      const low = c.toLowerCase();
      return (
        low.includes("generated in pass") ||
        low.includes("to be generated") ||
        low.includes("section will be provided") ||
        (low.length < 50 && low.includes("none specified"))
      );
    };

    const addToBucket = (
      key: string,
      numberedTitle: string,
      content: string,
      secTitle: string,
      originalIndex?: number
    ) => {
      if (!bucket[key]) {
        bucket[key] = { title: numberedTitle, contentParts: [], originalIndices: [] };
      }

      // Cleanup: Strip the header from the content piece itself before adding to bucket.
      // We use the bucket's own title (standardized) to find and strip mismatched original headers.
      const cleaned = stripDuplicatedTopHeading(content || "", numberedTitle);

      if (!cleaned || cleaned === "TBD") return;

      // Deduplicate: Don't add if exact content already exists in this bucket
      if (bucket[key].contentParts.includes(cleaned)) {
        if (originalIndex !== undefined && !bucket[key].originalIndices.includes(originalIndex)) {
          bucket[key].originalIndices.push(originalIndex);
        }
        return;
      }

      // Deduplicate: If we already have real content, don't add "Pass X" placeholders
      if (isPlaceholder(cleaned) && bucket[key].contentParts.some(p => !isPlaceholder(p))) {
        return;
      }

      // Conversely, if we are adding real content and the bucket ONLY has placeholders, clear them
      if (!isPlaceholder(cleaned) && bucket[key].contentParts.every(p => isPlaceholder(p))) {
        bucket[key].contentParts = [];
      }

      if (originalIndex !== undefined && !bucket[key].originalIndices.includes(originalIndex)) {
        bucket[key].originalIndices.push(originalIndex);
      }
      bucket[key].contentParts.push(cleaned);
    };

    let lastFixedKey = "1";
    for (let i = 0; i < flatSections.length; i++) {
      const sec = flatSections[i];
      const titleRaw = cleanSectionTitleForDisplay(sec.title || "");
      const tNorm = normalizeTitle(titleRaw);

      // Detect explicit numeric prefix in title (e.g. "8.1")
      const numPrefixMatch = titleRaw.match(/^(\d+(?:\.\d+)*)/);
      const explicitNum = numPrefixMatch ? numPrefixMatch[1] : null;

      // Algorithm:
      // 1. Try mapping based on the TEXT (tNorm) - this handles fuzzy titles like "Core Business Rules"
      // 2. If no text match, try mapping based on the explicit number (e.g. "6.1" -> 6.1)
      // 3. Special case: If title is "Data ...", insist on Section 8 even if numbering says 6.x

      let key = mapFixedKey(tNorm, sec.content);

      // If the number says 6.1 but title says "Data Entities", mapFixedKey should have returned "8.1"
      // thanks to the Priority 1 rules.

      if (!key && explicitNum) {
        // Fallback to explicit numbering if title is generic
        if (fixedTitlesByNum.has(explicitNum) || fixedSubTitlesByNum.has(explicitNum)) {
          key = explicitNum;
        }
      }

      if (key) {
        lastFixedKey = key.includes(".") ? key.split(".")[0] : key;
        const isSub = key.includes(".");
        const numberedTitle = isSub
          ? fixedSubTitlesByNum.get(key) || `${key} ${titleRaw}`
          : fixedTitlesByNum.get(key) || `${key}. ${titleRaw}`;
        addToBucket(key, numberedTitle, sec.content, sec.title, i);
      } else if (isRequirementLikeTitle(tNorm)) {
        const mapped = mapRequirementSubsection(tNorm);
        const targetKey = mapped === "6.x" ? "6" : mapped;
        const numberedTitle = fixedSubTitlesByNum.get(targetKey) || fixedTitlesByNum.get(targetKey) || "6. Requirements";
        addToBucket(targetKey, numberedTitle, sec.content, sec.title, i);
      } else {
        const numberedTitle = fixedTitlesByNum.get(lastFixedKey) || `${lastFixedKey}. Section`;
        addToBucket(lastFixedKey, numberedTitle, sec.content, sec.title, i);
      }
    }

    const out: Array<{ title: string; content: string; originalIndices: number[] }> = [];

    const emitSection = (n: string, title: string, subs?: Array<{ n: string; title: string }>) => {
      const key = n;
      const b = bucket[key];
      const numberedTitle = `${n}. ${title}`;

      let finalContentParts = b ? [...b.contentParts] : [];
      let originalIndices = b ? [...b.originalIndices] : [];

      if (subs) {
        for (const sub of subs) {
          const sb = bucket[sub.n];
          if (sb && sb.contentParts.length > 0) {
            const subTitle = fixedSubTitlesByNum.get(sub.n) || `${sub.n} ${sub.title}`;
            const subContent = sb.contentParts.join("\n\n");
            // Strip the sub-section's original headings (e.g. "4.1 Functional Requirements")
            // before wrapping it in the new "6.1 Functional Requirements" heading.
            const cleanedSubContent = stripDuplicatedTopHeading(subContent, subTitle);
            finalContentParts.push(withHeading(subTitle, cleanedSubContent, 3));

            if (sb.originalIndices) {
              for (const idx of sb.originalIndices) {
                if (!originalIndices.includes(idx)) originalIndices.push(idx);
              }
            }
          }
        }
      }

      const combined = finalContentParts.join("\n\n").trim();
      const cleanedContent = stripDuplicatedTopHeading(combined, numberedTitle);

      out.push({
        title: numberedTitle,
        content: cleanedContent,
        originalIndices: originalIndices,
      });
    };

    for (const fixed of FIXED) {
      emitSection(fixed.n, fixed.title, fixed.subs);
    }

    // Final Deduplication Pass: Merge sections with the same title
    // (This handles cases where Section 8 might have been split in the source)
    const mergedOut: Array<{ title: string; content: string; originalIndices: number[] }> = [];
    const titleToIndex = new Map<string, number>();

    for (const section of out) {
      const existingIdx = titleToIndex.get(section.title);
      if (existingIdx !== undefined) {
        // Merge with existing section
        if (!mergedOut[existingIdx].content.includes(section.content)) {
          mergedOut[existingIdx].content += "\n\n" + section.content;
        }
        for (const idx of section.originalIndices) {
          if (!mergedOut[existingIdx].originalIndices.includes(idx)) {
            mergedOut[existingIdx].originalIndices.push(idx);
          }
        }
      } else {
        titleToIndex.set(section.title, mergedOut.length);
        mergedOut.push(section);
      }
    }

    return mergedOut;
  };

  const isBrdPlaceholderContent = (c: string): boolean => {
    const low = (c || "").toLowerCase().trim();
    return (
      !low ||
      low === "tbd" ||
      low === "n/a" ||
      low.includes("generated in pass") ||
      low.includes("to be generated") ||
      low.includes("section will be provided") ||
      (low.length < 50 && low.includes("none specified"))
    );
  };

  const isBrdSectionEmpty = (section: BRDSection | BRDSubSection): boolean => {
    const hasContent = !isBrdPlaceholderContent(section.content);
    const hasSubsections =
      section.subsections &&
      section.subsections.some((sub) => !isBrdSectionEmpty(sub));
    return !hasContent && !hasSubsections;
  };

  const hierarchicalPreviewSections = useMemo(() => {
    if (!brd?.sections) return [];
    const normalizedFlatSections = normalizeBrdStructureForPreview(brd.sections);
    return buildHierarchicalSections(normalizedFlatSections).filter(
      (s) => !isBrdSectionEmpty(s)
    );
  }, [brd?.sections]);

  const totalPreviewSections = hierarchicalPreviewSections.length;
  const currentPreviewSectionIndex =
    totalPreviewSections > 0
      ? Math.min(sectionPageIndex, totalPreviewSections - 1)
      : 0;

  const sectionsScrollRef = useRef<HTMLDivElement>(null);
  const sectionRefs = useRef<(HTMLDivElement | null)[]>([]);

  const scrollToSection = (index: number) => {
    const clamped = Math.max(0, Math.min(totalPreviewSections - 1, index));
    setSectionPageIndex(clamped);
    const target = sectionRefs.current[clamped];
    target?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  useEffect(() => {
    setSectionPageIndex(0);
    sectionsScrollRef.current?.scrollTo({ top: 0 });
  }, [brdId]);

  useEffect(() => {
    if (
      totalPreviewSections > 0 &&
      sectionPageIndex >= totalPreviewSections
    ) {
      setSectionPageIndex(totalPreviewSections - 1);
    }
  }, [totalPreviewSections, sectionPageIndex]);

  useEffect(() => {
    const container = sectionsScrollRef.current;
    if (
      !container ||
      activeTab !== "sections" ||
      totalPreviewSections === 0
    ) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (!visible?.target) return;

        const idx = Number(
          (visible.target as HTMLElement).dataset.sectionIndex
        );
        if (!Number.isNaN(idx)) {
          setSectionPageIndex(idx);
        }
      },
      {
        root: container,
        threshold: [0.15, 0.35, 0.55, 0.75],
        rootMargin: "-8% 0px -55% 0px",
      }
    );

    sectionRefs.current.forEach((el) => {
      if (el) observer.observe(el);
    });

    return () => observer.disconnect();
  }, [activeTab, hierarchicalPreviewSections, totalPreviewSections]);

  // Internal helper to handle enhanced text specifically for normalized sections
  const handleApplyEnhance = (originalIndices: number[], newText: string) => {
    if (!originalIndices || originalIndices.length === 0 || !onEnhanceSection) return;

    // Use the first index for the new content
    const targetIdx = originalIndices[0];
    onEnhanceSection(targetIdx, newText);

    // Clear any other folded indices so they don't reappear
    for (let i = 1; i < originalIndices.length; i++) {
      onEnhanceSection(originalIndices[i], "");
    }
  };

  const handleCopySection = async (title: string, content: string) => {
    // Ensure we don't have double headers when copying
    const text = withHeading(title, content, 2);
    await navigator.clipboard.writeText(text);
    setCopiedSection(title);
    setTimeout(() => setCopiedSection(null), 2000);
  };

  const handleCopyAll = async () => {
    if (!brd) return;
    await navigator.clipboard.writeText(assembleSectionsMarkdown());
    setCopiedSection("all");
    setTimeout(() => setCopiedSection(null), 2000);
  };

  // Helper to assemble sections Markdown for export
  const assembleSectionsMarkdown = (): string => {
    if (!brd) return "";

    const isPlaceholder = (c: string): boolean => {
      const low = (c || "").toLowerCase().trim();
      return (
        !low ||
        low === "tbd" ||
        low === "n/a" ||
        low.includes("generated in pass") ||
        low.includes("to be generated") ||
        low.includes("section will be provided") ||
        (low.length < 50 && low.includes("none specified"))
      );
    };

    const isSectionEmpty = (section: any): boolean => {
      const hasContent = !isPlaceholder(section.content);
      const hasSubsections = section.subsections && section.subsections.some((sub: any) => !isSectionEmpty(sub));
      return !hasContent && !hasSubsections;
    };

    const normalizedFlatSections = normalizeBrdStructureForPreview(brd.sections);
    const hierarchical = buildHierarchicalSections(normalizedFlatSections);

    // We filter hierarchical sections recursively
    const filterEmpty = (nodes: any[]): any[] => {
      return nodes
        .filter(n => !isSectionEmpty(n))
        .map(n => ({
          ...n,
          subsections: n.subsections ? filterEmpty(n.subsections) : undefined
        }));
    };

    const filtered = filterEmpty(hierarchical);

    // Flatten back for easy markdown assembly
    const flatten = (nodes: any[]): any[] => {
      let res: any[] = [];
      for (const n of nodes) {
        res.push(n);
        if (n.subsections) res = res.concat(flatten(n.subsections));
      }
      return res;
    };

    return flatten(filtered)
      .map((section) => {
        const isSelfPlaceholder = isPlaceholder(section.content);
        const level = section.title.split('.').length > 1 ? 3 : 2;
        return withHeading(section.title, isSelfPlaceholder ? "" : section.content, level, true);
      })
      .join("\n\n");
  };

  // Helper to create safe filename
  const createSafeFilename = (
    title: string,
    version: string,
    ext: string
  ): string => {
    const safeTitle = (title || 'document')
      .replace(/[^a-zA-Z0-9\s-]/g, " ")
      .trim()
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-");
    const safeVersion = version ? `-${version.replace(/[^a-zA-Z0-9.-]/g, "")}` : "-1.0";
    return `BRD-${safeTitle}${safeVersion}.${ext}`;
  };

  const handleExport = async (format: "docx" | "pdf") => {
    if (!brd || !brdId) return;

    // Always use the live export API for both DOCX and PDF to ensure the title
    // is correctly rendered (stored files may have been generated with the old broken title).

    setIsExporting(true);

    try {
      // Use raw markdown for BOTH PDF and DOCX to ensure identical content and formatting
      // Raw markdown includes all tables, formatting, and content exactly as it appears in the UI
      const payload: Record<string, any> = {
        brdId: brdId,
        title: brd.title,
        version: brd.version,
        rawMarkdown: assembleSectionsMarkdown(), // Build from normalized sections to ensure fixes are included
        format: format,
      };

      let endpoint = "/api/brd/export"; // DOCX endpoint

      if (format === "pdf") {
        endpoint = "/api/brd/export-pdf"; // PDF endpoint
      }

      // Send request to appropriate endpoint
      const response = await apiRequest("POST", endpoint, payload);

      // apiRequest already validates response.ok, so we can directly call .blob()
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;

      // Get filename from Content-Disposition header or create one
      const contentDisposition = response.headers.get("Content-Disposition");
      let filename = createSafeFilename(brd.title, brd.version, format);
      if (contentDisposition) {
        const filenameMatch = contentDisposition.match(/filename="?([^"]+)"?/);
        if (filenameMatch) {
          filename = filenameMatch[1];
        }
      }

      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      // Update button text AFTER successful download (fixes issue #3)
      setExportFormat(format);
      localStorage.setItem("brd-export-format", format);

      toast({
        title: "Export successful",
        description: `${format.toUpperCase()} file downloaded successfully.`,
      });
    } catch (error) {
      console.error(`[BRD] Failed to export ${format.toUpperCase()}:`, error);
      toast({
        title: "Export failed",
        description:
          error instanceof Error
            ? error.message
            : `Failed to export ${format.toUpperCase()}. Please try again.`,
        variant: "destructive",
      });
    } finally {
      setIsExporting(false);
    }
  };

  const handlePrint = () => {
    // Helper function to convert markdown to HTML (matches backend conversion for consistency)
    const markdownToHtml = (markdown: string): string => {
      let html = markdown;

      // Store tables separately before HTML escaping
      const tables: string[] = [];
      let tableIndex = 0;

      // Process GFM tables first (before escaping HTML)
      const tableRegex = /\n(\|[^\n]+\|\s*\n\|[\s\-:|]+\|\s*\n(?:\|[^\n]+\|\s*\n?)+)/g;
      html = html.replace(tableRegex, (match) => {
        const lines = match.trim().split('\n').map(l => l.trim()).filter(line => line);
        if (lines.length < 2) return match;

        const separatorIndex = lines.findIndex(line => /^\|[\s\-\|:]+\|$/.test(line));
        if (separatorIndex === -1) return match;

        const headerLine = lines[0];
        const dataLines = lines.slice(separatorIndex + 1);
        const headerCells = headerLine.split('|').map(c => c.trim()).filter(c => c);
        if (headerCells.length === 0) return match;

        let tableHtml = '<table border="1" cellpadding="6" cellspacing="0" style="border-collapse: collapse; width: 100%; margin: 12pt 0; border: 1px solid #000;">';
        tableHtml += '<thead><tr>';
        for (const cell of headerCells) {
          tableHtml += `<th style="border: 1px solid #000; padding: 6pt; background-color: #f0f0f0; font-weight: 700; text-align: left;">${cell}</th>`;
        }
        tableHtml += '</tr></thead><tbody>';

        for (const dataLine of dataLines) {
          const dataCells = dataLine.split('|').map(c => c.trim()).filter(c => c);
          if (dataCells.length === headerCells.length) {
            tableHtml += '<tr>';
            for (const cell of dataCells) {
              tableHtml += `<td style="border: 1px solid #000; padding: 6pt; text-align: left;">${cell}</td>`;
            }
            tableHtml += '</tr>';
          }
        }

        tableHtml += '</tbody></table>';

        // Store table and replace with placeholder
        tables[tableIndex] = tableHtml;
        return `\n[TABLE_PLACEHOLDER_${tableIndex++}]`;
      });

      // NOW escape HTML special characters (tables are protected by placeholders)
      html = html.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

      // Replace placeholders back with actual HTML tables
      for (let i = 0; i < tables.length; i++) {
        html = html.replace(`[TABLE_PLACEHOLDER_${i}]`, tables[i]);
      }

      // Replace code blocks (multi-line)
      html = html.replace(/```[\s\S]*?```/g, (match) => {
        const code = match.replace(/```/g, "").trim();
        return `<pre><code>${code}</code></pre>`;
      });

      // Replace inline code
      html = html.replace(/`([^`]+)`/g, "<code>$1</code>");

      // Replace bold
      html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
      html = html.replace(/__([^_]+)__/g, "<strong>$1</strong>");

      // Replace italics
      html = html.replace(/\*([^*]+)\*/g, "<em>$1</em>");
      html = html.replace(/_([^_]+)_/g, "<em>$1</em>");

      // Split content into lines
      let lines = html.split("\n");
      let output: string[] = [];
      let inList = false;
      let inBlockquote = false;
      let currentListItems: string[] = [];
      let currentBlockquoteLines: string[] = [];
      let inOrderedList = false;
      let orderedListIndex = 1;

      for (let i = 0; i < lines.length; i++) {
        let line = lines[i];

        // Skip empty lines between paragraphs
        if (!line.trim()) {
          // Flush current list
          if (inList && currentListItems.length > 0) {
            if (inOrderedList) {
              output.push(`<ol>${currentListItems.map((item) => `<li>${item}</li>`).join("")}</ol>`);
            } else {
              output.push(`<ul>${currentListItems.map((item) => `<li>${item}</li>`).join("")}</ul>`);
            }
            currentListItems = [];
            inList = false;
            inOrderedList = false;
            orderedListIndex = 1;
          }
          // Flush current blockquote
          if (inBlockquote && currentBlockquoteLines.length > 0) {
            output.push(`<blockquote><p>${currentBlockquoteLines.join(" ")}</p></blockquote>`);
            currentBlockquoteLines = [];
            inBlockquote = false;
          }
          continue;
        }

        const trimmed = line.trim();

        // Handle tables (already converted above)
        if (trimmed.startsWith('<table')) {
          if (inList && currentListItems.length > 0) {
            if (inOrderedList) {
              output.push(`<ol>${currentListItems.map((item) => `<li>${item}</li>`).join("")}</ol>`);
            } else {
              output.push(`<ul>${currentListItems.map((item) => `<li>${item}</li>`).join("")}</ul>`);
            }
            currentListItems = [];
            inList = false;
            inOrderedList = false;
          }
          if (inBlockquote && currentBlockquoteLines.length > 0) {
            output.push(`<blockquote><p>${currentBlockquoteLines.join(" ")}</p></blockquote>`);
            currentBlockquoteLines = [];
            inBlockquote = false;
          }
          output.push(trimmed);
          continue;
        }

        // Handle headings (h1-h6)
        const headingMatch = trimmed.match(/^(#{1,6})\s+(.+)$/);
        if (headingMatch) {
          // Flush lists and blockquotes before heading
          if (inList && currentListItems.length > 0) {
            if (inOrderedList) {
              output.push(`<ol>${currentListItems.map((item) => `<li>${item}</li>`).join("")}</ol>`);
            } else {
              output.push(`<ul>${currentListItems.map((item) => `<li>${item}</li>`).join("")}</ul>`);
            }
            currentListItems = [];
            inList = false;
            inOrderedList = false;
          }
          if (inBlockquote && currentBlockquoteLines.length > 0) {
            output.push(`<blockquote><p>${currentBlockquoteLines.join(" ")}</p></blockquote>`);
            currentBlockquoteLines = [];
            inBlockquote = false;
          }

          const level = headingMatch[1].length;
          const text = headingMatch[2];
          output.push(`<h${level}>${text}</h${level}>`);
          continue;
        }

        // Handle ordered list items (1., 2., etc.)
        const orderedListMatch = trimmed.match(/^\d+\.\s+(.+)$/);
        if (orderedListMatch) {
          if (!inOrderedList && inList && currentListItems.length > 0) {
            output.push(`<ul>${currentListItems.map((item) => `<li>${item}</li>`).join("")}</ul>`);
            currentListItems = [];
          }
          inList = true;
          inOrderedList = true;
          currentListItems.push(orderedListMatch[1]);
          continue;
        }

        // Handle unordered list items
        const listMatch = trimmed.match(/^[\-\*\+]\s+(.+)$/);
        if (listMatch) {
          if (inOrderedList && currentListItems.length > 0) {
            output.push(`<ol>${currentListItems.map((item) => `<li>${item}</li>`).join("")}</ol>`);
            currentListItems = [];
          }
          inList = true;
          inOrderedList = false;
          currentListItems.push(listMatch[1]);
          continue;
        }

        // Handle blockquotes
        const blockquoteMatch = trimmed.match(/^>\s+(.+)$/);
        if (blockquoteMatch) {
          inBlockquote = true;
          currentBlockquoteLines.push(blockquoteMatch[1]);
          continue;
        }

        // Regular paragraph
        if (inList && currentListItems.length > 0) {
          if (inOrderedList) {
            output.push(`<ol>${currentListItems.map((item) => `<li>${item}</li>`).join("")}</ol>`);
          } else {
            output.push(`<ul>${currentListItems.map((item) => `<li>${item}</li>`).join("")}</ul>`);
          }
          currentListItems = [];
          inList = false;
          inOrderedList = false;
        }
        if (inBlockquote && currentBlockquoteLines.length > 0) {
          output.push(`<blockquote><p>${currentBlockquoteLines.join(" ")}</p></blockquote>`);
          currentBlockquoteLines = [];
          inBlockquote = false;
        }

        if (trimmed) {
          output.push(`<p>${trimmed}</p>`);
        }
      }

      // Flush remaining lists and blockquotes
      if (inList && currentListItems.length > 0) {
        if (inOrderedList) {
          output.push(`<ol>${currentListItems.map((item) => `<li>${item}</li>`).join("")}</ol>`);
        } else {
          output.push(`<ul>${currentListItems.map((item) => `<li>${item}</li>`).join("")}</ul>`);
        }
      }
      if (inBlockquote && currentBlockquoteLines.length > 0) {
        output.push(`<blockquote><p>${currentBlockquoteLines.join(" ")}</p></blockquote>`);
      }

      return output.join("");
    };

    // Create an iframe for printing
    const iframe = document.createElement("iframe");
    iframe.style.display = "none";
    document.body.appendChild(iframe);

    const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
    if (!iframeDoc) {
      console.error("Failed to access iframe document");
      document.body.removeChild(iframe);
      return;
    }

    // Build the markdown from normalized sections (same source the DOCX/PDF export uses)
    // so the printed output stays in sync and we don't render duplicate section headings
    // coming from un-normalized `brd.rawMarkdown`.
    const normalizedMarkdown = assembleSectionsMarkdown();
    const contentHtml = normalizedMarkdown ? markdownToHtml(normalizedMarkdown) : "";

    // Build the complete HTML document
    const htmlContent = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>${(brd?.title || "BRD").replace(/"/g, "&quot;")}</title>
          <style>
            * {
              margin: 0;
              padding: 0;
              box-sizing: border-box;
            }
            
            html, body {
              width: 100%;
              height: 100%;
            }
            
            body {
              font-family: "Calibri", "Segoe UI", Tahoma, Geneva, Verdana, sans-serif;
              font-size: 11pt;
              line-height: 1.4;
              color: #1a1a1a;
              background: white;
              padding: 0.75in;
              margin: 0;
            }
            
            h1 {
              font-size: 28pt;
              font-weight: 700;
              line-height: 1.15;
              margin-top: 0;
              margin-bottom: 2pt;
              color: #1a1a1a;
              page-break-after: avoid;
              padding-top: 0;
              font-family: "Calibri", sans-serif;
            }
            
            h2 {
              font-size: 13pt;
              font-weight: 700;
              line-height: 1.3;
              margin-top: 9pt;
              margin-bottom: 3pt;
              color: #1a1a1a;
              page-break-after: avoid;
              font-family: "Calibri", sans-serif;
            }
            
            h3 {
              font-size: 11pt;
              font-weight: 700;
              line-height: 1.3;
              margin-top: 7pt;
              margin-bottom: 2pt;
              color: #333;
              page-break-after: avoid;
              font-family: "Calibri", sans-serif;
            }
            
            h4, h5, h6 {
              font-size: 11pt;
              font-weight: 700;
              line-height: 1.3;
              margin-top: 6pt;
              margin-bottom: 2pt;
              color: #333;
              page-break-after: avoid;
              font-family: "Calibri", sans-serif;
            }
            
            p {
              margin: 0 0 6pt 0;
              line-height: 1.4;
              text-align: left;
              page-break-inside: avoid;
            }
            
            ul, ol {
              margin: 2pt 0 6pt 20pt;
              padding-left: 0;
              page-break-inside: avoid;
            }
            
            li {
              margin-bottom: 2pt;
              line-height: 1.4;
            }
            
            ul li {
              list-style-type: disc;
            }
            
            ol li {
              list-style-type: decimal;
            }
            
            code {
              background-color: #f5f5f5;
              border: 1px solid #e0e0e0;
              border-radius: 3px;
              padding: 2px 4px;
              font-family: "Courier New", monospace;
              font-size: 10pt;
              color: #c41a16;
              page-break-inside: avoid;
            }
            
            pre {
              background-color: #f5f5f5;
              border: 1px solid #d0d0d0;
              border-radius: 4px;
              padding: 12pt;
              font-family: "Courier New", monospace;
              font-size: 9.5pt;
              overflow-x: auto;
              margin: 12pt 0;
              line-height: 1.4;
              page-break-inside: avoid;
              white-space: pre-wrap;
              word-wrap: break-word;
            }
            
            pre code {
              background-color: transparent;
              border: none;
              padding: 0;
              color: #333;
            }
            
            blockquote {
              border-left: 4px solid #d9d9d9;
              margin: 12pt 0;
              padding: 0 0 0 12pt;
              color: #666;
              page-break-inside: avoid;
              font-style: italic;
            }
            
            blockquote p {
              margin: 0;
            }
            
            strong, b {
              font-weight: 700;
              color: #1a1a1a;
            }
            
            em, i {
              font-style: italic;
            }
            
            table {
              border-collapse: collapse;
              width: 100%;
              margin: 6pt 0 12pt 0;
              page-break-inside: avoid;
              border: 1px solid #000000;
              table-layout: fixed;
            }
            
            th {
              border: 1px solid #000000;
              padding: 6pt;
              text-align: left;
              vertical-align: top;
              background-color: #f0f0f0;
              font-weight: 700;
              font-size: 10pt;
              word-wrap: break-word;
              overflow-wrap: break-word;
            }
            
            td {
              border: 1px solid #000000;
              padding: 6pt;
              text-align: left;
              vertical-align: top;
              font-size: 10pt;
              word-wrap: break-word;
              overflow-wrap: break-word;
            }
            
            .metadata {
              color: #666;
              font-size: 10pt;
              margin-bottom: 14pt;
              padding-bottom: 6pt;
              border: none;
            }
            
            .metadata p {
              margin: 0;
              margin-bottom: 4pt;
            }
            
            @media print {
              body {
                margin: 0;
                padding: 0.75in;
              }
              
              h1, h2, h3, h4, h5, h6 {
                page-break-after: avoid;
                page-break-inside: avoid;
                orphans: 3;
                widows: 3;
              }
              
              p, ul, ol, dl, table, pre, blockquote {
                page-break-inside: avoid;
                orphans: 2;
                widows: 2;
              }
              
              a {
                text-decoration: none;
                color: #000;
              }
            }
          </style>
        </head>
        <body>
          <img src="${window.location.origin}/astra-logo-sidebar.png" alt="ASTRA" style="height: 26px; width: auto; display: block; margin-bottom: 12pt;" />
          <h1>${brd?.title || "Business Requirements Document"}</h1>
          <div class="metadata">
            <p><strong>Version:</strong> ${brd?.version || "1.0"}</p>
          </div>
          <div id="content">${contentHtml}</div>
        </body>
      </html>
    `;

    iframeDoc.open();
    iframeDoc.write(htmlContent);
    iframeDoc.close();

    let hasPrinted = false;
    const triggerPrint = () => {
      if (hasPrinted) return;
      hasPrinted = true;
      iframe.contentWindow?.print();

      // Clean up after printing
      setTimeout(() => {
        if (iframe.parentNode) document.body.removeChild(iframe);
      }, 1000);
    };

    // Wait for the logo image to finish loading so it renders in the printout.
    // Falls back to a fixed delay if the image is missing or slow.
    const logoImg = iframeDoc.querySelector("img");
    if (logoImg && !logoImg.complete) {
      logoImg.addEventListener("load", triggerPrint, { once: true });
      logoImg.addEventListener("error", triggerPrint, { once: true });
      setTimeout(triggerPrint, 2000);
    } else {
      setTimeout(triggerPrint, 300);
    }
  };

  const toggleFullScreen = () => {
    setIsFullScreen((prev) => !prev);
  };

  // Handle download of stored BRD file
  const handleDownloadStoredFile = async () => {
    if (!brdId) return;

    try {
      const response = await fetch(getApiUrl(`/api/dev-brd/${brdId}/file`), {
        credentials: "include",
      });

      if (!response.ok) {
        throw new Error("Failed to download BRD file");
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = brdFileName || `BRD-${brdId}.docx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error("[BRD] Failed to download stored BRD file:", error);
    }
  };

  const formatDurationMs = (ms: number): string => {
    const totalSeconds = Math.max(0, Math.floor(ms / 1000));
    const mm = Math.floor(totalSeconds / 60);
    const ss = totalSeconds % 60;
    return `${mm}:${String(ss).padStart(2, "0")}`;
  };

  const deriveSectionTimingMs = (sectionNumber: number, stepDurationsMs: Record<string, number>) => {
    const byLower: Record<string, number> = {};
    for (const [k, v] of Object.entries(stepDurationsMs || {})) {
      byLower[k.toLowerCase()] = v;
    }
    const get = (...keys: string[]) => keys.reduce((sum, k) => sum + (byLower[k.toLowerCase()] || 0), 0);

    if (sectionNumber <= 5 || sectionNumber >= 9) {
      return get("brd_pass1", "brd_generate", "brd_start");
    }
    if (sectionNumber === 6) {
      return get("brd_pass2_requirements", "brd_repair_requirements", "coverage_check");
    }
    if (sectionNumber === 7 || sectionNumber === 8) {
      return get("brd_pass3_rules_data");
    }
    return 0;
  };

  if (isLoading) {
    if (brdJobProgress) {
      type ChecklistStatus = "Generated" | "Skipped (TBD)" | "In progress" | "Pending";

      const deriveStatus = (sectionNumber: number): ChecklistStatus => {
        const key = (brdJobProgress.stepKey || "").toLowerCase();

        // Before Pass 1 we are doing analysis / retrieval / canonical extraction.
        if (!key || key === "rag" || key === "canonical_extract") {
          return sectionNumber === 1 ? "In progress" : "Pending";
        }

        // Pass 1 generates the overall BRD draft with placeholders for Requirements + Rules/Data.
        if (key === "brd_pass1" || key === "brd_generate") {
          return sectionNumber === 1 ? "In progress" : "Pending";
        }

        // Pass 2 fills Requirements tables. At this point, other sections from Pass 1 exist.
        if (key === "brd_pass2_requirements" || key === "brd_repair_requirements" || key === "coverage_check") {
          if (sectionNumber === 6) return "In progress"; // Requirements
          if (sectionNumber <= 5 || sectionNumber >= 7) return "Generated";
          return "Pending";
        }

        // Pass 3 fills Business Rules + Data Requirements.
        if (key === "brd_pass3_rules_data") {
          if (sectionNumber === 7 || sectionNumber === 8) return "In progress";
          if (sectionNumber <= 6 || sectionNumber >= 9) return "Generated";
          return "Pending";
        }

        // Quality gate / finalize: content should be present for all sections.
        if (key === "quality_gate" || key === "quality_gate_repair" || key === "finalize") {
          return "Generated";
        }

        // Fallback to the existing percent-based heuristic.
        const checklistDone = (thresholdPercent: number): boolean =>
          brdJobProgress.progressFloor >= thresholdPercent;
        if (sectionNumber === 2) return checklistDone(35) ? "Generated" : "Pending";
        if (sectionNumber === 3) return checklistDone(65) ? "Generated" : "Pending";
        return "Pending";
      };

      const renderStatusIcon = (status: ChecklistStatus) => {
        if (status === "Generated") {
          return <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />;
        }
        if (status === "Skipped (TBD)") {
          return <CircleSlash2 className="h-4 w-4 text-muted-foreground" />;
        }
        if (status === "In progress") {
          return <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />;
        }
        return <Clock3 className="h-4 w-4 text-muted-foreground" />;
      };

      const stepDurationsMs = brdJobProgress.stepDurationsMs ?? {};

      const formatStatus = (sectionNumber: number): string => {
        const status = deriveStatus(sectionNumber);
        const timingMs = deriveSectionTimingMs(sectionNumber, stepDurationsMs);
        if (timingMs > 0) return `${status} · ${formatDurationMs(timingMs)}`;
        return status;
      };

      const elapsedMs = Math.max(0, brdJobProgress.elapsedMs);
      const progressPercent = Math.max(0, Math.min(100, brdJobProgress.progressFloor));

      return (
        <Card className="rounded-2xl shadow-sm border border-border/40 border-l-[3px] border-l-amber-500 bg-card">
          <CardHeader className="py-4">
            <div className="flex flex-col gap-3">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <CardTitle className="text-sm font-semibold truncate">
                    Generating BRD
                  </CardTitle>
                  <CardDescription className="mt-1 text-xs">
                    Generation continues until the server completes, fails, or is cancelled.
                    Progress reflects backend phases when available.
                  </CardDescription>
                </div>
                {onCancel && (
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={onCancel}
                    disabled={isCancelling}
                    className="shrink-0 h-7 gap-1 px-2 text-[11px]"
                  >
                    {isCancelling ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <CircleSlash2 className="h-3 w-3" />
                    )}
                    Cancel Generation
                  </Button>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="secondary" className="text-[11px]">
                  No time cap
                </Badge>
                <Badge variant="outline" className="text-[11px]">
                  {brdJobProgress.step || "Generating..."}
                </Badge>
              </div>
            </div>

            <div className="mt-3 space-y-2">
              <Progress value={progressPercent} />
              <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                <span>
                  {progressPercent}% complete
                </span>
                <span>
                  {formatDurationMs(elapsedMs)} elapsed
                </span>
              </div>
            </div>
          </CardHeader>
          <CardContent className="pt-0 pb-4 text-xs space-y-3">
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                {renderStatusIcon(deriveStatus(1))}
                <div className="font-medium">
                  ## 1. Document Information{" "}
                  <span className="text-muted-foreground">
                    {formatStatus(1)}
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-2">
                {renderStatusIcon(deriveStatus(2))}
                <div className="font-medium">
                  ## 2. Executive Summary{" "}
                  <span className="text-muted-foreground">
                    {formatStatus(2)}
                  </span>
                </div>
              </div>

              <div className="ml-4 space-y-2">
                <div className="flex items-center gap-2">
                  {renderStatusIcon(deriveStatus(3))}
                  <div className="font-medium">
                    ## 3. Introduction{" "}
                    <span className="text-muted-foreground">
                      {formatStatus(3)}
                    </span>
                  </div>
                </div>
                <div className="ml-4 space-y-1">
                  <div className="text-muted-foreground">### 3.1 Purpose</div>
                  <div className="text-muted-foreground">### 3.2 Scope</div>
                  <div className="text-muted-foreground">
                    ### 3.3 Definitions and Acronyms
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2">
                {renderStatusIcon(deriveStatus(4))}
                <div className="font-medium">
                  ## 4. Business Objectives{" "}
                  <span className="text-muted-foreground">{formatStatus(4)}</span>
                </div>
              </div>
              <div className="ml-4 space-y-1">
                <div className="text-muted-foreground">### 4.1 Business Goals</div>
                <div className="text-muted-foreground">### 4.2 Success Criteria</div>
                <div className="text-muted-foreground">
                  ### 4.3 Key Performance Indicators (KPIs)
                </div>
              </div>

              <div className="flex items-center gap-2">
                {renderStatusIcon(deriveStatus(5))}
                <div className="font-medium">
                  ## 5. Stakeholder Analysis{" "}
                  <span className="text-muted-foreground">{formatStatus(5)}</span>
                </div>
              </div>
              <div className="ml-4 space-y-1">
                <div className="text-muted-foreground">### 5.1 Key Stakeholders</div>
                <div className="text-muted-foreground">### 5.2 User Personas</div>
              </div>

              <div className="flex items-center gap-2">
                {renderStatusIcon(deriveStatus(6))}
                <div className="font-medium">
                  ## 6. Requirements{" "}
                  <span className="text-muted-foreground">{formatStatus(6)}</span>
                </div>
              </div>
              <div className="ml-4 space-y-1">
                <div className="text-muted-foreground">### 6.1 Functional Requirements</div>
                <div className="text-muted-foreground">### 6.2 Non-Functional Requirements</div>
                <div className="text-muted-foreground">### 6.3 Technical Requirements</div>
                <div className="text-muted-foreground">### 6.4 Integration Requirements</div>
              </div>

              <div className="flex items-center gap-2">
                {renderStatusIcon(deriveStatus(7))}
                <div className="font-medium">
                  ## 7. Business Rules{" "}
                  <span className="text-muted-foreground">{formatStatus(7)}</span>
                </div>
              </div>

              <div className="flex items-center gap-2">
                {renderStatusIcon(deriveStatus(8))}
                <div className="font-medium">
                  ## 8. Data Requirements{" "}
                  <span className="text-muted-foreground">{formatStatus(8)}</span>
                </div>
              </div>
              <div className="ml-4 space-y-1">
                <div className="text-muted-foreground">### 8.1 Data Entities</div>
                <div className="text-muted-foreground">### 8.2 Data Migration</div>
              </div>

              <div className="flex items-center gap-2">
                {renderStatusIcon(deriveStatus(9))}
                <div className="font-medium">
                  ## 9. Constraints and Assumptions{" "}
                  <span className="text-muted-foreground">{formatStatus(9)}</span>
                </div>
              </div>
              <div className="ml-4 space-y-1">
                <div className="text-muted-foreground">### 9.1 Constraints</div>
                <div className="text-muted-foreground">### 9.2 Assumptions</div>
                <div className="text-muted-foreground">### 9.3 Dependencies</div>
              </div>

              <div className="flex items-center gap-2">
                {renderStatusIcon(deriveStatus(10))}
                <div className="font-medium">
                  ## 10. Risks and Mitigation{" "}
                  <span className="text-muted-foreground">{formatStatus(10)}</span>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {renderStatusIcon(deriveStatus(11))}
                <div className="font-medium">
                  ## 11. Timeline and Milestones{" "}
                  <span className="text-muted-foreground">{formatStatus(11)}</span>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {renderStatusIcon(deriveStatus(12))}
                <div className="font-medium">
                  ## 12. Appendices{" "}
                  <span className="text-muted-foreground">{formatStatus(12)}</span>
                </div>
              </div>
              <div className="ml-4 space-y-1">
                <div className="text-muted-foreground">### 12.1 Reference Documents</div>
                <div className="text-muted-foreground">### 12.2 Approval Matrix</div>
              </div>

              <div className="flex items-center gap-2">
                {renderStatusIcon(deriveStatus(13))}
                <div className="font-medium">
                  ## 13. Additional Organizational Guidelines{" "}
                  <span className="text-muted-foreground">{formatStatus(13)}</span>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      );
    }

    // No brdJobProgress yet (e.g. very start before first poll) — show rich card
    // with neutral "Pending" state for all sections so there is no static fallback.
    const fallbackProgress = {
      elapsedMs: 0,
      progressFloor: 5,
      step: "Starting...",
      stepKey: undefined as string | undefined,
      stepDurationsMs: {} as Record<string, number>,
    };
    const fp = fallbackProgress;
    return (
      <Card className="rounded-2xl shadow-sm border border-border/40 border-l-[3px] border-l-amber-500 bg-card">
        <CardHeader className="py-4">
          <div className="flex flex-col gap-3">
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <CardTitle className="text-sm font-semibold truncate">
                  Generating BRD
                </CardTitle>
                <CardDescription className="mt-1 text-xs">
                  Generation continues until the server completes, fails, or is cancelled.
                  Progress reflects backend phases when available.
                </CardDescription>
              </div>
              {onCancel && (
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={onCancel}
                  disabled={isCancelling}
                  className="shrink-0 h-7 gap-1 px-2 text-[11px]"
                >
                  {isCancelling ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <CircleSlash2 className="h-3 w-3" />
                  )}
                  Cancel Generation
                </Button>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary" className="text-[11px]">
                No time cap
              </Badge>
              <Badge variant="outline" className="text-[11px]">
                {fp.step}
              </Badge>
            </div>
          </div>

          <div className="mt-3 space-y-2">
            <Progress value={fp.progressFloor} />
            <div className="flex items-center justify-between text-[11px] text-muted-foreground">
              <span>{fp.progressFloor}% complete</span>
              <span>{formatDurationMs(fp.elapsedMs)} elapsed</span>
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-0 pb-4 text-xs space-y-3">
          <div className="space-y-2">
            {[1,2,3,4,5,6,7,8,9,10,11,12,13].map((n) => (
              <div key={n} className="flex items-center gap-2">
                <Clock3 className="h-4 w-4 text-muted-foreground" />
                <div className="font-medium text-muted-foreground">
                  ## {n}. {["Document Information","Executive Summary","Introduction","Business Objectives","Stakeholder Analysis","Requirements","Business Rules","Data Requirements","Constraints and Assumptions","Risks and Mitigation","Timeline and Milestones","Appendices","Additional Organizational Guidelines"][n-1]}{" "}
                  <span className="text-muted-foreground">Pending</span>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!brd) {
    // Show processing message if file exists but no markdown/JSON yet
    if (brdFileName && brdId) {
      return (
        <Card className="h-full min-h-0 flex flex-col overflow-hidden">
          <CardHeader className="pb-4">
            <div className="rounded-lg border bg-muted/50 p-4">
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                  <FileText className="h-5 w-5" />
                </div>
                <div className="flex-1 pt-0.5">
                  <CardTitle className="leading-tight">BRD Preview</CardTitle>
                  <CardDescription className="mt-1 leading-relaxed">
                    Preview will be available after processing the document
                  </CardDescription>
                </div>
              </div>
            </div>
          </CardHeader>
          <CardContent className="flex-1 flex items-center justify-center">
            <div className="text-center space-y-4">
              <Loader2 className="h-12 w-12 animate-spin mx-auto text-primary" />
              <div className="space-y-2">
                <p className="text-lg font-medium">Processing BRD Document</p>
                <p className="text-sm text-muted-foreground">
                  The document is being processed to generate a structured
                  preview.
                </p>
                <p className="text-sm text-muted-foreground">
                  File: {brdFileName}
                </p>
              </div>
              <div className="flex items-center justify-center gap-3 pt-4">
                <Button
                  onClick={handleDownloadStoredFile}
                  variant="outline"
                  data-testid="button-download-stored-brd"
                >
                  <FileDown className="h-4 w-4 mr-2" />
                  Download Original File
                </Button>
                {onCancel && (
                  <Button
                    variant="destructive"
                    onClick={onCancel}
                    disabled={isCancelling}
                    className="gap-2"
                  >
                    {isCancelling ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <CircleSlash2 className="h-4 w-4" />
                    )}
                    Cancel Upload
                  </Button>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      );
    }

    // Show empty state if no document exists
    return (
      <Card className="h-full min-h-0 flex flex-col overflow-hidden">
        <CardHeader className="pb-4">
          <div className="rounded-lg border bg-muted/50 p-4">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                <FileText className="h-5 w-5" />
              </div>
              <div className="flex-1 pt-0.5">
                <CardTitle className="leading-tight">BRD Preview</CardTitle>
                <CardDescription className="mt-1 leading-relaxed">
                  Fill in the form and click "Generate BRD" to create your
                  document
                </CardDescription>
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent className="flex-1 flex items-center justify-center">
          <div className="text-center space-y-4 text-muted-foreground">
            <FileText className="h-16 w-16 mx-auto opacity-20" />
            <p className="text-lg">No BRD generated yet.</p>
            <p className="text-sm">
              Enter your project details on the left and click "Generate BRD" to
              get started
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const cardContent = (
    <>
      {brdLastGenerationSummary && !isFullScreen ? (
        <div className="px-6 pt-4">
          <div className="rounded-lg border bg-muted/30 p-3 text-xs">
            <div className="flex items-center justify-between gap-2">
              <div className="font-medium">Generation summary</div>
              <Badge variant="secondary" className="text-[11px]">
                Total: {formatDurationMs(brdLastGenerationSummary.totalDurationMs)}
              </Badge>
            </div>
          </div>
        </div>
      ) : null}
      <CardHeader className="pb-4 flex-shrink-0">
        <div className="flex flex-col gap-3">
          {/* Title row */}
          <div className="flex items-start gap-3">
            <FileText className="h-5 w-5 shrink-0 text-primary mt-0.5" />
            <div className="flex-1 min-w-0 overflow-hidden">
              <CardTitle
                className="text-lg leading-tight break-words overflow-wrap-anywhere"
                title={brd.title}
                style={{ wordBreak: "break-word", overflowWrap: "anywhere" }}
              >
                {brd.title}
              </CardTitle>
              <div className="flex items-center gap-2 mt-1.5 text-sm text-muted-foreground flex-wrap">
                <span>{brd.date}</span>
              </div>
              {/* Source document provenance banner */}
              {!brdFileName && (
                <div className="mt-2 flex items-center gap-2 px-3 py-2 bg-blue-500/5 border border-blue-500/20 rounded-lg text-xs">
                  <Link2 className="h-3.5 w-3.5 text-blue-500 flex-shrink-0" />
                  <span className="text-blue-600 dark:text-blue-400 font-semibold whitespace-nowrap">Generated from:</span>
                  <span className="text-muted-foreground">Form input (manual entry)</span>
                </div>
              )}
              {/* Golden Repo influence indicator */}
              {goldenRepoName && (
                <div className="mt-1.5 flex items-center gap-2 px-3 py-2 bg-emerald-500/5 border border-emerald-500/25 rounded-lg text-xs">
                  <ChevronRight className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400 flex-shrink-0" />
                  <span className="text-emerald-700 dark:text-emerald-400 font-semibold whitespace-nowrap">Aligned with Golden Repo:</span>
                  <span className="text-foreground font-medium truncate">{goldenRepoName}</span>
                  <Badge className="ml-auto bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/30 text-[10px] py-0 px-1.5 h-4 flex-shrink-0">
                    Internal
                  </Badge>
                </div>
              )}
            </div>
          </div>
          {/* Actions row */}
          <div className="flex items-center gap-2 flex-wrap">
            <Button
              variant="outline"
              size="sm"
              onClick={handleCopyAll}
              data-testid="button-copy-all"
            >
              {copiedSection === "all" ? (
                <Check className="h-4 w-4 mr-1" />
              ) : (
                <Copy className="h-4 w-4 mr-1" />
              )}
              Copy All
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={isExporting}
                  data-testid="button-download-export"
                >
                  {isExporting ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                      Exporting...
                    </>
                  ) : (
                    <>
                      <FileDown className="h-4 w-4 mr-1" />
                      {exportFormat === "pdf"
                        ? "Download as PDF"
                        : "Download as Word"}
                      <ChevronDown className="h-4 w-4 ml-1" />
                    </>
                  )}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="end"
                className={`w-56 ${isFullScreen ? "z-[110]" : ""}`}
              >
                <DropdownMenuItem
                  onClick={() => handleExport("docx")}
                  disabled={isExporting}
                  data-testid="menu-export-docx"
                >
                  <File className="h-4 w-4 mr-2" />
                  Download as Word
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => handleExport("pdf")}
                  disabled={isExporting}
                  data-testid="menu-export-pdf"
                >
                  <File className="h-4 w-4 mr-2" />
                  Download as PDF
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button
              variant="outline"
              size="sm"
              onClick={handlePrint}
              data-testid="button-print"
            >
              <Printer className="h-4 w-4 mr-1" />
              Print
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={(e) => {
                e.stopPropagation();
                toggleFullScreen();
              }}
              data-testid="button-fullscreen"
            >
              {isFullScreen ? (
                <Minimize2 className="h-4 w-4 mr-1" />
              ) : (
                <Maximize2 className="h-4 w-4 mr-1" />
              )}
              {isFullScreen ? "Exit Full Screen" : "Full Screen"}
            </Button>
            {/* "Send to Review" visibility is fully controlled by the parent
                via the presence of the onSendToReview callback. Parent passes it
                for draft BRDs (any user) and non-approved BRDs (Tenant/Org Admin). */}
            {onSendToReview && brdStatus !== "approved" && (
              <Button
                size="sm"
                onClick={onSendToReview}
                disabled={isSendingToReview}
                data-testid="button-send-to-review"
              >
                {isSendingToReview ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                    Sending...
                  </>
                ) : (
                  <>
                    <Check className="h-4 w-4 mr-1" />
                    Send to Review
                  </>
                )}
              </Button>
            )}
            {brdStatus === "approved" && (
              <div
                className="inline-flex items-center gap-1.5 rounded-md border border-green-500/40 bg-green-500/5 px-2.5 py-1 text-xs font-medium text-green-600 dark:text-green-400"
                data-testid="brd-approved-status"
                aria-label="Approved"
              >
                <CheckCircle2 className="h-3.5 w-3.5" />
                Approved
              </div>
            )}
            {/* Show "Approve" button only when the current user can actually
                approve (i.e. they were added as a reviewer — including via the
                auto-approve flow). When canApprove is false, the parent surfaces
                the "Send to Review" button instead so the two are mutually exclusive. */}
            {brdStatus === "review" && onApprove && canApprove && (
              <div className="flex items-center gap-1">
                <Button
                  size="sm"
                  onClick={canApprove ? onApprove : undefined}
                  disabled={isApproving || !canApprove}
                  data-testid="button-approve-brd"
                >
                  {isApproving ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                      Approving...
                    </>
                  ) : (
                    <>
                      <Check className="h-4 w-4 mr-1" />
                      Approve BRD
                    </>
                  )}
                </Button>
                {!canApprove && (
                  <TooltipProvider>
                    <Tooltip delayDuration={100}>
                      <TooltipTrigger asChild>
                        <Info className="h-4 w-4 text-muted-foreground cursor-help" />
                      </TooltipTrigger>
                      <TooltipContent side="top">
                        You don't have permission to approve BRDs
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                )}
              </div>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent
        className="flex-1 min-h-0 p-0"
        style={{ display: "flex", flexDirection: "column", minHeight: 0 }}
      >
        <Tabs
          value={activeTab}
          onValueChange={setActiveTab}
          className="h-full flex flex-col flex-1 min-h-0"
          style={{
            display: "flex",
            flexDirection: "column",
            flex: 1,
            minHeight: 0,
          }}
        >
          <div className="px-6 flex-shrink-0">
            <TabsList className="grid w-full grid-cols-2 mt-2">
              <TabsTrigger value="sections" data-testid="tab-sections">
                Sections
              </TabsTrigger>
              <TabsTrigger value="full" data-testid="tab-full">
                Full Document
              </TabsTrigger>
            </TabsList>
          </div>

          <TabsContent
            value="sections"
            className="flex-1 min-h-0 mt-4 data-[state=active]:!flex"
            style={{
              flexDirection: "column",
              flex: 1,
              minHeight: 0,
              height: "100%",
            }}
          >
            <style>{`
              [role="tabpanel"][data-state="inactive"] {
                display: none !important;
              }
            `}</style>
            <div
              ref={sectionsScrollRef}
              className="flex-1 overflow-y-auto overflow-x-hidden px-6 pb-4"
              style={{
                height: "100%",
                WebkitOverflowScrolling: "touch",
                overscrollBehavior: "contain",
              }}
            >
              <div className="pr-2">
                {totalPreviewSections === 0 ? (
                  <div className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
                    No sections available to preview.
                  </div>
                ) : (
                  <div className="space-y-4">
                    {hierarchicalPreviewSections.map((section, index) => {
                    const filteredSubsections = section.subsections
                      ? section.subsections.filter(
                          (sub) => !isBrdSectionEmpty(sub)
                        )
                      : [];

                    let mainContent = section.content;
                    const headerMatch =
                      mainContent.match(/^##\s+\d+\.\s+.+?\n\n?/m) ||
                      mainContent.match(/^#\s+\d+\.\s+.+?\n\n?/m);
                    if (headerMatch) {
                      mainContent = mainContent.replace(headerMatch[0], "");
                    }

                    return (
                      <div
                        key={section.originalIndices?.join("-") || index}
                        ref={(el) => {
                          sectionRefs.current[index] = el;
                        }}
                        data-section-index={index}
                        className="border rounded-lg px-4 py-4 scroll-mt-4"
                        data-testid={`section-${index}`}
                      >
                        <div className="flex items-start justify-between gap-4 pb-4 border-b border-border/60">
                          <h3 className="font-medium text-left">
                            {cleanSectionTitleForDisplay(section.title)}
                          </h3>
                          <div className="flex items-center gap-2 shrink-0">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() =>
                                handleCopySection(section.title, section.content)
                              }
                              data-testid={`button-copy-section-${index}`}
                            >
                              {copiedSection === section.title ? (
                                <Check className="h-4 w-4 mr-1" />
                              ) : (
                                <Copy className="h-4 w-4 mr-1" />
                              )}
                              Copy
                            </Button>
                            {onEnhanceSection &&
                              section.originalIndex !== undefined && (
                                <>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() =>
                                      openManualEdit(
                                        section.originalIndices ??
                                          [section.originalIndex ?? index],
                                        section.title,
                                        section.content
                                      )
                                    }
                                  >
                                    Edit
                                  </Button>
                                  <AiEnhanceWithDiff
                                    locationKey="brd.field"
                                    value={section.content}
                                    onEnhanced={(enhancedText) =>
                                      onEnhanceSection(
                                        resolveSectionIdForEdit(
                                          section.originalIndex ?? index,
                                          section.title,
                                          section.content
                                        ),
                                        enhancedText,
                                        section.content
                                      )
                                    }
                                    itemName={cleanSectionTitleForDisplay(
                                      section.title
                                    )}
                                    buttonVariant="ghost"
                                    buttonSize="sm"
                                    elevated={isFullScreen}
                                    className="justify-end"
                                  />
                                </>
                              )}
                          </div>
                        </div>

                        <div className="space-y-4 pt-4">
                          {mainContent.trim() && (
                            <div className="prose prose-sm dark:prose-invert max-w-none">
                              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                {prepareSectionMarkdownForRender(
                                  mainContent,
                                  section.title
                                )}
                              </ReactMarkdown>
                            </div>
                          )}

                          {filteredSubsections.length > 0 && (
                            <div
                              className={`space-y-4 ${
                                mainContent.trim()
                                  ? "mt-4 border-t pt-4"
                                  : ""
                              }`}
                            >
                              {filteredSubsections.map((subsection, subIndex) => {
                                const numberedHeading = extractNumberedHeading(
                                  subsection.content
                                );
                                const displayTitle =
                                  numberedHeading || subsection.title;
                                const cleanedContent =
                                  prepareSectionMarkdownForRender(
                                    subsection.content,
                                    subsection.title
                                  );
                                const subsectionSectionId =
                                  subsection.originalIndex;

                                const hasLevel3 =
                                  Array.isArray(subsection.subsections) &&
                                  subsection.subsections.length > 0;

                                if (!hasLevel3) {
                                  return (
                                    <div
                                      key={subIndex}
                                      className="space-y-2 pl-4 border-l-2 border-muted"
                                      data-testid={`subsection-${index}-${subIndex}`}
                                    >
                                      <div className="flex items-center justify-between">
                                        <h4 className="text-sm font-semibold text-foreground">
                                          {displayTitle}
                                        </h4>
                                        <div className="flex items-center gap-2">
                                          <Button
                                            variant="ghost"
                                            size="sm"
                                            onClick={async () => {
                                              const subsectionFullContent = `## ${displayTitle}\n\n${cleanedContent}`;
                                              await navigator.clipboard.writeText(
                                                subsectionFullContent
                                              );
                                              setCopiedSection(
                                                `${section.title}-${displayTitle}`
                                              );
                                              setTimeout(
                                                () => setCopiedSection(null),
                                                2000
                                              );
                                            }}
                                            className="h-7 text-xs"
                                            data-testid={`button-copy-subsection-${index}-${subIndex}`}
                                          >
                                            {copiedSection ===
                                            `${section.title}-${displayTitle}` ? (
                                              <Check className="h-3 w-3 mr-1" />
                                            ) : (
                                              <Copy className="h-3 w-3 mr-1" />
                                            )}
                                            Copy
                                          </Button>
                                          {onEnhanceSection &&
                                            subsectionSectionId !==
                                              undefined && (
                                              <>
                                                <Button
                                                  variant="ghost"
                                                  size="sm"
                                                  className="h-7 text-xs"
                                                  onClick={() =>
                                                    openManualEdit(
                                                      subsection.originalIndices ?? [
                                                        subsectionSectionId,
                                                      ],
                                                      displayTitle,
                                                      subsection.content
                                                    )
                                                  }
                                                >
                                                  Edit
                                                </Button>
                                                <AiEnhanceWithDiff
                                                  locationKey="brd.field"
                                                  value={subsection.content}
                                                  onEnhanced={(enhancedText) =>
                                                    onEnhanceSection(
                                                      resolveSectionIdForEdit(
                                                        subsectionSectionId,
                                                        displayTitle,
                                                        subsection.content
                                                      ),
                                                      enhancedText,
                                                      subsection.content
                                                    )
                                                  }
                                                  itemName={displayTitle}
                                                  buttonVariant="ghost"
                                                  buttonSize="sm"
                                                  elevated={isFullScreen}
                                                  className="justify-end h-7 text-xs [&_button]:h-7 [&_button]:text-xs"
                                                />
                                              </>
                                            )}
                                        </div>
                                      </div>
                                      <div className="prose prose-sm dark:prose-invert max-w-none text-sm">
                                        <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                          {cleanedContent}
                                        </ReactMarkdown>
                                      </div>
                                    </div>
                                  );
                                }

                                return (
                                  <div
                                    key={subIndex}
                                    className="space-y-3 pl-4 border-l-2 border-muted"
                                    data-testid={`subsection-${index}-${subIndex}`}
                                  >
                                    <div className="flex items-center justify-between">
                                      <h4 className="text-sm font-semibold text-foreground">
                                        {displayTitle}
                                      </h4>
                                      <div className="flex items-center gap-2">
                                        <Button
                                          variant="ghost"
                                          size="sm"
                                          onClick={async () => {
                                            const subsectionFullContent = `## ${displayTitle}\n\n${cleanedContent}`;
                                            await navigator.clipboard.writeText(
                                              subsectionFullContent
                                            );
                                            setCopiedSection(
                                              `${section.title}-${displayTitle}`
                                            );
                                            setTimeout(
                                              () => setCopiedSection(null),
                                              2000
                                            );
                                          }}
                                          className="h-7 text-xs"
                                        >
                                          {copiedSection ===
                                          `${section.title}-${displayTitle}` ? (
                                            <Check className="h-3 w-3 mr-1" />
                                          ) : (
                                            <Copy className="h-3 w-3 mr-1" />
                                          )}
                                          Copy
                                        </Button>
                                        {onEnhanceSection &&
                                          subsectionSectionId !== undefined && (
                                            <>
                                              <Button
                                                variant="ghost"
                                                size="sm"
                                                className="h-7 text-xs"
                                                onClick={() =>
                                                  openManualEdit(
                                                    subsection.originalIndices ?? [
                                                      subsectionSectionId,
                                                    ],
                                                    displayTitle,
                                                    subsection.content
                                                  )
                                                }
                                              >
                                                Edit
                                              </Button>
                                              <AiEnhanceWithDiff
                                                locationKey="brd.field"
                                                value={subsection.content}
                                                onEnhanced={(enhancedText) =>
                                                  onEnhanceSection(
                                                    resolveSectionIdForEdit(
                                                      subsectionSectionId,
                                                      displayTitle,
                                                      subsection.content
                                                    ),
                                                    enhancedText,
                                                    subsection.content
                                                  )
                                                }
                                                itemName={displayTitle}
                                                buttonVariant="ghost"
                                                buttonSize="sm"
                                                elevated={isFullScreen}
                                                className="justify-end h-7 text-xs [&_button]:h-7 [&_button]:text-xs"
                                              />
                                            </>
                                          )}
                                      </div>
                                    </div>

                                    {cleanedContent.trim() && (
                                      <div className="prose prose-sm dark:prose-invert max-w-none text-sm">
                                        <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                          {cleanedContent}
                                        </ReactMarkdown>
                                      </div>
                                    )}

                                    <div className="space-y-4 pl-3 border-l border-muted">
                                      {(
                                        subsection.subsections as BRDSubSection[]
                                      ).map((lvl3, lvl3Idx) => {
                                        const lvl3Heading =
                                          extractNumberedHeading(lvl3.content);
                                        const lvl3Title =
                                          lvl3Heading || lvl3.title;
                                        const lvl3Content =
                                          prepareSectionMarkdownForRender(
                                            lvl3.content,
                                            lvl3.title
                                          );
                                        const lvl3SectionId = lvl3.originalIndex;

                                        return (
                                          <div key={lvl3Idx} className="space-y-2">
                                            <div className="flex items-center justify-between">
                                              <h5 className="text-sm font-medium text-foreground">
                                                {lvl3Title}
                                              </h5>
                                              <div className="flex items-center gap-2">
                                                <Button
                                                  variant="ghost"
                                                  size="sm"
                                                  className="h-7 text-xs"
                                                  onClick={async () => {
                                                    const full = `## ${lvl3Title}\n\n${lvl3Content}`;
                                                    await navigator.clipboard.writeText(
                                                      full
                                                    );
                                                    setCopiedSection(
                                                      `${section.title}-${displayTitle}-${lvl3Title}`
                                                    );
                                                    setTimeout(
                                                      () => setCopiedSection(null),
                                                      2000
                                                    );
                                                  }}
                                                >
                                                  {copiedSection ===
                                                  `${section.title}-${displayTitle}-${lvl3Title}` ? (
                                                    <Check className="h-3 w-3 mr-1" />
                                                  ) : (
                                                    <Copy className="h-3 w-3 mr-1" />
                                                  )}
                                                  Copy
                                                </Button>
                                                {onEnhanceSection &&
                                                  lvl3SectionId !== undefined && (
                                                    <>
                                                      <Button
                                                        variant="ghost"
                                                        size="sm"
                                                        className="h-7 text-xs"
                                                        onClick={() =>
                                                          openManualEdit(
                                                            lvl3.originalIndices ?? [
                                                              lvl3SectionId,
                                                            ],
                                                            lvl3Title,
                                                            lvl3.content
                                                          )
                                                        }
                                                      >
                                                        Edit
                                                      </Button>
                                                      <AiEnhanceWithDiff
                                                        locationKey="brd.field"
                                                        value={lvl3.content}
                                                        onEnhanced={(
                                                          enhancedText
                                                        ) =>
                                                          onEnhanceSection(
                                                            resolveSectionIdForEdit(
                                                              lvl3SectionId,
                                                              lvl3Title,
                                                              lvl3.content
                                                            ),
                                                            enhancedText,
                                                            lvl3.content
                                                          )
                                                        }
                                                        itemName={lvl3Title}
                                                        buttonVariant="ghost"
                                                        buttonSize="sm"
                                                        elevated={isFullScreen}
                                                        className="justify-end h-7 text-xs [&_button]:h-7 [&_button]:text-xs"
                                                      />
                                                    </>
                                                  )}
                                              </div>
                                            </div>
                                            <div className="prose prose-sm dark:prose-invert max-w-none text-sm">
                                              <ReactMarkdown
                                                remarkPlugins={[remarkGfm]}
                                              >
                                                {lvl3Content}
                                              </ReactMarkdown>
                                            </div>
                                          </div>
                                        );
                                      })}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                    })}
                  </div>
                )}
              </div>
            </div>

            {totalPreviewSections > 0 && (
              <div className="flex-shrink-0 border-t border-border/60 px-6 py-3">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="text-sm text-muted-foreground">
                    Section {currentPreviewSectionIndex + 1} of{" "}
                    {totalPreviewSections}
                    <span className="hidden sm:inline">
                      {" "}
                      —{" "}
                      {cleanSectionTitleForDisplay(
                        hierarchicalPreviewSections[currentPreviewSectionIndex]
                          ?.title || ""
                      )}
                    </span>
                  </div>
                  <Pagination className="w-auto mx-0">
                    <PaginationContent>
                      <PaginationItem>
                        <PaginationPrevious
                          href="#"
                          onClick={(e) => {
                            e.preventDefault();
                            scrollToSection(currentPreviewSectionIndex - 1);
                          }}
                          className={
                            currentPreviewSectionIndex === 0
                              ? "pointer-events-none opacity-50"
                              : "cursor-pointer"
                          }
                          data-testid="button-section-previous"
                        />
                      </PaginationItem>
                      <PaginationItem>
                        <span className="text-sm font-medium mx-4">
                          {currentPreviewSectionIndex + 1} / {totalPreviewSections}
                        </span>
                      </PaginationItem>
                      <PaginationItem>
                        <PaginationNext
                          href="#"
                          onClick={(e) => {
                            e.preventDefault();
                            scrollToSection(currentPreviewSectionIndex + 1);
                          }}
                          className={
                            currentPreviewSectionIndex >=
                            totalPreviewSections - 1
                              ? "pointer-events-none opacity-50"
                              : "cursor-pointer"
                          }
                          data-testid="button-section-next"
                        />
                      </PaginationItem>
                    </PaginationContent>
                  </Pagination>
                </div>
              </div>
            )}
          </TabsContent>

          <TabsContent
            value="full"
            className="flex-1 min-h-0 mt-4 data-[state=active]:!flex"
            style={{
              flexDirection: "column",
              flex: 1,
              minHeight: 0,
              height: "100%",
            }}
          >
            <div
              className="flex-1 overflow-y-auto overflow-x-hidden px-8 pb-8"
              style={{
                height: "100%",
                WebkitOverflowScrolling: "touch",
                overscrollBehavior: "contain",
              }}
            >
              <div
                className="prose prose-sm dark:prose-invert max-w-none [&>*:first-child]:!mt-0"
                style={{ marginTop: 0, paddingTop: 0 }}
              >
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {assembleSectionsMarkdown()}
                </ReactMarkdown>
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </CardContent>
    </>
  );

  // Shared manual-edit dialog: full-width Markdown editor with smart paste.
  // Defined once and reused in all three render branches below.
  const manualEditDialog = (
    <Dialog open={manualEditOpen} onOpenChange={setManualEditOpen}>
      <DialogContent
        className={`sm:max-w-[700px]${isFullScreen ? " z-[150]" : ""}`}
        overlayClassName={isFullScreen ? "z-[150]" : undefined}
      >
        <DialogHeader>
          <DialogTitle>
            Manual Edit –{" "}
            {manualEditTitle
              ? cleanSectionTitleForDisplay(manualEditTitle)
              : "Section"}
          </DialogTitle>
          <DialogDescription>
            Update this BRD section directly. Paste tables from
            Confluence/Word/Excel and they convert to Markdown automatically.
            Your changes will be saved into the BRD when you click Apply Changes.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <MarkdownTextarea
            ref={manualEditRef}
            value={manualEditContent}
            onChange={(e) => setManualEditContent(e.target.value)}
            className="min-h-[240px] resize-vertical"
            data-testid="textarea-manual-edit-section"
          />
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => setManualEditOpen(false)}
          >
            Cancel
          </Button>
          <Button type="button" onClick={handleManualEditSave}>
            Apply Changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  // Render full screen view via portal to escape Dialog constraints
  if (isFullScreen && typeof window !== "undefined" && document.body) {
    const fullScreenContent = (
      <div
        className="fixed inset-0 bg-background"
        tabIndex={-1}
        data-testid="brd-fullscreen-root"
        onKeyDown={(e) => {
          // Close on Escape key without closing parent dialogs
          if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            setIsFullScreen(false);
          }
        }}
        onClick={(e) => {
          // Allow clicks to pass through to children
          e.stopPropagation();
        }}
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          zIndex: fullScreenZIndex,
          overflow: "hidden",
          pointerEvents: "auto",
        }}
      >
        <Card
          className="h-full w-full rounded-none border-0 flex flex-col"
          style={{
            height: "100vh",
            maxHeight: "100vh",
            display: "flex",
            flexDirection: "column",
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              height: "100%",
              pointerEvents: "auto",
            }}
          >
            {cardContent}
          </div>
        </Card>
      </div>
    );

    // Render normal view hidden to maintain component structure, and portal the full screen view
    return (
      <>
        <div style={{ display: "none" }}>
          <Card className="h-full min-h-0 flex flex-col">{cardContent}</Card>
        </div>
        {createPortal(fullScreenContent, document.body)}
        {/* Manual edit dialog - rendered outside portal but will portal itself via DialogPrimitive.Portal */}
        {manualEditDialog}
      </>
    );
  }

  // Fallback for SSR or when portal is not available
  if (isFullScreen) {
    return (
      <>
        <div
          className="fixed inset-0 bg-background"
          style={{ zIndex: fullScreenZIndex }}
        >
          <Card
            className="h-full rounded-none border-0 flex flex-col"
            style={{ height: "100vh" }}
          >
            {cardContent}
          </Card>
        </div>
        {/* Manual edit dialog overlay */}
        {manualEditDialog}
      </>
    );
  }

  return (
    <>
      <Card className="h-full min-h-0 flex flex-col">{cardContent}</Card>
      {/* Manual edit dialog for normal (non-fullscreen) mode */}
      {manualEditDialog}
    </>
  );
}
