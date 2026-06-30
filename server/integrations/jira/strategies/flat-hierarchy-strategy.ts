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
  extractDevxRelation,
  classifyByIssueTypeName,
  createIssueWithReporterFallback,
} from './hierarchy-strategy';

/**
 * FLAT_3_TIER strategy for Jira Free/Standard.
 *
 * All non-Epic types sit at hierarchyLevel 0, so parent relationships between
 * Feature/Story/TestCase are impossible. Instead we anchor everything to the
 * Epic (L1→L0) and use labels + issue links to reconstruct the 4-tier tree.
 *
 * Push mapping:
 *   Epic         → Epic (no parent)                      labels: devx-tier-epic
 *   Feature      → Feature (parent=Epic)                 labels: devx-tier-feature, devx-epic-<E>
 *   User Story   → User Story (parent=Epic)              link: Relates→Feature  labels: devx-tier-story, devx-epic-<E>, devx-feature-<F>
 *   Task         → Sub-task (parent=Story)               labels: devx-tier-task, devx-epic-<E>, devx-story-<S>
 *   Test Case    → Test Cases (parent=Epic)              link: Tests→Story      labels: devx-tier-testcase, devx-epic-<E>, devx-story-<S>
 */
export class FlatHierarchyStrategy implements HierarchyStrategy {
  readonly mode = 'FLAT_3_TIER' as const;
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

