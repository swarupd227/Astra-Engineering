import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RepoToolConfigurator } from "@/components/repo-tool-configurator";
import { apiRequest } from "@/lib/queryClient";
import { AlertCircle, GitBranch, Loader2 } from "lucide-react";
import toast from "react-hot-toast";

type RepoIntegrationConfig = {
  source?: string | null;
  toolCatalogId?: string | null;
  providerKey?: string | null;
  displayName?: string | null;
  config?: Record<string, string> | null;
};

export type ProjectGitConfig = {
  provider?: "github" | "ado";
  branch?: string | null;
  basePath?: string | null;
  repositoryUrl?: string | null;
  repositoryId?: string | null;
  repositoryName?: string | null;
  authType?: "token" | "basic" | "none";
  username?: string | null;
  hasToken?: boolean;
  adoRepositoryId?: string | null;
  adoRepositoryName?: string | null;
};

interface GitConfigModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  integrationType?: string | null;
  repoIntegration?: RepoIntegrationConfig | null;
  isLoadingRepoIntegration?: boolean;
  onSaved?: () => void;
}

function serializeConfig(values: Record<string, string>) {
  return JSON.stringify(
    Object.keys(values || {})
      .sort()
      .reduce<Record<string, string>>((acc, key) => {
        acc[key] = String(values[key] || "");
        return acc;
      }, {}),
  );
}

function getConfiguredRepoId(providerKey: string, values: Record<string, string>) {
  switch (providerKey) {
    case "gitlab":
      return String(
        values.projectId ||
          values.repositoryId ||
          values.repository ||
          values.repositoryName ||
          "",
      ).trim();
    case "bitbucket":
      return String(
        values.repositorySlug ||
          values.repository ||
          values.repositoryName ||
          "",
      ).trim();
    case "azure_repos":
      return String(
        values.repositoryId ||
          values.repository ||
          values.repositoryName ||
          "",
      ).trim();
    case "github":
    default:
      return String(values.repository || values.repositoryName || "").trim();
  }
}

function getConfiguredRepoName(providerKey: string, values: Record<string, string>) {
  switch (providerKey) {
    case "gitlab":
      return String(values.repositoryName || values.repository || values.projectId || "").trim();
    case "bitbucket":
      return String(values.repository || values.repositorySlug || values.repositoryName || "").trim();
    case "azure_repos":
      return String(values.repository || values.repositoryName || values.repositoryId || "").trim();
    case "github":
    default:
      return String(values.repositoryName || values.repository || "").trim();
  }
}

function getSourceLabel(source: string | null | undefined) {
  switch (source) {
    case "project_override":
      return "Project override";
    case "org_default":
      return "Organization default";
    case "fallback":
      return "Inherited from organization";
    default:
      return "Configured";
  }
}

