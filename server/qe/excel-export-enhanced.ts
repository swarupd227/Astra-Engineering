import ExcelJS from 'exceljs';

export interface EnhancedTestCase {
  id?: string;
  title: string;
  description?: string;
  category: string;
  priority: string;
  preconditions?: string[] | string;
  steps: Array<{
    step_number?: number;
    action: string;
    expected_behavior?: string;
  }>;
  expectedResult?: string;
  postconditions?: string[];
  objective?: string;
}

export interface ExportMetadata {
  projectName?: string;
  sprintName?: string;
  userStoryTitle?: string;
  generatedAt?: string;
  totalTestCases?: number;
  domain?: string;
}

const priorityColors: Record<string, { bg: string; font: string }> = {
  'P0': { bg: 'FFFF0000', font: 'FFFFFFFF' },
  'P1': { bg: 'FFFFA500', font: 'FF000000' },
  'P2': { bg: 'FFFFFF00', font: 'FF000000' },
  'P3': { bg: 'FF90EE90', font: 'FF000000' },
  'P4': { bg: 'FFADD8E6', font: 'FF000000' }
};

const categoryColors: Record<string, string> = {
  'functional': 'FFE2EFDA',
  'accessibility': 'FFDDEBF7',
  'security': 'FFFCE4D6',
  'negative': 'FFF8CBAD',
  'edge_case': 'FFE4DFEC'
};

function capitalizeFirst(str: string): string {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase().replace(/_/g, ' ');
}

function applyPriorityColor(cell: ExcelJS.Cell, priority: string): void {
  const colors = priorityColors[priority.toUpperCase()];
  if (colors) {
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: colors.bg }
    };
    cell.font = { bold: true, color: { argb: colors.font }, name: 'Arial', size: 10 };
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
  }
}

function applyCategoryColor(cell: ExcelJS.Cell, category: string): void {
  const lowerCategory = category?.toLowerCase();
  const color = categoryColors[lowerCategory];
  if (color) {
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: color }
    };
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
  }
}

