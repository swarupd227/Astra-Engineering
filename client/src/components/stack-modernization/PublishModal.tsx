import { useState, useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAdoAllowed, useJiraOnlyWorkItems } from "@/hooks/use-hosting-config";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, GitBranch, CheckCircle2, AlertTriangle, FolderGit2, Building2 } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  GLOBAL_ALL_ORGANIZATIONS_ID,
  useSelectedOrganization,
} from "@/contexts/selected-organization-context";

interface PublishModalProps {
  open: boolean;
  onClose: () => void;
  analysisId: string;
  adoOrg?: string;
  adoOrgUrl?: string;
  adoProjectName?: string;
  adoProjectId?: string;
  uploadedRepoName?: string;
}

interface ADOProjectInfo {
  id: string;
  name: string;
  description: string;
  organization: string;
  organizationUrl: string;
}

export function PublishModal({
  open,
  onClose,
  analysisId,
  adoOrg: initialOrg = "",
  adoOrgUrl: initialOrgUrl = "",
  adoProjectName: initialProjectName = "",
  adoProjectId: initialProjectId = "",
  uploadedRepoName = "",
}: PublishModalProps) {
  const { toast } = useToast();
  const adoAllowed = useAdoAllowed();
  const isJira = useJiraOnlyWorkItems();
  const { selectedOrganization: globalSelectedOrganization } =
    useSelectedOrganization();

  const [selectedOrg, setSelectedOrg] = useState(initialOrg);
  const [selectedOrgUrl, setSelectedOrgUrl] = useState(initialOrgUrl);
  const [selectedProjectName, setSelectedProjectName] = useState(initialProjectName);
  const [selectedProjectId, setSelectedProjectId] = useState(initialProjectId);

  const [selectedRepoId, setSelectedRepoId] = useState("");
  const [selectedRepoName, setSelectedRepoName] = useState("");
  const [branchName, setBranchName] = useState(`devx-upgrade-${Date.now()}`);
  const [isPublishing, setIsPublishing] = useState(false);
  const [publishResult, setPublishResult] = useState<any>(null);

  // GitHub-specific state
  const [githubOwner, setGithubOwner] = useState("");
  const [githubRepo, setGithubRepo] = useState("");
  const [githubToken, setGithubToken] = useState("");

  const hasPreconfiguredOrg = !!(initialOrg && initialProjectName);
  const isGlobalSpecificOrganizationSelected =
    !!globalSelectedOrganization &&
    globalSelectedOrganization.id !== GLOBAL_ALL_ORGANIZATIONS_ID;

  const targetPath = useMemo(() => {
    const repoName = uploadedRepoName || "UploadedRepo";
    return `Modernization/Tech-Upgrade/${repoName}`;
  }, [uploadedRepoName]);

  // Fetch hosting config for pre-filling GitHub owner
  const { data: hostingConfig } = useQuery({
    queryKey: ["/api/platform/hosting"],
    queryFn: async () => {
      const r = await apiRequest("GET", "/api/platform/hosting");
      return r.json();
    },
    enabled: open && isJira,
    staleTime: Infinity,
  });

  useEffect(() => {
    if (hostingConfig && isJira && hostingConfig.githubOwner) {
      setGithubOwner(hostingConfig.githubOwner);
    }
  }, [hostingConfig, isJira]);

  // Fetch available ADO projects (only if in Azure mode and org/project not pre-configured)
  const { data: projectsResponse, isLoading: projectsLoading } = useQuery<{ projects: ADOProjectInfo[] }>({
    queryKey: ["/api/ado-projects"],
    queryFn: async () => {
      const response = await apiRequest("GET", "/api/ado-projects");
      return response.json();
    },
    enabled: open && !hasPreconfiguredOrg && adoAllowed && !isJira,
    staleTime: 10 * 60 * 1000,
  });

  const allProjects: ADOProjectInfo[] = useMemo(() => {
    if (!projectsResponse?.projects) return [];
    return projectsResponse.projects;
  }, [projectsResponse]);

  const organizations = useMemo(() => {
    const orgs = new Map<string, { name: string; url: string }>();
    for (const p of allProjects) {
      if (p.organization && !orgs.has(p.organization.toLowerCase())) {
        orgs.set(p.organization.toLowerCase(), { name: p.organization, url: p.organizationUrl || "" });
      }
    }
    return Array.from(orgs.values());
  }, [allProjects]);

  const orgProjects = useMemo(() => {
    if (!selectedOrg) return [];
    return allProjects.filter(p => p.organization?.toLowerCase() === selectedOrg.toLowerCase());
  }, [allProjects, selectedOrg]);

  // Fetch repositories for the selected ADO project (Azure mode only)
  const { data: reposData, isLoading: reposLoading, error: reposError } = useQuery<{ value: Array<{ id: string; name: string }> }>({
    queryKey: ["ado-repos", selectedOrg, selectedProjectName],
    queryFn: async () => {
      const response = await apiRequest("GET", `/api/ado-repositories?organization=${encodeURIComponent(selectedOrg)}&project=${encodeURIComponent(selectedProjectName)}`);
      return response.json();
    },
    enabled: open && !!selectedOrg && !!selectedProjectName && !isJira,
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });

  const repositories = useMemo(() => reposData?.value ?? [], [reposData]);

  useEffect(() => {
    if (open) {
      setPublishResult(null);
      setBranchName(`devx-upgrade-${Date.now()}`);
      setSelectedRepoId("");
      setSelectedRepoName("");
      setSelectedOrg(initialOrg);
      setSelectedOrgUrl(initialOrgUrl);
      setSelectedProjectName(initialProjectName);
      setSelectedProjectId(initialProjectId);
    }
  }, [open, initialOrg, initialOrgUrl, initialProjectName, initialProjectId]);

  useEffect(() => {
    if (!open || !isGlobalSpecificOrganizationSelected || hasPreconfiguredOrg) {
      return;
    }

    setSelectedOrg(globalSelectedOrganization.name);
    setSelectedProjectName("");
    setSelectedProjectId("");
    setSelectedRepoId("");
    setSelectedRepoName("");
  }, [
    open,
    globalSelectedOrganization,
    isGlobalSpecificOrganizationSelected,
    hasPreconfiguredOrg,
  ]);

  const handleOrgChange = (orgName: string) => {
    const org = organizations.find(o => o.name === orgName);
    setSelectedOrg(orgName);
    setSelectedOrgUrl(org?.url || "");
    setSelectedProjectName("");
    setSelectedProjectId("");
    setSelectedRepoId("");
    setSelectedRepoName("");
  };

  const handleProjectChange = (projectName: string) => {
    const proj = orgProjects.find(p => p.name === projectName);
    setSelectedProjectName(projectName);
    setSelectedProjectId(proj?.id || "");
    setSelectedRepoId("");
    setSelectedRepoName("");
  };

  const handlePublish = async () => {
    if (isJira) {
      if (!githubOwner || !githubRepo) {
        toast({ title: "Missing Info", description: "Please enter GitHub owner and repository name.", variant: "destructive" });
        return;
      }
    } else {
      if (!selectedRepoId) {
        toast({ title: "Missing Repository", description: "Please select a repository to push to.", variant: "destructive" });
        return;
      }
    }

    setIsPublishing(true);
    setPublishResult(null);

    try {
      const publishOptions = isJira
        ? {
            provider: "github",
            orgName: githubOwner,
            repoName: githubRepo.replace(/\s+/g, "-"),
            branchName,
            targetPath,
            accessToken: githubToken || undefined,
          }
        : {
            provider: "azure-devops",
            orgName: selectedOrg,
            orgUrl: selectedOrgUrl,
            projectName: selectedProjectName,
            repoName: selectedRepoName,
            repositoryId: selectedRepoId,
            branchName,
            targetPath,
          };

      const response = await apiRequest("POST", "/api/stack-modernization/publish", {
        analysisId,
        options: publishOptions,
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || error.message || "Publishing failed");
      }

      const result = await response.json();
      setPublishResult(result);

      toast({
        title: "Published Successfully",
        description: `Code pushed to ${result.branchName}`,
      });
    } catch (error) {
      console.error("[PublishModal] Error:", error);
      toast({
        title: "Publishing Failed",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive",
      });
      setPublishResult({ success: false, errors: [error instanceof Error ? error.message : "Unknown error"] });
    } finally {
      setIsPublishing(false);
    }
  };

  const handleClose = () => {
    setPublishResult(null);
    onClose();
  };

  const canPublish = isJira
    ? !!(githubOwner && githubRepo)
    : !!(selectedOrg && selectedProjectName && selectedRepoId);

  const providerLabel = isJira ? "GitHub" : "Azure DevOps";

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <GitBranch className="h-5 w-5" />
            Push to {providerLabel} Repository
          </DialogTitle>
          <DialogDescription>
            Push upgraded code and generated tests to your {providerLabel} repository
          </DialogDescription>
        </DialogHeader>

        {!publishResult && (
          <div className="space-y-4 py-4">
            {isJira ? (
              /* ── GitHub Mode ── */
              <>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>
                      <Building2 className="h-3.5 w-3.5 inline mr-1" />
                      GitHub Owner / Org <span className="text-destructive">*</span>
                    </Label>
                    <Input
                      value={githubOwner}
                      onChange={(e) => setGithubOwner(e.target.value.trim())}
                      placeholder="e.g. DevXGitRepo"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>
                      <FolderGit2 className="h-3.5 w-3.5 inline mr-1" />
                      Repository Name <span className="text-destructive">*</span>
                    </Label>
                    <Input
                      value={githubRepo}
                      onChange={(e) => setGithubRepo(e.target.value.replace(/\s+/g, "-"))}
                      placeholder="e.g. MyProject-Upgrade"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>GitHub Token (optional — uses server config if blank)</Label>
                  <Input
                    type="password"
                    value={githubToken}
                    onChange={(e) => setGithubToken(e.target.value)}
                    placeholder="ghp_... (leave blank to use server-configured token)"
                  />
                </div>
              </>
            ) : (
              /* ── Azure DevOps Mode ── */
              <>
                {hasPreconfiguredOrg ? (
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label className="text-xs text-muted-foreground">Organization</Label>
                      <Input value={selectedOrg} readOnly className="bg-muted/50 text-sm" />
                    </div>
                    <div className="space-y-2">
                      <Label className="text-xs text-muted-foreground">Project</Label>
                      <Input value={selectedProjectName} readOnly className="bg-muted/50 text-sm" />
                    </div>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>
                        <Building2 className="h-3.5 w-3.5 inline mr-1" />
                        Organization <span className="text-destructive">*</span>
                      </Label>
                      {projectsLoading ? (
                        <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
                          <Loader2 className="h-4 w-4 animate-spin" />
                          Loading...
                        </div>
                      ) : organizations.length > 0 ? (
                        <Select value={selectedOrg} onValueChange={handleOrgChange}>
                          <SelectTrigger>
                            <SelectValue placeholder="Select organization..." />
                          </SelectTrigger>
                          <SelectContent>
                            {organizations.map((org) => (
                              <SelectItem key={org.name} value={org.name}>
                                {org.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <p className="text-sm text-muted-foreground">No organizations configured. Add one in Settings.</p>
                      )}
                    </div>
                    <div className="space-y-2">
                      <Label>
                        <FolderGit2 className="h-3.5 w-3.5 inline mr-1" />
                        Project <span className="text-destructive">*</span>
                      </Label>
                      {selectedOrg && orgProjects.length > 0 ? (
                        <Select value={selectedProjectName} onValueChange={handleProjectChange}>
                          <SelectTrigger>
                            <SelectValue placeholder="Select project..." />
                          </SelectTrigger>
                          <SelectContent>
                            {orgProjects.map((proj) => (
                              <SelectItem key={proj.id} value={proj.name}>
                                {proj.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <Select disabled>
                          <SelectTrigger>
                            <SelectValue placeholder={selectedOrg ? "No projects found" : "Select org first"} />
                          </SelectTrigger>
                          <SelectContent />
                        </Select>
                      )}
                    </div>
                  </div>
                )}

                {/* ADO Repository Dropdown */}
                <div className="space-y-2">
                  <Label>
                    Repository <span className="text-destructive">*</span>
                  </Label>
                  {reposLoading ? (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Loading repositories...
                    </div>
                  ) : reposError ? (
                    <Alert variant="destructive" className="py-2">
                      <AlertTriangle className="h-4 w-4" />
                      <AlertDescription className="text-xs">
                        {reposError instanceof Error ? reposError.message : "Failed to fetch repositories. Check your ADO PAT configuration in Settings."}
                      </AlertDescription>
                    </Alert>
                  ) : !selectedOrg || !selectedProjectName ? (
                    <Select disabled>
                      <SelectTrigger>
                        <SelectValue placeholder="Select organization and project first" />
                      </SelectTrigger>
                      <SelectContent />
                    </Select>
                  ) : repositories.length > 0 ? (
                    <Select value={selectedRepoId} onValueChange={(val) => {
                      setSelectedRepoId(val);
                      const repo = repositories.find((r) => r.id === val);
                      setSelectedRepoName(repo?.name ?? "");
                    }}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select a repository..." />
                      </SelectTrigger>
                      <SelectContent>
                        {repositories.map((repo) => (
                          <SelectItem key={repo.id} value={repo.id}>
                            <div className="flex items-center gap-2">
                              <FolderGit2 className="h-3.5 w-3.5" />
                              {repo.name}
                            </div>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <p className="text-sm text-muted-foreground">No repositories found in this project.</p>
                  )}
                </div>
              </>
            )}

            {/* Target Path (read-only) */}
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">Target Path</Label>
              <Input value={targetPath} readOnly className="bg-muted/50 text-sm font-mono" />
              <p className="text-xs text-muted-foreground">
                Files will be pushed under this folder in the repository.
              </p>
            </div>

            {/* Branch */}
            <div className="space-y-2">
              <Label htmlFor="branchName">Branch Name</Label>
              <Input
                id="branchName"
                placeholder="devx-upgrade"
                value={branchName}
                onChange={(e) => setBranchName(e.target.value)}
              />
            </div>

            <Alert>
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>What will be pushed</AlertTitle>
              <AlertDescription className="text-xs">
                All upgraded code files and generated test files will be pushed to the selected repository under <strong>{targetPath}/</strong>.
                {isJira
                  ? " The server uses the configured GitHub token; you can optionally provide a different one above."
                  : " The server uses the configured ADO PAT; no manual token is needed."}
              </AlertDescription>
            </Alert>
          </div>
        )}

        {/* Result */}
        {publishResult && (
          <div className="py-4">
            {publishResult.success ? (
              <Alert className="border-primary/50 bg-primary/5">
                <CheckCircle2 className="h-4 w-4 text-green-500" />
                <AlertTitle className="text-green-600 dark:text-green-400">
                  Published Successfully!
                </AlertTitle>
                <AlertDescription className="space-y-2 mt-2">
                  <p className="text-sm">Your upgraded code has been pushed to the repository.</p>
                  <div className="space-y-1 text-xs font-mono bg-background/50 p-3 rounded border">
                    <p><strong>Branch:</strong> {publishResult.branchName}</p>
                    {publishResult.commitSha && <p><strong>Commit:</strong> {publishResult.commitSha.substring(0, 8)}</p>}
                    {publishResult.repoUrl && (
                      <p><strong>URL:</strong>{" "}
                        <a href={publishResult.repoUrl} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                          View Repository
                        </a>
                      </p>
                    )}
                  </div>
                </AlertDescription>
              </Alert>
            ) : (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>Publishing Failed</AlertTitle>
                <AlertDescription className="space-y-2">
                  {publishResult.errors?.map((error: string, idx: number) => (
                    <p key={idx} className="text-sm">{error}</p>
                  ))}
                </AlertDescription>
              </Alert>
            )}
          </div>
        )}

        <DialogFooter>
          {!publishResult ? (
            <>
              <Button variant="outline" onClick={handleClose} disabled={isPublishing}>
                Cancel
              </Button>
              <Button onClick={handlePublish} disabled={isPublishing || !canPublish}>
                {isPublishing ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Publishing...
                  </>
                ) : (
                  <>
                    <GitBranch className="h-4 w-4 mr-2" />
                    Push to Repository
                  </>
                )}
              </Button>
            </>
          ) : (
            <Button onClick={handleClose}>Close</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
