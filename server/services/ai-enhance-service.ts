import { db } from "../db";
import { aiEnhanceMappings, integrations } from "@shared/schema";
import { eq, desc, and, inArray } from "drizzle-orm";
import { findRepositoryOrganization } from "./golden-repo-service";
import { Octokit } from "octokit";

/**
 * Fetch guideline text from the golden repository for a given locationKey.
 * Supports Azure DevOps, GitHub, and GitLab providers by detecting which
 * integration owns the mapped repository.
 */
export async function fetchGuidelineForLocation(
  locationKey: string
): Promise<string | null> {
  const mappings = await db
    .select()
    .from(aiEnhanceMappings)
    .where(eq(aiEnhanceMappings.locationKey, locationKey))
    .orderBy(desc(aiEnhanceMappings.updatedAt))
    .limit(1);

  const mapping = mappings[0];
  if (!mapping) {
    return null;
  }

  // Try GitHub / GitLab first (golden repo integrations)
  const gitContent = await fetchFromGitProvider(mapping.repositoryId, mapping.filePath);
  if (gitContent !== null) {
    return gitContent;
  }

  // Fall back to ADO
  return fetchFromAdo(mapping.repositoryId, mapping.filePath);
}

async function fetchFromGitProvider(
  repositoryId: string,
  filePath: string,
): Promise<string | null> {
  try {
    const rows = await db
      .select()
      .from(integrations)
      .where(
        and(
          inArray(integrations.integrationType, ["golden_github", "golden_gitlab"]),
          eq(integrations.status, "active"),
        ),
      )
      .limit(1);

    const row = rows[0];
    if (!row) return null;

    if (row.integrationType === "golden_github") {
      return fetchFromGitHub(row.apiKey, row.appKey || "", repositoryId, filePath);
    }

    if (row.integrationType === "golden_gitlab") {
      const baseUrl = (row.baseUrl || "https://gitlab.com").replace(/\/+$/, "");
      return fetchFromGitLab(baseUrl, row.apiKey, repositoryId, filePath);
    }
  } catch (error) {
    console.error("[AI Enhance] Error fetching from git provider:", error);
  }

  return null;
}

async function fetchFromGitHub(
  token: string,
  owner: string,
  repositoryId: string,
  filePath: string,
): Promise<string | null> {
  if (!token || !owner) return null;

  try {
    const octokit = new Octokit({ auth: token });

    // repositoryId is a GitHub numeric repo ID; resolve repo name first
    const { data: repoData } = await octokit.rest.repos.get({
      owner,
      repo: repositoryId,
    }).catch(async () => {
      // If numeric ID doesn't work as repo name, try listing repos to find by ID
      const { data: repos } = await octokit.rest.repos.listForUser({
        username: owner,
        per_page: 100,
        type: "owner",
      }).catch(() => octokit.rest.repos.listForOrg({ org: owner, per_page: 100 }));

      const match = repos.find((r: any) => String(r.id) === repositoryId);
      if (!match) throw new Error(`Repo ${repositoryId} not found for owner ${owner}`);
      return { data: match };
    });

    const repoName = repoData.name;
    const defaultBranch = repoData.default_branch || "main";

    const { data: fileData } = await octokit.rest.repos.getContent({
      owner,
      repo: repoName,
      path: filePath.startsWith("/") ? filePath.slice(1) : filePath,
      ref: defaultBranch,
    });

    if (Array.isArray(fileData)) {
      console.warn("[AI Enhance] GitHub path is a directory, not a file:", filePath);
      return null;
    }

    return Buffer.from((fileData as any).content, "base64").toString("utf-8");
  } catch (error: any) {
    console.warn("[AI Enhance] Failed to fetch guideline from GitHub:", error.message || error);
    return null;
  }
}

