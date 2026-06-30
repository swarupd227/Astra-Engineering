import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { useIsFetching, useQuery } from "@tanstack/react-query";
import {
  Building2,
  FolderOpen, GitBranch, Plus, History,
  HelpCircle,
  ArrowRight,
  LayoutDashboard
} from "lucide-react";
import { Link } from "wouter";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { CreateProjectDialog } from "@/components/create-project-dialog";
import { GenericModal } from "@/components/ui/generic-modal";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useState, useMemo, useCallback, memo, Suspense, lazy } from "react";
import { useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useMsal } from "@azure/msal-react";
import { addUserInfoToRequest } from "@/utils/api-interceptor";
import { getApiUrl } from "@/lib/api-config";
import { useMe } from "@/hooks/use-me";
import { useJiraOnlyWorkItems } from "@/hooks/use-hosting-config";
import { GLOBAL_ALL_ORGANIZATIONS_ID, useSelectedOrganization } from "@/contexts/selected-organization-context";
import { useProjectCountForOrg } from "@/hooks/use-project-counts";

// Lazy load heavy chart components
const WorkItemsChart = lazy(() =>
  import("./dashboard-charts").then((module) => ({
    default: module.WorkItemsChart,
  }))
);
const PhaseProgressChart = lazy(() =>
  import("./dashboard-charts").then((module) => ({
    default: module.PhaseProgressChart,
  }))
);

interface DashboardMetrics {
  organizations: number;
  projects: number;
  sdlcProjects: number;
  goldenRepositories: number;
  totalWorkItems: number;
  workItems: {
    issues: number;
    epics: number;
    requirements: number;
    backlog: number;
    documents: number;
  };
  generatedArtifacts?: {
    brds: number;
    requirements: number;
    epics: number;
    features: number;
    userStories: number;
    testCases: number;
    testPlans: number;
    designAssets: number;
    designGuidelines: number;
  };
  workItemsByProject?: Array<{
    projectId: string;
    projectName: string;
    issues: number;
    epics: number;
    requirements: number;
    backlog: number;
    documents: number;
    total: number;
  }>;
  wikiPages: number;
  phases: {
    total: number;
    active: number;
    completed: number;
  };
  phasesByProject?: Array<{
    projectId: string;
    projectName: string;
    total: number;
    active: number;
    completed: number;
    pending: number;
  }>;
  recentProjects: Array<{
    id: string;
    name: string;
    description: string | null;
    status: string;
    createdAt: string;
  }>;
  recentOrganizations: Array<{
    id: string;
    name: string;
    description: string | null;
    industry: string | null;
    status: string;
    createdAt: string;
  }>;
}

type DashboardCardVisibility = {
  organizations: boolean;
  projects: boolean;
  goldenRepos: boolean;
  quickActions: boolean;
  generatedArtifacts: boolean;
  recentProjects: boolean;
};

const DASHBOARD_VISIBILITY_STORAGE_KEY = "devx:overview-card-visibility";
const DEFAULT_DASHBOARD_CARD_VISIBILITY: DashboardCardVisibility = {
  organizations: true,
  projects: true,
  goldenRepos: true,
  quickActions: true,
  generatedArtifacts: true,
  recentProjects: true,
};

// Mini decorative bar chart for KPI cards
const MiniBarChart = memo<{ color: string; bars: number[] }>(({ color, bars }) => (
  <div className="flex items-end gap-[3px] h-10">
    {bars.map((h, i) => (
      <div
        key={i}
        className="w-[6px] rounded-sm transition-all duration-500"
        style={{ height: `${h}%`, backgroundColor: color, opacity: 0.4 + (h / 100) * 0.5 }}
      />
    ))}
  </div>
));
MiniBarChart.displayName = "MiniBarChart";

// Modern UI brilliant colors
const COLORS = ["#3B82F6", "#8B5CF6", "#10B981", "#F59E0B", "#EC4899"];
const DARK_THEME_COLORS = [
  "#60A5FA", // Blue
  "#A78BFA", // Violet
  "#34D399", // Emerald
  "#FBBF24", // Amber
  "#F472B6", // Pink
  "#FB923C", // Orange
  "#38BDF8", // Sky
  "#4ADE80", // Green
  "#E879F9", // Fuchsia
];

