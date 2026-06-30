import { db } from "../../db";
import * as schema from "@shared/schema";
import { eq, inArray } from "drizzle-orm";
import { sdlcService } from "../../sdlc/service";
import { getJiraServiceForUser } from "./user-credential-resolver";
import { resolveEffectiveUserAccess } from "../../auth/effective-user-access";

type JiraConnectionRow = typeof schema.jiraConnections.$inferSelect;

export type ListedJiraProject = {
  id: string;
  jiraConnectionId: string;
  sdlcProject?: { id: string; ownerUserId?: string | null } | null;
};

function normalizeUrl(value: string) {
  return value.replace(/^https?:\/\//, "").replace(/\/+$/, "").toLowerCase();
}

/**
 * List Jira projects for a connection using the same rules as GET /api/ado-projects
 * when ?org=<jiraConnectionId> — live Jira API intersected with SDLC rows, with
 * DB fallback when the live API is unavailable.
 */
export async function listJiraProjectsForConnection(
  userId: string | undefined,
  connection: JiraConnectionRow,
  allJiraConnections: JiraConnectionRow[],
): Promise<ListedJiraProject[]> {
  const normalizedInstanceUrl = normalizeUrl(connection.instanceUrl);
  const allowLegacyUrlFallback =
    allJiraConnections.filter(
      (candidate) => normalizeUrl(candidate.instanceUrl) === normalizedInstanceUrl,
    ).length <= 1;

  if (userId) {
    try {
      const jiraService = await getJiraServiceForUser(
        userId,
        undefined,
        connection.instanceUrl,
      );
      const liveProjects = await jiraService.getProjects();
      const visibleJiraSdlcRows = (await sdlcService.getAllProjects(userId)).filter(
        (row) => row.integrationType === "jira" && !row.deletedFromAdo,
      );

      const sdlcByKey = new Map<string, (typeof visibleJiraSdlcRows)[0]>();
      for (const row of visibleJiraSdlcRows) {
        const rowUrl = normalizeUrl(row.jiraInstanceUrl || row.organization || "");
        const belongsToConnection =
          row.jiraConnectionId === connection.id ||
          (allowLegacyUrlFallback &&
            !row.jiraConnectionId &&
            rowUrl === normalizedInstanceUrl);
        if (!belongsToConnection) continue;
        if (row.jiraProjectKey) sdlcByKey.set(row.jiraProjectKey.toUpperCase(), row);
        if (row.projectId) sdlcByKey.set(row.projectId.toUpperCase(), row);
        sdlcByKey.set(row.id, row);
      }

      const seenProjectKeys = new Set<string>();
      return liveProjects
        .filter((project) => {
          if (!project.key) return false;
          const scopedKey = `${normalizedInstanceUrl}-${project.key.toUpperCase()}`;
          if (seenProjectKeys.has(scopedKey)) return false;
          return (
            !!sdlcByKey.get(project.key.toUpperCase()) ||
            !!(project.id && sdlcByKey.get(String(project.id).toUpperCase()))
          );
        })
        .map((project) => {
          const key = project.key!;
          seenProjectKeys.add(`${normalizedInstanceUrl}-${key.toUpperCase()}`);
          const sdlcProject =
            sdlcByKey.get(key.toUpperCase()) ||
            (project.id ? sdlcByKey.get(String(project.id).toUpperCase()) : undefined) ||
            null;

          return {
            id: key,
            jiraConnectionId: connection.id,
            sdlcProject,
          };
        });
    } catch {
      // Fall through to DB-only listing below.
    }
  }

  const jiraProjects = userId
    ? (await sdlcService.getAllProjects(userId)).filter((project) => {
        if (project.integrationType !== "jira" || project.deletedFromAdo) return false;
        if (project.jiraConnectionId) return project.jiraConnectionId === connection.id;
        if (!allowLegacyUrlFallback) return false;
        const projectUrl = normalizeUrl(project.jiraInstanceUrl || project.organization || "");
        return projectUrl === normalizedInstanceUrl;
      })
    : [];

  return jiraProjects.map((project) => ({
    id: project.id,
    jiraConnectionId: connection.id,
    sdlcProject: project,
  }));
}

export async function applyUserProjectListingAccessFilter<T extends ListedJiraProject>(
  userId: string | undefined,
  projects: T[],
): Promise<T[]> {
  if (!userId) return projects;

  const access = await resolveEffectiveUserAccess(userId);
  const effectiveUserIds = access?.userIds ?? [userId];
  const effectiveUserIdSet = new Set(effectiveUserIds);

  const { organizationMembers, organizations, projectMembers } = await import("@shared/schema");
  const memberOrgRows = await db
    .select({ organizationId: organizationMembers.organizationId })
    .from(organizationMembers)
    .where(inArray(organizationMembers.userId, effectiveUserIds));
  const memberOrgIds = new Set(memberOrgRows.map((r) => r.organizationId));

  const ownedOrgs = await db
    .select({ id: organizations.id })
    .from(organizations)
    .where(inArray(organizations.ownerUserId, effectiveUserIds));
  ownedOrgs.forEach((o) => memberOrgIds.add(o.id));

  const projectMemberRows = await db
    .select({ projectId: projectMembers.projectId })
    .from(projectMembers)
    .where(inArray(projectMembers.userId, effectiveUserIds));
  const explicitProjectIds = new Set(projectMemberRows.map((r) => r.projectId));

  return projects.filter((project) => {
    const orgId = project.jiraConnectionId;
    const hasOrgAccess = orgId && memberOrgIds.has(orgId);
    const projectId = project.sdlcProject?.id;
    const hasProjectAccess = projectId && explicitProjectIds.has(projectId);
    const isProjectOwner =
      project.sdlcProject?.ownerUserId &&
      effectiveUserIdSet.has(project.sdlcProject.ownerUserId);
    const hasDirectProjectAccess = explicitProjectIds.has(project.id);
    return hasOrgAccess || hasProjectAccess || isProjectOwner || hasDirectProjectAccess;
  });
}

export async function countListedJiraProjectsForConnection(
  userId: string | undefined,
  connectionId: string,
): Promise<number> {
  const [connection] = await db
    .select()
    .from(schema.jiraConnections)
    .where(eq(schema.jiraConnections.id, connectionId))
    .limit(1);

  if (!connection) return 0;

  const allJiraConnections = await db.select().from(schema.jiraConnections);
  const listed = await listJiraProjectsForConnection(userId, connection, allJiraConnections);
  const visible = await applyUserProjectListingAccessFilter(userId, listed);
  return visible.length;
}
