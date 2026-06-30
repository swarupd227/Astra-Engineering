import { useState, useMemo, useRef, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useDebounce } from "@/hooks/use-debounce";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Package,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  ChevronLeft,
  GitBranch,
  CheckCircle2,
  Circle,
  Link as LinkIcon,
  Loader2,
  ExternalLink,
  User,
  Calendar,
  Tag,
  TrendingUp,
  Edit,
  Plus,
  ChevronsUpDown,
  Check,
  Unlink,
  Trash2,
  Search,
  Database,
  Filter,
  Upload,
  Palette,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { GenericModal } from "@/components/ui/generic-modal";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
  PaginationEllipsis,
} from "@/components/ui/pagination";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { useHostingConfig } from "@/hooks/use-hosting-config";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { pollAsyncJob } from "@/lib/async-job-poller";
import { getApiUrl } from "@/lib/api-config";
import type { Epic, Feature, UserStory } from "@shared/schema";
import { cn } from "@/lib/utils";
import { AdoWorkItemCreateDialog } from "@/components/ado-work-item-create-dialog";
import { AdoWorkItemEditDialog } from "@/components/ado-work-item-edit-dialog";
import { ArtifactEditDialog } from "@/components/workflow/artifact-edit-dialog";
import { useLocation, useSearch } from "wouter";
import { PageHeader } from "@/components/ui/page-header";
import { PageHeaderSkeleton, CardGridSkeleton } from "@/components/ui/page-skeletons";
import {
  GLOBAL_ALL_ORGANIZATIONS_ID,
  useSelectedOrganization,
} from "@/contexts/selected-organization-context";
import {
  GlobalSearchProvider,
  useGlobalSearch,
  FindInPageInline,
  HighlightedText,
  useFindInPage,
  type FindInPageItem,
} from "@/components/global-search";

// Helper to render a small initial for work item types
const getWorkItemTypeInitial = (type: string, isSubtask = false): string => {
  switch (type) {
    case "User Story":
      return "S";
    case "Epic":
      return "E";
    case "Feature":
      return "F";
    case "Task":
      return isSubtask ? "ST" : "T";
    case "Bug":
      return "B";
    case "Issue":
      return "I";
    case "Test Case":
      return "TC";
    default:
      return type?.charAt(0)?.toUpperCase() || "?";
  }
};

// Helper to get icon color classes based on work item type
const getWorkItemIconColors = (type: string): string => {
  switch (type) {
    case "Epic":
      return "bg-purple-500 text-white";
    case "Feature":
      return "bg-blue-500 text-white";
    case "User Story":
      return "bg-green-500 text-white";
    case "Task":
      return "bg-orange-500 text-white";
    case "Bug":
      return "bg-red-500 text-white";
    case "Issue":
      return "bg-yellow-500 text-white";
    case "Test Case":
      return "bg-teal-500 text-white";
    default:
      return "bg-muted text-foreground";
  }
};

interface Organization {
  id: string;
  name: string;
  projectCount: number;
  integrationType?: "ado" | "jira";
}

interface WorkItem {
  id: string;
  title: string;
  type: string;
  status: string;
  priority: string;
  linkedItems?: WorkItem[];
  // Optional source to distinguish ADO vs DB-only items
  source?: "ADO" | "DB" | "Jira";
  // For Jira items, the human-readable issue key (e.g. "PROJ-123").
  // Populated by mapJiraIssueToWorkItem on the server.
  externalId?: string;
  // Original workflow artifact when source is DB
  dbArtifact?: Epic | Feature | UserStory | any;
  dbArtifactType?: "Epic" | "Feature" | "User Story" | "Test Case";
  // Azure DevOps created date (ISO string) when source is ADO
  createdDate?: string | null;
  // Test case steps (for Test Case work items)
  testCaseSteps?: Array<{ step: number; action: string; expectedResult: string }>;
}

interface WorkItemSummary {
  id: string;
  title: string;
  type: string;
  state: string;
  url: string;
}

interface DetailedWorkItem {
  id: string;
  title: string;
  type: string;
  state: string;
  assignedTo: string;
  createdBy: string;
  createdDate: string;
  changedDate: string;
  description: string;
  acceptanceCriteria: string;
  storyPoints: number | null;
  priority: number | null;
  severity: string | null;
  businessValue: number | null;
  timeCriticality: number | null;
  effort: number | null;
  remainingWork: number | null;
  originalEstimate: number | null;
  completedWork: number | null;
  reproSteps: string;
  testCaseSteps?: Array<{ step: number; action: string; expectedResult: string }>;
  tags: string;
  iterationPath: string;
  areaPath: string;
  url: string;
  relations: any[];
  parent: WorkItemSummary | null;
  children: WorkItemSummary[];
}

interface Project {
  id: string;
  name: string;
  description: string;
  organization: string;
  organizationUrl?: string;
  artifactOrgId?: string;
  jiraConnectionId?: string;
  workItemCount?: number;
  integrationType?: 'ado' | 'jira';
  projectKey?: string;
  projectManagementPatConfigured?: boolean;
  repoPatConfigured?: boolean;
  userJiraPatConfigured?: boolean;
  userGitlabPatConfigured?: boolean;
  userPatConfigured?: boolean;
}

interface WorkflowArtifact {
  id: string;
  projectId?: string | null;
  epics?: Epic[];
  features?: Feature[];
  userStories?: UserStory[];
  requirement?: string | null;
  modified?: boolean;
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

interface ProjectsApiResponse {
  projects: Project[];
  totalCount: number;
  page?: number;
  pageSize?: number;
  warnings?: string[];
}

type WorkItemTab =
  | "all"
  | "feature"
  | "user-story"
  | "bug"
  | "task"
  | "issue"
  | "linked"
  | "testcase";

// Maps work item types to the tab that owns them. Used by the
// auto-tab-switch and per-tab match counts when searching across types.
const WORK_ITEM_TYPE_TO_TAB: Record<string, WorkItemTab> = {
  Epic: "all",
  Feature: "feature",
  "User Story": "user-story",
  Task: "task",
  Bug: "bug",
  Issue: "issue",
  "Test Case": "testcase",
};

export default function HubArtifacts() {
  // GlobalSearchProvider powers the inline find-in-page UI (typed query,
  // prev/next cursor, `N / M` counter) — locally scoped to this page so it
  // doesn't leak into other routes.
  return (
    <GlobalSearchProvider>
      <HubArtifactsContent />
    </GlobalSearchProvider>
  );
}

function HubArtifactsContent() {
  const [, setLocation] = useLocation();
  const search = useSearch();
  const { selectedOrganization: globalSelectedOrganization } =
    useSelectedOrganization();
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [selectedTab, setSelectedTab] = useState<WorkItemTab>("all");
  const [projectSearchQuery, setProjectSearchQuery] = useState("");
  const debouncedProjectSearchQuery = useDebounce(projectSearchQuery, 300);
  const [projectPage, setProjectPage] = useState(1);
  const projectPageSize = 20;

  useEffect(() => {
    setProjectPage(1);
  }, [debouncedProjectSearchQuery]);
  // The work-item search input lives in <FindInPageInline /> which owns the
  // typed query and the prev/next cursor. We just consume the debounced
  // `activeQuery` it publishes via the global-search context.
  const { activeQuery: workItemFilterQuery } = useGlobalSearch();
  const [linkDialogOpen, setLinkDialogOpen] = useState(false);
  const [detailsDialogOpen, setDetailsDialogOpen] = useState(false);
  const [selectedWorkItem, setSelectedWorkItem] = useState<WorkItem | null>(
    null
  );
  const [selectedWorkItemDetails, setSelectedWorkItemDetails] =
    useState<DetailedWorkItem | null>(null);
  const [detailsNavStack, setDetailsNavStack] = useState<DetailedWorkItem[]>(
    []
  );
  const [targetWorkItemId, setTargetWorkItemId] = useState("");
  const [linkType, setLinkType] = useState(
    "System.LinkTypes.Hierarchy-Reverse"
  );
  const [linkComboboxOpen, setLinkComboboxOpen] = useState(false);
  const [workItemSearchTerm, setWorkItemSearchTerm] = useState("");
  const debouncedWorkItemSearchTerm = useDebounce(workItemSearchTerm, 300);
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());
  const [editingWorkItemId, setEditingWorkItemId] = useState<string | null>(null);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [detailsLoadingId, setDetailsLoadingId] = useState<string | null>(null);
  const [unlinkingKey, setUnlinkingKey] = useState<string | null>(null);
  const [dbDetailsDialogOpen, setDbDetailsDialogOpen] = useState(false);
  const [selectedDbWorkItem, setSelectedDbWorkItem] = useState<WorkItem | null>(
    null
  );
  const [dbDetailsLoading, setDbDetailsLoading] = useState(false);
  const [dbDetailsNavStack, setDbDetailsNavStack] = useState<WorkItem[]>([]);
  const [selectedDbParent, setSelectedDbParent] = useState<WorkItem | null>(
    null
  );
  const [selectedDbChildren, setSelectedDbChildren] = useState<WorkItem[]>([]);
  const [sourceFilter, setSourceFilter] = useState<"all" | "ado" | "draft">(
    "all"
  );
  const [createdDateFilter, setCreatedDateFilter] = useState<
    "all" | "last-24h" | "last-7d"
  >("all");
  const [draftEditOpen, setDraftEditOpen] = useState(false);
  const [draftEditArtifact, setDraftEditArtifact] = useState<
    Epic | Feature | UserStory | null
  >(null);
  const [draftEditType, setDraftEditType] = useState<
    "epic" | "feature" | "story"
  >("story");
  const [draftTaskEditOpen, setDraftTaskEditOpen] = useState(false);
  const [draftTaskEditTitle, setDraftTaskEditTitle] = useState("");
  const [draftTaskStory, setDraftTaskStory] = useState<UserStory | null>(null);
  const [draftTaskIndex, setDraftTaskIndex] = useState<number | null>(null);
  const [draftTaskSaving, setDraftTaskSaving] = useState(false);
  const [parentSectionExpanded, setParentSectionExpanded] = useState(true);
  const [childrenSectionExpanded, setChildrenSectionExpanded] = useState(true);
  const commandListRef = useRef<HTMLDivElement>(null);
  const linkDialogCloseIntentRef = useRef(false);
  const isLinkDialogPortalTarget = (target: EventTarget | null) => {
    const el = target as HTMLElement | null;
    if (!el) return false;
    return Boolean(
      el.closest("[data-radix-select-portal]") ||
      el.closest("[data-radix-popover-content]") ||
      el.closest("[cmdk-root]")
    );
  };
  const [pushingToADO, setPushingToADO] = useState<string | null>(null);
  const { toast } = useToast();
  const [draftSelectedIds, setDraftSelectedIds] = useState<Set<string>>(
    () => new Set()
  );
  const [isDraftBulkPushing, setIsDraftBulkPushing] = useState(false);
  const isGlobalAllOrganizations =
    globalSelectedOrganization?.id === GLOBAL_ALL_ORGANIZATIONS_ID;
  const isGlobalSpecificOrganizationSelected =
    !!globalSelectedOrganization && !isGlobalAllOrganizations;
  const selectedOrg = isGlobalSpecificOrganizationSelected
    ? globalSelectedOrganization?.name || null
    : null;

  // Handle X button click in link dialog to set close intent
  useEffect(() => {
    if (!linkDialogOpen) return;

    let closeButton: HTMLButtonElement | null = null;
    let cleanup: (() => void) | undefined;

    // Use a small delay to ensure the dialog is rendered
    const timer = setTimeout(() => {
      const dialogContent = document.querySelector(
        '[data-testid="dialog-link-work-item"]'
      );
      if (!dialogContent) return;

      // Find the close button (it's usually positioned at top-right with class containing "right-4")
      closeButton = dialogContent.querySelector(
        'button[class*="right-4"]'
      ) as HTMLButtonElement;
      if (!closeButton) return;

      const handleCloseClick = (e: MouseEvent) => {
        linkDialogCloseIntentRef.current = true;
        setLinkDialogOpen(false);
        e.stopPropagation();
      };

      closeButton.addEventListener("click", handleCloseClick);

      cleanup = () => {
        closeButton?.removeEventListener("click", handleCloseClick);
      };
    }, 100);

    return () => {
      clearTimeout(timer);
      if (cleanup) cleanup();
    };
  }, [linkDialogOpen]);

  // Ensure mouse wheel scrolling works on CommandList
  useEffect(() => {
    if (!linkComboboxOpen) return;

    let cleanup: (() => void) | undefined;

    // Use a small delay to ensure the element is rendered
    const timer = setTimeout(() => {
      // Find the actual scrollable element (CommandList renders a div with cmdk-list class)
      const scrollableElement =
        commandListRef.current ||
        (document.querySelector("[cmdk-list]") as HTMLDivElement);

      if (scrollableElement) {
        const handleWheel = (e: WheelEvent) => {
          // Check if we can scroll
          const canScrollUp = scrollableElement.scrollTop > 0;
          const canScrollDown =
            scrollableElement.scrollTop <
            scrollableElement.scrollHeight - scrollableElement.clientHeight;

          if (
            (e.deltaY < 0 && canScrollUp) ||
            (e.deltaY > 0 && canScrollDown)
          ) {
            scrollableElement.scrollTop += e.deltaY;
            e.preventDefault();
            e.stopPropagation();
          }
        };

        scrollableElement.addEventListener("wheel", handleWheel, {
          passive: false,
        });

        cleanup = () => {
          scrollableElement.removeEventListener("wheel", handleWheel);
        };
      }
    }, 100);

    return () => {
      clearTimeout(timer);
      if (cleanup) cleanup();
    };
  }, [linkComboboxOpen]);

