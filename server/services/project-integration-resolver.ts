import { and, desc, eq, or } from "drizzle-orm";
import {
  artifactOrganizations,
  integrationToolCatalog,
  orgIntegrationConfigs,
  projectIntegrationConfigs,
  jiraConnections,
  sdlcProjects,
} from "@shared/schema";
import { db } from "../db";
import { safeDecryptPAT } from "../crypto-utils";
import { isProjectIntegrationSkippedConfig } from "@shared/project-integration-constants";

type ResolvedStatus = "configured" | "missing" | "skipped" | "unsupported";

export interface ResolvedProjectIntegration {
  status: ResolvedStatus;
  categoryKey: string;
  integrationType: "ado" | "jira";
  source: "project_override" | "org_default" | "fallback" | "none";
  providerKey?: string;
  toolCatalogId?: string;
  displayName?: string;
  config: Record<string, string>;
  errorCode?: "TOOL_NOT_CONFIGURED" | "TOKEN_EXPIRED" | "UNSUPPORTED_PROVIDER";
  message?: string;
}

type LookupProjectRow = {
  id: string;
  name: string | null;
  integrationType: string | null;
  organization: string | null;
  adoProjecturl: string | null;
  jiraConnectionId: string | null;
};

function decryptConfig(
  config: Record<string, string> | null | undefined,
  secretsEncrypted: string | null | undefined,
): Record<string, string> {
  const result: Record<string, string> = { ...(config || {}) };
  if (!secretsEncrypted) return result;

  try {
    const parsed = JSON.parse(secretsEncrypted) as Record<string, string>;
    Object.entries(parsed).forEach(([key, value]) => {
      const decrypted = safeDecryptPAT(value);
      result[key] = decrypted ?? value ?? "";
    });
  } catch {
    // keep plain config; malformed encrypted blob should not crash resolution
  }

  return result;
}

function normalizeUrl(value: string | null | undefined): string {
  return String(value || "").trim().replace(/\/+$/, "").toLowerCase();
}

