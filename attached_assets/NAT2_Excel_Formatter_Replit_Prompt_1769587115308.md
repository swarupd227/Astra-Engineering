# NAT 2.0 - Test Case Excel Formatter Module
## Replit Development Prompt

---

## PROJECT CONTEXT

I am building NAT 2.0 (Nous Autonomous Tester 2.0), an AI-powered autonomous testing platform. The platform generates test cases from user stories and currently outputs them in a basic format. I need to add a **Professional Excel Export Module** that reformats the generated test cases into a standardized, professionally formatted Excel file.

---

## FEATURE REQUIREMENTS

### 1. INPUT FORMAT (Current Test Case Structure)

The test case generator currently produces test cases in this JSON/object structure:

```javascript
{
  testCases: [
    {
      id: "uuid-string",                    // Auto-generated UUID
      title: "Test case title",             // Test case name
      description: "Optional description",   // Can be null
      category: "functional",               // functional | accessibility | security | negative | edge_case
      priority: "P0",                       // P0 | P1 | P2 | P3 | P4
      preconditions: "Pre-requisites",      // Can be null
      steps: [
        { stepNumber: 1, action: "Step action text", expected: "Expected result text" },
        { stepNumber: 2, action: "Step action text", expected: "Expected result text" },
        // ... more steps
      ]
    },
    // ... more test cases
  ],
  metadata: {
    projectName: "Project Name",
    sprintName: "Sprint 1",
    generatedAt: "2025-01-28T10:30:00Z",
    totalTestCases: 36,
    domain: "Insurance"  // Insurance | Healthcare | Banking | Fintech
  }
}
```

---

### 2. OUTPUT FORMAT (Excel Structure)

Generate a professionally formatted .xlsx file with the following structure:

#### Sheet 1: "Test Cases" (Main Sheet)

| Column | Header | Description | Width |
|--------|--------|-------------|-------|
| A | Test Case ID | Sequential ID (TC-001, TC-002, etc.) | 12 |
| B | Test Case Title | Full test case name | 60 |
| C | Category | Test category (Functional, Security, etc.) | 15 |
| D | Priority | P0, P1, P2, P3, P4 | 10 |
| E | Preconditions | Pre-requisites for test | 25 |
| F | Step # | Step number (1, 2, 3, etc.) | 8 |
| G | Test Step | Action to perform | 70 |
| H | Expected Result | Expected outcome | 70 |

**CRITICAL FORMATTING RULES:**

1. **One Step Per Row**: Each test step should be on its own row
2. **Merged Cells**: For multi-step test cases, merge columns A-E (TC ID, Title, Category, Priority, Preconditions) across all step rows
3. **Sequential TC IDs**: Generate proper sequential IDs (TC-001, TC-002, TC-003...) instead of UUIDs

#### Sheet 2: "Summary" (Statistics Sheet)

Display test case statistics:
- Total Test Cases count
- Priority Breakdown (P0, P1, P2, P3, P4 counts)
- Category Breakdown (Functional, Security, Accessibility, etc. counts)

---

### 3. STYLING SPECIFICATIONS

#### Header Row Styling
```javascript
{
  backgroundColor: "#1F4E79",  // Dark Blue
  fontColor: "#FFFFFF",        // White
  fontWeight: "bold",
  fontSize: 11,
  fontFamily: "Arial",
  horizontalAlignment: "center",
  verticalAlignment: "center",
  wrapText: true,
  borderStyle: "medium"
}
```

#### Priority Color Coding (IMPORTANT)
```javascript
const priorityColors = {
  "P0": { 
    backgroundColor: "#FF0000",  // Red - Critical
    fontColor: "#FFFFFF",        // White text
    fontWeight: "bold"
  },
  "P1": { 
    backgroundColor: "#FFA500",  // Orange - High
    fontColor: "#000000",        // Black text
    fontWeight: "bold"
  },
  "P2": { 
    backgroundColor: "#FFFF00",  // Yellow - Medium
    fontColor: "#000000",        // Black text
    fontWeight: "bold"
  },
  "P3": { 
    backgroundColor: "#90EE90",  // Light Green - Low
    fontColor: "#000000",        // Black text
    fontWeight: "bold"
  },
  "P4": { 
    backgroundColor: "#ADD8E6",  // Light Blue - Lowest
    fontColor: "#000000",        // Black text
    fontWeight: "bold"
  }
};
```

#### Category Color Coding
```javascript
const categoryColors = {
  "functional":    { backgroundColor: "#E2EFDA" },  // Light Green
  "accessibility": { backgroundColor: "#DDEBF7" },  // Light Blue
  "security":      { backgroundColor: "#FCE4D6" },  // Light Orange
  "negative":      { backgroundColor: "#F8CBAD" },  // Peach
  "edge_case":     { backgroundColor: "#E4DFEC" }   // Light Purple
};
```

#### Cell Styling
```javascript
{
  fontFamily: "Arial",
  fontSize: 10,
  borderStyle: "thin",
  borderColor: "#000000",
  wrapText: true,
  verticalAlignment: "center"
}
```