  const {
    data: projectsData,
    isLoading: isLoadingProjects,
    error: projectsError,
  } = useQuery<ProjectsApiResponse>({
    // IMPORTANT: scope cache to the selected global organization.
    // The server uses `x-organization-id` to filter, but react-query will otherwise
    // reuse the "All" cached response across org switches.
    queryKey: [
      "/api/hub/artifacts/projects",
      globalSelectedOrganization?.id ?? GLOBAL_ALL_ORGANIZATIONS_ID,
      debouncedProjectSearchQuery,
      projectPage,
    ],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (debouncedProjectSearchQuery) {
        params.append("search", debouncedProjectSearchQuery);
      }
      params.append("page", projectPage.toString());
      params.append("pageSize", projectPageSize.toString());

      const res = await apiRequest("GET", `/api/hub/artifacts/projects?${params.toString()}`);
      return (await res.json()) as ProjectsApiResponse;
    },
    // Stay live with the Projects page: refetch on focus/mount and poll
    // every 30s so newly created/deleted projects appear without a hard
    // reload. Cache only briefly so org switches stay snappy.
    staleTime: 0,
    gcTime: 5 * 60 * 1000,
    refetchOnWindowFocus: true,
    refetchOnMount: true,
    refetchInterval: 30 * 1000,
  });

  const { data: hostingConfig } = useHostingConfig();
  const isJiraHosting =
    Array.isArray(hostingConfig?.allowedWorkItemPlatforms) &&
    hostingConfig.allowedWorkItemPlatforms.length === 1 &&
    hostingConfig.allowedWorkItemPlatforms[0] === "jira";

  const projects = projectsData?.projects || [];
  const totalProjectsCount = projectsData?.totalCount || 0;
  const totalPages = Math.ceil(totalProjectsCount / projectPageSize);

  // Read query parameters and initialize selected project
  useEffect(() => {
    const params = new URLSearchParams(search);
    const urlProjectId = params.get("projectId");
    const urlProjectName = params.get("projectName");

    if (projects.length === 0) return;

    if (urlProjectId || urlProjectName) {
      const project = projects.find(
        (p) => p.id === urlProjectId || p.name === urlProjectName
      );
      if (project) {
        setSelectedProject(project);
      }
    }
  }, [projects, search]);

  useEffect(() => {
    if (isGlobalSpecificOrganizationSelected) {
      setSelectedProject((currentProject) => {
        if (!currentProject) return currentProject;
        const selectedSourceType = globalSelectedOrganization.sourceType;
        // For Jira selections, the server-side projects endpoint already scopes by
        // `x-organization-id`, and `project.organization` is often an instance URL.
        // Keep the current selection as long as it matches the selected platform.
        if (selectedSourceType === "jira") {
          // Prefer stable connection id matching when available.
          if (currentProject.integrationType !== "jira") return null;
          if (currentProject.jiraConnectionId) {
            return currentProject.jiraConnectionId === globalSelectedOrganization.id
              ? currentProject
              : null;
          }
          return currentProject;
        }
        // ADO: prefer stable artifactOrgId matching when available; fall back to name.
        if (currentProject.integrationType === "jira") return null;
        if (currentProject.artifactOrgId) {
          return currentProject.artifactOrgId === globalSelectedOrganization.id
            ? currentProject
            : null;
        }
        return currentProject.organization?.toLowerCase() ===
          globalSelectedOrganization.name.toLowerCase()
          ? currentProject
          : null;
      });
    }
  }, [
    globalSelectedOrganization,
    isGlobalSpecificOrganizationSelected,
    isGlobalAllOrganizations,
  ]);

  // Determine which project ID to use for fetching workflow artifacts
  const workflowProjectId = selectedProject?.id || null;

  // Fetch workflow artifacts (epics, features, user stories) generated via workflow builder
  const { data: workflowArtifactsData } =
    useQuery<WorkflowArtifactsApiResponse | null>({
      queryKey: ["/api/workflow/artifacts", workflowProjectId],
      queryFn: async () => {
        const params = new URLSearchParams({
          status: "saved",
          page: "1",
          limit: "50",
        });

        if (workflowProjectId) {
          params.append("projectId", workflowProjectId);
        }

        const response = await apiRequest(
          "GET",
          `/api/workflow/artifacts?${params.toString()}`
        );

        return (await response.json()) as WorkflowArtifactsApiResponse;
      },
      enabled: !!workflowProjectId,
      retry: false,
      staleTime: 30 * 1000,
      gcTime: 5 * 60 * 1000,
      refetchOnWindowFocus: true,
      refetchOnMount: true,
    });

  // Extract latest workflow artifact for the selected project
  const workflowArtifactsForProject = workflowArtifactsData?.artifacts ?? [];
  const latestWorkflowArtifact: WorkflowArtifact | null =
    workflowArtifactsForProject?.[0] ?? null;

  const workflowEpics: Epic[] = Array.isArray(latestWorkflowArtifact?.epics)
    ? (latestWorkflowArtifact?.epics as Epic[])
    : [];
  const workflowFeatures: Feature[] = Array.isArray(
    latestWorkflowArtifact?.features
  )
    ? (latestWorkflowArtifact?.features as Feature[])
    : [];
  const workflowUserStories: UserStory[] = Array.isArray(
    latestWorkflowArtifact?.userStories
  )
    ? (latestWorkflowArtifact?.userStories as UserStory[])
    : [];

  // Extract test cases from user stories in workflow_artifacts table
  // Each user story can have testCases array, we need to flatten them and add userStoryId
  const workflowTestCases = useMemo(() => {
    const testCases: Array<{
      id?: string;
      title?: string;
      scenario?: string;
      steps?: Array<{ step: number; action: string; result: string }>;
      testCaseSteps?: Array<{ step: number; action: string; result: string }>;
      priority?: string;
      userStoryId: string;
    }> = [];

    workflowUserStories.forEach((story: any) => {
      if (story.testCases && Array.isArray(story.testCases) && story.testCases.length > 0) {
        story.testCases.forEach((testCase: any) => {
          // Normalize test case structure - handle both 'steps' and 'testCaseSteps' formats
          const steps = testCase.testCaseSteps || testCase.steps || [];
          const normalizedSteps = Array.isArray(steps)
            ? steps.map((step: any, idx: number) => {
              // Handle different step formats
              if (typeof step === 'string') {
                return { step: idx + 1, action: step, result: '' };
              }
              if (step.Steps || step.step) {
                return {
                  step: step.Steps || step.step || idx + 1,
                  action: step.Action || step.action || '',
                  result: step['Expected Results'] || step.expectedResult || step.result || '',
                };
              }
              return {
                step: idx + 1,
                action: step.action || '',
                result: step.result || step.expectedResult || '',
              };
            })
            : [];

          testCases.push({
            id: testCase.id || `tc-${story.id}-${testCases.length}`,
            title: testCase.title || testCase.scenario || 'Untitled Test Case',
            scenario: testCase.scenario,
            steps: normalizedSteps,
            testCaseSteps: normalizedSteps,
            priority: testCase.priority || 'Medium',
            userStoryId: story.id,
          });
        });
      }
    });

    return testCases;
  }, [workflowUserStories]);

  // For Jira projects: fetch the actual issue types configured in that
  // project so the artifact tabs and the create-work-item dropdown only
  // show types that exist 
  // Polled in the background so changes made in Jira (issue type added /
  // removed at the project level) reflect here without a refresh.
  const isSelectedProjectJira =
    selectedProject?.integrationType === "jira" ||
    selectedProject?.organization === "Jira";
  const hasSelectedProjectJiraPat =
    selectedProject?.projectManagementPatConfigured === true ||
    selectedProject?.userJiraPatConfigured === true;

  const platformLabel =
    isJiraHosting || isSelectedProjectJira ? "Jira" : "ADO";

  type JiraProjectIssueType = {
    id: string;
    name: string;
    hierarchyLevel?: number;
    subtask?: boolean;
  };

  const { data: jiraIssueTypes = [] } = useQuery<JiraProjectIssueType[]>({
    queryKey: ["jira-issue-types", selectedProject?.id],
    enabled: !!selectedProject?.id && isSelectedProjectJira && hasSelectedProjectJiraPat,
    queryFn: async () => {
      const res = await apiRequest(
        "GET",
        `/api/jira/projects/${selectedProject!.id}/issue-types`,
      );
      if (!res.ok) return [];
      const json = (await res.json()) as {
        success?: boolean;
        issueTypes?: JiraProjectIssueType[];
      };
      return json.issueTypes || [];
    },
    staleTime: 0,
    gcTime: 5 * 60 * 1000,
    refetchOnWindowFocus: true,
    refetchOnMount: true,
    refetchInterval: 30 * 1000,
    refetchIntervalInBackground: false,
  });

  const {
    data: workItems = [],
    isLoading: isLoadingWorkItems,
  } = useQuery<WorkItem[]>({
    queryKey: selectedProject
      ? [
        `/api/hub/artifacts/${selectedProject.name}/work-items`,
        selectedProject.artifactOrgId,
        selectedProject.organizationUrl,
        selectedProject.organization,
        selectedProject.id,
      ]
      : [],
    enabled: !!selectedProject,
    queryFn: async () => {
      if (!selectedProject) return [];
      const params = new URLSearchParams();
      if (selectedProject.artifactOrgId) {
        params.append("artifactOrgId", selectedProject.artifactOrgId);
      } else if (selectedProject.organizationUrl) {
        params.append("organizationUrl", selectedProject.organizationUrl);
      }
      if (selectedProject.organization) {
        params.append("organization", selectedProject.organization);
      }
      if (selectedProject.id) {
        params.append("projectId", selectedProject.id);
      }
      const isJira = selectedProject.integrationType === 'jira' || selectedProject.organization === 'Jira';
      const url = isJira
        ? `/api/hub/artifacts/jira/${selectedProject.name}/work-items${params.toString() ? `?${params.toString()}` : ""}`
        : `/api/hub/artifacts/${selectedProject.name}/work-items${params.toString() ? `?${params.toString()}` : ""}`;
      const response = await apiRequest("GET", url);
      return (await response.json()) as WorkItem[];
    },
    // Live sync with Jira/ADO: always treat as stale, refetch on focus/mount,
    // and poll every 20s in the background. The user does not need a manual
    // "Refresh" button — changes made in Jira show up automatically.
    staleTime: 0,
    gcTime: 5 * 60 * 1000,
    refetchOnWindowFocus: true,
    refetchOnMount: true,
    refetchInterval: 20 * 1000,
    refetchIntervalInBackground: false,
  });

  // Design-prompt mappings for the current SDLC project. Used to render
  // a violet "Design" badge on Epic / User Story rows that have a
  // generated design prompt stored. selectedProject.id is the SDLC
  // project UUID, which is the design_mappings.projectId.
  interface DesignMappingRow {
    id: string;
    projectId: string;
    epicId: string;
    epicTitle: string;
    userStories: Array<{ id: string; title: string }> | string | null;
    prompt: string;
    figmaLink: string | null;
  }
  const { data: designMappings = [] } = useQuery<DesignMappingRow[]>({
    queryKey: selectedProject
      ? [`/api/design-mapping/${selectedProject.id}`]
      : [],
    enabled: !!selectedProject?.id,
    queryFn: async () => {
      if (!selectedProject?.id) return [];
      const response = await apiRequest(
        "GET",
        `/api/design-mapping/${selectedProject.id}`,
      );
      return (await response.json()) as DesignMappingRow[];
    },
    staleTime: 2 * 60 * 1000,
    gcTime: 5 * 60 * 1000,
  });

  const designPromptItemIds = useMemo(() => {
    const ids = new Set<string>();
    for (const m of designMappings) {
      if (m.epicId) ids.add(String(m.epicId));
      const stories =
        typeof m.userStories === "string"
          ? (() => {
              try {
                return JSON.parse(m.userStories);
              } catch {
                return [];
              }
            })()
          : m.userStories ?? [];
      if (Array.isArray(stories)) {
        for (const us of stories) {
          if (us?.id != null) ids.add(String(us.id));
        }
      }
    }
    return ids;
  }, [designMappings]);

  // Build DB-only work items (unpushed workflow artifacts) and merge with ADO items.
  // ADO items are the source of truth – if an item exists in both ADO and DB,
  // we prefer the ADO version and hide the duplicate DB draft.
  const combinedWorkItems: WorkItem[] = useMemo(() => {
    // If no workflow artifacts at all, just return ADO items
    // But we still need to process test cases if they exist, so check for test cases separately
    if (!latestWorkflowArtifact) {
      return workItems;
    }

    // Filter workflow artifacts to only those not yet pushed to ADO
    // For user stories: if a story has adoWorkItemId but also has pushedTasks array,
    // it means only some tasks were pushed, so we should still show the story and its unpushed tasks
    const unpushedEpics = workflowEpics.filter(
      (epic: any) => !epic.adoWorkItemId && !epic.adoId
    );
    const unpushedFeatures = workflowFeatures.filter(
      (feature: any) => !feature.adoWorkItemId && !feature.adoId
    );
    const unpushedStories = workflowUserStories.filter(
      (story: any) => {
        // If story has no ADO ID, it's unpushed
        if (!story.adoWorkItemId && !story.adoId) return true;
        // If story has ADO ID but also has pushedTasks array, it means only some tasks were pushed
        // Keep the story visible so unpushed tasks can still be shown
        if (story.adoWorkItemId && Array.isArray(story.pushedTasks)) {
          // Check if all tasks have been pushed
          const totalTasks = Array.isArray(story.subtasks) ? story.subtasks.length : 0;
          return story.pushedTasks.length < totalTasks;
        }
        // Story is fully pushed (has ADO ID and no pushedTasks array, or all tasks pushed)
        return false;
      }
    );

    // Check if we have test cases to process - if so, we need to continue even if no unpushed epics/features/stories
    const hasTestCasesToProcess = workflowTestCases && workflowTestCases.length > 0;

    // If no unpushed epics/features/stories AND no test cases, just return ADO items
    if (
      !unpushedEpics.length &&
      !unpushedFeatures.length &&
      !unpushedStories.length &&
      !hasTestCasesToProcess
    ) {
      return workItems;
    }

    const epicMap = new Map<string, WorkItem>();
    const featureMap = new Map<string, WorkItem>();
    const storyMap = new Map<string, WorkItem>(); // Track created stories

    // Create epic-level DB items
    unpushedEpics.forEach((epic) => {
      const dbEpic: WorkItem = {
        id: `db-epic-${epic.id}`,
        title: epic.title,
        type: "Epic",
        status: (epic as any).status || "Backlog",
        priority: epic.priority || "Medium",
        linkedItems: [],
        source: "DB",
        dbArtifact: epic,
        dbArtifactType: "Epic",
      };
      epicMap.set(epic.id, dbEpic);
    });

    // Create feature-level DB items and attach to epics when possible
    // Note: Features are attached to epics only if the epic is also unpushed
    unpushedFeatures.forEach((feature) => {
      const dbFeature: WorkItem = {
        id: `db-feature-${feature.id}`,
        title: feature.title,
        type: "Feature",
        status: (feature as any).status || "Backlog",
        priority: feature.priority || "Medium",
        linkedItems: [],
        source: "DB",
        dbArtifact: feature,
        dbArtifactType: "Feature",
      };

      featureMap.set(feature.id, dbFeature);

      // Only attach to epic if the epic is also unpushed (exists in epicMap)
      const parentEpic = feature.epicId ? epicMap.get(feature.epicId) : null;
      if (parentEpic) {
        (parentEpic.linkedItems ||= []).push(dbFeature);
      }
      // If parent epic was pushed, the feature will be added as a root item below
    });

    // Create user story–level DB items and attach to features (or epics) when possible
    unpushedStories.forEach((story) => {
      // Build task-level work items from story subtasks
      // Filter out tasks that have already been pushed (if story has pushedTasks array)
      const pushedTasks = Array.isArray((story as any).pushedTasks)
        ? (story as any).pushedTasks
        : [];
      const allTaskItems: WorkItem[] = Array.isArray((story as any).subtasks)
        ? ((story as any).subtasks as any[]).map(
          (subtask: any, idx: number): WorkItem => {
            // Handle both string and object subtasks
            const subtaskTitle = typeof subtask === "string"
              ? subtask
              : (subtask?.title || subtask?.description || `Task ${idx + 1}`);
            return {
              id: `db-task-${story.id}-${idx}`,
              title: subtaskTitle,
              type: "Task",
              status: (story as any).status || "Backlog",
              priority: story.priority || "Medium",
              linkedItems: [],
              source: "DB" as const,
            };
          }
        )
        : [];
      // Filter out tasks that have already been pushed
      const taskItems = allTaskItems.filter(
        (_, idx: number) => !pushedTasks.includes(idx)
      );

      const dbStory: WorkItem = {
        id: `db-story-${story.id}`,
        title: story.title,
        type: "User Story",
        status: (story as any).status || "Backlog",
        priority: story.priority || "Medium",
        linkedItems: taskItems,
        source: "DB",
        dbArtifact: story,
        dbArtifactType: "User Story",
      };

      const parentFeature = story.featureId
        ? featureMap.get(story.featureId)
        : null;
      const parentEpic =
        !parentFeature && story.epicId ? epicMap.get(story.epicId) : null;

      // Store story in map for later reference
      storyMap.set(story.id, dbStory);

      if (parentFeature) {
        (parentFeature.linkedItems ||= []).push(dbStory);
      } else if (parentEpic) {
        (parentEpic.linkedItems ||= []).push(dbStory);
      }
      // If parent was pushed (not in maps), story will be added as root item below
    });

    // Add test cases from DB to their parent user stories
    // First, build a map of ADO test cases by title for deduplication
    const extractTestCasesFromItems = (items: WorkItem[]): WorkItem[] => {
      const testCases: WorkItem[] = [];
      for (const item of items) {
        if (item.type === "Test Case") {
          testCases.push(item);
        }
        if (item.linkedItems && item.linkedItems.length > 0) {
          testCases.push(...extractTestCasesFromItems(item.linkedItems));
        }
      }
      return testCases;
    };

    const adoTestCases = extractTestCasesFromItems(workItems);
    const adoTestCaseTitles = new Set(
      adoTestCases.map((tc) => `${tc.type || "Test Case"}:${tc.title.trim().toLowerCase()}`)
    );

    // Build a map of DB story IDs to ADO work item IDs for stories that were pushed
    const dbStoryIdToAdoIdMap = new Map<string, string>();
    workflowUserStories.forEach((story: any) => {
      const adoId = story.adoWorkItemId || story.adoId;
      if (adoId && story.id) {
        dbStoryIdToAdoIdMap.set(story.id, adoId.toString());
      }
    });

    // Build a map of ADO work item IDs to WorkItem objects for quick lookup
    const adoItemMap = new Map<string, WorkItem>();
    const buildAdoItemMap = (items: WorkItem[]) => {
      items.forEach((item) => {
        adoItemMap.set(item.id, item);
        if (item.linkedItems && item.linkedItems.length > 0) {
          buildAdoItemMap(item.linkedItems);
        }
      });
    };
    buildAdoItemMap(workItems);

    // Track orphaned test cases (those that can't be linked to a parent story)
    const orphanedTestCases: WorkItem[] = [];

    // Create test case work items from DB and link them to user stories
    workflowTestCases.forEach((testCase: any) => {
      // Skip if a test case with the same type and title exists in ADO
      const testCaseTitle = (testCase.title || "").trim().toLowerCase();
      const testCaseKey = `Test Case:${testCaseTitle}`;
      if (adoTestCaseTitles.has(testCaseKey)) {
        return;
      }

      // Convert DB test case steps to WorkItem format
      // Test cases from workflow_artifacts can have steps in testCaseSteps or steps field
      const rawSteps = testCase.testCaseSteps || testCase.steps || [];
      const testCaseSteps = Array.isArray(rawSteps)
        ? rawSteps.map((step: any) => ({
          step: step.step || step.Steps || 0,
          action: step.action || step.Action || "",
          expectedResult: step.result || step.expectedResult || step['Expected Results'] || "",
        }))
        : [];

      // Generate a unique ID for the test case if it doesn't have one
      const testCaseId = testCase.id || `tc-${testCase.userStoryId}-${Math.random().toString(36).substr(2, 9)}`;

      const dbTestCase: WorkItem = {
        id: `db-testcase-${testCaseId}`,
        title: testCase.title || testCase.scenario || "Untitled Test Case",
        type: "Test Case",
        status: "Draft", // Mark as draft since it's not in ADO
        priority: testCase.priority || "Medium",
        linkedItems: [],
        source: "DB",
        dbArtifact: testCase,
        dbArtifactType: "Test Case",
        testCaseSteps: testCaseSteps.length > 0 ? testCaseSteps : undefined,
      };

      // Link test case to its parent user story
      const parentStoryId = testCase.userStoryId;
      let linked = false;

      if (parentStoryId) {
        // First, try to find the story in DB stories (storyMap)
        const dbStory = storyMap.get(parentStoryId);
        if (dbStory) {
          (dbStory.linkedItems ||= []).push(dbTestCase);
          linked = true;
        } else {
          // If not found in DB stories, the story might have been pushed to ADO
          // Look up the ADO work item ID for this DB story
          const adoStoryId = dbStoryIdToAdoIdMap.get(parentStoryId);
          if (adoStoryId) {
            const adoStory = adoItemMap.get(adoStoryId);
            if (adoStory && adoStory.type === "User Story") {
              (adoStory.linkedItems ||= []).push(dbTestCase);
              linked = true;
            }
          }
        }
      }

      // If we couldn't link the test case to a parent story, add it to orphaned list
      // This can happen if the parent story doesn't exist or hasn't been loaded yet
      if (!linked) {
        if (parentStoryId) {
          console.warn(
            `[Hub Artifacts] Could not find parent story ${parentStoryId} for test case ${testCase.id}, adding as orphaned`
          );
        }
        orphanedTestCases.push(dbTestCase);
      }
    });

    // Collect DB roots (epics + any features without epics, and standalone stories)
    const dbRootItems: WorkItem[] = [];

    epicMap.forEach((epicItem) => {
      dbRootItems.push(epicItem);
    });

    // Features that don't have an epic parent OR whose epic parent was pushed
    unpushedFeatures.forEach((feature) => {
      const featureItem = featureMap.get(feature.id);
      if (featureItem) {
        // Check if this feature is already attached to an unpushed epic
        const isAttachedToUnpushedEpic =
          feature.epicId && epicMap.has(feature.epicId);

        // Add as root item if:
        // 1. No epic parent, OR
        // 2. Epic parent was pushed (not in epicMap)
        if (!feature.epicId || !isAttachedToUnpushedEpic) {
          dbRootItems.push(featureItem);
        }
      }
    });

    // Stories that don't have a feature or epic parent, OR whose parents were pushed
    unpushedStories.forEach((story) => {
      const hasFeatureParent = story.featureId
        ? featureMap.has(story.featureId)
        : false;
      const hasEpicParent = story.epicId ? epicMap.has(story.epicId) : false;

      // Check if story is already attached to an unpushed parent
      const isAttachedToUnpushedParent = hasFeatureParent || hasEpicParent;

      // Add as root item if not attached to an unpushed parent
      // (either has no parent, or parent was pushed)
      if (!isAttachedToUnpushedParent) {
        // Get the story we already created in the loop above
        const existingStory = storyMap.get(story.id);
        if (existingStory) {
          dbRootItems.push(existingStory);
        }
      }
    });

    // Add orphaned test cases (those that couldn't be linked to a parent story) as root items
    orphanedTestCases.forEach((testCase) => {
      dbRootItems.push(testCase);
    });

    // Build the remote-source items list. Tag with the correct origin so the
    // UI badge reflects ADO vs Jira; fall back to project.integrationType when
    // the server didn't already stamp `source` onto the item.
    const isJiraProject =
      selectedProject?.integrationType === "jira" ||
      selectedProject?.organization === "Jira";
    const defaultRemoteSource: "ADO" | "Jira" = isJiraProject ? "Jira" : "ADO";
    const adoItems = workItems.map((item) => ({
      ...item,
      source: item.source ?? defaultRemoteSource,
    }));

    // Build a lookup of ADO work items by normalized title and type so we can
    // suppress duplicate DB drafts that represent the same logical item.
    const buildKey = (wi: WorkItem) => {
      const title = wi.title;
      const titleStr = typeof title === "string"
        ? title.trim().toLowerCase()
        : String(title || "").trim().toLowerCase();
      // Include type in key to avoid conflicts between different work item types
      return `${wi.type || ""}:${titleStr}`;
    };

    const adoKeys = new Set<string>();
    // Recursively collect all ADO items including nested ones (like test cases)
    const collectAdoKeys = (items: WorkItem[]) => {
      items.forEach((wi) => {
        adoKeys.add(buildKey(wi));
        if (wi.linkedItems && wi.linkedItems.length > 0) {
          collectAdoKeys(wi.linkedItems);
        }
      });
    };
    collectAdoKeys(adoItems);

    // Recursively filter DB items and their children that duplicate an ADO item
    const dedupeDbItems = (items: WorkItem[]): WorkItem[] => {
      const result: WorkItem[] = [];

      for (const wi of items) {
        const key = buildKey(wi);

        // If an ADO item with the same type + title exists, skip this DB draft
        if (adoKeys.has(key)) {
          continue;
        }

        let cleanedLinkedItems: WorkItem[] | undefined = wi.linkedItems;
        if (wi.linkedItems && wi.linkedItems.length > 0) {
          cleanedLinkedItems = dedupeDbItems(wi.linkedItems);
        }

        result.push({
          ...wi,
          // If all children were filtered out, ensure we don't leave stale references
          linkedItems:
            cleanedLinkedItems && cleanedLinkedItems.length > 0
              ? cleanedLinkedItems
              : cleanedLinkedItems && cleanedLinkedItems.length === 0
                ? []
                : wi.linkedItems,
        });
      }

      return result;
    };

    const dedupedDbRoots = dedupeDbItems(dbRootItems);

    // Finally, show all ADO items first (source of truth), followed by DB-only draft items
    return [...adoItems, ...dedupedDbRoots];
  }, [
    workItems,
    latestWorkflowArtifact,
    workflowEpics,
    workflowFeatures,
    workflowUserStories,
    workflowTestCases,
    // Re-tag default source when switching between ADO/Jira projects
    selectedProject?.integrationType,
    selectedProject?.organization,
  ]);

  // Helpers to find DB work item relationships within the combined tree
  const findParentInCombined = (targetId: string): WorkItem | null => {
    const search = (items: WorkItem[]): WorkItem | null => {
      for (const wi of items) {
        if (
          wi.linkedItems &&
          wi.linkedItems.some((child) => child.id === targetId)
        ) {
          return wi;
        }
        if (wi.linkedItems && wi.linkedItems.length > 0) {
          const nested = search(wi.linkedItems);
          if (nested) return nested;
        }
      }
      return null;
    };
    return search(combinedWorkItems);
  };

  const findItemInCombined = (targetId: string): WorkItem | null => {
    const search = (items: WorkItem[]): WorkItem | null => {
      for (const wi of items) {
        if (wi.id === targetId) return wi;
        if (wi.linkedItems && wi.linkedItems.length > 0) {
          const nested = search(wi.linkedItems);
          if (nested) return nested;
        }
      }
      return null;
    };
    return search(combinedWorkItems);
  };

  // Fetch work items for autocomplete in link dialog (with debouncing)
  const autocompleteQueryKey = useMemo(() => {
    if (!linkDialogOpen || !selectedProject) {
      return ["/api/hub/artifacts/work-items/autocomplete", "disabled"];
    }
    return [
      `/api/hub/artifacts/${selectedProject.name}/work-items/autocomplete`,
      selectedProject.artifactOrgId || "",
      selectedProject.organizationUrl || "",
      debouncedWorkItemSearchTerm || "",
    ];
  }, [linkDialogOpen, selectedProject, debouncedWorkItemSearchTerm]);

  const { data: autocompleteWorkItems = [], isLoading: isLoadingAutocomplete } =
    useQuery<Array<{ id: string; title: string; type: string; state: string }>>(
      {
        queryKey: autocompleteQueryKey,
        enabled: linkDialogOpen && !!selectedProject,
        queryFn: async () => {
          if (!selectedProject || !linkDialogOpen) return [];
          const params = new URLSearchParams();
          if (selectedProject.artifactOrgId) {
            params.append("artifactOrgId", selectedProject.artifactOrgId);
          } else if (selectedProject.organizationUrl) {
            params.append("organizationUrl", selectedProject.organizationUrl);
          }
          // Use debounced search term
          const searchTerm = debouncedWorkItemSearchTerm?.trim() || "";
          if (searchTerm) {
            params.append("search", searchTerm);
          }
          const url = `/api/hub/artifacts/${selectedProject.name
            }/work-items/autocomplete${params.toString() ? `?${params.toString()}` : ""
            }`;
          const response = await apiRequest("GET", url);
          return (await response.json()) as Array<{
            id: string;
            title: string;
            type: string;
            state: string;
          }>;
        },
        staleTime: 30 * 1000, // Cache for 30 seconds
        gcTime: 2 * 60 * 1000, // Keep in cache for 2 minutes
        retry: false, // Don't retry if query fails
      }
    );

  const fetchWorkItemDetailsMutation = useMutation({
    mutationFn: async (data: {
      projectName: string;
      workItemId: string;
      artifactOrgId?: string;
      organizationUrl?: string;
      organization?: string;
      projectId?: string;
      integrationType?: "ado" | "jira";
    }) => {
      const params = new URLSearchParams();
      if (data.artifactOrgId) {
        params.append("artifactOrgId", data.artifactOrgId);
      } else if (data.organizationUrl) {
        params.append("organizationUrl", data.organizationUrl);
      }
      if (data.organization) {
        params.append("organization", data.organization);
      }
      if (data.projectId) {
        params.append("projectId", data.projectId);
      }
      // Robust isJira check: data.organization is often the Jira instance URL
      // (e.g. https://acme.atlassian.net), NOT the literal string "Jira".
      const isJira =
        data.integrationType === "jira" ||
        data.organization === "Jira" ||
        (typeof data.organizationUrl === "string" &&
          data.organizationUrl.toLowerCase().includes("atlassian.net"));
      const url = isJira
        ? `/api/hub/artifacts/jira/${data.projectName}/work-item/${data.workItemId}${params.toString() ? `?${params.toString()}` : ""}`
        : `/api/hub/artifacts/${data.projectName}/work-item/${data.workItemId}${params.toString() ? `?${params.toString()}` : ""}`;
      const response = await apiRequest("GET", url);
      const workItemData = (await response.json()) as DetailedWorkItem;
      return workItemData;
    },
    onMutate: (data) => {
      // Open the details dialog immediately and show a loading spinner
      setDetailsLoadingId(data.workItemId);
      setSelectedWorkItemDetails(null);
      setDetailsDialogOpen(true);
    },
    onSuccess: (data) => {
      setSelectedWorkItemDetails(data);
      setDetailsDialogOpen(true);
    },
    onError: (error: Error) => {
      setSelectedWorkItemDetails({
        id: "not-found",
        title: "Error: Task Not Found",
        description: error.message || "The requested resource could not be found.",
        type: "Task",
        state: "Error",
        assignedTo: "",
        createdBy: "",
        createdDate: new Date().toISOString(),
        changedDate: new Date().toISOString(),
        priority: 0,
        storyPoints: 0,
        acceptanceCriteria: "",
        tags: "",
        url: "",
        severity: null,
        businessValue: null,
        timeCriticality: null,
        effort: null,
        remainingWork: null,
        originalEstimate: null,
        completedWork: null,
        reproSteps: "",
        testCaseSteps: undefined,
        iterationPath: "",
        areaPath: "",
        relations: [],
        parent: null,
        children: [],
      });
      setDetailsDialogOpen(true);
    },
    onSettled: () => {
      setDetailsLoadingId(null);
    },
  });

  const linkMutation = useMutation({
    mutationFn: async (data: {
      sourceWorkItemId: string;
      targetWorkItemId: string;
      linkType: string;
      projectName: string;
      artifactOrgId?: string;
      organizationUrl?: string;
    }) => {
      return await apiRequest(
        "POST",
        `/api/hub/artifacts/link-work-items`,
        data
      );
    },
    onSuccess: () => {
      toast({
        title: "Success",
        description: "Work items linked successfully",
      });
      setLinkDialogOpen(false);
      setTargetWorkItemId("");
      setLinkComboboxOpen(false);
      setWorkItemSearchTerm("");
      if (selectedProject) {
        queryClient.invalidateQueries({
          queryKey: [`/api/hub/artifacts/${selectedProject.name}/work-items`],
        });
      }
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to link work items",
        variant: "destructive",
      });
    },
  });

  const handleLinkWorkItem = () => {
    if (!selectedWorkItem || !targetWorkItemId || !selectedProject) {
      toast({
        title: "Error",
        description:
          "Please select a work item and enter a target work item ID",
        variant: "destructive",
      });
      return;
    }

    linkMutation.mutate({
      sourceWorkItemId: selectedWorkItem.id,
      targetWorkItemId,
      linkType,
      projectName: selectedProject.name,
      artifactOrgId: selectedProject.artifactOrgId,
      organizationUrl: selectedProject.organizationUrl,
    });
  };

  const unlinkMutation = useMutation({
    mutationFn: async (data: {
      sourceWorkItemId: string;
      targetWorkItemId: string;
      projectName: string;
      artifactOrgId?: string;
      organizationUrl?: string;
    }) => {
      return await apiRequest(
        "DELETE",
        `/api/hub/artifacts/unlink-work-items`,
        data
      );
    },
    onSuccess: () => {
      toast({
        title: "Success",
        description: "Work items unlinked successfully",
      });
      if (selectedProject) {
        queryClient.invalidateQueries({
          queryKey: [`/api/hub/artifacts/${selectedProject.name}/work-items`],
        });
      }
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to unlink work items",
        variant: "destructive",
      });
    },
    onSettled: () => {
      setUnlinkingKey(null);
    },
  });

  const handleUnlinkWorkItem = (sourceId: string, targetId: string) => {
    if (!selectedProject) {
      toast({
        title: "Error",
        description: "No project selected",
        variant: "destructive",
      });
      return;
    }

    setUnlinkingKey(`${sourceId}-${targetId}`);
    unlinkMutation.mutate({
      sourceWorkItemId: sourceId,
      targetWorkItemId: targetId,
      projectName: selectedProject.name,
      artifactOrgId: selectedProject.artifactOrgId,
      organizationUrl: selectedProject.organizationUrl,
    });
  };

  const handlePushToADO = async (item: WorkItem) => {
    if (!selectedProject || !latestWorkflowArtifact) {
      toast({
        title: "Error",
        description: "Cannot push: Missing project or artifact data",
        variant: "destructive",
      });
      return;
    }

    // Tasks don't have dbArtifact, they're subtasks of user stories
    if (item.type !== "Task" && !item.dbArtifact) {
      toast({
        title: "Error",
        description: "Cannot push: Missing artifact data",
        variant: "destructive",
      });
      return;
    }

    setPushingToADO(item.id);

    try {
      // Determine the type - tasks don't have dbArtifact, they're linked to stories
      let type: "epic" | "feature" | "story" | "task";
      if (item.type === "Task") {
        type = "task";
      } else if (item.dbArtifactType) {
        type =
          item.dbArtifactType === "Epic"
            ? "epic"
            : item.dbArtifactType === "Feature"
              ? "feature"
              : "story";
      } else {
        type =
          item.type === "Epic"
            ? "epic"
            : item.type === "Feature"
              ? "feature"
              : "story";
      }

      // Get all artifacts from the workflow artifact
      const epics = latestWorkflowArtifact.epics || [];
      const features = latestWorkflowArtifact.features || [];
      const userStories = latestWorkflowArtifact.userStories || [];

      // Extract the actual artifact ID from the dbArtifact or item ID
      let artifactId: string;
      if (type === "task") {
        // For tasks, use the full task ID (db-task-{storyId}-{idx})
        artifactId = item.id;
      } else if (item.dbArtifact?.id) {
        artifactId = item.dbArtifact.id;
      } else {
        // Fallback: extract from synthetic ID format (db-epic-{id}, db-feature-{id}, etc.)
        const match = item.id.match(/^db-(epic|feature|story|task)-(.+)$/);
        if (match) {
          artifactId = match[2];
        } else {
          artifactId = item.id;
        }
      }

      // Get organization and projectName from query params or selected project
      const params = new URLSearchParams(window.location.search);
      const urlOrganization = params.get("organization");
      const urlProjectName = params.get("projectName");

      // Build the request payload with hierarchical push logic
      // Payload enhancement ONLY: include BRD and requirement traceability when available
      const pushBody: any = {
        projectName: urlProjectName || selectedProject.name, // Use projectName from query params
        organization: urlOrganization || selectedProject.organization, // Use organization from query params
        artifactOrgId: selectedProject.artifactOrgId,
        organizationUrl: selectedProject.organizationUrl,
        projectId: selectedProject.id,
        selectedItem: {
          type,
          id: artifactId,
        },
        epics,
        features,
        userStories,
        artifactId: latestWorkflowArtifact.id,
      };

      // Attach BRD and requirement traceability from the latest workflow artifact if present.
      // These are optional and won't break existing behavior if missing.
      if ((latestWorkflowArtifact as any).brdId) {
        pushBody.brdId = (latestWorkflowArtifact as any).brdId;
      } else {
        pushBody.brdId = null;
      }

      // If the artifact already carries requirement IDs, pass them through;
      // otherwise, send an empty array for backward‑compatible safety.
      if (Array.isArray((latestWorkflowArtifact as any).requirementIds)) {
        pushBody.requirementIds = (latestWorkflowArtifact as any).requirementIds;
      } else {
        pushBody.requirementIds = [];
      }

      const isJira = selectedProject.integrationType === 'jira' || selectedProject.organization === 'Jira';
      const endpoint = isJira
        ? "/api/hub/artifacts/push-to-jira"
        : "/api/hub/artifacts/push-to-ado";

      const response = await apiRequest(
        "POST",
        endpoint,
        pushBody
      );

      let result = await response.json();

      // Async-job pattern (Jira only): backend returns 202 + jobId for the
      // hub artifacts Jira push to dodge AWS API Gateway's 29s timeout.
      if (isJira && response.status === 202 && result?.jobId) {
        result = await pollAsyncJob<typeof result>('hub-artifacts-push-to-jira', result.jobId);
      }

      if (result.success) {
        toast({
          title: "Success",
          description: result.message || `Successfully pushed to ${isJira ? 'Jira' : 'Azure DevOps'}`,
        });
        // Refresh the work items and workflow artifacts
        if (selectedProject) {
          const workflowProjectId = selectedProject.id || null;
          queryClient.invalidateQueries({
            queryKey: [`/api/hub/artifacts/${selectedProject.name}/work-items`],
          });
          // Invalidate workflow artifacts query with projectId to ensure proper refresh
          queryClient.invalidateQueries({
            queryKey: ["/api/workflow/artifacts", workflowProjectId],
          });
          // Also invalidate without projectId as fallback
          queryClient.invalidateQueries({
            queryKey: ["/api/workflow/artifacts"],
          });
        }
      } else {
        toast({
          title: "Error",
          description:
            result.error ||
            `Failed to push to ${isJira ? "Jira" : "Azure DevOps"}`,
          variant: "destructive",
        });
      }
    } catch (error: any) {
      const isJiraCatch = selectedProject?.integrationType === 'jira' || selectedProject?.organization === 'Jira';
      toast({
        title: "Error",
        description:
          error.message ||
          `Failed to push to ${isJiraCatch ? "Jira" : "Azure DevOps"}`,
        variant: "destructive",
      });
    } finally {
      setPushingToADO(null);
    }
  };

  // Build a draft-only graph of parent/child relationships so we can implement
  // hierarchical checkbox selection for draft artifacts without affecting ADO items.
  type DraftNode = {
    id: string;
    type: string;
    parents: Set<string>;
    children: Set<string>;
  };

  const draftGraph = useMemo(() => {
    const nodes = new Map<string, DraftNode>();

    const ensureNode = (id: string, type: string): DraftNode => {
      let node = nodes.get(id);
      if (!node) {
        node = { id, type, parents: new Set(), children: new Set() };
        nodes.set(id, node);
      }
      return node;
    };

    const visit = (item: WorkItem, parentId?: string) => {
      if (item.source !== "DB") return;
      const node = ensureNode(item.id, item.type);
      if (parentId) {
        node.parents.add(parentId);
        const parentNode = ensureNode(parentId, "");
        parentNode.children.add(item.id);
      }
      if (item.linkedItems && item.linkedItems.length > 0) {
        item.linkedItems.forEach((child) => visit(child, item.id));
      }
    };

    combinedWorkItems.forEach((root) => visit(root));
    return nodes;
  }, [combinedWorkItems]);

  // Quick lookup for draft work items by ID so we can build push payloads
  // based on the currently selected draft checkboxes.
  const draftItemMap = useMemo(() => {
    const map = new Map<string, WorkItem>();

    const visit = (item: WorkItem) => {
      if (item.source === "DB") {
        map.set(item.id, item);
      }
      if (item.linkedItems && item.linkedItems.length > 0) {
        item.linkedItems.forEach(visit);
      }
    };

    combinedWorkItems.forEach(visit);
    return map;
  }, [combinedWorkItems]);

  // Items filtered by tab + search (but before ADO/Draft source filter).
  //
  // Search matches against: title, internal id (ADO numeric / Jira numeric /
  // draft id), AND Jira issue key (externalId, e.g. "PROJ-123"). Users may
  // type any of them — the details dialog surfaces the id, so they should
  // be able to search by it too.
  const baseFilteredWorkItems = useMemo(() => {
    let baseItems: WorkItem[];
    const query = workItemFilterQuery.trim().toLowerCase();

    const itemMatchesQuery = (item: WorkItem): boolean => {
      if (!query) return true;
      if (item.id && item.id.toLowerCase().includes(query)) return true;
      if (item.title && item.title.toLowerCase().includes(query)) return true;
      if (item.externalId && item.externalId.toLowerCase().includes(query))
        return true;
      return false;
    };

    const collectByPredicate = (
      items: WorkItem[],
      predicate: (item: WorkItem, parent: WorkItem | null) => boolean,
    ): WorkItem[] => {
      const results: WorkItem[] = [];
      const seen = new Set<string>();

      const walk = (item: WorkItem, parent: WorkItem | null) => {
        if (predicate(item, parent)) {
          const dedupeKey = `${item.id}:${item.externalId || ""}:${item.type}`;
          if (!seen.has(dedupeKey)) {
            seen.add(dedupeKey);
            // Non-Epic tabs must only contain that type and no mixed nested rows.
            results.push({ ...item, linkedItems: [] });
          }
        }

        if (item.linkedItems && item.linkedItems.length > 0) {
          item.linkedItems.forEach((child) => walk(child, item));
        }
      };

      items.forEach((item) => walk(item, null));
      return results;
    };

    if (selectedTab === "all") {
      if (!query) {
        baseItems = combinedWorkItems.filter((item) => item.type === "Epic");
      } else {
        const matchedItems: WorkItem[] = [];

        const collectMatchesDeep = (item: WorkItem) => {
          if (itemMatchesQuery(item)) {
            matchedItems.push(item);
          }

          if (item.linkedItems && item.linkedItems.length > 0) {
            item.linkedItems.forEach(collectMatchesDeep);
          }
        };

        combinedWorkItems.forEach(collectMatchesDeep);

        baseItems = matchedItems;
      }
    } else if (selectedTab === "linked") {
      // Subtasks tab: only Task items that are children of a User Story.
      baseItems = collectByPredicate(
        combinedWorkItems,
        (item, parent) => item.type === "Task" && parent?.type === "User Story",
      );
    } else {
      switch (selectedTab) {
        case "feature":
          baseItems = collectByPredicate(
            combinedWorkItems,
            (item) => item.type === "Feature",
          );
          break;
        case "user-story":
          baseItems = collectByPredicate(
            combinedWorkItems,
            (item) => item.type === "User Story",
          );
          break;
        case "task":
          // Task tab: only tasks that are NOT subtasks (not under User Story).
          baseItems = collectByPredicate(
            combinedWorkItems,
            (item, parent) => item.type === "Task" && parent?.type !== "User Story",
          );
          break;
        case "bug":
          baseItems = collectByPredicate(
            combinedWorkItems,
            (item) => item.type === "Bug",
          );
          break;
        case "issue":
          baseItems = collectByPredicate(
            combinedWorkItems,
            (item) => item.type === "Issue",
          );
          break;
        case "testcase":
          baseItems = collectByPredicate(
            combinedWorkItems,
            (item) => item.type === "Test Case",
          );
          break;
        default:
          baseItems = combinedWorkItems;
      }
    }

    // Apply search filter by title / id / externalId (case-insensitive)
    if (!query) return baseItems;
    return baseItems.filter(itemMatchesQuery);
  }, [combinedWorkItems, selectedTab, workItemFilterQuery]);

  // Search match data across ALL types (independent of the active tab).
  // Powers the per-tab inline match counts, the auto-tab-switch to the
  // best-matching item's type, and the initial cursor jump (matchIndex).
  //
  // Best-match priority:
  //   1. higher KIND wins:    exact (field === query) > prefix > substring
  //   2. on ties, SHORTER matched field wins, so "PROJHILTI-6" beats
  //      "PROJHILTI-65" beats "PROJHILTI-675" when typing "projhilti-6".
  const searchMatchInfo = useMemo(() => {
    const query = workItemFilterQuery.trim().toLowerCase();
    const counts: Partial<Record<WorkItemTab, number>> = {};
    if (!query) {
      return {
        counts,
        firstMatchTab: null as WorkItemTab | null,
        firstMatchId: null as string | null,
      };
    }

    type Kind = "exact" | "prefix" | "substring";
    const rank: Record<Kind, number> = { exact: 3, prefix: 2, substring: 1 };
    const classify = (
      s: string | undefined,
    ): { kind: Kind; len: number } | null => {
      if (!s) return null;
      const ls = s.toLowerCase();
      if (ls === query) return { kind: "exact", len: s.length };
      if (ls.startsWith(query)) return { kind: "prefix", len: s.length };
      if (ls.includes(query)) return { kind: "substring", len: s.length };
      return null;
    };

    type Score = { kind: Kind; len: number };
    const better = (a: Score, b: Score): boolean => {
      if (rank[a.kind] !== rank[b.kind]) return rank[a.kind] > rank[b.kind];
      // Same kind → shorter matched field is closer to an exact hit.
      return a.len < b.len;
    };

    let bestScore: Score | null = null;
    let bestTab: WorkItemTab | null = null;
    let bestId: string | null = null;
    let firstTab: WorkItemTab | null = null;
    let firstId: string | null = null;

    const walk = (item: WorkItem) => {
      const candidates = [
        classify(item.externalId),
        classify(item.id),
        classify(item.title),
      ].filter((c): c is Score => c !== null);
      if (candidates.length > 0) {
        // Best field within this item.
        const itemScore = candidates.reduce(
          (a, b) => (better(a, b) ? a : b),
          candidates[0],
        );
        const tab = WORK_ITEM_TYPE_TO_TAB[item.type];
        if (tab) {
          counts[tab] = (counts[tab] ?? 0) + 1;
          if (!firstTab) {
            firstTab = tab;
            firstId = item.id;
          }
          if (!bestScore || better(itemScore, bestScore)) {
            bestScore = itemScore;
            bestTab = tab;
            bestId = item.id;
          }
        }
      }
      if (item.linkedItems && item.linkedItems.length > 0) {
        item.linkedItems.forEach(walk);
      }
    };
    combinedWorkItems.forEach(walk);

    return {
      counts,
      firstMatchTab: bestTab ?? firstTab,
      firstMatchId: bestId ?? firstId,
      // Only "exact" matches trigger an auto-jump (see effect below). A
      // loose substring like "pro" would otherwise teleport the cursor
      // deep into the list (e.g. "184/192") on first keystroke, which
      // is jarring. For non-exact queries we leave the cursor at 1/N
      // and let Enter / arrows walk the list.
      firstMatchKind: (bestScore as Score | null)?.kind ?? null,
    };
  }, [combinedWorkItems, workItemFilterQuery]);

  // parentId map across the combined tree. Used to auto-expand ancestors
  // of the active search match so the matched row is visible (not hidden
  // behind a collapsed parent).
  const combinedParentMap = useMemo(() => {
    const map = new Map<string, string>();
    const walk = (item: WorkItem, parentId?: string) => {
      if (parentId !== undefined) map.set(item.id, parentId);
      if (item.linkedItems && item.linkedItems.length > 0) {
        item.linkedItems.forEach((c) => walk(c, item.id));
      }
    };
    combinedWorkItems.forEach((root) => walk(root));
    return map;
  }, [combinedWorkItems]);

  // Type lookup for any item id in the combined tree. Needed by the
  // auto-tab-switch effect when the user cycles to a match in a different
  // type (Story → Task → Bug) via Enter / prev / next.
  const combinedTypeMap = useMemo(() => {
    const map = new Map<string, string>();
    const walk = (item: WorkItem) => {
      if (item.type) map.set(item.id, item.type);
      if (item.linkedItems && item.linkedItems.length > 0) {
        item.linkedItems.forEach(walk);
      }
    };
    combinedWorkItems.forEach(walk);
    return map;
  }, [combinedWorkItems]);

  // Searchable items published to <FindInPageInline /> via the global-search
  // context.
  //
  // Items are walked in document order then RE-SORTED by relevance to the
  // current query so that `useFindInPage`'s matchIds list lands users on
  // the shortest / most-exact match first, with longer matches following.
  //
  //   Score = kindRank * 100000 + matchedFieldLength
  //     kindRank: exact = 0, prefix = 1, substring = 2, non-match = 3
  //
  //   Typing "projhilti-6" against:
  //     PROJHILTI-6     → exact,  len 11 → score      11   ← position 1
  //     PROJHILTI-65    → prefix, len 12 → score 100012   ← position 2
  //     PROJHILTI-675   → prefix, len 13 → score 100013   ← position 3
  //     ... etc.
  //
  // When the query is empty, all scores are equal so items stay in
  // document order (and matchIds is empty anyway).
  const findInPageItems = useMemo<FindInPageItem[]>(() => {
    const q = workItemFilterQuery.trim().toLowerCase();
    type Scored = { item: FindInPageItem; score: number; ord: number };
    const all: Scored[] = [];
    const seen = new Set<string>();
    let ord = 0;

    const scoreField = (
      field: string | undefined,
    ): { rank: number; len: number } | null => {
      if (!field) return null;
      const ls = field.toLowerCase();
      if (ls === q) return { rank: 0, len: field.length };
      if (ls.startsWith(q)) return { rank: 1, len: field.length };
      if (ls.includes(q)) return { rank: 2, len: field.length };
      return null;
    };

    const walk = (wi: WorkItem) => {
      if (!wi || seen.has(wi.id)) return;
      seen.add(wi.id);
      const pieces = [wi.title, wi.externalId, wi.id].filter(
        (v): v is string => typeof v === "string" && v.length > 0,
      );
      const text = pieces.join(" ").trim();

      let score = Number.MAX_SAFE_INTEGER;
      if (q) {
        const candidates = [
          scoreField(wi.externalId),
          scoreField(wi.id),
          scoreField(wi.title),
        ].filter((c): c is { rank: number; len: number } => c !== null);
        if (candidates.length > 0) {
          const best = candidates.reduce((a, b) =>
            a.rank !== b.rank ? (a.rank < b.rank ? a : b) : a.len <= b.len ? a : b,
          );
          score = best.rank * 100000 + best.len;
        }
      }

      all.push({ item: { id: wi.id, text }, score, ord: ord++ });
      if (wi.linkedItems && wi.linkedItems.length > 0) {
        wi.linkedItems.forEach(walk);
      }
    };
    combinedWorkItems.forEach(walk);

    // Stable sort: lower score wins; ties fall back to document order.
    all.sort((a, b) => (a.score !== b.score ? a.score - b.score : a.ord - b.ord));
    return all.map((s) => s.item);
  }, [combinedWorkItems, workItemFilterQuery]);

  const {
    activeId: activeFindInPageId,
    isActiveMatch: isFindInPageActiveMatch,
  } = useFindInPage(findInPageItems);

  // Map Jira issue types → which tab values are visible. Sub-tasks are
  // intentionally excluded: they are rendered as nested children under
  // their parent, never as their own tab.
  const visibleTabs = useMemo<Set<WorkItemTab>>(() => {
    const tabs = new Set<WorkItemTab>();
    // "Linked" is always available — it shows hierarchical relationships
    // regardless of which issue types exist in the project.
    tabs.add("linked");

    // Workflow test cases are stored client-side (drafts) and exist
    // independently of the Jira/ADO issue type catalog. Show the tab
    // whenever there are any test cases to display (drafts or pushed).
    const hasTestCases = combinedWorkItems.some(
      (item) =>
        item.type === "Test Case" ||
        (Array.isArray(item.linkedItems) &&
          item.linkedItems.some((li) => li.type === "Test Case")),
    );
    if (hasTestCases) tabs.add("testcase");

    if (!isSelectedProjectJira) {
      // ADO: keep all tabs visible (existing behavior).
      tabs.add("all");
      tabs.add("feature");
      tabs.add("user-story");
      tabs.add("task");
      tabs.add("bug");
      tabs.add("issue");
      tabs.add("testcase");
      return tabs;
    }

    // Jira: if the issue types haven't loaded yet (or fetch failed), fall
    // back to showing every tab so the page isn't briefly stuck at just
    // "Linked". The next refetch will narrow it down.
    if (jiraIssueTypes.length === 0) {
      tabs.add("all");
      tabs.add("feature");
      tabs.add("user-story");
      tabs.add("task");
      tabs.add("bug");
      tabs.add("issue");
      tabs.add("testcase");
      return tabs;
    }

    // Jira: derive visible tabs from the project's actual issue types.
    let hasUnknown = false;
    for (const t of jiraIssueTypes) {
      const n = (t.name || "").toLowerCase().trim();
      if (t.subtask || n === "sub-task" || n === "subtask") continue;
      if (n === "epic") tabs.add("all");
      else if (n === "feature") tabs.add("feature");
      else if (n === "story" || n === "user story") tabs.add("user-story");
      else if (n === "task") tabs.add("task");
      else if (n === "bug" || n === "defect") tabs.add("bug");
      else if (n === "test case" || n === "test cases" || n === "test")
        tabs.add("testcase");
      else hasUnknown = true;
    }
    // Custom Jira types (e.g. "Service Request", "Submit a request",
    // "Ask a question") get bucketed under "Issue".
    if (hasUnknown) tabs.add("issue");

    return tabs;
  }, [isSelectedProjectJira, jiraIssueTypes, combinedWorkItems]);

  // If the currently-selected tab is no longer visible (e.g. user just
  // switched to a Jira project that doesn't have that issue type), fall
  // back to the first available tab so the tab strip never has an
  // "orphaned" active tab.
  useEffect(() => {
    if (visibleTabs.size === 0) return;
    if (!visibleTabs.has(selectedTab)) {
      const order: WorkItemTab[] = [
        "all",
        "feature",
        "user-story",
        "task",
        "bug",
        "issue",
        "linked",
        "testcase",
      ];
      const next = order.find((t) => visibleTabs.has(t)) || "linked";
      setSelectedTab(next);
    }
  }, [visibleTabs, selectedTab]);

  // Auto-switch to the tab that owns the *currently active* match (Enter /
  // Shift+Enter / prev / next can move the cursor into a different type, so
  // we follow it instead of locking to the first match).
  useEffect(() => {
    if (!workItemFilterQuery.trim()) return;
    if (!activeFindInPageId) return;
    const type = combinedTypeMap.get(activeFindInPageId);
    if (!type) return;
    const targetTab = WORK_ITEM_TYPE_TO_TAB[type];
    if (!targetTab) return;
    if (selectedTab !== targetTab && visibleTabs.has(targetTab)) {
      setSelectedTab(targetTab);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workItemFilterQuery, activeFindInPageId, combinedTypeMap, visibleTabs]);

  // Auto-expand ancestors of the active match so the row isn't hidden
  // behind a collapsed parent. (The actual scroll-into-view is handled by
  // useFindInPage which targets `[data-search-id="<id>"]` on the row.)
  useEffect(() => {
    if (!workItemFilterQuery.trim()) return;
    if (!activeFindInPageId) return;
    const ancestors: string[] = [];
    let cursor: string | undefined = combinedParentMap.get(activeFindInPageId);
    while (cursor) {
      ancestors.push(cursor);
      cursor = combinedParentMap.get(cursor);
    }
    if (ancestors.length === 0) return;
    setExpandedItems((prev) => {
      let changed = false;
      const next = new Set(prev);
      for (const a of ancestors) {
        if (!next.has(a)) {
          next.add(a);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [workItemFilterQuery, activeFindInPageId, combinedParentMap]);

  // Counts for All/ADO/Draft based on current tab + search
  const sourceCounts = useMemo(() => {
    let ado = 0;
    let draft = 0;
    baseFilteredWorkItems.forEach((item) => {
      if (item.source === "DB") {
        draft += 1;
      } else {
        ado += 1;
      }
    });
    return {
      all: baseFilteredWorkItems.length,
      ado,
      draft,
    };
  }, [baseFilteredWorkItems]);

  // Apply ADO/Draft source filter on top of baseFilteredWorkItems
  const filteredWorkItems = useMemo(() => {
    let items = baseFilteredWorkItems;

    if (sourceFilter === "ado") {
      items = items.filter((item) => item.source !== "DB");
    } else if (sourceFilter === "draft") {
      items = items.filter((item) => item.source === "DB");
    }

    // When createdDateFilter is active, only show recently created ADO items
    if (createdDateFilter !== "all") {
      const now = Date.now();
      const windowMs =
        createdDateFilter === "last-24h"
          ? 24 * 60 * 60 * 1000
          : 7 * 24 * 60 * 60 * 1000;
      const cutoff = now - windowMs;

      items = items.filter((item) => {
        // Only consider ADO items for "newly created" filtering
        if (item.source === "DB") return false;
        if (!item.createdDate) return false;
        const createdTime = new Date(item.createdDate).getTime();
        if (Number.isNaN(createdTime)) return false;
        return createdTime >= cutoff;
      });
    }

    return items;
  }, [baseFilteredWorkItems, sourceFilter, createdDateFilter]);

  // Draft-only checkbox selection helpers.
  // New behavior:
  // - Selecting a parent selects all its children and grandchildren (downwards).
  // - Deselecting a parent deselects all its descendants.
  // - Deselecting a child does NOT affect the parent.
  const selectDraftWithRelations = (id: string) => {
    setDraftSelectedIds((prev) => {
      const next = new Set(prev);

      const addChildren = (currentId: string) => {
        const node = draftGraph.get(currentId);
        if (!node) return;
        node.children.forEach((childId) => {
          if (!next.has(childId)) {
            next.add(childId);
            addChildren(childId);
          }
        });
      };

      next.add(id);
      addChildren(id);

      return next;
    });
  };

  const deselectDraft = (id: string) => {
    setDraftSelectedIds((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);

      const removeDescendants = (currentId: string) => {
        next.delete(currentId);
        const node = draftGraph.get(currentId);
        if (!node) return;
        node.children.forEach((childId) => {
          if (next.has(childId)) {
            removeDescendants(childId);
          }
        });
      };

      removeDescendants(id);
      return next;
    });
  };

  // Select all draft items currently visible in the filtered list (tab-wise)
  const selectAllDrafts = () => {
    const draftItems = filteredWorkItems.filter((item) => item.source === "DB");
    if (draftItems.length === 0) return;

    setDraftSelectedIds((prev) => {
      const next = new Set(prev);

      // Only select the items visible in the current tab (no cross-tab side effects)
      draftItems.forEach((item) => {
        next.add(item.id);
      });

      return next;
    });
  };

  // Deselect all draft items visible in the current tab (keep selections from other tabs)
  const deselectAllDrafts = () => {
    const draftItems = filteredWorkItems.filter((item) => item.source === "DB");
    if (draftItems.length === 0) return;

    setDraftSelectedIds((prev) => {
      if (prev.size === 0) return prev;
      const next = new Set(prev);

      draftItems.forEach((item) => {
        next.delete(item.id);
      });

      return next;
    });
  };

  const handleBulkDraftPush = async () => {
    if (draftSelectedIds.size === 0) {
      toast({
        title: "No drafts selected",
        description: "Please select at least one draft artifact to push.",
        variant: "destructive",
      });
      return;
    }

    if (!selectedProject || !latestWorkflowArtifact) {
      toast({
        title: "Missing context",
        description:
          "Cannot push drafts: project or workflow artifacts are missing.",
        variant: "destructive",
      });
      return;
    }

    setIsDraftBulkPushing(true);

    try {
      // Build selected items in hierarchical order and normalize IDs so they
      // match the workflow artifact IDs (not the synthetic db-* work item IDs).
      const byType: Record<"epic" | "feature" | "story", string[]> = {
        epic: [],
        feature: [],
        story: [],
      };

      for (const draftId of draftSelectedIds) {
        const wi = draftItemMap.get(draftId);
        if (!wi) continue;

        // Ignore standalone Task items here – subtasks are created automatically
        // when pushing their parent user story via AzureDevOpsService.
        if (wi.type === "Task") {
          continue;
        }

        // Determine canonical type for the workflow artifact
        let itemType: "epic" | "feature" | "story" | null = null;
        if (wi.dbArtifactType === "Epic" || wi.type === "Epic") {
          itemType = "epic";
        } else if (wi.dbArtifactType === "Feature" || wi.type === "Feature") {
          itemType = "feature";
        } else if (
         
          wi.type === "User Story"
        ) {
          itemType = "story";
        }

        if (!itemType) continue;

        // Normalize ID: prefer underlying workflow artifact ID, fallback to
        // stripping db-* prefix from the synthetic work item ID.
        let artifactId: string | null = null;
        const dbArtifact: any = wi.dbArtifact;
        if (dbArtifact && typeof dbArtifact.id === "string") {
          artifactId = dbArtifact.id;
        } else {
          const match = wi.id.match(/^db-(epic|feature|story|task)-(.+)$/);
          if (match) {
            artifactId = match[2];
          } else {
            artifactId = wi.id;
          }
        }

        if (!artifactId) continue;
        byType[itemType].push(artifactId);
      }

      const selectedItems = [
        ...byType.epic.map((id) => ({ type: "epic" as const, id })),
        ...byType.feature.map((id) => ({ type: "feature" as const, id })),
        ...byType.story.map((id) => ({ type: "story" as const, id })),
      ];

      if (selectedItems.length === 0) {
        toast({
          title: "Nothing to push",
          description: "Selected items are not valid draft artifacts.",
          variant: "destructive",
        });
        return;
      }

      const params = new URLSearchParams(window.location.search);
      const urlOrganization = params.get("organization");
      const urlProjectName = params.get("projectName");

      const response = await apiRequest(
        "POST",
        "/api/hub/artifacts/push-drafts-bulk",
        {
          projectName: urlProjectName || selectedProject.name,
          organization: urlOrganization || selectedProject.organization,
          artifactOrgId: selectedProject.artifactOrgId,
          organizationUrl: selectedProject.organizationUrl,
          integrationType: selectedProject.integrationType || 'ado',
          projectId: selectedProject.id,
          selectedItems,
          epics: workflowEpics,
          features: workflowFeatures,
          userStories: workflowUserStories,
          artifactId: latestWorkflowArtifact.id,
        }
      );

      const result = await response.json();

      if (result.success) {
        const isJira = selectedProject.integrationType === 'jira' || selectedProject.organization === 'Jira';
        toast({
          title: "Drafts pushed",
          description:
            result.message ||
            `Successfully pushed ${result.workItemsCreated || result.workItemIds?.length || 0} draft work item(s) to ${isJira ? 'Jira' : 'Azure DevOps'}.`,
        });

        queryClient.invalidateQueries({
          queryKey: [
            `/api/hub/artifacts/${selectedProject.name}/work-items`,
          ],
        });
        const workflowProjectId = selectedProject.id || null;
        queryClient.invalidateQueries({
          queryKey: ["/api/workflow/artifacts", workflowProjectId],
        });
        queryClient.invalidateQueries({
          queryKey: ["/api/workflow/artifacts"],
        });

        // Clear draft selection after successful push so users don't re-push accidentally.
        setDraftSelectedIds(new Set());
      } else {
        toast({
          title: "Failed to push drafts",
          description:
            result.error || "An error occurred while pushing drafts.",
          variant: "destructive",
        });
      }
    } catch (error: any) {
      toast({
        title: "Failed to push drafts",
        description: error.message || "An unexpected error occurred.",
        variant: "destructive",
      });
    } finally {
      setIsDraftBulkPushing(false);
    }
  };

  const organizations = projects
    .reduce((acc, project) => {
      const orgName = project.organization || "Default Organization";
      const orgKey = orgName.toLowerCase();

      if (!acc.find((o) => o.id === orgKey)) {
        acc.push({
          id: orgKey,
          name: orgName,
          projectCount: projects.filter(
            (p) =>
              (p.organization || "Default Organization").toLowerCase() ===
              orgKey,
          ).length,
          integrationType: project.integrationType || "ado",
        });
      }
      return acc;
    }, [] as Organization[])
    .sort((a, b) => {
      // Put Jira organizations at the end
      if (a.integrationType === 'jira' && b.integrationType !== 'jira') return 1;
      if (a.integrationType !== 'jira' && b.integrationType === 'jira') return -1;
      return a.name.localeCompare(b.name);
    });

  const filteredProjects = projects;

  const handleViewWorkItemDetails = (item: WorkItem) => {
    if (item.source === "DB") {
      setDbDetailsLoading(true);
      setDbDetailsNavStack([]);
      setSelectedDbWorkItem(item);
      setDbDetailsDialogOpen(true);
      setTimeout(() => {
        setDbDetailsLoading(false);
      }, 500);
      return;
    }
    if (!selectedProject) return;
    // Start a fresh navigation stack when viewing ADO details from the list
    setDetailsNavStack([]);
    fetchWorkItemDetailsMutation.mutate({
      projectName: selectedProject.name,
      workItemId: item.id,
      artifactOrgId: selectedProject.artifactOrgId,
      organizationUrl: selectedProject.organizationUrl,
      organization: selectedProject.organization,
      projectId: selectedProject.id,
      integrationType: selectedProject.integrationType,
    });
  };

  const handleDetailsBack = () => {
    setDetailsNavStack((prevStack) => {
      if (prevStack.length === 0) return prevStack;
      const newStack = [...prevStack];
      const last = newStack.pop()!;
      setSelectedWorkItemDetails(last);
      return newStack;
    });
  };

  const handleEditWorkItem = (item: WorkItem) => {
    // Draft (DB) items: open workflow artifact editor (unchanged)
    if (item.source === "DB") {
      if (!item.dbArtifact) {
        if (item.type === "Task") {
          const parent = findParentInCombined(item.id);
          if (parent?.dbArtifact && parent.dbArtifactType === "User Story") {
            const story = parent.dbArtifact as UserStory;
            let idx: number | null = null;
            const match = item.id.match(/^db-task-(.+)-(\d+)$/);
            if (match) {
              idx = Number.parseInt(match[2], 10);
            }
            if (
              (idx === null || Number.isNaN(idx)) &&
              Array.isArray((story as any).subtasks)
            ) {
              const fallbackIdx = (story as any).subtasks.findIndex((st: any) => {
                const stTitle = typeof st === "string" ? st : (st?.title || st?.description);
                return stTitle === item.title;
              });
              if (fallbackIdx >= 0) {
                idx = fallbackIdx;
              }
            }
            if (
              idx === null ||
              Number.isNaN(idx) ||
              !Array.isArray((story as any).subtasks) ||
              !(story as any).subtasks[idx]
            ) {
              toast({
                title: "Cannot edit draft task",
                description:
                  "Unable to locate this task within its parent User Story subtasks.",
                variant: "destructive",
              });
              return;
            }
            setDraftTaskStory(story);
            setDraftTaskIndex(idx);
            const subtask = (story as any).subtasks[idx];
            const subtaskTitle = typeof subtask === "string"
              ? subtask
              : (subtask?.title || subtask?.description || `Task ${idx + 1}`);
            setDraftTaskEditTitle(subtaskTitle);
            setDraftTaskEditOpen(true);
          } else {
            toast({
              title: "Cannot edit draft task",
              description: "This draft task is not linked to a User Story.",
              variant: "destructive",
            });
          }
        }
        return;
      }
      const type =
        item.dbArtifactType === "Epic"
          ? "epic"
          : item.dbArtifactType === "Feature"
            ? "feature"
            : "story";
      setDraftEditArtifact(item.dbArtifact as Epic | Feature | UserStory);
      setDraftEditType(type);
      setDraftEditOpen(true);
      return;
    }

    // For ADO/Jira items, use SDLC-style dialog invocation (let dialog fetch details)
    if (!selectedProject) return;
    setEditingWorkItemId(item.id);
    setEditDialogOpen(true);
  };

  const toggleExpand = (itemId: string) => {
    setExpandedItems((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(itemId)) {
        newSet.delete(itemId);
      } else {
        newSet.add(itemId);
      }
      return newSet;
    });
  };

  const renderWorkItemTree = (
    item: WorkItem,
    level = 0,
    parentId?: string,
    parentType?: string,
  ) => {
    const isSelected = linkDialogOpen && selectedWorkItem?.id === item.id;
    const hasLinkedItems = item.linkedItems && item.linkedItems.length > 0;
    const isExpanded = expandedItems.has(item.id);
    const isLinkedChild = level > 0 && parentId !== undefined;
    const isDetailsLoading = detailsLoadingId === item.id;
    const isDbDetailsLoading =
      dbDetailsLoading && selectedDbWorkItem?.id === item.id;
    const isSubtask = item.type === "Task" && parentType === "User Story";
    const typeInitial = getWorkItemTypeInitial(item.type, isSubtask);
    const isDraftItem = item.source === "DB";
    const isChecked = draftSelectedIds.has(item.id);
    const isActiveMatch = isFindInPageActiveMatch(item.id);
    return (
      <div key={item.id} className="space-y-2">
        <div
          data-search-id={item.id}
          className={cn(
            "flex items-center gap-2 p-3 rounded-md border hover-elevate overflow-hidden transition-all cursor-pointer",
            isSelected &&
            "bg-primary/20 border-primary border-2 ring-4 ring-primary/50 shadow-lg shadow-primary/20",
            isActiveMatch &&
            !isSelected &&
            "ring-2 ring-amber-400/70 border-amber-400/60"
          )}
          style={level > 0 ? { marginLeft: `${level * 2}rem` } : undefined}
          data-testid={`work-item-${item.id}`}
          onClick={(e) => {
            // Only trigger if clicking on the card content, not on buttons or icons
            const target = e.target as HTMLElement;
            const isButton =
              target.closest("button") || target.closest('[role="button"]');
            if (!isButton) {
              if (item.source === "DB") {
                // For draft (DB) items, compute parent/children relationships from the
                // full combined tree so we can surface them in the details dialog
                // similar to how we do for ADO items.
                const parent = findParentInCombined(item.id);
                const fullItem = findItemInCombined(item.id) || item;

                setSelectedDbWorkItem(fullItem);
                setSelectedDbParent(parent);
                setSelectedDbChildren(fullItem.linkedItems || []);
                setDbDetailsDialogOpen(true);
              } else if (selectedProject) {
                // Ensure all required params are passed and handle missing/invalid IDs
                if (!item.id || !selectedProject.name) {
                  setSelectedWorkItemDetails({
                    id: "not-found",
                    title: "Error: Task Not Found",
                    description: "Task ID or Project Name missing.",
                    type: "Task",
                    state: "Error",
                    assignedTo: "",
                    createdBy: "",
                    createdDate: new Date().toISOString(),
                    changedDate: new Date().toISOString(),
                    priority: null,
                    storyPoints: null,
                    acceptanceCriteria: "",
                    tags: "",
                    url: "",
                    severity: null,
                    businessValue: null,
                    timeCriticality: null,
                    effort: null,
                    remainingWork: null,
                    originalEstimate: null,
                    completedWork: null,
                    reproSteps: "",
                    testCaseSteps: undefined,
                    iterationPath: "",
                    areaPath: "",
                    relations: [],
                    parent: null,
                    children: [],
                  });
                  setDetailsDialogOpen(true);
                  return;
                }
                fetchWorkItemDetailsMutation.mutate({
                  projectName: selectedProject.name,
                  workItemId: item.id,
                  artifactOrgId: selectedProject.artifactOrgId,
                  organizationUrl: selectedProject.organizationUrl,
                  organization: selectedProject.organization,
                  projectId: selectedProject.id,
                  integrationType: selectedProject.integrationType,
                });
              }
            }
          }}
        >
          {hasLinkedItems ? (
            <>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 flex-shrink-0 p-0 hover:bg-accent"
                onClick={(e) => {
                  e.stopPropagation();
                  toggleExpand(item.id);
                }}
                title={isExpanded ? "Collapse" : "Expand"}
              >
                {isExpanded ? (
                  <ChevronDown className="h-5 w-5 text-foreground" />
                ) : (
                  <ChevronRight className="h-5 w-5 text-foreground" />
                )}
              </Button>
              <div className={`flex h-7 w-7 items-center justify-center rounded-full text-[10px] font-semibold mr-3 ${getWorkItemIconColors(item.type)}`}>
                {typeInitial}
              </div>
            </>
          ) : (
            // When there is no expand/collapse button, fill the leading blank with the type icon
            <div className={`flex h-7 w-7 items-center justify-center rounded-full text-[10px] font-semibold mr-3 ${getWorkItemIconColors(item.type)}`}>
              {typeInitial}
            </div>
          )}
          {isDraftItem && (
            <Checkbox
              checked={isChecked}
              onCheckedChange={(checked) => {
                if (checked) {
                  selectDraftWithRelations(item.id);
                } else {
                  deselectDraft(item.id);
                }
              }}
              onClick={(e) => e.stopPropagation()}
              className="mr-2"
            />
          )}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <Badge variant="outline" className="text-xs">
                {item.type}
              </Badge>
              <Badge
                variant={item.priority === "High" ? "destructive" : "secondary"}
                className="text-xs"
              >
                {item.priority}
              </Badge>
              {item.source === "DB" ? (
                <Badge
                  variant="outline"
                  className="text-xs border-amber-500/50 text-amber-500 bg-amber-500/10"
                >
                  Draft
                </Badge>
              ) : item.source === "Jira" ? (
                <Badge
                  variant="outline"
                  className="text-xs border-cyan-500/50 text-cyan-500 bg-cyan-500/10"
                >
                  Jira
                </Badge>
              ) : (
                <Badge
                  variant="outline"
                  className="text-xs border-blue-500/50 text-blue-500 bg-blue-500/10"
                >
                  ADO
                </Badge>
              )}
              {isSelectedProjectJira && item.externalId && (
                <Badge
                  variant="outline"
                  className="font-mono text-xs border-blue-500/50 text-blue-500 bg-blue-500/10"
                  title="Jira ID"
                  data-testid={`badge-jira-id-${item.externalId}`}
                >
                  <HighlightedText
                    text={item.externalId}
                    query={workItemFilterQuery}
                    isActive={isActiveMatch}
                  />
                </Badge>
              )}
              {(item.type === "Epic" || item.type === "User Story") &&
                (designPromptItemIds.has(String(item.id)) ||
                  (item.externalId &&
                    designPromptItemIds.has(String(item.externalId)))) && (
                  <Badge
                    variant="outline"
                    className="text-xs border-violet-500/50 text-violet-500 bg-violet-500/10 gap-1"
                    title="Design prompt generated and stored"
                    data-testid={`badge-design-prompt-${item.id}`}
                  >
                    <Palette className="h-3 w-3" />
                    Design
                  </Badge>
                )}
            </div>
            <p className="text-sm font-medium line-clamp-3">
              <HighlightedText
                text={item.title}
                query={workItemFilterQuery}
                isActive={isActiveMatch}
              />
            </p>
          </div>
          <div className="flex items-center justify-center w-16">
            {isDetailsLoading || isDbDetailsLoading ? (
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            ) : (
              <Badge variant="secondary" className="text-xs">
                {item.status}
              </Badge>
            )}
          </div>
          <Button
            variant="ghost"
            size="icon"
            disabled={editingWorkItemId === item.id}
            onClick={(e) => {
              e.stopPropagation();
              handleEditWorkItem(item);
            }}
            data-testid={`button-edit-${item.id}`}
            title="Edit work item"
          >
            <Edit className="h-4 w-4" />
          </Button>
          {item.source === "DB" ? (
            <Button
              variant="ghost"
              size="icon"
              disabled={
                pushingToADO === item.id ||
                (item.type !== "Task" && !item.dbArtifact)
              }
              onClick={(e) => {
                e.stopPropagation();
                handlePushToADO(item);
              }}
              data-testid={`button-push-ado-${item.id}`}
              title={`Push to ${selectedProject?.integrationType === 'jira' || selectedProject?.organization === 'Jira' ? 'Jira' : 'Azure DevOps'}`}
            >
              {pushingToADO === item.id ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Upload className="h-4 w-4" />
              )}
            </Button>
          ) : (
            <Button
              variant="ghost"
              size="icon"
              onClick={(e) => {
                e.stopPropagation();
                setSelectedWorkItem(item);
                setLinkDialogOpen(true);
              }}
              data-testid={`button-link-${item.id}`}
              title="Link work item"
            >
              <LinkIcon className="h-4 w-4" />
            </Button>
          )}
          {isLinkedChild && parentId && item.source !== "DB" && (
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 flex-shrink-0 p-0 hover:bg-destructive/10 hover:text-destructive"
              onClick={(e) => {
                e.stopPropagation();
                handleUnlinkWorkItem(parentId, item.id);
              }}
              title={`Unlink ${item.type} ${item.id}`}
              disabled={
                unlinkMutation.isPending &&
                unlinkingKey === `${parentId}-${item.id}`
              }
            >
              {unlinkMutation.isPending &&
                unlinkingKey === `${parentId}-${item.id}` ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Unlink className="h-4 w-4" />
              )}
            </Button>
          )}
        </div>
        {hasLinkedItems && isExpanded && (
          <div className="space-y-2">
            {item.linkedItems!.map((linkedItem) =>
              renderWorkItemTree(linkedItem, level + 1, item.id, item.type)
            )}
          </div>
        )}
      </div>
    );
  };

  const renderLinkedWorkItemFlat = (item: WorkItem) => {
    const isSelected = linkDialogOpen && selectedWorkItem?.id === item.id;
    const isDetailsLoading = detailsLoadingId === item.id;
    const isDbDetailsLoading =
      dbDetailsLoading && selectedDbWorkItem?.id === item.id;
    const isSubtask = selectedTab === "linked" && item.type === "Task";
    const typeInitial = getWorkItemTypeInitial(item.type, isSubtask);
    const isDraftItem = item.source === "DB";
    const isChecked = draftSelectedIds.has(item.id);
    const isActiveMatch = isFindInPageActiveMatch(item.id);
    return (
      <div
        key={item.id}
        data-search-id={item.id}
        className={cn(
          "flex items-center gap-3 p-4 border-b hover-elevate overflow-hidden transition-all cursor-pointer",
          isSelected &&
          "bg-primary/20 border-primary border-b-primary border-2 ring-4 ring-primary/50 shadow-lg shadow-primary/20",
          isActiveMatch &&
          !isSelected &&
          "ring-2 ring-amber-400/70 border-amber-400/60"
        )}
        data-testid={`linked-work-item-${item.id}`}
        onClick={(e) => {
          // Only trigger if clicking on the card itself, not on buttons
          if (
            e.target === e.currentTarget ||
            (e.target as HTMLElement).closest(".flex-1")
          ) {
            if (item.source === "DB") {
              setSelectedDbWorkItem(item);
              setDbDetailsDialogOpen(true);
            } else if (selectedProject) {
              fetchWorkItemDetailsMutation.mutate({
                projectName: selectedProject.name,
                workItemId: item.id,
                artifactOrgId: selectedProject.artifactOrgId,
                organizationUrl: selectedProject.organizationUrl,
                organization: selectedProject.organization,
                projectId: selectedProject.id,
                integrationType: selectedProject.integrationType,
              });
            }
          }
        }}
      >
        <div className="flex-1 min-w-0 space-y-1 flex items-start gap-4">
          <div className="flex items-center gap-2 flex-shrink-0 mt-0.5">
            <div className={`flex h-7 w-7 items-center justify-center rounded-full text-[10px] font-semibold ${getWorkItemIconColors(item.type)}`}>
              {typeInitial}
            </div>
            {isDraftItem && (
              <Checkbox
                checked={isChecked}
                onCheckedChange={(checked) => {
                  if (checked) {
                    selectDraftWithRelations(item.id);
                  } else {
                    deselectDraft(item.id);
                  }
                }}
                onClick={(e) => e.stopPropagation()}
              />
            )}
          </div>
          <div className="min-w-0 space-y-1">
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="text-xs">
                {item.type}
              </Badge>
              <Badge variant="secondary" className="text-xs">
                {item.priority}
              </Badge>
              {item.source === "DB" ? (
                <Badge
                  variant="outline"
                  className="text-xs border-amber-500/50 text-amber-500 bg-amber-500/10"
                >
                  Draft
                </Badge>
              ) : item.source === "Jira" ? (
                <Badge
                  variant="outline"
                  className="text-xs border-cyan-500/50 text-cyan-500 bg-cyan-500/10"
                >
                  Jira
                </Badge>
              ) : (
                <Badge
                  variant="outline"
                  className="text-xs border-blue-500/50 text-blue-500 bg-blue-500/10"
                >
                  ADO
                </Badge>
              )}
              {isSelectedProjectJira && item.externalId && (
                <Badge
                  variant="outline"
                  className="font-mono text-xs border-blue-500/50 text-blue-500 bg-blue-500/10"
                  title="Jira ID"
                  data-testid={`badge-jira-id-flat-${item.externalId}`}
                >
                  <HighlightedText
                    text={item.externalId}
                    query={workItemFilterQuery}
                    isActive={isActiveMatch}
                  />
                </Badge>
              )}
              {(item.type === "Epic" || item.type === "User Story") &&
                (designPromptItemIds.has(String(item.id)) ||
                  (item.externalId &&
                    designPromptItemIds.has(String(item.externalId)))) && (
                  <Badge
                    variant="outline"
                    className="text-xs border-violet-500/50 text-violet-500 bg-violet-500/10 gap-1"
                    title="Design prompt generated and stored"
                    data-testid={`badge-design-prompt-flat-${item.id}`}
                  >
                    <Palette className="h-3 w-3" />
                    Design
                  </Badge>
                )}
            </div>
            <p className="text-sm font-medium">
              <HighlightedText
                text={item.title}
                query={workItemFilterQuery}
                isActive={isActiveMatch}
              />
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {isDetailsLoading || isDbDetailsLoading ? (
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          ) : (
            <Badge variant="secondary" className="text-xs">
              {item.status}
            </Badge>
          )}
          <Button
            variant="ghost"
            size="icon"
            disabled={editingWorkItemId === item.id}
            onClick={(e) => {
              e.stopPropagation();
              handleEditWorkItem(item);
            }}
            data-testid={`button-edit-flat-${item.id}`}
            title="Edit work item"
          >
            <Edit className="h-4 w-4" />
          </Button>
          {item.source === "DB" ? (
            <Button
              variant="ghost"
              size="icon"
              disabled={
                pushingToADO === item.id ||
                (item.type !== "Task" && !item.dbArtifact)
              }
              onClick={(e) => {
                e.stopPropagation();
                handlePushToADO(item);
              }}
              data-testid={`button-push-ado-flat-${item.id}`}
              title={`Push to ${selectedProject?.integrationType === 'jira' || selectedProject?.organization === 'Jira' ? 'Jira' : 'Azure DevOps'}`}
            >
              {pushingToADO === item.id ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Upload className="h-4 w-4" />
              )}
            </Button>
          ) : (
            <Button
              variant="ghost"
              size="icon"
              onClick={(e) => {
                e.stopPropagation();
                setSelectedWorkItem(item);
                setLinkDialogOpen(true);
              }}
              data-testid={`button-link-flat-${item.id}`}
              title="Link work item"
            >
              <LinkIcon className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="flex-1 space-y-6 p-6">
      <PageHeader
        icon={Package}
        title="Artifacts"
        subtitle="View work items from your integrated projects"
        color="blue"
        data-testid="text-page-title"
      />

      {isLoadingProjects ? (
        <CardGridSkeleton columns={3} cardCount={6} />
      ) : projectsError ? (
        <Card className="border-l-[3px] border-l-blue-500">
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Package className="h-12 w-12 text-muted-foreground mb-3" />
            <p className="text-muted-foreground">
              {`Failed to load projects. Please check your ${isJiraHosting ? "Jira" : "Azure DevOps"} settings.`}
            </p>
          </CardContent>
        </Card>
      ) : selectedProject ? (
        <div className="space-y-6">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setSelectedProject(null);
                // Preserve the organization filter when navigating back
                // Update URL to include organization param but remove project params
                const params = new URLSearchParams();
                if (selectedOrg && !isGlobalAllOrganizations) {
                  params.set("organization", selectedOrg);
                }
                setLocation(`/hub/artifacts?${params.toString()}`);
              }}
              data-testid="button-back-to-projects"
            >
              ← Back to Projects
            </Button>
          </div>

          <Card className="border-l-[3px] border-l-blue-500">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>{selectedProject.name}</CardTitle>
                  <CardDescription>
                    {selectedProject.description}
                  </CardDescription>
                </div>
                <div className="flex items-center gap-3">
                  <Badge variant="secondary" className="text-sm">
                    {filteredWorkItems.length} Work Items
                  </Badge>
                  {sourceFilter === "draft" && (
                    <>
                      <Button
                        onClick={selectAllDrafts}
                        size="sm"
                        variant="outline"
                        disabled={isDraftBulkPushing}
                        data-testid="button-select-all-drafts"
                      >
                        <Check className="h-4 w-4 mr-2" />
                        Select All
                      </Button>
                      <Button
                        onClick={deselectAllDrafts}
                        size="sm"
                        variant="outline"
                        disabled={isDraftBulkPushing || draftSelectedIds.size === 0}
                        data-testid="button-deselect-all-drafts"
                      >
                        <Circle className="h-4 w-4 mr-2" />
                        Deselect All
                      </Button>
                      <Button
                        onClick={handleBulkDraftPush}
                        size="sm"
                        variant="outline"
                        disabled={
                          isDraftBulkPushing || draftSelectedIds.size === 0
                        }
                        data-testid="button-push-draft-bulk"
                      >
                        {isDraftBulkPushing ? (
                          <>
                            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                            Pushing drafts...
                          </>
                        ) : (
                          <>
                            <Upload className="h-4 w-4 mr-2" />
                            Push Selected Drafts ({draftSelectedIds.size})
                          </>
                        )}
                      </Button>
                    </>
                  )}
                  <Button
                    onClick={() => setCreateDialogOpen(true)}
                    size="sm"
                    data-testid="button-create-work-item"
                  >
                    <Plus className="h-4 w-4 mr-2" />
                    Create Work Item
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <Tabs
                value={selectedTab}
                onValueChange={(value) => setSelectedTab(value as WorkItemTab)}
                className="w-full"
              >
                <div className="px-6 pt-6 border-b flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                  <TabsList className="flex gap-1 overflow-x-auto scrollbar-none">
                    {visibleTabs.has("all") && (
                      <TabsTrigger value="all" data-testid="tab-all">
                        Epic
                        {searchMatchInfo.counts.all
                          ? ` (${searchMatchInfo.counts.all})`
                          : ""}
                      </TabsTrigger>
                    )}
                    {visibleTabs.has("feature") && (
                      <TabsTrigger value="feature" data-testid="tab-feature">
                        Feature
                        {searchMatchInfo.counts.feature
                          ? ` (${searchMatchInfo.counts.feature})`
                          : ""}
                      </TabsTrigger>
                    )}
                    {visibleTabs.has("user-story") && (
                      <TabsTrigger
                        value="user-story"
                        data-testid="tab-user-story"
                      >
                        Story
                        {searchMatchInfo.counts["user-story"]
                          ? ` (${searchMatchInfo.counts["user-story"]})`
                          : ""}
                      </TabsTrigger>
                    )}
                    {visibleTabs.has("task") && (
                      <TabsTrigger value="task" data-testid="tab-task">
                        Task
                        {searchMatchInfo.counts.task
                          ? ` (${searchMatchInfo.counts.task})`
                          : ""}
                      </TabsTrigger>
                    )}
                    {visibleTabs.has("bug") && (
                      <TabsTrigger value="bug" data-testid="tab-bug">
                        Bug
                        {searchMatchInfo.counts.bug
                          ? ` (${searchMatchInfo.counts.bug})`
                          : ""}
                      </TabsTrigger>
                    )}
                    {visibleTabs.has("issue") && (
                      <TabsTrigger value="issue" data-testid="tab-issue">
                        Issue
                        {searchMatchInfo.counts.issue
                          ? ` (${searchMatchInfo.counts.issue})`
                          : ""}
                      </TabsTrigger>
                    )}
                    {visibleTabs.has("linked") && (
                      <TabsTrigger value="linked" data-testid="tab-linked">
                        Subtasks
                      </TabsTrigger>
                    )}
                    {visibleTabs.has("testcase") && (
                      <TabsTrigger value="testcase" data-testid="tab-testcase">
                        Test Case
                        {searchMatchInfo.counts.testcase
                          ? ` (${searchMatchInfo.counts.testcase})`
                          : ""}
                      </TabsTrigger>
                    )}
                  </TabsList>

                  <div className="flex flex-col gap-3 md:flex-row md:items-center md:gap-3 w-full md:w-auto">
                    <div className="inline-flex items-center gap-2">
                      <Button
                        variant={sourceFilter === "all" ? "default" : "outline"}
                        size="sm"
                        onClick={() => setSourceFilter("all")}
                      >
                        All ({sourceCounts.all})
                      </Button>
                      <Button
                        variant={sourceFilter === "ado" ? "default" : "outline"}
                        size="sm"
                        onClick={() => setSourceFilter("ado")}
                      >
                        {platformLabel} ({sourceCounts.ado})
                      </Button>
                      <Button
                        variant={
                          sourceFilter === "draft" ? "default" : "outline"
                        }
                        size="sm"
                        onClick={() => setSourceFilter("draft")}
                      >
                        Draft ({sourceCounts.draft})
                      </Button>
                    </div>

                    <div className="flex flex-col gap-2 md:flex-row md:items-center md:gap-3 w-full md:w-auto">
                      <FindInPageInline
                        placeholder={
                          isSelectedProjectJira
                            ? "Search by title or Jira ID..."
                            : "Search by ID or title..."
                        }
                        className="w-full md:w-auto"
                        inputClassName="w-full md:w-80"
                      />
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant={
                              createdDateFilter === "all"
                                ? "outline"
                                : "default"
                            }
                            size="icon"
                            data-testid="button-created-filter"
                            aria-label={`Filter by created date (${platformLabel})`}
                          >
                            <Filter className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-44">
                          <DropdownMenuItem
                            onClick={() => setCreatedDateFilter("all")}
                            data-testid="created-filter-all"
                          >
                            All dates
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => setCreatedDateFilter("last-24h")}
                            data-testid="created-filter-last-24h"
                          >
                            Last 24 hours ({platformLabel})
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => setCreatedDateFilter("last-7d")}
                            data-testid="created-filter-last-7d"
                          >
                            Last 7 days ({platformLabel})
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>
                </div>

                <TabsContent value={selectedTab} className="m-0">
                  {isLoadingWorkItems ? (
                    <div className="flex items-center justify-center py-12">
                      <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                    </div>
                  ) : filteredWorkItems.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-12 text-center">
                      <Package className="h-12 w-12 text-muted-foreground mb-3" />
                      <p className="text-muted-foreground">
                        No work items found
                      </p>
                    </div>
                  ) : selectedTab === "linked" ? (
                    <div className="border-t">
                      {/* Show all linked items directly (already filtered and flattened in baseFilteredWorkItems) */}
                      {filteredWorkItems.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-12 text-center">
                          <LinkIcon className="h-12 w-12 text-muted-foreground mb-3" />
                          <p className="text-muted-foreground">
                            No subtasks found
                          </p>
                        </div>
                      ) : (
                        filteredWorkItems.map((item) =>
                          renderLinkedWorkItemFlat(item)
                        )
                      )}
                    </div>
                  ) : (
                    <ScrollArea className="h-[500px] p-6">
                      <div className="space-y-3">
                        {filteredWorkItems.map((item) =>
                          renderWorkItemTree(item)
                        )}
                      </div>
                    </ScrollArea>
                  )}
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Search */}
          <div className="flex gap-4 items-start sm:items-center">
            <div className="relative w-full sm:max-w-md">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search with project name or organization"
                className="pl-9"
                value={projectSearchQuery}
                onChange={(e) => setProjectSearchQuery(e.target.value)}
                data-testid="input-search-projects"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredProjects.length === 0 ? (
              <Card className="col-span-full border-l-[3px] border-l-blue-500">
                <CardContent className="flex flex-col items-center justify-center py-12">
                  <Package className="h-12 w-12 text-muted-foreground mb-3" />
                  <p className="text-muted-foreground">No projects found</p>
                </CardContent>
              </Card>
            ) : (
              filteredProjects.map((project) => (
                <Card
                  key={project.id}
                  className={cn(
                    "hover-elevate active-elevate-2 cursor-pointer border-l-[3px]",
                    project.integrationType === 'jira' ? "border-l-blue-600" : "border-l-blue-500"
                  )}
                  onClick={() => {
                    setSelectedProject(project);

                    const params = new URLSearchParams(window.location.search);
                    if (!isGlobalAllOrganizations) {
                      params.set("organization", project.organization || "");
                    } else {
                      params.delete("organization");
                    }
                    params.set("projectId", project.id);
                    params.set("projectName", project.name);
                    setLocation(`/hub/artifacts?${params.toString()}`);
                  }}
                  data-testid={`card-project-${project.id}`}
                >
                  <CardHeader>
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <CardTitle className="text-lg truncate">
                          {project.name}
                        </CardTitle>
                        <CardDescription className="line-clamp-2 mt-1">
                          {project.description || "No description"}
                        </CardDescription>
                      </div>
                      <ChevronRight className="h-5 w-5 flex-shrink-0 text-muted-foreground" />
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="flex items-center gap-2 text-sm text-muted-foreground min-w-0">
                      {project.integrationType === 'jira' ? (
                        <Database className="h-4 w-4 text-orange-500 flex-shrink-0" />
                      ) : (
                        <GitBranch className="h-4 w-4 flex-shrink-0" />
                      )}
                      <div className="flex items-center gap-2 min-w-0 flex-1">
                        <span className="truncate">{project.organization || "Default"}</span>
                        {project.integrationType === "jira" ? (
                          <Badge
                            variant="outline"
                            className="text-[10px] py-0 h-4 bg-orange-500/10 text-orange-600 border-orange-500/20 flex-shrink-0"
                          >
                            Jira
                          </Badge>
                        ) : (
                          <Badge
                            variant="outline"
                            className="text-[10px] py-0 h-4 bg-blue-500/10 text-blue-500 border-blue-500/30 flex-shrink-0"
                          >
                            ADO
                          </Badge>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
          </div>
          
          {/* Pagination Controls */}
          {totalPages > 0 && (
            <div className="flex items-center justify-between py-4">
              <p className="text-sm text-muted-foreground">
                Showing {Math.min((projectPage - 1) * projectPageSize + 1, totalProjectsCount)} to {Math.min(projectPage * projectPageSize, totalProjectsCount)} of {totalProjectsCount} projects
              </p>
              <Pagination className="w-auto mx-0">
                <PaginationContent>
                  <PaginationItem>
                    <PaginationPrevious 
                      onClick={() => setProjectPage(p => Math.max(1, p - 1))}
                      className={projectPage === 1 ? "pointer-events-none opacity-50" : "cursor-pointer"}
                    />
                  </PaginationItem>
                  <PaginationItem>
                    <span className="flex h-9 items-center justify-center px-4 text-sm font-medium">
                      Page {projectPage} of {totalPages}
                    </span>
                  </PaginationItem>
                  <PaginationItem>
                    <PaginationNext 
                      onClick={() => setProjectPage(p => Math.min(totalPages, p + 1))}
                      className={projectPage === totalPages ? "pointer-events-none opacity-50" : "cursor-pointer"}
                    />
                  </PaginationItem>
                </PaginationContent>
              </Pagination>
            </div>
          )}
        </div>
      )}

      <GenericModal
        open={linkDialogOpen}
        onOpenChange={(open) => {
          // Only allow closing if it's intentional (via button click)
          if (!open && !linkDialogCloseIntentRef.current) {
            // Prevent closing on outside click - just return without changing state
            return;
          }
          // Reset the intent flag
          linkDialogCloseIntentRef.current = false;
          setLinkDialogOpen(open);
          // Reset popover and search state when dialog closes
          if (!open) {
            setLinkComboboxOpen(false);
            setWorkItemSearchTerm("");
            setTargetWorkItemId("");
          }
        }}
        title="Link Work Item"
        description="Link a work item to another work item"
        icon={LinkIcon}
        //width="672px"
        maxHeight="85vh"
        closeOnOverlayClick={false}
        closeOnEscape={false}
        contentClassName="space-y-4"
        footerButtons={[
          {
            label: "Cancel",
            onClick: () => {
              linkDialogCloseIntentRef.current = true;
              setLinkDialogOpen(false);
            },
            variant: "outline",
            disabled: linkMutation.isPending,
            "data-testid": "button-cancel-link",
          },
          {
            label: linkMutation.isPending ? "Linking..." : "Link Work Item",
            onClick: handleLinkWorkItem,
            variant: "default",
            disabled: linkMutation.isPending || !targetWorkItemId,
            loading: linkMutation.isPending,
            "data-testid": "button-confirm-link",
          },
        ]}
        data-testid="dialog-link-work-item"
      >
        <div className="space-y-4">
          <div className="bg-primary/10 border border-primary/30 rounded-lg p-3">
            <span className="text-muted-foreground">Link </span>
            {selectedWorkItem && (
              <span className="font-semibold text-primary">
                #{selectedWorkItem.id} -{" "}
              </span>
            )}
            <span className="font-bold text-primary text-lg">
              {selectedWorkItem?.title || "this work item"}
            </span>
            <span className="text-muted-foreground"> to another work item</span>
          </div>
          <div className="space-y-2">
            <Label htmlFor="target-work-item-id">Target Work Item</Label>
            <Popover
              open={linkComboboxOpen && linkDialogOpen}
              onOpenChange={(open) => {
                // Only allow opening if dialog is open
                if (linkDialogOpen) {
                  setLinkComboboxOpen(open);
                  // Reset search when closing popover
                  if (!open) {
                    setWorkItemSearchTerm("");
                  }
                }
              }}
            >
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  role="combobox"
                  aria-expanded={linkComboboxOpen}
                  className="w-full justify-between min-w-0"
                  data-testid="button-target-work-item-combobox"
                  onClick={() => {
                    if (!linkComboboxOpen) {
                      setLinkComboboxOpen(true);
                      // Reset search term when opening to show all items
                      if (!workItemSearchTerm) {
                        setWorkItemSearchTerm("");
                      }
                    }
                  }}
                >
                  <span className="truncate text-left flex-1 min-w-0 mr-2">
                    {targetWorkItemId
                      ? (() => {
                        const selectedItem = autocompleteWorkItems.find(
                          (item) => item.id === targetWorkItemId
                        );
                        return selectedItem
                          ? `#${targetWorkItemId} - ${selectedItem.title}`
                          : `#${targetWorkItemId}`;
                      })()
                      : "Select or type work item ID..."}
                  </span>
                  <ChevronsUpDown className="h-4 w-4 opacity-50 flex-shrink-0" />
                </Button>
              </PopoverTrigger>
              <PopoverContent
                className="w-[var(--radix-popover-trigger-width)] p-0 max-h-[400px] flex flex-col"
                align="start"
              >
                <Command
                  shouldFilter={false}
                  className="flex flex-col h-full overflow-hidden"
                >
                  <CommandInput
                    placeholder="Search by ID or title..."
                    value={workItemSearchTerm}
                    onValueChange={(value: string) => {
                      setWorkItemSearchTerm(value);
                      // If value is a pure number, set it as the ID immediately
                      if (/^\d+$/.test(value)) {
                        setTargetWorkItemId(value);
                      } else if (value === "") {
                        // Clear ID if search is cleared
                        setTargetWorkItemId("");
                      }
                    }}
                  />
                  <CommandList
                    ref={commandListRef}
                    className="flex-1 overflow-y-auto overflow-x-hidden min-h-0 max-h-[300px] h-full"
                    style={{ overscrollBehavior: "contain" }}
                  >
                    <CommandEmpty>
                      {isLoadingAutocomplete ? (
                        <div className="flex items-center justify-center py-6">
                          <Loader2 className="h-4 w-4 animate-spin mr-2" />
                          Loading...
                        </div>
                      ) : (
                        "No work items found. Try a different search term."
                      )}
                    </CommandEmpty>
                    <CommandGroup>
                      {autocompleteWorkItems.length > 0
                        ? autocompleteWorkItems.map((item) => (
                          <CommandItem
                            key={item.id}
                            value={`${item.id} ${item.title}`}
                            onSelect={() => {
                              setTargetWorkItemId(item.id);
                              setLinkComboboxOpen(false);
                              setWorkItemSearchTerm("");
                            }}
                            className={cn(
                              "cursor-pointer",
                              targetWorkItemId === item.id && "bg-accent"
                            )}
                          >
                            <Check
                              className={cn(
                                "mr-2 h-4 w-4 shrink-0",
                                targetWorkItemId === item.id
                                  ? "opacity-100"
                                  : "opacity-0"
                              )}
                            />
                            <div className="flex flex-col flex-1 min-w-0">
                              <span className="font-medium truncate">
                                #{item.id} - {item.title}
                              </span>
                              <span className="text-xs text-muted-foreground">
                                {item.type} • {item.state}
                              </span>
                            </div>
                          </CommandItem>
                        ))
                        : !isLoadingAutocomplete &&
                        workItemSearchTerm && (
                          <div className="py-6 text-center text-sm text-muted-foreground">
                            No work items found. Try a different search term.
                          </div>
                        )}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
            <p className="text-xs text-muted-foreground">
              Type to search by ID or title, or select from the list
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="link-type">Link Type</Label>
            <Select value={linkType} onValueChange={setLinkType}>
              <SelectTrigger id="link-type" data-testid="select-link-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="System.LinkTypes.Hierarchy-Reverse">
                  Child
                </SelectItem>
                <SelectItem value="System.LinkTypes.Hierarchy-Forward">
                  Parent
                </SelectItem>
                <SelectItem value="System.LinkTypes.Related">
                  Related
                </SelectItem>
                <SelectItem value="System.LinkTypes.Dependency-Forward">
                  Successor
                </SelectItem>
                <SelectItem value="System.LinkTypes.Dependency-Reverse">
                  Predecessor
                </SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Select the relationship type between the work items
            </p>
          </div>
        </div>
      </GenericModal>

      {/* DB Artifact Details Dialog */}
      <GenericModal
        open={dbDetailsDialogOpen}
        onOpenChange={(open) => {
          setDbDetailsDialogOpen(open);
          if (!open) {
            setSelectedDbWorkItem(null);
            setDbDetailsLoading(false);
            setSelectedDbParent(null);
            setSelectedDbChildren([]);
            setDbDetailsNavStack([]);
          }
        }}
        title={selectedDbWorkItem?.title || "Artifact details"}
        icon={Database}
        width="768px"
        maxHeight="80vh"
        contentClassName="space-y-4"
        footerButtons={[
          {
            label: "Close",
            onClick: () => setDbDetailsDialogOpen(false),
            variant: "outline",
            "data-testid": "button-close-db-details",
          },
        ]}
      >
        <div className="space-y-4">
          {/* Custom header elements moved to content */}
          <div className="flex items-start justify-between gap-3 pb-4 border-b">
            <div className="flex-1 min-w-0 flex items-start gap-3">
              {dbDetailsNavStack.length > 0 && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="mt-1"
                  onClick={() => {
                    setDbDetailsNavStack((prev) => {
                      if (prev.length === 0) return prev;
                      const newStack = [...prev];
                      const last = newStack.pop()!;
                      const parentOfLast = findParentInCombined(last.id);
                      setSelectedDbWorkItem(last);
                      setSelectedDbParent(parentOfLast);
                      setSelectedDbChildren(last.linkedItems || []);
                      return newStack;
                    });
                  }}
                  data-testid="button-db-details-back"
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
              )}
              {selectedDbWorkItem && (
                <div className="flex flex-wrap items-center gap-2">
                  {(() => {
                    const dbType =
                      selectedDbWorkItem.dbArtifactType ||
                      selectedDbWorkItem.type;
                    const typeClassName =
                      dbType === "Epic"
                        ? "bg-purple-500 text-white border-purple-500"
                        : dbType === "Feature"
                          ? "bg-blue-500 text-white border-blue-500"
                          : dbType === "User Story"
                            ? "bg-green-500 text-white border-green-500"
                            : dbType === "Task"
                              ? "bg-orange-500 text-white border-orange-500"
                              : dbType === "Bug"
                                ? "bg-red-500 text-white border-red-500"
                                : "";
                    return (
                      <Badge variant="outline" className={typeClassName}>
                        {dbType}
                      </Badge>
                    );
                  })()}

                  {selectedDbWorkItem.priority && (
                    <Badge variant="secondary" className="capitalize">
                      {selectedDbWorkItem.priority}
                    </Badge>
                  )}
                  <Badge
                    variant="outline"
                    className="flex items-center gap-1 text-xs"
                  >
                    <Database className="h-3 w-3" />
                    Draft
                  </Badge>
                </div>
              )}
            </div>
          </div>
          {dbDetailsLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : selectedDbWorkItem ? (
            (() => {
              const artifact = selectedDbWorkItem.dbArtifact;
              const description = artifact?.description || "";
              const textContent = description
                .replace(/<[^>]*>/g, "")
                .replace(/&nbsp;/g, " ")
                .trim();

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

              const hasStructuredSections = sectionTitles.some((title) =>
                textContent.toUpperCase().includes(`${title}:`)
              );

              let descriptionNode: JSX.Element | null = null;

              if (artifact) {
                // For epics/features/stories, try to parse structured sections from the description.
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
                    const regex = new RegExp(`${escapedTitle}:\\s*`, "gi");
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
                      const contentStart = section.index + titleMatch[0].length;
                      const contentEnd =
                        idx < sectionMarkers.length - 1
                          ? sectionMarkers[idx + 1].index
                          : textContent.length;
                      section.content = textContent
                        .substring(contentStart, contentEnd)
                        .trim();
                    }
                  });

                  const validSections = sectionMarkers.filter((s) => s.content);

                  if (validSections.length > 0) {
                    descriptionNode = (
                      <div className="space-y-4">
                        <h4 className="text-sm font-semibold">Description</h4>
                        <div className="bg-muted/30 p-5 rounded-lg border border-border/50 space-y-5">
                          {validSections.map((section, idx) => (
                            <div key={idx} className="space-y-2.5">
                              <h5 className="text-sm font-semibold text-foreground flex items-center gap-2 pb-1 border-b border-border/30">
                                <div className="h-1.5 w-1.5 rounded-full bg-primary flex-shrink-0" />
                                <span className="capitalize">
                                  {section.title.toLowerCase()}
                                </span>
                              </h5>
                              <div className="pl-5 space-y-2">
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
                                          <span className="text-primary mt-1 flex-shrink-0">
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
                                          <span className="text-primary mt-1 flex-shrink-0 font-medium">
                                            {trimmedLine.match(/^\d+\./)?.[0]}
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
                      </div>
                    );
                  }
                }

                if (!descriptionNode) {
                  descriptionNode = (
                    <div className="space-y-2">
                      <h4 className="text-sm font-semibold">Description</h4>
                      {description.includes("<") ? (
                        <div
                          className="text-sm prose prose-sm max-w-none dark:prose-invert bg-muted/30 p-5 rounded-lg border border-border/50 leading-relaxed"
                          dangerouslySetInnerHTML={{ __html: description }}
                        />
                      ) : (
                        <div className="text-sm text-muted-foreground bg-muted/30 p-5 rounded-lg border border-border/50 leading-relaxed whitespace-pre-wrap">
                          {textContent}
                        </div>
                      )}
                    </div>
                  );
                }
              } else {
                // For draft Tasks (no backing workflow artifact), show a simple description
                // similar to ADO: use the task title and note that it's a draft task.
                descriptionNode = (
                  <div className="space-y-2">
                    <h4 className="text-sm font-semibold">Description</h4>
                    <div className="text-sm text-muted-foreground bg-muted/30 p-5 rounded-lg border border-border/50 leading-relaxed whitespace-pre-wrap">
                      {selectedDbWorkItem.title || "Draft task"}
                    </div>
                  </div>
                );
              }

              return (
                <>
                  {descriptionNode}

                  {artifact && "storyPoints" in artifact && (
                    <div className="space-y-1">
                      <h4 className="text-sm font-semibold">Story Points</h4>
                      <Badge variant="secondary">{artifact.storyPoints}</Badge>
                    </div>
                  )}

                  {artifact && "persona" in artifact && (
                    <div className="space-y-1">
                      <h4 className="text-sm font-semibold">Persona</h4>
                      <p className="text-sm text-muted-foreground">
                        {artifact.persona}
                      </p>
                    </div>
                  )}

                  {artifact &&
                    "acceptanceCriteria" in artifact &&
                    Array.isArray(artifact.acceptanceCriteria) &&
                    artifact.acceptanceCriteria.length > 0 && (
                      <div className="space-y-3">
                        <h4 className="text-sm font-semibold">
                          Acceptance Criteria
                        </h4>
                        <div className="space-y-2">
                          {artifact.acceptanceCriteria.map(
                            (ac: any, idx: number) => (
                              <div key={idx} className="flex items-start gap-3 p-3 bg-muted/30 rounded-lg border border-border/50 space-y-5">
                                <CheckCircle2 className="h-4 w-4 mt-0.5 text-green-600 flex-shrink-0" />
                                <p className="text-sm text-foreground flex-1 break-words min-w-0">
                                  {ac.title || `Acceptance Criterion ${idx + 1}`}
                                </p>
                              </div>
                            )
                          )}
                        </div>
                      </div>
                    )}

                  {/* Priority (match ADO detail styling) */}
                  {selectedDbWorkItem.priority && (
                    <div className="space-y-2">
                      <h4 className="text-sm font-semibold">Priority</h4>
                      <Badge
                        variant={
                          selectedDbWorkItem.priority === "High"
                            ? "destructive"
                            : selectedDbWorkItem.priority === "Medium"
                              ? "secondary"
                              : "outline"
                        }
                      >
                        {selectedDbWorkItem.priority}
                      </Badge>
                    </div>
                  )}

                  {/* Parent & Children info for draft artifacts */}
                  <div className="space-y-4 pt-4 border-t border-border/50 mt-4">
                    {/* Parent section */}
                    <div className="rounded-lg border border-border bg-card/50 p-4">
                      <button
                        type="button"
                        className="flex items-center justify-between w-full mb-2 text-left"
                        onClick={() =>
                          setParentSectionExpanded((prev) => !prev)
                        }
                      >
                        <div className="flex items-center gap-2">
                          {parentSectionExpanded ? (
                            <ChevronUp className="h-4 w-4 text-muted-foreground" />
                          ) : (
                            <ChevronDown className="h-4 w-4 text-muted-foreground" />
                          )}
                          <h4 className="text-sm font-semibold">Parent</h4>
                        </div>
                      </button>

                      {parentSectionExpanded &&
                        (selectedDbParent ? (
                          <div
                            className="flex items-center gap-2 p-2 rounded-md hover:bg-muted/50 cursor-pointer transition-colors"
                            onClick={() => {
                              if (
                                selectedProject &&
                                selectedDbParent
                              ) {
                                setDetailsNavStack((prev) =>
                                  selectedWorkItemDetails
                                    ? [...prev, selectedWorkItemDetails]
                                    : prev
                                );
                                fetchWorkItemDetailsMutation.mutate({
                                  projectName: selectedProject.name,
                                  workItemId: selectedDbParent.id,
                                  artifactOrgId: selectedProject.artifactOrgId,
                                  organizationUrl:
                                    selectedProject.organizationUrl,
                                  organization: selectedProject.organization,
                                  projectId: selectedProject.id,
                                  integrationType:
                                    selectedProject.integrationType,
                                });
                              }
                            }}
                          >
                            <Badge variant="outline" className="text-xs">
                              {selectedDbParent.type}
                            </Badge>
                            <span className="text-sm font-medium">
                              {selectedDbParent.title}
                            </span>
                            <Badge variant="secondary" className="text-xs">
                              {selectedDbParent.status}
                            </Badge>
                          </div>
                        ) : (
                          (() => {
                            // If there is no draft parent, try to surface ADO parent information
                            const artifact: any = selectedDbWorkItem?.dbArtifact;

                            // For draft Features whose parent Epic was already pushed
                            if (
                              selectedDbWorkItem?.type === "Feature" &&
                              artifact
                            ) {
                              const parentEpic = (workflowEpics as any[]).find(
                                (e: any) => e.id === artifact.epicId
                              );
                              const adoEpicId =
                                artifact.adoParentEpicId ??
                                parentEpic?.adoWorkItemId;

                              if (adoEpicId && parentEpic) {
                                return (
                                  <div className="text-sm text-muted-foreground space-y-1">
                                    <p>No parent draft artifact.</p>
                                    <p>
                                      {`Parent exists in ${
                                        selectedProject?.integrationType ===
                                          "jira" ||
                                        selectedProject?.organization ===
                                          "Jira"
                                          ? "Jira"
                                          : "Azure DevOps"
                                      }: Epic "`}
                                      {parentEpic.title}" (ADO #{adoEpicId})
                                    </p>
                                  </div>
                                );
                              }
                            }

                            // For draft User Stories whose parent Feature / Epic were already pushed
                            if (
                              selectedDbWorkItem?.type === "User Story" &&
                              artifact
                            ) {
                              const parentFeature = (workflowFeatures as any[]).find(
                                (f: any) => f.id === artifact.featureId
                              );
                              const parentEpic = (workflowEpics as any[]).find(
                                (e: any) => e.id === artifact.epicId
                              );

                              const adoFeatureId =
                                artifact.adoParentFeatureId ??
                                parentFeature?.adoWorkItemId;
                              const adoEpicId =
                                artifact.adoParentEpicId ??
                                parentEpic?.adoWorkItemId;

                              if (adoFeatureId || adoEpicId) {
                                return (
                                  <div className="text-sm text-muted-foreground space-y-1">
                                    <p>No parent draft artifact.</p>
                                    {adoFeatureId && parentFeature && (
                                      <p>
                                        {`Parent Feature in ${
                                          selectedProject?.integrationType ===
                                            "jira" ||
                                          selectedProject?.organization ===
                                            "Jira"
                                            ? "Jira"
                                            : "Azure DevOps"
                                        }: "`}
                                        {parentFeature.title}" (ADO #
                                        {adoFeatureId})
                                      </p>
                                    )}
                                    {adoEpicId && parentEpic && (
                                      <p>
                                        {`Parent Epic in ${
                                          selectedProject?.integrationType ===
                                            "jira" ||
                                          selectedProject?.organization ===
                                            "Jira"
                                            ? "Jira"
                                            : "Azure DevOps"
                                        }: "`}
                                        {parentEpic.title}" (ADO #{adoEpicId})
                                      </p>
                                    )}
                                  </div>
                                );
                              }
                            }

                            // Default fallback when no parent information is available
                            return (
                              <p className="text-sm text-muted-foreground">
                                No parent artifact
                              </p>
                            );
                          })()
                        ))}
                    </div>

                    {/* Children section */}
                    <div className="rounded-lg border border-border bg-card/50 p-4">
                      <button
                        type="button"
                        className="flex items-center justify-between w-full mb-3 text-left"
                        onClick={() =>
                          setChildrenSectionExpanded((prev) => !prev)
                        }
                      >
                        <div className="flex items-center gap-2">
                          {childrenSectionExpanded ? (
                            <ChevronDown className="h-4 w-4 text-muted-foreground" />
                          ) : (
                            <ChevronUp className="h-4 w-4 text-muted-foreground" />
                          )}
                          <h4 className="text-sm font-semibold">
                            Children ({selectedDbChildren.length})
                          </h4>
                        </div>
                      </button>

                      {childrenSectionExpanded &&
                        (selectedDbChildren.length > 0 ? (
                          <div className="space-y-2">
                            {selectedDbChildren.map((child) => (
                              <div
                                key={child.id}
                                className="flex items-center gap-2 p-2 rounded-md hover:bg-muted/50 cursor-pointer transition-colors"
                                onClick={() => {
                                  const fullItem =
                                    findItemInCombined(child.id) || child;
                                  const parentOfChild = findParentInCombined(
                                    child.id
                                  );
                                  setDbDetailsNavStack((prev) =>
                                    selectedDbWorkItem
                                      ? [...prev, selectedDbWorkItem]
                                      : prev
                                  );
                                  setSelectedDbWorkItem(fullItem);
                                  setSelectedDbParent(parentOfChild);
                                  setSelectedDbChildren(
                                    fullItem.linkedItems || []
                                  );
                                }}
                              >
                                <Badge variant="outline" className="text-xs">
                                  {child.type}
                                </Badge>
                                <span className="text-sm font-medium flex-1">
                                  {child.title}
                                </span>
                                <Badge variant="secondary" className="text-xs">
                                  {child.status}
                                </Badge>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className="text-sm text-muted-foreground pl-6">
                            No child artifacts
                          </p>
                        ))}
                    </div>
                  </div>
                </>
              );
            })()
          ) : null}
        </div>
      </GenericModal>

      {/* Draft (DB) Artifact Edit Dialog */}
      {latestWorkflowArtifact && (
        <>
          <ArtifactEditDialog
            open={draftEditOpen}
            onOpenChange={(open) => {
              setDraftEditOpen(open);
              if (!open) {
                setDraftEditArtifact(null);
              }
            }}
            artifact={draftEditArtifact}
            artifactType={draftEditType}
            onSave={() => {
              // Local UI is driven by workflow_artifacts query; just refetch after save.
            }}
            artifactId={latestWorkflowArtifact.id}
            projectId={latestWorkflowArtifact.projectId || undefined}
            personas={((latestWorkflowArtifact as any).personas as any[]) || []}
            onArtifactUpdate={() => {
              queryClient.invalidateQueries({
                queryKey: ["/api/workflow/artifacts", workflowProjectId],
              });
            }}
          />

          {/* Draft Task (subtask) Edit Dialog */}
          <GenericModal
            open={draftTaskEditOpen}
            onOpenChange={(open) => {
              setDraftTaskEditOpen(open);
              if (!open) {
                setDraftTaskStory(null);
                setDraftTaskIndex(null);
                setDraftTaskEditTitle("");
              }
            }}
            title="Edit Draft Task"
            description="Update the title of this draft task. Changes will be saved into the parent User Story's subtasks."
            icon={Edit}
            width="512px"
            contentClassName="space-y-4"
            footerButtons={[
              {
                label: "Cancel",
                onClick: () => setDraftTaskEditOpen(false),
                variant: "outline",
                disabled: draftTaskSaving,
              },
              {
                label: draftTaskSaving ? "Saving..." : "Save",
                onClick: async () => {
                  if (
                    !latestWorkflowArtifact ||
                    !draftTaskStory ||
                    draftTaskIndex === null
                  ) {
                    toast({
                      title: "Cannot save task",
                      description:
                        "Missing task or artifact information. Please close and try again.",
                      variant: "destructive",
                    });
                    return;
                  }

                  try {
                    setDraftTaskSaving(true);

                    // Fetch current workflow artifact
                    const response = await fetch(
                      getApiUrl(
                        `/api/workflow/artifacts/${latestWorkflowArtifact.id}`
                      ),
                      {
                        method: "GET",
                        credentials: "include",
                      }
                    );

                    if (!response.ok) {
                      throw new Error("Failed to fetch current artifact");
                    }

                    const currentArtifact = await response.json();
                    const artifact =
                      currentArtifact.artifact || currentArtifact;

                    let updatedEpics = artifact.epics || [];
                    let updatedFeatures = artifact.features || [];
                    let updatedUserStories = artifact.userStories || [];

                    // Find and update the specific User Story's subtask title
                    updatedUserStories = updatedUserStories.map((s: any) => {
                      if (s.id !== draftTaskStory.id) return s;
                      const subtasks = Array.isArray(s.subtasks)
                        ? [...s.subtasks]
                        : [];
                      if (
                        draftTaskIndex! >= 0 &&
                        draftTaskIndex! < subtasks.length
                      ) {
                        subtasks[draftTaskIndex!] = draftTaskEditTitle.trim();
                      }
                      return {
                        ...s,
                        subtasks,
                      };
                    });

                    const saveResponse = await fetch(
                      getApiUrl(
                        `/api/workflow/artifacts/${latestWorkflowArtifact.id}`
                      ),
                      {
                        method: "PUT",
                        headers: {
                          "Content-Type": "application/json",
                        },
                        credentials: "include",
                        body: JSON.stringify({
                          epics: updatedEpics,
                          features: updatedFeatures,
                          userStories: updatedUserStories,
                          requirement: artifact.requirement || "",
                        }),
                      }
                    );

                    if (!saveResponse.ok) {
                      const errorData = await saveResponse
                        .json()
                        .catch(() => ({ error: "Failed to save" }));
                      throw new Error(
                        errorData.error || "Failed to save draft task"
                      );
                    }

                    toast({
                      title: "Task updated",
                      description: "Draft task title saved successfully.",
                    });

                    // Refresh workflow artifacts so UI reflects changes
                    queryClient.invalidateQueries({
                      queryKey: ["/api/workflow/artifacts", workflowProjectId],
                    });

                    setDraftTaskEditOpen(false);
                  } catch (error: any) {
                    toast({
                      title: "Failed to save task",
                      description:
                        error?.message ||
                        "An error occurred while saving the draft task.",
                      variant: "destructive",
                    });
                  } finally {
                    setDraftTaskSaving(false);
                  }
                },
                variant: "default",
                disabled: draftTaskSaving || !draftTaskEditTitle.trim(),
                loading: draftTaskSaving,
              },
            ]}
          >
            <div className="space-y-1">
              <Label htmlFor="draft-task-title">Task Title</Label>
              <Input
                id="draft-task-title"
                value={draftTaskEditTitle}
                onChange={(e) => setDraftTaskEditTitle(e.target.value)}
                placeholder="Enter task title"
              />
            </div>
          </GenericModal>
        </>
      )}

      <GenericModal
        open={detailsDialogOpen}
        onOpenChange={(open) => {
          if (!open) {
            // If there's a navigation stack, go back instead of closing
            if (detailsNavStack.length > 0) {
              handleDetailsBack();
              // Keep the dialog open by setting it back to true
              setDetailsDialogOpen(true);
              return;
            }
            // Only reset and close if there's no navigation stack
            setDetailsNavStack([]);
            setSelectedWorkItemDetails(null);
            setParentSectionExpanded(true);
            setChildrenSectionExpanded(true);
            setDetailsDialogOpen(false);
          } else {
            setDetailsDialogOpen(true);
          }
        }}
        title={selectedWorkItemDetails?.title || "Work Item Details"}
        icon={Package}
        width="1152px"
        maxHeight="90vh"
        contentClassName="space-y-6"
        footerButtons={[
          {
            label: "Edit",
            onClick: () => {
              if (selectedWorkItemDetails) {
                setEditingWorkItemId(selectedWorkItemDetails.id);
                setEditDialogOpen(true);
                setDetailsDialogOpen(false);
              }
            },
            variant: "outline",
            disabled:
              !selectedWorkItemDetails ||
              fetchWorkItemDetailsMutation.isPending,
            "data-testid": "button-edit-work-item",
          },
          {
            label: "Close",
            onClick: () => {
              // If there's a navigation stack, go back instead of closing
              if (detailsNavStack.length > 0) {
                handleDetailsBack();
              } else {
                setDetailsDialogOpen(false);
              }
            },
            variant: "outline",
            "data-testid": "button-close-details",
          },
        ]}
      >
        {/* Custom header elements moved to content */}
        <div className="flex items-start justify-between gap-4 pb-4 border-b">
          <div className="flex-1 min-w-0 flex items-start gap-3">
            {detailsNavStack.length > 0 && (
              <Button
                variant="ghost"
                size="icon"
                className="mt-1"
                onClick={handleDetailsBack}
                data-testid="button-details-back"
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
            )}
            <div className="flex items-center gap-2 flex-wrap">
              <Badge
                variant="outline"
                className={
                  selectedWorkItemDetails?.type === "Epic"
                    ? "bg-purple-500 text-white border-purple-500"
                    : selectedWorkItemDetails?.type === "Feature"
                      ? "bg-blue-500 text-white border-blue-500"
                      : selectedWorkItemDetails?.type === "User Story"
                        ? "bg-green-500 text-white border-green-500"
                        : selectedWorkItemDetails?.type === "Task"
                          ? "bg-orange-500 text-white border-orange-500"
                          : selectedWorkItemDetails?.type === "Bug"
                            ? "bg-red-500 text-white border-red-500"
                            : ""
                }
              >
                {selectedWorkItemDetails?.type}
              </Badge>
              <Badge variant="secondary" className="capitalize">
                {selectedWorkItemDetails?.state}
              </Badge>
              {selectedWorkItemDetails?.id && (
                <span className="text-xs text-muted-foreground">
                  ID: {selectedWorkItemDetails.id}
                </span>
              )}
              {selectedWorkItemDetails?.storyPoints && (
                <Badge variant="outline">
                  {selectedWorkItemDetails.storyPoints} pts
                </Badge>
              )}
            </div>
          </div>
          {selectedWorkItemDetails?.url && (
            <Button
              variant="outline"
              size="sm"
              asChild
              data-testid="button-open-in-platform"
            >
              <a
                href={selectedWorkItemDetails.url}
                target="_blank"
                rel="noopener noreferrer"
              >
                <ExternalLink className="h-4 w-4 mr-2" />
                Open in {platformLabel}
              </a>
            </Button>
          )}
        </div>

        <div className="space-y-6">
          {fetchWorkItemDetailsMutation.isPending ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : (
            selectedWorkItemDetails && (
              <>
                {/* Metadata Section */}
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <User className="h-4 w-4" />
                      <span className="font-medium">Assigned To</span>
                    </div>
                    <p className="text-sm">
                      {selectedWorkItemDetails.assignedTo}
                    </p>
                  </div>

                  <div className="space-y-1">
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <User className="h-4 w-4" />
                      <span className="font-medium">Created By</span>
                    </div>
                    <p className="text-sm">
                      {selectedWorkItemDetails.createdBy}
                    </p>
                  </div>

                  <div className="space-y-1">
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Calendar className="h-4 w-4" />
                      <span className="font-medium">Created Date</span>
                    </div>
                    <p className="text-sm">
                      {new Date(
                        selectedWorkItemDetails.createdDate
                      ).toLocaleDateString()}
                    </p>
                  </div>

                  <div className="space-y-1">
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Calendar className="h-4 w-4" />
                      <span className="font-medium">Changed Date</span>
                    </div>
                    <p className="text-sm">
                      {new Date(
                        selectedWorkItemDetails.changedDate
                      ).toLocaleDateString()}
                    </p>
                  </div>
                </div>

                {/* Description */}
                {selectedWorkItemDetails.description &&
                  (() => {
                    const description = selectedWorkItemDetails.description;
                    // Strip HTML tags for parsing
                    const textContent = description
                      .replace(/<[^>]*>/g, "")
                      .replace(/&nbsp;/g, " ")
                      .trim();

                    // Section titles to look for
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

                    // Check if description has structured sections
                    const hasStructuredSections = sectionTitles.some((title) =>
                      textContent.toUpperCase().includes(`${title}:`)
                    );

                    if (hasStructuredSections) {
                      // Parse sections by finding all section markers first
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
                        const regex = new RegExp(`${escapedTitle}:\\s*`, "gi");
                        const matchIndex = textContent.search(regex);
                        if (matchIndex !== -1) {
                          sectionMarkers.push({
                            title,
                            content: "",
                            index: matchIndex,
                          });
                        }
                      });

                      // Sort by index and extract content
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

                      // Filter out empty sections
                      const validSections = sectionMarkers.filter(
                        (s) => s.content
                      );

                      if (validSections.length > 0) {
                        return (
                          <div className="space-y-4">
                            <h4 className="text-sm font-semibold">
                              Description
                            </h4>
                            <div className="bg-muted/30 p-5 rounded-lg border border-border/50 space-y-5">
                              {validSections.map((section, idx) => (
                                <div key={idx} className="space-y-2.5">
                                  <h5 className="text-sm font-semibold text-foreground flex items-center gap-2 pb-1 border-b border-border/30">
                                    <div className="h-1.5 w-1.5 rounded-full bg-primary flex-shrink-0" />
                                    <span className="capitalize">
                                      {section.title.toLowerCase()}
                                    </span>
                                  </h5>
                                  <div className="pl-5 space-y-2">
                                    {section.content
                                      .split(/\n+/)
                                      .filter((line) => line.trim())
                                      .map((line, lineIdx) => {
                                        const trimmedLine = line.trim();
                                        // Handle bullet points
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
                                              <span className="text-primary mt-1 flex-shrink-0">
                                                •
                                              </span>
                                              <span className="text-sm text-muted-foreground leading-relaxed flex-1">
                                                {content}
                                              </span>
                                            </div>
                                          );
                                        }
                                        // Handle numbered lists
                                        if (trimmedLine.match(/^\d+\.\s/)) {
                                          const content = trimmedLine
                                            .replace(/^\d+\.\s*/, "")
                                            .trim();
                                          return (
                                            <div
                                              key={lineIdx}
                                              className="flex items-start gap-2.5"
                                            >
                                              <span className="text-primary mt-1 flex-shrink-0 font-medium">
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
                                        // Regular paragraph
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
                          </div>
                        );
                      }
                    }

                    // Fallback: render as HTML or plain text
                    return (
                      <div className="space-y-2">
                        <h4 className="text-sm font-semibold">Description</h4>
                        {description.includes("<") ? (
                          <div
                            className="text-sm prose prose-sm max-w-none dark:prose-invert bg-muted/30 p-5 rounded-lg border border-border/50 leading-relaxed"
                            dangerouslySetInnerHTML={{ __html: description }}
                          />
                        ) : (
                          <div className="text-sm text-muted-foreground bg-muted/30 p-5 rounded-lg border border-border/50 leading-relaxed whitespace-pre-wrap">
                            {textContent}
                          </div>
                        )}
                      </div>
                    );
                  })()}

                {/* Acceptance Criteria */}
                {selectedWorkItemDetails.acceptanceCriteria &&
                  (() => {
                    const raw = selectedWorkItemDetails.acceptanceCriteria;
                    let parsedCriteria: any[] | null = null;

                    // 1) Try to parse as JSON array first (structured AC from our backend)
                    try {
                      const maybe = JSON.parse(raw);
                      if (Array.isArray(maybe)) {
                        parsedCriteria = maybe;
                      }
                    } catch {
                      parsedCriteria = null;
                    }

                    // Helper to extract a single Given/When/Then/And block from a text source
                    const getSection = (
                      label: string,
                      source: string
                    ): { text: string; nextIndex: number } => {
                      const regex = new RegExp(`${label}:`, "i");
                      const match = source.match(regex);
                      if (!match || match.index === undefined)
                        return { text: "", nextIndex: -1 };
                      const idx = match.index;
                      const start = idx + label.length + 1;
                      const remainder = source.slice(start);
                      const nextMatch = remainder.match(
                        /(?:Given:|When:|Then:|And:)/i
                      );
                      const end = nextMatch
                        ? start + nextMatch.index!
                        : source.length;
                      const text = source.slice(start, end).trim();
                      return { text, nextIndex: end };
                    };

                    // Helper to parse a single "criterion" block of text into structured G/W/T/A + optional title
                    const parseCriterionBlock = (block: string) => {
                      const trimmed = block.trim();
                      if (!trimmed) return null;

                      const givenRegex = /Given:/i;
                      const givenMatch = trimmed.match(givenRegex);
                      let title = "";
                      let gwtaSource = trimmed;

                      if (givenMatch && givenMatch.index !== undefined) {
                        const givenIdx = givenMatch.index;
                        const beforeGiven = trimmed.slice(0, givenIdx).trim();
                        const afterGiven = trimmed.slice(givenIdx);
                        if (beforeGiven) {
                          title = beforeGiven
                            .replace(/^Criteria\s*\d*:\s*/i, "")
                            .trim();
                        }
                        gwtaSource = afterGiven;
                      } else {
                        // Fallback: use first line before newline as potential title
                        const firstNewline = trimmed.indexOf("\n");
                        const firstLine = (
                          firstNewline !== -1
                            ? trimmed.slice(0, firstNewline)
                            : trimmed
                        ).trim();
                        const rest =
                          firstNewline !== -1
                            ? trimmed.slice(firstNewline + 1)
                            : trimmed;
                        const hasGiven = /Given:/i.test(rest);
                        if (
                          hasGiven &&
                          firstLine &&
                          !/^Given:/i.test(firstLine)
                        ) {
                          title = firstLine
                            .replace(/^Criteria\s*\d*:\s*/i, "")
                            .trim();
                          gwtaSource = rest;
                        }
                      }

                      const givenSec = getSection("Given", gwtaSource);
                      const whenSec = getSection("When", gwtaSource);
                      const thenSec = getSection("Then", gwtaSource);
                      const andSec = getSection("And", gwtaSource);

                      if (
                        givenSec.text ||
                        whenSec.text ||
                        thenSec.text ||
                        andSec.text
                      ) {
                        return {
                          title: title || undefined,
                          given: givenSec.text,
                          when: whenSec.text,
                          then: thenSec.text,
                          and: andSec.text,
                        };
                      }

                      // If we couldn't find structured sections but have text, treat the whole block as a simple criterion
                      if (trimmed) {
                        return {
                          title: trimmed,
                        };
                      }

                      return null;
                    };

                    // 2) If JSON parse failed, try to parse plain text/HTML into one or more criteria blocks
                    if (!parsedCriteria) {
                      const plain = raw
                        .replace(/<br\s*\/?>/gi, "\n")
                        .replace(/<\/p>/gi, "\n")
                        .replace(/<[^>]*>/g, "")
                        .replace(/&nbsp;/g, " ")
                        .trim();

                      if (plain) {
                        // Split into potential multiple criteria using blank lines or "Criteria X:" headings
                        const blocks = plain
                          .split(/\n{2,}|\r?\n(?=Criteria\s*\d+:)/i)
                          .map((b) => b.trim())
                          .filter((b) => b.length > 0);

                        const criteria: any[] = [];

                        if (blocks.length > 0) {
                          for (const block of blocks) {
                            const parsed = parseCriterionBlock(block);
                            if (parsed) {
                              criteria.push(parsed);
                            }
                          }
                        } else {
                          const parsed = parseCriterionBlock(plain);
                          if (parsed) {
                            criteria.push(parsed);
                          }
                        }

                        if (criteria.length > 0) {
                          parsedCriteria = criteria;
                        }
                      }
                    }

                    // 3) If we have structured criteria, render with card template (same as other views)
                    if (parsedCriteria && parsedCriteria.length > 0) {
                      return (
                        <div className="space-y-3">
                          <h4 className="text-sm font-semibold">
                            Acceptance Criteria
                          </h4>
                          <div className="space-y-3">
                            {parsedCriteria.map((ac: any, idx: number) => {
                              // Handle descriptive string format (new format)
                              let displayText = '';

                              if (typeof ac === 'string') {
                                displayText = ac;
                              } else if (typeof ac === 'object' && ac !== null) {
                                // For backward compatibility, extract descriptive text
                                // If it has given/when/then, combine them into a descriptive statement
                                if (ac.given || ac.when || ac.then) {
                                  const parts = [];
                                  if (ac.given) parts.push(`Given ${ac.given}`);
                                  if (ac.when) parts.push(`when ${ac.when}`);
                                  if (ac.then) parts.push(`then ${ac.then}`);
                                  if (ac.and) parts.push(`and ${ac.and}`);
                                  displayText = parts.join(', ');
                                } else {
                                  displayText = ac.title || ac.description || Object.values(ac).filter(v => typeof v === 'string' && v.trim()).join(' ') || `Acceptance Criterion ${idx + 1}`;
                                }
                              } else {
                                displayText = `Acceptance Criterion ${idx + 1}`;
                              }

                              return (
                                <Card key={idx} className="bg-muted/30 border-l-[3px] border-l-blue-500">
                                  <CardHeader className="p-3 pb-2">
                                    <CardTitle className="text-sm font-medium flex items-start gap-2">
                                      <CheckCircle2 className="h-4 w-4 mt-0.5 text-green-600 flex-shrink-0" />
                                      Acceptance Criterion {idx + 1}
                                    </CardTitle>
                                  </CardHeader>
                                  <CardContent className="p-3 pt-0 text-sm">
                                    <p className="text-foreground">{displayText}</p>
                                  </CardContent>
                                </Card>
                              );
                            })}
                          </div>
                        </div>
                      );
                    }

                    // 4) Fallback: render as original HTML from ADO
                    return (
                      <div className="space-y-2">
                        <h4 className="text-sm font-semibold">
                          Acceptance Criteria
                        </h4>
                        <div
                          className="text-sm prose prose-sm max-w-none dark:prose-invert bg-muted/30 p-4 rounded-lg border border-border/50"
                          dangerouslySetInnerHTML={{
                            __html: raw
                          }}
                        />
                      </div>
                    );
                  })()}

                {/* Type-specific fields */}
                {selectedWorkItemDetails.type === "User Story" &&
                  selectedWorkItemDetails.storyPoints && (
                    <div className="space-y-2">
                      <div className="flex items-center gap-2 text-sm font-semibold">
                        <TrendingUp className="h-4 w-4" />
                        Story Points
                      </div>
                      <Badge variant="secondary" className="text-lg px-3 py-1">
                        {selectedWorkItemDetails.storyPoints}
                      </Badge>
                    </div>
                  )}

                {(selectedWorkItemDetails.type === "Epic" ||
                  selectedWorkItemDetails.type === "Feature") &&
                  selectedWorkItemDetails.businessValue && (
                    <div className="space-y-2">
                      <h4 className="text-sm font-semibold">Business Value</h4>
                      <Badge variant="secondary" className="text-lg px-3 py-1">
                        {selectedWorkItemDetails.businessValue}
                      </Badge>
                    </div>
                  )}

                {selectedWorkItemDetails.type === "Bug" &&
                  selectedWorkItemDetails.severity && (
                    <div className="space-y-2">
                      <h4 className="text-sm font-semibold">Severity</h4>
                      <Badge
                        variant={
                          selectedWorkItemDetails.severity === "1 - Critical"
                            ? "destructive"
                            : "secondary"
                        }
                      >
                        {selectedWorkItemDetails.severity}
                      </Badge>
                    </div>
                  )}

                {selectedWorkItemDetails.type === "Bug" &&
                  selectedWorkItemDetails.reproSteps && (
                    <div className="space-y-2">
                      <h4 className="text-sm font-semibold">Repro Steps</h4>
                      <div
                        className="text-sm prose prose-sm max-w-none dark:prose-invert bg-muted/30 p-4 rounded-lg border border-border/50"
                        dangerouslySetInnerHTML={{
                          __html: selectedWorkItemDetails.reproSteps,
                        }}
                      />
                    </div>
                  )}

                {(selectedWorkItemDetails.type === "Task" ||
                  selectedWorkItemDetails.type === "Issue") && (
                    <div className="grid grid-cols-3 gap-4">
                      {selectedWorkItemDetails.remainingWork !== null && (
                        <div className="space-y-2">
                          <h4 className="text-sm font-semibold">
                            Remaining Work
                          </h4>
                          <Badge variant="secondary">
                            {selectedWorkItemDetails.remainingWork} hours
                          </Badge>
                        </div>
                      )}

                      {selectedWorkItemDetails.originalEstimate !== null && (
                        <div className="space-y-2">
                          <h4 className="text-sm font-semibold">
                            Original Estimate
                          </h4>
                          <Badge variant="secondary">
                            {selectedWorkItemDetails.originalEstimate} hours
                          </Badge>
                        </div>
                      )}

                      {selectedWorkItemDetails.completedWork !== null && (
                        <div className="space-y-2">
                          <h4 className="text-sm font-semibold">
                            Completed Work
                          </h4>
                          <Badge variant="secondary">
                            {selectedWorkItemDetails.completedWork} hours
                          </Badge>
                        </div>
                      )}
                    </div>
                  )}

                {/* Priority */}
                {selectedWorkItemDetails.priority && (
                  <div className="space-y-2">
                    <h4 className="text-sm font-semibold">Priority</h4>
                    <Badge
                      variant={
                        selectedWorkItemDetails.priority === 1
                          ? "destructive"
                          : selectedWorkItemDetails.priority === 2
                            ? "secondary"
                            : "outline"
                      }
                    >
                      {selectedWorkItemDetails.priority === 1
                        ? "High"
                        : selectedWorkItemDetails.priority === 2
                          ? "Medium"
                          : "Low"}
                    </Badge>
                  </div>
                )}

                {/* Tags */}
                {selectedWorkItemDetails.tags && (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 text-sm font-medium">
                      <Tag className="h-4 w-4" />
                      Tags
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {selectedWorkItemDetails.tags
                        .split(";")
                        .filter(Boolean)
                        .map((tag, index) => (
                          <Badge key={index} variant="outline">
                            {tag.trim()}
                          </Badge>
                        ))}
                    </div>
                  </div>
                )}

                {/* Iteration & Area Paths */}
                <div className="grid grid-cols-2 gap-4">
                  {selectedWorkItemDetails.iterationPath && (
                    <div className="space-y-1">
                      <p className="text-sm font-medium">Iteration Path</p>
                      <p className="text-sm text-muted-foreground">
                        {selectedWorkItemDetails.iterationPath}
                      </p>
                    </div>
                  )}

                  {selectedWorkItemDetails.areaPath && (
                    <div className="space-y-1">
                      <p className="text-sm font-medium">Area Path</p>
                      <p className="text-sm text-muted-foreground">
                        {selectedWorkItemDetails.areaPath}
                      </p>
                    </div>
                  )}
                </div>

                {/* Test Case Steps - Only for Test Case work items */}
                {selectedWorkItemDetails.type === "Test Case" &&
                  selectedWorkItemDetails.testCaseSteps &&
                  selectedWorkItemDetails.testCaseSteps.length > 0 && (
                    <div className="space-y-2">
                      <h4 className="text-sm font-semibold">Test Steps</h4>
                      <div className="bg-muted/30 rounded-lg border border-border/50 overflow-hidden">
                        <div className="overflow-x-auto">
                          <table className="w-full">
                            <thead className="bg-muted/50 border-b border-border/50">
                              <tr>
                                <th className="text-left p-3 text-xs font-semibold text-muted-foreground w-16">
                                  Step
                                </th>
                                <th className="text-left p-3 text-xs font-semibold text-muted-foreground">
                                  Action
                                </th>
                                <th className="text-left p-3 text-xs font-semibold text-muted-foreground">
                                  Expected Result
                                </th>
                              </tr>
                            </thead>
                            <tbody>
                              {selectedWorkItemDetails.testCaseSteps.map(
                                (step, idx) => (
                                  <tr
                                    key={idx}
                                    className="border-b border-border/30 last:border-b-0 hover:bg-muted/20 transition-colors"
                                  >
                                    <td className="p-3 text-sm font-medium text-foreground">
                                      {step.step}
                                    </td>
                                    <td className="p-3 text-sm text-muted-foreground">
                                      {step.action || "-"}
                                    </td>
                                    <td className="p-3 text-sm text-muted-foreground">
                                      {step.expectedResult || "-"}
                                    </td>
                                  </tr>
                                )
                              )}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </div>
                  )}

                {/* Parent and Children Section - At the bottom */}
                <div className="space-y-4 pt-4 border-t border-border/50">
                  {/* Parent section */}
                  <div className="rounded-lg border border-border bg-card/50 p-4">
                    <button
                      type="button"
                      className="flex items-center justify-between w-full mb-2 text-left"
                      onClick={() => setParentSectionExpanded((prev) => !prev)}
                    >
                      <div className="flex items-center gap-2">
                        {parentSectionExpanded ? (
                          <ChevronUp className="h-4 w-4 text-muted-foreground" />
                        ) : (
                          <ChevronDown className="h-4 w-4 text-muted-foreground" />
                        )}
                        <h3 className="text-sm font-semibold">Parent</h3>
                      </div>
                    </button>

                    {parentSectionExpanded &&
                      (selectedWorkItemDetails.parent ? (
                        <div
                          className="flex items-center gap-2 p-2 rounded-md hover:bg-muted/50 cursor-pointer transition-colors"
                          onClick={() => {
                            if (
                              selectedProject &&
                              selectedWorkItemDetails.parent
                            ) {
                              setDetailsNavStack((prev) =>
                                selectedWorkItemDetails
                                  ? [...prev, selectedWorkItemDetails]
                                  : prev
                              );
                              fetchWorkItemDetailsMutation.mutate({
                                projectName: selectedProject.name,
                                workItemId: selectedWorkItemDetails.parent.id,
                                artifactOrgId: selectedProject.artifactOrgId,
                                organizationUrl:
                                  selectedProject.organizationUrl,
                                organization: selectedProject.organization,
                                projectId: selectedProject.id,
                                integrationType:
                                  selectedProject.integrationType,
                              });
                            }
                          }}
                        >
                          <Badge variant="outline" className="text-xs">
                            {selectedWorkItemDetails.parent.type}
                          </Badge>
                          <span className="text-sm font-medium">
                            {selectedWorkItemDetails.parent.title}
                          </span>
                          <Badge
                            variant="secondary"
                            className="text-xs ml-auto"
                          >
                            {selectedWorkItemDetails.parent.state}
                          </Badge>
                        </div>
                      ) : (
                        <p className="text-sm text-muted-foreground pl-6">
                          No parent work item
                        </p>
                      ))}
                  </div>

                  {/* Children section */}
                  <div className="rounded-lg border border-border bg-card/50 p-4">
                    <button
                      type="button"
                      className="flex items-center justify-between w-full mb-3 text-left"
                      onClick={() =>
                        setChildrenSectionExpanded((prev) => !prev)
                      }
                    >
                      <div className="flex items-center gap-2">
                        {childrenSectionExpanded ? (
                          <ChevronDown className="h-4 w-4 text-muted-foreground" />
                        ) : (
                          <ChevronUp className="h-4 w-4 text-muted-foreground" />
                        )}
                        <h3 className="text-sm font-semibold">
                          Children (
                          {selectedWorkItemDetails.children?.length || 0})
                        </h3>
                      </div>
                    </button>

                    {childrenSectionExpanded &&
                      (selectedWorkItemDetails.children &&
                        selectedWorkItemDetails.children.length > 0 ? (
                        <div className="space-y-2">
                          {selectedWorkItemDetails.children.map((child) => (
                            <div
                              key={child.id}
                              className="flex items-center gap-2 p-2 rounded-md hover:bg-muted/50 cursor-pointer transition-colors"
                              onClick={() => {
                                if (selectedProject) {
                                  setDetailsNavStack((prev) =>
                                    selectedWorkItemDetails
                                      ? [...prev, selectedWorkItemDetails]
                                      : prev
                                  );
                                  fetchWorkItemDetailsMutation.mutate({
                                    projectName: selectedProject.name,
                                    workItemId: child.id,
                                    artifactOrgId:
                                      selectedProject.artifactOrgId,
                                    organizationUrl:
                                      selectedProject.organizationUrl,
                                    organization: selectedProject.organization,
                                    projectId: selectedProject.id,
                                    integrationType:
                                      selectedProject.integrationType,
                                  });
                                }
                              }}
                            >
                              <Badge variant="outline" className="text-xs">
                                {child.type}
                              </Badge>
                              <span className="text-sm font-medium flex-1">
                                {child.title}
                              </span>
                              <Badge variant="secondary" className="text-xs">
                                {child.state}
                              </Badge>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-sm text-muted-foreground pl-6">
                          No child work items
                        </p>
                      ))}
                  </div>
                </div>
              </>
            )
          )}
        </div>
      </GenericModal>

      {/* Create Work Item Dialog */}
      {selectedProject && (
        <AdoWorkItemCreateDialog
          open={createDialogOpen}
          onOpenChange={setCreateDialogOpen}
          projectName={selectedProject.name}
          artifactOrgId={selectedProject.artifactOrgId}
          organizationUrl={selectedProject.organizationUrl}
          projectId={selectedProject.id}
          organization={selectedProject.organization}
          integrationType={
            selectedProject.integrationType === "jira" ? "jira" : "ado"
          }
          availableIssueTypes={
            isSelectedProjectJira ? jiraIssueTypes : undefined
          }
        />
      )}

      {/* Edit Work Item Dialog */}
      {selectedProject && editingWorkItemId && (
        <AdoWorkItemEditDialog
          open={editDialogOpen}
          onOpenChange={(open) => {
            setEditDialogOpen(open);
            // When edit dialog closes, reopen the details dialog if it was open before
            if (!open && selectedWorkItemDetails) {
              // Refresh the current work item details to show any changes
              if (selectedProject && selectedWorkItemDetails) {
                fetchWorkItemDetailsMutation.mutate({
                  projectName: selectedProject.name,
                  workItemId: selectedWorkItemDetails.id,
                  artifactOrgId: selectedProject.artifactOrgId,
                  organizationUrl: selectedProject.organizationUrl,
                  organization: selectedProject.organization,
                  projectId: selectedProject.id,
                  integrationType: selectedProject.integrationType,
                });
              }
              // Reopen the details dialog (navigation stack is preserved)
              setDetailsDialogOpen(true);
            }
            if (!open) setEditingWorkItemId(null);
          }}
          workItemId={editingWorkItemId}
          projectName={selectedProject.name}
          artifactOrgId={selectedProject.artifactOrgId}
          organizationUrl={selectedProject.organizationUrl}
          projectId={selectedProject.id}
          integrationType={
            selectedProject.integrationType === "jira" ? "jira" : "ado"
          }
        />
      )}
    </div>
  );
}
