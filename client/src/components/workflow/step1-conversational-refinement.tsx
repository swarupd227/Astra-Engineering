import { useCallback, useEffect, useState, useRef, useMemo } from "react";
import { useSearch } from "wouter";
import { nanoid } from "nanoid";
import {
  History,
  MessageCircle,
  Send,
  Bot,
  User,
  Paperclip,
  Sparkles,
  MessageSquarePlus,
  Loader2,
  FolderOpen,
  X,
  ChevronDown,
  ChevronRight,
  File as FileIcon,
  Settings,
  Upload,
  FileUp,
  Link2,
} from "lucide-react";
import { getApiUrl } from "@/lib/api-config";
import { useWorkflow } from "@/context/workflow-context";
import { apiRequest } from "@/lib/queryClient";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMsal } from "@azure/msal-react";
import { getSessionUserIdentity, useSessionIdentity } from "@/utils/msal-user";
import { useToast } from "@/hooks/use-toast";
import { useJiraOnlyWorkItems } from "@/hooks/use-hosting-config";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { Card, CardContent } from "@/components/ui/card";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import {
  CheckCircle2,
  Circle,
  Users,
  Zap,
  Target,
  Package,
} from "lucide-react";
import type { ConversationMessage, ConversationPhase } from "@shared/schema";

interface TokenInfo {
  tokenQuota: number;
  tokenUsed: number;
  remainingTokens: number;
  tokenCost: number;
  canConsume: boolean;
  lowBalance?: boolean;
  isDepleted?: boolean;
}

// RAG Guideline interface
interface Guideline {
  id: string;
  name: string;
  path: string;
  content: string;
}

/**
 * Check if a word is a valid business/technical term
 */
function isValidWord(word: string): boolean {
  const validShortWords = [
    "api",
    "app",
    "web",
    "cms",
    "crm",
    "erp",
    "pos",
    "ui",
    "ux",
    "db",
    "aws",
    "gcp",
    "sql",
    "css",
    "html",
    "spa",
    "pwa",
    "mvp",
    "poc",
    "b2b",
    "b2c",
    "saas",
    "paas",
    "iaas",
    "iot",
    "ai",
    "ml",
    "bot",
    "sms",
    "email",
    "chat",
    "zoom",
    "teams",
    "slack",
  ];

  return validShortWords.includes(word.toLowerCase());
}

/**
 * Detect invalid/meaningless input patterns
 */
function isInvalidInput(message: string): boolean {
  const trimmed = message.trim().toLowerCase();

  // Very short inputs
  if (trimmed.length < 3) return true;

  // Random character sequences (2-6 chars, all lowercase letters)
  if (/^[a-z]{2,6}$/.test(trimmed) && !isValidWord(trimmed)) return true;

  // Repeated characters (3+ same character)
  if (/^(.)\1{2,}$/.test(trimmed)) return true;

  // Keyboard mashing patterns
  if (/^(qwe|asd|zxc|123|abc|qwerty|asdf){1,3}$/i.test(trimmed)) return true;

  // Numbers without context (less than 1000)
  if (/^\d+$/.test(trimmed) && parseInt(trimmed) < 1000) return true;

  // Meaningless words
  const meaninglessWords = [
    "test",
    "testing",
    "hello",
    "hi",
    "hey",
    "ok",
    "okay",
    "yes",
    "no",
    "abcd",
    "xyz",
    "demo",
    "sample",
    "example",
    "try",
    "trying",
  ];

  if (meaninglessWords.includes(trimmed)) return true;

  return false;
}

/**
 * Check if message has substantive business context
 */
function isSubstantiveInput(message: string): boolean {
  if (isInvalidInput(message)) return false;

  const trimmed = message.trim();
  const wordCount = trimmed.split(/\s+/).length;

  // Must have reasonable length
  if (wordCount < 5) return false;

  // Check for business/project indicators
  const businessIndicators = [
    /(?:build|create|develop|need|want|looking to)\s+(?:a|an|the)?\s*(?:web|mobile|desktop|application|app|system|platform)/i,
    /(?:feature|functionality|capability|function|ability|should|must|can|requirement)/i,
    /(?:user|customer|employee|manager|admin|team|business|goal|objective)/i,
    /(?:workflow|process|step|journey|integrate|connect|track|manage|monitor)/i,
    /(?:database|api|integration|backend|frontend|cloud|server)/i,
  ];

  return businessIndicators.some((pattern) => pattern.test(trimmed));
}

