import type { Express, Request, Response } from "express";
import { and, desc, eq, inArray, or } from "drizzle-orm";
import crypto from "crypto";
import {
  artifactOrganizations,
  integrationToolCatalog,
  jiraConnections,
  orgIntegrationConfigs,
  projectIntegrationConfigs,
  sdlcProjects,
} from "@shared/schema";
import { db } from "../db";
import { encryptPAT, safeDecryptPAT } from "../crypto-utils";
import {
  resolveProjectIntegrationCategory,
  resolveProjectIntegrationLookup,
} from "../services/project-integration-resolver";
import {
  createRepositoryForProvider,
  listRepositoriesForProvider,
} from "../services/repo-provider-service";
import {
  isGitProvider,
  saveUserProjectRepoCredential,
  saveUserGitCredential,
  testUserProjectRepoCredential,
  testUserGitCredential,
  type GitProvider,
} from "../integrations/git/user-credential-resolver";
import {
  autoBootstrapUser,
  requireAuth,
  type AuthenticatedRequest,
} from "../auth/middleware";

type CatalogField = {
  key: string;
  label: string;
  type: "text" | "password" | "url" | "email";
  required: boolean;
};

type CatalogTestStep = {
  label?: string;
  method?: "GET" | "POST";
  urlTemplate: string;
  authHeader?: "basic_user_token" | "bearer_token" | "api_key_header";
  apiKeyHeaderName?: string;
  stopOnFailure?: boolean;
  gitlabMinimumProjectAccessLevel?: number;
  customHeaders?: Array<{
    headerName: string;
    configKey: string;
    fallbackKeys?: string[];
  }>;
};

type CatalogTestConfig = {
  method?: "GET" | "POST";
  urlTemplate?: string;
  authHeader?: "basic_user_token" | "bearer_token" | "api_key_header";
  apiKeyHeaderName?: string;
  customHeaders?: CatalogTestStep["customHeaders"];
  checks?: CatalogTestStep[];
} | null;

const SECRET_PLACEHOLDER = "********";

async function assertProjectIntegrationOwner(req: Request, projectId: string): Promise<{
  ok: true;
  projectId: string;
} | {
  ok: false;
  status: number;
  body: { error: string };
}> {
  const userId = (req as any).user?.id;
  if (!userId) {
    return { ok: false, status: 401, body: { error: "Authentication required" } };
  }

  const { lookupProjectId } = await resolveProjectIntegrationLookup(projectId);
  const normalizedProjectId = lookupProjectId || projectId;
  const [project] = await db
    .select({
      id: sdlcProjects.id,
      ownerUserId: sdlcProjects.ownerUserId,
    })
    .from(sdlcProjects)
    .where(eq(sdlcProjects.id, normalizedProjectId))
    .limit(1);

  if (project?.ownerUserId && project.ownerUserId !== userId) {
    return {
      ok: false,
      status: 403,
      body: {
        error:
          "Only the project owner can edit project integration configuration. Project members can update only their personal PAT/API tokens.",
      },
    };
  }

  return { ok: true, projectId: normalizedProjectId };
}

