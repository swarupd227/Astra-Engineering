/**
 * Jira Development Service
 * Handles development phase operations for Jira projects.
 * Methods delegate to JiraService (backward compatible).
 */

import { JiraService } from './jira-service';
import { JiraConfig } from './jira-types';
import { mapJiraIssueToWorkItem } from './jira-mappers';
import type { WorkItem, RepositoryInfo, BuildInfo } from '../base/integration-types';

export class JiraDevelopmentService {
  private jiraService: JiraService;
  private config: JiraConfig;

  constructor(config: JiraConfig) {
    this.config = config;
    this.jiraService = new JiraService(config);
  }

  /**
   * @deprecated Prefer strategy.getBacklogTreeForEpic() + flatten for tree-aware reads.
   */
  async getUserStories(): Promise<WorkItem[]> {
    return this.jiraService.getUserStories();
  }

  async getUserStoriesByStatus(status: string): Promise<WorkItem[]> {
    const stories = await this.getUserStories();
    return stories.filter(story => story.status === status);
  }

  async getUserStoriesByAssignee(assignee: string): Promise<WorkItem[]> {
    const stories = await this.getUserStories();
    return stories.filter(story => story.assignee === assignee);
  }

  async getDevelopmentWorkItems() {
    try {
      const jql = `project = "${this.config.projectKey}" ORDER BY updated DESC`;
      const response = await (this.jiraService as any).request<{ issues: any[] }>(
        `/search/jql`,
        {
          method: 'POST',
          body: JSON.stringify({ jql, maxResults: 200, fields: ['*all'] }),
        }
      );

      const fieldMapping = await this.jiraService.getFieldMapping();
      return (response.issues || []).map((issue: any) =>
        mapJiraIssueToWorkItem(issue, fieldMapping)
      );
    } catch (error) {
      console.error('[JiraDevelopmentService] Error fetching development work items:', error);
      return [];
    }
  }

  async getRepositories(): Promise<RepositoryInfo[]> {
    return [];
  }

  async getSprints() {
    return this.jiraService.getSprints();
  }

  async getSprintWorkItems(sprintId: string): Promise<WorkItem[]> {
    return this.jiraService.getSprintWorkItems(sprintId);
  }

  async getStoryProgress() {
    const stories = await this.getUserStories();
    const total = stories.length;
    const byStatus: Record<string, number> = {};

    stories.forEach(story => {
      const status = story.status || 'Unknown';
      byStatus[status] = (byStatus[status] || 0) + 1;
    });

    return { total, byStatus, stories };
  }

  async getDeveloperAssignments() {
    const stories = await this.getUserStories();
    const assignments: Record<string, {
      total: number;
      byStatus: Record<string, number>;
      storyPoints: number;
    }> = {};

    stories.forEach(story => {
      const assignee = story.assignee || 'Unassigned';
      if (!assignments[assignee]) {
        assignments[assignee] = { total: 0, byStatus: {}, storyPoints: 0 };
      }
      assignments[assignee].total++;
      const status = story.status || 'Unknown';
      assignments[assignee].byStatus[status] = (assignments[assignee].byStatus[status] || 0) + 1;
      assignments[assignee].storyPoints += story.storyPoints || 0;
    });

    return Object.entries(assignments).map(([developer, data]) => ({
      developer,
      ...data,
    }));
  }

  async getVelocityIndicators() {
    const sprints = await this.getSprints();
    const activeSprint = sprints.find(s => s.state === 'active');

    if (!activeSprint) {
      return {
        currentSprint: null,
        velocity: 0,
        completedStoryPoints: 0,
        totalStoryPoints: 0,
      };
    }

    const sprintWorkItems = await this.getSprintWorkItems(activeSprint.id);
    const totalStoryPoints = sprintWorkItems.reduce((sum, item) => sum + (item.storyPoints || 0), 0);
    const completedStoryPoints = sprintWorkItems
      .filter(item => item.status === 'Done' || item.status === 'Closed')
      .reduce((sum, item) => sum + (item.storyPoints || 0), 0);

    return {
      currentSprint: activeSprint,
      velocity: completedStoryPoints,
      completedStoryPoints,
      totalStoryPoints,
      completionRate: totalStoryPoints > 0 ? (completedStoryPoints / totalStoryPoints) * 100 : 0,
    };
  }
}
