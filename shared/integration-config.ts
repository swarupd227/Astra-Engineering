export type IntegrationType = 'jira' | 'ado' | string;

export interface IntegrationLabels {
  id: IntegrationType;
  name: string;               // 'Jira' or 'ADO'
  longName: string;           // 'Jira' or 'Azure DevOps'
  pushActionLabel: string;    // 'Push to Jira' or 'Push to ADO'
  wikiLabel: string;          // 'Confluence' or 'Wiki'
  generateWikiLabel: string;  // 'Generate Confluence' or 'Generate Wiki'
  backlogContextUrl: string;   // 'jira/backlog-context' or 'ado/backlog-context'
  repositoryLabel: string;    // 'Jira Project' or 'Azure DevOps Repository'
  testingPhaseLabel: string;     // 'Testing' or 'Quality Assurance'
  testArtifactsLabel: string;    // 'Test Artifacts'
  generateTestArtifactsLabel: string; // 'Generate Test Artifacts'
  repositoryActionLabel: string; // 'View in Jira' or 'View in Azure DevOps'
  stateLabels: Record<string, string>;
}

export const INTEGRATION_CONFIG: Record<IntegrationType, IntegrationLabels> = {
  jira: {
    id: 'jira',
    name: 'Jira',
    longName: 'Jira',
    pushActionLabel: 'Push to Jira',
    wikiLabel: 'Confluence',
    generateWikiLabel: 'Generate Confluence',
    backlogContextUrl: 'jira/backlog-context',
    repositoryLabel: 'Jira Project',
    testingPhaseLabel: 'Testing',
    testArtifactsLabel: 'Test Artifacts',
    generateTestArtifactsLabel: 'Generate Test Artifacts',
    repositoryActionLabel: 'View in Jira',
    stateLabels: {
      'New': 'To Do',
      'Active': 'In Progress',
      'Resolved': 'In Review',
      'Closed': 'Done',
      'Reopened': 'Reopened',
    }
  },
  ado: {
    id: 'ado',
    name: 'ADO',
    longName: 'Azure DevOps',
    pushActionLabel: 'Push to ADO',
    wikiLabel: 'Wiki',
    generateWikiLabel: 'Generate Wiki',
    backlogContextUrl: 'ado/backlog-context',
    repositoryLabel: 'Azure DevOps Repository',
    testingPhaseLabel: 'Testing',
    testArtifactsLabel: 'Test Artifacts',
    generateTestArtifactsLabel: 'Generate Test Artifacts',
    repositoryActionLabel: 'View in Azure DevOps',
    stateLabels: {
      'New': 'New',
      'Active': 'Active',
      'Resolved': 'Resolved',
      'Closed': 'Closed',
      'Reopened': 'Reopened',
    }
  }
};

export function getIntegrationLabels(type?: string | null): IntegrationLabels {
  const normalizedType = type?.toLowerCase() || 'ado';
  return INTEGRATION_CONFIG[normalizedType] || INTEGRATION_CONFIG.ado;
}

/**
 * Resolves the organization/connection ID for a project based on its integration type.
 */
export function getOrgIdForIntegration(
  type: string | null | undefined,
  project: { jiraConnectionId?: string },
  adoOrgId?: string
): string {
  const labels = getIntegrationLabels(type);
  if (labels.id === 'jira') {
    return project.jiraConnectionId || '';
  }
  return adoOrgId || '';
}
