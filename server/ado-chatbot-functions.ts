import { AzureDevOpsService } from './azure-devops-service';
import type { AzureConfig } from './azure-devops-service';

/**
 * OpenAI function definitions for Azure DevOps integration
 */
export const adoFunctions = [
  {
    name: 'get_repositories',
    description: 'Fetch all repositories in the Azure DevOps project. Use this when the user asks about repositories, repos, or code repositories.',
    parameters: {
      type: 'object',
      properties: {
        projectName: {
          type: 'string',
          description: 'Optional project name. If not provided, uses the default configured project.',
        },
      },
    },
  },
  {
    name: 'get_pipelines',
    description: 'Fetch all build pipelines in the Azure DevOps project. Use this when the user asks about pipelines, builds, or CI/CD.',
    parameters: {
      type: 'object',
      properties: {
        projectName: {
          type: 'string',
          description: 'Optional project name. If not provided, uses the default configured project.',
        },
      },
    },
  },
  {
    name: 'get_pull_requests',
    description: 'Fetch pull requests for a specific repository. Use this when the user asks about PRs, pull requests, or code reviews.',
    parameters: {
      type: 'object',
      properties: {
        repositoryId: {
          type: 'string',
          description: 'The ID or name of the repository',
        },
        status: {
          type: 'string',
          enum: ['all', 'active', 'completed', 'abandoned'],
          description: 'Filter pull requests by status. Default is "all".',
        },
      },
      required: ['repositoryId'],
    },
  },
  {
    name: 'get_commits',
    description: 'Fetch recent commits for a specific repository. Use this when the user asks about commits, code changes, or recent updates.',
    parameters: {
      type: 'object',
      properties: {
        repositoryId: {
          type: 'string',
          description: 'The ID or name of the repository',
        },
        limit: {
          type: 'number',
          description: 'Number of commits to fetch (default 50, max 100)',
          default: 50,
        },
      },
      required: ['repositoryId'],
    },
  },
  {
    name: 'get_work_items_by_type',
    description: 'Fetch work items of a specific type (e.g., User Story, Task, Bug, Epic, Feature). Use this when the user asks about specific types of work items.',
    parameters: {
      type: 'object',
      properties: {
        workItemType: {
          type: 'string',
          enum: ['User Story', 'Task', 'Bug', 'Epic', 'Feature', 'Issue', 'Test Case'],
          description: 'The type of work item to fetch',
        },
        projectName: {
          type: 'string',
          description: 'Optional project name',
        },
        limit: {
          type: 'number',
          description: 'Number of work items to fetch (default 100)',
          default: 100,
        },
      },
      required: ['workItemType'],
    },
  },
  {
    name: 'get_work_item_with_children',
    description: 'Fetch a specific work item along with all its children (subtasks, child stories, etc.). Use this when the user asks about a specific work item by ID or wants to see subtasks.',
    parameters: {
      type: 'object',
      properties: {
        workItemId: {
          type: 'number',
          description: 'The ID of the work item',
        },
        projectName: {
          type: 'string',
          description: 'Optional project name',
        },
      },
      required: ['workItemId'],
    },
  },
  {
    name: 'search_work_items',
    description: 'Search for work items by title or description. Use this when the user is looking for work items containing specific keywords.',
    parameters: {
      type: 'object',
      properties: {
        searchTerm: {
          type: 'string',
          description: 'The search term to look for in work item titles and descriptions',
        },
        projectName: {
          type: 'string',
          description: 'Optional project name',
        },
        limit: {
          type: 'number',
          description: 'Number of results to return (default 50)',
          default: 50,
        },
      },
      required: ['searchTerm'],
    },
  },
  {
    name: 'get_recent_builds',
    description: 'Fetch recent build/pipeline runs. Use this when the user asks about recent builds, pipeline status, or build history.',
    parameters: {
      type: 'object',
      properties: {
        pipelineId: {
          type: 'number',
          description: 'Optional pipeline ID to filter builds for a specific pipeline',
        },
        limit: {
          type: 'number',
          description: 'Number of builds to fetch (default 10)',
          default: 10,
        },
      },
    },
  },
  {
    name: 'get_projects',
    description: 'Fetch all projects in the Azure DevOps organization. Use this when the user asks about available projects.',
    parameters: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'create_work_item',
    description: 'Create a new work item (User Story, Task, Bug, Epic, Feature) in Azure DevOps. Use this when the user approves a generated story and wants to create it in ADO.',
    parameters: {
      type: 'object',
      properties: {
        workItemType: {
          type: 'string',
          enum: ['User Story', 'Task', 'Bug', 'Epic', 'Feature'],
          description: 'The type of work item to create',
        },
        title: {
          type: 'string',
          description: 'The title of the work item',
        },
        description: {
          type: 'string',
          description: 'The description/details of the work item',
        },
        acceptanceCriteria: {
          type: 'string',
          description: 'The acceptance criteria (optional)',
        },
        assignedTo: {
          type: 'string',
          description: 'Email or display name of the person to assign (optional)',
        },
        storyPoints: {
          type: 'number',
          description: 'Story point estimation (optional)',
        },
        priority: {
          type: 'number',
          description: 'Priority (1=High, 2=Medium, 3=Low, 4=Very Low)',
        },
        tags: {
          type: 'string',
          description: 'Comma-separated tags (optional)',
        },
        projectName: {
          type: 'string',
          description: 'Optional project name',
        },
      },
      required: ['workItemType', 'title', 'description'],
    },
  },
];

