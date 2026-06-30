import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { CreateProjectDialog } from "@/components/create-project-dialog";
import { EditProjectDialog } from "@/components/edit-project-dialog";
import { DeleteProjectDialog } from "@/components/delete-project-dialog";
import { SyncSdlcProjectDialog } from "@/components/sync-sdlc-project-dialog";
import { AddOrganizationDialog } from "@/components/add-organization-dialog";
import { GenericModal } from "@/components/ui/generic-modal";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Plus,
  Loader2,
  Search,
  Info,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Pencil,
  Trash2,
  RefreshCw,
  FolderOpen,
  KeyRound,
  LayoutGrid,
  List,
  Copy,
  ChevronLeft,
  ChevronRight,
  UserPlus,
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { useQuery } from "@tanstack/react-query";
import type { SDLCProject } from "@shared/schema";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useLocation, useSearch } from "wouter";
import { useMe } from "@/hooks/use-me";
import { useAdoAllowed, useJiraOnlyWorkItems } from "@/hooks/use-hosting-config";
import { useToast } from "@/hooks/use-toast";
import {
  GLOBAL_ALL_ORGANIZATIONS_ID,
  useSelectedOrganization,
} from "@/contexts/selected-organization-context";

// Component to display issue types for a project
const IssueTypesDisplay = ({ project, compact = false }: { project: ADOProject; compact?: boolean }) => {
  const issueTypesProjectId = project.sdlcProject?.id || "";
  const jiraCredential = project.credentialStatus?.jira;
  const hasProjectManagementPat =
    jiraCredential?.configured ??
    (project.projectManagementPatConfigured === true ||
      project.userJiraPatConfigured === true);
  const shouldLoadIssueTypes =
    project.integrationType === "jira" &&
    !!project.sdlcProject &&
    !!issueTypesProjectId &&
    hasProjectManagementPat;

  const {
    data,
    isLoading,
    isError,
    error,
  } = useQuery<{ success?: boolean; issueTypes?: any[] }>({
    queryKey: ["/api/jira/projects", issueTypesProjectId, "issue-types"],
    queryFn: async () => {
      const response = await fetch(`/api/jira/projects/${encodeURIComponent(issueTypesProjectId)}/issue-types`, {
        credentials: "include",
      });
      if (!response.ok) throw new Error("Failed to fetch issue types");
      return response.json();
    },
    enabled: shouldLoadIssueTypes,
    staleTime: 10 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const issueTypes = data?.success && Array.isArray(data.issueTypes) ? data.issueTypes : [];
  const visibleIssueTypeCount = compact ? 2 : 3;
  const cellClassName = compact
    ? "flex min-h-6 min-w-0 items-center"
    : "flex min-h-12 w-44 items-center";

  if (project.integrationType !== "jira") {
    return (
      <div className={cellClassName}>
        <span className="text-xs text-muted-foreground">N/A (ADO)</span>
      </div>
    );
  }

  if (!project.sdlcProject) {
    return (
      <div className={cellClassName}>
        <span className="text-xs text-muted-foreground" title="Sync this project to load issue types">
          Available after sync
        </span>
      </div>
    );
  }

  if (!hasProjectManagementPat) {
    return (
      <div className={cellClassName}>
        <span className="text-xs text-muted-foreground" title="Connect and validate your personal Jira API key to load issue types">
          Connect Jira PAT
        </span>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className={cellClassName}>
        <div className={compact ? "flex gap-1.5" : "flex flex-col gap-1.5"}>
          <Skeleton className="h-4 w-12 rounded-md" />
          <Skeleton className="h-4 w-14 rounded-md" />
          {!compact && <Skeleton className="h-5 w-14 rounded-md" />}
        </div>
      </div>
    );
  }

  if (isError) {
    const message = error instanceof Error ? error.message : "Failed to load issue types";
    return (
      <div className={cellClassName}>
        <span className="text-xs text-red-500" title={message}>Error</span>
      </div>
    );
  }

  if (!issueTypes.length) {
    return (
      <div className={cellClassName}>
        <span className="text-xs text-muted-foreground">No types</span>
      </div>
    );
  }

  return (
    <div className={`${cellClassName} flex-nowrap gap-1 overflow-hidden`}>
      {issueTypes.slice(0, visibleIssueTypeCount).map((type) => (
        <Badge
          key={type.id}
          variant="outline"
          className={`${compact ? "h-5 max-w-20 px-2 text-[10px]" : "h-4 text-[10px]"} truncate py-0 bg-blue-50 text-blue-600 border-blue-200 dark:bg-blue-900/20 dark:text-blue-400 dark:border-blue-800`}
          title={`${type.name} (Level: ${type.hierarchyLevel ?? 'N/A'})`}
        >
          {type.name}
        </Badge>
      ))}
      {issueTypes.length > visibleIssueTypeCount && (
        <Popover>
          <PopoverTrigger asChild>
            <Badge
              variant="outline"
              className={`${compact ? "h-5 px-2" : "h-4"} text-[10px] py-0 cursor-pointer bg-muted text-muted-foreground hover:bg-muted/80 transition-colors`}
              title="Click to view all issue types"
            >
              +{issueTypes.length - visibleIssueTypeCount}
            </Badge>
          </PopoverTrigger>
          <PopoverContent
            className="w-72 p-4 shadow-lg border-border/50 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80"
            align="start"
            sideOffset={8}
          >
            <div className="flex flex-col gap-3">
              <div className="space-y-1 border-b border-border/50 pb-3">
                <h4 className="text-sm font-semibold leading-none tracking-tight">Available Issue Types</h4>
                <p className="text-xs text-muted-foreground">All configured Jira issue types natively fetched for this project.</p>
              </div>
              <div className="flex flex-wrap gap-1.5 pt-1">
                {issueTypes.map((type) => (
                  <Badge
                    key={type.id}
                    variant="outline"
                    className="text-[11px] font-medium py-0.5 px-2.5 h-auto bg-blue-50/50 text-blue-700 border-blue-200/60 dark:bg-blue-900/20 dark:text-blue-400 dark:border-blue-800/60"
                    title={`Level: ${type.hierarchyLevel ?? 'N/A'}`}
                  >
                    {type.name}
                  </Badge>
                ))}
              </div>
            </div>
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
};

interface Organization {
  id: string;
  projectName: string;
  organizationUrl: string;
  integrationType?: string;
}

const formatOrganizationLabel = (org: any): string => {
  if (!org || !org.organizationUrl) {
    return "No organization found";
  }

  if (org.integrationType === "jira") {
    return org.projectName || org.organizationUrl;
  }

  // Extract the part after 'https://dev.azure.com/'
  const orgName = org.organizationUrl
    .replace(/^https?:\/\/dev\.azure\.com\//i, "") // Remove base URL
    .replace(/\/$/, ""); // Remove trailing slash if any

  return orgName || "No organization found";
};

const formatOrganizationDisplay = (project: ADOProject): string => {
  const raw = project.organization || project.organizationUrl || "";
  if (!raw) return "Unknown Organization";

  // For URLs, extract just the hostname for cleaner display
  try {
    const url = new URL(raw.startsWith("http") ? raw : `https://${raw}`);
    return url.hostname;
  } catch {
    return raw.replace(/^https?:\/\//, "").replace(/\/+$/, "");
  }
};

const formatIntegrationProviderLabel = (provider?: string | null): string => {
  const normalized = String(provider || "").toLowerCase();
  if (normalized === "github") return "GitHub";
  if (normalized === "gitlab") return "GitLab";
  if (normalized === "bitbucket") return "Bitbucket";
  if (normalized === "azure_repos" || normalized === "ado") return "Azure Repos";
  return provider || "Repository";
};

const normalizeRepoBaseUrl = (provider?: string | null, baseUrl?: string | null): string => {
  const normalizedProvider = String(provider || "").toLowerCase();
  const trimmedBaseUrl = String(baseUrl || "").trim().replace(/\/+$/, "");

  if (normalizedProvider === "github") {
    if (!trimmedBaseUrl || trimmedBaseUrl === "https://api.github.com") return "https://github.com";
    return trimmedBaseUrl.replace(/\/api\/v3$/i, "");
  }

  if (normalizedProvider === "gitlab") {
    return (trimmedBaseUrl || "https://gitlab.com").replace(/\/api\/v4$/i, "");
  }

  if (normalizedProvider === "bitbucket") {
    return trimmedBaseUrl || "https://bitbucket.org";
  }

  return trimmedBaseUrl;
};

const buildRepositoryLink = (config?: ADOProject["repoIntegrationConfig"] | null): string => {
  if (!config) return "";

  const provider = config.providerKey || "";
  const baseUrl = normalizeRepoBaseUrl(provider, config.baseUrl);
  const repositoryPath = (config.repositoryName || config.repositoryId || "").trim().replace(/^\/+/, "");

  if (!baseUrl || !repositoryPath) return "";
  if (/^https?:\/\//i.test(repositoryPath)) return repositoryPath;

  return `${baseUrl}/${repositoryPath}`.replace(/([^:]\/)\/+/g, "$1");
};

interface ADOProject {
  id: string;
  name: string;
  description: string;
  organization: string;
  organizationUrl: string;
  createdDate?: string;
  sdlcProject?: SDLCProject | null;
  projectManagementPatConfigured?: boolean;
  repoPatRequired?: boolean;
  repoPatConfigured?: boolean;
  userJiraPatConfigured?: boolean;
  userGitlabPatConfigured?: boolean;
  userPatConfigured?: boolean;
  credentialStatus?: {
    jira?: { required?: boolean; configured?: boolean };
    repo?: { required?: boolean; configured?: boolean };
    readyForUser?: boolean;
  };
  artifactOrgId?: string;
  integrationType?: string;
  jiraProjectKey?: string;
  jiraConnectionId?: string;
  jiraInstanceUrl?: string;
  ownerUserId?: string | null;
  isOwner?: boolean;
  currentUserRole?: "owner" | "member" | string | null;
  ownerInfo?: {
    id: string;
    email?: string | null;
    displayName?: string | null;
  } | null;
  linkedGoldenRepoOrg?: string | null;
  linkedGoldenRepoProject?: string | null;
  linkedGoldenRepoName?: string | null;
  goldenRepoReference?: any;
  repoIntegrationConfig?: {
    providerKey?: string | null;
    displayName?: string | null;
    baseUrl?: string | null;
    repositoryId?: string | null;
    repositoryName?: string | null;
  } | null;
}

interface ProjectsApiResponse {
  projects: ADOProject[];
  error?: string;
  details?: string;
  message?: string;
  code?: string;
  action?: string;
  selectedOrgId?: string;
  selectedOrganization?: {
    sourceType?: string;
    name?: string;
    setupUrl?: string;
  };
  links?: Array<{
    label: string;
    href: string;
  }>;
  // Human-readable warning messages from the server, one per organization that failed
  warnings?: string[];
  page?: number;
  limit?: number;
  total?: number;
  totalUnfiltered?: number;
  totalPages?: number;
  hasMore?: boolean;
}

function hasProjectRepositoryMapping(project: ADOProject): boolean {
  const metadata = project.sdlcProject || project;
  return Boolean(
    project.repoIntegrationConfig?.repositoryId ||
      project.repoIntegrationConfig?.repositoryName ||
      (metadata as any).repositoryId ||
      (metadata as any).repository_id ||
      metadata.linkedGoldenRepoName ||
      metadata.linkedGoldenRepoProject ||
      metadata.goldenRepoReference,
  );
}

function inferProjectRepositoryProvider(project: ADOProject): string | null {
  const explicitProvider =
    project.repoIntegrationConfig?.providerKey?.trim() ||
    project.sdlcProject?.goldenRepoReference?.provider ||
    project.goldenRepoReference?.provider;
  if (explicitProvider) return explicitProvider;
  if (!hasProjectRepositoryMapping(project)) return null;

  const providerHint = `${project.repoIntegrationConfig?.displayName || ""} ${project.repoIntegrationConfig?.baseUrl || ""}`.toLowerCase();
  if (providerHint.includes("gitlab")) return "gitlab";
  if (providerHint.includes("github")) return "github";
  if (providerHint.includes("bitbucket")) return "bitbucket";
  if (providerHint.includes("azure") || providerHint.includes("dev.azure.com")) return "azure_repos";
  return "gitlab";
}

function isProjectManagementCredentialRequired(project: ADOProject): boolean {
  return project.credentialStatus?.jira?.required ?? Boolean(project.jiraInstanceUrl || project.sdlcProject?.jiraInstanceUrl);
}

function isProjectManagementCredentialConfigured(project: ADOProject): boolean {
  return project.credentialStatus?.jira?.configured ?? project.userJiraPatConfigured === true;
}

function isRepositoryCredentialConfigured(project: ADOProject): boolean {
  return project.credentialStatus?.repo?.configured ?? project.userGitlabPatConfigured === true;
}

type SortField = "name" | "organization" | "status" | "projectKey";
type SortDirection = "asc" | "desc";
type SyncFilter = "all" | "synced" | "unsynced";
type OwnershipFilter = "all" | "owner" | "member";
type ViewMode = "table" | "cards";
type ProjectCardDetail = {
  label: string;
  value: string;
  href?: string;
};

export default function Projects() {
  const [, setLocation] = useLocation();
  const search = useSearch();
  const { data: me } = useMe();
  const { toast } = useToast();
  const { selectedOrganization: globalSelectedOrganization, setSelectedOrganizationId, organizations: globalContextOrganizations } =
    useSelectedOrganization();
  const canCreateProject = me?.canCreateProject ?? false;
  const adoAllowed = useAdoAllowed();
  const jiraOnly = useJiraOnlyWorkItems();
  const integrationName = jiraOnly ? "Jira" : "Azure DevOps";
  const params = new URLSearchParams(search);
  const urlOrgId = params.get("orgId");
  const fromGoldenRepo = params.get("fromGoldenRepo") === "true";
  const createProject = params.get("create") === "true";
  const initialSearchQuery = params.get("search") || "";
  const goldenRepoId = params.get("repoId");
  const goldenRepoName = params.get("repoName");
  const goldenOrgId = params.get("orgId");
  const goldenOrgName = params.get("orgName");
  const goldenOrgUrl = params.get("orgUrl");

  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [syncDialogOpen, setSyncDialogOpen] = useState(false);
  const [inviteDialogOpen, setInviteDialogOpen] = useState(false);
  const [jiraInviteDialogOpen, setJiraInviteDialogOpen] = useState(false);
  const [inviteUserId, setInviteUserId] = useState("");
  const [inviteProject, setInviteProject] = useState<ADOProject | null>(null);
  const [jiraInviteProject, setJiraInviteProject] = useState<ADOProject | null>(null);
  const [inviteSubmitting, setInviteSubmitting] = useState(false);
  const [selectedProject, setSelectedProject] = useState<ADOProject | null>(
    null
  );
  const [syncProject, setSyncProject] = useState<ADOProject | null>(null);
  const [editInitialStep, setEditInitialStep] = useState(0);
  const [editAttentionMessage, setEditAttentionMessage] = useState<string | null>(null);
  const [editCredentialOnlyMode, setEditCredentialOnlyMode] = useState(false);
  const [displayedProjects, setDisplayedProjects] = useState<ADOProject[]>([]);
  const [allProjects, setAllProjects] = useState<ADOProject[]>([]);
  const [searchQuery, setSearchQuery] = useState(initialSearchQuery);
  const [syncFilter, setSyncFilter] = useState<SyncFilter>("all");
  const [ownershipFilter, setOwnershipFilter] = useState<OwnershipFilter>("all");
  const [sortField, setSortField] = useState<SortField>("name");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const [viewMode, setViewMode] = useState<ViewMode>("cards");
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState("");
  const [storedGoldenRepoId, setStoredGoldenRepoId] = useState<string | null>(
    null
  );
  const [storedGoldenRepoName, setStoredGoldenRepoName] = useState<
    string | null
  >(null);
  const isGlobalAllOrganizations =
    globalSelectedOrganization?.id === GLOBAL_ALL_ORGANIZATIONS_ID;

  // Track if dialog has been opened to prevent duplicate opens
  const dialogOpenedRef = useRef(false);
  const previousPaginationFilterRef = useRef<string>("");

  useEffect(() => {
    const handle = window.setTimeout(() => {
      setDebouncedSearchQuery(searchQuery.trim());
    }, 250);
    return () => window.clearTimeout(handle);
  }, [searchQuery]);

  // Fetch all artifact organizations from database (settings API)
  const { data: adoOrgsData } = useQuery<{
    organizations: Organization[];
  }>({
    queryKey: ["/api/artifact-organizations"],
    enabled: adoAllowed,
  });

  // Fetch Jira Connections
  const { data: jiraConnsData } = useQuery<{
    connections: any[];
  }>({
    queryKey: ["/api/jira/connections"],
  });

  // Compute unified organizations list
  const organizations: Organization[] = useMemo(() => {
    const adoOrgs = adoOrgsData?.organizations || [];
    const jiraConns = (jiraConnsData?.connections || []).map(conn => ({
      id: conn.id,
      projectName: conn.name,
      organizationUrl: conn.instanceUrl,
      integrationType: "jira"
    }));
    return [...adoOrgs, ...jiraConns];
  }, [adoOrgsData, jiraConnsData]);

  const jiraInviteConnection = useMemo(() => {
    if (!jiraInviteProject) return null;
    const connectionId = jiraInviteProject.jiraConnectionId || jiraInviteProject.sdlcProject?.jiraConnectionId;
    if (!connectionId) return null;

    const connection = (jiraConnsData?.connections || []).find((conn) => conn.id === connectionId);
    return {
      id: connectionId,
      name: connection?.name || jiraInviteProject.organization || "Jira",
      organizationUrl:
        connection?.instanceUrl ||
        jiraInviteProject.jiraInstanceUrl ||
        jiraInviteProject.organizationUrl ||
        "",
      email: connection?.email || "",
    };
  }, [jiraConnsData?.connections, jiraInviteProject]);

  const urlOrgExistsInGlobalSelector = useMemo(
    () =>
      !!urlOrgId &&
      globalContextOrganizations.some((organization) => organization.id === urlOrgId),
    [globalContextOrganizations, urlOrgId]
  );

  useEffect(() => {
    if (
      urlOrgId &&
      urlOrgExistsInGlobalSelector &&
      globalSelectedOrganization?.id !== urlOrgId
    ) {
      setSelectedOrganizationId(urlOrgId);
    }
  }, [
    urlOrgId,
    urlOrgExistsInGlobalSelector,
    globalSelectedOrganization?.id,
    setSelectedOrganizationId,
  ]);

  // Derive selectedOrg from the global header organization selector
  const selectedOrg = useMemo(() => {
    if (urlOrgId) return urlOrgId;
    if (!globalSelectedOrganization) return "all";
    if (isGlobalAllOrganizations) return "all";
    return globalSelectedOrganization.id;
  }, [urlOrgId, globalSelectedOrganization?.id, isGlobalAllOrganizations]);

  const selectedOrgDetails = useMemo(() => {
    if (selectedOrg === "all" || selectedOrg === "") return null;
    const matchedOrganization = organizations.find((org) => org.id === selectedOrg);
    if (matchedOrganization) return matchedOrganization;
    if (globalSelectedOrganization && globalSelectedOrganization.id === selectedOrg) {
      return {
        id: globalSelectedOrganization.id,
        projectName: globalSelectedOrganization.name,
        organizationUrl: globalSelectedOrganization.description || "",
        integrationType: globalSelectedOrganization.sourceType === "all"
          ? undefined
          : globalSelectedOrganization.sourceType,
      };
    }
    return null;
  }, [selectedOrg, organizations, globalSelectedOrganization]);

  // Store golden repo values from URL params
  useEffect(() => {
    if ((fromGoldenRepo || createProject) && goldenRepoId && !storedGoldenRepoId) {
      setStoredGoldenRepoId(goldenRepoId);
    }
    if ((fromGoldenRepo || createProject) && goldenRepoName && !storedGoldenRepoName) {
      setStoredGoldenRepoName(goldenRepoName);
    }
  }, [fromGoldenRepo, createProject, goldenRepoId, goldenRepoName, storedGoldenRepoId, storedGoldenRepoName]);

  // Auto-open create dialog when coming from golden repo or create param (only if user has permission)
  useEffect(() => {
    if ((fromGoldenRepo || createProject) && canCreateProject && !dialogOpenedRef.current) {
      // Mark as opened to prevent duplicate triggers
      dialogOpenedRef.current = true;

      // Open the create dialog (golden repo values are already stored by previous effect)
      setCreateDialogOpen(true);

      // Clear the URL params immediately to prevent re-triggering
      if (typeof window !== "undefined") {
        const newUrl = window.location.pathname;
        window.history.replaceState({}, "", newUrl);
      }
    }
  }, [fromGoldenRepo, createProject, canCreateProject]);

  // Reset dialog opened flag when dialog closes
  useEffect(() => {
    if (!createDialogOpen) {
      dialogOpenedRef.current = false;
    }
  }, [createDialogOpen]);


  // 1. Fetch ADO projects (live API)
  const buildProjectsQueryKey = (selectedOrg: string): string | null => {
    const params = new URLSearchParams({
      org: !selectedOrg || selectedOrg === "__all__" ? "all" : selectedOrg,
      paginated: "true",
      page: String(currentPage),
      limit: String(pageSize),
      sortBy: sortField,
      sortDirection,
      syncStatus: syncFilter,
      ownership: ownershipFilter,
    });
    if (debouncedSearchQuery) params.set("search", debouncedSearchQuery);
    return `/api/ado-projects?${params.toString()}`;
  };

  const projectsKey = buildProjectsQueryKey(selectedOrg);

  const {
    data: projectsResponse,
    isLoading: showSkeletonTable,
    isFetching: showInlineSkeleton,
    isError: isProjectsError,
    error: projectsError,
    refetch: refetchProjects,
  } = useQuery<ProjectsApiResponse>({
    queryKey: [projectsKey ?? "__projects_disabled__"],
    enabled: projectsKey !== null,
    refetchOnWindowFocus: false,
    refetchOnReconnect: true,
    placeholderData: (previousData) => previousData,
  });

  const projectsErrorPayload = useMemo(() => {
    const rawError = projectsError as any;
    return rawError?.response?.data || rawError?.details?.response?.data || rawError;
  }, [projectsError]);

  const projectsErrorCode =
    typeof projectsErrorPayload?.code === "string"
      ? projectsErrorPayload.code
      : typeof (projectsError as any)?.code === "string"
        ? (projectsError as any).code
        : undefined;
  const isSelectedJiraCredentialError =
    selectedOrgDetails?.integrationType === "jira" &&
    (projectsErrorCode === "JIRA_PAT_MISSING" ||
      projectsErrorCode === "JIRA_PAT_INVALID");
  const isOrganizationResolutionError =
    projectsErrorCode === "ORGANIZATION_NOT_FOUND" ||
    projectsErrorCode === "ORGANIZATION_NOT_ACCESSIBLE";
  const selectedJiraInstanceUrl = selectedOrgDetails?.organizationUrl || "";
  const connectJiraForSelectedOrg = () => {
    const params = new URLSearchParams();
    if (selectedJiraInstanceUrl) params.set("instanceUrl", selectedJiraInstanceUrl);
    if (selectedOrgDetails?.projectName) {
      params.set("organizationName", selectedOrgDetails.projectName);
    }
    if (typeof window !== "undefined") {
      params.set("returnTo", `${window.location.pathname}${window.location.search}`);
    }
    setLocation(`/connect-jira?${params.toString()}`);
  };

  const paginationFilterSignature = useMemo(
    () =>
      JSON.stringify({
        debouncedSearchQuery,
        syncFilter,
        ownershipFilter,
        sortField,
        sortDirection,
        pageSize,
        selectedOrg,
      }),
    [
      debouncedSearchQuery,
      syncFilter,
      ownershipFilter,
      pageSize,
      selectedOrg,
      sortDirection,
      sortField,
    ],
  );

  useEffect(() => {
    if (!previousPaginationFilterRef.current) {
      previousPaginationFilterRef.current = paginationFilterSignature;
      return;
    }
    if (previousPaginationFilterRef.current === paginationFilterSignature) {
      return;
    }
    previousPaginationFilterRef.current = paginationFilterSignature;
    setCurrentPage(1);
  }, [paginationFilterSignature]);

  const adoWarnings: string[] =
    selectedOrg === "all" ? (projectsResponse?.warnings ?? []) : [];

  const projects: ADOProject[] = useMemo(() => {
    return projectsResponse?.projects || [];
  }, [projectsResponse]);

  const isProjectSynced = useCallback(
    (project: ADOProject) => {
      if (!project.sdlcProject) return false;
      const jiraReady =
        !isProjectManagementCredentialRequired(project) ||
        isProjectManagementCredentialConfigured(project);
      const repoReady =
        !isRepoPatRequired(project) ||
        isRepositoryCredentialConfigured(project);
      const readyForUser =
        (project.credentialStatus?.readyForUser ?? project.userPatConfigured) === true;
      return readyForUser && jiraReady && repoReady;
    },
    [],
  );
  const isProjectOwner = useCallback(
    (project: ADOProject) => {
      if (typeof project.isOwner === "boolean") return project.isOwner;
      if (project.currentUserRole === "owner") return true;
      const ownerUserId = project.ownerUserId || project.sdlcProject?.ownerUserId;
      return !ownerUserId || ownerUserId === me?.user?.id;
    },
    [me?.user?.id],
  );
  const isRepoPatRequired = useCallback(
    (project: ADOProject) => {
      const inferredProvider = inferProjectRepositoryProvider(project);
      const inferredRequired = Boolean(
        hasProjectRepositoryMapping(project) &&
          inferredProvider,
      );
      const explicitRequired = project.credentialStatus?.repo?.required ?? project.repoPatRequired;
      return typeof explicitRequired === "boolean" ? explicitRequired : inferredRequired;
    },
    [],
  );
  const isRepoPatConfigured = useCallback(
    (project: ADOProject) => isRepositoryCredentialConfigured(project),
    [],
  );
  const shouldPromptForRepoPat = useCallback(
    (project: ADOProject) =>
      !!project.sdlcProject &&
      isRepoPatRequired(project) &&
      !isRepoPatConfigured(project),
    [isRepoPatConfigured, isRepoPatRequired],
  );

  const personalPatPrompt =
    "Configure and validate your own project management and repository provider credentials. This project is marked synced only after both personal credentials are tested successfully.";

  // Filter and sort projects
  const filteredAndSortedProjects = useMemo(() => {
    return projects;
  }, [projects]);
  const totalProjectsCount = projectsResponse?.totalUnfiltered ?? projects.length;
  const filteredProjectsCount = projectsResponse?.total ?? projects.length;
  const pageStart = filteredProjectsCount === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const pageEnd = Math.min(currentPage * pageSize, filteredProjectsCount);
  const totalPages = Math.max(1, projectsResponse?.totalPages ?? Math.ceil(filteredProjectsCount / pageSize));
  const canGoPrevious = currentPage > 1 && !showInlineSkeleton;
  const canGoNext = currentPage < totalPages && !showInlineSkeleton;
  const paginatedProjects = projects;
  const projectsEmptyTitle =
    projectsResponse?.error || projectsResponse?.message || "";
  const projectsEmptyDetails = projectsResponse?.details || "";

  useEffect(() => {
    if (!projectsResponse || showInlineSkeleton) {
      return;
    }
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, projectsResponse, showInlineSkeleton, totalPages]);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      // Toggle direction if same field
      setSortDirection(sortDirection === "asc" ? "desc" : "asc");
    } else {
      // Set new field with ascending direction
      setSortField(field);
      setSortDirection("asc");
    }
  };

  const getSortIcon = (field: SortField) => {
    if (sortField !== field) {
      return <ArrowUpDown className="h-4 w-4 ml-1 text-muted-foreground" />;
    }
    return sortDirection === "asc" ? (
      <ArrowUp className="h-4 w-4 ml-1" />
    ) : (
      <ArrowDown className="h-4 w-4 ml-1" />
    );
  };

  const getProjectRecordId = (project: ADOProject) =>
    project.sdlcProject?.id || project.id;

  const normalizeProjectForSdlcActions = (project: ADOProject): ADOProject =>
    project.sdlcProject ? { ...project, id: project.sdlcProject.id } : project;

  const handleProjectClick = (project: ADOProject) => {
    if (!isProjectSynced(project)) {
      if (project.sdlcProject) {
        handleEditProject(project, {
          initialStep: 2,
          attentionMessage: personalPatPrompt,
          credentialOnlyMode: true,
        });
      } else {
        setSyncProject(project);
        setSyncDialogOpen(true);
      }
      return;
    }

    // Try to update global organization selector
    const organizationId = project.jiraConnectionId || (project as any).artifactOrgId;
    let organizationName = project.organization || "";
    if (organizationId) {
      setSelectedOrganizationId(organizationId);
      const matchingOrg = globalContextOrganizations.find((o) => o.id === organizationId);
      organizationName = matchingOrg?.name || organizationName;
    } else {
      const matchingOrg = globalContextOrganizations.find(
        (o) => o.name.toLowerCase() === (project.organization || "").toLowerCase()
      );
      if (matchingOrg) {
        setSelectedOrganizationId(matchingOrg.id);
        organizationName = matchingOrg.name;
      }
    }

    const projectIdParam =
      getProjectRecordId(project) || project.name.toLowerCase().replace(/\s+/g, "-");
    const params = new URLSearchParams();
    params.set("projectId", projectIdParam);
    params.set("projectName", project.name);
    if (organizationId) {
      params.set("orgId", organizationId);
    }
    if (organizationName) {
      params.set("organizationName", organizationName);
    }
    if (project.organizationUrl) {
      params.set("organizationUrl", project.organizationUrl);
    }
    if (project.integrationType) {
      params.set("integrationType", project.integrationType);
    }
    setLocation(`/sdlc?${params.toString()}`);
  };

  // Show loader only in the projects section instead of replacing the whole page
  // Include both React Query loading states and our manual fetch state
  const projectsSectionLoading = showSkeletonTable || showInlineSkeleton;

  const invalidateAdoProjects = useCallback(() => {
    queryClient.invalidateQueries({
      predicate: (query) =>
        typeof query.queryKey?.[0] === "string" &&
        ((query.queryKey[0] as string).startsWith("/api/ado-projects") ||
         (query.queryKey[0] as string).startsWith("/api/sdlc/projects")),
    });
    queryClient.refetchQueries({
      predicate: (query) =>
        typeof query.queryKey?.[0] === "string" &&
        ((query.queryKey[0] as string).startsWith("/api/ado-projects") ||
         (query.queryKey[0] as string).startsWith("/api/sdlc/projects")),
    });
  }, []);

  const handleProjectCreated = useCallback(
    (organizationId?: string | null) => {
      setTimeout(() => {
        invalidateAdoProjects();
      }, 5000);
    },
    [invalidateAdoProjects]
  );

  const handleProjectUpdated = useCallback(
    (updatedProject?: { id: string; name: string; description: string }) => {
      // Optimistically update local state if project data is provided
      if (updatedProject) {
        setAllProjects((prev) =>
          prev.map((p) =>
            p.id === updatedProject.id
              ? {
                ...p,
                name: updatedProject.name,
                description: updatedProject.description,
              }
              : p
          )
        );
        setDisplayedProjects((prev) =>
          prev.map((p) =>
            p.id === updatedProject.id
              ? {
                ...p,
                name: updatedProject.name,
                description: updatedProject.description,
              }
              : p
          )
        );
      }

      // Immediately invalidate and refetch projects to reflect changes
      invalidateAdoProjects();
    },
    [invalidateAdoProjects]
  );

  const handleProjectDeleted = useCallback(() => {
    // Immediately invalidate and refetch projects to reflect deletion
    invalidateAdoProjects();
  }, [invalidateAdoProjects]);



  const handleEditProject = (
    project: ADOProject,
    options?: {
      initialStep?: number;
      attentionMessage?: string | null;
      credentialOnlyMode?: boolean;
    },
  ) => {
    setEditInitialStep(options?.initialStep ?? 0);
    setEditAttentionMessage(options?.attentionMessage ?? null);
    setEditCredentialOnlyMode(options?.credentialOnlyMode ?? false);
    setSelectedProject(normalizeProjectForSdlcActions(project));
    setEditDialogOpen(true);
  };

  const handleDeleteProject = (project: ADOProject) => {
    setSelectedProject(normalizeProjectForSdlcActions(project));
    setDeleteDialogOpen(true);
  };

  const handleInviteProjectMember = (project: ADOProject) => {
    const normalizedProject = normalizeProjectForSdlcActions(project);
    const jiraConnectionId = normalizedProject.jiraConnectionId || normalizedProject.sdlcProject?.jiraConnectionId;
    if (normalizedProject.integrationType === "jira" && jiraConnectionId) {
      setJiraInviteProject(normalizedProject);
      setJiraInviteDialogOpen(true);
      return;
    }

    setInviteProject(normalizedProject);
    setInviteUserId("");
    setInviteDialogOpen(true);
  };

  const {
    data: availableProjectMembersData,
    isLoading: availableProjectMembersLoading,
    isError: availableProjectMembersError,
  } = useQuery<{
    users: Array<{ userId: string; displayName: string; email: string; isOwner?: boolean; isMember?: boolean }>;
  }>({
    queryKey: ["/api/sdlc/projects", inviteProject?.id, "available-members"],
    enabled: inviteDialogOpen && !!inviteProject?.id,
    queryFn: async () => {
      const response = await apiRequest("GET", `/api/sdlc/projects/${inviteProject!.id}/available-members`);
      return response.json();
    },
  });
  const availableProjectMembers = availableProjectMembersData?.users ?? [];
  const selectableProjectMembers = availableProjectMembers.filter((user) => !user.isOwner && !user.isMember);

  const submitProjectInvite = useCallback(async () => {
    const userId = inviteUserId.trim();
    const projectId = inviteProject?.id;
    if (!projectId || !userId) {
      toast({
        title: "Invite member",
        description: "Select a system user to add.",
        variant: "destructive",
      });
      return;
    }

    const selectedUser = availableProjectMembers.find((user) => user.userId === userId);
    setInviteSubmitting(true);
    try {
      await apiRequest("POST", `/api/sdlc/projects/${projectId}/members`, { userId });
      toast({
        title: "Member added",
        description: `${selectedUser?.displayName || selectedUser?.email || "The selected user"} can now see this project and configure personal tokens.`,
      });
      setInviteDialogOpen(false);
      setInviteProject(null);
      setInviteUserId("");
      invalidateAdoProjects();
    } catch (error) {
      toast({
        title: "Member add failed",
        description: error instanceof Error ? error.message : "Could not add project member.",
        variant: "destructive",
      });
    } finally {
      setInviteSubmitting(false);
    }
  }, [availableProjectMembers, inviteProject?.id, inviteUserId, invalidateAdoProjects, toast]);

  const handleCopyProjectId = useCallback(
    async (projectId: string) => {
      try {
        await navigator.clipboard.writeText(projectId);
        toast({
          title: "Copied",
          description: "Project ID copied to clipboard.",
        });
      } catch {
        toast({
          title: "Copy failed",
          description: "Could not copy the project ID.",
          variant: "destructive",
        });
      }
    },
    [toast],
  );

  const renderProjectActions = (project: ADOProject, surface: "table" | "card") => {
    const iconSizeClass = surface === "table" ? "h-8 w-8" : "h-9 w-9";
    const owner = isProjectOwner(project);
    const synced = isProjectSynced(project);
    const credentialOnlyOptions = {
      initialStep: 2,
      attentionMessage: owner
        ? personalPatPrompt
        : "Project members can update only their personal PAT/API tokens for configured integrations. Project metadata is managed by the owner.",
      credentialOnlyMode: true,
    };

    return (
      <>
        {project.sdlcProject ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                onClick={() =>
                  handleEditProject(
                    project,
                    owner && synced ? undefined : credentialOnlyOptions,
                  )
                }
                className={`${iconSizeClass} text-blue-600 hover:text-blue-700 hover:bg-blue-50 dark:hover:bg-blue-950/20 dark:text-blue-400`}
                data-testid={`button-edit-project-${project.name
                  .toLowerCase()
                  .replace(/\s+/g, "-")}`}
              >
                <Pencil className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>{owner ? "Edit Project" : "Update personal tokens"}</p>
            </TooltipContent>
          </Tooltip>
        ) : (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setSyncProject(project);
                  setSyncDialogOpen(true);
                }}
                className="text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50 dark:hover:bg-emerald-950/20 dark:text-emerald-400"
                data-testid={`button-sync-project-${project.name
                  .toLowerCase()
                  .replace(/\s+/g, "-")}`}
              >
                <RefreshCw className="h-4 w-4 mr-2" />
                Sync
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>{`Sync SDLC Project from ${integrationName}`}</p>
            </TooltipContent>
          </Tooltip>
        )}

        {owner && project.sdlcProject && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => handleInviteProjectMember(project)}
                className={`${iconSizeClass} text-violet-600 hover:text-violet-700 hover:bg-violet-50 dark:hover:bg-violet-950/20 dark:text-violet-400`}
                data-testid={`button-invite-project-member-${project.name
                  .toLowerCase()
                  .replace(/\s+/g, "-")}`}
              >
                <UserPlus className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>Invite member</p>
            </TooltipContent>
          </Tooltip>
        )}

        {owner && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => handleDeleteProject(project)}
                className={`${iconSizeClass} text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950/20 dark:text-red-400`}
                data-testid={`button-delete-project-${project.name
                  .toLowerCase()
                  .replace(/\s+/g, "-")}`}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>Delete Project</p>
            </TooltipContent>
          </Tooltip>
        )}
      </>
    );
  };

  const handleProjectSynced = useCallback(() => {
    invalidateAdoProjects();
    refetchProjects?.();
  }, [invalidateAdoProjects, refetchProjects]);

  return (
    <div className="flex-1 space-y-6 p-6">
      <PageHeader
        icon={FolderOpen}
        title="Projects"
        subtitle="View and manage all your projects across different platforms"
        color="violet"
      >
        <div className="flex gap-2">
          {canCreateProject && (
            <Button
              onClick={() => setCreateDialogOpen(true)}
              data-testid="button-create-project"
            >
              <Plus className="h-4 w-4 mr-2" />
              Create Project
            </Button>
          )}
        </div>
      </PageHeader>
      {/* Filters */}
      <div className="grid grid-cols-1 gap-3 rounded-lg border bg-card p-4 shadow-sm md:grid-cols-[minmax(0,1fr)_160px_150px_120px_auto]">
        <div className="space-y-2">
          <Label htmlFor="project-search">Search projects</Label>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="project-search"
              placeholder="Project name or organization"
              className="h-10 border-border pl-10"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              data-testid="input-search-projects"
            />
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="project-sync-filter">Sync status</Label>
          <Select value={syncFilter} onValueChange={(value) => setSyncFilter(value as SyncFilter)}>
            <SelectTrigger id="project-sync-filter" className="h-10 w-full" data-testid="select-project-sync-filter">
              <SelectValue placeholder="Sync status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All sync states</SelectItem>
              <SelectItem value="synced">Synced</SelectItem>
              <SelectItem value="unsynced">Unsynced</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="project-ownership-filter">Role</Label>
          <Select value={ownershipFilter} onValueChange={(value) => setOwnershipFilter(value as OwnershipFilter)}>
            <SelectTrigger id="project-ownership-filter" className="h-10 w-full" data-testid="select-project-ownership-filter">
              <SelectValue placeholder="Role" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All roles</SelectItem>
              <SelectItem value="owner">Owner</SelectItem>
              <SelectItem value="member">Member</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>Results</Label>
          <div
            className="flex h-10 items-center rounded-md border border-border bg-background px-3 text-sm"
            aria-live="polite"
            data-testid="projects-filter-result-count"
          >
            <span className="font-semibold text-foreground">
              {filteredProjectsCount}
            </span>
            <span className="mx-1 text-muted-foreground">/</span>
            <span className="text-muted-foreground">{totalProjectsCount}</span>
          </div>
        </div>
        <div className="hidden space-y-2 md:block">
          <Label>View</Label>
          <div className="flex h-10 items-center rounded-md border border-border bg-background p-1">
            <Button
              type="button"
              variant={viewMode === "cards" ? "secondary" : "ghost"}
              size="icon"
              className="h-8 w-8"
              aria-label="Show card view"
              onClick={() => setViewMode("cards")}
              data-testid="button-projects-card-view"
            >
              <LayoutGrid className="h-4 w-4" />
            </Button>
            <Button
              type="button"
              variant={viewMode === "table" ? "secondary" : "ghost"}
              size="icon"
              className="h-8 w-8"
              aria-label="Show table view"
              onClick={() => setViewMode("table")}
              data-testid="button-projects-table-view"
            >
              <List className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>
      <div className="flex flex-col gap-3 rounded-lg border bg-card p-3 shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <div className="text-sm text-muted-foreground" aria-live="polite">
          Showing{" "}
          <span className="font-semibold text-foreground">{pageStart}</span>
          {"-"}
          <span className="font-semibold text-foreground">{pageEnd}</span>
          {" of "}
          <span className="font-semibold text-foreground">{filteredProjectsCount}</span>
          {filteredProjectsCount !== totalProjectsCount && (
            <>
              {" filtered from "}
              <span className="font-semibold text-foreground">{totalProjectsCount}</span>
            </>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-2">
            <Label htmlFor="projects-page-size" className="text-xs text-muted-foreground">
              Rows
            </Label>
            <Select
              value={String(pageSize)}
              onValueChange={(value) => setPageSize(Number(value))}
            >
              <SelectTrigger id="projects-page-size" className="h-9 w-20" data-testid="select-projects-page-size">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="10">10</SelectItem>
                <SelectItem value="25">25</SelectItem>
                <SelectItem value="50">50</SelectItem>
                <SelectItem value="100">100</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex h-9 items-center rounded-md border border-border bg-background">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              aria-label="Previous projects page"
              disabled={!canGoPrevious}
              onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
              data-testid="button-projects-previous-page"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <div className="min-w-20 px-2 text-center text-sm">
              <span className="font-medium text-foreground">{currentPage}</span>
              <span className="text-muted-foreground"> / {totalPages}</span>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              aria-label="Next projects page"
              disabled={!canGoNext}
              onClick={() => setCurrentPage((page) => Math.min(totalPages, page + 1))}
              data-testid="button-projects-next-page"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>
      {isProjectsError && projectsError && !showInlineSkeleton && (
        isSelectedJiraCredentialError ? (
          <Alert className="border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/20 dark:text-amber-200">
            <KeyRound className="h-4 w-4 text-amber-700 dark:text-amber-400" />
            <AlertTitle>Connect your Jira PAT for this organization</AlertTitle>
            <AlertDescription>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="max-w-3xl">
                  {selectedOrgDetails
                    ? `To list projects from ${formatOrganizationLabel(selectedOrgDetails)}, connect your personal Jira API token for ${selectedJiraInstanceUrl}.`
                    : "Connect your personal Jira API token for the selected Jira organization to list projects."}
                </p>
                <Button
                  type="button"
                  size="sm"
                  onClick={connectJiraForSelectedOrg}
                  className="w-full sm:w-auto"
                >
                  <KeyRound className="h-4 w-4 mr-2" />
                  Connect Jira PAT
                </Button>
              </div>
            </AlertDescription>
          </Alert>
        ) : isOrganizationResolutionError ? (
          <Alert className="border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/20 dark:text-amber-200">
            <Info className="h-4 w-4 text-amber-700 dark:text-amber-400" />
            <AlertTitle>
              {projectsErrorPayload?.error || "Selected organization cannot be loaded"}
            </AlertTitle>
            <AlertDescription>
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div className="space-y-1">
                  <p className="max-w-4xl">
                    {projectsErrorPayload?.message ||
                      "This organization is visible in the selector, but the projects API could not resolve it for your account."}
                  </p>
                  {projectsErrorPayload?.details && (
                    <p className="max-w-4xl text-sm text-amber-800/80 dark:text-amber-200/80">
                      {projectsErrorPayload.details}
                    </p>
                  )}
                </div>
                <div className="flex flex-col gap-2 sm:flex-row">
                  {(projectsErrorPayload?.links || []).map((link: { label: string; href: string }) => (
                    <Button
                      key={`${link.href}-${link.label}`}
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => setLocation(link.href)}
                      className="w-full border-amber-300 bg-white text-amber-900 hover:bg-amber-100 dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-100 dark:hover:bg-amber-900/40 sm:w-auto"
                    >
                      {link.label}
                    </Button>
                  ))}
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => {
                      setSelectedOrganizationId(GLOBAL_ALL_ORGANIZATIONS_ID);
                      setLocation("/projects");
                    }}
                    className="w-full sm:w-auto"
                  >
                    Show all organizations
                  </Button>
                </div>
              </div>
            </AlertDescription>
          </Alert>
        ) : (
          <div className="p-4 rounded-md bg-red-900/10 border border-red-700/20 text-red-700">
            <div className="flex items-center justify-between gap-4">
              <p className="text-sm">
                {projectsErrorPayload?.message ||
                  projectsErrorPayload?.error ||
                  "Failed to load projects for the selected organization. Please check your connection settings or try again."}
              </p>
              <div>
                <Button
                  onClick={() => {
                    if (selectedOrg === "all") {
                      refetchProjects?.();
                    } else {
                      refetchProjects?.();
                    }
                  }}
                  className="h-8"
                >
                  Retry
                </Button>
              </div>
            </div>
          </div>
        )
      )}
      {/* Projects section - show skeleton loading when initially loading */}
      {projectsSectionLoading && projects.length === 0 ? (
        <div>
          {/* Desktop Table Skeleton */}
          <div className="hidden md:block rounded-lg border bg-card shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="border-b bg-muted/30">
                    <TableHead className="font-semibold text-sm px-6 py-4">
                      Project Name
                    </TableHead>
                    <TableHead className="font-semibold text-sm px-6 py-4">
                      Organization
                    </TableHead>
                    <TableHead className="text-right font-semibold text-sm px-6 py-4">
                      Actions
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {Array.from({ length: 5 }).map((_, index) => (
                    <TableRow
                      key={`initial-skeleton-${index}`}
                      className={`border-b ${index % 2 === 0 ? "bg-background" : "bg-muted/20"
                        }`}
                    >
                      <TableCell className="px-6 py-4">
                        <Skeleton className="h-5 w-48" />
                      </TableCell>
                      <TableCell className="px-6 py-4">
                        <Skeleton className="h-5 w-32" />
                      </TableCell>
                      <TableCell className="px-6 py-4">
                        <Skeleton className="h-5 w-24" />
                      </TableCell>
                      <TableCell className="px-6 py-4">
                        <div className="flex items-center justify-end gap-2">
                          <Skeleton className="h-8 w-8 rounded-md" />
                          <Skeleton className="h-8 w-8 rounded-md" />
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>

          {/* Mobile Card Skeleton */}
          <div className="md:hidden space-y-4">
            {Array.from({ length: 5 }).map((_, index) => (
              <div
                key={`initial-skeleton-card-${index}`}
                className="rounded-lg border bg-card shadow-sm p-4 space-y-3"
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0 space-y-2">
                    <Skeleton className="h-5 w-48" />
                    <Skeleton className="h-4 w-32" />
                  </div>
                  <div className="flex items-center gap-2 ml-4">
                    <Skeleton className="h-9 w-9 rounded-md" />
                    <Skeleton className="h-9 w-9 rounded-md" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div>
          {/* Show non-blocking warnings when some organizations failed but others succeeded */}
          {selectedOrg === "all" && adoWarnings.length > 0 && (
            <Alert className="mb-4 bg-amber-50 dark:bg-amber-900/10 border-amber-200 dark:border-amber-700">
              <Info className="h-4 w-4 text-amber-700 dark:text-amber-400" />
              <AlertDescription className="text-amber-800 dark:text-amber-300 text-sm">
                Some organizations could not be loaded. Review the issues below
                (for example: missing, invalid, or expired PAT, or invalid URL):
                <ul className="mt-2 list-disc list-inside space-y-1">
                  {adoWarnings.map((w: string, idx: number) => (
                    <li key={idx}>
                      <span className="text-xs sm:text-sm text-amber-900 dark:text-amber-200">
                        {w}
                      </span>
                    </li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          )}
          {filteredAndSortedProjects.length === 0 &&
            !projectsSectionLoading &&
            !isProjectsError &&
            (projectsEmptyTitle || projectsEmptyDetails) ? (
            <Alert className="bg-blue-50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-800">
              <Info className="h-4 w-4 text-blue-600 dark:text-blue-400" />
              <AlertTitle className="text-blue-900 dark:text-blue-200">
                {projectsEmptyTitle || "No projects available"}
              </AlertTitle>
              {projectsEmptyDetails && (
                <AlertDescription className="text-blue-800 dark:text-blue-300">
                  {projectsEmptyDetails}
                </AlertDescription>
              )}
            </Alert>
          ) : filteredAndSortedProjects.length === 0 &&
            !isProjectsError &&
            (searchQuery.trim() || syncFilter !== "all" || ownershipFilter !== "all" || selectedOrg !== "all") ? (
            <div className="text-center p-12">
              <p className="text-muted-foreground">
                No projects found matching your criteria
              </p>
              <p className="text-sm text-muted-foreground mt-2">
                Try adjusting your search or filters
              </p>
            </div>
          ) : filteredAndSortedProjects.length === 0 &&
            !projectsSectionLoading &&
            !isProjectsError ? (
            <Alert className="bg-blue-50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-800">
              <Info className="h-4 w-4 text-blue-600 dark:text-blue-400" />
              <AlertDescription className="text-blue-800 dark:text-blue-300">
                {selectedOrg === "all"
                  ? "There are no projects in any organization. Create a new project to get started."
                  : selectedOrgDetails
                    ? `There are no projects for the selected organization "${formatOrganizationLabel(
                      selectedOrgDetails
                    )}". Create a new project to get started.`
                    : "There are no projects for the selected organization. Create a new project to get started."}
              </AlertDescription>
            </Alert>
          ) : isProjectsError ? null : (
            <TooltipProvider>
              {/* Desktop Table View */}
              <div className={viewMode === "table" ? "hidden md:block rounded-lg border bg-card shadow-sm overflow-hidden" : "hidden"}>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow className="border-b bg-muted/30 hover:bg-muted/30">
                        <TableHead
                          className="cursor-pointer font-semibold text-sm px-6 py-4 transition-colors hover:bg-muted/50"
                          onClick={() => handleSort("name")}
                        >
                          <div className="flex items-center gap-2">
                            <span>Project Name</span>
                            <span className="text-muted-foreground">
                              {getSortIcon("name")}
                            </span>
                          </div>
                        </TableHead>
                        <TableHead
                          className="cursor-pointer font-semibold text-sm px-6 py-4 transition-colors hover:bg-muted/50"
                          onClick={() => handleSort("organization")}
                        >
                          <div className="flex items-center gap-2">
                            <span>Organization</span>
                            <span className="text-muted-foreground">
                              {getSortIcon("organization")}
                            </span>
                          </div>
                        </TableHead>
                        <TableHead
                          className="cursor-pointer font-semibold text-sm px-6 py-4 transition-colors hover:bg-muted/50"
                          onClick={() => handleSort("status")}
                        >
                          <div className="flex items-center gap-2">
                            <span>Status</span>
                            <span className="text-muted-foreground">
                              {getSortIcon("status")}
                            </span>
                          </div>
                        </TableHead>
                        <TableHead className="font-semibold text-sm px-6 py-4">
                          Issue Types
                        </TableHead>
                        <TableHead className="text-right font-semibold text-sm px-6 py-4">
                          Actions
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {projectsSectionLoading && projects.length > 0 ? (
                        // Show skeleton rows when loading
                        Array.from({ length: Math.min(projects.length, 5) }).map((_, index) => (
                          <TableRow
                            key={`skeleton-${index}`}
                            className={`border-b ${index % 2 === 0
                                ? "bg-background"
                                : "bg-muted/20"
                              }`}
                          >
                            <TableCell className="px-6 py-4">
                              <Skeleton className="h-5 w-48" />
                            </TableCell>
                            <TableCell className="px-6 py-4">
                              <Skeleton className="h-5 w-32" />
                            </TableCell>
                            <TableCell className="px-6 py-4">
                              <Skeleton className="h-5 w-20" />
                            </TableCell>
                            <TableCell className="px-6 py-4">
                              <Skeleton className="h-5 w-24" />
                            </TableCell>
                            <TableCell className="px-6 py-4">
                              <div className="flex items-center justify-end gap-2">
                                <Skeleton className="h-8 w-8 rounded-md" />
                                <Skeleton className="h-8 w-8 rounded-md" />
                              </div>
                            </TableCell>
                          </TableRow>
                        ))
                      ) : (
                        // Show actual project rows when not loading
                        paginatedProjects?.map((project, index) => (
                          <TableRow
                            key={project.id}
                            className={`border-b transition-colors ${index % 2 === 0
                                ? "bg-background hover:bg-muted/50"
                                : "bg-muted/20 hover:bg-muted/60"
                              }`}
                          >
                            <TableCell className="px-6 py-4">
                              <button
                                onClick={() => handleProjectClick(project)}
                                className="text-left font-medium text-primary hover:text-primary/80 hover:underline transition-colors"
                                data-testid={`link-project-${project.name
                                  .toLowerCase()
                                  .replace(/\s+/g, "-")}`}
                              >
                                {project.name}
                              </button>
                            </TableCell>
                            <TableCell className="text-muted-foreground px-6 py-4">
                              <div className="flex flex-col gap-0.5">
                                <div className="flex items-center gap-2">
                                  <span className="text-sm">
                                    {formatOrganizationDisplay(project)}
                                  </span>
                                  {project.integrationType === "jira" ? (
                                    <Badge
                                      variant="outline"
                                      className="text-[10px] py-0 h-4 bg-orange-500/10 text-orange-600 border-orange-500/20"
                                    >
                                      Jira
                                    </Badge>
                                  ) : (
                                    <Badge
                                      variant="outline"
                                      className="text-[10px] py-0 h-4 bg-blue-500/10 text-blue-500 border-blue-500/30"
                                    >
                                      ADO
                                    </Badge>
                                  )}
                                </div>
                                {project.integrationType === "jira" && project.jiraProjectKey && (
                                  <span className="text-xs text-muted-foreground/60 font-mono">
                                    {project.jiraProjectKey}
                                  </span>
                                )}
                              </div>
                            </TableCell>
                            <TableCell className="px-6 py-4">
                              {isProjectSynced(project) ? (
                                <Badge
                                  variant="outline"
                                  className="bg-emerald-500/10 text-emerald-700 border-emerald-500/20 dark:text-emerald-400"
                                >
                                  Synced
                                </Badge>
                              ) : (
                                <Badge
                                  variant="outline"
                                  className="bg-amber-500/10 text-amber-700 border-amber-500/20 dark:text-amber-400"
                                >
                                  Unsynced
                                </Badge>
                              )}
                            </TableCell>
                            <TableCell className="px-6 py-4">
                              <IssueTypesDisplay project={project} />
                            </TableCell>
                            <TableCell className="px-6 py-4">
                              <div className="flex items-center justify-end gap-2">
                                {renderProjectActions(project, "table")}
                              </div>
                            </TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </div>
              </div>

              {/* Card View */}
              <div className={viewMode === "cards" ? "grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3" : "space-y-4 md:hidden"}>
                {projectsSectionLoading && paginatedProjects.length > 0 ? (
                  // Show skeleton cards when loading
                  Array.from({ length: Math.min(paginatedProjects.length, 5) }).map((_, index) => (
                    <div
                      key={`skeleton-card-${index}`}
                      className="rounded-lg border border-border/60 bg-card p-4 shadow-sm space-y-3"
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex-1 min-w-0 space-y-2">
                          <Skeleton className="h-5 w-48" />
                          <Skeleton className="h-4 w-32" />
                        </div>
                        <div className="flex items-center gap-2 ml-4">
                          <Skeleton className="h-9 w-9 rounded-md" />
                          <Skeleton className="h-9 w-9 rounded-md" />
                        </div>
                      </div>
                    </div>
                  ))
                ) : (
                  // Show actual project cards when not loading
                  paginatedProjects?.map((project) => {
                    const synced = isProjectSynced(project);
                    const integrationType = project.integrationType === "jira" ? "Jira" : "ADO";
                    const metadata = (project.sdlcProject || project) as any;
                    const goldenRepoReference = metadata.goldenRepoReference || project.goldenRepoReference || null;
                    const goldenRepoName =
                      metadata.linkedGoldenRepoName ||
                      goldenRepoReference?.repoName ||
                      "";
                    const goldenRepoProvider = goldenRepoReference?.provider || null;
                    const goldenRepoSource = [
                      metadata.linkedGoldenRepoOrg,
                      metadata.linkedGoldenRepoProject,
                    ]
                      .filter(Boolean)
                      .join(" / ");
                    const goldenRepoMapped = Boolean(
                      metadata.repositoryId ||
                        metadata.repository_id ||
                        goldenRepoName ||
                        goldenRepoReference?.repoId,
                    );
                    const projectRecordId = getProjectRecordId(project);
                    const projectOwnerLabel =
                      project.ownerInfo?.displayName?.trim() ||
                      project.ownerInfo?.email?.trim() ||
                      project.ownerUserId ||
                      project.sdlcProject?.ownerUserId ||
                      "Unknown owner";
                    const projectManagementCredentialConfigured = isProjectManagementCredentialConfigured(project);
                    const repositoryConfigured = Boolean(
                      project.repoIntegrationConfig?.providerKey ||
                        project.repoIntegrationConfig?.displayName ||
                        project.repoIntegrationConfig?.repositoryId ||
                        project.repoIntegrationConfig?.repositoryName,
                    );
                    const repositoryLink = buildRepositoryLink(project.repoIntegrationConfig);
                    const repositoryConfigurationDetails: ProjectCardDetail[] = [
                      {
                        label: "Provider",
                        value: project.repoIntegrationConfig?.displayName || formatIntegrationProviderLabel(project.repoIntegrationConfig?.providerKey),
                      },
                      ...(repositoryLink
                        ? [{
                            label: "Repo link",
                            value: repositoryLink,
                            href: repositoryLink,
                          }]
                        : project.repoIntegrationConfig?.repositoryName || project.repoIntegrationConfig?.repositoryId
                          ? [{
                              label: "Repo link",
                              value: project.repoIntegrationConfig.repositoryName || project.repoIntegrationConfig.repositoryId || "Configured",
                            }]
                          : []),
                      {
                        label: "Repository PAT",
                        value: isRepoPatRequired(project)
                          ? isRepoPatConfigured(project)
                            ? "Configured"
                            : "Not configured"
                          : "Not required",
                      },
                    ];
                    const projectConfigurationDetails: ProjectCardDetail[] = [
                      { label: "Organization", value: formatOrganizationDisplay(project) },
                      ...(project.integrationType === "jira"
                        ? [
                            { label: "Jira instance", value: project.jiraInstanceUrl || project.organizationUrl || "—" },
                          ]
                        : [{ label: "ADO URL", value: project.organizationUrl || "—" }]),
                      { label: "Owner", value: projectOwnerLabel },
                      { label: "Project ID", value: projectRecordId },
                    ];

                    const renderDetailGrid = (items: ProjectCardDetail[]) => (
                      <dl className="grid gap-x-4 gap-y-2 text-xs sm:grid-cols-2">
                        {items.map((item) => (
                          <div key={item.label} className="min-w-0">
                            <dt className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                              {item.label}
                            </dt>
                            {item.label === "Project ID" ? (
                              <dd className="mt-0.5 flex min-w-0 items-center gap-1.5 text-foreground">
                                <span className="truncate font-mono text-[11px]" title={item.value}>
                                  {item.value}
                                </span>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      size="icon"
                                      className="h-6 w-6 shrink-0 text-muted-foreground hover:text-foreground"
                                      aria-label={`Copy project ID ${item.value}`}
                                      onClick={() => handleCopyProjectId(item.value)}
                                    >
                                      <Copy className="h-3.5 w-3.5" />
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent>
                                    <p>Copy project ID</p>
                                  </TooltipContent>
                                </Tooltip>
                              </dd>
                            ) : item.href ? (
                              <dd className="mt-0.5 truncate">
                                <a
                                  href={item.href}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="truncate text-primary hover:underline"
                                  title={item.value}
                                >
                                  {item.value}
                                </a>
                              </dd>
                            ) : (
                              <dd className="mt-0.5 truncate text-foreground" title={item.value}>
                                {item.value}
                              </dd>
                            )}
                          </div>
                        ))}
                      </dl>
                    );

                    const renderConfigurationHeader = (label: string, configured: boolean) => (
                      <div className="flex items-center justify-between gap-2">
                        <h3 className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                          {label}
                        </h3>
                        <Badge
                          variant="outline"
                          className={
                            configured
                              ? "bg-emerald-500/10 text-emerald-700 border-emerald-500/20 dark:text-emerald-400"
                              : "bg-muted text-muted-foreground border-border"
                          }
                        >
                          {configured ? "Configured" : "Not configured"}
                        </Badge>
                      </div>
                    );

                    return (
                      <div
                        key={project.id}
                        className="rounded-lg border border-border/60 border-l-[3px] border-l-violet-500 bg-card p-4 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md"
                      >
                        <div className="flex h-full flex-col gap-4">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0 flex-1">
                              <div className="mb-3 flex flex-wrap items-center gap-2">
                                <Badge
                                  variant="outline"
                                  className={`inline-flex h-7 min-w-[88px] items-center justify-center px-3 text-xs font-semibold ${
                                    synced
                                      ? "bg-emerald-500/10 text-emerald-700 border-emerald-500/20 dark:text-emerald-400"
                                      : "bg-amber-500/10 text-amber-700 border-amber-500/20 dark:text-amber-400"
                                  }`}
                                >
                                  {synced ? "Synced" : "Unsynced"}
                                </Badge>
                                <Badge
                                  variant="outline"
                                  className={`inline-flex h-7 min-w-[88px] items-center justify-center px-3 text-xs font-semibold ${
                                    project.integrationType === "jira"
                                      ? "bg-orange-500/10 text-orange-600 border-orange-500/20"
                                      : "bg-blue-500/10 text-blue-500 border-blue-500/30"
                                  }`}
                                >
                                  {integrationType}
                                </Badge>
                              </div>
                              <button
                                onClick={() => handleProjectClick(project)}
                                className="block w-full truncate text-left font-semibold text-primary transition-colors hover:text-primary/80 hover:underline"
                                data-testid={`link-project-${project.name
                                  .toLowerCase()
                                  .replace(/\s+/g, "-")}`}
                              >
                                {project.name}
                              </button>
                            </div>
                            <div className="ml-2 flex shrink-0 items-center gap-1">
                              {renderProjectActions(project, "card")}
                            </div>
                          </div>

                          <Tabs defaultValue="project" className="flex min-h-[160px] flex-col">
                            <TabsList className="grid h-auto w-full grid-cols-3 gap-1">
                              <TabsTrigger value="project" className="text-xs">
                                Project
                              </TabsTrigger>
                              <TabsTrigger value="repository" className="text-xs">
                                Repository
                              </TabsTrigger>
                              <TabsTrigger value="golden-repo" className="text-xs">
                                Golden Repo
                              </TabsTrigger>
                            </TabsList>

                            <div className="mt-3 rounded-md border border-border/50 bg-muted/10 p-3">
                              <TabsContent value="project" className="m-0">
                                <section className="flex flex-col gap-3">
                                  {renderConfigurationHeader("Project Configuration", projectManagementCredentialConfigured)}
                                  {renderDetailGrid(projectConfigurationDetails)}
                                </section>
                              </TabsContent>

                              <TabsContent value="repository" className="m-0">
                                <section className="flex flex-col gap-3">
                                  {renderConfigurationHeader("Repository Configuration", repositoryConfigured)}
                                  {repositoryConfigured ? (
                                    renderDetailGrid(repositoryConfigurationDetails)
                                  ) : (
                                    <p className="text-xs text-muted-foreground">
                                      No repository provider is configured for this project.
                                    </p>
                                  )}
                                </section>
                              </TabsContent>

                              <TabsContent value="golden-repo" className="m-0">
                                <section className="flex flex-col gap-3">
                                  {renderConfigurationHeader("Golden Repo Configuration", goldenRepoMapped)}
                                  {goldenRepoMapped ? (
                                    renderDetailGrid([
                                      { label: "Repository", value: goldenRepoName || goldenRepoReference?.repoId || "Configured" },
                                      { label: "Provider", value: formatIntegrationProviderLabel(goldenRepoProvider) },
                                      ...(goldenRepoSource ? [{ label: "Source", value: goldenRepoSource }] : []),
                                    ])
                                  ) : (
                                    <p className="text-xs text-muted-foreground">
                                      No golden repository is mapped to this project.
                                    </p>
                                  )}
                                </section>
                              </TabsContent>

                            </div>
                          </Tabs>

                          <div className="mt-auto flex min-h-9 items-center gap-2 rounded-md border border-border/50 bg-muted/10 px-3 py-1.5">
                            <div className="shrink-0 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                              Issue Types
                            </div>
                            <IssueTypesDisplay project={project} compact />
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </TooltipProvider>
          )}
        </div>
      )}
      {/* Create Project Dialog */}
      <CreateProjectDialog
        open={createDialogOpen}
        onOpenChange={(open) => {
          setCreateDialogOpen(open);
          // Clear stored values when dialog closes
          if (!open) {
            setStoredGoldenRepoId(null);
            setStoredGoldenRepoName(null);
          }
        }}
        selectedOrganizationId={selectedOrgDetails?.id ?? null}
        selectedOrganization={selectedOrgDetails}
        onProjectCreated={handleProjectCreated}
        goldenRepoId={storedGoldenRepoId || goldenRepoId || null}
        goldenRepoName={storedGoldenRepoName || goldenRepoName || null}
        key={storedGoldenRepoId || goldenRepoId || "default"} // Force re-render when goldenRepoId changes
      />

      {/* Edit Project Dialog */}
      {selectedProject && (
        <EditProjectDialog
          open={editDialogOpen}
          onOpenChange={(open) => {
            setEditDialogOpen(open);
            if (!open) {
              setSelectedProject(null);
              setEditInitialStep(0);
              setEditAttentionMessage(null);
              setEditCredentialOnlyMode(false);
            }
          }}
          initialStep={editInitialStep}
          attentionMessage={editAttentionMessage}
          credentialOnlyMode={editCredentialOnlyMode}
          project={selectedProject}
          onProjectUpdated={handleProjectUpdated}
        />
      )}

      {/* Sync SDLC Project Dialog */}
      {syncProject && (
        <SyncSdlcProjectDialog
          open={syncDialogOpen}
          onOpenChange={(open) => {
            setSyncDialogOpen(open);
            if (!open) {
              setSyncProject(null);
            }
          }}
          project={syncProject}
          onProjectSynced={handleProjectSynced}
        />
      )}

      {jiraInviteProject && jiraInviteConnection && (
        <AddOrganizationDialog
          open={jiraInviteDialogOpen}
          onOpenChange={(open) => {
            setJiraInviteDialogOpen(open);
            if (!open) {
              setJiraInviteProject(null);
            }
          }}
          initialJiraConnection={jiraInviteConnection}
          jiraProjectScope={{
            id: jiraInviteProject.sdlcProject?.id || jiraInviteProject.id,
            projectId: jiraInviteProject.sdlcProject?.projectId || jiraInviteProject.id,
            key: jiraInviteProject.jiraProjectKey || jiraInviteProject.sdlcProject?.jiraProjectKey || null,
            name: jiraInviteProject.name,
          }}
          onSuccess={() => {
            invalidateAdoProjects();
            queryClient.invalidateQueries({ queryKey: ["/api/jira/connections"] });
          }}
        />
      )}

      <GenericModal
        open={inviteDialogOpen}
        onOpenChange={(open) => {
          setInviteDialogOpen(open);
          if (!open && !inviteSubmitting) {
            setInviteProject(null);
            setInviteUserId("");
          }
        }}
        title="Invite Project Member"
        description="Assign this registered project to an existing system user. They will add their own personal PAT/API tokens."
        icon={UserPlus}
        width="520px"
        contentClassName="space-y-4"
        preventClose={inviteSubmitting}
        footerButtons={[
          {
            label: "Cancel",
            onClick: () => setInviteDialogOpen(false),
            variant: "outline",
            disabled: inviteSubmitting,
          },
          {
            label: inviteSubmitting ? "Adding..." : "Add member",
            onClick: submitProjectInvite,
            disabled:
              inviteSubmitting ||
              availableProjectMembersLoading ||
              selectableProjectMembers.length === 0 ||
              !inviteUserId.trim(),
            loading: inviteSubmitting,
            "data-testid": "button-confirm-invite-project-member",
          },
        ]}
      >
        <div className="space-y-2">
          <Label htmlFor="project-member-user">Member</Label>
          <Select
            value={inviteUserId}
            onValueChange={setInviteUserId}
            disabled={inviteSubmitting || availableProjectMembersLoading || selectableProjectMembers.length === 0}
          >
            <SelectTrigger id="project-member-user" data-testid="select-project-member-user">
              <SelectValue
                placeholder={
                  availableProjectMembersLoading
                    ? "Loading users..."
                    : selectableProjectMembers.length === 0
                      ? "No users available to add"
                      : "Select a system user"
                }
              />
            </SelectTrigger>
            <SelectContent>
              {availableProjectMembers.map((user) => (
                <SelectItem key={user.userId} value={user.userId} disabled={user.isOwner || user.isMember}>
                  {user.displayName || user.email} ({user.email})
                  {user.isOwner ? " - Owner" : user.isMember ? " - Already assigned" : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {availableProjectMembersError && (
            <p className="text-xs text-destructive">Could not load available users.</p>
          )}
          {!availableProjectMembersLoading && !availableProjectMembersError && selectableProjectMembers.length === 0 && (
            <p className="text-xs text-muted-foreground">All system users are already assigned to this project.</p>
          )}
        </div>
      </GenericModal>

      {/* Delete Project Dialog */}
      {selectedProject && (
        <DeleteProjectDialog
          open={deleteDialogOpen}
          onOpenChange={(open) => {
            setDeleteDialogOpen(open);
            if (!open) {
              setSelectedProject(null);
            }
          }}
          project={selectedProject}
          onProjectDeleted={handleProjectDeleted}
        />
      )}


    </div>
  );
}