async function fetchFromGitLab(
  baseUrl: string,
  token: string,
  repositoryId: string,
  filePath: string,
): Promise<string | null> {
  if (!token) return null;

  try {
    const encodedPath = encodeURIComponent(
      filePath.startsWith("/") ? filePath.slice(1) : filePath,
    );
    const url = `${baseUrl}/api/v4/projects/${encodeURIComponent(repositoryId)}/repository/files/${encodedPath}/raw?ref=main`;

    const response = await fetch(url, {
      headers: { "PRIVATE-TOKEN": token },
    });

    if (!response.ok) {
      console.warn("[AI Enhance] GitLab file fetch failed:", response.status);
      return null;
    }

    return await response.text();
  } catch (error: any) {
    console.warn("[AI Enhance] Failed to fetch guideline from GitLab:", error.message || error);
    return null;
  }
}

async function fetchFromAdo(
  repositoryId: string,
  filePath: string,
): Promise<string | null> {
  const repoInfo = await findRepositoryOrganization(repositoryId);
  if (!repoInfo || !repoInfo.organization || !repoInfo.authHeader) {
    return null;
  }

  const orgUrl = repoInfo.organization.organizationUrl;
  const projectName = repoInfo.organization.projectName;
  const apiVersion = repoInfo.organization.apiVersion || "7.0";

  const fileUrl = `${orgUrl}/${encodeURIComponent(
    projectName,
  )}/_apis/git/repositories/${repositoryId}/items?path=${encodeURIComponent(
    filePath,
  )}&includeContent=true&resolveLfs=true&api-version=${apiVersion}`;

  const fileResponse = await fetch(fileUrl, {
    headers: {
      Authorization: repoInfo.authHeader,
    },
  });

  if (!fileResponse.ok) {
    console.warn(
      "[AI Enhance] Failed to fetch ADO guideline file content",
      fileResponse.status,
    );
    return null;
  }

  const contentType = fileResponse.headers.get("content-type") || "";

  if (contentType.includes("application/json")) {
    try {
      const fileJson: any = await fileResponse.json();
      if (typeof fileJson.content === "string") {
        try {
          return Buffer.from(fileJson.content, "base64").toString("utf-8");
        } catch {
          return fileJson.content;
        }
      }
    } catch (jsonError) {
      console.warn(
        "[AI Enhance] Failed to parse ADO file response as JSON:",
        jsonError instanceof Error ? jsonError.message : String(jsonError),
      );
    }
    return null;
  }

  return await fileResponse.text();
}

/**
 * Build the user prompt from the raw text, optional guideline, and optional extra instructions.
 */
export function buildUserPrompt(
  text: string,
  guidelineText: string | null,
  extraPrompt: string | undefined
): string {
  let userPrompt = `Please enhance the following text to make it more detailed, clear, and professional while maintaining the original intent:\n\n${text}`;

  if (guidelineText) {
    userPrompt =
      `Use the following domain guidelines from the golden repository as additional context. The structure preservation rules from the system instructions take precedence:\n\n` +
      `${guidelineText}\n\n` +
      userPrompt +
      `\n\nNote: When the domain guidelines conflict with the structure preservation rules, follow the structure preservation rules.`;
  }

  if (extraPrompt && extraPrompt.trim().length > 0) {
    userPrompt += `\n\nAdditional instructions: ${extraPrompt.trim()}`;
  }

  return userPrompt;
}

/**
 * Strip markdown formatting and common AI response artifacts from enhanced text.
 */
export function cleanEnhancedText(text: string): string {
  let cleaned = text;
  cleaned = cleaned.replace(/\*\*(.*?)\*\*/g, "$1");
  cleaned = cleaned.replace(/\*(.*?)\*/g, "$1");
  cleaned = cleaned.replace(/^#+\s+/gm, "");
  cleaned = cleaned.replace(/^---+$/gm, "");
  cleaned = cleaned.replace(/^(Enhanced\s+Text|Enhanced|Result)[:：]?\s*/gim, "");
  cleaned = cleaned.replace(/\n{3,}/g, "\n\n").trim();
  return cleaned;
}