const DEFAULT_TOOL_CATALOG = [
  {
    categoryKey: "repo",
    providerKey: "github",
    displayName: "GitHub",
    supportsTesting: 1,
    requiredFields: [
      { key: "ownerName", label: "Organization / Owner Name", type: "text", required: true },
      { key: "repository", label: "Repository (owner/repo)", type: "text", required: false },
      { key: "patToken", label: "PAT Token", type: "password", required: true },
    ],
    testConfig: { method: "GET", urlTemplate: "https://api.github.com/user", authHeader: "bearer_token" as const },
  },
  {
    categoryKey: "repo",
    providerKey: "gitlab",
    displayName: "GitLab",
    supportsTesting: 1,
    requiredFields: [
      { key: "baseUrl", label: "GitLab Base URL", type: "url", required: true },
      { key: "projectId", label: "Project / Repository ID", type: "text", required: false },
      { key: "namespacePath", label: "Namespace / Group Path (optional for create)", type: "text", required: false },
      { key: "patToken", label: "Personal Access Token", type: "password", required: true },
    ],
    testConfig: { method: "GET", urlTemplate: "{baseUrl}/api/v4/user", authHeader: "bearer_token" as const },
  },
  {
    categoryKey: "repo",
    providerKey: "bitbucket",
    displayName: "Bitbucket",
    supportsTesting: 1,
    requiredFields: [
      { key: "workspace", label: "Workspace Name", type: "text", required: true },
      { key: "repositorySlug", label: "Repository Slug", type: "text", required: false },
      { key: "username", label: "Bitbucket Username (not email)", type: "text", required: true },
      { key: "appPassword", label: "App Password", type: "password", required: true },
    ],
    testConfig: { method: "GET", urlTemplate: "https://api.bitbucket.org/2.0/user", authHeader: "basic_user_token" as const },
  },
  {
    categoryKey: "repo",
    providerKey: "azure_repos",
    displayName: "Azure Repos",
    supportsTesting: 1,
    requiredFields: [
      { key: "organizationUrl", label: "Organization URL", type: "url", required: true },
      { key: "projectName", label: "Azure DevOps Project", type: "text", required: false },
      { key: "repository", label: "Repository Name", type: "text", required: false },
      { key: "patToken", label: "PAT Token", type: "password", required: true },
    ],
    testConfig: {
      method: "GET",
      urlTemplate: "{organizationUrl}/_apis/projects?api-version=7.0",
      authHeader: "basic_user_token" as const,
    },
  },
  {
    categoryKey: "cicd",
    providerKey: "github_actions",
    displayName: "GitHub Actions",
    supportsTesting: 1,
    requiredFields: [
      { key: "ownerName", label: "Organization / Owner Name", type: "text", required: true },
      { key: "repository", label: "Repository Name", type: "text", required: true },
      { key: "patToken", label: "PAT Token", type: "password", required: true },
    ],
    testConfig: {
      method: "GET",
      urlTemplate: "https://api.github.com/repos/{ownerName}/{repository}",
      authHeader: "bearer_token" as const,
    },
  },
  {
    categoryKey: "cicd",
    providerKey: "gitlab_ci",
    displayName: "GitLab CI/CD",
    supportsTesting: 1,
    requiredFields: [
      { key: "baseUrl", label: "GitLab Base URL", type: "url", required: true },
      { key: "projectId", label: "Project ID", type: "text", required: true },
      { key: "patToken", label: "Project Access Token", type: "password", required: true },
    ],
    testConfig: {
      checks: [
        {
          label: "Project access",
          method: "GET",
          urlTemplate: "{baseUrl}/api/v4/projects/{projectId}",
          authHeader: "bearer_token" as const,
          gitlabMinimumProjectAccessLevel: 30,
          stopOnFailure: true,
        },
        {
          label: "Branch access",
          method: "GET",
          urlTemplate: "{baseUrl}/api/v4/projects/{projectId}/repository/branches?per_page=1",
          authHeader: "bearer_token" as const,
          stopOnFailure: true,
        },
        {
          label: "Pipeline access",
          method: "GET",
          urlTemplate: "{baseUrl}/api/v4/projects/{projectId}/pipelines?per_page=1",
          authHeader: "bearer_token" as const,
        },
      ],
    },
  },
  {
    categoryKey: "cicd",
    providerKey: "bitbucket_pipelines",
    displayName: "Bitbucket Pipelines",
    supportsTesting: 1,
    requiredFields: [
      { key: "workspace", label: "Workspace Name", type: "text", required: true },
      { key: "username", label: "Bitbucket Username (not email)", type: "text", required: true },
      { key: "appPassword", label: "App Password", type: "password", required: true },
    ],
    testConfig: { method: "GET", urlTemplate: "https://api.bitbucket.org/2.0/user", authHeader: "basic_user_token" as const },
  },
  {
    categoryKey: "cicd",
    providerKey: "azure_pipelines",
    displayName: "Azure Pipelines",
    supportsTesting: 1,
    requiredFields: [
      { key: "organizationUrl", label: "Organization URL", type: "url", required: true },
      { key: "patToken", label: "PAT Token", type: "password", required: true },
    ],
    testConfig: {
      method: "GET",
      urlTemplate: "{organizationUrl}/_apis/projects?api-version=7.0",
      authHeader: "basic_user_token" as const,
    },
  },
  {
    categoryKey: "design",
    providerKey: "figma",
    displayName: "Figma",
    supportsTesting: 1,
    requiredFields: [{ key: "patToken", label: "Personal Access Token", type: "password", required: true }],
    testConfig: {
      method: "GET",
      urlTemplate: "https://api.figma.com/v1/me",
      authHeader: "api_key_header" as const,
      apiKeyHeaderName: "X-Figma-Token",
    },
  },
  {
    categoryKey: "monitoring",
    providerKey: "datadog",
    displayName: "Datadog",
    supportsTesting: 1,
    requiredFields: [
      { key: "apiKey", label: "API Key", type: "password", required: true },
      { key: "applicationKey", label: "Application Key", type: "password", required: true },
      {
        key: "siteRegion",
        label: "Site Region (US1, US3, US5, EU, AP1, AP2, US1-FED, or datadoghq.eu)",
        type: "text",
        required: true,
      },
    ],
    testConfig: {
      checks: [
        {
          label: "API key",
          method: "GET",
          urlTemplate: "{datadogApiBaseUrl}/api/v1/validate",
          authHeader: "api_key_header" as const,
          apiKeyHeaderName: "DD-API-KEY",
          stopOnFailure: true,
        },
        {
          label: "Application key",
          method: "GET",
          urlTemplate: "{datadogApiBaseUrl}/api/v2/validate_keys",
          authHeader: "api_key_header" as const,
          apiKeyHeaderName: "DD-API-KEY",
          customHeaders: [
            {
              headerName: "DD-APPLICATION-KEY",
              configKey: "applicationKey",
              fallbackKeys: ["appKey", "appId"],
            },
          ],
        },
      ],
    },
  },
  {
    categoryKey: "monitoring",
    providerKey: "appdynamics",
    displayName: "AppDynamics",
    supportsTesting: 1,
    requiredFields: [
      { key: "baseUrl", label: "Controller URL", type: "url", required: true },
      { key: "username", label: "Username", type: "text", required: true },
      { key: "apiToken", label: "Password / API Client", type: "password", required: true },
    ],
    testConfig: {
      method: "GET",
      urlTemplate: "{baseUrl}/controller/rest/serverstatus",
      authHeader: "basic_user_token" as const,
    },
  },
  {
    categoryKey: "monitoring",
    providerKey: "prometheus_grafana",
    displayName: "Prometheus + Grafana",
    supportsTesting: 1,
    requiredFields: [
      { key: "prometheusUrl", label: "Prometheus URL", type: "url", required: true },
      { key: "grafanaUrl", label: "Grafana URL", type: "url", required: true },
      { key: "apiToken", label: "Grafana API Key / Token", type: "password", required: true },
    ],
    testConfig: {
      checks: [
        {
          label: "Prometheus",
          method: "GET",
          urlTemplate: "{prometheusUrl}/api/v1/query?query=up",
        },
        {
          label: "Grafana",
          method: "GET",
          urlTemplate: "{grafanaUrl}/api/health",
          authHeader: "bearer_token" as const,
        },
      ],
    },
  },
  {
    categoryKey: "ticketing",
    providerKey: "jira_service_management",
    displayName: "Jira Service Management",
    supportsTesting: 1,
    requiredFields: [
      { key: "instanceUrl", label: "Jira Base URL", type: "url", required: true },
      { key: "email", label: "Email", type: "email", required: true },
      { key: "apiToken", label: "API Token", type: "password", required: true },
    ],
    testConfig: { method: "GET", urlTemplate: "{instanceUrl}/rest/api/3/myself", authHeader: "basic_user_token" as const },
  },
  {
    categoryKey: "ticketing",
    providerKey: "servicenow",
    displayName: "ServiceNow",
    supportsTesting: 1,
    requiredFields: [
      { key: "instanceUrl", label: "Instance URL", type: "url", required: true },
      { key: "username", label: "Username", type: "text", required: true },
      { key: "apiToken", label: "Password / API Token", type: "password", required: true },
    ],
    testConfig: {
      method: "GET",
      urlTemplate: "{instanceUrl}/api/now/table/sys_user?sysparm_limit=1",
      authHeader: "basic_user_token" as const,
    },
  },
] as const;

/** Removed from catalog UI; existing DB rows are deactivated in ensureDefaultCatalogSeeded. */
const DEPRECATED_CATALOG_PROVIDER_KEYS = ["bamboo", "ux_pilot"] as const;

function isLikelySecretConfigKey(key: string): boolean {
  const k = key.toLowerCase();
  return (
    k.includes("token") ||
    k.includes("password") ||
    k.includes("secret") ||
    k === "apikey" ||
    k === "applicationkey" ||
    k.includes("apppassword")
  );
}

function maskConfigForDisplay(config: Record<string, string> | null | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(config || {})) {
    const s = String(value ?? "");
    // Use the same ASCII placeholder as SECRET_PLACEHOLDER so stripSecretPlaceholders
    // can identify and remove these values when they reach test/save endpoints.
    out[key] = s && isLikelySecretConfigKey(key) ? SECRET_PLACEHOLDER : s;
  }
  return out;
}

function stripSecretPlaceholders(
  config: Record<string, string> | null | undefined,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(config || {}).filter(([key, value]) => {
      if (!isLikelySecretConfigKey(key)) return true;
      const v = String(value || "").trim();
      // Strip both the current ASCII placeholder ("••••") and the legacy
      // bullet-character placeholder ("••••" U+2022) that older configs may contain.
      return v !== SECRET_PLACEHOLDER && v !== "••••";
    }),
  );
}

async function ensureDefaultCatalogSeeded() {
  const existingRows = await db.select().from(integrationToolCatalog);
  const existingKeys = new Set(existingRows.map((row) => `${row.categoryKey}:${row.providerKey}`));
  const missing = DEFAULT_TOOL_CATALOG.filter(
    (entry) => !existingKeys.has(`${entry.categoryKey}:${entry.providerKey}`)
  );

  for (const entry of DEFAULT_TOOL_CATALOG) {
    await db
      .update(integrationToolCatalog)
      .set({
        displayName: entry.displayName,
        isActive: 1,
        supportsTesting: entry.supportsTesting,
        requiredFields: entry.requiredFields as unknown as CatalogField[],
        testConfig: entry.testConfig as CatalogTestConfig,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(integrationToolCatalog.categoryKey, entry.categoryKey),
          eq(integrationToolCatalog.providerKey, entry.providerKey)
        )
      );
  }

  await db
    .update(integrationToolCatalog)
    .set({ isActive: 0, updatedAt: new Date() })
    .where(inArray(integrationToolCatalog.providerKey, [...DEPRECATED_CATALOG_PROVIDER_KEYS]));

  if (missing.length === 0) {
    return;
  }

  await db.insert(integrationToolCatalog).values(
    missing.map((entry) => ({
      id: crypto.randomUUID(),
      categoryKey: entry.categoryKey,
      providerKey: entry.providerKey,
      displayName: entry.displayName,
      isActive: 1,
      supportsTesting: entry.supportsTesting,
      requiredFields: entry.requiredFields as unknown as CatalogField[],
      testConfig: entry.testConfig as CatalogTestConfig,
    }))
  );
}

