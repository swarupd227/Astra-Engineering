import { Express, Request, Response } from "express";
import { db } from "./db";
import { integrationSettings, jiraSettings, jiraConnections, sdlcProjects, users, organizations, organizationMembers, projectMembers, userRoles, roles } from "@shared/schema";
import { eq, and, ne, or, inArray, asc, sql } from "drizzle-orm";
import { requireAuth, requireRole } from "./auth/middleware";
import { IntegrationFactory } from "./integrations/base/integration-factory";
import { JiraService } from "./integrations/jira/jira-service";
import { 
  handlePushToJira, 
  handlePushToConfluence, 
  handleGetJiraBacklogContext,
  handleGetJiraEpics,
  handleGetJiraEpicUserStories,
  handleGetJiraUserStories,
  handleGetJiraRequirements,
  handleGetJiraDevelopmentWorkItems,
  handleGetJiraStoryProgress,
  handleGetJiraDeveloperAssignments,
  handleGetJiraVelocity,
  handleGetJiraBuildPipelines,
  handleGetJiraBuildMetrics,
  handlePushTestCasesToJira,
  handleGetJiraConnectionProjectCount,
  getJiraServiceForWrite,
  isUserJiraCredentialError,
  userJiraCredentialHttpStatus,
  userJiraCredentialMessage,
} from "./integrations/jira/jira-routes-handler";
import { sdlcService } from "./sdlc/service";
import crypto from "crypto";
import { ensureProjectOwnerMembershipsForAliases } from "./auth/effective-user-access";

function getEncryptionKey(): string {
  const encryptionKey = process.env.PAT_ENCRYPTION_KEY;
  if (!encryptionKey) {
    throw new Error("PAT_ENCRYPTION_KEY environment variable is required for Jira integration");
  }
  return encryptionKey.padEnd(32).slice(0, 32);
}

function respondWithJiraCredentialError(res: Response, error: unknown): boolean {
  if (!isUserJiraCredentialError(error)) return false;
  res.status(userJiraCredentialHttpStatus(error)).json({
    error: userJiraCredentialMessage(error),
    details: error instanceof Error ? error.message : String(error),
  });
  return true;
}

async function resolveVisibleJiraSdlcProjectId(req: Request, requestedProjectId: string): Promise<string> {
  const userId = (req as any).user?.id;
  if (!userId) return requestedProjectId;

  const normalized = requestedProjectId.trim().toUpperCase();
  const visibleProjects = await sdlcService.getAllProjects(userId);
  const match = visibleProjects.find((project: any) => {
    if (project.integrationType !== "jira") return false;
    return [
      project.id,
      project.projectId,
      project.jiraProjectKey,
    ]
      .filter(Boolean)
      .some((value) => String(value).trim().toUpperCase() === normalized);
  });

  return match?.id || requestedProjectId;
}

export function encrypt(text: string): string {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv("aes-256-cbc", Buffer.from(key), iv);
  let encrypted = cipher.update(text, "utf8", "hex");
  encrypted += cipher.final("hex");
  return iv.toString("hex") + ":" + encrypted;
}

