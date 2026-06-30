import { useCallback, useState } from "react";
import { useToast } from "@/hooks/use-toast";
import type { Project } from "@shared/qe-schema";
import type { ExportableTestCase, ExportParams, ExportPreviewRow } from "./types";
import {
  applyExportFilters,
  buildExportFilename,
  downloadCsv,
  downloadJson,
  hasActiveFilters,
  normalizeTestCase,
  toPreviewRows,
} from "./utils";

interface ExecutionTestCasesResponse {
  success?: boolean;
  testCases?: Record<string, unknown>[];
  error?: string;
}

interface ResolveOptions {
  requireProject?: boolean;
  requireCustomSelection?: boolean;
}

async function fetchExecutionTestCases(params: {
  source: "sprint" | "autonomous";
  projectId?: string;
  sprintId?: string;
  functionalRunId?: string;
  strictProject?: boolean;
}): Promise<ExportableTestCase[]> {
  const search = new URLSearchParams({ source: params.source });
  if (params.projectId) search.set("projectId", params.projectId);
  if (params.sprintId) search.set("sprintId", params.sprintId);
  if (
    params.functionalRunId &&
    params.functionalRunId !== "all" &&
    params.source === "autonomous"
  ) {
    search.set("functionalRunId", params.functionalRunId);
  }
  if (params.source === "autonomous" && params.projectId && params.strictProject) {
    search.set("strictProject", "true");
  }

  const response = await fetch(`/api/execution/test-cases?${search.toString()}`);
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || "Failed to fetch test cases");
  }

  const data = (await response.json()) as ExecutionTestCasesResponse;
  return (data.testCases || []).map((tc) => normalizeTestCase(tc));
}

async function fetchAllTestCases(projects: Project[]): Promise<ExportableTestCase[]> {
  const requests = [
    fetchExecutionTestCases({ source: "autonomous" }),
    ...projects.map((project) =>
      fetchExecutionTestCases({ source: "sprint", projectId: project.id }),
    ),
  ];

  const batches = await Promise.all(requests);
  const byId = new Map<string, ExportableTestCase>();

  for (const batch of batches) {
    for (const testCase of batch) {
      if (testCase.id) byId.set(testCase.id, testCase);
    }
  }

  return Array.from(byId.values());
}

async function fetchProjectPool(
  projectId: string,
  functionalRunId?: string,
): Promise<ExportableTestCase[]> {
  const [autonomous, sprint] = await Promise.all([
    fetchExecutionTestCases({
      source: "autonomous",
      projectId,
      functionalRunId,
      strictProject: true,
    }),
    fetchExecutionTestCases({ source: "sprint", projectId }),
  ]);

  const byId = new Map<string, ExportableTestCase>();
  for (const testCase of [...autonomous, ...sprint]) {
    if (testCase.id) byId.set(testCase.id, testCase);
  }
  return Array.from(byId.values());
}

function projectSelectionRequired(params: ExportParams): boolean {
  return (
    params.source === "autonomous" ||
    params.source === "stories" ||
    params.source === "custom"
  );
}

function customSelectionRequired(params: ExportParams): boolean {
  return params.source === "custom" && (params.selectedTestCaseIds?.length ?? 0) === 0;
}

function autonomousRunSelectionRequired(params: ExportParams): boolean {
  return (
    params.source === "autonomous" &&
    !!params.projectId &&
    !params.functionalRunId
  );
}

async function resolveTestCases(
  params: ExportParams,
  projects: Project[],
  options: ResolveOptions = {},
): Promise<{ filtered: ExportableTestCase[]; totalBeforeFilter: number }> {
  const { requireProject = false, requireCustomSelection = false } = options;

  if (projectSelectionRequired(params) && !params.projectId) {
    if (requireProject) {
      const message =
        params.source === "stories"
          ? "Select a project to export sprint test cases."
          : params.source === "custom"
            ? "Select a project to choose test cases."
            : "Select a project to export autonomous test cases.";
      throw new Error(message);
    }
    return { filtered: [], totalBeforeFilter: 0 };
  }

  if (customSelectionRequired(params)) {
    if (requireCustomSelection) {
      throw new Error("Choose at least one test case to export.");
    }
    return { filtered: [], totalBeforeFilter: 0 };
  }

  if (autonomousRunSelectionRequired(params)) {
    if (requireProject || requireCustomSelection) {
      throw new Error("Select an autonomous test run to export.");
    }
    return { filtered: [], totalBeforeFilter: 0 };
  }

  let testCases: ExportableTestCase[] = [];

  if (params.source === "all") {
    testCases = await fetchAllTestCases(projects);
  } else if (params.source === "autonomous") {
    testCases = await fetchExecutionTestCases({
      source: "autonomous",
      projectId: params.projectId,
      functionalRunId: params.functionalRunId,
      strictProject: true,
    });
  } else if (params.source === "stories") {
    testCases = await fetchExecutionTestCases({
      source: "sprint",
      projectId: params.projectId,
      sprintId: params.sprintId,
    });
  } else if (params.source === "custom") {
    const pool = await fetchProjectPool(params.projectId!, params.functionalRunId);
    const selectedIds = new Set(params.selectedTestCaseIds);
    testCases = pool.filter((tc) => selectedIds.has(tc.id));
    return {
      filtered: testCases,
      totalBeforeFilter: pool.length,
    };
  }

  return applyExportFilters(testCases, params.filters);
}

