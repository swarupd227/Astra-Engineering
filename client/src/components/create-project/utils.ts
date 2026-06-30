import type { CatalogToolItem, OrgIntegrationConfigRow, TestStatus, ToolConfigState } from "./types";

export const SKIP_CATEGORY_VALUE = "__skip_category__";

/** Matches server SECRET_PLACEHOLDER — masked values shown when editing saved configs. */
export const SECRET_PLACEHOLDER = "********";

export function isSecretPlaceholder(value: string): boolean {
  const v = String(value || "").trim();
  return v === SECRET_PLACEHOLDER || v === "••••";
}

// Jira-only wizard: skip "Integration Type" step — start straight at details
export const CREATE_PROJECT_STEPS = [
  "Project Details",
  "Golden Repository",
  "Tool Configuration",
  "Review",
  "Create",
] as const;

export const CREATE_PROJECT_STEP_SHORT = [
  "Details",
  "Golden repo",
  "Tools",
  "Review",
  "Create",
] as const;

export const CREATE_PROJECT_WIZARD_STEP_COPY: (null | { title: string; subtitle: string })[] = [
  {
    title: "Project details",
    subtitle: "Name your SDLC project and connect it to a Jira site.",
  },
  {
    title: "Golden repository",
    subtitle: "Optionally link guideline content from a golden repository to seed this project.",
  },
  {
    title: "Tools & integrations",
    subtitle: "Inherit organization defaults or configure DevX integrations category by category.",
  },
  {
    title: "Review",
    subtitle: "Double-check your choices before provisioning the project.",
  },
  {
    title: "Create project",
    subtitle: "When you are ready, create the project in Jira and register it in Astra.",
  },
];

// Categories hidden from the project wizard (not relevant for Jira/AWS projects)
const HIDDEN_TOOL_CATEGORIES = new Set(["design"]);

// Specific provider keys hidden from the project wizard
const HIDDEN_TOOL_PROVIDERS = new Set(["jira_service_management"]);

export function groupToolCatalogByCategory(items: CatalogToolItem[]) {
  return items.reduce<Record<string, CatalogToolItem[]>>((acc, item) => {
    if (HIDDEN_TOOL_CATEGORIES.has(item.categoryKey)) return acc;
    if (HIDDEN_TOOL_PROVIDERS.has(item.providerKey)) return acc;
    if (!acc[item.categoryKey]) acc[item.categoryKey] = [];
    acc[item.categoryKey].push(item);
    return acc;
  }, {});
}

export function buildOrgConfigByCategory(configs: OrgIntegrationConfigRow[] | undefined) {
  const m: Record<string, OrgIntegrationConfigRow> = {};
  for (const c of configs ?? []) {
    m[c.categoryKey] = c;
  }
  return m;
}

export function isProjectToolStepComplete(
  groupedCatalog: Record<string, CatalogToolItem[]>,
  skippedCategories: Record<string, boolean>,
  inheritFromOrg: Record<string, boolean>,
  orgByCategory: Record<string, OrgIntegrationConfigRow | undefined>,
  toolConfigs: Record<string, ToolConfigState>,
  _toolTestStatus: Record<string, TestStatus>
): boolean {
  return Object.keys(groupedCatalog).every((cat) => {
    if (skippedCategories[cat]) return true;
    const orgRow = orgByCategory[cat];
    if (inheritFromOrg[cat] && orgRow) return true;
    if (inheritFromOrg[cat] && !orgRow) return true;
    const cfg = toolConfigs[cat];
    if (!cfg?.providerId) return true;
    const provider = groupedCatalog[cat]?.find((p) => p.id === cfg.providerId);
    if (!provider) return false;
    return true;
  });
}