function normalizeOrganizationIdentity(value: string | null | undefined): string | null {
  if (!value) return null;
  let org = String(value).trim();
  if (!org) return null;

  if (org.includes("dev.azure.com")) {
    org = org.replace(/https?:\/\/dev\.azure\.com\//, "").replace(/\/$/, "");
    org = org.split("/")[0];
  } else if (org.includes("visualstudio.com")) {
    const match = org.match(/([^\.]+)\.visualstudio\.com/);
    if (match) {
      org = match[1];
    }
  } else if (org.includes("atlassian.net")) {
    try {
      const parsed = new URL(org.startsWith("http") ? org : `https://${org}`);
      org = parsed.hostname;
    } catch {
      org = org.replace(/^https?:\/\//, "").split("/")[0];
    }
  } else {
    org = org.replace(/^https?:\/\//, "").split("/")[0];
  }

  return org.replace(/\/+$/, "").trim().toLowerCase() || null;
}

async function resolveImplicitOrgDefault(
  project: {
    integrationType?: string | null;
    organization?: string | null;
    adoProjecturl?: string | null;
    jiraConnectionId?: string | null;
  } | null | undefined,
  categoryKey: string,
) {
  const integrationType = (project?.integrationType || "ado") as "ado" | "jira";

  let orgType: "ado" | "jira";
  let orgId = "";

  if (integrationType === "jira") {
    orgType = "jira";
    orgId = String(project?.jiraConnectionId || "").trim();
    if (!orgId) return null;

    const [jiraConn] = await db
      .select({ id: jiraConnections.id })
      .from(jiraConnections)
      .where(eq(jiraConnections.id, orgId))
      .limit(1);

    if (!jiraConn) return null;
  } else {
    orgType = "ado";
    const projectOrgCandidates = new Set<string>();
    const pushCandidate = (value: string | null | undefined) => {
      const normalizedUrl = normalizeUrl(value);
      if (normalizedUrl) projectOrgCandidates.add(normalizedUrl);
      const normalizedIdentity = normalizeOrganizationIdentity(value);
      if (normalizedIdentity) projectOrgCandidates.add(normalizedIdentity);
    };

    pushCandidate(project?.organization);
    pushCandidate(project?.adoProjecturl);

    if (projectOrgCandidates.size === 0) return null;

    const orgRows = await db
      .select({
        id: artifactOrganizations.id,
        organizationUrl: artifactOrganizations.organizationUrl,
      })
      .from(artifactOrganizations);

    const matchingOrg = orgRows.find(
      (row) => {
        const rowUrl = normalizeUrl(row.organizationUrl);
        const rowIdentity = normalizeOrganizationIdentity(row.organizationUrl);
        return (
          (rowUrl && projectOrgCandidates.has(rowUrl)) ||
          (rowIdentity && projectOrgCandidates.has(rowIdentity))
        );
      },
    );

    if (!matchingOrg?.id) return null;
    orgId = matchingOrg.id;
  }

  const [orgCfg] = await db
    .select({
      id: orgIntegrationConfigs.id,
      toolCatalogId: orgIntegrationConfigs.toolCatalogId,
      config: orgIntegrationConfigs.config,
      secretsEncrypted: orgIntegrationConfigs.secretsEncrypted,
      providerKey: integrationToolCatalog.providerKey,
      displayName: integrationToolCatalog.displayName,
    })
    .from(orgIntegrationConfigs)
    .innerJoin(
      integrationToolCatalog,
      eq(orgIntegrationConfigs.toolCatalogId, integrationToolCatalog.id),
    )
    .where(
      and(
        eq(orgIntegrationConfigs.orgType, orgType),
        eq(orgIntegrationConfigs.orgId, orgId),
        eq(integrationToolCatalog.categoryKey, categoryKey),
      ),
    )
    .orderBy(
      desc(orgIntegrationConfigs.updatedAt),
      desc(orgIntegrationConfigs.createdAt),
    )
    .limit(1);

  if (!orgCfg) return null;

  return {
    source: "fallback" as const,
    providerKey: orgCfg.providerKey || undefined,
    toolCatalogId: orgCfg.toolCatalogId,
    displayName: orgCfg.displayName || undefined,
    config: decryptConfig(
      orgCfg.config as Record<string, string>,
      orgCfg.secretsEncrypted,
    ),
  };
}

export async function resolveProjectIntegrationLookup(
  projectId: string,
): Promise<{
  lookupProjectId: string;
  project: LookupProjectRow | null;
}> {
  const [project] = await db
    .select({
      id: sdlcProjects.id,
      name: sdlcProjects.name,
      integrationType: sdlcProjects.integrationType,
      organization: sdlcProjects.organization,
      adoProjecturl: sdlcProjects.adoProjecturl,
      jiraConnectionId: sdlcProjects.jiraConnectionId,
    })
    .from(sdlcProjects)
    .where(
      or(
        eq(sdlcProjects.id, projectId),
        eq(sdlcProjects.projectId, projectId),
      ),
    )
    .limit(1);

  return {
    lookupProjectId: project?.id || projectId,
    project: project || null,
  };
}

export async function resolveProjectIntegrationCategory(
  projectId: string,
  categoryKey: string,
): Promise<ResolvedProjectIntegration> {
  const { lookupProjectId, project } = await resolveProjectIntegrationLookup(projectId);

  const integrationType = (project?.integrationType || "ado") as "ado" | "jira";

  const [projectCfg] = await db
    .select()
    .from(projectIntegrationConfigs)
    .where(
      and(
        or(
          eq(projectIntegrationConfigs.projectId, lookupProjectId),
          eq(projectIntegrationConfigs.projectId, projectId),
        ),
        eq(projectIntegrationConfigs.categoryKey, categoryKey),
      ),
    )
    .orderBy(
      desc(projectIntegrationConfigs.updatedAt),
      desc(projectIntegrationConfigs.createdAt),
    )
    .limit(1);

  if (
    projectCfg &&
    isProjectIntegrationSkippedConfig(projectCfg.config as Record<string, string>)
  ) {
    return {
      status: "skipped",
      categoryKey,
      integrationType,
      source: "project_override",
      config: {},
      message: `${categoryKey} integration is skipped for this project.`,
    };
  }

  if (!projectCfg) {
    if (categoryKey === "repo") {
      return {
        status: "missing",
        categoryKey,
        integrationType,
        source: "none",
        config: {},
        errorCode: "TOOL_NOT_CONFIGURED",
        message:
          "Repository credentials are user-specific. Configure and validate your personal repository PAT/API key.",
      };
    }

    const implicitOrgDefault = await resolveImplicitOrgDefault(project, categoryKey);
    if (implicitOrgDefault) {
      return {
        status: "configured",
        categoryKey,
        integrationType,
        source: implicitOrgDefault.source,
        providerKey: implicitOrgDefault.providerKey,
        toolCatalogId: implicitOrgDefault.toolCatalogId,
        displayName: implicitOrgDefault.displayName,
        config: implicitOrgDefault.config,
      };
    }

    return {
      status: "missing",
      categoryKey,
      integrationType,
      source: "none",
      config: {},
      errorCode: "TOOL_NOT_CONFIGURED",
      message:
        integrationType === "jira"
          ? `No ${categoryKey} tool is configured for this project. Edit project and configure tool settings.`
          : undefined,
    };
  }

  if (projectCfg.useOrgDefault === 1 && projectCfg.orgIntegrationConfigId) {
    if (categoryKey === "repo") {
      return {
        status: "missing",
        categoryKey,
        integrationType,
        source: "org_default",
        config: {},
        errorCode: "TOOL_NOT_CONFIGURED",
        message:
          "Repository credentials are user-specific. Organization repository credentials cannot be inherited.",
      };
    }

    const [orgCfg] = await db
      .select({
        id: orgIntegrationConfigs.id,
        toolCatalogId: orgIntegrationConfigs.toolCatalogId,
        config: orgIntegrationConfigs.config,
        secretsEncrypted: orgIntegrationConfigs.secretsEncrypted,
      })
      .from(orgIntegrationConfigs)
      .where(eq(orgIntegrationConfigs.id, projectCfg.orgIntegrationConfigId))
      .limit(1);

    if (!orgCfg) {
      return {
        status: "missing",
        categoryKey,
        integrationType,
        source: "org_default",
        config: {},
        errorCode: "TOOL_NOT_CONFIGURED",
        message: `Configured org default for ${categoryKey} is missing. Reconfigure project tools.`,
      };
    }

    const [catalog] = await db
      .select()
      .from(integrationToolCatalog)
      .where(eq(integrationToolCatalog.id, orgCfg.toolCatalogId))
      .limit(1);

    return {
      status: "configured",
      categoryKey,
      integrationType,
      source: "org_default",
      providerKey: catalog?.providerKey || undefined,
      toolCatalogId: orgCfg.toolCatalogId,
      displayName: catalog?.displayName || undefined,
      config: decryptConfig(
        orgCfg.config as Record<string, string>,
        orgCfg.secretsEncrypted,
      ),
    };
  }

  if (!projectCfg.toolCatalogId) {
    return {
      status: "missing",
      categoryKey,
      integrationType,
      source: "project_override",
      config: {},
      errorCode: "TOOL_NOT_CONFIGURED",
      message: `No ${categoryKey} provider selected for this project.`,
    };
  }

  const [catalog] = await db
    .select()
    .from(integrationToolCatalog)
    .where(eq(integrationToolCatalog.id, projectCfg.toolCatalogId))
    .limit(1);

  return {
    status: "configured",
    categoryKey,
    integrationType,
    source: "project_override",
    providerKey: catalog?.providerKey || undefined,
    toolCatalogId: projectCfg.toolCatalogId,
    displayName: catalog?.displayName || undefined,
    config: decryptConfig(
      (projectCfg.config as Record<string, string>) || {},
      projectCfg.secretsEncrypted,
    ),
  };
}

export async function resolveProjectRepoIntegration(projectId: string) {
  const resolved = await resolveProjectIntegrationCategory(projectId, "repo");
  if (resolved.status !== "configured") return resolved;

  const provider = (resolved.providerKey || "").toLowerCase();
  if (
    !provider ||
    provider === "github" ||
    provider === "azure_repos" ||
    provider === "gitlab" ||
    provider === "bitbucket"
  ) {
    return resolved;
  }

  return {
    ...resolved,
    status: "unsupported" as const,
    errorCode: "UNSUPPORTED_PROVIDER" as const,
    message: `Repo provider "${resolved.providerKey}" is configured but not supported for SDLC repo operations yet.`,
  };
}
