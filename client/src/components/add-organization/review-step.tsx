import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { formatToolCategoryLabel } from "@/lib/tool-category-label";
import type { AlmType, ToolCatalogItem, ToolConfigState } from "./types";
import { maskSensitiveValue } from "./utils";

export interface AddOrgReviewStepProps {
  integrationType: AlmType;
  almConfig: Record<string, string>;
  groupedCatalog: Record<string, ToolCatalogItem[]>;
  toolConfigs: Record<string, ToolConfigState>;
  skippedCategories: Record<string, boolean>;
  onEditAlm: () => void;
  onEditTools: (category?: string) => void;
}

export function AddOrgReviewStep({
  integrationType,
  almConfig,
  groupedCatalog,
  toolConfigs,
  skippedCategories,
  onEditAlm,
  onEditTools,
}: AddOrgReviewStepProps) {
  const categories = Object.keys(groupedCatalog);

  return (
    <div className="space-y-4 text-sm">
      <div className="rounded-2xl border border-border/40 border-l-[3px] border-l-blue-500 bg-card p-4 shadow-sm">
        <div className="mb-2 flex items-center justify-between gap-2">
          <h3 className="font-semibold text-foreground">ALM</h3>
          <Button type="button" variant="ghost" size="sm" className="gap-1" onClick={onEditAlm}>
            <Pencil className="h-3.5 w-3.5" />
            Edit
          </Button>
        </div>
        <p className="text-muted-foreground">
          <span className="font-medium text-foreground">Type:</span> {integrationType.toUpperCase()}
        </p>
        {integrationType === "ado" ? (
          <ul className="mt-2 space-y-1">
            <li>
              <span className="text-muted-foreground">Organization URL:</span>{" "}
              <span className="break-all text-foreground">{almConfig.organizationUrl || "—"}</span>
            </li>
            <li>
              <span className="text-muted-foreground">PAT:</span>{" "}
              {almConfig.patToken?.trim() ? maskSensitiveValue("patToken", almConfig.patToken) : "—"}
            </li>
          </ul>
        ) : (
          <ul className="mt-2 space-y-1">
            <li>
              <span className="text-muted-foreground">Instance URL:</span>{" "}
              <span className="break-all text-foreground">{almConfig.instanceUrl || "—"}</span>
            </li>
            <li>
              <span className="text-muted-foreground">Email:</span>{" "}
              <span className="text-foreground">{almConfig.email || "—"}</span>
            </li>
            <li>
              <span className="text-muted-foreground">API token:</span>{" "}
              {almConfig.apiToken?.trim() ? maskSensitiveValue("apiToken", almConfig.apiToken) : "—"}
            </li>
          </ul>
        )}
      </div>

      <div className="rounded-2xl border border-border/40 border-l-[3px] border-l-violet-500 bg-card p-4 shadow-sm">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h3 className="font-semibold text-foreground">Tool integrations</h3>
          <Button type="button" variant="ghost" size="sm" className="gap-1" onClick={() => onEditTools()}>
            <Pencil className="h-3.5 w-3.5" />
            Edit all
          </Button>
        </div>
        <div className="space-y-3">
          {categories.map((category) => {
            const skipped = !!skippedCategories[category];
            const cfg = toolConfigs[category];
            const provider = groupedCatalog[category]?.find((p) => p.id === cfg?.providerId);

            return (
              <div
                key={category}
                className="flex flex-col gap-2 rounded-lg border border-border/30 p-3 sm:flex-row sm:items-start sm:justify-between"
              >
                <div className="min-w-0 flex-1 space-y-1">
                  <Label className="text-foreground">{formatToolCategoryLabel(category)}</Label>
                  {skipped ? (
                    <p className="text-muted-foreground">Skipped — configure in project creation.</p>
                  ) : provider && cfg?.providerId ? (
                    <>
                      <p className="font-medium text-foreground">{provider.displayName}</p>
                      <ul className="text-muted-foreground space-y-0.5 text-xs">
                        {provider.requiredFields.map((field) => (
                          <li key={field.key}>
                            {field.label}:{" "}
                            <span className="text-foreground">
                              {maskSensitiveValue(field.key, cfg.values[field.key] || "") || "—"}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </>
                  ) : (
                    <p className="text-destructive text-xs">Incomplete — go back to tool step.</p>
                  )}
                </div>
                <Button type="button" variant="outline" size="sm" className="shrink-0" onClick={() => onEditTools(category)}>
                  <Pencil className="mr-1 h-3.5 w-3.5" />
                  Edit
                </Button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
