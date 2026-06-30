import { AzureDevOpsService } from './azure-devops-service';
import type { AzureConfig } from './azure-devops-service';

export interface AdoContext {
  hasConfig: boolean;
  organization?: string;
  project?: string;
  projects?: Array<{ id: string; name: string; description?: string }>;
  workItemsSummary?: {
    total: number;
    byType: Record<string, number>;
    recentItems: Array<{
      id: number;
      type: string;
      title: string;
      state: string;
    }>;
  };
  error?: string;
}

/**
 * Fetches Azure DevOps context information for the chatbot
 * This includes projects, work items summary, and configuration details
 */
export async function getAdoContextForChatbot(
  organizationUrl?: string,
  projectName?: string,
  pat?: string
): Promise<AdoContext> {
  // Check if ADO configuration is available
  if (!organizationUrl || !projectName || !pat) {
    return {
      hasConfig: false,
      error: 'Azure DevOps configuration not set up. Please configure ADO settings first.',
    };
  }

  try {
    // Extract organization name from URL
    // URL format: https://dev.azure.com/{organization} or https://{organization}.visualstudio.com
    let organization = '';
    if (organizationUrl.includes('dev.azure.com')) {
      const match = organizationUrl.match(/dev\.azure\.com\/([^\/]+)/);
      organization = match ? match[1] : '';
    } else if (organizationUrl.includes('visualstudio.com')) {
      const match = organizationUrl.match(/([^\.]+)\.visualstudio\.com/);
      organization = match ? match[1] : '';
    }

    if (!organization) {
      return {
        hasConfig: false,
        error: 'Invalid Azure DevOps organization URL format',
      };
    }

    const azureConfig: AzureConfig = {
      organization,
      project: projectName,
      pat,
    };

    const adoService = new AzureDevOpsService(azureConfig);

    // Fetch projects (limit to 10 for context)
    const allProjects = await adoService.getProjects();
    const projects = allProjects.slice(0, 10).map((p: any) => ({
      id: p.id,
      name: p.name,
      description: p.description,
    }));

    // Fetch work items from the configured project
    const workItems = await adoService.getWorkItems(projectName);
    
    // Create work items summary
    const byType: Record<string, number> = {};
    workItems.forEach((item: any) => {
      const type = item.fields?.['System.WorkItemType'] || 'Unknown';
      byType[type] = (byType[type] || 0) + 1;
    });

    // Get recent 10 work items
    const recentItems = workItems.slice(0, 10).map((item: any) => ({
      id: item.id,
      type: item.fields?.['System.WorkItemType'] || 'Unknown',
      title: item.fields?.['System.Title'] || 'Untitled',
      state: item.fields?.['System.State'] || 'Unknown',
    }));

    return {
      hasConfig: true,
      organization,
      project: projectName,
      projects,
      workItemsSummary: {
        total: workItems.length,
        byType,
        recentItems,
      },
    };
  } catch (error) {
    console.error('[ADO Context] Error fetching ADO context:', error);
    return {
      hasConfig: true,
      organization: organizationUrl,
      project: projectName,
      error: error instanceof Error ? error.message : 'Failed to fetch Azure DevOps data',
    };
  }
}

/**
 * Formats ADO context into a string that can be included in the chatbot system prompt
 */
export function formatAdoContextForPrompt(context: AdoContext): string {
  if (!context.hasConfig || context.error) {
    return '';
  }

  let prompt = `\n\n## Azure DevOps Context\n\n`;
  prompt += `You have access to the following Azure DevOps information:\n\n`;
  prompt += `**Organization:** ${context.organization}\n`;
  prompt += `**Current Project:** ${context.project}\n\n`;

  if (context.projects && context.projects.length > 0) {
    prompt += `**Available Projects (${context.projects.length}):**\n`;
    context.projects.forEach((p) => {
      prompt += `- ${p.name}${p.description ? ` - ${p.description}` : ''}\n`;
    });
    prompt += `\n`;
  }

  if (context.workItemsSummary) {
    const { total, byType, recentItems } = context.workItemsSummary;
    prompt += `**Work Items Summary:**\n`;
    prompt += `- Total work items: ${total}\n`;
    
    if (Object.keys(byType).length > 0) {
      prompt += `- By type:\n`;
      Object.entries(byType).forEach(([type, count]) => {
        prompt += `  - ${type}: ${count}\n`;
      });
    }

    if (recentItems.length > 0) {
      prompt += `\n**Recent Work Items:**\n`;
      recentItems.forEach((item) => {
        prompt += `- #${item.id} (${item.type}) - ${item.title} [${item.state}]\n`;
      });
    }
  }

  prompt += `\n**Instructions:**\n`;
  prompt += `- When users ask about Azure DevOps, use this context to provide accurate information\n`;
  prompt += `- You can reference specific work items, projects, and statistics from the data above\n`;
  prompt += `- If asked about something not in this context, suggest checking the Azure DevOps portal directly\n`;
  prompt += `- Keep responses focused on the user's SDLC workflow needs\n`;

  return prompt;
}