function applyTemplate(template: string, values: Record<string, string>): string {
  return template.replace(/\{([^}]+)\}/g, (_match, key) => {
    if (key === "datadogApiBaseUrl") {
      return resolveDatadogApiBaseUrl(values);
    }
    const value = values[key] || "";
    if (key === "projectId" && template.includes("/api/v4/projects/{projectId}")) {
      return encodeURIComponent(value);
    }
    return value;
  });
}

function validateRequiredFields(requiredFields: CatalogField[], config: Record<string, string>) {
  const missing = requiredFields
    .filter((field) => field.required && !String(config[field.key] || "").trim())
    .map((field) => field.key);
  return missing;
}

function validateMetadataRequiredFields(requiredFields: CatalogField[], config: Record<string, string>, metadataOnly: boolean) {
  return requiredFields
    .filter((field) => !metadataOnly || !isLikelySecretConfigKey(field.key))
    .filter((field) => field.required && !String(config[field.key] || "").trim())
    .map((field) => field.key);
}

function extractRepoCredential(providerKey: string, config: Record<string, string>) {
  if (!isGitProvider(providerKey)) return null;
  const token =
    providerKey === "bitbucket"
      ? String(config.appPassword || config.apiToken || config.patToken || config.token || "").trim()
      : String(config.patToken || config.apiToken || config.token || config.appPassword || "").trim();
  if (!token || token === SECRET_PLACEHOLDER || token === "••••") return null;
  const baseUrl = String(config.baseUrl || config.url || "").trim() || undefined;
  return { provider: providerKey as GitProvider, baseUrl, token };
}

function stripRepoCredentialSecrets(providerKey: string, config: Record<string, string>) {
  if (!isGitProvider(providerKey)) return config;
  return Object.fromEntries(
    Object.entries(config).filter(([key]) => !isLikelySecretConfigKey(key)),
  );
}

async function saveRepoCredentialForUser(
  req: Request,
  providerKey: string,
  config: Record<string, string>,
  projectId?: string,
) {
  const credential = extractRepoCredential(providerKey, config);
  if (!credential) return;
  const userId = (req as any).user?.id;
  if (!userId) {
    throw new Error("Repository credentials are user-specific and require a signed-in user.");
  }
  if (projectId) {
    await saveUserProjectRepoCredential(userId, projectId, credential);
    await testUserProjectRepoCredential(userId, projectId, credential.provider, credential.baseUrl);
    return;
  }
  await saveUserGitCredential(userId, credential);
  await testUserGitCredential(userId, credential.provider, credential.baseUrl);
}

function encryptConfigSecrets(config: Record<string, string>) {
  const encryptedConfig: Record<string, string> = { ...config };
  Object.keys(encryptedConfig).forEach((key) => {
    if (isLikelySecretConfigKey(key)) {
      const raw = encryptedConfig[key];
      encryptedConfig[key] = encryptPAT(raw ?? "") ?? "";
    }
  });
  return encryptedConfig;
}

function normalizeTestSteps(testConfig: CatalogTestConfig): CatalogTestStep[] {
  if (!testConfig) return [];
  if (testConfig.checks && testConfig.checks.length > 0) {
    return testConfig.checks;
  }
  if (testConfig.urlTemplate) {
    return [
      {
        method: testConfig.method,
        urlTemplate: testConfig.urlTemplate,
        authHeader: testConfig.authHeader,
        apiKeyHeaderName: testConfig.apiKeyHeaderName,
        stopOnFailure: false,
        customHeaders: testConfig.customHeaders,
      },
    ];
  }
  return [];
}

function getConfigValue(
  config: Record<string, string>,
  primaryKey: string,
  fallbackKeys: string[] = []
): string {
  const aliasFallbacks: Record<string, string[]> = {
    applicationKey: ["appKey", "appId"],
    siteRegion: ["site", "region", "datadogSite"],
  };

  const candidateKeys = [primaryKey, ...fallbackKeys, ...(aliasFallbacks[primaryKey] || [])];
  for (const key of candidateKeys) {
    const value = String(config[key] || "").trim();
    if (value) {
      return value;
    }
  }

  return "";
}

function resolveDatadogApiBaseUrl(config: Record<string, string>): string {
  const rawSite = getConfigValue(config, "siteRegion");
  const site = rawSite.replace(/\/+$/, "").trim();
  const normalizedSite = site.toLowerCase();

  const siteAliases: Record<string, string> = {
    us1: "https://api.datadoghq.com",
    us: "https://api.datadoghq.com",
    "us-central": "https://api.datadoghq.com",
    "us central": "https://api.datadoghq.com",
    "us-central region": "https://api.datadoghq.com",
    "us central region": "https://api.datadoghq.com",
    default: "https://api.datadoghq.com",
    us3: "https://api.us3.datadoghq.com",
    us5: "https://api.us5.datadoghq.com",
    eu: "https://api.datadoghq.eu",
    ap1: "https://api.ap1.datadoghq.com",
    ap2: "https://api.ap2.datadoghq.com",
    "us1-fed": "https://api.ddog-gov.com",
    "us1 fed": "https://api.ddog-gov.com",
    gov: "https://api.ddog-gov.com",
    government: "https://api.ddog-gov.com",
  };

  if (!site) {
    return "https://api.datadoghq.com";
  }

  if (siteAliases[normalizedSite]) {
    return siteAliases[normalizedSite];
  }

  if (/^https?:\/\//i.test(site)) {
    return site;
  }

  if (/^api\./i.test(site)) {
    return `https://${site}`;
  }

  return `https://api.${site}`;
}

function ensureValidUrl(url: string, context?: string): string {
  try {
    return new URL(url).toString();
  } catch {
    const hint = context ? ` (${context})` : "";
    throw new Error(
      `Invalid URL${hint}: "${url}". Please provide a complete URL starting with https:// (e.g. https://gitlab.example.com).`
    );
  }
}

function ensureDatadogUrl(url: string): string {
  try {
    return new URL(url).toString();
  } catch {
    throw new Error(
      `Invalid Datadog site region or URL: "${url}". Use values like US1, US3, US5, EU, AP1, AP2, US1-FED, datadoghq.eu, or a full https://api... URL.`
    );
  }
}

function applyCustomHeaders(
  headers: Record<string, string>,
  testStep: CatalogTestStep,
  config: Record<string, string>
): Record<string, string> {
  const customHeaders = testStep.customHeaders || [];
  if (customHeaders.length === 0) {
    return headers;
  }

  const resolvedHeaders = { ...headers };
  for (const binding of customHeaders) {
    const value = getConfigValue(config, binding.configKey, binding.fallbackKeys || []);
    if (value) {
      resolvedHeaders[binding.headerName] = value;
    }
  }

  return resolvedHeaders;
}

