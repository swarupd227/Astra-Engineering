import * as fs from 'fs';
import * as path from 'path';
import * as XLSX from 'xlsx';

export interface ParsedFileContent {
  type: 'excel' | 'pdf';
  filename: string;
  sheets?: SheetData[];
  textContent?: string;
  tables?: TableData[];
  metadata?: {
    rowCount: number;
    columnCount: number;
    pageCount?: number;
  };
}

export interface SheetData {
  name: string;
  headers: string[];
  rows: Record<string, any>[];
  rawData: any[][];
}

export interface TableData {
  headers: string[];
  rows: string[][];
  pageNumber?: number;
}

export interface CellDifference {
  row: number;
  column: string;
  sheetName?: string;
  sourceValue: string;
  targetValue: string;
  difference: string;
  percentDiff?: number;
  status: 'exact' | 'tolerance' | 'mismatch';
  aiAnalysis?: string;
}

export interface ValidationConfig {
  comparisonMode: 'strict' | 'tolerant' | 'smart';
  numericTolerance: number;
  percentageTolerance: number;
  dateHandling: 'strict' | 'flexible';
  ignoreColumns: string[];
  caseSensitive: boolean;
  whitespaceHandling: 'strict' | 'trim' | 'normalize';
}

export interface ValidationResult {
  status: 'pass' | 'fail' | 'warning';
  matchPercentage: number;
  summary: {
    totalCells: number;
    matchedCells: number;
    toleranceCells: number;
    mismatchedCells: number;
    sourceRowCount: number;
    targetRowCount: number;
    sourceColumnCount: number;
    targetColumnCount: number;
    criticalIssues: number;
    warnings: number;
  };
  differences: CellDifference[];
  sourcePreview: any;
  targetPreview: any;
  aiAnalysis?: string;
}

export async function parseExcelFile(buffer: Buffer, filename: string): Promise<ParsedFileContent> {
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const sheets: SheetData[] = [];
  
  let totalRows = 0;
  let maxColumns = 0;
  
  for (const sheetName of workbook.SheetNames) {
    const worksheet = workbook.Sheets[sheetName];
    const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 }) as any[][];
    
    if (jsonData.length === 0) continue;
    
    const headers = (jsonData[0] || []).map((h: any, i: number) => 
      h !== undefined && h !== null && h !== '' ? String(h) : `Column_${i + 1}`
    );
    
    const rows: Record<string, any>[] = [];
    for (let i = 1; i < jsonData.length; i++) {
      const row = jsonData[i];
      if (!row || row.every((cell: any) => cell === undefined || cell === null || cell === '')) continue;
      
      const rowObj: Record<string, any> = {};
      for (let j = 0; j < headers.length; j++) {
        rowObj[headers[j]] = row[j] !== undefined ? row[j] : '';
      }
      rows.push(rowObj);
    }
    
    totalRows += rows.length;
    maxColumns = Math.max(maxColumns, headers.length);
    
    sheets.push({
      name: sheetName,
      headers,
      rows,
      rawData: jsonData
    });
  }
  
  return {
    type: 'excel',
    filename,
    sheets,
    metadata: {
      rowCount: totalRows,
      columnCount: maxColumns
    }
  };
}

