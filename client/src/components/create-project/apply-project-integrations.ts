import { apiRequest } from "@/lib/queryClient";
import type { OrgIntegrationConfigRow, ToolConfigState } from "./types";

export interface ProjectIntegrationApplyPayload {
  groupedCatalogKeys: string[];
  skippedCategories: Record<string, boolean>;
  inheritFromOrg: Record<string, boolean>;
  toolConfigs: Record<string, ToolConfigState>;
  orgByCategory: Record<string, OrgIntegrationConfigRow | undefined>;
}

export async function applyProjectIntegrationConfigs(
  projectId: string,
  p: ProjectIntegrationApplyPayload,
): Promise<void> {
  for (const categoryKey of p.groupedCatalogKeys) {
    const skipped = !!p.skippedCategories[categoryKey];
    const orgRow = p.orgByCategory[categoryKey];
    const inherit =
      categoryKey === "repo"
        ? false
        : !!p.inheritFromOrg[categoryKey] && !!orgRow;
    const cfg = p.toolConfigs[categoryKey];

    if (skipped && !inherit) {
      await apiRequest("POST", "/api/project-integration-configs", {
        projectId,
        categoryKey,
        skipped: true,
      });
      continue;
    }
    if (inherit && orgRow) {
      await apiRequest("POST", "/api/project-integration-configs", {
        projectId,
        categoryKey,
        useOrgDefault: true,
        orgIntegrationConfigId: orgRow.id,
        toolCatalogId: null,
        config: {},
      });
      continue;
    }
    if (!cfg?.providerId) {
      continue;
    }
    await apiRequest("POST", "/api/project-integration-configs", {
      projectId,
      categoryKey,
      useOrgDefault: false,
      orgIntegrationConfigId: null,
      toolCatalogId: cfg.providerId,
      config: cfg.values || {},
    });
  }
}