export async function exportTestCasesToExcelEnhanced(
  testCases: EnhancedTestCase[],
  metadata?: ExportMetadata
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'NAT 2.0';
  workbook.created = new Date();

  const testSheet = workbook.addWorksheet('Test Cases', {
    views: [{ state: 'frozen', xSplit: 0, ySplit: 1 }]
  });

  testSheet.columns = [
    { header: 'Test Case ID', key: 'tcId', width: 12 },
    { header: 'Test Case Title', key: 'title', width: 60 },
    { header: 'Category', key: 'category', width: 15 },
    { header: 'Priority', key: 'priority', width: 10 },
    { header: 'Preconditions', key: 'preconditions', width: 25 },
    { header: 'Step #', key: 'stepNum', width: 8 },
    { header: 'Test Step', key: 'testStep', width: 70 },
    { header: 'Expected Result', key: 'expected', width: 70 }
  ];

  const headerRow = testSheet.getRow(1);
  headerRow.eachCell((cell) => {
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF1F4E79' }
    };
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, name: 'Arial', size: 11 };
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    cell.border = {
      top: { style: 'medium' },
      left: { style: 'medium' },
      bottom: { style: 'medium' },
      right: { style: 'medium' }
    };
  });
  headerRow.height = 25;

  let currentRow = 2;
  let tcCounter = 1;

  testCases.forEach((tc) => {
    const tcId = `TC-${String(tcCounter).padStart(3, '0')}`;
    const steps = tc.steps && tc.steps.length > 0 
      ? tc.steps 
      : [{ step_number: 1, action: 'N/A', expected_behavior: 'N/A' }];
    const startRow = currentRow;

    const preconditionsText = Array.isArray(tc.preconditions)
      ? tc.preconditions.join('\n')
      : (tc.preconditions || 'N/A');

    steps.forEach((step, stepIndex) => {
      const row = testSheet.getRow(currentRow);

      if (stepIndex === 0) {
        row.getCell('tcId').value = tcId;
        row.getCell('title').value = tc.title;
        row.getCell('category').value = capitalizeFirst(tc.category);
        row.getCell('priority').value = tc.priority.toUpperCase();
        row.getCell('preconditions').value = preconditionsText;

        applyPriorityColor(row.getCell('priority'), tc.priority);
        applyCategoryColor(row.getCell('category'), tc.category);
      }

      row.getCell('stepNum').value = step.step_number || stepIndex + 1;
      row.getCell('testStep').value = step.action;
      row.getCell('expected').value = step.expected_behavior || '';

      row.eachCell({ includeEmpty: true }, (cell) => {
        if (!cell.font || !cell.font.bold) {
          cell.font = { name: 'Arial', size: 10 };
        }
        cell.alignment = { wrapText: true, vertical: 'middle' };
        if (!cell.border) {
          cell.border = {
            top: { style: 'thin' },
            left: { style: 'thin' },
            bottom: { style: 'thin' },
            right: { style: 'thin' }
          };
        }
      });

      const tcIdCell = row.getCell('tcId');
      tcIdCell.font = { bold: true, name: 'Arial', size: 10 };
      
      const stepNumCell = row.getCell('stepNum');
      stepNumCell.font = { bold: true, name: 'Arial', size: 10 };
      stepNumCell.alignment = { horizontal: 'center', vertical: 'middle' };

      currentRow++;
    });

    if (steps.length > 1) {
      const endRow = currentRow - 1;
      ['A', 'B', 'C', 'D', 'E'].forEach((col) => {
        testSheet.mergeCells(`${col}${startRow}:${col}${endRow}`);
      });
    }

    tcCounter++;
  });

  const summarySheet = workbook.addWorksheet('Summary');
  
  summarySheet.columns = [
    { header: 'Metric', key: 'metric', width: 25 },
    { header: 'Value', key: 'value', width: 20 }
  ];

  const summaryHeaderRow = summarySheet.getRow(1);
  summaryHeaderRow.eachCell((cell) => {
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF1F4E79' }
    };
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, name: 'Arial', size: 11 };
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
    cell.border = {
      top: { style: 'medium' },
      left: { style: 'medium' },
      bottom: { style: 'medium' },
      right: { style: 'medium' }
    };
  });
  summaryHeaderRow.height = 25;

  const priorityCounts: Record<string, number> = { P0: 0, P1: 0, P2: 0, P3: 0, P4: 0 };
  const categoryCounts: Record<string, number> = {};

  testCases.forEach((tc) => {
    const priority = tc.priority.toUpperCase();
    if (priorityCounts[priority] !== undefined) {
      priorityCounts[priority]++;
    }
    const category = tc.category.toLowerCase();
    categoryCounts[category] = (categoryCounts[category] || 0) + 1;
  });

  const summaryData: Array<{ metric: string; value: string | number }> = [
    { metric: 'Project Name', value: metadata?.projectName || 'N/A' },
    { metric: 'Sprint Name', value: metadata?.sprintName || 'N/A' },
    { metric: 'User Story', value: metadata?.userStoryTitle || 'N/A' },
    { metric: 'Generated At', value: new Date().toLocaleString() },
    { metric: 'Total Test Cases', value: testCases.length },
    { metric: '', value: '' },
    { metric: 'PRIORITY BREAKDOWN', value: '' },
    { metric: 'P0 (Critical)', value: priorityCounts.P0 },
    { metric: 'P1 (High)', value: priorityCounts.P1 },
    { metric: 'P2 (Medium)', value: priorityCounts.P2 },
    { metric: 'P3 (Low)', value: priorityCounts.P3 },
    { metric: 'P4 (Lowest)', value: priorityCounts.P4 || 0 },
    { metric: '', value: '' },
    { metric: 'CATEGORY BREAKDOWN', value: '' },
  ];

  Object.entries(categoryCounts).forEach(([category, count]) => {
    summaryData.push({ metric: capitalizeFirst(category), value: count });
  });

  summaryData.forEach((data, index) => {
    const row = summarySheet.getRow(index + 2);
    row.getCell('metric').value = data.metric;
    row.getCell('value').value = data.value;
    
    row.eachCell((cell) => {
      cell.font = { name: 'Arial', size: 10 };
      cell.alignment = { vertical: 'middle' };
      cell.border = {
        top: { style: 'thin' },
        left: { style: 'thin' },
        bottom: { style: 'thin' },
        right: { style: 'thin' }
      };
    });

    if (data.metric === 'PRIORITY BREAKDOWN' || data.metric === 'CATEGORY BREAKDOWN') {
      row.getCell('metric').font = { bold: true, name: 'Arial', size: 10, color: { argb: 'FF1F4E79' } };
    }

    if (data.metric.startsWith('P0')) {
      applyPriorityColor(row.getCell('metric'), 'P0');
    } else if (data.metric.startsWith('P1')) {
      applyPriorityColor(row.getCell('metric'), 'P1');
    } else if (data.metric.startsWith('P2')) {
      applyPriorityColor(row.getCell('metric'), 'P2');
    } else if (data.metric.startsWith('P3')) {
      applyPriorityColor(row.getCell('metric'), 'P3');
    } else if (data.metric.startsWith('P4')) {
      applyPriorityColor(row.getCell('metric'), 'P4');
    }
  });

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
