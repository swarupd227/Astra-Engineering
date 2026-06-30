import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Building2,
  CheckCircle2,
  Loader2,
  RefreshCw,
  XCircle,
} from "lucide-react";
import { GenericModal } from "@/components/ui/generic-modal";
import { WizardProgress } from "@/components/ui/wizard-progress";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { getApiUrl } from "@/lib/api-config";
import { useToast } from "@/hooks/use-toast";
import { getIntegrationLabels } from "@/lib/integration-config";
import type {
  AlmType,
  TestStatus,
  ToolCatalogItem,
  ToolConfigState,
} from "./types";
import {
  ADD_ORG_STEPS,
  ADD_ORG_STEP_SHORT,
  ADD_ORG_WIZARD_STEP_COPY,
  groupToolCatalogByCategory,
  isAddOrgToolStepComplete,
} from "./utils";
import { AddOrgToolConfigStep } from "./tool-config-step";
import { AddOrgReviewStep } from "./review-step";

type AddOrganizationSuccessPayload = {
  id: string;
  integrationType: AlmType;
  isEditMode: boolean;
};

interface AddOrganizationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: (organization?: AddOrganizationSuccessPayload) => void;
  editTarget?: {
    id: string;
    integrationType: AlmType;
    organizationUrl: string;
    email?: string;
    patConfigured?: boolean;
  } | null;
}

type OrgIntegrationConfigRow = {
  id: string;
  categoryKey: string;
  toolCatalogId: string;
  configDisplay: Record<string, string>;
  lastTestStatus: string | null;
  lastTestMessage: string | null;
  supportsTesting: number;
};

const SECRET_PLACEHOLDER = "********";

type AutoFilledToolValues = Record<
  string,
  { organizationUrl?: string; patToken?: string }
>;

function normalizeOrganizationUrl(value: string) {
  try {
    const parsed = new URL(value.trim());
    const pathname = parsed.pathname.replace(/\/+$/, "");
    return `${parsed.protocol}//${parsed.hostname}${pathname}`.toLowerCase();
  } catch {
    return value.trim().replace(/\/+$/, "").toLowerCase();
  }
}

function isSecretFieldKey(key: string) {
  const normalized = key.toLowerCase();
  return (
    normalized.includes("token") ||
    normalized.includes("password") ||
    normalized.includes("secret") ||
    normalized === "apikey" ||
    normalized === "applicationkey" ||
    normalized.includes("pat")
  );
}

function stripSecretPlaceholders(config: Record<string, string>) {
  return Object.fromEntries(
    Object.entries(config).filter(([key, value]) => {
      if (!String(value || "").trim()) {
        return false;
      }
      if (isSecretFieldKey(key) && value === SECRET_PLACEHOLDER) {
        return false;
      }
      return true;
    }),
  );
}

function isAzureDevOpsTool(provider?: ToolCatalogItem) {
  return (
    provider?.providerKey === "azure_pipelines" ||
    provider?.providerKey === "azure_repos"
  );
}

function mergeAzureDevOpsToolValues(
  values: Record<string, string>,
  almConfig: Record<string, string>,
  previousAutoValues: { organizationUrl?: string; patToken?: string } = {},
) {
  const nextValues = { ...values };
  const nextAutoValues = { ...previousAutoValues };
  let changed = false;

  const organizationUrl = almConfig.organizationUrl.trim();
  if (
    organizationUrl &&
    ((!nextValues.organizationUrl?.trim() &&
      previousAutoValues.organizationUrl === undefined) ||
      nextValues.organizationUrl === previousAutoValues.organizationUrl)
  ) {
    nextValues.organizationUrl = organizationUrl;
    nextAutoValues.organizationUrl = organizationUrl;
    changed = true;
  }

  const patToken = almConfig.patToken.trim();
  if (
    patToken &&
    patToken !== SECRET_PLACEHOLDER &&
    ((!nextValues.patToken?.trim() &&
      previousAutoValues.patToken === undefined) ||
      nextValues.patToken === SECRET_PLACEHOLDER ||
      nextValues.patToken === previousAutoValues.patToken)
  ) {
    nextValues.patToken = patToken;
    nextAutoValues.patToken = patToken;
    changed = true;
  }

  return {
    values: changed ? nextValues : values,
    autoValues: nextAutoValues,
    changed,
  };
}

