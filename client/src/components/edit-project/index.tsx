import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Check,
  CheckCircle2,
  ChevronsUpDown,
  Edit,
  KeyRound,
  Loader2,
  XCircle,
} from "lucide-react";
import { GenericModal } from "@/components/ui/generic-modal";
import { WizardProgress } from "@/components/ui/wizard-progress";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { GoldenRepoGuidelineSelector } from "@/components/golden-repo-guideline-selector";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { getApiUrl } from "@/lib/api-config";
import { cn } from "@/lib/utils";
import {
  extractGoldenRepositories,
  GOLDEN_REPOSITORIES_QUERY_KEY,
  type GoldenRepositoriesResponse,
} from "@/lib/golden-repositories";
import { useToast } from "@/hooks/use-toast";
import type { GoldenRepository, SDLCProject } from "@shared/schema";
import { useGoldenRepoSelection } from "@/contexts/golden-repo-selection-context";
import { CreateProjectToolConfigurationStep } from "@/components/create-project/tool-configuration-step";
import { applyProjectIntegrationConfigs } from "@/components/create-project/apply-project-integrations";
import { ToolIntegrationsReviewBlock } from "@/components/create-project/tool-integrations-review-block";
import type {
  CatalogToolItem,
  OrgIntegrationConfigRow,
  TestStatus,
  ToolConfigState,
} from "@/components/create-project/types";
import {
  buildOrgConfigByCategory,
  groupToolCatalogByCategory,
  isProjectToolStepComplete,
} from "@/components/create-project/utils";
import {
  EDIT_PROJECT_STEP_SHORT,
  EDIT_PROJECT_WIZARD_STEP_COPY,
  EDIT_PROJECT_WIZARD_STEPS,
} from "./constants";
import { getOrgIdForIntegration } from "@shared/integration-config";
import { useMe } from "@/hooks/use-me";

export interface EditProjectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialStep?: number;
  attentionMessage?: string | null;
  credentialOnlyMode?: boolean;
  project: {
    id: string;
    name: string;
    description: string;
    organization: string;
    organizationUrl: string;
    sdlcProject?: SDLCProject | null;
    integrationType?: string;
    jiraProjectKey?: string;
    jiraConnectionId?: string;
    jiraInstanceUrl?: string;
    ownerUserId?: string | null;
    ownerInfo?: {
      id: string;
      email?: string | null;
      displayName?: string | null;
    } | null;
    projectManagementPatConfigured?: boolean;
    repoPatRequired?: boolean;
    repoPatConfigured?: boolean;
    userJiraPatConfigured?: boolean;
    userGitlabPatConfigured?: boolean;
    userPatConfigured?: boolean;
    repoIntegrationConfig?: {
      providerKey?: string | null;
      displayName?: string | null;
      baseUrl?: string | null;
      repositoryId?: string | null;
      repositoryName?: string | null;
    } | null;
    credentialStatus?: {
      jira?: { required?: boolean; configured?: boolean };
      repo?: { required?: boolean; configured?: boolean };
      readyForUser?: boolean;
    };
  };
  onProjectUpdated: (updatedProject?: {
    id: string;
    name: string;
    description: string;
  }) => void;
}

const LAST_STEP = EDIT_PROJECT_WIZARD_STEPS.length - 1;
const MAX_VISIBLE_GOLDEN_REPOS = 75;

function inferRepositoryProvider(project: EditProjectDialogProps["project"]): string | null {
  const explicitProvider =
    project.repoIntegrationConfig?.providerKey?.trim() ||
    project.sdlcProject?.goldenRepoReference?.provider;
  if (explicitProvider) return explicitProvider;

  const hasMappedRepo = Boolean(
    project.repoIntegrationConfig?.repositoryId ||
      project.repoIntegrationConfig?.repositoryName ||
      project.sdlcProject?.repository_id ||
      project.sdlcProject?.linkedGoldenRepoName ||
      project.sdlcProject?.linkedGoldenRepoProject ||
      project.sdlcProject?.goldenRepoReference,
  );
  if (!hasMappedRepo) return null;

  const providerHint = `${project.repoIntegrationConfig?.displayName || ""} ${project.repoIntegrationConfig?.baseUrl || ""}`.toLowerCase();
  if (providerHint.includes("gitlab")) return "gitlab";
  if (providerHint.includes("github")) return "github";
  if (providerHint.includes("bitbucket")) return "bitbucket";
  if (providerHint.includes("azure") || providerHint.includes("dev.azure.com")) return "azure_repos";
  return "gitlab";
}

