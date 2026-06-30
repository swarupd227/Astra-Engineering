import { WorkItem } from '../base/integration-types';
import { JiraIssue, JiraFieldMapping, JIRA_STATUS_MAP, JIRA_PRIORITY_MAP } from './jira-types';
import { marked } from 'marked';

export function mapJiraIssueToWorkItem(
  issue: JiraIssue,
  fieldMapping?: JiraFieldMapping
): WorkItem {
  if (!issue) {
    throw new Error('Cannot map null or undefined Jira issue');
  }

  const fields = issue.fields || {};
  
  return {
    id: issue.id || '',
    title: fields.summary || 'Untitled',
    description: fields.description ? extractTextFromADF(fields.description) : '',
    type: fields.issuetype?.name ? mapJiraIssueTypeToDevX(fields.issuetype.name) : 'task',
    status: fields.status?.name ? mapJiraStatusToDevX(fields.status.name) : 'New',
    assignee: fields.assignee?.emailAddress || fields.assignee?.displayName || undefined,
    storyPoints: fieldMapping?.storyPointsFieldId 
      ? fields[fieldMapping.storyPointsFieldId] 
      : undefined,
    priority: fields.priority?.name ? mapJiraPriorityToDevX(fields.priority.name) : 'medium',
    acceptanceCriteria: fieldMapping?.acceptanceCriteriaFieldId
      ? fields[fieldMapping.acceptanceCriteriaFieldId]
      : undefined,
    parentId: (() => {
      // 1) Try standard Parent field (Hierarchy-based)
      if (fields.parent?.key) return fields.parent.key;
      // 2) Try Epic Link field (Company-managed projects)
      if (fieldMapping?.epicLinkFieldId && fields[fieldMapping.epicLinkFieldId]) {
        return fields[fieldMapping.epicLinkFieldId];
      }
      // 3) Try Issue Links for Feature/Epic parent relationships
      if (fields.issuelinks && Array.isArray(fields.issuelinks)) {
        for (const link of fields.issuelinks) {
          const candidates = [link.outwardIssue, link.inwardIssue].filter(Boolean);
          for (const candidate of candidates) {
            const candidateFields = candidate?.fields || {};
            const candidateTypeName = String(
              candidateFields?.issuetype?.name ||
              candidate?.issuetype?.name ||
              candidate?.issuetype ||
              ''
            ).toLowerCase();
            if (candidateTypeName.includes('feature') || candidateTypeName.includes('epic')) {
              return candidate.key || candidate.id;
            }
          }
        }
      }
      return undefined;
    })(),
    externalId: issue.key || '',
    source: 'Jira',
    // --- Metadata fields ---
    createdAt: fields.created ? new Date(fields.created) : new Date(),
    updatedAt: fields.updated ? new Date(fields.updated) : new Date(),
    createdBy:
      (fields.creator && fields.creator.displayName) ||
      (fields.reporter && (fields.reporter.emailAddress || fields.reporter.displayName)) ||
      undefined,
  };
}


export function mapWorkItemToJiraIssue(
  workItem: Partial<WorkItem>,
  projectKey: string,
  fieldMapping?: JiraFieldMapping
): any {
  // Ensure project key is uppercase (Jira project keys are case-sensitive and should be uppercase)
  const normalizedProjectKey = (projectKey || '').trim().toUpperCase();
  
  if (!normalizedProjectKey) {
    throw new Error(`Invalid project key: "${projectKey}". Project key cannot be empty.`);
  }
  
  const jiraIssue: any = {
    fields: {
      project: { key: normalizedProjectKey },
      summary: workItem.title,
      description: workItem.description 
        ? convertToADF(workItem.description) 
        : undefined,
      issuetype: {
        name: mapDevXTypeToJira(workItem.type || 'task'),
      },
      // Do NOT send created/updated fields to Jira (Jira manages these)
      creator: workItem.createdBy ? { displayName: workItem.createdBy } : undefined,
    },
  };

  if (workItem.priority) {
    jiraIssue.fields.priority = {
      name: mapDevXPriorityToJira(workItem.priority),
    };
  }

  if (fieldMapping) {
    if (workItem.storyPoints && fieldMapping.storyPointsFieldId) {
      jiraIssue.fields[fieldMapping.storyPointsFieldId] = workItem.storyPoints;
    }

    if (workItem.parentId && fieldMapping.epicLinkFieldId) {
      jiraIssue.fields[fieldMapping.epicLinkFieldId] = workItem.parentId;
    }

    if (workItem.acceptanceCriteria && fieldMapping.acceptanceCriteriaFieldId) {
      jiraIssue.fields[fieldMapping.acceptanceCriteriaFieldId] = 
        workItem.acceptanceCriteria;
    }
  }

  return jiraIssue;
}

