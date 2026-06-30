import { useState, useEffect, useMemo } from "react";
import { GenericModal } from "@/components/ui/generic-modal";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  User,
  RefreshCw,
  AlertTriangle,
  TrendingUp,
  AlertCircle,
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

interface DeveloperAssignmentsModalProps {
  projectId: string;
  adoProject?: ADOProject;
  integrationType?: string;
  open: boolean;
  onClose: () => void;
}

interface DeveloperAssignment {
  displayName: string;
  totalStories: number;
  storiesByState: Record<string, number>;
  totalStoryPoints: number;
  completedStoryPoints: number;
  stories: Array<{
    id: number;
    title: string;
    state: string;
    storyPoints: number | null;
  }>;
}

interface BacklogContextResponse {
  developerAssignments?: DeveloperAssignment[];
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

export function DeveloperAssignmentsModal({
  projectId,
  adoProject,
  integrationType = "ado",
  open,
  onClose,
}: DeveloperAssignmentsModalProps) {
  const { toast } = useToast();
  const [selectedDeveloper, setSelectedDeveloper] = useState<string>("all");
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
  const hasConfig = hasAdoConfig || hasJiraConfig;

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
    enabled: open && !!projectId && hasConfig,
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
      integrationType === "jira" ? "jira/sprint-data" : "ado/sprint-data",
      adoProject?.organization,
      adoProject?.name,
      selectedSprintPath,
    ],
    queryFn: async () => {
      if (!hasConfig || !selectedSprintPath) {
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

      if (integrationType === "jira") {
        const sprintUrl = getApiUrl(`/api/sdlc/projects/${projectId}/jira/sprints/${encodeURIComponent(selectedSprintPath)}`);
        const sprintRes = await fetch(sprintUrl, { credentials: "include" });
        if (!sprintRes.ok) throw new Error("Failed to fetch Jira sprint data");
        return sprintRes.json();
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
    enabled: open && !!projectId && hasConfig && !!selectedSprintPath,
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
    retry: 1,
  });

  // Don't auto-select sprint - user must choose manually

  // Reset sprint selection when modal closes
  useEffect(() => {
    if (!open) {
      setSelectedSprintPath(null);
    }
  }, [open]);

  // Fetch backlog context for developer assignments
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
      if (!hasConfig) return {};

      const endpoint = integrationType === "jira"
        ? `/api/sdlc/projects/${projectId}/jira/backlog-context`
        : `/api/sdlc/projects/${projectId}/ado/backlog-context${queryString ? `?${queryString}` : ""}`;
      
      const backlogUrl = getApiUrl(endpoint);
      const backlogRes = await fetch(backlogUrl, { credentials: "include" });

      if (!backlogRes.ok) {
        throw new Error("Failed to fetch developer assignments");
      }
      return backlogRes.json();
    },
    enabled: open && !!projectId && hasConfig,
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
            : "Failed to fetch developer assignments",
        variant: "destructive",
      });
    }
  }, [backlogError, toast]);

  const handleRefresh = async () => {
    await Promise.all([refetchBacklogContext(), refetchSprintData()]);
  };

  // Helper function to calculate total story points from all stories
  const getTotalStoryPoints = (dev: DeveloperAssignment): number => {
    if (dev.stories && dev.stories.length > 0) {
      return dev.stories.reduce((sum, story) => sum + (story.storyPoints || 0), 0);
    }
    // Fallback to the provided totalStoryPoints if stories array is not available
    return dev.totalStoryPoints || 0;
  };

  // Helper function to calculate completed story points from closed stories only
  const getClosedStoryPoints = (dev: DeveloperAssignment): number => {
    if (dev.stories && dev.stories.length > 0) {
      return dev.stories
        .filter(story => story.state === "Closed")
        .reduce((sum, story) => sum + (story.storyPoints || 0), 0);
    }
    // Fallback: if we have storiesByState with Closed, we can't calculate points without stories array
    // So return 0 or use completedStoryPoints if available
    return 0;
  };

  // Helper function to get stories by state from actual stories array
  const getStoriesByState = (dev: DeveloperAssignment): Record<string, number> => {
    // Always prefer stories array if available (most accurate source)
    if (dev.stories && Array.isArray(dev.stories) && dev.stories.length > 0) {
      const stateCounts: Record<string, number> = {};
      dev.stories.forEach(story => {
        // Normalize state name - handle case variations and whitespace
        const state = story.state ? String(story.state).trim() : "Unknown";
        if (state && state !== "Unknown") {
          stateCounts[state] = (stateCounts[state] || 0) + 1;
        }
      });
      return stateCounts;
    }
    
    // Fallback to storiesByState if stories array is not available or empty
    const fallback = dev.storiesByState || {};
    const normalized: Record<string, number> = {};
    Object.entries(fallback).forEach(([state, count]) => {
      const normalizedState = String(state).trim();
      if (normalizedState && typeof count === 'number') {
        normalized[normalizedState] = count;
      }
    });
    return normalized;
  };

  // Calculate developer assignments from sprint data if sprint is selected
  const sprintDeveloperAssignments = useMemo(() => {
    if (!selectedSprintPath || !sprintData?.workItems || sprintData.workItems.length === 0) {
      return [];
    }

    const assignments: Record<string, DeveloperAssignment> = {};

    sprintData.workItems.forEach((workItem: any) => {
      // Only process User Stories
      if (workItem.fields?.['System.WorkItemType'] !== 'User Story') {
        return;
      }

      const assignedTo = workItem.fields?.['System.AssignedTo'];
      let assigneeName = 'Unassigned';
      if (assignedTo) {
        if (typeof assignedTo === 'string') {
          assigneeName = assignedTo;
        } else if (assignedTo.displayName) {
          assigneeName = assignedTo.displayName;
        } else if (assignedTo.uniqueName) {
          assigneeName = assignedTo.uniqueName;
        } else if (assignedTo.name) {
          assigneeName = assignedTo.name;
        }
      }

      const state = workItem.fields?.['System.State'] || 'Unknown';
      const storyPoints = workItem.fields?.['Microsoft.VSTS.Scheduling.StoryPoints'] || null;
      const storyId = workItem.id;
      const storyTitle = workItem.fields?.['System.Title'] || 'Untitled';

      if (!assignments[assigneeName]) {
        assignments[assigneeName] = {
          displayName: assigneeName,
          totalStories: 0,
          storiesByState: {},
          totalStoryPoints: 0,
          completedStoryPoints: 0,
          stories: [],
        };
      }

      assignments[assigneeName].totalStories++;
      assignments[assigneeName].storiesByState[state] = (assignments[assigneeName].storiesByState[state] || 0) + 1;
      assignments[assigneeName].stories.push({
        id: storyId,
        title: storyTitle,
        state: state,
        storyPoints: storyPoints,
      });

      if (storyPoints) {
        assignments[assigneeName].totalStoryPoints += storyPoints;
        if (state === 'Closed' || state === 'Done') {
          assignments[assigneeName].completedStoryPoints += storyPoints;
        }
      }
    });

    return Object.values(assignments);
  }, [selectedSprintPath, sprintData?.workItems]);

  // Use sprint assignments if sprint is selected, otherwise use backlog assignments
  const allDeveloperAssignments = selectedSprintPath && sprintDeveloperAssignments.length > 0
    ? sprintDeveloperAssignments
    : backlogData?.developerAssignments || [];
  
  // Filter developers based on selection
  const developerAssignments = selectedDeveloper === "all"
    ? allDeveloperAssignments
    : allDeveloperAssignments.filter(dev => dev.displayName === selectedDeveloper);
  
  // Reset filter when modal closes or data changes
  useEffect(() => {
    if (!open) {
      setSelectedDeveloper("all");
    }
  }, [open]);

  return (
    <GenericModal
      open={open}
      onOpenChange={onClose}
      title="Developer Assignments"
      description="View story assignments and workload distribution across developers"
      icon={User}
      iconClassName="bg-gradient-to-br from-emerald-500 to-emerald-600"
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
          <Select value={selectedDeveloper} onValueChange={setSelectedDeveloper}>
            <SelectTrigger className="w-[200px]">
              <SelectValue placeholder="Select developer" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Developers</SelectItem>
              {allDeveloperAssignments.map((dev, idx) => (
                <SelectItem key={idx} value={dev.displayName}>
                  {dev.displayName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleRefresh}
                disabled={refreshing || loadingSprint}
                className="h-8 w-8 p-0 flex items-center justify-center"
                aria-label="Refresh backlog"
              >
                <RefreshCw
                  className={`h-4 w-4 ${refreshing || loadingSprint ? "animate-spin" : ""}`}
                />
              </Button>
            </div>
      }
    >

      {!hasConfig ? (
        <Card>
          <CardContent className="pt-6">
            <div className="text-center space-y-4">
              <AlertTriangle className="h-12 w-12 text-yellow-500 mx-auto" />
              <h3 className="text-lg font-semibold">
                {integrationType === "jira" ? "Jira" : "Azure DevOps"} Not Configured
              </h3>
              <p className="text-muted-foreground">
                Please configure {integrationType === "jira" ? "Jira" : "Azure DevOps"} credentials in Settings &gt;
                Central Settings to view developer assignments.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : loading || loadingSprint ? (
        <Card>
          <CardContent className="pt-6">
            <p className="text-center text-muted-foreground py-8">
              Loading developer assignments...
            </p>
          </CardContent>
        </Card>
      ) : developerAssignments.length > 0 ? (
          <div className="flex flex-col space-y-4 pr-4">
            {/* Sprint Date Card - Show when sprint is selected */}
            {selectedSprintPath && sprintData?.sprint && sprintData.sprint.startDate && sprintData.sprint.endDate && (() => {
              const startDate = new Date(sprintData.sprint.startDate);
              const endDate = new Date(sprintData.sprint.endDate);
              const daysDiff = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)) + 1; // +1 to include both start and end days
              const formattedStartDate = startDate.toLocaleDateString('en-GB', { day: 'numeric', month: 'numeric', year: 'numeric' });
              const formattedEndDate = endDate.toLocaleDateString('en-GB', { day: 'numeric', month: 'numeric', year: 'numeric' });
              const spilloverStories = sprintData.metrics.spilloverStories || 0;
              const spilloverPoints = sprintData.metrics.spilloverStoryPoints || 0;
              
              return (
                <Card className="bg-green-50 dark:bg-green-950/20 border-green-200 dark:border-green-800">
                  <CardContent className="pt-3 pb-3">
                    <div className="flex items-center justify-between mb-3">
                      <div className="text-sm text-muted-foreground">
                        {formattedStartDate} - {formattedEndDate}
                      </div>
                      <div className="text-sm font-semibold text-purple-600 dark:text-purple-400">
                        {daysDiff} {daysDiff === 1 ? 'day' : 'days'}
                      </div>
                    </div>
                    <div className="grid grid-cols-4 gap-3 text-sm">
                      <div>
                        <div className="text-muted-foreground text-xs mb-0.5">Total Stories</div>
                        <div className="font-semibold text-base">
                          {sprintData.metrics.totalStories}
                        </div>
                      </div>
                      <div>
                        <div className="text-muted-foreground text-xs mb-0.5">Completed</div>
                        <div className="font-semibold text-base text-green-600 dark:text-green-400">
                          {sprintData.metrics.completedStories}
                        </div>
                      </div>
                      <div>
                        <div className="text-muted-foreground text-xs mb-0.5">Story Points</div>
                        <div className="font-semibold text-base">
                          {sprintData.metrics.totalStoryPoints} pts
                        </div>
                      </div>
                      <div>
                        <div className="text-muted-foreground text-xs mb-0.5">Completed Points</div>
                        <div className="font-semibold text-base text-green-600 dark:text-green-400">
                          {sprintData.metrics.completedStoryPoints} pts
                        </div>
                      </div>
                    </div>
                    {(spilloverStories > 0 || spilloverPoints > 0) && (
                      <div className="mt-3 pt-3 border-t border-green-200 dark:border-green-800">
                        <div className="flex items-center justify-between">
                          <div className="text-xs text-muted-foreground">Spillover</div>
                          <div className="text-xs font-semibold text-orange-600 dark:text-orange-400">
                            {spilloverStories} {spilloverStories === 1 ? 'story' : 'stories'} ({spilloverPoints} pts)
                          </div>
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })()}
            
            {/* Developer List - Dynamic layout based on count */}
            <div className={developerAssignments.length === 1 
              ? "grid grid-cols-1 gap-4" 
              : "grid grid-cols-2 gap-4"}>
              {developerAssignments.map((dev, idx) => {
                const totalPoints = getTotalStoryPoints(dev);
                const isOverLimit = totalPoints > 12;
                const isNearLimit = totalPoints > 10 && totalPoints <= 12;
                
                return (
                <Card 
                  key={idx} 
                  className={`border-border ${
                    isOverLimit 
                      ? "border-orange-500 dark:border-orange-600 bg-orange-50/50 dark:bg-orange-950/10" 
                      : isNearLimit 
                        ? "border-yellow-500 dark:border-yellow-600 bg-yellow-50/50 dark:bg-yellow-950/10"
                        : ""
                  }`}
                >
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <User className="h-5 w-5 text-emerald-600" />
                        <CardTitle className="text-base">{dev.displayName}</CardTitle>
                      </div>
                      {isOverLimit && (
                        <div className="flex items-center gap-1 text-orange-600 dark:text-orange-500">
                          <AlertCircle className="h-4 w-4" />
                          <span className="text-xs font-semibold">Over Limit</span>
                        </div>
                      )}
                      {isNearLimit && (
                        <div className="flex items-center gap-1 text-yellow-600 dark:text-yellow-500">
                          <AlertTriangle className="h-4 w-4" />
                          <span className="text-xs font-semibold">Near Limit</span>
                        </div>
                      )}
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-2 gap-4 text-sm mb-4">
                      <div>
                        <div className="text-muted-foreground mb-1">
                          Total Points
                        </div>
                        <div className={`font-semibold text-lg ${
                          isOverLimit 
                            ? "text-orange-600 dark:text-orange-500" 
                            : isNearLimit 
                              ? "text-yellow-600 dark:text-yellow-500"
                              : ""
                        }`}>
                          {totalPoints} pts
                          {(isOverLimit || isNearLimit) && (
                            <span className="text-xs ml-1">(max 10-12)</span>
                          )}
                        </div>
                      </div>
                      <div>
                        <div className="text-muted-foreground mb-1">
                          Completed Points
                        </div>
                        <div className="font-semibold text-lg text-green-600">
                          {getClosedStoryPoints(dev)} pts
                        </div>
                      </div>
                    </div>
                    {(() => {
                      const storiesByState = getStoriesByState(dev);
                      const stateKeys = Object.keys(storiesByState);
                      
                      // Sort states in a logical order: New, Active, Resolved, Closed, then others
                      const stateOrder = ["New", "Active", "Resolved", "Closed"];
                      const sortedStateKeys = stateKeys.sort((a, b) => {
                        const aIndex = stateOrder.indexOf(a);
                        const bIndex = stateOrder.indexOf(b);
                        if (aIndex !== -1 && bIndex !== -1) return aIndex - bIndex;
                        if (aIndex !== -1) return -1;
                        if (bIndex !== -1) return 1;
                        return a.localeCompare(b);
                      });
                      
                      if (sortedStateKeys.length > 0) {
                        return (
                      <div className="pt-4 border-t">
                        <div className="text-sm font-semibold mb-2 text-muted-foreground">
                          Stories by State
                        </div>
                        <div className="flex flex-wrap gap-2">
                              {sortedStateKeys.map((state) => (
                            <Badge
                              key={state}
                              variant="outline"
                              className="text-xs px-2 py-1"
                            >
                                  {state}: {storiesByState[state]}
                            </Badge>
                          ))}
                        </div>
                      </div>
                        );
                      }
                      return null;
                    })()}
                  </CardContent>
                </Card>
              );
              })}
            </div>
          </div>

      ) : (
        <Card>
          <CardContent className="pt-6">
            <div className="text-center space-y-4">
              <User className="h-12 w-12 text-muted-foreground mx-auto" />
              <h3 className="text-lg font-semibold">
                No Developer Assignments Found
              </h3>
              <p className="text-muted-foreground">
                Assign stories to developers in Azure DevOps to see assignments
                here.
              </p>
            </div>
          </CardContent>
        </Card>
      )}
    </GenericModal>
  );
}

