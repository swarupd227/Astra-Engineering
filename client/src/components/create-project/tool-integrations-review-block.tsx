import { Label } from "@/components/ui/label";
import { formatToolCategoryLabel } from "@/lib/tool-category-label";
import type {
  CatalogToolItem,
  OrgIntegrationConfigRow,
  ToolConfigState,
} from "./types";

export interface ToolIntegrationsReviewBlockProps {
  groupedCatalog: Record<string, CatalogToolItem[]>;
  orgByCategory: Record<string, OrgIntegrationConfigRow | undefined>;
  skippedCategories: Record<string, boolean>;
  inheritFromOrg: Record<string, boolean>;
  toolConfigs: Record<string, ToolConfigState>;
}

export function ToolIntegrationsReviewBlock({
  groupedCatalog,
  orgByCategory,
  skippedCategories,
  inheritFromOrg,
  toolConfigs,
}: ToolIntegrationsReviewBlockProps) {
  return (
    <div className="rounded-2xl border border-border/40 border-l-[3px] border-l-violet-500 bg-card p-4 shadow-sm">
      <h3 className="mb-3 font-semibold text-foreground">Tool integrations</h3>
      <div className="space-y-3">
        {Object.keys(groupedCatalog).map((category) => {
          const skipped = !!skippedCategories[category];
          const orgRow = orgByCategory[category];
          const inherit = !!inheritFromOrg[category] && !!orgRow;
          const cfg = toolConfigs[category];
          const provider = groupedCatalog[category]?.find(
            (p) => p.id === cfg?.providerId,
          );

          return (
            <div
              key={category}
              className="rounded-lg border border-border/30 p-3"
            >
              <Label className="text-foreground">
                {formatToolCategoryLabel(category)}
              </Label>
              {skipped ? (
                <p className="text-muted-foreground mt-1">Skipped</p>
              ) : inherit && orgRow ? (
                <div className="mt-1 space-y-1">
                  <p className="text-foreground">
                    <span className="text-muted-foreground">Source:</span>{" "}
                    Inherited from organization
                  </p>
                  <p className="font-medium text-foreground">
                    {orgRow.displayName}
                  </p>
                  <ul className="text-muted-foreground mt-1 space-y-0.5 text-xs">
                    {Object.entries(orgRow.configDisplay || {}).map(([k, v]) => (
                      <li key={k}>
                        {k}: <span className="text-foreground">{v || "—"}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : provider && cfg?.providerId ? (
                <div className="mt-1 space-y-1">
                  <p className="text-foreground">
                    <span className="text-muted-foreground">Source:</span>{" "}
                    Project override
                  </p>
                  <p className="font-medium text-foreground">
                    {provider.displayName}
                  </p>
                  <ul className="text-muted-foreground mt-1 space-y-0.5 text-xs">
                    {provider.requiredFields.map((field) => (
                      <li key={field.key}>
                        {field.label}:{" "}
                        <span className="text-foreground">
                          {field.type === "password" && cfg.values[field.key]?.trim()
                            ? "••••"
                            : cfg.values[field.key] || "—"}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <p className="text-muted-foreground mt-1">Not set</p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
