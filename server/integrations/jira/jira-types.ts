export interface JiraConfig {
  instanceUrl: string;
  projectKey?: string; // Optional - only required for project-specific operations
  email: string;
  apiToken: string;
}

export interface JiraFieldMapping {
  instanceUrl: string;
  storyPointsFieldId: string;
  epicLinkFieldId: string;
  sprintFieldId: string;
  acceptanceCriteriaFieldId: string;
  epicNameFieldId: string;
  cachedAt: Date;
}

export interface JiraIssue {
  id: string;
  key: string;
  self: string;
  fields: {
    summary: string;
    description?: any;
    issuetype: {
      id: string;
      name: string;
    };
    status: {
      id: string;
      name: string;
      statusCategory?: {
        key: string;
        name: string;
      };
    };
    priority?: {
      id: string;
      name: string;
    };
    assignee?: {
      accountId: string;
      displayName: string;
      emailAddress?: string;
    };
    creator?: {
      accountId: string;
      displayName: string;
    };
    created: string;
    updated: string;
    parent?: {
      id: string;
      key: string;
    };
    [key: string]: any;
  };
}

export interface JiraProject {
  id: string;
  key: string;
  name: string;
  description?: string;
  projectTypeKey?: string;
  lead?: {
    accountId: string;
    displayName: string;
  };
}

export interface JiraSprint {
  id: number;
  name: string;
  state: 'active' | 'closed' | 'future';
  startDate?: string;
  endDate?: string;
  completeDate?: string;
  originBoardId?: number;
}

export interface JiraVersion {
  id: string;
  name: string;
  description?: string;
  released: boolean;
  releaseDate?: string;
  projectId: number;
}

export interface JiraBoard {
  id: number;
  name: string;
  type: 'scrum' | 'kanban' | 'simple';
  location?: {
    projectId: number;
    projectKey: string;
  };
}

export interface JiraUser {
  accountId: string;
  displayName: string;
  emailAddress?: string;
  avatarUrls?: Record<string, string>;
  active: boolean;
}

export const JIRA_ISSUE_TYPE_MAP: Record<string, string> = {
  'epic': 'Epic',
  // Keep a dedicated Feature type in Jira so Features don't appear as Stories
  'feature': 'Feature',
  'user-story': 'Story',
  'task': 'Task',
  'bug': 'Bug',
};

export const JIRA_PRIORITY_MAP: Record<string, string> = {
  '1': 'Highest',
  '2': 'High',
  '3': 'Medium',
  '4': 'Low',
  'critical': 'Highest',
  'high': 'High',
  'medium': 'Medium',
  'low': 'Low',
};

export const JIRA_STATUS_MAP: Record<string, string> = {
  'To Do': 'New',
  'In Progress': 'Active',
  'Done': 'Closed',
  'Closed': 'Closed',
  'Open': 'New',
  'Reopened': 'Active',
  'Resolved': 'Resolved',
};
