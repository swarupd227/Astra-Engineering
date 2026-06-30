import { type User, type InsertUser, type AdoSettings, type InsertAdoSettings, type ArtifactOrganization, type InsertArtifactOrganization, type WikiPage, type InsertWikiPage, type GoldenRepoOrganization, type InsertGoldenRepoOrganization, type Organization, type InsertOrganization, type Project, type InsertProject, type Persona, type InsertPersona, type Prompt, type InsertPrompt } from "@shared/schema";
import { randomUUID } from "crypto";
import { db } from "./db";
import { adoSettings, artifactOrganizations, wikiPages, goldenRepoOrganizations, organizations, projects, organizationMembers, projectMembers, goldenRepositories, sdlcProjects, sdlcPhases, sdlcIssues, sdlcEpics, sdlcFeatures, sdlcRequirements, sdlcBacklogItems, sdlcDocuments, sdlcDesignAssets, devBrdDocuments, devBrdRequirements, workflowArtifacts, workflowTestCases, testPlanDocuments, designGuidelines, developmentRepositories, developmentBranches, sdlcCode, sdlcCommits, sdlcPreviews, insertDevelopmentRepositorySchema, insertDevelopmentBranchSchema, insertSDLCCodeSchema, insertSDLCCommitSchema, insertSDLCPreviewSchema, personas, insertPersonaSchema, jiraConnections, prompts, userRoles, roles, users } from "@shared/schema";
import { eq, and, or, inArray, count, sql } from "drizzle-orm";
import type { z } from "zod";
import { encryptPAT, decryptPAT } from "./crypto-utils";
import { matchesOrganizationValue, normalizeOrganizationValue } from "./utils/organization-matcher";
import { DEFAULT_PROMPTS } from "./data/default-prompts";
import { getEffectiveUserIds, resolveEffectiveUserAccess } from "./auth/effective-user-access";

export interface SelectedOrganizationScope {
  id?: string;
  sourceType?: "ado" | "jira" | string;
  instanceUrl?: string | null;
}

// modify the interface with any CRUD methods
// you might need

export interface IStorage {
  getUser(id: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  getAdoSettings(): Promise<AdoSettings | undefined>;
  createAdoSettings(data: InsertAdoSettings): Promise<AdoSettings>;
  updateAdoSettings(id: string, data: Partial<InsertAdoSettings>): Promise<AdoSettings>;
  getArtifactOrganizations(userId?: string): Promise<ArtifactOrganization[]>;
  getArtifactOrganization(id: string): Promise<ArtifactOrganization | undefined>;
  createArtifactOrganization(data: InsertArtifactOrganization): Promise<ArtifactOrganization>;
  updateArtifactOrganization(id: string, data: Partial<InsertArtifactOrganization>): Promise<ArtifactOrganization>;
  deleteArtifactOrganization(id: string): Promise<void>;
  getGoldenRepoOrganizations(): Promise<GoldenRepoOrganization[]>;
  getGoldenRepoOrganization(id: string): Promise<GoldenRepoOrganization | undefined>;
  createGoldenRepoOrganization(data: InsertGoldenRepoOrganization): Promise<GoldenRepoOrganization>;
  updateGoldenRepoOrganization(id: string, data: Partial<InsertGoldenRepoOrganization>): Promise<GoldenRepoOrganization>;
  deleteGoldenRepoOrganization(id: string): Promise<void>;
  getOrganizations(): Promise<Organization[]>;
  getVisibleOrganizations(userId: string): Promise<Organization[]>;
  isUserTenantAdmin(userId: string): Promise<boolean>;
  getOrganization(id: string): Promise<Organization | undefined>;
  canAccessOrganization(userId: string, organizationId: string): Promise<boolean>;
  createOrganization(data: InsertOrganization & { id?: string }): Promise<Organization>;
  addOrganizationMember(params: { organizationId: string; userId: string; tenantId: string; role?: string; invitedBy?: string }): Promise<void>;
  updateOrganization(id: string, data: Partial<InsertOrganization>): Promise<Organization>;
  deleteOrganization(id: string): Promise<void>;
  getProjects(): Promise<Project[]>;
  getVisibleProjects(userId: string): Promise<Project[]>;
  getProject(id: string): Promise<Project | undefined>;
  canAccessProject(userId: string, projectId: string): Promise<boolean>;
  createProject(data: InsertProject): Promise<Project>;
  addProjectMember(params: { projectId: string; userId: string; tenantId: string; role?: string; invitedBy?: string }): Promise<void>;
  updateProject(id: string, data: Partial<InsertProject>): Promise<Project>;
  deleteProject(id: string): Promise<void>;
  getDashboardMetrics(projectId?: string, organizationName?: string, selectedOrganization?: SelectedOrganizationScope | null, userId?: string): Promise<any>;
  // Development Repositories
  getDevelopmentRepositories(projectId: string): Promise<any[]>;
  getDevelopmentRepository(id: string): Promise<any | undefined>;
  createDevelopmentRepository(data: z.infer<typeof insertDevelopmentRepositorySchema>): Promise<any>;
  // Development Branches
  getDevelopmentBranches(repositoryId: string): Promise<any[]>;
  getDevelopmentBranch(id: string): Promise<any | undefined>;
  createDevelopmentBranch(data: z.infer<typeof insertDevelopmentBranchSchema>): Promise<any>;
  updateBranchActive(branchId: string, isActive: boolean): Promise<any>;
  updateBranchCommitCount(branchId: string, count: number): Promise<any>;
  // Development Code
  getCode(repositoryId: string, branchId: string): Promise<any[]>;
  createCode(data: z.infer<typeof insertSDLCCodeSchema>): Promise<any>;
  // Development Commits
  getCommits(repositoryId: string, branchId?: string): Promise<any[]>;
  createCommit(data: z.infer<typeof insertSDLCCommitSchema>): Promise<any>;
  // Development Preview
  getPreview(repositoryId: string): Promise<any | undefined>;
  createPreview(data: z.infer<typeof insertSDLCPreviewSchema>): Promise<any>;
  updatePreview(id: string, data: Partial<z.infer<typeof insertSDLCPreviewSchema>>): Promise<any>;
  // Personas
  getPersonas(): Promise<Persona[]>;
  getPersona(id: string): Promise<Persona | undefined>;
  createPersona(data: InsertPersona): Promise<Persona>;
  updatePersona(id: string, data: Partial<InsertPersona>): Promise<Persona>;
  deletePersona(id: string): Promise<void>;
  initializeDefaultPersonas(): Promise<void>;
  // Prompts
  getPrompts(): Promise<Prompt[]>;
  getPrompt(id: string): Promise<Prompt | undefined>;
  createPrompt(data: InsertPrompt): Promise<Prompt>;
  updatePrompt(id: string, data: Partial<InsertPrompt>): Promise<Prompt>;
  deletePrompt(id: string): Promise<void>;
  incrementPromptUsage(id: string): Promise<void>;
  initializeDefaultPrompts(): Promise<void>;
}

export class MemStorage implements IStorage {
  private users: Map<string, User>;

  constructor() {
    this.users = new Map();
  }

  async getUser(id: string): Promise<User | undefined> {
    return this.users.get(id);
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    return Array.from(this.users.values()).find(
      (user) => user.displayName === username,
    );
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const id = randomUUID();
    const user: User = { ...insertUser, id, createdAt: new Date() };
    this.users.set(id, user);
    return user;
  }

  async getAdoSettings(): Promise<AdoSettings | undefined> {
    const settings = await db.select().from(adoSettings).limit(1);
    return settings[0];
  }

  async createAdoSettings(data: InsertAdoSettings): Promise<AdoSettings> {
    const id = randomUUID();
    // Encrypt PAT token before storing
    const encryptedData = {
      ...data,
      id,
      patToken: data.patToken ? encryptPAT(data.patToken) : null,
    };

    await db.insert(adoSettings).values(encryptedData);
    const inserted = await db.select().from(adoSettings).where(eq(adoSettings.id, id)).limit(1);
    if (!inserted[0]) {
      throw new Error("Failed to create ADO settings");
    }
    return inserted[0];
  }

