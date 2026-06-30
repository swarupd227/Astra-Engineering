import { useState, useEffect, useMemo } from "react";
import { GenericModal } from "@/components/ui/generic-modal";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  GitBranch,
  RefreshCw,
  CheckCircle2,
  XCircle,
  Clock,
  AlertTriangle,
  PlayCircle,
  Rocket,
  ExternalLink,
  User,
  Calendar,
  Lock,
  Loader2,
  Tag,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useQuery } from "@tanstack/react-query";
import { getApiUrl } from "@/lib/api-config";

interface ADOProject {
  id: string;
  name: string;
  organization: string;
  organizationUrl: string;
}

interface PipelineModalProps {
  projectId: string;
  adoProject?: ADOProject;
  providerSegment?: "ado" | "gitlab" | "bitbucket" | "github";
  open: boolean;
  onClose: () => void;
}

interface ReleaseDefinition {
  id: number;
  name: string;
  path?: string;
}

interface ReleaseEnvironment {
  id: number;
  name: string;
  status: string;
  deploySteps?: Array<{
    id: number;
    status: string;
  }>;
}

interface Release {
  id: number;
  name: string;
  status: string;
  createdOn: string;
  modifiedOn?: string;
  releaseDefinition?: {
    id: number;
    name: string;
    path?: string;
  };
  environments?: ReleaseEnvironment[];
  _links?: {
    web?: {
      href: string;
    };
  };
}

interface ExternalPipelineEntry {
  id: number;
  name?: string;
  path?: string;
  url?: string;
  entryKind?: "run" | "placeholder";
}

interface ReleasePipelineData {
  definition: ReleaseDefinition;
  lastRelease?: Release;
  approvals?: Array<{
    id: number;
    status: string;
    approver?: {
      displayName: string;
    };
    environment?: {
      name: string;
    };
  }>;
}

