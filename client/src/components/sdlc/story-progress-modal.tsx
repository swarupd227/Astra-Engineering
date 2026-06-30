import { useState, useEffect, useRef } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { GenericModal } from "@/components/ui/generic-modal";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { getIntegrationLabels } from "@/lib/integration-config";
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
  TrendingUp,
  RefreshCw,
  CheckCircle2,
  Clock,
  AlertCircle,
  AlertTriangle,
  User,
  ArrowLeft,
  Plus,
  Search,
  FileText,
  Layers,
  BookOpen,
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

interface StoryProgressModalProps {
  projectId: string;
  adoProject?: ADOProject;
  open: boolean;
  onClose: () => void;
  integrationType?: 'ado' | 'jira';
}

interface BacklogContextResponse {
  availableStates: string[];
  stateCounts: Record<
    string,
    {
      epics: number;
      features: number;
      userStories: number;
      total: number;
    }
  >;
  artifactsByState: Record<
    string,
    {
      epics: any[];
      features: any[];
      userStories: any[];
    }
  >;
  summary: {
    totalEpics: number;
    totalFeatures: number;
    totalUserStories: number;
    totalArtifacts: number;
  };
  developerAssignments?: Array<{
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
  }>;
  velocity?: {
    last7Days: number;
    last30Days: number;
    totalStoryPoints: number;
    completedStoryPoints: number;
    completionRate: number;
  };
}

interface SprintDataResponse {
  sprint: {
    id: string;
    name: string;
    path: string;
    startDate: string;
    endDate: string;
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

export function StoryProgressModal(props: StoryProgressModalProps) {
  const {
    projectId,
    adoProject,
    open,
    onClose,
    integrationType = 'ado',
  } = props;
  const { toast } = useToast();
  const [selectedState, setSelectedState] = useState<string | null>(null);
  const [detailsDialogOpen, setDetailsDialogOpen] = useState(false);
  const [expandedStories, setExpandedStories] = useState<Set<number>>(
    new Set()
  );
  const [hoveredSegment, setHoveredSegment] = useState<string | null>(null);
  const [selectedStateForTable, setSelectedStateForTable] = useState<string | null>(null);
  const [selectedSprintPath, setSelectedSprintPath] = useState<string | null>(null);
  const hoverTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Build query params for ADO project info
  const params = new URLSearchParams();
  if (adoProject?.organization) {
    params.append("organization", adoProject.organization);
  }
  if (adoProject?.name) {
    params.append("projectName", adoProject.name);
  }
  const queryString = params.toString();

  // Create unique query key based on projectId, adoProject, and integrationType
  const queryKey = [
    "/api/sdlc/projects",
    projectId,
    getIntegrationLabels(integrationType).backlogContextUrl,
    adoProject?.organization,
    adoProject?.name,
  ];

  // Fetch ADO config (cached)
  const { data: adoConfig, error: configError } = useQuery<{
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
        // Try to parse error response as JSON, fallback to text
        let errorMessage = `Configuration check failed: ${configRes.status} ${configRes.statusText}`;
        try {
          const contentType = configRes.headers.get("content-type");
          if (contentType && contentType.includes("application/json")) {
            const errorData = await configRes.json();
            errorMessage = errorData.error || errorData.message || errorMessage;
          } else {
            const errorText = await configRes.text();
            // Check if it's HTML (error page)
            if (
              errorText.includes("<!DOCTYPE") ||
              errorText.includes("<html")
            ) {
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

      // Try to parse as JSON regardless of content-type header
      // Some proxies/servers might not set the header correctly
      try {
        const contentType = configRes.headers.get("content-type");
        const responseText = await configRes.text();

        // Check if response is HTML (error page)
        if (
          responseText.trim().startsWith("<!DOCTYPE") ||
          responseText.trim().startsWith("<html")
        ) {
          throw new Error(
            `Server returned an HTML error page. Please check if the backend API is accessible at ${configUrl}. This usually indicates a routing or server configuration issue.`
          );
        }

        // Try to parse as JSON
        try {
          return JSON.parse(responseText);
        } catch (parseError) {
          // If content-type says JSON but parsing fails, or if content-type is missing
          if (!contentType || contentType.includes("application/json")) {
            throw new Error(
              `Server returned invalid JSON response. Response: ${responseText.substring(
                0,
                200
              )}`
            );
          }
          throw new Error(
            `Server returned non-JSON response (${
              contentType || "unknown"
            }). Please check if the server is running correctly.`
          );
        }
      } catch (error) {
        if (error instanceof Error) {
          throw error;
        }
        throw new Error(
          "Failed to parse server response. Please check if the server is running correctly."
        );
      }
    },
    enabled: open && !!projectId && integrationType === 'ado', // Only fetch when modal is open, projectId exists, and it's ADO
    staleTime: 5 * 60 * 1000, // Cache for 5 minutes
    gcTime: 10 * 60 * 1000, // Keep in cache for 10 minutes
    retry: 1,
  });

  const hasAdoConfig = (adoConfig?.hasConfig || false) && integrationType === 'ado';

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
      if (integrationType === 'jira') {
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
        const errorText = await sprintsRes.text();
        console.warn(`[StoryProgressModal] Failed to fetch sprints: ${sprintsRes.status}`, errorText);
        return [];
      }

      const sprints = await sprintsRes.json();
      console.log('[StoryProgressModal] Fetched sprints:', sprints.length, sprints);
      return sprints;
    },
    enabled: open && !!projectId && (hasAdoConfig || integrationType === 'jira'),
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 10 * 60 * 1000, // 10 minutes
    retry: 1,
  });

