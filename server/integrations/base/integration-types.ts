export type IntegrationType = 'ado' | 'jira';

export interface IntegrationConfig {
  type: IntegrationType;
  organization?: string;
  project?: string;
  pat?: string;
  organizationUrl?: string;
  apiVersion?: string;
  instanceUrl?: string;
  projectKey?: string;
  email?: string;
  apiToken?: string;
}

export interface WorkItem {
  id: string;
  title: string;
  description: string;
  type: 'epic' | 'feature' | 'user-story' | 'task' | 'bug' | 'Epic' | 'Feature' | 'User Story' | 'Task' | 'Bug';
  status: string;
  assignee?: string;
  storyPoints?: number;
  priority?: string;
  acceptanceCriteria?: string;
  parentId?: string;
  externalId?: string;
  source?: string;
  createdAt?: Date;
  updatedAt?: Date;
  createdBy?: string;
}

export interface ProjectInfo {
  id: string;
  name: string;
  key?: string;
  description?: string;
}

export interface BacklogContext {
  stateCounts: Record<string, number>;
  developerAssignments: Array<{
    developer: string;
    count: number;
  }>;
  velocity: {
    current: number;
    average: number;
  };
}

export interface SprintInfo {
  id: string;
  name: string;
  startDate?: Date;
  endDate?: Date;
  state: 'active' | 'closed' | 'future';
}

export interface ReleaseInfo {
  id: string;
  name: string;
  status: string;
  createdAt?: Date;
  deployments?: Array<{
    environment: string;
    status: string;
    deployedAt?: Date;
  }>;
}

export interface TestRun {
  id: string;
  name: string;
  state: string;
  totalTests: number;
  passedTests: number;
  failedTests: number;
  startedAt?: Date;
  completedAt?: Date;
}

export interface BuildInfo {
  id: string;
  name: string;
  status: string;
  result?: string;
  startTime?: Date;
  finishTime?: Date;
  sourceBranch?: string;
}

export interface RepositoryInfo {
  id: string;
  name: string;
  url?: string;
  defaultBranch?: string;
}

export interface ConnectionTestResult {
  success: boolean;
  message: string;
  details?: Record<string, any>;
}
