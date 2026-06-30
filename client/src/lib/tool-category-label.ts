/** Known catalog category keys → display labels (API keys stay lowercase). */
const CATEGORY_LABELS: Record<string, string> = {
  repo: "Repository",
  cicd: "CI/CD",
};

/**
 * Human-readable label for a tool catalog category key (e.g. org/project integration UI).
 */
export function formatToolCategoryLabel(categoryKey: string): string {
  const lower = categoryKey.toLowerCase();
  if (CATEGORY_LABELS[lower]) return CATEGORY_LABELS[lower];
  return categoryKey
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}
