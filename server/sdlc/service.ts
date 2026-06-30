import { db, poolConnection } from "../db";
import {
  sdlcProjects,
  sdlcPhases,
  phaseConfirmations,
  sdlcIssues,
  sdlcEpics,
  sdlcFeatures,
  sdlcRequirements,
  sdlcBacklogItems,
  sdlcDocuments,
  sdlcDesignAssets,
  sdlcFigmaLinks,
  sdlcDesignReviews,
  adoDesignSync,
  jiraConnections,
  artifactOrganizations,
  users
} from "@shared/schema";
import { sql } from "drizzle-orm";
import type {
  InsertSDLCProject,
  InsertSDLCPhase,
  SDLCProject,
  SDLCPhase,
  InsertPhaseConfirmation,
  PhaseConfirmation,
  InsertSDLCIssue,
  SDLCIssue,
  InsertSDLCEpic,
  SDLCEpic,
  InsertSDLCFeature,
  SDLCFeature,
  InsertSDLCRequirement,
  SDLCRequirement,
  InsertSDLCBacklogItem,
  SDLCBacklogItem,
  InsertSDLCDocument,
  SDLCDocument,
  InsertSDLCDesignAsset,
  SDLCDesignAsset,
  InsertSDLCFigmaLink,
  SDLCFigmaLink,
  InsertSDLCDesignReview,
  SDLCDesignReview,
  InsertAdoDesignSync,
  AdoDesignSync,
} from "@shared/schema";
import { eq, and, or, count } from "drizzle-orm";
import { randomUUID } from "crypto";
import { matchesOrganizationValue, normalizeOrganizationValue } from "../utils/organization-matcher";
import {
  ensureProjectOwnerMembershipsForAliases,
  resolveEffectiveUserAccess,
} from "../auth/effective-user-access";

export class SDLCService {
  // Project operations
  async createProject(data: InsertSDLCProject): Promise<SDLCProject> {
    const id = randomUUID();
    await db.insert(sdlcProjects).values({ ...data, id } as any);
    const inserted = await db.select().from(sdlcProjects).where(eq(sdlcProjects.id, id)).limit(1);
    if (!inserted[0]) {
      throw new Error("Failed to create project");
    }
    const project = inserted[0];

    await ensureProjectOwnerMembershipsForAliases({
      projectId: project.id,
      ownerUserId: project.ownerUserId,
    });

    // Automatically create 6 phases for the new project
    const phaseNames = [
      "Requirement and Analysis",
      "Design",
      "Development",
      "Build and Testing",
      "Deployment",
      "Maintenance",
    ];

    for (let i = 0; i < phaseNames.length; i++) {
      await db.insert(sdlcPhases).values({
        projectId: project.id,
        phaseNumber: i + 1,
        phaseName: phaseNames[i],
        status: "not_started",
        progress: 0,
      });
    }

    return project;
  }

  async getProject(id: string): Promise<SDLCProject | undefined> {
    const [project] = await db.select().from(sdlcProjects).where(eq(sdlcProjects.id, id));
    return project;
  }

  async registerProviderProject(data:
    | {
        integrationType: "jira";
        projectId: string;
        projectKey: string;
        name: string;
        description?: string | null;
        instanceUrl: string;
        connectionId: string;
        ownerUserId: string;
      }
    | {
        integrationType: "ado";
        projectId: string;
        name: string;
        description?: string | null;
        organization: string;
        organizationUrl: string;
        ownerUserId: string;
      }
  ): Promise<SDLCProject> {
    if (data.integrationType === "jira") {
      const existingCandidate =
        await this.getProjectByJiraProjectId(data.projectKey, {
          jiraConnectionId: data.connectionId,
        }) ||
        await this.getProjectByJiraProjectId(data.projectId, {
          jiraConnectionId: data.connectionId,
        });
      let existing = existingCandidate;
      if (existingCandidate?.ownerUserId) {
        const [owner] = await db
          .select({ tenantId: users.tenantId })
          .from(users)
          .where(eq(users.id, existingCandidate.ownerUserId))
          .limit(1);
        const [newOwner] = await db
          .select({ tenantId: users.tenantId })
          .from(users)
          .where(eq(users.id, data.ownerUserId))
          .limit(1);
        if (owner?.tenantId && newOwner?.tenantId && owner.tenantId !== newOwner.tenantId) {
          existing = undefined;
        }
      }

      const updateData = {
        name: data.name,
        description: data.description || null,
        organization: data.instanceUrl,
        cloudProvider: "Jira",
        projectId: data.projectId,
        adoProjecturl: `${data.instanceUrl.replace(/\/+$/, "")}/browse/${data.projectKey}`,
        integrationType: "jira",
        jiraProjectKey: data.projectKey,
        jiraInstanceUrl: data.instanceUrl,
        jiraConnectionId: data.connectionId,
        ownerUserId: existing?.ownerUserId || data.ownerUserId,
        status: "active",
        deletedFromAdo: false,
      } as Partial<InsertSDLCProject>;

      if (existing) {
        return this.updateProject(existing.id, updateData);
      }

      return this.createProject(updateData as InsertSDLCProject);
    }

    const existing = await this.getProjectByAdoProjectId(data.projectId);
    const updateData = {
      name: data.name,
      description: data.description || null,
      organization: data.organization,
      cloudProvider: "Azure DevOps",
      projectId: data.projectId,
      adoProjecturl: `${data.organizationUrl.replace(/\/+$/, "")}/${encodeURIComponent(data.name)}`,
      integrationType: "ado",
      ownerUserId: existing?.ownerUserId || data.ownerUserId,
      status: "active",
      deletedFromAdo: false,
    } as Partial<InsertSDLCProject>;

    if (existing) {
      return this.updateProject(existing.id, updateData);
    }

    return this.createProject(updateData as InsertSDLCProject);
  }

