import type { Project } from "@shared/qe-schema";
import type {
  ExportableTestCase,
  ExportFilters,
  ExportPreviewRow,
  ExportProjectOption,
  ExportSource,
  SdlcProjectSummary,
} from "./types";
import { SDLC_PROJECT_SELECT_PREFIX } from "./types";

const REGRESSION_CATEGORIES = new Set([
  "functional",
  "negative",
  "edge",
  "edge_case",
  "security",
  "accessibility",
  "regression",
  "workflow",
  "navigation",
  "form_submission",
  "ui",
]);

function getCategory(tc: ExportableTestCase): string {
  return (tc.category || tc.type || tc.testType || "functional").toLowerCase();
}

function getPriority(tc: ExportableTestCase): string {
  return (tc.priority || "P2").toLowerCase();
}

function getTitle(tc: ExportableTestCase): string {
  return (tc.name || tc.title || "").toLowerCase();
}

function matchesSuiteFilter(tc: ExportableTestCase, filter: string): boolean {
  const category = getCategory(tc);
  const priority = getPriority(tc);
  const title = getTitle(tc);

  switch (filter) {
    case "Smoke":
      return category === "smoke" || title.includes("[smoke]");
    case "Sanity":
      return category === "sanity" || title.includes("[sanity]");
    case "Regression":
      return REGRESSION_CATEGORIES.has(category);
    case "Critical":
      return priority === "p0" || priority === "critical";
    default:
      return false;
  }
}

function matchesTypeFilter(tc: ExportableTestCase, filter: string): boolean {
  const category = getCategory(tc);

  switch (filter) {
    case "Functional":
      return (
        category === "functional" ||
        category === "accessibility" ||
        category === "workflow" ||
        category === "navigation" ||
        category === "form_submission" ||
        category === "ui"
      );
    case "Edge Case":
      return category === "edge" || category === "edge_case";
    case "Negative":
      return category === "negative";
    case "Security":
      return category === "security";
    default:
      return false;
  }
}

export function normalizeTestCase(raw: Record<string, unknown>): ExportableTestCase {
  const steps =
    (raw.testSteps as ExportableTestCase["testSteps"]) ||
    (raw.test_steps as ExportableTestCase["test_steps"]) ||
    (raw.steps as ExportableTestCase["steps"]) ||
    [];

  const normalizedSteps = steps.map((step, index) => {
    const extended = step as {
      stepNumber?: number;
      expected?: string;
      expectedResult?: string;
    };
    return {
      step_number: step.step_number ?? extended.stepNumber ?? index + 1,
      action: step.action || "",
      expected_behavior:
        step.expected_behavior ||
        extended.expected ||
        extended.expectedResult ||
        "",
    };
  });

  return {
    id: String(raw.id || raw.testCaseId || ""),
    name: String(raw.name || raw.title || "Untitled Test Case"),
    title: raw.title as string | undefined,
    objective: (raw.objective || raw.description) as string | undefined,
    description: raw.description as string | undefined,
    category: (raw.category || raw.testType || raw.type || "functional") as string,
    type: raw.type as string | undefined,
    testType: raw.testType as string | undefined,
    priority: String(raw.priority || "P2"),
    preconditions: (raw.preconditions as string[]) || [],
    test_steps: normalizedSteps,
    steps: normalizedSteps,
    testSteps: normalizedSteps,
    postconditions: (raw.postconditions as string[]) || [],
    test_data: (raw.test_data || raw.testData) as Record<string, unknown> | undefined,
    expectedResult: raw.expectedResult as string | undefined,
    source: raw.source as string | undefined,
  };
}

export interface FilteredTestCasesResult {
  filtered: ExportableTestCase[];
  totalBeforeFilter: number;
}

export function filterTestCases(
  testCases: ExportableTestCase[],
  filters: ExportFilters,
): ExportableTestCase[] {
  return applyExportFilters(testCases, filters).filtered;
}

export function applyExportFilters(
  testCases: ExportableTestCase[],
  filters: ExportFilters,
): FilteredTestCasesResult {
  const activePriorities = Object.entries(filters.priorities)
    .filter(([, enabled]) => enabled)
    .map(([key]) => key);
  const activeTypes = Object.entries(filters.types)
    .filter(([, enabled]) => enabled)
    .map(([key]) => key);

  if (activePriorities.length === 0 || activeTypes.length === 0) {
    return { filtered: [], totalBeforeFilter: testCases.length };
  }

  const filtered = testCases.filter((tc) => {
    const category = getCategory(tc);

    // Smoke/sanity are suite-level buckets and ignore the type dimension.
    if (category === "smoke") {
      return activePriorities.includes("Smoke");
    }
    if (category === "sanity") {
      return activePriorities.includes("Sanity");
    }

    const suiteMatch = activePriorities.some((filter) => matchesSuiteFilter(tc, filter));
    const typeMatch = activeTypes.some((filter) => matchesTypeFilter(tc, filter));
    return suiteMatch && typeMatch;
  });

  return {
    filtered,
    totalBeforeFilter: testCases.length,
  };
}

export function toPreviewRows(
  testCases: ExportableTestCase[],
  limit = 5,
): ExportPreviewRow[] {
  return testCases.slice(0, limit).map((tc) => ({
    id: tc.id,
    name: tc.name,
    category: tc.category || tc.type || "functional",
    priority: tc.priority,
    stepsCount: tc.test_steps?.length || 0,
  }));
}

