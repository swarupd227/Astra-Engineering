/**
 * Jira Design Service
 * Handles design phase operations for Jira projects.
 * getUserStoriesForEpic now uses the HierarchyStrategy tree where possible.
 */

import { JiraService } from './jira-service';
import { JiraConfig } from './jira-types';
import { mapJiraIssueToWorkItem } from './jira-mappers';
import type { WorkItem } from '../base/integration-types';

export class JiraDesignService {
  private jiraService: JiraService;
  private config: JiraConfig;

  constructor(config: JiraConfig) {
    this.config = config;
    this.jiraService = new JiraService(config);
  }

  async getEpics(search?: string): Promise<WorkItem[]> {
    return this.jiraService.getEpics(search);
  }

  /**
   * Get user stories across the project (story-first design flow, no epic).
   */
  async getUserStories(search?: string): Promise<WorkItem[]> {
    return this.jiraService.getUserStories(search);
  }

  /**
   * Get user stories for a specific epic.
   * Tries the strategy tree first; falls back to JQL queries for legacy issues.
   */
  async getUserStoriesForEpic(epicId: string): Promise<WorkItem[]> {
    try {
      const epic = await this.jiraService.getWorkItem(epicId);
      if (!epic) {
        console.warn('[JiraDesignService] Epic/Task not found for id:', epicId);
        return [];
      }

      const epicKey = epic.externalId || epicId;

      // Try strategy-based tree read
      try {
        const strat = await this.jiraService.getStrategy();
        const tree = await strat.getBacklogTreeForEpic(epicKey);
        const fieldMapping = await this.jiraService.getFieldMapping();

        const stories: WorkItem[] = [];
        for (const feature of tree.features) {
          for (const story of feature.stories) {
            stories.push({
              id: story.id,
              title: story.summary,
              description: story.description,
              type: 'User Story',
              status: story.status,
              assignee: story.assignee || undefined,
              storyPoints: story.storyPoints || undefined,
              priority: story.priority || 'medium',
              parentId: feature.key,
              externalId: story.key,
              source: 'Jira',
              createdAt: story.createdAt ? new Date(story.createdAt) : new Date(),
              updatedAt: new Date(),
            });
          }
        }
        for (const orphan of tree._orphanStories) {
          stories.push({
            id: orphan.id,
            title: orphan.summary,
            description: orphan.description,
            type: 'User Story',
            status: orphan.status,
            assignee: orphan.assignee || undefined,
            storyPoints: orphan.storyPoints || undefined,
            priority: orphan.priority || 'medium',
            parentId: epicKey,
            externalId: orphan.key,
            source: 'Jira',
            createdAt: orphan.createdAt ? new Date(orphan.createdAt) : new Date(),
            updatedAt: new Date(),
          });
        }

        if (stories.length > 0) {
          console.log(`[JiraDesignService] Strategy tree returned ${stories.length} stories for epic ${epicKey}`);
          return stories;
        }
      } catch (stratErr) {
        console.warn(`[JiraDesignService] Strategy tree read failed, falling back to JQL:`, stratErr instanceof Error ? stratErr.message : stratErr);
      }

      // Fallback: legacy JQL-based approach
      const fieldMapping = await this.jiraService.getFieldMapping();
      const hasEpic = await this.jiraService.hasEpicType();

      const makeRequest = async (jql: string) => {
        const response = await (this.jiraService as any).request(
          `/search/jql`,
          {
            method: 'POST',
            body: JSON.stringify({ jql, maxResults: 200, fields: ['*all'] }),
          }
        ) as { issues: any[] };
        return response.issues || [];
      };

      let issues: any[] = [];

      if (!hasEpic) {
        const subtaskJql = `project = "${this.config.projectKey}" AND parent = ${epicKey} ORDER BY created DESC`;
        try {
          issues = await makeRequest(subtaskJql);
        } catch (e) {
          console.warn('[JiraDesignService] Sub-task query failed:', e instanceof Error ? e.message : e);
        }
      } else {
        const epicLinkFieldId = fieldMapping?.epicLinkFieldId;
        const modernJql = `project = "${this.config.projectKey}" AND issuetype IN (Story, "User Story") AND parent = ${epicKey} ORDER BY created DESC`;
        const legacyJqlByName = `project = "${this.config.projectKey}" AND issuetype IN (Story, "User Story") AND "Epic Link" = ${epicKey} ORDER BY created DESC`;
        const legacyJqlById = epicLinkFieldId
          ? `project = "${this.config.projectKey}" AND issuetype IN (Story, "User Story") AND ${epicLinkFieldId} = ${epicKey} ORDER BY created DESC`
          : null;

        try { issues = await makeRequest(modernJql); } catch { /* fallthrough */ }
        if (!issues.length) { try { issues = await makeRequest(legacyJqlByName); } catch { /* fallthrough */ } }
        if (!issues.length && legacyJqlById) { try { issues = await makeRequest(legacyJqlById); } catch { /* fallthrough */ } }
      }

      const fieldMappingFull = await this.jiraService.getFieldMapping();
      return issues
        .filter((issue: any) => issue?.fields && issue.id)
        .map((issue: any) => mapJiraIssueToWorkItem(issue, fieldMappingFull));
    } catch (error) {
      console.error('[JiraDesignService] Error fetching user stories for epic:', error);
      return [];
    }
  }

  async getUserStories(): Promise<WorkItem[]> {
    return this.jiraService.getUserStories();
  }

  async getFeatures(): Promise<WorkItem[]> {
    return this.jiraService.getFeatures();
  }

  async getRequirements(): Promise<WorkItem[]> {
    try {
      const jql = `project = "${this.config.projectKey}" AND (issuetype = Requirement OR issuetype = "User Story") ORDER BY created DESC`;
      const response = await (this.jiraService as any).request(
        `/search/jql`,
        {
          method: 'POST',
          body: JSON.stringify({ jql, maxResults: 100, fields: ['*all'] }),
        }
      ) as { issues: any[] };

      const fieldMapping = await this.jiraService.getFieldMapping();
      return (response.issues || [])
        .filter((issue: any) => issue?.fields)
        .map((issue: any) => mapJiraIssueToWorkItem(issue, fieldMapping));
    } catch (error) {
      console.error('[JiraDesignService] Error fetching requirements:', error);
      return [];
    }
  }

  async getWorkItemsForDesignSync() {
    const [epics, features, userStories] = await Promise.all([
      this.getEpics(),
      this.getFeatures(),
      this.getUserStories(),
    ]);
    return { epics, features, userStories };
  }
}