  // Fetch sprint data (cached)
  const {
    data: sprintData,
    isLoading: loadingSprint,
    isFetching: refreshingSprint,
    error: sprintError,
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
      console.log('[StoryProgressModal] Fetching sprint data...', {
        hasAdoConfig,
        projectId,
        queryString,
        adoProject
      });

      if (!hasAdoConfig) {
        console.log('[StoryProgressModal] No ADO config, returning empty sprint data');
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

      // Add sprint path to query
      const sprintQuery = new URLSearchParams(queryString);
      sprintQuery.set('sprintPath', selectedSprintPath);
      const sprintUrl = getApiUrl(
        `/api/sdlc/projects/${projectId}/ado/sprint-data${
          sprintQuery.toString() ? `?${sprintQuery.toString()}` : ""
        }`
      );
      console.log('[StoryProgressModal] Sprint API URL:', sprintUrl);
      
      const sprintRes = await fetch(sprintUrl, { credentials: "include" });

      if (!sprintRes.ok) {
        // Sprint might not be configured, return empty data
        const errorText = await sprintRes.text();
        console.warn(`[StoryProgressModal] Failed to fetch sprint data: ${sprintRes.status}`, errorText);
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

      const data = await sprintRes.json();
      console.log('[StoryProgressModal] Sprint data received:', data);
      return data;
    },
    enabled: open && !!projectId && hasAdoConfig && !!selectedSprintPath,
    staleTime: 30 * 1000, // 30 seconds
    gcTime: 5 * 60 * 1000, // 5 minutes
    retry: 1,
  });

  // Don't auto-select sprint - user must choose manually

  // Reset sprint selection when modal closes
  useEffect(() => {
    if (!open) {
      setSelectedSprintPath(null);
    }
  }, [open]);

  // Log sprint query state
  useEffect(() => {
    if (open) {
      const isEnabled = open && !!projectId && hasAdoConfig && !!selectedSprintPath;
      if (sprintData?.sprint) {
        console.log('[StoryProgressModal] Sprint Name:', sprintData.sprint.name);
      }
      
      if (!isEnabled) {
        if (!open) console.warn('  - Modal is not open');
        if (!projectId) console.warn('  - Project ID is missing');
        if (!hasAdoConfig) console.warn('  - ADO config is not available');
        if (!selectedSprintPath) console.warn('  - No sprint selected');
      }
    }
  }, [open, projectId, hasAdoConfig, selectedSprintPath, loadingSprint, refreshingSprint, sprintError, sprintData]);