  async updateAdoSettings(id: string, data: Partial<InsertAdoSettings>): Promise<AdoSettings> {
    // Encrypt PAT token if provided
    const encryptedData: any = { ...data };
    if (data.patToken !== undefined) {
      encryptedData.patToken = data.patToken ? encryptPAT(data.patToken) : null;
    }

    await db
      .update(adoSettings)
      .set({
        ...encryptedData,
        updatedAt: new Date(),
      })
      .where(eq(adoSettings.id, id));

    const updated = await db.select().from(adoSettings).where(eq(adoSettings.id, id)).limit(1);
    if (!updated[0]) {
      throw new Error("ADO settings not found");
    }

    return updated[0];
  }

  async getArtifactOrganizations(userId?: string): Promise<ArtifactOrganization[]> {
    const allArtifactOrgs = await db.select().from(artifactOrganizations);
    if (!userId) return allArtifactOrgs;
    
    const visibleOrgs = await this.getVisibleOrganizations(userId);
    const visibleOrgIds = new Set(visibleOrgs.map(org => org.id));
    
    return allArtifactOrgs.filter(org => visibleOrgIds.has(org.id));
  }

  async getArtifactOrganization(id: string): Promise<ArtifactOrganization | undefined> {
    const result = await db.select().from(artifactOrganizations).where(eq(artifactOrganizations.id, id)).limit(1);
    return result[0];
  }

  async createArtifactOrganization(data: InsertArtifactOrganization): Promise<ArtifactOrganization> {
    const id = randomUUID();
    // Encrypt PAT token before storing
    const encryptedData = {
      ...data,
      id,
      patToken: data.patToken ? encryptPAT(data.patToken) : null,
    };

    await db.insert(artifactOrganizations).values(encryptedData);
    const inserted = await db.select().from(artifactOrganizations).where(eq(artifactOrganizations.id, id)).limit(1);
    if (!inserted[0]) {
      throw new Error("Failed to create artifact organization");
    }
    return inserted[0];
  }

  async updateArtifactOrganization(id: string, data: Partial<InsertArtifactOrganization>): Promise<ArtifactOrganization> {
    // Encrypt PAT token if provided
    const encryptedData: any = { ...data };
    if (data.patToken !== undefined) {
      encryptedData.patToken = data.patToken ? encryptPAT(data.patToken) : null;
    }

    await db
      .update(artifactOrganizations)
      .set({
        ...encryptedData,
        updatedAt: new Date(),
      })
      .where(eq(artifactOrganizations.id, id));

    const updated = await db.select().from(artifactOrganizations).where(eq(artifactOrganizations.id, id)).limit(1);
    if (!updated[0]) {
      throw new Error("Artifact organization not found");
    }

    return updated[0];
  }

  async deleteArtifactOrganization(id: string): Promise<void> {
    await db.delete(artifactOrganizations).where(eq(artifactOrganizations.id, id));
  }

  // Golden Repo Organizations CRUD operations
  async getGoldenRepoOrganizations(): Promise<GoldenRepoOrganization[]> {
    return await db.select().from(goldenRepoOrganizations);
  }

  async getGoldenRepoOrganization(id: string): Promise<GoldenRepoOrganization | undefined> {
    const result = await db.select().from(goldenRepoOrganizations).where(eq(goldenRepoOrganizations.id, id)).limit(1);
    return result[0];
  }

  async createGoldenRepoOrganization(data: InsertGoldenRepoOrganization): Promise<GoldenRepoOrganization> {
    const id = randomUUID();
    // Encrypt PAT token before storing
    const encryptedData = {
      ...data,
      id,
      patToken: data.patToken ? encryptPAT(data.patToken) : null,
    };

    await db.insert(goldenRepoOrganizations).values(encryptedData);
    const inserted = await db.select().from(goldenRepoOrganizations).where(eq(goldenRepoOrganizations.id, id)).limit(1);
    if (!inserted[0]) {
      throw new Error("Failed to create golden repo organization");
    }
    return inserted[0];
  }

  async updateGoldenRepoOrganization(id: string, data: Partial<InsertGoldenRepoOrganization>): Promise<GoldenRepoOrganization> {
    // Encrypt PAT token if provided
    const encryptedData: any = { ...data };
    if (data.patToken !== undefined) {
      encryptedData.patToken = data.patToken ? encryptPAT(data.patToken) : null;
    }

    await db
      .update(goldenRepoOrganizations)
      .set({
        ...encryptedData,
        updatedAt: new Date(),
      })
      .where(eq(goldenRepoOrganizations.id, id));

    const updated = await db.select().from(goldenRepoOrganizations).where(eq(goldenRepoOrganizations.id, id)).limit(1);
    if (!updated[0]) {
      throw new Error("Golden repo organization not found");
    }

    return updated[0];
  }

  async deleteGoldenRepoOrganization(id: string): Promise<void> {
    await db.delete(goldenRepoOrganizations).where(eq(goldenRepoOrganizations.id, id));
  }

  // Wiki Pages CRUD operations
  async createWikiPage(data: InsertWikiPage): Promise<WikiPage> {
    const id = randomUUID();
    await db.insert(wikiPages).values({ ...data, id });
    const inserted = await db.select().from(wikiPages).where(eq(wikiPages.id, id)).limit(1);
    if (!inserted[0]) {
      throw new Error("Failed to create wiki page");
    }
    return inserted[0];
  }

  async getWikiPagesBySession(sessionId: string): Promise<WikiPage[]> {
    const result = await db
      .select()
      .from(wikiPages)
      .where(eq(wikiPages.sessionId, sessionId))
      .orderBy(wikiPages.order);
    return result;
  }

  async getWikiPagesByProject(projectId: string): Promise<WikiPage[]> {
    const result = await db
      .select()
      .from(wikiPages)
      .where(eq(wikiPages.projectId, projectId))
      .orderBy(wikiPages.order);
    return result;
  }

  async getWikiPage(id: string): Promise<WikiPage | undefined> {
    const result = await db
      .select()
      .from(wikiPages)
      .where(eq(wikiPages.id, id))
      .limit(1);
    return result[0];
  }

  async deleteWikiPage(id: string): Promise<void> {
    await db.delete(wikiPages).where(eq(wikiPages.id, id));
  }

  async deleteWikiPagesBySession(sessionId: string): Promise<void> {
    await db.delete(wikiPages).where(eq(wikiPages.sessionId, sessionId));
  }

  // Organizations CRUD operations
  async getOrganizations(): Promise<Organization[]> {
    return await db.select().from(organizations);
  }

  // Organizations the user can see: those they own OR have a membership row for.
  async isUserTenantAdmin(userId: string): Promise<boolean> {
    const userRoleRows = await db
      .select({ roleName: roles.name })
      .from(userRoles)
      .innerJoin(roles, eq(userRoles.roleId, roles.id))
      .where(eq(userRoles.userId, userId));

    return userRoleRows.some((r) => r.roleName === "TenantAdmin");
  }

  async getVisibleOrganizations(userId: string): Promise<Organization[]> {
    const access = await resolveEffectiveUserAccess(userId);
    if (!access || access.tenantIds.length === 0) return [];
    const effectiveUserIds = access.userIds;

    const memberRows = await db
      .select({ organizationId: organizationMembers.organizationId })
      .from(organizationMembers)
      .where(inArray(organizationMembers.userId, effectiveUserIds));
    const memberOrgIds = memberRows.map((r) => r.organizationId);

    // Also include organizations where the user has project-level access
    const projectMemberRows = await db
      .select({ projectId: projectMembers.projectId })
      .from(projectMembers)
      .where(inArray(projectMembers.userId, effectiveUserIds));
    const memberProjectIds = projectMemberRows.map((r) => r.projectId);

    let explicitProjectOrgIds: string[] = [];
    if (memberProjectIds.length > 0) {
      // 1. DevX internal projects
      const explicitProjects = await db
        .select({ organizationId: projects.organizationId })
        .from(projects)
        .where(inArray(projects.id, memberProjectIds));
      explicitProjectOrgIds = explicitProjects.map((p) => p.organizationId).filter(Boolean) as string[];

      // 2. Synced ADO/Jira projects
      const explicitSdlcProjects = await db
        .select({ jiraConnectionId: sdlcProjects.jiraConnectionId, organization: sdlcProjects.organization })
        .from(sdlcProjects)
        .where(inArray(sdlcProjects.id, memberProjectIds));
      
      const jiraConnIds = explicitSdlcProjects.map(p => p.jiraConnectionId).filter(Boolean) as string[];
      explicitProjectOrgIds.push(...jiraConnIds);

      // Add ADO orgs mapping
      const artifactOrgs = await db.select().from(artifactOrganizations);
      explicitSdlcProjects.forEach(sp => {
        if (sp.organization) {
          const match = artifactOrgs.find(a => matchesOrganizationValue(sp.organization, a.organizationUrl));
          if (match) {
            explicitProjectOrgIds.push(match.id);
          }
        }
      });
    }

    const allOrgIds = [...new Set([...memberOrgIds, ...explicitProjectOrgIds])];

    const condition = allOrgIds.length > 0
      ? or(inArray(organizations.ownerUserId, effectiveUserIds), inArray(organizations.id, allOrgIds))
      : inArray(organizations.ownerUserId, effectiveUserIds);

    return await db
      .select()
      .from(organizations)
      .where(and(inArray(organizations.tenantId, access.tenantIds), condition));
  }

