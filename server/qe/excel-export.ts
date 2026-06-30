import * as XLSX from 'xlsx';

export interface TestCaseForExport {
  id: string;
  name: string;
  objective?: string;
  category?: string;
  type?: string;
  priority: string;
  preconditions?: string[];
  test_steps?: Array<{
    step_number: number;
    action: string;
    expected_behavior: string;
  }>;
  postconditions?: string[];
  test_data?: Record<string, any>;
  test_type?: string;
}

export interface ScenarioForExport {
  id: string;
  title: string;
  description: string;
  businessValue: string;
  acceptanceCriteria: string[];
}

export function exportTestCasesToExcel(
  testCases: TestCaseForExport[],
  scenarios?: ScenarioForExport[]
): Buffer {
  const workbook = XLSX.utils.book_new();

  if (scenarios && scenarios.length > 0) {
    const scenarioData = scenarios.map(scenario => ({
      'Scenario ID': scenario.id,
      'Title': scenario.title,
      'Description': scenario.description,
      'Business Value': scenario.businessValue,
      'Acceptance Criteria': scenario.acceptanceCriteria.join('\n'),
    }));
    
    const scenarioSheet = XLSX.utils.json_to_sheet(scenarioData);
    XLSX.utils.book_append_sheet(workbook, scenarioSheet, 'Insurance Scenarios');
  }

  const testCaseData = testCases.map(tc => ({
    'Test Case ID': tc.id,
    'Test Case Name': tc.name,
    'Objective': tc.objective || '',
    'Category': tc.category || tc.type || 'Functional',
    'Priority': tc.priority,
    'Test Type': tc.test_type || 'Functional',
    'Preconditions': tc.preconditions?.join('\n') || '',
    'Test Steps': tc.test_steps?.map((step, idx) => 
      `${idx + 1}. ${step.action}\n   Expected: ${step.expected_behavior}`
    ).join('\n\n') || '',
    'Postconditions': tc.postconditions?.join('\n') || '',
    'Test Data': tc.test_data ? JSON.stringify(tc.test_data, null, 2) : '',
  }));

  const testCaseSheet = XLSX.utils.json_to_sheet(testCaseData);
  
  testCaseSheet['!cols'] = [
    { width: 15 },
    { width: 40 },
    { width: 50 },
    { width: 15 },
    { width: 10 },
    { width: 15 },
    { width: 30 },
    { width: 60 },
    { width: 30 },
    { width: 30 },
  ];

  XLSX.utils.book_append_sheet(workbook, testCaseSheet, 'Test Cases');

  const categorySummary = testCases.reduce((acc, tc) => {
    const category = tc.category || tc.type || 'Functional';
    acc[category] = (acc[category] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const summaryData = Object.entries(categorySummary).map(([category, count]) => ({
    'Category': category,
    'Count': count,
  }));

  const summarySheet = XLSX.utils.json_to_sheet(summaryData);
  XLSX.utils.book_append_sheet(workbook, summarySheet, 'Summary');

  const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
  return buffer;
}