export async function parsePdfFile(buffer: Buffer, filename: string): Promise<ParsedFileContent> {
  // Use pdfjs-dist for reliable PDF parsing in ESM environment
  const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
  
  // Convert Buffer to Uint8Array for pdfjs-dist
  const uint8Array = new Uint8Array(buffer);
  
  // Load the PDF document with worker DISABLED for Node.js server-side use
  const loadingTask = pdfjsLib.getDocument({ 
    data: uint8Array,
    disableWorker: true,
    isEvalSupported: false,
    useSystemFonts: true
  });
  const pdfDoc = await loadingTask.promise;
  
  // Extract text from all pages with position information
  const allLines: string[] = [];
  for (let pageNum = 1; pageNum <= pdfDoc.numPages; pageNum++) {
    const page = await pdfDoc.getPage(pageNum);
    const textContent = await page.getTextContent();
    
    // Group text items by their Y position to reconstruct lines
    const itemsByY: Map<number, { x: number; str: string }[]> = new Map();
    for (const item of textContent.items) {
      const typedItem = item as any;
      if (!typedItem.str || typedItem.str.trim() === '') continue;
      
      // Round Y position to group items on the same line (within 2px tolerance)
      const y = Math.round(typedItem.transform[5] / 2) * 2;
      if (!itemsByY.has(y)) {
        itemsByY.set(y, []);
      }
      itemsByY.get(y)!.push({ x: typedItem.transform[4], str: typedItem.str });
    }
    
    // Sort by Y (descending for top-to-bottom) then reconstruct lines
    const sortedYs = Array.from(itemsByY.keys()).sort((a, b) => b - a);
    for (const y of sortedYs) {
      const items = itemsByY.get(y)!;
      // Sort by X position (left to right)
      items.sort((a, b) => a.x - b.x);
      const lineText = items.map(i => i.str).join(' ');
      if (lineText.trim()) {
        allLines.push(lineText.trim());
      }
    }
  }
  
  const fullText = allLines.join('\n');
  
  // Try to extract tabular data from PDF text
  const tables: TableData[] = [];
  const tableLines: string[][] = [];
  
  // Improved heuristic: look for lines with consistent separators (require at least 2 cells)
  for (const line of allLines) {
    // Split by tabs, multiple spaces (2+), or common delimiters
    let cells = line.split(/\t/).map((c: string) => c.trim()).filter((c: string) => c);
    
    // If tab split didn't work well, try multiple spaces
    if (cells.length < 2) {
      cells = line.split(/\s{2,}/).map((c: string) => c.trim()).filter((c: string) => c);
    }
    
    // If still single cell, try single space but only if it looks like structured data
    if (cells.length < 2 && /\d/.test(line)) {
      cells = line.split(/\s+/).map((c: string) => c.trim()).filter((c: string) => c);
    }
    
    // Only include lines with at least 2 cells (actual tabular data)
    if (cells.length >= 2) {
      tableLines.push(cells);
    }
  }
  
  if (tableLines.length >= 2) { // Need at least header + 1 data row
    // Find the most common column count to detect header row
    const columnCounts = tableLines.map(r => r.length);
    const countFrequency: Record<number, number> = {};
    for (const count of columnCounts) {
      countFrequency[count] = (countFrequency[count] || 0) + 1;
    }
    const mostCommonCount = Object.entries(countFrequency)
      .sort((a, b) => b[1] - a[1])[0]?.[0];
    
    if (mostCommonCount) {
      // Filter rows to those matching the most common column count
      const consistentRows = tableLines.filter(r => r.length === Number(mostCommonCount));
      
      // Require at least 2 consistent rows (header + 1 data) to be considered a table
      if (consistentRows.length >= 2) {
        const headers = consistentRows[0];
        const rows = consistentRows.slice(1);
        
        tables.push({
          headers,
          rows
        });
      }
    }
  }
  
  return {
    type: 'pdf',
    filename,
    textContent: fullText,
    tables,
    metadata: {
      rowCount: tables.length > 0 && tables[0].rows ? tables[0].rows.length : allLines.length,
      columnCount: tables.length > 0 && tables[0].headers ? tables[0].headers.length : 1,
      pageCount: pdfDoc.numPages
    }
  };
}

export async function parseFile(buffer: Buffer, filename: string): Promise<ParsedFileContent> {
  const ext = path.extname(filename).toLowerCase();
  
  if (ext === '.xlsx' || ext === '.xls') {
    return parseExcelFile(buffer, filename);
  } else if (ext === '.pdf') {
    return parsePdfFile(buffer, filename);
  }
  
  throw new Error(`Unsupported file type: ${ext}`);
}

function normalizeValue(value: any, config: ValidationConfig): string {
  if (value === null || value === undefined) return '';
  
  let str = String(value);
  
  // Whitespace handling
  if (config.whitespaceHandling === 'trim') {
    str = str.trim();
  } else if (config.whitespaceHandling === 'normalize') {
    str = str.replace(/\s+/g, ' ').trim();
  }
  
  // Case sensitivity
  if (!config.caseSensitive) {
    str = str.toLowerCase();
  }
  
  return str;
}

function isNumeric(value: string): boolean {
  if (!value || value.trim() === '') return false;
  const cleaned = value.replace(/[,$%]/g, '');
  return !isNaN(parseFloat(cleaned)) && isFinite(Number(cleaned));
}

