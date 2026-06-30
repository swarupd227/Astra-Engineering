import type { Dispatch, SetStateAction } from "react";
import { CheckCircle2, Loader2, RefreshCw, XCircle } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatToolCategoryLabel } from "@/lib/tool-category-label";
import { RepoToolConfigurator } from "@/components/repo-tool-configurator";
import type { TestStatus, ToolCatalogItem, ToolConfigState } from "./types";
import { SKIP_CATEGORY_VALUE } from "./utils";

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

export interface AddOrgToolConfigStepProps {
  groupedCatalog: Record<string, ToolCatalogItem[]>;
  toolConfigs: Record<string, ToolConfigState>;
  existingConfigsByCategory?: Record<
    string,
    { id: string; toolCatalogId: string } | undefined
  >;
  setToolConfigs: Dispatch<SetStateAction<Record<string, ToolConfigState>>>;
  skippedCategories: Record<string, boolean>;
  setSkippedCategories: Dispatch<SetStateAction<Record<string, boolean>>>;
  toolTestStatus: Record<string, TestStatus>;
  toolTestMessage: Record<string, string>;
  setToolTestStatus: Dispatch<SetStateAction<Record<string, TestStatus>>>;
  setToolTestMessage: Dispatch<SetStateAction<Record<string, string>>>;
  onTestTool: (args: {
    category: string;
    toolCatalogId: string;
    config: Record<string, string>;
    orgIntegrationConfigId?: string;
  }) => void;
  testToolPending: boolean;
}

export function AddOrgToolConfigStep({
  groupedCatalog,
  toolConfigs,
  existingConfigsByCategory,
  setToolConfigs,
  skippedCategories,
  setSkippedCategories,
  toolTestStatus,
  toolTestMessage,
  setToolTestStatus,
  setToolTestMessage,
  onTestTool,
  testToolPending,
}: AddOrgToolConfigStepProps) {
  return (
    <div className="space-y-4">
      {Object.entries(groupedCatalog).map(([category, providers]) => {
        const categoryLabel = formatToolCategoryLabel(category);
        const skipped = !!skippedCategories[category];
        const selectValue = skipped ? SKIP_CATEGORY_VALUE : toolConfigs[category]?.providerId || "";
        const selectedProvider = providers.find((p) => p.id === toolConfigs[category]?.providerId);
        const existingConfig = existingConfigsByCategory?.[category];
        const supportsTest = (selectedProvider?.supportsTesting ?? 1) !== 0;

        return (
          <div
            key={category}
            id={`add-org-tool-category-${category}`}
            className="space-y-2 rounded-md border border-border/40 border-l-[3px] border-l-violet-500 p-3"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Label>{categoryLabel}</Label>
            </div>
            <Select
              value={selectValue}
              onValueChange={(value) => {
                if (value === SKIP_CATEGORY_VALUE) {
                  setSkippedCategories((prev) => ({ ...prev, [category]: true }));
                  setToolConfigs((prev) => {
                    const next = { ...prev };
                    delete next[category];
                    return next;
                  });
                  setToolTestStatus((prev) => ({ ...prev, [category]: "idle" }));
                  setToolTestMessage((prev) => ({ ...prev, [category]: "" }));
                  return;
                }
                setSkippedCategories((prev) => ({ ...prev, [category]: false }));
                setToolConfigs((prev) => ({ ...prev, [category]: { providerId: value, values: {} } }));
                setToolTestStatus((prev) => ({ ...prev, [category]: "idle" }));
                setToolTestMessage((prev) => ({ ...prev, [category]: "" }));
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder={`Select ${categoryLabel} provider or skip`} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={SKIP_CATEGORY_VALUE}>Skip (configure in project flow)</SelectItem>
                {providers.map((provider) => (
                  <SelectItem key={provider.id} value={provider.id}>
                    {provider.displayName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {!skipped && toolConfigs[category]?.providerId &&
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
                        values: { ...prev[category].values, [field.key]: e.target.value },
                      },
                    }));
                    setToolTestStatus((prev) => ({ ...prev, [category]: "idle" }));
                    setToolTestMessage((prev) => ({ ...prev, [category]: "" }));
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
                    setToolTestStatus((prev) => ({ ...prev, [category]: "idle" }));
                    setToolTestMessage((prev) => ({ ...prev, [category]: "" }));
                  }}
                  testStatus={toolTestStatus[category] || "idle"}
                  testMessage={toolTestMessage[category] || ""}
                  onConnectionResult={(status, message = "") => {
                    setToolTestStatus((prev) => ({ ...prev, [category]: status }));
                    setToolTestMessage((prev) => ({ ...prev, [category]: message }));
                  }}
                />
              )}

            {!skipped && toolConfigs[category]?.providerId && supportsTest && category !== "repo" && (
              <div className="pt-1">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() =>
                    onTestTool({
                      category,
                      toolCatalogId: toolConfigs[category].providerId,
                      config: toolConfigs[category].values || {},
                      orgIntegrationConfigId:
                        existingConfig?.toolCatalogId === toolConfigs[category].providerId
                          ? existingConfig.id
                          : undefined,
                    })
                  }
                  disabled={testToolPending}
                >
                  {toolTestStatus[category] === "testing" ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Testing...
                    </>
                  ) : (
                    <>
                      <RefreshCw className="mr-2 h-4 w-4" />
                      Test {categoryLabel}
                    </>
                  )}
                </Button>
                {toolTestStatus[category] === "success" && (
                  <p className="flex items-center gap-2 pt-2 text-sm text-emerald-600 dark:text-emerald-500">
                    <CheckCircle2 className="h-4 w-4" /> {toolTestMessage[category] || "Connection successful"}
                  </p>
                )}
                {toolTestStatus[category] === "error" && (
                  <p className="text-destructive flex items-center gap-2 pt-2 text-sm">
                    <XCircle className="h-4 w-4" /> {toolTestMessage[category] || "Connection failed"}
                  </p>
                )}
              </div>
            )}

            {!skipped && toolConfigs[category]?.providerId && !supportsTest && (
              <p className="text-muted-foreground text-xs">No automated connection test for this provider.</p>
            )}
          </div>
        );
      })}
    </div>
  );
}
