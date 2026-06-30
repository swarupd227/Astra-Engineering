import { useEffect, useState, useMemo } from "react";
import { GenericModal } from "@/components/ui/generic-modal";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  GitBranch,
  RefreshCw,
  CheckCircle2,
  XCircle,
  Clock,
  AlertTriangle,
  PlayCircle,
  ExternalLink,
  Search,
  Filter,
  TrendingUp,
  TrendingDown,
  GitCommit,
  User,
  Calendar,
  Loader2,
  BarChart3,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { getApiUrl } from "@/lib/api-config";
import { useQuery } from "@tanstack/react-query";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";

interface ADOProject {
  id: string;
  name: string;
  organization: string;
  organizationUrl: string;
}

interface PipelinesModalProps {
  projectId: string;
  adoProject?: ADOProject;
  providerSegment?: "ado" | "gitlab" | "bitbucket" | "github";
  open: boolean;
  onClose: () => void;
}

interface Pipeline {
  id: number;
  name: string;
  path?: string;
  url?: string;
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
  sourceVersion?: string;
  reason?: string;
  triggerInfo?: {
    ci?: {
      branchName?: string;
      isPullRequest?: boolean;
    };
    manual?: boolean;
    scheduled?: boolean;
  };
  requestedFor: {
    displayName: string;
    uniqueName?: string;
  };
  definition?: {
    id: number;
    name: string;
    path?: string;
  };
  stages?: any[];
  jobs?: any[];
  repository?: {
    id?: string;
    name?: string;
    type?: string;
  };
  sourceVersionDisplayUri?: string;
  _links?: {
    web?: {
      href?: string;
    };
  };
}

