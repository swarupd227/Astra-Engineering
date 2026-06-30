import { useState, useEffect, useMemo } from "react";
import { GenericModal } from "@/components/ui/generic-modal";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Package,
  Rocket,
  Play,
  CheckCircle2,
  XCircle,
  Clock,
  AlertTriangle,
  ExternalLink,
  RefreshCw,
  Activity,
  TrendingUp,
  TrendingDown,
  Loader2,
  Lock,
  BookOpen,
  Code,
  FileCode,
  Layers,
  GitCommit,
  ArrowRight,
  Settings,
  Shield,
  Zap,
  Users,
  ArrowDown,
  ArrowUp,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useQuery } from "@tanstack/react-query";
import { getApiUrl } from "@/lib/api-config";
import { useAuth } from "@/contexts/auth-context";

interface Release {
  id: number;
  name: string;
  status: string;
  createdOn: string;
  modifiedOn: string;
  createdBy: {
    displayName: string;
  };
  environments: Array<{
    id: number;
    name: string;
    status: string;
    deploySteps?: Array<{
      id: number;
      status: string;
      name?: string;
    }>;
    conditions?: Array<{
      name: string;
      status: string;
      result?: string;
    }>;
    gates?: Array<{
      name: string;
      status: string;
      type?: string;
    }>;
  }>;
  releaseDefinition?: {
    id: number;
    name: string;
  };
  _links?: {
    web?: {
      href: string;
    };
  };
}

interface Approval {
  id: number;
  status: string;
  approver?: {
    displayName: string;
    uniqueName?: string;
  };
  release?: {
    id: number;
    name: string;
  };
  environment?: {
    id: number;
    name: string;
  };
  releaseDefinition?: {
    id: number;
    name: string;
  };
  createdOn?: string;
}

interface ReleaseDefinition {
  id: number;
  name: string;
  path: string;
}

interface DeploymentSummary {
  totalReleases: number;
  successfulReleases: number;
  failedReleases: number;
  pendingReleases: number;
  recentReleases: Release[];
}

interface DeploymentModalProps {
  projectId: string;
  adoProject?: {
    id: string;
    name: string;
    organization: string;
    organizationUrl: string;
  };
  open: boolean;
  onClose: () => void;
}

