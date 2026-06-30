import { useEffect, useState, useMemo } from "react";
import { GenericModal } from "@/components/ui/generic-modal";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Package,
  RefreshCw,
  Download,
  ExternalLink,
  UploadCloud,
  AlertTriangle,
  Search,
  Filter,
  Box,
  Container,
  FileCode,
  Calendar,
  GitBranch,
  Tag,
  Loader2,
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

interface PackagesModalProps {
  projectId: string;
  adoProject?: ADOProject;
  open: boolean;
  onClose: () => void;
}

interface BuildArtifact {
  id: number;
  name: string;
  resource: {
    type: string;
    data: string;
    properties: {
      artifactsize?: string;
    };
    url: string;
    downloadUrl?: string;
  };
  // Additional fields that might be available
  version?: string;
  packageType?: string;
  publishedDate?: string;
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
  artifacts?: BuildArtifact[];
}

type PackageType = 'npm' | 'nuget' | 'pypi' | 'container' | 'artifact' | 'unknown';

export function PackagesModal({ projectId, adoProject, open, onClose }: PackagesModalProps) {
  const { toast } = useToast();
  const [searchQuery, setSearchQuery] = useState("");
  const [packageTypeFilter, setPackageTypeFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
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
    enabled: open && !!projectId,
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
    retry: 1,
  });

  const hasAdoConfig = adoConfig?.hasConfig || false;

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
        console.warn(`[PackagesModal] Failed to fetch sprints: ${sprintsRes.status}`, errorText);
        return [];
      }

      const sprints = await sprintsRes.json();
      return sprints;
    },
    enabled: open && !!projectId && hasAdoConfig,
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
    queryKey: [`/api/sdlc/projects/${projectId}/ado/builds`, queryString, selectedSprintPath],
    queryFn: async () => {
      if (!hasAdoConfig) return { value: [] };
      const buildQuery = new URLSearchParams(queryString);
      if (selectedSprintPath) {
        // URL encode the sprint path to handle special characters like backslashes
        // URLSearchParams.set() already handles encoding, so we don't need encodeURIComponent
        buildQuery.set('sprintPath', selectedSprintPath);
      }
      const url = getApiUrl(`/api/sdlc/projects/${projectId}/ado/builds${buildQuery.toString() ? `?${buildQuery.toString()}` : ''}`);
      console.log(`[PackagesModal] Fetching builds with sprint: ${selectedSprintPath}, URL: ${url}`);
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) {
        throw new Error(`Failed to fetch builds: ${res.status}`);
      }
      return res.json();
    },
    enabled: open && !!projectId && hasAdoConfig,
    staleTime: 2 * 60 * 1000,
    retry: 1,
  });

  // Fetch artifacts for each build
  const { data: allArtifactsData, isLoading: loadingArtifacts, isFetching: fetchingArtifacts, refetch: refetchArtifacts } = useQuery<Record<number, BuildArtifact[]>>({
    queryKey: [`/api/sdlc/projects/${projectId}/ado/artifacts-by-build`, queryString, buildsData?.value?.map(b => b.id).join(',')],
    queryFn: async () => {
      if (!hasAdoConfig || !buildsData?.value || buildsData.value.length === 0) return {};
      
      // Fetch artifacts for each build in parallel
      const artifactPromises = buildsData.value.map(async (build) => {
        try {
          const url = getApiUrl(`/api/sdlc/projects/${projectId}/ado/artifacts?buildId=${build.id}${queryString ? `&${queryString}` : ''}`);
          const res = await fetch(url, { credentials: "include" });
          if (!res.ok) {
            if (res.status === 404) return { buildId: build.id, artifacts: [] };
            throw new Error(`Failed to fetch artifacts for build ${build.id}: ${res.status}`);
          }
          const data = await res.json();
          return { buildId: build.id, artifacts: data.value || [] };
        } catch (error) {
          console.error(`Error fetching artifacts for build ${build.id}:`, error);
          return { buildId: build.id, artifacts: [] };
        }
      });

      const results = await Promise.all(artifactPromises);
      const artifactsMap: Record<number, BuildArtifact[]> = {};
      results.forEach(({ buildId, artifacts }) => {
        if (artifacts.length > 0) {
          artifactsMap[buildId] = artifacts;
        }
      });
      return artifactsMap;
    },
    enabled: open && !!projectId && hasAdoConfig && !!buildsData?.value && buildsData.value.length > 0,
    staleTime: 2 * 60 * 1000,
    retry: 1,
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
    await Promise.all([refetchBuilds(), refetchArtifacts()]);
  };

  // Detect package type from artifact name and type
  const detectPackageType = (artifact: BuildArtifact): PackageType => {
    const name = artifact.name.toLowerCase();
    const type = artifact.resource?.type?.toLowerCase() || '';
    
    // Check for npm packages
    if (name.includes('npm') || name.includes('package.json') || name.includes('.tgz') || name.endsWith('.npm')) {
      return 'npm';
    }
    
    // Check for NuGet packages
    if (name.includes('nuget') || name.includes('.nupkg') || name.endsWith('.nuspec')) {
      return 'nuget';
    }
    
    // Check for PyPI packages
    if (name.includes('pypi') || name.includes('python') || name.includes('.whl') || name.includes('.tar.gz') || name.includes('dist/')) {
      return 'pypi';
    }
    
    // Check for container images
    if (name.includes('docker') || name.includes('container') || name.includes('image') || 
        type.includes('container') || name.includes('.tar') && name.includes('image')) {
      return 'container';
    }
    
    // Check if it's a generic artifact
    if (type === 'pipelineartifact' || type === 'container' || type === 'filepath') {
      return 'artifact';
    }
    
    return 'unknown';
  };

  // Extract version number from artifact name
  const extractVersion = (artifact: BuildArtifact): string | null => {
    const name = artifact.name;
    
    // Common version patterns: v1.2.3, 1.2.3, version-1.2.3, etc.
    const versionPatterns = [
      /v?(\d+\.\d+\.\d+(?:[-.]\w+)?)/,  // v1.2.3 or 1.2.3 or 1.2.3-beta
      /version[-_]?(\d+\.\d+\.\d+)/i,   // version-1.2.3
      /(\d+\.\d+)/,                      // 1.2
    ];
    
    for (const pattern of versionPatterns) {
      const match = name.match(pattern);
      if (match) {
        return match[1];
      }
    }
    
    return null;
  };

  // Combine builds with their artifacts and enhance with package info
  const buildsWithArtifacts = useMemo(() => {
    return (buildsData?.value || [])
      .map(build => {
        const artifacts = (allArtifactsData?.[build.id] || []).map(artifact => ({
          ...artifact,
          packageType: detectPackageType(artifact),
          version: extractVersion(artifact),
          publishedDate: build.finishTime || build.startTime,
        }));
        
        return {
          ...build,
          artifacts,
        };
      })
      .filter(build => build.artifacts.length > 0);
  }, [buildsData?.value, allArtifactsData]);

  // Filter builds and artifacts
  const filteredBuilds = useMemo(() => {
    let filtered = [...buildsWithArtifacts];
    
    // Status filter
    if (statusFilter !== "all") {
      filtered = filtered.filter(build => {
        if (statusFilter === "succeeded") return build.result === "succeeded";
        if (statusFilter === "failed") return build.result === "failed";
        if (statusFilter === "partiallySucceeded") return build.result === "partiallySucceeded";
        return true;
      });
    }
    
    // Package type filter
    if (packageTypeFilter !== "all") {
      filtered = filtered.map(build => ({
        ...build,
        artifacts: build.artifacts.filter(artifact => artifact.packageType === packageTypeFilter)
      })).filter(build => build.artifacts.length > 0);
    }
    
    // Search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.map(build => ({
        ...build,
        artifacts: build.artifacts.filter(artifact =>
          artifact.name.toLowerCase().includes(query) ||
          artifact.version?.toLowerCase().includes(query) ||
          build.buildNumber.toLowerCase().includes(query) ||
          build.definition?.name.toLowerCase().includes(query)
        )
      })).filter(build => build.artifacts.length > 0);
    }
    
    return filtered;
  }, [buildsWithArtifacts, searchQuery, packageTypeFilter, statusFilter]);

  const totalArtifacts = buildsWithArtifacts.reduce((sum, build) => sum + build.artifacts.length, 0);
  const totalPackages = buildsWithArtifacts.reduce((sum, build) => 
    sum + build.artifacts.filter(a => a.packageType !== 'artifact' && a.packageType !== 'unknown').length, 0
  );

  // Count by package type
  const packageTypeCounts = useMemo(() => {
    const counts: Record<PackageType, number> = {
      npm: 0,
      nuget: 0,
      pypi: 0,
      container: 0,
      artifact: 0,
      unknown: 0,
    };
    
    buildsWithArtifacts.forEach(build => {
      build.artifacts.forEach(artifact => {
        counts[artifact.packageType] = (counts[artifact.packageType] || 0) + 1;
      });
    });
    
    return counts;
  }, [buildsWithArtifacts]);

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

  // Get status color
  const getStatusColor = (status: string, result?: string) => {
    if (result === 'succeeded') return 'bg-green-500';
    if (result === 'failed' || result === 'canceled') return 'bg-red-500';
    if (result === 'partiallySucceeded') return 'bg-yellow-500';
    if (status === 'inProgress' || status === 'in progress') return 'bg-blue-500';
    return 'bg-gray-500';
  };

  const getStatusText = (status: string, result?: string) => {
    if (result) {
      if (result === 'succeeded') return 'Succeeded';
      if (result === 'failed') return 'Failed';
      if (result === 'canceled') return 'Canceled';
      if (result === 'partiallySucceeded') return 'Partially Succeeded';
    }
    if (status === 'completed') return 'Completed';
    if (status === 'inProgress' || status === 'in progress') return 'In Progress';
    return status;
  };

  // Get package type icon
  const getPackageTypeIcon = (packageType: PackageType) => {
    switch (packageType) {
      case 'npm':
        return <Box className="h-4 w-4 text-orange-600" />;
      case 'nuget':
        return <Box className="h-4 w-4 text-blue-600" />;
      case 'pypi':
        return <Box className="h-4 w-4 text-yellow-600" />;
      case 'container':
        return <Container className="h-4 w-4 text-cyan-600" />;
      default:
        return <Package className="h-4 w-4 text-purple-600" />;
    }
  };

  // Get package type label
  const getPackageTypeLabel = (packageType: PackageType) => {
    switch (packageType) {
      case 'npm':
        return 'npm';
      case 'nuget':
        return 'NuGet';
      case 'pypi':
        return 'PyPI';
      case 'container':
        return 'Container';
      case 'artifact':
        return 'Build Artifact';
      default:
        return 'Unknown';
    }
  };

  return (
    <GenericModal
      open={open}
      onOpenChange={onClose}
      title="Publish Package"
      description="View build artifacts and published packages (npm, NuGet, PyPI, container images) with version numbers and publication timestamps"
      icon={Package}
      iconClassName="bg-gradient-to-br from-purple-500 to-purple-600"
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
            disabled={fetchingBuilds || fetchingArtifacts}
            className="h-8 w-8 p-0 flex items-center justify-center"
            aria-label="Refresh packages"
          >
            <RefreshCw className={`h-4 w-4 ${fetchingBuilds || fetchingArtifacts ? 'animate-spin' : ''}`} />
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
      ) : loadingBuilds || loadingArtifacts ? (
        <Card>
          <CardContent className="pt-6">
            <div className="text-center py-8">
              <Loader2 className="h-8 w-8 animate-spin mx-auto mb-2 text-muted-foreground" />
              <p className="text-muted-foreground">Loading artifacts and packages...</p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="flex-1 min-h-0 overflow-y-auto px-6 py-4">
          <div className="space-y-6">
            {/* Summary Statistics */}
            <div className="grid grid-cols-4 gap-4">
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                    <Package className="h-4 w-4 text-purple-600" />
                    Total Artifacts
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-4xl font-bold text-purple-600">{totalArtifacts}</div>
                  <p className="text-xs text-muted-foreground mt-1">from {buildsWithArtifacts.length} pipeline runs</p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                    <UploadCloud className="h-4 w-4 text-blue-600" />
                    Published Packages
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-4xl font-bold text-blue-600">{totalPackages}</div>
                  <p className="text-xs text-muted-foreground mt-1">npm, NuGet, PyPI, containers</p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                    <Box className="h-4 w-4 text-orange-600" />
                    npm Packages
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-4xl font-bold text-orange-600">{packageTypeCounts.npm}</div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                    <Container className="h-4 w-4 text-cyan-600" />
                    Container Images
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-4xl font-bold text-cyan-600">{packageTypeCounts.container}</div>
                </CardContent>
              </Card>
            </div>

            {/* Package Type Breakdown */}
            {(packageTypeCounts.npm > 0 || packageTypeCounts.nuget > 0 || packageTypeCounts.pypi > 0 || packageTypeCounts.container > 0) && (
              <Card>
                <CardHeader>
                  <CardTitle>Package Types</CardTitle>
                  <CardDescription>Distribution of published packages by type</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-4 gap-4">
                    {packageTypeCounts.npm > 0 && (
                      <div className="flex items-center gap-2 p-3 border rounded-lg">
                        <Box className="h-5 w-5 text-orange-600" />
                        <div>
                          <div className="font-semibold">npm</div>
                          <div className="text-sm text-muted-foreground">{packageTypeCounts.npm} packages</div>
                        </div>
                      </div>
                    )}
                    {packageTypeCounts.nuget > 0 && (
                      <div className="flex items-center gap-2 p-3 border rounded-lg">
                        <Box className="h-5 w-5 text-blue-600" />
                        <div>
                          <div className="font-semibold">NuGet</div>
                          <div className="text-sm text-muted-foreground">{packageTypeCounts.nuget} packages</div>
                        </div>
                      </div>
                    )}
                    {packageTypeCounts.pypi > 0 && (
                      <div className="flex items-center gap-2 p-3 border rounded-lg">
                        <Box className="h-5 w-5 text-yellow-600" />
                        <div>
                          <div className="font-semibold">PyPI</div>
                          <div className="text-sm text-muted-foreground">{packageTypeCounts.pypi} packages</div>
                        </div>
                      </div>
                    )}
                    {packageTypeCounts.container > 0 && (
                      <div className="flex items-center gap-2 p-3 border rounded-lg">
                        <Container className="h-5 w-5 text-cyan-600" />
                        <div>
                          <div className="font-semibold">Containers</div>
                          <div className="text-sm text-muted-foreground">{packageTypeCounts.container} images</div>
                        </div>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Search and Filters */}
            <Card>
              <CardHeader>
                <CardTitle>Build Artifacts & Published Packages</CardTitle>
                <CardDescription>
                  Artifacts generated from successful builds and published packages with version numbers and timestamps
                </CardDescription>
              </CardHeader>
              <CardContent className="pb-4">
                <div className="mb-4 space-y-3">
                  <div className="flex gap-3">
                    <div className="flex-1 relative">
                      <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input
                        placeholder="Search by package name, version, or build number..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="pl-10"
                      />
                    </div>
                    <Select value={packageTypeFilter} onValueChange={setPackageTypeFilter}>
                      <SelectTrigger className="w-[180px]">
                        <Filter className="h-4 w-4 mr-2" />
                        <SelectValue placeholder="Package Type" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Types</SelectItem>
                        <SelectItem value="npm">npm</SelectItem>
                        <SelectItem value="nuget">NuGet</SelectItem>
                        <SelectItem value="pypi">PyPI</SelectItem>
                        <SelectItem value="container">Container</SelectItem>
                        <SelectItem value="artifact">Build Artifacts</SelectItem>
                      </SelectContent>
                    </Select>
                    <Select value={statusFilter} onValueChange={setStatusFilter}>
                      <SelectTrigger className="w-[150px]">
                        <SelectValue placeholder="Build Status" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Status</SelectItem>
                        <SelectItem value="succeeded">Succeeded</SelectItem>
                        <SelectItem value="partiallySucceeded">Partially Succeeded</SelectItem>
                        <SelectItem value="failed">Failed</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {filteredBuilds.length === 0 ? (
                  <div className="text-center space-y-4 py-8">
                    <UploadCloud className="h-12 w-12 text-muted-foreground mx-auto" />
                    <p className="text-muted-foreground">
                      {searchQuery || packageTypeFilter !== "all" || statusFilter !== "all"
                        ? "No artifacts found matching your filters."
                        : "No artifacts found. Artifacts are published when your pipeline publishes packages or build outputs."}
                    </p>
                  </div>
                ) : (
                  <div className="space-y-6">
                    {filteredBuilds.map((build) => (
                      <Card key={build.id} className="border-2">
                        <CardHeader className="pb-3">
                          <div className="flex items-start justify-between gap-4">
                            <div className="flex-1">
                              <div className="flex items-center gap-3 mb-2">
                                <Badge className={`${getStatusColor(build.status, build.result)} text-white`}>
                                  {getStatusText(build.status, build.result)}
                                </Badge>
                                <span className="font-semibold text-lg">
                                  {build.definition?.name || 'Pipeline'} - Build #{build.buildNumber}
                                </span>
                              </div>
                              <div className="flex items-center gap-4 text-sm text-muted-foreground">
                                <div className="flex items-center gap-1">
                                  <GitBranch className="h-3 w-3" />
                                  {build.sourceBranch?.replace('refs/heads/', '') || 'N/A'}
                                </div>
                                <div className="flex items-center gap-1">
                                  <Calendar className="h-3 w-3" />
                                  Published: {formatDate(build.finishTime || build.startTime)}
                                </div>
                              </div>
                            </div>
                            <Badge variant="outline" className="text-sm">
                              {build.artifacts.length} {build.artifacts.length === 1 ? 'artifact' : 'artifacts'}
                            </Badge>
                          </div>
                        </CardHeader>
                        <CardContent className="pb-4">
                          <div className="space-y-3">
                            {build.artifacts.map((artifact) => {
                              const size = artifact.resource?.properties?.artifactsize 
                                ? `${(parseInt(artifact.resource.properties.artifactsize) / 1024 / 1024).toFixed(2)} MB`
                                : 'Unknown size';
                              
                              return (
                                <Card key={artifact.id} className="border hover:bg-muted/50 transition-colors">
                                  <CardContent className="p-4">
                                    <div className="flex items-start justify-between gap-4">
                                      <div className="flex items-start gap-3 flex-1">
                                        {getPackageTypeIcon(artifact.packageType)}
                                        <div className="flex-1">
                                          <div className="flex items-center gap-2 mb-2 flex-wrap">
                                            <span className="font-semibold">{artifact.name}</span>
                                            <Badge variant="outline" className="text-xs">
                                              {getPackageTypeLabel(artifact.packageType)}
                                            </Badge>
                                            {artifact.version && (
                                              <Badge variant="secondary" className="text-xs">
                                                <Tag className="h-3 w-3 mr-1" />
                                                v{artifact.version}
                                              </Badge>
                                            )}
                                            {artifact.resource?.type && (
                                              <Badge variant="outline" className="text-xs">
                                                {artifact.resource.type}
                                              </Badge>
                                            )}
                                          </div>
                                          
                                          <div className="grid grid-cols-2 gap-4 text-sm mb-2">
                                            <div>
                                              <span className="text-muted-foreground">Size: </span>
                                              <span className="font-medium">{size}</span>
                                            </div>
                                            <div>
                                              <span className="text-muted-foreground">Published: </span>
                                              <span className="font-medium">{formatDate(artifact.publishedDate || '')}</span>
                                            </div>
                                          </div>
                                          
                                          <div className="text-xs text-muted-foreground">
                                            <span className="font-medium">Associated Pipeline Run: </span>
                                            {build.definition?.name || 'Pipeline'} - Build #{build.buildNumber}
                                          </div>
                                          
                                          {artifact.resource?.url && (
                                            <div className="mt-2">
                                              <a 
                                                href={artifact.resource.url} 
                                                target="_blank" 
                                                rel="noopener noreferrer"
                                                className="text-blue-600 hover:underline flex items-center gap-1 text-xs"
                                              >
                                                View in Azure DevOps <ExternalLink className="h-3 w-3" />
                                              </a>
                                            </div>
                                          )}
                                        </div>
                                      </div>
                                      {artifact.resource?.downloadUrl && (
                                        <Button 
                                          variant="outline" 
                                          size="sm" 
                                          onClick={() => window.open(artifact.resource.downloadUrl, '_blank')}
                                          className="flex-shrink-0"
                                        >
                                          <Download className="h-4 w-4 mr-1" />
                                          Download
                                        </Button>
                                      )}
                                    </div>
                                  </CardContent>
                                </Card>
                              );
                            })}
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      )}
    </GenericModal>
  );
}