// Memoized components for better performance
interface RecentProjectItemProps {
  project: {
    id: string;
    name: string;
    description: string | null;
    status: string;
    createdAt: string;
  };
}

const RecentProjectItem = memo<RecentProjectItemProps>(({ project }) => (
  <div
    key={project.id}
    className="flex items-start justify-between border-b pb-4 last:border-0"
    data-testid={`project-item-${project.id}`}
  >
    <div className="space-y-1 flex-1">
      <p className="font-medium" data-testid="text-project-name">
        {project.name}
      </p>
      {project.description && (
        <p className="text-sm text-muted-foreground line-clamp-1">
          {project.description}
        </p>
      )}
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span
          className={`inline-flex items-center rounded-md px-2 py-1 text-xs font-medium ${
            project.status === "active"
              ? "bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-400"
              : "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400"
          }`}
        >
          {project.status}
        </span>
        <span>{new Date(project.createdAt).toLocaleDateString()}</span>
      </div>
    </div>
  </div>
));

RecentProjectItem.displayName = "RecentProjectItem";

interface RecentProjectsListProps {
  projects: Array<{
    id: string;
    name: string;
    description: string | null;
    status: string;
    createdAt: string;
  }>;
}

const RecentProjectsList = memo<RecentProjectsListProps>(({ projects }) => {
  const visibleProjects = projects.slice(0, 2);

  if (projects.length === 0) {
    return (
      <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
        No recent projects
      </div>
    );
  }

  return (
    <div className="space-y-4 pb-2">
      {visibleProjects.map((project) => (
        <RecentProjectItem key={project.id} project={project} />
      ))}
    </div>
  );
});

RecentProjectsList.displayName = "RecentProjectsList";