---

### 4. IMPLEMENTATION REQUIREMENTS

#### Technology Stack
- **Backend**: Node.js with Express
- **Excel Library**: Use `exceljs` npm package (preferred) or `xlsx-js-style`
- **File Handling**: Generate file in memory, return as downloadable blob

#### API Endpoint
```javascript
POST /api/export/test-cases/excel

// Request Body
{
  testCases: [...],      // Array of test case objects
  metadata: {...},       // Project metadata
  format: "detailed"     // "detailed" | "summary" (optional)
}

// Response
// Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet
// Content-Disposition: attachment; filename="NAT2_TestCases_Sprint1_2025-01-28.xlsx"
```

#### Frontend Integration
```javascript
// React component for export button
const handleExportExcel = async () => {
  setExporting(true);
  try {
    const response = await fetch('/api/export/test-cases/excel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ testCases, metadata })
    });
    
    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `NAT2_TestCases_${metadata.sprintName}_${new Date().toISOString().split('T')[0]}.xlsx`;
    a.click();
    window.URL.revokeObjectURL(url);
  } catch (error) {
    console.error('Export failed:', error);
  } finally {
    setExporting(false);
  }
};
```

---

### 5. SAMPLE CODE STRUCTURE

```javascript
// server/routes/export.js
const ExcelJS = require('exceljs');
const express = require('express');
const router = express.Router();

router.post('/test-cases/excel', async (req, res) => {
  const { testCases, metadata } = req.body;
  
  // Create workbook
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'NAT 2.0';
  workbook.created = new Date();
  
  // Create Test Cases sheet
  const testSheet = workbook.addWorksheet('Test Cases', {
    views: [{ state: 'frozen', xSplit: 0, ySplit: 1 }]  // Freeze header row
  });
  
  // Define columns
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
  
  // Style header row
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
  
  // Process test cases
  let currentRow = 2;
  let tcCounter = 1;
  
  testCases.forEach((tc) => {
    const tcId = `TC-${String(tcCounter).padStart(3, '0')}`;
    const steps = tc.steps || [{ stepNumber: 1, action: 'N/A', expected: 'N/A' }];
    const startRow = currentRow;
    
    steps.forEach((step, stepIndex) => {
      const row = testSheet.getRow(currentRow);
      
      // Only add TC info on first step row
      if (stepIndex === 0) {
        row.getCell('tcId').value = tcId;
        row.getCell('title').value = tc.title;
        row.getCell('category').value = capitalizeFirst(tc.category);
        row.getCell('priority').value = tc.priority;
        row.getCell('preconditions').value = tc.preconditions || 'N/A';
        
        // Apply priority color
        applyPriorityColor(row.getCell('priority'), tc.priority);
        
        // Apply category color
        applyCategoryColor(row.getCell('category'), tc.category);
      }
      
      row.getCell('stepNum').value = step.stepNumber || stepIndex + 1;
      row.getCell('testStep').value = step.action;
      row.getCell('expected').value = step.expected;
      
      // Apply cell styling
      row.eachCell({ includeEmpty: true }, (cell) => {
        cell.font = { name: 'Arial', size: 10 };
        cell.alignment = { wrapText: true, vertical: 'middle' };
        cell.border = {
          top: { style: 'thin' },
          left: { style: 'thin' },
          bottom: { style: 'thin' },
          right: { style: 'thin' }
        };
      });
      
      // Bold TC ID and Step Number
      row.getCell('tcId').font = { bold: true, name: 'Arial', size: 10 };
      row.getCell('stepNum').font = { bold: true, name: 'Arial', size: 10 };
      row.getCell('stepNum').alignment = { horizontal: 'center', vertical: 'middle' };
      
      currentRow++;
    });
    
    // Merge cells for multi-step test cases
    if (steps.length > 1) {
      const endRow = currentRow - 1;
      ['A', 'B', 'C', 'D', 'E'].forEach((col) => {
        testSheet.mergeCells(`${col}${startRow}:${col}${endRow}`);
      });
    }
    
    tcCounter++;
  });
  
  // Create Summary sheet
  const summarySheet = workbook.addWorksheet('Summary');
  // ... add summary statistics
  
  // Generate buffer and send response
  const buffer = await workbook.xlsx.writeBuffer();
  
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="NAT2_TestCases_${metadata.sprintName || 'Export'}_${new Date().toISOString().split('T')[0]}.xlsx"`);
  res.send(buffer);
});

// Helper functions
function applyPriorityColor(cell, priority) {
  const colors = {
    'P0': { bg: 'FFFF0000', font: 'FFFFFFFF' },
    'P1': { bg: 'FFFFA500', font: 'FF000000' },
    'P2': { bg: 'FFFFFF00', font: 'FF000000' },
    'P3': { bg: 'FF90EE90', font: 'FF000000' },
    'P4': { bg: 'FFADD8E6', font: 'FF000000' }
  };
  
  if (colors[priority]) {
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: colors[priority].bg }
    };
    cell.font = { bold: true, color: { argb: colors[priority].font }, name: 'Arial' };
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
  }
}

