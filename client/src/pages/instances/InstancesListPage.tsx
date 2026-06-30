import { useState, useEffect } from "react";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Loader2, Plus, ExternalLink, Trash2, RefreshCw, Server, GitBranch } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { provisioningService } from "@/services/provisioningService";
import { useLocation } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { Alert, AlertDescription } from "@/components/ui/alert";
import type { ProvisionInstanceResponse } from "@shared/types/provisioning.types";
import { acquireAzureManagementToken } from "@/utils/api-interceptor";
import { DeploySetupDialog } from "@/components/provisioning/DeploySetupDialog";
import type { DeploymentType } from "@/services/deploySetupService";

export default function InstancesListPage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Deploy setup state
  const [deploymentType, setDeploymentType] = useState<DeploymentType>("fullstack");
  const [frontendInstanceId, setFrontendInstanceId] = useState("");
  const [backendInstanceId, setBackendInstanceId] = useState("");
  const [dbInstanceId, setDbInstanceId] = useState("");
  const [singleInstanceId, setSingleInstanceId] = useState("");
  const [showDeploySetup, setShowDeploySetup] = useState(false);
  const [armToken, setArmToken] = useState<string | null>(null);
  const [searchText, setSearchText] = useState("");
  const [serviceFilter, setServiceFilter] = useState("all");

  useEffect(() => {
    acquireAzureManagementToken().then(t => setArmToken(t));
  }, []);

  const {
    data: instancesData,
    isLoading,
    isFetching,
    error,
    refetch
  } = useQuery({
    queryKey: ["instances"],
    queryFn: () => provisioningService.listInstances(),
    refetchInterval: (query) => {
      const instances = query.state.data?.instances;
      const hasProvisioning = !instances || instances.some(i => i.status === "provisioning");
      return hasProvisioning ? 5000 : false;
    },
  });

  const readyInstances = (instancesData?.instances ?? []).filter(i => i.status === "ready");
  const swaInstances = readyInstances.filter(i => i.serviceType === "Static Site");
  const appServiceInstances = readyInstances.filter(i => i.serviceType !== "Static Site" && i.serviceType !== "Database");
  const dbInstances = readyInstances.filter(i => i.serviceType === "Database");
  const singleEligible = readyInstances.filter(i => i.serviceType !== "Database");

  const handleViewInstance = (instanceId: string) => {
    setLocation(`/instances/${instanceId}`);
  };

  const handleDeleteInstance = async (instanceId: string, instanceName: string) => {
    try {
      const armToken = await acquireAzureManagementToken() ?? undefined;
      await provisioningService.deleteInstance(instanceId, armToken);
      toast({ title: "Instance deleted", description: `Instance "${instanceName}" has been deleted` });
      queryClient.invalidateQueries({ queryKey: ["instances"] });
    } catch (error: any) {
      toast({ title: "Delete failed", description: error.message || "Failed to delete instance", variant: "destructive" });
    }
  };

  const handleCreateNew = () => setLocation("/provisioning");

  const isConfigureReady = (() => {
    if (deploymentType === "fullstack") return !!frontendInstanceId && !!backendInstanceId;
    return !!singleInstanceId;
  })();

  const handleOpenDeploy = () => setShowDeploySetup(true);

  const handleCloseDeploy = () => {
    setShowDeploySetup(false);
    setFrontendInstanceId("");
    setBackendInstanceId("");
    setDbInstanceId("");
    setSingleInstanceId("");
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "ready": return "bg-green-500/10 text-green-700 border-green-200";
      case "provisioning": return "bg-blue-500/10 text-blue-700 border-blue-200";
      case "failed": return "bg-red-500/10 text-red-700 border-red-200";
      case "deleting": return "bg-yellow-500/10 text-yellow-700 border-yellow-200";
      default: return "bg-gray-500/10 text-gray-700 border-gray-200";
    }
  };

  const getStatusText = (status: string) => {
    switch (status) {
      case "ready": return "Ready";
      case "provisioning": return "Provisioning";
      case "failed": return "Failed";
      case "deleting": return "Deleting";
      default: return status;
    }
  };

  // Resolve full instance objects for the dialog
  const frontendInstance = swaInstances.find(i => i.id === frontendInstanceId);
  const backendInstance = appServiceInstances.find(i => i.id === backendInstanceId);
  const dbInstance = dbInstances.find(i => i.id === dbInstanceId);
  const singleInstance = singleEligible.find(i => i.id === singleInstanceId);
  const allInstances = instancesData?.instances ?? [];
  const normalizedSearch = searchText.trim().toLowerCase();
  const filteredInstances = allInstances.filter((instance: ProvisionInstanceResponse) => {
    const matchesSearch =
      normalizedSearch.length === 0 ||
      instance.instanceName.toLowerCase().includes(normalizedSearch) ||
      (instance.resourceGroupName ?? "").toLowerCase().includes(normalizedSearch) ||
      (instance.environment ?? "").toLowerCase().includes(normalizedSearch) ||
      (instance.region ?? "").toLowerCase().includes(normalizedSearch);
    const instanceServiceType = instance.serviceType || "Web App";
    const matchesService = serviceFilter === "all" || instanceServiceType === serviceFilter;
    return matchesSearch && matchesService;
  });

  return (
    <div className="flex-1 space-y-6 p-6">
      <PageHeader
        icon={Server}
        title="Azure Instances"
        subtitle="Manage your provisioned Azure App Service instances"
        color="blue"
      >
        <div className="flex gap-2">
          <Button onClick={() => refetch()} variant="outline" size="sm" disabled={isFetching}>
            <RefreshCw className={`h-4 w-4 mr-2 ${isFetching ? "animate-spin" : ""}`} />
            {isFetching ? "Refreshing..." : "Refresh"}
          </Button>
          <Button onClick={handleCreateNew} size="sm">
            <Plus className="h-4 w-4 mr-2" />
            Create Instance
          </Button>
        </div>
      </PageHeader>

      {/* Setup Deployment Card */}
      {readyInstances.length > 0 && (
        <Card className="rounded-2xl shadow-sm border border-border/40">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <GitBranch className="h-4 w-4" />
              Setup Deployment
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Deployment type toggle */}
            <div className="flex gap-2">
              {(["fullstack", "single-appservice", "single-swa"] as DeploymentType[]).map(type => (
                <Button
                  key={type}
                  size="sm"
                  variant={deploymentType === type ? "default" : "outline"}
                  onClick={() => { setDeploymentType(type); setFrontendInstanceId(""); setBackendInstanceId(""); setDbInstanceId(""); setSingleInstanceId(""); }}
                >
                  {type === "fullstack" ? "Full Stack" : type === "single-appservice" ? "App Service Only" : "Static Web App Only"}
                </Button>
              ))}
            </div>

            {/* Full Stack selectors */}
            {deploymentType === "fullstack" && (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground font-medium">Frontend (Static Web App) *</p>
                  <Select value={frontendInstanceId} onValueChange={setFrontendInstanceId}>
                    <SelectTrigger><SelectValue placeholder="Select SWA instance" /></SelectTrigger>
                    <SelectContent>
                      {swaInstances.map(i => <SelectItem key={i.id} value={i.id}>{i.instanceName}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  {swaInstances.length === 0 && <p className="text-xs text-muted-foreground">No ready Static Web App instances</p>}
                </div>
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground font-medium">Backend (App Service) *</p>
                  <Select value={backendInstanceId} onValueChange={setBackendInstanceId}>
                    <SelectTrigger><SelectValue placeholder="Select App Service" /></SelectTrigger>
                    <SelectContent>
                      {appServiceInstances.map(i => <SelectItem key={i.id} value={i.id}>{i.instanceName}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  {appServiceInstances.length === 0 && <p className="text-xs text-muted-foreground">No ready App Service instances</p>}
                </div>
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground font-medium">Database (optional)</p>
                  <Select value={dbInstanceId || "none"} onValueChange={v => setDbInstanceId(v === "none" ? "" : v)}>
                    <SelectTrigger><SelectValue placeholder="Select DB instance" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">None</SelectItem>
                      {dbInstances.map(i => <SelectItem key={i.id} value={i.id}>{i.instanceName}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}

            {/* Single service selector */}
            {(deploymentType === "single-appservice" || deploymentType === "single-swa") && (
              <div className="space-y-1 max-w-sm">
                <p className="text-xs text-muted-foreground font-medium">
                  {deploymentType === "single-appservice" ? "App Service Instance *" : "Static Web App Instance *"}
                </p>
                <Select value={singleInstanceId} onValueChange={setSingleInstanceId}>
                  <SelectTrigger><SelectValue placeholder="Select instance" /></SelectTrigger>
                  <SelectContent>
                    {(deploymentType === "single-appservice" ? appServiceInstances : swaInstances).map(i => (
                      <SelectItem key={i.id} value={i.id}>{i.instanceName}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <Button disabled={!isConfigureReady} onClick={handleOpenDeploy}>
              <GitBranch className="h-4 w-4 mr-2" />
              Configure Deployment
            </Button>
          </CardContent>
        </Card>
      )}

      {error && (
        <Alert variant="destructive">
          <AlertDescription>Failed to load instances: {error.message}</AlertDescription>
        </Alert>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-8 w-8 animate-spin" />
          <span className="ml-2">Loading instances...</span>
        </div>
      ) : instancesData?.instances.length === 0 ? (
        <Card className="rounded-2xl shadow-sm border border-border/40">
          <CardContent className="flex flex-col items-center py-8">
            <div className="text-center space-y-2">
              <h3 className="text-lg font-medium">No instances found</h3>
              <p className="text-muted-foreground">You haven't created any Azure App Service instances yet.</p>
              <Button onClick={handleCreateNew} className="mt-4">
                <Plus className="h-4 w-4 mr-2" />
                Create Your First Instance
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          <Card className="rounded-2xl shadow-sm border border-border/40">
            <CardContent className="pt-6">
              <div className="grid gap-3 md:grid-cols-[1fr_220px]">
                <Input
                  value={searchText}
                  onChange={(e) => setSearchText(e.target.value)}
                  placeholder="Search by name, environment, region, or resource group"
                />
                <Select value={serviceFilter} onValueChange={setServiceFilter}>
                  <SelectTrigger>
                    <SelectValue placeholder="Filter by service" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All services</SelectItem>
                    <SelectItem value="Web App">Web App</SelectItem>
                    <SelectItem value="Static Site">Static Site</SelectItem>
                    <SelectItem value="Database">Database</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>

          {filteredInstances.length === 0 ? (
            <Card className="rounded-2xl shadow-sm border border-border/40">
              <CardContent className="py-8 text-center text-sm text-muted-foreground">
                No instances match your current search/filter.
              </CardContent>
            </Card>
          ) : filteredInstances.map((instance: ProvisionInstanceResponse) => (
            <Card key={instance.id} className="rounded-2xl shadow-sm border border-border/40">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-3">
                    <CardTitle className="text-lg">{instance.instanceName}</CardTitle>
                    <Badge className={getStatusColor(instance.status)}>
                      {getStatusText(instance.status)}
                    </Badge>
                  </div>
                  <div className="flex items-center space-x-2">
                    {instance.url && instance.status === "ready" && (
                      <Button variant="outline" size="sm" onClick={() => window.open(instance.url, '_blank')}>
                        <ExternalLink className="h-4 w-4 mr-2" />
                        Open
                      </Button>
                    )}
                    <Button variant="outline" size="sm" onClick={() => handleViewInstance(instance.id)}>
                      View Details
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleDeleteInstance(instance.id, instance.instanceName)}
                      disabled={instance.status === "deleting"}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                  <div>
                    <span className="text-muted-foreground">Service Type:</span>
                    <div className="font-medium">{instance.serviceType || "Web App"}</div>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Environment:</span>
                    <div className="font-medium">{instance.environment}</div>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Region:</span>
                    <div className="font-medium">{instance.region}</div>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Runtime:</span>
                    <div className="font-medium">{instance.runtime}</div>
                  </div>
                </div>
                {instance.resourceGroupName && (
                  <div className="mt-3 text-sm">
                    <span className="text-muted-foreground">Resource Group:</span>
                    <span className="font-medium ml-2">{instance.resourceGroupName}</span>
                  </div>
                )}
                {instance.errorMessage && (
                  <Alert variant="destructive" className="mt-3">
                    <AlertDescription>{instance.errorMessage}</AlertDescription>
                  </Alert>
                )}
                <div className="mt-3 text-xs text-muted-foreground">
                  Created: {new Date(instance.createdAt).toLocaleString()}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Deploy Setup Dialog */}
      {showDeploySetup && (
        <DeploySetupDialog
          open={showDeploySetup}
          onClose={handleCloseDeploy}
          armToken={armToken}
          deploymentType={deploymentType}
          frontendInstance={frontendInstance}
          backendInstance={backendInstance}
          dbInstance={dbInstance}
          singleInstance={singleInstance}
        />
      )}
    </div>
  );
}