  async getAllProjects(userId?: string): Promise<SDLCProject[]> {
    const allProjects = await db
      .select()
      .from(sdlcProjects)
      .where(eq(sdlcProjects.deletedFromAdo, false));

    if (!userId) return allProjects;

    const access = await resolveEffectiveUserAccess(userId);
    if (!access || access.tenantIds.length === 0) return [];
    const effectiveUserIds = access.userIds;
    const effectiveUserIdSet = new Set(effectiveUserIds);
    const effectiveTenantIds = new Set(access.tenantIds);

    const ownerUserIds = Array.from(
      new Set(
        allProjects
          .map((project) => project.ownerUserId)
          .filter((ownerUserId): ownerUserId is string => Boolean(ownerUserId)),
      ),
    );
    const ownerRows = ownerUserIds.length > 0
      ? await db
          .select({ id: users.id, tenantId: users.tenantId })
          .from(users)
          .where(sql`${users.id} IN (${sql.join(ownerUserIds.map((id) => sql`${id}`), sql`, `)})`)
      : [];
    const ownerTenantByUserId = new Map(ownerRows.map((owner) => [owner.id, owner.tenantId]));

    const { storage } = await import("../storage");
    const visibleOrgs = await storage.getVisibleOrganizations(userId);
    const visibleOrgIds = new Set(visibleOrgs.map(org => org.id));
    
    // Fetch explicit project memberships for the user
    const { projectMembers } = await import("@shared/schema");
    const memberRows = await db
      .select({ projectId: projectMembers.projectId })
      .from(projectMembers)
      .where(sql`${projectMembers.userId} IN (${sql.join(effectiveUserIds.map((id) => sql`${id}`), sql`, `)})`);
    const memberProjectIds = new Set(memberRows.map((r) => r.projectId));
    
    // We need to fetch the artifact organizations and jira connections to map their IDs
    // to their URLs since sdlcProjects use URLs as the organization identifier sometimes
    const [allAdoOrgs, allJiraConns] = await Promise.all([
      db.select().from(artifactOrganizations),
      db.select().from(jiraConnections)
    ]);
    
    const visibleAdoOrgs = allAdoOrgs.filter(org => visibleOrgIds.has(org.id));
    const visibleJiraConns = allJiraConns.filter(conn => visibleOrgIds.has(conn.id));
    
    const allowedAdoUrls = new Set(visibleAdoOrgs.map(org => {
      return normalizeOrganizationValue(
        org.organizationUrl.replace(/https?:\/\/dev\.azure\.com\//, "").replace(/\/$/, "")
      );
    }));
    
    const allowedJiraConnectionIds = new Set(visibleJiraConns.map(c => c.id));
    
    return allProjects.filter(project => {
      if (
        project.ownerUserId &&
        ownerTenantByUserId.get(project.ownerUserId) &&
        !effectiveTenantIds.has(ownerTenantByUserId.get(project.ownerUserId)!)
      ) {
        return false;
      }

      // 1. The owner is a first-class project attribute.
      if (project.ownerUserId && effectiveUserIdSet.has(project.ownerUserId)) return true;

      // 2. Explicit project membership grants access regardless of organization visibility
      if (memberProjectIds.has(project.id)) return true;

      // 3. Otherwise fall back to organization-level access
      if (project.integrationType === "jira") {
        if (project.jiraConnectionId && allowedJiraConnectionIds.has(project.jiraConnectionId)) return true;
        // Fallback for legacy jira projects
        return visibleJiraConns.some(conn => 
          project.jiraInstanceUrl === conn.instanceUrl || 
          project.jiraInstanceUrl === conn.instanceUrl.replace(/\/+$/, "") ||
          project.jiraInstanceUrl === conn.instanceUrl.replace(/\/+$/, "") + "/"
        );
      } else {
        // ADO branch
        return allowedAdoUrls.has(normalizeOrganizationValue(project.organization || "")) ||
               visibleAdoOrgs.some(org => matchesOrganizationValue(project.organization, org.organizationUrl));
      }
    });
  }

  /**
   * Return SDLC projects scoped to the user's selected organization.
   *
   * The "organization" concept spans two backing stores:
   *   - ADO orgs live in `artifact_organizations`
   *   - Jira orgs live in `jira_connections` (one row per Jira instance)
   *
   * `selected` is the resolved record from
   * `getSelectedGlobalOrganizationFromRequest` (in server/routes.ts). When it
   * is `null` the caller picked "All" → return everything.
   */
  async getAllProjectsForOrganization(
    selected:
      | { id: string; sourceType: "ado" | "jira" }
      | null
      | undefined,
    userId?: string
  ): Promise<SDLCProject[]> {
    if (!selected) return this.getAllProjects(userId);

    let orgProjects: SDLCProject[] = [];

    if (selected.sourceType === "jira") {
      const [conn] = await db
        .select()
        .from(jiraConnections)
        .where(eq(jiraConnections.id, selected.id))
        .limit(1);
      if (!conn) return [];

      const normalisedNoSlash = conn.instanceUrl.replace(/\/+$/, "");
      const withSlash = normalisedNoSlash + "/";
      const allJiraConnections = await db.select().from(jiraConnections);
      const sameInstanceConnectionCount = allJiraConnections.filter((candidate) => {
        const candidateUrl = candidate.instanceUrl.replace(/\/+$/, "").toLowerCase();
        return candidateUrl === normalisedNoSlash.toLowerCase();
      }).length;
      const allowLegacyUrlFallback = sameInstanceConnectionCount <= 1;

      // Match by jiraConnectionId first. URL-only legacy rows are ambiguous when
      // multiple Jira connection records point at the same Atlassian instance,
      // so only use URL fallback when the instance maps to a single connection.
      const jiraScopeConditions = [eq(sdlcProjects.jiraConnectionId, selected.id)];
      if (allowLegacyUrlFallback) {
        jiraScopeConditions.push(
          and(
            sql`${sdlcProjects.jiraConnectionId} IS NULL`,
            or(
              eq(sdlcProjects.jiraInstanceUrl, conn.instanceUrl),
              eq(sdlcProjects.jiraInstanceUrl, normalisedNoSlash),
              eq(sdlcProjects.jiraInstanceUrl, withSlash),
            ),
          )!,
        );
      }

      orgProjects = await db
        .select()
        .from(sdlcProjects)
        .where(
          and(
            eq(sdlcProjects.deletedFromAdo, false),
            eq(sdlcProjects.integrationType, "jira"),
            or(...jiraScopeConditions),
          ),
        );
    } else {
      // ADO branch — match by the org URL OR the extracted org name (legacy
      // rows may have stored either form in sdlc_projects.organization).
      const [adoOrg] = await db
        .select()
        .from(artifactOrganizations)
        .where(eq(artifactOrganizations.id, selected.id))
        .limit(1);
      if (!adoOrg) return [];

      const orgName = adoOrg.organizationUrl
        .replace(/https?:\/\/dev\.azure\.com\//, "")
        .replace(/\/$/, "");

      const adoProjects = await db
        .select()
        .from(sdlcProjects)
        .where(
          and(
            eq(sdlcProjects.deletedFromAdo, false),
            // Exclude Jira-typed rows so the ADO scope is clean.
            sql`${sdlcProjects.integrationType} <> 'jira'`,
          ),
        );

      const normalisedTarget = normalizeOrganizationValue(orgName);
      orgProjects = adoProjects.filter(
        (project) =>
          matchesOrganizationValue(project.organization, normalisedTarget) ||
          matchesOrganizationValue(project.organization, adoOrg.organizationUrl),
      );
    }

    if (!userId) return orgProjects;

    // Filter the organization's projects by what the user is actually allowed to see
    const visibleProjects = await this.getAllProjects(userId);
    const visibleIds = new Set(visibleProjects.map((p) => p.id));
    return orgProjects.filter((p) => visibleIds.has(p.id));
  }

  async getProjectsByOrganization(organizationName: string): Promise<SDLCProject[]> {
    const normalizedOrganizationName = normalizeOrganizationValue(organizationName);

    const projects = await db
      .select()
      .from(sdlcProjects)
      .where(eq(sdlcProjects.deletedFromAdo, false));

    return projects.filter((project) =>
      matchesOrganizationValue(project.organization, normalizedOrganizationName)
    );
  }

  async getProjectByName(name: string): Promise<SDLCProject | undefined> {
    // Filter out projects that are marked as deleted from ADO
    const [project] = await db
      .select()
      .from(sdlcProjects)
      .where(and(
        eq(sdlcProjects.name, name),
        eq(sdlcProjects.deletedFromAdo, false)
      ))
      .limit(1);
    return project;
  }

  async getProjectByAdoProjectId(adoProjectId: string): Promise<SDLCProject | undefined> {
    const [projectByPrimaryId] = await db
      .select()
      .from(sdlcProjects)
      .where(eq(sdlcProjects.id, adoProjectId))
      .limit(1);
    if (projectByPrimaryId) {
      return projectByPrimaryId;
    }

    const [projectByExternalId] = await db
      .select()
      .from(sdlcProjects)
      .where(eq(sdlcProjects.projectId, adoProjectId))
      .limit(1);
    if (projectByExternalId) {
      return projectByExternalId;
    }

    // Check jiraProjectKey for Jira-integrated projects
    const [projectByJiraKey] = await db
      .select()
      .from(sdlcProjects)
      .where(eq(sdlcProjects.jiraProjectKey, adoProjectId))
      .limit(1);
    if (projectByJiraKey) {
      return projectByJiraKey;
    }

    const [projectByName] = await db
      .select()
      .from(sdlcProjects)
      .where(eq(sdlcProjects.name, adoProjectId))
      .limit(1);
    return projectByName;
  }

  /**
   * Look up an SDLC project by a Jira project's external id or key.
   *
   * Used by `GET /api/jira/connection/:connectionId/projects` to decide whether
   * each live Jira project has already been synced into SDLC. The same project
   * key can exist on two different Jira instances, so callers should scope by
   * `opts.jiraConnectionId` (or `opts.jiraInstanceUrl`) to avoid matching a
   * row from a different connection.
   */
  async getProjectByJiraProjectId(
    jiraProjectIdOrKey: string,
    opts?: { jiraConnectionId?: string; jiraInstanceUrl?: string },
  ): Promise<SDLCProject | undefined> {
    if (!jiraProjectIdOrKey) return undefined;

    const value = String(jiraProjectIdOrKey).trim();
    if (!value) return undefined;

    // Match on either the external id (`projectId`) or the human-readable
    // Jira project key (`jiraProjectKey`). Either one might be passed.
    const identifierMatch = or(
      eq(sdlcProjects.projectId, value),
      eq(sdlcProjects.jiraProjectKey, value),
    );

    const conditions = [
      eq(sdlcProjects.integrationType, "jira"),
      eq(sdlcProjects.deletedFromAdo, false),
      identifierMatch,
    ];

    if (opts?.jiraConnectionId) {
      conditions.push(eq(sdlcProjects.jiraConnectionId, opts.jiraConnectionId));
    } else if (opts?.jiraInstanceUrl) {
      const normalised = opts.jiraInstanceUrl.replace(/\/+$/, "");
      conditions.push(
        or(
          eq(sdlcProjects.jiraInstanceUrl, opts.jiraInstanceUrl),
          eq(sdlcProjects.jiraInstanceUrl, normalised),
          eq(sdlcProjects.jiraInstanceUrl, normalised + "/"),
        )!,
      );
    }

    const [match] = await db
      .select()
      .from(sdlcProjects)
      .where(and(...conditions))
      .limit(1);

    return match;
  }
  async getProjectsByAdoProjectIds(adoProjectIds: string[]): Promise<SDLCProject[]> {
    if (adoProjectIds.length === 0) return [];

    return db
      .select()
      .from(sdlcProjects)
      .where(
        and(
          eq(sdlcProjects.deletedFromAdo, false),
          or(
            sql`${sdlcProjects.projectId} IN (${sql.join(
              adoProjectIds.map(id => sql`${id}`),
              sql`, `
            )})`,
            sql`${sdlcProjects.jiraProjectKey} IN (${sql.join(
              adoProjectIds.map(id => sql`${id}`),
              sql`, `
            )})`,
            sql`${sdlcProjects.id} IN (${sql.join(
              adoProjectIds.map(id => sql`${id}`),
              sql`, `
            )})`
          )
        )
      );
  }

  async updateProject(id: string, data: Partial<InsertSDLCProject>): Promise<SDLCProject> {
    await db
      .update(sdlcProjects)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(sdlcProjects.id, id));
    const updated = await db.select().from(sdlcProjects).where(eq(sdlcProjects.id, id)).limit(1);
    if (!updated[0]) {
      throw new Error("Project not found");
    }
    return updated[0];
  }

  async handleJiraProjectUpdate(projectId: string, updateBody: any): Promise<boolean> {
    const sdlcProject = await this.getProjectByAdoProjectId(projectId);

    // If this is a Jira project, handle it separately to avoid ADO organization/PAT checks
    if (sdlcProject?.integrationType === "jira") {
      const {
        name,
        description,
        repositoryId,
        repository_id,
        repositoryCount,
        linkedGoldenRepoOrg,
        linkedGoldenRepoProject,
        linkedGoldenRepoName,
        status,
        golden_repo_reference,
      } = updateBody;

      const updateData: any = {};
      if (name) updateData.name = name;
      if (description !== undefined) updateData.description = description;

      const repoIdToUse = repositoryId !== undefined ? repositoryId : repository_id;
      if (repoIdToUse !== undefined) {
        updateData.repository_id = repoIdToUse || null;
        if (!repoIdToUse) {
          updateData.linkedGoldenRepoOrg = null;
          updateData.linkedGoldenRepoProject = null;
          updateData.linkedGoldenRepoName = null;
        } else {
          if (linkedGoldenRepoOrg !== undefined) updateData.linkedGoldenRepoOrg = linkedGoldenRepoOrg;
          if (linkedGoldenRepoProject !== undefined) updateData.linkedGoldenRepoProject = linkedGoldenRepoProject;
          if (linkedGoldenRepoName !== undefined) updateData.linkedGoldenRepoName = linkedGoldenRepoName;
        }
      }
      if (repositoryCount !== undefined) updateData.repositoryCount = repositoryCount;
      if (status !== undefined) updateData.status = status;

      // Handle golden_repo_reference
      if (golden_repo_reference !== undefined) {
        if (golden_repo_reference && typeof golden_repo_reference === "object") {
          updateData.goldenRepoReference = golden_repo_reference;
        } else {
          updateData.goldenRepoReference = null;
        }
      }

      await this.updateProject(sdlcProject.id, updateData);
      return true;
    }
    
    return false;
  }

  async handleJiraProjectDelete(projectId: string, deleteFromJira: boolean, userId: string): Promise<boolean> {
    const sdlcProject = await this.getProjectByAdoProjectId(projectId);
    if (!sdlcProject || sdlcProject.integrationType !== "jira") {
      return false;
    }

    // 1. Soft delete in database
    await this.updateProject(sdlcProject.id, {
      deletedFromAdo: true,
      status: "deleted",
      updatedAt: new Date()
    } as any);

    // 2. If requested, delete from Jira
    if (deleteFromJira && sdlcProject.jiraProjectKey && (sdlcProject.jiraInstanceUrl || sdlcProject.jiraConnectionId)) {
      try {
        const { getJiraServiceForUser, getAdminJiraServiceForInstance } = await import("../integrations/jira/user-credential-resolver");
        
        let jiraService;
        if (sdlcProject.jiraConnectionId) {
          // If we have a specific connection ID, we can try to get an admin service for that instance
          // We need the instance URL to find the admin connection
          const [conn] = await db.select().from(jiraConnections).where(eq(jiraConnections.id, sdlcProject.jiraConnectionId)).limit(1);
          if (conn && conn.instanceUrl) {
            try {
              jiraService = await getAdminJiraServiceForInstance(conn.instanceUrl);
            } catch (e) {
              console.warn(`[SDLC Service] Could not get admin Jira service, falling back to user service:`, e);
              jiraService = await getJiraServiceForUser(userId, sdlcProject.jiraProjectKey, conn.instanceUrl);
            }
          }
        }

        if (!jiraService && sdlcProject.jiraInstanceUrl) {
          try {
            jiraService = await getAdminJiraServiceForInstance(sdlcProject.jiraInstanceUrl);
          } catch (e) {
            jiraService = await getJiraServiceForUser(userId, sdlcProject.jiraProjectKey, sdlcProject.jiraInstanceUrl);
          }
        }

        if (jiraService) {
          await jiraService.deleteProject(sdlcProject.jiraProjectKey);
        } else {
          console.warn(`[SDLC Service] Could not resolve Jira service for deletion of ${sdlcProject.jiraProjectKey}`);
        }
      } catch (error) {
        console.error(`[SDLC Service] Error deleting project from Jira:`, error);
        // We still consider the DB update a success, but we might want to throw or return info about the failure
        throw error;
      }
    }

    return true;
  }

  async deleteProject(id: string): Promise<void> {
    // NEVER actually delete from database - only mark as deleted (soft delete)
    // This method is kept for backward compatibility but should use updateProject instead
    await db
      .update(sdlcProjects)
      .set({ 
        deletedFromAdo: true, 
        status: "deleted",
        updatedAt: new Date() 
      })
      .where(eq(sdlcProjects.id, id));
  }

  // Phase operations
  async getPhasesByProject(projectId: string): Promise<SDLCPhase[]> {
    return db.select().from(sdlcPhases).where(eq(sdlcPhases.projectId, projectId));
  }

  async getPhase(projectId: string, phaseNumber: number): Promise<SDLCPhase | undefined> {
    const [phase] = await db
      .select()
      .from(sdlcPhases)
      .where(and(eq(sdlcPhases.projectId, projectId), eq(sdlcPhases.phaseNumber, phaseNumber)));
    return phase;
  }

  async updatePhase(
    projectId: string,
    phaseNumber: number,
    data: Partial<Omit<InsertSDLCPhase, "projectId" | "phaseNumber">>
  ): Promise<SDLCPhase> {
    await db
      .update(sdlcPhases)
      .set({ ...data, updatedAt: new Date() })
      .where(and(eq(sdlcPhases.projectId, projectId), eq(sdlcPhases.phaseNumber, phaseNumber)));
    const updated = await db
      .select()
      .from(sdlcPhases)
      .where(and(eq(sdlcPhases.projectId, projectId), eq(sdlcPhases.phaseNumber, phaseNumber)))
      .limit(1);
    if (!updated[0]) {
      throw new Error("Phase not found");
    }
    return updated[0];
  }

  // Get or create default project for demo purposes
  async getOrCreateDefaultProject(): Promise<{ project: SDLCProject; phases: SDLCPhase[] }> {
    let projects = await this.getAllProjects();

    if (projects.length === 0) {
      // Create default project
      const project = await this.createProject({
        name: "My SDLC Project",
        description: "Default project for tracking SDLC phases",
        status: "active",
      });
      const phases = await this.getPhasesByProject(project.id);
      return { project, phases };
    }

    const project = projects[0];
    const phases = await this.getPhasesByProject(project.id);
    return { project, phases };
  }

  // Seed mock projects for demo purposes
  async seedMockProjects(): Promise<SDLCProject[]> {
    const existingProjects = await this.getAllProjects();
    if (existingProjects.length > 0) {
      return existingProjects;
    }

    const mockProjects = [
      {
        id: "e-commerce-platform",
        name: "E-Commerce Platform",
        description: "Full-featured e-commerce platform with payment processing and inventory management",
        status: "active" as const,
        organization: "Acme Corporation",
        repositoryCount: 5,
        cloudProvider: "GitHub",
      },
      {
        id: "mobile-app",
        name: "Mobile App",
        description: "Cross-platform mobile application for iOS and Android",
        status: "active" as const,
        organization: "Tech Innovators",
        repositoryCount: 3,
        cloudProvider: "GitLab",
      },
      {
        id: "analytics-dashboard",
        name: "Analytics Dashboard",
        description: "Real-time analytics and reporting dashboard for business intelligence",
        status: "active" as const,
        organization: "Digital Solutions",
        repositoryCount: 4,
        cloudProvider: "Azure",
      },
      {
        id: "api-gateway",
        name: "API Gateway",
        description: "Centralized API gateway for microservices architecture",
        status: "active" as const,
        organization: "Cloud Systems",
        repositoryCount: 2,
        cloudProvider: "AWS",
      },
      {
        id: "admin-portal",
        name: "Admin Portal",
        description: "Administrative portal for system configuration and user management",
        status: "active" as const,
        organization: "DevOps Masters",
        repositoryCount: 6,
      },
      {
        id: "customer-portal",
        name: "Customer Portal",
        description: "Self-service customer portal for account management and support",
        status: "active" as const,
        organization: "Code Factory",
        repositoryCount: 4,
        cloudProvider: "GitHub",
      },
    ];

    const createdProjects: SDLCProject[] = [];
    for (const projectData of mockProjects) {
      const project = await this.createProject(projectData);

      // Set random progress for each phase
      const phases = await this.getPhasesByProject(project.id);
      for (const phase of phases) {
        const progress = Math.floor(Math.random() * 100);
        const status = progress === 0 ? "not_started" : progress === 100 ? "completed" : "in_progress";
        await this.updatePhase(project.id, phase.phaseNumber, {
          progress,
          status: status as any,
        });
      }

      createdProjects.push(project);
    }

    return createdProjects;
  }

  // Issues operations
  async createIssue(data: InsertSDLCIssue): Promise<SDLCIssue> {
    const id = randomUUID();
    await db.insert(sdlcIssues).values({ ...data, id });
    const inserted = await db.select().from(sdlcIssues).where(eq(sdlcIssues.id, id)).limit(1);
    if (!inserted[0]) {
      throw new Error("Failed to create issue");
    }
    return inserted[0];
  }

  async getIssues(projectId: string, phaseNumber?: number): Promise<SDLCIssue[]> {
    if (phaseNumber !== undefined) {
      return db.select().from(sdlcIssues).where(
        and(
          eq(sdlcIssues.projectId, projectId),
          eq(sdlcIssues.phaseNumber, phaseNumber)
        )
      );
    }
    return db.select().from(sdlcIssues).where(eq(sdlcIssues.projectId, projectId));
  }

  async updateIssue(id: string, data: Partial<InsertSDLCIssue>): Promise<SDLCIssue> {
    await db
      .update(sdlcIssues)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(sdlcIssues.id, id));
    const updated = await db.select().from(sdlcIssues).where(eq(sdlcIssues.id, id)).limit(1);
    if (!updated[0]) {
      throw new Error("Issue not found");
    }
    return updated[0];
  }

