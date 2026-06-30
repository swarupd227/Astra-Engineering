import { useState, useEffect } from "react";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, ArrowLeft, ExternalLink, Trash2, RefreshCw, Copy, Server } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { provisioningService } from "@/services/provisioningService";
import { useLocation, useRoute } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { acquireAzureManagementToken } from "@/utils/api-interceptor";

export default function InstanceDetailsPage() {
  const [, setLocation] = useLocation();
  const [, params] = useRoute("/instances/:id");
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const instanceId = params?.id;
  const [armToken, setArmToken] = useState<string | null>(null);

  useEffect(() => {
    acquireAzureManagementToken().then(t => setArmToken(t));
  }, []);

  const {
    data: instance,
    isLoading,
    error,
    refetch
  } = useQuery({
    queryKey: ["instance", instanceId],
    queryFn: () => provisioningService.getInstance(instanceId!),
    enabled: !!instanceId,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      // Poll every 5s while provisioning, stop once terminal state reached
      return !status || status === "provisioning" ? 5000 : false;
    }
  });

  const handleDelete = async () => {
    try {
      const armToken = await acquireAzureManagementToken() ?? undefined;
      await provisioningService.deleteInstance(instanceId!, armToken);
      toast({
        title: "Instance deleted",
        description: `Instance "${instance?.instanceName}" has been deleted`,
      });
      setLocation("/instances");
    } catch (error: any) {
      toast({
        title: "Delete failed",
        description: error.message || "Failed to delete instance",
        variant: "destructive"
      });
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast({
      title: "Copied to clipboard",
      description: "Text copied successfully",
    });
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

  if (!instanceId) {
    return <div>Invalid instance ID</div>;
  }

  return (
    <div className="flex-1 space-y-6 p-6">
      <PageHeader
        icon={Server}
        title={instance ? instance.instanceName : "Instance Details"}
        subtitle="View and manage Azure App Service instance details"
        color="blue"
      >
        <div className="flex gap-2">
          <Button
            onClick={() => setLocation("/instances")}
            variant="outline"
            size="sm"
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Instances
          </Button>
          {instance && (
            <>
              <Button
                onClick={() => refetch()}
                variant="outline"
                size="sm"
              >
                <RefreshCw className="h-4 w-4 mr-2" />
                Refresh
              </Button>
              {instance.url && instance.status === "ready" && (
                <Button
                  onClick={() => window.open(instance.url, '_blank')}
                  size="sm"
                >
                  <ExternalLink className="h-4 w-4 mr-2" />
                  Open Instance
                </Button>
              )}
            </>
          )}
        </div>
      </PageHeader>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>
            Failed to load instance: {error.message}
          </AlertDescription>
        </Alert>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-8 w-8 animate-spin" />
          <span className="ml-2">Loading instance...</span>
        </div>
      ) : instance ? (
        <div className="space-y-6">
          {/* Status Card */}
          <Card className="rounded-2xl shadow-sm border border-border/40">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-xl">Instance Status</CardTitle>
                <Badge className={getStatusColor(instance.status)}>
                  {getStatusText(instance.status)}
                </Badge>
              </div>
            </CardHeader>
            <CardContent>
              {instance.status === "provisioning" && (
                <div className="flex items-center space-x-2 text-blue-600">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>Instance is being provisioned. This may take several minutes...</span>
                </div>
              )}
              {instance.status === "ready" && (
                <div className="space-y-2">
                  <p className="text-green-600">
                    {instance.serviceType === "Database"
                      ? "✅ DB is ready! You can now use and configure it."
                      : "✅ Instance is ready and running!"}
                  </p>
                  {instance.url && (
                    <div className="flex items-center space-x-2">
                      <span className="font-medium">URL:</span>
                      <a 
                        href={instance.url} 
                        target="_blank" 
                        rel="noopener noreferrer"
                        className="text-blue-600 hover:underline"
                      >
                        {instance.url}
                      </a>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => copyToClipboard(instance.url!)}
                      >
                        <Copy className="h-4 w-4" />
                      </Button>
                    </div>
                  )}
                </div>
              )}
              {instance.status === "failed" && instance.errorMessage && (
                <Alert variant="destructive">
                  <AlertDescription>
                    <strong>Error:</strong> {instance.errorMessage}
                  </AlertDescription>
                </Alert>
              )}
            </CardContent>
          </Card>

          {/* Configuration Details */}
          <Card className="rounded-2xl shadow-sm border border-border/40">
            <CardHeader>
              <CardTitle>Configuration</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-4">
                  <div>
                    <span className="text-sm text-muted-foreground">Instance Name</span>
                    <div className="font-medium">{instance.instanceName}</div>
                  </div>
                  <div>
                    <span className="text-sm text-muted-foreground">Service Type</span>
                    <div className="font-medium">{instance.serviceType || "Web App"}</div>
                  </div>
                  <div>
                    <span className="text-sm text-muted-foreground">Environment</span>
                    <div className="font-medium">{instance.environment}</div>
                  </div>
                  <div>
                    <span className="text-sm text-muted-foreground">Region</span>
                    <div className="font-medium">{instance.region}</div>
                  </div>
                </div>
                <div className="space-y-4">
                  <div>
                    <span className="text-sm text-muted-foreground">Runtime</span>
                    <div className="font-medium">{instance.runtime}</div>
                  </div>
                  <div>
                    <span className="text-sm text-muted-foreground">Plan Tier</span>
                    <div className="font-medium">{instance.planTier}</div>
                  </div>
                  <div>
                    <span className="text-sm text-muted-foreground">Created</span>
                    <div className="font-medium">{new Date(instance.createdAt).toLocaleString()}</div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Azure Resources */}
          {(instance.resourceGroupName || instance.appServiceName) && (
            <Card className="rounded-2xl shadow-sm border border-border/40">
              <CardHeader>
                <CardTitle>Azure Resources</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {instance.resourceGroupName && (
                    <div>
                      <span className="text-sm text-muted-foreground">Resource Group</span>
                      <div className="flex items-center space-x-2">
                        <span className="font-medium">{instance.resourceGroupName}</span>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => copyToClipboard(instance.resourceGroupName!)}
                        >
                          <Copy className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  )}
                  {instance.appServiceName && (
                    <div>
                      <span className="text-sm text-muted-foreground">App Service Name</span>
                      <div className="flex items-center space-x-2">
                        <span className="font-medium">{instance.appServiceName}</span>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => copyToClipboard(instance.appServiceName!)}
                        >
                          <Copy className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  )}
                  {instance.appServicePlanName && (
                    <div>
                      <span className="text-sm text-muted-foreground">App Service Plan</span>
                      <div className="flex items-center space-x-2">
                        <span className="font-medium">{instance.appServicePlanName}</span>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => copyToClipboard(instance.appServicePlanName!)}
                        >
                          <Copy className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Actions */}
          <Card className="rounded-2xl shadow-sm border border-border/40">
            <CardHeader>
              <CardTitle>Actions</CardTitle>
            </CardHeader>
            <CardContent>
              <Button
                variant="destructive"
                onClick={handleDelete}
                disabled={instance.status === "deleting"}
              >
                <Trash2 className="h-4 w-4 mr-2" />
                Delete Instance
              </Button>
            </CardContent>
          </Card>
        </div>
      ) : (
        <div className="text-center py-8">
          <h3 className="text-lg font-medium">Instance not found</h3>
          <p className="text-muted-foreground">
            The instance you're looking for doesn't exist or you don't have access to it.
          </p>
        </div>
      )}
    </div>
  );
}