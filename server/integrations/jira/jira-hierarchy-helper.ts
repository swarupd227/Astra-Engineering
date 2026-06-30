import type { JiraConfig } from './jira-types';
import type { EpicTree, JiraArtifact } from './strategies/hierarchy-strategy';

interface JiraBacklogContext {
  epics?: any[];
  features?: any[];
  userStories?: any[];
  _rawStories?: any[];
}

interface JiraHierarchyItem {
  id: string;
  title: string;
  description: string;
  adoWorkItemId: string;
  externalId?: string;
  state?: string;
  priority?: any;
  tags: string;
  brdId?: string | null;
  epicId?: string | null;
  featureId?: string | null;
  source: 'jira';
  adoUrl: string;
  acceptanceCriteria?: string;
  assignedTo?: string;
  createdDate?: string;
  storyPoints?: any;
}

export interface JiraHierarchyResult {
  adoEpics: JiraHierarchyItem[];
  adoFeatures: JiraHierarchyItem[];
  adoUserStories: JiraHierarchyItem[];
  adoTasks?: JiraHierarchyItem[];
  adoTestCases?: JiraHierarchyItem[];
}

/**
 * Build hierarchy from an EpicTree (strategy-aware).
 * Projects the tree into the existing UI shape + new adoTasks/adoTestCases arrays.
 */
export function buildHierarchyFromEpicTree(
  tree: EpicTree,
  jiraConfig: JiraConfig
): JiraHierarchyResult {
  const instanceUrl = jiraConfig.instanceUrl;

  const mapArtifactToItem = (
    a: JiraArtifact,
    kind: 'epic' | 'feature' | 'story' | 'task' | 'testcase',
    epicId?: string | null,
    featureId?: string | null
  ): JiraHierarchyItem => ({
    id: kind === 'epic' ? `epic-${a.id}` : kind === 'feature' ? `feature-${a.id}` : `ado-${a.id}`,
    title: a.summary,
    description: a.description || '',
    adoWorkItemId: a.id,
    externalId: a.key,
    state: a.status,
    priority: a.priority || null,
    tags: '',
    brdId: null,
    epicId: epicId || null,
    featureId: featureId || null,
    source: 'jira',
    adoUrl: `${instanceUrl}/browse/${a.key}`,
    assignedTo: a.assignee || 'Unassigned',
    createdDate: a.createdAt,
    storyPoints: a.storyPoints || null,
  });

  const adoEpics: JiraHierarchyItem[] = [mapArtifactToItem(tree.epic, 'epic')];
  const adoFeatures: JiraHierarchyItem[] = [];
  const adoUserStories: JiraHierarchyItem[] = [];
  const adoTasks: JiraHierarchyItem[] = [];
  const adoTestCases: JiraHierarchyItem[] = [];

  const epicHierarchyId = `epic-${tree.epic.id}`;

  for (const feature of tree.features) {
    const featureHierarchyId = `feature-${feature.id}`;
    adoFeatures.push(mapArtifactToItem(feature, 'feature', epicHierarchyId));

    for (const story of feature.stories) {
      adoUserStories.push(mapArtifactToItem(story, 'story', epicHierarchyId, featureHierarchyId));

      for (const task of story.tasks) {
        adoTasks.push(mapArtifactToItem(task, 'task', epicHierarchyId, featureHierarchyId));
      }
      for (const tc of story.testCases) {
        adoTestCases.push(mapArtifactToItem(tc, 'testcase', epicHierarchyId, featureHierarchyId));
      }
    }
  }

  // Orphans
  for (const story of tree._orphanStories) {
    adoUserStories.push(mapArtifactToItem(story, 'story', epicHierarchyId, null));
  }
  for (const task of tree._orphanTasks) {
    adoTasks.push(mapArtifactToItem(task, 'task', epicHierarchyId, null));
  }
  for (const tc of tree._orphanTestCases) {
    adoTestCases.push(mapArtifactToItem(tc, 'testcase', epicHierarchyId, null));
  }

  return { adoEpics, adoFeatures, adoUserStories, adoTasks, adoTestCases };
}

/**
 * @deprecated Use buildHierarchyFromEpicTree() with the strategy's getBacklogTreeForEpic() instead.
 * Kept for backward compatibility with pre-strategy call sites.
 */
