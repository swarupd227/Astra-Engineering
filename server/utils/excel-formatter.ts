/**
 * Excel Formatter Utility for Test Cases
 * Generates professionally formatted Excel files with test cases
 */

import ExcelJS from 'exceljs';

interface TestStep {
  step: number;
  action: string;
  expectedResult: string;
}

interface TestCase {
  id: string;
  title: string;
  category: string;
  priority: string;
  preconditions: string[];
  steps: TestStep[];
  postconditions: string[];
}

interface ExcelExportData {
  testCases: {
    // Core test types
    functional?: TestCase[];
    negative?: TestCase[];
    edgeCases?: TestCase[];
    accessibility?: TestCase[];
    // Extended test types
    performance?: TestCase[];
    security?: TestCase[];
    usability?: TestCase[];
    reliability?: TestCase[];
  };
  metadata: {
    storyTitle: string;
    projectName?: string;
    organization?: string;
    generatedAt?: string;
  };
}

// Priority color mapping
const PRIORITY_COLORS = {
  'High': { bg: 'FFFF0000', font: 'FFFFFFFF' },    // Red with white text
  'Medium': { bg: 'FFFFA500', font: 'FF000000' },  // Orange with black text
  'Low': { bg: 'FF90EE90', font: 'FF000000' }      // Light green with black text
};

// Category color mapping
const CATEGORY_COLORS = {
  // Core test types
  'Functional': 'FFE2EFDA',      // Light Green
  'Negative': 'FFF8CBAD',        // Peach
  'Edge Cases': 'FFE4DFEC',      // Light Purple
  'Accessibility': 'FFDDEBF7',   // Light Blue
  // Extended test types
  'Performance': 'FFD4EDDA',     // Mint Green
  'Security': 'FFFFF2CC',        // Light Yellow
  'Usability': 'FFFCE4EC',       // Light Pink
  'Reliability': 'FFD0F0FD'      // Light Cyan
};