export function downloadJson(testCases: ExportableTestCase[], filename: string): void {
  const blob = new Blob([JSON.stringify(testCases, null, 2)], {
    type: "application/json",
  });
  triggerDownload(blob, filename);
}

export function downloadCsv(testCases: ExportableTestCase[], filename: string): void {
  const headers = [
    "Test Case ID",
    "Name",
    "Category",
    "Priority",
    "Objective",
    "Preconditions",
    "Test Steps",
    "Expected Result",
    "Postconditions",
  ];

  const rows = testCases.map((tc) => [
    tc.id,
    tc.name,
    tc.category || "",
    tc.priority,
    tc.objective || tc.description || "",
    (tc.preconditions || []).join("; "),
    (tc.test_steps || [])
      .map(
        (step, index) =>
          `${index + 1}. ${step.action} | Expected: ${step.expected_behavior}`,
      )
      .join(" || "),
    tc.expectedResult || "",
    (tc.postconditions || []).join("; "),
  ]);

  const csv = [headers, ...rows]
    .map((row) =>
      row
        .map((cell) => `"${String(cell).replace(/"/g, '""')}"`)
        .join(","),
    )
    .join("\n");

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  triggerDownload(blob, filename);
}

export function hasActiveFilters(filters: ExportFilters): boolean {
  const hasPriority = Object.values(filters.priorities).some(Boolean);
  const hasType = Object.values(filters.types).some(Boolean);
  return hasPriority && hasType;
}

export function getExportCountLabel(options: {
  isLoading: boolean;
  exportSource: ExportSource;
  needsProjectSelection: boolean;
  needsCustomSelection: boolean;
  needsRunSelection?: boolean;
  selectedCount: number | null;
  totalBeforeFilter: number | null;
  hasActiveFilters: boolean;
}): string {
  const {
    isLoading,
    exportSource,
    needsProjectSelection,
    needsCustomSelection,
    needsRunSelection,
    selectedCount,
    totalBeforeFilter,
    hasActiveFilters,
  } = options;

  if (isLoading) return "Loading test cases...";

  if (needsProjectSelection) {
    return exportSource === "custom"
      ? "Select a project to choose test cases"
      : "Select a project to see test case count";
  }

  if (needsRunSelection) {
    return "Select an autonomous test run to see test case count";
  }

  if (needsCustomSelection) {
    return "Choose test cases to export";
  }

  if (exportSource !== "custom" && !hasActiveFilters) {
    return "Select at least one priority and one type filter";
  }

  const count = selectedCount ?? 0;
  const base = `${count} test case${count === 1 ? "" : "s"} selected`;

  if (
    totalBeforeFilter != null &&
    totalBeforeFilter > 0 &&
    count < totalBeforeFilter
  ) {
    return `${base} (filtered from ${totalBeforeFilter})`;
  }

  return base;
}

export function buildExportFilename(format: string, projectName?: string): string {
  const date = new Date().toISOString().split("T")[0];
  const slug = (projectName || "all-projects")
    .replace(/[^a-z0-9]/gi, "_")
    .substring(0, 40);
  const extensions: Record<string, string> = {
    excel: "xlsx",
    csv: "csv",
    json: "json",
    pdf: "pdf",
  };
  return `NAT2_TestCases_${slug}_${date}.${extensions[format] || "dat"}`;
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function buildExportProjectOptions(
  qeProjects: Project[],
  sdlcProjects: SdlcProjectSummary[],
): ExportProjectOption[] {
  const linkedSdlcIds = new Set(
    qeProjects.map((project) => project.devxSdlcProjectId).filter(Boolean) as string[],
  );
  const qeNames = new Set(qeProjects.map((project) => project.name.trim().toLowerCase()));

  const options: ExportProjectOption[] = qeProjects.map((project) => ({
    selectValue: project.id,
    name: project.name,
    source: "qe",
    qeProjectId: project.id,
    sdlcProjectId: project.devxSdlcProjectId || undefined,
    isDevxLinked: !!project.devxSdlcProjectId,
  }));

  for (const sdlc of sdlcProjects) {
    if (!sdlc.id || !sdlc.name) continue;
    if (linkedSdlcIds.has(sdlc.id)) continue;
    if (qeNames.has(sdlc.name.trim().toLowerCase())) continue;

    options.push({
      selectValue: `${SDLC_PROJECT_SELECT_PREFIX}${sdlc.id}`,
      name: sdlc.name,
      source: "sdlc",
      sdlcProjectId: sdlc.id,
      sdlcProject: sdlc,
      isDevxLinked: true,
    });
  }

  return options.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
}

export async function ensureQeProjectFromSdlc(
  sdlc: SdlcProjectSummary,
): Promise<Project | null> {
  const ref = sdlc.goldenRepoReference;
  const response = await fetch("/api/qe/projects/ensure", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({
      name: sdlc.name,
      type: "web",
      domain: "general",
      adoOrganization: sdlc.organization,
      sdlcProjectId: sdlc.id,
      sdlcProjectName: sdlc.name,
      goldenRepoId: ref?.repoId,
      goldenRepoName: sdlc.linkedGoldenRepoName || ref?.repoName,
    }),
  });

  if (!response.ok) return null;
  const data = (await response.json()) as { project?: Project };
  return data.project ?? null;
}
