import axios from 'axios';

interface AdoConfig {
  organization: string;
  project: string;
  pat: string;
}

interface WorkItem {
  id: number;
  fields: {
    'System.Title': string;
    'System.Description'?: string;
    'Microsoft.VSTS.Common.AcceptanceCriteria'?: string;
    'System.State': string;
    'System.AssignedTo'?: {
      displayName: string;
    };
    'System.IterationPath': string;
    'System.AreaPath': string;
    'System.Tags'?: string;
  };
  url: string;
  _links?: {
    html?: {
      href: string;
    };
  };
}

export interface UserStoryData {
  adoWorkItemId: number;
  title: string;
  description?: string;
  acceptanceCriteria?: string;
  state: string;
  assignedTo?: string;
  sprint: string;
  areaPath: string;
  tags: string[];
  adoUrl?: string;
}

export class AdoPullService {
  private getConfig(providedConfig?: AdoConfig): AdoConfig | null {
    if (providedConfig && providedConfig.organization && providedConfig.project && providedConfig.pat) {
      return providedConfig;
    }

    const organization = process.env.ADO_ORGANIZATION;
    const project = process.env.ADO_PROJECT;
    const pat = process.env.ADO_PAT;

    if (organization && project && pat) {
      return { organization, project, pat };
    }
    return null;
  }

  public isConfigured(providedConfig?: AdoConfig): boolean {
    return this.getConfig(providedConfig) !== null;
  }

  public getConfigurationError(): string {
    return 'Azure DevOps credentials not configured. Please configure your ADO credentials in the Sprint Agent settings.';
  }

  public async getIterations(providedConfig?: AdoConfig): Promise<{
    success: boolean;
    iterations?: Array<{ id: string; name: string; path: string }>;
    error?: string;
  }> {
    const config = this.getConfig(providedConfig);
    if (!config) {
      return {
        success: false,
        error: this.getConfigurationError(),
      };
    }

    try {
      const url = `https://dev.azure.com/${config.organization}/${config.project}/_apis/work/teamsettings/iterations?api-version=7.1`;
      const token = Buffer.from(`:${config.pat}`).toString('base64');

      const response = await axios.get(url, {
        headers: {
          'Authorization': `Basic ${token}`,
        },
      });

      const iterations = response.data.value.map((iteration: any) => ({
        id: iteration.id,
        name: iteration.name,
        path: iteration.path,
      }));

      return {
        success: true,
        iterations,
      };
    } catch (error: any) {
      console.error('ADO get iterations error:', error.response?.data || error.message);
      return {
        success: false,
        error: error.response?.data?.message || error.message || 'Failed to fetch iterations from Azure DevOps',
      };
    }
  }

  public async getUserStoriesBySprint(iterationPath: string, providedConfig?: AdoConfig): Promise<{
    success: boolean;
    userStories?: UserStoryData[];
    error?: string;
  }> {
    const config = this.getConfig(providedConfig);
    if (!config) {
      return {
        success: false,
        error: this.getConfigurationError(),
      };
    }

    try {
      const token = Buffer.from(`:${config.pat}`).toString('base64');

      const wiqlQuery = {
        query: `SELECT [System.Id], [System.Title], [System.Description], [Microsoft.VSTS.Common.AcceptanceCriteria], [System.State], [System.AssignedTo], [System.IterationPath], [System.AreaPath], [System.Tags]
                FROM WorkItems
                WHERE [System.WorkItemType] = 'User Story'
                AND [System.IterationPath] = '${iterationPath}'
                ORDER BY [System.Id] DESC`
      };

      const wiqlUrl = `https://dev.azure.com/${config.organization}/${config.project}/_apis/wit/wiql?api-version=7.1`;
      const wiqlResponse = await axios.post(wiqlUrl, wiqlQuery, {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Basic ${token}`,
        },
      });

      const workItemIds = wiqlResponse.data.workItems.map((item: any) => item.id);

      if (workItemIds.length === 0) {
        return {
          success: true,
          userStories: [],
        };
      }

      const batchUrl = `https://dev.azure.com/${config.organization}/_apis/wit/workitems?ids=${workItemIds.join(',')}&api-version=7.1`;
      const batchResponse = await axios.get(batchUrl, {
        headers: {
          'Authorization': `Basic ${token}`,
        },
      });

      const userStories: UserStoryData[] = batchResponse.data.value.map((item: WorkItem) => ({
        adoWorkItemId: item.id,
        title: item.fields['System.Title'],
        description: item.fields['System.Description'] || undefined,
        acceptanceCriteria: item.fields['Microsoft.VSTS.Common.AcceptanceCriteria'] || undefined,
        state: item.fields['System.State'],
        assignedTo: item.fields['System.AssignedTo']?.displayName,
        sprint: item.fields['System.IterationPath'],
        areaPath: item.fields['System.AreaPath'],
        tags: item.fields['System.Tags']?.split(';').map((tag: string) => tag.trim()).filter(Boolean) || [],
        adoUrl: item._links?.html?.href,
      }));

      return {
        success: true,
        userStories,
      };
    } catch (error: any) {
      console.error('ADO pull user stories error:', error.response?.data || error.message);
      return {
        success: false,
        error: error.response?.data?.message || error.message || 'Failed to fetch user stories from Azure DevOps',
      };
    }
  }

  public async getUserStoryById(workItemId: number): Promise<{
    success: boolean;
    userStory?: UserStoryData;
    error?: string;
  }> {
    const config = this.getConfig();
    if (!config) {
      return {
        success: false,
        error: this.getConfigurationError(),
      };
    }

    try {
      const url = `https://dev.azure.com/${config.organization}/_apis/wit/workitems/${workItemId}?api-version=7.1`;
      const token = Buffer.from(`:${config.pat}`).toString('base64');

      const response = await axios.get(url, {
        headers: {
          'Authorization': `Basic ${token}`,
        },
      });

      const item: WorkItem = response.data;
      const userStory: UserStoryData = {
        adoWorkItemId: item.id,
        title: item.fields['System.Title'],
        description: item.fields['System.Description'] || undefined,
        acceptanceCriteria: item.fields['Microsoft.VSTS.Common.AcceptanceCriteria'] || undefined,
        state: item.fields['System.State'],
        assignedTo: item.fields['System.AssignedTo']?.displayName,
        sprint: item.fields['System.IterationPath'],
        areaPath: item.fields['System.AreaPath'],
        tags: item.fields['System.Tags']?.split(';').map((tag: string) => tag.trim()).filter(Boolean) || [],
        adoUrl: item._links?.html?.href,
      };

      return {
        success: true,
        userStory,
      };
    } catch (error: any) {
      console.error('ADO get user story error:', error.response?.data || error.message);
      return {
        success: false,
        error: error.response?.data?.message || error.message || 'Failed to fetch user story from Azure DevOps',
      };
    }
  }
}

export const adoPullService = new AdoPullService();