  async getOrganization(id: string): Promise<Organization | undefined> {
    const result = await db.select().from(organizations).where(eq(organizations.id, id)).limit(1);
    return result[0];
  }

  async canAccessOrganization(userId: string, organizationId: string): Promise<boolean> {
    const org = await this.getOrganization(organizationId);
    if (!org) return false;
    const effectiveUserIds = await getEffectiveUserIds(userId);
    if (org.ownerUserId && effectiveUserIds.includes(org.ownerUserId)) return true;
    const [member] = await db
      .select({ id: organizationMembers.id })
      .from(organizationMembers)
      .where(and(eq(organizationMembers.organizationId, organizationId), inArray(organizationMembers.userId, effectiveUserIds)))
      .limit(1);
    return Boolean(member);
  }

  async createOrganization(data: InsertOrganization & { id?: string }): Promise<Organization> {
    const id = data.id || randomUUID();
    await db.insert(organizations).values({ ...data, id });
    const inserted = await db.select().from(organizations).where(eq(organizations.id, id)).limit(1);
    if (!inserted[0]) {
      throw new Error("Failed to create organization");
    }
    return inserted[0];
  }

  async addOrganizationMember(params: { organizationId: string; userId: string; tenantId: string; role?: string; invitedBy?: string }): Promise<void> {
    // Idempotent: skip if a membership row already exists.
    const [existing] = await db
      .select({ id: organizationMembers.id })
      .from(organizationMembers)
      .where(and(eq(organizationMembers.organizationId, params.organizationId), eq(organizationMembers.userId, params.userId)))
      .limit(1);
    if (existing) return;
    await db.insert(organizationMembers).values({
      id: randomUUID(),
      organizationId: params.organizationId,
      userId: params.userId,
      tenantId: params.tenantId,
      role: params.role ?? "member",
      invitedBy: params.invitedBy ?? null,
    });
  }

  async updateOrganization(id: string, data: Partial<InsertOrganization>): Promise<Organization> {
    await db
      .update(organizations)
      .set({
        ...data,
        updatedAt: new Date(),
      })
      .where(eq(organizations.id, id));

    const updated = await db.select().from(organizations).where(eq(organizations.id, id)).limit(1);
    if (!updated[0]) {
      throw new Error("Organization not found");
    }

    return updated[0];
  }

  async deleteOrganization(id: string): Promise<void> {
    await db.delete(organizations).where(eq(organizations.id, id));
  }

  // Projects CRUD operations
  async getProjects(): Promise<Project[]> {
    return await db.select().from(projects);
  }

  // Projects the user can see: those they own, have explicit project membership, or have explicit organization membership.
  async getVisibleProjects(userId: string): Promise<Project[]> {
    const memberProjectRows = await db
      .select({ projectId: projectMembers.projectId })
      .from(projectMembers)
      .where(eq(projectMembers.userId, userId));
    const memberProjectIds = memberProjectRows.map((r) => r.projectId);

    const memberOrgRows = await db
      .select({ organizationId: organizationMembers.organizationId })
      .from(organizationMembers)
      .where(eq(organizationMembers.userId, userId));
    const memberOrgIds = memberOrgRows.map((r) => r.organizationId);
    const conditions = [eq(projects.ownerUserId, userId)];
    if (memberProjectIds.length > 0) conditions.push(inArray(projects.id, memberProjectIds));
    if (memberOrgIds.length > 0) conditions.push(inArray(projects.organizationId, memberOrgIds));

    return await db.select().from(projects).where(or(...conditions));
  }

  async getProject(id: string): Promise<Project | undefined> {
    const result = await db.select().from(projects).where(eq(projects.id, id)).limit(1);
    return result[0];
  }