function applyCategoryColor(cell, category) {
  const colors = {
    'functional': 'FFE2EFDA',
    'accessibility': 'FFDDEBF7',
    'security': 'FFFCE4D6',
    'negative': 'FFF8CBAD',
    'edge_case': 'FFE4DFEC'
  };
  
  const lowerCategory = category?.toLowerCase();
  if (colors[lowerCategory]) {
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: colors[lowerCategory] }
    };
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
  }
}

function capitalizeFirst(str) {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase().replace('_', ' ');
}

module.exports = router;
```

---

### 6. UI COMPONENT FOR EXPORT

```jsx
// components/ExportButton.jsx
import React, { useState } from 'react';
import { Download, FileSpreadsheet, Loader2 } from 'lucide-react';

const ExportExcelButton = ({ testCases, metadata, disabled }) => {
  const [exporting, setExporting] = useState(false);

  const handleExport = async () => {
    if (!testCases || testCases.length === 0) {
      alert('No test cases to export');
      return;
    }

    setExporting(true);
    try {
      const response = await fetch('/api/export/test-cases/excel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ testCases, metadata })
      });

      if (!response.ok) throw new Error('Export failed');

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `NAT2_TestCases_${metadata?.sprintName || 'Export'}_${new Date().toISOString().split('T')[0]}.xlsx`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Export error:', error);
      alert('Failed to export test cases');
    } finally {
      setExporting(false);
    }
  };

  return (
    <button
      onClick={handleExport}
      disabled={disabled || exporting || !testCases?.length}
      className="flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 
                 disabled:bg-gray-500 disabled:cursor-not-allowed text-white rounded-lg 
                 transition-all duration-200 font-medium"
    >
      {exporting ? (
        <>
          <Loader2 className="w-4 h-4 animate-spin" />
          Exporting...
        </>
      ) : (
        <>
          <FileSpreadsheet className="w-4 h-4" />
          Export to Excel
        </>
      )}
    </button>
  );
};

export default ExportExcelButton;
```

---

### 7. ADDITIONAL FEATURES (OPTIONAL ENHANCEMENTS)

1. **Export Format Options**:
   - Detailed format (one step per row) - DEFAULT
   - Compact format (all steps in single cell)
   - Summary only format

2. **Include/Exclude Options**:
   - Toggle for including Summary sheet
   - Toggle for including metadata
   - Filter by priority (export only P0, P1, etc.)
   - Filter by category

3. **Custom Branding**:
   - Add company logo to header
   - Custom header/footer text
   - Configurable color schemes

4. **Validation & Error Handling**:
   - Validate test case structure before export
   - Handle empty steps gracefully
   - Maximum file size handling

---

### 8. DEPENDENCIES TO INSTALL

```bash
npm install exceljs
```

---

### 9. FILE STRUCTURE

```
/server
  /routes
    export.js           # Excel export API endpoint
  /utils
    excelFormatter.js   # Excel formatting utilities
    
/components
  ExportExcelButton.jsx  # React export button component
  ExportOptionsModal.jsx # Export options dialog (optional)
```

---

### 10. TESTING CHECKLIST

- [ ] Export generates valid .xlsx file
- [ ] Test Case IDs are sequential (TC-001, TC-002, etc.)
- [ ] Each step appears on separate row
- [ ] Cells properly merged for multi-step test cases
- [ ] Priority colors applied correctly (P0=Red, P1=Orange, etc.)
- [ ] Category colors applied correctly
- [ ] Header row is frozen
- [ ] Summary sheet shows accurate statistics
- [ ] File downloads with correct filename
- [ ] Works with 100+ test cases
- [ ] Handles empty/null values gracefully

---

## EXPECTED OUTPUT

When a user clicks "Export to Excel", the system should:

1. Generate a professionally formatted .xlsx file
2. Auto-download with filename: `NAT2_TestCases_Sprint1_2025-01-28.xlsx`
3. File contains two sheets: "Test Cases" and "Summary"
4. All formatting, colors, and merged cells are properly applied
5. File opens correctly in Microsoft Excel, Google Sheets, and LibreOffice

---

## PRIORITY LEGEND FOR REFERENCE

| Priority | Color | Meaning | Font Color |
|----------|-------|---------|------------|
| P0 | 🔴 Red (#FF0000) | Critical - Blocker | White |
| P1 | 🟠 Orange (#FFA500) | High - Major functionality | Black |
| P2 | 🟡 Yellow (#FFFF00) | Medium - Important | Black |
| P3 | 🟢 Light Green (#90EE90) | Low - Minor | Black |
| P4 | 🔵 Light Blue (#ADD8E6) | Lowest - Nice to have | Black |

---

**END OF PROMPT**

Copy this entire prompt into Replit Agent to implement the Excel export functionality for NAT 2.0.