export function decrypt(text: string): string {
  const key = getEncryptionKey();
  const parts = text.split(":");
  const iv = Buffer.from(parts[0], "hex");
  const encryptedText = parts[1];
  const decipher = crypto.createDecipheriv("aes-256-cbc", Buffer.from(key), iv);
  let decrypted = decipher.update(encryptedText, "hex", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
}

export const encryptJiraToken = encrypt;
export const decryptJiraToken = decrypt;

async function ensureJiraConnectionVisibility(
  tx: any,
  params: {
    connectionId: string;
    connectionName: string;
    tenantId: string;
    userId: string;
  }
) {
  const [existingOrg] = await tx
    .select({ id: organizations.id, tenantId: organizations.tenantId })
    .from(organizations)
    .where(eq(organizations.id, params.connectionId))
    .limit(1);

  if (existingOrg) {
    if (existingOrg.tenantId !== params.tenantId) {
      throw new Error("Jira connection already belongs to a different tenant");
    }
    await tx
      .update(organizations)
      .set({
        name: params.connectionName,
        tenantId: params.tenantId,
        ownerUserId: params.userId,
      })
      .where(eq(organizations.id, params.connectionId));
  } else {
    await tx.insert(organizations).values({
      id: params.connectionId,
      name: params.connectionName,
      tenantId: params.tenantId,
      ownerUserId: params.userId,
    });
  }

  const [existingMember] = await tx
    .select({ id: organizationMembers.id })
    .from(organizationMembers)
    .where(
      and(
        eq(organizationMembers.organizationId, params.connectionId),
        eq(organizationMembers.userId, params.userId)
      )
    )
    .limit(1);

  if (!existingMember) {
    await tx.insert(organizationMembers).values({
      id: crypto.randomUUID(),
      organizationId: params.connectionId,
      userId: params.userId,
      tenantId: params.tenantId,
      role: "owner",
    });
  }
}

function getValidJiraProjectsFromBody(selectedProject: any, selectedProjects: any): any[] {
  return (Array.isArray(selectedProjects) && selectedProjects.length > 0
    ? selectedProjects
    : selectedProject
      ? [selectedProject]
      : [])
    .filter((project: any) =>
      String(project?.id || "").trim() &&
      String(project?.key || "").trim() &&
      String(project?.name || "").trim(),
    );
}

async function registerJiraProjectsForConnection(params: {
  connectionId: string;
  instanceUrl: string;
  ownerUserId: string;
  tenantId: string;
  projects: any[];
}) {
  const { storage } = await import("./storage");
  const registeredProjects = [];

  for (const project of params.projects) {
    const registeredProject = await sdlcService.registerProviderProject({
      integrationType: "jira",
      projectId: String(project.id).trim(),
      projectKey: String(project.key).trim().toUpperCase(),
      name: String(project.name).trim(),
      description: project.description ? String(project.description) : null,
      instanceUrl: params.instanceUrl,
      connectionId: params.connectionId,
      ownerUserId: params.ownerUserId,
    });

    await storage.addProjectMember({
      projectId: registeredProject.id,
      userId: params.ownerUserId,
      tenantId: params.tenantId,
      role: registeredProject.ownerUserId === params.ownerUserId ? "owner" : "member",
    });

    registeredProjects.push({
      id: registeredProject.id,
      name: registeredProject.name,
      projectId: registeredProject.projectId,
      jiraProjectKey: registeredProject.jiraProjectKey,
    });
  }

  return registeredProjects;
}

async function resolveOrCreateJiraInvitee(email: string, inviterUserId: string) {
  const [inviter] = await db
    .select({ tenantId: users.tenantId, provider: users.provider })
    .from(users)
    .where(eq(users.id, inviterUserId))
    .limit(1);
  const tenantId = inviter?.tenantId ?? "";
  const provider = inviter?.provider ?? "microsoft";

  const [existing] = await db
    .select()
    .from(users)
    .where(eq(users.email, email))
    .limit(1);
  if (existing) return { userId: existing.id, tenantId: existing.tenantId ?? tenantId };

  const newUserId = crypto.randomUUID();
  await db.insert(users).values({
    id: newUserId,
    email,
    tenantId,
    provider,
    azureOid: email,
    providerUserId: email,
    createdAt: new Date(),
  });
  return { userId: newUserId, tenantId };
}

async function getCurrentUserTenantId(userId: string): Promise<string | null> {
  const [userRecord] = await db
    .select({ tenantId: users.tenantId })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return userRecord?.tenantId ?? null;
}

async function canUseJiraConnection(userId: string, connectionId: string): Promise<boolean> {
  const [ownedOrg] = await db
    .select({ id: organizations.id })
    .from(organizations)
    .where(and(eq(organizations.id, connectionId), eq(organizations.ownerUserId, userId)))
    .limit(1);
  if (ownedOrg) return true;

  const [memberOrg] = await db
    .select({ id: organizationMembers.id })
    .from(organizationMembers)
    .where(and(eq(organizationMembers.organizationId, connectionId), eq(organizationMembers.userId, userId)))
    .limit(1);
  if (memberOrg) return true;

  const [memberProject] = await db
    .select({ id: projectMembers.id })
    .from(projectMembers)
    .innerJoin(sdlcProjects, eq(projectMembers.projectId, sdlcProjects.id))
    .where(
      and(
        eq(projectMembers.userId, userId),
        eq(sdlcProjects.jiraConnectionId, connectionId),
        eq(sdlcProjects.integrationType, "jira"),
        eq(sdlcProjects.deletedFromAdo, false),
      ),
    )
    .limit(1);
  return Boolean(memberProject);
}

export function registerJiraRoutes(app: Express) {
  // GET /api/integrations/settings/:projectId - Get integration settings for a project
  app.get("/api/integrations/settings/:projectId", async (req: Request, res: Response) => {
    try {
      const { projectId } = req.params;

      const settings = await db
        .select()
        .from(integrationSettings)
        .where(eq(integrationSettings.projectId, projectId))
        .limit(1);

      if (settings.length === 0) {
        return res.json({
          projectId,
          integrationType: "ado",
          isActive: true,
        });
      }

      return res.json(settings[0]);
    } catch (error) {
      console.error("[GET /api/integrations/settings] Error:", error);
      return res.status(500).json({ error: "Failed to get integration settings" });
    }
  });

  // GET /api/jira/projects/:projectId/issue-types - Get Jira issue types for a project
  app.get("/api/jira/projects/:projectId/issue-types", requireAuth, async (req: Request, res: Response) => {
    try {
      const { projectId } = req.params;

      const { getJiraConfig, getJiraServiceForWrite } = await import("./integrations/jira/jira-routes-handler");
      
      const resolvedProjectId = await resolveVisibleJiraSdlcProjectId(req, projectId);
      const config = await getJiraConfig(resolvedProjectId);
      if (!config || !config.projectKey) {
        return res.status(400).json({ error: "Jira project not configured properly" });
      }

      const jiraService = await getJiraServiceForWrite(req, config.projectKey, config.instanceUrl);

      // Fetch issue types
      const issueTypes = await jiraService.getIssueTypesForProject(config.projectKey);
      
      return res.json({
        success: true,
        issueTypes: issueTypes.map((type: any) => ({
          id: type.id,
          name: type.name,
          hierarchyLevel: type.hierarchyLevel,
          subtask: type.subtask
        }))
      });
    } catch (error: any) {
      console.error("[GET /api/jira/projects/:projectId/issue-types] Error:", error);
      if (isUserJiraCredentialError(error)) {
        return res.status(userJiraCredentialHttpStatus(error)).json({
          error: userJiraCredentialMessage(error),
          details: error?.message || "Unknown error",
        });
      }
      return res.status(500).json({
        error: "Failed to fetch issue types", 
        details: error?.message || "Unknown error"
      });
    }
  });

  // POST /api/jira/projects/batch-issue-types - Get Jira issue types for multiple projects
  app.post("/api/jira/projects/batch-issue-types", requireAuth, async (req: Request, res: Response) => {
    try {
      const { projectIds } = req.body;
      if (!Array.isArray(projectIds) || projectIds.length === 0) {
        return res.json({ success: true, results: {} });
      }

      const { getJiraConfig, getJiraServiceForWrite } = await import("./integrations/jira/jira-routes-handler");
      
      const results: Record<string, any[]> = {};
      
      // Process sequentially to avoid rate limiting
      for (const projectId of projectIds) {
        try {
          const config = await getJiraConfig(projectId);
          if (!config || !config.projectKey) {
            results[projectId] = [];
            continue;
          }

          const jiraService = await getJiraServiceForWrite(req, config.projectKey, config.instanceUrl);
          const issueTypes = await jiraService.getIssueTypesForProject(config.projectKey);
          
          results[projectId] = issueTypes.map((type: any) => ({
            id: type.id,
            name: type.name,
            hierarchyLevel: type.hierarchyLevel,
            subtask: type.subtask
          }));
        } catch (error) {
          console.error(`[POST /api/jira/projects/batch-issue-types] Error for project ${projectId}:`, error);
          results[projectId] = []; // Return empty array on error for this project
        }
      }

      return res.json({ success: true, results });
    } catch (error: any) {
      console.error("[POST /api/jira/projects/batch-issue-types] Error:", error);
      return res.status(500).json({ error: "Failed to fetch batch issue types", details: error?.message || "Unknown error" });
    }
  });

  // GET /api/jira/projects/:projectId/permissions - Check if user has specific permissions
  app.get("/api/jira/projects/:projectId/permissions", requireAuth, async (req: Request, res: Response) => {
    try {
      const { projectId } = req.params;
      const permission = (req.query.permission as string) || "CREATE_ISSUES";

      // Re-use logic from handlePushToJira / issue-types to get user token
      const { getJiraConfig, getJiraServiceForWrite } = await import("./integrations/jira/jira-routes-handler");
      
      const resolvedProjectId = await resolveVisibleJiraSdlcProjectId(req, projectId);
      const config = await getJiraConfig(resolvedProjectId);
      if (!config || !config.projectKey) {
        return res.status(400).json({ error: "Jira project not configured properly" });
      }

      const jiraService = await getJiraServiceForWrite(req, config.projectKey, config.instanceUrl);

      const hasPermission = await jiraService.hasProjectPermission(config.projectKey, permission);
      
      return res.json({
        success: true,
        projectKey: config.projectKey,
        permission,
        hasPermission: hasPermission === true,
        unknown: hasPermission === null // If the probe failed for some network reason
      });
    } catch (error: any) {
      console.error("[GET /api/jira/projects/:projectId/permissions] Error:", error);
      if (isUserJiraCredentialError(error)) {
        return res.status(userJiraCredentialHttpStatus(error)).json({
          error: userJiraCredentialMessage(error),
          details: error?.message || "Unknown error",
        });
      }
      return res.status(500).json({
        error: "Failed to check project permissions",
        details: error?.message || "Unknown error"
      });
    }
  });

  // POST /api/jira/projects/:projectId/auto-add - Auto add user to project
  app.post("/api/jira/projects/:projectId/auto-add", requireAuth, async (req: Request, res: Response) => {
    try {
      const { projectId } = req.params;
      
      const { getJiraConfig } = await import("./integrations/jira/jira-routes-handler");
      const resolvedProjectId = await resolveVisibleJiraSdlcProjectId(req, projectId);
      const config = await getJiraConfig(resolvedProjectId);
      if (!config || !config.projectKey) {
        return res.status(400).json({ error: "Jira project not configured properly" });
      }
      
      // Need an admin connection to add a user to a project role
      const adminConn = await db.select().from(jiraConnections).where(eq(jiraConnections.isAdminConnection, 1)).limit(1);
      if (adminConn.length === 0) {
        return res.status(400).json({ error: "No admin connection configured. Cannot auto-add user." });
      }
      
      const adminApiToken = decrypt(adminConn[0].apiTokenEncrypted);
      const adminJiraService = new JiraService({
        instanceUrl: adminConn[0].instanceUrl,
        projectKey: config.projectKey,
        email: adminConn[0].email,
        apiToken: adminApiToken,
      });
      
      // We need the user's account ID. 
      // If we don't have it explicitly, we can try to find it by their email.
      const authUser = (req as any).user;
      if (!authUser || !authUser.email) {
        return res.status(400).json({ error: "User email not found. Cannot determine Jira account ID." });
      }
      
      const jiraUser = await adminJiraService.findUserByEmail(authUser.email);
      if (!jiraUser) {
        return res.status(400).json({ error: `Jira user with email ${authUser.email} not found. Ensure you have an active Jira account.` });
      }
      
      const added = await adminJiraService.addProjectActor(config.projectKey, jiraUser.accountId);
      
      if (added) {
        return res.json({ success: true, message: "Successfully added user to project" });
      } else {
        return res.status(400).json({ error: "Failed to add user to project role." });
      }
    } catch (error: any) {
      console.error("[POST /api/jira/projects/:projectId/auto-add] Error:", error);
      return res.status(500).json({
        error: "Failed to auto-add user to Jira project",
        details: error?.message || "Unknown error"
      });
    }
  });

  // PUT /api/integrations/settings/:projectId - Update integration type for a project
  app.put("/api/integrations/settings/:projectId", async (req: Request, res: Response) => {
    try {
      const { projectId } = req.params;
      const { integrationType } = req.body;

      if (!integrationType || !["ado", "jira"].includes(integrationType)) {
        return res.status(400).json({ error: "Invalid integration type. Must be 'ado' or 'jira'" });
      }

      const existing = await db
        .select()
        .from(integrationSettings)
        .where(eq(integrationSettings.projectId, projectId))
        .limit(1);

      if (existing.length > 0) {
        await db
          .update(integrationSettings)
          .set({ integrationType, updatedAt: new Date() })
          .where(eq(integrationSettings.projectId, projectId));
      } else {
        await db.insert(integrationSettings).values({
          id: crypto.randomUUID(),
          projectId,
          integrationType,
        });
      }

      return res.json({
        success: true,
        projectId,
        integrationType,
      });
    } catch (error) {
      console.error("[PUT /api/integrations/settings] Error:", error);
      return res.status(500).json({ error: "Failed to update integration settings" });
    }
  });

  // GET /api/jira/settings/:projectId - Get Jira settings for a project
  app.get("/api/jira/settings/:projectId", async (req: Request, res: Response) => {
    try {
      const { projectId } = req.params;

      const settings = await db
        .select()
        .from(jiraSettings)
        .where(eq(jiraSettings.projectId, projectId))
        .limit(1);

      if (settings.length === 0) {
        return res.json({ exists: false });
      }

      const { apiTokenEncrypted, ...safeSettings } = settings[0];
      return res.json({
        exists: true,
        ...safeSettings,
        hasApiToken: !!apiTokenEncrypted,
      });
    } catch (error) {
      console.error("[GET /api/jira/settings] Error:", error);
      return res.status(500).json({ error: "Failed to get Jira settings" });
    }
  });

  // POST /api/jira/settings - Create or update project-level Jira settings (can optionally use a connection)
  app.post("/api/jira/settings", async (req: Request, res: Response) => {
    try {
      const {
        projectId,
        connectionId,
        instanceUrl,
        projectKey,
        email,
        apiToken,
        storyPointsFieldId,
        epicLinkFieldId,
        sprintFieldId,
        acceptanceCriteriaFieldId,
        confluenceSpaceKey,
      } = req.body;

      if (!projectId) {
        return res.status(400).json({ error: "Missing required field: projectId" });
      }

      let effectiveInstanceUrl = instanceUrl;
      let effectiveEmail = email;
      let effectiveApiToken = apiToken;

      if (connectionId) {
        const connection = await db
          .select()
          .from(jiraConnections)
          .where(eq(jiraConnections.id, connectionId))
          .limit(1);

        if (connection.length > 0) {
          effectiveInstanceUrl = effectiveInstanceUrl || connection[0].instanceUrl;
          effectiveEmail = effectiveEmail || connection[0].email;
          if (!effectiveApiToken) {
            effectiveApiToken = decrypt(connection[0].apiTokenEncrypted);
          }
        }
      }

      if (!effectiveInstanceUrl || !projectKey || !effectiveEmail) {
        return res.status(400).json({
          error: "Missing required fields: instanceUrl, projectKey, email (or provide connectionId)",
        });
      }

      const existing = await db
        .select()
        .from(jiraSettings)
        .where(eq(jiraSettings.projectId, projectId))
        .limit(1);

      const updateData: any = {
        instanceUrl: effectiveInstanceUrl,
        projectKey,
        email: effectiveEmail,
        connectionId: connectionId || null,
        storyPointsFieldId: storyPointsFieldId || null,
        epicLinkFieldId: epicLinkFieldId || null,
        sprintFieldId: sprintFieldId || null,
        acceptanceCriteriaFieldId: acceptanceCriteriaFieldId || null,
        confluenceSpaceKey: confluenceSpaceKey || null,
        updatedAt: new Date(),
      };

      if (effectiveApiToken) {
        updateData.apiTokenEncrypted = encrypt(effectiveApiToken);
      }

      if (existing.length > 0) {
        await db
          .update(jiraSettings)
          .set(updateData)
          .where(eq(jiraSettings.projectId, projectId));
      } else {
        if (!effectiveApiToken) {
          return res.status(400).json({ error: "API token is required for new settings" });
        }

        await db.insert(jiraSettings).values({
          id: crypto.randomUUID(),
          projectId,
          connectionId: connectionId || null,
          instanceUrl: effectiveInstanceUrl,
          projectKey,
          email: effectiveEmail,
          apiTokenEncrypted: encrypt(effectiveApiToken),
          storyPointsFieldId: storyPointsFieldId || null,
          epicLinkFieldId: epicLinkFieldId || null,
          sprintFieldId: sprintFieldId || null,
          acceptanceCriteriaFieldId: acceptanceCriteriaFieldId || null,
          confluenceSpaceKey: confluenceSpaceKey || null,
          isActive: 1,
        });
      }

      // Auto-save as per-user credential when settings include token
      const userId = (req as any).user?.id;
      if (userId && effectiveInstanceUrl && effectiveEmail && effectiveApiToken) {
        try {
          const { saveUserJiraCredential, testUserJiraCredential } = await import("./integrations/jira/user-credential-resolver");
          await saveUserJiraCredential(userId, {
            instanceUrl: effectiveInstanceUrl,
            email: effectiveEmail,
            apiToken: effectiveApiToken,
          });
          await testUserJiraCredential(userId).catch(() => {});
          console.log(`[JiraRoutes] Auto-saved per-user Jira credential from settings for user=${userId}`);
        } catch (credErr) {
          console.warn(`[JiraRoutes] Failed to auto-save per-user credential from settings:`, credErr instanceof Error ? credErr.message : credErr);
        }
      }

      // Auto-sync this project's JIRA team members → jira_team_members
      // (fire-and-forget; never blocks the settings save).
      if (effectiveInstanceUrl && projectKey) {
        import("./integrations/jira/team-sync-service")
          .then((m) => m.syncJiraTeam({ instanceUrl: effectiveInstanceUrl, project: projectKey }))
          .then((r) => console.log(`[JiraRoutes] auto team-sync ${projectKey}: members=${r.members} matched=${r.matched}`))
          .catch((e) => console.warn("[JiraRoutes] auto team-sync failed:", e?.message || e));
      }

      return res.json({
        success: true,
        message: existing.length > 0 ? "Jira settings updated" : "Jira settings created",
        projectId,
      });
    } catch (error) {
      console.error("[POST /api/jira/settings] Error:", error);
      return res.status(500).json({ error: "Failed to save Jira settings" });
    }
  });

  // POST /api/jira/connections - Create a new org-level Jira connection
  app.post("/api/jira/connections", requireAuth, async (req: Request, res: Response) => {
    try {
      const {
        name,
        instanceUrl,
        email,
        apiToken,
        selectedProject,
        selectedProjects,
      } = req.body;

      if (!instanceUrl || !email || !apiToken) {
        return res.status(400).json({
          error: "Missing required fields: instanceUrl, email, apiToken",
        });
      }
      const projectsToRegister = getValidJiraProjectsFromBody(selectedProject, selectedProjects);

      const userId = (req as any).user?.id;
      if (!userId) {
        return res.status(401).json({ error: "Not signed in" });
      }

      const [userRecord] = await db
        .select({ tenantId: users.tenantId })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);

      if (!userRecord?.tenantId) {
        return res.status(400).json({
          error: "Missing tenant context",
          message: "Current user does not have a tenant_id, so the Jira connection cannot be made visible.",
        });
      }

      const normalizedUrl = instanceUrl.replace(/\/+$/, '');
      let connectionName = (name || '').trim();
      if (!connectionName) {
        try {
          const hostname = new URL(normalizedUrl).hostname;
          // Prefer the subdomain ("devxnous") over the full hostname
          // ("devxnous.atlassian.net") so the global org selector reads as a
          // recognisable workspace name instead of a domain. For non-Atlassian
          // hosts where the subdomain is uninformative (e.g. "www") fall back
          // to the full hostname.
          const parts = hostname.split('.');
          const subdomain = parts[0] || '';
          const looksGeneric = !subdomain || /^(www|jira|atlassian)$/i.test(subdomain);
          connectionName = looksGeneric ? hostname : subdomain;
        } catch {
          // URL parse failed (e.g. user pasted something that wasn't a valid
          // URL). Strip the protocol so we don't store the full string as the
          // visible name.
          connectionName = normalizedUrl.replace(/^https?:\/\//i, '') || normalizedUrl;
        }
      }

      const newId = crypto.randomUUID();
      const existingConnectionRows = await db
        .select({
          connection: jiraConnections,
          tenantId: organizations.tenantId,
        })
        .from(jiraConnections)
        .leftJoin(organizations, eq(organizations.id, jiraConnections.id))
        .where(and(eq(jiraConnections.instanceUrl, normalizedUrl), eq(jiraConnections.email, email)))
        .limit(10);
      const matchingConnectionIds = existingConnectionRows.map((row) => row.connection.id);
      const crossTenantProjectRows = matchingConnectionIds.length > 0
        ? await db
            .select({ connectionId: sdlcProjects.jiraConnectionId })
            .from(sdlcProjects)
            .innerJoin(users, eq(users.id, sdlcProjects.ownerUserId))
            .where(
              and(
                inArray(sdlcProjects.jiraConnectionId, matchingConnectionIds),
                ne(users.tenantId, userRecord.tenantId!),
                eq(sdlcProjects.integrationType, "jira"),
                eq(sdlcProjects.deletedFromAdo, false),
              ),
            )
        : [];
      const crossTenantProjectConnectionIds = new Set(
        crossTenantProjectRows.map((row) => row.connectionId).filter(Boolean),
      );
      const existingConnection = existingConnectionRows.find(
        (row) =>
          (!row.tenantId || row.tenantId === userRecord.tenantId) &&
          !crossTenantProjectConnectionIds.has(row.connection.id),
      )?.connection;

      const connectionId = existingConnection?.id || newId;

      await db.transaction(async (tx) => {
        if (existingConnection) {
          await tx
            .update(jiraConnections)
            .set({
              name: connectionName,
              apiTokenEncrypted: encrypt(apiToken),
              isActive: 1,
              updatedAt: new Date(),
            })
            .where(eq(jiraConnections.id, existingConnection.id));
        } else {
          await tx.insert(jiraConnections).values({
            id: connectionId,
            name: connectionName,
            instanceUrl: normalizedUrl,
            email,
            apiTokenEncrypted: encrypt(apiToken),
            isActive: 1,
          });
        }

        await ensureJiraConnectionVisibility(tx, {
          connectionId,
          connectionName,
          tenantId: userRecord.tenantId!,
          userId,
        });
      });

      const registeredProjects = projectsToRegister.length > 0
        ? await registerJiraProjectsForConnection({
            connectionId,
            instanceUrl: normalizedUrl,
            ownerUserId: userId,
            tenantId: userRecord.tenantId!,
            projects: projectsToRegister,
          })
        : [];

      // Auto-save as per-user credential so the same token works for per-user operations
      if (userId) {
        try {
          const { saveUserJiraCredential, testUserJiraCredential } = await import("./integrations/jira/user-credential-resolver");
          await saveUserJiraCredential(userId, { instanceUrl: normalizedUrl, email, apiToken });
          await testUserJiraCredential(userId).catch(() => {});
          console.log(`[JiraRoutes] Auto-saved per-user Jira credential for user=${userId}`);
        } catch (credErr) {
          console.warn(`[JiraRoutes] Failed to auto-save per-user credential:`, credErr instanceof Error ? credErr.message : credErr);
        }
      }

      // Auto-sync members for any projects already configured under this instance
      // (fire-and-forget). New projects sync when their jira_settings are saved.
      if (normalizedUrl) {
        import("./integrations/jira/team-sync-service")
          .then((m) => m.syncAllProjects(normalizedUrl))
          .then((r) => console.log(`[JiraRoutes] auto sync-all for ${normalizedUrl}: projects=${r.projects}`))
          .catch((e) => console.warn("[JiraRoutes] auto sync-all failed:", e?.message || e));
      }

      return res.json({
        success: true,
        message: existingConnection ? "Jira connection updated" : "Jira connection created",
        id: connectionId,
        name: connectionName,
        registeredProjectCount: registeredProjects.length,
        registeredProjects,
        restoredVisibility: !!existingConnection,
      });
    } catch (error) {
      console.error("[POST /api/jira/connections] Error:", error);
      return res.status(500).json({ error: "Failed to create Jira connection" });
    }
  });

  // PUT /api/jira/connections/:id - Update an existing Jira connection
  app.put("/api/jira/connections/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const {
        name,
        instanceUrl,
        email,
        apiToken,
      } = req.body;

      const existing = await db
        .select()
        .from(jiraConnections)
        .where(eq(jiraConnections.id, id))
        .limit(1);

      if (existing.length === 0) {
        return res.status(404).json({ error: "Jira connection not found" });
      }

      const userId = (req as any).user?.id;
      if (!userId) return res.status(401).json({ error: "Not signed in" });
      if (!(await canUseJiraConnection(userId, id))) {
        return res.status(403).json({ error: "You do not have access to this Jira connection" });
      }

      const [ownedOrg] = await db
        .select({ id: organizations.id })
        .from(organizations)
        .where(and(eq(organizations.id, id), eq(organizations.ownerUserId, userId)))
        .limit(1);
      const isOwner = Boolean(ownedOrg);
      const effectiveInstanceUrl = (instanceUrl || existing[0].instanceUrl || "").replace(/\/+$/, "");
      const effectiveEmail = email || existing[0].email;

      const updateData: any = {
        updatedAt: new Date(),
      };

      if (instanceUrl) updateData.instanceUrl = instanceUrl;
      if (email) updateData.email = email;
      if (name) updateData.name = name;
      if (apiToken && isOwner) updateData.apiTokenEncrypted = encrypt(apiToken);

      await db
        .update(jiraConnections)
        .set(updateData)
        .where(eq(jiraConnections.id, id));

      let personalCredentialSaved = false;
      let personalCredentialTested = false;
      let personalCredentialTestError: string | null = null;

      if (apiToken) {
        if (!effectiveInstanceUrl || !effectiveEmail) {
          return res.status(400).json({
            error: "Missing Jira email or instance URL for personal credential",
          });
        }

        try {
          const { saveUserJiraCredential, testUserJiraCredential } = await import("./integrations/jira/user-credential-resolver");
          await saveUserJiraCredential(userId, {
            instanceUrl: effectiveInstanceUrl,
            email: effectiveEmail,
            apiToken,
          });
          personalCredentialSaved = true;

          try {
            await testUserJiraCredential(userId, effectiveInstanceUrl);
            personalCredentialTested = true;
          } catch (testErr) {
            personalCredentialTestError = testErr instanceof Error ? testErr.message : String(testErr);
            console.warn(
              `[JiraRoutes] Saved Jira credential for user=${userId}, but test failed for instance=${effectiveInstanceUrl}:`,
              personalCredentialTestError,
            );
          }
        } catch (credErr) {
          console.warn(
            `[JiraRoutes] Failed to save per-user Jira credential for user=${userId}:`,
            credErr instanceof Error ? credErr.message : credErr,
          );
          throw credErr;
        }
      }

      return res.json({
        success: true,
        message: "Jira connection updated",
        id,
        orgMetadataUpdated: Object.keys(updateData).some((key) => key !== "updatedAt"),
        organizationTokenUpdated: Boolean(apiToken && isOwner),
        personalCredentialSaved,
        personalCredentialTested,
        personalCredentialTestError,
      });
    } catch (error) {
      console.error("[PUT /api/jira/connections/:id] Error:", error);
      return res.status(500).json({ error: "Failed to update Jira connection" });
    }
  });

  app.get("/api/jira/connections/:id/onboarding", requireAuth, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const userId = (req as any).user?.id;
      if (!userId) return res.status(401).json({ error: "Not signed in" });
      if (!(await canUseJiraConnection(userId, id))) {
        return res.status(403).json({ error: "You do not have access to this Jira connection" });
      }

      const [connection] = await db
        .select()
        .from(jiraConnections)
        .where(eq(jiraConnections.id, id))
        .limit(1);
      if (!connection) return res.status(404).json({ error: "Jira connection not found" });

      const registeredRows = await db
        .select({
          id: sdlcProjects.id,
          name: sdlcProjects.name,
          projectId: sdlcProjects.projectId,
          jiraProjectKey: sdlcProjects.jiraProjectKey,
          description: sdlcProjects.description,
        })
        .from(sdlcProjects)
        .where(and(eq(sdlcProjects.jiraConnectionId, id), eq(sdlcProjects.integrationType, "jira")));
      const registeredProjectIds = registeredRows.map((project) => project.id);
      const memberRows = registeredProjectIds.length > 0
        ? await db
            .select({
              userId: users.id,
              displayName: users.displayName,
              email: users.email,
              role: projectMembers.role,
            })
            .from(projectMembers)
            .innerJoin(users, eq(projectMembers.userId, users.id))
            .where(and(inArray(projectMembers.projectId, registeredProjectIds), eq(users.isDeleted, false)))
        : [];
      const memberMap = new Map<string, { userId: string; displayName: string; email: string; role: string }>();
      for (const member of memberRows) {
        if (!member.userId || memberMap.has(member.userId)) continue;
        memberMap.set(member.userId, {
          userId: member.userId,
          displayName: member.displayName || member.email,
          email: member.email,
          role: member.role,
        });
      }

      let projects: any[] = [];
      try {
        if (connection.email && connection.apiTokenEncrypted) {
          const jiraService = new JiraService({
            instanceUrl: connection.instanceUrl,
            email: connection.email,
            apiToken: decrypt(connection.apiTokenEncrypted),
          });
          projects = await jiraService.getProjects();
        }
      } catch (projectError) {
        console.warn(
          "[GET /api/jira/connections/:id/onboarding] Failed to load Jira projects:",
          projectError instanceof Error ? projectError.message : projectError,
        );
      }

      const projectOptions = projects.length > 0
        ? projects.map((project: any) => ({
            id: String(project.id || project.key || project.name),
            key: project.key ? String(project.key) : undefined,
            name: String(project.name || project.key || project.id),
            description: project.description || "",
          }))
        : registeredRows.map((project) => ({
            id: String(project.projectId || project.jiraProjectKey || project.id),
            key: project.jiraProjectKey || undefined,
            name: String(project.name || project.jiraProjectKey || project.projectId || project.id),
            description: project.description || "",
          }));

      return res.json({
        connection: {
          id: connection.id,
          name: connection.name,
          instanceUrl: connection.instanceUrl,
          email: connection.email,
        },
        projects: projectOptions,
        registeredProjects: registeredRows.map((project) => ({
          id: project.id,
          name: project.name,
          projectId: project.projectId,
          key: project.jiraProjectKey || undefined,
          description: project.description || "",
        })),
        members: Array.from(memberMap.values()),
      });
    } catch (error) {
      console.error("[GET /api/jira/connections/:id/onboarding] Error:", error);
      return res.status(500).json({ error: "Failed to load Jira connection onboarding data" });
    }
  });

  app.get("/api/jira/connections/:id/tenant-users", requireAuth, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const userId = (req as any).user?.id;
      if (!userId) return res.status(401).json({ error: "Not signed in" });
      if (!(await canUseJiraConnection(userId, id))) {
        return res.status(403).json({ error: "You do not have access to this Jira connection" });
      }

      const tenantId = await getCurrentUserTenantId(userId);
      if (!tenantId) return res.status(400).json({ error: "Missing tenant context" });

      const search = String(req.query.search ?? "").trim().toLowerCase();
      const searchPattern = `%${search}%`;
      const rows = await db
        .select({
          userId: users.id,
          displayName: users.displayName,
          email: users.email,
        })
        .from(users)
        .where(
          search
            ? and(
                eq(users.tenantId, tenantId),
                eq(users.isDeleted, false),
                sql<boolean>`(lower(coalesce(${users.displayName}, '')) like ${searchPattern} or lower(${users.email}) like ${searchPattern})`,
              )
            : and(eq(users.tenantId, tenantId), eq(users.isDeleted, false)),
        )
        .orderBy(asc(users.displayName), asc(users.email), asc(users.id))
        .limit(200);

      return res.json({
        users: rows.map((user) => ({
          userId: user.userId,
          displayName: user.displayName || user.email,
          email: user.email,
        })),
      });
    } catch (error) {
      console.error("[GET /api/jira/connections/:id/tenant-users] Error:", error);
      return res.status(500).json({ error: "Failed to load tenant users" });
    }
  });

  app.post("/api/jira/connections/:id/projects", requireAuth, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const userId = (req as any).user?.id;
      if (!userId) return res.status(401).json({ error: "Not signed in" });
      if (!(await canUseJiraConnection(userId, id))) {
        return res.status(403).json({ error: "You do not have access to this Jira connection" });
      }

      const projectsToRegister = getValidJiraProjectsFromBody(undefined, req.body?.selectedProjects);
      if (projectsToRegister.length === 0) {
        return res.json({ success: true, registeredProjectCount: 0, registeredProjects: [] });
      }

      const [connection] = await db
        .select()
        .from(jiraConnections)
        .where(eq(jiraConnections.id, id))
        .limit(1);
      if (!connection) return res.status(404).json({ error: "Jira connection not found" });

      const tenantId = await getCurrentUserTenantId(userId);
      if (!tenantId) return res.status(400).json({ error: "Missing tenant context" });

      const registeredProjects = await registerJiraProjectsForConnection({
        connectionId: id,
        instanceUrl: connection.instanceUrl,
        ownerUserId: userId,
        tenantId,
        projects: projectsToRegister,
      });

      return res.json({
        success: true,
        registeredProjectCount: registeredProjects.length,
        registeredProjects,
      });
    } catch (error) {
      console.error("[POST /api/jira/connections/:id/projects] Error:", error);
      return res.status(500).json({ error: "Failed to register Jira projects" });
    }
  });

  app.post("/api/jira/connections/:id/project-members", requireAuth, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const userId = (req as any).user?.id;
      if (!userId) return res.status(401).json({ error: "Not signed in" });
      if (!(await canUseJiraConnection(userId, id))) {
        return res.status(403).json({ error: "You do not have access to this Jira connection" });
      }

      const requestedProjectIds = Array.isArray(req.body?.projectIds)
        ? req.body.projectIds.map((value: any) => String(value)).filter(Boolean)
        : [];
      const requestedUserIds = Array.isArray(req.body?.userIds)
        ? req.body.userIds.map((value: any) => String(value)).filter(Boolean)
        : [];
      const requestedEmails = Array.isArray(req.body?.emails)
        ? req.body.emails.map((value: any) => String(value).trim().toLowerCase()).filter(Boolean)
        : [];

      if (requestedProjectIds.length === 0 || (requestedUserIds.length === 0 && requestedEmails.length === 0)) {
        return res.json({ success: true, projectCount: 0, memberCount: 0 });
      }

      const tenantId = await getCurrentUserTenantId(userId);
      if (!tenantId) return res.status(400).json({ error: "Missing tenant context" });

      const projectRows = await db
        .select({ id: sdlcProjects.id })
        .from(sdlcProjects)
        .where(
          and(
            inArray(sdlcProjects.id, requestedProjectIds),
            eq(sdlcProjects.jiraConnectionId, id),
            eq(sdlcProjects.integrationType, "jira"),
            eq(sdlcProjects.ownerUserId, userId),
          ),
        );
      const allowedProjectIds = projectRows.map((project) => project.id);
      if (allowedProjectIds.length === 0) {
        return res.status(403).json({ error: "No owned projects were found for this Jira connection" });
      }

      const existingUsers = requestedUserIds.length > 0
        ? await db
            .select({ userId: users.id, tenantId: users.tenantId })
            .from(users)
            .where(and(inArray(users.id, requestedUserIds), eq(users.tenantId, tenantId), eq(users.isDeleted, false)))
        : [];
      const memberUserIds = new Set(existingUsers.map((user) => user.userId));

      for (const email of requestedEmails) {
        const invitee = await resolveOrCreateJiraInvitee(email, userId);
        if (invitee.userId) memberUserIds.add(invitee.userId);
      }

      const { storage } = await import("./storage");
      for (const projectId of allowedProjectIds) {
        for (const memberUserId of memberUserIds) {
          if (memberUserId === userId) continue;
          await storage.addProjectMember({
            projectId,
            userId: memberUserId,
            tenantId,
            role: "member",
            invitedBy: userId,
          });
        }
      }

      return res.json({
        success: true,
        projectCount: allowedProjectIds.length,
        memberCount: memberUserIds.size,
      });
    } catch (error) {
      console.error("[POST /api/jira/connections/:id/project-members] Error:", error);
      return res.status(500).json({ error: "Failed to add Jira project members" });
    }
  });

  // DELETE /api/jira/connections/:id - Delete a Jira connection
  app.delete("/api/jira/connections/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;

      await db.delete(jiraConnections).where(eq(jiraConnections.id, id));

      return res.json({
        success: true,
        message: "Jira connection deleted",
        id,
      });
    } catch (error) {
      console.error("[DELETE /api/jira/connections/:id] Error:", error);
      return res.status(500).json({ error: "Failed to delete Jira connection" });
    }
  });

  // POST /api/jira/connections/:id/set-admin - Toggle the admin-connection
  // flag. The flagged connection's stored email/PAT is used for project
  // creation (which requires the global "Administer Jira" permission). At
  // most one connection per instance_url may be flagged at a time.
  // Restricted to TenantAdmin so a regular user cannot point the admin slot
  // at a non-admin PAT and break creation for everyone.
  app.post(
    "/api/jira/connections/:id/set-admin",
    requireAuth,
    requireRole(["TenantAdmin"]),
    async (req: Request, res: Response) => {
      try {
        const { id } = req.params;
        const { isAdmin } = req.body ?? {};
        const desired = isAdmin === undefined ? true : Boolean(isAdmin);

        const [conn] = await db
          .select()
          .from(jiraConnections)
          .where(eq(jiraConnections.id, id))
          .limit(1);

        if (!conn) {
          return res.status(404).json({ error: "Jira connection not found" });
        }

        if (!desired) {
          await db
            .update(jiraConnections)
            .set({ isAdminConnection: 0, updatedAt: new Date() })
            .where(eq(jiraConnections.id, id));
          return res.json({
            success: true,
            id,
            isAdminConnection: false,
          });
        }

        // Setting admin: validate the connection actually has admin rights
        // before flipping the flag, otherwise we'd silently break creation.
        if (!conn.email || !conn.apiTokenEncrypted) {
          return res.status(400).json({
            error: "Connection is missing email or API token; cannot mark as admin",
          });
        }

        let probedToken: string;
        try {
          probedToken = decrypt(conn.apiTokenEncrypted);
        } catch {
          return res.status(400).json({
            error: "Connection's API token could not be decrypted; reconfigure it before marking as admin",
          });
        }

        try {
          const probeService = new JiraService({
            instanceUrl: conn.instanceUrl,
            email: conn.email,
            apiToken: probedToken,
          });
          const me = await probeService.getCurrentUser();
          if (!me) {
            return res.status(400).json({
              error: "Connection's token failed authentication. Reconfigure it before marking as admin.",
            });
          }
          // Probe ADMINISTER global permission. This is a soft check; if Jira
          // can't confirm it (or the endpoint returns null) we still allow the
          // toggle (some sites expose admin via group membership without the
          // permission key surfacing here) but surface a warning.
          let adminWarning: string | null = null;
          const havePerm = await probeService.hasGlobalAdminPermission();
          if (havePerm === false) {
            adminWarning =
              "Probe could not confirm 'Administer Jira' for this account. Project creation may still fail. Verify in Jira > Settings > Global permissions.";
          }

          // Mutual exclusion: clear the flag on every other connection that
          // shares this instance_url, then set it on this one. Stored
          // instance_url values may differ only by trailing slash, so match
          // both the raw and normalised forms.
          const normalized = conn.instanceUrl.replace(/\/+$/, "");
          await db
            .update(jiraConnections)
            .set({ isAdminConnection: 0, updatedAt: new Date() })
            .where(
              and(
                ne(jiraConnections.id, id),
                eq(jiraConnections.instanceUrl, conn.instanceUrl),
              ),
            );
          if (normalized !== conn.instanceUrl) {
            await db
              .update(jiraConnections)
              .set({ isAdminConnection: 0, updatedAt: new Date() })
              .where(
                and(
                  ne(jiraConnections.id, id),
                  eq(jiraConnections.instanceUrl, normalized),
                ),
              );
          }

          await db
            .update(jiraConnections)
            .set({ isAdminConnection: 1, updatedAt: new Date() })
            .where(eq(jiraConnections.id, id));

          return res.json({
            success: true,
            id,
            isAdminConnection: true,
            probedAccount: { accountId: me.accountId, displayName: me.displayName },
            warning: adminWarning,
          });
        } catch (err) {
          console.error(
            "[POST /api/jira/connections/:id/set-admin] Probe failed:",
            err,
          );
          return res.status(400).json({
            error:
              err instanceof Error
                ? `Probe failed: ${err.message}`
                : "Probe failed before flipping admin flag",
          });
        }
      } catch (error) {
        console.error("[POST /api/jira/connections/:id/set-admin] Error:", error);
        return res
          .status(500)
          .json({ error: "Failed to toggle admin flag on Jira connection" });
      }
    },
  );

  // DELETE /api/jira/settings/:projectId - Delete Jira settings
  app.delete("/api/jira/settings/:projectId", async (req: Request, res: Response) => {
    try {
      const { projectId } = req.params;

      await db.delete(jiraSettings).where(eq(jiraSettings.projectId, projectId));

      return res.json({
        success: true,
        message: "Jira settings deleted",
        projectId,
      });
    } catch (error) {
      console.error("[DELETE /api/jira/settings] Error:", error);
      return res.status(500).json({ error: "Failed to delete Jira settings" });
    }
  });

  // POST /api/jira/test-connection - Test Jira connection (projectKey is optional for org-level testing)
  app.post("/api/jira/test-connection", async (req: Request, res: Response) => {
    try {
      const { connectionId, instanceUrl, projectKey, email, apiToken } = req.body;

      let token = apiToken;
      let url = instanceUrl;
      let userEmail = email;

      if (!token && connectionId) {
        const connection = await db
          .select()
          .from(jiraConnections)
          .where(eq(jiraConnections.id, connectionId))
          .limit(1);

        if (connection.length > 0 && connection[0].apiTokenEncrypted) {
          token = decrypt(connection[0].apiTokenEncrypted);
          url = url || connection[0].instanceUrl;
          userEmail = userEmail || connection[0].email;
        }
      }

      if (!url || !userEmail || !token) {
        return res.status(400).json({
          error: "Missing required fields for connection test: instanceUrl, email, apiToken",
        });
      }

      const jiraService = new JiraService({
        instanceUrl: url,
        projectKey: projectKey || "",
        email: userEmail,
        apiToken: token,
      });

      const result = await jiraService.testConnection();
      const projects = result.success
        ? await jiraService.getProjects().catch((projectError) => {
            console.warn(
              "[POST /api/jira/test-connection] Connected but failed to list projects:",
              projectError instanceof Error ? projectError.message : projectError,
            );
            return [];
          })
        : [];

      if (result.success && connectionId) {
        // jiraConnections does not have lastTestedAt column in schema
        /*
        await db
          .update(jiraConnections)
          .set({ lastTestedAt: new Date() })
          .where(eq(jiraConnections.id, connectionId));
        */
      }

      return res.json({
        ...result,
        projects: projects.map((project: any) => ({
          id: String(project.id || project.key || project.name),
          key: project.key ? String(project.key) : undefined,
          name: String(project.name || project.key || project.id),
          description: project.description || "",
        })),
      });
    } catch (error) {
      console.error("[POST /api/jira/test-connection] Error:", error);
      return res.status(500).json({
        success: false,
        message: error instanceof Error ? error.message : "Connection test failed",
      });
    }
  });

  // GET /api/jira/connections - Get all org-level Jira connections
  app.get("/api/jira/connections", requireAuth, async (req: Request, res: Response) => {
    try {
      const { storage } = await import("./storage");
      const userId = (req as any).user?.id;
      let visibleOrgs: Array<{ id: string; tenantId?: string | null; ownerUserId?: string | null }> = [];
      
      let conditions = [];
      if (userId) {
        visibleOrgs = await storage.getVisibleOrganizations(userId);
        const visibleOrgIds = visibleOrgs.map((org) => org.id);
        if (visibleOrgIds.length === 0) {
          return res.json({ connections: [] });
        }
        conditions.push(inArray(jiraConnections.id, visibleOrgIds));
      }

      const query = db
        .select({
          id: jiraConnections.id,
          name: jiraConnections.name,
          instanceUrl: jiraConnections.instanceUrl,
          email: jiraConnections.email,
          apiTokenEncrypted: jiraConnections.apiTokenEncrypted,
          isActive: jiraConnections.isActive,
          isAdminConnection: jiraConnections.isAdminConnection,
          createdAt: jiraConnections.createdAt,
          updatedAt: jiraConnections.updatedAt,
        })
        .from(jiraConnections);

      if (conditions.length > 0) {
        query.where(and(...conditions));
      }

      const connections = await query;
      const connectionIds = connections.map((conn) => conn.id);
      const visibleOrgById = new Map(visibleOrgs.map((org) => [org.id, org]));
      const missingConnectionIds = connectionIds.filter((id) => !visibleOrgById.has(id));
      const missingOrgRows = missingConnectionIds.length > 0
        ? await db
            .select({
              id: organizations.id,
              tenantId: organizations.tenantId,
              ownerUserId: organizations.ownerUserId,
            })
            .from(organizations)
            .where(inArray(organizations.id, missingConnectionIds))
        : [];
      for (const org of missingOrgRows) {
        visibleOrgById.set(org.id, org);
      }
      const ownerUserIds = Array.from(
        new Set(
          Array.from(visibleOrgById.values())
            .map((org) => org.ownerUserId)
            .filter((ownerUserId): ownerUserId is string => Boolean(ownerUserId)),
        ),
      );
      const ownerRows = ownerUserIds.length > 0
        ? await db
            .select({
              id: users.id,
              email: users.email,
              displayName: users.displayName,
            })
            .from(users)
            .where(inArray(users.id, ownerUserIds))
        : [];
      const ownerInfoByUserId = new Map(
        ownerRows.map((owner) => [
          owner.id,
          {
            id: owner.id,
            email: owner.email,
            displayName: owner.displayName,
          },
        ]),
      );

      const userRoleRows = userId
        ? await db
            .select({
              roleName: roles.name,
              tenantId: userRoles.tenantId,
            })
            .from(userRoles)
            .leftJoin(roles, eq(userRoles.roleId, roles.id))
            .where(eq(userRoles.userId, userId))
        : [];

      const safeConnections = connections.map(conn => {
        const { apiTokenEncrypted, ...safeConn } = conn;
        const org = visibleOrgById.get(conn.id);
        const ownerUserId = org?.ownerUserId || null;
        const orgTenantId = org?.tenantId || null;
        const hasToken = !!apiTokenEncrypted;
        const hasCreateProjectPermission =
          Boolean(userId && ownerUserId === userId) ||
          Boolean(
            orgTenantId &&
              userRoleRows.some(
                (row) =>
                  row.tenantId === orgTenantId &&
                  (row.roleName === "TenantAdmin" || row.roleName === "OrgAdmin"),
              ),
          );
        const isActive = conn.isActive === 1;
        const canCreateProject = isActive && hasToken && hasCreateProjectPermission;
        const createProjectDisabledReason = !isActive
          ? "This Jira connection is inactive. Activate it before creating projects."
          : !hasToken
            ? "This Jira connection is missing its API token. Reconfigure it before creating projects."
            : !hasCreateProjectPermission
              ? "Only the Jira connection owner, TenantAdmin, or OrgAdmin can create projects under this Jira organization."
              : null;
        return {
          ...safeConn,
          ownerUserId,
          ownerInfo: ownerUserId ? ownerInfoByUserId.get(ownerUserId) || null : null,
          hasToken,
          canCreateProject,
          createProjectDisabledReason,
        };
      });

      return res.json({ connections: safeConnections });
    } catch (error) {
      console.error("[GET /api/jira/connections] Error:", error);
      return res.status(500).json({ error: "Failed to get Jira connections" });
    }
  });

  // GET /api/jira/connection/:connectionId/sdlc-projects - Get SDLC projects linked to a Jira connection
  app.get("/api/jira/connection/:connectionId/sdlc-projects", requireAuth, async (req: Request, res: Response) => {
    try {
      const { connectionId } = req.params;

      const connection = await db
        .select()
        .from(jiraConnections)
        .where(eq(jiraConnections.id, connectionId))
        .limit(1);

      if (connection.length === 0) {
        return res.status(404).json({ error: "Jira connection not found" });
      }

      const userId = (req as any).user?.id;
      const projects = userId
        ? await sdlcService.getAllProjects(userId)
        : [];

      const instanceUrl = connection[0].instanceUrl;
      const normalizedConnectionUrl = instanceUrl.replace(/\/+$/, "").toLowerCase();
      const allJiraConnections = await db.select().from(jiraConnections);
      const allowLegacyUrlFallback =
        allJiraConnections.filter((candidate) =>
          candidate.instanceUrl.replace(/\/+$/, "").toLowerCase() === normalizedConnectionUrl
        ).length <= 1;

      const filteredProjects = projects.filter((p) => {
        if (p.integrationType !== "jira" || p.deletedFromAdo) return false;
        // Strict scoping: match by jiraConnectionId first.
        if (p.jiraConnectionId != null) {
          return p.jiraConnectionId === connectionId;
        }

        if (!allowLegacyUrlFallback) return false;

        // Fallback: match by URL only if project has no connection ID (legacy rows).
        const normalizedProjectUrl = (p.jiraInstanceUrl || p.organization || "").replace(/\/+$/, "").toLowerCase();
        
        return normalizedProjectUrl === normalizedConnectionUrl;
      });

      return res.json({
        projects: filteredProjects.map((p) => ({
          id: p.id,
          name: p.name,
          description: p.description,
          organization: p.organization,
          organizationUrl: instanceUrl,
          cloudProvider: p.cloudProvider,
          projectId: p.projectId,
          jiraProjectKey: p.jiraProjectKey,
          jiraConnectionId: p.jiraConnectionId,
          jiraInstanceUrl: p.jiraInstanceUrl,
          adoProjecturl: p.adoProjecturl,
          linkedGoldenRepoName: p.linkedGoldenRepoName,
          status: p.status,
          createdAt: p.createdAt,
        })),
      });
    } catch (error) {
      console.error("[GET /api/jira/connection/:connectionId/sdlc-projects] Error:", error);
      return res.status(500).json({ error: "Failed to get Jira SDLC projects" });
    }
  });

  // GET /api/jira/connection/:connectionId/projects - Get Jira projects for an org-level connection
  app.get("/api/jira/connection/:connectionId/projects", requireAuth, async (req: Request, res: Response) => {
    try {
      const { connectionId } = req.params;

      const connection = await db
        .select()
        .from(jiraConnections)
        .where(eq(jiraConnections.id, connectionId))
        .limit(1);

      if (connection.length === 0) {
        return res.status(404).json({ error: "Jira connection not found" });
      }

      const jiraService = new JiraService({
        instanceUrl: connection[0].instanceUrl,
        // projectKey not needed for getProjects() - it fetches all projects
        email: connection[0].email,
        apiToken: decrypt(connection[0].apiTokenEncrypted),
      });

      const projects = await jiraService.getProjects();
      const userId = (req as any).user?.id;
      const normalizedConnectionUrl = connection[0].instanceUrl.replace(/\/+$/, "").toLowerCase();
      const allJiraConnections = await db.select().from(jiraConnections);
      const allowLegacyUrlFallback =
        allJiraConnections.filter((candidate) =>
          candidate.instanceUrl.replace(/\/+$/, "").toLowerCase() === normalizedConnectionUrl
        ).length <= 1;
      const visibleProjects = userId
        ? (await sdlcService.getAllProjects(userId)).filter((project) => {
          if (project.integrationType !== "jira" || project.deletedFromAdo) return false;
          if (project.jiraConnectionId) return project.jiraConnectionId === connectionId;

          if (!allowLegacyUrlFallback) return false;

          const normalizedProjectUrl = (project.jiraInstanceUrl || project.organization || "").replace(/\/+$/, "").toLowerCase();
          return normalizedProjectUrl === normalizedConnectionUrl;
        })
        : [];
      const visibleByKey = new Map<string, typeof visibleProjects[0]>();
      for (const project of visibleProjects) {
        if (project.jiraProjectKey) visibleByKey.set(project.jiraProjectKey.toUpperCase(), project);
        if (project.projectId) visibleByKey.set(project.projectId.toUpperCase(), project);
        visibleByKey.set(project.id, project);
      }

      // For each Jira project, check if it exists in SDLC database
      // This allows the UI to show a sync icon for projects not yet synced
      const projectsWithSdlc = await Promise.all(
        projects
          .filter((project) => {
            const keyMatch = project.key ? visibleByKey.get(project.key.toUpperCase()) : undefined;
            const idMatch = project.id ? visibleByKey.get(String(project.id).toUpperCase()) : undefined;
            return !!keyMatch || !!idMatch;
          })
          .map(async (project) => {
          try {
            // Find SDLC project by projectId or jiraProjectKey, scoped to this connection
            // so we don't match sdlcProjects from other Jira instances (e.g. same key on two instances).
            let sdlcProject =
              (project.key ? visibleByKey.get(project.key.toUpperCase()) : undefined) ||
              (project.id ? visibleByKey.get(String(project.id).toUpperCase()) : undefined);

            // Log for debugging
            if (sdlcProject) {
              console.log(`[Jira Projects] Found SDLC project for Jira project ${project.id} (${project.key}): ${sdlcProject.id}`);
            } else {
              console.log(`[Jira Projects] No SDLC project found for Jira project ${project.id} (${project.key}) - will show sync icon`);
            }
            
            return {
              ...project,
              // Add Jira-specific fields for sync dialog
              cloudProvider: "Jira",
              jiraProjectKey: project.key,
              jiraInstanceUrl: connection[0].instanceUrl,
              jiraConnectionId: connectionId,
              organizationUrl: connection[0].instanceUrl,
              // Set organization field for display (use instanceUrl for Jira projects)
              organization: connection[0].instanceUrl,
              sdlcProject: sdlcProject || null,
            };
          } catch (err) {
            console.error(
              "[API] Error looking up SDLC project for Jira project",
              project.id,
              project.key,
              err,
            );
            return {
              ...project,
              // Add Jira-specific fields for sync dialog
              cloudProvider: "Jira",
              jiraProjectKey: project.key,
              jiraInstanceUrl: connection[0].instanceUrl,
              jiraConnectionId: connectionId,
              organizationUrl: connection[0].instanceUrl,
              // Set organization field for display (use instanceUrl for Jira projects)
              organization: connection[0].instanceUrl,
              sdlcProject: null,
            };
          }
        }),
      );

      return res.json({ projects: projectsWithSdlc });
    } catch (error) {
      console.error("[GET /api/jira/connection/:connectionId/projects] Error:", error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;
      console.error("[GET /api/jira/connection/:connectionId/projects] Error details:", {
        message: errorMessage,
        stack: errorStack,
      });
      return res.status(500).json({ 
        error: "Failed to get Jira projects",
        details: errorMessage,
      });
    }
  });

  // POST /api/jira/connection/:connectionId/projects - Create a Jira project using an org-level connection
  app.post("/api/jira/connection/:connectionId/projects", async (req: Request, res: Response) => {
    try {
      const { connectionId } = req.params;
      const { name, key, projectTypeKey, description, leadAccountId } = req.body;

      if (!name || !key) {
        return res.status(400).json({ error: "Missing required fields: name, key" });
      }

      const connection = await db
        .select()
        .from(jiraConnections)
        .where(eq(jiraConnections.id, connectionId))
        .limit(1);

      if (connection.length === 0) {
        return res.status(404).json({ error: "Jira connection not found" });
      }

      const jiraService = new JiraService({
        instanceUrl: connection[0].instanceUrl,
        projectKey: key,
        email: connection[0].email,
        apiToken: decrypt(connection[0].apiTokenEncrypted),
      });

      const project = await jiraService.createProject({
        name,
        key,
        projectTypeKey: projectTypeKey || "software",
        description,
        leadAccountId,
      });

      return res.json({ success: true, project });
    } catch (error: any) {
      console.error("[POST /api/jira/connection/:connectionId/projects] Error:", error);
      const msg = error instanceof Error ? error.message : String(error);
      const isDuplicate =
        msg.includes("already exists") ||
        msg.includes("project with that name") ||
        msg.includes("project with key");

      if (isDuplicate) {
        return res.status(400).json({
          error: "Duplicate Project in Jira",
          message: `A project with the name "${name}" or key "${key}" already exists in your Jira instance. Please use a unique name and key.`,
        });
      }
      return res.status(500).json({ 
        error: "Failed to create Jira project",
        message: msg
      });
    }
  });

  // POST /api/jira/create-project - Simplified create project endpoint (connectionId in body)
  // Also persists the project to the SDLC database and creates Jira settings
  app.post("/api/jira/create-project", requireAuth, async (req: Request, res: Response) => {
    try {
      const { 
        connectionId, 
        projectName, 
        projectKey, 
        confluenceSpaceKey,
        projectDescription, 
        projectTypeKey, 
        projectTemplateKey,
        goldenRepoId,
        goldenRepoName,
        goldenRepoOrg,
        goldenRepoProject,
        golden_repo_reference,
        goldenRepoProvider,
        goldenRepoUrl,
        goldenRepoDefaultBranch,
        repositoryId,
      } = req.body;

      if (!connectionId) {
        return res.status(400).json({ error: "Missing required field: connectionId" });
      }
      if (!projectName || !projectKey) {
        return res.status(400).json({ error: "Missing required fields: projectName, projectKey" });
      }

      // Validate golden_repo_reference if provided
      let validatedGoldenRepoReference: {
        repoId: string;
        repoName: string;
        filePaths: string[];
        provider?: "ado" | "github" | "gitlab";
        repoUrl?: string;
        defaultBranch?: string;
      } | null = null;

      if (golden_repo_reference) {
        const { validateGoldenRepoReference } = await import("./golden-repos/validate-reference");
        const validation = validateGoldenRepoReference(golden_repo_reference);
        if (!validation.ok) {
          return res.status(validation.status).json({ error: validation.error });
        }
        validatedGoldenRepoReference = validation.value;
      } else if (goldenRepoId) {
        // Backward compatibility: if golden_repo_reference is not provided but goldenRepoId is,
        // create a reference with empty filePaths
        validatedGoldenRepoReference = {
          repoId: goldenRepoId,
          repoName: goldenRepoName || "",
          filePaths: [],
          ...(goldenRepoProvider === "ado" || goldenRepoProvider === "github" || goldenRepoProvider === "gitlab"
            ? { provider: goldenRepoProvider }
            : {}),
          ...(typeof goldenRepoUrl === "string" && goldenRepoUrl.trim()
            ? { repoUrl: goldenRepoUrl.trim() }
            : {}),
          ...(typeof goldenRepoDefaultBranch === "string" && goldenRepoDefaultBranch.trim()
            ? { defaultBranch: goldenRepoDefaultBranch.trim() }
            : {}),
        };
      }

      const connection = await db
        .select()
        .from(jiraConnections)
        .where(eq(jiraConnections.id, connectionId))
        .limit(1);

      if (connection.length === 0) {
        return res.status(404).json({ error: "Jira connection not found" });
      }

      // Validate connection has required fields
      if (!connection[0].instanceUrl) {
        return res.status(400).json({ error: "Jira connection missing instanceUrl" });
      }
      if (!connection[0].email) {
        return res.status(400).json({ error: "Jira connection missing email" });
      }
      if (!connection[0].apiTokenEncrypted) {
        return res.status(400).json({ error: "Jira connection missing API token" });
      }

      // Decrypt API token with error handling
      let decryptedToken: string;
      try {
        decryptedToken = decrypt(connection[0].apiTokenEncrypted);
        if (!decryptedToken || decryptedToken.trim().length === 0) {
          return res.status(400).json({ 
            error: "Failed to decrypt API token or token is empty. Please reconfigure your Jira connection." 
          });
        }
      } catch (decryptError) {
        console.error("[POST /api/jira/create-project] Decryption error:", decryptError);
        return res.status(500).json({ 
          error: "Failed to decrypt API token. Please reconfigure your Jira connection.",
          message: decryptError instanceof Error ? decryptError.message : "Unknown decryption error"
        });
      }

      // Check if connection is active
      if (connection[0].isActive !== 1) {
        return res.status(400).json({
          error: "Jira connection is not active",
          message: "This Jira connection is marked as inactive. Please activate it in Settings or use a different connection.",
        });
      }

      const userId = (req as any).user?.id;
      if (!userId) {
        return res.status(401).json({ error: "Authentication required" });
      }

      const [jiraOrg] = await db
        .select({
          id: organizations.id,
          tenantId: organizations.tenantId,
          ownerUserId: organizations.ownerUserId,
        })
        .from(organizations)
        .where(eq(organizations.id, connectionId))
        .limit(1);

      if (!jiraOrg) {
        return res.status(403).json({
          error: "Jira connection visibility is not configured",
          message: "This Jira connection is missing its organization ownership row. Re-save the connection before creating projects.",
        });
      }

      const userRoleRows = await db
        .select({
          roleName: roles.name,
          tenantId: userRoles.tenantId,
        })
        .from(userRoles)
        .leftJoin(roles, eq(userRoles.roleId, roles.id))
        .where(eq(userRoles.userId, userId));

      const isConnectionOwner = jiraOrg.ownerUserId === userId;
      const isTenantOrOrgAdmin = userRoleRows.some(
        (row) =>
          row.tenantId === jiraOrg.tenantId &&
          (row.roleName === "TenantAdmin" || row.roleName === "OrgAdmin"),
      );

      if (!isConnectionOwner && !isTenantOrOrgAdmin) {
        return res.status(403).json({
          error: "Not authorized to create Jira projects",
          message:
            "Only the Jira connection owner, TenantAdmin, or OrgAdmin can create projects under this Jira organization.",
        });
      }

      // Check if this project already exists in DevX (idempotency / retry safety)
      const [existingProject] = await db
        .select()
        .from(sdlcProjects)
        .where(
          and(
            or(
              eq(sdlcProjects.jiraProjectKey, projectKey),
              eq(sdlcProjects.name, projectName)
            ),
            eq(sdlcProjects.jiraConnectionId, connectionId),
            eq(sdlcProjects.deletedFromAdo, false)
          )
        )
        .limit(1);

      if (existingProject) {
        const conflictField = existingProject.jiraProjectKey === projectKey ? "key" : "name";
        const conflictValue = existingProject.jiraProjectKey === projectKey ? projectKey : projectName;
        return res.status(400).json({
          error: "Duplicate Project",
          message: `The project ${conflictField} "${conflictValue}" is already registered in DevX for this connection. Please use a unique ${conflictField}.`,
        });
      }

      // Project creation uses the selected Jira connection's own token. Access
      // is constrained above to the connection owner and tenant/org admins.
      const jiraService = new JiraService({
        instanceUrl: connection[0].instanceUrl,
        email: connection[0].email,
        apiToken: decryptedToken,
        projectKey,
      });

      // Use the clicker's accountId as the project lead so audit trail in
      // Jira reflects who actually requested the project. If their personal
      // token is missing or invalid, Jira will use the selected connection user.
      let leadAccountId: string | undefined;
      if (userId) {
        try {
          const { getJiraServiceForUser } = await import(
            "./integrations/jira/user-credential-resolver"
          );
          const userJira = await getJiraServiceForUser(
            userId,
            undefined,
            connection[0].instanceUrl,
          );
          const me = await userJira.getCurrentUser();
          leadAccountId = me?.accountId ?? undefined;
        } catch (leadErr) {
          console.warn(
            "[POST /api/jira/create-project] Could not resolve clicker accountId; selected connection user will become project lead:",
            leadErr instanceof Error ? leadErr.message : leadErr,
          );
        }
      }

      let jiraProject: { id: string; key: string; name: string };
      try {
        jiraProject = await jiraService.createProject({
          name: projectName,
          key: projectKey,
          projectTypeKey: projectTypeKey || "software",
          description: projectDescription,
          projectTemplateKey: projectTemplateKey,
          leadAccountId,
        });
      } catch (jiraError: any) {
        const msg = jiraError?.message || "";
        const isDuplicate =
          msg.includes("already exists") ||
          msg.includes("project with that name") ||
          msg.includes("project with key");
        
        if (isDuplicate) {
          return res.status(400).json({
            error: "Duplicate Project in Jira",
            message: `A project with the name "${projectName}" or key "${projectKey}" already exists in your Jira instance. Please use a unique name and key.`,
          });
        }
        
        throw jiraError;
      }

      // Create SDLC project record in database
      const sdlcProjectId = crypto.randomUUID();
      await db.insert(sdlcProjects).values({
        id: sdlcProjectId,
        name: projectName,
        description: projectDescription || null,
        organization: connection[0].instanceUrl,
        cloudProvider: "Jira",
        projectId: jiraProject.id,
        adoProjecturl: `${connection[0].instanceUrl}/browse/${projectKey}`,
        integrationType: "jira",
        jiraProjectKey: projectKey,
        jiraInstanceUrl: connection[0].instanceUrl,
        jiraConnectionId: connectionId,
        linkedGoldenRepoOrg: goldenRepoOrg || null,
        linkedGoldenRepoProject: goldenRepoProject || null,
        linkedGoldenRepoName: goldenRepoName || validatedGoldenRepoReference?.repoName || null,
        goldenRepoReference: validatedGoldenRepoReference,
        repository_id: repositoryId || null,
        repositoryCount: repositoryId ? 1 : 0,
        ownerUserId: (req as any).user?.id || null,
        status: "active",
      });

      await ensureProjectOwnerMembershipsForAliases({
        projectId: sdlcProjectId,
        ownerUserId: (req as any).user?.id || null,
      });

      // Non-critical: cache Jira issue types
      try {
        await jiraService.getIssueTypesForProject(projectKey);
      } catch (workTypeError) {
        console.warn("[POST /api/jira/create-project] Failed to cache Jira issue types:", workTypeError);
      }

      // Create Jira settings — skip if somehow already present
      const [existingSettings] = await db
        .select({ id: jiraSettings.id })
        .from(jiraSettings)
        .where(eq(jiraSettings.projectId, sdlcProjectId))
        .limit(1);

      if (!existingSettings) {
        await db.insert(jiraSettings).values({
          id: crypto.randomUUID(),
          projectId: sdlcProjectId,
          connectionId: connectionId,
          instanceUrl: connection[0].instanceUrl,
          projectKey: projectKey,
          email: connection[0].email,
          apiTokenEncrypted: connection[0].apiTokenEncrypted,
          confluenceSpaceKey: confluenceSpaceKey || null,
          isActive: 1,
        });

        // Auto-sync the new project's JIRA team members (fire-and-forget).
        import("./integrations/jira/team-sync-service")
          .then((m) => m.syncJiraTeam({ instanceUrl: connection[0].instanceUrl, project: projectKey }))
          .then((r) => console.log(`[JiraRoutes] auto team-sync ${projectKey}: members=${r.members} matched=${r.matched}`))
          .catch((e) => console.warn("[JiraRoutes] auto team-sync failed:", e?.message || e));
      }

      // Create integration settings — skip if somehow already present
      const [existingIntegration] = await db
        .select({ id: integrationSettings.id })
        .from(integrationSettings)
        .where(eq(integrationSettings.projectId, sdlcProjectId))
        .limit(1);

      if (!existingIntegration) {
        await db.insert(integrationSettings).values({
          id: crypto.randomUUID(),
          projectId: sdlcProjectId,
          integrationType: "jira",
        });
      }

      return res.json({ 
        success: true, 
        project: jiraProject,
        projectKey: projectKey,
        projectName: projectName,
        connectionId,
        sdlcProjectId,
        jiraProjectId: jiraProject.id,
      });
    } catch (error) {
      console.error("[POST /api/jira/create-project] Error:", error);
      const msg = error instanceof Error ? error.message : "Unknown error";
      // Jira returns 403 with an "administrator rights" message when the
      // authenticating account lacks the global "Administer Jira" permission.
      // Surface this distinctly so admins know to reconfigure the admin
      // connection rather than chasing a generic 500.
      if (/403/.test(msg) && /administrator/i.test(msg)) {
        return res.status(403).json({
          error: "Jira admin permission required",
          message:
            "The admin Jira connection's account lacks the global 'Administer Jira' permission. " +
            "Ask a tenant admin to mark a different connection as admin in Settings, " +
            "or grant 'Administer Jira' to the current admin account.",
        });
      }
      return res.status(500).json({
        error: "Failed to create Jira project",
        message: msg,
      });
    }
  });

  // GET /api/jira/check-project-key - Check if project key exists in database (globally, without connection)
  app.get("/api/jira/check-project-key", async (req: Request, res: Response) => {
    try {
      const { projectKey } = req.query;

      if (!projectKey || typeof projectKey !== "string") {
        return res.status(400).json({ error: "projectKey is required" });
      }

      const normalizedKey = projectKey.trim().toUpperCase();

      // Check if project key exists in sdlc_projects table (globally, across all connections)
      const existingProjects = await db
        .select({ id: sdlcProjects.id, name: sdlcProjects.name, jiraProjectKey: sdlcProjects.jiraProjectKey })
        .from(sdlcProjects)
        .where(eq(sdlcProjects.jiraProjectKey, normalizedKey))
        .limit(1);

      if (existingProjects.length > 0) {
        return res.json({
          exists: true,
          project: {
            id: existingProjects[0].id,
            name: existingProjects[0].name,
            key: existingProjects[0].jiraProjectKey,
          },
        });
      }

      return res.json({ exists: false });
    } catch (error) {
      console.error("[GET /api/jira/check-project-key] Error:", error);
      return res.status(500).json({ 
        error: "Failed to check project key",
        message: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  // GET /api/jira/projects - Get Jira projects
  app.get("/api/jira/projects/:projectId", requireAuth, async (req: Request, res: Response) => {
    try {
      const { projectId } = req.params;

      const settings = await db
        .select()
        .from(jiraSettings)
        .where(eq(jiraSettings.projectId, projectId))
        .limit(1);

      if (settings.length === 0) {
        return res.status(404).json({ error: "Jira settings not found" });
      }

      const jiraService = await getJiraServiceForWrite(req, settings[0].projectKey, settings[0].instanceUrl);

      const projects = await jiraService.getProjects();
      return res.json({ projects });
    } catch (error) {
      console.error("[GET /api/jira/projects] Error:", error);
      if (respondWithJiraCredentialError(res, error)) return;
      return res.status(500).json({ error: "Failed to get Jira projects" });
    }
  });

  // GET /api/jira/epics/:projectId - Get epics from Jira
  app.get("/api/jira/epics/:projectId", requireAuth, async (req: Request, res: Response) => {
    try {
      const { projectId } = req.params;

      const settings = await db
        .select()
        .from(jiraSettings)
        .where(eq(jiraSettings.projectId, projectId))
        .limit(1);

      if (settings.length === 0) {
        return res.status(404).json({ error: "Jira settings not found" });
      }

      const jiraService = await getJiraServiceForWrite(req, settings[0].projectKey, settings[0].instanceUrl);

      const epics = await jiraService.getEpics();
      return res.json({ epics });
    } catch (error) {
      console.error("[GET /api/jira/epics] Error:", error);
      if (respondWithJiraCredentialError(res, error)) return;
      return res.status(500).json({ error: "Failed to get Jira epics" });
    }
  });

  // GET /api/jira/stories/:projectId - Get user stories from Jira
  app.get("/api/jira/stories/:projectId", requireAuth, async (req: Request, res: Response) => {
    try {
      const { projectId } = req.params;

      const settings = await db
        .select()
        .from(jiraSettings)
        .where(eq(jiraSettings.projectId, projectId))
        .limit(1);

      if (settings.length === 0) {
        return res.status(404).json({ error: "Jira settings not found" });
      }

      const jiraService = await getJiraServiceForWrite(req, settings[0].projectKey, settings[0].instanceUrl);

      const stories = await jiraService.getUserStories();
      return res.json({ stories });
    } catch (error) {
      console.error("[GET /api/jira/stories] Error:", error);
      if (respondWithJiraCredentialError(res, error)) return;
      return res.status(500).json({ error: "Failed to get Jira stories" });
    }
  });

  // GET /api/jira/sprints/:projectId - Get sprints from Jira
  app.get("/api/jira/sprints/:projectId", requireAuth, async (req: Request, res: Response) => {
    try {
      const { projectId } = req.params;

      const settings = await db
        .select()
        .from(jiraSettings)
        .where(eq(jiraSettings.projectId, projectId))
        .limit(1);

      if (settings.length === 0) {
        return res.status(404).json({ error: "Jira settings not found" });
      }

      const jiraService = await getJiraServiceForWrite(req, settings[0].projectKey, settings[0].instanceUrl);

      const sprints = await jiraService.getSprints();
      return res.json({ sprints });
    } catch (error) {
      console.error("[GET /api/jira/sprints] Error:", error);
      if (respondWithJiraCredentialError(res, error)) return;
      return res.status(500).json({ error: "Failed to get Jira sprints" });
    }
  });

  // GET /api/jira/releases/:projectId - Get releases/versions from Jira
  app.get("/api/jira/releases/:projectId", requireAuth, async (req: Request, res: Response) => {
    try {
      const { projectId } = req.params;

      const settings = await db
        .select()
        .from(jiraSettings)
        .where(eq(jiraSettings.projectId, projectId))
        .limit(1);

      if (settings.length === 0) {
        return res.status(404).json({ error: "Jira settings not found" });
      }

      const jiraService = await getJiraServiceForWrite(req, settings[0].projectKey, settings[0].instanceUrl);

      const releases = await jiraService.getReleases();
      return res.json({ releases });
    } catch (error) {
      console.error("[GET /api/jira/releases] Error:", error);
      if (respondWithJiraCredentialError(res, error)) return;
      return res.status(500).json({ error: "Failed to get Jira releases" });
    }
  });

  // POST /api/jira/work-items - Create a work item in Jira
  app.post("/api/jira/work-items/:projectId", requireAuth, async (req: Request, res: Response) => {
    try {
      const { projectId } = req.params;
      const workItem = req.body;

      const settings = await db
        .select()
        .from(jiraSettings)
        .where(eq(jiraSettings.projectId, projectId))
        .limit(1);

      if (settings.length === 0) {
        return res.status(404).json({ error: "Jira settings not found" });
      }

      const jiraService = await getJiraServiceForWrite(req, settings[0].projectKey, settings[0].instanceUrl);

      const created = await jiraService.createWorkItem(workItem);
      return res.json({ success: true, workItem: created });
    } catch (error) {
      console.error("[POST /api/jira/work-items] Error:", error);
      if (respondWithJiraCredentialError(res, error)) return;
      return res.status(500).json({ error: "Failed to create Jira work item" });
    }
  });

  // GET /api/jira/fields/:projectId - Get available custom fields from Jira
  app.get("/api/jira/fields/:projectId", requireAuth, async (req: Request, res: Response) => {
    try {
      const { projectId } = req.params;

      const settings = await db
        .select()
        .from(jiraSettings)
        .where(eq(jiraSettings.projectId, projectId))
        .limit(1);

      if (settings.length === 0) {
        return res.status(404).json({ error: "Jira settings not found" });
      }

      const jiraService = await getJiraServiceForWrite(req, settings[0].projectKey, settings[0].instanceUrl);

      const fieldMapping = await jiraService.getFieldMapping();
      return res.json({ fields: fieldMapping });
    } catch (error) {
      console.error("[GET /api/jira/fields] Error:", error);
      if (respondWithJiraCredentialError(res, error)) return;
      return res.status(500).json({ error: "Failed to get Jira fields" });
    }
  });

  // Push work items to Jira (similar to push-to-ado but for Jira projects)
  app.post("/api/sdlc/projects/:projectId/push-to-jira", handlePushToJira);

  // Push wiki pages to Confluence (for Jira projects)
  app.post("/api/sdlc/projects/:projectId/push-to-confluence", handlePushToConfluence);

  // Get backlog context from Jira (similar to ADO backlog-context)
  app.get("/api/sdlc/projects/:projectId/jira/backlog-context", handleGetJiraBacklogContext);

  // Design phase routes
  app.get("/api/sdlc/projects/:projectId/jira/epics", handleGetJiraEpics);
  app.get("/api/sdlc/projects/:projectId/jira/epics/:epicId/user-stories", handleGetJiraEpicUserStories);
  app.get("/api/sdlc/projects/:projectId/jira/user-stories", handleGetJiraUserStories);
  app.get("/api/sdlc/projects/:projectId/jira/requirements", handleGetJiraRequirements);

  // Development phase routes
  app.get("/api/sdlc/projects/:projectId/jira/development/work-items", handleGetJiraDevelopmentWorkItems);
  app.get("/api/sdlc/projects/:projectId/jira/development/story-progress", handleGetJiraStoryProgress);
  app.get("/api/sdlc/projects/:projectId/jira/development/developer-assignments", handleGetJiraDeveloperAssignments);
  app.get("/api/sdlc/projects/:projectId/jira/development/velocity", handleGetJiraVelocity);

  // Build phase routes
  app.get("/api/sdlc/projects/:projectId/jira/build/pipelines", handleGetJiraBuildPipelines);
  app.get("/api/sdlc/projects/:projectId/jira/build/metrics", handleGetJiraBuildMetrics);
  
  // Testing phase routes
  app.post("/api/sdlc/projects/:projectId/jira/push-test-cases", handlePushTestCasesToJira);

  // Connection management routes
  app.get("/api/jira/connections/:connectionId/project-count", handleGetJiraConnectionProjectCount);

  console.log("[Jira Routes] Registered Jira and integration settings routes");
}
