import { useQuery } from "@tanstack/react-query";
import { DashboardHeader } from "@/components/dashboard/header";
import { useBranding } from "@/contexts/BrandingContext";
import { useProject } from "@/contexts/ProjectContext";
import { useDevXAdoSettings, useDevXJiraSettings } from "@/hooks/useDevXConfig";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Link } from "wouter";
import { 
  CheckCircle, 
  AlertCircle, 
  Circle,
  ArrowRight,
  Cloud,
  Database,
  FileText,
  TestTube,
  Layers,
  BarChart3,
  Link2
} from "lucide-react";
interface IntegrationConfig {
  id: string;
  platform: string;
  name: string;
  status: "not_configured" | "connected" | "error";
  lastSyncedAt: string | null;
  lastError: string | null;
}

interface IntegrationCardData {
  platform: string;
  name: string;
  description: string;
  icon: React.ReactNode;
  iconBg: string;
}

const integrationCards: IntegrationCardData[] = [
  {
    platform: "azure_devops",
    name: "Azure DevOps",
    description: "Connect to Azure DevOps for user stories, work items, and sprint synchronization",
    icon: <Cloud className="w-8 h-8" />,
    iconBg: "bg-gradient-to-br from-blue-500 to-blue-600",
  },
  {
    platform: "jira",
    name: "JIRA",
    description: "Integrate with Atlassian JIRA for issue tracking and user story import",
    icon: <Database className="w-8 h-8" />,
    iconBg: "bg-gradient-to-br from-blue-600 to-indigo-600",
  },
  {
    platform: "zephyr",
    name: "Zephyr",
    description: "Connect to Zephyr Scale or Zephyr Squad for test case management",
    icon: <TestTube className="w-8 h-8" />,
    iconBg: "bg-gradient-to-br from-teal-500 to-cyan-600",
  },
  {
    platform: "testrail",
    name: "TestRail",
    description: "Integrate with TestRail for test case repository and execution tracking",
    icon: <FileText className="w-8 h-8" />,
    iconBg: "bg-gradient-to-br from-green-500 to-emerald-600",
  },
  {
    platform: "qtest",
    name: "qTest",
    description: "Connect to Tricentis qTest for enterprise test management",
    icon: <Layers className="w-8 h-8" />,
    iconBg: "bg-gradient-to-br from-purple-500 to-violet-600",
  },
  {
    platform: "qmetry",
    name: "QMetry",
    description: "Integrate with QMetry for test management and automation",
    icon: <BarChart3 className="w-8 h-8" />,
    iconBg: "bg-gradient-to-br from-orange-500 to-amber-600",
  },
];

function getStatusBadge(status: string) {
  switch (status) {
    case "connected":
      return (
        <Badge variant="outline" className="bg-green-500/10 text-green-500 border-green-500/30">
          <CheckCircle className="w-3 h-3 mr-1" />
          Connected
        </Badge>
      );
    case "error":
      return (
        <Badge variant="outline" className="bg-orange-500/10 text-orange-500 border-orange-500/30">
          <AlertCircle className="w-3 h-3 mr-1" />
          Error
        </Badge>
      );
    default:
      return (
        <Badge variant="outline" className="bg-muted text-muted-foreground border-muted-foreground/30">
          <Circle className="w-3 h-3 mr-1" />
          Not Configured
        </Badge>
      );
  }
}

