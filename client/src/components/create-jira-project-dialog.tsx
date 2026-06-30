import { useState, useEffect, useMemo } from "react";
import { GenericModal } from "@/components/ui/generic-modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { getApiUrl } from "@/lib/api-config";
import type { GoldenRepository } from "@shared/schema";
import { useGoldenRepoSelection } from "@/contexts/golden-repo-selection-context";
import { GLOBAL_ALL_ORGANIZATIONS_ID, useSelectedOrganization } from "@/contexts/selected-organization-context";
import { Badge } from "@/components/ui/badge";
import { formatJiraCreateProjectError } from "@/components/create-project/errors";

interface JiraConnection {
  id: string;
  name: string;
  instanceUrl: string;
  email: string;
  isActive: number;
  canCreateProject?: boolean;
  createProjectDisabledReason?: string | null;
  lastTestedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  connectionId?: string;
  connectionName?: string;
  instanceUrl?: string;
  onProjectCreated?: () => void;
}

const PROJECT_TYPE_OPTIONS = [
  {
    label: "Software (Scrum)",
    value: "software",
    templateKey: "com.pyxis.greenhopper.jira:gh-scrum-template",
    defaultIssueTypes: [
      { name: "Epic", color: "#6366f1" },
      { name: "Story", color: "#22c55e" },
      { name: "Task", color: "#3b82f6" },
      { name: "Sub-task", color: "#f59e0b" },
      { name: "Bug", color: "#ef4444" },
    ],
  },
  {
    label: "Software (Kanban)",
    value: "software-kanban",
    templateKey: "com.pyxis.greenhopper.jira:gh-kanban-template",
    defaultIssueTypes: [
      { name: "Epic", color: "#6366f1" },
      { name: "Story", color: "#22c55e" },
      { name: "Task", color: "#3b82f6" },
      { name: "Sub-task", color: "#f59e0b" },
      { name: "Bug", color: "#ef4444" },
    ],
  },
  {
    label: "Business",
    value: "business",
    templateKey: "com.atlassian.jira-core-project-templates:jira-core-simplified-project-management",
    defaultIssueTypes: [
      { name: "Task", color: "#3b82f6" },
      { name: "Sub-task", color: "#f59e0b" },
    ],
  },
  {
    label: "Service Desk (JSM)",
    value: "service_desk",
    templateKey: "com.atlassian.servicedesk:itil-v2-service-desk-project",
    defaultIssueTypes: [
      { name: "Service Request", color: "#8b5cf6" },
      { name: "Incident",        color: "#ef4444" },
      { name: "Problem",         color: "#f97316" },
      { name: "Change",          color: "#3b82f6" },
      { name: "Task",            color: "#3b82f6" },
      { name: "Sub-task",        color: "#f59e0b" },
      { name: "Service Request with Approvals", color: "#8b5cf6" },
    ],
  },
];
const JIRA_CREATE_PROJECT_DISABLED_REASON =
  "Only the Jira connection owner, TenantAdmin, or OrgAdmin can create projects under this Jira organization.";