export async function generateTestCaseExcel(data: ExcelExportData): Promise<Buffer> {
  console.log("[Excel Formatter] Starting Excel generation with data:", {
    hasTestCases: !!data.testCases,
    testCasesKeys: data.testCases ? Object.keys(data.testCases) : [],
    // Core types
    hasFunctional: !!data.testCases?.functional,
    functionalLength: data.testCases?.functional?.length || 0,
    hasNegative: !!data.testCases?.negative,
    negativeLength: data.testCases?.negative?.length || 0,
    hasEdgeCases: !!data.testCases?.edgeCases,
    edgeCasesLength: data.testCases?.edgeCases?.length || 0,
    hasAccessibility: !!data.testCases?.accessibility,
    accessibilityLength: data.testCases?.accessibility?.length || 0,
    // Extended types
    hasPerformance: !!data.testCases?.performance,
    performanceLength: data.testCases?.performance?.length || 0,
    hasSecurity: !!data.testCases?.security,
    securityLength: data.testCases?.security?.length || 0,
    hasUsability: !!data.testCases?.usability,
    usabilityLength: data.testCases?.usability?.length || 0,
    hasReliability: !!data.testCases?.reliability,
    reliabilityLength: data.testCases?.reliability?.length || 0,
    metadata: data.metadata
  });
  
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'DevX 2.0';
  workbook.created = new Date();
  workbook.modified = new Date();

  // Create Test Cases sheet
  const testSheet = workbook.addWorksheet('Test Cases', {
    views: [{ state: 'frozen', xSplit: 0, ySplit: 1 }] // Freeze header row
  });

  // Define columns
  testSheet.columns = [
    { header: 'Test Case ID', key: 'tcId', width: 15 },
    { header: 'Test Case Title', key: 'title', width: 60 },
    { header: 'Category', key: 'category', width: 18 },
    { header: 'Priority', key: 'priority', width: 12 },
    { header: 'Preconditions', key: 'preconditions', width: 30 },
    { header: 'Step #', key: 'stepNum', width: 10 },
    { header: 'Test Step (Action)', key: 'action', width: 70 },
    { header: 'Expected Result', key: 'expected', width: 70 },
    { header: 'Postconditions', key: 'postconditions', width: 30 }
  ];

  // Style header row
  const headerRow = testSheet.getRow(1);
  headerRow.eachCell((cell) => {
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF1F4E79' } // Dark blue
    };
    cell.font = {
      bold: true,
      color: { argb: 'FFFFFFFF' }, // White
      name: 'Arial',
      size: 11
    };
    cell.alignment = {
      horizontal: 'center',
      vertical: 'middle',
      wrapText: true
    };
    cell.border = {
      top: { style: 'medium' },
      left: { style: 'medium' },
      bottom: { style: 'medium' },
      right: { style: 'medium' }
    };
  });
  headerRow.height = 30;

  // Process test cases from all categories (core + extended)
  let currentRow = 2;
  let tcCounter = 1;
  const categories = [
    // Core test types
    'functional', 
    'negative', 
    'edgeCases', 
    'accessibility',
    // Extended test types
    'performance',
    'security',
    'usability',
    'reliability'
  ];
  const categoryStats: Record<string, number> = {};
  const priorityStats: Record<string, number> = {};
  let totalTests = 0;

  categories.forEach((categoryKey) => {
    const testCases = data.testCases[categoryKey as keyof typeof data.testCases];
    if (!testCases || testCases.length === 0) {
      console.log(`[Excel Formatter] ⚠️ Category '${categoryKey}' is empty or missing (has: ${!!testCases}, length: ${testCases?.length || 0})`);
      return;
    }

    // Normalize category names for display
    const categoryNameMap: Record<string, string> = {
      'functional': 'Functional',
      'negative': 'Negative',
      'edgeCases': 'Edge Cases',
      'accessibility': 'Accessibility',
      'performance': 'Performance',
      'security': 'Security',
      'usability': 'Usability',
      'reliability': 'Reliability'
    };
    const categoryName = categoryNameMap[categoryKey] || categoryKey;
    
    console.log(`[Excel Formatter] ✅ Processing category '${categoryName}': ${testCases.length} test cases`);

    testCases.forEach((tc) => {
      const tcId = `TC-${String(tcCounter).padStart(3, '0')}`;
      const steps = tc.steps && tc.steps.length > 0 ? tc.steps : [
        { step: 1, action: 'N/A', expectedResult: 'N/A' }
      ];
      
      const startRow = currentRow;
      const preconditionsText = Array.isArray(tc.preconditions) 
        ? tc.preconditions.join('\n• ') 
        : (tc.preconditions || 'None');
      const postconditionsText = Array.isArray(tc.postconditions)
        ? tc.postconditions.join('\n• ')
        : (tc.postconditions || 'None');

      // Track statistics
      categoryStats[categoryName] = (categoryStats[categoryName] || 0) + 1;
      priorityStats[tc.priority] = (priorityStats[tc.priority] || 0) + 1;
      totalTests++;

      steps.forEach((step, stepIndex) => {
        const row = testSheet.getRow(currentRow);

        // Only add TC info on first step row
        if (stepIndex === 0) {
          row.getCell('tcId').value = tcId;
          row.getCell('title').value = tc.title;
          row.getCell('category').value = categoryName;
          row.getCell('priority').value = tc.priority;
          row.getCell('preconditions').value = '• ' + preconditionsText;
          row.getCell('postconditions').value = '• ' + postconditionsText;

          // Apply priority color
          applyPriorityColor(row.getCell('priority'), tc.priority);
          
          // Apply category color
          applyCategoryColor(row.getCell('category'), categoryName);
        }

        row.getCell('stepNum').value = step.step || stepIndex + 1;
        row.getCell('action').value = step.action;
        row.getCell('expected').value = step.expectedResult;

        // Apply cell styling
        row.eachCell({ includeEmpty: true }, (cell) => {
          cell.font = { name: 'Arial', size: 10 };
          cell.alignment = { wrapText: true, vertical: 'top' };
          cell.border = {
            top: { style: 'thin' },
            left: { style: 'thin' },
            bottom: { style: 'thin' },
            right: { style: 'thin' }
          };
        });

        // Bold TC ID and Step Number, center step number
        row.getCell('tcId').font = { bold: true, name: 'Arial', size: 10 };
        row.getCell('stepNum').font = { bold: true, name: 'Arial', size: 10 };
        row.getCell('stepNum').alignment = { horizontal: 'center', vertical: 'middle' };
        
        // Center align category and priority
        row.getCell('category').alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
        row.getCell('priority').alignment = { horizontal: 'center', vertical: 'middle' };

        row.height = 30;
        currentRow++;
      });

      // Merge cells for multi-step test cases
      if (steps.length > 1) {
        const endRow = currentRow - 1;
        ['A', 'B', 'C', 'D', 'E', 'I'].forEach((col) => {
          testSheet.mergeCells(`${col}${startRow}:${col}${endRow}`);
        });
      }

      tcCounter++;
    });
  });

  // Create Summary sheet
  const summarySheet = workbook.addWorksheet('Summary');
  summarySheet.columns = [
    { width: 30 },
    { width: 20 },
    { width: 40 }
  ];

  let summaryRow = 1;

  // Title
  summarySheet.getCell(`A${summaryRow}`).value = 'Test Case Summary Report';
  summarySheet.getCell(`A${summaryRow}`).font = { bold: true, size: 16, name: 'Arial' };
  summarySheet.mergeCells(`A${summaryRow}:C${summaryRow}`);
  summaryRow += 2;

  // Metadata
  summarySheet.getCell(`A${summaryRow}`).value = 'User Story:';
  summarySheet.getCell(`A${summaryRow}`).font = { bold: true, name: 'Arial' };
  summarySheet.getCell(`B${summaryRow}`).value = data.metadata.storyTitle;
  summarySheet.mergeCells(`B${summaryRow}:C${summaryRow}`);
  summaryRow++;

  if (data.metadata.projectName) {
    summarySheet.getCell(`A${summaryRow}`).value = 'Project:';
    summarySheet.getCell(`A${summaryRow}`).font = { bold: true, name: 'Arial' };
    summarySheet.getCell(`B${summaryRow}`).value = data.metadata.projectName;
    summaryRow++;
  }

  summarySheet.getCell(`A${summaryRow}`).value = 'Generated Date:';
  summarySheet.getCell(`A${summaryRow}`).font = { bold: true, name: 'Arial' };
  summarySheet.getCell(`B${summaryRow}`).value = new Date().toLocaleDateString();
  summaryRow += 2;

  // **CRITICAL: Check if any test cases were added**
  if (totalTests === 0) {
    console.error("[Excel Formatter] ❌ No test cases found in any category!");
    console.error("[Excel Formatter] Category stats:", categoryStats);
    console.error("[Excel Formatter] Data structure:", {
      hasFunctional: !!data.testCases.functional,
      hasNegative: !!data.testCases.negative,
      hasEdgeCases: !!data.testCases.edgeCases,
      hasAccessibility: !!data.testCases.accessibility
    });
    throw new Error('No test cases found to export. Please generate test cases first.');
  }
  
  // Total test cases
  summarySheet.getCell(`A${summaryRow}`).value = 'Total Test Cases:';
  summarySheet.getCell(`A${summaryRow}`).font = { bold: true, size: 12, name: 'Arial' };
  summarySheet.getCell(`B${summaryRow}`).value = totalTests;
  summarySheet.getCell(`B${summaryRow}`).font = { bold: true, size: 12, name: 'Arial', color: { argb: 'FF0066CC' } };
  summaryRow += 2;

  // Category breakdown
  summarySheet.getCell(`A${summaryRow}`).value = 'Category Breakdown:';
  summarySheet.getCell(`A${summaryRow}`).font = { bold: true, size: 11, name: 'Arial' };
  summaryRow++;

  Object.entries(categoryStats).forEach(([category, count]) => {
    summarySheet.getCell(`A${summaryRow}`).value = category;
    summarySheet.getCell(`B${summaryRow}`).value = count;
    summarySheet.getCell(`C${summaryRow}`).value = `${((count / totalTests) * 100).toFixed(1)}%`;
    
    // Apply category color
    summarySheet.getCell(`A${summaryRow}`).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: CATEGORY_COLORS[category as keyof typeof CATEGORY_COLORS] || 'FFFFFFFF' }
    };
    summaryRow++;
  });
  summaryRow++;

  // Priority breakdown
  summarySheet.getCell(`A${summaryRow}`).value = 'Priority Breakdown:';
  summarySheet.getCell(`A${summaryRow}`).font = { bold: true, size: 11, name: 'Arial' };
  summaryRow++;

  Object.entries(priorityStats).forEach(([priority, count]) => {
    summarySheet.getCell(`A${summaryRow}`).value = priority;
    summarySheet.getCell(`B${summaryRow}`).value = count;
    summarySheet.getCell(`C${summaryRow}`).value = `${((count / totalTests) * 100).toFixed(1)}%`;
    
    // Apply priority color
    const colors = PRIORITY_COLORS[priority as keyof typeof PRIORITY_COLORS];
    if (colors) {
      summarySheet.getCell(`A${summaryRow}`).fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: colors.bg }
      };
      summarySheet.getCell(`A${summaryRow}`).font = {
        bold: true,
        color: { argb: colors.font },
        name: 'Arial'
      };
    }
    summaryRow++;
  });

  // Generate buffer
  console.log("[Excel Formatter] Generating Excel buffer...");
  const buffer = await workbook.xlsx.writeBuffer();
  const finalBuffer = Buffer.from(buffer);
  
  console.log("[Excel Formatter] ✅ Excel file generated successfully:", {
    bufferSize: finalBuffer.length,
    totalTestCases: totalTests,
    categoryCounts: categoryStats
  });
  
  return finalBuffer;
}

function applyPriorityColor(cell: ExcelJS.Cell, priority: string) {
  const colors = PRIORITY_COLORS[priority as keyof typeof PRIORITY_COLORS];
  
  if (colors) {
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: colors.bg }
    };
    cell.font = {
      bold: true,
      color: { argb: colors.font },
      name: 'Arial',
      size: 10
    };
  }
}

function applyCategoryColor(cell: ExcelJS.Cell, category: string) {
  const color = CATEGORY_COLORS[category as keyof typeof CATEGORY_COLORS];
  
  if (color) {
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: color }
    };
    cell.font = {
      bold: true,
      name: 'Arial',
      size: 10
    };
  }
}