export default function Dashboard() {
  const { accounts } = useMsal();
  const account = accounts[0] ?? null;
  const { data: me } = useMe();
  const jiraOnly = useJiraOnlyWorkItems();
  const { selectedOrganization } = useSelectedOrganization();

  const isTenantAdmin = me?.roles?.some((r) => r.role === "TenantAdmin") ?? false;
  const canCreateProject = me?.canCreateProject ?? false;

  const selectedOrganizationIdForQuery = selectedOrganization?.id ?? "__none__";
  const isGlobalAllOrganizations =
    selectedOrganization?.id === GLOBAL_ALL_ORGANIZATIONS_ID;

  const { data: metrics, isLoading } = useQuery<DashboardMetrics>({
    queryKey: ["/api/dashboard/metrics", selectedOrganizationIdForQuery],
    queryFn: async () => {
      const response = await apiRequest("GET", "/api/dashboard/metrics");
      const data = await response.json();
      console.log("[Dashboard] Metrics received:", data);
      console.log(
        "[Dashboard] Work items by project:",
        data.workItemsByProject
      );
      return data;
    },
    staleTime: 2 * 60 * 1000, // 2 minutes
    gcTime: 5 * 60 * 1000, // 5 minutes (formerly cacheTime)
  });
  const projectsCountOrgParam = isGlobalAllOrganizations
    ? "all"
    : (selectedOrganization?.id ?? "all");

  const { data: projectsCountData } = useProjectCountForOrg(
    projectsCountOrgParam,
    !!selectedOrganization
  );
  const { data: liveGoldenRepoCountData } = useQuery<{ liveGoldenRepoCount: number; source: "live"; fetchedAt: string }>({
    queryKey: ["/api/dashboard/live-golden-repo-count"],
    queryFn: async () => {
      const response = await apiRequest("GET", "/api/dashboard/live-golden-repo-count");
      return response.json();
    },
    staleTime: 60 * 1000,
    gcTime: 2 * 60 * 1000,
  });
  const overviewMetricsFetchCount = useIsFetching({
    predicate: (query) => {
      const [firstKey] = query.queryKey;
      return firstKey === "/api/dashboard/metrics";
    },
  });

  const [createProjectDialogOpen, setCreateProjectDialogOpen] = useState(false);
  const [addOrgDialogOpen, setAddOrgDialogOpen] = useState(false);
  const [newOrgData, setNewOrgData] = useState({
    organizationUrl: "",
    patToken: "",
  });
  const { toast } = useToast();
  const isOverviewRefreshing = !isLoading && overviewMetricsFetchCount > 0;
  const organizationCardTitle =
    selectedOrganization && !isGlobalAllOrganizations
      ? selectedOrganization.name
      : "Organizations";
  const organizationCardSubtitle =
    selectedOrganization && !isGlobalAllOrganizations
      ? "Currently selected organization"
      : "Active organizations";
  const [cardVisibility, setCardVisibility] =
    useState<DashboardCardVisibility>(() => {
      if (typeof window === "undefined") {
        return DEFAULT_DASHBOARD_CARD_VISIBILITY;
      }

      try {
        const stored = window.localStorage.getItem(
          DASHBOARD_VISIBILITY_STORAGE_KEY
        );
        if (!stored) return DEFAULT_DASHBOARD_CARD_VISIBILITY;

        return {
          ...DEFAULT_DASHBOARD_CARD_VISIBILITY,
          ...JSON.parse(stored),
        };
      } catch {
        return DEFAULT_DASHBOARD_CARD_VISIBILITY;
      }
    });
  const hasRightRailContent = cardVisibility.recentProjects;
  const displayedProjectCount = projectsCountData?.totalCount ?? 0;
  const displayedGoldenRepoCount =
    liveGoldenRepoCountData?.liveGoldenRepoCount ?? metrics?.goldenRepositories ?? 0;

  const updateCardVisibility = useCallback(
    (key: keyof DashboardCardVisibility, checked: boolean) => {
      setCardVisibility((current) => {
        const next = { ...current, [key]: checked };
        if (typeof window !== "undefined") {
          window.localStorage.setItem(
            DASHBOARD_VISIBILITY_STORAGE_KEY,
            JSON.stringify(next)
          );
        }
        return next;
      });
    },
    []
  );

  const handleAddOrgSuccess = useCallback(() => {
    queryClient.invalidateQueries({
      queryKey: ["/api/artifact-organizations"],
    });
    queryClient.invalidateQueries({ queryKey: ["/api/dashboard/metrics"] });
    queryClient.invalidateQueries({ queryKey: ["/api/ado-projects"] });
    queryClient.invalidateQueries({ queryKey: ["/api/dashboard/live-golden-repo-count"] });
    toast({
      title: "Organization added",
      description: "Organization has been added successfully",
    });
    setAddOrgDialogOpen(false);
    setNewOrgData({ organizationUrl: "", patToken: "" });
  }, [toast]);

  const handleAddOrgError = useCallback(
    (error: any) => {
      toast({
        title: "Failed to add organization",
        description:
          error instanceof Error ? error.message : "An error occurred",
        variant: "destructive",
      });
    },
    [toast]
  );

  const addOrgMutation = useMutation({
    mutationFn: async (data: {
      organizationUrl: string;
      patToken?: string;
    }) => {
      return apiRequest("POST", "/api/artifact-organizations", data);
    },
    onSuccess: handleAddOrgSuccess,
    onError: handleAddOrgError,
  });

  const handleAddOrganization = useCallback(() => {
    if (!newOrgData.organizationUrl) {
      toast({
        title: "Missing required fields",
        description: "Organization URL is required",
        variant: "destructive",
      });
      return;
    }
    addOrgMutation.mutate(newOrgData);
  }, [newOrgData, addOrgMutation, toast]);

  const handleCloseAddOrgDialog = useCallback(() => {
    setAddOrgDialogOpen(false);
    setNewOrgData({ organizationUrl: "", patToken: "" });
  }, []);

  const handleProjectCreated = useCallback(() => {
    queryClient.invalidateQueries({
      queryKey: ["/api/dashboard/metrics"],
    });
    queryClient.invalidateQueries({
      queryKey: ["/api/ado-projects"],
    });
    queryClient.invalidateQueries({
      queryKey: ["/api/dashboard/live-golden-repo-count"],
    });
  }, []);

  const handleOrgUrlChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setNewOrgData((prev) => ({
        ...prev,
        organizationUrl: e.target.value,
      }));
    },
    []
  );

  const handlePatTokenChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setNewOrgData((prev) => ({
        ...prev,
        patToken: e.target.value,
      }));
    },
    []
  );

  // Memoize expensive data transformations - MUST be before any conditional returns
  const workItemsData = useMemo(() => {
    if (!metrics?.generatedArtifacts) return [];
    const artifacts = metrics.generatedArtifacts;
    return [
      {
        name: "BRDs",
        value: artifacts.brds || 0,
        color: DARK_THEME_COLORS[0],
      },
      {
        name: "Requirements",
        value: artifacts.requirements || 0,
        color: DARK_THEME_COLORS[1],
      },
      {
        name: "Epics",
        value: artifacts.epics || 0,
        color: DARK_THEME_COLORS[2],
      },
      {
        name: "Features",
        value: artifacts.features || 0,
        color: DARK_THEME_COLORS[3],
      },
      {
        name: "User Stories",
        value: artifacts.userStories || 0,
        color: DARK_THEME_COLORS[4],
      },
      {
        name: "Test Cases",
        value: artifacts.testCases || 0,
        color: DARK_THEME_COLORS[5],
      },
      {
        name: "Test Plans",
        value: artifacts.testPlans || 0,
        color: DARK_THEME_COLORS[6],
      },
      {
        name: "Design Assets",
        value: artifacts.designAssets || 0,
        color: DARK_THEME_COLORS[7],
      },
      {
        name: "Guidelines",
        value: artifacts.designGuidelines || 0,
        color: DARK_THEME_COLORS[8],
      },
    ].filter((item) => item.value > 0);
  }, [
    metrics?.generatedArtifacts?.brds,
    metrics?.generatedArtifacts?.requirements,
    metrics?.generatedArtifacts?.epics,
    metrics?.generatedArtifacts?.features,
    metrics?.generatedArtifacts?.userStories,
    metrics?.generatedArtifacts?.testCases,
    metrics?.generatedArtifacts?.testPlans,
    metrics?.generatedArtifacts?.designAssets,
    metrics?.generatedArtifacts?.designGuidelines,
  ]);

  // Create a stable key from phasesByProject for dependency tracking
  const phasesByProjectKey = useMemo(() => {
    if (!metrics?.phasesByProject) return undefined;
    return metrics.phasesByProject.map(p => `${p.projectId}-${p.active}-${p.completed}-${p.pending}`).join('|');
  }, [metrics?.phasesByProject]);

  const phaseProgressData = useMemo<
    Array<{
      name?: string;
      value?: number;
      color?: string;
      projectName?: string;
      Active?: number;
      Completed?: number;
      Pending?: number;
    }>
  >(() => {
    if (!metrics) return [];

    // If we have project-wise data, use it for grouped bar chart
    if (metrics.phasesByProject && metrics.phasesByProject.length > 0) {
      return metrics.phasesByProject.map((project) => ({
        projectName: project.projectName,
        Active: project.active || 0,
        Completed: project.completed || 0,
        Pending: project.pending || 0,
      }));
    }

    // Fallback to overall totals if no project data
    const phases = metrics.phases;
    return [
      { name: "Active", value: phases.active || 0, color: "#5cb85c" },
      {
        name: "Completed",
        value: phases.completed || 0,
        color: "#4a90e2",
      },
      {
        name: "Pending",
        value: Math.max(
          0,
          (phases.total || 0) -
            (phases.active || 0) -
            (phases.completed || 0)
        ),
        color: "#6c757d",
      },
    ].filter((item) => (item.value || 0) > 0);
  }, [
    metrics?.phases?.total,
    metrics?.phases?.active,
    metrics?.phases?.completed,
    metrics?.phasesByProject?.length,
    phasesByProjectKey,
  ]);

  // Memoize loading skeleton to avoid re-creation
  const loadingSkeleton = useMemo(
    () => (
      <div className="flex flex-col h-full overflow-hidden gap-5 p-5">
        {/* PageHeader skeleton */}
        <div className="flex items-center gap-3">
          <Skeleton className="h-10 w-10 rounded-xl" />
          <div className="space-y-1.5">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-3 w-56" />
          </div>
        </div>

        {/* Bento grid skeleton */}
        <div className="bento-grid grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 lg:flex-1 lg:min-h-0">
          {/* Row 1 — 4 KPI cards */}
          {[1, 2, 3, 4].map((i) => (
            <Card key={i} className="rounded-2xl shadow-sm border border-border/40 border-l-[3px] border-l-muted">
              <CardContent className="px-5 py-4">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2.5">
                    <Skeleton className="h-9 w-9 rounded-xl" />
                    <Skeleton className="h-4 w-20" />
                  </div>
                  <Skeleton className="h-10 w-12" />
                </div>
                <Skeleton className="h-8 w-16 mb-1" />
                <Skeleton className="h-3 w-28" />
              </CardContent>
            </Card>
          ))}

          {/* Row 2-3, Col 1-2 — Chart */}
          <Card className="md:col-span-2 lg:row-span-2 flex flex-col min-h-[300px] lg:min-h-0 rounded-2xl shadow-sm border border-border/40 border-l-[3px] border-l-muted">
            <CardHeader className="pb-2">
              <Skeleton className="h-5 w-44" />
              <Skeleton className="h-3.5 w-32 mt-1" />
            </CardHeader>
            <CardContent className="flex-1 min-h-0 flex items-center justify-center">
              <Skeleton className="h-full w-full rounded-xl" />
            </CardContent>
          </Card>

          {/* Row 2, Col 3-4 — Recent Projects */}
          <Card className="md:col-span-2 flex flex-col min-h-[200px] lg:min-h-0 rounded-2xl shadow-sm border border-border/40 border-l-[3px] border-l-muted">
            <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
              <Skeleton className="h-5 w-32" />
              <Skeleton className="h-7 w-16 rounded-lg" />
            </CardHeader>
            <CardContent className="space-y-3">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-10 w-full rounded-lg" />
              ))}
            </CardContent>
          </Card>

          {/* Row 3, Col 3-4 — Recent Organizations */}
          <Card className="md:col-span-2 flex flex-col min-h-[200px] lg:min-h-0 rounded-2xl shadow-sm border border-border/40 border-l-[3px] border-l-muted">
            <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
              <Skeleton className="h-5 w-40" />
              <Skeleton className="h-7 w-16 rounded-lg" />
            </CardHeader>
            <CardContent className="space-y-3">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-10 w-full rounded-lg" />
              ))}
            </CardContent>
          </Card>
        </div>
      </div>
    ),
    []
  );

  // All hooks must be called before any conditional returns
  if (isLoading) {
    return loadingSkeleton;
  }

  return (
    <TooltipProvider>
      <div className="relative flex h-full flex-col gap-5 overflow-hidden p-5 dark:bg-gradient-to-br dark:from-background dark:via-background dark:to-blue-950/10">
        {isOverviewRefreshing && (
          <div className="absolute inset-0 z-40 flex items-center justify-center bg-background/80 backdrop-blur-sm">
            <div className="rounded-2xl border border-border/60 bg-card px-6 py-5 shadow-xl">
              <div className="flex items-center gap-4">
                <div className="h-10 w-10 animate-spin rounded-full border-2 border-primary/20 border-t-primary" />
                <div>
                  <p className="text-sm font-semibold">Fetching data</p>
                  <p className="text-xs text-muted-foreground">
                    Updating overview for the selected organization...
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}
        <PageHeader
          icon={LayoutDashboard}
          title="Overview Dashboard"
          subtitle="Real-time insights into your SDLC platform"
          color="violet"
          data-testid="text-dashboard-title"
        >
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="rounded-lg text-xs">
                Customize View
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-72">
              <div className="space-y-3">
                <div>
                  <p className="text-sm font-semibold">Overview Visibility</p>
                  <p className="text-xs text-muted-foreground">
                    Toggle which cards appear on the overview dashboard.
                  </p>
                </div>
                {[
                  { key: "organizations", label: "Organization KPI" },
                  { key: "projects", label: "Projects KPI" },
                  { key: "goldenRepos", label: "Golden Repos KPI" },
                  { key: "quickActions", label: "Quick Actions" },
                  { key: "generatedArtifacts", label: "Generated Artifacts" },
                  { key: "recentProjects", label: "Recent Projects" },
                ].map((item) => (
                  <div
                    key={item.key}
                    className="flex items-center justify-between gap-3"
                  >
                    <Label
                      htmlFor={`toggle-${item.key}`}
                      className="text-sm font-normal"
                    >
                      {item.label}
                    </Label>
                    <Switch
                      id={`toggle-${item.key}`}
                      checked={
                        cardVisibility[
                          item.key as keyof DashboardCardVisibility
                        ]
                      }
                      onCheckedChange={(checked) =>
                        updateCardVisibility(
                          item.key as keyof DashboardCardVisibility,
                          checked
                        )
                      }
                    />
                  </div>
                ))}
              </div>
            </PopoverContent>
          </Popover>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="outline" size="sm" className="rounded-lg text-xs" asChild>
                <Link href="/help">
                  <HelpCircle className="h-3.5 w-3.5 mr-1.5" />
                  Help
                </Link>
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>Get help and learn about the dashboard</p>
            </TooltipContent>
          </Tooltip>
        </PageHeader>

        {/* Bento Grid */}
        <div className="bento-grid grid flex-1 grid-cols-1 gap-4 overflow-hidden md:grid-cols-2 lg:grid-cols-4">

          {/* Row 1 — KPI: Organizations */}
          {cardVisibility.organizations && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Card className="card-animate card-glow-blue rounded-2xl shadow-sm border border-border/40 border-l-[3px] border-l-blue-500 hover:shadow-md hover:-translate-y-0.5 transition-all duration-300" style={{ animationDelay: '0.05s' }}>
                <CardContent className="px-5 py-4">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2.5">
                      <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-100 dark:bg-blue-500/15 ring-1 ring-blue-500/20">
                        <Building2 className="h-4.5 w-4.5 text-blue-600 dark:text-blue-400" data-testid="icon-organizations" />
                      </div>
                      <CardTitle className="text-sm font-medium text-muted-foreground capitalize">
                        {organizationCardTitle}
                      </CardTitle>
                    </div>
                    <MiniBarChart color="#3b82f6" bars={[40, 70, 55, 85, 60, 90, 75]} />
                  </div>
                  <div className="text-3xl font-bold tracking-tight text-blue-600 dark:text-blue-400" data-testid="text-organizations-count">
                    {selectedOrganization && !isGlobalAllOrganizations ? 1 : (metrics?.organizations || 0)}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">{organizationCardSubtitle}</p>
                </CardContent>
              </Card>
            </TooltipTrigger>
            <TooltipContent><p>Manage your organizations</p></TooltipContent>
          </Tooltip>
          )}

          {/* Row 1 — KPI: Projects */}
          {cardVisibility.projects && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Card className="card-animate card-glow-violet rounded-2xl shadow-sm border border-border/40 border-l-[3px] border-l-violet-500 hover:shadow-md hover:-translate-y-0.5 transition-all duration-300" style={{ animationDelay: '0.1s' }}>
                <CardContent className="px-5 py-4">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2.5">
                      <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-violet-100 dark:bg-violet-500/15 ring-1 ring-violet-500/20">
                        <FolderOpen className="h-4.5 w-4.5 text-violet-600 dark:text-violet-400" data-testid="icon-projects" />
                      </div>
                      <CardTitle className="text-sm font-medium text-muted-foreground">Projects</CardTitle>
                    </div>
                    <MiniBarChart color="#8b5cf6" bars={[60, 45, 80, 50, 90, 65, 85]} />
                  </div>
                  <div className="text-3xl font-bold tracking-tight text-violet-600 dark:text-violet-400" data-testid="text-projects-count">
                    {displayedProjectCount}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">Total projects</p>
                </CardContent>
              </Card>
            </TooltipTrigger>
            <TooltipContent><p>View all projects</p></TooltipContent>
          </Tooltip>
          )}

          {/* Row 1 — KPI: Golden Repos */}
          {cardVisibility.goldenRepos && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Card className="card-animate card-glow-emerald rounded-2xl shadow-sm border border-border/40 border-l-[3px] border-l-emerald-500 hover:shadow-md hover:-translate-y-0.5 transition-all duration-300" style={{ animationDelay: '0.15s' }}>
                <CardContent className="px-5 py-4">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2.5">
                      <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-100 dark:bg-emerald-500/15 ring-1 ring-emerald-500/20">
                        <GitBranch className="h-4.5 w-4.5 text-emerald-600 dark:text-emerald-400" data-testid="icon-golden-repos" />
                      </div>
                      <CardTitle className="text-sm font-medium text-muted-foreground">Golden Repos</CardTitle>
                    </div>
                    <MiniBarChart color="#10b981" bars={[50, 80, 35, 70, 55, 90, 65]} />
                  </div>
                  <div className="text-3xl font-bold tracking-tight text-emerald-600 dark:text-emerald-400" data-testid="text-golden-repos-count">
                    {displayedGoldenRepoCount}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">Template repositories</p>
                </CardContent>
              </Card>
            </TooltipTrigger>
            <TooltipContent><p>View golden repository templates</p></TooltipContent>
          </Tooltip>
          )}

          {/* Row 1 — Quick Actions (CTA style) */}
          {cardVisibility.quickActions && (
          <Card className="card-animate card-glow-purple rounded-2xl shadow-md border-0 bg-gradient-to-br from-violet-600 via-purple-600 to-indigo-700 dark:from-violet-700 dark:via-purple-700 dark:to-indigo-800 hover:shadow-lg hover:-translate-y-0.5 transition-all duration-300" style={{ animationDelay: '0.2s' }}>
            <CardContent className="h-full px-4 py-3 flex flex-col">
              <CardTitle className="text-sm font-medium text-white/80 mb-2">Quick Actions</CardTitle>
              <div className="flex items-stretch gap-2 flex-1 min-h-0">
                {isTenantAdmin && !jiraOnly && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        className="flex-1 flex flex-col items-center justify-center gap-1.5 rounded-xl bg-white/15 hover:bg-white/25 transition-all duration-200 cursor-pointer"
                        onClick={() => setAddOrgDialogOpen(true)}
                      >
                        <Building2 className="h-5 w-5 text-white" />
                        <span className="text-[11px] font-medium text-white/90">Org</span>
                      </button>
                    </TooltipTrigger>
                    <TooltipContent><p>Create a new organization</p></TooltipContent>
                  </Tooltip>
                )}
                {canCreateProject && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        className="flex-1 flex flex-col items-center justify-center gap-1.5 rounded-xl bg-white/15 hover:bg-white/25 transition-all duration-200 cursor-pointer"
                        onClick={() => setCreateProjectDialogOpen(true)}
                      >
                        <FolderOpen className="h-5 w-5 text-white" />
                        <span className="text-[11px] font-medium text-white/90">Project</span>
                      </button>
                    </TooltipTrigger>
                    <TooltipContent><p>Create a new project</p></TooltipContent>
                  </Tooltip>
                )}
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Link
                      href="/projects"
                      className="flex-1 flex flex-col items-center justify-center gap-1.5 rounded-xl bg-white/15 hover:bg-white/25 transition-all duration-200 cursor-pointer"
                    >
                      <History className="h-5 w-5 text-white" />
                      <span className="text-[11px] font-medium text-white/90">Activity</span>
                    </Link>
                  </TooltipTrigger>
                  <TooltipContent><p>View recent project activity</p></TooltipContent>
                </Tooltip>
              </div>
            </CardContent>
          </Card>
          )}

          {/* Row 2-3, Col 1-2 — Generated Artifacts Chart */}
          {cardVisibility.generatedArtifacts && (
          <Card className="card-animate card-glow-emerald md:col-span-2 flex flex-col min-h-[280px] rounded-2xl shadow-sm border border-border/40 border-l-[3px] border-l-emerald-500 relative overflow-hidden hover:shadow-md hover:-translate-y-0.5 transition-all duration-300" style={{ animationDelay: '0.3s' }}>
            <div className="absolute inset-0 dark:bg-gradient-to-br dark:from-emerald-500/5 dark:via-transparent dark:to-transparent pointer-events-none" />
            <CardHeader className="pb-2 relative">
              <CardTitle className="text-lg font-semibold">Generated Artifacts</CardTitle>
              <p className="text-sm text-muted-foreground">AI-generated content breakdown</p>
            </CardHeader>
            <CardContent className="relative flex-1 min-h-[260px]">
              <Suspense
                fallback={
                  <div className="flex h-full w-full items-center justify-center">
                    <Skeleton className="h-full w-full rounded-xl" />
                  </div>
                }
              >
                <WorkItemsChart data={workItemsData} />
              </Suspense>
            </CardContent>
          </Card>
          )}


          {/* Right Rail — Recent Projects */}
          {cardVisibility.recentProjects && (
            <Card className="card-animate card-glow-violet md:col-span-2 flex min-w-0 flex-col rounded-2xl shadow-sm border border-border/40 border-l-[3px] border-l-violet-500 hover:shadow-md hover:-translate-y-0.5 transition-all duration-300 overflow-hidden" style={{ animationDelay: '0.45s' }}>
              <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
                <CardTitle className="text-lg font-semibold">Recent Projects</CardTitle>
                <Button
                  asChild
                  variant="ghost"
                  size="sm"
                  className="text-violet-600 hover:text-violet-700 hover:bg-violet-50 dark:text-violet-400 dark:hover:bg-violet-950 rounded-lg text-xs"
                  data-testid="button-view-all-projects"
                >
                  <Link href="/projects">View all <ArrowRight className="h-3.5 w-3.5 ml-1" /></Link>
                </Button>
              </CardHeader>
              <CardContent className="min-h-[180px] pr-3 pb-3">
                <RecentProjectsList projects={metrics?.recentProjects || []} />
              </CardContent>
            </Card>
          )}
        </div>

        {/* Create Project Dialog */}
        <CreateProjectDialog
          open={createProjectDialogOpen}
          onOpenChange={setCreateProjectDialogOpen}
          onProjectCreated={handleProjectCreated}
        />

        {/* Add Organization Dialog */}
        <GenericModal
          open={addOrgDialogOpen}
          onOpenChange={setAddOrgDialogOpen}
          title="Add Organization"
          description="Add a new organization for artifacts management"
          icon={Building2}
          iconClassName="bg-gradient-to-br from-blue-500 to-blue-600"
          contentClassName="space-y-4"
          footerButtons={[
            {
              label: "Cancel",
              onClick: handleCloseAddOrgDialog,
              variant: "outline",
              "data-testid": "button-cancel-add-org",
            },
            {
              label: addOrgMutation.isPending
                ? "Adding..."
                : "Add Organization",
              onClick: handleAddOrganization,
              disabled: addOrgMutation.isPending,
              loading: addOrgMutation.isPending,
              "data-testid": "button-confirm-add-org",
            },
          ]}
        >
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="new-org-url">
                Organization URL <span className="text-destructive">*</span>
              </Label>
              <Input
                id="new-org-url"
                placeholder="https://dev.azure.com/YourOrg/"
                value={newOrgData.organizationUrl}
                onChange={handleOrgUrlChange}
                data-testid="input-new-org-url"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="new-org-pat">Personal Access Token</Label>
              <Input
                id="new-org-pat"
                type="password"
                placeholder="Enter your Azure DevOps PAT token"
                value={newOrgData.patToken}
                onChange={handlePatTokenChange}
                data-testid="input-new-org-pat"
              />
              <p className="text-xs text-muted-foreground">
                This token will be securely stored and used to access artifacts
                from this organization.
              </p>
            </div>
          </div>
        </GenericModal>
      </div>
    </TooltipProvider>
  );
}
