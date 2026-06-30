import ExcelJS from "exceljs";
import { randomUUID } from "crypto";
import type { InsertFunctionalTestRunCase } from "@shared/qe-schema";

export type ImportDuplicateHandling = "skip" | "replace" | "create";
export type ImportDestinationType = "autonomous" | "stories";

export interface ParsedImportTestCase {
  testCaseId: string;
  title: string;
  category: string;
  priority: string;
  preconditions: string[];
  steps: Array<{ step_number: number; action: string; expected_behavior: string }>;
  expectedResult: string;
}

export interface ImportParseResult {
  testCases: ParsedImportTestCase[];
  errors: string[];
  warnings: string[];
}

function cellText(value: ExcelJS.CellValue | undefined | null): string {
  if (value == null) return "";
  if (typeof value === "object" && "text" in value) {
    return String((value as { text?: string }).text || "").trim();
  }
  if (typeof value === "object" && "richText" in value) {
    const rich = (value as { richText?: Array<{ text: string }> }).richText || [];
    return rich.map((part) => part.text).join("").trim();
  }
  return String(value).trim();
}

function splitList(value: string): string[] {
  if (!value || value === "N/A") return [];
  return value
    .split(/\n|;/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function normalizeCategory(value: string): string {
  return (value || "functional").toLowerCase().replace(/\s+/g, "_");
}

function normalizePriority(value: string): string {
  const raw = (value || "P2").toUpperCase();
  if (["P0", "P1", "P2", "P3", "P4", "CRITICAL", "SMOKE", "SANITY", "REGRESSION"].includes(raw)) {
    return raw;
  }
  return "P2";
}

function parseStepsFromText(value: string): ParsedImportTestCase["steps"] {
  if (!value) return [{ step_number: 1, action: "N/A", expected_behavior: "N/A" }];
  const parts = value.split("||").map((part) => part.trim()).filter(Boolean);
  return parts.map((part, index) => {
    const match = part.match(/^(\d+)\.\s*(.*?)(?:\s*\|\s*Expected:\s*(.*))?$/i);
    if (match) {
      return {
        step_number: Number(match[1]) || index + 1,
        action: match[2]?.trim() || part,
        expected_behavior: match[3]?.trim() || "",
      };
    }
    return {
      step_number: index + 1,
      action: part,
      expected_behavior: "",
    };
  });
}

function mapJsonTestCase(raw: Record<string, unknown>, index: number): ParsedImportTestCase | null {
  const title = String(raw.title || raw.name || "").trim();
  if (!title) return null;

  const stepsRaw =
    (raw.steps as Array<Record<string, unknown>> | undefined) ||
    (raw.test_steps as Array<Record<string, unknown>> | undefined) ||
    (raw.testSteps as Array<Record<string, unknown>> | undefined) ||
    [];

  const steps =
    stepsRaw.length > 0
      ? stepsRaw.map((step, stepIndex) => ({
          step_number: Number(step.step_number || step.stepNumber || stepIndex + 1),
          action: String(step.action || step.test_step || "").trim() || "N/A",
          expected_behavior: String(
            step.expected_behavior || step.expected || step.expectedResult || "",
          ).trim(),
        }))
      : [{ step_number: 1, action: "N/A", expected_behavior: "N/A" }];

  const preconditions = Array.isArray(raw.preconditions)
    ? raw.preconditions.map((item) => String(item).trim()).filter(Boolean)
    : splitList(String(raw.preconditions || ""));

  return {
    testCaseId: String(raw.id || raw.testCaseId || raw.test_case_id || `TC-${String(index + 1).padStart(3, "0")}`),
    title,
    category: normalizeCategory(String(raw.category || raw.type || raw.testType || "functional")),
    priority: normalizePriority(String(raw.priority || "P2")),
    preconditions,
    steps,
    expectedResult: String(raw.expectedResult || raw.expected_result || steps.at(-1)?.expected_behavior || ""),
  };
}

export function parseJsonImport(buffer: Buffer): ImportParseResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(buffer.toString("utf8"));
  } catch {
    return { testCases: [], errors: ["Invalid JSON file"], warnings };
  }

  const rows = Array.isArray(parsed)
    ? parsed
    : Array.isArray((parsed as { testCases?: unknown[] })?.testCases)
      ? (parsed as { testCases: unknown[] }).testCases
      : null;

  if (!rows) {
    return { testCases: [], errors: ["JSON must be an array of test cases"], warnings };
  }

  const testCases: ParsedImportTestCase[] = [];
  rows.forEach((row, index) => {
    if (!row || typeof row !== "object") {
      warnings.push(`Skipped row ${index + 1}: not an object`);
      return;
    }
    const mapped = mapJsonTestCase(row as Record<string, unknown>, index);
    if (!mapped) {
      warnings.push(`Skipped row ${index + 1}: missing title`);
      return;
    }
    testCases.push(mapped);
  });

  if (testCases.length === 0) {
    errors.push("No valid test cases found in JSON file");
  }

  return { testCases, errors, warnings };
}

