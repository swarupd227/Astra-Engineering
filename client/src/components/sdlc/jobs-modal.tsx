import { useMemo, useState, useEffect } from "react";
import { GenericModal } from "@/components/ui/generic-modal";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Briefcase,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Clock,
  SkipForward,
  Search,
  X,
  FileText,
  Filter,
  TrendingDown,
  Activity,
  Timer,
  Loader2,
  ExternalLink,
  ChevronDown,
  ChevronRight,
  Calendar,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { getApiUrl } from "@/lib/api-config";
import { useQuery } from "@tanstack/react-query";

interface ADOProject {
  id: string;
  name: string;
  organization: string;
  organizationUrl: string;
}

interface JobsModalProps {
  projectId: string;
  adoProject?: ADOProject;
  providerSegment?: "ado" | "gitlab" | "bitbucket" | "github";
  open: boolean;
  onClose: () => void;
}

interface Job {
  id: string;
  name: string;
  status: string;
  result?: string;
  state?: string;
  startTime?: string;
  finishTime?: string;
  duration?: number;
  stageName?: string;
  stageId?: string;
  logUrl?: string;
  errorMessage?: string;
  log?: string;
  type?: string;
  parentId?: string;
  order?: number;
  issues?: Array<{
    category: string;
    type: string;
    message: string;
  }>;
}

interface Stage {
  id: string;
  name: string;
  status: string;
  result?: string;
  startTime?: string;
  finishTime?: string;
  duration?: number;
  jobs: Job[];
}

interface PipelineRun {
  id: number;
  buildNumber: string;
  status: string;
  result: string;
  queueTime?: string;
  startTime?: string;
  finishTime?: string;
  sourceBranch?: string;
  definition?: {
    id: number;
    name: string;
  };
  jobs?: Job[];
  stages?: Stage[];
}

interface JobHealthMetrics {
  consistentFailures: Array<{
    jobName: string;
    stageName: string;
    failureCount: number;
    lastFailure: string;
  }>;
  flakySteps: Array<{
    jobName: string;
    stageName: string;
    passRate: number;
    totalRuns: number;
  }>;
  longRunningStages: Array<{
    stageName: string;
    averageDuration: number;
    maxDuration: number;
  }>;
  stalledJobs: Array<{
    jobName: string;
    stageName: string;
    duration: number;
    status: string;
  }>;
}

