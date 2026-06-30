import { useState, useMemo, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AdvancedSettings } from "./AdvancedSettings";
import { useProvisionInstance } from "@/hooks/useProvisionInstance";
import { useToast } from "@/hooks/use-toast";
import { Loader2, AlertCircle, Plus, FolderOpen } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMsal } from "@azure/msal-react";
import { azureManagementRequest } from "@/config/msalConfig";
import { provisioningService } from "@/services/provisioningService";
import { Alert, AlertDescription } from "@/components/ui/alert";
import type {
  CreateInstancePayload,
  EnvironmentType,
  RegionType,
  RuntimeType,
  ServiceType,
  PlanTierType,
  TagPair,
  AzureSubscription,
  AzureResourceGroup,
  DatabaseEngineType,
  DatabaseServerMode,
  DatabaseSkuTier,
} from "@shared/types/provisioning.types";
import { useLocation } from "wouter";

export function ProvisionInstanceForm() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { provision, loading, error } = useProvisionInstance();
  const { instance: msalInstance } = useMsal();
  const queryClient = useQueryClient();

  // Form state
  const [instanceName, setInstanceName] = useState("");
  const [environment, setEnvironment] = useState<EnvironmentType>("Development");
  const [region, setRegion] = useState<RegionType>("canadacentral");
  const [serviceType, setServiceType] = useState<ServiceType>("Web App");
  const [runtime, setRuntime] = useState<RuntimeType>("Node 20 LTS");
  const [planTier, setPlanTier] = useState<PlanTierType>("Basic (B1)");
  const [frontendUrl, setFrontendUrl] = useState("");

  // Database-specific state
  const [dbEngine, setDbEngine] = useState<DatabaseEngineType>("Azure SQL");
  const [dbServerMode, setDbServerMode] = useState<DatabaseServerMode>("new");
  const [dbServerName, setDbServerName] = useState("");
  const [dbAdminUsername, setDbAdminUsername] = useState("");
  const [dbAdminPassword, setDbAdminPassword] = useState("");
  const [dbName, setDbName] = useState("");
  const [dbSkuTier, setDbSkuTier] = useState<DatabaseSkuTier>("Burstable");
  const [dbStorageGb, setDbStorageGb] = useState(32);

  // Azure context state
  const [selectedSubscription, setSelectedSubscription] = useState<string>("");
  const [selectedResourceGroup, setSelectedResourceGroup] = useState<string>("");
  const [rgMode, setRgMode] = useState<"existing" | "new">("existing");
  const [newRgName, setNewRgName] = useState<string>("");
  const [newRgLocation, setNewRgLocation] = useState<string>("");
  const [creatingRg, setCreatingRg] = useState(false);
  const [createRgError, setCreateRgError] = useState<string | null>(null);

  // Track whether the user has granted Azure Management access
  const [armTokenReady, setArmTokenReady] = useState<boolean | null>(null); // null = checking
  // Store the token directly so we don't depend on MSAL silent re-acquisition
  const [armToken, setArmToken] = useState<string | null>(null);

  // On mount, silently try to get ARM token using the component's own MSAL instance
  useEffect(() => {
    const accounts = msalInstance.getAllAccounts();
    if (!accounts.length) {
      setArmTokenReady(false);
      return;
    }
    msalInstance.acquireTokenSilent({
      ...azureManagementRequest,
      account: accounts[0],
    }).then((result) => {
      if (result.accessToken) {
        setArmToken(result.accessToken);
        setArmTokenReady(true);
      } else {
        setArmTokenReady(false);
      }
    }).catch(() => {
      setArmTokenReady(false);
    });
  }, [msalInstance]);

  // Advanced settings state
  const [enableLogging, setEnableLogging] = useState(false);
  const [autoDeleteDays, setAutoDeleteDays] = useState<number | null>(null);
  const [tags, setTags] = useState<TagPair[]>([]);

  // Fetch user's Azure subscriptions — only when ARM token is confirmed available
  const {
    data: azureContext,
    isLoading: subscriptionsLoading,
    error: subscriptionsError
  } = useQuery({
    queryKey: ["/api/azure/subscriptions", armToken],
    queryFn: () => provisioningService.getUserSubscriptions(armToken!),
    enabled: armTokenReady === true && !!armToken,
    staleTime: 5 * 60 * 1000, // Cache for 5 minutes
  });

  // Fetch resource groups for selected subscription
  const { 
    data: resourceGroupsData, 
    isLoading: resourceGroupsLoading, 
    error: resourceGroupsError 
  } = useQuery({
    queryKey: ["/api/azure/resource-groups", selectedSubscription],
    queryFn: () => selectedSubscription && armToken ? provisioningService.getResourceGroups(selectedSubscription, armToken) : Promise.resolve({ resourceGroups: [] }),
    enabled: !!selectedSubscription && !!armToken,
    staleTime: 2 * 60 * 1000, // Cache for 2 minutes
  });

  // Set default subscription when loaded
  useEffect(() => {
    if (azureContext?.defaultSubscription && !selectedSubscription) {
      setSelectedSubscription(azureContext.defaultSubscription.id);
    }
  }, [azureContext?.defaultSubscription]); // Only depend on the actual defaultSubscription, not selectedSubscription

  // Clear resource group selection when subscription changes
  useEffect(() => {
    setSelectedResourceGroup("");
    setNewRgName("");
    setNewRgLocation("");
    setCreateRgError(null);
  }, [selectedSubscription]);

  const handleCreateResourceGroup = async () => {
    if (!newRgName.trim() || !newRgLocation || !selectedSubscription || !armToken) return;
    setCreatingRg(true);
    setCreateRgError(null);
    try {
      const { resourceGroup } = await provisioningService.createResourceGroup(
        selectedSubscription,
        newRgName.trim(),
        newRgLocation,
        armToken
      );
      // Invalidate cache so the dropdown refreshes
      queryClient.invalidateQueries({ queryKey: ["/api/azure/resource-groups", selectedSubscription] });
      setSelectedResourceGroup(resourceGroup.name);
      setRgMode("existing");
      setNewRgName("");
      setNewRgLocation("");
      toast({ title: "Resource group created", description: `"${resourceGroup.name}" created successfully.` });
    } catch (err: any) {
      setCreateRgError(err.message || "Failed to create resource group");
    } finally {
      setCreatingRg(false);
    }
  };

  const isStaticWebApp = runtime === 'Static Web App' || serviceType === 'Static Site';
  const isDatabase = serviceType === 'Database';

  // Auto-derive instance name from database name when provisioning a database.
  // Clear it when switching back to a non-database type so the field starts fresh.
  useEffect(() => {
    if (isDatabase && dbName) {
      const sanitized = dbName.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').slice(0, 30);
      setInstanceName(sanitized);
    } else if (!isDatabase) {
      // Only clear if it was auto-set (don't wipe manual input when user switches service type)
      setInstanceName((prev) => (prev && /^[a-z0-9-]+$/.test(prev) ? prev : ""));
    }
  }, [isDatabase, dbName]);

  // Fetch existing DB servers when user chooses "existing" server mode
  const {
    data: dbServersData,
    isLoading: dbServersLoading,
  } = useQuery({
    queryKey: ["/api/azure/database-servers", selectedSubscription, selectedResourceGroup, dbEngine],
    queryFn: () => provisioningService.listDatabaseServers(selectedSubscription, selectedResourceGroup, dbEngine, armToken!),
    enabled: isDatabase && dbServerMode === "existing" && !!selectedSubscription && !!selectedResourceGroup && !!armToken,
    staleTime: 2 * 60 * 1000,
  });

  // Validation
  const instanceNameError = useMemo(() => {
    if (!instanceName) return null;

    if (instanceName.length > 30) return "Instance name must be 30 characters or less";
    if (!/^[a-z0-9-]+$/.test(instanceName)) return "Only lowercase letters, numbers, and hyphens allowed";
    if (instanceName.includes(" ")) return "No spaces allowed in instance name";

    return null;
  }, [instanceName]);

  const isFormValid = useMemo(() => {
    if (!environment || !region || !selectedSubscription || !selectedResourceGroup) return false;

    if (isDatabase) {
      if (!dbName || !dbServerName) return false;
      if (dbServerMode === "new") return !!dbAdminUsername && !!dbAdminPassword;
      return true;
    }

    return instanceName.length > 0 && !instanceNameError && !!runtime && !!planTier;
  }, [instanceName, instanceNameError, environment, region, runtime, planTier, selectedSubscription, selectedResourceGroup, isDatabase, dbName, dbServerName, dbServerMode, dbAdminUsername, dbAdminPassword]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!isFormValid) return;

    const payload: CreateInstancePayload = {
      instanceName,
      environment,
      region,
      serviceType,
      runtime: isDatabase ? undefined : runtime,
      planTier: isDatabase ? undefined : planTier,
      subscriptionId: selectedSubscription,
      resourceGroupName: selectedResourceGroup,
      ...(frontendUrl.trim() ? { frontendUrl: frontendUrl.trim() } : {}),
      advancedSettings: {
        enableLogging,
        autoDeleteDays,
        tags: tags.filter((tag) => tag.key && tag.value),
      },
      ...(isDatabase ? {
        databaseConfig: {
          engine: dbEngine,
          serverMode: dbServerMode,
          serverName: dbServerName,
          adminUsername: dbAdminUsername,
          adminPassword: dbAdminPassword,
          databaseName: dbName,
          skuTier: dbSkuTier,
          storageSizeGb: dbStorageGb,
        },
      } : {}),
    };

    try {
      provision(payload, armToken ?? undefined);

      toast({
        title: "Provisioning started successfully",
        description: `Instance "${instanceName}" is being provisioned in ${selectedResourceGroup}. You can monitor its progress in the instances list.`,
      });

      // Reset form
      setInstanceName("");
      setEnvironment("Development");
      setRegion("canadacentral");
      setServiceType("Web App");
      setRuntime("Node 20 LTS");
      setPlanTier("Basic (B1)");
      setDbEngine("Azure SQL");
      setDbServerMode("new");
      setDbServerName("");
      setDbAdminUsername("");
      setDbAdminPassword("");
      setDbName("");
      setDbSkuTier("Burstable");
      setDbStorageGb(32);
      setSelectedResourceGroup("");
      setRgMode("existing");
      setNewRgName("");
      setNewRgLocation("");
      setCreateRgError(null);
      setEnableLogging(false);
      setAutoDeleteDays(null);
      setTags([]);

      // Redirect to instances list to see the new instance
      setLocation("/instances");
    } catch (err) {
      // Error handling is managed by the hook
    }
  };

  const handleCancel = () => {
    setLocation("/overview");
  };

  const handleGrantAzureAccess = async () => {
    try {
      const result = await msalInstance.acquireTokenPopup(azureManagementRequest);
      if (result.accessToken) {
        setArmToken(result.accessToken);
        setArmTokenReady(true);
      }
    } catch (err) {
      console.error("[ProvisionForm] Azure consent failed:", err);
    }
  };

  return (
    <Card className="rounded-2xl shadow-sm border border-border/40">
      <CardHeader>
        <CardTitle>Instance Configuration</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-6">

          {/* ── Two-column main grid ── */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">

            {/* LEFT: Azure Configuration */}
            <div className="space-y-4 p-4 bg-muted/20 rounded-lg border h-full">
            <h3 className="text-sm font-medium text-foreground">Azure Configuration</h3>

            {armTokenReady === null && (
              <div className="flex items-center space-x-2 p-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>Checking Azure access...</span>
              </div>
            )}

            {armTokenReady === false && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription className="flex flex-col gap-3">
                  <span>Azure access is required to load your subscriptions. Click below to grant access.</span>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="w-fit"
                    onClick={handleGrantAzureAccess}
                  >
                    Grant Azure Access
                  </Button>
                </AlertDescription>
              </Alert>
            )}

            {armTokenReady === true && subscriptionsError && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  Failed to load subscriptions: {subscriptionsError.message}
                </AlertDescription>
              </Alert>
            )}

            {/* Subscription Selection */}
            <div className="space-y-2">
              <Label htmlFor="azure-subscription">
                Azure Subscription <span className="text-destructive">*</span>
              </Label>
              {subscriptionsLoading ? (
                <div className="flex items-center space-x-2 p-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span className="text-sm text-muted-foreground">Loading subscriptions...</span>
                </div>
              ) : (
                <Select value={selectedSubscription} onValueChange={setSelectedSubscription}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select Azure subscription" />
                  </SelectTrigger>
                  <SelectContent>
                    {azureContext?.subscriptions.map((sub) => (
                      <SelectItem key={sub.id} value={sub.id}>
                        {sub.displayName} ({sub.state})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>

            {/* Resource Group Selection */}
            <div className="space-y-2">
              <Label htmlFor="azure-resource-group">
                Resource Group <span className="text-destructive">*</span>
              </Label>

              {/* Mode toggle — only show when a subscription is selected */}
              {selectedSubscription && (
                <div className="flex gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant={rgMode === "existing" ? "default" : "outline"}
                    className="flex-1"
                    onClick={() => setRgMode("existing")}
                  >
                    <FolderOpen className="mr-1.5 h-3.5 w-3.5" />
                    Use Existing
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant={rgMode === "new" ? "default" : "outline"}
                    className="flex-1"
                    onClick={() => { setRgMode("new"); setSelectedResourceGroup(""); }}
                  >
                    <Plus className="mr-1.5 h-3.5 w-3.5" />
                    Create New
                  </Button>
                </div>
              )}

              {/* Existing RG picker */}
              {rgMode === "existing" && (
                resourceGroupsLoading ? (
                  <div className="flex items-center space-x-2 p-2">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span className="text-sm text-muted-foreground">Loading resource groups...</span>
                  </div>
                ) : selectedSubscription ? (
                  <Select value={selectedResourceGroup} onValueChange={setSelectedResourceGroup}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select resource group" />
                    </SelectTrigger>
                    <SelectContent>
                      {resourceGroupsData?.resourceGroups.map((rg) => (
                        <SelectItem key={rg.id} value={rg.name}>
                          {rg.name} ({rg.location})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <Select disabled>
                    <SelectTrigger>
                      <SelectValue placeholder="Select a subscription first" />
                    </SelectTrigger>
                  </Select>
                )
              )}

              {/* New RG form */}
              {rgMode === "new" && selectedSubscription && (
                <div className="space-y-3 p-3 border rounded-lg bg-muted/10">
                  <div className="space-y-1.5">
                    <Label className="text-xs">Resource Group Name <span className="text-destructive">*</span></Label>
                    <Input
                      placeholder="my-resource-group"
                      value={newRgName}
                      onChange={(e) => setNewRgName(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Location <span className="text-destructive">*</span></Label>
                    <Select value={newRgLocation} onValueChange={setNewRgLocation}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select location" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="canadacentral">Canada Central</SelectItem>
                        <SelectItem value="eastus">East US</SelectItem>
                        <SelectItem value="eastus2">East US 2</SelectItem>
                        <SelectItem value="westus">West US</SelectItem>
                        <SelectItem value="westus2">West US 2</SelectItem>
                        <SelectItem value="centralus">Central US</SelectItem>
                        <SelectItem value="westeurope">West Europe</SelectItem>
                        <SelectItem value="northeurope">North Europe</SelectItem>
                        <SelectItem value="eastasia">East Asia</SelectItem>
                        <SelectItem value="southeastasia">Southeast Asia</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  {createRgError && (
                    <p className="text-xs text-destructive">{createRgError}</p>
                  )}
                  <Button
                    type="button"
                    size="sm"
                    disabled={!newRgName.trim() || !newRgLocation || creatingRg}
                    onClick={handleCreateResourceGroup}
                  >
                    {creatingRg ? (
                      <><Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />Creating...</>
                    ) : (
                      <><Plus className="mr-1.5 h-3.5 w-3.5" />Create Resource Group</>
                    )}
                  </Button>
                </div>
              )}

              {resourceGroupsError && rgMode === "existing" && (
                <p className="text-xs text-destructive">
                  Error loading resource groups: {resourceGroupsError.message}
                </p>
              )}
            </div>
          </div>{/* end LEFT column */}

            {/* RIGHT: Service Details */}
            <div className="space-y-4">

              {/* Service Type */}
              <div className="space-y-2">
                <Label htmlFor="service-type">
                  Service Type <span className="text-destructive">*</span>
                </Label>
                <Select value={serviceType} onValueChange={(value) => setServiceType(value as ServiceType)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Web App">Web App</SelectItem>
                    <SelectItem value="API">API - REST APIs and microservices</SelectItem>
                    <SelectItem value="Static Site">Static Site - HTML/CSS/JS sites</SelectItem>
                    <SelectItem value="Database">Database - Azure SQL / PostgreSQL / MySQL</SelectItem>
                    <SelectItem value="Function App" disabled>Function App - Coming soon</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Instance Name — hidden for Database */}
              {!isDatabase && (
                <div className="space-y-2">
                  <Label htmlFor="instance-name">
                    Instance Name <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    id="instance-name"
                    placeholder="my-app-instance"
                    value={instanceName}
                    onChange={(e) => setInstanceName(e.target.value)}
                    className={instanceNameError ? "border-destructive" : ""}
                  />
                  <div className="min-h-[1rem]">
                    {instanceNameError && <p className="text-xs text-destructive">{instanceNameError}</p>}
                    {!instanceNameError && instanceName && <p className="text-xs text-muted-foreground">{instanceName.length}/30 characters</p>}
                    {!instanceName && <p className="text-xs text-muted-foreground">Lowercase only, no spaces, alphanumeric + hyphens, max 30 characters</p>}
                  </div>
                </div>
              )}

              {/* Environment + Region side by side */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="environment">Environment <span className="text-destructive">*</span></Label>
                  <Select value={environment} onValueChange={(value) => setEnvironment(value as EnvironmentType)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Development">Development</SelectItem>
                      <SelectItem value="QA">QA</SelectItem>
                      <SelectItem value="Production">Production</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="region">Region <span className="text-destructive">*</span></Label>
                  <Select value={region} onValueChange={(value) => setRegion(value as RegionType)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {isStaticWebApp ? (
                        <>
                          <SelectItem value="eastus2">East US 2</SelectItem>
                          <SelectItem value="westus2">West US 2</SelectItem>
                          <SelectItem value="centralus">Central US</SelectItem>
                          <SelectItem value="westeurope">West Europe</SelectItem>
                          <SelectItem value="eastasia">East Asia</SelectItem>
                        </>
                      ) : (
                        <>
                          <SelectItem value="canadacentral">Canada Central</SelectItem>
                          <SelectItem value="eastus">East US</SelectItem>
                          <SelectItem value="eastus2">East US 2</SelectItem>
                          <SelectItem value="westus">West US</SelectItem>
                          <SelectItem value="westus2">West US 2</SelectItem>
                          <SelectItem value="centralus">Central US</SelectItem>
                        </>
                      )}
                    </SelectContent>
                  </Select>
                  {isStaticWebApp && <p className="text-xs text-muted-foreground">Static Web Apps are available in limited regions.</p>}
                </div>
              </div>

              {/* Runtime + Plan Tier — hidden for Database */}
              {!isDatabase && (
                <div className={`grid gap-4 ${!isStaticWebApp ? 'grid-cols-2' : 'grid-cols-1'}`}>
                  {/* Runtime — hidden for Static Site */}
                  {!isStaticWebApp && (
                    <div className="space-y-2">
                      <Label htmlFor="runtime">Runtime <span className="text-destructive">*</span></Label>
                      <Select value={runtime} onValueChange={(value) => setRuntime(value as RuntimeType)}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="Node 20 LTS">Node 20 LTS</SelectItem>
                          <SelectItem value="Node 18 LTS">Node 18 LTS</SelectItem>
                          <SelectItem value="Python 3.11">Python 3.11</SelectItem>
                          <SelectItem value=".NET 8">.NET 8</SelectItem>
                          <SelectItem value="PHP 8.2">PHP 8.2</SelectItem>
                          <SelectItem value="Java 17">Java 17</SelectItem>
                          <SelectItem value="Static Web App">Static Web App</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                  {/* Plan Tier — shown for all non-database types */}
                  <div className="space-y-2">
                    <Label htmlFor="plan-tier">Plan Tier <span className="text-destructive">*</span></Label>
                    <Select value={planTier} onValueChange={(value) => setPlanTier(value as PlanTierType)}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {isStaticWebApp ? (
                          <>
                            <SelectItem value="Free (F1)">Free - Hobby &amp; personal projects</SelectItem>
                            <SelectItem value="Standard (S1)">Standard - Production apps</SelectItem>
                          </>
                        ) : (
                          <>
                            <SelectItem value="Free (F1)">Free (F1)</SelectItem>
                            <SelectItem value="Basic (B1)">Basic (B1)</SelectItem>
                            <SelectItem value="Basic (B2)">Basic (B2)</SelectItem>
                            <SelectItem value="Standard (S1)">Standard (S1)</SelectItem>
                            <SelectItem value="Standard (S2)">Standard (S2)</SelectItem>
                            <SelectItem value="Premium (P1v3)">Premium (P1v3)</SelectItem>
                          </>
                        )}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              )}

              {/* Frontend URL — for CORS, shown for Web App and API only */}
              {!isDatabase && !isStaticWebApp && (
                <div className="space-y-2">
                  <Label htmlFor="frontend-url">Frontend URL <span className="text-xs text-muted-foreground">(for CORS)</span></Label>
                  <Input
                    id="frontend-url"
                    placeholder="https://your-frontend.azurestaticapps.net"
                    value={frontendUrl}
                    onChange={(e) => setFrontendUrl(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    Enables CORS with <code>Access-Control-Allow-Credentials</code> for this origin
                  </p>
                </div>
              )}

            </div>{/* end RIGHT column */}
          </div>{/* end two-column grid */}

          {/* Database Configuration — full width, shown only when serviceType is Database */}
          {isDatabase && (
            <div className="space-y-4 p-4 bg-muted/20 rounded-lg border">
              <h3 className="text-sm font-medium text-foreground">Database Configuration</h3>

              {/* Row 1: Engine | Server Mode | Database Name */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label>Database Engine <span className="text-destructive">*</span></Label>
                  <Select value={dbEngine} onValueChange={(v) => setDbEngine(v as DatabaseEngineType)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Azure SQL">Azure SQL</SelectItem>
                      <SelectItem value="PostgreSQL Flexible">PostgreSQL Flexible</SelectItem>
                      <SelectItem value="MySQL Flexible">MySQL Flexible</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Server <span className="text-destructive">*</span></Label>
                  <Select value={dbServerMode} onValueChange={(v) => { setDbServerMode(v as DatabaseServerMode); setDbServerName(""); }}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="new">Create new server</SelectItem>
                      <SelectItem value="existing">Use existing server</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Database Name <span className="text-destructive">*</span></Label>
                  <Input placeholder="mydb" value={dbName} onChange={(e) => setDbName(e.target.value)} />
                </div>
              </div>

              {/* Row 2a: Existing server picker */}
              {dbServerMode === "existing" && (
                <div className="space-y-2">
                  <Label>Existing Server <span className="text-destructive">*</span></Label>
                  {!selectedResourceGroup ? (
                    <p className="text-xs text-muted-foreground">Select a resource group first</p>
                  ) : dbServersLoading ? (
                    <div className="flex items-center space-x-2 p-2">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      <span className="text-sm text-muted-foreground">Loading servers...</span>
                    </div>
                  ) : (dbServersData?.servers?.length ?? 0) === 0 ? (
                    <p className="text-xs text-muted-foreground">No {dbEngine} servers found in this resource group</p>
                  ) : (
                    <Select value={dbServerName} onValueChange={setDbServerName}>
                      <SelectTrigger><SelectValue placeholder="Select a server" /></SelectTrigger>
                      <SelectContent>
                        {dbServersData?.servers.map((s) => (
                          <SelectItem key={s.name} value={s.name}>{s.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </div>
              )}

              {/* Row 2b: New server fields — Server Name | Admin Username | Admin Password */}
              {dbServerMode === "new" && (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <Label>Server Name <span className="text-destructive">*</span></Label>
                    <Input placeholder="my-db-server" value={dbServerName} onChange={(e) => setDbServerName(e.target.value)} />
                    <p className="text-xs text-muted-foreground">Lowercase letters, numbers and hyphens only</p>
                  </div>
                  <div className="space-y-2">
                    <Label>Admin Username <span className="text-destructive">*</span></Label>
                    <Input placeholder="dbadmin" value={dbAdminUsername} onChange={(e) => setDbAdminUsername(e.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label>Admin Password <span className="text-destructive">*</span></Label>
                    <Input type="password" placeholder="Strong password" value={dbAdminPassword} onChange={(e) => setDbAdminPassword(e.target.value)} />
                    <p className="text-xs text-muted-foreground">Min 8 chars, uppercase, lowercase, number and symbol</p>
                  </div>
                </div>
              )}

              {/* Row 3: Performance Tier | Storage Size */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Performance Tier</Label>
                  <Select value={dbSkuTier} onValueChange={(v) => setDbSkuTier(v as DatabaseSkuTier)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Burstable">Burstable - Dev/test workloads</SelectItem>
                      <SelectItem value="GeneralPurpose">General Purpose - Balanced production</SelectItem>
                      <SelectItem value="MemoryOptimized">Memory Optimized - High-throughput</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Storage Size</Label>
                  <Select value={String(dbStorageGb)} onValueChange={(v) => setDbStorageGb(Number(v))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="32">32 GB</SelectItem>
                      <SelectItem value="64">64 GB</SelectItem>
                      <SelectItem value="128">128 GB</SelectItem>
                      <SelectItem value="256">256 GB</SelectItem>
                      <SelectItem value="512">512 GB</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
          )}

          {/* Advanced Settings */}
          <AdvancedSettings
            enableLogging={enableLogging}
            autoDeleteDays={autoDeleteDays}
            tags={tags}
            onEnableLoggingChange={setEnableLogging}
            onAutoDeleteDaysChange={setAutoDeleteDays}
            onTagsChange={setTags}
          />

          {/* Error Display */}
          {error && (
            <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-3">
              <p className="text-sm text-destructive">{error}</p>
            </div>
          )}

          {/* Form Actions */}
          <div className="flex gap-3 pt-4">
            <Button
              type="submit"
              disabled={!isFormValid || loading || creatingRg}
              className="flex-1"
            >
              {(loading || creatingRg) && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {creatingRg ? "Creating resource group..." : loading ? "Provisioning..." : "Provision Instance"}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={handleCancel}
              disabled={loading}
            >
              Cancel
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
