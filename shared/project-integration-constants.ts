/** Stored in project_integration_configs.config when a category is explicitly skipped. */
export const PROJECT_INTEGRATION_SKIPPED_KEY = "_devxSkipped";

export function isProjectIntegrationSkippedConfig(
  config: Record<string, string> | null | undefined,
): boolean {
  return String(config?.[PROJECT_INTEGRATION_SKIPPED_KEY] || "").trim() === "1";
}

export const CICD_PROVIDER_KEYS = [
  "gitlab_ci",
  "bitbucket_pipelines",
  "github_actions",
  "azure_pipelines",
] as const;

export type CicdProviderKey = (typeof CICD_PROVIDER_KEYS)[number];

export function cicdProviderKeyToSegment(
  providerKey: string,
): "gitlab" | "bitbucket" | "github" | "ado" | null {
  switch (providerKey) {
    case "gitlab_ci":
      return "gitlab";
    case "bitbucket_pipelines":
      return "bitbucket";
    case "github_actions":
      return "github";
    case "azure_pipelines":
      return "ado";
    default:
      return null;
  }
}