async function exportExcel(
  testCases: ExportableTestCase[],
  metadata: { projectName?: string; sprintName?: string },
): Promise<void> {
  const response = await fetch("/api/export/test-cases/excel", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      testCases,
      metadata: {
        projectName: metadata.projectName || "NAT 2.0",
        sprintName: metadata.sprintName || "Export",
        generatedAt: new Date().toISOString(),
      },
    }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || "Failed to generate Excel file");
  }

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = buildExportFilename("excel", metadata.projectName);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function useExportTestCases(projects: Project[]) {
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewRows, setPreviewRows] = useState<ExportPreviewRow[]>([]);
  const [previewTotal, setPreviewTotal] = useState(0);
  const [selectedCount, setSelectedCount] = useState<number | null>(null);
  const [totalBeforeFilter, setTotalBeforeFilter] = useState<number | null>(null);
  const [needsProjectSelection, setNeedsProjectSelection] = useState(false);
  const [needsCustomSelection, setNeedsCustomSelection] = useState(false);
  const [needsRunSelection, setNeedsRunSelection] = useState(false);

  const loadSelectedCount = useCallback(
    async (params: ExportParams) => {
      if (params.source !== "custom" && !hasActiveFilters(params.filters)) {
        setNeedsProjectSelection(false);
        setNeedsCustomSelection(false);
        setNeedsRunSelection(false);
        setSelectedCount(0);
        setTotalBeforeFilter(null);
        return [];
      }

      if (projectSelectionRequired(params) && !params.projectId) {
        setNeedsProjectSelection(true);
        setNeedsCustomSelection(false);
        setNeedsRunSelection(false);
        setSelectedCount(null);
        setTotalBeforeFilter(null);
        return [];
      }

      if (customSelectionRequired(params)) {
        setNeedsProjectSelection(false);
        setNeedsCustomSelection(true);
        setNeedsRunSelection(false);
        setSelectedCount(0);
        setTotalBeforeFilter(null);
        return [];
      }

      if (autonomousRunSelectionRequired(params)) {
        setNeedsProjectSelection(false);
        setNeedsCustomSelection(false);
        setNeedsRunSelection(true);
        setSelectedCount(null);
        setTotalBeforeFilter(null);
        return [];
      }

      setNeedsProjectSelection(false);
      setNeedsCustomSelection(false);
      setNeedsRunSelection(false);
      setIsLoading(true);
      try {
        const result = await resolveTestCases(params, projects);
        setSelectedCount(result.filtered.length);
        setTotalBeforeFilter(result.totalBeforeFilter);
        return result.filtered;
      } catch (error: unknown) {
        setSelectedCount(0);
        setTotalBeforeFilter(0);
        const message = error instanceof Error ? error.message : "Failed to load test cases";
        toast({
          title: "Unable to load test cases",
          description: message,
          variant: "destructive",
        });
        return [];
      } finally {
        setIsLoading(false);
      }
    },
    [projects, toast],
  );

  const handlePreview = useCallback(
    async (params: ExportParams) => {
      setIsLoading(true);
      try {
        const result = await resolveTestCases(params, projects, {
          requireProject: true,
          requireCustomSelection: true,
        });
        setNeedsProjectSelection(false);
        setNeedsCustomSelection(false);
        setNeedsRunSelection(false);
        setSelectedCount(result.filtered.length);
        setTotalBeforeFilter(result.totalBeforeFilter);
        setPreviewRows(toPreviewRows(result.filtered));
        setPreviewTotal(result.filtered.length);
        setPreviewOpen(true);

        if (result.filtered.length === 0) {
          toast({
            title: "No test cases found",
            description: "Adjust your source or filters and try again.",
            variant: "destructive",
          });
        }
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "Failed to preview export";
        toast({
          title: "Preview failed",
          description: message,
          variant: "destructive",
        });
      } finally {
        setIsLoading(false);
      }
    },
    [projects, toast],
  );

  const handleExport = useCallback(
    async (params: ExportParams) => {
      setIsExporting(true);
      try {
        const result = await resolveTestCases(params, projects, {
          requireProject: true,
          requireCustomSelection: true,
        });
        setNeedsProjectSelection(false);
        setNeedsCustomSelection(false);
        setNeedsRunSelection(false);
        setSelectedCount(result.filtered.length);
        setTotalBeforeFilter(result.totalBeforeFilter);

        if (result.filtered.length === 0) {
          toast({
            title: "Nothing to export",
            description: "No test cases match your current selection.",
            variant: "destructive",
          });
          return;
        }

        const filename = buildExportFilename(params.format, params.projectName);

        if (params.format === "excel") {
          await exportExcel(result.filtered, {
            projectName: params.projectName,
            sprintName: params.sprintName,
          });
        } else if (params.format === "json") {
          downloadJson(result.filtered, filename);
        } else if (params.format === "csv") {
          downloadCsv(result.filtered, filename);
        } else if (params.format === "pdf") {
          toast({
            title: "PDF export unavailable",
            description: "Choose Excel, CSV, or JSON for now.",
            variant: "destructive",
          });
          return;
        }

        toast({
          title: "Export complete",
          description: `Exported ${result.filtered.length} test case${result.filtered.length === 1 ? "" : "s"}.`,
        });
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "Failed to export test cases";
        toast({
          title: "Export failed",
          description: message,
          variant: "destructive",
        });
      } finally {
        setIsExporting(false);
      }
    },
    [projects, toast],
  );

  return {
    isLoading,
    isExporting,
    previewOpen,
    setPreviewOpen,
    previewRows,
    previewTotal,
    selectedCount,
    totalBeforeFilter,
    needsProjectSelection,
    needsCustomSelection,
    needsRunSelection,
    loadSelectedCount,
    handlePreview,
    handleExport,
  };
}