export function Step1ConversationalRefinement() {
  const {
    conversationMessages,
    addConversationMessage,
    setConversationMessages,
    conversationPhase,
    setConversationPhase,
    capturedRequirements,
    updateCapturedRequirements,
    setCapturedRequirements,
    setAskedQuestions,
    setRequirement,
    isConversationLoading,
    setIsConversationLoading,
    askedQuestions,
    addAskedQuestion,
    uploadedFiles,
    addUploadedFile,
    removeUploadedFile,
    clearUploadedFiles,
    setCurrentStep,
    setStep1Complete,
    userRequirementSummary,
    setUserRequirementSummary,
    setGuidelines,
    setEpics,
    setFeatures,
    setUserStories,
    setPersonas,
    complianceGuidelines,
    selectedPersonaIds,
    sessionId,
    setSessionId,
    sdlcProjectId,
    setSdlcProjectId,
    projectName,
    setProjectName,
    requirement,
    originalRequirement,
    isRegenerating,
    setIsRegenerating,
    projectId,
    brdId,
    setBrdId,
    selectedRequirementIds: ctxSelectedRequirementIds,
    setSelectedRequirementIds: setCtxSelectedRequirementIds,
    processedFileRequirements,
    setProcessedFileRequirements,
    setEpicsLoading,
    setFeaturesLoading,
    setStoriesLoading,
    setPersonasLoading,
    setCancelGeneration,
    setIsGeneratingArtifacts,
    setGenerationLogs,
    addGenerationLog,
    generationCancelled,
    setGenerationCancelled,
    setQualityReport,
    setDomainExpertAnalysis,
    aiEnhanceEnabled,
    setAiEnhanceEnabled,
    llmTemperature,
    setLlmTemperature,
    useGoldenRepo,
    setUseGoldenRepo,
  } = useWorkflow();

  const isAwsMode = useJiraOnlyWorkItems();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [quickReplies, setQuickReplies] = useState<string[]>([]);
  const [selectedQuickReplies, setSelectedQuickReplies] = useState<string[]>(
    [],
  );
  const [isSingleSelect, setIsSingleSelect] = useState(false);
  const [showChoiceDialog, setShowChoiceDialog] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationProgress, setGenerationProgress] = useState(0);
  const [generationStep, setGenerationStep] = useState("");
  const {
    data: tokenInfo,
  } = useQuery<TokenInfo>({
    queryKey: ["/api/tokens/info", "workflow_artifacts"],
    queryFn: async () => {
      const res = await fetch(
        getApiUrl("/api/tokens/info?operation=workflow_artifacts"),
        { credentials: "include" },
      );
      if (!res.ok) {
        throw new Error("Failed to fetch token info");
      }
      return res.json();
    },
  });

  // AbortController for canceling artifact generation
  const abortControllerRef = useRef<AbortController | null>(null);
  const pollingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastLoggedStepRef = useRef<string | null>(null);
  const isPollingCancelledRef = useRef<boolean>(false);
  const [brdDialogOpen, setBrdDialogOpen] = useState(false);
  const [brdVersions, setBrdVersions] = useState<
    Array<{ id: string; title: string; status?: string; updated_at: string; brdFileName?: string | null; brdFileType?: string | null }>
  >([]);
  const [brdVersionsLoading, setBrdVersionsLoading] = useState(false);
  const [selectedBrdId, setSelectedBrdId] = useState<string | null>(null);
  const [brdRequirements, setBrdRequirements] = useState<
    Array<{
      id: string;
      requirementName: string;
      description: string | null;
      status: string;
    }>
  >([]);
  const [brdRequirementsLoading, setBrdRequirementsLoading] = useState(false);
  const [brdRequirementsError, setBrdRequirementsError] = useState<
    string | null
  >(null);
  const [selectedRequirementIds, setSelectedRequirementIds] = useState<
    string[]
  >([]);
  const [attachStatus, setAttachStatus] = useState<string | null>(null);
  const [attachLoading, setAttachLoading] = useState(false);
  const [brdAttached, setBrdAttached] = useState(false);
  const [showSendMenu, setShowSendMenu] = useState(false);
  // Upload approved BRD (workflow): file + optional title
  const [expandedBrdIds, setExpandedBrdIds] = useState<Set<string>>(new Set());
  const [brdDialogTab, setBrdDialogTab] = useState("select");
  const [settingsDialogOpen, setSettingsDialogOpen] = useState(false);

  // Local state for settings dialog (temporary values while editing)
  const [tempCouncilMode, setTempCouncilMode] = useState<"single" | "council">(
    "single",
  );
  const [tempAiEnhanceEnabled, setTempAiEnhanceEnabled] = useState(false);
  const [tempLlmTemperature, setTempLlmTemperature] = useState(0.7);
  const [tempUseGoldenRepo, setTempUseGoldenRepo] = useState(true);



  // LLM Council state
  const [councilMode, setCouncilMode] = useState<"single" | "council">(
    "single",
  );
  const [councilResponses, setCouncilResponses] = useState<
    Array<{
      id: string;
      provider: string;
      model: string;
      response: any;
      confidence: number;
      coverage: number;
      consistency: number;
      timestamp: Date;
    }>
  >([]);
  const [chairEvaluation, setChairEvaluation] = useState<{
    selectedResponseId: string;
    reasoning: string;
    confidenceScore: number;
    evaluationDetails: any;
  } | null>(null);
  const [councilStep, setCouncilStep] = useState<string>("");
  // RAG integration is handled directly via API calls in handleGenerateArtifacts

  // Cache for BRD requirements: Map<brdId, { requirements, selectedIds, error }>
  // Using ref to avoid triggering re-renders when cache updates
  const brdRequirementsCacheRef = useRef<
    Map<
      string,
      {
        requirements: Array<{
          id: string;
          requirementName: string;
          description: string | null;
          status: string;
        }>;
        selectedIds: string[];
        error: string | null;
        brdUpdatedAt: string | null;
      }
    >
  >(new Map());
  // Track last fetched projectId to ensure refetch on mount or projectId change
  const lastFetchedProjectIdRef = useRef<string | null>(null);

  // Persist Step 1 chat history to server so it is restored when user returns to Step 1 or resumes session
  const persistStep1ChatHistory = useCallback(async () => {
    if (!sessionId) return;
    try {
      await apiRequest("POST", `/api/sessions/${sessionId}/workflow-steps/1`, {
        stepName: "conversational_refinement",
        step1Data: {
          conversationHistory: conversationMessages.map((m) => {
            const t = (m as { timestamp?: Date | string }).timestamp;
            return {
              role: m.role,
              content: m.content,
              timestamp:
                t instanceof Date
                  ? t.toISOString()
                  : typeof t === "string"
                    ? t
                    : undefined,
            };
          }),
          capturedRequirements,
          currentPhase: conversationPhase,
          askedQuestions,
          requirement: requirement || undefined,
          complianceGuidelines:
            complianceGuidelines?.map((g) => ({
              id: g.id,
              name: g.name,
              content: g.content,
            })) ?? [],
        },
      });
    } catch (e) {
      console.warn("[Workflow] Failed to persist Step 1 chat history:", e);
    }
  }, [
    sessionId,
    conversationMessages,
    capturedRequirements,
    conversationPhase,
    askedQuestions,
    requirement,
    complianceGuidelines,
  ]);

  // Session identity: works for both MSAL (Azure) and Amplify (AWS)
  const { accounts } = useMsal();
  const sessionIdentity = useSessionIdentity();
  const msalIdentity = getSessionUserIdentity(accounts[0] ?? null);

  // When Step 1 mounts with empty conversation, restore from server so chat history persists when returning or after refresh.
  // Only fetch when we have session identity; send identity via headers explicitly so we don't rely on the API interceptor (avoids 401 when interceptor has no account).
  useEffect(() => {
    if (conversationMessages.length > 0 || !sessionId || !sessionIdentity)
      return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          getApiUrl(`/api/sessions/${sessionId}/workflow-steps`),
          {
            method: "GET",
            credentials: "include",
            headers: {
              "X-AAD-Object-ID": sessionIdentity.aadObjectId,
              "X-User-Email": sessionIdentity.userEmail,
              "X-User-Name": sessionIdentity.userName,
            },
          },
        );
        if (!res.ok || cancelled) {
          if (!res.ok && !cancelled) {
            const errBody = await res.json().catch(() => ({}));
            const errMsg =
              (errBody as { error?: string }).error ?? res.statusText;
            if (
              res.status === 403 ||
              /session not found|access denied/i.test(String(errMsg))
            ) {
              setSessionId("");
            }
          }
          return;
        }
        const data = await res.json();
        const step1 = data?.step1Data;
        if (!step1?.conversationHistory?.length) return;
        const history = step1.conversationHistory as Array<{
          role: "user" | "assistant";
          content: string;
          timestamp?: string;
        }>;
        setConversationMessages(
          history.map((m) => ({
            id: nanoid(),
            role: m.role,
            content: m.content,
            timestamp: m.timestamp ? new Date(m.timestamp) : new Date(),
          })),
        );
        if (
          step1.capturedRequirements &&
          Object.keys(step1.capturedRequirements).length > 0
        ) {
          setCapturedRequirements(step1.capturedRequirements);
        }
        if (step1.currentPhase) setConversationPhase(step1.currentPhase);
        if (Array.isArray(step1.askedQuestions))
          setAskedQuestions(step1.askedQuestions);
        if (step1.requirement) setRequirement(step1.requirement);
      } catch (e) {
        const err = e as {
          message?: string;
          details?: {
            error?: string;
            response?: { data?: { error?: string } };
          };
          httpStatus?: number;
          code?: string;
        };
        const msg = err?.message ?? "";
        const serverMsg =
          err?.details?.error ?? err?.details?.response?.data?.error ?? "";
        const isSessionDenied =
          err?.httpStatus === 403 ||
          err?.code === "FORBIDDEN" ||
          /session not found|access denied/i.test(String(msg)) ||
          /session not found|access denied/i.test(String(serverMsg));
        if (isSessionDenied && !cancelled) {
          setSessionId("");
        }
        console.warn("[Workflow] Failed to restore Step 1 chat history:", e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    sessionId,
    sessionIdentity?.aadObjectId,
    conversationMessages.length,
    setConversationMessages,
    setCapturedRequirements,
    setConversationPhase,
    setAskedQuestions,
    setRequirement,
    setSessionId,
  ]);

  // Initialize conversation with welcome message or regeneration message
  useEffect(() => {
    if (conversationMessages.length === 0) {
      let welcomeContent: string;

      if (isRegenerating && originalRequirement) {
        // Regeneration scenario - show original requirement
        welcomeContent = `I see you'd like to regenerate the artifacts! 🔄\n\nHere's your original requirement:\n\n**"${originalRequirement}"**\n\nWould you like to:\n1. **Modify this requirement** - Make changes before regenerating\n2. **Proceed as-is** - Generate artifacts with the same requirement\n3. **Start completely fresh** - Enter a new requirement\n\nWhat would you like to do?`;
      } else {
        // Normal first-time flow
        welcomeContent = `Hello! I'm Tia Bot, your agile backlog assistant.\n\nI'll help you create detailed epics, user stories, and tasks through a collaborative conversation. I'll ask thoughtful questions to understand your project deeply, building on everything you share to create high-quality, actionable artifacts.\n\nReady to get started? Tell me about your project!`;
      }

      const welcomeMessage: ConversationMessage = {
        id: nanoid(),
        role: "assistant",
        content: welcomeContent,
        timestamp: new Date(),
      };
      addConversationMessage(welcomeMessage);

      // Set quick replies for regeneration mode
      if (isRegenerating && originalRequirement) {
        setQuickReplies(["Modify requirement", "Proceed as-is", "Start fresh"]);
      }
    }
  }, [
    conversationMessages.length,
    addConversationMessage,
    isRegenerating,
    originalRequirement,
  ]);

  // Extract processed file requirements from conversation messages whenever they change (fallback)
  // Primary source is server response, but this ensures we capture it even if response parsing fails
  useEffect(() => {
    // Look for "Processed Document Requirements (BRD Format)" in any user message
    for (const msg of conversationMessages) {
      if (
        msg.role === "user" &&
        msg.content.includes("Processed Document Requirements")
      ) {
        // Extract the processed requirements section
        // Server format: **Processed Document Requirements (BRD Format):**\n\n[requirements]\n\n---
        // Try multiple patterns to handle different formatting
        let match = msg.content.match(
          /\*\*Processed Document Requirements \(BRD Format\):\*\*\s*\n\n([\s\S]*?)(?:\n\n---|\n\n\*\*|$)/,
        );
        if (!match) {
          // Try without markdown formatting
          match = msg.content.match(
            /Processed Document Requirements \(BRD Format\):\s*\n\n([\s\S]*?)(?:\n\n---|\n\n\*\*|$)/,
          );
        }
        if (!match) {
          // Try to get everything after the header until end of message or next section
          const headerIndex = msg.content.indexOf(
            "Processed Document Requirements (BRD Format)",
          );
          if (headerIndex >= 0) {
            const afterHeader = msg.content.substring(headerIndex);
            // Match everything after ":**\n\n" until end or next section marker
            const contentMatch = afterHeader.match(
              /:\*\*\s*\n\n([\s\S]*?)(?:\n\n---|\n\n\*\*|$)/,
            );
            if (contentMatch) {
              match = contentMatch;
            } else {
              // Last resort: get everything after the colon
              const colonIndex = afterHeader.indexOf(":**");
              if (colonIndex >= 0) {
                const afterColon = afterHeader.substring(colonIndex + 3).trim();
                if (afterColon.length > 0) {
                  // Create a match-like array
                  const fakeMatch: RegExpMatchArray = [
                    "",
                    afterColon,
                  ] as RegExpMatchArray;
                  match = fakeMatch;
                }
              }
            }
          }
        }

        if (match && match[1]) {
          const extractedRequirements = match[1].trim();
          if (extractedRequirements.length > 0) {
            console.log(
              "[Workflow] Extracted processed file requirements from conversation (fallback), length:",
              extractedRequirements.length,
            );
            console.log(
              "[Workflow] Extracted requirements preview (first 200 chars):",
              extractedRequirements.substring(0, 200),
            );
            setProcessedFileRequirements(extractedRequirements);
            return; // Found it, no need to check other messages
          }
        }
      }
    }
  }, [conversationMessages]);

  // Get brdId from URL params (passed when redirecting from BRD approval)
  const search = useSearch();
  const urlParams = new URLSearchParams(search);
  const urlBrdId = urlParams.get("brdId");

  // BRD fetching is now done only when user clicks "Select BRD" button
  // The fetch happens in the useEffect below when brdDialogOpen becomes true

  // Fetch BRDs when dialog opens (user clicks "Select BRD" button)
  useEffect(() => {
    if (brdDialogOpen) {
      const pid = projectId || sdlcProjectId;

      // Force refresh when reopening modal so recently edited/approved BRDs
      // do not reuse stale requirement snapshots.
      brdRequirementsCacheRef.current.clear();

      console.log(
        "[Workflow][BRD Fetch] Dialog opened, fetching BRDs for projectId:",
        pid,
      );

      // Only proceed if projectId is valid and present
      if (!pid || pid.trim() === "") {
        console.log("[Workflow][BRD Fetch] No valid projectId available");
        setBrdVersions([]);
        setBrdVersionsLoading(false);
        return;
      }

      // Fetch BRDs when dialog opens (excluding draft and review)
      const fetchAvailableBrds = async (retryCount = 0) => {
        try {
          console.log(
            "[Workflow][BRD Fetch] Starting fetch for projectId:",
            pid,
            `(retry: ${retryCount})`,
          );
          setBrdVersionsLoading(true);
          const res = await apiRequest(
            "GET",
            `/api/dev-brd/approved?projectId=${encodeURIComponent(pid)}`,
          );
          const data = await res.json();

          console.log("[Workflow][BRD Fetch] API response:", {
            ok: res.ok,
            status: res.status,
            dataLength: Array.isArray(data) ? data.length : 0,
            data: Array.isArray(data)
              ? data.map((brd: any) => ({
                  id: brd.id,
                  title: brd.title,
                  status: brd.status,
                  hasStatus: !!brd.status,
                }))
              : data,
          });

          // Debug: Log first BRD's status if available
          if (Array.isArray(data) && data.length > 0) {
            console.log(
              "[Workflow][BRD Fetch] First BRD status:",
              data[0]?.status,
              "Type:",
              typeof data[0]?.status,
              "Full object:",
              data[0],
            );
          }

          if (res.ok && Array.isArray(data)) {
            setBrdVersions(data);

            // If we have a urlBrdId, try to select it
            let brdToSelect: string | null = null;

            if (urlBrdId) {
              // Check if the URL brdId exists in the fetched list
              const foundBrd = data.find((brd: any) => brd.id === urlBrdId);
              if (foundBrd) {
                brdToSelect = urlBrdId;
                console.log(
                  "[Workflow][BRD Fetch] Found URL brdId in available list:",
                  urlBrdId,
                );
                setSelectedBrdId(brdToSelect);
                setBrdId(brdToSelect);
              }
            }

            console.log("[Workflow][BRD Fetch] Successfully loaded BRDs:", {
              count: data.length,
              selectedBrdId: brdToSelect,
              urlBrdId,
              brdTitles: data.map((brd: any) => brd.title),
            });
          } else {
            console.warn("[Workflow][BRD Fetch] Invalid response format:", {
              res,
              data,
            });
            setBrdVersions([]);
          }
        } catch (error) {
          console.error(
            "[Workflow][BRD Fetch] Failed to load available BRDs:",
            {
              error,
              projectId: pid,
              errorMessage:
                error instanceof Error ? error.message : String(error),
              stack: error instanceof Error ? error.stack : undefined,
            },
          );
          setBrdVersions([]);
        } finally {
          setBrdVersionsLoading(false);
        }
      };

      fetchAvailableBrds();
    }
  }, [brdDialogOpen, projectId, sdlcProjectId, urlBrdId]);

  // Load requirements for the selected BRD (STRICTLY by brd_id)
  // Uses cache to avoid re-fetching requirements that have already been loaded
  // This effect runs whenever selectedBrdId changes
  useEffect(() => {
    const pid = projectId || sdlcProjectId;

    // Reset state immediately when BRD changes or becomes null
    if (!selectedBrdId || !pid) {
      if (!pid && selectedBrdId) {
        console.warn(
          "[Workflow][BRD Requirements] ⚠️ Project context missing - requirements fetch SKIPPED. " +
            "Ensure projectId or sdlcProjectId is in the URL/context. " +
            "Current: projectId =",
          projectId,
          ", sdlcProjectId =",
          sdlcProjectId,
          ", selectedBrdId =",
          selectedBrdId,
        );
      }
      setBrdRequirements([]);
      setSelectedRequirementIds([]);
      setCtxSelectedRequirementIds([]);
      setBrdRequirementsError(null);
      setBrdRequirementsLoading(false);
      return;
    }

    console.log(
      "[Workflow][BRD Requirements] Project context OK: projectId =",
      projectId,
      ", sdlcProjectId =",
      sdlcProjectId,
      ", using pid =",
      pid,
    );

    const selectedBrdVersion = brdVersions.find((v) => v.id === selectedBrdId);
    const selectedBrdUpdatedAt = selectedBrdVersion?.updated_at ?? null;

    // Check cache first - if requirements are already fetched, use cached data
    const cached = brdRequirementsCacheRef.current.get(selectedBrdId);
    if (cached && cached.brdUpdatedAt === selectedBrdUpdatedAt) {
      console.log(
        "[Workflow] Using cached requirements for BRD",
        selectedBrdId,
        "count:",
        cached.requirements.length,
      );
      setBrdRequirements(cached.requirements);
      // Restore previously selected requirements from cache
      // If cache has selections, use them; otherwise auto-select all
      const cachedSelections = cached.selectedIds || [];
      const selectionsToUse =
        cachedSelections.length > 0
          ? cachedSelections
          : cached.requirements.map((req: any) => req.id);
      setSelectedRequirementIds(selectionsToUse);
      setCtxSelectedRequirementIds(selectionsToUse);
      setBrdRequirementsError(cached.error);
      setBrdRequirementsLoading(false);
      return;
    }

    if (cached && cached.brdUpdatedAt !== selectedBrdUpdatedAt) {
      brdRequirementsCacheRef.current.delete(selectedBrdId);
    }

    // Track the current BRD ID to prevent race conditions
    let isCancelled = false;
    const currentBrdId = selectedBrdId;

    // Clear previous requirements immediately when BRD changes (only if not cached)
    setBrdRequirements([]);
    setSelectedRequirementIds([]);
    setCtxSelectedRequirementIds([]);
    setBrdRequirementsError(null);

    // Fetch requirements STRICTLY by brd_id (only if not in cache)
    const fetchRequirements = async () => {
      try {
        setBrdRequirementsLoading(true);

        console.log(
          "[Workflow] Fetching requirements for BRD:",
          currentBrdId,
          "projectId:",
          pid,
        );

        const requirementsUrl = getApiUrl(
          `/api/dev-brd/${encodeURIComponent(
            currentBrdId,
          )}/requirements?projectId=${encodeURIComponent(pid)}&t=${Date.now()}`,
        );
        const res = await fetch(requirementsUrl, {
          method: "GET",
          credentials: "include",
          cache: "no-store",
        });

        // Check if this request is still relevant (BRD hasn't changed)
        if (isCancelled || currentBrdId !== selectedBrdId) {
          return;
        }

        if (!res.ok) {
          const errorData = await res
            .json()
            .catch(() => ({ error: "Unknown error" }));
          const errorMessage =
            errorData.error ||
            errorData.details ||
            `HTTP ${res.status}: Failed to fetch requirements`;
          console.error(
            "[Workflow] Failed to fetch requirements:",
            res.status,
            errorMessage,
            errorData,
          );
          throw new Error(errorMessage);
        }

        const data = await res.json();

        console.log(
          "[Workflow] Received requirements data:",
          Array.isArray(data) ? `${data.length} items` : typeof data,
          data,
        );

        // Double-check BRD hasn't changed during async operation
        if (isCancelled || currentBrdId !== selectedBrdId) {
          return;
        }

        if (Array.isArray(data)) {
          let normalizedData = data;

          // If upload just happened and no requirements are visible yet,
          // trigger on-demand extraction once, then refetch immediately.
          if (normalizedData.length === 0) {
            try {
              const extractRes = await fetch(
                getApiUrl(
                  `/api/dev-brd/${encodeURIComponent(
                    currentBrdId,
                  )}/extract-requirements?projectId=${encodeURIComponent(pid)}`,
                ),
                {
                  method: "POST",
                  credentials: "include",
                },
              );
              if (extractRes.ok) {
                const retryRes = await fetch(requirementsUrl, {
                  method: "GET",
                  credentials: "include",
                  cache: "no-store",
                });
                if (retryRes.ok) {
                  const retryData = await retryRes.json().catch(() => []);
                  if (Array.isArray(retryData)) {
                    normalizedData = retryData;
                  }
                }
              }
            } catch (extractErr) {
              console.warn(
                "[Workflow] Requirement extraction retry failed for BRD",
                currentBrdId,
                extractErr,
              );
            }
          }

          setBrdRequirements(normalizedData);

          // AUTO-SELECT all requirements for better UX and ensure requirementIds are populated
          // Users can still manually deselect if needed
          const allRequirementIds = normalizedData.map((req: any) => req.id);
          setSelectedRequirementIds(allRequirementIds);
          setCtxSelectedRequirementIds(allRequirementIds);

          // Store in cache for future use with auto-selected IDs
          brdRequirementsCacheRef.current.set(currentBrdId, {
            requirements: normalizedData,
            selectedIds: allRequirementIds, // Auto-select all by default
            error: null,
            brdUpdatedAt: selectedBrdUpdatedAt,
          });

          console.log(
            "[Workflow] Successfully loaded",
            normalizedData.length,
            "requirement(s) for BRD",
            currentBrdId,
            `(${allRequirementIds.length} auto-selected)`,
          );
        } else {
          setBrdRequirements([]);
          setSelectedRequirementIds([]);
          setCtxSelectedRequirementIds([]);
          // Do NOT cache empty - allows retry on next expand (server may do on-demand extraction)
        }
      } catch (error) {
        // Only update state if this request is still relevant
        if (isCancelled || currentBrdId !== selectedBrdId) {
          return;
        }

        console.error(
          "[Workflow] Failed to load BRD requirements for BRD",
          currentBrdId,
          error,
        );
        // Always show the same non-blocking error message (don't expose API details)
        const errorMessage = "Unable to load requirements for this BRD";
        setBrdRequirementsError(errorMessage);
        setBrdRequirements([]);
        setSelectedRequirementIds([]);
        setCtxSelectedRequirementIds([]);

        // Cache error state
        brdRequirementsCacheRef.current.set(currentBrdId, {
          requirements: [],
          selectedIds: [],
          error: errorMessage,
          brdUpdatedAt: selectedBrdUpdatedAt,
        });
      } finally {
        // Only update loading state if this request is still relevant
        if (!isCancelled && currentBrdId === selectedBrdId) {
          setBrdRequirementsLoading(false);
        }
      }
    };

    fetchRequirements();

    // Cleanup: mark as cancelled when BRD changes or component unmounts
    return () => {
      isCancelled = true;
    };
  }, [selectedBrdId, projectId, sdlcProjectId, brdVersions]);

  // Auto-expand BRD when it's selected
  // Rule: Selected BRD MUST be expanded
  useEffect(() => {
    if (selectedBrdId) {
      setExpandedBrdIds((prev) => {
        const next = new Set(prev);
        // Always expand the selected BRD
        next.add(selectedBrdId);
        return next;
      });
    }
  }, [selectedBrdId]);

  // When a BRD is selected (via "Select BRD"), immediately show the
  // mode-selection quick replies so the user can choose Guided vs Intelligent.
  useEffect(() => {
    if (selectedBrdId) {
      // Only show when there's at least the assistant welcome message present
      if (conversationMessages && conversationMessages.length >= 1) {
        // Only show Option 1 when BRD is selected but not attached
        // Option 2 will be shown only when BRD is actually attached
        setQuickReplies(["Option 1: Guide me through questions"]);
        setIsSingleSelect(true);
        setConversationPhase && setConversationPhase("mode-selection");
      }
    }
  }, [selectedBrdId]);

  const handleToggleRequirement = (
    id: string,
    checked: boolean | "indeterminate",
  ) => {
    setSelectedRequirementIds((prev: string[]) => {
      let next: string[];
      if (checked === true) {
        if (prev.includes(id)) return prev;
        next = [...prev, id];
      } else {
        next = prev.filter((rid: string) => rid !== id);
      }

      // Keep workflow context in sync so later steps (e.g. push to ADO)
      // know exactly which requirements were selected.
      setCtxSelectedRequirementIds(next);

      // Update cache with new selection state for current BRD
      if (selectedBrdId) {
        const cached = brdRequirementsCacheRef.current.get(selectedBrdId);
        if (cached) {
          brdRequirementsCacheRef.current.set(selectedBrdId, {
            ...cached,
            selectedIds: next,
          });
        }
      }

      return next;
    });
  };

  // Handler to select/deselect all requirements
  const handleSelectAllRequirements = (checked: boolean) => {
    if (checked) {
      // Select all requirements
      const allIds = brdRequirements.map((req) => req.id);
      setSelectedRequirementIds(allIds);
      setCtxSelectedRequirementIds(allIds);

      // Update cache
      if (selectedBrdId) {
        const cached = brdRequirementsCacheRef.current.get(selectedBrdId);
        if (cached) {
          brdRequirementsCacheRef.current.set(selectedBrdId, {
            ...cached,
            selectedIds: allIds,
          });
        }
      }
    } else {
      // Deselect all requirements
      setSelectedRequirementIds([]);
      setCtxSelectedRequirementIds([]);

      // Update cache
      if (selectedBrdId) {
        const cached = brdRequirementsCacheRef.current.get(selectedBrdId);
        if (cached) {
          brdRequirementsCacheRef.current.set(selectedBrdId, {
            ...cached,
            selectedIds: [],
          });
        }
      }
    }
  };

  // Check if all requirements are selected
  const areAllRequirementsSelected =
    brdRequirements.length > 0 &&
    brdRequirements.every((req) => selectedRequirementIds.includes(req.id));

  // Check if some (but not all) requirements are selected (for indeterminate state)
  const areSomeRequirementsSelected =
    selectedRequirementIds.length > 0 && !areAllRequirementsSelected;

  // Sort requirements by their numeric identifier (e.g., FR-007 -> 7, FR-002 -> 2)
  const sortedBrdRequirements = useMemo(() => {
    return [...brdRequirements].sort((a, b) => {
      // Extract numeric part from requirementName (e.g., "FR-007" -> 7)
      const extractNumber = (name: string): number => {
        const match = name.match(/(\d+)$/); // Match digits at the end
        return match ? parseInt(match[1], 10) : 0;
      };

      const numA = extractNumber(a.requirementName);
      const numB = extractNumber(b.requirementName);

      // If both have numbers, sort numerically
      if (numA !== 0 && numB !== 0) {
        return numA - numB;
      }

      // If one has a number and the other doesn't, numbers come first
      if (numA !== 0) return -1;
      if (numB !== 0) return 1;

      // If neither has a number, sort alphabetically
      return a.requirementName.localeCompare(b.requirementName);
    });
  }, [brdRequirements]);

  // Synchronized BRD expansion and selection
  const toggleBrdExpansion = (brdId: string) => {
    setExpandedBrdIds((prev) => {
      const next = new Set(prev);
      const isCurrentlyExpanded = next.has(brdId);

      if (isCurrentlyExpanded) {
        // Collapsing: remove from expanded set but keep selection
        next.delete(brdId);
      } else {
        // Expanding: add to expanded set AND auto-select this BRD
        next.add(brdId);
        setSelectedBrdId(brdId);
      }
      return next;
    });
  };

  // Handler for BRD selection that ensures expansion
  const handleBrdSelection = (brdId: string) => {
    setSelectedBrdId(brdId);
    // Expansion will be handled by the useEffect, but ensure it's immediate
    setExpandedBrdIds((prev) => {
      const next = new Set(prev);
      next.add(brdId);
      return next;
    });
  };

  const handleSendMessage = async (
    message: string,
    attachments?: ConversationMessage["attachments"],
  ) => {
    // Validate input for manual messages (not from attachments)
    if (!attachments && isInvalidInput(message)) {
      toast({
        title: "Invalid Input Detected",
        description: "Please provide a meaningful project description.",
        variant: "destructive",
      });

      // Focus on input for correction
      if (textareaRef.current) {
        textareaRef.current.focus();
      }
      return;
    }

    // If a BRD was previously attached, allow the conversation flow to resume
    // showing suggestion buttons again when the user provides new input.
    if (brdAttached) {
      setBrdAttached(false);
    }
    // Capture user's first substantive requirement for regeneration display
    // Only save if we don't have one yet and this isn't a greeting
    const isSubstantive =
      message.trim().length > 20 &&
      !message
        .toLowerCase()
        .match(
          /^(hi|hello|hey|greetings?|good (morning|afternoon|evening))[\s,!.?]*$/i,
        );

    if (
      isSubstantive &&
      conversationMessages.length >= 1 &&
      conversationMessages.length <= 3 &&
      !userRequirementSummary
    ) {
      setUserRequirementSummary(message);
    }

    // Clear selected quick replies after sending
    setSelectedQuickReplies([]);

    // Add user message to conversation
    const userMessage: ConversationMessage = {
      id: nanoid(),
      role: "user",
      content: message,
      timestamp: new Date(),
      attachments,
    };
    addConversationMessage(userMessage);

    // Call conversation API with the new message included
    // (quick replies will be cleared in getNextQuestion)
    await getNextQuestion(userMessage);
  };

  const isGenerateArtifactsIntent = (text: string): boolean => {
    const normalized = text.trim().toLowerCase();
    if (!normalized) return false;

    const compact = normalized
      .replace(/[^a-z0-9\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (!compact) return false;

    const tokens = compact.split(" ").filter(Boolean);
    const exactGenerateWords = new Set(["generate", "create", "build", "make"]);
    const exactArtifactWords = new Set([
      "artifact",
      "artifacts",
      "epic",
      "epics",
      "feature",
      "features",
      "story",
      "stories",
      "userstory",
      "userstories",
    ]);

    const levenshteinDistance = (a: string, b: string): number => {
      if (a === b) return 0;
      if (!a.length) return b.length;
      if (!b.length) return a.length;

      const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
      for (let i = 1; i <= a.length; i++) {
        let diag = prev[0];
        prev[0] = i;
        for (let j = 1; j <= b.length; j++) {
          const temp = prev[j];
          const cost = a[i - 1] === b[j - 1] ? 0 : 1;
          prev[j] = Math.min(
            prev[j] + 1, // deletion
            prev[j - 1] + 1, // insertion
            diag + cost, // substitution
          );
          diag = temp;
        }
      }
      return prev[b.length];
    };

    const isApproxWord = (
      word: string,
      target: string,
      maxDistance: number,
    ): boolean => {
      if (Math.abs(word.length - target.length) > maxDistance) return false;
      return levenshteinDistance(word, target) <= maxDistance;
    };

    const hasGenerateVerb = tokens.some((token) => {
      if (exactGenerateWords.has(token)) return true;
      if (token.startsWith("generat") || token.startsWith("genear"))
        return true;
      return (
        isApproxWord(token, "generate", 2) ||
        isApproxWord(token, "create", 1) ||
        isApproxWord(token, "build", 1)
      );
    });

    const hasArtifactTarget = tokens.some((token) => {
      if (exactArtifactWords.has(token)) return true;
      if (token.startsWith("artifact") || token.startsWith("artifc"))
        return true;
      return (
        isApproxWord(token, "artifact", 2) ||
        isApproxWord(token, "artifacts", 2)
      );
    });

    const directPhraseMatch =
      compact.includes("generate artifacts") ||
      compact.includes("generate artifact") ||
      compact.includes("generate directly");

    return directPhraseMatch || (hasGenerateVerb && hasArtifactTarget);
  };

  const handleQuickReply = async (reply: string) => {
    // Check if this is a basic informational reply that should auto-send
    const isBasicInformationalReply =
      reply.toLowerCase().includes("building a web application") ||
      reply.toLowerCase().includes("creating a mobile app") ||
      reply.toLowerCase().includes("system integration project") ||
      reply.toLowerCase().includes("enhancing existing software") ||
      /^(building|creating|developing|enhancing)/i.test(reply.trim()) ||
      /application$/i.test(reply.trim()) ||
      /project$/i.test(reply.trim());

    // Check if this is a generation trigger reply - enhanced detection
    const isGenerationTrigger =
      reply.toLowerCase().includes("yes, generate") ||
      isGenerateArtifactsIntent(reply) ||
      reply.toLowerCase().includes("generate directly") ||
      reply.toLowerCase() === "yes" ||
      // Handle variations with "good", "no", "pls/please"
      (reply.toLowerCase().includes("im good") &&
        reply.toLowerCase().includes("generate")) ||
      (reply.toLowerCase().includes("i'm good") &&
        reply.toLowerCase().includes("generate")) ||
      (reply.toLowerCase().includes("no") &&
        reply.toLowerCase().includes("generate")) ||
      (reply.toLowerCase().includes("pls") &&
        reply.toLowerCase().includes("generate")) ||
      (reply.toLowerCase().includes("please") &&
        reply.toLowerCase().includes("generate")) ||
      // Regex patterns for complex phrases
      /^no.*(generate|create|build)\s*(artifacts?|directly|now)?/i.test(
        reply.trim(),
      ) ||
      /(im|i'm)\s+good.*(generate|create|build)/i.test(reply.trim());

    if (isGenerationTrigger) {
      // Clear quick replies and trigger artifact generation
      setQuickReplies([]);
      setSelectedQuickReplies([]);
      // Add a user message to show the selection
      const userMessage: ConversationMessage = {
        id: nanoid(),
        role: "user",
        content: reply,
        timestamp: new Date(),
      };
      addConversationMessage(userMessage);

      // Start artifact generation
      setTimeout(() => {
        handleGenerateArtifacts();
      }, 500);
      return;
    }

    if (isBasicInformationalReply) {
      // Auto-send basic informational replies
      const userMessage: ConversationMessage = {
        id: nanoid(),
        role: "user",
        content: reply,
        timestamp: new Date(),
      };
      addConversationMessage(userMessage);

      // Auto-trigger conversation continuation
      await getNextQuestion(userMessage);
      return;
    }

    // For other quick replies, add to selected replies or handle appropriately
    // If single-select mode, send immediately (like old behavior)
    if (isSingleSelect) {
      setQuickReplies([]);
      setSelectedQuickReplies([]);
      await handleSendMessage(reply);
      return;
    }

    // Otherwise, toggle selection for multi-select
    setSelectedQuickReplies((prev) => {
      if (prev.includes(reply)) {
        // Deselect if already selected
        return prev.filter((r) => r !== reply);
      } else {
        // Add to selection
        return [...prev, reply];
      }
    });
  };

  const handleAttachBrdToWorkflow = async () => {
    if (!projectId && !sdlcProjectId) {
      toast({
        title: "Project required",
        description: "Select a project before attaching a BRD.",
        variant: "destructive",
      });
      return;
    }
    if (!selectedBrdId) {
      toast({
        title: "No BRD selected",
        description: "Choose a BRD to attach.",
      });
      return;
    }
    if (selectedRequirementIds.length === 0) {
      toast({
        title: "No requirements selected",
        description: "Select at least one requirement before attaching a BRD.",
      });
      return;
    }

    try {
      setAttachLoading(true);
      // Do not create a session from Step 1 — sessions are only created when user proceeds to Generate Artifacts (Step 2).
      // Just mark BRD as selected; it will be linked to the session when they click Generate Artifacts.
      if (!sessionIdentity) {
        setAttachLoading(false);
        toast({
          title: "Sign in required",
          description: "Sign in to attach a BRD.",
          variant: "destructive",
        });
        return;
      }
      const attachedBrd = brdVersions.find((v) => v.id === selectedBrdId);
      setBrdAttached(true);
      setAttachStatus(
        `BRD "${attachedBrd?.title || "Unknown"}" selected — will be linked when you generate artifacts`,
      );
      toast({
        title: "BRD selected",
        description:
          "BRD will be linked to your workflow when you click Generate Artifacts. No session is saved until then.",
      });
      setBrdDialogOpen(false);

      // Show the option buttons when BRD is attached
      setQuickReplies([
        "Option 1: Guide me through questions",
        "Option 2: Generate artifacts directly",
      ]);
      setIsSingleSelect(true);
    } catch (error: any) {
      toast({
        title: "Attach failed",
        description:
          error instanceof Error ? error.message : "Unable to attach BRD.",
        variant: "destructive",
      });
    } finally {
      setAttachLoading(false);
      }
  };

  // Handler to generate directly from attached BRD without showing suggestions
  const handleGenerateFromBrd = async () => {
    try {
      // Clear any quick replies or choice dialogs
      setQuickReplies([]);
      setShowChoiceDialog(false);
      // Directly call the existing artifact generation flow
      await handleGenerateArtifacts();
    } catch (err) {
      console.error("Error generating from BRD:", err);
      toast({
        title: "Generation Failed",
        description: "Could not generate artifacts from BRD.",
        variant: "destructive",
      });
    }
  };

  const getNextQuestion = async (latestUserMessage: ConversationMessage) => {
    try {
      setIsConversationLoading(true);
      // Clear previous quick replies immediately when fetching new question
      setQuickReplies([]);

      // Handle regeneration mode user choices
      if (isRegenerating && conversationMessages.length === 1) {
        const userChoice = latestUserMessage.content.toLowerCase();

        if (
          userChoice.includes("proceed") ||
          userChoice.includes("as-is") ||
          userChoice === "2"
        ) {
          // User wants to proceed with original requirement
          setRequirement(originalRequirement);
          setIsRegenerating(false);

          // Start conversation flow with original requirement
          const userReqMessage: ConversationMessage = {
            id: nanoid(),
            role: "user",
            content: originalRequirement,
            timestamp: new Date(),
          };
          addConversationMessage(userReqMessage);

          // Let the agent process it normally
          await getNextQuestion(userReqMessage);
          return;
        } else if (userChoice.includes("modify") || userChoice === "1") {
          // User wants to modify - ask them to provide updated requirement
          setIsRegenerating(false);

          const modifyMessage: ConversationMessage = {
            id: nanoid(),
            role: "assistant",
            content: `Great! Please share your updated requirement. You can modify the original or provide completely new details.`,
            timestamp: new Date(),
          };
          addConversationMessage(modifyMessage);
          setIsConversationLoading(false);
          return;
        } else if (
          userChoice.includes("fresh") ||
          userChoice.includes("new") ||
          userChoice === "3"
        ) {
          // Start completely fresh
          setIsRegenerating(false);
          setRequirement("");

          const freshMessage: ConversationMessage = {
            id: nanoid(),
            role: "assistant",
            content: `Perfect! Let's start fresh. What would you like to build?`,
            timestamp: new Date(),
          };
          addConversationMessage(freshMessage);
          setIsConversationLoading(false);
          return;
        }
      }

      // Prepare conversation history for API - INCLUDE the latest user message
      const conversationHistory = [
        ...conversationMessages.map((msg) => ({
          role: msg.role,
          content: msg.content,
        })),
        {
          role: latestUserMessage.role,
          content: latestUserMessage.content,
        },
      ];

      // Prepare file attachments if present in the latest message
      const fileAttachments =
        latestUserMessage.attachments?.filter((att) => att.content) || [];

      // If a BRD is attached to the workflow, fetch its content and include it as a file attachment
      if (brdAttached && selectedBrdId && fileAttachments.length === 0) {
        try {
          console.log(
            "[Workflow] Fetching BRD content for attached BRD:",
            selectedBrdId,
          );
          const brdRes = await apiRequest(
            "GET",
            `/api/brd/${selectedBrdId}/content`,
          );
          const brdData = await brdRes.json();

          if (brdData.success && brdData.content) {
            // Convert BRD content to base64 and add as file attachment
            const brdContentBase64 = btoa(
              unescape(encodeURIComponent(brdData.content)),
            );
            const brdAttachment = {
              name: `BRD-${selectedBrdId}.txt`,
              type: "text/plain",
              size: brdData.content.length,
              content: brdContentBase64,
            };
            fileAttachments.push(brdAttachment);
            console.log(
              "[Workflow] Added BRD content as file attachment, length:",
              brdData.content.length,
            );
          } else {
            console.warn("[Workflow] Failed to fetch BRD content:", brdData);
          }
        } catch (error) {
          console.error("[Workflow] Error fetching BRD content:", error);
        }
      }

      // Call conversation API with askedQuestions to prevent repetition
      const res = await apiRequest("POST", "/api/workflow/conversation", {
        conversationHistory,
        capturedRequirements,
        currentPhase: conversationPhase,
        askedQuestions,
        isRegenerating,
        originalRequirement,
        projectId: projectId || sdlcProjectId,
        // If a BRD is attached, include its id so the backend can
        // include BRD context when generating the next question / quick replies.
        attachedBrdId: brdAttached ? selectedBrdId : undefined,
        // Include file attachments for processing
        fileAttachments:
          fileAttachments.length > 0
            ? fileAttachments.map((att) => ({
                name: att.name,
                type: att.type,
                content: att.content, // Base64 content
              }))
            : undefined,
      });

      const response: {
        question: string;
        phase: string;
        quickReplies?: string[];
        singleSelect?: boolean;
        capturedInfo?: any;
        readyToGenerate?: boolean;
        processedFileRequirements?: string; // Processed BRD functional requirements from file uploads
      } = await res.json();

      // Store processed file requirements if provided in response
      if (
        response.processedFileRequirements &&
        response.processedFileRequirements.trim().length > 0
      ) {
        console.log(
          "[Workflow] Received processed file requirements from server, length:",
          response.processedFileRequirements.length,
        );
        setProcessedFileRequirements(response.processedFileRequirements);
      }

      // Check if AI determined we have enough information to generate artifacts
      if (response.readyToGenerate) {
        // Add final message to conversation
        const finalMessage: ConversationMessage = {
          id: nanoid(),
          role: "assistant",
          content: response.question,
          timestamp: new Date(),
        };
        addConversationMessage(finalMessage);

        // Directly trigger artifact generation without showing dialog
        setTimeout(() => {
          handleGenerateArtifacts();
        }, 500);

        return; // Exit early, don't continue with normal flow
      }

      // Update phase if changed
      if (response.phase && response.phase !== conversationPhase) {
        setConversationPhase(response.phase as any);
      }

      // Update captured requirements if new info was extracted
      if (response.capturedInfo) {
        const updates: any = {};

        // Normalize function: convert objects to strings
        const normalizeItem = (item: any): string => {
          if (typeof item === "string") return item;
          if (typeof item === "object" && item !== null) {
            // Extract meaningful string from object
            return (
              item.persona ||
              item.name ||
              item.role ||
              item.description ||
              JSON.stringify(item)
            );
          }
          return String(item);
        };

        // Merge arrays for each field
        Object.entries(response.capturedInfo).forEach(([key, value]) => {
          if (Array.isArray(value) && value.length > 0) {
            const existing = (capturedRequirements as any)[key] || [];
            // Normalize new items to strings
            const normalizedNewItems = value.map(normalizeItem);
            // Add only new items (avoid duplicates) - now comparing strings
            const newItems = normalizedNewItems.filter(
              (item: string) => !existing.includes(item),
            );
            if (newItems.length > 0) {
              updates[key] = [...existing, ...newItems];
            }
          }
        });

        if (Object.keys(updates).length > 0) {
          updateCapturedRequirements(updates);
        }
      }

      // Set quick replies if provided
      if (response.quickReplies && response.quickReplies.length > 0) {
        setQuickReplies(response.quickReplies);
        setIsSingleSelect(response.singleSelect || false);
      }

      // Extract processed file requirements from conversation if present
      // Look for "Processed Document Requirements (BRD Format)" in any user message
      // Check all messages, not just the last one, in case it was added earlier
      for (const msg of conversationMessages) {
        if (
          msg.role === "user" &&
          msg.content.includes("Processed Document Requirements (BRD Format)")
        ) {
          // Extract the processed requirements section
          // Pattern matches: **Processed Document Requirements (BRD Format):**\n\n[requirements content]
          const match = msg.content.match(
            /\*\*Processed Document Requirements \(BRD Format\):\*\*\s*\n\n([\s\S]*?)(?:\n\n---|\n\n\*\*|$)/,
          );
          if (match && match[1]) {
            const extractedRequirements = match[1].trim();
            if (extractedRequirements.length > 0) {
              console.log(
                "[Workflow] Extracted processed file requirements from conversation, length:",
                extractedRequirements.length,
              );
              setProcessedFileRequirements(extractedRequirements);
              break; // Found it, no need to check other messages
            }
          }
        }
      }

      // Add AI response to conversation
      const aiMessage: ConversationMessage = {
        id: nanoid(),
        role: "assistant",
        content: response.question,
        timestamp: new Date(),
        quickReplies: response.quickReplies,
      };
      addConversationMessage(aiMessage);

      // Track this question to prevent repetition
      addAskedQuestion(response.question);
    } catch (error) {
      console.error("Error getting next question:", error);
      toast({
        title: "Error",
        description: "Failed to get next question. Please try again.",
        variant: "destructive",
      });

      // Add error message to conversation
      const errorMessage: ConversationMessage = {
        id: nanoid(),
        role: "assistant",
        content:
          "I apologize, but I encountered an error. Could you please try sending that again?",
        timestamp: new Date(),
      };
      addConversationMessage(errorMessage);
    } finally {
      setIsConversationLoading(false);
    }
  };

  // Store current jobId for cancellation
  const currentJobIdRef = useRef<string | null>(null);

  // Handler for canceling artifact generation
  const handleCancelGeneration = async () => {
    console.log(
      "[Workflow] Cancel button clicked - stopping polling and server generation",
    );

    // Mark polling as cancelled FIRST (before anything else)
    isPollingCancelledRef.current = true;
    setGenerationCancelled(true);

    // Abort all ongoing requests
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }

    // Clear any polling timeouts IMMEDIATELY
    if (pollingTimeoutRef.current) {
      clearTimeout(pollingTimeoutRef.current);
      pollingTimeoutRef.current = null;
    }

    // Cancel server-side generation if jobId exists
    if (currentJobIdRef.current) {
      try {
        const cancelEndpoint =
          councilMode === "council"
            ? `/api/workflow/generate-artifacts-council/cancel/${currentJobIdRef.current}`
            : `/api/workflow/generate-artifacts/cancel/${currentJobIdRef.current}`;

        await apiRequest("POST", cancelEndpoint);
        console.log(
          `[Workflow] Server-side cancellation requested for job ${currentJobIdRef.current}`,
        );
      } catch (error) {
        console.error(
          "[Workflow] Error cancelling server-side generation:",
          error,
        );
        // Continue with client-side cancellation even if server cancel fails
      }
    }

    // Set session status to cancelled so the session is marked as cancelled in the list
    if (sessionId) {
      try {
        await apiRequest("PATCH", `/api/sessions/${sessionId}/status`, {
          status: "CANCELLED",
        });
        console.log(
          "[Workflow] Session status set to CANCELLED for",
          sessionId,
        );
      } catch (err) {
        console.warn(
          "[Workflow] Failed to set session status to CANCELLED:",
          err,
        );
      }
    }

    // REAL EVENT: Generation cancelled by user
    addGenerationLog("Generation cancelled by user");

    // Reset state
    setIsGenerating(false);
    setIsGeneratingArtifacts(false);
    setGenerationProgress(0);
    setGenerationStep("");

    // Clear per-section loading states
    setEpicsLoading(false);
    setFeaturesLoading(false);
    setStoriesLoading(false);
    setPersonasLoading(false);

    // Navigate back to step 1 on cancel
    setCurrentStep(1);
  };

  // Expose cancel handler to context so step2 can call it (do not clear on unmount
  // so that Cancel from Step 2 still aborts the request, stops polling, and sets session cancelled)
  useEffect(() => {
    setCancelGeneration(() => handleCancelGeneration);
    return () => {
      // Intentionally do not set setCancelGeneration(null) so cancel remains available from Step 2
    };
  }, [setCancelGeneration]);

  // Handler for generating artifacts when user chooses to proceed
  const handleGenerateArtifacts = async () => {
    // Reset cancellation flags
    isPollingCancelledRef.current = false;
    setGenerationCancelled(false);
    currentJobIdRef.current = null; // Reset jobId

    // Create new AbortController for this generation
    abortControllerRef.current = new AbortController();
    const signal = abortControllerRef.current.signal;
    // Track the actual backend session id used for this generation run
    let effectiveSessionId: string | null = sessionId || null;

    try {
      // Ensure a backend session exists and persist current Step 1 state
      if (sessionIdentity && projectId) {
        try {
          // If this session has not yet been persisted, create it now
          // Build title context from what the user actually did: chat, BRD content, or file content.
          // BRD: use requirement descriptions (content) so title is topic-based, not "FR-013 – FR-016".
          // File: use processed file content so title reflects what was uploaded.
          const userMessages = conversationMessages.filter(
            (m) => m?.role === "user",
          );
          const lastUserContent =
            userMessages.length > 0
              ? userMessages[userMessages.length - 1]?.content?.trim()
              : "";
          const firstUserContent =
            userMessages.length > 0 ? userMessages[0]?.content?.trim() : "";
          const userQueryForTitle = (
            lastUserContent ||
            firstUserContent ||
            requirement?.trim() ||
            ""
          ).substring(0, 300);
          const selectedBrdReqs = brdRequirements.filter((r) =>
            selectedRequirementIds.includes(r.id),
          );
          const brdContentForTitle =
            selectedBrdReqs.length > 0
              ? selectedBrdReqs
                  .map(
                    (r) =>
                      `${r.requirementName}: ${(r.description || "")
                        .trim()
                        .substring(0, 180)}`,
                  )
                  .join("\n")
                  .substring(0, 900)
              : undefined;
          const fileContentForTitle =
            processedFileRequirements &&
            processedFileRequirements.trim().length > 0
              ? processedFileRequirements.trim().substring(0, 700)
              : undefined;
          const titleContext = {
            userQueryForTitle: userQueryForTitle || undefined,
            conversationMessages: conversationMessages.slice(-10),
            guidelineNames: complianceGuidelines.map(
              (g: { name: string }) => g.name,
            ),
            brdRequirementNames: selectedBrdReqs.map((r) => r.requirementName),
            brdContentForTitle: brdContentForTitle || undefined,
            fileContentForTitle: fileContentForTitle || undefined,
          };
          const createRes = await apiRequest("POST", "/api/sessions", {
            aadObjectId: sessionIdentity.aadObjectId,
            userName: sessionIdentity.userName,
            userEmail: sessionIdentity.userEmail,
            projectId,
            initialState: {
              screen: "STEP_2_GENERATED_CONTENT",
              inputs: {
                requirement,
                complianceGuidelines,
                selectedPersonaIds,
              },
              outputs: {},
              capturedRequirements,
              conversationPhase,
              ...titleContext,
            },
          });

          const createJson = await createRes.json();
          const backendSession = createJson.session as
            | { id?: string }
            | undefined;

          if (backendSession?.id) {
            // Use this concrete backend id for the entire generation run
            effectiveSessionId = backendSession.id;
            setSessionId(backendSession.id);

            // If user had selected a BRD in Step 1 (without creating a session), link it now
            if (brdAttached && selectedBrdId) {
              try {
                const attachRes = await apiRequest(
                  "POST",
                  "/api/workflow/attach-dev-brd",
                  {
                    workflowId: backendSession.id,
                    brdId: selectedBrdId,
                    attachedBy: backendSession.id,
                  },
                );
                const attachData = await attachRes.json();
                if (attachRes.ok && attachData?.success) {
                  console.log(
                    "[Workflow] BRD attached to new session:",
                    selectedBrdId,
                  );
                }
              } catch (attachErr) {
                console.warn(
                  "[Workflow] Failed to attach BRD to new session:",
                  attachErr,
                );
              }
            }

            // Invalidate sessions list so "My Sessions" shows this new session when opened
            if (projectId && sessionIdentity?.aadObjectId) {
              queryClient.invalidateQueries({
                queryKey: [
                  "workflow-sessions",
                  projectId,
                  sessionIdentity.aadObjectId,
                ],
              });
              queryClient.invalidateQueries({
                queryKey: [
                  "workflow-sessions-total-cost",
                  sessionIdentity.aadObjectId,
                ],
              });
            }

            // Auto-save the full conversational state so that if the user navigates
            // away during generation, the session can still be resumed.
            const statePayload = {
              // Persist step 1 context; backend/job completion will update to step 2
              screen: "STEP_1_CONVERSATIONAL_REFINEMENT",
              inputs: {
                requirement,
                complianceGuidelines,
                selectedPersonaIds,
              },
              outputs: {},
              conversationMessages,
              capturedRequirements,
              conversationPhase,
              askedQuestions,
            };

            await apiRequest(
              "POST",
              `/api/sessions/${backendSession.id}/autosave`,
              {
                state: statePayload,
                aadObjectId: sessionIdentity.aadObjectId,
                userName: sessionIdentity.userName,
                userEmail: sessionIdentity.userEmail,
              },
            );
          }
        } catch (e) {
          console.error(
            "[Workflow] Failed to create/auto-save session before generation:",
            e,
          );
        }
      }
      setIsGenerating(true);
      setIsGeneratingArtifacts(true);
      setGenerationCancelled(false);
      setShowChoiceDialog(false);
      setGenerationProgress(0);
      setGenerationStep("Preparing requirements...");

      // Clear previous log messages when starting new generation
      setGenerationLogs([]);
      lastLoggedStepRef.current = null;

      // Set all per-section loading states to true for progressive display
      setEpicsLoading(true);
      setFeaturesLoading(true);
      setStoriesLoading(true);
      setPersonasLoading(true);

      // Prepare comprehensive requirement text from conversation and captured data
      // IMPORTANT: Exclude the static Tia Bot welcome message so it is never treated as a requirement.
      const TIA_WELCOME_PREFIX =
        "Hello! I'm Tia Bot, your agile backlog assistant.";

      const conversationContext = conversationMessages
        .filter((msg) => {
          if (msg.role !== "assistant") return true;
          const content = msg.content?.trim() || "";
          // Filter out the initial Tia Bot welcome message
          if (content.startsWith(TIA_WELCOME_PREFIX)) {
            return false;
          }
          return true;
        })
        .map(
          (msg) =>
            `${msg.role === "user" ? "User" : "Assistant"}: ${msg.content}`,
        )
        .join("\n\n");

      const capturedInfo = `
Business Goals: ${
        capturedRequirements.businessGoals.join(", ") || "Not specified"
      }
Target Users: ${capturedRequirements.targetUsers.join(", ") || "Not specified"}
Key Features: ${capturedRequirements.keyFeatures.join(", ") || "Not specified"}
Technical Constraints: ${
        capturedRequirements.technicalConstraints.join(", ") || "Not specified"
      }
Functional Requirements: ${
        capturedRequirements.functionalRequirements.join(", ") ||
        "Not specified"
      }
Non-Functional Requirements: ${
        capturedRequirements.nonFunctionalRequirements.join(", ") ||
        "Not specified"
      }
Edge Cases: ${capturedRequirements.edgeCases.join(", ") || "Not specified"}
Priority Items: ${
        capturedRequirements.priorityItems.join(", ") || "Not specified"
      }
      `.trim();

      const requirementText = `${conversationContext}\n\n=== Captured Requirements ===\n${capturedInfo}`;

      // CRITICAL: Save requirement to workflow context for wiki generation in Step 2
      setRequirement(requirementText);

      // Debug RAG preparation
      console.log("[Workflow] === RAG PREPARATION DEBUG ===");
      console.log("[Workflow] brdAttached:", brdAttached);
      console.log("[Workflow] selectedBrdId:", selectedBrdId);
      console.log("[Workflow] selectedRequirementIds:", selectedRequirementIds);
      console.log(
        "[Workflow] selectedRequirementIds count:",
        selectedRequirementIds.length,
      );

      // Check if cancelled before proceeding
      if (signal.aborted) {
        return;
      }

      // Determine if this is BRD path or conversational path
      // BRD path: User must have EXPLICITLY selected at least one requirement
      // Conversational path: No requirements selected (even if BRD is attached)
      const hasExplicitlySelectedRequirements =
        selectedRequirementIds &&
        Array.isArray(selectedRequirementIds) &&
        selectedRequirementIds.length > 0;
      const isBRDPath = hasExplicitlySelectedRequirements;
      const isConversationalPath =
        !hasExplicitlySelectedRequirements &&
        requirementText &&
        requirementText.trim().length > 0;

      // ContextFusionAgent: BRD + Conversational Path Detection
      // Entry Conditions (ALL must be true):
      // 1. User has selected BRD requirements (hasExplicitlySelectedRequirements = true)
      // 2. User has provided EITHER:
      //    - Uploaded file (processedFileRequirements exists OR uploadedFiles array has items) OR
      //    - Chat input (latestUserChatInput exists and is not just welcome message)
      // 3. Chat input is not empty or contains actual user instructions (not just conversation context)

      // Extract latest user chat input (actual user instructions, not full conversation)
      const latestUserMessages = conversationMessages
        .filter((msg) => msg.role === "user")
        .slice(-3);
      const latestUserChatInput = latestUserMessages
        .map((msg) => msg.content.trim())
        .filter((content) => {
          // Filter out empty, welcome messages, or processed file requirement markers
          return (
            content.length > 0 &&
            !content.includes("Processed Document Requirements") &&
            !content
              .toLowerCase()
              .match(
                /^(hi|hello|hey|greetings?|good (morning|afternoon|evening))[\s,!.?]*$/i,
              )
          );
        })
        .join("\n");

      // Also check requirementText directly for user messages (fallback)
      const requirementTextUserMatch = requirementText?.match(
        /User:\s*([^\n]+(?:\n(?!User:|Assistant:)[^\n]+)*)/gi,
      );
      const requirementTextUserInput = requirementTextUserMatch
        ? requirementTextUserMatch[requirementTextUserMatch.length - 1]
            ?.replace(/^User:\s*/i, "")
            .trim()
        : null;

      // Check for actual user chat input (from conversation OR requirementText)
      const actualUserChatInput =
        latestUserChatInput || requirementTextUserInput || "";
      const hasUserChatInput =
        actualUserChatInput &&
        actualUserChatInput.trim().length > 0 &&
        !actualUserChatInput
          .toLowerCase()
          .match(
            /^(hi|hello|hey|greetings?|good (morning|afternoon|evening))[\s,!.?]*$/i,
          );

      // Check for file upload (processedFileRequirements OR uploadedFiles array)
      const hasFileUpload =
        (processedFileRequirements &&
          processedFileRequirements.trim().length > 0) ||
        (uploadedFiles && uploadedFiles.length > 0);

      // Path 3: BRD is selected AND (file uploaded OR chat input provided)
      const isBRDPlusConversationalPath =
        isBRDPath && (hasFileUpload || hasUserChatInput);

      // AI-based Path Detection (especially for UniversalAgent)
      let detectedPath = 2; // Default to Path 2
      let isPath4Generic = false;
      let pathDetectionReasoning = "Default: conversational path";

      if (hasUserChatInput && actualUserChatInput.trim().length > 0) {
        try {
          console.log(
            "[Workflow] ============================================",
          );
          console.log("[Workflow] === AI-BASED AGENT DETECTION ===");
          console.log(
            "[Workflow] ============================================",
          );
          console.log("[Workflow] Calling AI agent detection with:");
          console.log(
            "[Workflow]   - User Input:",
            actualUserChatInput.substring(0, 200),
          );
          console.log("[Workflow]   - Has BRD Selected:", isBRDPath);
          console.log("[Workflow]   - Has File Upload:", hasFileUpload);
          console.log(
            "[Workflow]   - Has Processed File Requirements:",
            !!processedFileRequirements,
          );
          console.log(
            "[Workflow]   - Selected Requirement IDs:",
            selectedRequirementIds.length,
          );

          const pathDetectionRes = await apiRequest(
            "POST",
            "/api/workflow/detect-path",
            {
              userInput: actualUserChatInput,
              conversationHistory: conversationMessages
                .slice(-10)
                .map((msg) => ({
                  role: msg.role,
                  content: msg.content,
                })),
              hasBRDSelected: isBRDPath,
              hasFileUpload: hasFileUpload,
              hasProcessedFileRequirements:
                !!processedFileRequirements &&
                processedFileRequirements.trim().length > 0,
              selectedRequirementIds: selectedRequirementIds || [],
              uploadedFileNames:
                uploadedFiles && uploadedFiles.length > 0
                  ? uploadedFiles.map((file) => file.name)
                  : [],
            },
            signal,
          );

          if (pathDetectionRes.ok) {
            const pathData = await pathDetectionRes.json();
            detectedPath = pathData.path || 2;
            isPath4Generic = pathData.isPath4Generic === true;
            pathDetectionReasoning = pathData.reasoning || "AI classification";

            const agentNames: Record<number, string> = {
              1: "RequirementsAgent",
              2: "ConversationAgent",
              3: "ContextFusionAgent",
              4: "UniversalAgent",
            };
            console.log("[Workflow] AI Agent Detection Result:");
            console.log(
              "[Workflow]   - Detected Agent:",
              agentNames[detectedPath] || detectedPath,
              `(path ${detectedPath})`,
            );
            console.log("[Workflow]   - Confidence:", pathData.confidence);
            console.log("[Workflow]   - Reasoning:", pathDetectionReasoning);
            console.log(
              "[Workflow]   - Is UniversalAgent Generic:",
              isPath4Generic,
            );
          } else {
            console.warn(
              "[Workflow] Agent detection API failed, using fallback logic",
            );
          }
        } catch (pathDetectionError) {
          console.error(
            "[Workflow] Error in AI agent detection:",
            pathDetectionError,
          );
          // Fallback to manual detection if AI fails
          if (isBRDPlusConversationalPath) {
            detectedPath = 3;
          } else if (isBRDPath) {
            detectedPath = 1;
          } else {
            detectedPath = 2;
          }
        }
      } else {
        // No user chat input - use simple logic
        if (isBRDPlusConversationalPath) {
          detectedPath = 3;
        } else if (isBRDPath) {
          detectedPath = 1;
        } else {
          detectedPath = 2;
        }
      }

      // Determine final path flags based on AI detection
      const isGenericPath = detectedPath === 4 && isPath4Generic;
      const finalIsBRDPlusConversationalPath = detectedPath === 3;
      const finalIsBRDPath = detectedPath === 1;

      console.log("[Workflow] ============================================");
      console.log("[Workflow] === FINAL PATH DETECTION ===");
      console.log("[Workflow] ============================================");
      console.log(
        "[Workflow] hasExplicitlySelectedRequirements:",
        hasExplicitlySelectedRequirements,
      );
      console.log("[Workflow] isBRDPath:", isBRDPath);
      console.log(
        "[Workflow] processedFileRequirements exists:",
        !!processedFileRequirements,
      );
      console.log(
        "[Workflow] processedFileRequirements length:",
        processedFileRequirements?.length || 0,
      );
      console.log(
        "[Workflow] uploadedFiles count:",
        uploadedFiles?.length || 0,
      );
      console.log("[Workflow] hasFileUpload:", hasFileUpload);
      console.log(
        "[Workflow] conversationMessages count:",
        conversationMessages.length,
      );
      console.log(
        "[Workflow] actualUserChatInput (combined):",
        actualUserChatInput,
      );
      console.log("[Workflow] hasUserChatInput:", hasUserChatInput);
      console.log("[Workflow] AI Detected Path:", detectedPath);
      console.log(
        "[Workflow] Path Detection Reasoning:",
        pathDetectionReasoning,
      );
      console.log("[Workflow] isGenericPath (UniversalAgent):", isGenericPath);
      console.log("[Workflow] ============================================");

      // Add to generation logs for UI visibility
      addGenerationLog(
        `🔍 Path Detection: BRD=${isBRDPath}, File=${hasFileUpload}, Chat=${hasUserChatInput}`,
      );
      if (isGenericPath) {
        addGenerationLog(
          `🛠 UniversalAgent Detected: Generic operation (${pathDetectionReasoning})`,
        );
      } else if (finalIsBRDPlusConversationalPath) {
        addGenerationLog(
          `✅ ContextFusionAgent Detected: BRD + Conversational`,
        );
      } else if (finalIsBRDPath) {
        addGenerationLog(`📄 RequirementsAgent Detected: BRD-only`);
      } else {
        addGenerationLog(`💬 ConversationAgent Detected: Conversational-only`);
      }

      // Clear previous council state
      setCouncilResponses([]);
      setChairEvaluation(null);
      setCouncilStep("");

      // If this is a UniversalAgent generic operation (detected by AI), call the dedicated generic endpoint and return
      if (isGenericPath && detectedPath === 4) {
        setGenerationProgress(10);
        setGenerationStep("Applying generic workflow operation...");

        // For UniversalAgent we don't start a long-running job; we call a synchronous API
        const genericRes = await apiRequest(
          "POST",
          "/api/workflow/generic",
          {
            input: requirementText,
            // Attach backend session id so UniversalAgent results are persisted
            sessionId: effectiveSessionId || sessionId || null,
            // Provide identity so backend can persist to the correct session
            aadObjectId: sessionIdentity?.aadObjectId,
            userName: sessionIdentity?.userName,
            userEmail: sessionIdentity?.userEmail,
          },
          signal,
        );

        if (signal.aborted) {
          return;
        }

        if (!genericRes.ok) {
          const errorData = await genericRes.json();
          throw new Error(
            errorData?.error ||
              "Failed to process generic workflow instruction",
          );
        }

        const genericData = await genericRes.json();
        const artifacts = genericData?.artifacts || {};

        // Handle test cases: merge them into user stories if they have relatedStoryId
        let processedUserStories = Array.isArray(artifacts.userStories)
          ? [...artifacts.userStories]
          : [];
        const testCases = Array.isArray(artifacts.testCases)
          ? artifacts.testCases
          : [];
        const subtasks = Array.isArray(artifacts.subtasks)
          ? artifacts.subtasks
          : [];
        // When we have only test cases/subtasks/epics/features (no user stories), we create placeholders so Step 2 can render
        let placeholderEpics: any[] = [];
        let placeholderFeatures: any[] = [];

        if (testCases.length > 0) {
          // Group test cases by their related story ID
          const testCasesByStory: Record<string, any[]> = {};
          const orphanedTestCases: any[] = [];

          testCases.forEach((testCase: any) => {
            // Normalize test case structure - ensure steps/testCaseSteps are properly formatted
            const normalizedTestCase = { ...testCase };

            // Map testCaseSteps to steps if needed (for UI compatibility)
            // Keep both formats for maximum compatibility
            if (testCase.testCaseSteps) {
              // Preserve original testCaseSteps
              normalizedTestCase.testCaseSteps = testCase.testCaseSteps;

              // Also create steps array if it doesn't exist
              if (!normalizedTestCase.steps) {
                if (
                  Array.isArray(testCase.testCaseSteps) &&
                  testCase.testCaseSteps.length > 0
                ) {
                  // Check if steps are objects (with action/result) or strings
                  if (
                    typeof testCase.testCaseSteps[0] === "object" &&
                    testCase.testCaseSteps[0] !== null
                  ) {
                    // Object format - normalize to ensure step numbers and proper structure
                    normalizedTestCase.steps = testCase.testCaseSteps.map(
                      (step: any, idx: number) => {
                        if (typeof step === "object" && step !== null) {
                          return {
                            step:
                              step.step !== undefined && step.step !== null
                                ? step.step
                                : idx + 1,
                            action: step.action || step.Action || "",
                            result:
                              step.result ||
                              step.expectedResult ||
                              step.expectedResults ||
                              "",
                          };
                        }
                        return step;
                      },
                    );
                  } else {
                    // String format - copy as-is
                    normalizedTestCase.steps = [...testCase.testCaseSteps];
                  }
                } else {
                  normalizedTestCase.steps = [];
                }
              }
            }

            // If steps exists but testCaseSteps doesn't, preserve steps
            if (testCase.steps && !normalizedTestCase.testCaseSteps) {
              normalizedTestCase.testCaseSteps = Array.isArray(testCase.steps)
                ? [...testCase.steps]
                : [];
            }

            // Ensure at least one format exists
            if (
              !normalizedTestCase.steps &&
              !normalizedTestCase.testCaseSteps
            ) {
              normalizedTestCase.steps = [];
              normalizedTestCase.testCaseSteps = [];
            }

            // Debug logging
            console.log("[Workflow] Normalized test case:", {
              id: normalizedTestCase.id,
              title: normalizedTestCase.title,
              hasSteps: !!normalizedTestCase.steps,
              stepsLength: normalizedTestCase.steps?.length || 0,
              hasTestCaseSteps: !!normalizedTestCase.testCaseSteps,
              testCaseStepsLength:
                normalizedTestCase.testCaseSteps?.length || 0,
              firstStepType: normalizedTestCase.steps?.[0]
                ? typeof normalizedTestCase.steps[0]
                : "none",
              firstStepHasResult:
                normalizedTestCase.steps?.[0] &&
                typeof normalizedTestCase.steps[0] === "object"
                  ? !!normalizedTestCase.steps[0].result
                  : false,
            });

            const storyId =
              testCase.relatedStoryId ||
              testCase.userStoryId ||
              testCase.storyId;
            if (storyId) {
              if (!testCasesByStory[storyId]) {
                testCasesByStory[storyId] = [];
              }
              testCasesByStory[storyId].push(normalizedTestCase);
            } else {
              orphanedTestCases.push(normalizedTestCase);
            }
          });

          // Attach test cases to existing user stories
          Object.keys(testCasesByStory).forEach((storyId) => {
            const storyIndex = processedUserStories.findIndex(
              (s: any) => s.id === storyId,
            );
            if (storyIndex >= 0) {
              if (!processedUserStories[storyIndex].testCases) {
                processedUserStories[storyIndex].testCases = [];
              }
              processedUserStories[storyIndex].testCases.push(
                ...testCasesByStory[storyId],
              );

              console.log("[Workflow] Attached test cases to story:", {
                storyId,
                storyTitle: processedUserStories[storyIndex].title,
                testCasesCount:
                  processedUserStories[storyIndex].testCases.length,
                firstTestCase: processedUserStories[storyIndex].testCases[0]
                  ? {
                      id: processedUserStories[storyIndex].testCases[0].id,
                      hasSteps:
                        !!processedUserStories[storyIndex].testCases[0].steps,
                      stepsLength:
                        processedUserStories[storyIndex].testCases[0].steps
                          ?.length || 0,
                    }
                  : null,
              });
            }
          });

          // If there are orphaned test cases (no related story), create a user story for them
          if (
            orphanedTestCases.length > 0 &&
            processedUserStories.length === 0
          ) {
            // Extract user story info from the requirement text (use full requirementText for better extraction)
            let storyTitle = "User Story";
            let storyDescription = "";
            let acceptanceCriteria: string[] = [];

            // Use requirementText which has full conversation context
            const fullText = requirementText || actualUserChatInput || "";

            // Try to extract from "As X, I want Y" format (more flexible pattern)
            const userStoryPatterns = [
              /As\s+([^,]+),\s*I\s+want\s+([^\n]+(?:\n(?!As\s+)[^\n]+)*)/i,
              /As\s+([^,]+),\s*I\s+want\s+([^\n]+)/i,
            ];

            let userStoryMatch = null;
            for (const pattern of userStoryPatterns) {
              userStoryMatch = fullText.match(pattern);
              if (userStoryMatch) break;
            }

            if (userStoryMatch) {
              storyTitle = `As ${userStoryMatch[1].trim()}, I want ${userStoryMatch[2].trim()}`;
              // Extract full description - everything after the title until next section
              const afterTitle = fullText.substring(
                userStoryMatch.index! + userStoryMatch[0].length,
              );
              // Stop at next "As" or section marker
              const descriptionEnd = afterTitle.search(
                /\n(?:As\s+|CONTEXT|BACKGROUND|ACCEPTANCE|TECHNICAL)/i,
              );
              storyDescription =
                descriptionEnd > 0
                  ? afterTitle.substring(0, descriptionEnd).trim()
                  : afterTitle.substring(0, 2000).trim();

              // Extract acceptance criteria if present
              const criteriaMatch = fullText.match(
                /Acceptance\s+Criteria\s*\n((?:\s*Criteria\s+\d+[^\n]+\n?)+)/i,
              );
              if (criteriaMatch) {
                const criteriaText = criteriaMatch[1];
                acceptanceCriteria = criteriaText
                  .split(/\n\s*Criteria\s+\d+:/i)
                  .filter((c) => c.trim().length > 0)
                  .map((c) => c.trim());
              }
            } else {
              // Fallback: extract from first substantial line
              const lines = fullText
                .split("\n")
                .filter((l) => l.trim().length > 10);
              if (lines.length > 0) {
                storyTitle = lines[0].trim().substring(0, 200);
                storyDescription = lines
                  .slice(0, 10)
                  .join("\n")
                  .substring(0, 2000);
              } else {
                storyTitle = "User Story for Test Cases";
                storyDescription = fullText.substring(0, 2000);
              }
            }

            // Get persona info (required field)
            const persona =
              artifacts.personas && artifacts.personas.length > 0
                ? artifacts.personas[0]
                : null;
            const personaName = persona?.name || persona?.role || "User";
            const personaId = persona?.id || `persona-${Date.now()}`;

            // Create minimal epic and feature if they don't exist (required fields)
            let epicId =
              artifacts.epics && artifacts.epics.length > 0
                ? artifacts.epics[0].id
                : `epic-${Date.now()}`;
            let featureId =
              artifacts.features && artifacts.features.length > 0
                ? artifacts.features[0].id
                : `feature-${Date.now()}`;

            // Create placeholder epic if needed (keep for final setEpics so we don't overwrite with [])
            if (!artifacts.epics || artifacts.epics.length === 0) {
              const placeholderEpic = {
                id: epicId,
                title: "Standalone Epic",
                description: "Epic created for test case generation",
                priority: "Medium" as const,
              };
              placeholderEpics = [placeholderEpic];
            }

            // Create placeholder feature if needed (keep for final setFeatures so we don't overwrite with [])
            if (!artifacts.features || artifacts.features.length === 0) {
              const placeholderFeature = {
                id: featureId,
                title: "Standalone Feature",
                description: "Feature created for test case generation",
                epicId: epicId,
                priority: "Medium" as const,
              };
              placeholderFeatures = [placeholderFeature];
            }

            // Create user story with all required fields
            const newStory = {
              id: `story-${Date.now()}`,
              title: storyTitle,
              description:
                storyDescription || "User story for generated test cases",
              testCases: orphanedTestCases,
              acceptanceCriteria:
                acceptanceCriteria.length > 0
                  ? acceptanceCriteria.map((ac, idx) => ({
                      title: `Criteria ${idx + 1}`,
                      given: ac,
                      when: "",
                      then: "",
                    }))
                  : [],
              storyPoints: 3,
              priority: "Medium" as const,
              status: "backlog",
              // Required fields
              persona: personaName,
              personaId: personaId,
              epicId: epicId,
              featureId: featureId,
            };

            processedUserStories.push(newStory);

            console.log(
              "[Workflow] Created user story for orphaned test cases:",
              {
                id: newStory.id,
                title: newStory.title,
                testCasesCount: orphanedTestCases.length,
                firstTestCase: orphanedTestCases[0]
                  ? {
                      id: orphanedTestCases[0].id,
                      title: orphanedTestCases[0].title,
                      hasSteps: !!orphanedTestCases[0].steps,
                      stepsLength: orphanedTestCases[0].steps?.length || 0,
                      hasTestCaseSteps: !!orphanedTestCases[0].testCaseSteps,
                      testCaseStepsLength:
                        orphanedTestCases[0].testCaseSteps?.length || 0,
                    }
                  : null,
              },
            );
          } else if (
            orphanedTestCases.length > 0 &&
            processedUserStories.length > 0
          ) {
            // Attach orphaned test cases to the first user story
            if (!processedUserStories[0].testCases) {
              processedUserStories[0].testCases = [];
            }
            processedUserStories[0].testCases.push(...orphanedTestCases);
          }
        }

        // Handle subtasks: merge them into user stories if they have storyId
        if (subtasks.length > 0) {
          subtasks.forEach((subtask: any) => {
            const storyId =
              subtask.storyId || subtask.userStoryId || subtask.relatedStoryId;
            if (storyId) {
              const storyIndex = processedUserStories.findIndex(
                (s: any) => s.id === storyId,
              );
              if (storyIndex >= 0) {
                if (!processedUserStories[storyIndex].subtasks) {
                  processedUserStories[storyIndex].subtasks = [];
                }
                processedUserStories[storyIndex].subtasks.push(subtask);
              }
            }
          });

          // Orphaned subtasks (no user stories to attach to): create placeholder epic/feature/story so Step 2 can render
          if (processedUserStories.length === 0) {
            const persona =
              artifacts.personas && artifacts.personas.length > 0
                ? artifacts.personas[0]
                : null;
            const personaName = persona?.name || persona?.role || "User";
            const personaId = persona?.id || `persona-${Date.now()}`;
            const epicId = artifacts.epics?.length
              ? artifacts.epics[0].id
              : `epic-${Date.now()}`;
            const featureId = artifacts.features?.length
              ? artifacts.features[0].id
              : `feature-${Date.now()}`;

            if (
              !placeholderEpics.length &&
              (!artifacts.epics || artifacts.epics.length === 0)
            ) {
              placeholderEpics = [
                {
                  id: epicId,
                  title: "Standalone Epic",
                  description: "Epic created for subtask generation",
                  priority: "Medium" as const,
                },
              ];
            }
            if (
              !placeholderFeatures.length &&
              (!artifacts.features || artifacts.features.length === 0)
            ) {
              placeholderFeatures = [
                {
                  id: featureId,
                  title: "Standalone Feature",
                  description: "Feature created for subtask generation",
                  epicId,
                  priority: "Medium" as const,
                },
              ];
            }

            const subtasksForStory = subtasks.map((s: any) =>
              typeof s === "string"
                ? s
                : {
                    title: s.title || "",
                    description: s.description || s.title || "Subtask",
                    ...s,
                  },
            );
            const newStory = {
              id: `story-${Date.now()}`,
              title: "User Story for Generated Subtasks",
              description: "User story created for standalone subtasks",
              subtasks: subtasksForStory,
              testCases: [],
              storyPoints: 3,
              priority: "Medium" as const,
              status: "backlog",
              persona: personaName,
              personaId,
              epicId,
              featureId,
            };
            processedUserStories.push(newStory);
            console.log(
              "[Workflow] Created user story for orphaned subtasks:",
              { id: newStory.id, subtasksCount: subtasks.length },
            );
          }
        }

        // Final normalization pass: Ensure all test cases in user stories have proper structure
        processedUserStories.forEach((story: any) => {
          if (story.testCases && Array.isArray(story.testCases)) {
            story.testCases = story.testCases.map((tc: any) => {
              const normalized = { ...tc };

              // Normalize testCaseSteps to steps (preferred format for UI)
              if (normalized.testCaseSteps && !normalized.steps) {
                // Check if testCaseSteps contains objects or strings
                if (
                  Array.isArray(normalized.testCaseSteps) &&
                  normalized.testCaseSteps.length > 0
                ) {
                  // If first item is an object, preserve object format
                  if (
                    typeof normalized.testCaseSteps[0] === "object" &&
                    normalized.testCaseSteps[0] !== null
                  ) {
                    normalized.steps = normalized.testCaseSteps.map(
                      (step: any, idx: number) => {
                        // Ensure step number is set
                        if (typeof step === "object" && step !== null) {
                          return {
                            step: step.step !== undefined ? step.step : idx + 1,
                            action: step.action || step.Action || "",
                            result:
                              step.result ||
                              step.expectedResult ||
                              step.expectedResults ||
                              "",
                          };
                        }
                        return step;
                      },
                    );
                  } else {
                    // String format - copy as-is
                    normalized.steps = [...normalized.testCaseSteps];
                  }
                } else {
                  normalized.steps = [];
                }
              }

              // Ensure testCaseSteps exists (fallback format)
              if (normalized.steps && !normalized.testCaseSteps) {
                normalized.testCaseSteps = Array.isArray(normalized.steps)
                  ? [...normalized.steps]
                  : [];
              }

              // If neither exists, create empty arrays
              if (!normalized.steps && !normalized.testCaseSteps) {
                normalized.steps = [];
                normalized.testCaseSteps = [];
              }

              return normalized;
            });
          }
        });

        // Update artifacts in UI: use placeholders when we have only test cases/subtasks (no epics/features from API)
        const finalEpics =
          Array.isArray(artifacts.epics) && artifacts.epics.length > 0
            ? artifacts.epics
            : placeholderEpics;
        const finalFeatures =
          Array.isArray(artifacts.features) && artifacts.features.length > 0
            ? artifacts.features
            : placeholderFeatures;
        setEpics(finalEpics);
        setFeatures(finalFeatures);
        setUserStories(processedUserStories);
        setPersonas(
          Array.isArray(artifacts.personas) ? artifacts.personas : [],
        );

        // Ensure loading states are cleared
        setEpicsLoading(false);
        setFeaturesLoading(false);
        setStoriesLoading(false);
        setPersonasLoading(false);

        // Log what was generated
        console.log("[Workflow] UniversalAgent artifacts processed:", {
          epics: artifacts.epics?.length || 0,
          features: artifacts.features?.length || 0,
          userStories: processedUserStories.length,
          testCases: testCases.length,
          subtasks: subtasks.length,
          personas: artifacts.personas?.length || 0,
        });

        if (testCases.length > 0) {
          addGenerationLog(`✅ ${testCases.length} Test Case(s) generated`);
        }
        if (processedUserStories.length > 0) {
          addGenerationLog(
            `✅ ${processedUserStories.length} User Story/stories updated`,
          );
          // Log first story details for debugging
          const firstStory = processedUserStories[0];
          console.log("[Workflow] First user story:", {
            id: firstStory.id,
            title: firstStory.title,
            hasTestCases:
              Array.isArray(firstStory.testCases) &&
              firstStory.testCases.length > 0,
            testCasesCount: firstStory.testCases?.length || 0,
            firstTestCase: firstStory.testCases?.[0]
              ? {
                  id: firstStory.testCases[0].id,
                  title: firstStory.testCases[0].title,
                  hasSteps: !!firstStory.testCases[0].steps,
                  stepsLength: firstStory.testCases[0].steps?.length || 0,
                  hasTestCaseSteps: !!firstStory.testCases[0].testCaseSteps,
                  testCaseStepsLength:
                    firstStory.testCases[0].testCaseSteps?.length || 0,
                  firstStep:
                    firstStory.testCases[0].steps?.[0] ||
                    firstStory.testCases[0].testCaseSteps?.[0] ||
                    null,
                }
              : null,
          });
        }

        setGenerationProgress(100);
        setGenerationStep("UniversalAgent operation complete");
        addGenerationLog("✅ UniversalAgent generic operation complete");

        setIsGeneratingArtifacts(false);
        setIsGenerating(false);
        await persistStep1ChatHistory();
        setCurrentStep(2);
        return;
      }

      // Set initial progress and step based on AI-detected path and council mode
      if (councilMode === "council") {
        setGenerationProgress(5);
        if (isGenericPath && detectedPath === 4) {
          setGenerationStep(
            "Initializing LLM Council for generic workflow operation...",
          );
          setCouncilStep(
            "Preparing Azure OpenAI and Anthropic for generic operation",
          );
        } else if (finalIsBRDPlusConversationalPath) {
          setGenerationStep(
            "Initializing LLM Council for BRD + Chat analysis...",
          );
          setCouncilStep(
            "Preparing Azure OpenAI and Anthropic to merge BRD requirements with your chat input and file",
          );
        } else if (finalIsBRDPath) {
          setGenerationStep("Initializing LLM Council for BRD analysis...");
          setCouncilStep(
            "Preparing Azure OpenAI and Anthropic to analyze your BRD requirements",
          );
        } else if (isConversationalPath) {
          setGenerationStep(
            "Initializing LLM Council for requirement analysis...",
          );
          setCouncilStep(
            "Preparing Azure OpenAI and Anthropic to process your requirements",
          );
        } else {
          setGenerationStep("Initializing LLM Council...");
          setCouncilStep(
            "Preparing AI council (Azure OpenAI + Anthropic) for artifact generation",
          );
        }
      } else {
        if (isGenericPath && detectedPath === 4) {
          setGenerationProgress(10);
          setGenerationStep("Applying generic workflow operation...");
        } else if (finalIsBRDPlusConversationalPath) {
          setGenerationProgress(10);
          setGenerationStep(
            "Analyzing BRD document and merging with chat input...",
          );
        } else if (finalIsBRDPath) {
          setGenerationProgress(10);
          setGenerationStep("Analyzing BRD document...");
        } else if (isConversationalPath) {
          setGenerationProgress(10);
          setGenerationStep(
            "Converting your requirement to functional requirements...",
          );
        } else {
          setGenerationProgress(20);
          setGenerationStep("Preparing requirements analysis...");
        }
      }

      // Simulate some progress steps for better UX
      await new Promise((resolve) => {
        const timeout = setTimeout(resolve, 500);
        pollingTimeoutRef.current = timeout;
        signal.addEventListener("abort", () => clearTimeout(timeout));
      });
      // ...existing code...
      // ...existing code...

      // Persist Step 1 chat history so it is restored when user returns or resumes session
      await persistStep1ChatHistory();
      // Immediately navigate to step2 to show skeletons while generation happens
      // This creates the progressive, non-blocking UX
      setCurrentStep(2);

      // Start background job with LLM Council configuration
      // IMPORTANT: Only send selectedRequirementIds if user EXPLICITLY selected them (BRD path)
      // For conversational path, send empty array to ensure server uses conversational path
      const generatePayload: any = {
        requirement: requirementText,
        complianceGuidelines,
        selectedPersonaIds,
        // Only send selectedRequirementIds if user explicitly selected requirements (RequirementsAgent or ContextFusionAgent)
        // For pure conversational path (ConversationAgent), send empty array to prevent BRD path detection
        selectedRequirementIds:
          isBRDPath || isBRDPlusConversationalPath
            ? selectedRequirementIds
            : [],
        // Explicit path flag to help server determine the correct path
        // Use AI-detected path if available, otherwise fall back to manual detection
        generationPath:
          detectedPath === 4
            ? "generic" // UniversalAgent: Generic operations
            : finalIsBRDPlusConversationalPath
              ? "conversational-brd" // ContextFusionAgent: BRD + Conversational
              : finalIsBRDPath
                ? "brd" // RequirementsAgent: BRD-only
                : "conversational", // ConversationAgent: Conversational-only
        // New traceability fields (payload enhancement only)
        brdId: isBRDPath ? selectedBrdId || null : null, // Only send brdId for BRD path
        requirementIds:
          isBRDPath && Array.isArray(selectedRequirementIds)
            ? selectedRequirementIds
            : [],
        capturedRequirements, // Server will use this to build RAG query
        sessionId: effectiveSessionId, // For RAG/session tracking, use backend id
        projectId: projectId || sdlcProjectId || "default-project", // Required for RAG caching optimization
        useGoldenRepo: useGoldenRepo, // Golden Repo (RAG) toggle

        // ...existing code...
        // LLM Council configuration
        executionMode: councilMode,
        llmCouncil:
          councilMode === "council"
            ? {
                providers: isAwsMode
                  ? [
                      {
                        type: "bedrock",
                        model: "bedrock-claude",
                        id: "bedrock-1",
                        name: "Bedrock Claude",
                      },
                      {
                        type: "bedrock",
                        model: "bedrock-claude",
                        id: "bedrock-2",
                        name: "Bedrock Claude",
                      },
                    ]
                  : [
                      {
                        type: "azure-openai",
                        model: "gpt-4o",
                        id: "azure-openai-1",
                        name: "Azure OpenAI",
                      },
                      {
                        type: "anthropic",
                        model: "claude-sonnet-4-5",
                        id: "anthropic-1",
                        name: "Anthropic Claude",
                      },
                    ],
                chairModel: isAwsMode
                  ? {
                      type: "bedrock",
                      model: "bedrock-claude",
                      id: "chair-model",
                      name: "Bedrock Claude Chair",
                    }
                  : {
                      type: "azure-openai",
                      model: "gpt-4o",
                      id: "chair-model",
                      name: "Azure OpenAI Chair",
                    },
                evaluationCriteria: {
                  factualConfidence: 0.3,
                  completeness: 0.25,
                  consistency: 0.25,
                  clarity: 0.2,
                },
              }
            : undefined,
        // Pass processed file requirements if available (from file upload processing)
        functionalRequirementsContent: processedFileRequirements || null, // Processed BRD functional requirements from uploaded files
        // AI enhancement setting
        aiEnhanceEnabled: aiEnhanceEnabled,
        // LLM temperature setting
        llmTemperature: llmTemperature,
      };



      console.log("[Workflow] Generation payload prepared:", {
        hasProcessedFileRequirements: !!processedFileRequirements,
        processedFileRequirementsLength: processedFileRequirements?.length || 0,
        functionalRequirementsContent: processedFileRequirements
          ? "SET"
          : "NULL",
        generationPath: generatePayload.generationPath,
      });

      if (processedFileRequirements) {
        console.log(
          "[Workflow] ✅ Including processed file requirements in generation payload, length:",
          processedFileRequirements.length,
        );
        console.log(
          "[Workflow] Processed requirements preview (first 500 chars):",
          processedFileRequirements.substring(0, 500),
        );
      } else {
        console.warn(
          "[Workflow] ⚠️ No processed file requirements available - will convert conversation instead",
        );
      }

      const payloadWithIdentity = {
        ...generatePayload,
        aadObjectId: sessionIdentity?.aadObjectId,
        userName: sessionIdentity?.userName,
        userEmail: sessionIdentity?.userEmail,
      };

      console.log("[Workflow] Generation payload:", {
        generationPath: payloadWithIdentity.generationPath,
        executionMode: payloadWithIdentity.executionMode,
        hasSelectedRequirementIds:
          payloadWithIdentity.selectedRequirementIds?.length > 0,
        selectedRequirementIdsCount:
          payloadWithIdentity.selectedRequirementIds?.length || 0,
        hasRequirementText: !!payloadWithIdentity.requirement,
        requirementTextLength: payloadWithIdentity.requirement?.length || 0,
        aiEnhanceEnabled: payloadWithIdentity.aiEnhanceEnabled,
      });

      const endpointUrl =
        councilMode === "council"
          ? "/api/workflow/generate-artifacts-council"
          : "/api/workflow/generate-artifacts";

      // REAL EVENT: Generate artifacts API request sent
      addGenerationLog("Generate artifacts request sent");

      const artifactsRes = await apiRequest(
        "POST",
        endpointUrl,
        payloadWithIdentity,
        signal,
      );

      if (signal.aborted) {
        return;
      }

      if (!artifactsRes.ok) {
        const errorData = await artifactsRes.json();
        throw new Error(
          `Artifact generation failed: ${errorData.error || "Unknown error"}`,
        );
      }

      const jobResponse = await artifactsRes.json();
      const jobId = jobResponse.jobId;

      if (!jobId) {
        throw new Error("Failed to start artifact generation job");
      }

      // Store jobId for cancellation
      currentJobIdRef.current = jobId;

      // Persist generation job info into the session snapshot so we can
      // re-attach to this job if the user navigates away and resumes later.
      if (sessionIdentity && effectiveSessionId) {
        try {
          const snapshotState = {
            screen: "STEP_2_GENERATED_CONTENT",
            inputs: {
              requirement: requirementText,
              complianceGuidelines,
              selectedPersonaIds,
            },
            outputs: {},
            generationJob: {
              jobId,
              mode: councilMode,
              startedAt: new Date().toISOString(),
            },
          };

          await apiRequest(
            "POST",
            `/api/sessions/${effectiveSessionId}/autosave`,
            {
              state: snapshotState,
              aadObjectId: sessionIdentity.aadObjectId,
              userName: sessionIdentity.userName,
              userEmail: sessionIdentity.userEmail,
            },
          );
        } catch (e) {
          console.error(
            "[Workflow] Failed to persist generation job to session:",
            e,
          );
        }
      }

      // Poll for job status - server will provide dynamic step messages
      // Initial message will be updated by server response
      if (councilMode === "council") {
        if (isGenericPath && detectedPath === 4) {
          setGenerationStep("LLM Council processing generic operation...");
          setCouncilStep(
            "Azure OpenAI and Anthropic are processing your generic workflow instruction",
          );
        } else if (finalIsBRDPath) {
          setGenerationStep("LLM Council analyzing BRD document...");
          setCouncilStep(
            "Azure OpenAI and Anthropic are processing your BRD requirements in parallel",
          );
        } else if (isConversationalPath) {
          setGenerationStep("LLM Council analyzing functional requirements...");
          setCouncilStep(
            "Azure OpenAI and Anthropic are processing your requirements in parallel",
          );
        } else {
          setGenerationStep("LLM Council processing artifacts...");
          setCouncilStep(
            "Azure OpenAI and Anthropic are generating artifacts in parallel",
          );
        }
      } else {
        if (isGenericPath && detectedPath === 4) {
          setGenerationStep("Processing generic workflow operation...");
        } else if (finalIsBRDPath) {
          setGenerationStep(
            "Analyzing BRD document and generating artifacts...",
          );
        } else if (isConversationalPath) {
          setGenerationStep(
            "Analyzing functional requirements and generating artifacts...",
          );
        } else {
          setGenerationStep(
            "Processing artifacts (this may take several minutes)...",
          );
        }
      }
      // ...existing code...
      // REAL EVENT: Generation job started
      addGenerationLog(`Generation job started (ID: ${jobId})`);
      // ...existing code...

      const pollInterval = 2000; // Poll every 2 seconds for faster log updates
      const maxPollAttempts = 600; // Max 20 minutes (600 * 2 seconds)
      let pollAttempts = 0;

      const pollJobStatus = async (): Promise<any> => {
        // Global cancellation guard
        if (signal.aborted || isPollingCancelledRef.current) {
          console.log(
            "[Workflow] Polling stopped before start: generation cancelled",
          );
          return null;
        }

        if (pollAttempts >= maxPollAttempts) {
          throw new Error("Artifact generation timed out. Please try again.");
        }

        pollAttempts++;

        try {
          // Check if cancelled before making request
          if (signal.aborted || isPollingCancelledRef.current) {
            console.log(
              "[Workflow] Polling stopped: generation cancelled before request",
            );
            return null;
          }

          const statusEndpoint =
            councilMode === "council"
              ? `/api/workflow/generate-artifacts-council/status/${jobId}`
              : `/api/workflow/generate-artifacts/status/${jobId}`;

          const statusRes = await apiRequest(
            "GET",
            statusEndpoint,
            undefined,
            signal,
          );

          if (signal.aborted || isPollingCancelledRef.current) {
            console.log(
              "[Workflow] Polling stopped: generation cancelled after request",
            );
            return null;
          }

          // Check for error status codes (404 = job not found; 500 = server hiccup, retry)
          if (!statusRes.ok) {
            const errorData = await statusRes.json().catch(() => ({}));
            const errorMessage =
              errorData.error ||
              `Failed to fetch job status (${statusRes.status})`;

            // 404 = job not in memory or DB — for council, retry a few times (another instance may not have persisted yet)
            if (statusRes.status === 404) {
              const retry404 = (pollJobStatus as any).__status404Retries ?? 0;
              const max404Retries = councilMode === "council" ? 3 : 0;
              if (max404Retries > 0 && retry404 < max404Retries) {
                (pollJobStatus as any).__status404Retries = retry404 + 1;
                const delayMs = 2000;
                console.warn(
                  `[Workflow] Job ${jobId} not found (404), retry ${retry404 + 1}/${max404Retries} in ${delayMs}ms...`,
                );
                await new Promise((r) => setTimeout(r, delayMs));
                if (signal.aborted || isPollingCancelledRef.current)
                  return null;
                return pollJobStatus();
              }
              console.error(
                `[Workflow] Job ${jobId} not found (404) after retries`,
              );
              throw new Error(
                "Job not found. Refresh the page to check status — if generation completed, artifacts will appear.",
              );
            }

            // 500 = server error (serialization, DB, etc.) — retry a few times instead of treating as job failed
            if (statusRes.status === 500) {
              const retryCount = (pollJobStatus as any).__status500Retries ?? 0;
              const max500Retries = councilMode === "council" ? 5 : 2;
              if (retryCount < max500Retries) {
                (pollJobStatus as any).__status500Retries = retryCount + 1;
                const backoffMs = Math.min(
                  2000 * Math.pow(2, retryCount),
                  15000,
                );
                console.warn(
                  `[Workflow] Status returned 500 for job ${jobId} (retry ${retryCount + 1}/${max500Retries}), retrying in ${backoffMs}ms...`,
                );
                await new Promise((r) => setTimeout(r, backoffMs));
                if (signal.aborted || isPollingCancelledRef.current)
                  return null;
                return pollJobStatus();
              }
              console.error(
                `[Workflow] Job ${jobId} status returned 500 after ${max500Retries} retries`,
              );
              toast.error(
                "Could not fetch job status. The job may still be running — refresh the page to check.",
                { duration: 10000 },
              );
              throw new Error(errorMessage);
            }

            // Other errors
            throw new Error(errorMessage);
          }

          // Reset retry counts on success
          (pollJobStatus as any).__status500Retries = 0;
          (pollJobStatus as any).__status404Retries = 0;

          const statusData = await statusRes.json();

          (pollJobStatus as any).__networkRetries = 0;
          if (statusData.progress !== undefined) {
            // Map server progress (0-100) to our range (65-90)
            const mappedProgress = 65 + statusData.progress * 0.25; // 65-90 range
            setGenerationProgress(Math.min(mappedProgress, 90));
          }

          if (statusData.step) {
            setGenerationStep(statusData.step);
            if (statusData.step !== lastLoggedStepRef.current) {
              lastLoggedStepRef.current = statusData.step;
              addGenerationLog(statusData.step);
            }
          }

          if (statusData.qualityReport) {
            setQualityReport(statusData.qualityReport);
          }
          if (statusData.domainExpertAnalysis) {
            setDomainExpertAnalysis(statusData.domainExpertAnalysis);
          }

          // Handle LLM Council specific updates
          if (councilMode === "council" && statusData.councilData) {
            if (statusData.councilData.responses) {
              setCouncilResponses(statusData.councilData.responses);
            }
            if (statusData.councilData.evaluation) {
              setChairEvaluation(statusData.councilData.evaluation);
            }
            if (statusData.councilData.councilStep) {
              setCouncilStep(statusData.councilData.councilStep);
            }
          }

          if (statusData.status === "completed") {
            // When status payload was trimmed (_fetchResult), fetch full result from dedicated endpoint
            const resultPayload = statusData.result;
            if (
              resultPayload?._fetchResult === true &&
              resultPayload?.jobId &&
              councilMode === "council"
            ) {
              const resultRes = await apiRequest(
                "GET",
                `/api/workflow/generate-artifacts-council/result/${resultPayload.jobId}`,
                undefined,
                signal,
              );
              if (resultRes.ok) {
                const data = await resultRes.json();
                return data.result ?? resultPayload;
              }
            }
            return statusData.result;
          } else if (statusData.status === "failed") {
            // Stop polling immediately when failed
            const errorMessage =
              statusData.error || "Artifact generation failed";
            console.error(`[Workflow] Job ${jobId} failed:`, errorMessage);
            toast.error(errorMessage, { duration: 10000 });
            throw new Error(errorMessage);
          } else if (statusData.status === "cancelled") {
            // Server reports job was cancelled – stop polling and exit
            console.log(
              `[Workflow] Job ${jobId} reported as cancelled by server, stopping polling`,
            );
            return null;
          }

          // Not completed/failed yet – schedule the next poll with a cancellable timeout
          if (signal.aborted || isPollingCancelledRef.current) {
            console.log(
              "[Workflow] Polling stopped: generation cancelled before scheduling next poll",
            );
            return null;
          }

          return await new Promise<any>((resolve, reject) => {
            const timeout = setTimeout(async () => {
              pollingTimeoutRef.current = null;

              if (signal.aborted || isPollingCancelledRef.current) {
                console.log(
                  "[Workflow] Polling stopped: generation cancelled when timeout fired",
                );
                resolve(null);
                return;
              }

              try {
                const result = await pollJobStatus();
                resolve(result);
              } catch (err) {
                reject(err);
              }
            }, pollInterval);

            pollingTimeoutRef.current = timeout;

            // If cancellation happens while waiting, clear timeout and resolve null
            const cancelIfNeeded = () => {
              if (signal.aborted || isPollingCancelledRef.current) {
                clearTimeout(timeout);
                pollingTimeoutRef.current = null;
                console.log(
                  "[Workflow] Polling stopped: generation cancelled while waiting for next poll",
                );
                resolve(null);
              }
            };

            // Immediate check in case cancellation already happened
            cancelIfNeeded();

            // Also listen for abort signal
            signal.addEventListener("abort", cancelIfNeeded, { once: true });
          });
        } catch (error: any) {
          const normalizedError = error as {
            message?: string;
            httpStatus?: number;
            retryable?: boolean;
          };
          const errorMessage =
            typeof normalizedError?.message === "string"
              ? normalizedError.message
              : error instanceof Error
                ? error.message
                : "Unknown error occurred";

          if (
            errorMessage.includes("aborted") ||
            errorMessage.includes("cancelled") ||
            signal.aborted ||
            isPollingCancelledRef.current
          ) {
            console.log(
              "[Workflow] Polling stopped: generation cancelled in error handler",
            );
            return null;
          }

          const httpStatus = normalizedError?.httpStatus;
          const isServerSideTransient =
            typeof httpStatus === "number" &&
            httpStatus >= 500 &&
            httpStatus < 600 &&
            (normalizedError.retryable ?? true);
          const isTransientNetworkError =
            errorMessage.includes("Failed to fetch") ||
            errorMessage.includes("NetworkError") ||
            errorMessage.includes("net::ERR_") ||
            errorMessage.includes("Load failed") ||
            errorMessage.includes("Network request failed");

          const isTransientError =
            (isTransientNetworkError || isServerSideTransient) &&
            pollAttempts < maxPollAttempts;

          if (isTransientError) {
            const retryCount = (pollJobStatus as any).__transientRetries ?? 0;
            const maxTransientRetries = 5;
            if (retryCount < maxTransientRetries) {
              (pollJobStatus as any).__transientRetries = retryCount + 1;
              const backoffMs = Math.min(2000 * Math.pow(2, retryCount), 15000);
              console.warn(
                `[Workflow] Transient error polling job ${jobId} (status ${httpStatus ?? "n/a"}, retry ${retryCount + 1}/${maxTransientRetries}), retrying in ${backoffMs}ms...`,
              );
              await new Promise((r) => setTimeout(r, backoffMs));
              if (signal.aborted || isPollingCancelledRef.current) return null;
              return pollJobStatus();
            }
            console.error(
              `[Workflow] Transient error persisted after ${maxTransientRetries} retries for job ${jobId} (status ${httpStatus ?? "n/a"})`,
            );
          }
          console.error(
            `[Workflow] Error polling job status for ${jobId}:`,
            errorMessage,
          );

          if (!errorMessage.includes("Job not found")) {
            toast.error(`Artifact generation error: ${errorMessage}`, {
              duration: 10000,
            });
          }

          throw error;
        }
      };

      const artifactsData = await pollJobStatus();

      // Check if cancelled after polling completes
      if (
        signal.aborted ||
        generationCancelled ||
        isPollingCancelledRef.current ||
        !artifactsData
      ) {
        console.log(
          "[Workflow] Generation cancelled or no data returned, stopping",
        );
        return;
      }

      // PRIORITY 1: Set Epics IMMEDIATELY for instant visual feedback
      if (artifactsData.epics && artifactsData.epics.length > 0) {
        setEpics(artifactsData.epics);
        setEpicsLoading(false);
        // Add to log
        addGenerationLog(`✅ ${artifactsData.epics.length} Epic(s) loaded`);
      } else {
        setEpicsLoading(false);
      }

      // PRIORITY 2: Set other artifacts progressively after Epics are visible
      // Use small delays to create progressive loading effect
      await new Promise((resolve) => {
        const timeout = setTimeout(resolve, 100); // 100ms delay after Epics
        pollingTimeoutRef.current = timeout;
        signal.addEventListener("abort", () => clearTimeout(timeout));
      });

      if (signal.aborted) {
        return;
      }

      // Set Features
      if (artifactsData.features && artifactsData.features.length > 0) {
        setFeatures(artifactsData.features);
        setFeaturesLoading(false);
        // Add to log
        addGenerationLog(
          `✅ ${artifactsData.features.length} Feature(s) loaded`,
        );
      } else {
        setFeaturesLoading(false);
      }

      // Small delay before User Stories
      await new Promise((resolve) => {
        const timeout = setTimeout(resolve, 100);
        pollingTimeoutRef.current = timeout;
        signal.addEventListener("abort", () => clearTimeout(timeout));
      });

      if (signal.aborted) {
        return;
      }

      // Set User Stories
      if (artifactsData.userStories && artifactsData.userStories.length > 0) {
        setUserStories(artifactsData.userStories);
        setStoriesLoading(false);
        // Add to log
        addGenerationLog(
          `✅ ${artifactsData.userStories.length} User Story/stories loaded`,
        );
      } else {
        setStoriesLoading(false);
      }

      // Small delay before Personas
      await new Promise((resolve) => {
        const timeout = setTimeout(resolve, 100);
        pollingTimeoutRef.current = timeout;
        signal.addEventListener("abort", () => clearTimeout(timeout));
      });

      if (signal.aborted) {
        return;
      }

      // Set Personas
      if (artifactsData.personas && artifactsData.personas.length > 0) {
        setPersonas(artifactsData.personas);
        setPersonasLoading(false);
      } else {
        setPersonasLoading(false);
      }

      console.log("[Workflow] Generated artifacts:", {
        epics: artifactsData.epics?.length || 0,
        features: artifactsData.features?.length || 0,
        userStories: artifactsData.userStories?.length || 0,
        personas: artifactsData.personas?.length || 0,
      });

      // DETAILED DEBUG: Log first few stories with their relationships
      if (artifactsData.userStories && artifactsData.userStories.length > 0) {
        console.log("[Workflow] === DETAILED USER STORY DEBUG ===");
        artifactsData.userStories
          .slice(0, 5)
          .forEach((story: any, idx: number) => {
            console.log(
              `Story ${idx}: id=${story.id}, featureId=${story.featureId}, epicId=${story.epicId}, title=${story.title}`,
            );
          });
      }

      if (artifactsData.features && artifactsData.features.length > 0) {
        console.log("[Workflow] === FEATURE DEBUG ===");
        artifactsData.features
          .slice(0, 3)
          .forEach((feature: any, idx: number) => {
            console.log(
              `Feature ${idx}: id=${feature.id}, epicId=${feature.epicId}, title=${feature.title}`,
            );
          });
      }

      if (signal.aborted) {
        return;
      }

      setGenerationProgress(90);
      setGenerationStep("Finalizing artifacts...");

      // Mark step 1 as complete
      // Note: We're already on step 2, so no need to navigate again
      setStep1Complete(true);
      setGenerationProgress(100);
      setGenerationStep("Complete!");

      // REAL EVENT: All artifacts loaded successfully
      addGenerationLog("All artifacts loaded successfully");

      // After artifacts are generated, update the session snapshot so resume
      // shows the backlog instead of an empty screen.
      if (sessionIdentity && effectiveSessionId) {
        try {
          const snapshotState = {
            screen: "STEP_2_GENERATED_CONTENT",
            inputs: {
              requirement,
              complianceGuidelines,
              selectedPersonaIds,
            },
            outputs: {
              epics: artifactsData.epics ?? [],
              features: artifactsData.features ?? [],
              userStories: artifactsData.userStories ?? [],
              personas: artifactsData.personas ?? [],
              wikiPages: [],
            },
          };

          await apiRequest(
            "POST",
            `/api/sessions/${effectiveSessionId}/autosave`,
            {
              state: snapshotState,
              aadObjectId: sessionIdentity.aadObjectId,
              userName: sessionIdentity.userName,
              userEmail: sessionIdentity.userEmail,
            },
          );
        } catch (e) {
          console.error(
            "[Workflow] Failed to auto-save session after generation:",
            e,
          );
        }
      }

      // Mark generation as complete
      setIsGeneratingArtifacts(false);
    } catch (error) {
      // Clear polling timeout on error to ensure polling stops
      if (pollingTimeoutRef.current) {
        clearTimeout(pollingTimeoutRef.current);
        pollingTimeoutRef.current = null;
      }

      // Don't show error if it was cancelled
      if (
        signal.aborted ||
        (error instanceof Error && error.name === "AbortError")
      ) {
        return;
      }

      console.error("Error generating artifacts:", error);
      const isPermissionError = (error as any)?.code === "PERMISSION_DENIED";

      // Try to pull a clear reason from normalized error (backend message, error, or details)
      const rawData: any = (error as any)?.response?.data ?? error;
      const backendReason: string | undefined =
        (rawData && typeof rawData === "object" && (rawData.message || rawData.error || rawData.details)) ||
        undefined;

      let errorMessage =
        (backendReason && String(backendReason)) ||
        (error instanceof Error ? error.message : undefined) ||
        (isPermissionError
          ? "You do not have permission to generate artifacts. Please contact your administrator."
          : "Failed to generate artifacts. Please try again.");

      // Avoid showing internal/minified errors in the Generation Activity Log (e.g. "Ae.error is not a function")
      if (/\.error\s+is\s+not\s+a\s+function/i.test(errorMessage)) {
        errorMessage =
          "An error occurred while generating artifacts. Please try again.";
      }

      // Show a toast that includes the concrete reason when available
      toast({
        title: isPermissionError ? "Permission denied" : "Artifact generation failed",
        description: errorMessage,
        variant: "destructive",
      });

      // Clear all loading states on error
      setEpicsLoading(false);
      setFeaturesLoading(false);
      setStoriesLoading(false);
      setPersonasLoading(false);

      // Add error message to log panel
      addGenerationLog(`❌ Error: ${errorMessage}`);

      // Mark generation as complete (with error)
      setIsGeneratingArtifacts(false);

      // Navigate back to step 1 on error so user can retry
      setCurrentStep(1);
      setShowChoiceDialog(true); // Re-show dialog on error
      setGenerationProgress(0);
      setGenerationStep("");
    } finally {
      setIsGenerating(false);
      // Don't set isGeneratingArtifacts to false here - it's set in success/error handlers
      // This allows the log panel to remain visible after completion
      abortControllerRef.current = null;
      if (pollingTimeoutRef.current) {
        clearTimeout(pollingTimeoutRef.current);
        pollingTimeoutRef.current = null;
      }
    }
  };

  // Handler for continuing to refine requirements
  const handleContinueRefining = () => {
    setShowChoiceDialog(false);

    // Add a message to indicate we're continuing
    const continueMessage: ConversationMessage = {
      id: nanoid(),
      role: "assistant",
      content:
        "Great! Let's continue refining your requirements. What else would you like to discuss or clarify?",
      timestamp: new Date(),
    };
    addConversationMessage(continueMessage);

    toast({
      title: "Continuing Conversation",
      description:
        "Let's gather more details to make your artifacts even better!",
    });
  };

  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [isContextOpen, setIsContextOpen] = useState(false);
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    const scrollContainer = scrollRef.current;
    if (!scrollContainer) return;

    // Use setTimeout to ensure DOM is updated before scrolling
    const timer = setTimeout(() => {
      // Try to find the actual scrollable viewport in ScrollArea (Radix UI)
      const viewport = scrollContainer.querySelector(
        "[data-radix-scroll-area-viewport]",
      ) as HTMLDivElement;

      if (viewport) {
        // Scroll the Radix ScrollArea viewport
        viewport.scrollTop = viewport.scrollHeight;
      } else if (scrollContainer) {
        // Fallback to direct scroll if viewport not found
        scrollContainer.scrollTop = scrollContainer.scrollHeight;
      }
    }, 0);

    return () => clearTimeout(timer);
  }, [conversationMessages, isConversationLoading]);

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      const newHeight = Math.min(textareaRef.current.scrollHeight, 120);
      textareaRef.current.style.height = `${newHeight}px`;
    }
  }, [input]);

  const handleDirectArtifactGeneration = async () => {
    console.log("[Workflow] Direct artifact generation triggered");

    // Get current input and process it for direct generation
    const currentInputValue = textareaRef.current?.value || input;
    const manualInput = currentInputValue.trim();
    const selectedRepliesText = selectedQuickReplies.join(", ");

    let finalMessage = "";
    if (manualInput && selectedRepliesText) {
      finalMessage = `${selectedRepliesText}, ${manualInput}`;
    } else if (selectedRepliesText) {
      finalMessage = selectedRepliesText;
    } else if (manualInput) {
      finalMessage = manualInput;
    }

    // Comprehensive validation before generation
    const hasFiles = uploadedFiles.length > 0;
    const hasBrd = brdAttached && selectedBrdId;
    const hasConversationHistory =
      conversationMessages.filter((m) => m.role === "user").length > 1;

    // Check for invalid input if no other content sources
    if (
      !hasFiles &&
      !hasBrd &&
      !hasConversationHistory &&
      (!finalMessage || isInvalidInput(finalMessage))
    ) {
      toast({
        title: "Invalid Input Detected",
        description: "Please provide a meaningful project description.",
        variant: "destructive",
      });

      // Focus on input for correction
      if (textareaRef.current) {
        textareaRef.current.focus();
      }
      return;
    }

    // Check for insufficient content overall
    if (
      !hasFiles &&
      !hasBrd &&
      !hasConversationHistory &&
      finalMessage &&
      !isSubstantiveInput(finalMessage)
    ) {
      toast({
        title: "More Details Needed",
        description:
          "Please provide more details about your project. What type of application are you building? Who will use it? What problems should it solve?",
        variant: "destructive",
      });

      if (textareaRef.current) {
        textareaRef.current.focus();
      }
      return;
    }

    // Final check - ensure we have some form of project information
    if (!finalMessage && !hasFiles && !hasBrd && !hasConversationHistory) {
      toast({
        title: "Project Information Required",
        description:
          "Please describe your project before generating artifacts. What are you looking to build? Include details about the type of application, target users, and key features.",
        variant: "destructive",
      });

      if (textareaRef.current) {
        textareaRef.current.focus();
      }
      return;
    }

    // Proceed with generation if validation passes
    // Add user message to conversation
    const userMessage: ConversationMessage = {
      id: nanoid(),
      role: "user",
      content: finalMessage || "Direct artifact generation requested",
      timestamp: new Date(),
    };
    addConversationMessage(userMessage);

    // Clear input
    setInput("");
    if (textareaRef.current) {
      textareaRef.current.value = "";
    }
    setSelectedQuickReplies([]);

    // Add AI response indicating direct generation
    const aiMessage: ConversationMessage = {
      id: nanoid(),
      role: "assistant",
      content:
        "Perfect! I'm analyzing your requirements and generating comprehensive Epics, Features, and User Stories directly without additional questions.\n\n**Generating artifacts...**\n\nThis may take 30-60 seconds...",
      timestamp: new Date(),
    };
    addConversationMessage(aiMessage);

    // Trigger direct artifact generation
    setTimeout(() => {
      handleGenerateArtifacts();
    }, 500);
  };

  const handleSend = async () => {
    // CRITICAL: Read input value directly from textarea element to ensure we get the latest value
    // This fixes the issue where Enter key press might not have updated the state yet
    const currentInputValue = textareaRef.current?.value || input;
    const manualInput = currentInputValue.trim();
    const selectedRepliesText = selectedQuickReplies.join(", ");

    console.log("[Workflow] handleSend called");
    console.log("[Workflow]   - input state:", input);
    console.log(
      "[Workflow]   - textareaRef.current?.value:",
      textareaRef.current?.value,
    );
    console.log(
      "[Workflow]   - manualInput (using currentInputValue):",
      manualInput,
    );
    console.log("[Workflow]   - selectedRepliesText:", selectedRepliesText);
    console.log("[Workflow]   - uploadedFiles count:", uploadedFiles.length);

    let finalMessage = "";
    if (manualInput && selectedRepliesText) {
      // Both manual input and selections - selected replies first, then manual input
      finalMessage = `${selectedRepliesText}, ${manualInput}`;
    } else if (selectedRepliesText) {
      // Only selections
      finalMessage = selectedRepliesText;
    } else if (manualInput) {
      // Only manual input
      finalMessage = manualInput;
    }

    // If user types "generate artifacts" (including common misspellings),
    // run the same direct-generation path as the quick option button.
    if (isGenerateArtifactsIntent(manualInput)) {
      await handleDirectArtifactGeneration();
      return;
    }

    console.log("[Workflow]   - finalMessage:", finalMessage);

    // Allow sending if there are files OR if there's a message (files make text optional)
    const hasFiles = uploadedFiles.length > 0;
    if ((!finalMessage && !hasFiles) || isConversationLoading) {
      console.log(
        "[Workflow]   - ⚠️ Not sending: no message and no files, or conversation loading",
      );
      return;
    }

    console.log("[Workflow]   - ✅ Sending message with files:", hasFiles);

    // If there are uploaded files, read their content and include as attachments
    let attachments: ConversationMessage["attachments"] | undefined;
    // Don't include file names in message content - files will be shown as attachments in UI
    let contentWithAttachments = finalMessage || "";

    if (uploadedFiles.length > 0) {
      // Read file content as base64 for processing
      const readFileAsBase64 = (file: File): Promise<string> => {
        return new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => {
            const result = reader.result as string;
            // Remove data URL prefix (e.g., "data:application/pdf;base64,")
            const base64Content = result.includes(",")
              ? result.split(",")[1]
              : result;
            resolve(base64Content);
          };
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });
      };

      // Read all files in parallel
      const fileContents = await Promise.all(
        uploadedFiles.map(async (file) => {
          const content = await readFileAsBase64(file);
          return {
            id: nanoid(),
            name: file.name,
            size: file.size,
            type: file.type,
            content: content, // Base64 content for server processing
          };
        }),
      );

      attachments = fileContents;

      // If no text message, use a simple indicator that files are being processed
      if (!finalMessage) {
        contentWithAttachments = ""; // Empty message, files will be shown as attachments
      }

      clearUploadedFiles();
    }

    console.log("[Workflow]   - Calling handleSendMessage with:");
    console.log(
      "[Workflow]     - contentWithAttachments:",
      contentWithAttachments,
    );
    console.log(
      "[Workflow]     - attachments count:",
      attachments?.length || 0,
    );

    handleSendMessage(contentWithAttachments, attachments);

    // Clear input state AND textarea value to ensure both are cleared
    setInput("");
    if (textareaRef.current) {
      textareaRef.current.value = "";
    }
  };

  const handleRemoveChip = (reply: string) => {
    setSelectedQuickReplies((prev) => prev.filter((r) => r !== reply));
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      console.log("[Workflow] Enter key pressed - calling handleSend");
      handleSend();
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      Array.from(files).forEach((file) => addUploadedFile(file));
    }
  };

  // Phase data for context panel
  const PHASES = [
    {
      id: "understanding",
      title: "Understanding Requirements",
      description: "Gathering business goals",
      icon: <Target className="h-4 w-4" />,
    },
    {
      id: "refining",
      title: "Refining Details",
      description: "Exploring features and constraints",
      icon: <Zap className="h-4 w-4" />,
    },
    {
      id: "personas",
      title: "Creating Personas",
      description: "Identifying user types",
      icon: <Users className="h-4 w-4" />,
    },
    {
      id: "artifacts",
      title: "Generating Artifacts",
      description: "Finalizing requirements",
      icon: <Package className="h-4 w-4" />,
    },
  ];

  const currentPhaseIndex = PHASES.findIndex((p) => p.id === conversationPhase);
  const progressPercentage = ((currentPhaseIndex + 1) / PHASES.length) * 100;

  const getPhaseStatus = (phaseId: ConversationPhase) => {
    const phaseIndex = PHASES.findIndex((p) => p.id === phaseId);
    if (phaseIndex < currentPhaseIndex) return "completed";
    if (phaseIndex === currentPhaseIndex) return "current";
    return "pending";
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[60%_40%] h-[calc(100vh-12rem)] gap-4">
      {/* Left Panel: Chat (60%) */}
      <div className="relative flex flex-col bg-background rounded-2xl shadow-lg border overflow-hidden">
        {/* Chat header: title + history (Conversation History) */}
        <div className="flex-shrink-0 flex items-center justify-between border-b px-4 md:px-6 py-3">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <MessageCircle className="h-5 w-5" />
            Requirements
          </h2>
          <Dialog open={isHistoryOpen} onOpenChange={setIsHistoryOpen}>
            <DialogTrigger asChild>
              <Button
                variant="outline"
                size="icon"
                data-testid="button-view-history"
                className="h-9 w-9 rounded-full shadow-sm"
                title="Conversation History"
              >
                <History className="h-5 w-5" />
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl max-h-[80vh] rounded-2xl">
              <DialogHeader>
                <DialogTitle className="text-xl font-semibold">
                  Conversation History
                </DialogTitle>
              </DialogHeader>
              <ScrollArea className="h-[60vh] pr-4">
                <div className="space-y-4">
                  {conversationMessages.length === 0 ? (
                    <p className="text-center text-muted-foreground py-8">
                      No messages yet. Start a conversation to see your history.
                    </p>
                  ) : (
                    conversationMessages.map((message) => (
                      <div
                        key={message.id}
                        className={cn(
                          "flex gap-3 items-start",
                          message.role === "user"
                            ? "flex-row-reverse"
                            : "flex-row",
                        )}
                        data-testid={`history-message-${message.role}-${message.id}`}
                      >
                        <Avatar className="h-8 w-8 shrink-0">
                          <AvatarFallback
                            className={
                              message.role === "assistant"
                                ? "bg-primary text-primary-foreground"
                                : "bg-muted"
                            }
                          >
                            {message.role === "assistant" ? (
                              <Bot className="h-4 w-4" />
                            ) : (
                              <User className="h-4 w-4" />
                            )}
                          </AvatarFallback>
                        </Avatar>
                        <div
                          className={cn(
                            "flex-1 rounded-xl px-4 py-3 shadow-sm",
                            message.role === "user"
                              ? "bg-primary text-primary-foreground"
                              : "bg-card border",
                          )}
                        >
                          <p className="text-sm whitespace-pre-wrap">
                            {message.content}
                          </p>
                          <p className="mt-2 text-xs opacity-70">
                            {new Date(message.timestamp).toLocaleString()}
                          </p>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </ScrollArea>
            </DialogContent>
          </Dialog>
        </div>

        {/* Chat Messages Area */}
        <ScrollArea className="flex-1 px-4 md:px-8" ref={scrollRef}>
          <div className="mx-auto max-w-4xl space-y-6 py-8">
            {conversationMessages.map((message, messageIndex) => {
              // Check if there's a subsequent assistant response after this user message
              const hasResponse =
                message.role === "user" &&
                messageIndex < conversationMessages.length - 1 &&
                conversationMessages[messageIndex + 1]?.role === "assistant";

              // Only show "Processing..." if there's no response yet and no content
              const showProcessingMessage =
                !message.content &&
                message.attachments &&
                message.attachments.length > 0 &&
                !hasResponse;

              return (
                <div
                  key={message.id}
                  className={cn(
                    "flex gap-3 md:gap-4 animate-in fade-in slide-in-from-bottom-4 duration-300",
                    message.role === "user" ? "justify-end" : "justify-start",
                  )}
                  data-testid={`message-${message.role}-${message.id}`}
                >
                  {message.role === "assistant" && (
                    <Avatar
                      className="h-10 w-10 shrink-0 shadow-md"
                      data-testid="avatar-assistant"
                    >
                      <AvatarFallback className="bg-primary text-primary-foreground">
                        <Bot className="h-5 w-5" />
                      </AvatarFallback>
                    </Avatar>
                  )}

                  <div
                    className={cn(
                      "max-w-[85%] md:max-w-[70%] rounded-2xl px-5 py-4 shadow-md",
                      message.role === "user"
                        ? "bg-primary text-primary-foreground"
                        : "bg-card border",
                    )}
                  >
                    <div className="text-sm leading-relaxed whitespace-pre-wrap font-['Inter']">
                      {message.attachments &&
                        message.attachments.length > 0 && (
                          <div
                            className={cn(
                              "flex flex-wrap gap-2",
                              message.content ? "mb-2" : "",
                            )}
                          >
                            {message.attachments.map((file, index) => (
                              <Badge
                                key={`${file.name}-${index}`}
                                variant={
                                  message.role === "user"
                                    ? "secondary"
                                    : "outline"
                                }
                                className="flex items-center gap-1 max-w-xs bg-background/60"
                              >
                                <FileIcon className="h-3 w-3" />
                                <span className="truncate">{file.name}</span>
                              </Badge>
                            ))}
                          </div>
                        )}
                      {message.content && <div>{message.content}</div>}
                      {showProcessingMessage && (
                        <div className="text-xs opacity-70 italic">
                          Processing uploaded file(s)...
                        </div>
                      )}
                    </div>
                    <p className="mt-2 text-xs opacity-70">
                      {new Date(message.timestamp).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </p>
                  </div>

                  {message.role === "user" && (
                    <Avatar
                      className="h-10 w-10 shrink-0 shadow-md"
                      data-testid="avatar-user"
                    >
                      <AvatarFallback className="bg-muted">
                        <User className="h-5 w-5" />
                      </AvatarFallback>
                    </Avatar>
                  )}
                </div>
              );
            })}

            {isConversationLoading && (
              <div
                className="flex gap-3 md:gap-4 animate-in fade-in duration-300"
                data-testid="typing-indicator"
              >
                <Avatar className="h-10 w-10 shrink-0 shadow-md">
                  <AvatarFallback className="bg-primary text-primary-foreground">
                    <Bot className="h-5 w-5" />
                  </AvatarFallback>
                </Avatar>
                <div className="rounded-2xl bg-card border px-5 py-4 shadow-md">
                  <div className="flex gap-1">
                    <div
                      className="h-2 w-2 rounded-full bg-muted-foreground animate-bounce"
                      style={{ animationDelay: "0ms" }}
                    />
                    <div
                      className="h-2 w-2 rounded-full bg-muted-foreground animate-bounce"
                      style={{ animationDelay: "150ms" }}
                    />
                    <div
                      className="h-2 w-2 rounded-full bg-muted-foreground animate-bounce"
                      style={{ animationDelay: "300ms" }}
                    />
                  </div>
                </div>
              </div>
            )}
          </div>
        </ScrollArea>

        {/* Quick Reply Chips */}
        {quickReplies &&
          quickReplies.length > 0 &&
          !isConversationLoading &&
          (!brdAttached ||
            (brdAttached &&
              quickReplies.includes(
                "Option 1: Guide me through questions",
              ))) && (
            <div className="border-t bg-muted/30 px-4 md:px-8 py-4">
              <div className="mx-auto max-w-4xl">
                <p className="text-xs text-muted-foreground mb-2 font-medium">
                  {isSingleSelect
                    ? "Choose one option:"
                    : `Quick replies ${
                        selectedQuickReplies.length > 0
                          ? `(${selectedQuickReplies.length} selected)`
                          : ""
                      }`}
                  :
                </p>
                <div className="flex flex-wrap gap-2">
                  {quickReplies.map((reply, index) => {
                    const isSelected = selectedQuickReplies.includes(reply);
                    return (
                      <Button
                        key={index}
                        variant={isSelected ? "default" : "outline"}
                        size="sm"
                        onClick={() => handleQuickReply(reply)}
                        data-testid={`quick-reply-${index}`}
                        className={cn(
                          "rounded-full hover-elevate active-elevate-2 shadow-sm transition-all",
                          isSelected &&
                            !isSingleSelect &&
                            "ring-2 ring-primary ring-offset-2",
                        )}
                      >
                        {reply}
                      </Button>
                    );
                  })}
                  {/* // {quickReplies
                  //   .filter((reply) => {
                  //     // Only show Option 2 when BRD is attached
                  //     if (!brdAttached && reply.includes("Option 2")) {
                  //       return false;
                  //     }
                  //     return true;
                  //   })
                  //   .map((reply, index) => {
                  //     const isSelected = selectedQuickReplies.includes(reply);
                  //     return (
                  //       <Button
                  //         key={index}
                  //         variant={isSelected ? "default" : "outline"}
                  //         size="sm"
                  //         onClick={() => handleQuickReply(reply)}
                  //         data-testid={`quick-reply-${index}`}
                  //         className={cn(
                  //           "rounded-full hover-elevate active-elevate-2 shadow-sm transition-all",
                  //           isSelected &&
                  //             !isSingleSelect &&
                  //             "ring-2 ring-primary ring-offset-2"
                  //         )}
                  //       >
                  //         {reply}
                  //       </Button>
                  //     );
                  //   })} */}
                </div>
              </div>
            </div>
          )}

        {/* BRD attachment and Cancel button */}
        <div className="border-t bg-background px-4 md:px-8 py-4 shadow-sm flex-shrink-0">
          <div className="mx-auto max-w-4xl flex items-center justify-between gap-4">
            {/* BRD Attachment Section */}
            <div className="flex items-center gap-3 flex-1 min-w-0">
              <div className="space-y-1 flex-1 min-w-0">
                <p className="text-sm font-semibold">Attach BRD to Workflow</p>
                <p className="text-xs text-muted-foreground">
                  Link an existing BRD version so it’s available with your
                  workflow artifacts.
                </p>
                {attachStatus && (
                  <p className="text-xs text-emerald-600 dark:text-emerald-400">
                    {attachStatus}
                  </p>
                )}
              </div>
            </div>

            {/* Buttons Section - Select BRD */}
            <div className="flex items-center gap-3 shrink-0">
              <Button
                size="sm"
                variant={brdAttached ? "secondary" : "default"}
                onClick={() => setBrdDialogOpen(true)}
                className="shrink-0"
                data-testid="button-select-brd"
                disabled={isGenerating}
              >
                {brdAttached ? "Edit BRD" : "Select BRD"}
              </Button>

              {/* Cancel button only - shown during generation */}
              {isGenerating && (
                <Button
                  onClick={handleCancelGeneration}
                  variant="outline"
                  size="lg"
                  className="shadow-md"
                  data-testid="button-cancel-generation"
                >
                  <X className="h-4 w-4 mr-2" />
                  Cancel
                </Button>
              )}
            </div>
          </div>
        </div>

        {/* Input Area */}
        <div className="border-t bg-background px-4 md:px-8 py-6 shadow-lg">
          <div className="mx-auto max-w-4xl">
            {/* Selected quick-reply chips removed: selections are tracked but not shown here */}

            {/* Pending file uploads preview */}
            {uploadedFiles.length > 0 && (
              <div className="mb-3 flex flex-wrap gap-2">
                {uploadedFiles.map((file) => (
                  <Badge
                    key={file.name}
                    variant="secondary"
                    className="flex items-center gap-1 max-w-xs"
                  >
                    <FileIcon className="h-3 w-3" />
                    <span className="truncate">{file.name}</span>
                    <button
                      type="button"
                      onClick={() => removeUploadedFile(file.name)}
                      className="ml-1 rounded-full hover:bg-background/60 p-0.5"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </Badge>
                ))}
              </div>
            )}

            <div className="flex gap-2 items-end">
              <input
                type="file"
                ref={fileInputRef}
                onChange={handleFileUpload}
                className="hidden"
                multiple
                accept=".pdf,.doc,.docx,.txt"
                data-testid="input-file-upload"
              />
              <Button
                variant="ghost"
                size="icon"
                onClick={() => fileInputRef.current?.click()}
                disabled={isConversationLoading}
                data-testid="button-attach-file"
                className="shrink-0 rounded-full shadow-sm hover-elevate"
              >
                <Paperclip className="h-5 w-5" />
              </Button>

              <Button
                variant="ghost"
                size="icon"
                onClick={() => setSettingsDialogOpen(true)}
                disabled={isConversationLoading || isGenerating}
                data-testid="button-settings"
                className="shrink-0 rounded-full shadow-sm hover-elevate"
                title="Chat Settings"
              >
                <Settings className="h-5 w-5" />
              </Button>

              <Textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={
                  uploadedFiles.length > 0
                    ? "Add a message (optional) or press Send to process files..."
                    : selectedQuickReplies.length > 0
                      ? "Add more details or press Send..."
                      : "Type your query… (or upload a file)"
                }
                disabled={isConversationLoading}
                data-testid="input-message"
                className="flex-1 min-h-[48px] max-h-[120px] resize-none rounded-2xl shadow-sm font-['Inter'] text-base"
                rows={1}
              />

              <div className="flex items-center">
                <Button
                  onClick={(e) => {
                    // Send message (same as Enter key) - this ensures both text and files are sent
                    e.preventDefault();
                    console.log(
                      "[Workflow] Send button clicked - calling handleSend",
                    );
                    handleSend();
                  }}
                  disabled={
                    (!input.trim() &&
                      !textareaRef.current?.value.trim() &&
                      selectedQuickReplies.length === 0 &&
                      uploadedFiles.length === 0 &&
                      !brdAttached) ||
                    isConversationLoading ||
                    isGenerating
                  }
                  data-testid="button-send-message"
                  className="shrink-0 rounded-l-full h-12 w-12 shadow-md border-r-0"
                  size="icon"
                  variant="default"
                >
                  {isGenerating ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Send className="h-4 w-4" />
                  )}
                </Button>

                <Popover open={showSendMenu} onOpenChange={setShowSendMenu}>
                  <PopoverTrigger asChild>
                    <Button
                      disabled={
                        (!input.trim() &&
                          !textareaRef.current?.value.trim() &&
                          selectedQuickReplies.length === 0 &&
                          uploadedFiles.length === 0 &&
                          !brdAttached) ||
                        isConversationLoading ||
                        isGenerating
                      }
                      data-testid="button-send-dropdown"
                      className="shrink-0 rounded-r-full h-12 w-8 shadow-md border-l-0 px-1"
                      size="icon"
                      variant="default"
                    >
                      <ChevronDown className="h-3 w-3" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-64 p-2" align="end">
                    <div className="space-y-1">
                      <Button
                        onClick={() => {
                          setShowSendMenu(false);
                          handleDirectArtifactGeneration();
                        }}
                        className="w-full justify-center text-left gap-2"
                        variant="ghost"
                        disabled={isConversationLoading || isGenerating}
                      >
                        <span>🛠 Generate Artifacts Directly</span>
                      </Button>
                    </div>
                  </PopoverContent>
                </Popover>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* BRD selection dialog */}
      <Dialog
        open={brdDialogOpen}
        onOpenChange={(open) => {
          setBrdDialogOpen(open);
        }}
      >
        <DialogContent
          className="max-w-[75vw] w-full max-h-[90vh] flex flex-col overflow-hidden p-0 gap-0"
          data-testid="dialog-attach-brd"
        >
          <DialogHeader className="flex-shrink-0 px-6 pt-6 pb-4 border-b border-border">
            <DialogTitle>Attach BRD</DialogTitle>
            <DialogDescription>
              Select an existing BRD to attach to this workflow.
            </DialogDescription>
          </DialogHeader>

          {/* Modal body: only this section scrolls */}
          <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden px-6 py-4 pb-6">
            <Tabs
              value={brdDialogTab}
              onValueChange={setBrdDialogTab}
              className="w-full"
            >
              <TabsList className="grid w-full grid-cols-1 mb-4">
                <TabsTrigger value="select">Select existing BRD</TabsTrigger>
              </TabsList>
              <TabsContent
                value="select"
                className="flex-1 min-h-0 flex flex-col mt-0"
              >
                {brdVersionsLoading ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span>Loading BRDs...</span>
                  </div>
                ) : brdVersions.length === 0 ? (
                  <div className="flex items-center justify-center py-8">
                    <p className="text-sm font-medium text-muted-foreground">
                      No BRDs available for this project.
                    </p>
                  </div>
                ) : (
                  <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden pr-4 -mr-4">
                    <div className="pr-4">
                      <RadioGroup
                        value={selectedBrdId || undefined}
                        onValueChange={(val) => {
                          setSelectedBrdId(val);
                          setBrdId(val); // Update workflow context
                        }}
                        className="space-y-2"
                      >
                        {brdVersions.map((v) => {
                          const isExpanded = expandedBrdIds.has(v.id);
                          const isSelected = selectedBrdId === v.id;

                          return (
                            <div
                              key={v.id}
                              className={cn(
                                "rounded-lg border transition-all duration-200",
                                isExpanded
                                  ? "border-primary/50 bg-muted/30 shadow-sm"
                                  : "hover:border-primary/50",
                                isSelected && "ring-2 ring-primary/20",
                              )}
                            >
                              {/* Collapsed header - clickable to expand/collapse */}
                              <div className="flex items-start gap-3 p-3">
                                <button
                                  type="button"
                                  className="mt-1 text-muted-foreground hover:text-foreground transition-colors flex-shrink-0"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    // Expanding automatically selects the BRD
                                    toggleBrdExpansion(v.id);
                                  }}
                                  aria-label={
                                    isExpanded
                                      ? "Collapse BRD details"
                                      : "Expand BRD details"
                                  }
                                >
                                  {isExpanded ? (
                                    <ChevronDown className="h-4 w-4" />
                                  ) : (
                                    <ChevronRight className="h-4 w-4" />
                                  )}
                                </button>
                                <RadioGroupItem
                                  value={v.id}
                                  className="mt-1 flex-shrink-0"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    // Radio selection is handled by RadioGroup's onValueChange
                                    // which calls handleBrdSelection, ensuring expansion
                                  }}
                                />
                                <div
                                  className="space-y-1 flex-1 cursor-pointer"
                                  onClick={() => {
                                    // Clicking header expands AND selects
                                    toggleBrdExpansion(v.id);
                                  }}
                                >
                                  <div className="flex items-center gap-2">
                                    <p className="text-sm font-semibold">
                                      {v.title}
                                    </p>
                                    {v.status ? (
                                      <Badge
                                        variant="outline"
                                        className={cn(
                                          "text-xs",
                                          (() => {
                                            const status = String(v.status)
                                              .toLowerCase()
                                              .trim();
                                            if (status === "approved")
                                              return "border-green-500 text-green-600 dark:text-green-400";
                                            if (
                                              status === "partially_generated"
                                            )
                                              return "border-blue-500 text-blue-600 dark:text-blue-400";
                                            if (status === "generated")
                                              return "border-purple-500 text-purple-600 dark:text-purple-400";
                                            if (status === "pending_review")
                                              return "border-yellow-500 text-yellow-600 dark:text-yellow-400";
                                            if (status === "rejected")
                                              return "border-red-500 text-red-600 dark:text-red-400";
                                            return "border-gray-500 text-gray-600 dark:text-gray-400";
                                          })(),
                                        )}
                                      >
                                        {(() => {
                                          const status = String(v.status)
                                            .toLowerCase()
                                            .trim();
                                          if (status === "approved")
                                            return "Approved";
                                          if (status === "partially_generated")
                                            return "Partially Generated";
                                          if (status === "generated")
                                            return "Generated";
                                          if (status === "pending_review")
                                            return "Pending Review";
                                          if (status === "rejected")
                                            return "Rejected";
                                          // Fallback: show the actual status value
                                          return String(v.status);
                                        })()}
                                      </Badge>
                                    ) : null}
                                  </div>
                                  <p className="text-xs text-muted-foreground">
                                    Updated:{" "}
                                    {v.updated_at
                                      ? new Date(v.updated_at).toLocaleString()
                                      : "Unknown"}
                                  </p>
                                  {/* Source document provenance */}
                                  {v.brdFileName ? (
                                    <div className="flex items-center gap-1 mt-1">
                                      <FileUp className="h-3 w-3 text-amber-500 flex-shrink-0" />
                                      <span className="text-[10px] text-amber-600 dark:text-amber-400 font-medium">Source:</span>
                                      <span className="text-[10px] text-muted-foreground truncate max-w-[160px]" title={v.brdFileName}>{v.brdFileName}</span>
                                    </div>
                                  ) : (
                                    <div className="flex items-center gap-1 mt-1">
                                      <Link2 className="h-3 w-3 text-blue-400 flex-shrink-0" />
                                      <span className="text-[10px] text-blue-500 dark:text-blue-400">Generated from form input</span>
                                    </div>
                                  )}
                                </div>
                              </div>

                              {/* Expanded content - requirements for the selected BRD */}
                              {isExpanded && (
                                <div
                                  className="px-3 pb-3 border-t border-border animate-in slide-in-from-top-2 duration-200"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  {isSelected ? (
                                    <div className="mt-3 pl-6 border-l border-dashed border-border">
                                      <div className="flex items-center justify-between mb-3">
                                        <p className="text-xs font-medium text-muted-foreground">
                                          Requirements
                                        </p>
                                        {!brdRequirementsLoading &&
                                          !brdRequirementsError &&
                                          brdRequirements.length > 0 && (
                                            <div className="flex items-center gap-1.5 border rounded-md p-0.5">
                                              <button
                                                type="button"
                                                onClick={() =>
                                                  handleSelectAllRequirements(
                                                    true,
                                                  )
                                                }
                                                className={cn(
                                                  "px-2.5 py-1 text-xs rounded transition-colors",
                                                  areAllRequirementsSelected
                                                    ? "bg-primary text-primary-foreground font-medium"
                                                    : "text-muted-foreground hover:text-foreground hover:bg-muted",
                                                )}
                                              >
                                                Select All
                                              </button>
                                              <button
                                                type="button"
                                                onClick={() =>
                                                  handleSelectAllRequirements(
                                                    false,
                                                  )
                                                }
                                                className={cn(
                                                  "px-2.5 py-1 text-xs rounded transition-colors",
                                                  !areAllRequirementsSelected &&
                                                    selectedRequirementIds.length ===
                                                      0
                                                    ? "bg-primary text-primary-foreground font-medium"
                                                    : "text-muted-foreground hover:text-foreground hover:bg-muted",
                                                )}
                                              >
                                                Deselect All
                                              </button>
                                            </div>
                                          )}
                                      </div>
                                      {brdRequirementsLoading ? (
                                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                          <Loader2 className="h-3 w-3 animate-spin" />
                                          <span>Loading requirements...</span>
                                        </div>
                                      ) : brdRequirementsError ? (
                                        <p className="text-xs text-amber-600 dark:text-amber-400">
                                          {brdRequirementsError}
                                        </p>
                                      ) : brdRequirements.length === 0 ? (
                                        <p className="text-xs text-muted-foreground">
                                          No requirements found for this BRD.
                                        </p>
                                      ) : (
                                        <ScrollArea className="h-[15rem] w-full rounded-md border border-border pr-2">
                                          <div className="space-y-2 p-2 pb-4">
                                            {sortedBrdRequirements.map(
                                              (req) => {
                                                const isChecked =
                                                  selectedRequirementIds.includes(
                                                    req.id,
                                                  );
                                                const shortDescription =
                                                  req.description &&
                                                  req.description.length > 120
                                                    ? `${req.description.slice(
                                                        0,
                                                        117,
                                                      )}...`
                                                    : req.description || "";

                                                // Map status to badge variant and color
                                                const getStatusBadgeVariant = (
                                                  status: string,
                                                ) => {
                                                  const statusLower =
                                                    status.toLowerCase();
                                                  if (statusLower === "new") {
                                                    return {
                                                      variant:
                                                        "secondary" as const,
                                                      className:
                                                        "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300 border-blue-300 dark:border-blue-700",
                                                    };
                                                  } else if (
                                                    statusLower ===
                                                    "backlog_generated"
                                                  ) {
                                                    return {
                                                      variant:
                                                        "outline" as const,
                                                      className:
                                                        "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300 border-purple-300 dark:border-purple-700",
                                                    };
                                                  } else if (
                                                    statusLower === "reviewed"
                                                  ) {
                                                    return {
                                                      variant:
                                                        "outline" as const,
                                                      className:
                                                        "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300 border-amber-300 dark:border-amber-700",
                                                    };
                                                  } else if (
                                                    statusLower === "approved"
                                                  ) {
                                                    return {
                                                      variant:
                                                        "outline" as const,
                                                      className:
                                                        "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300 border-green-300 dark:border-green-700",
                                                    };
                                                  } else if (
                                                    statusLower ===
                                                    "pushed_to_ado"
                                                  ) {
                                                    return {
                                                      variant:
                                                        "outline" as const,
                                                      className:
                                                        "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300 border-emerald-300 dark:border-emerald-700",
                                                    };
                                                  }
                                                  return {
                                                    variant:
                                                      "secondary" as const,
                                                    className: "",
                                                  };
                                                };

                                                const statusBadge =
                                                  getStatusBadgeVariant(
                                                    req.status,
                                                  );
                                                const statusDisplay = req.status
                                                  .split("_")
                                                  .map(
                                                    (word) =>
                                                      word
                                                        .charAt(0)
                                                        .toUpperCase() +
                                                      word.slice(1),
                                                  )
                                                  .join(" ");

                                                return (
                                                  <label
                                                    key={req.id}
                                                    className="flex items-start gap-2 text-xs cursor-pointer hover:bg-muted/50 p-1 rounded transition-colors"
                                                  >
                                                    <Checkbox
                                                      checked={isChecked}
                                                      onCheckedChange={(
                                                        checked,
                                                      ) =>
                                                        handleToggleRequirement(
                                                          req.id,
                                                          checked,
                                                        )
                                                      }
                                                      className="mt-0.5"
                                                    />
                                                    <span className="flex-1">
                                                      <div className="flex items-center gap-2 flex-wrap">
                                                        <span className="font-semibold">
                                                          {req.requirementName}
                                                        </span>
                                                        <Badge
                                                          variant={
                                                            statusBadge.variant
                                                          }
                                                          className={cn(
                                                            "text-xs",
                                                            statusBadge.className,
                                                          )}
                                                        >
                                                          {statusDisplay}
                                                        </Badge>
                                                      </div>
                                                      {shortDescription && (
                                                        <span className="text-muted-foreground block mt-0.5">
                                                          {shortDescription}
                                                        </span>
                                                      )}
                                                    </span>
                                                  </label>
                                                );
                                              },
                                            )}
                                          </div>
                                        </ScrollArea>
                                      )}
                                    </div>
                                  ) : (
                                    <div className="mt-3 pl-6">
                                      <p className="text-xs text-muted-foreground">
                                        Select this BRD to view its
                                        requirements.
                                      </p>
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </RadioGroup>
                    </div>
                  </div>
                )}
              </TabsContent>
            </Tabs>
          </div>

          {/* Modal footer: fixed, does not scroll */}
          <div className="flex-shrink-0 flex justify-end gap-2 px-6 py-4 border-t border-border bg-background">
            <Button variant="outline" onClick={() => setBrdDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleAttachBrdToWorkflow}
              disabled={
                attachLoading ||
                !selectedBrdId ||
                selectedRequirementIds.length === 0
              }
            >
              {attachLoading ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Attaching...
                </>
              ) : (
                "Attach BRD"
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Right Panel: Context & Progress (40%) */}
      <div className="hidden lg:flex flex-col bg-background rounded-2xl shadow-lg border overflow-hidden">
        <div className="border-b px-6 py-4">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <MessageCircle className="h-5 w-5" />
            Context & Progress
          </h2>
        </div>

        <ScrollArea className="flex-1 px-6 py-4">
          <div className="space-y-6">
            {/* Progress Tracker */}
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-base font-semibold">Progress</h3>
                <Badge variant="outline" className="text-xs">
                  {currentPhaseIndex + 1}/{PHASES.length}
                </Badge>
              </div>
              <Progress
                value={progressPercentage}
                className="h-3"
                data-testid="progress-bar"
              />

              <div className="space-y-2.5">
                {PHASES.map((phase) => {
                  const status = getPhaseStatus(phase.id as ConversationPhase);
                  return (
                    <div
                      key={phase.id}
                      className={cn(
                        "flex items-start gap-3 p-3.5 rounded-lg transition-all border",
                        status === "current" &&
                          "bg-primary/5 border-primary/30 shadow-sm",
                        status === "completed" && "border-primary/20",
                        status === "pending" && "border-muted",
                      )}
                      data-testid={`phase-${phase.id}`}
                    >
                      <div className="shrink-0 mt-0.5">
                        {status === "completed" ? (
                          <CheckCircle2 className="h-5 w-5 text-primary" />
                        ) : (
                          <Circle
                            className={cn(
                              "h-5 w-5",
                              status === "current"
                                ? "text-primary fill-primary/20"
                                : "text-muted-foreground",
                            )}
                          />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <div
                            className={cn(
                              status === "current" && "text-primary",
                            )}
                          >
                            {phase.icon}
                          </div>
                          <p
                            className={cn(
                              "text-sm font-semibold truncate",
                              status === "current" && "text-primary",
                            )}
                          >
                            {phase.title}
                          </p>
                        </div>
                        <p className="text-xs text-muted-foreground mt-1">
                          {phase.description}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <Separator />

            {/* Captured Insights */}
            <div className="space-y-5">
              <h3 className="text-base font-semibold">Captured Insights</h3>

              {capturedRequirements.businessGoals.length === 0 &&
              capturedRequirements.targetUsers.length === 0 &&
              capturedRequirements.keyFeatures.length === 0 ? (
                <div className="text-center py-8 px-4">
                  <Target className="h-8 w-8 mx-auto text-muted-foreground/50 mb-3" />
                  <p className="text-sm text-muted-foreground">
                    No insights captured yet
                  </p>
                  <p className="text-xs text-muted-foreground/70 mt-1">
                    Start the conversation to see requirements here
                  </p>
                </div>
              ) : (
                <>
                  {capturedRequirements.businessGoals.length > 0 && (
                    <div className="space-y-2.5">
                      <div className="flex items-center gap-2">
                        <Target className="h-4 w-4 text-muted-foreground" />
                        <p className="text-sm font-semibold">Business Goals</p>
                        <Badge variant="secondary" className="ml-auto text-xs">
                          {capturedRequirements.businessGoals.length}
                        </Badge>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {capturedRequirements.businessGoals.map(
                          (goal, index) => (
                            <Badge
                              key={index}
                              variant="default"
                              className="text-xs px-3 py-1"
                              data-testid={`goal-${index}`}
                            >
                              {goal}
                            </Badge>
                          ),
                        )}
                      </div>
                    </div>
                  )}

                  {capturedRequirements.targetUsers.length > 0 && (
                    <div className="space-y-2.5">
                      <div className="flex items-center gap-2">
                        <Users className="h-4 w-4 text-muted-foreground" />
                        <p className="text-sm font-semibold">Target Users</p>
                        <Badge variant="secondary" className="ml-auto text-xs">
                          {capturedRequirements.targetUsers.length}
                        </Badge>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {capturedRequirements.targetUsers.map((user, index) => (
                          <Badge
                            key={index}
                            variant="default"
                            className="text-xs px-3 py-1"
                            data-testid={`user-${index}`}
                          >
                            {user}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}

                  {capturedRequirements.keyFeatures.length > 0 && (
                    <div className="space-y-2.5">
                      <div className="flex items-center gap-2">
                        <Zap className="h-4 w-4 text-muted-foreground" />
                        <p className="text-sm font-semibold">Key Features</p>
                        <Badge variant="secondary" className="ml-auto text-xs">
                          {capturedRequirements.keyFeatures.length}
                        </Badge>
                      </div>
                      <div className="space-y-2 bg-muted/30 rounded-lg p-3">
                        {capturedRequirements.keyFeatures.map(
                          (feature, index) => (
                            <div
                              key={index}
                              className="text-xs flex items-start gap-2"
                              data-testid={`feature-${index}`}
                            >
                              <span className="text-primary mt-0.5">•</span>
                              <span className="flex-1">{feature}</span>
                            </div>
                          ),
                        )}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </ScrollArea>
      </div>

      {/* Removed blocking overlay - generation now happens in step2 with progressive skeletons */}

      {/* Choice Dialog - Generate or Continue Refining */}
      <Dialog open={showChoiceDialog} onOpenChange={setShowChoiceDialog}>
        <DialogContent className="sm:max-w-[600px]" data-testid="dialog-choice">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-xl">
              <Sparkles className="h-6 w-6 text-primary" />
              Ready to Generate Artifacts?
            </DialogTitle>
            <DialogDescription className="text-base pt-2">
              I've gathered comprehensive information about your project. You
              can now:
            </DialogDescription>
          </DialogHeader>

          {tokenInfo && (
            <div className="mt-1 mb-2 flex items-center justify-between text-sm">
              <span className="text-muted-foreground">
                Tokens Remaining:{" "}
                {tokenInfo.remainingTokens.toLocaleString()} /{" "}
                {tokenInfo.tokenQuota.toLocaleString()}
              </span>
              {tokenInfo.isDepleted ? (
                <Badge variant="destructive" className="text-xs">
                  No tokens remaining
                </Badge>
              ) : tokenInfo.lowBalance ? (
                <Badge
                  variant="outline"
                  className="text-xs border-amber-500 text-amber-700 bg-amber-50 dark:border-amber-500/70 dark:text-amber-300 dark:bg-amber-500/10"
                >
                  Low balance
                </Badge>
              ) : null}
            </div>
          )}

          <div className="space-y-4 py-4">
            <div className="grid gap-3">
              {/* Generate Artifacts Option */}
              <Button
                onClick={handleGenerateArtifacts}
                disabled={isGenerating || (tokenInfo != null && !tokenInfo.canConsume)}
                className="h-auto py-4 px-4 flex flex-col items-start gap-2 text-left"
                data-testid="button-generate-artifacts"
              >
                {isGenerating ? (
                  <>
                    <div className="flex items-center gap-2 w-full">
                      <Loader2 className="h-5 w-5 animate-spin flex-shrink-0" />
                      <span className="font-semibold">
                        Generating Artifacts...
                      </span>
                    </div>
                    <span className="text-xs text-primary-foreground/80 leading-relaxed">
                      This may take a minute. Please wait...
                    </span>
                  </>
                ) : (
                  <>
                    <div className="flex items-center gap-2 w-full">
                      <Sparkles className="h-5 w-5 flex-shrink-0" />
                      <span className="font-semibold">
                          {tokenInfo?.tokenCost != null
                            ? `Generate Artifacts (${tokenInfo.tokenCost} tokens)`
                            : "Generate Artifacts Now"}
                      </span>
                    </div>
                    <span className="text-xs text-primary-foreground/90 leading-relaxed">
                      Create AI Design Guidelines, Epics, Features, User
                      Stories, and Personas
                    </span>
                  </>
                )}
              </Button>

              {/* Continue Refining Option */}
              <Button
                variant="outline"
                onClick={handleContinueRefining}
                disabled={isGenerating}
                className="h-auto py-4 px-4 flex flex-col items-start gap-2 text-left"
                data-testid="button-continue-refining"
              >
                <div className="flex items-center gap-2 w-full">
                  <MessageSquarePlus className="h-5 w-5 flex-shrink-0" />
                  <span className="font-semibold">Continue Refining</span>
                </div>
                <span className="text-xs text-muted-foreground leading-relaxed">
                  Keep the conversation going to add more details
                </span>
              </Button>
            </div>

            <div className="bg-muted/50 rounded-lg p-3 text-xs text-muted-foreground">
              <p className="font-medium mb-1">💡 Tip:</p>
              <p>
                The more details you provide, the more accurate and
                comprehensive your artifacts will be. You can always generate
                now and refine later!
              </p>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Chat Settings Dialog */}
      <Dialog
        open={settingsDialogOpen}
        onOpenChange={(open) => {
          setSettingsDialogOpen(open);
          // When dialog opens, initialize temp values with current settings
          if (open) {
            setTempCouncilMode(councilMode);
            setTempAiEnhanceEnabled(aiEnhanceEnabled);
            setTempLlmTemperature(llmTemperature);
            setTempUseGoldenRepo(useGoldenRepo);
          }

        }}
      >
        <DialogContent className="max-w-2xl" data-testid="dialog-chat-settings">
          <DialogHeader>
            <DialogTitle>Chat Settings</DialogTitle>
            <DialogDescription>
              Configure your AI generation preferences and LLM settings.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-6 py-4">
            {/* AI Generation Mode */}
            <div className="space-y-3">
              <div className="space-y-1">
                <Label className="text-sm font-semibold">
                  AI Generation Mode
                </Label>
                <p className="text-xs text-muted-foreground">
                  Choose between single LLM or council of both available LLMs
                  (Azure OpenAI + Anthropic) for better quality.
                </p>
              </div>
              <div className="flex items-center gap-2 bg-muted rounded-lg p-1">
                <Button
                  size="sm"
                  variant={tempCouncilMode === "single" ? "default" : "ghost"}
                  onClick={() => setTempCouncilMode("single")}
                  className="px-3 py-1 h-8 text-xs flex-1"
                  disabled={isGenerating}
                >
                  Single LLM
                </Button>
                <Button
                  size="sm"
                  variant={tempCouncilMode === "council" ? "default" : "ghost"}
                  onClick={() => setTempCouncilMode("council")}
                  className="px-3 py-1 h-8 text-xs flex-1"
                  disabled={isGenerating}
                >
                  LLM Council
                </Button>
              </div>
            </div>

            <Separator />

            {/* AI Enhance Switch */}
            <div className="flex items-center justify-between gap-4">
              <div className="space-y-1 flex-1">
                <Label className="text-sm font-semibold">AI Enhance</Label>
                <p className="text-xs text-muted-foreground">
                  When enabled, AI will enhance and improve the content of
                  generated artifacts. When disabled, artifact content will
                  match the approved BRD exactly.
                </p>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <Switch
                  checked={tempAiEnhanceEnabled}
                  onCheckedChange={setTempAiEnhanceEnabled}
                  disabled={isGenerating}
                  data-testid="switch-ai-enhance"
                />
                <span className="text-sm text-muted-foreground min-w-[35px]">
                  {tempAiEnhanceEnabled ? "On" : "Off"}
                </span>
              </div>
            </div>
            
            <Separator />

            {/* Golden Repo (RAG) Switch */}
            <div className="flex items-center justify-between gap-4">
              <div className="space-y-1 flex-1">
                <Label className="text-sm font-semibold">Golden Repo guidance (RAG)</Label>
                <p className="text-xs text-muted-foreground">
                  When enabled, AI will use organizational guidelines and best practices 
                  from the Golden Repo to guide artifact generation.
                </p>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <Switch
                  checked={tempUseGoldenRepo}
                  onCheckedChange={setTempUseGoldenRepo}
                  disabled={isGenerating}
                  data-testid="switch-use-golden-repo"
                />
                <span className="text-sm text-muted-foreground min-w-[35px]">
                  {tempUseGoldenRepo ? "On" : "Off"}
                </span>
              </div>
            </div>


            <Separator />

            {/* LLM Temperature Slider */}
            <div className="space-y-3">
              <div className="space-y-1">
                <Label className="text-sm font-semibold">LLM Temperature</Label>
                <p className="text-xs text-muted-foreground">
                  Control the creativity and randomness of AI responses. Lower
                  values (0.1-0.3) produce more focused and deterministic
                  outputs. Higher values (0.7-1.0) produce more creative and
                  varied outputs.
                </p>
              </div>
              <div className="space-y-2 px-2">
                <Slider
                  value={[tempLlmTemperature]}
                  onValueChange={(value) => setTempLlmTemperature(value[0])}
                  min={0}
                  max={1}
                  step={0.1}
                  disabled={isGenerating}
                  className="w-full"
                  data-testid="slider-temperature"
                />
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>0.0 (Deterministic)</span>
                  <span className="font-semibold text-foreground">
                    {tempLlmTemperature.toFixed(1)}
                  </span>
                  <span>1.0 (Creative)</span>
                </div>
              </div>
            </div>
          </div>

          <div className="flex justify-between gap-2 pt-4 border-t">
            <Button
              onClick={() => {
                // Reset to default values
                setTempCouncilMode("single");
                setTempAiEnhanceEnabled(false);
                setTempLlmTemperature(0.7);
                setTempUseGoldenRepo(true);
              }}

              variant="outline"
              data-testid="button-reset-settings"
            >
              Reset to Default
            </Button>
            <div className="flex gap-2">
              <Button
                onClick={() => setSettingsDialogOpen(false)}
                variant="outline"
              >
                Cancel
              </Button>
              <Button
                onClick={() => {
                  // Apply the temporary values to actual state
                  setCouncilMode(tempCouncilMode);
                  setAiEnhanceEnabled(tempAiEnhanceEnabled);
                  setLlmTemperature(tempLlmTemperature);
                  setUseGoldenRepo(tempUseGoldenRepo);
                  setSettingsDialogOpen(false);
                  toast({
                    title: "Settings saved",
                    description: "Your chat settings have been applied.",
                  });
                }}
                data-testid="button-apply-settings"
              >
                Apply
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
