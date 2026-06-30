import type { Dispatch, SetStateAction } from "react";
import { useMemo } from "react";
import { CheckCircle2, Loader2, RefreshCw, XCircle } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { formatToolCategoryLabel } from "@/lib/tool-category-label";
import { RepoToolConfigurator } from "@/components/repo-tool-configurator";
import type {
  CatalogToolItem,
  OrgIntegrationConfigRow,
  TestStatus,
  ToolConfigState,
} from "./types";
import { SKIP_CATEGORY_VALUE } from "./utils";

/** One grid template for skip-all + every category so toggle/label columns share one vertical line. */
const TOOL_TOGGLE_HEAD_GRID =
  "grid grid-cols-1 gap-x-4 gap-y-2 sm:grid-cols-[minmax(0,1fr)_28rem] sm:items-center sm:gap-x-0";
/** Fixed max width + end-justify in the grid cell so rows hug the right (border) edge with aligned switches. */
const TOOL_TOGGLE_TRACK =
  "flex w-[min(100%,17.25rem)] min-w-0 shrink-0 items-center justify-start gap-2 justify-self-end sm:translate-x-12";
const REPO_CONFIGURATOR_FIELD_KEYS = new Set([
  "apiToken",
  "appPassword",
  "patToken",
  "projectId",
  "repository",
  "repositoryId",
  "repositorySlug",
  "token",
]);

export interface CreateProjectToolStepProps {
  groupedCatalog: Record<string, CatalogToolItem[]>;
  orgByCategory: Record<string, OrgIntegrationConfigRow | undefined>;
  orgConfigsLoading: boolean;
  skippedCategories: Record<string, boolean>;
  setSkippedCategories: Dispatch<SetStateAction<Record<string, boolean>>>;
  inheritFromOrg: Record<string, boolean>;
  setInheritFromOrg: Dispatch<SetStateAction<Record<string, boolean>>>;
  toolConfigs: Record<string, ToolConfigState>;
  setToolConfigs: Dispatch<SetStateAction<Record<string, ToolConfigState>>>;
  toolTestStatus: Record<string, TestStatus>;
  toolTestMessage: Record<string, string>;
  setToolTestStatus: Dispatch<SetStateAction<Record<string, TestStatus>>>;
  setToolTestMessage: Dispatch<SetStateAction<Record<string, string>>>;
  onTestCatalogTool: (args: {
    category: string;
    toolCatalogId: string;
    config: Record<string, string>;
  }) => void;
  onTestOrgIntegration: (args: {
    category: string;
    orgIntegrationConfigId: string;
  }) => void;
  projectConfigIdsByCategory?: Record<string, string>;
  /** toolCatalogId saved in DB per category — detects provider switches in edit flow */
  projectSavedCatalogIdsByCategory?: Record<string, string>;
  onClearSavedProjectConfig?: (category: string) => void;
  onTestProjectIntegration?: (args: {
    category: string;
    projectIntegrationConfigId: string;
    config: Record<string, string>;
  }) => void;
  projectTestPendingCategory?: string | null;
  catalogTestPending: boolean;
  orgTestPendingCategory: string | null;
}