export default function AgentConfigurations() {
  const { brand } = useBranding();
  const { isFromDevx, devxContext } = useProject();
  const { data: adoSettings } = useDevXAdoSettings();
  const { data: jiraSettings } = useDevXJiraSettings();

  const devxAdoConnected = isFromDevx && adoSettings && (adoSettings.organization || adoSettings.pat);
  const devxJiraConnected = isFromDevx && jiraSettings && (jiraSettings.baseUrl || jiraSettings.email);

  const { data: integrationsData, isLoading } = useQuery<{ success: boolean; integrations: IntegrationConfig[] }>({
    queryKey: ["/api/integrations"],
  });

  const integrations = integrationsData?.integrations || [];

  const getIntegrationStatus = (platform: string) => {
    if (platform === "azure_devops" && devxAdoConnected) return "connected";
    if (platform === "jira" && devxJiraConnected) return "connected";
    const config = integrations.find(i => i.platform === platform);
    return config?.status || "not_configured";
  };

  const getLastSynced = (platform: string) => {
    if (platform === "azure_devops" && devxAdoConnected) return "Inherited from Astra";
    if (platform === "jira" && devxJiraConnected) return "Inherited from Astra";
    const config = integrations.find(i => i.platform === platform);
    if (config?.lastSyncedAt) {
      return new Date(config.lastSyncedAt).toLocaleString();
    }
    return null;
  };

  return (
    <>
      <DashboardHeader />
      <main className="flex-1 overflow-y-auto p-6" data-testid="integration-management-page">
        <div>
            <div className="mb-8">
              <h1 className="text-3xl font-bold mb-2">Integration Management</h1>
              <p className="text-muted-foreground">
                Configure integrations with external test management platforms to push and sync test cases
              </p>
            </div>

            {isFromDevx && (devxAdoConnected || devxJiraConnected) && (
              <div className="mb-6 p-4 bg-blue-500/5 border border-blue-500/20 rounded-lg">
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-lg bg-blue-500/10 flex items-center justify-center flex-shrink-0">
                    <Link2 className="w-4 h-4 text-blue-500" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-foreground">Linked from Astra</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      The following integrations are inherited from your Astra project
                      {devxContext.organization ? ` (${devxContext.organization})` : ""}:
                    </p>
                    <div className="flex flex-wrap gap-2 mt-2">
                      {devxAdoConnected && (
                        <Badge variant="outline" className="bg-green-500/10 text-green-600 dark:text-green-400 border-green-500/30 gap-1">
                          <CheckCircle className="w-3 h-3" /> Azure DevOps
                        </Badge>
                      )}
                      {devxJiraConnected && (
                        <Badge variant="outline" className="bg-green-500/10 text-green-600 dark:text-green-400 border-green-500/30 gap-1">
                          <CheckCircle className="w-3 h-3" /> JIRA
                        </Badge>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {isLoading ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {[1, 2, 3, 4, 5, 6].map((i) => (
                  <Card key={i} className="animate-pulse">
                    <CardHeader>
                      <div className="h-12 w-12 bg-muted rounded-lg mb-4" />
                      <div className="h-6 w-32 bg-muted rounded" />
                      <div className="h-4 w-full bg-muted rounded mt-2" />
                    </CardHeader>
                  </Card>
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {integrationCards.map((card) => {
                  const status = getIntegrationStatus(card.platform);
                  const lastSynced = getLastSynced(card.platform);

                  return (
                    <Link key={card.platform} href={`/integration-management/${card.platform}`}>
                      <Card 
                        className={cn(
                          "cursor-pointer transition-all duration-300 hover:shadow-lg hover:shadow-primary/10 hover:border-primary/50 group",
                          status === "not_configured" && "opacity-80"
                        )}
                        data-testid={`integration-card-${card.platform}`}
                      >
                        <CardHeader className="pb-3">
                          <div className="flex items-start justify-between gap-3">
                            <div className={cn("w-12 h-12 rounded-lg flex items-center justify-center text-white", card.iconBg)}>
                              {card.icon}
                            </div>
                            {getStatusBadge(status)}
                          </div>
                          <CardTitle className="mt-4 group-hover:text-primary transition-colors">
                            {card.name}
                          </CardTitle>
                          <CardDescription className="text-sm">
                            {card.description}
                          </CardDescription>
                        </CardHeader>
                        <CardContent className="pt-0">
                          <div className="flex items-center justify-between">
                            {lastSynced ? (
                              <span className="text-xs text-muted-foreground">
                                Last synced: {lastSynced}
                              </span>
                            ) : (
                              <span className="text-xs text-muted-foreground">
                                Click to configure
                              </span>
                            )}
                            <ArrowRight className="w-4 h-4 text-muted-foreground group-hover:text-primary group-hover:translate-x-1 transition-all" />
                          </div>
                        </CardContent>
                      </Card>
                    </Link>
                  );
                })}
              </div>
            )}

            <div className="mt-12 p-6 bg-card border rounded-lg">
              <div className="flex items-start gap-4">
                <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                  <Cloud className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <h3 className="font-semibold mb-1">About Test Management Integrations</h3>
                  <p className="text-sm text-muted-foreground">
                    Connect {brand.platformShortName} to your preferred test management platform to automatically push generated test cases, 
                    sync execution results, and maintain traceability between requirements and tests. 
                    All credentials are securely encrypted and stored.
                  </p>
                </div>
              </div>
            </div>
        </div>
      </main>
    </>
  );
}
