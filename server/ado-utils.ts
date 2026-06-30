/**
 * Extracts a clean organization name from an Azure DevOps URL or returns the
 * value as-is if it is already a plain name.
 *
 * Handles:
 *   https://dev.azure.com/myorg/  → "myorg"
 *   https://myorg.visualstudio.com → "myorg"
 *   myorg                         → "myorg"
 */
export function extractAdoOrgName(org: string | null | undefined): string | null {
  if (!org) return null;
  if (org.includes("dev.azure.com")) {
    return org.replace(/https?:\/\/dev\.azure\.com\//, "").replace(/\/$/, "");
  }
  const vsMatch = org.match(/([^.]+)\.visualstudio\.com/);
  if (vsMatch) return vsMatch[1];
  return org;
}
