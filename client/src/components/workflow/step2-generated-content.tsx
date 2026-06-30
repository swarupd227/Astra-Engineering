import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { MarkdownTextarea } from "@/components/ui/markdown-textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  FileText,
  Copy,
  Download, ChevronRight,
  ChevronDown,
  ChevronUp,
  Search, ArrowUp,
  ArrowLeft,
  BookOpen,
  Sparkles,
  CheckCircle,
  X,
  Edit,
  Lightbulb,
  ClipboardCheck,
  PenTool,
  Code,
  Rocket,
  FileCode,
  SortAsc,
  Save,
  GripVertical,
  RotateCcw,
  Plus,
  Loader2,
  Merge,
  Undo2,
  Folder,
  AlertCircle,
  ListChecks
} from "lucide-react";
import { useWorkflow } from "@/context/workflow-context";
import { useSDLCProject } from "@/context/sdlc-project-context";
import { useSearch } from "wouter";
import { ArtifactEditDialog } from "./artifact-edit-dialog";
import { ExportArtifacts } from "./export-artifacts";
import { useEpicMerge, type MergeGroupInput } from "./use-epic-merge";
import { BulkMergeDialog } from "./bulk-merge-dialog";
import { useMsal } from "@azure/msal-react";
import { useSessionIdentity } from "@/utils/msal-user";
import { WikiEditDialog } from "./wiki-edit-dialog";
import { WikiPageModal } from "./wiki-page-modal";
import type { UserStory, WikiPage, Epic, Feature } from "@shared/schema";
import toast from "react-hot-toast";
import { useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { getApiUrl } from "@/lib/api-config";
import { AiEnhanceWithDiff } from "@/components/AiEnhanceWithDiff";
import { getDescriptionLocationKey } from "@/config/ai-enhance-locations";
import { cn } from "@/lib/utils";
import { getIntegrationLabels } from "@/lib/integration-config";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { ScrollArea } from "@/components/ui/scroll-area";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const priorityColors = {
  High: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
  Medium:
    "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400",
  Low: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
};

const personaColors = {
  blue: "bg-blue-500",
  green: "bg-emerald-500",
  purple: "bg-purple-500",
  orange: "bg-orange-500",
  red: "bg-red-500",
};

const phaseConfig = {
  planning: {
    label: "Planning",
    icon: Lightbulb,
    color: "text-yellow-600 dark:text-yellow-400",
    bgColor: "bg-yellow-50 dark:bg-yellow-950/20",
    borderColor: "border-yellow-200 dark:border-yellow-800",
  },
  requirements: {
    label: "Requirements",
    icon: ClipboardCheck,
    color: "text-blue-600 dark:text-blue-400",
    bgColor: "bg-blue-50 dark:bg-blue-950/20",
    borderColor: "border-blue-200 dark:border-blue-800",
  },
  design: {
    label: "Design",
    icon: PenTool,
    color: "text-purple-600 dark:text-purple-400",
    bgColor: "bg-purple-50 dark:bg-purple-950/20",
    borderColor: "border-purple-200 dark:border-purple-800",
  },
  implementation: {
    label: "Implementation",
    icon: Code,
    color: "text-emerald-600 dark:text-emerald-400",
    bgColor: "bg-emerald-50 dark:bg-emerald-950/20",
    borderColor: "border-emerald-200 dark:border-emerald-800",
  },
  testing: {
    label: "Testing",
    icon: Code, // Using Code icon instead of TestTube
    color: "text-orange-600 dark:text-orange-400",
    bgColor: "bg-orange-50 dark:bg-orange-950/20",
    borderColor: "border-orange-200 dark:border-orange-800",
  },
  deployment: {
    label: "Deployment",
    icon: Rocket,
    color: "text-red-600 dark:text-red-400",
    bgColor: "bg-red-50 dark:bg-red-950/20",
    borderColor: "border-red-200 dark:border-red-800",
  },
  reference: {
    label: "Reference",
    icon: FileCode,
    color: "text-gray-600 dark:text-gray-400",
    bgColor: "bg-gray-50 dark:bg-gray-950/20",
    borderColor: "border-gray-200 dark:border-gray-800",
  },
};

type SelectedItem = (Epic | Feature | UserStory) & {
  type: "epic" | "feature" | "story";
};

export function Step2GeneratedContent() {
  const {
    guidelines,
    epics,
    features,
    userStories,
    personas,
    setCurrentStep,
    requirement,
    setRequirement,
    setUserRequirementSummary,
    sessionId,
    setSessionId,
    wikiPages: contextWikiPages,
    setWikiPages,
    setEpics,
    setFeatures,
    setUserStories,
    regenerateArtifacts,
    projectId,
    sdlcProjectId,
    selectedRequirementIds,
    brdId: contextBrdId,
    setBrdId,
    projectName,
    processedFileRequirements,
    epicsLoading,
    featuresLoading,
    storiesLoading,
    personasLoading,
    isGenerating,
    setIsGenerating,
    cancelGeneration,
    isGeneratingArtifacts,
    addGenerationLog,
    // Selection state for push functionality
    selectedEpics: workflowSelectedEpics,
    selectedFeatures: workflowSelectedFeatures,
    selectedStories: workflowSelectedStories,
    selectedWikiPages: workflowSelectedWikiPages,
    toggleEpic: workflowToggleEpic,
    toggleFeature: workflowToggleFeature,
    toggleStory: workflowToggleStory,
    toggleWikiPage: workflowToggleWikiPage,
    setSelectedEpics: setWorkflowSelectedEpics,
    setSelectedFeatures: setWorkflowSelectedFeatures,
    setSelectedStories: setWorkflowSelectedStories,
    selectAllUnpushed,
    deselectAll,
    // Pushed status tracking
    pushedEpics,
    pushedFeatures,
    pushedStories,
    pushedWikiPages,
    setPushedEpics,
    setPushedFeatures,
    setPushedStories,
    setPushedWikiPages,
    integrationType,
    // Azure and repository config for directory naming
    azureConfig,
    repositoryConfig,
    setGuidelines,
    qualityReport,
  } = useWorkflow();
  // Get real organization and project info from SDLC context
  const { projectConfig } = useSDLCProject();
  const sessionIdentity = useSessionIdentity();
  const search = useSearch();
  const urlParams = new URLSearchParams(search);
  const urlOrganizationName = urlParams.get("organizationName");
  const urlProjectName = urlParams.get("projectName");
  const [expandedEpics, setExpandedEpics] = useState<Set<string>>(new Set());
  const [expandedFeatures, setExpandedFeatures] = useState<Set<string>>(
    new Set()
  );
  const [selectedItem, setSelectedItem] = useState<SelectedItem | null>(null);
  const [selectedEpics, setSelectedEpics] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedWikiPage, setSelectedWikiPage] = useState<WikiPage | null>(
    null
  );
  const [filterType, setFilterType] = useState<"all" | "epics" | "features" | "stories">("all");
  const [sortBy, setSortBy] = useState<"title-asc" | "title-desc" | "priority" | "none">("none");

  // Bulk merge dialog visibility (+ whether to auto-run AI suggestions on open)
  const [bulkMergeOpen, setBulkMergeOpen] = useState(false);
  const [bulkAutoSuggest, setBulkAutoSuggest] = useState(false);

  // Epic merge: single, bulk multi-group, AI suggestions, and undo
  const {
    mergeHistory,
    isMerging,
    isSuggesting,
    mergeGroups,
    mergeSelected,
    mergeFeatureGroups,
    mergeStoryGroups,
    suggestMergesFor,
    undoMerge,
  } = useEpicMerge({
    epics,
    features,
    userStories,
    setEpics,
    setFeatures,
    setUserStories,
    requirement,
    projectName,
    onMergeComplete: (mergedSourceIds) => {
      setSelectedEpics(new Set());
      mergedSourceIds.forEach((id) => {
        if (workflowSelectedEpics.has(id)) {
          workflowToggleEpic(id);
        }
      });
    },
  });

  // Epics eligible for merging (exclude already-pushed epics).
  const mergeableEpics = epics.filter((epic) => !pushedEpics.has(epic.id));
  const mergeableFeatures = features.filter((feature) => !pushedFeatures.has(feature.id));
  const mergeableStories = userStories.filter((story) => !pushedStories.has(story.id));

  // Title lookups so the bulk-merge dialog can show each item's parent.
  const epicTitleById = Object.fromEntries(epics.map((e) => [e.id, e.title]));
  const featureTitleById = Object.fromEntries(features.map((f) => [f.id, f.title]));

  const handleBulkSuggest = (kind: "epic" | "feature" | "userStory", candidateIds: string[]) =>
    suggestMergesFor(kind, candidateIds);

  const handleBulkMerge = async (kind: "epic" | "feature" | "userStory", groups: MergeGroupInput[]) => {
    if (kind === "epic") return mergeGroups(groups);
    if (kind === "feature") return mergeFeatureGroups(groups);
    return mergeStoryGroups(groups);
  };

  // Helper function to extract content for specific epic/feature combination
  const extractFeatureContent = (fullContent: string, epic: string, feature: string): string => {
    if (!fullContent) return 'No content available';

    // Look for epic and feature markers in the content
    const epicMarker = `## Epic: ${epic}`;
    const featureMarker = `Feature: ${feature}`;

    const lines = fullContent.split('\n');
    let inTargetSection = false;
    let sectionContent: string[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      if (line.includes(epicMarker) && lines[i + 1]?.includes(featureMarker)) {
        inTargetSection = true;
        sectionContent.push(line);
        continue;
      }

      if (inTargetSection) {
        // Stop when we hit another epic marker
        if (line.startsWith('## Epic:') && !line.includes(epicMarker)) {
          break;
        }
        sectionContent.push(line);
      }
    }

    return sectionContent.length > 0 ? sectionContent.join('\n') : fullContent;
  };

  const handleDownloadQAReport = () => {
    if (!qualityReport) return;
    const reportLines: string[] = [];
    reportLines.push("═══════════════════════════════════════════════════════════════");
    reportLines.push("                    QUALITY AGENT REPORT                       ");
    reportLines.push("═══════════════════════════════════════════════════════════════");
    reportLines.push("");
    reportLines.push(`Generated: ${new Date().toISOString()}`);
    reportLines.push(`Total Duration: ${qualityReport.totalDuration || 'N/A'}s`);
    reportLines.push("");
    if (qualityReport.deduplicationStats) {
      reportLines.push("── DEDUPLICATION & CLEANUP ────────────────────────────────────");
      reportLines.push(`  Duplicate Epics Removed: ${qualityReport.deduplicationStats.epicsRemoved || 0}`);
      reportLines.push(`  Duplicate Features Removed: ${qualityReport.deduplicationStats.featuresRemoved || 0}`);
      reportLines.push(`  Duplicate Stories Removed: ${qualityReport.deduplicationStats.storiesRemoved || 0}`);
      reportLines.push(`  Stories Generated for Empty Features: ${qualityReport.deduplicationStats.storiesGeneratedForEmptyFeatures || 0}`);
      reportLines.push(`  Orphan Epics Removed (0 features): ${qualityReport.deduplicationStats.orphanEpicsRemoved || 0}`);
      reportLines.push("");
    }
    if (qualityReport.brdCoverage) {
      const cov = qualityReport.brdCoverage;
      reportLines.push("── BRD COVERAGE ──────────────────────────────────────────────");
      reportLines.push(`  Total Requirements: ${cov.totalRequirements}`);
      reportLines.push(`  Fully Covered: ${cov.fullyCovered}`);
      reportLines.push(`  Partially Covered: ${cov.partiallyCovered}`);
      reportLines.push(`  Uncovered: ${cov.uncovered}`);
      reportLines.push(`  Coverage %: ${cov.coveragePercentage}%`);
      reportLines.push(`  Gap Stories Generated: ${cov.gapStoriesGenerated || 0}`);
      reportLines.push("");
      if (cov.details && Array.isArray(cov.details)) {
        reportLines.push("  Requirement Details:");
        for (const detail of cov.details) {
          const strengthIcon = detail.coverageStrength === 'full' ? '[FULL]' : detail.coverageStrength === 'partial' ? '[PARTIAL]' : '[NONE]';
          reportLines.push(`    ${strengthIcon} ${detail.requirementId}: ${detail.requirementName}`);
          if (detail.coveringStories && detail.coveringStories.length > 0) {
            reportLines.push(`      Covering Stories: ${detail.coveringStories.join(', ')}`);
          }
        }
        reportLines.push("");
      }
    }
    if (qualityReport.architecturalLayers) {
      const arch = qualityReport.architecturalLayers;
      reportLines.push("── ARCHITECTURAL LAYERS ──────────────────────────────────────");
      reportLines.push(`  Covered: ${arch.covered}/${arch.totalLayers}`);
      if (arch.missing && arch.missing.length > 0) {
        reportLines.push(`  Missing: ${arch.missing.join(', ')}`);
      }
      reportLines.push("");
      if (arch.details && Array.isArray(arch.details)) {
        for (const layer of arch.details) {
          const status = layer.covered ? '[COVERED]' : '[MISSING]';
          reportLines.push(`    ${status} ${layer.layerName}`);
        }
        reportLines.push("");
      }
    }
    reportLines.push("═══════════════════════════════════════════════════════════════");
    const blob = new Blob([reportLines.join('\n')], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `qa-quality-report-${new Date().toISOString().slice(0, 10)}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Derive disabled state for artifact-dependent actions
  const isArtifactActionsDisabled = isGeneratingArtifacts;

  // Warn user before leaving/refreshing page - they will lose all generated data
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      // Only warn if there are generated artifacts
      if (epics.length > 0 || features.length > 0 || userStories.length > 0) {
        e.preventDefault();
        e.returnValue =
          "⚠️ WARNING: You have unsaved generated artifacts (Epics, Features, User Stories). Refreshing or leaving this page will cause you to LOSE ALL GENERATED DATA. Are you sure you want to continue?";
        return e.returnValue;
      }
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, [epics.length, features.length, userStories.length]);

  // Cleanup Mermaid error messages that appear outside wiki components
  useEffect(() => {
    const cleanupMermaidErrors = () => {
      // Find and remove any text nodes containing Mermaid error messages
      const walker = document.createTreeWalker(
        document.body,
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
        // Only remove if not inside a wiki component or mermaid diagram
        const parent = node.parentElement;
        if (parent &&
          !parent.closest('.wiki-content') &&
          !parent.closest('.mermaid-diagram') &&
          !parent.closest('.mermaid-rendered')) {
          nodesToRemove.push(node);
        }
      }

      nodesToRemove.forEach(node => {
        if (node.parentNode) {
          node.parentNode.removeChild(node);
        }
      });

      // Also remove any divs or elements containing error messages
      const allElements = document.querySelectorAll('div, span, p, pre');
      allElements.forEach(el => {
        const text = el.textContent || '';
        if ((text.includes('mermaid version') ||
          text.includes('error in text') ||
          text.includes('Syntax error in text')) &&
          !el.closest('.wiki-content') &&
          !el.closest('.mermaid-diagram') &&
          !el.closest('.mermaid-rendered')) {
          el.remove();
        }
      });
    };

    // Run cleanup immediately and then periodically
    cleanupMermaidErrors();
    const interval = setInterval(cleanupMermaidErrors, 500);

    return () => clearInterval(interval);
  }, []);

  // Inline editing state for right panel
  const [isEditingDescription, setIsEditingDescription] = useState(false);
  const [isEditingACs, setIsEditingACs] = useState(false);
  const [isEditingSubtasks, setIsEditingSubtasks] = useState(false);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [editedTitle, setEditedTitle] = useState("");
  const [editedDescription, setEditedDescription] = useState("");
  const [editedACs, setEditedACs] = useState<any[]>([]);
  const [editedSubtasks, setEditedSubtasks] = useState<string[]>([]);

  // Edit dialog state
  const [editingArtifact, setEditingArtifact] = useState<
    Epic | Feature | UserStory | null
  >(null);
  const [editingArtifactType, setEditingArtifactType] = useState<
    "epic" | "feature" | "story" | null
  >(null);
  const [editingWikiPage, setEditingWikiPage] = useState<WikiPage | null>(null);

  // Resizable panel width
  const [rightPanelWidth, setRightPanelWidth] = useState(40); // percentage
  const [isResizing, setIsResizing] = useState(false);
  const [isAttachingBrd, setIsAttachingBrd] = useState(false);
  const [brdDialogOpen, setBrdDialogOpen] = useState(false);
  const [approvedBrds, setApprovedBrds] = useState<
    Array<{ id: string; title: string; status?: string; updated_at: string }>
  >([]);
  const [brdsLoading, setBrdsLoading] = useState(false);
  const [selectedBrdId, setSelectedBrdId] = useState<string | null>(null);
  const [isWikiExpanded, setIsWikiExpanded] = useState(false);
  const [isBacklogExpanded, setIsBacklogExpanded] = useState(true);

  // Wiki generation polling state
  const [isGeneratingWiki, setIsGeneratingWiki] = useState(false);
  const [wikiJobId, setWikiJobId] = useState<string | null>(null);
  const [wikiProgress, setWikiProgress] = useState(0);
  const [wikiStep, setWikiStep] = useState<string>("");
  const [showJiraReminder, setShowJiraReminder] = useState(false);
  const pollingTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (pollingTimeoutRef.current) {
        clearTimeout(pollingTimeoutRef.current);
      }
    };
  }, []);

  // Mouse event handlers for resizing
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing) return;
      const newWidth =
        ((window.innerWidth - e.clientX) / window.innerWidth) * 100;
      if (newWidth >= 30 && newWidth <= 60) {
        setRightPanelWidth(newWidth);
      }
    };

    const handleMouseUp = () => {
      setIsResizing(false);
    };

    if (isResizing) {
      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
    }

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isResizing]);

  // Fetch wiki pages for this session
  const { data: wikiData } = useQuery<{ pages: WikiPage[] }>({
    queryKey: ["/api/wiki/session", sessionId],
    enabled: !!sessionId,
  });

  const wikiPages = (wikiData?.pages && wikiData.pages.length > 0)
    ? wikiData.pages
    : (contextWikiPages && contextWikiPages.length > 0 ? contextWikiPages : []);

  useEffect(() => {
    if (wikiData?.pages) {
      setWikiPages(wikiData.pages);
    }
  }, [wikiData, setWikiPages]);

  // Load available BRDs for the active project (excluding draft and review)
  useEffect(() => {
    const pid = projectId || sdlcProjectId;
    if (!pid) {
      setApprovedBrds([]);
      setSelectedBrdId(null);
      setBrdId(null);
      return;
    }

    const fetchApprovedBrds = async () => {
      try {
        setBrdsLoading(true);
        const res = await apiRequest(
          "GET",
          `/api/dev-brd/approved?projectId=${encodeURIComponent(pid)}`
        );
        const data = await res.json();
        if (res.ok && Array.isArray(data)) {
          setApprovedBrds(data);
          // Preserve BRD selected in Step1 (e.g. uploaded & attached) if it's in the list
          const contextBrdInList = contextBrdId && data.some((b: { id: string }) => b.id === contextBrdId);
          const brdIdToSelect = contextBrdInList ? contextBrdId : (data[0]?.id ?? null);
          setSelectedBrdId(brdIdToSelect);
          setBrdId(brdIdToSelect); // Update workflow context
        } else {
          setApprovedBrds([]);
          setSelectedBrdId(null);
          setBrdId(null);
        }
      } catch (error) {
        console.error("[Workflow] Failed to load available BRDs", error);
        setApprovedBrds([]);
        setSelectedBrdId(null);
        setBrdId(null);
      } finally {
        setBrdsLoading(false);
      }
    };

    fetchApprovedBrds();
  }, [projectId, sdlcProjectId, setBrdId, contextBrdId]);

  const handleAttachBrdToWorkflow = async () => {
    if (!projectId && !sdlcProjectId) {
      toast.error("No project selected. Please select a project first.");
      return;
    }
    if (!selectedBrdId) {
      toast.error("Please select a BRD to attach.");
      return;
    }

    setIsAttachingBrd(true);
    try {
      // Ensure we have a workflow session (create one if missing)
      let workflowId = sessionId;
      if (!workflowId) {
        const pid = projectId || sdlcProjectId;
        if (!pid?.trim() || !sessionIdentity) {
          setIsAttachingBrd(false);
          toast.error(
            "Sign in and select a project, or start from Step 1 to create a workflow session."
          );
          return;
        }
        const createRes = await apiRequest("POST", "/api/sessions", {
          projectId: pid,
          initialState: {
            screen: "STEP_2_GENERATED_CONTENT",
            inputs: {},
            outputs: {},
          },
        });
        const createJson = await createRes.json();
        const newSession = createJson?.session as { id?: string } | undefined;
        if (!newSession?.id) {
          throw new Error("Failed to create workflow session");
        }
        workflowId = newSession.id;
        setSessionId(workflowId);
      }
      const attachRes = await apiRequest(
        "POST",
        "/api/workflow/attach-dev-brd",
        {
          workflowId,
          brdId: selectedBrdId,
          attachedBy: workflowId,
        }
      );
      const attachJson = await attachRes.json();
      if (!attachRes.ok || !attachJson?.success) {
        throw new Error(
          attachJson?.error || "Failed to attach BRD to workflow"
        );
      }

      // If server returned a summarized BRD, attach it to workflow context
      const attachedBrd = approvedBrds.find((b) => b.id === selectedBrdId);
      if (attachJson?.summary) {
        try {
          setUserRequirementSummary(attachJson.summary);
          setRequirement(attachJson.summary);
          toast.success(
            `BRD "${attachedBrd?.title || "Unknown"
            }" summarized and attached to workflow`
          );
        } catch (err) {
          console.warn("Failed to apply BRD summary to workflow state:", err);
          toast.success(
            `BRD "${attachedBrd?.title || "Unknown"
            }" attached to workflow successfully`
          );
        }
      } else {
        toast.success(
          `BRD "${attachedBrd?.title || "Unknown"
          }" attached to workflow successfully`
        );
      }
      setBrdDialogOpen(false);
    } catch (error: any) {
      toast.error(
        error instanceof Error ? error.message : "Failed to attach BRD"
      );
    } finally {
      setIsAttachingBrd(false);
    }
  };

  // Poll wiki generation job status
  const pollWikiJobStatus = async (jobId: string): Promise<void> => {
    try {
      const response = await apiRequest(
        "GET",
        `/api/wiki/generate/status/${jobId}`
      );

      // Check for error status codes (failed jobs return 500, not found returns 404)
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const errorMessage = errorData.error || `Failed to fetch job status (${response.status})`;

        // Clear polling timeout on error
        if (pollingTimeoutRef.current) {
          clearTimeout(pollingTimeoutRef.current);
          pollingTimeoutRef.current = null;
        }

        setIsGeneratingWiki(false);
        setWikiJobId(null);

        // If status is 500, it means the job failed - show error and stop polling
        if (response.status === 500) {
          console.error(`[Wiki] Job ${jobId} failed with status 500:`, errorMessage);
          toast.error(`Failed to generate ${integrationType === "jira" ? "Confluence pages" : "Wiki"}: ${errorMessage}`);
          return; // Stop polling
        }

        // If status is 404, job not found - show error and stop polling
        if (response.status === 404) {
          console.error(`[Wiki] Job ${jobId} not found (404)`);
          toast.error(`${integrationType === "jira" ? "Confluence" : "Wiki"} generation job not found. It may have expired.`);
          return; // Stop polling
        }

        // For other errors, show error and stop polling
        console.error(`[Wiki] Error fetching job status for ${jobId}:`, errorMessage);
        toast.error(`Failed to check ${integrationType === "jira" ? "Confluence" : "Wiki"} generation status: ${errorMessage}`);
        return; // Stop polling
      }

      const status = await response.json();

      setWikiProgress(status.progress || 0);
      setWikiStep(status.step || "");

      if (status.status === "completed") {
        // Clear polling timeout
        if (pollingTimeoutRef.current) {
          clearTimeout(pollingTimeoutRef.current);
          pollingTimeoutRef.current = null;
        }

        setIsGeneratingWiki(false);
        setWikiJobId(null);
        setWikiProgress(100);
        setWikiStep("Completed");

        const savedWikiPages: WikiPage[] = status.result?.pages ?? [];

        // Capture the sessionId the server used (may differ from client-side if it was auto-generated)
        const serverSessionId = status.result?.sessionId;
        if (serverSessionId && (!sessionId || sessionId.trim().length === 0)) {
          setSessionId(serverSessionId);
        }

        // Update context immediately so UI shows wiki without waiting for refetch
        if (savedWikiPages.length > 0) {
          setWikiPages(savedWikiPages);
        }

        // Refresh wiki pages from server (in case of any extra normalization)
        const querySessionId = serverSessionId || sessionId;
        if (querySessionId) {
          queryClient.invalidateQueries({
            queryKey: ["/api/wiki/session", querySessionId],
          });
        }

        // Persist step 2 to session so wiki (and artifacts/design prompt) are restored when resuming
        if (sessionId && savedWikiPages.length > 0 && sessionIdentity) {
          const testCases = userStories.flatMap((s) =>
            (Array.isArray((s as any).testCases) ? (s as any).testCases : []).map(
              (tc: any) => ({ ...tc, userStoryId: s.id })
            )
          );
          const step2Data = {
            epics,
            features,
            userStories,
            personas,
            wikiPages: savedWikiPages,
            guidelines: guidelines ?? null,
            testCases,
          };
          fetch(getApiUrl(`/api/sessions/${sessionId}/workflow-steps/2`), {
            method: "POST",
            credentials: "include",
            headers: {
              "Content-Type": "application/json",
              "X-AAD-Object-ID": sessionIdentity.aadObjectId,
              "X-User-Email": sessionIdentity.userEmail,
              "X-User-Name": sessionIdentity.userName,
            },
            body: JSON.stringify({
              stepName: "artifact_generation",
              step2Data,
            }),
          })
            .then((r) => {
              if (!r.ok) {
                console.warn(
                  "[Step2] Failed to persist step 2 with wiki to session. Status:",
                  r.status
                );
              }
            })
            .catch((err) => {
              console.warn("[Step2] Failed to persist step 2 with wiki to session:", err);
            });
        }

        // Auto-expand wiki section
        setIsWikiExpanded(true);

        // Show success toast
        toast.success(
          `${integrationType === "jira" ? "Confluence" : "Wiki"} documentation generated successfully! (${status.result?.count || 0
          } pages)`
        );
      } else if (status.status === "failed") {
        // Clear polling timeout
        if (pollingTimeoutRef.current) {
          clearTimeout(pollingTimeoutRef.current);
          pollingTimeoutRef.current = null;
        }

        setIsGeneratingWiki(false);
        setWikiJobId(null);
        const errorMessage = status.error || "Unknown error";
        console.error(`[Wiki] Job ${jobId} failed:`, errorMessage);
        toast.error(`Failed to generate ${integrationType === "jira" ? "Confluence pages" : "Wiki"}: ${errorMessage}`);
        // Stop polling - don't continue
      } else if (status.status === "processing" || status.status === "pending") {
        // Continue polling only for processing/pending status
        pollingTimeoutRef.current = setTimeout(
          () => pollWikiJobStatus(jobId),
          2000
        ); // Poll every 2 seconds
      } else {
        // Unknown status - stop polling to avoid infinite loop
        console.error(`[Wiki] Unknown job status for ${jobId}: ${status.status}. Stopping polling.`);
        if (pollingTimeoutRef.current) {
          clearTimeout(pollingTimeoutRef.current);
          pollingTimeoutRef.current = null;
        }
        setIsGeneratingWiki(false);
        setWikiJobId(null);
        toast.error(`${integrationType === "jira" ? "Confluence" : "Wiki"} generation stopped: Unknown status "${status.status}"`);
        // Stop polling - don't continue
      }
    } catch (error) {
      // Clear polling timeout on error
      if (pollingTimeoutRef.current) {
        clearTimeout(pollingTimeoutRef.current);
        pollingTimeoutRef.current = null;
      }

      console.error(`[Wiki] Error polling job status for ${jobId}:`, error);
      setIsGeneratingWiki(false);
      setWikiJobId(null);
      toast.error(
        `Failed to check ${integrationType === "jira" ? "Confluence" : "Wiki"} generation status: ${error instanceof Error ? error.message : "Unknown error"
        }`
      );
      // Stop polling on error
    }
  };

  const handleDismissJiraReminder = () => {
    setShowJiraReminder(false);
  };

  // Start wiki generation with polling
  // Start wiki generation logic
  const executeWikiGeneration = async () => {
    setIsGeneratingWiki(true);
    setWikiProgress(0);
    setWikiStep("Starting...");

    try {
      // Ensure we always send some requirement text to the backend.
      // For resumed sessions, prefer BRD + Epics context so wiki has rich input.
      let requirementText = (requirement || "").trim();
      if (!requirementText) {
        const hasBrd = processedFileRequirements && processedFileRequirements.trim().length > 0;
        const epicTitles =
          epics && epics.length > 0
            ? epics.map((e) => `- ${e.title}`).join("\n")
            : "";

        if (hasBrd) {
          // Combine BRD-derived functional requirements with a high-level epic list
          requirementText = `Functional requirements extracted from BRD:\n\n${processedFileRequirements!.trim()}`;
          if (epicTitles) {
            requirementText += `\n\nEpics generated from these requirements:\n${epicTitles}`;
          }
        } else if (epics.length > 0) {
          requirementText =
            epics[0].description ||
            epics[0].title ||
            "Generated epics and features for this project";
        } else if (userStories.length > 0) {
          requirementText =
            userStories[0].description ||
            userStories[0].title ||
            "Generated user stories for this project";
        } else {
          requirementText = "Generated SDLC artifacts (epics, features, user stories) for this project session.";
        }

        // Persist the derived requirement back into workflow state for UX
        setRequirement(requirementText);
      }

      const pid = projectId || sdlcProjectId;
      // Determine path: BRD if requirements are explicitly selected, otherwise conversational
      const isBRDPath = selectedRequirementIds && Array.isArray(selectedRequirementIds) && selectedRequirementIds.length > 0;

      const response = await apiRequest("POST", "/api/wiki/generate", {
        requirement: requirementText,
        personas,
        epics,
        features,
        userStories,
        projectName: "SDLC Project",
        sessionId,
        projectId: pid,
        brdId: isBRDPath ? (selectedBrdId || contextBrdId || undefined) : undefined,
        selectedRequirementIds: isBRDPath ? (selectedRequirementIds || undefined) : undefined,
        generationPath: isBRDPath ? 'brd' : 'conversational', // Explicit path flag
        functionalRequirementsContent: processedFileRequirements || undefined, // Processed BRD functional requirements from file uploads
      });

      const result = await response.json();

      if (result.jobId) {
        setWikiJobId(result.jobId);
        // If server returned a sessionId (auto-generated when client had none), update context
        if (result.sessionId && (!sessionId || sessionId.trim().length === 0)) {
          setSessionId(result.sessionId);
        }
        pollingTimeoutRef.current = setTimeout(
          () => pollWikiJobStatus(result.jobId),
          1000
        );
      } else {
        throw new Error("No job ID returned from server");
      }
    } catch (error) {
      setIsGeneratingWiki(false);
      setWikiJobId(null);
      toast.error(
        `Failed to start ${integrationType === "jira" ? "Confluence" : "Wiki"} generation: ${error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }
  };

  const wikiAlreadyGenerated = wikiPages.length > 0 && !isGeneratingWiki;

  const handleGenerateWiki = async () => {
    if (!canGenerateWiki || isGeneratingWiki) return;

    if (wikiAlreadyGenerated) {
      toast(
        integrationType === "jira"
          ? "Confluence pages have already been generated for this session."
          : "Wiki documents have already been generated for this session.",
        { icon: "ℹ️" }
      );
      return;
    }
    await executeWikiGeneration();
  };

  // Wiki can be generated when there is a main requirement text
  // or when there are already generated epics/user stories (e.g. resumed session).
  // But not if wiki pages have already been generated to prevent duplicates.
  const canGenerateWiki =
    ((requirement && requirement.trim().length > 0) ||
     epics.length > 0 ||
     userStories.length > 0) &&
    wikiPages.length === 0; // Prevent regeneration if wiki pages already exist

  // Inline editing handlers
  const startEditingTitle = () => {
    setIsEditingTitle(true);
    setEditedTitle(selectedItem?.title || "");
  };

  const startEditingDescription = () => {
    setIsEditingDescription(true);
    setEditedDescription(selectedItem?.description || "");
  };

  const startEditingACs = () => {
    setIsEditingACs(true);
    if (
      selectedItem?.type === "story" &&
      "acceptanceCriteria" in selectedItem
    ) {
      setEditedACs(selectedItem.acceptanceCriteria || []);
    }
  };

  const addNewAcceptanceCriterion = () => {
    if (!selectedItem || selectedItem.type !== "story") return;
    const current = (selectedItem as any).acceptanceCriteria || [];
    setIsEditingACs(true);
    setEditedACs([...current, ""]);
  };

  const addNewSubtask = () => {
    if (!selectedItem || selectedItem.type !== "story") return;
    const raw = (selectedItem as any).subtasks || [];
    const subtasksArray = raw.map((s: any) => {
      if (typeof s === "object" && s !== null) {
        const parts = [];
        if (s.category) parts.push(`[${s.category}]`);
        if (s.description) parts.push(s.description);
        if (s.estimatedHours) parts.push(`(${s.estimatedHours}h)`);
        return parts.join(" ");
      }
      return s;
    });
    setIsEditingSubtasks(true);
    setEditedSubtasks([...subtasksArray, ""]);
  };

  const saveInlineEdits = () => {
    if (!selectedItem) return;

    const updatedItem = { ...selectedItem };

    if (isEditingTitle) {
      updatedItem.title = editedTitle;
    }

    if (isEditingDescription) {
      updatedItem.description = editedDescription;
    }

    if (isEditingACs && selectedItem.type === "story") {
      (updatedItem as any).acceptanceCriteria = editedACs;
    }

    if (isEditingSubtasks && selectedItem.type === "story") {
      (updatedItem as any).subtasks = editedSubtasks.filter(
        (t) => t.trim() !== ""
      );
    }

    // Update the appropriate list
    if (selectedItem.type === "epic") {
      setEpics(
        epics.map((e) => (e.id === updatedItem.id ? (updatedItem as Epic) : e))
      );
      toast.success("Epic updated successfully");
    } else if (selectedItem.type === "feature") {
      setFeatures(
        features.map((f) =>
          f.id === updatedItem.id ? (updatedItem as Feature) : f
        )
      );
      toast.success("Feature updated successfully");
    } else if (selectedItem.type === "story") {
      setUserStories(
        userStories.map((s) =>
          s.id === updatedItem.id ? (updatedItem as UserStory) : s
        )
      );
      toast.success("User Story updated successfully");
    }

    setSelectedItem(updatedItem as SelectedItem);
    setIsEditingTitle(false);
    setIsEditingDescription(false);
    setIsEditingACs(false);
    setIsEditingSubtasks(false);
  };

  const cancelInlineEdits = () => {
    setIsEditingTitle(false);
    setIsEditingDescription(false);
    setIsEditingACs(false);
    setIsEditingSubtasks(false);
    setEditedTitle("");
    setEditedDescription("");
    setEditedACs([]);
    setEditedSubtasks([]);
  };

  // Handler for when description is enhanced via AiEnhance component
  const handleDescriptionEnhanced = (enhancedText: string) => {
    // AI enhancement is already reviewed and approved, apply directly
    setEditedDescription(enhancedText);

    // Update the artifact directly instead of entering edit mode
    if (selectedItem) {
      const updatedItem = { ...selectedItem, description: enhancedText };

      if (selectedItem.type === "epic") {
        setEpics(
          epics.map((e) =>
            e.id === updatedItem.id ? (updatedItem as Epic) : e
          )
        );
      } else if (selectedItem.type === "feature") {
        setFeatures(
          features.map((f) =>
            f.id === updatedItem.id ? (updatedItem as Feature) : f
          )
        );
      } else if (selectedItem.type === "story") {
        setUserStories(
          userStories.map((s) =>
            s.id === updatedItem.id ? (updatedItem as UserStory) : s
          )
        );
      }

      // Update selectedItem to reflect the change (preserve the type property)
      setSelectedItem(updatedItem as SelectedItem);

      toast.success("Changes saved successfully!");
    }
  };

  // Handler for when acceptance criteria is enhanced via AiEnhance component
  const handleAcceptanceCriteriaEnhanced = async (enhancedText: string) => {
    if (selectedItem?.type !== "story") {
      return;
    }

    // Parse the enhanced text back to AC array format
    const acArray = parseAcceptanceCriteriaText(enhancedText);

    // AI enhancement is already reviewed and approved, apply directly
    const updatedItem = {
      ...selectedItem,
      acceptanceCriteria: acArray,
    } as UserStory;

    // Update the user stories list
    setUserStories(
      userStories.map((s) => (s.id === updatedItem.id ? updatedItem : s))
    );

    // Update selectedItem and editedACs to reflect the change (preserve the type property)
    setSelectedItem({ ...updatedItem, type: "story" as const });
    setEditedACs(acArray);

    // Note: Auto-generation of subtasks from enhanced acceptance criteria
    // would be a future enhancement when the backend endpoint is available

    // Show success message for the enhancement
    toast.success(
      `Enhanced ${acArray.length} acceptance criteria and applied successfully!`
    );
  };

  // Helper function to parse acceptance criteria text to array format
  const parseAcceptanceCriteriaText = (text: string): any[] => {
    if (!text.trim()) return [];

    // Try to parse structured format first (Given-When-Then)
    const lines = text.split("\n");
    const structuredACs: any[] = [];
    let currentAC: any = null;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) {
        if (
          currentAC &&
          (currentAC.given || currentAC.when || currentAC.then)
        ) {
          structuredACs.push(currentAC);
        }
        currentAC = null;
        continue;
      }

      // Check for AC # pattern
      if (/^AC #\d+/.test(line)) {
        if (
          currentAC &&
          (currentAC.given || currentAC.when || currentAC.then)
        ) {
          structuredACs.push(currentAC);
        }
        const titleMatch = line.match(/^AC #\d+:?\s*(.+)?$/);
        currentAC = {
          title: titleMatch?.[1]?.trim() || undefined,
          given: "",
          when: "",
          then: "",
        };
      } else if (currentAC) {
        // Check for Given/When/Then/And patterns
        if (line.startsWith("Given:")) {
          currentAC.given = line.replace(/^Given:\s*/, "").trim();
        } else if (line.startsWith("When:")) {
          currentAC.when = line.replace(/^When:\s*/, "").trim();
        } else if (line.startsWith("Then:")) {
          currentAC.then = line.replace(/^Then:\s*/, "").trim();
        } else if (line.startsWith("And:")) {
          currentAC.and = line.replace(/^And:\s*/, "").trim();
        }
      }
    }

    // Add the last AC if exists
    if (currentAC && (currentAC.given || currentAC.when || currentAC.then)) {
      structuredACs.push(currentAC);
    }

    // If we found structured ACs, return them
    if (structuredACs.length > 0) {
      return structuredACs;
    }

    // Otherwise, treat as simple line-separated list
    return text
      .split("\n")
      .filter((line) => line.trim())
      .map((line) => line.trim());
  };

  // Helper function to convert acceptance criteria array to text
  const acceptanceCriteriaArrayToText = (ac: any[] | undefined): string => {
    if (!ac || ac.length === 0) return "";
    if (typeof ac[0] === "string") {
      return ac.join("\n");
    }
    // Handle structured format (given/when/then)
    return ac
      .map((criteria: any, idx: number) => {
        let text = `AC #${idx + 1}`;
        if (criteria.title) text += `: ${criteria.title}`;
        if (criteria.given) text += `\nGiven: ${criteria.given}`;
        if (criteria.when) text += `\nWhen: ${criteria.when}`;
        if (criteria.then) text += `\nThen: ${criteria.then}`;
        if (criteria.and) text += `\nAnd: ${criteria.and}`;
        return text;
      })
      .join("\n\n");
  };

  const removeSubtask = (index: number) => {
    if (selectedItem?.type === "story" && "subtasks" in selectedItem) {
      const updatedSubtasks = (selectedItem.subtasks || []).filter(
        (_, i) => i !== index
      );
      const updatedStory = { ...selectedItem, subtasks: updatedSubtasks };
      setUserStories(
        userStories.map((s) =>
          s.id === updatedStory.id ? (updatedStory as UserStory) : s
        )
      );
      setSelectedItem(updatedStory as SelectedItem);
      toast.success("Subtask removed");
    }
  };

  // Edit handlers
  const handleEditEpic = (epic: Epic) => {
    setEditingArtifact(epic);
    setEditingArtifactType("epic");
  };

  const handleEditFeature = (feature: Feature) => {
    setEditingArtifact(feature);
    setEditingArtifactType("feature");
  };

  const handleEditStory = (story: UserStory) => {
    setEditingArtifact(story);
    setEditingArtifactType("story");
  };

  const handleSaveArtifact = (updatedArtifact: Epic | Feature | UserStory) => {
    if (editingArtifactType === "epic") {
      setEpics(
        epics.map((e) =>
          e.id === updatedArtifact.id ? (updatedArtifact as Epic) : e
        )
      );
      toast.success("Epic updated successfully");
    } else if (editingArtifactType === "feature") {
      setFeatures(
        features.map((f) =>
          f.id === updatedArtifact.id ? (updatedArtifact as Feature) : f
        )
      );
      toast.success("Feature updated successfully");
    } else if (editingArtifactType === "story") {
      setUserStories(
        userStories.map((s) =>
          s.id === updatedArtifact.id ? (updatedArtifact as UserStory) : s
        )
      );
      toast.success("User Story updated successfully");
    }
    setEditingArtifact(null);
    setEditingArtifactType(null);
  };

  const handleSaveWikiPage = async (updatedPage: WikiPage) => {
    try {
      // Call the API to persist changes to the database
      const res = await apiRequest(
        "PATCH",
        `/api/wiki-pages/${updatedPage.id}`,
        {
          title: updatedPage.title,
          content: updatedPage.content,
          sessionId: sessionId,
        }
      );

      const json = await res.json();

      if (!res.ok) {
        throw new Error(json?.error || `Failed to update ${integrationType === "jira" ? "Confluence" : "wiki"} page`);
      }

      // Update local state after successful API call
      const updatedPages = wikiPages.map((p) =>
        p.id === updatedPage.id ? updatedPage : p
      );
      setWikiPages(updatedPages);

      // Invalidate cache to ensure fresh data on refetch
      queryClient.invalidateQueries({
        queryKey: ["/api/wiki/session", sessionId],
      });

      toast.success(`${integrationType === "jira" ? "Confluence" : "Wiki"} page updated successfully`);
      setEditingWikiPage(null);
    } catch (error) {
      console.error("[Wiki] Failed to save page:", error);
      toast.error(
        error instanceof Error
          ? error.message
          : `Failed to save ${integrationType === "jira" ? "Confluence" : "wiki"} page`
      );
    }
  };

  const toggleEpic = (id: string) => {
    setExpandedEpics((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const toggleFeature = (id: string) => {
    setExpandedFeatures((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  // Selection handlers for split view
  const handleSelectEpic = (epic: Epic) => {
    setSelectedItem({ ...epic, type: "epic" as const });
  };

  const handleSelectFeature = (feature: Feature) => {
    setSelectedItem({ ...feature, type: "feature" as const });
    // Auto-expand parent epic
    const parentEpic = epics.find((e) => e.id === feature.epicId);
    if (parentEpic) {
      setExpandedEpics((prev) => new Set(prev).add(parentEpic.id));
    }
  };

  const handleSelectStory = (story: UserStory) => {
    setSelectedItem({ ...story, type: "story" as const });
    // Auto-expand parent feature and epic
    const parentFeature = features.find((f) => f.id === story.featureId);
    if (parentFeature) {
      setExpandedFeatures((prev) => new Set(prev).add(parentFeature.id));
      const parentEpic = epics.find((e) => e.id === parentFeature.epicId);
      if (parentEpic) {
        setExpandedEpics((prev) => new Set(prev).add(parentEpic.id));
      }
    }
  };

  // -----------------------------
  // RENDER
  // -----------------------------

  // Handle pushing selected artifacts to ADO - navigate to step 3
  const handlePushToADO = () => {
    // Navigate to step 3 where the actual push will happen
    // No mandatory selection - users can select items in step 3
    setCurrentStep(3);
  };

  // Handle saving selections for later
  const handleSaveForLater = () => {
    const selectedEpicList = Array.from(workflowSelectedEpics);
    const selectedFeatureList = Array.from(workflowSelectedFeatures);
    const selectedStoryList = Array.from(workflowSelectedStories);
    const selectedWikiPageList = Array.from(workflowSelectedWikiPages);

    const totalSelected = selectedEpicList.length + selectedFeatureList.length + selectedStoryList.length + selectedWikiPageList.length;

    if (totalSelected === 0) {
      toast.error("Please select at least one artifact to save");
      return;
    }

    // Save current selections to localStorage
    const selectionData = {
      epics: selectedEpicList,
      features: selectedFeatureList,
      stories: selectedStoryList,
      wikiPages: selectedWikiPageList,
    };

    localStorage.setItem(`workflowSelections_${sessionId}`, JSON.stringify(selectionData));

    toast.success(`Saved ${totalSelected} selected artifact(s) for later`);
  };

  const downloadWikiPage = async (page: WikiPage) => {
    try {
      const response = await fetch(getApiUrl("/api/wiki/download-docx"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          content: page.content,
          title: page.title,
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to convert to Word format");
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${page.title
        .replace(/[^a-z0-9]/gi, "-")
        .toLowerCase()}.docx`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success(`Downloaded: ${page.title}`);
    } catch (error) {
      console.error("Error downloading wiki page:", error);
      toast.error(`Failed to download ${integrationType === "jira" ? "Confluence" : "Wiki"} page`);
    }
  };

  const downloadAllWiki = () => {
    if (wikiPages.length === 0) return;

    wikiPages.forEach((page) => {
      setTimeout(() => downloadWikiPage(page), 100 * wikiPages.indexOf(page));
    });
    toast.success(`Downloading ${wikiPages.length} ${integrationType === "jira" ? "Confluence" : "Wiki"} pages`);
  };

  const hasArtifactFilter = searchQuery.trim().length > 0 || filterType !== "all";
  const hasSelectableArtifacts =
    epics.some((e) => !pushedEpics.has(e.id)) ||
    features.some((f) => !pushedFeatures.has(f.id)) ||
    userStories.some((s) => !pushedStories.has(s.id));

  const handleSelectAllArtifacts = () => {
    if (hasArtifactFilter) {
      const newEpics = new Set(workflowSelectedEpics);
      const newFeatures = new Set(workflowSelectedFeatures);
      const newStories = new Set(workflowSelectedStories);

      filteredEpics.forEach((epic) => {
        if (!pushedEpics.has(epic.id)) newEpics.add(epic.id);
      });
      filteredFeatures.forEach((feature) => {
        if (!pushedFeatures.has(feature.id)) newFeatures.add(feature.id);
      });
      filteredStories.forEach((story) => {
        if (!pushedStories.has(story.id)) newStories.add(story.id);
      });

      setWorkflowSelectedEpics(newEpics);
      setWorkflowSelectedFeatures(newFeatures);
      setWorkflowSelectedStories(newStories);
    } else {
      selectAllUnpushed();
    }

    const epicsInScope = hasArtifactFilter
      ? filteredEpics.filter((epic) => !pushedEpics.has(epic.id))
      : mergeableEpics;
    setSelectedEpics(new Set(epicsInScope.map((epic) => epic.id)));
  };

  const handleDeselectAllArtifacts = () => {
    deselectAll();
    setSelectedEpics(new Set());
  };

  // Sort function
  const sortArtifacts = <T extends { title?: string; priority?: string }>(items: T[]): T[] => {
    if (sortBy === "none") return items;

    const sorted = [...items];
    switch (sortBy) {
      case "title-asc":
        return sorted.sort((a, b) => (a.title || "").localeCompare(b.title || ""));
      case "title-desc":
        return sorted.sort((a, b) => (b.title || "").localeCompare(a.title || ""));
      case "priority":
        const priorityOrder: Record<string, number> = { High: 3, Medium: 2, Low: 1 };
        return sorted.sort((a, b) => {
          const aPriority = priorityOrder[a.priority || ""] || 0;
          const bPriority = priorityOrder[b.priority || ""] || 0;
          return bPriority - aPriority;
        });
      default:
        return items;
    }
  };

  // Filter artifacts based on search query and filter type
  const getFilteredEpics = () => {
    let filtered = epics || [];

    // Apply search filter
    if (searchQuery) {
      filtered = filtered.filter(
        (epic) =>
          epic.title?.toLowerCase().includes(searchQuery.toLowerCase()) ||
          epic.description?.toLowerCase().includes(searchQuery.toLowerCase())
      );
    }

    return sortArtifacts(filtered);
  };

  const getFilteredFeatures = (epicId?: string) => {
    let filtered = features || [];

    // Filter by epic if provided
    if (epicId) {
      filtered = filtered.filter(f => f.epicId === epicId);
    }

    // Apply search filter
    if (searchQuery) {
      filtered = filtered.filter(
        (feature) =>
          feature.title?.toLowerCase().includes(searchQuery.toLowerCase()) ||
          feature.description?.toLowerCase().includes(searchQuery.toLowerCase())
      );
    }

    // Apply type filter - if filtering by features only, show all features
    if (filterType === "features") {
      return sortArtifacts(filtered);
    }

    return sortArtifacts(filtered);
  };

  const getFilteredStories = (featureId?: string) => {
    let filtered = userStories || [];

    // Filter by feature if provided
    if (featureId) {
      filtered = filtered.filter(s => s.featureId === featureId);
    }

    // Apply search filter
    if (searchQuery) {
      filtered = filtered.filter(
        (story) =>
          story.title?.toLowerCase().includes(searchQuery.toLowerCase()) ||
          story.description?.toLowerCase().includes(searchQuery.toLowerCase()) ||
          story.persona?.toLowerCase().includes(searchQuery.toLowerCase())
      );
    }

    return sortArtifacts(filtered);
  };

  const filteredEpics = getFilteredEpics();

  // Helper to get filtered features for an epic
  const getEpicFeatures = (epicId: string) => getFilteredFeatures(epicId);

  // Helper to get filtered stories for a feature
  const getFeatureStories = (featureId: string) => getFilteredStories(featureId);

  // For display purposes, use the helpers
  const filteredFeatures = getFilteredFeatures();
  const filteredStories = getFilteredStories();

  // When generic response is "only test cases" or "only subtasks", we have placeholder epic/feature/story.
  // Show only "Generated Test Cases" / "Generated Subtasks" in the left panel (no epic/feature/story labels).
  const isStandalonePlaceholder =
    filteredEpics.length === 1 &&
    filteredEpics[0].title === "Standalone Epic" &&
    filteredFeatures.length === 1 &&
    filteredFeatures[0].title === "Standalone Feature" &&
    filteredStories.length === 1;
  const standaloneStory = isStandalonePlaceholder ? filteredStories[0] : null;
  const standaloneTestCasesCount = (standaloneStory && (standaloneStory as any).testCases?.length) || 0;
  const standaloneSubtasksCount = (standaloneStory && (standaloneStory as any).subtasks?.length) || 0;
  const showOnlyTestCasesOrSubtasks = isStandalonePlaceholder && (standaloneTestCasesCount > 0 || standaloneSubtasksCount > 0);

  // Auto-select the standalone story so the right panel shows test cases/subtasks
  useEffect(() => {
    if (showOnlyTestCasesOrSubtasks && standaloneStory && (selectedItem?.type !== "story" || selectedItem?.id !== standaloneStory.id)) {
      setSelectedItem({ type: "story", ...standaloneStory });
    }
  }, [showOnlyTestCasesOrSubtasks, standaloneStory?.id]);

  const backlogSummary = [
    epics.length > 0 && `${epics.length} Epic${epics.length !== 1 ? "s" : ""}`,
    features.length > 0 && `${features.length} Feature${features.length !== 1 ? "s" : ""}`,
    userStories.length > 0 && `${userStories.length} User Storie${userStories.length !== 1 ? "s" : "y"}`,
    userStories.reduce((c, s) => c + ((s as any).testCases?.length ?? 0), 0) > 0 &&
    `${userStories.reduce((c, s) => c + ((s as any).testCases?.length ?? 0), 0)} Test Case${userStories.reduce((c, s) => c + ((s as any).testCases?.length ?? 0), 0) !== 1 ? "s" : ""}`,
    userStories.reduce((c, s) => c + ((s as any).subtasks?.length ?? 0), 0) > 0 &&
    `${userStories.reduce((c, s) => c + ((s as any).subtasks?.length ?? 0), 0)} Subtask${userStories.reduce((c, s) => c + ((s as any).subtasks?.length ?? 0), 0) !== 1 ? "s" : ""}`,
  ]
    .filter(Boolean)
    .join(", ") || "No artifacts";

  return (
    <div className="flex flex-col h-screen bg-background">
      {/* Back to Step 1 - chat history is preserved in workflow context */}
      <div className="flex items-center gap-2 px-4 py-2 flex-shrink-0 border-b border-border/50">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setCurrentStep(1)}
          className="text-muted-foreground hover:text-foreground"
          data-testid="button-back-to-step1"
        >
          <ArrowLeft className="h-4 w-4 mr-1" />
          Back to Step 1
        </Button>
      </div>
      {/* Backlog Section - Collapsible (same pattern as Wiki) */}
      <div
        className={cn(
          "w-full bg-card border-b border-border z-10",
          isBacklogExpanded
            ? "flex-1 min-h-0 flex flex-col overflow-hidden"
            : "flex-shrink-0",
        )}
      >
        <div
          className="flex flex-shrink-0 items-center justify-between gap-3 px-6 py-2.5 cursor-pointer hover:bg-accent/50 transition-colors"
          onClick={() => setIsBacklogExpanded(!isBacklogExpanded)}
          data-testid="button-toggle-backlog"
        >
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <FileText className="h-[18px] w-[18px] shrink-0 text-blue-600 dark:text-blue-400" />
            <span className="shrink-0 text-[15px] font-semibold leading-none text-foreground">
              Backlog
            </span>
            <span className="min-w-0 text-[13px] leading-snug text-muted-foreground">
              {backlogSummary}
            </span>
          </div>
          {isBacklogExpanded ? (
            <ChevronUp className="h-5 w-5 text-muted-foreground flex-shrink-0" />
          ) : (
            <ChevronDown className="h-5 w-5 text-muted-foreground flex-shrink-0" />
          )}
        </div>

        {isBacklogExpanded && (
          <>
            {/* Top action bar: one left-aligned row (matches backlog header inset at px-6) */}
            <div className="flex-shrink-0 border-b border-border bg-card px-6 pb-3 pt-2">
              <div className="mb-3 flex w-full min-w-0 flex-wrap items-center gap-x-2 gap-y-2 [&_button]:whitespace-nowrap">
                  {/* Cancel Artifacts Generate Button - shown when artifacts are being generated */}
                  {((isGenerating || epicsLoading || featuresLoading || storiesLoading) && cancelGeneration) ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={cancelGeneration}
                      className="text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 border-red-200 dark:border-red-900 hover:border-red-300 dark:hover:border-red-800"
                      title="Cancel artifact generation"
                    >
                      <X className="h-4 w-4 mr-1" />
                      Cancel Artifacts Generate
                    </Button>
                  ) : null}

                  {/* Regenerate Artifacts Button - shown only after artifacts are generated */}
                  {!(isGenerating || epicsLoading || featuresLoading || storiesLoading) ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={regenerateArtifacts}
                      className="text-orange-600 hover:text-orange-700 dark:text-orange-400 dark:hover:text-orange-300 border-orange-200 dark:border-orange-900 hover:border-orange-300 dark:hover:border-orange-800"
                      title="Start over with your original requirements"
                    >
                      <RotateCcw className="h-4 w-4 mr-1" />
                      Regenerate Artifacts
                    </Button>
                  ) : null}

                  <ExportArtifacts
                    epics={epics}
                    features={features}
                    userStories={userStories}
                    personas={personas}
                    projectName={projectName}
                    disabled={isArtifactActionsDisabled}
                  />

                  {qualityReport && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleDownloadQAReport}
                      data-testid="button-download-qa-report"
                    >
                      <Download className="h-4 w-4 mr-1" />
                      QA Report
                    </Button>
                  )}

                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setBulkAutoSuggest(false);
                      setBulkMergeOpen(true);
                    }}
                    disabled={(mergeableEpics.length < 2 && mergeableFeatures.length < 2 && mergeableStories.length < 2) || isMerging}
                    title="Merge epics, features, or stories"
                  >
                    {isMerging ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Merge className="h-4 w-4 mr-1" />}
                    Merge
                  </Button>

                  {mergeHistory.length > 0 && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={undoMerge}
                      title={`Undo the most recent merge operation. ${mergeHistory.length} merge${mergeHistory.length > 1 ? 's' : ''} in history.`}
                    >
                      <Undo2 className="h-4 w-4 mr-1" />
                      Undo Merge ({mergeHistory.length})
                    </Button>
                  )}

                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={isArtifactActionsDisabled}
                        aria-disabled={isArtifactActionsDisabled}
                        className="disabled:cursor-not-allowed disabled:opacity-50"
                        title={isArtifactActionsDisabled ? "Disabled while artifacts are generating" : undefined}
                      >
                        <SortAsc className="h-4 w-4 mr-1" />
                        Sort
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuLabel>Sort by</DropdownMenuLabel>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        onClick={() => setSortBy("none")}
                        disabled={isArtifactActionsDisabled}
                      >
                        No Sorting
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => setSortBy("title-asc")}
                        disabled={isArtifactActionsDisabled}
                      >
                        Title (A-Z)
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => setSortBy("title-desc")}
                        disabled={isArtifactActionsDisabled}
                      >
                        Title (Z-A)
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => setSortBy("priority")}
                        disabled={isArtifactActionsDisabled}
                      >
                        Priority (High to Low)
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>

                  <Button
                    size="sm"
                    onClick={handleSaveForLater}
                    variant="outline"
                    disabled={isArtifactActionsDisabled}
                    data-testid="button-save-for-later"
                  >
                    <Save className="h-4 w-4 mr-1" />
                    Save for Later
                  </Button>

                  <Button
                    size="sm"
                    onClick={handleGenerateWiki}
                    disabled={wikiAlreadyGenerated || isGeneratingWiki || !canGenerateWiki || isArtifactActionsDisabled}
                    className={wikiAlreadyGenerated
                      ? "bg-emerald-600/80 cursor-not-allowed opacity-90"
                      : "bg-gradient-to-r from-purple-600 to-purple-700 hover:from-purple-700 hover:to-purple-800 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:from-purple-600 disabled:hover:to-purple-700"
                    }
                    data-testid="button-generate-wiki"
                    title={wikiAlreadyGenerated
                      ? `${integrationType === "jira" ? "Confluence pages" : "Wiki documents"} already generated`
                      : isArtifactActionsDisabled ? "Disabled while artifacts are generating"
                      : !canGenerateWiki ? `Requirement is required to generate ${integrationType === "jira" ? "Confluence Page" : "Wiki"}`
                      : undefined}
                  >
                    {isGeneratingWiki ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        {wikiStep || "Generating..."}{" "}
                        {wikiProgress > 0 ? `(${wikiProgress}%)` : ""}
                      </>
                    ) : wikiAlreadyGenerated ? (
                      <>
                        <CheckCircle className="h-4 w-4 mr-2" />
                        {integrationType === "jira" ? "Confluence Pages Generated" : "Wiki Generated"}
                      </>
                    ) : (
                      <>
                        <Sparkles className="h-4 w-4 mr-2" />
                        {integrationType === "jira" ? "Generate Confluence Page" : "Generate Wiki"}
                      </>
                    )}
                  </Button>

                  <Button
                    size="sm"
                    onClick={() => setCurrentStep(3)}
                    className="bg-gradient-to-r from-emerald-600 to-emerald-700 hover:from-emerald-700 hover:to-emerald-800 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:from-emerald-600 disabled:hover:to-emerald-700"
                    data-testid="button-push-to-ado"
                    disabled={isArtifactActionsDisabled}
                    aria-disabled={isArtifactActionsDisabled}
                    title={isArtifactActionsDisabled ? "Disabled while artifacts are generating" : undefined}
                  >
                    <Rocket className="h-4 w-4 mr-1" />
                    {integrationType === "jira" ? "Push to Jira" : "Push to ADO"}
                  </Button>
              </div>

              {/* Search Bar */}
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Search..."
                  className="w-full pl-9 disabled:cursor-not-allowed disabled:opacity-50"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  disabled={isArtifactActionsDisabled}
                  aria-disabled={isArtifactActionsDisabled}
                  title={isArtifactActionsDisabled ? "Disabled while artifacts are generating" : undefined}
                />
              </div>

              {searchQuery && (
                <div className="mt-2 text-xs text-muted-foreground">
                  Found: <strong>{filteredEpics.length}</strong> epic(s),{" "}
                  <strong>{filteredFeatures.length}</strong> feature(s),{" "}
                  <strong>{filteredStories.length}</strong> story/stories
                </div>
              )}

              <div className="mt-2 flex items-center justify-end gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs text-primary hover:text-primary hover:bg-primary/10"
                  onClick={handleSelectAllArtifacts}
                  disabled={isArtifactActionsDisabled || !hasSelectableArtifacts}
                  data-testid="button-select-all-artifacts"
                >
                  Select All
                </Button>
                <span className="text-muted-foreground text-[10px]">|</span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                  onClick={handleDeselectAllArtifacts}
                  disabled={
                    isArtifactActionsDisabled ||
                    (workflowSelectedEpics.size === 0 &&
                      workflowSelectedFeatures.size === 0 &&
                      workflowSelectedStories.size === 0 &&
                      selectedEpics.size === 0)
                  }
                  data-testid="button-deselect-all-artifacts"
                >
                  Deselect All
                </Button>
              </div>
            </div>

            {/* JIRA-Style Split View */}
            <div className="flex flex-1 min-h-0 overflow-hidden">
              {/* LEFT PANEL: Backlog List */}
              <div
                className="bg-card overflow-y-auto overflow-x-hidden border-r border-border flex-shrink-0 scrollbar-none"
                style={{
                  width: selectedItem ? `calc(100% - ${rightPanelWidth}%)` : "100%",
                  maxWidth: "100%",
                }}
              >
                {/* Backlog List - JIRA Style */}
                <div className="bg-card overflow-x-hidden">
                  {(() => {
                    // PRIORITY: If Epics exist, show them immediately (don't show skeletons)
                    // Only show skeletons if Epics are loading AND no data exists yet
                    if (epicsLoading && filteredEpics.length === 0) {
                      return (
                        <>
                          {/* Epic Skeletons - only shown if no Epic data exists yet */}
                          {[1, 2, 3].map((i) => (
                            <div key={`epic-skeleton-${i}`} className="border-b overflow-x-hidden">
                              {/* EPIC SKELETON */}
                              <div className="flex items-start gap-2 px-4 py-3 border-b border-border">
                                <div className="h-4 w-4 rounded bg-muted animate-pulse flex-shrink-0 mt-0.5" />
                                <div className="h-5 w-5 rounded bg-muted animate-pulse flex-shrink-0" />
                                <div className="flex-1 space-y-2">
                                  <div className="h-4 w-3/4 rounded bg-muted animate-pulse" />
                                  <div className="h-3 w-1/2 rounded bg-muted animate-pulse" />
                                </div>
                                <div className="h-5 w-16 rounded bg-muted animate-pulse flex-shrink-0" />
                                <div className="h-4 w-20 rounded bg-muted animate-pulse flex-shrink-0" />
                              </div>
                            </div>
                          ))}
                        </>
                      );
                    }

                    // If we have Epics or other artifacts, continue to main rendering
                    // (Epics will be shown first in the main render section)

                    // Show different views based on filter type
                    if (filterType === "features" && filteredFeatures.length === 0) {
                      return (
                        <div className="text-center py-12 text-muted-foreground">
                          <BookOpen className="h-12 w-12 mx-auto mb-3 opacity-20" />
                          <p className="text-sm">No features found</p>
                        </div>
                      );
                    }

                    if (filterType === "stories" && filteredStories.length === 0) {
                      return (
                        <div className="text-center py-12 text-muted-foreground">
                          <BookOpen className="h-12 w-12 mx-auto mb-3 opacity-20" />
                          <p className="text-sm">No user stories found</p>
                        </div>
                      );
                    }

                    // Only show "No artifacts found" if ALL artifact types are empty
                    // (Epics are prioritized, but if they don't exist, other artifacts should still show)
                    if (filteredEpics.length === 0 && filteredFeatures.length === 0 && filteredStories.length === 0) {
                      return (
                        <div className="text-center py-12 text-muted-foreground">
                          <BookOpen className="h-12 w-12 mx-auto mb-3 opacity-20" />
                          <p className="text-sm">No artifacts found</p>
                        </div>
                      );
                    }

                    // When user asked for "only test cases" or "only subtasks", show only those (no epic/feature/story labels)
                    if (showOnlyTestCasesOrSubtasks && standaloneStory) {
                      const isStorySelected = selectedItem?.type === "story" && selectedItem.id === standaloneStory.id;
                      return (
                        <div className="border-t-0">
                          {standaloneTestCasesCount > 0 && (
                            <div
                              className={`flex items-center gap-2 px-4 py-3 hover:bg-accent border-b border-border cursor-pointer min-w-0 ${isStorySelected ? "bg-blue-500/10 border-l-4 border-l-blue-500" : ""
                                }`}
                              onClick={() => setSelectedItem({ type: "story", ...standaloneStory })}
                            >
                              <div className="flex items-center justify-center w-5 h-5 rounded bg-amber-500 flex-shrink-0">
                                <ClipboardCheck className="h-3 w-3 text-white" />
                              </div>
                              <span className="text-sm font-medium text-foreground flex-1">
                                Generated Test Cases
                              </span>
                              <Badge variant="secondary" className="text-xs">
                                {standaloneTestCasesCount}
                              </Badge>
                            </div>
                          )}
                          {standaloneSubtasksCount > 0 && (
                            <div
                              className={`flex items-center gap-2 px-4 py-3 hover:bg-accent border-b border-border cursor-pointer min-w-0 ${isStorySelected && standaloneTestCasesCount === 0 ? "bg-blue-500/10 border-l-4 border-l-blue-500" : ""
                                }`}
                              onClick={() => setSelectedItem({ type: "story", ...standaloneStory })}
                            >
                              <div className="flex items-center justify-center w-5 h-5 rounded bg-emerald-500 flex-shrink-0">
                                <CheckCircle className="h-3 w-3 text-white" />
                              </div>
                              <span className="text-sm font-medium text-foreground flex-1">
                                Generated Subtasks
                              </span>
                              <Badge variant="secondary" className="text-xs">
                                {standaloneSubtasksCount}
                              </Badge>
                            </div>
                          )}
                        </div>
                      );
                    }

                    return (
                      <>
                        {/* SECTION 1: EPICS - PRIORITY: Show immediately if data exists */}
                        {filteredEpics.length > 0 ? (
                          // Render Epics immediately if they exist (never show skeleton if data is available)
                          filteredEpics.map((epic) => {
                            const isEpicSelected =
                              selectedItem?.type === "epic" && selectedItem.id === epic.id;
                            const isEpicExpanded = expandedEpics.has(epic.id);
                            const epicFeatures = features.filter((f) => f.epicId === epic.id);

                            return (
                              <div key={epic.id} className="border-b overflow-x-hidden">
                                {/* EPIC HEADER */}
                                <div
                                  className={`flex items-start gap-2 px-4 py-3 hover:bg-accent border-b border-border min-w-0 group ${isEpicSelected
                                      ? "bg-blue-500/10 border-l-4 border-l-blue-500"
                                      : ""
                                    }`}
                                >
                                  <ChevronRight
                                    className={`h-4 w-4 text-muted-foreground transition-transform flex-shrink-0 mt-0.5 cursor-pointer ${isEpicExpanded ? "rotate-90" : ""
                                      }`}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      toggleEpic(epic.id);
                                    }}
                                  />
                                  <Checkbox
                                    checked={workflowSelectedEpics.has(epic.id) || selectedEpics.has(epic.id)}
                                    disabled={pushedEpics.has(epic.id)}
                                    onCheckedChange={(checked) => {
                                      if (pushedEpics.has(epic.id)) return; // Prevent changes for pushed items

                                      // Update workflow context for push functionality
                                      workflowToggleEpic(epic.id);

                                      // Update local state for merge functionality
                                      setSelectedEpics(prev => {
                                        const newSelected = new Set(prev);
                                        if (checked) {
                                          newSelected.add(epic.id);
                                        } else {
                                          newSelected.delete(epic.id);
                                        }
                                        return newSelected;
                                      });
                                    }}
                                    className="mt-0.5 flex-shrink-0"
                                    onClick={(e) => e.stopPropagation()}
                                  />
                                  <div className={`flex items-center justify-center w-5 h-5 rounded bg-purple-500 flex-shrink-0 cursor-pointer ${pushedEpics.has(epic.id) ? 'opacity-50' : ''
                                    }`}
                                    onClick={() => handleSelectEpic(epic)}>
                                    <span className="text-white text-xs font-bold">E</span>
                                  </div>
                                  <span className={`font-medium text-foreground flex-1 min-w-0 break-words line-clamp-2 cursor-pointer ${pushedEpics.has(epic.id) ? 'opacity-60' : ''
                                    }`}
                                    onClick={() => handleSelectEpic(epic)}>
                                    {epic.title}
                                  </span>
                                  {pushedEpics.has(epic.id) && (
                                    <Badge variant="secondary" className="text-xs mr-2 bg-green-100 text-green-800">
                                      ✓ Pushed to {integrationType === "jira" ? "Jira" : "ADO"}
                                    </Badge>
                                  )}
                                  <Badge
                                    className={`${priorityColors[epic.priority]
                                      } text-xs flex-shrink-0`}
                                  >
                                    {epic.priority}
                                  </Badge>
                                  <span className="text-sm text-muted-foreground flex-shrink-0">
                                    {epicFeatures.length} features
                                  </span>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-7 w-7 opacity-0 group-hover:opacity-100 flex-shrink-0"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleEditEpic(epic);
                                    }}
                                  >
                                    <Edit className="h-4 w-4" />
                                  </Button>
                                </div>

                                {/* FEATURES under EPIC */}
                                {isEpicExpanded && (
                                  <div className="bg-accent/30 overflow-x-hidden">
                                    {epicFeatures.map((feature) => {
                                      const featureStories = getFeatureStories(feature.id);
                                      const isFeatureExpanded = expandedFeatures.has(feature.id);
                                      const isSelected = selectedItem?.type === 'feature' && selectedItem.id === feature.id;

                                      return (
                                        <div
                                          key={feature.id}
                                          className="group overflow-x-hidden"
                                        >
                                          {/* FEATURE ROW */}
                                          <div
                                            className={`flex items-start gap-2 px-4 py-2.5 pl-12 hover:bg-accent cursor-pointer border-b border-border min-w-0 ${isSelected
                                                ? "bg-blue-500/10 border-l-4 border-l-blue-500"
                                                : ""
                                              }`}
                                            onClick={() => handleSelectFeature(feature)}
                                          >
                                            <ChevronRight
                                              className={`h-4 w-4 text-muted-foreground transition-transform flex-shrink-0 mt-0.5 ${isFeatureExpanded ? "rotate-90" : ""
                                                }`}
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                toggleFeature(feature.id);
                                              }}
                                            />
                                            <Checkbox
                                              checked={workflowSelectedFeatures.has(feature.id)}
                                              disabled={pushedFeatures.has(feature.id)}
                                              onCheckedChange={(checked) => {
                                                if (pushedFeatures.has(feature.id)) return;
                                                workflowToggleFeature(feature.id);
                                              }}
                                              className="mt-0.5 flex-shrink-0 mr-2"
                                              onClick={(e) => e.stopPropagation()}
                                            />
                                            <div className={`flex items-center justify-center w-5 h-5 rounded bg-blue-500 flex-shrink-0 ${pushedFeatures.has(feature.id) ? 'opacity-50' : ''
                                              }`}>
                                              <span className="text-white text-xs font-bold">
                                                F
                                              </span>
                                            </div>
                                            <span className="text-sm font-medium text-muted-foreground min-w-[80px] flex-shrink-0">
                                              {feature.id}
                                            </span>
                                            <span className={`text-sm text-foreground flex-1 min-w-0 break-words line-clamp-2 ${pushedFeatures.has(feature.id) ? 'opacity-60' : ''
                                              }`}>
                                              {feature.title}
                                            </span>
                                            {pushedFeatures.has(feature.id) && (
                                              <Badge variant="secondary" className="text-xs mr-2 bg-green-100 text-green-800">
                                                ✓ Pushed to {integrationType === "jira" ? "Jira" : "ADO"}
                                              </Badge>
                                            )}
                                            {feature.priority === "High" && (
                                              <ArrowUp className="h-4 w-4 text-red-500 flex-shrink-0" />
                                            )}
                                            {feature.priority === "Medium" && (
                                              <ArrowUp className="h-4 w-4 text-orange-500 flex-shrink-0" />
                                            )}
                                            {feature.priority === "Low" && (
                                              <ArrowUp className="h-4 w-4 text-blue-500 flex-shrink-0" />
                                            )}
                                            <Badge
                                              variant="secondary"
                                              className="text-xs flex-shrink-0"
                                            >
                                              {featureStories.length}
                                            </Badge>
                                          </div>

                                          {/* USER STORIES under FEATURE */}
                                          {isFeatureExpanded && (
                                            <div className="overflow-x-hidden">
                                              {featureStories.length === 0 ? (
                                                <div className="px-4 py-2 pl-24 text-xs text-muted-foreground">
                                                  No stories found for this feature
                                                </div>
                                              ) : (
                                                featureStories.map((story) => {
                                                  const persona = personas.find(
                                                    (p) => p.id === story.personaId
                                                  );
                                                  const isStorySelected =
                                                    selectedItem?.type === "story" &&
                                                    selectedItem.id === story.id;

                                                  return (
                                                    <div
                                                      key={story.id}
                                                      className={`group flex items-start gap-2 px-4 py-2 pl-24 hover:bg-card cursor-pointer border-b border-border min-w-0 ${isStorySelected
                                                          ? "bg-blue-500/10 border-l-4 border-l-blue-500"
                                                          : ""
                                                        }`}
                                                      onClick={() =>
                                                        handleSelectStory(story)
                                                      }
                                                    >
                                                      <Checkbox
                                                        checked={workflowSelectedStories.has(story.id)}
                                                        disabled={pushedStories.has(story.id)}
                                                        onCheckedChange={(checked) => {
                                                          if (pushedStories.has(story.id)) return;
                                                          workflowToggleStory(story.id);
                                                        }}
                                                        className="mt-0.5 flex-shrink-0 mr-2"
                                                        onClick={(e) => e.stopPropagation()}
                                                      />
                                                      <div className={`flex items-center justify-center w-5 h-5 rounded bg-green-500 flex-shrink-0 ${pushedStories.has(story.id) ? 'opacity-50' : ''
                                                        }`}>
                                                        <span className="text-white text-xs font-bold">
                                                          S
                                                        </span>
                                                      </div>
                                                      <span className="text-sm font-medium text-muted-foreground min-w-[80px] flex-shrink-0">
                                                        {story.id}
                                                      </span>
                                                      <span className={`text-sm text-foreground flex-1 min-w-0 break-words line-clamp-2 ${pushedStories.has(story.id) ? 'opacity-60' : ''
                                                        }`}>
                                                        {story.title}
                                                      </span>
                                                      {pushedStories.has(story.id) && (
                                                        <Badge variant="secondary" className="text-xs mr-2 bg-green-100 text-green-800">
                                                          ✓ Pushed to {integrationType === "jira" ? "Jira" : "ADO"}
                                                        </Badge>
                                                      )}
                                                      {story.priority === "High" && (
                                                        <ArrowUp className="h-4 w-4 text-red-500 flex-shrink-0" />
                                                      )}
                                                      {story.priority === "Medium" && (
                                                        <ArrowUp className="h-4 w-4 text-orange-500 flex-shrink-0" />
                                                      )}
                                                      {story.priority === "Low" && (
                                                        <ArrowUp className="h-4 w-4 text-blue-500 flex-shrink-0" />
                                                      )}
                                                      {story.generatedByQA && (
                                                        <Badge variant="outline" className="text-[10px] px-1 py-0 h-4 border-violet-400 text-violet-600 dark:text-violet-400 flex-shrink-0">
                                                          QA
                                                        </Badge>
                                                      )}
                                                      <Badge
                                                        variant="outline"
                                                        className="text-xs flex-shrink-0"
                                                      >
                                                        {story.storyPoints}
                                                      </Badge>
                                                      {(() => {
                                                        const storyPersonaName = (
                                                          story as any
                                                        ).persona;
                                                        const storyPersonaId =
                                                          story.personaId;

                                                        // Find persona from personas array
                                                        const foundPersona = storyPersonaId
                                                          ? personas.find(
                                                            (p) => p.id === storyPersonaId
                                                          )
                                                          : storyPersonaName
                                                            ? personas.find(
                                                              (p) =>
                                                                p.name.toLowerCase() ===
                                                                storyPersonaName.toLowerCase()
                                                            )
                                                            : null;

                                                        const displayPersona =
                                                          foundPersona || {
                                                            name:
                                                              storyPersonaName || "Unknown",
                                                            color: "blue",
                                                          };

                                                        return (
                                                          <Avatar className="h-6 w-6 flex-shrink-0">
                                                            <AvatarFallback
                                                              className={`text-xs ${personaColors[
                                                                displayPersona.color as keyof typeof personaColors
                                                                ] || "bg-gray-500"
                                                                }`}
                                                            >
                                                              {displayPersona.name
                                                                ? displayPersona.name
                                                                  .split(" ")
                                                                  .map(
                                                                    (n: string) => n[0]
                                                                  )
                                                                  .join("")
                                                                : "?"}
                                                            </AvatarFallback>
                                                          </Avatar>
                                                        );
                                                      })()}
                                                    </div>
                                                  );
                                                })
                                              )}
                                            </div>
                                          )}
                                        </div>
                                      );
                                    })}
                                  </div>
                                )}
                              </div>
                            );
                          })
                        ) : epicsLoading ? (
                          // Only show skeleton if Epics are loading AND no data exists yet
                          [1, 2, 3].map((i) => (
                            <div key={`epic-skeleton-${i}`} className="border-b overflow-x-hidden">
                              <div className="flex items-start gap-2 px-4 py-3 border-b border-border">
                                <div className="h-5 w-5 rounded bg-muted animate-pulse flex-shrink-0" />
                                <div className="flex-1 space-y-2">
                                  <div className="h-4 w-3/4 rounded bg-muted animate-pulse" />
                                </div>
                                <div className="h-5 w-16 rounded bg-muted animate-pulse flex-shrink-0" />
                              </div>
                            </div>
                          ))
                        ) : null}

                        {/* SECTION 2: STANDALONE USER STORIES (UniversalAgent support - stories without epic/feature hierarchy) */}
                        {(() => {
                          // Find standalone stories: stories that don't belong to any epic/feature OR have placeholder epic/feature
                          const standaloneStories = filteredStories.filter((story) => {
                            // Story is standalone if:
                            // 1. It has no epicId/featureId, OR
                            // 2. Its epicId/featureId doesn't match any existing epic/feature, OR
                            // 3. It has placeholder epic/feature (created for UniversalAgent)
                            if (!story.epicId && !story.featureId) return true;

                            const hasEpic = story.epicId && filteredEpics.some(e => e.id === story.epicId);
                            const hasFeature = story.featureId && filteredFeatures.some(f => f.id === story.featureId);

                            // If story has epicId but epic doesn't exist, or epic exists but story's featureId doesn't match any feature under that epic
                            if (story.epicId && !hasEpic) return true;
                            if (story.epicId && hasEpic && story.featureId && !hasFeature) return true;

                            // Check if epic/feature are placeholders (created for UniversalAgent)
                            if (story.epicId) {
                              const epic = filteredEpics.find(e => e.id === story.epicId);
                              if (epic && (epic.title === "Standalone Epic" || epic.title.includes("for test case"))) {
                                return true; // Show as standalone
                              }
                            }

                            return false;
                          });

                          // Only show standalone section if there are standalone stories AND no epics (or epics don't contain these stories)
                          if (standaloneStories.length > 0) {
                            return (
                              <div className="border-t-2 border-dashed border-muted-foreground/30 mt-4 pt-4">
                                <div className="px-4 mb-2">
                                  <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                                    Standalone Artifacts
                                  </h3>
                                  <p className="text-xs text-muted-foreground mt-1">
                                    {standaloneStories.length} user story/stories
                                  </p>
                                </div>

                                {standaloneStories.map((story) => {
                                  const persona = personas.find((p) => p.id === story.personaId);
                                  const isStorySelected = selectedItem?.type === "story" && selectedItem.id === story.id;
                                  const storyTestCases = (story as any).testCases || [];
                                  const storySubtasks = (story as any).subtasks || [];

                                  return (
                                    <div
                                      key={story.id}
                                      className={`group flex items-start gap-2 px-4 py-3 hover:bg-accent cursor-pointer border-b border-border min-w-0 ${isStorySelected
                                          ? "bg-blue-500/10 border-l-4 border-l-blue-500"
                                          : ""
                                        }`}
                                      onClick={() => handleSelectStory(story)}
                                    >
                                      <Checkbox
                                        checked={workflowSelectedStories.has(story.id)}
                                        disabled={pushedStories.has(story.id)}
                                        onCheckedChange={(checked) => {
                                          if (pushedStories.has(story.id)) return;
                                          workflowToggleStory(story.id);
                                        }}
                                        className="mt-0.5 flex-shrink-0"
                                        onClick={(e) => e.stopPropagation()}
                                      />
                                      <div className={`flex items-center justify-center w-5 h-5 rounded bg-green-500 flex-shrink-0 ${pushedStories.has(story.id) ? 'opacity-50' : ''
                                        }`}>
                                        <span className="text-white text-xs font-bold">S</span>
                                      </div>
                                      <span className={`text-sm font-medium text-muted-foreground min-w-[80px] flex-shrink-0 ${pushedStories.has(story.id) ? 'opacity-60' : ''
                                        }`}>
                                        {story.id}
                                      </span>
                                      <span className={`text-sm text-foreground flex-1 min-w-0 break-words line-clamp-2 ${pushedStories.has(story.id) ? 'opacity-60' : ''
                                        }`}>
                                        {story.title}
                                      </span>
                                      {pushedStories.has(story.id) && (
                                        <Badge variant="secondary" className="text-xs mr-2 bg-green-100 text-green-800">
                                          Pushed to {integrationType === "jira" ? "Jira" : "ADO"}
                                        </Badge>
                                      )}
                                      {storyTestCases.length > 0 && (
                                        <Badge variant="outline" className="text-xs mr-2">
                                          {storyTestCases.length} Test{storyTestCases.length > 1 ? 's' : ''}
                                        </Badge>
                                      )}
                                      {storySubtasks.length > 0 && (
                                        <Badge variant="outline" className="text-xs mr-2">
                                          {storySubtasks.length} Task{storySubtasks.length > 1 ? 's' : ''}
                                        </Badge>
                                      )}
                                      {story.generatedByQA && (
                                        <Badge variant="outline" className="text-[10px] px-1 py-0 h-4 border-violet-400 text-violet-600 dark:text-violet-400 flex-shrink-0">
                                          QA
                                        </Badge>
                                      )}
                                      {(story.storyPoints != null && story.storyPoints !== undefined) && (
                                        <Badge variant="outline" className="text-xs flex-shrink-0">
                                          {story.storyPoints}
                                        </Badge>
                                      )}
                                      {persona && (
                                        <Avatar className="h-6 w-6 flex-shrink-0">
                                          <AvatarFallback
                                            className={`text-xs ${personaColors[
                                              (persona.name?.charCodeAt(0) || 0) %
                                              5
                                              ] || personaColors.blue
                                              }`}
                                          >
                                            {persona.name?.charAt(0).toUpperCase() || "U"}
                                          </AvatarFallback>
                                        </Avatar>
                                      )}
                                      <Badge
                                        className={`${priorityColors[story.priority]
                                          } text-xs flex-shrink-0`}
                                      >
                                        {story.priority}
                                      </Badge>
                                      <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-7 w-7 opacity-0 group-hover:opacity-100 flex-shrink-0"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          handleEditStory(story);
                                        }}
                                      >
                                        <Edit className="h-4 w-4" />
                                      </Button>
                                    </div>
                                  );
                                })}
                              </div>
                            );
                          }
                          return null;
                        })()}
                      </>
                    );
                  })()}
                </div>
              </div>

              {/* RIGHT PANEL: Detail View - Resizable */}
              {selectedItem && (
                <>
                  {/* Resize Handle */}
                  <div
                    className="w-1 bg-border hover:bg-blue-500 cursor-col-resize transition-colors flex-shrink-0"
                    onMouseDown={(e) => {
                      setIsResizing(true);
                      e.preventDefault();
                    }}
                  >
                    <div className="flex items-center justify-center h-full">
                      <GripVertical className="h-4 w-4 text-muted-foreground" />
                    </div>
                  </div>

                  <div
                    className="bg-card border-l border-border shadow-lg flex flex-col overflow-hidden flex-shrink-0"
                    style={{
                      width: `${rightPanelWidth}%`,
                      minWidth: "350px",
                      maxWidth: "60%",
                    }}
                  >
                    {/* Header */}
                    <div className="flex items-center justify-between p-4 border-b border-border bg-card">
                      <div className="flex items-center gap-2">
                        <div
                          className={`flex items-center justify-center w-6 h-6 rounded ${selectedItem.type === "epic"
                              ? "bg-purple-500"
                              : selectedItem.type === "feature"
                                ? "bg-blue-500"
                                : "bg-green-500"
                            }`}
                        >
                          <span className="text-white text-xs font-bold">
                            {selectedItem.type === "story"
                              ? "S"
                              : selectedItem.type === "feature"
                                ? "F"
                                : "E"}
                          </span>
                        </div>
                        <span className="text-sm font-medium text-muted-foreground">
                          {selectedItem.id}
                        </span>
                      </div>
                      <div className="flex gap-2">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => setSelectedItem(null)}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>

                    {/* Scrollable Content - extra top padding so detail view sits a bit lower */}
                    <div className="flex-1 overflow-y-auto overflow-x-hidden p-6 pt-8 scrollbar-none">
                      {/* Title - Editable */}
                      <div className="mb-4">
                        <div className="flex items-center justify-between mb-2">
                          <Label className="text-sm font-medium text-foreground">
                            Title
                          </Label>
                          {!isEditingTitle && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={startEditingTitle}
                            >
                              <Edit className="h-3 w-3 mr-1" />
                              Edit
                            </Button>
                          )}
                        </div>
                        {isEditingTitle ? (
                          <Input
                            value={editedTitle}
                            onChange={(e) => setEditedTitle(e.target.value)}
                            className="text-xl font-semibold"
                          />
                        ) : (
                          <h3 className="text-xl font-semibold text-foreground break-words">
                            {selectedItem.title}
                          </h3>
                        )}
                      </div>

                      {/* Description Section - Editable */}
                      <div className="mb-6">
                        <div className="flex items-center justify-between mb-2">
                          <Label className="text-sm font-medium text-foreground">
                            Description
                          </Label>
                          <div className="flex gap-2">
                            {!isEditingDescription ? (
                              <>
                                <AiEnhanceWithDiff
                                  locationKey={getDescriptionLocationKey(
                                    selectedItem?.type === "epic"
                                      ? "Epic"
                                      : selectedItem?.type === "feature"
                                        ? "Feature"
                                        : selectedItem?.type === "story"
                                          ? "User Story"
                                          : undefined
                                  )}
                                  value={
                                    editedDescription ||
                                    selectedItem?.description ||
                                    ""
                                  }
                                  onEnhanced={handleDescriptionEnhanced}
                                  buttonVariant="ghost"
                                  buttonSize="sm"
                                  className="justify-end"
                                  itemName="Description"
                                />
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={startEditingDescription}
                                >
                                  <Edit className="h-3 w-3 mr-1" />
                                  Edit
                                </Button>
                              </>
                            ) : null}
                          </div>
                        </div>
                        {isEditingDescription ? (
                          <MarkdownTextarea
                            value={editedDescription}
                            onChange={(e) => setEditedDescription(e.target.value)}
                            className="min-h-[200px] font-mono text-sm"
                          />
                        ) : (
                          (() => {
                            const rawDesc = selectedItem.description || "";
                            const textContent = (typeof rawDesc === 'string' ? rawDesc : JSON.stringify(rawDesc)).trim();

                            const sectionTitles = [
                              "CONTEXT & BACKGROUND",
                              "CURRENT STATE",
                              "DESIRED STATE",
                              "KEY FUNCTIONALITY",
                              "USER INTERACTION FLOW",
                              "TECHNICAL CONSIDERATIONS",
                              "OUT OF SCOPE",
                              "SUCCESS METRICS",
                              "ACCEPTANCE CRITERIA",
                            ];

                            const hasStructuredSections = sectionTitles.some(
                              (title) =>
                                textContent.toUpperCase().includes(`${title}:`)
                            );

                            if (hasStructuredSections) {
                              const sectionMarkers: Array<{
                                title: string;
                                content: string;
                                index: number;
                              }> = [];

                              sectionTitles.forEach((title) => {
                                const escapedTitle = title.replace(
                                  /[.*+?^${}()|[\]\\]/g,
                                  "\\$&"
                                );
                                const regex = new RegExp(
                                  `${escapedTitle}:\\s*`,
                                  "gi"
                                );
                                const matchIndex = textContent.search(regex);
                                if (matchIndex !== -1) {
                                  sectionMarkers.push({
                                    title,
                                    content: "",
                                    index: matchIndex,
                                  });
                                }
                              });

                              sectionMarkers.sort((a, b) => a.index - b.index);

                              sectionMarkers.forEach((section, idx) => {
                                const escapedTitle = section.title.replace(
                                  /[.*+?^${}()|[\]\\]/g,
                                  "\\$&"
                                );
                                const titleRegex = new RegExp(
                                  `${escapedTitle}:\\s*`,
                                  "gi"
                                );
                                const titleMatch = textContent
                                  .substring(section.index)
                                  .match(titleRegex);
                                if (titleMatch) {
                                  const contentStart =
                                    section.index + titleMatch[0].length;
                                  const contentEnd =
                                    idx < sectionMarkers.length - 1
                                      ? sectionMarkers[idx + 1].index
                                      : textContent.length;
                                  section.content = textContent
                                    .substring(contentStart, contentEnd)
                                    .trim();
                                }
                              });

                              const validSections = sectionMarkers.filter(
                                (s) => s.content
                              );

                              if (validSections.length > 0) {
                                return (
                                  <div className="space-y-4 bg-muted/30 p-5 rounded-lg border border-border/50">
                                    {validSections.map((section, idx) => (
                                      <div key={idx} className="space-y-2.5">
                                        <h5 className="text-sm font-bold text-foreground uppercase tracking-wide">
                                          {section.title}:
                                        </h5>
                                        <div className="pl-0 space-y-2">
                                          {section.content
                                            .split(/\n+/)
                                            .filter((line) => line.trim())
                                            .map((line, lineIdx) => {
                                              const trimmedLine = line.trim();
                                              if (
                                                trimmedLine.startsWith("-") ||
                                                trimmedLine.startsWith("•")
                                              ) {
                                                const content = trimmedLine
                                                  .replace(/^[-•]\s*/, "")
                                                  .trim();
                                                return (
                                                  <div
                                                    key={lineIdx}
                                                    className="flex items-start gap-2.5"
                                                  >
                                                    <span className="text-foreground mt-1 flex-shrink-0">
                                                      •
                                                    </span>
                                                    <span className="text-sm text-muted-foreground leading-relaxed flex-1">
                                                      {content}
                                                    </span>
                                                  </div>
                                                );
                                              }
                                              if (trimmedLine.match(/^\d+\.\s/)) {
                                                const content = trimmedLine
                                                  .replace(/^\d+\.\s*/, "")
                                                  .trim();
                                                return (
                                                  <div
                                                    key={lineIdx}
                                                    className="flex items-start gap-2.5"
                                                  >
                                                    <span className="text-foreground mt-1 flex-shrink-0 font-medium">
                                                      {
                                                        trimmedLine.match(
                                                          /^\d+\./
                                                        )?.[0]
                                                      }
                                                    </span>
                                                    <span className="text-sm text-muted-foreground leading-relaxed flex-1">
                                                      {content}
                                                    </span>
                                                  </div>
                                                );
                                              }
                                              return (
                                                <p
                                                  key={lineIdx}
                                                  className="text-sm text-muted-foreground leading-relaxed"
                                                >
                                                  {trimmedLine}
                                                </p>
                                              );
                                            })}
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                );
                              }
                            }

                            // Fallback to simple formatting if no structured sections found
                            return (
                              <div className="text-sm text-muted-foreground leading-relaxed whitespace-pre-wrap break-words bg-muted/30 p-5 rounded-lg border border-border/50">
                                {textContent || "No description provided."}
                              </div>
                            );
                          })()
                        )}
                      </div>

                      {/* For User Stories: Acceptance Criteria - Editable & Numbered */}
                      {selectedItem.type === "story" && (
                        <div className="mb-6">
                          <div className="flex items-center justify-between mb-2">
                            <Label className="text-sm font-medium text-foreground">
                              Acceptance Criteria (
                              {(selectedItem as any).acceptanceCriteria?.length ?? 0})
                            </Label>
                            <div className="flex gap-2">
                              {!isEditingACs ? (
                                <>
                                  {(selectedItem as any).acceptanceCriteria?.length > 0 && (
                                    <AiEnhanceWithDiff
                                      locationKey="artifact.acceptanceCriteria"
                                      value={acceptanceCriteriaArrayToText(
                                        (selectedItem as any).acceptanceCriteria || []
                                      )}
                                      onEnhanced={handleAcceptanceCriteriaEnhanced}
                                      buttonVariant="ghost"
                                      buttonSize="sm"
                                      className="justify-end"
                                      itemName="Acceptance Criteria"
                                    />
                                  )}
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={startEditingACs}
                                  >
                                    <Edit className="h-3 w-3 mr-1" />
                                    Edit
                                  </Button>
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={addNewAcceptanceCriterion}
                                  >
                                    <Plus className="h-3 w-3 mr-1" />
                                    Add
                                  </Button>
                                </>
                              ) : null}
                            </div>
                          </div>
                          {isEditingACs ? (
                            <Textarea
                              value={editedACs
                                .map((criteria: any, idx: number) => {
                                  // Handle both string format and object format
                                  if (typeof criteria === "string") {
                                    return `AC #${idx + 1}: ${criteria}`;
                                  }
                                  // For backward compatibility, if it's an object, try to extract descriptive text
                                  return `AC #${idx + 1}: ${criteria.title ||
                                    criteria.description ||
                                    Object.values(criteria)
                                      .filter(
                                        (v) => typeof v === "string" && v.trim()
                                      )
                                      .join(" ") ||
                                    `Acceptance Criterion ${idx + 1}`
                                    }`;
                                })
                                .join("\n\n")}
                              onChange={(e) => {
                                // Parse the textarea back into AC format - now just descriptive strings
                                const text = e.target.value;
                                const acBlocks = text.split(/\n\n+/);
                                const parsedACs = acBlocks
                                  .map((block) => {
                                    // Remove AC #X: prefix if present
                                    const cleaned = block
                                      .replace(/^AC #\d+:\s*/, "")
                                      .trim();
                                    return cleaned || block.trim();
                                  })
                                  .filter((ac) => ac.length > 0);

                                setEditedACs(
                                  parsedACs.length > 0 ? parsedACs : editedACs
                                );
                              }}
                              className="min-h-[300px] font-mono text-sm"
                              placeholder="Format:&#10;AC #1: Descriptive statement of requirement&#10;&#10;AC #2: Another descriptive statement&#10;&#10;..."
                            />
                          ) : (
                            <div className="space-y-3">
                              {((selectedItem as any).acceptanceCriteria || []).map(
                                (criteria: any, idx: number) => {
                                  // Handle descriptive string format (new format)
                                  let displayText = "";

                                  if (typeof criteria === "string") {
                                    displayText = criteria;
                                  } else if (
                                    typeof criteria === "object" &&
                                    criteria !== null
                                  ) {
                                    // For backward compatibility, extract descriptive text
                                    // If it has given/when/then, combine them into a descriptive statement
                                    if (
                                      criteria.given ||
                                      criteria.when ||
                                      criteria.then
                                    ) {
                                      const parts = [];
                                      if (criteria.given)
                                        parts.push(`Given ${criteria.given}`);
                                      if (criteria.when)
                                        parts.push(`when ${criteria.when}`);
                                      if (criteria.then)
                                        parts.push(`then ${criteria.then}`);
                                      if (criteria.and)
                                        parts.push(`and ${criteria.and}`);
                                      displayText = parts.join(", ");
                                    } else {
                                      displayText =
                                        criteria.title ||
                                        criteria.description ||
                                        Object.values(criteria)
                                          .filter(
                                            (v) => typeof v === "string" && v.trim()
                                          )
                                          .join(" ") ||
                                        `Acceptance Criterion ${idx + 1}`;
                                    }
                                  } else {
                                    displayText = `Acceptance Criterion ${idx + 1}`;
                                  }

                                  return (
                                    <div
                                      key={idx}
                                      className="p-3 bg-accent/30 rounded-lg border border-border"
                                    >
                                      <div className="flex items-start gap-3">
                                        <Badge
                                          variant="secondary"
                                          className="text-xs flex-shrink-0 mt-0.5"
                                        >
                                          #{idx + 1}
                                        </Badge>
                                        <div className="flex-1 min-w-0">
                                          <p className="text-sm text-foreground">
                                            {displayText}
                                          </p>
                                        </div>
                                      </div>
                                    </div>
                                  );
                                }
                              )}
                              {!isEditingACs && (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="w-full mt-2"
                                  onClick={addNewAcceptanceCriterion}
                                >
                                  <Plus className="h-4 w-4 mr-1" />
                                  Add Acceptance Criteria
                                </Button>
                              )}
                            </div>
                          )}
                        </div>
                      )}

                      {/* For User Stories: Subtasks */}
                      {selectedItem.type === "story" && (
                        <div className="mb-6">
                          <div className="flex items-center justify-between mb-3">
                            <Label className="text-sm font-medium text-foreground">
                              Subtasks (
                              {isEditingSubtasks
                                ? editedSubtasks.length
                                : (selectedItem as any).subtasks?.length || 0}
                              )
                            </Label>
                            {!isEditingSubtasks && (
                              <div className="flex gap-2">
                                {(selectedItem as any).subtasks?.length > 0 && (
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-7 px-2 text-xs"
                                    onClick={() => {
                                      const subtasksArray = (
                                        (selectedItem as any).subtasks || []
                                      ).map((s: any) => {
                                        if (typeof s === "object" && s !== null) {
                                          const parts = [];
                                          if (s.category)
                                            parts.push(`[${s.category}]`);
                                          if (s.description)
                                            parts.push(s.description);
                                          if (s.estimatedHours)
                                            parts.push(`(${s.estimatedHours}h)`);
                                          return parts.join(" ");
                                        }
                                        return s;
                                      });
                                      setEditedSubtasks(subtasksArray);
                                      setIsEditingSubtasks(true);
                                    }}
                                  >
                                    <Edit className="h-3 w-3 mr-1" />
                                    Edit
                                  </Button>
                                )}
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="h-7 px-2 text-xs"
                                  onClick={addNewSubtask}
                                >
                                  <Plus className="h-3 w-3 mr-1" />
                                  Add
                                </Button>
                              </div>
                            )}
                          </div>
                          {isEditingSubtasks ? (
                            <div className="space-y-2">
                              {editedSubtasks.map((subtask, idx) => (
                                <div key={idx} className="flex items-start gap-2">
                                  <CheckCircle className="h-4 w-4 text-muted-foreground mt-2.5 flex-shrink-0" />
                                  <Input
                                    value={subtask}
                                    onChange={(e) => {
                                      const newSubtasks = [...editedSubtasks];
                                      newSubtasks[idx] = e.target.value;
                                      setEditedSubtasks(newSubtasks);
                                    }}
                                    className="flex-1 text-sm"
                                    placeholder="Enter subtask..."
                                  />
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-9 w-9 flex-shrink-0"
                                    onClick={() => {
                                      setEditedSubtasks(
                                        editedSubtasks.filter((_, i) => i !== idx)
                                      );
                                    }}
                                  >
                                    <X className="h-4 w-4 text-destructive" />
                                  </Button>
                                </div>
                              ))}
                              <Button
                                variant="outline"
                                size="sm"
                                className="w-full mt-2"
                                onClick={() => {
                                  setEditedSubtasks([...editedSubtasks, ""]);
                                }}
                              >
                                <Plus className="h-4 w-4 mr-1" />
                                Add Subtask
                              </Button>
                            </div>
                          ) : (selectedItem as any).subtasks?.length > 0 ? (
                            <div className="space-y-2">
                              {((selectedItem as any).subtasks || []).map(
                                (subtask: any, idx: number) => {
                                  // Handle both string and object subtask formats
                                  const isObject =
                                    typeof subtask === "object" && subtask !== null;
                                  const category = isObject ? subtask.category : "";
                                  const description = isObject
                                    ? subtask.description
                                    : subtask;
                                  const hours = isObject
                                    ? subtask.estimatedHours
                                    : "";

                                  return (
                                    <div
                                      key={idx}
                                      className="flex items-start gap-2 p-3 bg-accent/30 rounded-lg border border-border hover:border-muted-foreground transition-colors group min-w-0"
                                    >
                                      <CheckCircle className="h-4 w-4 text-muted-foreground mt-0.5 flex-shrink-0" />
                                      <div className="flex-1 min-w-0">
                                        {category && (
                                          <span className="text-xs font-medium text-muted-foreground mr-2">
                                            [{category}]
                                          </span>
                                        )}
                                        <span className="text-sm text-foreground break-words">
                                          {description}
                                        </span>
                                        {hours && (
                                          <span className="text-xs text-muted-foreground ml-2">
                                            ({hours}h)
                                          </span>
                                        )}
                                      </div>
                                      <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
                                        onClick={() => removeSubtask(idx)}
                                      >
                                        <X className="h-3 w-3 text-destructive" />
                                      </Button>
                                    </div>
                                  );
                                }
                              )}
                              <Button
                                variant="outline"
                                size="sm"
                                className="w-full mt-2"
                                onClick={addNewSubtask}
                              >
                                <Plus className="h-4 w-4 mr-1" />
                                Add Subtask
                              </Button>
                            </div>
                          ) : (
                            <div className="rounded-lg border border-dashed border-border p-4 text-center">
                              <p className="text-sm text-muted-foreground mb-2">
                                No subtasks yet.
                              </p>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={addNewSubtask}
                              >
                                <Plus className="h-4 w-4 mr-1" />
                                Add Subtask
                              </Button>
                            </div>
                          )}
                        </div>
                      )}

                      {/* For User Stories: Testcases */}
                      {selectedItem.type === "story" && (
                        <div className="mb-6">
                          <div className="flex items-center justify-between mb-3">
                            <Label className="text-sm font-medium text-foreground">
                              Testcases (
                              {(selectedItem as any).testCases?.length || 0})
                            </Label>
                          </div>
                          {(selectedItem as any).testCases &&
                            (selectedItem as any).testCases.length > 0 ? (
                            <div className="space-y-4">
                              {((selectedItem as any).testCases || []).map(
                                (testCase: any, idx: number) => {
                                  // Debug logging
                                  if (idx === 0) {
                                    console.log('[Step2] Rendering test case:', {
                                      id: testCase.id,
                                      title: testCase.title,
                                      hasSteps: !!testCase.steps,
                                      stepsLength: testCase.steps?.length || 0,
                                      hasTestCaseSteps: !!testCase.testCaseSteps,
                                      testCaseStepsLength: testCase.testCaseSteps?.length || 0,
                                      stepsType: testCase.steps?.[0] ? typeof testCase.steps[0] : 'none',
                                      testCaseStepsType: testCase.testCaseSteps?.[0] ? typeof testCase.testCaseSteps[0] : 'none'
                                    });
                                  }

                                  return (
                                    <Card
                                      key={idx}
                                      className="bg-accent/30 border border-border"
                                    >
                                      <CardHeader className="pb-3">
                                        <CardTitle className="text-sm font-medium">
                                          #{idx + 1}{" "}
                                          {testCase.title ||
                                            testCase.scenario ||
                                            `Test Case ${idx + 1}`}
                                        </CardTitle>
                                      </CardHeader>
                                      <CardContent>
                                        {testCase.steps &&
                                          Array.isArray(testCase.steps) &&
                                          testCase.steps.length > 0 ? (
                                          <div className="overflow-x-auto">
                                            <Table>
                                              <TableHeader>
                                                <TableRow>
                                                  <TableHead className="w-16">
                                                    Step
                                                  </TableHead>
                                                  <TableHead>Action</TableHead>
                                                  <TableHead>Result</TableHead>
                                                </TableRow>
                                              </TableHeader>
                                              <TableBody>
                                                {testCase.steps.map(
                                                  (step: any, stepIdx: number) => {
                                                    // Handle new format: {step, action, result}
                                                    // Also support backward compatibility with old formats
                                                    let stepNum = stepIdx + 1;
                                                    let action = "";
                                                    let result = "";

                                                    if (typeof step === "string") {
                                                      // String format: use as action, no result
                                                      action = step;
                                                      result = ""; // Will show empty or placeholder
                                                    } else if (
                                                      typeof step === "object" &&
                                                      step !== null
                                                    ) {
                                                      // Object format: extract step number, action, and result
                                                      stepNum =
                                                        step.step !== undefined && step.step !== null
                                                          ? step.step
                                                          : step.stepNumber ||
                                                          step.Steps ||
                                                          stepIdx + 1;
                                                      action =
                                                        step.action ||
                                                        step.Action ||
                                                        "";
                                                      result =
                                                        step.result ||
                                                        step.expectedResult ||
                                                        step.expectedResults ||
                                                        step["Expected Results"] ||
                                                        step["Expected Result"] ||
                                                        "";
                                                    }

                                                    return (
                                                      <TableRow key={stepIdx}>
                                                        <TableCell className="font-medium">
                                                          {stepNum}
                                                        </TableCell>
                                                        <TableCell className="font-medium">
                                                          {action || "(No action specified)"}
                                                        </TableCell>
                                                        <TableCell className={result ? "text-foreground" : "text-muted-foreground italic"}>
                                                          {result || "(Expected result not specified)"}
                                                        </TableCell>
                                                      </TableRow>
                                                    );
                                                  }
                                                )}
                                              </TableBody>
                                            </Table>
                                          </div>
                                        ) : testCase.testCaseSteps &&
                                          testCase.testCaseSteps.length > 0 ? (
                                          // Fallback for old testCaseSteps format - handle both strings and objects
                                          <div className="overflow-x-auto">
                                            <Table>
                                              <TableHeader>
                                                <TableRow>
                                                  <TableHead className="w-16">
                                                    Step
                                                  </TableHead>
                                                  <TableHead>Action</TableHead>
                                                  <TableHead>Result</TableHead>
                                                </TableRow>
                                              </TableHeader>
                                              <TableBody>
                                                {testCase.testCaseSteps.map(
                                                  (step: any, stepIdx: number) => {
                                                    // Handle string format (from UniversalAgent API - legacy)
                                                    if (typeof step === "string") {
                                                      return (
                                                        <TableRow key={stepIdx}>
                                                          <TableCell className="font-medium">
                                                            {stepIdx + 1}
                                                          </TableCell>
                                                          <TableCell className="font-medium">
                                                            {step}
                                                          </TableCell>
                                                          <TableCell className="text-muted-foreground italic">
                                                            (Expected result not specified)
                                                          </TableCell>
                                                        </TableRow>
                                                      );
                                                    }

                                                    // Handle object format (preferred - with action and result)
                                                    const stepNum = step.step !== undefined && step.step !== null
                                                      ? step.step
                                                      : step.Steps !== undefined
                                                        ? step.Steps
                                                        : stepIdx + 1;
                                                    const action = step.Action || step.action || "";
                                                    const result = step.result ||
                                                      step["Expected Results"] ||
                                                      step.expectedResults ||
                                                      step.expectedResult ||
                                                      "";

                                                    return (
                                                      <TableRow key={stepIdx}>
                                                        <TableCell className="font-medium">
                                                          {stepNum}
                                                        </TableCell>
                                                        <TableCell className="font-medium">
                                                          {action || "(No action specified)"}
                                                        </TableCell>
                                                        <TableCell className={result ? "text-foreground" : "text-muted-foreground italic"}>
                                                          {result || "(Expected result not specified)"}
                                                        </TableCell>
                                                      </TableRow>
                                                    );
                                                  }
                                                )}
                                              </TableBody>
                                            </Table>
                                          </div>
                                        ) : (
                                          <p className="text-sm text-muted-foreground">
                                            No test steps available
                                          </p>
                                        )}
                                      </CardContent>
                                    </Card>
                                  );
                                }
                              )}
                            </div>
                          ) : (
                            <p className="text-sm text-muted-foreground text-center py-4">
                              No testcases available
                            </p>
                          )}
                        </div>
                      )}

                      {/* For Features: Linked Stories */}
                      {selectedItem.type === "feature" && (
                        <div className="mb-6">
                          <Label className="text-sm font-medium text-foreground mb-2 block">
                            User Stories (
                            {
                              userStories.filter(
                                (s) => s.featureId === selectedItem.id
                              ).length
                            }
                            )
                          </Label>
                          <div className="space-y-2">
                            {userStories
                              .filter((s) => s.featureId === selectedItem.id)
                              .map((story) => (
                                <div
                                  key={story.id}
                                  className="flex items-start gap-2 p-2 hover:bg-accent rounded cursor-pointer border border-border min-w-0"
                                  onClick={() => handleSelectStory(story)}
                                >
                                  <div className="w-5 h-5 rounded bg-green-500 flex items-center justify-center flex-shrink-0">
                                    <span className="text-white text-xs font-bold">
                                      S
                                    </span>
                                  </div>
                                  <span className="text-sm text-muted-foreground flex-shrink-0">
                                    {story.id}
                                  </span>
                                  <span className="text-sm text-foreground flex-1 min-w-0 break-words line-clamp-2">
                                    {story.title}
                                  </span>
                                </div>
                              ))}
                          </div>
                        </div>
                      )}

                      {/* For Epics: Linked Features */}
                      {selectedItem.type === "epic" && (
                        <div className="mb-6">
                          <Label className="text-sm font-medium text-foreground mb-2 block">
                            Features (
                            {
                              features.filter((f) => f.epicId === selectedItem.id)
                                .length
                            }
                            )
                          </Label>
                          <div className="space-y-2">
                            {features
                              .filter((f) => f.epicId === selectedItem.id)
                              .map((feature) => (
                                <div
                                  key={feature.id}
                                  className="flex items-start gap-2 p-2 hover:bg-accent rounded cursor-pointer border border-border min-w-0"
                                  onClick={() => handleSelectFeature(feature)}
                                >
                                  <div className="w-5 h-5 rounded bg-blue-500 flex items-center justify-center flex-shrink-0">
                                    <span className="text-white text-xs font-bold">
                                      F
                                    </span>
                                  </div>
                                  <span className="text-sm text-muted-foreground flex-shrink-0">
                                    {feature.id}
                                  </span>
                                  <span className="text-sm text-foreground flex-1 min-w-0 break-words line-clamp-2">
                                    {feature.title}
                                  </span>
                                </div>
                              ))}
                          </div>
                        </div>
                      )}

                      {/* Details Section */}
                      <div className="grid grid-cols-2 gap-6 pt-6 border-t border-border">
                        {/* Priority */}
                        <div>
                          <Label className="text-xs text-muted-foreground uppercase mb-2 block">
                            Priority
                          </Label>
                          <div className="flex items-center gap-1">
                            {selectedItem.priority === "High" && (
                              <ArrowUp className="h-4 w-4 text-red-500" />
                            )}
                            {selectedItem.priority === "Medium" && (
                              <ArrowUp className="h-4 w-4 text-orange-500" />
                            )}
                            {selectedItem.priority === "Low" && (
                              <ArrowUp className="h-4 w-4 text-blue-500" />
                            )}
                            <span
                              className={`text-sm font-medium ${selectedItem.priority === "High"
                                  ? "text-red-600"
                                  : selectedItem.priority === "Medium"
                                    ? "text-orange-600"
                                    : "text-blue-600"
                                }`}
                            >
                              {selectedItem.priority}
                            </span>
                          </div>
                        </div>

                        {/* Story Points (for stories) */}
                        {selectedItem.type === "story" &&
                          "storyPoints" in selectedItem && (
                            <div>
                              <Label className="text-xs text-muted-foreground uppercase mb-2 block">
                                Story Points
                              </Label>
                              <span className="text-sm font-medium text-foreground">
                                {selectedItem.storyPoints}
                              </span>
                            </div>
                          )}
                      </div>

                      {/* Persona (for stories) - Show below Story Points in a new row */}
                      {selectedItem.type === "story" &&
                        ("persona" in selectedItem ||
                          "personaId" in selectedItem ||
                          (selectedItem as any).generatedByQA) && (
                          <div className="pt-6 border-t border-border">
                            <Label className="text-xs text-muted-foreground uppercase mb-2 block">
                              Persona
                            </Label>
                            <div className="flex items-center gap-2 min-w-0">
                              {(() => {
                                const item = selectedItem as any;
                                // Try to get persona from persona field (string from LLM) first
                                let personaName = item.persona;
                                // If QA-generated and no persona/personaId, parse "As a [role]," from title or description
                                if (!personaName && item.generatedByQA) {
                                  const text = [item.title, item.description].filter(Boolean).join(" ");
                                  const match = text.match(/As an?\s+([^,]+),/i) || text.match(/As a ([^,]+),/i);
                                  if (match) personaName = match[1].trim();
                                }
                                // If personaId exists, try to find it in personas array
                                const personaFromId =
                                  "personaId" in selectedItem &&
                                    selectedItem.personaId
                                    ? personas.find(
                                      (p) => p.id === selectedItem.personaId
                                    )
                                    : null;

                                const displayName =
                                  personaName || personaFromId?.name || "Unknown";
                                const personaColor = personaFromId?.color || "blue";
                                const storyPersonaSource = item.personaSource as string | undefined;
                                const personaObjectSource = (personaFromId as any)
                                  ?.personaSource as string | undefined;

                                // Normalize to UI tags:
                                // - From Golden Repo (golden persona file) -> "Golden Repo Persona" (highest priority)
                                // - From Persona Hub                       -> "Hub Persona"
                                // - QA-generated parsed from text          -> "QA Generated"
                                // - AI fallback                            -> "AI Suggested"
                                // Accept the legacy 'golden-repo-file' value for backwards compatibility.
                                const goldenLabels = new Set(["From Golden Repo", "golden-repo-file"]);
                                const isFromGolden =
                                  goldenLabels.has(storyPersonaSource ?? "") ||
                                  goldenLabels.has(personaObjectSource ?? "");
                                const isFromHub =
                                  storyPersonaSource === "From Persona Hub" ||
                                  personaObjectSource === "From Persona Hub";
                                const isQAParsed = item.generatedByQA && !personaFromId && !item.personaId;

                                const personaSourceLabel = isFromGolden
                                  ? "Golden Repo Persona"
                                  : isFromHub
                                    ? "Hub Persona"
                                    : isQAParsed
                                      ? "QA Generated"
                                      : "AI Suggested";

                                return (
                                  <>
                                    <Avatar className="h-7 w-7 flex-shrink-0">
                                      <AvatarFallback
                                        className={`text-xs ${personaColors[
                                          personaColor as keyof typeof personaColors
                                          ] || "bg-gray-500"
                                          }`}
                                      >
                                        {displayName
                                          .split(" ")
                                          .map((n: string) => n[0])
                                          .join("") || "?"}
                                      </AvatarFallback>
                                    </Avatar>
                                    <div className="flex-1 min-w-0">
                                      <div className="flex items-center gap-2">
                                        <span className="text-sm text-foreground truncate min-w-0">
                                          {displayName}
                                        </span>
                                        <Badge
                                          variant={
                                            isFromGolden || isFromHub ? "default" : "secondary"
                                          }
                                          className="text-xs flex-shrink-0"
                                        >
                                          {personaSourceLabel}
                                        </Badge>
                                      </div>
                                    </div>
                                  </>
                                );
                              })()}
                            </div>
                          </div>
                        )}

                      {/* Save/Cancel Buttons - Show when editing */}
                      {(isEditingTitle ||
                        isEditingDescription ||
                        isEditingACs ||
                        isEditingSubtasks) && (
                          <div className="flex gap-2 justify-end mt-6 pt-6 border-t border-border sticky bottom-0 bg-card pb-2">
                            <Button variant="outline" onClick={cancelInlineEdits}>
                              Cancel
                            </Button>
                            <Button onClick={saveInlineEdits}>
                              <Save className="h-4 w-4 mr-2" />
                              Save Changes
                            </Button>
                          </div>
                        )}
                    </div>
                  </div>
                </>
              )}
            </div>
          </>
        )}
      </div>

      {/* Wiki Documentation Section - Collapsible Below Split View */}
      <div className="w-full bg-background border-t border-border">
        {/* Collapsible Header */}
        <div
          className="flex items-center justify-between px-6 py-3 cursor-pointer hover:bg-accent/50 transition-colors"
          onClick={() => setIsWikiExpanded(!isWikiExpanded)}
          data-testid="button-toggle-wiki"
        >
          <div className="flex items-center gap-3">
            <BookOpen className="h-5 w-5 text-purple-600 dark:text-purple-400" />
            <span className="font-medium text-foreground">
              {integrationType === "jira" ? "Confluence Documentation" : "Wiki Documentation"}
            </span>
            {wikiPages.length > 0 && (
              <Badge variant="secondary" className="text-xs">
                {wikiPages.length} pages
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-2">
            {wikiPages.length > 0 && (
              <Button
                variant="outline"
                size="sm"
                onClick={(e) => {
                  e.stopPropagation();
                  downloadAllWiki();
                }}
              >
                <Download className="h-4 w-4 mr-2" />
                Download All
              </Button>
            )}
            {isWikiExpanded ? (
              <ChevronUp className="h-5 w-5 text-muted-foreground" />
            ) : (
              <ChevronDown className="h-5 w-5 text-muted-foreground" />
            )}
          </div>
        </div>

        {/* Expanded Wiki Content */}
        {isWikiExpanded && (
          <div
            className="px-6 pb-6 overflow-y-auto"
            style={{ maxHeight: "40vh" }}
          >
            <Card className="border-purple-200 dark:border-purple-800">
              <CardContent className="pt-4">
                {wikiPages.length === 0 ? (
                  <div className="text-center py-12 text-muted-foreground">
                    <BookOpen className="h-12 w-12 mx-auto mb-4 opacity-20" />
                    <p className="text-sm">
                      Click "{integrationType === "jira" ? "Generate Confluence Page" : "Generate Wiki"}" to create comprehensive SDLC
                      documentation
                    </p>
                    <p className="text-xs mt-2">
                      Includes: Feasibility Study, SRS, Architecture, Diagrams,
                      Test Plans, and 25+ more documents
                    </p>
                  </div>
                ) : (
                  <Tabs defaultValue="all" className="w-full">
                    <TabsList className="grid grid-cols-8 w-full mb-4">
                      <TabsTrigger value="all" className="text-xs">
                        All ({wikiPages.length})
                      </TabsTrigger>
                      {Object.entries(phaseConfig).map(([phase, config]) => {
                        const PhaseIcon = config.icon;
                        const count = wikiPages.filter(
                          (p) => p.phase === phase
                        ).length;
                        return (
                          <TabsTrigger
                            key={phase}
                            value={phase}
                            className="text-xs"
                          >
                            <PhaseIcon
                              className={`h-3 w-3 mr-1 ${config.color}`}
                            />
                            {config.label} ({count})
                          </TabsTrigger>
                        );
                      })}
                    </TabsList>

                    <TabsContent value="all" className="mt-0">
                      <div className="space-y-6">
                        {Object.entries(phaseConfig).map(([phase, config]) => {
                          const phaseDocs = wikiPages
                            .filter((p) => p.phase === phase)
                            .sort((a, b) => (a.order || 0) - (b.order || 0));
                          if (phaseDocs.length === 0) return null;

                          const PhaseIcon = config.icon;

                          return (
                            <div key={phase} className="space-y-3">
                              <div className="flex items-center gap-2">
                                <PhaseIcon
                                  className={`h-5 w-5 ${config.color}`}
                                />
                                <h3 className="font-semibold text-sm uppercase tracking-wide">
                                  {config.label} ({phaseDocs.length})
                                </h3>
                              </div>
                              <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-3">
                                {phaseDocs.map((page) => (
                                  <Card
                                    key={page.id}
                                    className={`hover-elevate active-elevate-2 cursor-pointer ${config.bgColor} ${config.borderColor}`}
                                    onClick={() => setSelectedWikiPage(page)}
                                  >
                                    <CardContent className="p-4">
                                      <div className="flex items-start justify-between gap-2">
                                        <div className="flex-1">
                                          <div className="flex items-center gap-2 mb-2">
                                            <FileText
                                              className={`h-4 w-4 ${config.color}`}
                                            />
                                            <h4 className="font-semibold text-sm">
                                              {page.title}
                                            </h4>
                                          </div>
                                          <p className="text-xs text-muted-foreground line-clamp-2">
                                            {page.content.substring(0, 100)}...
                                          </p>
                                        </div>
                                        <div className="flex gap-1">
                                          <Button
                                            variant="ghost"
                                            size="icon"
                                            className="h-6 w-6"
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              setEditingWikiPage(page);
                                            }}
                                          >
                                            <Edit className="h-3 w-3" />
                                          </Button>
                                          <Button
                                            variant="ghost"
                                            size="icon"
                                            className="h-6 w-6"
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              downloadWikiPage(page);
                                            }}
                                          >
                                            <Download className="h-3 w-3" />
                                          </Button>
                                        </div>
                                      </div>
                                      <div className="flex gap-2 mt-2">
                                        <Badge
                                          variant="secondary"
                                          className="text-xs"
                                        >
                                          {page.pageType}
                                        </Badge>
                                        <Badge
                                          variant="outline"
                                          className="text-xs"
                                        >
                                          #{page.order}
                                        </Badge>
                                      </div>
                                    </CardContent>
                                  </Card>
                                ))}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </TabsContent>

                    {Object.entries(phaseConfig).map(([phase, config]) => {
                      const phaseDocs = wikiPages
                        .filter((p) => p.phase === phase)
                        .sort((a, b) => (a.order || 0) - (b.order || 0));
                      const PhaseIcon = config.icon;

                      return (
                        <TabsContent key={phase} value={phase} className="mt-0">
                          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-3">
                            {phaseDocs.map((page) => (
                              <Card
                                key={page.id}
                                className={`hover-elevate active-elevate-2 cursor-pointer ${config.bgColor} ${config.borderColor}`}
                                onClick={() => setSelectedWikiPage(page)}
                              >
                                <CardContent className="p-4">
                                  <div className="flex items-start justify-between gap-2">
                                    <div className="flex-1">
                                      <div className="flex items-center gap-2 mb-2">
                                        <FileText
                                          className={`h-4 w-4 ${config.color}`}
                                        />
                                        <h4 className="font-semibold text-sm">
                                          {page.title}
                                        </h4>
                                      </div>
                                      <p className="text-xs text-muted-foreground line-clamp-2">
                                        {page.content.substring(0, 100)}...
                                      </p>
                                    </div>
                                    <div className="flex gap-1">
                                      <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-6 w-6"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setEditingWikiPage(page);
                                        }}
                                      >
                                        <Edit className="h-3 w-3" />
                                      </Button>
                                      <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-6 w-6"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          downloadWikiPage(page);
                                        }}
                                      >
                                        <Download className="h-3 w-3" />
                                      </Button>
                                    </div>
                                  </div>
                                  <div className="flex gap-2 mt-2">
                                    <Badge
                                      variant="secondary"
                                      className="text-xs"
                                    >
                                      {page.pageType}
                                    </Badge>
                                    <Badge
                                      variant="outline"
                                      className="text-xs"
                                    >
                                      #{page.order}
                                    </Badge>
                                    {page.isGenerated && (
                                      <Badge variant="default" className="text-[10px] bg-emerald-600 hover:bg-emerald-700">
                                        Generated
                                      </Badge>
                                    )}
                                  </div>
                                </CardContent>
                              </Card>
                            ))}
                          </div>
                        </TabsContent>
                      );
                    })}
                  </Tabs>
                )}
              </CardContent>
            </Card>
          </div>
        )}
      </div>

      {/* Bulk Merge Dialog */}
      <BulkMergeDialog
        open={bulkMergeOpen}
        onOpenChange={(open) => {
          setBulkMergeOpen(open);
          if (!open) setBulkAutoSuggest(false);
        }}
        autoSuggestOnOpen={bulkAutoSuggest}
        epics={mergeableEpics}
        features={mergeableFeatures}
        userStories={mergeableStories}
        epicTitleById={epicTitleById}
        featureTitleById={featureTitleById}
        isMerging={isMerging}
        isSuggesting={isSuggesting}
        onSuggest={handleBulkSuggest}
        onMerge={handleBulkMerge}
      />

      {/* Artifact Edit Dialog */}
      <ArtifactEditDialog
        open={!!editingArtifact}
        onOpenChange={(open) => {
          if (!open) {
            setEditingArtifact(null);
            setEditingArtifactType(null);
          }
        }}
        artifact={editingArtifact}
        artifactType={editingArtifactType || "epic"}
        onSave={handleSaveArtifact}
      />

      {/* Wiki Edit Dialog */}
      <WikiEditDialog
        open={!!editingWikiPage}
        onOpenChange={(open) => {
          if (!open) {
            setEditingWikiPage(null);
          }
        }}
        wikiPage={editingWikiPage}
        onSave={handleSaveWikiPage}
        integrationType={integrationType}
      />

      {/* Wiki Page Modal - Use the same component as SDLC backlog document view */}
      {selectedWikiPage && (
        <WikiPageModal
          wikiPage={selectedWikiPage}
          open={!!selectedWikiPage}
          onClose={() => setSelectedWikiPage(null)}
          integrationType={integrationType}
        />
      )}

      {/* BRD Selection Dialog */}
      <Dialog open={brdDialogOpen} onOpenChange={setBrdDialogOpen}>
        <DialogContent className="sm:max-w-[520px]">
          <DialogHeader>
            <DialogTitle>Attach BRD</DialogTitle>
            <DialogDescription>
              Select a BRD to attach to this workflow (excluding draft and review statuses).
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            {approvedBrds.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No available BRDs found for this project (excluding draft and review statuses).
              </p>
            ) : (
              <ScrollArea className="max-h-64 pr-2">
                <RadioGroup
                  value={selectedBrdId || undefined}
                  onValueChange={(val) => {
                    setSelectedBrdId(val);
                    setBrdId(val); // Update workflow context
                  }}
                  className="space-y-2"
                >
                  {approvedBrds.map((brd) => (
                    <div
                      key={brd.id}
                      className="flex items-start gap-3 p-3 rounded-lg border hover:border-primary/50"
                    >
                      <RadioGroupItem value={brd.id} className="mt-1" />
                      <div className="space-y-1 flex-1">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-semibold">{brd.title}</p>
                          {brd.status && (
                            <Badge
                              variant="outline"
                              className={cn(
                                "text-xs",
                                (() => {
                                  const status = String(brd.status).toLowerCase().trim();
                                  if (status === "approved") return "border-green-500 text-green-600 dark:text-green-400";
                                  if (status === "partially_generated") return "border-blue-500 text-blue-600 dark:text-blue-400";
                                  if (status === "generated") return "border-purple-500 text-purple-600 dark:text-purple-400";
                                  if (status === "pending_review") return "border-yellow-500 text-yellow-600 dark:text-yellow-400";
                                  if (status === "rejected") return "border-red-500 text-red-600 dark:text-red-400";
                                  return "border-gray-500 text-gray-600 dark:text-gray-400";
                                })()
                              )}
                            >
                              {(() => {
                                const status = String(brd.status).toLowerCase().trim();
                                if (status === "approved") return "Approved";
                                if (status === "partially_generated") return "Partially Generated";
                                if (status === "generated") return "Generated";
                                if (status === "pending_review") return "Pending Review";
                                if (status === "rejected") return "Rejected";
                                // Fallback: show the actual status value
                                return String(brd.status);
                              })()}
                            </Badge>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground">
                          Updated:{" "}
                          {brd.updated_at
                            ? new Date(brd.updated_at).toLocaleString()
                            : "Unknown"}
                        </p>
                      </div>
                    </div>
                  ))}
                </RadioGroup>
              </ScrollArea>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setBrdDialogOpen(false)}>
                Cancel
              </Button>
              <Button
                onClick={handleAttachBrdToWorkflow}
                disabled={!selectedBrdId || isAttachingBrd}
              >
                {isAttachingBrd ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Attaching...
                  </>
                ) : (
                  "Attach BRD"
                )}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Jira Issue Type Reminder Modal */}
      <Dialog open={showJiraReminder} onOpenChange={setShowJiraReminder}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-amber-600">
              <AlertCircle className="h-5 w-5" />
              Jira Configuration Reminder
            </DialogTitle>
            <DialogDescription className="py-2">
              To ensure full compatibility and traceability for Jira projects, please verify that your Jira instance has the following custom issue types configured:
            </DialogDescription>
          </DialogHeader>
          <div className="bg-muted/50 p-4 rounded-lg space-y-2 text-sm border">
            <div className="font-semibold text-foreground border-b pb-1 mb-2">Required Issue Types:</div>
            <ul className="grid grid-cols-2 gap-x-4 gap-y-1 ml-4 list-disc text-muted-foreground">
              <li>Epic</li>
              <li>Feature</li>
              <li>User Story</li>
              <li>Test Case</li>
              <li className="col-span-2">Bug</li>
            </ul>
          </div>
          <div className="text-xs text-muted-foreground italic mt-2">
            * Note: Standard Jira projects may only include "Task" and "Subtask" by default. Ensure these types exist or are mapped correctly.
          </div>
          <DialogFooter className="sm:justify-end mt-4">
            <Button type="button" onClick={handleDismissJiraReminder}>
              Got it
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  );
}
