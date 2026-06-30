import { Request } from "express";
import { db } from "../db";
import { eq, and, sql, or } from "drizzle-orm";
import { 
  artifactOrganizations, 
  jiraConnections, 
  sdlcProjects 
} from "@shared/schema";
import { AzureDevOpsService } from "../azure-devops-service";
import { decryptPAT } from "../crypto-utils";

/** Safely convert DB date to ISO string; returns "" for invalid/zero dates (e.g. MySQL 0000-00-00). */
export function safeToISOString(val: Date | string | null | undefined): string {
  if (val == null) return "";
  if (typeof val === "object" && typeof (val as Date).toISOString === "function") {
    const t = (val as Date).getTime();
    return isNaN(t) ? "" : (val as Date).toISOString();
  }
  if (typeof val === "string") {
    const normalized = val.trim().replace(" ", "T");
    const d = new Date(normalized);
    return isNaN(d.getTime()) ? "" : d.toISOString();
  }
  if (typeof val === "number") {
    const d = new Date(val);
    return isNaN(d.getTime()) ? "" : d.toISOString();
  }
  const d = new Date(val as any);
  return isNaN(d.getTime()) ? "" : d.toISOString();
}

/** Get subscription date from row; driver may return camelCase or snake_case. */
export function getSubDate(sub: any, key: "startDate" | "expiryDate"): string {
  const camel = key === "startDate" ? "startDate" : "expiryDate";
  const snake = key === "startDate" ? "start_date" : "expiry_date";
  const val = sub?.[camel] ?? sub?.[snake];
  return safeToISOString(val);
}

export function normalizeOrganizationName(value: string | null | undefined) {
  return (value ?? "").trim().toLowerCase();
}

export function extractOrganizationNameFromUrl(value: string | null | undefined) {
  const rawValue = (value ?? "").trim();
  if (!rawValue) {
    return "";
  }

  if (rawValue.includes("dev.azure.com")) {
    const match = rawValue.match(/https?:\/\/dev\.azure\.com\/([^\/\?]+)/i);
    return normalizeOrganizationName(match?.[1] ?? rawValue);
  }

  if (rawValue.includes("visualstudio.com")) {
    const match = rawValue.match(/https?:\/\/([^\.]+)\.visualstudio\.com/i);
    return normalizeOrganizationName(match?.[1] ?? rawValue);
  }

  return normalizeOrganizationName(rawValue.replace(/\/+$/, ""));
}

export async function getSelectedGlobalOrganizationFromRequest(req: Request) {
  const selectedOrganizationId = (req.headers["x-organization-id"] as string | undefined)?.trim();
  if (!selectedOrganizationId || selectedOrganizationId === "__all__") {
    return null;
  }

  const [adoOrganization] = await db
    .select({
      id: artifactOrganizations.id,
      organizationUrl: artifactOrganizations.organizationUrl,
      projectName: artifactOrganizations.projectName,
      patToken: artifactOrganizations.patToken,
    })
    .from(artifactOrganizations)
    .where(eq(artifactOrganizations.id, selectedOrganizationId))
    .limit(1);

  if (adoOrganization) {
    return {
      id: adoOrganization.id,
      name:
        extractOrganizationNameFromUrl(adoOrganization.organizationUrl) ||
        normalizeOrganizationName(adoOrganization.projectName) ||
        "azure-devops",
      sourceType: "ado" as const,
      description: adoOrganization.projectName || adoOrganization.organizationUrl,
      status: adoOrganization.patToken ? "active" : "inactive",
    };
  }

  const [jiraOrganization] = await db
    .select({
      id: jiraConnections.id,
      name: jiraConnections.name,
      instanceUrl: jiraConnections.instanceUrl,
      isActive: jiraConnections.isActive,
    })
    .from(jiraConnections)
    .where(eq(jiraConnections.id, selectedOrganizationId))
    .limit(1);

  if (jiraOrganization) {
    return {
      id: jiraOrganization.id,
      name: normalizeOrganizationName(jiraOrganization.name) || jiraOrganization.name,
      sourceType: "jira" as const,
      description: jiraOrganization.instanceUrl,
      instanceUrl: jiraOrganization.instanceUrl,
      status: jiraOrganization.isActive ? "active" : "inactive",
    };
  }

  return null;
}

export async function getLiveProjectCountForSelectedOrganization(
  selectedOrganization: Awaited<ReturnType<typeof getSelectedGlobalOrganizationFromRequest>>,
  userId?: string
): Promise<number | null> {
  if (!selectedOrganization) {
    return null;
  }

  if (selectedOrganization.sourceType === "jira") {
    const [connection] = await db
      .select({
        id: jiraConnections.id,
        instanceUrl: jiraConnections.instanceUrl,
      })
      .from(jiraConnections)
      .where(eq(jiraConnections.id, selectedOrganization.id))
      .limit(1);

    if (!connection) {
      return 0;
    }

    const normalisedNoSlash = connection.instanceUrl.replace(/\/+$/, "");
    const withSlash = normalisedNoSlash + "/";
    const jiraProjects = await db
      .select({ id: sdlcProjects.id })
      .from(sdlcProjects)
      .where(
        and(
          eq(sdlcProjects.integrationType, "jira"),
          eq(sdlcProjects.deletedFromAdo, false),
          or(
            eq(sdlcProjects.jiraConnectionId, selectedOrganization.id),
            and(
              sql`${sdlcProjects.jiraConnectionId} IS NULL`,
              or(
                eq(sdlcProjects.jiraInstanceUrl, connection.instanceUrl),
                eq(sdlcProjects.jiraInstanceUrl, normalisedNoSlash),
                eq(sdlcProjects.jiraInstanceUrl, withSlash),
              ),
            ),
          ),
        ),
      );

    return jiraProjects.length;
  }

  const [artifactOrg] = await db
    .select({
      id: artifactOrganizations.id,
      organizationUrl: artifactOrganizations.organizationUrl,
      projectName: artifactOrganizations.projectName,
      patToken: artifactOrganizations.patToken,
    })
    .from(artifactOrganizations)
    .where(eq(artifactOrganizations.id, selectedOrganization.id))
    .limit(1);

  if (!artifactOrg?.organizationUrl || !artifactOrg?.patToken) {
    return 0;
  }

  const decryptedPAT = decryptPAT(artifactOrg.patToken);
  if (!decryptedPAT) {
    return 0;
  }

  const organization = artifactOrg.organizationUrl
    .replace(/https?:\/\/dev\.azure\.com\//, "")
    .replace(/\/$/, "");

  const adoService = new AzureDevOpsService({
    organization,
    project: artifactOrg.projectName,
    pat: decryptedPAT,
  });

  const liveProjects = await adoService.getProjects();
  return liveProjects.length;
}