export function GitConfigModal({
  open,
  onOpenChange,
  projectId,
  integrationType,
  repoIntegration,
  isLoadingRepoIntegration = false,
  onSaved,
}: GitConfigModalProps) {
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState(false);
  const [branch, setBranch] = useState("main");
  const [repoValues, setRepoValues] = useState<Record<string, string>>({});
  const [showRepoEditor, setShowRepoEditor] = useState(false);

  const { data: gitConfig, isLoading: isLoadingGitConfig } = useQuery<ProjectGitConfig | null>({
    queryKey: ["/api/projects", projectId, "git-config"],
    queryFn: async () => {
      const response = await apiRequest(
        "GET",
        `/api/projects/${encodeURIComponent(projectId)}/git-config`,
      );
      return (await response.json()) as ProjectGitConfig | null;
    },
    enabled: open && !!projectId,
  });

  const providerKey = String(repoIntegration?.providerKey || "").toLowerCase();
  const providerLabel = repoIntegration?.displayName || "Repository";
  const providerSource = repoIntegration?.source || null;
  const toolCatalogId = String(repoIntegration?.toolCatalogId || "").trim();
  const initialRepoValues = useMemo(
    () => ({ ...((repoIntegration?.config || {}) as Record<string, string>) }),
    [repoIntegration?.config],
  );
  const currentRepoId = getConfiguredRepoId(providerKey, repoValues);
  const currentRepoName = getConfiguredRepoName(providerKey, repoValues);
  const initialRepoId = getConfiguredRepoId(providerKey, initialRepoValues);
  const initialBranch = String(gitConfig?.branch || "main").trim() || "main";
  const repoConfigDirty =
    serializeConfig(repoValues) !== serializeConfig(initialRepoValues);
  const branchDirty = (branch.trim() || "main") !== initialBranch;
  const isJiraProject = String(integrationType || "").toLowerCase() === "jira";
  const hasConfiguredRepoTool = !!providerKey;
  const canEditConfiguredRepo = hasConfiguredRepoTool && !!toolCatalogId;
  const usesAdoFallback = !hasConfiguredRepoTool && !isJiraProject;
  const blocksForMissingRepoTool = isJiraProject && !hasConfiguredRepoTool;
  const shouldShowRepoEditor =
    canEditConfiguredRepo && (showRepoEditor || !currentRepoId);

  useEffect(() => {
    if (!open) return;
    setRepoValues(initialRepoValues);
    setShowRepoEditor(!initialRepoId);
  }, [open, initialRepoValues, initialRepoId]);

  useEffect(() => {
    if (!open) return;
    setBranch(initialBranch);
  }, [open, initialBranch]);

  const handleSave = async () => {
    if (!projectId) return;
    if (blocksForMissingRepoTool) {
      onOpenChange(false);
      return;
    }

    const normalizedBranch = branch.trim() || "main";
    if (hasConfiguredRepoTool && !currentRepoId) {
      toast.error(`Select or create a ${providerLabel} repository first.`);
      return;
    }

    setSaving(true);
    try {
      if (hasConfiguredRepoTool && repoConfigDirty) {
        await apiRequest("POST", "/api/project-integration-configs", {
          projectId,
          categoryKey: "repo",
          useOrgDefault: false,
          toolCatalogId,
          config: repoValues,
        });
      }

      if (branchDirty || !gitConfig) {
        await apiRequest(
          "PUT",
          `/api/projects/${encodeURIComponent(projectId)}/git-config`,
          {
            provider:
              gitConfig?.provider ||
              (String(integrationType || "").toLowerCase() === "ado"
                ? "ado"
                : "github"),
            branch: normalizedBranch,
            basePath: gitConfig?.basePath || null,
            adoRepositoryId: gitConfig?.adoRepositoryId || null,
            adoRepositoryName: gitConfig?.adoRepositoryName || null,
          },
        );
      }

      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["/api/projects", projectId, "integration-effective"],
        }),
        queryClient.invalidateQueries({
          queryKey: ["/api/projects", projectId, "git-config"],
        }),
      ]);

      toast.success("Testing repository settings saved");
      onSaved?.();
      onOpenChange(false);
    } catch (error: any) {
      const message =
        error?.response?.data?.details ||
        error?.response?.data?.error ||
        error?.message ||
        "Failed to save testing repository settings";
      toast.error(message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[620px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <GitBranch className="h-5 w-5" />
            Testing repository
          </DialogTitle>
          <DialogDescription>
            Manual test cases and BDD assets use the configured repo tool first.
            Azure DevOps is only used as a fallback for ADO projects with no repo
            tool configured.
          </DialogDescription>
        </DialogHeader>

        {isLoadingGitConfig || isLoadingRepoIntegration ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-4 py-2">
            {hasConfiguredRepoTool ? (
              <div className="rounded-md border border-border bg-muted/30 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-foreground">
                    Using configured repo tool: {providerLabel}
                  </span>
                  <Badge variant="outline">{getSourceLabel(providerSource)}</Badge>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  Testing artifacts will use this repo integration before any
                  Azure DevOps fallback.
                </p>
                {hasConfiguredRepoTool && !canEditConfiguredRepo ? (
                  <p className="mt-2 text-xs text-destructive">
                    Repo setup details are unavailable for editing right now.
                    Reopen the page and try again.
                  </p>
                ) : null}
              </div>
            ) : usesAdoFallback ? (
              <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3">
                <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                  <AlertCircle className="h-4 w-4 text-amber-500" />
                  Using Azure DevOps fallback
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  No repo tool is configured for this ADO project, so testing
                  artifacts will use the native Azure DevOps project repo.
                </p>
              </div>
            ) : (
              <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3">
                <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                  <AlertCircle className="h-4 w-4 text-destructive" />
                  Repo tool required
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  This Jira project has no repo tool configured. Configure a repo
                  integration in the project or organization setup before saving
                  or reading testing artifacts.
                </p>
              </div>
            )}

            {hasConfiguredRepoTool && currentRepoId && !shouldShowRepoEditor ? (
              <div className="space-y-3 rounded-md border border-border bg-card p-3">
                <div className="space-y-1">
                  <Label>Configured repository</Label>
                  <Input value={currentRepoName || currentRepoId} readOnly />
                  <p className="text-xs text-muted-foreground">
                    This repository will be used for testing artifacts.
                  </p>
                </div>
                <div className="flex justify-end">
                  {canEditConfiguredRepo ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setShowRepoEditor(true)}
                    >
                      Change repository
                    </Button>
                  ) : null}
                </div>
              </div>
            ) : null}

            {hasConfiguredRepoTool && shouldShowRepoEditor ? (
              <div className="space-y-3 rounded-md border border-border bg-card p-3">
                <div className="space-y-1">
                  <Label>Repository selection</Label>
                  <p className="text-xs text-muted-foreground">
                    {providerSource === "org_default" || providerSource === "fallback"
                      ? "Saving here creates a project-level repo override and keeps the organization default unchanged."
                      : "Save a project-level repo target for testing artifacts."}
                  </p>
                </div>
                <RepoToolConfigurator
                  toolCatalogId={toolCatalogId}
                  providerKey={providerKey}
                  providerLabel={providerLabel}
                  values={repoValues}
                  onValuesChange={(updater) => {
                    setRepoValues((prev) => updater(prev));
                  }}
                />
              </div>
            ) : null}

            {!blocksForMissingRepoTool ? (
              <div className="space-y-2">
                <Label htmlFor="testing-branch">Branch</Label>
                <Input
                  id="testing-branch"
                  value={branch}
                  onChange={(event) => setBranch(event.target.value)}
                  placeholder="main"
                />
                <p className="text-xs text-muted-foreground">
                  Optional testing branch preference used for manual test case and
                  BDD artifact pushes.
                </p>
              </div>
            ) : null}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {blocksForMissingRepoTool ? "Close" : "Cancel"}
          </Button>
          {!blocksForMissingRepoTool ? (
            <Button
              onClick={handleSave}
              disabled={
                isLoadingGitConfig ||
                isLoadingRepoIntegration ||
                saving ||
                (hasConfiguredRepoTool && !currentRepoId)
              }
            >
              {saving ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Saving...
                </>
              ) : (
                "Save"
              )}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
