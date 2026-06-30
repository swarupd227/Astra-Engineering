import { sql } from "drizzle-orm";
import { mysqlTable, text, varchar, timestamp, int, json, boolean } from "drizzle-orm/mysql-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const users = mysqlTable("users", {
  id: varchar("id", { length: 255 }).primaryKey().default(sql`(UUID())`),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
});

export const projects = mysqlTable("projects", {
  id: varchar("id", { length: 255 }).primaryKey().default(sql`(UUID())`),
  userId: varchar("user_id", { length: 255 }).notNull().references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
  type: text("type").notNull(),
  domain: text("domain").default("insurance"),
  productDescription: text("product_description"),
  websiteUrl: text("website_url"),
  applicationType: text("application_type").default("web_portal"),
  adoEnabled: int("ado_enabled").default(0),
  adoConnectionId: varchar("ado_connection_id", { length: 255 }),
  adoProjectId: text("ado_project_id"),
  adoProjectName: text("ado_project_name"),
  devxSdlcProjectId: varchar("devx_sdlc_project_id", { length: 255 }),
  devxSdlcProjectName: varchar("devx_sdlc_project_name", { length: 255 }),
  devxAdoOrganization: varchar("devx_ado_organization", { length: 255 }),
  goldenRepoId: varchar("golden_repo_id", { length: 255 }),
  goldenRepoName: varchar("golden_repo_name", { length: 255 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const testSessions = mysqlTable("test_sessions", {
  id: varchar("id", { length: 255 }).primaryKey().default(sql`(UUID())`),
  projectId: varchar("project_id", { length: 255 }).references(() => projects.id, { onDelete: "set null" }),
  figmaUrl: text("figma_url").notNull(),
  websiteUrl: text("website_url").notNull(),
  testScope: text("test_scope").notNull(),
  browserTarget: text("browser_target").notNull(),
  status: text("status").notNull().default("pending"),
  tasks: json("tasks").$type<AgentTask[]>().default([]),
  metrics: json("metrics").$type<LiveMetric[]>(),
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const testResults = mysqlTable("test_results", {
  id: varchar("id", { length: 255 }).primaryKey().default(sql`(UUID())`),
  sessionId: varchar("session_id", { length: 255 }).notNull().references(() => testSessions.id, { onDelete: "cascade" }),
  completionTime: int("completion_time").notNull(),
  designCompliance: int("design_compliance").notNull(),
  accessibilityWarnings: int("accessibility_warnings").notNull(),
  testCasesGenerated: int("test_cases_generated").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const visualDiffs = mysqlTable("visual_diffs", {
  id: varchar("id", { length: 255 }).primaryKey().default(sql`(UUID())`),
  resultId: varchar("result_id", { length: 255 }).notNull().references(() => testResults.id, { onDelete: "cascade" }),
  area: text("area").notNull(),
  count: int("count").notNull(),
  severity: text("severity").notNull(),
  screenshotUrl: text("screenshot_url"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertTestSessionSchema = createInsertSchema(testSessions).omit({
  id: true,
  status: true,
  createdAt: true,
  completedAt: true,
});

export const insertTestResultSchema = createInsertSchema(testResults).omit({
  id: true,
  createdAt: true,
});

export const insertVisualDiffSchema = createInsertSchema(visualDiffs).omit({
  id: true,
  createdAt: true,
});

// ─── Auto-Test Tables ────────────────────────────────────────────────────────

export const autoTestRuns = mysqlTable("auto_test_runs", {
  id: varchar("id", { length: 255 }).primaryKey(),
  url: text("url").notNull(),
  status: text("status").notNull().default("crawling"), // crawling | done | error
  pageCount: int("page_count").default(0),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  completedAt: timestamp("completed_at"),
});

export const autoTestPages = mysqlTable("auto_test_pages", {
  id: varchar("id", { length: 255 }).primaryKey().default(sql`(UUID())`),
  runId: varchar("run_id", { length: 255 }).notNull().references(() => autoTestRuns.id, { onDelete: "cascade" }),
  url: text("url").notNull(),
  title: text("title"),
  forms: int("forms").default(0),
  buttons: int("buttons").default(0),
  inputs: int("inputs").default(0),
  links: int("links").default(0),
  domData: json("dom_data"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const autoTestCases = mysqlTable("auto_test_cases", {
  id: varchar("id", { length: 255 }).primaryKey(),              // TC-001 etc
  runId: varchar("run_id", { length: 255 }).notNull().references(() => autoTestRuns.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  priority: text("priority").notNull(),        // P0, P1, P2
  category: text("category").notNull(),        // smoke, content, navigation, form, negative, workflow
  pageUrl: text("page_url"),
  description: text("description"),
  steps: json("steps").$type<string[]>().default([]),
  expectedResult: text("expected_result"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const autoTestScripts = mysqlTable("auto_test_scripts", {
  id: varchar("id", { length: 255 }).primaryKey().default(sql`(UUID())`),
  runId: varchar("run_id", { length: 255 }).notNull().references(() => autoTestRuns.id, { onDelete: "cascade" }),
  content: text("content").notNull(),
  testCaseIds: json("test_case_ids").$type<string[]>().default([]),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const autoTestExecutions = mysqlTable("auto_test_executions", {
  id: varchar("id", { length: 255 }).primaryKey().default(sql`(UUID())`),
  runId: varchar("run_id", { length: 255 }).notNull().references(() => autoTestRuns.id, { onDelete: "cascade" }),
  scriptId: varchar("script_id", { length: 255 }).references(() => autoTestScripts.id),
  status: text("status").notNull().default("running"), // running | completed | failed
  total: int("total").default(0),
  passed: int("passed").default(0),
  failed: int("failed").default(0),
  skipped: int("skipped").default(0),
  results: json("results").$type<any[]>().default([]),
  executedAt: timestamp("executed_at").defaultNow().notNull(),
  completedAt: timestamp("completed_at"),
});

export type AutoTestRun = typeof autoTestRuns.$inferSelect;
export type AutoTestPage = typeof autoTestPages.$inferSelect;
export type AutoTestCase = typeof autoTestCases.$inferSelect;
export type AutoTestScript = typeof autoTestScripts.$inferSelect;
export type AutoTestExecution = typeof autoTestExecutions.$inferSelect;

// ─────────────────────────────────────────────────────────────────────────────

export type InsertTestSession = z.infer<typeof insertTestSessionSchema>;
export type TestSession = typeof testSessions.$inferSelect;
export type InsertTestResult = z.infer<typeof insertTestResultSchema>;
export type TestResult = typeof testResults.$inferSelect;
export type InsertVisualDiff = z.infer<typeof insertVisualDiffSchema>;
export type VisualDiff = typeof visualDiffs.$inferSelect;

export interface TestSessionWithResults extends TestSession {
  testResults?: {
    completionTime: number;
    designCompliance: number;
    accessibilityWarnings: number;
    testCasesGenerated: number;
    visualDifferences: VisualDifference[];
  };
}

export type TaskStatus = "pending" | "in-progress" | "completed";

export interface AgentTask {
  id: string;
  taskName: string;
  agentName: string;
  status: TaskStatus;
  progress: number;
  details: string;
  timestamp: string;
}

export interface LiveMetric {
  id: string;
  label: string;
  emoji?: string;
  currentValue: number;
  targetValue: number;
  unit?: string;
}

export interface VisualDifference {
  area: string;
  count: number;
  severity: "minor" | "major";
}

export interface TestResults {
  completionTime: number;
  designCompliance: number;
  accessibilityWarnings: number;
  testCasesGenerated: number;
  visualDifferences: VisualDifference[];
}

export interface TaskUpdate {
  taskId: string;
  taskName: string;
  agentName: string;
  status: TaskStatus;
  progress: number;
  details: string;
  timestamp: string;
  metrics?: LiveMetric[];
  results?: TestResults;
}

export interface WorkflowStep {
  action: string;
  description: string;
  selector?: string;
  expectedOutcome?: string;
}

export interface CrawlProgress {
  status: 'initializing' | 'fetching_sitemap' | 'probing_paths' | 'crawling' | 'analyzing' | 'generating_tests' | 'completed' | 'error';
  pagesVisited: number;
  pagesQueued: number;
  formsFound: number;
  buttonsFound: number;
  inputsFound: number;
  currentUrl?: string;
  error?: string;
}

export const functionalTestSessions = mysqlTable("functional_test_sessions", {
  id: varchar("id", { length: 255 }).primaryKey().default(sql`(UUID())`),
  projectId: varchar("project_id", { length: 255 }).references(() => projects.id, { onDelete: "set null" }),
  url: text("url").notNull(),
  testFocus: text("test_focus").notNull(),
  crawlStatus: text("crawl_status").notNull().default("pending"),
  pagesVisited: int("pages_visited").default(0),
  workflowsDiscovered: int("workflows_discovered").default(0),
  testCasesGenerated: int("test_cases_generated").default(0),
  testCasesPassed: int("test_cases_passed").default(0),
  testCasesFailed: int("test_cases_failed").default(0),
  crawlProgress: json("crawl_progress").$type<CrawlProgress>(),
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const workflows = mysqlTable("workflows", {
  id: varchar("id", { length: 255 }).primaryKey().default(sql`(UUID())`),
  sessionId: varchar("session_id", { length: 255 }).notNull().references(() => functionalTestSessions.id, { onDelete: "cascade" }),
  workflowId: text("workflow_id").notNull(),
  name: text("name").notNull(),
  type: text("type").notNull(),
  entryPoint: text("entry_point").notNull(),
  steps: json("steps").$type<WorkflowStep[]>().notNull(),
  confidence: int("confidence").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export interface TestStep {
  step_number: number;
  action: string;
  expected_behavior: string;
}

export const testCases = mysqlTable("test_cases", {
  id: varchar("id", { length: 255 }).primaryKey().default(sql`(UUID())`),
  workflowId: varchar("workflow_id", { length: 255 }).notNull().references(() => workflows.id, { onDelete: "cascade" }),
  testId: text("test_id").notNull(),
  name: text("name").notNull(),
  objective: text("objective").notNull(),
  given: text("given").notNull(),
  when: text("when").notNull(),
  then: text("then").notNull(),
  selector: text("selector"),
  preconditions: json("preconditions").$type<string[]>().default([]),
  test_steps: json("test_steps").$type<TestStep[]>().notNull(),
  postconditions: json("postconditions").$type<string[]>().default([]),
  test_data: json("test_data").$type<Record<string, any>>(),
  test_type: text("test_type").notNull().default("Functional"),
  status: text("status").notNull().default("pending"),
  priority: text("priority").default("P2"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const executionResults = mysqlTable("execution_results", {
  id: varchar("id", { length: 255 }).primaryKey().default(sql`(UUID())`),
  testCaseId: varchar("test_case_id", { length: 255 }).notNull().references(() => testCases.id, { onDelete: "cascade" }),
  status: text("status").notNull(),
  executionTime: int("execution_time").notNull(),
  screenshotUrl: text("screenshot_url"),
  errorLog: text("error_log"),
  consoleErrors: json("console_errors").$type<string[]>(),
  networkErrors: json("network_errors").$type<string[]>(),
  actualResult: text("actual_result"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true,
});

export const insertProjectSchema = createInsertSchema(projects).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertFunctionalTestSessionSchema = createInsertSchema(functionalTestSessions).pick({
  url: true,
  testFocus: true,
  crawlProgress: true,
  projectId: true,
});

export const insertWorkflowSchema = createInsertSchema(workflows).omit({
  id: true,
  createdAt: true,
});

export const insertTestCaseSchema = createInsertSchema(testCases).omit({
  id: true,
  status: true,
  createdAt: true,
});

export const insertExecutionResultSchema = createInsertSchema(executionResults).omit({
  id: true,
  createdAt: true,
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;
export type InsertProject = z.infer<typeof insertProjectSchema>;
export type Project = typeof projects.$inferSelect;
export type InsertFunctionalTestSession = z.infer<typeof insertFunctionalTestSessionSchema>;
export type FunctionalTestSession = typeof functionalTestSessions.$inferSelect;
export type InsertWorkflow = z.infer<typeof insertWorkflowSchema>;
export type Workflow = typeof workflows.$inferSelect;
export type InsertTestCase = z.infer<typeof insertTestCaseSchema>;
export type TestCase = typeof testCases.$inferSelect;
export type InsertExecutionResult = z.infer<typeof insertExecutionResultSchema>;
export type ExecutionResult = typeof executionResults.$inferSelect;

export type InsertRequirement = z.infer<typeof insertRequirementSchema>;
export type Requirement = typeof requirements.$inferSelect;

export const requirements = mysqlTable("requirements", {
  id: varchar("id", { length: 255 }).primaryKey().default(sql`(UUID())`),
  projectId: varchar("project_id", { length: 255 }).notNull().references(() => projects.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const sprints = mysqlTable("sprints", {
  id: varchar("id", { length: 255 }).primaryKey().default(sql`(UUID())`),
  projectId: varchar("project_id", { length: 255 }).notNull().references(() => projects.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
  goal: text("goal"),
  startDate: timestamp("start_date"),
  endDate: timestamp("end_date"),
  status: text("status").default("planning"),
  adoSyncEnabled: int("ado_sync_enabled").default(0),
  adoBacklogSource: text("ado_backlog_source").default("sprint_backlog"),
  adoIterationPath: text("ado_iteration_path"),
  adoAreaPath: text("ado_area_path"),
  adoWiqlQuery: text("ado_wiql_query"),
  adoWorkItemTypes: json("ado_work_item_types").$type<string[]>().default(["User Story"]),
  adoSyncFrequency: text("ado_sync_frequency").default("manual"),
  adoLastSyncAt: timestamp("ado_last_sync_at"),
  adoSyncStatus: text("ado_sync_status").default("not_synced"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertSprintSchema = createInsertSchema(sprints).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertSprint = z.infer<typeof insertSprintSchema>;
export type Sprint = typeof sprints.$inferSelect;

export const userStories = mysqlTable("user_stories", {
  id: varchar("id", { length: 255 }).primaryKey().default(sql`(UUID())`),
  requirementId: varchar("requirement_id", { length: 255 }).notNull().references(() => requirements.id, { onDelete: "cascade" }),
  adoWorkItemId: int("ado_work_item_id").unique(),
  title: text("title").notNull(),
  description: text("description"),
  acceptanceCriteria: text("acceptance_criteria"),
  state: text("state"),
  assignedTo: text("assigned_to"),
  sprint: text("sprint"),
  areaPath: text("area_path"),
  tags: json("tags").$type<string[]>().default([]),
  adoUrl: text("ado_url"),
  syncedAt: timestamp("synced_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Sprint User Stories - simplified user stories for Sprint Agent (no requirement dependency)
export const sprintUserStories = mysqlTable("sprint_user_stories", {
  id: varchar("id", { length: 255 }).primaryKey().default(sql`(UUID())`),
  sprintId: varchar("sprint_id", { length: 255 }).notNull().references(() => sprints.id, { onDelete: "cascade" }),
  adoWorkItemId: int("ado_work_item_id"),
  title: text("title").notNull(),
  description: text("description"),
  acceptanceCriteria: text("acceptance_criteria"),
  storyPoints: int("story_points"),
  priority: text("priority").default("medium"),
  status: text("status").default("new"),
  source: text("source").default("manual"),
  assignedTo: text("assigned_to"),
  tags: json("tags").$type<string[]>().default([]),
  adoUrl: text("ado_url"),
  adoSyncStatus: text("ado_sync_status").default("not_synced"),
  adoLastSyncAt: timestamp("ado_last_sync_at"),
  attachments: json("attachments").$type<{id: string; name: string; url: string}[]>().default([]),
  additionalContext: text("additional_context"),
  contextDocuments: json("context_documents").$type<{id: string; name: string; content: string}[]>().default([]),
  contextUrls: json("context_urls").$type<{url: string; title?: string; content?: string}[]>().default([]),
  generatedTestCases: json("generated_test_cases"),
  testCaseCount: int("test_case_count").default(0),
  generatedAt: timestamp("generated_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertSprintUserStorySchema = createInsertSchema(sprintUserStories).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertSprintUserStory = z.infer<typeof insertSprintUserStorySchema>;
export type SprintUserStory = typeof sprintUserStories.$inferSelect;

export const sprintTestCases = mysqlTable("sprint_test_cases", {
  id: varchar("id", { length: 255 }).primaryKey().default(sql`(UUID())`),
  sprintId: varchar("sprint_id", { length: 255 }).references(() => sprints.id, { onDelete: "cascade" }),
  sprintUserStoryId: varchar("sprint_user_story_id", { length: 255 }).references(() => sprintUserStories.id, { onDelete: "cascade" }),
  userStoryId: varchar("user_story_id", { length: 255 }).references(() => userStories.id, { onDelete: "cascade" }),
  testCaseId: text("test_case_id").notNull(),
  title: text("title").notNull(),
  description: text("description"),
  objective: text("objective"),
  preconditions: json("preconditions").$type<string[]>().default([]),
  testSteps: json("test_steps").$type<TestStep[]>().notNull(),
  expectedResult: text("expected_result"),
  postconditions: json("postconditions").$type<string[]>().default([]),
  testData: json("test_data").$type<Record<string, any>>(),
  testType: text("test_type").default("functional"),
  category: text("category").notNull().default("functional"),
  priority: text("priority").default("P2"),
  status: text("status").default("draft"),
  editStatus: text("edit_status").default("original"),
  isEdited: int("is_edited").default(0),
  linkedAcceptanceCriteria: json("linked_acceptance_criteria").$type<number[]>().default([]),
  tags: json("tags").$type<string[]>().default([]),
  notes: text("notes"),
  originalVersion: json("original_version").$type<Record<string, any>>(),
  changeHistory: json("change_history").$type<{timestamp: string; field: string; oldValue: any; newValue: any}[]>().default([]),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertRequirementSchema = createInsertSchema(requirements).omit({
  id: true,
  createdAt: true,
});

export const insertUserStorySchema = createInsertSchema(userStories).omit({
  id: true,
  syncedAt: true,
  createdAt: true,
  adoWorkItemId: true,
});

export const insertSprintTestCaseSchema = createInsertSchema(sprintTestCases).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertUserStory = z.infer<typeof insertUserStorySchema>;
export type UserStory = typeof userStories.$inferSelect;
export type InsertSprintTestCase = z.infer<typeof insertSprintTestCaseSchema>;
export type SprintTestCase = typeof sprintTestCases.$inferSelect;

export const adoConfigurations = mysqlTable("ado_configurations", {
  id: varchar("id", { length: 255 }).primaryKey().default(sql`(UUID())`),
  organization: text("organization").notNull(),
  project: text("project").notNull(),
  pat: text("pat").notNull(),
  isActive: int("is_active").default(1),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertAdoConfigurationSchema = createInsertSchema(adoConfigurations).omit({
  id: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertAdoConfiguration = z.infer<typeof insertAdoConfigurationSchema>;
export type AdoConfiguration = typeof adoConfigurations.$inferSelect;

// Functional Test Runs - stores history of functional test executions
export const functionalTestRuns = mysqlTable("functional_test_runs", {
  id: varchar("id", { length: 255 }).primaryKey().default(sql`(UUID())`),
  projectId: varchar("project_id", { length: 255 }).references(() => projects.id, { onDelete: "set null" }),
  websiteUrl: text("website_url").notNull(),
  testFocus: text("test_focus").notNull().default("all"),
  domain: text("domain").default("general"),
  productContext: text("product_context"),
  sampleMode: text("sample_mode").default("comprehensive"),
  status: text("status").notNull().default("running"),
  totalTestCases: int("total_test_cases").default(0),
  workflowCases: int("workflow_cases").default(0),
  functionalCases: int("functional_cases").default(0),
  negativeCases: int("negative_cases").default(0),
  edgeCases: int("edge_cases").default(0),
  textValidationCases: int("text_validation_cases").default(0),
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Functional Test Run Cases - stores individual test cases from a run
export const functionalTestRunCases = mysqlTable("functional_test_run_cases", {
  id: varchar("id", { length: 255 }).primaryKey().default(sql`(UUID())`),
  runId: varchar("run_id", { length: 255 }).notNull().references(() => functionalTestRuns.id, { onDelete: "cascade" }),
  testId: text("test_id").notNull(),
  category: text("category").notNull(),
  name: text("name").notNull(),
  objective: text("objective"),
  preconditions: json("preconditions").$type<string[]>().default([]),
  testSteps: json("test_steps").$type<TestStep[]>().notNull(),
  expectedResult: text("expected_result").notNull(),
  testData: json("test_data").$type<Record<string, any>>(),
  priority: text("priority").default("P2"),
  status: text("status").default("generated"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertFunctionalTestRunSchema = createInsertSchema(functionalTestRuns).omit({
  id: true,
  status: true,
  totalTestCases: true,
  workflowCases: true,
  functionalCases: true,
  negativeCases: true,
  edgeCases: true,
  textValidationCases: true,
  completedAt: true,
  createdAt: true,
});

export const insertFunctionalTestRunCaseSchema = createInsertSchema(functionalTestRunCases).omit({
  id: true,
  status: true,
  createdAt: true,
});

export type InsertFunctionalTestRun = z.infer<typeof insertFunctionalTestRunSchema>;
export type FunctionalTestRun = typeof functionalTestRuns.$inferSelect;
export type InsertFunctionalTestRunCase = z.infer<typeof insertFunctionalTestRunCaseSchema>;
export type FunctionalTestRunCase = typeof functionalTestRunCases.$inferSelect;

// Type for test run with cases
export interface FunctionalTestRunWithCases extends FunctionalTestRun {
  testCases: FunctionalTestRunCase[];
}

// Integration configurations for test management platforms
export const integrationConfigs = mysqlTable("integration_configs", {
  id: varchar("id", { length: 255 }).primaryKey().default(sql`(UUID())`),
  userId: varchar("user_id", { length: 255 }).notNull().references(() => users.id, { onDelete: "cascade" }),
  platform: text("platform").notNull(), // azure_devops, jira, zephyr, testrail, qtest, qmetry
  name: text("name").notNull(), // Display name
  config: json("config").$type<Record<string, any>>().notNull(), // Platform-specific configuration
  status: text("status").notNull().default("not_configured"), // not_configured, connected, error
  lastSyncedAt: timestamp("last_synced_at"),
  lastError: text("last_error"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertIntegrationConfigSchema = createInsertSchema(integrationConfigs).omit({
  id: true,
  status: true,
  lastSyncedAt: true,
  lastError: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertIntegrationConfig = z.infer<typeof insertIntegrationConfigSchema>;
export type IntegrationConfig = typeof integrationConfigs.$inferSelect;

// Integration platform types
export type IntegrationPlatform = 
  | "azure_devops" 
  | "jira" 
  | "zephyr" 
  | "testrail" 
  | "qtest" 
  | "qmetry";

export type IntegrationStatus = "not_configured" | "connected" | "error";

// Platform-specific configuration interfaces
export interface AzureDevOpsConfig {
  organizationUrl: string;
  personalAccessToken: string;
  defaultProject?: string;
  apiVersion: string;
  syncOptions: {
    autoSyncUserStories: boolean;
    syncWorkItemComments: boolean;
    createWorkItemsForFailedTests: boolean;
    linkTestCasesToWorkItems: boolean;
  };
  syncFrequency: string;
}

export interface JiraConfig {
  instanceUrl: string;
  authType: "api_token" | "pat" | "oauth";
  email?: string;
  apiToken: string;
  defaultProjectKey?: string;
  issueTypesToSync: string[];
  customJqlFilter?: string;
  syncOptions: {
    autoSyncOnUpdate: boolean;
    createJiraIssuesForFailedTests: boolean;
    addTestExecutionLinks: boolean;
    syncAttachments: boolean;
  };
}

export interface ZephyrConfig {
  product: "scale_cloud" | "scale_server" | "squad";
  jiraInstanceUrl: string;
  apiAccessToken: string;
  accountId?: string;
  defaultProject?: string;
  testCycleSettings: {
    autoCreateCycles: boolean;
    cycleNamingPattern: string;
    defaultCycleFolder?: string;
  };
  syncOptions: {
    pushTestCases: boolean;
    syncExecutionResults: boolean;
    createTestCyclesAuto: boolean;
    mapPriorities: boolean;
  };
}

export interface TestRailConfig {
  instanceUrl: string;
  username: string;
  apiKey: string;
  defaultProject?: string;
  defaultTestSuite?: string;
  testRunSettings: {
    autoCreateRuns: boolean;
    runNamingPattern: string;
    assignToUser?: string;
    includeAllCases: boolean;
  };
  syncOptions: {
    pushTestCases: boolean;
    syncExecutionResults: boolean;
    includeScreenshots: boolean;
    includeStepResults: boolean;
    createDefectsForFailures: boolean;
  };
}

export interface QTestConfig {
  managerUrl: string;
  authMethod: "api_token" | "username_password" | "oauth";
  apiToken?: string;
  username?: string;
  password?: string;
  defaultProject?: string;
  moduleFolder?: string;
  testRunSettings: {
    targetTestCycle?: string;
    autoCreateSuites: boolean;
    suiteNamingPattern: string;
  };
  automationSettings: {
    linkToAutomationHost: boolean;
    automationHostId?: string;
    agentName?: string;
  };
  syncOptions: {
    pushTestCases: boolean;
    syncExecutionLogs: boolean;
    includeAutomationResults: boolean;
    uploadAttachments: boolean;
    createDefectsForFailures: boolean;
  };
}

export interface QMetryConfig {
  instanceType: "jira_cloud" | "jira_server" | "standalone";
  baseUrl: string;
  apiKey: string;
  jiraInstanceUrl?: string;
  jiraApiToken?: string;
  projectKey?: string;
  defaultProject?: string;
  testCycleConfig: {
    folderPath: string;
    cycleNamingConvention: string;
    platform?: string;
    buildVersion?: string;
  };
  automationSettings: {
    enableAutomationSync: boolean;
    automationFramework: string;
    entityType: string;
  };
  syncOptions: {
    syncTestCases: boolean;
    pushExecutionResults: boolean;
    includeStepResults: boolean;
    attachEvidence: boolean;
    createDefectsForFailures: boolean;
    linkRequirements: boolean;
  };
}

// ==========================================
// Test Execution Mode - Execution Runs
// ==========================================

export interface ExecutionStepResult {
  stepNumber: number;
  action: string;
  selector?: string;
  expected: string;
  actual: string;
  status: "passed" | "failed" | "skipped" | "running";
  duration: number;
  screenshotPath?: string;
  errorMessage?: string;
  timestamp: string;
}

export interface ExecutionAgentLog {
  agentName: string;
  action: string;
  message: string;
  status: "thinking" | "working" | "completed" | "error";
  timestamp: string;
}

// Main execution run session
export const executionRuns = mysqlTable("execution_runs", {
  id: varchar("id", { length: 255 }).primaryKey().default(sql`(UUID())`),
  projectId: varchar("project_id", { length: 255 }).references(() => projects.id, { onDelete: "cascade" }),
  runName: text("run_name").notNull(),
  browser: text("browser").notNull().default("chromium"), // chromium, firefox, webkit
  executionMode: text("execution_mode").notNull().default("headless"), // headed, headless
  status: text("status").notNull().default("pending"), // pending, running, completed, failed, cancelled
  totalTests: int("total_tests").notNull().default(0),
  passedTests: int("passed_tests").default(0),
  failedTests: int("failed_tests").default(0),
  skippedTests: int("skipped_tests").default(0),
  duration: int("duration").default(0), // in milliseconds
  videoPath: text("video_path"),
  agentLogs: json("agent_logs").$type<ExecutionAgentLog[]>().default([]),
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Individual test case execution within a run
export const executionRunTests = mysqlTable("execution_run_tests", {
  id: varchar("id", { length: 255 }).primaryKey().default(sql`(UUID())`),
  runId: varchar("run_id", { length: 255 }).notNull().references(() => executionRuns.id, { onDelete: "cascade" }),
  testCaseId: varchar("test_case_id", { length: 255 }).notNull(), // Can reference either testCases or sprintTestCases
  testCaseSource: text("test_case_source").notNull().default("functional"), // functional, sprint
  testName: text("test_name").notNull(),
  category: text("category").notNull().default("functional"),
  status: text("status").notNull().default("pending"), // pending, running, passed, failed, skipped
  duration: int("duration").default(0),
  stepResults: json("step_results").$type<ExecutionStepResult[]>().default([]),
  finalScreenshotPath: text("final_screenshot_path"),
  errorMessage: text("error_message"),
  consoleErrors: json("console_errors").$type<string[]>().default([]),
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// BDD Feature Files
export const bddFeatureFiles = mysqlTable("bdd_feature_files", {
  id: varchar("id", { length: 255 }).primaryKey().default(sql`(UUID())`),
  projectId: varchar("project_id", { length: 255 }).notNull().references(() => projects.id, { onDelete: "cascade" }),
  testCaseId: varchar("test_case_id", { length: 255 }), // Optional - can be for whole project or specific test
  testCaseSource: text("test_case_source").default("functional"), // functional, sprint
  featureName: text("feature_name").notNull(),
  fileName: text("file_name").notNull(),
  content: text("content").notNull(), // Gherkin feature file content
  language: text("language").notNull().default("gherkin"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// BDD Step Definition Files
export const bddStepDefinitions = mysqlTable("bdd_step_definitions", {
  id: varchar("id", { length: 255 }).primaryKey().default(sql`(UUID())`),
  projectId: varchar("project_id", { length: 255 }).notNull().references(() => projects.id, { onDelete: "cascade" }),
  featureFileId: varchar("feature_file_id", { length: 255 }).references(() => bddFeatureFiles.id, { onDelete: "cascade" }),
  stepDefName: text("step_def_name").notNull(),
  fileName: text("file_name").notNull(),
  content: text("content").notNull(), // Playwright/TypeScript step definition code
  language: text("language").notNull().default("typescript"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Insert schemas
export const insertExecutionRunSchema = createInsertSchema(executionRuns).omit({
  id: true,
  passedTests: true,
  failedTests: true,
  skippedTests: true,
  duration: true,
  videoPath: true,
  agentLogs: true,
  startedAt: true,
  completedAt: true,
  createdAt: true,
});

export const insertExecutionRunTestSchema = createInsertSchema(executionRunTests).omit({
  id: true,
  status: true,
  duration: true,
  stepResults: true,
  finalScreenshotPath: true,
  errorMessage: true,
  consoleErrors: true,
  startedAt: true,
  completedAt: true,
  createdAt: true,
});

export const insertBddFeatureFileSchema = createInsertSchema(bddFeatureFiles).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertBddStepDefinitionSchema = createInsertSchema(bddStepDefinitions).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

// Types
export type InsertExecutionRun = z.infer<typeof insertExecutionRunSchema>;
export type ExecutionRun = typeof executionRuns.$inferSelect;
export type InsertExecutionRunTest = z.infer<typeof insertExecutionRunTestSchema>;
export type ExecutionRunTest = typeof executionRunTests.$inferSelect;
export type InsertBddFeatureFile = z.infer<typeof insertBddFeatureFileSchema>;
export type BddFeatureFile = typeof bddFeatureFiles.$inferSelect;
export type InsertBddStepDefinition = z.infer<typeof insertBddStepDefinitionSchema>;
export type BddStepDefinition = typeof bddStepDefinitions.$inferSelect;

// Execution run with tests
export interface ExecutionRunWithTests extends ExecutionRun {
  tests: ExecutionRunTest[];
}

// Execution status type
export type ExecutionStatus = "pending" | "running" | "completed" | "failed" | "cancelled";
export type TestExecutionStatus = "pending" | "running" | "passed" | "failed" | "skipped";
export type StepExecutionStatus = "passed" | "failed" | "skipped" | "running";

// ============================================
// Synthetic Data Generation Tables
// ============================================

// Synthetic Data Generation Jobs
export const syntheticDataJobs = mysqlTable("synthetic_data_jobs", {
  id: varchar("id", { length: 255 }).primaryKey().default(sql`(UUID())`),
  userId: varchar("user_id", { length: 255 }).notNull().references(() => users.id, { onDelete: "cascade" }),
  projectId: varchar("project_id", { length: 255 }).references(() => projects.id, { onDelete: "set null" }),
  domain: text("domain").notNull(), // banking, insurance, healthcare, retail, telecom, manufacturing
  subDomain: text("sub_domain").notNull(), // e.g., core_banking, auto_insurance, patients
  recordCount: int("record_count").notNull().default(100),
  dataPrefix: text("data_prefix"),
  maskingEnabled: int("masking_enabled").notNull().default(0),
  selectedFields: json("selected_fields").$type<string[]>().default([]),
  generatedData: json("generated_data").$type<Record<string, any>[]>(),
  metadata: json("metadata").$type<SyntheticDataMetadata>(),
  status: text("status").notNull().default("pending"), // pending, generating, completed, failed
  createdAt: timestamp("created_at").defaultNow().notNull(),
  completedAt: timestamp("completed_at"),
});

export interface SyntheticDataMetadata {
  policyType?: string;
  recordCount: number;
  fieldCount: number;
  generatedAt: string;
  prefix?: string;
  source: string;
  processingTime?: number;
  qualityScore?: number;
}

export const insertSyntheticDataJobSchema = createInsertSchema(syntheticDataJobs).omit({
  id: true,
  generatedData: true,
  metadata: true,
  status: true,
  createdAt: true,
  completedAt: true,
});

export type InsertSyntheticDataJob = z.infer<typeof insertSyntheticDataJobSchema>;
export type SyntheticDataJob = typeof syntheticDataJobs.$inferSelect;

// Domain and field definitions (used in frontend)
export interface DomainDefinition {
  id: string;
  name: string;
  icon: string;
  description: string;
  subDomains: SubDomainDefinition[];
}

export interface SubDomainDefinition {
  id: string;
  name: string;
  icon: string;
  fields: string[];
  fieldCount: number;
}

export interface GeneratedDataResult {
  records: Record<string, any>[];
  fields: string[];
  metadata: SyntheticDataMetadata;
}

// ============================================
// nRadiVerse Quality Engine - Visual Regression
// ============================================

export const visualRegressionBaselines = mysqlTable("visual_regression_baselines", {
  id: varchar("id", { length: 255 }).primaryKey().default(sql`(UUID())`),
  projectId: varchar("project_id", { length: 255 }).references(() => projects.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  url: text("url").notNull(),
  viewport: text("viewport").notNull().default("desktop"),
  viewportWidth: int("viewport_width").default(1920),
  viewportHeight: int("viewport_height").default(1080),
  baselineImageUrl: text("baseline_image_url"),
  baselineImageData: text("baseline_image_data"),
  metadata: json("metadata").$type<{
    version?: string;
    environment?: string;
    browser?: string;
    capturedAt?: string;
  }>(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const visualRegressionResults = mysqlTable("visual_regression_results", {
  id: varchar("id", { length: 255 }).primaryKey().default(sql`(UUID())`),
  baselineId: varchar("baseline_id", { length: 255 }).references(() => visualRegressionBaselines.id, { onDelete: "cascade" }),
  projectId: varchar("project_id", { length: 255 }).references(() => projects.id, { onDelete: "cascade" }),
  status: text("status").notNull().default("pending"),
  diffPercentage: int("diff_percentage"),
  ssimScore: int("ssim_score"),
  psnrScore: int("psnr_score"),
  mseScore: int("mse_score"),
  pixelsDifferent: int("pixels_different"),
  totalPixels: int("total_pixels"),
  currentImageData: text("current_image_data"),
  diffImageData: text("diff_image_data"),
  differences: json("differences").$type<VisualDifferenceDetail[]>(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export interface VisualDifferenceDetail {
  region: string;
  x: number;
  y: number;
  width: number;
  height: number;
  severity: "critical" | "major" | "minor" | "cosmetic";
  description?: string;
}

// ============================================
// nRadiVerse Quality Engine - Accessibility
// ============================================

export const accessibilityScanResults = mysqlTable("accessibility_scan_results", {
  id: varchar("id", { length: 255 }).primaryKey().default(sql`(UUID())`),
  projectId: varchar("project_id", { length: 255 }).references(() => projects.id, { onDelete: "cascade" }),
  url: text("url").notNull(),
  status: text("status").notNull().default("pending"),
  overallScore: int("overall_score"),
  violationsCount: int("violations_count").default(0),
  passesCount: int("passes_count").default(0),
  incompleteCount: int("incomplete_count").default(0),
  inapplicableCount: int("inapplicable_count").default(0),
  criticalCount: int("critical_count").default(0),
  seriousCount: int("serious_count").default(0),
  moderateCount: int("moderate_count").default(0),
  minorCount: int("minor_count").default(0),
  violations: json("violations").$type<AccessibilityViolation[]>(),
  passes: json("passes").$type<AccessibilityRule[]>(),
  incomplete: json("incomplete").$type<AccessibilityRule[]>(),
  wcagCriteria: json("wcag_criteria").$type<WCAGCriterion[]>(),
  metadata: json("metadata").$type<{
    browser?: string;
    viewport?: string;
    scanDuration?: number;
    axeVersion?: string;
  }>(),
  screenReaderResult: json("screen_reader_result"),
  visualTestResult: json("visual_test_result"),
  aiAnalysis: json("ai_analysis"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export interface AccessibilityViolation {
  id: string;
  impact: "critical" | "serious" | "moderate" | "minor";
  description: string;
  help: string;
  helpUrl: string;
  tags: string[];
  nodes: {
    html: string;
    target: string[];
    failureSummary: string;
  }[];
}

export interface AccessibilityRule {
  id: string;
  description: string;
  help: string;
  helpUrl: string;
  tags: string[];
  nodes: number;
}

export interface WCAGCriterion {
  id: string;
  level: "A" | "AA" | "AAA";
  principle: "perceivable" | "operable" | "understandable" | "robust";
  status: "pass" | "fail" | "incomplete";
  violations?: number;
}

// ============================================
// nRadiVerse Quality Engine - Screen Reader Simulation
// ============================================

export interface ScreenReaderSimulationResult {
  transcript: ScreenReaderTranscript;
  headingHierarchy: HeadingHierarchyResult;
  landmarks: LandmarkResult;
  linksAnalysis: LinksAnalysisResult;
  focusOrder: FocusOrderResult;
  ariaValidation: ARIAValidationResult;
  readingOrder: ReadingOrderResult;
  overallScore: number;
  issueCount: number;
  duration: number;
}

export interface ScreenReaderTranscript {
  entries: TranscriptEntry[];
  totalElements: number;
  duration: number;
}

export interface TranscriptEntry {
  index: number;
  announcement: string;
  role: string;
  name: string;
  landmark?: string;
  depth: number;
  issues?: string[];
}

export interface HeadingHierarchyResult {
  headings: { level: number; text: string; index: number }[];
  issues: { type: string; message: string }[];
  pass: boolean;
}

export interface LandmarkResult {
  found: { role: string; name?: string; count: number }[];
  missing: string[];
  duplicates: string[];
  pass: boolean;
}

export interface LinksAnalysisResult {
  links: { text: string; href: string; issues: string[] }[];
  totalLinks: number;
  problematicLinks: number;
  pass: boolean;
}

export interface FocusOrderResult {
  sequence: { index: number; tag: string; role: string; name: string; x: number; y: number }[];
  issues: { type: string; message: string; element: string }[];
  pass: boolean;
}

export interface ARIAValidationResult {
  elements: { selector: string; role?: string; ariaAttrs: Record<string, string>; issues: string[] }[];
  totalARIAElements: number;
  issueCount: number;
  pass: boolean;
}

export interface ReadingOrderResult {
  outOfOrderElements: { element: string; domIndex: number; visualPosition: { x: number; y: number } }[];
  pass: boolean;
}

// ============================================
// nRadiVerse Quality Engine - Visual Accessibility Tests
// ============================================

export interface VisualTestResult {
  testId: string;
  testName: string;
  wcagCriterion: string;
  status: "pass" | "fail" | "warning";
  score: number;
  issues: { element: string; description: string; severity: "critical" | "serious" | "moderate" | "minor" }[];
  screenshotBase64?: string;
  duration: number;
}

export interface VisualAccessibilityResult {
  tests: VisualTestResult[];
  overallScore: number;
  passCount: number;
  failCount: number;
  warningCount: number;
  totalDuration: number;
}

export interface EnhancedAccessibilityScanResult {
  axeResult: any; // existing AccessibilityScanResult
  screenReaderResult?: ScreenReaderSimulationResult;
  visualTestResult?: VisualAccessibilityResult;
  combinedScore: number;
  scanDuration: number;
}

// ============================================
// nRadiVerse Quality Engine - Responsive Testing
// ============================================

export const responsiveTestResults = mysqlTable("responsive_test_results", {
  id: varchar("id", { length: 255 }).primaryKey().default(sql`(UUID())`),
  projectId: varchar("project_id", { length: 255 }).references(() => projects.id, { onDelete: "cascade" }),
  url: text("url").notNull(),
  status: text("status").notNull().default("pending"),
  overallScore: int("overall_score"),
  devicesTestedCount: int("devices_tested_count").default(0),
  passedDevicesCount: int("passed_devices_count").default(0),
  failedDevicesCount: int("failed_devices_count").default(0),
  deviceResults: json("device_results").$type<DeviceTestResult[]>(),
  layoutIssues: json("layout_issues").$type<LayoutIssue[]>(),
  touchTargetIssues: json("touch_target_issues").$type<TouchTargetIssue[]>(),
  performanceMetrics: json("performance_metrics").$type<ResponsivePerformanceMetrics>(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export interface DeviceTestResult {
  deviceName: string;
  deviceType: "mobile" | "tablet" | "desktop";
  viewport: { width: number; height: number };
  orientation: "portrait" | "landscape";
  browser: string;
  status: "pass" | "fail" | "warning";
  score: number;
  screenshotData?: string;
  issues: string[];
}

export interface LayoutIssue {
  element: string;
  issue: string;
  device: string;
  severity: "critical" | "major" | "minor";
  suggestion?: string;
}

export interface TouchTargetIssue {
  element: string;
  currentSize: { width: number; height: number };
  minimumSize: { width: number; height: number };
  device: string;
}

export interface ResponsivePerformanceMetrics {
  mobile?: {
    fcp?: number;
    lcp?: number;
    tti?: number;
    cls?: number;
  };
  tablet?: {
    fcp?: number;
    lcp?: number;
    tti?: number;
    cls?: number;
  };
  desktop?: {
    fcp?: number;
    lcp?: number;
    tti?: number;
    cls?: number;
  };
}

// Insert schemas for nRadiVerse tables
export const insertVisualRegressionBaselineSchema = createInsertSchema(visualRegressionBaselines).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertVisualRegressionResultSchema = createInsertSchema(visualRegressionResults).omit({
  id: true,
  createdAt: true,
});

export const insertAccessibilityScanResultSchema = createInsertSchema(accessibilityScanResults).omit({
  id: true,
  createdAt: true,
});

export const insertResponsiveTestResultSchema = createInsertSchema(responsiveTestResults).omit({
  id: true,
  createdAt: true,
});

export type InsertVisualRegressionBaseline = z.infer<typeof insertVisualRegressionBaselineSchema>;
export type VisualRegressionBaseline = typeof visualRegressionBaselines.$inferSelect;
export type InsertVisualRegressionResult = z.infer<typeof insertVisualRegressionResultSchema>;
export type VisualRegressionResult = typeof visualRegressionResults.$inferSelect;
export type InsertAccessibilityScanResult = z.infer<typeof insertAccessibilityScanResultSchema>;
export type AccessibilityScanResult = typeof accessibilityScanResults.$inferSelect;
export type InsertResponsiveTestResult = z.infer<typeof insertResponsiveTestResultSchema>;
export type ResponsiveTestResult = typeof responsiveTestResults.$inferSelect;

// SSRS to PowerBI Report Validation Tables
export const reportValidations = mysqlTable("report_validations", {
  id: varchar("id", { length: 255 }).primaryKey().default(sql`(UUID())`),
  userId: varchar("user_id", { length: 255 }).notNull(),
  sourceFilename: text("source_filename").notNull(),
  targetFilename: text("target_filename").notNull(),
  sourceFileType: text("source_file_type").notNull(), // 'excel' | 'pdf'
  targetFileType: text("target_file_type").notNull(),
  status: text("status").notNull().default("pending"), // pending, processing, completed, failed
  result: text("result"), // pass, fail, warning
  matchPercentage: int("match_percentage"),
  config: json("config").$type<ValidationConfig>(),
  summary: json("summary").$type<ValidationSummary>(),
  aiAnalysis: text("ai_analysis"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  completedAt: timestamp("completed_at"),
});

export const validationResults = mysqlTable("validation_results", {
  id: varchar("id", { length: 255 }).primaryKey().default(sql`(UUID())`),
  validationId: varchar("validation_id", { length: 255 }).notNull().references(() => reportValidations.id, { onDelete: "cascade" }),
  rowNumber: int("row_number"),
  columnName: text("column_name"),
  sheetName: text("sheet_name"),
  sourceValue: text("source_value"),
  targetValue: text("target_value"),
  difference: text("difference"),
  percentDiff: text("percent_diff"),
  matchStatus: text("match_status").notNull(), // exact, tolerance, mismatch
  aiAnalysis: text("ai_analysis"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export interface ValidationConfig {
  comparisonMode: 'strict' | 'tolerant' | 'smart';
  numericTolerance: number;
  percentageTolerance: number;
  dateHandling: 'strict' | 'flexible';
  ignoreColumns: string[];
  caseSensitive: boolean;
  whitespaceHandling: 'strict' | 'trim' | 'normalize';
}

export interface ValidationSummary {
  totalCells: number;
  matchedCells: number;
  toleranceCells: number;
  mismatchedCells: number;
  sourceRowCount: number;
  targetRowCount: number;
  sourceColumnCount: number;
  targetColumnCount: number;
  criticalIssues: number;
  warnings: number;
}

export const insertReportValidationSchema = createInsertSchema(reportValidations).omit({
  id: true,
  createdAt: true,
  completedAt: true,
});

export const insertValidationResultSchema = createInsertSchema(validationResults).omit({
  id: true,
  createdAt: true,
});

export type InsertReportValidation = z.infer<typeof insertReportValidationSchema>;
export type ReportValidation = typeof reportValidations.$inferSelect;
export type InsertValidationResult = z.infer<typeof insertValidationResultSchema>;
export type ValidationResult = typeof validationResults.$inferSelect;

// API Baseline (Regression Testing) Tables
export const apiBaselines = mysqlTable("api_baselines", {
  id: varchar("id", { length: 255 }).primaryKey().default(sql`(UUID())`),
  name: text("name").notNull(),
  description: text("description"),
  method: text("method").notNull(),
  endpoint: text("endpoint").notNull(),
  requestHeaders: json("request_headers").$type<Record<string, string>>(),
  requestBody: text("request_body"),
  baselineResponse: json("baseline_response").$type<any>(),
  baselineStatusCode: int("baseline_status_code"),
  baselineHeaders: json("baseline_headers").$type<Record<string, string>>(),
  responseSchema: json("response_schema").$type<ApiFieldSchema[]>(),
  lastExecutedAt: timestamp("last_executed_at"),
  lastExecutionStatus: text("last_execution_status"), // pass, fail, warning
  executionCount: int("execution_count").default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const apiBaselineExecutions = mysqlTable("api_baseline_executions", {
  id: varchar("id", { length: 255 }).primaryKey().default(sql`(UUID())`),
  baselineId: varchar("baseline_id", { length: 255 }).notNull().references(() => apiBaselines.id, { onDelete: "cascade" }),
  status: text("status").notNull(), // pass, fail, warning
  statusCode: int("status_code"),
  responseTime: int("response_time"),
  actualResponse: json("actual_response").$type<any>(),
  differences: json("differences").$type<ApiDifference[]>(),
  summary: json("summary").$type<ApiComparisonSummary>(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export interface ApiFieldSchema {
  path: string;
  type: string;
  required: boolean;
  sampleValue?: any;
  children?: ApiFieldSchema[];
}

export interface ApiDifference {
  path: string;
  type: 'missing' | 'added' | 'type_changed' | 'value_changed';
  expectedValue?: any;
  actualValue?: any;
  expectedType?: string;
  actualType?: string;
  severity: 'critical' | 'warning' | 'info';
}

export interface ApiComparisonSummary {
  totalFields: number;
  matchedFields: number;
  missingFields: number;
  addedFields: number;
  typeChanges: number;
  valueChanges: number;
  overallStatus: 'pass' | 'fail' | 'warning';
}

export const jiraTestCases = mysqlTable("jira_test_cases", {
  id: varchar("id", { length: 255 }).primaryKey().default(sql`(UUID())`),
  jiraProjectKey: text("jira_project_key").notNull(),
  jiraBoardId: int("jira_board_id"),
  jiraSprintId: int("jira_sprint_id"),
  jiraStoryId: text("jira_story_id").notNull(),
  jiraStoryTitle: text("jira_story_title").notNull(),
  testCaseId: text("test_case_id").notNull(),
  title: text("title").notNull(),
  description: text("description"),
  objective: text("objective"),
  preconditions: json("preconditions").$type<string[]>().default([]),
  testSteps: json("test_steps").$type<TestStep[]>().notNull(),
  expectedResult: text("expected_result"),
  postconditions: json("postconditions").$type<string[]>().default([]),
  testData: json("test_data").$type<Record<string, any>>(),
  testType: text("test_type").default("functional"),
  category: text("category").notNull().default("functional"),
  priority: text("priority").default("P2"),
  playwrightScript: text("playwright_script"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertJiraTestCaseSchema = createInsertSchema(jiraTestCases).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertJiraTestCase = z.infer<typeof insertJiraTestCaseSchema>;
export type JiraTestCase = typeof jiraTestCases.$inferSelect;

export const insertApiBaselineSchema = createInsertSchema(apiBaselines).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  lastExecutedAt: true,
  executionCount: true,
});

export const insertApiBaselineExecutionSchema = createInsertSchema(apiBaselineExecutions).omit({
  id: true,
  createdAt: true,
});

export type InsertApiBaseline = z.infer<typeof insertApiBaselineSchema>;
export type ApiBaseline = typeof apiBaselines.$inferSelect;
export type InsertApiBaselineExecution = z.infer<typeof insertApiBaselineExecutionSchema>;
export type ApiBaselineExecution = typeof apiBaselineExecutions.$inferSelect;

// ==========================================
// Auth Config interface (no password stored)
// ==========================================
export interface AuthConfig {
  requiresAuth: boolean;
  loginUrl?: string;
  username?: string;
  authType: 'form' | 'basic' | 'custom';
  usernameSelector?: string;
  passwordSelector?: string;
  loginButtonSelector?: string;
}

// ==========================================
// Extend CrawlProgress with login status
// ==========================================
// NOTE: The existing CrawlProgress interface at line ~152 needs 'logging_in' added to status union
// and loginSuccess field. We handle this by extending separately in the crawler.

// ==========================================
// Extend functionalTestRuns with wizard fields
// ==========================================
// Add columns to functionalTestRuns table:
export const functionalTestRunsWizardExtension = {
  wizardStep: 1,
  testingMode: 'ui',
  designPattern: 'POM',
  mermaidDiagram: null as string | null,
} as const;

// ==========================================
// Automation Scripts Table
// ==========================================
export const automationScripts = mysqlTable("automation_scripts", {
  id: varchar("id", { length: 255 }).primaryKey().default(sql`(UUID())`),
  runId: varchar("run_id", { length: 255 }).references(() => functionalTestRuns.id, { onDelete: "cascade" }),
  projectId: varchar("project_id", { length: 255 }).references(() => projects.id, { onDelete: "set null" }),
  scriptType: text("script_type").notNull(), // "pom_class" | "bdd_feature" | "bdd_step_defs" | "playwright_config" | "cucumber_config"
  pattern: text("pattern").notNull(), // "POM" | "BDD" | "both"
  fileName: text("file_name").notNull(),
  filePath: text("file_path").notNull(),
  content: text("content").notNull(),
  pageUrl: text("page_url"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertAutomationScriptSchema = createInsertSchema(automationScripts).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertAutomationScript = z.infer<typeof insertAutomationScriptSchema>;
export type AutomationScript = typeof automationScripts.$inferSelect;

// ==========================================
// API Discovery Runs Table
// ==========================================
export interface ApiEndpoint {
  method: string;
  path: string;
  summary?: string;
  parameters?: any[];
  requestBody?: any;
  responses?: any;
  tags?: string[];
}

export const apiDiscoveryRuns = mysqlTable("api_discovery_runs", {
  id: varchar("id", { length: 255 }).primaryKey().default(sql`(UUID())`),
  runId: varchar("run_id", { length: 255 }).references(() => functionalTestRuns.id, { onDelete: "set null" }),
  projectId: varchar("project_id", { length: 255 }).references(() => projects.id, { onDelete: "set null" }),
  discoveryType: text("discovery_type").notNull(), // "har_capture" | "swagger_import"
  sourceUrl: text("source_url"),
  specContent: json("spec_content").$type<Record<string, any>>(),
  endpoints: json("endpoints").$type<ApiEndpoint[]>().default([]),
  status: text("status").notNull().default("pending"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertApiDiscoveryRunSchema = createInsertSchema(apiDiscoveryRuns).omit({
  id: true,
  createdAt: true,
});

export type InsertApiDiscoveryRun = z.infer<typeof insertApiDiscoveryRunSchema>;
export type ApiDiscoveryRun = typeof apiDiscoveryRuns.$inferSelect;

// ==========================================
// HAR Captures Table
// ==========================================
export const harCaptures = mysqlTable("har_captures", {
  id: varchar("id", { length: 255 }).primaryKey().default(sql`(UUID())`),
  discoveryRunId: varchar("discovery_run_id", { length: 255 }).references(() => apiDiscoveryRuns.id, { onDelete: "cascade" }),
  url: text("url").notNull(),
  method: text("method").notNull(),
  requestHeaders: json("request_headers").$type<Record<string, string>>(),
  requestBody: text("request_body"),
  statusCode: int("status_code"),
  responseHeaders: json("response_headers").$type<Record<string, string>>(),
  responseBody: text("response_body"),
  duration: int("duration"),
  capturedAt: timestamp("captured_at").defaultNow().notNull(),
});

export const insertHarCaptureSchema = createInsertSchema(harCaptures).omit({
  id: true,
  capturedAt: true,
});

export type InsertHarCapture = z.infer<typeof insertHarCaptureSchema>;
export type HarCapture = typeof harCaptures.$inferSelect;

// ==========================================
// Agent event types for SSE streaming
// ==========================================
export type AgentName =
  | 'scout_agent'
  | 'auth_agent'
  | 'workflow_analyst'
  | 'diagram_architect'
  | 'test_strategist'
  | 'test_writer'
  | 'script_engineer'
  | 'executor_agent'
  | 'qa_analyst';

export type AgentStatus = 'idle' | 'thinking' | 'working' | 'completed' | 'error';

export interface AgentEvent {
  type: 'agent';
  agent: AgentName;
  status: AgentStatus;
  activity: string;
  progress?: number;
  detail?: any;
}

export interface WizardSSEEvent {
  type: 'agent' | 'screenshot' | 'crawl_progress' | 'page_discovered' | 'workflow_found' | 'test_case' | 'script' | 'test_result' | 'complete' | 'error';
  [key: string]: any;
}

// ==================== Framework Configuration ====================
export const frameworkConfigs = mysqlTable("framework_configs", {
  id: varchar("id", { length: 255 }).primaryKey(),
  projectId: varchar("project_id", { length: 255 }),
  name: text("name").notNull(),
  framework: text("framework").notNull(),
  language: text("language").notNull(),
  description: text("description"),
  isGlobal: boolean("is_global").default(false),
  baseClass: text("base_class"),
  sampleScript: text("sample_script"),
  detectedPattern: text("detected_pattern"),
  detectedLanguage: text("detected_language"),
  detectedTool: text("detected_tool"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const frameworkFunctions = mysqlTable("framework_functions", {
  id: varchar("id", { length: 255 }).primaryKey(),
  configId: varchar("config_id", { length: 255 }).notNull(),
  name: text("name").notNull(),
  signature: text("signature").notNull(),
  description: text("description"),
  category: text("category").notNull(),
  returnType: text("return_type").default("void"),
  parameters: json("parameters").$type<Array<{name: string, type: string}>>().default([]),
  sourceFile: text("source_file"),
  className: text("class_name"),      // e.g. "LoginPage" — POM class the method belongs to
  importPath: text("import_path"),    // e.g. "com.company.pages.LoginPage" or "./pages/LoginPage"
  isCustom: boolean("is_custom").default(false),
  createdAt: timestamp("created_at").defaultNow(),
});

export const frameworkFiles = mysqlTable("framework_files", {
  id: varchar("id", { length: 255 }).primaryKey(),
  configId: varchar("config_id", { length: 255 }).notNull(),
  filename: text("filename").notNull(),
  fileHash: text("file_hash"),        // SHA-256 of content — used for de-duplication
  content: text("content").notNull(),
  fileType: text("file_type").notNull(),
  parsedAt: timestamp("parsed_at").defaultNow(),
});

export type FrameworkConfig = typeof frameworkConfigs.$inferSelect;
export type InsertFrameworkConfig = typeof frameworkConfigs.$inferInsert;
export type FrameworkFunction = typeof frameworkFunctions.$inferSelect;
export type InsertFrameworkFunction = typeof frameworkFunctions.$inferInsert;
export type FrameworkFile = typeof frameworkFiles.$inferSelect;
export type InsertFrameworkFile = typeof frameworkFiles.$inferInsert;