export function mapJiraIssueTypeToDevX(jiraType: string): WorkItem['type'] {
  // Normalize the issue type name (case-insensitive matching)
  const normalizedType = jiraType.trim();
  
  const typeMap: Record<string, WorkItem['type']> = {
    'Epic': 'Epic',
    'Story': 'User Story',
    'Feature': 'Feature',
    'Task': 'Task',
    'Sub-task': 'Task',
    'Subtask': 'Task',
    'Bug': 'Bug',
    'User Story': 'User Story',
  };
  
  // Try exact match first
  if (typeMap[jiraType]) {
    return typeMap[jiraType];
  }
  
  // Try case-insensitive match
  const lowerType = normalizedType.toLowerCase();
  if (lowerType === 'epic') return 'Epic';
  if (lowerType === 'story' || lowerType === 'user story') return 'User Story';
  if (lowerType === 'feature') return 'Feature';
  if (lowerType === 'task' || lowerType.includes('sub')) return 'Task';
  if (lowerType === 'bug' || lowerType === 'defect') return 'Bug';
  
  // Try matching with common variations
  if (lowerType.includes('epic')) return 'Epic';
  if (lowerType.includes('feature')) return 'Feature';
  if (lowerType.includes('story') || lowerType.includes('user story') || lowerType.includes('requirement')) return 'User Story';
  if (lowerType.includes('bug') || lowerType.includes('defect')) return 'Bug';
  if (lowerType.includes('task') || lowerType.includes('sub')) return 'Task';
  
  // Default to Task if no match found
  return 'Task';
}

export function mapDevXTypeToJira(devxType: string): string {
  // Use case-insensitive mapping for robustness
  const normalizedType = (devxType || '').toLowerCase().trim();
  
  const typeMap: Record<string, string> = {
    'epic': 'Epic',
    'feature': 'Feature',
    'user story': 'Story',
    'user-story': 'Story',
    'task': 'Task',
    'bug': 'Bug',
    'userstory': 'Story',
  };
  
  return typeMap[normalizedType] || 'Task';
}

export function mapJiraStatusToDevX(jiraStatus: string): string {
  return JIRA_STATUS_MAP[jiraStatus] || jiraStatus;
}

export function mapDevXStatusToJira(devxStatus: string): string {
  const reverseMap: Record<string, string> = {
    'New': 'To Do',
    'Active': 'In Progress',
    'Resolved': 'Done',
    'Closed': 'Done',
  };
  return reverseMap[devxStatus] || devxStatus;
}

export function mapJiraPriorityToDevX(jiraPriority?: string): string {
  if (!jiraPriority) return 'medium';
  const priorityMap: Record<string, string> = {
    'Highest': 'critical',
    'High': 'high',
    'Medium': 'medium',
    'Low': 'low',
    'Lowest': 'low',
  };
  return priorityMap[jiraPriority] || 'medium';
}

export function mapDevXPriorityToJira(devxPriority: string): string {
  const priorityMap: Record<string, string> = {
    'critical': 'Highest',
    'high': 'High',
    'medium': 'Medium',
    'low': 'Low',
    '1': 'Highest',
    '2': 'High',
    '3': 'Medium',
    '4': 'Low',
  };
  return priorityMap[devxPriority] || 'Medium';
}

export function extractTextFromADF(adf: any): string {
  if (!adf) return '';
  if (typeof adf === 'string') return adf;
  
  if (adf.type === 'doc' && adf.content) {
    return adf.content
      .map((node: any) => extractTextFromNode(node))
      .join('\n');
  }
  
  return '';
}

