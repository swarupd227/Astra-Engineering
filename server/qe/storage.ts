import { type User, type InsertUser, type TestSession, type InsertTestSession, type TestSessionWithResults, type AgentTask, type LiveMetric, type TestResults, type UserStory, type SprintTestCase, type AdoConfiguration, type InsertAdoConfiguration, type Project, type InsertProject, type Requirement, type InsertRequirement, type InsertUserStory, type FunctionalTestRun, type InsertFunctionalTestRun, type FunctionalTestRunCase, type InsertFunctionalTestRunCase, type FunctionalTestRunWithCases, type Sprint, type InsertSprint, type SprintUserStory, type InsertSprintUserStory, type IntegrationConfig, type InsertIntegrationConfig, type IntegrationPlatform, type ExecutionRun, type InsertExecutionRun, type ExecutionRunTest, type InsertExecutionRunTest, type ExecutionRunWithTests, type ExecutionAgentLog, type ExecutionStepResult, type BddFeatureFile, type InsertBddFeatureFile, type BddStepDefinition, type InsertBddStepDefinition, type JiraTestCase, type AutomationScript, type InsertAutomationScript, type ApiDiscoveryRun, type InsertApiDiscoveryRun, type HarCapture, type InsertHarCapture } from "@shared/qe-schema";
import { randomUUID } from "crypto";
import { db } from "./db";
import { testSessions, testResults, visualDiffs, users, userStories, sprintTestCases, adoConfigurations, projects, functionalTestSessions, requirements, functionalTestRuns, functionalTestRunCases, sprints, sprintUserStories, integrationConfigs, executionRuns, executionRunTests, bddFeatureFiles, bddStepDefinitions, jiraTestCases, automationScripts, apiDiscoveryRuns, harCaptures } from "@shared/qe-schema";
import { eq, desc, and, inArray } from "drizzle-orm";
import type { UserStoryData } from "./ado-pull-service";
import type { GeneratedTestCase } from "./claude-test-generator";
import { encryptPAT, decryptPAT } from "./crypto-utils";
export type { UserStoryData } from "./ado-pull-service";
export type { GeneratedTestCase } from "./claude-test-generator";

export interface IStorage {
  getUser(id: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  
  createProject(project: InsertProject): Promise<Project>;
  getProjectsByUserId(userId: string): Promise<Project[]>;
  getProjectById(id: string): Promise<Project | undefined>;
  updateProject(id: string, updates: Partial<InsertProject>): Promise<Project | undefined>;
  deleteProject(id: string): Promise<void>;
  
  createTestSession(session: InsertTestSession): Promise<TestSession>;
  getTestSession(id: string): Promise<TestSessionWithResults | undefined>;
  getAllTestSessions(): Promise<TestSession[]>;
  getTestSessionsByProjectId(projectId: string): Promise<TestSession[]>;
  updateTestSessionStatus(id: string, status: string): Promise<void>;
  updateTestSessionTasks(id: string, tasks: AgentTask[]): Promise<void>;
  updateTestSessionMetrics(id: string, metrics: LiveMetric[]): Promise<void>;
  completeTestSession(id: string, results: TestResults): Promise<void>;
  
  syncUserStories(userStories: UserStoryData[]): Promise<void>;
  getUserStoriesBySprint(sprint: string): Promise<UserStory[]>;
  getUserStoryById(id: string): Promise<UserStory | undefined>;
  saveSprintTestCases(userStoryId: string, testCases: GeneratedTestCase[]): Promise<void>;
  getSprintTestCasesByUserStory(userStoryId: string): Promise<SprintTestCase[]>;
  updateSprintTestCase(id: string, updates: Partial<SprintTestCase>): Promise<SprintTestCase | undefined>;
  
  saveAdoConfiguration(config: InsertAdoConfiguration): Promise<AdoConfiguration>;
  getActiveAdoConfiguration(): Promise<AdoConfiguration | undefined>;
  getAllAdoConfigurations(): Promise<AdoConfiguration[]>;
  updateAdoConfiguration(id: string, updates: Partial<InsertAdoConfiguration>): Promise<AdoConfiguration | undefined>;
  deleteAdoConfiguration(id: string): Promise<void>;
  getDecryptedPATForService(): Promise<{ organization: string; project: string; pat: string } | undefined>;
  
  getActiveJiraConfiguration(): Promise<{ domain: string; email: string; apiToken: string } | undefined>;
  
  saveFunctionalTestSession(sessionData: any): Promise<any>;
  getFunctionalTestSessionsByProjectId(projectId: string): Promise<any[]>;
  
  createRequirement(req: InsertRequirement): Promise<Requirement>;
  getRequirementsByProjectId(projectId: string): Promise<Requirement[]>;
  getRequirementById(id: string): Promise<Requirement | undefined>;

  createUserStory(story: InsertUserStory): Promise<UserStory>;
  getUserStoriesByRequirementId(requirementId: string): Promise<UserStory[]>;

  createSprint(sprint: InsertSprint): Promise<Sprint>;
  getSprintsByProjectId(projectId: string): Promise<Sprint[]>;
  getSprintById(id: string): Promise<Sprint | undefined>;
  updateSprint(id: string, updates: Partial<Sprint>): Promise<Sprint | undefined>;
  deleteSprint(id: string): Promise<void>;
  
  // Sprint test cases (by sprint)
  saveTestCasesToSprint(sprintId: string, testCases: any[]): Promise<void>;
  getTestCasesBySprintId(sprintId: string): Promise<SprintTestCase[]>;
  deleteTestCaseFromSprint(testCaseId: string): Promise<void>;
  
  // Sprint User Stories
  createSprintUserStory(story: InsertSprintUserStory): Promise<SprintUserStory>;
  getSprintUserStoriesBySprintId(sprintId: string): Promise<SprintUserStory[]>;
  getSprintUserStoryById(id: string): Promise<SprintUserStory | undefined>;
  updateSprintUserStory(id: string, updates: Partial<SprintUserStory>): Promise<SprintUserStory | undefined>;
  deleteSprintUserStory(id: string): Promise<void>;
  
  // Test cases by user story
  saveTestCasesToUserStory(sprintUserStoryId: string, sprintId: string, testCases: any[]): Promise<void>;
  getTestCasesByUserStoryId(sprintUserStoryId: string): Promise<SprintTestCase[]>;
  
  // Functional Test Run History
  createFunctionalTestRun(run: InsertFunctionalTestRun): Promise<FunctionalTestRun>;
  getFunctionalTestRuns(projectId?: string, limit?: number): Promise<FunctionalTestRun[]>;
  getFunctionalTestRunById(id: string): Promise<FunctionalTestRunWithCases | undefined>;
  addTestCasesToRun(runId: string, testCases: InsertFunctionalTestRunCase[]): Promise<void>;
  updateFunctionalTestRun(id: string, updates: Partial<FunctionalTestRun>): Promise<void>;
  completeFunctionalTestRun(id: string, counts: { total: number; workflow: number; functional: number; negative: number; edge: number; textValidation: number }): Promise<void>;
  
  // Integration Configurations
  createIntegrationConfig(config: InsertIntegrationConfig): Promise<IntegrationConfig>;
  getIntegrationConfigsByUserId(userId: string): Promise<IntegrationConfig[]>;
  getIntegrationConfigByPlatform(userId: string, platform: IntegrationPlatform): Promise<IntegrationConfig | undefined>;
  getIntegrationConfigById(id: string): Promise<IntegrationConfig | undefined>;
  updateIntegrationConfig(id: string, updates: Partial<InsertIntegrationConfig & { status?: string; lastSyncedAt?: Date; lastError?: string }>): Promise<IntegrationConfig | undefined>;
  deleteIntegrationConfig(id: string): Promise<void>;
  
  // Execution Runs
  createExecutionRun(run: InsertExecutionRun): Promise<ExecutionRun>;
  getExecutionRunsByProjectId(projectId: string): Promise<ExecutionRun[]>;
  getExecutionRunById(id: string): Promise<ExecutionRunWithTests | undefined>;
  updateExecutionRun(id: string, updates: Partial<ExecutionRun>): Promise<ExecutionRun | undefined>;
  addTestToExecutionRun(runId: string, test: InsertExecutionRunTest): Promise<ExecutionRunTest>;
  updateExecutionRunTest(id: string, updates: Partial<ExecutionRunTest>): Promise<ExecutionRunTest | undefined>;
  getExecutionRunTestById(id: string): Promise<ExecutionRunTest | undefined>;
  
  // BDD Feature Files
  createBddFeatureFile(file: InsertBddFeatureFile): Promise<BddFeatureFile>;
  getBddFeatureFilesByProjectId(projectId: string): Promise<BddFeatureFile[]>;
  getBddFeatureFileById(id: string): Promise<BddFeatureFile | undefined>;
  getBddFeatureFileByTestCaseId(testCaseId: string): Promise<BddFeatureFile | undefined>;
  updateBddFeatureFile(id: string, updates: Partial<InsertBddFeatureFile>): Promise<BddFeatureFile | undefined>;
  deleteBddFeatureFile(id: string): Promise<void>;
  
  // BDD Step Definitions
  createBddStepDefinition(stepDef: InsertBddStepDefinition): Promise<BddStepDefinition>;
  getBddStepDefinitionsByProjectId(projectId: string): Promise<BddStepDefinition[]>;
  getBddStepDefinitionsByFeatureFileId(featureFileId: string): Promise<BddStepDefinition[]>;
  getBddStepDefinitionById(id: string): Promise<BddStepDefinition | undefined>;
  updateBddStepDefinition(id: string, updates: Partial<InsertBddStepDefinition>): Promise<BddStepDefinition | undefined>;
  deleteBddStepDefinition(id: string): Promise<void>;
  
  // Test Cases by IDs
  getTestCasesByIds(testCaseIds: string[]): Promise<SprintTestCase[]>;
  getFunctionalTestCasesByIds(testCaseIds: string[]): Promise<FunctionalTestRunCase[]>;
  
  // Jira Test Cases
  saveJiraTestCases(jiraProjectKey: string, jiraStoryId: string, jiraStoryTitle: string, testCases: any[], jiraBoardId?: number | null, jiraSprintId?: number | null): Promise<void>;
  getJiraTestCases(jiraProjectKey: string, jiraStoryId: string): Promise<any[]>;
  getJiraTestCasesByIds(testCaseIds: string[]): Promise<any[]>;
  getAllJiraTestCasesByProject(jiraProjectKey: string): Promise<any[]>;
  getJiraProjectsWithTestCases(): Promise<Array<{ projectKey: string; storyCount: number; testCaseCount: number }>>;
  getJiraStoriesWithTestCases(jiraProjectKey: string): Promise<Array<{ storyId: string; storyTitle: string; testCaseCount: number }>>;

  // Automation Scripts
  createAutomationScript(script: InsertAutomationScript): Promise<AutomationScript>;
  getAutomationScriptsByRunId(runId: string): Promise<AutomationScript[]>;
  getAutomationScriptById(id: string): Promise<AutomationScript | undefined>;
  updateAutomationScript(id: string, updates: Partial<AutomationScript>): Promise<AutomationScript | undefined>;
  deleteAutomationScript(id: string): Promise<void>;

  // API Discovery
  createApiDiscoveryRun(run: InsertApiDiscoveryRun): Promise<ApiDiscoveryRun>;
  getApiDiscoveryRunById(id: string): Promise<ApiDiscoveryRun | undefined>;
  updateApiDiscoveryRun(id: string, updates: Partial<ApiDiscoveryRun>): Promise<ApiDiscoveryRun | undefined>;

  // HAR Captures
  createHarCapture(capture: InsertHarCapture): Promise<HarCapture>;
  getHarCapturesByDiscoveryRunId(discoveryRunId: string): Promise<HarCapture[]>;

  // Functional Test Run wizard extensions
  updateFunctionalTestRunWizardData(id: string, updates: { mermaidDiagram?: string; wizardStep?: number; testingMode?: string; designPattern?: string; totalPages?: number; status?: string }): Promise<void>;
}

export class MemStorage implements IStorage {
  private users: Map<string, User>;
  private testSessions: Map<string, TestSession>;
  private adoConfigurations: Map<string, AdoConfiguration>;
  private functionalSessions: Map<string, any>;
  private requirements: Map<string, Requirement>;
  private _functionalTestRuns: Map<string, FunctionalTestRun>;
  private _functionalTestRunCases: Map<string, FunctionalTestRunCase[]>;
  private _automationScripts: Map<string, AutomationScript>;