/**
 * Execute an ADO function based on function name and arguments
 */
export async function executeAdoFunction(
  functionName: string,
  functionArgs: any,
  adoConfig: AzureConfig
): Promise<any> {
  const adoService = new AzureDevOpsService(adoConfig);

  console.log(`[ADO Functions] Executing function: ${functionName} with args:`, functionArgs);

  try {
    switch (functionName) {
      case 'get_repositories':
        return await adoService.getRepositories(functionArgs.projectName);

      case 'get_pipelines':
        return await adoService.getPipelines(functionArgs.projectName);

      case 'get_pull_requests':
        return await adoService.getPullRequests(
          functionArgs.repositoryId,
          functionArgs.status || 'all'
        );

      case 'get_commits':
        return await adoService.getCommits(
          functionArgs.repositoryId,
          functionArgs.limit || 50
        );

      case 'get_work_items_by_type':
        return await adoService.getWorkItemsByType(
          functionArgs.workItemType,
          functionArgs.projectName,
          functionArgs.limit || 100
        );

      case 'get_work_item_with_children':
        return await adoService.getWorkItemWithChildren(
          functionArgs.workItemId,
          functionArgs.projectName
        );

      case 'search_work_items':
        return await adoService.searchWorkItems(
          functionArgs.searchTerm,
          functionArgs.projectName,
          functionArgs.limit || 50
        );

      case 'get_recent_builds':
        return await adoService.getRecentBuilds(
          functionArgs.pipelineId,
          functionArgs.limit || 10
        );

      case 'get_projects':
        return await adoService.getProjects();

      case 'create_work_item':
        return await adoService.createWorkItemFromChat(
          functionArgs.workItemType,
          functionArgs.title,
          functionArgs.description,
          functionArgs.acceptanceCriteria,
          functionArgs.assignedTo,
          functionArgs.storyPoints,
          functionArgs.priority,
          functionArgs.tags,
          functionArgs.projectName
        );

      default:
        throw new Error(`Unknown function: ${functionName}`);
    }
  } catch (error) {
    console.error(`[ADO Functions] Error executing ${functionName}:`, error);
    throw error;
  }
}

/**
 * Format ADO data for display in chatbot responses
 */