function getNumericValue(value: string): number {
  const cleaned = value.replace(/[,$%]/g, '');
  return parseFloat(cleaned);
}

function compareCellValues(
  sourceVal: any,
  targetVal: any,
  config: ValidationConfig
): { status: 'exact' | 'tolerance' | 'mismatch'; difference: string; percentDiff?: number } {
  const sourceStr = normalizeValue(sourceVal, config);
  const targetStr = normalizeValue(targetVal, config);
  
  // Exact match
  if (sourceStr === targetStr) {
    return { status: 'exact', difference: '' };
  }
  
  // Empty vs non-empty
  if ((sourceStr === '' && targetStr !== '') || (sourceStr !== '' && targetStr === '')) {
    return { 
      status: 'mismatch', 
      difference: sourceStr === '' ? 'Source empty' : 'Target empty' 
    };
  }
  
  // Numeric comparison with tolerance
  if (isNumeric(sourceStr) && isNumeric(targetStr)) {
    const sourceNum = getNumericValue(sourceStr);
    const targetNum = getNumericValue(targetStr);
    const diff = Math.abs(sourceNum - targetNum);
    
    // Check absolute tolerance
    if (diff <= config.numericTolerance) {
      return { 
        status: 'tolerance', 
        difference: (targetNum - sourceNum).toFixed(4),
        percentDiff: sourceNum !== 0 ? (diff / Math.abs(sourceNum)) * 100 : 0
      };
    }
    
    // Check percentage tolerance
    if (sourceNum !== 0) {
      const percentDiff = (diff / Math.abs(sourceNum)) * 100;
      if (percentDiff <= config.percentageTolerance) {
        return { 
          status: 'tolerance', 
          difference: (targetNum - sourceNum).toFixed(4),
          percentDiff
        };
      }
    }
    
    return { 
      status: 'mismatch', 
      difference: (targetNum - sourceNum).toFixed(4),
      percentDiff: sourceNum !== 0 ? (Math.abs(targetNum - sourceNum) / Math.abs(sourceNum)) * 100 : undefined
    };
  }
  
  // String mismatch
  return { status: 'mismatch', difference: 'Text mismatch' };
}