  constructor() {
    this.users = new Map();
    this.testSessions = new Map();
    this.adoConfigurations = new Map();
    this.functionalSessions = new Map();
    this.requirements = new Map();
    this._functionalTestRuns = new Map();
    this._functionalTestRunCases = new Map();
    this._automationScripts = new Map();
  }

  async getUser(id: string): Promise<User | undefined> {
    return this.users.get(id);
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    return Array.from(this.users.values()).find(
      (user) => user.username === username,
    );
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const id = randomUUID();
    const user: User = { ...insertUser, id };
    this.users.set(id, user);
    return user;
  }

  async createProject(project: InsertProject): Promise<Project> {
    throw new Error("Project management not supported in MemStorage");
  }

  async getProjectsByUserId(userId: string): Promise<Project[]> {
    return [];
  }

  async getProjectById(id: string): Promise<Project | undefined> {
    return undefined;
  }

  async updateProject(id: string, updates: Partial<InsertProject>): Promise<Project | undefined> {
    return undefined;
  }

  async deleteProject(id: string): Promise<void> {
    // Stub implementation
  }

  async createTestSession(insertSession: InsertTestSession): Promise<TestSession> {
    const id = randomUUID();
    const session: TestSession = {
      ...insertSession,
      id,
      status: "running",
      createdAt: new Date(),
      completedAt: null,
      projectId: null,
      tasks: null,
      metrics: null,
    };
    this.testSessions.set(id, session);
    return session;
  }

  async getTestSession(id: string): Promise<TestSessionWithResults | undefined> {
    const session = this.testSessions.get(id);
    if (!session) return undefined;
    return session as TestSessionWithResults;
  }

  async updateTestSessionStatus(id: string, status: string): Promise<void> {
    const session = this.testSessions.get(id);
    if (session) {
      session.status = status;
      this.testSessions.set(id, session);
    }
  }

  async getAllTestSessions(): Promise<TestSession[]> {
    return Array.from(this.testSessions.values());
  }

  async getTestSessionsByProjectId(projectId: string): Promise<TestSession[]> {
    return [];
  }

  async updateTestSessionTasks(id: string, tasks: AgentTask[]): Promise<void> {
    const session = this.testSessions.get(id);
    if (session) {
      session.tasks = tasks;
      this.testSessions.set(id, session);
    }
  }

  async updateTestSessionMetrics(id: string, metrics: LiveMetric[]): Promise<void> {
    const session = this.testSessions.get(id);
    if (session) {
      session.metrics = metrics;
      this.testSessions.set(id, session);
    }
  }

  async completeTestSession(id: string, results: TestResults): Promise<void> {
    const session = this.testSessions.get(id);
    if (session) {
      session.status = "completed";
      session.completedAt = new Date();
      this.testSessions.set(id, session);
    }
  }

  async syncUserStories(userStories: UserStoryData[]): Promise<void> {
    // Stub implementation for in-memory storage
  }

  async getUserStoriesBySprint(sprint: string): Promise<UserStory[]> {
    // Stub implementation for in-memory storage
    return [];
  }

  async getUserStoryById(id: string): Promise<UserStory | undefined> {
    // Stub implementation for in-memory storage
    return undefined;
  }

  async saveSprintTestCases(userStoryId: string, testCases: GeneratedTestCase[]): Promise<void> {
    // Stub implementation for in-memory storage
  }

  async getSprintTestCasesByUserStory(userStoryId: string): Promise<SprintTestCase[]> {
    // Stub implementation for in-memory storage
    return [];
  }

  async updateSprintTestCase(id: string, updates: Partial<SprintTestCase>): Promise<SprintTestCase | undefined> {
    // Stub implementation for in-memory storage
    return undefined;
  }

  async saveAdoConfiguration(config: InsertAdoConfiguration): Promise<AdoConfiguration> {
    const id = randomUUID();
    const encryptedConfig: AdoConfiguration = {
      id,
      organization: config.organization,
      project: config.project,
      pat: encryptPAT(config.pat),
      createdAt: new Date(),
      updatedAt: new Date(),
      isActive: 1,
    };
    this.adoConfigurations.set(id, encryptedConfig);
    return {
      ...encryptedConfig,
      pat: config.pat,
    };
  }

  async getActiveAdoConfiguration(): Promise<AdoConfiguration | undefined> {
    const configs = Array.from(this.adoConfigurations.values());
    const activeConfig = configs.find(c => c.isActive);
    if (!activeConfig) return undefined;
    
    return {
      ...activeConfig,
      pat: decryptPAT(activeConfig.pat),
    };
  }

  async getAllAdoConfigurations(): Promise<AdoConfiguration[]> {
    return Array.from(this.adoConfigurations.values()).map(config => ({
      ...config,
      pat: decryptPAT(config.pat),
    }));
  }

