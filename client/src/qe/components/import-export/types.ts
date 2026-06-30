export type ExportSource = "all" | "autonomous" | "stories" | "custom";

export type ExportFormat = "excel" | "csv" | "json" | "pdf";

export interface ExportFilters {
  priorities: Record<string, boolean>;
  types: Record<string, boolean>;
}

export interface ExportableTestCase {
  id: string;
  name: string;
  title?: string;
  objective?: string;
  description?: string;
  category?: string;
  type?: string;
  testType?: string;
  priority: string;
  preconditions?: string[];
  test_steps?: Array<{
    step_number: number;
    action: string;
    expected_behavior: string;
  }>;
  steps?: Array<{
    step_number?: number;
    action: string;
    expected_behavior?: string;
    expected?: string;
  }>;
  testSteps?: Array<{
    step_number?: number;
    action: string;
    expected_behavior?: string;
    expected?: string;
  }>;
  postconditions?: string[];
  test_data?: Record<string, unknown>;
  testData?: Record<string, unknown>;
  expectedResult?: string;
  source?: string;
}

export interface ExportPreviewRow {
  id: string;
  name: string;
  category: string;
  priority: string;
  stepsCount: number;
}

export interface ExportParams {
  source: ExportSource;
  format: ExportFormat;
  projectId?: string;
  sprintId?: string;
  functionalRunId?: string;
  selectedTestCaseIds?: string[];
  filters: ExportFilters;
  projectName?: string;
  sprintName?: string;
  functionalRunName?: string;
}

export interface FunctionalTestRunOption {
  id: string;
  websiteUrl: string;
  totalTestCases: number;
  domain?: string;
}

/** Minimal SDLC project fields needed for export project merging. */
export interface SdlcProjectSummary {
  id: string;
  name: string;
  organization?: string | null;
  linkedGoldenRepoName?: string | null;
  goldenRepoReference?: {
    repoId: string;
    repoName: string;
  } | null;
}

/** Unified project option for Import/Export dropdowns. */
export interface ExportProjectOption {
  /** Select value — QE project id or `sdlc:{id}` for DevX-only projects. */
  selectValue: string;
  name: string;
  source: "qe" | "sdlc";
  /** Set when the option maps to an existing QE project row. */
  qeProjectId?: string;
  sdlcProjectId?: string;
  /** Raw SDLC record when source is "sdlc" (needs ensure on select). */
  sdlcProject?: SdlcProjectSummary;
  isDevxLinked: boolean;
}

export const SDLC_PROJECT_SELECT_PREFIX = "sdlc:";

export const DEFAULT_PRIORITY_FILTERS: Record<string, boolean> = {
  Smoke: true,
  Sanity: true,
  Regression: true,
  Critical: true,
};

export type ImportDestinationType = "autonomous" | "stories";

export type ImportDuplicateHandling = "skip" | "replace" | "create";

export interface ImportParams {
  file: File;
  destinationType: ImportDestinationType;
  projectId: string;
  sprintId?: string;
  duplicateHandling: ImportDuplicateHandling;
  validateBeforeImport: boolean;
  autoGenerateIds: boolean;
}

export const DEFAULT_TYPE_FILTERS: Record<string, boolean> = {
  Functional: true,
  "Edge Case": true,
  Negative: true,
  Security: true,
};