export function buildJiraHierarchyFromBacklogContext(
  jiraContext: JiraBacklogContext,
  jiraConfig: JiraConfig
): JiraHierarchyResult {
  const allJiraItems = [
    ...(jiraContext.epics || []).map((epic: any) => ({ ...epic, itemType: 'epic' })),
    ...(jiraContext.features || []).map((feature: any) => ({ ...feature, itemType: 'feature' })),
    ...(jiraContext.userStories || []).map((story: any) => ({ ...story, itemType: 'userStory' })),
  ];

  const itemTypeMap = new Map<string, string>();
  const itemIdMap = new Map<string, string>();

  allJiraItems.forEach((item: any) => {
    const itemId = String(item.id);
    itemTypeMap.set(itemId, item.itemType);
    itemIdMap.set(itemId, itemId);

    if (item.externalId) {
      const externalId = String(item.externalId);
      itemTypeMap.set(externalId, item.itemType);
      itemIdMap.set(externalId, itemId);
    }
  });

  const mapEpic = (epic: any): JiraHierarchyItem => ({
    id: `epic-${epic.id}`,
    title: epic.title,
    description: epic.description || '',
    adoWorkItemId: epic.id,
    externalId: epic.externalId,
    state: epic.status,
    priority: epic.priority || null,
    tags: '',
    brdId: null,
    source: 'jira',
    adoUrl: `${jiraConfig.instanceUrl}/browse/${epic.externalId || epic.id}`,
  });

  const mapFeature = (feature: any): JiraHierarchyItem => {
    const featureParentId = feature.parentId ? itemIdMap.get(String(feature.parentId)) : null;
    const featureParentType = feature.parentId ? itemTypeMap.get(String(feature.parentId)) : null;
    const epicId = featureParentId && featureParentType === 'epic'
      ? `epic-${featureParentId}`
      : null;

    return {
      id: `feature-${feature.id}`,
      title: feature.title,
      description: feature.description || '',
      adoWorkItemId: feature.id,
      externalId: feature.externalId,
      state: feature.status,
      priority: feature.priority || null,
      tags: '',
      epicId,
      source: 'jira',
      adoUrl: `${jiraConfig.instanceUrl}/browse/${feature.externalId || feature.id}`,
    };
  };

  const resolveFeatureLinkFromIssue = (
    story: any,
    transformedFeatures: JiraHierarchyItem[]
  ): string | null => {
    const rawStory = story?.fields ? story : undefined;
    const links = rawStory?.fields?.issuelinks;

    if (!Array.isArray(links)) return null;

    for (const link of links) {
      const candidates = [link.outwardIssue, link.inwardIssue].filter(Boolean);
      for (const candidate of candidates) {
        const candidateKey = String(candidate?.key || candidate?.id || '');
        const candidateType = String(
          candidate?.fields?.issuetype?.name ||
          candidate?.issuetype?.name ||
          candidate?.issuetype ||
          ''
        ).toLowerCase();

        if (!candidateKey || !candidateType) continue;

        if (candidateType.includes('feature')) {
          const linkedFeature = transformedFeatures.find((f) =>
            f.externalId === candidateKey || f.adoWorkItemId === candidateKey
          );
          if (linkedFeature) return linkedFeature.id;
        }
      }
    }

    return null;
  };

  const mapUserStory = (story: any, index: number, transformedFeatures: JiraHierarchyItem[]): JiraHierarchyItem => {
    const storyParentId = story.parentId ? itemIdMap.get(String(story.parentId)) : null;
    const storyParentType = story.parentId ? itemTypeMap.get(String(story.parentId)) : null;

    let epicId = storyParentId && storyParentType === 'epic'
      ? `epic-${storyParentId}`
      : null;
    let featureId = storyParentId && storyParentType === 'feature'
      ? `feature-${storyParentId}`
      : null;

    if (!featureId && jiraContext._rawStories && jiraContext._rawStories[index]) {
      const rawStory = jiraContext._rawStories[index];
      const linkedFeatureId = resolveFeatureLinkFromIssue(rawStory, transformedFeatures);
      if (linkedFeatureId) featureId = linkedFeatureId;
    }

    return {
      id: `ado-${story.id}`,
      title: story.title,
      description: story.description || '',
      acceptanceCriteria: story.acceptanceCriteria || '',
      adoWorkItemId: story.id,
      externalId: story.externalId,
      state: story.status,
      assignedTo: story.assignee || 'Unassigned',
      createdDate: story.createdAt,
      priority: story.priority || null,
      storyPoints: story.storyPoints || null,
      tags: '',
      epicId,
      featureId,
      source: 'jira',
      adoUrl: `${jiraConfig.instanceUrl}/browse/${story.externalId || story.id}`,
    };
  };

  const adoEpics = (jiraContext.epics || []).map(mapEpic);
  const adoFeatures = (jiraContext.features || []).map(mapFeature);
  const adoUserStories = (jiraContext.userStories || []).map((story: any, index: number) =>
    mapUserStory(story, index, adoFeatures)
  );

  return {
    adoEpics,
    adoFeatures,
    adoUserStories,
  };
}
