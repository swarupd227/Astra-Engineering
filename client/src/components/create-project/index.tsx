import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  useSelectedOrganization,
  GLOBAL_ALL_ORGANIZATIONS_ID,
} from "@/contexts/selected-organization-context";
import { GenericModal } from "@/components/ui/generic-modal";
import { WizardProgress } from "@/components/ui/wizard-progress";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Loader2, PlusCircle, Search } from "lucide-react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { getApiUrl } from "@/lib/api-config";
import {
  extractGoldenRepositories,
  GOLDEN_REPOSITORIES_QUERY_KEY,
  type GoldenRepositoriesResponse,
} from "@/lib/golden-repositories";
import { useToast } from "@/hooks/use-toast";
import type { GoldenRepository } from "@shared/schema";
import { useGoldenRepoSelection } from "@/contexts/golden-repo-selection-context";
import { GoldenRepoGuidelineSelector } from "@/components/golden-repo-guideline-selector";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import type {
  CatalogToolItem,
  CreateProjectDialogProps,
  OrgIntegrationConfigRow,
  TestStatus,
  ToolConfigState,
} from "./types";
import {
  CREATE_PROJECT_STEPS,
  CREATE_PROJECT_STEP_SHORT,
  CREATE_PROJECT_WIZARD_STEP_COPY,
  buildOrgConfigByCategory,
  groupToolCatalogByCategory,
  isProjectToolStepComplete,
} from "./utils";
import { CreateProjectToolConfigurationStep } from "./tool-configuration-step";
import { CreateProjectReviewStep } from "./review-step";
import { applyProjectIntegrationConfigs } from "./apply-project-integrations";
import { formatJiraCreateProjectError } from "./errors";
import { getOrgIdForIntegration } from "@shared/integration-config";

export type { CreateProjectDialogProps } from "./types";

// This deployment is Jira-only (AWS/DEVX_HOSTING=aws). ADO step is skipped.
const INTEGRATION_TYPE = "jira" as const;
const JIRA_CREATE_PROJECT_DISABLED_REASON =
  "Only the Jira connection owner, TenantAdmin, or OrgAdmin can create projects under this Jira organization.";