  async canAccessProject(userId: string, projectId: string): Promise<boolean> {
    const project = await this.getProject(projectId);
    if (!project) return false;
    if (project.ownerUserId === userId) return true;
    const [member] = await db
      .select({ id: projectMembers.id })
      .from(projectMembers)
      .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, userId)))
      .limit(1);
    return Boolean(member);
  }

  async createProject(data: InsertProject): Promise<Project> {
    const id = randomUUID();
    await db.insert(projects).values({ ...data, id });
    const inserted = await db.select().from(projects).where(eq(projects.id, id)).limit(1);
    if (!inserted[0]) {
      throw new Error("Failed to create project");
    }
    return inserted[0];
  }

  async addProjectMember(params: { projectId: string; userId: string; tenantId: string; role?: string; invitedBy?: string }): Promise<void> {
    const [existing] = await db
      .select({ id: projectMembers.id })
      .from(projectMembers)
      .where(and(eq(projectMembers.projectId, params.projectId), eq(projectMembers.userId, params.userId)))
      .limit(1);
    if (existing) return;
    await db.insert(projectMembers).values({
      id: randomUUID(),
      projectId: params.projectId,
      userId: params.userId,
      tenantId: params.tenantId,
      role: params.role ?? "member",
      invitedBy: params.invitedBy ?? null,
    });
  }

  async updateProject(id: string, data: Partial<InsertProject>): Promise<Project> {
    await db
      .update(projects)
      .set({
        ...data,
        updatedAt: new Date(),
      })
      .where(eq(projects.id, id));

    const updated = await db.select().from(projects).where(eq(projects.id, id)).limit(1);
    if (!updated[0]) {
      throw new Error("Project not found");
    }

    return updated[0];
  }

  async deleteProject(id: string): Promise<void> {
    await db.delete(projects).where(eq(projects.id, id));
  }

  // Personas CRUD operations
  async getPersonas(): Promise<Persona[]> {
    try {
      console.log("[Storage] Fetching personas from database...");
      const result = await db.select().from(personas);
      console.log("[Storage] Raw database result:", JSON.stringify(result, null, 2));
      // Convert database format to Persona format
      const mappedPersonas = result.map(p => {
        // Handle both camelCase and snake_case from database
        const dbRow = p as any;
        return {
          id: p.id,
          name: p.name,
          role: p.role,
          color: p.color,
          focus: p.focus,
          painPoints: (dbRow.pain_points || dbRow.painPoints || []) as string[],
          goals: (dbRow.goals || []) as string[],
        };
      });
      console.log("[Storage] Mapped personas:", JSON.stringify(mappedPersonas, null, 2));
      return mappedPersonas;
    } catch (error) {
      console.error("[Storage] Error fetching personas:", error);
      throw error;
    }
  }

  async getPersona(id: string): Promise<Persona | undefined> {
    const result = await db.select().from(personas).where(eq(personas.id, id)).limit(1);
    if (!result[0]) return undefined;

    const p = result[0];
    const dbRow = p as any;
    return {
      id: p.id,
      name: p.name,
      role: p.role,
      color: p.color,
      focus: p.focus,
      painPoints: (dbRow.pain_points || dbRow.painPoints || []) as string[],
      goals: (dbRow.goals || []) as string[],
    };
  }

  async createPersona(data: InsertPersona): Promise<Persona> {
    const id = randomUUID();
    await db.insert(personas).values({
      ...data,
      id,
      painPoints: data.painPoints as any,
      goals: data.goals as any
    });
    const inserted = await db.select().from(personas).where(eq(personas.id, id)).limit(1);
    if (!inserted[0]) {
      throw new Error("Failed to create persona");
    }
    const p = inserted[0];
    const dbRow = p as any;
    return {
      id: p.id,
      name: p.name,
      role: p.role,
      color: p.color,
      focus: p.focus,
      painPoints: (dbRow.pain_points || dbRow.painPoints || []) as string[],
      goals: (dbRow.goals || []) as string[],
    };
  }

  async updatePersona(id: string, data: Partial<InsertPersona>): Promise<Persona> {
    const updateData: any = {
      ...data,
      updatedAt: new Date(),
    };
    if (data.painPoints) {
      updateData.painPoints = data.painPoints as any;
    }
    if (data.goals) {
      updateData.goals = data.goals as any;
    }

    await db
      .update(personas)
      .set(updateData)
      .where(eq(personas.id, id));

    const updated = await db.select().from(personas).where(eq(personas.id, id)).limit(1);
    if (!updated[0]) {
      throw new Error("Persona not found");
    }

    const p = updated[0];
    const dbRow = p as any;
    return {
      id: p.id,
      name: p.name,
      role: p.role,
      color: p.color,
      focus: p.focus,
      painPoints: (dbRow.pain_points || dbRow.painPoints || []) as string[],
      goals: (dbRow.goals || []) as string[],
    };
  }

  async deletePersona(id: string): Promise<void> {
    await db.delete(personas).where(eq(personas.id, id));
  }

  async initializeDefaultPersonas(): Promise<void> {
    try {
      console.log("[Storage] Checking if personas table exists and has data...");
      // Check if personas already exist
      const existing = await db.select().from(personas).limit(1);
      if (existing.length > 0) {
        console.log("[Storage] Personas already initialized");
        return;
      }

      console.log("[Storage] Initializing default personas...");

      const defaultPersonas: InsertPersona[] = [
        {
          name: "Sarah Chen",
          role: "Product Manager",
          color: "#3b82f6",
          focus: "Delivering value to customers",
          painPoints: [
            "Difficulty prioritizing features",
            "Lack of clear requirements from stakeholders",
            "Challenge in measuring product success"
          ],
          goals: [
            "Ship features that solve real user problems",
            "Maintain clear product roadmap",
            "Improve user engagement metrics"
          ],
          isDefault: 1
        },
        {
          name: "Alex Rodriguez",
          role: "Software Developer",
          color: "#10b981",
          focus: "Writing clean, maintainable code",
          painPoints: [
            "Unclear requirements",
            "Frequent context switching",
            "Technical debt accumulation"
          ],
          goals: [
            "Deliver high-quality code",
            "Minimize bugs in production",
            "Improve development efficiency"
          ],
          isDefault: 1
        },
        {
          name: "Emily Watson",
          role: "QA Engineer",
          color: "#f59e0b",
          focus: "Ensuring product quality",
          painPoints: [
            "Late involvement in development cycle",
            "Insufficient test coverage",
            "Regression issues in releases"
          ],
          goals: [
            "Catch bugs before production",
            "Automate repetitive testing",
            "Improve test coverage"
          ],
          isDefault: 1
        },
        {
          name: "Michael Kim",
          role: "UX Designer",
          color: "#8b5cf6",
          focus: "Creating intuitive user experiences",
          painPoints: [
            "Design feedback comes too late",
            "Lack of user research data",
            "Difficulty collaborating with developers"
          ],
          goals: [
            "Design user-friendly interfaces",
            "Validate designs with real users",
            "Ensure design consistency"
          ],
          isDefault: 1
        }
      ];

      for (const persona of defaultPersonas) {
        await this.createPersona(persona);
      }

      console.log("[Storage] Default personas initialized successfully");
    } catch (error) {
      console.error("[Storage] Error initializing personas:", error);
      throw error;
    }
  }

  // Helper function to get project count for an artifact organization
  private async getArtifactOrgProjectCount(artifactOrg: ArtifactOrganization): Promise<number> {
    try {
      if (!artifactOrg.patToken) {
        return 0;
      }

      const decryptedPAT = decryptPAT(artifactOrg.patToken);
      if (!decryptedPAT) {
        return 0;
      }

      // Extract organization name from URL
      let orgName = "";
      try {
        const parsed = new URL(artifactOrg.organizationUrl);
        const segments = parsed.pathname.split("/").filter(Boolean);
        if (segments.length > 0) {
          orgName = segments[0];
        } else {
          const match = artifactOrg.organizationUrl.match(/dev\.azure\.com\/([^/]+)/);
          orgName = match ? match[1] : "";
        }
      } catch {
        const match = String(artifactOrg.organizationUrl).match(/dev\.azure\.com\/([^/]+)/);
        orgName = match ? match[1] : "";
      }

      if (!orgName) {
        return 0;
      }

      // Call Azure DevOps API to get projects
      const apiUrl = `https://dev.azure.com/${orgName}/_apis/projects?api-version=7.0`;
      const authHeader = `Basic ${Buffer.from(`:${decryptedPAT}`).toString("base64")}`;

      const response = await fetch(apiUrl, {
        method: "GET",
        headers: {
          Authorization: authHeader,
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        return 0;
      }

      // Check if response is actually JSON before parsing
      const contentType = response.headers.get("content-type");
      if (!contentType || !contentType.includes("application/json")) {
        return 0;
      }

      const data = await response.json();
      return data.value?.length || 0;
    } catch (error) {
      console.error(`[Storage] Error fetching project count for artifact org ${artifactOrg.id}:`, error);
      return 0;
    }
  }

  // Dashboard Metrics
  async getDashboardMetrics(projectId?: string, organizationName?: string, selectedOrganization?: SelectedOrganizationScope | null, userId?: string): Promise<any> {
    const emptyMetrics = {
      organizations: 0,
      projects: 0,
      sdlcProjects: 0,
      goldenRepositories: 0,
      totalWorkItems: 0,
      workItems: { issues: 0, epics: 0, requirements: 0, backlog: 0, documents: 0 },
      generatedArtifacts: { brds: 0, requirements: 0, epics: 0, features: 0, userStories: 0, testCases: 0, testPlans: 0, designAssets: 0, designGuidelines: 0 },
      workItemsByProject: [],
      wikiPages: 0,
      phases: { total: 0, active: 0, completed: 0 },
      phasesByProject: [],
      recentProjects: [],
      recentOrganizations: [],
    };

    try {
      const { isAwsHosting } = await import("./platform/hosting");
      let configuredGoldenRepoCount = 0;
      if (isAwsHosting()) {
        const dbRepos = await db.select({ count: count() }).from(goldenRepositories);
        configuredGoldenRepoCount = dbRepos[0]?.count || 0;
      } else {
        configuredGoldenRepoCount = await this.getGoldenRepositoriesCountFromAdoSettings();
      }

      const normalizedOrganizationName = normalizeOrganizationValue(organizationName);
      const buildInClause = (values: string[]) =>
        sql`(${sql.join(values.map((value) => sql`${value}`), sql`, `)})`;

      // Jira projects store the instance URL (not the connection name) in the
      // `organization` column, so the fuzzy name matcher never matches them.
      // For Jira-scoped orgs, match relationally by connection id / instance url
      // (mirrors getLiveProjectCountForSelectedOrganization). ADO keeps the
      // existing org-name string matching.
      const isJiraScope = selectedOrganization?.sourceType === "jira";
      const normalizeUrlValue = (value: string | null | undefined) =>
        (value ?? "").trim().toLowerCase().replace(/\/+$/, "");
      const selectedInstanceUrl = normalizeUrlValue(selectedOrganization?.instanceUrl);
      const matchesScopedProject = (project: {
        organization: string | null;
        integrationType: string | null;
        jiraConnectionId: string | null;
        jiraInstanceUrl: string | null;
      }) => {
        if (isJiraScope) {
          if (selectedOrganization?.id && project.jiraConnectionId === selectedOrganization.id) {
            return true;
          }
          if (selectedInstanceUrl && normalizeUrlValue(project.jiraInstanceUrl) === selectedInstanceUrl) {
            return true;
          }
        }
        return matchesOrganizationValue(project.organization, normalizedOrganizationName);
      };

      const scopedProjects = normalizedOrganizationName
        ? (await db
            .select({
              id: sdlcProjects.id,
              name: sdlcProjects.name,
              organization: sdlcProjects.organization,
              integrationType: sdlcProjects.integrationType,
              jiraConnectionId: sdlcProjects.jiraConnectionId,
              jiraInstanceUrl: sdlcProjects.jiraInstanceUrl,
            })
            .from(sdlcProjects)
            .where(eq(sdlcProjects.deletedFromAdo, false)))
            .filter((project) => matchesScopedProject(project))
        : [];

      let scopedProjectIds = scopedProjects.map((project) => project.id);

      let allowedSdlcProjectIds: string[] | undefined;
      let visibleOrgIds: Set<string> | undefined;

      if (userId) {
        const visibleOrgs = await this.getVisibleOrganizations(userId);
        visibleOrgIds = new Set(visibleOrgs.map(o => o.id));

        const memberRows = await db.select({ projectId: projectMembers.projectId }).from(projectMembers).where(eq(projectMembers.userId, userId));
        const memberProjectIds = memberRows.map(r => r.projectId);

        const allAdoOrganizations = await db.select().from(artifactOrganizations);

        const explicitDevXProjects = await db.select({ organizationId: projects.organizationId }).from(projects).where(inArray(projects.id, memberProjectIds));
        explicitDevXProjects.forEach(p => { if (p.organizationId) visibleOrgIds.add(p.organizationId); });

        const explicitSdlcProjects = await db.select().from(sdlcProjects).where(inArray(sdlcProjects.id, memberProjectIds));
        explicitSdlcProjects.forEach(sp => {
          if (sp.jiraConnectionId) visibleOrgIds.add(sp.jiraConnectionId);
          if (sp.integrationType !== 'jira' && sp.organization) {
            const match = allAdoOrganizations.find(a => matchesOrganizationValue(sp.organization, a.organizationUrl));
            if (match) visibleOrgIds.add(match.id);
          }
        });

        const allSdlcProjects = await db.select({ id: sdlcProjects.id, jiraConnectionId: sdlcProjects.jiraConnectionId, organization: sdlcProjects.organization, integrationType: sdlcProjects.integrationType }).from(sdlcProjects).where(eq(sdlcProjects.deletedFromAdo, false));

        allowedSdlcProjectIds = allSdlcProjects.filter(p => {
          if (memberProjectIds.includes(p.id)) return true;
          if (p.integrationType === 'jira' && p.jiraConnectionId && visibleOrgIds!.has(p.jiraConnectionId)) return true;
          if (p.integrationType !== 'jira' && p.organization) {
             const match = allAdoOrganizations.find(a => matchesOrganizationValue(p.organization, a.organizationUrl));
             if (match && visibleOrgIds!.has(match.id)) return true;
          }
          return false;
        }).map(p => p.id);

        if (normalizedOrganizationName) {
           scopedProjectIds = scopedProjectIds.filter(id => allowedSdlcProjectIds!.includes(id));
        }
      }

      const selectCount = (table: any, filter?: any) =>
        filter
          ? db.select({ count: count() }).from(table).where(filter)
          : db.select({ count: count() }).from(table);

      const projectScopedFilter = (table: any) => {
        let condition: any = undefined;
        if (projectId) {
           condition = sql`${table.projectId} = ${projectId}`;
        } else if (normalizedOrganizationName) {
           condition = scopedProjectIds.length > 0
              ? sql`${table.projectId} IN ${buildInClause(scopedProjectIds)}`
              : sql`1 = 0`;
        }

        if (allowedSdlcProjectIds) {
           if (allowedSdlcProjectIds.length === 0) {
              return sql`1 = 0`;
           }
           const authCondition = sql`${table.projectId} IN ${buildInClause(allowedSdlcProjectIds)}`;
           return condition ? sql`${condition} AND ${authCondition}` : authCondition;
        }
        return condition;
      };

      // Like projectScopedFilter but takes a raw SQL column expression instead of a table object.
      // Used for db.execute() queries where Drizzle ORM column refs are not available.
      const projectScopedRawFilter = (projectIdCol: any) => {
        let condition: any = undefined;
        if (projectId) {
           condition = sql`${projectIdCol} = ${projectId}`;
        } else if (normalizedOrganizationName) {
           condition = scopedProjectIds.length > 0
              ? sql`${projectIdCol} IN ${buildInClause(scopedProjectIds)}`
              : sql`1 = 0`;
        }
        if (allowedSdlcProjectIds) {
           if (allowedSdlcProjectIds.length === 0) return sql`1 = 0`;
           const authCondition = sql`${projectIdCol} IN ${buildInClause(allowedSdlcProjectIds)}`;
           return condition ? sql`${condition} AND ${authCondition}` : authCondition;
        }
        return condition;
      };

      let sdlcProjectsFilter = eq(sdlcProjects.deletedFromAdo, false);
      if (allowedSdlcProjectIds) {
          sdlcProjectsFilter = allowedSdlcProjectIds.length > 0 
              ? and(eq(sdlcProjects.deletedFromAdo, false), inArray(sdlcProjects.id, allowedSdlcProjectIds)) as any
              : sql`1 = 0` as any;
      }

      const [
        artifactOrgCount,
        jiraConnectionCount,
        sdlcProjectCount,
        goldenRepositoryCount,
        issueCount,
        epicCount,
        requirementCount,
        backlogCount,
        documentCount,
        wikiPageCount,
        recentProjects,
        recentOrganizations,
        recentJiraConnections,
        // Phase aggregates
        totalPhaseCount,
        activePhaseCount,
        completedPhaseCount,
      ] = await Promise.all([
        db.select({ count: count() }).from(artifactOrganizations),
        db.select({ count: count() }).from(jiraConnections),
        normalizedOrganizationName
          ? Promise.resolve([{ count: scopedProjectIds.length }])
          : selectCount(sdlcProjects, sdlcProjectsFilter),
        db.select({ count: count() }).from(goldenRepositories),
        selectCount(sdlcIssues, projectScopedFilter(sdlcIssues)),
        selectCount(sdlcEpics, projectScopedFilter(sdlcEpics)),
        selectCount(sdlcRequirements, projectScopedFilter(sdlcRequirements)),
        selectCount(sdlcBacklogItems, projectScopedFilter(sdlcBacklogItems)),
        selectCount(sdlcDocuments, projectScopedFilter(sdlcDocuments)),
        selectCount(wikiPages, projectScopedFilter(wikiPages)),
        projectId
          ? db.select().from(sdlcProjects).where(sql`${sdlcProjects.id} = ${projectId} AND ${sdlcProjects.deletedFromAdo} = false`).orderBy(sql`created_at DESC`).limit(5)
          : normalizedOrganizationName
            ? scopedProjectIds.length > 0
              ? db.select().from(sdlcProjects).where(sql`${sdlcProjects.id} IN ${buildInClause(scopedProjectIds)}`).orderBy(sql`created_at DESC`).limit(5)
              : Promise.resolve([])
            : db.select().from(sdlcProjects).where(sdlcProjectsFilter).orderBy(sql`created_at DESC`).limit(5),
        db.select().from(artifactOrganizations).orderBy(sql`created_at DESC`).limit(50),
        db.select().from(jiraConnections).orderBy(sql`created_at DESC`).limit(50),
        // Phase counts
        selectCount(sdlcPhases, projectScopedFilter(sdlcPhases)),
        projectId
          ? selectCount(sdlcPhases, sql`${sdlcPhases.projectId} = ${projectId} AND ${sdlcPhases.status} = 'in_progress'`)
          : normalizedOrganizationName
            ? scopedProjectIds.length > 0
              ? selectCount(sdlcPhases, sql`${sdlcPhases.projectId} IN ${buildInClause(scopedProjectIds)} AND ${sdlcPhases.status} = 'in_progress'`)
              : Promise.resolve([{ count: 0 }])
            : selectCount(sdlcPhases, sql`${sdlcPhases.status} = 'in_progress'`),
        projectId
          ? selectCount(sdlcPhases, sql`${sdlcPhases.projectId} = ${projectId} AND ${sdlcPhases.status} = 'completed'`)
          : normalizedOrganizationName
            ? scopedProjectIds.length > 0
              ? selectCount(sdlcPhases, sql`${sdlcPhases.projectId} IN ${buildInClause(scopedProjectIds)} AND ${sdlcPhases.status} = 'completed'`)
              : Promise.resolve([{ count: 0 }])
            : selectCount(sdlcPhases, sql`${sdlcPhases.status} = 'completed'`),
      ]);

      // Get all artifact organizations and fetch their project counts (skip ADO calls in AWS mode)
      let totalProjectCount = 0;
      const artifactOrgs = await this.getArtifactOrganizations();
      if (!isAwsHosting()) {
        const projectCountPromises = artifactOrgs.map(org => this.getArtifactOrgProjectCount(org));
        const projectCounts = await Promise.all(projectCountPromises);
        totalProjectCount = projectCounts.reduce((sum, count) => sum + count, 0);
      }

      // Map artifact organizations and jira connections to the expected format for recentOrganizations
      const mappedAdoOrganizations = isAwsHosting() ? [] : (recentOrganizations || []).map((org: ArtifactOrganization) => {
        let orgName = "";
        try {
          const match = org.organizationUrl.match(/dev\.azure\.com\/([^\/]+)/);
          orgName = match ? match[1] : org.projectName || org.organizationUrl;
        } catch {
          orgName = org.projectName || org.organizationUrl;
        }

        const createdAtStr = org.createdAt instanceof Date
          ? org.createdAt.toISOString()
          : typeof org.createdAt === 'string'
            ? org.createdAt
            : new Date(org.createdAt as any).toISOString();

        return {
          id: org.id,
          name: orgName,
          description: org.projectName || null,
          industry: null,
          status: org.patToken ? "active" : "inactive",
          createdAt: createdAtStr,
        };
      });

      const mappedJiraOrganizations = (recentJiraConnections || []).map((conn: any) => {
        const createdAtStr = conn.createdAt instanceof Date
          ? conn.createdAt.toISOString()
          : typeof conn.createdAt === 'string'
            ? conn.createdAt
            : new Date(conn.createdAt as any).toISOString();

        return {
          id: conn.id,
          name: conn.name,
          description: conn.instanceUrl,
          industry: null,
          status: conn.isActive ? "active" : "inactive",
          createdAt: createdAtStr,
        };
      });

      // Filter all recent organizations if visibleOrgIds is set
      let combinedRecentOrgs = [...mappedAdoOrganizations, ...mappedJiraOrganizations];
      if (visibleOrgIds) {
          combinedRecentOrgs = combinedRecentOrgs.filter(org => visibleOrgIds!.has(org.id));
      }

      // Combine and sort by createdAt descending, take top 5
      const allRecentOrganizations = combinedRecentOrgs
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        .slice(0, 5);

      const issues = issueCount[0]?.count || 0;
      const epics = epicCount[0]?.count || 0;
      const requirements = requirementCount[0]?.count || 0;
      const backlog = backlogCount[0]?.count || 0;
      const documents = documentCount[0]?.count || 0;
      const totalWorkItems = issues + epics + requirements + backlog + documents;

      const totalPhases = totalPhaseCount[0]?.count || 0;
      const activePhases = activePhaseCount[0]?.count || 0;
      const completedPhases = completedPhaseCount[0]?.count || 0;

      // Generated artifacts counts — all queries go through projectScopedRawFilter so that
      // allowedSdlcProjectIds (user access) is ALWAYS applied, including the "All" case.
      let generatedArtifacts = { brds: 0, requirements: 0, epics: 0, features: 0, userStories: 0, testCases: 0, testPlans: 0, designAssets: 0, designGuidelines: 0 };
      try {
        // Build access-scoped WHERE fragments for the two raw-SQL queries.
        const rawPidFilter  = projectScopedRawFilter(sql`project_id`);
        const wfWhereClause = rawPidFilter ? sql`WHERE ${rawPidFilter}` : sql``;
        const tcPidFilter   = projectScopedRawFilter(sql`wa.project_id`);

        // Helper: count rows from any Drizzle table, scoped by user access + org/project filter.
        const scopedCount = (table: any) => {
          const f = projectScopedRawFilter(sql`project_id`);
          return f
            ? db.select({ count: count() }).from(table).where(f)
            : db.select({ count: count() }).from(table);
        };

        const [brdCount, reqCount, wfArtifactCounts, testCaseCount, testPlanCount, designAssetCount, guidelineCount] = await Promise.all([
          scopedCount(devBrdDocuments),
          scopedCount(devBrdRequirements),
          // Count from workflow_artifacts JSON columns using JSON_LENGTH
          db.execute(sql`SELECT
            COALESCE(SUM(JSON_LENGTH(epics)), 0) as epicCount,
            COALESCE(SUM(JSON_LENGTH(features)), 0) as featureCount,
            COALESCE(SUM(JSON_LENGTH(user_stories)), 0) as userStoryCount
            FROM workflow_artifacts ${wfWhereClause}`),
          // Test cases — join through workflow_artifacts for project filtering
          tcPidFilter
            ? db.execute(sql`SELECT COUNT(*) as count FROM workflow_test_cases tc
                INNER JOIN workflow_artifacts wa ON tc.artifact_id = wa.id
                WHERE ${tcPidFilter}`)
            : db.select({ count: count() }).from(workflowTestCases),
          scopedCount(testPlanDocuments),
          scopedCount(sdlcDesignAssets),
          scopedCount(designGuidelines),
        ]);
        const wfRow = (wfArtifactCounts as any)?.[0] || (wfArtifactCounts as any)?.rows?.[0] || {};
        generatedArtifacts = {
          brds: brdCount[0]?.count || 0,
          requirements: reqCount[0]?.count || 0,
          epics: Number(wfRow.epicCount) || 0,
          features: Number(wfRow.featureCount) || 0,
          userStories: Number(wfRow.userStoryCount) || 0,
          testCases: (testCaseCount as any)[0]?.count || 0,
          testPlans: testPlanCount[0]?.count || 0,
          designAssets: designAssetCount[0]?.count || 0,
          designGuidelines: guidelineCount[0]?.count || 0,
        };
      } catch (err) {
        console.error("Error fetching generatedArtifacts:", err);
      }

      // Build phasesByProject — group phases by project
      let phasesByProject: Array<{ projectId: string; projectName: string; total: number; active: number; completed: number; pending: number }> = [];
      try {
        const phasesByProjectRows = await db.select({
          projectId: sdlcPhases.projectId,
          total: count(),
          active: sql<number>`SUM(CASE WHEN ${sdlcPhases.status} = 'in_progress' THEN 1 ELSE 0 END)`,
          completed: sql<number>`SUM(CASE WHEN ${sdlcPhases.status} = 'completed' THEN 1 ELSE 0 END)`,
          pending: sql<number>`SUM(CASE WHEN ${sdlcPhases.status} NOT IN ('in_progress', 'completed') THEN 1 ELSE 0 END)`,
        }).from(sdlcPhases)
          .where(projectScopedFilter(sdlcPhases))
          .groupBy(sdlcPhases.projectId);

        // Look up project names
        const projectIds = phasesByProjectRows.map(r => r.projectId);
        const projectRows = projectIds.length > 0
          ? await db.select({ id: sdlcProjects.id, name: sdlcProjects.name }).from(sdlcProjects).where(sql`id IN (${sql.join(projectIds.map(id => sql`${id}`), sql`, `)})`)
          : [];
        const projectNameMap = new Map(projectRows.map(p => [p.id, p.name]));

        phasesByProject = phasesByProjectRows.map(r => ({
          projectId: r.projectId,
          projectName: projectNameMap.get(r.projectId) || 'Unknown Project',
          total: r.total,
          active: Number(r.active) || 0,
          completed: Number(r.completed) || 0,
          pending: Number(r.pending) || 0,
        }));
      } catch (err) {
        console.error("Error fetching phasesByProject:", err);
      }

      // Build workItemsByProject — group work items by project
      let workItemsByProject: Array<{ projectId: string; projectName: string; issues: number; epics: number; requirements: number; backlog: number; documents: number; total: number }> = [];
      try {
        // Get per-project counts from each table
        const [issuesByProject, epicsByProject, reqsByProject, backlogByProject, docsByProject] = await Promise.all([
          db.select({ projectId: sdlcIssues.projectId, count: count() }).from(sdlcIssues).where(projectScopedFilter(sdlcIssues)).groupBy(sdlcIssues.projectId),
          db.select({ projectId: sdlcEpics.projectId, count: count() }).from(sdlcEpics).where(projectScopedFilter(sdlcEpics)).groupBy(sdlcEpics.projectId),
          db.select({ projectId: sdlcRequirements.projectId, count: count() }).from(sdlcRequirements).where(projectScopedFilter(sdlcRequirements)).groupBy(sdlcRequirements.projectId),
          db.select({ projectId: sdlcBacklogItems.projectId, count: count() }).from(sdlcBacklogItems).where(projectScopedFilter(sdlcBacklogItems)).groupBy(sdlcBacklogItems.projectId),
          db.select({ projectId: sdlcDocuments.projectId, count: count() }).from(sdlcDocuments).where(projectScopedFilter(sdlcDocuments)).groupBy(sdlcDocuments.projectId),
        ]);

        // Collect all unique project IDs
        const allProjectIds = new Set<string>();
        [issuesByProject, epicsByProject, reqsByProject, backlogByProject, docsByProject].forEach(rows =>
          rows.forEach(r => allProjectIds.add(r.projectId))
        );

        if (allProjectIds.size > 0) {
          const ids = Array.from(allProjectIds);
          const projectRows = await db.select({ id: sdlcProjects.id, name: sdlcProjects.name }).from(sdlcProjects).where(sql`id IN (${sql.join(ids.map(id => sql`${id}`), sql`, `)})`);
          const nameMap = new Map(projectRows.map(p => [p.id, p.name]));

          const toMap = (rows: { projectId: string; count: number }[]) =>
            new Map(rows.map(r => [r.projectId, r.count]));

          const issueMap = toMap(issuesByProject);
          const epicMap = toMap(epicsByProject);
          const reqMap = toMap(reqsByProject);
          const backlogMap = toMap(backlogByProject);
          const docMap = toMap(docsByProject);

          workItemsByProject = ids.map(pid => {
            const i = issueMap.get(pid) || 0;
            const e = epicMap.get(pid) || 0;
            const r = reqMap.get(pid) || 0;
            const b = backlogMap.get(pid) || 0;
            const d = docMap.get(pid) || 0;
            return {
              projectId: pid,
              projectName: nameMap.get(pid) || 'Unknown Project',
              issues: i,
              epics: e,
              requirements: r,
              backlog: b,
              documents: d,
              total: i + e + r + b + d,
            };
          });
        }
      } catch (err) {
        console.error("Error fetching workItemsByProject:", err);
      }

      return {
        organizations: normalizedOrganizationName ? 1 : (artifactOrgCount[0]?.count || 0) + (jiraConnectionCount[0]?.count || 0),
        projects: sdlcProjectCount[0]?.count || 0,
        sdlcProjects: sdlcProjectCount[0]?.count || 0,
        goldenRepositories: goldenRepositoryCount[0]?.count || 0,
        totalWorkItems,
        workItems: { issues, epics, requirements, backlog, documents },
        generatedArtifacts,
        workItemsByProject,
        wikiPages: wikiPageCount[0]?.count || 0,
        phases: {
          total: totalPhases,
          active: activePhases,
          completed: completedPhases,
        },
        phasesByProject,
        recentProjects: recentProjects || [],
        recentOrganizations: allRecentOrganizations,
      };
    } catch (error) {
      console.error("Error fetching dashboard metrics:", error);
      return emptyMetrics;
    }
  }

  // Get count of repositories from adoSettings organization
  async getGoldenRepositoriesCountFromAdoSettings(): Promise<number> {
    try {
      // Get ADO settings (golden repo organization configuration)
      const settings = await this.getAdoSettings();

      if (!settings) {
        console.log(`[Storage] No ADO settings found`);
        return 0;
      }

      // Check if PAT token is configured
      if (!settings.patToken || settings.patToken.trim() === '') {
        console.log(`[Storage] PAT token not configured in ADO settings`);
        return 0;
      }

      // Decrypt PAT token
      const { safeDecryptPAT } = await import("./crypto-utils");
      const decryptedPAT = safeDecryptPAT(settings.patToken);

      if (!decryptedPAT) {
        console.log(`[Storage] Could not decrypt PAT token from ADO settings`);
        return 0;
      }

      // Normalize organization URL
      let normalizedOrgUrl = settings.organizationUrl.trim();
      if (!normalizedOrgUrl.endsWith('/')) {
        normalizedOrgUrl += '/';
      }

      // Fetch repositories from Azure DevOps API
      const reposUrl = `${normalizedOrgUrl}_apis/git/repositories?api-version=${settings.apiVersion || '7.0'}`;
      const authHeader = `Basic ${Buffer.from(`:${decryptedPAT}`).toString("base64")}`;

      console.log(`[Storage] Fetching repositories from ADO settings: ${normalizedOrgUrl}, Project: ${settings.projectName}`);

      const reposResponse = await fetch(reposUrl, {
        headers: {
          "Authorization": authHeader,
          "Content-Type": "application/json",
        },
      });

      if (!reposResponse.ok) {
        console.error(`[Storage] Failed to fetch repositories from ADO settings: ${reposResponse.status}`);
        return 0;
      }

      const reposData = await reposResponse.json();
      // Filter repositories by project name
      const repositories = (reposData.value || []).filter((repo: any) =>
        repo.project?.name === settings.projectName
      );

      const count = repositories.length;
      console.log(`[Storage] Found ${count} repositories from ADO settings organization`);
      return count;
    } catch (error) {
      console.error("Error fetching repositories from ADO settings:", error);
      return 0;
    }
  }

  // Get phases grouped by project
  async getPhasesByProject(): Promise<any[]> {
    try {
      // Get all projects
      const projects = await db.select({
        id: sdlcProjects.id,
        name: sdlcProjects.name,
      }).from(sdlcProjects);

      console.log(`[Storage] Found ${projects.length} projects for phases breakdown`);

      // Get phase counts and wiki page counts for each project
      const phasesByProject = await Promise.all(
        projects.map(async (project) => {
          const [total, active, completed] = await Promise.all([
            db.select({ count: count() })
              .from(sdlcPhases)
              .where(eq(sdlcPhases.projectId, project.id)),
            db.select({ count: count() })
              .from(sdlcPhases)
              .where(sql`project_id = ${project.id} AND status = 'in_progress'`),
            db.select({ count: count() })
              .from(sdlcPhases)
              .where(sql`project_id = ${project.id} AND status = 'completed'`),
          ]);

          const totalCount = total[0]?.count || 0;
          const activeCount = active[0]?.count || 0;
          const completedCount = completed[0]?.count || 0;
          const pendingCount = Math.max(0, totalCount - activeCount - completedCount);

          return {
            projectId: project.id,
            projectName: project.name,
            total: totalCount,
            active: activeCount,
            completed: completedCount,
            pending: pendingCount,
          };
        })
      );

      // Filter out projects with 0 phases and sort by total descending
      const filtered = phasesByProject
        .filter((item) => item.total > 0)
        .sort((a, b) => b.total - a.total);

      console.log(`[Storage] Returning ${filtered.length} projects with phases`);
      return filtered;
    } catch (error) {
      console.error("Error fetching phases by project:", error);
      return [];
    }
  }

  // Get work items grouped by project
  async getWorkItemsByProject(): Promise<any[]> {
    try {
      // Get all projects
      const projects = await db.select({
        id: sdlcProjects.id,
        name: sdlcProjects.name,
      }).from(sdlcProjects);

      console.log(`[Storage] Found ${projects.length} projects for work items breakdown`);

      // Get counts for each project
      const workItemsByProject = await Promise.all(
        projects.map(async (project) => {
          const [issues, epics, requirements, backlog, documents] = await Promise.all([
            db.select({ count: count() })
              .from(sdlcIssues)
              .where(eq(sdlcIssues.projectId, project.id)),
            db.select({ count: count() })
              .from(sdlcEpics)
              .where(eq(sdlcEpics.projectId, project.id)),
            db.select({ count: count() })
              .from(sdlcRequirements)
              .where(eq(sdlcRequirements.projectId, project.id)),
            db.select({ count: count() })
              .from(sdlcBacklogItems)
              .where(eq(sdlcBacklogItems.projectId, project.id)),
            db.select({ count: count() })
              .from(sdlcDocuments)
              .where(eq(sdlcDocuments.projectId, project.id)),
          ]);

          const issuesCount = issues[0]?.count || 0;
          const epicsCount = epics[0]?.count || 0;
          const requirementsCount = requirements[0]?.count || 0;
          const backlogCount = backlog[0]?.count || 0;
          const documentsCount = documents[0]?.count || 0;
          const total = issuesCount + epicsCount + requirementsCount + backlogCount + documentsCount;

          return {
            projectId: project.id,
            projectName: project.name,
            issues: issuesCount,
            epics: epicsCount,
            requirements: requirementsCount,
            backlog: backlogCount,
            documents: documentsCount,
            total,
          };
        })
      );

      // Sort by total descending, then filter out projects with 0 work items
      const filtered = workItemsByProject
        .filter((item) => item.total > 0)
        .sort((a, b) => b.total - a.total);

      console.log(`[Storage] Returning ${filtered.length} projects with work items`);
      return filtered;
    } catch (error) {
      console.error("Error fetching work items by project:", error);
      return [];
    }
  }

  // Development Repositories
  async getDevelopmentRepositories(projectId: string): Promise<any[]> {
    return await db.select().from(developmentRepositories).where(eq(developmentRepositories.projectId, projectId));
  }

  async getDevelopmentRepository(id: string): Promise<any | undefined> {
    const result = await db.select().from(developmentRepositories).where(eq(developmentRepositories.id, id)).limit(1);
    return result[0];
  }

  async createDevelopmentRepository(data: z.infer<typeof insertDevelopmentRepositorySchema>): Promise<any> {
    const id = randomUUID();
    await db.insert(developmentRepositories).values({ ...data, id });
    const inserted = await db.select().from(developmentRepositories).where(eq(developmentRepositories.id, id)).limit(1);
    if (!inserted[0]) {
      throw new Error("Failed to create development repository");
    }
    return inserted[0];
  }

  // Development Branches
  async getDevelopmentBranches(repositoryId: string): Promise<any[]> {
    return await db.select().from(developmentBranches).where(eq(developmentBranches.repositoryId, repositoryId));
  }

  async createDevelopmentBranch(data: z.infer<typeof insertDevelopmentBranchSchema>): Promise<any> {
    const id = randomUUID();
    await db.insert(developmentBranches).values({ ...data, id });
    const inserted = await db.select().from(developmentBranches).where(eq(developmentBranches.id, id)).limit(1);
    if (!inserted[0]) {
      throw new Error("Failed to create development branch");
    }
    return inserted[0];
  }

  async getDevelopmentBranch(id: string): Promise<any | undefined> {
    const result = await db.select().from(developmentBranches).where(eq(developmentBranches.id, id)).limit(1);
    return result[0];
  }

  async updateBranchActive(branchId: string, isActive: boolean): Promise<any> {
    await db
      .update(developmentBranches)
      .set({ isDefault: isActive ? 1 : 0, updatedAt: new Date() })
      .where(eq(developmentBranches.id, branchId));

    const updated = await db.select().from(developmentBranches).where(eq(developmentBranches.id, branchId)).limit(1);
    if (!updated[0]) {
      throw new Error("Branch not found");
    }
    return updated[0];
  }

  async updateBranchCommitCount(branchId: string, count: number): Promise<any> {
    await db
      .update(developmentBranches)
      .set({ commits: count, lastCommitAt: new Date(), updatedAt: new Date() })
      .where(eq(developmentBranches.id, branchId));

    const updated = await db.select().from(developmentBranches).where(eq(developmentBranches.id, branchId)).limit(1);
    if (!updated[0]) {
      throw new Error("Branch not found");
    }
    return updated[0];
  }

  // Development Code
  async getCode(repositoryId: string, branchId: string): Promise<any[]> {
    return await db.select()
      .from(sdlcCode)
      .where(
        sql`${sdlcCode.repositoryId} = ${repositoryId} AND ${sdlcCode.branchId} = ${branchId}`
      );
  }

  async createCode(data: z.infer<typeof insertSDLCCodeSchema>): Promise<any> {
    const id = randomUUID();
    await db.insert(sdlcCode).values({ ...data, id });
    const inserted = await db.select().from(sdlcCode).where(eq(sdlcCode.id, id)).limit(1);
    if (!inserted[0]) {
      throw new Error("Failed to create code");
    }
    return inserted[0];
  }

  // Development Commits
  async getCommits(repositoryId: string, branchId?: string): Promise<any[]> {
    if (branchId) {
      return await db.select()
        .from(sdlcCommits)
        .where(
          sql`${sdlcCommits.repositoryId} = ${repositoryId} AND ${sdlcCommits.branchId} = ${branchId}`
        )
        .orderBy(sql`${sdlcCommits.createdAt} DESC`);
    }
    return await db.select()
      .from(sdlcCommits)
      .where(eq(sdlcCommits.repositoryId, repositoryId))
      .orderBy(sql`${sdlcCommits.createdAt} DESC`);
  }

  async createCommit(data: z.infer<typeof insertSDLCCommitSchema>): Promise<any> {
    const id = randomUUID();
    await db.insert(sdlcCommits).values({ ...data, id });
    const inserted = await db.select().from(sdlcCommits).where(eq(sdlcCommits.id, id)).limit(1);
    if (!inserted[0]) {
      throw new Error("Failed to create commit");
    }
    return inserted[0];
  }

  // Development Preview
  async getPreview(repositoryId: string): Promise<any | undefined> {
    const result = await db.select()
      .from(sdlcPreviews)
      .where(eq(sdlcPreviews.repositoryId, repositoryId))
      .limit(1);
    return result[0];
  }

  async createPreview(data: z.infer<typeof insertSDLCPreviewSchema>): Promise<any> {
    const id = randomUUID();
    await db.insert(sdlcPreviews).values({ ...data, id });
    const inserted = await db.select().from(sdlcPreviews).where(eq(sdlcPreviews.id, id)).limit(1);
    if (!inserted[0]) {
      throw new Error("Failed to create preview");
    }
    return inserted[0];
  }

  async updatePreview(id: string, data: Partial<z.infer<typeof insertSDLCPreviewSchema>>): Promise<any> {
    await db
      .update(sdlcPreviews)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(sdlcPreviews.id, id));

    const updated = await db.select().from(sdlcPreviews).where(eq(sdlcPreviews.id, id)).limit(1);
    if (!updated[0]) {
      throw new Error("Preview not found");
    }
    return updated[0];
  }

  // Prompts
  async getPrompts(): Promise<Prompt[]> {
    return await db.select().from(prompts).orderBy(sql`${prompts.createdAt} DESC`);
  }

  async getPrompt(id: string): Promise<Prompt | undefined> {
    const result = await db.select().from(prompts).where(eq(prompts.id, id)).limit(1);
    return result[0];
  }

  async createPrompt(data: InsertPrompt): Promise<Prompt> {
    const id = randomUUID();
    await db.insert(prompts).values({ ...data, id });
    const inserted = await db.select().from(prompts).where(eq(prompts.id, id)).limit(1);
    if (!inserted[0]) {
      throw new Error("Failed to create prompt");
    }
    return inserted[0];
  }

  async updatePrompt(id: string, data: Partial<InsertPrompt>): Promise<Prompt> {
    await db
      .update(prompts)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(prompts.id, id));

    const updated = await db.select().from(prompts).where(eq(prompts.id, id)).limit(1);
    if (!updated[0]) {
      throw new Error("Prompt not found");
    }
    return updated[0];
  }

  async deletePrompt(id: string): Promise<void> {
    await db.delete(prompts).where(eq(prompts.id, id));
  }

  async incrementPromptUsage(id: string): Promise<void> {
    await db
      .update(prompts)
      .set({ usageCount: sql`${prompts.usageCount} + 1` })
      .where(eq(prompts.id, id));
  }

  async initializeDefaultPrompts(): Promise<void> {
    try {
      const existing = await db.select().from(prompts).limit(1);
      if (existing.length > 0) {
        return;
      }
      console.log("[Storage] Seeding default prompts...");
      for (const prompt of DEFAULT_PROMPTS) {
        await db.insert(prompts).values({ ...prompt, id: randomUUID() });
      }
      console.log(`[Storage] ✓ Seeded ${DEFAULT_PROMPTS.length} default prompts`);
    } catch (error) {
      console.warn("[Storage] initializeDefaultPrompts failed:", error instanceof Error ? error.message : error);
    }
  }
}

export const storage = new MemStorage();