  async deleteIssue(id: string): Promise<void> {
    await db.delete(sdlcIssues).where(eq(sdlcIssues.id, id));
  }

  // Epics operations
  async createEpic(data: InsertSDLCEpic): Promise<{ epic: SDLCEpic; unlockInfo: { unlocked: boolean; phaseName?: string } }> {
    const id = randomUUID();
    await db.insert(sdlcEpics).values({ ...data, id });
    const inserted = await db.select().from(sdlcEpics).where(eq(sdlcEpics.id, id)).limit(1);
    if (!inserted[0]) {
      throw new Error("Failed to create epic");
    }
    const epic = inserted[0];
    // Automatically update phase progress and check for unlock
    const unlockInfo = await this.updatePhaseProgressAutomatically(data.projectId, data.phaseNumber);
    return { epic, unlockInfo };
  }

  async getEpics(projectId: string, phaseNumber?: number): Promise<SDLCEpic[]> {
    try {
      if (phaseNumber !== undefined) {
        return await db.select().from(sdlcEpics).where(
          and(
            eq(sdlcEpics.projectId, projectId),
            eq(sdlcEpics.phaseNumber, phaseNumber)
          )
        );
      }
      return await db.select().from(sdlcEpics).where(eq(sdlcEpics.projectId, projectId));
    } catch (error: any) {
      // If acceptance_criteria column doesn't exist, use SQL query that excludes it
      if (error?.code === 'ER_BAD_FIELD_ERROR' && error?.sqlMessage?.includes('acceptance_criteria')) {
        console.warn('[SDLC Service] acceptance_criteria column not found, using fallback SQL query');
        
        // Try with minimal columns only
        try {
          console.warn('[SDLC Service] Column error detected, trying minimal query');
          // Build SQL query string directly for mysql2
          let queryString = `
            SELECT id, project_id, phase_number, title, description, status, priority, 
                   created_at, updated_at
            FROM sdlc_epics
            WHERE project_id = ?
          `;
          const params: any[] = [projectId];
          
          if (phaseNumber !== undefined) {
            queryString += ` AND phase_number = ?`;
            params.push(phaseNumber);
          }
          
          // Use poolConnection directly for raw SQL to get standard mysql2 [rows, fields] format
          const [rows] = await poolConnection.execute(queryString, params) as any;
          
          // Map results to match SDLCEpic type (add null for missing fields)
          return (Array.isArray(rows) ? rows : []).map((row: any) => ({
            ...row,
            acceptanceCriteria: null,
            featureCount: null,
            source: null,
            workflowSessionId: null,
          })) as SDLCEpic[];
        } catch (fallbackError: any) {
          console.warn('[SDLC Service] Minimal query also failed, returning empty array:', fallbackError?.message);
          return [];
        }
      }
      // If it's any column error or table doesn't exist, return empty array
      if (error?.code === 'ER_BAD_FIELD_ERROR' || error?.message?.includes("doesn't exist") || error?.message?.includes("Unknown column")) {
        console.warn('[SDLC Service] Epics table or columns not found, returning empty array');
        return [];
      }
      // If it's a table doesn't exist error, return empty array
      if (error?.code === 'ER_BAD_FIELD_ERROR' || error?.message?.includes("doesn't exist")) {
        console.warn('[SDLC Service] Epics table or columns not found, returning empty array');
        return [];
      }
      throw error;
    }
  }