function buildAuthHeaderVariants(
  testStep: CatalogTestStep,
  config: Record<string, string>,
  url: string
): Record<string, string>[] {
  const baseHeaders: Record<string, string> = {
    Accept: "application/json",
  };
  const authCandidates: string[] = [String(config.username || config.email || config.workspace || "").trim()];
  const isBitbucket = url.includes("api.bitbucket.org");
  const isGitLab = url.includes("/api/v4");
  const basicToken = String(
    isBitbucket
      ? config.appPassword || config.apiToken || config.patToken || ""
      : config.patToken || config.apiToken || config.appPassword || "",
  ).trim();
  const bearerToken = String(config.patToken || config.apiToken || "").trim();

  if (isBitbucket && authCandidates[0].includes("@")) {
    authCandidates.push(authCandidates[0].split("@")[0].trim());
  }

  const headersList: Record<string, string>[] = [];

  // GitLab (incl. self-hosted instances behind a gateway) authenticates with its
  // native PRIVATE-TOKEN header. Try it first so this test mirrors how the rest of
  // the app talks to GitLab (gitlab-repos.ts / repo-provider-service.ts) — a Bearer
  // request can be routed differently by a fronting gateway and fail.
  if (isGitLab) {
    const gitlabToken = getConfigValue(config, "patToken", ["apiToken", "token"]);
    if (gitlabToken) {
      headersList.push(applyCustomHeaders({
        ...baseHeaders,
        "PRIVATE-TOKEN": gitlabToken,
      }, testStep, config));
    }
  }

  if (testStep.authHeader === "bearer_token") {
    headersList.push(applyCustomHeaders({
      ...baseHeaders,
      Authorization: `Bearer ${getConfigValue(config, "patToken", ["apiToken", "token"])}`,
    }, testStep, config));
  } else if (testStep.authHeader === "basic_user_token") {
    for (const candidate of authCandidates.filter(Boolean)) {
      headersList.push(applyCustomHeaders({
        ...baseHeaders,
        Authorization: `Basic ${Buffer.from(`${candidate}:${basicToken}`).toString("base64")}`,
      }, testStep, config));
    }
    if (basicToken && headersList.length === 0) {
      // Azure DevOps PAT auth commonly uses an empty username with the token as the password.
      headersList.push(applyCustomHeaders({
        ...baseHeaders,
        Authorization: `Basic ${Buffer.from(`:${basicToken}`).toString("base64")}`,
      }, testStep, config));
    }
    if (isBitbucket && bearerToken) {
      headersList.push(applyCustomHeaders({
        ...baseHeaders,
        Authorization: `Bearer ${bearerToken}`,
      }, testStep, config));
    }
  } else if (testStep.authHeader === "api_key_header") {
    const headerName = testStep.apiKeyHeaderName || "X-API-KEY";
    const apiKey = getConfigValue(config, "apiKey", ["patToken", "apiToken", "token"]);
    headersList.push(applyCustomHeaders({
      ...baseHeaders,
      [headerName]: apiKey,
    }, testStep, config));
  } else {
    headersList.push(applyCustomHeaders(baseHeaders, testStep, config));
  }

  return headersList;
}

async function readErrorBody(response: globalThis.Response): Promise<string> {
  const contentType = response.headers.get("content-type") || "";

  try {
    if (contentType.includes("application/json")) {
      const body = await response.json();
      if (typeof body === "string" && body.trim()) {
        return body.trim();
      }
      if (Array.isArray(body?.errors) && body.errors.length > 0) {
        return body.errors.map((item: unknown) => String(item)).join(", ");
      }
      const message = body?.message || body?.error || body?.detail || body?.errors?.[0];
      if (message) {
        return String(message).trim();
      }
      return JSON.stringify(body) || "";
    }

    const text = (await response.text()).trim();
    return text;
  } catch {
    return "";
  }
}

async function validateGitLabProjectAccess(
  response: globalThis.Response,
  minimumAccessLevel: number,
): Promise<{ success: boolean; message?: string }> {
  let payload: any;
  try {
    payload = await response.json();
  } catch {
    return {
      success: false,
      message:
        "Connection test failed: GitLab project response did not include permission details.",
    };
  }

  const projectAccess = Number(payload?.permissions?.project_access?.access_level || 0);
  const groupAccess = Number(payload?.permissions?.group_access?.access_level || 0);
  const effectiveAccess = Math.max(projectAccess, groupAccess);
  if (effectiveAccess >= minimumAccessLevel) {
    return { success: true };
  }

  const accessName =
    effectiveAccess >= 50
      ? "Owner"
      : effectiveAccess >= 40
        ? "Maintainer"
        : effectiveAccess >= 30
          ? "Developer"
          : effectiveAccess >= 20
            ? "Reporter"
            : effectiveAccess >= 10
              ? "Guest"
              : "No project access";
  return {
    success: false,
    message:
      `Connection test failed: GitLab token has ${accessName} access, but Developer or higher is required to execute CI/CD pipelines.`,
  };
}

const TEST_TIMEOUT_MS = 15_000;

function makeAbortSignal(): AbortSignal {
  const controller = new AbortController();
  setTimeout(() => controller.abort(), TEST_TIMEOUT_MS);
  return controller.signal;
}

function isHtmlResponse(response: globalThis.Response): boolean {
  const ct = (response.headers.get("content-type") || "").toLowerCase();
  return ct.includes("text/html");
}

async function safeFetch(
  url: string,
  options: RequestInit
): Promise<globalThis.Response> {
  return fetch(url, { redirect: "error", signal: makeAbortSignal(), ...options });
}

