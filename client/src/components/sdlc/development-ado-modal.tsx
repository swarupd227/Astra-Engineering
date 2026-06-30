import { useState, useEffect } from "react";
import { getIntegrationLabels } from "@/lib/integration-config";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  FolderGit2,
  GitBranch,
  GitCommit,
  ExternalLink,
  RefreshCw,
  CheckCircle2,
  Clock,
  User,
  Calendar,
  Hash,
  Link2,
  AlertTriangle,
  Loader2,
  Code,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { getApiUrl } from "@/lib/api-config";

interface ADOProject {
  id: string;
  name: string;
  organization: string;
  organizationUrl: string;
  integrationType?: "ado" | "jira" | string;
}

interface DevelopmentAdoModalProps {
  projectId: string;
  adoProject?: ADOProject;
  open: boolean;
  onClose: () => void;
}

interface Repository {
  id: string;
  name: string;
  defaultBranch?: string;
  remoteUrl?: string;
  webUrl?: string;
  size?: number;
}

interface Branch {
  name: string;
  objectId: string;
  creator: {
    displayName: string;
    date: string;
  };
}

interface Commit {
  commitId: string;
  comment: string;
  author?: { name?: string; email?: string; date?: string } | string;
  date?: string;
}

export function DevelopmentAdoModal({ projectId, adoProject, open, onClose }: DevelopmentAdoModalProps) {
  const { toast } = useToast();
  
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [repositories, setRepositories] = useState<Repository[]>([]);
  const [selectedRepo, setSelectedRepo] = useState<Repository | null>(null);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [commits, setCommits] = useState<Commit[]>([]);
  const [hasAdoConfig, setHasAdoConfig] = useState(false);
  const [repoProvider, setRepoProvider] = useState<string>("");
  const [repoConfigMissing, setRepoConfigMissing] = useState(false);
  const [step, setStep] = useState<'select-repo' | 'view-details'>('select-repo');

  useEffect(() => {
    if (open) {
      fetchRepositories();
    }
  }, [open, projectId, adoProject]);

  const fetchRepositories = async () => {
    setLoading(true);
    try {
      const integrationResp = await fetch(
        getApiUrl(`/api/projects/${projectId}/integration-effective`),
        { credentials: "include" },
      );
      const integrationJson = integrationResp.ok
        ? await integrationResp.json()
        : { integrations: [] };
      const repoIntegration = (integrationJson?.integrations || []).find(
        (item: any) => item.categoryKey === "repo",
      );
      const providerKey = String(repoIntegration?.providerKey || "").toLowerCase();
      setRepoProvider(providerKey);
      setRepoConfigMissing(!providerKey);

      if (adoProject?.integrationType === "jira" && !providerKey) {
        setHasAdoConfig(false);
        toast({
          title: "Repository tool not configured",
          description:
            "Configure the repo tool in Edit Project > Tool Configuration to use Development repository features.",
          variant: "destructive",
        });
        setLoading(false);
        return;
      }

      const isNonAdoRepoProvider = providerKey && providerKey !== "azure_repos";

      // Build query params for ADO project info
      const params = new URLSearchParams();
      if (adoProject?.organization) {
        params.append('organization', adoProject.organization);
      }
      if (adoProject?.name) {
        params.append('projectName', adoProject.name);
      }
      
      // Check ADO configuration
      const configUrl = `/api/sdlc/projects/${projectId}/ado-config${params.toString() ? `?${params.toString()}` : ''}`;
      const configRes = await fetch(configUrl);
      
      if (!configRes.ok) {
        throw new Error(`Configuration check failed: ${configRes.status} ${configRes.statusText}`);
      }

      const contentType = configRes.headers.get("content-type");
      if (!contentType || !contentType.includes("application/json")) {
        throw new Error("Server returned invalid response. Please check if the server is running correctly.");
      }

      const configData = await configRes.json();
      setHasAdoConfig(configData.hasConfig);

      if (!configData.hasConfig) {
        toast({
          title: `${getIntegrationLabels(adoProject?.integrationType).longName} Not Configured`,
          description: adoProject?.integrationType === 'jira' 
            ? "Please configure Jira settings (JIRA_HOST, JIRA_EMAIL, JIRA_API_TOKEN) to use development features." 
            : `Please configure ${getIntegrationLabels(adoProject?.integrationType).longName} settings to use development features.`,
          variant: "destructive",
        });
        setLoading(false);
        return;
      }

      const reposRes = isNonAdoRepoProvider
        ? await fetch(getApiUrl(`/api/sdlc/projects/${projectId}/repositories`))
        : await fetch(getApiUrl(`/api/sdlc/projects/${projectId}/ado/repositories${
            (() => {
              const reposParams = new URLSearchParams();
              if (adoProject?.organization) reposParams.append("organization", adoProject.organization);
              if (adoProject?.name) reposParams.append("projectName", adoProject.name);
              return reposParams.toString() ? `?${reposParams.toString()}` : "";
            })()
          }`));
      
      if (!reposRes.ok) {
        const errorData = await reposRes.json().catch(() => ({ error: reposRes.statusText }));
        throw new Error(errorData.error || "Failed to fetch repositories");
      }

      const reposData = await reposRes.json();
      setRepositories(reposData);

      if (reposData.length > 0) {
        // Auto-select first repository
        await selectRepository(reposData[0]);
      }
    } catch (error: any) {
      console.error("Error fetching repositories:", error);
      toast({
        title: "Error",
        description: error.message || `Failed to fetch repositories from ${getIntegrationLabels(adoProject?.integrationType).longName}`,
        variant: "destructive",
      });
      setHasAdoConfig(false);
    } finally {
      setLoading(false);
    }
  };

  const selectRepository = async (repo: Repository) => {
    setSelectedRepo(repo);
    setStep('view-details');
    await fetchBranches(repo.id);
    await fetchCommits(repo.id);
  };

  const fetchBranches = async (repoId: string) => {
    try {
      const isNonAdoRepoProvider = repoProvider && repoProvider !== "azure_repos";
      const response = isNonAdoRepoProvider
        ? await fetch(getApiUrl(`/api/sdlc/projects/${projectId}/repositories/${encodeURIComponent(repoId)}/branches`))
        : await fetch(getApiUrl(`/api/sdlc/projects/${projectId}/ado/repositories/${repoId}/branches${
            (() => {
              const branchParams = new URLSearchParams();
              if (adoProject?.organization) branchParams.append("organization", adoProject.organization);
              if (adoProject?.name) branchParams.append("projectName", adoProject.name);
              return branchParams.toString() ? `?${branchParams.toString()}` : "";
            })()
          }`));
      if (response.ok) {
        const data = await response.json();
        setBranches(data);
      }
    } catch (error) {
      console.error("Error fetching branches:", error);
      toast({
        title: "Error",
        description: "Failed to fetch branches",
        variant: "destructive",
      });
    }
  };

  const fetchCommits = async (repoId: string) => {
    try {
      const isNonAdoRepoProvider = repoProvider && repoProvider !== "azure_repos";
      const response = isNonAdoRepoProvider
        ? await fetch(getApiUrl(`/api/sdlc/projects/${projectId}/repositories/${encodeURIComponent(repoId)}/commits`))
        : await fetch(getApiUrl(`/api/sdlc/projects/${projectId}/ado/repositories/${repoId}/commits${
            (() => {
              const commitParams = new URLSearchParams();
              if (adoProject?.organization) commitParams.append("organization", adoProject.organization);
              if (adoProject?.name) commitParams.append("projectName", adoProject.name);
              return commitParams.toString() ? `?${commitParams.toString()}` : "";
            })()
          }`));
      if (response.ok) {
        const data = await response.json();
        setCommits(data);
      }
    } catch (error) {
      console.error("Error fetching commits:", error);
      toast({
        title: "Error",
        description: "Failed to fetch commits",
        variant: "destructive",
      });
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    if (selectedRepo) {
      await fetchBranches(selectedRepo.id);
      await fetchCommits(selectedRepo.id);
    } else {
      await fetchRepositories();
    }
    setRefreshing(false);
  };

  const handleChangeRepository = () => {
    setSelectedRepo(null);
    setBranches([]);
    setCommits([]);
    setStep('select-repo');
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
  };

  if (loading && !hasAdoConfig) {
    return (
      <Dialog open={open} onOpenChange={onClose}>
        <DialogContent className="max-w-5xl max-h-[90vh]">
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="p-3 rounded-2xl bg-gradient-to-br from-emerald-500 to-emerald-600">
                <Code className="h-8 w-8 text-white" />
              </div>
              <div>
                <DialogTitle className="text-2xl">Development Phase</DialogTitle>
                <DialogDescription>
                  {getIntegrationLabels(adoProject?.integrationType).longName} Repository Integration
                </DialogDescription>
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={handleRefresh}
              disabled={refreshing}
            >
              <RefreshCw className={`h-4 w-4 mr-2 ${refreshing ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
          </div>
        </DialogHeader>

        {!hasAdoConfig ? (
          <Card className="mt-6">
            <CardContent className="pt-6">
              <div className="text-center space-y-4">
                <AlertTriangle className="h-12 w-12 text-yellow-500 mx-auto" />
                <h3 className="text-lg font-semibold">
                  {repoConfigMissing
                    ? "Repository tool not configured"
                    : repoProvider && repoProvider !== "azure_repos"
                      ? "Unsupported repository provider"
                      : `${getIntegrationLabels(adoProject?.integrationType).longName} Not Configured`}
                </h3>
                <p className="text-muted-foreground">
                  {repoConfigMissing
                    ? "Edit the project and configure the repo tool in Tool Configuration."
                    : repoProvider && repoProvider !== "azure_repos"
                      ? `This modal supports Azure Repos only. Current provider: ${repoProvider}.`
                      : "Please configure the following environment variables to use development features:"}
                </p>
                {!repoConfigMissing && (!repoProvider || repoProvider === "azure_repos") && (
                  <div className="bg-muted p-4 rounded-lg text-left font-mono text-sm">
                    {adoProject?.integrationType === 'jira' ? (
                      <>
                        <div>JIRA_HOST=your-jira-host</div>
                        <div>JIRA_EMAIL=your-jira-email</div>
                        <div>JIRA_API_TOKEN=your-jira-api-token</div>
                      </>
                    ) : (
                      <>
                        <div>ADO_ORG=your-organization-name</div>
                        <div>ADO_PROJECT=your-project-name</div>
                        <div>ADO_PAT=your-personal-access-token</div>
                      </>
                    )}
                  </div>
                )}
                {(repoConfigMissing || (repoProvider && repoProvider !== "azure_repos")) && (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      window.location.href = "/projects";
                    }}
                  >
                    Edit Project Tool Configuration
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        ) : step === 'select-repo' ? (
          // Step 1: Select Repository
          <div className="flex-1 overflow-hidden flex flex-col">
            <Card className="flex-1 flex flex-col">
              <CardHeader>
                <CardTitle>Select Repository</CardTitle>
                <CardDescription>
                  Choose a repository from your {getIntegrationLabels(adoProject?.integrationType).longName} project
                </CardDescription>
              </CardHeader>
              <CardContent className="flex-1 overflow-hidden">
                <ScrollArea className="h-[500px] pr-4">
                  <div className="space-y-4">
                    {repositories.length === 0 ? (
                      <p className="text-center text-muted-foreground py-8">
                        No repositories found in your {getIntegrationLabels(adoProject?.integrationType).longName} project
                      </p>
                    ) : (
                      repositories.map((repo) => (
                        <Card
                          key={repo.id}
                          className="hover-elevate cursor-pointer active-elevate-2"
                          onClick={() => selectRepository(repo)}
                        >
                          <CardContent className="p-4">
                            <div className="flex items-start justify-between">
                              <div className="flex-1">
                                <div className="flex items-center gap-2 mb-2">
                                  <FolderGit2 className="h-5 w-5 text-emerald-600" />
                                  <h3 className="font-semibold text-lg">{repo.name}</h3>
                                </div>
                                <div className="space-y-1 text-sm text-muted-foreground">
                                  <div className="flex items-center gap-2">
                                    <GitBranch className="h-4 w-4" />
                                    Default branch: {repo.defaultBranch || 'main'}
                                  </div>
                                  {repo.size > 0 && (
                                    <div className="flex items-center gap-2">
                                      <Hash className="h-4 w-4" />
                                      Size: {formatFileSize(repo.size)}
                                    </div>
                                  )}
                                </div>
                              </div>
                              <Button
                                variant="ghost"
                                size="sm"
                                asChild
                                onClick={(e) => e.stopPropagation()}
                              >
                                <a
                                  href={repo.webUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                >
                                  <ExternalLink className="h-4 w-4" />
                                </a>
                              </Button>
                            </div>
                          </CardContent>
                        </Card>
                      ))
                    )}
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>
          </div>
        ) : (
          // Step 2: View Repository Details
          <div className="flex-1 overflow-hidden flex flex-col space-y-4">
            {/* Repository Header */}
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <FolderGit2 className="h-6 w-6 text-emerald-600" />
                    <div>
                      <h3 className="font-semibold text-lg">{selectedRepo?.name}</h3>
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Link2 className="h-3 w-3" />
                        <a
                          href={selectedRepo?.webUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="hover:underline flex items-center gap-1"
                        >
                          View in {getIntegrationLabels(adoProject?.integrationType).longName}
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      </div>
                    </div>
                  </div>
                  <Button variant="outline" size="sm" onClick={handleChangeRepository}>
                    Change Repository
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* Summary Stats */}
            <div className="grid grid-cols-2 gap-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                    <GitBranch className="h-4 w-4" />
                    Active Branches
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-3xl font-bold text-emerald-600">
                    {branches.length}
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                    <GitCommit className="h-4 w-4" />
                    Recent Commits
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-3xl font-bold text-blue-600">
                    {commits.length}
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Content Tabs */}
            <Card className="flex flex-col flex-1 overflow-hidden">
              <CardHeader>
                <CardTitle className="text-base">Repository Details</CardTitle>
              </CardHeader>
              <CardContent className="flex-1 overflow-hidden">
                <Tabs defaultValue="branches" className="h-full flex flex-col">
                  <TabsList className="grid w-full grid-cols-2">
                    <TabsTrigger value="branches" className="flex items-center gap-2">
                      <GitBranch className="h-4 w-4" />
                      Branches ({branches.length})
                    </TabsTrigger>
                    <TabsTrigger value="commits" className="flex items-center gap-2">
                      <GitCommit className="h-4 w-4" />
                      Commits ({commits.length})
                    </TabsTrigger>
                  </TabsList>

                  <TabsContent value="branches" className="flex-1 overflow-hidden mt-4">
                    <ScrollArea className="h-[400px]">
                      <div className="space-y-2">
                        {branches.length === 0 ? (
                          <p className="text-center text-muted-foreground py-4 text-sm">
                            No branches found
                          </p>
                        ) : (
                          branches.map((branch) => (
                            <div
                              key={branch.name}
                              className="p-3 bg-muted rounded-lg hover:bg-muted/80 transition-colors"
                            >
                              <div className="flex items-center gap-2">
                                <GitBranch className="h-4 w-4 text-emerald-600 flex-shrink-0" />
                                <span className="font-medium truncate">{branch.name}</span>
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    </ScrollArea>
                  </TabsContent>

                  <TabsContent value="commits" className="flex-1 overflow-hidden mt-4">
                    <ScrollArea className="h-[400px]">
                      <div className="space-y-2">
                        {commits.length === 0 ? (
                          <p className="text-center text-muted-foreground py-4 text-sm">
                            No commits found
                          </p>
                        ) : (
                          commits.map((commit) => (
                            <div
                              key={commit.commitId}
                              className="p-3 bg-muted rounded-lg hover:bg-muted/80 transition-colors"
                            >
                              <div className="space-y-2">
                                <div className="flex items-start justify-between gap-2">
                                  <div className="flex-1 min-w-0">
                                    <p className="text-sm font-medium line-clamp-2">
                                      {commit.comment}
                                    </p>
                                    <div className="flex items-center gap-2 mt-2 text-xs text-muted-foreground">
                                      <User className="h-3 w-3" />
                                      <span>{typeof commit.author === "string" ? commit.author : (commit.author?.name || "Unknown")}</span>
                                      <span>•</span>
                                      <span>{formatDate((typeof commit.author === "string" ? commit.date : commit.author?.date) || commit.date || new Date().toISOString())}</span>
                                    </div>
                                  </div>
                                  <code className="text-xs bg-background px-2 py-1 rounded flex-shrink-0">
                                    {commit.commitId.substring(0, 7)}
                                  </code>
                                </div>
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    </ScrollArea>
                  </TabsContent>
                </Tabs>
              </CardContent>
            </Card>

            {/* Preview Summary */}
            <Card className="bg-emerald-50 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-800">
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <CheckCircle2 className="h-5 w-5 text-emerald-600" />
                  Development Phase Summary
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-3 gap-4 text-sm">
                  <div>
                    <div className="text-muted-foreground mb-1">Repository</div>
                    <div className="font-semibold">{selectedRepo?.name}</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground mb-1">Total Branches</div>
                    <div className="font-semibold text-emerald-600">{branches.length}</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground mb-1">Recent Commits</div>
                    <div className="font-semibold text-blue-600">{commits.length}</div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

