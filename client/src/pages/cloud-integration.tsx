import { Button } from "@/components/ui/button";
import { CloudProviderCard } from "@/components/cloud-provider-card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowLeft, Cloud } from "lucide-react";
import { useState } from "react";
import { Link } from "wouter";
import { PageHeader } from "@/components/ui/page-header";

export default function CloudIntegration() {
  const [selectedProvider, setSelectedProvider] = useState<string | null>(null);

  return (
    <div className="flex-1 space-y-6 p-6">
      <div className="flex items-center gap-4">
        <Link href="/golden-repos">
          <Button variant="ghost" size="icon" data-testid="button-back">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <PageHeader
          icon={Cloud}
          title="Cloud DevOps Integration"
          subtitle="Select a cloud provider and configure your repository"
          color="cyan"
        />
      </div>

      <div>
        <h2 className="text-lg font-semibold mb-4">Select Cloud Provider</h2>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <CloudProviderCard
            provider="github"
            isSelected={selectedProvider === "github"}
            onSelect={() => setSelectedProvider("github")}
          />
          <CloudProviderCard
            provider="gitlab"
            isSelected={selectedProvider === "gitlab"}
            onSelect={() => setSelectedProvider("gitlab")}
          />
          <CloudProviderCard
            provider="azure"
            isSelected={selectedProvider === "azure"}
            onSelect={() => setSelectedProvider("azure")}
          />
          <CloudProviderCard
            provider="aws"
            isSelected={selectedProvider === "aws"}
            onSelect={() => setSelectedProvider("aws")}
          />
        </div>
      </div>

      {selectedProvider && (
        <Card className="border-l-[3px] border-l-cyan-500">
          <CardHeader>
            <CardTitle>Repository Configuration</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="repo-name">Repository Name</Label>
              <Input
                id="repo-name"
                placeholder="my-project-repo"
                data-testid="input-repo-name"
              />
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="repo-description">Description (Optional)</Label>
              <Input
                id="repo-description"
                placeholder="Project repository description"
                data-testid="input-repo-description"
              />
            </div>

            {selectedProvider === "github" && (
              <>
                <div className="space-y-2">
                  <Label htmlFor="github-token">Personal Access Token</Label>
                  <Input
                    id="github-token"
                    type="password"
                    placeholder="ghp_xxxxxxxxxxxx"
                    data-testid="input-github-token"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="github-org">Organization (Optional)</Label>
                  <Input
                    id="github-org"
                    placeholder="my-organization"
                    data-testid="input-github-org"
                  />
                </div>
              </>
            )}

            {selectedProvider === "gitlab" && (
              <>
                <div className="space-y-2">
                  <Label htmlFor="gitlab-token">Private Token</Label>
                  <Input
                    id="gitlab-token"
                    type="password"
                    placeholder="glpat-xxxxxxxxxxxx"
                    data-testid="input-gitlab-token"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="gitlab-group">Group (Optional)</Label>
                  <Input
                    id="gitlab-group"
                    placeholder="my-group"
                    data-testid="input-gitlab-group"
                  />
                </div>
              </>
            )}

            {selectedProvider === "azure" && (
              <>
                <div className="space-y-2">
                  <Label htmlFor="azure-pat">Personal Access Token</Label>
                  <Input
                    id="azure-pat"
                    type="password"
                    placeholder="xxxxxxxxxxxx"
                    data-testid="input-azure-pat"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="azure-org">Organization URL</Label>
                  <Input
                    id="azure-org"
                    placeholder="https://dev.azure.com/myorg"
                    data-testid="input-azure-org"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="azure-project">Project Name</Label>
                  <Input
                    id="azure-project"
                    placeholder="MyProject"
                    data-testid="input-azure-project"
                  />
                </div>
              </>
            )}

            {selectedProvider === "aws" && (
              <>
                <div className="space-y-2">
                  <Label htmlFor="aws-access-key">Access Key ID</Label>
                  <Input
                    id="aws-access-key"
                    type="password"
                    placeholder="AKIA..."
                    data-testid="input-aws-access-key"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="aws-secret-key">Secret Access Key</Label>
                  <Input
                    id="aws-secret-key"
                    type="password"
                    placeholder="..."
                    data-testid="input-aws-secret-key"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="aws-region">Region</Label>
                  <Input
                    id="aws-region"
                    placeholder="us-east-1"
                    data-testid="input-aws-region"
                  />
                </div>
              </>
            )}

            <div className="flex gap-3 pt-4">
              <Button 
                className="flex-1"
                onClick={() => console.log(`Creating repository on ${selectedProvider}`)}
                data-testid="button-create-repo"
              >
                Create Repository
              </Button>
              <Button 
                variant="outline"
                onClick={() => setSelectedProvider(null)}
                data-testid="button-cancel"
              >
                Cancel
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
