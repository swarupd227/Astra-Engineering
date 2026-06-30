/**
 * Repository folder structure (single top-level folder):
 *   AutomationScript -> {organization}-{project} -> {user-story} -> (BDD assets & manual test cases JSON)
 *
 * One top-level folder "AutomationScript"; inside it, one folder per project (org-project), then user story folders.
 */

export const AUTOMATION_SCRIPT_FOLDER = "AutomationScript";

export type GitStorageProvider = "github" | "ado";

/**
 * Build the repo path for a user story's test artifacts.
 * Format: AutomationScript/{organization-name}-{project-name}/{user-story-folder}
 */
export function buildStoryArtifactsPath(
  projectFolder: string,
  storyName: string
): string {
  return `${AUTOMATION_SCRIPT_FOLDER}/${projectFolder}/${storyName}`;
}

/**
 * Sanitize a name for use in repo paths (lowercase, hyphens, no special chars).
 */
export function sanitizePathName(name: string): string {
  return name
    .replace(/[^a-zA-Z0-9\s\-_]/g, "")
    .replace(/\s+/g, "-")
    .toLowerCase()
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}
