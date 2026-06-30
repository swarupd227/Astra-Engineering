import axios from 'axios';

interface JiraConfig {
  domain: string;
  email: string;
  apiToken: string;
}

interface JiraIssue {
  id: string;
  key: string;
  fields: {
    summary: string;
    description?: string | { content?: any[] };
    status: {
      name: string;
    };
    assignee?: {
      displayName: string;
    };
    priority?: {
      name: string;
    };
    labels?: string[];
    customfield_10016?: number;
    sprint?: {
      id: number;
      name: string;
      state: string;
    };
  };
}

export interface JiraUserStoryData {
  jiraIssueId: string;
  jiraKey: string;
  title: string;
  description?: string;
  acceptanceCriteria?: string;
  state: string;
  assignedTo?: string;
  priority?: string;
  sprint?: string;
  tags: string[];
  jiraUrl?: string;
}

export interface JiraSprint {
  id: number;
  name: string;
  state: string;
  originBoardId: number;
}

export class JiraPullService {
  private getConfig(providedConfig?: JiraConfig): JiraConfig | null {
    if (providedConfig && providedConfig.domain && providedConfig.email && providedConfig.apiToken) {
      return providedConfig;
    }

    let domain = process.env.JIRA_DOMAIN;
    if (!domain && process.env.JIRA_BASE_URL) {
      domain = process.env.JIRA_BASE_URL.replace(/^https?:\/\//, '').replace(/\/$/, '');
    }
    const email = process.env.JIRA_EMAIL;
    const apiToken = process.env.JIRA_API_TOKEN;

    if (domain && email && apiToken) {
      return { domain, email, apiToken };
    }
    return null;
  }

  public isConfigured(providedConfig?: JiraConfig): boolean {
    return this.getConfig(providedConfig) !== null;
  }

  public getConfigurationError(): string {
    return 'Jira credentials not configured. Please configure your Jira credentials in Agent Configurations.';
  }

  private getAuthHeader(config: JiraConfig): string {
    const auth = Buffer.from(`${config.email}:${config.apiToken}`).toString('base64');
    return `Basic ${auth}`;
  }

  private extractTextFromDescription(description: any): string {
    if (!description) return '';
    if (typeof description === 'string') return description;
    
    if (description.content && Array.isArray(description.content)) {
      return description.content
        .map((block: any) => {
          if (block.type === 'paragraph' && block.content) {
            return block.content
              .map((item: any) => item.text || '')
              .join('');
          }
          return '';
        })
        .join('\n');
    }
    return '';
  }

  public async getProjects(providedConfig?: JiraConfig): Promise<{
    success: boolean;
    projects?: Array<{ id: string; key: string; name: string }>;
    error?: string;
  }> {
    const config = this.getConfig(providedConfig);
    if (!config) {
      return { success: false, error: this.getConfigurationError() };
    }

    try {
      const url = `https://${config.domain}/rest/api/3/project`;
      const response = await axios.get(url, {
        headers: {
          'Authorization': this.getAuthHeader(config),
          'Accept': 'application/json',
        },
      });

      const projects = response.data.map((project: any) => ({
        id: project.id,
        key: project.key,
        name: project.name,
      }));

      return { success: true, projects };
    } catch (error: any) {
      console.error('Jira get projects error:', error.response?.data || error.message);
      return {
        success: false,
        error: error.response?.data?.errorMessages?.[0] || error.message || 'Failed to fetch projects from Jira',
      };
    }
  }

  public async getSprints(boardId: number, providedConfig?: JiraConfig): Promise<{
    success: boolean;
    sprints?: JiraSprint[];
    error?: string;
  }> {
    const config = this.getConfig(providedConfig);
    if (!config) {
      return { success: false, error: this.getConfigurationError() };
    }

    try {
      const url = `https://${config.domain}/rest/agile/1.0/board/${boardId}/sprint`;
      const response = await axios.get(url, {
        headers: {
          'Authorization': this.getAuthHeader(config),
          'Accept': 'application/json',
        },
      });

      const sprints = response.data.values.map((sprint: any) => ({
        id: sprint.id,
        name: sprint.name,
        state: sprint.state,
        originBoardId: sprint.originBoardId,
      }));

      return { success: true, sprints };
    } catch (error: any) {
      console.error('Jira get sprints error:', error.response?.data || error.message);
      return {
        success: false,
        error: error.response?.data?.errorMessages?.[0] || error.message || 'Failed to fetch sprints from Jira',
      };
    }
  }

  public async getBoards(projectKey?: string, providedConfig?: JiraConfig): Promise<{
    success: boolean;
    boards?: Array<{ id: number; name: string; type: string }>;
    error?: string;
  }> {
    const config = this.getConfig(providedConfig);
    if (!config) {
      return { success: false, error: this.getConfigurationError() };
    }

    try {
      let url = `https://${config.domain}/rest/agile/1.0/board`;
      if (projectKey) {
        url += `?projectKeyOrId=${projectKey}`;
      }
      
      const response = await axios.get(url, {
        headers: {
          'Authorization': this.getAuthHeader(config),
          'Accept': 'application/json',
        },
      });

      const boards = response.data.values.map((board: any) => ({
        id: board.id,
        name: board.name,
        type: board.type,
      }));

      return { success: true, boards };
    } catch (error: any) {
      console.error('Jira get boards error:', error.response?.data || error.message);
      return {
        success: false,
        error: error.response?.data?.errorMessages?.[0] || error.message || 'Failed to fetch boards from Jira',
      };
    }
  }

  public async getUserStoriesByProject(projectKey: string, maxResults: number = 100, providedConfig?: JiraConfig): Promise<{
    success: boolean;
    userStories?: JiraUserStoryData[];
    error?: string;
  }> {
    const config = this.getConfig(providedConfig);
    if (!config) {
      return { success: false, error: this.getConfigurationError() };
    }

    try {
      const url = `https://${config.domain}/rest/api/3/search/jql`;
      const response = await axios.post(url, {
        jql: `project = ${projectKey} AND issuetype = Story ORDER BY created DESC`,
        maxResults,
        fields: ['summary', 'description', 'status', 'assignee', 'priority', 'labels'],
      }, {
        headers: {
          'Authorization': this.getAuthHeader(config),
          'Accept': 'application/json',
          'Content-Type': 'application/json',
        },
      });

      const userStories: JiraUserStoryData[] = response.data.issues.map((issue: JiraIssue) => ({
        jiraIssueId: issue.id,
        jiraKey: issue.key,
        title: issue.fields.summary,
        description: this.extractTextFromDescription(issue.fields.description),
        state: issue.fields.status?.name || 'Unknown',
        assignedTo: issue.fields.assignee?.displayName,
        priority: issue.fields.priority?.name,
        tags: issue.fields.labels || [],
        jiraUrl: `https://${config.domain}/browse/${issue.key}`,
      }));

      return { success: true, userStories };
    } catch (error: any) {
      console.error('Jira get user stories error:', error.response?.data || error.message);
      return {
        success: false,
        error: error.response?.data?.errorMessages?.[0] || error.message || 'Failed to fetch user stories from Jira',
      };
    }
  }

  public async getUserStoriesBySprint(sprintId: number, providedConfig?: JiraConfig): Promise<{
    success: boolean;
    userStories?: JiraUserStoryData[];
    error?: string;
  }> {
    const config = this.getConfig(providedConfig);
    if (!config) {
      return { success: false, error: this.getConfigurationError() };
    }

    try {
      const url = `https://${config.domain}/rest/api/3/search/jql`;
      const response = await axios.post(url, {
        jql: `sprint = ${sprintId} AND issuetype = Story ORDER BY created DESC`,
        maxResults: 100,
        fields: ['summary', 'description', 'status', 'assignee', 'priority', 'labels'],
      }, {
        headers: {
          'Authorization': this.getAuthHeader(config),
          'Accept': 'application/json',
          'Content-Type': 'application/json',
        },
      });

      const userStories: JiraUserStoryData[] = response.data.issues.map((issue: JiraIssue) => ({
        jiraIssueId: issue.id,
        jiraKey: issue.key,
        title: issue.fields.summary,
        description: this.extractTextFromDescription(issue.fields.description),
        state: issue.fields.status?.name || 'Unknown',
        assignedTo: issue.fields.assignee?.displayName,
        priority: issue.fields.priority?.name,
        sprint: `Sprint ${sprintId}`,
        tags: issue.fields.labels || [],
        jiraUrl: `https://${config.domain}/browse/${issue.key}`,
      }));

      return { success: true, userStories };
    } catch (error: any) {
      console.error('Jira get user stories by sprint error:', error.response?.data || error.message);
      return {
        success: false,
        error: error.response?.data?.errorMessages?.[0] || error.message || 'Failed to fetch user stories from Jira',
      };
    }
  }

  public async searchUserStories(jql: string, maxResults: number = 50, providedConfig?: JiraConfig): Promise<{
    success: boolean;
    userStories?: JiraUserStoryData[];
    error?: string;
  }> {
    const config = this.getConfig(providedConfig);
    if (!config) {
      return { success: false, error: this.getConfigurationError() };
    }

    try {
      const url = `https://${config.domain}/rest/api/3/search/jql`;
      const response = await axios.post(url, {
        jql,
        maxResults,
        fields: ['summary', 'description', 'status', 'assignee', 'priority', 'labels'],
      }, {
        headers: {
          'Authorization': this.getAuthHeader(config),
          'Accept': 'application/json',
          'Content-Type': 'application/json',
        },
      });

      const userStories: JiraUserStoryData[] = response.data.issues.map((issue: JiraIssue) => ({
        jiraIssueId: issue.id,
        jiraKey: issue.key,
        title: issue.fields.summary,
        description: this.extractTextFromDescription(issue.fields.description),
        state: issue.fields.status?.name || 'Unknown',
        assignedTo: issue.fields.assignee?.displayName,
        priority: issue.fields.priority?.name,
        tags: issue.fields.labels || [],
        jiraUrl: `https://${config.domain}/browse/${issue.key}`,
      }));

      return { success: true, userStories };
    } catch (error: any) {
      console.error('Jira search error:', error.response?.data || error.message);
      return {
        success: false,
        error: error.response?.data?.errorMessages?.[0] || error.message || 'Failed to search user stories in Jira',
      };
    }
  }
}

export const jiraPullService = new JiraPullService();
