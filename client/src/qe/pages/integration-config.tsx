import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useRoute, Link } from "wouter";
import { DashboardHeader } from "@/components/dashboard/header";
import { useProject } from "@/contexts/ProjectContext";
import { useDevXAdoSettings, useDevXJiraSettings } from "@/hooks/useDevXConfig";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { 
  ArrowLeft, 
  CheckCircle, 
  AlertCircle, 
  Circle,
  Loader2,
  Eye,
  EyeOff,
  HelpCircle,
  Save,
  Trash2,
  Zap,
  Cloud,
  Database,
  FileText,
  TestTube,
  Layers,
  BarChart3
} from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

interface IntegrationConfig {
  id: string;
  platform: string;
  name: string;
  config: Record<string, any>;
  status: "not_configured" | "connected" | "error";
  lastSyncedAt: string | null;
  lastError: string | null;
}

const platformInfo: Record<string, { name: string; icon: React.ReactNode; iconBg: string }> = {
  azure_devops: { name: "Azure DevOps", icon: <Cloud className="w-6 h-6" />, iconBg: "bg-gradient-to-br from-blue-500 to-blue-600" },
  jira: { name: "JIRA", icon: <Database className="w-6 h-6" />, iconBg: "bg-gradient-to-br from-blue-600 to-indigo-600" },
  zephyr: { name: "Zephyr", icon: <TestTube className="w-6 h-6" />, iconBg: "bg-gradient-to-br from-teal-500 to-cyan-600" },
  testrail: { name: "TestRail", icon: <FileText className="w-6 h-6" />, iconBg: "bg-gradient-to-br from-green-500 to-emerald-600" },
  qtest: { name: "qTest", icon: <Layers className="w-6 h-6" />, iconBg: "bg-gradient-to-br from-purple-500 to-violet-600" },
  qmetry: { name: "QMetry", icon: <BarChart3 className="w-6 h-6" />, iconBg: "bg-gradient-to-br from-orange-500 to-amber-600" },
};

function FieldWithTooltip({ label, tooltip, children, required }: { label: string; tooltip: string; children: React.ReactNode; required?: boolean }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Label>{label}{required && <span className="text-destructive ml-1">*</span>}</Label>
        <Tooltip>
          <TooltipTrigger asChild>
            <HelpCircle className="w-4 h-4 text-muted-foreground cursor-help" />
          </TooltipTrigger>
          <TooltipContent className="max-w-xs">
            <p>{tooltip}</p>
          </TooltipContent>
        </Tooltip>
      </div>
      {children}
    </div>
  );
}

function PasswordInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  const [showPassword, setShowPassword] = useState(false);
  
  return (
    <div className="relative">
      <Input
        type={showPassword ? "text" : "password"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="pr-10"
        data-testid="input-password"
      />
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="absolute right-0 top-0 h-full px-3"
        onClick={() => setShowPassword(!showPassword)}
      >
        {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
      </Button>
    </div>
  );
}

export default function IntegrationConfigPage() {
  const [, params] = useRoute("/integration-management/:platform");
  const platform = params?.platform || "";
  const [config, setConfig] = useState<Record<string, any>>({});
  const [devxPrefilled, setDevxPrefilled] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message?: string; error?: string } | null>(null);
  const { toast } = useToast();
  const { isFromDevx, devxContext } = useProject();
  const { data: adoSettings } = useDevXAdoSettings();
  const { data: jiraSettings } = useDevXJiraSettings();

  const info = platformInfo[platform];

  const { data: integrationData, isLoading } = useQuery<{ success: boolean; integration: IntegrationConfig | null }>({
    queryKey: ["/api/integrations", platform],
  });

  const existingConfig = integrationData?.integration;

  useEffect(() => {
    if (existingConfig?.config) {
      setConfig(existingConfig.config);
    }
  }, [existingConfig]);

  useEffect(() => {
    if (devxPrefilled || existingConfig?.config || !isFromDevx) return;

    if (platform === "azure_devops" && adoSettings) {
      setConfig((prev) => ({
        ...prev,
        organization: adoSettings.organization || devxContext.organization || prev.organization || "",
        project: adoSettings.project || devxContext.adoProjectName || prev.project || "",
        pat: adoSettings.pat || prev.pat || "",
      }));
      setDevxPrefilled(true);
    } else if (platform === "jira" && jiraSettings) {
      setConfig((prev) => ({
        ...prev,
        baseUrl: jiraSettings.baseUrl || prev.baseUrl || "",
        email: jiraSettings.email || prev.email || "",
        apiToken: jiraSettings.apiToken || prev.apiToken || "",
        projectKey: jiraSettings.projectKey || prev.projectKey || "",
      }));
      setDevxPrefilled(true);
    }
  }, [platform, adoSettings, jiraSettings, isFromDevx, existingConfig, devxPrefilled, devxContext]);

  const saveMutation = useMutation({
    mutationFn: async (data: { config: Record<string, any> }) => {
      if (existingConfig?.id) {
        return apiRequest("PUT", `/api/integrations/${existingConfig.id}`, { config: data.config });
      } else {
        return apiRequest("POST", "/api/integrations", {
          platform,
          name: info?.name || platform,
          config: data.config,
        });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/integrations"] });
      toast({ title: "Configuration saved", description: "Your integration settings have been saved successfully." });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "Failed to save configuration", variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      if (existingConfig?.id) {
        return apiRequest("DELETE", `/api/integrations/${existingConfig.id}`);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/integrations"] });
      toast({ title: "Integration deleted", description: "The integration has been removed." });
      window.location.href = "/qe/integration-management";
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "Failed to delete integration", variant: "destructive" });
    },
  });

  const handleTestConnection = async () => {
    setIsTesting(true);
    setTestResult(null);
    
    try {
      // First save the config if not saved
      if (!existingConfig?.id) {
        await saveMutation.mutateAsync({ config });
      }
      
      // Then test connection - refetch to get the saved config
      await queryClient.invalidateQueries({ queryKey: ["/api/integrations", platform] });
      const freshData = await queryClient.fetchQuery<{ success: boolean; integration: IntegrationConfig | null }>({ 
        queryKey: ["/api/integrations", platform] 
      });
      const integration = existingConfig || freshData?.integration;
      if (integration?.id) {
        const response = await apiRequest("POST", `/api/integrations/${integration.id}/test-connection`);
        const result = await response.json();
        setTestResult(result);
        queryClient.invalidateQueries({ queryKey: ["/api/integrations"] });
      }
    } catch (error: any) {
      setTestResult({ success: false, error: error.message || "Connection test failed" });
    } finally {
      setIsTesting(false);
    }
  };

  const handleSave = () => {
    saveMutation.mutate({ config });
  };

  const updateConfig = (key: string, value: any) => {
    setConfig(prev => ({ ...prev, [key]: value }));
  };

  const updateNestedConfig = (parent: string, key: string, value: any) => {
    setConfig(prev => ({
      ...prev,
      [parent]: { ...prev[parent], [key]: value },
    }));
  };

  if (!info) {
    return (
      <div className="flex h-full w-full bg-background items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold mb-2">Unknown Platform</h1>
          <p className="text-muted-foreground mb-4">The platform "{platform}" is not supported.</p>
          <Link href="/integration-management">
            <Button>Back to Configurations</Button>
          </Link>
        </div>
      </div>
    );
  }

  const renderPlatformForm = () => {
    switch (platform) {
      case "azure_devops":
        return (
          <div className="space-y-6">
            <FieldWithTooltip label="Organization URL" tooltip="Your Azure DevOps organization URL (e.g., https://dev.azure.com/your-organization)" required>
              <Input
                value={config.organizationUrl || ""}
                onChange={(e) => updateConfig("organizationUrl", e.target.value)}
                placeholder="https://dev.azure.com/your-organization"
                data-testid="input-org-url"
              />
            </FieldWithTooltip>
            
            <FieldWithTooltip label="Personal Access Token (PAT)" tooltip="Generate from Azure DevOps > User Settings > Personal Access Tokens. Required scopes: Work Items (Read), Code (Read), Build (Read)" required>
              <PasswordInput
                value={config.personalAccessToken || ""}
                onChange={(v) => updateConfig("personalAccessToken", v)}
                placeholder="Enter your PAT"
              />
            </FieldWithTooltip>
            
            <FieldWithTooltip label="Default Project" tooltip="Optional: Select a default project to use">
              <Input
                value={config.defaultProject || ""}
                onChange={(e) => updateConfig("defaultProject", e.target.value)}
                placeholder="Project name"
                data-testid="input-default-project"
              />
            </FieldWithTooltip>
            
            <FieldWithTooltip label="API Version" tooltip="Azure DevOps API version to use">
              <Select value={config.apiVersion || "7.0"} onValueChange={(v) => updateConfig("apiVersion", v)}>
                <SelectTrigger data-testid="select-api-version">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="7.0">7.0</SelectItem>
                  <SelectItem value="6.0">6.0</SelectItem>
                  <SelectItem value="5.1">5.1</SelectItem>
                </SelectContent>
              </Select>
            </FieldWithTooltip>
            
            <Separator />
            
            <div className="space-y-4">
              <h3 className="font-semibold">Sync Options</h3>
              <div className="grid gap-4">
                <div className="flex items-center justify-between">
                  <Label>Auto-sync user stories on sprint start</Label>
                  <Switch
                    checked={config.syncOptions?.autoSyncUserStories || false}
                    onCheckedChange={(v) => updateNestedConfig("syncOptions", "autoSyncUserStories", v)}
                    data-testid="switch-auto-sync"
                  />
                </div>
                <div className="flex items-center justify-between">
                  <Label>Create work items for failed tests</Label>
                  <Switch
                    checked={config.syncOptions?.createWorkItemsForFailedTests || false}
                    onCheckedChange={(v) => updateNestedConfig("syncOptions", "createWorkItemsForFailedTests", v)}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <Label>Link test cases to work items</Label>
                  <Switch
                    checked={config.syncOptions?.linkTestCasesToWorkItems || false}
                    onCheckedChange={(v) => updateNestedConfig("syncOptions", "linkTestCasesToWorkItems", v)}
                  />
                </div>
              </div>
            </div>
            
            <FieldWithTooltip label="Sync Frequency" tooltip="How often to automatically sync data">
              <Select value={config.syncFrequency || "manual"} onValueChange={(v) => updateConfig("syncFrequency", v)}>
                <SelectTrigger data-testid="select-sync-frequency">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="manual">Manual only</SelectItem>
                  <SelectItem value="15min">Every 15 minutes</SelectItem>
                  <SelectItem value="1hour">Every hour</SelectItem>
                  <SelectItem value="6hours">Every 6 hours</SelectItem>
                  <SelectItem value="daily">Daily</SelectItem>
                </SelectContent>
              </Select>
            </FieldWithTooltip>
          </div>
        );

      case "jira":
        return (
          <div className="space-y-6">
            <FieldWithTooltip label="JIRA Instance URL" tooltip="Your JIRA Cloud or Server URL (e.g., https://your-company.atlassian.net)" required>
              <Input
                value={config.instanceUrl || ""}
                onChange={(e) => updateConfig("instanceUrl", e.target.value)}
                placeholder="https://your-company.atlassian.net"
                data-testid="input-instance-url"
              />
            </FieldWithTooltip>
            
            <FieldWithTooltip label="Email Address" tooltip="Your Atlassian account email" required>
              <Input
                type="email"
                value={config.email || ""}
                onChange={(e) => updateConfig("email", e.target.value)}
                placeholder="user@company.com"
                data-testid="input-email"
              />
            </FieldWithTooltip>
            
            <FieldWithTooltip label="API Token" tooltip="Generate from Atlassian Account Settings > Security > API Tokens" required>
              <PasswordInput
                value={config.apiToken || ""}
                onChange={(v) => updateConfig("apiToken", v)}
                placeholder="Enter your API token"
              />
            </FieldWithTooltip>
            
            <FieldWithTooltip label="Default Project Key" tooltip="Optional: The JIRA project key (e.g., PROJ)">
              <Input
                value={config.defaultProjectKey || ""}
                onChange={(e) => updateConfig("defaultProjectKey", e.target.value)}
                placeholder="PROJ"
                data-testid="input-project-key"
              />
            </FieldWithTooltip>
            
            <FieldWithTooltip label="Custom JQL Filter" tooltip="Optional: Use JQL to filter specific issues for sync">
              <Textarea
                value={config.customJqlFilter || ""}
                onChange={(e) => updateConfig("customJqlFilter", e.target.value)}
                placeholder="project = PROJ AND sprint in openSprints()"
                data-testid="input-jql"
              />
            </FieldWithTooltip>
            
            <Separator />
            
            <div className="space-y-4">
              <h3 className="font-semibold">Sync Options</h3>
              <div className="grid gap-4">
                <div className="flex items-center justify-between">
                  <Label>Auto-sync on issue update</Label>
                  <Switch
                    checked={config.syncOptions?.autoSyncOnUpdate || false}
                    onCheckedChange={(v) => updateNestedConfig("syncOptions", "autoSyncOnUpdate", v)}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <Label>Create JIRA issues for failed tests</Label>
                  <Switch
                    checked={config.syncOptions?.createJiraIssuesForFailedTests || false}
                    onCheckedChange={(v) => updateNestedConfig("syncOptions", "createJiraIssuesForFailedTests", v)}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <Label>Sync attachments</Label>
                  <Switch
                    checked={config.syncOptions?.syncAttachments || false}
                    onCheckedChange={(v) => updateNestedConfig("syncOptions", "syncAttachments", v)}
                  />
                </div>
              </div>
            </div>
          </div>
        );

      case "testrail":
        return (
          <div className="space-y-6">
            <FieldWithTooltip label="TestRail Instance URL" tooltip="Your TestRail URL (e.g., https://your-company.testrail.io)" required>
              <Input
                value={config.instanceUrl || ""}
                onChange={(e) => updateConfig("instanceUrl", e.target.value)}
                placeholder="https://your-company.testrail.io"
                data-testid="input-instance-url"
              />
            </FieldWithTooltip>
            
            <FieldWithTooltip label="Username/Email" tooltip="Your TestRail username or email" required>
              <Input
                value={config.username || ""}
                onChange={(e) => updateConfig("username", e.target.value)}
                placeholder="user@company.com"
                data-testid="input-username"
              />
            </FieldWithTooltip>
            
            <FieldWithTooltip label="API Key" tooltip="Generate from TestRail > My Settings > API Keys" required>
              <PasswordInput
                value={config.apiKey || ""}
                onChange={(v) => updateConfig("apiKey", v)}
                placeholder="Enter your API key"
              />
            </FieldWithTooltip>
            
            <FieldWithTooltip label="Default Project" tooltip="Optional: Select a default TestRail project">
              <Input
                value={config.defaultProject || ""}
                onChange={(e) => updateConfig("defaultProject", e.target.value)}
                placeholder="Project name"
                data-testid="input-default-project"
              />
            </FieldWithTooltip>
            
            <Separator />
            
            <div className="space-y-4">
              <h3 className="font-semibold">Test Run Settings</h3>
              <div className="flex items-center justify-between">
                <Label>Auto-create test runs</Label>
                <Switch
                  checked={config.testRunSettings?.autoCreateRuns || false}
                  onCheckedChange={(v) => updateNestedConfig("testRunSettings", "autoCreateRuns", v)}
                />
              </div>
              <FieldWithTooltip label="Run Naming Pattern" tooltip="Pattern for naming test runs">
                <Input
                  value={config.testRunSettings?.runNamingPattern || ""}
                  onChange={(e) => updateNestedConfig("testRunSettings", "runNamingPattern", e.target.value)}
                  placeholder="NAT Execution - {date}"
                />
              </FieldWithTooltip>
            </div>
            
            <Separator />
            
            <div className="space-y-4">
              <h3 className="font-semibold">Sync Options</h3>
              <div className="grid gap-4">
                <div className="flex items-center justify-between">
                  <Label>Push test cases to TestRail</Label>
                  <Switch
                    checked={config.syncOptions?.pushTestCases || false}
                    onCheckedChange={(v) => updateNestedConfig("syncOptions", "pushTestCases", v)}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <Label>Sync execution results</Label>
                  <Switch
                    checked={config.syncOptions?.syncExecutionResults || false}
                    onCheckedChange={(v) => updateNestedConfig("syncOptions", "syncExecutionResults", v)}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <Label>Include screenshots in results</Label>
                  <Switch
                    checked={config.syncOptions?.includeScreenshots || false}
                    onCheckedChange={(v) => updateNestedConfig("syncOptions", "includeScreenshots", v)}
                  />
                </div>
              </div>
            </div>
          </div>
        );

      case "zephyr":
        return (
          <div className="space-y-6">
            <FieldWithTooltip label="Zephyr Product" tooltip="Select which Zephyr product you use" required>
              <Select value={config.product || "scale_cloud"} onValueChange={(v) => updateConfig("product", v)}>
                <SelectTrigger data-testid="select-product">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="scale_cloud">Zephyr Scale (Cloud)</SelectItem>
                  <SelectItem value="scale_server">Zephyr Scale (Server/Data Center)</SelectItem>
                  <SelectItem value="squad">Zephyr Squad</SelectItem>
                </SelectContent>
              </Select>
            </FieldWithTooltip>
            
            <FieldWithTooltip label="JIRA Instance URL" tooltip="Your JIRA instance URL (Zephyr works alongside JIRA)" required>
              <Input
                value={config.jiraInstanceUrl || ""}
                onChange={(e) => updateConfig("jiraInstanceUrl", e.target.value)}
                placeholder="https://your-company.atlassian.net"
                data-testid="input-jira-url"
              />
            </FieldWithTooltip>
            
            <FieldWithTooltip label="API Access Token" tooltip="Generate from Zephyr Scale > Settings > API Access Tokens" required>
              <PasswordInput
                value={config.apiAccessToken || ""}
                onChange={(v) => updateConfig("apiAccessToken", v)}
                placeholder="Enter your API token"
              />
            </FieldWithTooltip>
            
            <FieldWithTooltip label="Account ID" tooltip="Your Atlassian Account ID (required for Cloud)">
              <Input
                value={config.accountId || ""}
                onChange={(e) => updateConfig("accountId", e.target.value)}
                placeholder="Account ID"
                data-testid="input-account-id"
              />
            </FieldWithTooltip>
            
            <Separator />
            
            <div className="space-y-4">
              <h3 className="font-semibold">Test Cycle Settings</h3>
              <div className="flex items-center justify-between">
                <Label>Auto-create test cycles</Label>
                <Switch
                  checked={config.testCycleSettings?.autoCreateCycles || false}
                  onCheckedChange={(v) => updateNestedConfig("testCycleSettings", "autoCreateCycles", v)}
                />
              </div>
              <FieldWithTooltip label="Cycle Naming Pattern" tooltip="Pattern for naming test cycles">
                <Input
                  value={config.testCycleSettings?.cycleNamingPattern || ""}
                  onChange={(e) => updateNestedConfig("testCycleSettings", "cycleNamingPattern", e.target.value)}
                  placeholder="NAT-{date}-{sprint}"
                />
              </FieldWithTooltip>
            </div>
            
            <Separator />
            
            <div className="space-y-4">
              <h3 className="font-semibold">Sync Options</h3>
              <div className="grid gap-4">
                <div className="flex items-center justify-between">
                  <Label>Push test cases to Zephyr</Label>
                  <Switch
                    checked={config.syncOptions?.pushTestCases || false}
                    onCheckedChange={(v) => updateNestedConfig("syncOptions", "pushTestCases", v)}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <Label>Sync execution results</Label>
                  <Switch
                    checked={config.syncOptions?.syncExecutionResults || false}
                    onCheckedChange={(v) => updateNestedConfig("syncOptions", "syncExecutionResults", v)}
                  />
                </div>
              </div>
            </div>
          </div>
        );

      case "qtest":
        return (
          <div className="space-y-6">
            <FieldWithTooltip label="qTest Manager URL" tooltip="Your qTest Manager URL" required>
              <Input
                value={config.managerUrl || ""}
                onChange={(e) => updateConfig("managerUrl", e.target.value)}
                placeholder="https://your-company.qtestnet.com"
                data-testid="input-manager-url"
              />
            </FieldWithTooltip>
            
            <FieldWithTooltip label="API Token" tooltip="Generate from qTest > Settings > API & SDK" required>
              <PasswordInput
                value={config.apiToken || ""}
                onChange={(v) => updateConfig("apiToken", v)}
                placeholder="Enter your API token"
              />
            </FieldWithTooltip>
            
            <FieldWithTooltip label="Default Project" tooltip="Optional: Default qTest project">
              <Input
                value={config.defaultProject || ""}
                onChange={(e) => updateConfig("defaultProject", e.target.value)}
                placeholder="Project name"
                data-testid="input-default-project"
              />
            </FieldWithTooltip>
            
            <Separator />
            
            <div className="space-y-4">
              <h3 className="font-semibold">Test Run Settings</h3>
              <div className="flex items-center justify-between">
                <Label>Auto-create test suites</Label>
                <Switch
                  checked={config.testRunSettings?.autoCreateSuites || false}
                  onCheckedChange={(v) => updateNestedConfig("testRunSettings", "autoCreateSuites", v)}
                />
              </div>
              <FieldWithTooltip label="Suite Naming Pattern" tooltip="Pattern for naming test suites">
                <Input
                  value={config.testRunSettings?.suiteNamingPattern || ""}
                  onChange={(e) => updateNestedConfig("testRunSettings", "suiteNamingPattern", e.target.value)}
                  placeholder="NAT Suite - {date}"
                />
              </FieldWithTooltip>
            </div>
            
            <Separator />
            
            <div className="space-y-4">
              <h3 className="font-semibold">Sync Options</h3>
              <div className="grid gap-4">
                <div className="flex items-center justify-between">
                  <Label>Push test cases to qTest</Label>
                  <Switch
                    checked={config.syncOptions?.pushTestCases || false}
                    onCheckedChange={(v) => updateNestedConfig("syncOptions", "pushTestCases", v)}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <Label>Upload attachments/screenshots</Label>
                  <Switch
                    checked={config.syncOptions?.uploadAttachments || false}
                    onCheckedChange={(v) => updateNestedConfig("syncOptions", "uploadAttachments", v)}
                  />
                </div>
              </div>
            </div>
          </div>
        );

      case "qmetry":
        return (
          <div className="space-y-6">
            <FieldWithTooltip label="QMetry Instance Type" tooltip="Select your QMetry deployment type" required>
              <Select value={config.instanceType || "jira_cloud"} onValueChange={(v) => updateConfig("instanceType", v)}>
                <SelectTrigger data-testid="select-instance-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="jira_cloud">QMetry for JIRA (Cloud)</SelectItem>
                  <SelectItem value="jira_server">QMetry for JIRA (Server)</SelectItem>
                  <SelectItem value="standalone">QMetry Test Management (Standalone)</SelectItem>
                </SelectContent>
              </Select>
            </FieldWithTooltip>
            
            <FieldWithTooltip label="Base URL" tooltip="Your QMetry instance URL" required>
              <Input
                value={config.baseUrl || ""}
                onChange={(e) => updateConfig("baseUrl", e.target.value)}
                placeholder="https://qtm.qmetry.com"
                data-testid="input-base-url"
              />
            </FieldWithTooltip>
            
            <FieldWithTooltip label="API Key" tooltip="Generate from QMetry > Configuration > API Key" required>
              <PasswordInput
                value={config.apiKey || ""}
                onChange={(v) => updateConfig("apiKey", v)}
                placeholder="Enter your API key"
              />
            </FieldWithTooltip>
            
            <Separator />
            
            <div className="space-y-4">
              <h3 className="font-semibold">Test Cycle Configuration</h3>
              <FieldWithTooltip label="Folder Path" tooltip="Path for storing test cases">
                <Input
                  value={config.testCycleConfig?.folderPath || ""}
                  onChange={(e) => updateNestedConfig("testCycleConfig", "folderPath", e.target.value)}
                  placeholder="/NAT/Generated"
                />
              </FieldWithTooltip>
              <FieldWithTooltip label="Cycle Naming Convention" tooltip="Pattern for naming test cycles">
                <Input
                  value={config.testCycleConfig?.cycleNamingConvention || ""}
                  onChange={(e) => updateNestedConfig("testCycleConfig", "cycleNamingConvention", e.target.value)}
                  placeholder="NAT-{date}"
                />
              </FieldWithTooltip>
            </div>
            
            <Separator />
            
            <div className="space-y-4">
              <h3 className="font-semibold">Sync Options</h3>
              <div className="grid gap-4">
                <div className="flex items-center justify-between">
                  <Label>Sync test cases to QMetry</Label>
                  <Switch
                    checked={config.syncOptions?.syncTestCases || false}
                    onCheckedChange={(v) => updateNestedConfig("syncOptions", "syncTestCases", v)}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <Label>Push execution results</Label>
                  <Switch
                    checked={config.syncOptions?.pushExecutionResults || false}
                    onCheckedChange={(v) => updateNestedConfig("syncOptions", "pushExecutionResults", v)}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <Label>Attach evidence (screenshots, logs)</Label>
                  <Switch
                    checked={config.syncOptions?.attachEvidence || false}
                    onCheckedChange={(v) => updateNestedConfig("syncOptions", "attachEvidence", v)}
                  />
                </div>
              </div>
            </div>
          </div>
        );

      default:
        return <div>Configuration form not available for this platform.</div>;
    }
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden" data-testid="integration-config-page">
      <DashboardHeader />
      <main className="flex-1 overflow-y-auto">
        <div className="p-6">
            <div className="mb-6">
              <Link href="/integration-management">
                <Button variant="ghost" size="sm" className="mb-4" data-testid="button-back">
                  <ArrowLeft className="w-4 h-4 mr-2" />
                  Back to Configurations
                </Button>
              </Link>
              
              <div className="flex items-center gap-4">
                <div className={cn("w-12 h-12 rounded-lg flex items-center justify-center text-white", info.iconBg)}>
                  {info.icon}
                </div>
                <div>
                  <h1 className="text-2xl font-bold">{info.name} Configuration</h1>
                  <div className="flex items-center gap-2 mt-1">
                    {existingConfig?.status === "connected" ? (
                      <Badge variant="outline" className="bg-green-500/10 text-green-500 border-green-500/30">
                        <CheckCircle className="w-3 h-3 mr-1" />
                        Connected
                      </Badge>
                    ) : existingConfig?.status === "error" ? (
                      <Badge variant="outline" className="bg-orange-500/10 text-orange-500 border-orange-500/30">
                        <AlertCircle className="w-3 h-3 mr-1" />
                        Error
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="bg-muted text-muted-foreground">
                        <Circle className="w-3 h-3 mr-1" />
                        Not Configured
                      </Badge>
                    )}
                    {existingConfig?.lastSyncedAt && (
                      <span className="text-xs text-muted-foreground">
                        Last synced: {new Date(existingConfig.lastSyncedAt).toLocaleString()}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>

            <Card>
              <CardHeader>
                <CardTitle>Connection Settings</CardTitle>
                <CardDescription>
                  Configure your {info.name} integration credentials and sync options
                </CardDescription>
              </CardHeader>
              <CardContent>
                {isLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                  </div>
                ) : (
                  renderPlatformForm()
                )}
              </CardContent>
            </Card>

            {testResult && (
              <div className={cn(
                "mt-4 p-4 rounded-lg border",
                testResult.success 
                  ? "bg-green-500/10 border-green-500/30" 
                  : "bg-orange-500/10 border-orange-500/30"
              )}>
                <div className="flex items-center gap-2">
                  {testResult.success ? (
                    <CheckCircle className="w-5 h-5 text-green-500" />
                  ) : (
                    <AlertCircle className="w-5 h-5 text-orange-500" />
                  )}
                  <span className={testResult.success ? "text-green-500" : "text-orange-500"}>
                    {testResult.success ? testResult.message : testResult.error}
                  </span>
                </div>
              </div>
            )}

            <div className="flex items-center justify-between mt-6 p-4 bg-card border rounded-lg sticky bottom-4">
              <div className="flex gap-2">
                <Button
                  onClick={handleTestConnection}
                  variant="outline"
                  disabled={isTesting || saveMutation.isPending}
                  data-testid="button-test-connection"
                >
                  {isTesting ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <Zap className="w-4 h-4 mr-2" />
                  )}
                  Test Connection
                </Button>
                
                <Button
                  onClick={handleSave}
                  disabled={saveMutation.isPending}
                  data-testid="button-save"
                >
                  {saveMutation.isPending ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <Save className="w-4 h-4 mr-2" />
                  )}
                  Save Configuration
                </Button>
              </div>
              
              {existingConfig?.id && (
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="destructive" size="sm" data-testid="button-delete">
                      <Trash2 className="w-4 h-4 mr-2" />
                      Delete
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Delete Integration</AlertDialogTitle>
                      <AlertDialogDescription>
                        Are you sure you want to delete this {info.name} integration? This action cannot be undone.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={() => deleteMutation.mutate()}
                        className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                      >
                        Delete
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              )}
            </div>
        </div>
      </main>
    </div>
  );
}