export function parseCsvImport(buffer: Buffer): ImportParseResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const text = buffer.toString("utf8").replace(/^\uFEFF/, "");
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length < 2) {
    return { testCases: [], errors: ["CSV file must include a header row and at least one data row"], warnings };
  }

  const headers = parseCsvLine(lines[0]).map((header) => header.trim().toLowerCase());
  const idx = (names: string[]) => headers.findIndex((header) => names.some((name) => header.includes(name)));

  const idIdx = idx(["test case id", "id", "testcaseid"]);
  const titleIdx = idx(["name", "title", "test case title"]);
  const categoryIdx = idx(["category", "type"]);
  const priorityIdx = idx(["priority"]);
  const objectiveIdx = idx(["objective", "description"]);
  const preconditionsIdx = idx(["preconditions"]);
  const stepsIdx = idx(["test steps", "steps"]);
  const expectedIdx = idx(["expected result", "expected"]);

  if (titleIdx < 0) {
    return { testCases: [], errors: ["CSV is missing a Name/Title column"], warnings };
  }

  const testCases: ParsedImportTestCase[] = [];
  for (let lineIndex = 1; lineIndex < lines.length; lineIndex++) {
    const cols = parseCsvLine(lines[lineIndex]);
    const title = cols[titleIdx]?.trim();
    if (!title) {
      warnings.push(`Skipped CSV row ${lineIndex + 1}: missing title`);
      continue;
    }

    const stepsText = stepsIdx >= 0 ? cols[stepsIdx] || "" : "";
    const steps = parseStepsFromText(stepsText);
    testCases.push({
      testCaseId:
        (idIdx >= 0 ? cols[idIdx] : "")?.trim() ||
        `TC-${String(testCases.length + 1).padStart(3, "0")}`,
      title,
      category: normalizeCategory(categoryIdx >= 0 ? cols[categoryIdx] || "functional" : "functional"),
      priority: normalizePriority(priorityIdx >= 0 ? cols[priorityIdx] || "P2" : "P2"),
      preconditions: splitList(preconditionsIdx >= 0 ? cols[preconditionsIdx] || "" : ""),
      steps,
      expectedResult:
        (expectedIdx >= 0 ? cols[expectedIdx] : "")?.trim() ||
        (objectiveIdx >= 0 ? cols[objectiveIdx] : "")?.trim() ||
        steps.at(-1)?.expected_behavior ||
        "",
    });
  }

  if (testCases.length === 0) {
    errors.push("No valid test cases found in CSV file");
  }

  return { testCases, errors, warnings };
}

function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (char === "," && !inQuotes) {
      result.push(current);
      current = "";
      continue;
    }
    current += char;
  }

  result.push(current);
  return result;
}

