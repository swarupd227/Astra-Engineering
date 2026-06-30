import {
  WorkItem,
  ProjectInfo,
  BacklogContext,
  SprintInfo,
  ReleaseInfo,
  TestRun,
  BuildInfo,
  RepositoryInfo,
  ConnectionTestResult,
} from './integration-types';

export interface IntegrationService {
  testConnection(): Promise<ConnectionTestResult>;
  
  getProjects(): Promise<ProjectInfo[]>;
  
  getEpics(): Promise<WorkItem[]>;
  getFeatures(): Promise<WorkItem[]>;
  getUserStories(): Promise<WorkItem[]>;
  getWorkItem(id: string): Promise<WorkItem | null>;
  createWorkItem(item: Partial<WorkItem>): Promise<WorkItem>;
  updateWorkItem(id: string, updates: Partial<WorkItem>): Promise<WorkItem>;
  deleteWorkItem(id: string): Promise<void>;
  
  getBacklogContext(): Promise<BacklogContext>;
  
  getSprints(): Promise<SprintInfo[]>;
  getSprintWorkItems(sprintId: string): Promise<WorkItem[]>;
  
  getRepositories(): Promise<RepositoryInfo[]>;
  
  getBuilds(): Promise<BuildInfo[]>;
  getPipelines(): Promise<any[]>;
  
  getReleases(): Promise<ReleaseInfo[]>;
  getReleaseDefinitions(): Promise<any[]>;
  createRelease(definitionId: string, data: any): Promise<any>;
  
  getTestRuns(): Promise<TestRun[]>;
  getTestResults(testRunId: string): Promise<any[]>;
  
  getMonitoringData(): Promise<any>;
}

export abstract class BaseIntegrationService implements IntegrationService {
  abstract testConnection(): Promise<ConnectionTestResult>;
  abstract getProjects(): Promise<ProjectInfo[]>;
  abstract getEpics(): Promise<WorkItem[]>;
  abstract getFeatures(): Promise<WorkItem[]>;
  abstract getUserStories(): Promise<WorkItem[]>;
  abstract getWorkItem(id: string): Promise<WorkItem | null>;
  abstract createWorkItem(item: Partial<WorkItem>): Promise<WorkItem>;
  abstract updateWorkItem(id: string, updates: Partial<WorkItem>): Promise<WorkItem>;
  abstract deleteWorkItem(id: string): Promise<void>;
  abstract getBacklogContext(): Promise<BacklogContext>;
  abstract getSprints(): Promise<SprintInfo[]>;
  abstract getSprintWorkItems(sprintId: string): Promise<WorkItem[]>;
  abstract getRepositories(): Promise<RepositoryInfo[]>;
  abstract getBuilds(): Promise<BuildInfo[]>;
  abstract getPipelines(): Promise<any[]>;
  abstract getReleases(): Promise<ReleaseInfo[]>;
  abstract getReleaseDefinitions(): Promise<any[]>;
  abstract createRelease(definitionId: string, data: any): Promise<any>;
  abstract getTestRuns(): Promise<TestRun[]>;
  abstract getTestResults(testRunId: string): Promise<any[]>;
  abstract getMonitoringData(): Promise<any>;
}