export function DeploymentModal({
  projectId,
  adoProject,
  open,
  onClose,
}: DeploymentModalProps) {
  const { toast } = useToast();
  const { user } = useAuth();

  const [selectedDefinition, setSelectedDefinition] = useState<string>("");
  const [expandedReleaseId, setExpandedReleaseId] = useState<number | null>(null);
  const [releaseDetails, setReleaseDetails] = useState<Record<number, any>>({});
  const [loadingDetails, setLoadingDetails] = useState<Record<number, boolean>>({});
  const [selectedReleaseForRollout, setSelectedReleaseForRollout] = useState<number | null>(null);
  const [selectedSprintPath, setSelectedSprintPath] = useState<string | null>(null);

  
  const currentUser = useMemo(() => {
    
    if (!user) return null;
    return {
      email: user.email || "",
      name: user.name || user.email || "",
    };
  }, [user]);

  // Fetch user deployment permissions
  const { data: deploymentPermissions } = useQuery<{
    canDeploy: boolean;
    role?: string;
    reason?: string;
  }>({
    queryKey: [
      "/api/sdlc/projects",
      projectId,
      "deployment-permissions",
      currentUser?.email,
      adoProject?.organization,
      adoProject?.name,
    ],
    queryFn: async () => {
      if (!currentUser?.email || !adoProject) {
        return {
          canDeploy: false,
          reason: "User or project information missing",
        };
      }

      const params = new URLSearchParams();
      params.append("userEmail", currentUser.email);
      if (adoProject.organization) {
        params.append("organization", adoProject.organization);
      }
      if (adoProject.name) {
        params.append("projectName", adoProject.name);
      }

      const permissionsUrl = getApiUrl(
        `/api/sdlc/projects/${projectId}/deployment-permissions?${params.toString()}`
      );
      const permissionsRes = await fetch(permissionsUrl, {
        credentials: "include",
      });

      if (!permissionsRes.ok) {
        // If endpoint doesn't exist yet, default to allowing (ADO will enforce)
        return { canDeploy: true, role: "default" };
      }

      return permissionsRes.json();
    },
    enabled: open && !!projectId && !!currentUser?.email && !!adoProject,
    staleTime: 5 * 60 * 1000, // Cache for 5 minutes
    retry: 1,
  });

  const canDeploy = deploymentPermissions?.canDeploy ?? true; // Default to true (ADO will enforce)
  const deploymentRole = deploymentPermissions?.role || "viewer";
  const permissionReason = deploymentPermissions?.reason;

  // Build query params for ADO project info
  const params = new URLSearchParams();
  if (adoProject?.organization) {
    params.append("organization", adoProject.organization);
  }
  if (adoProject?.name) {
    params.append("projectName", adoProject.name);
  }
  const queryString = params.toString();

  // Create unique query keys based on projectId and adoProject
  const configQueryKey = [
    `/api/sdlc/projects/${projectId}/ado-config`,
    queryString,
  ];
  const definitionsQueryKey = [
    "/api/sdlc/projects",
    projectId,
    "ado/release-definitions",
    adoProject?.organization,
    adoProject?.name,
  ];
  const releasesQueryKey = [
    "/api/sdlc/projects",
    projectId,
    "ado/releases",
    adoProject?.organization,
    adoProject?.name,
  ];
  const summaryQueryKey = [
    "/api/sdlc/projects",
    projectId,
    "ado/deployment-summary",
    adoProject?.organization,
    adoProject?.name,
    selectedSprintPath,
  ];
  const approvalsQueryKey = [
    "/api/sdlc/projects",
    projectId,
    "ado/approvals",
    adoProject?.organization,
    adoProject?.name,
  ];

  // Fetch ADO config (cached)
  const { data: adoConfig, error: configError } = useQuery<{
    hasConfig: boolean;
    organization: string;
    project: string;
  }>({
    queryKey: configQueryKey,
    queryFn: async () => {
      const configUrl = getApiUrl(
        `/api/sdlc/projects/${projectId}/ado-config${
          queryString ? `?${queryString}` : ""
        }`
      );
      const configRes = await fetch(configUrl, { credentials: "include" });

      if (!configRes.ok) {
        throw new Error(
          `Config fetch failed: ${configRes.status} ${configRes.statusText}`
        );
      }

      return configRes.json();
    },
    enabled: open && !!projectId,
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
    retry: 1,
  });

  const hasAdoConfig = adoConfig?.hasConfig || false;

  // Fetch sprints
  const { data: allSprints = [] } = useQuery<Array<{ path: string; name: string; startDate?: string; endDate?: string }>>({
    queryKey: [`/api/sdlc/projects/${projectId}/ado/sprints`, queryString],
    queryFn: async () => {
      if (!hasAdoConfig) {
        return [];
      }

      const sprintsUrl = getApiUrl(
        `/api/sdlc/projects/${projectId}/ado/sprints${
          queryString ? `?${queryString}` : ""
        }`
      );
      const sprintsRes = await fetch(sprintsUrl, { credentials: "include" });

      if (!sprintsRes.ok) {
        const errorText = await sprintsRes.text();
        console.warn(`[DeploymentModal] Failed to fetch sprints: ${sprintsRes.status}`, errorText);
        return [];
      }

      const sprints = await sprintsRes.json();
      return sprints;
    },
    enabled: open && !!projectId && hasAdoConfig,
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 10 * 60 * 1000, // 10 minutes
    retry: 1,
  });

  // Reset sprint selection when modal closes
  useEffect(() => {
    if (!open) {
      setSelectedSprintPath(null);
    }
  }, [open]);

  // Fetch release definitions (cached)
  const {
    data: definitions = [],
    error: definitionsError,
    refetch: refetchDefinitions,
  } = useQuery<ReleaseDefinition[]>({
    queryKey: definitionsQueryKey,
    queryFn: async () => {
      const defsUrl = getApiUrl(
        `/api/sdlc/projects/${projectId}/ado/release-definitions${
          queryString ? `?${queryString}` : ""
        }`
      );
      const defsRes = await fetch(defsUrl, { credentials: "include" });

      if (!defsRes.ok) {
        const errorData = await defsRes
          .json()
          .catch(() => ({ error: defsRes.statusText }));
        throw new Error(
          errorData.error || "Failed to fetch release definitions"
        );
      }

      return defsRes.json();
    },
    enabled: open && !!projectId && hasAdoConfig,
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
    retry: 1,
  });

  // Fetch releases (cached)
  const {
    data: releasesData,
    error: releasesError,
    isLoading: releasesLoading,
    refetch: refetchReleases,
  } = useQuery<Release[]>({
    queryKey: releasesQueryKey,
    queryFn: async () => {
      if (!adoProject?.organization || !adoProject?.name) {
        console.warn(
          "[Deployment Modal] Missing ADO project info, cannot fetch releases"
        );
        return [];
      }

      const releasesQuery = new URLSearchParams(queryString);
      releasesQuery.append('top', '20');
      if (selectedSprintPath) {
        releasesQuery.set('sprintPath', selectedSprintPath);
      }
      const url = getApiUrl(`/api/sdlc/projects/${projectId}/ado/releases?${releasesQuery.toString()}`);
      const fetchUrl = selectedSprintPath ? `${url}&_t=${Date.now()}` : url;
      const releasesRes = await fetch(fetchUrl, { 
        credentials: "include",
        cache: selectedSprintPath ? 'no-cache' : 'default'
      });

      if (!releasesRes.ok) {
        const errorData = await releasesRes
          .json()
          .catch(() => ({ error: releasesRes.statusText }));
        console.error(
          "[Deployment Modal] Failed to fetch releases:",
          releasesRes.status,
          errorData
        );
        throw new Error(errorData.error || "Failed to fetch releases");
      }

      const data = await releasesRes.json();

      // Handle both array and { value: [] } formats
      if (Array.isArray(data)) {
        return data;
      }
      // If it's an object with a value property, return that array
      if (data && typeof data === "object" && Array.isArray(data.value)) {
        return data.value;
      }
      // Fallback to empty array if format is unexpected
      return [];
    },
    enabled:
      open &&
      !!projectId &&
      !!adoProject &&
      !!adoProject.organization &&
      !!adoProject.name,
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
    retry: 1,
  });

  // Ensure releases is always an array
  const releases = Array.isArray(releasesData) ? releasesData : [];

  // Log releases for debugging
  useEffect(() => {
    if (open) {
      console.log("[Deployment Modal] Releases state:", {
        releasesData,
        releases,
        releasesLength: releases.length,
        releasesLoading,
        releasesError,
        hasAdoConfig,
        adoProject: adoProject
          ? { org: adoProject.organization, name: adoProject.name }
          : null,
      });
    }
  }, [
    open,
    releasesData,
    releases,
    releasesLoading,
    releasesError,
    hasAdoConfig,
    adoProject,
  ]);

  // Fetch deployment summary (cached)
  const {
    data: summary,
    error: summaryError,
    refetch: refetchSummary,
  } = useQuery<DeploymentSummary | null>({
    queryKey: summaryQueryKey,
    queryFn: async () => {
      const summaryUrl = getApiUrl(
        `/api/sdlc/projects/${projectId}/ado/deployment-summary?daysBack=30${
          queryString ? `&${queryString}` : ""
        }${selectedSprintPath ? `&sprintPath=${encodeURIComponent(selectedSprintPath)}` : ""}`
      );
      const fetchUrl = selectedSprintPath ? `${summaryUrl}&_t=${Date.now()}` : summaryUrl;
      const summaryRes = await fetch(fetchUrl, { credentials: "include", cache: selectedSprintPath ? 'no-cache' : 'default' });

      if (!summaryRes.ok) {
        const errorData = await summaryRes
          .json()
          .catch(() => ({ error: summaryRes.statusText }));
        throw new Error(
          errorData.error || "Failed to fetch deployment summary"
        );
      }

      return summaryRes.json();
    },
    enabled: open && !!projectId && hasAdoConfig,
    staleTime: selectedSprintPath ? 0 : 5 * 60 * 1000,
    gcTime: selectedSprintPath ? 0 : 10 * 60 * 1000,
    retry: 1,
  });

  // Fetch pending approvals (cached)
  const {
    data: approvalsData,
    error: approvalsError,
    refetch: refetchApprovals,
  } = useQuery<{ value: Approval[] } | Approval[]>({
    queryKey: approvalsQueryKey,
    queryFn: async () => {
      try {
        const approvalsUrl = getApiUrl(
          `/api/sdlc/projects/${projectId}/ado/approvals?status=pending${
            queryString ? `&${queryString}` : ""
          }`
        );
        const approvalsRes = await fetch(approvalsUrl, { credentials: "include" });

        if (!approvalsRes.ok) {
          // If endpoint doesn't exist or fails, return empty array
          return [];
        }

        const data = await approvalsRes.json();
        return Array.isArray(data) ? data : (data.value || []);
      } catch (error) {
        console.warn("[Deployment Modal] Could not fetch approvals:", error);
        return [];
      }
    },
    enabled: open && !!projectId && hasAdoConfig,
    staleTime: 2 * 60 * 1000,
    gcTime: 5 * 60 * 1000,
    retry: 1,
  });

  const approvals = useMemo(() => {
    if (!approvalsData) return [];
    return Array.isArray(approvalsData) ? approvalsData : (approvalsData.value || []);
  }, [approvalsData]);

  const loading = !adoConfig && open && !!projectId;
  const refreshing = false; // Individual queries handle their own isFetching states

  // Show error toasts
  useEffect(() => {
    if (configError) {
      toast({
        title: "Error",
        description:
          configError instanceof Error
            ? configError.message
            : "Failed to fetch ADO configuration",
        variant: "destructive",
      });
    }
  }, [configError, toast]);

  useEffect(() => {
    if (definitionsError) {
      toast({
        title: "Failed to fetch release definitions",
        description:
          definitionsError instanceof Error
            ? definitionsError.message
            : "Check your Azure DevOps configuration and permissions",
        variant: "destructive",
      });
    }
  }, [definitionsError, toast]);

  useEffect(() => {
    if (releasesError) {
      toast({
        title: "Failed to fetch releases",
        description:
          releasesError instanceof Error
            ? releasesError.message
            : "Check your Azure DevOps configuration",
        variant: "destructive",
      });
    }
  }, [releasesError, toast]);

  useEffect(() => {
    if (summaryError) {
      toast({
        title: "Failed to fetch deployment summary",
        description:
          summaryError instanceof Error
            ? summaryError.message
            : "Check your Azure DevOps configuration",
        variant: "destructive",
      });
    }
  }, [summaryError, toast]);

  const handleRefresh = async () => {
    await Promise.all([
      refetchDefinitions(),
      refetchReleases(),
      refetchSummary(),
      refetchApprovals(),
    ]);
  };

  // Get standard environment order for sequencing
  const getEnvironmentOrder = (envName: string): number => {
    const lower = envName.toLowerCase();
    if (lower.includes('dev') || lower.includes('development')) return 1;
    if (lower.includes('qa') || lower.includes('test')) return 2;
    if (lower.includes('uat') || lower.includes('staging')) return 3;
    if (lower.includes('prod') || lower.includes('production')) return 4;
    return 5; // Unknown environments go last
  };

  // Sort environments by standard order
  const getSortedEnvironments = (environments: Release['environments']) => {
    if (!environments) return [];
    return [...environments].sort((a, b) => {
      return getEnvironmentOrder(a.name) - getEnvironmentOrder(b.name);
    });
  };

  // Get rollout strategy (inferred from environment configuration)
  const getRolloutStrategy = (release: Release): string => {
    // This is a placeholder - in real implementation, this would come from ADO release definition
    const envCount = release.environments?.length || 0;
    if (envCount >= 4) return "Phased Rollout";
    if (envCount === 3) return "Standard (Dev → QA → Prod)";
    if (envCount === 2) return "Canary";
    return "Full Deployment";
  };

  // Check if environment can be promoted (previous environment succeeded)
  const canPromoteEnvironment = (release: Release, envIndex: number): boolean => {
    if (envIndex === 0) return true; // First environment can always be deployed
    const prevEnv = release.environments?.[envIndex - 1];
    return prevEnv?.status === "succeeded" || prevEnv?.status === "completed";
  };

  // Get approvals for a specific release and environment
  const getApprovalsForRelease = (releaseId: number, environmentId?: number): Approval[] => {
    return approvals.filter(approval => {
      if (approval.release?.id !== releaseId) return false;
      if (environmentId && approval.environment?.id !== environmentId) return false;
      return approval.status === "pending" || approval.status === "queued";
    });
  };

  const fetchReleaseDetails = async (releaseId: number) => {
    if (releaseDetails[releaseId]) {
      // Already fetched, just toggle
      setExpandedReleaseId(expandedReleaseId === releaseId ? null : releaseId);
      return;
    }

    if (!adoProject?.organization || !adoProject?.name) {
      toast({
        title: "Configuration Error",
        description: "Azure DevOps project information is missing",
        variant: "destructive",
      });
      return;
    }

    setLoadingDetails(prev => ({ ...prev, [releaseId]: true }));
    try {
      const params = new URLSearchParams();
      params.append('organization', adoProject.organization);
      params.append('projectName', adoProject.name);

      const detailsUrl = getApiUrl(`/api/sdlc/projects/${projectId}/ado/releases/${releaseId}/details?${params.toString()}`);
      const detailsRes = await fetch(detailsUrl, { credentials: "include" });
      
      // Check content type before parsing
      const contentType = detailsRes.headers.get("content-type");
      if (!contentType || !contentType.includes("application/json")) {
        const text = await detailsRes.text();
        console.error("[Deployment Modal] Server returned non-JSON response:", text.substring(0, 200));
        toast({
          title: "Invalid Response",
          description: "Server returned an invalid response. Please check your Azure DevOps configuration.",
          variant: "destructive",
        });
        return;
      }
      
      if (detailsRes.ok) {
        try {
          const data = await detailsRes.json();
          setReleaseDetails(prev => ({ ...prev, [releaseId]: data }));
          setExpandedReleaseId(releaseId);
        } catch (parseError: any) {
          console.error("[Deployment Modal] Error parsing JSON response:", parseError);
          toast({
            title: "Parse Error",
            description: "Failed to parse server response. Please try again.",
            variant: "destructive",
          });
        }
      } else {
        try {
          const errorData = await detailsRes.json();
          toast({
            title: "Failed to fetch release details",
            description: errorData.error || `Server returned ${detailsRes.status}`,
            variant: "destructive",
          });
        } catch (parseError: any) {
          const errorText = await detailsRes.text();
          toast({
            title: "Failed to fetch release details",
            description: `Server returned ${detailsRes.status}: ${errorText.substring(0, 100)}`,
            variant: "destructive",
          });
        }
      }
    } catch (error: any) {
      console.error("Error fetching release details:", error);
      toast({
        title: "Error",
        description: error.message || "Failed to fetch release details",
        variant: "destructive",
      });
    } finally {
      setLoadingDetails(prev => ({ ...prev, [releaseId]: false }));
    }
  };

  const handleCreateRelease = async () => {
    if (!selectedDefinition) {
      toast({
        title: "Select Release Pipeline",
        description: "Please select a release pipeline first",
        variant: "destructive",
      });
      return;
    }

    try {
      const releaseUrl = getApiUrl(
        `/api/sdlc/projects/${projectId}/ado/releases${
          queryString ? `?${queryString}` : ""
        }`
      );
      const response = await fetch(releaseUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          definitionId: Number(selectedDefinition),
          description: "Release created from DevPlatform",
          createdBy: currentUser?.email || "",
          createdByName: currentUser?.name || "",
        }),
      });

      if (response.ok) {
        const release = await response.json();
        toast({
          title: "Release Created",
          description: `Release ${release.name} created successfully`,
        });
        handleRefresh();
      } else {
        const error = await response.json();
        throw new Error(error.error || "Failed to create release");
      }
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to create release",
        variant: "destructive",
      });
    }
  };

  const handleTriggerDeployment = async (
    releaseId: number,
    environmentId: number,
    environmentName: string
  ) => {
    // Check permissions before attempting deployment
    if (!canDeploy) {
      toast({
        title: "Permission Denied",
        description:
          permissionReason ||
          "You do not have permission to deploy. Contact your administrator or configure permissions in Azure DevOps.",
        variant: "destructive",
      });
      return;
    }

    try {
      const deployUrl = getApiUrl(
        `/api/sdlc/projects/${projectId}/ado/releases/${releaseId}/deploy${
          queryString ? `?${queryString}` : ""
        }`
      );
      const response = await fetch(deployUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          environmentId,
          comment: `Deployment to ${environmentName} triggered from DevPlatform by ${
            currentUser?.email || "user"
          }`,
          deployedBy: currentUser?.email || "",
          deployedByName: currentUser?.name || "",
        }),
      });

      if (response.ok) {
        toast({
          title: "Deployment Triggered",
          description: `Deployment to ${environmentName} has been triggered`,
        });
        handleRefresh();
      } else {
        const error = await response
          .json()
          .catch(() => ({ error: response.statusText }));
        const errorMessage = error.error || "Failed to trigger deployment";

        // Check if it's a permission error from ADO
        if (
          response.status === 403 ||
          errorMessage.toLowerCase().includes("permission") ||
          errorMessage.toLowerCase().includes("unauthorized")
        ) {
          toast({
            title: "Deployment Blocked by Azure DevOps",
            description: `Azure DevOps has blocked this deployment. You may not have permission to deploy to ${environmentName}. Please check your permissions in Azure DevOps: Pipelines → Releases → Manage Security → Environment Security.`,
            variant: "destructive",
          });
        } else if (
          response.status === 400 ||
          errorMessage.toLowerCase().includes("not allowed") ||
          errorMessage.toLowerCase().includes("inprogress")
        ) {
          // Handle invalid state transitions (e.g., deploying to already inProgress environment)
          toast({
            title: "Deployment Not Allowed",
            description: errorMessage.includes("InProgress")
              ? `Cannot deploy: The environment "${environmentName}" is already in progress. Please wait for the current deployment to complete.`
              : errorMessage,
            variant: "destructive",
          });
        } else {
          toast({
            title: "Error",
            description: errorMessage,
            variant: "destructive",
          });
        }
      }
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to trigger deployment",
        variant: "destructive",
      });
    }
  };

  const getStatusIcon = (status: string) => {
    const lowerStatus = status?.toLowerCase() || "";
    if (lowerStatus.includes("succeeded") || lowerStatus.includes("active")) {
      return <CheckCircle2 className="h-4 w-4 text-green-500" />;
    } else if (
      lowerStatus.includes("failed") ||
      lowerStatus.includes("rejected") ||
      lowerStatus.includes("abandoned")
    ) {
      return <XCircle className="h-4 w-4 text-red-500" />;
    } else if (
      lowerStatus.includes("progress") ||
      lowerStatus.includes("pending")
    ) {
      return <Clock className="h-4 w-4 text-blue-500" />;
    }
    return <AlertTriangle className="h-4 w-4 text-yellow-500" />;
  };

  const getStatusBadge = (status: string) => {
    const lowerStatus = status?.toLowerCase() || "";
    if (lowerStatus.includes("succeeded") || lowerStatus.includes("active")) {
      return <Badge className="bg-green-500">Success</Badge>;
    } else if (
      lowerStatus.includes("failed") ||
      lowerStatus.includes("rejected") ||
      lowerStatus.includes("abandoned")
    ) {
      return <Badge variant="destructive">Failed</Badge>;
    } else if (
      lowerStatus.includes("progress") ||
      lowerStatus.includes("pending")
    ) {
      return <Badge className="bg-blue-500">In Progress</Badge>;
    }
    return <Badge variant="outline">{status}</Badge>;
  };

  if (loading && !hasAdoConfig) {
    return (
      <GenericModal
        open={open}
        onOpenChange={onClose}
        title="Deployment Management"
        description="Azure DevOps Release Management & Deployment"
        icon={Rocket}
        iconClassName="bg-gradient-to-br from-orange-500 to-orange-600"
        maxHeight="90vh"
      >
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </GenericModal>
    );
  }

  return (
    <GenericModal
      open={open}
      onOpenChange={onClose}
      title="Deployment Management"
      description="Azure DevOps Release Management & Deployment"
      icon={Rocket}
      iconClassName="bg-gradient-to-br from-orange-500 to-orange-600"
      fullScreen={true}
      contentClassName="space-y-4"
      headerActions={
        <div className="flex items-center gap-2">
          <Select
            value={selectedSprintPath || "all"}
            onValueChange={(value) => {
              if (value === "all") {
                setSelectedSprintPath(null);
              } else {
                setSelectedSprintPath(value);
              }
            }}
          >
            <SelectTrigger className="w-[220px]">
              <SelectValue placeholder="Choose Sprint">
                {selectedSprintPath && allSprints.length > 0
                  ? allSprints.find(s => s.path === selectedSprintPath)?.name || "Choose Sprint"
                  : "Choose Sprint"}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">
                <div className="flex flex-col">
                  <span>All Sprints</span>
                </div>
              </SelectItem>
              {allSprints.length > 0 ? (
                <>
                  {allSprints.map((sprint) => (
                    <SelectItem key={sprint.path} value={sprint.path}>
                      <div className="flex flex-col">
                        <span>{sprint.name}</span>
                        {sprint.startDate && sprint.endDate && (
                          <span className="text-xs text-muted-foreground">
                            {new Date(sprint.startDate).toLocaleDateString()} - {new Date(sprint.endDate).toLocaleDateString()}
                          </span>
                        )}
                      </div>
                    </SelectItem>
                  ))}
                </>
              ) : (
                <div className="px-2 py-1.5 text-sm text-muted-foreground">
                  No sprints available
                </div>
              )}
            </SelectContent>
          </Select>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleRefresh}
            disabled={refreshing}
          >
            <RefreshCw
              className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`}
            />
          </Button>
        </div>
      }
    >

      <div className="flex-1 overflow-auto">
        {!hasAdoConfig ? (
          <Card className="mt-6">
            <CardContent className="pt-6">
              <div className="text-center space-y-4">
                <AlertTriangle className="h-12 w-12 text-yellow-500 mx-auto" />
                <h3 className="text-lg font-semibold">
                  No Data Available
                </h3>
                <p className="text-muted-foreground">
                  No data is available for this metric at the moment.
                </p>
              </div>
            </CardContent>
          </Card>
        ) : (
          <Tabs defaultValue="overview" className="mt-6 h-full">
            <TabsList className="grid w-full grid-cols-4">
              <TabsTrigger value="overview">
                <Activity className="h-4 w-4 mr-2" />
                Overview
              </TabsTrigger>
              <TabsTrigger value="releases">
                <Package className="h-4 w-4 mr-2" />
                Releases
              </TabsTrigger>
              <TabsTrigger value="rollout">
                <Settings className="h-4 w-4 mr-2" />
                Rollout Management
              </TabsTrigger>
              <TabsTrigger value="create">
                <Play className="h-4 w-4 mr-2" />
                Create Release
              </TabsTrigger>
            </TabsList>

            {/* Overview Tab */}
            <TabsContent
              value="overview"
              className="space-y-6 mt-6 overflow-auto"
            >
              {summary ? (
                <>
                  <div className="grid grid-cols-4 gap-4">
                    <Card>
                      <CardHeader className="pb-2 flex items-center justify-between">
                        <CardTitle className="text-sm font-medium text-muted-foreground">
                          Total Releases
                        </CardTitle>
                        <div className="text-2xl font-bold">
                          {summary.totalReleases}
                        </div>
                      </CardHeader>
                    </Card>

                    <Card>
                      <CardHeader className="pb-2 flex items-center justify-between">
                        <CardTitle className="text-sm font-medium text-muted-foreground">
                          Successful
                        </CardTitle>
                        <div className="flex items-center gap-2">
                          <div className="text-2xl font-bold text-green-500">
                            {summary.successfulReleases}
                          </div>
                          <TrendingUp className="h-4 w-4 text-green-500" />
                        </div>
                      </CardHeader>
                    </Card>

                    <Card>
                      <CardHeader className="pb-2 flex items-center justify-between">
                        <CardTitle className="text-sm font-medium text-muted-foreground">
                          Failed
                        </CardTitle>
                        <div className="flex items-center gap-2">
                          <div className="text-xl font-bold text-red-500">
                            {summary.failedReleases}
                          </div>
                          <TrendingDown className="h-4 w-4 text-red-500" />
                        </div>
                      </CardHeader>
                    </Card>

                    <Card>
                      <CardHeader className="pb-2 flex items-center justify-between">
                        <CardTitle className="text-sm font-medium text-muted-foreground">
                          Pending
                        </CardTitle>
                        <div className="text-2xl font-bold text-blue-500">
                          {summary.pendingReleases}
                        </div>
                      </CardHeader>
                    </Card>
                  </div>

                  <Card>
                    <CardHeader>
                      <CardTitle>Recent Releases</CardTitle>
                      <CardDescription>
                        Latest releases from the past 30 days
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      <ScrollArea className="h-[3000px] pr-4">
                        <div className="space-y-4">
                          {summary.recentReleases?.length === 0 ? (
                            <p className="text-center text-muted-foreground py-8">
                              No releases found in the past 30 days
                            </p>
                          ) : (
                            (summary.recentReleases || []).map((release) => (
                              <Card key={release.id} className="hover-elevate">
                                <CardContent className="p-4">
                                  <div className="flex items-start justify-between">
                                    <div className="flex-1">
                                      <div className="flex items-center gap-2 mb-2">
                                        {getStatusIcon(release.status)}
                                        <h4 className="font-semibold">
                                          {release.name}
                                        </h4>
                                        {getStatusBadge(release.status)}
                                      </div>
                                      <p className="text-sm text-muted-foreground">
                                        Created{" "}
                                        {new Date(
                                          release.createdOn
                                        ).toLocaleDateString()}{" "}
                                        by {release.createdBy?.displayName}
                                      </p>
                                      {release.environments &&
                                        release.environments.length > 0 && (
                                          <div className="mt-2 flex flex-wrap gap-2">
                                            {release.environments.map((env) => (
                                              <Badge
                                                key={env.id}
                                                variant="outline"
                                                className="text-xs"
                                              >
                                                {env.name}: {env.status}
                                              </Badge>
                                            ))}
                                          </div>
                                        )}
                                    </div>
                                    {release._links?.web?.href && (
                                      <Button variant="ghost" size="sm" asChild>
                                        <a
                                          href={release._links.web.href}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                        >
                                          <ExternalLink className="h-4 w-4" />
                                        </a>
                                      </Button>
                                    )}
                                  </div>
                                </CardContent>
                              </Card>
                            ))
                          )}
                        </div>
                      </ScrollArea>
                    </CardContent>
                  </Card>
                </>
              ) : null}
            </TabsContent>

            {/* Releases Tab */}
            <TabsContent
              value="releases"
              className="space-y-6 mt-6 overflow-auto"
            >
              <Card>
                <CardHeader>
                  <CardTitle>All Releases</CardTitle>
                  <CardDescription>
                    View and manage all releases in Azure DevOps
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <ScrollArea className="h-[500px] pr-4">
                    <div className="space-y-4">
                      {releasesLoading ? (
                        <p className="text-center text-muted-foreground py-8">
                          Loading releases...
                        </p>
                      ) : releasesError ? (
                        <div className="text-center py-8">
                          <p className="text-destructive mb-2">
                            Failed to load releases
                          </p>
                          <p className="text-sm text-muted-foreground mb-4">
                            {releasesError instanceof Error
                              ? releasesError.message
                              : "Unknown error"}
                          </p>
                          <Button
                            onClick={() => refetchReleases()}
                            variant="outline"
                            size="sm"
                          >
                            <RefreshCw className="h-4 w-4 mr-2" />
                            Retry
                          </Button>
                        </div>
                      ) : releases.length === 0 ? (
                        <p className="text-center text-muted-foreground py-8">
                          No releases found
                        </p>
                      ) : (
                        releases.map((release) => (
                          <Card key={release.id} className="hover-elevate">
                            <CardContent className="p-4">
                              <div className="flex items-start justify-between mb-4">
                                <div className="flex-1">
                                  <div className="flex items-center gap-2 mb-2">
                                    {getStatusIcon(release.status)}
                                    <h4 className="font-semibold">
                                      {release.name}
                                    </h4>
                                    {getStatusBadge(release.status)}
                                  </div>
                                  <p className="text-sm text-muted-foreground">
                                    Created{" "}
                                    {new Date(
                                      release.createdOn
                                    ).toLocaleDateString()}{" "}
                                    by {release.createdBy?.displayName}
                                  </p>
                                </div>
                                {release._links?.web?.href && (
                                  <Button variant="ghost" size="sm" asChild>
                                    <a
                                      href={release._links.web.href}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                    >
                                      <ExternalLink className="h-4 w-4" />
                                    </a>
                                  </Button>
                                )}
                              </div>

                              {release.environments &&
                                release.environments.length > 0 && (
                                  <>
                                    <Separator className="my-3" />
                                    <div className="space-y-2">
                                      <h5 className="text-sm font-medium">
                                        Environments
                                      </h5>
                                      {release.environments.map((env) => (
                                        <div
                                          key={env.id}
                                          className="flex items-center justify-between p-2 bg-muted rounded-lg"
                                        >
                                          <div className="flex items-center gap-2">
                                            {getStatusIcon(env.status)}
                                            <span className="text-sm font-medium">
                                              {env.name}
                                            </span>
                                            <Badge
                                              variant="outline"
                                              className="text-xs"
                                            >
                                              {env.status}
                                            </Badge>
                                          </div>
                                          <TooltipProvider>
                                            <Tooltip>
                                              <TooltipTrigger asChild>
                                                <span>
                                                  <Button
                                                    size="sm"
                                                    variant="outline"
                                                    onClick={() =>
                                                      handleTriggerDeployment(
                                                        release.id,
                                                        env.id,
                                                        env.name
                                                      )
                                                    }
                                                    disabled={
                                                      env.status ===
                                                        "succeeded" ||
                                                      env.status?.toLowerCase() ===
                                                        "inprogress" ||
                                                      env.status?.toLowerCase() ===
                                                        "in progress" ||
                                                      !canDeploy
                                                    }
                                                    className={
                                                      !canDeploy ||
                                                      env.status?.toLowerCase() ===
                                                        "inprogress"
                                                        ? "opacity-50 cursor-not-allowed"
                                                        : ""
                                                    }
                                                  >
                                                    {!canDeploy ? (
                                                      <Lock className="h-3 w-3 mr-1" />
                                                    ) : (
                                                      <Play className="h-3 w-3 mr-1" />
                                                    )}
                                                    Deploy
                                                  </Button>
                                                </span>
                                              </TooltipTrigger>
                                              <TooltipContent>
                                                {!canDeploy ? (
                                                  <div>
                                                    <p className="text-sm">
                                                      {permissionReason ||
                                                        "You do not have permission to deploy. Contact your administrator or configure permissions in Azure DevOps."}
                                                    </p>
                                                    <p className="text-xs text-muted-foreground mt-1">
                                                      Note: Azure DevOps will
                                                      also enforce deployment
                                                      permissions.
                                                    </p>
                                                  </div>
                                                ) : env.status ===
                                                  "succeeded" ? (
                                                  <p className="text-sm">
                                                    This environment has already
                                                    been deployed successfully.
                                                  </p>
                                                ) : env.status?.toLowerCase() ===
                                                    "inprogress" ||
                                                  env.status?.toLowerCase() ===
                                                    "in progress" ? (
                                                  <p className="text-sm">
                                                    Deployment is already in
                                                    progress for this
                                                    environment. Please wait for
                                                    it to complete.
                                                  </p>
                                                ) : (
                                                  <p className="text-sm">
                                                    Deploy to {env.name}
                                                  </p>
                                                )}
                                              </TooltipContent>
                                            </Tooltip>
                                          </TooltipProvider>
                                        </div>
                                      ))}
                                    </div>
                                  </>
                                )}

                              {/* Linked User Stories */}
                              <Separator className="my-3" />
                              <div>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="w-full justify-between"
                                  onClick={() => fetchReleaseDetails(release.id)}
                                  disabled={loadingDetails[release.id]}
                                >
                                  <div className="flex items-center gap-2">
                                    <BookOpen className="h-4 w-4 text-muted-foreground" />
                                    <span className="text-xs text-muted-foreground font-medium">
                                      Linked User Stories
                                    </span>
                                  </div>
                                  {loadingDetails[release.id] ? (
                                    <RefreshCw className="h-3 w-3 animate-spin" />
                                  ) : (
                                    <span className="text-xs text-muted-foreground">
                                      {expandedReleaseId === release.id ? 'Hide' : 'Show'}
                                    </span>
                                  )}
                                </Button>

                                {expandedReleaseId === release.id && releaseDetails[release.id] && (
                                  <div className="mt-3 space-y-3">
                                    {releaseDetails[release.id].userStories && releaseDetails[release.id].userStories.length > 0 ? (
                                      releaseDetails[release.id].userStories.map((story: any, idx: number) => {
                                        const storyId = story.id || story.fields?.['System.Id'];
                                        const storyTitle = story.fields?.['System.Title'] || story.title || 'Untitled';
                                        const storyState = story.fields?.['System.State'] || story.state || 'Unknown';
                                        
                                        return (
                                          <Card key={idx} className="p-3 bg-muted/50">
                                            <div className="space-y-2">
                                              <div className="flex items-start justify-between gap-2">
                                                <div className="flex-1">
                                                  <a
                                                    href={story.url || (adoProject ? `https://dev.azure.com/${adoProject.organization}/${adoProject.name}/_workitems/edit/${storyId}` : '#')}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    className="font-medium text-sm hover:underline flex items-center gap-1"
                                                  >
                                                    User Story {storyId}: {storyTitle}
                                                    <ExternalLink className="h-3 w-3" />
                                                  </a>
                                                  <Badge variant="outline" className="mt-1 text-xs">
                                                    {storyState}
                                                  </Badge>
                                                </div>
                                              </div>

                                              {/* Linked Items */}
                                              <div className="grid grid-cols-2 gap-2 text-xs">
                                                {story.linkedPRs && story.linkedPRs.length > 0 && (
                                                  <div className="flex items-center gap-1 text-muted-foreground">
                                                    <GitCommit className="h-3 w-3" />
                                                    <span>{story.linkedPRs.length} PR{story.linkedPRs.length !== 1 ? 's' : ''}</span>
                                                  </div>
                                                )}
                                                {story.linkedCommits && story.linkedCommits.length > 0 && (
                                                  <div className="flex items-center gap-1 text-muted-foreground">
                                                    <Code className="h-3 w-3" />
                                                    <span>{story.linkedCommits.length} Commit{story.linkedCommits.length !== 1 ? 's' : ''}</span>
                                                  </div>
                                                )}
                                                {story.linkedBuilds && story.linkedBuilds.length > 0 && (
                                                  <div className="flex items-center gap-1 text-muted-foreground">
                                                    <Layers className="h-3 w-3" />
                                                    <span>{story.linkedBuilds.length} Build{story.linkedBuilds.length !== 1 ? 's' : ''}</span>
                                                  </div>
                                                )}
                                                {story.linkedArtifacts && story.linkedArtifacts.length > 0 && (
                                                  <div className="flex items-center gap-1 text-muted-foreground">
                                                    <FileCode className="h-3 w-3" />
                                                    <span>{story.linkedArtifacts.length} Artifact{story.linkedArtifacts.length !== 1 ? 's' : ''}</span>
                                                  </div>
                                                )}
                                              </div>
                                            </div>
                                          </Card>
                                        );
                                      })
                                    ) : (
                                      <p className="text-xs text-muted-foreground text-center py-2">
                                        No user stories linked to this release
                                      </p>
                                    )}
                                  </div>
                                )}
                              </div>
                            </CardContent>
                          </Card>
                        ))
                      )}
                    </div>
                  </ScrollArea>
                </CardContent>
              </Card>
            </TabsContent>

            {/* Rollout Management Tab */}
            <TabsContent
              value="rollout"
              className="space-y-6 mt-6 overflow-auto"
            >
              <Card>
                <CardHeader>
                  <CardTitle>Rollout Management</CardTitle>
                  <CardDescription>
                    Control deployment sequencing, environment promotion, approval flows, and gates
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  {/* Select Release */}
                  <div className="space-y-2">
                    <Label>Select Release to Manage</Label>
                    <Select
                      value={selectedReleaseForRollout?.toString() || ""}
                      onValueChange={(value) => setSelectedReleaseForRollout(parseInt(value))}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select a release to manage rollout..." />
                      </SelectTrigger>
                      <SelectContent>
                        {releases.length === 0 ? (
                          <div className="p-2 text-sm text-muted-foreground">
                            No releases found
                          </div>
                        ) : (
                          releases.map((release) => (
                            <SelectItem key={release.id} value={release.id.toString()}>
                              {release.name} - {release.releaseDefinition?.name || 'Unknown Pipeline'}
                            </SelectItem>
                          ))
                        )}
                      </SelectContent>
                    </Select>
                  </div>

                  {selectedReleaseForRollout && (() => {
                    const selectedRelease = releases.find(r => r.id === selectedReleaseForRollout);
                    if (!selectedRelease) return null;

                    const sortedEnvs = getSortedEnvironments(selectedRelease.environments || []);
                    const rolloutStrategy = getRolloutStrategy(selectedRelease);

                    return (
                      <div className="space-y-6">
                        {/* Rollout Strategy */}
                        <Card className="bg-muted/50">
                          <CardHeader className="pb-3">
                            <CardTitle className="text-sm flex items-center gap-2">
                              <Zap className="h-4 w-4" />
                              Rollout Strategy
                            </CardTitle>
                          </CardHeader>
                          <CardContent>
                            <div className="flex items-center gap-2">
                              <Badge variant="outline" className="text-sm">
                                {rolloutStrategy}
                              </Badge>
                              <span className="text-sm text-muted-foreground">
                                {sortedEnvs.length} environment{sortedEnvs.length !== 1 ? 's' : ''} configured
                              </span>
                            </div>
                          </CardContent>
                        </Card>

                        {/* Deployment Sequencing */}
                        <Card>
                          <CardHeader>
                            <CardTitle className="text-base">Deployment Sequencing</CardTitle>
                            <CardDescription>
                              Environment promotion flow and current deployment status
                            </CardDescription>
                          </CardHeader>
                          <CardContent>
                            <div className="space-y-4">
                              {sortedEnvs.length === 0 ? (
                                <p className="text-sm text-muted-foreground text-center py-4">
                                  No environments configured for this release
                                </p>
                              ) : (
                                sortedEnvs.map((env, index) => {
                                  const canPromote = canPromoteEnvironment(selectedRelease, index);
                                  const envApprovals = getApprovalsForRelease(selectedRelease.id, env.id);
                                  const hasPendingApprovals = envApprovals.length > 0;
                                  const isBlocked = !canPromote || hasPendingApprovals;

                                  return (
                                    <div key={env.id} className="relative">
                                      {/* Connection Line */}
                                      {index < sortedEnvs.length - 1 && (
                                        <div className="absolute left-6 top-12 w-0.5 h-8 bg-border z-0" />
                                      )}

                                      <Card className={`relative z-10 ${
                                        isBlocked ? "border-amber-200 bg-amber-50/50 dark:bg-amber-950/20" : ""
                                      }`}>
                                        <CardContent className="p-4">
                                          <div className="flex items-start justify-between">
                                            <div className="flex items-start gap-3 flex-1">
                                              <div className="mt-1">
                                                {getStatusIcon(env.status)}
                                              </div>
                                              <div className="flex-1">
                                                <div className="flex items-center gap-2 mb-2">
                                                  <h4 className="font-semibold">{env.name}</h4>
                                                  {getStatusBadge(env.status)}
                                                  {hasPendingApprovals && (
                                                    <Badge variant="outline" className="border-amber-500 text-amber-700 dark:text-amber-400">
                                                      <Lock className="h-3 w-3 mr-1" />
                                                      Pending Approval
                                                    </Badge>
                                                  )}
                                                  {!canPromote && index > 0 && (
                                                    <Badge variant="outline" className="border-red-500 text-red-700 dark:text-red-400">
                                                      <AlertTriangle className="h-3 w-3 mr-1" />
                                                      Blocked
                                                    </Badge>
                                                  )}
                                                </div>

                                                {/* Deployment Status Details */}
                                                <div className="space-y-2 text-sm">
                                                  <div className="flex items-center gap-2 text-muted-foreground">
                                                    <Clock className="h-3 w-3" />
                                                    <span>Status: {env.status || "Not Started"}</span>
                                                  </div>

                                                  {/* Pending Approvals */}
                                                  {hasPendingApprovals && (
                                                    <div className="mt-2 p-2 bg-amber-50 dark:bg-amber-950/30 rounded border border-amber-200 dark:border-amber-800">
                                                      <div className="flex items-center gap-2 mb-1">
                                                        <Lock className="h-3 w-3 text-amber-600" />
                                                        <span className="font-medium text-xs text-amber-900 dark:text-amber-100">
                                                          Pending Approvals ({envApprovals.length})
                                                        </span>
                                                      </div>
                                                      {envApprovals.map((approval) => (
                                                        <div key={approval.id} className="text-xs text-amber-700 dark:text-amber-300 ml-5">
                                                          {approval.approver?.displayName || "Unknown"} - {approval.status}
                                                        </div>
                                                      ))}
                                                    </div>
                                                  )}

                                                  {/* Gates/Conditions */}
                                                  {env.gates && env.gates.length > 0 && (
                                                    <div className="mt-2 space-y-1">
                                                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                                        <Shield className="h-3 w-3" />
                                                        <span>Gates:</span>
                                                      </div>
                                                      {env.gates.map((gate, gateIdx) => (
                                                        <div key={gateIdx} className="ml-5 text-xs">
                                                          <Badge variant="outline" className="text-xs">
                                                            {gate.name} - {gate.status}
                                                          </Badge>
                                                        </div>
                                                      ))}
                                                    </div>
                                                  )}

                                                  {/* Conditions */}
                                                  {env.conditions && env.conditions.length > 0 && (
                                                    <div className="mt-2 space-y-1">
                                                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                                        <Settings className="h-3 w-3" />
                                                        <span>Conditions:</span>
                                                      </div>
                                                      {env.conditions.map((condition, condIdx) => (
                                                        <div key={condIdx} className="ml-5 text-xs">
                                                          <Badge variant="outline" className={`text-xs ${
                                                            condition.result === "failed" ? "border-red-500 text-red-700" : ""
                                                          }`}>
                                                            {condition.name} - {condition.status}
                                                          </Badge>
                                                        </div>
                                                      ))}
                                                    </div>
                                                  )}
                                                </div>
                                              </div>
                                            </div>

                                            {/* Promotion Controls */}
                                            <div className="flex flex-col gap-2">
                                              {index < sortedEnvs.length - 1 && (
                                                <TooltipProvider>
                                                  <Tooltip>
                                                    <TooltipTrigger asChild>
                                                      <span>
                                                        <Button
                                                          size="sm"
                                                          variant="outline"
                                                          onClick={() => {
                                                            const nextEnv = sortedEnvs[index + 1];
                                                            if (nextEnv) {
                                                              handleTriggerDeployment(
                                                                selectedRelease.id,
                                                                nextEnv.id,
                                                                nextEnv.name
                                                              );
                                                            }
                                                          }}
                                                          disabled={!canPromote || env.status !== "succeeded" || !canDeploy}
                                                          className="w-full"
                                                        >
                                                          <ArrowDown className="h-3 w-3 mr-1" />
                                                          Promote
                                                        </Button>
                                                      </span>
                                                    </TooltipTrigger>
                                                    <TooltipContent>
                                                      {!canPromote ? (
                                                        <p className="text-sm">Previous environment must succeed first</p>
                                                      ) : env.status !== "succeeded" ? (
                                                        <p className="text-sm">Current environment must succeed before promotion</p>
                                                      ) : !canDeploy ? (
                                                        <p className="text-sm">You do not have permission to deploy</p>
                                                      ) : (
                                                        <p className="text-sm">Promote to {sortedEnvs[index + 1]?.name}</p>
                                                      )}
                                                    </TooltipContent>
                                                  </Tooltip>
                                                </TooltipProvider>
                                              )}
                                              <Button
                                                size="sm"
                                                variant="outline"
                                                onClick={() => handleTriggerDeployment(selectedRelease.id, env.id, env.name)}
                                                disabled={env.status === "succeeded" || env.status?.toLowerCase() === "inprogress" || !canDeploy}
                                                className="w-full"
                                              >
                                                <Play className="h-3 w-3 mr-1" />
                                                Deploy
                                              </Button>
                                            </div>
                                          </div>
                                        </CardContent>
                                      </Card>
                                    </div>
                                  );
                                })
                              )}
                            </div>
                          </CardContent>
                        </Card>

                        {/* Approval Flows */}
                        {approvals.length > 0 && (
                          <Card>
                            <CardHeader>
                              <CardTitle className="text-base flex items-center gap-2">
                                <Lock className="h-4 w-4" />
                                Approval Flows
                              </CardTitle>
                              <CardDescription>
                                Pending approvals blocking deployment progression
                              </CardDescription>
                            </CardHeader>
                            <CardContent>
                              <div className="space-y-3">
                                {approvals
                                  .filter(a => a.release?.id === selectedRelease.id)
                                  .map((approval) => (
                                    <Card key={approval.id} className="border-amber-200 bg-amber-50 dark:bg-amber-950/20">
                                      <CardContent className="p-3">
                                        <div className="flex items-center justify-between">
                                          <div>
                                            <div className="flex items-center gap-2 mb-1">
                                              <Lock className="h-4 w-4 text-amber-600" />
                                              <span className="font-medium text-sm">
                                                {approval.environment?.name || "Unknown Environment"}
                                              </span>
                                            </div>
                                            <p className="text-xs text-muted-foreground">
                                              Awaiting approval from {approval.approver?.displayName || "approver"}
                                            </p>
                                          </div>
                                          <Badge variant="outline" className="border-amber-500 text-amber-700 dark:text-amber-400">
                                            {approval.status}
                                          </Badge>
                                        </div>
                                      </CardContent>
                                    </Card>
                                  ))}
                              </div>
                            </CardContent>
                          </Card>
                        )}
                      </div>
                    );
                  })()}
                </CardContent>
              </Card>
            </TabsContent>

            {/* Create Release Tab */}
            <TabsContent
              value="create"
              className="space-y-6 mt-6 overflow-auto"
            >
              <Card>
                <CardHeader>
                  <CardTitle>Create New Release</CardTitle>
                  <CardDescription>
                    Create a new release from a release pipeline
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="space-y-2">
                    <label className="text-sm font-medium">
                      Release Pipeline
                    </label>
                    <Select
                      value={selectedDefinition}
                      onValueChange={setSelectedDefinition}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select a release pipeline" />
                      </SelectTrigger>
                      <SelectContent>
                        {definitions.map((def) => (
                          <SelectItem key={def.id} value={def.id.toString()}>
                            {def.name} {def.path && `(${def.path})`}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <Button
                    onClick={handleCreateRelease}
                    disabled={!selectedDefinition}
                    className="w-full"
                  >
                    <Rocket className="h-4 w-4 mr-2" />
                    Create Release
                  </Button>

                  {definitions.length === 0 && (
                    <div className="bg-muted p-4 rounded-lg text-sm text-muted-foreground text-center">
                      No release pipelines found. Please create a release
                      pipeline in Azure DevOps first.
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        )}
      </div>
    </GenericModal>
  );
}