export function compareFiles(
  source: ParsedFileContent,
  target: ParsedFileContent,
  config: ValidationConfig
): ValidationResult {
  const differences: CellDifference[] = [];
  let totalCells = 0;
  let matchedCells = 0;
  let toleranceCells = 0;
  let mismatchedCells = 0;
  
  const ignoreColumnsSet = new Set(
    config.ignoreColumns.map((c: string) => config.caseSensitive ? c : c.toLowerCase())
  );
  
  // Get source and target data for comparison
  let sourceRows: Record<string, any>[] = [];
  let targetRows: Record<string, any>[] = [];
  let sourceHeaders: string[] = [];
  let targetHeaders: string[] = [];
  let sheetName = 'Sheet1';
  
  // For PDF-to-PDF comparison, normalize both to use the same comparison mode
  // If either PDF lacks tables, use text-based comparison for both
  const bothArePdfs = source.type === 'pdf' && target.type === 'pdf';
  const sourceHasTables = source.tables && source.tables.length > 0;
  const targetHasTables = target.tables && target.tables.length > 0;
  const useTextComparison = bothArePdfs && (!sourceHasTables || !targetHasTables);
  
  if (source.type === 'excel' && source.sheets && source.sheets.length > 0) {
    sheetName = source.sheets[0].name;
    sourceHeaders = source.sheets[0].headers;
    sourceRows = source.sheets[0].rows;
  } else if (source.type === 'pdf' && sourceHasTables && !useTextComparison) {
    sourceHeaders = source.tables![0].headers;
    sourceRows = source.tables![0].rows.map(row => {
      const obj: Record<string, any> = {};
      sourceHeaders.forEach((h, i) => { obj[h] = row[i] || ''; });
      return obj;
    });
  } else if (source.type === 'pdf') {
    // For PDFs without tables or when normalizing, use text content line-by-line
    const lines = (source.textContent || '').split('\n').filter(l => l.trim());
    sourceHeaders = ['Line', 'Content'];
    sourceRows = lines.map((line, i) => ({ 'Line': i + 1, 'Content': line }));
  }
  
  if (target.type === 'excel' && target.sheets && target.sheets.length > 0) {
    targetHeaders = target.sheets[0].headers;
    targetRows = target.sheets[0].rows;
  } else if (target.type === 'pdf' && targetHasTables && !useTextComparison) {
    targetHeaders = target.tables![0].headers;
    targetRows = target.tables![0].rows.map(row => {
      const obj: Record<string, any> = {};
      targetHeaders.forEach((h, i) => { obj[h] = row[i] || ''; });
      return obj;
    });
  } else if (target.type === 'pdf') {
    // For PDFs without tables or when normalizing, use text content line-by-line
    const lines = (target.textContent || '').split('\n').filter(l => l.trim());
    targetHeaders = ['Line', 'Content'];
    targetRows = lines.map((line, i) => ({ 'Line': i + 1, 'Content': line }));
  }
  
  // Validate we have data to compare
  if (sourceRows.length === 0 && targetRows.length === 0) {
    return {
      status: 'warning',
      matchPercentage: 0,
      summary: {
        totalCells: 0,
        matchedCells: 0,
        toleranceCells: 0,
        mismatchedCells: 0,
        sourceRowCount: 0,
        targetRowCount: 0,
        sourceColumnCount: 0,
        targetColumnCount: 0,
        criticalIssues: 1,
        warnings: 1
      },
      differences: [],
      sourcePreview: [],
      targetPreview: [],
      aiAnalysis: 'No tabular data could be extracted from either file. Please ensure the files contain structured data.'
    };
  }
  
  // Use the union of headers for comparison
  const allHeaders = Array.from(new Set([...sourceHeaders, ...targetHeaders]));
  
  // Compare row by row
  const maxRows = Math.max(sourceRows.length, targetRows.length);
  
  for (let i = 0; i < maxRows; i++) {
    const sourceRow = sourceRows[i] || {};
    const targetRow = targetRows[i] || {};
    
    for (const header of allHeaders) {
      // Check if column should be ignored
      const headerKey = config.caseSensitive ? header : header.toLowerCase();
      if (ignoreColumnsSet.has(headerKey)) continue;
      
      totalCells++;
      const sourceVal = sourceRow[header];
      const targetVal = targetRow[header];
      
      const comparison = compareCellValues(sourceVal, targetVal, config);
      
      if (comparison.status === 'exact') {
        matchedCells++;
      } else if (comparison.status === 'tolerance') {
        toleranceCells++;
        differences.push({
          row: i + 1,
          column: header,
          sheetName,
          sourceValue: String(sourceVal ?? ''),
          targetValue: String(targetVal ?? ''),
          difference: comparison.difference,
          percentDiff: comparison.percentDiff,
          status: 'tolerance'
        });
      } else {
        mismatchedCells++;
        differences.push({
          row: i + 1,
          column: header,
          sheetName,
          sourceValue: String(sourceVal ?? ''),
          targetValue: String(targetVal ?? ''),
          difference: comparison.difference,
          percentDiff: comparison.percentDiff,
          status: 'mismatch'
        });
      }
    }
  }
  
  // Calculate match percentage
  const matchPercentage = totalCells > 0 
    ? Math.round(((matchedCells + toleranceCells) / totalCells) * 1000) / 10
    : 100;
  
  // Determine status
  let status: 'pass' | 'fail' | 'warning' = 'pass';
  if (mismatchedCells > 0) {
    status = mismatchedCells > totalCells * 0.05 ? 'fail' : 'warning';
  } else if (toleranceCells > totalCells * 0.1) {
    status = 'warning';
  }
  
  // Create preview data (first 10 rows)
  const sourcePreview = sourceRows.slice(0, 10).map((row, i) => ({ rowNum: i + 1, ...row }));
  const targetPreview = targetRows.slice(0, 10).map((row, i) => ({ rowNum: i + 1, ...row }));
  
  return {
    status,
    matchPercentage,
    summary: {
      totalCells,
      matchedCells,
      toleranceCells,
      mismatchedCells,
      sourceRowCount: sourceRows.length,
      targetRowCount: targetRows.length,
      sourceColumnCount: sourceHeaders.length,
      targetColumnCount: targetHeaders.length,
      criticalIssues: mismatchedCells > totalCells * 0.1 ? 1 : 0,
      warnings: toleranceCells > 0 ? 1 : 0 + (sourceRows.length !== targetRows.length ? 1 : 0)
    },
    differences: differences.slice(0, 100), // Limit to first 100 differences
    sourcePreview,
    targetPreview
  };
}