export function EditProjectDialog({
  open,
  onOpenChange,
  initialStep = 0,
  attentionMessage,
  credentialOnlyMode = false,
  project,
  onProjectUpdated,
}: EditProjectDialogProps) {
  const { toast } = useToast();
  const { data: me } = useMe();
  const [step, setStep] = useState(0);

  // ── Details ─────────────────────────────────────────────────────────────
  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description || "");
  const [jiraProjectKey, setJiraProjectKey] = useState(
    project.jiraProjectKey || project.sdlcProject?.jiraProjectKey || "",
  );
  // ── Golden repo ──────────────────────────────────────────────────────────
  const [repositoryId, setRepositoryId] = useState<string | null>(
    project.sdlcProject?.repository_id || null,
  );
  const [linkedGoldenRepoOrg, setLinkedGoldenRepoOrg] = useState<string | null>(
    project.sdlcProject?.linkedGoldenRepoOrg || null,
  );
  const [linkedGoldenRepoProject, setLinkedGoldenRepoProject] = useState<string | null>(
    project.sdlcProject?.linkedGoldenRepoProject || null,
  );
  const [linkedGoldenRepoName, setLinkedGoldenRepoName] = useState<string | null>(
    project.sdlcProject?.linkedGoldenRepoName || null,
  );
  const [goldenFileMode, setGoldenFileMode] = useState<"all" | "custom">(
    project.sdlcProject?.goldenRepoReference?.filePaths?.length ? "custom" : "all",
  );
  const [isGuidelineSelectorOpen, setIsGuidelineSelectorOpen] = useState(false);
  const [goldenRepoComboboxOpen, setGoldenRepoComboboxOpen] = useState(false);
  const [goldenRepoSearch, setGoldenRepoSearch] = useState("");
  const deferredGoldenRepoSearch = useDeferredValue(goldenRepoSearch);

  // ── Tool config ──────────────────────────────────────────────────────────
  const [isLoading, setIsLoading] = useState(false);
  const [toolConfigs, setToolConfigs] = useState<Record<string, ToolConfigState>>({});
  const [skippedCategories, setSkippedCategories] = useState<Record<string, boolean>>({});
  const [inheritFromOrg, setInheritFromOrg] = useState<Record<string, boolean>>({});
  const [toolTestStatus, setToolTestStatus] = useState<Record<string, TestStatus>>({});
  const [toolTestMessage, setToolTestMessage] = useState<Record<string, string>>({});
  const [personalJiraEmail, setPersonalJiraEmail] = useState("");
  const [personalJiraApiToken, setPersonalJiraApiToken] = useState("");
  const [personalGitlabToken, setPersonalGitlabToken] = useState("");
  const [replaceJiraCredential, setReplaceJiraCredential] = useState(false);
  const [replaceRepoCredential, setReplaceRepoCredential] = useState(false);
  /** Saved project_integration_configs row id per category (for testing with stored secrets). */
  const [projectConfigIdsByCategory, setProjectConfigIdsByCategory] = useState<
    Record<string, string>
  >({});
  /** toolCatalogId on the saved row — must match current provider before reusing saved-row test. */
  const [projectSavedCatalogIdsByCategory, setProjectSavedCatalogIdsByCategory] =
    useState<Record<string, string>>({});

  const { getSelectedPaths, setSelection, clearRepo } = useGoldenRepoSelection();

  const integrationSaveRef = useRef({
    toolConfigs: {} as Record<string, ToolConfigState>,
    skippedCategories: {} as Record<string, boolean>,
    inheritFromOrg: {} as Record<string, boolean>,
    groupedCatalogKeys: [] as string[],
    orgByCategory: {} as Record<string, OrgIntegrationConfigRow | undefined>,
  });

  const jiraConnectionId = project.sdlcProject?.jiraConnectionId ?? project.jiraConnectionId ?? "";
  const jiraProjectKeyForDisplay = project.sdlcProject?.jiraProjectKey ?? project.jiraProjectKey;
  const jiraInstanceUrlForDisplay =
    project.sdlcProject?.jiraInstanceUrl || project.jiraInstanceUrl || project.organizationUrl;
  const sdlcInternalId = project.sdlcProject?.id;
  const { data: projectReadinessGate } = useQuery<{
    readyForUser: boolean;
    status: number;
    patStatus?: {
      credentialStatus?: {
        jira?: { required?: boolean; configured?: boolean };
        repo?: { required?: boolean; configured?: boolean };
        readyForUser?: boolean;
      };
      userPatConfigured?: boolean;
      projectUserPatConfigured?: boolean;
      repoPatConfigured?: boolean;
      userGitlabPatConfigured?: boolean;
      projectManagementPatConfigured?: boolean;
      userJiraPatConfigured?: boolean;
    };
  }>({
    queryKey: ["/api/sdlc/projects", sdlcInternalId, "readiness-gate"],
    queryFn: async () => {
      const response = await fetch(
        getApiUrl(`/api/sdlc/projects/${sdlcInternalId}/details`),
        { credentials: "include" },
      );
      if (response.ok) {
        return { readyForUser: true, status: response.status };
      }
      const body = await response.json().catch(() => ({}));
      return {
        readyForUser: false,
        status: response.status,
        patStatus: body,
      };
    },
    enabled: open && credentialOnlyMode && Boolean(sdlcInternalId),
    staleTime: 0,
    refetchOnMount: "always",
  });

  const orgIdForIntegrations = getOrgIdForIntegration(
    "jira",
    { jiraConnectionId },
    "",
  );

  // ── Queries ──────────────────────────────────────────────────────────────
  const { data: jiraConnectionsData } = useQuery<{
    connections: Array<{ id: string; name?: string; instanceUrl?: string; email?: string | null }>;
  }>({
    queryKey: ["/api/jira/connections"],
    queryFn: async () =>
      (await fetch(getApiUrl("/api/jira/connections"), { credentials: "include" })).json(),
    enabled: open,
  });

  const {
    data: goldenReposData,
    isLoading: goldenReposLoading,
    error: goldenReposError,
  } = useQuery<
    GoldenRepositoriesResponse | GoldenRepository[]
  >({
    queryKey: GOLDEN_REPOSITORIES_QUERY_KEY,
    enabled: open,
    staleTime: 60 * 1000,
  });

  const repositories = useMemo(
    () => extractGoldenRepositories(goldenReposData),
    [goldenReposData],
  );

  const { data: catalogResponse } = useQuery<{ tools: CatalogToolItem[] }>({
    queryKey: ["/api/tool-catalog"],
    enabled: open,
  });

  // Saved project integration configs for pre-populating the tool step
  const { data: savedIntegrationConfigs } = useQuery<{
    configs: Array<{
      id: string;
      categoryKey: string;
      skipped?: boolean;
      useOrgDefault: boolean;
      orgIntegrationConfigId: string | null;
      toolCatalogId: string | null;
      providerKey: string | null;
      displayName: string | null;
      configDisplay: Record<string, string>;
      lastTestStatus: string | null;
      lastTestMessage: string | null;
    }>;
  }>({
    queryKey: ["/api/project-integration-configs", sdlcInternalId],
    queryFn: async () => {
      const response = await fetch(
        getApiUrl(`/api/project-integration-configs?projectId=${sdlcInternalId}`),
        { credentials: "include" },
      );
      if (!response.ok) throw new Error("Failed to fetch project integration configs");
      return response.json();
    },
    enabled: open && !!sdlcInternalId,
    staleTime: 0,
  });

  const { data: orgConfigsData, isLoading: orgConfigsLoading } = useQuery<{
    configs: OrgIntegrationConfigRow[];
  }>({
    queryKey: ["/api/org-integration-configs", "jira", orgIdForIntegrations],
    queryFn: async () => {
      const params = new URLSearchParams({ orgType: "jira", orgId: orgIdForIntegrations });
      const response = await fetch(
        getApiUrl(`/api/org-integration-configs?${params}`),
        { credentials: "include" },
      );
      const payload = await response.json();
      if (!response.ok)
        throw new Error(payload?.error || "Failed to load org integration defaults");
      return payload as { configs: OrgIntegrationConfigRow[] };
    },
    enabled: open && !!orgIdForIntegrations,
  });

  const groupedCatalog = useMemo(
    () => groupToolCatalogByCategory(catalogResponse?.tools || []),
    [catalogResponse?.tools],
  );
  const orgByCategory = useMemo(
    () => buildOrgConfigByCategory(orgConfigsData?.configs),
    [orgConfigsData?.configs],
  );

  // ── Sync ref ──────────────────────────────────────────────────────────────
  useEffect(() => {
    integrationSaveRef.current = {
      toolConfigs,
      skippedCategories,
      inheritFromOrg,
      groupedCatalogKeys: Object.keys(groupedCatalog),
      orgByCategory,
    };
  }, [toolConfigs, skippedCategories, inheritFromOrg, groupedCatalog, orgByCategory]);

  // ── Reset on open ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!open || !project) return;
    setStep(Math.min(Math.max(initialStep, 0), LAST_STEP));
    setName(project.name);
    setDescription(project.description || "");
    setJiraProjectKey(project.jiraProjectKey || project.sdlcProject?.jiraProjectKey || "");
    setRepositoryId(project.sdlcProject?.repository_id || null);
    setLinkedGoldenRepoOrg(project.sdlcProject?.linkedGoldenRepoOrg || null);
    setLinkedGoldenRepoProject(project.sdlcProject?.linkedGoldenRepoProject || null);
    setLinkedGoldenRepoName(project.sdlcProject?.linkedGoldenRepoName || null);
    setGoldenFileMode(
      project.sdlcProject?.goldenRepoReference?.filePaths?.length ? "custom" : "all",
    );
    setIsGuidelineSelectorOpen(false);
    setGoldenRepoComboboxOpen(false);
    setGoldenRepoSearch("");
    setToolConfigs({});
    setSkippedCategories({});
    setInheritFromOrg({});
    setToolTestStatus({});
    setToolTestMessage({});
    setPersonalJiraEmail("");
    setPersonalJiraApiToken("");
    setPersonalGitlabToken("");
    setReplaceJiraCredential(false);
    setReplaceRepoCredential(false);
    setProjectConfigIdsByCategory({});

    // Seed golden repo file selection context
    const ref = project.sdlcProject?.goldenRepoReference as
      | { repoId?: string; repoName?: string; filePaths?: string[] }
      | null
      | undefined;
    const refRepoId = ref?.repoId || project.sdlcProject?.repository_id || null;
    const refRepoName =
      ref?.repoName || project.sdlcProject?.linkedGoldenRepoName || "Golden Repo";
    const persistedPaths = Array.isArray(ref?.filePaths) ? ref!.filePaths : [];
    const normalized = persistedPaths
      .map((p) => String(p || "").replace(/\\/g, "/").replace(/^\/+/, ""))
      .filter(Boolean);

    if (refRepoId && normalized.length > 0) {
      setGoldenFileMode("custom");
      setSelection(refRepoName, refRepoId, normalized);
    } else {
      setGoldenFileMode("all");
      if (refRepoId) clearRepo(refRepoId);
    }
  }, [open, project, initialStep]);

  const selectGoldenRepo = (repoId: string | null) => {
    setRepositoryId(repoId);
    setGoldenFileMode("all");
    setGoldenRepoComboboxOpen(false);
    setGoldenRepoSearch("");

    if (repoId) {
      clearRepo(repoId);
    }

    const repo = (Array.isArray(repositories) ? repositories : []).find(
      (item) => String(item.id) === String(repoId),
    );
    if (repo) {
      setLinkedGoldenRepoOrg((repo as any).organization || null);
      setLinkedGoldenRepoProject((repo as any).project || null);
      setLinkedGoldenRepoName(repo.name || null);
      return;
    }

    setLinkedGoldenRepoOrg(null);
    setLinkedGoldenRepoProject(null);
    setLinkedGoldenRepoName(null);
  };

  // ── Seed tool configs from saved project integration configs ──────────────
  useEffect(() => {
    const saved = savedIntegrationConfigs?.configs;
    if (!saved || saved.length === 0 || Object.keys(groupedCatalog).length === 0) return;

    const nextToolConfigs: Record<string, ToolConfigState> = {};
    const nextInherit: Record<string, boolean> = {};
    const nextSkipped: Record<string, boolean> = {};
    const nextTestStatus: Record<string, TestStatus> = {};
    const nextTestMessage: Record<string, string> = {};
    const nextProjectConfigIds: Record<string, string> = {};
    const nextSavedCatalogIds: Record<string, string> = {};

    for (const row of saved) {
      const cat = row.categoryKey;
      if (row.skipped) {
        nextSkipped[cat] = true;
        continue;
      }
      if (row.useOrgDefault && row.orgIntegrationConfigId) {
        nextInherit[cat] = true;
      } else if (row.toolCatalogId) {
        nextProjectConfigIds[cat] = row.id;
        nextSavedCatalogIds[cat] = row.toolCatalogId;
        nextToolConfigs[cat] = {
          providerId: row.toolCatalogId,
          values: row.configDisplay || {},
        };
        // Treat a previously saved & tested config as already-verified so the
        // user can proceed without re-testing if credentials haven't changed.
        if (row.lastTestStatus === "success") {
          nextTestStatus[cat] = "success";
          nextTestMessage[cat] = row.lastTestMessage || "Connection successful";
        } else if (row.lastTestStatus === "error") {
          nextTestStatus[cat] = "error";
          nextTestMessage[cat] = row.lastTestMessage || "Previous test failed";
        }
      }
    }

    // Only seed once (don't override user edits that happened after dialog opened)
    setToolConfigs((prev) => ({ ...nextToolConfigs, ...prev }));
    setInheritFromOrg((prev) => ({ ...nextInherit, ...prev }));
    setSkippedCategories((prev) => ({ ...nextSkipped, ...prev }));
    setToolTestStatus((prev) => ({ ...nextTestStatus, ...prev }));
    setToolTestMessage((prev) => ({ ...nextTestMessage, ...prev }));
    setProjectConfigIdsByCategory((prev) => ({ ...nextProjectConfigIds, ...prev }));
    setProjectSavedCatalogIdsByCategory((prev) => ({
      ...nextSavedCatalogIds,
      ...prev,
    }));
  }, [savedIntegrationConfigs, groupedCatalog]);

  // ── Auto-inherit org defaults ─────────────────────────────────────────────
  useEffect(() => {
    const list = orgConfigsData?.configs;
    if (!list || Object.keys(groupedCatalog).length === 0) return;
    setInheritFromOrg((prev) => {
      const next: Record<string, boolean> = { ...prev };
      for (const cat of Object.keys(groupedCatalog)) {
        // Don't override a value already set from saved integration configs
        if (prev[cat] !== undefined) continue;
        const hasOrg = list.some((c) => c.categoryKey === cat);
        next[cat] = hasOrg;
      }
      return next;
    });
  }, [orgConfigsData, groupedCatalog]);

  // ── Mutations ────────────────────────────────────────────────────────────
  const catalogTestMutation = useMutation({
    mutationFn: async ({
      category,
      toolCatalogId,
      config,
    }: {
      category: string;
      toolCatalogId: string;
      config: Record<string, string>;
    }) => {
      setToolTestStatus((prev) => ({ ...prev, [category]: "testing" }));
      setToolTestMessage((prev) => ({ ...prev, [category]: "" }));
      const response = await fetch(getApiUrl(`/api/tool-catalog/${toolCatalogId}/test`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ config }),
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.message || result.error || "Connection test failed");
      return { category, result };
    },
    onSuccess: ({ category, result }) => {
      setToolTestStatus((prev) => ({ ...prev, [category]: "success" }));
      setToolTestMessage((prev) => ({
        ...prev,
        [category]: result?.message || "Connection successful",
      }));
    },
    onError: (error: Error, variables) => {
      setToolTestStatus((prev) => ({ ...prev, [variables.category]: "error" }));
      setToolTestMessage((prev) => ({ ...prev, [variables.category]: error.message }));
    },
  });

  const orgIntegrationTestMutation = useMutation({
    mutationFn: async ({
      category,
      orgIntegrationConfigId,
    }: {
      category: string;
      orgIntegrationConfigId: string;
    }) => {
      setToolTestStatus((prev) => ({ ...prev, [category]: "testing" }));
      setToolTestMessage((prev) => ({ ...prev, [category]: "" }));
      const response = await fetch(
        getApiUrl(`/api/org-integration-configs/${orgIntegrationConfigId}/test`),
        { method: "POST", credentials: "include" },
      );
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || "Connection test failed");
      return { category, result };
    },
    onSuccess: ({ category, result }) => {
      setToolTestStatus((prev) => ({ ...prev, [category]: "success" }));
      setToolTestMessage((prev) => ({
        ...prev,
        [category]: result?.message || "Connection successful",
      }));
    },
    onError: (error: Error, variables) => {
      setToolTestStatus((prev) => ({ ...prev, [variables.category]: "error" }));
      setToolTestMessage((prev) => ({ ...prev, [variables.category]: error.message }));
    },
  });

  const projectIntegrationTestMutation = useMutation({
    mutationFn: async ({
      category,
      projectIntegrationConfigId,
      config,
    }: {
      category: string;
      projectIntegrationConfigId: string;
      config: Record<string, string>;
    }) => {
      setToolTestStatus((prev) => ({ ...prev, [category]: "testing" }));
      setToolTestMessage((prev) => ({ ...prev, [category]: "" }));
      const response = await fetch(
        getApiUrl(`/api/project-integration-configs/${projectIntegrationConfigId}/test`),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ config }),
        },
      );
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.message || result.error || "Connection test failed");
      return { category, result };
    },
    onSuccess: ({ category, result }) => {
      setToolTestStatus((prev) => ({ ...prev, [category]: "success" }));
      setToolTestMessage((prev) => ({
        ...prev,
        [category]: result?.message || "Connection successful",
      }));
    },
    onError: (error: Error, variables) => {
      setToolTestStatus((prev) => ({ ...prev, [variables.category]: "error" }));
      setToolTestMessage((prev) => ({ ...prev, [variables.category]: error.message }));
    },
  });

  const freshPatStatus = projectReadinessGate?.patStatus;
  const freshCredentialStatus = freshPatStatus?.credentialStatus;
  const jiraCredential = freshCredentialStatus?.jira ?? project.credentialStatus?.jira;
  const repoCredential = freshCredentialStatus?.repo ?? project.credentialStatus?.repo;
  const projectReadyForUser =
    projectReadinessGate?.readyForUser === true ||
    freshCredentialStatus?.readyForUser === true ||
    freshPatStatus?.userPatConfigured === true ||
    freshPatStatus?.projectUserPatConfigured === true ||
    project.credentialStatus?.readyForUser === true ||
    project.userPatConfigured === true ||
    (project as any).projectUserPatConfigured === true;
  const jiraPatRequired = jiraCredential?.required ?? true;
  const jiraPatConfigured =
    projectReadyForUser ||
    (jiraCredential?.configured ??
      (freshPatStatus?.projectManagementPatConfigured === true ||
        freshPatStatus?.userJiraPatConfigured === true ||
        project.projectManagementPatConfigured === true ||
        project.userJiraPatConfigured === true));
  const hasRepositoryMapping = Boolean(
    project.repoIntegrationConfig?.repositoryId ||
      project.repoIntegrationConfig?.repositoryName ||
      project.sdlcProject?.repository_id ||
      project.sdlcProject?.linkedGoldenRepoName ||
      project.sdlcProject?.linkedGoldenRepoProject ||
      project.sdlcProject?.goldenRepoReference,
  );
  const inferredRepositoryProvider = inferRepositoryProvider(project);
  const inferredRepoPatRequired = Boolean(hasRepositoryMapping && inferredRepositoryProvider);
  const explicitRepoPatRequired = repoCredential?.required ?? project.repoPatRequired;
  const repoPatRequired =
    typeof explicitRepoPatRequired === "boolean"
      ? explicitRepoPatRequired
      : inferredRepoPatRequired;
  const repoPatConfigured =
    projectReadyForUser ||
    (repoCredential?.configured ??
      (freshPatStatus?.repoPatConfigured === true ||
        freshPatStatus?.userGitlabPatConfigured === true ||
        project.repoPatConfigured === true ||
        project.userGitlabPatConfigured === true));
  const needsProjectManagementPat =
    jiraPatRequired &&
    !jiraPatConfigured;
  const needsRepoPat =
    repoPatRequired &&
    !repoPatConfigured;
  const hasAllPersonalCredentials = !needsProjectManagementPat && !needsRepoPat;
  const signedInUserLabel =
    me?.user?.email || me?.user?.displayName || "the currently signed-in Astra user";
  const ownerUserId = project.ownerUserId || project.sdlcProject?.ownerUserId;
  const isCurrentUserProjectOwner = !ownerUserId || ownerUserId === me?.user?.id;
  const memberTokenUpdateMode = credentialOnlyMode && !isCurrentUserProjectOwner;
  const credentialAttentionMessage = credentialOnlyMode
    ? memberTokenUpdateMode
      ? "Update your personal Jira API key and repository PAT only where this project requires them. Project metadata is managed by the owner."
      : hasAllPersonalCredentials
      ? "Your personal credentials are already validated. Sync this project to make it available for your user."
      : "Configure and validate the missing personal Jira API key or repository PAT. This project will be synced for your user after validation succeeds."
    : attentionMessage;
  const credentialActionLabel = memberTokenUpdateMode
    ? "Validate and update tokens"
    : replaceJiraCredential || replaceRepoCredential
      ? "Validate and sync"
    : hasAllPersonalCredentials
      ? "Sync project"
      : "Validate and sync";
  const credentialAttentionClassName = hasAllPersonalCredentials
    ? "rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-200"
    : "rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200";
  const showProjectManagementTokenInput =
    needsProjectManagementPat ||
    (memberTokenUpdateMode && jiraPatRequired) ||
    (replaceJiraCredential && jiraPatRequired);
  const showRepoTokenInput =
    needsRepoPat ||
    (memberTokenUpdateMode && repoPatRequired) ||
    (replaceRepoCredential && repoPatRequired);

  const personalPatMutation = useMutation({
    mutationFn: async () => {
      if (!sdlcInternalId) {
        throw new Error("Project metadata is missing. Sync the project before configuring personal credentials.");
      }
      const response = await fetch(
        getApiUrl(`/api/sdlc/projects/${sdlcInternalId}/personal-pats`),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            ...(showProjectManagementTokenInput && personalJiraApiToken.trim()
              ? {
                  jiraEmail: personalJiraEmail.trim(),
                  projectManagementApiToken: personalJiraApiToken.trim(),
                }
              : {}),
            ...(showRepoTokenInput && personalGitlabToken.trim()
              ? { repoToken: personalGitlabToken.trim() }
              : {}),
          }),
        },
      );
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(result.error || result.message || "Credential validation failed");
      }
      return result;
    },
    onSuccess: () => {
      toast({
        title: memberTokenUpdateMode
          ? "Tokens validated"
          : replaceJiraCredential || replaceRepoCredential
            ? "Credentials updated"
          : hasAllPersonalCredentials
            ? "Project synced"
            : "Credentials validated",
        description: memberTokenUpdateMode
          ? "Your Jira API key and repository PAT were validated and saved for this project."
          : replaceJiraCredential || replaceRepoCredential
          ? "Your updated personal credentials were validated and this project is synced for your user."
          : hasAllPersonalCredentials
          ? "This project is now synced for your user."
          : "Your personal project management and repository provider credentials are ready for this project.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/sdlc/projects"] });
      queryClient.invalidateQueries({
        queryKey: ["/api/sdlc/projects", sdlcInternalId, "readiness-gate"],
      });
      queryClient.invalidateQueries({
        predicate: (query) =>
          typeof query.queryKey?.[0] === "string" &&
          (query.queryKey[0] as string).startsWith("/api/ado-projects"),
      });
      onProjectUpdated({
        id: project.id,
        name,
        description,
      });
      onOpenChange(false);
    },
    onError: (error: Error) => {
      toast({
        title: "Credential validation failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // ── Step validation ───────────────────────────────────────────────────────
  const toolStepComplete = isProjectToolStepComplete(
    groupedCatalog,
    skippedCategories,
    inheritFromOrg,
    orgByCategory,
    toolConfigs,
    toolTestStatus,
  );
  const canSubmitPersonalPats =
    memberTokenUpdateMode
      ? (showProjectManagementTokenInput &&
          personalJiraEmail.trim().length > 0 &&
          personalJiraApiToken.trim().length > 0) ||
        (showRepoTokenInput && personalGitlabToken.trim().length > 0)
      : replaceJiraCredential || replaceRepoCredential
        ? (!replaceJiraCredential ||
            (personalJiraEmail.trim().length > 0 &&
              personalJiraApiToken.trim().length > 0)) &&
          (!replaceRepoCredential || personalGitlabToken.trim().length > 0)
      : (!needsProjectManagementPat ||
          (personalJiraEmail.trim().length > 0 && personalJiraApiToken.trim().length > 0)) &&
        (!needsRepoPat || personalGitlabToken.trim().length > 0);

  const canMoveForward =
    (step === 0 && !!name.trim()) ||
    step === 1 ||
    (step === 2 && toolStepComplete) ||
    step === 3;

  // ── Save ──────────────────────────────────────────────────────────────────
  const handleFinalize = async () => {
    if (!name.trim()) {
      toast({
        title: "Validation Error",
        description: "Project name is required",
        variant: "destructive",
      });
      return;
    }
    if (!sdlcInternalId) {
      toast({
        title: "Cannot save integrations",
        description: "SDLC project id is missing.",
        variant: "destructive",
      });
      return;
    }

    setIsLoading(true);
    try {
      let goldenRepoReference:
        | {
            repoId: string;
            repoName: string;
            filePaths: string[];
            provider?: "ado" | "github" | "gitlab";
            repoUrl?: string;
            defaultBranch?: string;
          }
        | null
        | undefined = undefined;

      if (repositoryId && linkedGoldenRepoName) {
        const selectedPaths = goldenFileMode === "custom" ? getSelectedPaths(repositoryId) : [];
        const repoMeta = selectedRepo as Record<string, unknown> | undefined;
        const baseRef = {
          repoId: repositoryId,
          repoName: linkedGoldenRepoName,
          filePaths: selectedPaths,
          provider: (repoMeta?.provider as "ado" | "github" | "gitlab") || undefined,
          repoUrl: (repoMeta?.url as string) || (repoMeta?.webUrl as string) || undefined,
          defaultBranch: (repoMeta?.defaultBranch as string) || undefined,
        };
        if (goldenFileMode === "custom" && selectedPaths.length > 0) {
          goldenRepoReference = baseRef;
        } else {
          goldenRepoReference =
            goldenFileMode === "all"
              ? { ...baseRef, filePaths: [] }
              : null;
        }
      } else if (!repositoryId) {
        goldenRepoReference = null;
      }

      await apiRequest("PATCH", `/api/ado-projects/${project.id}`, {
        name: name.trim(),
        description: description.trim() || undefined,
        organization: project.organization,
        organizationUrl: project.organizationUrl,
        jiraProjectKey: jiraProjectKey.trim().toUpperCase() || undefined,
        repositoryId: repositoryId || null,
        repositoryCount: repositoryId ? 1 : 0,
        linkedGoldenRepoOrg: repositoryId ? linkedGoldenRepoOrg : null,
        linkedGoldenRepoProject: repositoryId ? linkedGoldenRepoProject : null,
        linkedGoldenRepoName: repositoryId ? linkedGoldenRepoName : null,
        ...(goldenRepoReference !== undefined
          ? { golden_repo_reference: goldenRepoReference }
          : {}),
      });

      const {
        toolConfigs: savedToolConfigs,
        skippedCategories: savedSkipped,
        inheritFromOrg: savedInherit,
        groupedCatalogKeys,
        orgByCategory: savedOrgByCat,
      } = integrationSaveRef.current;

      await applyProjectIntegrationConfigs(sdlcInternalId, {
        groupedCatalogKeys,
        skippedCategories: savedSkipped,
        inheritFromOrg: savedInherit,
        toolConfigs: savedToolConfigs,
        orgByCategory: savedOrgByCat,
      });

      toast({
        title: "Success",
        description: "Project and integrations updated successfully.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/sdlc/projects"] });
      queryClient.invalidateQueries({
        queryKey: [`/api/sdlc/projects/${sdlcInternalId}/details`],
      });
      queryClient.invalidateQueries({
        queryKey: ["/api/project-integration-configs", sdlcInternalId],
      });
      queryClient.invalidateQueries({
        queryKey: ["/api/projects", sdlcInternalId, "integration-effective"],
      });
      queryClient.invalidateQueries({
        queryKey: ["/api/projects", project.id, "integration-effective"],
      });
      queryClient.invalidateQueries({
        queryKey: ["/api/sdlc/projects", sdlcInternalId],
      });
      onProjectUpdated({
        id: project.id,
        name: name.trim(),
        description: description.trim() || "",
      });
      onOpenChange(false);
    } catch (error) {
      console.error("Error updating project:", error);
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to update project",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  // ── Derived ───────────────────────────────────────────────────────────────
  const selectedRepo = useMemo(
    () =>
      (Array.isArray(repositories) ? repositories : []).find(
        (r) => String(r.id) === String(repositoryId),
      ),
    [repositories, repositoryId],
  );

  const searchableRepositories = useMemo(() => {
    const items = Array.isArray(repositories) ? repositories : [];
    return [...items]
      .map((repo: any) => {
        const name = String(repo.name || "");
        const description = String(repo.description || "");
        const organization = String(repo.organization || "");
        const project = String(repo.project || "");

        return {
          repo,
          name,
          nameLower: name.toLowerCase(),
          description,
          descriptionLower: description.toLowerCase(),
          organization,
          organizationLower: organization.toLowerCase(),
          project,
          projectLower: project.toLowerCase(),
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [repositories]);

  const filteredRepositories = useMemo(() => {
    const query = deferredGoldenRepoSearch.trim().toLowerCase();
    if (!query) return searchableRepositories;

    return searchableRepositories
      .map((entry) => {
        let score: number | null = null;

        if (entry.nameLower === query) {
          score = 0;
        } else if (entry.nameLower.startsWith(query)) {
          score = 1;
        } else if (entry.nameLower.includes(query)) {
          score = 2;
        } else if (entry.descriptionLower.includes(query)) {
          score = 3;
        }

        return score === null ? null : { ...entry, score };
      })
      .filter(
        (entry): entry is (typeof searchableRepositories)[number] & { score: number } => !!entry,
      )
      .sort((a, b) => a.score - b.score || a.name.localeCompare(b.name));
  }, [searchableRepositories, deferredGoldenRepoSearch]);

  const visibleFilteredRepositories = useMemo(() => {
    if (filteredRepositories.length <= MAX_VISIBLE_GOLDEN_REPOS) {
      return filteredRepositories;
    }

    const visible = filteredRepositories.slice(0, MAX_VISIBLE_GOLDEN_REPOS);
    const selectedRepoId = String(repositoryId || "");
    const selectedIndex = filteredRepositories.findIndex(
      (entry) => String(entry.repo.id) === selectedRepoId,
    );

    if (selectedIndex < 0 || selectedIndex < MAX_VISIBLE_GOLDEN_REPOS) {
      return visible;
    }

    return [
      filteredRepositories[selectedIndex],
      ...visible.slice(0, MAX_VISIBLE_GOLDEN_REPOS - 1),
    ];
  }, [filteredRepositories, repositoryId]);

  const jiraConn = (jiraConnectionsData?.connections ?? []).find((c) => c.id === jiraConnectionId);
  const jiraDisplayEmail = jiraConn?.email?.trim();
  const defaultJiraCredentialEmail = me?.user?.email || jiraDisplayEmail || "";
  const projectManagementCredentialLabel =
    personalJiraEmail.trim() ||
    signedInUserLabel;
  const projectManagementCredentialStatusText = jiraPatConfigured
    ? `${project.integrationType === "jira" ? "Jira API key" : "Project management API key"} is already validated for ${projectManagementCredentialLabel}.`
    : `${project.integrationType === "jira" ? "Jira API key" : "Project management API key"} is required for ${projectManagementCredentialLabel}.`;
  const repositoryCredentialStatusText = repoPatRequired
    ? repoPatConfigured
      ? `Repository provider PAT is already validated for ${signedInUserLabel}.`
      : "Repository provider PAT is required for this project."
    : hasRepositoryMapping
      ? "Repository is mapped to this project. No separate repository provider PAT is required."
      : "Repository PAT was not collected because no repository is mapped to this project yet.";
  const repositoryProviderLabel =
    project.repoIntegrationConfig?.displayName ||
    (inferredRepositoryProvider === "gitlab"
      ? "GitLab"
      : inferredRepositoryProvider === "github"
        ? "GitHub"
        : inferredRepositoryProvider === "bitbucket"
          ? "Bitbucket"
          : inferredRepositoryProvider === "azure_repos" || inferredRepositoryProvider === "ado"
            ? "Azure Repos"
            : inferredRepositoryProvider || "Repository provider");
  const repositoryNameForDisplay =
    project.repoIntegrationConfig?.repositoryName ||
    project.sdlcProject?.linkedGoldenRepoName ||
    project.sdlcProject?.linkedGoldenRepoProject ||
    project.sdlcProject?.goldenRepoReference?.repoName ||
    selectedRepo?.name ||
    "";
  const repositoryIdForDisplay =
    project.repoIntegrationConfig?.repositoryId ||
    project.sdlcProject?.repository_id ||
    project.sdlcProject?.goldenRepoReference?.repoId ||
    selectedRepo?.id ||
    "";
  const repositoryBaseUrlForDisplay = project.repoIntegrationConfig?.baseUrl || "";

  useEffect(() => {
    if (!open) {
      setPersonalJiraEmail("");
      setPersonalJiraApiToken("");
      setPersonalGitlabToken("");
      setReplaceJiraCredential(false);
      setReplaceRepoCredential(false);
      return;
    }
    if (!personalJiraEmail.trim() && defaultJiraCredentialEmail) {
      setPersonalJiraEmail(defaultJiraCredentialEmail);
    }
  }, [defaultJiraCredentialEmail, open, personalJiraEmail]);

  const footerButtons = credentialOnlyMode
    ? [
        {
          label: "Cancel",
          onClick: () => onOpenChange(false),
          variant: "outline" as const,
          disabled: personalPatMutation.isPending,
        },
        {
          label: personalPatMutation.isPending
            ? hasAllPersonalCredentials
              ? "Syncing..."
              : "Validating..."
            : credentialActionLabel,
          onClick: () => personalPatMutation.mutate(),
          variant: "default" as const,
          disabled: personalPatMutation.isPending || !canSubmitPersonalPats,
          loading: personalPatMutation.isPending,
        },
      ]
    : [
        {
          label: step === 0 ? "Cancel" : "Back",
          onClick: () => (step === 0 ? onOpenChange(false) : setStep((s) => s - 1)),
          variant: "outline" as const,
          disabled: isLoading,
        },
        ...(step < LAST_STEP
          ? [
              {
                label: "Next",
                onClick: () => setStep((s) => s + 1),
                variant: "default" as const,
                disabled: isLoading || !canMoveForward,
              },
            ]
          : [
              {
                label: isLoading ? "Saving..." : "Save changes",
                onClick: () => void handleFinalize(),
                variant: "default" as const,
                disabled: isLoading || !canMoveForward,
                loading: isLoading,
              },
            ]),
      ];

  return (
    <GenericModal
      open={open}
      onOpenChange={onOpenChange}
      title={credentialOnlyMode ? "Configure personal credentials" : "Edit project"}
      description={
        credentialOnlyMode
          ? memberTokenUpdateMode
            ? "Update your personal Jira API key or repository PAT for the configured integrations on this project."
            : hasAllPersonalCredentials
            ? "Create this SDLC project for your user using the existing project metadata."
            : "Validate the missing personal Jira API key or repository PAT for this project."
          : `Step ${step + 1} of ${EDIT_PROJECT_WIZARD_STEPS.length}: ${EDIT_PROJECT_WIZARD_STEPS[step]}`
      }
      icon={credentialOnlyMode ? KeyRound : Edit}
      width="1152px"
      maxHeight="90vh"
      contentClassName="space-y-4"
      footerButtons={footerButtons}
      closeOnOverlayClick={false}
      closeOnEscape={false}
      preventClose={isLoading}
    >
      <>
        {!credentialOnlyMode && (
          <WizardProgress
            currentStepIndex={step}
            totalSteps={EDIT_PROJECT_WIZARD_STEPS.length}
            stepLabels={EDIT_PROJECT_STEP_SHORT}
          />
        )}
        <div className="space-y-1">
          <h2 className="text-foreground text-lg font-semibold tracking-tight sm:text-xl">
            {credentialOnlyMode ? "Personal integration credentials" : EDIT_PROJECT_WIZARD_STEP_COPY[step]?.title}
          </h2>
          <p className="text-muted-foreground max-w-2xl text-sm leading-relaxed">
            {credentialOnlyMode
              ? "Project metadata is reused from the existing configuration. Jira API keys and repository PATs are saved separately for your user."
              : EDIT_PROJECT_WIZARD_STEP_COPY[step]?.subtitle}
          </p>
        </div>
        {credentialAttentionMessage && (
          <div className={credentialAttentionClassName}>
            {credentialAttentionMessage}
          </div>
        )}

        {credentialOnlyMode && (
          <div className="space-y-4">
            <section className="rounded-md border border-border/50 bg-muted/20 p-4">
              <div className="mb-4">
                <h3 className="text-sm font-semibold text-foreground">Jira project credentials</h3>
                <p className="text-xs text-muted-foreground">
                  Use the Jira account that can access this registered project.
                </p>
              </div>
              <div className="grid grid-cols-1 gap-3 text-sm md:grid-cols-2">
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Project</p>
                  <p className="mt-1 text-foreground">{project.name}</p>
                </div>
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Jira instance</p>
                  <p className="mt-1 break-all text-foreground">{jiraInstanceUrlForDisplay || "Project metadata unavailable"}</p>
                </div>
                {jiraProjectKeyForDisplay && (
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Jira project key</p>
                    <p className="mt-1 font-mono text-foreground">{jiraProjectKeyForDisplay}</p>
                  </div>
                )}
                {jiraDisplayEmail && (
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Connection email</p>
                    <p className="mt-1 text-foreground">{jiraDisplayEmail}</p>
                  </div>
                )}
              </div>
              <div className="mt-4 space-y-3">
                <p
                  className={
                    jiraPatConfigured
                      ? "flex items-center gap-2 text-xs text-emerald-600 dark:text-emerald-500"
                      : "flex items-center gap-2 text-xs text-amber-600 dark:text-amber-500"
                  }
                >
                  {jiraPatConfigured ? <CheckCircle2 className="h-3.5 w-3.5" /> : <XCircle className="h-3.5 w-3.5" />}
                  {projectManagementCredentialStatusText}
                </p>
                {showProjectManagementTokenInput ? (
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="personal-jira-email">Jira email</Label>
                      <Input
                        id="personal-jira-email"
                        type="email"
                        value={personalJiraEmail}
                        onChange={(event) => setPersonalJiraEmail(event.target.value)}
                        placeholder="you@example.com"
                        autoComplete="email"
                        disabled={personalPatMutation.isPending}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="personal-project-management-api-token">
                        {project.integrationType === "jira" ? "Jira API key" : "Project management API key"}
                      </Label>
                      <Input
                        id="personal-project-management-api-token"
                        type="password"
                        value={personalJiraApiToken}
                        onChange={(event) => setPersonalJiraApiToken(event.target.value)}
                        placeholder={project.integrationType === "jira" ? "Jira API key" : "Project management API key"}
                        autoComplete="off"
                        disabled={personalPatMutation.isPending}
                      />
                      {(memberTokenUpdateMode || replaceJiraCredential) && !needsProjectManagementPat && (
                        <p className="text-xs text-muted-foreground">
                          Enter a new token only when you want to replace your existing personal token.
                        </p>
                      )}
                    </div>
                    {replaceJiraCredential && !needsProjectManagementPat && (
                      <div className="md:col-span-2">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setReplaceJiraCredential(false);
                            setPersonalJiraApiToken("");
                          }}
                          disabled={personalPatMutation.isPending}
                        >
                          Keep existing Jira API key
                        </Button>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <p className="text-xs text-muted-foreground">
                      No Jira API key update is required to sync this project.
                    </p>
                    {jiraPatRequired && jiraPatConfigured && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setReplaceJiraCredential(true)}
                        disabled={personalPatMutation.isPending}
                      >
                        Replace Jira API key
                      </Button>
                    )}
                  </div>
                )}
              </div>
            </section>

            <section className="rounded-md border border-border/50 bg-muted/20 p-4">
              <div className="mb-4">
                <h3 className="text-sm font-semibold text-foreground">Repository credentials</h3>
                <p className="text-xs text-muted-foreground">
                  Use the repository account that can read and write to the mapped repository.
                </p>
              </div>
              {hasRepositoryMapping ? (
                <>
                  <div className="grid grid-cols-1 gap-3 text-sm md:grid-cols-2">
                    <div>
                      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Provider</p>
                      <p className="mt-1 text-foreground">{repositoryProviderLabel}</p>
                    </div>
                    {repositoryNameForDisplay && (
                      <div>
                        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Repository</p>
                        <p className="mt-1 break-all text-foreground">{repositoryNameForDisplay}</p>
                      </div>
                    )}
                    {repositoryBaseUrlForDisplay && (
                      <div>
                        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Base URL</p>
                        <p className="mt-1 break-all text-foreground">{repositoryBaseUrlForDisplay}</p>
                      </div>
                    )}
                    {repositoryIdForDisplay && (
                      <div>
                        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Repository ID</p>
                        <p className="mt-1 break-all font-mono text-foreground">{repositoryIdForDisplay}</p>
                      </div>
                    )}
                  </div>
                  <div className="mt-4 space-y-3">
                    {repoPatRequired && repoPatConfigured && (
                      <p className="flex items-center gap-2 text-xs text-emerald-600 dark:text-emerald-500">
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        {repositoryCredentialStatusText}
                      </p>
                    )}
                    {repoPatRequired && !repoPatConfigured && (
                      <p className="flex items-center gap-2 text-xs text-amber-600 dark:text-amber-500">
                        <XCircle className="h-3.5 w-3.5" />
                        {repositoryCredentialStatusText}
                      </p>
                    )}
                    {!repoPatRequired && (
                      <p className="text-xs text-muted-foreground">
                        {repositoryCredentialStatusText}
                      </p>
                    )}
                    {showRepoTokenInput && (
                      <div className="space-y-2">
                        <Label htmlFor="personal-repo-token">Repository provider personal access token</Label>
                        <Input
                          id="personal-repo-token"
                          type="password"
                          value={personalGitlabToken}
                          onChange={(event) => setPersonalGitlabToken(event.target.value)}
                          placeholder="Repository provider personal access token"
                          autoComplete="off"
                          disabled={personalPatMutation.isPending}
                        />
                        <p className="text-xs text-muted-foreground">
                          {(memberTokenUpdateMode || replaceRepoCredential) && !needsRepoPat
                            ? "Enter a new repository token only when you want to replace your existing personal token."
                            : "Repository access is required for this project. The Validate and update tokens action will test and save this repository provider PAT."}
                        </p>
                        {replaceRepoCredential && !needsRepoPat && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setReplaceRepoCredential(false);
                              setPersonalGitlabToken("");
                            }}
                            disabled={personalPatMutation.isPending}
                          >
                            Keep existing repository PAT
                          </Button>
                        )}
                      </div>
                    )}
                    {!showRepoTokenInput && repoPatRequired && repoPatConfigured && (
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                        <p className="text-xs text-muted-foreground">
                          No repository PAT update is required to sync this project.
                        </p>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => setReplaceRepoCredential(true)}
                          disabled={personalPatMutation.isPending}
                        >
                          Replace repository PAT
                        </Button>
                      </div>
                    )}
                  </div>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">
                  No repository is mapped to this project yet. Repository PAT is not required.
                </p>
              )}
            </section>

            {personalPatMutation.isPending && (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Validating credentials...
              </p>
            )}
            {personalPatMutation.isError && (
              <p className="flex items-center gap-2 text-sm text-destructive">
                <XCircle className="h-4 w-4" />
                {personalPatMutation.error?.message || "Credential validation failed"}
              </p>
            )}
          </div>
        )}

        {/* ── Step 0: Details ──────────────────────────────────────────────── */}
        {!credentialOnlyMode && step === 0 && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="edit-project-name">Project name *</Label>
                <Input
                  id="edit-project-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Project name"
                  disabled={isLoading}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-jira-project-key">Jira project key</Label>
                <Input
                  id="edit-jira-project-key"
                  value={jiraProjectKey}
                  onChange={(e) =>
                    setJiraProjectKey(
                      e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""),
                    )
                  }
                  placeholder="e.g. MYPROJ"
                  maxLength={10}
                  disabled={isLoading}
                  className="font-mono"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="edit-project-description">Description</Label>
              <Textarea
                id="edit-project-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={4}
                disabled={isLoading}
              />
            </div>

            <div className="rounded-md border border-border/40 bg-muted/30 p-3 text-sm text-muted-foreground">
              <p>
                <span className="font-medium text-foreground">Integration:</span> Jira
              </p>
              <p className="mt-1">
                <span className="font-medium text-foreground">Jira connection:</span>{" "}
                {jiraConn?.name || jiraConn?.instanceUrl || "—"}
              </p>
            </div>
          </div>
        )}

        {/* ── Step 1: Golden repository ─────────────────────────────────────── */}
        {!credentialOnlyMode && step === 1 && (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Linked golden repository</Label>
              <Popover
                open={goldenRepoComboboxOpen}
                onOpenChange={(openState) => {
                  if (!openState) {
                    setGoldenRepoSearch("");
                  }
                  setGoldenRepoComboboxOpen(openState);
                }}
              >
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    role="combobox"
                    aria-expanded={goldenRepoComboboxOpen}
                    className="w-full justify-between"
                    disabled={isLoading || goldenReposLoading || !Array.isArray(repositories)}
                  >
                    <span
                      className={cn(
                        "truncate text-left",
                        selectedRepo ? "text-foreground" : "text-muted-foreground",
                      )}
                    >
                      {selectedRepo?.name || "Search and select a golden repository"}
                    </span>
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent
                  className="w-[var(--radix-popover-trigger-width)] p-0"
                  align="start"
                >
                  <Command shouldFilter={false}>
                    <CommandInput
                      placeholder="Search repositories..."
                      value={goldenRepoSearch}
                      onValueChange={setGoldenRepoSearch}
                    />
                    <div className="text-muted-foreground border-b px-3 py-2 text-xs">
                      {filteredRepositories.length > MAX_VISIBLE_GOLDEN_REPOS
                        ? `Showing ${visibleFilteredRepositories.length} of ${filteredRepositories.length} matches. Keep typing to narrow the list.`
                        : filteredRepositories.length === 1
                          ? "1 repository available."
                          : `${filteredRepositories.length} repositories available.`}
                    </div>
                    <CommandList className="max-h-72">
                      <CommandEmpty>No repositories found.</CommandEmpty>
                      <CommandGroup>
                        <CommandItem
                          value="no-golden-repo-linked"
                          onSelect={() => selectGoldenRepo(null)}
                          className="cursor-pointer"
                        >
                          <Check
                            className={cn(
                              "mr-2 h-4 w-4",
                              !repositoryId ? "opacity-100" : "opacity-0",
                            )}
                          />
                          <div className="flex min-w-0 flex-col">
                            <span className="font-medium">No golden repo linked</span>
                            <span className="text-muted-foreground text-xs">
                              Clear the current repository selection
                            </span>
                          </div>
                        </CommandItem>
                      </CommandGroup>
                      {visibleFilteredRepositories.length > 0 ? (
                        <CommandGroup heading="Repositories">
                          {visibleFilteredRepositories.map((entry) => {
                            const repo: any = entry.repo;
                            return (
                              <CommandItem
                                key={repo.id}
                                value={`${repo.name} ${repo.description || ""}`}
                                onSelect={() => selectGoldenRepo(String(repo.id))}
                                className="cursor-pointer"
                              >
                                <Check
                                  className={cn(
                                    "mr-2 h-4 w-4",
                                    String(repositoryId) === String(repo.id)
                                      ? "opacity-100"
                                      : "opacity-0",
                                  )}
                                />
                                <div className="flex min-w-0 flex-col">
                                  <span className="truncate font-medium">{repo.name}</span>
                                  {(repo.description ||
                                    (repo as any).organization ||
                                    (repo as any).project) && (
                                    <span className="text-muted-foreground truncate text-xs">
                                      {repo.description ||
                                        `${(repo as any).organization || ""}${
                                          (repo as any).organization && (repo as any).project
                                            ? " / "
                                            : ""
                                        }${(repo as any).project || ""}`}
                                    </span>
                                  )}
                                </div>
                              </CommandItem>
                            );
                          })}
                        </CommandGroup>
                      ) : (
                        <div className="text-muted-foreground px-3 py-4 text-sm">
                          No repositories match your search.
                        </div>
                      )}
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
              <p className="text-muted-foreground text-xs">
                Search by repository name to quickly relink this project.
              </p>
              {goldenReposError && (
                <p className="text-destructive text-xs">
                  {goldenReposError instanceof Error
                    ? goldenReposError.message
                    : "Failed to load golden repositories."}
                </p>
              )}
              {selectedRepo && (
                <p className="text-muted-foreground text-xs">
                  {(selectedRepo as any)?.organization || ""} /{" "}
                  {(selectedRepo as any)?.project || ""}
                </p>
              )}
            </div>

            {repositoryId && (
              <div className="space-y-2">
                <Label>Golden repo files</Label>
                <div className="bg-muted/20 flex flex-col gap-2 rounded-md border p-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="text-sm font-medium">Files to use</div>
                    {goldenFileMode === "custom" && (
                      <Button
                        size="sm"
                        variant="outline"
                        type="button"
                        onClick={() => setIsGuidelineSelectorOpen(true)}
                        disabled={isLoading}
                      >
                        Choose files ({getSelectedPaths(repositoryId).length})
                      </Button>
                    )}
                  </div>
                  <RadioGroup
                    value={goldenFileMode}
                    onValueChange={(v) => {
                      const mode = v as "all" | "custom";
                      setGoldenFileMode(mode);
                      if (mode === "all") clearRepo(repositoryId);
                    }}
                    className="flex items-center gap-4"
                  >
                    <div className="flex items-center gap-2">
                      <RadioGroupItem value="all" id="edit-golden-files-all" />
                      <Label htmlFor="edit-golden-files-all" className="text-sm">
                        All files
                      </Label>
                    </div>
                    <div className="flex items-center gap-2">
                      <RadioGroupItem value="custom" id="edit-golden-files-custom" />
                      <Label htmlFor="edit-golden-files-custom" className="text-sm">
                        Custom files
                      </Label>
                    </div>
                  </RadioGroup>
                  <p className="text-muted-foreground text-xs">
                    "All files" stores an empty list (meaning all). "Custom files" stores
                    only the selected paths.
                  </p>
                </div>
                <GoldenRepoGuidelineSelector
                  open={isGuidelineSelectorOpen}
                  onOpenChange={setIsGuidelineSelectorOpen}
                  selectedRepoId={repositoryId}
                  selectedRepoName={linkedGoldenRepoName || selectedRepo?.name || undefined}
                  linkedGoldenRepoOrg={linkedGoldenRepoOrg || undefined}
                  linkedGoldenRepoProject={linkedGoldenRepoProject || undefined}
                  provider={
                    ((selectedRepo as any)?.provider as "ado" | "github" | "gitlab") || "ado"
                  }
                  repoUrl={(selectedRepo as any)?.url || (selectedRepo as any)?.webUrl}
                  defaultBranch={(selectedRepo as any)?.defaultBranch}
                  projectId={project?.sdlcProject?.projectId || undefined}
                  scope="all"
                  preselectedPaths={getSelectedPaths(repositoryId)}
                  onSelectFiles={(files) => {
                    const repoName = linkedGoldenRepoName || "Golden Repo";
                    setSelection(repoName, repositoryId, files.map((f) => f.path));
                  }}
                />
              </div>
            )}
          </div>
        )}

        {/* ── Step 2: Tools ─────────────────────────────────────────────────── */}
        {!credentialOnlyMode && step === 2 && !jiraConnectionId && (
          <p className="text-destructive text-sm">
            This project has no Jira connection id. Tool inheritance may be unavailable;
            configure each category or skip.
          </p>
        )}

        {!credentialOnlyMode && step === 2 && (
          <CreateProjectToolConfigurationStep
            groupedCatalog={groupedCatalog}
            orgByCategory={orgByCategory}
            orgConfigsLoading={orgConfigsLoading}
            skippedCategories={skippedCategories}
            setSkippedCategories={setSkippedCategories}
            inheritFromOrg={inheritFromOrg}
            setInheritFromOrg={setInheritFromOrg}
            toolConfigs={toolConfigs}
            setToolConfigs={setToolConfigs}
            toolTestStatus={toolTestStatus}
            toolTestMessage={toolTestMessage}
            setToolTestStatus={setToolTestStatus}
            setToolTestMessage={setToolTestMessage}
            onTestCatalogTool={(args) => catalogTestMutation.mutate(args)}
            onTestOrgIntegration={(args) => orgIntegrationTestMutation.mutate(args)}
            projectConfigIdsByCategory={projectConfigIdsByCategory}
            projectSavedCatalogIdsByCategory={projectSavedCatalogIdsByCategory}
            onClearSavedProjectConfig={(category) => {
              setProjectConfigIdsByCategory((prev) => {
                const next = { ...prev };
                delete next[category];
                return next;
              });
            }}
            onTestProjectIntegration={(args) =>
              projectIntegrationTestMutation.mutate(args)
            }
            projectTestPendingCategory={
              projectIntegrationTestMutation.isPending
                ? (projectIntegrationTestMutation.variables?.category ?? null)
                : null
            }
            catalogTestPending={catalogTestMutation.isPending}
            orgTestPendingCategory={
              orgIntegrationTestMutation.isPending
                ? (orgIntegrationTestMutation.variables?.category ?? null)
                : null
            }
          />
        )}

        {/* ── Step 3: Review ────────────────────────────────────────────────── */}
        {!credentialOnlyMode && step === 3 && (
          <div className="space-y-6 text-sm">
            <div className="rounded-2xl border border-border/40 border-l-[3px] border-l-blue-500 bg-card p-4 shadow-sm">
              <h3 className="mb-2 font-semibold text-foreground">Project</h3>
              <dl className="text-muted-foreground grid gap-2 sm:grid-cols-2">
                <div>
                  <dt className="text-xs uppercase tracking-wide">Name</dt>
                  <dd className="text-foreground">{name || "—"}</dd>
                </div>
                {jiraProjectKey && (
                  <div>
                    <dt className="text-xs uppercase tracking-wide">Jira project key</dt>
                    <dd className="font-mono text-foreground">{jiraProjectKey}</dd>
                  </div>
                )}
                <div className="sm:col-span-2">
                  <dt className="text-xs uppercase tracking-wide">Jira connection</dt>
                  <dd className="text-foreground">
                    {jiraConn?.name || jiraConn?.instanceUrl || "—"}
                  </dd>
                </div>
                {description?.trim() && (
                  <div className="sm:col-span-2">
                    <dt className="text-xs uppercase tracking-wide">Description</dt>
                    <dd className="whitespace-pre-wrap text-foreground">{description}</dd>
                  </div>
                )}
              </dl>
            </div>

            <div className="rounded-2xl border border-border/40 border-l-[3px] border-l-amber-500 bg-card p-4 shadow-sm">
              <h3 className="mb-2 font-semibold text-foreground">Golden repository</h3>
              {!repositoryId ? (
                <p className="text-muted-foreground">Not linked</p>
              ) : (
                <p className="text-foreground">
                  {linkedGoldenRepoName || "Selected"} — file scope:{" "}
                  <span className="font-medium">
                    {goldenFileMode === "all" ? "All files" : "Custom files"}
                  </span>
                </p>
              )}
            </div>

            <ToolIntegrationsReviewBlock
              groupedCatalog={groupedCatalog}
              orgByCategory={orgByCategory}
              skippedCategories={skippedCategories}
              inheritFromOrg={inheritFromOrg}
              toolConfigs={toolConfigs}
            />
          </div>
        )}
      </>
    </GenericModal>
  );
}
