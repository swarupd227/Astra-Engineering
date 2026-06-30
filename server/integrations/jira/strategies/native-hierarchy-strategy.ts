import type { JiraService } from '../jira-service';
import { convertToADF } from '../jira-mappers';
import {
  HierarchyStrategy,
  HierarchyCapability,
  IssueKey,
  EpicTree,
  JiraArtifact,
  PushOpts,
  DevxEpic,
  DevxFeature,
  DevxUserStory,
  DevxTask,
  DevxTestCase,
  buildLabels,
  extractDevxTier,
  classifyByIssueTypeName,
  createIssueWithReporterFallback,
} from './hierarchy-strategy';

/**
 * NATIVE_4_TIER strategy for Jira Premium / Enterprise.
 *
 * Parent chain mirrors DevX's 4-tier model exactly:
 *   Epic → Feature (parent=Epic) → User Story (parent=Feature) →
 *   Task/Sub-task (parent=Story)  |  Test Case (parent=Story)
 *
 * Labels are STILL written (non-negotiable) for:
 *   - Plan downgrade protection
 *   - Instance migration
 *   - Auditability
 *   - Unified read path (label-based fallback)
 */
export class NativeHierarchyStrategy implements HierarchyStrategy {
  readonly mode = 'NATIVE_4_TIER' as const;
  private jira: JiraService;
  private cap: HierarchyCapability;

  constructor(jira: JiraService, cap: HierarchyCapability) {
    this.jira = jira;
    this.cap = cap;
  }

  private pk(): string { return this.jira.getProjectKey(); }

  private issueTypeField(typeId: string | undefined, fallbackName: string): { id: string } | { name: string } {
    return typeId ? { id: typeId } : { name: fallbackName };
  }

  // ── PUSH ──

  async createEpic(epic: DevxEpic, opts?: PushOpts): Promise<IssueKey> {
    const labels = buildLabels('epic', {});
    const fieldMapping = opts?.fieldMapping || await this.jira.getFieldMapping();

    const payload: any = {
      fields: {
        project: { key: this.pk() },
        summary: epic.title,
        description: epic.description ? convertToADF(epic.description) : undefined,
        issuetype: this.issueTypeField(this.cap.issueTypeIdMap.epic, this.cap.issueTypeNameMap?.epic || 'Epic'),
        labels,
      },
    };

    if (epic.priority) payload.fields.priority = { name: epic.priority };
    if (opts?.assigneeAccountId) payload.fields.assignee = { accountId: opts.assigneeAccountId };
    if (opts?.reporterAccountId) payload.fields.reporter = { accountId: opts.reporterAccountId };
    if (fieldMapping.epicNameFieldId && fieldMapping.epicNameFieldId.trim() && fieldMapping.epicNameFieldId !== 'NOT_FOUND') {
      // Check if the field is available for Epic issue type
      const isFieldAvailable = await this.jira.isFieldAvailableForIssueType(fieldMapping.epicNameFieldId, this.cap.issueTypeNameMap?.epic || 'Epic');
      if (isFieldAvailable) {
        console.log(`[NativeStrategy] Setting epic name: field=${fieldMapping.epicNameFieldId}, value=${epic.title}`);
        payload.fields[fieldMapping.epicNameFieldId] = epic.title;
      } else {
        console.log(`[NativeStrategy] Skipping epic name - field not available on Epic screen: ${fieldMapping.epicNameFieldId}`);
      }
    } else {
      console.log(`[NativeStrategy] Skipping epic name - invalid field ID: ${fieldMapping.epicNameFieldId}`);
    }

    console.log(`[NativeStrategy] Creating Epic payload:`, JSON.stringify(payload, null, 2));
    const created = await createIssueWithReporterFallback(this.jira, payload);
    console.log(`[NativeStrategy] Created Epic "${epic.title}" → ${created.key}`);
    return created.key;
  }

