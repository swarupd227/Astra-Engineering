import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { DashboardHeader } from "@/components/dashboard/header";
import { useBranding } from "@/contexts/BrandingContext";
import { useToast } from "@/hooks/use-toast";
import { CustomTestCasePickerDialog } from "@/components/import-export/custom-test-case-picker-dialog";
import { ExportPreviewDialog } from "@/components/import-export/export-preview-dialog";
import { useExportProjects } from "@/components/import-export/use-export-projects";
import { useExportTestCases } from "@/components/import-export/use-export-test-cases";
import { useImportTestCases } from "@/components/import-export/use-import-test-cases";
import {
  DEFAULT_PRIORITY_FILTERS,
  DEFAULT_TYPE_FILTERS,
  type ExportFormat,
  type ExportSource,
  type FunctionalTestRunOption,
  type ImportDestinationType,
  type ImportDuplicateHandling,
} from "@/components/import-export/types";
import { getExportCountLabel, hasActiveFilters } from "@/components/import-export/utils";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { 
  ArrowUpDown,
  Download,
  Upload,
  FileSpreadsheet,
  FileJson,
  FileText,
  FolderOpen,
  Filter,
  Eye,
  CheckCircle2,
  XCircle,
  Clock,
  ArrowRight,
  RefreshCw,
  Trash2,
  Edit,
  Plus
} from "lucide-react";
import type { Sprint } from "@shared/qe-schema";

const mockHistory = [
  { id: 1, date: '2024-12-20 14:32', type: 'Export', source: 'Insurance Portal', destination: 'Excel', records: 156, status: 'completed' },
  { id: 2, date: '2024-12-19 10:15', type: 'Import', source: 'test_cases.xlsx', destination: 'Claims System', records: 45, status: 'completed' },
  { id: 3, date: '2024-12-18 16:45', type: 'Export', source: 'Policy Manager', destination: 'JSON', records: 234, status: 'completed' },
  { id: 4, date: '2024-12-17 09:20', type: 'Import', source: 'regression_suite.csv', destination: 'Customer Portal', records: 89, status: 'failed' },
];

const mockTemplates = [
  { id: 1, name: 'Standard Export', type: 'export', format: 'Excel', fields: 12 },
  { id: 2, name: 'Zephyr Format', type: 'export', format: 'CSV', fields: 15 },
  { id: 3, name: 'TestRail Import', type: 'import', format: 'CSV', fields: 10 },
];

const FORMAT_LABELS: Record<ExportFormat, string> = {
  excel: "Excel (.xlsx)",
  csv: "CSV",
  json: "JSON",
  pdf: "PDF",
};

