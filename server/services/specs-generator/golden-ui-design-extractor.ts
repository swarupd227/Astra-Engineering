import { getGitClientForUser } from "../../integrations/git/user-credential-resolver";
import { findRepositoryOrganization } from "../golden-repo-service";
import { callLlmWithRetry } from "./llm-caller";
import { db } from "../../db";
import * as schema from "@shared/schema";
import { and, eq, inArray } from "drizzle-orm";

export interface GoldenRepoUiSourceFile {
  path: string;
  content: string;
  size: number;
}

export interface GoldenRepoUiDesignPackage {
  repoName?: string;
  provider?: string;
  sourceFiles: GoldenRepoUiSourceFile[];
  consolidatedGuidelines: string;
  extractionNotes: string;
  generatedAt: string;
}

export interface GoldenRepoUiExtractionContext {
  repoId?: string;
  repoName?: string;
  organization?: string;
  project?: string;
  provider?: string;
  repoUrl?: string;
  defaultBranch?: string;
  tenantId?: string | null;
  selectedPaths?: string[];
}

const UI_PATH_RE =
  /(^|[\/._-])(design|design-system|ui|ux|style|styles|theme|themes|token|tokens|color|colors|typography|spacing|radius|shadow|component|components|primitive|primitives|pattern|patterns|layout|layouts|breakpoint|responsive|accessibility|a11y|scss|sass|css|brand|guideline|guidelines|standard|standards)([\/._-]|$)/i;

const TEXT_FILE_RE =
  /\.(md|markdown|mdx|txt|json|ya?ml|css|scss|sass|less|html|hbs|handlebars|cshtml|tsx?|jsx?|vue|svelte|astro|config|cjs|mjs)$/i;

const ALWAYS_INCLUDE_RE =
  /(^|\/)(tailwind\.config\.[cm]?[jt]s|postcss\.config\.[cm]?[jt]s|components\.json|package\.json|tsconfig\.json|vite\.config\.[cm]?[jt]s)$/i;

const SKIP_PATH_RE =
  /(^|\/)(node_modules|dist|build|coverage|\.git|\.next|\.turbo|target|bin|obj|vendor|logs?)(\/|$)|\.(png|jpe?g|gif|webp|svg|ico|pdf|zip|gz|tar|7z|woff2?|ttf|eot|mp4|mov|avi|exe|dll|so|dylib)$/i;

const MAX_LLM_SOURCE_CHARS = 140_000;

function normalizePath(value: string): string {
  return String(value || "").replace(/\\/g, "/").replace(/^\/+/, "").replace(/\/+/g, "/").trim();
}

function uniquePaths(paths: string[]): string[] {
  return Array.from(new Set(paths.map(normalizePath).filter(Boolean)));
}

function isLikelyUiDesignFile(path: string): boolean {
  const normalized = normalizePath(path);
  if (!normalized || SKIP_PATH_RE.test(normalized)) return false;
  if (ALWAYS_INCLUDE_RE.test(normalized)) return true;
  if (!TEXT_FILE_RE.test(normalized)) return false;
  return UI_PATH_RE.test(normalized);
}

type GoldenGitIntegration = {
  integrationType: string;
  apiKey: string | null;
  appKey: string | null;
  baseUrl: string | null;
};

async function getGoldenGitIntegration(
  tenantId?: string | null,
  provider?: string,
): Promise<GoldenGitIntegration | null> {
  if (!tenantId) return null;
  const allowedTypes = provider === "github"
    ? ["golden_github"]
    : provider === "gitlab"
      ? ["golden_gitlab"]
      : ["golden_github", "golden_gitlab"];
  const rows = await db
    .select({
      integrationType: schema.integrations.integrationType,
      apiKey: schema.integrations.apiKey,
      appKey: schema.integrations.appKey,
      baseUrl: schema.integrations.baseUrl,
    })
    .from(schema.integrations)
    .where(
      and(
        eq(schema.integrations.tenantId, tenantId),
        inArray(schema.integrations.integrationType, allowedTypes),
        eq(schema.integrations.status, "active"),
      ),
    )
    .limit(1);
  return rows[0] || null;
}

async function resolveProvider(ctx: GoldenRepoUiExtractionContext): Promise<string> {
  const explicit = String(ctx.provider || "").toLowerCase();
  if (explicit === "github" || explicit === "gitlab" || explicit === "ado") return explicit;
  const integration = await getGoldenGitIntegration(ctx.tenantId);
  if (integration?.integrationType === "golden_github") return "github";
  if (integration?.integrationType === "golden_gitlab") return "gitlab";
  return "ado";
}

