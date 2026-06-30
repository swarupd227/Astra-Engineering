import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, GitBranch, Loader2, Save } from "lucide-react";
import { getApiUrl } from "@/lib/api-config";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { applyProjectIntegrationConfigs } from "@/components/create-project/apply-project-integrations";
import { CreateProjectToolConfigurationStep } from "@/components/create-project/tool-configuration-step";
import type {
  CatalogToolItem,
  OrgIntegrationConfigRow,
  TestStatus,
  ToolConfigState,
} from "@/components/create-project/types";
import {
  buildOrgConfigByCategory,
  groupToolCatalogByCategory,
} from "@/components/create-project/utils";
import { getIntegrationLabels, getOrgIdForIntegration } from "@shared/integration-config";

const BUILD_DEPLOY_CATEGORIES = ["repo", "cicd"] as const;

type SdlcProjectRow = {
  id: string;
  name: string;
  organizationUrl?: string | null;
  integrationType?: string | null;
  jiraConnectionId?: string | null;
};

function normalizeOrgUrl(url?: string | null) {
  return (url ?? "").trim().replace(/\/+$/, "").toLowerCase();
}

interface ProjectToolIntegrationsPanelProps {
  projectId: string;
}

export function ProjectToolIntegrationsPanel({ projectId }: ProjectToolIntegrationsPanelProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [toolConfigs, setToolConfigs] = useState<Record<string, ToolConfigState>>({});
  const [skippedCategories, setSkippedCategories] = useState<Record<string, boolean>>({});
  const [inheritFromOrg, setInheritFromOrg] = useState<Record<string, boolean>>({});
  const [toolTestStatus, setToolTestStatus] = useState<Record<string, TestStatus>>({});
  const [toolTestMessage, setToolTestMessage] = useState<Record<string, string>>({});

  const { data: sdlcProjectsRaw } = useQuery<SdlcProjectRow[]>({
    queryKey: ["/api/sdlc/projects"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/sdlc/projects");
      const json = await res.json();
      return Array.isArray(json) ? json : (json?.projects ?? []);
    },
  });

  const project = useMemo(
    () => (sdlcProjectsRaw ?? []).find((p) => p.id === projectId),
    [sdlcProjectsRaw, projectId],
  );

  const integrationType = (project?.integrationType ?? "ado").toLowerCase();
  const labels = getIntegrationLabels(integrationType);

  const { data: organizationsData } = useQuery<{
    organizations: Array<{ id: string; organizationUrl: string }>;
  }>({
    queryKey: ["/api/artifact-organizations"],
    enabled: integrationType === "ado",
  });

  const adoOrgId = useMemo(() => {
    if (integrationType !== "ado" || !project?.organizationUrl) return "";
    const target = normalizeOrgUrl(project.organizationUrl);
    return (
      organizationsData?.organizations?.find(
        (o) => normalizeOrgUrl(o.organizationUrl) === target,
      )?.id ?? ""
    );
  }, [integrationType, organizationsData?.organizations, project?.organizationUrl]);

  const orgType = labels.id;
  const orgIdForIntegrations = getOrgIdForIntegration(
    integrationType,
    { jiraConnectionId: project?.jiraConnectionId ?? undefined },
    adoOrgId,
  );

  const { data: catalogResponse } = useQuery<{ tools: CatalogToolItem[] }>({
    queryKey: ["/api/tool-catalog"],
  });

  const { data: orgConfigsData, isLoading: orgConfigsLoading } = useQuery<{
    configs: OrgIntegrationConfigRow[];
  }>({
    queryKey: ["/api/org-integration-configs", orgType, orgIdForIntegrations],
    queryFn: async () => {
      const params = new URLSearchParams({ orgType, orgId: orgIdForIntegrations });
      const response = await fetch(
        getApiUrl(`/api/org-integration-configs?${params}`),
        { credentials: "include" },
      );
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.error || "Failed to load organization integration defaults");
      }
      return payload as { configs: OrgIntegrationConfigRow[] };
    },
    enabled: !!orgIdForIntegrations,
  });

  const { data: effectiveData } = useQuery<{
    integrations?: Array<{
      categoryKey: string;
      source?: string;
      toolCatalogId?: string | null;
      config?: Record<string, string>;
    }>;
  }>({
    queryKey: ["/api/projects", projectId, "integration-effective"],
    queryFn: async () => {
      const res = await fetch(
        getApiUrl(`/api/projects/${projectId}/integration-effective`),
        { credentials: "include" },
      );
      if (!res.ok) return { integrations: [] };
      return res.json();
    },
    enabled: !!projectId,
  });

  const groupedCatalog = useMemo(() => {
    const all = groupToolCatalogByCategory(catalogResponse?.tools || []);
    return Object.fromEntries(
      Object.entries(all).filter(([cat]) =>
        (BUILD_DEPLOY_CATEGORIES as readonly string[]).includes(cat),
      ),
    );
  }, [catalogResponse?.tools]);

  const orgByCategory = useMemo(
    () => buildOrgConfigByCategory(orgConfigsData?.configs),
    [orgConfigsData?.configs],
  );

  useEffect(() => {
    setToolConfigs({});
    setSkippedCategories({});
    setInheritFromOrg({});
    setToolTestStatus({});
    setToolTestMessage({});
  }, [projectId, orgIdForIntegrations]);

  useEffect(() => {
    const list = orgConfigsData?.configs;
    if (!list || Object.keys(groupedCatalog).length === 0) return;
    setInheritFromOrg((prev) => {
      const next: Record<string, boolean> = { ...prev };
      for (const cat of Object.keys(groupedCatalog)) {
        const hasOrg = list.some((c) => c.categoryKey === cat);
        if (prev[cat] === undefined) {
          next[cat] = hasOrg;
        } else if (!hasOrg) {
          next[cat] = false;
        }
      }
      return next;
    });
  }, [orgConfigsData, groupedCatalog]);

  useEffect(() => {
    const integrations = effectiveData?.integrations ?? [];
    if (integrations.length === 0) return;

    const nextConfigs: Record<string, ToolConfigState> = {};
    const nextInherit: Record<string, boolean> = {};
    const nextSkipped: Record<string, boolean> = {};

    for (const item of integrations) {
      if (!(BUILD_DEPLOY_CATEGORIES as readonly string[]).includes(item.categoryKey)) {
        continue;
      }
      if (item.source === "org_default") {
        nextInherit[item.categoryKey] = true;
        continue;
      }
      if (item.toolCatalogId) {
        nextConfigs[item.categoryKey] = {
          providerId: item.toolCatalogId,
          values: item.config ?? {},
        };
        nextInherit[item.categoryKey] = false;
      } else {
        nextSkipped[item.categoryKey] = true;
      }
    }

    setToolConfigs(nextConfigs);
    setInheritFromOrg((prev) => ({ ...prev, ...nextInherit }));
    setSkippedCategories(nextSkipped);
  }, [effectiveData]);

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
      if (!response.ok) {
        throw new Error(result.message || result.error || "Connection test failed");
      }
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
      setToolTestMessage((prev) => ({
        ...prev,
        [variables.category]: error.message,
      }));
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
      if (!response.ok) {
        throw new Error(result.message || "Connection test failed");
      }
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
      setToolTestMessage((prev) => ({
        ...prev,
        [variables.category]: error.message,
      }));
    },
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      await applyProjectIntegrationConfigs(projectId, {
        groupedCatalogKeys: Object.keys(groupedCatalog),
        skippedCategories,
        inheritFromOrg,
        toolConfigs,
        orgByCategory,
      });
    },
    onSuccess: async () => {
      toast({
        title: "Saved",
        description: "Repository and CI/CD settings were saved for this project.",
      });
      await queryClient.invalidateQueries({
        queryKey: ["/api/projects", projectId, "integration-effective"],
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Save failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const orgMissing = !orgIdForIntegrations;

  return (
    <Card className="rounded-2xl shadow-sm border border-border/40 border-l-[3px] border-l-cyan-500">
      <CardHeader className="space-y-1">
        <CardTitle className="flex items-center gap-2">
          <GitBranch className="h-5 w-5 text-cyan-500" />
          Repository &amp; CI/CD (project-scoped)
        </CardTitle>
        <CardDescription>
          Configure the source repository and CI/CD provider used by the SDLC Build &amp; Deployment
          card for <span className="font-medium text-foreground">{project?.name ?? "this project"}</span>.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Current configured status summary */}
        {(effectiveData?.integrations ?? []).filter(
          (item) => (BUILD_DEPLOY_CATEGORIES as readonly string[]).includes(item.categoryKey)
        ).length > 0 && (
          <div className="rounded-md border border-border/40 bg-muted/20 p-3 space-y-2">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Currently configured</p>
            <div className="flex flex-wrap gap-2">
              {(effectiveData?.integrations ?? [])
                .filter((item) => (BUILD_DEPLOY_CATEGORIES as readonly string[]).includes(item.categoryKey))
                .map((item) => (
                  <Badge
                    key={item.categoryKey}
                    variant="outline"
                    className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400 border-emerald-500/40 bg-emerald-500/5"
                  >
                    <CheckCircle2 className="h-3 w-3" />
                    <span className="capitalize">{item.categoryKey}</span>
                    {item.displayName && (
                      <span className="text-foreground font-medium">— {item.displayName}</span>
                    )}
                  </Badge>
                ))}
            </div>
          </div>
        )}

        {orgMissing ? (
          <p className="text-sm text-amber-600 dark:text-amber-400">
            Link this project to an Azure DevOps organization or Jira connection before configuring
            repository and CI/CD tools.
          </p>
        ) : Object.keys(groupedCatalog).length === 0 ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading tool catalog...
          </div>
        ) : (
          <>
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
              onTestCatalogTool={catalogTestMutation.mutate}
              onTestOrgIntegration={orgIntegrationTestMutation.mutate}
              catalogTestPending={catalogTestMutation.isPending}
              orgTestPendingCategory={
                orgIntegrationTestMutation.isPending
                  ? orgIntegrationTestMutation.variables?.category ?? null
                  : null
              }
            />
            <div className="flex justify-end pt-2">
              <Button
                onClick={() => saveMutation.mutate()}
                disabled={saveMutation.isPending || orgConfigsLoading}
              >
                {saveMutation.isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Save className="mr-2 h-4 w-4" />
                )}
                Save repository &amp; CI/CD
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
