/**
 * Jira Push Service
 * Handles pushing work items (epics, features, stories) to Jira.
 * Delegates to HierarchyStrategy for type-correct issue creation.
 */

import { JiraService } from './jira-service';
import { JiraConfig } from './jira-types';
import type { Epic, Feature, UserStory, Persona } from '@shared/schema';
import type { PushReport, PushReportEntry, PushOpts } from './strategies/hierarchy-strategy';

export interface PushedByUser {
  email: string;
  displayName?: string;
}

export interface PushWorkItemsOptions {
  createSubtasks?: boolean;
  createTestCases?: boolean;
  skipDuplicateCheck?: boolean;
  brdId?: string | null;
  requirementIds?: string[];
  pushedBy?: PushedByUser;
  onProgress?: (percent: number, message: string) => void;
}

export interface PushWorkItemsResult {
  workItemIds: string[];
  url: string;
  createdItems: Array<{
    type: 'Epic' | 'Feature' | 'User Story' | 'Subtask' | 'Task' | 'TestCase' | 'epic' | 'feature' | 'story' | 'subtask' | 'task' | 'testcase';
    id: string;
    title: string;
    jiraIssueId: string;
  }>;
  skippedItems: Array<{
    type: 'Epic' | 'Feature' | 'User Story' | 'Subtask' | 'Task' | 'TestCase' | 'epic' | 'feature' | 'story' | 'subtask' | 'task' | 'testcase';
    id: string;
    title: string;
    jiraIssueId: string;
    reason: string;
  }>;
  failedItems: Array<{
    type: 'Epic' | 'Feature' | 'User Story' | 'Subtask' | 'Task' | 'TestCase' | 'epic' | 'feature' | 'story' | 'subtask' | 'task' | 'testcase';
    id: string;
    title: string;
    error: string;
  }>;
  errors: string[];
  testCasesCreated: number;
  subtasksCreated: number;
  report?: PushReport;
  browseUrls?: string[];
}

export class JiraPushService {
  private jiraService: JiraService;
  private config: JiraConfig;

  constructor(jiraService: JiraService) {
    this.jiraService = jiraService;
    this.config = (jiraService as any).config;

    if (!this.config || !this.config.projectKey || this.config.projectKey === 'undefined') {
      console.error('[JiraPushService] Invalid config:', {
        hasConfig: !!this.config,
        projectKey: this.config?.projectKey,
        instanceUrl: this.config?.instanceUrl,
      });
      throw new Error(`Jira configuration is invalid: projectKey is missing or undefined. Got: ${this.config?.projectKey}`);
    }

    console.log('[JiraPushService] Initialized with projectKey:', this.config.projectKey);
  }

