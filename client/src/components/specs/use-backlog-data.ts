import { useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useDebounce } from "@/hooks/use-debounce";
import { useJiraOnlyWorkItems } from "@/hooks/use-hosting-config";
import { useToast } from "@/hooks/use-toast";
import { getApiUrl } from "@/lib/api-config";
import type { ADOProject, BacklogContextResponse, EpicNode, FeatureNode, UserStoryNode } from "./types";
import type { SpecsGitProviderKey } from "./utils";

interface UseBacklogDataParams {
  projectId: string;
  adoProject?: ADOProject;
  open: boolean;
  isPushDialogOpen: boolean;
  selectedIterationPath: string;
  artifactSearchQuery: string;
  artifactGeneratedFilter: "all" | "generated" | "not-generated";
  generatedFeatureIds: Set<number>;
  pushRepoId: string;
  setPushRepoId: (id: string) => void;
  pushBranch: string;
  setPushBranch: (branch: string) => void;
  integrationType?: string;
}

const PROJECT_GIT_PROVIDERS = new Set(["gitlab", "github", "bitbucket", "azure_repos"]);

export function useBacklogData({
  projectId,
  adoProject,
  open,
  isPushDialogOpen,
  selectedIterationPath,
  artifactSearchQuery,
  artifactGeneratedFilter,
  generatedFeatureIds,
  pushRepoId,
  setPushRepoId,
  pushBranch,
  setPushBranch,
  integrationType,
}: UseBacklogDataParams) {
  const { toast } = useToast();
  const jiraOnlyHosting = useJiraOnlyWorkItems();
  const isJiraProject = integrationType === "jira" || adoProject?.integrationType === "jira";

  const { data: effectiveIntegrations } = useQuery<{
    integrations?: Array<{ categoryKey: string; providerKey?: string | null }>;
  }>({
    queryKey: ["/api/projects", projectId, "integration-effective"],
    queryFn: async () => {
      const res = await fetch(getApiUrl(`/api/projects/${projectId}/integration-effective`), {
        credentials: "include",
      });
      if (!res.ok) return { integrations: [] };
      return res.json();
    },
    enabled: (open || isPushDialogOpen) && !!projectId,
    staleTime: 60 * 1000,
  });

  const repoProviderKey = (
    effectiveIntegrations?.integrations?.find((i) => i.categoryKey === "repo")?.providerKey || ""
  ).toLowerCase();

  const specsGitProvider: SpecsGitProviderKey = PROJECT_GIT_PROVIDERS.has(repoProviderKey)
    ? (repoProviderKey as SpecsGitProviderKey)
    : isJiraProject && jiraOnlyHosting
      ? "github-tenant"
      : repoProviderKey === ""
        ? null
        : null;

  const usesProjectGitIntegration =
    specsGitProvider === "gitlab" ||
    specsGitProvider === "github" ||
    specsGitProvider === "bitbucket";

  const usesAdoGitIntegration = specsGitProvider === "azure_repos";

  /** Generic git push (project tool or legacy tenant GitHub), not ADO-native push. */
  const usesGenericGitPush =
    usesProjectGitIntegration || specsGitProvider === "github-tenant";

  const usesAdoPush =
    usesAdoGitIntegration ||
    (!usesGenericGitPush && !isJiraProject && !!adoProject?.organization);

  // Build shared query string for ADO project params
  const queryString = useMemo(() => {
    if (isJiraProject) return "";
    const p = new URLSearchParams();
    if (adoProject?.organization) p.append("organization", adoProject.organization);
    if (adoProject?.name) p.append("projectName", adoProject.name);
    return p.toString();
  }, [adoProject?.organization, adoProject?.name, isJiraProject]);

  // ── Repositories (project Git tool: GitLab / GitHub / Bitbucket / Azure Repos) ──
  const {
    data: projectGitReposData,
    isLoading: isLoadingProjectGitRepos,
    error: projectGitReposError,
  } = useQuery<any[]>({
    queryKey: ["/api/sdlc/projects", projectId, "specs/git-repositories", repoProviderKey],
    queryFn: async () => {
      const url = getApiUrl(`/api/sdlc/projects/${projectId}/specs/git-repositories`);
      const response = await fetch(url, { credentials: "include" });
      if (!response.ok) {
        let message = "Failed to fetch repositories for this project";
        try {
          const body = await response.json();
          message = body.error || body.message || message;
        } catch {
          const text = await response.text();
          if (text) message = text;
        }
        throw new Error(message);
      }
      const json = await response.json();
      const repos = Array.isArray(json.repositories) ? json.repositories : [];
      return repos.map((r: any) => ({
        id: String(r.id),
        name: r.name,
        defaultBranch: r.defaultBranch || r.default_branch || "main",
        provider: repoProviderKey,
      }));
    },
    enabled:
      (open || isPushDialogOpen) &&
      !!projectId &&
      (usesProjectGitIntegration || usesAdoGitIntegration),
    staleTime: 2 * 60 * 1000,
  });

  // ── Repositories (ADO — legacy path when not using project git tool) ────────
  const {
    data: adoReposData,
    isLoading: isLoadingAdoRepos,
    error: adoReposError,
  } = useQuery<any[]>({
    queryKey: [
      "/api/sdlc/projects",
      projectId,
      "ado",
      "repositories",
      adoProject?.organization,
      adoProject?.name,
    ],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (adoProject?.organization) params.append("organization", adoProject.organization);
      if (adoProject?.name) params.append("projectName", adoProject.name);
      const url = getApiUrl(
        `/api/sdlc/projects/${projectId}/ado/repositories${params.toString() ? `?${params.toString()}` : ""}`,
      );
      const response = await fetch(url, { credentials: "include" });
      if (!response.ok) {
        const text = await response.text();
        throw new Error(text || "Failed to fetch Azure DevOps repositories for this project. Check ADO settings.");
      }
      const json = await response.json();
      if (Array.isArray(json)) return json;
      if (json && Array.isArray((json as any).repositories)) return (json as any).repositories;
      return [];
    },
    enabled:
      (open || isPushDialogOpen) &&
      !!projectId &&
      usesAdoPush &&
      !usesProjectGitIntegration &&
      !usesAdoGitIntegration,
    staleTime: 5 * 60 * 1000,
  });

  // ── Repositories (tenant GitHub — legacy Jira-only fallback) ──────────────
  const {
    data: githubReposData,
    isLoading: isLoadingGithubRepos,
    error: githubReposError,
  } = useQuery<any[]>({
    queryKey: ["/api/github/repositories", "specs-tenant-fallback"],
    queryFn: async () => {
      const url = getApiUrl("/api/github/repositories");
      const response = await fetch(url, { credentials: "include" });
      if (!response.ok) {
        let message = "Failed to fetch GitHub repositories";
        try {
          const body = await response.json();
          message = body.details || body.error || message;
        } catch {
          const text = await response.text();
          if (text) message = text;
        }
        throw new Error(message);
      }
      const json = await response.json();
      const repos: any[] = Array.isArray(json) ? json : ((json as any).repositories ?? []);
      return repos.map((r: any) => ({
        id: String(r.id),
        name: r.name,
        defaultBranch: r.defaultBranch || r.default_branch || "main",
        provider: "github",
      }));
    },
    enabled:
      (open || isPushDialogOpen) &&
      !!projectId &&
      specsGitProvider === "github-tenant",
    staleTime: 0,
    refetchOnMount: true,
  });

  const adoRepos = usesProjectGitIntegration || usesAdoGitIntegration
    ? (projectGitReposData ?? [])
    : specsGitProvider === "github-tenant"
      ? (githubReposData ?? [])
      : (adoReposData ?? []);

  const isLoadingRepos =
    usesProjectGitIntegration || usesAdoGitIntegration
      ? isLoadingProjectGitRepos
      : specsGitProvider === "github-tenant"
        ? isLoadingGithubRepos
        : isLoadingAdoRepos;

  const reposError =
    usesProjectGitIntegration || usesAdoGitIntegration
      ? (projectGitReposError as Error | null)
      : specsGitProvider === "github-tenant"
        ? (githubReposError as Error | null)
        : (adoReposError as Error | null);

  // Auto-select first repo when push dialog opens
  useEffect(() => {
    if (!isPushDialogOpen || adoRepos.length === 0 || pushRepoId) return;
    if (adoRepos[0]?.id) setPushRepoId(adoRepos[0].id);
  }, [isPushDialogOpen, adoRepos, pushRepoId, setPushRepoId]);

  // ── Branches (project git — GitLab / GitHub / Bitbucket / Azure Repos) ─────
  const {
    data: projectGitBranchesData,
    isLoading: isLoadingProjectGitBranches,
    error: projectGitBranchesError,
  } = useQuery<any[]>({
    queryKey: [
      "/api/sdlc/projects",
      projectId,
      "specs",
      "branches",
      "project-git",
      pushRepoId,
    ],
    queryFn: async () => {
      const p = new URLSearchParams();
      p.append("repositoryId", pushRepoId);
      const url = getApiUrl(`/api/sdlc/projects/${projectId}/specs/branches?${p.toString()}`);
      const response = await fetch(url, { credentials: "include" });
      const json = await response.json();
      if (!response.ok) {
        throw new Error(json?.error || "Failed to load branches for this repository.");
      }
      return json.branches || [];
    },
    enabled:
      isPushDialogOpen &&
      !!pushRepoId &&
      !!projectId &&
      (usesProjectGitIntegration || usesAdoGitIntegration),
    staleTime: 2 * 60 * 1000,
  });

  // ── Branches (ADO legacy) ─────────────────────────────────────────────────
  const { data: branchesData, isLoading: isLoadingAdoBranches } = useQuery<any[]>({
    queryKey: [
      "/api/sdlc/projects",
      projectId,
      "specs",
      "branches",
      "ado",
      pushRepoId,
      adoProject?.organization,
      adoProject?.name,
    ],
    queryFn: async () => {
      const p = new URLSearchParams();
      p.append("repositoryId", pushRepoId);
      if (adoProject?.organization) p.append("organization", adoProject.organization);
      if (adoProject?.name) p.append("projectName", adoProject.name);
      const url = getApiUrl(`/api/sdlc/projects/${projectId}/specs/branches?${p.toString()}`);
      const response = await fetch(url, { credentials: "include" });
      if (!response.ok) return [];
      const json = await response.json();
      return json.branches || [];
    },
    enabled:
      isPushDialogOpen &&
      !!pushRepoId &&
      !!adoProject?.organization &&
      usesAdoPush &&
      !usesProjectGitIntegration &&
      !usesAdoGitIntegration,
    staleTime: 5 * 60 * 1000,
  });

  // Tenant GitHub fallback: default branch only
  const githubBranches = useMemo(() => {
    if (specsGitProvider !== "github-tenant" || !pushRepoId) return [];
    const repo = adoRepos.find((r: any) => String(r.id) === String(pushRepoId));
    if (!repo) return [];
    const def = repo.defaultBranch || "main";
    return [{ name: def }, { name: def === "main" ? "master" : "main" }].filter(
      (b, i, arr) => arr.findIndex((x) => x.name === b.name) === i,
    );
  }, [specsGitProvider, pushRepoId, adoRepos]);

  const adoBranches =
    usesProjectGitIntegration || usesAdoGitIntegration
      ? (projectGitBranchesData ?? [])
      : specsGitProvider === "github-tenant"
        ? githubBranches
        : (branchesData ?? []);

  const isLoadingBranches =
    usesProjectGitIntegration || usesAdoGitIntegration
      ? isLoadingProjectGitBranches
      : specsGitProvider === "github-tenant"
        ? false
        : isLoadingAdoBranches;

  // Auto-select default branch when branches load
  useEffect(() => {
    if (!adoBranches.length || pushBranch) return;
    const defaultBranch =
      adoBranches.find((b: any) => b.name === "main") ||
      adoBranches.find((b: any) => b.name === "master") ||
      adoBranches[0];
    if (defaultBranch) setPushBranch(defaultBranch.name);
  }, [adoBranches, pushBranch, setPushBranch]);

  // ── Iterations ────────────────────────────────────────────────────────────
  const { data: iterationsData = [] } = useQuery<Array<{ id: string; name: string; path: string }>>({
    queryKey: [
      "/api/sdlc/projects",
      projectId,
      isJiraProject ? "jira/sprints" : "ado/sprints",
      adoProject?.organization,
      adoProject?.name,
    ],
    queryFn: async () => {
      const url = isJiraProject
        ? getApiUrl(`/api/jira/sprints/${projectId}`)
        : getApiUrl(`/api/sdlc/projects/${projectId}/ado/sprints${queryString ? `?${queryString}` : ""}`);

      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) return [];
      const json = await res.json();

      if (isJiraProject) {
        const sprints = Array.isArray(json) ? json : (json.sprints || []);
        return sprints.map((s: any) => ({
          id: String(s.id),
          name: s.name,
          path: String(s.id),
        }));
      }

      return Array.isArray(json) ? json : [];
    },
    enabled: open && !!projectId && !!adoProject?.organization && !!adoProject?.name && !isJiraProject,
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  });

  // ── Backlog context ───────────────────────────────────────────────────────
  const {
    data: backlogData,
    isLoading,
    error,
    refetch,
  } = useQuery<BacklogContextResponse | null>({
    queryKey: [
      "/api/sdlc/projects",
      projectId,
      isJiraProject ? "jira/backlog-context" : "ado/backlog-context",
      adoProject?.organization,
      adoProject?.name,
      "specs",
      selectedIterationPath,
    ],
    queryFn: async () => {
      if (isJiraProject) {
        const url = getApiUrl(`/api/sdlc/projects/${projectId}/jira/backlog-context`);
        const res = await fetch(url, { credentials: "include" });
        if (!res.ok) {
          const text = await res.text();
          throw new Error(text || `Failed to fetch Jira backlog context (${res.status})`);
        }
        return res.json();
      }

      const searchParams = new URLSearchParams();
      if (adoProject?.organization) searchParams.set("organization", adoProject.organization);
      if (adoProject?.name) searchParams.set("projectName", adoProject.name);
      if (selectedIterationPath) searchParams.set("iterationPath", selectedIterationPath);
      const backlogUrl = getApiUrl(
        `/api/sdlc/projects/${projectId}/ado/backlog-context?${searchParams.toString()}`,
      );

      const res = await fetch(backlogUrl, { credentials: "include" });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `Failed to fetch backlog context (${res.status})`);
      }
      const text = await res.text();
      if (text.trim().startsWith("<!DOCTYPE") || text.trim().startsWith("<html")) {
        throw new Error("Server returned an HTML error page. Please check if the backend API is accessible.");
      }
      return JSON.parse(text);
    },
    enabled: open && !!projectId,
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
    retry: 1,
  });

  useEffect(() => {
    if (error) {
      toast({
        title: "Error loading work items",
        description: error instanceof Error ? error.message : "Failed to fetch backlog context",
        variant: "destructive",
      });
    }
  }, [error, toast]);

  // ── Feature hierarchy ─────────────────────────────────────────────────────
  const { featureNodes, orphanUserStories, epicNodes } = useMemo(() => {
    if (!backlogData?.artifactsByState) {
      return {
        featureNodes: [] as FeatureNode[],
        orphanUserStories: [] as UserStoryNode[],
        epicNodes: [] as EpicNode[],
      };
    }

    const featureMap = new Map<number, Omit<FeatureNode, "userStories">>();
    const featureExternalIdMap = new Map<string, number>();
    const storiesByFeatureId = new Map<number, UserStoryNode[]>();
    const orphanStories: UserStoryNode[] = [];
    const epicMap = new Map<number, Omit<EpicNode, "childFeatureIds">>();
    const epicExternalIdMap = new Map<string, number>();
    const featuresByEpicId = new Map<number, number[]>();
    const featureParentEpicId = new Map<number, number>();

    const resolveParentNumericId = (
      parentIdRaw: unknown,
      externalLookup: Map<string, number>,
      relations: any,
    ): number | null => {
      let parentId: number | null = null;

      if (parentIdRaw !== null && parentIdRaw !== undefined) {
        if (typeof parentIdRaw === "number") {
          parentId = parentIdRaw;
        } else if (typeof parentIdRaw === "string") {
          const parsed = parseInt(parentIdRaw, 10);
          if (!Number.isNaN(parsed)) {
            parentId = parsed;
          } else {
            parentId = externalLookup.get(parentIdRaw) ?? null;
          }
        }
      }

      if ((!parentId || Number.isNaN(parentId)) && Array.isArray(relations)) {
        const parentRelation = relations.find(
          (rel: any) => rel.rel === "System.LinkTypes.Hierarchy-Reverse",
        );
        if (parentRelation?.url) {
          const patterns = [
            /\/workitems\/(\d+)/,
            /workitems\/(\d+)/,
            /\/_apis\/wit\/workitems\/(\d+)/,
            /workitems\/(\d+)(?:\?|$)/,
          ];
          for (const pattern of patterns) {
            const match = parentRelation.url.match(pattern);
            if (match) {
              const parsed = parseInt(match[1], 10);
              if (!Number.isNaN(parsed)) {
                parentId = parsed;
                break;
              }
            }
          }
          if (!parentId || Number.isNaN(parentId)) {
            const urlParts = parentRelation.url.split("/");
            const parsed = parseInt(urlParts[urlParts.length - 1].split("?")[0], 10);
            if (!Number.isNaN(parsed)) parentId = parsed;
          }
        }
      }

      return parentId && !Number.isNaN(parentId) ? parentId : null;
    };

    const resolveStoryParentFeatureId = (story: any): number | null => {
      const fromParent = resolveParentNumericId(story.parentId, featureExternalIdMap, story.relations);
      if (fromParent && featureMap.has(fromParent)) {
        return fromParent;
      }

      const labels = Array.isArray(story.labels) ? story.labels : [];
      for (const label of labels) {
        const match = String(label).match(/^devx-feature-(.+)$/i);
        if (!match) continue;
        const linkedFeatureId = featureExternalIdMap.get(match[1]);
        if (linkedFeatureId && featureMap.has(linkedFeatureId)) {
          return linkedFeatureId;
        }
      }

      const relations = Array.isArray(story.relations) ? story.relations : [];
      for (const relation of relations) {
        const candidates = [relation?.outwardIssue, relation?.inwardIssue].filter(Boolean);
        for (const candidate of candidates) {
          const candidateKey = candidate?.key;
          if (!candidateKey) continue;
          const linkedFeatureId = featureExternalIdMap.get(String(candidateKey));
          if (linkedFeatureId && featureMap.has(linkedFeatureId)) {
            return linkedFeatureId;
          }
        }
      }

      return null;
    };

    Object.values(backlogData.artifactsByState).forEach(({ epics }) => {
      (epics || []).forEach((e: any) => {
        const id = typeof e.id === "string" ? parseInt(e.id, 10) : (e.id as number);
        if (!id || Number.isNaN(id)) return;
        if (!epicMap.has(id)) {
          epicMap.set(id, {
            id,
            title: e.title || e.fields?.["System.Title"] || `Epic ${id}`,
            state: e.state || e.fields?.["System.State"] || "Unknown",
            description: e.description || e.fields?.["System.Description"] || "",
            workItemUrl: e.url,
          });
          if (e.externalId) {
            epicExternalIdMap.set(e.externalId, id);
          }
          if (e.rawId) {
            epicExternalIdMap.set(String(e.rawId), id);
          }
          epicExternalIdMap.set(String(id), id);
        }
      });
    });

    Object.values(backlogData.artifactsByState).forEach(({ features, userStories }) => {
      features.forEach((f: any) => {
        const id = typeof f.id === "string" ? parseInt(f.id, 10) : (f.id as number);
        if (!id || Number.isNaN(id)) return;
        if (!featureMap.has(id)) {
          featureMap.set(id, {
            id,
            title: f.title || f.fields?.["System.Title"] || `Feature ${id}`,
            state: f.state || f.fields?.["System.State"] || "Unknown",
            description: f.description || f.fields?.["System.Description"] || "",
            workItemUrl: f.url,
          });
          if (f.externalId) {
            featureExternalIdMap.set(f.externalId, id);
          }
          if (f.rawId) {
            featureExternalIdMap.set(String(f.rawId), id);
          }
          featureExternalIdMap.set(String(id), id);

          const epicId = resolveParentNumericId(f.parentId, epicExternalIdMap, f.relations);
          if (epicId && epicMap.has(epicId)) {
            featureParentEpicId.set(id, epicId);
            if (!featuresByEpicId.has(epicId)) featuresByEpicId.set(epicId, []);
            featuresByEpicId.get(epicId)!.push(id);
          }
        }
      });

      userStories.forEach((s: any) => {
        const storyId = typeof s.id === "string" ? parseInt(s.id, 10) : (s.id as number);
        if (!storyId || Number.isNaN(storyId)) return;

        const parentId = resolveStoryParentFeatureId(s);

        const storyNode: UserStoryNode = {
          id: storyId,
          title: s.title || s.fields?.["System.Title"] || `User Story ${storyId}`,
          state: s.state || s.fields?.["System.State"] || "Unknown",
          description: s.description || s.fields?.["System.Description"] || "",
          acceptanceCriteria: s.acceptanceCriteria || s.fields?.["Microsoft.VSTS.Common.AcceptanceCriteria"] || "",
          storyPoints: s.storyPoints || s.fields?.["Microsoft.VSTS.Scheduling.StoryPoints"] || null,
          workItemUrl: s.url,
        };

        if (parentId && !Number.isNaN(parentId) && featureMap.has(parentId)) {
          if (!storiesByFeatureId.has(parentId)) storiesByFeatureId.set(parentId, []);
          storiesByFeatureId.get(parentId)!.push(storyNode);
        } else {
          orphanStories.push(storyNode);
        }
      });
    });

    let nodes: FeatureNode[] = Array.from(featureMap.values()).map((feature) => ({
      ...feature,
      parentEpicId: featureParentEpicId.get(feature.id),
      userStories: storiesByFeatureId.get(feature.id) || [],
    }));
    nodes.sort((a, b) => a.id - b.id);

    const epicNodesResolved: EpicNode[] = Array.from(epicMap.values())
      .map((epic) => ({
        ...epic,
        childFeatureIds: (featuresByEpicId.get(epic.id) || []).slice().sort((a, b) => a - b),
      }))
      .sort((a, b) => a.id - b.id);

    if (isJiraProject && epicNodesResolved.length > 0) {
      nodes = nodes.filter((feature) => !!feature.parentEpicId);
      return { featureNodes: nodes, orphanUserStories: [] as UserStoryNode[], epicNodes: epicNodesResolved };
    }

    return { featureNodes: nodes, orphanUserStories: orphanStories, epicNodes: epicNodesResolved };
  }, [backlogData, isJiraProject]);

  const artifactSearchDebounced = useDebounce(artifactSearchQuery, 280);

  const { filteredFeatureNodes, filteredOrphanUserStories } = useMemo(() => {
    const q = artifactSearchDebounced.trim().toLowerCase();
    const match = (text: string) => !q || (text || "").toLowerCase().includes(q);

    let features = featureNodes;
    let orphans = orphanUserStories;

    if (q) {
      features = features
        .filter((f) => match(f.title) || f.userStories.some((s) => match(s.title)))
        .map((f) => ({ ...f, userStories: f.userStories.filter((s) => match(f.title) || match(s.title)) }));
      orphans = orphans.filter((s) => match(s.title));
    }

    if (artifactGeneratedFilter === "generated") {
      features = features.filter((f) => generatedFeatureIds.has(f.id));
      orphans = orphans.filter((s) => generatedFeatureIds.has(-s.id));
    } else if (artifactGeneratedFilter === "not-generated") {
      features = features.filter((f) => !generatedFeatureIds.has(f.id));
      orphans = orphans.filter((s) => !generatedFeatureIds.has(-s.id));
    }

    return { filteredFeatureNodes: features, filteredOrphanUserStories: orphans };
  }, [featureNodes, orphanUserStories, artifactSearchDebounced, artifactGeneratedFilter, generatedFeatureIds]);

  const allFeatureIds = useMemo(
    () => filteredFeatureNodes.map((f) => f.id),
    [filteredFeatureNodes],
  );

  return {
    adoRepos,
    isLoadingRepos,
    reposError,
    adoBranches,
    isLoadingBranches,
    branchesError:
      usesProjectGitIntegration || usesAdoGitIntegration
        ? (projectGitBranchesError as Error | null)
        : null,
    iterationsData,
    backlogData,
    isLoading,
    error,
    refetch,
    queryString,
    featureNodes,
    orphanUserStories,
    epicNodes,
    filteredFeatureNodes,
    filteredOrphanUserStories,
    allFeatureIds,
    specsGitProvider,
    usesGenericGitPush,
    usesAdoPush,
    isJiraProject,
  };
}