export default function ImportExportPage() {
  const { brand } = useBranding();
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState('export');
  const [exportSource, setExportSource] = useState<ExportSource>('all');
  const [exportFormat, setExportFormat] = useState<ExportFormat>('excel');
  const [exportProjectSelectValue, setExportProjectSelectValue] = useState<string>("");
  const [exportProjectId, setExportProjectId] = useState<string>("");
  const [exportSprintId, setExportSprintId] = useState<string>("all");
  const [exportFunctionalRunId, setExportFunctionalRunId] = useState<string>("");
  const [customSelectedIds, setCustomSelectedIds] = useState<string[]>([]);
  const [customPickerOpen, setCustomPickerOpen] = useState(false);
  const [priorityFilters, setPriorityFilters] = useState(DEFAULT_PRIORITY_FILTERS);
  const [typeFilters, setTypeFilters] = useState(DEFAULT_TYPE_FILTERS);
  const [importSource, setImportSource] = useState("file");
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [importDestinationType, setImportDestinationType] = useState<ImportDestinationType>("autonomous");
  const [importProjectSelectValue, setImportProjectSelectValue] = useState("");
  const [importProjectId, setImportProjectId] = useState("");
  const [importSprintId, setImportSprintId] = useState("");
  const [duplicateHandling, setDuplicateHandling] = useState<ImportDuplicateHandling>("skip");
  const [validateBeforeImport, setValidateBeforeImport] = useState(true);
  const [autoGenerateIds, setAutoGenerateIds] = useState(true);

  const {
    projectOptions,
    qeProjects,
    isLoading: projectsLoading,
    isResolving: isResolvingProject,
    resolveProjectId,
  } = useExportProjects();

  const { data: sprints = [] } = useQuery<Sprint[]>({
    queryKey: ['/api/projects', exportProjectId, 'sprints'],
    enabled: exportSource === 'stories' && !!exportProjectId,
    queryFn: async () => {
      const response = await fetch(`/api/projects/${exportProjectId}/sprints`);
      if (!response.ok) throw new Error('Failed to load sprints');
      return response.json();
    },
  });

  const { data: functionalRunsData } = useQuery<{ success: boolean; runs: FunctionalTestRunOption[] }>({
    queryKey: ['/api/execution/functional-runs', exportProjectId],
    enabled:
      (exportSource === 'autonomous' || exportSource === 'custom') && !!exportProjectId,
    queryFn: async () => {
      const params = new URLSearchParams({ projectId: exportProjectId });
      const response = await fetch(`/api/execution/functional-runs?${params.toString()}`);
      if (!response.ok) throw new Error('Failed to load autonomous test runs');
      return response.json();
    },
  });

  const functionalRuns = functionalRunsData?.runs || [];

  const {
    isLoading: isExportLoading,
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
  } = useExportTestCases(qeProjects);

  const {
    previewOpen: importPreviewOpen,
    setPreviewOpen: setImportPreviewOpen,
    previewRows: importPreviewRows,
    previewTotal: importPreviewTotal,
    isPreviewLoading: isImportPreviewLoading,
    isImporting,
    lastValidationMessage,
    handlePreview: handleImportPreview,
    handleImport,
  } = useImportTestCases();

  const { data: importSprints = [] } = useQuery<Sprint[]>({
    queryKey: ["/api/projects", importProjectId, "sprints", "import"],
    enabled: importDestinationType === "stories" && !!importProjectId,
    queryFn: async () => {
      const response = await fetch(`/api/projects/${importProjectId}/sprints`);
      if (!response.ok) throw new Error("Failed to load sprints");
      return response.json();
    },
  });

  const filtersActive = hasActiveFilters({
    priorities: priorityFilters,
    types: typeFilters,
  });

  const exportCountLabel = getExportCountLabel({
    isLoading: isExportLoading,
    exportSource,
    needsProjectSelection,
    needsCustomSelection,
    needsRunSelection,
    selectedCount,
    totalBeforeFilter,
    hasActiveFilters: filtersActive,
  });

  const exportActionsDisabled =
    isExportLoading ||
    isExporting ||
    needsProjectSelection ||
    needsCustomSelection ||
    needsRunSelection ||
    (exportSource !== "custom" && !filtersActive) ||
    (selectedCount ?? 0) === 0;

  const selectedProjectOption = useMemo(
    () => projectOptions.find((option) => option.selectValue === exportProjectSelectValue),
    [projectOptions, exportProjectSelectValue],
  );

  const selectedSprint = useMemo(
    () => sprints.find((sprint) => sprint.id === exportSprintId),
    [sprints, exportSprintId],
  );

  const selectedFunctionalRun = useMemo(
    () => functionalRuns.find((run) => run.id === exportFunctionalRunId),
    [functionalRuns, exportFunctionalRunId],
  );

  const exportParams = useMemo(
    () => ({
      source: exportSource,
      format: exportFormat,
      projectId: exportProjectId || undefined,
      sprintId: exportSprintId && exportSprintId !== "all" ? exportSprintId : undefined,
      functionalRunId: exportFunctionalRunId || undefined,
      selectedTestCaseIds:
        exportSource === "custom" ? customSelectedIds : undefined,
      filters: {
        priorities: priorityFilters,
        types: typeFilters,
      },
      projectName: selectedProjectOption?.name,
      sprintName: selectedSprint?.name,
      functionalRunName: selectedFunctionalRun?.websiteUrl,
    }),
    [
      exportSource,
      exportFormat,
      exportProjectId,
      exportSprintId,
      exportFunctionalRunId,
      customSelectedIds,
      priorityFilters,
      typeFilters,
      selectedProjectOption?.name,
      selectedSprint?.name,
      selectedFunctionalRun?.websiteUrl,
    ],
  );

  useEffect(() => {
    if (activeTab !== "export") return;

    const timer = window.setTimeout(() => {
      void loadSelectedCount(exportParams);
    }, 300);

    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    activeTab,
    exportSource,
    exportFormat,
    exportProjectId,
    exportSprintId,
    exportFunctionalRunId,
    customSelectedIds,
    priorityFilters,
    typeFilters,
    qeProjects.length,
    projectOptions.length,
  ]);

  const handleExportProjectChange = async (selectValue: string) => {
    setExportProjectSelectValue(selectValue);
    setExportSprintId("all");
    setExportFunctionalRunId("");
    setCustomSelectedIds([]);

    const qeId = await resolveProjectId(selectValue);
    if (!qeId) {
      setExportProjectSelectValue("");
      toast({
        title: "Unable to link project",
        description: "Could not create or link a QE project for the selected DevX project.",
        variant: "destructive",
      });
      return;
    }
    setExportProjectId(qeId);
  };

  const handleExportSourceChange = (value: ExportSource) => {
    setExportSource(value);
    setExportProjectSelectValue("");
    setExportProjectId("");
    setExportSprintId("all");
    setExportFunctionalRunId("");
    setCustomSelectedIds([]);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setUploadedFile(e.target.files[0]);
    }
  };

  const handleImportProjectChange = async (selectValue: string) => {
    if (selectValue === "new") {
      toast({
        title: "Create project in Projects",
        description: "Create a new project from the dashboard first, then select it here.",
      });
      return;
    }

    setImportProjectSelectValue(selectValue);
    setImportSprintId("");

    const qeId = await resolveProjectId(selectValue);
    if (!qeId) {
      setImportProjectSelectValue("");
      toast({
        title: "Unable to link project",
        description: "Could not create or link a QE project for the selected DevX project.",
        variant: "destructive",
      });
      return;
    }
    setImportProjectId(qeId);
  };

  const importParams = useMemo(
    () =>
      uploadedFile && importProjectId
        ? {
            file: uploadedFile,
            destinationType: importDestinationType,
            projectId: importProjectId,
            sprintId: importDestinationType === "stories" ? importSprintId : undefined,
            duplicateHandling,
            validateBeforeImport,
            autoGenerateIds,
          }
        : null,
    [
      uploadedFile,
      importDestinationType,
      importProjectId,
      importSprintId,
      duplicateHandling,
      validateBeforeImport,
      autoGenerateIds,
    ],
  );

  const canPreviewImport = !!uploadedFile;
  const importReady =
    !!importParams &&
    (importDestinationType === "autonomous" || !!importSprintId);

  const importStatusSubtitle = !uploadedFile
    ? "Select a file to import test cases"
    : !importProjectId
      ? "Select a destination project"
      : importDestinationType === "stories" && !importSprintId
        ? "Select a sprint for user story import"
        : lastValidationMessage || "File ready — preview or import";

  const importFormatLabel = uploadedFile
    ? uploadedFile.name.split(".").pop()?.toUpperCase() || "FILE"
    : "FILE";

  const togglePriorityFilter = (priority: string, checked: boolean) => {
    setPriorityFilters((current) => ({ ...current, [priority]: checked }));
  };

  const toggleTypeFilter = (type: string, checked: boolean) => {
    setTypeFilters((current) => ({ ...current, [type]: checked }));
  };

  return (
    <>
      <DashboardHeader />
      
      <main className="flex-1 overflow-y-auto p-6">
        <div className="space-y-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Link href="/dashboard">
                  <button className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-muted hover:bg-muted/80 text-muted-foreground hover:text-foreground text-xs transition-colors border border-border">
                    ← Dashboard
                  </button>
                </Link>
                <div>
                  <h1 className="text-2xl font-bold text-foreground flex items-center gap-3">
                    <ArrowUpDown className="w-7 h-7 text-primary" />
                    Import/Export
                  </h1>
                  <p className="text-muted-foreground mt-1">Transfer test cases between {brand.platformShortName} and external tools</p>
                </div>
              </div>
            </div>

            <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
              <TabsList className="bg-card border">
                <TabsTrigger value="export" data-testid="tab-export">
                  <Download className="w-4 h-4 mr-2" />
                  Export
                </TabsTrigger>
                <TabsTrigger value="import" data-testid="tab-import">
                  <Upload className="w-4 h-4 mr-2" />
                  Import
                </TabsTrigger>
                <TabsTrigger value="templates" data-testid="tab-templates">
                  <FileText className="w-4 h-4 mr-2" />
                  Templates
                </TabsTrigger>
                <TabsTrigger value="history" data-testid="tab-history">
                  <Clock className="w-4 h-4 mr-2" />
                  History
                </TabsTrigger>
              </TabsList>

              <TabsContent value="export" className="space-y-6">
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  <Card className="bg-card/50 border-border/50">
                    <CardHeader>
                      <CardTitle className="text-lg">Export Source</CardTitle>
                      <CardDescription>Select which test cases to export</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <RadioGroup
                        value={exportSource}
                        onValueChange={(value) => handleExportSourceChange(value as ExportSource)}
                        className="space-y-3"
                      >
                        <div className="flex items-center space-x-3 p-3 rounded-lg bg-background/50 border border-border/50">
                          <RadioGroupItem value="all" id="all" />
                          <Label htmlFor="all" className="flex-1 cursor-pointer">
                            <p className="font-medium">All Test Cases</p>
                            <p className="text-xs text-muted-foreground">Export all test cases from all projects</p>
                          </Label>
                        </div>
                        <div className="flex items-center space-x-3 p-3 rounded-lg bg-background/50 border border-border/50">
                          <RadioGroupItem value="autonomous" id="autonomous" />
                          <Label htmlFor="autonomous" className="flex-1 cursor-pointer">
                            <p className="font-medium">From Autonomous Testing</p>
                            <p className="text-xs text-muted-foreground">Export from a specific project</p>
                          </Label>
                        </div>
                        <div className="flex items-center space-x-3 p-3 rounded-lg bg-background/50 border border-border/50">
                          <RadioGroupItem value="stories" id="stories" />
                          <Label htmlFor="stories" className="flex-1 cursor-pointer">
                            <p className="font-medium">From Generate from User Stories</p>
                            <p className="text-xs text-muted-foreground">Export from a specific project and sprint</p>
                          </Label>
                        </div>
                        <div className="flex items-center space-x-3 p-3 rounded-lg bg-background/50 border border-border/50">
                          <RadioGroupItem value="custom" id="custom" />
                          <Label htmlFor="custom" className="flex-1 cursor-pointer">
                            <p className="font-medium">Custom Selection</p>
                            <p className="text-xs text-muted-foreground">Choose specific test cases</p>
                          </Label>
                        </div>
                      </RadioGroup>

                      {(exportSource === 'autonomous' || exportSource === 'stories' || exportSource === 'custom') && (
                        <div className="space-y-3 pt-3 border-t border-border/50">
                          <div>
                            <Label className="text-sm mb-2 block">Project</Label>
                            <Select
                              value={exportProjectSelectValue || undefined}
                              onValueChange={(value) => {
                                void handleExportProjectChange(value);
                              }}
                              disabled={projectsLoading || isResolvingProject}
                            >
                              <SelectTrigger data-testid="select-export-project">
                                <SelectValue
                                  placeholder={
                                    projectsLoading
                                      ? "Loading projects..."
                                      : isResolvingProject
                                        ? "Linking project..."
                                        : "Select project"
                                  }
                                />
                              </SelectTrigger>
                              <SelectContent>
                                {projectOptions.map((option) => (
                                  <SelectItem key={option.selectValue} value={option.selectValue}>
                                    <span className="flex items-center gap-2">
                                      <span>{option.name}</span>
                                      {option.isDevxLinked && (
                                        <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                                          DevX
                                        </Badge>
                                      )}
                                    </span>
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>

                          {exportSource === 'autonomous' && exportProjectId && (
                            <div>
                              <Label className="text-sm mb-2 block">Autonomous Test Run</Label>
                              <Select
                                value={exportFunctionalRunId || undefined}
                                onValueChange={setExportFunctionalRunId}
                              >
                                <SelectTrigger data-testid="select-export-functional-run">
                                  <SelectValue placeholder="Select test run" />
                                </SelectTrigger>
                                <SelectContent>
                                  {functionalRuns.map((run) => (
                                    <SelectItem key={run.id} value={run.id}>
                                      {run.websiteUrl} ({run.totalTestCases} cases)
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                              {functionalRuns.length === 0 && (
                                <p className="text-xs text-muted-foreground mt-2">
                                  No autonomous test runs found. Generate tests from Autonomous Testing first.
                                </p>
                              )}
                            </div>
                          )}

                          {exportSource === 'stories' && exportProjectId && (
                            <div>
                              <Label className="text-sm mb-2 block">Sprint</Label>
                              <Select
                                value={exportSprintId}
                                onValueChange={setExportSprintId}
                              >
                                <SelectTrigger data-testid="select-export-sprint">
                                  <SelectValue placeholder="All sprints" />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="all">All sprints</SelectItem>
                                  {sprints.map((sprint) => (
                                    <SelectItem key={sprint.id} value={sprint.id}>
                                      {sprint.name}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                              {sprints.length === 0 && (
                                <p className="text-xs text-muted-foreground mt-2">
                                  No sprints found for this project.
                                </p>
                              )}
                            </div>
                          )}

                          {exportSource === 'custom' && exportProjectId && (
                            <div className="space-y-2">
                              <Label className="text-sm block">Test Case Picker</Label>
                              <Button
                                variant="outline"
                                className="w-full justify-start"
                                onClick={() => setCustomPickerOpen(true)}
                                data-testid="button-open-custom-picker"
                              >
                                <FolderOpen className="w-4 h-4 mr-2" />
                                {customSelectedIds.length > 0
                                  ? `${customSelectedIds.length} test case${customSelectedIds.length === 1 ? "" : "s"} chosen`
                                  : "Choose test cases"}
                              </Button>
                              <p className="text-xs text-muted-foreground">
                                Pick specific autonomous and sprint test cases from the selected project.
                              </p>
                            </div>
                          )}
                        </div>
                      )}
                    </CardContent>
                  </Card>

                  <div className="space-y-6">
                    <Card className="bg-card/50 border-border/50">
                      <CardHeader>
                        <CardTitle className="text-lg">Export Format</CardTitle>
                        <CardDescription>Choose output format</CardDescription>
                      </CardHeader>
                      <CardContent>
                        <div className="grid grid-cols-2 gap-3">
                          {[
                            { id: 'excel', icon: FileSpreadsheet, label: 'Excel (.xlsx)', color: 'text-emerald-400' },
                            { id: 'csv', icon: FileText, label: 'CSV', color: 'text-blue-400' },
                            { id: 'json', icon: FileJson, label: 'JSON', color: 'text-amber-400' },
                            { id: 'pdf', icon: FileText, label: 'PDF', color: 'text-red-400' },
                          ].map((format) => (
                            <button
                              key={format.id}
                              onClick={() => setExportFormat(format.id as ExportFormat)}
                              className={`p-4 rounded-lg border transition-all ${
                                exportFormat === format.id 
                                  ? 'border-primary bg-primary/10' 
                                  : 'border-border/50 bg-background/50 hover:border-primary/50'
                              }`}
                              data-testid={`button-format-${format.id}`}
                            >
                              <format.icon className={`w-6 h-6 mx-auto mb-2 ${format.color}`} />
                              <p className="text-sm font-medium text-foreground">{format.label}</p>
                            </button>
                          ))}
                        </div>
                      </CardContent>
                    </Card>

                    <Card className="bg-card/50 border-border/50">
                      <CardHeader>
                        <CardTitle className="text-lg">Filters</CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-4">
                        <div className="grid grid-cols-2 gap-4">
                          <div className="space-y-2">
                            <Label className="text-xs text-muted-foreground">Priority</Label>
                            <div className="space-y-2">
                              {['Smoke', 'Sanity', 'Regression', 'Critical'].map((priority) => (
                                <div key={priority} className="flex items-center space-x-2">
                                  <Checkbox
                                    id={`priority-${priority}`}
                                    checked={priorityFilters[priority]}
                                    onCheckedChange={(checked) =>
                                      togglePriorityFilter(priority, checked === true)
                                    }
                                  />
                                  <Label htmlFor={`priority-${priority}`} className="text-sm">{priority}</Label>
                                </div>
                              ))}
                            </div>
                          </div>
                          <div className="space-y-2">
                            <Label className="text-xs text-muted-foreground">Type</Label>
                            <div className="space-y-2">
                              {['Functional', 'Edge Case', 'Negative', 'Security'].map((type) => (
                                <div key={type} className="flex items-center space-x-2">
                                  <Checkbox
                                    id={`type-${type}`}
                                    checked={typeFilters[type]}
                                    onCheckedChange={(checked) =>
                                      toggleTypeFilter(type, checked === true)
                                    }
                                  />
                                  <Label htmlFor={`type-${type}`} className="text-sm">{type}</Label>
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  </div>
                </div>

                <Card className="bg-card/50 border-border/50">
                  <CardContent className="p-6">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-medium text-foreground">Ready to export</p>
                        <p className="text-sm text-muted-foreground" data-testid="text-export-count">
                          {exportCountLabel}
                        </p>
                      </div>
                      <div className="flex gap-3">
                        <Button
                          variant="outline"
                          data-testid="button-preview-export"
                          disabled={exportActionsDisabled}
                          onClick={() => void handlePreview(exportParams)}
                        >
                          <Eye className="w-4 h-4 mr-2" />
                          Preview
                        </Button>
                        <Button
                          onClick={() => void handleExport(exportParams)}
                          disabled={exportActionsDisabled}
                          data-testid="button-export"
                        >
                          {isExporting ? (
                            <>
                              <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                              Exporting...
                            </>
                          ) : (
                            <>
                              <Download className="w-4 h-4 mr-2" />
                              Export
                            </>
                          )}
                        </Button>
                      </div>
                    </div>
                    {isExporting && (
                      <Progress value={75} className="mt-4 h-2" />
                    )}
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="import" className="space-y-6">
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  <Card className="bg-card/50 border-border/50">
                    <CardHeader>
                      <CardTitle className="text-lg">Import Source</CardTitle>
                      <CardDescription>Select where to import from</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <RadioGroup value={importSource} onValueChange={setImportSource} className="space-y-3">
                        <div className="flex items-center space-x-3 p-3 rounded-lg bg-background/50 border border-border/50">
                          <RadioGroupItem value="file" id="import-file" />
                          <Label htmlFor="import-file" className="flex-1 cursor-pointer">
                            <p className="font-medium">Upload File</p>
                            <p className="text-xs text-muted-foreground">Import from Excel, CSV, or JSON file</p>
                          </Label>
                        </div>
                        <div className="flex items-center space-x-3 p-3 rounded-lg bg-background/50 border border-border/50">
                          <RadioGroupItem value="tool" id="import-tool" />
                          <Label htmlFor="import-tool" className="flex-1 cursor-pointer">
                            <p className="font-medium">From Connected Tool</p>
                            <p className="text-xs text-muted-foreground">Import from Azure DevOps, JIRA, etc.</p>
                          </Label>
                        </div>
                        <div className="flex items-center space-x-3 p-3 rounded-lg bg-background/50 border border-border/50">
                          <RadioGroupItem value="url" id="import-url" />
                          <Label htmlFor="import-url" className="flex-1 cursor-pointer">
                            <p className="font-medium">From URL</p>
                            <p className="text-xs text-muted-foreground">Import from a remote file URL</p>
                          </Label>
                        </div>
                      </RadioGroup>

                      {importSource === 'file' && (
                        <div className="pt-4 border-t border-border/50">
                          <div 
                            className="border-2 border-dashed border-border/50 rounded-lg p-8 text-center hover:border-primary/50 transition-colors cursor-pointer"
                            onClick={() => document.getElementById('file-upload')?.click()}
                          >
                            <Upload className="w-10 h-10 mx-auto mb-3 text-muted-foreground" />
                            <p className="font-medium text-foreground">
                              {uploadedFile ? uploadedFile.name : 'Drop file here or click to upload'}
                            </p>
                            <p className="text-xs text-muted-foreground mt-1">
                              Supports .xlsx, .csv, .json
                            </p>
                            <input
                              id="file-upload"
                              type="file"
                              className="hidden"
                              accept=".xlsx,.csv,.json"
                              onChange={handleFileUpload}
                              data-testid="input-file-upload"
                            />
                          </div>
                        </div>
                      )}
                    </CardContent>
                  </Card>

                  <div className="space-y-6">
                    <Card className="bg-card/50 border-border/50">
                      <CardHeader>
                        <CardTitle className="text-lg">Destination</CardTitle>
                        <CardDescription>Where to import test cases</CardDescription>
                      </CardHeader>
                      <CardContent className="space-y-4">
                        <div>
                          <Label className="text-sm mb-2 block">Destination Type</Label>
                          <Select
                            value={importDestinationType}
                            onValueChange={(value) => {
                              setImportDestinationType(value as ImportDestinationType);
                              setImportSprintId("");
                            }}
                          >
                            <SelectTrigger data-testid="select-destination-type">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="autonomous">To Autonomous Testing project</SelectItem>
                              <SelectItem value="stories">To Generate from User Stories project/sprint</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div>
                          <Label className="text-sm mb-2 block">Project</Label>
                          <Select
                            value={importProjectSelectValue || undefined}
                            onValueChange={(value) => {
                              void handleImportProjectChange(value);
                            }}
                            disabled={projectsLoading || isResolvingProject}
                          >
                            <SelectTrigger data-testid="select-destination-project">
                              <SelectValue
                                placeholder={
                                  projectsLoading
                                    ? "Loading projects..."
                                    : isResolvingProject
                                      ? "Linking project..."
                                      : "Select or create project"
                                }
                              />
                            </SelectTrigger>
                            <SelectContent>
                              {projectOptions.map((option) => (
                                <SelectItem key={option.selectValue} value={option.selectValue}>
                                  <span className="flex items-center gap-2">
                                    <span>{option.name}</span>
                                    {option.isDevxLinked && (
                                      <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                                        DevX
                                      </Badge>
                                    )}
                                  </span>
                                </SelectItem>
                              ))}
                              <SelectItem value="new">+ Create New Project</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        {importDestinationType === "stories" && importProjectId && (
                          <div>
                            <Label className="text-sm mb-2 block">Sprint</Label>
                            <Select
                              value={importSprintId || undefined}
                              onValueChange={setImportSprintId}
                            >
                              <SelectTrigger data-testid="select-import-sprint">
                                <SelectValue placeholder="Select sprint" />
                              </SelectTrigger>
                              <SelectContent>
                                {importSprints.map((sprint) => (
                                  <SelectItem key={sprint.id} value={sprint.id}>
                                    {sprint.name}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            {importSprints.length === 0 && (
                              <p className="text-xs text-muted-foreground mt-2">
                                No sprints found for this project. Create a sprint first.
                              </p>
                            )}
                          </div>
                        )}
                      </CardContent>
                    </Card>

                    <Card className="bg-card/50 border-border/50">
                      <CardHeader>
                        <CardTitle className="text-lg">Import Options</CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-4">
                        <div>
                          <Label className="text-sm mb-2 block">Duplicate Handling</Label>
                          <Select
                            value={duplicateHandling}
                            onValueChange={(value) => setDuplicateHandling(value as ImportDuplicateHandling)}
                          >
                            <SelectTrigger data-testid="select-duplicate-handling">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="skip">Skip duplicates</SelectItem>
                              <SelectItem value="replace">Replace existing</SelectItem>
                              <SelectItem value="create">Create as new</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-2">
                          <div className="flex items-center space-x-2">
                            <Checkbox
                              id="validate"
                              checked={validateBeforeImport}
                              onCheckedChange={(checked) => setValidateBeforeImport(checked === true)}
                            />
                            <Label htmlFor="validate" className="text-sm">Validate data before import</Label>
                          </div>
                          <div className="flex items-center space-x-2">
                            <Checkbox
                              id="generate-ids"
                              checked={autoGenerateIds}
                              onCheckedChange={(checked) => setAutoGenerateIds(checked === true)}
                            />
                            <Label htmlFor="generate-ids" className="text-sm">Auto-generate IDs</Label>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  </div>
                </div>

                <Card className="bg-card/50 border-border/50">
                  <CardContent className="p-6">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-medium text-foreground">
                          {uploadedFile ? `Ready to import: ${uploadedFile.name}` : 'Upload a file to continue'}
                        </p>
                        <p className="text-sm text-muted-foreground" data-testid="text-import-status">
                          {importStatusSubtitle}
                        </p>
                      </div>
                      <div className="flex gap-3">
                        <Button
                          variant="outline"
                          disabled={!canPreviewImport || isImportPreviewLoading || isImporting}
                          data-testid="button-preview-import"
                          onClick={() => uploadedFile && void handleImportPreview(uploadedFile)}
                        >
                          {isImportPreviewLoading ? (
                            <>
                              <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                              Validating...
                            </>
                          ) : (
                            <>
                              <Eye className="w-4 h-4 mr-2" />
                              Preview
                            </>
                          )}
                        </Button>
                        <Button
                          onClick={() => importParams && void handleImport(importParams)}
                          disabled={!importReady || isImporting || isImportPreviewLoading}
                          data-testid="button-import"
                        >
                          {isImporting ? (
                            <>
                              <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                              Importing...
                            </>
                          ) : (
                            <>
                              <Upload className="w-4 h-4 mr-2" />
                              Import
                            </>
                          )}
                        </Button>
                      </div>
                    </div>
                    {isImporting && (
                      <Progress value={45} className="mt-4 h-2" />
                    )}
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="templates" className="space-y-6">
                <div className="flex justify-between items-center">
                  <div>
                    <h2 className="text-lg font-semibold text-foreground">Saved Templates</h2>
                    <p className="text-sm text-muted-foreground">Manage your import and export templates</p>
                  </div>
                  <Button data-testid="button-create-template">
                    <Plus className="w-4 h-4 mr-2" />
                    Create Template
                  </Button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {mockTemplates.map((template) => (
                    <Card key={template.id} className="bg-card/50 border-border/50">
                      <CardContent className="p-4">
                        <div className="flex items-start justify-between mb-3">
                          <div>
                            <p className="font-medium text-foreground">{template.name}</p>
                            <p className="text-xs text-muted-foreground">{template.fields} fields configured</p>
                          </div>
                          <Badge variant={template.type === 'export' ? 'default' : 'secondary'}>
                            {template.type}
                          </Badge>
                        </div>
                        <div className="flex items-center justify-between pt-3 border-t border-border/50">
                          <span className="text-xs text-muted-foreground">Format: {template.format}</span>
                          <div className="flex gap-2">
                            <Button variant="ghost" size="icon" className="h-8 w-8" data-testid={`button-edit-template-${template.id}`}>
                              <Edit className="w-4 h-4" />
                            </Button>
                            <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" data-testid={`button-delete-template-${template.id}`}>
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </TabsContent>

              <TabsContent value="history" className="space-y-6">
                <Card className="bg-card/50 border-border/50">
                  <CardHeader>
                    <CardTitle className="text-lg">Sync History</CardTitle>
                    <CardDescription>Recent import and export operations</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="overflow-x-auto">
                      <table className="w-full">
                        <thead>
                          <tr className="border-b border-border">
                            <th className="text-left py-3 px-4 text-sm font-medium text-muted-foreground">Date</th>
                            <th className="text-left py-3 px-4 text-sm font-medium text-muted-foreground">Type</th>
                            <th className="text-left py-3 px-4 text-sm font-medium text-muted-foreground">Source</th>
                            <th className="text-left py-3 px-4 text-sm font-medium text-muted-foreground">Destination</th>
                            <th className="text-left py-3 px-4 text-sm font-medium text-muted-foreground">Records</th>
                            <th className="text-left py-3 px-4 text-sm font-medium text-muted-foreground">Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {mockHistory.map((item) => (
                            <tr key={item.id} className="border-b border-border/50 hover:bg-muted/50">
                              <td className="py-3 px-4 text-sm text-muted-foreground">{item.date}</td>
                              <td className="py-3 px-4">
                                <Badge variant={item.type === 'Export' ? 'default' : 'secondary'}>
                                  {item.type === 'Export' ? <Download className="w-3 h-3 mr-1" /> : <Upload className="w-3 h-3 mr-1" />}
                                  {item.type}
                                </Badge>
                              </td>
                              <td className="py-3 px-4 text-sm text-foreground">{item.source}</td>
                              <td className="py-3 px-4 text-sm text-foreground">{item.destination}</td>
                              <td className="py-3 px-4 text-sm text-foreground">{item.records}</td>
                              <td className="py-3 px-4">
                                {item.status === 'completed' ? (
                                  <span className="flex items-center gap-1 text-sm text-emerald-400">
                                    <CheckCircle2 className="w-4 h-4" />
                                    Completed
                                  </span>
                                ) : (
                                  <span className="flex items-center gap-1 text-sm text-red-400">
                                    <XCircle className="w-4 h-4" />
                                    Failed
                                  </span>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>
        </div>
      </main>

      <ExportPreviewDialog
        open={previewOpen}
        onOpenChange={setPreviewOpen}
        rows={previewRows}
        totalCount={previewTotal}
        formatLabel={FORMAT_LABELS[exportFormat]}
      />

      <ExportPreviewDialog
        open={importPreviewOpen}
        onOpenChange={setImportPreviewOpen}
        rows={importPreviewRows}
        totalCount={importPreviewTotal}
        formatLabel={importFormatLabel}
        title="Import Preview"
        descriptionPrefix="found in"
      />

      <CustomTestCasePickerDialog
        open={customPickerOpen}
        onOpenChange={setCustomPickerOpen}
        projectId={exportProjectId || undefined}
        functionalRunId={exportFunctionalRunId}
        selectedIds={customSelectedIds}
        onConfirm={setCustomSelectedIds}
      />
    </>
  );
}
