import { useMemo, useState } from "react";
import { GenericModal } from "@/components/ui/generic-modal";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  TrendingUp,
  TrendingDown,
  RefreshCw,
  CheckCircle2,
  XCircle,
  Clock,
  Activity,
  GitBranch,
  Loader2,
  AlertTriangle,
  BarChart3,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useQuery } from "@tanstack/react-query";
import { getApiUrl } from "@/lib/api-config";
import { ComposedChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";

interface ADOProject {
  id: string;
  name: string;
  organization: string;
  organizationUrl: string;
}

interface DeploymentTrendsModalProps {
  projectId: string;
  adoProject?: ADOProject | null;
  providerSegment?: "ado" | "gitlab" | "bitbucket" | "github";
  open: boolean;
  onClose: () => void;
}

interface DeploymentTrendsData {
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
  insights?: {
    deploymentsBecomingMoreDependable: boolean;
    deployingFrequentlyEnough: boolean;
    environmentWithMostFailures: string;
    productionStable: boolean;
  };
}

export function DeploymentTrendsModal({
  projectId,
  adoProject,
  providerSegment = "ado",
  open,
  onClose,
}: DeploymentTrendsModalProps) {
  const { toast } = useToast();
  const isGitLab = providerSegment === "gitlab";
  const isBitbucket = providerSegment === "bitbucket";
  const isGithub = providerSegment === "github";
  const isExternalCi = isGitLab || isBitbucket || isGithub;

  // Build query params for ADO project info
  const params = new URLSearchParams();
  if (adoProject?.organization) {
    params.append("organization", adoProject.organization);
  }
  if (adoProject?.name) {
    params.append("projectName", adoProject.name);
  }
  const queryString = params.toString();

  // Fetch ADO config
  const { data: providerConfig, error: configError } = useQuery<{
    hasConfig: boolean;
    organization: string;
    project: string;
  }>({
    queryKey: [`/api/sdlc/projects/${projectId}/${providerSegment}-config`, queryString],
    queryFn: async () => {
      if (isExternalCi) {
        const ciKey = isBitbucket ? "bitbucket" : isGithub ? "github" : "gitlab";
        const contextUrl = getApiUrl(
          `/api/sdlc/projects/${projectId}/${ciKey}/context-status${queryString ? `?${queryString}` : ""}`,
        );
        const gitlabRes = await fetch(contextUrl, { credentials: "include" });
        if (!gitlabRes.ok) return { hasConfig: false, organization: "", project: "" };
        const gitlabContext = await gitlabRes.json();
        return { hasConfig: Boolean(gitlabContext?.hasConfig), organization: "", project: "" };
      }
      const configUrl = getApiUrl(
        `/api/sdlc/projects/${projectId}/ado-config${queryString ? `?${queryString}` : ""}`
      );
      const configRes = await fetch(configUrl, { credentials: "include" });

      if (!configRes.ok) {
        throw new Error(
          `Configuration check failed: ${configRes.status} ${configRes.statusText}`
        );
      }

      return configRes.json();
    },
    enabled: open && !!projectId,
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
    retry: 1,
  });

  const hasProviderConfig = providerConfig?.hasConfig || false;
  const adoOrganization = adoProject?.organization || providerConfig?.organization || "";
  const adoProjectName = adoProject?.name || providerConfig?.project || "";

  // Build query params for maintenance API calls
  const maintenanceParams = new URLSearchParams();
  if (adoOrganization) {
    maintenanceParams.append("organization", adoOrganization);
  }
  if (adoProjectName) {
    maintenanceParams.append("projectName", adoProjectName);
  }
  const maintenanceQueryString = maintenanceParams.toString();

  // Fetch deployment trends data
  const {
    data: trendsData,
    isLoading: loading,
    isFetching: refreshing,
    error: trendsError,
    refetch: refetchTrends,
  } = useQuery<DeploymentTrendsData>({
    queryKey: [
      "/api/sdlc/projects",
      projectId,
      "maintenance/deployment-trends",
      providerSegment,
      adoOrganization,
      adoProjectName,
    ],
    queryFn: async () => {
      const trendsUrl = getApiUrl(
        `/api/sdlc/projects/${projectId}/${providerSegment}/maintenance/deployment-trends${maintenanceQueryString ? `?${maintenanceQueryString}` : ""}`
      );
      const trendsRes = await fetch(trendsUrl, { credentials: "include" });

      if (!trendsRes.ok) {
        throw new Error(
          `Failed to fetch deployment trends: ${trendsRes.status} ${trendsRes.statusText}`
        );
      }

      const raw = await trendsRes.json();
      if (isExternalCi) {
        const total = raw?.overallMetrics?.totalDeployments || 0;
        const success = raw?.overallMetrics?.successfulDeployments || 0;
        const failed = raw?.overallMetrics?.failedDeployments || 0;
        const successRate = total > 0 ? (success / total) * 100 : 0;
        return {
          overallMetrics: { totalDeployments: total, successRate, failureRate: 100 - successRate, averageDuration: 0, totalRollbacks: 0, rollbackRate: 0 },
          deploymentFrequency: { last7Days: total, last30Days: total, last90Days: total, trend: "stable" },
          durationTrends: { averageDuration: 0, trend: "stable", weeklyAverage: [] },
          rollbackOccurrences: { total: 0, byEnvironment: [], recentRollbacks: [] },
          environmentFailureRates: [],
          weeklyTrends: [],
          insights: { deploymentsBecomingMoreDependable: true, deployingFrequentlyEnough: total > 0, environmentWithMostFailures: "N/A", productionStable: failed === 0 },
        } as DeploymentTrendsData;
      }
      return raw;
    },
    enabled: open && !!projectId && hasProviderConfig,
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
    retry: 1,
  });

  const displayTrends = useMemo((): DeploymentTrendsData | null => {
    if (!trendsData?.overallMetrics) return null;
    return {
      ...trendsData,
      deploymentFrequency: trendsData.deploymentFrequency ?? {
        last7Days: 0,
        last30Days: 0,
        last90Days: 0,
        trend: "stable",
      },
      durationTrends: trendsData.durationTrends ?? {
        averageDuration: 0,
        trend: "stable",
        weeklyAverage: [],
      },
      rollbackOccurrences: trendsData.rollbackOccurrences ?? {
        total: 0,
        byEnvironment: [],
        recentRollbacks: [],
      },
      environmentFailureRates: trendsData.environmentFailureRates ?? [],
      weeklyTrends: trendsData.weeklyTrends ?? [],
      insights: trendsData.insights ?? {
        deploymentsBecomingMoreDependable: false,
        deployingFrequentlyEnough: false,
        environmentWithMostFailures: "N/A",
        productionStable: true,
      },
    };
  }, [trendsData]);

  const handleRefresh = async () => {
    await refetchTrends();
  };

  return (
    <GenericModal
      open={open}
      onOpenChange={onClose}
      title="Deployment Trends"
      description="Historical view of deployment performance across environments"
      icon={BarChart3}
      iconClassName="bg-gradient-to-br from-purple-500 to-purple-600"
      fullScreen={true}
      contentClassName="space-y-6"
      headerActions={
        <Button
          variant="outline"
          size="sm"
          onClick={handleRefresh}
          disabled={refreshing}
        >
          <RefreshCw className={`h-4 w-4 mr-2 ${refreshing ? "animate-spin" : ""}`} />
        </Button>
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
                    : "Please configure the GitLab one-time connection in Settings > Third-Party Integrations."
                  : "No data is available for this metric at the moment."}
              </p>
            </div>
          </CardContent>
        </Card>
      ) : loading ? (
        <Card>
          <CardContent className="pt-6">
            <p className="text-center text-muted-foreground py-8 flex items-center justify-center gap-2">
              <Loader2 className="h-5 w-5 animate-spin" />
              Loading deployment trends...
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="h-full w-full flex flex-col" style={{ height: '100%', minHeight: 0 }}>
          <ScrollArea className="flex-1 w-full" style={{ height: '100%' }}>
            <div className="space-y-6 px-6 py-4">
            {displayTrends && (
              <>

                {/* Overall Metrics - Redesigned */}
                <div className="space-y-4">
                  <div className="flex items-center gap-2">
                    <Activity className="h-5 w-5 text-purple-600" />
                    <h3 className="text-lg font-bold">Overall Deployment Metrics</h3>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                    <Card className="bg-gradient-to-br from-blue-50 to-blue-100 dark:from-blue-950/30 dark:to-blue-900/20 border-blue-200 dark:border-blue-800 shadow-md hover:shadow-lg transition-shadow">
                      <CardContent className="pt-6 pb-4">
                        <div className="flex items-center justify-between mb-2">
                          <div className="text-sm font-medium text-muted-foreground">Total Deployments</div>
                          <Activity className="h-4 w-4 text-blue-600" />
                        </div>
                        <div className="text-3xl font-bold text-blue-600">
                          {displayTrends.overallMetrics?.totalDeployments || 0}
                        </div>
                      </CardContent>
                    </Card>
                    <Card className="bg-gradient-to-br from-green-50 to-emerald-100 dark:from-green-950/30 dark:to-emerald-900/20 border-green-200 dark:border-green-800 shadow-md hover:shadow-lg transition-shadow">
                      <CardContent className="pt-6 pb-4">
                        <div className="flex items-center justify-between mb-2">
                          <div className="text-sm font-medium text-muted-foreground">Success Rate</div>
                          <CheckCircle2 className="h-4 w-4 text-green-600" />
                        </div>
                        <div className="text-3xl font-bold text-green-600">
                          {Math.round(displayTrends.overallMetrics?.successRate || 0)}%
                        </div>
                      </CardContent>
                    </Card>
                    <Card className="bg-gradient-to-br from-red-50 to-rose-100 dark:from-red-950/30 dark:to-rose-900/20 border-red-200 dark:border-red-800 shadow-md hover:shadow-lg transition-shadow">
                      <CardContent className="pt-6 pb-4">
                        <div className="flex items-center justify-between mb-2">
                          <div className="text-sm font-medium text-muted-foreground">Failure Rate</div>
                          <XCircle className="h-4 w-4 text-red-600" />
                        </div>
                        <div className="text-3xl font-bold text-red-600">
                          {Math.round(displayTrends.overallMetrics?.failureRate || 0)}%
                        </div>
                      </CardContent>
                    </Card>
                    <Card className="bg-gradient-to-br from-purple-50 to-indigo-100 dark:from-purple-950/30 dark:to-indigo-900/20 border-purple-200 dark:border-purple-800 shadow-md hover:shadow-lg transition-shadow">
                      <CardContent className="pt-6 pb-4">
                        <div className="flex items-center justify-between mb-2">
                          <div className="text-sm font-medium text-muted-foreground">Avg Duration</div>
                          <Clock className="h-4 w-4 text-purple-600" />
                        </div>
                        <div className="text-3xl font-bold text-purple-600">
                          {Math.round(displayTrends.overallMetrics?.averageDuration || 0)} min
                        </div>
                      </CardContent>
                    </Card>
                    <Card className="bg-gradient-to-br from-orange-50 to-amber-100 dark:from-orange-950/30 dark:to-amber-900/20 border-orange-200 dark:border-orange-800 shadow-md hover:shadow-lg transition-shadow">
                      <CardContent className="pt-6 pb-4">
                        <div className="flex items-center justify-between mb-2">
                          <div className="text-sm font-medium text-muted-foreground">Total Rollbacks</div>
                          <GitBranch className="h-4 w-4 text-orange-600" />
                        </div>
                        <div className="text-3xl font-bold text-orange-600">
                          {displayTrends.overallMetrics?.totalRollbacks || 0}
                        </div>
                        <div className="text-xs text-muted-foreground mt-2 font-medium">
                          {Math.round(displayTrends.overallMetrics?.rollbackRate || 0)}% rollback rate
                        </div>
                      </CardContent>
                    </Card>
                  </div>
                </div>

                {/* Deployment Frequency - Redesigned */}
                <Card className="bg-gradient-to-br from-slate-50 to-gray-50 dark:from-slate-900/50 dark:to-gray-900/30 border-slate-200 dark:border-slate-800 shadow-lg">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-lg flex items-center gap-2">
                      <BarChart3 className="h-5 w-5 text-indigo-600" />
                      Deployment Frequency
                    </CardTitle>
                    <CardDescription>Deployment activity over different time periods</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                      <div className="bg-white dark:bg-slate-800 rounded-lg p-4 border border-slate-200 dark:border-slate-700 shadow-sm">
                        <div className="flex items-center justify-between mb-2">
                          <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Last 7 Days</div>
                          <div className="h-2 w-2 rounded-full bg-blue-500"></div>
                        </div>
                        <div className="text-2xl font-bold text-slate-900 dark:text-slate-100">
                          {displayTrends.deploymentFrequency.last7Days || 0}
                        </div>
                        <div className="text-xs text-muted-foreground mt-1">deployments</div>
                      </div>
                      <div className="bg-white dark:bg-slate-800 rounded-lg p-4 border border-slate-200 dark:border-slate-700 shadow-sm">
                        <div className="flex items-center justify-between mb-2">
                          <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Last 30 Days</div>
                          <div className="h-2 w-2 rounded-full bg-indigo-500"></div>
                        </div>
                        <div className="text-2xl font-bold text-slate-900 dark:text-slate-100">
                          {displayTrends.deploymentFrequency.last30Days || 0}
                        </div>
                        <div className="text-xs text-muted-foreground mt-1">deployments</div>
                      </div>
                      <div className="bg-white dark:bg-slate-800 rounded-lg p-4 border border-slate-200 dark:border-slate-700 shadow-sm">
                        <div className="flex items-center justify-between mb-2">
                          <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Last 90 Days</div>
                          <div className="h-2 w-2 rounded-full bg-purple-500"></div>
                        </div>
                        <div className="text-2xl font-bold text-slate-900 dark:text-slate-100">
                          {displayTrends.deploymentFrequency.last90Days || 0}
                        </div>
                        <div className="text-xs text-muted-foreground mt-1">deployments</div>
                      </div>
                      <div className="bg-white dark:bg-slate-800 rounded-lg p-4 border border-slate-200 dark:border-slate-700 shadow-sm">
                        <div className="flex items-center justify-between mb-2">
                          <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Trend</div>
                          {displayTrends.deploymentFrequency.trend === "increasing" ? (
                            <TrendingUp className="h-4 w-4 text-green-600" />
                          ) : displayTrends.deploymentFrequency.trend === "decreasing" ? (
                            <TrendingDown className="h-4 w-4 text-red-600" />
                          ) : (
                            <Activity className="h-4 w-4 text-blue-600" />
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          {displayTrends.deploymentFrequency.trend === "increasing" ? (
                            <span className="text-lg font-bold text-green-600">Increasing</span>
                          ) : displayTrends.deploymentFrequency.trend === "decreasing" ? (
                            <span className="text-lg font-bold text-red-600">Decreasing</span>
                          ) : (
                            <span className="text-lg font-bold text-blue-600">Stable</span>
                          )}
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* Duration Trends - Redesigned */}
                <Card className="bg-gradient-to-br from-cyan-50 to-blue-50 dark:from-cyan-950/30 dark:to-blue-900/20 border-cyan-200 dark:border-cyan-800 shadow-lg">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-lg flex items-center gap-2">
                      <Clock className="h-5 w-5 text-cyan-600" />
                      Duration Trends
                    </CardTitle>
                    <CardDescription>Average deployment duration over time</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                      <div className="bg-white dark:bg-slate-800 rounded-lg p-5 border border-cyan-200 dark:border-cyan-800 shadow-sm">
                        <div className="flex items-center justify-between mb-3">
                          <div className="text-sm font-medium text-muted-foreground">Average Duration</div>
                          <Clock className="h-5 w-5 text-cyan-600" />
                        </div>
                        <div className="text-3xl font-bold text-cyan-600">
                          {Math.round(displayTrends.durationTrends.averageDuration || 0)} min
                        </div>
                      </div>
                      <div className="bg-white dark:bg-slate-800 rounded-lg p-5 border border-cyan-200 dark:border-cyan-800 shadow-sm">
                        <div className="flex items-center justify-between mb-3">
                          <div className="text-sm font-medium text-muted-foreground">Trend</div>
                          {displayTrends.durationTrends.trend === "increasing" ? (
                            <TrendingUp className="h-5 w-5 text-red-600" />
                          ) : displayTrends.durationTrends.trend === "decreasing" ? (
                            <TrendingDown className="h-5 w-5 text-green-600" />
                          ) : (
                            <Activity className="h-5 w-5 text-blue-600" />
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          {displayTrends.durationTrends.trend === "increasing" ? (
                            <>
                              <span className="text-2xl font-bold text-red-600">Increasing</span>
                              <span className="text-xs text-muted-foreground">(slower)</span>
                            </>
                          ) : displayTrends.durationTrends.trend === "decreasing" ? (
                            <>
                              <span className="text-2xl font-bold text-green-600">Decreasing</span>
                              <span className="text-xs text-muted-foreground">(faster)</span>
                            </>
                          ) : (
                            <span className="text-2xl font-bold text-blue-600">Stable</span>
                          )}
                        </div>
                      </div>
                    </div>
                    {displayTrends.durationTrends.weeklyAverage && displayTrends.durationTrends.weeklyAverage.length > 0 && (
                      <div className="space-y-3">
                        <p className="text-sm font-semibold text-slate-700 dark:text-slate-300">Weekly Average Duration</p>
                        <div className="space-y-3">
                          {displayTrends.durationTrends.weeklyAverage.map((week, idx) => {
                            const maxDuration = Math.max(...displayTrends.durationTrends.weeklyAverage.map((w) => w.averageDuration), 1);
                            const percentage = Math.min((week.averageDuration / maxDuration) * 100, 100);
                            return (
                              <div key={idx} className="bg-white dark:bg-slate-800 rounded-lg p-3 border border-slate-200 dark:border-slate-700">
                                <div className="flex items-center justify-between mb-2">
                                  <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
                                    {new Date(week.week).toLocaleDateString("en-US", {
                                      month: "short",
                                      day: "numeric",
                                    })}
                                  </span>
                                  <span className="text-sm font-bold text-cyan-600">
                                    {Math.round(week.averageDuration)} min
                                  </span>
                                </div>
                                <div className="w-full bg-slate-200 dark:bg-slate-700 rounded-full h-2.5 overflow-hidden">
                                  <div
                                    className="bg-gradient-to-r from-cyan-500 to-blue-500 h-2.5 rounded-full transition-all duration-500"
                                    style={{ width: `${percentage}%` }}
                                  />
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>

                {/* Rollback Occurrences - Redesigned */}
                <Card className="bg-gradient-to-br from-orange-50 to-amber-50 dark:from-orange-950/30 dark:to-amber-900/20 border-orange-200 dark:border-orange-800 shadow-lg">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-lg flex items-center gap-2">
                      <GitBranch className="h-5 w-5 text-orange-600" />
                      Rollback Occurrences
                    </CardTitle>
                    <CardDescription>Rollback statistics and recent occurrences</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                      <div className="bg-white dark:bg-slate-800 rounded-lg p-5 border border-orange-200 dark:border-orange-800 shadow-sm">
                        <div className="flex items-center justify-between mb-3">
                          <div className="text-sm font-medium text-muted-foreground">Total Rollbacks</div>
                          <GitBranch className="h-5 w-5 text-orange-600" />
                        </div>
                        <div className="text-3xl font-bold text-orange-600">
                          {displayTrends.rollbackOccurrences.total || 0}
                        </div>
                      </div>
                      <div className="bg-white dark:bg-slate-800 rounded-lg p-5 border border-orange-200 dark:border-orange-800 shadow-sm">
                        <div className="flex items-center justify-between mb-3">
                          <div className="text-sm font-medium text-muted-foreground">Rollback Rate</div>
                          <AlertTriangle className="h-5 w-5 text-orange-600" />
                        </div>
                        <div className="text-3xl font-bold text-orange-600">
                          {Math.round(
                            (displayTrends.rollbackOccurrences.total /
                              Math.max(displayTrends.overallMetrics.totalDeployments, 1)) *
                              100
                          ) || 0}
                          %
                        </div>
                      </div>
                    </div>
                    {displayTrends.rollbackOccurrences.byEnvironment &&
                      displayTrends.rollbackOccurrences.byEnvironment.length > 0 && (
                        <div className="mb-6">
                          <p className="text-sm font-semibold mb-3 text-slate-700 dark:text-slate-300">Rollbacks by Environment</p>
                          <div className="grid grid-cols-3 gap-3">
                            {displayTrends.rollbackOccurrences.byEnvironment.map((env, idx) => (
                              <div key={idx} className="bg-white dark:bg-slate-800 rounded-lg p-4 border border-orange-200 dark:border-orange-800 shadow-sm text-center">
                                <div className="text-xs font-medium text-muted-foreground mb-1">{env.environment}</div>
                                <div className="text-2xl font-bold text-orange-600">{env.count}</div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    {displayTrends.rollbackOccurrences.recentRollbacks &&
                      displayTrends.rollbackOccurrences.recentRollbacks.length > 0 && (
                        <div>
                          <p className="text-sm font-semibold mb-3 text-slate-700 dark:text-slate-300">Recent Rollbacks</p>
                          <ScrollArea className="h-[200px] pr-4">
                            <div className="space-y-2">
                              {displayTrends.rollbackOccurrences.recentRollbacks.map((rollback, idx) => (
                                <div key={idx} className="bg-white dark:bg-slate-800 rounded-lg p-4 border border-orange-200 dark:border-orange-800 shadow-sm hover:shadow-md transition-shadow">
                                  <div className="flex items-center justify-between">
                                    <div>
                                      <p className="font-semibold text-sm text-slate-900 dark:text-slate-100">{rollback.releaseName}</p>
                                      <p className="text-xs text-muted-foreground mt-1">
                                        {rollback.environment} •{" "}
                                        {new Date(rollback.rolledBackAt).toLocaleString()}
                                      </p>
                                    </div>
                                    <Badge variant="outline" className="text-orange-600 border-orange-300 bg-orange-50 dark:bg-orange-950/20">
                                      Rolled Back
                                    </Badge>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </ScrollArea>
                        </div>
                      )}
                  </CardContent>
                </Card>

                {/* Environment-Specific Failure Rates - Redesigned */}
                <Card className="bg-gradient-to-br from-red-50 to-rose-50 dark:from-red-950/30 dark:to-rose-900/20 border-red-200 dark:border-red-800 shadow-lg">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-lg flex items-center gap-2">
                      <AlertTriangle className="h-5 w-5 text-red-600" />
                      Environment-Specific Failure Rates
                    </CardTitle>
                    <CardDescription>Deployment performance breakdown by environment</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {displayTrends.environmentFailureRates.map((env, idx) => (
                          <Card
                            key={idx}
                            className={`border-2 ${
                              env.failureRate > 30
                                ? "border-red-200 bg-red-50 dark:bg-red-950/20"
                                : env.failureRate > 15
                                ? "border-yellow-200 bg-yellow-50 dark:bg-yellow-950/20"
                                : "border-green-200 bg-green-50 dark:bg-green-950/20"
                            }`}
                          >
                            <CardContent className="p-3">
                              <div className="space-y-3">
                                <div>
                                  <p className="font-semibold text-base mb-0.5">{env.environment}</p>
                                  <p className="text-xs text-muted-foreground">
                                    {env.totalDeployments} total deployments
                                  </p>
                                </div>

                                <div className="flex items-center justify-center gap-4">
                                  {/* Success Rate Circular Progress */}
                                  <div className="flex flex-col items-center">
                                    <div className="relative w-24 h-24 mb-1.5">
                                      <svg className="w-24 h-24 transform -rotate-90">
                                        <circle
                                          cx="48"
                                          cy="48"
                                          r="40"
                                          stroke="currentColor"
                                          strokeWidth="6"
                                          fill="none"
                                          className="text-gray-200 dark:text-gray-700"
                                        />
                                        <circle
                                          cx="48"
                                          cy="48"
                                          r="40"
                                          stroke="currentColor"
                                          strokeWidth="6"
                                          fill="none"
                                          strokeDasharray={`${(env.successRate / 100) * 251.2} 251.2`}
                                          className="text-green-600"
                                          style={{ transition: "all 0.5s ease" }}
                                          strokeLinecap="round"
                                        />
                                      </svg>
                                      <div className="absolute inset-0 flex items-center justify-center">
                                        <div className="text-center">
                                          <div className="text-lg font-bold text-green-600">
                                            {Math.round(env.successRate)}%
                                          </div>
                                          <div className="text-xs text-muted-foreground">Success</div>
                                        </div>
                                      </div>
                                    </div>
                                    <div className="flex items-center gap-1">
                                      <CheckCircle2 className="h-3 w-3 text-green-600" />
                                      <span className="text-xs font-semibold text-green-600">
                                        {env.successful}
                                      </span>
                                    </div>
                                  </div>

                                  {/* Failure Rate Circular Progress */}
                                  <div className="flex flex-col items-center">
                                    <div className="relative w-24 h-24 mb-1.5">
                                      <svg className="w-24 h-24 transform -rotate-90">
                                        <circle
                                          cx="48"
                                          cy="48"
                                          r="40"
                                          stroke="currentColor"
                                          strokeWidth="6"
                                          fill="none"
                                          className="text-gray-200 dark:text-gray-700"
                                        />
                                        <circle
                                          cx="48"
                                          cy="48"
                                          r="40"
                                          stroke="currentColor"
                                          strokeWidth="6"
                                          fill="none"
                                          strokeDasharray={`${(env.failureRate / 100) * 251.2} 251.2`}
                                          className={
                                            env.failureRate > 30
                                              ? "text-red-600"
                                              : env.failureRate > 15
                                              ? "text-yellow-600"
                                              : "text-orange-600"
                                          }
                                          style={{ transition: "all 0.5s ease" }}
                                          strokeLinecap="round"
                                        />
                                      </svg>
                                      <div className="absolute inset-0 flex items-center justify-center">
                                        <div className="text-center">
                                          <div
                                            className={`text-lg font-bold ${
                                              env.failureRate > 30
                                                ? "text-red-600"
                                                : env.failureRate > 15
                                                ? "text-yellow-600"
                                                : "text-orange-600"
                                            }`}
                                          >
                                            {Math.round(env.failureRate)}%
                                          </div>
                                          <div className="text-xs text-muted-foreground">Failure</div>
                                        </div>
                                      </div>
                                    </div>
                                    <div className="flex items-center gap-1">
                                      <XCircle className="h-3 w-3 text-red-600" />
                                      <span className="text-xs font-semibold text-red-600">
                                        {env.failed}
                                      </span>
                                    </div>
                                  </div>
                                </div>

                                <div className="pt-2 border-t">
                                  <div className="text-center text-xs text-muted-foreground">
                                    Avg Duration: <span className="font-semibold">{Math.round(env.averageDuration)} min</span>
                                  </div>
                                </div>
                              </div>
                            </CardContent>
                          </Card>
                        ))}
                    </div>
                  </CardContent>
                </Card>

                {/* Weekly Trends - Redesigned */}
                <Card className="bg-gradient-to-br from-purple-50 to-pink-50 dark:from-purple-950/30 dark:to-pink-900/20 border-purple-200 dark:border-purple-800 shadow-lg">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-lg flex items-center gap-2">
                      <BarChart3 className="h-5 w-5 text-purple-600" />
                      Weekly Deployment Trends
                    </CardTitle>
                    <CardDescription>Deployment success and failure trends over time</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <ScrollArea className="h-[300px] pr-4">
                      <div className="space-y-3">
                        {displayTrends.weeklyTrends.map((week, idx) => {
                          const successRate = Math.round(week.successRate);
                          const successPercentage = week.total > 0 ? (week.successful / week.total) * 100 : 0;
                          const failurePercentage = week.total > 0 ? (week.failed / week.total) * 100 : 0;
                          
                          return (
                            <div key={idx} className="bg-white dark:bg-slate-800 rounded-lg p-4 border border-slate-200 dark:border-slate-700 shadow-sm hover:shadow-md transition-shadow">
                              <div className="flex items-center justify-between mb-3">
                                <span className="font-semibold text-slate-900 dark:text-slate-100">
                                  {new Date(week.week).toLocaleDateString("en-US", {
                                    month: "short",
                                    day: "numeric",
                                    year: "numeric",
                                  })}
                                </span>
                                <div className="flex items-center gap-3">
                                  <div className="flex items-center gap-1.5">
                                    <CheckCircle2 className="h-4 w-4 text-green-600" />
                                    <span className="text-sm font-semibold text-green-600">
                                      {week.successful}
                                    </span>
                                  </div>
                                  <div className="flex items-center gap-1.5">
                                    <XCircle className="h-4 w-4 text-red-600" />
                                    <span className="text-sm font-semibold text-red-600">
                                      {week.failed}
                                    </span>
                                  </div>
                                  <Badge variant="outline" className={
                                    successRate >= 80
                                      ? "border-green-300 text-green-700 bg-green-50 dark:bg-green-950/20"
                                      : successRate >= 50
                                      ? "border-yellow-300 text-yellow-700 bg-yellow-50 dark:bg-yellow-950/20"
                                      : "border-red-300 text-red-700 bg-red-50 dark:bg-red-950/20"
                                  }>
                                    {successRate}% success
                                  </Badge>
                                </div>
                              </div>
                              <div className="w-full bg-slate-200 dark:bg-slate-700 rounded-full h-3 flex overflow-hidden shadow-inner">
                                <div
                                  className="bg-gradient-to-r from-green-500 to-emerald-500 h-3 transition-all duration-500"
                                  style={{ width: `${successPercentage}%` }}
                                  title={`${week.successful} successful`}
                                />
                                <div
                                  className="bg-gradient-to-r from-red-500 to-rose-500 h-3 transition-all duration-500"
                                  style={{ width: `${failurePercentage}%` }}
                                  title={`${week.failed} failed`}
                                />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </ScrollArea>
                  </CardContent>
                </Card>
              </>
            )}
            </div>
          </ScrollArea>
        </div>
      )}
    </GenericModal>
  );
}