  // Fetch backlog context (cached)
  const {
    data: backlogData,
    isLoading: loading,
    isFetching: refreshing,
    error: backlogError,
    refetch: refetchBacklogContext,
  } = useQuery<BacklogContextResponse>({
    queryKey,
    queryFn: async () => {
      // Skip check for Jira, but check for ADO if it's the provider
      if (integrationType === 'ado' && !hasAdoConfig) {
        return null;
      }

      const backlogUrl = getApiUrl(`/api/sdlc/projects/${projectId}/${getIntegrationLabels(integrationType).backlogContextUrl}${
            queryString ? `?${queryString}` : ""
          }`
        );
      const backlogRes = await fetch(backlogUrl, { credentials: "include" });

      if (!backlogRes.ok) {
        let errorMessage = `Failed to fetch backlog context: ${backlogRes.status} ${backlogRes.statusText}`;
        try {
          const errorText = await backlogRes.text();
          if (errorText.includes("<!DOCTYPE") || errorText.includes("<html")) {
            errorMessage = `Server returned an error page. Please check if the backend API is accessible.`;
          } else {
            try {
              const errorData = JSON.parse(errorText);
              errorMessage =
                errorData.error || errorData.message || errorMessage;
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
        const responseText = await backlogRes.text();
        if (
          responseText.trim().startsWith("<!DOCTYPE") ||
          responseText.trim().startsWith("<html")
        ) {
          throw new Error(
            `Server returned an HTML error page. Please check if the backend API is accessible.`
          );
        }
        return JSON.parse(responseText);
      } catch (parseError) {
        if (parseError instanceof Error) {
          throw parseError;
        }
        throw new Error("Failed to parse backlog context response");
      }
    },
    enabled: open && !!projectId && (hasAdoConfig || integrationType === 'jira'), // Only fetch when modal is open, projectId exists, and integrated provider is configured
    staleTime: 5 * 60 * 1000, // Cache for 5 minutes
    gcTime: 10 * 60 * 1000, // Keep in cache for 10 minutes
    retry: 1,
  });

  // Show error toast if there's an error
  useEffect(() => {
    if (configError) {
      toast({
        title: "Error",
        description:
          configError instanceof Error
            ? configError.message
            : "Failed to fetch ADO configuration",
        variant: "destructive",
      });
    }
  }, [configError, toast]);

  useEffect(() => {
    if (backlogError) {
      toast({
        title: "Error",
        description:
          backlogError instanceof Error
            ? backlogError.message
            : "Failed to fetch development progress",
        variant: "destructive",
      });
    }
  }, [backlogError, toast]);

  const handleRefresh = async () => {
    await Promise.all([refetchBacklogContext(), refetchSprintData()]);
  };

  // Calculate overall completion percentage based on sprint data (if available) or backlog data
  const calculateProgress = () => {
    // Prioritize sprint data if available
    if (sprintData?.sprint && sprintData.metrics) {
      const totalStories = sprintData.metrics.totalStories;
      const completedStories = sprintData.metrics.completedStories;
      const percentage =
        totalStories > 0
          ? Math.round((completedStories / totalStories) * 100)
          : 0;
      return { total: totalStories, completed: completedStories, percentage };
    }

    // Fallback to backlog data
    if (!backlogData?.artifactsByState) {
      return { total: 0, completed: 0, percentage: 0 };
    }

    // Count all user stories across all states
    let totalStories = 0;
    let completedStories = 0;

    Object.entries(backlogData.artifactsByState).forEach(
      ([state, artifacts]) => {
        const storyCount = artifacts.userStories?.length || 0;
        totalStories += storyCount;

        // Count stories in completed states (case-insensitive)
        // Only count "Closed" and "Done" as truly completed
        // "Resolved" is typically an intermediate state (work done, awaiting verification)
        const normalizedState = state.toLowerCase();
        if (
          normalizedState.includes("closed") ||
          normalizedState.includes("done")
        ) {
          completedStories += storyCount;
        }
      }
    );

    // Fallback to summary if artifactsByState doesn't have data
    if (totalStories === 0 && backlogData.summary) {
      totalStories = backlogData.summary.totalUserStories || 0;

      // Count completed from stateCounts if available
      if (backlogData.stateCounts) {
        Object.entries(backlogData.stateCounts).forEach(([state, counts]) => {
          const normalizedState = state.toLowerCase();
          if (
            normalizedState.includes("closed") ||
            normalizedState.includes("done")
          ) {
            completedStories += counts.userStories || 0;
          }
        });
      }
    }

    const percentage =
      totalStories > 0
        ? Math.round((completedStories / totalStories) * 100)
        : 0;

    return { total: totalStories, completed: completedStories, percentage };
  };

  const progress = calculateProgress();
  const totalUserStories = progress.total;
  const completedUserStories = progress.completed;
  const completionPercentage = progress.percentage;

  // Debug: Log the data to see if it's being received
  useEffect(() => {
    if (backlogData) {
      console.log('[StoryProgressModal] Backlog data received:', {
        hasVelocity: !!backlogData.velocity,
        hasDeveloperAssignments: !!backlogData.developerAssignments,
        developerAssignmentsCount: backlogData.developerAssignments?.length || 0,
        developerAssignments: backlogData.developerAssignments,
        velocity: backlogData.velocity,
        totalStories: backlogData.summary?.totalUserStories,
      });
    }
  }, [backlogData]);

  // Get state color based on state name
  const getStateColor = (state: string): string => {
    const normalized = state.toLowerCase();
    if (
      normalized.includes("closed") ||
      normalized.includes("done") ||
      normalized.includes("completed")
    ) {
      return "bg-green-500";
    } else if (normalized.includes("reopened")) {
      return "bg-orange-500";
    } else if (
      normalized.includes("resolved") ||
      normalized.includes("testing") ||
      normalized.includes("review")
    ) {
      return "bg-amber-500";
    } else if (
      normalized.includes("active") ||
      normalized.includes("in progress")
    ) {
      return "bg-blue-500";
    } else if (normalized.includes("new") || normalized.includes("to do")) {
      return "bg-blue-400";
    }
    return "bg-gray-500";
  };



  // Get work item title from ADO work item
  const getWorkItemTitle = (item: any): string => {
    return item.fields?.["System.Title"] || item.title || "Untitled";
  };

  // Truncate text to 10 words
  const truncateToWords = (text: string, wordLimit: number = 10): string => {
    const words = text.trim().split(/\s+/);
    if (words.length <= wordLimit) {
      return text;
    }
    return words.slice(0, wordLimit).join(" ") + "...";
  };

  // Toggle story expansion
  const toggleStoryExpansion = (storyId: number) => {
    setExpandedStories((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(storyId)) {
        newSet.delete(storyId);
      } else {
        newSet.add(storyId);
      }
      return newSet;
    });
  };

  // Build hierarchical tree structure
  const buildHierarchy = (artifacts: any) => {
    const { epics, features, userStories } = artifacts;

    // Helper to normalize IDs to numbers for consistent comparison
    const normalizeId = (id: any): number => {
      if (id === null || id === undefined) return 0;
      return typeof id === "string" ? parseInt(id, 10) : id;
    };

    // Create maps for quick lookup with children array - use normalized IDs as keys
    const epicMap = new Map(
      epics.map((e: any) => {
        const id = normalizeId(e.id);
        return [id, { ...e, id, children: [] as any[], workItemType: "Epic" }];
      })
    );
    const featureMap = new Map(
      features.map((f: any) => {
        const id = normalizeId(f.id);
        return [
          id,
          { ...f, id, children: [] as any[], workItemType: "Feature" },
        ];
      })
    );
    const storyMap = new Map(
      userStories.map((s: any) => {
        const id = normalizeId(s.id);
        return [
          id,
          { ...s, id, children: [] as any[], workItemType: "User Story" },
        ];
      })
    );

    // Track which features and stories have been added as children (to avoid showing them at top level)
    const featuresAddedAsChildren = new Set<number>();
    const storiesAddedAsChildren = new Set<number>();

    features.forEach((feature: any) => {
      const featureId = normalizeId(feature.id);
      const parentId = feature.parentId ? normalizeId(feature.parentId) : null;

      if (parentId && epicMap.has(parentId)) {
        const epic = epicMap.get(parentId) as any;
        const featureItem = featureMap.get(featureId) as any;
        if (epic && featureItem) {
          epic.children.push(featureItem);
          featuresAddedAsChildren.add(featureId);
        } else {
        }
      } else if (parentId) {
      } else {
      }
    });

    // Build story -> feature relationships
    userStories.forEach((story: any) => {
      const storyId = normalizeId(story.id);
      const parentId = story.parentId ? normalizeId(story.parentId) : null;

      if (parentId) {
        // Check if parent is a feature
        if (featureMap.has(parentId)) {
          const feature = featureMap.get(parentId) as any;
          const storyItem = storyMap.get(storyId) as any;
          if (feature && storyItem) {
            feature.children.push(storyItem);
            storiesAddedAsChildren.add(storyId);
          }
        }
        // Check if parent is an epic (direct story under epic - less common but possible)
        else if (epicMap.has(parentId)) {
          const epic = epicMap.get(parentId) as any;
          const storyItem = storyMap.get(storyId) as any;
          if (epic && storyItem) {
            epic.children.push(storyItem);
            storiesAddedAsChildren.add(storyId);
          }
        }
      }
    });
    // Return epics with tracking information
    // Features and stories with parents are already nested in epics
    return {
      hierarchy: Array.from(epicMap.values()),
      featuresAddedAsChildren,
      storiesAddedAsChildren,
    };
  };

  // // Render tree node - simplified like workflow step2, always show all items
  // const renderEpic = (epic: any, features: any[], stories: any[]) => {
  //   const epicId =
  //     typeof epic.id === "string" ? parseInt(epic.id, 10) : epic.id;
  //   const epicTitle = getWorkItemTitle(epic);

  //   return (
  //     <div key={epicId} className="border-b border-border">
  //       {/* EPIC ROW */}
  //       <div className="flex items-center gap-2 px-4 py-3 hover:bg-muted/30 transition-colors">
  //         <div className="flex items-center justify-center w-6 h-6 rounded bg-purple-500 flex-shrink-0">
  //           <span className="text-white text-xs font-semibold">E</span>
  //         </div>
  //         <span className="font-medium text-foreground flex-1">
  //           <span className="text-muted-foreground font-normal">#{epicId}</span>{" "}
  //           {epicTitle}
  //         </span>
  //         {features.length > 0 && (
  //           <span className="text-sm text-muted-foreground flex-shrink-0">
  //             {features.length} features
  //           </span>
  //         )}
  //       </div>

  //       {/* FEATURES under EPIC - always show if any exist */}
  //       {features.length > 0 ? (
  //         <div className="bg-muted/20">
  //           {features.map((feature: any) => {
  //             const featureId =
  //               typeof feature.id === "string"
  //                 ? parseInt(feature.id, 10)
  //                 : feature.id;
  //             const featureTitle = getWorkItemTitle(feature);

  //             // Get stories for this feature - check both parentId and relations
  //             const featureStories = stories.filter((s: any) => {
  //               const storyId =
  //                 typeof s.id === "string" ? parseInt(s.id, 10) : s.id;
  //               const sParentId =
  //                 s.parentId !== null && s.parentId !== undefined
  //                   ? typeof s.parentId === "string"
  //                     ? parseInt(s.parentId, 10)
  //                     : s.parentId
  //                   : null;

  //               // Check parentId first
  //               if (
  //                 sParentId !== null &&
  //                 !isNaN(sParentId) &&
  //                 sParentId === featureId
  //               ) {
  //                 return true;
  //               }

  //               // If no parentId or doesn't match, check relations
  //               if (s.relations && Array.isArray(s.relations)) {
  //                 const parentRelation = s.relations.find(
  //                   (rel: any) =>
  //                     rel.rel === "System.LinkTypes.Hierarchy-Reverse"
  //                 );
  //                 if (parentRelation && parentRelation.url) {
  //                   // Try multiple URL patterns
  //                   const patterns = [
  //                     /\/workitems\/(\d+)/,
  //                     /workitems\/(\d+)/,
  //                     /\/_apis\/wit\/workitems\/(\d+)/,
  //                     /workitems\/(\d+)(?:\?|$)/,
  //                   ];

  //                   for (const pattern of patterns) {
  //                     const parentIdMatch = parentRelation.url.match(pattern);
  //                     if (parentIdMatch) {
  //                       const parentId = parseInt(parentIdMatch[1]);
  //                       if (!isNaN(parentId) && parentId === featureId) {
  //                         return true;
  //                       }
  //                     }
  //                   }

  //                   // Also try extracting from end of URL
  //                   const urlParts = parentRelation.url.split("/");
  //                   const lastPart = urlParts[urlParts.length - 1];
  //                   const idFromEnd = parseInt(lastPart.split("?")[0]);
  //                   if (!isNaN(idFromEnd) && idFromEnd === featureId) {
  //                     return true;
  //                   }
  //                 }
  //               }

  //               return false;
  //             });

  //             return (
  //               <div key={featureId} className="border-b border-border/50">
  //                 {/* FEATURE ROW */}
  //                 <div className="flex items-center gap-2 px-4 py-2.5 pl-12 hover:bg-muted/30 transition-colors">
  //                   <div className="flex items-center justify-center w-6 h-6 rounded bg-blue-500 flex-shrink-0">
  //                     <span className="text-white text-xs font-semibold">
  //                       F
  //                     </span>
  //                   </div>
  //                   <span className="text-sm text-foreground flex-1">
  //                     <span className="text-muted-foreground font-normal">
  //                       #{featureId}
  //                     </span>{" "}
  //                     {featureTitle}
  //                   </span>
  //                   {featureStories.length > 0 && (
  //                     <span className="text-xs text-muted-foreground flex-shrink-0">
  //                       {featureStories.length} stories
  //                     </span>
  //                   )}
  //                 </div>

  //                 {/* STORIES under FEATURE - always show if any exist */}
  //                 {featureStories.length > 0 && (
  //                   <div className="overflow-hidden">
  //                     {featureStories.map((story: any) => {
  //                       const storyId =
  //                         typeof story.id === "string"
  //                           ? parseInt(story.id, 10)
  //                           : story.id;
  //                       const storyTitle = getWorkItemTitle(story);
  //                       const isExpanded = expandedStories.has(storyId);
  //                       const words = storyTitle.trim().split(/\s+/);
  //                       const needsTruncation = words.length > 10;
  //                       const displayText =
  //                         isExpanded || !needsTruncation
  //                           ? storyTitle
  //                           : truncateToWords(storyTitle, 10);

  //                       return (
  //                         <div
  //                           key={storyId}
  //                           className="px-4 py-2 pl-24 hover:bg-muted/20 transition-colors border-b border-border/30"
  //                         >
  //                           <div className="flex items-start gap-2">
  //                             <div className="flex items-center justify-center w-6 h-6 rounded bg-green-500 flex-shrink-0 mt-0.5">
  //                               <span className="text-white text-xs font-semibold">
  //                                 S
  //                               </span>
  //                             </div>
  //                             <div className="flex-1 min-w-0">
  //                               <span className="text-sm text-foreground">
  //                                 {displayText}
  //                               </span>
  //                               {needsTruncation && (
  //                                 <button
  //                                   onClick={() =>
  //                                     toggleStoryExpansion(storyId)
  //                                   }
  //                                   className="text-xs text-primary hover:underline ml-1"
  //                                 >
  //                                   {isExpanded ? "read less" : "read more"}
  //                                 </button>
  //                               )}
  //                             </div>
  //                             <span className="text-xs text-muted-foreground flex-shrink-0 whitespace-nowrap ml-2">
  //                               #{storyId}
  //                             </span>
  //                           </div>
  //                         </div>
  //                       );
  //                     })}
  //                   </div>
  //                 )}
  //               </div>
  //             );
  //           })}
  //         </div>
  //       ) : (
  //         <div className="px-4 py-2 pl-12 text-xs text-muted-foreground">
  //           No features found for this epic
  //         </div>
  //       )}
  //     </div>
  //   );
  // };

  // Close details dialog when main modal closes
  useEffect(() => {
    if (!open) {
      setDetailsDialogOpen(false);
      setSelectedState(null);
      setExpandedStories(new Set());
    }
  }, [open]);

  // Reset expanded stories when selected state changes
  useEffect(() => {
    setExpandedStories(new Set());
  }, [selectedState]);

  return (
    <>
      <GenericModal
        open={open}
        onOpenChange={onClose}
        title={`Development Progress`}
        description="Track user story completion status"
        icon={TrendingUp}
        iconClassName="bg-gradient-to-br from-purple-500 to-purple-600"
        fullScreen={true}
        contentClassName="flex items-center justify-center min-h-0"
        headerActions={
          <div className="flex items-center gap-2">
            <Select
              value={selectedSprintPath || undefined}
              onValueChange={(value) => {
                if (value) {
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
                {allSprints.length > 0 ? (
                  allSprints.map((sprint) => (
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
                  ))
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
              disabled={refreshing || refreshingSprint}
              className="h-8 w-8 p-0 flex items-center justify-center"
              aria-label="Refresh backlog"
            >
              <RefreshCw
                className={`h-4 w-4 ${refreshing || refreshingSprint ? "animate-spin" : ""}`}
              />
            </Button>
          </div>
        }
      >

      {integrationType === 'ado' && !hasAdoConfig ? (
        <Card className="mt-6 border-yellow-200 dark:border-yellow-800">
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
      ) : integrationType === 'jira' && !backlogData && !loading ? (
        <Card className="mt-6">
          <CardContent className="pt-6 text-center space-y-4">
            <Layers className="h-12 w-12 text-blue-500 mx-auto" />
            <h3 className="text-lg font-semibold">No Progress Data Available</h3>
            <p className="text-muted-foreground">
              Please ensure your {getIntegrationLabels(integrationType).name} project is correctly configured and has active epics or stories.
            </p>
          </CardContent>
        </Card>
      ) : loading ? (
          <Card className="mt-6">
            <CardContent className="pt-6">
              <p className="text-center text-muted-foreground py-8">
                Loading development progress...
              </p>
            </CardContent>
          </Card>
        ) : backlogData ? (
            <div className="flex flex-col space-y-6 pr-4 pb-4">
              {/* Message when no sprint is selected */}
              {!selectedSprintPath && (
                <Card className="bg-blue-50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-800">
                  <CardContent className="pt-6 pb-6">
                    <div className="flex items-center gap-3">
                      <AlertCircle className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                      <div>
                        <div className="font-semibold text-blue-900 dark:text-blue-100">
                          Select a Sprint
                        </div>
                        <div className="text-sm text-blue-700 dark:text-blue-300 mt-1">
                          Please select a sprint from the dropdown above to view sprint-specific progress data.
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Sprint Information */}
              {selectedSprintPath && sprintData?.sprint && sprintData.sprint.startDate && sprintData.sprint.endDate && (() => {
                const startDate = new Date(sprintData.sprint.startDate);
                const endDate = new Date(sprintData.sprint.endDate);
                const daysDiff = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)) + 1; // +1 to include both start and end days
                const formattedStartDate = startDate.toLocaleDateString('en-GB', { day: 'numeric', month: 'numeric', year: 'numeric' });
                const formattedEndDate = endDate.toLocaleDateString('en-GB', { day: 'numeric', month: 'numeric', year: 'numeric' });
                const spilloverStories = sprintData.metrics.spilloverStories || 0;
                const spilloverPoints = sprintData.metrics.spilloverStoryPoints || 0;
                
                return (
                  <Card className="bg-blue-50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-800">
                    <CardContent className="pt-3 pb-3">
                      <div className="flex items-center justify-between mb-3">
                        <div className="text-sm text-muted-foreground">
                          {formattedStartDate} - {formattedEndDate}
                    </div>
                        <div className="text-sm font-semibold text-bluee-600 dark:text-blue-400">
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
                        <div className="mt-3 pt-3 border-t border-blue-200 dark:border-blue-800">
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

              {/* Overall Progress and Burndown Indicators - Side by Side */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Overall Progress */}
                <Card className="bg-blue-50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-800">
                <CardHeader>
                    <CardTitle className="text-lg">Overall Progress</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                      <div className="flex items-center justify-between">
                        <span className="text-2xl font-bold">
                          {completionPercentage}%
                          </span>
                        </div>
                      <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-4">
                        <div
                          className="bg-gradient-to-r from-green-500 to-emerald-500 h-4 rounded-full transition-all duration-500"
                          style={{ width: `${completionPercentage}%` }}
                          />
                        </div>
                       <div className="flex items-center gap-2 pt-1">
                            <span className="text-1xl text-muted-foreground">
                          {completedUserStories} of {totalUserStories} stories
                          completed
                        </span>
                        </div>
                  </div>
                </CardContent>
              </Card>

              {/* Dynamic Board View - Columns for each state */}
              {/* Show New, Active, In Progress, Resolved, Closed, and Reopened (if applicable) */}
              {/* Note: State list calculation moved below */}

                {/* Burndown Indicators */}
                <Card className="bg-gradient-to-br from-blue-50 to-indigo-50 dark:from-blue-950/20 dark:to-indigo-950/20 border-blue-200 dark:border-blue-800">
                      <CardHeader>
                    <CardTitle className="text-base flex items-center gap-2">
                      <TrendingUp className="h-5 w-5 text-blue-600" />
                      Burndown Indicators
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                    <div className="space-y-6 py-4">
                      {(() => {
                        // Use sprint data if available, otherwise fallback to backlog data
                        const useSprintData = sprintData?.sprint && sprintData.metrics;
                        
                        // Story Points Progress
                        let storyPointsPercentage = 0;
                        let totalStoryPoints = 0;
                        let completedStoryPoints = 0;
                        let hasStoryPoints: boolean = false;
                        
                        if (useSprintData) {
                          totalStoryPoints = sprintData.metrics.totalStoryPoints;
                          completedStoryPoints = sprintData.metrics.completedStoryPoints;
                          storyPointsPercentage = totalStoryPoints > 0 
                            ? Math.round((completedStoryPoints / totalStoryPoints) * 100) 
                            : 0;
                          // Show story points indicator if there are stories in sprint, even if points are 0
                          // This helps users see that stories exist but need points assigned
                          hasStoryPoints = sprintData.metrics.totalStories > 0;
                        } else {
                          storyPointsPercentage = backlogData.velocity?.completionRate || 0;
                          totalStoryPoints = backlogData.velocity?.totalStoryPoints || 0;
                          completedStoryPoints = backlogData.velocity?.completedStoryPoints || 0;
                          hasStoryPoints = !!(backlogData.velocity && backlogData.velocity.totalStoryPoints > 0);
                        }
                        
                        // Epic Progress - Always use backlog data (epics are project-wide, not sprint-specific)
                        let totalEpics = backlogData.summary?.totalEpics || 0;
                        let closedEpics = backlogData.stateCounts?.["Closed"]?.epics || 0;
                        let epicPercentage = totalEpics > 0 ? Math.round((closedEpics / totalEpics) * 100) : 0;
                        let hasEpics = totalEpics > 0;
                        
                        // Feature Progress - Always use backlog data (features are project-wide, not sprint-specific)
                        let totalFeatures = backlogData.summary?.totalFeatures || 0;
                        let closedFeatures = backlogData.stateCounts?.["Closed"]?.features || 0;
                        let featurePercentage = totalFeatures > 0 ? Math.round((closedFeatures / totalFeatures) * 100) : 0;
                        let hasFeatures = totalFeatures > 0;
                        
                        // Colors for each indicator
                        const storyPointsColor = '#10b981'; // Green/Teal
                        const epicColor = '#a855f7'; // Purple
                        const featureColor = '#3b82f6'; // Blue
                        
                        // Helper function to create circular progress indicator
                        const createCircularProgress = (percentage: number, color: string, size: number = 80) => {
                          const radius = size / 2 - 8;
                          const circumference = 2 * Math.PI * radius;
                          const offset = circumference - (percentage / 100) * circumference;
                          const center = size / 2;

                                      return (
                            <div className="relative" style={{ width: `${size}px`, height: `${size}px` }}>
                              <svg width={size} height={size} className="transform -rotate-90">
                                <circle
                                  cx={center}
                                  cy={center}
                                  r={radius}
                                  stroke="currentColor"
                                  strokeWidth="6"
                                  fill="none"
                                  className="text-gray-200 dark:text-gray-700"
                                />
                                <circle
                                  cx={center}
                                  cy={center}
                                  r={radius}
                                  stroke={color}
                                  strokeWidth="6"
                                  fill="none"
                                  strokeLinecap="round"
                                  strokeDasharray={circumference}
                                  strokeDashoffset={offset}
                                  className="transition-all duration-500"
                                />
                              </svg>
                              <div className="absolute inset-0 flex items-center justify-center">
                                <span className="text-base font-bold" style={{ color }}>
                                  {percentage}%
                                              </span>
                                            </div>
                                          </div>
                          );
                        };

                                                  return (
                          <div className="space-y-6">
                            {/* Story Points Progress */}
                            {hasStoryPoints && (
                              <div className="flex items-center gap-4">
                                {createCircularProgress(storyPointsPercentage, storyPointsColor)}
                                <div className="flex-1">
                                  <div className="text-sm font-semibold mb-1" style={{ color: storyPointsColor }}>
                                    Story Points Progress
                                                        </div>
                                  <div className="text-xs text-muted-foreground">
                                    {completedStoryPoints} / {totalStoryPoints} pts
                                    {useSprintData && totalStoryPoints === 0 && (
                                      <span className="text-orange-500 ml-1">(No points assigned)</span>
                                                          )}
                                                        </div>
                                  {totalStoryPoints > 0 && (
                                    <div className="text-xs text-muted-foreground mt-1">
                                      Remaining: {totalStoryPoints - completedStoryPoints} pts
                                                      </div>
                                              )}
                                  {useSprintData && totalStoryPoints === 0 && (
                                    <div className="text-xs text-orange-500 mt-1">
                                      Assign story points to track progress
                                            </div>
                                          )}
                                        </div>
                                  </div>
                                )}

                            {/* Epic Progress and Feature Progress - Side by Side */}
                            {(hasEpics || hasFeatures) && (
                              <div className="grid grid-cols-2 gap-4">
                                {/* Epic Progress */}
                                {hasEpics && (
                                  <div className="flex items-center gap-4">
                                    {createCircularProgress(epicPercentage, epicColor)}
                                    <div className="flex-1">
                                      <div className="text-sm font-semibold mb-1" style={{ color: epicColor }}>
                                        Epic Progress
                                              </div>
                                      <div className="text-xs text-muted-foreground">
                                        {closedEpics} / {totalEpics} ({epicPercentage}%)
                                      </div>
                                    </div>
                                  </div>
                                )}
                                
                                {/* Feature Progress */}
                                {hasFeatures && (
                                  <div className="flex items-center gap-4">
                                    {createCircularProgress(featurePercentage, featureColor)}
                                    <div className="flex-1">
                                      <div className="text-sm font-semibold mb-1" style={{ color: featureColor }}>
                                        Feature Progress
                                              </div>
                                      <div className="text-xs text-muted-foreground">
                                        {closedFeatures} / {totalFeatures} ({featurePercentage}%)
                                            </div>
                                          </div>
                                    </div>
                                  )}
                              </div>
                            )}
                            
                            {!hasStoryPoints && !hasEpics && !hasFeatures && (
                              <div className="text-center text-muted-foreground py-8">
                                No progress data available
                                </div>
                              )}
                          </div>
                  );
                })()}
              </div>
                  </CardContent>
                </Card>
              </div>

            </div>

        ) : (
          <Card className="mt-6">
            <CardContent className="pt-6">
              <p className="text-center text-muted-foreground py-8">
                No data available
              </p>
            </CardContent>
          </Card>
        )}
      </GenericModal>
    </>
  );
}