  async updateAdoConfiguration(id: string, updates: Partial<InsertAdoConfiguration>): Promise<AdoConfiguration | undefined> {
    const existing = this.adoConfigurations.get(id);
    if (!existing) return undefined;
    
    const updated: AdoConfiguration = {
      ...existing,
      ...updates,
      pat: updates.pat ? encryptPAT(updates.pat) : existing.pat,
    };
    
    this.adoConfigurations.set(id, updated);
    return {
      ...updated,
      pat: decryptPAT(updated.pat),
    };
  }

  async deleteAdoConfiguration(id: string): Promise<void> {
    this.adoConfigurations.delete(id);
  }

  async getDecryptedPATForService(): Promise<{ organization: string; project: string; pat: string } | undefined> {
    const activeConfig = await this.getActiveAdoConfiguration();
    if (!activeConfig) return undefined;
    return {
      organization: activeConfig.organization,
      project: activeConfig.project,
      pat: activeConfig.pat,
    };
  }

  async getActiveJiraConfiguration(): Promise<{ domain: string; email: string; apiToken: string } | undefined> {
    const configs = Array.from(this.integrationConfigs.values());
    const jiraConfig = configs.find(c => c.platform === 'jira' && c.status === 'connected');
    if (!jiraConfig || !jiraConfig.config) return undefined;
    
    const config = jiraConfig.config as any;
    if (!config.jiraInstanceUrl || !config.username || !config.apiAccessToken) return undefined;
    
    const domain = config.jiraInstanceUrl.replace(/^https?:\/\//, '').replace(/\/$/, '');
    return {
      domain,
      email: config.username,
      apiToken: config.apiAccessToken,
    };
  }

  async saveFunctionalTestSession(sessionData: any): Promise<any> {
    const id = randomUUID();
    const session = {
      id,
      ...sessionData,
      createdAt: new Date(),
    };
    this.functionalSessions.set(id, session);
    return session;
  }

  async getFunctionalTestSessionsByProjectId(projectId: string): Promise<any[]> {
    return Array.from(this.functionalSessions.values())
      .filter(s => s.projectId === projectId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  async createRequirement(req: InsertRequirement): Promise<Requirement> {
    const id = randomUUID();
    const requirement: Requirement = {
      id,
      ...req,
      createdAt: new Date(),
    };
    this.requirements.set(id, requirement);
    return requirement;
  }

  async getRequirementsByProjectId(projectId: string): Promise<Requirement[]> {
    return Array.from(this.requirements.values())
      .filter(r => r.projectId === projectId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  async getRequirementById(id: string): Promise<Requirement | undefined> {
    return this.requirements.get(id);
  }

  async createUserStory(story: InsertUserStory): Promise<UserStory> {
    const id = randomUUID();
    const userStory: UserStory = {
      id,
      ...story,
      createdAt: new Date(),
    } as UserStory;
    return userStory;
  }

  async getUserStoriesByRequirementId(requirementId: string): Promise<UserStory[]> {
    return [];
  }

  async createSprint(sprint: InsertSprint): Promise<Sprint> {
    throw new Error("Sprint storage not supported in MemStorage");
  }

  async getSprintsByProjectId(projectId: string): Promise<Sprint[]> {
    return [];
  }

  async getSprintById(id: string): Promise<Sprint | undefined> {
    return undefined;
  }

  async updateSprint(id: string, updates: Partial<Sprint>): Promise<Sprint | undefined> {
    console.log("[MemStorage] updateSprint not implemented");
    return undefined;
  }

  async deleteSprint(id: string): Promise<void> {
    // Stub
  }

  async saveTestCasesToSprint(sprintId: string, testCases: any[]): Promise<void> {
    // Stub - MemStorage doesn't persist
  }

  async getTestCasesBySprintId(sprintId: string): Promise<SprintTestCase[]> {
    return [];
  }

  async deleteTestCaseFromSprint(testCaseId: string): Promise<void> {
    // Stub
  }

  async createFunctionalTestRun(run: InsertFunctionalTestRun): Promise<FunctionalTestRun> {
    const id = randomUUID();
    const record: FunctionalTestRun = {
      id,
      projectId: run.projectId ?? null,
      websiteUrl: run.websiteUrl,
      testFocus: (run as any).testFocus ?? "all",
      domain: run.domain ?? "general",
      productContext: (run as any).productContext ?? null,
      sampleMode: (run as any).sampleMode ?? "comprehensive",
      status: "running",
      totalTestCases: 0,
      workflowCases: 0,
      functionalCases: 0,
      negativeCases: 0,
      edgeCases: 0,
      textValidationCases: 0,
      completedAt: null,
      createdAt: new Date(),
    };
    this._functionalTestRuns.set(id, record);
    return record;
  }

  async getFunctionalTestRuns(projectId?: string, limit?: number): Promise<FunctionalTestRun[]> {
    const all = Array.from(this._functionalTestRuns.values());
    const filtered = projectId ? all.filter(r => r.projectId === projectId) : all;
    return filtered.slice(0, limit ?? 50);
  }

  async getFunctionalTestRunById(id: string): Promise<FunctionalTestRunWithCases | undefined> {
    const run = this._functionalTestRuns.get(id);
    if (!run) return undefined;
    return { ...run, testCases: this._functionalTestRunCases.get(id) ?? [] };
  }

  async addTestCasesToRun(runId: string, testCases: InsertFunctionalTestRunCase[]): Promise<void> {
    const existing = this._functionalTestRunCases.get(runId) ?? [];
    const newCases: FunctionalTestRunCase[] = testCases.map(tc => ({
      id: randomUUID(),
      runId,
      testId: tc.testId,
      category: tc.category,
      name: tc.name,
      objective: tc.objective ?? null,
      preconditions: (tc as any).preconditions ?? [],
      testSteps: tc.testSteps,
      expectedResult: tc.expectedResult,
      testData: tc.testData ?? null,
      priority: tc.priority ?? "P2",
      status: "generated",
      createdAt: new Date(),
    }));
    this._functionalTestRunCases.set(runId, [...existing, ...newCases]);
  }

  async updateFunctionalTestRun(id: string, updates: Partial<FunctionalTestRun>): Promise<void> {
    const run = this._functionalTestRuns.get(id);
    if (run) this._functionalTestRuns.set(id, { ...run, ...updates });
  }

  async completeFunctionalTestRun(id: string, counts: { total: number; workflow: number; functional: number; negative: number; edge: number; textValidation: number }): Promise<void> {
    const run = this._functionalTestRuns.get(id);
    if (run) {
      this._functionalTestRuns.set(id, {
        ...run,
        status: "completed",
        totalTestCases: counts.total,
        workflowCases: counts.workflow,
        functionalCases: counts.functional,
        negativeCases: counts.negative,
        edgeCases: counts.edge,
        textValidationCases: counts.textValidation,
        completedAt: new Date(),
      });
    }
  }

  async createSprintUserStory(story: InsertSprintUserStory): Promise<SprintUserStory> {
    throw new Error("Sprint user story storage not supported in MemStorage");
  }

  async getSprintUserStoriesBySprintId(sprintId: string): Promise<SprintUserStory[]> {
    return [];
  }

  async getSprintUserStoryById(id: string): Promise<SprintUserStory | undefined> {
    return undefined;
  }

  async updateSprintUserStory(id: string, updates: Partial<SprintUserStory>): Promise<SprintUserStory | undefined> {
    console.log("[MemStorage] updateSprintUserStory not implemented");
    return undefined;
  }

  async deleteSprintUserStory(id: string): Promise<void> {
    // Stub
  }

  async saveTestCasesToUserStory(sprintUserStoryId: string, sprintId: string, testCases: any[]): Promise<void> {
    // Stub
  }

  async getTestCasesByUserStoryId(sprintUserStoryId: string): Promise<SprintTestCase[]> {
    return [];
  }

  // Integration Configurations - stubs
  async createIntegrationConfig(config: InsertIntegrationConfig): Promise<IntegrationConfig> {
    throw new Error("Integration config not supported in MemStorage");
  }
  async getIntegrationConfigsByUserId(userId: string): Promise<IntegrationConfig[]> { return []; }
  async getIntegrationConfigByPlatform(userId: string, platform: IntegrationPlatform): Promise<IntegrationConfig | undefined> { return undefined; }
  async getIntegrationConfigById(id: string): Promise<IntegrationConfig | undefined> { return undefined; }
  async updateIntegrationConfig(id: string, updates: any): Promise<IntegrationConfig | undefined> { return undefined; }
  async deleteIntegrationConfig(id: string): Promise<void> { }

  // Execution Runs - stubs
  async createExecutionRun(run: InsertExecutionRun): Promise<ExecutionRun> {
    throw new Error("Execution runs not supported in MemStorage");
  }
  async getExecutionRunsByProjectId(projectId: string): Promise<ExecutionRun[]> { return []; }
  async getExecutionRunById(id: string): Promise<ExecutionRunWithTests | undefined> { return undefined; }
  async updateExecutionRun(id: string, updates: Partial<ExecutionRun>): Promise<ExecutionRun | undefined> { return undefined; }
  async addTestToExecutionRun(runId: string, test: InsertExecutionRunTest): Promise<ExecutionRunTest> {
    throw new Error("Execution runs not supported in MemStorage");
  }
  async updateExecutionRunTest(id: string, updates: Partial<ExecutionRunTest>): Promise<ExecutionRunTest | undefined> { return undefined; }
  async getExecutionRunTestById(id: string): Promise<ExecutionRunTest | undefined> { return undefined; }

  // BDD Feature Files - stubs
  async createBddFeatureFile(file: InsertBddFeatureFile): Promise<BddFeatureFile> {
    throw new Error("BDD files not supported in MemStorage");
  }
  async getBddFeatureFilesByProjectId(projectId: string): Promise<BddFeatureFile[]> { return []; }
  async getBddFeatureFileById(id: string): Promise<BddFeatureFile | undefined> { return undefined; }
  async getBddFeatureFileByTestCaseId(testCaseId: string): Promise<BddFeatureFile | undefined> { return undefined; }
  async updateBddFeatureFile(id: string, updates: Partial<InsertBddFeatureFile>): Promise<BddFeatureFile | undefined> { return undefined; }
  async deleteBddFeatureFile(id: string): Promise<void> { }

  // BDD Step Definitions - stubs
  async createBddStepDefinition(stepDef: InsertBddStepDefinition): Promise<BddStepDefinition> {
    throw new Error("BDD step definitions not supported in MemStorage");
  }
  async getBddStepDefinitionsByProjectId(projectId: string): Promise<BddStepDefinition[]> { return []; }
  async getBddStepDefinitionsByFeatureFileId(featureFileId: string): Promise<BddStepDefinition[]> { return []; }
  async getBddStepDefinitionById(id: string): Promise<BddStepDefinition | undefined> { return undefined; }
  async updateBddStepDefinition(id: string, updates: Partial<InsertBddStepDefinition>): Promise<BddStepDefinition | undefined> { return undefined; }
  async deleteBddStepDefinition(id: string): Promise<void> { }
  
  async getTestCasesByIds(testCaseIds: string[]): Promise<SprintTestCase[]> {
    return [];
  }
  async getFunctionalTestCasesByIds(testCaseIds: string[]): Promise<FunctionalTestRunCase[]> {
    return [];
  }
  async saveJiraTestCases(): Promise<void> {}
  async getJiraTestCases(): Promise<any[]> { return []; }
  async getJiraTestCasesByIds(): Promise<any[]> { return []; }
  async getAllJiraTestCasesByProject(): Promise<any[]> { return []; }
  async getJiraProjectsWithTestCases(): Promise<Array<{ projectKey: string; storyCount: number; testCaseCount: number }>> { return []; }
  async getJiraStoriesWithTestCases(): Promise<Array<{ storyId: string; storyTitle: string; testCaseCount: number }>> { return []; }

  // Automation Scripts - in-memory
  async createAutomationScript(script: InsertAutomationScript): Promise<AutomationScript> {
    const id = randomUUID();
    const record: AutomationScript = {
      id,
      runId: script.runId ?? null,
      projectId: script.projectId ?? null,
      scriptType: script.scriptType,
      pattern: script.pattern ?? null,
      fileName: script.fileName,
      filePath: script.filePath ?? null,
      content: script.content,
      pageUrl: script.pageUrl ?? null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this._automationScripts.set(id, record);
    return record;
  }
  async getAutomationScriptsByRunId(runId: string): Promise<AutomationScript[]> {
    return Array.from(this._automationScripts.values()).filter(s => s.runId === runId);
  }
  async getAutomationScriptById(id: string): Promise<AutomationScript | undefined> {
    return this._automationScripts.get(id);
  }
  async updateAutomationScript(id: string, updates: Partial<AutomationScript>): Promise<AutomationScript | undefined> {
    const s = this._automationScripts.get(id);
    if (!s) return undefined;
    const updated = { ...s, ...updates, updatedAt: new Date() };
    this._automationScripts.set(id, updated);
    return updated;
  }
  async deleteAutomationScript(id: string): Promise<void> {
    this._automationScripts.delete(id);
  }

  // API Discovery - stubs
  async createApiDiscoveryRun(run: InsertApiDiscoveryRun): Promise<ApiDiscoveryRun> {
    throw new Error("API discovery runs not supported in MemStorage");
  }
  async getApiDiscoveryRunById(id: string): Promise<ApiDiscoveryRun | undefined> { return undefined; }
  async updateApiDiscoveryRun(id: string, updates: Partial<ApiDiscoveryRun>): Promise<ApiDiscoveryRun | undefined> { return undefined; }

  // HAR Captures - stubs
  async createHarCapture(capture: InsertHarCapture): Promise<HarCapture> {
    throw new Error("HAR captures not supported in MemStorage");
  }
  async getHarCapturesByDiscoveryRunId(discoveryRunId: string): Promise<HarCapture[]> { return []; }

  // Functional Test Run wizard extensions
  async updateFunctionalTestRunWizardData(id: string, updates: { mermaidDiagram?: string; wizardStep?: number; testingMode?: string; designPattern?: string; totalPages?: number; status?: string }): Promise<void> {
    const run = this._functionalTestRuns.get(id);
    if (run && updates.status) {
      this._functionalTestRuns.set(id, { ...run, status: updates.status });
    }
  }
}

export class PgStorage implements IStorage {
  async getUser(id: string): Promise<User | undefined> {
    const result = await db.select().from(users).where(eq(users.id, id)).limit(1);
    return result[0];
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const result = await db.select().from(users).where(eq(users.username, username)).limit(1);
    return result[0];
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const id = (insertUser as any).id ?? randomUUID();
    await db.insert(users).values({ ...insertUser, id });
    const [result] = await db.select().from(users).where(eq(users.id, id)).limit(1);
    return result;
  }

  async createProject(insertProject: InsertProject): Promise<Project> {
    const id = (insertProject as any).id ?? randomUUID();
    await db.insert(projects).values({ ...insertProject, id });
    const [result] = await db.select().from(projects).where(eq(projects.id, id)).limit(1);
    return result;
  }

  async getProjectsByUserId(userId: string): Promise<Project[]> {
    return await db.select().from(projects).where(eq(projects.userId, userId)).orderBy(desc(projects.createdAt));
  }

  async getProjectById(id: string): Promise<Project | undefined> {
    const result = await db.select().from(projects).where(eq(projects.id, id)).limit(1);
    return result[0];
  }

  async updateProject(id: string, updates: Partial<InsertProject>): Promise<Project | undefined> {
    await db.update(projects).set({ ...updates, updatedAt: new Date() }).where(eq(projects.id, id));
    const [result] = await db.select().from(projects).where(eq(projects.id, id)).limit(1);
    return result;
  }

  async deleteProject(id: string): Promise<void> {
    await db.delete(projects).where(eq(projects.id, id));
  }

  async createTestSession(insertSession: InsertTestSession): Promise<TestSession> {
    const id = (insertSession as any).id ?? randomUUID();
    await db.insert(testSessions).values({ ...insertSession, id });
    const [result] = await db.select().from(testSessions).where(eq(testSessions.id, id)).limit(1);
    return result;
  }

  async getTestSession(id: string): Promise<TestSessionWithResults | undefined> {
    const result = await db.select().from(testSessions).where(eq(testSessions.id, id)).limit(1);
    if (!result[0]) return undefined;

    const session: TestSessionWithResults = result[0];
    
    const results = await db.select().from(testResults).where(eq(testResults.sessionId, id)).limit(1);
    if (results[0]) {
      const diffs = await db.select().from(visualDiffs).where(eq(visualDiffs.resultId, results[0].id));
      
      session.testResults = {
        completionTime: results[0].completionTime,
        designCompliance: results[0].designCompliance,
        accessibilityWarnings: results[0].accessibilityWarnings,
        testCasesGenerated: results[0].testCasesGenerated,
        visualDifferences: diffs.map(d => ({
          area: d.area,
          count: d.count,
          severity: d.severity as "minor" | "major",
        })),
      };
    }
    
    return session;
  }

  async getAllTestSessions(): Promise<TestSession[]> {
    return await db.select().from(testSessions).orderBy(desc(testSessions.createdAt));
  }

  async getTestSessionsByProjectId(projectId: string): Promise<TestSession[]> {
    return await db.select().from(testSessions).where(eq(testSessions.projectId, projectId)).orderBy(desc(testSessions.createdAt));
  }

  async updateTestSessionStatus(id: string, status: string): Promise<void> {
    await db.update(testSessions).set({ status }).where(eq(testSessions.id, id));
  }

  async updateTestSessionTasks(id: string, tasks: AgentTask[]): Promise<void> {
    await db.update(testSessions).set({ tasks }).where(eq(testSessions.id, id));
  }

  async updateTestSessionMetrics(id: string, metrics: LiveMetric[]): Promise<void> {
    await db.update(testSessions).set({ metrics }).where(eq(testSessions.id, id));
  }

  async completeTestSession(id: string, results: TestResults): Promise<void> {
    await db.update(testSessions)
      .set({ 
        status: "completed",
        completedAt: new Date() 
      })
      .where(eq(testSessions.id, id));

    const testResultId = randomUUID();
    await db.insert(testResults).values({
      id: testResultId,
      sessionId: id,
      completionTime: results.completionTime,
      designCompliance: results.designCompliance,
      accessibilityWarnings: results.accessibilityWarnings,
      testCasesGenerated: results.testCasesGenerated,
    });
    const [testResult] = await db.select().from(testResults).where(eq(testResults.id, testResultId)).limit(1);

    if (results.visualDifferences && results.visualDifferences.length > 0) {
      await db.insert(visualDiffs).values(
        results.visualDifferences.map(diff => ({
          resultId: testResult.id,
          area: diff.area,
          count: diff.count,
          severity: diff.severity,
          screenshotUrl: null,
        }))
      );
    }
  }

  async syncUserStories(userStoriesData: UserStoryData[]): Promise<void> {
    for (const storyData of userStoriesData) {
      const existing = await db.select().from(userStories).where(eq(userStories.adoWorkItemId, storyData.adoWorkItemId)).limit(1);
      
      if (existing.length > 0) {
        await db.update(userStories)
          .set({
            title: storyData.title,
            description: storyData.description,
            acceptanceCriteria: storyData.acceptanceCriteria,
            state: storyData.state,
            assignedTo: storyData.assignedTo,
            sprint: storyData.sprint,
            areaPath: storyData.areaPath,
            tags: storyData.tags,
            adoUrl: storyData.adoUrl,
            syncedAt: new Date(),
          })
          .where(eq(userStories.adoWorkItemId, storyData.adoWorkItemId));
      } else {
        await db.insert(userStories).values(storyData);
      }
    }
  }

  async getUserStoriesBySprint(sprint: string): Promise<UserStory[]> {
    return await db.select().from(userStories).where(eq(userStories.sprint, sprint)).orderBy(desc(userStories.adoWorkItemId));
  }

  async getUserStoryById(id: string): Promise<UserStory | undefined> {
    const result = await db.select().from(userStories).where(eq(userStories.id, id)).limit(1);
    return result[0];
  }

  // For ADO flow - saves test cases linked to user_stories table
  async saveSprintTestCases(userStoryId: string, testCases: GeneratedTestCase[]): Promise<void> {
    for (const testCase of testCases) {
      await db.insert(sprintTestCases).values({
        userStoryId,
        testCaseId: testCase.testCaseId,
        title: testCase.title,
        objective: testCase.objective,
        preconditions: testCase.preconditions,
        testSteps: testCase.testSteps,
        expectedResult: testCase.expectedResult,
        testData: testCase.testData,
        testType: testCase.testType,
        category: testCase.category || testCase.testType,
        priority: testCase.priority,
        status: 'draft',
        isEdited: 0,
      });
    }
  }

  // For ADO flow - gets test cases by user_stories.id
  async getSprintTestCasesByUserStory(userStoryId: string): Promise<SprintTestCase[]> {
    return await db.select().from(sprintTestCases).where(eq(sprintTestCases.userStoryId, userStoryId)).orderBy(sprintTestCases.testCaseId);
  }

  async updateSprintTestCase(id: string, updates: Partial<SprintTestCase>): Promise<SprintTestCase | undefined> {
    await db.update(sprintTestCases)
      .set({
        ...updates,
        isEdited: 1,
        updatedAt: new Date(),
      })
      .where(eq(sprintTestCases.id, id));
    
    const [result] = await db.select().from(sprintTestCases).where(eq(sprintTestCases.id, id)).limit(1);
    return result;
  }

  async saveAdoConfiguration(config: InsertAdoConfiguration): Promise<AdoConfiguration> {
    await db.update(adoConfigurations).set({ isActive: 0 });
    
    const id = randomUUID();
    await db.insert(adoConfigurations).values({
      ...config,
      id,
      pat: encryptPAT(config.pat),
      isActive: 1,
    });
    
    const [result] = await db.select().from(adoConfigurations).where(eq(adoConfigurations.id, id)).limit(1);
    if (!result) throw new Error("Failed to save ADO configuration");
    
    return {
      ...result,
      pat: config.pat,
    };
  }

  async getActiveAdoConfiguration(): Promise<AdoConfiguration | undefined> {
    const result = await db.select().from(adoConfigurations).where(eq(adoConfigurations.isActive, 1)).limit(1);
    if (!result[0]) return undefined;
    
    return {
      ...result[0],
      pat: decryptPAT(result[0].pat),
    };
  }

  async getAllAdoConfigurations(): Promise<AdoConfiguration[]> {
    const configs = await db.select().from(adoConfigurations).orderBy(desc(adoConfigurations.createdAt));
    return configs.map(config => ({
      ...config,
      pat: decryptPAT(config.pat),
    }));
  }

  async updateAdoConfiguration(id: string, updates: Partial<InsertAdoConfiguration>): Promise<AdoConfiguration | undefined> {
    const updateData: any = {
      ...updates,
      updatedAt: new Date(),
    };
    
    if (updates.pat) {
      updateData.pat = encryptPAT(updates.pat);
    }
    
    await db.update(adoConfigurations)
      .set(updateData)
      .where(eq(adoConfigurations.id, id));
    
    const [result] = await db.select().from(adoConfigurations).where(eq(adoConfigurations.id, id)).limit(1);
    if (!result) return undefined;
    
    return {
      ...result,
      pat: decryptPAT(result.pat),
    };
  }

  async deleteAdoConfiguration(id: string): Promise<void> {
    await db.delete(adoConfigurations).where(eq(adoConfigurations.id, id));
  }

  async getDecryptedPATForService(): Promise<{ organization: string; project: string; pat: string } | undefined> {
    const activeConfig = await this.getActiveAdoConfiguration();
    if (!activeConfig) return undefined;
    return {
      organization: activeConfig.organization,
      project: activeConfig.project,
      pat: activeConfig.pat,
    };
  }

  async getActiveJiraConfiguration(): Promise<{ domain: string; email: string; apiToken: string } | undefined> {
    const configs = await db.select().from(integrationConfigs)
      .where(eq(integrationConfigs.platform, 'jira'))
      .limit(1);
    
    const jiraConfig = configs.find(c => c.status === 'connected');
    if (!jiraConfig || !jiraConfig.config) return undefined;
    
    const config = jiraConfig.config as any;
    if (!config.jiraInstanceUrl || !config.username || !config.apiAccessToken) return undefined;
    
    const domain = config.jiraInstanceUrl.replace(/^https?:\/\//, '').replace(/\/$/, '');
    return {
      domain,
      email: config.username,
      apiToken: config.apiAccessToken,
    };
  }

  async saveFunctionalTestSession(sessionData: any): Promise<any> {
    const id = randomUUID();
    await db.insert(functionalTestSessions).values({
      id,
      projectId: sessionData.projectId,
      url: sessionData.url,
      testFocus: sessionData.testFocus,
      crawlStatus: sessionData.crawlStatus || 'completed',
      pagesVisited: sessionData.pagesVisited || 0,
      workflowsDiscovered: sessionData.workflowsDiscovered || 0,
      testCasesGenerated: sessionData.testCasesGenerated || 0,
      testCasesPassed: sessionData.testCasesPassed || 0,
      testCasesFailed: sessionData.testCasesFailed || 0,
      crawlProgress: sessionData.crawlProgress,
      createdAt: new Date(),
    });
    const [result] = await db.select().from(functionalTestSessions).where(eq(functionalTestSessions.id, id)).limit(1);
    return result;
  }

  async getFunctionalTestSessionsByProjectId(projectId: string): Promise<any[]> {
    return await db.select().from(functionalTestSessions)
      .where(eq(functionalTestSessions.projectId, projectId))
      .orderBy(desc(functionalTestSessions.createdAt));
  }

  async createRequirement(req: InsertRequirement): Promise<Requirement> {
    const id = (req as any).id ?? randomUUID();
    await db.insert(requirements).values({ ...req, id });
    const [result] = await db.select().from(requirements).where(eq(requirements.id, id)).limit(1);
    return result;
  }

  async getRequirementsByProjectId(projectId: string): Promise<Requirement[]> {
    return await db.select().from(requirements)
      .where(eq(requirements.projectId, projectId))
      .orderBy(desc(requirements.createdAt));
  }

  async getRequirementById(id: string): Promise<Requirement | undefined> {
    const result = await db.select().from(requirements).where(eq(requirements.id, id)).limit(1);
    return result[0];
  }

  async createUserStory(story: InsertUserStory): Promise<UserStory> {
    const id = (story as any).id ?? randomUUID();
    await db.insert(userStories).values({ ...story, id });
    const [result] = await db.select().from(userStories).where(eq(userStories.id, id)).limit(1);
    return result;
  }

  async getUserStoriesByRequirementId(requirementId: string): Promise<UserStory[]> {
    return await db.select().from(userStories)
      .where(eq(userStories.requirementId, requirementId))
      .orderBy(desc(userStories.createdAt));
  }

  async createSprint(sprint: InsertSprint): Promise<Sprint> {
    const id = (sprint as any).id ?? randomUUID();
    await db.insert(sprints).values({ ...sprint, id });
    const [result] = await db.select().from(sprints).where(eq(sprints.id, id)).limit(1);
    return result;
  }

  async getSprintsByProjectId(projectId: string): Promise<Sprint[]> {
    return await db.select().from(sprints)
      .where(eq(sprints.projectId, projectId))
      .orderBy(desc(sprints.createdAt));
  }

  async getSprintById(id: string): Promise<Sprint | undefined> {
    const result = await db.select().from(sprints).where(eq(sprints.id, id)).limit(1);
    return result[0];
  }

  async updateSprint(id: string, updates: Partial<Sprint>): Promise<Sprint | undefined> {
    await db.update(sprints)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(sprints.id, id));
    const [result] = await db.select().from(sprints).where(eq(sprints.id, id)).limit(1);
    return result;
  }

  async deleteSprint(id: string): Promise<void> {
    await db.delete(sprints).where(eq(sprints.id, id));
  }

  async saveTestCasesToSprint(sprintId: string, testCases: any[]): Promise<void> {
    // First delete existing test cases for this sprint
    await db.delete(sprintTestCases).where(eq(sprintTestCases.sprintId, sprintId));
    
    // Insert new test cases
    if (testCases.length > 0) {
      const records = testCases.map(tc => ({
        sprintId,
        testCaseId: tc.testCaseId || tc.id,
        title: tc.title,
        category: tc.category,
        priority: tc.priority || "P2",
        testSteps: tc.steps || tc.testSteps || [],
        testType: tc.category || "functional",
      }));
      await db.insert(sprintTestCases).values(records);
    }
  }

  async getTestCasesBySprintId(sprintId: string): Promise<SprintTestCase[]> {
    return await db.select().from(sprintTestCases)
      .where(eq(sprintTestCases.sprintId, sprintId))
      .orderBy(sprintTestCases.createdAt);
  }

  async deleteTestCaseFromSprint(testCaseId: string): Promise<void> {
    await db.delete(sprintTestCases).where(eq(sprintTestCases.id, testCaseId));
  }

  async createFunctionalTestRun(run: InsertFunctionalTestRun): Promise<FunctionalTestRun> {
    const id = (run as any).id ?? randomUUID();
    await db.insert(functionalTestRuns).values({ ...run, id });
    const [result] = await db.select().from(functionalTestRuns).where(eq(functionalTestRuns.id, id)).limit(1);
    return result;
  }

  async getFunctionalTestRuns(projectId?: string, limit: number = 50): Promise<FunctionalTestRun[]> {
    if (projectId) {
      return await db.select().from(functionalTestRuns)
        .where(eq(functionalTestRuns.projectId, projectId))
        .orderBy(desc(functionalTestRuns.createdAt))
        .limit(limit);
    }
    return await db.select().from(functionalTestRuns)
      .orderBy(desc(functionalTestRuns.createdAt))
      .limit(limit);
  }

  async getFunctionalTestRunById(id: string): Promise<FunctionalTestRunWithCases | undefined> {
    const result = await db.select().from(functionalTestRuns).where(eq(functionalTestRuns.id, id)).limit(1);
    if (!result[0]) return undefined;
    
    const testCases = await db.select().from(functionalTestRunCases)
      .where(eq(functionalTestRunCases.runId, id))
      .orderBy(functionalTestRunCases.createdAt);
    
    return {
      ...result[0],
      testCases,
    };
  }

  async addTestCasesToRun(runId: string, testCases: InsertFunctionalTestRunCase[]): Promise<void> {
    if (testCases.length === 0) {
      console.log('[Storage] addTestCasesToRun: No test cases to save');
      return;
    }
    
    console.log(`[Storage] addTestCasesToRun: Preparing ${testCases.length} test cases for runId ${runId}`);
    
    const casesWithRunId = testCases.map(tc => ({
      ...tc,
      runId,
    }));
    
    try {
      console.log('[Storage] addTestCasesToRun: Inserting into database...');
      await db.insert(functionalTestRunCases).values(casesWithRunId);
      console.log(`[Storage] addTestCasesToRun: Successfully inserted ${testCases.length} test cases`);
    } catch (error) {
      console.error('[Storage] addTestCasesToRun: Database insert failed:', error);
      throw error;
    }
  }

  async updateFunctionalTestRun(id: string, updates: Partial<FunctionalTestRun>): Promise<void> {
    await db.update(functionalTestRuns)
      .set(updates)
      .where(eq(functionalTestRuns.id, id));
  }

  async completeFunctionalTestRun(id: string, counts: { total: number; workflow: number; functional: number; negative: number; edge: number; textValidation: number }): Promise<void> {
    console.log(`[Storage] completeFunctionalTestRun: Updating run ${id} with counts:`, counts);
    try {
      await db.update(functionalTestRuns)
        .set({
          status: 'completed',
          totalTestCases: counts.total,
          workflowCases: counts.workflow,
          functionalCases: counts.functional,
          negativeCases: counts.negative,
          edgeCases: counts.edge,
          textValidationCases: counts.textValidation,
          completedAt: new Date(),
        })
        .where(eq(functionalTestRuns.id, id));
      console.log(`[Storage] completeFunctionalTestRun: Successfully completed run ${id}`);
    } catch (error) {
      console.error('[Storage] completeFunctionalTestRun: Update failed:', error);
      throw error;
    }
  }

  // Sprint User Stories
  async createSprintUserStory(story: InsertSprintUserStory): Promise<SprintUserStory> {
    const id = (story as any).id ?? randomUUID();
    await db.insert(sprintUserStories).values({ ...story, id });
    const [result] = await db.select().from(sprintUserStories).where(eq(sprintUserStories.id, id)).limit(1);
    return result;
  }

  async getSprintUserStoriesBySprintId(sprintId: string): Promise<SprintUserStory[]> {
    return await db.select().from(sprintUserStories)
      .where(eq(sprintUserStories.sprintId, sprintId))
      .orderBy(desc(sprintUserStories.createdAt));
  }

  async getSprintUserStoryById(id: string): Promise<SprintUserStory | undefined> {
    const result = await db.select().from(sprintUserStories).where(eq(sprintUserStories.id, id)).limit(1);
    return result[0];
  }

  async updateSprintUserStory(id: string, updates: Partial<SprintUserStory>): Promise<SprintUserStory | undefined> {
    await db.update(sprintUserStories)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(sprintUserStories.id, id));
    const [result] = await db.select().from(sprintUserStories).where(eq(sprintUserStories.id, id)).limit(1);
    return result;
  }

  async deleteSprintUserStory(id: string): Promise<void> {
    await db.delete(sprintUserStories).where(eq(sprintUserStories.id, id));
  }

  async saveTestCasesToUserStory(sprintUserStoryId: string, sprintId: string, testCases: any[]): Promise<void> {
    // Delete existing test cases for this user story
    await db.delete(sprintTestCases).where(eq(sprintTestCases.sprintUserStoryId, sprintUserStoryId));

    // Insert new test cases
    if (testCases.length > 0) {
      const records = testCases.map(tc => ({
        sprintId,
        sprintUserStoryId,
        testCaseId: tc.testCaseId || tc.id,
        title: tc.title,
        category: tc.category,
        priority: tc.priority || "P2",
        testSteps: tc.steps || tc.testSteps || [],
        testType: tc.category || "functional",
      }));
      await db.insert(sprintTestCases).values(records);
    }

    // Also save full test cases as JSONB on the user story for complete data retrieval
    try {
      await db.update(sprintUserStories)
        .set({
          generatedTestCases: testCases,
          testCaseCount: testCases.length,
          generatedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(sprintUserStories.id, sprintUserStoryId));
    } catch (err: any) {
      console.warn("[Storage] Could not save full test cases to user story:", err.message);
    }
  }

  async getTestCasesByUserStoryId(sprintUserStoryId: string): Promise<SprintTestCase[]> {
    return await db.select().from(sprintTestCases)
      .where(eq(sprintTestCases.sprintUserStoryId, sprintUserStoryId))
      .orderBy(sprintTestCases.createdAt);
  }

  // Integration Configurations
  async createIntegrationConfig(config: InsertIntegrationConfig): Promise<IntegrationConfig> {
    const id = (config as any).id ?? randomUUID();
    await db.insert(integrationConfigs).values({ ...config, id });
    const [result] = await db.select().from(integrationConfigs).where(eq(integrationConfigs.id, id)).limit(1);
    return result;
  }

  async getIntegrationConfigsByUserId(userId: string): Promise<IntegrationConfig[]> {
    return await db.select().from(integrationConfigs)
      .where(eq(integrationConfigs.userId, userId))
      .orderBy(integrationConfigs.platform);
  }

  async getIntegrationConfigByPlatform(userId: string, platform: IntegrationPlatform): Promise<IntegrationConfig | undefined> {
    const result = await db.select().from(integrationConfigs)
      .where(and(
        eq(integrationConfigs.userId, userId),
        eq(integrationConfigs.platform, platform)
      ))
      .limit(1);
    return result[0];
  }

  async getIntegrationConfigById(id: string): Promise<IntegrationConfig | undefined> {
    const result = await db.select().from(integrationConfigs)
      .where(eq(integrationConfigs.id, id))
      .limit(1);
    return result[0];
  }

  async updateIntegrationConfig(id: string, updates: Partial<InsertIntegrationConfig & { status?: string; lastSyncedAt?: Date; lastError?: string }>): Promise<IntegrationConfig | undefined> {
    await db.update(integrationConfigs)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(integrationConfigs.id, id));
    const [result] = await db.select().from(integrationConfigs).where(eq(integrationConfigs.id, id)).limit(1);
    return result;
  }

  async deleteIntegrationConfig(id: string): Promise<void> {
    await db.delete(integrationConfigs).where(eq(integrationConfigs.id, id));
  }

  // Execution Runs
  async createExecutionRun(run: InsertExecutionRun): Promise<ExecutionRun> {
    const id = (run as any).id ?? randomUUID();
    await db.insert(executionRuns).values({ ...run, id });
    const [result] = await db.select().from(executionRuns).where(eq(executionRuns.id, id)).limit(1);
    return result;
  }

  async getExecutionRunsByProjectId(projectId: string): Promise<ExecutionRun[]> {
    return await db.select().from(executionRuns)
      .where(eq(executionRuns.projectId, projectId))
      .orderBy(desc(executionRuns.createdAt));
  }

  async getExecutionRunById(id: string): Promise<ExecutionRunWithTests | undefined> {
    const run = await db.select().from(executionRuns).where(eq(executionRuns.id, id)).limit(1);
    if (!run[0]) return undefined;
    
    const tests = await db.select().from(executionRunTests)
      .where(eq(executionRunTests.runId, id))
      .orderBy(executionRunTests.createdAt);
    
    return { ...run[0], tests };
  }

  async updateExecutionRun(id: string, updates: Partial<ExecutionRun>): Promise<ExecutionRun | undefined> {
    await db.update(executionRuns)
      .set(updates)
      .where(eq(executionRuns.id, id));
    const [result] = await db.select().from(executionRuns).where(eq(executionRuns.id, id)).limit(1);
    return result;
  }

  async addTestToExecutionRun(runId: string, test: InsertExecutionRunTest): Promise<ExecutionRunTest> {
    const id = randomUUID();
    await db.insert(executionRunTests).values({ ...test, runId, id });
    const [result] = await db.select().from(executionRunTests).where(eq(executionRunTests.id, id)).limit(1);
    return result;
  }

  async updateExecutionRunTest(id: string, updates: Partial<ExecutionRunTest>): Promise<ExecutionRunTest | undefined> {
    await db.update(executionRunTests)
      .set(updates)
      .where(eq(executionRunTests.id, id));
    const [result] = await db.select().from(executionRunTests).where(eq(executionRunTests.id, id)).limit(1);
    return result;
  }

  async getExecutionRunTestById(id: string): Promise<ExecutionRunTest | undefined> {
    const result = await db.select().from(executionRunTests).where(eq(executionRunTests.id, id)).limit(1);
    return result[0];
  }

  // BDD Feature Files
  async createBddFeatureFile(file: InsertBddFeatureFile): Promise<BddFeatureFile> {
    const id = (file as any).id ?? randomUUID();
    await db.insert(bddFeatureFiles).values({ ...file, id });
    const [result] = await db.select().from(bddFeatureFiles).where(eq(bddFeatureFiles.id, id)).limit(1);
    return result;
  }

  async getBddFeatureFilesByProjectId(projectId: string): Promise<BddFeatureFile[]> {
    return await db.select().from(bddFeatureFiles)
      .where(eq(bddFeatureFiles.projectId, projectId))
      .orderBy(desc(bddFeatureFiles.createdAt));
  }

  async getBddFeatureFileById(id: string): Promise<BddFeatureFile | undefined> {
    const result = await db.select().from(bddFeatureFiles).where(eq(bddFeatureFiles.id, id)).limit(1);
    return result[0];
  }

  async getBddFeatureFileByTestCaseId(testCaseId: string): Promise<BddFeatureFile | undefined> {
    const result = await db.select().from(bddFeatureFiles)
      .where(eq(bddFeatureFiles.testCaseId, testCaseId))
      .limit(1);
    return result[0];
  }

  async updateBddFeatureFile(id: string, updates: Partial<InsertBddFeatureFile>): Promise<BddFeatureFile | undefined> {
    await db.update(bddFeatureFiles)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(bddFeatureFiles.id, id));
    const [result] = await db.select().from(bddFeatureFiles).where(eq(bddFeatureFiles.id, id)).limit(1);
    return result;
  }

  async deleteBddFeatureFile(id: string): Promise<void> {
    await db.delete(bddFeatureFiles).where(eq(bddFeatureFiles.id, id));
  }

  // BDD Step Definitions
  async createBddStepDefinition(stepDef: InsertBddStepDefinition): Promise<BddStepDefinition> {
    const id = (stepDef as any).id ?? randomUUID();
    await db.insert(bddStepDefinitions).values({ ...stepDef, id });
    const [result] = await db.select().from(bddStepDefinitions).where(eq(bddStepDefinitions.id, id)).limit(1);
    return result;
  }

  async getBddStepDefinitionsByProjectId(projectId: string): Promise<BddStepDefinition[]> {
    return await db.select().from(bddStepDefinitions)
      .where(eq(bddStepDefinitions.projectId, projectId))
      .orderBy(desc(bddStepDefinitions.createdAt));
  }

  async getBddStepDefinitionsByFeatureFileId(featureFileId: string): Promise<BddStepDefinition[]> {
    return await db.select().from(bddStepDefinitions)
      .where(eq(bddStepDefinitions.featureFileId, featureFileId))
      .orderBy(bddStepDefinitions.createdAt);
  }

  async getBddStepDefinitionById(id: string): Promise<BddStepDefinition | undefined> {
    const result = await db.select().from(bddStepDefinitions).where(eq(bddStepDefinitions.id, id)).limit(1);
    return result[0];
  }

  async updateBddStepDefinition(id: string, updates: Partial<InsertBddStepDefinition>): Promise<BddStepDefinition | undefined> {
    await db.update(bddStepDefinitions)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(bddStepDefinitions.id, id));
    const [result] = await db.select().from(bddStepDefinitions).where(eq(bddStepDefinitions.id, id)).limit(1);
    return result;
  }

  async deleteBddStepDefinition(id: string): Promise<void> {
    await db.delete(bddStepDefinitions).where(eq(bddStepDefinitions.id, id));
  }
  
  async getTestCasesByIds(testCaseIds: string[]): Promise<SprintTestCase[]> {
    if (testCaseIds.length === 0) return [];
    return await db.select().from(sprintTestCases)
      .where(inArray(sprintTestCases.id, testCaseIds));
  }

  async getFunctionalTestCasesByIds(testCaseIds: string[]): Promise<FunctionalTestRunCase[]> {
    if (testCaseIds.length === 0) return [];
    return await db.select().from(functionalTestRunCases)
      .where(inArray(functionalTestRunCases.id, testCaseIds));
  }

  async saveJiraTestCases(
    jiraProjectKey: string,
    jiraStoryId: string,
    jiraStoryTitle: string,
    testCasesData: any[],
    jiraBoardId?: number | null,
    jiraSprintId?: number | null
  ): Promise<void> {
    await db.delete(jiraTestCases).where(
      and(
        eq(jiraTestCases.jiraProjectKey, jiraProjectKey),
        eq(jiraTestCases.jiraStoryId, jiraStoryId)
      )
    );
    
    if (testCasesData.length === 0) return;
    
    const rows = testCasesData.map((tc: any) => ({
      jiraProjectKey,
      jiraBoardId: jiraBoardId || null,
      jiraSprintId: jiraSprintId || null,
      jiraStoryId,
      jiraStoryTitle,
      testCaseId: tc.id || tc.testCaseId || `TC-${Date.now()}`,
      title: tc.title,
      description: tc.description || null,
      objective: tc.objective || null,
      preconditions: tc.preconditions || [],
      testSteps: (tc.steps || tc.testSteps || []).map((s: any, i: number) => ({
        step_number: s.step_number || i + 1,
        action: s.action,
        expected_behavior: s.expected_behavior || '',
      })),
      expectedResult: tc.expectedResult || null,
      postconditions: tc.postconditions || [],
      testType: tc.testType || tc.category || 'functional',
      category: tc.category || 'functional',
      priority: tc.priority || 'P2',
      playwrightScript: tc.playwrightScript || null,
    }));
    
    await db.insert(jiraTestCases).values(rows);
  }

  async getJiraTestCases(jiraProjectKey: string, jiraStoryId: string): Promise<JiraTestCase[]> {
    return await db.select().from(jiraTestCases)
      .where(
        and(
          eq(jiraTestCases.jiraProjectKey, jiraProjectKey),
          eq(jiraTestCases.jiraStoryId, jiraStoryId)
        )
      )
      .orderBy(jiraTestCases.createdAt);
  }

  async getJiraTestCasesByIds(testCaseIds: string[]): Promise<JiraTestCase[]> {
    if (testCaseIds.length === 0) return [];
    return await db.select().from(jiraTestCases)
      .where(inArray(jiraTestCases.id, testCaseIds))
      .orderBy(jiraTestCases.createdAt);
  }

  async getAllJiraTestCasesByProject(jiraProjectKey: string): Promise<JiraTestCase[]> {
    return await db.select().from(jiraTestCases)
      .where(eq(jiraTestCases.jiraProjectKey, jiraProjectKey))
      .orderBy(jiraTestCases.createdAt);
  }

  async getJiraProjectsWithTestCases(): Promise<Array<{ projectKey: string; storyCount: number; testCaseCount: number }>> {
    const results = await db.select({
      projectKey: jiraTestCases.jiraProjectKey,
      storyId: jiraTestCases.jiraStoryId,
    }).from(jiraTestCases);
    
    const projectMap = new Map<string, Set<string>>();
    const projectCounts = new Map<string, number>();
    
    for (const row of results) {
      if (!projectMap.has(row.projectKey)) {
        projectMap.set(row.projectKey, new Set());
        projectCounts.set(row.projectKey, 0);
      }
      projectMap.get(row.projectKey)!.add(row.storyId);
      projectCounts.set(row.projectKey, (projectCounts.get(row.projectKey) || 0) + 1);
    }
    
    return Array.from(projectMap.entries()).map(([projectKey, stories]) => ({
      projectKey,
      storyCount: stories.size,
      testCaseCount: projectCounts.get(projectKey) || 0,
    }));
  }

  async getJiraStoriesWithTestCases(jiraProjectKey: string): Promise<Array<{ storyId: string; storyTitle: string; testCaseCount: number }>> {
    const results = await db.select({
      storyId: jiraTestCases.jiraStoryId,
      storyTitle: jiraTestCases.jiraStoryTitle,
    }).from(jiraTestCases)
      .where(eq(jiraTestCases.jiraProjectKey, jiraProjectKey));
    
    const storyMap = new Map<string, { title: string; count: number }>();
    
    for (const row of results) {
      if (!storyMap.has(row.storyId)) {
        storyMap.set(row.storyId, { title: row.storyTitle, count: 0 });
      }
      storyMap.get(row.storyId)!.count++;
    }
    
    return Array.from(storyMap.entries()).map(([storyId, data]) => ({
      storyId,
      storyTitle: data.title,
      testCaseCount: data.count,
    }));
  }

  // Automation Scripts
  async createAutomationScript(script: InsertAutomationScript): Promise<AutomationScript> {
    const id = randomUUID();
    await db.insert(automationScripts).values({
      ...script,
      id,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const [created] = await db.select().from(automationScripts).where(eq(automationScripts.id, id)).limit(1);
    return created;
  }

  async getAutomationScriptsByRunId(runId: string): Promise<AutomationScript[]> {
    return db.select().from(automationScripts).where(eq(automationScripts.runId, runId)).orderBy(automationScripts.createdAt);
  }

  async getAutomationScriptById(id: string): Promise<AutomationScript | undefined> {
    const [script] = await db.select().from(automationScripts).where(eq(automationScripts.id, id));
    return script;
  }

  async updateAutomationScript(id: string, updates: Partial<AutomationScript>): Promise<AutomationScript | undefined> {
    await db.update(automationScripts)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(automationScripts.id, id));
    const [updated] = await db.select().from(automationScripts).where(eq(automationScripts.id, id)).limit(1);
    return updated;
  }

  async deleteAutomationScript(id: string): Promise<void> {
    await db.delete(automationScripts).where(eq(automationScripts.id, id));
  }

  // API Discovery
  async createApiDiscoveryRun(run: InsertApiDiscoveryRun): Promise<ApiDiscoveryRun> {
    const id = randomUUID();
    await db.insert(apiDiscoveryRuns).values({
      ...run,
      id,
      createdAt: new Date(),
    });
    const [created] = await db.select().from(apiDiscoveryRuns).where(eq(apiDiscoveryRuns.id, id)).limit(1);
    return created;
  }

  async getApiDiscoveryRunById(id: string): Promise<ApiDiscoveryRun | undefined> {
    const [run] = await db.select().from(apiDiscoveryRuns).where(eq(apiDiscoveryRuns.id, id));
    return run;
  }

  async updateApiDiscoveryRun(id: string, updates: Partial<ApiDiscoveryRun>): Promise<ApiDiscoveryRun | undefined> {
    await db.update(apiDiscoveryRuns).set(updates).where(eq(apiDiscoveryRuns.id, id));
    const [updated] = await db.select().from(apiDiscoveryRuns).where(eq(apiDiscoveryRuns.id, id)).limit(1);
    return updated;
  }

  // HAR Captures
  async createHarCapture(capture: InsertHarCapture): Promise<HarCapture> {
    const id = randomUUID();
    await db.insert(harCaptures).values({
      ...capture,
      id,
      capturedAt: new Date(),
    });
    const [created] = await db.select().from(harCaptures).where(eq(harCaptures.id, id)).limit(1);
    return created;
  }

  async getHarCapturesByDiscoveryRunId(discoveryRunId: string): Promise<HarCapture[]> {
    return db.select().from(harCaptures).where(eq(harCaptures.discoveryRunId, discoveryRunId));
  }

  // Functional Test Run wizard extensions
  // Note: functionalTestRuns table only has a 'status' column from the wizard update fields.
  // mermaidDiagram, wizardStep, testingMode, designPattern, totalPages are not DB columns.
  async updateFunctionalTestRunWizardData(id: string, updates: { mermaidDiagram?: string; wizardStep?: number; testingMode?: string; designPattern?: string; totalPages?: number; status?: string }): Promise<void> {
    const dbUpdates: Partial<FunctionalTestRun> = {};
    if (updates.status !== undefined) dbUpdates.status = updates.status;
    if (Object.keys(dbUpdates).length > 0) {
      await db.update(functionalTestRuns).set(dbUpdates).where(eq(functionalTestRuns.id, id));
    }
  }
}

export const storage = new PgStorage();
