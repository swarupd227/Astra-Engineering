import type { JiraFieldMapping } from '../jira-types';

export type IssueKey = string;

export type Mode = 'FLAT_3_TIER' | 'NATIVE_4_TIER';

export interface HierarchyCapability {
  mode: Mode;
  levels: {
    epic: number;
    feature?: number;
    userStory?: number;
    task?: number;
    testCase?: number;
    subtask?: number;
  };
  issueTypeIdMap: {
    epic?: string;
    feature?: string;
    userStory?: string;
    task?: string;
    testCase?: string;
    subtask?: string;
    bug?: string;
  };
  issueTypeNameMap?: {
    epic?: string;
    feature?: string;
    userStory?: string;
    task?: string;
    testCase?: string;
    subtask?: string;
    bug?: string;
  };
}

export interface JiraArtifact {
  key: string;
  id: string;
  summary: string;
  description: string;
  status: string;
  priority: string;
  assignee: string | null;
  storyPoints: number | null;
  labels: string[];
  issuetype: { id: string; name: string };
  adoUrl: string;
  createdAt: string;
  issuelinks: any[];
  parentKey?: string;
}

export interface EpicTree {
  epic: JiraArtifact;
  features: Array<JiraArtifact & {
    stories: Array<JiraArtifact & {
      tasks: JiraArtifact[];
      testCases: JiraArtifact[];
    }>;
  }>;
  _orphanStories: JiraArtifact[];
  _orphanTasks: JiraArtifact[];
  _orphanTestCases: JiraArtifact[];
}

export interface PushOpts {
  assigneeAccountId?: string | null;
  /**
   * Jira accountId of the person performing the push. Stamped as the issue
   * Reporter so multi-user pushes are attributed to the real person instead of
   * defaulting to the authenticating token owner (e.g. the admin connection).
   */
  reporterAccountId?: string | null;
  skipDuplicateCheck?: boolean;
  brdId?: string | null;
  requirementIds?: string[];
  fieldMapping?: JiraFieldMapping;
}

/**
 * Minimal shape of the issue-create transport used by the strategies. Kept
 * structural so the helper below can be unit-tested without a full JiraService.
 */
export interface IssueCreateTransport {
  apiRequest<T>(endpoint: string, options?: any): Promise<T>;
}

/**
 * POST /issue with a one-time, best-effort retry that strips an explicit
 * `reporter` if Jira rejects it. Some project configurations (notably certain
 * team-managed projects, or tokens lacking the "Modify Reporter" permission)
 * refuse an explicit reporter; in that case we must still create the issue
 * rather than fail the whole push. When stripped, Jira falls back to the
 * authenticating account as reporter — i.e. the previous behaviour.
 */