function parseGitHubOwnerRepo(repoUrl?: string, repoName?: string, fallbackOwner?: string): { owner: string; repo: string } {
  if (repoUrl) {
    try {
      const parts = new URL(repoUrl).pathname.split("/").filter(Boolean);
      if (parts.length >= 2) return { owner: parts[0], repo: parts[1].replace(/\.git$/i, "") };
    } catch {
      // Fall back to repoName parsing.
    }
  }
  const name = String(repoName || "").replace(/\.git$/i, "");
  const parts = name.split("/").filter(Boolean);
  if (parts.length >= 2) return { owner: parts[0], repo: parts[1] };
  return { owner: fallbackOwner || "", repo: name };
}

async function listAdoPaths(repoId: string): Promise<string[]> {
  const repoInfo = await findRepositoryOrganization(repoId);
  if (!repoInfo) return [];
  const { organization, authHeader } = repoInfo;
  const response = await fetch(
    `${organization.organizationUrl}/${encodeURIComponent(organization.projectName)}/_apis/git/repositories/${encodeURIComponent(repoId)}/items?recursionLevel=full&api-version=7.0`,
    { headers: { Authorization: authHeader } },
  );
  if (!response.ok) return [];
  const data = (await response.json()) as {
    value?: Array<{ path?: string; isFolder?: boolean }>;
  };
  return (data.value || [])
    .filter((item) => !item.isFolder)
    .map((item) => normalizePath(item.path || ""));
}

async function readAdoFile(repoId: string, filePath: string): Promise<string | null> {
  const repoInfo = await findRepositoryOrganization(repoId);
  if (!repoInfo) return null;
  const { organization, authHeader } = repoInfo;
  const response = await fetch(
    `${organization.organizationUrl}/${encodeURIComponent(organization.projectName)}/_apis/git/repositories/${encodeURIComponent(repoId)}/items?path=${encodeURIComponent(`/${normalizePath(filePath)}`)}&$format=text&api-version=7.0`,
    { headers: { Authorization: authHeader } },
  );
  if (!response.ok) return null;
  return response.text();
}

async function listGitHubPaths(ctx: GoldenRepoUiExtractionContext, userId?: string): Promise<string[]> {
  const integration = await getGoldenGitIntegration(ctx.tenantId, "github");
  const token = integration?.apiKey || (userId ? (await getGitClientForUser(userId, "github")).token : "");
  const { owner, repo } = parseGitHubOwnerRepo(ctx.repoUrl, ctx.repoName, integration?.appKey || undefined);
  if (!owner || !repo) return [];
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
  };
  let ref = ctx.defaultBranch?.trim();
  if (!ref) {
    const repoResponse = await fetch(
      `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`,
      { headers },
    );
    if (repoResponse.ok) {
      ref = String(((await repoResponse.json()) as { default_branch?: string }).default_branch || "").trim();
    }
  }
  const response = await fetch(
    `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/trees/${encodeURIComponent(ref || "main")}?recursive=1`,
    { headers },
  );
  if (!response.ok) return [];
  const data = (await response.json()) as {
    tree?: Array<{ path?: string; type?: string }>;
  };
  return (data.tree || [])
    .filter((item) => item.type === "blob")
    .map((item) => normalizePath(item.path || ""));
}

