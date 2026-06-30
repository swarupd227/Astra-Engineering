import { useState, useEffect } from "react";
import { GenericModal } from "@/components/ui/generic-modal";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { getIntegrationLabels } from "@/lib/integration-config";
import {
  RefreshCw,
  AlertTriangle,
  TrendingUp,
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

interface StatusModalProps {
  projectId: string;
  adoProject?: ADOProject;
  integrationType?: string;
  status: "New" | "Active" | "Resolved" | "Closed" | "Reopened";
  open: boolean;
  onClose: () => void;
}

interface BacklogContextResponse {
  availableStates: string[];
  stateCounts: Record<string, {
    epics: number;
    features: number;
    userStories: number;
    total: number;
  }>;
  artifactsByState: Record<string, {
    epics: any[];
    features: any[];
    userStories: any[];
  }>;
  summary: {
    totalEpics: number;
    totalFeatures: number;
    totalUserStories: number;
    totalArtifacts: number;
  };
}

export function StatusModal({ projectId, adoProject, integrationType = "ado", status, open, onClose }: StatusModalProps) {
  const { toast } = useToast();
  const [refreshing, setRefreshing] = useState(false);
  const [expandedStories, setExpandedStories] = useState<Set<number>>(new Set());
  
  // Build query params for ADO project info
  const params = new URLSearchParams();
  if (adoProject?.organization) {
    params.append('organization', adoProject.organization);
  }
  if (adoProject?.name) {
    params.append('projectName', adoProject.name);
  }
  const queryString = params.toString();

  // Create unique query key based on projectId and adoProject
  const queryKey = [
    '/api/sdlc/projects',
    projectId,
    getIntegrationLabels(integrationType).backlogContextUrl,
    adoProject?.organization,
    adoProject?.name,
  ];

  // Fetch ADO config (cached)
  const { data: adoConfig, error: configError } = useQuery<{ hasConfig: boolean; organization: string; project: string }>({
    queryKey: [`/api/sdlc/projects/${projectId}/ado-config`, queryString],
    queryFn: async () => {
      const configUrl = getApiUrl(`/api/sdlc/projects/${projectId}/ado-config${queryString ? `?${queryString}` : ''}`);
      const configRes = await fetch(configUrl, { credentials: "include" });
      
      if (!configRes.ok) {
        throw new Error(`Configuration check failed: ${configRes.status} ${configRes.statusText}`);
      }
      return configRes.json();
    },
    enabled: open && integrationType === "ado",
    staleTime: 5 * 60 * 1000, // 5 minutes
  });

  const hasAdoConfig = (adoConfig?.hasConfig ?? false) && integrationType === "ado";

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
    enabled: open && integrationType === "jira",
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });

  const hasJiraConfig = (jiraConfig?.exists || false) && integrationType === "jira";
  const hasConfig = hasAdoConfig || hasJiraConfig;

  // Fetch backlog context
  const { data: backlogData, isLoading: loading, error, refetch, isFetching } = useQuery<BacklogContextResponse>({
    queryKey,
    queryFn: async () => {
      if (!hasConfig) return null as any;

      const endpoint = `/api/sdlc/projects/${projectId}/${getIntegrationLabels(integrationType).backlogContextUrl}`;
      const url = getApiUrl(
        integrationType === 'ado' && queryString 
          ? `${endpoint}?${queryString}`
          : endpoint
      );
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) {
        throw new Error(`Failed to fetch backlog context: ${res.status} ${res.statusText}`);
      }
      return res.json();
    },
    enabled: open && hasConfig,
    staleTime: 30 * 1000, // 30 seconds
  });

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await refetch();
      toast({
        title: "Refreshed",
        description: "Backlog data has been refreshed.",
      });
    } catch (err) {
      toast({
        title: "Error",
        description: "Failed to refresh backlog data.",
        variant: "destructive",
      });
    } finally {
      setRefreshing(false);
    }
  };

  // Reset expanded stories when modal closes or status changes
  useEffect(() => {
    if (!open) {
      setExpandedStories(new Set());
    }
  }, [open]);

  useEffect(() => {
    setExpandedStories(new Set());
  }, [status]);

  // Get work item title from ADO work item
  const getWorkItemTitle = (item: any): string => {
    return item.fields?.['System.Title'] || item.title || 'Untitled';
  };

  // Truncate text to 10 words
  const truncateToWords = (text: string, wordLimit: number = 10): string => {
    const words = text.trim().split(/\s+/);
    if (words.length <= wordLimit) {
      return text;
    }
    return words.slice(0, wordLimit).join(' ') + '...';
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
      return typeof id === 'string' ? parseInt(id, 10) : id;
    };
    
    // Create maps for quick lookup with children array - use normalized IDs as keys
    const epicMap = new Map(epics.map((e: any) => {
      const id = normalizeId(e.id);
      return [id, { ...e, id, children: [] as any[], workItemType: 'Epic' }];
    }));
    const featureMap = new Map(features.map((f: any) => {
      const id = normalizeId(f.id);
      return [id, { ...f, id, children: [] as any[], workItemType: 'Feature' }];
    }));
    const storyMap = new Map(userStories.map((s: any) => {
      const id = normalizeId(s.id);
      return [id, { ...s, id, children: [] as any[], workItemType: 'User Story' }];
    }));
    
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
        }
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
    return {
      hierarchy: Array.from(epicMap.values()),
      featuresAddedAsChildren,
      storiesAddedAsChildren
    };
  };

  // Render tree node - simplified like workflow step2, always show all items
  const renderEpic = (epic: any, features: any[], stories: any[]) => {
    const epicId = typeof epic.id === 'string' ? parseInt(epic.id, 10) : epic.id;
    const epicTitle = getWorkItemTitle(epic);

    return (
      <div key={epicId} className="border-b border-border">
        {/* EPIC ROW */}
        <div className="flex items-center gap-2 px-4 py-3 hover:bg-muted/30 transition-colors">
          <div className="flex items-center justify-center w-6 h-6 rounded bg-purple-500 flex-shrink-0">
            <span className="text-white text-xs font-semibold">E</span>
          </div>
          <span className="font-medium text-foreground flex-1">
            <span className="text-muted-foreground font-normal">#{epicId}</span> {epicTitle}
          </span>
          {features.length > 0 && (
            <span className="text-sm text-muted-foreground flex-shrink-0">
              {features.length} features
            </span>
          )}
        </div>
        
        {/* FEATURES under EPIC - always show if any exist */}
        {features.length > 0 ? (
          <div className="bg-muted/20">
            {features.map((feature: any) => {
              const featureId = typeof feature.id === 'string' ? parseInt(feature.id, 10) : feature.id;
              const featureTitle = getWorkItemTitle(feature);
              
              // Get stories for this feature - check both parentId and relations
              const featureStories = stories.filter((s: any) => {
                const storyId = typeof s.id === 'string' ? parseInt(s.id, 10) : s.id;
                const sParentId = s.parentId !== null && s.parentId !== undefined 
                  ? (typeof s.parentId === 'string' ? parseInt(s.parentId, 10) : s.parentId) 
                  : null;
                
                // Check parentId first
                if (sParentId !== null && !isNaN(sParentId) && sParentId === featureId) {
                  return true;
                }
                
                // If no parentId or doesn't match, check relations
                if (s.relations && Array.isArray(s.relations)) {
                  const parentRelation = s.relations.find((rel: any) => 
                    rel.rel === 'System.LinkTypes.Hierarchy-Reverse'
                  );
                  if (parentRelation && parentRelation.url) {
                    // Try multiple URL patterns
                    const patterns = [
                      /\/workitems\/(\d+)/,
                      /workitems\/(\d+)/,
                      /\/_apis\/wit\/workitems\/(\d+)/,
                      /workitems\/(\d+)(?:\?|$)/,
                    ];
                    
                    for (const pattern of patterns) {
                      const parentIdMatch = parentRelation.url.match(pattern);
                      if (parentIdMatch) {
                        const parentId = parseInt(parentIdMatch[1]);
                        if (!isNaN(parentId) && parentId === featureId) {
                          return true;
                        }
                      }
                    }
                    
                    // Also try extracting from end of URL
                    const urlParts = parentRelation.url.split('/');
                    const lastPart = urlParts[urlParts.length - 1];
                    const idFromEnd = parseInt(lastPart.split('?')[0]);
                    if (!isNaN(idFromEnd) && idFromEnd === featureId) {
                      return true;
                    }
                  }
                }
                
                return false;
              });

              return (
                <div key={featureId} className="border-b border-border/50">
                  {/* FEATURE ROW */}
                  <div className="flex items-center gap-2 px-4 py-2.5 pl-12 hover:bg-muted/30 transition-colors">
                    <div className="flex items-center justify-center w-6 h-6 rounded bg-blue-500 flex-shrink-0">
                      <span className="text-white text-xs font-semibold">F</span>
                    </div>
                    <span className="text-sm text-foreground flex-1">
                      <span className="text-muted-foreground font-normal">#{featureId}</span> {featureTitle}
                    </span>
                    {featureStories.length > 0 && (
                      <span className="text-xs text-muted-foreground flex-shrink-0">
                        {featureStories.length} stories
                      </span>
                    )}
                  </div>
                  
                  {/* STORIES under FEATURE - always show if any exist */}
                  {featureStories.length > 0 && (
                    <div className="overflow-hidden">
                      {featureStories.map((story: any) => {
                        const storyId = typeof story.id === 'string' ? parseInt(story.id, 10) : story.id;
                        const storyTitle = getWorkItemTitle(story);
                        const isExpanded = expandedStories.has(storyId);
                        const words = storyTitle.trim().split(/\s+/);
                        const needsTruncation = words.length > 10;
                        const displayText = isExpanded || !needsTruncation ? storyTitle : truncateToWords(storyTitle, 10);
                        
                        return (
                          <div key={storyId} className="px-4 py-2 pl-24 hover:bg-muted/20 transition-colors border-b border-border/30">
                            <div className="flex items-start gap-2">
                              <div className="flex items-center justify-center w-6 h-6 rounded bg-green-500 flex-shrink-0 mt-0.5">
                                <span className="text-white text-xs font-semibold">S</span>
                              </div>
                              <div className="flex-1 min-w-0">
                                <span className="text-sm text-foreground">
                                  {displayText}
                                </span>
                                {needsTruncation && (
                                  <button
                                    onClick={() => toggleStoryExpansion(storyId)}
                                    className="text-xs text-primary hover:underline ml-1"
                                  >
                                    {isExpanded ? 'read less' : 'read more'}
                                  </button>
                                )}
                              </div>
                              <span className="text-xs text-muted-foreground flex-shrink-0 whitespace-nowrap ml-2">
                                #{storyId}
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="px-4 py-2 pl-12 text-xs text-muted-foreground">
            No features found for this epic
          </div>
        )}
      </div>
    );
  };

  // Get state color based on state name
  const getStateColor = (state: string): string => {
    const normalized = state.toLowerCase();
    if (normalized.includes('closed') || normalized.includes('done') || normalized.includes('completed')) {
      return 'bg-green-500';
    } else if (normalized.includes('resolved') || normalized.includes('testing') || normalized.includes('review')) {
      return 'bg-amber-500';
    } else if (normalized.includes('active') || normalized.includes('in progress')) {
      return 'bg-blue-500';
    } else if (normalized.includes('new') || normalized.includes('to do')) {
      return 'bg-blue-400';
    }
    return 'bg-gray-500';
  };

  return (
    <GenericModal
      open={open}
      onOpenChange={onClose}
      title={`${status} - Details`}
      description={`View all items in ${status} status`}
      icon={TrendingUp}
      iconClassName={`${getStateColor(status)}`}
         fullScreen={true}
      contentClassName="space-y-4"
    >
      {/* Refresh Button */}
      <div className="flex justify-end -mt-2 mb-4">
        <Button
          variant="ghost"
          size="sm"
          onClick={handleRefresh}
          disabled={refreshing || isFetching}
          className="h-8 w-8 p-0 flex items-center justify-center"
          aria-label="Refresh backlog"
        >
          <RefreshCw className={`h-4 w-4 ${refreshing || isFetching ? 'animate-spin' : ''}`} />
        </Button>
      </div>

        {!hasConfig ? (
          <Card className="mt-6">
            <CardContent className="pt-6">
              <div className="text-center space-y-4">
                <AlertTriangle className="h-12 w-12 text-yellow-500 mx-auto" />
                <h3 className="text-lg font-semibold">{getIntegrationLabels(integrationType).longName} Not Configured</h3>
                <p className="text-muted-foreground mt-2">
                  Please configure {getIntegrationLabels(integrationType).longName} credentials in Settings &gt; Central Settings to view {status.toLowerCase()} items.
                </p>
              </div>
            </CardContent>
          </Card>
        ) : loading ? (
          <Card className="mt-6">
            <CardContent className="pt-6">
              <p className="text-center text-muted-foreground py-8">
                Loading {status.toLowerCase()} items...
              </p>
            </CardContent>
          </Card>
        ) : backlogData ? (
          <div className="flex flex-col space-y-6 pr-2">
              {(() => {
                // Add null checks for artifactsByState and stateCounts
                const artifactsByState = backlogData.artifactsByState || {};
                const stateCounts = backlogData.stateCounts || {};
                
                const artifacts = artifactsByState[status] || {
                  epics: [],
                  features: [],
                  userStories: [],
                };

                const stateCount = stateCounts[status] || { epics: 0, features: 0, userStories: 0, total: 0 };

                // Collect ALL epics, features, and stories from ALL states to build complete hierarchy
                // This ensures parent-child relationships work even if parent is in different state
                const allEpics: any[] = [];
                const allFeatures: any[] = [];
                const allStories: any[] = [];
                
                // Safely iterate over artifactsByState if it exists
                if (artifactsByState && typeof artifactsByState === 'object') {
                  Object.values(artifactsByState).forEach((stateArtifacts: any) => {
                    allEpics.push(...(stateArtifacts?.epics || []));
                    allFeatures.push(...(stateArtifacts?.features || []));
                    allStories.push(...(stateArtifacts?.userStories || []));
                  });
                }

                // Build hierarchical tree using ALL items (so we can find parents across states)
                const { hierarchy, featuresAddedAsChildren, storiesAddedAsChildren } = buildHierarchy({
                  epics: allEpics,
                  features: allFeatures,
                  userStories: allStories
                });
                
                // Filter hierarchy to only show epics that are in the selected state
                const filteredHierarchy = hierarchy.filter((epic: any) => {
                  const epicState = epic.state || epic.fields?.['System.State'];
                  return epicState === status;
                });
                
                const totalItems = artifacts.epics.length + artifacts.features.length + artifacts.userStories.length;

                // Only show truly orphaned items (those without parents OR not already in hierarchy)
                const normalizeId = (id: any): number => typeof id === 'string' ? parseInt(id, 10) : id;
                const orphanedFeatures = artifacts.features.filter((f: any) => {
                  const featureId = normalizeId(f.id);
                  return !featuresAddedAsChildren.has(featureId) && (!f.parentId || f.parentId === null || f.parentId === undefined);
                });
                const orphanedStories = artifacts.userStories.filter((s: any) => {
                  const storyId = normalizeId(s.id);
                  return !storiesAddedAsChildren.has(storyId) && (!s.parentId || s.parentId === null || s.parentId === undefined);
                });
                
                return (
                  <Card>
                    <CardHeader>
                      <div className="flex items-center justify-between">
                        <CardTitle className="text-base">
                          {status} Items
                        </CardTitle>
                        <Badge className={`${getStateColor(status)} text-white`}>
                          {stateCount.total} total
                        </Badge>
                      </div>
                    </CardHeader>
                    <CardContent>
                      {totalItems === 0 ? (
                        <div className="text-center text-muted-foreground py-8">
                          No items found in {status} status
                        </div>
                      ) : (
                        <div className="space-y-0 border rounded-lg overflow-hidden">
                          {/* Render epics with their features and stories */}
                          {filteredHierarchy.length > 0 ? (
                            <div>
                              {filteredHierarchy.map((epic: any) => {
                                const epicId = typeof epic.id === 'string' ? parseInt(epic.id, 10) : epic.id;
                                
                                // Get features for this epic - check both parentId and relations
                                const epicFeatures = artifacts.features.filter((f: any) => {
                                  const featureState = f.state || f.fields?.['System.State'];
                                  if (featureState !== status) return false;
                                  
                                  const featureId = typeof f.id === 'string' ? parseInt(f.id, 10) : f.id;
                                  
                                  // Check parentId first
                                  if (f.parentId !== null && f.parentId !== undefined) {
                                    const fParentId = typeof f.parentId === 'string' ? parseInt(f.parentId, 10) : f.parentId;
                                    if (!isNaN(fParentId) && fParentId === epicId) {
                                      return true;
                                    }
                                  }
                                  
                                  // If no parentId or parentId doesn't match, check relations directly
                                  if (f.relations && Array.isArray(f.relations)) {
                                    const parentRelation = f.relations.find((rel: any) => 
                                      rel.rel === 'System.LinkTypes.Hierarchy-Reverse'
                                    );
                                    if (parentRelation && parentRelation.url) {
                                      // Try multiple URL patterns
                                      const patterns = [
                                        /\/workitems\/(\d+)/,
                                        /workitems\/(\d+)/,
                                        /\/_apis\/wit\/workitems\/(\d+)/,
                                        /workitems\/(\d+)(?:\?|$)/,
                                      ];
                                      
                                      for (const pattern of patterns) {
                                        const parentIdMatch = parentRelation.url.match(pattern);
                                        if (parentIdMatch) {
                                          const parentId = parseInt(parentIdMatch[1]);
                                          if (!isNaN(parentId) && parentId === epicId) {
                                            return true;
                                          }
                                        }
                                      }
                                      
                                      // Also try extracting from end of URL
                                      const urlParts = parentRelation.url.split('/');
                                      const lastPart = urlParts[urlParts.length - 1];
                                      const idFromEnd = parseInt(lastPart.split('?')[0]);
                                      if (!isNaN(idFromEnd) && idFromEnd === epicId) {
                                        return true;
                                      }
                                    }
                                  }   
                                  return false;
                                });
                                
                                const epicTitle = getWorkItemTitle(epic);
                                
                                // Get all stories in selected state (we'll filter by feature later)
                                const allStories = artifacts.userStories.filter((s: any) => {
                                  const storyState = s.state || s.fields?.['System.State'];
                                  return storyState === status;
                                });
                                
                                return renderEpic(epic, epicFeatures, allStories);
                              })}
                            </div>
                          ) : null}
                          
                          {/* Show orphaned items even if there are no epics */}
                          {filteredHierarchy.length === 0 && (
                            <>
                              {/* Render orphaned features */}
                              {orphanedFeatures.length > 0 && (
                                <div>
                                  {orphanedFeatures.map((feature: any) => {
                                    const featureId = typeof feature.id === 'string' ? parseInt(feature.id, 10) : feature.id;
                                    const featureTitle = getWorkItemTitle(feature);
                                    
                                    // Find stories that belong to this feature
                                    const featureStories = artifacts.userStories.filter((s: any) => {
                                      const storyState = s.state || s.fields?.['System.State'];
                                      if (storyState !== status) return false;
                                      
                                      const storyId = typeof s.id === 'string' ? parseInt(s.id, 10) : s.id;
                                      const sParentId = s.parentId !== null && s.parentId !== undefined 
                                        ? (typeof s.parentId === 'string' ? parseInt(s.parentId, 10) : s.parentId) 
                                        : null;
                                      
                                      // Check parentId first
                                      if (sParentId !== null && !isNaN(sParentId) && sParentId === featureId) {
                                        return true;
                                      }
                                      
                                      // Check relations if parentId is not available or doesn't match
                                      if (s.relations && Array.isArray(s.relations)) {
                                        const parentRelation = s.relations.find((rel: any) => 
                                          rel.rel === 'System.LinkTypes.Hierarchy-Reverse'
                                        );
                                        if (parentRelation && parentRelation.url) {
                                          // Try multiple URL patterns
                                          const patterns = [
                                            /\/workitems\/(\d+)/,
                                            /workitems\/(\d+)/,
                                            /\/_apis\/wit\/workitems\/(\d+)/,
                                            /workitems\/(\d+)(?:\?|$)/,
                                          ];
                                          
                                          for (const pattern of patterns) {
                                            const parentIdMatch = parentRelation.url.match(pattern);
                                            if (parentIdMatch) {
                                              const parentId = parseInt(parentIdMatch[1]);
                                              if (!isNaN(parentId) && parentId === featureId) {
                                                return true;
                                              }
                                            }
                                          }
                                          
                                          // Also try extracting from end of URL
                                          const urlParts = parentRelation.url.split('/');
                                          const lastPart = urlParts[urlParts.length - 1];
                                          const idFromEnd = parseInt(lastPart.split('?')[0]);
                                          if (!isNaN(idFromEnd) && idFromEnd === featureId) {
                                            return true;
                                          }
                                        }
                                      }
                                      
                                      return false;
                                    });
                                    
                                    return (
                                      <div key={featureId} className="border-b border-border">
                                        <div className="flex items-center gap-2 px-4 py-2.5 hover:bg-muted/30 transition-colors">
                                          <div className="flex items-center justify-center w-6 h-6 rounded bg-blue-500 flex-shrink-0">
                                            <span className="text-white text-xs font-semibold">F</span>
                                          </div>
                                          <span className="text-sm text-foreground flex-1">
                                            <span className="text-muted-foreground font-normal">#{featureId}</span> {featureTitle}
                                          </span>
                                        </div>
                                        {featureStories.length > 0 && (
                                          <div className="overflow-hidden">
                                            {featureStories.map((story: any) => {
                                              const storyId = typeof story.id === 'string' ? parseInt(story.id, 10) : story.id;
                                              const storyTitle = getWorkItemTitle(story);
                                              const isExpanded = expandedStories.has(storyId);
                                              const words = storyTitle.trim().split(/\s+/);
                                              const needsTruncation = words.length > 10;
                                              const displayText = isExpanded || !needsTruncation ? storyTitle : truncateToWords(storyTitle, 10);
                                              
                                              return (
                                                <div key={storyId} className="px-4 py-2 pl-12 hover:bg-muted/20 transition-colors border-b border-border/30">
                                                  <div className="flex items-start gap-2">
                                                    <div className="flex items-center justify-center w-6 h-6 rounded bg-green-500 flex-shrink-0 mt-0.5">
                                                      <span className="text-white text-xs font-semibold">S</span>
                                                    </div>
                                                    <div className="flex-1 min-w-0">
                                                      <span className="text-sm text-foreground">
                                                        {displayText}
                                                      </span>
                                                      {needsTruncation && (
                                                        <button
                                                          onClick={() => toggleStoryExpansion(storyId)}
                                                          className="text-xs text-primary hover:underline ml-1"
                                                        >
                                                          {isExpanded ? 'read less' : 'read more'}
                                                        </button>
                                                      )}
                                                    </div>
                                                    <span className="text-xs text-muted-foreground flex-shrink-0 whitespace-nowrap ml-2">
                                                      #{storyId}
                                                    </span>
                                                  </div>
                                                </div>
                                              );
                                            })}
                                          </div>
                                        )}
                                      </div>
                                    );
                                  })}
                                </div>
                              )}
                              
                              {/* Render orphaned stories */}
                              {orphanedFeatures.length === 0 && orphanedStories.length > 0 && (
                                <div className="overflow-hidden">
                                  {orphanedStories.map((story: any) => {
                                    const storyId = typeof story.id === 'string' ? parseInt(story.id, 10) : story.id;
                                    const storyTitle = getWorkItemTitle(story);
                                    const isExpanded = expandedStories.has(storyId);
                                    const words = storyTitle.trim().split(/\s+/);
                                    const needsTruncation = words.length > 10;
                                    const displayText = isExpanded || !needsTruncation ? storyTitle : truncateToWords(storyTitle, 10);
                                    
                                    return (
                                      <div key={storyId} className="px-4 py-2 hover:bg-muted/30 transition-colors border-b border-border/30">
                                        <div className="flex items-start gap-2">
                                          <div className="flex items-center justify-center w-6 h-6 rounded bg-green-500 flex-shrink-0 mt-0.5">
                                            <span className="text-white text-xs font-semibold">S</span>
                                          </div>
                                          <div className="flex-1 min-w-0">
                                            <span className="text-sm text-foreground">
                                              {displayText}
                                            </span>
                                            {needsTruncation && (
                                              <button
                                                onClick={() => toggleStoryExpansion(storyId)}
                                                className="text-xs text-primary hover:underline ml-1"
                                              >
                                                {isExpanded ? 'read less' : 'read more'}
                                              </button>
                                            )}
                                          </div>
                                          <span className="text-xs text-muted-foreground flex-shrink-0 whitespace-nowrap ml-2">
                                            #{storyId}
                                          </span>
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                              )}
                            </>
                          )}
                          
                          {/* Show message if no items at all */}
                          {filteredHierarchy.length === 0 && orphanedFeatures.length === 0 && orphanedStories.length === 0 && (
                            <div className="text-center text-muted-foreground py-4">
                              No items to display
                            </div>
                          )}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                );
              })()}
            </div>
        ) : (
          <Card>
            <CardContent className="pt-6">
              <p className="text-center text-muted-foreground py-8">
                No data available
              </p>
            </CardContent>
          </Card>
        )}
    </GenericModal>
  );
}

