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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Activity,
  RefreshCw,
  CheckCircle2,
  XCircle,
  Clock,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  Rocket,
  BarChart3,
  Loader2,
  Target,
  Zap,
  ArrowUp,
  ArrowDown,
  Minus,
  GitBranch,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useQuery } from "@tanstack/react-query";
import { getApiUrl } from "@/lib/api-config";
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ComposedChart } from "recharts";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";

interface ADOProject {
  id: string;
  name: string;
  organization: string;
  organizationUrl: string;
}

interface DeploymentTrackingModalProps {
  projectId: string;
  adoProject?: ADOProject | null;
  providerSegment?: "ado" | "gitlab" | "bitbucket" | "github";
  open: boolean;
  onClose: () => void;
}

interface DeploymentTrackingData {
  overallMetrics: {
    totalDeployments: number;
    successRate: number;
    failureRate: number;
    averageDuration: number;
    totalRollbacks: number;
    rollbackRate: number;
  };
  deploymentFrequency: {
    last7Days: number;
    last30Days: number;
    last90Days: number;
    trend: "increasing" | "decreasing" | "stable";
  };
  durationTrends: {
    averageDuration: number;
    trend: "increasing" | "decreasing" | "stable";
    weeklyAverage: Array<{
      week: string;
      averageDuration: number;
    }>;
  };
  rollbackOccurrences: {
    total: number;
    byEnvironment: Array<{
      environment: string;
      count: number;
    }>;
    recentRollbacks: Array<{
      releaseId: string;
      releaseName: string;
      environment: string;
      rolledBackAt: string;
      reason?: string;
    }>;
  };
  environmentFailureRates: Array<{
    environment: string;
    totalDeployments: number;
    successful: number;
    failed: number;
    successRate: number;
    failureRate: number;
    averageDuration: number;
  }>;
  weeklyTrends: Array<{
    week: string;
    total: number;
    successful: number;
    failed: number;
    successRate: number;
  }>;
  insights: {
    deploymentsBecomingMoreDependable: boolean;
    deployingFrequentlyEnough: boolean;
    environmentWithMostFailures: string;
    productionStable: boolean;
  };
}