async function readGitHubFile(ctx: GoldenRepoUiExtractionContext, filePath: string, userId?: string): Promise<string | null> {
  const integration = await getGoldenGitIntegration(ctx.tenantId, "github");
  const token = integration?.apiKey || (userId ? (await getGitClientForUser(userId, "github")).token : "");
  const { owner, repo } = parseGitHubOwnerRepo(ctx.repoUrl, ctx.repoName, integration?.appKey || undefined);
  if (!owner || !repo) return null;
  const ref = ctx.defaultBranch?.trim();
  const encodedPath = normalizePath(filePath).split("/").map(encodeURIComponent).join("/");
  const response = await fetch(
    `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${encodedPath}${ref ? `?ref=${encodeURIComponent(ref)}` : ""}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github.raw",
      },
    },
  );
  if (!response.ok) return null;
  return response.text();
}

async function resolveGitLabClient(ctx: GoldenRepoUiExtractionContext, userId?: string) {
  const integration = await getGoldenGitIntegration(ctx.tenantId, "gitlab");
  if (integration?.apiKey) {
    return {
      baseUrl: (integration.baseUrl || "https://gitlab.com").replace(/\/+$/, ""),
      token: integration.apiKey,
    };
  }
  if (!userId) return null;
  const baseUrl = ctx.repoUrl
    ? (() => {
        try {
          return new URL(ctx.repoUrl || "").origin;
        } catch {
          return undefined;
        }
      })()
    : undefined;
  return getGitClientForUser(userId, "gitlab", baseUrl);
}

async function listGitLabPaths(ctx: GoldenRepoUiExtractionContext, userId?: string): Promise<string[]> {
  const client = await resolveGitLabClient(ctx, userId);
  const repoId = String(ctx.repoId || "").trim();
  if (!client || !repoId) return [];
  let branch = ctx.defaultBranch?.trim();
  if (!branch) {
    const projectResponse = await fetch(
      `${client.baseUrl}/api/v4/projects/${encodeURIComponent(repoId)}`,
      { headers: { "PRIVATE-TOKEN": client.token } },
    );
    if (projectResponse.ok) {
      branch = String(((await projectResponse.json()) as { default_branch?: string }).default_branch || "").trim();
    }
  }
  const files: string[] = [];
  let page = 1;
  for (;;) {
    const response = await fetch(
      `${client.baseUrl}/api/v4/projects/${encodeURIComponent(repoId)}/repository/tree?recursive=true&per_page=100&page=${page}&ref=${encodeURIComponent(branch || "main")}`,
      { headers: { "PRIVATE-TOKEN": client.token } },
    );
    if (!response.ok) break;
    const data = (await response.json()) as Array<{ path?: string; type?: string }>;
    for (const item of data) {
      if (item.type === "blob") files.push(normalizePath(item.path || ""));
    }
    if (data.length < 100) break;
    page += 1;
  }
  return files;
}

async function readGitLabFile(ctx: GoldenRepoUiExtractionContext, filePath: string, userId?: string): Promise<string | null> {
  const client = await resolveGitLabClient(ctx, userId);
  const repoId = String(ctx.repoId || "").trim();
  if (!client || !repoId) return null;
  let branch = ctx.defaultBranch?.trim() || "main";
  if (!ctx.defaultBranch?.trim()) {
    const projectResponse = await fetch(
      `${client.baseUrl}/api/v4/projects/${encodeURIComponent(repoId)}`,
      { headers: { "PRIVATE-TOKEN": client.token } },
    );
    if (projectResponse.ok) {
      branch = String(((await projectResponse.json()) as { default_branch?: string }).default_branch || "").trim() || branch;
    }
  }
  const response = await fetch(
    `${client.baseUrl}/api/v4/projects/${encodeURIComponent(repoId)}/repository/files/${encodeURIComponent(normalizePath(filePath))}/raw?ref=${encodeURIComponent(branch)}`,
    { headers: { "PRIVATE-TOKEN": client.token } },
  );
  if (!response.ok && branch === "main") {
    const fallback = await fetch(
      `${client.baseUrl}/api/v4/projects/${encodeURIComponent(repoId)}/repository/files/${encodeURIComponent(normalizePath(filePath))}/raw?ref=master`,
      { headers: { "PRIVATE-TOKEN": client.token } },
    );
    if (fallback.ok) return fallback.text();
  }
  if (!response.ok) return null;
  return response.text();
}

async function listCandidatePaths(ctx: GoldenRepoUiExtractionContext, userId?: string): Promise<string[]> {
  const selected = uniquePaths(ctx.selectedPaths || []);
  if (selected.length > 0) return selected;

  const provider = await resolveProvider(ctx);
  const repoId = String(ctx.repoId || "").trim();
  let paths: string[] = [];
  if (provider === "github") paths = await listGitHubPaths(ctx, userId);
  else if (provider === "gitlab") paths = await listGitLabPaths(ctx, userId);
  else if (repoId) paths = await listAdoPaths(repoId);

  return uniquePaths(paths.filter(isLikelyUiDesignFile));
}

async function readGoldenFile(ctx: GoldenRepoUiExtractionContext, path: string, userId?: string): Promise<string | null> {
  const provider = await resolveProvider(ctx);
  const repoId = String(ctx.repoId || "").trim();
  if (provider === "github") return readGitHubFile(ctx, path, userId);
  if (provider === "gitlab") return readGitLabFile(ctx, path, userId);
  if (repoId) return readAdoFile(repoId, path);
  return null;
}

function buildSourceMarkdown(ctx: GoldenRepoUiExtractionContext, sourceFiles: GoldenRepoUiSourceFile[], provider: string): string {
  const header = [
    "# Golden Repository UI/UX Source Files",
    "",
    "These files were copied into the generated DevX skill package so UI generation can run without live Golden Repository access.",
    "",
    `- Repository: ${ctx.repoName || ctx.repoId || "Unknown"}`,
    `- Provider: ${provider}`,
    `- Source files: ${sourceFiles.length}`,
    "",
  ];

  const sections = sourceFiles.flatMap((file, index) => [
    `## ${index + 1}. ${file.path}`,
    "",
    `Size: ${file.size} characters`,
    "",
    "````text",
    file.content,
    "````",
    "",
  ]);

  return [...header, ...sections].join("\n");
}