export function AddOrganizationDialog({
  open,
  onOpenChange,
  onSuccess,
  editTarget,
}: AddOrganizationDialogProps) {
  const { toast } = useToast();
  const isEditMode = !!editTarget;
  const [step, setStep] = useState(0);
  const [integrationType, setIntegrationType] = useState<AlmType>("ado");
  const [almConfig, setAlmConfig] = useState<Record<string, string>>({
    organizationUrl: "",
    patToken: "",
    instanceUrl: "",
    email: "",
    apiToken: "",
  });
  const [toolConfigs, setToolConfigs] = useState<
    Record<string, ToolConfigState>
  >({});
  const [skippedCategories, setSkippedCategories] = useState<
    Record<string, boolean>
  >({});
  const [almTestStatus, setAlmTestStatus] = useState<TestStatus>("idle");
  const [almTestMessage, setAlmTestMessage] = useState("");
  const [toolTestStatus, setToolTestStatus] = useState<
    Record<string, TestStatus>
  >({});
  const [toolTestMessage, setToolTestMessage] = useState<
    Record<string, string>
  >({});
  const [initializedKey, setInitializedKey] = useState<string | null>(null);
  const autoFilledToolValuesRef = useRef<AutoFilledToolValues>({});

  const { data: catalogResponse } = useQuery<{ tools: ToolCatalogItem[] }>({
    queryKey: ["/api/tool-catalog"],
    enabled: open,
  });

  const { data: artifactOrganizationsData } = useQuery<{
    organizations: Array<{ id: string; organizationUrl: string }>;
  }>({
    queryKey: ["/api/artifact-organizations"],
    enabled: open,
  });

  const { data: jiraConnectionsData } = useQuery<{
    connections: Array<{ id: string; instanceUrl: string }>;
  }>({
    queryKey: ["/api/jira/connections"],
    enabled: open,
  });

  const { data: orgConfigsData, isLoading: orgConfigsLoading } = useQuery<{
    configs: OrgIntegrationConfigRow[];
  }>({
    queryKey: [
      "/api/org-integration-configs",
      editTarget?.integrationType || "",
      editTarget?.id || "",
    ],
    queryFn: async () => {
      if (!editTarget) {
        return { configs: [] };
      }
      const params = new URLSearchParams({
        orgType: editTarget.integrationType,
        orgId: editTarget.id,
      });
      const response = await fetch(
        getApiUrl(`/api/org-integration-configs?${params.toString()}`),
        {
          credentials: "include",
        },
      );
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(
          payload?.error || "Failed to load organization integration configs",
        );
      }
      return payload as { configs: OrgIntegrationConfigRow[] };
    },
    enabled: open && isEditMode && !!editTarget?.id,
  });

  const groupedCatalog = useMemo(
    () => groupToolCatalogByCategory(catalogResponse?.tools || []),
    [catalogResponse?.tools],
  );
  const artifactOrganizations = artifactOrganizationsData?.organizations || [];
  const jiraConnections = jiraConnectionsData?.connections || [];
  const existingConfigsByCategory = useMemo(() => {
    const next: Record<string, OrgIntegrationConfigRow> = {};
    for (const row of orgConfigsData?.configs || []) {
      next[row.categoryKey] = row;
    }
    return next;
  }, [orgConfigsData?.configs]);

  useEffect(() => {
    if (open) {
      return;
    }
    setInitializedKey(null);
    autoFilledToolValuesRef.current = {};
  }, [open]);

  useEffect(() => {
    if (!open) return;

    const nextKey = isEditMode
      ? `edit:${editTarget?.integrationType || ""}:${editTarget?.id || ""}`
      : "create";

    if (initializedKey === nextKey) {
      return;
    }

    if (!catalogResponse?.tools) {
      return;
    }

    if (isEditMode && orgConfigsLoading) {
      return;
    }

    setStep(0);

    if (!isEditMode || !editTarget) {
      setIntegrationType("ado");
      setAlmConfig({
        organizationUrl: "",
        patToken: "",
        instanceUrl: "",
        email: "",
        apiToken: "",
      });
      setToolConfigs({});
      setSkippedCategories({});
      setAlmTestStatus("idle");
      setAlmTestMessage("");
      setToolTestStatus({});
      setToolTestMessage({});
      setInitializedKey(nextKey);
      autoFilledToolValuesRef.current = {};
      return;
    }

    const nextToolConfigs: Record<string, ToolConfigState> = {};
    const nextSkippedCategories: Record<string, boolean> = {};
    const nextToolTestStatus: Record<string, TestStatus> = {};
    const nextToolTestMessage: Record<string, string> = {};

    Object.keys(groupedCatalog).forEach((category) => {
      const existingRow = existingConfigsByCategory[category];
      if (!existingRow) {
        nextSkippedCategories[category] = true;
        nextToolTestStatus[category] = "idle";
        nextToolTestMessage[category] = "";
        return;
      }

      const provider = groupedCatalog[category]?.find(
        (item) => item.id === existingRow.toolCatalogId,
      );
      const values = Object.fromEntries(
        (provider?.requiredFields || []).map((field) => {
          const rawValue = existingRow.configDisplay?.[field.key] || "";
          return [
            field.key,
            isSecretFieldKey(field.key) && rawValue.trim()
              ? SECRET_PLACEHOLDER
              : rawValue,
          ];
        }),
      );

      nextSkippedCategories[category] = false;
      nextToolConfigs[category] = {
        providerId: existingRow.toolCatalogId,
        values,
      };
      nextToolTestStatus[category] =
        existingRow.lastTestStatus === "success"
          ? "success"
          : existingRow.lastTestStatus === "error"
            ? "error"
            : "idle";
      nextToolTestMessage[category] = existingRow.lastTestMessage || "";
    });

    setIntegrationType(editTarget.integrationType);
    setAlmConfig({
      organizationUrl:
        editTarget.integrationType === "ado" ? editTarget.organizationUrl : "",
      patToken:
        editTarget.integrationType === "ado" && editTarget.patConfigured
          ? SECRET_PLACEHOLDER
          : "",
      instanceUrl:
        editTarget.integrationType === "jira" ? editTarget.organizationUrl : "",
      email: editTarget.integrationType === "jira" ? editTarget.email || "" : "",
      apiToken:
        editTarget.integrationType === "jira" && editTarget.patConfigured
          ? SECRET_PLACEHOLDER
          : "",
    });
    setToolConfigs(nextToolConfigs);
    setSkippedCategories(nextSkippedCategories);
    setAlmTestStatus(editTarget.patConfigured ? "success" : "idle");
    setAlmTestMessage(
      editTarget.patConfigured ? "Existing credentials loaded" : "",
    );
    setToolTestStatus(nextToolTestStatus);
    setToolTestMessage(nextToolTestMessage);
    setInitializedKey(nextKey);
    autoFilledToolValuesRef.current = {};
  }, [
    open,
    isEditMode,
    editTarget,
    initializedKey,
    catalogResponse?.tools,
    groupedCatalog,
    existingConfigsByCategory,
    orgConfigsLoading,
  ]);

  useEffect(() => {
    if (integrationType !== "ado" || !almConfig.organizationUrl.trim()) {
      return;
    }

    let updatedAnyConfig = false;
    const nextToolConfigs: Record<string, ToolConfigState> = {};

    for (const [category, cfg] of Object.entries(toolConfigs)) {
      const selectedProvider = groupedCatalog[category]?.find(
        (item) => item.id === cfg.providerId,
      );

      if (!isAzureDevOpsTool(selectedProvider)) {
        nextToolConfigs[category] = cfg;
        continue;
      }

      const mergeResult = mergeAzureDevOpsToolValues(
        cfg.values || {},
        almConfig,
        autoFilledToolValuesRef.current[category],
      );
      autoFilledToolValuesRef.current[category] = mergeResult.autoValues;
      const updatedConfig =
        mergeResult.values === cfg.values
          ? cfg
          : { ...cfg, values: mergeResult.values };
      nextToolConfigs[category] = updatedConfig;
      if (updatedConfig !== cfg) {
        updatedAnyConfig = true;
      }
    }

    if (updatedAnyConfig) {
      setToolConfigs(nextToolConfigs);
    }

    if (almTestStatus !== "success") {
      return;
    }

    setToolTestStatus((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const [category, cfg] of Object.entries(nextToolConfigs)) {
        const selectedProvider = groupedCatalog[category]?.find(
          (item) => item.id === cfg.providerId,
        );
        const autoValues = autoFilledToolValuesRef.current[category];
        const usingAutoValues =
          cfg.values?.organizationUrl === autoValues?.organizationUrl &&
          (!autoValues?.patToken || cfg.values?.patToken === autoValues.patToken);
        if (
          isAzureDevOpsTool(selectedProvider) &&
          usingAutoValues &&
          next[category] !== "success"
        ) {
          next[category] = "success";
          changed = true;
        }
      }
      return changed ? next : prev;
    });

    setToolTestMessage((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const [category, cfg] of Object.entries(nextToolConfigs)) {
        const selectedProvider = groupedCatalog[category]?.find(
          (item) => item.id === cfg.providerId,
        );
        const autoValues = autoFilledToolValuesRef.current[category];
        const usingAutoValues =
          cfg.values?.organizationUrl === autoValues?.organizationUrl &&
          (!autoValues?.patToken || cfg.values?.patToken === autoValues.patToken);
        if (
          isAzureDevOpsTool(selectedProvider) &&
          usingAutoValues &&
          !next[category]
        ) {
          next[category] =
            almTestMessage || "Using tested Azure DevOps credentials";
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [
    almConfig,
    almTestMessage,
    almTestStatus,
    groupedCatalog,
    integrationType,
    toolConfigs,
  ]);

  const testAlmMutation = useMutation({
    mutationFn: async () => {
      setAlmTestStatus("testing");
      const endpoint =
        isEditMode && editTarget && integrationType === "ado"
          ? `/api/artifact-organizations/${editTarget.id}/test-ado`
          : integrationType === "ado"
            ? "/api/ado/test-connection"
            : "/api/jira/test-connection";
      const payload =
        integrationType === "ado"
          ? isEditMode && editTarget
            ? {
                organizationUrl: almConfig.organizationUrl,
                ...(almConfig.patToken.trim() &&
                almConfig.patToken !== SECRET_PLACEHOLDER
                  ? { patToken: almConfig.patToken }
                  : {}),
              }
            : {
                organizationUrl: almConfig.organizationUrl,
                pat: almConfig.patToken,
              }
          : isEditMode && editTarget
            ? {
                connectionId: editTarget.id,
                instanceUrl: almConfig.instanceUrl,
                email: almConfig.email,
                ...(almConfig.apiToken.trim() &&
                almConfig.apiToken !== SECRET_PLACEHOLDER
                  ? { apiToken: almConfig.apiToken }
                  : {}),
              }
            : {
                instanceUrl: almConfig.instanceUrl,
                email: almConfig.email,
                apiToken: almConfig.apiToken,
              };
      const response = await fetch(getApiUrl(endpoint), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(payload),
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(
          result.message || result.error || "Connection test failed",
        );
      return result;
    },
    onSuccess: (result) => {
      setAlmTestStatus("success");
      setAlmTestMessage(result?.message || "Connection successful");
    },
    onError: (error: Error) => {
      setAlmTestStatus("error");
      setAlmTestMessage(error.message);
    },
  });

  const saveOrgMutation = useMutation({
    mutationFn: async () => {
      if (!isEditMode) {
        if (integrationType === "ado") {
          const normalizedOrgUrl = normalizeOrganizationUrl(
            almConfig.organizationUrl,
          );
          const duplicateOrganization = artifactOrganizations.find(
            (org) =>
              normalizeOrganizationUrl(org.organizationUrl) === normalizedOrgUrl,
          );
          if (duplicateOrganization) {
            throw new Error(
              "This organization URL already exists in Client Settings.",
            );
          }
        } else {
          const normalizedInstanceUrl = normalizeOrganizationUrl(
            almConfig.instanceUrl,
          );
          const duplicateConnection = jiraConnections.find(
            (connection) =>
              normalizeOrganizationUrl(connection.instanceUrl) ===
              normalizedInstanceUrl,
          );
          if (duplicateConnection) {
            throw new Error(
              "This organization URL already exists in Client Settings.",
            );
          }
        }
      }

      if (!isEditMode) {
        const response =
          integrationType === "ado"
            ? await apiRequest("POST", "/api/artifact-organizations", {
                organizationUrl: almConfig.organizationUrl,
                patToken: almConfig.patToken,
              })
            : await apiRequest("POST", "/api/jira/connections", {
                name: almConfig.instanceUrl,
                instanceUrl: almConfig.instanceUrl,
                email: almConfig.email,
                apiToken: almConfig.apiToken,
              });
        return response.json();
      }

      if (!editTarget) {
        throw new Error("Missing edit target");
      }

      const mainResponse =
        integrationType === "ado"
          ? await apiRequest("PUT", `/api/artifact-organizations/${editTarget.id}`, {
              organizationUrl: almConfig.organizationUrl,
              ...(almConfig.patToken.trim() &&
              almConfig.patToken !== SECRET_PLACEHOLDER
                ? { patToken: almConfig.patToken }
                : {}),
            })
          : await apiRequest("PUT", `/api/jira/connections/${editTarget.id}`, {
              name: almConfig.instanceUrl,
              instanceUrl: almConfig.instanceUrl,
              email: almConfig.email,
              ...(almConfig.apiToken.trim() &&
              almConfig.apiToken !== SECRET_PLACEHOLDER
                ? { apiToken: almConfig.apiToken }
                : {}),
            });

      const orgId = editTarget.id;
      const categoryKeys = Object.keys(groupedCatalog);

      for (const category of categoryKeys) {
        const existingRow = existingConfigsByCategory[category];
        const skipped = !!skippedCategories[category];
        const cfg = toolConfigs[category];

        if (skipped || !cfg?.providerId) {
          if (existingRow) {
            await apiRequest(
              "DELETE",
              `/api/org-integration-configs/${existingRow.id}`,
            );
          }
          continue;
        }

        const selectedProvider = groupedCatalog[category]?.find(
          (item) => item.id === cfg.providerId,
        );
        if (!selectedProvider) {
          continue;
        }

        const configPayload = Object.fromEntries(
          Object.entries(cfg.values || {}).filter(([key, value]) => {
            if (!value.trim()) {
              return false;
            }
            if (value === SECRET_PLACEHOLDER && isSecretFieldKey(key)) {
              return false;
            }
            return true;
          }),
        );

        if (existingRow) {
          await apiRequest("PUT", `/api/org-integration-configs/${existingRow.id}`, {
            toolCatalogId: cfg.providerId,
            config: configPayload,
          });
        } else {
          const createPayload = Object.fromEntries(
            Object.entries(cfg.values || {}).filter(([, value]) =>
              String(value || "").trim(),
            ),
          );
          await apiRequest("POST", "/api/org-integration-configs", {
            orgType: integrationType,
            orgId,
            toolCatalogId: cfg.providerId,
            config: createPayload,
          });
        }
      }

      return mainResponse.json();
    },
    onSuccess: async (result) => {
      let successPayload: AddOrganizationSuccessPayload | undefined;

      if (!isEditMode) {
        const orgId =
          integrationType === "ado"
            ? ((result?.organization?.id as string | undefined) ??
              (result?.id as string | undefined))
            : (result?.id as string | undefined);
        if (!orgId) {
          toast({
            title: "Organization created",
            description:
              "Could not read organization id from response; tool defaults were not saved.",
            variant: "destructive",
          });
          queryClient.invalidateQueries({
            queryKey: ["/api/artifact-organizations"],
          });
          queryClient.invalidateQueries({ queryKey: ["/api/jira/connections"] });
          onOpenChange(false);
          onSuccess?.();
          return;
        }
        successPayload = {
          id: orgId,
          integrationType,
          isEditMode: false,
        };
        const orgType = integrationType;
        const tasks = Object.values(toolConfigs).filter((cfg) => cfg.providerId);
        for (const cfg of tasks) {
          await apiRequest("POST", "/api/org-integration-configs", {
            orgType,
            orgId,
            toolCatalogId: cfg.providerId,
            config: cfg.values,
          });
        }
      } else if (editTarget) {
        successPayload = {
          id: editTarget.id,
          integrationType: editTarget.integrationType,
          isEditMode: true,
        };
      }
      queryClient.invalidateQueries({
        queryKey: ["/api/artifact-organizations"],
      });
      queryClient.invalidateQueries({ queryKey: ["/api/jira/connections"] });
      queryClient.invalidateQueries({ queryKey: ["/api/tool-catalog"] });
      if (isEditMode && editTarget) {
        queryClient.invalidateQueries({
          queryKey: [
            "/api/org-integration-configs",
            editTarget.integrationType,
            editTarget.id,
          ],
        });
      }
      toast({
        title: isEditMode ? "Organization Updated" : "Organization Added",
        description: isEditMode
          ? "Organization configuration updated successfully."
          : "Organization configuration saved successfully.",
      });
      onOpenChange(false);
      onSuccess?.(successPayload);
    },
    onError: (error: Error) => {
      toast({
        title: isEditMode
          ? "Failed to update organization"
          : "Failed to add organization",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const testToolMutation = useMutation({
    mutationFn: async ({
      category,
      toolCatalogId,
      config,
      orgIntegrationConfigId,
    }: {
      category: string;
      toolCatalogId: string;
      config: Record<string, string>;
      orgIntegrationConfigId?: string;
    }) => {
      setToolTestStatus((prev) => ({ ...prev, [category]: "testing" }));
      setToolTestMessage((prev) => ({ ...prev, [category]: "" }));
      const sanitizedConfig = stripSecretPlaceholders(config);
      const endpoint = orgIntegrationConfigId
        ? `/api/org-integration-configs/${orgIntegrationConfigId}/test`
        : `/api/tool-catalog/${toolCatalogId}/test`;
      const response = await fetch(
        getApiUrl(endpoint),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ config: sanitizedConfig }),
        },
      );
      const result = await response.json();
      if (!response.ok) {
        throw new Error(
          result.message || result.error || "Connection test failed",
        );
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

  const toolStepComplete = isAddOrgToolStepComplete(
    groupedCatalog,
    skippedCategories,
    toolConfigs,
    toolTestStatus,
  );
  const isEditLoading =
    isEditMode && (!initializedKey || (orgConfigsLoading && !orgConfigsData));

  const canGoNext =
    (step === 0 &&
      !isEditLoading &&
      almTestStatus === "success" &&
      (integrationType === "ado"
        ? !!almConfig.organizationUrl.trim() && !!almConfig.patToken.trim()
        : !!almConfig.instanceUrl.trim() &&
          !!almConfig.email.trim() &&
          !!almConfig.apiToken.trim())) ||
    (step === 1 && !isEditLoading && toolStepComplete) ||
    step >= 2;

  const goToToolStepAndFocus = (category?: string) => {
    setStep(1);
    if (category) {
      requestAnimationFrame(() => {
        document
          .getElementById(`add-org-tool-category-${category}`)
          ?.scrollIntoView({ behavior: "smooth", block: "center" });
      });
    }
  };

  const footerButtons = [
    {
      label: step === 0 ? "Cancel" : "Back",
      onClick: () =>
        step === 0 ? onOpenChange(false) : setStep((prev) => prev - 1),
      variant: "outline" as const,
    },
    {
      label:
        step === ADD_ORG_STEPS.length - 1
          ? isEditMode
            ? "Save Changes"
            : "Save Organization"
          : "Next",
      onClick: () =>
        step === ADD_ORG_STEPS.length - 1
          ? saveOrgMutation.mutate()
          : setStep((prev) => prev + 1),
      disabled:
        step === ADD_ORG_STEPS.length - 1
          ? saveOrgMutation.isPending || isEditLoading
          : !canGoNext,
      loading: saveOrgMutation.isPending,
    },
  ];

  return (
    <GenericModal
      open={open}
      onOpenChange={onOpenChange}
      title={isEditMode ? "Edit Organization" : "Add Organization"}
      description={`Step ${step + 1} of ${ADD_ORG_STEPS.length}: ${ADD_ORG_STEPS[step]}`}
      descriptionClassName="sr-only"
      icon={Building2}
      iconClassName="bg-gradient-to-br from-blue-500 to-blue-600"
      contentClassName="space-y-4"
      footerButtons={footerButtons}
      closeOnOverlayClick={false}
    >
      <>
        <WizardProgress
          currentStepIndex={step}
          totalSteps={ADD_ORG_STEPS.length}
          stepLabels={ADD_ORG_STEP_SHORT}
        />
        <div className="space-y-2">
          <h2 className="text-foreground text-lg font-semibold tracking-tight sm:text-xl">
            {ADD_ORG_WIZARD_STEP_COPY[step]?.title}
          </h2>
          <p className="text-muted-foreground max-w-2xl text-sm leading-relaxed">
            {ADD_ORG_WIZARD_STEP_COPY[step]?.subtitle}
          </p>
        </div>
        {step === 0 && (
          <div className="space-y-4">
            <RadioGroup
              value={integrationType}
              onValueChange={(val: AlmType) => {
                if (isEditMode) return;
                setIntegrationType(val);
              }}
              className="flex gap-4"
            >
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="ado" id="alm-ado" disabled={isEditMode} />
                <Label htmlFor="alm-ado">
                  {getIntegrationLabels("ado").longName}
                </Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="jira" id="alm-jira" disabled={isEditMode} />
                <Label htmlFor="alm-jira">
                  {getIntegrationLabels("jira").name}
                </Label>
              </div>
            </RadioGroup>

            {isEditLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading organization configuration...
              </div>
            ) : integrationType === "ado" ? (
              <>
                <Input
                  placeholder="Organization URL"
                  value={almConfig.organizationUrl}
                  onChange={(e) =>
                    {
                      setAlmConfig((prev) => ({
                        ...prev,
                        organizationUrl: e.target.value,
                      }));
                      setAlmTestStatus("idle");
                      setAlmTestMessage("");
                    }
                  }
                />
                <Input
                  type="password"
                  placeholder="PAT Token"
                  value={almConfig.patToken}
                  onChange={(e) => {
                    setAlmConfig((prev) => ({
                      ...prev,
                      patToken: e.target.value,
                    }));
                    setAlmTestStatus("idle");
                    setAlmTestMessage("");
                  }}
                />
              </>
            ) : (
              <>
                <Input
                  placeholder="Jira Base URL"
                  value={almConfig.instanceUrl}
                  onChange={(e) => {
                    setAlmConfig((prev) => ({
                      ...prev,
                      instanceUrl: e.target.value,
                    }));
                    setAlmTestStatus("idle");
                    setAlmTestMessage("");
                  }}
                />
                <Input
                  placeholder="Email"
                  value={almConfig.email}
                  onChange={(e) => {
                    setAlmConfig((prev) => ({ ...prev, email: e.target.value }));
                    setAlmTestStatus("idle");
                    setAlmTestMessage("");
                  }}
                />
                <Input
                  type="password"
                  placeholder="API Token"
                  value={almConfig.apiToken}
                  onChange={(e) => {
                    setAlmConfig((prev) => ({
                      ...prev,
                      apiToken: e.target.value,
                    }));
                    setAlmTestStatus("idle");
                    setAlmTestMessage("");
                  }}
                />
              </>
            )}

            <Button
              type="button"
              variant="outline"
              onClick={() => testAlmMutation.mutate()}
              disabled={testAlmMutation.isPending || isEditLoading}
            >
              {testAlmMutation.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="mr-2 h-4 w-4" />
              )}
              Test Connection
            </Button>

            {almTestStatus === "success" && (
              <p className="flex items-center gap-2 text-sm text-emerald-600 dark:text-emerald-500">
                <CheckCircle2 className="h-4 w-4" /> {almTestMessage}
              </p>
            )}
            {almTestStatus === "error" && (
              <p className="text-destructive flex items-center gap-2 text-sm">
                <XCircle className="h-4 w-4" /> {almTestMessage}
              </p>
            )}
          </div>
        )}

        {step === 1 && (
          <AddOrgToolConfigStep
            groupedCatalog={groupedCatalog}
            toolConfigs={toolConfigs}
            existingConfigsByCategory={Object.fromEntries(
              Object.entries(existingConfigsByCategory).map(([category, row]) => [
                category,
                row
                  ? {
                      id: row.id,
                      toolCatalogId: row.toolCatalogId,
                    }
                  : undefined,
              ]),
            )}
            setToolConfigs={setToolConfigs}
            skippedCategories={skippedCategories}
            setSkippedCategories={setSkippedCategories}
            toolTestStatus={toolTestStatus}
            toolTestMessage={toolTestMessage}
            setToolTestStatus={setToolTestStatus}
            setToolTestMessage={setToolTestMessage}
            onTestTool={(args) => testToolMutation.mutate(args)}
            testToolPending={testToolMutation.isPending}
          />
        )}

        {step === 2 && (
          <AddOrgReviewStep
            integrationType={integrationType}
            almConfig={almConfig}
            groupedCatalog={groupedCatalog}
            toolConfigs={toolConfigs}
            skippedCategories={skippedCategories}
            onEditAlm={() => setStep(0)}
            onEditTools={(category) => goToToolStepAndFocus(category)}
          />
        )}
      </>
    </GenericModal>
  );
}
