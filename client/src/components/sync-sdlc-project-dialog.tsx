import { useEffect, useMemo, useState } from "react";
import { GenericModal } from "@/components/ui/generic-modal";
import { CheckCircle2, Loader2, RefreshCw } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { getApiUrl } from "@/lib/api-config";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { getIntegrationLabels } from "@/lib/integration-config";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useMe } from "@/hooks/use-me";

interface ADOProjectForSync {
  id: string;
  name: string;
  description: string;
  organization: string;
  organizationUrl: string;
  sdlcProject?: any | null;
  repositoryId?: string | null;
  repository_id?: string | null;
  repositoryCount?: number | null;
  linkedGoldenRepoOrg?: string | null;
  linkedGoldenRepoProject?: string | null;
  linkedGoldenRepoName?: string | null;
  goldenRepoReference?: any;
  golden_repo_reference?: any;
  integrationType?: string;
  jiraConnectionId?: string;
  jiraProjectKey?: string;
  jiraInstanceUrl?: string;
  projectManagementPatConfigured?: boolean;
  repoPatRequired?: boolean;
  repoPatConfigured?: boolean;
  userJiraPatConfigured?: boolean;
  userGitlabPatConfigured?: boolean;
  userPatConfigured?: boolean;
  credentialStatus?: {
    jira?: { required?: boolean; configured?: boolean };
    repo?: { required?: boolean; configured?: boolean };
    readyForUser?: boolean;
  };
}

interface JiraConnectionSummary {
  id: string;
  name?: string;
  instanceUrl?: string;
  email?: string | null;
}

interface UserJiraCredentialStatus {
  connected?: boolean;
  instanceUrl?: string;
  email?: string;
  displayName?: string;
  accountId?: string;
  lastTestedAt?: string;
}

interface SyncSdlcProjectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  project: ADOProjectForSync;
  onProjectSynced: () => void;
}

