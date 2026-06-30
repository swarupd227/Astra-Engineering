import { useState, useEffect } from "react";
import { GenericModal } from "@/components/ui/generic-modal";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Activity,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Clock,
  TrendingUp,
  TrendingDown,
  GitBranch,
  Loader2,
  BarChart3,
  Target,
  AlertCircle,
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

interface PipelineHealthModalProps {
  projectId: string;
  adoProject?: ADOProject;
  providerSegment?: "ado" | "gitlab" | "bitbucket" | "github";
  open: boolean;
  onClose: () => void;
}

interface PipelineHealthData {
  successRate: number;
  failureRate: number;
  totalRuns: number;
  succeededRuns: number;
  failedRuns: number;
  inProgressRuns: number;
  averageDuration: number;
  durationTrend: "increasing" | "decreasing" | "stable";
  failureFrequency: {
    last7Days: number;
    last30Days: number;
    last90Days: number;
  };
  weeklyTrends: Array<{
    week: string;
    succeeded: number;
    failed: number;
    total: number;
  }>;
  recentFailures: Array<{
    id: string;
    name: string;
    type?: string;
    status: string;
    result: string;
    finishTime: string;
    duration: number;
  }>;
  failurePatterns: Array<{
    jobName: string;
    taskName?: string;
    failureCount: number;
    lastFailure: string;
    pipelineType?: string;
  }>;
  environmentStability: Array<{
    environment: string;
    successRate: number;
    failureCount: number;
  }>;
  pipelineStability: Array<{
    pipelineName: string;
    successRate: number;
    failureCount: number;
    totalRuns: number;
  }>;
  stabilityRating: "excellent" | "good" | "fair" | "poor";
}

