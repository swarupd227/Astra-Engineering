import axios from 'axios';
import type { TestStep } from '@shared/qe-schema';

interface TestCase {
  id: string;
  name: string;
  type: string;
  objective?: string;
  given: string;
  when: string;
  then: string;
  selector?: string;
  preconditions?: string[];
  test_steps?: TestStep[];
  postconditions?: string[];
  test_data?: Record<string, any>;
  test_type?: 'Functional' | 'Negative' | 'Boundary';
  priority: 'P0' | 'P1' | 'P2' | 'P3' | 'low' | 'medium' | 'high' | 'critical';
  tags: string[];
  workflow?: {
    id: string;
    name: string;
    type: string;
  };
}

interface AdoConfig {
  organization: string;
  project: string;
  pat: string;
}

export class AdoExportService {
  private getConfig(): AdoConfig | null {
    const organization = process.env.ADO_ORGANIZATION;
    const project = process.env.ADO_PROJECT;
    const pat = process.env.ADO_PAT;

    if (organization && project && pat) {
      return { organization, project, pat };
    }
    return null;
  }

  public isConfigured(): boolean {
    return this.getConfig() !== null;
  }

  public getConfigurationError(): string {
    return 'Azure DevOps credentials not configured. Please set ADO_ORGANIZATION, ADO_PROJECT, and ADO_PAT environment variables.';
  }

  private convertPriorityToAdoFormat(priority: string): number {
    const priorityMap: Record<string, number> = {
      P0: 1,
      P1: 2,
      P2: 3,
      P3: 4,
      critical: 1,
      high: 2,
      medium: 3,
      low: 4,
    };
    return priorityMap[priority] || 3;
  }

  private convertTestStepsToXml(testSteps: TestStep[]): string {
    if (!testSteps || testSteps.length === 0) {
      return '<steps id="0"></steps>';
    }

    const stepElements = testSteps.map((step) => {
      const action = this.escapeXml(step.action);
      const expectedBehavior = this.escapeXml(step.expected_behavior);
      
      return `<step id="${step.step_number}" type="ValidateStep"><parameterizedString isformatted="true">${action}</parameterizedString><parameterizedString isformatted="true">${expectedBehavior}</parameterizedString><description/></step>`;
    }).join('');

    return `<steps id="0">${stepElements}</steps>`;
  }

  private escapeXml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  private buildDescription(testCase: TestCase): string {
    let description = '';

    if (testCase.objective) {
      description += `Objective: ${testCase.objective}\n\n`;
    }

    if (testCase.preconditions && testCase.preconditions.length > 0) {
      description += 'Preconditions:\n';
      testCase.preconditions.forEach((precondition, index) => {
        description += `${index + 1}. ${precondition}\n`;
      });
      description += '\n';
    }

    description += `Given: ${testCase.given}\n`;
    description += `When: ${testCase.when}\n`;
    description += `Then: ${testCase.then}\n`;

    if (testCase.postconditions && testCase.postconditions.length > 0) {
      description += '\nPostconditions:\n';
      testCase.postconditions.forEach((postcondition, index) => {
        description += `${index + 1}. ${postcondition}\n`;
      });
    }

    if (testCase.test_data && Object.keys(testCase.test_data).length > 0) {
      description += '\nTest Data:\n';
      description += JSON.stringify(testCase.test_data, null, 2);
    }

    if (testCase.workflow) {
      description += `\n\nWorkflow: ${testCase.workflow.name} (${testCase.workflow.type})`;
    }

    return description;
  }

  public async exportTestCase(testCase: TestCase): Promise<{ success: boolean; workItemId?: number; url?: string; error?: string }> {
    const config = this.getConfig();
    if (!config) {
      return {
        success: false,
        error: this.getConfigurationError(),
      };
    }

    try {
      const url = `https://dev.azure.com/${config.organization}/${config.project}/_apis/wit/workitems/$Test Case?api-version=7.1`;
      
      const token = Buffer.from(`:${config.pat}`).toString('base64');
      
      const tags = [...testCase.tags];
      if (testCase.test_type) {
        tags.push(testCase.test_type);
      }
      if (testCase.workflow?.type) {
        tags.push(testCase.workflow.type);
      }

      const body = [
        {
          op: 'add',
          path: '/fields/System.Title',
          value: testCase.name,
        },
        {
          op: 'add',
          path: '/fields/System.Description',
          value: this.buildDescription(testCase),
        },
        {
          op: 'add',
          path: '/fields/Microsoft.VSTS.Common.Priority',
          value: this.convertPriorityToAdoFormat(testCase.priority),
        },
        {
          op: 'add',
          path: '/fields/System.Tags',
          value: tags.join('; '),
        },
      ];

      if (testCase.test_steps && testCase.test_steps.length > 0) {
        body.push({
          op: 'add',
          path: '/fields/Microsoft.VSTS.TCM.Steps',
          value: this.convertTestStepsToXml(testCase.test_steps),
        });
      }

      const response = await axios.post(url, body, {
        headers: {
          'Content-Type': 'application/json-patch+json',
          'Authorization': `Basic ${token}`,
        },
      });

      return {
        success: true,
        workItemId: response.data.id,
        url: response.data._links?.html?.href,
      };
    } catch (error: any) {
      console.error('ADO export error:', error.response?.data || error.message);
      return {
        success: false,
        error: error.response?.data?.message || error.message || 'Failed to export test case to Azure DevOps',
      };
    }
  }

  public async exportMultipleTestCases(testCases: TestCase[]): Promise<{
    success: boolean;
    totalExported: number;
    totalFailed: number;
    results: Array<{ testCaseId: string; workItemId?: number; url?: string; error?: string }>;
  }> {
    const config = this.getConfig();
    if (!config) {
      return {
        success: false,
        totalExported: 0,
        totalFailed: testCases.length,
        results: testCases.map(tc => ({
          testCaseId: tc.id,
          error: this.getConfigurationError(),
        })),
      };
    }

    const results = [];
    let totalExported = 0;
    let totalFailed = 0;

    for (const testCase of testCases) {
      const result = await this.exportTestCase(testCase);
      
      if (result.success) {
        totalExported++;
        results.push({
          testCaseId: testCase.id,
          workItemId: result.workItemId,
          url: result.url,
        });
      } else {
        totalFailed++;
        results.push({
          testCaseId: testCase.id,
          error: result.error,
        });
      }
    }

    return {
      success: totalExported > 0,
      totalExported,
      totalFailed,
      results,
    };
  }
}

export const adoExportService = new AdoExportService();