export function PipelinesModal({ projectId, adoProject, providerSegment = "ado", open, onClose }: PipelinesModalProps) {
  const { toast } = useToast();
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [pipelineFilter, setPipelineFilter] = useState<string>("all");
  const [triggerFilter, setTriggerFilter] = useState<string>("all");
  const [selectedPipeline, setSelectedPipeline] = useState<number | null>(null);
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

  const { data: providerConfig, error: configError } = useQuery<{
    hasConfig: boolean;
    organization?: string;
    project?: string;
    hint?: string;
  }>({
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
        return {
          hasConfig: Boolean(gitlabContext?.hasConfig),
          hint: typeof (gitlabContext as { hint?: string })?.hint === "string" ? (gitlabContext as { hint: string }).hint : undefined,
        };
      }
      const configUrl = getApiUrl(`/api/sdlc/projects/${projectId}/ado-config${queryString ? `?${queryString}` : ''}`);
      const configRes = await fetch(configUrl, { credentials: "include" });

      if (!configRes.ok) {
        let errorMessage = `Configuration check failed: ${configRes.status} ${configRes.statusText}`;
        try {
          const contentType = configRes.headers.get("content-type");
          if (contentType && contentType.includes("application/json")) {
            const errorData = await configRes.json();
            errorMessage = errorData.error || errorData.message || errorMessage;
          } else {
            const errorText = await configRes.text();
            if (errorText.includes("<!DOCTYPE") || errorText.includes("<html")) {
              errorMessage = `Server returned an error page. Please check if the backend API is accessible at ${configUrl}`;
            } else if (errorText.trim()) {
              errorMessage = errorText;
            }
          }
        } catch {
          // If parsing fails, use the default error message
        }
        throw new Error(errorMessage);
      }

      try {
        const contentType = configRes.headers.get("content-type");
        const responseText = await configRes.text();
        
        if (responseText.trim().startsWith("<!DOCTYPE") || responseText.trim().startsWith("<html")) {
          throw new Error(`Server returned an HTML error page. Please check if the backend API is accessible at ${configUrl}. This usually indicates a routing or server configuration issue.`);
        }
        
        try {
          return JSON.parse(responseText);
        } catch (parseError) {
          if (!contentType || contentType.includes("application/json")) {
            throw new Error(`Server returned invalid JSON response. Response: ${responseText.substring(0, 200)}`);
          }
          throw new Error(`Server returned non-JSON response (${contentType || 'unknown'}). Please check if the server is running correctly.`);
        }
      } catch (error) {
        if (error instanceof Error) {
          throw error;
        }
        throw new Error("Failed to parse server response. Please check if the server is running correctly.");
      }
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
        console.warn(`[PipelinesModal] Failed to fetch sprints: ${sprintsRes.status}`, errorText);
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

  // Fetch pipelines
  const { data: pipelinesData, isLoading: loadingPipelines, isFetching: fetchingPipelines, refetch: refetchPipelines } = useQuery<{ value: Pipeline[] }>({
    queryKey: [`/api/sdlc/projects/${projectId}/${providerSegment}/pipelines`, queryString],
    queryFn: async () => {
      if (!hasProviderConfig) return { value: [] };
      const url = getApiUrl(`/api/sdlc/projects/${projectId}/${providerSegment}/pipelines${queryString ? `?${queryString}` : ''}`);
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) {
        let errorMessage = `Failed to fetch pipelines: ${res.status} ${res.statusText}`;
        try {
          const errorText = await res.text();
          if (errorText.includes("<!DOCTYPE") || errorText.includes("<html")) {
            errorMessage = `Server returned an error page. Please check if the backend API is accessible.`;
          } else {
            try {
              const errorData = JSON.parse(errorText);
              errorMessage = errorData.error || errorData.message || errorMessage;
            } catch {
              if (errorText.trim()) errorMessage = errorText;
            }
          }
        } catch {
          // Use default error message
        }
        throw new Error(errorMessage);
      }
      try {
        const responseText = await res.text();
        if (responseText.trim().startsWith("<!DOCTYPE") || responseText.trim().startsWith("<html")) {
          throw new Error(`Server returned an HTML error page. Please check if the backend API is accessible.`);
        }
        return JSON.parse(responseText);
      } catch (parseError) {
        if (parseError instanceof Error) {
          throw parseError;
        }
        throw new Error("Failed to parse pipeline response");
      }
    },
    enabled: open && !!projectId && hasProviderConfig,
    staleTime: 2 * 60 * 1000,
  });

  // Fetch pipeline runs
  const { data: pipelineRunsData, isLoading: loadingRuns, isFetching: fetchingRuns, refetch: refetchRuns } = useQuery<{ value: PipelineRun[] }>({
    queryKey: [`/api/sdlc/projects/${projectId}/${providerSegment}/builds`, queryString, selectedSprintPath],
    queryFn: async () => {
      if (!hasProviderConfig) return { value: [] };
      const buildQuery = new URLSearchParams(queryString);
      if (selectedSprintPath && !isExternalCi) {
        // URLSearchParams.set() already handles encoding, so we don't need encodeURIComponent
        buildQuery.set('sprintPath', selectedSprintPath);
      }
      const url = getApiUrl(`/api/sdlc/projects/${projectId}/${providerSegment}/builds${buildQuery.toString() ? `?${buildQuery.toString()}` : ''}`);
      console.log(`[PipelinesModal] Fetching builds with sprint: ${selectedSprintPath}, URL: ${url}`);
      console.log(`[PipelinesModal] Query string: ${buildQuery.toString()}`);
      console.log(`[PipelinesModal] sprintPath in query: ${buildQuery.get('sprintPath')}`);
      // Add cache-busting when sprint is selected to ensure fresh data
      const fetchUrl = selectedSprintPath && !isExternalCi ? `${url}&_t=${Date.now()}` : url;
      const res = await fetch(fetchUrl, { 
        credentials: "include",
        cache: selectedSprintPath && !isExternalCi ? 'no-cache' : 'default'
      });
      if (!res.ok) {
        let errorMessage = `Failed to fetch pipeline runs: ${res.status} ${res.statusText}`;
        try {
          const errorText = await res.text();
          if (errorText.includes("<!DOCTYPE") || errorText.includes("<html")) {
            errorMessage = `Server returned an error page. Please check if the backend API is accessible.`;
          } else {
            try {
              const errorData = JSON.parse(errorText);
              errorMessage = errorData.error || errorData.message || errorMessage;
            } catch {
              if (errorText.trim()) errorMessage = errorText;
            }
          }
        } catch {
          // Use default error message
        }
        throw new Error(errorMessage);
      }
      try {
        const responseText = await res.text();
        if (responseText.trim().startsWith("<!DOCTYPE") || responseText.trim().startsWith("<html")) {
          throw new Error(`Server returned an HTML error page. Please check if the backend API is accessible.`);
        }
        return JSON.parse(responseText);
      } catch (parseError) {
        if (parseError instanceof Error) {
          throw parseError;
        }
        throw new Error("Failed to parse pipeline runs response");
      }
    },
    enabled: open && !!projectId && hasProviderConfig,
    staleTime: 2 * 60 * 1000,
  });

  useEffect(() => {
    if (configError) {
      toast({
        title: "Error",
        description: configError instanceof Error ? configError.message : "Failed to fetch ADO configuration",
        variant: "destructive",
      });
    }
  }, [configError, toast]);

  const handleRefresh = async () => {
    await Promise.all([refetchPipelines(), refetchRuns()]);
  };

  const pipelines = pipelinesData?.value || [];
  const pipelineRuns = (pipelineRunsData?.value || []).map((run) => ({
    ...run,
    status: run.status === "running" ? "inProgress" : run.status,
    result:
      run.result === "success" ? "succeeded" :
      run.result === "canceled" ? "canceled" :
      run.result,
  }));

  // Get sprint date range if sprint is selected
  const sprintDateRange = useMemo(() => {
    if (!selectedSprintPath || allSprints.length === 0) {
      return null;
    }
    const sprint = allSprints.find(s => s.path === selectedSprintPath);
    if (sprint && sprint.startDate && sprint.endDate) {
      const startDate = new Date(sprint.startDate);
      const endDate = new Date(sprint.endDate);
      // Set start date to beginning of day
      startDate.setHours(0, 0, 0, 0);
      // Set end date to end of day
      endDate.setHours(23, 59, 59, 999);
      console.log(`[PipelinesModal] Sprint date range: ${startDate.toISOString()} to ${endDate.toISOString()}`);
      console.log(`[PipelinesModal] Sprint date range: ${startDate.toLocaleString()} to ${endDate.toLocaleString()}`);
      return { startDate, endDate, sprint };
    }
    return null;
  }, [selectedSprintPath, allSprints]);

  // Get last run for each pipeline
  const getLastRunForPipeline = (pipelineId: number) => {
    return pipelineRuns
      .filter(run => run.definition?.id === pipelineId)
      .sort((a, b) => new Date(b.queueTime || b.startTime).getTime() - new Date(a.queueTime || a.startTime).getTime())[0];
  };

  // Get trigger type from reason and triggerInfo
  const getTriggerType = (run: PipelineRun): string => {
    if (run.reason === 'manual' || run.triggerInfo?.manual) {
      return 'Manual';
    }
    if (run.reason === 'pullRequest' || run.triggerInfo?.ci?.isPullRequest) {
      return 'Pull Request';
    }
    if (run.reason === 'schedule' || run.triggerInfo?.scheduled) {
      return 'Scheduled';
    }
    if (run.reason === 'batchedCI' || run.triggerInfo?.ci) {
      return 'CI (Branch)';
    }
    return run.reason || 'Unknown';
  };

  const getTriggerIcon = (triggerType: string) => {
    if (triggerType === 'Manual') return <User className="h-4 w-4" />;
    if (triggerType === 'Pull Request') return <GitBranch className="h-4 w-4" />;
    if (triggerType === 'Scheduled') return <Calendar className="h-4 w-4" />;
    return <PlayCircle className="h-4 w-4" />;
  };

  const getStatusIcon = (status: string, result?: string) => {
    if (status === "inProgress") return <Clock className="h-4 w-4 text-blue-600" />;
    if (result === "succeeded") return <CheckCircle2 className="h-4 w-4 text-green-600" />;
    if (result === "failed") return <XCircle className="h-4 w-4 text-red-600" />;
    if (result === "canceled") return <AlertTriangle className="h-4 w-4 text-gray-600" />;
    if (result === "partiallySucceeded") return <AlertTriangle className="h-4 w-4 text-yellow-600" />;
    return <PlayCircle className="h-4 w-4 text-gray-600" />;
  };

  const getStatusColor = (status: string, result?: string) => {
    if (status === "inProgress") return "bg-blue-500";
    if (result === "succeeded") return "bg-green-500";
    if (result === "failed") return "bg-red-500";
    if (result === "canceled") return "bg-gray-500";
    if (result === "partiallySucceeded") return "bg-yellow-500";
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

  const formatDuration = (startTime: string, finishTime?: string) => {
    if (!startTime) return "N/A";
    const start = new Date(startTime);
    const end = finishTime ? new Date(finishTime) : new Date();
    const durationMs = end.getTime() - start.getTime();
    const minutes = Math.floor(durationMs / 60000);
    const seconds = Math.floor((durationMs % 60000) / 1000);
    if (minutes > 0) {
      return `${minutes}m ${seconds}s`;
    }
    return `${seconds}s`;
  };

  const getPipelineUrl = (buildId: number) => {
    if (adoProject?.organizationUrl && adoProject?.name) {
      return `${adoProject.organizationUrl}/${adoProject.name}/_build/results?buildId=${buildId}`;
    }
    return null;
  };

  // Calculate statistics
  const succeededCount = pipelineRuns.filter(r => r.result === "succeeded").length;
  const failedCount = pipelineRuns.filter(r => r.result === "failed").length;
  const inProgressCount = pipelineRuns.filter(r => r.status === "inProgress").length;
  const partiallySucceededCount = pipelineRuns.filter(r => r.result === "partiallySucceeded").length;

  // Calculate pipeline health metrics - filtered by sprint if selected
  const pipelineHealth = useMemo(() => {
    const pipelineStats = pipelines.map(pipeline => {
      // Filter runs for this pipeline - already filtered by sprint date at backend level
      const runs = pipelineRuns.filter(r => r.definition?.id === pipeline.id);
      const lastRun = getLastRunForPipeline(pipeline.id);
      const succeeded = runs.filter(r => r.result === "succeeded").length;
      const failed = runs.filter(r => r.result === "failed").length;
      const total = runs.length;
      const successRate = total > 0 ? (succeeded / total) * 100 : 0;
      
      // Check if pipeline requires attention (high failure rate or recent failures)
      // For sprint view, check failures within the sprint date range
      const recentFailures = runs.filter(r => {
        if (!r.finishTime) return false;
        const finishTime = new Date(r.finishTime);
        if (sprintDateRange) {
          // Check if failure is within sprint date range
          return r.result === "failed" && finishTime >= sprintDateRange.startDate && finishTime <= sprintDateRange.endDate;
        } else {
          // Check failures in last 7 days
          const daysAgo = (Date.now() - finishTime.getTime()) / (1000 * 60 * 60 * 24);
          return r.result === "failed" && daysAgo <= 7;
        }
      }).length;
      
      const requiresAttention = successRate < 70 || recentFailures > 2 || (lastRun && lastRun.result === "failed");
      
      // Calculate build frequency - use sprint date range if available
      let runsInPeriod = 0;
      if (sprintDateRange) {
        // Count runs within sprint date range (already filtered, but count for display)
        runsInPeriod = runs.length;
      } else {
        // Count runs in last week
        const now = new Date();
        const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        runsInPeriod = runs.filter(r => {
          const runTime = new Date(r.queueTime || r.startTime);
          return runTime >= weekAgo;
        }).length;
      }
      
      return {
        pipeline,
        lastRun,
        totalRuns: total,
        succeeded,
        failed,
        successRate,
        requiresAttention,
        runsLastWeek: runsInPeriod,
        recentFailures,
      };
    });
    
    // Only show pipelines that have runs in the selected sprint (if sprint is selected)
    if (sprintDateRange) {
      return pipelineStats.filter(stat => stat.totalRuns > 0);
    }
    
    return pipelineStats;
  }, [pipelines, pipelineRuns, sprintDateRange]);

  // Filter pipeline runs
  const filteredRuns = useMemo(() => {
    let filtered = [...pipelineRuns];
    
    // Search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(run => 
        run.buildNumber.toLowerCase().includes(query) ||
        run.definition?.name.toLowerCase().includes(query) ||
        run.sourceBranch.toLowerCase().includes(query) ||
        run.requestedFor?.displayName.toLowerCase().includes(query)
      );
    }
    
    // Status filter
    if (statusFilter !== "all") {
      if (statusFilter === "succeeded") {
        filtered = filtered.filter(r => r.result === "succeeded");
      } else if (statusFilter === "failed") {
        filtered = filtered.filter(r => r.result === "failed");
      } else if (statusFilter === "inProgress") {
        filtered = filtered.filter(r => r.status === "inProgress");
      } else if (statusFilter === "partiallySucceeded") {
        filtered = filtered.filter(r => r.result === "partiallySucceeded");
      }
    }
    
    // Pipeline filter
    if (pipelineFilter !== "all") {
      const pipelineId = parseInt(pipelineFilter);
      filtered = filtered.filter(r => r.definition?.id === pipelineId);
    }
    
    // Trigger filter
    if (triggerFilter !== "all") {
      filtered = filtered.filter(run => {
        const triggerType = getTriggerType(run);
        return triggerType === triggerFilter;
      });
    }
    
    // Sort by most recent first
    return filtered.sort((a, b) => {
      const timeA = new Date(a.queueTime || a.startTime).getTime();
      const timeB = new Date(b.queueTime || b.startTime).getTime();
      return timeB - timeA;
    });
  }, [pipelineRuns, searchQuery, statusFilter, pipelineFilter, triggerFilter]);

  // Calculate build frequency trends - use sprint date range if sprint is selected, otherwise last 7 days
  const buildFrequencyTrend = useMemo(() => {
    let startDate: Date;
    let endDate: Date;
    let daysToShow = 7;
    
    if (sprintDateRange) {
      // Use sprint date range
      startDate = new Date(sprintDateRange.startDate);
      endDate = new Date(sprintDateRange.endDate);
      // Calculate number of days in sprint
      const diffTime = endDate.getTime() - startDate.getTime();
      daysToShow = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      // Limit to max 30 days for display purposes
      daysToShow = Math.min(daysToShow, 30);
    } else {
      // Use last 7 days
      endDate = new Date();
      startDate = new Date(endDate.getTime() - 6 * 24 * 60 * 60 * 1000);
    }
    
    const days = [];
    for (let i = 0; i < daysToShow; i++) {
      const date = new Date(startDate.getTime() + i * 24 * 60 * 60 * 1000);
      const dayStart = new Date(date);
      dayStart.setHours(0, 0, 0, 0);
      const dayEnd = new Date(date);
      dayEnd.setHours(23, 59, 59, 999);
      
      const runsOnDay = pipelineRuns.filter(r => {
        const runTime = new Date(r.queueTime || r.startTime);
        return runTime >= dayStart && runTime <= dayEnd;
      });
      
      days.push({
        date: dayStart.toISOString().split('T')[0],
        total: runsOnDay.length,
        succeeded: runsOnDay.filter(r => r.result === "succeeded").length,
        failed: runsOnDay.filter(r => r.result === "failed").length,
      });
    }
    
    // Calculate trend (only if we have enough days)
    let trend: "increasing" | "decreasing" | "stable" = "stable";
    if (days.length >= 6) {
      const recentDays = days.slice(-Math.ceil(days.length / 2));
      const olderDays = days.slice(0, Math.floor(days.length / 2));
      const recentAvg = recentDays.reduce((sum, d) => sum + d.total, 0) / recentDays.length;
      const olderAvg = olderDays.reduce((sum, d) => sum + d.total, 0) / olderDays.length;
      
      if (recentAvg > olderAvg * 1.2) trend = "increasing";
      else if (recentAvg < olderAvg * 0.8) trend = "decreasing";
    }
    
    return { days, trend };
  }, [pipelineRuns, sprintDateRange]);

  // Get commit short SHA
  const getCommitShortSha = (sourceVersion?: string) => {
    if (!sourceVersion) return "N/A";
    return sourceVersion.substring(0, 7);
  };

  return (
    <GenericModal
      open={open}
      onOpenChange={onClose}
      title="Build Pipelines"
      description={
        isBitbucket
          ? "View and manage Bitbucket Pipelines runs and build history."
          : isGitLab
            ? "View and manage GitLab CI pipelines, runs, and build history."
            : "View and manage Azure DevOps CI pipelines, runs, and build history."
      }
      icon={GitBranch}
      iconClassName="bg-gradient-to-br from-blue-500 to-blue-600"
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
            disabled={fetchingPipelines || fetchingRuns}
            className="h-8 w-8 p-0 flex items-center justify-center"
            aria-label="Refresh pipelines"
          >
            <RefreshCw className={`h-4 w-4 ${(fetchingPipelines || fetchingRuns) ? 'animate-spin' : ''}`} />
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
                    ? "Configure Bitbucket for Repository and Bitbucket Pipelines for CI/CD on this SDLC project (Edit project → tools). A golden repository from project setup or the repo slug in the Bitbucket tool fields is required so we can call Bitbucket APIs."
                    : isGithub
                      ? "Please configure the GitHub connection in Settings > Third-Party Integrations to view pipelines."
                      : "Please configure the GitLab one-time connection in Settings > Third-Party Integrations to view pipelines."
                  : "No data is available for this metric at the moment."}
              </p>
              {isBitbucket && providerConfig?.hint ? (
                <p className="text-sm text-muted-foreground max-w-lg mx-auto">{providerConfig.hint}</p>
              ) : null}
            </div>
          </CardContent>
        </Card>
      ) : loadingPipelines || loadingRuns ? (
        <Card>
          <CardContent className="pt-6">
            <div className="text-center py-8">
              <Loader2 className="h-8 w-8 animate-spin mx-auto mb-2 text-muted-foreground" />
              <p className="text-muted-foreground">Loading pipelines...</p>
            </div>
          </CardContent>
        </Card>
      ) : (
          <div className="space-y-6 pb-6 pr-4">
            {/* Summary Statistics - Redesigned */}
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <BarChart3 className="h-5 w-5 text-blue-600" />
                <h3 className="text-lg font-bold">Overall Build Metrics</h3>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <Card className="bg-gradient-to-br from-blue-50 to-blue-100 dark:from-blue-950/30 dark:to-blue-900/20 border-blue-200 dark:border-blue-800 shadow-md hover:shadow-lg transition-shadow">
                  <CardContent className="pt-6 pb-4">
                    <div className="flex items-center justify-between mb-2">
                      <div className="text-sm font-medium text-muted-foreground">Total Pipelines</div>
                      <GitBranch className="h-4 w-4 text-blue-600" />
                    </div>
                    <div className="text-3xl font-bold text-blue-600">{pipelines.length}</div>
                  </CardContent>
                </Card>
                <Card className="bg-gradient-to-br from-green-50 to-emerald-100 dark:from-green-950/30 dark:to-emerald-900/20 border-green-200 dark:border-green-800 shadow-md hover:shadow-lg transition-shadow">
                  <CardContent className="pt-6 pb-4">
                    <div className="flex items-center justify-between mb-2">
                      <div className="text-sm font-medium text-muted-foreground">Total Runs</div>
                      <PlayCircle className="h-4 w-4 text-green-600" />
                    </div>
                    <div className="text-3xl font-bold text-green-600">{pipelineRuns.length}</div>
                  </CardContent>
                </Card>
                <Card className="bg-gradient-to-br from-emerald-50 to-teal-100 dark:from-emerald-950/30 dark:to-teal-900/20 border-emerald-200 dark:border-emerald-800 shadow-md hover:shadow-lg transition-shadow">
                  <CardContent className="pt-6 pb-4">
                    <div className="flex items-center justify-between mb-2">
                      <div className="text-sm font-medium text-muted-foreground">Succeeded</div>
                      <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                    </div>
                    <div className="text-3xl font-bold text-emerald-600">{succeededCount}</div>
                  </CardContent>
                </Card>
                <Card className="bg-gradient-to-br from-red-50 to-rose-100 dark:from-red-950/30 dark:to-rose-900/20 border-red-200 dark:border-red-800 shadow-md hover:shadow-lg transition-shadow">
                  <CardContent className="pt-6 pb-4">
                    <div className="flex items-center justify-between mb-2">
                      <div className="text-sm font-medium text-muted-foreground">Failed</div>
                      <XCircle className="h-4 w-4 text-red-600" />
                    </div>
                    <div className="text-3xl font-bold text-red-600">{failedCount}</div>
                  </CardContent>
                </Card>
              </div>
            </div>

            {/* Build Frequency and Stability Trends */}
            <Card className="bg-gradient-to-br from-slate-50 to-gray-50 dark:from-slate-900/50 dark:to-gray-900/30 border-slate-200 dark:border-slate-800 shadow-lg">
              <CardHeader className="pb-3">
                <CardTitle className="text-lg flex items-center gap-2">
                  <BarChart3 className="h-5 w-5 text-indigo-600" />
                  Build Frequency & Stability Trends
                </CardTitle>
                <CardDescription>
                  {sprintDateRange 
                    ? `${sprintDateRange.sprint.name} build activity and trends (${new Date(sprintDateRange.startDate).toLocaleDateString()} - ${new Date(sprintDateRange.endDate).toLocaleDateString()})`
                    : "Last 7 days build activity and trends"}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div className="flex items-center justify-between bg-white dark:bg-slate-800 rounded-lg p-4 border border-slate-200 dark:border-slate-700 shadow-sm">
                    <div>
                      <p className="text-sm font-medium text-muted-foreground mb-1">Build Frequency Trend</p>
                      <div className="flex items-center gap-2">
                        {buildFrequencyTrend.trend === "increasing" ? (
                          <>
                            <TrendingUp className="h-5 w-5 text-green-600" />
                            <span className="text-sm font-semibold text-green-600">Increasing</span>
                          </>
                        ) : buildFrequencyTrend.trend === "decreasing" ? (
                          <>
                            <TrendingDown className="h-5 w-5 text-red-600" />
                            <span className="text-sm font-semibold text-red-600">Decreasing</span>
                          </>
                        ) : (
                          <>
                            <Clock className="h-5 w-5 text-blue-600" />
                            <span className="text-sm font-semibold text-blue-600">Stable</span>
                          </>
                        )}
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">
                        {sprintDateRange 
                          ? `Avg. per day (${sprintDateRange.sprint.name})`
                          : "Avg. per day (last 7 days)"}
                      </p>
                      <p className="text-2xl font-bold text-slate-900 dark:text-slate-100">
                        {buildFrequencyTrend.days.length > 0
                          ? Math.round(buildFrequencyTrend.days.reduce((sum, d) => sum + d.total, 0) / buildFrequencyTrend.days.length)
                          : 0}
                      </p>
                    </div>
                  </div>
                  {buildFrequencyTrend.days && buildFrequencyTrend.days.length > 0 ? (
                    <div className="h-[400px] w-full">
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart
                          data={buildFrequencyTrend.days.map((day) => ({
                            date: new Date(day.date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }),
                            succeeded: day.succeeded,
                            failed: day.failed,
                            successRate: day.total > 0 ? Math.round((day.succeeded / day.total) * 100) : 0,
                          }))}
                          margin={{ top: 5, right: 30, left: 20, bottom: 5 }}
                        >
                          <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                          <XAxis 
                            dataKey="date" 
                            stroke="#9ca3af"
                            style={{ fontSize: '12px' }}
                            angle={-45}
                            textAnchor="end"
                            height={80}
                          />
                          <YAxis 
                            yAxisId="left"
                            label={{ value: 'Build Count', angle: -90, position: 'insideLeft', style: { textAnchor: 'middle', fill: '#9ca3af' } }}
                            stroke="#9ca3af"
                            style={{ fontSize: '12px' }}
                          />
                          <YAxis 
                            yAxisId="right" 
                            orientation="right"
                            domain={[0, 100]}
                            label={{ value: 'Success Rate (%)', angle: 90, position: 'insideRight', style: { textAnchor: 'middle', fill: '#9ca3af' } }}
                            stroke="#9ca3af"
                            style={{ fontSize: '12px' }}
                          />
                          <Tooltip 
                            contentStyle={{ 
                              backgroundColor: '#1f2937', 
                              border: '1px solid #374151',
                              borderRadius: '6px',
                              color: '#f3f4f6'
                            }}
                            labelStyle={{ color: '#f3f4f6' }}
                          />
                          <Legend 
                            wrapperStyle={{ paddingTop: '20px' }}
                          />
                          <Line 
                            yAxisId="left"
                            type="monotone" 
                            dataKey="succeeded" 
                            stroke="#22c55e" 
                            strokeWidth={2}
                            name="Succeeded"
                            dot={{ fill: '#22c55e', r: 4 }}
                            activeDot={{ r: 6 }}
                          />
                          <Line 
                            yAxisId="left"
                            type="monotone" 
                            dataKey="failed" 
                            stroke="#ef4444" 
                            strokeWidth={2}
                            name="Failed"
                            dot={{ fill: '#ef4444', r: 4 }}
                            activeDot={{ r: 6 }}
                          />
                          <Line 
                            yAxisId="right"
                            type="monotone" 
                            dataKey="successRate" 
                            stroke="#3b82f6" 
                            strokeWidth={2}
                            name="Success Rate %"
                            dot={{ fill: '#3b82f6', r: 4 }}
                            activeDot={{ r: 6 }}
                          />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  ) : (
                    <div className="text-center py-8 text-muted-foreground">
                      <BarChart3 className="h-12 w-12 mx-auto mb-2 opacity-50" />
                      <p>No build data available for the selected period</p>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* All Pipelines with Last Run Status */}
            <Card className="bg-gradient-to-br from-slate-50 to-gray-50 dark:from-slate-900/50 dark:to-gray-900/30 border-slate-200 dark:border-slate-800 shadow-lg">
              <CardHeader className="pb-3">
                <CardTitle className="text-lg flex items-center gap-2">
                  <GitBranch className="h-5 w-5 text-indigo-600" />
                  All CI Pipelines
                </CardTitle>
                <CardDescription>
                  {sprintDateRange 
                    ? `View pipelines with runs in ${sprintDateRange.sprint.name} and their health metrics`
                    : "View all pipelines with their last run status and health metrics"}
                </CardDescription>
              </CardHeader>
              <CardContent>
                {pipelines.length === 0 ? (
                  <p className="text-center text-muted-foreground py-8">No pipelines found</p>
                ) : (
                  <div className="space-y-3">
                    {pipelineHealth.map((health) => {
                      const lastRun = health.lastRun;
                      return (
                        <Card
                          key={health.pipeline.id}
                          className={`border-2 shadow-sm hover:shadow-md transition-shadow ${
                            health.requiresAttention
                              ? "border-red-200 bg-red-50 dark:bg-red-950/20"
                              : "border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
                          }`}
                        >
                          <CardContent className="pt-4">
                            <div className="flex items-start justify-between">
                              <div className="flex items-start gap-3 flex-1">
                                <GitBranch className="h-5 w-5 text-blue-600 mt-1" />
                                <div className="flex-1">
                                  <div className="flex items-center gap-2 mb-2">
                                    <span className="font-semibold">{health.pipeline.name}</span>
                                    {health.requiresAttention && (
                                      <Badge variant="destructive" className="text-xs">
                                        Requires Attention
                                      </Badge>
                                    )}
                                    {health.pipeline.path && (
                                      <span className="text-sm text-muted-foreground">{health.pipeline.path}</span>
                                    )}
                                  </div>
                                  <div className="grid grid-cols-4 gap-4 text-sm">
                                    <div>
                                      <p className="text-muted-foreground">Last Run Status</p>
                                      {lastRun ? (
                                        <div className="flex items-center gap-2 mt-1">
                                          {getStatusIcon(lastRun.status, lastRun.result)}
                                          <Badge className={`${getStatusColor(lastRun.status, lastRun.result)} text-white text-xs`}>
                                            {lastRun.status === "inProgress" ? "In Progress" : lastRun.result || lastRun.status}
                                          </Badge>
                                        </div>
                                      ) : (
                                        <p className="text-muted-foreground">No runs yet</p>
                                      )}
                                    </div>
                                    <div>
                                      <p className="text-muted-foreground">Success Rate</p>
                                      <p className="font-semibold mt-1">
                                        {health.totalRuns > 0 ? Math.round(health.successRate) : 0}%
                                      </p>
                                    </div>
                                    <div>
                                      <p className="text-muted-foreground">Total Runs</p>
                                      <p className="font-semibold mt-1">{health.totalRuns}</p>
                                    </div>
                                    <div>
                                      <p className="text-muted-foreground">
                                        {sprintDateRange ? "Runs (Sprint)" : "Runs (Last Week)"}
                                      </p>
                                      <p className="font-semibold mt-1">{health.runsLastWeek}</p>
                                    </div>
                                  </div>
                                  {lastRun && (
                                    <div className="mt-3 pt-3 border-t text-xs text-muted-foreground">
                                      <div className="flex items-center gap-4 flex-wrap">
                                        <span>Last run: {formatDate(lastRun.finishTime || lastRun.startTime)}</span>
                                        {lastRun.finishTime && (
                                          <span>Duration: {formatDuration(lastRun.startTime, lastRun.finishTime)}</span>
                                        )}
                                        <span>Trigger: {getTriggerType(lastRun)}</span>
                                      </div>
                                    </div>
                                  )}
                                </div>
                              </div>
                              {health.pipeline.url && (
                                <Button variant="ghost" size="sm" onClick={() => window.open(health.pipeline.url, '_blank')}>
                                  <ExternalLink className="h-4 w-4" />
                                </Button>
                              )}
                            </div>
                          </CardContent>
                        </Card>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Pipeline Run History with Filters */}
            <Card className="bg-gradient-to-br from-slate-50 to-gray-50 dark:from-slate-900/50 dark:to-gray-900/30 border-slate-200 dark:border-slate-800 shadow-lg">
              <CardHeader className="pb-3">
                <CardTitle className="text-lg flex items-center gap-2">
                  <Clock className="h-5 w-5 text-indigo-600" />
                  Pipeline Run History
                </CardTitle>
                <CardDescription>
                  {sprintDateRange 
                    ? `Pipeline runs in ${sprintDateRange.sprint.name} with filtering and search`
                    : "Detailed history of all pipeline runs with filtering and search"}
                </CardDescription>
              </CardHeader>
              <CardContent>
                {/* Search and Filters */}
                <div className="mb-4 space-y-3">
                  <div className="flex gap-3">
                    <div className="flex-1 relative">
                      <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input
                        placeholder="Search by build number, pipeline, branch, or requester..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="pl-10"
                      />
                    </div>
                    <Select value={statusFilter} onValueChange={setStatusFilter}>
                      <SelectTrigger className="w-[150px]">
                        <Filter className="h-4 w-4 mr-2" />
                        <SelectValue placeholder="Status" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Status</SelectItem>
                        <SelectItem value="succeeded">Succeeded</SelectItem>
                        <SelectItem value="failed">Failed</SelectItem>
                        <SelectItem value="inProgress">In Progress</SelectItem>
                        <SelectItem value="partiallySucceeded">Partially Succeeded</SelectItem>
                      </SelectContent>
                    </Select>
                    <Select value={pipelineFilter} onValueChange={setPipelineFilter}>
                      <SelectTrigger className="w-[180px]">
                        <SelectValue placeholder="Pipeline" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Pipelines</SelectItem>
                        {pipelines.map((pipeline) => (
                          <SelectItem key={pipeline.id} value={pipeline.id.toString()}>
                            {pipeline.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Select value={triggerFilter} onValueChange={setTriggerFilter}>
                      <SelectTrigger className="w-[150px]">
                        <SelectValue placeholder="Trigger" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Triggers</SelectItem>
                        <SelectItem value="Manual">Manual</SelectItem>
                        <SelectItem value="Pull Request">Pull Request</SelectItem>
                        <SelectItem value="Scheduled">Scheduled</SelectItem>
                        <SelectItem value="CI (Branch)">CI (Branch)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>


                  {filteredRuns.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground">
                      <AlertTriangle className="h-12 w-12 mx-auto mb-2 text-yellow-500" />
                      <p>No pipeline runs found matching your filters</p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {filteredRuns.map((run) => {
                        const pipelineUrl = getPipelineUrl(run.id);
                        const triggerType = getTriggerType(run);
                        const commitSha = getCommitShortSha(run.sourceVersion);
                        
                        return (
                          <Card
                            key={run.id}
                            className={`border ${
                              run.result === "failed"
                                ? "border-red-200 bg-red-50 dark:bg-red-950/20"
                                : run.result === "succeeded"
                                ? "border-green-200 bg-green-50 dark:bg-green-950/20"
                                : run.result === "partiallySucceeded"
                                ? "border-yellow-200 bg-yellow-50 dark:bg-yellow-950/20"
                                : "border-gray-200"
                            }`}
                          >
                            <CardContent className="pt-4">
                              <div className="flex items-start justify-between gap-4">
                                <div className="flex items-start gap-3 flex-1">
                                  {getStatusIcon(run.status, run.result)}
                                  <div className="flex-1">
                                    <div className="flex items-center gap-2 mb-2 flex-wrap">
                                      <span className="font-semibold">Build #{run.buildNumber}</span>
                                      <Badge className={`${getStatusColor(run.status, run.result)} text-white text-xs`}>
                                        {run.status === "inProgress" ? "In Progress" : run.result || run.status}
                                      </Badge>
                                      {run.definition && (
                                        <Badge variant="outline" className="text-xs">
                                          {run.definition.name}
                                        </Badge>
                                      )}
                                    </div>
                                    
                                    <div className="grid grid-cols-2 gap-4 text-sm mb-3">
                                      <div>
                                        <p className="text-muted-foreground mb-1">Branch</p>
                                        <div className="flex items-center gap-2">
                                          <GitBranch className="h-3 w-3" />
                                          <span className="font-medium">
                                            {run.sourceBranch?.replace('refs/heads/', '').replace('refs/merge/', '') || 'N/A'}
                                          </span>
                                        </div>
                                      </div>
                                      <div>
                                        <p className="text-muted-foreground mb-1">Trigger</p>
                                        <div className="flex items-center gap-2">
                                          {getTriggerIcon(triggerType)}
                                          <span className="font-medium">{triggerType}</span>
                                        </div>
                                      </div>
                                      <div>
                                        <p className="text-muted-foreground mb-1">Commit</p>
                                        <div className="flex items-center gap-2">
                                          <GitCommit className="h-3 w-3" />
                                          <span className="font-mono text-xs">{commitSha}</span>
                                          {run.sourceVersionDisplayUri && (
                                            <Button
                                              variant="ghost"
                                              size="sm"
                                              className="h-6 px-2"
                                              onClick={() => window.open(run.sourceVersionDisplayUri, '_blank')}
                                            >
                                              <ExternalLink className="h-3 w-3" />
                                            </Button>
                                          )}
                                        </div>
                                      </div>
                                      <div>
                                        <p className="text-muted-foreground mb-1">Requested By</p>
                                        <div className="flex items-center gap-2">
                                          <User className="h-3 w-3" />
                                          <span className="font-medium">{run.requestedFor?.displayName || 'Unknown'}</span>
                                        </div>
                                      </div>
                                    </div>
                                    
                                    <div className="grid grid-cols-3 gap-4 text-sm pt-3 border-t">
                                      <div>
                                        <p className="text-muted-foreground">Started</p>
                                        <p className="font-medium">{formatDate(run.startTime)}</p>
                                      </div>
                                      {run.finishTime ? (
                                        <>
                                          <div>
                                            <p className="text-muted-foreground">Finished</p>
                                            <p className="font-medium">{formatDate(run.finishTime)}</p>
                                          </div>
                                          <div>
                                            <p className="text-muted-foreground">Duration</p>
                                            <p className="font-medium">{formatDuration(run.startTime, run.finishTime)}</p>
                                          </div>
                                        </>
                                      ) : (
                                        <div>
                                          <p className="text-muted-foreground">Duration</p>
                                          <p className="font-medium">{formatDuration(run.startTime)}</p>
                                        </div>
                                      )}
                                    </div>
                                    
                                    {run.stages && run.stages.length > 0 && (
                                      <div className="mt-3 pt-3 border-t">
                                        <p className="text-xs text-muted-foreground mb-1">Stages: {run.stages.length}</p>
                                      </div>
                                    )}
                                  </div>
                                </div>
                                {pipelineUrl && (
                                  <Button variant="ghost" size="sm" onClick={() => window.open(pipelineUrl, '_blank')}>
                                    <ExternalLink className="h-4 w-4" />
                                  </Button>
                                )}
                              </div>
                            </CardContent>
                          </Card>
                        );
                      })}
                    </div>
                  )}
              </CardContent>
            </Card>
          </div>
      )}
    </GenericModal>
  );
}