  async createFeature(feature: DevxFeature, epicKey: IssueKey, opts?: PushOpts): Promise<IssueKey> {
    const labels = buildLabels('feature', { epicKey });

    const payload: any = {
      fields: {
        project: { key: this.pk() },
        summary: feature.title,
        description: feature.description ? convertToADF(feature.description) : undefined,
        issuetype: this.issueTypeField(this.cap.issueTypeIdMap.feature, this.cap.issueTypeNameMap?.feature || 'Feature'),
        parent: { key: epicKey },
        labels,
      },
    };

    if (feature.priority) payload.fields.priority = { name: feature.priority };
    if (opts?.assigneeAccountId) payload.fields.assignee = { accountId: opts.assigneeAccountId };
    if (opts?.reporterAccountId) payload.fields.reporter = { accountId: opts.reporterAccountId };

    console.log(`[NativeStrategy] Creating Feature payload:`, JSON.stringify(payload, null, 2));
    const created = await createIssueWithReporterFallback(this.jira, payload);
    console.log(`[NativeStrategy] Created Feature "${feature.title}" → ${created.key} (parent: ${epicKey})`);
    return created.key;
  }

  async createUserStory(
    story: DevxUserStory,
    epicKey: IssueKey,
    featureKey: IssueKey,
    opts?: PushOpts
  ): Promise<IssueKey> {
    const labels = buildLabels('story', { epicKey: epicKey || undefined, featureKey: featureKey || undefined });
    const fieldMapping = opts?.fieldMapping || await this.jira.getFieldMapping();

    let description = story.description || '';
    if (story.persona) description += `\n\n**Persona:** ${story.persona}`;
    if (story.acceptanceCriteria?.length) {
      description += `\n\n**Acceptance Criteria:**\n`;
      story.acceptanceCriteria.forEach((ac: any, i: number) => {
        if (typeof ac === 'string') description += `${i + 1}. ${ac}\n`;
        else if (ac?.title && ac.title !== 'undefined') description += `${i + 1}. ${ac.title}\n`;
        else if (ac?.given && ac?.when && ac?.then) {
          const parts = [ac.given, ac.when, ac.then].filter((p: string) => p && p !== 'undefined');
          if (parts.length) description += `${i + 1}. ${parts.join(' - ')}\n`;
        } else if (ac?.description && ac.description !== 'undefined') description += `${i + 1}. ${ac.description}\n`;
      });
    }

    const payload: any = {
      fields: {
        project: { key: this.pk() },
        summary: story.title,
        description: description ? convertToADF(description) : undefined,
        issuetype: this.issueTypeField(this.cap.issueTypeIdMap.userStory, this.cap.issueTypeNameMap?.userStory || 'Story'),
        labels,
      },
    };

    if (featureKey) payload.fields.parent = { key: featureKey };

    if (story.priority) payload.fields.priority = { name: story.priority };
    if (story.storyPoints && fieldMapping.storyPointsFieldId && fieldMapping.storyPointsFieldId.trim() && fieldMapping.storyPointsFieldId !== 'NOT_FOUND') {
      // Check if the field is available for User Story issue type
      const isFieldAvailable = await this.jira.isFieldAvailableForIssueType(fieldMapping.storyPointsFieldId, this.cap.issueTypeNameMap?.userStory || 'Story');
      if (isFieldAvailable) {
        console.log(`[NativeStrategy] Setting story points: field=${fieldMapping.storyPointsFieldId}, value=${story.storyPoints}`);
        payload.fields[fieldMapping.storyPointsFieldId] = story.storyPoints;
      } else {
        console.log(`[NativeStrategy] Skipping story points - field not available on User Story screen: ${fieldMapping.storyPointsFieldId}`);
      }
    } else if (story.storyPoints) {
      console.log(`[NativeStrategy] Skipping story points - invalid field ID: ${fieldMapping.storyPointsFieldId}`);
    }
    if (opts?.assigneeAccountId) payload.fields.assignee = { accountId: opts.assigneeAccountId };
    if (opts?.reporterAccountId) payload.fields.reporter = { accountId: opts.reporterAccountId };

    console.log(`[NativeStrategy] Creating Story payload:`, JSON.stringify(payload, null, 2));
    
    let created: { key: string } | null = null;
    let currentPayload = { ...payload };
    let epicLinkDropped = !featureKey;

    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        created = await this.jira.apiRequest<{ key: string }>('/issue', { method: 'POST', body: JSON.stringify(currentPayload) });
        console.log(`[NativeStrategy] Created Story "${story.title}" → ${created.key} on attempt ${attempt}`);
        break;
      } catch (error: any) {
        const msg = String(error?.message || '');
        console.warn(`[NativeStrategy] Story create attempt ${attempt} failed: ${msg}`);
        if (attempt === 3) throw error;

        let modified = false;
        if (/reporter/i.test(msg) && currentPayload.fields.reporter) {
          delete currentPayload.fields.reporter;
          console.log(`[NativeStrategy] Retrying Story creation without explicit reporter (field rejected)...`);
          modified = true;
        } else if (/parentId|hierarchy|appropriate hierarchy/i.test(msg) && currentPayload.fields.parent) {
          delete currentPayload.fields.parent;
          if (featureKey && fieldMapping.epicLinkFieldId && fieldMapping.epicLinkFieldId !== 'NOT_FOUND') {
            currentPayload.fields[fieldMapping.epicLinkFieldId] = featureKey;
            console.log(`[NativeStrategy] Retrying Story creation with Epic Link instead of parent...`);
          } else {
            epicLinkDropped = true;
            console.log(`[NativeStrategy] Retrying Story creation without parent...`);
          }
          modified = true;
        } else if (/must be of type 'Epic'/i.test(msg) || (msg.includes('customfield_') && msg.includes('cannot be set'))) {
          if (/must be of type 'Epic'/i.test(msg) && fieldMapping.epicLinkFieldId && currentPayload.fields[fieldMapping.epicLinkFieldId]) {
            delete currentPayload.fields[fieldMapping.epicLinkFieldId];
            epicLinkDropped = true;
            console.log(`[NativeStrategy] Retrying Story creation without epic link field (target is not an epic)...`);
            modified = true;
          } else if (fieldMapping.storyPointsFieldId && currentPayload.fields[fieldMapping.storyPointsFieldId]) {
            delete currentPayload.fields[fieldMapping.storyPointsFieldId];
            console.log(`[NativeStrategy] Retrying Story creation without story points field...`);
            modified = true;
          } else if (fieldMapping.epicLinkFieldId && currentPayload.fields[fieldMapping.epicLinkFieldId] && msg.includes(fieldMapping.epicLinkFieldId)) {
            delete currentPayload.fields[fieldMapping.epicLinkFieldId];
            epicLinkDropped = true;
            console.log(`[NativeStrategy] Retrying Story creation without epic link field...`);
            modified = true;
          }
        }
        
        if (!modified) throw error;
      }
    }
    if (!created) throw new Error('Creation failed after retries');

    if (epicLinkDropped && featureKey) {
      console.log(`[NativeStrategy] Warning: Story ${created.key} could not be hierarchically linked to Epic Anchor ${featureKey} natively, and fallback linking is unsupported in Native mode. Ensure Jira is properly configured with an Epic hierarchy.`);
    }

    return created.key;
  }

  async createTask(task: DevxTask, epicKey: IssueKey, storyKey: IssueKey, opts?: PushOpts): Promise<IssueKey> {
    const labels = buildLabels('task', { epicKey: epicKey || undefined, storyKey });

    const payload: any = {
      fields: {
        project: { key: this.pk() },
        summary: task.title,
        description: task.description ? convertToADF(task.description) : undefined,
        issuetype: this.issueTypeField(this.cap.issueTypeIdMap.subtask, this.cap.issueTypeNameMap?.subtask || 'Sub-task'),
        parent: { key: storyKey },
        labels,
      },
    };

    if (opts?.assigneeAccountId) payload.fields.assignee = { accountId: opts.assigneeAccountId };
    if (opts?.reporterAccountId) payload.fields.reporter = { accountId: opts.reporterAccountId };

    const created = await createIssueWithReporterFallback(this.jira, payload);
    console.log(`[NativeStrategy] Created Task "${task.title}" → ${created.key} (parent: ${storyKey})`);
    return created.key;
  }

  async createTestCase(tc: DevxTestCase, epicKey: IssueKey, storyKey: IssueKey, opts?: PushOpts): Promise<IssueKey> {
    const labels = buildLabels('testcase', { epicKey: epicKey || undefined, storyKey });

    let description = '';
    if (tc.steps?.length) {
      description = '**Test Steps:**\n';
      tc.steps.forEach((step, i) => {
        const num = step.step ?? i + 1;
        if (step.action || step.result) {
          description += `${num}. ${step.action || ''}${step.result ? ` → ${step.result}` : ''}\n`;
        }
      });
    }
    if (tc.expectedResult) description += `\n**Expected Result:** ${tc.expectedResult}`;

    const payload: any = {
      fields: {
        project: { key: this.pk() },
        summary: tc.title,
        description: description ? convertToADF(description) : convertToADF(`Test case for ${storyKey}`),
        issuetype: this.issueTypeField(this.cap.issueTypeIdMap.testCase, this.cap.issueTypeNameMap?.testCase || 'Test Cases'),
        labels,
      },
    };

    if (storyKey) payload.fields.parent = { key: storyKey };

    if (opts?.assigneeAccountId) payload.fields.assignee = { accountId: opts.assigneeAccountId };
    if (opts?.reporterAccountId) payload.fields.reporter = { accountId: opts.reporterAccountId };

    const created = await createIssueWithReporterFallback(this.jira, payload);
    console.log(`[NativeStrategy] Created TestCase "${tc.title}" → ${created.key} (parent: ${storyKey})`);
    return created.key;
  }

  // ── READ ──

  async getBacklogTreeForEpic(epicKey: IssueKey): Promise<EpicTree> {
    const pk = this.pk();

    // Fetch all descendants of this epic (up to 3 levels deep)
    const epicIssue = await this.jira.apiRequest<any>(`/issue/${epicKey}?fields=summary,description,status,priority,assignee,labels,issuetype,issuelinks,created`);
    const epicArtifact = this.mapToArtifact(epicIssue);

    // Level 1: direct children of Epic (Features)
    const l1Issues = await this.fetchChildren(epicKey);
    // Level 2: children of Features (Stories)
    const l2Map = new Map<string, any[]>();
    for (const l1 of l1Issues) {
      const children = await this.fetchChildren(l1.key);
      l2Map.set(l1.key, children);
    }
    // Level 3: children of Stories (Tasks, Test Cases)
    const l3Map = new Map<string, any[]>();
    for (const [, l2Issues] of l2Map) {
      for (const l2 of l2Issues) {
        const children = await this.fetchChildren(l2.key);
        l3Map.set(l2.key, children);
      }
    }

    // Build tree
    const features: EpicTree['features'] = [];
    const _orphanStories: JiraArtifact[] = [];
    const _orphanTasks: JiraArtifact[] = [];
    const _orphanTestCases: JiraArtifact[] = [];

    for (const l1Issue of l1Issues) {
      const l1Artifact = this.mapToArtifact(l1Issue);
      const tier = extractDevxTier(l1Issue.fields?.labels || []) || classifyByIssueTypeName(l1Issue.fields?.issuetype?.name || '');

      if (tier === 'feature') {
        const storiesForFeature: EpicTree['features'][number]['stories'] = [];
        const l2Issues = l2Map.get(l1Issue.key) || [];

        for (const l2Issue of l2Issues) {
          const l2Artifact = this.mapToArtifact(l2Issue);
          const l2Tier = extractDevxTier(l2Issue.fields?.labels || []) || classifyByIssueTypeName(l2Issue.fields?.issuetype?.name || '');

          if (l2Tier === 'story') {
            const l3Issues = l3Map.get(l2Issue.key) || [];
            const storyTasks: JiraArtifact[] = [];
            const storyTestCases: JiraArtifact[] = [];

            for (const l3Issue of l3Issues) {
              const l3Artifact = this.mapToArtifact(l3Issue);
              const l3Tier = extractDevxTier(l3Issue.fields?.labels || []) || classifyByIssueTypeName(l3Issue.fields?.issuetype?.name || '');
              if (l3Tier === 'testcase') storyTestCases.push(l3Artifact);
              else storyTasks.push(l3Artifact);
            }

            storiesForFeature.push({ ...l2Artifact, tasks: storyTasks, testCases: storyTestCases });
          } else if (l2Tier === 'task') {
            _orphanTasks.push(l2Artifact);
          } else if (l2Tier === 'testcase') {
            _orphanTestCases.push(l2Artifact);
          } else {
            _orphanStories.push(l2Artifact);
          }
        }

        features.push({ ...l1Artifact, stories: storiesForFeature });
      } else if (tier === 'story') {
        const l2Issues = l2Map.get(l1Issue.key) || [];
        const storyTasks: JiraArtifact[] = [];
        const storyTestCases: JiraArtifact[] = [];
        for (const l2Issue of l2Issues) {
          const l2Artifact = this.mapToArtifact(l2Issue);
          const l2Tier = extractDevxTier(l2Issue.fields?.labels || []) || classifyByIssueTypeName(l2Issue.fields?.issuetype?.name || '');
          if (l2Tier === 'testcase') storyTestCases.push(l2Artifact);
          else storyTasks.push(l2Artifact);
        }
        _orphanStories.push({ ...l1Artifact });
      } else {
        _orphanStories.push(l1Artifact);
      }
    }

    return { epic: epicArtifact, features, _orphanStories, _orphanTasks, _orphanTestCases };
  }

  private async fetchChildren(parentKey: string): Promise<any[]> {
    const pk = this.pk();
    const jql = `project = "${pk}" AND parent = "${parentKey}" ORDER BY issuetype`;
    let allIssues: any[] = [];
    let startAt = 0;
    const maxResults = 200;

    while (true) {
      const resp = await this.jira.apiRequest<{ issues: any[]; total: number }>('/search/jql', {
        method: 'POST',
        body: JSON.stringify({
          jql,
          startAt,
          maxResults,
          fields: ['summary', 'description', 'status', 'priority', 'assignee', 'labels', 'issuetype', 'issuelinks', 'parent', 'created'],
        }),
      });
      const issues = resp.issues || [];
      allIssues = allIssues.concat(issues);
      if (issues.length < maxResults || allIssues.length >= resp.total) break;
      startAt += maxResults;
    }
    return allIssues;
  }

  private mapToArtifact(issue: any): JiraArtifact {
    const f = issue.fields || {};
    return {
      key: issue.key || '',
      id: issue.id || '',
      summary: f.summary || '',
      description: typeof f.description === 'string' ? f.description : '',
      status: f.status?.name || '',
      priority: f.priority?.name || '',
      assignee: f.assignee?.displayName || f.assignee?.emailAddress || null,
      storyPoints: null,
      labels: f.labels || [],
      issuetype: { id: f.issuetype?.id || '', name: f.issuetype?.name || '' },
      adoUrl: `${this.jira.getInstanceUrl()}/browse/${issue.key || ''}`,
      createdAt: f.created || '',
      issuelinks: f.issuelinks || [],
      parentKey: f.parent?.key,
    };
  }
}