export function JobsModal({ projectId, adoProject, providerSegment = "ado", open, onClose }: JobsModalProps) {
  const { toast } = useToast();
  const isGitLab = providerSegment === "gitlab";
  const isBitbucket = providerSegment === "bitbucket";
  const isGithub = providerSegment === "github";
  const isExternalCi = isGitLab || isBitbucket || isGithub;
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [selectedBuildId, setSelectedBuildId] = useState<number | null>(null);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [expandedStages, setExpandedStages] = useState<Set<string>>(new Set());
  const [expandedJobs, setExpandedJobs] = useState<Set<string>>(new Set());
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

  // Fetch provider config
  const { data: providerConfig, error: configError } = useQuery<{ hasConfig: boolean; organization?: string; project?: string }>({
    queryKey: [`/api/sdlc/projects/${projectId}/${providerSegment}-config`, queryString],
    queryFn: async () => {
      if (isExternalCi) {
        const ciKey = isBitbucket ? "bitbucket" : isGithub ? "github" : "gitlab";
        const contextUrl = getApiUrl(
          `/api/sdlc/projects/${projectId}/${ciKey}/context-status${queryString ? `?${queryString}` : ""}`,
        );
        const contextRes = await fetch(contextUrl, { credentials: "include" });
        if (!contextRes.ok) return { hasConfig: false };
        const contextData = await contextRes.json();
        return { hasConfig: Boolean(contextData?.hasConfig) };
      }
      const configUrl = getApiUrl(`/api/sdlc/projects/${projectId}/ado-config${queryString ? `?${queryString}` : ""}`);
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
        console.warn(`[JobsModal] Failed to fetch sprints: ${sprintsRes.status}`, errorText);
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

  // Fetch pipeline runs with jobs
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
      const url = getApiUrl(
        `/api/sdlc/projects/${projectId}/${providerSegment}/builds${buildQuery.toString() ? `?${buildQuery.toString()}` : ""}`,
      );
      console.log(`[JobsModal] Fetching builds with sprint: ${selectedSprintPath}, URL: ${url}`);
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

  // Fetch detailed job logs for selected job
  const { data: jobLogsData, isLoading: loadingLogs } = useQuery<{ log: string; errorMessage?: string }>({
    queryKey: [`/api/sdlc/projects/${projectId}/ado/builds/${selectedBuildId}/jobs/${selectedJobId}/logs`, queryString],
    queryFn: async () => {
      if (!selectedBuildId || !selectedJobId || !hasProviderConfig) return { log: '' };
      
      // Try to fetch logs from Azure DevOps
      // Note: This would need a backend endpoint to fetch logs
      // For now, we'll extract error messages from job data
      return { log: '', errorMessage: '' };
    },
    enabled: open && !!projectId && hasProviderConfig && !!selectedBuildId && !!selectedJobId,
    staleTime: 2 * 60 * 1000,
    retry: 1,
  });

  // Group builds with their jobs and stages
  const buildsWithJobs = useMemo(() => {
    if (!buildsData?.value) return [];
    
    return buildsData.value
      .map((build) => {
        const jobs = build.jobs || [];
        const stages = build.stages || [];
        
        // Group jobs by stage if stages are available
        const jobsByStage: Record<string, Job[]> = {};
        jobs.forEach((job) => {
          const stageName = job.stageName || 'Unknown Stage';
          if (!jobsByStage[stageName]) {
            jobsByStage[stageName] = [];
          }
          jobsByStage[stageName].push(job);
        });
        
        // Create stage objects with jobs
        const stageObjects: Stage[] = Object.entries(jobsByStage).map(([stageName, stageJobs]) => {
          const stage = stages.find(s => s.name === stageName) || stages.find(s => s.id === stageJobs[0]?.stageId);
          const failedJobs = stageJobs.filter(j => (j.result || j.status)?.toLowerCase() === 'failed');
          const succeededJobs = stageJobs.filter(j => (j.result || j.status)?.toLowerCase() === 'succeeded');
          
          // Calculate stage duration
          let stageDuration = 0;
          if (stage?.startTime && stage?.finishTime) {
            stageDuration = new Date(stage.finishTime).getTime() - new Date(stage.startTime).getTime();
          } else if (stageJobs.length > 0) {
            const startTimes = stageJobs.map(j => j.startTime).filter(Boolean).map(t => new Date(t!).getTime());
            const finishTimes = stageJobs.map(j => j.finishTime).filter(Boolean).map(t => new Date(t!).getTime());
            if (startTimes.length > 0 && finishTimes.length > 0) {
              const minStart = Math.min(...startTimes);
              const maxFinish = Math.max(...finishTimes);
              stageDuration = maxFinish - minStart;
            }
          }
          
          return {
            id: stage?.id || stageName,
            name: stageName,
            status: stage?.status || (failedJobs.length > 0 ? 'failed' : 'succeeded'),
            result: stage?.result || (failedJobs.length > 0 ? 'failed' : 'succeeded'),
            startTime: stage?.startTime || stageJobs.find(j => j.startTime)?.startTime,
            finishTime: stage?.finishTime || stageJobs.find(j => j.finishTime)?.finishTime,
            duration: stageDuration,
            jobs: stageJobs.sort((a, b) => (a.order || 0) - (b.order || 0)),
          };
        });
        
        return {
          id: build.id,
          buildNumber: build.buildNumber,
          pipelineName: build.definition?.name || 'Unknown Pipeline',
          status: build.status,
          result: build.result,
          finishTime: build.finishTime,
          startTime: build.startTime,
          sourceBranch: build.sourceBranch,
          jobs: jobs,
          stages: stageObjects,
        };
      })
      .filter((build) => build.jobs && build.jobs.length > 0)
      .sort((a, b) => {
        const aNum = parseInt(a.buildNumber.replace(/\D/g, '')) || 0;
        const bNum = parseInt(b.buildNumber.replace(/\D/g, '')) || 0;
        return bNum - aNum;
      });
  }, [buildsData]);

  // Calculate health metrics
  const healthMetrics = useMemo((): JobHealthMetrics => {
    const consistentFailures: JobHealthMetrics['consistentFailures'] = [];
    const flakySteps: JobHealthMetrics['flakySteps'] = [];
    const longRunningStages: JobHealthMetrics['longRunningStages'] = [];
    const stalledJobs: JobHealthMetrics['stalledJobs'] = [];
    
    // Track job failures across builds
    const jobFailureCounts = new Map<string, { count: number; lastFailure: string; stageName: string }>();
    const jobPassCounts = new Map<string, number>();
    const jobTotalCounts = new Map<string, number>();
    const stageDurations = new Map<string, number[]>();
    
    buildsWithJobs.forEach((build) => {
      build.jobs.forEach((job) => {
        const jobKey = `${job.stageName || 'Unknown'}:${job.name}`;
        const result = (job.result || job.status)?.toLowerCase() || '';
        
        // Track failures
        if (result === 'failed') {
          const existing = jobFailureCounts.get(jobKey) || { count: 0, lastFailure: '', stageName: job.stageName || 'Unknown' };
          existing.count++;
          if (build.finishTime && (!existing.lastFailure || build.finishTime > existing.lastFailure)) {
            existing.lastFailure = build.finishTime;
          }
          jobFailureCounts.set(jobKey, existing);
        }
        
        // Track pass/fail for flaky detection
        if (result === 'succeeded') {
          jobPassCounts.set(jobKey, (jobPassCounts.get(jobKey) || 0) + 1);
        }
        jobTotalCounts.set(jobKey, (jobTotalCounts.get(jobKey) || 0) + 1);
        
        // Track stage durations
        if (job.stageName && job.duration) {
          const durations = stageDurations.get(job.stageName) || [];
          durations.push(job.duration);
          stageDurations.set(job.stageName, durations);
        }
        
        // Detect stalled jobs (running for more than 30 minutes)
        if (job.startTime && !job.finishTime) {
          const duration = Date.now() - new Date(job.startTime).getTime();
          if (duration > 30 * 60 * 1000) {
            stalledJobs.push({
              jobName: job.name,
              stageName: job.stageName || 'Unknown',
              duration: duration,
              status: job.status || 'inProgress',
            });
          }
        }
      });
    });
    
    // Identify consistent failures (failed 3+ times)
    jobFailureCounts.forEach((data, jobKey) => {
      if (data.count >= 3) {
        const [stageName, jobName] = jobKey.split(':');
        consistentFailures.push({
          jobName: jobName,
          stageName: stageName,
          failureCount: data.count,
          lastFailure: data.lastFailure,
        });
      }
    });
    
    // Identify flaky steps (pass rate between 20% and 80%)
    jobTotalCounts.forEach((total, jobKey) => {
      const passed = jobPassCounts.get(jobKey) || 0;
      const passRate = (passed / total) * 100;
      if (passRate >= 20 && passRate <= 80 && total >= 5) {
        const [stageName, jobName] = jobKey.split(':');
        flakySteps.push({
          jobName: jobName,
          stageName: stageName,
          passRate: passRate,
          totalRuns: total,
        });
      }
    });
    
    // Identify long-running stages (average > 10 minutes)
    stageDurations.forEach((durations, stageName) => {
      const avgDuration = durations.reduce((sum, d) => sum + d, 0) / durations.length;
      const maxDuration = Math.max(...durations);
      if (avgDuration > 10 * 60 * 1000) {
        longRunningStages.push({
          stageName: stageName,
          averageDuration: avgDuration,
          maxDuration: maxDuration,
        });
      }
    });
    
    return {
      consistentFailures: consistentFailures.sort((a, b) => b.failureCount - a.failureCount),
      flakySteps: flakySteps.sort((a, b) => Math.abs(50 - a.passRate) - Math.abs(50 - b.passRate)),
      longRunningStages: longRunningStages.sort((a, b) => b.averageDuration - a.averageDuration),
      stalledJobs: stalledJobs.sort((a, b) => b.duration - a.duration),
    };
  }, [buildsWithJobs]);

  const totalJobs = buildsWithJobs.reduce((sum, build) => sum + build.jobs.length, 0);

  // Filter builds based on search query and status
  const filteredBuilds = useMemo(() => {
    let filtered = buildsWithJobs;
    
    // Status filter
    if (statusFilter !== "all") {
      filtered = filtered.filter((build) => {
        if (statusFilter === "succeeded") return build.result === "succeeded";
        if (statusFilter === "failed") return build.result === "failed";
        if (statusFilter === "partiallySucceeded") return build.result === "partiallySucceeded";
        if (statusFilter === "inProgress") return build.status === "inProgress";
        return true;
      });
    }
    
    // Search filter
    const trimmedQuery = searchQuery.trim();
    if (trimmedQuery) {
      const query = trimmedQuery.toLowerCase();
      filtered = filtered.filter((build) => {
        const buildNumberLower = (build.buildNumber || '').toLowerCase();
        const pipelineNameLower = (build.pipelineName || '').toLowerCase();
        
        // Search in build number and pipeline name
        if (buildNumberLower.includes(query) || pipelineNameLower.includes(query)) {
          return true;
        }
        
        // Search in job names (from build.jobs)
        if (build.jobs.some(job => job.name.toLowerCase().includes(query))) {
          return true;
        }
        
        // Search in stage names and jobs within stages
        if (build.stages && build.stages.length > 0) {
          return build.stages.some(stage => {
            const stageNameLower = (stage.name || '').toLowerCase();
            // Check stage name
            if (stageNameLower.includes(query)) {
              return true;
            }
            // Check jobs within the stage
            return stage.jobs.some(job => job.name.toLowerCase().includes(query));
          });
        }
        
        return false;
      });
    }
    
    return filtered;
  }, [buildsWithJobs, searchQuery, statusFilter]);

  const filteredTotalJobs = filteredBuilds.reduce((sum, build) => sum + build.jobs.length, 0);

  // Format date helper
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

  const handleRefresh = async () => {
    await refetchBuilds();
    toast({
      title: "Refreshed",
      description: "Jobs data has been refreshed.",
    });
  };

  // Calculate duration in seconds
  const calculateDuration = (job: Job | Stage): string => {
    if (job.duration !== undefined && job.duration !== null) {
      const seconds = Math.round(job.duration / 1000);
      if (seconds < 60) return `${seconds}s`;
      const minutes = Math.floor(seconds / 60);
      const remainingSeconds = seconds % 60;
      return `${minutes}m ${remainingSeconds}s`;
    }
    if (job.startTime && job.finishTime) {
      const start = new Date(job.startTime).getTime();
      const finish = new Date(job.finishTime).getTime();
      const duration = Math.round((finish - start) / 1000);
      if (duration < 60) return `${duration}s`;
      const minutes = Math.floor(duration / 60);
      const remainingSeconds = duration % 60;
      return `${minutes}m ${remainingSeconds}s`;
    }
    return 'N/A';
  };

  // Get status icon
  const getStatusIcon = (status: string, result?: string) => {
    const normalizedStatus = (status || '').toLowerCase();
    const normalizedResult = (result || '').toLowerCase();
    
    if (normalizedResult === 'succeeded' || normalizedStatus === 'completed') {
      return <CheckCircle2 className="h-4 w-4 text-green-500" />;
    }
    if (normalizedResult === 'failed' || normalizedResult === 'canceled') {
      return <XCircle className="h-4 w-4 text-red-500" />;
    }
    if (normalizedResult === 'partiallysucceeded' || normalizedResult === 'warning') {
      return <AlertCircle className="h-4 w-4 text-yellow-500" />;
    }
    if (normalizedResult === 'skipped' || normalizedStatus === 'skipped') {
      return <SkipForward className="h-4 w-4 text-gray-500" />;
    }
    if (normalizedStatus === 'inprogress' || normalizedStatus === 'in progress') {
      return <Clock className="h-4 w-4 text-blue-500 animate-spin" />;
    }
    return <AlertCircle className="h-4 w-4 text-gray-500" />;
  };

  // Get status color
  const getStatusColor = (status: string, result?: string): string => {
    const normalizedStatus = (status || '').toLowerCase();
    const normalizedResult = (result || '').toLowerCase();
    
    if (normalizedResult === 'succeeded' || normalizedStatus === 'completed') {
      return 'bg-green-500';
    }
    if (normalizedResult === 'failed' || normalizedResult === 'canceled') {
      return 'bg-red-500';
    }
    if (normalizedResult === 'partiallysucceeded' || normalizedResult === 'warning') {
      return 'bg-yellow-500';
    }
    if (normalizedResult === 'skipped' || normalizedStatus === 'skipped') {
      return 'bg-gray-500';
    }
    if (normalizedStatus === 'inprogress' || normalizedStatus === 'in progress') {
      return 'bg-blue-500';
    }
    return 'bg-gray-500';
  };

  // Get status text
  const getStatusText = (status: string, result?: string): string => {
    const normalizedStatus = (status || '').toLowerCase();
    const normalizedResult = (result || '').toLowerCase();
    
    if (normalizedResult === 'succeeded') return 'Success';
    if (normalizedResult === 'failed') return 'Failed';
    if (normalizedResult === 'canceled') return 'Canceled';
    if (normalizedResult === 'partiallysucceeded') return 'Partially Succeeded';
    if (normalizedResult === 'warning') return 'Warning';
    if (normalizedResult === 'skipped' || normalizedStatus === 'skipped') return 'Skipped';
    if (normalizedStatus === 'completed') return 'Completed';
    if (normalizedStatus === 'inprogress' || normalizedStatus === 'in progress') return 'In Progress';
    
    return result || status || 'Unknown';
  };

  // Detect infrastructure/environment failures
  const detectInfrastructureFailure = (job: Job): boolean => {
    const errorMsg = (job.errorMessage || '').toLowerCase();
    const jobName = (job.name || '').toLowerCase();
    
    return errorMsg.includes('timeout') ||
           errorMsg.includes('connection') ||
           errorMsg.includes('network') ||
           errorMsg.includes('agent') ||
           errorMsg.includes('environment') ||
           errorMsg.includes('infrastructure') ||
           jobName.includes('agent') ||
           jobName.includes('environment');
  };

  const toggleStage = (stageId: string) => {
    const newExpanded = new Set(expandedStages);
    if (newExpanded.has(stageId)) {
      newExpanded.delete(stageId);
    } else {
      newExpanded.add(stageId);
    }
    setExpandedStages(newExpanded);
  };

  const toggleJob = (jobId: string) => {
    const newExpanded = new Set(expandedJobs);
    if (newExpanded.has(jobId)) {
      newExpanded.delete(jobId);
    } else {
      newExpanded.add(jobId);
    }
    setExpandedJobs(newExpanded);
  };

  return (
    <GenericModal
      open={open}
      onOpenChange={onClose}
      title="Jobs"
      description="View detailed job-level information, logs, errors, and pipeline health indicators"
      icon={Briefcase}
      iconClassName="bg-gradient-to-br from-blue-500 to-blue-600"
      fullScreen={true}
      contentClassName="space-y-4"
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
            aria-label="Refresh jobs"
          >
            <RefreshCw className={`h-4 w-4 ${fetchingBuilds ? 'animate-spin' : ''}`} />
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
                {isBitbucket ? "No Data Available" : isGitLab ? "No Data Available" : isGithub ? "No Data Available" : "No Data Available"}
              </h3>
              <p className="text-muted-foreground">
                {isBitbucket
                  ? "Please configure Bitbucket repo and/or Bitbucket Pipelines tool integration for this project to view jobs."
                  : isGitLab
                    ? "Please configure GitLab project tool details or Third-Party GitLab settings to view jobs."
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
              <p className="text-muted-foreground">Loading jobs...</p>
            </div>
          </CardContent>
        </Card>
      ) : buildsWithJobs.length === 0 ? (
        <Card className="mt-6">
          <CardContent className="pt-6">
            <div className="text-center space-y-4 py-8">
              <Briefcase className="h-12 w-12 text-muted-foreground mx-auto" />
              <p className="text-muted-foreground">
                No jobs found. Jobs will appear here when pipelines run.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Tabs defaultValue="jobs" className="flex-1 flex flex-col overflow-hidden">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="jobs">Jobs & Logs</TabsTrigger>
            <TabsTrigger value="health">Health Indicators</TabsTrigger>
          </TabsList>

          <ScrollArea className="flex-1 overflow-y-auto mt-4">
            <div className="pr-4 space-y-6">
              {/* Jobs & Logs Tab */}
              <TabsContent value="jobs" className="space-y-6 mt-0">
                {/* Summary Card */}
                {totalJobs > 0 && (
                  <Card>
                    <CardContent className="pt-6">
                      <div className="space-y-4">
                        <div className="flex items-center justify-between gap-4">
                          <div className="flex items-center gap-2">
                            <Briefcase className="h-5 w-5" />
                            <span className="font-semibold">
                              Total: {totalJobs} job{totalJobs !== 1 ? 's' : ''} from {buildsWithJobs.length} build{buildsWithJobs.length !== 1 ? 's' : ''}
                            </span>
                            {searchQuery && (
                              <span className="text-sm text-muted-foreground">
                                (Showing {filteredTotalJobs} job{filteredTotalJobs !== 1 ? 's' : ''} from {filteredBuilds.length} build{filteredBuilds.length !== 1 ? 's' : ''})
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="flex gap-3">
                          <div className="flex-1 relative">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                            <Input
                              type="text"
                              placeholder="Search by build number, pipeline name, or job name..."
                              value={searchQuery}
                              onChange={(e) => setSearchQuery(e.target.value)}
                              className={searchQuery ? "pl-9 pr-8" : "pl-9"}
                            />
                            {searchQuery && (
                              <button
                                onClick={() => setSearchQuery("")}
                                className="absolute right-2 top-1/2 -translate-y-1/2 h-5 w-5 p-0 hover:bg-muted/50 rounded-full flex items-center justify-center transition-colors"
                                type="button"
                                aria-label="Clear search"
                              >
                                <X className="h-3.5 w-3.5 text-muted-foreground" />
                              </button>
                            )}
                          </div>
                          <Select value={statusFilter} onValueChange={setStatusFilter}>
                            <SelectTrigger className="w-[180px]">
                              <Filter className="h-4 w-4 mr-2" />
                              <SelectValue placeholder="Status" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="all">All Status</SelectItem>
                              <SelectItem value="succeeded">Succeeded</SelectItem>
                              <SelectItem value="failed">Failed</SelectItem>
                              <SelectItem value="partiallySucceeded">Partially Succeeded</SelectItem>
                              <SelectItem value="inProgress">In Progress</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                )}

                {/* Builds with Jobs */}
                {filteredBuilds.length === 0 ? (
                  <Card>
                    <CardContent className="pt-6">
                      <div className="text-center space-y-4 py-8">
                        <Search className="h-12 w-12 text-muted-foreground mx-auto" />
                        <p className="text-muted-foreground">
                          No builds found matching your filters
                        </p>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setSearchQuery("");
                            setStatusFilter("all");
                          }}
                        >
                          Clear filters
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                ) : (
                  filteredBuilds.map((build) => {
                    const failedJobs = build.jobs.filter(j => (j.result || j.status)?.toLowerCase() === 'failed');
                    const infrastructureFailures = build.jobs.filter(j => detectInfrastructureFailure(j));
                    
                    return (
                      <Card key={build.id} className="overflow-hidden">
                        {/* Build Header */}
                        <CardHeader className="bg-muted/50 border-b">
                          <div className="flex items-center justify-between gap-4">
                            <div className="flex items-center gap-3 flex-1">
                              <Badge className={`${getStatusColor(build.status, build.result)} text-white`}>
                                {getStatusText(build.status, build.result)}
                              </Badge>
                              <div>
                                <div className="font-semibold text-lg">
                                  {build.pipelineName} - Build #{build.buildNumber}
                                </div>
                                <div className="text-sm text-muted-foreground space-x-4 mt-1">
                                  <span>Branch: {build.sourceBranch?.replace('refs/heads/', '') || 'N/A'}</span>
                                  <span>•</span>
                                  <span>Completed: {formatDate(build.finishTime || build.startTime || '')}</span>
                                  {failedJobs.length > 0 && (
                                    <>
                                      <span>•</span>
                                      <span className="text-red-600 font-semibold">{failedJobs.length} failed job{failedJobs.length !== 1 ? 's' : ''}</span>
                                    </>
                                  )}
                                  {infrastructureFailures.length > 0 && (
                                    <>
                                      <span>•</span>
                                      <span className="text-orange-600 font-semibold">{infrastructureFailures.length} infrastructure failure{infrastructureFailures.length !== 1 ? 's' : ''}</span>
                                    </>
                                  )}
                                </div>
                              </div>
                            </div>
                            <Badge variant="outline" className="text-sm">
                              {build.jobs.length} job{build.jobs.length !== 1 ? 's' : ''}
                            </Badge>
                          </div>
                        </CardHeader>

                        <CardContent className="p-0">
                          {/* Stages with Jobs */}
                          {build.stages && build.stages.length > 0 ? (
                            <div className="divide-y">
                              {build.stages.map((stage) => {
                                const isExpanded = expandedStages.has(stage.id);
                                const stageFailedJobs = stage.jobs.filter(j => (j.result || j.status)?.toLowerCase() === 'failed');
                                
                                return (
                                  <div key={stage.id} className="p-4">
                                    {/* Stage Header */}
                                    <div 
                                      className="flex items-center justify-between cursor-pointer hover:bg-muted/50 p-2 rounded transition-colors"
                                      onClick={() => toggleStage(stage.id)}
                                    >
                                      <div className="flex items-center gap-3 flex-1">
                                        {isExpanded ? (
                                          <ChevronDown className="h-4 w-4 text-muted-foreground" />
                                        ) : (
                                          <ChevronRight className="h-4 w-4 text-muted-foreground" />
                                        )}
                                        {getStatusIcon(stage.status, stage.result)}
                                        <div>
                                          <div className="font-semibold">{stage.name}</div>
                                          <div className="text-sm text-muted-foreground flex items-center gap-4 mt-1">
                                            <span>{stage.jobs.length} job{stage.jobs.length !== 1 ? 's' : ''}</span>
                                            <span>•</span>
                                            <span className="flex items-center gap-1">
                                              <Timer className="h-3 w-3" />
                                              Duration: {calculateDuration(stage)}
                                            </span>
                                            {stageFailedJobs.length > 0 && (
                                              <>
                                                <span>•</span>
                                                <span className="text-red-600">{stageFailedJobs.length} failed</span>
                                              </>
                                            )}
                                          </div>
                                        </div>
                                      </div>
                                      <Badge className={`${getStatusColor(stage.status, stage.result)} text-white text-xs`}>
                                        {getStatusText(stage.status, stage.result)}
                                      </Badge>
                                    </div>

                                    {/* Jobs in Stage */}
                                    {isExpanded && (
                                      <div className="mt-4 ml-7 space-y-2">
                                        {stage.jobs.map((job, index) => {
                                          const isJobExpanded = expandedJobs.has(job.id);
                                          const isInfrastructureFailure = detectInfrastructureFailure(job);
                                          const jobFailed = (job.result || job.status)?.toLowerCase() === 'failed';
                                          
                                          return (
                                            <Card key={job.id || index} className={`border ${jobFailed ? 'border-red-200 bg-red-50 dark:bg-red-950/20' : ''}`}>
                                              <CardContent className="pt-4">
                                                <div className="space-y-3">
                                                  {/* Job Header */}
                                                  <div className="flex items-start justify-between gap-4">
                                                    <div className="flex items-start gap-3 flex-1">
                                                      {getStatusIcon(job.status, job.result)}
                                                      <div className="flex-1">
                                                        <div className="flex items-center gap-2 flex-wrap mb-1">
                                                          <span className="font-medium">{job.name || 'Unnamed Job'}</span>
                                                          <Badge className={`${getStatusColor(job.status, job.result)} text-white text-xs`}>
                                                            {getStatusText(job.status, job.result)}
                                                          </Badge>
                                                          {isInfrastructureFailure && (
                                                            <Badge variant="outline" className="text-xs border-orange-300 text-orange-700">
                                                              Infrastructure Failure
                                                            </Badge>
                                                          )}
                                                          {jobFailed && job.errorMessage && (
                                                            <Badge variant="destructive" className="text-xs">
                                                              Has Error
                                                            </Badge>
                                                          )}
                                                        </div>
                                                        <div className="text-sm text-muted-foreground flex items-center gap-4">
                                                          <span className="flex items-center gap-1">
                                                            <Clock className="h-3 w-3" />
                                                            {calculateDuration(job)}
                                                          </span>
                                                          {job.startTime && (
                                                            <span>Started: {formatDate(job.startTime)}</span>
                                                          )}
                                                        </div>
                                                      </div>
                                                    </div>
                                                    <Button
                                                      variant="ghost"
                                                      size="sm"
                                                      onClick={(e) => {
                                                        e.preventDefault();
                                                        e.stopPropagation();
                                                        
                                                        // Capture the specific job and build for this click
                                                        const clickedJob = job;
                                                        const clickedBuild = build;
                                                        
                                                        console.log('[JobsModal] View Logs clicked:', {
                                                          jobName: clickedJob.name,
                                                          jobId: clickedJob.id,
                                                          buildId: clickedBuild.id,
                                                          logUrl: clickedJob.logUrl
                                                        });
                                                        
                                                        // If job has a logUrl, open it directly
                                                        if (clickedJob.logUrl) {
                                                          console.log('[JobsModal] Opening logUrl:', clickedJob.logUrl);
                                                          window.open(clickedJob.logUrl, '_blank');
                                                          return;
                                                        }
                                                        
                                                        // Otherwise, construct Azure DevOps log URL with specific job timeline ID
                                                        const org = adoProject?.organization || '';
                                                        const project = adoProject?.name || '';
                                                        if (org && project && clickedBuild.id && clickedJob.id) {
                                                          const logUrl = `https://dev.azure.com/${encodeURIComponent(org)}/${encodeURIComponent(project)}/_build/results?buildId=${clickedBuild.id}&view=logs&timelineId=${encodeURIComponent(clickedJob.id)}`;
                                                          console.log('[JobsModal] Constructed log URL:', logUrl);
                                                          window.open(logUrl, '_blank');
                                                        }
                                                      }}
                                                    >
                                                      <ExternalLink className="h-4 w-4 mr-1" />
                                                      View Logs
                                                    </Button>
                                                  </div>

                                                  {/* Error Message */}
                                                  {jobFailed && job.errorMessage && (
                                                    <div className="mt-2 p-3 bg-red-50 dark:bg-red-950/20 border border-red-200 rounded">
                                                      <div className="flex items-start gap-2">
                                                        <XCircle className="h-4 w-4 text-red-600 mt-0.5 flex-shrink-0" />
                                                        <div className="flex-1">
                                                          <div className="font-semibold text-sm text-red-700 dark:text-red-400 mb-1">Error Message:</div>
                                                          <pre className="text-xs text-red-600 dark:text-red-300 whitespace-pre-wrap break-words">
                                                            {job.errorMessage}
                                                          </pre>
                                                        </div>
                                                      </div>
                                                    </div>
                                                  )}

                                                  {/* Issues */}
                                                  {job.issues && job.issues.length > 0 && (
                                                    <div className="mt-2 space-y-2">
                                                      {job.issues.map((issue, idx) => (
                                                        <div key={idx} className="p-2 bg-yellow-50 dark:bg-yellow-950/20 border border-yellow-200 rounded text-sm">
                                                          <div className="font-semibold text-yellow-700 dark:text-yellow-400">
                                                            {issue.category}: {issue.type}
                                                          </div>
                                                          <div className="text-yellow-600 dark:text-yellow-300 mt-1">
                                                            {issue.message}
                                                          </div>
                                                        </div>
                                                      ))}
                                                    </div>
                                                  )}

                                                  {/* Step-by-step Logs */}
                                                  {isJobExpanded && (
                                                    <div className="mt-3 pt-3 border-t">
                                                      <div className="flex items-center justify-between mb-2">
                                                        <div className="flex items-center gap-2">
                                                          <FileText className="h-4 w-4 text-muted-foreground" />
                                                          <span className="font-semibold text-sm">Step-by-Step Logs</span>
                                                        </div>
                                                        <Button
                                                          variant="ghost"
                                                          size="sm"
                                                          onClick={() => toggleJob(job.id)}
                                                        >
                                                          Collapse
                                                        </Button>
                                                      </div>
                                                      {loadingLogs ? (
                                                        <div className="text-center py-4">
                                                          <Loader2 className="h-5 w-5 animate-spin mx-auto mb-2 text-muted-foreground" />
                                                          <p className="text-sm text-muted-foreground">Loading logs...</p>
                                                        </div>
                                                      ) : jobLogsData?.log ? (
                                                        <ScrollArea className="h-[300px] w-full border rounded bg-muted/30 p-3">
                                                          <pre className="text-xs font-mono whitespace-pre-wrap break-words">
                                                            {jobLogsData.log}
                                                          </pre>
                                                        </ScrollArea>
                                                      ) : (
                                                        <div className="text-sm text-muted-foreground p-4 border rounded bg-muted/30">
                                                          <p>Logs are not available for this job. Click "View Logs" to open in Azure DevOps.</p>
                                                          {job.logUrl && (
                                                            <Button
                                                              variant="outline"
                                                              size="sm"
                                                              className="mt-2"
                                                              onClick={() => window.open(job.logUrl, '_blank')}
                                                            >
                                                              <ExternalLink className="h-4 w-4 mr-1" />
                                                              View Logs in Azure DevOps
                                                            </Button>
                                                          )}
                                                        </div>
                                                      )}
                                                    </div>
                                                  )}

                                                  {/* Expand/Collapse Logs Button */}
                                                  {!isJobExpanded && (
                                                    <Button
                                                      variant="ghost"
                                                      size="sm"
                                                      onClick={(e) => {
                                                        e.preventDefault();
                                                        e.stopPropagation();
                                                        
                                                        // Capture the specific job and build for this click
                                                        const clickedJob = job;
                                                        const clickedBuild = build;
                                                        
                                                        console.log('[JobsModal] View Step-by-Step Logs clicked:', {
                                                          jobName: clickedJob.name,
                                                          jobId: clickedJob.id,
                                                          buildId: clickedBuild.id,
                                                          logUrl: clickedJob.logUrl
                                                        });
                                                        
                                                        // If job has a logUrl, open it directly
                                                        if (clickedJob.logUrl) {
                                                          console.log('[JobsModal] Opening logUrl:', clickedJob.logUrl);
                                                          window.open(clickedJob.logUrl, '_blank');
                                                          return;
                                                        }
                                                        
                                                        // Otherwise, construct Azure DevOps log URL with specific job timeline ID
                                                        const org = adoProject?.organization || '';
                                                        const project = adoProject?.name || '';
                                                        if (org && project && clickedBuild.id && clickedJob.id) {
                                                          // Construct the Azure DevOps log URL with timeline ID to show specific job logs
                                                          // Format: https://dev.azure.com/{org}/{project}/_build/results?buildId={buildId}&view=logs&timelineId={timelineId}
                                                          const logUrl = `https://dev.azure.com/${encodeURIComponent(org)}/${encodeURIComponent(project)}/_build/results?buildId=${clickedBuild.id}&view=logs&timelineId=${encodeURIComponent(clickedJob.id)}`;
                                                          console.log('[JobsModal] Constructed log URL:', logUrl);
                                                          window.open(logUrl, '_blank');
                                                        } else {
                                                          console.warn('[JobsModal] Missing required info for log URL:', { org, project, buildId: clickedBuild.id, jobId: clickedJob.id });
                                                          // Fallback: expand to show message
                                                          toggleJob(clickedJob.id);
                                                          setSelectedBuildId(clickedBuild.id);
                                                          setSelectedJobId(clickedJob.id);
                                                        }
                                                      }}
                                                      className="mt-2"
                                                    >
                                                      <FileText className="h-4 w-4 mr-1" />
                                                      View Step-by-Step Logs
                                                    </Button>
                                                  )}
                                                </div>
                                              </CardContent>
                                            </Card>
                                          );
                                        })}
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          ) : (
                            /* Fallback: Show jobs in table if stages not available */
                            <div className="overflow-x-auto p-4">
                              <table className="w-full">
                                <thead>
                                  <tr className="border-b bg-muted/30">
                                    <th className="text-left p-4 font-semibold text-sm">Name</th>
                                    <th className="text-left p-4 font-semibold text-sm">Status</th>
                                    <th className="text-left p-4 font-semibold text-sm">Duration</th>
                                    <th className="text-left p-4 font-semibold text-sm">Actions</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {build.jobs.map((job, index) => {
                                    const jobFailed = (job.result || job.status)?.toLowerCase() === 'failed';
                                    const isInfrastructureFailure = detectInfrastructureFailure(job);
                                    
                                    return (
                                      <tr key={`${build.id}-${job.id || index}`} className={`border-b hover:bg-muted/30 transition-colors ${jobFailed ? 'bg-red-50 dark:bg-red-950/20' : ''}`}>
                                        <td className="p-4">
                                          <div className="flex items-center gap-2">
                                            {getStatusIcon(job.status, job.result)}
                                            <span className="font-medium text-sm">{job.name || 'Unnamed Job'}</span>
                                            {isInfrastructureFailure && (
                                              <Badge variant="outline" className="text-xs border-orange-300 text-orange-700">
                                                Infrastructure
                                              </Badge>
                                            )}
                                          </div>
                                        </td>
                                        <td className="p-4">
                                          <Badge className={`${getStatusColor(job.status, job.result)} text-white text-xs`}>
                                            {getStatusText(job.status, job.result)}
                                          </Badge>
                                        </td>
                                        <td className="p-4">
                                          <div className="flex items-center gap-1 text-sm text-muted-foreground">
                                            <Clock className="h-3 w-3" />
                                            {calculateDuration(job)}
                                          </div>
                                        </td>
                                        <td className="p-4">
                                          <div className="flex items-center gap-2">
                                            {jobFailed && job.errorMessage && (
                                              <Button
                                                variant="ghost"
                                                size="sm"
                                                onClick={() => {
                                                  setSelectedBuildId(build.id);
                                                  setSelectedJobId(job.id);
                                                  toggleJob(job.id);
                                                }}
                                              >
                                                <AlertTriangle className="h-4 w-4 mr-1" />
                                                View Error
                                              </Button>
                                            )}
                                            <Button
                                              variant="ghost"
                                              size="sm"
                                              onClick={(e) => {
                                                e.preventDefault();
                                                e.stopPropagation();
                                                
                                                // Capture the specific job and build for this click
                                                const clickedJob = job;
                                                const clickedBuild = build;
                                                
                                                console.log('[JobsModal] Logs button clicked (table view):', {
                                                  jobName: clickedJob.name,
                                                  jobId: clickedJob.id,
                                                  buildId: clickedBuild.id,
                                                  logUrl: clickedJob.logUrl
                                                });
                                                
                                                // If job has a logUrl, open it directly
                                                if (clickedJob.logUrl) {
                                                  console.log('[JobsModal] Opening logUrl:', clickedJob.logUrl);
                                                  window.open(clickedJob.logUrl, '_blank');
                                                  return;
                                                }
                                                
                                                // Otherwise, construct Azure DevOps log URL with specific job timeline ID
                                                const org = adoProject?.organization || '';
                                                const project = adoProject?.name || '';
                                                if (org && project && clickedBuild.id && clickedJob.id) {
                                                  const logUrl = `https://dev.azure.com/${encodeURIComponent(org)}/${encodeURIComponent(project)}/_build/results?buildId=${clickedBuild.id}&view=logs&timelineId=${encodeURIComponent(clickedJob.id)}`;
                                                  console.log('[JobsModal] Constructed log URL:', logUrl);
                                                  window.open(logUrl, '_blank');
                                                }
                                              }}
                                            >
                                              <ExternalLink className="h-4 w-4 mr-1" />
                                              Logs
                                            </Button>
                                          </div>
                                        </td>
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                            </div>
                          )}
                        </CardContent>
                      </Card>
                    );
                  })
                )}
              </TabsContent>

              {/* Health Indicators Tab */}
              <TabsContent value="health" className="space-y-6 mt-0">
                {/* Consistent Failures */}
                {healthMetrics.consistentFailures.length > 0 && (
                  <Card className="border-red-200 bg-red-50 dark:bg-red-950/20">
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2 text-red-700 dark:text-red-400">
                        <TrendingDown className="h-5 w-5" />
                        Consistent Failures
                      </CardTitle>
                      <CardDescription>
                        Jobs that have failed 3 or more times across builds
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-3">
                        {healthMetrics.consistentFailures.map((failure, idx) => (
                          <div key={idx} className="p-3 border border-red-200 rounded-lg bg-white dark:bg-gray-900">
                            <div className="flex items-center justify-between mb-2">
                              <div>
                                <div className="font-semibold">{failure.jobName}</div>
                                <div className="text-sm text-muted-foreground">Stage: {failure.stageName}</div>
                              </div>
                              <Badge variant="destructive">
                                {failure.failureCount} failures
                              </Badge>
                            </div>
                            <div className="text-xs text-muted-foreground">
                              Last failure: {formatDate(failure.lastFailure)}
                            </div>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                )}

                {/* Flaky Steps */}
                {healthMetrics.flakySteps.length > 0 && (
                  <Card className="border-yellow-200 bg-yellow-50 dark:bg-yellow-950/20">
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2 text-yellow-700 dark:text-yellow-400">
                        <Activity className="h-5 w-5" />
                        Flaky Steps
                      </CardTitle>
                      <CardDescription>
                        Jobs with inconsistent pass/fail rates (20-80% pass rate, 5+ runs)
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-3">
                        {healthMetrics.flakySteps.map((step, idx) => (
                          <div key={idx} className="p-3 border border-yellow-200 rounded-lg bg-white dark:bg-gray-900">
                            <div className="flex items-center justify-between mb-2">
                              <div>
                                <div className="font-semibold">{step.jobName}</div>
                                <div className="text-sm text-muted-foreground">Stage: {step.stageName}</div>
                              </div>
                              <Badge variant="outline" className="border-yellow-300 text-yellow-700">
                                {Math.round(step.passRate)}% pass rate
                              </Badge>
                            </div>
                            <div className="text-xs text-muted-foreground">
                              {step.totalRuns} total runs
                            </div>
                            <div className="mt-2 w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                              <div
                                className="bg-yellow-500 h-2 rounded-full transition-all"
                                style={{ width: `${step.passRate}%` }}
                              />
                            </div>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                )}

                {/* Long-Running Stages */}
                {healthMetrics.longRunningStages.length > 0 && (
                  <Card className="border-orange-200 bg-orange-50 dark:bg-orange-950/20">
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2 text-orange-700 dark:text-orange-400">
                        <Timer className="h-5 w-5" />
                        Long-Running Stages
                      </CardTitle>
                      <CardDescription>
                        Stages with average duration exceeding 10 minutes
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-3">
                        {healthMetrics.longRunningStages.map((stage, idx) => (
                          <div key={idx} className="p-3 border border-orange-200 rounded-lg bg-white dark:bg-gray-900">
                            <div className="flex items-center justify-between mb-2">
                              <div className="font-semibold">{stage.stageName}</div>
                              <Badge variant="outline" className="border-orange-300 text-orange-700">
                                Avg: {Math.round(stage.averageDuration / 1000 / 60)}m
                              </Badge>
                            </div>
                            <div className="text-sm text-muted-foreground">
                              Max duration: {Math.round(stage.maxDuration / 1000 / 60)}m {Math.round((stage.maxDuration / 1000) % 60)}s
                            </div>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                )}

                {/* Stalled or Timed Out Jobs */}
                {healthMetrics.stalledJobs.length > 0 && (
                  <Card className="border-red-200 bg-red-50 dark:bg-red-950/20">
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2 text-red-700 dark:text-red-400">
                        <AlertTriangle className="h-5 w-5" />
                        Stalled or Timed Out Jobs
                      </CardTitle>
                      <CardDescription>
                        Jobs that have been running for more than 30 minutes
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-3">
                        {healthMetrics.stalledJobs.map((job, idx) => (
                          <div key={idx} className="p-3 border border-red-200 rounded-lg bg-white dark:bg-gray-900">
                            <div className="flex items-center justify-between mb-2">
                              <div>
                                <div className="font-semibold">{job.jobName}</div>
                                <div className="text-sm text-muted-foreground">Stage: {job.stageName}</div>
                              </div>
                              <Badge variant="destructive">
                                {Math.round(job.duration / 1000 / 60)}m running
                              </Badge>
                            </div>
                            <div className="text-xs text-muted-foreground">
                              Status: {job.status}
                            </div>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                )}

                {/* No Health Issues */}
                {healthMetrics.consistentFailures.length === 0 &&
                 healthMetrics.flakySteps.length === 0 &&
                 healthMetrics.longRunningStages.length === 0 &&
                 healthMetrics.stalledJobs.length === 0 && (
                  <Card>
                    <CardContent className="pt-6">
                      <div className="text-center space-y-4 py-8">
                        <CheckCircle2 className="h-12 w-12 text-green-600 mx-auto" />
                        <p className="text-muted-foreground">
                          No health issues detected. All jobs are running normally.
                        </p>
                      </div>
                    </CardContent>
                  </Card>
                )}
              </TabsContent>
            </div>
          </ScrollArea>
        </Tabs>
      )}
    </GenericModal>
  );
}