  async updateEpic(id: string, data: Partial<InsertSDLCEpic>): Promise<SDLCEpic> {
    // Get the original epic to check if phase changed
    const [originalEpic] = await db.select().from(sdlcEpics).where(eq(sdlcEpics.id, id));

    await db
      .update(sdlcEpics)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(sdlcEpics.id, id));
    const updated = await db.select().from(sdlcEpics).where(eq(sdlcEpics.id, id)).limit(1);
    if (!updated[0]) {
      throw new Error("Epic not found");
    }
    const epic = updated[0];

    // If phase changed, update progress for both old and new phases
    if (originalEpic && data.phaseNumber && originalEpic.phaseNumber !== data.phaseNumber) {
      await this.updatePhaseProgressAutomatically(originalEpic.projectId, originalEpic.phaseNumber);
      await this.updatePhaseProgressAutomatically(epic.projectId, epic.phaseNumber);
    } else {
      // Otherwise just update current phase
      await this.updatePhaseProgressAutomatically(epic.projectId, epic.phaseNumber);
    }

    return epic;
  }

  async deleteEpic(id: string): Promise<void> {
    // Get the epic first to know which phase to update
    const [epic] = await db.select().from(sdlcEpics).where(eq(sdlcEpics.id, id));
    await db.delete(sdlcEpics).where(eq(sdlcEpics.id, id));
    // Automatically update phase progress after deletion
    if (epic) {
      await this.updatePhaseProgressAutomatically(epic.projectId, epic.phaseNumber);
    }
  }

  // Features operations
  async createFeature(data: InsertSDLCFeature): Promise<{ feature: SDLCFeature; unlockInfo: { unlocked: boolean; phaseName?: string } }> {
    const id = randomUUID();
    await db.insert(sdlcFeatures).values({ ...data, id });
    const inserted = await db.select().from(sdlcFeatures).where(eq(sdlcFeatures.id, id)).limit(1);
    if (!inserted[0]) {
      throw new Error("Failed to create feature");
    }
    const feature = inserted[0];
    // Automatically update phase progress and check for unlock
    const unlockInfo = await this.updatePhaseProgressAutomatically(data.projectId, data.phaseNumber);
    return { feature, unlockInfo };
  }

  async getFeatures(projectId: string, phaseNumber?: number, epicId?: string): Promise<SDLCFeature[]> {
    let conditions = [eq(sdlcFeatures.projectId, projectId)];
    if (phaseNumber !== undefined) {
      conditions.push(eq(sdlcFeatures.phaseNumber, phaseNumber));
    }
    if (epicId !== undefined) {
      conditions.push(eq(sdlcFeatures.epicId, epicId));
    }
    return db.select().from(sdlcFeatures).where(and(...conditions));
  }

  async updateFeature(id: string, data: Partial<InsertSDLCFeature>): Promise<SDLCFeature> {
    const [originalFeature] = await db.select().from(sdlcFeatures).where(eq(sdlcFeatures.id, id));

    await db
      .update(sdlcFeatures)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(sdlcFeatures.id, id));
    const updated = await db.select().from(sdlcFeatures).where(eq(sdlcFeatures.id, id)).limit(1);
    if (!updated[0]) {
      throw new Error("Feature not found");
    }
    const feature = updated[0];

    if (originalFeature && data.phaseNumber && originalFeature.phaseNumber !== data.phaseNumber) {
      await this.updatePhaseProgressAutomatically(originalFeature.projectId, originalFeature.phaseNumber);
      await this.updatePhaseProgressAutomatically(feature.projectId, feature.phaseNumber);
    } else if (originalFeature) {
      await this.updatePhaseProgressAutomatically(feature.projectId, feature.phaseNumber);
    }

    return feature;
  }

  async deleteFeature(id: string): Promise<void> {
    const [feature] = await db.select().from(sdlcFeatures).where(eq(sdlcFeatures.id, id));
    await db.delete(sdlcFeatures).where(eq(sdlcFeatures.id, id));
    if (feature) {
      await this.updatePhaseProgressAutomatically(feature.projectId, feature.phaseNumber);
    }
  }

  // Requirements operations
  async createRequirement(data: InsertSDLCRequirement): Promise<{ requirement: SDLCRequirement; unlockInfo: { unlocked: boolean; phaseName?: string } }> {
    const id = randomUUID();
    await db.insert(sdlcRequirements).values({ ...data, id });
    const inserted = await db.select().from(sdlcRequirements).where(eq(sdlcRequirements.id, id)).limit(1);
    if (!inserted[0]) {
      throw new Error("Failed to create requirement");
    }
    const requirement = inserted[0];
    // Automatically update phase progress and check for unlock
    const unlockInfo = await this.updatePhaseProgressAutomatically(data.projectId, data.phaseNumber);
    return { requirement, unlockInfo };
  }

  async getRequirements(projectId: string, phaseNumber?: number): Promise<SDLCRequirement[]> {
    try {
      if (phaseNumber !== undefined) {
        return await db.select().from(sdlcRequirements).where(
          and(
            eq(sdlcRequirements.projectId, projectId),
            eq(sdlcRequirements.phaseNumber, phaseNumber)
          )
        );
      }
      return await db.select().from(sdlcRequirements).where(eq(sdlcRequirements.projectId, projectId));
    } catch (error: any) {
      // If brd_id column doesn't exist, use SQL query that excludes it
      if (error?.code === 'ER_BAD_FIELD_ERROR' && error?.sqlMessage?.includes('brd_id')) {
        console.warn('[SDLC Service] brd_id column not found, using fallback SQL query');
        
        // Build SQL query string directly for mysql2
        let queryString = `
          SELECT id, project_id, phase_number, title, description, type, priority, status, 
                 created_at, updated_at
          FROM sdlc_requirements
          WHERE project_id = ?
        `;
        const params: any[] = [projectId];
        
        if (phaseNumber !== undefined) {
          queryString += ` AND phase_number = ?`;
          params.push(phaseNumber);
        }
        
        // Use poolConnection directly for raw SQL to get standard mysql2 [rows, fields] format
        const [rows] = await poolConnection.execute(queryString, params) as any;
        
        // Map results to match SDLCRequirement type (add null for missing fields)
        return (Array.isArray(rows) ? rows : []).map((row: any) => ({
          ...row,
          brdId: null,
          requirementId: null,
        })) as SDLCRequirement[];
      }
      // If it's a table doesn't exist error, return empty array
      if (error?.code === 'ER_BAD_FIELD_ERROR' || error?.message?.includes("doesn't exist")) {
        console.warn('[SDLC Service] Requirements table or columns not found, returning empty array');
        return [];
      }
      throw error;
    }
  }

  async updateRequirement(id: string, data: Partial<InsertSDLCRequirement>): Promise<SDLCRequirement> {
    // Get the original requirement to check if phase changed
    const [originalReq] = await db.select().from(sdlcRequirements).where(eq(sdlcRequirements.id, id));

    await db
      .update(sdlcRequirements)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(sdlcRequirements.id, id));
    const updated = await db.select().from(sdlcRequirements).where(eq(sdlcRequirements.id, id)).limit(1);
    if (!updated[0]) {
      throw new Error("Requirement not found");
    }
    const requirement = updated[0];

    // If phase changed, update progress for both old and new phases
    if (originalReq && data.phaseNumber && originalReq.phaseNumber !== data.phaseNumber) {
      await this.updatePhaseProgressAutomatically(originalReq.projectId, originalReq.phaseNumber);
      await this.updatePhaseProgressAutomatically(requirement.projectId, requirement.phaseNumber);
    } else {
      // Otherwise just update current phase
      await this.updatePhaseProgressAutomatically(requirement.projectId, requirement.phaseNumber);
    }

    return requirement;
  }

  async deleteRequirement(id: string): Promise<void> {
    // Get the requirement first to know which phase to update
    const [requirement] = await db.select().from(sdlcRequirements).where(eq(sdlcRequirements.id, id));
    await db.delete(sdlcRequirements).where(eq(sdlcRequirements.id, id));
    // Automatically update phase progress after deletion
    if (requirement) {
      await this.updatePhaseProgressAutomatically(requirement.projectId, requirement.phaseNumber);
    }
  }

  // Backlog items operations
  async createBacklogItem(data: InsertSDLCBacklogItem): Promise<{ backlogItem: SDLCBacklogItem; unlockInfo: { unlocked: boolean; phaseName?: string } }> {
    const id = randomUUID();
    // Ensure acceptanceCriteria is properly typed as an array or null
    const insertData: any = { ...data, id };
    if (insertData.acceptanceCriteria && !Array.isArray(insertData.acceptanceCriteria)) {
      insertData.acceptanceCriteria = null;
    }
    await db.insert(sdlcBacklogItems).values(insertData);
    const inserted = await db.select().from(sdlcBacklogItems).where(eq(sdlcBacklogItems.id, id)).limit(1);
    if (!inserted[0]) {
      throw new Error("Failed to create backlog item");
    }
    const item = inserted[0];
    // Automatically update phase progress and check for unlock
    const unlockInfo = await this.updatePhaseProgressAutomatically(data.projectId, data.phaseNumber);
    return { backlogItem: item, unlockInfo };
  }

  async getBacklogItems(projectId: string, phaseNumber?: number): Promise<SDLCBacklogItem[]> {
    try {
      if (phaseNumber !== undefined) {
        return await db.select().from(sdlcBacklogItems).where(
          and(
            eq(sdlcBacklogItems.projectId, projectId),
            eq(sdlcBacklogItems.phaseNumber, phaseNumber)
          )
        );
      }
      return await db.select().from(sdlcBacklogItems).where(eq(sdlcBacklogItems.projectId, projectId));
    } catch (error: any) {
      // If feature_id or epic_id columns don't exist, use SQL query that excludes them
      // But also check for other missing columns and use minimal query
      if (error?.code === 'ER_BAD_FIELD_ERROR') {
        // This will be handled by the more general fallback below
      }
      // If it's a column error, try progressively simpler queries
      if (error?.code === 'ER_BAD_FIELD_ERROR') {
        // Try with minimal columns only
        try {
          console.warn('[SDLC Service] Column error detected, trying minimal query');
          // Build SQL query string directly for mysql2
          let queryString = `
            SELECT id, project_id, phase_number, title, description, type, 
                   priority, status, created_at, updated_at
            FROM sdlc_backlog_items
            WHERE project_id = ?
          `;
          const params: any[] = [projectId];
          
          if (phaseNumber !== undefined) {
            queryString += ` AND phase_number = ?`;
            params.push(phaseNumber);
          }
          
          // Use poolConnection directly for raw SQL to get standard mysql2 [rows, fields] format
          const [rows] = await poolConnection.execute(queryString, params) as any;
          
          return (Array.isArray(rows) ? rows : []).map((row: any) => ({
            ...row,
            storyPoints: null,
            assignedTo: null,
            featureId: null,
            epicId: null,
            figmaLink: null,
            persona: null,
            personaId: null,
            acceptanceCriteria: null,
            subtasks: null,
            source: null,
            workflowSessionId: null,
            brdId: null,
            requirementId: null,
          })) as SDLCBacklogItem[];
        } catch (fallbackError: any) {
          console.warn('[SDLC Service] Minimal query also failed, returning empty array:', fallbackError?.message);
          return [];
        }
      }
      // If it's any column error or table doesn't exist, return empty array
      if (error?.code === 'ER_BAD_FIELD_ERROR' || error?.message?.includes("doesn't exist") || error?.message?.includes("Unknown column")) {
        console.warn('[SDLC Service] Backlog items table or columns not found, returning empty array');
        return [];
      }
      // For any other error, return empty array instead of throwing
      console.warn('[SDLC Service] Error fetching backlog items, returning empty array:', error?.message);
      return [];
    }
  }

  async updateBacklogItem(id: string, data: Partial<InsertSDLCBacklogItem>): Promise<SDLCBacklogItem> {
    // Get the original item to check if phase changed
    const [originalItem] = await db.select().from(sdlcBacklogItems).where(eq(sdlcBacklogItems.id, id));

    // Ensure acceptanceCriteria is properly typed as an array or null/undefined
    const updateData: any = { ...data, updatedAt: new Date() };
    if (updateData.acceptanceCriteria !== undefined && !Array.isArray(updateData.acceptanceCriteria)) {
      updateData.acceptanceCriteria = null;
    }

    await db
      .update(sdlcBacklogItems)
      .set(updateData)
      .where(eq(sdlcBacklogItems.id, id));
    const updated = await db.select().from(sdlcBacklogItems).where(eq(sdlcBacklogItems.id, id)).limit(1);
    if (!updated[0]) {
      throw new Error("Backlog item not found");
    }
    const item = updated[0];

    // If phase changed, update progress for both old and new phases
    if (originalItem && data.phaseNumber && originalItem.phaseNumber !== data.phaseNumber) {
      await this.updatePhaseProgressAutomatically(originalItem.projectId, originalItem.phaseNumber);
      await this.updatePhaseProgressAutomatically(item.projectId, item.phaseNumber);
    } else {
      // Otherwise just update current phase
      await this.updatePhaseProgressAutomatically(item.projectId, item.phaseNumber);
    }

    return item;
  }

  async deleteBacklogItem(id: string): Promise<void> {
    // Get the item first to know which phase to update
    const [item] = await db.select().from(sdlcBacklogItems).where(eq(sdlcBacklogItems.id, id));
    await db.delete(sdlcBacklogItems).where(eq(sdlcBacklogItems.id, id));
    // Automatically update phase progress after deletion
    if (item) {
      await this.updatePhaseProgressAutomatically(item.projectId, item.phaseNumber);
    }
  }

  // Documents operations
  async createDocument(data: InsertSDLCDocument): Promise<{ document: SDLCDocument; unlockInfo: { unlocked: boolean; phaseName?: string } }> {
    const id = randomUUID();
    await db.insert(sdlcDocuments).values({ ...data, id });
    const inserted = await db.select().from(sdlcDocuments).where(eq(sdlcDocuments.id, id)).limit(1);
    if (!inserted[0]) {
      throw new Error("Failed to create document");
    }
    const doc = inserted[0];
    // Automatically update phase progress and check for unlock
    const unlockInfo = await this.updatePhaseProgressAutomatically(data.projectId, data.phaseNumber);
    return { document: doc, unlockInfo };
  }

  async getDocuments(projectId: string, phaseNumber?: number): Promise<SDLCDocument[]> {
    try {
      if (phaseNumber !== undefined) {
        return await db.select().from(sdlcDocuments).where(
          and(
            eq(sdlcDocuments.projectId, projectId),
            eq(sdlcDocuments.phaseNumber, phaseNumber)
          )
        );
      }
      return await db.select().from(sdlcDocuments).where(eq(sdlcDocuments.projectId, projectId));
    } catch (error: any) {
      // If brd_id column doesn't exist, use SQL query that excludes it
      if (error?.code === 'ER_BAD_FIELD_ERROR' && error?.sqlMessage?.includes('brd_id')) {
        console.warn('[SDLC Service] brd_id column not found in documents, using fallback SQL query');
        
        // Build SQL query string directly for mysql2
        let queryString = `
          SELECT id, project_id, phase_number, title, content, type, 
                 created_at, updated_at
          FROM sdlc_documents
          WHERE project_id = ?
        `;
        const params: any[] = [projectId];
        
        if (phaseNumber !== undefined) {
          queryString += ` AND phase_number = ?`;
          params.push(phaseNumber);
        }
        
        // Use poolConnection directly for raw SQL to get standard mysql2 [rows, fields] format
        const [rows] = await poolConnection.execute(queryString, params) as any;
        
        // Map results to match SDLCDocument type (add null for missing fields)
        return (Array.isArray(rows) ? rows : []).map((row: any) => ({
          ...row,
          brdId: null,
          requirementId: null,
        })) as SDLCDocument[];
      }
      // If it's any column error or table doesn't exist, return empty array
      if (error?.code === 'ER_BAD_FIELD_ERROR' || error?.message?.includes("doesn't exist") || error?.message?.includes("Unknown column")) {
        console.warn('[SDLC Service] Documents table or columns not found, returning empty array');
        return [];
      }
      // For any other error, return empty array instead of throwing
      console.warn('[SDLC Service] Error fetching documents, returning empty array:', error?.message);
      return [];
    }
  }

  async updateDocument(id: string, data: Partial<InsertSDLCDocument>): Promise<SDLCDocument> {
    // Get the original document to check if phase changed
    const [originalDoc] = await db.select().from(sdlcDocuments).where(eq(sdlcDocuments.id, id));

    await db
      .update(sdlcDocuments)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(sdlcDocuments.id, id));
    const updated = await db.select().from(sdlcDocuments).where(eq(sdlcDocuments.id, id)).limit(1);
    if (!updated[0]) {
      throw new Error("Document not found");
    }
    const doc = updated[0];

    // If phase changed, update progress for both old and new phases
    if (originalDoc && data.phaseNumber && originalDoc.phaseNumber !== data.phaseNumber) {
      await this.updatePhaseProgressAutomatically(originalDoc.projectId, originalDoc.phaseNumber);
      await this.updatePhaseProgressAutomatically(doc.projectId, doc.phaseNumber);
    } else {
      // Otherwise just update current phase
      await this.updatePhaseProgressAutomatically(doc.projectId, doc.phaseNumber);
    }

    return doc;
  }

  async deleteDocument(id: string): Promise<void> {
    // Get the document first to know which phase to update
    const [doc] = await db.select().from(sdlcDocuments).where(eq(sdlcDocuments.id, id));
    await db.delete(sdlcDocuments).where(eq(sdlcDocuments.id, id));
    // Automatically update phase progress after deletion
    if (doc) {
      await this.updatePhaseProgressAutomatically(doc.projectId, doc.phaseNumber);
    }
  }

  // Phase Confirmation operations
  async getConfirmationsByPhaseId(phaseId: string): Promise<PhaseConfirmation[]> {
    return db.select().from(phaseConfirmations).where(eq(phaseConfirmations.phaseId, phaseId));
  }

  async createConfirmation(data: InsertPhaseConfirmation): Promise<PhaseConfirmation> {
    const id = randomUUID();
    await db.insert(phaseConfirmations).values({ ...data, id });
    const inserted = await db.select().from(phaseConfirmations).where(eq(phaseConfirmations.id, id)).limit(1);
    if (!inserted[0]) {
      throw new Error("Failed to create confirmation");
    }
    return inserted[0];
  }

  async updateConfirmation(
    id: string,
    data: Partial<InsertPhaseConfirmation>
  ): Promise<PhaseConfirmation> {
    await db
      .update(phaseConfirmations)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(phaseConfirmations.id, id));
    const updated = await db.select().from(phaseConfirmations).where(eq(phaseConfirmations.id, id)).limit(1);
    if (!updated[0]) {
      throw new Error("Confirmation not found");
    }
    const confirmation = updated[0];

    // Check if phase is ready for automatic progression after confirmation update
    await this.checkAndUnlockNextPhase(confirmation.phaseId);

    return confirmation;
  }

  // Automatically unlock next phase if current phase meets progression criteria
  async checkAndUnlockNextPhase(phaseId: string): Promise<{ unlocked: boolean; phaseName?: string }> {
    // Get the current phase to check progress
    const [phase] = await db
      .select()
      .from(sdlcPhases)
      .where(eq(sdlcPhases.id, phaseId));

    if (!phase) {
      return { unlocked: false };
    }

    // Check if progress is at least 80% (confirmation requirements removed for simpler unlocking)
    if ((phase.progress || 0) < 80) {
      return { unlocked: false }; // Not ready, do nothing
    }

    // Get the next phase
    const nextPhaseNumber = phase.phaseNumber + 1;

    // Only unlock if next phase exists (phaseNumber 2-6)
    if (nextPhaseNumber > 6) {
      return { unlocked: false }; // No next phase to unlock
    }

    const [nextPhase] = await db
      .select()
      .from(sdlcPhases)
      .where(
        and(
          eq(sdlcPhases.projectId, phase.projectId),
          eq(sdlcPhases.phaseNumber, nextPhaseNumber)
        )
      );

    if (nextPhase) {
      // Check if phase was previously locked (to avoid showing toast multiple times)
      const wasLocked = nextPhase.status === "not_started" && nextPhase.progress === 0 && nextPhase.phaseNumber > 1;

      // Unlock the next phase by setting its status
      await this.updatePhase(phase.projectId, nextPhaseNumber, {
        status: "not_started", // Unlock it (it was locked before)
      });

      // Return unlock info only if it was actually locked before
      return {
        unlocked: wasLocked,
        phaseName: nextPhase.phaseName
      };
    }

    return { unlocked: false };
  }

  async initializePhaseConfirmations(phaseId: string): Promise<PhaseConfirmation[]> {
    const roles = ["business", "technical", "qa"];
    const confirmations: PhaseConfirmation[] = [];

    for (const role of roles) {
      const id = randomUUID();
      await db.insert(phaseConfirmations).values({
        id,
        phaseId,
        confirmerRole: role,
        status: "pending",
      });
      const inserted = await db.select().from(phaseConfirmations).where(eq(phaseConfirmations.id, id)).limit(1);
      if (!inserted[0]) {
        throw new Error("Failed to create phase confirmation");
      }
      confirmations.push(inserted[0]);
    }

    return confirmations;
  }

  // Get category completion status for a phase
  async getCategoryCompletionStatus(projectId: string, phaseNumber: number): Promise<{
    hasIssues: boolean;
    hasEpics: boolean;
    hasRequirements: boolean;
    hasBacklog: boolean;
    hasDocuments: boolean;
  }> {
    // console.log(`[DEBUG] getCategoryCompletionStatus called for projectId: ${projectId}, phaseNumber: ${phaseNumber}`);

    // Count work items in each category
    const [issuesCount] = await db
      .select({ count: count() })
      .from(sdlcIssues)
      .where(and(eq(sdlcIssues.projectId, projectId), eq(sdlcIssues.phaseNumber, phaseNumber)));

    const [epicsCount] = await db
      .select({ count: count() })
      .from(sdlcEpics)
      .where(and(eq(sdlcEpics.projectId, projectId), eq(sdlcEpics.phaseNumber, phaseNumber)));

    const [requirementsCount] = await db
      .select({ count: count() })
      .from(sdlcRequirements)
      .where(and(eq(sdlcRequirements.projectId, projectId), eq(sdlcRequirements.phaseNumber, phaseNumber)));

    const [backlogCount] = await db
      .select({ count: count() })
      .from(sdlcBacklogItems)
      .where(and(eq(sdlcBacklogItems.projectId, projectId), eq(sdlcBacklogItems.phaseNumber, phaseNumber)));

    const [documentsCount] = await db
      .select({ count: count() })
      .from(sdlcDocuments)
      .where(and(eq(sdlcDocuments.projectId, projectId), eq(sdlcDocuments.phaseNumber, phaseNumber)));

    // console.log(`[DEBUG] Category counts - Issues: ${issuesCount?.count}, Epics: ${epicsCount?.count}, Requirements: ${requirementsCount?.count}, Backlog: ${backlogCount?.count}, Documents: ${documentsCount?.count}`);

    const result = {
      hasIssues: (Number(issuesCount?.count) || 0) > 0,
      hasEpics: (Number(epicsCount?.count) || 0) > 0,
      hasRequirements: (Number(requirementsCount?.count) || 0) > 0,
      hasBacklog: (Number(backlogCount?.count) || 0) > 0,
      hasDocuments: (Number(documentsCount?.count) || 0) > 0,
    };

    // console.log(`[DEBUG] Category completion result:`, result);

    return result;
  }

  // Calculate phase progress based on category completion (5 categories, each = 20%)
  async calculatePhaseProgress(projectId: string, phaseNumber: number): Promise<number> {
    // Design phase (phase 2) has special progress calculation based on synced design elements
    // Progress is based on 4 design categories: System Architecture, Database Design, UI/UX Design,
    // Component Design (each = 25%)
    if (phaseNumber === 2) {
      const [designAssets] = await db
        .select()
        .from(adoDesignSync)
        .where(eq(adoDesignSync.projectId, projectId));

      if (!designAssets) {
        console.log(`[DEBUG] Design phase progress: No synced design assets found = 0%`);
        return 0;
      }

      // Count how many design categories have synced data
      const categories = ['System Architecture', 'Database Design', 'UI/UX Design', 'Component Design'];
      let syncedCategories = 0;

      for (const category of categories) {
        const metadata = (designAssets as any).syncedMetadata;
        if (metadata && metadata[category] && Array.isArray(metadata[category]) && metadata[category].length > 0) {
          syncedCategories++;
        }
      }

      // Each category contributes 25% to progress (4 categories total)
      const progress = Math.round((syncedCategories / 4) * 100);
      console.log(`[DEBUG] Design phase progress: ${syncedCategories}/4 categories synced = ${progress}%`);
      return progress;
    }

    // Development phase (phase 3) has special progress calculation
    // The phase is interactive and simulated in the frontend (repository creation, code generation, etc.)
    // Since this is a simulated workflow that's always available, Development phase is always 100% complete
    if (phaseNumber === 3) {
      console.log(`[DEBUG] Development phase progress: Simulated interactive workflow = 100%`);
      return 100;
    }

    // For other phases, use the standard 5-category system
    const categoryStatus = await this.getCategoryCompletionStatus(projectId, phaseNumber);

    // Count how many categories have at least 1 item
    let completedCategories = 0;
    if (categoryStatus.hasIssues) completedCategories++;
    if (categoryStatus.hasEpics) completedCategories++;
    if (categoryStatus.hasRequirements) completedCategories++;
    if (categoryStatus.hasBacklog) completedCategories++;
    if (categoryStatus.hasDocuments) completedCategories++;

    // Each category contributes 20% to progress (5 categories total)
    const progress = (completedCategories / 5) * 100;

    return progress;
  }

  // Update phase progress automatically after work item changes
  async updatePhaseProgressAutomatically(projectId: string, phaseNumber: number): Promise<{ unlocked: boolean; phaseName?: string }> {
    const progress = await this.calculatePhaseProgress(projectId, phaseNumber);

    // Determine status based on progress
    let status: "not_started" | "in_progress" | "completed" = "not_started";
    if (progress > 0 && progress < 100) {
      status = "in_progress";
    } else if (progress === 100) {
      status = "completed";
    }

    // Update the phase
    const phase = await this.updatePhase(projectId, phaseNumber, { progress, status });

    // Check if this phase is now ready to unlock the next phase
    if (phase?.id) {
      return await this.checkAndUnlockNextPhase(phase.id);
    }

    return { unlocked: false };
  }

  async checkPhaseReadyForProgression(phaseId: string): Promise<{ ready: boolean; progress?: number; confirmationsApproved?: number }> {
    // Get the phase to check progress
    const [phase] = await db
      .select()
      .from(sdlcPhases)
      .where(eq(sdlcPhases.id, phaseId));

    if (!phase) {
      return { ready: false };
    }

    // Check if progress is at least 80%
    const progressCheck = (phase.progress || 0) >= 80;

    // Get confirmations
    const confirmations = await this.getConfirmationsByPhaseId(phaseId);

    if (confirmations.length !== 3) {
      return {
        ready: false,
        progress: phase.progress || 0,
        confirmationsApproved: confirmations.filter(c => c.status === "approved").length
      };
    }

    // Check if all confirmations are approved
    const confirmationsCheck = confirmations.every(c => c.status === "approved");

    return {
      ready: progressCheck && confirmationsCheck,
      progress: phase.progress || 0,
      confirmationsApproved: confirmations.filter(c => c.status === "approved").length
    };
  }

  // Design Assets operations
  async createDesignAsset(data: InsertSDLCDesignAsset): Promise<SDLCDesignAsset> {
    const id = randomUUID();
    await db.insert(sdlcDesignAssets).values({ ...data, id });
    const inserted = await db.select().from(sdlcDesignAssets).where(eq(sdlcDesignAssets.id, id)).limit(1);
    if (!inserted[0]) {
      throw new Error("Failed to create design asset");
    }
    return inserted[0];
  }

  async getDesignAssets(projectId: string, phaseNumber?: number): Promise<SDLCDesignAsset[]> {
    if (phaseNumber !== undefined) {
      return db
        .select()
        .from(sdlcDesignAssets)
        .where(and(eq(sdlcDesignAssets.projectId, projectId), eq(sdlcDesignAssets.phaseNumber, phaseNumber)))
        .orderBy(sdlcDesignAssets.createdAt);
    }
    return db
      .select()
      .from(sdlcDesignAssets)
      .where(eq(sdlcDesignAssets.projectId, projectId))
      .orderBy(sdlcDesignAssets.createdAt);
  }

  async getDesignAsset(id: string): Promise<SDLCDesignAsset | undefined> {
    const [asset] = await db.select().from(sdlcDesignAssets).where(eq(sdlcDesignAssets.id, id));
    return asset;
  }

  async updateDesignAsset(id: string, data: Partial<InsertSDLCDesignAsset>): Promise<SDLCDesignAsset> {
    await db
      .update(sdlcDesignAssets)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(sdlcDesignAssets.id, id));
    const updated = await db.select().from(sdlcDesignAssets).where(eq(sdlcDesignAssets.id, id)).limit(1);
    if (!updated[0]) {
      throw new Error("Design asset not found");
    }
    return updated[0];
  }

  async deleteDesignAsset(id: string): Promise<void> {
    await db.delete(sdlcDesignAssets).where(eq(sdlcDesignAssets.id, id));
  }

  // Sync documents from Requirement & Analysis phase to Design Assets
  async syncDocumentsToDesignAssets(projectId: string): Promise<{ syncedCount: number; assets: SDLCDesignAsset[] }> {
    // Get all documents from phase 1 (Requirement & Analysis)
    const requirementDocs = await this.getDocuments(projectId, 1);

    // Get existing synced design assets to avoid duplicates
    const existingAssets = await this.getDesignAssets(projectId, 2);
    const existingSyncedDocIds = new Set(
      existingAssets
        .filter(asset => asset.sourceDocumentId)
        .map(asset => asset.sourceDocumentId)
    );

    const newAssets: SDLCDesignAsset[] = [];

    // Create design assets for documents that haven't been synced yet
    for (const doc of requirementDocs) {
      if (!existingSyncedDocIds.has(doc.id)) {
        // Convert document content to a data URL for storage
        const contentDataUrl = `data:text/plain;charset=utf-8;base64,${Buffer.from(doc.content || '').toString('base64')}`;

        // Determine file type based on document type
        const fileTypeMap: Record<string, string> = {
          'general': 'application/pdf',
          'technical': 'application/pdf',
          'user_guide': 'application/pdf',
          'api_doc': 'application/pdf',
        };

        const asset = await this.createDesignAsset({
          projectId,
          phaseNumber: 2, // Design phase
          name: doc.title,
          description: `Synced from Requirement & Analysis phase`,
          fileUrl: contentDataUrl,
          fileType: fileTypeMap[doc.type] || 'application/pdf',
          fileSize: (doc.content || '').length,
          thumbnailUrl: null,
          uploadedBy: 'System',
          source: 'synced_from_requirement',
          sourceDocumentId: doc.id,
        });

        newAssets.push(asset);
      }
    }

    // Update Design phase progress after syncing
    await this.updatePhaseProgressAutomatically(projectId, 2);

    return { syncedCount: newAssets.length, assets: newAssets };
  }

  // Figma Links operations
  async createFigmaLink(data: InsertSDLCFigmaLink): Promise<SDLCFigmaLink> {
    const id = randomUUID();
    await db.insert(sdlcFigmaLinks).values({ ...data, id });
    const inserted = await db.select().from(sdlcFigmaLinks).where(eq(sdlcFigmaLinks.id, id)).limit(1);
    if (!inserted[0]) {
      throw new Error("Failed to create Figma link");
    }
    return inserted[0];
  }

  async getFigmaLinks(projectId: string, phaseNumber?: number): Promise<SDLCFigmaLink[]> {
    if (phaseNumber !== undefined) {
      return db
        .select()
        .from(sdlcFigmaLinks)
        .where(and(eq(sdlcFigmaLinks.projectId, projectId), eq(sdlcFigmaLinks.phaseNumber, phaseNumber)))
        .orderBy(sdlcFigmaLinks.createdAt);
    }
    return db
      .select()
      .from(sdlcFigmaLinks)
      .where(eq(sdlcFigmaLinks.projectId, projectId))
      .orderBy(sdlcFigmaLinks.createdAt);
  }

  async getFigmaLink(id: string): Promise<SDLCFigmaLink | undefined> {
    const [link] = await db.select().from(sdlcFigmaLinks).where(eq(sdlcFigmaLinks.id, id));
    return link;
  }

  async updateFigmaLink(id: string, data: Partial<InsertSDLCFigmaLink>): Promise<SDLCFigmaLink> {
    await db
      .update(sdlcFigmaLinks)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(sdlcFigmaLinks.id, id));
    const updated = await db.select().from(sdlcFigmaLinks).where(eq(sdlcFigmaLinks.id, id)).limit(1);
    if (!updated[0]) {
      throw new Error("Figma link not found");
    }
    return updated[0];
  }

  async deleteFigmaLink(id: string): Promise<void> {
    await db.delete(sdlcFigmaLinks).where(eq(sdlcFigmaLinks.id, id));
  }

  // Design Reviews operations
  async createDesignReview(data: InsertSDLCDesignReview): Promise<SDLCDesignReview> {
    const id = randomUUID();
    await db.insert(sdlcDesignReviews).values({ ...data, id });
    const inserted = await db.select().from(sdlcDesignReviews).where(eq(sdlcDesignReviews.id, id)).limit(1);
    if (!inserted[0]) {
      throw new Error("Failed to create design review");
    }
    return inserted[0];
  }

  async getDesignReviews(projectId: string, phaseNumber?: number): Promise<SDLCDesignReview[]> {
    if (phaseNumber !== undefined) {
      return db
        .select()
        .from(sdlcDesignReviews)
        .where(and(eq(sdlcDesignReviews.projectId, projectId), eq(sdlcDesignReviews.phaseNumber, phaseNumber)))
        .orderBy(sdlcDesignReviews.createdAt);
    }
    return db
      .select()
      .from(sdlcDesignReviews)
      .where(eq(sdlcDesignReviews.projectId, projectId))
      .orderBy(sdlcDesignReviews.createdAt);
  }

  async getDesignReview(id: string): Promise<SDLCDesignReview | undefined> {
    const [review] = await db.select().from(sdlcDesignReviews).where(eq(sdlcDesignReviews.id, id));
    return review;
  }

  async updateDesignReview(id: string, data: Partial<InsertSDLCDesignReview>): Promise<SDLCDesignReview> {
    await db
      .update(sdlcDesignReviews)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(sdlcDesignReviews.id, id));
    const updated = await db.select().from(sdlcDesignReviews).where(eq(sdlcDesignReviews.id, id)).limit(1);
    if (!updated[0]) {
      throw new Error("Design review not found");
    }
    return updated[0];
  }

  async deleteDesignReview(id: string): Promise<void> {
    await db.delete(sdlcDesignReviews).where(eq(sdlcDesignReviews.id, id));
  }

  // ADO Design Sync operations
  async getAdoDesignSync(projectId: string): Promise<AdoDesignSync | undefined> {
    const [sync] = await db
      .select()
      .from(adoDesignSync)
      .where(and(eq(adoDesignSync.projectId, projectId), eq(adoDesignSync.phaseNumber, 2)))
      .limit(1);
    return sync;
  }

  async createAdoDesignSync(data: InsertAdoDesignSync): Promise<AdoDesignSync> {
    const id = randomUUID();
    await db.insert(adoDesignSync).values({ ...data, id });
    const inserted = await db.select().from(adoDesignSync).where(eq(adoDesignSync.id, id)).limit(1);
    if (!inserted[0]) {
      throw new Error("Failed to create ADO design sync record");
    }
    return inserted[0];
  }

  async updateAdoDesignSync(id: string, data: Partial<InsertAdoDesignSync>): Promise<AdoDesignSync> {
    await db
      .update(adoDesignSync)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(adoDesignSync.id, id));
    const updated = await db.select().from(adoDesignSync).where(eq(adoDesignSync.id, id)).limit(1);
    if (!updated[0]) {
      throw new Error("ADO design sync record not found");
    }
    return updated[0];
  }

  async createDesignAssetFromAdo(
    projectId: string,
    phaseNumber: number,
    name: string,
    description: string | null,
    category: string,
    adoWorkItemId: number
  ): Promise<SDLCDesignAsset> {
    const id = randomUUID();

    // Create a placeholder file URL (in a real implementation, this would be a document or diagram)
    const fileUrl = `data:text/plain;base64,${Buffer.from(description || name).toString('base64')}`;

    await db.insert(sdlcDesignAssets).values({
      id,
      projectId,
      phaseNumber,
      name,
      description,
      fileUrl,
      fileType: 'text/plain',
      fileSize: (description || name).length,
      uploadedBy: 'ADO Sync',
      source: 'ado-sync',
      designCategory: category,
      adoWorkItemId,
      adoSyncedAt: new Date(),
    });

    const inserted = await db.select().from(sdlcDesignAssets).where(eq(sdlcDesignAssets.id, id)).limit(1);
    if (!inserted[0]) {
      throw new Error("Failed to create design asset from ADO");
    }
    return inserted[0];
  }

  async syncDesignFromAdo(
    projectId: string,
    categorizedWorkItems: {
      systemArchitecture: any[];
      databaseDesign: any[];
      uiUxDesign: any[];
      componentDesign: any[];
      dataFlowDesign: any[];
      interfaceDesign: any[];
      securityDesign: any[];
    }
  ): Promise<{ syncedCount: number; errors: string[] }> {
    const errors: string[] = [];
    let syncedCount = 0;

    const categoryMapping: Record<string, string> = {
      systemArchitecture: 'system-architecture',
      databaseDesign: 'database-design',
      uiUxDesign: 'ui-ux-design',
      componentDesign: 'component-design',
      dataFlowDesign: 'data-flow-design',
      interfaceDesign: 'interface-design',
      securityDesign: 'security-design',
    };

    try {
      for (const [category, workItems] of Object.entries(categorizedWorkItems)) {
        const designCategory = categoryMapping[category];

        for (const workItem of workItems) {
          try {
            const workItemId = workItem.id;
            const title = workItem.fields?.['System.Title'] || 'Untitled';
            const description = workItem.fields?.['System.Description'] || null;

            // Check if this work item is already synced
            const existing = await db
              .select()
              .from(sdlcDesignAssets)
              .where(and(
                eq(sdlcDesignAssets.projectId, projectId),
                eq(sdlcDesignAssets.adoWorkItemId, workItemId)
              ))
              .limit(1);

            if (existing.length === 0) {
              // Create new design asset
              await this.createDesignAssetFromAdo(
                projectId,
                2, // Design Phase
                title,
                description,
                designCategory,
                workItemId
              );
              syncedCount++;
            } else {
              // Update existing design asset
              await db
                .update(sdlcDesignAssets)
                .set({
                  name: title,
                  description,
                  adoSyncedAt: new Date(),
                  updatedAt: new Date(),
                })
                .where(eq(sdlcDesignAssets.id, existing[0].id));
              syncedCount++;
            }
          } catch (error) {
            const errorMsg = error instanceof Error ? error.message : 'Unknown error';
            errors.push(`Failed to sync work item ${workItem.id}: ${errorMsg}`);
            console.error(`[ADO Sync] Error syncing work item ${workItem.id}:`, error);
          }
        }
      }

      return { syncedCount, errors };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      errors.push(`Sync failed: ${errorMsg}`);
      return { syncedCount, errors };
    }
  }
}

export const sdlcService = new SDLCService();