  private async createIssueLinkByName(
    inwardKey: string,
    outwardKey: string,
    linkTypeName: string
  ): Promise<void> {
    try {
      await this.jira.apiRequest('/issueLink', {
        method: 'POST',
        body: JSON.stringify({
          type: { name: linkTypeName },
          inwardIssue: { key: inwardKey },
          outwardIssue: { key: outwardKey },
        }),
      });
    } catch (err) {
      console.warn(`[FlatStrategy] Issue link ${inwardKey}→${outwardKey} (${linkTypeName}) failed:`, err instanceof Error ? err.message : err);
    }
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
        console.log(`[FlatStrategy] Setting epic name: field=${fieldMapping.epicNameFieldId}, value=${epic.title}`);
        payload.fields[fieldMapping.epicNameFieldId] = epic.title;
      } else {
        console.log(`[FlatStrategy] Skipping epic name - field not available on Epic screen: ${fieldMapping.epicNameFieldId}`);
      }
    } else {
      console.log(`[FlatStrategy] Skipping epic name - invalid field ID: ${fieldMapping.epicNameFieldId}`);
    }

    console.log(`[FlatStrategy] Creating Epic payload:`, JSON.stringify(payload, null, 2));
    const created = await createIssueWithReporterFallback(this.jira, payload);
    console.log(`[FlatStrategy] Created Epic "${epic.title}" → ${created.key}`);
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

    const fieldMapping = opts?.fieldMapping || await this.jira.getFieldMapping();
    let created: { key: string } | null = null;
    let currentPayload = { ...payload };
    let epicLinkDropped = !epicKey;

    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        created = await this.jira.apiRequest<{ key: string }>('/issue', { method: 'POST', body: JSON.stringify(currentPayload) });
        console.log(`[FlatStrategy] Created Feature "${feature.title}" → ${created.key} on attempt ${attempt}`);
        break;
      } catch (error: any) {
        const msg = String(error?.message || '');
        console.warn(`[FlatStrategy] Feature create attempt ${attempt} failed: ${msg}`);
        if (attempt === 3) throw error;

        let modified = false;
        if (/reporter/i.test(msg) && currentPayload.fields.reporter) {
          delete currentPayload.fields.reporter;
          console.log(`[FlatStrategy] Retrying Feature creation without explicit reporter (field rejected)...`);
          modified = true;
        } else if (/parentId|hierarchy|appropriate hierarchy/i.test(msg) && currentPayload.fields.parent) {
          delete currentPayload.fields.parent;
          if (epicKey && fieldMapping.epicLinkFieldId && fieldMapping.epicLinkFieldId !== 'NOT_FOUND') {
            currentPayload.fields[fieldMapping.epicLinkFieldId] = epicKey;
            console.log(`[FlatStrategy] Retrying Feature creation with Epic Link instead of parent...`);
          } else {
            epicLinkDropped = true;
            console.log(`[FlatStrategy] Retrying Feature creation without parent...`);
          }
          modified = true;
        } else if (/must be of type 'Epic'/i.test(msg) || (msg.includes('customfield_') && msg.includes('cannot be set'))) {
          if (/must be of type 'Epic'/i.test(msg) && fieldMapping.epicLinkFieldId && currentPayload.fields[fieldMapping.epicLinkFieldId]) {
            delete currentPayload.fields[fieldMapping.epicLinkFieldId];
            epicLinkDropped = true;
            console.log(`[FlatStrategy] Retrying Feature creation without epic link field (target is not an epic)...`);
            modified = true;
          } else if (fieldMapping.epicLinkFieldId && currentPayload.fields[fieldMapping.epicLinkFieldId] && msg.includes(fieldMapping.epicLinkFieldId)) {
            delete currentPayload.fields[fieldMapping.epicLinkFieldId];
            epicLinkDropped = true;
            console.log(`[FlatStrategy] Retrying Feature creation without epic link field...`);
            modified = true;
          }
        }
        
        if (!modified) throw error;
      }
    }
    if (!created) throw new Error('Feature creation failed after retries');

    if (epicLinkDropped && epicKey) {
      const linkType = await this.resolveLinkTypeName('Relates');
      await this.createIssueLinkByName(created.key, epicKey, linkType);
      console.log(`[FlatStrategy] Linked Feature ${created.key} → Epic Anchor ${epicKey} (${linkType} fallback)`);
    }

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

    if (epicKey) payload.fields.parent = { key: epicKey };

    if (story.priority) payload.fields.priority = { name: story.priority };
    if (story.storyPoints && fieldMapping.storyPointsFieldId && fieldMapping.storyPointsFieldId.trim() && fieldMapping.storyPointsFieldId !== 'NOT_FOUND') {
      // Check if the field is available for User Story issue type
      const isFieldAvailable = await this.jira.isFieldAvailableForIssueType(fieldMapping.storyPointsFieldId, this.cap.issueTypeNameMap?.userStory || 'Story');
      if (isFieldAvailable) {
        console.log(`[FlatStrategy] Setting story points: field=${fieldMapping.storyPointsFieldId}, value=${story.storyPoints}`);
        payload.fields[fieldMapping.storyPointsFieldId] = story.storyPoints;
      } else {
        console.log(`[FlatStrategy] Skipping story points - field not available on User Story screen: ${fieldMapping.storyPointsFieldId}`);
      }
    } else if (story.storyPoints) {
      console.log(`[FlatStrategy] Skipping story points - invalid field ID: ${fieldMapping.storyPointsFieldId}`);
    }
    if (opts?.assigneeAccountId) payload.fields.assignee = { accountId: opts.assigneeAccountId };
    if (opts?.reporterAccountId) payload.fields.reporter = { accountId: opts.reporterAccountId };

    console.log(`[FlatStrategy] Creating Story payload:`, JSON.stringify(payload, null, 2));
    
    let created: { key: string } | null = null;
    let currentPayload = { ...payload };
    let epicLinkDropped = !epicKey;

    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        created = await this.jira.apiRequest<{ key: string }>('/issue', { method: 'POST', body: JSON.stringify(currentPayload) });
        console.log(`[FlatStrategy] Created Story "${story.title}" → ${created.key} on attempt ${attempt}`);
        break;
      } catch (error: any) {
        const msg = String(error?.message || '');
        console.warn(`[FlatStrategy] Story create attempt ${attempt} failed: ${msg}`);
        if (attempt === 3) throw error;

        let modified = false;
        if (/reporter/i.test(msg) && currentPayload.fields.reporter) {
          delete currentPayload.fields.reporter;
          console.log(`[FlatStrategy] Retrying Story creation without explicit reporter (field rejected)...`);
          modified = true;
        } else if (/parentId|hierarchy|appropriate hierarchy/i.test(msg) && currentPayload.fields.parent) {
          delete currentPayload.fields.parent;
          if (epicKey && fieldMapping.epicLinkFieldId && fieldMapping.epicLinkFieldId !== 'NOT_FOUND') {
            currentPayload.fields[fieldMapping.epicLinkFieldId] = epicKey;
            console.log(`[FlatStrategy] Retrying Story creation with Epic Link instead of parent...`);
          } else {
            epicLinkDropped = true;
            console.log(`[FlatStrategy] Retrying Story creation without parent...`);
          }
          modified = true;
        } else if (/must be of type 'Epic'/i.test(msg) || (msg.includes('customfield_') && msg.includes('cannot be set'))) {
          if (/must be of type 'Epic'/i.test(msg) && fieldMapping.epicLinkFieldId && currentPayload.fields[fieldMapping.epicLinkFieldId]) {
            delete currentPayload.fields[fieldMapping.epicLinkFieldId];
            epicLinkDropped = true;
            console.log(`[FlatStrategy] Retrying Story creation without epic link field (target is not an epic)...`);
            modified = true;
          } else if (fieldMapping.storyPointsFieldId && currentPayload.fields[fieldMapping.storyPointsFieldId]) {
            delete currentPayload.fields[fieldMapping.storyPointsFieldId];
            console.log(`[FlatStrategy] Retrying Story creation without story points field...`);
            modified = true;
          } else if (fieldMapping.epicLinkFieldId && currentPayload.fields[fieldMapping.epicLinkFieldId] && msg.includes(fieldMapping.epicLinkFieldId)) {
            delete currentPayload.fields[fieldMapping.epicLinkFieldId];
            epicLinkDropped = true;
            console.log(`[FlatStrategy] Retrying Story creation without epic link field...`);
            modified = true;
          }
        }
        
        if (!modified) throw error;
      }
    }
    if (!created) throw new Error('Creation failed after retries');

    const linkType = await this.resolveLinkTypeName('Relates');
    if (featureKey) {
      await this.createIssueLinkByName(created.key, featureKey, linkType);
      console.log(`[FlatStrategy] Linked Story ${created.key} → Feature ${featureKey} (${linkType})`);
    }
    if (epicLinkDropped && epicKey) {
      await this.createIssueLinkByName(created.key, epicKey, linkType);
      console.log(`[FlatStrategy] Linked Story ${created.key} → Epic Anchor ${epicKey} (${linkType} fallback)`);
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

    try {
      const created = await createIssueWithReporterFallback(this.jira, payload);
      console.log(`[FlatStrategy] Created Task "${task.title}" → ${created.key} (parent: ${storyKey})`);
      return created.key;
    } catch (err: any) {
      if (/parentId|hierarchy|sub-task/i.test(String(err?.message || ''))) {
        console.warn(`[FlatStrategy] Sub-task creation failed for Task, retrying as Task type + link...`);
        delete payload.fields.parent;
        payload.fields.issuetype = this.issueTypeField(this.cap.issueTypeIdMap.task, this.cap.issueTypeNameMap?.task || 'Task');
        const created = await createIssueWithReporterFallback(this.jira, payload);
        await this.createIssueLinkByName(created.key, storyKey, 'Relates');
        return created.key;
      }
      throw err;
    }
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

    // Anchor to Epic if available; otherwise the TC is a standalone issue in the project
    if (epicKey) {
      payload.fields.parent = { key: epicKey };
    }

    if (opts?.assigneeAccountId) payload.fields.assignee = { accountId: opts.assigneeAccountId };
    if (opts?.reporterAccountId) payload.fields.reporter = { accountId: opts.reporterAccountId };

    const fieldMapping = opts?.fieldMapping || await this.jira.getFieldMapping();
    let created: { key: string } | null = null;
    let currentPayload = { ...payload };
    let epicLinkDropped = !epicKey;

    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        created = await this.jira.apiRequest<{ key: string }>('/issue', { method: 'POST', body: JSON.stringify(currentPayload) });
        console.log(`[FlatStrategy] Created Test Case "${tc.title}" → ${created.key} on attempt ${attempt}`);
        break;
      } catch (error: any) {
        const msg = String(error?.message || '');
        console.warn(`[FlatStrategy] TestCase create attempt ${attempt} failed: ${msg}`);
        if (attempt === 3) throw error;

        let modified = false;
        if (/reporter/i.test(msg) && currentPayload.fields.reporter) {
          delete currentPayload.fields.reporter;
          console.log(`[FlatStrategy] Retrying TestCase creation without explicit reporter (field rejected)...`);
          modified = true;
        } else if (/parentId|hierarchy|appropriate hierarchy/i.test(msg) && currentPayload.fields.parent) {
          delete currentPayload.fields.parent;
          if (epicKey && fieldMapping.epicLinkFieldId && fieldMapping.epicLinkFieldId !== 'NOT_FOUND') {
            currentPayload.fields[fieldMapping.epicLinkFieldId] = epicKey;
            console.log(`[FlatStrategy] Retrying TestCase creation with Epic Link instead of parent...`);
          } else {
            epicLinkDropped = true;
            console.log(`[FlatStrategy] Retrying TestCase creation without parent...`);
          }
          modified = true;
        } else if (/must be of type 'Epic'/i.test(msg) || (msg.includes('customfield_') && msg.includes('cannot be set'))) {
          if (/must be of type 'Epic'/i.test(msg) && fieldMapping.epicLinkFieldId && currentPayload.fields[fieldMapping.epicLinkFieldId]) {
            delete currentPayload.fields[fieldMapping.epicLinkFieldId];
            epicLinkDropped = true;
            console.log(`[FlatStrategy] Retrying TestCase creation without epic link field (target is not an epic)...`);
            modified = true;
          } else if (fieldMapping.epicLinkFieldId && currentPayload.fields[fieldMapping.epicLinkFieldId] && msg.includes(fieldMapping.epicLinkFieldId)) {
            delete currentPayload.fields[fieldMapping.epicLinkFieldId];
            epicLinkDropped = true;
            console.log(`[FlatStrategy] Retrying TestCase creation without epic link field...`);
            modified = true;
          }
        }
        
        if (!modified) throw error;
      }
    }
    if (!created) throw new Error('TestCase creation failed after retries');

    const linkType = await this.resolveLinkTypeName('Tests');
    if (storyKey) {
      await this.createIssueLinkByName(created.key, storyKey, linkType);
      console.log(`[FlatStrategy] Linked Test Case ${created.key} → Story ${storyKey} (${linkType})`);
    }

    if (epicLinkDropped && epicKey) {
      const relatesType = await this.resolveLinkTypeName('Relates');
      await this.createIssueLinkByName(created.key, epicKey, relatesType);
      console.log(`[FlatStrategy] Linked Test Case ${created.key} → Epic Anchor ${epicKey} (${relatesType} fallback)`);
    }

    return created.key;
  }

  private async resolveLinkTypeName(preferred: string): Promise<string> {
    try {
      const resp = await this.jira.apiRequest<{ issueLinkTypes: Array<{ id: string; name: string }> }>('/issueLinkType');
      const types = resp.issueLinkTypes || [];
      const match = types.find(lt => lt.name.toLowerCase() === preferred.toLowerCase());
      if (match) return match.name;
      const relates = types.find(lt => lt.name.toLowerCase() === 'relates');
      return relates?.name || 'Relates';
    } catch {
      return 'Relates';
    }
  }

  // ── READ ──

  async getBacklogTreeForEpic(epicKey: IssueKey): Promise<EpicTree> {
    const pk = this.pk();

    const jql = `project = "${pk}" AND (parent = "${epicKey}" OR "Epic Link" = "${epicKey}" OR labels = "devx-epic-${epicKey}") ORDER BY issuetype`;

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

    const epicIssue = await this.jira.apiRequest<any>(`/issue/${epicKey}?fields=summary,description,status,priority,assignee,labels,issuetype,issuelinks,created`);
    const epicArtifact = this.mapToArtifact(epicIssue);

    const features: Map<string, JiraArtifact & { stories: Array<JiraArtifact & { tasks: JiraArtifact[]; testCases: JiraArtifact[] }> }> = new Map();
    const stories: Map<string, JiraArtifact & { tasks: JiraArtifact[]; testCases: JiraArtifact[] }> = new Map();
    const tasks: JiraArtifact[] = [];
    const testCases: JiraArtifact[] = [];
    const unclassified: Array<{ artifact: JiraArtifact; tier: string | null }> = [];

    for (const issue of allIssues) {
      const artifact = this.mapToArtifact(issue);
      const labels: string[] = issue.fields?.labels || [];
      let tier = extractDevxTier(labels);

      if (!tier) {
        tier = classifyByIssueTypeName(issue.fields?.issuetype?.name || '');
        if (tier) {
          console.log(`[JiraHierarchy] Issue ${artifact.key} missing devx-tier-*; using issuetype fallback → ${tier}`);
        }
      }

      if (tier === 'epic') continue;

      switch (tier) {
        case 'feature':
          features.set(artifact.key, { ...artifact, stories: [] });
          break;
        case 'story':
          stories.set(artifact.key, { ...artifact, tasks: [], testCases: [] });
          break;
        case 'task':
          tasks.push(artifact);
          break;
        case 'testcase':
          testCases.push(artifact);
          break;
        default:
          unclassified.push({ artifact, tier });
          break;
      }
    }

    // Wire stories into features
    for (const [storyKey, story] of stories) {
      const storyIssue = allIssues.find(i => i.key === storyKey);
      const storyLabels: string[] = storyIssue?.fields?.labels || [];
      let featureRef = extractDevxRelation(storyLabels, 'feature');

      if (!featureRef) {
        featureRef = this.findLinkedFeatureKey(storyIssue, features);
      }

      if (featureRef && features.has(featureRef)) {
        features.get(featureRef)!.stories.push(story);
      } else {
        let placed = false;
        if (featureRef) {
          for (const [fk, fv] of features) {
            if (fk === featureRef || fv.key === featureRef) {
              fv.stories.push(story);
              placed = true;
              break;
            }
          }
        }
        if (!placed) {
          // orphan story — will be placed later
        }
      }
    }

    // Wire tasks and test cases into stories
    for (const task of tasks) {
      const taskIssue = allIssues.find(i => i.key === task.key);
      const taskLabels: string[] = taskIssue?.fields?.labels || [];
      const storyRef = extractDevxRelation(taskLabels, 'story') || taskIssue?.fields?.parent?.key;

      if (storyRef && stories.has(storyRef)) {
        stories.get(storyRef)!.tasks.push(task);
      }
    }

    for (const tc of testCases) {
      const tcIssue = allIssues.find(i => i.key === tc.key);
      const tcLabels: string[] = tcIssue?.fields?.labels || [];
      let storyRef = extractDevxRelation(tcLabels, 'story');

      if (!storyRef) {
        storyRef = this.findLinkedStoryKey(tcIssue, stories);
      }

      if (storyRef && stories.has(storyRef)) {
        stories.get(storyRef)!.testCases.push(tc);
      }
    }

    // Build orphans
    const placedStoryKeys = new Set<string>();
    for (const [, f] of features) {
      for (const s of f.stories) placedStoryKeys.add(s.key);
    }
    const _orphanStories: JiraArtifact[] = [];
    for (const [key, story] of stories) {
      if (!placedStoryKeys.has(key)) _orphanStories.push(story);
    }

    const placedTaskKeys = new Set<string>();
    const placedTcKeys = new Set<string>();
    for (const [, s] of stories) {
      for (const t of s.tasks) placedTaskKeys.add(t.key);
      for (const tc of s.testCases) placedTcKeys.add(tc.key);
    }
    const _orphanTasks = tasks.filter(t => !placedTaskKeys.has(t.key));
    const _orphanTestCases = testCases.filter(tc => !placedTcKeys.has(tc.key));

    return {
      epic: epicArtifact,
      features: Array.from(features.values()),
      _orphanStories,
      _orphanTasks,
      _orphanTestCases,
    };
  }

  private findLinkedFeatureKey(
    issue: any,
    features: Map<string, any>
  ): string | null {
    const links = issue?.fields?.issuelinks;
    if (!Array.isArray(links)) return null;

    for (const link of links) {
      const candidates = [link.outwardIssue, link.inwardIssue].filter(Boolean);
      for (const c of candidates) {
        const cKey = c?.key || '';
        if (features.has(cKey)) return cKey;
        const cType = String(c?.fields?.issuetype?.name || '').toLowerCase();
        if (cType.includes('feature') && cKey) return cKey;
      }
    }
    return null;
  }

  private findLinkedStoryKey(
    issue: any,
    stories: Map<string, any>
  ): string | null {
    const links = issue?.fields?.issuelinks;
    if (!Array.isArray(links)) return null;

    for (const link of links) {
      const candidates = [link.outwardIssue, link.inwardIssue].filter(Boolean);
      for (const c of candidates) {
        const cKey = c?.key || '';
        if (stories.has(cKey)) return cKey;
      }
    }
    return null;
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