export function CreateProjectDialog({
  open,
  onOpenChange,
  onProjectCreated,
  selectedOrganizationId = null,
  selectedOrganization = null,
  goldenRepoId = null,
  goldenRepoName = null,
}: CreateProjectDialogProps) {
  const { toast } = useToast();
  const { getSelectedPaths, setSelection } = useGoldenRepoSelection();
  const { selectedOrganization: globalSelectedOrganization } = useSelectedOrganization();

  // ── Wizard state ────────────────────────────────────────────────────────
  const [step, setStep] = useState(0);

  // ── Project details ──────────────────────────────────────────────────────
  const [projectName, setProjectName] = useState("");
  const [description, setDescription] = useState("");
  const [jiraConnectionId, setJiraConnectionId] = useState("");
  const [jiraProjectKey, setJiraProjectKey] = useState("");
  const [jiraProjectTypeKey, setJiraProjectTypeKey] = useState("software");
  const [createErrorMsg, setCreateErrorMsg] = useState<string | null>(null);

  // ── Golden repo ──────────────────────────────────────────────────────────
  const [selectedRepoIds, setSelectedRepoIds] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [goldenFileMode, setGoldenFileMode] = useState<"all" | "custom">("all");
  const [isGuidelineSelectorOpen, setIsGuidelineSelectorOpen] = useState(false);
  const hasPreSelectedRepo = useRef(false);

  // ── Tool config ──────────────────────────────────────────────────────────
  const [toolConfigs, setToolConfigs] = useState<Record<string, ToolConfigState>>({});
  const [skippedCategories, setSkippedCategories] = useState<Record<string, boolean>>({});
  const [inheritFromOrg, setInheritFromOrg] = useState<Record<string, boolean>>({});
  const [toolTestStatus, setToolTestStatus] = useState<Record<string, TestStatus>>({});
  const [toolTestMessage, setToolTestMessage] = useState<Record<string, string>>({});

  const integrationSaveRef = useRef({
    toolConfigs: {} as Record<string, ToolConfigState>,
    skippedCategories: {} as Record<string, boolean>,
    inheritFromOrg: {} as Record<string, boolean>,
    groupedCatalogKeys: [] as string[],
    orgByCategory: {} as Record<string, OrgIntegrationConfigRow | undefined>,
  });

  // org id used to load org-level tool defaults (Jira connection id)
  const orgIdForIntegrations = getOrgIdForIntegration(
    INTEGRATION_TYPE,
    { jiraConnectionId },
    "",
  );

  // ── Queries ──────────────────────────────────────────────────────────────
  const {
    data: goldenReposData,
    isLoading: reposLoading,
    error: reposError,
  } = useQuery<GoldenRepositoriesResponse | GoldenRepository[]>({
    queryKey: GOLDEN_REPOSITORIES_QUERY_KEY,
    queryFn: async () => {
      const response = await fetch(getApiUrl("/api/golden-repositories"), {
        credentials: "include",
      });
      const payload = await response.json();
      if (!response.ok)
        throw new Error(payload?.error || "Failed to fetch golden repositories");
      return payload;
    },
    enabled: open,
    staleTime: 0,
    refetchOnMount: "always",
  });

  const safeRepositories = useMemo(
    () => extractGoldenRepositories(goldenReposData),
    [goldenReposData],
  );

  const { data: jiraConnectionsData } = useQuery<{ connections: any[] }>({
    queryKey: ["/api/jira/connections"],
    queryFn: async () =>
      (
        await fetch(getApiUrl("/api/jira/connections"), { credentials: "include" })
      ).json(),
    enabled: open,
  });

  const { data: catalogResponse } = useQuery<{ tools: CatalogToolItem[] }>({
    queryKey: ["/api/tool-catalog"],
    enabled: open,
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

  const jiraConnections = jiraConnectionsData?.connections ?? [];
  const selectedJiraConnection = jiraConnections.find((conn: any) => conn.id === jiraConnectionId);
  const selectedJiraConnectionCanCreate =
    Boolean(selectedJiraConnection) && selectedJiraConnection.canCreateProject !== false;
  const selectedJiraConnectionDisabledReason =
    selectedJiraConnection?.createProjectDisabledReason || JIRA_CREATE_PROJECT_DISABLED_REASON;

  const groupedCatalog = useMemo(
    () => groupToolCatalogByCategory(catalogResponse?.tools || []),
    [catalogResponse?.tools],
  );
  const orgByCategory = useMemo(
    () => buildOrgConfigByCategory(orgConfigsData?.configs),
    [orgConfigsData?.configs],
  );

  // ── Reset on open ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!open) return;
    setStep(0);
    setProjectName("");
    setDescription("");
    setJiraProjectKey("");
    setJiraProjectTypeKey("software");
    setSelectedRepoIds([]);
    setSearchQuery("");
    setGoldenFileMode("all");
    setIsGuidelineSelectorOpen(false);
    setToolConfigs({});
    setSkippedCategories({});
    setInheritFromOrg({});
    setToolTestStatus({});
    setToolTestMessage({});
    setCreateErrorMsg(null);
    hasPreSelectedRepo.current = false;

    // Pre-fill Jira connection from the prop passed by the Projects page
    // (derived from the global org selector in the header)
    if (selectedOrganizationId) {
      setJiraConnectionId(selectedOrganizationId);
      return;
    }
    // Or derive from the global org selector directly if no prop given
    if (
      globalSelectedOrganization &&
      globalSelectedOrganization.id !== GLOBAL_ALL_ORGANIZATIONS_ID &&
      globalSelectedOrganization.sourceType === "jira"
    ) {
      setJiraConnectionId(globalSelectedOrganization.id);
      return;
    }
    setJiraConnectionId("");
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Re-apply auto-select when connections finish loading ──────────────────
  // (Handles the case where dialog opens before /api/jira/connections responds)
  useEffect(() => {
    if (!open || jiraConnectionId || jiraConnections.length === 0) return;

    // Try prop first
    if (selectedOrganizationId) {
      const match = jiraConnections.find((c: any) => c.id === selectedOrganizationId);
      if (match) { setJiraConnectionId(match.id); return; }
    }
    // Then global selector
    if (
      globalSelectedOrganization &&
      globalSelectedOrganization.id !== GLOBAL_ALL_ORGANIZATIONS_ID &&
      globalSelectedOrganization.sourceType === "jira"
    ) {
      const match = jiraConnections.find((c: any) => c.id === globalSelectedOrganization.id);
      if (match) setJiraConnectionId(match.id);
    }
  }, [open, jiraConnections]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Pre-select golden repo ────────────────────────────────────────────────
  useEffect(() => {
    if (!open || !goldenRepoId || reposLoading || safeRepositories.length === 0 || hasPreSelectedRepo.current) return;

    const timeoutId = window.setTimeout(() => {
      let repo = safeRepositories.find((r) => String(r.id) === String(goldenRepoId));
      if (!repo && goldenRepoName) {
        repo = safeRepositories.find(
          (r) => r.name?.toLowerCase() === goldenRepoName.toLowerCase(),
        );
      }
      if (repo) setSelectedRepoIds([String(repo.id)]);
      hasPreSelectedRepo.current = true;
    }, 150);

    return () => window.clearTimeout(timeoutId);
  }, [open, goldenRepoId, goldenRepoName, safeRepositories, reposLoading]);

  // ── Reset tool configs when Jira connection changes ───────────────────────
  useEffect(() => {
    setToolConfigs({});
    setSkippedCategories({});
    setInheritFromOrg({});
    setToolTestStatus({});
    setToolTestMessage({});
  }, [jiraConnectionId]);

  // ── Auto-inherit org defaults ─────────────────────────────────────────────
  useEffect(() => {
    const list = orgConfigsData?.configs;
    if (!list || Object.keys(groupedCatalog).length === 0) return;
    setInheritFromOrg((prev) => {
      const next: Record<string, boolean> = { ...prev };
      for (const cat of Object.keys(groupedCatalog)) {
        const hasOrg = list.some((c) => c.categoryKey === cat);
        if (prev[cat] === undefined) next[cat] = hasOrg;
        else if (!hasOrg) next[cat] = false;
      }
      return next;
    });
  }, [orgConfigsData, groupedCatalog]);

  // ── Keep ref in sync for use after createMutation resolves ────────────────
  useEffect(() => {
    integrationSaveRef.current = {
      toolConfigs,
      skippedCategories,
      inheritFromOrg,
      groupedCatalogKeys: Object.keys(groupedCatalog),
      orgByCategory,
    };
  }, [toolConfigs, skippedCategories, inheritFromOrg, groupedCatalog, orgByCategory]);

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
      const response = await fetch(
        getApiUrl(`/api/tool-catalog/${toolCatalogId}/test`),
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

  const createMutation = useMutation({
    mutationFn: async (data: any) => {
      const response = await apiRequest("POST", "/api/jira/create-project", data);
      return response.json();
    },
    onSuccess: async (response: any) => {
      setCreateErrorMsg(null);
      const projectId =
        response?.sdlcProjectId ||
        response?.sdlcProject?.id ||
        response?.projectId ||
        response?.project?.id;

      if (!projectId) {
        toast({
          title: "Project created",
          description: "Project id missing in response; integration rows were not saved.",
          variant: "destructive",
        });
        queryClient.invalidateQueries({ queryKey: ["/api/sdlc/projects"] });
        onOpenChange(false);
        return;
      }

      const {
        toolConfigs: savedToolConfigs,
        skippedCategories: savedSkipped,
        inheritFromOrg: savedInherit,
        groupedCatalogKeys,
        orgByCategory: savedOrgByCat,
      } = integrationSaveRef.current;

      await applyProjectIntegrationConfigs(projectId, {
        groupedCatalogKeys,
        skippedCategories: savedSkipped,
        inheritFromOrg: savedInherit,
        toolConfigs: savedToolConfigs,
        orgByCategory: savedOrgByCat,
      });

      queryClient.invalidateQueries({ queryKey: ["/api/sdlc/projects"] });
      queryClient.invalidateQueries({
        queryKey: ["/api/projects", projectId, "integration-effective"],
      });
      queryClient.invalidateQueries({
        queryKey: ["/api/project-integration-configs", projectId],
      });
      toast({
        title: "Project Created",
        description: "Project and integration configuration saved successfully.",
      });
      onOpenChange(false);
      onProjectCreated?.(null);
    },
    onError: (error: Error) => {
      const message = formatJiraCreateProjectError(error);
      setCreateErrorMsg(message);
    },
  });

  // ── Final create ──────────────────────────────────────────────────────────
  const runFinalCreate = useCallback(() => {
    setCreateErrorMsg(null);
    if (!selectedJiraConnectionCanCreate) {
      setCreateErrorMsg(selectedJiraConnectionDisabledReason);
      return;
    }
    const goldenRepo = selectedRepoIds.length
      ? safeRepositories.find((r: any) => String(r.id) === selectedRepoIds[0])
      : null;
    const goldenRef = goldenRepo
      ? {
          repoId: String((goldenRepo as any).id),
          repoName: (goldenRepo as any).name || "",
          filePaths:
            goldenFileMode === "custom"
              ? getSelectedPaths(String((goldenRepo as any).id))
              : [],
          provider: (goldenRepo as any).provider,
          repoUrl: (goldenRepo as any).url || (goldenRepo as any).webUrl,
          defaultBranch: (goldenRepo as any).defaultBranch,
        }
      : null;

    createMutation.mutate({
      connectionId: jiraConnectionId,
      projectName: projectName.trim(),
      projectKey: jiraProjectKey.trim().toUpperCase(),
      projectDescription: description.trim() || undefined,
      projectTypeKey: jiraProjectTypeKey,
      golden_repo_reference: goldenRef,
      goldenRepoName: goldenRepo ? (goldenRepo as any).name : undefined,
      repositoryId: goldenRepo ? String((goldenRepo as any).id) : null,
    });
  }, [
    selectedRepoIds, goldenFileMode, getSelectedPaths, safeRepositories,
    jiraConnectionId, projectName, jiraProjectKey, description,
    jiraProjectTypeKey, createMutation,
    selectedJiraConnectionCanCreate, selectedJiraConnectionDisabledReason,
  ]);

  // ── Step navigation ───────────────────────────────────────────────────────
  const filteredRepos = safeRepositories.filter((repo) =>
    repo.name.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  const selectedGoldenRepo = useMemo(
    () =>
      selectedRepoIds.length > 0
        ? safeRepositories.find((r) => String(r.id) === selectedRepoIds[0])
        : undefined,
    [safeRepositories, selectedRepoIds],
  );

  const toolStepComplete = isProjectToolStepComplete(
    groupedCatalog,
    skippedCategories,
    inheritFromOrg,
    orgByCategory,
    toolConfigs,
    toolTestStatus,
  );

  // step 0 = Details, step 1 = Golden repo, step 2 = Tools, step 3 = Review, step 4 = Create
  const canMoveForward =
    (step === 0 &&
      !!projectName.trim() &&
      !!jiraConnectionId &&
      selectedJiraConnectionCanCreate &&
      !!jiraProjectKey.trim()) ||
    (step === 1) || // golden repo is optional
    (step === 2 && toolStepComplete) ||
    step === 3;

  const lastStepIndex = CREATE_PROJECT_STEPS.length - 1;
  const footerButtons = [
    {
      label: step === 0 ? "Cancel" : "Back",
      onClick: () =>
        step === 0 ? onOpenChange(false) : setStep((prev) => prev - 1),
      variant: "outline" as const,
      disabled: createMutation.isPending,
    },
    ...(step < lastStepIndex
      ? [
          {
            label: "Next",
            onClick: () => setStep((prev) => prev + 1),
            variant: "default" as const,
            disabled: !canMoveForward,
          },
        ]
      : [
          {
            label: createMutation.isPending ? "Creating..." : "Create project",
            onClick: runFinalCreate,
            variant: "default" as const,
            disabled: createMutation.isPending,
            loading: createMutation.isPending,
          },
        ]),
  ];

  return (
    <GenericModal
      open={open}
      onOpenChange={onOpenChange}
      title="Create New SDLC Project"
      description={`Step ${step + 1} of ${CREATE_PROJECT_STEPS.length}: ${CREATE_PROJECT_STEPS[step]}`}
      icon={PlusCircle}
      width="1152px"
      maxHeight="90vh"
      contentClassName="space-y-6"
      footerButtons={footerButtons}
      closeOnOverlayClick={false}
      preventClose={createMutation.isPending}
    >
      <WizardProgress
        currentStepIndex={step}
        totalSteps={CREATE_PROJECT_STEPS.length}
        stepLabels={CREATE_PROJECT_STEP_SHORT}
      />

      {createErrorMsg && (
        <Alert variant="destructive">
          <AlertDescription>{createErrorMsg}</AlertDescription>
        </Alert>
      )}

      {CREATE_PROJECT_WIZARD_STEP_COPY[step] != null && (
        <div className="space-y-2">
          <h2 className="text-foreground text-lg font-semibold tracking-tight sm:text-xl">
            {CREATE_PROJECT_WIZARD_STEP_COPY[step]!.title}
          </h2>
          <p className="text-muted-foreground max-w-2xl text-sm leading-relaxed">
            {CREATE_PROJECT_WIZARD_STEP_COPY[step]!.subtitle}
          </p>
        </div>
      )}

      {/* ── Step 0: Project Details ─────────────────────────────────────────── */}
      {step === 0 && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Project Name *</Label>
              <Input
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
                placeholder="My Jira Project"
                data-testid="input-project-name"
              />
            </div>
            <div className="space-y-2">
              <Label>Jira Connection *</Label>
              {(() => {
                const isPreFilled =
                  !!jiraConnectionId &&
                  (jiraConnectionId === selectedOrganizationId ||
                    (globalSelectedOrganization?.id !== GLOBAL_ALL_ORGANIZATIONS_ID &&
                      globalSelectedOrganization?.id === jiraConnectionId));
                const preFilledConn = isPreFilled
                  ? jiraConnections.find((c: any) => c.id === jiraConnectionId)
                  : null;
                if (isPreFilled && preFilledConn) {
                  const canCreateProject = preFilledConn.canCreateProject !== false;
                  return (
                    <div className="space-y-1">
                      <div className="flex items-center gap-2 rounded-md border border-border/40 bg-muted/40 px-3 py-2 text-sm">
                        <span className={canCreateProject ? "font-medium text-foreground" : "font-medium text-muted-foreground"}>
                          {preFilledConn.name || preFilledConn.instanceUrl}
                        </span>
                        {!canCreateProject && (
                          <Badge variant="outline" className="ml-1 text-xs">
                            No create permission
                          </Badge>
                        )}
                        <span className="text-muted-foreground text-xs ml-auto">
                          Selected from org filter
                        </span>
                        <button
                          type="button"
                          onClick={() => setJiraConnectionId("")}
                          className="text-muted-foreground hover:text-foreground text-xs underline ml-1"
                        >
                          Change
                        </button>
                      </div>
                      {!canCreateProject && (
                        <p className="text-xs text-muted-foreground">
                          {preFilledConn.createProjectDisabledReason || JIRA_CREATE_PROJECT_DISABLED_REASON}
                        </p>
                      )}
                    </div>
                  );
                }
                return (
                  <Select value={jiraConnectionId} onValueChange={setJiraConnectionId}>
                    <SelectTrigger data-testid="select-jira-connection">
                      <SelectValue placeholder="Select Jira connection" />
                    </SelectTrigger>
                    <SelectContent>
                      {jiraConnections.length === 0 ? (
                        <SelectItem value="__none__" disabled>
                          No Jira connections — configure one in Settings
                        </SelectItem>
                      ) : (
                        jiraConnections.map((conn: any) => {
                          const canCreateProject = conn.canCreateProject !== false;
                          return (
                            <SelectItem
                              key={conn.id}
                              value={conn.id}
                              disabled={!canCreateProject}
                              textValue={conn.name || conn.instanceUrl}
                            >
                              <div className="flex w-full min-w-0 items-center gap-2">
                                <span className="truncate">{conn.name || conn.instanceUrl}</span>
                                {!canCreateProject && (
                                  <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                                    No create permission
                                  </span>
                                )}
                              </div>
                            </SelectItem>
                          );
                        })
                      )}
                    </SelectContent>
                  </Select>
                );
              })()}
              {selectedJiraConnection && !selectedJiraConnectionCanCreate && (
                <p className="text-xs text-muted-foreground">
                  {selectedJiraConnectionDisabledReason}
                </p>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Jira Project Key *</Label>
              <Input
                value={jiraProjectKey}
                onChange={(e) =>
                  setJiraProjectKey(
                    e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""),
                  )
                }
                placeholder="MYPROJ"
                maxLength={10}
                data-testid="input-jira-project-key"
              />
              <p className="text-xs text-muted-foreground">
                Short uppercase key used in Jira (max 10 chars)
              </p>
            </div>
            <div className="space-y-2">
              <Label>Project Type</Label>
              <Select value={jiraProjectTypeKey} onValueChange={setJiraProjectTypeKey}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="software">Software</SelectItem>
                  <SelectItem value="business">Business</SelectItem>
                  <SelectItem value="service_desk">Service Desk</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Description</Label>
            <Textarea
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional project description"
              data-testid="input-description"
            />
          </div>

        </div>
      )}

      {/* ── Step 1: Golden Repository ────────────────────────────────────────── */}
      {step === 1 && (
        <div className="space-y-4 rounded-md border p-4">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold">
              Link Golden Repositories{" "}
              <span className="text-muted-foreground text-sm font-normal">(Optional)</span>
            </h3>
            {selectedRepoIds.length > 0 && (
              <Badge>{selectedRepoIds.length} selected</Badge>
            )}
          </div>

          <div className="relative">
            <Search className="text-muted-foreground absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search repositories..."
              className="pl-9"
              data-testid="input-search-repos"
            />
          </div>

          {reposLoading ? (
            <div className="flex justify-center p-8">
              <Loader2 className="text-muted-foreground h-6 w-6 animate-spin" />
            </div>
          ) : reposError ? (
            <div className="text-destructive rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
              {(reposError as Error).message}
            </div>
          ) : (
            <div className="max-h-64 space-y-2 overflow-y-auto">
              {filteredRepos.map((repo) => (
                <button
                  key={repo.id}
                  type="button"
                  onClick={() => setSelectedRepoIds([String(repo.id)])}
                  className={`w-full rounded-md border p-3 text-left transition-colors ${
                    selectedRepoIds.includes(String(repo.id))
                      ? "border-primary bg-accent"
                      : "hover:bg-muted/50"
                  }`}
                  data-testid={`repo-option-${repo.id}`}
                >
                  <div className="flex items-center justify-between">
                    <span>{repo.name}</span>
                    {selectedRepoIds.includes(String(repo.id)) && (
                      <Badge>Selected</Badge>
                    )}
                  </div>
                </button>
              ))}
              {filteredRepos.length === 0 && (
                <p className="text-muted-foreground text-sm text-center py-6">
                  {searchQuery
                    ? "No repositories match your search"
                    : "No golden repositories available. Add one in Settings."}
                </p>
              )}
            </div>
          )}

          {selectedRepoIds.length > 0 && (
            <div className="space-y-2">
              <RadioGroup
                value={goldenFileMode}
                onValueChange={(v) => setGoldenFileMode(v as "all" | "custom")}
                className="flex gap-4"
              >
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="all" id="golden-all" />
                  <Label htmlFor="golden-all">All files</Label>
                </div>
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="custom" id="golden-custom" />
                  <Label htmlFor="golden-custom">Custom files</Label>
                </div>
              </RadioGroup>
              {goldenFileMode === "custom" && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setIsGuidelineSelectorOpen(true)}
                >
                  Choose files
                </Button>
              )}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setSelectedRepoIds([])}
              >
                Clear selection
              </Button>
            </div>
          )}

          <GoldenRepoGuidelineSelector
            open={isGuidelineSelectorOpen}
            onOpenChange={setIsGuidelineSelectorOpen}
            selectedRepoId={selectedRepoIds[0]}
            selectedRepoName={selectedGoldenRepo?.name}
            linkedGoldenRepoOrg={(selectedGoldenRepo as any)?.organization}
            linkedGoldenRepoProject={(selectedGoldenRepo as any)?.project}
            provider={
              ((selectedGoldenRepo as any)?.provider as "ado" | "github" | "gitlab") || "ado"
            }
            repoUrl={(selectedGoldenRepo as any)?.url || (selectedGoldenRepo as any)?.webUrl}
            defaultBranch={(selectedGoldenRepo as any)?.defaultBranch}
            scope="all"
            preselectedPaths={getSelectedPaths(selectedRepoIds[0])}
            onSelectFiles={(files) =>
              setSelection("Golden Repo", selectedRepoIds[0], files.map((f) => f.path))
            }
          />
        </div>
      )}

      {/* ── Step 2: Tool Configuration ───────────────────────────────────────── */}
      {step === 2 && (
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
          catalogTestPending={catalogTestMutation.isPending}
          orgTestPendingCategory={
            orgIntegrationTestMutation.isPending
              ? (orgIntegrationTestMutation.variables?.category ?? null)
              : null
          }
        />
      )}

      {/* ── Step 3: Review ───────────────────────────────────────────────────── */}
      {step === 3 && (
        <CreateProjectReviewStep
          projectName={projectName}
          description={description}
          jiraConnectionId={jiraConnectionId}
          jiraProjectKey={jiraProjectKey}
          jiraConnections={jiraConnections}
          selectedRepoIds={selectedRepoIds}
          safeRepositories={safeRepositories as Array<{ id: string | number; name: string }>}
          goldenFileMode={goldenFileMode}
          groupedCatalog={groupedCatalog}
          orgByCategory={orgByCategory}
          skippedCategories={skippedCategories}
          inheritFromOrg={inheritFromOrg}
          toolConfigs={toolConfigs}
        />
      )}

      {/* ── Step 4: Create ───────────────────────────────────────────────────── */}
      {step === 4 && (
        <div className="rounded-md border border-border/40 bg-muted/30 p-4 text-sm text-muted-foreground">
          Everything looks good. Use the <strong>Create project</strong> button below to
          provision the project in Jira and register it in Astra.
        </div>
      )}
    </GenericModal>
  );
}
