import { useMemo, useState, useEffect } from "react";
import { GenericModal } from "@/components/ui/generic-modal";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  BarChart3,
  RefreshCw,
  CheckCircle2,
  XCircle,
  Clock,
  AlertTriangle,
  TrendingUp,
  TrendingDown,
  Activity,
  GitBranch,
  Loader2,
  Target,
  Timer,
  Calendar,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { getApiUrl } from "@/lib/api-config";
import { useQuery } from "@tanstack/react-query";
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Cell } from "recharts";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";

interface ADOProject {
  id: string;
  name: string;
  organization: string;
  organizationUrl: string;
}

interface BuildStatusMetricsModalProps {
  projectId: string;
  adoProject?: ADOProject;
  providerSegment?: "ado" | "gitlab" | "bitbucket" | "github";
  open: boolean;
  onClose: () => void;
}

interface PipelineRun {
  id: number;
  buildNumber: string;
  status: string;
  result: string;
  queueTime: string;
  startTime: string;
  finishTime: string;
  sourceBranch: string;
  definition?: {
    id: number;
    name: string;
    path?: string;
  };
  stages?: Array<{
    id: string;
    name: string;
    status: string;
    result?: string;
    startTime?: string;
    finishTime?: string;
    duration?: number;
  }>;
}

interface BuildStatusMetrics {
  totalBuilds: number;
  successfulBuilds: number;
  failedBuilds: number;
  partiallySucceededBuilds: number;
  averageBuildDuration: number;
  stabilityRating: number; // Success rate percentage
  stageCompletionTimes: Array<{
    stageName: string;
    averageDuration: number;
    minDuration: number;
    maxDuration: number;
    totalRuns: number;
  }>;
  failureFrequencyPerPipeline: Array<{
    pipelineName: string;
    totalRuns: number;
    successfulRuns: number;
    failedRuns: number;
    failureRate: number;
    lastFailure?: string;
  }>;
  impactedBranches: Array<{
    branchName: string;
    totalBuilds: number;
    successfulBuilds: number;
    failedBuilds: number;
    successRate: number;
  }>;
  buildTrends: Array<{
    date: string;
    successful: number;
    failed: number;
    total: number;
  }>;
}