function buildFallbackConsolidation(ctx: GoldenRepoUiExtractionContext, sourceFiles: GoldenRepoUiSourceFile[]): string {
  return [
    "# Golden Repository UI/UX Design System",
    "",
    "LLM consolidation was not available, so this artifact preserves the source manifest and instructs the UI agent to read the raw source artifact exhaustively.",
    "",
    "## Required Reading",
    "",
    "- Read `golden-ui-design-sources.md` before making UI changes.",
    "- Treat every source file as authoritative for design principles, tokens, component patterns, CSS/SCSS conventions, layout, responsive behavior, accessibility, naming, utilities, and project structure.",
    "- Do not rely on live Golden Repository access during implementation.",
    "",
    "## Source Manifest",
    "",
    ...sourceFiles.map((file) => `- ${file.path} (${file.size} chars)`),
    "",
    `Repository: ${ctx.repoName || ctx.repoId || "Unknown"}`,
  ].join("\n");
}

function hasAnyGoldenContext(ctx: GoldenRepoUiExtractionContext | undefined): ctx is GoldenRepoUiExtractionContext {
  return Boolean(
    ctx?.repoId ||
      ctx?.repoName ||
      ctx?.organization ||
      ctx?.project ||
      (ctx?.selectedPaths && ctx.selectedPaths.length > 0),
  );
}

function buildEmptyExtractionPackage(
  ctx: GoldenRepoUiExtractionContext,
  provider: string,
  candidatePaths: string[],
  reason: string,
): GoldenRepoUiDesignPackage {
  const generatedAt = new Date().toISOString();
  const sourceManifest = candidatePaths.length > 0
    ? candidatePaths.map((path) => `- ${path}`).join("\n")
    : "- No candidate UI/design source paths were discovered or selected.";
  const contextLines = [
    `- Repository id: ${ctx.repoId || "Unknown"}`,
    `- Repository name: ${ctx.repoName || "Unknown"}`,
    `- Provider: ${provider}`,
    `- Organization: ${ctx.organization || "Unknown"}`,
    `- Project/group: ${ctx.project || "Unknown"}`,
    `- Branch: ${ctx.defaultBranch || "default branch from provider, then main/master fallback"}`,
    `- Generated at: ${generatedAt}`,
  ].join("\n");

  return {
    repoName: ctx.repoName,
    provider,
    sourceFiles: [],
    generatedAt,
    consolidatedGuidelines: [
      "# Golden Repository UI/UX Design System",
      "",
      "Golden Repository UI/UX extraction was requested, but no source files could be read during specs generation.",
      "",
      "## Extraction Status",
      "",
      reason,
      "",
      "## Golden Repository Context",
      "",
      contextLines,
      "",
      "## Candidate Source Paths",
      "",
      sourceManifest,
      "",
      "## Implementation Guidance",
      "",
      "- Treat this file as a retrieval report, not a complete design-system guide.",
      "- Do not require live Golden Repository access inside the user's IDE.",
      "- Regenerate specs after fixing Golden Repo credentials, provider metadata, branch, or selected paths to replace this report with the consolidated design-system guide.",
      "- Until regenerated, derive UI implementation patterns from the existing local application code and any selected Golden Repo files that are separately available in the workspace.",
    ].join("\n"),
    extractionNotes: [
      "# Golden Repository UI/UX Source Files",
      "",
      "No raw UI/UX source files were copied because extraction did not read any Golden Repository source content.",
      "",
      "## Extraction Status",
      "",
      reason,
      "",
      "## Golden Repository Context",
      "",
      contextLines,
      "",
      "## Candidate Source Paths",
      "",
      sourceManifest,
    ].join("\n"),
  };
}

