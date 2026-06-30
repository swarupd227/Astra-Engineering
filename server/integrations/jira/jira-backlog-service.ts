/**
 * Jira Backlog Service
 * Handles backlog-related operations for Jira projects.
 * Now delegates to HierarchyStrategy for tree-based reads where possible,
 * while keeping backward-compatible flat methods.
 */

import { JiraService } from './jira-service';
import { JiraConfig } from './jira-types';
import type { BacklogContext as BaseBacklogContext } from '../base/integration-types';

export class JiraBacklogService {
  private jiraService: JiraService;

  constructor(config: JiraConfig) {
    this.jiraService = new JiraService(config);
  }

  /**
   * Get backlog context from Jira.
   * Uses the legacy getBacklogContext() which still works.
   */
  async getBacklogContext(): Promise<BaseBacklogContext> {
    return this.jiraService.getBacklogContext();
  }

  /**
   * @deprecated Use strategy.getBacklogTreeForEpic() for tree-structured reads.
   */
  async getEpics() {
    return this.jiraService.getEpics();
  }

  /**
   * @deprecated Use strategy.getBacklogTreeForEpic() for tree-structured reads.
   */
  async getFeatures() {
    return this.jiraService.getFeatures();
  }

  /**
   * @deprecated Use strategy.getBacklogTreeForEpic() for tree-structured reads.
   */
  async getUserStories() {
    return this.jiraService.getUserStories();
  }

  async getWorkItemsByStatus(status: string) {
    const allStories = await this.getUserStories();
    return allStories.filter(item => item.status === status);
  }

  async getWorkItemsByAssignee(assignee: string) {
    const allStories = await this.getUserStories();
    return allStories.filter(item => item.assignee === assignee);
  }
}
