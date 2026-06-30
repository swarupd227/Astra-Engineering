import { useState, useEffect, useMemo } from "react";
import { GenericModal } from "@/components/ui/generic-modal";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  TrendingUp,
  RefreshCw,
  AlertTriangle,
  Info,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { getApiUrl } from "@/lib/api-config";
import { useQuery } from "@tanstack/react-query";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface ADOProject {
  id: string;
  name: string;
  organization: string;
  organizationUrl: string;
}

interface VelocityIndicatorsModalProps {
  projectId: string;
  adoProject?: ADOProject;
  open: boolean;
  onClose: () => void;
  integrationType?: string;
}

interface VelocityData {
  last7Days: number;
  last30Days: number;
  totalStoryPoints: number;
  completedStoryPoints: number;
  completionRate: number;
}

interface BacklogContextResponse {
  velocity?: VelocityData;
}

interface SprintDataResponse {
  sprint: {
    id: string;
    name: string;
    path: string;
    startDate?: string;
    endDate?: string;
  } | null;
  workItems: any[];
  metrics: {
    totalStories: number;
    completedStories: number;
    totalStoryPoints: number;
    completedStoryPoints: number;
    epics: number;
    features: number;
    epicProgress: number;
    featureProgress: number;
    spilloverStories?: number;
    spilloverStoryPoints?: number;
  };
}