export function PipelineHealthModal({
  projectId,
  adoProject,
  providerSegment = "ado",
  open,
  onClose,
}: PipelineHealthModalProps) {
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

  const { data: providerConfig } = useQuery<{
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
        `/api/sdlc/projects/${projectId}/ado-config${
          queryString ? `?${queryString}` : ""
        }`
      );
      const configRes = await fetch(configUrl, { credentials: "include" });
      if (!configRes.ok) {
        return { hasConfig: false, organization: "", project: "" };
      }
      return configRes.json();
    },
    enabled: open && !!projectId,
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });

  const hasProviderConfig = providerConfig?.hasConfig || false;

  // Fetch pipeline health data
  const {
    data: pipelineHealthData,
    isLoading: loading,
    isFetching: refreshing,
    error: pipelineError,
    refetch: refetchPipelineHealth,
  } = useQuery<PipelineHealthData>({
    queryKey: [
      "/api/sdlc/projects",
      projectId,
      "maintenance/pipeline-health",
      adoProject?.organization,
      adoProject?.name,
    ],
    queryFn: async () => {
      if (!hasProviderConfig) {
        return {} as PipelineHealthData;
      }

      const healthUrl = getApiUrl(
        `/api/sdlc/projects/${projectId}/${providerSegment}/maintenance/pipeline-health${
          queryString ? `?${queryString}` : ""
        }`
      );
      const healthRes = await fetch(healthUrl, { credentials: "include" });

      if (!healthRes.ok) {
        throw new Error("Failed to fetch pipeline health data");
      }
      const data = await healthRes.json();
      if (isExternalCi) {
        return {
          successRate: data.successRate || 0,
          failureRate: Math.max(0, 100 - (data.successRate || 0)),
          totalRuns: data.totalRuns || 0,
          succeededRuns: data.succeededRuns || 0,
          failedRuns: data.failedRuns || 0,
          inProgressRuns: 0,
          averageDuration: 0,
          durationTrend: "stable",
          failureFrequency: { last7Days: 0, last30Days: 0, last90Days: 0 },
          weeklyTrends: [],
          recentFailures: [],
          failurePatterns: [],
          environmentStability: [],
          pipelineStability: [],
          stabilityRating: data.stabilityRating || "fair",
        } as PipelineHealthData;
      }
      return data;
    },
    enabled: open && !!projectId && hasProviderConfig,
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
    retry: 1,
  });

  useEffect(() => {
    if (pipelineError) {
      toast({
        title: "Error",
        description:
          pipelineError instanceof Error
            ? pipelineError.message
            : "Failed to fetch pipeline health data",
        variant: "destructive",
      });
    }
  }, [pipelineError, toast]);

  const handleRefresh = async () => {
    await refetchPipelineHealth();
  };

  const getStabilityColor = (rating: string) => {
    switch (rating) {
      case "excellent":
        return "text-green-600 bg-green-50 dark:bg-green-950/20 border-green-200 dark:border-green-800";
      case "good":
        return "text-blue-600 bg-blue-50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-800";
      case "fair":
        return "text-yellow-600 bg-yellow-50 dark:bg-yellow-950/20 border-yellow-200 dark:border-yellow-800";
      case "poor":
        return "text-red-600 bg-red-50 dark:bg-red-950/20 border-red-200 dark:border-red-800";
      default:
        return "text-gray-600 bg-gray-50 dark:bg-gray-950/20 border-gray-200 dark:border-gray-800";
    }
  };

  return (
    <GenericModal
      open={open}
      onOpenChange={onClose}
      title="Pipeline Health"
      description="Monitor build and release pipeline health, trends, and stability"
      icon={Activity}
      iconClassName="bg-gradient-to-br from-blue-500 to-cyan-600"
      fullScreen={true}
      contentClassName="space-y-4"
      headerActions={
        <Button
          variant="ghost"
          size="sm"
          onClick={handleRefresh}
          disabled={refreshing}
          className="h-8 w-8 p-0 flex items-center justify-center"
          aria-label="Refresh pipeline health"
        >
          <RefreshCw
            className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`}
          />
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
                    ? "Configure Bitbucket for Repository and Bitbucket Pipelines for CI/CD on this SDLC project (Edit project → tools), with a golden repo or repo slug so pipeline health can load."
                    : "Please configure the GitLab one-time connection in Settings > Third-Party Integrations to view pipeline health."
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
              <p className="text-muted-foreground">Loading pipeline health data...</p>
            </div>
          </CardContent>
        </Card>
      ) : pipelineHealthData ? (
        <div className="space-y-6">
          <Tabs defaultValue="overview" className="w-full">
            <TabsList className="grid w-full grid-cols-4">
              <TabsTrigger value="overview">
                <BarChart3 className="h-4 w-4 mr-2" />
                Overview
              </TabsTrigger>
              <TabsTrigger value="statistics">
                <Target className="h-4 w-4 mr-2" />
                Statistics
              </TabsTrigger>
              <TabsTrigger value="failures">
                <AlertCircle className="h-4 w-4 mr-2" />
                Failures
              </TabsTrigger>
              <TabsTrigger value="stability">
                <Activity className="h-4 w-4 mr-2" />
                Stability
              </TabsTrigger>
            </TabsList>

            {/* Overview Tab */}
            <TabsContent value="overview" className="space-y-6 mt-6">
              {/* Overall Health Summary */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <Activity className="h-5 w-5 text-blue-600" />
                    Overall Health Summary
                  </CardTitle>
                  <CardDescription>Key metrics for pipeline health monitoring</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-4 gap-4 text-sm">
                    <div>
                      <div className="text-muted-foreground mb-1">
                        Success Rate
                      </div>
                      <div className="font-semibold text-lg text-green-600">
                        {pipelineHealthData.successRate?.toFixed(1) || 0}%
                      </div>
                    </div>
                    <div>
                      <div className="text-muted-foreground mb-1">
                        Failure Rate
                      </div>
                      <div className="font-semibold text-lg text-red-600">
                        {pipelineHealthData.failureRate?.toFixed(1) || 0}%
                      </div>
                    </div>
                    <div>
                      <div className="text-muted-foreground mb-1">
                        Total Runs
                      </div>
                      <div className="font-semibold text-lg">
                        {pipelineHealthData.totalRuns || 0}
                      </div>
                    </div>
                    <div>
                      <div className="text-muted-foreground mb-1">
                        Stability Rating
                      </div>
                      <Badge
                        className={`${
                          pipelineHealthData.stabilityRating
                            ? getStabilityColor(
                                pipelineHealthData.stabilityRating
                              )
                            : ""
                        } capitalize`}
                      >
                        {pipelineHealthData.stabilityRating || "Unknown"}
                      </Badge>
                    </div>
                  </div>
                </CardContent>
              </Card>

            </TabsContent>

            {/* Statistics Tab */}
            <TabsContent value="statistics" className="space-y-6 mt-6">
              {/* Run Statistics */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Run Statistics</CardTitle>
                  <CardDescription>Pipeline run status breakdown</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-3 gap-4 text-sm">
                    <div className="text-center p-4 bg-green-50 dark:bg-green-950/20 rounded-lg border border-green-200 dark:border-green-800">
                      <CheckCircle2 className="h-6 w-6 text-green-600 mx-auto mb-2" />
                      <div className="text-2xl font-bold text-green-600">
                        {pipelineHealthData.succeededRuns || 0}
                      </div>
                      <div className="text-muted-foreground text-xs mt-1">
                        Succeeded
                      </div>
                    </div>
                    <div className="text-center p-4 bg-red-50 dark:bg-red-950/20 rounded-lg border border-red-200 dark:border-red-800">
                      <XCircle className="h-6 w-6 text-red-600 mx-auto mb-2" />
                      <div className="text-2xl font-bold text-red-600">
                        {pipelineHealthData.failedRuns || 0}
                      </div>
                      <div className="text-muted-foreground text-xs mt-1">
                        Failed
                      </div>
                    </div>
                    <div className="text-center p-4 bg-blue-50 dark:bg-blue-950/20 rounded-lg border border-blue-200 dark:border-blue-800">
                      <Clock className="h-6 w-6 text-blue-600 mx-auto mb-2" />
                      <div className="text-2xl font-bold text-blue-600">
                        {pipelineHealthData.inProgressRuns || 0}
                      </div>
                      <div className="text-muted-foreground text-xs mt-1">
                        In Progress
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Duration Trends */}
              {pipelineHealthData.averageDuration && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base flex items-center gap-2">
                      Duration Trends
                      {pipelineHealthData.durationTrend === "increasing" && (
                        <TrendingUp className="h-4 w-4 text-red-600" />
                      )}
                      {pipelineHealthData.durationTrend === "decreasing" && (
                        <TrendingDown className="h-4 w-4 text-green-600" />
                      )}
                    </CardTitle>
                    <CardDescription>Average pipeline execution time and trends</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-muted-foreground">
                          Average Duration
                        </span>
                        <span className="font-semibold">
                          {Math.round(pipelineHealthData.averageDuration / 60)}{" "}
                          minutes
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-muted-foreground">
                          Trend
                        </span>
                        <Badge
                          variant={
                            pipelineHealthData.durationTrend === "decreasing"
                              ? "default"
                              : "destructive"
                          }
                          className="capitalize"
                        >
                          {pipelineHealthData.durationTrend || "stable"}
                        </Badge>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )}
            </TabsContent>

            {/* Failures Tab */}
            <TabsContent value="failures" className="space-y-6 mt-6">

              {/* Recent Failures */}
              {pipelineHealthData.recentFailures &&
                pipelineHealthData.recentFailures.length > 0 ? (
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">Recent Failures</CardTitle>
                      <CardDescription>Latest pipeline failures and their details</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <ScrollArea className="h-[400px]">
                        <div className="space-y-2">
                          {pipelineHealthData.recentFailures
                            .slice(0, 10)
                            .map((failure, idx) => (
                              <div
                                key={idx}
                                className="flex items-center justify-between p-3 bg-red-50 dark:bg-red-950/20 rounded-lg border border-red-200 dark:border-red-800"
                              >
                                <div className="flex-1">
                                  <div className="font-semibold text-sm">
                                    {failure.name}
                                  </div>
                                  <div className="text-xs text-muted-foreground mt-1">
                                    {failure.type && (
                                      <Badge variant="outline" className="text-xs mr-2">
                                        {failure.type}
                                      </Badge>
                                    )}
                                    {new Date(failure.finishTime).toLocaleString()}
                                    {failure.duration > 0 && (
                                      <span className="ml-2">
                                        • {Math.round(failure.duration / 60000)} min
                                      </span>
                                    )}
                                  </div>
                                </div>
                                <Badge variant="destructive" className="text-xs">
                                  Failed
                                </Badge>
                              </div>
                            ))}
                        </div>
                      </ScrollArea>
                    </CardContent>
                  </Card>
                ) : (
                  <Card>
                    <CardContent className="pt-6">
                      <div className="text-center py-8 text-muted-foreground">
                        <CheckCircle2 className="h-8 w-8 mx-auto mb-2 text-green-600" />
                        <p>No recent failures recorded</p>
                      </div>
                    </CardContent>
                  </Card>
                )}

              {/* Failure Patterns - Recurrent Failure Areas */}
              {pipelineHealthData.failurePatterns &&
                pipelineHealthData.failurePatterns.length > 0 ? (
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">
                        Recurrent Failure Areas (Jobs & Tasks)
                      </CardTitle>
                      <CardDescription>Jobs and tasks with repeated failures</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <ScrollArea className="h-[400px]">
                        <div className="space-y-2">
                          {pipelineHealthData.failurePatterns.map((pattern, idx) => (
                            <div
                              key={idx}
                              className="flex items-center justify-between p-3 bg-yellow-50 dark:bg-yellow-950/20 rounded-lg border border-yellow-200 dark:border-yellow-800"
                            >
                              <div className="flex-1">
                                <div className="font-semibold text-sm">
                                  {pattern.jobName}
                                  {pattern.taskName && (
                                    <span className="text-muted-foreground ml-2">
                                      → {pattern.taskName}
                                    </span>
                                  )}
                                </div>
                                <div className="text-xs text-muted-foreground mt-1">
                                  {pattern.pipelineType && (
                                    <Badge variant="outline" className="text-xs mr-2">
                                      {pattern.pipelineType}
                                    </Badge>
                                  )}
                                  Last failure:{" "}
                                  {new Date(pattern.lastFailure).toLocaleDateString()}
                                </div>
                              </div>
                              <Badge variant="outline" className="text-xs">
                                {pattern.failureCount} {pattern.failureCount === 1 ? 'failure' : 'failures'}
                              </Badge>
                            </div>
                          ))}
                        </div>
                      </ScrollArea>
                    </CardContent>
                  </Card>
                ) : (
                  <Card>
                    <CardContent className="pt-6">
                      <div className="text-center py-8 text-muted-foreground">
                        <CheckCircle2 className="h-8 w-8 mx-auto mb-2 text-green-600" />
                        <p>No recurrent failure patterns detected</p>
                      </div>
                    </CardContent>
                  </Card>
                )}
            </TabsContent>

            {/* Stability Tab */}
            <TabsContent value="stability" className="space-y-6 mt-6">

              {/* Pipeline Stability - Stability Ratings Across CI/CD Workflows */}
              {pipelineHealthData.pipelineStability &&
                pipelineHealthData.pipelineStability.length > 0 ? (
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">
                        Pipeline Stability (CI/CD Workflows)
                      </CardTitle>
                      <CardDescription>Success rates across different pipelines</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <ScrollArea className="h-[400px]">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          {pipelineHealthData.pipelineStability
                            .sort((a, b) => b.totalRuns - a.totalRuns)
                            .map((pipeline, idx) => {
                              const successRate = Math.round(pipeline.successRate);
                              const failureRate = 100 - successRate;
                              const circumference = 2 * Math.PI * 40; // radius = 40
                              const successOffset = circumference - (successRate / 100) * circumference;
                              
                              return (
                                <Card
                                  key={idx}
                                  className={`${
                                    pipeline.successRate >= 80
                                      ? "border-green-200 bg-green-50/50 dark:bg-green-950/20"
                                      : pipeline.successRate >= 50
                                      ? "border-yellow-200 bg-yellow-50/50 dark:bg-yellow-950/20"
                                      : "border-red-200 bg-red-50/50 dark:bg-red-950/20"
                                  }`}
                                >
                                  <CardContent className="p-4">
                                    <div className="flex items-start justify-between mb-4">
                                      <div className="flex-1">
                                        <h4 className="font-semibold text-base mb-1">{pipeline.pipelineName}</h4>
                                        <div className="text-xs text-muted-foreground">
                                          {pipeline.totalRuns} total runs
                                        </div>
                                      </div>
                                      <Badge
                                        className={
                                          pipeline.successRate >= 80
                                            ? "bg-green-600 text-white"
                                            : pipeline.successRate >= 50
                                            ? "bg-yellow-600 text-white"
                                            : "bg-red-600 text-white"
                                        }
                                      >
                                        {successRate}%
                                      </Badge>
                                    </div>

                                    {/* Circular Progress */}
                                    <div className="flex items-center justify-center mb-4">
                                      <div className="relative w-32 h-32">
                                        <svg className="w-32 h-32 transform -rotate-90">
                                          <circle
                                            cx="64"
                                            cy="64"
                                            r="56"
                                            stroke="currentColor"
                                            strokeWidth="8"
                                            fill="none"
                                            className="text-gray-200 dark:text-gray-700"
                                          />
                                          <circle
                                            cx="64"
                                            cy="64"
                                            r="56"
                                            stroke="currentColor"
                                            strokeWidth="8"
                                            fill="none"
                                            strokeDasharray={circumference}
                                            strokeDashoffset={successOffset}
                                            className={
                                              pipeline.successRate >= 80
                                                ? "text-green-600"
                                                : pipeline.successRate >= 50
                                                ? "text-yellow-600"
                                                : "text-red-600"
                                            }
                                            style={{ transition: "all 0.5s ease" }}
                                            strokeLinecap="round"
                                          />
                                        </svg>
                                        <div className="absolute inset-0 flex items-center justify-center">
                                          <div className="text-center">
                                            <div className={`text-2xl font-bold ${
                                              pipeline.successRate >= 80
                                                ? "text-green-600"
                                                : pipeline.successRate >= 50
                                                ? "text-yellow-600"
                                                : "text-red-600"
                                            }`}>
                                              {successRate}%
                                            </div>
                                            <div className="text-xs text-muted-foreground">Success</div>
                                          </div>
                                        </div>
                                      </div>
                                    </div>

                                    {/* Stats */}
                                    <div className="space-y-2 pt-3 border-t">
                                      <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-2">
                                          <CheckCircle2 className="h-4 w-4 text-green-600" />
                                          <span className="text-sm text-muted-foreground">Successful</span>
                                        </div>
                                        <span className="text-sm font-semibold text-green-600">
                                          {pipeline.totalRuns - pipeline.failureCount}
                                        </span>
                                      </div>
                                      <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-2">
                                          <XCircle className="h-4 w-4 text-red-600" />
                                          <span className="text-sm text-muted-foreground">Failed</span>
                                        </div>
                                        <span className="text-sm font-semibold text-red-600">
                                          {pipeline.failureCount}
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
                ) : (
                  <Card>
                    <CardContent className="pt-6">
                      <div className="text-center py-8 text-muted-foreground">
                        <Activity className="h-8 w-8 mx-auto mb-2 opacity-50" />
                        <p>No pipeline stability data available</p>
                      </div>
                    </CardContent>
                  </Card>
                )}

              {/* Environment Stability */}
              {pipelineHealthData.environmentStability &&
                pipelineHealthData.environmentStability.length > 0 ? (
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">
                        Environment Stability
                      </CardTitle>
                      <CardDescription>Success rates across different environments</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <ScrollArea className="h-[400px]">
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                          {pipelineHealthData.environmentStability.map(
                            (env, idx) => {
                              const successRate = Math.round(env.successRate);
                              const circumference = 2 * Math.PI * 40; // radius = 40
                              const successOffset = circumference - (successRate / 100) * circumference;
                              
                              return (
                                <Card
                                  key={idx}
                                  className={`${
                                    env.successRate >= 80
                                      ? "border-green-200 bg-green-50/50 dark:bg-green-950/20"
                                      : env.successRate >= 50
                                      ? "border-yellow-200 bg-yellow-50/50 dark:bg-yellow-950/20"
                                      : "border-red-200 bg-red-50/50 dark:bg-red-950/20"
                                  }`}
                                >
                                  <CardContent className="p-4">
                                    <div className="flex items-start justify-between mb-4">
                                      <div className="flex-1">
                                        <h4 className="font-semibold text-base mb-1">{env.environment}</h4>
                                      </div>
                                      <Badge
                                        className={
                                          env.successRate >= 80
                                            ? "bg-green-600 text-white"
                                            : env.successRate >= 50
                                            ? "bg-yellow-600 text-white"
                                            : "bg-red-600 text-white"
                                        }
                                      >
                                        {successRate}%
                                      </Badge>
                                    </div>

                                    {/* Circular Progress */}
                                    <div className="flex items-center justify-center mb-4">
                                      <div className="relative w-32 h-32">
                                        <svg className="w-32 h-32 transform -rotate-90">
                                          <circle
                                            cx="64"
                                            cy="64"
                                            r="56"
                                            stroke="currentColor"
                                            strokeWidth="8"
                                            fill="none"
                                            className="text-gray-200 dark:text-gray-700"
                                          />
                                          <circle
                                            cx="64"
                                            cy="64"
                                            r="56"
                                            stroke="currentColor"
                                            strokeWidth="8"
                                            fill="none"
                                            strokeDasharray={circumference}
                                            strokeDashoffset={successOffset}
                                            className={
                                              env.successRate >= 80
                                                ? "text-green-600"
                                                : env.successRate >= 50
                                                ? "text-yellow-600"
                                                : "text-red-600"
                                            }
                                            style={{ transition: "all 0.5s ease" }}
                                            strokeLinecap="round"
                                          />
                                        </svg>
                                        <div className="absolute inset-0 flex items-center justify-center">
                                          <div className="text-center">
                                            <div className={`text-2xl font-bold ${
                                              env.successRate >= 80
                                                ? "text-green-600"
                                                : env.successRate >= 50
                                                ? "text-yellow-600"
                                                : "text-red-600"
                                            }`}>
                                              {successRate}%
                                            </div>
                                            <div className="text-xs text-muted-foreground">Success</div>
                                          </div>
                                        </div>
                                      </div>
                                    </div>

                                    {/* Stats */}
                                    <div className="space-y-2 pt-3 border-t">
                                      <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-2">
                                          <CheckCircle2 className="h-4 w-4 text-green-600" />
                                          <span className="text-sm text-muted-foreground">Success Rate</span>
                                        </div>
                                        <span className="text-sm font-semibold text-green-600">
                                          {successRate}%
                                        </span>
                                      </div>
                                      <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-2">
                                          <XCircle className="h-4 w-4 text-red-600" />
                                          <span className="text-sm text-muted-foreground">Failures</span>
                                        </div>
                                        <span className="text-sm font-semibold text-red-600">
                                          {env.failureCount} {env.failureCount === 1 ? 'failure' : 'failures'}
                                        </span>
                                      </div>
                                    </div>
                                  </CardContent>
                                </Card>
                              );
                            }
                          )}
                        </div>
                      </ScrollArea>
                    </CardContent>
                  </Card>
                ) : (
                  <Card>
                    <CardContent className="pt-6">
                      <div className="text-center py-8 text-muted-foreground">
                        <Activity className="h-8 w-8 mx-auto mb-2 opacity-50" />
                        <p>No environment stability data available</p>
                      </div>
                    </CardContent>
                  </Card>
                )}
            </TabsContent>
          </Tabs>
        </div>

      ) : (
        <Card>
          <CardContent className="pt-6">
            <div className="text-center space-y-4">
              <Activity className="h-12 w-12 text-muted-foreground mx-auto" />
              <h3 className="text-lg font-semibold">
                No Pipeline Health Data Available
              </h3>
              <p className="text-muted-foreground">
                Pipeline health data will appear here once pipelines are
                configured and running.
              </p>
            </div>
          </CardContent>
        </Card>
      )}
    </GenericModal>
  );
}