export async function parseExcelImport(buffer: Buffer): Promise<ImportParseResult> {
  const errors: string[] = [];
  const warnings: string[] = [];
  const workbook = new ExcelJS.Workbook();

  try {
    await workbook.xlsx.load(buffer);
  } catch {
    return { testCases: [], errors: ["Invalid Excel file"], warnings };
  }

  const sheet =
    workbook.getWorksheet("Test Cases") ||
    workbook.worksheets.find((ws) => ws.name.toLowerCase().includes("test")) ||
    workbook.worksheets[0];

  if (!sheet) {
    return { testCases: [], errors: ["Excel file has no worksheets"], warnings };
  }

  const testCases: ParsedImportTestCase[] = [];
  let current: ParsedImportTestCase | null = null;

  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;

    const tcId = cellText(row.getCell(1).value);
    const title = cellText(row.getCell(2).value);
    const category = cellText(row.getCell(3).value);
    const priority = cellText(row.getCell(4).value);
    const preconditions = cellText(row.getCell(5).value);
    const stepNumber = Number(cellText(row.getCell(6).value)) || undefined;
    const stepAction = cellText(row.getCell(7).value);
    const expected = cellText(row.getCell(8).value);

    if (tcId || (title && !current)) {
      if (current) testCases.push(current);
      current = {
        testCaseId: tcId || `TC-${String(testCases.length + 1).padStart(3, "0")}`,
        title: title || "Untitled Test Case",
        category: normalizeCategory(category),
        priority: normalizePriority(priority),
        preconditions: splitList(preconditions),
        steps: [],
        expectedResult: expected,
      };
    }

    if (!current) return;

    if (stepAction) {
      current.steps.push({
        step_number: stepNumber || current.steps.length + 1,
        action: stepAction,
        expected_behavior: expected,
      });
    } else if (!current.expectedResult && expected) {
      current.expectedResult = expected;
    }
  });

  if (current) testCases.push(current);

  for (const testCase of testCases) {
    if (testCase.steps.length === 0) {
      testCase.steps = [{ step_number: 1, action: "N/A", expected_behavior: testCase.expectedResult || "N/A" }];
    }
    if (!testCase.expectedResult) {
      testCase.expectedResult = testCase.steps.at(-1)?.expected_behavior || "N/A";
    }
  }

  if (testCases.length === 0) {
    errors.push("No valid test cases found in Excel file");
  }

  return { testCases, errors, warnings };
}

export async function parseImportFile(
  buffer: Buffer,
  filename: string,
): Promise<ImportParseResult> {
  const ext = filename.toLowerCase().split(".").pop();
  if (ext === "json") return parseJsonImport(buffer);
  if (ext === "csv") return parseCsvImport(buffer);
  if (ext === "xlsx") return parseExcelImport(buffer);
  return { testCases: [], errors: ["Unsupported file type. Use .xlsx, .csv, or .json"], warnings: [] };
}

export function applyImportOptions(
  testCases: ParsedImportTestCase[],
  options: {
    autoGenerateIds: boolean;
    duplicateHandling: ImportDuplicateHandling;
    existingKeys: Set<string>;
  },
): { toImport: ParsedImportTestCase[]; skipped: number; replaced: number } {
  const seenInFile = new Set<string>();
  let skipped = 0;
  let replaced = 0;
  const toImport: ParsedImportTestCase[] = [];

  testCases.forEach((testCase, index) => {
    const baseId = options.autoGenerateIds
      ? `TC-${String(index + 1).padStart(3, "0")}`
      : testCase.testCaseId;
    const key = `${baseId}::${testCase.title.trim().toLowerCase()}`;

    if (seenInFile.has(key) && options.duplicateHandling === "skip") {
      skipped++;
      return;
    }
    seenInFile.add(key);

    const existsInTarget = options.existingKeys.has(key);
    if (existsInTarget && options.duplicateHandling === "skip") {
      skipped++;
      return;
    }
    if (existsInTarget && options.duplicateHandling === "replace") {
      replaced++;
    }

    const nextId =
      options.duplicateHandling === "create" || options.autoGenerateIds
        ? options.autoGenerateIds
          ? `TC-${String(index + 1).padStart(3, "0")}`
          : `${baseId}-${randomUUID().slice(0, 8)}`
        : baseId;

    toImport.push({
      ...testCase,
      testCaseId: nextId,
    });
  });

  return { toImport, skipped, replaced };
}

export function toFunctionalRunCases(
  testCases: ParsedImportTestCase[],
): InsertFunctionalTestRunCase[] {
  return testCases.map((testCase) => ({
    testId: testCase.testCaseId,
    category: testCase.category,
    name: testCase.title,
    objective: testCase.title,
    preconditions: testCase.preconditions,
    testSteps: testCase.steps.map((step) => ({
      step_number: step.step_number,
      action: step.action,
      expected_behavior: step.expected_behavior,
    })),
    expectedResult: testCase.expectedResult || testCase.steps.at(-1)?.expected_behavior || "N/A",
    testData: {},
    priority: testCase.priority,
  }));
}

export function toSprintImportCases(testCases: ParsedImportTestCase[]) {
  return testCases.map((testCase) => ({
    testCaseId: testCase.testCaseId,
    id: testCase.testCaseId,
    title: testCase.title,
    category: testCase.category,
    priority: testCase.priority,
    objective: testCase.title,
    preconditions: testCase.preconditions,
    steps: testCase.steps,
    testSteps: testCase.steps,
    expectedResult: testCase.expectedResult,
  }));
}