function extractTextFromNode(node: any): string {
  if (!node) return '';
  
  if (node.type === 'text') {
    return node.text || '';
  }
  
  if (node.content && Array.isArray(node.content)) {
    const text = node.content.map((n: any) => extractTextFromNode(n)).join('');
    
    switch (node.type) {
      case 'paragraph':
        return text + '\n';
      case 'heading':
        return `${'#'.repeat(node.attrs?.level || 1)} ${text}\n`;
      case 'bulletList':
      case 'orderedList':
        return text;
      case 'listItem':
        return `- ${text}`;
      case 'codeBlock':
        return `\`\`\`\n${text}\n\`\`\`\n`;
      default:
        return text;
    }
  }
  
  return '';
}

export function convertToADF(markdown: string): any {
  if (!markdown) {
    return {
      type: 'doc',
      version: 1,
      content: [],
    };
  }

  try {
    const tokens = marked.lexer(markdown);
    const content = tokens.map(token => mapTokenToADF(token)).filter(Boolean).flat();

    return {
      type: 'doc',
      version: 1,
      content: content,
    };
  } catch (error) {
    console.error("[convertToADF] Error parsing markdown:", error);
    // Simple fallback
    return {
      type: 'doc',
      version: 1,
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: markdown }]
        }
      ],
    };
  }
}

function mapTokenToADF(token: any): any {
  switch (token.type) {
    case 'heading':
      return {
        type: 'heading',
        attrs: { level: token.depth },
        content: mapInlineToADF(token.tokens || [])
      };

    case 'paragraph':
      return {
        type: 'paragraph',
        content: mapInlineToADF(token.tokens || [])
      };

    case 'list':
      return {
        type: token.ordered ? 'orderedList' : 'bulletList',
        content: token.items.map((item: any) => ({
          type: 'listItem',
          content: item.tokens.map((t: any) => mapTokenToADF(t)).filter(Boolean).flat()
        }))
      };

    case 'table':
      return {
        type: 'table',
        content: [
          // Header row
          {
            type: 'tableRow',
            content: token.header.map((cell: any) => ({
              type: 'tableHeader',
              content: [{
                type: 'paragraph',
                content: mapInlineToADF(cell.tokens || [])
              }]
            }))
          },
          // Data rows
          ...token.rows.map((row: any) => ({
            type: 'tableRow',
            content: row.map((cell: any) => ({
              type: 'tableCell',
              content: [{
                type: 'paragraph',
                content: mapInlineToADF(cell.tokens || [])
              }]
            }))
          }))
        ]
      };

    case 'blockquote':
      return {
        type: 'blockquote',
        content: token.tokens.map((t: any) => mapTokenToADF(t)).filter(Boolean).flat()
      };

    case 'code':
      return {
        type: 'codeBlock',
        attrs: { language: token.lang || undefined },
        content: [{ type: 'text', text: token.text }]
      };

    case 'hr':
      return { type: 'rule' };

    case 'space':
      return null;

    case 'text':
      // If it's a top-level text token, wrap it in a paragraph
      if (token.tokens) {
        return {
          type: 'paragraph',
          content: mapInlineToADF(token.tokens)
        };
      }
      return {
        type: 'paragraph',
        content: [{ type: 'text', text: token.text }]
      };

    default:
      console.warn(`[convertToADF] Unsupported token type: ${token.type}`);
      return null;
  }
}

function mapInlineToADF(tokens: any[]): any[] {
  const result: any[] = [];

  for (const token of tokens) {
    const marks: any[] = [];
    if (token.type === 'strong') marks.push({ type: 'strong' });
    if (token.type === 'em') marks.push({ type: 'em' });
    if (token.type === 'codespan') marks.push({ type: 'code' });
    if (token.type === 'link') {
      marks.push({
        type: 'link',
        attrs: { href: token.href, title: token.title || undefined }
      });
    }

    if (token.tokens) {
      // Recurse for nested inlines (e.g. bold in a link)
      // ADF text nodes can have multiple marks, but they can't be nested nodes.
      // So we flatten them and apply parent marks.
      const children = mapInlineToADF(token.tokens);
      children.forEach(child => {
        if (child.type === 'text') {
          child.marks = [...(child.marks || []), ...marks];
        }
        result.push(child);
      });
    } else {
      result.push({
        type: 'text',
        text: token.text || '',
        marks: marks.length > 0 ? marks : undefined
      });
    }
  }

  // Ensure we don't have empty content for nodes that require it
  if (result.length === 0) {
    result.push({ type: 'text', text: ' ' });
  }

  return result;
}
