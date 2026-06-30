import { useState, useEffect, useMemo } from "react";
import { GenericModal } from "@/components/ui/generic-modal";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Play,
  RefreshCw,
  AlertTriangle,
  Rocket,
  CheckCircle2,
  RotateCcw,
  Repeat,
  Loader2,
  Lock,
  XCircle,
  Clock,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { getApiUrl } from "@/lib/api-config";
import { useAuth } from "@/contexts/auth-context";
import { useQuery } from "@tanstack/react-query";

interface ADOProject {
  id: string;
  name: string;
  organization: string;
}

interface TriggerReleaseModalProps {
  projectId: string;
  adoProject: ADOProject;
  open: boolean;
  onClose: () => void;
}

interface ReleaseArtifact {
  id: number;
  name: string;
  version: string;
  definitionId?: number;
  definitionName: string;
  createdOn: string;
  environments: Array<{
    id: number;
    name: string;
    status?: string;
  }>;
  artifacts: any[];
  status: string;
}

interface Release {
  id: number;
  name: string;
  status: string;
  createdOn: string;
  releaseDefinition?: {
    id: number;
    name: string;
  };
  environments: Array<{
    id: number;
    name: string;
    status: string;
  }>;
}

export function TriggerReleaseModal({ projectId, adoProject, open, onClose }: TriggerReleaseModalProps) {
  const { toast } = useToast();
  const { user } = useAuth();

  
  const currentUser = useMemo(() => {
    
    if (!user) return null;
    return {
      email: user.email || "",
      name: user.name || user.email || "",
    };
  }, [user]);
  
  const [loading, setLoading] = useState(false);
  const [triggering, setTriggering] = useState(false);
  const [releaseArtifacts, setReleaseArtifacts] = useState<ReleaseArtifact[]>([]);
  const [selectedDefinitionId, setSelectedDefinitionId] = useState<string>("");
  const [selectedEnvironment, setSelectedEnvironment] = useState<string>("");
  const [hasAdoConfig, setHasAdoConfig] = useState(false);
  const [activeTab, setActiveTab] = useState("new-release");
  
  // For redeploy/rollback
  const [selectedExistingReleaseId, setSelectedExistingReleaseId] = useState<string>("");
  const [selectedRedeployEnvironmentId, setSelectedRedeployEnvironmentId] = useState<string>("");
  const [redeploying, setRedeploying] = useState(false);
  const [rollbacking, setRollbacking] = useState(false);
  const [selectedSprintPath, setSelectedSprintPath] = useState<string | null>(null);

  // Build query params for ADO project info
  const queryParams = useMemo(() => {
    const params = new URLSearchParams();
    if (adoProject?.organization) {
      params.append('organization', adoProject.organization);
    }
    if (adoProject?.name) {
      params.append('projectName', adoProject.name);
    }
    if (selectedSprintPath) {
      params.append('sprintPath', selectedSprintPath);
    }
    return params.toString();
  }, [adoProject, selectedSprintPath]);

  // Reset sprint selection when modal closes
  useEffect(() => {
    if (!open) {
      setSelectedSprintPath(null);
    }
  }, [open]);

  useEffect(() => {
    setSelectedDefinitionId("");
    setSelectedEnvironment("");
  }, [selectedSprintPath]);

  // Fetch sprints
  const { data: allSprints = [] } = useQuery<Array<{ path: string; name: string; startDate?: string; endDate?: string }>>({
    queryKey: [`/api/sdlc/projects/${projectId}/ado/sprints`, queryParams],
    queryFn: async () => {
      if (!hasAdoConfig) return [];
      const sprintsUrl = getApiUrl(`/api/sdlc/projects/${projectId}/ado/sprints${queryParams ? `?${queryParams}` : ''}`);
      const res = await fetch(sprintsUrl, { credentials: "include" });
      if (!res.ok) {
        const errorText = await res.text();
        console.warn(`[TriggerReleaseModal] Failed to fetch sprints: ${res.status}`, errorText);
        return [];
      }
      return res.json();
    },
    enabled: open && !!projectId && hasAdoConfig,
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
    retry: 1,
  });

  // Fetch deployment permissions
  const { data: deploymentPermissions } = useQuery<{
    canDeploy: boolean;
    role?: string;
    reason?: string;
  }>({
    queryKey: [
      "/api/sdlc/projects",
      projectId,
      "deployment-permissions",
      currentUser?.email,
      adoProject?.organization,
      adoProject?.name,
    ],
    queryFn: async () => {
      if (!currentUser?.email || !adoProject) {
        return {
          canDeploy: false,
          reason: "User or project information missing",
        };
      }

      const params = new URLSearchParams();
      params.append("userEmail", currentUser.email);
      if (adoProject.organization) {
        params.append("organization", adoProject.organization);
      }
      if (adoProject.name) {
        params.append("projectName", adoProject.name);
      }

      const permissionsUrl = getApiUrl(
        `/api/sdlc/projects/${projectId}/deployment-permissions?${params.toString()}`
      );
      const permissionsRes = await fetch(permissionsUrl, {
        credentials: "include",
      });

      if (!permissionsRes.ok) {
        return { canDeploy: true, role: "default" };
      }

      return permissionsRes.json();
    },
    enabled: open && !!projectId && !!currentUser?.email && !!adoProject,
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });

  const canDeploy = deploymentPermissions?.canDeploy ?? true;
  const permissionReason = deploymentPermissions?.reason;

  // Fetch existing releases for redeploy/rollback
  const { data: existingReleases, isLoading: loadingReleases } = useQuery<{ value: Release[] }>({
    queryKey: [`/api/sdlc/projects/${projectId}/ado/releases`, queryParams, selectedSprintPath],
    queryFn: async () => {
      if (!hasAdoConfig) return { value: [] };
      const releasesQuery = new URLSearchParams(queryParams);
      if (selectedSprintPath) releasesQuery.set('sprintPath', selectedSprintPath);
      const url = getApiUrl(`/api/sdlc/projects/${projectId}/ado/releases${releasesQuery.toString() ? `?${releasesQuery.toString()}` : ''}`);
      const fetchUrl = selectedSprintPath ? `${url}&_t=${Date.now()}` : url;
      const res = await fetch(fetchUrl, { credentials: "include", cache: selectedSprintPath ? 'no-cache' : 'default' });
      if (!res.ok) {
        throw new Error(`Failed to fetch releases: ${res.status}`);
      }
      const data = await res.json();
      return { value: data.value || data || [] };
    },
    enabled: open && !!projectId && hasAdoConfig && (activeTab === "redeploy" || activeTab === "rollback"),
    staleTime: selectedSprintPath ? 0 : 2 * 60 * 1000,
    gcTime: selectedSprintPath ? 0 : undefined,
  });

  useEffect(() => {
    if (open && adoProject) {
      fetchReleaseArtifacts();
    }
  }, [open, projectId, adoProject, selectedSprintPath]);

  const fetchReleaseArtifacts = async () => {
    if (!adoProject || !adoProject.organization || !adoProject.name) {
      setHasAdoConfig(false);
      return;
    }

    setLoading(true);
    try {
      // Check ADO configuration
    const configUrl = getApiUrl(`/api/sdlc/projects/${projectId}/ado-config?${queryParams}`);
      const configRes = await fetch(configUrl, { credentials: "include" });
      
      if (!configRes.ok) {
        throw new Error(`Configuration check failed: ${configRes.status} ${configRes.statusText}`);
      }

      const contentType = configRes.headers.get("content-type");
      if (!contentType || !contentType.includes("application/json")) {
        throw new Error("Server returned invalid response. Please check if the server is running correctly.");
      }

      const config = await configRes.json();
      setHasAdoConfig(config.hasConfig);

      if (!config.hasConfig) {
        setLoading(false);
        return;
      }

    // Fetch release artifacts with organization and project parameters (honor sprint if selected)
    const artifactsUrl = getApiUrl(`/api/sdlc/projects/${projectId}/ado/release-artifacts?${queryParams}`);
    const fetchUrl = selectedSprintPath ? `${artifactsUrl}&_t=${Date.now()}` : artifactsUrl;
    const artifactsRes = await fetch(fetchUrl, { credentials: "include", cache: selectedSprintPath ? 'no-cache' : 'default' });
      
      if (artifactsRes.ok) {
        const data = await artifactsRes.json();
        setReleaseArtifacts(data || []);
      } else {
        const errorData = await artifactsRes.json().catch(() => ({ error: artifactsRes.statusText }));
        throw new Error(errorData.error || "Failed to fetch release artifacts");
      }
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to fetch release artifacts",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  /** One row per classic release definition (latest release instance used for environments). */
  const releaseChoicesByDefinition = useMemo(() => {
    const map = new Map<number, ReleaseArtifact>();
    for (const r of releaseArtifacts) {
      const did = r.definitionId;
      if (did == null || typeof did !== "number") continue;
      const prev = map.get(did);
      if (!prev) {
        map.set(did, r);
        continue;
      }
      const tNew = r.createdOn ? new Date(r.createdOn).getTime() : 0;
      const tOld = prev.createdOn ? new Date(prev.createdOn).getTime() : 0;
      if (tNew >= tOld) map.set(did, r);
    }
    return Array.from(map.values()).sort((a, b) =>
      (a.definitionName || "").localeCompare(b.definitionName || "", undefined, { sensitivity: "base" }),
    );
  }, [releaseArtifacts]);

  const selectedRelease = releaseChoicesByDefinition.find(
    (r) => String(r.definitionId) === selectedDefinitionId,
  );
  const selectedExistingRelease = existingReleases?.value?.find(r => r.id.toString() === selectedExistingReleaseId);

  const checkPermissions = () => {
    if (!canDeploy) {
      toast({
        title: "Permission Denied",
        description: permissionReason || "You do not have permission to deploy. Contact your administrator or configure permissions in Azure DevOps.",
        variant: "destructive",
      });
      return false;
    }
    return true;
  };

  const handleTriggerRelease = async () => {
    if (!checkPermissions()) return;
    if (!selectedDefinitionId) {
      toast({
        title: "Validation Error",
        description: "Please select a release pipeline",
        variant: "destructive",
      });
      return;
    }

    if (!selectedEnvironment) {
      toast({
        title: "Validation Error",
        description: "Please select an environment",
        variant: "destructive",
      });
      return;
    }

    const release = releaseChoicesByDefinition.find(
      (r) => String(r.definitionId) === selectedDefinitionId,
    );
    if (release?.definitionId == null) {
      toast({
        title: "Validation Error",
        description:
          "The selected item has no release definition ID from Azure DevOps. Ensure classic Release pipelines exist and your PAT has Release (read, manage) scope.",
        variant: "destructive",
      });
      return;
    }

    setTriggering(true);
    try {
      const triggerUrl = getApiUrl(`/api/sdlc/projects/${projectId}/ado/trigger-release?${queryParams}`);
      const response = await fetch(triggerUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify({
          definitionId: release.definitionId,
          description: `Release pipeline "${release.definitionName}" to ${selectedEnvironment}`,
          triggeredBy: currentUser?.email || "",
          triggeredByName: currentUser?.name || "",
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: "Failed to trigger release" }));
        throw new Error(errorData.error || "Failed to trigger release");
      }

      await response.json();

      toast({
        title: "Release Triggered",
        description: `Successfully triggered "${release.definitionName}" (new release run) for ${selectedEnvironment}`,
      });

      // Reset form
      setSelectedDefinitionId("");
      setSelectedEnvironment("");
      
      // Refresh data
      fetchReleaseArtifacts();
      
      // Close modal after a short delay
      setTimeout(() => {
        onClose();
      }, 1500);
    } catch (error: any) {
      console.error("Error triggering release:", error);
      toast({
        title: "Error",
        description: error.message || "Failed to trigger release",
        variant: "destructive",
      });
    } finally {
      setTriggering(false);
    }
  };

  const handleRedeploy = async () => {
    if (!checkPermissions()) return;

    if (!selectedExistingReleaseId || !selectedRedeployEnvironmentId) {
      toast({
        title: "Validation Error",
        description: "Please select a release and environment",
        variant: "destructive",
      });
      return;
    }

    setRedeploying(true);
    try {
      const deployUrl = getApiUrl(
        `/api/sdlc/projects/${projectId}/ado/releases/${selectedExistingReleaseId}/deploy${queryParams ? `?${queryParams}` : ''}`
      );
      const response = await fetch(deployUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          environmentId: parseInt(selectedRedeployEnvironmentId),
          comment: `Redeploy to ${selectedExistingRelease?.environments.find(e => e.id.toString() === selectedRedeployEnvironmentId)?.name || 'environment'} triggered from DevPlatform by ${currentUser?.email || "user"}`,
          deployedBy: currentUser?.email || "",
          deployedByName: currentUser?.name || "",
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: "Failed to redeploy" }));
        const errorMessage = errorData.error || "Failed to redeploy";
        
        if (response.status === 403 || errorMessage.toLowerCase().includes("permission")) {
          toast({
            title: "Deployment Blocked by Azure DevOps",
            description: "Azure DevOps has blocked this deployment. You may not have permission to deploy. Please check your permissions in Azure DevOps.",
            variant: "destructive",
          });
        } else {
          throw new Error(errorMessage);
        }
        return;
      }

      toast({
        title: "Redeploy Triggered",
        description: `Successfully triggered redeploy to ${selectedExistingRelease?.environments.find(e => e.id.toString() === selectedRedeployEnvironmentId)?.name || 'environment'}`,
      });

      // Reset form
      setSelectedExistingReleaseId("");
      setSelectedRedeployEnvironmentId("");
      
      // Close modal after a short delay
      setTimeout(() => {
        onClose();
      }, 1500);
    } catch (error: any) {
      console.error("Error redeploying:", error);
      toast({
        title: "Error",
        description: error.message || "Failed to redeploy",
        variant: "destructive",
      });
    } finally {
      setRedeploying(false);
    }
  };

  const handleRollback = async () => {
    if (!checkPermissions()) return;

    if (!selectedExistingReleaseId || !selectedRedeployEnvironmentId) {
      toast({
        title: "Validation Error",
        description: "Please select a release and environment",
        variant: "destructive",
      });
      return;
    }

    setRollbacking(true);
    try {
      // Rollback is essentially a redeploy, but we'll mark it as such in the comment
      const deployUrl = getApiUrl(
        `/api/sdlc/projects/${projectId}/ado/releases/${selectedExistingReleaseId}/deploy${queryParams ? `?${queryParams}` : ''}`
      );
      const response = await fetch(deployUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          environmentId: parseInt(selectedRedeployEnvironmentId),
          comment: `Rollback triggered from DevPlatform by ${currentUser?.email || "user"}`,
          deployedBy: currentUser?.email || "",
          deployedByName: currentUser?.name || "",
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: "Failed to rollback" }));
        const errorMessage = errorData.error || "Failed to rollback";
        
        if (response.status === 403 || errorMessage.toLowerCase().includes("permission")) {
          toast({
            title: "Rollback Blocked by Azure DevOps",
            description: "Azure DevOps has blocked this rollback. You may not have permission to deploy. Please check your permissions in Azure DevOps.",
            variant: "destructive",
          });
        } else {
          throw new Error(errorMessage);
        }
        return;
      }

      toast({
        title: "Rollback Triggered",
        description: `Successfully triggered rollback for ${selectedExistingRelease?.environments.find(e => e.id.toString() === selectedRedeployEnvironmentId)?.name || 'environment'}`,
      });

      // Reset form
      setSelectedExistingReleaseId("");
      setSelectedRedeployEnvironmentId("");
      
      // Close modal after a short delay
      setTimeout(() => {
        onClose();
      }, 1500);
    } catch (error: any) {
      console.error("Error rolling back:", error);
      toast({
        title: "Error",
        description: error.message || "Failed to rollback",
        variant: "destructive",
      });
    } finally {
      setRollbacking(false);
    }
  };

  const getEnvironmentStatusIcon = (status: string) => {
    if (status === "succeeded" || status === "completed") {
      return <CheckCircle2 className="h-4 w-4 text-green-600" />;
    }
    if (status === "failed" || status === "rejected") {
      return <XCircle className="h-4 w-4 text-red-600" />;
    }
    if (status === "inProgress" || status === "queued") {
      return <Clock className="h-4 w-4 text-blue-600" />;
    }
    return <AlertTriangle className="h-4 w-4 text-gray-600" />;
  };

  return (
    <GenericModal
      open={open}
      onOpenChange={onClose}
      title="Trigger Release"
      description="Start new releases, redeploy, or rollback deployments"
      icon={Play}
      iconClassName="bg-gradient-to-br from-green-500 to-green-600"
      fullScreen={true}
      contentClassName="space-y-4"
      headerActions={
        <div className="flex items-center gap-2">
          <Select
            value={selectedSprintPath || "all"}
            onValueChange={(value) => {
              if (value === "all") setSelectedSprintPath(null);
              else setSelectedSprintPath(value);
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
            onClick={() => {
              setTriggering(false);
              setRedeploying(false);
              setRollbacking(false);
            }}
          >
            <RefreshCw className={`h-4 w-4 ${loadingReleases || loading ? "animate-spin" : ""}`} />
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
              Loading release artifacts...
            </p>
          </CardContent>
          </Card>
        ) : (
          <div className="flex-1 overflow-hidden flex flex-col space-y-4">
            {/* Permission Warning */}
            {!canDeploy && (
              <Card className="border-amber-200 bg-amber-50 dark:bg-amber-950/20">
                <CardContent className="pt-4">
                  <div className="flex items-center gap-2">
                    <Lock className="h-5 w-5 text-amber-600" />
                    <div>
                      <p className="font-semibold text-sm text-amber-900 dark:text-amber-100">Permission Restricted</p>
                      <p className="text-xs text-amber-700 dark:text-amber-300 mt-1">
                        {permissionReason || "You do not have deployment rights. Azure DevOps will enforce permissions."}
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
              <TabsList className="grid w-full grid-cols-3">
                <TabsTrigger value="new-release">
                  <Rocket className="h-4 w-4 mr-2" />
                  New Release
                </TabsTrigger>
                <TabsTrigger value="redeploy">
                  <Repeat className="h-4 w-4 mr-2" />
                  Redeploy
                </TabsTrigger>
                <TabsTrigger value="rollback">
                  <RotateCcw className="h-4 w-4 mr-2" />
                  Rollback/Re-run
                </TabsTrigger>
              </TabsList>

              {/* New Release Tab */}
              <TabsContent value="new-release" className="mt-4">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Start New Release</CardTitle>
                    <CardDescription>
                      Create and trigger a new release from available artifacts
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="release-pipeline">Release pipeline *</Label>
                  <Select
                    value={selectedDefinitionId}
                    onValueChange={(value) => {
                      setSelectedDefinitionId(value);
                      setSelectedEnvironment("");
                    }}
                  >
                    <SelectTrigger id="release-pipeline">
                      <SelectValue placeholder="Select a release pipeline..." />
                    </SelectTrigger>
                    <SelectContent>
                      {releaseChoicesByDefinition.length === 0 ? (
                        <div className="p-2 text-sm text-muted-foreground">
                          No classic release definitions found (from recent releases)
                        </div>
                      ) : (
                        releaseChoicesByDefinition.map((artifact) => {
                          const runLabel = artifact.version || artifact.name;
                          const dupName =
                            runLabel &&
                            artifact.definitionName &&
                            String(runLabel).trim() === String(artifact.definitionName).trim();
                          return (
                            <SelectItem key={artifact.definitionId} value={String(artifact.definitionId)}>
                              <div className="flex flex-col gap-0.5 py-0.5">
                                <span className="font-medium leading-tight">{artifact.definitionName}</span>
                                {!dupName && runLabel ? (
                                  <span className="text-xs text-muted-foreground">Latest run: {runLabel}</span>
                                ) : null}
                              </div>
                            </SelectItem>
                          );
                        })
                      )}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="environment">Environment *</Label>
                  <Select
                    value={selectedEnvironment}
                    onValueChange={setSelectedEnvironment}
                    disabled={!selectedDefinitionId}
                  >
                    <SelectTrigger id="environment">
                      <SelectValue
                        placeholder={
                          selectedDefinitionId ? "Select an environment..." : "Select a release pipeline first"
                        }
                      />
                    </SelectTrigger>
                    <SelectContent>
                      {selectedRelease && selectedRelease.environments.length > 0 ? (
                        selectedRelease.environments.map((env) => (
                          <SelectItem key={env.id} value={env.name}>
                            {env.name} {env.status && `(${env.status})`}
                          </SelectItem>
                        ))
                      ) : (
                        <div className="p-2 text-sm text-muted-foreground">
                          No environments configured for this release
                        </div>
                      )}
                    </SelectContent>
                  </Select>
                </div>

                    <div className="flex items-center gap-2 p-3 bg-blue-50 dark:bg-blue-950/20 rounded-lg border border-blue-200 dark:border-blue-800">
                      <Rocket className="h-5 w-5 text-blue-600 flex-shrink-0" />
                      <p className="text-sm text-blue-900 dark:text-blue-100">
                        This will create a new release and automatically deploy it to configured environments based on the release version settings.
                      </p>
                    </div>

                    <Button
                      className="w-full"
                      onClick={handleTriggerRelease}
                      disabled={!selectedDefinitionId || !selectedEnvironment || triggering || !canDeploy}
                    >
                      {triggering ? (
                        <>
                          <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                          Triggering Release...
                        </>
                      ) : (
                        <>
                          <Play className="h-4 w-4 mr-2" />
                          Trigger Release
                        </>
                      )}
                    </Button>
                  </CardContent>
                </Card>

                {releaseChoicesByDefinition.length > 0 && (
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">Release pipelines</CardTitle>
                      <CardDescription className="text-xs">
                        One entry per Azure DevOps release definition (environments from the latest run).
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      <ScrollArea className="h-[200px]">
                        <div className="space-y-2">
                          {releaseChoicesByDefinition.map((artifact) => {
                            const runLabel = artifact.version || artifact.name;
                            const selected = selectedDefinitionId === String(artifact.definitionId);
                            return (
                              <div
                                key={artifact.definitionId}
                                className="p-3 bg-muted rounded-lg"
                              >
                                <div className="flex items-center justify-between gap-2">
                                  <div className="min-w-0">
                                    <div className="font-medium text-sm truncate">{artifact.definitionName}</div>
                                    {runLabel && runLabel !== artifact.definitionName ? (
                                      <div className="text-xs text-muted-foreground mt-1 truncate">
                                        Latest run: {runLabel}
                                      </div>
                                    ) : null}
                                    {artifact.environments.length > 0 && (
                                      <div className="text-xs text-muted-foreground mt-1">
                                        Environments: {artifact.environments.map((e) => e.name).join(", ")}
                                      </div>
                                    )}
                                  </div>
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    className="shrink-0"
                                    onClick={() => {
                                      setSelectedDefinitionId(String(artifact.definitionId));
                                      setSelectedEnvironment("");
                                    }}
                                    disabled={selected}
                                  >
                                    {selected ? (
                                      <>
                                        <CheckCircle2 className="h-3 w-3 mr-1" />
                                        Selected
                                      </>
                                    ) : (
                                      "Select"
                                    )}
                                  </Button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </ScrollArea>
                    </CardContent>
                  </Card>
                )}
              </TabsContent>

              {/* Redeploy Tab */}
              <TabsContent value="redeploy" className="mt-4">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Redeploy to Environment</CardTitle>
                    <CardDescription>
                      Redeploy an existing release to a specific environment
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {loadingReleases ? (
                      <div className="text-center py-8">
                        <Loader2 className="h-6 w-6 animate-spin mx-auto mb-2 text-muted-foreground" />
                        <p className="text-sm text-muted-foreground">Loading releases...</p>
                      </div>
                    ) : (
                      <>
                        <div className="space-y-2">
                          <Label htmlFor="existing-release">Select Release *</Label>
                          <Select
                            value={selectedExistingReleaseId}
                            onValueChange={(value) => {
                              setSelectedExistingReleaseId(value);
                              setSelectedRedeployEnvironmentId("");
                            }}
                            disabled={!canDeploy}
                          >
                            <SelectTrigger id="existing-release">
                              <SelectValue placeholder="Select a release..." />
                            </SelectTrigger>
                            <SelectContent>
                              {existingReleases?.value && existingReleases.value.length > 0 ? (
                                existingReleases.value.map((release) => (
                                  <SelectItem key={release.id} value={release.id.toString()}>
                                    {release.name} - {release.releaseDefinition?.name || 'Unknown'}
                                  </SelectItem>
                                ))
                              ) : (
                                <div className="p-2 text-sm text-muted-foreground">
                                  No releases found
                                </div>
                              )}
                            </SelectContent>
                          </Select>
                        </div>

                        <div className="space-y-2">
                          <Label htmlFor="redeploy-environment">Select Environment *</Label>
                          <Select
                            value={selectedRedeployEnvironmentId}
                            onValueChange={setSelectedRedeployEnvironmentId}
                            disabled={!selectedExistingReleaseId || !canDeploy}
                          >
                            <SelectTrigger id="redeploy-environment">
                              <SelectValue placeholder={selectedExistingReleaseId ? "Select an environment..." : "Select a release first"} />
                            </SelectTrigger>
                            <SelectContent>
                              {selectedExistingRelease && selectedExistingRelease.environments.length > 0 ? (
                                selectedExistingRelease.environments.map((env) => (
                                  <SelectItem key={env.id} value={env.id.toString()}>
                                    <div className="flex items-center gap-2">
                                      {getEnvironmentStatusIcon(env.status)}
                                      <span>{env.name}</span>
                                      <Badge variant="outline" className="ml-2 text-xs">
                                        {env.status}
                                      </Badge>
                                    </div>
                                  </SelectItem>
                                ))
                              ) : (
                                <div className="p-2 text-sm text-muted-foreground">
                                  No environments available
                                </div>
                              )}
                            </SelectContent>
                          </Select>
                        </div>

                        <div className="flex items-center gap-2 p-3 bg-blue-50 dark:bg-blue-950/20 rounded-lg border border-blue-200 dark:border-blue-800">
                          <Repeat className="h-5 w-5 text-blue-600 flex-shrink-0" />
                          <p className="text-sm text-blue-900 dark:text-blue-100">
                            This will redeploy the selected release to the chosen environment. Useful for promoting builds or deploying patches.
                          </p>
                        </div>

                        <Button
                          className="w-full"
                          onClick={handleRedeploy}
                          disabled={!selectedExistingReleaseId || !selectedRedeployEnvironmentId || redeploying || !canDeploy}
                        >
                          {redeploying ? (
                            <>
                              <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                              Redeploying...
                            </>
                          ) : (
                            <>
                              <Repeat className="h-4 w-4 mr-2" />
                              Redeploy
                            </>
                          )}
                        </Button>
                      </>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>

              {/* Rollback/Re-run Tab */}
              <TabsContent value="rollback" className="mt-4">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Rollback or Re-run</CardTitle>
                    <CardDescription>
                      Rollback to a previous release or re-run a failed deployment
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {loadingReleases ? (
                      <div className="text-center py-8">
                        <Loader2 className="h-6 w-6 animate-spin mx-auto mb-2 text-muted-foreground" />
                        <p className="text-sm text-muted-foreground">Loading releases...</p>
                      </div>
                    ) : (
                      <>
                        <div className="space-y-2">
                          <Label htmlFor="rollback-release">Select Release *</Label>
                          <Select
                            value={selectedExistingReleaseId}
                            onValueChange={(value) => {
                              setSelectedExistingReleaseId(value);
                              setSelectedRedeployEnvironmentId("");
                            }}
                            disabled={!canDeploy}
                          >
                            <SelectTrigger id="rollback-release">
                              <SelectValue placeholder="Select a release..." />
                            </SelectTrigger>
                            <SelectContent>
                              {existingReleases?.value && existingReleases.value.length > 0 ? (
                                existingReleases.value.map((release) => (
                                  <SelectItem key={release.id} value={release.id.toString()}>
                                    {release.name} - {release.releaseDefinition?.name || 'Unknown'}
                                  </SelectItem>
                                ))
                              ) : (
                                <div className="p-2 text-sm text-muted-foreground">
                                  No releases found
                                </div>
                              )}
                            </SelectContent>
                          </Select>
                        </div>

                        <div className="space-y-2">
                          <Label htmlFor="rollback-environment">Select Environment *</Label>
                          <Select
                            value={selectedRedeployEnvironmentId}
                            onValueChange={setSelectedRedeployEnvironmentId}
                            disabled={!selectedExistingReleaseId || !canDeploy}
                          >
                            <SelectTrigger id="rollback-environment">
                              <SelectValue placeholder={selectedExistingReleaseId ? "Select an environment..." : "Select a release first"} />
                            </SelectTrigger>
                            <SelectContent>
                              {selectedExistingRelease && selectedExistingRelease.environments.length > 0 ? (
                                selectedExistingRelease.environments.map((env) => (
                                  <SelectItem key={env.id} value={env.id.toString()}>
                                    <div className="flex items-center gap-2">
                                      {getEnvironmentStatusIcon(env.status)}
                                      <span>{env.name}</span>
                                      <Badge variant="outline" className="ml-2 text-xs">
                                        {env.status}
                                      </Badge>
                                    </div>
                                  </SelectItem>
                                ))
                              ) : (
                                <div className="p-2 text-sm text-muted-foreground">
                                  No environments available
                                </div>
                              )}
                            </SelectContent>
                          </Select>
                        </div>

                        <div className="flex items-center gap-2 p-3 bg-amber-50 dark:bg-amber-950/20 rounded-lg border border-amber-200 dark:border-amber-800">
                          <RotateCcw className="h-5 w-5 text-amber-600 flex-shrink-0" />
                          <p className="text-sm text-amber-900 dark:text-amber-100">
                            This will trigger a rollback or re-run operation. Use this to revert to a previous version or re-run a failed deployment after resolving issues.
                          </p>
                        </div>

                        <Button
                          className="w-full"
                          onClick={handleRollback}
                          disabled={!selectedExistingReleaseId || !selectedRedeployEnvironmentId || rollbacking || !canDeploy}
                        >
                          {rollbacking ? (
                            <>
                              <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                              Rolling Back...
                            </>
                          ) : (
                            <>
                              <RotateCcw className="h-4 w-4 mr-2" />
                              Rollback/Re-run
                            </>
                          )}
                        </Button>
                      </>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>
          </div>
        )}
    </GenericModal>
  );
}


