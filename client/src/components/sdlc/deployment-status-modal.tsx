import { useState, useEffect, useMemo } from "react";
import { GenericModal } from "@/components/ui/generic-modal";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Activity,
  RefreshCw,
  CheckCircle2,
  XCircle,
  Clock,
  AlertTriangle,
  Rocket,
  ChevronDown,
  ChevronUp,
  FileText,
  Terminal,
  Shield,
  Loader2,
  ExternalLink,
  Lock,
  Settings,
  AlertCircle,
  Info,
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

interface DeploymentStatusModalProps {
  projectId: string;
  adoProject?: ADOProject;
  providerSegment?: "ado" | "gitlab" | "bitbucket" | "github";
  open: boolean;
  onClose: () => void;
}

interface Deployment {
  id: number;
  deploymentStatus: string;
  deploymentStatusText: string;
  releaseEnvironment: {
    id: number;
    name: string;
    status?: string;
    deploySteps?: Array<{
      id: number;
      name: string;
      status: string;
      rank: number;
      startedOn?: string;
      completedOn?: string;
      issues?: Array<{
        type: string;
        message?: string;
        text?: string;
      }>;
    }>;
    preDeploymentGatesSnapshot?: {
      gates?: Array<{
        id: number;
        name: string;
        status: string;
        rank: number;
      }>;
    };
    postDeploymentGatesSnapshot?: {
      gates?: Array<{
        id: number;
        name: string;
        status: string;
        rank: number;
      }>;
    };
    conditions?: Array<{
      name: string;
      status: string;
      result?: string;
    }>;
  };
  release: {
    id: number;
    name: string;
    _links?: {
      web?: {
        href: string;
      };
    };
  };
  requestedFor: {
    displayName: string;
  };
  queuedOn: string;
  startedOn: string;
  completedOn: string;
  operationStatus?: string;
  attempt?: number;
  reason?: string;
}

interface DeploymentDetails {
  deployment: Deployment;
  logs?: string;
  errors?: Array<{
    type: string;
    message: string;
    source?: string;
  }>;
  warnings?: Array<{
    type: string;
    message: string;
    source?: string;
  }>;
  tasks?: Array<{
    id: string;
    name: string;
    status: string;
    result?: string;
    startTime?: string;
    finishTime?: string;
    log?: string;
    issues?: Array<{
      type: string;
      message?: string;
      text?: string;
    }>;
  }>;
  approvals?: Array<{
    id: number;
    status: string;
    approver?: {
      displayName: string;
    };
    comments?: string;
  }>;
  environmentMessages?: Array<{
    type: string;
    message: string;
    timestamp?: string;
  }>;
}

