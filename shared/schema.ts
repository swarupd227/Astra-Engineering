import { sql } from "drizzle-orm";
import {
  mysqlTable,
  varchar,
  text,
  longtext,
  int,
  timestamp,
  json,
  boolean,
  bigint,
  mysqlEnum,
  uniqueIndex,
  index,
  date,
  customType,
  decimal,
  tinyint,
} from "drizzle-orm/mysql-core";

const longBlob = customType<{ data: Buffer }>({
  dataType() {
    return "longblob";
  },
});
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Tenants table for multi-tenancy support
export const tenants = mysqlTable("tenants", {
  id: varchar("id", { length: 36 })
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: varchar("name", { length: 255 }).notNull().unique(),
  status: varchar("status", { length: 50 }).notNull().default("active"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type Tenant = typeof tenants.$inferSelect;

// Subscription types (bootstrap: one type "DEFAULT")
export const subscriptionTypes = mysqlTable("subscription_types", {
  id: int("id").primaryKey().autoincrement(),
  code: varchar("code", { length: 50 }).notNull().unique(),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type SubscriptionType = typeof subscriptionTypes.$inferSelect;

// Subscriptions (one active per tenant; no enforcement)
export const subscriptions = mysqlTable("subscriptions", {
  id: varchar("id", { length: 36 })
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  tenantId: varchar("tenant_id", { length: 36 }).notNull(),
  subscriptionTypeId: varchar("subscription_type_id", { length: 36 }).notNull(),
  maxUsers: int("max_users").notNull().default(50),
  tokenQuota: bigint("token_quota", { mode: "number" }).notNull().default(0),
  tokenUsed: bigint("token_used", { mode: "number" }).notNull().default(0),
  startDate: timestamp("start_date").defaultNow().notNull(),
  expiryDate: timestamp("expiry_date").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type Subscription = typeof subscriptions.$inferSelect;

// Token usage logs — audit trail for token consumption per tenant/user
export const tokenUsageLogs = mysqlTable("token_usage_logs", {
  id: varchar("id", { length: 36 })
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  tenantId: varchar("tenant_id", { length: 36 }).notNull(),
  userId: varchar("user_id", { length: 36 }).notNull(),
  tokensConsumed: bigint("tokens_consumed", { mode: "number" }).notNull(),
  modelName: varchar("model_name", { length: 100 }).notNull().default("BRD_STANDARD_COST"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type TokenUsageLog = typeof tokenUsageLogs.$inferSelect;

// License keys (one per tenant; passive, not validated)
export const licenseKeys = mysqlTable("license_keys", {
  id: varchar("id", { length: 36 })
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  tenantId: varchar("tenant_id", { length: 36 }).notNull(),
  licenseHash: varchar("license_hash", { length: 255 }).notNull(),
  salt: varchar("salt", { length: 255 }).notNull(),
  integrityHash: varchar("integrity_hash", { length: 255 }).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type LicenseKey = typeof licenseKeys.$inferSelect;

// NOTE: The physical MySQL `users` table in the current environments
// has the following columns:
//   id           CHAR(36) PRIMARY KEY
//   azure_oid    VARCHAR(100) NOT NULL UNIQUE
//   email        VARCHAR(255) NOT NULL
//   display_name VARCHAR(255)
//   tenant_id    VARCHAR(36) (FK to tenants.id)
//   provider     VARCHAR(50) (azure | github)
//   provider_user_id VARCHAR(255) (azureOid or githubId)
//   created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP
//   username     TEXT NOT NULL (present in some environments, e.g. prod)
//
// This Drizzle schema is aligned to that structure to avoid runtime
// "Unknown column" / "Field doesn't have a default value" errors.
export const users = mysqlTable("users", {
  id: varchar("id", { length: 36 })
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  azureOid: varchar("azure_oid", { length: 100 }).notNull(), // Azure AD Object ID
  email: varchar("email", { length: 255 }).notNull(),
  displayName: varchar("display_name", { length: 255 }),
  tenantId: varchar("tenant_id", { length: 36 }), // FK to tenants.id
  provider: varchar("provider", { length: 50 }), // azure | github
  providerUserId: varchar("provider_user_id", { length: 255 }), // azureOid or githubId
  createdAt: timestamp("created_at").defaultNow().notNull(),
  tokenQuota: int("token_quota").notNull().default(0),
  tokenUsed: int("token_used").notNull().default(0),
  mfaSecret: varchar("mfa_secret", { length: 255 }),
  isMfaEnabled: boolean("is_mfa_enabled").notNull().default(false),
  isDeleted: boolean("is_deleted").notNull().default(false), // Soft-delete flag
  deletedAt: timestamp("deleted_at"),                        // Soft-delete timestamp
  onboardingCompleted: boolean("onboarding_completed").notNull().default(false), // Optional profile setup marker; credentials are validated contextually.
  onboardingCompletedAt: timestamp("onboarding_completed_at"),                    // When onboarding was completed
});

export const insertUserSchema = createInsertSchema(users).omit({
  id: true,
  createdAt: true,
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;

// Roles table for RBAC
export const roles = mysqlTable("roles", {
  id: int("id").primaryKey().autoincrement(),
  name: varchar("name", { length: 50 }).notNull().unique(),
});

// User Roles table for RBAC (normalized: user -> role -> scope)
export const userRoles = mysqlTable("user_roles", {
  id: varchar("id", { length: 36 })
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  userId: varchar("user_id", { length: 36 }).notNull(),
  tenantId: varchar("tenant_id", { length: 100 }).notNull(),
  provider: varchar("provider", { length: 50 }).notNull(),
  roleId: int("role_id").notNull(),
  scopeType: mysqlEnum("scope_type", ["org", "project"]).notNull(),
  scopeId: varchar("scope_id", { length: 500 }).notNull(), // "ALL" or comma-separated org/project IDs
  createdAt: timestamp("created_at").defaultNow().notNull(),
  createdBy: varchar("created_by", { length: 36 }),
});

// Audit log for RBAC and other security-sensitive actions
export const auditLogs = mysqlTable("audit_logs", {
  id: varchar("id", { length: 36 })
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  actorUserId: varchar("actor_user_id", { length: 36 }).notNull(),
  targetUserId: varchar("target_user_id", { length: 36 }).notNull(),
  action: mysqlEnum("action", ["ROLE_ASSIGNED", "ROLE_REMOVED", "USER_SOFT_DELETED"]).notNull(),
  role: varchar("role", { length: 50 }).notNull(),
  tenantId: varchar("tenant_id", { length: 100 }).notNull(),
  projectId: varchar("project_id", { length: 36 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertUserRoleSchema = createInsertSchema(userRoles).omit({
  id: true,
  createdAt: true,
});

export type InsertUserRole = z.infer<typeof insertUserRoleSchema>;
export type UserRole = typeof userRoles.$inferSelect;

// Role activity permissions (RBAC – which activities are enabled per role, per tenant)
export const roleActivityPermissions = mysqlTable(
  "role_activity_permissions",
  {
    id: varchar("id", { length: 36 })
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    tenantId: varchar("tenant_id", { length: 100 }).notNull(),
    provider: varchar("provider", { length: 50 }).notNull(),
    roleId: int("role_id").notNull(),
    activityKey: varchar("activity_key", { length: 255 }).notNull(),
    enabled: boolean("enabled").notNull(),
    updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
  },
  (table) => [
    uniqueIndex("role_activity_permissions_tenant_provider_role_activity").on(
      table.tenantId,
      table.provider,
      table.roleId,
      table.activityKey
    ),
  ]
);

export type RoleActivityPermission = typeof roleActivityPermissions.$inferSelect;

// Organizations (RBAC / tenant-level)
export const organizations = mysqlTable("organizations", {
  id: varchar("id", { length: 36 })
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  tenantId: varchar("tenant_id", { length: 100 }).notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  ownerUserId: varchar("owner_user_id", { length: 36 }), // Creator; org is private to owner + invited members
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Projects
export const projects = mysqlTable("projects", {
  id: varchar("id", { length: 36 })
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  organizationId: varchar("organization_id", { length: 36 }),
  name: text("name").notNull(),
  description: text("description"),
  status: varchar("status", { length: 50 }).notNull().default("active"),
  type: varchar("type", { length: 50 }).notNull().default("development"),
  ownerUserId: varchar("owner_user_id", { length: 36 }), // Creator; project is private to owner + invited members
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Organization membership — source of truth for who can see/use an organization.
// Separate from RBAC user_roles; "owner" is the creator, "member" is an invited user.
export const organizationMembers = mysqlTable("organization_members", {
  id: varchar("id", { length: 36 })
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  organizationId: varchar("organization_id", { length: 36 }).notNull(),
  userId: varchar("user_id", { length: 36 }).notNull(),
  tenantId: varchar("tenant_id", { length: 100 }).notNull(),
  role: varchar("role", { length: 20 }).notNull().default("member"), // owner | member
  invitedBy: varchar("invited_by", { length: 36 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  uniqOrgUser: uniqueIndex("uniq_org_member").on(table.organizationId, table.userId),
}));

export type OrganizationMember = typeof organizationMembers.$inferSelect;

// Project membership — source of truth for who can see/use a project.
export const projectMembers = mysqlTable("project_members", {
  id: varchar("id", { length: 36 })
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  projectId: varchar("project_id", { length: 36 }).notNull(),
  userId: varchar("user_id", { length: 36 }).notNull(),
  tenantId: varchar("tenant_id", { length: 100 }).notNull(),
  role: varchar("role", { length: 20 }).notNull().default("member"), // owner | member
  invitedBy: varchar("invited_by", { length: 36 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  uniqProjectUser: uniqueIndex("uniq_project_member").on(table.projectId, table.userId),
}));

export type ProjectMember = typeof projectMembers.$inferSelect;

// Workflow Types (for in-memory/API usage)
export const personaSchema = z.object({
  id: z.string(),
  name: z.string(),
  role: z.string(),
  color: z.string(),
  focus: z.string(),
  painPoints: z.array(z.string()),
  goals: z.array(z.string()),
});

export const epicSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  priority: z.enum(["High", "Medium", "Low"]),
  featureCount: z.number().optional(),
  adoWorkItemId: z.number().optional(), // Azure DevOps work item ID (null if not yet pushed)
  brdId: z.string().optional(), // BRD document ID
  requirementId: z.string().optional(), // Requirement ID
});

export const featureSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  epicId: z.string(),
  priority: z.enum(["High", "Medium", "Low"]),
  storyCount: z.number().optional(),
  adoWorkItemId: z.number().optional(), // Azure DevOps work item ID (null if not yet pushed)
});

export const acceptanceCriterionSchema = z.object({
  title: z.string().optional(),
  given: z.string(),
  when: z.string(),
  then: z.string(),
  and: z.string().optional(),
});

export const userStorySchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  persona: z.string(),
  personaId: z.string(),
  acceptanceCriteria: z.array(acceptanceCriterionSchema),
  subtasks: z.array(z.string()).optional(),
  pushedTasks: z.array(z.number()).optional(),
  priority: z.enum(["High", "Medium", "Low"]),
  storyPoints: z.number(),
  featureId: z.string(),
  epicId: z.string(),
  adoWorkItemId: z.number().optional(),
  generatedByQA: z.boolean().optional(),
  designPromptGenerated: z.boolean().optional(),
});

export const workflowSessionSchema = z.object({
  id: z.string(),
  requirement: z.string(),
  guidelines: z.string().optional(),
  epics: z.array(epicSchema).optional(),
  features: z.array(featureSchema).optional(),
  userStories: z.array(userStorySchema).optional(),
  personas: z.array(personaSchema).optional(),
  currentStep: z.number().default(1),
  azureConfig: z
    .object({
      organization: z.string(),
      project: z.string(),
      repository: z.string(),
      branch: z.string(),
      pat: z.string().optional(),
    })
    .optional(),
});

export type Persona = z.infer<typeof personaSchema>;
export type Epic = z.infer<typeof epicSchema>;
export type Feature = z.infer<typeof featureSchema>;
export type UserStory = z.infer<typeof userStorySchema>;
export type AcceptanceCriterion = z.infer<typeof acceptanceCriterionSchema>;
export type WorkflowSession = z.infer<typeof workflowSessionSchema>;

// Golden Repositories - PostgreSQL array converted to JSON
export const goldenRepositories = mysqlTable("golden_repositories", {
  id: varchar("id", { length: 36 })
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: text("name").notNull(),
  description: text("description").notNull(),
  technologies: json("technologies").$type<string[]>().notNull(),
  stars: int("stars").notNull().default(0),
  cloudProvider: text("cloud_provider"),
  repositoryUrl: text("repository_url"),
  category: text("category"),
  domain: text("domain").notNull().default("insurance"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Azure DevOps Settings
export const adoSettings = mysqlTable("ado_settings", {
  id: varchar("id", { length: 36 })
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  organizationUrl: text("organization_url").notNull(),
  projectName: text("project_name").notNull(),
  repository: text("repository"),
  branch: text("branch"),
  patToken: text("pat_token"),
  apiVersion: text("api_version").notNull().default("7.0"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Artifact Organizations for cross-org PAT management
export const artifactOrganizations = mysqlTable("artifact_organizations", {
  id: varchar("id", { length: 36 })
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  projectName: text("project_name").notNull(),
  organizationUrl: text("organization_url").notNull(),
  patToken: text("pat_token"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Golden Repository Organizations - Multiple org support with encrypted PAT
export const goldenRepoOrganizations = mysqlTable("golden_repo_organizations", {
  id: varchar("id", { length: 36 })
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: text("name").notNull(),
  organizationUrl: text("organization_url").notNull(),
  projectName: text("project_name").notNull(),
  repositoryName: text("repository_name"),
  apiVersion: text("api_version").notNull().default("7.0"),
  patToken: text("pat_token"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Conversational UI Settings - Dedicated ADO configuration for chat agent
export const conversationalUiSettings = mysqlTable(
  "conversational_ui_settings",
  {
    id: varchar("id", { length: 36 })
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    organizationName: text("organization_name").notNull(),
    projectName: text("project_name").notNull(),
    patToken: text("pat_token"), // Encrypted PAT token
    apiVersion: varchar("api_version", { length: 20 }).notNull().default("7.0"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
);

// Workflow Settings
export const workflowSettings = mysqlTable("workflow_settings", {
  id: varchar("id", { length: 36 })
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  repositoryName: text("repository_name"),
  projectName: text("project_name"),
  organizationUrl: text("organization_url"),
  patToken: text("pat_token"),
});

// SDLC Settings
export const sdlcSettings = mysqlTable("sdlc_settings", {
  id: varchar("id", { length: 36 })
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  // Azure DevOps Configuration
  organizationName: text("organization_name"),
  projectName: text("project_name"),
  patToken: text("pat_token"), // Encrypted PAT token
  apiVersion: varchar("api_version", { length: 20 }).default("7.0"),
  // Workflow Settings
  phaseUnlockThreshold: text("phase_unlock_threshold").default("80"),
  enableAutoPhaseUnlock: text("enable_auto_phase_unlock").default("true"),
  requirePhaseApprovals: text("require_phase_approvals").default("false"),
  defaultAssignee: text("default_assignee"),
  enableNotifications: text("enable_notifications").default("true"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// User Personas for Story Generation
export const personas = mysqlTable("personas", {
  id: varchar("id", { length: 36 })
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: text("name").notNull(),
  role: text("role").notNull(),
  color: text("color").notNull(),
  focus: text("focus").notNull(),
  painPoints: json("pain_points").$type<string[]>().notNull(),
  goals: json("goals").$type<string[]>().notNull(),
  isDefault: int("is_default").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertPersonaSchema = createInsertSchema(personas).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

// Wiki Documentation Pages
export const wikiPages = mysqlTable("wiki_pages", {
  id: varchar("id", { length: 36 })
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  projectId: varchar("project_id", { length: 36 }),
  sessionId: varchar("session_id", { length: 36 }),
  pageType: text("page_type").notNull(),
  phase: varchar("phase", { length: 50 }).notNull().default("reference"), // SDLC phase: planning, requirements, design, implementation, testing, deployment, agile, reference
  title: text("title").notNull(),
  content: longtext("content").notNull(),
  order: int("order").default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// SDLC Specs & Requirements Files (generated from ADO features/user stories)
export const sdlcSpecsFiles = mysqlTable("sdlc_specs_files", {
  id: varchar("id", { length: 36 })
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  projectId: varchar("project_id", { length: 36 }).notNull(),
  featureId: int("feature_id").notNull(),
  featureTitle: text("feature_title").notNull(),
  fileType: text("file_type").notNull(), // "specs", "requirements", or "tdd-tests"
  fileName: text("file_name").notNull(),
  path: text("path").notNull(),
  content: longtext("content").notNull(),
  userStoriesJson: json("user_stories_json"),
  pushedToAdo: boolean("pushed_to_ado").default(false).notNull(),
  contentHash: varchar("content_hash", { length: 64 }),
  repoCommitId: varchar("repo_commit_id", { length: 40 }),
  inputHash: varchar("input_hash", { length: 64 }),    // SHA-256 of feature inputs for idempotency
  specVersion: int("spec_version").default(1),          // increments on each regeneration
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// SDLC Project Management
export const sdlcProjects = mysqlTable("sdlc_projects", {
  id: varchar("id", { length: 36 })
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: text("name").notNull(),
  description: text("description"),
  organization: text("organization"),
  repository_id: varchar("repository_id", { length: 36 }),
  repositoryCount: int("repository_count").default(0),
  cloudProvider: text("cloud_provider"),
  projectId: varchar("project_id", { length: 255 }),
  adoProjecturl: text("ado_project_url"),
  linkedGoldenRepoOrg: text("linked_golden_repo_org"),
  linkedGoldenRepoProject: text("linked_golden_repo_project"),
  linkedGoldenRepoName: text("linked_golden_repo_name"),
  goldenRepoReference: json("golden_repo_reference").$type<{
    repoId: string;
    repoName: string;
    filePaths: string[];
    provider?: "ado" | "github" | "gitlab";
    repoUrl?: string;
    defaultBranch?: string;
  } | null>(),
  status: text("status").notNull().default("active"),
  deletedFromAdo: boolean("deleted_from_ado").default(false),
  enableTdd: boolean("enable_tdd").default(false),
  specsArchitectureStyle: varchar("specs_architecture_style", { length: 50 }),
  specsDeliveryOrder: text("specs_delivery_order"),
  integrationType: varchar("integration_type", { length: 50 }).default("ado").notNull(),
  jiraConnectionId: varchar("jira_connection_id", { length: 36 }),
  jiraInstanceUrl: text("jira_instance_url"),
  jiraProjectKey: varchar("jira_project_key", { length: 100 }),
  ownerUserId: varchar("owner_user_id", { length: 36 }), // Creator/importer; core SDLC project owner
  isGenerating: boolean("is_generating").default(false), // generation mutex lock
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const sdlcPhases = mysqlTable("sdlc_phases", {
  id: varchar("id", { length: 36 })
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  projectId: varchar("project_id", { length: 36 }).notNull(),
  phaseNumber: int("phase_number").notNull(),
  phaseName: text("phase_name").notNull(),
  status: text("status").notNull().default("not_started"),
  progress: int("progress").notNull().default(0),
  notes: text("notes"),
  assignedTo: text("assigned_to"),
  deliverables: text("deliverables"),
  startDate: timestamp("start_date"),
  endDate: timestamp("end_date"),
  completedDate: timestamp("completed_date"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const phaseConfirmations = mysqlTable("phase_confirmations", {
  id: varchar("id", { length: 36 })
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  phaseId: varchar("phase_id", { length: 36 }).notNull(),
  confirmerRole: text("confirmer_role").notNull(),
  status: text("status").notNull().default("pending"),
  confirmerName: text("confirmer_name"),
  comments: text("comments"),
  confirmedAt: timestamp("confirmed_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const developmentRepositories = mysqlTable("development_repositories", {
  id: varchar("id", { length: 36 })
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  projectId: varchar("project_id", { length: 36 }).notNull(),
  name: text("name").notNull(),
  description: text("description"),
  defaultBranch: text("default_branch").default("main"),
  commits: int("commits").default(0),
  contributors: int("contributors").default(1),
  size: text("size").default("0 MB"),
  license: text("license").default("MIT"),
  lastCommitAt: timestamp("last_commit_at"),
  repositoryUrl: text("repository_url"),
  status: text("status").notNull().default("active"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const developmentBranches = mysqlTable("development_branches", {
  id: varchar("id", { length: 36 })
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  repositoryId: varchar("repository_id", { length: 36 }).notNull(),
  name: text("name").notNull(),
  isDefault: int("is_default").notNull().default(0),
  isProtected: int("is_protected").notNull().default(0),
  commits: int("commits").default(0),
  lastCommitAt: timestamp("last_commit_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

/** Per-project Git storage config for test artifacts (manual test cases, BDD). When absent, fallback to GitHub env. */
export const projectGitConfig = mysqlTable("project_git_config", {
  id: varchar("id", { length: 36 })
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  projectId: varchar("project_id", { length: 36 }).notNull(),
  provider: mysqlEnum("provider", ["github", "ado"]).notNull().default("ado"),
  branch: varchar("branch", { length: 255 }).notNull().default("main"),
  basePath: varchar("base_path", { length: 512 }),
  adoRepositoryId: varchar("ado_repository_id", { length: 36 }),
  adoRepositoryName: varchar("ado_repository_name", { length: 255 }),
  token: text("token"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertOrganizationSchema = createInsertSchema(organizations).omit({
  id: true,
  createdAt: true,
});

export const insertProjectSchema = createInsertSchema(projects).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertGoldenRepositorySchema = createInsertSchema(
  goldenRepositories,
).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertAdoSettingsSchema = createInsertSchema(adoSettings).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertArtifactOrganizationSchema = createInsertSchema(
  artifactOrganizations,
).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertGoldenRepoOrganizationSchema = createInsertSchema(
  goldenRepoOrganizations,
).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertConversationalUiSettingsSchema = createInsertSchema(
  conversationalUiSettings,
).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertWorkflowSettingsSchema = createInsertSchema(
  workflowSettings,
).omit({
  id: true,
});

export const insertSdlcSettingsSchema = createInsertSchema(sdlcSettings).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertWikiPageSchema = createInsertSchema(wikiPages).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertSDLCProjectSchema = createInsertSchema(sdlcProjects).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertSDLCPhaseSchema = createInsertSchema(sdlcPhases).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertProjectGitConfigSchema = createInsertSchema(projectGitConfig).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertPhaseConfirmationSchema = createInsertSchema(
  phaseConfirmations,
).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertDevelopmentRepositorySchema = createInsertSchema(
  developmentRepositories,
).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertDevelopmentBranchSchema = createInsertSchema(
  developmentBranches,
).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

// SDLC Work Items
export const sdlcIssues = mysqlTable("sdlc_issues", {
  id: varchar("id", { length: 36 })
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  projectId: varchar("project_id", { length: 36 }).notNull(),
  phaseNumber: int("phase_number").notNull(),
  title: text("title").notNull(),
  description: text("description"),
  status: text("status").notNull().default("open"),
  priority: text("priority").notNull().default("medium"),
  assignedTo: text("assigned_to"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const sdlcEpics = mysqlTable("sdlc_epics", {
  id: varchar("id", { length: 36 })
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  projectId: varchar("project_id", { length: 36 }).notNull(),
  phaseNumber: int("phase_number").notNull(),
  title: text("title").notNull(),
  description: text("description"),
  acceptanceCriteria: text("acceptance_criteria"),
  status: text("status").notNull().default("planned"),
  priority: text("priority").notNull().default("medium"),
  featureCount: int("feature_count").default(0),
  source: varchar("source", { length: 50 }).default("manual"),
  workflowSessionId: varchar("workflow_session_id", { length: 36 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const sdlcFeatures = mysqlTable("sdlc_features", {
  id: varchar("id", { length: 36 })
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  projectId: varchar("project_id", { length: 36 }).notNull(),
  phaseNumber: int("phase_number").notNull(),
  epicId: varchar("epic_id", { length: 36 }),
  title: text("title").notNull(),
  description: text("description"),
  acceptanceCriteria: text("acceptance_criteria"),
  status: varchar("status", { length: 50 }).notNull().default("planned"),
  priority: varchar("priority", { length: 50 }).notNull().default("medium"),
  storyCount: int("story_count").default(0),
  source: varchar("source", { length: 50 }).default("manual"),
  workflowSessionId: varchar("workflow_session_id", { length: 36 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const sdlcRequirements = mysqlTable("sdlc_requirements", {
  id: varchar("id", { length: 36 })
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  projectId: varchar("project_id", { length: 36 }).notNull(),
  phaseNumber: int("phase_number").notNull(),
  title: text("title").notNull(),
  description: text("description"),
  type: text("type").notNull().default("functional"),
  priority: text("priority").notNull().default("medium"),
  status: text("status").notNull().default("draft"),
  brdId: varchar("brd_id", { length: 36 }), // Link to BRD (optional - many-to-many relationship)
  requirementId: varchar("requirement_id", { length: 36 }), // Link to parent requirement (optional - for requirement hierarchy)
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const sdlcBacklogItems = mysqlTable("sdlc_backlog_items", {
  id: varchar("id", { length: 36 })
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  projectId: varchar("project_id", { length: 36 }).notNull(),
  phaseNumber: int("phase_number").notNull(),
  title: text("title").notNull(),
  description: text("description"),
  type: text("type").notNull().default("story"),
  storyPoints: int("story_points"),
  priority: text("priority").notNull().default("medium"),
  status: text("status").notNull().default("backlog"),
  assignedTo: text("assigned_to"),
  featureId: varchar("feature_id", { length: 36 }),
  epicId: varchar("epic_id", { length: 36 }),
  figmaLink: text("figma_link"),
  persona: text("persona"),
  personaId: varchar("persona_id", { length: 36 }),
  acceptanceCriteria: json("acceptance_criteria").$type<
    AcceptanceCriterion[]
  >(),
  subtasks: json("subtasks").$type<string[]>(),
  source: varchar("source", { length: 50 }).default("manual"),
  workflowSessionId: varchar("workflow_session_id", { length: 36 }),
  brdId: varchar("brd_id", { length: 36 }), // Link to BRD (optional)
  requirementId: varchar("requirement_id", { length: 36 }), // Link to requirement (optional)
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const sdlcDocuments = mysqlTable("sdlc_documents", {
  id: varchar("id", { length: 36 })
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  projectId: varchar("project_id", { length: 36 }).notNull(),
  phaseNumber: int("phase_number").notNull(),
  title: text("title").notNull(),
  content: longtext("content"),
  type: text("type").notNull().default("general"),
  brdId: varchar("brd_id", { length: 36 }), // Link to BRD (optional)
  requirementId: varchar("requirement_id", { length: 36 }), // Link to requirement (optional)
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const sdlcDesignAssets = mysqlTable("sdlc_design_assets", {
  id: varchar("id", { length: 36 })
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  projectId: varchar("project_id", { length: 36 }).notNull(),
  phaseNumber: int("phase_number").notNull(),
  name: text("name").notNull(),
  description: text("description"),
  fileUrl: longtext("file_url").notNull(),
  fileType: text("file_type").notNull(),
  fileSize: int("file_size"),
  thumbnailUrl: longtext("thumbnail_url"),
  uploadedBy: text("uploaded_by"),
  source: text("source").default("manual"),
  sourceDocumentId: varchar("source_document_id", { length: 36 }),
  designCategory: text("design_category"), // system-architecture, database-design, component-design, data-flow-design, interface-design, security-design
  adoWorkItemId: int("ado_work_item_id"), // Azure DevOps work item ID
  adoSyncedAt: timestamp("ado_synced_at"), // Last sync timestamp from ADO
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// ADO Design Phase Sync Tracking
export const adoDesignSync = mysqlTable("ado_design_sync", {
  id: varchar("id", { length: 36 })
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  projectId: varchar("project_id", { length: 36 }).notNull(),
  phaseNumber: int("phase_number").notNull().default(2), // Design Phase
  lastSyncAt: timestamp("last_sync_at"),
  syncStatus: text("sync_status").notNull().default("pending"), // pending, syncing, completed, failed
  syncedItemsCount: int("synced_items_count").default(0),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const sdlcFigmaLinks = mysqlTable("sdlc_figma_links", {
  id: varchar("id", { length: 36 })
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  projectId: varchar("project_id", { length: 36 }).notNull(),
  phaseNumber: int("phase_number").notNull(),
  title: text("title").notNull(),
  description: text("description"),
  figmaUrl: text("figma_url").notNull(),
  accessLevel: text("access_level").notNull().default("view"),
  createdBy: text("created_by"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const sdlcDesignReviews = mysqlTable("sdlc_design_reviews", {
  id: varchar("id", { length: 36 })
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  projectId: varchar("project_id", { length: 36 }).notNull(),
  phaseNumber: int("phase_number").notNull(),
  designAssetId: varchar("design_asset_id", { length: 36 }),
  title: text("title").notNull(),
  description: text("description"),
  status: text("status").notNull().default("pending"),
  reviewedBy: text("reviewed_by"),
  comments: text("comments"),
  reviewDate: timestamp("review_date"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Development Phase - Code, Commits, and Preview Management
export const sdlcCode = mysqlTable("sdlc_code", {
  id: varchar("id", { length: 36 })
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  repositoryId: varchar("repository_id", { length: 36 }).notNull(),
  branchId: varchar("branch_id", { length: 36 }).notNull(),
  content: longtext("content").notNull(),
  language: text("language").notNull().default("typescript"),
  fileName: text("file_name"),
  filePath: text("file_path"),
  generatedFrom: text("generated_from"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const sdlcCommits = mysqlTable("sdlc_commits", {
  id: varchar("id", { length: 36 })
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  repositoryId: varchar("repository_id", { length: 36 }).notNull(),
  branchId: varchar("branch_id", { length: 36 }).notNull(),
  message: text("message").notNull(),
  commitNumber: int("commit_number").notNull().default(1),
  author: text("author").notNull().default("System"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const sdlcPreviews = mysqlTable("sdlc_previews", {
  id: varchar("id", { length: 36 })
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  repositoryId: varchar("repository_id", { length: 36 }).notNull(),
  branchId: varchar("branch_id", { length: 36 }).notNull(),
  status: text("status").notNull().default("active"),
  previewUrl: text("preview_url"),
  codeStatus: text("code_status").notNull().default("generated"),
  commitCount: int("commit_count").notNull().default(1),
  lastCommitMessage: text("last_commit_message"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertSDLCIssueSchema = createInsertSchema(sdlcIssues).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertSDLCEpicSchema = createInsertSchema(sdlcEpics).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertSDLCFeatureSchema = createInsertSchema(sdlcFeatures).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertSDLCRequirementSchema = createInsertSchema(
  sdlcRequirements,
).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertSDLCBacklogItemSchema = createInsertSchema(
  sdlcBacklogItems,
).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertSDLCDocumentSchema = createInsertSchema(sdlcDocuments).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertSDLCDesignAssetSchema = createInsertSchema(
  sdlcDesignAssets,
).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertSDLCFigmaLinkSchema = createInsertSchema(
  sdlcFigmaLinks,
).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertSDLCDesignReviewSchema = createInsertSchema(
  sdlcDesignReviews,
).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertAdoDesignSyncSchema = createInsertSchema(adoDesignSync).omit(
  {
    id: true,
    createdAt: true,
    updatedAt: true,
  },
);

export const insertSDLCCodeSchema = createInsertSchema(sdlcCode).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertSDLCCommitSchema = createInsertSchema(sdlcCommits).omit({
  id: true,
  createdAt: true,
});

export const insertSDLCPreviewSchema = createInsertSchema(sdlcPreviews).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

const ALLOWED_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/svg+xml",
  "application/pdf",
];
const MAX_FILE_SIZE_MB = 10;
const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;

export const validateDesignAssetSchema = insertSDLCDesignAssetSchema.extend({
  name: z.string().min(1, "File name is required"),
  fileType: z
    .string()
    .refine((type) => ALLOWED_MIME_TYPES.includes(type), {
      message: `File type must be one of: ${ALLOWED_MIME_TYPES.join(", ")}`,
    }),
  fileUrl: z
    .string()
    .min(1, "File data is required")
    .refine(
      (data) => {
        const base64Match = data.match(/^data:[^;]+;base64,(.+)$/);
        if (!base64Match) return false;
        const base64Data = base64Match[1];
        const sizeInBytes = (base64Data.length * 3) / 4;
        return sizeInBytes <= MAX_FILE_SIZE_BYTES;
      },
      { message: `File size must not exceed ${MAX_FILE_SIZE_MB}MB` },
    ),
});

export const validateFigmaLinkSchema = insertSDLCFigmaLinkSchema.extend({
  title: z.string().min(1, "Title is required"),
  figmaUrl: z
    .string()
    .min(1, "Figma URL is required")
    .url("Must be a valid URL")
    .refine((url) => url.includes("figma.com"), {
      message: "Must be a valid Figma URL",
    }),
});

const VALID_REVIEW_STATUSES = ["pending", "approved", "changes-requested"];
export const validateDesignReviewSchema = insertSDLCDesignReviewSchema.extend({
  title: z.string().min(1, "Title is required"),
  status: z.enum(["pending", "approved", "changes-requested"] as const),
});

export type InsertOrganization = z.infer<typeof insertOrganizationSchema>;
export type Organization = typeof organizations.$inferSelect;
export type InsertProject = z.infer<typeof insertProjectSchema>;
export type Project = typeof projects.$inferSelect;
export type InsertGoldenRepository = z.infer<
  typeof insertGoldenRepositorySchema
>;
export type GoldenRepository = typeof goldenRepositories.$inferSelect;
export type InsertAdoSettings = z.infer<typeof insertAdoSettingsSchema>;
export type AdoSettings = typeof adoSettings.$inferSelect;
export type InsertArtifactOrganization = z.infer<
  typeof insertArtifactOrganizationSchema
>;
export type ArtifactOrganization = typeof artifactOrganizations.$inferSelect;
export type InsertGoldenRepoOrganization = z.infer<
  typeof insertGoldenRepoOrganizationSchema
>;
export type GoldenRepoOrganization =
  typeof goldenRepoOrganizations.$inferSelect;
export type InsertConversationalUiSettings = z.infer<
  typeof insertConversationalUiSettingsSchema
>;
export type ConversationalUiSettings =
  typeof conversationalUiSettings.$inferSelect;
export type InsertWorkflowSettings = z.infer<
  typeof insertWorkflowSettingsSchema
>;
export type WorkflowSettings = typeof workflowSettings.$inferSelect;
export type InsertSdlcSettings = z.infer<typeof insertSdlcSettingsSchema>;
export type SdlcSettings = typeof sdlcSettings.$inferSelect;
export type InsertPersona = z.infer<typeof insertPersonaSchema>;
export type PersonaDB = typeof personas.$inferSelect;
export type InsertWikiPage = z.infer<typeof insertWikiPageSchema>;
export type WikiPage = typeof wikiPages.$inferSelect;
export type InsertSDLCProject = z.infer<typeof insertSDLCProjectSchema>;
export type SDLCProject = typeof sdlcProjects.$inferSelect;
export type InsertSDLCPhase = z.infer<typeof insertSDLCPhaseSchema>;
export type SDLCPhase = typeof sdlcPhases.$inferSelect;
export type InsertPhaseConfirmation = z.infer<
  typeof insertPhaseConfirmationSchema
>;
export type PhaseConfirmation = typeof phaseConfirmations.$inferSelect;
export type InsertSDLCIssue = z.infer<typeof insertSDLCIssueSchema>;
export type SDLCIssue = typeof sdlcIssues.$inferSelect;
export type InsertSDLCEpic = z.infer<typeof insertSDLCEpicSchema>;
export type SDLCEpic = typeof sdlcEpics.$inferSelect;
export type InsertSDLCFeature = z.infer<typeof insertSDLCFeatureSchema>;
export type SDLCFeature = typeof sdlcFeatures.$inferSelect;
export type InsertSDLCRequirement = z.infer<typeof insertSDLCRequirementSchema>;
export type SDLCRequirement = typeof sdlcRequirements.$inferSelect;
export type InsertSDLCBacklogItem = z.infer<typeof insertSDLCBacklogItemSchema>;
export type SDLCBacklogItem = typeof sdlcBacklogItems.$inferSelect;
export type InsertSDLCDocument = z.infer<typeof insertSDLCDocumentSchema>;
export type SDLCDocument = typeof sdlcDocuments.$inferSelect;
export type InsertSDLCDesignAsset = z.infer<typeof insertSDLCDesignAssetSchema>;
export type SDLCDesignAsset = typeof sdlcDesignAssets.$inferSelect;
export type InsertSDLCFigmaLink = z.infer<typeof insertSDLCFigmaLinkSchema>;
export type SDLCFigmaLink = typeof sdlcFigmaLinks.$inferSelect;
export type InsertSDLCDesignReview = z.infer<
  typeof insertSDLCDesignReviewSchema
>;
export type SDLCDesignReview = typeof sdlcDesignReviews.$inferSelect;
export type InsertAdoDesignSync = z.infer<typeof insertAdoDesignSyncSchema>;
export type AdoDesignSync = typeof adoDesignSync.$inferSelect;
export type InsertSDLCCode = z.infer<typeof insertSDLCCodeSchema>;
export type SDLCCode = typeof sdlcCode.$inferSelect;
export type InsertSDLCCommit = z.infer<typeof insertSDLCCommitSchema>;
export type SDLCCommit = typeof sdlcCommits.$inferSelect;
export type InsertSDLCPreview = z.infer<typeof insertSDLCPreviewSchema>;
export type SDLCPreview = typeof sdlcPreviews.$inferSelect;

// Conversational Workflow Types
export const conversationPhaseSchema = z.enum([
  "understanding",
  "refining",
  "personas",
  "artifacts",
  "complete",
  "mode-selection",
  "guided-clarification",
]);

export const conversationMessageSchema = z.object({
  id: z.string(),
  role: z.enum(["user", "assistant"]),
  content: z.string(),
  timestamp: z.date(),
  quickReplies: z.array(z.string()).optional(),
  attachments: z.array(z.object({
    name: z.string(),
    size: z.number(),
    type: z.string(),
    content: z.string().optional()
  })).optional(),
});

export const capturedRequirementsSchema = z.object({
  businessGoals: z.array(z.string()).default([]),
  targetUsers: z.array(z.string()).default([]),
  keyFeatures: z.array(z.string()).default([]),
  technicalConstraints: z.array(z.string()).default([]),
  functionalRequirements: z.array(z.string()).default([]),
  nonFunctionalRequirements: z.array(z.string()).default([]),
  edgeCases: z.array(z.string()).default([]),
  priorityItems: z.array(z.string()).default([]),
  excludedTopics: z.array(z.string()).default([]),
  impliedNeeds: z.array(z.string()).default([]),
});

export const exportFormatSchema = z.enum(["azure-devops", "jira", "none"]);

export const subtaskSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  estimatedHours: z.number(),
});

// Step can be either a string or an object with action and result
const testCaseStepSchema = z.union([
  z.string(),
  z.object({
    step: z.number().optional(),
    action: z.string(),
    result: z.string(),
  }),
]);

export const testCaseSchema = z.object({
  id: z.string().optional(),
  title: z.string().optional(),
  scenario: z.string().optional(),
  steps: z.array(testCaseStepSchema),
  expectedResult: z.string().optional(),
});

export const enhancedUserStorySchema = userStorySchema.extend({
  subtasks: z.array(subtaskSchema).default([]),
  testCases: z.array(testCaseSchema).default([]),
});

export type ConversationPhase = z.infer<typeof conversationPhaseSchema>;
export type ConversationMessage = z.infer<typeof conversationMessageSchema>;
export type CapturedRequirements = z.infer<typeof capturedRequirementsSchema>;
export type ExportFormat = z.infer<typeof exportFormatSchema>;
export type Subtask = z.infer<typeof subtaskSchema>;
export type TestCase = z.infer<typeof testCaseSchema>;
export type EnhancedUserStory = z.infer<typeof enhancedUserStorySchema>;

// Workflow Artifacts - Storing generated epics, features, user stories, and guidelines
export type ModifiedArtifactItems = {
  epics: string[];
  features: string[];
  userStories: string[];
};

export const workflowArtifacts = mysqlTable("workflow_artifacts", {
  id: varchar("id", { length: 36 })
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  sessionId: varchar("session_id", { length: 36 }).notNull(),
  projectId: varchar("project_id", { length: 255 }),
  brdId: varchar("brd_id", { length: 36 }), // Link to BRD (optional)
  requirementIds: json("requirement_ids").$type<string[]>(), // Array of requirement IDs for traceability
  requirement: longtext("requirement").notNull(),
  guidelines: longtext("guidelines"),
  epics: json("epics").$type<Epic[]>().notNull().default([]),
  features: json("features").$type<Feature[]>().notNull().default([]),
  userStories: json("user_stories").$type<UserStory[]>().notNull().default([]),
  personas: json("personas").$type<Persona[]>().notNull().default([]),
  wikiPages: json("wiki_pages").$type<WikiPage[]>().notNull().default([]),
  figmaGuidelines: longtext("figma_guidelines"),
  status: varchar("status", { length: 50 }).notNull().default("draft"), // draft, saved, published
  modified: boolean("modified").default(false),
  approvalStatus: varchar("approval_status", { length: 20 }), // approved, not approved
  modifiedCount: int("modified_count").default(0),
  totalCount: int("total_count").default(0),
  modifiedItems: json("modified_items")
    .$type<ModifiedArtifactItems>()
    .notNull()
    .default({
      epics: [],
      features: [],
      userStories: [],
    }),
  createdBy: varchar("created_by", { length: 100 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Workflow Artifact Subtasks - Storing subtasks separately for better querying
export const workflowSubtasks = mysqlTable("workflow_subtasks", {
  id: varchar("id", { length: 36 })
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  artifactId: varchar("artifact_id", { length: 36 }).notNull(),
  userStoryId: varchar("user_story_id", { length: 36 }).notNull(),
  title: text("title").notNull(),
  description: text("description").notNull(),
  estimatedHours: int("estimated_hours").default(0),
  status: varchar("status", { length: 50 }).notNull().default("pending"), // pending, in-progress, completed
  assignedTo: varchar("assigned_to", { length: 100 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertWorkflowArtifactSchema = createInsertSchema(
  workflowArtifacts,
).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertWorkflowSubtaskSchema = createInsertSchema(
  workflowSubtasks,
).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertWorkflowArtifact = z.infer<
  typeof insertWorkflowArtifactSchema
>;
export type WorkflowArtifact = typeof workflowArtifacts.$inferSelect;
export type InsertWorkflowSubtask = z.infer<typeof insertWorkflowSubtaskSchema>;
export type WorkflowSubtask = typeof workflowSubtasks.$inferSelect;

// Workflow Test Cases - Storing test cases separately for ADO push capability
export const workflowTestCases = mysqlTable("workflow_test_cases", {
  id: varchar("id", { length: 36 })
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  artifactId: varchar("artifact_id", { length: 36 }).notNull(),
  userStoryId: varchar("user_story_id", { length: 36 }).notNull(),
  title: text("title").notNull(),
  scenario: text("scenario"),
  steps: json("steps").$type<Array<{
    step: number;
    action: string;
    result: string;
  }>>().notNull().default([]),
  preconditions: text("preconditions"),
  postconditions: text("postconditions"),
  priority: varchar("priority", { length: 20 }).default("Medium"),
  automationStatus: varchar("automation_status", { length: 50 }).default("Not Automated"),
  adoTestCaseId: varchar("ado_test_case_id", { length: 100 }),
  adoTestPlanId: varchar("ado_test_plan_id", { length: 100 }),
  adoTestSuiteId: varchar("ado_test_suite_id", { length: 100 }),
  isPushedToAdo: boolean("is_pushed_to_ado").default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertWorkflowTestCaseSchema = createInsertSchema(
  workflowTestCases,
).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertWorkflowTestCase = z.infer<typeof insertWorkflowTestCaseSchema>;
export type WorkflowTestCase = typeof workflowTestCases.$inferSelect;

// Design Mapping - Stores Epic + User Stories + Figma Prompt + Figma Link
export const designMappings = mysqlTable("design_mappings", {
  id: varchar("id", { length: 36 })
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  projectId: varchar("project_id", { length: 36 }).notNull(),
  epicId: varchar("epic_id", { length: 100 }).notNull(),
  epicTitle: text("epic_title").notNull(),
  userStories: json("user_stories")
    .$type<Array<{ id: string; title: string }>>()
    .notNull(),
  prompt: longtext("prompt").notNull(),
  figmaLink: text("figma_link"),
  brdId: varchar("brd_id", { length: 36 }),

  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertDesignMappingSchema = createInsertSchema(
  designMappings,
).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertDesignMapping = z.infer<typeof insertDesignMappingSchema>;
export type DesignMapping = typeof designMappings.$inferSelect;

// =============================
// BRD Storage
// =============================

export const brdDocuments = mysqlTable("brd_documents", {
  id: varchar("id", { length: 36 })
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  projectId: varchar("project_id", { length: 36 }).notNull(),
  title: varchar("title", { length: 255 }).notNull(),
  createdBy: varchar("created_by", { length: 36 }).notNull(),
  projectDescription: longtext("project_description"),
  businessObjectives: longtext("business_objectives"),
  acceptanceCriteria: longtext("acceptance_criteria"),
  targetAudience: longtext("target_audience"),
  keyFeatures: longtext("key_features"),
  constraints: longtext("constraints"),
  successCriteria: longtext("success_criteria"),
  timeline: longtext("timeline"),
  budget: longtext("budget"),
  stakeholders: longtext("stakeholders"),
  existingRequirements: longtext("existing_requirements"),
  projectDetails: longtext("project_details"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Dev BRD Documents - for draft BRD management
export const devBrdDocuments = mysqlTable("dev_brd_documents", {
  id: varchar("id", { length: 36 })
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  projectId: varchar("project_id", { length: 36 }).notNull(),
  title: varchar("title", { length: 255 }).notNull(),
  createdBy: varchar("created_by", { length: 36 }).notNull(),
  status: varchar("status", { length: 50 }).notNull().default("draft"),
  generationStatus: varchar("generation_status", { length: 50 }).notNull().default("not_started"),
  projectDescription: longtext("project_description"),
  businessObjectives: longtext("business_objectives"),
  successCriteria: longtext("success_criteria"),
  targetAudience: longtext("target_audience"),
  keyStakeholders: longtext("key_stakeholders"),
  keyFeatures: longtext("key_features"),
  existingRequirements: longtext("existing_requirements"),
  constraints: longtext("constraints"),
  timeline: longtext("timeline"),
  budget: longtext("budget"),
  brdFile: longBlob("brd_file"),
  brdFileName: varchar("brd_file_name", { length: 255 }),
  brdFileType: varchar("brd_file_type", { length: 100 }),
  brdFileSize: bigint("brd_file_size", { mode: "number" }),
  generatedMarkdown: longtext("generated_markdown"),
  generatedBrdJson: json("generated_brd_json"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type DevBrdDocument = typeof devBrdDocuments.$inferSelect;
export type InsertDevBrdDocument = typeof devBrdDocuments.$inferInsert;

// =============================
// BRD Generation Metrics (Audit + Quality)
// =============================
// One row per BRD generation job (keyed by job_id). brd_id may be null if you generate
// without persisting a draft; still useful for debugging generation accuracy/quality.
export const brdGenerationMetrics = mysqlTable(
  "brd_generation_metrics",
  {
    id: varchar("id", { length: 36 })
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),

    // Job linkage for async generation endpoint (/api/brd/generate)
    jobId: varchar("job_id", { length: 36 }).notNull(),
    brdId: varchar("brd_id", { length: 36 }),
    projectId: varchar("project_id", { length: 36 }).notNull(),

    // Timing
    startedAt: timestamp("started_at"),
    completedAt: timestamp("completed_at"),
    durationMs: bigint("duration_ms", { mode: "number" }),

    // Template / mode
    brdTemplateId: varchar("brd_template_id", { length: 50 }).default("gold_1_0"),
    brdGenerationMode: varchar("brd_generation_mode", { length: 50 }),

    // LLM models/deployments used by BRD generation passes
    llmProvider: varchar("llm_provider", { length: 50 }).default("openai_integrations"),
    brdChatModel: varchar("brd_chat_model", { length: 120 }),
    brdRepairChatModel: varchar("brd_repair_chat_model", { length: 120 }),
    brdExtractionChatModel: varchar("brd_extraction_chat_model", { length: 120 }),
    llmModelsJson: json("llm_models_json").$type<Record<string, unknown>>(),

    // RAG high-level stats (store what you can; keep raw debug in json if enabled)
    ragUsed: boolean("rag_used").notNull().default(false),
    ragPipelineMode: varchar("rag_pipeline_mode", { length: 50 }),
    ragGuidanceLengthChars: int("rag_guidance_length_chars"),
    ragGuidanceLengthEstimateTokens: int("rag_guidance_length_estimate_tokens"),

    // Prompt sizing / token estimates (approx; compute from prompt strings)
    promptSizes: json("prompt_sizes").$type<{
      systemChars?: number;
      userChars?: number;
      canonicalRequirementsChars?: number;
      ragGuidanceChars?: number;
      totalPromptChars?: number;
      totalPromptCharsEstimateTokens?: number;
    }>(),

    // Chunking + retrieval stats; if you enable ragDebug collection, this can store the
    // whole object. Otherwise, store aggregated counts only.
    ragStats: json("rag_stats").$type<Record<string, unknown>>(),

    // Requirement coverage / quality metrics (scalar columns for easy dashboards)
    canonicalRequirementCount: int("canonical_requirement_count"),
    extractedRequirementRowCount: int("extracted_requirement_row_count"),
    traceabilityEntryCount: int("traceability_entry_count"),

    sourceCoveragePercent: decimal("source_coverage_percent", { precision: 5, scale: 2 }),
    traceabilityScore: int("traceability_score"),
    brdAccuracyScore: int("brd_accuracy_score"),
    domainProfileComplianceScore: int("domain_profile_compliance_score"),
    unsupportedRequirementPercent: decimal("unsupported_requirement_percent", { precision: 5, scale: 2 }),

    // Acceptance decision
    acceptanceStatus: varchar("acceptance_status", { length: 50 }),
    acceptanceReasons: json("acceptance_reasons").$type<string[]>(),

    // Raw objects for deep inspection
    rtmJson: json("rtm_json").$type<Array<Record<string, unknown>>>(),
    qualityMetricsJson: json("quality_metrics_json").$type<Record<string, unknown>>(),
    acceptanceSummaryJson: json("acceptance_summary_json").$type<Record<string, unknown>>(),

    // Extra: where time went (phase durations, etc.)
    phaseDurationsMs: json("phase_durations_ms").$type<Record<string, number>>(),

    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    jobIdIdx: uniqueIndex("brd_gen_metrics_job_idx").on(table.jobId),
  }),
);

export type BrdGenerationMetrics = typeof brdGenerationMetrics.$inferSelect;
export type InsertBrdGenerationMetrics = typeof brdGenerationMetrics.$inferInsert;

// Dev BRD Requirements - normalized requirements extracted from approved BRDs
export const devBrdRequirements = mysqlTable("dev_brd_requirements", {
  id: varchar("id", { length: 36 })
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  projectId: varchar("project_id", { length: 36 }).notNull(),
  brdId: varchar("brd_id", { length: 36 }).notNull(),
  workflowId: varchar("workflow_id", { length: 36 }), // Link to workflow artifacts
  requirementName: text("requirement_name").notNull(),
  description: text("description"),
  priority: varchar("priority", { length: 50 }).default("medium"),
  acceptanceCriteria: text("acceptance_criteria"),
  status: varchar("status", { length: 50 }).notNull().default("new"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type DevBrdRequirement = typeof devBrdRequirements.$inferSelect;
export type InsertDevBrdRequirement = typeof devBrdRequirements.$inferInsert;

// Test Plan Documents - generated from BRDs
export const testPlanDocuments = mysqlTable("test_plan_documents", {
  id: varchar("id", { length: 36 })
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  testPlanName: varchar("test_plan_name", { length: 255 }).notNull(),
  brdId: varchar("brd_id", { length: 36 }).notNull(), // Reference to BRD
  brdTitle: varchar("brd_title", { length: 255 }), // Store BRD title for reference
  projectId: varchar("project_id", { length: 36 }),
  organizationId: varchar("organization_id", { length: 36 }),
  content: longtext("content").notNull(), // Test plan markdown content
  status: varchar("status", { length: 50 }).notNull().default("active"),
  adoId: varchar("ado_id", { length: 50 }), // Azure DevOps Feature/Work Item ID
  adoOrg: varchar("ado_org", { length: 255 }), 
  adoProject: varchar("ado_project", { length: 255 }),
  deletedAt: timestamp("deleted_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type TestPlanDocument = typeof testPlanDocuments.$inferSelect;
export type InsertTestPlanDocument = typeof testPlanDocuments.$inferInsert;
// Provisioning Instances - for Azure App Service instances
export const provisioningInstances = mysqlTable("provisioning_instances", {
  id: varchar("id", { length: 36 })
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  instanceName: varchar("instance_name", { length: 255 }).notNull(),
  status: mysqlEnum("status", ["provisioning", "ready", "failed", "deleting", "deleted"]).notNull().default("provisioning"),
  environment: varchar("environment", { length: 50 }).notNull(),
  region: varchar("region", { length: 50 }).notNull(),
  serviceType: varchar("service_type", { length: 50 }).notNull().default("Web App"), // NEW: Type of service
  runtime: varchar("runtime", { length: 100 }),
  planTier: varchar("plan_tier", { length: 100 }),

  // Azure-specific fields
  subscriptionId: varchar("subscription_id", { length: 36 }),
  resourceGroupName: varchar("resource_group_name", { length: 255 }),
  appServiceName: varchar("app_service_name", { length: 255 }),
  appServicePlanName: varchar("app_service_plan_name", { length: 255 }),
  url: varchar("url", { length: 500 }),

  // Database-specific fields
  databaseEngine: varchar("database_engine", { length: 50 }),
  databaseServerName: varchar("database_server_name", { length: 255 }),
  databaseName: varchar("database_name", { length: 255 }),

  // Advanced settings
  enableLogging: boolean("enable_logging").default(false),
  autoDeleteDays: int("auto_delete_days"),
  tags: json("tags").$type<Array<{ key: string, value: string }>>(),

  // Tracking fields
  errorMessage: text("error_message"),
  provisioningStartedAt: timestamp("provisioning_started_at"),
  provisioningCompletedAt: timestamp("provisioning_completed_at"),

  // Audit fields
  userId: varchar("user_id", { length: 36 }).notNull(),
  tenantId: varchar("tenant_id", { length: 36 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type ProvisioningInstance = typeof provisioningInstances.$inferSelect;
export type InsertProvisioningInstance = typeof provisioningInstances.$inferInsert;

export const brdFileVersions = mysqlTable(
  "brd_file_versions",
  {
    id: bigint("id", { mode: "number" }).primaryKey().autoincrement(),
    brdId: varchar("brd_id", { length: 36 }).notNull(),
    version: int("version").notNull(),
    fileBlob: longBlob("file_blob").notNull(),
    fileName: varchar("file_name", { length: 255 }).notNull(),
    fileType: varchar("file_type", { length: 100 }).notNull(),
    fileSize: bigint("file_size", { mode: "number" }),
    uploadedBy: varchar("uploaded_by", { length: 36 }).notNull(),
    uploadedAt: timestamp("uploaded_at").defaultNow().notNull(),
  },
  (table) => ({
    uniqBrdVersion: uniqueIndex("uniq_brd_version").on(
      table.brdId,
      table.version,
    ),
  }),
);

export const workflowBrdAttachments = mysqlTable("workflow_brd_attachments", {
  id: varchar("id", { length: 36 })
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  workflowId: varchar("workflow_id", { length: 36 }).notNull(),
  brdVersionId: bigint("brd_version_id", { mode: "number" }).notNull(),
  attachedAt: timestamp("attached_at").defaultNow().notNull(),
  attachedBy: varchar("attached_by", { length: 36 }).notNull(),
});

export const insertBrdDocumentSchema = createInsertSchema(brdDocuments).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertBrdFileVersionSchema = createInsertSchema(
  brdFileVersions,
).omit({
  id: true,
  uploadedAt: true,
});

export const insertWorkflowBrdAttachmentSchema = createInsertSchema(
  workflowBrdAttachments,
).omit({
  id: true,
  attachedAt: true,
});

export type InsertBrdDocument = z.infer<typeof insertBrdDocumentSchema>;
export type BrdDocument = typeof brdDocuments.$inferSelect;
export type InsertBrdFileVersion = z.infer<typeof insertBrdFileVersionSchema>;
export type BrdFileVersion = typeof brdFileVersions.$inferSelect;
export type InsertWorkflowBrdAttachment = z.infer<
  typeof insertWorkflowBrdAttachmentSchema
>;
export type WorkflowBrdAttachment = typeof workflowBrdAttachments.$inferSelect;

// AI Enhance Mappings - Maps location keys to golden repository files
export const aiEnhanceMappings = mysqlTable("ai_enhance_mappings", {
  id: varchar("id", { length: 36 })
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  locationKey: varchar("location_key", { length: 255 }).notNull(),
  repositoryId: varchar("repository_id", { length: 36 }).notNull(),
  folderPath: text("folder_path").notNull(),
  filePath: text("file_path").notNull(),
  fileName: varchar("file_name", { length: 255 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type AiEnhanceMapping = typeof aiEnhanceMappings.$inferSelect;
export type InsertAiEnhanceMapping = typeof aiEnhanceMappings.$inferInsert;

// =============================
// Changes made for history in conversation UI. -- Sri hari
// =============================
export const conversationTitles = mysqlTable("ConversationTitles", {
  conversationId: varchar("conversation_id", { length: 36 }).primaryKey(),
  userId: varchar("user_id", { length: 50 }).notNull(),
  title: varchar("title", { length: 255 }).notNull(),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
  updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
});

// For inserts we will supply conversationId + timestamps in our code.
export const insertConversationTitleSchema = createInsertSchema(
  conversationTitles,
).omit({
  createdAt: true,
  updatedAt: true,
});

export type InsertConversationTitle = z.infer<
  typeof insertConversationTitleSchema
>;
export type ConversationTitle = typeof conversationTitles.$inferSelect;

export const conversationSummaries = mysqlTable("ConversationSummary", {
  conversationId: varchar("conversation_id", { length: 36 }).primaryKey(),
  summary: text("summary"),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
  updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
});

export const insertConversationSummarySchema = createInsertSchema(
  conversationSummaries,
).omit({
  createdAt: true,
  updatedAt: true,
});

export type InsertConversationSummary = z.infer<
  typeof insertConversationSummarySchema
>;
export type ConversationSummary = typeof conversationSummaries.$inferSelect;

export const messages = mysqlTable("Messages", {
  id: varchar("id", { length: 36 })
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  conversationId: varchar("conversation_id", { length: 36 }).notNull(),
  role: mysqlEnum("role", ["user", "assistant", "system"]).notNull(),
  content: text("content").notNull(),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
  isSummarised: boolean("is_summarised").default(false),
});

export const insertMessageSchema = createInsertSchema(messages).omit({
  id: true,
  createdAt: true,
});

export type InsertMessage = z.infer<typeof insertMessageSchema>;
export type Message = typeof messages.$inferSelect;

export const messageRoleSchema = z.enum(["user", "assistant", "system"]);

// Design Guidelines table
export const designGuidelines = mysqlTable("design_guidelines", {
  id: varchar("id", { length: 36 })
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  projectId: varchar("project_id", { length: 36 }).notNull(),
  title: varchar("title", { length: 255 }).notNull().default("Generated Design Guidelines"),
  type: varchar("type", { length: 100 }).notNull().default("Design Guidelines"),
  content: longtext("content").notNull(),
  figmaLink: text("figma_link"),
  userPrompt: text("user_prompt"),
  generatedPrompt: longtext("generated_prompt").notNull(),
  guidelinesContent: longtext("guidelines_content"),
  adoWorkItemId: int("ado_work_item_id"),
  adoPushedAt: timestamp("ado_pushed_at"),
  status: varchar("status", { length: 50 }).notNull().default("active"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertDesignGuidelineSchema = createInsertSchema(designGuidelines).pick({
  projectId: true,
  title: true,
  type: true,
  content: true,
  figmaLink: true,
  userPrompt: true,
  generatedPrompt: true,
  guidelinesContent: true,
});

export type InsertDesignGuideline = z.infer<typeof insertDesignGuidelineSchema>;
export type DesignGuideline = typeof designGuidelines.$inferSelect;

// Vector Cache Tables for RAG Optimization
export const vectorizedGuidelines = mysqlTable("vectorized_guidelines", {
  id: varchar("id", { length: 36 })
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  projectId: varchar("project_id", { length: 36 }).notNull(),
  guidelineName: varchar("guideline_name", { length: 500 }).notNull(),
  contentHash: varchar("content_hash", { length: 64 }).notNull().unique(), // SHA-256 of content
  qdrantCollection: varchar("qdrant_collection", { length: 255 }).notNull(),
  chunkCount: int("chunk_count").notNull().default(0),
  embeddingModel: varchar("embedding_model", { length: 100 }).notNull().default("text-embedding-ada-002"),
  status: varchar("status", { length: 50 }).notNull().default("processing"), // 'vectorized', 'processing', 'failed'
  processingTime: int("processing_time_ms"), // Time taken to process in milliseconds
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const guidelineChunks = mysqlTable("guideline_chunks", {
  id: varchar("id", { length: 36 })
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  guidelineId: varchar("guideline_id", { length: 36 }).notNull().references(() => vectorizedGuidelines.id, { onDelete: "cascade" }),
  chunkIndex: int("chunk_index").notNull(),
  chunkText: longtext("chunk_text").notNull(),
  qdrantPointId: varchar("qdrant_point_id", { length: 255 }).notNull(), // Reference to Qdrant point
  chunkSize: int("chunk_size").notNull(),
  overlapSize: int("overlap_size").notNull().default(0),
  metadata: json("metadata"), // Store additional chunk metadata as JSON
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ============================================================
// DevX-prefixed vector cache tables (golden repo chunk tracking)
// Global cache keyed by golden_repo_id + content_hash
// ============================================================

export const devxVectorizedGuidelines = mysqlTable("devx_vectorized_guidelines", {
  id: varchar("id", { length: 36 })
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  // Global golden-repo cache: no project_id column here.
  goldenRepoId: varchar("golden_repo_id", { length: 36 }), // which repo this file came from (for cascade delete on file remove)
  guidelineName: varchar("guideline_name", { length: 500 }).notNull(), // usually the file path within the repo
  contentHash: varchar("content_hash", { length: 64 }).notNull(), // SHA-256 of content
  qdrantCollection: varchar("qdrant_collection", { length: 255 }).notNull(),
  chunkCount: int("chunk_count").notNull().default(0),
  embeddingModel: varchar("embedding_model", { length: 100 }).notNull().default("text-embedding-ada-002"),
  status: varchar("status", { length: 50 }).notNull().default("processing"), // 'vectorized', 'processing', 'failed'
  processingTime: int("processing_time_ms"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const devxGuidelineChunks = mysqlTable("devx_guideline_chunks", {
  id: varchar("id", { length: 36 })
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  guidelineId: varchar("guideline_id", { length: 36 })
    .notNull()
    .references(() => devxVectorizedGuidelines.id, { onDelete: "cascade" }),
  chunkIndex: int("chunk_index").notNull(),
  chunkText: longtext("chunk_text").notNull(),
  qdrantPointId: varchar("qdrant_point_id", { length: 255 }).notNull(),
  chunkSize: int("chunk_size").notNull(),
  overlapSize: int("overlap_size").notNull().default(0),
  metadata: json("metadata"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// RAG Sessions table to track processing sessions
export const ragSessions = mysqlTable("rag_sessions", {
  id: varchar("id", { length: 36 }).primaryKey(),
  projectId: varchar("project_id", { length: 36 }).notNull(),
  sessionType: varchar("session_type", { length: 50 }).notNull().default("artifact_generation"),
  status: varchar("status", { length: 50 }).notNull().default("processing"),
  requirementIds: json("requirement_ids"), // Array of requirement IDs processed
  guidelineIds: json("guideline_ids"), // Array of guideline IDs used
  cacheHitCount: int("cache_hit_count").notNull().default(0),
  cacheMissCount: int("cache_miss_count").notNull().default(0),
  totalProcessingTime: int("total_processing_time_ms"),
  ragProcessingTime: int("rag_processing_time_ms"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  completedAt: timestamp("completed_at"),
});

export const insertVectorizedGuidelineSchema = createInsertSchema(vectorizedGuidelines).pick({
  id: true,
  projectId: true,
  guidelineName: true,
  contentHash: true,
  qdrantCollection: true,
  chunkCount: true,
  embeddingModel: true,
  status: true,
  processingTime: true,
});

export const insertGuidelineChunkSchema = createInsertSchema(guidelineChunks).pick({
  guidelineId: true,
  chunkIndex: true,
  chunkText: true,
  qdrantPointId: true,
  chunkSize: true,
  overlapSize: true,
  metadata: true,
});

export const insertRagSessionSchema = createInsertSchema(ragSessions).pick({
  id: true,
  projectId: true,
  sessionType: true,
  status: true,
  requirementIds: true,
  guidelineIds: true,
});

export type InsertVectorizedGuideline = z.infer<typeof insertVectorizedGuidelineSchema>;
export type VectorizedGuideline = typeof vectorizedGuidelines.$inferSelect;
export type InsertGuidelineChunk = z.infer<typeof insertGuidelineChunkSchema>;
export type GuidelineChunk = typeof guidelineChunks.$inferSelect;
export type InsertRagSession = z.infer<typeof insertRagSessionSchema>;
export type RagSession = typeof ragSessions.$inferSelect;

export const insertDevxVectorizedGuidelineSchema = createInsertSchema(devxVectorizedGuidelines).pick({
  id: true,
  goldenRepoId: true,
  guidelineName: true,
  contentHash: true,
  qdrantCollection: true,
  chunkCount: true,
  embeddingModel: true,
  status: true,
  processingTime: true,
});
export const insertDevxGuidelineChunkSchema = createInsertSchema(devxGuidelineChunks).pick({
  guidelineId: true,
  chunkIndex: true,
  chunkText: true,
  qdrantPointId: true,
  chunkSize: true,
  overlapSize: true,
  metadata: true,
});

export type InsertDevxVectorizedGuideline = z.infer<typeof insertDevxVectorizedGuidelineSchema>;
export type DevxVectorizedGuideline = typeof devxVectorizedGuidelines.$inferSelect;
export type InsertDevxGuidelineChunk = z.infer<typeof insertDevxGuidelineChunkSchema>;
export type DevxGuidelineChunk = typeof devxGuidelineChunks.$inferSelect;

// =============================
// Session Management System
// =============================

// MSAL Users - Store authenticated user information from MSAL
export const msalUsers = mysqlTable("msal_users", {
  id: varchar("id", { length: 36 })
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  aadObjectId: varchar("aad_object_id", { length: 255 }).notNull().unique(), // Azure AD Object ID (preferred unique key)
  userName: varchar("user_name", { length: 255 }).notNull(),
  userEmail: varchar("user_email", { length: 255 }).notNull(),
  displayName: varchar("display_name", { length: 255 }),
  homeAccountId: varchar("home_account_id", { length: 255 }), // MSAL homeAccountId
  tenantId: varchar("tenant_id", { length: 255 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  deletedAt: timestamp("deleted_at"), // Soft delete
});

// AI Sessions - Main session table per project
export const aiSessions = mysqlTable("ai_sessions", {
  id: varchar("id", { length: 36 })
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  projectId: varchar("project_id", { length: 36 }).notNull(),
  userId: varchar("user_id", { length: 36 }).notNull(), // FK to msal_users.id
  title: varchar("title", { length: 500 }).notNull(), // AI-generated or user-renamed title
  status: mysqlEnum("status", ["IN_PROGRESS", "PAUSED", "COMPLETED", "INACTIVE", "CANCELLED"]).notNull().default("IN_PROGRESS"),
  currentScreen: varchar("current_screen", { length: 255 }), // Screen/route where user left off
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  lastAccessedAt: timestamp("last_accessed_at").defaultNow().notNull(),
  deletedAt: timestamp("deleted_at"), // Soft delete
}, (table) => ({
  projectUserIdx: uniqueIndex("project_user_idx").on(table.projectId, table.userId, table.id),
  userIdx: uniqueIndex("user_idx").on(table.userId),
  projectIdx: uniqueIndex("project_idx").on(table.projectId),
  statusIdx: uniqueIndex("status_idx").on(table.status),
}));

// Session State - Stores complete session snapshot for resume
export const sessionStates = mysqlTable("session_states", {
  id: varchar("id", { length: 36 })
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  sessionId: varchar("session_id", { length: 36 }).notNull(), // FK to ai_sessions.id
  stateSnapshot: longtext("state_snapshot").notNull(), // JSON string of complete session state
  cursorState: json("cursor_state").$type<{
    position?: number;
    selection?: { start: number; end: number };
    focusElement?: string;
  }>(), // Cursor/UI state
  inputs: json("inputs").$type<Record<string, any>>(), // User inputs at time of save
  outputs: json("outputs").$type<Record<string, any>>(), // AI outputs at time of save
  version: int("version").notNull().default(1), // Version number for optimistic locking
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  sessionIdx: uniqueIndex("session_state_idx").on(table.sessionId), // One state per session (latest)
}));

// AI Usage Tracking - Tracks individual AI API calls
export const aiUsageLogs = mysqlTable("ai_usage_logs", {
  id: varchar("id", { length: 36 })
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  sessionId: varchar("session_id", { length: 36 }).notNull(), // FK to ai_sessions.id
  callId: varchar("call_id", { length: 100 }), // Unique identifier for this API call
  model: varchar("model", { length: 100 }).notNull(), // e.g., "gpt-4o", "gpt-4-turbo", "claude-3-opus"
  provider: varchar("provider", { length: 50 }).notNull().default("azure"), // "azure", "anthropic", "openai"
  inputTokens: int("input_tokens").notNull().default(0),
  outputTokens: int("output_tokens").notNull().default(0),
  totalTokens: int("total_tokens").notNull().default(0),
  inputPricePer1K: decimal("input_price_per_1k", { precision: 10, scale: 6 }).notNull().default("0"), // Price per 1K input tokens
  outputPricePer1K: decimal("output_price_per_1k", { precision: 10, scale: 6 }).notNull().default("0"), // Price per 1K output tokens
  cost: decimal("cost", { precision: 12, scale: 6 }).notNull().default("0"), // Calculated cost for this call
  requestMetadata: json("request_metadata").$type<{
    temperature?: number;
    maxTokens?: number;
    finishReason?: string;
    duration?: number;
  }>(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  sessionIdx: uniqueIndex("usage_session_idx").on(table.sessionId),
  callIdIdx: uniqueIndex("usage_call_id_idx").on(table.callId),
  createdAtIdx: uniqueIndex("usage_created_at_idx").on(table.createdAt),
}));

// Session Cost Summary - Aggregated cost per session (for quick queries)
export const sessionCostSummaries = mysqlTable("session_cost_summaries", {
  id: varchar("id", { length: 36 })
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  sessionId: varchar("session_id", { length: 36 }).notNull().unique(), // FK to ai_sessions.id
  totalCost: decimal("total_cost", { precision: 12, scale: 6 }).notNull().default("0"),
  totalInputTokens: bigint("total_input_tokens", { mode: "number" }).notNull().default(0),
  totalOutputTokens: bigint("total_output_tokens", { mode: "number" }).notNull().default(0),
  totalCalls: int("total_calls").notNull().default(0),
  lastCalculatedAt: timestamp("last_calculated_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  sessionIdx: uniqueIndex("cost_session_idx").on(table.sessionId),
}));


// Schemas for inserts
export const insertMsalUserSchema = createInsertSchema(msalUsers).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  deletedAt: true,
});

export const insertAiSessionSchema = createInsertSchema(aiSessions).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  lastAccessedAt: true,
  deletedAt: true,
});

export const insertSessionStateSchema = createInsertSchema(sessionStates).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertAiUsageLogSchema = createInsertSchema(aiUsageLogs).omit({
  id: true,
  createdAt: true,
});

export const insertSessionCostSummarySchema = createInsertSchema(sessionCostSummaries).omit({
  id: true,
  lastCalculatedAt: true,
  updatedAt: true,
});

// Types
export type InsertMsalUser = z.infer<typeof insertMsalUserSchema>;
export type MsalUser = typeof msalUsers.$inferSelect;
export type InsertAiSession = z.infer<typeof insertAiSessionSchema>;
export type AiSession = typeof aiSessions.$inferSelect;
export type InsertSessionState = z.infer<typeof insertSessionStateSchema>;
export type SessionState = typeof sessionStates.$inferSelect;
export type InsertAiUsageLog = z.infer<typeof insertAiUsageLogSchema>;
export type AiUsageLog = typeof aiUsageLogs.$inferSelect;
export type InsertSessionCostSummary = z.infer<typeof insertSessionCostSummarySchema>;
export type SessionCostSummary = typeof sessionCostSummaries.$inferSelect;

// =============================
// Workflow Step Data Storage
// =============================

// Workflow Steps Tracking - Tracks which steps are completed for each session
export const workflowSteps = mysqlTable("workflow_steps", {
  id: varchar("id", { length: 36 })
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  sessionId: varchar("session_id", { length: 36 }).notNull(), // FK to ai_sessions.id
  stepNumber: int("step_number").notNull(), // 1, 2, 3, etc.
  stepName: varchar("step_name", { length: 100 }).notNull(), // e.g., "conversational_refinement", "artifact_generation", "devops_push"
  status: mysqlEnum("status", ["NOT_STARTED", "IN_PROGRESS", "COMPLETED"]).notNull().default("NOT_STARTED"),
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  sessionStepIdx: uniqueIndex("session_step_idx").on(table.sessionId, table.stepNumber),
  sessionIdx: uniqueIndex("workflow_steps_session_idx").on(table.sessionId),
  stepNumberIdx: uniqueIndex("workflow_steps_step_number_idx").on(table.stepNumber),
}));

// Workflow Step 1 Data - Conversational Refinement
export const workflowStep1Data = mysqlTable("workflow_step1_data", {
  id: varchar("id", { length: 36 })
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  sessionId: varchar("session_id", { length: 36 }).notNull().unique(), // FK to ai_sessions.id
  conversationHistory: json("conversation_history").$type<Array<{
    role: "user" | "assistant";
    content: string;
    timestamp?: string;
  }>>().notNull().default([]),
  capturedRequirements: json("captured_requirements").$type<{
    businessGoals?: string[];
    targetUsers?: string[];
    keyFeatures?: string[];
    technicalConstraints?: string[];
    functionalRequirements?: string[];
    nonFunctionalRequirements?: string[];
    edgeCases?: string[];
    priorityItems?: string[];
    excludedTopics?: string[];
    impliedNeeds?: string[];
  }>().notNull().default({}),
  currentPhase: varchar("current_phase", { length: 50 }).default("understanding"), // understanding, refining, personas, artifacts, complete
  askedQuestions: json("asked_questions").$type<string[]>().notNull().default([]),
  requirement: longtext("requirement"), // Final requirement text
  isReadyToGenerate: boolean("is_ready_to_generate").default(false),
  complianceGuidelines: json("compliance_guidelines").$type<Array<{
    id: string;
    name: string;
    content: string;
  }>>().notNull().default([]),
  selectedPersonaIds: json("selected_persona_ids").$type<string[]>().notNull().default([]),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  sessionIdx: uniqueIndex("step1_session_idx").on(table.sessionId),
}));

// Workflow Step 2 Data - Artifact Generation
export const workflowStep2Data = mysqlTable("workflow_step2_data", {
  id: varchar("id", { length: 36 })
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  sessionId: varchar("session_id", { length: 36 }).notNull().unique(), // FK to ai_sessions.id
  epics: json("epics").$type<Epic[]>().notNull().default([]),
  features: json("features").$type<Feature[]>().notNull().default([]),
  userStories: json("user_stories").$type<UserStory[]>().notNull().default([]),
  personas: json("personas").$type<Persona[]>().notNull().default([]),
  guidelines: longtext("guidelines"), // Design guidelines
  figmaGuidelines: longtext("figma_guidelines"),
  wikiPages: json("wiki_pages").$type<WikiPage[]>().notNull().default([]),
  subtasks: json("subtasks").$type<Array<{
    id: string;
    userStoryId: string;
    title: string;
    description: string;
    estimatedHours: number;
    status?: string;
  }>>().notNull().default([]),
  testCases: json("test_cases").$type<Array<{
    id: string;
    userStoryId: string;
    title: string;
    scenario?: string;
    steps: Array<{
      step: number;
      action: string;
      result: string;
    }>;
    preconditions?: string;
    postconditions?: string;
    priority?: string;
  }>>().notNull().default([]),
  generationMetadata: json("generation_metadata").$type<{
    model?: string;
    provider?: string;
    temperature?: number;
    generatedAt?: string;
    generationTime?: number;
  }>(),
  qualityReport: json("quality_report").$type<Record<string, unknown>>(),
  generationLogs: json("generation_logs").$type<Array<{ message: string; timestamp: string }>>(),
  domainExpertAnalysis: json("domain_expert_analysis").$type<{ domain: string; domainAnalysis: string }>(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  sessionIdx: uniqueIndex("step2_session_idx").on(table.sessionId),
}));

// Artifact Generation Jobs - persistent job tracking for long-running artifact generation (single + council)
export const artifactGenerationJobRecords = mysqlTable("artifact_generation_jobs", {
  jobId: varchar("job_id", { length: 36 })
    .primaryKey(),
  sessionId: varchar("session_id", { length: 36 }),
  jobType: varchar("job_type", { length: 50 }).notNull().default("council"), // 'single' | 'council'
  status: varchar("status", { length: 50 }).notNull().default("pending"),
  progress: int("progress").notNull().default(0),
  step: varchar("step", { length: 500 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  completedAt: timestamp("completed_at"),
  // Large JSON payloads are stored as longtext to avoid MySQL JSON size limits
  result: longtext("result"),
  error: longtext("error"),
  qualityReport: json("quality_report"),
  generationLogs: json("generation_logs"),
  domainExpertAnalysis: json("domain_expert_analysis"),
  councilData: json("council_data"),
});

export type ArtifactGenerationJobRecord = typeof artifactGenerationJobRecords.$inferSelect;
export type InsertArtifactGenerationJobRecord = typeof artifactGenerationJobRecords.$inferInsert;

// Workflow Step 3 Data - DevOps Push (optional, for future use)
export const workflowStep3Data = mysqlTable("workflow_step3_data", {
  id: varchar("id", { length: 36 })
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  sessionId: varchar("session_id", { length: 36 }).notNull().unique(), // FK to ai_sessions.id
  azureConfig: json("azure_config").$type<{
    organization?: string;
    project?: string;
    repository?: string;
    branch?: string;
    pat?: string;
  }>(),
  pushedItems: json("pushed_items").$type<{
    epics?: Array<{ id: string; adoWorkItemId?: number }>;
    features?: Array<{ id: string; adoWorkItemId?: number }>;
    userStories?: Array<{ id: string; adoWorkItemId?: number }>;
    testCases?: Array<{ id: string; adoTestCaseId?: string }>;
    wikiPages?: Array<{ id: string }>;
  }>().notNull().default({}),
  pushStatus: varchar("push_status", { length: 50 }).default("not_started"), // not_started, in_progress, completed, failed
  pushErrors: json("push_errors").$type<Array<{
    itemId: string;
    itemType: string;
    error: string;
  }>>().notNull().default([]),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  sessionIdx: uniqueIndex("step3_session_idx").on(table.sessionId),
}));

// Schemas for inserts
export const insertWorkflowStepSchema = createInsertSchema(workflowSteps).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertWorkflowStep1DataSchema = createInsertSchema(workflowStep1Data).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertWorkflowStep2DataSchema = createInsertSchema(workflowStep2Data).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertWorkflowStep3DataSchema = createInsertSchema(workflowStep3Data).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

// Types
export type InsertWorkflowStep = z.infer<typeof insertWorkflowStepSchema>;
export type WorkflowStep = typeof workflowSteps.$inferSelect;
export type InsertWorkflowStep1Data = z.infer<typeof insertWorkflowStep1DataSchema>;
export type WorkflowStep1Data = typeof workflowStep1Data.$inferSelect;
export type InsertWorkflowStep2Data = z.infer<typeof insertWorkflowStep2DataSchema>;
export type WorkflowStep2Data = typeof workflowStep2Data.$inferSelect;
export type InsertWorkflowStep3Data = z.infer<typeof insertWorkflowStep3DataSchema>;
export type WorkflowStep3Data = typeof workflowStep3Data.$inferSelect;

// ========== Autonomous Automated Test Generation ==========
// crawl_runs: one record per crawl request
export const crawlRuns = mysqlTable("crawl_runs", {
  id: varchar("id", { length: 36 })
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  baseUrl: varchar("base_url", { length: 2048 }).notNull(),
  environment: varchar("environment", { length: 100 }).default("default"),
  userRole: varchar("user_role", { length: 100 }).default("default"),
  status: varchar("status", { length: 50 }).notNull().default("pending"), // pending, running, completed, failed
  pagesDiscovered: int("pages_discovered").notNull().default(0),
  domVersionsCreated: int("dom_versions_created").notNull().default(0),
  config: json("config").$type<Record<string, unknown>>(),
  startedAt: timestamp("started_at").defaultNow().notNull(),
  finishedAt: timestamp("finished_at"),
  errorMessage: text("error_message"),
  projectId: varchar("project_id", { length: 36 }),
  organizationId: varchar("organization_id", { length: 36 }),
});

export type CrawlRun = typeof crawlRuns.$inferSelect;
export type InsertCrawlRun = typeof crawlRuns.$inferInsert;

// automated_test_pages: discovered pages per run (linked by crawl_run_id stored in page_dom_versions or we add crawl_run_id to pages)
export const automatedTestPages = mysqlTable(
  "automated_test_pages",
  {
    id: varchar("id", { length: 36 })
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    crawlRunId: varchar("crawl_run_id", { length: 36 }).notNull(),
    pageType: varchar("page_type", { length: 100 }).default("page"),
    routePattern: varchar("route_pattern", { length: 512 }).notNull(),
    sampleUrl: varchar("sample_url", { length: 2048 }).notNull(),
    userRole: varchar("user_role", { length: 100 }).default("default"),
    pageSignatureHash: varchar("page_signature_hash", { length: 64 }),
    title: varchar("title", { length: 512 }),
    depth: int("depth").notNull().default(0),
    parentPageId: varchar("parent_page_id", { length: 36 }),
    linkCount: int("link_count").notNull().default(0),
    formCount: int("form_count").notNull().default(0),
    elementCount: int("element_count").notNull().default(0),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("automated_test_pages_run_route_role").on(
      table.crawlRunId,
      table.routePattern,
      table.userRole
    ),
  ]
);

export type AutomatedTestPage = typeof automatedTestPages.$inferSelect;
export type InsertAutomatedTestPage = typeof automatedTestPages.$inferInsert;

// page_dom_versions: one DOM contract (JSON) per page version
export const pageDomVersions = mysqlTable("page_dom_versions", {
  id: varchar("id", { length: 36 })
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  pageId: varchar("page_id", { length: 36 }).notNull(),
  versionNumber: int("version_number").notNull().default(1),
  domHash: varchar("dom_hash", { length: 64 }),
  domContract: json("dom_contract").$type<Record<string, unknown>>().notNull(),
  extractedAt: timestamp("extracted_at").defaultNow().notNull(),
});

export type PageDomVersion = typeof pageDomVersions.$inferSelect;
export type InsertPageDomVersion = typeof pageDomVersions.$inferInsert;

// page_forms: normalized form metadata (optional, for querying)
export const pageForms = mysqlTable("page_forms", {
  id: varchar("id", { length: 36 })
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  pageId: varchar("page_id", { length: 36 }).notNull(),
  formName: varchar("form_name", { length: 255 }),
  formIndex: int("form_index").notNull().default(0),
  xpath: varchar("xpath", { length: 2048 }),
  cssSelector: varchar("css_selector", { length: 2048 }),
  actionUrl: varchar("action_url", { length: 2048 }),
  method: varchar("method", { length: 16 }).default("GET"),
  fieldCount: int("field_count").notNull().default(0),
});

export type PageForm = typeof pageForms.$inferSelect;
export type InsertPageForm = typeof pageForms.$inferInsert;

// page_dom_elements: normalized elements (form fields, buttons, links) with xpath and css_selector
export const pageDomElements = mysqlTable("page_dom_elements", {
  id: varchar("id", { length: 36 })
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  pageId: varchar("page_id", { length: 36 }).notNull(),
  elementCategory: varchar("element_category", { length: 50 }).notNull(), // form, input, button, link, select, textarea
  elementType: varchar("element_type", { length: 100 }),
  xpath: varchar("xpath", { length: 2048 }).notNull(),
  cssSelector: varchar("css_selector", { length: 2048 }).notNull(),
  elementId: varchar("element_id", { length: 255 }),
  elementName: varchar("element_name", { length: 255 }),
  labelText: varchar("label_text", { length: 512 }),
  isRequired: boolean("is_required").default(false),
  formId: varchar("form_id", { length: 36 }),
  parentElementXpath: varchar("parent_element_xpath", { length: 2048 }),
  elementTag: varchar("element_tag", { length: 64 }),
  attributes: json("attributes").$type<Record<string, unknown>>(),
});

export type PageDomElement = typeof pageDomElements.$inferSelect;
export type InsertPageDomElement = typeof pageDomElements.$inferInsert;

// automated_test_cases: generated test cases per crawl run (DOM-TC-0001, etc.)
export const automatedTestCases = mysqlTable("automated_test_cases", {
  id: varchar("id", { length: 36 })
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  crawlRunId: varchar("crawl_run_id", { length: 36 }).notNull(),
  pageId: varchar("page_id", { length: 36 }),
  caseCode: varchar("case_code", { length: 64 }).notNull(), // e.g. DOM-TC-0001
  title: varchar("title", { length: 512 }).notNull(),
  testType: varchar("test_type", { length: 64 }).notNull().default("ui"), // ui | form_submit | navigation | action
  steps: json("steps").$type<Array<{ action: string; expectedResult: string }>>(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type AutomatedTestCase = typeof automatedTestCases.$inferSelect;
export type InsertAutomatedTestCase = typeof automatedTestCases.$inferInsert;

// automated_test_scripts: generated Playwright spec content per crawl run
export const automatedTestScripts = mysqlTable("automated_test_scripts", {
  id: varchar("id", { length: 36 })
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  crawlRunId: varchar("crawl_run_id", { length: 36 }).notNull(),
  fileName: varchar("file_name", { length: 255 }).notNull().default("autonomous.spec.ts"),
  scriptContent: longtext("script_content").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type AutomatedTestScript = typeof automatedTestScripts.$inferSelect;
export type InsertAutomatedTestScript = typeof automatedTestScripts.$inferInsert;

// automated_test_runs: one record per "run tests" execution
export const automatedTestRuns = mysqlTable("automated_test_runs", {
  id: varchar("id", { length: 36 })
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  crawlRunId: varchar("crawl_run_id", { length: 36 }).notNull(),
  status: varchar("status", { length: 50 }).notNull().default("pending"), // pending | running | passed | failed
  totalTests: int("total_tests").notNull().default(0),
  passedCount: int("passed_count").notNull().default(0),
  failedCount: int("failed_count").notNull().default(0),
  startedAt: timestamp("started_at").defaultNow().notNull(),
  finishedAt: timestamp("finished_at"),
  errorMessage: text("error_message"),
});

export type AutomatedTestRun = typeof automatedTestRuns.$inferSelect;
export type InsertAutomatedTestRun = typeof automatedTestRuns.$inferInsert;

// automated_test_results: per-test result within a run
export const automatedTestResults = mysqlTable("automated_test_results", {
  id: varchar("id", { length: 36 })
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  testRunId: varchar("test_run_id", { length: 36 }).notNull(),
  testCaseId: varchar("test_case_id", { length: 36 }).notNull(),
  caseCode: varchar("case_code", { length: 64 }),
  status: varchar("status", { length: 20 }).notNull(), // passed | failed
  severity: varchar("severity", { length: 20 }), // critical | high | medium | low
  errorMessage: text("error_message"),
  durationMs: int("duration_ms"),
});

export type AutomatedTestResult = typeof automatedTestResults.$inferSelect;
export type InsertAutomatedTestResult = typeof automatedTestResults.$inferInsert;

// ============================================================
// Stack Modernization Persistence Tables
// ============================================================

export const modernizationAnalyses = mysqlTable("modernization_analyses", {
  id: varchar("id", { length: 36 }).primaryKey(),
  sessionId: varchar("session_id", { length: 36 }),
  userId: varchar("user_id", { length: 36 }),
  tenantId: varchar("tenant_id", { length: 36 }),
  adoOrg: varchar("ado_org", { length: 255 }),
  adoProjectId: varchar("ado_project_id", { length: 255 }),
  adoProjectName: varchar("ado_project_name", { length: 255 }),
  modernizationType: varchar("modernization_type", { length: 50 }).notNull().default("tech_upgrade"),
  llmProvider: varchar("llm_provider", { length: 50 }),
  status: varchar("status", { length: 50 }).notNull().default("initiated"),
  currentStage: varchar("current_stage", { length: 100 }),
  progress: int("progress").notNull().default(0),
  selectedPhases: json("selected_phases").$type<string[]>(),
  repoName: varchar("repo_name", { length: 255 }),
  stackSummary: varchar("stack_summary", { length: 500 }),
  gitBranch: varchar("git_branch", { length: 255 }),
  gitFileCount: int("git_file_count").default(0),
  errors: json("errors").$type<string[]>(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  completedAt: timestamp("completed_at"),
});

export const modernizationPhaseOutputs = mysqlTable("modernization_phase_outputs", {
  id: varchar("id", { length: 36 }).primaryKey(),
  analysisId: varchar("analysis_id", { length: 36 }).notNull(),
  phase: varchar("phase", { length: 50 }).notNull(),
  status: varchar("status", { length: 50 }).notNull().default("pending"),
  metadata: json("metadata").$type<Record<string, any>>(),
  reportMarkdown: longtext("report_markdown"),
  activityLog: json("activity_log").$type<any[]>(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const modernizationVersionChanges = mysqlTable("modernization_version_changes", {
  id: varchar("id", { length: 36 })
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  analysisId: varchar("analysis_id", { length: 36 }).notNull(),
  phaseReset: varchar("phase_reset", { length: 50 }).notNull(),
  previousSelections: json("previous_selections").$type<Array<{ package: string; currentVersion: string; selectedVersion: string }>>(),
  newSelections: json("new_selections").$type<Array<{ package: string; currentVersion: string; selectedVersion: string }>>(),
  previousPlanSummary: text("previous_plan_summary"),
  downstreamPhasesCleared: json("downstream_phases_cleared").$type<string[]>(),
  changedBy: varchar("changed_by", { length: 36 }),
  changeReason: text("change_reason"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const modernizationTokenUsage = mysqlTable("modernization_token_usage", {
  id: varchar("id", { length: 36 }).primaryKey(),
  analysisId: varchar("analysis_id", { length: 36 }).notNull(),
  phase: varchar("phase", { length: 50 }).notNull(),
  agent: varchar("agent", { length: 100 }),
  model: varchar("model", { length: 50 }),
  inputTokens: int("input_tokens").notNull().default(0),
  outputTokens: int("output_tokens").notNull().default(0),
  totalTokens: int("total_tokens").notNull().default(0),
  estimatedCost: decimal("estimated_cost", { precision: 10, scale: 6 }).notNull().default("0"),
  durationMs: int("duration_ms").notNull().default(0),
  llmCalls: int("llm_calls").notNull().default(1),
  codebaseFileCount: int("codebase_file_count").default(0),
  codebaseTotalLines: int("codebase_total_lines").default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// GenAI Artifact Events - Tracks individual artifact generation events for metrics
export const artifactEvents = mysqlTable("artifact_events", {
  id: varchar("id", { length: 36 })
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  artifactId: varchar("artifact_id", { length: 100 }),
  useCase: varchar("use_case", { length: 50 }),
  userId: varchar("user_id", { length: 100 }),
  projectId: varchar("project_id", { length: 100 }),
  status: varchar("status", { length: 50 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  tokensUsed: int("tokens_used"),
  processingTimeMs: int("processing_time_ms"),
});

export const insertArtifactEventSchema = createInsertSchema(artifactEvents).omit({
  id: true,
  createdAt: true,
});

export type InsertArtifactEvent = z.infer<typeof insertArtifactEventSchema>;
export type ArtifactEvent = typeof artifactEvents.$inferSelect;

// Notifications
export const notifications = mysqlTable("notifications", {
  id: varchar("id", { length: 36 })
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  tenantId: varchar("tenant_id", { length: 100 }).notNull(),
  userId: varchar("user_id", { length: 36 }).notNull(),
  type: varchar("type", { length: 50 }).notNull(),
  title: varchar("title", { length: 255 }).notNull(),
  message: text("message").notNull(),
  brdId: varchar("brd_id", { length: 36 }),
  projectId: varchar("project_id", { length: 36 }),
  isRead: boolean("is_read").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type Notification = typeof notifications.$inferSelect;

// ============================================================
// Platform Integrations (Monitoring & Operations Adapters)
// ============================================================

export const integrations = mysqlTable("integrations", {
  id: varchar("id", { length: 36 })
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  tenantId: varchar("tenant_id", { length: 36 }).notNull(),
  organizationId: varchar("organization_id", { length: 36 }),
  projectId: varchar("project_id", { length: 36 }), // Project-scoped configuration
  integrationType: varchar("integration_type", { length: 50 }).notNull(), // 'datadog' | 'servicenow'
  apiKey: varchar("api_key", { length: 255 }).notNull(),
  appKey: varchar("app_key", { length: 255 }), // Datadog specific
  baseUrl: varchar("base_url", { length: 255 }), // ServiceNow specific
  status: varchar("status", { length: 50 }).notNull().default("active"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
});

export const insertIntegrationSchema = createInsertSchema(integrations).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type Integration = typeof integrations.$inferSelect;
export type InsertIntegration = typeof insertIntegrationSchema._type;

// =============================
// Jira Integrations
// =============================

// DEPRECATED for per-user actions; retained for legacy admin reads and instance URL discovery.
export const jiraConnections = mysqlTable("jira_connections", {
  id: varchar("id", { length: 36 })
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: varchar("name", { length: 255 }).notNull(),
  instanceUrl: varchar("instance_url", { length: 500 }).notNull(),
  email: varchar("email", { length: 255 }),
  apiTokenEncrypted: text("api_token_encrypted"),
  isActive: tinyint("is_active").notNull().default(1),
  // When 1, this connection's stored email/PAT is used for operations that
  // require Jira admin rights (e.g. POST /rest/api/3/project). At most one row
  // per instance_url should be flagged. Toggled from Settings by TenantAdmin.
  isAdminConnection: tinyint("is_admin_connection").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const jiraSettings = mysqlTable("jira_settings", {
  id: varchar("id", { length: 36 })
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  projectId: varchar("project_id", { length: 36 }).notNull().unique(),
  connectionId: varchar("connection_id", { length: 36 }),
  instanceUrl: varchar("instance_url", { length: 500 }).notNull(),
  projectKey: varchar("project_key", { length: 100 }).notNull(),
  email: varchar("email", { length: 255 }),
  apiTokenEncrypted: text("api_token_encrypted"),
  storyPointsFieldId: varchar("story_points_field_id", { length: 100 }),
  epicLinkFieldId: varchar("epic_link_field_id", { length: 100 }),
  sprintFieldId: varchar("sprint_field_id", { length: 100 }),
  acceptanceCriteriaFieldId: varchar("acceptance_criteria_field_id", { length: 100 }),
  confluenceSpaceKey: varchar("confluence_space_key", { length: 100 }),
  isActive: tinyint("is_active").notNull().default(1),
  lastTestedAt: timestamp("last_tested_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertJiraConnectionSchema = createInsertSchema(jiraConnections).omit({
  id: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
});

export const insertJiraSettingsSchema = createInsertSchema(jiraSettings).omit({
  id: true,
  isActive: true,
  lastTestedAt: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertJiraConnection = z.infer<typeof insertJiraConnectionSchema>;
export type JiraConnection = typeof jiraConnections.$inferSelect;
export type InsertJiraSettings = z.infer<typeof insertJiraSettingsSchema>;
export type JiraSettings = typeof jiraSettings.$inferSelect;

// Per-user Jira PAT credentials (replaces shared admin token for all user-facing Jira actions)
export const userJiraCredentials = mysqlTable("user_jira_credentials", {
  id: varchar("id", { length: 36 })
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  userId: varchar("user_id", { length: 36 }).notNull(),
  instanceUrl: varchar("instance_url", { length: 500 }).notNull(),
  email: varchar("email", { length: 255 }).notNull(),
  apiTokenEncrypted: text("api_token_encrypted").notNull(),
  accountId: varchar("account_id", { length: 100 }),
  displayName: varchar("display_name", { length: 255 }),
  lastTestedAt: timestamp("last_tested_at"),
  isActive: tinyint("is_active").notNull().default(1),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertUserJiraCredentialSchema = createInsertSchema(userJiraCredentials).omit({
  id: true,
  accountId: true,
  displayName: true,
  lastTestedAt: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
});

export type UserJiraCredential = typeof userJiraCredentials.$inferSelect;
export type InsertUserJiraCredential = z.infer<typeof insertUserJiraCredentialSchema>;

// Per-user Git hosting credentials. One row per (user, provider, instance) so
// every user authenticates GitLab / GitHub / Bitbucket with their own token.
// `provider` discriminates the source, consistent with project_git_config.provider.
export const userGitCredentials = mysqlTable("user_git_credentials", {
  id: varchar("id", { length: 36 })
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  userId: varchar("user_id", { length: 36 }).notNull(),
  provider: varchar("provider", { length: 20 }).notNull(), // gitlab | github | bitbucket
  baseUrl: varchar("base_url", { length: 500 }).notNull(),
  tokenEncrypted: text("token_encrypted").notNull(),
  externalUserId: varchar("external_user_id", { length: 100 }), // provider's user/account id
  username: varchar("username", { length: 255 }),
  lastTestedAt: timestamp("last_tested_at"),
  isActive: tinyint("is_active").notNull().default(1),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  uniqUserProviderBaseUrl: uniqueIndex("uniq_user_git").on(table.userId, table.provider, table.baseUrl),
}));

export const insertUserGitCredentialSchema = createInsertSchema(userGitCredentials).omit({
  id: true,
  externalUserId: true,
  username: true,
  lastTestedAt: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
});

export type UserGitCredential = typeof userGitCredentials.$inferSelect;
export type InsertUserGitCredential = z.infer<typeof insertUserGitCredentialSchema>;

export const userProjectRepoCredentials = mysqlTable("user_project_repo_credentials", {
  id: varchar("id", { length: 36 })
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  userId: varchar("user_id", { length: 36 }).notNull(),
  projectId: varchar("project_id", { length: 36 }).notNull(),
  provider: varchar("provider", { length: 20 }).notNull(), // gitlab | github | bitbucket
  baseUrl: varchar("base_url", { length: 500 }).notNull(),
  tokenEncrypted: text("token_encrypted").notNull(),
  externalUserId: varchar("external_user_id", { length: 100 }),
  username: varchar("username", { length: 255 }),
  lastTestedAt: timestamp("last_tested_at"),
  isActive: tinyint("is_active").notNull().default(1),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  uniqUserProjectRepo: uniqueIndex("uniq_user_project_repo").on(
    table.userId,
    table.projectId,
    table.provider,
    table.baseUrl,
  ),
}));

export type UserProjectRepoCredential = typeof userProjectRepoCredentials.$inferSelect;

// Per-user, per-project readiness markers. Secrets live in contextual credential
// tables; this table records that the current user's credentials were validated
// for a specific SDLC project.
export const userProjectIntegrationCredentials = mysqlTable(
  "user_project_integration_credentials",
  {
    id: varchar("id", { length: 36 })
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: varchar("user_id", { length: 36 }).notNull(),
    projectId: varchar("project_id", { length: 36 }).notNull(),
    integrationKind: varchar("integration_kind", { length: 50 }).notNull(),
    integrationId: varchar("integration_id", { length: 100 }).notNull(),
    providerKey: varchar("provider_key", { length: 100 }),
    lastTestStatus: varchar("last_test_status", { length: 20 }).default("untested"),
    lastTestMessage: text("last_test_message"),
    lastTestedAt: timestamp("last_tested_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
  },
  (table) => [
    uniqueIndex("ux_user_project_integration_credentials").on(
      table.userId,
      table.projectId,
      table.integrationKind,
      table.integrationId,
    ),
  ],
);

export type UserProjectIntegrationCredential = typeof userProjectIntegrationCredentials.$inferSelect;

// Jira action audit log — one row per Jira write (push, create project, etc.)
export const jiraActionLogs = mysqlTable("jira_action_logs", {
  id: varchar("id", { length: 36 })
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  userId: varchar("user_id", { length: 36 }).notNull(),
  sdlcProjectId: varchar("sdlc_project_id", { length: 36 }),
  jiraProjectKey: varchar("jira_project_key", { length: 100 }),
  action: varchar("action", { length: 100 }).notNull(),
  issueKey: varchar("issue_key", { length: 100 }),
  status: varchar("status", { length: 20 }).notNull().default("success"),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type JiraActionLog = typeof jiraActionLogs.$inferSelect;

export const integrationToolCatalog = mysqlTable(
  "integration_tool_catalog",
  {
    id: varchar("id", { length: 36 })
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    categoryKey: varchar("category_key", { length: 100 }).notNull(),
    providerKey: varchar("provider_key", { length: 100 }).notNull(),
    displayName: varchar("display_name", { length: 255 }).notNull(),
    isActive: tinyint("is_active").notNull().default(1),
    supportsTesting: tinyint("supports_testing").notNull().default(1),
    requiredFields: json("required_fields")
      .$type<
        Array<{
          key: string;
          label: string;
          type: "text" | "password" | "url" | "email";
          required: boolean;
        }>
      >()
      .notNull(),
    testConfig: json("test_config").$type<Record<string, unknown> | null>(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
  },
  (table) => [
    uniqueIndex("ux_catalog_category_provider").on(
      table.categoryKey,
      table.providerKey,
    ),
  ],
);

export const orgIntegrationConfigs = mysqlTable("org_integration_configs", {
  id: varchar("id", { length: 36 })
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  orgType: varchar("org_type", { length: 50 }).notNull(),
  orgId: varchar("org_id", { length: 36 }).notNull(),
  toolCatalogId: varchar("tool_catalog_id", { length: 36 }).notNull(),
  config: json("config").$type<Record<string, string>>().notNull(),
  secretsEncrypted: longtext("secrets_encrypted"),
  lastTestStatus: varchar("last_test_status", { length: 20 }).default("untested"),
  lastTestMessage: text("last_test_message"),
  lastTestedAt: timestamp("last_tested_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
});

export const projectIntegrationConfigs = mysqlTable(
  "project_integration_configs",
  {
    id: varchar("id", { length: 36 })
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    projectId: varchar("project_id", { length: 36 }).notNull(),
    categoryKey: varchar("category_key", { length: 100 }).notNull(),
    useOrgDefault: tinyint("use_org_default").notNull().default(1),
    orgIntegrationConfigId: varchar("org_integration_config_id", { length: 36 }),
    toolCatalogId: varchar("tool_catalog_id", { length: 36 }),
    config: json("config").$type<Record<string, string> | null>(),
    secretsEncrypted: longtext("secrets_encrypted"),
    lastTestStatus: varchar("last_test_status", { length: 20 }).default("untested"),
    lastTestMessage: text("last_test_message"),
    lastTestedAt: timestamp("last_tested_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
  },
  (table) => [
    uniqueIndex("ux_project_category").on(table.projectId, table.categoryKey),
  ],
);

export const integrationSettings = mysqlTable("integration_settings", {
  id: varchar("id", { length: 36 }).primaryKey().$defaultFn(() => crypto.randomUUID()),
  projectId: varchar("project_id", { length: 36 }).notNull().unique(),
  integrationType: varchar("integration_type", { length: 50 }).notNull().default("ado"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertIntegrationSettingsSchema = createInsertSchema(integrationSettings).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertIntegrationSettings = z.infer<typeof insertIntegrationSettingsSchema>;
export type IntegrationSettings = typeof integrationSettings.$inferSelect;

// =============================
// Prompt Library Storage
// =============================

export const prompts = mysqlTable("prompts", {
  id: varchar("id", { length: 36 })
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  title: varchar("title", { length: 255 }).notNull(),
  description: text("description"),
  content: longtext("content").notNull(),
  category: varchar("category", { length: 100 }).notNull().default("General"),
  tags: json("tags").$type<string[]>().default([]),
  usageCount: int("usage_count").default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertPromptSchema = createInsertSchema(prompts).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type Prompt = typeof prompts.$inferSelect;
export type InsertPrompt = z.infer<typeof insertPromptSchema>;

// =============================
// Polaris AI-Metrics (universal AI usage ledger + JIRA mapping + productivity)
// NOTE: the authoritative DDL lives in server/db.ts `ensurePolarisMetricsTables()`
// (raw CREATE TABLE IF NOT EXISTS with prefixed unique keys). These Drizzle defs
// are for typed queries; keep columns in sync with that SQL.
// =============================

// Universal AI usage ledger — one row per AI call (generation + embedding).
// Source of truth for the Polaris /api/ai-metrics endpoint.
export const universalAiUsageLogs = mysqlTable("universal_ai_usage_logs", {
  id: varchar("id", { length: 36 })
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  userId: varchar("user_id", { length: 36 }),            // = users.id (NULL for background/unattributed)
  tenantId: varchar("tenant_id", { length: 36 }),        // stored, NOT filtered (future use)
  teamId: varchar("team_id", { length: 100 }),           // JIRA project_key when known
  projectId: varchar("project_id", { length: 100 }),
  sessionId: varchar("session_id", { length: 36 }),
  correlationId: varchar("correlation_id", { length: 36 }), // links usage row -> quality decision / save
  provider: varchar("provider", { length: 50 }).notNull().default("claude"), // claude | bedrock(embedding)
  modelName: varchar("model_name", { length: 255 }).notNull(),
  featureName: varchar("feature_name", { length: 100 }), // brd | workflow | design | specs | ai_enhance | embedding | ...
  useCase: varchar("use_case", { length: 100 }),
  requestStatus: varchar("request_status", { length: 20 }).notNull().default("success"), // success | failed
  qualityDecision: varchar("quality_decision", { length: 20 }).notNull().default("unrated"), // unrated|accepted|modified|rejected
  inputTokens: int("input_tokens").notNull().default(0),
  outputTokens: int("output_tokens").notNull().default(0),
  cacheTokens: int("cache_tokens").notNull().default(0),
  totalTokens: int("total_tokens").notNull().default(0), // input + output + cache
  costUsd: decimal("cost_usd", { precision: 12, scale: 6 }).notNull().default("0"),
  currency: varchar("currency", { length: 3 }).notNull().default("USD"),
  latencyMs: int("latency_ms"),
  requestMetadata: json("request_metadata").$type<Record<string, any>>(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  userCreatedIdx: index("idx_uaiul_user_created").on(table.userId, table.createdAt),
  providerCreatedIdx: index("idx_uaiul_provider_created").on(table.provider, table.createdAt),
  useCaseCreatedIdx: index("idx_uaiul_usecase_created").on(table.useCase, table.createdAt),
  createdIdx: index("idx_uaiul_created").on(table.createdAt),
  qualityIdx: index("idx_uaiul_quality").on(table.qualityDecision),
  correlationIdx: index("idx_uaiul_correlation").on(table.correlationId),
}));

export type UniversalAiUsageLog = typeof universalAiUsageLogs.$inferSelect;
export type InsertUniversalAiUsageLog = typeof universalAiUsageLogs.$inferInsert;

// JIRA team membership + mapping for scoped teams[]/users[].
export const jiraTeamMembers = mysqlTable("jira_team_members", {
  id: varchar("id", { length: 36 })
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  userId: varchar("user_id", { length: 36 }),            // = users.id (NULL when unmatched)
  jiraAccountId: varchar("jira_account_id", { length: 128 }).notNull(),
  jiraDisplayName: varchar("jira_display_name", { length: 255 }),
  jiraEmail: varchar("jira_email", { length: 255 }),
  instanceUrl: varchar("instance_url", { length: 500 }).notNull(),
  projectId: varchar("project_id", { length: 36 }),      // our sdlc_projects.id when resolvable
  projectKey: varchar("project_key", { length: 100 }).notNull(),
  projectName: varchar("project_name", { length: 255 }),
  active: tinyint("active").notNull().default(1),
  matchMethod: varchar("match_method", { length: 20 }).notNull().default("unmatched"), // credential|email|display_name|manual|unmatched
  matchConfidence: decimal("match_confidence", { precision: 4, scale: 3 }),
  syncedAt: timestamp("synced_at").defaultNow().notNull(),
}, (table) => ({
  userIdx: index("idx_jtm_user").on(table.userId),
  projectIdx: index("idx_jtm_project").on(table.projectKey),
}));

export type JiraTeamMember = typeof jiraTeamMembers.$inferSelect;
export type InsertJiraTeamMember = typeof jiraTeamMembers.$inferInsert;

// Sticky manual overrides (survive re-sync) for jira accountId -> users.id.
export const jiraUserOverrides = mysqlTable("jira_user_overrides", {
  id: varchar("id", { length: 36 })
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  instanceUrl: varchar("instance_url", { length: 500 }).notNull(),
  jiraAccountId: varchar("jira_account_id", { length: 128 }).notNull(),
  userId: varchar("user_id", { length: 36 }).notNull(),  // = users.id
  createdBy: varchar("created_by", { length: 36 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type JiraUserOverride = typeof jiraUserOverrides.$inferSelect;
export type InsertJiraUserOverride = typeof jiraUserOverrides.$inferInsert;

// Productivity targets (target_saved_hours per period).
export const productivityTargets = mysqlTable("productivity_targets", {
  id: varchar("id", { length: 36 })
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  periodType: varchar("period_type", { length: 20 }).notNull(), // daily | weekly | monthly
  periodStart: date("period_start").notNull(),
  periodEnd: date("period_end").notNull(),
  targetSavedHours: decimal("target_saved_hours", { precision: 10, scale: 2 }).notNull().default("0"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type ProductivityTarget = typeof productivityTargets.$inferSelect;
export type InsertProductivityTarget = typeof productivityTargets.$inferInsert;

// ============================================================