  /**
   * Find work item by title in Jira (duplicate detection).
   * Uses exact summary match to avoid false positives from text-search
   * matching different stories that share common words.
   */
  public async findWorkItemByTitle(title: string, issueType: string): Promise<string | null> {
    try {
      if (!this.config.projectKey || this.config.projectKey === 'undefined') return null;

      const escapedTitle = title.replace(/"/g, '\\"').replace(/\\/g, '\\\\');
      const jql = `project = "${this.config.projectKey}" AND issuetype = "${issueType}" AND summary = "${escapedTitle}"`;

      const response = await (this.jiraService as any).request(
        `/search/jql`,
        {
          method: 'POST',
          body: JSON.stringify({ jql, maxResults: 5, fields: ['summary', 'issuetype'] }),
        }
      ) as { issues: any[] };

      if (response.issues?.length > 0) {
        const exactMatch = response.issues.find(
          (i: any) => i.fields?.summary?.trim().toLowerCase() === title.trim().toLowerCase()
        );
        if (exactMatch) return exactMatch.key;
        return response.issues[0].key;
      }
      return null;
    } catch (error) {
      console.error(`[JiraPushService] Error finding work item by title:`, error);
      return null;
    }
  }

  /**
   * Fetch & cache issue types for the configured project.
   * Exposed for callers that need to inspect available types (e.g., test case type detection).
   */
  public async getProjectIssueTypes(): Promise<Array<{ id: string; name: string; hierarchyLevel?: number; subtask?: boolean }>> {
    try {
      return await (this.jiraService as any).getIssueTypesForProject(this.config.projectKey);
    } catch {
      return [];
    }
  }

  /**
   * Create a Test Case in Jira (public, used by external callers).
   * Delegates to strategy internally. Discovers the parent Epic from the story's
   * parent chain so the strategy can anchor the test case correctly.
   */
  public async createTestCase(
    testCase: { title: string; steps?: Array<{ step?: number; action?: string; result?: string }>; expectedResult?: string },
    parentStoryKey: string
  ): Promise<string> {
    const strat = await this.jiraService.getStrategy();

    let epicKey = '';
    try {
      const storyIssue = await this.jiraService.getWorkItem(parentStoryKey);
      if (storyIssue?.parentId) {
        epicKey = storyIssue.parentId;
      }
    } catch { /* best effort — epicKey will be empty */ }

    return strat.createTestCase(
      { id: '', title: testCase.title, steps: testCase.steps, expectedResult: testCase.expectedResult },
      epicKey,
      parentStoryKey
    );
  }

  /**
   * Push work items to Jira.
   * Delegates to the auto-detected HierarchyStrategy for all issue creation.
   */
  async pushWorkItems(
    selectedItems: Array<{ type: string; id: string }>,
    epics: Epic[],
    features: Feature[],
    userStories: UserStory[],
    personas: Persona[],
    options?: PushWorkItemsOptions
  ): Promise<PushWorkItemsResult> {
    console.log(`[JiraPushService] Starting pushWorkItems for project: ${this.config.projectKey}`);
    console.log(`[JiraPushService] Selected items:`, JSON.stringify(selectedItems));

    const {
      createSubtasks = true,
      createTestCases = false,
      skipDuplicateCheck = false,
      brdId,
      requirementIds = [],
      onProgress,
    } = options || {};

    if (skipDuplicateCheck) {
      console.log(`[JiraPushService] DUPLICATE CHECK DISABLED`);
    }

    const workItemIds: string[] = [];
    const createdItems: PushWorkItemsResult['createdItems'] = [];
    const skippedItems: PushWorkItemsResult['skippedItems'] = [];
    const failedItems: PushWorkItemsResult['failedItems'] = [];
    const errors: string[] = [];
    const epicIdMap = new Map<string, string>();
    const featureIdMap = new Map<string, string>();
    const storyIdMap = new Map<string, string>();
    let testCasesCreated = 0;
    let subtasksCreated = 0;

    const reportEntries: PushReportEntry[] = [];
    const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

    // Resolve strategy
    const strat = await this.jiraService.getStrategy();
    console.log(`[JiraPushService] Using hierarchy strategy: ${strat.mode}`);

    const hierarchyCapability = await this.jiraService.getHierarchyCapability(this.jiraService.getProjectKey());
    const epicIssueTypeName = hierarchyCapability.issueTypeNameMap?.epic || 'Epic';
    const featureIssueTypeName = hierarchyCapability.issueTypeNameMap?.feature || 'Feature';
    const storyIssueTypeName = hierarchyCapability.issueTypeNameMap?.userStory || 'User Story';
    const testCaseIssueTypeName = hierarchyCapability.issueTypeNameMap?.testCase || 'Test Cases';

    // Attribution split:
    //   Reporter = the person performing the push (so multi-user pushes are
    //              credited to the real person, not whoever owns the token).
    //   Assignee = the admin / authenticating Jira account (the connection
    //              account that the push runs as).
    // Reporter does NOT require assignable permission, so it is set purely from
    // the resolved pusher account.
    let assigneeAccountId: string | null = null;
    let reporterAccountId: string | null = null;

    // ── Reporter: the pushing user ──
    const pushedBy = options?.pushedBy;
    if (pushedBy?.email) {
      try {
        const jiraUser = await this.jiraService.findUserByEmail(pushedBy.email);
        if (jiraUser) {
          reporterAccountId = jiraUser.accountId;
          console.log(`[JiraPushService] Reporter resolved to pusher: ${jiraUser.displayName} (${jiraUser.accountId})`);
        } else {
          console.warn(`[JiraPushService] No Jira account found for pusher email ${pushedBy.email}; reporter will default to the authenticating account.`);
        }
      } catch (err) {
        console.warn(`[JiraPushService] Could not resolve reporter (pusher) account:`, err instanceof Error ? err.message : err);
      }
    }

    // ── Assignee: the admin / authenticating connection account ──
    try {
      const adminUser = await this.jiraService.getCurrentUser();
      if (adminUser?.accountId) {
        assigneeAccountId = adminUser.accountId;
        console.log(`[JiraPushService] Assignee set to admin/connection account: ${adminUser.displayName} (${adminUser.accountId})`);

        // Best-effort assignable check: only clear if Jira positively reports a
        // candidate list that excludes the admin. If verification is
        // inconclusive (empty result or error) we keep the admin assignee,
        // since admin accounts are normally assignable.
        try {
          const query = adminUser.emailAddress || adminUser.displayName || '';
          const assignable = await this.jiraService.getAssignableUsers(this.config.projectKey, query, 50);
          if (Array.isArray(assignable) && assignable.length > 0 && !assignable.some((u: any) => u.accountId === assigneeAccountId)) {
            console.log(`[JiraPushService] Admin account ${assigneeAccountId} not assignable in ${this.config.projectKey}; leaving issues unassigned.`);
            assigneeAccountId = null;
          }
        } catch (verifyErr) {
          console.warn(`[JiraPushService] Could not verify admin assignability; keeping admin as assignee:`, verifyErr instanceof Error ? verifyErr.message : verifyErr);
        }
      }
    } catch (err) {
      console.warn(`[JiraPushService] Could not resolve admin/connection account for assignee:`, err instanceof Error ? err.message : err);
    }

    const fieldMapping = await this.jiraService.getFieldMapping();
    const pushOpts: PushOpts = { assigneeAccountId, reporterAccountId, fieldMapping };

    // Pre-populate maps from existing Jira IDs
    for (const epic of epics) {
      if ((epic as any).jiraIssueId) epicIdMap.set(epic.id, (epic as any).jiraIssueId);
    }
    for (const feature of features) {
      if ((feature as any).jiraIssueId) featureIdMap.set(feature.id, (feature as any).jiraIssueId);
    }

    const selectedEpicIdsSet = new Set(selectedItems.filter(i => i.type === 'epic').map(i => i.id));
    const selectedFeatureIdsSet = new Set(selectedItems.filter(i => i.type === 'feature').map(i => i.id));
    const selectedStoryIds = selectedItems.filter(i => i.type === 'story' || i.type === 'user-story').map(i => i.id);

    for (const selectedStoryId of selectedStoryIds) {
      const story = userStories.find((s) => s.id === selectedStoryId);
      if (story?.featureId) selectedFeatureIdsSet.add(story.featureId);
    }

    for (const selectedFeatureId of selectedFeatureIdsSet) {
      const feature = features.find((f) => f.id === selectedFeatureId);
      if (feature?.epicId) selectedEpicIdsSet.add(feature.epicId);
    }

    const selectedEpicIds = Array.from(selectedEpicIdsSet);
    const selectedFeatureIds = Array.from(selectedFeatureIdsSet);

    console.log(
      `[JiraPushService] Selection with ancestors: ${selectedEpicIds.length} epic(s), ${selectedFeatureIds.length} feature(s), ${selectedStoryIds.length} story/stories`,
    );

    // ── STEP 1: Epics ──
    console.log(`[JiraPushService] Processing ${selectedEpicIds.length} epic(s)...`);

    for (let i = 0; i < selectedEpicIds.length; i++) {
      const epicId = selectedEpicIds[i];
      const epic = epics.find(e => e.id === epicId);
      if (!epic) continue;

      if (onProgress) {
        onProgress(10 + (i / selectedEpicIds.length) * 20, `Processing Epic: ${epic.title} (${i + 1}/${selectedEpicIds.length})`);
      }

      if (!skipDuplicateCheck) {
        if ((epic as any).jiraIssueId) {
          skippedItems.push({ type: 'Epic', id: epic.id, title: epic.title, jiraIssueId: (epic as any).jiraIssueId, reason: 'already_exists' });
          epicIdMap.set(epicId, (epic as any).jiraIssueId);
          reportEntries.push({ artifactType: 'epic', devxId: epic.id, title: epic.title, status: 'skipped', jiraKey: (epic as any).jiraIssueId });
          continue;
        }
        const existingKey = await this.findWorkItemByTitle(epic.title, epicIssueTypeName);
        if (existingKey) {
          skippedItems.push({ type: 'Epic', id: epic.id, title: epic.title, jiraIssueId: existingKey, reason: 'already_exists' });
          epicIdMap.set(epicId, existingKey);
          reportEntries.push({ artifactType: 'epic', devxId: epic.id, title: epic.title, status: 'skipped', jiraKey: existingKey });
          continue;
        }
      }

      try {
        const jiraKey = await strat.createEpic(
          { id: epic.id, title: epic.title, description: epic.description || '', priority: epic.priority },
          pushOpts
        );
        epicIdMap.set(epicId, jiraKey);
        workItemIds.push(jiraKey);
        createdItems.push({ type: 'Epic', id: epic.id, title: epic.title, jiraIssueId: jiraKey });
        reportEntries.push({ artifactType: 'epic', devxId: epic.id, title: epic.title, status: 'created', jiraKey });
        await delay(200);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        failedItems.push({ type: 'Epic', id: epic.id, title: epic.title, error: msg });
        errors.push(`Epic "${epic.title}": ${msg}`);
        reportEntries.push({ artifactType: 'epic', devxId: epic.id, title: epic.title, status: 'failed', error: msg });
      }
    }

    // ── STEP 2: Features ──
    console.log(`[JiraPushService] Processing ${selectedFeatureIds.length} feature(s)...`);

    for (let i = 0; i < selectedFeatureIds.length; i++) {
      const featureId = selectedFeatureIds[i];
      const feature = features.find(f => f.id === featureId);
      if (!feature) continue;

      if (onProgress) {
        onProgress(30 + (i / selectedFeatureIds.length) * 20, `Processing Feature: ${feature.title} (${i + 1}/${selectedFeatureIds.length})`);
      }

      const parentEpicKey = feature.epicId ? epicIdMap.get(feature.epicId) : undefined;

      if (!skipDuplicateCheck) {
        if ((feature as any).jiraIssueId) {
          skippedItems.push({ type: 'Feature', id: feature.id, title: feature.title, jiraIssueId: (feature as any).jiraIssueId, reason: 'already_exists' });
          featureIdMap.set(featureId, (feature as any).jiraIssueId);
          reportEntries.push({ artifactType: 'feature', devxId: feature.id, title: feature.title, status: 'skipped', jiraKey: (feature as any).jiraIssueId });
          continue;
        }
        const existingKey = await this.findWorkItemByTitle(feature.title, featureIssueTypeName);
        if (existingKey) {
          skippedItems.push({ type: 'Feature', id: feature.id, title: feature.title, jiraIssueId: existingKey, reason: 'already_exists' });
          featureIdMap.set(featureId, existingKey);
          reportEntries.push({ artifactType: 'feature', devxId: feature.id, title: feature.title, status: 'skipped', jiraKey: existingKey });
          continue;
        }
      }

      if (!parentEpicKey) {
        const msg = `No parent Epic key found for Feature "${feature.title}" (epicId: ${feature.epicId})`;
        console.warn(`[JiraPushService] ${msg}`);
        failedItems.push({ type: 'Feature', id: feature.id, title: feature.title, error: msg });
        errors.push(msg);
        reportEntries.push({ artifactType: 'feature', devxId: feature.id, title: feature.title, status: 'failed', error: msg });
        continue;
      }

      try {
        const jiraKey = await strat.createFeature(
          { id: feature.id, title: feature.title, description: feature.description || '', priority: feature.priority, epicId: feature.epicId },
          parentEpicKey,
          pushOpts
        );
        featureIdMap.set(featureId, jiraKey);
        workItemIds.push(jiraKey);
        createdItems.push({ type: 'Feature', id: feature.id, title: feature.title, jiraIssueId: jiraKey });
        reportEntries.push({ artifactType: 'feature', devxId: feature.id, title: feature.title, status: 'created', jiraKey });
        await delay(200);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        failedItems.push({ type: 'Feature', id: feature.id, title: feature.title, error: msg });
        errors.push(`Feature "${feature.title}": ${msg}`);
        reportEntries.push({ artifactType: 'feature', devxId: feature.id, title: feature.title, status: 'failed', error: msg });
      }
    }

    // ── STEP 3: User Stories ──
    console.log(`[JiraPushService] Processing ${selectedStoryIds.length} user story/stories...`);

    for (let i = 0; i < selectedStoryIds.length; i++) {
      const storyId = selectedStoryIds[i];
      const story = userStories.find(s => s.id === storyId);
      if (!story) continue;

      if (onProgress) {
        onProgress(50 + (i / selectedStoryIds.length) * 30, `Processing Story: ${story.title} (${i + 1}/${selectedStoryIds.length})`);
      }

      // Resolve parent feature key
      let parentFeatureKey: string | undefined;
      if (story.featureId) {
        const parentFeature = features.find(f => f.id === story.featureId);
        if (parentFeature) {
          parentFeatureKey = featureIdMap.get(parentFeature.id);
          if (!parentFeatureKey) {
            try {
              const existing = await this.findWorkItemByTitle(parentFeature.title, featureIssueTypeName);
              if (existing) {
                parentFeatureKey = existing;
                featureIdMap.set(parentFeature.id, existing);
              }
            } catch { /* non-fatal */ }
          }
        }
      }

      // Resolve parent epic key
      let parentEpicKey: string | undefined;
      if (story.featureId) {
        const parentFeature = features.find(f => f.id === story.featureId);
        if (parentFeature?.epicId) parentEpicKey = epicIdMap.get(parentFeature.epicId);
      }

      if (!skipDuplicateCheck) {
        if ((story as any).jiraIssueId) {
          skippedItems.push({ type: 'User Story', id: story.id, title: story.title, jiraIssueId: (story as any).jiraIssueId, reason: 'already_exists' });
          storyIdMap.set(storyId, (story as any).jiraIssueId);
          reportEntries.push({ artifactType: 'userStory', devxId: story.id, title: story.title, status: 'skipped', jiraKey: (story as any).jiraIssueId });
          continue;
        }
        const existingKey = await this.findWorkItemByTitle(story.title, storyIssueTypeName);
        if (existingKey) {
          skippedItems.push({ type: 'User Story', id: story.id, title: story.title, jiraIssueId: existingKey, reason: 'already_exists' });
          storyIdMap.set(storyId, existingKey);
          reportEntries.push({ artifactType: 'userStory', devxId: story.id, title: story.title, status: 'skipped', jiraKey: existingKey });
          continue;
        }
      }

      try {
        const jiraStoryKey = await strat.createUserStory(
          {
            id: story.id,
            title: story.title,
            description: story.description || '',
            priority: story.priority,
            storyPoints: story.storyPoints,
            featureId: story.featureId,
            persona: story.persona,
            acceptanceCriteria: story.acceptanceCriteria as any[],
          },
          parentEpicKey || '',
          parentFeatureKey || '',
          pushOpts
        );
        storyIdMap.set(storyId, jiraStoryKey);
        workItemIds.push(jiraStoryKey);
        createdItems.push({ type: 'User Story', id: story.id, title: story.title, jiraIssueId: jiraStoryKey });
        reportEntries.push({ artifactType: 'userStory', devxId: story.id, title: story.title, status: 'created', jiraKey: jiraStoryKey });

        // ── Tasks / Subtasks ──
        if (createSubtasks && story.subtasks && story.subtasks.length > 0) {
          for (let i = 0; i < story.subtasks.length; i++) {
            const subtask = story.subtasks[i];
            const isTaskObject = typeof subtask === 'object' && subtask !== null && 'title' in subtask;

            if (isTaskObject) {
              const taskObj = subtask as { title: string; subtasks?: string[] };
              const taskTitle = taskObj.title?.trim();
              if (!taskTitle) continue;

              try {
                const taskKey = await strat.createTask(
                  { id: `${story.id}-task-${i}`, title: taskTitle, description: `Task for story ${jiraStoryKey}` },
                  parentEpicKey || '',
                  jiraStoryKey,
                  pushOpts
                );
                subtasksCreated++;
                createdItems.push({ type: 'Task', id: `${story.id}-task-${i}`, title: taskTitle, jiraIssueId: taskKey });
                reportEntries.push({ artifactType: 'task', devxId: `${story.id}-task-${i}`, title: taskTitle, status: 'created', jiraKey: taskKey });
                await delay(200);
              } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                errors.push(`Task "${taskTitle}": ${msg}`);
                reportEntries.push({ artifactType: 'task', devxId: `${story.id}-task-${i}`, title: taskTitle, status: 'failed', error: msg });
              }
            } else {
              const subtaskTitle = typeof subtask === 'string'
                ? subtask
                : ((subtask as any)?.title || (subtask as any)?.description || `Subtask ${i + 1}`);
              const trimmed = String(subtaskTitle).trim();
              if (!trimmed) continue;

              try {
                const subtaskKey = await strat.createTask(
                  { id: `${story.id}-${i}`, title: trimmed },
                  parentEpicKey || '',
                  jiraStoryKey,
                  pushOpts
                );
                subtasksCreated++;
                createdItems.push({ type: 'Task', id: `${story.id}-${i}`, title: trimmed, jiraIssueId: subtaskKey });
                reportEntries.push({ artifactType: 'task', devxId: `${story.id}-${i}`, title: trimmed, status: 'created', jiraKey: subtaskKey });
                await delay(200);
              } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                errors.push(`Task "${trimmed}": ${msg}`);
                reportEntries.push({ artifactType: 'task', devxId: `${story.id}-${i}`, title: trimmed, status: 'failed', error: msg });
              }
            }
          }
        }

        // ── Test Cases ──
        if (createTestCases && (story as any).testCases?.length) {
          const tcs = (story as any).testCases as Array<{ title: string; steps?: any[]; expectedResult?: string }>;
          const uniqueTCs = tcs.filter((tc, idx, self) =>
            tc?.title && self.findIndex(t => t.title === tc.title) === idx
          );

          for (let i = 0; i < uniqueTCs.length; i++) {
            const tc = uniqueTCs[i];
            if (!tc?.title) continue;

            if (!skipDuplicateCheck) {
              const existing = await this.findWorkItemByTitle(tc.title, testCaseIssueTypeName);
              if (existing) {
                skippedItems.push({ type: 'TestCase', id: `${story.id}-tc-${i}`, title: tc.title, jiraIssueId: existing, reason: 'already_exists' });
                reportEntries.push({ artifactType: 'testCase', devxId: `${story.id}-tc-${i}`, title: tc.title, status: 'skipped', jiraKey: existing });
                continue;
              }
            }

            try {
              const tcKey = await strat.createTestCase(
                { id: `${story.id}-tc-${i}`, title: tc.title, steps: tc.steps, expectedResult: tc.expectedResult },
                parentEpicKey || '',
                jiraStoryKey,
                pushOpts
              );
              testCasesCreated++;
              createdItems.push({ type: 'TestCase', id: `${story.id}-tc-${i}`, title: tc.title, jiraIssueId: tcKey });
              reportEntries.push({ artifactType: 'testCase', devxId: `${story.id}-tc-${i}`, title: tc.title, status: 'created', jiraKey: tcKey });
              await delay(200);
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err);
              errors.push(`Test Case "${tc.title}": ${msg}`);
              reportEntries.push({ artifactType: 'testCase', devxId: `${story.id}-tc-${i}`, title: tc.title, status: 'failed', error: msg });
            }
          }
        }

        await delay(200);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        failedItems.push({ type: 'User Story', id: story.id, title: story.title, error: msg });
        errors.push(`Story "${story.title}": ${msg}`);
        reportEntries.push({ artifactType: 'userStory', devxId: story.id, title: story.title, status: 'failed', error: msg });
      }
    }

    // ── User attribution comments ──
    const jiraUrl = `${this.config.instanceUrl}/browse/${this.config.projectKey}`;
    if (pushedBy?.email) {
      const userName = pushedBy.displayName || pushedBy.email;
      const commentText = `This item was generated and pushed by ${userName} (${pushedBy.email}) via Astra Platform on ${new Date().toLocaleString()}.`;
      const primaryTypes = new Set(['Epic', 'Feature', 'User Story']);
      const primaryItems = createdItems.filter(item => primaryTypes.has(item.type));

      for (const item of primaryItems) {
        try {
          await this.jiraService.addComment(item.jiraIssueId, commentText);
        } catch (err) {
          console.warn(`[JiraPushService] Failed to add attribution comment to ${item.jiraIssueId}:`, err instanceof Error ? err.message : err);
        }
      }
      if (primaryItems.length > 0) {
        console.log(`[JiraPushService] Added user attribution comments to ${primaryItems.length} item(s)`);
      }
    }

    const report: PushReport = {
      entries: reportEntries,
      totalCreated: reportEntries.filter(e => e.status === 'created').length,
      totalSkipped: reportEntries.filter(e => e.status === 'skipped').length,
      totalFailed: reportEntries.filter(e => e.status === 'failed').length,
    };

    const cleanInstanceUrl = this.config.instanceUrl.replace(/\/+$/, '');
    const browseUrls = createdItems
      .filter(item => item.jiraIssueId)
      .map(item => `${cleanInstanceUrl}/browse/${item.jiraIssueId}`);

    console.log(`[JiraPushService] Completed: ${createdItems.length} created, ${skippedItems.length} skipped, ${failedItems.length} failed`);
    console.log(`[JiraPushService] Instance: ${cleanInstanceUrl}, Project: ${this.config.projectKey}, Email: ${this.config.email}`);
    if (browseUrls.length > 0) {
      const sample = browseUrls.slice(0, 5);
      console.log(`[JiraPushService] Browse URLs (first ${sample.length}): ${sample.join(', ')}`);
    }

    // Post-push verification: confirm a created issue actually exists in Jira
    if (createdItems.length > 0) {
      const sampleItem = [...createdItems].reverse().find(item => item.jiraIssueId);
      const sampleKey = sampleItem?.jiraIssueId;
      if (sampleKey) {
        try {
          const verification = await this.jiraService.apiRequest<{ key: string; id: string; self: string }>(
            `/issue/${sampleKey}?fields=summary,status`
          );
          if (verification?.key === sampleKey) {
            console.log(`[JiraPushService] VERIFIED: Issue ${sampleKey} exists → ${cleanInstanceUrl}/browse/${sampleKey}`);
          } else {
            console.error(`[JiraPushService] VERIFICATION FAILED: Expected key=${sampleKey} but got key=${verification?.key}`);
          }
        } catch (verifyErr) {
          console.error(`[JiraPushService] VERIFICATION FAILED: Could not read back issue ${sampleKey}:`, verifyErr instanceof Error ? verifyErr.message : verifyErr);
        }
      } else {
        console.warn(`[JiraPushService] Skipping verification: no created items have a valid Jira issue key`);
      }
    }

    return {
      workItemIds,
      url: jiraUrl,
      createdItems,
      skippedItems,
      failedItems,
      errors,
      testCasesCreated,
      subtasksCreated,
      report,
      browseUrls,
    };
  }
}