export function formatAdoDataForChat(functionName: string, data: any): string {
  switch (functionName) {
    case 'get_repositories':
      if (!data || data.length === 0) {
        return 'No repositories found in this project.';
      }
      return data
        .map(
          (repo: any, index: number) =>
            `${index + 1}. **${repo.name}**\n   - URL: [${repo.webUrl}](${repo.webUrl})\n   - Default Branch: ${repo.defaultBranch || 'N/A'}`
        )
        .join('\n\n');

    case 'get_pipelines':
      if (!data || data.length === 0) {
        return 'No pipelines found in this project.';
      }
      return data
        .map(
          (pipeline: any, index: number) =>
            `${index + 1}. **${pipeline.name}** (ID: ${pipeline.id})\n   - Path: ${pipeline.path || '/'}\n   - Type: ${pipeline.type}`
        )
        .join('\n\n');

    case 'get_pull_requests':
      if (!data || data.length === 0) {
        return 'No pull requests found for this repository.';
      }
      return data
        .map(
          (pr: any, index: number) =>
            `${index + 1}. **PR #${pr.pullRequestId}: ${pr.title}**\n   - Status: ${pr.status}\n   - Created by: ${pr.createdBy?.displayName || 'Unknown'}\n   - Source: ${pr.sourceRefName} → ${pr.targetRefName}`
        )
        .join('\n\n');

    case 'get_commits':
      if (!data || data.length === 0) {
        return 'No commits found for this repository.';
      }
      return data
        .slice(0, 10)
        .map(
          (commit: any, index: number) =>
            `${index + 1}. **${commit.comment?.split('\n')[0] || 'No message'}**\n   - Author: ${commit.author?.name || 'Unknown'}\n   - Date: ${new Date(commit.author?.date).toLocaleString()}\n   - SHA: ${commit.commitId?.substring(0, 8)}`
        )
        .join('\n\n');

    case 'get_work_items_by_type':
    case 'search_work_items':
      if (!data || data.length === 0) {
        return 'No work items found matching your criteria.';
      }
      return data
        .map(
          (item: any, index: number) =>
            `${index + 1}. **#${item.id}: ${item.fields?.['System.Title'] || 'Untitled'}**\n   - Type: ${item.fields?.['System.WorkItemType']}\n   - State: ${item.fields?.['System.State']}\n   - Assigned to: ${item.fields?.['System.AssignedTo']?.displayName || 'Unassigned'}`
        )
        .join('\n\n');

    case 'get_work_item_with_children':
      if (!data) {
        return 'Work item not found.';
      }
      let result = `**#${data.id}: ${data.fields?.['System.Title'] || 'Untitled'}**\n`;
      result += `- Type: ${data.fields?.['System.WorkItemType']}\n`;
      result += `- State: ${data.fields?.['System.State']}\n`;
      result += `- Assigned to: ${data.fields?.['System.AssignedTo']?.displayName || 'Unassigned'}\n`;
      result += `- Description: ${data.fields?.['System.Description'] || 'No description'}\n`;
      
      if (data.children && data.children.length > 0) {
        result += `\n**Children (${data.children.length}):**\n`;
        data.children.forEach((child: any, index: number) => {
          result += `${index + 1}. #${child.id}: ${child.fields?.['System.Title']} (${child.fields?.['System.State']})\n`;
        });
      }
      return result;

    case 'get_recent_builds':
      if (!data || data.length === 0) {
        return 'No recent builds found.';
      }
      return data
        .map(
          (build: any, index: number) =>
            `${index + 1}. **Build #${build.buildNumber}** (${build.definition?.name})\n   - Status: ${build.status}\n   - Result: ${build.result || 'In progress'}\n   - Started: ${new Date(build.startTime).toLocaleString()}`
        )
        .join('\n\n');

    case 'get_projects':
      if (!data || data.length === 0) {
        return 'No projects found in this organization.';
      }
      return data
        .map(
          (project: any, index: number) =>
            `${index + 1}. **${project.name}**\n   - Description: ${project.description || 'No description'}\n   - State: ${project.state}`
        )
        .join('\n\n');

    case 'create_work_item':
      if (!data) {
        return 'Failed to create work item.';
      }
      const title = data.fields?.['System.Title'] || 'Untitled';
      const workItemType = data.fields?.['System.WorkItemType'] || 'Work Item';
      const state = data.fields?.['System.State'] || 'New';
      const assignedTo = data.fields?.['System.AssignedTo']?.displayName || 'Unassigned';
      const storyPoints = data.fields?.['Microsoft.VSTS.Scheduling.StoryPoints'] || 'N/A';
      const webUrl = data._links?.html?.href || '';
      
      return `✅ **Successfully created ${workItemType} #${data.id}**

**${title}**

- **State:** ${state}
- **Assigned To:** ${assignedTo}
- **Story Points:** ${storyPoints}

The work item has been created successfully in Azure DevOps!

[ADO_URL:${webUrl}]`;

    default:
      return JSON.stringify(data, null, 2);
  }
}