async function consolidateWithLlm(ctx: GoldenRepoUiExtractionContext, sourceFiles: GoldenRepoUiSourceFile[]): Promise<string> {
  const sourceText = sourceFiles
    .map((file) => `--- SOURCE: ${file.path} (${file.size} chars) ---\n${file.content}`)
    .join("\n\n")
    .slice(0, MAX_LLM_SOURCE_CHARS);

  const omittedCount = sourceFiles
    .map((file) => file.content.length)
    .reduce((sum, len) => sum + len, 0) > MAX_LLM_SOURCE_CHARS
    ? "Some raw source text exceeded the LLM input window. The complete source is still preserved in golden-ui-design-sources.md; cite it as authoritative."
    : "All gathered source text fit into this consolidation request.";

  const result = await callLlmWithRetry(`Golden UI/UX design extraction for "${ctx.repoName || ctx.repoId || "golden repo"}"`, {
    systemPrompt: [
      "You are a senior design-system engineer.",
      "Extract and consolidate UI/UX implementation guidance from Golden Repository source files.",
      "Be exhaustive and preserve details. Do not invent rules.",
      "If a detail is present in source, include it with source-path attribution.",
      "Organize the output so an IDE coding agent can implement UI without Golden Repository access.",
    ].join("\n"),
    userPrompt: [
      "Create a self-contained design-system guide from these source files.",
      "",
      "Required sections:",
      "1. Source coverage summary",
      "2. Design principles and UI/UX standards",
      "3. Style tokens: colors, typography, spacing, border radius, shadows, motion, z-index, icons",
      "4. Component patterns and reusable UI primitives",
      "5. CSS/SCSS architecture, folder structure, coding conventions, mixins/functions/utilities",
      "6. Layout rules, responsive behavior, and breakpoints",
      "7. Accessibility requirements",
      "8. Naming conventions and project structure",
      "9. Reusable commands, utilities, helper functions, and implementation-time instructions",
      "10. Validation checklist",
      "",
      "For every rule or token, include the source path in parentheses.",
      omittedCount,
      "",
      sourceText,
    ].join("\n"),
    temperature: 0.1,
    maxTokens: 6000,
  }, 2);

  return result.trim() || buildFallbackConsolidation(ctx, sourceFiles);
}

export async function extractGoldenRepoUiDesignPackage(
  ctx: GoldenRepoUiExtractionContext | undefined,
  userId?: string,
): Promise<GoldenRepoUiDesignPackage | undefined> {
  if (!hasAnyGoldenContext(ctx)) return undefined;

  try {
    const provider = await resolveProvider(ctx);
    const paths = await listCandidatePaths(ctx, userId);
    const sourceFiles: GoldenRepoUiSourceFile[] = [];
    for (const path of paths) {
      if (!path || SKIP_PATH_RE.test(path)) continue;
      const content = await readGoldenFile(ctx, path, userId);
      if (!content || !content.trim()) continue;
      sourceFiles.push({ path, content, size: content.length });
    }

    if (sourceFiles.length === 0) {
      return buildEmptyExtractionPackage(
        ctx,
        provider,
        paths,
        "No readable UI/UX source files were found. This usually means the Golden Repo could not be reached with the current tenant/user credentials, the stored branch or repo id is wrong, or the selected Golden Repo paths are empty/non-text/non-UI files.",
      );
    }

    let consolidatedGuidelines: string;
    try {
      consolidatedGuidelines = await consolidateWithLlm(ctx, sourceFiles);
    } catch (err) {
      console.warn("[Golden UI Extractor] LLM consolidation failed; preserving raw source package.", err);
      consolidatedGuidelines = buildFallbackConsolidation(ctx, sourceFiles);
    }

    return {
      repoName: ctx.repoName,
      provider,
      sourceFiles,
      consolidatedGuidelines,
      extractionNotes: buildSourceMarkdown(ctx, sourceFiles, provider),
      generatedAt: new Date().toISOString(),
    };
  } catch (err) {
    console.warn("[Golden UI Extractor] Failed to extract Golden Repo UI design package.", err);
    const provider = await resolveProvider(ctx).catch(() => String(ctx.provider || "unknown"));
    return buildEmptyExtractionPackage(
      ctx,
      provider,
      uniquePaths(ctx.selectedPaths || []),
      `Extraction failed before source files could be preserved: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
