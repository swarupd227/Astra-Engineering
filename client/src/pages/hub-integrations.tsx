import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Plug, CheckCircle2, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { useJiraOnlyWorkItems } from "@/hooks/use-hosting-config";

interface Integration {
  id: string;
  name: string;
  description: string;
  status: "active" | "inactive" | "configured";
  category: string;
  icon?: string;
}

const integrations: Integration[] = [
  {
    id: "openai",
    name: "OpenAI",
    description: "AI-powered features for prompt generation and content creation",
    status: "configured",
    category: "AI & ML"
  },
  {
    id: "azure-devops",
    name: "Azure DevOps",
    description: "Connect to Azure DevOps for work item management and CI/CD",
    status: "configured",
    category: "DevOps"
  },
  {
    id: "github",
    name: "GitHub",
    description: "Source code management and version control integration",
    status: "configured",
    category: "Version Control"
  },
  {
    id: "figma",
    name: "Figma",
    description: "Design collaboration and prototyping integration",
    status: "configured",
    category: "Design"
  },
  {
    id: "database",
    name: "PostgreSQL Database",
    description: "Managed database for persistent storage",
    status: "active",
    category: "Database"
  },
  {
    id: "replit-auth",
    name: "Replit Authentication",
    description: "User authentication and authorization",
    status: "configured",
    category: "Auth"
  }
];

export default function HubIntegrations() {
  const jiraOnly = useJiraOnlyWorkItems();
  const visibleIntegrations = jiraOnly
    ? integrations.filter(i => i.id !== "azure-devops")
    : integrations;
  const categories = Array.from(new Set(visibleIntegrations.map(i => i.category)));

  return (
    <div className="flex-1 space-y-6 p-6">
      <PageHeader
        icon={Plug}
        title="Integrations"
        subtitle="Manage your connected services and integrations"
        color="cyan"
        data-testid="text-page-title"
      >
        <Badge variant="secondary" className="text-sm">
          {visibleIntegrations.filter(i => i.status !== "inactive").length} Active
        </Badge>
      </PageHeader>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {categories.map(category => {
          const categoryIntegrations = visibleIntegrations.filter(i => i.category === category);
          
          return (
            <div key={category} className="space-y-3">
              <div className="flex items-center gap-2">
                <h2 className="text-xl font-semibold">{category}</h2>
                <Badge variant="outline" className="text-xs">
                  {categoryIntegrations.length}
                </Badge>
              </div>
              
              <div className="space-y-3">
                {categoryIntegrations.map(integration => (
                  <Card
                    key={integration.id}
                    className="hover-elevate border-l-[3px] border-l-cyan-500"
                    data-testid={`card-integration-${integration.id}`}
                  >
                    <CardHeader>
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-2">
                            <Plug className="h-5 w-5 text-primary" />
                            <CardTitle className="text-lg">{integration.name}</CardTitle>
                          </div>
                          <CardDescription className="line-clamp-2">
                            {integration.description}
                          </CardDescription>
                        </div>
                        {integration.status !== "inactive" && (
                          <CheckCircle2 className="h-5 w-5 flex-shrink-0 text-green-500" />
                        )}
                      </div>
                    </CardHeader>
                    <CardContent>
                      <div className="flex items-center justify-between">
                        <Badge
                          variant={
                            integration.status === "active"
                              ? "default"
                              : integration.status === "configured"
                              ? "secondary"
                              : "outline"
                          }
                          className="text-xs"
                        >
                          {integration.status === "active"
                            ? "Active"
                            : integration.status === "configured"
                            ? "Configured"
                            : "Inactive"}
                        </Badge>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 px-2"
                          data-testid={`button-view-${integration.id}`}
                        >
                          View <ExternalLink className="h-3 w-3 ml-1" />
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