export function CreateProjectToolConfigurationStep({
  groupedCatalog,
  orgByCategory,
  orgConfigsLoading,
  skippedCategories,
  setSkippedCategories,
  inheritFromOrg,
  setInheritFromOrg,
  toolConfigs,
  setToolConfigs,
  toolTestStatus,
  toolTestMessage,
  setToolTestStatus,
  setToolTestMessage,
  onTestCatalogTool,
  onTestOrgIntegration,
  projectConfigIdsByCategory,
  projectSavedCatalogIdsByCategory,
  onClearSavedProjectConfig,
  onTestProjectIntegration,
  projectTestPendingCategory,
  catalogTestPending,
  orgTestPendingCategory,
}: CreateProjectToolStepProps) {
  return (
    <TooltipProvider delayDuration={200}>
      <div className="space-y-4">
        {orgConfigsLoading && (
          <p className="text-muted-foreground text-sm">
            Loading organization tool defaults…
          </p>
        )}
        {Object.entries(groupedCatalog).map(([category, providers]) => {
          const categoryLabel = formatToolCategoryLabel(category);
          const isRepositoryCategory = category === "repo";
          const orgRow = orgByCategory[category];
          const hasOrgDefault = !isRepositoryCategory && !!orgRow;
          const inheritSwitchEnabled = !orgConfigsLoading && hasOrgDefault;
          const inherit = !!inheritFromOrg[category] && hasOrgDefault;
          const skipped = !!skippedCategories[category];
          const selectValue = skipped
            ? SKIP_CATEGORY_VALUE
            : toolConfigs[category]?.providerId || "";
          const selectedProvider = providers.find(
            (p) => p.id === toolConfigs[category]?.providerId,
          );
          const supportsTest = (selectedProvider?.supportsTesting ?? 1) !== 0;
          const orgSupportsTest = (orgRow?.supportsTesting ?? 1) !== 0;

          return (
            <div
              key={category}
              className="space-y-3 rounded-md border border-border/40 border-l-[3px] border-l-cyan-500 p-3"
            >
              <div className={TOOL_TOGGLE_HEAD_GRID}>
                <Label className="min-w-0">{categoryLabel}</Label>
                {inheritSwitchEnabled && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div className={TOOL_TOGGLE_TRACK}>
                        <Switch
                          id={`inherit-${category}`}
                          checked={inherit}
                          onCheckedChange={(checked) => {
                            setInheritFromOrg((prev) => ({
                              ...prev,
                              [category]: checked,
                            }));
                            if (checked) {
                              setSkippedCategories((prev) => ({
                                ...prev,
                                [category]: false,
                              }));
                              setToolConfigs((prev) => {
                                const next = { ...prev };
                                delete next[category];
                                return next;
                              });
                              setToolTestStatus((prev) => ({
                                ...prev,
                                [category]: "idle",
                              }));
                              setToolTestMessage((prev) => ({
                                ...prev,
                                [category]: "",
                              }));
                            }
                          }}
                        />
                        <Label
                          htmlFor={`inherit-${category}`}
                          className="text-muted-foreground min-w-0 truncate cursor-pointer text-sm font-normal"
                        >
                          Use organization default
                        </Label>
                      </div>
                    </TooltipTrigger>
                    <TooltipContent side="top" className="max-w-xs text-left">
                      Use the integration saved for this organization when adding it in DevX.
                    </TooltipContent>
                  </Tooltip>
                )}
              </div>

              {!orgConfigsLoading && !hasOrgDefault && (
                <p className="text-muted-foreground text-xs">
                  {isRepositoryCategory
                    ? "Repository credentials are user-specific. Configure your own PAT/API key below or skip this category."
                    : "No organization default is configured for this category. Configure it below, skip this category, or add an organization default later."}
                </p>
              )}

              {inherit && orgRow && (
                <div className="bg-muted/40 space-y-2 rounded-md p-3 text-sm">
                  <p className="font-medium text-foreground">
                    {orgRow.displayName}
                  </p>
                  <ul className="text-muted-foreground space-y-0.5 text-xs">
                    {Object.entries(orgRow.configDisplay || {}).map(
                      ([k, v]) => (
                        <li key={k}>
                          <span className="capitalize">{k}:</span>{" "}
                          <span className="text-foreground">{v || "—"}</span>
                        </li>
                      ),
                    )}
                  </ul>
                  {orgSupportsTest && (
                    <div className="pt-1">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          onTestOrgIntegration({
                            category,
                            orgIntegrationConfigId: orgRow.id,
                          })
                        }
                        disabled={!!orgTestPendingCategory}
                      >
                        {orgTestPendingCategory === category ? (
                          <>
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            Testing…
                          </>
                        ) : (
                          <>
                            <RefreshCw className="mr-2 h-4 w-4" />
                            Test inherited connection
                          </>
                        )}
                      </Button>
                      {toolTestStatus[category] === "success" && (
                        <p className="mt-2 flex items-center gap-2 text-xs text-emerald-600 dark:text-emerald-500">
                          <CheckCircle2 className="h-3.5 w-3.5" />{" "}
                          {toolTestMessage[category] || "OK"}
                        </p>
                      )}
                      {toolTestStatus[category] === "error" && (
                        <p className="text-destructive mt-2 flex items-center gap-2 text-xs">
                          <XCircle className="h-3.5 w-3.5" />{" "}
                          {toolTestMessage[category]}
                        </p>
                      )}
                    </div>
                  )}
                  {!orgSupportsTest && (
                    <p className="text-muted-foreground text-xs">
                      No automated test for this provider.
                    </p>
                  )}
                </div>
              )}

              {!inherit && (
                <>
                  <Select
                    value={selectValue}
                    onValueChange={(value) => {
                      if (value === SKIP_CATEGORY_VALUE) {
                        setSkippedCategories((prev) => ({
                          ...prev,
                          [category]: true,
                        }));
                        setToolConfigs((prev) => {
                          const next = { ...prev };
                          delete next[category];
                          return next;
                        });
                        setToolTestStatus((prev) => ({
                          ...prev,
                          [category]: "idle",
                        }));
                        setToolTestMessage((prev) => ({
                          ...prev,
                          [category]: "",
                        }));
                        return;
                      }
                      setSkippedCategories((prev) => ({
                        ...prev,
                        [category]: false,
                      }));
                      setToolConfigs((prev) => ({
                        ...prev,
                        [category]: { providerId: value, values: {} },
                      }));
                      onClearSavedProjectConfig?.(category);
                      setToolTestStatus((prev) => ({
                        ...prev,
                        [category]: "idle",
                      }));
                      setToolTestMessage((prev) => ({
                        ...prev,
                        [category]: "",
                      }));
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue
                        placeholder={`Select ${categoryLabel} provider or skip`}
                      />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={SKIP_CATEGORY_VALUE}>Skip</SelectItem>
                      {providers.map((provider) => (
                        <SelectItem key={provider.id} value={provider.id}>
                          {provider.displayName}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  {!skipped &&
                    toolConfigs[category]?.providerId &&
                    selectedProvider?.requiredFields
                      .filter(
                        (field) =>
                          category !== "repo" ||
                          !REPO_CONFIGURATOR_FIELD_KEYS.has(field.key),
                      )
                      .map((field) => (
                      <Input
                        key={`${category}-${field.key}`}
                        type={field.type === "password" ? "password" : "text"}
                        placeholder={field.label}
                        value={toolConfigs[category]?.values[field.key] || ""}
                        onChange={(e) => {
                          setToolConfigs((prev) => ({
                            ...prev,
                            [category]: {
                              providerId: prev[category].providerId,
                              values: {
                                ...prev[category].values,
                                [field.key]: e.target.value,
                              },
                            },
                          }));
                          setToolTestStatus((prev) => ({
                            ...prev,
                            [category]: "idle",
                          }));
                          setToolTestMessage((prev) => ({
                            ...prev,
                            [category]: "",
                          }));
                        }}
                      />
                    ))}

                  {!skipped &&
                    category === "repo" &&
                    toolConfigs[category]?.providerId &&
                    selectedProvider && (
                      <RepoToolConfigurator
                        toolCatalogId={toolConfigs[category].providerId}
                        providerKey={selectedProvider.providerKey}
                        providerLabel={selectedProvider.displayName}
                        values={toolConfigs[category]?.values || {}}
                        onValuesChange={(updater) => {
                          setToolConfigs((prev) => ({
                            ...prev,
                            [category]: {
                              providerId: prev[category].providerId,
                              values: updater(prev[category].values || {}),
                            },
                          }));
                        }}
                        onConfigChanged={() => {
                          setToolTestStatus((prev) => ({
                            ...prev,
                            [category]: "idle",
                          }));
                          setToolTestMessage((prev) => ({
                            ...prev,
                            [category]: "",
                          }));
                        }}
                        testStatus={toolTestStatus[category] || "idle"}
                        testMessage={toolTestMessage[category] || ""}
                        preserveExistingCredentialHint={Boolean(
                          projectConfigIdsByCategory?.[category],
                        )}
                        onConnectionResult={(status, message = "") => {
                          setToolTestStatus((prev) => ({
                            ...prev,
                            [category]: status,
                          }));
                          setToolTestMessage((prev) => ({
                            ...prev,
                            [category]: message,
                          }));
                        }}
                      />
                    )}

                  {!skipped &&
                    toolConfigs[category]?.providerId &&
                    supportsTest &&
                    category !== "repo" && (
                      <div className="pt-1">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            const values = toolConfigs[category].values || {};
                            const savedId = projectConfigIdsByCategory?.[category];
                            const savedCatalogId =
                              projectSavedCatalogIdsByCategory?.[category];
                            const currentCatalogId =
                              toolConfigs[category].providerId;
                            const useSavedRowTest =
                              Boolean(savedId && onTestProjectIntegration) &&
                              savedCatalogId === currentCatalogId;
                            if (useSavedRowTest && onTestProjectIntegration) {
                              onTestProjectIntegration({
                                category,
                                projectIntegrationConfigId: savedId!,
                                config: values,
                              });
                              return;
                            }
                            onTestCatalogTool({
                              category,
                              toolCatalogId: toolConfigs[category].providerId,
                              config: values,
                            });
                          }}
                          disabled={
                            catalogTestPending ||
                            projectTestPendingCategory === category
                          }
                        >
                          {toolTestStatus[category] === "testing" ? (
                            <>
                              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                              Testing…
                            </>
                          ) : (
                            <>
                              <RefreshCw className="mr-2 h-4 w-4" />
                              Test connection
                            </>
                          )}
                        </Button>
                        {toolTestStatus[category] === "success" && (
                          <p className="mt-2 flex items-center gap-2 text-sm text-emerald-600 dark:text-emerald-500">
                            <CheckCircle2 className="h-4 w-4" />{" "}
                            {toolTestMessage[category] ||
                              "Connection successful"}
                          </p>
                        )}
                        {toolTestStatus[category] === "error" && (
                          <p className="text-destructive mt-2 flex items-center gap-2 text-sm">
                            <XCircle className="h-4 w-4" />{" "}
                            {toolTestMessage[category] || "Connection failed"}
                          </p>
                        )}
                      </div>
                    )}

                  {!skipped &&
                    toolConfigs[category]?.providerId &&
                    !supportsTest && (
                      <p className="text-muted-foreground text-xs">
                        No automated connection test for this provider.
                      </p>
                    )}
                </>
              )}
            </div>
          );
        })}
      </div>
    </TooltipProvider>
  );
}