export async function createIssueWithReporterFallback(
  jira: IssueCreateTransport,
  payload: any
): Promise<{ key: string }> {
  try {
    return await jira.apiRequest<{ key: string }>('/issue', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  } catch (error: any) {
    const msg = String(error?.message || '');
    if (payload?.fields?.reporter && /reporter/i.test(msg)) {
      const fallback = { ...payload, fields: { ...payload.fields } };
      delete fallback.fields.reporter;
      console.warn('[JiraPush] Reporter field rejected by Jira; retrying without explicit reporter (issue will be reported by the authenticating account).');
      return await jira.apiRequest<{ key: string }>('/issue', {
        method: 'POST',
        body: JSON.stringify(fallback),
      });
    }
    throw error;
  }
}

export interface DevxEpic {
  id: string;
  title: string;
  description?: string;
  priority?: string;
}

export interface DevxFeature {
  id: string;
  title: string;
  description?: string;
  priority?: string;
  epicId?: string | null;
}

export interface DevxUserStory {
  id: string;
  title: string;
  description?: string;
  priority?: string;
  storyPoints?: number | null;
  featureId?: string | null;
  persona?: string;
  acceptanceCriteria?: any[];
}

export interface DevxTask {
  id: string;
  title: string;
  description?: string;
}

export interface DevxTestCase {
  id: string;
  title: string;
  steps?: Array<{ step?: number; action?: string; result?: string }>;
  expectedResult?: string;
}

export interface PushReportEntry {
  artifactType: 'epic' | 'feature' | 'userStory' | 'task' | 'testCase';
  devxId: string;
  title: string;
  status: 'created' | 'skipped' | 'failed';
  jiraKey?: string;
  error?: string;
}

export interface PushReport {
  entries: PushReportEntry[];
  totalCreated: number;
  totalSkipped: number;
  totalFailed: number;
}

export interface HierarchyStrategy {
  readonly mode: Mode;

  createEpic(epic: DevxEpic, opts?: PushOpts): Promise<IssueKey>;
  createFeature(feature: DevxFeature, epicKey: IssueKey, opts?: PushOpts): Promise<IssueKey>;
  createUserStory(story: DevxUserStory, epicKey: IssueKey, featureKey: IssueKey, opts?: PushOpts): Promise<IssueKey>;
  createTask(task: DevxTask, epicKey: IssueKey, storyKey: IssueKey, opts?: PushOpts): Promise<IssueKey>;
  createTestCase(tc: DevxTestCase, epicKey: IssueKey, storyKey: IssueKey, opts?: PushOpts): Promise<IssueKey>;

  getBacklogTreeForEpic(epicKey: IssueKey): Promise<EpicTree>;
}

// ── Synonym resolver (shared by both strategies) ──

const SYNONYMS: Record<string, string[]> = {
  story: ['story', 'user story'],
  'user story': ['user story', 'story'],
  epic: ['epic'],
  feature: ['feature'],
  task: ['task'],
  bug: ['bug', 'defect'],
  'sub-task': ['sub-task', 'subtask'],
  subtask: ['subtask', 'sub-task'],
  'test case': ['test case', 'test cases', 'test'],
  'test cases': ['test cases', 'test case'],
  testcase: ['testcase', 'test case', 'test cases'],
};

/**
 * Resolve a target type name to the best matching issue type from an available set.
 * Resolution order: exact -> synonym -> contains -> reverse-contains -> first non-subtask.
 * Always returns { id, name } when possible (team-managed projects need IDs).
 */
export function resolveIssueType(
  targetName: string,
  availableTypes: Array<{ id: string; name: string; subtask?: boolean }>
): { id: string; name: string } | null {
  if (!availableTypes.length) return null;
  const lower = targetName.toLowerCase();

  const exact = availableTypes.find(t => t.name.toLowerCase() === lower);
  if (exact) return { id: exact.id, name: exact.name };

  const syns = SYNONYMS[lower] || [lower];
  for (const syn of syns) {
    const match = availableTypes.find(t => t.name.toLowerCase() === syn);
    if (match) return { id: match.id, name: match.name };
  }

  const containsMatch = availableTypes.find(t => t.name.toLowerCase().includes(lower));
  if (containsMatch) return { id: containsMatch.id, name: containsMatch.name };

  const reverseMatch = availableTypes.find(t => lower.includes(t.name.toLowerCase()));
  if (reverseMatch) return { id: reverseMatch.id, name: reverseMatch.name };

  const nonSubtask = availableTypes.find(t => !t.subtask && t.name.toLowerCase() !== 'sub-task' && t.name.toLowerCase() !== 'subtask');
  if (nonSubtask) return { id: nonSubtask.id, name: nonSubtask.name };

  return availableTypes[0] ? { id: availableTypes[0].id, name: availableTypes[0].name } : null;
}

/**
 * Extract the devx-tier-* label from a set of labels.
 * Returns 'epic' | 'feature' | 'story' | 'task' | 'testcase' | null
 */
export function extractDevxTier(labels: string[]): string | null {
  for (const label of labels) {
    const match = label.match(/^devx-tier-(epic|feature|story|task|testcase)$/);
    if (match) return match[1];
  }
  return null;
}

/**
 * Extract the related key from a devx-{type}-{KEY} label.
 * e.g. 'devx-epic-MYPRO-100' -> 'MYPRO-100'
 */
export function extractDevxRelation(labels: string[], prefix: string): string | null {
  const pfx = `devx-${prefix}-`;
  for (const label of labels) {
    if (label.startsWith(pfx)) {
      return label.slice(pfx.length);
    }
  }
  return null;
}

/**
 * Classify a Jira issue into a tier using issuetype name heuristic (legacy fallback).
 */
export function classifyByIssueTypeName(issueTypeName: string): string | null {
  const lower = issueTypeName.toLowerCase();
  if (lower === 'epic') return 'epic';
  if (lower === 'feature') return 'feature';
  if (lower === 'story' || lower === 'user story') return 'story';
  if (lower === 'sub-task' || lower === 'subtask') return 'task';
  if (lower.includes('test') && lower.includes('case')) return 'testcase';
  if (lower === 'task') return 'task';
  return null;
}

/**
 * Build labels array for a pushed artifact.
 */
export function buildLabels(
  tier: 'epic' | 'feature' | 'story' | 'task' | 'testcase',
  keys: { epicKey?: string; featureKey?: string; storyKey?: string }
): string[] {
  const labels = [`devx-tier-${tier}`];
  if (keys.epicKey) labels.push(`devx-epic-${keys.epicKey}`);
  if (keys.featureKey) labels.push(`devx-feature-${keys.featureKey}`);
  if (keys.storyKey) labels.push(`devx-story-${keys.storyKey}`);
  return labels;
}
