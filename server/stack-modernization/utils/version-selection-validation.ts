/**
 * Shared validation for version selections: ensure at least one package
 * has a target version different from current (no "upgrade" when all same).
 */

export interface VersionSelectionLike {
  currentVersion?: string | null;
  selectedVersion?: string | null;
}

/**
 * Normalize version string for same/different comparison (trim + lowercase).
 */
export function normalizeVersionForCompare(v: string | undefined | null): string {
  return (v ?? "").toString().trim().toLowerCase();
}

/**
 * Returns true if at least one selection has selectedVersion !== currentVersion
 * (after normalization). Empty array returns false.
 * "detected" or empty currentVersion always counts as needing upgrade (target-only input).
 */
export function hasAtLeastOneUpgrade(
  selections: VersionSelectionLike[]
): boolean {
  if (!selections?.length) return false;
  return selections.some((s) => {
    const curr = normalizeVersionForCompare(s.currentVersion);
    const target = normalizeVersionForCompare(s.selectedVersion);
    // If current version is "detected", "unknown", or empty, it's always an upgrade
    if (!curr || curr === "detected" || curr === "unknown") return true;
    return curr !== target;
  });
}
