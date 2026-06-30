import type { TestStatus, ToolCatalogItem, ToolConfigState } from "./types";

/** Select sentinel: skip configuring this category until project creation. */
export const SKIP_CATEGORY_VALUE = "__skip_category__";

export const ADD_ORG_STEPS = [
  "ALM Configuration",
  "Default Tool Config",
  "Review",
];

/** Short labels for compact wizard progress (same order as ADD_ORG_STEPS). */
export const ADD_ORG_STEP_SHORT = ["ALM", "Tools", "Review"] as const;

export const ADD_ORG_WIZARD_STEP_COPY: { title: string; subtitle: string }[] = [
  {
    title: "Connect your ALM",
    subtitle:
      "Verify DevX can reach Azure DevOps or Jira with the credentials you provide, then test the connection.",
  },
  {
    title: "Default tool configuration",
    subtitle:
      "Optionally pre-configure integrations for projects in this organization, or skip categories until project creation.",
  },
  {
    title: "Review",
    subtitle: "Confirm your organization and tool defaults before saving.",
  },
];

export function groupToolCatalogByCategory(items: ToolCatalogItem[]) {
  return items.reduce<Record<string, ToolCatalogItem[]>>((acc, item) => {
    if (!acc[item.categoryKey]) {
      acc[item.categoryKey] = [];
    }
    acc[item.categoryKey].push(item);
    return acc;
  }, {});
}

export function maskSensitiveValue(key: string, value: string): string {
  if (!value?.trim()) return "";
  const k = key.toLowerCase();
  const secret =
    k.includes("token") ||
    k.includes("password") ||
    k.includes("secret") ||
    k === "apikey" ||
    k === "applicationkey" ||
    (k.includes("pat") && k !== "organizationurl");
  return secret ? "••••" : value;
}

export function isAddOrgToolStepComplete(
  groupedCatalog: Record<string, ToolCatalogItem[]>,
  skippedCategories: Record<string, boolean>,
  toolConfigs: Record<string, ToolConfigState>,
  _toolTestStatus: Record<string, TestStatus>
): boolean {
  return Object.keys(groupedCatalog).every((cat) => {
    if (skippedCategories[cat]) return true;
    const cfg = toolConfigs[cat];
    if (!cfg?.providerId) return true;
    const provider = groupedCatalog[cat].find((p) => p.id === cfg.providerId);
    if (!provider) return false;
    return true;
  });
}