export function CreateJiraProjectDialog({
  open,
  onOpenChange,
  connectionId: initialConnectionId,
  connectionName: initialConnectionName,
  instanceUrl: initialInstanceUrl,
  onProjectCreated,
}: Props) {
  const { toast } = useToast();
  const { selectedOrganization } = useSelectedOrganization();
  const isGlobalAllOrganizations =
    selectedOrganization?.id === GLOBAL_ALL_ORGANIZATIONS_ID;
  const isGlobalJiraSelection =
    !!selectedOrganization &&
    !isGlobalAllOrganizations &&
    selectedOrganization.sourceType === "jira";
  const { getSelectedPaths } = useGoldenRepoSelection();
  const [projectName, setProjectName] = useState("");
  const [projectKey, setProjectKey] = useState("");
  const [confluenceSpaceKey, setConfluenceSpaceKey] = useState("");
  const [description, setDescription] = useState("");
  const [projectType, setProjectType] = useState(PROJECT_TYPE_OPTIONS[0].value);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [selectedRepoId, setSelectedRepoId] = useState<string | null>(null);
  const [selectedConnectionId, setSelectedConnectionId] = useState<string | null>(
    initialConnectionId || null
  );

  // Fetch Jira connections
  const {
    data: jiraConnectionsData,
    isLoading: connectionsLoading,
  } = useQuery<{
    connections: JiraConnection[];
  }>({
    queryKey: ["/api/jira/connections"],
    queryFn: async () => {
      try {
        const response = await fetch(getApiUrl("/api/jira/connections"), {
          credentials: "include",
        });
        if (!response.ok) {
          throw new Error(
            `Failed to fetch connections: ${response.status} ${response.statusText}`
          );
        }
        const data = await response.json();
        return data;
      } catch (error: any) {
        throw error;
      }
    },
    enabled: open,
    retry: false,
  });

  // Deduplicate connections by ID (in case API returns duplicates)
  const jiraConnections = useMemo(() => {
    const connections = jiraConnectionsData?.connections || [];
    const seen = new Set<string>();
    const unique: JiraConnection[] = [];
    
    for (const conn of connections) {
      if (!seen.has(conn.id)) {
        seen.add(conn.id);
        unique.push(conn);
      }
    }
    
    return unique;
  }, [jiraConnectionsData?.connections]);
  
  const selectedConnection = jiraConnections.find(
    (conn) => conn.id === selectedConnectionId
  );

  // Fetch golden repositories from the configured Golden Repo provider.
  const {
    data: repositories = [],
    isLoading: reposLoading,
  } = useQuery<GoldenRepository[]>({
    queryKey: ["/api/golden-repositories"],
    queryFn: async () => {
      try {
        const response = await fetch(getApiUrl("/api/golden-repositories"), {
          credentials: "include",
        });
        if (!response.ok) {
          throw new Error(
            `Failed to fetch repositories: ${response.status} ${response.statusText}`
          );
        }
        const data = await response.json();
        return Array.isArray(data) ? data : data.repositories || [];
      } catch (error: any) {
        throw error;
      }
    },
    enabled: open,
    retry: false,
  });

  useEffect(() => {
    if (open) {
      setProjectName("");
      setProjectKey("");
      setConfluenceSpaceKey("");
      setDescription("");
      setProjectType(PROJECT_TYPE_OPTIONS[0].value);
      setErrorMsg(null);
      setSelectedRepoId(null);
      // Set initial connection if provided, or first available connection
      if (initialConnectionId) {
        setSelectedConnectionId(initialConnectionId);
      } else if (jiraConnections.length > 0 && !selectedConnectionId) {
        const firstCreatableConnection =
          jiraConnections.find((connection) => connection.canCreateProject !== false) || null;
        setSelectedConnectionId(firstCreatableConnection?.id || null);
      }
    }
  }, [open, initialConnectionId, jiraConnections]);

  useEffect(() => {
    if (
      !open ||
      !selectedOrganization ||
      selectedOrganization.id === GLOBAL_ALL_ORGANIZATIONS_ID ||
      selectedOrganization.sourceType !== "jira"
    ) {
      return;
    }

    const matchingConnection = jiraConnections.find(
      (connection) => connection.id === selectedOrganization.id
    );

    if (matchingConnection) {
      setSelectedConnectionId(matchingConnection.id);
    }
  }, [open, selectedOrganization, jiraConnections]);

  useEffect(() => {
    if (projectName) {
      const generatedKey = projectName
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, "")
        .substring(0, 10);
      setProjectKey(generatedKey);
    }
  }, [projectName]);

  const mutation = useMutation({
    mutationFn: async (body: any) => {
      return apiRequest("POST", "/api/jira/create-project", body);
    },
    onSuccess: async (res: Response) => {
      const data = await res.json();
      queryClient.invalidateQueries({ queryKey: ["/api/jira/projects"] });
      queryClient.invalidateQueries({ queryKey: ["/api/jira/connections"] });
      // Invalidate all Jira connection-related queries (including projects and SDLC projects)
      queryClient.invalidateQueries({ queryKey: ["/api/jira/connection"] });
      // Invalidate specific connection queries if connectionId is available
      if (initialConnectionId) {
        queryClient.invalidateQueries({ 
          queryKey: ["/api/jira/connection", initialConnectionId, "projects"] 
        });
        queryClient.invalidateQueries({ 
          queryKey: ["/api/jira/connection", initialConnectionId, "sdlc-projects"] 
        });
      }
      // Ensure SDLC Jira project dropdown sees the new project
      queryClient.invalidateQueries({ queryKey: ["/api/jira/all-sdlc-projects"] });
      queryClient.invalidateQueries({ queryKey: ["/api/sdlc/projects"] });
      queryClient.invalidateQueries({ queryKey: ["/api/sdlc-projects"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ado-projects?org=all"] });
      queryClient.invalidateQueries({ queryKey: ["/api/hub/artifacts/projects"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/metrics"] });
      toast({
        title: "Jira Project Created",
        description: `Project "${data.projectKey || projectKey}" created and saved successfully`,
      });
      onProjectCreated?.();
      onOpenChange(false);
    },
    onError: (err: any) => {
      const m = formatJiraCreateProjectError(err);
      setErrorMsg(m);
      toast({
        title: "Failed to create Jira project",
        description: m,
        variant: "destructive",
      });
    },
  });

  const handleSubmit = () => {
    setErrorMsg(null);
    if (!projectName.trim()) {
      setErrorMsg("Project name is required");
      return;
    }
    if (!projectKey.trim()) {
      setErrorMsg("Project key is required");
      return;
    }
    if (projectKey.length < 2 || projectKey.length > 10) {
      setErrorMsg("Project key must be 2-10 characters");
      return;
    }
    if (!selectedConnectionId) {
      setErrorMsg("Please select a Jira connection");
      return;
    }
    if (!selectedConnection || selectedConnection.canCreateProject === false) {
      setErrorMsg(selectedConnection?.createProjectDisabledReason || JIRA_CREATE_PROJECT_DISABLED_REASON);
      return;
    }
    if (jiraConnections.length === 0) {
      setErrorMsg("No Jira connections available. Please configure a connection in Settings first.");
      return;
    }

    const selectedType = PROJECT_TYPE_OPTIONS.find(t => t.value === projectType);

    // Get golden repo information if a repo is selected
    let linkedGoldenRepoOrg: string | null = null;
    let linkedGoldenRepoProject: string | null = null;
    let linkedGoldenRepoName: string | null = null;
    let goldenRepoReference: {
      repoId: string;
      repoName: string;
      filePaths: string[];
      provider?: "ado" | "github" | "gitlab";
      repoUrl?: string;
      defaultBranch?: string;
    } | null = null;

    if (selectedRepoId) {
      const selectedRepo = repositories.find(
        (r: any) => r.id === selectedRepoId
      ) as any;
      if (selectedRepo) {
        linkedGoldenRepoOrg = (selectedRepo as any).organization || null;
        linkedGoldenRepoProject = (selectedRepo as any).project || null;
        linkedGoldenRepoName = (selectedRepo as any).name || null;

        // Get selected file paths from context
        const selectedPaths = getSelectedPaths(selectedRepoId);
        goldenRepoReference = {
          repoId: selectedRepoId,
          repoName: linkedGoldenRepoName || "",
          filePaths: selectedPaths,
          provider: selectedRepo.provider,
          repoUrl: selectedRepo.url || selectedRepo.webUrl,
          defaultBranch: selectedRepo.defaultBranch,
        };
      }
    }

    const body = {
      connectionId: selectedConnectionId,
      projectName: projectName.trim(),
      projectKey: projectKey.trim().toUpperCase(),
      confluenceSpaceKey: confluenceSpaceKey.trim().toUpperCase() || null,
      projectDescription: description.trim() || null,
      projectTypeKey: selectedType?.value.includes("software") ? "software" : "business",
      projectTemplateKey: selectedType?.templateKey,
      goldenRepoId: selectedRepoId || null,
      goldenRepoName: linkedGoldenRepoName,
      goldenRepoOrg: linkedGoldenRepoOrg,
      goldenRepoProject: linkedGoldenRepoProject,
      goldenRepoProvider: goldenRepoReference?.provider || null,
      goldenRepoUrl: goldenRepoReference?.repoUrl || null,
      goldenRepoDefaultBranch: goldenRepoReference?.defaultBranch || null,
      golden_repo_reference: goldenRepoReference,
      repositoryId: selectedRepoId || null,
    };

    mutation.mutate(body);
  };

  return (
    <GenericModal
      open={open}
      onOpenChange={onOpenChange}
      title="Create Jira Project"
      description="Create a new project in your Jira instance"
      width="95vw"
      maxHeight="90vh"
      footerButtons={[
        {
          label: "Cancel",
          onClick: () => onOpenChange(false),
          variant: "outline",
          disabled: mutation.isPending,
          "data-testid": "button-cancel-jira-project",
        },
        {
          label: mutation.isPending ? "Creating..." : "Create Project",
          onClick: handleSubmit,
          variant: "default",
          disabled: mutation.isPending || selectedConnection?.canCreateProject === false,
          loading: mutation.isPending,
          "data-testid": "button-create-jira-project",
        },
      ]}
    >
      <div className="space-y-4">
          {/* Jira Connection Selection */}
          <div className="space-y-2">
            <Label>Jira Connection *</Label>
            <Select
              value={selectedConnectionId || undefined}
              onValueChange={(value) => setSelectedConnectionId(value || null)}
              disabled={connectionsLoading || isGlobalJiraSelection}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select a Jira connection" />
              </SelectTrigger>
              <SelectContent>
                {jiraConnections.map((conn) => {
                  const canCreateProject = conn.canCreateProject !== false;
                  return (
                    <SelectItem
                      key={conn.id}
                      value={conn.id}
                      textValue={conn.name}
                      disabled={!canCreateProject}
                    >
                      <div className="flex min-w-0 flex-col">
                        <div className="flex min-w-0 items-center gap-2">
                          <span className="truncate">{conn.name}</span>
                          {!canCreateProject && (
                            <span className="shrink-0 text-xs text-muted-foreground">
                              No create permission
                            </span>
                          )}
                        </div>
                        <span className="truncate text-xs text-muted-foreground">
                          {conn.instanceUrl}
                        </span>
                      </div>
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
            {selectedConnection?.canCreateProject === false && (
              <p className="text-xs text-muted-foreground">
                {selectedConnection.createProjectDisabledReason || JIRA_CREATE_PROJECT_DISABLED_REASON}
              </p>
            )}
            {connectionsLoading && (
              <p className="text-xs text-muted-foreground">
                Loading connections...
              </p>
            )}
            {jiraConnections.length === 0 && !connectionsLoading && (
              <p className="text-xs text-destructive">
                No Jira connections found. Please configure a connection in Settings first.
              </p>
            )}
          </div>
          {errorMsg && (
            <Alert variant="destructive">
              <AlertDescription>{errorMsg}</AlertDescription>
            </Alert>
          )}

          <div className="space-y-2">
            <Label>Project Name *</Label>
            <Input
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
              placeholder="My New Project"
              data-testid="input-jira-project-name"
            />
          </div>

          <div className="space-y-2">
            <Label>Project Key *</Label>
            <Input
              value={projectKey}
              onChange={(e) => setProjectKey(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").substring(0, 10))}
              placeholder="MNP"
              data-testid="input-jira-project-key"
            />
            <p className="text-xs text-muted-foreground">
              2-10 uppercase letters/numbers. Used as prefix for issues (e.g., {projectKey || "KEY"}-123)
            </p>
          </div>

          <div className="space-y-2">
            <Label>Confluence Space Key</Label>
            <Input
              value={confluenceSpaceKey}
              onChange={(e) => setConfluenceSpaceKey(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").substring(0, 10))}
              placeholder={projectKey || "Same as Project Key"}
              data-testid="input-confluence-space-key"
            />
            <p className="text-xs text-muted-foreground">
              Space key in Confluence for documentation. Leave blank to use the Jira project key ({projectKey || "KEY"}).
            </p>
          </div>

          <div className="space-y-2">
            <Label>Description</Label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              placeholder="Project description..."
              data-testid="input-jira-project-description"
            />
          </div>

          <div className="space-y-2">
            <Label>Project Type</Label>
            <Select value={projectType} onValueChange={setProjectType}>
              <SelectTrigger data-testid="select-jira-project-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PROJECT_TYPE_OPTIONS.map((t) => (
                  <SelectItem key={t.value} value={t.value}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {projectType === "service_desk" && (
              <p className="text-xs text-amber-600 dark:text-amber-400">
                ⚠ Requires a Jira Service Management (JSM) license. If your Jira instance does not have JSM, the project will not be created.
              </p>
            )}
            {/* Default Issue Types preview */}
            {(() => {
              const selected = PROJECT_TYPE_OPTIONS.find(t => t.value === projectType);
              if (!selected) return null;
              return (
                <div className="rounded-md border border-border bg-muted/40 px-3 py-2.5 space-y-1.5">
                  <p className="text-xs font-medium text-muted-foreground">
                    Default issue types for this project type:
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {selected.defaultIssueTypes.map((it) => (
                      <Badge
                        key={it.name}
                        variant="outline"
                        className="text-[10px] py-0 h-4 bg-blue-50 text-blue-600 border-blue-200 dark:bg-blue-900/20 dark:text-blue-400 dark:border-blue-800"
                        title={it.name}
                      >
                        {it.name}
                      </Badge>
                    ))}
                  </div>
                </div>
              );
            })()}
          </div>

          {/* Golden Repository Selection */}
          <div className="space-y-2">
            <Label>Link Golden Repository (Optional)</Label>
            <div className="flex gap-2">
              <Select
                value={selectedRepoId || undefined}
                onValueChange={(value) => setSelectedRepoId(value || null)}
                disabled={reposLoading}
              >
                <SelectTrigger className="flex-1">
                  <SelectValue placeholder="Select a golden repository (optional)" />
                </SelectTrigger>
                <SelectContent>
                  {repositories.map((repo) => (
                    <SelectItem key={repo.id} value={repo.id}>
                      {repo.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedRepoId && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setSelectedRepoId(null)}
                  disabled={reposLoading}
                >
                  Clear
                </Button>
              )}
            </div>
            {reposLoading && (
              <p className="text-xs text-muted-foreground">
                Loading repositories...
              </p>
            )}
            {selectedRepoId && (
              <p className="text-xs text-muted-foreground">
                Selected repository will be linked to this Jira project
              </p>
            )}
          </div>
        </div>
    </GenericModal>
  );
}