export function generateAIAnalysis(result: ValidationResult, source: ParsedFileContent, target: ParsedFileContent): string {
  const { summary, differences, matchPercentage, status } = result;
  
  let analysis = `## Validation Summary\n\n`;
  
  if (status === 'pass') {
    analysis += `The SSRS to PowerBI migration shows **${matchPercentage}% match rate** with no critical issues.\n\n`;
  } else if (status === 'warning') {
    analysis += `The SSRS to PowerBI migration shows **${matchPercentage}% match rate** with some minor discrepancies.\n\n`;
  } else {
    analysis += `The SSRS to PowerBI migration shows **${matchPercentage}% match rate** with significant differences that require attention.\n\n`;
  }
  
  analysis += `### Source File: ${source.filename}\n`;
  analysis += `- Type: ${source.type.toUpperCase()}\n`;
  analysis += `- Rows: ${summary.sourceRowCount}\n`;
  analysis += `- Columns: ${summary.sourceColumnCount}\n\n`;
  
  analysis += `### Target File: ${target.filename}\n`;
  analysis += `- Type: ${target.type.toUpperCase()}\n`;
  analysis += `- Rows: ${summary.targetRowCount}\n`;
  analysis += `- Columns: ${summary.targetColumnCount}\n\n`;
  
  analysis += `### Comparison Statistics\n`;
  analysis += `- Total Cells Compared: ${summary.totalCells.toLocaleString()}\n`;
  analysis += `- Exact Matches: ${summary.matchedCells.toLocaleString()} (${((summary.matchedCells / summary.totalCells) * 100).toFixed(1)}%)\n`;
  analysis += `- Within Tolerance: ${summary.toleranceCells.toLocaleString()}\n`;
  analysis += `- Mismatches: ${summary.mismatchedCells.toLocaleString()}\n\n`;
  
  if (summary.sourceRowCount !== summary.targetRowCount) {
    analysis += `### Row Count Discrepancy\n`;
    analysis += `Source has ${summary.sourceRowCount} rows, target has ${summary.targetRowCount} rows. `;
    analysis += `Difference: ${Math.abs(summary.sourceRowCount - summary.targetRowCount)} rows.\n\n`;
  }
  
  if (differences.length > 0) {
    // Group differences by column
    const byColumn: Record<string, CellDifference[]> = {};
    for (const diff of differences) {
      if (!byColumn[diff.column]) byColumn[diff.column] = [];
      byColumn[diff.column].push(diff);
    }
    
    analysis += `### Key Findings\n`;
    for (const [column, diffs] of Object.entries(byColumn).slice(0, 5)) {
      const toleranceCount = diffs.filter(d => d.status === 'tolerance').length;
      const mismatchCount = diffs.filter(d => d.status === 'mismatch').length;
      
      if (mismatchCount > 0) {
        analysis += `- **${column}**: ${mismatchCount} mismatch${mismatchCount > 1 ? 'es' : ''}\n`;
      }
      if (toleranceCount > 0) {
        analysis += `- **${column}**: ${toleranceCount} value${toleranceCount > 1 ? 's' : ''} within tolerance\n`;
      }
    }
    analysis += '\n';
  }
  
  analysis += `### Recommendations\n`;
  if (status === 'pass') {
    analysis += `- Migration is **APPROVED** for production\n`;
  } else if (status === 'warning') {
    analysis += `- Review the ${summary.toleranceCells + summary.mismatchedCells} differences before production deployment\n`;
    analysis += `- Consider adjusting tolerance thresholds if rounding differences are acceptable\n`;
  } else {
    analysis += `- **DO NOT DEPLOY** until differences are resolved\n`;
    analysis += `- Investigate the ${summary.mismatchedCells} mismatched cells\n`;
    analysis += `- Verify data transformation logic in PowerBI\n`;
  }
  
  return analysis;
}
