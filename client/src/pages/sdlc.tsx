import { useState, useEffect, useMemo, useRef, Fragment } from "react";

import { useQuery, useMutation, useInfiniteQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { WorkItemDialog } from "@/components/work-item-dialog";
import { CICDActionDialog } from "@/components/cicd-action-dialog";
import { PhaseFeatureDialog } from "@/components/phase-feature-dialog";
import { BRDPreview, BRDDocument } from "@/components/brd/brd-preview";
import { PhaseConfirmationCard } from "@/components/phase-confirmation-card";
import { ConfirmationDialog } from "@/components/confirmation-dialog";
import { DeploymentModal } from "@/components/sdlc/deployment-modal";
import { DevelopmentAdoModal } from "@/components/sdlc/development-ado-modal";
import { StoryProgressModal } from "@/components/sdlc/story-progress-modal";
import { DeveloperAssignmentsModal } from "@/components/sdlc/developer-assignments-modal";
import { VelocityIndicatorsModal } from "@/components/sdlc/velocity-indicators-modal";
import { StatusModal } from "@/components/sdlc/status-modal";
import { TestingModals } from "@/components/sdlc/testing-modals";
import { ViewTestPlansModal } from "@/components/sdlc/view-test-plans-modal";
import { GLOBAL_ALL_ORGANIZATIONS_ID, useSelectedOrganization as useGlobalSelectedOrganization } from "@/contexts/selected-organization-context";
import { ComprehensiveTestingModal } from "@/components/sdlc/comprehensive-testing-modal";
import { TestCasesViewerModal } from "@/components/sdlc/test-cases-viewer-modal";

import { PipelineModal } from "@/components/sdlc/deploy-Pipeline-modal";
import { PipelinesModal } from "@/components/sdlc/build-pipelines-modal";
import { TestReportsModal } from "@/components/sdlc/test-reports-modal";
import { PackagesModal } from "@/components/sdlc/packages-modal";
import { JobsModal } from "@/components/sdlc/jobs-modal";
import { BuildStatusMetricsModal } from "@/components/sdlc/build-status-metrics-modal";
import { CreatePipelineModal } from "@/components/sdlc/create-pipeline-modal";
import { DeploymentStatusModal } from "@/components/sdlc/deployment-status-modal";
import { ReleasesModal } from "@/components/sdlc/releases-modal";
import { TriggerReleaseModal } from "@/components/sdlc/trigger-release-modal";
import { PipelineHealthModal } from "@/components/sdlc/pipeline-health-modal";
import { MonitorModal } from "@/components/sdlc/monitor-modal";
import { ErrorTrackingModal } from "@/components/sdlc/error-tracking-modal";
import { AlertsModal } from "@/components/sdlc/alerts-modal";
import { DeploymentTrendsModal } from "@/components/sdlc/deployment-trends-modal";
import { DeploymentTrackingModal } from "@/components/sdlc/deployment-tracking-modal";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { GenericModal } from "@/components/ui/generic-modal";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { AiEnhanceWithDiff } from "@/components/AiEnhanceWithDiff";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { BackButton } from "@/components/ui/back-button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  FileSearch,
  Palette,
  Code,
  FlaskConical,
  Rocket,
  Wrench,
  FileCode,
  GitBranch,
  Clipboard,
  ClipboardList,
  Users,
  FileText,
  FolderGit2,
  Target,
  UserPlus,
  Link as LinkIcon,
  Repeat,
  Upload,
  Figma,
  Eye,
  GitPullRequest,
  GitCommit,
  GitMerge,
  Tag,
  Send,
  CheckCircle2,
  Play,
  PlayCircle,
  Upload as UploadCloud,
  MonitorDot,
  TrendingUp,
  TrendingDown,
  BarChart3,
  AlertCircle,
  Clock,
  Flag,
  Star,
  Home,
  ChevronRight,
  Search,
  Bell,
  UserCircle,
  Network,
  Package,
  Settings,
  Archive,
  Shield,
  Tags,
  Globe,
  Server,
  Cloud,
  Activity,
  Zap,
  BookOpen,
  Database,
  Container,
  Sparkles,
  Plus,
  ChevronDown,
  Bot,
  User,
  Loader2,
  Download,
  Edit,
  Copy,
  ExternalLink,
  RefreshCw,
  Briefcase,
  ChevronUp,
  Filter,
  ArrowUpDown,
  X,
  Trash2,
  RotateCcw,
  AlignCenter,
  Maximize2,
  Minimize2,
  Folder,
  ArrowLeft,
  TestTube,
  Workflow,
} from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Link, useLocation, useSearch } from "wouter";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { pollAsyncJob } from "@/lib/async-job-poller";
import { getApiUrl } from "@/lib/api-config";
import { useTestingCounts, useFileBrowser } from "@/hooks/use-testing";
import { useToast } from "@/hooks/use-toast";
import { useMe } from "@/hooks/use-me";
import { useSessionIdentity } from "@/utils/msal-user";
import type { SDLCProject, SDLCPhase } from "@shared/schema";
import { useAdoAllowed, useJiraOnlyWorkItems } from "@/hooks/use-hosting-config";
import { RequirementArtifactsDialog } from "@/components/sdlc/requirement-artifacts-dialog";
import { ExpandablePromptBox } from "@/components/expandable-prompt-box";
import { GoldenRepoGuidelineSelector } from "@/components/golden-repo-guideline-selector";
import { goldenRepoSelectorPropsFromRef } from "@/lib/golden-repositories";
import { GenerateGuidelineModal } from "@/components/GenerateGuidelineModal";
import { RunBuildDialog } from "@/components/run-build-dialog";

type WorkItemType =
  | "issues"
  | "epics"
  | "requirements"
  | "backlog"
  | "documents";

const SDLC_PROJECT_PAGE_SIZE = 25;

// SDLC Phases with detailed features and actions - In correct sequential order matching backend phaseNumber
const sdlcPhases = [
  // Phase 1: Backlogs (backend phaseNumber: 1)
  {
    id: 1,
    name: "Backlogs",
    icon: Bot,
    percentage: 0,
    features: [
      { icon: Clipboard, label: "Requirements" },
      { icon: FileText, label: "Work Items" },
      { icon: BookOpen, label: "Documents" },
    ],
    actions: [],
    buttonText: "Workflow",
    buttonIcon: Bot,
    workflowButton: true,
    color: "from-blue-500 to-blue-600",
  },
  // Phase 2: Design (backend phaseNumber: 2)
  {
    id: 2,
    name: "Design",
    icon: Palette,
    percentage: 0,
    features: [
      { icon: FileText, label: "Generate Guideline" },
      { icon: Palette, label: "UI/UX design" },
    ],
    actions: [],
    buttonText: "Push to Repo",
    buttonIcon: Upload,
    workflowButton: false,
    color: "from-pink-500 to-pink-600",
  },
  // Phase 3: Development (backend phaseNumber: 3)
  {
    id: 3,
    name: "Development",
    icon: Code,
    percentage: 0,
    features: [
      { icon: TrendingUp, label: "Story Progress" },
      { icon: FileText, label: "Specs" },
      { icon: Users, label: "Developer Assignments" },
      { icon: TrendingUp, label: "Velocity Indicators" },
      { icon: FileText, label: "New" },
      { icon: Clock, label: "Active" },
      { icon: AlertCircle, label: "Resolved" },
      { icon: CheckCircle2, label: "Closed" },
      { icon: RotateCcw, label: "Reopened" },
    ],
    actions: [],
    buttonText: "Generate Specs",
    buttonIcon: Code,
    workflowButton: false,
    codeGenButton: true,
    color: "from-emerald-500 to-emerald-600",
  },
  // Phase 4: Testing (backend phaseNumber: 4)
  {
    id: 4,
    name: "Testing",
    icon: FlaskConical,
    percentage: 0,
    features: [
      {
        icon: FileText,
        label: "Test Cases",
      },
      {
        icon: FileCode,
        label: "BDD Feature Files",
      },
      {
        icon: FileCode,
        label: "BDD Step Definition Files",
      },
      {
        icon: TestTube,
        label: "End-To-End Scenarios",
      },
      {
        icon: ClipboardList,
        label: "Test Plans",
      },
      {
        icon: FlaskConical,
        label: "QE Capability",
      },
    ],
    actions: [],
    buttonText: "Generate Test Artifacts",
    buttonIcon: FileText,
    workflowButton: false,
    testPlanButton: true, // Add flag for test artifacts generation button
    color: "from-purple-500 to-purple-600",
  },
  // Phase 5: Build (backend phaseNumber: 5)
  {
    id: 5,
    name: "Build",
    icon: Wrench,
    percentage: 0,
    features: [
      { icon: GitBranch, label: "Build Pipelines" },
      { icon: FileText, label: "View test report" },
      { icon: UploadCloud, label: "Publish package" },
      { icon: Briefcase, label: "Jobs" },
      { icon: BarChart3, label: "Build Status Metrics" },
    ],
    actions: [],
    buttonText: "Deploy to Prod",
    buttonIcon: Rocket,
    workflowButton: false,
    color: "from-amber-500 to-amber-600",
  },
  // Phase 6: Deployment (backend phaseNumber: 6)
  {
    id: 6,
    name: "Deployment",
    icon: Rocket,
    percentage: 0,
    features: [
      { icon: GitBranch, label: "Pipeline" },
      { icon: Activity, label: "Deployment Status" },
      { icon: Package, label: "Releases" },
      { icon: Play, label: "Trigger release" },
      { icon: Wrench, label: "Manage rollout" },
      { icon: Target, label: "Deployment Tracking" },
    ],
    actions: [],
    buttonText: "Open Monitoring",
    buttonIcon: Activity,
    workflowButton: false,
    color: "from-orange-500 to-orange-600",
  },
  // Phase 7: Maintenance (backend phaseNumber: 7)
  {
    id: 7,
    name: "Maintenance",
    icon: Wrench,
    percentage: 0,
    features: [
      { icon: Activity, label: "Pipeline Health" },
      { icon: MonitorDot, label: "Monitor" },
      { icon: AlertCircle, label: "Error tracking" },
      { icon: Bell, label: "Alerts" },
      { icon: TrendingUp, label: "Deployment Trends" },
    ],
    actions: [],
    buttonText: "Generate reports",
    buttonIcon: FileText,
    workflowButton: false,
    color: "from-cyan-500 to-cyan-600",
  },
];

async function readProjectLookupError(response: Response, fallback: string) {
  try {
    const payload = await response.json();
    return typeof payload?.error === "string" ? payload.error : fallback;
  } catch {
    return fallback;
  }
}

function normalizeOrgText(value?: string | null) {
  return (value || "").trim().replace(/\/+$/, "").toLowerCase();
}

function normalizeOrgUrl(value?: string | null) {
  return normalizeOrgText(value).replace(/^https?:\/\//, "");
}

function projectMatchesGlobalOrganization(
  project:
    | {
      organization?: string | null;
      organizationUrl?: string | null;
      artifactOrgId?: string | null;
      jiraConnectionId?: string | null;
      jiraInstanceUrl?: string | null;
    }
    | null
    | undefined,
  organization:
    | {
      id?: string | null;
      name?: string | null;
      description?: string | null;
      sourceType?: string | null;
    }
    | null
    | undefined,
) {
  if (!project || !organization || organization.sourceType === "all") return true;

  if (organization.id) {
    if (project.artifactOrgId === organization.id || project.jiraConnectionId === organization.id) {
      return true;
    }
  }

  const selectedName = normalizeOrgText(organization.name);
  const projectOrg = normalizeOrgText(project.organization);
  if (selectedName && projectOrg && selectedName === projectOrg) return true;

  const selectedUrl = normalizeOrgUrl(organization.description);
  const projectUrls = [
    project.organizationUrl,
    project.jiraInstanceUrl,
    project.organization,
  ].map(normalizeOrgUrl);

  return !!selectedUrl && projectUrls.some((url) => url === selectedUrl);
}

export default function SDLCPage() {
  const { toast } = useToast();
  const {
    selectedOrganizationId: globalSelectedOrganizationId,
    selectedOrganization: globalSelectedOrganization,
    organizations: globalOrganizations,
    setSelectedOrganizationId,
  } = useGlobalSelectedOrganization();
  const isGlobalAllOrganizations =
    globalSelectedOrganization?.id === GLOBAL_ALL_ORGANIZATIONS_ID;
  const isGlobalSpecificOrganizationSelected =
    !!globalSelectedOrganization && !isGlobalAllOrganizations;
  const [location, setLocation] = useLocation();
  const search = useSearch();
  const params = new URLSearchParams(search);
  const urlProjectId = params.get("projectId");
  const projectName = params.get("projectName");
  const urlOrganizationName = params.get("organizationName");
  const urlGoldenRepoName = params.get("goldenRepoName");
  const urlOrganizationId = params.get("orgId") || params.get("organizationId");
  const urlOrganizationUrl = params.get("organizationUrl");
  const urlOrganization = params.get("organization");
  const fromWorkflowParam = params.get("fromWorkflow");
  const fromWorkflow = fromWorkflowParam === "1";
  const openWorkflowParam = params.get("openWorkflow");
  const openPhaseParam = params.get("openPhase");
  const brdIdParam = params.get("brdId");
  const urlPhaseParam = params.get("phase"); // Active phase from URL (source of truth)
  const autoWorkflowOpened = useRef(false);
  const isRestoringFromUrl = useRef(false);
  const phaseRefs = useRef<Record<number, HTMLDivElement | null>>({});
  const hasScrolledToPhase = useRef(false);

  // Current signed-in user (for design blob createdBy)
  const sessionIdentity = useSessionIdentity();
  const { data: me } = useMe();
  const canCreateProject = me?.canCreateProject ?? false;

  // Active phase state - initialize from URL param, localStorage, or default to 1 (Backlogs)
  const [activePhaseId, setActivePhaseId] = useState<number>(() => {
    // Priority 1: URL param (source of truth)
    if (urlPhaseParam) {
      const phaseId = parseInt(urlPhaseParam, 10);
      if (!isNaN(phaseId) && phaseId >= 1 && phaseId <= 6) {
        return phaseId;
      }
    }
    // Priority 2: localStorage fallback
    if (typeof window !== "undefined") {
      const stored = localStorage.getItem("sdlc:activePhaseId");
      if (stored) {
        const phaseId = parseInt(stored, 10);
        if (!isNaN(phaseId) && phaseId >= 1 && phaseId <= 7) {
          return phaseId;
        }
      }
    }
    // Priority 3: Default to 1 (Backlogs)
    return 1;
  });

  // Note: This component should only render when route is /sdlc
  // No need for defensive redirects - the router handles route matching

  // Restore active phase from URL or localStorage on mount
  useEffect(() => {
    // Priority 1: URL param (source of truth)
    if (urlPhaseParam) {
      const phaseId = parseInt(urlPhaseParam, 10);
      if (!isNaN(phaseId) && phaseId >= 1 && phaseId <= 7) {
        setActivePhaseId(phaseId);
        setSelectedPhaseNumber(phaseId);
        // Store in localStorage as backup
        if (typeof window !== "undefined") {
          localStorage.setItem("sdlc:activePhaseId", phaseId.toString());
        }
        return;
      }
    }

    // Priority 2: localStorage fallback (only if URL doesn't have phase param)
    if (!urlPhaseParam && typeof window !== "undefined") {
      const stored = localStorage.getItem("sdlc:activePhaseId");
      if (stored) {
        const phaseId = parseInt(stored, 10);
        if (!isNaN(phaseId) && phaseId >= 1 && phaseId <= 7) {
          setActivePhaseId(phaseId);
          setSelectedPhaseNumber(phaseId);
          // Update URL to include phase param
          const currentParams = new URLSearchParams(search);
          currentParams.set("phase", phaseId.toString());
          const newSearch = currentParams.toString();
          setLocation(`/sdlc?${newSearch}`, { replace: true });
          return;
        }
      }
    }

    // Priority 3: Default to 1 (Backlogs) - only if no URL param and no localStorage
    // Don't force update URL if we're already on the page without a phase param
    // This allows users to manually navigate without forcing a phase
  }, [urlPhaseParam, search, setLocation]);

  // Listen for sidebar SDLC clicks to reset view (close overlays)
  useEffect(() => {
    const handleResetView = () => {
      setAiDesignDialogOpen(false);
      setAiGuidelineDialogOpen(false);
      setDialogOpen(false);
      setCicdDialogOpen(false);
      setPhaseFeatureDialogOpen(false);
      // Optional: reset design state too
      setDesignStep(1);
    };

    window.addEventListener("reset-sdlc-view", handleResetView);
    return () => window.removeEventListener("reset-sdlc-view", handleResetView);
  }, []);

  // Scroll to active phase on mount (after a short delay to ensure DOM is ready)
  useEffect(() => {
    if (hasScrolledToPhase.current) return;

    const scrollToPhase = () => {
      const phaseElement = phaseRefs.current[activePhaseId];
      if (phaseElement) {
        phaseElement.scrollIntoView({ behavior: "smooth", block: "center" });
        hasScrolledToPhase.current = true;
      }
    };

    // Small delay to ensure DOM is fully rendered
    const timeoutId = setTimeout(scrollToPhase, 300);
    return () => clearTimeout(timeoutId);
  }, [activePhaseId]);

  // Update URL and localStorage when active phase changes (user interaction)
  const updateActivePhase = (phaseId: number) => {
    if (phaseId < 1 || phaseId > 7) return;

    setActivePhaseId(phaseId);
    setSelectedPhaseNumber(phaseId);

    // Update URL with phase param
    const currentParams = new URLSearchParams(search);
    currentParams.set("phase", phaseId.toString());
    const newSearch = currentParams.toString();
    setLocation(`/sdlc?${newSearch}`, { replace: true });

    // Store in localStorage as backup
    if (typeof window !== "undefined") {
      localStorage.setItem("sdlc:activePhaseId", phaseId.toString());
    }
  };

  // Note: This component only renders when route matches /sdlc
  // The router handles route matching, so no defensive redirects needed
  // URL is the source of truth - we read from it, not redirect to it
  const [createProjectDialogOpen, setCreateProjectDialogOpen] = useState(false);
  const [generatingDocsPhaseId, setGeneratingDocsPhaseId] = useState<
    number | null
  >(null);

  // Work item dialog state
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedWorkItemType, setSelectedWorkItemType] =
    useState<WorkItemType | null>(null);
  const [selectedPhaseId, setSelectedPhaseId] = useState<number | null>(null);
  const [selectedPhaseName, setSelectedPhaseName] = useState<string>("");

  // Build & Pipeline action dialog state
  const [runBuildDialogOpen, setRunBuildDialogOpen] = useState(false);

  // CI/CD action dialog state
  const [cicdDialogOpen, setCicdDialogOpen] = useState(false);
  const [selectedActionType, setSelectedActionType] = useState<
    | "run-cicd"
    | "view-test-report"
    | "publish-package"
    | "trigger-release"
    | "manage-feature-flags"
    | "open-monitoring"
    | "push-code"
    | "create-mr"
    | "review-code"
    | "create-target"
    | "assign-reviewers"
    | "link-jira"
    | "review-design"
    | "upload-diagram"
    | "export-figma"
    | "goto-reports"
    | null
  >(null);
  const [actionPhaseName, setActionPhaseName] = useState<string>("");
  // Deployment selection state (handled inside CI/CD dialog)

  // Phase feature dialog state
  const [phaseFeatureDialogOpen, setPhaseFeatureDialogOpen] = useState(false);
  const [selectedFeatureType, setSelectedFeatureType] = useState<string | null>(
    null,
  );
  const [selectedPhaseNumber, setSelectedPhaseNumber] = useState<number>(
    () => activePhaseId,
  );

  // Confirmation checkpoint dialog state
  const [
    confirmationCheckpointDialogOpen,
    setConfirmationCheckpointDialogOpen,
  ] = useState(false);
  const [selectedPhaseForConfirmation, setSelectedPhaseForConfirmation] =
    useState<SDLCPhase | null>(null);
  const [confirmationDialogOpen, setConfirmationDialogOpen] = useState(false);
  const [selectedConfirmation, setSelectedConfirmation] = useState<any>(null);
  const [featurePhaseName, setFeaturePhaseName] = useState<string>("");

  // AI Design Generation modal state
  const [aiDesignDialogOpen, setAiDesignDialogOpen] = useState(false);
  const [aiGuidelineDialogOpen, setAiGuidelineDialogOpen] = useState(false);
  const [selectedDesignType, setSelectedDesignType] = useState<string>("");
  const [requirementDocument, setRequirementDocument] = useState<string>("");
  const [isGeneratingDesign, setIsGeneratingDesign] = useState(false);
  const [isSyncingToJira, setIsSyncingToJira] = useState(false);
  const [isUpdatingDescription, setIsUpdatingDescription] = useState(false);
  const [adoDocuments, setAdoDocuments] = useState<any[]>([]);
  const [selectedAdoDocId, setSelectedAdoDocId] = useState<string>("");
  const [isFetchingAdoDocs, setIsFetchingAdoDocs] = useState(false);

  // Wizard step
  const [designStep, setDesignStep] = useState<1 | 2>(1);

  // Guidelines upload (for design generation)
  const [uploadedGuidelines, setUploadedGuidelines] = useState<string>("");
  const [uploadedGuidelineFiles, setUploadedGuidelineFiles] = useState<File[]>(
    [],
  );

  // Epic and User Stories for design generation (supports single or multiple epics)
  const [designEpicsList, setDesignEpicsList] = useState<any[]>([]);
  const [selectedDesignEpicIds, setSelectedDesignEpicIds] = useState<string[]>(
    [],
  );
  const [isFetchingDesignEpics, setIsFetchingDesignEpics] = useState(false);
  const [designUserStories, setDesignUserStories] = useState<
    Array<{ epicId?: string;[k: string]: any }>
  >([]);
  const [isFetchingDesignStories, setIsFetchingDesignStories] = useState(false);
  const [selectedDesignStoryIds, setSelectedDesignStoryIds] = useState<
    string[]
  >([]);
  const [epicDetailsMap, setEpicDetailsMap] = useState<
    Record<
      string,
      { figmaLink: string; attachments: Array<{ id: string; name: string }> }
    >
  >({});
  const [epicSelectionListExpanded, setEpicSelectionListExpanded] =
    useState(true);
  const [designEpicSearchQuery, setDesignEpicSearchQuery] = useState("");
  const [designStorySearchQuery, setDesignStorySearchQuery] = useState("");
  const [designStoryStatusFilter, setDesignStoryStatusFilter] = useState<
    "all" | "generated" | "not-generated"
  >("all");
  const epicSearchDebounceRef = useRef<ReturnType<typeof setTimeout>>();
  const skipNextEpicSearchRef = useRef(true);
  // Tracks the size of the initial (unfiltered) epic load. Server-side search
  // only kicks in when this hit the fetch cap, implying more items may exist
  // beyond what was returned; smaller projects rely on client-side filtering.
  const designEpicInitialCountRef = useRef(0);
  // Story-first design flow: select user stories without picking an Epic first.
  const [designSelectionMode, setDesignSelectionMode] = useState<
    "epic" | "story"
  >("epic");
  const storySearchDebounceRef = useRef<ReturnType<typeof setTimeout>>();
  const skipNextStorySearchRef = useRef(true);
  // In-memory cache of the initial (unsearched) epic list per project, so
  // reopening the Design Prompt Generator renders instantly while a silent
  // background refresh keeps it current.
  const designEpicsCacheRef = useRef<Map<string, any[]>>(new Map());
  const [epicDesignSectionExpanded, setEpicDesignSectionExpanded] =
    useState(true);
  const [isFetchingEpicComments, setIsFetchingEpicComments] = useState(false);
  const [generatedDesignContent, setGeneratedDesignContent] =
    useState<string>("");
  const [generatedFigmaPrompt, setGeneratedFigmaPrompt] = useState<string>("");
  const [generatedFigmaLink, setGeneratedFigmaLink] = useState<string>("");
  const [figmaPromptFullscreen, setFigmaPromptFullscreen] = useState(false);
  const [adoWorkItemId, setAdoWorkItemId] = useState<string>("");
  const [isFigmaMode, setIsFigmaMode] = useState(false);

  // Guidelines validation for Generate Design button
  const [hasValidGuidelines, setHasValidGuidelines] = useState<boolean>(false);
  const [isCheckingGuidelines, setIsCheckingGuidelines] =
    useState<boolean>(false);
  const [figmaLinkInput, setFigmaLinkInput] = useState("");
  const [showFigmaInput, setShowFigmaInput] = useState(false);
  const [isPushingFigmaLink, setIsPushingFigmaLink] = useState(false);
  const [isSavingDesign, setIsSavingDesign] = useState(false);
  const [epicTreeData, setEpicTreeData] = useState<
    Array<{
      epicId: string;
      epicTitle: string;
      figmaLink: string | null;
      userStories: Array<{
        id: string;
        title: string;
        figmaPrompt: string;
      }>;
    }>
  >([]);
  const [savedDesignMappings, setSavedDesignMappings] = useState<any[]>([]);
  const [isLoadingMappings, setIsLoadingMappings] = useState(false);

  // Golden Repo Selector state (for design generation)
  const [repoSelectorOpen, setRepoSelectorOpen] = useState(false);
  const [linkedGoldenRepoId, setLinkedGoldenRepoId] = useState<string>("");
  const [linkedGoldenRepoName, setLinkedGoldenRepoName] = useState<string>("");
  const [linkedGoldenRepoFilePaths, setLinkedGoldenRepoFilePaths] = useState<
    string[]
  >([]);

  // Golden Repo Guideline Selector state
  const [guidelineSelectorOpen, setGuidelineSelectorOpen] = useState(false);
  const [
    selectedGoldenRepoIdForGuidelines,
    setSelectedGoldenRepoIdForGuidelines,
  ] = useState<string>("");
  const [
    selectedGoldenRepoNameForGuidelines,
    setSelectedGoldenRepoNameForGuidelines,
  ] = useState<string>("");

  // Deployment modal state
  const [deploymentModalOpen, setDeploymentModalOpen] = useState(false);
  const [pipelineModalOpen, setPipelineModalOpen] = useState(false);
  const [pipelinesModalOpen, setPipelinesModalOpen] = useState(false);
  const [testReportsModalOpen, setTestReportsModalOpen] = useState(false);
  const [packagesModalOpen, setPackagesModalOpen] = useState(false);
  const [jobsModalOpen, setJobsModalOpen] = useState(false);
  const [buildStatusMetricsModalOpen, setBuildStatusMetricsModalOpen] =
    useState(false);
  const [createPipelineModalOpen, setCreatePipelineModalOpen] = useState(false);
  const [testingModalOpen, setTestingModalOpen] = useState(false);
  const [testCasesModalOpen, setTestCasesModalOpen] = useState(false);
  const [deploymentStatusModalOpen, setDeploymentStatusModalOpen] =
    useState(false);
  const [releasesModalOpen, setReleasesModalOpen] = useState(false);
  const [triggerReleaseModalOpen, setTriggerReleaseModalOpen] = useState(false);

  // Development ADO modal state
  const [developmentModalOpen, setDevelopmentModalOpen] = useState(false);
  const [specsModalOpen, setSpecsModalOpen] = useState(false);
  const [storyProgressModalOpen, setStoryProgressModalOpen] = useState(false);
  const [developerAssignmentsModalOpen, setDeveloperAssignmentsModalOpen] =
    useState(false);
  const [velocityIndicatorsModalOpen, setVelocityIndicatorsModalOpen] =
    useState(false);
  const [newStatusModalOpen, setNewStatusModalOpen] = useState(false);
  const [activeStatusModalOpen, setActiveStatusModalOpen] = useState(false);
  const [resolvedStatusModalOpen, setResolvedStatusModalOpen] = useState(false);
  const [closedStatusModalOpen, setClosedStatusModalOpen] = useState(false);
  const [reopenedStatusModalOpen, setReopenedStatusModalOpen] = useState(false);

  // Maintenance modal state
  const [pipelineHealthModalOpen, setPipelineHealthModalOpen] = useState(false);
  const [monitorModalOpen, setMonitorModalOpen] = useState(false);
  const [errorTrackingModalOpen, setErrorTrackingModalOpen] = useState(false);
  const [alertsModalOpen, setAlertsModalOpen] = useState(false);
  const [deploymentTrendsModalOpen, setDeploymentTrendsModalOpen] =
    useState(false);
  const [deploymentTrackingModalOpen, setDeploymentTrackingModalOpen] =
    useState(false);
  const [redirectLoading, setRedirectLoading] = useState(false);
  const redirectHandledRef = useRef(false);

  // Phase visibility tracking for lazy loading phase-specific data
  // Phase 1 is visible by default since it's the first phase users see
  const [phaseVisibility, setPhaseVisibility] = useState<
    Record<number, boolean>
  >({
    1: true, // Backlogs - visible by default
    2: false, // Design
    3: false, // Development
    4: false, // Build
    5: false, // Deployment
    6: false, // Maintenance
  });

  // Track which phases have been interacted with (hover/click)
  const [phaseInteractions, setPhaseInteractions] = useState<Set<number>>(
    new Set([1]),
  ); // Phase 1 interacted by default

  // Track which phases have completed loading (for sequential loading)
  const [phaseLoadingComplete, setPhaseLoadingComplete] = useState<
    Record<number, boolean>
  >({
    1: false, // Phase 1 starts loading immediately
    2: false,
    3: false,
    4: false,
    5: false,
    6: false,
  });

  const openWorkItemDialog = (
    type: WorkItemType,
    phaseId: number,
    phaseName: string,
  ) => {
    // Update active phase when user interacts with a phase
    updateActivePhase(phaseId);
    setSelectedWorkItemType(type);
    setSelectedPhaseId(phaseId);
    setSelectedPhaseName(phaseName);
    setDialogOpen(true);
  };

  const openCICDActionDialog = (actionLabel: string, phaseName: string) => {
    const actionType = getActionType(actionLabel);
    if (actionType) {
      setSelectedActionType(actionType);
      setActionPhaseName(phaseName);
      setCicdDialogOpen(true);
    }
  };

  const openPhaseFeatureDialog = (
    featureLabel: string,
    phaseName: string,
    phaseNumber: number,
  ) => {
    // Update active phase when user interacts with a phase feature
    updateActivePhase(phaseNumber);

    const hasOrganization = !!selectedOrganization || isGlobalAllOrganizations;
    const hasProject = !!(selectedAdoProject || projectId || urlProjectId);

    if (!hasOrganization && !hasProject) {
      toast({
        title: "Selection Required",
        description:
          "Please select an Organization and Project to access this feature.",
        variant: "default",
      });
      return;
    }

    if (hasOrganization && !hasProject) {
      toast({
        title: "Selection Required",
        description: "Please select a Project to access this feature.",
        variant: "default",
      });
      return;
    }

    // Handle development phase features specially
    const normalizedLabel = featureLabel.toLowerCase().replace(/\s+/g, "");
    if (phaseNumber === 3 || phaseName.toLowerCase().includes("development")) {
      // Open specific modals for development phase features
      if (
        normalizedLabel.includes("repository") ||
        normalizedLabel.includes("branch") ||
        normalizedLabel.includes("commit")
      ) {
        setDevelopmentModalOpen(true);
        return;
      }
      if (
        normalizedLabel.includes("workitems") ||
        normalizedLabel.includes("userstories")
      ) {
        setUserStoriesModalOpen(true);
        return;
      }
      if (normalizedLabel.includes("storyprogress")) {
        setStoryProgressModalOpen(true);
        return;
      }
      if (normalizedLabel === "specs") {
        setDevelopmentModalOpen(true);
        return;
      }
      if (normalizedLabel === "new") {
        setNewStatusModalOpen(true);
        return;
      }
      if (normalizedLabel === "active") {
        setActiveStatusModalOpen(true);
        return;
      }
      if (normalizedLabel === "resolved") {
        setResolvedStatusModalOpen(true);
        return;
      }
      if (normalizedLabel === "closed") {
        setClosedStatusModalOpen(true);
        return;
      }
      if (normalizedLabel === "reopened") {
        setReopenedStatusModalOpen(true);
        return;
      }
    }

    // Handle Build phase features (phase 5)
    if (phaseNumber === 5 || phaseName.toLowerCase().includes("build")) {
      // Pipelines feature
      if (normalizedLabel.includes("pipeline")) {
        setPipelinesModalOpen(true);
        return;
      }
      // View test report feature
      if (
        normalizedLabel.includes("test") ||
        normalizedLabel.includes("report")
      ) {
        setTestReportsModalOpen(true);
        return;
      }
      // Publish package feature
      if (
        normalizedLabel.includes("package") ||
        normalizedLabel.includes("publish")
      ) {
        setPackagesModalOpen(true);
        return;
      }
      // Jobs feature
      if (normalizedLabel === "jobs") {
        setJobsModalOpen(true);
        return;
      }
      // Build Status Metrics feature
      if (
        normalizedLabel === "buildstatusmetrics" ||
        (normalizedLabel.includes("build") &&
          normalizedLabel.includes("status") &&
          normalizedLabel.includes("metrics")) ||
        normalizedLabel.includes("buildstatus")
      ) {
        setBuildStatusMetricsModalOpen(true);
        return;
      }
    }

    // Handle testing phase features specially
    if (phaseNumber === 4 || phaseName.toLowerCase().includes("testing")) {
      // Test Plans feature - allows viewing and generating test plans
      if (
        normalizedLabel.includes("test") &&
        normalizedLabel.includes("plan")
      ) {
        setTestPlanModalOpen(true);
        return;
      }
      // Test Cases, BDD Files, E2E Scenarios - placeholder for future implementation
      if (
        normalizedLabel.includes("testcases") ||
        normalizedLabel.includes("bdd") ||
        normalizedLabel.includes("feature") ||
        normalizedLabel.includes("stepdef") ||
        normalizedLabel.includes("endtoend") ||
        normalizedLabel.includes("scenarios")
      ) {
        toast({
          title: "Coming Soon",
          description: "This feature will be available soon.",
        });
        return;
      }
    }

    // Handle deployment phase features specially
    if (phaseNumber === 6 || phaseName.toLowerCase().includes("deployment")) {
      // Open specific modals for deployment phase features

      // Check for Pipeline (but not Deployment Status which also has status in the name)
      if (normalizedLabel === "pipeline") {
        setPipelineModalOpen(true);
        return;
      }

      // Check for Deployment Status
      if (normalizedLabel === "deploymentstatus") {
        setDeploymentStatusModalOpen(true);
        return;
      }

      // Check for Releases (but not Trigger release)
      if (normalizedLabel === "releases") {
        setReleasesModalOpen(true);
        return;
      }

      // Check for Trigger release - open TriggerReleaseModal
      if (normalizedLabel === "triggerrelease") {
        setTriggerReleaseModalOpen(true);
        return;
      }

      // Check for Manage rollout
      if (normalizedLabel === "managerollout") {
        setDeploymentModalOpen(true);
        return;
      }

      // Check for Deployment Tracking
      if (
        normalizedLabel === "deploymenttracking" ||
        normalizedLabel === "deployment tracking"
      ) {
        setDeploymentTrackingModalOpen(true);
        return;
      }
    }

    // Handle maintenance phase features specially
    if (phaseNumber === 7 || phaseName.toLowerCase().includes("maintenance")) {
      if (
        normalizedLabel.includes("pipeline") &&
        normalizedLabel.includes("health")
      ) {
        setPipelineHealthModalOpen(true);
        return;
      }

      if (normalizedLabel === "monitor") {
        setMonitorModalOpen(true);
        return;
      }

      if (normalizedLabel === "errortracking") {
        setErrorTrackingModalOpen(true);
        return;
      }

      if (
        normalizedLabel === "alerts" ||
        normalizedLabel === "alerts&notifications" ||
        normalizedLabel.includes("alerts")
      ) {
        setAlertsModalOpen(true);
        return;
      }

      if (
        normalizedLabel === "deploymenttrends" ||
        normalizedLabel === "deployment trends"
      ) {
        setDeploymentTrendsModalOpen(true);
        return;
      }
    }

    const featureType = getFeatureType(featureLabel);
    if (featureType) {
      setSelectedFeatureType(featureType);
      setFeaturePhaseName(phaseName);
      setSelectedPhaseNumber(phaseNumber);
      setPhaseFeatureDialogOpen(true);
    } else {
      console.warn("[SDLC] No feature type found for:", featureLabel);
    }
  };

  const openConfirmationCheckpoint = (phase: SDLCPhase) => {
    // Update active phase when user interacts with a phase
    updateActivePhase(phase.phaseNumber);
    setSelectedPhaseForConfirmation(phase);
    setConfirmationCheckpointDialogOpen(true);
  };

  // Generate Design click handler with validation
  const handleGenerateDesignClick = async () => {
    const hasOrganization = !!selectedOrganization || isGlobalAllOrganizations;
    const hasProject = !!(selectedAdoProject || projectId || urlProjectId);

    if (!hasOrganization && !hasProject) {
      toast({
        title: "Selection Required",
        description:
          "Please select an Organization and Project before generating designs.",
        variant: "default",
      });
      return;
    }

    if (hasOrganization && !hasProject) {
      toast({
        title: "Selection Required",
        description: "Please select a Project before generating designs.",
        variant: "default",
      });
      return;
    }

    // Open the design dialog after basic selection validation
    setAiDesignDialogOpen(true);
  };

  // Generate Guideline click handler with validation
  const handleGenerateGuidelineClick = () => {
    const hasOrganization = !!selectedOrganization || isGlobalAllOrganizations;
    const hasProject = !!(selectedAdoProject || projectId || urlProjectId);

    if (!hasOrganization && !hasProject) {
      toast({
        title: "Selection Required",
        description:
          "Please select an Organization and Project before generating guidelines.",
        variant: "default",
      });
      return;
    }

    if (hasOrganization && !hasProject) {
      toast({
        title: "Selection Required",
        description: "Please select a Project before generating guidelines.",
        variant: "default",
      });
      return;
    }

    setAiGuidelineDialogOpen(true);
  };

  // Check if guidelines with Figma links exist for this project
  const checkGuidelinesValidation = async () => {
    if (!projectId) {
      setHasValidGuidelines(false);
      return;
    }

    setIsCheckingGuidelines(true);
    try {
      const response = await fetch(
        getApiUrl(`/api/sdlc/projects/${projectId}/design-guidelines`),
        {
          method: "GET",
          credentials: "include",
          headers: {
            "Cache-Control": "no-cache",
            Pragma: "no-cache",
          },
        },
      );

      if (response.ok) {
        const guidelines = await response.json();
        // Check if there are any guidelines with figmaLink populated
        const hasValidFigmaLink = guidelines.some(
          (guideline: any) =>
            guideline.figmaLink && guideline.figmaLink.trim().length > 0,
        );
        setHasValidGuidelines(hasValidFigmaLink);
      } else {
        setHasValidGuidelines(false);
      }
    } catch (error) {
      console.error("Error checking guidelines:", error);
      setHasValidGuidelines(false);
    } finally {
      setIsCheckingGuidelines(false);
    }
  };

  // Workflow button click handler with validation
  const handleWorkflowClick = (e: React.MouseEvent) => {
    const hasOrganization = !!selectedOrganization || isGlobalAllOrganizations;
    const hasProject = !!(selectedAdoProject || projectId || urlProjectId);

    if (!hasOrganization && !hasProject) {
      e.preventDefault();
      toast({
        title: "Selection Required",
        description:
          "Please select an Organization and Project before accessing Workflow.",
        variant: "default",
      });
      return;
    }

    if (hasOrganization && !hasProject) {
      e.preventDefault();
      toast({
        title: "Selection Required",
        description: "Please select a Project before accessing Workflow.",
        variant: "default",
      });
      return;
    }
  };

  const handleSubmitConfirmation = (confirmation: any) => {
    setSelectedConfirmation(confirmation);
    setConfirmationDialogOpen(true);
  };

  const handleGeneratePhaseDocumentation = async (
    phaseId: number,
    phaseName: string,
  ) => {
    if (!projectId || !projectName) {
      toast({
        title: "Error",
        description: "Project information is missing",
        variant: "destructive",
      });
      return;
    }

    setGeneratingDocsPhaseId(phaseId);

    try {
      toast({
        title: "Generating Documentation",
        description: `Creating comprehensive documentation for ${phaseName}...`,
      });

      const response = await apiRequest(
        "POST",
        `/api/sdlc/projects/${projectId}/phases/${phaseId}/generate-documentation`,
        {
          projectName,
          phaseName,
        },
      );

      const result = await response.json();

      toast({
        title: "Documentation Generated!",
        description: `${phaseName} documentation has been created successfully.`,
      });

      // Refresh the data to show the new document
      queryClient.invalidateQueries({
        queryKey: [
          `/api/sdlc/projects/${projectId}/phases/${phaseId}/documents`,
        ],
      });

      // Optionally open the documentation dialog to show the new document
      openPhaseFeatureDialog("Documentation", phaseName, phaseId);
    } catch (error) {
      console.error("Error generating phase documentation:", error);
      toast({
        title: "Generation Failed",
        description:
          error instanceof Error
            ? error.message
            : "Failed to generate phase documentation",
        variant: "destructive",
      });
    } finally {
      setGeneratingDocsPhaseId(null);
    }
  };

  const handleFetchAdoDocuments = async () => {
    if (!projectId) {
      toast({
        title: "Missing Information",
        description: "Project ID is missing",
        variant: "destructive",
      });
      return;
    }

    setIsFetchingAdoDocs(true);
    try {
      const response = await fetch(
        getApiUrl(`/api/sdlc/projects/${projectId}/ado-requirements`),
        {
          credentials: "include",
        },
      );

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to fetch documents from ADO");
      }

      const data = await response.json();
      setAdoDocuments(data.documents || []);

      toast({
        title: "Documents Fetched",
        description: `Found ${data.documents?.length || 0
          } requirement documents from ${integrationName}`,
      });
    } catch (error) {
      console.error("Error fetching ADO documents:", error);
      toast({
        title: "Fetch Failed",
        description:
          error instanceof Error
            ? error.message
            : `Failed to fetch documents from ${integrationName}`,
        variant: "destructive",
      });
    } finally {
      setIsFetchingAdoDocs(false);
    }
  };

  const handleSelectAdoDocument = (docId: string) => {
    setSelectedAdoDocId(docId);
    const selectedDoc = adoDocuments.find((doc) => doc.id.toString() === docId);
    if (selectedDoc) {
      // Format the document content nicely with all available fields
      let formattedContent = `# ${selectedDoc.type} - ${selectedDoc.title}

## Work Item ID
${selectedDoc.id}

## Description
${selectedDoc.description || "No description provided"}

## State
${selectedDoc.state}
`;

      // Add Acceptance Criteria if available
      if (selectedDoc.acceptanceCriteria) {
        formattedContent += `
## Acceptance Criteria
${selectedDoc.acceptanceCriteria}
`;
      }

      // Add Assigned To if available
      if (selectedDoc.assignedTo) {
        formattedContent += `
## Assigned To
${selectedDoc.assignedTo}
`;
      }

      // Add Tags if available
      if (selectedDoc.tags) {
        formattedContent += `
## Tags
${selectedDoc.tags}
`;
      }

      // Add Area Path if available
      if (selectedDoc.areaPath) {
        formattedContent += `
## Area Path
${selectedDoc.areaPath}
`;
      }

      setRequirementDocument(formattedContent);

      toast({
        title: "Document Loaded",
        description: `${selectedDoc.type}: ${selectedDoc.title}`,
      });
    }
  };

  const handleFetchDesignEpics = async (
    searchOverride?: string,
    silent = false,
  ) => {
    const searchTerm = (searchOverride ?? "").trim();
    setIsFetchingDesignEpics(true);
    try {
      // Find selected project with all ADO details
      const selectedProject =
        selectedAdoProject ||
        allProjects?.find(
          (p) => p.name === projectName || p.id === urlProjectId,
        );

      if (!selectedProject) {
        throw new Error("Project not found");
      }

      if (!selectedProject.organizationUrl || !selectedProject.name) {
        throw new Error("Project missing organization URL or name");
      }

      // Send ADO project details (or minimal details for Jira)
      const params = new URLSearchParams();
      if (dbProjectId) params.append("projectId", dbProjectId); // Local SDLC project ID
      if (selectedProject.id && !isJira) params.append("adoProjectId", selectedProject.id); // Real ADO GUID
      if (!isJira) {
        params.append("organization", selectedProject.organizationUrl);
        params.append("projectName", selectedProject.name);
      }
      if (searchTerm) params.append("search", searchTerm);

      console.log("[Design Epics] Fetching with params:", {
        projectId: dbProjectId,
        isJira,
        adoProjectId: selectedProject.id,
        organization: selectedProject.organizationUrl,
        projectName: selectedProject.name,
        search: searchTerm || undefined,
      });

      const endpoint = isJira
        ? `/api/sdlc/projects/${dbProjectId}/jira/epics${searchTerm ? `?search=${encodeURIComponent(searchTerm)}` : ""}`
        : `/api/ado/get_epics?${params.toString()}`;

      const response = await fetch(
        getApiUrl(endpoint),
        {
          method: "GET",
          credentials: "include",
          headers: {
            "Cache-Control": "no-cache",
            Pragma: "no-cache",
          },
        },
      );
      if (!response.ok) {
        let errorData: any = null;
        try {
          const errorText = await response.text();
          console.error("[Fetch Epics] Error response:", errorText);
          errorData = JSON.parse(errorText);
        } catch (parseError) {
          console.error("[Fetch Epics] Failed to parse error response");
        }

        if (errorData?.requiresDesignGuidelines) {
          throw new Error("DESIGN_GUIDELINES_REQUIRED");
        }

        throw new Error(
          errorData?.message || errorData?.error || "Failed to fetch epics",
        );
      }

      const contentType = response.headers.get("content-type");
      if (!contentType || !contentType.includes("application/json")) {
        const textResponse = await response.text();
        console.error("[Fetch Epics] Non-JSON response:", textResponse);
        throw new Error("Server returned invalid response format");
      }

      const epics = await response.json();
      setDesignEpicsList(epics);
      if (!searchTerm) {
        designEpicInitialCountRef.current = Array.isArray(epics)
          ? epics.length
          : 0;
        if (Array.isArray(epics)) {
          designEpicsCacheRef.current.set(
            `${dbProjectId}|${isJira ? "jira" : "ado"}`,
            epics,
          );
        }
      }
      const itemLabel = isJira ? "work items" : "epics";
      if (silent) {
        // Search-driven refetch: skip toasts to avoid spamming on each keystroke.
      } else if (epics.length === 0) {
        toast({
          title: `No ${isJira ? "Work Items" : "Epics"} Found`,
          description: `No ${itemLabel} found in ${integrationName}`,
          variant: "destructive",
        });
      } else {
        toast({
          title: `${isJira ? "Work Items" : "Epics"} Loaded`,
          description: `Found ${epics.length} ${itemLabel}`,
        });
      }
    } catch (error) {
      console.error("Error fetching epics:", error);

      const errorMessage =
        error instanceof Error ? error.message : String(error);

      if (errorMessage === "DESIGN_GUIDELINES_REQUIRED") {
        toast({
          title: "Design Guidelines Required",
          description:
            "You must first generate design guidelines with a Figma link before fetching epics. Please complete the Design Guidelines step first.",
          variant: "destructive",
        });
      } else if (!silent) {
        toast({
          title: "Failed to Fetch Epics",
          description: `Please check your ${isJira ? "Jira" : "ADO"} configuration.`,
          variant: "destructive",
        });
      }
    } finally {
      setIsFetchingDesignEpics(false);
    }
  };

  useEffect(() => {
    if (aiDesignDialogOpen) {
      skipNextEpicSearchRef.current = true;
      // Instant render from cache (if present), then refresh silently;
      // otherwise do a normal fetch with the loading state + toast.
      const cachedEpics = designEpicsCacheRef.current.get(
        `${dbProjectId}|${isJira ? "jira" : "ado"}`,
      );
      if (cachedEpics && cachedEpics.length > 0) {
        setDesignEpicsList(cachedEpics);
        designEpicInitialCountRef.current = cachedEpics.length;
        handleFetchDesignEpics(undefined, true);
      } else {
        handleFetchDesignEpics();
      }
      setDesignStep(1);
      setDesignSelectionMode("epic");
      setDesignEpicSearchQuery("");
      setDesignStorySearchQuery("");
      setDesignStoryStatusFilter("all");
      setUploadedGuidelines("");
      setUploadedGuidelineFiles([]);
      if (guidelinesFileInputRef.current) {
        guidelinesFileInputRef.current.value = "";
      }

      // Note: Removed automatic golden repo loading - user must manually select guidelines
    }
  }, [aiDesignDialogOpen]);

  // Server-side epic/work-item search: debounce the query and refetch so large
  // backlogs (beyond the 100 ADO / 500 Jira initial cap) remain searchable.
  // Client-side filtering still runs on top for instant feedback.
  useEffect(() => {
    if (!aiDesignDialogOpen) return;
    if (skipNextEpicSearchRef.current) {
      skipNextEpicSearchRef.current = false;
      return;
    }
    // Only hit the server when the initial load was capped (large backlog).
    const fetchCap = isJira ? 500 : 100;
    if (designEpicInitialCountRef.current < fetchCap) return;
    if (epicSearchDebounceRef.current) {
      clearTimeout(epicSearchDebounceRef.current);
    }
    epicSearchDebounceRef.current = setTimeout(() => {
      handleFetchDesignEpics(designEpicSearchQuery, true);
    }, 450);
    return () => {
      if (epicSearchDebounceRef.current) {
        clearTimeout(epicSearchDebounceRef.current);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [designEpicSearchQuery, aiDesignDialogOpen]);

  // Story-first search: debounce the query and refetch project-wide stories.
  useEffect(() => {
    if (!aiDesignDialogOpen) return;
    if (designSelectionMode !== "story") return;
    if (skipNextStorySearchRef.current) {
      skipNextStorySearchRef.current = false;
      return;
    }
    if (storySearchDebounceRef.current) {
      clearTimeout(storySearchDebounceRef.current);
    }
    storySearchDebounceRef.current = setTimeout(() => {
      handleFetchAllDesignStories(designStorySearchQuery, true);
    }, 450);
    return () => {
      if (storySearchDebounceRef.current) {
        clearTimeout(storySearchDebounceRef.current);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [designStorySearchQuery, designSelectionMode, aiDesignDialogOpen]);

  // Clear Generate Design state when project changes to ensure project-specific Figma links
  useEffect(() => {
    setGeneratedDesignContent("");
    setGeneratedFigmaPrompt("");
    setGeneratedFigmaLink("");
    setDesignStep(1);
    setUploadedGuidelines("");
    setUploadedGuidelineFiles([]);
    // Clear individual epic mappings when project changes to use common project link
    setSavedDesignMappings([]);
  }, [urlProjectId]);

  // Handle regenerate design event from UI/UX Design modal
  useEffect(() => {
    const handleRegenerateDesign = (event: CustomEvent) => {
      const { epicId, epicTitle, userStories } = event.detail;

      // Set the selected epic and user stories (single epic for regenerate)
      setSelectedDesignEpicIds(epicId ? [epicId] : []);
      setDesignUserStories(
        (userStories || []).map((s: any) => ({ ...s, epicId })),
      );

      // Set the selected story IDs to match the user stories from the mapping
      if (userStories && userStories.length > 0) {
        const storyIds = userStories.map((story: any) => story.id.toString());
        setSelectedDesignStoryIds(storyIds);
        console.log(
          "[Regenerate Design] Pre-selecting user stories:",
          storyIds,
        );
      } else {
        setSelectedDesignStoryIds([]);
      }

      // Open the Generate Design modal and close the UI/UX design modal
      setPhaseFeatureDialogOpen(false);
      setAiDesignDialogOpen(true);

      console.log("[Regenerate Design] Opening Generate Design modal with:", {
        epicId,
        epicTitle,
        userStoriesCount: userStories?.length || 0,
        selectedStoryIds: userStories?.map((s: any) => s.id) || [],
      });
    };

    // Listen for the regenerate design event
    window.addEventListener(
      "regenerateDesign",
      handleRegenerateDesign as EventListener,
    );

    // Cleanup
    return () => {
      window.removeEventListener(
        "regenerateDesign",
        handleRegenerateDesign as EventListener,
      );
    };
  }, []);

  const handleGuidelinesUpload = async (
    e: React.ChangeEvent<HTMLInputElement>,
  ) => {
    if (!e.target.files) return;

    const files = Array.from(e.target.files);
    setUploadedGuidelineFiles(files);

    let newContent = "";

    for (const file of files) {
      const text = await file.text();
      newContent += `\n\n### ${file.name}\n${text}`;
    }

    // Combine with existing guidelines (from golden repo selections)
    setUploadedGuidelines((prev) => prev + newContent);
  };

  const handleFetchGoldenRepoGuidelines = async () => {
    // Get golden repo info from project data when user clicks
    const project = sdlcProjectData?.project || projectData?.project;
    const goldenRepoRef = project?.goldenRepoReference;

    if (!goldenRepoRef?.repoId) {
      toast({
        title: "No Golden Repo Linked",
        description: "No golden repository is linked to this project.",
        variant: "destructive",
      });
      return;
    }

    // Set repo info only when user opens the selector
    setSelectedGoldenRepoIdForGuidelines(goldenRepoRef.repoId);
    setSelectedGoldenRepoNameForGuidelines(goldenRepoRef.repoName || "");
    setGuidelineSelectorOpen(true);
  };

  const handleSelectRepo = (repoId: string, repoName: string) => {
    setLinkedGoldenRepoId(repoId);
    setLinkedGoldenRepoName(repoName);
    setRepoSelectorOpen(false);
  };

  const handleSelectGuidelineFiles = (
    files: { name: string; path: string; content: string }[],
  ) => {
    if (files.length === 0) return;

    // Store the golden repo file paths
    const filePaths = files.map((f) => f.path);
    setLinkedGoldenRepoFilePaths(filePaths);

    // Create combined content from golden repo files + existing device guidelines
    let combinedContent = uploadedGuidelines;

    for (const file of files) {
      combinedContent += `\n\n### ${file.name}\n${file.content}`;
    }

    setUploadedGuidelines(combinedContent);

    toast({
      title: "Guidelines Loaded",
      description: `Added ${files.length} guideline file(s) from golden repo`,
    });
  };

  const guidelinesFileInputRef = useRef<HTMLInputElement>(null);
  const figmaPromptTextareaRef = useRef<HTMLTextAreaElement>(null);

  const handleRemoveGuidelineFile = async (indexToRemove: number) => {
    const updatedFiles = uploadedGuidelineFiles.filter(
      (_, i) => i !== indexToRemove,
    );
    setUploadedGuidelineFiles(updatedFiles);

    let combinedContent = "";
    for (const file of updatedFiles) {
      const text = await file.text();
      combinedContent += `\n\n### ${file.name}\n${text}`;
    }
    setUploadedGuidelines(combinedContent);

    // Reset file input
    if (guidelinesFileInputRef.current) {
      guidelinesFileInputRef.current.value = "";
    }
  };

  const handleFetchDesignUserStories = async (epicId: string) => {
    if (!epicId) return;

    setIsFetchingDesignStories(true);
    try {
      const selectedProject =
        selectedAdoProject ||
        allProjects?.find(
          (p) => p.name === projectName || p.id === urlProjectId,
        );

      if (!selectedProject?.organizationUrl || !selectedProject.name) {
        throw new Error("Project not found or missing organization URL/name");
      }

      const params = new URLSearchParams();
      if (dbProjectId) params.append("projectId", dbProjectId);
      if (selectedProject.id && !isJira) params.append("adoProjectId", selectedProject.id);
      if (!isJira) {
        params.append("organization", selectedProject.organizationUrl);
        params.append("projectName", selectedProject.name);
      }

      const endpoint = isJira
        ? `/api/sdlc/projects/${dbProjectId}/jira/epics/${epicId}/user-stories`
        : `/api/ado/epics/${epicId}/user-stories?${params.toString()}`;

      const response = await fetch(
        getApiUrl(endpoint),
        {
          method: "GET",
          credentials: "include",
          headers: { "Cache-Control": "no-cache", Pragma: "no-cache" },
        },
      );
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(errorText || "Failed to fetch user stories");
      }

      const contentType = response.headers.get("content-type");
      if (!contentType || !contentType.includes("application/json")) {
        throw new Error("Server returned invalid response format");
      }

      const stories = await response.json();
      const storiesWithEpicId = (stories || []).map((s: any) => ({
        ...s,
        epicId,
      }));

      setDesignUserStories((prev) => {
        const withoutThisEpic = prev.filter((s) => s.epicId !== epicId);
        return [...withoutThisEpic, ...storiesWithEpicId];
      });

      const idsFromOtherEpics = designUserStories
        .filter((s) => s.epicId !== epicId)
        .map((s) => (s.id ?? "").toString());
      setSelectedDesignStoryIds((prev) => {
        const kept = prev.filter((id) => idsFromOtherEpics.includes(id));
        const newIds = storiesWithEpicId.map((s: any) => s.id.toString());
        return [...kept, ...newIds];
      });

      if (storiesWithEpicId.length > 0) {
        updateRequirementDocumentFromStories(
          designUserStories
            .filter((s) => s.epicId !== epicId)
            .concat(storiesWithEpicId),
          [
            ...selectedDesignStoryIds.filter((id) => {
              const story = designUserStories.find(
                (u) => u.id.toString() === id,
              );
              return story?.epicId !== epicId;
            }),
            ...storiesWithEpicId.map((s: any) => s.id.toString()),
          ],
        );
        toast({
          title: isJira ? "Sub-items Loaded" : "User Stories Loaded",
          description: `Found ${storiesWithEpicId.length} ${isJira ? "sub-item(s)" : "user story(ies)"} for this ${isJira ? "work item" : "epic"}`,
        });
      } else {
        toast({
          title: isJira ? "No Sub-items Found" : "No User Stories Found",
          description: `No ${isJira ? "sub-items" : "user stories"} found for this ${isJira ? "work item" : "epic"}`,
          variant: "destructive",
        });
      }
    } catch (error) {
      console.error("Error fetching user stories:", error);
      toast({
        title: isJira ? "Failed to Fetch Sub-items" : "Failed to Fetch User Stories",
        description:
          error instanceof Error ? error.message : "An error occurred",
        variant: "destructive",
      });
    } finally {
      setIsFetchingDesignStories(false);
    }
  };

  // Story-first flow: fetch user stories across the whole project (no epic),
  // with optional server-side search. Used when designSelectionMode === "story".
  const handleFetchAllDesignStories = async (
    searchOverride?: string,
    silent = false,
  ) => {
    const searchTerm = (searchOverride ?? "").trim();
    setIsFetchingDesignStories(true);
    try {
      const selectedProject =
        selectedAdoProject ||
        allProjects?.find(
          (p) => p.name === projectName || p.id === urlProjectId,
        );

      if (!selectedProject?.organizationUrl || !selectedProject.name) {
        throw new Error("Project not found or missing organization URL/name");
      }

      const params = new URLSearchParams();
      if (dbProjectId) params.append("projectId", dbProjectId);
      if (selectedProject.id && !isJira)
        params.append("adoProjectId", selectedProject.id);
      if (!isJira) {
        params.append("organization", selectedProject.organizationUrl);
        params.append("projectName", selectedProject.name);
      }
      if (searchTerm) params.append("search", searchTerm);

      const endpoint = isJira
        ? `/api/sdlc/projects/${dbProjectId}/jira/user-stories${searchTerm ? `?search=${encodeURIComponent(searchTerm)}` : ""}`
        : `/api/ado/user-stories?${params.toString()}`;

      const response = await fetch(getApiUrl(endpoint), {
        method: "GET",
        credentials: "include",
        headers: { "Cache-Control": "no-cache", Pragma: "no-cache" },
      });
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(errorText || "Failed to fetch user stories");
      }

      const stories = await response.json();
      const list = (stories || []).map((s: any) => ({ ...s }));
      setDesignUserStories(list);

      // Preserve selections that still exist in the refreshed list.
      const keptIds = selectedDesignStoryIds.filter((id) =>
        list.some((s: any) => (s.id ?? "").toString() === id),
      );
      setSelectedDesignStoryIds(keptIds);
      updateRequirementDocumentFromStories(list, keptIds);

      if (!silent) {
        if (list.length > 0) {
          toast({
            title: isJira ? "Sub-items Loaded" : "User Stories Loaded",
            description: `Found ${list.length} ${isJira ? "sub-item(s)" : "user story(ies)"}`,
          });
        } else {
          toast({
            title: isJira ? "No Sub-items Found" : "No User Stories Found",
            description: `No ${isJira ? "sub-items" : "user stories"} found in ${integrationName}`,
            variant: "destructive",
          });
        }
      }
    } catch (error) {
      console.error("Error fetching all user stories:", error);
      if (!silent) {
        toast({
          title: isJira ? "Failed to Fetch Sub-items" : "Failed to Fetch User Stories",
          description:
            error instanceof Error ? error.message : "An error occurred",
          variant: "destructive",
        });
      }
    } finally {
      setIsFetchingDesignStories(false);
    }
  };

  const handleDesignSelectionModeChange = (mode: "epic" | "story") => {
    if (mode === designSelectionMode) return;
    setDesignSelectionMode(mode);
    // Reset shared selection state so the two modes don't bleed into each other.
    setDesignUserStories([]);
    setSelectedDesignStoryIds([]);
    setSelectedDesignEpicIds([]);
    setEpicDetailsMap({});
    setRequirementDocument("");
    setDesignStorySearchQuery("");
    if (mode === "story") {
      skipNextStorySearchRef.current = true;
      handleFetchAllDesignStories();
    }
  };

  function updateRequirementDocumentFromStories(
    stories: Array<{
      id?: number;
      title?: string;
      description?: string;
      acceptanceCriteria?: string;
      epicId?: string;
    }>,
    selectedIds: string[],
  ) {
    const selectedStories = stories.filter((story) =>
      selectedIds.includes((story.id ?? "").toString()),
    );
    if (selectedStories.length > 0) {
      const formattedStories = selectedStories
        .map((story: any) => {
          const cleanDescription = story.description
            ? story.description.replace(/<[^>]*>/g, "")
            : "No description";
          const cleanAcceptanceCriteria = story.acceptanceCriteria
            ? story.acceptanceCriteria.replace(/<[^>]*>/g, "")
            : "";
          let storyText = `# ${story.title}\n\n${cleanDescription}`;
          if (cleanAcceptanceCriteria)
            storyText += `\n\n## Acceptance Criteria\n${cleanAcceptanceCriteria}`;
          return `${storyText}\n\n---\n`;
        })
        .join("\n");
      setRequirementDocument(formattedStories);
    } else {
      setRequirementDocument("");
    }
  }

  const handleFetchEpicComments = async (epicId: string) => {
    if (!epicId) return;
    const selectedProject =
      selectedAdoProject ||
      allProjects?.find((p) => p.name === projectName || p.id === urlProjectId);
    if (!selectedProject?.organizationUrl || !selectedProject?.name) return;

    setIsFetchingEpicComments(true);
    try {
      const params = new URLSearchParams();
      if (dbProjectId) params.append("projectId", dbProjectId);
      if (selectedProject.id) params.append("adoProjectId", selectedProject.id);
      params.append("organization", selectedProject.organizationUrl);
      params.append("projectName", selectedProject.name);

      const response = await fetch(
        getApiUrl(`/api/ado/epics/${epicId}/comments?${params.toString()}`),
        {
          method: "GET",
          credentials: "include",
          headers: { "Cache-Control": "no-cache", Pragma: "no-cache" },
        },
      );
      if (!response.ok) return;
      const data = await response.json();
      setEpicDetailsMap((prev) => ({
        ...prev,
        [epicId]: {
          figmaLink: data.figmaLink || "",
          attachments: Array.isArray(data.attachments) ? data.attachments : [],
        },
      }));
    } catch (err) {
      console.error("[Design] Failed to fetch epic comments:", err);
    } finally {
      setIsFetchingEpicComments(false);
    }
  };

  const handleToggleDesignEpic = (epicId: string) => {
    const isSelected = selectedDesignEpicIds.includes(epicId);
    if (isSelected) {
      const nextStories = designUserStories.filter((s) => s.epicId !== epicId);
      const nextIds = selectedDesignStoryIds.filter((id) =>
        nextStories.some((s) => (s.id ?? "").toString() === id),
      );
      setSelectedDesignEpicIds((prev) => prev.filter((id) => id !== epicId));
      setDesignUserStories(nextStories);
      setSelectedDesignStoryIds(nextIds);
      setEpicDetailsMap((prev) => {
        const next = { ...prev };
        delete next[epicId];
        return next;
      });
      updateRequirementDocumentFromStories(nextStories, nextIds);
    } else {
      setSelectedDesignEpicIds((prev) => [...prev, epicId]);
      handleFetchDesignUserStories(epicId);
      handleFetchEpicComments(epicId);
    }
  };

  const handleToggleDesignStory = (storyId: string) => {
    setSelectedDesignStoryIds((prev) => {
      const newSelection = prev.includes(storyId)
        ? prev.filter((id) => id !== storyId)
        : [...prev, storyId];

      updateRequirementDocumentFromSelection(newSelection);
      return newSelection;
    });
  };

  const handleSelectAllDesignStories = () => {
    if (selectedDesignStoryIds.length === designUserStories.length) {
      // Deselect all
      setSelectedDesignStoryIds([]);
      setRequirementDocument("");
    } else {
      // Select all
      const allIds = designUserStories.map((s) => s.id.toString());
      setSelectedDesignStoryIds(allIds);
      updateRequirementDocumentFromSelection(allIds);
    }
  };

  const updateRequirementDocumentFromSelection = (selectedIds: string[]) => {
    const selectedStories = designUserStories.filter((story) =>
      selectedIds.includes((story.id ?? "").toString()),
    );

    if (selectedStories.length > 0) {
      const formattedStories = selectedStories
        .map((story: any) => {
          // Strip HTML tags from description
          const cleanDescription = story.description
            ? story.description.replace(/<[^>]*>/g, "")
            : "No description";

          // Strip HTML tags from acceptance criteria
          const cleanAcceptanceCriteria = story.acceptanceCriteria
            ? story.acceptanceCriteria.replace(/<[^>]*>/g, "")
            : "";

          let storyText = `# ${story.title}\n\n${cleanDescription}`;

          if (cleanAcceptanceCriteria) {
            storyText += `\n\n## Acceptance Criteria\n${cleanAcceptanceCriteria}`;
          }

          return `${storyText}\n\n---\n`;
        })
        .join("\n");
      setRequirementDocument(formattedStories);
    } else {
      setRequirementDocument("");
    }
  };

  const handleDeleteDesignMapping = async (mappingId: string) => {
    if (!confirm("Are you sure you want to delete this design mapping?")) {
      return;
    }

    try {
      await apiRequest("DELETE", `/api/design-mapping/${mappingId}`);

      // Refresh saved mappings after deletion
      if (dbProjectId) {
        const response = await apiRequest(
          "GET",
          `/api/design-mapping/${dbProjectId}`,
        );
        const data = await response.json();
        setSavedDesignMappings(data);

        // Invalidate queries to refresh the count
        queryClient.invalidateQueries({
          queryKey: [`/api/design-mapping/count`, dbProjectId],
        });
      }

      toast({
        title: "Deleted",
        description: "Design mapping deleted successfully",
      });
    } catch (error) {
      console.error("Error deleting design mapping:", error);
      toast({
        title: "Delete Failed",
        description:
          error instanceof Error
            ? error.message
            : "Failed to delete design mapping",
        variant: "destructive",
      });
    }
  };

  const handlePushFigmaToADO = async () => {
    if (!figmaLinkInput.trim()) {
      toast({
        title: "Missing Figma Link",
        description: "Please paste a Figma link",
        variant: "destructive",
      });
      return;
    }

    if (!adoWorkItemId) {
      toast({
        title: "Missing Work Item ID",
        description: `No ${integrationName} work item ID available`,
        variant: "destructive",
      });
      return;
    }

    setIsPushingFigmaLink(true);

    try {
      const response = await fetch(getApiUrl("/api/ado/push_figma_to_epic"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          epicId: adoWorkItemId,
          figmaLink: figmaLinkInput.trim(),
          projectName: selectedAdoProject?.name || projectData?.project?.name,
          organization: selectedAdoProject?.organizationUrl,
          artifactOrgId: selectedAdoProject?.artifactOrgId,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || "Failed to push Figma link to ADO");
      }

      const result = await response.json();

      toast({
        title: "Success!",
        description: `Figma link successfully synced to ${integrationName}`,
      });

      // Reset Figma input state
      setShowFigmaInput(false);
      setFigmaLinkInput("");

      // Persist the figma link and ensure the prompt (including any uploaded guidelines)
      // is saved in the design mapping so the UI/UX feature can display it.
      try {
        const saveProjectId = apiProjectId || dbProjectId;
        const firstEpicId = selectedDesignEpicIds[0];
        const selectedEpic = designEpicsList.find((e) => e.id === firstEpicId);
        const selectedStories = designUserStories.filter((s) =>
          selectedDesignStoryIds.includes((s.id ?? "").toString()),
        );

        // Prefer the generated prompt (which includes uploaded guidelines). Fallback to existing epic/story prompt.
        const promptToSave =
          (generatedFigmaPrompt && generatedFigmaPrompt.trim()) ||
          (epicTreeData && epicTreeData[0]?.userStories?.[0]?.figmaPrompt) ||
          "";

        if (
          saveProjectId &&
          selectedEpic &&
          selectedStories.length > 0 &&
          promptToSave
        ) {
          await apiRequest("POST", "/api/design-mapping/save", {
            projectId: saveProjectId,
            epicId: selectedEpic.id,
            epicTitle: selectedEpic.title,
            userStories: selectedStories.map((story) => ({
              id: story.id.toString(),
              title: story.title,
            })),
            prompt: promptToSave,
            figmaLink: figmaLinkInput.trim(),
          });

          // Refresh saved mappings in the UI
          const mappingsResponse = await apiRequest(
            "GET",
            `/api/design-mapping/${saveProjectId}`,
          );
          const mappingsData = await mappingsResponse.json();
          setSavedDesignMappings(mappingsData);

          // Invalidate queries to refresh the count
          queryClient.invalidateQueries({
            queryKey: [`/api/design-mapping/count`, saveProjectId],
          });
        }
      } catch (err) {
        console.error(
          "Error saving design mapping after pushing figma link:",
          err,
        );
      }

      // Close the dialog after successful sync
      setTimeout(() => {
        setAiDesignDialogOpen(false);
        setDesignStep(1);
      }, 1500);
    } catch (error) {
      console.error("Error pushing Figma link:", error);
      toast({
        title: "Sync Failed",
        description:
          error instanceof Error
            ? error.message
            : "Failed to sync Figma link to ADO",
        variant: "destructive",
      });
    } finally {
      setIsPushingFigmaLink(false);
    }
  };

  // Save design mapping (epic, user stories, prompt) to database
  const handleSaveDesign = async () => {
    // Story-first mode has no epic; only a prompt + selected stories are required.
    if (!generatedFigmaPrompt || selectedDesignStoryIds.length === 0) {
      toast({
        title: "Missing Information",
        description:
          `Please ensure you have ${isJira ? "sub-items" : "user stories"} selected and a generated prompt`,
        variant: "destructive",
      });
      return;
    }

    setIsSavingDesign(true);
    try {
      const saveProjectId = apiProjectId || dbProjectId;
      const firstEpicId = selectedDesignEpicIds[0];
      const selectedEpic = designEpicsList.find((e) => e.id === firstEpicId);
      // Fall back to a synthetic epic identity when saving a story-first design.
      const epicIdForSave = selectedEpic?.id ?? "story-first";
      const epicTitleForSave =
        selectedEpic?.title ??
        `${isJira ? "Sub-items" : "User Stories"} (no ${isJira ? "work item" : "Epic"})`;
      const selectedStories = designUserStories.filter((s) =>
        selectedDesignStoryIds.includes((s.id ?? "").toString()),
      );

      const promptToSave =
        (generatedFigmaPrompt && generatedFigmaPrompt.trim()) || "";
      const designBlobCreatedBy =
        sessionIdentity?.userName || sessionIdentity?.userEmail || undefined;
      const organizationNameForBlob =
        urlOrganization || urlOrganizationName || selectedOrganization || null;
      const projectNameForBlob =
        projectName || selectedAdoProject?.name || null;
      const epicIdsForBlob = selectedDesignEpicIds.join(", ");

      if (
        saveProjectId &&
        selectedStories.length > 0 &&
        promptToSave
      ) {
        await apiRequest("POST", "/api/design-mapping/save", {
          projectId: saveProjectId,
          brd_id: selectedBrd?.id || null,
          epicId: epicIdForSave,
          epicTitle: epicTitleForSave,
          userStories: selectedStories.map((story) => ({
            id: (story.id ?? "").toString(),
            title: story.title,
          })),
          prompt: promptToSave,
          figmaLink: "",
          epic_ids: epicIdsForBlob,
          designBlobCreatedBy,
          organizationNameForBlob,
          projectNameForBlob,
        });

        // Refresh saved mappings in the UI
        const mappingsResponse = await apiRequest(
          "GET",
          `/api/design-mapping/${saveProjectId}`,
        );
        const mappingsData = await mappingsResponse.json();
        setSavedDesignMappings(mappingsData);

        toast({
          title: "Design Saved",
          description:
            "Design mapping has been successfully saved to the database",
        });
      }
    } catch (error) {
      console.error("Error saving design:", error);
      toast({
        title: "Save Failed",
        description:
          error instanceof Error
            ? error.message
            : "Failed to save design mapping",
        variant: "destructive",
      });
    } finally {
      setIsSavingDesign(false);
    }
  };

  const handleGenerateDesignWithAI = async () => {
    // Debug logging to verify state values
    console.log("=== GENERATE DESIGN DEBUG ===");
    console.log("dbProjectId:", dbProjectId);
    console.log(
      "requirementDocument:",
      requirementDocument,
      "length:",
      requirementDocument?.length,
    );

    // Trim whitespace and validate
    const trimmedRequirementDoc = requirementDocument?.trim();

    console.log(
      "trimmedRequirementDoc:",
      trimmedRequirementDoc,
      "length:",
      trimmedRequirementDoc?.length,
    );
    console.log("=== VALIDATION CHECKS ===");
    console.log("dbProjectId check:", !dbProjectId);
    console.log("requirementDoc check:", !trimmedRequirementDoc);

    if (!dbProjectId) {
      toast({
        title: "Missing Information",
        description: "Project ID is missing. Please refresh the page.",
        variant: "destructive",
      });
      return;
    }

    if (!trimmedRequirementDoc) {
      toast({
        title: "Missing Information",
        description: "Please provide requirements document",
        variant: "destructive",
      });
      return;
    }

    setIsGeneratingDesign(true);

    // Use default design type
    const designType = "System Design";

    try {
      toast({
        title: "Generating Design",
        description: `Creating ${designType} using AI... Fetching ${integrationName} backlog context...`,
      });

      console.log("[Generate Design] Request payload:", {
        designType,
        requirementDocLength: trimmedRequirementDoc?.length,
        guidelinesContentLength: uploadedGuidelines?.length || 0,
        guidelinesContent: uploadedGuidelines || "(empty)",
      });

      const response = await apiRequest(
        "POST",
        `/api/sdlc/projects/${dbProjectId}/generate-design`,
        {
          designType: designType,
          requirementDocument: trimmedRequirementDoc,
          guidelinesContent: uploadedGuidelines || "",
          selectedEpicIds: selectedDesignEpicIds,
        },
      );

      let result = await response.json();

      // Async-job pattern: backend returns 202 + jobId for design generation
      // (multiple LLM calls) to dodge AWS API Gateway's 29s timeout. Poll the
      // universal status endpoint until the background job completes.
      if (response.status === 202 && result?.jobId) {
        // Single toast instance whose description is updated in place on every
        // progress tick — prevents the stream of stacked toasts you'd otherwise
        // see at the 2-second poll interval.
        const progressToast = toast({
          title: "Generating Design",
          description: "Starting design generation...",
        });
        let lastMessage = "";
        try {
          result = await pollAsyncJob<typeof result>(
            "sdlc-generate-design",
            result.jobId,
            {
              onProgress: (message) => {
                if (message && message !== lastMessage) {
                  lastMessage = message;
                  progressToast.update({
                    id: progressToast.id,
                    title: "Generating Design",
                    description: message,
                  });
                }
              },
            },
          );
        } finally {
          progressToast.dismiss();
        }

        // Surface silent backend failures: if the job reports completed but
        // produced no actual content (e.g. Bedrock returned empty string and
        // something earlier in the pipeline swallowed the error), throw so
        // the user sees a clear error toast instead of a misleading
        // "Design Generated!" success message followed by a blank UI.
        if (!result?.content && !result?.designContent) {
          throw new Error(
            "Design generation completed without producing content. Check server logs (CloudWatch) for the [GenerateDesign:*] entries.",
          );
        }
      }

      console.log("[Generate Design] Response received:", {
        hasFigmaPrompt: !!result.figmaPrompt,
        figmaPromptLength: result.figmaPrompt?.length || 0,
        figmaPromptPreview: result.figmaPrompt?.substring(0, 200) || "(empty)",
        figmaLink: result.figmaLink,
        hasFigmaLink: !!result.figmaLink,
      });

      // Store the generated design content and figma info as PROJECT-LEVEL link
      // This will be the common Figma link shown in UI/UX Design feature
      setGeneratedDesignContent(result.content || result.designContent || "");
      setGeneratedFigmaPrompt(result.figmaPrompt || "");
      setGeneratedFigmaLink(result.figmaLink || "");

      console.log("[Generate Design] Project-level Figma link stored:", {
        generatedFigmaLinkValue: result.figmaLink || "",
        willShowCommonLink: !!result.figmaLink,
      });
      // Use the selected epic from dropdown as primary source
      setAdoWorkItemId(
        selectedDesignEpicIds[0] || result.adoWorkItemId || result.epicId || "",
      );
      setIsFigmaMode(true); // Switch to Figma mode
      setShowFigmaInput(false); // Reset input visibility
      setFigmaLinkInput(""); // Clear any previous input

      // Save epic and ALL selected user stories
      const selectedEpic = designEpicsList.find(
        (e) => e.id === selectedDesignEpicIds[0],
      );
      const selectedStories = designUserStories.filter((s) =>
        selectedDesignStoryIds.includes((s.id ?? "").toString()),
      );

      console.log("[Design Mapping] Save conditions:", {
        dbProjectId,
        selectedEpic: selectedEpic?.id,
        selectedStoriesCount: selectedStories.length,
        hasFigmaPrompt: !!result.figmaPrompt,
      });

      // Skip individual epic mapping - use common project Figma link instead
      // Individual epic mappings are removed per user request
      // UI/UX Design will show only the common project Figma link

      console.log(
        "[Design Mapping] Using project-level Figma link instead of individual epic mappings",
      );

      toast({
        title: "Design Generated!",
        description: "Your design is ready with project-level Figma link.",
        duration: 5000,
      });
    } catch (error: any) {
      console.error("Error generating design:", error);

      const isPermissionError = error?.code === "PERMISSION_DENIED";

      let errorMessage: string;
      if (isPermissionError) {
        errorMessage =
          "Your role does not have permission for this activity. Please contact your administrator.";
      } else {
        // Prefer structured backend data if available
        const rawData: any = error?.response?.data ?? error;
        const backendReason =
          rawData && typeof rawData === "object"
            ? rawData.details || rawData.message || rawData.error
            : undefined;

        errorMessage =
          (backendReason !== undefined
            ? typeof backendReason === "string"
              ? backendReason
              : JSON.stringify(backendReason)
            : undefined) ||
          (error instanceof Error ? error.message : undefined) ||
          "Failed to generate design. Please try again.";
      }

      toast({
        title: isPermissionError ? "Permission denied" : "Generation Failed",
        description: errorMessage,
        variant: "destructive",
      });
    } finally {
      setIsGeneratingDesign(false);
    }
  };

  // Map feature labels to feature types
  const getFeatureType = (label: string): string | null => {
    const normalizedLabel = label.toLowerCase().replace(/\s+/g, "");

    // Development Phase - Developer Assignments
    if (
      normalizedLabel.includes("developer") &&
      normalizedLabel.includes("assignment")
    ) {
      return "developer-assignments";
    }

    // Development Phase - Velocity Indicators
    if (
      normalizedLabel.includes("velocity") &&
      normalizedLabel.includes("indicator")
    ) {
      return "velocity-indicators";
    }

    // Build & Testing
    if (
      normalizedLabel.includes("pipeline") &&
      !normalizedLabel.includes("editor")
    )
      return "pipelines";
    if (normalizedLabel.includes("jobs")) return "jobs";
    // View test report: "viewtestreport" or contains both "test" and "report"
    if (
      normalizedLabel === "viewtestreport" ||
      (normalizedLabel.includes("test") && normalizedLabel.includes("report"))
    )
      return "test-reports";
    // Publish package: "publishpackage" or contains both "publish" and "package"
    if (
      normalizedLabel === "publishpackage" ||
      (normalizedLabel.includes("publish") &&
        normalizedLabel.includes("package"))
    )
      return "packages";
    // Build Status Metrics
    if (
      normalizedLabel === "buildstatusmetrics" ||
      (normalizedLabel.includes("build") &&
        normalizedLabel.includes("status") &&
        normalizedLabel.includes("metrics"))
    )
      return "build-status-metrics";

    if (normalizedLabel === "jobs") return "jobs";
    // Generic package (but not package registry)
    if (
      normalizedLabel.includes("package") &&
      !normalizedLabel.includes("registry") &&
      !normalizedLabel.includes("publish")
    )
      return "packages";
    if (normalizedLabel.includes("pipelineeditor")) return "pipeline-editor";
    if (normalizedLabel.includes("artifact")) return "artifacts";
    if (normalizedLabel.includes("security")) return "security-config";

    // Deployment
    if (normalizedLabel === "pipeline") return "pipeline";
    if (normalizedLabel === "deploymentstatus") return "deployment-status";
    if (
      normalizedLabel.includes("releases") &&
      !normalizedLabel.includes("trigger")
    )
      return "releases";
    if (normalizedLabel === "triggerrelease") return "trigger-release";
    if (normalizedLabel === "managerollout") return "manage-rollout";
    if (normalizedLabel.includes("packageregistry")) return "package-registry";
    if (normalizedLabel.includes("modelregistry")) return "model-registry";

    // Development
    if (normalizedLabel === "code") return "code";
    if (
      normalizedLabel.includes("repository") &&
      !normalizedLabel.includes("graph")
    )
      return "repository";
    if (normalizedLabel.includes("branch")) return "branches";
    if (normalizedLabel.includes("commit")) return "commits";
    if (normalizedLabel.includes("storyprogress")) return "story-progress";
    if (
      normalizedLabel.includes("workitems") ||
      normalizedLabel.includes("userstories")
    )
      return "user-stories";
    if (normalizedLabel === "new") return "new-status";
    if (normalizedLabel === "active") return "active-status";
    if (normalizedLabel === "resolved") return "resolved-status";
    if (normalizedLabel === "closed") return "closed-status";
    if (normalizedLabel.includes("mergerequest")) return "merge-requests";
    if (normalizedLabel.includes("tags")) return "tags";
    if (normalizedLabel.includes("preview")) return "preview";
    if (normalizedLabel.includes("reviewcode")) return "review-code";

    // Design
    if (
      normalizedLabel.includes("generateguideline") ||
      normalizedLabel.includes("generate guideline")
    )
      return "generate-guideline";
    if (normalizedLabel.includes("systemarchitecture"))
      return "system-architecture";
    if (normalizedLabel.includes("databasedesign")) return "database-design";
    if (
      normalizedLabel.includes("ui/uxdesign") ||
      normalizedLabel.includes("uiuxdesign")
    )
      return "ui-ux-design";
    if (normalizedLabel.includes("componentdesign")) return "component-design";
    if (normalizedLabel.includes("snippet")) return "snippets";
    if (normalizedLabel.includes("repositorygraph")) return "repository-graph";
    if (normalizedLabel.includes("designasset")) return "design-assets";
    if (normalizedLabel.includes("figma")) return "figma-link";
    if (normalizedLabel.includes("reviewdesign")) return "review-design";

    // Maintenance
    if (
      normalizedLabel.includes("pipeline") &&
      normalizedLabel.includes("health")
    )
      return "pipeline-health";
    if (normalizedLabel.includes("environment")) return "environments";
    if (normalizedLabel.includes("kubernetes")) return "kubernetes-clusters";
    if (normalizedLabel.includes("terraform")) return "terraform-states";
    if (normalizedLabel.includes("monitor")) return "monitor";
    if (normalizedLabel.includes("errortracking")) return "error-tracking";
    if (normalizedLabel.includes("alert")) return "alerts";
    if (
      normalizedLabel.includes("deploymenttrends") ||
      normalizedLabel.includes("deployment trends")
    )
      return "deployment-trends";
    if (
      normalizedLabel.includes("deploymenttracking") ||
      normalizedLabel.includes("deployment tracking")
    )
      return "deployment-tracking";
    if (normalizedLabel.includes("valuestream"))
      return "value-stream-analytics";

    // Requirements & Analysis
    if (normalizedLabel.includes("epic")) return "epics";
    if (
      normalizedLabel.includes("workitems") ||
      normalizedLabel.includes("userstories")
    )
      return "user-stories";
    if (normalizedLabel.includes("requirement")) return "requirements";
    if (normalizedLabel.includes("backlog")) return "backlog";
    if (normalizedLabel.includes("document")) return "documentation";

    return null;
  };

  // Map feature labels to work item types (legacy)
  const getWorkItemType = (label: string): WorkItemType | null => {
    const normalizedLabel = label.toLowerCase().replace(/\s+/g, "");
    if (normalizedLabel.includes("issue")) return "issues";
    if (normalizedLabel.includes("epic")) return "epics";
    if (normalizedLabel.includes("requirement")) return "requirements";
    if (normalizedLabel.includes("backlog")) return "backlog";
    if (normalizedLabel.includes("doc")) return "documents";
    return null;
  };

  // Map action labels to action types
  const getActionType = (
    label: string,
  ):
    | "run-cicd"
    | "view-test-report"
    | "publish-package"
    | "trigger-release"
    | "manage-feature-flags"
    | "open-monitoring"
    | "push-code"
    | "create-mr"
    | "review-code"
    | "create-target"
    | "assign-reviewers"
    | "link-jira"
    | "review-design"
    | "upload-diagram"
    | "export-figma"
    | "goto-reports"
    | null => {
    const normalizedLabel = label.toLowerCase().replace(/\s+/g, "");

    // Primary button texts
    if (
      normalizedLabel.includes("deploytoprod") ||
      normalizedLabel.includes("rundeployment")
    )
      return "trigger-release";
    if (normalizedLabel.includes("openmonitoring")) return "open-monitoring";
    if (normalizedLabel.includes("runpipeline")) return "run-cicd";
    if (normalizedLabel.includes("pushtorepo")) return "push-code";
    if (normalizedLabel.includes("generatedocs")) return "create-target";
    if (normalizedLabel.includes("generatereports")) return "goto-reports";

    // Build & Testing actions
    if (normalizedLabel.includes("runci") || normalizedLabel.includes("runcd"))
      return "run-cicd";
    if (
      normalizedLabel.includes("viewtest") ||
      normalizedLabel.includes("testreport")
    )
      return "view-test-report";
    if (
      normalizedLabel.includes("publish") &&
      normalizedLabel.includes("package")
    )
      return "publish-package";

    // Deployment actions
    if (
      normalizedLabel.includes("trigger") ||
      normalizedLabel.includes("release")
    )
      return "trigger-release";
    if (
      normalizedLabel.includes("manage") ||
      normalizedLabel.includes("feature")
    )
      return "manage-feature-flags";
    if (
      normalizedLabel.includes("monitoring") ||
      normalizedLabel.includes("pi/click")
    )
      return "open-monitoring";

    // Development actions
    if (normalizedLabel.includes("pushcode")) return "push-code";
    if (normalizedLabel.includes("createmr")) return "create-mr";
    if (normalizedLabel.includes("reviewcode")) return "review-code";

    // Requirements actions
    if (normalizedLabel.includes("createtarget")) return "create-target";
    if (normalizedLabel.includes("assignreviewer")) return "assign-reviewers";
    if (
      normalizedLabel.includes("linkjira") ||
      normalizedLabel.includes("jiraticket")
    )
      return "link-jira";

    // Design actions
    if (normalizedLabel.includes("reviewdesign")) return "review-design";
    if (
      normalizedLabel.includes("upload") &&
      normalizedLabel.includes("diagram")
    )
      return "upload-diagram";
    if (
      normalizedLabel.includes("exportfigma") ||
      normalizedLabel.includes("exporttofigma")
    )
      return "export-figma";

    // Maintenance actions
    if (
      normalizedLabel.includes("gotoreports") ||
      normalizedLabel.includes("reports")
    )
      return "goto-reports";

    return null;
  };

  // Fetch all ADO projects for dropdown
  interface ADOProject {
    id: string;
    name: string;
    description: string;
	    organization: string;
	    organizationUrl: string;
	    artifactOrgId?: string;
	    jiraConnectionId?: string;
	    jiraInstanceUrl?: string;
	    integrationType?: string;
    sdlcProject?: SDLCProject | null;
    projectManagementPatConfigured?: boolean;
    repoPatConfigured?: boolean;
    userJiraPatConfigured?: boolean;
    userGitlabPatConfigured?: boolean;
    userPatConfigured?: boolean;
  }

  interface WorkflowArtifact {
    id: string;
    projectId?: string | null;
    epics?: any[];
    features?: any[];
    userStories?: any[];
    personas?: any[];
    requirement?: string | null;
    createdAt?: string;
    modified?: boolean;
    approvalStatus?: string | null;
    modifiedCount?: number | null;
    totalCount?: number | null;
    modifiedItems?: {
      epics?: string[];
      features?: string[];
      userStories?: string[];
    } | null;
  }

  interface WorkflowArtifactsApiResponse {
    artifacts: WorkflowArtifact[];
    success?: boolean;
  }

  interface SDLCProjectsPage {
    items: SDLCProject[];
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasMore: boolean;
  }

  // Track the selected ADO project and mapped SDLC project (declare before queries)
  const [selectedAdoProject, setSelectedAdoProject] =
    useState<ADOProject | null>(null);
  // Track when project is changing to show skeleton loading on buttons
  const [isProjectChanging, setIsProjectChanging] = useState(false);
  const prevProjectRef = useRef<string | null>(null);
  type RequirementArtifactTab =
    | "overview"
    | "epics"
    | "features"
    | "userstories";
  const [requirementArtifactsDialogOpen, setRequirementArtifactsDialogOpen] =
    useState(false);
  const [requirementArtifactsDefaultTab, setRequirementArtifactsDefaultTab] =
    useState<RequirementArtifactTab>("userstories");

  // Project dropdown state
  const [projectSearchQuery, setProjectSearchQuery] = useState("");
  const [projectDropdownOpen, setProjectDropdownOpen] = useState(false);
  const projectListLoadMoreRef = useRef<HTMLDivElement | null>(null);
  const [displayedProjectName, setDisplayedProjectName] = useState<
    string | null
  >(null);

  // BRD and Requirement dropdown state
  const [selectedBrd, setSelectedBrd] = useState<{
    id: string;
    title: string;
    status?: string;
  } | null>(null);
  const [brdDropdownOpen, setBrdDropdownOpen] = useState(false);
  const [brdSearchQuery, setBrdSearchQuery] = useState("");
  const [selectedRequirement, setSelectedRequirement] = useState<{
    id: string;
    title: string;
  } | null>(null);
  const [requirementDropdownOpen, setRequirementDropdownOpen] = useState(false);
  const [requirementSearchQuery, setRequirementSearchQuery] = useState("");

  // BRD List Dialog state
  const [brdListDialogOpen, setBrdListDialogOpen] = useState(false);
  const [brdListCategory, setBrdListCategory] = useState<
    "drafts" | "yetToReview" | "approved" | "partiallyGenerated" | "generated"
  >("drafts");

  // BRD Preview Dialog state
  const [brdPreviewDialogOpen, setBrdPreviewDialogOpen] = useState(false);
  const [selectedBrdForPreview, setSelectedBrdForPreview] = useState<
    string | null
  >(null);
	  const selectedOrganization = isGlobalSpecificOrganizationSelected
	    ? globalSelectedOrganization?.name || null
	    : null;
	  const effectiveSelectedOrganization = selectedOrganization;

	  const urlSelectedOrganization = useMemo(() => {
	    if (!globalOrganizations.length) return null;

	    if (urlOrganizationId) {
	      const byId = globalOrganizations.find((org) => org.id === urlOrganizationId);
	      if (byId) return byId;
	    }

	    const targetUrl = normalizeOrgUrl(urlOrganizationUrl);
	    if (targetUrl) {
	      const byUrl = globalOrganizations.find(
	        (org) => normalizeOrgUrl(org.description) === targetUrl,
	      );
	      if (byUrl) return byUrl;
	    }

	    const targetName = normalizeOrgText(urlOrganizationName || urlOrganization);
	    if (targetName) {
	      return (
	        globalOrganizations.find((org) => normalizeOrgText(org.name) === targetName) ||
	        null
	      );
	    }

	    return null;
	  }, [globalOrganizations, urlOrganizationId, urlOrganizationName, urlOrganizationUrl, urlOrganization]);

	  useEffect(() => {
	    if (!urlSelectedOrganization) return;
	    if (urlSelectedOrganization.id === globalSelectedOrganizationId) return;
	    setSelectedOrganizationId(urlSelectedOrganization.id);
	  }, [urlSelectedOrganization, globalSelectedOrganizationId, setSelectedOrganizationId]);

	  const jiraOnlyHosting = useJiraOnlyWorkItems();
  const adoAllowed = useAdoAllowed();

	  const shouldFetchAdoProjects =
	    projectDropdownOpen ||
	    !!effectiveSelectedOrganization ||
	    !!urlProjectId ||
	    !!urlOrganizationId ||
	    !!urlOrganizationName ||
	    !!urlOrganizationUrl ||
	    !!urlOrganization;

  const {
    data: adoProjectsResponse,
    isLoading: adoProjectsLoading,
    isFetching: adoProjectsFetching,
    refetch: refetchAdoProjects,
  } = useQuery<{ projects: ADOProject[]; warnings?: string[] }>({
    queryKey: ["/api/ado-projects"],
    enabled: !jiraOnlyHosting,
    staleTime: 10 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    refetchOnMount: true,
    refetchOnWindowFocus: false,
  });

  const {
    data: sdlcProjectsPages,
    isLoading: sdlcProjectsLoading,
    isFetching: sdlcProjectsFetching,
    isFetchingNextPage: sdlcProjectsFetchingNextPage,
    fetchNextPage: fetchNextSdlcProjectsPage,
    hasNextPage: hasNextSdlcProjectsPage,
    refetch: refetchSdlcProjects,
  } = useInfiniteQuery<SDLCProjectsPage>({
    queryKey: [
      "/api/sdlc/projects",
      "paginated",
      globalSelectedOrganizationId || "none",
      projectSearchQuery.trim(),
    ],
    enabled: jiraOnlyHosting || shouldFetchAdoProjects,
    initialPageParam: 1,
    queryFn: async ({ pageParam }) => {
      const params = new URLSearchParams({
        paginated: "true",
        selectable: "true",
        page: String(pageParam || 1),
        limit: String(SDLC_PROJECT_PAGE_SIZE),
      });
      const search = projectSearchQuery.trim();
      if (search) {
        params.set("search", search);
      }
      const res = await apiRequest("GET", `/api/sdlc/projects?${params.toString()}`);
      return res.json();
    },
    getNextPageParam: (lastPage) =>
      lastPage.hasMore ? lastPage.page + 1 : undefined,
    staleTime: 10 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    refetchOnMount: true,
    refetchOnWindowFocus: false,
  });

  const sdlcProjectsList = useMemo(
    () =>
      sdlcProjectsPages?.pages.flatMap((page) => {
        if (Array.isArray(page)) return page;
        if (Array.isArray(page?.items)) return page.items;
        return [];
      }) || [],
    [sdlcProjectsPages],
  );

  useEffect(() => {
    if (!projectDropdownOpen || !hasNextSdlcProjectsPage || sdlcProjectsFetchingNextPage) {
      return;
    }

    const sentinel = projectListLoadMoreRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          fetchNextSdlcProjectsPage();
        }
      },
      { rootMargin: "120px" },
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [
    projectDropdownOpen,
    hasNextSdlcProjectsPage,
    sdlcProjectsFetchingNextPage,
    fetchNextSdlcProjectsPage,
  ]);

  const allProjectsResponse = useMemo(() => {
    const projectsArray = Array.isArray(sdlcProjectsList)
      ? sdlcProjectsList.filter((project): project is SDLCProject => Boolean(project))
      : [];
    const normalizeUrl = (url: string) => url.replace(/\/+$/, "").toLowerCase();

    const resolveJiraOrgName = (p: typeof projectsArray[0]): string => {
      // Try matching by connection ID first
      if (p.jiraConnectionId) {
        const byId = globalOrganizations.find(o => o.id === p.jiraConnectionId);
        if (byId) return byId.name;
      }
      // Fallback: match by instance URL against the org's description (which holds instanceUrl)
      if (p.jiraInstanceUrl) {
        const projUrl = normalizeUrl(p.jiraInstanceUrl);
        const byUrl = globalOrganizations.find(
          o => o.sourceType === "jira" && o.description && normalizeUrl(o.description) === projUrl
        );
        if (byUrl) return byUrl.name;
      }
      return p.organization || "Jira";
    };

    const jiraProjects = projectsArray
      .filter((p) => p.integrationType === "jira")
      .map((p) => ({
        id: p.id,
        name: p.name,
        description: p.description || "",
	        organization: resolveJiraOrgName(p),
	        organizationUrl: p.jiraInstanceUrl || "",
	        artifactOrgId: p.jiraConnectionId || undefined,
	        jiraConnectionId: p.jiraConnectionId || undefined,
	        jiraInstanceUrl: p.jiraInstanceUrl || undefined,
	        sdlcProject: p,
        projectManagementPatConfigured:
          (p as any).projectManagementPatConfigured === true ||
          (p as any).userJiraPatConfigured === true,
        repoPatConfigured:
          (p as any).repoPatConfigured === true ||
          (p as any).userGitlabPatConfigured === true,
        userJiraPatConfigured: (p as any).userJiraPatConfigured === true,
        userGitlabPatConfigured: (p as any).userGitlabPatConfigured === true,
        userPatConfigured: (p as any).userPatConfigured === true,
      }));

    if (jiraOnlyHosting) {
      return { projects: jiraProjects, warnings: [] as string[] };
    }

    const adoProjects = adoProjectsResponse?.projects || [];
    return {
      projects: [...adoProjects, ...jiraProjects],
      warnings: adoProjectsResponse?.warnings || [],
    };
  }, [sdlcProjectsList, jiraOnlyHosting, adoProjectsResponse, globalOrganizations]);

  const allProjectsLoading = jiraOnlyHosting
    ? sdlcProjectsLoading
    : adoProjectsLoading || sdlcProjectsLoading;
  const allProjectsFetching = jiraOnlyHosting
    ? sdlcProjectsFetching
    : adoProjectsFetching || sdlcProjectsFetching;

	  const allProjects: ADOProject[] = useMemo(() => {
    if (!allProjectsResponse?.projects) return [];
    const normalized = new Map<string, ADOProject>();

    allProjectsResponse.projects.forEach((project) => {
      if (!project.sdlcProject || project.userPatConfigured !== true) {
        return;
      }

      const trimmedName = project.name?.trim() || "";
      const trimmedOrg = project.organization?.trim() || "";
      const key =
        project.id?.toString() ||
        `${trimmedName.toLowerCase()}|${trimmedOrg.toLowerCase()}`;

      if (!normalized.has(key)) {
        normalized.set(key, {
          ...project,
          name: trimmedName,
          organization: trimmedOrg,
        });
      }
    });

    return Array.from(normalized.values());
	  }, [allProjectsResponse?.projects]);

  // Preserve explicit URL-driven selections when present.
  // Do not auto-restore org/project from localStorage on first entry.
  useEffect(() => {
    if (typeof window === "undefined") return;

    // If URL params are driving selection, ensure they're preserved in URL
	    if (urlProjectId || projectName || urlOrganizationId || urlOrganizationName || urlOrganizationUrl || urlOrganization) {
	      // Ensure URL params are preserved in the URL on refresh
	      const currentParams = new URLSearchParams(window.location.search);
	      const needsUpdate =
	        (urlOrganizationId &&
	          currentParams.get("orgId") !== urlOrganizationId) ||
	        (urlOrganizationName &&
	          currentParams.get("organizationName") !== urlOrganizationName) ||
	        (urlOrganizationUrl &&
	          currentParams.get("organizationUrl") !== urlOrganizationUrl) ||
	        (urlOrganization &&
	          currentParams.get("organization") !== urlOrganization) ||
	        (urlProjectId && currentParams.get("projectId") !== urlProjectId) ||
	        (projectName && currentParams.get("projectName") !== projectName);

	      if (needsUpdate) {
	        const newParams = new URLSearchParams(currentParams);
	        if (urlOrganizationId) newParams.set("orgId", urlOrganizationId);
	        if (urlOrganizationName) newParams.set("organizationName", urlOrganizationName);
	        if (urlOrganizationUrl) newParams.set("organizationUrl", urlOrganizationUrl);
	        if (urlOrganization) newParams.set("organization", urlOrganization);
	        if (urlProjectId) newParams.set("projectId", urlProjectId);
	        if (projectName) newParams.set("projectName", projectName);
        // Always ensure we stay on /sdlc route
        setLocation(`/sdlc?${newParams.toString()}`, { replace: true });
      } else if (!window.location.pathname.startsWith("/sdlc")) {
        // Safety check: if we're not on /sdlc, redirect back with current params
	        const newParams = new URLSearchParams(currentParams);
	        if (urlOrganizationId) newParams.set("orgId", urlOrganizationId);
	        if (urlOrganizationName) newParams.set("organizationName", urlOrganizationName);
	        if (urlOrganizationUrl) newParams.set("organizationUrl", urlOrganizationUrl);
	        if (urlOrganization) newParams.set("organization", urlOrganization);
	        if (urlProjectId) newParams.set("projectId", urlProjectId);
	        if (projectName) newParams.set("projectName", projectName);
        setLocation(`/sdlc?${newParams.toString()}`, { replace: true });
      }
      return;
    }

    if (!window.location.pathname.startsWith("/sdlc")) {
      // Safety check: if we're not on /sdlc, redirect back
      const currentParams = new URLSearchParams(window.location.search);
      setLocation(`/sdlc?${currentParams.toString()}`, { replace: true });
    }
	  }, [
	    urlProjectId,
	    projectName,
	    urlOrganizationId,
	    urlOrganizationName,
	    urlOrganizationUrl,
	    urlOrganization,
	    setLocation,
	  ]);

  // Persist current SDLC project selection to localStorage so it survives
  // navigation and full page reloads.
  useEffect(() => {
    if (typeof window === "undefined") return;

    if (selectedAdoProject?.id) {
      window.localStorage.setItem(
        "sdlc:selectedProjectId",
        selectedAdoProject.id,
      );
      window.sessionStorage.setItem(
        "sdlc:selectedProjectId",
        selectedAdoProject.id,
      );
      if (selectedAdoProject.name) {
        window.sessionStorage.setItem(
          "sdlc:selectedProjectName",
          selectedAdoProject.name,
        );
      }
    } else {
      window.localStorage.removeItem("sdlc:selectedProjectId");
      window.sessionStorage.removeItem("sdlc:selectedProjectId");
      window.sessionStorage.removeItem("sdlc:selectedProjectName");
    }
  }, [selectedAdoProject]);

  // When an ADO project is selected, proactively reveal Build/Deployment phases
  // and mark Phase 3 as loaded so downstream ADO queries run without requiring
  // the user to scroll to the cards.
  useEffect(() => {
    if (!selectedAdoProject) return;
    setPhaseVisibility((prev) => ({ ...prev, 3: true, 4: true, 5: true, 6: true }));
    setPhaseInteractions((prev) => {
      const s = new Set(prev);
      [3, 4, 5, 6].forEach((n) => s.add(n));
      return s;
    });
    setPhaseLoadingComplete((prev) => ({ ...prev, 3: true }));
  }, [selectedAdoProject]);

  // Update URL params when project is selected to preserve state for browser back navigation
	  useEffect(() => {
	    if (isRestoringFromUrl.current) return;
	    if (!selectedAdoProject) return;

	    const currentParams = new URLSearchParams(search);
	    const needsUpdate =
	      (globalSelectedOrganization?.id &&
	        currentParams.get("orgId") !== globalSelectedOrganization.id) ||
	      (globalSelectedOrganization?.name &&
	        currentParams.get("organizationName") !== globalSelectedOrganization.name) ||
	      (selectedAdoProject?.id &&
	        currentParams.get("projectId") !== selectedAdoProject.id) ||
	      (selectedAdoProject?.name &&
        currentParams.get("projectName") !== selectedAdoProject.name) ||
      (!selectedAdoProject &&
        (currentParams.has("projectId") || currentParams.has("projectName")));

	    if (needsUpdate) {
	      const newParams = new URLSearchParams(currentParams);

	      if (globalSelectedOrganization && !isGlobalAllOrganizations) {
	        newParams.set("orgId", globalSelectedOrganization.id);
	        newParams.set("organizationName", globalSelectedOrganization.name);
	        if (globalSelectedOrganization.description) {
	          newParams.set("organizationUrl", globalSelectedOrganization.description);
	        } else if (selectedAdoProject.organizationUrl) {
	          newParams.set("organizationUrl", selectedAdoProject.organizationUrl);
	        } else {
	          newParams.delete("organizationUrl");
	        }
	        newParams.delete("organization");
	      }

      if (selectedAdoProject?.id) {
        newParams.set("projectId", selectedAdoProject.id);
      } else {
        newParams.delete("projectId");
      }
      if (selectedAdoProject?.name) {
        newParams.set("projectName", selectedAdoProject.name);
      } else {
        newParams.delete("projectName");
      }

      if (newParams.toString() !== currentParams.toString()) {
        setLocation(`/sdlc?${newParams.toString()}`, { replace: true });
      } else if (!location.startsWith("/sdlc")) {
        setLocation(`/sdlc?${newParams.toString()}`, { replace: true });
      }
    }
	  }, [
	    globalSelectedOrganization,
	    isGlobalAllOrganizations,
	    selectedAdoProject,
	    search,
	    setLocation,
	    location,
	  ]);

  // Fetch SDLC project details when ADO project is selected
  const {
    data: sdlcProjectData,
    isLoading: sdlcProjectLoading,
    isFetching: sdlcProjectFetching,
  } = useQuery<{ project: SDLCProject; phases: SDLCPhase[]; repository?: any }>(
    {
      queryKey: [
        "/api/sdlc/projects/by-ado",
        selectedAdoProject?.id,
        selectedAdoProject?.name,
      ],
      queryFn: async () => {
        if (!selectedAdoProject) {
          return null;
        }

        // Prefer ADO project ID for matching SDLC project; fall back to name if ID is missing
        const identifier = selectedAdoProject.id || selectedAdoProject.name;
        if (!identifier) {
          return null;
        }

        try {
          const encodedIdentifier = encodeURIComponent(identifier);
          const projectResponse = await fetch(
            getApiUrl(`/api/sdlc/projects/by-ado/${encodedIdentifier}/details`),
            {
              credentials: "include",
            },
          );

          if (!projectResponse.ok) {
            if (
              projectResponse.status === 403 ||
              projectResponse.status === 404 ||
              projectResponse.status === 428
            ) {
              const message = await readProjectLookupError(
                projectResponse,
                "This project is not available until it is synced for your user.",
              );
              if (projectResponse.status === 404) {
                console.log(
                  `[SDLCPage] No SDLC project found for ADO project: ${identifier}`,
                );
                return null;
              }
              toast({
                title: "Project is not available",
                description: message,
                variant: "destructive",
              });
              setLocation("/projects", { replace: true });
              throw Object.assign(new Error(message), {
                projectUnavailable: true,
              });
            }
            const errorText = await projectResponse.text();
            throw new Error(`Failed to fetch SDLC project: ${errorText}`);
          }
          return projectResponse.json();
        } catch (fetchError) {
          if ((fetchError as any)?.projectUnavailable) {
            throw fetchError;
          }
          console.error(
            "[SDLCPage] Error fetching SDLC project details by ADO identifier:",
            fetchError,
          );
          throw fetchError;
        }
      },
      enabled: !!selectedAdoProject, // Only fetch when ADO project is selected
      retry: false,
    },
  );

  // Fetch project and phases (only when URL has projectId, not default project)
  // Note: When ADO project is selected, we use sdlcProjectData instead
  const {
    data,
    isLoading,
    isError,
    error,
    isFetching: isProjectFetching,
  } = useQuery<{
    project: SDLCProject;
    phases: SDLCPhase[];
    repository?: any;
  }>({
    queryKey: ["/api/sdlc/projects", urlProjectId],
    queryFn: async () => {
      // If ADO project is selected, don't fetch here - use sdlcProjectData instead
      if (selectedAdoProject) {
        return null;
      }

      if (!urlProjectId) {
        return null;
      }

      // First, try to fetch as ADO project (when coming from projects nav, projectId is usually an ADO project ID)
      // This ensures we get repository information needed for workflow
      try {
        const encodedIdentifier = encodeURIComponent(urlProjectId);
        const adoProjectResponse = await fetch(
          getApiUrl(`/api/sdlc/projects/by-ado/${encodedIdentifier}/details`),
          {
            credentials: "include",
          },
        );
        if (adoProjectResponse.ok) {
          const adoProjectData = await adoProjectResponse.json();
          console.log(
            "[SDLCPage] Successfully fetched project by ADO identifier",
          );
          return adoProjectData;
        }
        if (
          adoProjectResponse.status === 403 ||
          adoProjectResponse.status === 404 ||
          adoProjectResponse.status === 428
        ) {
          const message = await readProjectLookupError(
            adoProjectResponse,
            "This project is not available until it is synced for your user.",
          );
          toast({
            title: "Project is not available",
            description: message,
            variant: "destructive",
          });
          setLocation("/projects", { replace: true });
          throw Object.assign(new Error(message), {
            projectUnavailable: true,
          });
        }
        // If ADO lookup fails, continue to try SDLC project lookup
        console.log(
          "[SDLCPage] ADO project lookup failed, trying SDLC project lookup",
        );
      } catch (adoError) {
        if ((adoError as any)?.projectUnavailable) {
          throw adoError;
        }
        console.log(
          "[SDLCPage] ADO project lookup error, trying SDLC project lookup:",
          adoError,
        );
      }

      // If ADO lookup didn't work, try fetching as SDLC project by ID
      try {
        const projectResponse = await fetch(
          getApiUrl(`/api/sdlc/projects/${urlProjectId}/details`),
          {
            credentials: "include",
          },
        );
        if (!projectResponse.ok) {
          const errorText = await readProjectLookupError(
            projectResponse,
            "Failed to fetch project",
          );
          console.warn(
            `[SDLCPage] API call failed for /api/sdlc/projects/${urlProjectId}/details:`,
            projectResponse.status,
            errorText,
          );
          if (
            projectResponse.status === 403 ||
            projectResponse.status === 404 ||
            projectResponse.status === 428
          ) {
            toast({
              title: "Project is not available",
              description: errorText,
              variant: "destructive",
            });
            setLocation("/projects", { replace: true });
          }
          throw new Error(`Failed to fetch project: ${errorText}`);
        }
        return projectResponse.json();
      } catch (fetchError) {
        console.error("[SDLCPage] Error fetching project details:", fetchError);
        throw fetchError;
      }
    },
    enabled: !selectedAdoProject && !!urlProjectId, // Only fetch if no ADO project is selected and we have a URL projectId
    retry: false,
    staleTime: 5 * 60 * 1000, // Project data doesn't change frequently
    gcTime: 10 * 60 * 1000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
  });

  // Clear selected project when organization changes
	  useEffect(() => {
	    if (
	      globalSelectedOrganization &&
	      !isGlobalAllOrganizations &&
	      selectedAdoProject &&
	      !projectMatchesGlobalOrganization(selectedAdoProject, globalSelectedOrganization)
	    ) {
      // Store the old project ID before clearing it
      const oldProjectId = selectedAdoProject.id;

      // Clear project selection
      setSelectedAdoProject(null);
      setProjectSearchQuery("");
      setTestingModalOpen(false);
      setTestCasesModalOpen(false);

      // Invalidate and remove queries for the old project to prevent flickering
      if (oldProjectId) {
        queryClient.invalidateQueries({
          queryKey: ["/api/sdlc/projects/by-ado", oldProjectId],
        });
        queryClient.removeQueries({
          queryKey: ["/api/sdlc/projects/by-ado", oldProjectId],
        });
      }

      // Clear project from localStorage
      if (typeof window !== "undefined") {
        window.localStorage.removeItem("sdlc:selectedProjectId");
        window.sessionStorage.removeItem("sdlc:selectedProjectId");
        window.sessionStorage.removeItem("sdlc:selectedProjectName");
      }

      const currentParams = new URLSearchParams(search);
      currentParams.delete("projectId");
      currentParams.delete("projectName");
      currentParams.delete("adoProjectId");
      currentParams.delete("jiraProjectId");
      currentParams.delete("openPhase");
      currentParams.delete("openWorkflow");
	      if (globalSelectedOrganization) {
	        currentParams.set("orgId", globalSelectedOrganization.id);
	        currentParams.set("organizationName", globalSelectedOrganization.name);
	        if (globalSelectedOrganization.description) {
	          currentParams.set("organizationUrl", globalSelectedOrganization.description);
	        } else {
	          currentParams.delete("organizationUrl");
	        }
	        currentParams.delete("organization");
	      }
      const nextSearch = currentParams.toString();
      const nextLocation = nextSearch ? `/sdlc?${nextSearch}` : "/sdlc";
      if (nextLocation !== location) {
        setLocation(nextLocation, { replace: true });
      }
    }
  }, [
	    globalSelectedOrganization,
	    isGlobalAllOrganizations,
	    selectedAdoProject,
    search,
    location,
    setLocation,
  ]);

  // Organization is now driven by the global header selector —
  // no local initialization needed.

  // Initialize selected ADO project from URL params when page loads
  // Always restore from URL params when present (for browser back navigation and workflow navigation)
  useEffect(() => {
    // Wait for allProjects to load before trying to match
    if (
      urlProjectId &&
      !allProjectsLoading &&
      allProjects &&
      allProjects.length > 0
    ) {
      // Check if we need to restore from URL - always restore if URL params differ from current selection
      // This ensures values are retained when navigating back from workflow (any step) or using browser back button
      const currentProjectId = selectedAdoProject?.id;
      const urlProjectIdStr = urlProjectId?.toString();

      const shouldRestore =
        !selectedAdoProject ||
        (currentProjectId !== urlProjectIdStr &&
          currentProjectId !== urlProjectId);

	      if (shouldRestore) {
	        // If organization is in URL, filter projects by organization first
	        let projectsToSearch = allProjects;
	        if (urlSelectedOrganization) {
	          projectsToSearch = allProjects.filter((p) =>
	            projectMatchesGlobalOrganization(p, urlSelectedOrganization),
	          );
	        } else if (urlOrganizationId || urlOrganizationName || urlOrganizationUrl || urlOrganization) {
	          const targetId = urlOrganizationId || "";
	          const targetName = normalizeOrgText(urlOrganizationName || urlOrganization);
	          const targetUrl = normalizeOrgUrl(urlOrganizationUrl || urlOrganization);
	          projectsToSearch = allProjects.filter((p) => {
	            if (targetId && (p.artifactOrgId === targetId || p.jiraConnectionId === targetId)) {
	              return true;
	            }
	            if (targetName && normalizeOrgText(p.organization) === targetName) {
	              return true;
	            }
	            if (targetUrl) {
	              return [p.organizationUrl, p.jiraInstanceUrl, p.organization]
	                .map(normalizeOrgUrl)
	                .some((url) => url === targetUrl);
	            }
	            return true;
	          });
	        }

        const projectFromUrl = projectsToSearch.find(
          (p) =>
            p.id === urlProjectId ||
            p.id?.toString() === urlProjectId?.toString() ||
            (!!projectName &&
              (p.name === projectName ||
                p.name?.toLowerCase() === projectName?.toLowerCase())),
        );
        if (projectFromUrl) {
          console.log(
            "[SDLCPage] Found project in allProjects, setting as selectedAdoProject:",
            projectFromUrl,
            fromWorkflow ? "(from workflow)" : "(restoring from URL)",
          );
          isRestoringFromUrl.current = true;
          setSelectedAdoProject(projectFromUrl);
          setTimeout(() => {
            isRestoringFromUrl.current = false;
          }, 100);
        } else {
          console.log(
            "[SDLCPage] Project not found in allProjects, will try ADO lookup endpoint",
          );
        }
      }
    }
  }, [
    urlProjectId,
	    projectName,
	    urlOrganizationId,
	    urlOrganizationName,
	    urlOrganizationUrl,
	    urlOrganization,
	    urlSelectedOrganization,
	    allProjects,
    allProjectsLoading,
    selectedAdoProject,
    fromWorkflow,
  ]);

  // Organization selection is now driven entirely by the global header selector.

  // Filter and sort projects based on selected organization, search, and sort criteria
  const filteredAndSortedProjects = useMemo(() => {
    if (!allProjects || allProjects.length === 0) return [];

    let filtered = allProjects;

	    // First filter by selected organization when a specific global org is active
	    if (globalSelectedOrganization && !isGlobalAllOrganizations) {
	      filtered = filtered.filter((p) =>
	        projectMatchesGlobalOrganization(p, globalSelectedOrganization),
	      );
	    } else if (!isGlobalAllOrganizations) {
	      // When not using the global All option, a concrete organization is required
	      return [];
    }

    // Filter by search query
    if (projectSearchQuery.trim()) {
      const query = projectSearchQuery.toLowerCase();
      filtered = filtered.filter(
        (p) =>
          p.name.toLowerCase().includes(query) ||
          p.description?.toLowerCase().includes(query) ||
          p.organization?.toLowerCase().includes(query),
      );
    }

    // Sort projects by name
    filtered = [...filtered].sort((a, b) => {
      return a.name.localeCompare(b.name);
    });

    return filtered;
	  }, [allProjects, globalSelectedOrganization, projectSearchQuery, isGlobalAllOrganizations]);

  // Use SDLC project data from ADO project selection, or regular data from URL
  const projectData = sdlcProjectData || data;
	  const isUrlProjectForSelectedOrganization = Boolean(
	    urlProjectId &&
	    projectName &&
	    (!globalSelectedOrganization ||
	      isGlobalAllOrganizations ||
	      !urlSelectedOrganization ||
	      urlSelectedOrganization.id === globalSelectedOrganization.id),
	  );

  // Update displayed project name when selection changes
  useEffect(() => {
    const newProjectName =
      selectedAdoProject?.name ||
      (isUrlProjectForSelectedOrganization ? projectName : null) ||
      null;

    setDisplayedProjectName(newProjectName);
  }, [
    selectedAdoProject,
    projectName,
    isUrlProjectForSelectedOrganization,
  ]);

  // Get projectId from SDLC project data, URL params, or fetched project data
  const projectId =
    sdlcProjectData?.project?.id?.toString() ||
    projectData?.project?.id?.toString() ||
    urlProjectId ||
    null;

  const integrationType = projectData?.project?.integrationType || (jiraOnlyHosting ? "jira" : "ado");
  const isJira = integrationType === "jira";
  const integrationName = isJira ? "Jira" : "Azure DevOps";

  // Use project ID for database queries (use "default" as fallback to keep features clickable)
  const dbProjectId = projectId || "default";

  // Fetch configured third-party integration count (Datadog + ServiceNow) for Maintenance phase
  const { data: projectIntegrationsData } = useQuery<{ integrations: any[] }>({
    queryKey: ["/api/integrations", dbProjectId],
    queryFn: async () => {
      const res = await fetch(getApiUrl("/api/integrations"), {
        credentials: "include",
        headers: { "x-project-id": dbProjectId },
      });
      if (!res.ok) return { integrations: [] };
      return res.json();
    },
    enabled: dbProjectId !== "default",
    staleTime: 60 * 1000,
  });

  const { data: effectiveIntegrationsData } = useQuery<{
    integrations: Array<{ providerKey?: string | null; categoryKey?: string | null }>;
  }>({
    queryKey: ["/api/projects", dbProjectId, "integration-effective"],
    queryFn: async () => {
      const res = await fetch(
        getApiUrl(
          `/api/projects/${encodeURIComponent(dbProjectId)}/integration-effective`,
        ),
        { credentials: "include" },
      );
      if (!res.ok) return { integrations: [] };
      return res.json();
    },
    enabled: dbProjectId !== "default",
    staleTime: 60 * 1000,
  });

  const configuredIntegrationsCount = useMemo(() => {
    let datadog = false;
    let servicenow = false;

    for (const row of projectIntegrationsData?.integrations ?? []) {
      const type = String(row.integrationType || "").toLowerCase();
      if (type === "datadog") datadog = true;
      if (type === "servicenow") servicenow = true;
    }

    for (const row of effectiveIntegrationsData?.integrations ?? []) {
      const provider = String(row.providerKey || "").toLowerCase();
      if (provider === "datadog") datadog = true;
      if (provider === "servicenow") servicenow = true;
    }

    return (datadog ? 1 : 0) + (servicenow ? 1 : 0);
  }, [projectIntegrationsData?.integrations, effectiveIntegrationsData?.integrations]);

  // Clear guidelines when project changes
  useEffect(() => {
    setUploadedGuidelines("");
    setUploadedGuidelineFiles([]);
    setLinkedGoldenRepoFilePaths([]);
  }, [dbProjectId]);

  // Check guidelines validation when project changes
  useEffect(() => {
    if (projectId) {
      checkGuidelinesValidation();
    }
  }, [projectId]);

  // Set up Intersection Observer to track phase visibility for lazy loading
  useEffect(() => {
    const observers: IntersectionObserver[] = [];

    // Create observer for each phase
    sdlcPhases.forEach((phase) => {
      const element = document.querySelector(
        `[data-testid="card-phase-${phase.id}"]`,
      );
      if (element) {
        const observer = new IntersectionObserver(
          (entries) => {
            entries.forEach((entry) => {
              if (entry.isIntersecting) {
                setPhaseVisibility((prev) => ({ ...prev, [phase.id]: true }));
              }
            });
          },
          { threshold: 0.1 }, // Trigger when 10% of card is visible
        );
        observer.observe(element);
        observers.push(observer);
      }
    });

    // Cleanup observers on unmount
    return () => {
      observers.forEach((observer) => observer.disconnect());
    };
  }, [projectId]); // Re-run when project changes

  // Fetch BRD status counts for the current project
  // Use selectedAdoProject.id first (same as BRD Generator button) to ensure consistency
  const brdCountsProjectId = selectedAdoProject?.id || projectId;
  // Fetch BRD list data when project is selected or when BRD features are being used
  const shouldFetchBrdData =
    !!selectedAdoProject ||
    brdDropdownOpen ||
    brdListDialogOpen ||
    brdPreviewDialogOpen ||
    !!selectedBrd;

  // BRD counts API - Load immediately when project is available (for first card display)
  // This is prioritized since it's shown in the first card on the SDLC page
  const {
    data: brdCounts,
    isLoading: isLoadingBrdCounts,
    refetch: refetchBrdCounts,
  } = useQuery<{
    drafts: number;
    yetToReview: number;
    approved: number;
    partiallyGenerated: number;
    generated: number;
    total: number;
  }>({
    queryKey: ["/api/dev-brd/counts", brdCountsProjectId],
    queryFn: async () => {
      if (!brdCountsProjectId) {
        console.log(
          "[SDLC] BRD counts: No projectId available, returning zeros",
        );
        return {
          drafts: 0,
          yetToReview: 0,
          approved: 0,
          partiallyGenerated: 0,
          generated: 0,
          total: 0,
        };
      }
      console.log(
        "[SDLC] Fetching BRD counts for projectId:",
        brdCountsProjectId,
        "(selectedAdoProject.id:",
        selectedAdoProject?.id,
        ", projectId:",
        projectId,
        ")",
      );
      const response = await fetch(
        getApiUrl(`/api/dev-brd/counts?projectId=${brdCountsProjectId}`),
        {
          credentials: "include",
        },
      );
      if (!response.ok) {
        throw new Error("Failed to fetch BRD counts");
      }
      const data = await response.json();
      console.log("[SDLC] BRD counts response:", data);
      return data;
    },
    enabled: !!brdCountsProjectId, // Load immediately when project is available (for first card)
    staleTime: 2 * 60 * 1000, // Consider data fresh for 2 minutes
    gcTime: 5 * 60 * 1000, // Keep in cache for 5 minutes
    refetchOnMount: false, // Don't refetch on mount if data is fresh
    refetchOnWindowFocus: false, // Don't refetch on window focus
    // Prioritize this query since it's displayed in the first card
    retry: 1, // Quick retry on failure
  });

  // Fetch list of all BRDs (drafts + yetToReview + approved) for dropdown
  const {
    data: allBrds = [],
    isLoading: brdsLoading,
    refetch: refetchAllBrds,
  } = useQuery<
    Array<{
      id: string;
      title: string;
      status: string;
      createdAt?: string;
      updatedAt?: string;
    }>
  >({
    queryKey: ["/api/dev-brd/all", brdCountsProjectId],
    queryFn: async () => {
      if (!brdCountsProjectId) {
        return [];
      }

      // Fetch all BRDs with calculated status (matching counts API logic)
      const response = await fetch(
        getApiUrl(`/api/dev-brd/all?projectId=${brdCountsProjectId}`),
        {
          credentials: "include",
        },
      );

      if (!response.ok) {
        throw new Error("Failed to fetch BRDs");
      }

      const allBrdsData = await response.json();

      // Debug logging for generated/partially_generated BRDs
      const generatedBrds = allBrdsData.filter(
        (b: any) =>
          b.status === "generated" || b.status === "partially_generated",
      );
      if (generatedBrds.length > 0) {
        console.log(
          `[SDLC] Fetched ${generatedBrds.length} generated/partially_generated BRDs:`,
          generatedBrds.map((b: any) => ({
            id: b.id,
            title: b.title,
            status: b.status,
          })),
        );
      }

      return allBrdsData;
    },
    enabled: !!brdCountsProjectId && shouldFetchBrdData, // Only fetch when BRD features are visible/used
    staleTime: 2 * 60 * 1000, // Consider data fresh for 2 minutes
    gcTime: 5 * 60 * 1000, // Keep in cache for 5 minutes
    refetchOnMount: true, // Refetch when dialog opens to get latest status
    refetchOnWindowFocus: false,
  });

  // Calculate filtered BRD counts based on selected BRD/Requirement
  // If BRD is selected, show counts only for that BRD
  // If Requirement is selected, show counts for BRDs linked to that requirement
  // If both selected, show intersection
  // If none selected, show all counts
  const filteredBrdCounts = useMemo(() => {
    if (!selectedBrd?.id && !selectedRequirement?.id) {
      return brdCounts; // Show all if no filter
    }

    // If BRD is selected, filter to show only that BRD's status
    if (selectedBrd?.id && allBrds.length > 0) {
      const selectedBrdData = allBrds.find((b: any) => b.id === selectedBrd.id);
      if (selectedBrdData) {
        const status = selectedBrdData.status;
        return {
          drafts: status === "draft" ? 1 : 0,
          yetToReview: status === "yetToReview" ? 1 : 0,
          approved: status === "approved" ? 1 : 0,
          partiallyGenerated: status === "partially_generated" ? 1 : 0,
          generated: status === "generated" ? 1 : 0,
          total: 1,
        };
      }
    }

    // If only Requirement is selected, we need to find BRDs linked to that requirement
    // For now, return all counts (can be enhanced later with requirement-to-BRD mapping)
    if (selectedRequirement?.id && !selectedBrd?.id) {
      // TODO: Implement requirement-to-BRD mapping when available
      return brdCounts;
    }

    return brdCounts;
  }, [brdCounts, selectedBrd?.id, selectedRequirement?.id, allBrds]);

  // Fetch list of requirements for dropdown
  // Use SDLC project ID from projectData (which is sdlcProjectData || data) - same logic as projectId
  const requirementsProjectId =
    projectData?.project?.id?.toString() || dbProjectId;
  // Fetch requirements when project is selected or when requirement features are being used
  const shouldFetchRequirements =
    !!selectedAdoProject || requirementDropdownOpen || !!selectedRequirement;

  const { data: allRequirements = [], isLoading: requirementsLoading } =
    useQuery<Array<{ id: string; title: string; phaseNumber?: number }>>({
      queryKey: ["/api/sdlc/requirements", requirementsProjectId],
      queryFn: async () => {
        if (!requirementsProjectId || requirementsProjectId === "default") {
          console.log(
            "[SDLC] Requirements: No valid projectId available, returning empty array",
          );
          return [];
        }

        console.log(
          "[SDLC] Fetching requirements for projectId:",
          requirementsProjectId,
        );
        const response = await fetch(
          getApiUrl(`/api/sdlc/projects/${requirementsProjectId}/requirements`),
          {
            credentials: "include",
          },
        );

        if (!response.ok) {
          console.error(
            "[SDLC] Failed to fetch requirements:",
            response.status,
            response.statusText,
          );
          throw new Error("Failed to fetch requirements");
        }

        const requirements = await response.json();
        console.log("[SDLC] Fetched requirements:", requirements.length);
        return requirements;
      },
      enabled:
        !!requirementsProjectId &&
        requirementsProjectId !== "default" &&
        shouldFetchRequirements,
      staleTime: 2 * 60 * 1000, // Consider data fresh for 2 minutes
      gcTime: 5 * 60 * 1000, // Keep in cache for 5 minutes
      refetchOnMount: false,
      refetchOnWindowFocus: false,
    });

  // Fetch selected BRD for preview
  const {
    data: selectedBrdData,
    isLoading: brdPreviewLoading,
    error: brdPreviewError,
  } = useQuery<{
    brd: BRDDocument | null;
    brdFileName?: string;
    brdFileType?: string;
    status?: string;
  }>({
    queryKey: ["/api/dev-brd/preview", selectedBrdForPreview],
    queryFn: async () => {
      if (!selectedBrdForPreview) {
        return { brd: null };
      }

      console.log("[SDLC] Fetching BRD with ID:", selectedBrdForPreview);

      const response = await fetch(
        getApiUrl(`/api/dev-brd/${selectedBrdForPreview}`),
        {
          credentials: "include",
        },
      );

      console.log("[SDLC] Response status:", response.status);

      if (!response.ok) {
        const errorText = await response.text();
        console.error(
          "[SDLC] Failed to fetch BRD:",
          response.status,
          errorText,
        );
        throw new Error(`Failed to fetch BRD: ${response.status}`);
      }

      const brdData = await response.json();

      console.log("[SDLC] Fetched BRD data:", {
        id: brdData.id,
        title: brdData.title,
        hasGeneratedBrdJson: !!brdData.generatedBrdJson,
        hasGeneratedMarkdown: !!brdData.generatedMarkdown,
        hasBrdFileName: !!brdData.brdFileName,
        brdFileName: brdData.brdFileName,
      });

      // Process BRD data similar to brd.tsx
      let brd: BRDDocument | null = null;

      // Priority 1: Use generatedBrdJson if available
      if (brdData.generatedBrdJson) {
        brd = brdData.generatedBrdJson as BRDDocument;
      }
      // Priority 2: Parse generatedMarkdown into BRDDocument
      else if (
        brdData.generatedMarkdown &&
        brdData.generatedMarkdown.trim() !== ""
      ) {
        const markdown = brdData.generatedMarkdown;
        const lines = markdown.split("\n");
        const sections: { title: string; content: string }[] = [];
        let currentSection: { title: string; content: string } | null = null;

        for (const line of lines) {
          if (line.startsWith("## ")) {
            if (currentSection) {
              sections.push(currentSection);
            }
            currentSection = {
              title: line.replace("## ", "").trim(),
              content: "",
            };
          } else if (currentSection) {
            currentSection.content += line + "\n";
          }
        }

        if (currentSection) {
          sections.push(currentSection);
        }

        brd = {
          title: brdData.title || "Business Requirements Document",
          version: "1.0",
          date: new Date().toISOString().split("T")[0],
          sections:
            sections.length > 0
              ? sections
              : [{ title: "Document", content: markdown }],
          rawMarkdown: markdown,
        };
      }

      return {
        brd,
        brdFileName: brdData.brdFileName,
        brdFileType: brdData.brdFileType,
        status: brdData.status,
      };
    },
    enabled: !!selectedBrdForPreview,
  });

  // Filter BRDs based on search query
  const filteredBrds = useMemo(() => {
    if (!allBrds || allBrds.length === 0) return [];
    if (brdSearchQuery.trim()) {
      const query = brdSearchQuery.toLowerCase();
      return allBrds.filter((brd: any) =>
        brd.title?.toLowerCase().includes(query),
      );
    }
    return allBrds;
  }, [allBrds, brdSearchQuery]);

  // Filter BRDs by category for the list dialog
  const brdsByCategory = useMemo(() => {
    if (!allBrds || allBrds.length === 0) return [];

    // Debug logging
    if (
      brdListCategory === "generated" ||
      brdListCategory === "partiallyGenerated"
    ) {
      console.log(`[SDLC] Filtering BRDs for category: ${brdListCategory}`);
      console.log(`[SDLC] Total BRDs: ${allBrds.length}`);
      console.log(
        `[SDLC] BRD statuses:`,
        allBrds.map((brd: any) => ({
          id: brd.id,
          title: brd.title,
          status: brd.status,
        })),
      );
    }

    let filtered: any[] = [];

    if (brdListCategory === "drafts") {
      filtered = allBrds.filter((brd) => brd.status === "draft");
    } else if (brdListCategory === "yetToReview") {
      filtered = allBrds.filter((brd) => brd.status === "yetToReview");
    } else if (brdListCategory === "approved") {
      filtered = allBrds.filter((brd) => brd.status === "approved");
    } else if (brdListCategory === "partiallyGenerated") {
      filtered = allBrds.filter((brd) => {
        // Normalize status for comparison (trim and lowercase)
        const normalizedStatus = String(brd.status || "")
          .trim()
          .toLowerCase();
        const matches = normalizedStatus === "partially_generated";
        if (!matches) {
          console.log(
            `[SDLC] BRD ${brd.id} (${brd.title}) status mismatch: expected "partially_generated", got "${brd.status}" (normalized: "${normalizedStatus}")`,
          );
        }
        return matches;
      });
    } else if (brdListCategory === "generated") {
      filtered = allBrds.filter((brd) => {
        // Normalize status for comparison (trim and lowercase)
        const normalizedStatus = String(brd.status || "")
          .trim()
          .toLowerCase();
        const matches = normalizedStatus === "generated";
        if (!matches) {
          console.log(
            `[SDLC] BRD ${brd.id} (${brd.title}) status mismatch: expected "generated", got "${brd.status}" (normalized: "${normalizedStatus}")`,
          );
        }
        return matches;
      });
    } else {
      filtered = allBrds;
    }

    if (
      brdListCategory === "generated" ||
      brdListCategory === "partiallyGenerated"
    ) {
      console.log(`[SDLC] Filtered BRDs count: ${filtered.length}`);
    }

    return filtered;
  }, [allBrds, brdListCategory]);

  // Fetch BRD-linked requirements when BRD is selected (for filtering)
  const { data: brdLinkedRequirements = [] } = useQuery<string[]>({
    queryKey: [
      "/api/dev-brd/requirements/by-brd",
      selectedBrd?.id,
      brdCountsProjectId,
    ],
    queryFn: async () => {
      if (!selectedBrd?.id || !brdCountsProjectId) {
        return [];
      }
      const response = await fetch(
        `/api/dev-brd/requirements/by-brd?brdId=${selectedBrd.id}&projectId=${brdCountsProjectId}`,
        { credentials: "include" },
      );
      if (!response.ok) {
        console.warn("[SDLC] Failed to fetch BRD-linked requirements");
        return [];
      }
      return response.json();
    },
    enabled: !!selectedBrd?.id && !!brdCountsProjectId,
    staleTime: 2 * 60 * 1000,
  });

  // Filter Requirements based on search query
  const filteredRequirements = useMemo(() => {
    if (!allRequirements || allRequirements.length === 0) return [];
    if (requirementSearchQuery.trim()) {
      const query = requirementSearchQuery.toLowerCase();
      return allRequirements.filter((req: any) =>
        req.title?.toLowerCase().includes(query),
      );
    }
    return allRequirements;
  }, [allRequirements, requirementSearchQuery]);

  // Restore selected BRD and Requirement from localStorage when project is selected
  useEffect(() => {
    if (typeof window === "undefined" || !selectedAdoProject) return;

    // Restore BRD selection
    const storedBrdId = window.localStorage.getItem("sdlc:selectedBrdId");
    if (storedBrdId && allBrds && allBrds.length > 0) {
      const storedBrd = allBrds.find((b: any) => b.id === storedBrdId);
      if (storedBrd) {
        setSelectedBrd({
          id: storedBrd.id,
          title: storedBrd.title,
          status: storedBrd.status,
        });
      }
    }

    // Restore Requirement selection
    const storedRequirementId = window.localStorage.getItem(
      "sdlc:selectedRequirementId",
    );
    if (storedRequirementId && allRequirements && allRequirements.length > 0) {
      const storedRequirement = allRequirements.find(
        (r: any) => r.id === storedRequirementId,
      );
      if (storedRequirement) {
        setSelectedRequirement(storedRequirement);
      }
    }
  }, [selectedAdoProject, allBrds, allRequirements]);

  // Clear BRD and Requirement selections when project changes
  useEffect(() => {
    setSelectedBrd(null);
    setSelectedRequirement(null);
    if (typeof window !== "undefined") {
      window.localStorage.removeItem("sdlc:selectedBrdId");
      window.localStorage.removeItem("sdlc:selectedRequirementId");
    }
  }, [selectedAdoProject?.id]);

  // Auto-detect ADO project for current SDLC project
  // This ensures ADO work items are fetched for all projects, not just when explicitly selected
  const autoDetectedAdoProject = useMemo(() => {
    // If user has explicitly selected an ADO project, use that
    if (selectedAdoProject) {
      return selectedAdoProject;
    }

    // Otherwise, try to find an ADO project that matches the current SDLC project
    if (!allProjects || !projectData?.project) {
      return null;
    }

    const sdlcProject = projectData.project;

    const matched = allProjects.find((adoProject: ADOProject) => {
      // Match by ID if SDLC project has an ADO project ID stored
      if (
        sdlcProject.id &&
        (adoProject.id === sdlcProject.id ||
          adoProject.id === sdlcProject.id.toString())
      ) {
        return true;
      }

      // Match by name
      if (
        sdlcProject.name &&
        adoProject.name &&
        sdlcProject.name.toLowerCase() === adoProject.name.toLowerCase()
      ) {
        return true;
      }

      return false;
    });

    return matched || null;
  }, [allProjects, projectData?.project, selectedAdoProject]);

  // Note: Removed automatic golden repo info loading - let user manually select

  // Auto-open backlog + workflow after BRD approval
  useEffect(() => {
    if (autoWorkflowOpened.current) return;
    if (openWorkflowParam !== "1") return;
    if (!urlProjectId) return;

    autoWorkflowOpened.current = true;

    if (openPhaseParam?.toLowerCase() === "backlogs") {
      openPhaseFeatureDialog("Requirements", "Backlogs", 1);
    }

	    const workflowParams = new URLSearchParams();
	    workflowParams.append("projectId", urlProjectId);
	    if (projectName) workflowParams.append("projectName", projectName);
	    if (urlSelectedOrganization) {
	      workflowParams.set("orgId", urlSelectedOrganization.id);
	      workflowParams.set("organizationName", urlSelectedOrganization.name);
	      if (urlSelectedOrganization.description) {
	        workflowParams.set("organizationUrl", urlSelectedOrganization.description);
	      }
	    }
	    const organizationForWorkflow =
	      urlSelectedOrganization?.name || urlOrganizationName || selectedOrganization;
	    if (organizationForWorkflow) workflowParams.set("organizationName", organizationForWorkflow);
    if (brdIdParam) workflowParams.append("brdId", brdIdParam);
    if (urlGoldenRepoName) workflowParams.append("goldenRepoName", urlGoldenRepoName);
    setLocation(`/workflow?${workflowParams.toString()}`);
  }, [
    autoWorkflowOpened,
    openWorkflowParam,
    openPhaseParam,
    urlProjectId,
	    projectName,
	    urlSelectedOrganization,
	    urlOrganizationName,
	    selectedOrganization,
    brdIdParam,
    setLocation,
    openPhaseFeatureDialog,
  ]);

  // Use auto-detected ADO project if no explicit selection
  const activeAdoProject = selectedAdoProject || autoDetectedAdoProject;

  // Use ADO project ID when available (explicit selection or auto-detected), otherwise use SDLC project ID for API calls
  // This ensures all API calls use the active ADO project ID
  const apiProjectId = activeAdoProject?.id || dbProjectId;

  // Incremented after a test plan is saved to trigger a count re-fetch
  const [testPlanRefetchKey, setTestPlanRefetchKey] = useState(0);

  // Testing phase hooks (moved here to use apiProjectId after its declaration)
  const { manualScriptsCount, automationScriptsCount, testPlansCount } =
    useTestingCounts(
      urlProjectId,
      selectedOrganization,
      selectedAdoProject,
      projectName,
      apiProjectId,
      testPlanRefetchKey,
    );

  const {
    fileBrowserModalOpen,
    setFileBrowserModalOpen,
    userStoriesModalOpen,
    setUserStoriesModalOpen,
    testPlanModalOpen,
    setTestPlanModalOpen,
    fileBrowserContent,
    setFileBrowserContent,
    openFileBrowserModal,
  } = useFileBrowser();

	  useEffect(() => {
	    if (
	      globalSelectedOrganization &&
	      !isGlobalAllOrganizations &&
	      selectedAdoProject &&
	      !projectMatchesGlobalOrganization(selectedAdoProject, globalSelectedOrganization)
	    ) {
	      setFileBrowserModalOpen(false);
      setUserStoriesModalOpen(false);
      setTestPlanModalOpen(false);
      setFileBrowserContent(null);
    }
  }, [
	    globalSelectedOrganization,
	    isGlobalAllOrganizations,
	    selectedAdoProject,
    setFileBrowserContent,
    setFileBrowserModalOpen,
    setTestPlanModalOpen,
    setUserStoriesModalOpen,
  ]);

  // View Test Plans modal state
  const [viewTestPlansModalOpen, setViewTestPlansModalOpen] = useState(false);

  // Determine which project ID to use for fetching workflow artifacts (Phase 1 data)
  const workflowProjectId = activeAdoProject?.id || dbProjectId;

  // Fetch workflow artifacts (epics, features, user stories) generated via workflow builder
  // Filter by project_id in workflow_artifacts table (ADO project ID or SDLC project ID)
  // Treated as part of Phase 1 loading
  const {
    data: workflowArtifactsData,
    isLoading: workflowArtifactsLoading,
    isError: workflowArtifactsError,
    isFetching: workflowArtifactsFetching,
  } = useQuery<WorkflowArtifactsApiResponse | null>({
    queryKey: ["/api/workflow/artifacts", workflowProjectId],
    queryFn: async () => {
      // Fetch saved workflow artifacts filtered by projectId (ADO project ID or SDLC project ID)
      const params = new URLSearchParams({
        status: "saved",
        page: "1",
        limit: "50",
      });

      // Add projectId filter if we have one
      if (workflowProjectId) {
        params.append("projectId", workflowProjectId);
      }

      const response = await fetch(
        getApiUrl(`/api/workflow/artifacts?${params.toString()}`),
        {
          credentials: "include",
        },
      );

      if (!response.ok) {
        throw new Error("Failed to fetch workflow artifacts");
      }

      return response.json();
    },
    // Enable query when we have a project ID and Phase 1 should load
    enabled: !!workflowProjectId && !!dbProjectId && dbProjectId !== "default",
    retry: false,
    staleTime: 2 * 60 * 1000,
    gcTime: 5 * 60 * 1000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
  });

  // Track project changes to show skeleton loading on buttons
  useEffect(() => {
    const currentProjectId = selectedAdoProject?.id || projectId || null;
    const currentProjectKey = currentProjectId
      ? `${selectedAdoProject?.id || projectId}-${selectedAdoProject?.name || ""}`
      : null;

    if (
      prevProjectRef.current !== null &&
      prevProjectRef.current !== currentProjectKey &&
      currentProjectKey !== null
    ) {
      // Project changed, show loading
      setIsProjectChanging(true);
    }

    prevProjectRef.current = currentProjectKey;

    // Reset loading state when project data is loaded
    if (
      currentProjectKey &&
      !sdlcProjectLoading &&
      !sdlcProjectFetching &&
      !workflowArtifactsLoading &&
      !workflowArtifactsFetching
    ) {
      // Small delay to ensure smooth transition
      const timer = setTimeout(() => {
        setIsProjectChanging(false);
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [
    selectedAdoProject?.id,
    selectedAdoProject?.name,
    projectId,
    sdlcProjectLoading,
    sdlcProjectFetching,
    workflowArtifactsLoading,
    workflowArtifactsFetching,
  ]);

  // Fetch counts for Phase 1 (Requirement & Analysis) categories
  // - User Stories: now fetched from Hub Artifacts endpoint (combinedUserStories)
  // - Requirements: use apiProjectId (can be ADO or SDLC project)
  // - Documents: use dbProjectId (always the SDLC project, where phase docs are stored)
  // Phase 1 loads immediately (no dependency)
  const isPhase1Visible = phaseVisibility[1] || phaseInteractions.has(1);
  const shouldLoadPhase1 =
    !!dbProjectId && dbProjectId !== "default" && isPhase1Visible;

  const {
    data: requirementsItems = [],
    isLoading: isLoadingPhase1Requirements,
  } = useQuery<any[]>({
    queryKey: [`/api/sdlc/projects/${dbProjectId}/phases/1/requirements`],
    enabled: shouldLoadPhase1,
    staleTime: 2 * 60 * 1000,
    gcTime: 5 * 60 * 1000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
  });

  const { data: documentsItems = [], isLoading: isLoadingPhase1Documents } =
    useQuery<any[]>({
      queryKey: [`/api/sdlc/projects/${dbProjectId}/phases/1/documents`],
      enabled: shouldLoadPhase1,
      staleTime: 2 * 60 * 1000,
      gcTime: 5 * 60 * 1000,
      refetchOnMount: false,
      refetchOnWindowFocus: false,
    });

  // Track Phase 1 loading completion
  const isPhase1Loading =
    isLoadingPhase1Requirements || isLoadingPhase1Documents;
  useEffect(() => {
    if (shouldLoadPhase1 && !isPhase1Loading) {
      setPhaseLoadingComplete((prev) => ({ ...prev, 1: true }));
    }
  }, [shouldLoadPhase1, isPhase1Loading]);

  // Fetch design guidelines count from database for Phase 2
  // Phase 2 loads sequentially after Phase 1 completes
  const isPhase2Visible = phaseInteractions.has(2);
  const shouldLoadPhase2 =
    !!dbProjectId &&
    dbProjectId !== "default" &&
    isPhase2Visible &&
    phaseLoadingComplete[1];

  const {
    data: designGuidelinesCount = 0,
    isLoading: isLoadingPhase2Guidelines,
  } = useQuery<number>({
    queryKey: [
      `/api/sdlc/projects/${dbProjectId}/design-guidelines`,
      dbProjectId,
    ],
    queryFn: async () => {
      if (!dbProjectId || dbProjectId === "default") return 0;

      const response = await fetch(
        getApiUrl(`/api/sdlc/projects/${dbProjectId}/design-guidelines`),
      );
      if (!response.ok) return 0;
      const data = await response.json();
      return Array.isArray(data) ? data.length : 0;
    },
    enabled: shouldLoadPhase2,
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
  });

  // Fetch design mappings count from database for Phase 2 UI/UX feature
  const {
    data: designMappingsCount = 0,
    refetch: refetchDesignMappingsCount,
    isLoading: isLoadingPhase2Mappings,
  } = useQuery<number>({
    queryKey: [`/api/design-mapping/count`, apiProjectId || dbProjectId],
    queryFn: async () => {
      const fetchId = apiProjectId || dbProjectId;
      console.log(
        `[DEBUG] Fetching design mappings count for project: ${fetchId}`,
      );
      if (!fetchId || fetchId === "default") return 0;

      const response = await apiRequest(
        "GET",
        `/api/design-mapping/${fetchId}`,
      );
      const data = await response.json();
      const count = Array.isArray(data) ? data.length : 0;
      setSavedDesignMappings(Array.isArray(data) ? data : []);
      console.log(`[DEBUG] Design mappings count result: ${count}`);
      return count;
    },
    enabled: shouldLoadPhase2,
    staleTime: 2 * 60 * 1000, // Consider data fresh for 2 minutes
    gcTime: 5 * 60 * 1000,
    refetchOnMount: false, // Don't refetch on mount if data is fresh
    refetchOnWindowFocus: false,
  });

  // Refetch design mappings count when project changes
  useEffect(() => {
    console.log(`[DEBUG] Project changed, dbProjectId: ${dbProjectId}`);
    if (dbProjectId && dbProjectId !== "default") {
      console.log(
        `[DEBUG] Refetching design mappings count for project: ${dbProjectId}`,
      );
      refetchDesignMappingsCount();
    }
  }, [dbProjectId, refetchDesignMappingsCount]);

  // Fetch design assets count for Phase 2
  const { data: designAssetsCount = 0, isLoading: isLoadingPhase2Assets } =
    useQuery<number>({
      queryKey: [
        `/api/ado/epics_with_figma_count`,
        selectedAdoProject?.id,
        selectedAdoProject?.organizationUrl,
      ],
      queryFn: async () => {
        if (!selectedAdoProject?.id || !selectedAdoProject?.organizationUrl)
          return 0;

        const params = new URLSearchParams();
        if (dbProjectId) params.append("projectId", dbProjectId);
        if (selectedAdoProject.id)
          params.append("adoProjectId", selectedAdoProject.id);
        if (selectedAdoProject.organizationUrl)
          params.append("organization", selectedAdoProject.organizationUrl);
        if (selectedAdoProject.name)
          params.append("projectName", selectedAdoProject.name);

        const response = await fetch(
          getApiUrl(`/api/ado/epics_with_figma?${params.toString()}`),
          {
            method: "GET",
            credentials: "include",
            headers: {
              "Cache-Control": "no-cache",
              Pragma: "no-cache",
            },
          },
        );

        if (!response.ok) return 0;
        const data = await response.json();
        return Array.isArray(data) ? data.length : 0;
      },
      enabled:
        !!selectedAdoProject?.id &&
        !!selectedAdoProject?.organizationUrl &&
        shouldLoadPhase2 &&
        !isJira,
      staleTime: 5 * 60 * 1000,
      gcTime: 10 * 60 * 1000,
      refetchOnMount: false,
      refetchOnWindowFocus: false,
    });

  // Track Phase 2 loading completion
  const isPhase2Loading =
    isLoadingPhase2Guidelines ||
    isLoadingPhase2Mappings ||
    isLoadingPhase2Assets;
  useEffect(() => {
    if (shouldLoadPhase2 && !isPhase2Loading) {
      setPhaseLoadingComplete((prev) => ({ ...prev, 2: true }));
    }
  }, [shouldLoadPhase2, isPhase2Loading]);

  // Fetch backlog context for Development phase (Phase 3) state counts
  const backlogParams = new URLSearchParams();
  if (activeAdoProject?.organization) {
    backlogParams.append("organization", activeAdoProject.organization);
  }
  if (activeAdoProject?.name) {
    backlogParams.append("projectName", activeAdoProject.name);
  }
  const backlogQueryString = backlogParams.toString();

  // Fetch ADO config for backlog context (only when ADO project is selected)
  // Phase 3 loads sequentially after Phase 2 completes
  const isPhase3Visible = phaseInteractions.has(3);
  const isPhase4Visible = phaseInteractions.has(4);
  const isPhase5Visible = phaseInteractions.has(5);
  const isPhase6Visible = phaseInteractions.has(6);
  const isPhase7Visible = phaseInteractions.has(7);
  const shouldFetchAdoConfig =
    (isPhase3Visible ||
      isPhase4Visible ||
      isPhase5Visible ||
      isPhase6Visible ||
      isPhase7Visible) &&
    phaseLoadingComplete[2];

  const { data: adoConfig, isLoading: isLoadingAdoConfig } = useQuery<{
    hasConfig: boolean;
    organization: string;
    project: string;
  }>({
    queryKey: [
      `/api/sdlc/projects/${apiProjectId}/ado-config`,
      backlogQueryString,
    ],
    queryFn: async () => {
      const configUrl = getApiUrl(
        `/api/sdlc/projects/${apiProjectId}/ado-config${backlogQueryString ? `?${backlogQueryString}` : ""
        }`,
      );
      const configRes = await fetch(configUrl, { credentials: "include" });
      if (!configRes.ok)
        return { hasConfig: false, organization: "", project: "" };
      return configRes.json();
    },
    enabled: !!apiProjectId && !!activeAdoProject && shouldFetchAdoConfig && !isJira,
    staleTime: 10 * 60 * 1000,
    gcTime: 15 * 60 * 1000,
    retry: 1,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
  });

  const hasAdoConfig = adoConfig?.hasConfig || false;
  const { data: gitProviderConfig } = useQuery<{ provider?: "github" | "ado" | "gitlab" }>({
    queryKey: ["/api/projects", apiProjectId, "git-config-provider"],
    queryFn: async () => {
      if (!apiProjectId) return {};
      const res = await fetch(getApiUrl(`/api/projects/${apiProjectId}/git-config`), {
        credentials: "include",
      });
      if (!res.ok) return {};
      return res.json();
    },
    enabled: !!apiProjectId,
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });
  const { data: effectiveIntegrations } = useQuery<{
    integrations?: Array<{
      categoryKey: string;
      providerKey?: string | null;
      displayName?: string | null;
      source?: string;
      testStatus?: string | null;
    }>;
  }>({
    queryKey: ["/api/projects", apiProjectId, "integration-effective"],
    queryFn: async () => {
      if (!apiProjectId) return { integrations: [] };
      const res = await fetch(getApiUrl(`/api/projects/${apiProjectId}/integration-effective`), {
        credentials: "include",
      });
      if (!res.ok) return { integrations: [] };
      return res.json();
    },
    enabled: !!apiProjectId,
    staleTime: 2 * 60 * 1000,
    retry: 1,
  });

  const cicdProviderKey =
    effectiveIntegrations?.integrations?.find((item) => item.categoryKey === "cicd")?.providerKey || "";
  const repoProviderKey =
    effectiveIntegrations?.integrations?.find((item) => item.categoryKey === "repo")?.providerKey || "";
  const repoProviderSegment =
    repoProviderKey === "gitlab"
      ? "gitlab"
      : repoProviderKey === "bitbucket"
        ? "bitbucket"
        : repoProviderKey === "github"
          ? "github"
          : null;

  // Build/Deployment SDLC APIs require an explicit CI/CD integration (skipped cicd must not fall back to repo).
  const cicdProviderSegment =
    cicdProviderKey === "gitlab_ci"
      ? "gitlab"
      : cicdProviderKey === "bitbucket_pipelines"
        ? "bitbucket"
        : cicdProviderKey === "github_actions"
          ? "github"
          : cicdProviderKey === "azure_pipelines"
            ? "ado"
            : null;

  const hasCiCdConfig = !!cicdProviderSegment;

  // Backlog / git context may use repo or legacy org routing.
  const devOpsProviderSegment =
    cicdProviderSegment ??
    (repoProviderSegment ??
      (String(globalSelectedOrganization?.sourceType || "") === "gitlab" || gitProviderConfig?.provider === "gitlab"
            ? "gitlab"
            : "ado"));

  // Build & Deployment cards: CI/CD integration only (skipped cicd must not use repo fallback).
  const buildDeploySegment =
    hasCiCdConfig && cicdProviderSegment
      ? cicdProviderSegment
      : hasAdoConfig
        ? "ado"
        : undefined;
  const pipelineStudioProviderSegment =
    buildDeploySegment && buildDeploySegment !== "ado"
      ? buildDeploySegment
      : !adoAllowed && repoProviderSegment
        ? repoProviderSegment
        : null;

  const isGitLabProvider = cicdProviderSegment === "gitlab";
  const isBitbucketProvider = cicdProviderSegment === "bitbucket";
  const isGithubProvider = cicdProviderSegment === "github";
  const nonAdoCiSegment = isGitLabProvider || isBitbucketProvider || isGithubProvider;
  const devOpsDataReady =
    !!activeAdoProject || nonAdoCiSegment || hasCiCdConfig || !!buildDeploySegment;
  const externalCiMaintenancePrefix = isGitLabProvider ? "gitlab" : isBitbucketProvider ? "bitbucket" : isGithubProvider ? "github" : null;
  const hasDevOpsConfig = hasCiCdConfig || hasAdoConfig;
  const hasBuildDeployConfig =
    hasCiCdConfig ||
    (!!activeAdoProject && hasAdoConfig && buildDeploySegment === "ado");
  const canRunBuild = !!apiProjectId && !!buildDeploySegment && hasBuildDeployConfig;
  const canOpenPipelineStudio = !!apiProjectId && (adoAllowed || !!pipelineStudioProviderSegment);
  const showBuildProviderSetup =
    !!(selectedAdoProject || projectId || urlProjectId) &&
    !!apiProjectId &&
    (!canRunBuild || !canOpenPipelineStudio);
  const buildProviderSetupProjectName =
    projectName || selectedAdoProject?.name || projectData?.project?.name || "";
  const openProjectIntegrationSetup = () => {
    const params = new URLSearchParams();
    if (urlOrganizationId) params.set("orgId", urlOrganizationId);
    if (buildProviderSetupProjectName) params.set("search", buildProviderSetupProjectName);
    setLocation(`/projects${params.toString() ? `?${params.toString()}` : ""}`);
  };

  // Fetch backlog context for state counts (only when ADO project is selected and configured)
  interface BacklogContextResponse {
    availableStates?: string[];
    stateCounts: Record<
      string,
      {
        epics: number;
        features: number;
        userStories: number;
        total: number;
      }
    >;
    developerAssignments?: Array<{
      displayName: string;
      totalStories: number;
      storiesByState: Record<string, number>;
      totalStoryPoints: number;
      completedStoryPoints: number;
      stories: Array<{
        id: number;
        title: string;
        state: string;
        storyPoints: number | null;
      }>;
    }>;
    velocity?: {
      last7Days: number;
      last30Days: number;
      totalStoryPoints: number;
      completedStoryPoints: number;
      completionRate: number;
    };
  }

  // Phase 3 loads sequentially after Phase 2 completes (ADO/external CI + Jira)
  const shouldLoadPhase3 =
    !!apiProjectId &&
    isPhase3Visible &&
    phaseLoadingComplete[2] &&
    (
      (isJira && !!dbProjectId && dbProjectId !== "default") ||
      (
        devOpsDataReady &&
        hasDevOpsConfig &&
        ((!!activeAdoProject && hasAdoConfig) || isGitLabProvider || isBitbucketProvider || isGithubProvider)
      )
    );

  const { data: backlogData, isLoading: isLoadingPhase3Backlog } =
    useQuery<BacklogContextResponse>({
      queryKey: [
        "/api/sdlc/projects",
        apiProjectId,
        `${devOpsProviderSegment}/backlog-context`,
        activeAdoProject?.organization,
        activeAdoProject?.name,
      ],
      queryFn: async () => {
        if (!hasDevOpsConfig) {
          return { stateCounts: {} };
        }
        const backlogUrl = getApiUrl(
          `/api/sdlc/projects/${apiProjectId}/${devOpsProviderSegment}/backlog-context${backlogQueryString ? `?${backlogQueryString}` : ""
          }`,
        );
        const backlogRes = await fetch(backlogUrl, { credentials: "include" });
        if (!backlogRes.ok) {
          return { stateCounts: {} };
        }
        return backlogRes.json();
      },
      enabled: shouldLoadPhase3 && !isJira,
      staleTime: 5 * 60 * 1000,
      retry: 1,
      refetchOnMount: false,
      refetchOnWindowFocus: false,
    });

  // Fetch Jira backlog context for Phase 3 Development card (parallel to ADO)
  const { data: jiraPhase3BacklogData, isLoading: isLoadingJiraPhase3Backlog } =
    useQuery<BacklogContextResponse>({
      queryKey: [
        "/api/sdlc/projects",
        dbProjectId,
        "jira/backlog-context-phase3",
      ],
      queryFn: async () => {
        const url = getApiUrl(`/api/sdlc/projects/${dbProjectId}/jira/backlog-context`);
        const res = await fetch(url, { credentials: "include" });
        if (!res.ok) return { stateCounts: {} };
        return res.json();
      },
      enabled: isJira && !!dbProjectId && dbProjectId !== "default" && isPhase3Visible && phaseLoadingComplete[2],
      staleTime: 5 * 60 * 1000,
      retry: 1,
      refetchOnMount: false,
      refetchOnWindowFocus: false,
    });

  // Merged Phase 3 backlog data — use Jira when isJira, ADO otherwise
  const phase3BacklogData = isJira ? jiraPhase3BacklogData : backlogData;

  // Track Phase 3 loading completion
  const isPhase3Loading = isJira ? isLoadingJiraPhase3Backlog : (isLoadingAdoConfig || isLoadingPhase3Backlog);
  useEffect(() => {
    if (shouldLoadPhase3 && !isPhase3Loading && (hasDevOpsConfig || isJira)) {
      setPhaseLoadingComplete((prev) => ({ ...prev, 3: true }));
    }
  }, [shouldLoadPhase3, isPhase3Loading, hasDevOpsConfig, isJira]);

  // Fetch builds data for Build & Testing phase
  interface PipelineRun {
    id: number;
    buildNumber: string;
    status: string;
    result: string;
    finishTime?: string;
    jobs?: any[];
  }

  const buildPhaseDataEnabled =
    !!apiProjectId &&
    !!buildDeploySegment &&
    hasBuildDeployConfig &&
    ((buildDeploySegment === "ado" && !!activeAdoProject && hasAdoConfig) ||
      (buildDeploySegment !== "ado" && hasCiCdConfig));

  // Phase 4 loads sequentially after Phase 3 completes
  const shouldLoadPhase4 =
    buildPhaseDataEnabled &&
    isPhase4Visible &&
    phaseLoadingComplete[3];

  const { data: buildsData, isLoading: isLoadingPhase4Builds } = useQuery<{
    value: PipelineRun[];
  }>({
    queryKey: [
      "/api/sdlc/projects",
      apiProjectId,
      `${buildDeploySegment}/builds`,
      backlogQueryString,
      activeAdoProject?.organization,
      activeAdoProject?.name,
    ],
    queryFn: async () => {
      if (!hasBuildDeployConfig || !buildDeploySegment) {
        return { value: [] };
      }
      const buildsUrl = getApiUrl(
        `/api/sdlc/projects/${apiProjectId}/${buildDeploySegment}/builds${backlogQueryString ? `?${backlogQueryString}` : ""
        }`,
      );
      const buildsRes = await fetch(buildsUrl, { credentials: "include" });
      if (!buildsRes.ok) {
        return { value: [] };
      }
      return buildsRes.json();
    },
    enabled: shouldLoadPhase4 || (isPhase5Visible && buildPhaseDataEnabled),
    staleTime: 2 * 60 * 1000,
    gcTime: 5 * 60 * 1000,
    retry: 1,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
  });

  interface BuildPublishSummary {
    publishedArtifacts: number;
    buildsCheckedForArtifacts: number;
    buildsWithArtifacts: number;
    completedBuilds: number;
    succeededBuilds: number;
    failedBuilds: number;
    successRatePercent: number;
  }

  const { data: buildPublishSummary, isLoading: isLoadingBuildPublishSummary } =
    useQuery<BuildPublishSummary>({
      queryKey: [
        "/api/sdlc/projects",
        apiProjectId,
        `${buildDeploySegment}/build-publish-summary`,
        activeAdoProject?.organization,
        activeAdoProject?.name,
      ],
      queryFn: async () => {
        if (!hasBuildDeployConfig || !buildDeploySegment) {
          return {
            publishedArtifacts: 0,
            buildsCheckedForArtifacts: 0,
            buildsWithArtifacts: 0,
            completedBuilds: 0,
            succeededBuilds: 0,
            failedBuilds: 0,
            successRatePercent: 0,
          };
        }
        const params = new URLSearchParams();
        if (activeAdoProject?.organization) params.append("organization", activeAdoProject.organization);
        if (activeAdoProject.name) params.append("projectName", activeAdoProject.name);
        const url = getApiUrl(
          `/api/sdlc/projects/${apiProjectId}/${buildDeploySegment}/build-publish-summary${params.toString() ? `?${params.toString()}` : ""}`,
        );
        const res = await fetch(url, { credentials: "include" });
        if (!res.ok) {
          return {
            publishedArtifacts: 0,
            buildsCheckedForArtifacts: 0,
            buildsWithArtifacts: 0,
            completedBuilds: 0,
            succeededBuilds: 0,
            failedBuilds: 0,
            successRatePercent: 0,
          };
        }
        return res.json();
      },
      enabled: shouldLoadPhase4 || (isPhase5Visible && buildPhaseDataEnabled),
      staleTime: 2 * 60 * 1000,
      gcTime: 5 * 60 * 1000,
      retry: 1,
      refetchOnMount: false,
      refetchOnWindowFocus: false,
    });

  // Fetch pipeline definitions (pipelines) for Build & Testing phase
  interface Pipeline {
    id: number;
    name: string;
    path?: string;
    url?: string;
  }

  const { data: pipelinesData, isLoading: isLoadingPhase4Pipelines } =
    useQuery<{ value: Pipeline[] }>({
      queryKey: [
        "/api/sdlc/projects",
        apiProjectId,
        `${buildDeploySegment}/pipelines`,
        backlogQueryString,
        activeAdoProject?.organization,
        activeAdoProject?.name,
      ],
      queryFn: async () => {
        if (!hasBuildDeployConfig || !buildDeploySegment) {
          return { value: [] };
        }
        // Build query params with ADO project info
        const params = new URLSearchParams();
        if (activeAdoProject?.organization) {
          params.append("organization", activeAdoProject.organization);
        }
        if (activeAdoProject?.name) {
          params.append("projectName", activeAdoProject.name);
        }
        const pipelinesUrl = getApiUrl(
          `/api/sdlc/projects/${apiProjectId}/${buildDeploySegment}/pipelines${params.toString() ? `?${params.toString()}` : ""
          }`,
        );
        const pipelinesRes = await fetch(pipelinesUrl, {
          credentials: "include",
        });
        if (!pipelinesRes.ok) {
          return { value: [] };
        }
        const data = await pipelinesRes.json();
        // Handle both array and { value: [] } formats
        if (Array.isArray(data)) {
          return { value: data };
        }
        return data.value ? data : { value: [] };
      },
      enabled: shouldLoadPhase4 || (isPhase5Visible && buildPhaseDataEnabled),
      staleTime: 5 * 60 * 1000, // Pipeline definitions change less frequently
      gcTime: 10 * 60 * 1000,
      retry: 1,
      refetchOnMount: false,
      refetchOnWindowFocus: false,
    });

  // Fetch test runs data for Build & Testing phase
  interface TestRun {
    id: number;
    name: string;
    state: string;
    totalTests?: number;
    passedTests?: number;
    failedTests?: number;
  }

  const { data: testRunsData, isLoading: isLoadingPhase4TestRuns } = useQuery<{
    value: TestRun[];
  }>({
    queryKey: [
      "/api/sdlc/projects",
      apiProjectId,
      `${buildDeploySegment}/test-runs`,
      backlogQueryString,
      activeAdoProject?.organization,
      activeAdoProject?.name,
    ],
    queryFn: async () => {
      if (!hasBuildDeployConfig || !buildDeploySegment) {
        return { value: [] };
      }
      const testRunsUrl = getApiUrl(
        `/api/sdlc/projects/${apiProjectId}/${buildDeploySegment}/test-runs${backlogQueryString ? `?${backlogQueryString}` : ""
        }`,
      );
      const testRunsRes = await fetch(testRunsUrl, { credentials: "include" });
      if (!testRunsRes.ok) {
        return { value: [] };
      }
      const data = await testRunsRes.json();
      // Handle both array and { value: [] } formats
      if (Array.isArray(data)) {
        return { value: data };
      }
      return data?.value ? data : { value: [] };
    },
    enabled:
      shouldLoadPhase4 ||
      (isPhase5Visible && buildPhaseDataEnabled),
    staleTime: 2 * 60 * 1000,
    retry: 1,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
  });

  // Track Phase 4 loading completion
  const isPhase4Loading =
    isLoadingPhase4Builds ||
    isLoadingPhase4Pipelines ||
    isLoadingPhase4TestRuns;
  useEffect(() => {
    const phase4Triggered = shouldLoadPhase4 || (isPhase5Visible && buildPhaseDataEnabled);
    if (phase4Triggered && !isPhase4Loading) {
      setPhaseLoadingComplete((prev) => ({ ...prev, 4: true }));
    }
  }, [shouldLoadPhase4, isPhase5Visible, buildPhaseDataEnabled, isPhase4Loading]);

  // Fetch releases data for Deployment phase
  interface Release {
    id: number;
    name: string;
    status: string;
    createdOn?: string;
  }

  // Deployment data loads when Deployment phase is visible.
  const shouldLoadDeploymentPhase =
    buildPhaseDataEnabled &&
    isPhase6Visible &&
    hasBuildDeployConfig &&
    (phaseLoadingComplete[4] || !isPhase4Visible) &&
    phaseInteractions.has(6);

  const { data: releasesData, isLoading: isLoadingPhase5Releases } = useQuery<{
    value: Release[];
  }>({
    queryKey: [
      "/api/sdlc/projects",
      apiProjectId,
      `${buildDeploySegment}/releases`,
      backlogQueryString,
      activeAdoProject?.organization,
      activeAdoProject?.name,
    ],
    queryFn: async () => {
      if (!hasBuildDeployConfig || !buildDeploySegment) {
        return { value: [] };
      }
      // Build query params with ADO project info
      const params = new URLSearchParams();
      if (activeAdoProject?.organization) {
        params.append("organization", activeAdoProject.organization);
      }
      if (activeAdoProject?.name) {
        params.append("projectName", activeAdoProject.name);
      }
      const releasesUrl = getApiUrl(
        `/api/sdlc/projects/${apiProjectId}/${buildDeploySegment}/releases${params.toString() ? `?${params.toString()}` : ""
        }`,
      );
      const releasesRes = await fetch(releasesUrl, { credentials: "include" });
      if (!releasesRes.ok) {
        return { value: [] };
      }
      const data = await releasesRes.json();
      // Handle both array and { value: [] } formats
      if (Array.isArray(data)) {
        return { value: data };
      }
      return data.value ? data : { value: [] };
    },
    enabled: shouldLoadDeploymentPhase,
    staleTime: 2 * 60 * 1000,
    retry: 1,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
  });

  // Fetch deployments data for Deployment Status count
  interface Deployment {
    id: number;
    releaseId: number;
    releaseName: string;
    environmentId: number;
    environmentName: string;
    deploymentStatus: string;
    startedOn: string;
    completedOn?: string;
  }

  const { data: deploymentsData, isLoading: isLoadingPhase5Deployments } =
    useQuery<{ value: Deployment[] }>({
      queryKey: [
        "/api/sdlc/projects",
        apiProjectId,
        `${buildDeploySegment}/deployments`,
        backlogQueryString,
        activeAdoProject?.organization,
        activeAdoProject?.name,
      ],
      queryFn: async () => {
        if (!hasBuildDeployConfig || !buildDeploySegment) {
          return { value: [] };
        }
        const deploymentsUrl = getApiUrl(
          `/api/sdlc/projects/${apiProjectId}/${buildDeploySegment}/deployments${backlogQueryString ? `?${backlogQueryString}` : ""
          }`,
        );
        const deploymentsRes = await fetch(deploymentsUrl, {
          credentials: "include",
        });
        if (!deploymentsRes.ok) {
          return { value: [] };
        }
        const data = await deploymentsRes.json();
        // Handle both array and { value: [] } formats
        if (Array.isArray(data)) {
          return { value: data };
        }
        return data?.value ? data : { value: [] };
      },
      enabled: shouldLoadDeploymentPhase,
      staleTime: 2 * 60 * 1000,
      retry: 1,
      refetchOnMount: false,
      refetchOnWindowFocus: false,
    });

  // Fetch release artifacts data for Trigger Release count
  interface ReleaseArtifact {
    id: number;
    name: string;
    version: string;
    definitionId: number;
    definitionName: string;
    createdOn: string;
    environments: Array<{
      id: number;
      name: string;
      status?: string;
    }>;
    artifacts: any[];
    status: string;
  }

  const { data: releaseArtifactsData, isLoading: isLoadingPhase5Artifacts } =
    useQuery<ReleaseArtifact[]>({
      queryKey: [
        "/api/sdlc/projects",
        apiProjectId,
        `${buildDeploySegment}/release-artifacts`,
        backlogQueryString,
        activeAdoProject?.organization,
        activeAdoProject?.name,
      ],
      queryFn: async () => {
        if (!hasBuildDeployConfig || !buildDeploySegment) {
          return [];
        }
        const params = new URLSearchParams();
        if (activeAdoProject?.organization)
          params.append("organization", activeAdoProject.organization);
        if (activeAdoProject?.name)
          params.append("projectName", activeAdoProject.name);
        const artifactsUrl = getApiUrl(
          `/api/sdlc/projects/${apiProjectId}/${buildDeploySegment}/release-artifacts?${params.toString()}`,
        );
        const artifactsRes = await fetch(artifactsUrl, {
          credentials: "include",
        });
        if (!artifactsRes.ok) {
          return [];
        }
        const data = await artifactsRes.json();
        // Handle both array and { value: [] } formats
        if (Array.isArray(data)) {
          return data;
        }
        return Array.isArray(data?.value) ? data.value : [];
      },
      enabled: shouldLoadDeploymentPhase,
      staleTime: 2 * 60 * 1000,
      retry: 1,
      refetchOnMount: false,
      refetchOnWindowFocus: false,
    });

  // Track Phase 5 loading completion
  const isPhase5Loading =
    isLoadingPhase5Releases ||
    isLoadingPhase5Deployments ||
    isLoadingPhase5Artifacts;
  useEffect(() => {
    if (shouldLoadDeploymentPhase && !isPhase5Loading) {
      setPhaseLoadingComplete((prev) => ({ ...prev, 5: true }));
    }
  }, [shouldLoadDeploymentPhase, isPhase5Loading]);

  // Phase 7 (Maintenance) queries should not be blocked if Deployment was skipped/not visible.
  const shouldLoadPhase6 =
    buildPhaseDataEnabled &&
    isPhase7Visible &&
    (phaseLoadingComplete[5] || !isPhase5Visible) &&
    ((!!activeAdoProject && hasAdoConfig && phaseInteractions.has(7)) || isGitLabProvider || isBitbucketProvider || isGithubProvider);

  // Fetch monitoring data for Maintenance phase
  interface SystemMetrics {
    systemHealth?: number;
    services?: any[] | { running?: number; total?: number };
    cpu?: any;
    memory?: any;
  }

  const { data: monitoringData, isLoading: isLoadingPhase6Monitoring } =
    useQuery<SystemMetrics>({
      queryKey: [
        "/api/sdlc/projects",
        apiProjectId,
        "ado/monitoring",
        activeAdoProject?.organization,
        activeAdoProject?.name,
      ],
      queryFn: async () => {
        if (!hasDevOpsConfig || !devOpsDataReady) {
          return {};
        }
        // Build query params with ADO project info
        const params = new URLSearchParams();
        if (activeAdoProject?.organization) {
          params.append("organization", activeAdoProject.organization);
        }
        if (activeAdoProject?.name) {
          params.append("projectName", activeAdoProject.name);
        }
        const monitoringUrl = getApiUrl(
          `/api/sdlc/projects/${apiProjectId}/${devOpsProviderSegment}/monitoring${params.toString() ? `?${params.toString()}` : ""
          }`,
        );
        const monitoringRes = await fetch(monitoringUrl, {
          credentials: "include",
        });
        if (!monitoringRes.ok) {
          return {};
        }
        return monitoringRes.json();
      },
      enabled: shouldLoadPhase6,
      staleTime: 2 * 60 * 1000,
      retry: 1,
      refetchOnMount: false,
      refetchOnWindowFocus: false,
    });

  // Fetch deployment summary for Deployment phase (phase 6)
  interface DeploymentSummary {
    totalReleases: number;
    successfulReleases: number;
    failedReleases: number;
    pendingReleases: number;
    recentReleases: any[];
    /** ADO $top used for the summary fetch (not a time window). */
    releasesPageSize?: number;
  }

  const { data: deploymentSummaryData, isLoading: isLoadingDeploymentSummary } =
    useQuery<DeploymentSummary>({
      queryKey: [
        "/api/sdlc/projects",
        apiProjectId,
        `${buildDeploySegment}/deployment-summary`,
        backlogQueryString,
        activeAdoProject?.organization,
        activeAdoProject?.name,
      ],
      queryFn: async () => {
        if (!hasBuildDeployConfig || !buildDeploySegment) {
          return { totalReleases: 0, successfulReleases: 0, failedReleases: 0, pendingReleases: 0, recentReleases: [] };
        }
        const params = new URLSearchParams();
        if (activeAdoProject?.organization) params.append("organization", activeAdoProject.organization);
        if (activeAdoProject?.name) params.append("projectName", activeAdoProject.name);
        const url = getApiUrl(
          `/api/sdlc/projects/${apiProjectId}/${buildDeploySegment}/deployment-summary${params.toString() ? `?${params.toString()}` : ""}`,
        );
        const res = await fetch(url, { credentials: "include" });
        if (!res.ok) return { totalReleases: 0, successfulReleases: 0, failedReleases: 0, pendingReleases: 0, recentReleases: [] };
        return res.json();
      },
      enabled: shouldLoadPhase6,
      staleTime: 2 * 60 * 1000,
      retry: 1,
      refetchOnMount: false,
      refetchOnWindowFocus: false,
    });

  const effectiveDeploymentSummary: DeploymentSummary =
    deploymentSummaryData || {
      totalReleases: 0,
      successfulReleases: 0,
      failedReleases: 0,
      pendingReleases: 0,
      recentReleases: [],
    };

  // Fetch bugs data for Maintenance phase
  interface BugsData {
    statistics?: {
      totalBugs?: number;
      resolved?: number;
      unresolved?: number;
      critical?: number;
      highPriority?: number;
    };
    totalBugs?: number;
    resolvedBugs?: number;
    criticalBugs?: number;
    highPriorityBugs?: number;
  }

  const { data: bugsData, isLoading: isLoadingPhase6Bugs } = useQuery<BugsData>(
    {
      queryKey: [
        "/api/sdlc/projects",
        apiProjectId,
        "maintenance/bugs",
        activeAdoProject?.organization,
        activeAdoProject?.name,
      ],
      queryFn: async () => {
        if (!hasDevOpsConfig || !devOpsDataReady) {
          return {};
        }
        // Build query params with ADO project info
        const params = new URLSearchParams();
        if (activeAdoProject?.organization) {
          params.append("organization", activeAdoProject.organization);
        }
        if (activeAdoProject?.name) {
          params.append("projectName", activeAdoProject.name);
        }
        const bugsEndpoint =
          externalCiMaintenancePrefix != null
            ? `/api/sdlc/projects/${apiProjectId}/${externalCiMaintenancePrefix}/maintenance/bugs`
            : `/api/sdlc/projects/${apiProjectId}/maintenance/bugs`;
        const bugsUrl = getApiUrl(
          `${bugsEndpoint}${params.toString() ? `?${params.toString()}` : ""
          }`,
        );
        const bugsRes = await fetch(bugsUrl, { credentials: "include" });
        if (!bugsRes.ok) {
          return {};
        }
        return bugsRes.json();
      },
      enabled: shouldLoadPhase6,
      staleTime: 5 * 60 * 1000,
      retry: 1,
      refetchOnMount: false,
      refetchOnWindowFocus: false,
    },
  );

  // Fetch alerts data for Maintenance phase
  interface AlertsData {
    totalAlerts?: number;
    activeAlerts?: number;
    resolvedAlerts?: number;
    statistics?: {
      activeAlerts?: number;
      pipelineFailures?: number;
      deploymentErrors?: number;
      environmentWarnings?: number;
      pendingApprovals?: number;
      rolloutIssues?: number;
      systemWarnings?: number;
    };
  }

  const { data: alertsData, isLoading: isLoadingPhase6Alerts } =
    useQuery<AlertsData>({
      queryKey: [
        "/api/sdlc/projects",
        apiProjectId,
        "maintenance/alerts",
        activeAdoProject?.organization,
        activeAdoProject?.name,
      ],
      queryFn: async () => {
        if (!hasDevOpsConfig || !devOpsDataReady) {
          return {};
        }
        // Build query params with ADO project info
        const params = new URLSearchParams();
        if (activeAdoProject?.organization) {
          params.append("organization", activeAdoProject.organization);
        }
        if (activeAdoProject?.name) {
          params.append("projectName", activeAdoProject.name);
        }
        const alertsEndpoint =
          externalCiMaintenancePrefix != null
            ? `/api/sdlc/projects/${apiProjectId}/${externalCiMaintenancePrefix}/maintenance/alerts`
            : `/api/sdlc/projects/${apiProjectId}/maintenance/alerts`;
        const alertsUrl = getApiUrl(
          `${alertsEndpoint}${params.toString() ? `?${params.toString()}` : ""
          }`,
        );
        const alertsRes = await fetch(alertsUrl, { credentials: "include" });
        if (!alertsRes.ok) {
          return {};
        }
        return alertsRes.json();
      },
      enabled: shouldLoadPhase6,
      staleTime: 5 * 60 * 1000,
      retry: 1,
      refetchOnMount: false,
      refetchOnWindowFocus: false,
    });

  // Fetch pipeline health data for Maintenance phase
  interface PipelineHealthData {
    successRate?: number;
    stabilityRating?: "excellent" | "good" | "fair" | "poor" | "unknown";
    totalRuns?: number;
    failedRuns?: number;
    succeededRuns?: number;
    statistics?: {
      totalRuns?: number;
      failedRuns?: number;
    };
  }

  const { data: pipelineHealthData, isLoading: isLoadingPhase6PipelineHealth } =
    useQuery<PipelineHealthData>({
      queryKey: [
        "/api/sdlc/projects",
        apiProjectId,
        "maintenance/pipeline-health",
        activeAdoProject?.organization,
        activeAdoProject?.name,
      ],
      queryFn: async () => {
        if (!hasDevOpsConfig || !devOpsDataReady) {
          return {};
        }
        const params = new URLSearchParams();
        if (activeAdoProject?.organization) {
          params.append("organization", activeAdoProject.organization);
        }
        if (activeAdoProject?.name) {
          params.append("projectName", activeAdoProject.name);
        }
        const pipelineHealthEndpoint =
          externalCiMaintenancePrefix != null
            ? `/api/sdlc/projects/${apiProjectId}/${externalCiMaintenancePrefix}/maintenance/pipeline-health`
            : `/api/sdlc/projects/${apiProjectId}/maintenance/pipeline-health`;
        const pipelineHealthUrl = getApiUrl(
          `${pipelineHealthEndpoint}${params.toString() ? `?${params.toString()}` : ""
          }`,
        );
        const pipelineHealthRes = await fetch(pipelineHealthUrl, {
          credentials: "include",
        });
        if (!pipelineHealthRes.ok) {
          return {};
        }
        return pipelineHealthRes.json();
      },
      enabled: shouldLoadPhase6,
      staleTime: 5 * 60 * 1000,
      retry: 1,
      refetchOnMount: false,
      refetchOnWindowFocus: false,
    });

  // Fetch deployment trends data for Maintenance phase
  interface DeploymentTrendsData {
    overallMetrics?: {
      totalDeployments?: number;
    };
  }

  const { data: deploymentTrendsData, isLoading: isLoadingPhase6Trends } =
    useQuery<DeploymentTrendsData>({
      queryKey: [
        "/api/sdlc/projects",
        apiProjectId,
        "maintenance/deployment-trends",
        activeAdoProject?.organization,
        activeAdoProject?.name,
      ],
      queryFn: async () => {
        if (!hasDevOpsConfig || !devOpsDataReady) {
          return {};
        }
        const params = new URLSearchParams();
        if (activeAdoProject?.organization) {
          params.append("organization", activeAdoProject.organization);
        }
        if (activeAdoProject?.name) {
          params.append("projectName", activeAdoProject.name);
        }
        const deploymentTrendsEndpoint =
          externalCiMaintenancePrefix != null
            ? `/api/sdlc/projects/${apiProjectId}/${externalCiMaintenancePrefix}/maintenance/deployment-trends`
            : `/api/sdlc/projects/${apiProjectId}/maintenance/deployment-trends`;
        const deploymentTrendsUrl = getApiUrl(
          `${deploymentTrendsEndpoint}${params.toString() ? `?${params.toString()}` : ""
          }`,
        );
        const deploymentTrendsRes = await fetch(deploymentTrendsUrl, {
          credentials: "include",
        });
        if (!deploymentTrendsRes.ok) {
          return {};
        }
        return deploymentTrendsRes.json();
      },
      enabled: shouldLoadPhase6,
      staleTime: 5 * 60 * 1000,
      retry: 1,
      refetchOnMount: false,
      refetchOnWindowFocus: false,
    });

  // Track Phase 6 loading completion
  const isPhase6Loading =
    isLoadingPhase6Monitoring ||
    isLoadingPhase6Bugs ||
    isLoadingPhase6Alerts ||
    isLoadingPhase6PipelineHealth ||
    isLoadingPhase6Trends;
  useEffect(() => {
    if (shouldLoadPhase6 && !isPhase6Loading) {
      setPhaseLoadingComplete((prev) => ({ ...prev, 6: true }));
    }
  }, [shouldLoadPhase6, isPhase6Loading]);

  // When arriving from Workflow ("save for later" redirect), force a fresh
  // refresh of the key SDLC data and show the loader even if React Query has
  // cached data for this project.
  useEffect(() => {
    if (!fromWorkflow || redirectHandledRef.current) return;
    redirectHandledRef.current = true;

    setRedirectLoading(true);

    if (urlProjectId) {
      queryClient.invalidateQueries({
        queryKey: ["/api/sdlc/projects", urlProjectId],
      });
    }

    if (workflowProjectId) {
      queryClient.invalidateQueries({
        queryKey: ["/api/workflow/artifacts", workflowProjectId],
      });
    }
  }, [fromWorkflow, urlProjectId, workflowProjectId]);

  // Stop the redirect loader once the relevant queries finish refetching.
  useEffect(() => {
    if (!redirectLoading) return;

    const stillFetching =
      isProjectFetching || sdlcProjectFetching || workflowArtifactsFetching;

    if (!stillFetching) {
      setRedirectLoading(false);
    }
  }, [
    redirectLoading,
    isProjectFetching,
    sdlcProjectFetching,
    workflowArtifactsFetching,
  ]);

  // Use artifacts directly from API response (already filtered by projectId on server)
  const workflowArtifactsForProject = workflowArtifactsData?.artifacts ?? [];

  // Filter workflow artifacts by selected BRD
  const filteredWorkflowArtifacts = useMemo(() => {
    if (!selectedBrd?.id) {
      return workflowArtifactsForProject;
    }
    // Filter artifacts that match the selected BRD
    return workflowArtifactsForProject.filter(
      (artifact: any) => artifact.brdId === selectedBrd.id,
    );
  }, [workflowArtifactsForProject, selectedBrd?.id]);

  // Prefer artifacts with matching projectId, but fall back to any artifact if none match
  // Use filtered artifacts if BRD is selected
  const latestWorkflowArtifact: WorkflowArtifact | null =
    (selectedBrd?.id
      ? filteredWorkflowArtifacts?.[0]
      : workflowArtifactsForProject?.[0]) ??
    workflowArtifactsData?.artifacts?.[0] ??
    null;
  const workflowEpics = Array.isArray(latestWorkflowArtifact?.epics)
    ? (latestWorkflowArtifact?.epics ?? [])
    : [];
  const workflowFeatures = Array.isArray(latestWorkflowArtifact?.features)
    ? (latestWorkflowArtifact?.features ?? [])
    : [];
  const workflowUserStories = Array.isArray(latestWorkflowArtifact?.userStories)
    ? (latestWorkflowArtifact?.userStories ?? [])
    : [];
  const workflowRequirementText = latestWorkflowArtifact?.requirement || null;
  const workflowWikiPages = Array.isArray(
    (latestWorkflowArtifact as any)?.wikiPages,
  )
    ? ((latestWorkflowArtifact as any).wikiPages as any[])
    : [];
  // Check if we have any artifacts (either with matching projectId or any artifact)
  const hasWorkflowArtifacts =
    !!latestWorkflowArtifact &&
    (workflowEpics.length > 0 ||
      workflowFeatures.length > 0 ||
      workflowUserStories.length > 0 ||
      !!workflowRequirementText);

  const artifactModifiedItems = latestWorkflowArtifact?.modifiedItems ?? null;
  const modifiedItemsCountFromJson =
    artifactModifiedItems && typeof artifactModifiedItems === "object"
      ? (artifactModifiedItems.epics?.length || 0) +
      (artifactModifiedItems.features?.length || 0) +
      (artifactModifiedItems.userStories?.length || 0)
      : undefined;
  const modifiedCountValue =
    latestWorkflowArtifact?.modifiedCount ?? modifiedItemsCountFromJson;
  const totalCountValue =
    latestWorkflowArtifact?.totalCount ??
    (latestWorkflowArtifact
      ? workflowEpics.length +
      workflowFeatures.length +
      workflowUserStories.length
      : undefined);
  const hasModifiedCounts =
    typeof modifiedCountValue === "number" &&
    typeof totalCountValue === "number" &&
    totalCountValue > 0;
  const modifiedBadgeLabel = hasModifiedCounts
    ? `${modifiedCountValue}/${totalCountValue} modified`
    : latestWorkflowArtifact?.modified !== undefined
      ? latestWorkflowArtifact.modified
        ? "Yes"
        : "No"
      : undefined;
  const modifiedBadgeVariant = hasModifiedCounts
    ? modifiedCountValue! > 0
      ? "destructive"
      : "secondary"
    : latestWorkflowArtifact?.modified
      ? "destructive"
      : "secondary";
  const shouldShowModifiedRow =
    hasModifiedCounts || latestWorkflowArtifact?.modified !== undefined;

  // Debug logging (can be removed later)
  useEffect(() => {
    if (workflowArtifactsData) {
    }
  }, [
    workflowArtifactsData,
    workflowProjectId,
    selectedAdoProject?.id,
    dbProjectId,
    hasWorkflowArtifacts,
    latestWorkflowArtifact,
    workflowEpics.length,
    workflowFeatures.length,
    workflowUserStories.length,
    workflowRequirementText,
    workflowArtifactsForProject.length,
  ]);

  // Fetch artifact organizations to get artifactOrgId
  // Only fetch when Phase 1 is visible (used for Phase 1 user stories)
  const { data: artifactOrgs = [] } = useQuery<any[]>({
    queryKey: ["/api/hub/artifacts/projects"],
    queryFn: async () => {
      const response = await fetch(getApiUrl("/api/hub/artifacts/projects"), {
        credentials: "include",
      });
      if (!response.ok) {
        console.warn(
          `Failed to fetch artifact organizations: ${response.status}`,
        );
        return [];
      }
      return await response.json();
    },
    enabled: !!activeAdoProject && isPhase1Visible && !isJira,
    retry: false,
    staleTime: 10 * 60 * 1000, // Artifact orgs rarely change
    gcTime: 30 * 60 * 1000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
  });

  // Find the artifactOrgId for the active ADO project
  const artifactOrgId = useMemo(() => {
    if (!activeAdoProject || !artifactOrgs.length) return null;

    // Try to match by project name and organization URL
    const matched = artifactOrgs.find((org: any) => {
      const orgName = org.name || org.projectName;
      const orgUrl = org.organizationUrl || "";
      const selectedOrgUrl = activeAdoProject.organizationUrl || "";

      return (
        orgName === activeAdoProject.name &&
        (orgUrl === selectedOrgUrl ||
          orgUrl.includes(activeAdoProject.organization))
      );
    });

    return matched?.artifactOrgId || matched?.id || null;
  }, [activeAdoProject, artifactOrgs]);

  // Fetch user stories from Azure DevOps using Hub Artifacts endpoint
  // Only fetch when Phase 1 is visible (used for Phase 1 user stories)
  const { data: adoWorkItems = [], isLoading: isLoadingAdoBacklog } = useQuery<
    any[]
  >({
    queryKey: [
      `/api/hub/artifacts/${activeAdoProject?.name}/work-items`,
      artifactOrgId,
      activeAdoProject?.organizationUrl,
    ],
    queryFn: async () => {
      if (!activeAdoProject?.name) return [];

      const params = new URLSearchParams();
      if (artifactOrgId) {
        params.append("artifactOrgId", artifactOrgId);
      } else if (activeAdoProject.organizationUrl) {
        params.append("organizationUrl", activeAdoProject.organizationUrl);
      }

      const url = `/api/hub/artifacts/${activeAdoProject.name}/work-items${params.toString() ? `?${params.toString()}` : ""
        }`;
      const response = await fetch(getApiUrl(url), { credentials: "include" });

      if (!response.ok) {
        console.warn(`Failed to fetch ADO work items: ${response.status}`);
        return [];
      }

      return await response.json();
    },
    enabled: !!activeAdoProject?.name && isPhase1Visible && !isJira,
    retry: false,
    staleTime: 2 * 60 * 1000,
    gcTime: 5 * 60 * 1000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
  });

  // Fetch work items from Jira when in Jira mode (mirrors ADO hub fetch above)
  const { data: jiraBacklogData, isLoading: isLoadingJiraBacklog } = useQuery<any>({
    queryKey: [`/api/sdlc/projects/${dbProjectId}/jira/backlog-context`],
    enabled: isJira && !!dbProjectId && dbProjectId !== "default" && isPhase1Visible,
    retry: false,
    staleTime: 2 * 60 * 1000,
    gcTime: 5 * 60 * 1000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
  });

  const jiraUserStories = useMemo(() => {
    if (!jiraBacklogData?.artifactsByState) return [];
    const items: any[] = [];
    Object.values(jiraBacklogData.artifactsByState).forEach((stateGroup: any) => {
      if (stateGroup.userStories) items.push(...stateGroup.userStories);
      if (stateGroup.features) items.push(...stateGroup.features);
      if (stateGroup.epics) items.push(...stateGroup.epics);
    });
    return items;
  }, [jiraBacklogData]);

  // Gate UI interactions on the cards until all required data finishes loading.
  // Avoid blocking the UI on background refetches of the ADO projects list
  // to prevent redundant loaders when returning to the SDLC page, but
  // explicitly include redirectLoading so that a redirect from Workflow
  // intentionally shows the loader even when data is cached.
  const disablePhaseInteractions =
    redirectLoading ||
    isLoading ||
    allProjectsLoading ||
    sdlcProjectLoading ||
    sdlcProjectFetching ||
    workflowArtifactsLoading ||
    workflowArtifactsFetching ||
    isLoadingAdoBacklog;

  // A project is considered selected only when we have a concrete projectId
  // (ADO project or SDLC project). When this is false, phase cards should
  // appear and behave as disabled ("dead cards").
  const isProjectSelected = !!(selectedAdoProject || projectId || urlProjectId);

  // Check if buttons should show skeleton loading (when project is changing or any phase is loading)
  const isButtonLoading =
    isProjectChanging ||
    disablePhaseInteractions ||
    sdlcProjectLoading ||
    sdlcProjectFetching ||
    workflowArtifactsLoading ||
    workflowArtifactsFetching;

  // Extract and flatten work items by type from hierarchical structure
  const extractWorkItemsByType = (items: any[], type: string): any[] => {
    const workItems: any[] = [];
    const seenIds = new Set<number>(); // Track unique IDs to prevent duplicates

    const traverse = (item: any) => {
      if (item.type === type) {
        // Only add if we haven't seen this ID before
        if (!seenIds.has(item.id)) {
          seenIds.add(item.id);
          workItems.push(item);
        }
      }
      // Recursively check linked items (children)
      if (item.linkedItems && Array.isArray(item.linkedItems)) {
        item.linkedItems.forEach(traverse);
      }
    };

    items.forEach(traverse);
    return workItems;
  };

  // Helper function to transform ADO work items to match workflow format
  const transformAdoWorkItem = (
    adoItem: any,
    itemType: "epic" | "feature" | "story",
  ) => {
    // Map ADO states to our internal status values
    const adoState = (
      adoItem.state ||
      adoItem.status ||
      adoItem?.fields?.["System.State"] ||
      ""
    ).toLowerCase();
    let mappedStatus = "planned"; // default

    if (
      adoState === "new" ||
      adoState === "proposed" ||
      adoState === "backlog"
    ) {
      mappedStatus = "backlog";
    } else if (
      adoState === "active" ||
      adoState === "in progress" ||
      adoState === "committed"
    ) {
      mappedStatus = "in-progress";
    } else if (
      adoState === "resolved" ||
      adoState === "closed" ||
      adoState === "done" ||
      adoState === "completed"
    ) {
      mappedStatus = "completed";
    } else if (adoState === "approved") {
      mappedStatus = "approved";
    }

    const baseItem = {
      id: `ado-${adoItem.id}`, // Prefix to avoid conflicts
      title: adoItem.title || "Untitled",
      description:
        adoItem.description || adoItem?.fields?.["System.Description"] || "",
      status: mappedStatus,
      priority: adoItem.priority
        ? adoItem.priority <= 2
          ? "high"
          : adoItem.priority === 3
            ? "medium"
            : "low"
        : "medium",
      assignedTo: adoItem.assignedTo || "",
      _isAdoItem: true, // Flag to identify ADO items
      _originalItem: adoItem, // Store original ADO data
      _adoId: adoItem.id, // Store original ADO ID
      _adoUrl: adoItem.url, // Store ADO URL
      _adoState: adoItem.state, // Store original ADO state for reference
    };

    if (itemType === "story") {
      return {
        ...baseItem,
        storyPoints: adoItem.storyPoints || null,
        featureId: null,
        epicId: null,
        personaId: null,
        acceptanceCriteria: [],
        subtasks: [],
      };
    } else if (itemType === "feature") {
      return {
        ...baseItem,
        epicId: null,
      };
    } else {
      // epic
      return baseItem;
    }
  };

  // Extract and transform ADO epics, features, and user stories
  const adoEpics = useMemo(() => {
    if (!adoWorkItems.length) return [];
    const extracted = extractWorkItemsByType(adoWorkItems, "Epic");
    return extracted.map((item) => transformAdoWorkItem(item, "epic"));
  }, [adoWorkItems]);

  const adoFeatures = useMemo(() => {
    if (!adoWorkItems.length) return [];
    const extracted = extractWorkItemsByType(adoWorkItems, "Feature");
    return extracted.map((item) => transformAdoWorkItem(item, "feature"));
  }, [adoWorkItems]);

  const adoUserStories = useMemo(() => {
    if (!adoWorkItems.length) return [];
    const extracted = extractWorkItemsByType(adoWorkItems, "User Story");
    return extracted.map((item) => transformAdoWorkItem(item, "story"));
  }, [adoWorkItems]);

  const getComparableAdoId = (item: any): string | null => {
    if (!item) return null;
    const candidate =
      item.adoWorkItemId ??
      item._adoId ??
      item.adoId ??
      (typeof item.id === "string" && item.id.startsWith("ado-")
        ? item.id.slice(4)
        : null);

    return candidate !== undefined && candidate !== null
      ? String(candidate)
      : null;
  };

  const mergeWorkflowAndAdoItems = (workflowItems: any[], adoItems: any[]) => {
    const safeWorkflowItems = Array.isArray(workflowItems) ? workflowItems : [];
    const safeAdoItems = Array.isArray(adoItems) ? adoItems : [];

    const workflowIds = new Set(
      safeWorkflowItems
        .map((item) => (item?.id ? String(item.id) : null))
        .filter((id): id is string => Boolean(id)),
    );

    const workflowAdoIds = new Set(
      safeWorkflowItems
        .map((item) => getComparableAdoId(item))
        .filter((id): id is string => Boolean(id)),
    );

    return [
      ...safeWorkflowItems,
      ...safeAdoItems.filter((adoItem) => {
        if (!adoItem) return false;
        const adoIdentifier = getComparableAdoId(adoItem);
        if (adoIdentifier && workflowAdoIds.has(adoIdentifier)) {
          return false;
        }

        const adoItemId = adoItem.id ? String(adoItem.id) : null;
        if (adoItemId && workflowIds.has(adoItemId)) {
          return false;
        }

        return true;
      }),
    ];
  };

  const combinedEpics = useMemo(
    () => mergeWorkflowAndAdoItems(workflowEpics, adoEpics),
    [workflowEpics, adoEpics],
  );

  const combinedFeatures = useMemo(
    () => mergeWorkflowAndAdoItems(workflowFeatures, adoFeatures),
    [workflowFeatures, adoFeatures],
  );

  const combinedUserStories = useMemo(
    () => {
      const merged = mergeWorkflowAndAdoItems(workflowUserStories, adoUserStories);
      if (isJira && jiraUserStories.length > 0) {
        const existingIds = new Set(merged.map((item: any) => item.id?.toString()));
        const uniqueJiraItems = jiraUserStories.filter(
          (item: any) => !existingIds.has(item.id?.toString())
        );
        return [...merged, ...uniqueJiraItems];
      }
      return merged;
    },
    [workflowUserStories, adoUserStories, isJira, jiraUserStories],
  );

  // Filter data based on selected BRD and Requirement
  // Filter requirements based on selected BRD/Requirement
  const filteredRequirementsItems = useMemo(() => {
    if (!selectedBrd?.id && !selectedRequirement?.id) {
      return requirementsItems; // Show all if no filter
    }

    let filtered = requirementsItems;

    // Filter by BRD: only show requirements linked to the selected BRD
    if (selectedBrd?.id && brdLinkedRequirements.length > 0) {
      filtered = filtered.filter((req: any) => {
        // Match by requirement name from devBrdRequirements
        return brdLinkedRequirements.some(
          (linkedReqName: string) =>
            req.title?.toLowerCase().includes(linkedReqName.toLowerCase()) ||
            linkedReqName.toLowerCase().includes(req.title?.toLowerCase()),
        );
      });
    }

    // Filter by Requirement: only show the selected requirement
    if (selectedRequirement?.id) {
      filtered = filtered.filter(
        (req: any) => req.id === selectedRequirement.id,
      );
    }

    return filtered;
  }, [
    requirementsItems,
    selectedBrd?.id,
    selectedRequirement?.id,
    brdLinkedRequirements,
  ]);

  // Filter documents based on selected BRD/Requirement
  // Note: Documents don't have brdId/requirementId yet, so for now show all if no filter
  // TODO: Add brdId/requirementId to documents when schema is updated
  const filteredDocumentsItems = useMemo(() => {
    // For now, return all documents since linking fields aren't in schema yet
    // Once schema is updated with brdId/requirementId, filter here
    return documentsItems;
  }, [documentsItems, selectedBrd?.id, selectedRequirement?.id]);

  // Filter user stories based on selected BRD (workflow artifacts already filtered by brdId)
  // ADO user stories don't have BRD linking, so we show all ADO stories
  const filteredCombinedUserStories = useMemo(() => {
    // Workflow user stories are already filtered via latestWorkflowArtifact
    // ADO user stories don't have BRD linking, so show all
    return combinedUserStories;
  }, [combinedUserStories, selectedBrd?.id]);

  // Fetch repository data for Phase 3 (Development) progress calculation
  const { data: repositoriesData } = useQuery<any[]>({
    queryKey: [
      `/api/sdlc/projects/${apiProjectId}/repositories`,
      selectedAdoProject?.organization,
      selectedAdoProject?.name,
    ],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (selectedAdoProject?.organization) {
        params.append("organization", selectedAdoProject.organization);
      }
      if (selectedAdoProject?.name) {
        params.append("projectName", selectedAdoProject.name);
      }
      const url = `/api/sdlc/projects/${apiProjectId}/repositories${params.toString() ? `?${params.toString()}` : ""
        }`;
      const response = await fetch(getApiUrl(url), { credentials: "include" });
      if (!response.ok) {
        throw new Error("Failed to fetch repositories");
      }
      return response.json();
    },
    enabled: !!apiProjectId,
    retry: false,
  });

  // Get the first repository ID if it exists
  const developmentRepositoryId =
    repositoriesData && repositoriesData.length > 0
      ? repositoriesData[0].id
      : null;

  const { data: branchesData } = useQuery<any[]>({
    queryKey: [`/api/sdlc/repositories/${developmentRepositoryId}/branches`],
    enabled: !!developmentRepositoryId,
    retry: false,
  });

  // Get the first branch ID if it exists
  const developmentBranchId =
    branchesData && branchesData.length > 0 ? branchesData[0].id : null;

  const { data: codeData } = useQuery<any[]>({
    queryKey: [
      `/api/sdlc/repositories/${developmentRepositoryId}/branches/${developmentBranchId}/code`,
    ],
    enabled: !!developmentRepositoryId && !!developmentBranchId,
    retry: false,
  });

  const { data: commitsData } = useQuery<any[]>({
    queryKey: [`/api/sdlc/repositories/${developmentRepositoryId}/commits`],
    enabled: !!developmentRepositoryId,
    retry: false,
  });

  const { data: previewData } = useQuery<any>({
    queryKey: [`/api/sdlc/repositories/${developmentRepositoryId}/preview`],
    enabled: !!developmentRepositoryId,
    retry: false,
  });

  // Mutation for updating confirmations
  const updateConfirmationMutation = useMutation({
    mutationFn: async ({
      confirmationId,
      data: confirmationData,
    }: {
      confirmationId: string;
      data: { status: string; confirmerName: string; comments: string };
    }) => {
      const response = await fetch(
        getApiUrl(`/api/sdlc/confirmations/${confirmationId}`),
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify(confirmationData),
        },
      );
      if (!response.ok) throw new Error("Failed to update confirmation");
      return response.json();
    },
    onSuccess: () => {
      toast({
        title: "Confirmation Updated",
        description: "Your confirmation has been submitted successfully.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/sdlc/confirmations"] });
      setConfirmationDialogOpen(false);
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update confirmation",
        variant: "destructive",
      });
    },
  });

  // Calculate Requirement & Analysis Phase progress based on requirements, user stories, and documents
  const getRequirementAnalysisProgress = (): number => {
    // Calculate progress based on completion of three main components:
    // - Requirements (33% weight)
    // - User Stories (33% weight)
    // - Documents (34% weight)

    let requirementsProgress = 0;
    let userStoriesProgress = 0;
    let documentsProgress = 0;

    // Requirements progress (33% weight)
    // Check if we have requirements from workflow or phase
    const hasWorkflowRequirement = !!workflowRequirementText;
    const hasPhaseRequirements = filteredRequirementsItems.length > 0;

    if (hasWorkflowRequirement || hasPhaseRequirements) {
      // If we have at least one requirement, give partial credit
      // Full credit if we have both workflow and phase requirements
      if (hasWorkflowRequirement && hasPhaseRequirements) {
        requirementsProgress = 33; // Full credit
      } else {
        requirementsProgress = 20; // Partial credit
      }
    }

    // User Stories progress (33% weight)
    // Progress based on having user stories
    if (combinedUserStories.length > 0) {
      // Scale progress based on number of user stories (more stories = more progress)
      // Cap at 33% for this component
      const storyCount = combinedUserStories.length;
      if (storyCount >= 5) {
        userStoriesProgress = 33; // Full credit if 5+ stories
      } else {
        userStoriesProgress = Math.round((storyCount / 5) * 33); // Proportional credit
      }
    }

    // Documents progress (34% weight)
    // Progress based on having documents
    const docsFromPhase = filteredDocumentsItems.length;
    const docsFromWiki = workflowWikiPages.length;
    const totalDocs = docsFromPhase + docsFromWiki;

    if (totalDocs > 0) {
      // Scale progress based on number of documents
      // Cap at 34% for this component
      if (totalDocs >= 3) {
        documentsProgress = 34; // Full credit if 3+ documents
      } else {
        documentsProgress = Math.round((totalDocs / 3) * 34); // Proportional credit
      }
    }

    // Combine all progress metrics
    const progress =
      requirementsProgress + userStoriesProgress + documentsProgress;

    return Math.min(progress, 100);
  };

  // Calculate Design Phase progress based on epics with Figma links
  const getDesignProgress = (): number => {
    // Progress is based on epics that have Figma links (designs completed)
    // Compare epics with Figma links to total epics

    if (!activeAdoProject || !designAssetsCount) {
      return 0;
    }

    const totalEpics = combinedEpics.length;

    // If no epics exist, return 0
    if (totalEpics === 0) {
      return 0;
    }

    // Calculate progress based on percentage of epics with Figma links
    // If all epics have Figma links, progress is 100%
    const epicsWithDesign = designAssetsCount;
    const progress = Math.round((epicsWithDesign / totalEpics) * 100);

    return Math.min(progress, 100);
  };

  // Calculate Development Phase progress based on story states
  const getDevelopmentProgress = (): number => {
    if (!phase3BacklogData?.stateCounts) {
      return 0;
    }

    const stateCounts = phase3BacklogData.stateCounts;

    // Get counts for each state
    const newCount = stateCounts["New"]?.userStories || 0;
    const activeCount = stateCounts["Active"]?.userStories || 0;
    const resolvedCount = stateCounts["Resolved"]?.userStories || 0;
    const closedCount = stateCounts["Closed"]?.userStories || 0;

    // Total stories across all states
    const totalStories = newCount + activeCount + resolvedCount + closedCount;

    // If no stories exist, return 0
    if (totalStories === 0) {
      return 0;
    }

    // Calculate progress based on story states:
    // - New: 0% (not started)
    // - Active: 25% (in progress)
    // - Resolved: 75% (almost done, awaiting verification)
    // - Closed: 100% (completed)
    const weightedProgress =
      newCount * 0 + activeCount * 25 + resolvedCount * 75 + closedCount * 100;

    // Calculate average progress percentage
    const progress = Math.round(weightedProgress / totalStories);

    return progress;
  };

  // Calculate Build & Testing Phase progress based on builds and test results
  const getBuildTestingProgress = (): number => {
    // If no ADO project is selected, return 0
    if (
      !activeAdoProject ||
      !buildsData?.value ||
      buildsData.value.length === 0
    ) {
      return 0;
    }

    const builds = buildsData.value;

    // Calculate build success rate
    const completedBuilds = builds.filter(
      (b) => b.status === "completed" || b.finishTime,
    );
    const successfulBuilds = completedBuilds.filter(
      (b) => b.result === "succeeded",
    );
    const buildProgress =
      completedBuilds.length > 0
        ? Math.round((successfulBuilds.length / completedBuilds.length) * 50)
        : 0;

    // Calculate test pass rate
    let testProgress = 0;
    if (testRunsData?.value && testRunsData.value.length > 0) {
      const testRuns = testRunsData.value;
      let totalTests = 0;
      let passedTests = 0;

      testRuns.forEach((run) => {
        totalTests += run.totalTests || 0;
        passedTests += run.passedTests || 0;
      });

      testProgress =
        totalTests > 0 ? Math.round((passedTests / totalTests) * 50) : 0;
    }

    // Combine build and test progress (50% each)
    const progress = buildProgress + testProgress;

    return Math.min(progress, 100);
  };

  // Calculate Deployment Phase progress based on deployments
  const getDeploymentProgress = (): number => {
    // If no ADO project is selected, return 0
    if (!activeAdoProject) {
      return 0;
    }

    // Use deployments data if available (more accurate than releases)
    if (deploymentsData?.value && deploymentsData.value.length > 0) {
      const deployments = deploymentsData.value;

      // Calculate deployment success rate based on deployment status
      const succeededDeployments = deployments.filter(
        (d) =>
          d.deploymentStatus === "succeeded" ||
          d.deploymentStatus === "Succeeded",
      );
      const totalDeployments = deployments.length;

      // Progress based on successful deployments
      const progress =
        totalDeployments > 0
          ? Math.round((succeededDeployments.length / totalDeployments) * 100)
          : 0;

      return Math.min(progress, 100);
    }

    // Fallback to releases if deployments data is not available
    if (releasesData?.value && releasesData.value.length > 0) {
      const releases = releasesData.value;

      // Calculate deployment success rate based on release status
      // Active or succeeded releases indicate successful deployments
      const successfulReleases = releases.filter(
        (r) =>
          r.status === "active" ||
          r.status === "succeeded" ||
          r.status === "Succeeded",
      );
      const totalReleases = releases.length;

      // Progress based on successful releases
      const progress =
        totalReleases > 0
          ? Math.round((successfulReleases.length / totalReleases) * 100)
          : 0;

      return Math.min(progress, 100);
    }

    // If no deployments or releases data, check if there are any deployment-related activities
    // Having pipelines, release artifacts, or any deployment activity indicates some progress
    const hasPipelines = buildsData?.value && buildsData.value.length > 0;
    const hasReleaseArtifacts =
      releaseArtifactsData && releaseArtifactsData.length > 0;

    // If there are deployment activities but no completed deployments, show minimal progress
    if (hasPipelines || hasReleaseArtifacts) {
      return 10; // Show 10% progress if there are deployment activities but no completed deployments
    }

    return 0;
  };

  // Calculate Maintenance Phase progress based on system health, bugs, and alerts
  const getMaintenanceProgress = (): number => {
    // If no ADO project is selected, return 0
    if (!activeAdoProject) {
      return 0;
    }

    let systemHealthProgress = 0;
    let bugsProgress = 0;
    let alertsProgress = 0;
    let hasAnyData = false;

    // System health from monitoring (40% weight)
    if (
      monitoringData?.systemHealth !== undefined &&
      monitoringData.systemHealth !== null
    ) {
      systemHealthProgress = Math.round(monitoringData.systemHealth * 0.4);
      hasAnyData = true;
    } else if (
      monitoringData &&
      (monitoringData.services || monitoringData.cpu || monitoringData.memory)
    ) {
      // If monitoring data exists but no systemHealth, show some progress based on data availability
      // Having monitoring data indicates active monitoring (20% weight)
      systemHealthProgress = 20;
      hasAnyData = true;
    }

    // Bugs resolution rate (30% weight)
    const totalBugsForProgress =
      bugsData?.statistics?.totalBugs ?? bugsData?.totalBugs ?? 0;
    const resolvedBugsForProgress =
      bugsData?.statistics?.resolved ?? bugsData?.resolvedBugs ?? 0;

    if (totalBugsForProgress > 0) {
      const resolvedBugs = resolvedBugsForProgress;
      bugsProgress = Math.round(
        (resolvedBugs / totalBugsForProgress) * 100 * 0.3,
      );
      hasAnyData = true;
    } else if (bugsData && totalBugsForProgress === 0) {
      // No bugs is a good sign (15% weight)
      bugsProgress = 15;
      hasAnyData = true;
    }

    // Alerts resolution rate (30% weight)
    if (alertsData?.totalAlerts && alertsData.totalAlerts > 0) {
      const resolvedAlerts = alertsData.resolvedAlerts || 0;
      alertsProgress = Math.round(
        (resolvedAlerts / alertsData.totalAlerts) * 100 * 0.3,
      );
      hasAnyData = true;
    } else if (alertsData && alertsData.totalAlerts === 0) {
      // No alerts is a good sign (15% weight)
      alertsProgress = 15;
      hasAnyData = true;
    }

    // If no data available at all, return 0
    if (!hasAnyData) {
      return 0;
    }

    // Combine all progress metrics
    const progress = systemHealthProgress + bugsProgress + alertsProgress;

    return Math.min(progress, 100);
  };

  const getPhaseProgress = (phaseId: number): number => {
    // Special calculation for Requirement & Analysis Phase (Phase 1)
    if (phaseId === 1) {
      return getRequirementAnalysisProgress();
    }

    // Special calculation for Design Phase (Phase 2)
    if (phaseId === 2) {
      return getDesignProgress();
    }

    // Special calculation for Development Phase (Phase 3)
    if (phaseId === 3) {
      return getDevelopmentProgress();
    }

    // Special calculation for Build & Testing Phase (Phase 4)
    if (phaseId === 4) {
      return getBuildTestingProgress();
    }

    // Special calculation for Deployment Phase (Phase 5)
    if (phaseId === 5) {
      return getDeploymentProgress();
    }

    // Special calculation for Maintenance Phase (Phase 7)
    if (phaseId === 7) {
      return getMaintenanceProgress();
    }

    // Use phases from project data
    const phases = projectData?.phases || [];
    const phaseStatus = phases.find((p) => p.phaseNumber === phaseId);
    return phaseStatus?.progress || 0;
  };

  // Get count for a specific feature based on its label and phase
  // Helper function to determine if a feature count is currently loading
  const isFeatureCountLoading = (
    phaseId: number,
    featureLabel: string,
  ): boolean => {
    const normalizedLabel = featureLabel.toLowerCase().replace(/\s+/g, "");

    // Phase 1 features
    if (phaseId === 1) {
      if (
        normalizedLabel.includes("workitems") ||
        normalizedLabel.includes("workitem") ||
        normalizedLabel.includes("userstories") ||
        normalizedLabel.includes("userstory")
      ) {
        return workflowArtifactsLoading || (isJira && isLoadingJiraBacklog) || (!isJira && isLoadingAdoBacklog);
      }
      if (normalizedLabel.includes("requirement")) {
        return isLoadingPhase1Requirements;
      }
      if (normalizedLabel.includes("document")) {
        return isLoadingPhase1Documents;
      }
      if (normalizedLabel.includes("epic")) {
        return workflowArtifactsLoading;
      }
      if (normalizedLabel.includes("feature")) {
        return workflowArtifactsLoading;
      }
    }

    // Phase 2 features
    if (phaseId === 2) {
      if (
        normalizedLabel.includes("generateguideline") ||
        normalizedLabel.includes("generate guideline")
      ) {
        return isLoadingPhase2Guidelines;
      }
      if (
        normalizedLabel.includes("ui/uxdesign") ||
        normalizedLabel.includes("uiuxdesign") ||
        normalizedLabel.includes("ui/ux")
      ) {
        return isLoadingPhase2Mappings;
      }
    }

    // Phase 3 features
    if (phaseId === 3) {
      if (isJira) return isLoadingJiraPhase3Backlog;
      if (activeAdoProject) return isLoadingPhase3Backlog;
    }

    // Phase 4 features
    if (phaseId === 4) {
      if (activeAdoProject) {
        return isPhase4Loading;
      }
    }

    // Phase 5 (Build card): pipelines/builds/tests + publish-summary API
    if (phaseId === 5) {
      if (hasBuildDeployConfig) {
        return isPhase4Loading || isLoadingBuildPublishSummary;
      }
    }

    // Phase 6 features (Deployment)
    if (phaseId === 6) {
      if (hasBuildDeployConfig) {
        return isPhase5Loading;
      }
    }

    // Phase 7 features (Maintenance)
    if (phaseId === 7) {
      if (devOpsDataReady) {
        return isPhase6Loading;
      }
    }

    return false;
  };

  const getFeatureCount = (phaseId: number, featureLabel: string): number => {
    const normalizedLabel = featureLabel.toLowerCase().replace(/\s+/g, "");
    const providerPipelines = Array.isArray(pipelinesData?.value)
      ? pipelinesData.value.filter((pipeline: any) => {
        // External providers can return placeholder rows when no historical runs exist.
        // Do not count placeholder rows as real pipelines.
        if (pipeline?.entryKind === "placeholder") return false;
        if (typeof pipeline?.id === "number" && pipeline.id <= 0) return false;
        return true;
      })
      : [];

    if (
      normalizedLabel.includes("workitems") ||
      normalizedLabel.includes("workitem") ||
      normalizedLabel.includes("workitems") ||
      normalizedLabel.includes("workitem") ||
      normalizedLabel.includes("userstories") ||
      normalizedLabel.includes("userstory")
    ) {
      // Use filtered user stories if BRD/Requirement is selected
      return filteredCombinedUserStories.length;
    }
    if (normalizedLabel.includes("requirement")) {
      if (
        workflowRequirementText &&
        !selectedBrd?.id &&
        !selectedRequirement?.id
      ) {
        // Only count workflow requirement if no filter is applied
        return 1;
      }
      // Use filtered requirements if BRD/Requirement is selected
      return filteredRequirementsItems.length;
    }
    if (normalizedLabel.includes("document")) {
      const docsFromPhase = filteredDocumentsItems.length;
      // Wiki pages from workflow artifacts are already filtered via latestWorkflowArtifact
      const docsFromWiki = workflowWikiPages.length;
      return docsFromPhase + docsFromWiki;
    }
    if (normalizedLabel.includes("epic")) {
      return combinedEpics.length;
    }
    if (normalizedLabel.includes("feature")) {
      return combinedFeatures.length;
    }

    // Design phase (Phase 2) database counts
    if (phaseId === 2) {
      // Generate Guideline count from database
      if (
        normalizedLabel.includes("generateguideline") ||
        normalizedLabel.includes("generate guideline")
      ) {
        return designGuidelinesCount;
      }
      // UI/UX design count from design mappings database
      if (
        normalizedLabel.includes("ui/uxdesign") ||
        normalizedLabel.includes("uiuxdesign") ||
        normalizedLabel.includes("ui/ux")
      ) {
        // Use the query count first, fallback to saved mappings state
        return designMappingsCount || savedDesignMappings.length;
      }
    }

    // Development phase (Phase 3) state counts
    if (phaseId === 3 && phase3BacklogData?.stateCounts) {
      if (normalizedLabel === "new") {
        return phase3BacklogData.stateCounts["New"]?.total || 0;
      }
      if (normalizedLabel === "active") {
        return phase3BacklogData.stateCounts["Active"]?.total || 0;
      }
      if (normalizedLabel === "resolved") {
        return phase3BacklogData.stateCounts["Resolved"]?.total || 0;
      }
      if (normalizedLabel === "closed") {
        return phase3BacklogData.stateCounts["Closed"]?.total || 0;
      }
      if (normalizedLabel === "reopened") {
        return phase3BacklogData.stateCounts["Reopened"]?.total || 0;
      }
    }

    // Build & Testing phase (Phase 4) counts
    // Only show counts if ADO project is selected
    if (phaseId === 4 && activeAdoProject) {
      if (
        normalizedLabel.includes("buildpipeline") ||
        normalizedLabel === "buildpipelines"
      ) {
        // Count pipeline definitions (pipelines), not builds/runs
        return pipelinesData?.value?.length || 0;
      }
      if (
        normalizedLabel.includes("testreport") ||
        normalizedLabel.includes("viewtestreport")
      ) {
        return testRunsData?.value?.length || 0;
      }
      if (
        normalizedLabel.includes("publishpackage") ||
        normalizedLabel.includes("package")
      ) {
        // Count builds that have artifacts (packages)
        if (buildsData?.value) {
          // For now, return total builds as packages are typically associated with builds
          // In the future, we could fetch artifacts separately for a more accurate count
          return buildsData.value.length || 0;
        }
        return 0;
      }
      if (normalizedLabel === "jobs") {
        // Count total jobs from all builds
        if (buildsData?.value) {
          return buildsData.value.reduce((total, build) => {
            return total + (build.jobs?.length || 0);
          }, 0);
        }
        return 0;
      }

      // Test Artifacts counts
      if (normalizedLabel === "testcases") {
        return manualScriptsCount || 0;
      }
      if (
        normalizedLabel.includes("bddfeature") ||
        normalizedLabel.includes("bddstep") ||
        normalizedLabel.includes("scenario")
      ) {
        // Return count of BDD files/scenarios
        return automationScriptsCount || 0;
      }
      if (normalizedLabel === "testplans") {
        return testPlansCount || 0;
      }
    }

    // Build phase (Phase 5) counts - show pipelines, test runs, packages, jobs, metrics
    if (phaseId === 5 && hasBuildDeployConfig) {
      if (
        normalizedLabel.includes("buildpipeline") ||
        normalizedLabel === "buildpipelines" ||
        normalizedLabel.includes("pipeline")
      ) {
        const pipelineCount = providerPipelines.length;
        if (pipelineCount > 0) return pipelineCount;
        // For external CI providers, fall back to real build/run count when pipeline listing
        // is temporarily empty. Avoid synthetic "1" counts that look incorrect across projects.
        if (isGitLabProvider || isBitbucketProvider || isGithubProvider) {
          const runCount = buildsData?.value?.length || 0;
          return runCount;
        }
        return 0;
      }
      if (
        normalizedLabel.includes("testreport") ||
        normalizedLabel.includes("viewtestreport") ||
        normalizedLabel.includes("test")
      ) {
        return testRunsData?.value?.length || 0;
      }
      if (
        normalizedLabel.includes("publishpackage") ||
        normalizedLabel.includes("package")
      ) {
        return buildPublishSummary?.publishedArtifacts ?? 0;
      }
      if (normalizedLabel === "jobs") {
        if (buildsData?.value) {
          return buildsData.value.reduce((total, build) => {
            return total + (build.jobs?.length || 0);
          }, 0);
        }
        return 0;
      }
      if (
        normalizedLabel === "buildstatusmetrics" ||
        normalizedLabel.includes("buildstatus") ||
        normalizedLabel.includes("statusmetrics")
      ) {
        // Success rate % across recent completed runs (same window as publish summary metrics)
        return buildPublishSummary?.successRatePercent ?? 0;
      }
    }

    // Deployment phase (Phase 6) counts — use releases / external Deployments API only.
    if (phaseId === 6 && hasBuildDeployConfig) {
      // Must run before any broad "deployment*" match (labels are normalized, e.g. deploymenttracking).
      if (normalizedLabel.includes("deploymenttracking")) {
        return deploymentsData?.value?.length || 0;
      }
      if (normalizedLabel.includes("deploymentstatus")) {
        return deploymentsData?.value?.length || 0;
      }
      if (normalizedLabel === "pipeline") {
        return (
          releasesData?.value?.length ||
          deploymentsData?.value?.length ||
          0
        );
      }
      if (normalizedLabel === "releases") {
        return releasesData?.value?.length || 0;
      }
      if (
        normalizedLabel.includes("triggerrelease") ||
        normalizedLabel.includes("trigger")
      ) {
        return (
          releaseArtifactsData?.length ||
          releasesData?.value?.length ||
          0
        );
      }
      if (
        normalizedLabel.includes("managerollout") ||
        normalizedLabel.includes("rollout")
      ) {
        return (
          releasesData?.value?.length ||
          deploymentsData?.value?.length ||
          0
        );
      }
    }

    // Maintenance phase (Phase 7) counts
    if (phaseId === 7 && devOpsDataReady) {
      if (
        normalizedLabel.includes("pipeline") &&
        normalizedLabel.includes("health")
      ) {
        if (isGitLabProvider || isBitbucketProvider || isGithubProvider) {
          const externalRuns =
            pipelineHealthData?.totalRuns ??
            pipelineHealthData?.statistics?.totalRuns ??
            0;
          if (externalRuns > 0) return externalRuns;
          return providerPipelines.length;
        }
        // Show health score badge (prefer API successRate; fallback compute from runs).
        const directScore = pipelineHealthData?.successRate;
        if (typeof directScore === "number" && !Number.isNaN(directScore)) {
          return Math.round(directScore);
        }
        const total =
          pipelineHealthData?.totalRuns ??
          pipelineHealthData?.statistics?.totalRuns ??
          0;
        const succeeded = pipelineHealthData?.succeededRuns ?? 0;
        if (total > 0) {
          return Math.round((succeeded / total) * 100);
        }
        return 0;
      }
      if (normalizedLabel === "monitor") {
        // Show monitored service count from array/object payloads.
        const services = monitoringData?.services;
        if (Array.isArray(services)) return services.length;
        if (services && typeof services === "object") {
          return (
            (services as any).total ??
            (services as any).running ??
            0
          );
        }
        return monitoringData ? 1 : 0;
      }
      if (
        normalizedLabel.includes("errortracking") ||
        normalizedLabel.includes("error")
      ) {
        return (
          bugsData?.statistics?.unresolved ||
          bugsData?.statistics?.totalBugs ||
          bugsData?.totalBugs ||
          0
        );
      }
      if (normalizedLabel === "alerts" || normalizedLabel.includes("alerts")) {
        // Use statistics.activeAlerts if available, otherwise fall back to activeAlerts or totalAlerts
        return (
          alertsData?.statistics?.activeAlerts ||
          alertsData?.activeAlerts ||
          alertsData?.totalAlerts ||
          0
        );
      }
      if (normalizedLabel.includes("deploymenttrends")) {
        // Show total deployments count
        return deploymentTrendsData?.overallMetrics?.totalDeployments || 0;
      }
    }

    return 0;
  };

  // Helper function to determine if a feature is a category feature
  const isCategoryFeature = (featureLabel: string): boolean => {
    const normalizedLabel = featureLabel.toLowerCase().replace(/\s+/g, "");
    return (
      normalizedLabel.includes("workitems") ||
      normalizedLabel.includes("workitem") ||
      normalizedLabel.includes("userstories") ||
      normalizedLabel.includes("userstory") ||
      normalizedLabel.includes("requirement") ||
      normalizedLabel.includes("backlog") ||
      normalizedLabel.includes("documentation") ||
      normalizedLabel.includes("doc") ||
      normalizedLabel.includes("epic") ||
      normalizedLabel.includes("issue")
    );
  };

  // Helper function to determine if a feature category is completed
  const isFeatureCategoryCompleted = (
    phaseId: number,
    featureLabel: string,
  ): boolean => {
    const phases = projectData?.phases || [];
    const phaseData = phases.find((p) => p.phaseNumber === phaseId);
    if (!phaseData) return false;

    const categoryCompletion = (phaseData as any).categoryCompletion;
    if (!categoryCompletion) return false;

    const normalizedLabel = featureLabel.toLowerCase().replace(/\s+/g, "");

    // Map feature labels to category completion fields
    if (
      normalizedLabel.includes("workitems") ||
      normalizedLabel.includes("workitem") ||
      normalizedLabel.includes("userstories") ||
      normalizedLabel.includes("userstory")
    ) {
      return categoryCompletion.hasBacklog; // User stories/Work items are stored as backlog items
    }
    if (normalizedLabel.includes("requirement")) {
      return categoryCompletion.hasRequirements;
    }
    if (normalizedLabel.includes("backlog")) {
      return categoryCompletion.hasBacklog;
    }
    if (
      normalizedLabel.includes("documentation") ||
      normalizedLabel.includes("doc")
    ) {
      return categoryCompletion.hasDocuments;
    }
    if (normalizedLabel.includes("epic")) {
      return categoryCompletion.hasEpics;
    }
    if (normalizedLabel.includes("issue")) {
      return categoryCompletion.hasIssues;
    }

    return false;
  };

  // Show the page-level loader only on the first visit to SDLC (persisted)
  const [hasSeenInitialLoader, setHasSeenInitialLoader] = useState<boolean>(
    () => {
      if (typeof window === "undefined") return false;
      return localStorage.getItem("sdlc_initial_loader_shown") === "1";
    },
  );

  const baseOrgProjectLoading =
    allProjectsLoading || allProjectsFetching || isLoading;

  const isInitialOrgProjectLoad =
    !hasSeenInitialLoader && !selectedAdoProject && baseOrgProjectLoading;
  const isBlockingLoaderActive = isInitialOrgProjectLoad;
  const blockingLoaderMessage = "Fetching organizations and projects...";
  const blockingLoaderSubtext =
    "Please wait while we prepare your organizations and projects.";

  // Once the initial load completes, persist the flag
  useEffect(() => {
    if (isInitialOrgProjectLoad) return;
    if (!hasSeenInitialLoader) {
      setHasSeenInitialLoader(true);
      if (typeof window !== "undefined") {
        localStorage.setItem("sdlc_initial_loader_shown", "1");
      }
    }
  }, [isInitialOrgProjectLoad, hasSeenInitialLoader]);

  // Don't show error state that might cause navigation - always show SDLC page structure
  // Error handling will be shown inline if needed, but page stays on /sdlc
  const hasError = isError && !projectData && !sdlcProjectData;

  return (
    <div
      className={
        aiDesignDialogOpen
          ? "h-full bg-background relative overflow-hidden"
          : "min-h-screen bg-background relative"
      }
      aria-busy={false}
      data-testid="sdlc-page"
    >
      <div>
        {/* Header with Breadcrumb and Actions */}
        <div className="border-b bg-card sticky top-0 z-50">
          <div className="p-6">
            <PageHeader
              icon={Workflow}
              title="SDLC Workflow"
              subtitle="Manage your software development lifecycle"
              color="blue"
              data-testid="heading-page-title"
            />

            {/* Show error message inline if there's an error, but keep page structure */}
            {hasError && (
              <div className="mt-4 p-4 rounded-lg bg-destructive/10 border border-destructive/20">
                <div className="flex items-center gap-2">
                  <AlertCircle className="h-5 w-5 text-destructive" />
                  <div className="flex-1">
                    <h3 className="text-sm font-semibold text-destructive">
                      Failed to load project data
                    </h3>
                    <p className="text-xs text-muted-foreground mt-1">
                      Please select an organization and project, or check if the
                      project exists.
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      // Preserve current URL params when refreshing
                      window.location.reload();
                    }}
                  >
                    Retry
                  </Button>
                </div>
              </div>
            )}

            {/* Project Selector and Create Button */}
            <div className="mt-4 space-y-3">
              <div className="flex items-end justify-between gap-3">
                <div className="flex items-center gap-3 flex-1">
                  {/* Project Dropdown */}
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                      Project
                    </label>
                    <Popover
                      open={projectDropdownOpen}
                      onOpenChange={setProjectDropdownOpen}
                    >
                      <PopoverTrigger asChild>
                        <Button
                          variant="outline"
                          role="combobox"
                          className="w-[240px] justify-between text-xs"
                          data-testid="select-project"
                        >
                          <div className="flex items-center gap-1.5 sm:gap-2 min-w-0">
                            <FolderGit2 className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-muted-foreground flex-shrink-0" />
                            <span className="truncate">
                              {selectedAdoProject?.name ||
                                displayedProjectName ||
                                "Select a project..."}
                            </span>
                          </div>
                          <ChevronDown className="ml-1.5 sm:ml-2 h-3.5 w-3.5 sm:h-4 sm:w-4 shrink-0 opacity-50" />
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-[400px] p-0" align="start">
                        <Command shouldFilter={false} className="rounded-lg">
                          {/* Search Bar */}
                          <CommandInput
                            placeholder="Search projects..."
                            value={projectSearchQuery}
                            onValueChange={setProjectSearchQuery}
                            className="h-9"
                          />

                          {/* Controls */}
                          <div className="flex items-center gap-2 border-b px-3 py-2 bg-muted/30">
                            {projectSearchQuery && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 ml-auto"
                                onClick={() => {
                                  setProjectSearchQuery("");
                                }}
                                title="Clear search"
                              >
                                <X className="h-4 w-4" />
                              </Button>
                            )}
                          </div>

                          {/* Projects List */}
                          <CommandList className="max-h-[300px]">
                            <CommandEmpty>
                              {!effectiveSelectedOrganization && !isGlobalAllOrganizations ? (
                                <div className="py-8 text-center">
                                  <p className="text-sm font-medium text-muted-foreground mb-1">
                                    Please select an organization
                                  </p>
                                  <p className="text-xs text-muted-foreground">
                                    Use the organization selector in the header
                                  </p>
                                </div>
                              ) : allProjectsLoading ? (
                                <div className="flex items-center justify-center py-8">
                                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground mr-2" />
                                  <span className="text-sm text-muted-foreground">
                                    Loading projects...
                                  </span>
                                </div>
                              ) : (
                                <div className="py-8 text-center">
                                  <p className="text-sm font-medium text-muted-foreground mb-1">
                                    No projects found
                                  </p>
                                  <p className="text-xs text-muted-foreground">
                                    Try adjusting your search or filters
                                  </p>
                                </div>
                              )}
                            </CommandEmpty>
                            <CommandGroup>
                              {filteredAndSortedProjects.map((project) => (
                                <CommandItem
                                  key={project.id}
                                  value={project.id}
                                  onSelect={() => {
                                    setSelectedAdoProject(project);
                                    setProjectDropdownOpen(false);
                                    setProjectSearchQuery("");
                                    toast({
                                      title: "Project Selected",
                                      description: `Loading details for ${project.name}...`,
                                    });
                                  }}
                                  className="cursor-pointer py-2.5 px-3 aria-selected:bg-accent"
                                >
                                  <div className="flex items-center justify-between w-full gap-2">
                                    <div className="flex flex-col flex-1 min-w-0">
                                      <span className="font-medium text-sm leading-tight">
                                        {project.name}
                                      </span>
                                      {project.organization && (
                                        <span className="text-xs text-muted-foreground truncate mt-0.5">
                                          {project.organization}
                                        </span>
                                      )}
                                    </div>
                                    {selectedAdoProject?.id === project.id && (
                                      <CheckCircle2 className="h-4 w-4 text-primary shrink-0" />
                                    )}
                                  </div>
                                </CommandItem>
                              ))}
                              {(hasNextSdlcProjectsPage || sdlcProjectsFetchingNextPage) && (
                                <div
                                  ref={projectListLoadMoreRef}
                                  className="flex items-center justify-center py-3 text-xs text-muted-foreground"
                                >
                                  <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                                  Loading more projects...
                                </div>
                              )}
                            </CommandGroup>
                          </CommandList>
                        </Command>
                      </PopoverContent>
                    </Popover>
                  </div>

                  {/* BRD Dropdown - Show when project is selected */}
                  {selectedAdoProject && (
                    <div className="flex flex-col gap-1.5">
                      <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                        BRD
                      </label>
                      <Popover
                        open={brdDropdownOpen}
                        onOpenChange={(open) => {
                          setBrdDropdownOpen(open);
                          if (!open) {
                            setBrdSearchQuery("");
                          }
                        }}
                      >
                        <PopoverTrigger asChild>
                          <Button
                            variant="outline"
                            role="combobox"
                            className="w-[240px] justify-between text-xs"
                            data-testid="select-brd"
                            disabled={!isProjectSelected}
                          >
                            <div className="flex items-center gap-1.5 sm:gap-2 min-w-0 flex-1">
                              <FileText className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-muted-foreground shrink-0" />
                              <span className="truncate">
                                {selectedBrd ? selectedBrd.title : "All"}
                              </span>
                            </div>
                            <ChevronDown className="ml-1.5 sm:ml-2 h-3.5 w-3.5 sm:h-4 sm:w-4 shrink-0 opacity-50" />
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-[400px] p-0" align="start">
                          <Command shouldFilter={false} className="rounded-lg">
                            {/* Search Bar */}
                            <CommandInput
                              placeholder="Search BRDs..."
                              value={brdSearchQuery}
                              onValueChange={setBrdSearchQuery}
                              className="h-9"
                            />

                            <CommandList className="max-h-[300px]">
                              <CommandEmpty>
                                {!selectedAdoProject ? (
                                  <div className="py-8 text-center">
                                    <p className="text-sm font-medium text-muted-foreground mb-1">
                                      Please select a project first
                                    </p>
                                    <p className="text-xs text-muted-foreground">
                                      Choose a project to view its BRDs
                                    </p>
                                  </div>
                                ) : (
                                  <div className="py-8 text-center">
                                    <p className="text-sm font-medium text-muted-foreground mb-1">
                                      No BRDs found
                                    </p>
                                    <p className="text-xs text-muted-foreground">
                                      {brdSearchQuery
                                        ? "Try adjusting your search"
                                        : "Create a BRD to get started"}
                                    </p>
                                  </div>
                                )}
                              </CommandEmpty>
                              <CommandGroup>
                                {/* "All" option to reset selection */}
                                <CommandItem
                                  value="all"
                                  onSelect={() => {
                                    setSelectedBrd(null);
                                    setBrdDropdownOpen(false);
                                    setBrdSearchQuery("");
                                    window.localStorage.removeItem(
                                      "sdlc:selectedBrdId",
                                    );
                                    toast({
                                      title: "BRD Filter Reset",
                                      description: "Showing all BRDs",
                                    });
                                  }}
                                  className="cursor-pointer py-2.5 px-3 aria-selected:bg-accent"
                                >
                                  <div className="flex items-center justify-between w-full gap-2">
                                    <div className="flex flex-col flex-1 min-w-0">
                                      <span className="font-medium text-sm leading-tight truncate">
                                        All
                                      </span>
                                      <span className="text-xs text-muted-foreground truncate mt-0.5">
                                        Show all BRDs
                                      </span>
                                    </div>
                                    {!selectedBrd && (
                                      <CheckCircle2 className="h-4 w-4 text-primary shrink-0" />
                                    )}
                                  </div>
                                </CommandItem>
                                {filteredBrds.map((brd) => (
                                  <CommandItem
                                    key={brd.id}
                                    value={brd.id}
                                    onSelect={() => {
                                      setSelectedBrd({
                                        id: brd.id,
                                        title: brd.title,
                                        status: brd.status,
                                      });
                                      setBrdDropdownOpen(false);
                                      setBrdSearchQuery("");
                                      window.localStorage.setItem(
                                        "sdlc:selectedBrdId",
                                        brd.id,
                                      );
                                      toast({
                                        title: "BRD Selected",
                                        description: `Selected ${brd.title}`,
                                      });
                                    }}
                                    className="cursor-pointer py-2.5 px-3 aria-selected:bg-accent"
                                  >
                                    <div className="flex items-center justify-between w-full gap-2">
                                      <div className="flex flex-col flex-1 min-w-0">
                                        <span className="font-medium text-sm leading-tight truncate">
                                          {brd.title}
                                        </span>
                                        {brd.status && (
                                          <span className="text-xs text-muted-foreground truncate mt-0.5">
                                            Status: {brd.status}
                                          </span>
                                        )}
                                      </div>
                                      {selectedBrd?.id === brd.id && (
                                        <CheckCircle2 className="h-4 w-4 text-primary shrink-0" />
                                      )}
                                    </div>
                                  </CommandItem>
                                ))}
                              </CommandGroup>
                            </CommandList>
                          </Command>
                        </PopoverContent>
                      </Popover>
                    </div>
                  )}

                  {/* Requirement Dropdown - Hidden for now */}
                  {false && selectedAdoProject && (
                    <div className="flex flex-col gap-1.5">
                      <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                        Requirement
                      </label>
                      <Popover
                        open={requirementDropdownOpen}
                        onOpenChange={(open) => {
                          setRequirementDropdownOpen(open);
                          if (!open) {
                            setRequirementSearchQuery("");
                          }
                        }}
                      >
                        <PopoverTrigger asChild>
                          <Button
                            variant="outline"
                            role="combobox"
                            className="w-[200px] justify-between text-xs"
                            data-testid="select-requirement"
                            disabled={!isProjectSelected}
                          >
                            <div className="flex items-center gap-1.5 sm:gap-2 min-w-0 flex-1">
                              <Clipboard className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-muted-foreground shrink-0" />
                              <span className="truncate">
                                {(selectedRequirement as any)?.title ?? "Select Requirement..."}
                              </span>
                            </div>
                            <ChevronDown className="ml-1.5 sm:ml-2 h-3.5 w-3.5 sm:h-4 sm:w-4 shrink-0 opacity-50" />
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-[400px] p-0" align="start">
                          <Command shouldFilter={false} className="rounded-lg">
                            {/* Search Bar */}
                            <CommandInput
                              placeholder="Search requirements..."
                              value={requirementSearchQuery}
                              onValueChange={setRequirementSearchQuery}
                              className="h-9"
                            />

                            <CommandList className="max-h-[300px]">
                              <CommandEmpty>
                                {!selectedAdoProject ? (
                                  <div className="py-8 text-center">
                                    <p className="text-sm font-medium text-muted-foreground mb-1">
                                      Please select a project first
                                    </p>
                                    <p className="text-xs text-muted-foreground">
                                      Choose a project to view its requirements
                                    </p>
                                  </div>
                                ) : (
                                  <div className="py-8 text-center">
                                    <p className="text-sm font-medium text-muted-foreground mb-1">
                                      No requirements found
                                    </p>
                                    <p className="text-xs text-muted-foreground">
                                      {requirementSearchQuery
                                        ? "Try adjusting your search"
                                        : "Generate requirements from workflow"}
                                    </p>
                                  </div>
                                )}
                              </CommandEmpty>
                              <CommandGroup>
                                {filteredRequirements.map((req) => (
                                  <CommandItem
                                    key={req.id}
                                    value={req.id}
                                    onSelect={() => {
                                      setSelectedRequirement(req);
                                      setRequirementDropdownOpen(false);
                                      setRequirementSearchQuery("");
                                      window.localStorage.setItem(
                                        "sdlc:selectedRequirementId",
                                        req.id,
                                      );
                                      toast({
                                        title: "Requirement Selected",
                                        description: `Selected requirement`,
                                      });
                                    }}
                                    className="cursor-pointer py-2.5 px-3 aria-selected:bg-accent"
                                  >
                                    <div className="flex items-center justify-between w-full gap-2">
                                      <div className="flex flex-col flex-1 min-w-0">
                                        <span className="font-medium text-sm leading-tight truncate">
                                          {req.title}
                                        </span>
                                        {req.phaseNumber !== undefined && (
                                          <span className="text-xs text-muted-foreground truncate mt-0.5">
                                            Phase {req.phaseNumber}
                                          </span>
                                        )}
                                      </div>
                                      {selectedRequirement?.id === req.id && (
                                        <CheckCircle2 className="h-4 w-4 text-primary shrink-0" />
                                      )}
                                    </div>
                                  </CommandItem>
                                ))}
                              </CommandGroup>
                            </CommandList>
                          </Command>
                        </PopoverContent>
                      </Popover>
                    </div>
                  )}
                </div>

                {/* Create Project Button */}
                {canCreateProject && (
                  <Button
                    size="sm"
                    className="text-xs sm:text-sm"
                    data-testid="button-create-sdlc-project"
                    onClick={() => setLocation("/projects?create=true")}
                  >
                    <Plus className="h-3.5 w-3.5 sm:h-4 sm:w-4 mr-1.5 sm:mr-2" />
                    Create Project
                  </Button>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Main Content - Horizontal Phases */}
        <div className="max-w-[1800px] mx-auto px-4 sm:px-6 py-6 sm:py-8">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 sm:gap-4">
            {/* BRD Generator quick entry (before Backlogs phase) */}
            <Card
              className={`flex flex-col ${isProjectSelected
                ? "hover-elevate"
                : "opacity-50 cursor-not-allowed"
                }`}
              aria-disabled={!isProjectSelected}
              data-testid="card-brd-generator"
            >
              <CardContent className="p-3 sm:p-4 flex flex-col h-full min-h-[280px]">
                <div className="flex items-center justify-between gap-2 mb-2 sm:mb-2.5">
                  <div className="flex items-center gap-2 sm:gap-3 min-w-0">
                    <div className="p-1.5 sm:p-2 rounded-lg bg-gradient-to-br from-purple-500 to-purple-600 flex-shrink-0">
                      <FileText className="h-4 w-4 sm:h-5 sm:w-5 text-white" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <h3 className="font-semibold text-xs sm:text-sm leading-tight truncate">
                        BRD Generator
                      </h3>
                      <p className="text-[9px] sm:text-[10px] text-muted-foreground leading-tight mt-0.5">
                        BRD Lifecycle
                      </p>
                    </div>
                  </div>
                  {selectedBrd ? (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 shrink-0"
                      title="View selected BRD"
                      data-testid="button-view-selected-brd"
                      onClick={() => {
                        setSelectedBrdForPreview(selectedBrd.id);
                        setBrdPreviewDialogOpen(true);
                      }}
                    >
                      <Eye className="h-4 w-4" />
                    </Button>
                  ) : (
                    <CheckCircle2
                      className="h-4 w-4 text-transparent"
                      aria-hidden
                    />
                  )}
                </div>

                {/* BRD Status Counts - Clickable */}
                <div className="space-y-1.5 sm:space-y-2 mb-2.5 sm:mb-3 flex-1 min-h-[180px]">
                  {(() => {
                    // Determine progress for selected BRD
                    const getStageStatus = () => {
                      if (!selectedBrd?.status)
                        return { currentStage: -1, stages: [] };
                      const status =
                        selectedBrd.status?.toLowerCase().trim() || "";
                      const normalizedStatus = status
                        .replace(/_/g, "")
                        .replace(/-/g, "");

                      const stages = [
                        { key: "draft", statusMatch: ["draft"] },
                        {
                          key: "yettoreview",
                          statusMatch: [
                            "yettoreview",
                            "yet_to_review",
                            "pendingreview",
                          ],
                        },
                        { key: "approved", statusMatch: ["approved"] },
                        {
                          key: "inprogress",
                          statusMatch: [
                            "partiallygenerated",
                            "partially_generated",
                          ],
                        },
                        { key: "completed", statusMatch: ["generated"] },
                      ];

                      const currentStageIndex = stages.findIndex((s) =>
                        s.statusMatch.some((match) => {
                          const normalizedMatch = match
                            .replace(/_/g, "")
                            .replace(/-/g, "");
                          return (
                            normalizedStatus === normalizedMatch ||
                            status === match ||
                            status.includes(match)
                          );
                        }),
                      );

                      return {
                        currentStage:
                          currentStageIndex >= 0 ? currentStageIndex : -1,
                        stages: stages.map((_, index) => ({
                          isCompleted: index < currentStageIndex,
                          isCurrent: index === currentStageIndex,
                        })),
                      };
                    };

                    const progress = getStageStatus();

                    return (
                      <>
                        <button
                          className="flex items-start gap-1.5 sm:gap-2 text-[10px] sm:text-xs w-full text-left p-1 sm:p-1.5 rounded-md hover-elevate active-elevate-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                          onClick={() => {
                            if (selectedBrd) {
                              setSelectedBrdForPreview(selectedBrd.id);
                              setBrdPreviewDialogOpen(true);
                            } else {
                              setBrdListCategory("drafts");
                              setBrdListDialogOpen(true);
                            }
                          }}
                          disabled={!isProjectSelected}
                          title={
                            selectedBrd
                              ? "Open selected BRD"
                              : "Draft BRDs that need review or changes before approval"
                          }
                        >
                          <div className="relative flex-shrink-0">
                            <Edit
                              className={`h-3 w-3 sm:h-3.5 sm:w-3.5 mt-0.5 ${selectedBrd && progress.stages[0]?.isCurrent
                                ? "text-blue-500"
                                : "text-muted-foreground"
                                }`}
                            />
                            {selectedBrd && progress.stages[0]?.isCompleted && (
                              <CheckCircle2 className="absolute -top-0.5 -right-0.5 h-2.5 w-2.5 text-green-500 bg-white rounded-full" />
                            )}
                            {selectedBrd && progress.stages[0]?.isCurrent && (
                              <div className="absolute -top-0.5 -right-0.5 h-2.5 w-2.5 bg-blue-500 rounded-full ring-1 ring-blue-300 dark:ring-blue-700" />
                            )}
                          </div>
                          <span className="text-muted-foreground leading-tight flex-1 truncate font-medium">
                            Drafts:
                          </span>
                          {selectedBrd ? (
                            progress.stages[0]?.isCompleted ? (
                              <CheckCircle2 className="h-3.5 w-3.5 text-green-500 flex-shrink-0" />
                            ) : progress.stages[0]?.isCurrent ? (
                              <div className="h-3.5 w-3.5 rounded-full bg-blue-500 flex-shrink-0 ring-1 ring-blue-300 dark:ring-blue-700" />
                            ) : (
                              <div className="h-3.5 w-3.5 rounded-full border border-muted-foreground/30 flex-shrink-0" />
                            )
                          ) : (
                            isProjectSelected &&
                            (isLoadingBrdCounts || !filteredBrdCounts ? (
                              <Skeleton className="h-4 w-6 flex-shrink-0 rounded" />
                            ) : (
                              <Badge
                                variant="secondary"
                                className="text-[10px] px-1.5 py-0 h-4 w-6 flex-shrink-0 bg-secondary text-secondary-foreground font-semibold !border-0 flex items-center justify-center"
                              >
                                {String(filteredBrdCounts.drafts ?? 0).padStart(
                                  2,
                                  "0",
                                )}
                              </Badge>
                            ))
                          )}
                        </button>
                        <button
                          className="flex items-start gap-1.5 sm:gap-2 text-[10px] sm:text-xs w-full text-left p-1 sm:p-1.5 rounded-md hover-elevate active-elevate-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                          onClick={() => {
                            if (selectedBrd) {
                              setSelectedBrdForPreview(selectedBrd.id);
                              setBrdPreviewDialogOpen(true);
                            } else {
                              setBrdListCategory("yetToReview");
                              setBrdListDialogOpen(true);
                            }
                          }}
                          disabled={!isProjectSelected}
                          title={
                            selectedBrd
                              ? "Open selected BRD"
                              : "BRDs pending review"
                          }
                        >
                          <div className="relative flex-shrink-0">
                            <Clock
                              className={`h-3 w-3 sm:h-3.5 sm:w-3.5 mt-0.5 ${selectedBrd && progress.stages[1]?.isCurrent
                                ? "text-blue-500"
                                : "text-muted-foreground"
                                }`}
                            />
                            {selectedBrd && progress.stages[1]?.isCompleted && (
                              <CheckCircle2 className="absolute -top-0.5 -right-0.5 h-2.5 w-2.5 text-green-500 bg-white rounded-full" />
                            )}
                            {selectedBrd && progress.stages[1]?.isCurrent && (
                              <div className="absolute -top-0.5 -right-0.5 h-2.5 w-2.5 bg-blue-500 rounded-full ring-1 ring-blue-300 dark:ring-blue-700" />
                            )}
                          </div>
                          <span className="text-muted-foreground leading-tight flex-1 truncate">
                            Yet to Review:
                          </span>
                          {selectedBrd ? (
                            progress.stages[1]?.isCompleted ? (
                              <CheckCircle2 className="h-3.5 w-3.5 text-green-500 flex-shrink-0" />
                            ) : progress.stages[1]?.isCurrent ? (
                              <div className="h-3.5 w-3.5 rounded-full bg-blue-500 flex-shrink-0 ring-1 ring-blue-300 dark:ring-blue-700" />
                            ) : (
                              <div className="h-3.5 w-3.5 rounded-full border border-muted-foreground/30 flex-shrink-0" />
                            )
                          ) : (
                            isProjectSelected &&
                            (isLoadingBrdCounts || !filteredBrdCounts ? (
                              <Skeleton className="h-4 w-6 flex-shrink-0 rounded" />
                            ) : (
                              <Badge
                                variant="secondary"
                                className="text-[10px] px-1.5 py-0 h-4 w-6 flex-shrink-0 border bg-orange-600 dark:bg-orange-600 text-white border-orange-600 dark:border-orange-600 flex items-center justify-center"
                              >
                                {String(
                                  filteredBrdCounts.yetToReview ?? 0,
                                ).padStart(2, "0")}
                              </Badge>
                            ))
                          )}
                        </button>
                        <div
                          className="flex items-start gap-1.5 sm:gap-2 text-[10px] sm:text-xs w-full text-left p-1 sm:p-1.5"
                          aria-label="Approved BRD stage status"
                        >
                          <div className="relative flex-shrink-0">
                            <CheckCircle2
                              className={`h-3 w-3 sm:h-3.5 sm:w-3.5 mt-0.5 ${selectedBrd && progress.stages[2]?.isCurrent
                                ? "text-blue-500"
                                : "text-muted-foreground"
                                }`}
                            />
                            {selectedBrd && progress.stages[2]?.isCompleted && (
                              <CheckCircle2 className="absolute -top-0.5 -right-0.5 h-2.5 w-2.5 text-green-500 bg-background rounded-full" />
                            )}
                            {selectedBrd && progress.stages[2]?.isCurrent && (
                              <div className="absolute -top-0.5 -right-0.5 h-2.5 w-2.5 bg-blue-500 rounded-full ring-1 ring-blue-300 dark:ring-blue-700" />
                            )}
                          </div>
                          <span className="text-muted-foreground leading-tight flex-1 truncate">
                            Approved:
                          </span>
                          {selectedBrd ? (
                            progress.stages[2]?.isCompleted ? (
                              <CheckCircle2 className="h-3.5 w-3.5 text-green-500 flex-shrink-0" />
                            ) : progress.stages[2]?.isCurrent ? (
                              <div className="h-3.5 w-3.5 rounded-full bg-blue-500 flex-shrink-0 ring-1 ring-blue-300 dark:ring-blue-700" />
                            ) : (
                              <div className="h-3.5 w-3.5 rounded-full border border-muted-foreground/30 flex-shrink-0" />
                            )
                          ) : (
                            isProjectSelected &&
                            (isLoadingBrdCounts || !filteredBrdCounts ? (
                              <Skeleton className="h-4 w-6 flex-shrink-0 rounded" />
                            ) : (
                              <button
                                type="button"
                                className="flex-shrink-0 rounded-md hover-elevate active-elevate-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                onClick={() => {
                                  setBrdListCategory("approved");
                                  setBrdListDialogOpen(true);
                                }}
                                disabled={!isProjectSelected}
                                title="Approved BRDs ready for artifact generation"
                              >
                                <Badge
                                  variant="secondary"
                                  className="text-[10px] px-1.5 py-0 h-4 w-6 flex-shrink-0 border bg-green-500 dark:bg-green-500 text-white border-green-500 dark:border-green-500 flex items-center justify-center pointer-events-none"
                                >
                                  {String(
                                    filteredBrdCounts.approved ?? 0,
                                  ).padStart(2, "0")}
                                </Badge>
                              </button>
                            ))
                          )}
                        </div>
                        <button
                          className="flex items-start gap-1.5 sm:gap-2 text-[10px] sm:text-xs w-full text-left p-1 sm:p-1.5 rounded-md hover-elevate active-elevate-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                          onClick={() => {
                            if (selectedBrd) {
                              setSelectedBrdForPreview(selectedBrd.id);
                              setBrdPreviewDialogOpen(true);
                            } else {
                              setBrdListCategory("partiallyGenerated");
                              setBrdListDialogOpen(true);
                            }
                          }}
                          disabled={!isProjectSelected}
                          title={
                            selectedBrd
                              ? "Open selected BRD"
                              : "BRDs with artifacts currently being generated"
                          }
                        >
                          <div className="relative flex-shrink-0">
                            <Zap
                              className={`h-3 w-3 sm:h-3.5 sm:w-3.5 mt-0.5 ${selectedBrd && progress.stages[3]?.isCurrent
                                ? "text-blue-500"
                                : "text-muted-foreground"
                                }`}
                            />
                            {selectedBrd && progress.stages[3]?.isCompleted && (
                              <CheckCircle2 className="absolute -top-0.5 -right-0.5 h-2.5 w-2.5 text-green-500 bg-white rounded-full" />
                            )}
                            {selectedBrd && progress.stages[3]?.isCurrent && (
                              <div className="absolute -top-0.5 -right-0.5 h-2.5 w-2.5 bg-blue-500 rounded-full ring-1 ring-blue-300 dark:ring-blue-700" />
                            )}
                          </div>
                          <span className="text-muted-foreground leading-tight flex-1 truncate">
                            In Progress Artifacts:
                          </span>
                          {selectedBrd ? (
                            progress.stages[3]?.isCompleted ? (
                              <CheckCircle2 className="h-3.5 w-3.5 text-green-500 flex-shrink-0" />
                            ) : progress.stages[3]?.isCurrent ? (
                              <div className="h-3.5 w-3.5 rounded-full bg-blue-500 flex-shrink-0 ring-1 ring-blue-300 dark:ring-blue-700" />
                            ) : (
                              <div className="h-3.5 w-3.5 rounded-full border border-muted-foreground/30 flex-shrink-0" />
                            )
                          ) : (
                            isProjectSelected &&
                            (isLoadingBrdCounts || !filteredBrdCounts ? (
                              <Skeleton className="h-4 w-6 flex-shrink-0 rounded" />
                            ) : (
                              <Badge
                                variant="secondary"
                                className="text-[10px] px-1.5 py-0 h-4 w-6 flex-shrink-0 border bg-blue-500 dark:bg-blue-500 text-white border-blue-500 dark:border-blue-500 flex items-center justify-center"
                              >
                                {String(
                                  filteredBrdCounts.partiallyGenerated ?? 0,
                                ).padStart(2, "0")}
                              </Badge>
                            ))
                          )}
                        </button>
                        <button
                          className="flex items-start gap-1.5 sm:gap-2 text-[10px] sm:text-xs w-full text-left p-1 sm:p-1.5 rounded-md hover-elevate active-elevate-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                          onClick={() => {
                            if (selectedBrd) {
                              setSelectedBrdForPreview(selectedBrd.id);
                              setBrdPreviewDialogOpen(true);
                            } else {
                              setBrdListCategory("generated");
                              setBrdListDialogOpen(true);
                            }
                          }}
                          disabled={!isProjectSelected}
                          title={
                            selectedBrd
                              ? "Open selected BRD"
                              : "BRDs with all artifacts completed"
                          }
                        >
                          <div className="relative flex-shrink-0">
                            <Sparkles
                              className={`h-3 w-3 sm:h-3.5 sm:w-3.5 mt-0.5 ${selectedBrd && progress.stages[4]?.isCurrent
                                ? "text-blue-500"
                                : "text-muted-foreground"
                                }`}
                            />
                            {selectedBrd && progress.stages[4]?.isCompleted && (
                              <CheckCircle2 className="absolute -top-0.5 -right-0.5 h-2.5 w-2.5 text-green-500 bg-white rounded-full" />
                            )}
                            {selectedBrd && progress.stages[4]?.isCurrent && (
                              <div className="absolute -top-0.5 -right-0.5 h-2.5 w-2.5 bg-blue-500 rounded-full ring-1 ring-blue-300 dark:ring-blue-700" />
                            )}
                          </div>
                          <span className="text-muted-foreground leading-tight flex-1 truncate">
                            Completed Artifacts:
                          </span>
                          {selectedBrd ? (
                            progress.stages[4]?.isCompleted ? (
                              <CheckCircle2 className="h-3.5 w-3.5 text-green-500 flex-shrink-0" />
                            ) : progress.stages[4]?.isCurrent ? (
                              <div className="h-3.5 w-3.5 rounded-full bg-blue-500 flex-shrink-0 ring-1 ring-blue-300 dark:ring-blue-700" />
                            ) : (
                              <div className="h-3.5 w-3.5 rounded-full border border-muted-foreground/30 flex-shrink-0" />
                            )
                          ) : (
                            isProjectSelected &&
                            (isLoadingBrdCounts || !filteredBrdCounts ? (
                              <Skeleton className="h-4 w-6 flex-shrink-0 rounded" />
                            ) : (
                              <Badge
                                variant="secondary"
                                className="text-[10px] px-1.5 py-0 h-4 w-6 flex-shrink-0 border bg-purple-500 dark:bg-purple-500 text-white border-purple-500 dark:border-purple-500 flex items-center justify-center"
                              >
                                {String(
                                  filteredBrdCounts.generated ?? 0,
                                ).padStart(2, "0")}
                              </Badge>
                            ))
                          )}
                        </button>
                      </>
                    );
                  })()}
                </div>

                <Button
                  className="w-full"
                  size="sm"
                  data-testid="button-brd-generator-card"
                  onClick={() => {
                    if (!isProjectSelected) return;
                    const targetProjectId = selectedAdoProject?.id || projectId;
                    const targetProjectName =
                      selectedAdoProject?.name ||
                      projectData?.project?.name ||
                      projectName ||
                      "";
                    const brdProject =
                      (sdlcProjectData?.project as any) ||
                      (projectData?.project as any);
                    const goldenRepoRef =
                      brdProject?.goldenRepoReference ??
                      brdProject?.golden_repo_reference;
                    const goldenRepoNameFromProject =
                      (linkedGoldenRepoName as string) ||
                      (brdProject?.linkedGoldenRepoName as string) ||
                      (brdProject?.linked_golden_repo_name as string) ||
                      (goldenRepoRef?.repoName as string) ||
                      "";
                    const targetOrgName =
                      selectedOrganization ||
                      selectedAdoProject?.organization ||
                      projectData?.project?.organization ||
                      urlOrganizationName ||
                      "";

                    if (!targetOrgName || !targetProjectId) {
                      toast({
                        title: "Selection Required",
                        description:
                          "Please select a valid Organization and Project before generating a BRD.",
                        variant: "default",
                      });
                      return;
                    }

                    const params = new URLSearchParams();
                    params.append("projectId", targetProjectId);
                    if (targetProjectName)
                      params.append("projectName", targetProjectName);
                    params.append("organizationName", targetOrgName);
                    if (goldenRepoNameFromProject)
                      params.append(
                        "goldenRepoName",
                        goldenRepoNameFromProject,
                      );
                    setLocation(`/brd?${params.toString()}`);
                  }}
                  disabled={!isProjectSelected || isButtonLoading}
                  aria-disabled={!isProjectSelected || isButtonLoading}
                >
                  {isButtonLoading ? (
                    <>
                      <Loader2 className="animate-spin" />
                      Loading...
                    </>
                  ) : (
                    <>
                      <FileText />
                      BRD Generator
                    </>
                  )}
                </Button>
              </CardContent>
            </Card>

            {sdlcPhases.map((phase, index) => {
              const progress = getPhaseProgress(phase.id);

              return (
                <Card
                  key={phase.id}
                  className={`flex flex-col relative overflow-hidden ${isProjectSelected
                    ? "hover-elevate"
                    : "opacity-50 cursor-not-allowed"
                    }`}
                  data-testid={`card-phase-${phase.id}`}
                  onMouseEnter={() => {
                    if (!isProjectSelected) return;
                    // Mark phase as interacted when user hovers
                    setPhaseInteractions((prev) => new Set(prev).add(phase.id));
                    setPhaseVisibility((prev) => ({
                      ...prev,
                      [phase.id]: true,
                    }));
                  }}
                  onClick={(e) => {
                    // Allow clicks on interactive elements (links, buttons) to proceed normally
                    const target = e.target as HTMLElement;
                    const isInteractiveElement =
                      target.closest(
                        'a, button, [role="button"], input, select, textarea',
                      ) !== null;

                    if (isInteractiveElement) {
                      // Don't block clicks on interactive elements inside the card
                      return;
                    }

                    if (!isProjectSelected) return;
                    // Mark phase as interacted when user clicks
                    setPhaseInteractions((prev) => new Set(prev).add(phase.id));
                    setPhaseVisibility((prev) => ({
                      ...prev,
                      [phase.id]: true,
                    }));
                    // Update active phase to preserve on reload
                    updateActivePhase(phase.id);
                  }}
                  aria-disabled={!isProjectSelected}
                  ref={(el) => {
                    phaseRefs.current[phase.id] = el;
                  }}
                >
                  <CardContent className="p-3 sm:p-4 flex flex-col h-full">
                    {/* Phase Icon and Name */}
                    <div className="flex items-center justify-between gap-2 mb-2.5 sm:mb-3">
                      <div className="flex items-center gap-2 sm:gap-3 min-w-0">
                        <div
                          className={`p-1.5 sm:p-2 rounded-lg bg-gradient-to-br ${phase.color} flex-shrink-0`}
                        >
                          <phase.icon className="h-4 w-4 sm:h-5 sm:w-5 text-white" />
                        </div>
                        <div className="flex flex-col min-w-0">
                          <div className="flex items-center gap-2 min-w-0">
                            <h3
                              className="font-semibold text-xs sm:text-sm leading-tight whitespace-nowrap truncate"
                              data-testid={`text-phase-name-${phase.id}`}
                            >
                              {phase.name}
                            </h3>
                            {/* (Deployment button moved to card footer - detailed controls shown below) */}
                            {progress >= 80 && (
                              <CheckCircle2
                                className="h-4 w-4 text-green-500 flex-shrink-0"
                                data-testid={`icon-phase-complete-${phase.id}`}
                              />
                            )}
                          </div>
                          {/* Provider badge for Build & Deployment phases */}
                          {(phase.id === 5 || phase.id === 6) && isProjectSelected && (
                            <span className={`text-[9px] leading-tight font-medium truncate ${
                              hasBuildDeployConfig
                                ? "text-emerald-600 dark:text-emerald-400"
                                : "text-amber-600 dark:text-amber-400"
                            }`}>
                              {hasBuildDeployConfig
                                ? isGitLabProvider
                                  ? "GitLab CI — Configured"
                                  : isGithubProvider
                                    ? "GitHub Actions — Configured"
                                    : isBitbucketProvider
                                      ? "Bitbucket Pipelines — Configured"
                                      : "Azure DevOps — Configured"
                                : "CI/CD not configured"}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    <CreatePipelineModal
                      open={createPipelineModalOpen}
                      onOpenChange={setCreatePipelineModalOpen}
                      projectId={apiProjectId}
                      projectName={activeAdoProject?.name}
                      adoOrganization={activeAdoProject?.organization}
                      providerSegment={buildDeploySegment}
                    />

                    {/* Features List */}
                    <div className="space-y-2 mb-4 flex-1">
                      {phase.id === 6 && (
                        <p className="text-[9px] text-muted-foreground leading-tight -mt-0.5 mb-0.5">
                          Separate list counts
                        </p>
                      )}
                      {phase.id === 3
                        ? // Development phase: Show features in organized format
                        (() => {
                          const storyProgressFeature = phase.features[0]; // Story Progress
                          const specsFeature = phase.features[1]; // Specs
                          const developerAssignmentsFeature =
                            phase.features[2]; // Developer Assignments
                          const velocityIndicatorsFeature = phase.features[3]; // Velocity Indicators
                          const allStateFeatures = phase.features.slice(4); // New, Active, Resolved, Closed, Reopened

                          // Filter state features to only show "Reopened" if it exists in ADO
                          const stateFeatures = allStateFeatures.filter(
                            (feature: any) => {
                              if (
                                feature.label.toLowerCase() === "reopened"
                              ) {
                                // Only show Reopened if it exists in backlog data
                                return (
                                  backlogData?.availableStates?.includes(
                                    "Reopened",
                                  ) || backlogData?.stateCounts?.["Reopened"]
                                );
                              }
                              return true; // Always show other states
                            },
                          );

                          const storyProgressFeatureType = getFeatureType(
                            storyProgressFeature.label,
                          );
                          const isStoryProgressClickable =
                            storyProgressFeatureType !== null &&
                            apiProjectId &&
                            !disablePhaseInteractions &&
                            isProjectSelected;

                          const isSpecsClickable =
                            apiProjectId &&
                            !disablePhaseInteractions &&
                            isProjectSelected;

                          const developerAssignmentsFeatureType =
                            getFeatureType(developerAssignmentsFeature.label);
                          const isDeveloperAssignmentsClickable =
                            developerAssignmentsFeatureType !== null &&
                            apiProjectId &&
                            !disablePhaseInteractions &&
                            isProjectSelected;

                          const velocityIndicatorsFeatureType =
                            getFeatureType(velocityIndicatorsFeature.label);
                          const isVelocityIndicatorsClickable =
                            velocityIndicatorsFeatureType !== null &&
                            apiProjectId &&
                            !disablePhaseInteractions &&
                            isProjectSelected;

                          return (
                            <div className="space-y-0.5 sm:space-y-1">
                              {/* Story Progress */}
                              <div className="flex items-center gap-1 sm:gap-1.5">
                                <button
                                  className={`flex items-start gap-1.5 sm:gap-2 text-[10px] sm:text-xs flex-1 min-w-0 text-left p-1 sm:p-1.5 rounded-md ${isStoryProgressClickable
                                    ? "hover-elevate active-elevate-2 cursor-pointer"
                                    : "cursor-not-allowed"
                                    }`}
                                  onClick={() => {
                                    if (!isStoryProgressClickable) return;
                                    openPhaseFeatureDialog(
                                      storyProgressFeature.label,
                                      phase.name,
                                      phase.id,
                                    );
                                  }}
                                  disabled={!isStoryProgressClickable}
                                  data-testid={`feature-${phase.id}-0`}
                                >
                                  <storyProgressFeature.icon className="h-3 w-3 sm:h-3.5 sm:w-3.5 flex-shrink-0 mt-0.5 text-muted-foreground" />
                                  <span className="text-muted-foreground leading-tight whitespace-nowrap truncate flex-1">
                                    {storyProgressFeature.label}
                                  </span>
                                </button>
                              </div>

                              {/* Specs (opens Development Specs modal) */}
                              <div className="flex items-center gap-1 sm:gap-1.5">
                                <button
                                  className={`flex items-start gap-1.5 sm:gap-2 text-[10px] sm:text-xs flex-1 min-w-0 text-left p-1 sm:p-1.5 rounded-md ${isSpecsClickable
                                    ? "hover-elevate active-elevate-2 cursor-pointer"
                                    : "cursor-not-allowed"
                                    }`}
                                  onClick={() => {
                                    if (!isSpecsClickable) return;
                                    const specsParams = new URLSearchParams();
                                    if (apiProjectId) {
                                      specsParams.set(
                                        "projectId",
                                        apiProjectId,
                                      );
                                    }
                                    if (selectedAdoProject?.organization) {
                                      specsParams.set(
                                        "organization",
                                        selectedAdoProject.organization,
                                      );
                                    }
                                    if (selectedAdoProject?.name) {
                                      specsParams.set(
                                        "projectName",
                                        selectedAdoProject.name,
                                      );
                                    }
                                    if (selectedAdoProject?.organizationUrl) {
                                      specsParams.set(
                                        "organizationUrl",
                                        selectedAdoProject.organizationUrl,
                                      );
                                    }
                                    if (isJira) {
                                      specsParams.set("integrationType", "jira");
                                    }
                                    setLocation(
                                      `/specs?${specsParams.toString()}`,
                                    );
                                  }}
                                  disabled={!isSpecsClickable}
                                  data-testid={`feature-${phase.id}-specs`}
                                >
                                  <specsFeature.icon className="h-3 w-3 sm:h-3.5 sm:w-3.5 flex-shrink-0 mt-0.5 text-muted-foreground" />
                                  <span className="text-muted-foreground leading-tight whitespace-nowrap truncate flex-1">
                                    {specsFeature.label}
                                  </span>
                                </button>
                              </div>

                              {/* Work Items group with state children */}
                              <div className="space-y-0.5 sm:space-y-1">
                                <div className="flex items-start gap-1.5 sm:gap-2 text-[10px] sm:text-xs p-1 sm:p-1.5">
                                  <Briefcase className="h-3 w-3 sm:h-3.5 sm:w-3.5 flex-shrink-0 mt-0.5 text-muted-foreground" />
                                  <span className="text-muted-foreground leading-tight whitespace-nowrap truncate flex-1 font-medium">
                                    Work Items
                                  </span>
                                </div>
                                <div className="pl-4 sm:pl-6 space-y-0.5 sm:space-y-1">
                                  {stateFeatures.map(
                                    (feature: any, idx: number) => {
                                      const featureType = getFeatureType(
                                        feature.label,
                                      );
                                      const normalizedFeatureLabel =
                                        feature.label
                                          .toLowerCase()
                                          .replace(/\s+/g, "");
                                      const isClickable =
                                        featureType !== null &&
                                        apiProjectId &&
                                        !disablePhaseInteractions &&
                                        isProjectSelected;
                                      const featureCount = getFeatureCount(
                                        phase.id,
                                        feature.label,
                                      );
                                      const showBadge = activeAdoProject || (isJira && dbProjectId !== "default");

                                      return (
                                        <div
                                          key={idx + 1}
                                          className="flex items-center gap-1 sm:gap-1.5"
                                        >
                                          <button
                                            className={`flex items-start gap-1.5 sm:gap-2 text-[10px] sm:text-xs flex-1 min-w-0 text-left p-1 sm:p-1.5 rounded-md ${isClickable
                                              ? "hover-elevate active-elevate-2 cursor-pointer"
                                              : "cursor-not-allowed"
                                              }`}
                                            onClick={() => {
                                              if (!isClickable) return;
                                              openPhaseFeatureDialog(
                                                feature.label,
                                                phase.name,
                                                phase.id,
                                              );
                                            }}
                                            disabled={!isClickable}
                                            data-testid={`feature-${phase.id}-${idx + 1
                                              }`}
                                          >
                                            <feature.icon className="h-3 w-3 sm:h-3.5 sm:w-3.5 flex-shrink-0 mt-0.5 text-muted-foreground" />
                                            <span className="text-muted-foreground leading-tight whitespace-nowrap truncate flex-1">
                                              {feature.label}
                                            </span>
                                            {showBadge &&
                                              (() => {
                                                // Get badge color based on feature label - only use colors for specific statuses
                                                // All other badges should be gray for consistency
                                                const getBadgeColor = (
                                                  label: string,
                                                ) => {
                                                  const normalizedLabel = label
                                                    .toLowerCase()
                                                    .trim();
                                                  // Only apply colors for specific status labels
                                                  if (
                                                    normalizedLabel === "new"
                                                  ) {
                                                    return "bg-yellow-600 dark:bg-yellow-600 text-white border-yellow-600 dark:border-yellow-600";
                                                  } else if (
                                                    normalizedLabel === "active"
                                                  ) {
                                                    return "bg-blue-500 dark:bg-blue-500 text-white border-blue-500 dark:border-blue-500";
                                                  } else if (
                                                    normalizedLabel ===
                                                    "resolved"
                                                  ) {
                                                    return "bg-orange-600 dark:bg-orange-600 text-white border-orange-600 dark:border-orange-600";
                                                  } else if (
                                                    normalizedLabel === "closed"
                                                  ) {
                                                    return "bg-green-500 dark:bg-green-500 text-white border-green-500 dark:border-green-500";
                                                  }
                                                  // All other badges use gray/secondary for consistency
                                                  return "bg-secondary text-secondary-foreground border-border";
                                                };

                                                // Format count as double digit
                                                // Check if count is loading
                                                const isCountLoading =
                                                  isFeatureCountLoading(
                                                    phase.id,
                                                    feature.label,
                                                  );

                                                const formattedCount =
                                                  featureCount
                                                    .toString()
                                                    .padStart(2, "0");

                                                return isCountLoading ? (
                                                  <Skeleton className="h-4 w-6 flex-shrink-0 rounded" />
                                                ) : (
                                                  <Badge
                                                    variant="secondary"
                                                    className={`text-[10px] px-1.5 py-0 h-4 flex-shrink-0 border ${getBadgeColor(feature.label)}`}
                                                    data-testid={`badge-count-${phase.id
                                                      }-${idx + 1}`}
                                                  >
                                                    {formattedCount}
                                                  </Badge>
                                                );
                                              })()}
                                          </button>
                                        </div>
                                      );
                                    },
                                  )}
                                </div>
                              </div>

                              {/* Developer Assignments */}
                              <div className="flex items-center gap-1 sm:gap-1.5">
                                <button
                                  className={`flex items-start gap-1.5 sm:gap-2 text-[10px] sm:text-xs flex-1 min-w-0 text-left p-1 sm:p-1.5 rounded-md ${isDeveloperAssignmentsClickable
                                    ? "hover-elevate active-elevate-2 cursor-pointer"
                                    : "cursor-not-allowed"
                                    }`}
                                  onClick={() => {
                                    if (!isDeveloperAssignmentsClickable)
                                      return;
                                    setDeveloperAssignmentsModalOpen(true);
                                  }}
                                  disabled={!isDeveloperAssignmentsClickable}
                                  data-testid={`feature-${phase.id}-developer-assignments`}
                                >
                                  <developerAssignmentsFeature.icon className="h-3 w-3 sm:h-3.5 sm:w-3.5 flex-shrink-0 mt-0.5 text-muted-foreground" />
                                  <span className="text-muted-foreground leading-tight whitespace-nowrap truncate flex-1">
                                    {developerAssignmentsFeature.label}
                                  </span>
                                </button>
                              </div>

                              {/* Velocity Indicators */}
                              <div className="flex items-center gap-1 sm:gap-1.5">
                                <button
                                  className={`flex items-start gap-1.5 sm:gap-2 text-[10px] sm:text-xs flex-1 min-w-0 text-left p-1 sm:p-1.5 rounded-md ${isVelocityIndicatorsClickable
                                    ? "hover-elevate active-elevate-2 cursor-pointer"
                                    : "cursor-not-allowed"
                                    }`}
                                  onClick={() => {
                                    if (!isVelocityIndicatorsClickable)
                                      return;
                                    setVelocityIndicatorsModalOpen(true);
                                  }}
                                  disabled={!isVelocityIndicatorsClickable}
                                  data-testid={`feature-${phase.id}-velocity-indicators`}
                                >
                                  <velocityIndicatorsFeature.icon className="h-3 w-3 sm:h-3.5 sm:w-3.5 flex-shrink-0 mt-0.5 text-muted-foreground" />
                                  <span className="text-muted-foreground leading-tight whitespace-nowrap truncate flex-1">
                                    {velocityIndicatorsFeature.label}
                                  </span>
                                </button>
                              </div>
                            </div>
                          );
                        })()
                        : // Other phases: Show features normally
                        phase.features.map((feature: any, idx: number) => {
                          const featureType = getFeatureType(feature.label);
                          const normalizedFeatureLabel = feature.label
                            .toLowerCase()
                            .replace(/\s+/g, "");
                          const isWorkflowArtifactFeature =
                            phase.id === 1 &&
                            (normalizedFeatureLabel.includes("workitems") ||
                              normalizedFeatureLabel.includes("workitem") ||
                              normalizedFeatureLabel.includes(
                                "userstories",
                              ) ||
                              normalizedFeatureLabel.includes("userstory") ||
                              normalizedFeatureLabel.includes("epic") ||
                              normalizedFeatureLabel.includes("feature") ||
                              normalizedFeatureLabel.includes("requirement"));
                          const isBuildAndTestingFeature =
                            phase.id === 5 ||
                            phase.name.toLowerCase().includes("build");
                          const isTestingFeature =
                            phase.id === 4 ||
                            phase.name.toLowerCase().includes("testing");
                          const isDeploymentFeature =
                            phase.id === 6 ||
                            phase.name.toLowerCase().includes("deployment");
                          const isDesignFeature =
                            phase.id === 2 ||
                            phase.name.toLowerCase().includes("design");
                          const hasActiveProject = !!activeAdoProject || (isJira && dbProjectId !== "default");
                          const isClickable =
                            !disablePhaseInteractions &&
                            isProjectSelected &&
                            ((featureType !== null && apiProjectId) ||
                              (isWorkflowArtifactFeature &&
                                hasWorkflowArtifacts) ||
                              (isWorkflowArtifactFeature && apiProjectId) ||
                              (isBuildAndTestingFeature && hasActiveProject) ||
                              (isTestingFeature && apiProjectId) ||
                              (isDeploymentFeature && hasActiveProject) ||
                              (isDesignFeature && hasActiveProject));
                          const showCheckbox =
                            isCategoryFeature(feature.label) &&
                            phase.id !== 1; // Hide checkboxes for phase 1
                          const isCompleted = showCheckbox
                            ? isFeatureCategoryCompleted(
                              phase.id,
                              feature.label,
                            )
                            : false;
                          const isFigmaLink = feature.label
                            .toLowerCase()
                            .includes("figma link");
                          const featureCount = getFeatureCount(
                            phase.id,
                            feature.label,
                          );
                          const isDocumentsFeature =
                            normalizedFeatureLabel.includes("document");
                          // Show badge when project is selected (ADO or Jira)
                          const showBadge = !!activeAdoProject || (isJira && dbProjectId !== "default");

                          return (
                            <div
                              key={idx}
                              className="flex items-center gap-1 sm:gap-1.5"
                            >
                              <button
                                className={`flex items-start gap-1.5 sm:gap-2 text-[10px] sm:text-xs flex-1 min-w-0 text-left p-1 sm:p-1.5 rounded-md ${isClickable
                                  ? "hover-elevate active-elevate-2 cursor-pointer"
                                  : "cursor-not-allowed"
                                  }`}
                                onClick={() => {
                                  if (!isClickable) return;

                                  // Handle Generate Guideline feature specifically
                                  if (
                                    feature.label === "Generate Guideline"
                                  ) {
                                    handleGenerateGuidelineClick();
                                    return;
                                  }

                                  // Handle Build phase features (phase 5) - these open specific modals
                                  if (
                                    phase.id === 5 ||
                                    phase.name.toLowerCase().includes("build")
                                  ) {
                                    openPhaseFeatureDialog(
                                      feature.label,
                                      phase.name,
                                      phase.id,
                                    );
                                    return;
                                  }

                                  // Handle Testing phase Automation Scripts - open file browser modal (only if count > 0)
                                  if (
                                    phase.id === 4 &&
                                    phase.name
                                      .toLowerCase()
                                      .includes("testing") &&
                                    feature.label === "Automation Scripts" &&
                                    automationScriptsCount > 0
                                  ) {
                                    openFileBrowserModal(
                                      selectedOrganization,
                                      selectedAdoProject,
                                      projectName,
                                    );
                                    return;
                                  }

                                  // Handle Testing phase Test Plans - open test plan generation/view modal
                                  if (
                                    phase.id === 4 &&
                                    phase.name
                                      .toLowerCase()
                                      .includes("testing") &&
                                    feature.label === "Test Plans"
                                  ) {
                                    setTestPlanModalOpen(true);
                                    return;
                                  }

                                  // Handle Testing phase Synthetic Test Data - navigate to test data generation page
                                  if (
                                    phase.id === 4 &&
                                    phase.name
                                      .toLowerCase()
                                      .includes("testing") &&
                                    feature.label === "Synthetic Test Data"
                                  ) {
                                    const params = new URLSearchParams();
                                    if (selectedAdoProject?.name)
                                      params.append(
                                        "projectName",
                                        selectedAdoProject.name,
                                      );
                                    if (selectedAdoProject?.organization)
                                      params.append(
                                        "organization",
                                        selectedAdoProject.organization,
                                      );
                                    const qs = params.toString();
                                    setLocation(
                                      apiProjectId
                                        ? `/test-data-generation/${apiProjectId}${qs ? `?${qs}` : ""}`
                                        : `/test-data-generation${qs ? `?${qs}` : ""}`,
                                    );
                                    return;
                                  }

                                  // Handle Testing phase API Testing
                                  if (
                                    phase.id === 4 &&
                                    phase.name
                                      .toLowerCase()
                                      .includes("testing") &&
                                    feature.label === "API testing"
                                  ) {
                                    const params = new URLSearchParams();
                                    if (selectedAdoProject?.name)
                                      params.append(
                                        "projectName",
                                        selectedAdoProject.name,
                                      );
                                    if (selectedAdoProject?.organization)
                                      params.append(
                                        "organization",
                                        selectedAdoProject.organization,
                                      );
                                    if (apiProjectId)
                                      params.append("projectId", apiProjectId);
                                    const qs = params.toString();
                                    setLocation(
                                      apiProjectId
                                        ? `/api-testing/${encodeURIComponent(apiProjectId)}?${qs}`
                                        : `/api-testing?${qs}`,
                                    );
                                    return;
                                  }

                                  // Handle Testing phase Test Cases - navigate to test cases view page
                                  if (
                                    phase.id === 4 &&
                                    phase.name
                                      .toLowerCase()
                                      .includes("testing") &&
                                    feature.label === "Test Cases"
                                  ) {
                                    if (apiProjectId) {
                                      const params = new URLSearchParams();
                                      if (selectedAdoProject?.name)
                                        params.append(
                                          "projectName",
                                          selectedAdoProject.name,
                                        );
                                      if (selectedAdoProject?.organization)
                                        params.append(
                                          "organization",
                                          selectedAdoProject.organization,
                                        );
                                      setLocation(
                                        `/test-cases-view/${apiProjectId}?${params.toString()}`,
                                      );
                                    } else {
                                      toast({
                                        title: "Error",
                                        description:
                                          "Please select a project first",
                                        variant: "destructive",
                                      });
                                    }
                                    return;
                                  }

                                  // Handle Testing phase BDD Feature Files - navigate to BDD files view page
                                  if (
                                    phase.id === 4 &&
                                    phase.name
                                      .toLowerCase()
                                      .includes("testing") &&
                                    feature.label === "BDD Feature Files"
                                  ) {
                                    if (apiProjectId) {
                                      const params = new URLSearchParams();
                                      if (selectedAdoProject?.name)
                                        params.append(
                                          "projectName",
                                          selectedAdoProject.name,
                                        );
                                      if (selectedAdoProject?.organization)
                                        params.append(
                                          "organization",
                                          selectedAdoProject.organization,
                                        );
                                      setLocation(
                                        `/bdd-files-view/${apiProjectId}?${params.toString()}`,
                                      );
                                    } else {
                                      toast({
                                        title: "Error",
                                        description:
                                          "Please select a project first",
                                        variant: "destructive",
                                      });
                                    }
                                    return;
                                  }

                                  // Handle Testing phase BDD Step Definition Files - navigate to step definitions view page
                                  if (
                                    phase.id === 4 &&
                                    phase.name
                                      .toLowerCase()
                                      .includes("testing") &&
                                    feature.label ===
                                    "BDD Step Definition Files"
                                  ) {
                                    if (apiProjectId) {
                                      const params = new URLSearchParams();
                                      if (selectedAdoProject?.name)
                                        params.append(
                                          "projectName",
                                          selectedAdoProject.name,
                                        );
                                      if (selectedAdoProject?.organization)
                                        params.append(
                                          "organization",
                                          selectedAdoProject.organization,
                                        );
                                      setLocation(
                                        `/bdd-step-definitions-view/${apiProjectId}?${params.toString()}`,
                                      );
                                    } else {
                                      toast({
                                        title: "Error",
                                        description:
                                          "Please select a project first",
                                        variant: "destructive",
                                      });
                                    }
                                    return;
                                  }

                                  // Handle Testing phase E2E Scenarios - placeholder for future implementation
                                  if (
                                    phase.id === 4 &&
                                    phase.name
                                      .toLowerCase()
                                      .includes("testing") &&
                                    feature.label === "End-To-End Scenarios"
                                  ) {
                                    toast({
                                      title: "Coming Soon",
                                      description: `${feature.label} functionality will be available soon.`,
                                    });
                                    return;
                                  }

                                  // Handle Testing phase QE Capability - open QE in new tab
                                  if (
                                    phase.id === 4 &&
                                    phase.name
                                      .toLowerCase()
                                      .includes("testing") &&
                                    feature.label === "QE Capability"
                                  ) {
                                    const qeParams = new URLSearchParams();
                                    qeParams.set("source", "devx");
                                    if (apiProjectId)
                                      qeParams.set("sdlcProjectId", apiProjectId);
                                    if (selectedAdoProject?.name)
                                      qeParams.set("sdlcProjectName", selectedAdoProject.name);
                                    if (selectedAdoProject?.organization)
                                      qeParams.set("organization", selectedAdoProject.organization);
                                    if (selectedAdoProject?.name)
                                      qeParams.set("adoProjectName", selectedAdoProject.name);
                                    const qeProject = (sdlcProjectData?.project as any) || (projectData?.project as any);
                                    const qeGoldenRef = qeProject?.goldenRepoReference ?? qeProject?.golden_repo_reference;
                                    const qeGoldenRepoId = linkedGoldenRepoId || qeGoldenRef?.repoId || "";
                                    const qeGoldenRepoName = linkedGoldenRepoName || qeProject?.linkedGoldenRepoName || qeProject?.linked_golden_repo_name || qeGoldenRef?.repoName || "";
                                    if (qeGoldenRepoId)
                                      qeParams.set("goldenRepoId", qeGoldenRepoId);
                                    if (qeGoldenRepoName)
                                      qeParams.set("goldenRepoName", qeGoldenRepoName);
                                    window.open(
                                      `/qe/dashboard?${qeParams.toString()}`,
                                      "_blank",
                                    );
                                    return;
                                  }

                                  // Handle Testing phase Autonomous Testing - navigate to autonomous testing page
                                  if (
                                    phase.id === 4 &&
                                    phase.name
                                      .toLowerCase()
                                      .includes("testing") &&
                                    feature.label === "Autonomous Testing"
                                  ) {
                                    const params = new URLSearchParams();
                                    if (apiProjectId)
                                      params.append("projectId", apiProjectId);
                                    if (selectedAdoProject?.name)
                                      params.append(
                                        "projectName",
                                        selectedAdoProject.name,
                                      );
                                    if (selectedAdoProject?.organization)
                                      params.append(
                                        "organization",
                                        selectedAdoProject.organization,
                                      );
                                    const qs = params.toString();
                                    setLocation(
                                      `/autonomous-testing${qs ? `?${qs}` : ""}`,
                                    );
                                    return;
                                  }

                                  // Handle Testing phase features (phase 4) - open testing modal (fallback)
                                  if (
                                    phase.id === 4 ||
                                    phase.name
                                      .toLowerCase()
                                      .includes("testing")
                                  ) {
                                    setTestingModalOpen(true);
                                    return;
                                  }

                                  // Requirements feature should ALWAYS open PhaseFeatureDialog to show chat history
                                  if (
                                    normalizedFeatureLabel.includes(
                                      "requirement",
                                    )
                                  ) {
                                    openPhaseFeatureDialog(
                                      feature.label,
                                      phase.name,
                                      phase.id,
                                    );
                                    return;
                                  }

                                  // For workflow artifact features (Work Items, Epics, Features) in Phase 1:
                                  // Always use PhaseFeatureDialog for work-items/user-stories (new design)
                                  // For other workflow artifact features, still use RequirementArtifactsDialog if artifacts exist
                                  if (isWorkflowArtifactFeature) {
                                    // Always use new design for work items/user stories
                                    if (
                                      normalizedFeatureLabel.includes(
                                        "workitems",
                                      ) ||
                                      normalizedFeatureLabel.includes(
                                        "workitem",
                                      ) ||
                                      normalizedFeatureLabel.includes(
                                        "userstories",
                                      ) ||
                                      normalizedFeatureLabel.includes(
                                        "userstory",
                                      ) ||
                                      normalizedFeatureLabel.includes(
                                        "user-stories",
                                      ) ||
                                      normalizedFeatureLabel.includes(
                                        "user stories",
                                      ) ||
                                      normalizedFeatureLabel.includes(
                                        "work-items",
                                      ) ||
                                      normalizedFeatureLabel.includes(
                                        "work items",
                                      )
                                    ) {
                                      openPhaseFeatureDialog(
                                        feature.label,
                                        phase.name,
                                        phase.id,
                                      );
                                      return;
                                    }
                                    // For epics and features, use RequirementArtifactsDialog if artifacts exist
                                    if (hasWorkflowArtifacts) {
                                      if (
                                        normalizedFeatureLabel.includes(
                                          "epic",
                                        )
                                      ) {
                                        setRequirementArtifactsDefaultTab(
                                          "epics",
                                        );
                                      } else if (
                                        normalizedFeatureLabel.includes(
                                          "feature",
                                        )
                                      ) {
                                        setRequirementArtifactsDefaultTab(
                                          "features",
                                        );
                                      } else {
                                        setRequirementArtifactsDefaultTab(
                                          "overview",
                                        );
                                      }
                                      setRequirementArtifactsDialogOpen(true);
                                      return;
                                    } else {
                                      // No workflow artifacts exist, open PhaseFeatureDialog
                                      openPhaseFeatureDialog(
                                        feature.label,
                                        phase.name,
                                        phase.id,
                                      );
                                      return;
                                    }
                                  }
                                  // For other features, open PhaseFeatureDialog
                                  openPhaseFeatureDialog(
                                    feature.label,
                                    phase.name,
                                    phase.id,
                                  );
                                }}
                                disabled={!isClickable}
                                data-testid={`feature-${phase.id}-${idx}`}
                              >
                                {showCheckbox && (
                                  <Checkbox
                                    checked={isCompleted}
                                    className="h-3.5 w-3.5 flex-shrink-0 mt-0.5 pointer-events-none"
                                    data-testid={`checkbox-feature-${phase.id}-${idx}`}
                                  />
                                )}
                                <feature.icon className="h-3 w-3 sm:h-3.5 sm:w-3.5 flex-shrink-0 mt-0.5 text-muted-foreground" />
                                <span className="text-muted-foreground leading-tight whitespace-nowrap truncate flex-1">
                                  {feature.label}
                                </span>
                                {showBadge &&
                                  (() => {
                                    // Get badge color based on feature label - only use colors for specific statuses
                                    // All other badges should be gray for consistency
                                    const getBadgeColor = (label: string) => {
                                      const normalizedLabel = label
                                        .toLowerCase()
                                        .trim();
                                      // Only apply colors for specific status labels
                                      if (normalizedLabel === "new") {
                                        return "bg-yellow-600 dark:bg-yellow-600 text-white border-yellow-600 dark:border-yellow-600";
                                      } else if (
                                        normalizedLabel === "active"
                                      ) {
                                        return "bg-blue-500 dark:bg-blue-500 text-white border-blue-500 dark:border-blue-500";
                                      } else if (
                                        normalizedLabel === "resolved"
                                      ) {
                                        return "bg-orange-600 dark:bg-orange-600 text-white border-orange-600 dark:border-orange-600";
                                      } else if (
                                        normalizedLabel === "closed"
                                      ) {
                                        return "bg-green-500 dark:bg-green-500 text-white border-green-500 dark:border-green-500";
                                      }
                                      // All other badges use gray/secondary for consistency
                                      return "bg-secondary text-secondary-foreground border-border";
                                    };

                                    // Special handling for Testing phase features
                                    let displayCount = featureCount;
                                    if (
                                      phase.id === 4 &&
                                      phase.name
                                        .toLowerCase()
                                        .includes("testing")
                                    ) {
                                      if (
                                        feature.label
                                          .toLowerCase()
                                          .includes("manual")
                                      ) {
                                        displayCount = manualScriptsCount;
                                      } else if (
                                        feature.label
                                          .toLowerCase()
                                          .includes("automation")
                                      ) {
                                        displayCount = automationScriptsCount;
                                      } else if (
                                        feature.label === "Test Plans"
                                      ) {
                                        displayCount = testPlansCount;
                                      }
                                    }

                                    // Format count as double digit for consistency
                                    // Check if count is loading
                                    const isCountLoading =
                                      isFeatureCountLoading(
                                        phase.id,
                                        feature.label,
                                      );

                                    const formattedCount = displayCount
                                      .toString()
                                      .padStart(2, "0");

                                    return isCountLoading ? (
                                      <Skeleton className="h-4 w-6 flex-shrink-0 rounded" />
                                    ) : (
                                      <Badge
                                        variant="secondary"
                                        className={`text-[10px] px-1.5 py-0 h-4 flex-shrink-0 border ${getBadgeColor(feature.label)}`}
                                        data-testid={`badge-count-${phase.id}-${idx}`}
                                      >
                                        {formattedCount}
                                      </Badge>
                                    );
                                  })()}
                              </button>
                            </div>
                          );
                        })}
                      {/* Third-Party Integrations — appears after Deployment Trends (last feature in phase 7) */}
                      {phase.id === 7 && (
                        <div className="flex items-center gap-1 sm:gap-1.5">
                          <button
                            className={`flex items-start gap-1.5 sm:gap-2 text-[10px] sm:text-xs flex-1 min-w-0 text-left p-1 sm:p-1.5 rounded-md ${isProjectSelected && dbProjectId !== "default"
                                ? "hover-elevate active-elevate-2 cursor-pointer"
                                : "cursor-not-allowed opacity-60"
                              }`}
                            onClick={() => {
                              if (!isProjectSelected || dbProjectId === "default") return;
                              const projectName = projectData?.project?.name || activeAdoProject?.name || "";
                              const qs = projectName ? `?projectName=${encodeURIComponent(projectName)}` : "";
                              setLocation(`/sdlc/metrics/${dbProjectId}${qs}`);
                            }}
                            disabled={!isProjectSelected || dbProjectId === "default"}
                            data-testid="feature-7-integration-metrics"
                          >
                            <Activity className="h-3 w-3 sm:h-3.5 sm:w-3.5 flex-shrink-0 mt-0.5 text-muted-foreground" />
                            <span className="text-muted-foreground leading-tight whitespace-nowrap truncate flex-1">
                              Third-Party Integrations
                            </span>
                            {dbProjectId !== "default" && (
                              <Badge
                                variant="secondary"
                                className="text-[10px] px-1.5 py-0 h-4 flex-shrink-0 border bg-secondary text-secondary-foreground border-border"
                              >
                                {configuredIntegrationsCount.toString().padStart(2, "0")}
                              </Badge>
                            )}
                          </button>
                        </div>
                      )}
                    </div>
                    {/* Deployment details moved into CI/CD dialog - open via Deploy action */}

                    {/* Quality Metrics Display - Only for Requirement & Analysis phase */}
                    {phase.id === 1 && (
                      <div className="min-h-[80px]">
                        {workflowArtifactsLoading || !workflowArtifactsData ? (
                          // Show skeleton while loading
                          <>
                            <div className="border-t my-3" />
                            <div className="space-y-2 mb-4">
                              <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                                Quality Metrics
                              </div>
                              <div className="flex items-center justify-between text-xs p-2 rounded-md bg-muted/50">
                                <div className="flex items-center gap-1.5">
                                  <Skeleton className="h-3.5 w-3.5 rounded" />
                                  <Skeleton className="h-4 w-16" />
                                </div>
                                <Skeleton className="h-4 w-12 rounded" />
                              </div>
                            </div>
                          </>
                        ) : latestWorkflowArtifact &&
                          (shouldShowModifiedRow ||
                            latestWorkflowArtifact.approvalStatus) ? (
                          // Show actual content when loaded
                          <>
                            <div className="border-t my-3" />
                            <div className="space-y-2 mb-4">
                              <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                                Quality Metrics
                              </div>
                              {shouldShowModifiedRow && modifiedBadgeLabel && (
                                <div className="flex items-center justify-between text-xs p-2 rounded-md bg-muted/50">
                                  <div className="flex items-center gap-1.5">
                                    <Edit className="h-3.5 w-3.5 text-muted-foreground" />
                                    <span className="text-muted-foreground">
                                      Modified:
                                    </span>
                                  </div>
                                  <Badge
                                    variant="secondary"
                                    className="text-[10px] px-1.5 py-0 h-4 flex-shrink-0 border bg-secondary text-secondary-foreground border-border"
                                  >
                                    {modifiedBadgeLabel}
                                  </Badge>
                                </div>
                              )}
                              {latestWorkflowArtifact.approvalStatus && (
                                <div className="flex items-center justify-between text-xs p-2 rounded-md bg-muted/50">
                                  <div className="flex items-center gap-1.5">
                                    <CheckCircle2 className="h-3.5 w-3.5 text-muted-foreground" />
                                    <span className="text-muted-foreground">
                                      Approval:
                                    </span>
                                  </div>
                                  <Badge
                                    variant="secondary"
                                    className="text-[10px] px-1.5 py-0 h-4 flex-shrink-0 border bg-green-500 dark:bg-green-500 text-white border-green-500 dark:border-green-500"
                                  >
                                    {latestWorkflowArtifact.approvalStatus}
                                  </Badge>
                                </div>
                              )}
                            </div>
                          </>
                        ) : null}
                      </div>
                    )}

                    {/* Actions List - Only show if phase has actions */}
                    {phase.actions.length > 0 && (
                      <>
                        {/* Divider */}
                        <div className="border-t my-3" />

                        <div className="space-y-2 mb-4">
                          {phase.actions.map((action: any, idx: number) => {
                            const actionType = getActionType(action.label);
                            const isActionClickable =
                              actionType !== null &&
                              apiProjectId &&
                              !disablePhaseInteractions &&
                              isProjectSelected;

                            return (
                              <button
                                key={idx}
                                className={`flex items-start gap-2 text-xs w-full text-left p-1.5 rounded-md ${isActionClickable
                                  ? "hover-elevate active-elevate-2 cursor-pointer"
                                  : "cursor-not-allowed"
                                  }`}
                                onClick={() =>
                                  isActionClickable &&
                                  openCICDActionDialog(action.label, phase.name)
                                }
                                disabled={!isActionClickable}
                                data-testid={`action-${phase.id}-${idx}`}
                              >
                                <action.icon className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />
                                <span className="leading-tight whitespace-pre-line">
                                  {action.label}
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      </>
                    )}

                    {/* Run Build + Create Pipeline Buttons (only for Build phase) */}
                    {phase.id === 5 && (
                      <div className="flex flex-wrap gap-2 mt-2">
                        <Button
                          className="flex-1"
                          size="sm"
                          variant="default"
                          disabled={!isProjectSelected || !canRunBuild}
                          onClick={() => {
                            if (!canRunBuild) {
                              toast({
                                title: "CI/CD provider required",
                                description: "Configure a CI/CD integration before running a build.",
                                variant: "destructive",
                              });
                              return;
                            }
                            setRunBuildDialogOpen(true);
                          }}
                          data-testid="button-run-build"
                        >
                          <Rocket className="h-3.5 w-3.5 mr-1.5" />
                          Run Build
                        </Button>
                        <Button
                          className="flex-1"
                          size="sm"
                          variant="default"
                          disabled={!isProjectSelected || !canOpenPipelineStudio}
                          onClick={() => {
                            if (!canOpenPipelineStudio) {
                              return;
                            }
                            const params = new URLSearchParams();
                            if (apiProjectId) params.set("projectId", apiProjectId);
                            if (activeAdoProject?.organization) params.set("organization", activeAdoProject.organization);
                            if (activeAdoProject?.name) params.set("projectName", activeAdoProject.name);
                            if (pipelineStudioProviderSegment) params.set("provider", pipelineStudioProviderSegment);
                            setLocation(`/pipeline-studio?${params.toString()}`);
                          }}
                          data-testid="button-create-pipeline"
                        >
                          <Plus className="h-3.5 w-3.5 mr-1.5" />
                          Create Pipeline
                        </Button>
                        {showBuildProviderSetup && (
                          <div className="basis-full mt-0.5 flex items-center gap-1.5 rounded-md border border-border/60 bg-muted/30 px-2 py-1">
                            <AlertCircle className="h-3.5 w-3.5 text-amber-600 flex-shrink-0" />
                            <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">
                              CI/CD provider required
                            </span>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="h-6 px-1.5 text-[11px]"
                              onClick={openProjectIntegrationSetup}
                              data-testid="button-configure-build-provider"
                            >
                              <Settings className="h-3 w-3 mr-1" />
                              Setup
                            </Button>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Generate Design Button (only for Design phase) */}
                    {phase.id === 2 && (
                      <Button
                        className="w-full mt-2"
                        size="sm"
                        onClick={handleGenerateDesignClick}
                        disabled={
                          !isProjectSelected ||
                          isButtonLoading ||
                          isCheckingGuidelines
                        }
                        data-testid="button-generate-design-ai"
                        variant="default"
                      >
                        {isButtonLoading ? (
                          <>
                            <Loader2 className="animate-spin" />
                            Loading...
                          </>
                        ) : isCheckingGuidelines ? (
                          <>
                            <Loader2 className="animate-spin" />
                            Checking Guidelines...
                          </>
                        ) : (
                          <>
                            <Sparkles />
                            Generate Design
                          </>
                        )}
                      </Button>
                    )}

                    {/* Workflow Button (only for Requirement & Analysis phase) - Make it blue/primary */}
                    {(phase as any).workflowButton && (
                      <Link
                        href={`/workflow${(() => {
                          const params = new URLSearchParams();
                          // Priority 1: Use selected values from UI dropdowns (selectedOrganization and selectedAdoProject)
                          // Priority 2: Use URL params (from where user came from)
                          // Priority 3: Fall back to projectData only if above are not available

                          // Determine project ID - prefer selected from UI, then URL param, then projectData
                          const projectIdToUse =
                            selectedAdoProject?.id ||
                            urlProjectId ||
                            projectData?.project?.id ||
                            projectId;
                          if (projectIdToUse) {
                            // If we have selectedAdoProject with id, use adoProjectId, otherwise use projectId
                            if (
                              selectedAdoProject?.id &&
                              selectedAdoProject.id === projectIdToUse
                            ) {
                              const paramName = integrationType === "jira" ? "jiraProjectId" : "adoProjectId";
                              params.append(
                                paramName,
                                selectedAdoProject.id,
                              );
                            } else {
                              params.append("projectId", projectIdToUse);
                            }
                          }

                          // Determine organization - prefer selected from UI, then URL param, then projectData
                          const orgToUse =
                            selectedOrganization ||
                            urlOrganization ||
                            projectData?.project?.organization;
                          if (orgToUse) {
                            params.append("organizationName", orgToUse);
                          }

                          // Determine project name - prefer selected from UI, then URL param, then projectData
                          const nameToUse =
                            selectedAdoProject?.name ||
                            projectName ||
                            projectData?.project?.name;
                          if (nameToUse) {
                            params.append("projectName", nameToUse);
                          }

                          // Determine golden repo name - same resolution logic used elsewhere
                          const workflowProject =
                            (sdlcProjectData?.project as any) ||
                            (projectData?.project as any);
                          const workflowGoldenRepoRef =
                            workflowProject?.goldenRepoReference ??
                            workflowProject?.golden_repo_reference;
                          const workflowGoldenRepoName =
                            (workflowProject?.linkedGoldenRepoName as string) ||
                            (workflowProject?.linked_golden_repo_name as string) ||
                            (workflowGoldenRepoRef?.repoName as string) ||
                            "";
                          if (workflowGoldenRepoName) {
                            params.append(
                              "goldenRepoName",
                              workflowGoldenRepoName,
                            );
                          }

                          // Pass brdId if available from URL params
                          if (brdIdParam) {
                            params.append("brdId", brdIdParam);
                          }

                          return params.toString()
                            ? `?${params.toString()}`
                            : "";
                        })()}`}
                        onClick={handleWorkflowClick}
                        className={
                          !isProjectSelected ? "pointer-events-none" : ""
                        }
                      >
                        <Button
                          className="w-full mt-2"
                          size="sm"
                          variant="default"
                          data-testid="button-workflow"
                          disabled={!isProjectSelected || isButtonLoading}
                        >
                          {isButtonLoading ? (
                            <>
                              <Loader2 className="animate-spin" />
                              Loading...
                            </>
                          ) : (
                            <>
                              <phase.buttonIcon />
                              {phase.buttonText}
                            </>
                          )}
                        </Button>
                      </Link>
                    )}

                    {/* Test Artifacts Generation Button (only for Testing phase) */}
                    {(phase as any).testPlanButton && (
                      <Button
                        className="w-full mt-2"
                        size="sm"
                        variant="default"
                        onClick={() => {
                          if (apiProjectId) {
                            const params = new URLSearchParams();
                            if (selectedAdoProject?.name)
                              params.append(
                                "projectName",
                                selectedAdoProject.name,
                              );
                            if (selectedAdoProject?.organization)
                              params.append(
                                "organization",
                                selectedAdoProject.organization,
                              );
                            setLocation(
                              `/test-generation/${apiProjectId}?${params.toString()}`,
                            );
                          } else {
                            toast({
                              title: "Error",
                              description: "Please select a project first",
                              variant: "destructive",
                            });
                          }
                        }}
                        disabled={!isProjectSelected || isButtonLoading}
                        data-testid="button-generate-test-artifacts"
                      >
                        {isButtonLoading ? (
                          <>
                            <Loader2 className="animate-spin" />
                            Loading...
                          </>
                        ) : (
                          <>
                            <phase.buttonIcon />
                            {phase.buttonText}
                          </>
                        )}
                      </Button>
                    )}

                    {/* Generate Specs Button (only for Development phase) */}
                    {(phase as any).codeGenButton && (
                      <Link
                        href={`/specs${(() => {
                          const params = new URLSearchParams();
                          // Pass organization and project information to spec generation page
                          if (apiProjectId) {
                            params.append("projectId", apiProjectId);
                          }
                          if (selectedAdoProject?.organization) {
                            params.append("organization", selectedAdoProject.organization);
                          }
                          if (selectedAdoProject?.name) {
                            params.append(
                              "projectName",
                              selectedAdoProject.name,
                            );
                          }
                          if (selectedAdoProject?.organizationUrl) {
                            params.append(
                              "organizationUrl",
                              selectedAdoProject.organizationUrl,
                            );
                          }
                          if (isJira) {
                            params.append("integrationType", "jira");
                          }
                          return params.toString()
                            ? `?${params.toString()}`
                            : "";
                        })()}`}
                        className={
                          !isProjectSelected ? "pointer-events-none" : ""
                        }
                      >
                        <Button
                          className="w-full mt-2"
                          size="sm"
                          variant="default"
                          disabled={!isProjectSelected || isButtonLoading}
                          data-testid="button-generate-code"
                        >
                          {isButtonLoading ? (
                            <>
                              <Loader2 className="animate-spin" />
                              Loading...
                            </>
                          ) : (
                            <>
                              <phase.buttonIcon />
                              {phase.buttonText}
                            </>
                          )}
                        </Button>
                      </Link>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>

        <RequirementArtifactsDialog
          open={requirementArtifactsDialogOpen}
          onOpenChange={setRequirementArtifactsDialogOpen}
          defaultTab={requirementArtifactsDefaultTab}
          projectId={dbProjectId}
          projectName={activeAdoProject?.name || projectData?.project?.name}
          epics={combinedEpics as any}
          features={combinedFeatures as any}
          userStories={combinedUserStories as any}
          requirement={workflowRequirementText || null}
          artifactId={latestWorkflowArtifact?.id || null}
          personas={latestWorkflowArtifact?.personas || []}
          adoProjectId={activeAdoProject?.id || null}
          adoProjectName={activeAdoProject?.name || null}
          adoOrganization={activeAdoProject?.organization || null}
          adoOrganizationDisplay={
            // Prefer the human-readable organization shown in the SDLC header,
            // fall back to the ADO project's organization URL if needed.
            sdlcProjectData?.project?.organization ||
            activeAdoProject?.organizationUrl ||
            null
          }
          onArtifactUpdate={() => {
            // Invalidate and refetch workflow artifacts for the current project
            queryClient.invalidateQueries({
              queryKey: ["/api/workflow/artifacts", workflowProjectId],
            });

            // Also invalidate ADO work items to fetch newly pushed items from Azure DevOps
            if (activeAdoProject?.name) {
              queryClient.invalidateQueries({
                queryKey: [
                  `/api/hub/artifacts/${activeAdoProject.name}/work-items`,
                  artifactOrgId,
                  activeAdoProject.organizationUrl,
                ],
              });
            }
          }}
        />

        {/* Work Item Dialog */}
        {selectedWorkItemType && selectedPhaseId && apiProjectId && (
          <WorkItemDialog
            projectId={apiProjectId}
            phaseId={selectedPhaseId}
            phaseName={selectedPhaseName}
            type={selectedWorkItemType}
            open={dialogOpen}
            onOpenChange={setDialogOpen}
          />
        )}

        {/* Run Build Dialog */}
        {apiProjectId && buildDeploySegment && hasBuildDeployConfig && (
          <RunBuildDialog
            open={runBuildDialogOpen}
            onOpenChange={setRunBuildDialogOpen}
            projectId={apiProjectId}
            organization={activeAdoProject?.organization}
            projectName={activeAdoProject?.name}
            providerSegment={buildDeploySegment}
          />
        )}

        {/* CI/CD Action Dialog */}
        {apiProjectId && (
          <CICDActionDialog
            open={cicdDialogOpen}
            onOpenChange={setCicdDialogOpen}
            actionType={selectedActionType}
            projectId={apiProjectId}
            projectName={projectData?.project?.name || selectedAdoProject?.name || ""}
            adoOrganization={activeAdoProject?.organization}
            phaseName={actionPhaseName}
          />
        )}

        {/* Phase Feature Dialog */}
        {apiProjectId && (
          <PhaseFeatureDialog
            open={phaseFeatureDialogOpen}
            onOpenChange={setPhaseFeatureDialogOpen}
            featureType={selectedFeatureType as any}
            projectId={apiProjectId}
            dbProjectId={dbProjectId}
            projectName={
              projectData?.project?.name || selectedAdoProject?.name || ""
            }
            phaseName={featurePhaseName}
            phaseNumber={selectedPhaseNumber}
            artifactOrgId={selectedAdoProject?.artifactOrgId}
            organizationUrl={selectedAdoProject?.organizationUrl}
            adoProjectId={selectedAdoProject?.id}
            integrationType={integrationType}
          />
        )}

        {/* Confirmation Checkpoint Dialog */}
        {selectedPhaseForConfirmation && (
          <Dialog
            open={confirmationCheckpointDialogOpen}
            onOpenChange={setConfirmationCheckpointDialogOpen}
          >
            <DialogContent
              className="max-w-2xl"
              data-testid="dialog-confirmation-checkpoint"
            >
              <DialogHeader>
                <DialogTitle>Phase Confirmation Checkpoint</DialogTitle>
              </DialogHeader>
              <ConfirmationCheckpointContent
                phase={selectedPhaseForConfirmation}
                onSubmitConfirmation={handleSubmitConfirmation}
              />
            </DialogContent>
          </Dialog>
        )}

        {/* Confirmation Submission Dialog */}
        {selectedConfirmation && (
          <ConfirmationDialog
            open={confirmationDialogOpen}
            onOpenChange={setConfirmationDialogOpen}
            confirmation={selectedConfirmation}
            onSubmit={(data) => {
              updateConfirmationMutation.mutate({
                confirmationId: selectedConfirmation.id,
                data,
              });
            }}
          />
        )}

        {/* Development ADO Integration Modal */}
        {apiProjectId && selectedAdoProject && (
          <DevelopmentAdoModal
            projectId={apiProjectId}
            adoProject={selectedAdoProject}
            open={developmentModalOpen}
            onClose={() => setDevelopmentModalOpen(false)}
          />
        )}

        {/* Story Progress Modal */}
        {apiProjectId && selectedAdoProject && (
          <StoryProgressModal
            projectId={apiProjectId}
            adoProject={selectedAdoProject}
            integrationType={integrationType}
            open={storyProgressModalOpen}
            onClose={() => setStoryProgressModalOpen(false)}
          />
        )}

        {/* Developer Assignments Modal */}
        {apiProjectId && selectedAdoProject && (
          <DeveloperAssignmentsModal
            projectId={apiProjectId}
            adoProject={selectedAdoProject}
            integrationType={integrationType}
            open={developerAssignmentsModalOpen}
            onClose={() => setDeveloperAssignmentsModalOpen(false)}
          />
        )}

        {/* Velocity Indicators Modal */}
        {apiProjectId && selectedAdoProject && (
          <VelocityIndicatorsModal
            projectId={apiProjectId}
            adoProject={selectedAdoProject}
            integrationType={integrationType}
            open={velocityIndicatorsModalOpen}
            onClose={() => setVelocityIndicatorsModalOpen(false)}
          />
        )}

        {/* Status Modals */}
        {apiProjectId && selectedAdoProject && (
          <>
            <StatusModal
              projectId={apiProjectId}
              adoProject={selectedAdoProject}
              integrationType={integrationType}
              status="New"
              open={newStatusModalOpen}
              onClose={() => setNewStatusModalOpen(false)}
            />
            <StatusModal
              projectId={apiProjectId}
              adoProject={selectedAdoProject}
              integrationType={integrationType}
              status="Active"
              open={activeStatusModalOpen}
              onClose={() => setActiveStatusModalOpen(false)}
            />
            <StatusModal
              projectId={apiProjectId}
              adoProject={selectedAdoProject}
              integrationType={integrationType}
              status="Resolved"
              open={resolvedStatusModalOpen}
              onClose={() => setResolvedStatusModalOpen(false)}
            />
            <StatusModal
              projectId={apiProjectId}
              adoProject={selectedAdoProject}
              integrationType={integrationType}
              status="Closed"
              open={closedStatusModalOpen}
              onClose={() => setClosedStatusModalOpen(false)}
            />
            <StatusModal
              projectId={apiProjectId}
              adoProject={selectedAdoProject}
              integrationType={integrationType}
              status="Reopened"
              open={reopenedStatusModalOpen}
              onClose={() => setReopenedStatusModalOpen(false)}
            />
          </>
        )}

        {/* Deployment Management Modal */}
        {apiProjectId && selectedAdoProject && (
          <DeploymentModal
            projectId={apiProjectId}
            adoProject={selectedAdoProject}
            open={deploymentModalOpen}
            onClose={() => setDeploymentModalOpen(false)}
          />
        )}

        {/* Pipelines Modal */}
        {apiProjectId && selectedAdoProject && (
          <PipelinesModal
            projectId={apiProjectId}
            adoProject={selectedAdoProject}
            providerSegment={buildDeploySegment}
            open={pipelinesModalOpen}
            onClose={() => setPipelinesModalOpen(false)}
          />
        )}

        {/* Test Reports Modal */}
        {apiProjectId && selectedAdoProject && (
          <TestReportsModal
            projectId={apiProjectId}
            adoProject={selectedAdoProject}
            open={testReportsModalOpen}
            onClose={() => setTestReportsModalOpen(false)}
            providerSegment={buildDeploySegment}
          />
        )}

        {/* Testing Modals Component - handles both File Browser and User Stories modals */}
        {/* Comprehensive Testing Modal */}
        <ComprehensiveTestingModal
          open={testingModalOpen}
          onOpenChange={setTestingModalOpen}
          selectedAdoProject={selectedAdoProject}
          apiProjectId={apiProjectId}
          integrationType={integrationType}
        />

        <TestingModals
          fileBrowserModalOpen={fileBrowserModalOpen}
          setFileBrowserModalOpen={setFileBrowserModalOpen}
          userStoriesModalOpen={userStoriesModalOpen}
          setUserStoriesModalOpen={setUserStoriesModalOpen}
          testPlanModalOpen={testPlanModalOpen}
          setTestPlanModalOpen={setTestPlanModalOpen}
          fileBrowserContent={fileBrowserContent}
          setFileBrowserContent={setFileBrowserContent}
          manualScriptsCount={manualScriptsCount}
          automationScriptsCount={automationScriptsCount}
          selectedAdoProject={selectedAdoProject}
          apiProjectId={apiProjectId}
          integrationType={integrationType}
          onTestPlanSaved={() => setTestPlanRefetchKey((k) => k + 1)}
          onViewSavedTestPlans={() => setViewTestPlansModalOpen(true)}
        />

        {/* View Test Plans Modal */}
        <ViewTestPlansModal
          open={viewTestPlansModalOpen}
          onOpenChange={setViewTestPlansModalOpen}
          projectId={apiProjectId}
          organizationId={selectedOrganization || null}
        />

        {/* Test Cases Viewer Modal */}
        <TestCasesViewerModal
          open={testCasesModalOpen}
          onOpenChange={setTestCasesModalOpen}
          selectedAdoProject={selectedAdoProject}
          apiProjectId={apiProjectId}
        />

        {/* Packages Modal */}
        {apiProjectId && selectedAdoProject && (
          <PackagesModal
            projectId={apiProjectId}
            adoProject={selectedAdoProject}
            open={packagesModalOpen}
            onClose={() => setPackagesModalOpen(false)}
          />
        )}

        {/* Jobs Modal */}
        {apiProjectId && buildDeploySegment && hasBuildDeployConfig && (
          <JobsModal
            projectId={apiProjectId}
            adoProject={selectedAdoProject ?? undefined}
            providerSegment={buildDeploySegment}
            open={jobsModalOpen}
            onClose={() => setJobsModalOpen(false)}
          />
        )}

        {/* Build Status Metrics Modal */}
        {apiProjectId && selectedAdoProject && (
          <BuildStatusMetricsModal
            projectId={apiProjectId}
            adoProject={selectedAdoProject}
            providerSegment={buildDeploySegment}
            open={buildStatusMetricsModalOpen}
            onClose={() => setBuildStatusMetricsModalOpen(false)}
          />
        )}

        {/* Pipeline Modal */}
        {apiProjectId && selectedAdoProject && (
          <PipelineModal
            projectId={apiProjectId}
            adoProject={selectedAdoProject}
            providerSegment={buildDeploySegment}
            open={pipelineModalOpen}
            onClose={() => setPipelineModalOpen(false)}
          />
        )}

        {/* Deployment Status Modal */}
        {apiProjectId && selectedAdoProject && (
          <DeploymentStatusModal
            projectId={apiProjectId}
            adoProject={selectedAdoProject}
            providerSegment={buildDeploySegment}
            open={deploymentStatusModalOpen}
            onClose={() => setDeploymentStatusModalOpen(false)}
          />
        )}

        {/* Releases Modal */}
        {apiProjectId && selectedAdoProject && (
          <ReleasesModal
            projectId={apiProjectId}
            adoProject={selectedAdoProject}
            open={releasesModalOpen}
            onClose={() => setReleasesModalOpen(false)}
          />
        )}

        {/* Trigger Release Modal */}
        {apiProjectId && selectedAdoProject && (
          <TriggerReleaseModal
            projectId={apiProjectId}
            adoProject={selectedAdoProject}
            open={triggerReleaseModalOpen}
            onClose={() => setTriggerReleaseModalOpen(false)}
          />
        )}

        {/* Pipeline Health Modal */}
        {apiProjectId && selectedAdoProject && (
          <PipelineHealthModal
            projectId={apiProjectId}
            adoProject={selectedAdoProject}
            providerSegment={buildDeploySegment}
            open={pipelineHealthModalOpen}
            onClose={() => setPipelineHealthModalOpen(false)}
          />
        )}

        {/* Monitor Modal */}
        {apiProjectId && selectedAdoProject && (
          <MonitorModal
            projectId={apiProjectId}
            adoProject={selectedAdoProject}
            providerSegment={buildDeploySegment}
            open={monitorModalOpen}
            onClose={() => setMonitorModalOpen(false)}
          />
        )}

        {/* Error Tracking Modal */}
        {apiProjectId && (
          <ErrorTrackingModal
            projectId={apiProjectId}
            adoProject={selectedAdoProject}
            open={errorTrackingModalOpen}
            onClose={() => setErrorTrackingModalOpen(false)}
          />
        )}

        {/* Alerts Modal */}
        {apiProjectId && (
          <AlertsModal
            projectId={apiProjectId}
            adoProject={selectedAdoProject}
            open={alertsModalOpen}
            onClose={() => setAlertsModalOpen(false)}
          />
        )}

        {/* Deployment Trends Modal */}
        {apiProjectId && selectedAdoProject && (
          <DeploymentTrendsModal
            projectId={apiProjectId}
            adoProject={selectedAdoProject}
            providerSegment={buildDeploySegment}
            open={deploymentTrendsModalOpen}
            onClose={() => setDeploymentTrendsModalOpen(false)}
          />
        )}

        {/* Deployment Tracking Modal */}
        {apiProjectId && selectedAdoProject && (
          <DeploymentTrackingModal
            projectId={apiProjectId}
            adoProject={selectedAdoProject}
            providerSegment={buildDeploySegment}
            open={deploymentTrackingModalOpen}
            onClose={() => setDeploymentTrackingModalOpen(false)}
          />
        )}

        {/* AI Design Generation - Full Window View overlay */}
        {aiDesignDialogOpen && (
          <div className="absolute inset-0 bg-background z-50 flex flex-col h-full overflow-hidden">
            <div className="flex items-center gap-3 px-4 py-3 border-b min-w-0 shrink-0">
              <BackButton label="Back to SDLC" onClick={() => {
                setAiDesignDialogOpen(false);
                setSelectedDesignType("");
                setRequirementDocument("");
                setAdoDocuments([]);
                setSelectedAdoDocId("");
                setDesignEpicsList([]);
                setSelectedDesignEpicIds([]);
                setDesignUserStories([]);
                setSelectedDesignStoryIds([]);
                setEpicDetailsMap({});
                setIsFetchingEpicComments(false);
                setIsFetchingDesignEpics(false);
                setIsFetchingDesignStories(false);
                setGeneratedDesignContent("");
                setGeneratedFigmaPrompt("");
                setGeneratedFigmaLink("");
                setAdoWorkItemId("");
                setIsFigmaMode(false);
                setFigmaLinkInput("");
                setShowFigmaInput(false);
                setEpicTreeData([]);
              }} />
              <div className="flex flex-col min-w-0 overflow-hidden">
                <span className="font-semibold text-sm truncate">Design Prompt Generator</span>
                <span className="text-xs text-muted-foreground truncate">
                  {selectedAdoProject?.organization && selectedAdoProject?.name
                    ? `${selectedAdoProject.organization} / ${selectedAdoProject.name}`
                    : integrationType === "jira"
                      ? "Generate design prompts from Jira work items."
                      : "Generate design prompts from Azure DevOps Epics and User Stories."}
                </span>
              </div>
            </div>

            {/* Scrollable content area */}
            <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
              {/* Step 1: Epic Selection and User Story Selection */}
              {designStep === 1 && (
                <div className="space-y-4">
                  {/* Selection mode: pick by Epic, or jump straight to stories */}
                  <div className="flex items-center gap-1 rounded-lg border border-border bg-muted/30 p-1 w-fit">
                    <button
                      type="button"
                      onClick={() => handleDesignSelectionModeChange("epic")}
                      className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                        designSelectionMode === "epic"
                          ? "bg-background shadow-sm text-foreground"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {isJira ? "By Work Item" : "By Epic"}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDesignSelectionModeChange("story")}
                      className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                        designSelectionMode === "story"
                          ? "bg-background shadow-sm text-foreground"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {isJira ? "By Sub-item" : "By User Story"}
                    </button>
                  </div>

                  {/* Fetch Epics from ADO */}
                  <div className="space-y-4">
                    {/* Top row: selection label */}
                    <div className="flex items-center justify-between gap-3">
                      <label className="text-sm font-semibold">
                        {designSelectionMode === "epic"
                          ? `Select ${isJira ? "Work Item" : "Epic"} from ${integrationName}`
                          : `Select ${isJira ? "Sub-items" : "User Stories"} from ${integrationName}`}
                      </label>
                    </div>

                    {/* Uploaded files and Epic count in same row */}
                    <div className="flex items-center gap-3 flex-wrap">
                      {/* Epic count badge */}
                      {designSelectionMode === "epic" && designEpicsList.length > 0 && (
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-black dark:text-white font-semibold">
                            Epics:
                          </span>
                          <span className="text-xs border border-gray-300 text-gray-700 px-3 py-1.5 rounded font-medium bg-gray-50 dark:bg-gray-900 dark:border-gray-700 dark:text-gray-300">
                            {designEpicsList.length} found
                          </span>
                        </div>
                      )}

                      {/* Uploaded guidelines and golden repo guidelines count */}
                      {(uploadedGuidelineFiles.length > 0 ||
                        linkedGoldenRepoFilePaths.length > 0) && (
                          <div className="flex items-center gap-3 flex-wrap">
                            {/* Uploaded files from device */}
                            {uploadedGuidelineFiles.length > 0 && (
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-xs text-black dark:text-white font-semibold">
                                  Guidelines from Device:
                                </span>
                                {uploadedGuidelineFiles.map((file, index) => (
                                  <div
                                    key={index}
                                    className="flex items-center gap-1"
                                  >
                                    <span className="truncate border border-gray-300 text-gray-700 px-2.5 py-1 rounded text-xs font-medium max-w-xs bg-gray-50 dark:bg-gray-900 dark:border-gray-700 dark:text-gray-300">
                                      {file.name}
                                    </span>
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      onClick={() => handleRemoveGuidelineFile(index)}
                                      className="h-5 w-5 p-0 text-xs"
                                    >
                                      ✕
                                    </Button>
                                  </div>
                                ))}
                              </div>
                            )}

                            {/* Guidelines from golden repo */}
                            {linkedGoldenRepoFilePaths.length > 0 && (
                              <div className="flex items-center gap-2">
                                <span className="text-xs text-black dark:text-white font-semibold">
                                  Guidelines from Golden Repo:
                                </span>
                                <span className="text-xs border border-gray-300 text-gray-700 px-3 py-1.5 rounded font-medium bg-gray-50 dark:bg-gray-900 dark:border-gray-700 dark:text-gray-300">
                                  {linkedGoldenRepoFilePaths.length} selected
                                </span>
                              </div>
                            )}
                          </div>
                        )}
                    </div>

                    {/* Story-first search box (no epic) */}
                    {designSelectionMode === "story" && (
                      <div className="relative">
                        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                        <Input
                          value={designStorySearchQuery}
                          onChange={(e) =>
                            setDesignStorySearchQuery(e.target.value)
                          }
                          placeholder={`Search ${isJira ? "sub-items" : "user stories"} by title...`}
                          className="h-9 pl-8 pr-8 text-sm"
                        />
                        {designStorySearchQuery && (
                          <button
                            type="button"
                            onClick={() => setDesignStorySearchQuery("")}
                            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                            aria-label="Clear search"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    )}

                    {/* Epic multi-select (expand/collapse) */}
                    {designSelectionMode === "epic" && designEpicsList.length > 0 && (
                      <>
                        <div className="rounded-md border border-border bg-muted/30 overflow-hidden">
                          <button
                            type="button"
                            onClick={() => setEpicSelectionListExpanded((v) => !v)}
                            className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left hover:bg-accent/30 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-inset"
                            aria-expanded={epicSelectionListExpanded}
                            aria-label={
                              epicSelectionListExpanded
                                ? `Collapse ${isJira ? "work item" : "epic"} list`
                                : `Expand ${isJira ? "work item" : "epic"} list`
                            }
                          >
                            <span className="text-sm font-medium">
                              {isJira ? "Select Work Item(s)" : "Select Epic(s)"}
                            </span>
                            <span className="flex items-center gap-2">
                              {selectedDesignEpicIds.length > 0 && (
                                <span className="text-xs text-muted-foreground">
                                  {selectedDesignEpicIds.length} selected
                                </span>
                              )}
                              {epicSelectionListExpanded ? (
                                <ChevronUp className="h-4 w-4 shrink-0 text-muted-foreground" />
                              ) : (
                                <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                              )}
                            </span>
                          </button>
                          {epicSelectionListExpanded && (
                            <div className="border-t border-border">
                              <div className="relative px-3 py-2 border-b border-border/50">
                                <Search className="absolute left-5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                                <Input
                                  value={designEpicSearchQuery}
                                  onChange={(e) =>
                                    setDesignEpicSearchQuery(e.target.value)
                                  }
                                  placeholder={`Search ${isJira ? "work items" : "epics"} by title or #id...`}
                                  className="h-8 pl-8 pr-8 text-sm"
                                />
                                {designEpicSearchQuery && (
                                  <button
                                    type="button"
                                    onClick={() => setDesignEpicSearchQuery("")}
                                    className="absolute right-5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                                    aria-label="Clear search"
                                  >
                                    <X className="h-3.5 w-3.5" />
                                  </button>
                                )}
                              </div>
                              {(() => {
                                const q = designEpicSearchQuery.trim().toLowerCase();
                                const filteredEpics = q
                                  ? designEpicsList.filter((epic) => {
                                      const epicId =
                                        epic.id?.toString?.() ?? String(epic.id);
                                      return (
                                        (epic.title ?? "")
                                          .toLowerCase()
                                          .includes(q) ||
                                        epicId.toLowerCase().includes(q)
                                      );
                                    })
                                  : designEpicsList;

                                if (filteredEpics.length === 0) {
                                  return (
                                    <div className="px-3 py-6 text-center text-sm text-muted-foreground">
                                      No {isJira ? "work items" : "epics"} match
                                      "{designEpicSearchQuery}"
                                    </div>
                                  );
                                }

                                return (
                                  <div className="max-h-[200px] overflow-y-auto">
                              {filteredEpics.map((epic) => {
                                const epicId =
                                  epic.id?.toString?.() ?? String(epic.id);
                                const isSelected =
                                  selectedDesignEpicIds.includes(epicId);
                                return (
                                  <div
                                    key={epic.id}
                                    className={`flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-accent/50 ${isSelected ? "bg-accent/30" : ""}`}
                                    onClick={() => handleToggleDesignEpic(epicId)}
                                    data-testid={`option-design-epic-${epic.id}`}
                                  >
                                    <Checkbox
                                      checked={isSelected}
                                      className="pointer-events-none"
                                    />
                                    <span className="text-sm truncate flex-1">
                                      #{epic.id}: {epic.title}
                                    </span>
                                  </div>
                                );
                              })}
                                  </div>
                                );
                              })()}
                            </div>
                          )}
                        </div>

                        {isFetchingEpicComments && (
                          <div className="text-sm text-muted-foreground flex items-center gap-2">
                            <Loader2 className="h-3 w-3 animate-spin" />
                            Fetching epic details...
                          </div>
                        )}

                        {Object.keys(epicDetailsMap).length > 0 &&
                          !isFetchingEpicComments &&
                          (() => {
                            const designProject =
                              selectedAdoProject ||
                              allProjects?.find(
                                (p) =>
                                  p.name === projectName || p.id === urlProjectId,
                              );
                            const attachmentParams =
                              designProject?.organizationUrl && designProject?.name
                                ? `projectName=${encodeURIComponent(designProject.name)}&organizationUrl=${encodeURIComponent(designProject.organizationUrl)}`
                                : "";
                            const isImageFile = (name: string) =>
                              /\.(png|jpg|jpeg|gif|webp|bmp|svg)$/i.test(name);
                            return (
                              <div className="rounded-md border border-border bg-muted/30 overflow-hidden">
                                <div className="flex items-center justify-between gap-2 px-3 py-2">
                                  <span className="text-sm font-medium text-muted-foreground">
                                    Design & attachments
                                  </span>
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    className="h-7 w-7 p-0 shrink-0"
                                    onClick={() =>
                                      setEpicDesignSectionExpanded((v) => !v)
                                    }
                                    aria-label={
                                      epicDesignSectionExpanded
                                        ? "Collapse"
                                        : "Expand"
                                    }
                                  >
                                    {epicDesignSectionExpanded ? (
                                      <ChevronUp className="h-4 w-4" />
                                    ) : (
                                      <ChevronDown className="h-4 w-4" />
                                    )}
                                  </Button>
                                </div>
                                {epicDesignSectionExpanded && (
                                  <div className="px-3 pb-3 pt-0 border-t border-border/50 pt-3 space-y-4">
                                    {selectedDesignEpicIds.map((eid) => {
                                      const details = epicDetailsMap[eid];
                                      if (
                                        !details ||
                                        (!details.figmaLink &&
                                          details.attachments.length === 0)
                                      )
                                        return null;
                                      const epicMeta = designEpicsList.find(
                                        (e) => (e.id ?? "").toString() === eid,
                                      );
                                      const imageAttachments = (
                                        details.attachments || []
                                      ).filter((a) => isImageFile(a.name));
                                      return (
                                        <div key={eid} className="space-y-2">
                                          {epicMeta && (
                                            <span className="text-xs font-medium text-muted-foreground block">
                                              #{epicMeta.id}: {epicMeta.title}
                                            </span>
                                          )}
                                          <div className="flex flex-wrap items-center gap-3">
                                            {details.figmaLink && (
                                              <a
                                                href={details.figmaLink}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="inline-flex items-center gap-2 rounded-full bg-primary/10 px-4 py-2 text-sm font-medium text-primary hover:bg-primary/20 hover:text-primary transition-colors focus:outline-none focus:ring-2 focus:ring-primary/40 focus:ring-offset-2 focus:ring-offset-background shrink-0"
                                              >
                                                Generated Figma design
                                                <ExternalLink className="h-3.5 w-3.5 shrink-0 opacity-80" />
                                              </a>
                                            )}
                                            {imageAttachments.length > 0 && (
                                              <div className="flex flex-wrap gap-2">
                                                {imageAttachments.map((att) => {
                                                  const contentUrl =
                                                    attachmentParams
                                                      ? getApiUrl(
                                                        `/api/ado/epics/${eid}/attachments/${encodeURIComponent(att.id)}/content?fileName=${encodeURIComponent(att.name)}&${attachmentParams}`,
                                                      )
                                                      : "";
                                                  return contentUrl ? (
                                                    <a
                                                      key={att.id}
                                                      href={contentUrl}
                                                      target="_blank"
                                                      rel="noopener noreferrer"
                                                      className="inline-flex rounded-lg overflow-hidden border border-border/80 bg-background shadow-sm hover:shadow-md hover:scale-[1.02] focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-background transition-all duration-200"
                                                    >
                                                      <img
                                                        src={contentUrl}
                                                        alt={att.name}
                                                        className="h-16 w-16 object-cover object-center"
                                                      />
                                                    </a>
                                                  ) : null;
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
                            );
                          })()}
                      </>
                    )}
                  </div>

                  {isFetchingDesignStories && (
                    <div className="text-sm text-muted-foreground flex items-center gap-2">
                      <Loader2 className="h-3 w-3 animate-spin" />
                      {isJira ? "Fetching sub-items..." : "Fetching user stories..."}
                    </div>
                  )}

                        {designUserStories.length > 0 &&
                          !isFetchingDesignStories && (
                            <div className="space-y-3 border rounded-md p-3 bg-muted/30">
                              <div className="flex items-center justify-between">
                                <span className="text-sm font-medium">
                                  {isJira ? "Select Sub-items" : "Select User Stories"} (
                                  {selectedDesignStoryIds.length}/
                                  {designUserStories.length})
                                </span>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={handleSelectAllDesignStories}
                                  className="h-7 text-xs"
                                >
                                  {selectedDesignStoryIds.length ===
                                    designUserStories.length
                                    ? "Deselect All"
                                    : "Select All"}
                                </Button>
                              </div>

                              {/* Search + status filter */}
                              <div className="flex items-center gap-2 flex-wrap">
                                {designSelectionMode === "epic" && (
                                  <div className="relative flex-1 min-w-[160px]">
                                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                                    <Input
                                      value={designStorySearchQuery}
                                      onChange={(e) =>
                                        setDesignStorySearchQuery(e.target.value)
                                      }
                                      placeholder={`Search ${isJira ? "sub-items" : "user stories"}...`}
                                      className="h-8 pl-8 pr-8 text-sm"
                                    />
                                    {designStorySearchQuery && (
                                      <button
                                        type="button"
                                        onClick={() => setDesignStorySearchQuery("")}
                                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                                        aria-label="Clear search"
                                      >
                                        <X className="h-3.5 w-3.5" />
                                      </button>
                                    )}
                                  </div>
                                )}
                                <div className="flex items-center gap-1">
                                  {(
                                    [
                                      { key: "all", label: "All" },
                                      { key: "not-generated", label: "Not generated" },
                                      { key: "generated", label: "Generated" },
                                    ] as const
                                  ).map((opt) => (
                                    <button
                                      key={opt.key}
                                      type="button"
                                      onClick={() =>
                                        setDesignStoryStatusFilter(opt.key)
                                      }
                                      className={`px-2.5 py-1 rounded-full text-[11px] font-medium border transition-colors ${
                                        designStoryStatusFilter === opt.key
                                          ? "bg-primary/10 border-primary/40 text-primary"
                                          : "border-border text-muted-foreground hover:bg-accent/50"
                                      }`}
                                    >
                                      {opt.label}
                                    </button>
                                  ))}
                                </div>
                              </div>

                              {/* Traceability: source BRD for these stories */}
                              {latestWorkflowArtifact?.brdId && (() => {
                                const sourceBrd = (allBrds as any[]).find((b: any) => b.id === latestWorkflowArtifact.brdId);
                                return sourceBrd ? (
                                  <div className="mb-1 flex items-center gap-1.5 px-2 py-1.5 bg-violet-500/5 border border-violet-500/20 rounded-md text-[10px]">
                                    <span className="text-violet-600 dark:text-violet-400 font-semibold whitespace-nowrap">From BRD:</span>
                                    <span className="text-foreground font-medium truncate">{sourceBrd.title}</span>
                                    {sourceBrd.brdFileName && (
                                      <span className="text-muted-foreground truncate ml-1" title={sourceBrd.brdFileName}>({sourceBrd.brdFileName})</span>
                                    )}
                                  </div>
                                ) : null;
                              })()}

                              {(() => {
                                const storyIsGenerated = (story: any) => {
                                  const storyId = (story.id ?? "").toString();
                                  const isGeneratedInDb = savedDesignMappings?.some(
                                    (mapping) => {
                                      let usArray = mapping.userStories;
                                      if (typeof usArray === "string") {
                                        try { usArray = JSON.parse(usArray); } catch (e) { usArray = []; }
                                      }
                                      return Array.isArray(usArray) && usArray.some((us: any) => String(us.id) === String(storyId));
                                    }
                                  );
                                  const textHasPrompt =
                                    story.description?.includes("Design Prompt") ||
                                    story.acceptanceCriteria?.includes("Design Prompt");
                                  return Boolean(isGeneratedInDb || textHasPrompt);
                                };

                                const sq = designStorySearchQuery.trim().toLowerCase();
                                const filteredStories = designUserStories.filter(
                                  (story) => {
                                    const storyId = (story.id ?? "").toString();
                                    const matchesSearch =
                                      !sq ||
                                      (story.title ?? "")
                                        .toLowerCase()
                                        .includes(sq) ||
                                      storyId.toLowerCase().includes(sq);
                                    if (!matchesSearch) return false;
                                    if (designStoryStatusFilter === "all")
                                      return true;
                                    const generated = storyIsGenerated(story);
                                    return designStoryStatusFilter === "generated"
                                      ? generated
                                      : !generated;
                                  },
                                );

                                if (filteredStories.length === 0) {
                                  return (
                                    <div className="px-3 py-6 text-center text-sm text-muted-foreground">
                                      No {isJira ? "sub-items" : "user stories"}{" "}
                                      match the current search/filter
                                    </div>
                                  );
                                }

                                return (
                                  <div className="max-h-[200px] overflow-y-auto space-y-2">
                                {filteredStories.map((story) => {
                                  const storyId = (story.id ?? "").toString();
                                  const isSelected =
                                    selectedDesignStoryIds.includes(storyId);

                                  const isGenerated = storyIsGenerated(story);

                                  return (
                                    <div
                                      key={`${story.epicId ?? ""}-${story.id}`}
                                      className={`flex items-start gap-3 p-2 rounded-md hover:bg-accent/50 cursor-pointer ${isSelected ? "bg-accent/30" : ""
                                        }`}
                                      onClick={() =>
                                        handleToggleDesignStory(storyId)
                                      }
                                    >
                                      <Checkbox
                                        checked={isSelected}
                                        className="mt-0.5"
                                      />
                                      <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2">
                                          <div className="text-sm font-medium truncate">
                                            {story.title}
                                          </div>
                                          {isGenerated && (
                                            <span className="px-1.5 py-0.5 rounded-full bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 text-[10px] font-semibold whitespace-nowrap">
                                              Generated
                                            </span>
                                          )}
                                        </div>
                                        <div className="text-xs text-muted-foreground">
                                          ID: {story.id} • {story.state}
                                          {story.epicId &&
                                            ` • Epic #${story.epicId}`}
                                        </div>
                                        {story.acceptanceCriteria && (
                                          <div className="text-xs text-muted-foreground mt-1 truncate">
                                            AC:{" "}
                                            {story.acceptanceCriteria
                                              .replace(/<[^>]*>/g, "")
                                              .substring(0, 100)}
                                            {story.acceptanceCriteria.length > 100
                                              ? "..."
                                              : ""}
                                          </div>
                                        )}
                                      </div>
                                    </div>
                                  );
                                })}
                                  </div>
                                );
                              })()}
                            </div>
                          )}

                  {/* Requirement Document Section - Step 1 Content */}
                  <div className="space-y-2 border-t pt-4">
                    <label
                      htmlFor="requirement-document"
                      className="text-sm font-medium"
                    >
                      {isJira ? "Sub-items" : "User Stories"}
                    </label>
                    <textarea
                      id="requirement-document"
                      className="w-full min-h-[200px] rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                      placeholder={
                        designSelectionMode === "story"
                          ? isJira
                            ? "Select one or more sub-items above to build the requirement..."
                            : "Select one or more user stories above to build the requirement..."
                          : isJira
                            ? "Select one or more work items above to load sub-items..."
                            : "Select one or more Epics above to load user stories..."
                      }
                      value={requirementDocument}
                      onChange={(e) => setRequirementDocument(e.target.value)}
                      data-testid="textarea-requirement-document"
                      readOnly
                    />
                  </div>
                </div>
              )}

              {/* Step 2: Review Figma Prompt */}
              {designStep === 2 &&
                (isGeneratingDesign ? (
                  <div className="flex flex-col items-center justify-center py-24">
                    <div className="flex flex-col items-center gap-4">
                      <div className="relative">
                        <div className="h-16 w-16 rounded-full border-4 border-purple-200 border-t-purple-600 animate-spin" />
                        <Sparkles className="h-6 w-6 text-purple-600 absolute inset-0 m-auto" />
                      </div>
                      <div className="text-center">
                        <p className="text-base font-semibold">Generating Design Prompt...</p>
                        <p className="text-sm text-muted-foreground mt-1">AI is analyzing your user stories and creating a design prompt.</p>
                      </div>
                    </div>
                  </div>
                ) : generatedFigmaPrompt ? (
                  <div className="flex gap-4 h-full">
                    {/* Left: prompt textarea fills height */}
                    <div className="flex-1 flex flex-col gap-2">
                      <p className="text-xs text-muted-foreground">
                        You can edit the prompt below manually or use AI Enhance to improve it.
                      </p>
                      <div className="flex items-center gap-2 flex-wrap">
                        <AiEnhanceWithDiff
                          value={generatedFigmaPrompt}
                          onEnhanced={setGeneratedFigmaPrompt}
                          locationKey="design-card.figmaPrompt"
                          itemName="Figma Design Prompt"
                          placeholderExtraPrompt="Optional: add instructions for how to improve the Figma prompt..."
                          buttonSize="sm"
                          buttonVariant="outline"
                        />
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => figmaPromptTextareaRef.current?.focus()}
                          className="gap-1.5"
                        >
                          <Edit className="h-3.5 w-3.5" />
                          Manual edit
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            navigator.clipboard.writeText(generatedFigmaPrompt);
                            toast({ title: "Copied!", description: "Content copied to clipboard" });
                          }}
                        >
                          <Copy className="h-3 w-3 mr-2" />
                          Copy
                        </Button>
                        {generatedFigmaLink && (
                          <Button
                            size="sm"
                            onClick={() => window.open(generatedFigmaLink, "_blank", "noopener,noreferrer")}
                          >
                            Open in Figma
                          </Button>
                        )}

                      </div>
                      <textarea
                        ref={figmaPromptTextareaRef}
                        value={generatedFigmaPrompt}
                        onChange={(e) => setGeneratedFigmaPrompt(e.target.value)}
                        className="flex-1 w-full p-3 border border-blue-200 dark:border-blue-700 rounded-lg bg-white dark:bg-gray-900 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring min-h-[300px]"
                        placeholder="Generated design prompt – edit as needed"
                      />
                    </div>

                    {/* Right: action panel */}
                    <div className="w-64 shrink-0 flex flex-col gap-3">
                      <div className="rounded-lg border bg-muted/30 p-4 space-y-3">
                        <p className="text-sm font-semibold">Save & Sync Prompt</p>
                        <p className="text-xs text-muted-foreground">Append the generated design prompt as a section in the selected user story descriptions.</p>

                        {/* Sync to Jira (only when Jira integration) */}
                        {isJira && (
                          <Button
                            className="w-full gap-2"
                            size="sm"
                            disabled={isSyncingToJira || !generatedFigmaPrompt || selectedDesignStoryIds.length === 0}
                            onClick={async () => {
                              setIsSyncingToJira(true);
                              try {
                                const saveProjectId = apiProjectId || dbProjectId;
                                const jiraIssueIds = designUserStories
                                  .filter((s) => selectedDesignStoryIds.includes((s.id ?? "").toString()))
                                  .map((s) => (s as any).jiraIssueId || s.id)
                                  .filter(Boolean);

                                if (jiraIssueIds.length === 0) {
                                  toast({ title: "No Jira IDs", description: "Selected user stories do not have Jira issue IDs linked.", variant: "destructive" });
                                  return;
                                }

                                const res = await apiRequest("POST", "/api/workflow/design-prompt/sync-to-jira", {
                                  projectId: saveProjectId,
                                  jiraIssueIds,
                                  prompt: generatedFigmaPrompt,
                                });
                                const data = await res.json();
                                if (res.ok) {
                                  toast({ title: "Synced to Jira", description: `Design prompt appended to ${data.updated ?? jiraIssueIds.length} Jira issue(s).` });
                                } else {
                                  throw new Error(data.error || "Failed to sync to Jira");
                                }
                              } catch (err: any) {
                                toast({ title: "Jira Sync Failed", description: err.message || "Could not sync design prompt to Jira.", variant: "destructive" });
                              } finally {
                                setIsSyncingToJira(false);
                              }
                            }}
                          >
                            {isSyncingToJira ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                            Sync to Jira
                          </Button>
                        )}
                      </div>

                      <div className="rounded-lg border bg-muted/30 p-4 space-y-2">
                        <p className="text-sm font-semibold">Selected Stories</p>
                        <p className="text-xs text-muted-foreground">{selectedDesignStoryIds.length} of {designUserStories.length} selected</p>
                        <div className="max-h-40 overflow-y-auto space-y-1">
                          {designUserStories
                            .filter((s) => selectedDesignStoryIds.includes((s.id ?? "").toString()))
                            .map((s) => (
                              <div key={s.id} className="text-xs py-1 px-2 bg-background rounded border truncate" title={s.title}>
                                #{s.id}: {s.title}
                              </div>
                            ))}
                        </div>
                      </div>
                    </div>
                  </div>
                ) : null)}
            </div>{/* end scrollable content */}

            {/* Sticky footer with action buttons */}
            <div className="flex-shrink-0 border-t pl-6 pr-24 py-4 flex items-center justify-end gap-3 bg-background">
              <Button
                variant="outline"
                data-testid="button-cancel-design"
                disabled={isGeneratingDesign}
                onClick={() => {
                  setAiDesignDialogOpen(false);
                  setSelectedDesignType("");
                  setRequirementDocument("");
                  setAdoDocuments([]);
                  setSelectedAdoDocId("");
                  setDesignEpicsList([]);
                  setSelectedDesignEpicIds([]);
                  setDesignUserStories([]);
                  setSelectedDesignStoryIds([]);
                  setEpicDetailsMap({});
                  setIsFetchingEpicComments(false);
                  setGeneratedDesignContent("");
                  setGeneratedFigmaPrompt("");
                  setGeneratedFigmaLink("");
                  setAdoWorkItemId("");
                  setIsFigmaMode(false);
                  setFigmaLinkInput("");
                  setShowFigmaInput(false);
                  setEpicTreeData([]);
                  setDesignStep(1);
                  setUploadedGuidelines("");
                  setUploadedGuidelineFiles([]);
                  if (guidelinesFileInputRef.current) {
                    guidelinesFileInputRef.current.value = "";
                  }
                }}
              >
                Cancel
              </Button>

              {designStep === 1 ? (
                <Button
                  className="min-w-[120px]"
                  data-testid="button-next-step-1"
                  disabled={selectedDesignStoryIds.length === 0 || isGeneratingDesign}
                  onClick={() => {
                    handleGenerateDesignWithAI();
                    setDesignStep(2);
                  }}
                >
                  {isGeneratingDesign ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Generating...
                    </>
                  ) : (
                    "Next"
                  )}
                </Button>
              ) : (
                <>
                  <Button
                    variant="outline"
                    data-testid="button-back-step-2"
                    disabled={isGeneratingDesign || isSavingDesign}
                    onClick={() => setDesignStep(1)}
                  >
                    Back
                  </Button>
                  <Button
                    className="min-w-[120px]"
                    data-testid="button-save-step-2"
                    disabled={isGeneratingDesign || isSavingDesign || !generatedFigmaPrompt}
                    onClick={handleSaveDesign}
                  >
                    {isSavingDesign ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Saving...
                      </>
                    ) : (
                      "Save & Design"
                    )}
                  </Button>
                </>
              )}
            </div>
          </div>
        )}

        {/* Figma Prompt Fullscreen Modal */}
        {figmaPromptFullscreen && (
          <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center">
            <Dialog
              open={figmaPromptFullscreen}
              onOpenChange={setFigmaPromptFullscreen}
            >
              <DialogContent className="max-w-4xl max-h-[90vh] p-0 overflow-hidden">
                <div className="px-6 py-4 border-b flex items-center justify-between gap-4">
                  <div className="flex items-center gap-2">
                    <Figma className="h-5 w-5 text-blue-600" />
                    <span className="text-lg font-semibold">
                      Figma Design Prompt
                    </span>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        navigator.clipboard.writeText(generatedFigmaPrompt);
                        toast({
                          title: "Copied!",
                          description: "Content copied to clipboard",
                        });
                      }}
                    >
                      <Copy className="h-3 w-3 mr-2" />
                      Copy
                    </Button>
                    {generatedFigmaLink && (
                      <Button
                        size="sm"
                        onClick={() =>
                          window.open(
                            generatedFigmaLink,
                            "_blank",
                            "noopener,noreferrer",
                          )
                        }
                      >
                        Open in Figma
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setFigmaPromptFullscreen(false)}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
                <div className="p-6">
                  <textarea
                    value={generatedFigmaPrompt}
                    onChange={(e) => setGeneratedFigmaPrompt(e.target.value)}
                    className="w-full h-96 p-4 border rounded-lg bg-gray-50 dark:bg-gray-900 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring"
                    placeholder="Figma design prompt – edit as needed"
                  />
                </div>
              </DialogContent>
            </Dialog>
          </div>
        )}

        {/* BRD List Dialog */}
        <Dialog open={brdListDialogOpen} onOpenChange={setBrdListDialogOpen}>
          <DialogContent className="max-w-4xl max-h-[80vh] overflow-hidden flex flex-col">
            <DialogHeader>
              <DialogTitle>
                {brdListCategory === "drafts" && "Draft BRDs"}
                {brdListCategory === "yetToReview" && "BRDs Yet to Review"}
                {brdListCategory === "approved" && "Approved BRDs"}
                {brdListCategory === "partiallyGenerated" &&
                  "Partially Generated BRDs"}
                {brdListCategory === "generated" && "Generated BRDs"}
              </DialogTitle>
            </DialogHeader>

            <div className="flex-1 overflow-y-auto">
              {brdsLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground mr-2" />
                  <span className="text-sm text-muted-foreground">
                    Loading BRDs...
                  </span>
                </div>
              ) : brdsByCategory.length === 0 ? (
                <div className="py-12 text-center">
                  <FileText className="h-12 w-12 text-muted-foreground mx-auto mb-3 opacity-50" />
                  <p className="text-sm font-medium text-muted-foreground mb-1">
                    No BRDs found
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {brdListCategory === "drafts" &&
                      "Create a new BRD to get started"}
                    {brdListCategory === "yetToReview" &&
                      "No BRDs waiting for review"}
                    {brdListCategory === "approved" && "No approved BRDs yet"}
                    {brdListCategory === "partiallyGenerated" &&
                      "No partially generated BRDs yet"}
                    {brdListCategory === "generated" && "No generated BRDs yet"}
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {brdsByCategory.map((brd) => (
                    <Card
                      key={brd.id}
                      className="hover:shadow-md transition-shadow"
                    >
                      <CardContent className="p-4">
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-2">
                              <FileText className="h-4 w-4 text-primary shrink-0" />
                              <h4 className="font-semibold text-sm truncate">
                                {brd.title}
                              </h4>
                            </div>

                            <div className="flex items-center gap-3 text-xs text-muted-foreground">
                              {brd.createdAt && (
                                <span className="flex items-center gap-1">
                                  <Clock className="h-3 w-3" />
                                  {new Date(brd.createdAt).toLocaleDateString()}
                                </span>
                              )}
                              {brd.updatedAt && (
                                <span className="flex items-center gap-1">
                                  Updated:{" "}
                                  {new Date(brd.updatedAt).toLocaleDateString()}
                                </span>
                              )}
                            </div>
                          </div>

                          <div className="flex items-center gap-2 shrink-0">
                            {brd.status === "draft" && (
                              <Badge variant="secondary">Draft</Badge>
                            )}
                            {brd.status === "yetToReview" && (
                              <Badge
                                variant="outline"
                                className="border-amber-500 text-amber-600"
                              >
                                Yet to Review
                              </Badge>
                            )}
                            {brd.status === "approved" && (
                              <div
                                className="flex items-center gap-1 text-green-600 dark:text-green-400"
                                aria-label="Approved"
                              >
                                <CheckCircle2 className="h-3.5 w-3.5" />
                                <Badge
                                  variant="outline"
                                  className="border-green-500 text-green-600 pointer-events-none"
                                >
                                  Approved
                                </Badge>
                              </div>
                            )}
                            <Button
                              size="sm"
                              variant="ghost"
                              title="View BRD"
                              data-testid={`button-view-brd-${brd.id}`}
                              onClick={() => {
                                setSelectedBrdForPreview(brd.id);
                                setBrdPreviewDialogOpen(true);
                                setBrdListDialogOpen(false);
                              }}
                            >
                              <Eye className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </div>
          </DialogContent>
        </Dialog>

        {/* BRD Preview Dialog */}
        <Dialog
          open={brdPreviewDialogOpen}
          onOpenChange={(open) => {
            setBrdPreviewDialogOpen(open);
            if (!open) {
              setSelectedBrdForPreview(null);
            }
          }}
        >
          <DialogContent className="max-w-6xl h-[90vh] p-0 flex flex-col">
            <DialogHeader className="px-6 pt-6 pb-4 flex-shrink-0">
              <DialogTitle>BRD Preview</DialogTitle>
              <p className="text-sm text-muted-foreground">
                View the Business Requirements Document details
              </p>
            </DialogHeader>

            <div
              className="flex-1 min-h-0"
              style={{ display: "flex", flexDirection: "column" }}
            >
              {brdPreviewLoading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-8 w-8 animate-spin text-muted-foreground mr-3" />
                  <span className="text-sm text-muted-foreground">
                    Loading BRD...
                  </span>
                </div>
              ) : brdPreviewError ? (
                <div className="py-12 text-center">
                  <AlertCircle className="h-12 w-12 text-destructive mx-auto mb-3 opacity-50" />
                  <p className="text-sm font-medium text-muted-foreground mb-1">
                    Failed to load BRD
                  </p>
                  <p className="text-xs text-muted-foreground mb-2">
                    {brdPreviewError instanceof Error
                      ? brdPreviewError.message
                      : "An error occurred"}
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      // Retry fetching
                      queryClient.invalidateQueries({
                        queryKey: [
                          "/api/dev-brd/preview",
                          selectedBrdForPreview,
                        ],
                      });
                    }}
                  >
                    <RefreshCw className="h-4 w-4 mr-2" />
                    Retry
                  </Button>
                </div>
              ) : selectedBrdData?.brd || selectedBrdData?.brdFileName ? (
                <BRDPreview
                  brd={selectedBrdData.brd || null}
                  isLoading={false}
                  brdFileName={selectedBrdData.brdFileName}
                  brdFileType={selectedBrdData.brdFileType}
                  brdId={selectedBrdForPreview || undefined}
                  brdStatus={selectedBrdData.status}
                />
              ) : (
                <div className="py-12 text-center">
                  <FileText className="h-12 w-12 text-muted-foreground mx-auto mb-3 opacity-50" />
                  <p className="text-sm font-medium text-muted-foreground mb-1">
                    Unable to load BRD
                  </p>
                  <p className="text-xs text-muted-foreground">
                    This BRD may not have been generated yet
                  </p>
                  <p className="text-xs text-muted-foreground mt-2">
                    BRD ID: {selectedBrdForPreview}
                  </p>
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2 pt-4 px-6 pb-6 border-t flex-shrink-0">
              <Button
                variant="outline"
                onClick={() => {
                  // Edit BRD - navigate to the BRD page
                  if (selectedBrdForPreview) {
                    const targetProjectId = selectedAdoProject?.id || projectId;
                    const targetProjectName =
                      selectedAdoProject?.name ||
                      projectData?.project?.name ||
                      projectName ||
                      "";
                    const brdProject =
                      (sdlcProjectData?.project as any) ||
                      (projectData?.project as any);
                    const goldenRepoRef =
                      brdProject?.goldenRepoReference ??
                      brdProject?.golden_repo_reference;
                    const goldenRepoNameFromProject =
                      (linkedGoldenRepoName as string) ||
                      (brdProject?.linkedGoldenRepoName as string) ||
                      (brdProject?.linked_golden_repo_name as string) ||
                      (goldenRepoRef?.repoName as string) ||
                      "";

                    const params = new URLSearchParams();
                    params.append("brdId", selectedBrdForPreview);
                    if (targetProjectId)
                      params.append("projectId", targetProjectId);
                    if (targetProjectName)
                      params.append("projectName", targetProjectName);
                    if (selectedOrganization)
                      params.append("organizationName", selectedOrganization);
                    if (goldenRepoNameFromProject)
                      params.append(
                        "goldenRepoName",
                        goldenRepoNameFromProject,
                      );

                    setLocation(`/brd?${params.toString()}`);
                    setBrdPreviewDialogOpen(false);
                    setBrdListDialogOpen(false);
                  }
                }}
              >
                Edit BRD
              </Button>
              <Button
                onClick={() => {
                  setBrdPreviewDialogOpen(false);
                  setSelectedBrdForPreview(null);
                }}
              >
                Close
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* Generate Guideline Modal */}
      <GenerateGuidelineModal
        isOpen={aiGuidelineDialogOpen}
        onClose={() => setAiGuidelineDialogOpen(false)}
        onSuccess={() => {
          // Refresh guidelines validation when guidelines are created/updated
          checkGuidelinesValidation();
        }}
        dbProjectId={dbProjectId}
        linkedGoldenRepoId={linkedGoldenRepoId}
        linkedGoldenRepoName={linkedGoldenRepoName}
        projectData={projectData}
        sdlcProjectData={sdlcProjectData}
      />

      {/* Golden Repo Guideline Selector */}
      <GoldenRepoGuidelineSelector
        open={guidelineSelectorOpen}
        onOpenChange={setGuidelineSelectorOpen}
        onSelectFiles={handleSelectGuidelineFiles}
        {...goldenRepoSelectorPropsFromRef(
          (sdlcProjectData?.project || projectData?.project)?.goldenRepoReference ??
            (sdlcProjectData?.project || projectData?.project)?.golden_repo_reference,
        )}
        selectedRepoId={selectedGoldenRepoIdForGuidelines || undefined}
        selectedRepoName={selectedGoldenRepoNameForGuidelines || undefined}
        projectId={dbProjectId}
      />
    </div>
  );
}

// Component to fetch and display confirmation data
function ConfirmationCheckpointContent({
  phase,
  onSubmitConfirmation,
}: {
  phase: SDLCPhase;
  onSubmitConfirmation: (confirmation: any) => void;
}) {
  const { data: confirmations, isLoading } = useQuery<any[]>({
    queryKey: ["/api/sdlc/confirmations", phase.id],
    queryFn: async () => {
      const response = await fetch(
        getApiUrl(`/api/sdlc/phases/${phase.id}/confirmations`),
        {
          credentials: "include",
        },
      );
      if (!response.ok) {
        // If no confirmations exist, initialize them
        if (response.status === 404 || response.status === 500) {
          const initResponse = await fetch(
            getApiUrl(`/api/sdlc/phases/${phase.id}/confirmations/initialize`),
            {
              method: "POST",
              credentials: "include",
            },
          );
          if (!initResponse.ok)
            throw new Error("Failed to initialize confirmations");
          return initResponse.json();
        }
        throw new Error("Failed to fetch confirmations");
      }

      const data = await response.json();

      // If confirmations array is empty, initialize them
      if (data.length === 0) {
        const initResponse = await fetch(
          `/api/sdlc/phases/${phase.id}/confirmations/initialize`,
          {
            method: "POST",
            credentials: "include",
          },
        );
        if (!initResponse.ok)
          throw new Error("Failed to initialize confirmations");
        return initResponse.json();
      }

      return data;
    },
  });

  if (isLoading) {
    return <div className="p-6 text-center">Loading confirmations...</div>;
  }

  return (
    <PhaseConfirmationCard
      phaseId={phase.id}
      phaseName={phase.phaseName}
      confirmations={confirmations || []}
      onSubmitConfirmation={onSubmitConfirmation}
    />
  );
}