export function DeploymentStatusModal({ projectId, adoProject, providerSegment = "ado", open, onClose }: DeploymentStatusModalProps) {
  const { toast } = useToast();
  const isGitLab = providerSegment === "gitlab";
  const isBitbucket = providerSegment === "bitbucket";
  const isGithub = providerSegment === "github";
  const isExternalCi = isGitLab || isBitbucket || isGithub;
  const [expandedDeploymentId, setExpandedDeploymentId] = useState<number | null>(null);
  const [deploymentDetails, setDeploymentDetails] = useState<Record<number, DeploymentDetails>>({});
  const [loadingDetails, setLoadingDetails] = useState<Record<number, boolean>>({});
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

  // Fetch ADO config (cached)
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
    enabled: open && !!projectId, // Only fetch when modal is open and projectId exists
    staleTime: 5 * 60 * 1000, // Cache for 5 minutes
    gcTime: 10 * 60 * 1000, // Keep in cache for 10 minutes
    retry: 1,
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
        console.warn(`[DeploymentStatusModal] Failed to fetch sprints: ${sprintsRes.status}`, errorText);
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

  // Fetch deployments (cached)
  const { 
    data: deploymentsData, 
    isLoading: loading, 
    isFetching: refreshing,
    error: deploymentsError,
    refetch: refetchDeployments 
  } = useQuery<{ value: Deployment[] }>({
    queryKey: [`/api/sdlc/projects/${projectId}/${providerSegment}/deployments`, queryString, selectedSprintPath],
    queryFn: async () => {
      if (!hasProviderConfig) {
        return { value: [] };
      }

      const deploymentsQuery = new URLSearchParams(queryString);
      if (selectedSprintPath && !isExternalCi) {
        // URLSearchParams.set() already handles encoding, so we don't need encodeURIComponent
        deploymentsQuery.set('sprintPath', selectedSprintPath);
      }
      const url = getApiUrl(`/api/sdlc/projects/${projectId}/${providerSegment}/deployments${deploymentsQuery.toString() ? `?${deploymentsQuery.toString()}` : ''}`);
      // Add cache-busting when sprint is selected to ensure fresh data
      const fetchUrl = selectedSprintPath && !isExternalCi ? `${url}&_t=${Date.now()}` : url;
      const deploymentsRes = await fetch(fetchUrl, { 
        credentials: "include",
        cache: selectedSprintPath && !isExternalCi ? 'no-cache' : 'default'
      });
      
      if (!deploymentsRes.ok) {
        throw new Error(`Failed to fetch deployments: ${deploymentsRes.status} ${deploymentsRes.statusText}`);
      }

      return deploymentsRes.json();
    },
    enabled: open && !!projectId && hasProviderConfig,
    staleTime: selectedSprintPath ? 0 : 5 * 60 * 1000, // Don't cache when sprint is selected
    gcTime: selectedSprintPath ? 0 : 10 * 60 * 1000, // Don't cache when sprint is selected
    retry: 1,
  });

  const deployments = ((deploymentsData as { value?: Deployment[] })?.value || []).map((d: any) => ({
    ...d,
    deploymentStatus:
      d.deploymentStatus === "success" ? "succeeded" :
      d.deploymentStatus === "running" ? "inProgress" :
      d.deploymentStatus,
    deploymentStatusText: d.deploymentStatusText || d.deploymentStatus || "unknown",
    release: d.release || { id: d.releaseId || d.id, name: d.releaseName || `Deployment #${d.id}` },
    releaseEnvironment: d.releaseEnvironment || { id: d.environmentId || d.id, name: d.environmentName || "default" },
    requestedFor: d.requestedFor || {
      displayName: isBitbucket ? "Bitbucket" : isGitLab ? "GitLab" : "Unknown",
    },
  }));

  // Show error toast if there's an error
  useEffect(() => {
    if (configError) {
      toast({
        title: "Error",
        description: configError instanceof Error ? configError.message : "Failed to fetch ADO configuration",
        variant: "destructive",
      });
    }
  }, [configError, toast]);

  useEffect(() => {
    if (deploymentsError) {
      toast({
        title: "Error",
        description: deploymentsError instanceof Error ? deploymentsError.message : "Failed to fetch deployment data",
        variant: "destructive",
      });
    }
  }, [deploymentsError, toast]);

  const fetchDeploymentDetails = async (deploymentId: number) => {
    if (deploymentDetails[deploymentId]) {
      // Already fetched, just toggle
      setExpandedDeploymentId(expandedDeploymentId === deploymentId ? null : deploymentId);
      return;
    }

    const deployment = deployments.find(d => d.id === deploymentId);
    if (!deployment) return;

    setLoadingDetails(prev => ({ ...prev, [deploymentId]: true }));
    try {
      if (isExternalCi) {
        setDeploymentDetails(prev => ({ ...prev, [deploymentId]: { deployment, tasks: [], errors: [], warnings: [], approvals: [], environmentMessages: [] } }));
        setExpandedDeploymentId(deploymentId);
        return;
      }
      // Fetch detailed deployment information
      // First, try to get release details which may contain deployment info
      if (deployment.release?.id) {
        const releaseDetailsUrl = getApiUrl(
          `/api/sdlc/projects/${projectId}/ado/releases/${deployment.release.id}/details${queryString ? `?${queryString}` : ''}`
        );
        console.log(`[DeploymentStatusModal] Fetching release details for deployment ${deploymentId}, release ${deployment.release.id}`);
        const releaseDetailsRes = await fetch(releaseDetailsUrl, { credentials: "include" });
        
        if (releaseDetailsRes.ok) {
          const releaseData = await releaseDetailsRes.json();
          console.log(`[DeploymentStatusModal] Release details response:`, {
            environmentsCount: releaseData.environments?.length || 0,
            targetEnvId: deployment.releaseEnvironment?.id,
            hasDeploySteps: releaseData.environments?.some((e: any) => e.deploySteps?.length > 0)
          });
          
          // Extract deployment-specific details from release
          const env = releaseData.environments?.find((e: any) => e.id === deployment.releaseEnvironment?.id);
          
          console.log(`[DeploymentStatusModal] Found environment:`, {
            envId: env?.id,
            envName: env?.name,
            envStatus: env?.status,
            deployStepsCount: env?.deploySteps?.length || 0,
            hasIssues: env?.deploySteps?.some((s: any) => s.issues?.length > 0)
          });
          
          const details: DeploymentDetails = {
            deployment,
            errors: [],
            warnings: [],
            tasks: [],
            approvals: [],
            environmentMessages: [],
          };

          // Extract errors and warnings from deploy steps
          if (env?.deploySteps) {
            env.deploySteps.forEach((step: any) => {
              if (step.issues && Array.isArray(step.issues)) {
                step.issues.forEach((issue: any) => {
                  const issueType = issue.type || issue.category || '';
                  const issueMessage = issue.message || issue.text || issue.content || 'Unknown issue';
                  
                  if (issueType.toLowerCase() === 'error' || issueType.toLowerCase() === 'exception' || 
                      issue.message?.toLowerCase().includes('error') || issue.message?.toLowerCase().includes('failed')) {
                    details.errors?.push({
                      type: issueType || 'error',
                      message: issueMessage,
                      source: step.name || 'Unknown step',
                    });
                  } else if (issueType.toLowerCase() === 'warning' || issueType.toLowerCase() === 'warn') {
                    details.warnings?.push({
                      type: issueType || 'warning',
                      message: issueMessage,
                      source: step.name || 'Unknown step',
                    });
                  }
                });
              }

              // Add step as task
              details.tasks?.push({
                id: step.id?.toString() || step.rank?.toString() || '',
                name: step.name || `Step ${step.rank}`,
                status: step.status || 'unknown',
                result: step.status,
                startTime: step.startedOn,
                finishTime: step.completedOn,
                issues: step.issues ? step.issues.map((issue: any) => ({
                  type: issue.type || issue.category || 'unknown',
                  message: issue.message || issue.text || issue.content || 'Unknown issue',
                })) : undefined,
              });
            });
          }

          // Also check for errors in environment status
          if (env?.status === 'failed' || env?.status === 'rejected') {
            const errorMessage = env.statusMessage || env.message || `Deployment ${env.status} in ${env.name}`;
            if (!details.errors?.some(e => e.message === errorMessage)) {
              details.errors?.push({
                type: 'error',
                message: errorMessage,
                source: env.name || 'Environment',
              });
            }
          }

          // Check for errors in deployment status
          if (deployment.deploymentStatus === 'failed' || deployment.deploymentStatus === 'partiallySucceeded') {
            const errorMessage = deployment.deploymentStatusText || `Deployment ${deployment.deploymentStatus}`;
            if (!details.errors?.some(e => e.message === errorMessage)) {
              details.errors?.push({
                type: 'error',
                message: errorMessage,
                source: deployment.releaseEnvironment?.name || 'Deployment',
              });
            }
          }

          // Extract rejected approvals from gates
          if (env?.preDeploymentGatesSnapshot?.gates) {
            env.preDeploymentGatesSnapshot.gates.forEach((gate: any) => {
              if (gate.status === 'rejected' || gate.status === 'failed') {
                details.approvals?.push({
                  id: gate.id,
                  status: gate.status,
                  comments: `Pre-deployment gate: ${gate.name}`,
                });
              }
            });
          }

          if (env?.postDeploymentGatesSnapshot?.gates) {
            env.postDeploymentGatesSnapshot.gates.forEach((gate: any) => {
              if (gate.status === 'rejected' || gate.status === 'failed') {
                details.approvals?.push({
                  id: gate.id,
                  status: gate.status,
                  comments: `Post-deployment gate: ${gate.name}`,
                });
              }
            });
          }

          // Extract environment messages
          if (env?.conditions) {
            env.conditions.forEach((condition: any) => {
              if (condition.result === 'failed' || condition.status === 'failed') {
                details.environmentMessages?.push({
                  type: 'error',
                  message: `Condition failed: ${condition.name}`,
                });
              }
            });
          }

          // Extract errors from environment status message
          if (env?.statusMessage) {
            const statusMsg = env.statusMessage;
            if (statusMsg.toLowerCase().includes('error') || statusMsg.toLowerCase().includes('failed')) {
              if (!details.errors?.some(e => e.message === statusMsg)) {
                details.errors?.push({
                  type: 'error',
                  message: statusMsg,
                  source: env.name || 'Environment',
                });
              }
            }
          }

          // Extract errors from deployment operation status
          if (env?.deploymentStatus?.status === 'failed' || env?.deploymentStatus?.status === 'rejected') {
            const errorMsg = env.deploymentStatus?.message || `Deployment ${env.deploymentStatus?.status}`;
            if (!details.errors?.some(e => e.message === errorMsg)) {
              details.errors?.push({
                type: 'error',
                message: errorMsg,
                source: env.name || 'Environment',
              });
            }
          }

          console.log(`[DeploymentStatusModal] Final extracted details for deployment ${deploymentId}:`, {
            errorsCount: details.errors?.length || 0,
            warningsCount: details.warnings?.length || 0,
            tasksCount: details.tasks?.length || 0,
            approvalsCount: details.approvals?.length || 0,
            messagesCount: details.environmentMessages?.length || 0,
            sampleErrors: details.errors?.slice(0, 2),
            sampleTasks: details.tasks?.slice(0, 2)
          });

          setDeploymentDetails(prev => ({ ...prev, [deploymentId]: details }));
          setExpandedDeploymentId(deploymentId);
        } else {
          console.warn(`[DeploymentStatusModal] Failed to fetch release details: ${releaseDetailsRes.status}`);
        }
      } else {
        // If no release ID, create basic details from deployment
        const details: DeploymentDetails = {
          deployment,
          errors: [],
          warnings: [],
          tasks: [],
          approvals: [],
          environmentMessages: [],
        };
        setDeploymentDetails(prev => ({ ...prev, [deploymentId]: details }));
        setExpandedDeploymentId(deploymentId);
      }
    } catch (error: any) {
      console.error("Error fetching deployment details:", error);
      toast({
        title: "Error",
        description: error.message || "Failed to fetch deployment details",
        variant: "destructive",
      });
    } finally {
      setLoadingDetails(prev => ({ ...prev, [deploymentId]: false }));
    }
  };

  const getStatusIcon = (status: string) => {
    if (status === "inProgress") return <Clock className="h-4 w-4 text-blue-600" />;
    if (status === "succeeded") return <CheckCircle2 className="h-4 w-4 text-green-600" />;
    if (status === "failed") return <XCircle className="h-4 w-4 text-red-600" />;
    if (status === "partiallySucceeded") return <AlertTriangle className="h-4 w-4 text-amber-600" />;
    return <Rocket className="h-4 w-4 text-gray-600" />;
  };

  const getStatusColor = (status: string) => {
    if (status === "inProgress") return "bg-blue-500";
    if (status === "succeeded") return "bg-green-500";
    if (status === "failed") return "bg-red-500";
    if (status === "partiallySucceeded") return "bg-amber-500";
    return "bg-gray-500";
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

  const succeededCount = deployments.filter(d => d.deploymentStatus === "succeeded").length;
  const failedCount = deployments.filter(d => d.deploymentStatus === "failed").length;
  const inProgressCount = deployments.filter(d => d.deploymentStatus === "inProgress").length;
  const totalDeployments = deployments.length;

  const formatDuration = (startTime: string, endTime?: string) => {
    if (!startTime) return "N/A";
    const start = new Date(startTime);
    const end = endTime ? new Date(endTime) : new Date();
    const durationMs = end.getTime() - start.getTime();
    const minutes = Math.floor(durationMs / 60000);
    const seconds = Math.floor((durationMs % 60000) / 1000);
    if (minutes > 0) {
      return `${minutes}m ${seconds}s`;
    }
    return `${seconds}s`;
  };

  return (
    <GenericModal
      open={open}
      onOpenChange={onClose}
      title="Deployment Status"
      description="Azure DevOps Deployment History"
      icon={Activity}
      iconClassName="bg-gradient-to-br from-purple-500 to-purple-600"
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
            onClick={() => refetchDeployments()}
            disabled={refreshing}
          >
            <RefreshCw
              className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`}
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
                    ? "Configure Bitbucket for Repository and Bitbucket Pipelines for CI/CD on this SDLC project (Edit project → tools), with a golden repo or repo slug to view deployment data."
                    : "Please configure the GitLab one-time connection in Settings > Third-Party Integrations to view deployment data."
                  : "No data is available for this metric at the moment."}
              </p>
            </div>
          </CardContent>
        </Card>
      ) : loading ? (
        <Card>
          <CardContent className="pt-6">
            <p className="text-center text-muted-foreground py-8">
              Loading deployments...
            </p>
          </CardContent>
          </Card>
        ) : (
          <div className="flex-1 overflow-hidden flex flex-col space-y-6">
            {/* Statistics Cards */}
            <div className="grid grid-cols-4 gap-4">
              <Card className="border-purple-200 dark:border-purple-800">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                    <Rocket className="h-4 w-4 text-purple-600" />
                    Total Deployments
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-4xl font-bold text-purple-600">
                    {totalDeployments}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    Total deploys
                  </p>
                </CardContent>
              </Card>

              <Card className="border-green-200 dark:border-green-800">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-green-600" />
                    Succeeded
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-4xl font-bold text-green-600">
                    {succeededCount}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    Successful deploys
                  </p>
                </CardContent>
              </Card>

              <Card className="border-red-200 dark:border-red-800">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                    <XCircle className="h-4 w-4 text-red-600" />
                    Failed
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-4xl font-bold text-red-600">
                    {failedCount}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    Failed deploys
                  </p>
                </CardContent>
              </Card>

              <Card className="border-amber-200 dark:border-amber-800">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                    <Clock className="h-4 w-4 text-amber-600" />
                    In Progress
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-4xl font-bold text-amber-600">
                    {inProgressCount}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    Currently deploying
                  </p>
                </CardContent>
              </Card>
            </div>

            {/* Deployments List */}
            <Card className="flex flex-col flex-1 overflow-hidden">
              <CardHeader>
                <CardTitle className="text-base">Recent Deployments</CardTitle>
                <CardDescription>
                  Click on a deployment to view detailed logs, errors, tasks, and approval information
                </CardDescription>
              </CardHeader>
              <CardContent className="flex-1 overflow-hidden">
                <ScrollArea className="h-[500px]">
                  <div className="space-y-3">
                    {deployments.length === 0 ? (
                      <p className="text-center text-muted-foreground py-8">
                        No deployments found
                      </p>
                    ) : (
                      deployments.map((deployment) => {
                        const isExpanded = expandedDeploymentId === deployment.id;
                        const details = deploymentDetails[deployment.id];
                        const isLoading = loadingDetails[deployment.id];

                        return (
                          <Card
                            key={deployment.id}
                            className={`transition-all ${
                              deployment.deploymentStatus === "failed"
                                ? "border-red-200 bg-red-50/50 dark:bg-red-950/20"
                                : deployment.deploymentStatus === "succeeded"
                                ? "border-green-200 bg-green-50/50 dark:bg-green-950/20"
                                : "border-gray-200"
                            }`}
                          >
                            <CardContent className="p-4">
                              {/* Deployment Header */}
                              <div className="flex items-start justify-between gap-4">
                                <div className="flex items-start gap-3 flex-1">
                                  {getStatusIcon(deployment.deploymentStatus)}
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2 mb-2">
                                      <span className="font-medium text-sm">
                                        {deployment.release?.name || `Deployment #${deployment.id}`}
                                      </span>
                                      <Badge className={`${getStatusColor(deployment.deploymentStatus)} text-white text-xs`}>
                                        {deployment.deploymentStatusText || deployment.deploymentStatus}
                                      </Badge>
                                      {deployment.releaseEnvironment?.status && (
                                        <Badge variant="outline" className="text-xs">
                                          {deployment.releaseEnvironment.status}
                                        </Badge>
                                      )}
                                    </div>
                                    <div className="text-sm text-muted-foreground space-y-1">
                                      <div>Environment: {deployment.releaseEnvironment?.name || 'N/A'}</div>
                                      <div>Deployed by: {deployment.requestedFor?.displayName || 'Unknown'}</div>
                                      <div>Started: {formatDate(deployment.startedOn)}</div>
                                      {deployment.completedOn && (
                                        <>
                                          <div>Completed: {formatDate(deployment.completedOn)}</div>
                                          <div>Duration: {formatDuration(deployment.startedOn, deployment.completedOn)}</div>
                                        </>
                                      )}
                                    </div>
                                  </div>
                                </div>
                                <div className="flex items-center gap-2">
                                  {deployment.release?._links?.web?.href && (
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      onClick={() => window.open(deployment.release._links?.web?.href, '_blank')}
                                      className="h-8 w-8 p-0"
                                    >
                                      <ExternalLink className="h-4 w-4" />
                                    </Button>
                                  )}
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => fetchDeploymentDetails(deployment.id)}
                                    disabled={isLoading}
                                    className="h-8 w-8 p-0"
                                  >
                                    {isLoading ? (
                                      <Loader2 className="h-4 w-4 animate-spin" />
                                    ) : isExpanded ? (
                                      <ChevronUp className="h-4 w-4" />
                                    ) : (
                                      <ChevronDown className="h-4 w-4" />
                                    )}
                                  </Button>
                                </div>
                              </div>

                              {/* Expanded Details */}
                              {isExpanded && details && (
                                <div className="mt-4 pt-4 border-t">
                                  <Tabs defaultValue="overview" className="w-full">
                                    <TabsList className="grid w-full grid-cols-5">
                                      <TabsTrigger value="overview" className="text-xs">
                                        <Info className="h-3 w-3 mr-1" />
                                        Overview
                                      </TabsTrigger>
                                      <TabsTrigger value="tasks" className="text-xs">
                                        <Settings className="h-3 w-3 mr-1" />
                                        Tasks
                                      </TabsTrigger>
                                      <TabsTrigger value="errors" className="text-xs">
                                        <XCircle className="h-3 w-3 mr-1" />
                                        Errors
                                      </TabsTrigger>
                                      <TabsTrigger value="warnings" className="text-xs">
                                        <AlertTriangle className="h-3 w-3 mr-1" />
                                        Warnings
                                      </TabsTrigger>
                                      <TabsTrigger value="approvals" className="text-xs">
                                        <Lock className="h-3 w-3 mr-1" />
                                        Approvals
                                      </TabsTrigger>
                                    </TabsList>

                                    {/* Overview Tab */}
                                    <TabsContent value="overview" className="mt-4 space-y-4">
                                      {/* Deployment Tasks Summary */}
                                      {details.tasks && details.tasks.length > 0 && (
                                        <div>
                                          <h5 className="text-sm font-semibold mb-2 flex items-center gap-2">
                                            <Settings className="h-4 w-4" />
                                            Deployment Tasks ({details.tasks.length})
                                          </h5>
                                          <div className="space-y-2">
                                            {details.tasks.slice(0, 5).map((task) => (
                                              <div
                                                key={task.id}
                                                className="flex items-center justify-between p-2 bg-muted rounded text-xs"
                                              >
                                                <div className="flex items-center gap-2">
                                                  {task.status === "succeeded" ? (
                                                    <CheckCircle2 className="h-3 w-3 text-green-600" />
                                                  ) : task.status === "failed" ? (
                                                    <XCircle className="h-3 w-3 text-red-600" />
                                                  ) : (
                                                    <Clock className="h-3 w-3 text-blue-600" />
                                                  )}
                                                  <span>{task.name}</span>
                                                </div>
                                                <Badge variant="outline" className="text-xs">
                                                  {task.status}
                                                </Badge>
                                              </div>
                                            ))}
                                            {details.tasks.length > 5 && (
                                              <p className="text-xs text-muted-foreground text-center">
                                                +{details.tasks.length - 5} more tasks
                                              </p>
                                            )}
                                          </div>
                                        </div>
                                      )}

                                      {/* Failed Steps */}
                                      {details.tasks && details.tasks.some(t => t.status === "failed") && (
                                        <div>
                                          <h5 className="text-sm font-semibold mb-2 flex items-center gap-2 text-red-600">
                                            <XCircle className="h-4 w-4" />
                                            Failed Steps
                                          </h5>
                                          <div className="space-y-2">
                                            {details.tasks
                                              .filter(t => t.status === "failed")
                                              .map((task) => (
                                                <Card key={task.id} className="border-red-200 bg-red-50 dark:bg-red-950/20">
                                                  <CardContent className="p-3">
                                                    <div className="flex items-start justify-between mb-2">
                                                      <span className="font-medium text-sm">{task.name}</span>
                                                      <Badge variant="destructive" className="text-xs">
                                                        Failed
                                                      </Badge>
                                                    </div>
                                                    {task.issues && task.issues.length > 0 && (
                                                      <div className="space-y-1 mt-2">
                                                        {task.issues.map((issue, idx) => (
                                                          <div key={idx} className="text-xs text-red-700 dark:text-red-300">
                                                            {issue.message || issue.text || 'Unknown error'}
                                                          </div>
                                                        ))}
                                                      </div>
                                                    )}
                                                  </CardContent>
                                                </Card>
                                              ))}
                                          </div>
                                        </div>
                                      )}

                                      {/* Environment Messages */}
                                      {details.environmentMessages && details.environmentMessages.length > 0 && (
                                        <div>
                                          <h5 className="text-sm font-semibold mb-2 flex items-center gap-2">
                                            <AlertCircle className="h-4 w-4" />
                                            Environment Messages
                                          </h5>
                                          <div className="space-y-2">
                                            {details.environmentMessages.map((msg, idx) => (
                                              <div
                                                key={idx}
                                                className={`p-2 rounded text-xs ${
                                                  msg.type === 'error'
                                                    ? 'bg-red-50 dark:bg-red-950/20 border border-red-200 text-red-700 dark:text-red-300'
                                                    : 'bg-blue-50 dark:bg-blue-950/20 border border-blue-200 text-blue-700 dark:text-blue-300'
                                                }`}
                                              >
                                                {msg.message}
                                              </div>
                                            ))}
                                          </div>
                                        </div>
                                      )}

                                      {/* Gates/Conditions */}
                                      {deployment.releaseEnvironment?.preDeploymentGatesSnapshot?.gates ||
                                      deployment.releaseEnvironment?.postDeploymentGatesSnapshot?.gates ? (
                                        <div>
                                          <h5 className="text-sm font-semibold mb-2 flex items-center gap-2">
                                            <Shield className="h-4 w-4" />
                                            Gates & Conditions
                                          </h5>
                                          <div className="space-y-2">
                                            {deployment.releaseEnvironment.preDeploymentGatesSnapshot?.gates?.map((gate: any, idx: number) => (
                                              <div key={`pre-${idx}`} className="flex items-center justify-between p-2 bg-muted rounded text-xs">
                                                <span>Pre-deployment: {gate.name}</span>
                                                <Badge
                                                  variant={gate.status === 'succeeded' ? 'default' : 'destructive'}
                                                  className="text-xs"
                                                >
                                                  {gate.status}
                                                </Badge>
                                              </div>
                                            ))}
                                            {deployment.releaseEnvironment.postDeploymentGatesSnapshot?.gates?.map((gate: any, idx: number) => (
                                              <div key={`post-${idx}`} className="flex items-center justify-between p-2 bg-muted rounded text-xs">
                                                <span>Post-deployment: {gate.name}</span>
                                                <Badge
                                                  variant={gate.status === 'succeeded' ? 'default' : 'destructive'}
                                                  className="text-xs"
                                                >
                                                  {gate.status}
                                                </Badge>
                                              </div>
                                            ))}
                                          </div>
                                        </div>
                                      ) : null}

                                      {/* Fallback message when no data available */}
                                      {(!details.tasks || details.tasks.length === 0) &&
                                       (!details.tasks || !details.tasks.some(t => t.status === "failed")) &&
                                       (!details.environmentMessages || details.environmentMessages.length === 0) &&
                                       (!deployment.releaseEnvironment?.preDeploymentGatesSnapshot?.gates) &&
                                       (!deployment.releaseEnvironment?.postDeploymentGatesSnapshot?.gates) && (
                                        <div className="text-center py-8 text-muted-foreground">
                                          <Info className="h-8 w-8 mx-auto mb-2 opacity-50" />
                                          <p className="text-sm">No deployment details available for this deployment.</p>
                                          <p className="text-xs mt-1">Deployment information will appear here once the deployment completes.</p>
                                        </div>
                                      )}
                                    </TabsContent>

                                    {/* Tasks Tab */}
                                    <TabsContent value="tasks" className="mt-4">
                                      {details.tasks && details.tasks.length > 0 ? (
                                        <div className="space-y-2">
                                          {details.tasks.map((task) => (
                                            <Card
                                              key={task.id}
                                              className={`${
                                                task.status === "failed"
                                                  ? "border-red-200 bg-red-50/50 dark:bg-red-950/20"
                                                  : task.status === "succeeded"
                                                  ? "border-green-200 bg-green-50/50 dark:bg-green-950/20"
                                                  : ""
                                              }`}
                                            >
                                              <CardContent className="p-3">
                                                <div className="flex items-start justify-between mb-2">
                                                  <div className="flex items-center gap-2">
                                                    {task.status === "succeeded" ? (
                                                      <CheckCircle2 className="h-4 w-4 text-green-600" />
                                                    ) : task.status === "failed" ? (
                                                      <XCircle className="h-4 w-4 text-red-600" />
                                                    ) : (
                                                      <Clock className="h-4 w-4 text-blue-600" />
                                                    )}
                                                    <span className="font-medium text-sm">{task.name}</span>
                                                  </div>
                                                  <Badge
                                                    variant={task.status === "failed" ? "destructive" : "outline"}
                                                    className="text-xs"
                                                  >
                                                    {task.status}
                                                  </Badge>
                                                </div>
                                                <div className="text-xs text-muted-foreground space-y-1">
                                                  {task.startTime && <div>Started: {formatDate(task.startTime)}</div>}
                                                  {task.finishTime && <div>Finished: {formatDate(task.finishTime)}</div>}
                                                  {task.startTime && task.finishTime && (
                                                    <div>Duration: {formatDuration(task.startTime, task.finishTime)}</div>
                                                  )}
                                                </div>
                                                {task.issues && task.issues.length > 0 && (
                                                  <div className="mt-2 space-y-1">
                                                    {task.issues.map((issue, idx) => (
                                                      <div
                                                        key={idx}
                                                        className={`text-xs p-2 rounded ${
                                                          issue.type === 'error' || issue.type === 'Error'
                                                            ? 'bg-red-50 dark:bg-red-950/20 text-red-700 dark:text-red-300'
                                                            : 'bg-yellow-50 dark:bg-yellow-950/20 text-yellow-700 dark:text-yellow-300'
                                                        }`}
                                                      >
                                                        <strong>{issue.type}:</strong> {issue.message || issue.text}
                                                      </div>
                                                    ))}
                                                  </div>
                                                )}
                                              </CardContent>
                                            </Card>
                                          ))}
                                        </div>
                                      ) : (
                                        <p className="text-sm text-muted-foreground text-center py-4">
                                          No task information available
                                        </p>
                                      )}
                                    </TabsContent>

                                    {/* Errors Tab */}
                                    <TabsContent value="errors" className="mt-4">
                                      {details.errors && details.errors.length > 0 ? (
                                        <div className="space-y-2">
                                          {details.errors.map((error, idx) => (
                                            <Card key={idx} className="border-red-200 bg-red-50 dark:bg-red-950/20">
                                              <CardContent className="p-3">
                                                <div className="flex items-start gap-2">
                                                  <XCircle className="h-4 w-4 text-red-600 mt-0.5 flex-shrink-0" />
                                                  <div className="flex-1">
                                                    <div className="font-medium text-sm text-red-900 dark:text-red-100">
                                                      {error.type}
                                                    </div>
                                                    <div className="text-sm text-red-700 dark:text-red-300 mt-1">
                                                      {error.message}
                                                    </div>
                                                    {error.source && (
                                                      <div className="text-xs text-red-600 dark:text-red-400 mt-1">
                                                        Source: {error.source}
                                                      </div>
                                                    )}
                                                  </div>
                                                </div>
                                              </CardContent>
                                            </Card>
                                          ))}
                                        </div>
                                      ) : (
                                        <div className="text-center py-8">
                                          <CheckCircle2 className="h-8 w-8 text-green-600 mx-auto mb-2" />
                                          <p className="text-sm text-muted-foreground">No errors found</p>
                                        </div>
                                      )}
                                    </TabsContent>

                                    {/* Warnings Tab */}
                                    <TabsContent value="warnings" className="mt-4">
                                      {details.warnings && details.warnings.length > 0 ? (
                                        <div className="space-y-2">
                                          {details.warnings.map((warning, idx) => (
                                            <Card key={idx} className="border-yellow-200 bg-yellow-50 dark:bg-yellow-950/20">
                                              <CardContent className="p-3">
                                                <div className="flex items-start gap-2">
                                                  <AlertTriangle className="h-4 w-4 text-yellow-600 mt-0.5 flex-shrink-0" />
                                                  <div className="flex-1">
                                                    <div className="font-medium text-sm text-yellow-900 dark:text-yellow-100">
                                                      {warning.type}
                                                    </div>
                                                    <div className="text-sm text-yellow-700 dark:text-yellow-300 mt-1">
                                                      {warning.message}
                                                    </div>
                                                    {warning.source && (
                                                      <div className="text-xs text-yellow-600 dark:text-yellow-400 mt-1">
                                                        Source: {warning.source}
                                                      </div>
                                                    )}
                                                  </div>
                                                </div>
                                              </CardContent>
                                            </Card>
                                          ))}
                                        </div>
                                      ) : (
                                        <div className="text-center py-8">
                                          <CheckCircle2 className="h-8 w-8 text-green-600 mx-auto mb-2" />
                                          <p className="text-sm text-muted-foreground">No warnings found</p>
                                        </div>
                                      )}
                                    </TabsContent>

                                    {/* Approvals Tab */}
                                    <TabsContent value="approvals" className="mt-4">
                                      {details.approvals && details.approvals.length > 0 ? (
                                        <div className="space-y-2">
                                          {details.approvals.map((approval) => (
                                            <Card
                                              key={approval.id}
                                              className={`${
                                                approval.status === 'rejected' || approval.status === 'failed'
                                                  ? 'border-red-200 bg-red-50 dark:bg-red-950/20'
                                                  : 'border-amber-200 bg-amber-50 dark:bg-amber-950/20'
                                              }`}
                                            >
                                              <CardContent className="p-3">
                                                <div className="flex items-start gap-2">
                                                  <Lock className="h-4 w-4 text-amber-600 mt-0.5 flex-shrink-0" />
                                                  <div className="flex-1">
                                                    <div className="flex items-center justify-between mb-1">
                                                      <span className="font-medium text-sm">
                                                        {approval.approver?.displayName || 'Unknown Approver'}
                                                      </span>
                                                      <Badge
                                                        variant={approval.status === 'rejected' ? 'destructive' : 'outline'}
                                                        className="text-xs"
                                                      >
                                                        {approval.status}
                                                      </Badge>
                                                    </div>
                                                    {approval.comments && (
                                                      <div className="text-xs text-muted-foreground mt-1">
                                                        {approval.comments}
                                                      </div>
                                                    )}
                                                  </div>
                                                </div>
                                              </CardContent>
                                            </Card>
                                          ))}
                                        </div>
                                      ) : (
                                        <div className="text-center py-8">
                                          <CheckCircle2 className="h-8 w-8 text-green-600 mx-auto mb-2" />
                                          <p className="text-sm text-muted-foreground">No approval issues found</p>
                                        </div>
                                      )}
                                    </TabsContent>
                                  </Tabs>
                                </div>
                              )}
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