export function BuildStatusMetricsModal({ projectId, adoProject, providerSegment = "ado", open, onClose }: BuildStatusMetricsModalProps) {
  const { toast } = useToast();
  const [timeRangeFilter, setTimeRangeFilter] = useState<string>("30"); // days
  const [selectedSprintPath, setSelectedSprintPath] = useState<string | null>(null);
  const isGitLab = providerSegment === "gitlab";
  const isBitbucket = providerSegment === "bitbucket";
  const isGithub = providerSegment === "github";
  const isExternalCi = isGitLab || isBitbucket || isGithub;

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
    enabled: open && !!projectId,
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
    retry: 1,
  });

  const hasProviderConfig = providerConfig?.hasConfig || false;

  // Fetch all sprints
  const { data: allSprints = [] } = useQuery<Array<{
    id: string;
    name: string;
    path: string;
    startDate?: string;
    endDate?: string;
    timeFrame?: string;
  }>>({
    queryKey: [
      "/api/sdlc/projects",
      projectId,
      "ado/sprints",
      adoProject?.organization,
      adoProject?.name,
    ],
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
        console.warn(`[BuildStatusMetricsModal] Failed to fetch sprints: ${sprintsRes.status}`, errorText);
        return [];
      }

      const sprints = await sprintsRes.json();
      return sprints;
    },
    enabled: open && !!projectId && hasProviderConfig && !isExternalCi,
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
    retry: 1,
  });

  // Reset sprint selection when modal closes
  useEffect(() => {
    if (!open) {
      setSelectedSprintPath(null);
    }
  }, [open]);

  // Fetch pipeline runs (builds)
  const { data: buildsData, isLoading: loadingBuilds, isFetching: fetchingBuilds, refetch: refetchBuilds } = useQuery<{ value: PipelineRun[] }>({
    queryKey: [`/api/sdlc/projects/${projectId}/${providerSegment}/builds`, queryString, selectedSprintPath],
    queryFn: async () => {
      if (!hasProviderConfig) return { value: [] };
      const buildQuery = new URLSearchParams(queryString);
      if (selectedSprintPath && !isExternalCi) {
        // URL encode the sprint path to handle special characters like backslashes
        // URLSearchParams.set() already handles encoding, so we don't need encodeURIComponent
        buildQuery.set('sprintPath', selectedSprintPath);
      }
      const url = getApiUrl(`/api/sdlc/projects/${projectId}/${providerSegment}/builds${buildQuery.toString() ? `?${buildQuery.toString()}` : ''}`);
      console.log(`[BuildStatusMetricsModal] Fetching builds with sprint: ${selectedSprintPath}, URL: ${url}`);
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) {
        throw new Error(`Failed to fetch builds: ${res.status}`);
      }
      return res.json();
    },
    enabled: open && !!projectId && hasProviderConfig,
    staleTime: 2 * 60 * 1000,
    retry: 1,
  });

  // Calculate metrics from builds data
  const metrics = useMemo((): BuildStatusMetrics | null => {
    if (!buildsData?.value || buildsData.value.length === 0) return null;

    const builds = buildsData.value.map((build) => ({
      ...build,
      status: build.status === "running" ? "inProgress" : build.status,
      result: build.result === "success" ? "succeeded" : build.result,
    }));
    const timeRangeDays = parseInt(timeRangeFilter);
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - timeRangeDays);
    
    // Filter builds by time range
    const filteredBuilds = builds.filter(build => {
      const buildDate = new Date(build.queueTime || build.startTime);
      return buildDate >= cutoffDate;
    });

    if (filteredBuilds.length === 0) return null;

    // Basic counts
    const successfulBuilds = filteredBuilds.filter(b => b.result === 'succeeded').length;
    const failedBuilds = filteredBuilds.filter(b => b.result === 'failed').length;
    const partiallySucceededBuilds = filteredBuilds.filter(b => b.result === 'partiallySucceeded').length;
    const totalBuilds = filteredBuilds.length;

    // Average build duration
    const buildDurations = filteredBuilds
      .filter(b => b.startTime && b.finishTime)
      .map(b => {
        const start = new Date(b.startTime).getTime();
        const finish = new Date(b.finishTime).getTime();
        return finish - start;
      });
    
    const averageBuildDuration = buildDurations.length > 0
      ? buildDurations.reduce((sum, d) => sum + d, 0) / buildDurations.length
      : 0;

    // Stability rating (success rate percentage)
    const stabilityRating = totalBuilds > 0
      ? (successfulBuilds / totalBuilds) * 100
      : 0;

    // Stage completion times
    const stageDurations = new Map<string, number[]>();
    filteredBuilds.forEach(build => {
      if (build.stages && Array.isArray(build.stages)) {
        build.stages.forEach(stage => {
          let duration = 0;
          if (stage.duration) {
            duration = stage.duration;
          } else if (stage.startTime && stage.finishTime) {
            duration = new Date(stage.finishTime).getTime() - new Date(stage.startTime).getTime();
          }
          
          if (duration > 0) {
            const durations = stageDurations.get(stage.name) || [];
            durations.push(duration);
            stageDurations.set(stage.name, durations);
          }
        });
      }
    });

    const stageCompletionTimes = Array.from(stageDurations.entries()).map(([stageName, durations]) => ({
      stageName,
      averageDuration: durations.reduce((sum, d) => sum + d, 0) / durations.length,
      minDuration: Math.min(...durations),
      maxDuration: Math.max(...durations),
      totalRuns: durations.length,
    })).sort((a, b) => b.averageDuration - a.averageDuration);

    // Failure frequency per pipeline
    const pipelineStats = new Map<string, { total: number; successful: number; failed: number; lastFailure?: string }>();
    filteredBuilds.forEach(build => {
      const pipelineName = build.definition?.name || 'Unknown Pipeline';
      const stats = pipelineStats.get(pipelineName) || { total: 0, successful: 0, failed: 0 };
      stats.total++;
      if (build.result === 'succeeded') stats.successful++;
      if (build.result === 'failed') {
        stats.failed++;
        if (!stats.lastFailure || (build.finishTime && build.finishTime > stats.lastFailure)) {
          stats.lastFailure = build.finishTime;
        }
      }
      pipelineStats.set(pipelineName, stats);
    });

    const failureFrequencyPerPipeline = Array.from(pipelineStats.entries()).map(([pipelineName, stats]) => ({
      pipelineName,
      totalRuns: stats.total,
      successfulRuns: stats.successful,
      failedRuns: stats.failed,
      failureRate: stats.total > 0 ? (stats.failed / stats.total) * 100 : 0,
      lastFailure: stats.lastFailure,
    })).sort((a, b) => b.failureRate - a.failureRate);

    // Impacted branches
    const branchStats = new Map<string, { total: number; successful: number; failed: number }>();
    filteredBuilds.forEach(build => {
      const branchName = build.sourceBranch?.replace('refs/heads/', '') || 'Unknown';
      const stats = branchStats.get(branchName) || { total: 0, successful: 0, failed: 0 };
      stats.total++;
      if (build.result === 'succeeded') stats.successful++;
      if (build.result === 'failed') stats.failed++;
      branchStats.set(branchName, stats);
    });

    const impactedBranches = Array.from(branchStats.entries()).map(([branchName, stats]) => ({
      branchName,
      totalBuilds: stats.total,
      successfulBuilds: stats.successful,
      failedBuilds: stats.failed,
      successRate: stats.total > 0 ? (stats.successful / stats.total) * 100 : 0,
    })).sort((a, b) => b.failedBuilds - a.failedBuilds);

    // Build trends (daily)
    const dailyStats = new Map<string, { successful: number; failed: number; total: number }>();
    filteredBuilds.forEach(build => {
      const buildDate = new Date(build.queueTime || build.startTime);
      const dateKey = buildDate.toISOString().split('T')[0];
      const stats = dailyStats.get(dateKey) || { successful: 0, failed: 0, total: 0 };
      stats.total++;
      if (build.result === 'succeeded') stats.successful++;
      if (build.result === 'failed') stats.failed++;
      dailyStats.set(dateKey, stats);
    });

    const buildTrends = Array.from(dailyStats.entries())
      .map(([date, stats]) => ({
        date: new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        successful: stats.successful,
        failed: stats.failed,
        total: stats.total,
      }))
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    return {
      totalBuilds,
      successfulBuilds,
      failedBuilds,
      partiallySucceededBuilds,
      averageBuildDuration,
      stabilityRating,
      stageCompletionTimes,
      failureFrequencyPerPipeline,
      impactedBranches,
      buildTrends,
    };
  }, [buildsData?.value, timeRangeFilter]);

  const handleRefresh = async () => {
    await refetchBuilds();
    toast({
      title: "Refreshed",
      description: "Build status metrics have been refreshed.",
    });
  };

  const formatDuration = (milliseconds: number): string => {
    const seconds = Math.round(milliseconds / 1000);
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    if (minutes < 60) return `${minutes}m ${remainingSeconds}s`;
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    return `${hours}h ${remainingMinutes}m`;
  };

  const formatDate = (dateString: string) => {
    if (!dateString) return 'N/A';
    const date = new Date(dateString);
    return date.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const getStabilityColor = (rating: number) => {
    if (rating >= 90) return 'text-green-600 bg-green-50 dark:bg-green-950/20 border-green-200';
    if (rating >= 70) return 'text-blue-600 bg-blue-50 dark:bg-blue-950/20 border-blue-200';
    if (rating >= 50) return 'text-yellow-600 bg-yellow-50 dark:bg-yellow-950/20 border-yellow-200';
    return 'text-red-600 bg-red-50 dark:bg-red-950/20 border-red-200';
  };

  const getStabilityLabel = (rating: number) => {
    if (rating >= 90) return 'Excellent';
    if (rating >= 70) return 'Good';
    if (rating >= 50) return 'Fair';
    return 'Poor';
  };

  return (
    <GenericModal
      open={open}
      onOpenChange={onClose}
      title="Build Status Metrics"
      description="Summarized view of pipeline performance with success rates, durations, and failure analysis"
      icon={BarChart3}
      iconClassName="bg-gradient-to-br from-blue-500 to-cyan-600"
      fullScreen={true}
      contentClassName="space-y-6"
      headerActions={
        <div className="flex items-center gap-2">
          <Select
            value={selectedSprintPath || undefined}
            onValueChange={(value) => {
              if (value) {
                setSelectedSprintPath(value);
              } else {
                setSelectedSprintPath(null);
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
            disabled={fetchingBuilds}
            className="h-8 w-8 p-0 flex items-center justify-center"
            aria-label="Refresh metrics"
          >
            <RefreshCw className={`h-4 w-4 ${fetchingBuilds ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      }
    >
      {/* Time Range Filter */}
      <div className="flex justify-end items-center gap-3 -mt-2 mb-4">
        <Select value={timeRangeFilter} onValueChange={setTimeRangeFilter}>
          <SelectTrigger className="w-[150px]">
            <SelectValue placeholder="Time Range" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="7">Last 7 days</SelectItem>
            <SelectItem value="30">Last 30 days</SelectItem>
            <SelectItem value="90">Last 90 days</SelectItem>
            <SelectItem value="365">Last year</SelectItem>
          </SelectContent>
        </Select>
      </div>

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
                    ? "Configure Bitbucket for Repository and Bitbucket Pipelines for CI/CD on this SDLC project (Edit project → tools), with a golden repo or repo slug so build metrics can load."
                    : "Please configure the GitLab one-time connection in Settings > Third-Party Integrations to view build status metrics."
                  : "No data is available for this metric at the moment."}
              </p>
            </div>
          </CardContent>
        </Card>
      ) : loadingBuilds ? (
        <Card>
          <CardContent className="pt-6">
            <div className="text-center py-8">
              <Loader2 className="h-8 w-8 animate-spin mx-auto mb-2 text-muted-foreground" />
              <p className="text-muted-foreground">Loading build status metrics...</p>
            </div>
          </CardContent>
        </Card>
      ) : !metrics ? (
        <Card>
          <CardContent className="pt-6">
            <div className="text-center space-y-4 py-8">
              <BarChart3 className="h-12 w-12 text-muted-foreground mx-auto" />
              <p className="text-muted-foreground">
                No build data available for the selected time range.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <ScrollArea className="flex-1 h-[calc(95vh-120px)]">
          <div className="space-y-6 pb-6 pr-4">
            {/* Summary Cards */}
            <div className="grid grid-cols-4 gap-4">
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-green-600" />
                    Successful Builds
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-4xl font-bold text-green-600">{metrics.successfulBuilds}</div>
                  <p className="text-xs text-muted-foreground mt-1">of {metrics.totalBuilds} total</p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                    <XCircle className="h-4 w-4 text-red-600" />
                    Failed Builds
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-4xl font-bold text-red-600">{metrics.failedBuilds}</div>
                  <p className="text-xs text-muted-foreground mt-1">of {metrics.totalBuilds} total</p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                    <Timer className="h-4 w-4 text-blue-600" />
                    Avg Build Duration
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-4xl font-bold text-blue-600">
                    {formatDuration(metrics.averageBuildDuration)}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">Average time</p>
                </CardContent>
              </Card>
              <Card className={getStabilityColor(metrics.stabilityRating)}>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium flex items-center gap-2">
                    <Target className="h-4 w-4" />
                    Stability Rating
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-4xl font-bold">
                    {Math.round(metrics.stabilityRating)}%
                  </div>
                  <p className="text-xs mt-1">
                    {getStabilityLabel(metrics.stabilityRating)} - Success Rate
                  </p>
                </CardContent>
              </Card>
            </div>

            {/* Build Trends Chart */}
            {metrics.buildTrends.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <TrendingUp className="h-5 w-5 text-blue-600" />
                    Build Trends Over Time
                  </CardTitle>
                  <CardDescription>
                    Daily build success and failure trends
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <ChartContainer
                    config={{
                      successful: { label: "Successful", color: "hsl(var(--chart-1))" },
                      failed: { label: "Failed", color: "hsl(var(--chart-2))" },
                    }}
                    className="h-[300px]"
                  >
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={metrics.buildTrends}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="date" />
                        <YAxis />
                        <ChartTooltip content={<ChartTooltipContent />} />
                        <Legend />
                        <Line type="monotone" dataKey="successful" stroke="#22c55e" name="Successful" />
                        <Line type="monotone" dataKey="failed" stroke="#ef4444" name="Failed" />
                      </LineChart>
                    </ResponsiveContainer>
                  </ChartContainer>
                </CardContent>
              </Card>
            )}

            {/* Stage Completion Times */}
            {metrics.stageCompletionTimes.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Clock className="h-5 w-5 text-purple-600" />
                    Stage Completion Times
                  </CardTitle>
                  <CardDescription>
                    Average, minimum, and maximum duration for each stage
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    {metrics.stageCompletionTimes.map((stage, idx) => (
                      <div key={idx} className="p-4 border rounded-lg">
                        <div className="flex items-center justify-between mb-3">
                          <div>
                            <div className="font-semibold">{stage.stageName}</div>
                            <div className="text-sm text-muted-foreground mt-1">
                              {stage.totalRuns} run{stage.totalRuns !== 1 ? 's' : ''} analyzed
                            </div>
                          </div>
                          <Badge variant="outline">
                            Avg: {formatDuration(stage.averageDuration)}
                          </Badge>
                        </div>
                        <div className="grid grid-cols-3 gap-4 text-sm">
                          <div>
                            <div className="text-muted-foreground">Average</div>
                            <div className="font-semibold">{formatDuration(stage.averageDuration)}</div>
                          </div>
                          <div>
                            <div className="text-muted-foreground">Minimum</div>
                            <div className="font-semibold text-green-600">{formatDuration(stage.minDuration)}</div>
                          </div>
                          <div>
                            <div className="text-muted-foreground">Maximum</div>
                            <div className="font-semibold text-red-600">{formatDuration(stage.maxDuration)}</div>
                          </div>
                        </div>
                        <div className="mt-3 w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                          <div
                            className="bg-purple-500 h-2 rounded-full transition-all"
                            style={{ width: `${Math.min((stage.averageDuration / stage.maxDuration) * 100, 100)}%` }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Failure Frequency Per Pipeline */}
            {metrics.failureFrequencyPerPipeline.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <TrendingDown className="h-5 w-5 text-red-600" />
                    Failure Frequency Per Pipeline
                  </CardTitle>
                  <CardDescription>
                    Pipeline failure rates and frequency analysis
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {metrics.failureFrequencyPerPipeline.map((pipeline, idx) => (
                      <Card key={idx} className={`border ${pipeline.failureRate > 50 ? 'border-red-200 bg-red-50 dark:bg-red-950/20' : pipeline.failureRate > 20 ? 'border-yellow-200 bg-yellow-50 dark:bg-yellow-950/20' : ''}`}>
                        <CardContent className="pt-4">
                          <div className="flex items-center justify-between mb-3">
                            <div>
                              <div className="font-semibold">{pipeline.pipelineName}</div>
                              <div className="text-sm text-muted-foreground mt-1">
                                {pipeline.totalRuns} total run{pipeline.totalRuns !== 1 ? 's' : ''}
                              </div>
                            </div>
                            <Badge variant={pipeline.failureRate > 50 ? 'destructive' : pipeline.failureRate > 20 ? 'secondary' : 'outline'}>
                              {Math.round(pipeline.failureRate)}% failure rate
                            </Badge>
                          </div>
                          <div className="grid grid-cols-3 gap-4 text-sm mb-3">
                            <div>
                              <div className="text-muted-foreground">Successful</div>
                              <div className="font-semibold text-green-600">{pipeline.successfulRuns}</div>
                            </div>
                            <div>
                              <div className="text-muted-foreground">Failed</div>
                              <div className="font-semibold text-red-600">{pipeline.failedRuns}</div>
                            </div>
                            <div>
                              <div className="text-muted-foreground">Success Rate</div>
                              <div className="font-semibold">
                                {Math.round((pipeline.successfulRuns / pipeline.totalRuns) * 100)}%
                              </div>
                            </div>
                          </div>
                          {pipeline.lastFailure && (
                            <div className="text-xs text-muted-foreground pt-2 border-t">
                              Last failure: {formatDate(pipeline.lastFailure)}
                            </div>
                          )}
                          <div className="mt-3 w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                            <div
                              className="bg-red-500 h-2 rounded-full transition-all"
                              style={{ width: `${pipeline.failureRate}%` }}
                            />
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Impacted Branches */}
            {metrics.impactedBranches.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <GitBranch className="h-5 w-5 text-cyan-600" />
                    Impacted Branches
                  </CardTitle>
                  <CardDescription>
                    Build performance by branch with success rates
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {metrics.impactedBranches.map((branch, idx) => (
                      <Card key={idx} className={`border ${branch.successRate < 50 ? 'border-red-200 bg-red-50 dark:bg-red-950/20' : branch.successRate < 70 ? 'border-yellow-200 bg-yellow-50 dark:bg-yellow-950/20' : ''}`}>
                        <CardContent className="pt-4">
                          <div className="flex items-center justify-between mb-3">
                            <div className="flex items-center gap-2">
                              <GitBranch className="h-4 w-4 text-cyan-600" />
                              <div>
                                <div className="font-semibold">{branch.branchName}</div>
                                <div className="text-sm text-muted-foreground mt-1">
                                  {branch.totalBuilds} build{branch.totalBuilds !== 1 ? 's' : ''}
                                </div>
                              </div>
                            </div>
                            <Badge variant={branch.successRate >= 90 ? 'default' : branch.successRate >= 70 ? 'secondary' : 'destructive'}>
                              {Math.round(branch.successRate)}% success
                            </Badge>
                          </div>
                          <div className="grid grid-cols-3 gap-4 text-sm">
                            <div>
                              <div className="text-muted-foreground">Successful</div>
                              <div className="font-semibold text-green-600">{branch.successfulBuilds}</div>
                            </div>
                            <div>
                              <div className="text-muted-foreground">Failed</div>
                              <div className="font-semibold text-red-600">{branch.failedBuilds}</div>
                            </div>
                            <div>
                              <div className="text-muted-foreground">Total</div>
                              <div className="font-semibold">{branch.totalBuilds}</div>
                            </div>
                          </div>
                          <div className="mt-3 w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                            <div
                              className="bg-green-500 h-2 rounded-full transition-all"
                              style={{ width: `${branch.successRate}%` }}
                            />
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Summary Statistics */}
            <Card className="bg-gradient-to-br from-blue-50 to-cyan-50 dark:from-blue-950/20 dark:to-cyan-950/20 border-blue-200">
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Activity className="h-5 w-5 text-blue-600" />
                  Summary Statistics
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <div className="text-sm text-muted-foreground mb-1">Total Builds Analyzed</div>
                    <div className="text-2xl font-bold">{metrics.totalBuilds}</div>
                  </div>
                  <div>
                    <div className="text-sm text-muted-foreground mb-1">Partially Succeeded</div>
                    <div className="text-2xl font-bold text-yellow-600">{metrics.partiallySucceededBuilds}</div>
                  </div>
                  <div>
                    <div className="text-sm text-muted-foreground mb-1">Success Rate</div>
                    <div className="text-2xl font-bold text-green-600">{Math.round(metrics.stabilityRating)}%</div>
                  </div>
                  <div>
                    <div className="text-sm text-muted-foreground mb-1">Failure Rate</div>
                    <div className="text-2xl font-bold text-red-600">
                      {Math.round((metrics.failedBuilds / metrics.totalBuilds) * 100)}%
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </ScrollArea>
      )}
    </GenericModal>
  );
}




