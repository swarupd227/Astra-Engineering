import { useState, useEffect, useRef } from "react";
import { Building2, CheckCircle2, ChevronDown, FolderGit2, GitBranch, Loader2, Users } from "lucide-react";
import { BRDInputForm, BRDFormData } from "@/components/brd/brd-input-form";
import { BRDPreview, BRDDocument } from "@/components/brd/brd-preview";
import { BRDUploadForm } from "@/components/brd/brd-upload-form";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { getApiUrl } from "@/lib/api-config";
import { useLocation, useSearch } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { useMe } from "@/hooks/use-me";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { useGoldenRepoSelection } from "@/contexts/golden-repo-selection-context";

/** Same key as golden-repo-selection-context; used to fallback to localStorage when context is empty */
const GOLDEN_REPO_STORAGE_KEY = "goldenRepoSelections";

/** Feature flag for BRD RAG debug: ?brdRagDebug=1 or localStorage brdRagDebug = 'true' */
const BRD_RAG_DEBUG_STORAGE_KEY = "brdRagDebug";

function isBrdRagDebugEnabled(search: string): boolean {
  const params = new URLSearchParams(search);
  if (params.get("brdRagDebug") === "1" || params.get("brdRagDebug") === "true") return true;
  try {
    return localStorage.getItem(BRD_RAG_DEBUG_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

/** Get goldenRepoSelections from context, or from localStorage if context is empty (e.g. before hydration). */
function getGoldenRepoSelectionsForGenerate(
  fromContext: Record<
    string,
    { repoId: string; repoName?: string; selectedPaths: string[] }
  >
): Record<
  string,
  { repoId: string; repoName?: string; selectedPaths: string[] }
> {
  const hasFromContext =
    fromContext &&
    typeof fromContext === "object" &&
    Object.keys(fromContext).length > 0;
  if (hasFromContext) return fromContext;
  try {
    const stored = localStorage.getItem(GOLDEN_REPO_STORAGE_KEY);
    if (!stored) return {};
    const parsed = JSON.parse(stored) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object") return {};
    const result: Record<
      string,
      { repoId: string; repoName?: string; selectedPaths: string[] }
    > = {};
    for (const [key, val] of Object.entries(parsed)) {
      if (
        val &&
        typeof val === "object" &&
        Array.isArray((val as any).selectedPaths)
      ) {
        const repoId = (val as any).repoId ?? (val as any).repold;
        if (typeof repoId === "string") {
          result[key] = {
            repoId,
            repoName: (val as any).repoName,
            selectedPaths: (val as any).selectedPaths,
          };
        }
      }
    }
    return result;
  } catch {
    return {};
  }
}

/** RAG debug payload shape (when BRD_RAG_DEBUG or brdRagDebug is enabled) */
export interface BRDRagDebugPayload {
  enabled: true;
  filesDiscovered: Array<{ path: string; name: string; extension: string }>;
  filesSelected: string[];
  filesSkipped: Array<{ path: string; name: string; extension: string; reason: string }>;
  parseResults: Array<{
    name: string;
    path: string;
    parseStatus: "success" | "failed" | "cache_hit";
    parseError?: string;
    extractedTextLength: number;
    chunkCount: number;
    contributedToSummary: boolean;
  }>;
  finalFilesUsedForSummary: string[];
  summaryInputCharCount: number;
}

/** Unified BRD generation: same service for Create (form) and Upload (file). Returns the same shape the Generate BRD page expects. */
async function getBRDGenerate(
  options:
    | { type: "form"; payload: Record<string, unknown>; diagramImages?: File[] }
    | { type: "upload"; formData: FormData }
): Promise<{
  success: boolean;
  brd: BRDDocument | null;
  brdId?: string;
  jobId?: string;
  ragDebug?: BRDRagDebugPayload;
}> {
  if (options.type === "form") {
    // When diagram images are attached, use multipart/form-data so images can
    // travel alongside the JSON payload without hitting the JSON body size limit.
    // The server detects the content-type and handles both paths — existing
    // JSON-only callers (no images) are completely unaffected.
    if (options.diagramImages && options.diagramImages.length > 0) {
      const multipartForm = new FormData();
      multipartForm.append("payload", JSON.stringify(options.payload));
      options.diagramImages.forEach((img, i) => {
        multipartForm.append(`diagram_image_${i}`, img, img.name);
      });
      const response = await fetch(getApiUrl("/api/brd/generate"), {
        method: "POST",
        body: multipartForm,
        credentials: "include",
      });
      const result = await response.json().catch(() => ({}));
      if (response.status === 403) {
        const message =
          (result as any)?.message ||
          (result as any)?.error ||
          'You do not have permission to generate BRDs. Please contact your administrator.';
        const err: any = new Error(message);
        err.code = "PERMISSION_DENIED";
        err.operation = "brd_generate";
        throw err;
      }
      const success = response.ok && !!(result as any)?.success;
      return {
        success,
        brd: (result as any)?.brd ?? null,
        brdId: (result as any)?.brdId ?? (options.payload.brdId as string) ?? undefined,
        jobId: (result as any)?.jobId ?? undefined,
        ragDebug: (result as any)?.ragDebug,
      };
    }
    // No images — existing JSON path (unchanged)
    const response = await apiRequest(
      "POST",
      "/api/brd/generate",
      options.payload
    );
    const result = await response.json().catch(() => ({}));

    // Surface permission errors clearly to the user
    if (response.status === 403) {
      const message =
        (result as any)?.message ||
        (result as any)?.error ||
        'You do not have permission to generate BRDs. Please contact your administrator.';
      const err: any = new Error(message);
      err.code = "PERMISSION_DENIED";
      err.operation = "brd_generate";
      throw err;
    }

    const success = response.ok && !!(result as any)?.success;
    return {
      success,
      brd: (result as any)?.brd ?? null,
      brdId: (result as any)?.brdId ?? (options.payload.brdId as string) ?? undefined,
      jobId: (result as any)?.jobId ?? undefined,
      ragDebug: (result as any)?.ragDebug,
    };
  }
  const response = await fetch(getApiUrl("/api/brd/upload"), {
    method: "POST",
    body: options.formData,
    credentials: "include",
  });
  const result = await response.json().catch(() => ({}));

  if (response.status === 401) {
    const message =
      (result as any)?.message ||
      (result as any)?.error ||
      'Your session has expired. Please sign in again to upload BRDs.';
    const err: any = new Error(message);
    err.code = "UNAUTHORIZED";
    err.operation = "brd_upload";
    throw err;
  }

  if (response.status === 403) {
    const message =
      (result as any)?.message ||
      (result as any)?.error ||
      'You do not have permission to upload BRDs. Please contact your administrator.';
    const err: any = new Error(message);
    err.code = "PERMISSION_DENIED";
    err.operation = "brd_upload";
    throw err;
  }

  // Surface real server errors (5xx/4xx) instead of silently returning success: false,
  // which would otherwise produce a misleading "no BRD ID returned" message downstream.
  if (!response.ok) {
    const serverMessage =
      (result as any)?.details ||
      (result as any)?.message ||
      (result as any)?.error ||
      `Failed to upload BRD (HTTP ${response.status})`;
    throw new Error(serverMessage);
  }

  const brdId = (result as any)?.brdId;
  const jobId = (result as any)?.jobId;

  // 202 + jobId asynchronous response (post-AWS-fix). The caller is expected
  // to poll `/api/brd/generate/status/:jobId` with the same loop used by the
  // Create BRD form. The server still returns `brdId` synchronously so the UI
  // can immediately link the new draft.
  if (response.status === 202 && jobId && brdId) {
    return {
      success: true,
      brd: null,
      brdId,
      jobId,
    };
  }

  // Legacy synchronous response: brdId + (optionally) brd object inline.
  if (!(result as any)?.success || !brdId) {
    const serverMessage =
      (result as any)?.details ||
      (result as any)?.message ||
      (result as any)?.error ||
      "Server did not return a BRD ID. The upload may have failed on the server.";
    throw new Error(serverMessage);
  }

  return {
    success: true,
    brd: (result as any)?.brd ?? null,
    brdId,
  };
}

interface DraftBRD {
  id: string;
  title: string;
}

interface DevBrdDocument {
  id: string;
  projectId: string;
  title: string;
  createdBy: string;
  status: string;
  projectDescription: string | null;
  businessObjectives: string | null;
  successCriteria: string | null;
  targetAudience: string | null;
  keyStakeholders: string | null;
  keyFeatures: string | null;
  existingRequirements: string | null;
  constraints: string | null;
  timeline: string | null;
  budget: string | null;
  generatedMarkdown: string | null;
  generatedBrdJson: BRDDocument | null;
  brdFileName: string | null;
  brdFileType: string | null;
  useGoldenRepo: boolean | null;
}


interface TokenInfo {
  tokenQuota: number;
  tokenUsed: number;
  remainingTokens: number;
  tokenCost: number;
  canConsume: boolean;
  lowBalance?: boolean;
  isDepleted?: boolean;
}

export default function BRDGeneratorPage() {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const search = useSearch();
  const params = new URLSearchParams(search);
  const { selections: goldenRepoSelections } = useGoldenRepoSelection();
  const { data: me } = useMe();
  const isTenantAdmin = me?.roles?.some((role) => role.role === "TenantAdmin") ?? false;
  const isOrgAdmin = me?.roles?.some((role) => role.role === "OrgAdmin") ?? false;
  const isBusinessAnalyst =
    me?.roles?.some((role) => role.role === "BusinessAnalyst" || role.role === "BA") ?? false;
  const canUseAutoApprove = isTenantAdmin || isOrgAdmin || isBusinessAnalyst;
  // Default to false while loading or on error — do not show approve until permission is confirmed

  const projectId = params.get("projectId");
  const projectName = params.get("projectName");
  const organizationName = params.get("organizationName");
  const goldenRepoName = params.get("goldenRepoName");
  const brdIdParam = params.get("brdId");

  const [selectedBrdId, setSelectedBrdId] = useState<string | null>(
    brdIdParam || null
  );
  const { data: canApproveData, isLoading: canApproveLoading } = useQuery({
    queryKey: ["/api/dev-brd/can-approve", selectedBrdId],
    enabled: Boolean(selectedBrdId),
    queryFn: async () => {
      const res = await fetch(
        getApiUrl(`/api/dev-brd/${selectedBrdId}/can-approve`),
        { credentials: "include" }
      );
      if (!res.ok) return { allowed: false };
      return res.json() as Promise<{ allowed: boolean }>;
    },
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
  // Default to false while loading or on error - do not show approve until permission is confirmed
  const canApproveBrd = canApproveLoading ? false : (canApproveData?.allowed ?? false);
  const [brd, setBrd] = useState<BRDDocument | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  // UI-only timer/checklist for async BRD generation jobs.
  const [brdJobStartedAt, setBrdJobStartedAt] = useState<number | null>(null);
  const [brdJobStep, setBrdJobStep] = useState<string | null>(null);
  const [brdJobBackendProgress, setBrdJobBackendProgress] = useState<{
    percent: number;
    stepKey?: string;
    message?: string;
  } | null>(null);
  const brdJobTimingRef = useRef<{
    currentStepKey?: string;
    currentStepStartedAt?: number;
    stepDurationsMs: Record<string, number>;
    jobStartedAt?: number;
  }>({ stepDurationsMs: {} });
  // Set to true when the user explicitly cancels — prevents the upload/generate
  // completion path from loading the fallback BRD into the preview pane.
  const brdJobCancelledRef = useRef(false);
  const [brdJobStepDurationsMs, setBrdJobStepDurationsMs] = useState<Record<string, number>>({});
  const [brdLastGenerationSummary, setBrdLastGenerationSummary] = useState<{
    totalDurationMs: number;
    stepDurationsMs: Record<string, number>;
    sectionOutcomes?: Record<number, "Generated" | "Skipped (TBD)">;
  } | null>(null);
  const [brdJobNow, setBrdJobNow] = useState<number>(() => Date.now());
  const [lastFormData, setLastFormData] = useState<BRDFormData | null>(null);
  const [isApproving, setIsApproving] = useState(false);
  const [isSendingToReview, setIsSendingToReview] = useState(false);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [isCancelling, setIsCancelling] = useState(false);
  const [sendToReviewOpen, setSendToReviewOpen] = useState(false);
  const [autoApproveEnabled, setAutoApproveEnabled] = useState(false);
  const [approverByRoleName, setApproverByRoleName] = useState<Record<string, string[]>>({});

  interface ApproverUserOption {
    userId: string;
    name: string;
  }

  interface ApproverUsersResponse {
    roles: Array<{ roleId: number; roleName: string }>;
    usersByRoleName: Record<string, ApproverUserOption[]>;
  }

  const buildInitialApproverSelections = (
    data?: ApproverUsersResponse
  ): Record<string, string[]> => {
    const roles = data?.roles ?? [];
    return Object.fromEntries(
      roles.map(({ roleName }) => [
        roleName,
        [],
      ])
    );
  };

  const {
    data: approverUsersData,
    isLoading: approverUsersLoading,
  } = useQuery<ApproverUsersResponse>({
    queryKey: ["/api/user/approvers/SDLC_BRD_APPROVAL"],
    enabled: sendToReviewOpen,
    queryFn: async () => {
      const res = await fetch(
        getApiUrl("/api/user/approvers/SDLC_BRD_APPROVAL"),
        { credentials: "include" }
      );
      if (!res.ok) return { roles: [], usersByRoleName: {} };
      return (await res.json()) as ApproverUsersResponse;
    },
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: false,
  });

  const approverRoleNames = (approverUsersData?.roles ?? []).map((r) => r.roleName);

  const getReviewerSummary = (selectedIds: string[], options: ApproverUserOption[]) => {
    if (options.length === 0) return "No reviewers available";
    if (selectedIds.length === 0) return "Select reviewer";
    if (selectedIds.length === 1) {
      return options.find((option) => option.userId === selectedIds[0])?.name ?? "1 reviewer";
    }
    return `${selectedIds.length} reviewers selected`;
  };

  const selectedReviewerIds = Array.from(
    new Set(Object.values(approverByRoleName).flat())
  );
  const selectedReviewerCount = selectedReviewerIds.length;
  const globallySelectedReviewerId = selectedReviewerIds[0] ?? null;

  useEffect(() => {
    if (!sendToReviewOpen) return;
    setApproverByRoleName(buildInitialApproverSelections(approverUsersData));
  }, [sendToReviewOpen, approverUsersData]);

  const roleColorTokens = (roleName: string): { border: string; accentText: string; triggerBorder: string } => {
    // Keep prior colors for the two existing roles; provide sensible defaults for new roles.
    if (roleName === "TenantAdmin") {
      return {
        border: "border-emerald-500/35 dark:border-emerald-500/20 border-l-emerald-500",
        accentText: "text-emerald-600 dark:text-emerald-400",
        triggerBorder: "border-emerald-500/40 dark:border-emerald-500/20",
      };
    }
    if (roleName === "BusinessAnalyst") {
      return {
        border: "border-blue-500/35 dark:border-blue-500/20 border-l-blue-500",
        accentText: "text-blue-600 dark:text-blue-400",
        triggerBorder: "border-blue-500/40 dark:border-blue-500/20",
      };
    }
    if (roleName === "OrgAdmin" || roleName === "OrganizationAdmin") {
      return {
        border: "border-violet-500/35 dark:border-violet-500/20 border-l-violet-500",
        accentText: "text-violet-600 dark:text-violet-400",
        triggerBorder: "border-violet-500/40 dark:border-violet-500/20",
      };
    }
    return {
      border: "border-slate-500/25 dark:border-slate-500/20 border-l-slate-500",
      accentText: "text-slate-700 dark:text-slate-300",
      triggerBorder: "border-slate-500/30 dark:border-slate-500/20",
    };
  };

  const prettyRoleName = (roleName: string) =>
    roleName
      .replace(/_/g, " ")
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .trim();

  const [entryMode, setEntryMode] = useState<"generate" | "upload">("generate");
  // Confluence reference files for BRD generation (up to 2 Word exports from Confluence)
  const [confluenceFiles, setConfluenceFiles] = useState<File[]>([]);
  // Diagram / architecture images for BRD generation (up to 10, any flow)
  const [diagramImages, setDiagramImages] = useState<File[]>([]);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [navGuardOpen, setNavGuardOpen] = useState(false);
  const [pendingNavAction, setPendingNavAction] = useState<
    | { type: "tab"; mode: "generate" | "upload" }
    | { type: "select-brd"; brdId: string }
    | { type: "external"; href: string }
    | null
  >(null);
  const [navGuardReason, setNavGuardReason] = useState<
    "unsaved" | "generating" | null
  >(null);
  const [ragDebug, setRagDebug] = useState<BRDRagDebugPayload | null>(null);
  const isProgrammaticNavRef = useRef(false);
  const brdRef = useRef<BRDDocument | null>(null);
  // Set to true immediately after generation sets the BRD in memory.
  // Prevents the selectedBRDData useEffect from calling setBrd(null)
  // before the fresh DB data arrives from the invalidateQueries refetch.
  const justGeneratedRef = useRef(false);
  const isGeneratingRef = useRef(false);

  const brdRagDebugEnabled = isBrdRagDebugEnabled(search);

  useEffect(() => {
    isGeneratingRef.current = isGenerating;
  }, [isGenerating]);

  useEffect(() => {
    if (!brdJobStartedAt) return;
    // Update every second while the BRD generation job is running.
    const t = window.setInterval(() => setBrdJobNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [brdJobStartedAt]);

  useEffect(() => {
    // Compute final per-section outcomes once we have the generated markdown.
    if (!brdLastGenerationSummary || brdLastGenerationSummary.sectionOutcomes || !brd?.rawMarkdown) {
      return;
    }

    const extractSection = (markdown: string, sectionNumber: number): string => {
      const re = new RegExp(`^##\\s+${sectionNumber}\\.\\s+.*$`, "m");
      const match = markdown.match(re);
      if (!match || match.index == null) return "";
      const start = match.index + match[0].length;
      const rest = markdown.slice(start);
      const next = rest.search(/^##\s+\d+\.\s+/m);
      const section = (next >= 0 ? rest.slice(0, next) : rest).trim();
      return section;
    };

    const isTbdOnly = (content: string): boolean => {
      const normalized = content
        .replace(/\r/g, "")
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean)
        .join("\n")
        .toLowerCase();
      // Don't mark sections as TBD-only; all sections that exist are considered generated
      return false;
    };

    const outcomes: Record<number, "Generated" | "Skipped (TBD)"> = {} as any;
    for (let n = 1; n <= 13; n++) {
      const content = extractSection(brd.rawMarkdown, n);
      // All sections are marked as Generated (no "Skipped" status)
      outcomes[n] = content ? "Generated" : "Skipped (TBD)";
    }

    setBrdLastGenerationSummary((cur) => (cur ? { ...cur, sectionOutcomes: outcomes } : cur));
  }, [brd, brdLastGenerationSummary]);

  const brdJobElapsedMs = brdJobStartedAt ? Math.max(0, brdJobNow - brdJobStartedAt) : 0;
  const brdJobProgressPercent = typeof brdJobBackendProgress?.percent === "number"
    ? Math.max(0, Math.min(100, Math.round(brdJobBackendProgress.percent)))
    : brdJobStartedAt
      ? 5
      : 0;
  const brdJobProgressFloor = brdJobStartedAt
    ? Math.max(5, brdJobProgressPercent)
    : brdJobProgressPercent;

  // Tenant token info for BRD generation
  const {
    data: tokenInfo,
    isLoading: isTokenInfoLoading,
  } = useQuery<TokenInfo>({
    queryKey: ["/api/tokens/info"],
    queryFn: async () => {
      const response = await fetch(getApiUrl("/api/tokens/info"), {
        credentials: "include",
      });
      if (!response.ok) {
        throw new Error("Failed to fetch token info");
      }
      return response.json();
    },
  });

  const UNSAVED_BRD_MESSAGE =
    "You have BRD details filled in that have not been used to generate a BRD. If you leave this screen, your input will be lost.";
  const GENERATING_BRD_MESSAGE =
    "BRD generation is still running in the background. Once it completes, the BRD will move to Draft and appear in the BRD list. If you leave this screen now, generation will continue, but you will need to return here to view the draft.";

  // Fetch draft BRDs for the current project
  const { data: draftBRDs = [], refetch: refetchDrafts } = useQuery<DraftBRD[]>(
    {
      queryKey: ["/api/dev-brd/drafts", projectId],
      queryFn: async () => {
        if (!projectId) return [];
        const response = await fetch(
          getApiUrl(
            `/api/dev-brd/drafts?projectId=${encodeURIComponent(projectId)}`
          ),
          { credentials: "include" }
        );
        if (!response.ok) {
          throw new Error("Failed to fetch draft BRDs");
        }
        return response.json();
      },
      enabled: !!projectId,
    }
  );

  const selectedDraft = draftBRDs.find((draft) => draft.id === selectedBrdId);

  // Sync URL brdId param → selectedBrdId (handles navigation from notification bell
  // when the component is already mounted and the URL changes without a full remount)
  useEffect(() => {
    if (brdIdParam && brdIdParam !== selectedBrdId) {
      setSelectedBrdId(brdIdParam);
    }
  }, [brdIdParam]);

  useEffect(() => {
    brdRef.current = brd;
  }, [brd]);

  // Native browser refresh/close warning when BRD form has unsaved data
  useEffect(() => {
    if (!hasUnsavedChanges) return;

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      // Skip native browser alert when we are intentionally navigating
      // after the user has confirmed in our custom dialog.
      if (isProgrammaticNavRef.current) return;
      event.preventDefault();
      event.returnValue = UNSAVED_BRD_MESSAGE;
      return UNSAVED_BRD_MESSAGE;
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [hasUnsavedChanges, UNSAVED_BRD_MESSAGE]);

  // Intercept top-level navigation clicks when BRD form has unsaved data
  // or when BRD generation is in progress.
  // This covers sidebar/header nav links rendered as <a href="..."> or buttons that use React routing.
  useEffect(() => {
    if (!hasUnsavedChanges && !isGenerating) return;

    const handleDocumentClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target) return;

      const anchor = target.closest("a[href]") as HTMLAnchorElement | null;
      if (!anchor) return;

      // Ignore links with download attribute (e.g., BRD export)
      if (anchor.hasAttribute("download")) return;

      const href = anchor.getAttribute("href");
      if (!href) return;

      // CRITICAL FIX: Ignore clicks on download links or blob URLs to prevent intercepting file downloads
      if (anchor.hasAttribute("download") || anchor.href.startsWith("blob:")) {
        return;
      }

      // Ignore in-page anchors
      if (href.startsWith("#")) return;

      // Ignore modified clicks (new tab, etc.)
      if (
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey ||
        event.button !== 0
      ) {
        return;
      }

      // Capture phase listener runs before React's router handlers.
      // Stop propagation so client-side navigation does not execute.
      event.preventDefault();
      event.stopPropagation();

      setPendingNavAction({ type: "external", href: anchor.href });
      setNavGuardReason(
        isGenerating && !hasUnsavedChanges ? "generating" : "unsaved"
      );
      setNavGuardOpen(true);
    };

    document.addEventListener("click", handleDocumentClick, true);
    return () =>
      document.removeEventListener("click", handleDocumentClick, true);
  }, [hasUnsavedChanges, isGenerating]);

  // Fetch selected BRD data - always fetch fresh data when BRD is selected
  // Query key includes selectedBrdId, so changing it automatically triggers a new fetch
  const { data: selectedBRDData } = useQuery<DevBrdDocument>({
    queryKey: ["/api/dev-brd", selectedBrdId],
    queryFn: async () => {
      if (!selectedBrdId) return null;
      // Always fetch fresh data - bypass cache
      const response = await fetch(getApiUrl(`/api/dev-brd/${selectedBrdId}`), {
        credentials: "include",
        cache: "no-store", // Bypass browser cache
      });
      if (!response.ok) {
        throw new Error("Failed to fetch BRD");
      }
      return response.json();
    },
    enabled: !!selectedBrdId,
    staleTime: 0, // Data is immediately stale, will always refetch
    gcTime: 0, // Don't cache - removes data immediately when query is disabled
    refetchOnMount: true, // Always refetch when component mounts
    refetchOnWindowFocus: false, // Don't refetch on window focus (not needed)
  });

  // Clear BRD preview when selectedBrdId changes (before new data loads).
  useEffect(() => {
    if (selectedBrdId && !isGeneratingRef.current) {
      setBrd(null);
      justGeneratedRef.current = false;
    }
  }, [selectedBrdId]);

  // Update URL when BRD is selected
  useEffect(() => {
    const newParams = new URLSearchParams(search);
    if (selectedBrdId) {
      newParams.set("brdId", selectedBrdId);
    } else {
      // Remove brdId from URL when creating new BRD (selectedBrdId is null)
      newParams.delete("brdId");
    }
    setLocation(`/brd?${newParams.toString()}`, { replace: true });
  }, [selectedBrdId, search, setLocation]);

  // Load generated BRD document when an existing BRD with generated content is selected
  useEffect(() => {
    if (!selectedBrdId) {
      // Clear BRD when no BRD is selected
      setBrd(null);
      return;
    }

    if (!selectedBRDData) {
      // If we just generated a BRD, keep it visible while the refetch loads.
      if (!justGeneratedRef.current) {
        setBrd(null);
      }
      return;
    }

    // Priority 1: Use generatedBrdJson if available (full structure with sections)
    if (selectedBRDData.generatedBrdJson) {
      justGeneratedRef.current = false; // DB data arrived — clear the guard
      setBrd(selectedBRDData.generatedBrdJson);
      return;
    }

    // If we have a freshly generated in-memory BRD and DB data hasn't caught
    // up yet (no generatedBrdJson), keep the in-memory BRD and wait.
    if (justGeneratedRef.current) {
      return;
    }

    // Priority 2: Use generatedMarkdown if available (create minimal BRDDocument)
    if (
      selectedBRDData.generatedMarkdown &&
      selectedBRDData.generatedMarkdown.trim() !== ""
    ) {
      // Create a minimal BRDDocument from markdown
      // Parse title from markdown (first H1) or use BRD title
      const titleMatch = selectedBRDData.generatedMarkdown.match(/^#\s+(.+)$/m);
      const title = titleMatch
        ? titleMatch[1]
        : selectedBRDData.title || "BRD Document";

      // Parse sections from markdown - handle both numbered headings (1., 2., 3.) and markdown headers (##)
      const sections: BRDDocument["sections"] = [];
      const markdownLines = selectedBRDData.generatedMarkdown.split("\n");
      let currentSection: { title: string; content: string } | null = null;

      // Regex patterns for section detection (more flexible):
      // 1. Top-level numbered headings: "1. Introduction", "2. Business Objectives", "1) Introduction", etc.
      //    Pattern variations:
      //    - "1. Introduction" (dot with space)
      //    - "1) Introduction" (parenthesis with space)
      //    - "1.Introduction" (dot without space)
      //    - Handles markdown formatting: "**1. Introduction**" or "# 1. Introduction"
      //    - NOT "1.1" or "1.2.3" (sub-sections)
      // 2. Markdown headers: "## Section Title", "# Section Title"

      // More robust pattern that handles:
      // - Optional markdown formatting (**, #, etc.) at start
      // - Numbered headings with dot: "1. Title" or "**1. Title**"
      // - Numbered headings with paren: "1) Title"
      // - Excludes sub-sections: "1.1", "1.2.3"
      const topLevelNumberedPatternDot = /^[*#\s]*(\d+)\.\s+(.+?)[*\s]*$/; // Matches "1. Introduction" or "**1. Introduction**" or "# 1. Introduction"
      const topLevelNumberedPatternParen = /^[*#\s]*(\d+)\)\s+(.+?)[*\s]*$/; // Matches "1) Introduction"
      const h1HeaderPattern = /^#\s+(.+)$/; // Matches "# Section Title"
      const h2HeaderPattern = /^##\s+(.+)$/; // Matches "## Section Title"
      const h3HeaderPattern = /^###\s+(.+)$/; // Matches "### Section Title"

      for (let i = 0; i < markdownLines.length; i++) {
        const line = markdownLines[i];
        const trimmedLine = line.trim();

        if (!trimmedLine) {
          // Empty line - add to current section if exists
          if (currentSection) {
            currentSection.content += line + "\n";
          }
          continue;
        }

        // Check for sub-section pattern first (to exclude them)
        // This matches patterns like "1.1", "1.2.3", "1.1 Purpose", etc.
        const isSubSection = /^\d+\.\d+/.test(trimmedLine);

        // Check for top-level numbered heading (various formats)
        // Try matching numbered patterns, but exclude sub-sections
        const numberedMatchDot = trimmedLine.match(topLevelNumberedPatternDot);
        const numberedMatchParen = trimmedLine.match(
          topLevelNumberedPatternParen
        );
        const isTopLevelNumbered =
          (numberedMatchDot || numberedMatchParen) && !isSubSection;

        // Check for markdown headers (H1, H2, H3) - but only if they don't start with a number
        // (to avoid double-matching numbered headings that might be formatted as headers)
        const h1Match =
          !isTopLevelNumbered && trimmedLine.match(h1HeaderPattern);
        const h2Match =
          !isTopLevelNumbered && trimmedLine.match(h2HeaderPattern);
        const h3Match =
          !isTopLevelNumbered && trimmedLine.match(h3HeaderPattern);
        const isMarkdownHeader = !!(h1Match || h2Match || h3Match);

        if (isTopLevelNumbered || isMarkdownHeader) {
          // Save previous section if exists
          if (currentSection) {
            sections.push(currentSection);
          }

          // Extract section title (clean up markdown formatting)
          let sectionTitle = "";
          if (numberedMatchDot) {
            sectionTitle = numberedMatchDot[2]
              .trim()
              .replace(/^\*\*|\*\*$/g, "")
              .trim(); // Remove bold markers
          } else if (numberedMatchParen) {
            sectionTitle = numberedMatchParen[2]
              .trim()
              .replace(/^\*\*|\*\*$/g, "")
              .trim();
          } else if (h1Match) {
            sectionTitle = h1Match[1].trim();
          } else if (h2Match) {
            sectionTitle = h2Match[1].trim();
          } else if (h3Match) {
            sectionTitle = h3Match[1].trim();
          }

          // Start new section
          currentSection = { title: sectionTitle, content: line + "\n" };
        } else {
          // No section header detected - append to current section or create default section
          if (currentSection) {
            // Append to current section (including sub-sections like "1.1", "1.2" and all other content)
            currentSection.content += line + "\n";
          } else {
            // No current section yet - might be content before first section
            // Start accumulating content in a default section
            currentSection = { title: "Introduction", content: line + "\n" };
          }
        }
      }

      // Don't forget the last section
      if (currentSection) {
        sections.push(currentSection);
      }

      // Debug logging to help troubleshoot parsing
      if (
        sections.length === 0 ||
        (sections.length === 1 &&
          sections[0].title === "Introduction" &&
          !selectedBRDData.generatedMarkdown.match(/^\d+\./))
      ) {
        console.log(
          "[BRD Parser] Warning: No numbered sections detected in markdown. Sections found:",
          sections.length
        );
        console.log(
          "[BRD Parser] First 500 chars of markdown:",
          selectedBRDData.generatedMarkdown.substring(0, 500)
        );
      }

      const brdFromMarkdown: BRDDocument = {
        title,
        version: "1.0",
        date: new Date().toISOString().split("T")[0],
        brdTemplateId: "gold_1_0",
        sections:
          sections.length > 0
            ? sections
            : [
              {
                title: "Document",
                content: selectedBRDData.generatedMarkdown,
              },
            ],
        rawMarkdown: selectedBRDData.generatedMarkdown,
      };

      setBrd(brdFromMarkdown);
      return;
    }

    // Priority 3: No generated content — clear if not guarded by generation ref
    if (!justGeneratedRef.current) {
      setBrd(null);
    }
  }, [selectedBRDData, selectedBrdId]);

  // Unified function to reset state for "Create New BRD"
  // This ensures consistent behavior whether triggered from dropdown or button
  const handleCreateNewBrd = () => {
    // Clear selected BRD ID (this will also update the URL via useEffect)
    setSelectedBrdId(null);

    // Clear BRD preview/document state
    setBrd(null);

    // Clear last form data
    setLastFormData(null);

    // Invalidate and remove any cached BRD data queries to ensure fresh state
    // This prevents stale data from appearing when selecting a new BRD later
    queryClient.invalidateQueries({ queryKey: ["/api/dev-brd"] });
    queryClient.removeQueries({ queryKey: ["/api/dev-brd"] });

    // Note: We do NOT create a BRD in the database here
    // The BRD will be created automatically when the user clicks "Generate BRD"
    // This matches the dropdown behavior which just clears state
  };

  // Handle create new BRD button click
  // Uses the same unified logic as the dropdown selection
  const handleCreateBRD = () => {
    // Check if project is selected (required for BRD creation later)
    if (!projectId) {
      toast({
        title: "Project required",
        description: "Please select a project first.",
        variant: "destructive",
      });
      return;
    }

    // Use the same unified handler as dropdown selection
    // This ensures consistent behavior - just clear state, don't create BRD yet
    handleCreateNewBrd();
  };

  // Handle BRD selection
  const handleSelectBRD = (brdId: string) => {
    if (brdId === "new") {
      // Use unified create new BRD handler
      handleCreateNewBrd();
      return;
    }
    // When selecting an existing BRD, the useEffect will load the generated content if it exists
    setSelectedBrdId(brdId);
  };

  // Helper function to ensure BRD name has "BRD-" prefix
  const ensureBrdPrefix = (name: string | undefined | null): string => {
    if (!name || name.trim() === "") return "";
    const trimmed = name.trim();
    return trimmed.startsWith("BRD-") ? trimmed : `BRD-${trimmed}`;
  };

  // Handler for saving BRD name on blur (separate from auto-save)
  const handleSaveBrdName = async (brdName: string) => {
    // Ensure BRD Name has prefix and validate
    const brdNameWithPrefix = ensureBrdPrefix(brdName);
    if (!brdNameWithPrefix || brdNameWithPrefix === "BRD-") {
      return; // Silently skip saving if BRD name is not provided yet
    }

    if (!projectId) {
      return; // Can't save without project ID
    }

    try {
      let brdIdToUse = selectedBrdId;

      // If no BRD exists yet, create one first
      if (!brdIdToUse) {
        const createResponse = await fetch(getApiUrl("/api/dev-brd/create"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            projectId,
            title: brdNameWithPrefix,
            createdBy: me?.user?.id ?? "system",
          }),
        });

        if (!createResponse.ok) {
          throw new Error("Failed to create BRD");
        }

        const createResult = await createResponse.json();
        brdIdToUse = createResult.brdId;
        setSelectedBrdId(brdIdToUse);
        // Refetch drafts to include the new BRD in the dropdown
        refetchDrafts();
      } else {
        // BRD exists, update the title
        const response = await fetch(getApiUrl(`/api/dev-brd/${brdIdToUse}`), {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            title: brdNameWithPrefix,
          }),
        });

        if (!response.ok) {
          throw new Error("Failed to save BRD name");
        }
      }

      // Update the dropdown cache immediately with the new BRD name
      // Use the exact same query key as the useQuery hook
      const queryKey: [string, string | null] = [
        "/api/dev-brd/drafts",
        projectId,
      ];

      // Only update cache if we have a valid BRD ID
      if (brdIdToUse) {
        const finalBrdId = brdIdToUse; // Capture for closure
        // Optimistically update the cache - this will trigger a re-render immediately
        queryClient.setQueryData<DraftBRD[]>(queryKey, (oldData) => {
          if (!oldData || !Array.isArray(oldData)) {
            // If no data exists yet and BRD was just created, add it to the list
            return [{ id: finalBrdId, title: brdNameWithPrefix }];
          }
          // Update the specific BRD's title in the list (or add if it's a new BRD)
          const existingIndex = oldData.findIndex((d) => d.id === finalBrdId);
          if (existingIndex >= 0) {
            // Update existing BRD title
            return oldData.map((draft) =>
              draft.id === finalBrdId
                ? { ...draft, title: brdNameWithPrefix }
                : draft
            );
          } else {
            // Add new BRD to the list (if it was just created)
            return [{ id: finalBrdId, title: brdNameWithPrefix }, ...oldData];
          }
        });
      }

      // Refetch after a delay to sync with server
      // The delay ensures React has time to re-render with the optimistic update first
      if (brdIdToUse) {
        const finalBrdId = brdIdToUse; // Capture for closure
        setTimeout(() => {
          refetchDrafts()
            .then((result) => {
              // After refetch, ensure our update is still there
              if (result.data) {
                const updatedInRefetch = result.data.find(
                  (d) => d.id === finalBrdId
                );
                if (
                  updatedInRefetch &&
                  updatedInRefetch.title === brdNameWithPrefix
                ) {
                  // Server already has the update, cache is correct
                  return;
                }
                // Re-apply our update if refetch didn't have it or had different data
                queryClient.setQueryData<DraftBRD[]>(queryKey, (oldData) => {
                  if (!oldData || !Array.isArray(oldData)) {
                    return result.data || [];
                  }
                  return oldData.map((draft) =>
                    draft.id === finalBrdId
                      ? { ...draft, title: brdNameWithPrefix }
                      : draft
                  );
                });
              }
            })
            .catch((error) => {
              console.error("Error refetching drafts:", error);
            });
        }, 200);

        // Also invalidate the selected BRD query so it refetches with updated data
        queryClient.invalidateQueries({
          queryKey: ["/api/dev-brd", finalBrdId],
        });
      }
    } catch (error) {
      console.error("Failed to save BRD name:", error);
      throw error; // Re-throw so caller can handle
    }
  };

  // Auto-save handler (for fields other than BRD name)
  const handleSaveBRD = async (
    formData: BRDFormData,
    brdIdOverride?: string
  ) => {
    // Note: BRD name is NOT saved here - it's saved separately on blur

    let brdIdToUse = brdIdOverride || selectedBrdId;

    // If no BRD exists, we need a BRD name to create one
    // In this case, we'll use the BRD name from the form data
    if (!brdIdToUse && projectId && formData.brdName) {
      const brdNameWithPrefix = ensureBrdPrefix(formData.brdName);
      if (!brdNameWithPrefix || brdNameWithPrefix === "BRD-") {
        return; // Can't create BRD without a valid name
      }
      try {
        const createResponse = await fetch(getApiUrl("/api/dev-brd/create"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            projectId,
            title: brdNameWithPrefix,
            createdBy: me?.user?.id ?? "system",
          }),
        });

        if (createResponse.ok) {
          const createResult = await createResponse.json();
          brdIdToUse = createResult.brdId;
          setSelectedBrdId(brdIdToUse);
          refetchDrafts();
        } else {
          console.error("Failed to create BRD for auto-save");
          return;
        }
      } catch (error) {
        console.error("Error creating BRD for auto-save:", error);
        return;
      }
    }

    if (!brdIdToUse) return;

    try {
      const response = await fetch(getApiUrl(`/api/dev-brd/${brdIdToUse}`), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          // Note: title is NOT included here - it's saved separately on blur via handleSaveBrdName
          projectDescription: formData.projectDescription || null,
          businessObjectives: formData.businessObjectives || null,
          successCriteria: formData.successCriteria || null,
          targetAudience: formData.targetAudience || null,
          keyStakeholders: formData.stakeholders || null,
          keyFeatures: formData.keyFeatures || null,
          existingRequirements: formData.existingRequirements || null,
          constraints: formData.constraints || null,
          timeline: formData.timeline || null,
          budget: formData.budget || null,
          useGoldenRepo: formData.useGoldenRepo ?? true,
        }),
      });


      if (!response.ok) {
        const body = await response.json().catch(() => ({}));

        if (response.status === 403) {
          const message =
            (body as any)?.message ||
            (body as any)?.error ||
            "You do not have permission to save BRDs. Please contact your administrator.";

          toast({
            title: "Permission denied",
            description: message,
            variant: "destructive",
          });
          return;
        }

        throw new Error("Failed to save BRD");
      }
    } catch (error) {
      console.error("Failed to save BRD:", error);
      // For non-permission errors, surface a toast but avoid crashing the page.
      toast({
        title: "Save failed",
        description:
          error instanceof Error
            ? error.message
            : "Something went wrong while saving the BRD.",
        variant: "destructive",
      });
    }
  };

  const rebuildMarkdownFromSections = (
    title: string,
    version: string,
    date: string,
    sections: BRDDocument["sections"]
  ): string => {
    const headerLines = [
      `# ${title}`,
      ``,
      `**Version:** ${version}`,
      `**Date:** ${date}`,
      ``,
    ];

    const sectionMarkdown = sections
      .map((section) => `## ${section.title}\n\n${section.content}`)
      .join("\n\n");

    return `${headerLines.join("\n")}${sectionMarkdown}`;
  };

  /**
   * Reusable BRD generation job poller — drives the same job-progress UI used
   * by the Create BRD form, but is now also used by the Upload BRD flow which
   * always returns 202 + jobId from the AWS-safe `/api/brd/upload` endpoint.
   *
   * Returns the final BRD document (when the server includes `result.brd` in
   * the completed status payload) or `null` (the caller should re-fetch via
   * `/api/dev-brd/:brdId`).
   */
  const pollBrdGenerationJob = async (
    jobId: string,
  ): Promise<BRDDocument | null> => {
    const start = Date.now();
    setBrdJobStartedAt(start);
    setBrdJobStep(null);
    setBrdJobBackendProgress(null);
    setBrdJobNow(start);
    setBrdLastGenerationSummary(null);
    setBrdJobStepDurationsMs({});
    brdJobTimingRef.current = {
      currentStepKey: undefined,
      currentStepStartedAt: undefined,
      stepDurationsMs: {},
      jobStartedAt: start,
    };

    // eslint-disable-next-line no-constant-condition
    while (true) {
      const statusRes = await fetch(
        getApiUrl(`/api/brd/generate/status/${encodeURIComponent(jobId)}`),
        { credentials: "include", cache: "no-store" },
      );
      if (!statusRes.ok) {
        throw new Error(
          `Failed to fetch BRD job status (${statusRes.status})`,
        );
      }
      const statusData = await statusRes.json().catch(() => ({} as any));

      const progress = statusData.progress;
      if (progress && typeof progress.percent === "number") {
        const now = Date.now();
        const nextKey =
          typeof progress.stepKey === "string" && progress.stepKey.trim().length > 0
            ? progress.stepKey.trim()
            : undefined;
        const prevKey = brdJobTimingRef.current.currentStepKey;
        const prevStartedAt = brdJobTimingRef.current.currentStepStartedAt;
        if (nextKey && nextKey !== prevKey) {
          if (prevKey && typeof prevStartedAt === "number") {
            const delta = Math.max(0, now - prevStartedAt);
            brdJobTimingRef.current.stepDurationsMs[prevKey] =
              (brdJobTimingRef.current.stepDurationsMs[prevKey] || 0) + delta;
          }
          brdJobTimingRef.current.currentStepKey = nextKey;
          brdJobTimingRef.current.currentStepStartedAt = now;
          setBrdJobStepDurationsMs({ ...brdJobTimingRef.current.stepDurationsMs });
        }
        setBrdJobBackendProgress({
          percent: progress.percent,
          stepKey: typeof progress.stepKey === "string" ? progress.stepKey : undefined,
          message: typeof progress.message === "string" ? progress.message : undefined,
        });
      }
      if (typeof progress?.message === "string" && progress.message.trim().length > 0) {
        setBrdJobStep(progress.message);
      } else if (typeof statusData.step === "string") {
        setBrdJobStep(statusData.step);
      }

      if (statusData.status === "completed") {
        const now = Date.now();
        const prevKey = brdJobTimingRef.current.currentStepKey;
        const prevStartedAt = brdJobTimingRef.current.currentStepStartedAt;
        if (prevKey && typeof prevStartedAt === "number") {
          const delta = Math.max(0, now - prevStartedAt);
          brdJobTimingRef.current.stepDurationsMs[prevKey] =
            (brdJobTimingRef.current.stepDurationsMs[prevKey] || 0) + delta;
        }
        setBrdJobStepDurationsMs({ ...brdJobTimingRef.current.stepDurationsMs });
        setBrdLastGenerationSummary({
          totalDurationMs: Math.max(0, now - start),
          stepDurationsMs: { ...brdJobTimingRef.current.stepDurationsMs },
        });
        setBrdJobStartedAt(null);
        setBrdJobStep(null);
        setBrdJobBackendProgress(null);
        return (statusData?.result?.brd as BRDDocument | undefined) ?? null;
      }

      if (statusData.status === "failed") {
        setBrdJobStartedAt(null);
        setBrdJobStep(null);
        setBrdJobBackendProgress(null);
        setActiveJobId(null);
        throw new Error(statusData.error || "BRD generation failed");
      }

      if (statusData.status === "cancelled") {
        setBrdJobStartedAt(null);
        setBrdJobStep(null);
        setBrdJobBackendProgress(null);
        setActiveJobId(null);
        toast({
          title: "Generation cancelled",
          description: "The BRD generation process was stopped.",
        });
        return null;
      }

      await new Promise((r) => setTimeout(r, 2000));
    }
  };

  const handleGenerate = async (data: BRDFormData) => {
    brdJobCancelledRef.current = false;
    setIsGenerating(true);
    setBrdJobStartedAt(Date.now());
    setBrdJobStep("Starting generation...");
    setLastFormData(data);
    setHasUnsavedChanges(false);

    try {
      // Step 1: Ensure we have a draft BRD saved
      let currentBrdId = selectedBrdId;

      // Only validate and use BRD name if creating a new BRD (when no BRD is selected)
      let brdNameWithPrefix: string | undefined;
      if (!currentBrdId) {
        brdNameWithPrefix = ensureBrdPrefix(data.brdName);
        if (!brdNameWithPrefix || brdNameWithPrefix === "BRD-") {
          toast({
            title: "BRD Name required",
            description: "Please provide a BRD Name before generating.",
            variant: "destructive",
          });
          setIsGenerating(false);
          return;
        }

        // Create a new draft BRD if none exists
        if (!projectId) {
          toast({
            title: "Project required",
            description: "Please select a project first.",
            variant: "destructive",
          });
          setIsGenerating(false);
          return;
        }

        const createResponse = await fetch(getApiUrl("/api/dev-brd/create"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            projectId,
            title: brdNameWithPrefix,
            createdBy: me?.user?.id ?? "system",
          }),
        });

        if (!createResponse.ok) {
          throw new Error("Failed to create draft BRD");
        }

        const createResult = await createResponse.json();
        currentBrdId = createResult.brdId;
        setSelectedBrdId(currentBrdId);
        refetchDrafts();
      }

      // Step 2: Save all form fields to the draft BRD (including BRD Name)
      await handleSaveBRD(data, currentBrdId || undefined);

      console.log("[BRD Client] Generating BRD with brdId:", currentBrdId);

      // Capture the current system date at submission time (YYYY-MM-DD format)
      const submissionDate = new Date().toISOString().split("T")[0];

      // Step 2a: If Confluence reference files are attached, summarize them first.
      // This is a pre-flight call that is non-blocking for errors — a failure
      // returns an empty summary and generation still proceeds.
      let confluenceSummaryForPayload: string | undefined;
      if (confluenceFiles.length > 0) {
        try {
          setBrdJobStep("Summarizing Confluence reference documents...");
          const confFormData = new FormData();
          for (const f of confluenceFiles) {
            confFormData.append("files", f, f.name);
          }
          const confRes = await fetch(getApiUrl("/api/brd/confluence-summary"), {
            method: "POST",
            credentials: "include",
            body: confFormData,
          });
          if (confRes.ok) {
            const confJson = await confRes.json().catch(() => ({ summary: "" }));
            confluenceSummaryForPayload = (confJson.summary as string | undefined)?.trim() || undefined;
            if (confluenceSummaryForPayload) {
              console.log(
                `[BRD Client] Confluence summary received (${confluenceSummaryForPayload.length} chars)`,
              );
            } else {
              console.warn("[BRD Client] Confluence summary endpoint returned empty summary; continuing without it.");
            }
          } else {
            console.warn(
              `[BRD Client] Confluence summary endpoint failed (${confRes.status}); continuing without it.`,
            );
          }
        } catch (confErr) {
          console.warn(
            "[BRD Client] Confluence summary call failed; continuing without it:",
            confErr,
          );
        }
      }

      const generatePayload: Record<string, unknown> = {
        ...data,
        brdId: currentBrdId,
        generationDate: submissionDate,
        projectId: projectId || undefined,
        ...(brdRagDebugEnabled ? { brdRagDebug: true } : {}),
      };

      // Request body must include goldenRepoSelections from sdlc_projects.golden_repo_reference for this project only.
      if (confluenceSummaryForPayload) {
        generatePayload.confluenceSummary = confluenceSummaryForPayload;
      }
      if (data.useGoldenRepo && projectId) {
        try {
          const detailsRes = await apiRequest(
            "GET",
            `/api/sdlc/projects/${encodeURIComponent(projectId)}/details`
          );
          const detailsJson = await detailsRes.json().catch(() => ({}));
          const project = detailsJson?.project;
          const ref =
            project?.goldenRepoReference ?? project?.golden_repo_reference;
          if (
            ref &&
            typeof ref === "object" &&
            ref.repoId &&
            Array.isArray(ref.filePaths)
          ) {
            const goldenRepoSelectionsFromDb: Record<
              string,
              { repoId: string; repoName?: string; selectedPaths: string[] }
            > = {
              [ref.repoId]: {
                repoId: ref.repoId,
                repoName: ref.repoName ?? undefined,
                selectedPaths: ref.filePaths,
              },
            };
            (generatePayload as Record<string, unknown>).goldenRepoSelections =
              goldenRepoSelectionsFromDb;
            // Debug-only helper so developers can easily verify which golden repo
            // is being used at BRD generation time (visible in Network payload).
            (generatePayload as Record<string, unknown>).goldenRepoReferenceDebug = {
              projectId,
              repoId: ref.repoId,
              repoName: ref.repoName ?? project?.linked_golden_repo_name,
              filePaths: ref.filePaths,
            };
            console.log(
              "[BRD Client] goldenRepoSelections from sdlc_projects.golden_repo_reference:",
              ref.repoName ?? ref.repoId
            );
          }
        } catch (err) {
          console.warn(
            "[BRD Client] Could not fetch project golden_repo_reference:",
            err
          );
        }
      } else if (data.useGoldenRepo) {
        const goldenRepoSelectionsForApi =
          getGoldenRepoSelectionsForGenerate(goldenRepoSelections);
        if (Object.keys(goldenRepoSelectionsForApi).length > 0) {
          (generatePayload as Record<string, unknown>).goldenRepoSelections =
            goldenRepoSelectionsForApi;
        }
      }

      console.log("[BRD Client] Generate payload keys:", Object.keys(generatePayload));
      console.log("[BRD Client] Generate payload brdId:", generatePayload.brdId);
      console.log(
        "[BRD Client] goldenRepoSelections (repos in body):",
        Object.keys((generatePayload.goldenRepoSelections as object) ?? {}).length
      );

      const result = await getBRDGenerate({
        type: "form",
        payload: generatePayload,
        diagramImages: diagramImages.length > 0 ? diagramImages : undefined,
      });

      console.log("[BRD Client] Generate response:", {
        success: result.success,
        hasBrd: !!result.brd,
        hasRagDebug: !!result.ragDebug,
      });

      if (result.ragDebug) {
        console.group("[BRD-RAG-DEBUG]");
        console.log("enabled:", result.ragDebug.enabled);
        console.log("filesDiscovered:", result.ragDebug.filesDiscovered);
        console.log("filesSelected:", result.ragDebug.filesSelected);
        console.log("filesSkipped:", result.ragDebug.filesSkipped);
        console.log("parseResults:", result.ragDebug.parseResults);
        console.log("finalFilesUsedForSummary:", result.ragDebug.finalFilesUsedForSummary);
        console.log("summaryInputCharCount:", result.ragDebug.summaryInputCharCount);
        console.log("full ragDebug:", result.ragDebug);
        console.groupEnd();
        setRagDebug(result.ragDebug);
      } else {
        setRagDebug(null);
      }

      if (!result.success) {
        throw new Error("Failed to generate BRD. Please try again.");
      }

      // Synchronous mode (older backend behavior)
      if (result.brd) {
        setBrd(result.brd);
        toast({
          title: "BRD generated",
          description: "BRD has been generated and saved as draft.",
        });
        return;
      }

      // Async mode (job-based response)
      if (result.jobId && (result.brdId || generatePayload.brdId)) {
        const jobId = result.jobId;
        const brdIdToSelect =
          (result.brdId as string | undefined) ??
          (generatePayload.brdId as string | undefined);

        setActiveJobId(jobId);
        const polledBrd = await pollBrdGenerationJob(jobId);
        setActiveJobId(null);

        if (polledBrd) {
          // Guard against the selectedBRDData useEffect clearing this BRD
          // before the DB refetch returns with generatedBrdJson.
          justGeneratedRef.current = true;
          setBrd(polledBrd);
          if (brdIdToSelect) {
            setSelectedBrdId(brdIdToSelect);
            // Re-sync with DB after a short delay to ensure DB writes are committed.
            setTimeout(() => {
              queryClient.invalidateQueries({
                queryKey: ["/api/dev-brd", brdIdToSelect],
              });
              refetchDrafts();
            }, 1000);
          }
          toast({
            title: "BRD generated",
            description: "BRD generation completed and draft is ready.",
          });
        }
        return;
      }

      throw new Error(
        "Failed to generate BRD (no BRD payload or jobId returned). Please try again."
      );
    } catch (error: any) {
      const isPermissionError = error?.code === "PERMISSION_DENIED";
      const message =
        error instanceof Error ? error.message : "Failed to generate BRD.";

      toast({
        title: isPermissionError ? "Permission denied" : "BRD generation failed",
        description: isPermissionError
          ? message
          : message || "Something went wrong while generating the BRD.",
        variant: "destructive",
      });
    } finally {
      setIsGenerating(false);
      setBrdJobStartedAt(null);
      setBrdJobStep(null);
      setBrdJobBackendProgress(null);
    }
  };

  const handleEnhanceSection = (
    sectionId: number,
    enhancedText: string,
    originalText?: string
  ) => {
    setBrd((currentBrd) => {
      if (!currentBrd) return currentBrd;
      if (sectionId < 0 || sectionId >= currentBrd.sections.length) {
        return currentBrd;
      }

      const previousSectionContent = currentBrd.sections[sectionId]?.content ?? "";
      const replaceSource =
        typeof originalText === "string" && originalText.trim().length > 0
          ? originalText
          : previousSectionContent;

      const updatedSections = currentBrd.sections.map((section, i) => {
        if (i === sectionId) {
          if (
            typeof originalText === "string" &&
            originalText.trim().length > 0 &&
            typeof section.content === "string" &&
            section.content.includes(originalText)
          ) {
            return {
              ...section,
              content: section.content.replace(originalText, enhancedText),
            };
          }
          return { ...section, content: enhancedText };
        }

        // Keep duplicated parent/aggregate blocks in sync with subsection edits.
        // This makes Edit 2 updates persist the same way as Edit 1.
        if (
          replaceSource.trim().length > 30 &&
          typeof section.content === "string" &&
          section.content.includes(replaceSource)
        ) {
          return {
            ...section,
            content: section.content.replace(replaceSource, enhancedText),
          };
        }

        return section;
      });

      const updatedBrd: BRDDocument = {
        ...currentBrd,
        sections: updatedSections,
        rawMarkdown: rebuildMarkdownFromSections(
          currentBrd.title,
          currentBrd.version,
          currentBrd.date,
          updatedSections
        ),
      };

      brdRef.current = updatedBrd;

      // Auto-save to DB so edits persist and requirements stay in sync
      if (selectedBrdId) {
        fetch(getApiUrl(`/api/dev-brd/${selectedBrdId}`), {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            generatedMarkdown: updatedBrd.rawMarkdown,
            generatedBrdJson: updatedBrd,
          }),
        }).catch((err) =>
          console.error("[BRD] Auto-save after section edit failed:", err)
        );
      }

      return updatedBrd;
    });

    toast({
      title: "Section updated",
      description: "Changes have been saved.",
    });
  };

  const handleSendToReview = async () => {
    if (!selectedBrdId) {
      toast({
        title: "BRD required",
        description: "Please select a BRD to send to review.",
        variant: "destructive",
      });
      throw new Error("BRD required");
    }

    const reviewerIds = Array.from(
      new Set(Object.values(approverByRoleName).flat())
    );
    const shouldAutoApprove = canUseAutoApprove && autoApproveEnabled;

    if (
      (approverUsersData?.roles?.length ?? 0) > 0 &&
      reviewerIds.length === 0 &&
      !shouldAutoApprove
    ) {
      toast({
        title: "Reviewer required",
        description: "Select at least one reviewer before sending the BRD for review.",
        variant: "destructive",
      });
      throw new Error("Reviewer required");
    }

    setIsSendingToReview(true);
    try {
      const latestBrd = brdRef.current ?? brd;
      if (latestBrd) {
        const putRes = await fetch(
          getApiUrl(`/api/dev-brd/${selectedBrdId}`),
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({
              generatedMarkdown: latestBrd.rawMarkdown,
              generatedBrdJson: latestBrd,
            }),
          }
        );
        if (!putRes.ok) {
          const errData = await putRes.json().catch(() => ({}));
          throw new Error(errData.error || "Failed to save BRD document");
        }
      }

      const updateStatusRes = await fetch(
        getApiUrl(`/api/dev-brd/${selectedBrdId}/status`),
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            status: "review",
            reviewerIds,
            ...(shouldAutoApprove ? { autoApprove: true } : {}),
          }),
        }
      );

      if (!updateStatusRes.ok) {
        const errorData = await updateStatusRes.json().catch(() => ({}));
        throw new Error(errorData.error || "Failed to update BRD status");
      }

      queryClient.invalidateQueries({
        queryKey: ["/api/dev-brd", selectedBrdId],
      });
      queryClient.invalidateQueries({
        queryKey: ["/api/dev-brd/can-approve", selectedBrdId],
      });
      queryClient.invalidateQueries({
        queryKey: ["/api/dev-brd/drafts", projectId],
      });

      toast({
        title: "BRD sent to review",
        description: shouldAutoApprove
          ? "The BRD has been sent to review. You can now approve it from the BRD preview."
          : "The BRD has been sent for review. You can now approve it.",
      });
    } catch (error: any) {
      toast({
        title: "Send to review failed",
        description:
          error instanceof Error
            ? error.message
            : "Failed to send BRD to review.",
        variant: "destructive",
      });
      throw error;
    } finally {
      setIsSendingToReview(false);
    }
  };

  const openSendToReviewModal = async () => {
    setApproverByRoleName(buildInitialApproverSelections(approverUsersData));
    setAutoApproveEnabled(false);
    setSendToReviewOpen(true);
  };

  const handleSendReviewFromModal = async () => {
    try {
      await handleSendToReview();
      setSendToReviewOpen(false);
    } catch {
      // `handleSendToReview` already toasts; keep the dialog open on failure.
    }
  };

  const handleApproveBrd = async () => {
    const latestBrd = brdRef.current ?? brd;
    if (!latestBrd) return;
    if (!projectId) {
      toast({
        title: "Project required",
        description: "Please open BRD with a projectId to approve.",
        variant: "destructive",
      });
      return;
    }

    if (!selectedBrdId) {
      toast({
        title: "BRD required",
        description: "Please select a BRD to approve.",
        variant: "destructive",
      });
      return;
    }

    setIsApproving(true);
    try {
      const putRes = await fetch(
        getApiUrl(`/api/dev-brd/${selectedBrdId}`),
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            generatedMarkdown: latestBrd.rawMarkdown,
            generatedBrdJson: latestBrd,
          }),
        }
      );
      if (!putRes.ok) {
        const errData = await putRes.json().catch(() => ({}));
        console.error("[BRD] Failed to save BRD content:", errData);
        throw new Error(errData.error || "Failed to save BRD document");
      }
      console.log("[BRD] BRD content saved successfully");

      const updateStatusRes = await fetch(
        getApiUrl(`/api/dev-brd/${selectedBrdId}/status`),
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ status: "approved" }),
        }
      );

      if (!updateStatusRes.ok) {
        const errorData = await updateStatusRes.json().catch(() => ({}));
        if (updateStatusRes.status === 403) {
          const message =
            errorData?.message ||
            errorData?.error ||
            'You do not have permission to approve BRDs. Please contact your administrator.';
          const err: any = new Error(message);
          err.code = "PERMISSION_DENIED";
          err.operation = "brd_approve";
          throw err;
        }
        throw new Error(errorData.error || "Failed to update BRD status");
      }

      // Refetch drafts to remove this BRD from the list
      refetchDrafts();

      // Step 2: upload BRD to workflow system (if needed for existing workflow)
      // IMPORTANT: Skip upload if BRD already has generated content - extraction was done during generation, not approval
      // Only upload if this is a newly uploaded BRD file that needs processing
      const hasGeneratedContent =
        selectedBRDData?.generatedBrdJson || selectedBRDData?.generatedMarkdown;

      if (hasGeneratedContent) {
        console.log(
          "[BRD] BRD already has generated content - skipping upload during approval. No extraction needed."
        );
      } else {
        // Only upload if BRD doesn't have generated content (newly uploaded file)
        // Note: The file is already stored in dev_brd_documents from generation
        // This upload step is kept for backward compatibility with the workflow system
        let uploadData: any = null;
        try {
          const docxResponse = await fetch(
            getApiUrl(`/api/dev-brd/${selectedBrdId}/file`),
            {
              credentials: "include",
            }
          );
          if (docxResponse.ok) {
            const blob = await docxResponse.blob();
            const formData = new FormData();
            formData.append(
              "file",
              blob,
              `BRD-${latestBrd.title.replace(/[^a-zA-Z0-9]/g, "-") || "document"
              }.docx`
            );
            formData.append("projectId", projectId);
            // Use the database BRD title (from selectedBRDData) instead of generated title to avoid duplicate creation
            // The generated title "Business Requirements Document: [Project Name]" would create a duplicate
            const dbBrdTitle = selectedBRDData?.title || latestBrd.title;
            formData.append("title", dbBrdTitle);
            formData.append("brdId", selectedBrdId); // Pass brdId to prevent duplicate creation
            formData.append("createdBy", me?.user?.id ?? "system");
            formData.append("uploadedBy", me?.user?.id ?? "system");

            // Include captured BRD inputs so they are persisted with the file
            if (lastFormData) {
              if (lastFormData.projectName)
                formData.append("projectName", lastFormData.projectName);
              if (lastFormData.projectDescription)
                formData.append(
                  "projectDescription",
                  lastFormData.projectDescription
                );
              if (lastFormData.businessObjectives)
                formData.append(
                  "businessObjectives",
                  lastFormData.businessObjectives
                );
              if (lastFormData.successCriteria)
                formData.append(
                  "successCriteria",
                  lastFormData.successCriteria
                );
              if (lastFormData.targetAudience)
                formData.append("targetAudience", lastFormData.targetAudience);
              if (lastFormData.stakeholders)
                formData.append("stakeholders", lastFormData.stakeholders);
              if (lastFormData.keyFeatures)
                formData.append("keyFeatures", lastFormData.keyFeatures);
              if (lastFormData.existingRequirements)
                formData.append(
                  "existingRequirements",
                  lastFormData.existingRequirements
                );
              if (lastFormData.constraints)
                formData.append("constraints", lastFormData.constraints);
              if (lastFormData.timeline)
                formData.append("timeline", lastFormData.timeline);
              if (lastFormData.budget)
                formData.append("budget", lastFormData.budget);
            }

            const uploadRes = await fetch(getApiUrl("/api/brd/upload"), {
              method: "POST",
              body: formData,
              credentials: "include",
            });

            // Don't fail approval if upload fails - status is already updated
            if (uploadRes.ok) {
              uploadData = await uploadRes.json();
              console.log("[BRD] Uploaded to workflow system:", uploadData);
            }
          }
        } catch (uploadError) {
          console.warn(
            "[BRD] Failed to upload to workflow system (non-critical):",
            uploadError
          );
          // Don't fail approval if workflow upload fails
        }
      }

      toast({
        title: "BRD approved",
        description: "Latest BRD has been uploaded and versioned.",
      });

      queryClient.invalidateQueries({
        queryKey: ["/api/dev-brd/can-approve", selectedBrdId],
      });

      // Step 3: navigate to SDLC Backlogs and auto-open Workflow
      const nextParams = new URLSearchParams();
      nextParams.append("projectId", projectId);
      if (projectName) nextParams.append("projectName", projectName);
      if (organizationName)
        nextParams.append("organizationName", organizationName);
      if (goldenRepoName) nextParams.append("goldenRepoName", goldenRepoName);
      nextParams.append("openWorkflow", "1");
      nextParams.append("openPhase", "backlogs");
      // Use the actual approved BRD ID (selectedBrdId) instead of uploadData.brdId
      // This ensures the workflow page can find the BRD that was just approved
      if (selectedBrdId) nextParams.append("brdId", selectedBrdId);
      setLocation(`/sdlc?${nextParams.toString()}`);
    } catch (error: any) {
      const isPermissionError = error?.code === "PERMISSION_DENIED";
      toast({
        title: isPermissionError ? "Permission denied" : "Approve failed",
        description:
          error instanceof Error ? error.message : "Failed to approve BRD.",
        variant: "destructive",
      });
    } finally {
      setIsApproving(false);
    }
  };


  /**
   * Upload BRD entry point. Mirrors `handleGenerateBRD` but for the file-upload
   * path: POST to `/api/brd/upload` returns 202 + jobId, then we poll the same
   * `/api/brd/generate/status/:jobId` endpoint with the same UI progress hooks.
   * The resolved value matches the legacy synchronous response shape so the
   * upload form's existing success-handling code keeps working unchanged.
   */
  const generateFromUploadWithPolling = async (
    formData: FormData,
  ): Promise<{
    success: boolean;
    brd: BRDDocument | null;
    brdId?: string;
    jobId?: string;
  }> => {
    brdJobCancelledRef.current = false;
    setIsGenerating(true);
    setBrdJobStartedAt(Date.now());

    // Confluence pre-flight: summarize any attached Confluence docs before uploading
    if (confluenceFiles.length > 0) {
      setBrdJobStep("Summarizing Confluence reference documents...");
      try {
        const confFormData = new FormData();
        for (const f of confluenceFiles) {
          confFormData.append("files", f, f.name);
        }
        const confRes = await fetch(getApiUrl("/api/brd/confluence-summary"), {
          method: "POST",
          credentials: "include",
          body: confFormData,
        });
        if (confRes.ok) {
          const confJson = await confRes.json().catch(() => ({ summary: "" }));
          const summary = ((confJson.summary as string | undefined) ?? "").trim();
          if (summary) {
            formData.append("confluenceSummary", summary);
            console.log(`[BRD Client][Upload] Confluence summary appended to formData (${summary.length} chars)`);
          }
        } else {
          console.warn(`[BRD Client][Upload] Confluence summary endpoint failed (${confRes.status}); continuing without it.`);
        }
      } catch (confErr) {
        console.warn("[BRD Client][Upload] Confluence summary failed; continuing without it:", confErr);
      }
    }

    setBrdJobStep("Uploading file...");
    try {
      const result = await getBRDGenerate({ type: "upload", formData });
      // Synchronous-completion path (older deployments without async upload).
      if (result.brd) {
        return {
          success: true,
          brd: result.brd,
          brdId: result.brdId,
        };
      }
      // 202 + jobId asynchronous path. Poll until completion (or surface
      // a graceful background-finish message via toast).
      if (result.jobId && result.brdId) {
        setActiveJobId(result.jobId);
        const polledBrd = await pollBrdGenerationJob(result.jobId);
        setActiveJobId(null);
        // If the user explicitly cancelled, do NOT surface the fallback BRD.
        if (brdJobCancelledRef.current) {
          return { success: false, brd: null };
        }
        return {
          success: true,
          brd: polledBrd,
          brdId: result.brdId,
          jobId: result.jobId,
        };
      }
      // Defensive: backend returned success+brdId but no inline brd or jobId.
      // Treat as success and let the parent re-fetch the BRD by id.
      if (result.success && result.brdId) {
        return {
          success: true,
          brd: null,
          brdId: result.brdId,
        };
      }
      throw new Error(
        "Upload succeeded but server did not return a BRD payload or jobId.",
      );
    } finally {
      setIsGenerating(false);
      setActiveJobId(null);
    }
  };

  const cancelBrdGeneration = async () => {
    if (!activeJobId || isCancelling) return;
    setIsCancelling(true);

    // Immediately reset UI state so the progress card disappears right away.
    setIsGenerating(false);
    setBrdJobStartedAt(null);
    setBrdJobStep(null);
    setBrdJobBackendProgress(null);
    setActiveJobId(null);
    // Mark as cancelled so the polling result is ignored (no fallback BRD in upload flow).
    brdJobCancelledRef.current = true;

    try {
      const res = await fetch(getApiUrl(`/api/brd/generate/cancel/${activeJobId}`), {
        method: "POST",
        credentials: "include",
      });
      if (res.ok) {
        toast({
          title: "Generation cancelled",
          description: "The BRD generation process was stopped.",
        });
      } else {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to cancel generation");
      }
    } catch (err: any) {
      toast({
        title: "Cancellation failed",
        description: err.message,
        variant: "destructive",
      });
    } finally {
      setIsCancelling(false);
    }
  };

  const handleUploadSuccess = async (
    brdId: string,
    brd?: BRDDocument | null
  ) => {
    try {
      setSelectedBrdId(brdId);
      if (brd != null) setBrd(brd);

      // Prime the cache so Send to Review and other actions have fresh data
      const response = await fetch(getApiUrl(`/api/dev-brd/${brdId}`), {
        credentials: "include",
        cache: "no-store",
      });
      if (response.ok) {
        const data = await response.json();
        queryClient.setQueryData(["/api/dev-brd", brdId], data);
      } else {
        queryClient.invalidateQueries({ queryKey: ["/api/dev-brd", brdId] });
      }

      await refetchDrafts();

      toast({
        title: "BRD uploaded successfully",
        description: "The BRD has been saved and is now available for preview.",
      });
    } catch (error) {
      console.error("Error handling upload success:", error);
      queryClient.invalidateQueries({ queryKey: ["/api/dev-brd", brdId] });
      toast({
        title: "Upload succeeded",
        description:
          "BRD uploaded but failed to refresh. Please refresh the page.",
        variant: "destructive",
      });
    }
  };

  // Normalize stored BRD status into the preview workflow stages so
  // Upload BRD and Create BRD show the same action buttons.
  const normalizedBrdStatus = (selectedBRDData?.status || "").toLowerCase();
  const previewWorkflowStatus: "draft" | "review" | "approved" | undefined =
    normalizedBrdStatus === "approved"
      ? "approved"
      : normalizedBrdStatus === "review"
        ? "review"
        : normalizedBrdStatus
          ? "draft"
          : brd && selectedBrdId
            ? "draft"
            : undefined;

  return (
    <div className="flex h-full flex-col bg-background">
      <div className="px-4 py-4 md:px-6 border-b">
        {(organizationName || projectName || goldenRepoName) && (
          <div className="mt-3 flex items-center gap-3 text-sm flex-wrap">
            {organizationName && (
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800">
                <Building2 className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                <span className="font-medium text-blue-800 dark:text-blue-300">
                  Organization: {organizationName}
                </span>
              </div>
            )}
            {projectName && (
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-800">
                <FolderGit2 className="h-4 w-4 text-green-600 dark:text-green-400" />
                <span className="font-medium text-green-800 dark:text-green-300">
                  Project: {projectName}
                </span>
              </div>
            )}
            {goldenRepoName && (
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800">
                <GitBranch className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                <span className="font-medium text-amber-800 dark:text-amber-300">
                  Golden Repo: {goldenRepoName}
                </span>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="flex-1 flex flex-col min-h-0 px-4 pb-4 md:px-6 md:pb-6">
        {/* Mode Toggle */}
        <div className="mb-4 flex-shrink-0">
          <Tabs
            value={entryMode}
            onValueChange={(v) => {
              const newMode = v as "generate" | "upload";
              setEntryMode(newMode);
              // Reset preview and confluence files when switching to upload mode
              if (newMode === "upload") {
                setBrd(null);
                setSelectedBrdId(null);
                setConfluenceFiles([]);
              }
            }}
          >
            <TabsList>
              <TabsTrigger value="generate">Create BRD</TabsTrigger>
              <TabsTrigger value="upload">Upload BRD</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>

        <div className="grid flex-1 min-h-0 gap-4 md:gap-6 lg:grid-cols-2">
          {entryMode === "generate" ? (
            <div className="flex flex-col gap-4">
              {/* BRD Selection Controls - Inside Generate BRD tab */}
              <div className="flex items-center gap-4 flex-wrap">
                <div className="flex items-center gap-2">
                  <label className="text-sm font-medium">
                    Choose Existing BRD:
                  </label>
                  <Select
                    value={selectedBrdId || "new"}
                    onValueChange={handleSelectBRD}
                  >
                    <SelectTrigger className="w-[300px]">
                      <SelectValue placeholder="Select a BRD..." />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="new">Create New BRD</SelectItem>
                      {draftBRDs.map((draft) => (
                        <SelectItem key={draft.id} value={draft.id}>
                          {draft.title}
                        </SelectItem>
                      ))}
                      {draftBRDs.length === 0 && (
                        <SelectItem value="none" disabled>
                          No draft BRDs found
                        </SelectItem>
                      )}
                    </SelectContent>
                  </Select>
                  {/* BRD Status Badge */}
                  {selectedBrdId && selectedBRDData?.status && (
                    <Badge
                      variant={
                        selectedBRDData.status === "approved"
                          ? "outline"
                          : selectedBRDData.status === "draft"
                            ? "secondary"
                            : selectedBRDData.status === "review"
                              ? "outline"
                              : "outline"
                      }
                      className={cn(
                        "text-xs",
                        selectedBRDData.status === "approved"
                          ? "border-green-500 text-green-600 dark:text-green-400"
                          : selectedBRDData.status === "draft"
                            ? "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300"
                            : selectedBRDData.status === "review"
                              ? "border-blue-500 text-blue-600 dark:text-blue-400"
                              : "border-amber-500 text-amber-600 dark:text-amber-400"
                      )}
                    >
                      {selectedBRDData.status === "approved"
                        ? "Approved"
                        : selectedBRDData.status === "draft"
                          ? "Draft"
                          : selectedBRDData.status === "review"
                            ? "Review"
                            : selectedBRDData.status === "yet_to_review" ||
                              selectedBRDData.status === "pending_review"
                              ? "Yet to Review"
                              : selectedBRDData.status
                                .split("_")
                                .map(
                                  (word) =>
                                    word.charAt(0).toUpperCase() + word.slice(1)
                                )
                                .join(" ")}
                    </Badge>
                  )}
                </div>
              </div>
              <BRDInputForm
                onSubmit={handleGenerate}
                isGenerating={isGenerating}
                defaultProjectName={projectName}
                selectedBRDId={selectedBrdId || undefined}
                tokenInfo={tokenInfo}
                confluenceFiles={confluenceFiles}
                onConfluenceFilesChange={setConfluenceFiles}
                diagramImages={diagramImages}
                onDiagramImagesChange={setDiagramImages}
                brdData={
                  selectedBRDData
                    ? {
                      brdName:
                        selectedBRDData.title || selectedDraft?.title || "",
                      projectDescription:
                        selectedBRDData.projectDescription || "",
                      businessObjectives:
                        selectedBRDData.businessObjectives || "",
                      successCriteria: selectedBRDData.successCriteria || "",
                      targetAudience: selectedBRDData.targetAudience || "",
                      stakeholders: selectedBRDData.keyStakeholders || "",
                      keyFeatures: selectedBRDData.keyFeatures || "",
                      existingRequirements:
                        selectedBRDData.existingRequirements || "",
                      constraints: selectedBRDData.constraints || "",
                      timeline: selectedBRDData.timeline || "",
                      budget: selectedBRDData.budget || "",
                      useGoldenRepo: selectedBRDData.useGoldenRepo ?? true,
                    }
                    : lastFormData
                      ? {
                        brdName: lastFormData.brdName,
                        projectDescription:
                          lastFormData.projectDescription || "",
                        businessObjectives:
                          lastFormData.businessObjectives || "",
                        successCriteria: lastFormData.successCriteria || "",
                        targetAudience: lastFormData.targetAudience || "",
                        stakeholders: lastFormData.stakeholders || "",
                        keyFeatures: lastFormData.keyFeatures || "",
                        existingRequirements:
                          lastFormData.existingRequirements || "",
                        constraints: lastFormData.constraints || "",
                        timeline: lastFormData.timeline || "",
                        budget: lastFormData.budget || "",
                        useGoldenRepo: lastFormData.useGoldenRepo ?? true,
                      }
                      : undefined
                }
                onSave={handleSaveBRD}
                onSaveBrdName={handleSaveBrdName}
                onDirtyChange={setHasUnsavedChanges}
                onReset={handleCreateNewBrd}
              />
            </div>
          ) : (
            <BRDUploadForm
              projectId={projectId}
              onUploadSuccess={handleUploadSuccess}
              isUploading={isGenerating}
              generateFromUpload={(formData) =>
                generateFromUploadWithPolling(formData)
              }
              liveStepMessage={
                brdJobStep ||
                brdJobBackendProgress?.message ||
                undefined
              }
              onCancel={cancelBrdGeneration}
              isCancelling={isCancelling}
              confluenceFiles={confluenceFiles}
              onConfluenceFilesChange={setConfluenceFiles}
            />
          )}
          <div className="flex flex-col gap-4 min-h-0">
            <BRDPreview
              brd={brd}
              isLoading={isGenerating}
              brdJobProgress={
                brdJobStartedAt
                  ? {
                    elapsedMs: brdJobElapsedMs,
                    progressFloor: brdJobProgressFloor,
                    step: brdJobStep,
                    stepKey: brdJobBackendProgress?.stepKey,
                    stepDurationsMs: brdJobStepDurationsMs,
                  }
                  : undefined
              }
              brdLastGenerationSummary={brdLastGenerationSummary}
              onEnhanceSection={handleEnhanceSection}
              onApprove={
                previewWorkflowStatus === "review"
                  ? handleApproveBrd
                  : undefined
              }
              isApproving={isApproving}
              onSendToReview={
                previewWorkflowStatus === "draft" ||
                  ((isTenantAdmin || isOrgAdmin) &&
                    previewWorkflowStatus !== "approved" &&
                    !canApproveBrd &&
                    (!!selectedBrdId || !!brd))
                  ? openSendToReviewModal
                  : undefined
              }
              isSendingToReview={isSendingToReview}
              brdStatus={previewWorkflowStatus}
              brdFileName={selectedBRDData?.brdFileName || null}
              brdFileType={selectedBRDData?.brdFileType || null}
              brdId={selectedBrdId || undefined}
              canApprove={canApproveBrd}
              onCancel={cancelBrdGeneration}
              isCancelling={isCancelling}
            />

            <Dialog
              open={sendToReviewOpen}
              onOpenChange={(open) => {
                setSendToReviewOpen(open);
                if (open) {
                  setApproverByRoleName(buildInitialApproverSelections(approverUsersData));
                  setAutoApproveEnabled(false);
                } else {
                  setAutoApproveEnabled(false);
                }
              }}
            >
              <DialogContent className="sm:max-w-[720px] max-h-[85vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle>Send to Review</DialogTitle>
                </DialogHeader>

                <div className="rounded-lg border bg-muted/30 px-4 py-3">
                  <div className="flex items-start gap-3">
                    <Users className="mt-0.5 h-4 w-4 text-muted-foreground" />
                    <div className="space-y-1">
                      <p className="text-sm font-medium">Choose the reviewer who should approve this BRD.</p>
                      <p className="text-sm text-muted-foreground">
                        Only the selected reviewer will receive the approval request.
                      </p>
                    </div>
                  </div>
                </div>

                <div className="space-y-4">
                  {(approverUsersLoading ? ["loading"] : approverRoleNames).map((roleName) => {
                    if (roleName === "loading") {
                      const tokens = roleColorTokens("loading");
                      return (
                        <div
                          key="loading"
                          className={cn(
                            "rounded-xl border bg-card/70 p-4 shadow-sm",
                            tokens.border
                          )}
                        >
                          <div className={cn("font-semibold text-sm", tokens.accentText)}>
                            Reviewer
                          </div>
                          <div className="mt-3 rounded-md border border-dashed p-3 text-sm text-muted-foreground">
                            Loading reviewers...
                          </div>
                        </div>
                      );
                    }

                    const tokens = roleColorTokens(roleName);
                    const options = approverUsersData?.usersByRoleName?.[roleName] ?? [];
                    const selectedIds = approverByRoleName[roleName] ?? [];

                    return (
                      <div
                        key={roleName}
                        className={cn(
                          "rounded-xl border bg-card/70 p-4 shadow-sm",
                          tokens.border
                        )}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className={cn("font-semibold text-sm", tokens.accentText)}>
                            {prettyRoleName(roleName)}
                          </div>
                          <div className="rounded-full bg-background/80 px-2.5 py-1 text-xs text-muted-foreground">
                            {selectedIds.length > 0 ? "Selected" : `${options.length} available`}
                          </div>
                        </div>

                        <div className="mt-3">
                          {options.length > 0 ? (
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button
                                  type="button"
                                  variant="outline"
                                  className={cn(
                                    "h-auto min-h-11 w-full justify-between rounded-lg border bg-background px-3 py-2.5 text-left font-normal shadow-sm",
                                    tokens.triggerBorder
                                  )}
                                  disabled={isSendingToReview || approverUsersLoading}
                                >
                                  <span className="truncate">
                                    {getReviewerSummary(selectedIds, options)}
                                  </span>
                                  <ChevronDown className="ml-3 h-4 w-4 shrink-0 text-muted-foreground" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent
                                className="scrollbar-none max-h-72 w-[340px] overflow-y-auto rounded-xl p-2"
                                align="start"
                              >
                                {options.map((opt) => {
                                  const isChecked = selectedIds.includes(opt.userId);
                                  const isDisabled =
                                    Boolean(globallySelectedReviewerId) &&
                                    globallySelectedReviewerId !== opt.userId;
                                  return (
                                    <DropdownMenuItem
                                      key={opt.userId}
                                      className={cn(
                                        "gap-3 rounded-lg pl-2",
                                        isDisabled && "pointer-events-none opacity-50"
                                      )}
                                      onSelect={(event) => {
                                        event.preventDefault();
                                        if (isDisabled) {
                                          return;
                                        }
                                        setApproverByRoleName((cur) => {
                                          if (isChecked) {
                                            return Object.fromEntries(
                                              Object.keys(cur).map((key) => [key, []])
                                            );
                                          } else {
                                            return Object.fromEntries(
                                              Object.keys(cur).map((key) => [
                                                key,
                                                key === roleName ? [opt.userId] : [],
                                              ])
                                            );
                                          }
                                        });
                                      }}
                                      disabled={isDisabled}
                                    >
                                      <Checkbox checked={isChecked} className="pointer-events-none" />
                                      <span>{opt.name}</span>
                                    </DropdownMenuItem>
                                  )
                                })}
                              </DropdownMenuContent>
                            </DropdownMenu>
                          ) : (
                            <Button
                              type="button"
                              variant="outline"
                              className={cn(
                                "h-auto min-h-11 w-full justify-start border px-3 py-2 text-left font-normal text-muted-foreground",
                                tokens.triggerBorder
                              )}
                              disabled
                            >
                              No users found
                            </Button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {!approverUsersLoading && selectedReviewerCount === 0 && !autoApproveEnabled && (
                  <Alert className="border-amber-500/30 bg-amber-500/5 text-foreground [&>svg]:text-amber-500">
                    <CheckCircle2 className="h-4 w-4" />
                    <AlertDescription>
                      Select at least one reviewer to enable sending this BRD for review.
                    </AlertDescription>
                  </Alert>
                )}

                <DialogFooter>
                  {canUseAutoApprove ? (
                    <div className="mr-auto flex items-center gap-2">
                      <span className="text-sm text-muted-foreground">Auto approve</span>
                      <Switch
                        checked={autoApproveEnabled}
                        onCheckedChange={setAutoApproveEnabled}
                        disabled={isSendingToReview}
                        aria-label="Enable auto approve"
                      />
                    </div>
                  ) : null}
                  <Button
                    variant="outline"
                    onClick={() => setSendToReviewOpen(false)}
                    disabled={isSendingToReview}
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={handleSendReviewFromModal}
                    disabled={
                      isSendingToReview ||
                      (!approverUsersLoading &&
                        selectedReviewerCount === 0 &&
                        !autoApproveEnabled)
                    }
                  >
                    {isSendingToReview ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Sending...
                      </>
                    ) : (
                      autoApproveEnabled ? "Send Review and Auto Approve" : "Send Review"
                    )}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>

            {ragDebug && (
              <Collapsible defaultOpen={true}>
                <Card className="border-amber-200 bg-amber-50/50 dark:border-amber-800 dark:bg-amber-950/20">
                  <CollapsibleTrigger asChild>
                    <CardHeader className="cursor-pointer py-3">
                      <CardTitle className="text-sm font-medium flex items-center gap-2">
                        <span>[BRD-RAG-DEBUG]</span>
                        <Badge variant="outline" className="text-xs">
                          {ragDebug.filesSelected.length} selected,{" "}
                          {ragDebug.filesSkipped.length} skipped,{" "}
                          {ragDebug.parseResults.length} parsed
                        </Badge>
                      </CardTitle>
                    </CardHeader>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <CardContent className="pt-0 pb-4 text-xs space-y-3">
                      <div>
                        <span className="font-semibold">Discovered:</span>{" "}
                        {ragDebug.filesDiscovered.length} file(s) —{" "}
                        {ragDebug.filesDiscovered
                          .map((f) => f.path)
                          .join(", ") || "—"}
                      </div>
                      <div>
                        <span className="font-semibold">Selected:</span>{" "}
                        {ragDebug.filesSelected.length
                          ? ragDebug.filesSelected.join(", ")
                          : "—"}
                      </div>
                      <div>
                        <span className="font-semibold">Skipped:</span>{" "}
                        {ragDebug.filesSkipped.length ? (
                          <ul className="list-disc list-inside mt-1">
                            {ragDebug.filesSkipped.map((s, i) => (
                              <li key={i}>
                                {s.path} — {s.reason}
                              </li>
                            ))}
                          </ul>
                        ) : (
                          "—"
                        )}
                      </div>
                      <div>
                        <span className="font-semibold">Parse results:</span>
                        <ul className="list-disc list-inside mt-1">
                          {ragDebug.parseResults.map((p, i) => (
                            <li key={i}>
                              {p.name} — {p.parseStatus}, chunks:{" "}
                              {p.chunkCount}, len: {p.extractedTextLength}
                              {p.contributedToSummary && " ✓ used in summary"}
                              {p.parseError && ` — ${p.parseError}`}
                            </li>
                          ))}
                        </ul>
                      </div>
                      <div>
                        <span className="font-semibold">
                          Final files used in RAG summary:
                        </span>{" "}
                        {ragDebug.finalFilesUsedForSummary.length
                          ? ragDebug.finalFilesUsedForSummary.join(", ")
                          : "—"}
                      </div>
                      <div>
                        <span className="font-semibold">
                          Summary input char count:
                        </span>{" "}
                        {ragDebug.summaryInputCharCount}
                      </div>
                    </CardContent>
                  </CollapsibleContent>
                </Card>
              </Collapsible>
            )}
          </div>
        </div>
      </div>

      {/* Unsaved BRD data navigation guard */}
      <AlertDialog open={navGuardOpen} onOpenChange={setNavGuardOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {navGuardReason === "generating"
                ? "BRD generation in progress"
                : "Discard BRD input?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {navGuardReason === "generating"
                ? GENERATING_BRD_MESSAGE
                : UNSAVED_BRD_MESSAGE}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              onClick={() => {
                // User chose to stay – ensure programmatic nav flag is cleared
                isProgrammaticNavRef.current = false;
                setNavGuardOpen(false);
                setPendingNavAction(null);
                setNavGuardReason(null);
              }}
            >
              Stay on this page
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-primary text-primary-foreground"
              onClick={() => {
                if (!pendingNavAction) return;

                // Mark that we are performing an intentional, programmatic navigation
                // so the native beforeunload handler does not show a second dialog.
                isProgrammaticNavRef.current = true;

                if (pendingNavAction.type === "tab") {
                  const mode = pendingNavAction.mode;
                  setEntryMode(mode);
                  if (mode === "upload") {
                    setBrd(null);
                    setSelectedBrdId(null);
                  }
                } else if (pendingNavAction.type === "select-brd") {
                  if (pendingNavAction.brdId === "new") {
                    handleCreateNewBrd();
                  } else {
                    setSelectedBrdId(pendingNavAction.brdId);
                  }
                } else if (pendingNavAction.type === "external") {
                  try {
                    const targetUrl = new URL(
                      pendingNavAction.href,
                      window.location.href
                    );

                    // For same-origin links, use SPA navigation to avoid full reload.
                    if (targetUrl.origin === window.location.origin) {
                      setLocation(
                        `${targetUrl.pathname}${targetUrl.search}${targetUrl.hash}`
                      );
                    } else {
                      // Different origin – fall back to full page navigation.
                      window.location.href = pendingNavAction.href;
                    }
                  } catch {
                    // If URL parsing fails for any reason, fall back to default behavior.
                    window.location.href = pendingNavAction.href;
                  }
                }

                setHasUnsavedChanges(false);
                setPendingNavAction(null);
                setNavGuardOpen(false);
                setNavGuardReason(null);
              }}
            >
              Leave and discard
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