async function runSingleStep(
  config: Record<string, string>,
  testStep: CatalogTestStep
): Promise<{ success: boolean; message: string }> {
  const method = testStep.method || "GET";
  let url: string;
  try {
    const expanded = applyTemplate(testStep.urlTemplate, config);
    // Use the Datadog-specific error message only when the template resolves to a Datadog URL.
    url = expanded.toLowerCase().includes("datadoghq") || expanded.toLowerCase().includes("ddog-gov")
      ? ensureDatadogUrl(expanded)
      : ensureValidUrl(expanded, testStep.label);
  } catch (error) {
    return {
      success: false,
      message: error instanceof Error ? error.message : "Invalid test URL",
    };
  }
  const isBitbucket = url.includes("api.bitbucket.org");
  const baseHeaders: Record<string, string> = {
    Accept: "application/json",
  };
  const authCandidates: string[] = [String(config.username || config.email || config.workspace || "").trim()];
  const basicToken = String(
    config.appPassword || config.apiToken || config.patToken || "",
  ).trim();
  const bearerToken = String(config.patToken || config.apiToken || "").trim();

  if (isBitbucket) {
    const workspace = String(config.workspace || "").trim();
    const usernames = authCandidates.filter(Boolean);
    const bitbucketUrls = ["https://api.bitbucket.org/2.0/user"];
    if (workspace) {
      bitbucketUrls.push(`https://api.bitbucket.org/2.0/workspaces/${encodeURIComponent(workspace)}`);
    }

    let saw401 = false;
    for (const attemptUrl of bitbucketUrls) {
      for (const username of usernames) {
        if (!basicToken) {
          break;
        }
        const basicHeaders = {
          ...baseHeaders,
          Authorization: `Basic ${Buffer.from(`${username}:${basicToken}`).toString("base64")}`,
        };
        try {
          const basicResponse = await safeFetch(attemptUrl, { method, headers: basicHeaders });
          if (basicResponse.ok && !isHtmlResponse(basicResponse)) {
            return { success: true, message: "Connection successful" };
          }
          saw401 = saw401 || basicResponse.status === 401;
        } catch {
          // redirect or timeout — treat as auth failure
        }
      }

      // Workspace/repo access tokens typically work as Bearer.
      if (bearerToken) {
        const bearerHeaders = {
          ...baseHeaders,
          Authorization: `Bearer ${bearerToken}`,
        };
        try {
          const bearerResponse = await safeFetch(attemptUrl, { method, headers: bearerHeaders });
          if (bearerResponse.ok && !isHtmlResponse(bearerResponse)) {
            return { success: true, message: "Connection successful" };
          }
          saw401 = saw401 || bearerResponse.status === 401;
        } catch {
          // redirect or timeout
        }
      }
    }

    if (saw401) {
      return {
        success: false,
        message:
          "Bitbucket auth failed (401). For App Password use Bitbucket username + app password. For Access Token/PAT use Bearer token and ensure workspace/repository scopes are enabled.",
      };
    }
    return { success: false, message: "Bitbucket connection test failed" };
  }

  const headersList = buildAuthHeaderVariants(testStep, config, url);
  // GitLab can sit behind a gateway/load balancer that 30x-redirects API calls
  // (e.g. host normalization). The golden-repo path follows redirects, so mirror
  // that here instead of treating any redirect as a hard failure.
  const isGitLab = url.includes("/api/v4");
  let lastStatus = 0;
  let lastErrorBody = "";
  for (const headers of headersList) {
    let response: globalThis.Response;
    try {
      response = await safeFetch(url, {
        method,
        headers,
        redirect: isGitLab ? "follow" : "error",
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const isTimeout = msg.includes("abort") || msg.toLowerCase().includes("timeout");
      const isRedirect = msg.toLowerCase().includes("redirect");
      return {
        success: false,
        message: isTimeout
          ? `Connection test timed out after ${TEST_TIMEOUT_MS / 1000}s — check the URL and network access`
          : isRedirect
            ? "Connection failed: server redirected to a login page — invalid credentials or incorrect URL"
            : `Connection test failed: ${msg}`,
      };
    }

    lastStatus = response.status;

    // A 200-range response that returns HTML is a redirect-to-login, not a real API success.
    if (response.ok && isHtmlResponse(response)) {
      return {
        success: false,
        message: "Connection failed: server returned an HTML login page instead of a JSON API response — check credentials and URL",
      };
    }

    if (response.ok) {
      if (testStep.gitlabMinimumProjectAccessLevel) {
        const validation = await validateGitLabProjectAccess(
          response,
          testStep.gitlabMinimumProjectAccessLevel,
        );
        if (!validation.success) {
          return {
            success: false,
            message: validation.message || "Connection test failed: insufficient GitLab project access.",
          };
        }
      }
      return { success: true, message: "Connection successful" };
    }
    lastErrorBody = await readErrorBody(response);
    if (response.status !== 401) {
      break;
    }
  }

  return {
    success: false,
    message:
      url.includes("datadoghq") && url.includes("/api/v2/validate_keys") && lastStatus === 403
        ? `Connection test failed (403): ${lastErrorBody || "Forbidden"}. The API key reached Datadog, but the application key is invalid, not propagated yet, or lacks permission to read data for this site.`
        : url.includes("datadoghq") && url.includes("/api/v1/validate") && lastStatus === 403
          ? `Connection test failed (403): ${lastErrorBody || "Forbidden"}. The Datadog API key is invalid for the selected site region.`
        : lastErrorBody
          ? `Connection test failed (${lastStatus || 400}): ${lastErrorBody}`
          : `Connection test failed (${lastStatus || 400})`,
  };
}

async function runConnectionTest(
  config: Record<string, string>,
  testConfig: CatalogTestConfig
): Promise<{ success: boolean; message: string }> {
  const steps = normalizeTestSteps(testConfig);
  if (steps.length === 0) {
    return { success: false, message: "Provider does not define a test endpoint" };
  }

  const messages: string[] = [];
  for (const step of steps) {
    const label = step.label || "Check";
    const result = await runSingleStep(config, step);
    if (!result.success) {
      messages.push(`${label}: ${result.message}`);
      if (step.stopOnFailure) {
        break;
      }
    }
  }

  if (messages.length > 0) {
    return { success: false, message: messages.join("; ") };
  }

  return { success: true, message: "Connection successful" };
}

function decryptStoredConfig(
  config: Record<string, string> | null | undefined,
  secretsEncrypted: string | null | undefined
): Record<string, string> {
  const resolved = { ...(config || {}) };
  if (!secretsEncrypted) {
    return resolved;
  }

  try {
    const parsed = JSON.parse(secretsEncrypted) as Record<string, string>;
    Object.entries(parsed).forEach(([key, value]) => {
      resolved[key] = safeDecryptPAT(value) ?? value ?? "";
    });
  } catch {
    // Ignore malformed encrypted payloads and fall back to visible config fields.
  }

  return resolved;
}

async function getToolCatalogRow(toolCatalogId: string) {
  await ensureDefaultCatalogSeeded();
  const rows = await db
    .select()
    .from(integrationToolCatalog)
    .where(eq(integrationToolCatalog.id, toolCatalogId))
    .limit(1);
  return rows[0] || null;
}

async function ensureRepoCatalogRow(toolCatalogId: string) {
  const provider = await getToolCatalogRow(toolCatalogId);
  if (!provider) {
    throw new Error("Tool catalog item not found");
  }
  if (provider.categoryKey !== "repo") {
    throw new Error("Repository actions are only available for repo providers");
  }
  return provider;
}

export function registerToolIntegrationRoutes(app: Express) {
  app.get("/api/tool-catalog", async (_req: Request, res: Response) => {
    try {
      await ensureDefaultCatalogSeeded();
      const catalogRows = await db
        .select()
        .from(integrationToolCatalog)
        .where(eq(integrationToolCatalog.isActive, 1));
      res.json({ tools: catalogRows });
    } catch (error) {
      console.error("[GET /api/tool-catalog] Error:", error);
      res.status(500).json({ error: "Failed to fetch tool catalog" });
    }
  });

  // This module is registered before app.use("/api", autoBootstrapUser) in routes.ts,
  // so we must run autoBootstrapUser here or requireAuth sees no req.user (401).
  app.get(
    "/api/org-integration-configs",
    autoBootstrapUser,
    requireAuth,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const orgType = String(req.query.orgType || "").trim();
        const orgId = String(req.query.orgId || "").trim();
        if (!orgType || !orgId) {
          return res.status(400).json({ error: "Missing orgType or orgId" });
        }

        if (orgType === "ado") {
          const org = await db
            .select({ id: artifactOrganizations.id })
            .from(artifactOrganizations)
            .where(eq(artifactOrganizations.id, orgId))
            .limit(1);
          if (org.length === 0) {
            return res.status(404).json({ error: "Organization not found" });
          }
        } else if (orgType === "jira") {
          const conn = await db
            .select({ id: jiraConnections.id })
            .from(jiraConnections)
            .where(eq(jiraConnections.id, orgId))
            .limit(1);
          if (conn.length === 0) {
            return res.status(404).json({ error: "Jira connection not found" });
          }
        } else {
          return res.status(400).json({ error: "Invalid orgType" });
        }

        const rows = await db
          .select({
            id: orgIntegrationConfigs.id,
            toolCatalogId: orgIntegrationConfigs.toolCatalogId,
            config: orgIntegrationConfigs.config,
            lastTestStatus: orgIntegrationConfigs.lastTestStatus,
            lastTestMessage: orgIntegrationConfigs.lastTestMessage,
            lastTestedAt: orgIntegrationConfigs.lastTestedAt,
            categoryKey: integrationToolCatalog.categoryKey,
            providerKey: integrationToolCatalog.providerKey,
            displayName: integrationToolCatalog.displayName,
            supportsTesting: integrationToolCatalog.supportsTesting,
          })
          .from(orgIntegrationConfigs)
          .innerJoin(
            integrationToolCatalog,
            eq(orgIntegrationConfigs.toolCatalogId, integrationToolCatalog.id)
          )
          .where(and(eq(orgIntegrationConfigs.orgType, orgType), eq(orgIntegrationConfigs.orgId, orgId)));

        const configs = rows.map((row) => ({
          id: row.id,
          orgType,
          orgId,
          categoryKey: row.categoryKey,
          providerKey: row.providerKey,
          displayName: row.displayName,
          toolCatalogId: row.toolCatalogId,
          supportsTesting: row.supportsTesting,
          configDisplay: maskConfigForDisplay(row.config as Record<string, string>),
          lastTestStatus: row.lastTestStatus,
          lastTestMessage: row.lastTestMessage,
          lastTestedAt: row.lastTestedAt,
        }));

        return res.json({ configs });
      } catch (error) {
        console.error("[GET /api/org-integration-configs] Error:", error);
        return res.status(500).json({ error: "Failed to fetch org integration configs" });
      }
    }
  );

  app.post("/api/org-integration-configs", async (req: Request, res: Response) => {
    try {
      const { orgType, orgId, toolCatalogId, config } = req.body as {
        orgType: string;
        orgId: string;
        toolCatalogId: string;
        config: Record<string, string>;
      };

      if (!orgType || !orgId || !toolCatalogId || !config) {
        return res.status(400).json({ error: "Missing required fields" });
      }

      const provider = await db
        .select()
        .from(integrationToolCatalog)
        .where(eq(integrationToolCatalog.id, toolCatalogId))
        .limit(1);
      if (provider.length === 0) {
        return res.status(404).json({ error: "Tool catalog item not found" });
      }

      const isRepoProvider = provider[0].categoryKey === "repo" && isGitProvider(provider[0].providerKey);
      const requiredFields = (provider[0].requiredFields || []) as CatalogField[];
      const missing = validateMetadataRequiredFields(requiredFields, config, isRepoProvider);
      if (missing.length > 0) {
        return res.status(400).json({ error: "Missing required fields", fields: missing });
      }

      const sanitizedConfigWithCredential = stripSecretPlaceholders(config);
      await saveRepoCredentialForUser(req, provider[0].providerKey, sanitizedConfigWithCredential);
      const sanitizedConfig = isRepoProvider
        ? stripRepoCredentialSecrets(provider[0].providerKey, sanitizedConfigWithCredential)
        : sanitizedConfigWithCredential;
      const encryptedConfig = encryptConfigSecrets(sanitizedConfig);

      const id = crypto.randomUUID();
      await db.insert(orgIntegrationConfigs).values({
        id,
        orgType,
        orgId,
        toolCatalogId,
        config: sanitizedConfig,
        secretsEncrypted: JSON.stringify(encryptedConfig),
      });

      return res.json({ success: true, id });
    } catch (error) {
      console.error("[POST /api/org-integration-configs] Error:", error);
      return res.status(500).json({ error: "Failed to save org integration config" });
    }
  });

  app.post("/api/org-integration-configs/:id/test", async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { config } = (req.body || {}) as {
        config?: Record<string, string>;
      };
      const row = await db
        .select()
        .from(orgIntegrationConfigs)
        .where(eq(orgIntegrationConfigs.id, id))
        .limit(1);
      if (row.length === 0) {
        return res.status(404).json({ error: "Config not found" });
      }

      const provider = await db
        .select()
        .from(integrationToolCatalog)
        .where(eq(integrationToolCatalog.id, row[0].toolCatalogId))
        .limit(1);
      if (provider.length === 0) {
        return res.status(404).json({ error: "Tool catalog item not found" });
      }

      const decryptedConfig = decryptStoredConfig(
        row[0].config as Record<string, string>,
        row[0].secretsEncrypted
      );
      const effectiveConfig = {
        ...decryptedConfig,
        ...stripSecretPlaceholders(config || {}),
      };

      const result = await runConnectionTest(
        effectiveConfig,
        (provider[0].testConfig || null) as CatalogTestConfig
      );

      await db
        .update(orgIntegrationConfigs)
        .set({
          lastTestStatus: result.success ? "success" : "error",
          lastTestMessage: result.message,
          lastTestedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(orgIntegrationConfigs.id, id));

      return res.status(result.success ? 200 : 400).json(result);
    } catch (error) {
      console.error("[POST /api/org-integration-configs/:id/test] Error:", error);
      return res.status(500).json({ success: false, message: "Connection test failed" });
    }
  });

  app.put("/api/org-integration-configs/:id", async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { toolCatalogId, config } = req.body as {
        toolCatalogId: string;
        config: Record<string, string>;
      };

      if (!toolCatalogId || !config) {
        return res.status(400).json({ error: "Missing required fields" });
      }

      const existingRows = await db
        .select()
        .from(orgIntegrationConfigs)
        .where(eq(orgIntegrationConfigs.id, id))
        .limit(1);
      if (existingRows.length === 0) {
        return res.status(404).json({ error: "Config not found" });
      }

      const provider = await db
        .select()
        .from(integrationToolCatalog)
        .where(eq(integrationToolCatalog.id, toolCatalogId))
        .limit(1);
      if (provider.length === 0) {
        return res.status(404).json({ error: "Tool catalog item not found" });
      }

      const existingConfig = decryptStoredConfig(
        existingRows[0].config as Record<string, string>,
        existingRows[0].secretsEncrypted
      );
      const mergedConfig = {
        ...existingConfig,
        ...stripSecretPlaceholders(config),
      };

      const isRepoProvider = provider[0].categoryKey === "repo" && isGitProvider(provider[0].providerKey);
      const requiredFields = (provider[0].requiredFields || []) as CatalogField[];
      const missing = validateMetadataRequiredFields(requiredFields, mergedConfig, isRepoProvider);
      if (missing.length > 0) {
        return res.status(400).json({ error: "Missing required fields", fields: missing });
      }

      await saveRepoCredentialForUser(req, provider[0].providerKey, mergedConfig);
      const sanitizedConfig = isRepoProvider
        ? stripRepoCredentialSecrets(provider[0].providerKey, mergedConfig)
        : mergedConfig;
      const encryptedConfig = encryptConfigSecrets(sanitizedConfig);

      await db
        .update(orgIntegrationConfigs)
        .set({
          toolCatalogId,
          config: sanitizedConfig,
          secretsEncrypted: JSON.stringify(encryptedConfig),
          updatedAt: new Date(),
        })
        .where(eq(orgIntegrationConfigs.id, id));

      return res.json({ success: true, id });
    } catch (error) {
      console.error("[PUT /api/org-integration-configs/:id] Error:", error);
      return res.status(500).json({ error: "Failed to update org integration config" });
    }
  });

  app.delete("/api/org-integration-configs/:id", async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      await db.delete(orgIntegrationConfigs).where(eq(orgIntegrationConfigs.id, id));
      return res.json({ success: true, id });
    } catch (error) {
      console.error("[DELETE /api/org-integration-configs/:id] Error:", error);
      return res.status(500).json({ error: "Failed to delete org integration config" });
    }
  });

  // Test tool credentials before org/project is saved
  app.post("/api/tool-catalog/:toolCatalogId/test", async (req: Request, res: Response) => {
    try {
      const { toolCatalogId } = req.params;
      const { config: rawConfig } = req.body as { config: Record<string, string> };
      if (!rawConfig) {
        return res.status(400).json({ error: "Missing required field: config" });
      }

      // Strip any masked placeholder values ("••••") that came from a pre-filled edit form.
      // After stripping, if required secret fields are empty, surface a friendly message
      // rather than letting the raw placeholder crash the HTTP header builder.
      const config = stripSecretPlaceholders(rawConfig);

      const provider = await db
        .select()
        .from(integrationToolCatalog)
        .where(eq(integrationToolCatalog.id, toolCatalogId))
        .limit(1);
      if (provider.length === 0) {
        return res.status(404).json({ error: "Tool catalog item not found" });
      }

      const requiredFields = (provider[0].requiredFields || []) as CatalogField[];
      const missing = validateRequiredFields(requiredFields, config);
      if (missing.length > 0) {
        // Check whether the missing fields were originally present as masked placeholders
        // (i.e. the config came from a pre-filled edit form where secrets show as "••••").
        const wasPlaceholder = missing.some((key) => {
          const raw = String(rawConfig[key] || "").trim();
          return raw === SECRET_PLACEHOLDER || raw === "••••";
        });
        return res.status(400).json({
          error: wasPlaceholder
            ? "Credentials are hidden — please re-enter your credentials to test the connection."
            : "Missing required fields",
          fields: missing,
        });
      }

      const result = await runConnectionTest(config, (provider[0].testConfig || null) as CatalogTestConfig);
      return res.status(result.success ? 200 : 400).json(result);
    } catch (error) {
      console.error("[POST /api/tool-catalog/:toolCatalogId/test] Error:", error);
      return res.status(500).json({ success: false, message: "Connection test failed" });
    }
  });

  app.post("/api/tool-catalog/:toolCatalogId/repositories", autoBootstrapUser, requireAuth, async (req: Request, res: Response) => {
    try {
      const { toolCatalogId } = req.params;
      const { config } = req.body as { config?: Record<string, string> };
      const provider = await ensureRepoCatalogRow(toolCatalogId);
      const repositories = await listRepositoriesForProvider(
        provider.providerKey,
        config || {},
        {
          projectName: String(config?.projectName || "").trim(),
          userId: (req as AuthenticatedRequest).user?.id,
        },
      );
      return res.json({ repositories });
    } catch (error) {
      console.error("[POST /api/tool-catalog/:toolCatalogId/repositories] Error:", error);
      return res.status(400).json({
        error:
          error instanceof Error
            ? error.message
            : "Failed to load repositories for this repo provider",
      });
    }
  });

  app.post("/api/tool-catalog/:toolCatalogId/repositories/create", autoBootstrapUser, requireAuth, async (req: Request, res: Response) => {
    try {
      const { toolCatalogId } = req.params;
      const {
        config,
        name,
        visibility,
      } = req.body as {
        config?: Record<string, string>;
        name?: string;
        visibility?: "private" | "public";
      };
      const provider = await ensureRepoCatalogRow(toolCatalogId);
      const repository = await createRepositoryForProvider(
        provider.providerKey,
        config || {},
        {
          name: String(name || "").trim(),
          visibility,
        },
        {
          projectName: String(config?.projectName || "").trim(),
          userId: (req as AuthenticatedRequest).user?.id,
        },
      );
      return res.json({ repository });
    } catch (error) {
      console.error("[POST /api/tool-catalog/:toolCatalogId/repositories/create] Error:", error);
      return res.status(400).json({
        error:
          error instanceof Error ? error.message : "Failed to create repository",
      });
    }
  });

  app.post("/api/org-integration-configs/:id/repositories", async (req: Request, res: Response) => {
    try {
      return res.status(428).json({
        error:
          "Repository credentials are user-specific. Enter and validate your own PAT/API key instead of using an organization-level repository credential.",
      });
    } catch (error) {
      console.error("[POST /api/org-integration-configs/:id/repositories] Error:", error);
      return res.status(400).json({
        error:
          error instanceof Error
            ? error.message
            : "Failed to load repositories for this repo provider",
      });
    }
  });

  app.post("/api/org-integration-configs/:id/repositories/create", async (req: Request, res: Response) => {
    try {
      return res.status(428).json({
        error:
          "Repository credentials are user-specific. Enter and validate your own PAT/API key before creating repositories.",
      });
    } catch (error) {
      console.error("[POST /api/org-integration-configs/:id/repositories/create] Error:", error);
      return res.status(400).json({
        error:
          error instanceof Error ? error.message : "Failed to create repository",
      });
    }
  });

  // Returns saved project integration configs (non-secret fields plain, secret fields masked).
  app.get("/api/project-integration-configs", async (req: Request, res: Response) => {
    try {
      const projectId = String(req.query.projectId || "").trim();
      if (!projectId) {
        return res.status(400).json({ error: "Missing projectId query parameter" });
      }

      const rows = await db
        .select({
          id: projectIntegrationConfigs.id,
          categoryKey: projectIntegrationConfigs.categoryKey,
          useOrgDefault: projectIntegrationConfigs.useOrgDefault,
          orgIntegrationConfigId: projectIntegrationConfigs.orgIntegrationConfigId,
          toolCatalogId: projectIntegrationConfigs.toolCatalogId,
          config: projectIntegrationConfigs.config,
          lastTestStatus: projectIntegrationConfigs.lastTestStatus,
          lastTestMessage: projectIntegrationConfigs.lastTestMessage,
          providerKey: integrationToolCatalog.providerKey,
          displayName: integrationToolCatalog.displayName,
        })
        .from(projectIntegrationConfigs)
        .leftJoin(
          integrationToolCatalog,
          eq(projectIntegrationConfigs.toolCatalogId, integrationToolCatalog.id)
        )
        .where(eq(projectIntegrationConfigs.projectId, projectId))
        .orderBy(desc(projectIntegrationConfigs.updatedAt));

      const { isProjectIntegrationSkippedConfig } = await import(
        "@shared/project-integration-constants"
      );

      const configs = rows.map((row) => {
        const configObj = (row.config as Record<string, string>) || {};
        const skipped = isProjectIntegrationSkippedConfig(configObj);
        return {
          id: row.id,
          categoryKey: row.categoryKey,
          skipped,
          useOrgDefault: !!row.useOrgDefault,
          orgIntegrationConfigId: row.orgIntegrationConfigId,
          toolCatalogId: row.toolCatalogId,
          providerKey: row.providerKey,
          displayName: row.displayName,
          configDisplay: skipped ? {} : maskConfigForDisplay(configObj),
          lastTestStatus: row.lastTestStatus,
          lastTestMessage: row.lastTestMessage,
        };
      });

      return res.json({ configs });
    } catch (error) {
      console.error("[GET /api/project-integration-configs] Error:", error);
      return res.status(500).json({ error: "Failed to fetch project integration configs" });
    }
  });

  app.post("/api/project-integration-configs", async (req: Request, res: Response) => {
    try {
      const payload = req.body as {
        projectId: string;
        categoryKey: string;
        useOrgDefault?: boolean;
        orgIntegrationConfigId?: string;
        toolCatalogId?: string;
        config?: Record<string, string>;
        skipped?: boolean;
      };

      if (!payload.projectId || !payload.categoryKey) {
        return res.status(400).json({ error: "Missing required fields" });
      }
      if (payload.categoryKey === "repo" && payload.useOrgDefault) {
        return res.status(400).json({
          error: "Repository credentials are user-specific and cannot inherit organization credentials.",
        });
      }

      const ownerCheck = await assertProjectIntegrationOwner(req, payload.projectId);
      if (!ownerCheck.ok) {
        return res.status(ownerCheck.status).json(ownerCheck.body);
      }
      const normalizedProjectId = ownerCheck.projectId;

      const existing = await db
        .select()
        .from(projectIntegrationConfigs)
        .where(
          and(
            eq(projectIntegrationConfigs.projectId, normalizedProjectId),
            eq(projectIntegrationConfigs.categoryKey, payload.categoryKey)
          )
        )
        .limit(1);

      const { PROJECT_INTEGRATION_SKIPPED_KEY } = await import(
        "@shared/project-integration-constants"
      );

      const isSkipped = payload.skipped === true;
      let repoProviderKey = "";
      let selectedProvider: {
        categoryKey: string;
        providerKey: string;
        requiredFields: unknown;
        testConfig: unknown;
      } | null = null;
      if (!isSkipped && payload.toolCatalogId) {
        const [providerRow] = await db
          .select({
            id: integrationToolCatalog.id,
            categoryKey: integrationToolCatalog.categoryKey,
            providerKey: integrationToolCatalog.providerKey,
            requiredFields: integrationToolCatalog.requiredFields,
            testConfig: integrationToolCatalog.testConfig,
          })
          .from(integrationToolCatalog)
          .where(eq(integrationToolCatalog.id, payload.toolCatalogId))
          .limit(1);
        selectedProvider = providerRow || null;
        repoProviderKey = selectedProvider?.categoryKey === "repo" ? selectedProvider.providerKey : "";
      }

      const existingConfig =
        !isSkipped && existing.length > 0
          ? decryptStoredConfig(
              (existing[0].config || {}) as Record<string, string>,
              existing[0].secretsEncrypted,
            )
          : {};
      const sanitizedConfigWithCredential = isSkipped
        ? { [PROJECT_INTEGRATION_SKIPPED_KEY]: "1" }
        : {
            ...existingConfig,
            ...stripSecretPlaceholders(payload.config || {}),
          };
      if (!isSkipped && selectedProvider) {
        const requiredFields = (selectedProvider.requiredFields || []) as CatalogField[];
        const isRepoProvider =
          selectedProvider.categoryKey === "repo" &&
          isGitProvider(selectedProvider.providerKey);
        const missing = validateMetadataRequiredFields(
          requiredFields,
          sanitizedConfigWithCredential,
          isRepoProvider,
        );
        if (missing.length > 0) {
          return res.status(400).json({ error: "Missing required fields", fields: missing });
        }
        if (selectedProvider.categoryKey === "cicd" && selectedProvider.providerKey === "gitlab_ci") {
          const testResult = await runConnectionTest(
            sanitizedConfigWithCredential,
            (selectedProvider.testConfig || null) as CatalogTestConfig,
          );
          if (!testResult.success) {
            return res.status(400).json({
              error: testResult.message,
              message: testResult.message,
            });
          }
        }
      }
      if (!isSkipped && repoProviderKey) {
        await saveRepoCredentialForUser(req, repoProviderKey, sanitizedConfigWithCredential, normalizedProjectId);
      }
      const sanitizedConfig = !isSkipped && repoProviderKey
        ? stripRepoCredentialSecrets(repoProviderKey, sanitizedConfigWithCredential)
        : sanitizedConfigWithCredential;
      const values = {
        projectId: normalizedProjectId,
        categoryKey: payload.categoryKey,
        useOrgDefault: isSkipped ? 0 : payload.useOrgDefault ? 1 : 0,
        orgIntegrationConfigId: isSkipped ? null : payload.orgIntegrationConfigId || null,
        toolCatalogId: isSkipped ? null : payload.toolCatalogId || null,
        config: sanitizedConfig || null,
        secretsEncrypted: isSkipped
          ? null
          : Object.keys(sanitizedConfig).length > 0
          ? JSON.stringify(encryptConfigSecrets(sanitizedConfig))
          : null,
      };

      if (existing.length > 0) {
        await db
          .update(projectIntegrationConfigs)
          .set({
            ...values,
            updatedAt: new Date(),
            ...(isSkipped
              ? {
                  lastTestStatus: "untested",
                  lastTestMessage: null,
                  lastTestedAt: null,
                }
              : {}),
          })
          .where(eq(projectIntegrationConfigs.id, existing[0].id));
        return res.json({ success: true, id: existing[0].id });
      }

      const id = crypto.randomUUID();
      await db.insert(projectIntegrationConfigs).values({ id, ...values });
      return res.json({ success: true, id });
    } catch (error) {
      console.error("[POST /api/project-integration-configs] Error:", error);
      return res.status(500).json({
        error: "Failed to save project integration config",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  app.post("/api/project-integration-configs/:id/test", async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { config: formConfig } = (req.body || {}) as {
        config?: Record<string, string>;
      };
      const row = await db
        .select()
        .from(projectIntegrationConfigs)
        .where(eq(projectIntegrationConfigs.id, id))
        .limit(1);
      if (row.length === 0) {
        return res.status(404).json({ error: "Config not found" });
      }

      let effectiveConfig: Record<string, string> = {};
      let testConfig: CatalogTestConfig = null;

      if (row[0].categoryKey === "repo" && row[0].useOrgDefault === 1) {
        return res.status(428).json({
          success: false,
          message:
            "Repository credentials are user-specific. Configure and validate your own PAT/API key for this project.",
        });
      }

      if (row[0].useOrgDefault === 1 && row[0].orgIntegrationConfigId) {
        const orgConfig = await db
          .select()
          .from(orgIntegrationConfigs)
          .where(eq(orgIntegrationConfigs.id, row[0].orgIntegrationConfigId))
          .limit(1);
        if (orgConfig.length === 0) {
          return res.status(404).json({ error: "Org integration config not found" });
        }
        effectiveConfig = decryptStoredConfig(
          orgConfig[0].config as Record<string, string>,
          orgConfig[0].secretsEncrypted,
        );
        const provider = await db
          .select()
          .from(integrationToolCatalog)
          .where(eq(integrationToolCatalog.id, orgConfig[0].toolCatalogId))
          .limit(1);
        testConfig = (provider[0]?.testConfig || null) as CatalogTestConfig;
      } else {
        effectiveConfig = decryptStoredConfig(
          (row[0].config || {}) as Record<string, string>,
          row[0].secretsEncrypted,
        );
        if (row[0].toolCatalogId) {
          const provider = await db
            .select()
            .from(integrationToolCatalog)
            .where(eq(integrationToolCatalog.id, row[0].toolCatalogId))
            .limit(1);
          testConfig = (provider[0]?.testConfig || null) as CatalogTestConfig;
        }
      }

      // Merge non-secret edits from the form; masked placeholders keep stored secrets.
      effectiveConfig = {
        ...effectiveConfig,
        ...stripSecretPlaceholders(formConfig || {}),
      };

      const result = await runConnectionTest(effectiveConfig, testConfig);
      await db
        .update(projectIntegrationConfigs)
        .set({
          lastTestStatus: result.success ? "success" : "error",
          lastTestMessage: result.message,
          lastTestedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(projectIntegrationConfigs.id, id));

      return res.status(result.success ? 200 : 400).json(result);
    } catch (error) {
      console.error("[POST /api/project-integration-configs/:id/test] Error:", error);
      return res.status(500).json({ success: false, message: "Project integration connection test failed" });
    }
  });

  app.get("/api/projects/:projectId/integration-effective", async (req: Request, res: Response) => {
    try {
      const { projectId } = req.params;
      const { lookupProjectId } = await resolveProjectIntegrationLookup(projectId);
      const rows = await db
        .select()
        .from(projectIntegrationConfigs)
        .where(
          or(
            eq(projectIntegrationConfigs.projectId, lookupProjectId),
            eq(projectIntegrationConfigs.projectId, projectId),
          ),
        )
        .orderBy(
          desc(projectIntegrationConfigs.updatedAt),
          desc(projectIntegrationConfigs.createdAt),
        );

      const latestByCategory = new Map<string, typeof rows[number]>();
      for (const row of rows) {
        if (!latestByCategory.has(row.categoryKey)) {
          latestByCategory.set(row.categoryKey, row);
        }
      }

      const categoryKeys = new Set<string>(latestByCategory.keys());
      const catalogRows = await db
        .select({ categoryKey: integrationToolCatalog.categoryKey })
        .from(integrationToolCatalog);
      for (const row of catalogRows) {
        if (row.categoryKey) categoryKeys.add(row.categoryKey);
      }

      const resolved = (
        await Promise.all(
          Array.from(categoryKeys).map(async (categoryKey) => {
            const effective = await resolveProjectIntegrationCategory(projectId, categoryKey);
            if (effective.status !== "configured") return null;

            const rawRow = latestByCategory.get(categoryKey);
            return {
              categoryKey,
              source: effective.source,
              toolCatalogId: effective.toolCatalogId || null,
              providerKey: effective.providerKey || null,
              displayName: effective.displayName || null,
              config: maskConfigForDisplay(effective.config || {}),
              testStatus:
                rawRow?.lastTestStatus ||
                (effective.source === "project_override" ? "untested" : "configured"),
              testedAt: rawRow?.lastTestedAt || null,
            };
          }),
        )
      ).filter(Boolean);

      return res.json({ projectId, integrations: resolved });
    } catch (error) {
      console.error("[GET /api/projects/:projectId/integration-effective] Error:", error);
      return res.status(500).json({ error: "Failed to resolve effective integration config" });
    }
  });
}