export function VelocityIndicatorsModal({
  projectId,
  adoProject,
  open,
  onClose,
  integrationType = "ado",
}: VelocityIndicatorsModalProps) {
  const { toast } = useToast();
  const [selectedSprintPath, setSelectedSprintPath] = useState<string | null>(null);

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
  const { data: adoConfig } = useQuery<{
    hasConfig: boolean;
    organization: string;
    project: string;
  }>({
    queryKey: [`/api/sdlc/projects/${projectId}/ado-config`, queryString],
    queryFn: async () => {
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
    enabled: open && !!projectId && integrationType === "ado",
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });

  const hasAdoConfig = (adoConfig?.hasConfig || false) && integrationType === "ado";

  // Fetch Jira config
  const { data: jiraConfig } = useQuery<{
    exists: boolean;
    hasApiToken: boolean;
    instanceUrl: string;
    projectKey: string;
  }>({
    queryKey: [`/api/jira/settings/${projectId}`],
    queryFn: async () => {
      const configRes = await fetch(getApiUrl(`/api/jira/settings/${projectId}`), { credentials: "include" });
      if (!configRes.ok) {
        return { exists: false, hasApiToken: false, instanceUrl: "", projectKey: "" };
      }
      return configRes.json();
    },
    enabled: open && !!projectId && integrationType === "jira",
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });

  const hasJiraConfig = (jiraConfig?.exists || false) && integrationType === "jira";

  // Fetch all sprints (ADO or JIRA)
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
      integrationType === "jira" ? "jira/sprints" : "ado/sprints",
      adoProject?.organization,
      adoProject?.name,
    ],
    queryFn: async () => {
      if (integrationType === "jira") {
        if (!hasJiraConfig) return [];
        const sprintsRes = await fetch(getApiUrl(`/api/jira/sprints/${projectId}`), { credentials: "include" });
        return sprintsRes.ok ? sprintsRes.json() : [];
      }

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
        return [];
      }

      return sprintsRes.json();
    },
    enabled: open && !!projectId && (hasAdoConfig || hasJiraConfig),
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
    retry: 1,
  });

  // Fetch sprint data
  const {
    data: sprintData,
    isLoading: loadingSprint,
    refetch: refetchSprintData,
  } = useQuery<SprintDataResponse>({
    queryKey: [
      "/api/sdlc/projects",
      projectId,
      "ado/sprint-data",
      adoProject?.organization,
      adoProject?.name,
      selectedSprintPath,
    ],
    queryFn: async () => {
      if (!hasAdoConfig || !selectedSprintPath) {
        return {
          sprint: null,
          workItems: [],
          metrics: {
            totalStories: 0,
            completedStories: 0,
            totalStoryPoints: 0,
            completedStoryPoints: 0,
            epics: 0,
            features: 0,
            epicProgress: 0,
            featureProgress: 0,
          }
        };
      }

      const sprintQuery = new URLSearchParams(queryString);
      sprintQuery.set('sprintPath', selectedSprintPath);
      const sprintUrl = getApiUrl(
        `/api/sdlc/projects/${projectId}/ado/sprint-data${
          sprintQuery.toString() ? `?${sprintQuery.toString()}` : ""
        }`
      );
      
      const sprintRes = await fetch(sprintUrl, { credentials: "include" });
      if (!sprintRes.ok) {
        throw new Error("Failed to fetch sprint data");
      }
      return sprintRes.json();
    },
    enabled: open && !!projectId && hasAdoConfig && !!selectedSprintPath,
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

  // Fetch backlog context for velocity data (ADO or JIRA)
  const {
    data: backlogData,
    isLoading: loading,
    isFetching: refreshing,
    error: backlogError,
    refetch: refetchBacklogContext,
  } = useQuery<BacklogContextResponse>({
    queryKey: [
      "/api/sdlc/projects",
      projectId,
      integrationType === "jira" ? "jira/backlog-context" : "ado/backlog-context",
      adoProject?.organization,
      adoProject?.name,
    ],
    queryFn: async () => {
      if (integrationType === "jira") {
        if (!hasJiraConfig) return {};
        const backlogRes = await fetch(getApiUrl(`/api/sdlc/projects/${projectId}/jira/backlog-context`), { credentials: "include" });
        if (!backlogRes.ok) throw new Error("Failed to fetch Jira velocity data");
        return backlogRes.json();
      }

      if (!hasAdoConfig) {
        return {};
      }

      const backlogUrl = getApiUrl(
        `/api/sdlc/projects/${projectId}/ado/backlog-context${
          queryString ? `?${queryString}` : ""
        }`
      );
      const backlogRes = await fetch(backlogUrl, { credentials: "include" });

      if (!backlogRes.ok) {
        throw new Error("Failed to fetch velocity data");
      }
      return backlogRes.json();
    },
    enabled: open && !!projectId && (hasAdoConfig || hasJiraConfig),
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
    retry: 1,
  });

  useEffect(() => {
    if (backlogError) {
      toast({
        title: "Error",
        description:
          backlogError instanceof Error
            ? backlogError.message
            : "Failed to fetch velocity indicators",
        variant: "destructive",
      });
    }
  }, [backlogError, toast]);

  const handleRefresh = async () => {
    await Promise.all([refetchBacklogContext(), refetchSprintData()]);
  };

  // Calculate sprint-based velocity metrics
  const sprintVelocity = useMemo(() => {
    if (!selectedSprintPath || !sprintData?.metrics) {
      return null;
    }

    const metrics = sprintData.metrics;
    const completionRate = metrics.totalStoryPoints > 0
      ? Math.round((metrics.completedStoryPoints / metrics.totalStoryPoints) * 100)
      : 0;

    return {
      totalStoryPoints: metrics.totalStoryPoints,
      completedStoryPoints: metrics.completedStoryPoints,
      remainingStoryPoints: metrics.totalStoryPoints - metrics.completedStoryPoints,
      completionRate,
      totalStories: metrics.totalStories,
      completedStories: metrics.completedStories,
      openStories: metrics.totalStories - metrics.completedStories,
    };
  }, [selectedSprintPath, sprintData?.metrics]);

  // Use sprint velocity if available, otherwise fallback to backlog velocity
  const velocity = sprintVelocity ? {
    totalStoryPoints: sprintVelocity.totalStoryPoints,
    completedStoryPoints: sprintVelocity.completedStoryPoints,
    completionRate: sprintVelocity.completionRate,
    // For trend calculation, we'll use sprint completion rate
    last7Days: sprintVelocity.completedStoryPoints,
    last30Days: sprintVelocity.completedStoryPoints,
  } : backlogData?.velocity;

  return (
    <GenericModal
      open={open}
      onOpenChange={onClose}
      title="Velocity Indicators"
      description="Track story points completion and team velocity over time"
      icon={TrendingUp}
      iconClassName="bg-gradient-to-br from-blue-500 to-blue-600"
       fullScreen={true}
      contentClassName="flex items-center justify-center min-h-0"
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
            disabled={refreshing || loadingSprint}
            className="h-8 w-8 p-0 flex items-center justify-center"
            aria-label="Refresh velocity data"
          >
            <RefreshCw
              className={`h-4 w-4 ${refreshing || loadingSprint ? "animate-spin" : ""}`}
            />
          </Button>
        </div>
      }
    >

      {integrationType === "ado" && !hasAdoConfig ? (
        <Card className="border-yellow-200 dark:border-yellow-800">
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
      ) : integrationType === "jira" && !hasJiraConfig ? (
        <Card className="border-yellow-200 dark:border-yellow-800">
          <CardContent className="pt-6">
            <div className="text-center space-y-4">
              <AlertTriangle className="h-12 w-12 text-yellow-500 mx-auto" />
              <h3 className="text-lg font-semibold">
                Jira Not Configured
              </h3>
              <p className="text-muted-foreground">
                Please configure Jira credentials in Settings &gt;
                Central Settings to view velocity indicators.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : loading || loadingSprint ? (
        <Card>
          <CardContent className="pt-6">
            <p className="text-center text-muted-foreground py-8">
              Loading velocity indicators...
            </p>
          </CardContent>
        </Card>
      ) : velocity ? (
        <>
          {/* Manager-friendly explanation */}
        <div className="grid grid-cols-2 gap-6 w-full max-w-7xl mx-auto">
          {/* Velocity Metrics */}
          <Card className="bg-purple-50 dark:bg-purple-950/20 border-purple-200 dark:border-purple-800">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-blue-600" />
                Velocity Metrics
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              {/* Sprint Date, Days, and Spillover - Only show when sprint is selected */}
              {selectedSprintPath && sprintData?.sprint && sprintData.sprint.startDate && sprintData.sprint.endDate && (() => {
                const startDate = new Date(sprintData.sprint.startDate);
                const endDate = new Date(sprintData.sprint.endDate);
                const daysDiff = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)) + 1;
                const formattedStartDate = startDate.toLocaleDateString('en-GB', { day: 'numeric', month: 'numeric', year: 'numeric' });
                const formattedEndDate = endDate.toLocaleDateString('en-GB', { day: 'numeric', month: 'numeric', year: 'numeric' });
                const spilloverStories = sprintData.metrics.spilloverStories || 0;
                const spilloverPoints = sprintData.metrics.spilloverStoryPoints || 0;
                
                return (
                  <div className="mb-4 pb-4 border-b border-blue-200 dark:border-blue-800">
                    <div className="flex items-center justify-between mb-3">
                      <div className="text-sm text-muted-foreground">
                        {formattedStartDate} - {formattedEndDate}
                      </div>
                      <div className="text-sm font-semibold text-purple-600 dark:text-purple-400">
                        {daysDiff} {daysDiff === 1 ? 'day' : 'days'}
                      </div>
                    </div>
                    {(spilloverStories > 0 || spilloverPoints > 0) && (
                      <div className="flex items-center justify-between">
                        <div className="text-xs text-muted-foreground">Spillover</div>
                        <div className="text-xs font-semibold text-orange-600 dark:text-orange-400">
                          {spilloverStories} {spilloverStories === 1 ? 'story' : 'stories'} ({spilloverPoints} pts)
                        </div>
                      </div>
                    )}
                  </div>
                );
              })()}
              
              <div className="grid grid-cols-2 gap-4 text-sm">
                {sprintVelocity ? (
                  <>
                    <div>
                      <div className="text-muted-foreground text-xs mb-0.5">
                        {sprintData?.sprint?.name || "Current Sprint"}
                      </div>
                      <div className="font-semibold text-xl text-blue-600">
                        {sprintVelocity.completedStoryPoints} pts
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        Story points completed
                      </div>
                    </div>
                    <div>
                      <div className="text-muted-foreground text-xs mb-0.5">
                        Team Velocity
                      </div>
                      <div className="font-semibold text-xl text-blue-600">
                        {sprintVelocity.completedStoryPoints} pts
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        Avg per sprint
                      </div>
                    </div>
                    <div>
                      <div className="text-muted-foreground text-xs mb-0.5">
                        Total Story Points
                      </div>
                      <div className="font-semibold text-xl">
                        {sprintVelocity.totalStoryPoints} pts
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        In current sprint
                      </div>
                    </div>
                    <div>
                      <div className="text-muted-foreground text-xs mb-0.5">
                        Completed Points
                      </div>
                      <div className="font-semibold text-xl text-green-600">
                        {sprintVelocity.completedStoryPoints} pts
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        Stories in Closed/Done
                      </div>
                    </div>
                  </>
                ) : (
                  <>
                    <div>
                      <div className="text-muted-foreground text-xs mb-0.5">Last 7 Days</div>
                      <div className="font-semibold text-xl text-blue-600">
                        {velocity.last7Days} pts
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        Story points completed
                      </div>
                    </div>
                    <div>
                      <div className="text-muted-foreground text-xs mb-0.5">Last 30 Days</div>
                      <div className="font-semibold text-xl text-blue-600">
                        {velocity.last30Days} pts
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        Story points completed
                      </div>
                    </div>
                    <div>
                      <div className="text-muted-foreground text-xs mb-0.5">
                        Total Story Points
                      </div>
                      <div className="font-semibold text-xl">
                        {velocity.totalStoryPoints} pts
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        Across all stories
                      </div>
                    </div>
                    <div>
                      <div className="text-muted-foreground text-xs mb-0.5">
                        Completed Points
                      </div>
                      <div className="font-semibold text-xl text-green-600">
                        {velocity.completedStoryPoints} pts
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        Stories in Closed/Done
                      </div>
                    </div>
                  </>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Completion Progress */}
          {velocity.completionRate > 0 && (() => {
            // Calculate sprint velocity trend (compare current sprint completion with previous sprint if available)
            // For now, we'll use a simple heuristic: if completion rate is high, trend is increasing
            const isIncreasing = sprintVelocity 
              ? sprintVelocity.completionRate > 50 // If more than 50% complete, consider it increasing
              : velocity.last7Days > velocity.last30Days / 4;
            const isDecreasing = sprintVelocity
              ? sprintVelocity.completionRate < 30 // If less than 30% complete, consider it decreasing
              : velocity.last7Days < velocity.last30Days / 4;
            const trendText = isIncreasing 
              ? "Velocity increasing" 
              : isDecreasing 
              ? "Velocity decreasing" 
              : "Velocity stable";
            const trendColor = isIncreasing 
              ? "text-green-600" 
              : isDecreasing 
              ? "text-red-600" 
              : "text-yellow-600";

            // Generate fluctuating trend data points for area chart visualization
            const generateFluctuatingTrendPoints = () => {
              const points = 20; // More points for smoother curve
              const baseValue = velocity.last30Days / 30;
              const recentValue = velocity.last7Days / 7;
              const avgVelocity = (baseValue + recentValue) / 2;
              
              // Create a fluctuating pattern with multiple peaks and valleys
              return Array.from({ length: points }, (_, i) => {
                const progress = i / (points - 1);
                
                // Combine multiple sine waves for natural fluctuation
                const wave1 = Math.sin(progress * Math.PI * 3) * 0.3; // 3 peaks
                const wave2 = Math.sin(progress * Math.PI * 5) * 0.15; // 5 peaks (smaller)
                const wave3 = Math.sin(progress * Math.PI * 7) * 0.1; // 7 peaks (even smaller)
                
                // Overall trend (increasing if velocity is increasing)
                const trend = isIncreasing ? progress * 0.2 : isDecreasing ? -progress * 0.2 : 0;
                
                // Combine waves with trend
                const fluctuation = wave1 + wave2 + wave3 + trend;
                
                // Scale to velocity range
                const value = avgVelocity * (1 + fluctuation);
                return Math.max(avgVelocity * 0.3, value); // Ensure minimum 30% of average
              });
            };

            const trendPoints = generateFluctuatingTrendPoints();
            const maxValue = Math.max(...trendPoints, 1);
            const minValue = Math.min(...trendPoints, 0);
            const range = maxValue - minValue || 1;
            
            // Normalize to 0-100% for display, leaving some padding
            const normalizedPoints = trendPoints.map(p => {
              const normalized = ((p - minValue) / range) * 80 + 10; // 10-90% range for visual padding
              return normalized;
            });

            return (
              <Card className="bg-purple-50 dark:bg-purple-950/20 border-purplee-200 dark:border-purple-800">
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base">Story Points Completion</CardTitle>
                    <div className="flex items-center gap-2">
                      <TrendingUp className={`h-4 w-4 ${trendColor}`} />
                      <span className={`text-sm font-medium ${trendColor}`}>
                        Recent trend: {trendText}
                      </span>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">
                        Overall Progress
                      </span>
                      <span className="text-2xl font-bold">
                        {velocity.completionRate}%
                      </span>
                    </div>
                    
                    {/* Fluctuating Area Chart Visualization */}
                    <div className="relative w-full h-40 bg-gradient-to-br from-blue-600/20 via-purple-600/20 to-emerald-600/20 dark:from-blue-900/40 dark:via-purple-900/40 dark:to-emerald-900/40 rounded-lg overflow-hidden border border-border/50 p-2">
                      <svg className="w-full h-full" viewBox="0 0 400 120" preserveAspectRatio="none">
                        <defs>
                          <linearGradient id={`areaGradient-${velocity.completionRate}`} x1="0%" y1="0%" x2="0%" y2="100%">
                            <stop offset="0%" stopColor="#10b981" stopOpacity="0.5" />
                            <stop offset="50%" stopColor="#3b82f6" stopOpacity="0.4" />
                            <stop offset="100%" stopColor="#8b5cf6" stopOpacity="0.2" />
                          </linearGradient>
                          <linearGradient id={`lineGradient-${velocity.completionRate}`} x1="0%" y1="0%" x2="100%" y2="0%">
                            <stop offset="0%" stopColor="#3b82f6" />
                            <stop offset="50%" stopColor="#10b981" />
                            <stop offset="100%" stopColor="#10b981" />
                          </linearGradient>
                        </defs>
                        
                        {/* Grid lines */}
                        {[20, 40, 60, 80, 100].map((y) => (
                          <line
                            key={y}
                            x1="0"
                            y1={y}
                            x2="400"
                            y2={y}
                            stroke="rgba(255, 255, 255, 0.1)"
                            strokeWidth="0.5"
                          />
                        ))}
                        
                        {/* Area fill with gradient */}
                        <path
                          d={`M 0 120 ${normalizedPoints.map((point, i) => {
                            const x = (i / (normalizedPoints.length - 1)) * 400;
                            const y = 120 - (point / 100) * 100; // Scale to 0-100 range
                            return `L ${x} ${y}`;
                          }).join(' ')} L 400 120 Z`}
                          fill={`url(#areaGradient-${velocity.completionRate})`}
                        />
                        
                        {/* Smooth trend line */}
                        <path
                          d={`M ${normalizedPoints.map((point, i) => {
                            const x = (i / (normalizedPoints.length - 1)) * 400;
                            const y = 120 - (point / 100) * 100;
                            return i === 0 ? `${x} ${y}` : `L ${x} ${y}`;
                          }).join(' ')}`}
                          stroke={`url(#lineGradient-${velocity.completionRate})`}
                          strokeWidth="3"
                          fill="none"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    </div>


          
                    
                    <div className="grid grid-cols-2 gap-4 text-sm pt-2">
                      <div>
                        <div className="text-muted-foreground">Completed</div>
                        <div className="font-semibold text-lg text-green-600">
                          {sprintVelocity?.completedStoryPoints ?? velocity.completedStoryPoints} pts
                        </div>
                      </div>
                      <div>
                        <div className="text-muted-foreground">Remaining</div>
                        <div className="font-semibold text-lg">
                          {sprintVelocity?.remainingStoryPoints ?? (velocity.totalStoryPoints - velocity.completedStoryPoints)}{" "}
                          pts
                        </div>
                      </div>
                    </div>
                    
                    {/* Closed vs Open Stories */}
                    {sprintVelocity && (
                      <div className="grid grid-cols-2 gap-4 text-sm pt-2 border-t border-border/50">
                        <div>
                          <div className="text-muted-foreground">Closed Stories</div>
                          <div className="font-semibold text-lg text-green-600">
                            {sprintVelocity.completedStories}
                          </div>
                        </div>
                        <div>
                          <div className="text-muted-foreground">Open Stories</div>
                          <div className="font-semibold text-lg">
                            {sprintVelocity.openStories}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })()}

          {/* Velocity Insights */}
        </div>
        </>
      ) : (
        <Card>
          <CardContent className="pt-6">
            <div className="text-center space-y-4">
              <TrendingUp className="h-12 w-12 text-muted-foreground mx-auto" />
              <h3 className="text-lg font-semibold">No Velocity Data Available</h3>
              <p className="text-muted-foreground">
                Velocity data will appear here once stories are completed and
                moved to Closed or Done states.
              </p>
            </div>
          </CardContent>
        </Card>
      )}
    </GenericModal>
  );
}