export function SyncSdlcProjectDialog({
  open,
  onOpenChange,
  project,
  onProjectSynced,
}: SyncSdlcProjectDialogProps) {
  const { toast } = useToast();
  const { data: me } = useMe();
  const [isSyncing, setIsSyncing] = useState(false);
  const [jiraApiToken, setJiraApiToken] = useState("");
  const [gitlabToken, setGitlabToken] = useState("");
  const isJira = project.integrationType === "jira";
  const labels = getIntegrationLabels(project.integrationType);
  const normalizeUrl = (u: string) => 
    u.replace(/^https?:\/\//, "").replace(/\/+$/, "").toLowerCase();
  const jiraInstanceUrl = project.jiraInstanceUrl || project.organizationUrl || "";

  // Fetch global organizations for assignment
  const { data: globalOrgs = [] } = useQuery<any[]>({
    queryKey: ["/api/global-organizations"],
    enabled: open,
  });

  const { data: jiraConnectionsData } = useQuery<{ connections: JiraConnectionSummary[] }>({
    queryKey: ["/api/jira/connections"],
    queryFn: async () =>
      (await fetch(getApiUrl("/api/jira/connections"), { credentials: "include" })).json(),
    enabled: open && isJira,
  });

  const { data: userJiraCredential } = useQuery<UserJiraCredentialStatus>({
    queryKey: ["/api/user/jira-credentials", jiraInstanceUrl],
    queryFn: async () => {
      const params = new URLSearchParams({ instanceUrl: jiraInstanceUrl });
      const response = await fetch(getApiUrl(`/api/user/jira-credentials?${params}`), {
        credentials: "include",
      });
      if (!response.ok) throw new Error("Failed to fetch Jira credential status");
      return response.json();
    },
    enabled: open && isJira && !!jiraInstanceUrl,
  });

  // Filter organizations to only show those that match the project's instance/org URL
  const filteredOrgs = useMemo(() => {
    if (!project) return [];
    const projUrl = normalizeUrl(project.organizationUrl || "");
    
    return globalOrgs.filter(o => {
      if (isJira) {
        // For Jira, match by normalized instance URL (stored in description)
        return o.sourceType === "jira" && o.description && normalizeUrl(o.description) === projUrl;
      } else {
        // For ADO, match by organization name/URL
        return o.sourceType === "ado" && project.organizationUrl.toLowerCase().includes(o.name.toLowerCase());
      }
    });
  }, [globalOrgs, project, isJira]);

  // State for the organization the project will be assigned to
  const [selectedOrgId, setSelectedOrgId] = useState<string>("");

  // Initialize selectedOrgId when project or filteredOrgs changes
  useEffect(() => {
    if (project && filteredOrgs.length > 0) {
      // Find matching org by ID or priority
      const matchingOrg = filteredOrgs.find(o => 
        o.id === project.jiraConnectionId || 
        o.id === (project as any).artifactOrgId
      ) || filteredOrgs[0];

      if (matchingOrg) {
        setSelectedOrgId(matchingOrg.id);
      }
    }
  }, [project, filteredOrgs]);

  const selectedOrg = filteredOrgs.find(o => o.id === selectedOrgId);
  const jiraConnection = (jiraConnectionsData?.connections ?? []).find((connection) => {
    if (project.jiraConnectionId && connection.id === project.jiraConnectionId) return true;
    if (!connection.instanceUrl || !jiraInstanceUrl) return false;
    return normalizeUrl(connection.instanceUrl) === normalizeUrl(jiraInstanceUrl);
  });
  const jiraCredentialEmail =
    (userJiraCredential?.connected ? userJiraCredential.email?.trim() : "") ||
    jiraConnection?.email?.trim() ||
    "";
  const jiraCredential = project.credentialStatus?.jira;
  const repoCredential = project.credentialStatus?.repo;
  const projectReadyForUser =
    project.credentialStatus?.readyForUser === true ||
    project.userPatConfigured === true ||
    (project as any).projectUserPatConfigured === true;
  const jiraPatRequired = jiraCredential?.required ?? true;
  const jiraPatConfigured =
    projectReadyForUser ||
    (jiraCredential?.configured ??
      (project.projectManagementPatConfigured === true || project.userJiraPatConfigured === true));
  const repoPatRequired = repoCredential?.required ?? project.repoPatRequired === true;
  const repoPatConfigured =
    projectReadyForUser ||
    (repoCredential?.configured ??
      (project.repoPatConfigured === true || project.userGitlabPatConfigured === true));
  const needsProjectManagementPat =
    jiraPatRequired &&
    !jiraPatConfigured;
  const needsRepoPat =
    repoPatRequired &&
    !repoPatConfigured;
  const hasAllPersonalCredentials = !needsProjectManagementPat && !needsRepoPat;
  const signedInUserLabel =
    me?.user?.email || me?.user?.displayName || "the currently signed-in Astra user";
  const projectManagementCredentialLabel = jiraCredentialEmail || signedInUserLabel;
  const syncActionLabel = hasAllPersonalCredentials
    ? "Sync project"
    : "Validate and sync";
  const modalDescription = hasAllPersonalCredentials
    ? `Create this SDLC project from existing ${labels.longName} metadata for your user.`
    : `Create this SDLC project from existing ${labels.longName} metadata and validate the missing personal credentials.`;
  const canSync =
    (!needsProjectManagementPat ||
      (jiraApiToken.trim().length > 0 && (!isJira || jiraCredentialEmail.length > 0))) &&
    (!needsRepoPat || gitlabToken.trim().length > 0);

  const handleSync = async () => {
    if (!project?.id || !project?.name) {
      toast({
        title: "Missing data",
        description: "Project information is incomplete. Please try again.",
        variant: "destructive",
      });
      return;
    }

    try {
      setIsSyncing(true);

      const adoProjectUrl = isJira
        ? null
        : `${project.organizationUrl.replace(/\/$/, "")}/${encodeURIComponent(project.name)}`;
      const projectMetadata = project.sdlcProject || project;
      const repositoryId =
        projectMetadata.repositoryId ?? projectMetadata.repository_id ?? undefined;
      const goldenRepoReference =
        projectMetadata.goldenRepoReference ?? projectMetadata.golden_repo_reference ?? undefined;
      const syncPayload: Record<string, unknown> = {
        name: project.name,
        description: project.description || null,
        organization: selectedOrg?.name || project.organization,
        adoProjectUrl,
        integrationType: project.integrationType || "ado",
        jiraConnectionId: selectedOrg?.sourceType === "jira" ? selectedOrg.id : project.jiraConnectionId,
        jiraInstanceUrl: project.jiraInstanceUrl || null,
        jiraProjectKey: project.jiraProjectKey || null,
      };

      if (repositoryId) {
        syncPayload.repositoryId = repositoryId;
        syncPayload.repositoryCount = projectMetadata.repositoryCount || 1;
      }
      if (projectMetadata.linkedGoldenRepoOrg) {
        syncPayload.linkedGoldenRepoOrg = projectMetadata.linkedGoldenRepoOrg;
      }
      if (projectMetadata.linkedGoldenRepoProject) {
        syncPayload.linkedGoldenRepoProject = projectMetadata.linkedGoldenRepoProject;
      }
      if (projectMetadata.linkedGoldenRepoName) {
        syncPayload.linkedGoldenRepoName = projectMetadata.linkedGoldenRepoName;
      }
      if (goldenRepoReference) {
        syncPayload.golden_repo_reference = goldenRepoReference;
      }

      const syncResponse = await apiRequest(
        "POST",
        `/api/sdlc/projects/by-ado/${encodeURIComponent(project.id)}/sync`,
        syncPayload,
      );
      const syncResult = await syncResponse.json().catch(() => ({}));
      const sdlcProjectId = syncResult?.project?.id;

      if ((needsProjectManagementPat || needsRepoPat) && sdlcProjectId) {
        const credentialResponse = await fetch(
          getApiUrl(`/api/sdlc/projects/${sdlcProjectId}/personal-pats`),
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({
              ...(needsProjectManagementPat
                ? {
                    ...(isJira ? { jiraEmail: jiraCredentialEmail } : {}),
                    projectManagementApiToken: jiraApiToken.trim(),
                  }
                : {}),
              ...(needsRepoPat ? { repoToken: gitlabToken.trim() } : {}),
            }),
          },
        );
        const credentialResult = await credentialResponse.json().catch(() => ({}));
        if (!credentialResponse.ok) {
          throw new Error(
            credentialResult.error || credentialResult.message || "Credential validation failed",
          );
        }
      }

      toast({
        title: "Project synced",
        description: hasAllPersonalCredentials
          ? "This project is now synced for your user."
          : "Project metadata and your personal credentials are synced.",
      });

      queryClient.invalidateQueries({ queryKey: ["/api/sdlc/projects"] });
      onProjectSynced();
      onOpenChange(false);
    } catch (error) {
      console.error("Error syncing SDLC project:", error);
      toast({
        title: "Sync failed",
        description:
          error instanceof Error
            ? error.message
            : `Failed to sync SDLC project from ${labels.longName} project.`,
        variant: "destructive",
      });
    } finally {
      setIsSyncing(false);
    }
  };

  return (
    <GenericModal
      open={open}
      onOpenChange={onOpenChange}
      title={`Sync SDLC Project from ${labels.longName}`}
      description={modalDescription}
      icon={RefreshCw}
      width="600px"
      contentClassName="space-y-4"
      footerButtons={[
        {
          label: "Cancel",
          onClick: () => onOpenChange(false),
          variant: "outline",
          disabled: isSyncing,
        },
        {
          label: isSyncing
            ? hasAllPersonalCredentials
              ? "Syncing..."
              : "Validating..."
            : syncActionLabel,
          onClick: () => void handleSync(),
          variant: "default",
          disabled: isSyncing || !canSync,
          loading: isSyncing,
        },
      ]}
    >
      <div className="space-y-4">
        <div className="space-y-1">
          <p className="text-sm font-medium">
            {labels.longName} Project:{" "}
            <span className="font-semibold">{project.name}</span>
          </p>
          {isJira && project.jiraProjectKey && (
            <p className="text-xs text-muted-foreground">
              Project Key: <span className="font-mono">{project.jiraProjectKey}</span>
            </p>
          )}
          <p className="text-xs text-muted-foreground break-all">
            Instance: {jiraInstanceUrl || project.organizationUrl}
          </p>
          {isJira && jiraCredentialEmail && (
            <p className="text-xs text-muted-foreground break-all">
              Jira email: {jiraCredentialEmail}
            </p>
          )}
        </div>

        <div className="space-y-4">
          {needsProjectManagementPat ? (
            <div className="space-y-2">
              <Label htmlFor="sync-project-management-api-token">
                {isJira ? "Jira API key" : "Project management API key"}
              </Label>
              <Input
                id="sync-project-management-api-token"
                type="password"
                value={jiraApiToken}
                onChange={(event) => setJiraApiToken(event.target.value)}
                placeholder={isJira ? "Jira API key" : "Project management API key"}
                autoComplete="off"
                disabled={isSyncing}
              />
            </div>
          ) : (
            <p className="flex items-center gap-2 text-sm text-emerald-600 dark:text-emerald-500">
              <CheckCircle2 className="h-4 w-4" />
              {isJira ? "Jira API key" : "Project management API key"} is already validated for {projectManagementCredentialLabel}.
            </p>
          )}

          {needsRepoPat ? (
            <div className="space-y-2">
              <Label htmlFor="sync-repo-token">Repository provider personal access token</Label>
              <p className="text-xs text-muted-foreground">
                Repository access is required for this project, but your repository provider PAT is not configured yet.
              </p>
              <Input
                id="sync-repo-token"
                type="password"
                value={gitlabToken}
                onChange={(event) => setGitlabToken(event.target.value)}
                placeholder="Repository provider personal access token"
                autoComplete="off"
                disabled={isSyncing}
              />
            </div>
          ) : repoPatRequired ? (
            <p className="flex items-center gap-2 text-sm text-emerald-600 dark:text-emerald-500">
              <CheckCircle2 className="h-4 w-4" />
              Repository provider PAT is already validated for {signedInUserLabel}.
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">
              Repository provider PAT is not required because no repository is mapped to this project yet.
            </p>
          )}

          {isSyncing && (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Validating credentials...
            </p>
          )}
        </div>
      </div>
    </GenericModal>
  );
}
