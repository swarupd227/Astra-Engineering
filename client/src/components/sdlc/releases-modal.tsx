import { useState, useEffect, useMemo } from "react";
import { GenericModal } from "@/components/ui/generic-modal";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import {
  Package,
  RefreshCw,
  CheckCircle2,
  XCircle,
  Clock,
  AlertTriangle,
  ExternalLink,
  Tag,
  User,
  Calendar,
  GitCommit,
  Link2,
  Server,
  BookOpen,
  Code,
  FileCode,
  Layers,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useQuery } from "@tanstack/react-query";
import { getApiUrl } from "@/lib/api-config";

interface ADOProject {
  id: string;
  name: string;
  organization: string;
}

interface ReleasesModalProps {
  projectId: string;
  adoProject: ADOProject;
  open: boolean;
  onClose: () => void;
}

interface Release {
  id: number;
  name: string;
  status: string;
  createdOn: string;
  createdBy: {
    displayName: string;
  };
  environments: Array<{
    id: number;
    name: string;
    status: string;
  }>;
  _links: {
    web: {
      href: string;
    };
  };
}

export function ReleasesModal({ projectId, adoProject, open, onClose }: ReleasesModalProps) {
  const { toast } = useToast();
  
  const [expandedReleaseId, setExpandedReleaseId] = useState<number | null>(null);
  const [releaseDetails, setReleaseDetails] = useState<Record<number, any>>({});
  const [loadingDetails, setLoadingDetails] = useState<Record<number, boolean>>({});
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

  // Fetch ADO config
  const { data: adoConfig, error: configError } = useQuery<{ hasConfig: boolean; organization: string; project: string }>({
    queryKey: [`/api/sdlc/projects/${projectId}/ado-config`, queryString],
    queryFn: async () => {
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
    enabled: open && !!projectId && !!adoProject,
    staleTime: 5 * 60 * 1000,
  });

  const hasAdoConfig = adoConfig?.hasConfig || false;

  // Fetch sprints
  const { data: allSprints = [] } = useQuery<Array<{ path: string; name: string; startDate?: string; endDate?: string }>>({
    queryKey: [`/api/sdlc/projects/${projectId}/ado/sprints`, queryString],
    queryFn: async () => {
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
        console.warn(`[ReleasesModal] Failed to fetch sprints: ${sprintsRes.status}`, errorText);
        return [];
      }

      const sprints = await sprintsRes.json();
      return sprints;
    },
    enabled: open && !!projectId && hasAdoConfig,
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

  // Fetch releases
  const { 
    data: releasesData, 
    isLoading: loading, 
    isFetching: refreshing,
    error: releasesError,
    refetch: refetchReleases 
  } = useQuery<{ value: Release[] } | Release[]>({
    queryKey: [`/api/sdlc/projects/${projectId}/ado/releases`, queryString, selectedSprintPath],
    queryFn: async () => {
      if (!hasAdoConfig) return { value: [] };
      const releasesQuery = new URLSearchParams(queryString);
      if (selectedSprintPath) {
        // URLSearchParams.set() already handles encoding, so we don't need encodeURIComponent
        releasesQuery.set('sprintPath', selectedSprintPath);
      }
      const url = getApiUrl(`/api/sdlc/projects/${projectId}/ado/releases${releasesQuery.toString() ? `?${releasesQuery.toString()}` : ''}`);
      // Add cache-busting when sprint is selected to ensure fresh data
      const fetchUrl = selectedSprintPath ? `${url}&_t=${Date.now()}` : url;
      const res = await fetch(fetchUrl, { 
        credentials: "include",
        cache: selectedSprintPath ? 'no-cache' : 'default'
      });
      
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(errorData.error || `Failed to fetch releases: ${res.status} ${res.statusText}`);
      }

      return res.json();
    },
    enabled: open && !!projectId && hasAdoConfig,
    staleTime: selectedSprintPath ? 0 : 2 * 60 * 1000,
    gcTime: selectedSprintPath ? 0 : 5 * 60 * 1000,
  });

  const releases = useMemo(() => {
    if (!releasesData) return [];
    const data = releasesData as { value?: Release[] } | Release[];
    return Array.isArray(data) ? data : (data.value || []);
  }, [releasesData]);

  const handleRefresh = async () => {
    await refetchReleases();
  };

  const fetchReleaseDetails = async (releaseId: number) => {
    if (releaseDetails[releaseId]) {
      // Already fetched, just toggle
      setExpandedReleaseId(expandedReleaseId === releaseId ? null : releaseId);
      return;
    }

    setLoadingDetails(prev => ({ ...prev, [releaseId]: true }));
    try {
      const params = new URLSearchParams();
      params.append('organization', adoProject.organization);
      params.append('projectName', adoProject.name);

      const detailsUrl = getApiUrl(`/api/sdlc/projects/${projectId}/ado/releases/${releaseId}/details?${params.toString()}`);
      const detailsRes = await fetch(detailsUrl, { credentials: "include" });
      
      // Check content type before parsing
      const contentType = detailsRes.headers.get("content-type");
      if (!contentType || !contentType.includes("application/json")) {
        const text = await detailsRes.text();
        console.error("[Releases Modal] Server returned non-JSON response:", text.substring(0, 200));
        toast({
          title: "Invalid Response",
          description: "Server returned an invalid response. Please check your Azure DevOps configuration.",
          variant: "destructive",
        });
        return;
      }
      
      if (detailsRes.ok) {
        try {
          const data = await detailsRes.json();
          setReleaseDetails(prev => ({ ...prev, [releaseId]: data }));
          setExpandedReleaseId(releaseId);
        } catch (parseError: any) {
          console.error("[Releases Modal] Error parsing JSON response:", parseError);
          toast({
            title: "Parse Error",
            description: "Failed to parse server response. Please try again.",
            variant: "destructive",
          });
        }
      } else {
        try {
          const errorData = await detailsRes.json();
          toast({
            title: "Failed to fetch release details",
            description: errorData.error || `Server returned ${detailsRes.status}`,
            variant: "destructive",
          });
        } catch (parseError: any) {
          const errorText = await detailsRes.text();
          toast({
            title: "Failed to fetch release details",
            description: `Server returned ${detailsRes.status}: ${errorText.substring(0, 100)}`,
            variant: "destructive",
          });
        }
      }
    } catch (error: any) {
      console.error("Error fetching release details:", error);
      toast({
        title: "Error",
        description: error.message || "Failed to fetch release details",
        variant: "destructive",
      });
    } finally {
      setLoadingDetails(prev => ({ ...prev, [releaseId]: false }));
    }
  };

  const getStatusIcon = (status: string) => {
    if (status === "active") return <CheckCircle2 className="h-4 w-4 text-green-600" />;
    if (status === "rejected" || status === "abandoned") return <XCircle className="h-4 w-4 text-red-600" />;
    if (status === "draft") return <Clock className="h-4 w-4 text-gray-600" />;
    return <Package className="h-4 w-4 text-blue-600" />;
  };

  const getStatusColor = (status: string) => {
    if (status === "active") return "bg-green-500";
    if (status === "rejected" || status === "abandoned") return "bg-red-500";
    if (status === "draft") return "bg-gray-500";
    return "bg-blue-500";
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

  const totalReleases = releases.length;

  const extractChangeType = (releaseName: string) => {
    const name = releaseName.toLowerCase();
    if (name.includes('feat') || name.includes('feature')) return { type: 'Feature', color: 'bg-blue-500' };
    if (name.includes('fix') || name.includes('bugfix')) return { type: 'Fix', color: 'bg-red-500' };
    if (name.includes('chore')) return { type: 'Chore', color: 'bg-gray-500' };
    if (name.includes('refactor')) return { type: 'Refactor', color: 'bg-purple-500' };
    return { type: 'Release', color: 'bg-indigo-500' };
  };

  // Handle errors
  useEffect(() => {
    if (configError) {
      toast({
        title: "Configuration Error",
        description: configError instanceof Error ? configError.message : "Failed to fetch ADO configuration",
        variant: "destructive",
      });
    }
    if (releasesError) {
      toast({
        title: "Error",
        description: releasesError instanceof Error ? releasesError.message : "Failed to fetch releases",
        variant: "destructive",
      });
    }
  }, [configError, releasesError, toast]);

  return (
    <GenericModal
      open={open}
      onOpenChange={onClose}
      title="Releases"
      description="Azure DevOps Release Management"
      icon={Package}
      iconClassName="bg-gradient-to-br from-indigo-500 to-indigo-600"
      fullScreen={true}
      contentClassName="space-y-4"
      headerActions={
        <div className="flex items-center gap-2">
          <Select
            value={selectedSprintPath || "all"}
            onValueChange={(value) => {
              if (value === "all") {
                setSelectedSprintPath(null);
              } else {
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
            disabled={refreshing}
          >
            <RefreshCw
              className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`}
            />
          </Button>
        </div>
      }
    >

      {!hasAdoConfig ? (
        <Card>
          <CardContent className="pt-6">
            <div className="text-center space-y-4">
              <AlertTriangle className="h-12 w-12 text-yellow-500 mx-auto" />
              <h3 className="text-lg font-semibold">No Data Available</h3>
              <p className="text-muted-foreground">
                No data is available for this metric at the moment.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : loading ? (
        <Card>
          <CardContent className="pt-6">
            <p className="text-center text-muted-foreground py-8">
              Loading releases...
            </p>
          </CardContent>
          </Card>
        ) : (
          <div className="flex-1 overflow-hidden flex flex-col space-y-6">
            {/* Statistics Card */}
            <Card className="border-indigo-200 dark:border-indigo-800">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                  <Package className="h-4 w-4 text-indigo-600" />
                  Total Releases
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-4xl font-bold text-indigo-600">
                  {totalReleases}
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  All releases
                </p>
              </CardContent>
            </Card>

            {/* Releases List */}
            <Card >
              <CardHeader>
                <CardTitle className="text-base">Recent Releases</CardTitle>
              </CardHeader>
              <CardContent >
                <ScrollArea className="h-[3000px] pr-4">
                  <div className="space-y-2">
                    {releases.length === 0 ? (
                      <p className="text-center text-muted-foreground py-8">
                        No releases found
                      </p>
                    ) : (
                      releases.map((release) => {
                        const changeType = extractChangeType(release.name);
                        return (
                          <Card
                            key={release.id}
                            className="hover-elevate transition-all"
                          >
                            <CardContent className="p-4">
                              <div className="space-y-3">
                                {/* Header with Tag Name and Status */}
                                <div className="flex items-start justify-between gap-4">
                                  <div className="flex items-center gap-2 flex-1">
                                    <Tag className="h-5 w-5 text-indigo-600 flex-shrink-0" />
                                    <span className="font-semibold text-base">
                                      {release.name}
                                    </span>
                                    <Badge className={`${getStatusColor(release.status)} text-white text-xs`}>
                                      {release.status}
                                    </Badge>
                                    <Badge className={`${changeType.color} text-white text-xs`}>
                                      {changeType.type}
                                    </Badge>
                                  </div>
                                  {release._links?.web?.href && (
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      asChild
                                    >
                                      <a
                                        href={release._links.web.href}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="flex items-center gap-1"
                                      >
                                        <ExternalLink className="h-3 w-3" />

                                      </a>
                                    </Button>
                                  )}
                                </div>

                                {/* Release Details Grid */}
                                <div className="grid grid-cols-2 gap-3 text-sm">
                                  {/* Author */}
                                  <div className="flex items-start gap-2">
                                    <User className="h-4 w-4 text-muted-foreground mt-0.5 flex-shrink-0" />
                                    <div>
                                      <div className="text-xs text-muted-foreground">Author</div>
                                      <div className="font-medium">
                                        {release.createdBy?.displayName || 'Unknown'}
                                      </div>
                                    </div>
                                  </div>

                                  {/* Created Date */}
                                  <div className="flex items-start gap-2">
                                    <Calendar className="h-4 w-4 text-muted-foreground mt-0.5 flex-shrink-0" />
                                    <div>
                                      <div className="text-xs text-muted-foreground">Created Date</div>
                                      <div className="font-medium">
                                        {new Date(release.createdOn).toLocaleDateString('en-US', {
                                          year: 'numeric',
                                          month: 'short',
                                          day: 'numeric'
                                        })}
                                      </div>
                                    </div>
                                  </div>

                                  {/* Change Type */}
                                  <div className="flex items-start gap-2">
                                    <GitCommit className="h-4 w-4 text-muted-foreground mt-0.5 flex-shrink-0" />
                                    <div>
                                      <div className="text-xs text-muted-foreground">Change Type</div>
                                      <div className="font-medium">{changeType.type}</div>
                                    </div>
                                  </div>

                                  {/* Status */}
                                  <div className="flex items-start gap-2">
                                    {getStatusIcon(release.status)}
                                    <div>
                                      <div className="text-xs text-muted-foreground">Status</div>
                                      <div className="font-medium capitalize">{release.status}</div>
                                    </div>
                                  </div>
                                </div>

                                {/* Deployed Environments */}
                                {release.environments && release.environments.length > 0 && (
                                  <div className="pt-2 border-t">
                                    <div className="flex items-center gap-2 mb-2">
                                      <Server className="h-4 w-4 text-muted-foreground" />
                                      <span className="text-xs text-muted-foreground font-medium">
                                        Deployed Environments
                                      </span>
                                    </div>
                                    <div className="flex flex-wrap gap-2">
                                      {release.environments.map((env) => (
                                        <div
                                          key={env.id}
                                          className="flex items-center gap-2 px-3 py-1.5 bg-background rounded-md border"
                                        >
                                          <span className="text-sm font-medium">{env.name}</span>
                                          <Badge
                                            variant="outline"
                                            className={`text-xs ${
                                              env.status === 'succeeded' ? 'bg-green-50 text-green-700 border-green-200' :
                                              env.status === 'failed' ? 'bg-red-50 text-red-700 border-red-200' :
                                              'bg-blue-50 text-blue-700 border-blue-200'
                                            }`}
                                          >
                                            {env.status}
                                          </Badge>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                )}

                                {/* Linked User Stories */}
                                <div className="pt-2 border-t">
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="w-full justify-between"
                                    onClick={() => fetchReleaseDetails(release.id)}
                                    disabled={loadingDetails[release.id]}
                                  >
                                    <div className="flex items-center gap-2">
                                      <BookOpen className="h-4 w-4 text-muted-foreground" />
                                      <span className="text-xs text-muted-foreground font-medium">
                                        Linked User Stories
                                      </span>
                                    </div>
                                    {loadingDetails[release.id] ? (
                                      <RefreshCw className="h-3 w-3 animate-spin" />
                                    ) : (
                                      <span className="text-xs text-muted-foreground">
                                        {expandedReleaseId === release.id ? 'Hide' : 'Show'}
                                      </span>
                                    )}
                                  </Button>

                                  {expandedReleaseId === release.id && releaseDetails[release.id] && (
                                    <div className="mt-3 space-y-3">
                                      {releaseDetails[release.id].userStories && releaseDetails[release.id].userStories.length > 0 ? (
                                        releaseDetails[release.id].userStories.map((story: any, idx: number) => {
                                          const storyId = story.id || story.fields?.['System.Id'];
                                          const storyTitle = story.fields?.['System.Title'] || story.title || 'Untitled';
                                          const storyState = story.fields?.['System.State'] || story.state || 'Unknown';
                                          
                                          return (
                                            <Card key={idx} className="p-3 bg-muted/50">
                                              <div className="space-y-2">
                                                <div className="flex items-start justify-between gap-2">
                                                  <div className="flex-1">
                                                    <a
                                                      href={story.url || `https://dev.azure.com/${adoProject.organization}/${adoProject.name}/_workitems/edit/${storyId}`}
                                                      target="_blank"
                                                      rel="noopener noreferrer"
                                                      className="font-medium text-sm hover:underline flex items-center gap-1"
                                                    >
                                                      User Story {storyId}: {storyTitle}
                                                      <ExternalLink className="h-3 w-3" />
                                                    </a>
                                                    <Badge variant="outline" className="mt-1 text-xs">
                                                      {storyState}
                                                    </Badge>
                                                  </div>
                                                </div>

                                                {/* Linked Items */}
                                                <div className="grid grid-cols-2 gap-2 text-xs">
                                                  {story.linkedPRs && story.linkedPRs.length > 0 && (
                                                    <div className="flex items-center gap-1 text-muted-foreground">
                                                      <GitCommit className="h-3 w-3" />
                                                      <span>{story.linkedPRs.length} PR{story.linkedPRs.length !== 1 ? 's' : ''}</span>
                                                    </div>
                                                  )}
                                                  {story.linkedCommits && story.linkedCommits.length > 0 && (
                                                    <div className="flex items-center gap-1 text-muted-foreground">
                                                      <Code className="h-3 w-3" />
                                                      <span>{story.linkedCommits.length} Commit{story.linkedCommits.length !== 1 ? 's' : ''}</span>
                                                    </div>
                                                  )}
                                                  {story.linkedBuilds && story.linkedBuilds.length > 0 && (
                                                    <div className="flex items-center gap-1 text-muted-foreground">
                                                      <Layers className="h-3 w-3" />
                                                      <span>{story.linkedBuilds.length} Build{story.linkedBuilds.length !== 1 ? 's' : ''}</span>
                                                    </div>
                                                  )}
                                                  {story.linkedArtifacts && story.linkedArtifacts.length > 0 && (
                                                    <div className="flex items-center gap-1 text-muted-foreground">
                                                      <FileCode className="h-3 w-3" />
                                                      <span>{story.linkedArtifacts.length} Artifact{story.linkedArtifacts.length !== 1 ? 's' : ''}</span>
                                                    </div>
                                                  )}
                                                </div>
                                              </div>
                                            </Card>
                                          );
                                        })
                                      ) : (
                                        <p className="text-xs text-muted-foreground text-center py-2">
                                          No user stories linked to this release
                                        </p>
                                      )}
                                    </div>
                                  )}
                                </div>
                              </div>
                            </CardContent>
                          </Card>
                        );
                      })
                    )}
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>
          </div>
        )}
    </GenericModal>
  );
}