export function PipelineModal({ projectId, adoProject, providerSegment = "ado", open, onClose }: PipelineModalProps) {
  const { toast } = useToast();
  const isGitLab = providerSegment === "gitlab";
  const isBitbucket = providerSegment === "bitbucket";
  const isGithub = providerSegment === "github";
  const isExternalCi = isGitLab || isBitbucket || isGithub;

  const [selectedSprintPath, setSelectedSprintPath] = useState<string | null>(null);

  // Build query params for ADO project info
  const params = new URLSearchParams();
  if (adoProject?.organization) {
    params.append('organization', adoProject.organization);
  }
  if (adoProject?.name) {
    params.append('projectName', adoProject.name);
  }
  const queryString = params.toString();

  // Fetch ADO config
  const { data: providerConfig, error: configError } = useQuery<{ hasConfig: boolean; organization?: string; project?: string }>({
    queryKey: [`/api/sdlc/projects/${projectId}/${providerSegment}-config`, queryString],
    queryFn: async () => {
      if (isExternalCi) {
        const ciKey = isBitbucket ? "bitbucket" : isGithub ? "github" : "gitlab";
        const contextUrl = getApiUrl(
          `/api/sdlc/projects/${projectId}/${ciKey}/context-status${queryString ? `?${queryString}` : ""}`,
        );
        const gitlabRes = await fetch(contextUrl, { credentials: "include" });
        if (!gitlabRes.ok) return { hasConfig: false };
        const gitlabContext = await gitlabRes.json();
        return { hasConfig: Boolean(gitlabContext?.hasConfig) };
      }
      const configUrl = getApiUrl(`/api/sdlc/projects/${projectId}/ado-config${queryString ? `?${queryString}` : ''}`);
      const configRes = await fetch(configUrl, { credentials: "include" });

      if (!configRes.ok) {
        throw new Error(`Configuration check failed: ${configRes.status} ${configRes.statusText}`);
      }

      const contentType = configRes.headers.get("content-type");
      if (!contentType || !contentType.includes("application/json")) {
        throw new Error("Server returned invalid response. Please check if the server is running correctly.");
      }

      return configRes.json();
    },
    enabled: open && !!projectId && (!!adoProject || isExternalCi),
    staleTime: 5 * 60 * 1000,
  });

  const hasProviderConfig = providerConfig?.hasConfig || false;

  // Fetch sprints
  const { data: allSprints = [] } = useQuery<Array<{ path: string; name: string; startDate?: string; endDate?: string }>>({
    queryKey: [`/api/sdlc/projects/${projectId}/ado/sprints`, queryString],
    queryFn: async () => {
      if (!hasProviderConfig || isExternalCi) {
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
        console.warn(`[PipelineModal] Failed to fetch sprints: ${sprintsRes.status}`, errorText);
        return [];
      }

      const sprints = await sprintsRes.json();
      return sprints;
    },
    enabled: open && !!projectId && hasProviderConfig && !isExternalCi,
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

  // Fetch release definitions
  const { data: definitionsData, isLoading: loadingDefinitions } = useQuery<{ value: ReleaseDefinition[] } | ReleaseDefinition[]>({
    queryKey: [`/api/sdlc/projects/${projectId}/${providerSegment}/release-definitions`, queryString],
    queryFn: async () => {
      if (!hasProviderConfig || isExternalCi) return { value: [] };
      const definitionsUrl = getApiUrl(`/api/sdlc/projects/${projectId}/${providerSegment}/release-definitions${queryString ? `?${queryString}` : ''}`);
      const definitionsRes = await fetch(definitionsUrl, { credentials: "include" });
      
      if (!definitionsRes.ok) {
        const errorText = await definitionsRes.text();
        throw new Error(`Failed to fetch release definitions: ${definitionsRes.status} - ${errorText}`);
      }

      return definitionsRes.json();
    },
    enabled: open && !!projectId && hasProviderConfig && !isExternalCi,
    staleTime: 2 * 60 * 1000,
  });

  // Fetch releases
  const { data: releasesData, isLoading: loadingReleases, refetch: refetchReleases } = useQuery<{ value: Release[] } | Release[]>({
    queryKey: [`/api/sdlc/projects/${projectId}/${providerSegment}/releases`, queryString, selectedSprintPath],
    queryFn: async () => {
      if (!hasProviderConfig) return { value: [] };
      const releasesQuery = new URLSearchParams(queryString);
      if (selectedSprintPath && !isExternalCi) {
        releasesQuery.set('sprintPath', selectedSprintPath);
      }
      const url = getApiUrl(`/api/sdlc/projects/${projectId}/${providerSegment}/releases${releasesQuery.toString() ? `?${releasesQuery.toString()}` : ''}`);
      const fetchUrl = selectedSprintPath && !isExternalCi ? `${url}&_t=${Date.now()}` : url;
      const releasesRes = await fetch(fetchUrl, { 
        credentials: "include",
        cache: selectedSprintPath && !isExternalCi ? 'no-cache' : 'default'
      });
      
      if (!releasesRes.ok) {
        throw new Error(`Failed to fetch releases: ${releasesRes.status} ${releasesRes.statusText}`);
      }

      return releasesRes.json();
    },
    enabled: open && !!projectId && hasProviderConfig,
    staleTime: selectedSprintPath ? 0 : 2 * 60 * 1000,
    gcTime: selectedSprintPath ? 0 : 5 * 60 * 1000,
  });

  const { data: externalPipelinesData, isLoading: loadingExternalPipelines } = useQuery<{ value: ExternalPipelineEntry[] } | ExternalPipelineEntry[]>({
    queryKey: [`/api/sdlc/projects/${projectId}/${providerSegment}/pipelines`, queryString],
    queryFn: async () => {
      if (!hasProviderConfig || !isExternalCi) return { value: [] };
      const pipelinesUrl = getApiUrl(`/api/sdlc/projects/${projectId}/${providerSegment}/pipelines${queryString ? `?${queryString}` : ""}`);
      const pipelinesRes = await fetch(pipelinesUrl, { credentials: "include" });
      if (!pipelinesRes.ok) {
        throw new Error(`Failed to fetch pipelines: ${pipelinesRes.status} ${pipelinesRes.statusText}`);
      }
      return pipelinesRes.json();
    },
    enabled: open && !!projectId && hasProviderConfig && isExternalCi,
    staleTime: 2 * 60 * 1000,
  });

  // Fetch pending approvals
  const { data: approvalsData } = useQuery<{ value: any[] } | any[]>({
    queryKey: [`/api/sdlc/projects/${projectId}/${providerSegment}/approvals`, queryString],
    queryFn: async () => {
      if (!hasProviderConfig || isExternalCi) return { value: [] };
      const approvalsParams = new URLSearchParams(queryString);
      approvalsParams.append('status', 'pending');
      const approvalsUrl = getApiUrl(`/api/sdlc/projects/${projectId}/${providerSegment}/approvals?${approvalsParams.toString()}`);
      const approvalsRes = await fetch(approvalsUrl, { credentials: "include" });
      
      if (!approvalsRes.ok) {
        return { value: [] }; // Don't throw, approvals are optional
      }

      return approvalsRes.json();
    },
    enabled: open && !!projectId && hasProviderConfig && !isExternalCi,
    staleTime: 2 * 60 * 1000,
    retry: false, // Don't retry on failure for approvals
  });

  // Process data
  const releasePipelines = useMemo(() => {
    const definitions = Array.isArray(definitionsData) ? definitionsData : (definitionsData?.value || []);
    const releases = Array.isArray(releasesData) ? releasesData : (releasesData?.value || []);
    const approvals = Array.isArray(approvalsData) ? approvalsData : (approvalsData?.value || []);

    // Group releases by definition and get the latest release for each
    const releasesByDefinition = new Map<number, Release>();
    releases.forEach((release) => {
      const defId = release.releaseDefinition?.id;
      if (defId) {
        const existing = releasesByDefinition.get(defId);
        if (!existing || new Date(release.createdOn) > new Date(existing.createdOn)) {
          releasesByDefinition.set(defId, release);
        }
      }
    });

    // Group approvals by release definition
    const approvalsByDefinition = new Map<number, any[]>();
    approvals.forEach((approval) => {
      const releaseId = approval.release?.id;
      if (releaseId) {
        const release = releases.find(r => r.id === releaseId);
        const defId = release?.releaseDefinition?.id;
        if (defId) {
          if (!approvalsByDefinition.has(defId)) {
            approvalsByDefinition.set(defId, []);
          }
          approvalsByDefinition.get(defId)!.push(approval);
        }
      }
    });

    // Combine definitions with their latest release and approvals
    return definitions.map((def) => ({
      definition: def,
      lastRelease: releasesByDefinition.get(def.id),
      approvals: approvalsByDefinition.get(def.id) || [],
    }));
  }, [definitionsData, releasesData, approvalsData]);

  const loading = loadingDefinitions || loadingReleases || loadingExternalPipelines;
  const refreshing = false; // React Query handles this

  const handleRefresh = async () => {
    await refetchReleases();
  };

  const getEnvironmentStatusIcon = (status: string) => {
    if (status === "succeeded" || status === "completed") {
      return <CheckCircle2 className="h-4 w-4 text-green-600" />;
    }
    if (status === "failed" || status === "rejected") {
      return <XCircle className="h-4 w-4 text-red-600" />;
    }
    if (status === "inProgress" || status === "queued" || status === "inProgress") {
      return <Clock className="h-4 w-4 text-blue-600" />;
    }
    if (status === "notStarted" || status === "undefined") {
      return <PlayCircle className="h-4 w-4 text-gray-600" />;
    }
    return <AlertTriangle className="h-4 w-4 text-yellow-600" />;
  };

  const getEnvironmentStatusColor = (status: string) => {
    if (status === "succeeded" || status === "completed") {
      return "bg-green-500";
    }
    if (status === "failed" || status === "rejected") {
      return "bg-red-500";
    }
    if (status === "inProgress" || status === "queued") {
      return "bg-blue-500";
    }
    if (status === "notStarted" || status === "undefined") {
      return "bg-gray-500";
    }
    return "bg-yellow-500";
  };

  const getEnvironmentStatusText = (status: string) => {
    if (status === "succeeded" || status === "completed") return "Succeeded";
    if (status === "failed" || status === "rejected") return "Failed";
    if (status === "inProgress" || status === "queued") return "In Progress";
    if (status === "notStarted" || status === "undefined") return "Not Started";
    return status || "Unknown";
  };

  const formatDate = (dateString: string) => {
    if (!dateString) return "N/A";
    return new Date(dateString).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const getEnvironmentName = (envName: string): string => {
    const lower = envName.toLowerCase();
    if (lower.includes('dev') || lower.includes('development')) return 'Dev';
    if (lower.includes('qa') || lower.includes('test')) return 'QA';
    if (lower.includes('uat') || lower.includes('staging')) return 'UAT';
    if (lower.includes('prod') || lower.includes('production')) return 'Production';
    return envName;
  };

  const getStandardEnvironments = (environments?: ReleaseEnvironment[]) => {
    if (!environments || environments.length === 0) return [];
    
    // Map to standard environment names
    const envMap = new Map<string, ReleaseEnvironment>();
    environments.forEach(env => {
      const standardName = getEnvironmentName(env.name);
      envMap.set(standardName, env);
    });

    // Return in standard order: Dev, QA, UAT, Production
    const standardOrder = ['Dev', 'QA', 'UAT', 'Production'];
    const result: Array<{ name: string; env?: ReleaseEnvironment }> = [];
    
    standardOrder.forEach(name => {
      if (envMap.has(name)) {
        result.push({ name, env: envMap.get(name) });
      }
    });

    // Add any other environments that don't match standard names
    environments.forEach(env => {
      const standardName = getEnvironmentName(env.name);
      if (!standardOrder.includes(standardName)) {
        result.push({ name: env.name, env });
      }
    });

    return result;
  };

  // Calculate statistics
  const statistics = useMemo(() => {
    let activeReleases = 0;
    let succeededEnvironments = 0;
    let failedEnvironments = 0;
    let pendingApprovals = 0;
    let totalEnvironments = 0;

    releasePipelines.forEach((pipeline) => {
      if (pipeline.lastRelease) {
        activeReleases++;
        const envs = pipeline.lastRelease.environments || [];
        totalEnvironments += envs.length;
        envs.forEach(env => {
          if (env.status === "succeeded" || env.status === "completed") {
            succeededEnvironments++;
          } else if (env.status === "failed" || env.status === "rejected") {
            failedEnvironments++;
          }
        });
      }
      if (pipeline.approvals && pipeline.approvals.length > 0) {
        pendingApprovals += pipeline.approvals.length;
      }
    });

    return {
      totalPipelines: releasePipelines.length,
      activeReleases,
      succeededEnvironments,
      failedEnvironments,
      pendingApprovals,
      totalEnvironments,
    };
  }, [releasePipelines]);

  // Handle errors
  useEffect(() => {
    if (configError) {
      toast({
        title: "Configuration Error",
        description: configError instanceof Error ? configError.message : "Failed to fetch ADO configuration",
        variant: "destructive",
      });
    }
  }, [configError, toast]);

  return (
    <GenericModal
      open={open}
      onOpenChange={onClose}
      title="Release Pipelines"
      description="Azure DevOps Release Pipeline Overview"
      icon={Rocket}
      iconClassName="bg-gradient-to-br from-purple-500 to-pink-600"
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
            disabled={loading}
          >
            <RefreshCw
              className={`h-4 w-4 ${loading ? "animate-spin" : ""}`}
            />
          </Button>
        </div>
      }
    >

      {!hasProviderConfig ? (
        <Card>
          <CardContent className="pt-6">
            <div className="text-center space-y-4">
              <AlertTriangle className="h-12 w-12 text-yellow-500 mx-auto" />
              <h3 className="text-lg font-semibold">
                {isExternalCi
                  ? "No Data Available"
                  : "No Data Available"}
              </h3>
              <p className="text-muted-foreground">
                {isExternalCi
                  ? isBitbucket
                    ? "Configure Bitbucket for Repository and Bitbucket Pipelines for CI/CD on this SDLC project (Edit project → tools), with a golden repo or repo slug."
                    : isGithub
                      ? "Configure GitHub for Repository and GitHub Actions for CI/CD on this SDLC project (Edit project → tools)."
                    : "Please configure the GitLab one-time connection in Settings > Third-Party Integrations."
                  : "No data is available for this metric at the moment."}
              </p>
            </div>
          </CardContent>
        </Card>
      ) : loading ? (
        <Card>
          <CardContent className="pt-6">
            <div className="text-center py-8">
              <Loader2 className="h-8 w-8 animate-spin mx-auto mb-2 text-muted-foreground" />
              <p className="text-muted-foreground">Loading release pipelines...</p>
            </div>
          </CardContent>
        </Card>
      ) : isExternalCi ? (
        <div className="space-y-4 pb-2">
          <Card>
            <CardHeader>
              <CardTitle>{isBitbucket ? "Bitbucket Pipeline Runs" : isGithub ? "GitHub Workflow Runs" : "GitLab Pipeline Runs"}</CardTitle>
              <CardDescription>
                Recent pipeline run details for deployment visibility.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-[500px]">
                <div className="space-y-3">
                  {(() => {
                    const raw = Array.isArray(externalPipelinesData)
                      ? externalPipelinesData
                      : externalPipelinesData?.value || [];
                    if (!raw.length) {
                      return (
                        <div className="text-center py-8 text-muted-foreground">
                          <Rocket className="h-12 w-12 mx-auto mb-2 text-muted-foreground/50" />
                          <p>No pipeline runs found</p>
                        </div>
                      );
                    }
                    return raw.map((pipeline) => {
                      const detailUrl = pipeline.url ||
                        (isBitbucket
                          ? `https://bitbucket.org`
                          : isGithub
                            ? `https://github.com`
                          : `https://gitlab.com`);
                      return (
                        <Card key={`${pipeline.id}-${pipeline.path || "na"}`} className="border-gray-200">
                          <CardContent className="pt-4">
                            <div className="space-y-3">
                              <div className="flex items-start justify-between">
                                <div className="flex items-start gap-3 flex-1">
                                  <Rocket className="h-5 w-5 text-purple-600 mt-1" />
                                  <div className="flex-1">
                                    <div className="flex items-center gap-2 mb-1">
                                      <span className="font-semibold text-lg">
                                        {pipeline.name || `Pipeline ${pipeline.id}`}
                                      </span>
                                      {pipeline.entryKind === "placeholder" ? (
                                        <Badge variant="outline" className="text-xs">No prior run</Badge>
                                      ) : null}
                                    </div>
                                    <p className="text-sm text-muted-foreground">
                                      Branch: {pipeline.path || "N/A"}
                                    </p>
                                  </div>
                                </div>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => window.open(detailUrl, "_blank")}
                                  className="h-8 w-8 p-0"
                                >
                                  <ExternalLink className="h-4 w-4" />
                                </Button>
                              </div>
                            </div>
                          </CardContent>
                        </Card>
                      );
                    });
                  })()}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
        </div>
      ) : (
        <div className="space-y-4 pb-2">
          {/* Summary Statistics */}
          <div className="grid grid-cols-4 gap-3">
            <Card>
              <CardHeader className="pb-2 flex items-center justify-between">
                <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                  <Rocket className="h-4 w-4 text-purple-600" />
                  Total Pipelines
                </CardTitle>
                <div className="text-2xl font-bold text-purple-600">{statistics.totalPipelines}</div>
              </CardHeader>
            </Card>
            <Card>
              <CardHeader className="pb-2 flex items-center justify-between">
                <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                  <PlayCircle className="h-4 w-4 text-blue-600" />
                  Active Releases
                </CardTitle>
                <div className="text-2xl font-bold text-blue-600">{statistics.activeReleases}</div>
              </CardHeader>
            </Card>
            <Card>
              <CardHeader className="pb-2 flex items-center justify-between">
                <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-green-600" />
                  Succeeded
                </CardTitle>
                <div className="text-2xl font-bold text-green-600">{statistics.succeededEnvironments}</div>
              </CardHeader>
            </Card>
            <Card>
              <CardHeader className="pb-2 flex items-center justify-between">
                <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                  <Lock className="h-4 w-4 text-amber-600" />
                  Pending Approvals
                </CardTitle>
                <div className="text-2xl font-bold text-amber-600">{statistics.pendingApprovals}</div>
              </CardHeader>
            </Card>
          </div>

          {/* Release Pipelines List */}
          <Card>
            <CardHeader>
              <CardTitle>Release Pipelines</CardTitle>
              <CardDescription>
                Overview of all release pipelines with environment status and approvals
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-[500px]">
                <div className="space-y-3">
                  {releasePipelines.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground">
                      <Rocket className="h-12 w-12 mx-auto mb-2 text-muted-foreground/50" />
                      <p>No release pipelines found</p>
                    </div>
                  ) : (
                    releasePipelines.map((pipeline) => {
                      const lastRelease = pipeline.lastRelease;
                      const standardEnvs = getStandardEnvironments(lastRelease?.environments);
                      const hasPendingApprovals = pipeline.approvals && pipeline.approvals.length > 0;
                      const releaseUrl = lastRelease?._links?.web?.href || 
                        (adoProject?.organizationUrl && adoProject?.name && lastRelease 
                          ? `${adoProject.organizationUrl}/${adoProject.name}/_releaseProgress?releaseId=${lastRelease.id}`
                          : null);

                      return (
                        <Card
                          key={pipeline.definition.id}
                          className={`border-2 ${
                            hasPendingApprovals
                              ? "border-amber-100 bg-amber-50 dark:bg-amber-950/20"
                              : statistics.failedEnvironments > 0 && lastRelease?.environments?.some(e => e.status === "failed")
                              ? "border-red-200 bg-red-50 dark:bg-red-950/20"
                              : "border-gray-200"
                          }`}
                        >
                          <CardContent className="pt-4">
                            <div className="space-y-3">
                              {/* Pipeline Header */}
                              <div className="flex items-start justify-between">
                                <div className="flex items-start gap-3 flex-1">
                                  <Rocket className="h-5 w-5 text-purple-600 mt-1" />
                                  <div className="flex-1">
                                    <div className="flex items-center gap-2 mb-1">
                                      <span className="font-semibold text-lg">{pipeline.definition.name}</span>
                                      {hasPendingApprovals && (
                                        <Badge variant="outline" className="text-xs border-amber-500 text-amber-700 dark:text-amber-400">
                                          <Lock className="h-3 w-3 mr-1" />
                                          Pending Approvals
                                        </Badge>
                                      )}
                                    </div>
                                    {pipeline.definition.path && (
                                      <p className="text-sm text-muted-foreground">{pipeline.definition.path}</p>
                                    )}
                                  </div>
                                </div>
                                {releaseUrl && (
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => window.open(releaseUrl, '_blank')}
                                    className="h-8 w-8 p-0"
                                  >
                                    <ExternalLink className="h-4 w-4" />
                                  </Button>
                                )}
                              </div>

                              {/* Last Triggered Time and Version */}
                              {lastRelease && (
                                <div className="grid grid-cols-2 gap-4 text-sm pt-3 border-t">
                                  <div>
                                    <p className="text-muted-foreground mb-1">Last Triggered</p>
                                    <div className="flex items-center gap-2">
                                      <Calendar className="h-4 w-4 text-muted-foreground" />
                                      <span className="font-medium">{formatDate(lastRelease.createdOn)}</span>
                                    </div>
                                  </div>
                                  <div>
                                    <p className="text-muted-foreground mb-1">Version/Release</p>
                                    <div className="flex items-center gap-2">
                                      <Tag className="h-4 w-4 text-muted-foreground" />
                                      <span className="font-medium">{lastRelease.name}</span>
                                    </div>
                                  </div>
                                </div>
                              )}

                              {/* Environment Stages */}
                              <div className="pt-3 border-t">
                                <p className="text-sm font-medium text-muted-foreground mb-2">Environment Status</p>
                                {standardEnvs.length > 0 ? (
                                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                                    {standardEnvs.map(({ name, env }) => {
                                      const status = env?.status || "notStarted";
                                      return (
                                        <div
                                          key={name}
                                          className="p-3 rounded-lg border bg-card"
                                        >
                                          <div className="flex items-center gap-2 mb-2">
                                            {getEnvironmentStatusIcon(status)}
                                            <span className="font-semibold text-sm">{name}</span>
                                          </div>
                                          <Badge
                                            className={`${getEnvironmentStatusColor(status)} text-white text-xs w-full justify-center`}
                                          >
                                            {getEnvironmentStatusText(status)}
                                          </Badge>
                                        </div>
                                      );
                                    })}
                                  </div>
                                ) : (
                                  <p className="text-sm text-muted-foreground">No environments configured</p>
                                )}
                              </div>

                              {/* Approvals Section */}
                              {hasPendingApprovals && (
                                <div className="pt-3 border-t">
                                  <p className="text-sm font-medium text-muted-foreground mb-2 flex items-center gap-2">
                                    <Lock className="h-4 w-4" />
                                    Pending Approvals
                                  </p>
                                  <div className="space-y-2">
                                    {pipeline.approvals!.map((approval) => (
                                      <div
                                        key={approval.id}
                                        className="p-2 rounded bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800"
                                      >
                                        <div className="flex items-center justify-between text-sm">
                                          <span className="font-medium">
                                            {approval.environment?.name || "Unknown Environment"}
                                          </span>
                                          {approval.approver && (
                                            <span className="text-muted-foreground flex items-center gap-1">
                                              <User className="h-3 w-3" />
                                              {approval.approver.displayName}
                                            </span>
                                          )}
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}

                              {!lastRelease && (
                                <div className="pt-3 border-t">
                                  <p className="text-sm text-muted-foreground text-center py-1">
                                    No releases triggered yet
                                  </p>
                                </div>
                              )}
                            </div>
                          </CardContent>
                        </Card>
                      );
                    })
                  )}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
        </div>
      )}
    </GenericModal>
  );
}