export function DeploymentTrackingModal({
  projectId,
  adoProject,
  providerSegment = "ado",
  open,
  onClose,
}: DeploymentTrackingModalProps) {
  const { toast } = useToast();
  const isGitLab = providerSegment === "gitlab";
  const isBitbucket = providerSegment === "bitbucket";
  const isGithub = providerSegment === "github";
  const isExternalCi = isGitLab || isBitbucket || isGithub;
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [refreshInterval, setRefreshInterval] = useState<NodeJS.Timeout | null>(null);
  const [selectedSprintPath, setSelectedSprintPath] = useState<string | null>(null);

  // Build query params for ADO project info
  const params = new URLSearchParams();
  if (adoProject?.organization) {
    params.append('organization', adoProject.organization);
  }
  if (adoProject?.name) {
    params.append('projectName', adoProject.name);
  }
  if (selectedSprintPath) {
    params.append('sprintPath', selectedSprintPath);
  }
  const queryString = params.toString();

  // Create unique query key based on projectId and adoProject
  const queryKey = [
    '/api/sdlc/projects',
    projectId,
    `${providerSegment}/maintenance/deployment-trends`,
    adoProject?.organization,
    adoProject?.name,
    selectedSprintPath,
  ];

  // Reset sprint selection when modal closes
  useEffect(() => {
    if (!open) {
      setSelectedSprintPath(null);
    }
  }, [open]);

  // Fetch sprints
  const { data: allSprints = [] } = useQuery<Array<{ path: string; name: string; startDate?: string; endDate?: string }>>({
    queryKey: [`/api/sdlc/projects/${projectId}/ado/sprints`, queryString],
    queryFn: async () => {
      if (!adoProject || isExternalCi) return [];
      const sprintsUrl = getApiUrl(`/api/sdlc/projects/${projectId}/ado/sprints${queryString ? `?${queryString}` : ''}`);
      const res = await fetch(sprintsUrl, { credentials: "include" });
      if (!res.ok) {
        const errorText = await res.text();
        console.warn(`[DeploymentTrackingModal] Failed to fetch sprints: ${res.status}`, errorText);
        return [];
      }
      return res.json();
    },
    enabled: open && !!projectId && !!adoProject && !isExternalCi,
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
    retry: 1,
  });

  // Fetch ADO config (cached)
  const { data: providerConfig, error: configError } = useQuery<{ hasConfig: boolean; organization?: string; project?: string }>({
    queryKey: [`/api/sdlc/projects/${projectId}/${providerSegment}-config`, queryString],
    queryFn: async () => {
      if (isExternalCi) {
        const externalKey = isBitbucket ? "bitbucket" : isGithub ? "github" : "gitlab";
        const contextUrl = getApiUrl(
          `/api/sdlc/projects/${projectId}/${externalKey}/context-status${queryString ? `?${queryString}` : ""}`,
        );
        const contextRes = await fetch(contextUrl, { credentials: "include" });
        if (!contextRes.ok) return { hasConfig: false };
        const context = await contextRes.json();
        return { hasConfig: Boolean(context?.hasConfig) };
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
    enabled: open && !!projectId,
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
    retry: 1,
  });

  const hasProviderConfig = providerConfig?.hasConfig || false;

  // Fetch deployment tracking data
  const {
    data: trackingData,
    isLoading: loading,
    isFetching: refreshing,
    error: trackingError,
    refetch: refetchTracking,
  } = useQuery<DeploymentTrackingData>({
    queryKey,
    queryFn: async () => {
      if (!hasProviderConfig) {
        throw new Error(
          isExternalCi
            ? "No Data Available"
            : "No Data Available",
        );
      }

      const trackingUrl = getApiUrl(
        `/api/sdlc/projects/${projectId}/${providerSegment}/maintenance/deployment-trends${queryString ? `?${queryString}` : ''}`
      );
      const fetchUrl = selectedSprintPath ? `${trackingUrl}&_t=${Date.now()}` : trackingUrl;
      const trackingRes = await fetch(fetchUrl, { credentials: "include", cache: selectedSprintPath ? 'no-cache' : 'default' });

      if (!trackingRes.ok) {
        throw new Error(`Failed to fetch deployment tracking data: ${trackingRes.status} ${trackingRes.statusText}`);
      }

      const raw = await trackingRes.json();
      if (isExternalCi) {
        const total = Number(raw?.overallMetrics?.totalDeployments || 0);
        const success = Number(raw?.overallMetrics?.successfulDeployments || 0);
        const failed = Number(raw?.overallMetrics?.failedDeployments || 0);
        const successRate = total > 0 ? (success / total) * 100 : 0;
        const failureRate = total > 0 ? (failed / total) * 100 : 0;
        const safeEnvironmentRates = Array.isArray(raw?.environmentFailureRates) ? raw.environmentFailureRates : [];
        const safeWeeklyTrends = Array.isArray(raw?.weeklyTrends) ? raw.weeklyTrends : [];
        const safeWeeklyAverage = Array.isArray(raw?.durationTrends?.weeklyAverage) ? raw.durationTrends.weeklyAverage : [];
        const safeRollbacks = Array.isArray(raw?.rollbackOccurrences?.recentRollbacks) ? raw.rollbackOccurrences.recentRollbacks : [];
        return {
          overallMetrics: { totalDeployments: total, successRate, failureRate, averageDuration: 0, totalRollbacks: 0, rollbackRate: 0 },
          deploymentFrequency: { last7Days: total, last30Days: total, last90Days: total, trend: "stable" },
          durationTrends: { averageDuration: Number(raw?.durationTrends?.averageDuration || 0), trend: "stable", weeklyAverage: safeWeeklyAverage },
          rollbackOccurrences: { total: Number(raw?.rollbackOccurrences?.total || 0), byEnvironment: Array.isArray(raw?.rollbackOccurrences?.byEnvironment) ? raw.rollbackOccurrences.byEnvironment : [], recentRollbacks: safeRollbacks },
          environmentFailureRates: safeEnvironmentRates,
          weeklyTrends: safeWeeklyTrends,
          insights: { deploymentsBecomingMoreDependable: true, deployingFrequentlyEnough: total > 0, environmentWithMostFailures: "N/A", productionStable: failed === 0 },
        } as DeploymentTrackingData;
      }
      return raw;
    },
    enabled: open && !!projectId && hasProviderConfig,
    staleTime: 2 * 60 * 1000, // 2 minutes for real-time tracking
    gcTime: 5 * 60 * 1000,
    retry: 1,
    refetchInterval: autoRefresh ? 30000 : false, // Auto-refresh every 30 seconds if enabled
  });

  // Auto-refresh setup
  useEffect(() => {
    if (autoRefresh && open) {
      const interval = setInterval(() => {
        refetchTracking();
      }, 30000); // 30 seconds
      setRefreshInterval(interval);
      return () => {
        if (interval) clearInterval(interval);
      };
    } else if (refreshInterval) {
      clearInterval(refreshInterval);
      setRefreshInterval(null);
    }
  }, [autoRefresh, open, refetchTracking]);

  // Show error toast if there's an error
  useEffect(() => {
    if (configError) {
      toast({
        title: "Error",
        description:
          configError instanceof Error
            ? configError.message
            : `Failed to fetch ${isExternalCi ? (isBitbucket ? "Bitbucket" : isGithub ? "GitHub" : "GitLab") : "ADO"} configuration`,
        variant: "destructive",
      });
    }
  }, [configError, toast]);

  useEffect(() => {
    if (trackingError) {
      toast({
        title: "Error",
        description: trackingError instanceof Error ? trackingError.message : "Failed to fetch deployment tracking data",
        variant: "destructive",
      });
    }
  }, [trackingError, toast]);

  const handleRefresh = async () => {
    await refetchTracking();
  };

  const getTrendIcon = (trend: "increasing" | "decreasing" | "stable") => {
    if (trend === "increasing") return <TrendingUp className="h-4 w-4 text-green-600" />;
    if (trend === "decreasing") return <TrendingDown className="h-4 w-4 text-red-600" />;
    return <Minus className="h-4 w-4 text-gray-600" />;
  };

  const formatDuration = (minutes: number) => {
    if (minutes < 1) return `${Math.round(minutes * 60)}s`;
    if (minutes < 60) return `${Math.round(minutes)}m`;
    const hours = Math.floor(minutes / 60);
    const mins = Math.round(minutes % 60);
    return `${hours}h ${mins}m`;
  };

  const formatDate = (dateString: string) => {
    if (!dateString) return "N/A";
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  const formatWeek = (weekString: string) => {
    const date = new Date(weekString);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  // Calculate production promotion frequency
  const productionPromotions = useMemo(() => {
    if (!trackingData) return { count: 0, frequency: "N/A" };
    const envRates = Array.isArray(trackingData.environmentFailureRates) ? trackingData.environmentFailureRates : [];
    const prodEnv = envRates.find(
      e => e.environment.toLowerCase().includes('production') || e.environment.toLowerCase().includes('prod')
    );
    if (!prodEnv) return { count: 0, frequency: "N/A" };
    
    const last30Days = trackingData.deploymentFrequency.last30Days;
    const prodDeployments = prodEnv.totalDeployments;
    const perWeek = (prodDeployments / 4).toFixed(1);
    
    return {
      count: prodDeployments,
      frequency: `${perWeek} per week`,
    };
  }, [trackingData]);

  return (
    <GenericModal
      open={open}
      onOpenChange={onClose}
      title="Deployment Tracking"
      description="Real-time tracking of deployments across all environments"
      icon={Activity}
      iconClassName="bg-gradient-to-br from-blue-500 to-blue-600"
      fullScreen={true}
      contentClassName="space-y-4"
      headerActions={
        <div className="flex items-center gap-2">
          <Select
            value={selectedSprintPath || "all"}
            onValueChange={(value) => {
              if (value === "all") setSelectedSprintPath(null);
              else setSelectedSprintPath(value);
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
            disabled={refreshing || loading}
          >
            <RefreshCw className={`h-4 w-4 ${refreshing || loading ? "animate-spin" : ""}`} />
          </Button>
        </div>
      }
    >
      {!hasProviderConfig ? (
        <Card>
          <CardContent className="pt-6">
            <div className="text-center space-y-4">
              <AlertTriangle className="h-12 w-12 text-yellow-500 mx-auto" />
              <h3 className="text-lg font-semibold">{isExternalCi ? "No Data Available" : "No Data Available"}</h3>
              <p className="text-muted-foreground">
                {isExternalCi
                  ? isBitbucket
                    ? "Configure Bitbucket for Repository and Bitbucket Pipelines for CI/CD on this SDLC project (Edit project → tools), with a golden repo or repo slug."
                    : isGithub
                      ? "Configure GitHub for Repository and GitHub Actions for CI/CD on this SDLC project (Edit project → tools)."
                    : "Please configure the GitLab one-time connection in Settings > Third-Party Integrations to view deployment tracking."
                  : "No data is available for this metric at the moment."}
              </p>
            </div>
          </CardContent>
        </Card>
      ) : loading ? (
        <Card>
          <CardContent className="pt-6">
            <div className="text-center space-y-4 py-8">
              <Loader2 className="h-8 w-8 animate-spin mx-auto text-blue-600" />
              <p className="text-muted-foreground">Loading deployment tracking data...</p>
            </div>
          </CardContent>
        </Card>
      ) : trackingData ? (
        <div className="space-y-6">
          <Tabs defaultValue="overview" className="w-full">
            <TabsList className="grid w-full grid-cols-4">
              <TabsTrigger value="overview">
                <BarChart3 className="h-4 w-4 mr-2" />
                Overview
              </TabsTrigger>
              <TabsTrigger value="metrics">
                <Target className="h-4 w-4 mr-2" />
                Metrics
              </TabsTrigger>
              <TabsTrigger value="trends">
                <TrendingUp className="h-4 w-4 mr-2" />
                Trends
              </TabsTrigger>
              <TabsTrigger value="stability">
                <Activity className="h-4 w-4 mr-2" />
                Stability
              </TabsTrigger>
            </TabsList>

            {/* Overview Tab */}
            <TabsContent value="overview" className="space-y-6 mt-6">
              {/* Key Metrics Cards */}
              <div className="grid grid-cols-4 gap-4">
                <Card className="border-blue-200 dark:border-blue-800">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                      <CheckCircle2 className="h-4 w-4 text-green-600" />
                      Success Rate
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-3xl font-bold text-green-600">
                      {Math.round(trackingData.overallMetrics.successRate)}%
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      {trackingData.overallMetrics.totalDeployments - 
                       Math.round((trackingData.overallMetrics.failureRate / 100) * trackingData.overallMetrics.totalDeployments)} successful
                    </p>
                  </CardContent>
                </Card>

                <Card className="border-red-200 dark:border-red-800">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                      <XCircle className="h-4 w-4 text-red-600" />
                      Failure Rate
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-3xl font-bold text-red-600">
                      {Math.round(trackingData.overallMetrics.failureRate)}%
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      {Math.round((trackingData.overallMetrics.failureRate / 100) * trackingData.overallMetrics.totalDeployments)} failed
                    </p>
                  </CardContent>
                </Card>

                <Card className="border-purple-200 dark:border-purple-800">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                      <Clock className="h-4 w-4 text-purple-600" />
                      Avg Duration
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-3xl font-bold text-purple-600">
                      {formatDuration(trackingData.overallMetrics.averageDuration)}
                    </div>
                    <div className="flex items-center gap-1 mt-1">
                      {getTrendIcon(trackingData.durationTrends.trend)}
                      <p className="text-xs text-muted-foreground">
                        {trackingData.durationTrends.trend}
                      </p>
                    </div>
                  </CardContent>
                </Card>

                <Card className="border-orange-200 dark:border-orange-800">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                      <GitBranch className="h-4 w-4 text-orange-600" />
                      Rollbacks
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-3xl font-bold text-orange-600">
                      {trackingData.overallMetrics.totalRollbacks}
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      {Math.round(trackingData.overallMetrics.rollbackRate)}% rollback rate
                    </p>
                  </CardContent>
                </Card>
              </div>

              {/* Deployment Frequency */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Deployment Frequency</CardTitle>
                  <CardDescription>
                    Number of deployments over different time periods
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-3 gap-4">
                    <div className="text-center p-4 bg-muted rounded-lg">
                      <div className="text-2xl font-bold">{trackingData.deploymentFrequency.last7Days}</div>
                      <div className="text-sm text-muted-foreground mt-1">Last 7 Days</div>
                    </div>
                    <div className="text-center p-4 bg-muted rounded-lg">
                      <div className="text-2xl font-bold">{trackingData.deploymentFrequency.last30Days}</div>
                      <div className="text-sm text-muted-foreground mt-1">Last 30 Days</div>
                    </div>
                    <div className="text-center p-4 bg-muted rounded-lg">
                      <div className="text-2xl font-bold">{trackingData.deploymentFrequency.last90Days}</div>
                      <div className="text-sm text-muted-foreground mt-1">Last 90 Days</div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            {/* Metrics Tab */}
            <TabsContent value="metrics" className="space-y-6 mt-6">
              <div className="grid grid-cols-2 gap-6">
                {/* Success/Failure Rate */}
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Success/Failure Rate</CardTitle>
                    <CardDescription>Overall release success and failure metrics</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div>
                      <div className="flex justify-between items-center mb-2">
                        <span className="text-sm font-medium">Success Rate</span>
                        <span className="text-sm font-bold text-green-600">
                          {Math.round(trackingData.overallMetrics.successRate)}%
                        </span>
                      </div>
                      <div className="w-full bg-gray-200 rounded-full h-2">
                        <div
                          className="bg-green-600 h-2 rounded-full"
                          style={{ width: `${trackingData.overallMetrics.successRate}%` }}
                        />
                      </div>
                    </div>
                    <div>
                      <div className="flex justify-between items-center mb-2">
                        <span className="text-sm font-medium">Failure Rate</span>
                        <span className="text-sm font-bold text-red-600">
                          {Math.round(trackingData.overallMetrics.failureRate)}%
                        </span>
                      </div>
                      <div className="w-full bg-gray-200 rounded-full h-2">
                        <div
                          className="bg-red-600 h-2 rounded-full"
                          style={{ width: `${trackingData.overallMetrics.failureRate}%` }}
                        />
                      </div>
                    </div>
                    <div className="pt-2 border-t">
                      <div className="text-sm text-muted-foreground">
                        Total Deployments: <span className="font-semibold">{trackingData.overallMetrics.totalDeployments}</span>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* Average Deployment Duration */}
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Average Deployment Duration</CardTitle>
                    <CardDescription>Time taken for deployments to complete</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="text-center">
                      <div className="text-4xl font-bold text-purple-600">
                        {formatDuration(trackingData.overallMetrics.averageDuration)}
                      </div>
                      <div className="flex items-center justify-center gap-2 mt-2">
                        {getTrendIcon(trackingData.durationTrends.trend)}
                        <span className="text-sm text-muted-foreground">
                          {trackingData.durationTrends.trend} trend
                        </span>
                      </div>
                    </div>
                    <div className="pt-2 border-t">
                      <div className="text-sm text-muted-foreground">
                        Last 30 days average: <span className="font-semibold">
                          {formatDuration(trackingData.durationTrends.averageDuration)}
                        </span>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>

              {/* Rollback Events */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Rollback Events</CardTitle>
                  <CardDescription>
                    Total rollbacks: {trackingData.rollbackOccurrences.total} ({Math.round(trackingData.overallMetrics.rollbackRate)}% rollback rate)
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    {trackingData.rollbackOccurrences.byEnvironment.length > 0 ? (
                      <>
                        <div>
                          <h5 className="text-sm font-semibold mb-2">Rollbacks by Environment</h5>
                          <div className="space-y-2">
                            {trackingData.rollbackOccurrences.byEnvironment.map((env, idx) => (
                              <div key={idx} className="flex items-center justify-between p-2 bg-muted rounded">
                                <span className="text-sm">{env.environment}</span>
                                <Badge variant="destructive">{env.count}</Badge>
                              </div>
                            ))}
                          </div>
                        </div>
                        {trackingData.rollbackOccurrences.recentRollbacks.length > 0 && (
                          <div>
                            <h5 className="text-sm font-semibold mb-2">Recent Rollbacks</h5>
                            <ScrollArea className="h-[200px]">
                              <div className="space-y-2">
                                {trackingData.rollbackOccurrences.recentRollbacks.map((rollback, idx) => (
                                  <div key={idx} className="p-3 bg-red-50 dark:bg-red-950/20 border border-red-200 rounded">
                                    <div className="flex items-start justify-between">
                                      <div>
                                        <div className="font-medium text-sm">{rollback.releaseName}</div>
                                        <div className="text-xs text-muted-foreground mt-1">
                                          {rollback.environment} • {formatDate(rollback.rolledBackAt)}
                                        </div>
                                        {rollback.reason && (
                                          <div className="text-xs text-red-700 dark:text-red-300 mt-1">
                                            {rollback.reason}
                                          </div>
                                        )}
                                      </div>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </ScrollArea>
                          </div>
                        )}
                      </>
                    ) : (
                      <div className="text-center py-8 text-muted-foreground">
                        <CheckCircle2 className="h-8 w-8 mx-auto mb-2 text-green-600" />
                        <p>No rollback events recorded</p>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            {/* Trends Tab */}
            <TabsContent value="trends" className="space-y-6 mt-6">
              {/* Graphs Side by Side */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Deployment Trends Over Time */}
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Deployment Trends Over Time</CardTitle>
                    <CardDescription>Weekly deployment success and failure trends</CardDescription>
                  </CardHeader>
                  <CardContent>
                    {trackingData.weeklyTrends && trackingData.weeklyTrends.length > 0 ? (
                      <>
                        <div className="h-[400px]">
                          <ChartContainer
                            config={{
                              total: { label: "Total Deployments", color: "hsl(var(--chart-1))" },
                              successful: { label: "Successful", color: "hsl(142, 76%, 36%)" },
                              failed: { label: "Failed", color: "hsl(0, 84%, 60%)" },
                              successRate: { label: "Success Rate %", color: "hsl(217, 91%, 60%)" },
                            }}
                            className="h-full"
                          >
                            <ResponsiveContainer width="100%" height="100%">
                              <ComposedChart
                                data={trackingData.weeklyTrends.map((week) => ({
                                  week: formatWeek(week.week),
                                  total: week.total,
                                  successful: week.successful,
                                  failed: week.failed,
                                  successRate: Math.round(week.successRate),
                                }))}
                                margin={{ top: 20, right: 30, left: 20, bottom: 60 }}
                              >
                                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--muted-foreground))" opacity={0.2} />
                                <XAxis
                                  dataKey="week"
                                  angle={-45}
                                  textAnchor="end"
                                  height={80}
                                  tick={{ fontSize: 12 }}
                                  stroke="hsl(var(--muted-foreground))"
                                />
                                <YAxis
                                  yAxisId="left"
                                  label={{ value: "Number of Deployments", angle: -90, position: "insideLeft" }}
                                  tick={{ fontSize: 12 }}
                                  stroke="hsl(var(--muted-foreground))"
                                />
                                <YAxis
                                  yAxisId="right"
                                  orientation="right"
                                  domain={[0, 100]}
                                  label={{ value: "Success Rate (%)", angle: 90, position: "insideRight" }}
                                  tick={{ fontSize: 12 }}
                                  stroke="hsl(var(--muted-foreground))"
                                />
                                <Tooltip
                                  content={({ active, payload }) => {
                                    if (active && payload && payload.length) {
                                      const data = payload[0].payload;
                                      return (
                                        <div className="rounded-lg border bg-background p-2 shadow-sm">
                                          <div className="grid gap-2">
                                            <div className="font-medium">{data.week}</div>
                                            <div className="flex items-center gap-2">
                                              <div className="h-3 w-3 rounded-full bg-blue-500" />
                                              <span className="text-sm">Total: {data.total}</span>
                                            </div>
                                            <div className="flex items-center gap-2">
                                              <div className="h-3 w-3 rounded-full bg-green-600" />
                                              <span className="text-sm">Successful: {data.successful}</span>
                                            </div>
                                            <div className="flex items-center gap-2">
                                              <div className="h-3 w-3 rounded-full bg-red-500" />
                                              <span className="text-sm">Failed: {data.failed}</span>
                                            </div>
                                            <div className="flex items-center gap-2">
                                              <div className="h-3 w-3 rounded-full bg-blue-500" />
                                              <span className="text-sm font-semibold">Success Rate: {data.successRate}%</span>
                                            </div>
                                          </div>
                                        </div>
                                      );
                                    }
                                    return null;
                                  }}
                                />
                                <Legend
                                  wrapperStyle={{ paddingTop: "20px" }}
                                  iconType="circle"
                                />
                                <Bar
                                  yAxisId="left"
                                  dataKey="total"
                                  name="Total Deployments"
                                  fill="hsl(var(--chart-1))"
                                  opacity={0.6}
                                  radius={[4, 4, 0, 0]}
                                />
                                <Bar
                                  yAxisId="left"
                                  dataKey="successful"
                                  name="Successful"
                                  fill="hsl(142, 76%, 36%)"
                                  radius={[4, 4, 0, 0]}
                                />
                                <Bar
                                  yAxisId="left"
                                  dataKey="failed"
                                  name="Failed"
                                  fill="hsl(0, 84%, 60%)"
                                  radius={[4, 4, 0, 0]}
                                />
                                <Line
                                  yAxisId="right"
                                  type="monotone"
                                  dataKey="successRate"
                                  name="Success Rate %"
                                  stroke="hsl(217, 91%, 60%)"
                                  strokeWidth={3}
                                  dot={{ r: 5, fill: "hsl(217, 91%, 60%)" }}
                                  activeDot={{ r: 7 }}
                                />
                              </ComposedChart>
                            </ResponsiveContainer>
                          </ChartContainer>
                        </div>
                        <div className="mt-4 pt-4 border-t space-y-2">
                          <div className="text-sm">
                            <span className="font-semibold text-muted-foreground">X-Axis:</span>
                            <span className="ml-2">Represents the time period (weeks) showing when deployments occurred</span>
                          </div>
                          <div className="text-sm">
                            <span className="font-semibold text-muted-foreground">Y-Axis (Left):</span>
                            <span className="ml-2">Shows the number of deployments (Total, Successful, and Failed)</span>
                          </div>
                          <div className="text-sm">
                            <span className="font-semibold text-muted-foreground">Y-Axis (Right):</span>
                            <span className="ml-2">Displays the success rate percentage (0-100%)</span>
                          </div>
                        </div>
                      </>
                    ) : (
                      <div className="text-center py-12 text-muted-foreground">
                        <BarChart3 className="h-12 w-12 mx-auto mb-4 opacity-50" />
                        <p>No deployment trends data available</p>
                      </div>
                    )}
                  </CardContent>
                </Card>

                {/* Duration Trends */}
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Duration Trends</CardTitle>
                    <CardDescription>Average deployment duration over time</CardDescription>
                  </CardHeader>
                  <CardContent>
                    {trackingData.durationTrends.weeklyAverage && trackingData.durationTrends.weeklyAverage.length > 0 ? (
                      <>
                        <div className="h-[400px]">
                          <ChartContainer
                            config={{
                              averageDuration: { label: "Average Duration", color: "hsl(217, 91%, 60%)" },
                            }}
                            className="h-full"
                          >
                            <ResponsiveContainer width="100%" height="100%">
                              <LineChart
                                data={trackingData.durationTrends.weeklyAverage.map((week) => ({
                                  week: formatWeek(week.week),
                                  averageDuration: week.averageDuration, // Already in minutes (formatDuration expects minutes)
                                  durationFormatted: formatDuration(week.averageDuration),
                                }))}
                                margin={{ top: 20, right: 30, left: 20, bottom: 60 }}
                              >
                                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--muted-foreground))" opacity={0.2} />
                                <XAxis
                                  dataKey="week"
                                  angle={-45}
                                  textAnchor="end"
                                  height={80}
                                  tick={{ fontSize: 12 }}
                                  stroke="hsl(var(--muted-foreground))"
                                />
                                <YAxis
                                  label={{ value: "Duration", angle: -90, position: "insideLeft" }}
                                  tick={{ fontSize: 12 }}
                                  stroke="hsl(var(--muted-foreground))"
                                  tickFormatter={(value) => {
                                    // Format minutes to readable duration (same logic as formatDuration)
                                    if (value < 1) return `${Math.round(value * 60)}s`;
                                    if (value < 60) return `${Math.round(value)}m`;
                                    const hours = Math.floor(value / 60);
                                    const mins = Math.round(value % 60);
                                    return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
                                  }}
                                />
                                <Tooltip
                                  content={({ active, payload }) => {
                                    if (active && payload && payload.length) {
                                      const data = payload[0].payload;
                                      return (
                                        <div className="rounded-lg border bg-background p-2 shadow-sm">
                                          <div className="grid gap-2">
                                            <div className="font-medium">{data.week}</div>
                                            <div className="flex items-center gap-2">
                                              <div className="h-3 w-3 rounded-full bg-blue-500" />
                                              <span className="text-sm font-semibold">
                                                Average Duration: {data.durationFormatted}
                                              </span>
                                            </div>
                                          </div>
                                        </div>
                                      );
                                    }
                                    return null;
                                  }}
                                />
                                <Legend
                                  wrapperStyle={{ paddingTop: "20px" }}
                                  iconType="circle"
                                />
                                <Line
                                  type="monotone"
                                  dataKey="averageDuration"
                                  name="Average Duration"
                                  stroke="hsl(217, 91%, 60%)"
                                  strokeWidth={3}
                                  dot={{ r: 5, fill: "hsl(217, 91%, 60%)" }}
                                  activeDot={{ r: 7 }}
                                />
                              </LineChart>
                            </ResponsiveContainer>
                          </ChartContainer>
                        </div>
                        <div className="mt-4 pt-4 border-t space-y-2">
                          <div className="text-sm">
                            <span className="font-semibold text-muted-foreground">X-Axis:</span>
                            <span className="ml-2">Represents the time period (weeks) showing when deployments occurred</span>
                          </div>
                          <div className="text-sm">
                            <span className="font-semibold text-muted-foreground">Y-Axis:</span>
                            <span className="ml-2">Shows the average deployment duration (displayed in seconds, minutes, or hours)</span>
                          </div>
                        </div>
                      </>
                    ) : (
                      <div className="text-center py-12 text-muted-foreground">
                        <Clock className="h-12 w-12 mx-auto mb-4 opacity-50" />
                        <p>No duration trends data available</p>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>
            </TabsContent>

            {/* Stability Tab */}
            <TabsContent value="stability" className="space-y-6 mt-6">
              {/* Environment Stability Patterns */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Stability Patterns Across Environments</CardTitle>
                  <CardDescription>
                    Success rates, failure rates, and average duration per environment
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <ScrollArea className="h-[500px]">
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                      {trackingData.environmentFailureRates.map((env, idx) => {
                        const successRate = Math.round(env.successRate);
                        const failureRate = Math.round(env.failureRate);
                        const circumference = 2 * Math.PI * 45; // radius = 45
                        const successOffset = circumference - (successRate / 100) * circumference;
                        const failureOffset = circumference - (failureRate / 100) * circumference;
                        
                        return (
                          <Card
                            key={idx}
                            className={`${
                              env.failureRate > 20
                                ? "border-red-200 bg-red-50/50 dark:bg-red-950/20"
                                : env.failureRate > 10
                                ? "border-yellow-200 bg-yellow-50/50 dark:bg-yellow-950/20"
                                : "border-green-200 bg-green-50/50 dark:bg-green-950/20"
                            }`}
                          >
                            <CardContent className="p-6">
                              <div className="flex items-start justify-between mb-4">
                                <div>
                                  <h4 className="font-semibold text-base">{env.environment}</h4>
                                  <div className="text-xs text-muted-foreground mt-1">
                                    {env.totalDeployments} total deployments
                                  </div>
                                </div>
                                <Badge
                                  className={
                                    env.failureRate > 20
                                      ? "bg-red-600 text-white"
                                      : env.failureRate > 10
                                      ? "bg-yellow-600 text-white"
                                      : "bg-green-600 text-white"
                                  }
                                >
                                  {successRate}% success
                                </Badge>
                              </div>

                              {/* Circular Progress Indicators */}
                              <div className="grid grid-cols-2 gap-4 mb-4">
                                {/* Success Rate Circle */}
                                <div className="flex flex-col items-center">
                                  <div className="relative w-24 h-24">
                                    <svg className="w-24 h-24 transform -rotate-90">
                                      <circle
                                        cx="48"
                                        cy="48"
                                        r="45"
                                        stroke="currentColor"
                                        strokeWidth="6"
                                        fill="none"
                                        className="text-gray-200 dark:text-gray-700"
                                      />
                                      <circle
                                        cx="48"
                                        cy="48"
                                        r="45"
                                        stroke="currentColor"
                                        strokeWidth="6"
                                        fill="none"
                                        strokeDasharray={circumference}
                                        strokeDashoffset={successOffset}
                                        className="text-green-600 transition-all duration-500"
                                        strokeLinecap="round"
                                      />
                                    </svg>
                                    <div className="absolute inset-0 flex items-center justify-center">
                                      <div className="text-center">
                                        <div className="text-lg font-bold text-green-600">{successRate}%</div>
                                        <div className="text-xs text-muted-foreground">Success</div>
                                      </div>
                                    </div>
                                  </div>
                                </div>

                                {/* Failure Rate Circle */}
                                <div className="flex flex-col items-center">
                                  <div className="relative w-24 h-24">
                                    <svg className="w-24 h-24 transform -rotate-90">
                                      <circle
                                        cx="48"
                                        cy="48"
                                        r="45"
                                        stroke="currentColor"
                                        strokeWidth="6"
                                        fill="none"
                                        className="text-gray-200 dark:text-gray-700"
                                      />
                                      <circle
                                        cx="48"
                                        cy="48"
                                        r="45"
                                        stroke="currentColor"
                                        strokeWidth="6"
                                        fill="none"
                                        strokeDasharray={circumference}
                                        strokeDashoffset={failureOffset}
                                        className="text-red-600 transition-all duration-500"
                                        strokeLinecap="round"
                                      />
                                    </svg>
                                    <div className="absolute inset-0 flex items-center justify-center">
                                      <div className="text-center">
                                        <div className="text-lg font-bold text-red-600">{failureRate}%</div>
                                        <div className="text-xs text-muted-foreground">Failed</div>
                                      </div>
                                    </div>
                                  </div>
                                </div>
                              </div>

                              {/* Deployment Stats */}
                              <div className="space-y-3 pt-4 border-t">
                                <div className="flex items-center justify-between">
                                  <div className="flex items-center gap-2">
                                    <CheckCircle2 className="h-4 w-4 text-green-600" />
                                    <span className="text-sm text-muted-foreground">Successful</span>
                                  </div>
                                  <span className="text-sm font-semibold text-green-600">{env.successful}</span>
                                </div>
                                <div className="flex items-center justify-between">
                                  <div className="flex items-center gap-2">
                                    <XCircle className="h-4 w-4 text-red-600" />
                                    <span className="text-sm text-muted-foreground">Failed</span>
                                  </div>
                                  <span className="text-sm font-semibold text-red-600">{env.failed}</span>
                                </div>
                                <div className="flex items-center justify-between">
                                  <div className="flex items-center gap-2">
                                    <Clock className="h-4 w-4 text-purple-600" />
                                    <span className="text-sm text-muted-foreground">Avg Duration</span>
                                  </div>
                                  <span className="text-sm font-semibold text-purple-600">
                                    {formatDuration(env.averageDuration)}
                                  </span>
                                </div>
                              </div>
                            </CardContent>
                          </Card>
                        );
                      })}
                    </div>
                  </ScrollArea>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>
      ) : null}
    </GenericModal>
  );
}




