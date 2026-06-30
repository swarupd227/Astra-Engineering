/**
 * Stack Modernization - Enhanced Microsoft-Style Workflow
 * Assessment → Version Selection → Planning → Task Execution → Test Generation
 */

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { cn } from "@/lib/utils";
import { useProcessingStatus } from "@/contexts/processing-status-context";
import { useParams, useLocation, useSearch, useRoute } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Upload,
  FileArchive,
  CheckCircle2,
  Loader2,
  Download,
  FileText,
  AlertTriangle,
  ClipboardCheck,
  TestTube2,
  Play,
  Sparkles,
  FileCode2,
  Layers,
  ArrowRight,
  Building2,
  FolderGit2,
  ChevronDown,
  GitBranch,
  Plus,
  History,
  Trash2,
  Zap,
  RotateCcw,
  ArrowLeft,
  X,
  Pause,
  Square,
} from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { useJiraOnlyWorkItems } from "@/hooks/use-hosting-config";
import { MarkdownViewer } from "@/components/stack-modernization/MarkdownViewer";
import { CodeDiffViewer } from "@/components/stack-modernization/CodeDiffViewer";
import { UpdatedFilesPanel } from "@/components/stack-modernization/UpdatedFilesPanel";
import { StackModIDELayout } from "@/components/stack-modernization/StackModIDELayout";
import { AssessmentCardsGrid } from "@/components/stack-modernization/AssessmentCardsGrid";
import { PlanningDashboard } from "@/components/stack-modernization/PlanningDashboard";
import { TaskExecutionAccordion } from "@/components/stack-modernization/TaskExecutionAccordion";
import { TestGenerationDashboard } from "@/components/stack-modernization/TestGenerationDashboard";
import { TestExecutionReportDashboard } from "@/components/stack-modernization/TestExecutionReportDashboard";
import { PublishModal } from "@/components/stack-modernization/PublishModal";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, PieChart, Pie, Legend } from "recharts";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  GLOBAL_ALL_ORGANIZATIONS_ID,
  useSelectedOrganization,
} from "@/contexts/selected-organization-context";

type WorkflowStage =
  | "upload"
  | "assessing"
  | "assessment_complete"
  | "planning"
  | "plan_complete"
  | "downloading_packages"
  | "packages_complete"
  | "task_planning"
  | "tasks_ready"
  | "executing"
  | "execution_complete"
  | "generating_tests"
  | "tests_generated"
  | "validating"
  | "complete"
  | "failed";

// Token usage formatting helpers
const PHASE_KEY_MAP: Record<string, string> = {
  Upload: "",
  Assessment: "assessment",
  Planning: "planning",
  Packages: "packages",
  Tasks: "tasks",
  Execution: "execution",
  Tests: "tests",
  Validation: "validation",
};

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remSec = seconds % 60;
  return `${minutes}m ${remSec}s`;
}

function formatTokens(n: number): string {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(n);
}


interface ADOProjectInfo {
  id: string;
  name: string;
  description: string;
  organization: string;
  organizationUrl: string;
  artifactOrgId?: string;
  jiraConnectionId?: string;
}

type SelectablePhase = "assessment" | "planning" | "packages" | "tasks" | "execution" | "tests" | "validation";

const FULL_PHASE_CONFIG: Array<{
  id: SelectablePhase;
  label: string;
  description: string;
  detail: string;
  dependencies: SelectablePhase[];
  dependents: SelectablePhase[];
}> = [
  { id: "assessment", label: "Assessment", description: "Analyze versions, dependencies, security, code quality", detail: "Detects tech stacks, scans all dependencies, identifies security vulnerabilities, and generates a readiness report with risk scores.", dependencies: [], dependents: ["planning"] },
  { id: "planning", label: "Planning", description: "Compatibility score, risk analysis, upgrade strategy", detail: "Calculates compatibility scores, analyzes migration risks, and produces a phased upgrade strategy with effort estimates.", dependencies: ["assessment"], dependents: ["packages"] },
  { id: "packages", label: "Packages", description: "Download and replace vendor library files", detail: "Downloads target versions of all detected vendor libraries (jQuery, Bootstrap, Font Awesome, etc.) from jsDelivr CDN and replaces them on disk. Rebuilds concatenated bundles like base-library.js with new versions.", dependencies: ["planning"], dependents: ["tasks"] },
  { id: "tasks", label: "Task Generation", description: "Break upgrade into actionable tasks", detail: "Decomposes the upgrade into scoped tasks with dependency ordering, file assignments, and clear acceptance criteria.", dependencies: ["packages"], dependents: ["execution"] },
  { id: "execution", label: "Code Upgrade", description: "Execute upgrade tasks on code files", detail: "Applies version-specific code transformations, updates imports, resolves breaking API changes, and validates output integrity.", dependencies: ["tasks"], dependents: [] },
  { id: "tests", label: "Test Generation", description: "Generate unit tests for the codebase", detail: "Generates targeted unit tests for upgraded code paths, ensuring functional correctness of all applied changes.", dependencies: [], dependents: ["validation"] },
  { id: "validation", label: "Validation", description: "Run generated tests and validate results", detail: "Executes generated tests in an isolated environment and reports pass/fail results with diagnostics.", dependencies: ["tests"], dependents: [] },
];

const FULL_PHASE_ORDER: SelectablePhase[] = ["assessment", "planning", "packages", "tasks", "execution", "tests", "validation"];

/** Stack modernization config from server (e.g. validation phase enabled/disabled). */
function useStackModConfig() {
  const { data } = useQuery({
    queryKey: ["/api/stack-modernization/config"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/stack-modernization/config");
      if (!res.ok) throw new Error("Config failed");
      return res.json();
    },
    staleTime: 5 * 60 * 1000,
  });
  const validationEnabled = data?.validationEnabled ?? false;
  const PHASE_CONFIG = useMemo(() => {
    if (validationEnabled) return FULL_PHASE_CONFIG;
    return FULL_PHASE_CONFIG
      .filter(p => p.id !== "validation")
      .map(p => p.id === "tests" ? { ...p, dependents: [] as SelectablePhase[] } : p);
  }, [validationEnabled]);
  const PHASE_ORDER: SelectablePhase[] = useMemo(
    () => (validationEnabled ? FULL_PHASE_ORDER : FULL_PHASE_ORDER.filter(p => p !== "validation")),
    [validationEnabled]
  );
  const ALL_PHASES = useMemo(() => new Set(PHASE_CONFIG.map(p => p.id)), [PHASE_CONFIG]);
  return { validationEnabled, PHASE_CONFIG, PHASE_ORDER, ALL_PHASES };
}

function ModernizationLandingPage() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const { PHASE_CONFIG, ALL_PHASES } = useStackModConfig();
  const { selectedOrganization: globalSelectedOrganization } =
    useSelectedOrganization();

  const [selectedProject, setSelectedProject] = useState<ADOProjectInfo | null>(() => {
    try {
      const stored = localStorage.getItem("stackmod:selectedProject");
      return stored ? JSON.parse(stored) : null;
    } catch { return null; }
  });
  const [projectDropdownOpen, setProjectDropdownOpen] = useState(false);
  const [projectSearch, setProjectSearch] = useState("");
  const isGlobalAllOrganizations =
    globalSelectedOrganization?.id === GLOBAL_ALL_ORGANIZATIONS_ID;

  const selectedOrgId = useMemo(() => {
    if (!globalSelectedOrganization || isGlobalAllOrganizations) return "all";
    return String(globalSelectedOrganization.id);
  }, [globalSelectedOrganization, isGlobalAllOrganizations]);
  // Align with SDLC Workflow page (sdlc.tsx) logic
  const { data: globalOrganizationsData } = useQuery<any[]>({
    queryKey: ["/api/global-organizations", "global-selector"],
    queryFn: async () => {
      const response = await apiRequest("GET", "/api/global-organizations");
      return response.json();
    },
    enabled: true
  });
  const globalOrganizations = globalOrganizationsData || [];

  const { data: sdlcProjectsList, isLoading: projectsLoading, refetch: refetchProjects } = useQuery<any[]>({
    queryKey: ["/api/sdlc/projects"],
    enabled: !!globalSelectedOrganization,
    staleTime: 10 * 60 * 1000,
  });

  const allProjects: ADOProjectInfo[] = useMemo(() => {
    const projectsArray = Array.isArray(sdlcProjectsList) ? sdlcProjectsList : [];
    const normalizeUrl = (url: string) => url.replace(/\/+$/, "").toLowerCase();

    const resolveJiraOrgName = (p: any): string => {
      if (p.jiraConnectionId) {
        const byId = globalOrganizations.find(o => o.id === p.jiraConnectionId);
        if (byId) return byId.name;
      }
      if (p.jiraInstanceUrl) {
        const projUrl = normalizeUrl(p.jiraInstanceUrl);
        const byUrl = globalOrganizations.find(
          o => o.sourceType === "jira" && o.description && normalizeUrl(o.description) === projUrl
        );
        if (byUrl) return byUrl.name;
      }
      return p.organization || "Jira";
    };

    return projectsArray.map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description || "",
      organization: p.integrationType === "jira" ? resolveJiraOrgName(p) : (p.organization || ""),
      organizationUrl: p.jiraInstanceUrl || p.organizationUrl || "",
      artifactOrgId: p.artifactOrgId || p.jiraConnectionId || undefined,
      jiraConnectionId: p.jiraConnectionId || undefined,
      sdlcProject: p,
    }));
  }, [sdlcProjectsList, globalOrganizations]);

  const filteredProjects = useMemo(() => {
    let projects = [...allProjects];
    
    // Scoping matching sdlc.tsx behavior
    if (!isGlobalAllOrganizations && globalSelectedOrganization?.id) {
      const targetId = String(globalSelectedOrganization.id);
      const targetName = (globalSelectedOrganization.name || "").toLowerCase();
      
      projects = projects.filter((p) => {
        const pOrgId = p.artifactOrgId || p.jiraConnectionId;
        const pOrgName = (p.organization || "").toLowerCase();
        return (pOrgId && String(pOrgId) === targetId) || 
               (pOrgName && pOrgName === targetName);
      });
    }

    if (projectSearch.trim()) {
      const q = projectSearch.toLowerCase();
      projects = projects.filter((p) => 
        (p.name || "").toLowerCase().includes(q) || 
        (p.organization || "").toLowerCase().includes(q)
      );
    }
    return projects;
  }, [allProjects, projectSearch, isGlobalAllOrganizations, globalSelectedOrganization]);

  useEffect(() => {
    if (selectedProject) localStorage.setItem("stackmod:selectedProject", JSON.stringify(selectedProject));
    else localStorage.removeItem("stackmod:selectedProject");
  }, [selectedProject]);

  const isGlobalSpecificOrganizationSelected = !!globalSelectedOrganization && !isGlobalAllOrganizations;
  const selectedOrganization = isGlobalSpecificOrganizationSelected
    ? globalSelectedOrganization?.name || null
    : null;

  useEffect(() => {
    if (!isGlobalSpecificOrganizationSelected || !globalSelectedOrganization?.name) return;
    setSelectedProject((currentProject) => {
      if (!currentProject) return currentProject;
      return currentProject.organization?.toLowerCase() ===
        globalSelectedOrganization.name.toLowerCase()
        ? currentProject
        : null;
    });
  }, [globalSelectedOrganization, isGlobalSpecificOrganizationSelected, isGlobalAllOrganizations]);

  const hasSelection = (!!globalSelectedOrganization || isGlobalAllOrganizations) && !!selectedProject;

  // Phase selection
  const [selectedPhases, setSelectedPhases] = useState<Set<SelectablePhase>>(() => new Set());
  useEffect(() => { setSelectedPhases(new Set(ALL_PHASES)); }, [ALL_PHASES]);

  const togglePhase = (phase: SelectablePhase) => {
    setSelectedPhases(prev => {
      const next = new Set(prev);
      if (next.has(phase)) {
        next.delete(phase);
        const config = PHASE_CONFIG.find(p => p.id === phase);
        if (config) {
          const removeDependents = (deps: SelectablePhase[]) => {
            deps.forEach(d => { next.delete(d); const dc = PHASE_CONFIG.find(p => p.id === d); if (dc) removeDependents(dc.dependents); });
          };
          removeDependents(config.dependents);
        }
      } else {
        next.add(phase);
        const config = PHASE_CONFIG.find(p => p.id === phase);
        if (config) {
          const addDependencies = (deps: SelectablePhase[]) => {
            deps.forEach(d => { next.add(d); const dc = PHASE_CONFIG.find(p => p.id === d); if (dc) addDependencies(dc.dependencies); });
          };
          addDependencies(config.dependencies);
        }
      }
      return next;
    });
  };

  const PHASE_ICONS: Record<string, React.ElementType> = {
    assessment: ClipboardCheck, planning: FileText, tasks: Layers, execution: FileCode2, tests: TestTube2, validation: Play,
  };

  const [deletingAnalysisId, setDeletingAnalysisId] = useState<string | null>(null);

  const { data: previousAnalyses, isLoading: analysesLoading, refetch: refetchAnalyses } = useQuery<any[]>({
    queryKey: ["/api/stack-modernization/analyses", selectedOrganization, selectedProject?.id],
    queryFn: async () => {
      const response = await apiRequest("GET", `/api/stack-modernization/analyses?adoOrg=${encodeURIComponent(selectedOrganization!)}&adoProjectId=${encodeURIComponent(selectedProject!.id)}`);
      return response.json();
    },
    enabled: hasSelection,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });

  const handleStartModernization = () => {
    if (!selectedOrganization || !selectedProject) {
      toast({ title: "Selection Required", description: "Please select an Organization and Project before proceeding.", variant: "destructive" });
      return;
    }
    if (selectedPhases.size === 0) {
      toast({ title: "Phase Required", description: "Select at least one workflow phase to continue.", variant: "destructive" });
      return;
    }
    const params = new URLSearchParams();
    params.set("org", selectedOrganization);
    params.set("projectId", selectedProject.id);
    params.set("projectName", selectedProject.name);
    if (selectedProject.organizationUrl) params.set("orgUrl", selectedProject.organizationUrl);
    if (selectedPhases.size > 0 && selectedPhases.size < ALL_PHASES.size) {
      params.set("phases", Array.from(selectedPhases).join(","));
    }
    navigate(`/stack-modernization/tech-stack-upgrade?${params.toString()}`);
  };

  const handleDeleteAnalysis = async (analysisId: string) => {
    try {
      setDeletingAnalysisId(analysisId);
      await apiRequest("DELETE", `/api/stack-modernization/analysis/${analysisId}`);
      refetchAnalyses();
      toast({ title: "Analysis deleted", description: "The analysis has been removed." });
    } catch (error) {
      toast({ title: "Delete failed", description: "Could not delete the analysis.", variant: "destructive" });
    } finally {
      setDeletingAnalysisId(null);
    }
  };

  const handleResumeAnalysis = (analysisId: string) => {
    navigate(`/stack-modernization/tech-stack-upgrade?org=${encodeURIComponent(selectedOrganization!)}&projectId=${encodeURIComponent(selectedProject!.id)}&projectName=${encodeURIComponent(selectedProject!.name)}&analysisId=${encodeURIComponent(analysisId)}`);
  };

  const timeAgo = (dateStr: string) => {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    if (days < 30) return `${days}d ago`;
    return `${Math.floor(days / 30)}mo ago`;
  };

  return (
    <div className="h-screen bg-background flex flex-col overflow-hidden">
      {/* Header bar with org/project selectors */}
      <div className="border-b border-border bg-card p-6 flex-shrink-0">
        <PageHeader icon={Sparkles} title="Stack Modernization" subtitle="AI-powered codebase analysis for tech stack upgrades" color="violet">
          <div className="flex items-center gap-4">
            {/* Project */}
            <Popover open={projectDropdownOpen} onOpenChange={(open) => {
              setProjectDropdownOpen(open);
              if (open && !sdlcProjectsList) refetchProjects();
              if (!open) setProjectSearch("");
            }}>
              <PopoverTrigger asChild>
                <Button variant="outline" role="combobox" className="w-[200px] justify-between text-xs h-9" disabled={!selectedOrganization && !isGlobalAllOrganizations}>
                  <div className="flex items-center gap-1.5 min-w-0">
                    <FolderGit2 className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                    <span className="truncate">{selectedProject?.name || "Project..."}</span>
                  </div>
                  <ChevronDown className="ml-1 h-3 w-3 shrink-0 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[300px] p-0" align="end">
                <Command shouldFilter={false} className="rounded-lg">
                  <CommandInput placeholder="Search projects..." value={projectSearch} onValueChange={setProjectSearch} className="h-9" />
                  <CommandList className="max-h-[250px]">
                    <CommandEmpty>
                      {projectsLoading ? (
                        <div className="flex items-center justify-center py-4"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground mr-2" /><span className="text-sm text-muted-foreground">Loading...</span></div>
                      ) : (
                        <div className="py-4 text-center text-sm text-muted-foreground">No projects found</div>
                      )}
                    </CommandEmpty>
                    <CommandGroup>
                      {filteredProjects.map((project) => (
                        <CommandItem key={project.id} value={project.name} onSelect={() => { setSelectedProject(project); setProjectDropdownOpen(false); }} className="cursor-pointer py-2 px-3">
                          <div className="flex items-center justify-between w-full gap-2">
                            <div className="min-w-0">
                              <span className="font-medium text-sm block truncate">{project.name}</span>
                              <div className="flex items-center gap-1.5 overflow-hidden">
                                <span className="text-[10px] text-primary/70 font-semibold uppercase tracking-tight flex-shrink-0">{project.organization}</span>
                                {project.description && (
                                  <>
                                    <span className="text-[10px] text-muted-foreground/50 flex-shrink-0">•</span>
                                    <span className="text-[10px] text-muted-foreground truncate">{project.description}</span>
                                  </>
                                )}
                              </div>
                            </div>
                            {selectedProject?.id === project.id && <CheckCircle2 className="h-4 w-4 text-primary shrink-0" />}
                          </div>
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
          </div>
        </PageHeader>
      </div>

      {/* Main content */}
      <div className="flex-1 overflow-hidden p-6 flex flex-col gap-4">
        {!hasSelection && (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center space-y-3">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-muted mx-auto">
                <Building2 className="h-7 w-7 text-muted-foreground" />
              </div>
              <div>
                <p className="text-sm font-medium">Select an Organization & Project</p>
                <p className="text-xs text-muted-foreground mt-1">Choose your organization and project from the top-right to get started.</p>
              </div>
            </div>
          </div>
        )}

        {hasSelection && (
          <div className="flex flex-col gap-5 flex-1 overflow-auto">
            {/* Previous Analyses */}
            <div className="rounded-2xl shadow-sm border border-border/40 bg-card p-5 flex-shrink-0">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <History className="h-4 w-4 text-muted-foreground" />
                  <h3 className="text-sm font-semibold">Previous Analyses</h3>
                  <span className="text-xs text-muted-foreground">for {selectedOrganization} / {selectedProject?.name}</span>
                </div>
              </div>
              {analysesLoading ? (
                <div className="flex items-center gap-2 py-3 text-xs text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Loading previous sessions...
                </div>
              ) : !previousAnalyses || previousAnalyses.length === 0 ? (
                <div className="py-3 text-xs text-muted-foreground">
                  No previous analyses found for this project. Start a new upgrade below.
                </div>
              ) : (
                <div className="space-y-2">
                  {previousAnalyses.slice(0, 5).map((a: any) => (
                    <div key={a.id} className="flex items-center justify-between rounded-lg border border-border/30 bg-muted/30 px-4 py-3 text-sm">
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium whitespace-nowrap ${
                          a.status === "completed" ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400" :
                          a.status === "failed" ? "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-400" :
                          "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400"
                        }`}>
                          {a.status === "completed" ? "Completed" : a.status === "failed" ? "Failed" : "In Progress"}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-foreground truncate">{a.repoName || "Untitled"}</span>
                            <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded-full whitespace-nowrap">Tech Stack Upgrade</span>
                          </div>
                          <div className="flex items-center gap-2 mt-0.5 min-w-0">
                            {a.stackSummary && (
                              <span className="text-[11px] text-muted-foreground truncate max-w-[70ch]" title={a.stackSummary}>
                                {a.stackSummary.length > 70 ? a.stackSummary.slice(0, 70) + "..." : a.stackSummary}
                              </span>
                            )}
                            <span className="text-[11px] text-muted-foreground whitespace-nowrap flex-shrink-0">{timeAgo(a.updatedAt || a.createdAt)}</span>
                          </div>
                        </div>
                        <div className="w-16 flex-shrink-0">
                          <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                            <div
                              className={`h-full rounded-full transition-all ${a.status === "completed" ? "bg-emerald-500" : a.status === "failed" ? "bg-red-500" : "bg-violet-500"}`}
                              style={{ width: `${a.progress ?? 0}%` }}
                            />
                          </div>
                          <span className="text-[10px] text-muted-foreground">{a.progress ?? 0}%</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 ml-3 flex-shrink-0">
                        <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => handleResumeAnalysis(a.id)}>
                          Resume
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 text-xs text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950"
                          onClick={() => handleDeleteAnalysis(a.id)}
                          disabled={deletingAnalysisId === a.id}
                        >
                          {deletingAnalysisId === a.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Tech Stack Upgrade Card with Phase Selection */}
            <div className="rounded-2xl shadow-sm border border-border/40 border-l-[3px] border-l-violet-500 bg-card flex-shrink-0">
              <div className="p-5 pb-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-violet-100 dark:bg-violet-950">
                    <Sparkles className="h-4.5 w-4.5 text-violet-600 dark:text-violet-400" />
                  </div>
                  <div>
                    <h2 className="text-base font-semibold">Tech Stack Upgrade</h2>
                    <p className="text-xs text-muted-foreground">Upgrade dependencies and frameworks to their latest stable versions</p>
                  </div>
                </div>
                <Button onClick={handleStartModernization} disabled={selectedPhases.size === 0} size="sm">
                  Continue <ArrowRight className="h-3.5 w-3.5 ml-1.5" />
                </Button>
              </div>

              <div className="px-5 pb-5">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Workflow Phases</h3>
                  <div className="flex items-center gap-1">
                    <Button variant="ghost" size="sm" className="text-[10px] h-6 px-2" onClick={() => setSelectedPhases(new Set(ALL_PHASES))}>All</Button>
                    <Button variant="ghost" size="sm" className="text-[10px] h-6 px-2" onClick={() => setSelectedPhases(new Set())}>None</Button>
                  </div>
                </div>

                <div className="grid grid-cols-2 lg:grid-cols-3 gap-1.5">
                  {PHASE_CONFIG.map((phase) => {
                    const isSelected = selectedPhases.has(phase.id);
                    const depsUnmet = phase.dependencies.some(d => !selectedPhases.has(d));
                    const PhaseIcon = PHASE_ICONS[phase.id] || Layers;
                    return (
                      <div
                        key={phase.id}
                        className={`flex items-start gap-2.5 rounded-lg p-2.5 transition-all cursor-pointer ${
                          isSelected
                            ? "bg-violet-50/60 dark:bg-violet-950/20"
                            : depsUnmet
                              ? "opacity-35 cursor-not-allowed"
                              : "hover:bg-muted/50"
                        }`}
                        onClick={() => !depsUnmet && togglePhase(phase.id)}
                      >
                        <Switch
                          checked={isSelected}
                          onCheckedChange={() => !depsUnmet && togglePhase(phase.id)}
                          disabled={depsUnmet && !isSelected}
                          className="mt-0.5 scale-75 origin-left"
                        />
                        <PhaseIcon className={`h-4 w-4 mt-0.5 shrink-0 ${isSelected ? "text-violet-600 dark:text-violet-400" : "text-muted-foreground"}`} />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="text-sm font-medium">{phase.label}</span>
                            {phase.dependencies.length > 0 && (
                              <span className="text-[9px] text-muted-foreground/60 bg-muted px-1.5 py-0.5 rounded-full">
                                Req: {phase.dependencies.map(d => PHASE_CONFIG.find(p => p.id === d)?.label).join(", ")}
                              </span>
                            )}
                          </div>
                          <p className="text-[11px] text-muted-foreground leading-relaxed mt-0.5">{phase.detail}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {selectedPhases.size === 0 && (
                  <p className="text-xs text-amber-600 dark:text-amber-400 mt-2">Select at least one phase to continue.</p>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function StackModernizationPage() {
  const params = useParams<{ type?: string }>();

  if (!params.type) {
    return <ModernizationLandingPage />;
  }

  if (params.type !== "tech-stack-upgrade") {
    return (
      <div className="flex-1 p-6 flex items-center justify-center">
        <Card className="max-w-md w-full">
          <CardContent className="pt-6 text-center space-y-4">
            <Layers className="h-12 w-12 mx-auto text-muted-foreground" />
            <h2 className="text-lg font-semibold">Coming Soon</h2>
            <p className="text-sm text-muted-foreground">
              This modernization type is under development. Please select Tech Stack Upgrade for now.
            </p>
            <Button variant="outline" onClick={() => window.history.back()}>
              Go Back
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return <TechStackUpgradeWorkflow />;
}

function TechStackUpgradeWorkflow() {
  const { toast } = useToast();
  const search = useSearch();
  const { setProcessingStatus } = useProcessingStatus();
  const { validationEnabled, PHASE_CONFIG, PHASE_ORDER, ALL_PHASES } = useStackModConfig();
  const jiraOnlyHosting = useJiraOnlyWorkItems();

  // Read org/project from URL params (set by landing page) or localStorage fallback
  const urlParams = new URLSearchParams(search);
  const adoOrg = urlParams.get("org") || localStorage.getItem("stackmod:selectedOrganization") || "";
  const adoProjectId = urlParams.get("projectId") || "";
  const adoProjectName = urlParams.get("projectName") || "";
  const adoOrgUrl = urlParams.get("orgUrl") || "";

  const phasesParam = urlParams.get("phases");
  const selectedPhases = useMemo<Set<SelectablePhase>>(() => {
    if (!phasesParam) return new Set(ALL_PHASES);
    const parsed = phasesParam.split(",").filter(p => ALL_PHASES.has(p as SelectablePhase)) as SelectablePhase[];
    return parsed.length > 0 ? new Set(parsed) : new Set(ALL_PHASES);
  }, [phasesParam, ALL_PHASES]);

  // Upload input method: "file" (ZIP) or "git" (repo URL); init from query when landing with repoUrl
  const initialRepoUrl = urlParams.get("repoUrl") || "";
  const initialBranch = urlParams.get("branch") || "main";
  const [inputMethod, setInputMethod] = useState<"file" | "git">(initialRepoUrl ? "git" : "file");
  const [repoUrl, setRepoUrl] = useState(initialRepoUrl);
  const [branch, setBranch] = useState(initialBranch);
  const [gitToken, setGitToken] = useState("");

  // Core state
  const [stage, setStage] = useState<WorkflowStage>("upload");
  const [files, setFiles] = useState<File[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [statusMessage, setStatusMessage] = useState("");
  const [uploadPhase, setUploadPhase] = useState<"idle" | "uploading" | "analyzing">("idle");
  const [uploadProgress, setUploadProgress] = useState(0);
  const [isPaused, setIsPaused] = useState(false);

  // Sync processing status to global context (for FAB loader ring)
  useEffect(() => {
    setProcessingStatus(isProcessing, stage);
    return () => setProcessingStatus(false);
  }, [isProcessing, stage]); // eslint-disable-line react-hooks/exhaustive-deps

  // Analysis state
  const [analysisId, setAnalysisId] = useState<string | null>(null);
  const [assessmentMarkdown, setAssessmentMarkdown] = useState<string>("");
  const [versionRecommendationsText, setVersionRecommendationsText] = useState<string>("");
  const [planMarkdown, setPlanMarkdown] = useState<string>("");
  const [tasksMarkdown, setTasksMarkdown] = useState<string>("");
  const [testResultsMarkdown, setTestResultsMarkdown] = useState<string>("");
  const [progressData, setProgressData] = useState<any>(null); // Store full progress data
  const [failureMessage, setFailureMessage] = useState<string>("");
  const [failedAtStage, setFailedAtStage] = useState<string>("");
  const [viewStage, setViewStage] = useState<WorkflowStage | null>(null);
  
  // LLM Selection
  const [selectedLLM, setSelectedLLM] = useState(jiraOnlyHosting ? "bedrock" : "gpt-5.4");
  const [llmProviders, setLlmProviders] = useState<Array<{ value: string; label: string; description: string; available: boolean }>>([]);
  
  // Modal state for viewing documents
  const [viewerOpen, setViewerOpen] = useState(false);
  const [viewerTitle, setViewerTitle] = useState("");
  const [viewerContent, setViewerContent] = useState("");
  const [viewerDownloadType, setViewerDownloadType] = useState<string>("");
  const [viewerStreamConfig, setViewerStreamConfig] = useState<{ analysisId: string; reportType: "assessment" | "risk" | "compatibility" | "plan" } | null>(null);
  const [filesPanelOpen, setFilesPanelOpen] = useState(false);
  
  // Validation panel: stays open until user clicks Close (do not auto-close when validation completes)
  const [showValidationPanel, setShowValidationPanel] = useState(false);
  const [showMetricsModal, setShowMetricsModal] = useState(false);

  // Publish to ADO modal
  const [publishModalOpen, setPublishModalOpen] = useState(false);

  // Version change history
  const [versionChangeHistory, setVersionChangeHistory] = useState<any[]>([]);
  const [showVersionHistory, setShowVersionHistory] = useState(false);

  useEffect(() => {
    if (!analysisId || stage !== "assessment_complete") return;
    (async () => {
      try {
        const res = await apiRequest("GET", `/api/stack-modernization/analysis/${analysisId}/version-changes`);
        if (res.ok) {
          const data = await res.json();
          setVersionChangeHistory(data.changes || []);
        }
      } catch { /* non-critical */ }
    })();
  }, [analysisId, stage]); // eslint-disable-line react-hooks/exhaustive-deps

  // Add Task dialog state
  const [addTaskOpen, setAddTaskOpen] = useState(false);
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [newTaskDescription, setNewTaskDescription] = useState("");
  const [newTaskSteps, setNewTaskSteps] = useState("");
  const [newTaskRisk, setNewTaskRisk] = useState<"low" | "medium" | "high">("medium");
  const [addingTask, setAddingTask] = useState(false);

  const handleAddTask = async () => {
    if (!analysisId || !newTaskTitle.trim() || !newTaskDescription.trim()) return;
    setAddingTask(true);
    try {
      const response = await apiRequest("POST", `/api/stack-modernization/analysis/${analysisId}/add-task`, {
        title: newTaskTitle.trim(),
        description: newTaskDescription.trim(),
        steps: newTaskSteps.trim() ? newTaskSteps.trim().split("\n").filter(Boolean) : [],
        riskLevel: newTaskRisk,
        affectedFiles: [],
        phase: "code",
      });
      const data = await response.json();
      toast({ title: "Task Added", description: `${data.task?.id || "New task"}: ${newTaskTitle}` });
      setAddTaskOpen(false);
      setNewTaskTitle("");
      setNewTaskDescription("");
      setNewTaskSteps("");
      setNewTaskRisk("medium");
    } catch (err) {
      toast({ title: "Failed to add task", description: String(err), variant: "destructive" });
    } finally {
      setAddingTask(false);
    }
  };

  const phaseButtonLabels: Record<SelectablePhase, string> = {
    assessment: "Run Assessment",
    planning: "Continue to Planning",
    packages: "Download Packages",
    tasks: "Generate Task List",
    execution: "Execute All Tasks",
    tests: "Generate Unit Tests",
    validation: "Execute test cases",
  };

  const getNextSelectedPhase = (afterPhase: SelectablePhase): SelectablePhase | null => {
    const idx = PHASE_ORDER.indexOf(afterPhase);
    for (let i = idx + 1; i < PHASE_ORDER.length; i++) {
      if (selectedPhases.has(PHASE_ORDER[i])) return PHASE_ORDER[i];
    }
    return null;
  };

  // Resume a previous analysis from URL params
  const resumeAnalysisId = urlParams.get("analysisId");
  useEffect(() => {
    if (!resumeAnalysisId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await apiRequest("GET", `/api/stack-modernization/analysis/${resumeAnalysisId}/load`);
        if (!res.ok || cancelled) return;
        const data = await res.json();
        setAnalysisId(resumeAnalysisId);
        setProgressData(data);
        if (data.assessmentMarkdown) setAssessmentMarkdown(data.assessmentMarkdown);
        if (data.versionRecommendationsText) setVersionRecommendationsText(data.versionRecommendationsText);
        if (data.planMarkdown) setPlanMarkdown(data.planMarkdown);
        if (data.tasksMarkdown) setTasksMarkdown(data.tasksMarkdown);
        if (data.testResultsMarkdown) setTestResultsMarkdown(data.testResultsMarkdown);
        setProgress(data.progress ?? 100);
        setStatusMessage(data.currentStage ?? "Loaded from previous session");

        // Determine the correct workflow stage from loaded data
        const hasTests = (data.generatedTests?.length ?? 0) > 0;
        const hasModified = (data.modifiedFiles?.length ?? 0) > 0 || (data.codeUpgrade?.modifiedFiles?.length ?? 0) > 0;
        const hasTasks = (data.upgradeTasks?.length ?? 0) > 0;
        const hasPlan = !!data.planMarkdown;
        const hasAssessment = !!data.assessmentMarkdown || (data.versionIntelligence?.length ?? 0) > 0;

        if (data.status === "failed") {
          setStage("failed");
          setFailureMessage(data.errors?.join("; ") || "Analysis failed");
        } else if (data.status === "completed" || (hasTests && data.status !== "in_progress")) {
          setStage("tests_generated");
        } else if (hasModified) {
          setStage("execution_complete");
        } else if (hasTasks) {
          setStage("tasks_ready");
        } else if (hasPlan) {
          setStage("plan_complete");
        } else if (hasAssessment) {
          setStage("assessment_complete");
        } else if (data.status === "in_progress") {
          setStage("assessing");
        }
      } catch {
        toast({ title: "Could not load analysis", description: "The analysis may no longer exist.", variant: "destructive" });
      }
    })();
    return () => { cancelled = true; };
  }, [resumeAnalysisId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Phase 4: "New" badge when modifiedFiles or activity increases
  const prevModifiedCountRef = useRef(0);
  const prevActivityLengthRef = useRef(0);
  const [showNewFilesBadge, setShowNewFilesBadge] = useState(false);
  const [showNewActivityBadge, setShowNewActivityBadge] = useState(false);
  
  // Reset refs when starting a new analysis
  useEffect(() => {
    if (!analysisId) {
      prevModifiedCountRef.current = 0;
      prevActivityLengthRef.current = 0;
    }
  }, [analysisId]);
  
  // Phase 4: Show "New" badge when modifiedFiles or activity log increases
  useEffect(() => {
    if (!progressData) return;
    const fileCount = progressData.modifiedFiles?.length ?? 0;
    const activityLen = progressData.activityLog?.length ?? 0;
    if (fileCount > prevModifiedCountRef.current && prevModifiedCountRef.current > 0) {
      setShowNewFilesBadge(true);
      setTimeout(() => setShowNewFilesBadge(false), 3000);
    }
    prevModifiedCountRef.current = fileCount;
    if (activityLen > prevActivityLengthRef.current && prevActivityLengthRef.current > 0) {
      setShowNewActivityBadge(true);
      setTimeout(() => setShowNewActivityBadge(false), 3000);
    }
    prevActivityLengthRef.current = activityLen;
  }, [progressData?.modifiedFiles?.length, progressData?.activityLog?.length]);
  
  // Load available LLM providers
  useEffect(() => {
    apiRequest("GET", "/api/stack-modernization/llm-providers")
      .then(res => res.ok ? res.json() : Promise.reject())
      .then(data => {
        if (data.providers && Array.isArray(data.providers)) {
          setLlmProviders(data.providers);
        }
        if (data.default) {
          setSelectedLLM(data.default);
        }
      })
      .catch(() => {
        setLlmProviders(
          jiraOnlyHosting
            ? [{ value: "bedrock", label: "Bedrock (Claude)", description: "Amazon Bedrock hosted Claude model", available: true }]
            : [
                { value: "gpt-5.4", label: "GPT-5.4", description: "Latest & most capable GPT model", available: true },
                { value: "claude-opus-4-1", label: "Claude Opus 4.1", description: "Most capable Anthropic model", available: true },
              ]
        );
      });
  }, []);

  // Progress poller: keep progressData fresh during active stages.
  // In waiting stages, only poll when the backend hasn't finished yet (edge case: skip path).
  // Terminal stages ("complete", "failed") never poll.
  const loadingStages: WorkflowStage[] = ["assessing", "planning", "task_planning", "executing", "generating_tests", "validating"];
  const waitingStages: WorkflowStage[] = ["assessment_complete", "plan_complete", "tasks_ready", "execution_complete", "tests_generated"];
  const terminalStages: WorkflowStage[] = ["complete", "failed"];
  const backendDone = progressData?.status === "completed" || progressData?.status === "failed";
  const shouldPollProgress = !!analysisId && !terminalStages.includes(stage) && (
    loadingStages.includes(stage) || (waitingStages.includes(stage) && !backendDone)
  );

  useEffect(() => {
    if (!shouldPollProgress || !analysisId) return;

    let pollCount = 0;
    const poll = async () => {
      try {
        const res = await apiRequest("GET", `/api/stack-modernization/analysis/${analysisId}/progress`);
        if (res.ok) {
          const data = await res.json();
          setProgressData(data);
        }
      } catch {
        // ignore
      }
      pollCount++;
    };

    poll();
    const interval = setInterval(poll, 3000);
    return () => clearInterval(interval);
  }, [analysisId, shouldPollProgress, stage]); // eslint-disable-line react-hooks/exhaustive-deps

  // Retry polling: when a task retry is triggered, poll for updates until the task finishes
  const [retryPolling, setRetryPolling] = useState(false);
  const retryPollStartRef = useRef<number>(0);
  useEffect(() => {
    if (!retryPolling || !analysisId) return;
    retryPollStartRef.current = Date.now();
    let active = true;
    const pollRetry = async () => {
      try {
        const res = await apiRequest("GET", `/api/stack-modernization/analysis/${analysisId}/progress`);
        if (res.ok && active) {
          const data = await res.json();
          setProgressData(data);
          const hasInProgress = (data.taskExecutionResults || []).some((r: any) => r.status === "in_progress");
          // Grace period: don't stop polling in the first 5 seconds (server may still be persisting)
          const elapsed = Date.now() - retryPollStartRef.current;
          if (!hasInProgress && elapsed > 5000) setRetryPolling(false);
        }
      } catch { /* ignore */ }
    };
    pollRetry();
    const interval = setInterval(pollRetry, 3000);
    // Safety timeout: stop polling after 5 minutes max
    const timeout = setTimeout(() => { if (active) setRetryPolling(false); }, 5 * 60 * 1000);
    return () => { active = false; clearInterval(interval); clearTimeout(timeout); };
  }, [retryPolling, analysisId]);

  const handleRetryStarted = useCallback(() => {
    setRetryPolling(true);
  }, []);

  // When in validating stage and progress API returns a terminal validationRun status, workflow is complete
  useEffect(() => {
    if (stage !== "validating" || !progressData?.validationRun) return;
    const vStatus = progressData.validationRun.status;
    if (vStatus === "running") return; // still in progress
    setProgress(100);
    setStage("complete");
    toast({
      title: vStatus === "passed" ? "Validation Passed!" : "Validation Complete",
      description: progressData.validationPassed
        ? "All tests passed. Download your upgraded code and tests."
        : "Validation finished. Review results and download your artifacts.",
    });
  }, [stage, progressData?.validationRun, progressData?.validationRun?.status, progressData?.validationPassed]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-advance: the background poller keeps progressData fresh. When the graph
  // has moved ahead of the current frontend stage (e.g. because phases were skipped
  // or the graph completed while a handler wasn't polling), this effect transitions
  // the frontend stage to match.
  useEffect(() => {
    if (!progressData || isProcessing) return;
    const ds = progressData.currentStage || "";
    const backendCompleted = progressData.status === "completed";
    const backendFailed = progressData.status === "failed";

    if (backendFailed) return; // handled elsewhere

    // --- generating_tests → tests_generated ---
    if (stage === "generating_tests") {
      const hasTests = (progressData.generatedTests?.length ?? 0) > 0;
      if (hasTests || ds === "tests_generated" || backendCompleted) {
        setTestResultsMarkdown(progressData.testResultsMarkdown || "");
        setStage("tests_generated");
        setProgress(100);
        toast({ title: "Tests Generated", description: "Review generated test cases." });
        return;
      }
    }

    // --- task_planning → tasks_ready (graph finished tasks while poller was running) ---
    if (stage === "task_planning") {
      if ((progressData.upgradeTasks?.length ?? 0) > 0 || ds === "tasks_ready" || backendCompleted) {
        if (progressData.tasksMarkdown) setTasksMarkdown(progressData.tasksMarkdown);
        setStage("tasks_ready");
        setProgress(100);
        toast({ title: "Tasks Generated", description: `${progressData.upgradeTasks?.length || 0} tasks ready.` });
        return;
      }
    }

    // --- executing → execution_complete ---
    if (stage === "executing") {
      if (ds === "execution_complete" || backendCompleted) {
        setStage("execution_complete");
        setProgress(100);
        toast({ title: "Execution Complete", description: `Upgraded ${progressData.modifiedFiles?.length || 0} files.` });
        return;
      }
    }

    // --- Any loading stage where backend already completed ---
    // Excludes interactive waiting stages (assessment_complete requires user action)
    // and terminal waiting stages that are already correct.
    if (backendCompleted && !["complete", "tests_generated", "execution_complete", "tasks_ready", "plan_complete", "assessment_complete", "upload", "failed", "validating"].includes(stage)) {
      if ((progressData.generatedTests?.length ?? 0) > 0) {
        setTestResultsMarkdown(progressData.testResultsMarkdown || "");
        setStage("tests_generated");
      } else if ((progressData.modifiedFiles?.length ?? 0) > 0) {
        setStage("execution_complete");
      } else if (progressData.planMarkdown) {
        setPlanMarkdown(progressData.planMarkdown);
        setStage("plan_complete");
      } else {
        setStage("complete");
      }
      setProgress(100);
    }
  }, [stage, progressData?.currentStage, progressData?.status, progressData?.generatedTests?.length, progressData?.modifiedFiles?.length, progressData?.upgradeTasks?.length, isProcessing]); // eslint-disable-line react-hooks/exhaustive-deps

  // File upload handler
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      setFiles(Array.from(e.target.files));
    }
  };

  // Step 1: Upload & Assess
  const handleUploadAndAssess = async () => {
    if (files.length === 0) {
      toast({
        title: "No Files Selected",
        description: "Please select a ZIP file or code files to upload",
        variant: "destructive"
      });
      return;
    }

    setIsProcessing(true);
    setProgress(0);
    setUploadPhase("uploading");
    setUploadProgress(0);
    setStatusMessage("Uploading files...");
    setStage("assessing");

    try {
      // Upload files using apiRequest (auth handled automatically by fetch interceptor)
      const formData = new FormData();
      formData.append('modernizationType', 'upgrade');
      formData.append('llmProvider', selectedLLM);
      files.forEach(file => formData.append('files', file));

      // Simulate smooth upload progress while the fetch runs
      const totalSize = files.reduce((sum, f) => sum + f.size, 0);
      const estimatedMs = Math.max(1000, Math.min(totalSize / 50000, 10000)); // 1-10s estimate
      const progressInterval = setInterval(() => {
        setUploadProgress(prev => {
          const next = prev + Math.random() * 15 + 5;
          return Math.min(next, 90); // Cap at 90% until actual completion
        });
      }, estimatedMs / 10);

      let uploadData: any;
      try {
        // Retry upload up to 3 times on auth/transient failures
        let uploadRes: Response | null = null;
        let lastError: Error | null = null;
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            // Rebuild FormData for each attempt (body is consumed after first fetch)
            const fd = new FormData();
            fd.append('modernizationType', 'upgrade');
            fd.append('llmProvider', selectedLLM);
            files.forEach(file => fd.append('files', file));
            uploadRes = await apiRequest("POST", "/api/stack-modernization/upload", fd);
            if (uploadRes.ok) break;
            if (uploadRes.status === 401 && attempt < 2) {
              await new Promise(r => setTimeout(r, 2000));
              continue;
            }
            throw new Error(`Upload failed (${uploadRes.status})`);
          } catch (err) {
            lastError = err instanceof Error ? err : new Error(String(err));
            if (attempt < 2) {
              await new Promise(r => setTimeout(r, 2000));
              continue;
            }
          }
        }
        if (!uploadRes?.ok) throw lastError || new Error("Upload failed");
        uploadData = await uploadRes.json();
      } finally {
        clearInterval(progressInterval);
      }

      setUploadPhase("analyzing");
      setUploadProgress(100);
      setProgress(10);
      setAnalysisId(uploadData.analysisId);

      // Poll until background extraction is complete before triggering analysis
      if (uploadData.status === "extracting") {
        setStatusMessage("Extracting files...");
        // eslint-disable-next-line no-constant-condition
        while (true) {
          await new Promise(resolve => setTimeout(resolve, 2000));
          const extractionRes = await apiRequest("GET", `/api/stack-modernization/analysis/${uploadData.analysisId}/progress`);
          if (!extractionRes.ok) throw new Error("Failed to check extraction progress");
          const extractionData = await extractionRes.json();
          setStatusMessage(extractionData.currentStage || "Extracting files...");
          if (extractionData.status === "failed") {
            throw new Error(extractionData.errors?.[0] || "File extraction failed");
          }
          if (extractionData.status === "uploaded" || extractionData.currentStage === "uploaded") {
            break;
          }
        }
      }

      setProgress(20);
      const assessmentSelected = selectedPhases.has("assessment");
      setStatusMessage(assessmentSelected ? "Running assessment..." : "Running selected phases...");
      const analyzeRes = await apiRequest("POST", "/api/stack-modernization/analyze", {
        sessionId: uploadData.sessionId,
        modernizationType: "upgrade",
        tempDir: uploadData.tempDir || "",
        llmProvider: selectedLLM,
        adoOrg,
        adoProjectId,
        adoProjectName,
        ...(selectedPhases.size < ALL_PHASES.size ? { selectedPhases: Array.from(selectedPhases) } : {}),
      });

      if (!analyzeRes.ok) throw new Error("Analysis failed");
      const analyzeData = await analyzeRes.json();
      setAnalysisId(analyzeData.analysisId);
      const pollStartTime = Date.now();

      // eslint-disable-next-line no-constant-condition
      while (true) {
        await new Promise(resolve => setTimeout(resolve, 1500));

        const progressRes = await apiRequest("GET", `/api/stack-modernization/analysis/${analyzeData.analysisId}/progress`);
        if (!progressRes.ok) throw new Error("Failed to get progress");

        const pd = await progressRes.json();
        setProgressData(pd);
        const ds = pd.currentStage || "";
        const elapsedMin = (Date.now() - pollStartTime) / 60_000;
        setProgress(Math.min(20 + elapsedMin * 2, 95));
        setStatusMessage(ds || "Processing...");

        // ── Failed ──
        if (pd.status === "failed") {
          throw new Error(pd.errors?.[0] || "Processing failed");
        }

        // ── Paused / Cancelled ──
        if (pd.status === "paused") {
          setIsPaused(true);
          setIsProcessing(false);
          break;
        }
        if (pd.status === "cancelled") {
          setStage("upload");
          setIsProcessing(false);
          break;
        }

        // ── Graph completed (all selected phases finished) ──
        if (pd.status === "completed") {
          setProgress(100);
          if ((pd.generatedTests?.length ?? 0) > 0) {
            setTestResultsMarkdown(pd.testResultsMarkdown || "");
            setStage("tests_generated");
            toast({ title: "Tests Generated", description: "Review generated test cases." });
          } else if ((pd.modifiedFiles?.length ?? 0) > 0) {
            setStage("execution_complete");
            toast({ title: "Execution Complete", description: `Upgraded ${pd.modifiedFiles.length} files.` });
          } else if (pd.planMarkdown) {
            setPlanMarkdown(pd.planMarkdown);
            setStage("plan_complete");
            toast({ title: "Planning Complete", description: "Review the upgrade plan." });
          } else {
            setStage("complete");
            toast({ title: "Complete", description: "All selected phases finished." });
          }
          break;
        }

        // ── Assessment selected: wait for assessment to finish (awaiting_user_selection) ──
        if (assessmentSelected) {
          const isAwaiting = pd.currentStage === "awaiting_user_selection" ||
               pd.status === "awaiting_user_selection" ||
               pd.currentStage?.includes("awaiting");
          const hasAssessmentArtifacts = pd.assessmentMarkdown && pd.versionRecommendationsText;
          if (hasAssessmentArtifacts && (isAwaiting || pd.status === "in_progress")) {
            setAssessmentMarkdown(pd.assessmentMarkdown);
            setVersionRecommendationsText(pd.versionRecommendationsText);
            setProgress(100);
            setStatusMessage("Assessment complete");
            setStage("assessment_complete");
            setIsProcessing(false);
            toast({ title: "Assessment Complete", description: "Review the assessment and edit version recommendations." });
            break;
          }
        }

        // ── Assessment NOT selected: detect graph advancing past assessment ──
        if (!assessmentSelected) {
          const graphAdvanced =
            ds === "generating_tests" || ds === "tests_generated" ||
            ds === "task_planning" || ds === "tasks_ready" ||
            ds === "executing" || ds === "execution_complete" ||
            ds.includes("Upgrading") || ds.includes("Classifying") || ds.includes("Grouping");

          if (graphAdvanced) {
            if (ds === "tests_generated" || (pd.generatedTests?.length ?? 0) > 0) {
              setTestResultsMarkdown(pd.testResultsMarkdown || "");
              setStage("tests_generated");
              setProgress(100);
              toast({ title: "Tests Generated", description: "Review generated test cases." });
            } else if (ds === "generating_tests") {
              setStage("generating_tests");
            } else if (ds === "execution_complete") {
              setStage("execution_complete");
              setProgress(100);
            } else if (ds === "executing" || ds.includes("Upgrading") || ds.includes("Classifying") || ds.includes("Grouping")) {
              setStage("executing");
            } else if (ds === "tasks_ready") {
              setStage("tasks_ready");
              setProgress(100);
            } else if (ds === "task_planning") {
              setStage("task_planning");
            }
            break;
          }
        }
      }

    } catch (error) {
      console.error("[Assessment] Error:", error);
      const errMsg = error instanceof Error ? error.message : "Unknown error";
      setFailureMessage(errMsg);
      setFailedAtStage("assessing");
      setStage("failed");
      toast({
        title: "Assessment Failed",
        description: errMsg,
        variant: "destructive"
      });
    } finally {
      setIsProcessing(false);
      setUploadPhase("idle");
    }
  };

  // Clone from Git and run assessment (same flow as upload + analyze + poll)
  const handleCloneAndAssess = async () => {
    const url = repoUrl.trim();
    if (!url) {
      toast({ title: "Repository URL required", description: "Enter a Git repository URL.", variant: "destructive" });
      return;
    }
    if (!url.startsWith("https://")) {
      toast({ title: "Invalid URL", description: "Use an HTTPS repository URL (e.g. https://github.com/owner/repo).", variant: "destructive" });
      return;
    }

    setIsProcessing(true);
    setProgress(0);
    setUploadPhase("uploading");
    setUploadProgress(0);
    setStatusMessage("Cloning repository...");
    setStage("assessing");

    try {
      const cloneRes = await apiRequest("POST", "/api/stack-modernization/upload-from-git", {
        repoUrl: url,
        branch: (branch || "main").trim(),
        gitToken: gitToken.trim() || undefined,
        modernizationType: "upgrade",
        llmProvider: selectedLLM,
      });
      if (!cloneRes.ok) {
        const errData = await cloneRes.json().catch(() => ({}));
        throw new Error(errData.error || errData.message || "Clone failed");
      }
      const uploadData = await cloneRes.json();

      setUploadPhase("analyzing");
      setUploadProgress(100);
      setProgress(10);
      setAnalysisId(uploadData.analysisId);

      // Poll until background extraction is complete before triggering analysis
      if (uploadData.status === "extracting") {
        setStatusMessage("Extracting repository files...");
        // eslint-disable-next-line no-constant-condition
        while (true) {
          await new Promise(resolve => setTimeout(resolve, 2000));
          const extractionRes = await apiRequest("GET", `/api/stack-modernization/analysis/${uploadData.analysisId}/progress`);
          if (!extractionRes.ok) throw new Error("Failed to check extraction progress");
          const extractionData = await extractionRes.json();
          setStatusMessage(extractionData.currentStage || "Extracting repository files...");
          if (extractionData.status === "failed") {
            throw new Error(extractionData.errors?.[0] || "File extraction failed");
          }
          if (extractionData.status === "uploaded" || extractionData.currentStage === "uploaded") {
            break;
          }
        }
      }

      setProgress(20);
      const assessmentSelectedClone = selectedPhases.has("assessment");
      setStatusMessage(assessmentSelectedClone ? "Running assessment..." : "Running selected phases...");
      const analyzeRes = await apiRequest("POST", "/api/stack-modernization/analyze", {
        sessionId: uploadData.sessionId,
        modernizationType: "upgrade",
        tempDir: uploadData.tempDir || "",
        llmProvider: selectedLLM,
        adoOrg,
        adoProjectId,
        adoProjectName,
        ...(selectedPhases.size < ALL_PHASES.size ? { selectedPhases: Array.from(selectedPhases) } : {}),
      });
      if (!analyzeRes.ok) throw new Error("Analysis failed");
      const analyzeData = await analyzeRes.json();
      setAnalysisId(analyzeData.analysisId);
      const pollStartTime = Date.now();

      // eslint-disable-next-line no-constant-condition
      while (true) {
        await new Promise((resolve) => setTimeout(resolve, 1500));
        const progressRes = await apiRequest("GET", `/api/stack-modernization/analysis/${analyzeData.analysisId}/progress`);
        if (!progressRes.ok) throw new Error("Failed to get progress");
        const pd = await progressRes.json();
        setProgressData(pd);
        const ds = pd.currentStage || "";
        const elapsedMin = (Date.now() - pollStartTime) / 60_000;
        setProgress(Math.min(20 + elapsedMin * 2, 95));
        setStatusMessage(ds || "Processing...");

        if (pd.status === "failed") {
          throw new Error(pd.errors?.[0] || "Processing failed");
        }

        // ── Paused / Cancelled ──
        if (pd.status === "paused") {
          setIsPaused(true);
          setIsProcessing(false);
          break;
        }
        if (pd.status === "cancelled") {
          setStage("upload");
          setIsProcessing(false);
          break;
        }

        if (pd.status === "completed") {
          setProgress(100);
          if ((pd.generatedTests?.length ?? 0) > 0) {
            setTestResultsMarkdown(pd.testResultsMarkdown || "");
            setStage("tests_generated");
            toast({ title: "Tests Generated", description: "Review generated test cases." });
          } else if ((pd.modifiedFiles?.length ?? 0) > 0) {
            setStage("execution_complete");
          } else if (pd.planMarkdown) {
            setPlanMarkdown(pd.planMarkdown);
            setStage("plan_complete");
          } else {
            setStage("complete");
          }
          break;
        }

        if (assessmentSelectedClone) {
          if ((pd.currentStage === "awaiting_user_selection" || pd.status === "awaiting_user_selection" || pd.currentStage?.includes("awaiting")) && pd.assessmentMarkdown && pd.versionRecommendationsText) {
            setAssessmentMarkdown(pd.assessmentMarkdown);
            setVersionRecommendationsText(pd.versionRecommendationsText);
            setProgress(100);
            setStage("assessment_complete");
            setIsProcessing(false);
            toast({ title: "Assessment Complete", description: "Review the assessment and edit version recommendations." });
            break;
          }
        }

        if (!assessmentSelectedClone) {
          const graphAdvanced =
            ds === "generating_tests" || ds === "tests_generated" ||
            ds === "task_planning" || ds === "tasks_ready" ||
            ds === "executing" || ds === "execution_complete" ||
            ds.includes("Upgrading") || ds.includes("Classifying") || ds.includes("Grouping");
          if (graphAdvanced) {
            if (ds === "tests_generated" || (pd.generatedTests?.length ?? 0) > 0) {
              setTestResultsMarkdown(pd.testResultsMarkdown || "");
              setStage("tests_generated");
              setProgress(100);
            } else if (ds === "generating_tests") {
              setStage("generating_tests");
            } else if (ds === "execution_complete") {
              setStage("execution_complete");
              setProgress(100);
            } else if (ds === "executing" || ds.includes("Upgrading") || ds.includes("Classifying") || ds.includes("Grouping")) {
              setStage("executing");
            } else if (ds === "tasks_ready") {
              setStage("tasks_ready");
              setProgress(100);
            } else if (ds === "task_planning") {
              setStage("task_planning");
            }
            break;
          }
        }
      }
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : "Unknown error";
      setFailureMessage(errMsg);
      setFailedAtStage("assessing");
      setStage("failed");
      toast({ title: "Assessment Failed", description: errMsg, variant: "destructive" });
    } finally {
      setIsProcessing(false);
      setUploadPhase("idle");
    }
  };

  // Step 2: User edits versions and proceeds to planning
  const handleAIEnhance = async () => {
    if (!versionRecommendationsText || !analysisId) return;

    setIsProcessing(true);
    
    try {
      const enhanceRes = await apiRequest("POST", `/api/stack-modernization/enhance-prompt`, {
        userPrompt: versionRecommendationsText,
        analysisId,
        detectedStack: {
          runtime: "General",
          analysis: assessmentMarkdown?.substring(0, 1000) || "Stack analysis data"
        }
      });

      if (!enhanceRes.ok) throw new Error("Failed to enhance prompt");

      const enhanceData = await enhanceRes.json();
      
      if (enhanceData.success && enhanceData.enhancedPlan) {
        setVersionRecommendationsText(enhanceData.enhancedPlan);
        toast({
          title: "✨ Enhanced!",
          description: "Your requirements have been enhanced with AI suggestions",
        });
      } else if (enhanceData.warnings && enhanceData.warnings.length > 0) {
        // If it returns warnings, still show the enhanced plan
        if (enhanceData.enhancedPlan) {
          setVersionRecommendationsText(enhanceData.enhancedPlan);
        }
        toast({
          title: "⚠️ Enhancement Note",
          description: enhanceData.warnings[0],
        });
      } else {
        throw new Error("Enhancement failed");
      }

    } catch (error) {
      console.error("[AI Enhance] Error:", error);
      toast({
        title: "Enhancement Failed",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive"
      });
    } finally {
      setIsProcessing(false);
    }
  };

  const handleProceedToPlanning = async () => {
    if (!analysisId || !versionRecommendationsText) {
      console.error("[Planning] Missing analysisId or versionRecommendationsText");
      toast({
        title: "Missing Data",
        description: "Analysis ID or version recommendations are missing",
        variant: "destructive"
      });
      return;
    }


    setIsProcessing(true);
    setProgress(0);
    setStatusMessage("Submitting version selections...");
    setStage("planning");

    try {
      // Parse version selections from user's text
      const selections = parseVersionSelections(versionRecommendationsText);
      
      
      if (selections.length === 0) {
        console.error("[Planning] No valid version selections found!");
        console.error("[Planning] Text was:", versionRecommendationsText);
        
        // Provide helpful error message
        toast({
          title: "Invalid Format",
          description: "Could not parse version selections. Use any of these formats:\n- ## Package / Current: X / Target: Y\n- package 1.0 -> 2.0\n- upgrade package from 1.0 to 2.0",
          variant: "destructive"
        });

        throw new Error("No valid version selections found. Please check the format.");
      }

      if (!hasAtLeastOneUpgrade(selections)) {
        toast({
          title: "No upgrade needed",
          description: "All packages are already at their target version. Change at least one target to a different version to proceed.",
          variant: "destructive"
        });
        setIsProcessing(false);
        return;
      }
      

      // Submit selections
      setProgress(10);
      const selectRes = await apiRequest("POST", `/api/stack-modernization/select-versions`, {
        analysisId,
        selections
      });

      if (!selectRes.ok) {
        const errorData = await selectRes.json();
        console.error("[Planning] Select-versions failed:", errorData);
        throw new Error(errorData.error || "Failed to submit selections");
      }

      // Trigger planning phase
      setProgress(20);
      setStatusMessage("Running planning phase...");
      
      const planRes = await apiRequest("POST", `/api/stack-modernization/analysis/${analysisId}/execute-planning`, {});
      
      if (!planRes.ok) {
        const errorData = await planRes.json();
        console.error("[Planning] Execute-planning failed:", errorData);
        throw new Error(errorData.error || "Planning failed");
      }

      // Poll until the graph reaches the right stopping point for the selected phases.
      // The LangGraph runs ALL nodes (skipping unselected ones), so we need to detect
      // whatever state the graph ends up in — planning_complete, tests_generated, completed, etc.
      const pollStartTime = Date.now();
      const wantPlanning = selectedPhases.has("planning");

      // eslint-disable-next-line no-constant-condition
      while (true) {
        await new Promise(resolve => setTimeout(resolve, 3000));

        const progressRes = await apiRequest("GET", `/api/stack-modernization/analysis/${analysisId}/progress`);
        if (!progressRes.ok) throw new Error("Failed to get progress");

        const pd = await progressRes.json();
        setProgressData(pd);
        const ds = pd.currentStage || "";
        const elapsedMin = (Date.now() - pollStartTime) / 60_000;
        setProgress(Math.min(20 + elapsedMin * 1.5, 95));
        setStatusMessage(ds || "Processing...");

        // ── Failed ──
        if (pd.status === "failed") {
          const errMsg = pd.errors?.[pd.errors.length - 1] || "Processing failed";
          setFailureMessage(errMsg);
          setFailedAtStage("planning");
          setStage("failed");
          setIsProcessing(false);
          toast({ title: "Processing Failed", description: errMsg, variant: "destructive" });
          return;
        }

        // ── Planning was selected and completed ──
        if (wantPlanning && ds === "planning_complete" && pd.planMarkdown) {
          setPlanMarkdown(pd.planMarkdown);
          setProgress(100);
          setStage("plan_complete");
          toast({ title: "Planning Complete", description: "Review the detailed upgrade plan" });
          break;
        }

        // ── Backend fully completed (all graph nodes finished) ──
        if (pd.status === "completed") {
          setProgress(100);
          if ((pd.generatedTests?.length ?? 0) > 0) {
            setTestResultsMarkdown(pd.testResultsMarkdown || "");
            setStage("tests_generated");
            toast({ title: "Tests Generated", description: "Review generated test cases." });
          } else if ((pd.modifiedFiles?.length ?? 0) > 0) {
            setStage("execution_complete");
            toast({ title: "Execution Complete", description: `Upgraded ${pd.modifiedFiles.length} files.` });
          } else {
            setStage("complete");
            toast({ title: "Complete", description: "All selected phases finished." });
          }
          break;
        }

        // ── Detect graph has advanced beyond planning (skipped phases) ──
        if (!wantPlanning) {
          const advanced =
            ds.includes("skipped") || ds === "generating_tests" || ds === "tests_generated" ||
            ds === "task_planning" || ds === "tasks_ready" || ds === "executing" ||
            ds === "execution_complete";

          if (advanced) {
            if ((pd.generatedTests?.length ?? 0) > 0 || ds === "tests_generated") {
              setTestResultsMarkdown(pd.testResultsMarkdown || "");
              setStage("tests_generated");
              toast({ title: "Tests Generated", description: "Review generated test cases." });
            } else if (ds === "generating_tests") {
              setStage("generating_tests");
            } else if ((pd.upgradeTasks?.length ?? 0) > 0 || ds === "tasks_ready") {
              setStage("tasks_ready");
            } else if (ds === "task_planning") {
              setStage("task_planning");
            } else if (ds === "executing" || ds === "execution_complete") {
              setStage(ds === "execution_complete" ? "execution_complete" : "executing");
            } else if (selectedPhases.has("tests")) {
              setStage("generating_tests");
            } else if (selectedPhases.has("execution")) {
              setStage("executing");
            } else if (selectedPhases.has("tasks")) {
              setStage("task_planning");
            } else {
              setStage("complete");
            }
            setIsProcessing(false);
            break;
          }
        }
      }

    } catch (error) {
      console.error("[Planning] Error:", error);
      const errMsg = error instanceof Error ? error.message : "Unknown error";
      setFailureMessage(errMsg);
      setFailedAtStage("planning");
      setStage("failed");
      toast({
        title: "Planning Failed",
        description: errMsg,
        variant: "destructive"
      });
    } finally {
      setIsProcessing(false);
    }
  };

  // Step 2.5: Download packages (vendor libraries)
  const handleDownloadPackages = async () => {
    if (!analysisId) return;
    setIsProcessing(true);
    setProgress(0);
    setStatusMessage("Downloading vendor libraries...");
    setStage("downloading_packages");
    try {
      const pkgRes = await apiRequest("POST", `/api/stack-modernization/analysis/${analysisId}/download-packages`, {});
      if (!pkgRes.ok) throw new Error("Package download failed");
      const pkgData = await pkgRes.json();
      if (pkgData.skipped) {
        setIsProcessing(false);
        setStage("packages_complete");
        const next = getNextPhaseButton("packages");
        if (next) next.handler();
        return;
      }
      // eslint-disable-next-line no-constant-condition
      while (true) {
        await new Promise(resolve => setTimeout(resolve, 2000));
        const progressRes = await apiRequest("GET", `/api/stack-modernization/analysis/${analysisId}/progress`);
        if (!progressRes.ok) throw new Error("Failed to get progress");
        const pd = await progressRes.json();
        setProgressData(pd);
        setStatusMessage(pd.currentStage || "Downloading packages...");
        if (pd.status === "packages_complete") {
          setStage("packages_complete");
          setIsProcessing(false);
          return;
        }
        if (pd.status === "failed") {
          throw new Error(pd.errors?.[0] || "Package download failed");
        }
      }
    } catch (error: any) {
      console.error("Package download error:", error);
      setIsProcessing(false);
      setStage("plan_complete"); // go back to plan
    }
  };

  // Step 3: Generate tasks
  const handleGenerateTasks = async () => {
    if (!analysisId) return;

    setIsProcessing(true);
    setProgress(0);
    setStatusMessage("Generating task list...");
    setStage("task_planning");

    try {
      const taskRes = await apiRequest("POST", `/api/stack-modernization/analysis/${analysisId}/generate-tasks`, {});
      if (!taskRes.ok) throw new Error("Task generation failed");
      const taskData = await taskRes.json();
      if (taskData.skipped) {
        setIsProcessing(false);
        const nextAction = getNextPhaseButton("tasks");
        if (nextAction) { setStage("tasks_ready"); nextAction.handler(); } else { setStage("complete"); }
        return;
      }

      const pollStartTime = Date.now();

      // eslint-disable-next-line no-constant-condition
      while (true) {
        await new Promise(resolve => setTimeout(resolve, 3000));

        const progressRes = await apiRequest("GET", `/api/stack-modernization/analysis/${analysisId}/progress`);
        if (!progressRes.ok) throw new Error("Failed to get progress");

        const pd = await progressRes.json();
        setProgressData(pd);
        const elapsedMin = (Date.now() - pollStartTime) / 60_000;
        setProgress(Math.min(elapsedMin * 1.5, 95));
        setStatusMessage(pd.currentStage || "Generating tasks...");

        if (pd.currentStage === "tasks_ready" && pd.tasksMarkdown) {
          setTasksMarkdown(pd.tasksMarkdown);
          setProgress(100);
          setStage("tasks_ready");
          toast({ title: "Tasks Generated", description: `${pd.upgradeTasks?.length || 0} tasks ready.` });
          break;
        }

        if (pd.status === "completed" || pd.currentStage === "execution_complete" || pd.currentStage === "tests_generated") {
          setProgress(100);
          if ((pd.generatedTests?.length ?? 0) > 0 || pd.currentStage === "tests_generated") {
            setTestResultsMarkdown(pd.testResultsMarkdown || "");
            setStage("tests_generated");
            toast({ title: "Tests Generated", description: "Review generated test cases." });
          } else if ((pd.modifiedFiles?.length ?? 0) > 0 || pd.currentStage === "execution_complete") {
            setStage("execution_complete");
            toast({ title: "Execution Complete", description: `Upgraded ${pd.modifiedFiles?.length || 0} files.` });
          } else if (pd.tasksMarkdown) {
            setTasksMarkdown(pd.tasksMarkdown);
            setStage("tasks_ready");
            toast({ title: "Tasks Generated", description: `${pd.upgradeTasks?.length || 0} tasks ready.` });
          } else {
            setStage("complete");
          }
          break;
        }

        if (pd.status === "failed") {
          const errMsg = pd.errors?.[pd.errors.length - 1] || "Task generation failed";
          setFailureMessage(errMsg);
          setFailedAtStage("task_planning");
          setStage("failed");
          setIsProcessing(false);
          toast({ title: "Task Generation Failed", description: errMsg, variant: "destructive" });
          return;
        }
      }

    } catch (error) {
      console.error("[Tasks] Error:", error);
      const errMsg = error instanceof Error ? error.message : "Unknown error";
      setFailureMessage(errMsg);
      setFailedAtStage("task_planning");
      setStage("failed");
      toast({
        title: "Task Generation Failed",
        description: errMsg,
        variant: "destructive"
      });
    } finally {
      setIsProcessing(false);
    }
  };

  // Step 4: Execute tasks
  const handleExecuteTasks = async () => {
    if (!analysisId) return;

    setIsProcessing(true);
    setProgress(0);
    setStatusMessage("Executing tasks...");
    setStage("executing");

    try {
      const execRes = await apiRequest("POST", `/api/stack-modernization/analysis/${analysisId}/execute-tasks`, {});
      if (!execRes.ok) throw new Error("Execution failed");
      const execData = await execRes.json();
      if (execData.skipped) {
        setIsProcessing(false);
        const nextAction = getNextPhaseButton("execution");
        if (nextAction) { setStage("execution_complete"); nextAction.handler(); } else { setStage("complete"); }
        return;
      }

      const pollStartTime = Date.now();

      // eslint-disable-next-line no-constant-condition
      while (true) {
        await new Promise(resolve => setTimeout(resolve, 3000));

        const progressRes = await apiRequest("GET", `/api/stack-modernization/analysis/${analysisId}/progress`);
        if (!progressRes.ok) throw new Error("Failed to get progress");

        const pd = await progressRes.json();
        setProgressData(pd);
        const elapsedMin = (Date.now() - pollStartTime) / 60_000;
        setProgress(Math.min(elapsedMin * 1.5, 95));
        setStatusMessage(pd.currentStage || "Executing...");

        if (pd.currentStage === "execution_complete") {
          setProgress(100);
          setStage("execution_complete");
          toast({ title: "Execution Complete", description: `Upgraded ${pd.modifiedFiles?.length || 0} files.` });
          break;
        }

        if (pd.status === "completed" || pd.currentStage === "tests_generated") {
          setProgress(100);
          if ((pd.generatedTests?.length ?? 0) > 0 || pd.currentStage === "tests_generated") {
            setTestResultsMarkdown(pd.testResultsMarkdown || "");
            setStage("tests_generated");
            toast({ title: "Tests Generated", description: "Review generated test cases." });
          } else {
            setStage("execution_complete");
            toast({ title: "Execution Complete", description: `Upgraded ${pd.modifiedFiles?.length || 0} files.` });
          }
          break;
        }

        if (pd.status === "failed") {
          const errMsg = pd.errors?.[pd.errors.length - 1] || "Code upgrade failed";
          setFailureMessage(errMsg);
          setFailedAtStage("executing");
          setStage("failed");
          setIsProcessing(false);
          toast({ title: "Code Upgrade Failed", description: errMsg, variant: "destructive" });
          return;
        }
      }

    } catch (error) {
      console.error("[Execution] Error:", error);
      const errMsg = error instanceof Error ? error.message : "Unknown error";
      setFailureMessage(errMsg);
      setFailedAtStage("executing");
      setStage("failed");
      toast({
        title: "Execution Failed",
        description: errMsg,
        variant: "destructive"
      });
    } finally {
      setIsProcessing(false);
    }
  };

  // Step 5: Generate tests
  const handleGenerateTests = async () => {
    if (!analysisId) return;

    setIsProcessing(true);
    setProgress(0);
    setStatusMessage("Generating unit tests...");
    setStage("generating_tests");

    try {
      const testRes = await apiRequest("POST", `/api/stack-modernization/analysis/${analysisId}/generate-tests`, {});
      if (!testRes.ok) throw new Error("Test generation failed");
      const testData = await testRes.json();
      if (testData.skipped) {
        setStage("tests_generated");
        setIsProcessing(false);
        const nextAction = getNextPhaseButton("tests");
        if (nextAction) { nextAction.handler(); } else { setStage("complete"); }
        return;
      }

      const pollStartTime = Date.now();

      // eslint-disable-next-line no-constant-condition
      while (true) {
        await new Promise(resolve => setTimeout(resolve, 3000));

        const progressRes = await apiRequest("GET", `/api/stack-modernization/analysis/${analysisId}/progress`);
        if (!progressRes.ok) throw new Error("Failed to get progress");

        const progressData = await progressRes.json();
        
        setProgressData(progressData);
        const elapsedMin = (Date.now() - pollStartTime) / 60_000;
        setProgress(Math.min(elapsedMin * 1.5, 95));
        setStatusMessage(progressData.currentStage || "Generating tests...");

        const isTestsDone =
          progressData.currentStage === "tests_generated" ||
          (progressData.status === "completed" && (progressData.generatedTests?.length ?? 0) > 0);

        if (isTestsDone) {
          if (progressData.testResultsMarkdown) {
            setTestResultsMarkdown(progressData.testResultsMarkdown);
          }
          setProgressData(progressData);
          setProgress(100);
          setStage("tests_generated");
          setStatusMessage("Tests generated.");
          toast({ title: "Tests Generated", description: "Review generated test cases." });
          break;
        }
        
        if (progressData.status === "failed") {
          const errMsg = progressData.errors?.[progressData.errors.length - 1] || "Test generation failed";
          setFailureMessage(errMsg);
          setFailedAtStage("generating_tests");
          setStage("failed");
          setIsProcessing(false);
          toast({
            title: "Test Generation Failed",
            description: errMsg,
            variant: "destructive"
          });
          return;
        }
      }

    } catch (error) {
      console.error("[Tests] Error:", error);
      const errMsg = error instanceof Error ? error.message : "Unknown error";
      setFailureMessage(errMsg);
      setFailedAtStage("generating_tests");
      setStage("failed");
      toast({
        title: "Test Generation Failed",
        description: errMsg,
        variant: "destructive"
      });
    } finally {
      setIsProcessing(false);
    }
  };

  // Reset a phase and go back (clears downstream data)
  // ─── Pause / Cancel / Resume ───
  const handlePause = async () => {
    if (!analysisId) return;
    try {
      const res = await apiRequest("POST", `/api/stack-modernization/analysis/${analysisId}/pause`);
      if (!res.ok) throw new Error("Failed to pause");
      setIsPaused(true);
      setIsProcessing(false);
      toast({ title: "Paused", description: "Processing has been paused. Click Resume to continue." });
    } catch (e) {
      toast({ title: "Pause Failed", description: e instanceof Error ? e.message : "Unknown error", variant: "destructive" });
    }
  };

  const handleCancel = async () => {
    if (!analysisId) return;
    try {
      const res = await apiRequest("POST", `/api/stack-modernization/analysis/${analysisId}/cancel`);
      if (!res.ok) throw new Error("Failed to cancel");
      setIsPaused(false);
      setIsProcessing(false);
      setStage("upload");
      setAnalysisId(null);
      setProgress(0);
      setStatusMessage("");
      setProgressData(null);
      toast({ title: "Cancelled", description: "Processing has been cancelled." });
    } catch (e) {
      toast({ title: "Cancel Failed", description: e instanceof Error ? e.message : "Unknown error", variant: "destructive" });
    }
  };

  /**
   * Determine the correct frontend stage from progress data artifacts.
   * Uses the same artifact-based detection as the load endpoint.
   * Returns a *loading* stage (the phase that should now be running)
   * based on what has ALREADY completed.
   */
  const determineStageFromProgress = (pd: any): WorkflowStage => {
    const hasTests = (pd.generatedTests?.length ?? 0) > 0;
    const hasModified = (pd.modifiedFiles?.length ?? 0) > 0 || (pd.codeUpgrade?.modifiedFiles?.length ?? 0) > 0;
    const hasTasks = (pd.upgradeTasks?.length ?? 0) > 0;
    const hasPlan = !!pd.planMarkdown;
    const hasAssessment = !!pd.assessmentMarkdown || (pd.versionIntelligence?.length ?? 0) > 0;

    // Work backwards from the most-advanced phase.
    // The RUNNING phase is one step AFTER the last completed phase.
    if (hasTests) return "generating_tests"; // test gen was done, may be validating
    if (hasModified) return "executing"; // execution was done, may be in post-exec phases
    if (hasTasks) return "executing"; // tasks ready, execution should be running
    if (hasPlan) return "task_planning"; // plan ready, task planning should run
    if (hasAssessment) return "planning"; // assessment done, planning should run
    return "assessing"; // nothing done yet
  };

  const handleResume = async () => {
    if (!analysisId) return;
    try {
      const res = await apiRequest("POST", `/api/stack-modernization/analysis/${analysisId}/resume`);
      if (!res.ok) throw new Error("Failed to resume");
      setIsPaused(false);

      // Fetch current progress to determine the correct stage after resume
      try {
        const progressRes = await apiRequest("GET", `/api/stack-modernization/analysis/${analysisId}/progress`);
        if (progressRes.ok) {
          const pd = await progressRes.json();
          setProgressData(pd);

          // Restore any artifacts to local state
          if (pd.assessmentMarkdown) setAssessmentMarkdown(pd.assessmentMarkdown);
          if (pd.versionRecommendationsText) setVersionRecommendationsText(pd.versionRecommendationsText);
          if (pd.planMarkdown) setPlanMarkdown(pd.planMarkdown);
          if (pd.tasksMarkdown) setTasksMarkdown(pd.tasksMarkdown);
          if (pd.testResultsMarkdown) setTestResultsMarkdown(pd.testResultsMarkdown);

          // Determine the correct loading stage based on completed artifacts
          const resumeStage = determineStageFromProgress(pd);
          setStage(resumeStage);
          setStatusMessage(pd.currentStage || "Resuming...");
          setIsProcessing(false); // Let the background poller + auto-advance handle progression
        }
      } catch {
        // If progress fetch fails, just let the poller handle it
        setIsProcessing(false);
      }

      toast({ title: "Resumed", description: "Processing has been resumed." });
    } catch (e) {
      toast({ title: "Resume Failed", description: e instanceof Error ? e.message : "Unknown error", variant: "destructive" });
    }
  };

  const handleResetPhase = async (phase: string, goToStage: WorkflowStage) => {
    if (!analysisId) return;
    try {
      const res = await apiRequest("POST", `/api/stack-modernization/analysis/${analysisId}/reset-phase/${phase}`);
      if (!res.ok) throw new Error("Reset failed");
      const data = await res.json();
      // Refresh progress data so the frontend reflects cleared state
      const progressRes = await apiRequest("GET", `/api/stack-modernization/analysis/${analysisId}/progress`);
      if (progressRes.ok) {
        const pd = await progressRes.json();
        setProgressData(pd);
      }
      // Clear any view-history override and local state for cleared phases
      setViewStage(null);
      setIsProcessing(false);
      // Reset local markdown states for cleared downstream phases
      const clearOrder = ["assessment", "planning", "tasks", "execution", "tests"];
      const idx = clearOrder.indexOf(phase);
      if (idx >= 0) {
        const cleared = clearOrder.slice(idx);
        if (cleared.includes("planning")) setPlanMarkdown("");
        if (cleared.includes("tasks")) setTasksMarkdown("");
        if (cleared.includes("tests")) setTestResultsMarkdown("");
        if (cleared.includes("assessment")) setAssessmentMarkdown("");
      }
      setStage(goToStage);
      toast({ title: "Phase Reset", description: `Reset ${phase} phase. You can now re-run it.` });
    } catch (err) {
      toast({ title: "Reset Failed", description: String(err), variant: "destructive" });
    }
  };

  // Download helper — uses apiRequest for all downloads (ZIP and markdown)
  // "project" is an alias for "upgrade" (full project ZIP with code + tests + reports)
  const handleDownload = async (type: string) => {
    if (!analysisId) return;

    const resolvedType = type === "project" ? "upgrade" : type;
    try {
      const endpoint = `/api/stack-modernization/analysis/${analysisId}/download-${resolvedType}`;
      const response = await apiRequest("GET", endpoint);

      if (!response.ok) {
        const errData = await response.json().catch(() => ({ error: "Download failed" }));
        throw new Error(errData.error || `Download failed (${response.status})`);
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;

      const isZip = resolvedType === "upgrade" || resolvedType === "tests";
      a.download = isZip
        ? `${resolvedType === "upgrade" ? "project" : "generated-tests"}-${analysisId}.zip`
        : `${resolvedType}-${analysisId}.md`;

      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

      toast({
        title: "Download Complete",
        description: `${isZip ? "ZIP" : `${resolvedType}.md`} downloaded successfully`,
      });
    } catch (error) {
      console.error(`[Download ${type}] Error:`, error);
      toast({
        title: "Download Failed",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive",
      });
    }
  };

  const handleChartsPdfDownload = async (phase: string, chartId?: string) => {
    if (!analysisId) return;
    try {
      const response = await apiRequest("POST", `/api/stack-modernization/analysis/${analysisId}/download-charts-pdf`, {
        phase,
        chartId,
      });
      if (!response.ok) {
        const errData = await response.json().catch(() => ({ error: "PDF generation failed" }));
        throw new Error(errData.error || `PDF download failed (${response.status})`);
      }
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = chartId
        ? `stack-modernization-${phase}-${chartId}.pdf`
        : phase === "all"
          ? `stack-modernization-full-report.pdf`
          : `stack-modernization-${phase}-report.pdf`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      toast({ title: "PDF Downloaded", description: `${phase === "all" ? "Full report" : `${phase} report`} downloaded successfully.` });
    } catch (error) {
      console.error("[ChartsPdfDownload] Error:", error);
      toast({ title: "PDF Download Failed", description: error instanceof Error ? error.message : "Unknown error", variant: "destructive" });
    }
  };

  const refreshProgress = useCallback(async () => {
    if (!analysisId) return;
    try {
      const res = await apiRequest("GET", `/api/stack-modernization/analysis/${analysisId}/progress`);
      if (res.ok) {
        const data = await res.json();
        setProgressData(data);
      }
    } catch {
      // ignore
    }
  }, [analysisId]);

  // Mark workflow complete and persist progress (so list shows 100%). Called when user clicks "Done" on tests phase.
  const handleMarkComplete = async () => {
    if (!analysisId) return;
    try {
      const res = await apiRequest("POST", `/api/stack-modernization/analysis/${analysisId}/complete`);
      if (!res.ok) throw new Error("Failed to save progress");
      const data = await res.json();
      setProgress(data.progress ?? 100);
      if (data.status === "completed") setStage("complete");
      setProgressData((prev: any) => (prev ? { ...prev, progress: data.progress, status: data.status } : prev));
      await refreshProgress();
      toast({ title: "Saved", description: "Progress saved. This run will show as 100% complete in your list." });
    } catch (e) {
      toast({
        title: "Could not save progress",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    }
  };

  // Start Run & Validate (code execution). Called when user clicks "Execute test cases" or "Run validation again".
  const handleRunValidation = async () => {
    if (!analysisId) return;
    try {
      // Immediately clear stale validationRun so the useEffect doesn't see
      // a leftover "passed"/"failed" status and prematurely complete.
      setProgressData((prev: any) => ({
        ...prev,
        validationRun: { status: "running", lastLogs: "", runId: "" },
        validationPassed: undefined,
        validationAttempts: undefined,
      }));

      const res = await apiRequest("POST", `/api/stack-modernization/analysis/${analysisId}/run-validation`);
      if (!res.ok) throw new Error("Failed to start validation");
      setStage("validating");
      setShowValidationPanel(true);
      setStatusMessage("Running code execution (install & test)...");
      toast({ title: "Validation started", description: "Code execution is running." });
    } catch (e) {
      toast({
        title: "Could not start validation",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    }
  };

  // View helper - opens markdown in modal (static content)
  const handleView = (title: string, content: string, downloadType: string) => {
    setViewerStreamConfig(null);
    setViewerTitle(title);
    setViewerContent(content);
    setViewerDownloadType(downloadType);
    setViewerOpen(true);
  };

  // View with streaming (SSE) for assessment, plan, risk, compatibility
  const handleViewStream = (title: string, downloadType: string, reportType: "assessment" | "risk" | "compatibility" | "plan") => {
    if (!analysisId) return;
    setViewerStreamConfig({ analysisId, reportType });
    setViewerTitle(title);
    setViewerContent("");
    setViewerDownloadType(downloadType);
    setViewerOpen(true);
  };


  // Normalize version for same/different comparison (trim + lowercase)
  const normalizeVersion = (v: string | undefined | null): string =>
    (v ?? "").toString().trim().toLowerCase();

  // True if there is at least one selection where target differs from current (i.e. upgrade needed)
  // "detected" currentVersion always counts as needing upgrade (target-only input)
  const hasAtLeastOneUpgrade = (selections: any[]): boolean =>
    selections.some(
      (s) => {
        const curr = normalizeVersion(s.currentVersion);
        const target = normalizeVersion(s.selectedVersion);
        // If current version is "detected" or missing, it's always an upgrade
        if (!curr || curr === "detected" || curr === "unknown") return true;
        return curr !== target;
      }
    );

  // Parse version selections from textarea - ROBUST PARSER
  // Supports many formats:
  //   ## Package / Current: X / Target: Y  (AI enhanced markdown)
  //   Package: version                     (target-only, current looked up from assessment)
  //   Package current -> target            (arrow inline)
  //   upgrade Package from X to Y          (natural language)
  //   Package X to Y                       (simple inline)
  const parseVersionSelections = (text: string): any[] => {

    // Section headers that should NOT be treated as package names
    const sectionHeaders = new Set([
      'upgrade specification', 'related ecosystem packages', 'methodology',
      'methodology/approach', 'approach', 'testing strategy', 'summary',
      'overview', 'notes', 'recommendations', 'migration strategy',
      'upgrade plan', 'upgrade summary', 'phased migration',
    ]);

    // Instruction lines to ignore (user directives, not package info)
    const instructionPatterns = [
      /^upgrade\s+(?:the|all|my|this|these)\s/i,
      /^(?:please|pls)\s/i,
      /^(?:update|migrate|convert|move)\s+(?:the|all|my|this|these)\s/i,
      /^(?:as\s+(?:above|below|mentioned))/i,
      /(?:as\s+(?:above|below)\s+mentioned)/i,
      /(?:target\s+versions?\s*$)/i,
      /(?:mentioned\s+(?:above|below|target))/i,
    ];

    // Build a lookup map from assessment versionIntelligence for current versions
    const viLookup = new Map<string, string>();
    const viData = progressData?.versionIntelligence || [];
    for (const v of viData) {
      const name = (v.packageName || v.name || "").toLowerCase().trim();
      if (name && v.currentVersion) {
        viLookup.set(name, v.currentVersion);
      }
    }

    const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    const selections: any[] = [];
    let currentPkg: any = {};

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const cleanLine = line.replace(/\*\*/g, '').replace(/\*/g, '');

      // Skip instruction/directive lines
      if (instructionPatterns.some(p => p.test(cleanLine))) {
        continue;
      }

      // ── Format 1: Markdown header (## Package) ──
      const headerMatch = line.match(/^(#{1,4})\s+(.+)/);
      if (headerMatch && !cleanLine.toLowerCase().includes('current') && !cleanLine.toLowerCase().includes('target')) {
        const headerName = headerMatch[2].replace(/[#*]/g, '').trim();
        if (sectionHeaders.has(headerName.toLowerCase())) continue;
        if (currentPkg.package) selections.push(currentPkg);
        currentPkg = { package: headerName };
        continue;
      }

      // ── Format 2: "Current: version" line ──
      if (cleanLine.toLowerCase().includes('current:') || cleanLine.toLowerCase().includes('current version:')) {
        const versionMatch = cleanLine.match(/current(?:\s*version)?:\s*(.+?)(?:\s*\(|$)/i);
        if (versionMatch) {
          currentPkg.currentVersion = versionMatch[1].trim();
        }
        continue;
      }

      // ── Format 3: "Target: version" line ──
      if (cleanLine.toLowerCase().includes('target:') || cleanLine.toLowerCase().includes('target version:') || cleanLine.toLowerCase().includes('upgrade to:')) {
        const versionMatch = cleanLine.match(/(?:target|upgrade to)(?:\s*version)?:\s*(.+?)(?:\s*\(|$)/i);
        if (versionMatch) {
          currentPkg.selectedVersion = versionMatch[1]
            .replace(/\(LTS\)/gi, '').replace(/LTS/gi, '').replace(/\(.*?\)/g, '').trim();
        }
        continue;
      }

      // ── Format 4: Arrow format "Package current -> target" ──
      if (line.includes('->') || line.includes('→') || line.includes('=>')) {
        const parts = line.split(/->|→|=>/).map(p => p.trim());
        if (parts.length === 2) {
          const firstPart = parts[0];
          const packageMatch = firstPart.match(/^[-•*]?\s*([^:0-9]+)/);
          const currentVersionMatch = firstPart.match(/[\d][.\d]*/);
          const targetVersion = parts[1].replace(/\(.*?\)/g, '').trim();

          if (packageMatch && currentVersionMatch) {
            if (currentPkg.package) selections.push(currentPkg);
            currentPkg = {
              package: packageMatch[1].trim().replace(/[:-]/g, '').trim(),
              currentVersion: currentVersionMatch[0],
              selectedVersion: targetVersion,
            };
          }
        }
        continue;
      }

      // ── Format 5: Natural language "upgrade Package from X to Y" ──
      const upgradeMatch = cleanLine.match(/^(?:upgrade|update|migrate|move)\s+(.+?)\s+(?:from\s+)?v?([\d][.\d]*\S*)\s+to\s+v?([\d][.\d]*\S*)/i);
      if (upgradeMatch) {
        if (currentPkg.package) selections.push(currentPkg);
        currentPkg = {
          package: upgradeMatch[1].trim(),
          currentVersion: upgradeMatch[2].trim(),
          selectedVersion: upgradeMatch[3].trim(),
        };
        continue;
      }

      // ── Format 6: "Package X to Y" (simple inline with "to") ──
      const simpleToMatch = cleanLine.match(/^[-•*]?\s*(.+?)\s+v?([\d][.\d]*\S*)\s+to\s+v?([\d][.\d]*\S*)/i);
      if (simpleToMatch) {
        if (currentPkg.package) selections.push(currentPkg);
        currentPkg = {
          package: simpleToMatch[1].replace(/^[-•*]\s*/, '').trim(),
          currentVersion: simpleToMatch[2].trim(),
          selectedVersion: simpleToMatch[3].trim(),
        };
        continue;
      }

      // ── Format 7: TARGET-ONLY — "Package: version" or "Package - version" ──
      // e.g. ".NET: 10.0", "jQuery: 4.0.0", "Kendo UI: 2025.4.1321"
      const targetOnlyMatch = cleanLine.match(/^[-•*]?\s*([^:]+?)[:]\s*v?([\d][.\d]*\S*)\s*$/i);
      if (targetOnlyMatch) {
        const pkgName = targetOnlyMatch[1].replace(/^[-•*]\s*/, '').trim();
        const targetVer = targetOnlyMatch[2].trim();
        // Skip if name looks like a section header
        if (sectionHeaders.has(pkgName.toLowerCase())) continue;
        // Skip if it looks like "Current:" or "Target:" already handled
        if (/^(current|target|upgrade\s+to)$/i.test(pkgName)) continue;

        if (currentPkg.package) selections.push(currentPkg);

        // Try to find current version from assessment data
        const lookupKey = pkgName.toLowerCase();
        let currentVersion = viLookup.get(lookupKey) || "";
        // Also try partial match (e.g. "jQuery" might be stored as "jquery")
        if (!currentVersion) {
          for (const [key, val] of viLookup) {
            if (key.includes(lookupKey) || lookupKey.includes(key)) {
              currentVersion = val;
              break;
            }
          }
        }
        currentPkg = {
          package: pkgName,
          currentVersion: currentVersion || "detected",
          selectedVersion: targetVer,
        };
        continue;
      }

      // ── Format 8: Just "Package version" without colon ──
      // e.g. "jQuery 4.0.0", "Bootstrap 5.3.2"
      const bareMatch = cleanLine.match(/^[-•*]?\s*([a-zA-Z][a-zA-Z0-9 ._-]*?)\s+v?([\d][.\d]+\S*)\s*$/i);
      if (bareMatch) {
        const pkgName = bareMatch[1].replace(/^[-•*]\s*/, '').trim();
        const targetVer = bareMatch[2].trim();
        if (sectionHeaders.has(pkgName.toLowerCase())) continue;

        if (currentPkg.package) selections.push(currentPkg);

        const lookupKey = pkgName.toLowerCase();
        let currentVersion = viLookup.get(lookupKey) || "";
        if (!currentVersion) {
          for (const [key, val] of viLookup) {
            if (key.includes(lookupKey) || lookupKey.includes(key)) {
              currentVersion = val;
              break;
            }
          }
        }
        currentPkg = {
          package: pkgName,
          currentVersion: currentVersion || "detected",
          selectedVersion: targetVer,
        };
        continue;
      }
    }

    // Push last package
    if (currentPkg.package) {
      selections.push(currentPkg);
    }

    // Filter valid selections — require package and selectedVersion; currentVersion can be "detected"
    const validSelections = selections.filter(s => {
      const isValid = s.package && s.selectedVersion;
      if (!isValid) {
        console.warn("[Parser] Invalid selection (missing fields):", s);
      }
      return isValid;
    });

    // Ensure currentVersion is always present (fall back to "detected" so server accepts it)
    for (const s of validSelections) {
      if (!s.currentVersion) s.currentVersion = "detected";
    }

    return validSelections;
  };

  const getPhaseHandler = (phase: SelectablePhase): (() => void) | null => {
    switch (phase) {
      case "planning": return handleProceedToPlanning;
      case "packages": return handleDownloadPackages;
      case "tasks": return handleGenerateTasks;
      case "execution": return handleExecuteTasks;
      case "tests": return handleGenerateTests;
      case "validation": return handleRunValidation;
      default: return null;
    }
  };

  const getNextPhaseButton = (afterPhase: SelectablePhase): { label: string; handler: () => void } | null => {
    const next = getNextSelectedPhase(afterPhase);
    if (!next) return null;
    const handler = getPhaseHandler(next);
    if (!handler) return null;
    return { label: phaseButtonLabels[next], handler };
  };

  // Render stage content
  const renderContent = () => {
    const displayStage = viewStage ?? stage;
    switch (displayStage) {
      case "upload":
        return (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Upload className="h-4 w-4" />
                Upload Code Repository
              </CardTitle>
              <CardDescription className="text-xs">
                Choose a source to begin assessment
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Two-column: File Upload + Git URL */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {/* File Upload Card */}
                <div
                  className={cn(
                    "rounded-xl border p-4 cursor-pointer transition-all",
                    inputMethod === "file"
                      ? "border-violet-500 bg-violet-500/5 ring-1 ring-violet-500/30"
                      : "border-border/40 hover:border-border"
                  )}
                  onClick={() => setInputMethod("file")}
                >
                  <div className="flex items-center gap-2 mb-2">
                    <FileArchive className="h-4 w-4 text-violet-500" />
                    <span className="text-sm font-medium">Upload Files</span>
                  </div>
                  <p className="text-xs text-muted-foreground mb-3">
                    Upload .zip archives or code files (.java, .js, .ts, .cs, .py)
                  </p>
                  {inputMethod === "file" && (
                    <div className="space-y-2">
                      <div className="border border-dashed border-border rounded-lg p-3 text-center">
                        <input
                          type="file"
                          multiple
                          onChange={handleFileSelect}
                          className="hidden"
                          id="file-upload"
                          accept=".zip,.java,.js,.ts,.tsx,.jsx,.cs,.py"
                        />
                        <label htmlFor="file-upload" className="cursor-pointer">
                          <Button variant="outline" size="sm" asChild>
                            <span><Upload className="h-3 w-3 mr-1.5" />Select Files</span>
                          </Button>
                        </label>
                      </div>
                      {files.length > 0 && (
                        <div className="max-h-28 overflow-y-auto rounded-lg border border-border/40 bg-muted/20">
                          {files.map((file, idx) => (
                            <div key={idx} className="flex items-center justify-between px-2.5 py-1.5 text-xs border-b border-border/20 last:border-0">
                              <div className="flex items-center gap-1.5 min-w-0">
                                <FileArchive className="h-3 w-3 text-muted-foreground shrink-0" />
                                <span className="truncate text-foreground">{file.name}</span>
                              </div>
                              <div className="flex items-center gap-2 shrink-0 ml-2">
                                <span className="text-muted-foreground">{(file.size / 1024).toFixed(1)} KB</span>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setFiles(prev => prev.filter((_, i) => i !== idx));
                                  }}
                                  className="text-muted-foreground hover:text-destructive transition-colors"
                                >
                                  <X className="h-3 w-3" />
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Git URL Card */}
                <div
                  className={cn(
                    "rounded-xl border p-4 cursor-pointer transition-all",
                    inputMethod === "git"
                      ? "border-violet-500 bg-violet-500/5 ring-1 ring-violet-500/30"
                      : "border-border/40 hover:border-border"
                  )}
                  onClick={() => setInputMethod("git")}
                >
                  <div className="flex items-center gap-2 mb-2">
                    <GitBranch className="h-4 w-4 text-violet-500" />
                    <span className="text-sm font-medium">Git Repository</span>
                  </div>
                  <p className="text-xs text-muted-foreground mb-3">
                    Clone from a public or private repository via HTTPS
                  </p>
                  {inputMethod === "git" && (
                    <div className="space-y-2" onClick={(e) => e.stopPropagation()}>
                      <Input
                        id="workflow-repo-url"
                        type="url"
                        placeholder="https://github.com/owner/repo"
                        value={repoUrl}
                        onChange={(e) => setRepoUrl(e.target.value)}
                        className="font-mono text-xs h-8"
                      />
                      <div className="grid grid-cols-2 gap-2">
                        <Input
                          id="workflow-branch"
                          placeholder="Branch (default: main)"
                          value={branch}
                          onChange={(e) => setBranch(e.target.value)}
                          className="text-xs h-8"
                        />
                        <Input
                          id="workflow-token"
                          type="password"
                          placeholder="Access Token (private)"
                          value={gitToken}
                          onChange={(e) => setGitToken(e.target.value)}
                          className="text-xs h-8"
                        />
                      </div>
                      {repoUrl.trim() && (
                        <div className="rounded-lg border border-border/40 bg-muted/20 px-2.5 py-1.5">
                          <div className="flex items-center gap-1.5 text-xs">
                            <GitBranch className="h-3 w-3 text-muted-foreground shrink-0" />
                            <span className="truncate text-foreground font-mono">{repoUrl.trim()}</span>
                            {branch && <span className="text-muted-foreground shrink-0">({branch})</span>}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* LLM selector + Start button row */}
              <div className="flex items-end gap-3">
                <div className="flex-1 space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">AI Model</label>
                  <Select value={selectedLLM} onValueChange={setSelectedLLM}>
                    <SelectTrigger className="h-9">
                      <SelectValue placeholder="Choose an AI model" />
                    </SelectTrigger>
                    <SelectContent>
                      {llmProviders.filter(p => p.available).length > 0 ? (
                        llmProviders.filter(p => p.available).map((provider) => (
                          <SelectItem key={provider.value} value={provider.value}>
                            <div className="flex items-center gap-2">
                              <span className="font-medium">{provider.label}</span>
                              <span className="text-xs text-muted-foreground">— {provider.description}</span>
                            </div>
                          </SelectItem>
                        ))
                      ) : jiraOnlyHosting ? (
                        <SelectItem value="bedrock">
                          <span className="font-medium">Bedrock (Claude)</span>
                          <span className="text-xs text-muted-foreground ml-2">— Amazon Bedrock hosted Claude model</span>
                        </SelectItem>
                      ) : (
                        <>
                          <SelectItem value="gpt-5.4">
                            <span className="font-medium">GPT-5.4</span>
                            <span className="text-xs text-muted-foreground ml-2">— Latest &amp; most capable GPT model</span>
                          </SelectItem>
                          <SelectItem value="claude-opus-4-1">
                            <span className="font-medium">Claude Opus 4.1</span>
                            <span className="text-xs text-muted-foreground ml-2">— Most capable Anthropic model</span>
                          </SelectItem>
                        </>
                      )}
                    </SelectContent>
                  </Select>
                </div>
                <Button
                  onClick={inputMethod === "file" ? handleUploadAndAssess : handleCloneAndAssess}
                  disabled={(inputMethod === "file" ? files.length === 0 : !repoUrl.trim()) || isProcessing}
                  className="h-9 px-6"
                >
                  {isProcessing ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      {inputMethod === "file" ? "Uploading..." : "Cloning..."}
                    </>
                  ) : (
                    inputMethod === "file" ? "Start Assessment" : "Clone & Assess"
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>
        );

      case "assessing":
        return (
          <div className="space-y-4">
            {/* Upload progress phase */}
            {uploadPhase === "uploading" && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Upload className="h-4 w-4 text-violet-500" />
                    {inputMethod === "git" ? "Cloning Repository" : "Uploading Files"}
                  </CardTitle>
                  <CardDescription className="text-xs">
                    {inputMethod === "git"
                      ? "Cloning repository from remote..."
                      : `Uploading ${files.length} file(s)...`}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {inputMethod === "git" ? (
                    <div className="relative h-4 w-full overflow-hidden rounded-full bg-secondary">
                      <div className="h-full w-1/3 bg-primary rounded-full animate-pulse" />
                    </div>
                  ) : (
                    <Progress value={uploadProgress} className="w-full" />
                  )}
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>{inputMethod === "git" ? "Cloning..." : `${Math.round(uploadProgress)}% uploaded`}</span>
                    <Loader2 className="h-3 w-3 animate-spin" />
                  </div>
                </CardContent>
              </Card>
            )}
            {/* Analysis/assessment phase */}
            {uploadPhase !== "uploading" && (
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle className="flex items-center gap-2">
                        {isPaused ? "Paused" : selectedPhases.has("assessment") ? "Running Assessment" : "Processing"}
                      </CardTitle>
                      <CardDescription className="mt-1">
                        {isPaused
                          ? "Processing is paused. Click Resume to continue."
                          : selectedPhases.has("assessment")
                            ? (progressData?.currentStage || statusMessage || "Profiling repository, analyzing dependencies, researching versions…")
                            : (statusMessage || "Running selected phases…")}
                      </CardDescription>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {isPaused ? (
                        <>
                          <Button size="sm" onClick={handleResume}>
                            <Play className="h-3.5 w-3.5 mr-1.5" /> Resume
                          </Button>
                          <Button variant="destructive" size="sm" onClick={handleCancel}>
                            <X className="h-3.5 w-3.5 mr-1.5" /> Cancel
                          </Button>
                        </>
                      ) : (
                        <>
                          <Button variant="outline" size="sm" onClick={handlePause}>
                            <Pause className="h-3.5 w-3.5 mr-1.5" /> Pause
                          </Button>
                          <Button variant="destructive" size="sm" onClick={handleCancel}>
                            <Square className="h-3.5 w-3.5 mr-1.5" /> Cancel
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <Progress value={progress} className="w-full" />
                </CardContent>
              </Card>
            )}
            {selectedPhases.has("assessment") && <AssessmentCardsGrid progressData={progressData} />}
          </div>
        );

      case "assessment_complete":
        return (
          <div className="space-y-4 min-w-0 max-w-full overflow-hidden">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 rounded-lg border border-border bg-muted/30 p-4">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-green-500" />
                  <h3 className="font-semibold">Assessment Complete</h3>
                </div>
                <p className="text-sm text-muted-foreground mt-1">
                  Review the assessment and describe your upgrade requirements below.
                </p>
              </div>
              {(() => {
                const needsUpgrade = selectedPhases.has("planning") || selectedPhases.has("tasks") || selectedPhases.has("execution");
                const upgradeDisabled = needsUpgrade && (() => {
                  const p = versionRecommendationsText ? parseVersionSelections(versionRecommendationsText) : [];
                  return p.length > 0 && !hasAtLeastOneUpgrade(p);
                })();
                return (
                  <div className="flex items-center gap-2 flex-wrap shrink-0">
                    <Button variant="outline" size="sm" onClick={() => handleResetPhase("assessment", "upload")} disabled={isProcessing}>
                      <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
                      Re-run Assessment
                    </Button>
                    <Button
                      onClick={handleProceedToPlanning}
                      disabled={isProcessing || !versionRecommendationsText || upgradeDisabled}
                    >
                      {isProcessing ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          Processing...
                        </>
                      ) : (
                        <>
                          <ArrowRight className="mr-2 h-4 w-4" />
                          {getNextPhaseButton("assessment")?.label || "Continue to Planning"}
                        </>
                      )}
                    </Button>
                  </div>
                );
              })()}
            </div>
            <Tabs key={`assessment-tabs-${displayStage}`} defaultValue="requirements">
              <TabsList className="w-auto">
                <TabsTrigger value="requirements">Requirements</TabsTrigger>
                <TabsTrigger value="analysis">Analysis</TabsTrigger>
              </TabsList>
              <TabsContent value="requirements">
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      Your Upgrade Requirements
                    </CardTitle>
                    <CardDescription>
                      Edit versions directly, type natural language (e.g. &quot;upgrade react from 17 to 18&quot;), or use AI Enhance. Then continue to planning.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="flex gap-2">
                      <Button 
                        variant="outline" 
                        onClick={() => handleViewStream("Assessment Report", "assessment", "assessment")}
                        className="flex-1"
                      >
                        <FileText className="mr-2 h-4 w-4" />
                        View Assessment
                      </Button>
                      <Button 
                        variant="outline" 
                        onClick={() => handleDownload('assessment')}
                        className="flex-1"
                      >
                        <Download className="mr-2 h-4 w-4" />
                        Download
                      </Button>
                    </div>
                    
                    <div className="space-y-2">
                      <label className="text-sm font-medium block">
                        Your Upgrade Requirements
                      </label>
                      <Textarea
                        value={versionRecommendationsText}
                        onChange={(e) => setVersionRecommendationsText(e.target.value)}
                        rows={12}
                        className="font-mono text-sm"
                        placeholder="Describe your upgrade requirements here..."
                      />
                      <div className="text-xs space-y-1">
                        <p className="text-muted-foreground">
                          Supported formats: <code className="bg-muted px-1 rounded">## Package / Current: X / Target: Y</code>, <code className="bg-muted px-1 rounded">package 1.0 -&gt; 2.0</code>, or <code className="bg-muted px-1 rounded">upgrade package from 1.0 to 2.0</code>
                        </p>
                        {versionRecommendationsText && (() => {
                          const parsed = parseVersionSelections(versionRecommendationsText);
                          if (parsed.length === 0) {
                            return (
                              <p className="text-amber-600 dark:text-amber-400 font-medium">
                                No valid packages detected. Check format above.
                              </p>
                            );
                          }
                          const hasUpgrade = hasAtLeastOneUpgrade(parsed);
                          return (
                            <div className="space-y-1">
                              <p className="text-green-600 dark:text-green-400 font-medium">
                                Detected {parsed.length} package(s): {parsed.map(p => `${p.package} (${p.currentVersion || '?'} → ${p.selectedVersion})`).join(', ')}
                              </p>
                              {!hasUpgrade && (
                                <p className="text-amber-600 dark:text-amber-400 font-medium">
                                  No upgrade needed — all targets match current. Change at least one target to continue.
                                </p>
                              )}
                            </div>
                          );
                        })()}
                      </div>
                    </div>

                    <div className="flex gap-2">
                      <Button 
                        variant="outline"
                        onClick={handleAIEnhance}
                        disabled={isProcessing || !versionRecommendationsText}
                        className="flex-1"
                      >
                        {isProcessing ? (
                          <>
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            Enhancing...
                          </>
                        ) : (
                          <>
                            <Sparkles className="mr-2 h-4 w-4" />
                            AI Enhance
                          </>
                        )}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
                {versionChangeHistory.length > 0 && (
                  <Card className="border-amber-500/30 bg-amber-50/5">
                    <CardHeader className="pb-2 cursor-pointer" onClick={() => setShowVersionHistory(!showVersionHistory)}>
                      <CardTitle className="flex items-center gap-2 text-sm">
                        <RotateCcw className="h-4 w-4 text-amber-500" />
                        Version Change History ({versionChangeHistory.length} revision{versionChangeHistory.length > 1 ? "s" : ""})
                        <ChevronDown className={`h-4 w-4 ml-auto transition-transform ${showVersionHistory ? "rotate-180" : ""}`} />
                      </CardTitle>
                    </CardHeader>
                    {showVersionHistory && (
                      <CardContent className="space-y-3 pt-0">
                        {versionChangeHistory.map((change: any, i: number) => (
                          <div key={change.id || i} className="rounded-lg border border-border/50 p-3 space-y-2 text-sm">
                            <div className="flex items-center justify-between">
                              <span className="font-medium text-muted-foreground">
                                Phase reset: <span className="text-foreground capitalize">{change.phase_reset || change.phaseReset}</span>
                              </span>
                              <span className="text-xs text-muted-foreground">
                                {new Date(change.created_at || change.createdAt).toLocaleString()}
                              </span>
                            </div>
                            {(change.previous_selections || change.previousSelections) && (
                              <div className="space-y-1">
                                <p className="text-xs font-medium text-muted-foreground">Previous selections:</p>
                                <div className="flex flex-wrap gap-1.5">
                                  {(change.previous_selections || change.previousSelections || []).map((sel: any, j: number) => (
                                    <span key={j} className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-0.5 text-xs">
                                      {sel.package}: {sel.currentVersion} &rarr; {sel.selectedVersion}
                                    </span>
                                  ))}
                                </div>
                              </div>
                            )}
                            {(change.downstream_phases_cleared || change.downstreamPhasesCleared || []).length > 0 && (
                              <p className="text-xs text-muted-foreground">
                                Cleared: {(change.downstream_phases_cleared || change.downstreamPhasesCleared).join(", ")}
                              </p>
                            )}
                          </div>
                        ))}
                      </CardContent>
                    )}
                  </Card>
                )}
              </TabsContent>
              <TabsContent value="analysis" className="space-y-3">
                <div className="flex justify-end">
                  <Button variant="outline" size="sm" onClick={() => handleChartsPdfDownload("assessment")}>
                    <Download className="h-3.5 w-3.5 mr-1.5" />
                    Export PDF
                  </Button>
                </div>
                <AssessmentCardsGrid progressData={progressData} onDownloadChartPdf={(chartId) => handleChartsPdfDownload("assessment", chartId)} />
              </TabsContent>
            </Tabs>
          </div>
        );

      case "planning":
        return (
          <div className="space-y-4">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      {isPaused ? "Paused" : "Generating Detailed Plan"}
                    </CardTitle>
                    <CardDescription className="mt-1">
                      {isPaused ? "Processing is paused. Click Resume to continue." : (progressData?.currentStage || statusMessage || "Compatibility check, risk assessment, migration strategies…")}
                    </CardDescription>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {isPaused ? (
                      <>
                        <Button size="sm" onClick={handleResume}><Play className="h-3.5 w-3.5 mr-1.5" /> Resume</Button>
                        <Button variant="destructive" size="sm" onClick={handleCancel}><X className="h-3.5 w-3.5 mr-1.5" /> Cancel</Button>
                      </>
                    ) : isProcessing && (
                      <>
                        <Button variant="outline" size="sm" onClick={handlePause}><Pause className="h-3.5 w-3.5 mr-1.5" /> Pause</Button>
                        <Button variant="destructive" size="sm" onClick={handleCancel}><Square className="h-3.5 w-3.5 mr-1.5" /> Cancel</Button>
                      </>
                    )}
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <Progress value={progress} className="w-full" />
              </CardContent>
            </Card>
            <PlanningDashboard data={progressData?.planningVisualizationData} />
          </div>
        );

      case "plan_complete": {
        const planNextAction = getNextPhaseButton("planning");
        return (
          <div className="space-y-4 min-w-0 max-w-full overflow-hidden">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 rounded-lg border border-border bg-muted/30 p-4">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 shrink-0 text-primary" />
                  <h3 className="font-semibold">Planning Complete</h3>
                </div>
                <p className="text-sm text-muted-foreground mt-1">
                  Review the detailed upgrade plan including risks, compatibility analysis, and migration strategy.
                </p>
              </div>
              <div className="flex gap-2 shrink-0">
                <Button variant="outline" size="sm" onClick={() => handleResetPhase("planning", "assessment_complete")} disabled={isProcessing}>
                  <ArrowLeft className="mr-1.5 h-3.5 w-3.5" />
                  Change Versions
                </Button>
                <Button variant="outline" size="sm" onClick={() => { handleResetPhase("planning", "planning" as WorkflowStage); setTimeout(() => handleProceedToPlanning(), 500); }} disabled={isProcessing}>
                  <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
                  Re-plan
                </Button>
                {planNextAction && (
                  <Button onClick={planNextAction.handler} disabled={isProcessing}>
                    {isProcessing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ArrowRight className="mr-2 h-4 w-4" />}
                    {isProcessing ? "Processing..." : planNextAction.label}
                  </Button>
                )}
              </div>
            </div>
            <Tabs key={`plan-tabs-${displayStage}`} defaultValue={((progressData?.planningVisualizationData?.upgradeOrder?.length ?? 0) > 0 || (progressData?.planningVisualizationData?.keyInsights?.length ?? 0) > 0 || !!progressData?.planMarkdown) ? "plan" : "analytics"}>
              <TabsList className="w-auto">
                <TabsTrigger value="plan">Plan & Actions</TabsTrigger>
                <TabsTrigger value="analytics">Risk & Compatibility</TabsTrigger>
              </TabsList>
              <TabsContent value="plan" className="space-y-4">
                <Card>
                  <CardHeader>
                    <CardTitle>Upgrade Plan</CardTitle>
                    <CardDescription>
                      Full migration strategy including risks, compatibility analysis, and step-by-step migration path.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="flex flex-wrap gap-2">
                      <Button 
                        variant="outline" 
                        onClick={() => handleViewStream("Upgrade Plan", "plan", "plan")}
                        className="flex-1 min-w-[140px]"
                      >
                        <FileText className="mr-2 h-4 w-4" />
                        View Plan
                      </Button>
                      <Button 
                        variant="outline" 
                        onClick={() => handleDownload('plan')}
                        className="flex-1 min-w-[140px]"
                      >
                        <Download className="mr-2 h-4 w-4" />
                        Download
                      </Button>
                    </div>
                  </CardContent>
                </Card>
                {progressData?.planningVisualizationData?.upgradeOrder?.length > 0 && (
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm">Recommended Upgrade Order</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <ol className="space-y-1.5">
                        {progressData.planningVisualizationData.upgradeOrder.map((pkg: string, i: number) => (
                          <li key={i} className="flex items-center gap-2 text-sm">
                            <span className="flex-shrink-0 w-5 h-5 rounded-full bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300 flex items-center justify-center text-xs font-bold">
                              {i + 1}
                            </span>
                            <span className="font-medium">{pkg}</span>
                          </li>
                        ))}
                      </ol>
                    </CardContent>
                  </Card>
                )}
                {progressData?.planningVisualizationData?.keyInsights?.length > 0 && (
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm">Key Insights</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <ul className="space-y-1.5">
                        {progressData.planningVisualizationData.keyInsights.slice(0, 6).map((insight: string, i: number) => (
                          <li key={i} className="text-sm text-muted-foreground flex items-start gap-2">
                            <span className="text-amber-500 mt-0.5 flex-shrink-0">*</span>
                            <span>{insight}</span>
                          </li>
                        ))}
                      </ul>
                    </CardContent>
                  </Card>
                )}
              </TabsContent>
              <TabsContent value="analytics" className="space-y-3">
                <div className="flex justify-end">
                  <Button variant="outline" size="sm" onClick={() => handleChartsPdfDownload("planning")}>
                    <Download className="h-3.5 w-3.5 mr-1.5" />
                    Export PDF
                  </Button>
                </div>
                <PlanningDashboard data={progressData?.planningVisualizationData} onDownloadChartPdf={(chartId) => handleChartsPdfDownload("planning", chartId)} />
              </TabsContent>
            </Tabs>
          </div>
        );
      }

      case "downloading_packages":
        return (
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <Loader2 className="h-5 w-5 animate-spin text-blue-500" />
                    Downloading Packages
                  </CardTitle>
                  <CardDescription>
                    {progressData?.currentStage || "Downloading vendor library files from jsDelivr CDN..."}
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                Downloading target versions of detected vendor libraries (jQuery, Bootstrap, Font Awesome, etc.) and replacing them on disk.
                This runs before task generation so the LLM knows which libraries are available.
              </p>
            </CardContent>
          </Card>
        );

      case "packages_complete": {
        const pkgNextAction = getNextPhaseButton("packages");
        const dlResults = progressData?.vendorDownloadResults;
        const totalSize = dlResults?.downloaded?.reduce((sum: number, d: any) => sum + (d.sizeBytes || 0), 0) ?? 0;
        const formatSize = (bytes: number) => bytes > 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)}MB` : bytes > 1024 ? `${(bytes / 1024).toFixed(1)}KB` : `${bytes}B`;
        return (
          <div className="space-y-4">
            {/* Summary header */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 rounded-lg border border-border bg-muted/30 p-4">
              <div>
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-green-600" />
                  <h3 className="font-semibold">Packages Downloaded</h3>
                </div>
                <p className="text-sm text-muted-foreground mt-1">
                  {dlResults
                    ? `${dlResults.downloaded?.length ?? 0} downloaded (${formatSize(totalSize)}), ${dlResults.failed?.length ?? 0} failed, ${dlResults.skipped?.length ?? 0} skipped`
                    : "Vendor library download complete."}
                </p>
              </div>
              <div className="flex gap-2 shrink-0">
                {pkgNextAction && (
                  <Button onClick={pkgNextAction.handler} disabled={isProcessing}>
                    {isProcessing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ArrowRight className="mr-2 h-4 w-4" />}
                    {isProcessing ? "Processing..." : pkgNextAction.label}
                  </Button>
                )}
              </div>
            </div>

            {/* Downloaded files table */}
            {dlResults?.downloaded && dlResults.downloaded.length > 0 && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-green-500" />
                    Successfully Downloaded ({dlResults.downloaded.length})
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b text-left text-muted-foreground">
                          <th className="pb-2 pr-4 font-medium">Library</th>
                          <th className="pb-2 pr-4 font-medium">Version</th>
                          <th className="pb-2 pr-4 font-medium">Type</th>
                          <th className="pb-2 pr-4 font-medium">Destination</th>
                          <th className="pb-2 pr-4 font-medium">Source</th>
                          <th className="pb-2 pr-4 font-medium text-right">Size</th>
                        </tr>
                      </thead>
                      <tbody>
                        {dlResults.downloaded.map((d: any, i: number) => (
                          <tr key={i} className="border-b border-border/30 hover:bg-muted/20">
                            <td className="py-2 pr-4 font-medium text-green-700 dark:text-green-400">{d.library || "unknown"}</td>
                            <td className="py-2 pr-4">{d.version || "—"}</td>
                            <td className="py-2 pr-4">
                              <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                                d.type === "bundle" ? "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300"
                                : d.type === "created" ? "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300"
                                : "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300"
                              }`}>
                                {d.type === "bundle" ? "Bundle" : d.type === "created" ? "New File" : "Replaced"}
                              </span>
                            </td>
                            <td className="py-2 pr-4 text-xs text-muted-foreground font-mono truncate max-w-[300px]" title={d.destination}>{d.destination?.split("/").pop() || d.destination || "—"}</td>
                            <td className="py-2 pr-4">
                              {d.source ? (
                                <button
                                  className="text-xs text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1 group relative"
                                  onClick={(e) => {
                                    e.preventDefault();
                                    const btn = e.currentTarget;
                                    const url = d.source;
                                    navigator.clipboard.writeText(url).then(() => {
                                      // Visual feedback: show "Copied!" badge
                                      const badge = document.createElement("span");
                                      badge.textContent = "✅ Copied!";
                                      badge.className = "absolute -top-6 left-0 bg-green-600 text-white text-[10px] px-2 py-0.5 rounded shadow-lg z-50 whitespace-nowrap";
                                      btn.style.position = "relative";
                                      btn.appendChild(badge);
                                      setTimeout(() => badge.remove(), 2000);
                                      toast({ title: "✅ Link Copied to Clipboard!", description: url, duration: 4000 });
                                    }).catch(() => {
                                      toast({ title: "Copy failed", description: "Could not copy URL", variant: "destructive" });
                                    });
                                  }}
                                  title={d.source}
                                >
                                  <ClipboardCheck className="h-3 w-3 shrink-0" />
                                  <span className="break-all text-left">📋 {d.source.replace("https://cdn.jsdelivr.net/npm/", "npm/")}</span>
                                </button>
                              ) : "—"}
                            </td>
                            <td className="py-2 pr-4 text-right text-muted-foreground">{d.sizeBytes ? formatSize(d.sizeBytes) : "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Failed downloads */}
            {dlResults?.failed && dlResults.failed.length > 0 && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2 text-red-600 dark:text-red-400">
                    <AlertTriangle className="h-4 w-4" />
                    Failed Downloads ({dlResults.failed.length})
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {dlResults.failed.map((f: any, i: number) => (
                      <div key={i} className="flex items-start gap-3 p-2 rounded bg-red-50 dark:bg-red-900/10 border border-red-200 dark:border-red-800/30">
                        <AlertTriangle className="h-4 w-4 text-red-500 shrink-0 mt-0.5" />
                        <div>
                          <p className="font-medium text-red-700 dark:text-red-400">{f.library || "Unknown"} {f.version ? `@${f.version}` : ""}</p>
                          <p className="text-xs text-red-600 dark:text-red-500 mt-0.5">Reason: {f.reason || "Unknown error"}</p>
                          {f.source && <p className="text-xs text-muted-foreground mt-0.5 font-mono truncate">Source: {f.source}</p>}
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Skipped vendors */}
            {dlResults?.skipped && dlResults.skipped.length > 0 && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm text-muted-foreground">Skipped ({dlResults.skipped.length})</CardTitle>
                </CardHeader>
                <CardContent>
                  {dlResults.skipped.map((s: any, i: number) => (
                    <div key={i} className="text-sm text-muted-foreground py-1">
                      <span className="font-medium">{s.library}</span> — {s.reason}
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}
          </div>
        );
      }

      case "task_planning":
        return (
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    {isPaused ? "Paused" : "Generating Task Breakdown"}
                  </CardTitle>
                  <CardDescription className="mt-1">
                    {isPaused ? "Processing is paused. Click Resume to continue." : (progressData?.currentStage || statusMessage || "Breaking down plan into executable tasks…")}
                  </CardDescription>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {isPaused ? (
                    <>
                      <Button size="sm" onClick={handleResume}><Play className="h-3.5 w-3.5 mr-1.5" /> Resume</Button>
                      <Button variant="destructive" size="sm" onClick={handleCancel}><X className="h-3.5 w-3.5 mr-1.5" /> Cancel</Button>
                    </>
                  ) : isProcessing && (
                    <>
                      <Button variant="outline" size="sm" onClick={handlePause}><Pause className="h-3.5 w-3.5 mr-1.5" /> Pause</Button>
                      <Button variant="destructive" size="sm" onClick={handleCancel}><Square className="h-3.5 w-3.5 mr-1.5" /> Cancel</Button>
                    </>
                  )}
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <Progress value={progress} className="w-full" />
            </CardContent>
          </Card>
        );

      case "tasks_ready":
        const tasksArr = progressData?.upgradeTasks || [];
        const taskTotal = tasksArr.length;
        const taskFilesSet = new Set<string>();
        const phaseMap: Record<string, number> = {};
        const riskMap: Record<string, number> = {};
        let autoFixCount = 0;
        let manualCount = 0;
        for (const t of tasksArr) {
          const phase = t.phase || "General";
          phaseMap[phase] = (phaseMap[phase] || 0) + 1;
          const risk = (t.riskLevel || t.priority || "medium").toLowerCase();
          const riskLabel = (risk === "high" || risk === "critical") ? "High" : risk === "low" ? "Low" : "Medium";
          riskMap[riskLabel] = (riskMap[riskLabel] || 0) + 1;
          if (t.autoFixable) autoFixCount++; else manualCount++;
          const files = t.affectedFiles || t.files || [];
          if (Array.isArray(files)) files.forEach((f: string) => taskFilesSet.add(f));
        }
        const phaseData = Object.entries(phaseMap).map(([name, value]) => ({ name: name.replace(/^Phase \d+:\s*/i, ""), value }));
        const riskData = [
          ...(riskMap["High"] ? [{ name: "High Risk", value: riskMap["High"], fill: "#ef4444" }] : []),
          ...(riskMap["Medium"] ? [{ name: "Medium Risk", value: riskMap["Medium"], fill: "#f59e0b" }] : []),
          ...(riskMap["Low"] ? [{ name: "Low Risk", value: riskMap["Low"], fill: "#22c55e" }] : []),
        ];
        const autoFixData = [
          { name: "Auto-fixable", value: autoFixCount, fill: "#6366f1" },
          { name: "Manual", value: manualCount, fill: "#a855f7" },
        ].filter(d => d.value > 0);
        const PHASE_COLORS = ["#6366f1", "#22c55e", "#f59e0b", "#ef4444", "#06b6d4", "#a855f7", "#ec4899", "#14b8a6"];
        return (
          <div className="space-y-4 min-w-0 max-w-full overflow-hidden">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 rounded-lg border border-border bg-muted/30 p-4">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <ClipboardCheck className="h-4 w-4 shrink-0 text-primary" />
                  <h3 className="font-semibold">Tasks Ready ({taskTotal} tasks)</h3>
                </div>
                <p className="text-sm text-muted-foreground mt-1">
                  Task breakdown complete. Review the tasks below and execute the upgrade.
                </p>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <Button variant="outline" size="sm" onClick={() => handleResetPhase("tasks", "plan_complete")} disabled={isProcessing}>
                  <ArrowLeft className="mr-1.5 h-3.5 w-3.5" />
                  Back to Plan
                </Button>
                <Button variant="outline" size="sm" onClick={() => { handleResetPhase("tasks", "task_planning" as WorkflowStage); setTimeout(() => handleGenerateTasks(), 500); }} disabled={isProcessing}>
                  <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
                  Re-generate Tasks
                </Button>
                <Dialog open={addTaskOpen} onOpenChange={setAddTaskOpen}>
                  <DialogTrigger asChild>
                    <Button variant="outline" size="sm" className="gap-1.5">
                      <Plus className="h-4 w-4" />
                      Add Task
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="sm:max-w-[500px]">
                    <DialogHeader>
                      <DialogTitle>Add Custom Task</DialogTitle>
                      <DialogDescription>
                        Define a manual upgrade task to be included in the execution plan.
                      </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 py-2">
                      <div className="space-y-2">
                        <Label htmlFor="task-title">Title</Label>
                        <Input
                          id="task-title"
                          placeholder="e.g., Update datepicker initialization"
                          value={newTaskTitle}
                          onChange={(e) => setNewTaskTitle(e.target.value)}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="task-desc">Description</Label>
                        <Textarea
                          id="task-desc"
                          placeholder="Detailed description of what needs to change..."
                          rows={3}
                          value={newTaskDescription}
                          onChange={(e) => setNewTaskDescription(e.target.value)}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="task-steps">Steps (one per line)</Label>
                        <Textarea
                          id="task-steps"
                          placeholder="Update import path&#10;Change function call syntax&#10;Test output"
                          rows={3}
                          value={newTaskSteps}
                          onChange={(e) => setNewTaskSteps(e.target.value)}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Risk Level</Label>
                        <Select value={newTaskRisk} onValueChange={(v: "low" | "medium" | "high") => setNewTaskRisk(v)}>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="low">Low</SelectItem>
                            <SelectItem value="medium">Medium</SelectItem>
                            <SelectItem value="high">High</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <DialogFooter>
                      <Button variant="outline" onClick={() => setAddTaskOpen(false)}>Cancel</Button>
                      <Button onClick={handleAddTask} disabled={addingTask || !newTaskTitle.trim() || !newTaskDescription.trim()}>
                        {addingTask ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
                        Add Task
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
                {(() => {
                  const tasksNextAction = getNextPhaseButton("tasks");
                  if (!tasksNextAction) return null;
                  return (
                    <Button
                      onClick={tasksNextAction.handler}
                      disabled={isProcessing}
                      className="w-full sm:w-auto shrink-0"
                    >
                      {isProcessing ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          Processing...
                        </>
                      ) : (
                        <>
                          <Play className="mr-2 h-4 w-4" />
                          {tasksNextAction.label}
                        </>
                      )}
                    </Button>
                  );
                })()}
              </div>
            </div>

            <Tabs key={`tasks-tabs-${displayStage}`} defaultValue="tasks">
              <TabsList className="w-auto">
                <TabsTrigger value="tasks">Task List</TabsTrigger>
                <TabsTrigger value="distribution">Distribution</TabsTrigger>
              </TabsList>
              <TabsContent value="tasks" className="space-y-4">
                <TaskExecutionAccordion
                  tasks={progressData?.upgradeTasks || []}
                  analysisId={analysisId || undefined}
                  executionResults={(progressData?.upgradeTasks || []).map((t: any) => ({
                    taskId: t.id,
                    status: "pending",
                    summary: "",
                    alteredFiles: [],
                    fixedIssues: [],
                    verificationFiles: [],
                  }))}
                />
                <Card>
                  <CardContent className="space-y-4 pt-4">
                    <div className="flex flex-wrap gap-2">
                      <Button 
                        variant="outline" 
                        onClick={() => handleView("Execution Tasks", tasksMarkdown, "tasks")}
                        className="flex-1 min-w-[140px]"
                      >
                        <FileText className="mr-2 h-4 w-4" />
                        View Tasks Markdown
                      </Button>
                      <Button 
                        variant="outline" 
                        onClick={() => handleDownload('tasks')}
                        className="flex-1 min-w-[140px]"
                      >
                        <Download className="mr-2 h-4 w-4" />
                        Download
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>
              <TabsContent value="distribution" className="space-y-4">
                <div className="flex justify-end">
                  <Button variant="outline" size="sm" onClick={() => handleChartsPdfDownload("tasks")}>
                    <Download className="h-3.5 w-3.5 mr-1.5" />
                    Export PDF
                  </Button>
                </div>
                {taskTotal > 0 && (
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <Card>
                      <CardContent className="pt-4 pb-3 px-4">
                        <p className="text-xs text-muted-foreground font-medium">Total Tasks</p>
                        <p className="text-2xl font-bold mt-1">{taskTotal}</p>
                        <p className="text-xs text-muted-foreground">{phaseData.length} phase(s)</p>
                      </CardContent>
                    </Card>
                    <Card>
                      <CardContent className="pt-4 pb-3 px-4">
                        <p className="text-xs text-muted-foreground font-medium">Risk Distribution</p>
                        <div className="flex items-center gap-3 mt-1">
                          {riskMap["High"] && <span className="text-sm font-semibold text-red-500">{riskMap["High"]} high</span>}
                          {riskMap["Medium"] && <span className="text-sm font-semibold text-amber-500">{riskMap["Medium"]} med</span>}
                          {riskMap["Low"] && <span className="text-sm font-semibold text-green-500">{riskMap["Low"]} low</span>}
                        </div>
                      </CardContent>
                    </Card>
                    <Card>
                      <CardContent className="pt-4 pb-3 px-4">
                        <p className="text-xs text-muted-foreground font-medium">Auto-fixable</p>
                        <p className="text-2xl font-bold mt-1">{autoFixCount}<span className="text-sm font-normal text-muted-foreground">/{taskTotal}</span></p>
                        <p className="text-xs text-muted-foreground">{manualCount} manual</p>
                      </CardContent>
                    </Card>
                    <Card>
                      <CardContent className="pt-4 pb-3 px-4">
                        <p className="text-xs text-muted-foreground font-medium">Files Affected</p>
                        <p className="text-2xl font-bold mt-1">{taskFilesSet.size}</p>
                        <p className="text-xs text-muted-foreground">across all tasks</p>
                      </CardContent>
                    </Card>
                  </div>
                )}
                {taskTotal > 0 && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <Card>
                      <CardHeader className="py-3 px-4">
                        <CardTitle className="text-sm">Tasks by Upgrade Phase</CardTitle>
                      </CardHeader>
                      <CardContent className="pb-3 px-4">
                        <div className="h-[220px]">
                          <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={phaseData} layout="vertical" margin={{ left: 0, right: 20, top: 5, bottom: 5 }}>
                              <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                              <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} />
                              <YAxis dataKey="name" type="category" width={140} tick={{ fontSize: 10 }} />
                              <Tooltip formatter={(v: number) => [`${v} task(s)`, "Count"]} />
                              <Bar dataKey="value" name="Tasks" radius={[0, 4, 4, 0]}>
                                {phaseData.map((_entry, index) => (
                                  <Cell key={`pc-${index}`} fill={PHASE_COLORS[index % PHASE_COLORS.length]} />
                                ))}
                              </Bar>
                            </BarChart>
                          </ResponsiveContainer>
                        </div>
                      </CardContent>
                    </Card>
                    <Card>
                      <CardHeader className="py-3 px-4">
                        <CardTitle className="text-sm">Risk Level & Automation</CardTitle>
                      </CardHeader>
                      <CardContent className="pb-3 px-4">
                        <div className="h-[220px] flex">
                          <div className="flex-1">
                            <p className="text-[10px] text-center text-muted-foreground mb-1">Risk</p>
                            <ResponsiveContainer width="100%" height="90%">
                              <PieChart>
                                <Pie data={riskData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={30} outerRadius={55} paddingAngle={3} label={({ name, value }) => `${name.split(" ")[0]} ${value}`} labelLine={false}>
                                  {riskData.map((entry, i) => <Cell key={`rk-${i}`} fill={entry.fill} />)}
                                </Pie>
                                <Tooltip formatter={(v: number) => [`${v} task(s)`]} />
                              </PieChart>
                            </ResponsiveContainer>
                          </div>
                          <div className="flex-1">
                            <p className="text-[10px] text-center text-muted-foreground mb-1">Automation</p>
                            <ResponsiveContainer width="100%" height="90%">
                              <PieChart>
                                <Pie data={autoFixData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={30} outerRadius={55} paddingAngle={3} label={({ name, value }) => `${name} ${value}`} labelLine={false}>
                                  {autoFixData.map((entry, i) => <Cell key={`af-${i}`} fill={entry.fill} />)}
                                </Pie>
                                <Tooltip formatter={(v: number) => [`${v} task(s)`]} />
                              </PieChart>
                            </ResponsiveContainer>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  </div>
                )}
              </TabsContent>
            </Tabs>
          </div>
        );

      case "executing": {
        const execTasks_ = progressData?.upgradeTasks || [];
        const execResults_ = progressData?.taskExecutionResults || [];
        const execCompleted_ = execResults_.filter((r: any) => r.status === "completed" || r.status === "success").length;
        const execTotal_ = execTasks_.length;
        const execProgressPct = execTotal_ > 0 ? Math.round((execCompleted_ / execTotal_) * 100) : progress;
        const execCurrentTask_ = execResults_.find((r: any) => r.status === "in_progress");
        const execCurrentTitle_ = execCurrentTask_ ? (execTasks_.find((t: any) => t.id === execCurrentTask_.taskId)?.title || execCurrentTask_.taskId) : null;
        return (
          <div className="space-y-4 min-w-0 max-w-full overflow-hidden">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      {isPaused ? "Paused" : "Executing Tasks"}
                    </CardTitle>
                    <CardDescription className="mt-1">
                      {isPaused
                        ? "Processing is paused. Click Resume to continue."
                        : execTotal_ > 0
                          ? <>Task {execCompleted_ + (execCurrentTask_ ? 1 : 0)}/{execTotal_}: {execCurrentTitle_ ? <span className="text-blue-500">{execCurrentTitle_}</span> : "Waiting..."}</>
                          : (progressData?.currentStage || statusMessage || "Upgrading code task by task…")
                      }
                    </CardDescription>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {isPaused ? (
                      <>
                        <Button size="sm" onClick={handleResume}><Play className="h-3.5 w-3.5 mr-1.5" /> Resume</Button>
                        <Button variant="destructive" size="sm" onClick={handleCancel}><X className="h-3.5 w-3.5 mr-1.5" /> Cancel</Button>
                      </>
                    ) : isProcessing && (
                      <>
                        <Button variant="outline" size="sm" onClick={handlePause}><Pause className="h-3.5 w-3.5 mr-1.5" /> Pause</Button>
                        <Button variant="destructive" size="sm" onClick={handleCancel}><Square className="h-3.5 w-3.5 mr-1.5" /> Cancel</Button>
                      </>
                    )}
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground font-medium">Tasks: {execCompleted_}/{execTotal_} completed</span>
                  <span className="text-muted-foreground">{execProgressPct}%</span>
                </div>
                <Progress value={execProgressPct} className="w-full" />
              </CardContent>
            </Card>

            {/* Skipped files warning banner */}
            {(progressData as any)?.skippedFiles?.length > 0 && (
              <Card className="border-amber-500/40 bg-amber-500/5">
                <CardContent className="py-3 px-4">
                  <p className="text-sm font-medium text-amber-600 dark:text-amber-400">
                    {(progressData as any).skippedFiles.length} file(s) were too large to process automatically and require manual review.
                  </p>
                </CardContent>
              </Card>
            )}

            {/* Task-by-task accordion with live updates */}
            <TaskExecutionAccordion
              tasks={progressData?.upgradeTasks || []}
              executionResults={progressData?.taskExecutionResults || []}
              analysisId={analysisId || undefined}
              onRetryStarted={handleRetryStarted}
            />
          </div>
        );
      }

      case "execution_complete": {
        const execNextAction = getNextPhaseButton("execution");
        const execModFiles = progressData?.modifiedFiles || [];
        const execResults = progressData?.taskExecutionResults || [];
        const execTasks = progressData?.upgradeTasks || [];
        const execCompleted = execResults.filter((r: any) => r.status === "completed" || r.status === "success").length;
        const execFailed = execResults.filter((r: any) => r.status === "failed" || r.status === "error").length;
        const execFilesModified = execModFiles.length;
        return (
          <div className="space-y-4 min-w-0 max-w-full overflow-hidden">
            {(progressData as any)?.skippedFiles?.length > 0 && (
              <Card className="border-amber-500/40 bg-amber-500/5">
                <CardContent className="py-3 px-4">
                  <p className="text-sm font-medium text-amber-600 dark:text-amber-400">
                    {(progressData as any).skippedFiles.length} file(s) were too large to process automatically and require manual review.
                  </p>
                </CardContent>
              </Card>
            )}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 rounded-lg border border-border bg-muted/30 p-4">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-green-500" />
                  <h3 className="font-semibold">Code Upgrade Complete</h3>
                </div>
                <p className="text-sm text-muted-foreground mt-1">
                  All tasks executed successfully. Review the upgraded code below{execNextAction ? ", then proceed to next phase." : "."}
                </p>
              </div>
              <div className="flex items-center gap-2 flex-wrap shrink-0">
                <Button variant="outline" size="sm" onClick={() => handleResetPhase("execution", "tasks_ready")} disabled={isProcessing}>
                  <ArrowLeft className="mr-1.5 h-3.5 w-3.5" />
                  Back to Tasks
                </Button>
                <Button variant="outline" size="sm" onClick={() => { handleResetPhase("execution", "executing" as WorkflowStage); setTimeout(() => handleExecuteTasks(), 500); }} disabled={isProcessing}>
                  <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
                  Re-run Execution
                </Button>
                {execNextAction && (
                  <Button onClick={execNextAction.handler} disabled={isProcessing}>
                    {isProcessing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ArrowRight className="mr-2 h-4 w-4" />}
                    {isProcessing ? "Processing..." : execNextAction.label}
                  </Button>
                )}
              </div>
            </div>
            <Tabs key={`exec-tabs-${displayStage}`} defaultValue="results">
              <TabsList className="w-auto">
                <TabsTrigger value="results">Results</TabsTrigger>
                <TabsTrigger value="statistics">Statistics</TabsTrigger>
              </TabsList>
              <TabsContent value="results" className="space-y-4">
                {execTasks.length > 0 && (
                  <TaskExecutionAccordion
                    tasks={execTasks}
                    executionResults={execResults}
                    analysisId={analysisId || undefined}
                    onRetryStarted={handleRetryStarted}
                  />
                )}
                {execModFiles.length > 0 && (
                  <div className="w-full max-w-full min-w-0 overflow-x-auto overflow-y-hidden rounded-lg border border-border/50 bg-muted/5 p-1">
                    <CodeDiffViewer 
                      modifiedFiles={execModFiles}
                      onDownloadZip={() => handleDownload('upgrade')}
                    />
                  </div>
                )}
              </TabsContent>
              <TabsContent value="statistics" className="space-y-4">
                <div className="flex justify-end">
                  <Button variant="outline" size="sm" onClick={() => handleChartsPdfDownload("execution")}>
                    <Download className="h-3.5 w-3.5 mr-1.5" />
                    Export PDF
                  </Button>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <Card>
                    <CardContent className="pt-4 pb-3 px-4">
                      <p className="text-xs text-muted-foreground font-medium">Tasks Completed</p>
                      <p className="text-2xl font-bold mt-1 text-green-600 dark:text-green-400">{execCompleted}</p>
                      <p className="text-xs text-muted-foreground">of {execTasks.length} total</p>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="pt-4 pb-3 px-4">
                      <p className="text-xs text-muted-foreground font-medium">Failed</p>
                      <p className="text-2xl font-bold mt-1 text-red-600 dark:text-red-400">{execFailed}</p>
                      <p className="text-xs text-muted-foreground">task(s)</p>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="pt-4 pb-3 px-4">
                      <p className="text-xs text-muted-foreground font-medium">Files Modified</p>
                      <p className="text-2xl font-bold mt-1">{execFilesModified}</p>
                      <p className="text-xs text-muted-foreground">upgraded files</p>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="pt-4 pb-3 px-4">
                      <p className="text-xs text-muted-foreground font-medium">Success Rate</p>
                      <p className="text-2xl font-bold mt-1">{execTasks.length > 0 ? Math.round((execCompleted / execTasks.length) * 100) : 0}%</p>
                      <p className="text-xs text-muted-foreground">completion</p>
                    </CardContent>
                  </Card>
                </div>
                {/* GAP fields: completeness, obsolete packages, new libraries, bundles */}
                {(progressData?.completenessReport || progressData?.removedObsoletePackages?.length || progressData?.newLibrariesAdded?.length || progressData?.bundleDetections?.length) && (
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    {progressData?.completenessReport && (
                      <Card className={progressData.completenessReport.overallScore >= 80 ? "border-green-500/30" : progressData.completenessReport.overallScore >= 50 ? "border-yellow-500/30" : "border-red-500/30"}>
                        <CardContent className="pt-4 pb-3 px-4">
                          <p className="text-xs text-muted-foreground font-medium">Completeness Score</p>
                          <p className={`text-2xl font-bold mt-1 ${progressData.completenessReport.overallScore >= 80 ? "text-green-600 dark:text-green-400" : progressData.completenessReport.overallScore >= 50 ? "text-yellow-600 dark:text-yellow-400" : "text-red-600 dark:text-red-400"}`}>{progressData.completenessReport.overallScore}%</p>
                          <p className="text-xs text-muted-foreground">{progressData.completenessReport.passed}/{progressData.completenessReport.totalChecks} checks passed</p>
                        </CardContent>
                      </Card>
                    )}
                    {(progressData?.removedObsoletePackages?.length ?? 0) > 0 && (
                      <Card>
                        <CardContent className="pt-4 pb-3 px-4">
                          <p className="text-xs text-muted-foreground font-medium">Obsolete Removed</p>
                          <p className="text-2xl font-bold mt-1">{progressData!.removedObsoletePackages!.length}</p>
                          <p className="text-xs text-muted-foreground">packages cleaned up</p>
                        </CardContent>
                      </Card>
                    )}
                    {(progressData?.newLibrariesAdded?.length ?? 0) > 0 && (
                      <Card>
                        <CardContent className="pt-4 pb-3 px-4">
                          <p className="text-xs text-muted-foreground font-medium">New Libraries</p>
                          <p className="text-2xl font-bold mt-1 text-blue-600 dark:text-blue-400">{progressData!.newLibrariesAdded!.length}</p>
                          <p className="text-xs text-muted-foreground">wired into layout</p>
                        </CardContent>
                      </Card>
                    )}
                    {(progressData?.bundleDetections?.length ?? 0) > 0 && (
                      <Card>
                        <CardContent className="pt-4 pb-3 px-4">
                          <p className="text-xs text-muted-foreground font-medium">Bundles Detected</p>
                          <p className="text-2xl font-bold mt-1">{progressData!.bundleDetections!.length}</p>
                          <p className="text-xs text-muted-foreground">{progressData!.bundleDetections!.filter((b: any) => b.isConcatenated).length} concatenated</p>
                        </CardContent>
                      </Card>
                    )}
                    {progressData?.scaffoldResult && (
                      <Card className="border-blue-500/30">
                        <CardContent className="pt-4 pb-3 px-4">
                          <p className="text-xs text-muted-foreground font-medium">Structural Changes</p>
                          <p className="text-2xl font-bold mt-1 text-blue-500">{(progressData.scaffoldResult.newFiles?.length ?? 0) + (progressData.scaffoldResult.obsoleteFiles?.length ?? 0)}</p>
                          <p className="text-xs text-muted-foreground">{progressData.scaffoldResult.newFiles?.length ?? 0} new, {progressData.scaffoldResult.obsoleteFiles?.length ?? 0} obsolete</p>
                        </CardContent>
                      </Card>
                    )}
                  </div>
                )}
                {execTasks.length > 0 && (
                  <Card>
                    <CardHeader className="py-3 px-4">
                      <CardTitle className="text-sm">Task Execution Results</CardTitle>
                    </CardHeader>
                    <CardContent className="pb-3 px-4">
                      <div className="h-[220px]">
                        <ResponsiveContainer width="100%" height="100%">
                          <PieChart>
                            <Pie
                              data={[
                                { name: "Completed", value: execCompleted, fill: "#22c55e" },
                                { name: "Failed", value: execFailed, fill: "#ef4444" },
                                { name: "Other", value: Math.max(0, execTasks.length - execCompleted - execFailed), fill: "#94a3b8" },
                              ].filter(d => d.value > 0)}
                              dataKey="value"
                              nameKey="name"
                              cx="50%"
                              cy="50%"
                              innerRadius={40}
                              outerRadius={70}
                              paddingAngle={3}
                              label={({ name, value }) => `${name} ${value}`}
                              labelLine={false}
                            >
                              {[
                                { name: "Completed", value: execCompleted, fill: "#22c55e" },
                                { name: "Failed", value: execFailed, fill: "#ef4444" },
                                { name: "Other", value: Math.max(0, execTasks.length - execCompleted - execFailed), fill: "#94a3b8" },
                              ].filter(d => d.value > 0).map((entry, i) => (
                                <Cell key={`exec-${i}`} fill={entry.fill} />
                              ))}
                            </Pie>
                            <Tooltip formatter={(v: number) => [`${v} task(s)`]} />
                          </PieChart>
                        </ResponsiveContainer>
                      </div>
                    </CardContent>
                  </Card>
                )}
              </TabsContent>
            </Tabs>
          </div>
        );
      }

      case "generating_tests":
        return (
          <div className="space-y-4 min-w-0 max-w-full overflow-hidden">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      {isPaused ? "Paused" : "Generating Unit Tests"}
                    </CardTitle>
                    <CardDescription className="mt-1">
                      {isPaused ? "Processing is paused. Click Resume to continue." : (progressData?.currentStage || statusMessage || "Generating tests and confidence report…")}
                    </CardDescription>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {isPaused ? (
                      <>
                        <Button size="sm" onClick={handleResume}><Play className="h-3.5 w-3.5 mr-1.5" /> Resume</Button>
                        <Button variant="destructive" size="sm" onClick={handleCancel}><X className="h-3.5 w-3.5 mr-1.5" /> Cancel</Button>
                      </>
                    ) : isProcessing && (
                      <>
                        <Button variant="outline" size="sm" onClick={handlePause}><Pause className="h-3.5 w-3.5 mr-1.5" /> Pause</Button>
                        <Button variant="destructive" size="sm" onClick={handleCancel}><Square className="h-3.5 w-3.5 mr-1.5" /> Cancel</Button>
                      </>
                    )}
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <Progress value={progress} className="w-full" />
              </CardContent>
            </Card>
            <TestGenerationDashboard
              generatedTests={progressData?.generatedTests || []}
              isGenerating={true}
            />
          </div>
        );

      case "tests_generated": {
        const testsNextAction = getNextPhaseButton("tests");
        const genTests = progressData?.generatedTests || [];
        const testFrameworkMap: Record<string, number> = {};
        for (const t of genTests) {
          const fw = (t as any).framework || "Unknown";
          testFrameworkMap[fw] = (testFrameworkMap[fw] || 0) + 1;
        }
        const testFrameworkData = Object.entries(testFrameworkMap).map(([name, value]) => ({ name, value }));
        const TEST_COLORS = ["#6366f1", "#22c55e", "#f59e0b", "#ef4444", "#06b6d4", "#a855f7"];
        return (
          <div className="space-y-4 min-w-0 max-w-full overflow-hidden">
            {(progressData as any)?.skippedFiles?.length > 0 && (
              <Card className="border-amber-500/40 bg-amber-500/5">
                <CardContent className="py-3 px-4">
                  <p className="text-sm font-medium text-amber-600 dark:text-amber-400">
                    {(progressData as any).skippedFiles.length} file(s) were too large to process automatically and require manual review.
                  </p>
                </CardContent>
              </Card>
            )}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 rounded-lg border border-border bg-muted/30 p-4">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <TestTube2 className="h-4 w-4 shrink-0 text-green-500" />
                  <h3 className="font-semibold">Tests Generated</h3>
                </div>
                <p className="text-sm text-muted-foreground mt-1">
                  Review upgraded files and generated tests.{testsNextAction ? " Run validation to execute tests in a container." : ""}
                </p>
              </div>
              <div className="flex flex-col sm:flex-row gap-2 shrink-0 flex-wrap">
                <Button variant="outline" size="sm" onClick={() => handleResetPhase("tests", "execution_complete")} disabled={isProcessing}>
                  <ArrowLeft className="mr-1.5 h-3.5 w-3.5" />
                  Back to Execution
                </Button>
                <Button variant="outline" size="sm" onClick={() => { handleResetPhase("tests", "generating_tests" as WorkflowStage); setTimeout(() => handleGenerateTests(), 500); }} disabled={isProcessing}>
                  <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
                  Re-generate Tests
                </Button>
                <Button
                  variant="default"
                  size="sm"
                  onClick={handleMarkComplete}
                >
                  <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />
                  Done
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPublishModalOpen(true)}
                >
                  <GitBranch className="mr-1.5 h-3.5 w-3.5" />
                  Push to Repository
                </Button>
                {testsNextAction && (
                  <Button size="sm" onClick={testsNextAction.handler}>
                    <Play className="mr-1.5 h-3.5 w-3.5" />
                    {testsNextAction.label}
                  </Button>
                )}
              </div>
            </div>
            <Tabs key={`tests-tabs-${displayStage}`} defaultValue="review">
              <TabsList className="w-auto">
                <TabsTrigger value="review">Review & Downloads</TabsTrigger>
                <TabsTrigger value="analytics">Analytics</TabsTrigger>
              </TabsList>
              <TabsContent value="review" className="space-y-4">
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      Project Deliverables
                    </CardTitle>
                    <CardDescription>
                      Download the upgraded project, generated tests, and all reports.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <Button
                      variant="default"
                      size="lg"
                      className="w-full justify-start"
                      onClick={() => handleDownload("project")}
                    >
                      <Download className="mr-2 h-5 w-5" />
                      Download Full Project (ZIP)
                    </Button>
                    <p className="text-xs text-muted-foreground -mt-2 ml-1">
                      Includes entire code repository
                      {(progressData?.modifiedFiles?.length ?? 0) > 0 ? ` with ${progressData.modifiedFiles.length} upgraded files` : ""}
                      {genTests.length > 0 ? `, ${genTests.length} generated test files` : ""}
                      , and all generated reports.
                    </p>
                    {(progressData?.modifiedFiles?.length ?? 0) > 0 && (
                      <details className="text-sm">
                        <summary className="cursor-pointer font-semibold text-muted-foreground hover:text-foreground">
                          Upgraded Files ({progressData.modifiedFiles.length})
                        </summary>
                        <ul className="text-muted-foreground list-disc list-inside space-y-1 max-h-32 overflow-y-auto mt-1">
                          {progressData.modifiedFiles.slice(0, 20).map((f: any, i: number) => (
                            <li key={i} className="font-mono truncate">{f.path || f.filePath}</li>
                          ))}
                          {progressData.modifiedFiles.length > 20 && (
                            <li>... and {progressData.modifiedFiles.length - 20} more</li>
                          )}
                        </ul>
                      </details>
                    )}
                    {genTests.length > 0 && (
                      <details className="text-sm">
                        <summary className="cursor-pointer font-semibold text-muted-foreground hover:text-foreground">
                          Generated Test Files ({genTests.length})
                        </summary>
                        <ul className="text-muted-foreground list-disc list-inside space-y-1 max-h-32 overflow-y-auto mt-1">
                          {genTests.slice(0, 20).map((t: any, i: number) => (
                            <li key={i} className="font-mono truncate">{t.filePath}</li>
                          ))}
                          {genTests.length > 20 && (
                            <li>... and {genTests.length - 20} more</li>
                          )}
                        </ul>
                      </details>
                    )}
                    <div className="flex flex-wrap gap-2 pt-2 border-t">
                      <Button variant="outline" size="sm" onClick={() => handleViewStream("Assessment Report", "assessment", "assessment")}>
                        <FileText className="h-4 w-4 mr-2" />
                        Assessment
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => handleViewStream("Upgrade Plan", "plan", "plan")}>
                        <FileText className="h-4 w-4 mr-2" />
                        Plan
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => tasksMarkdown && handleView("Execution Tasks", tasksMarkdown, "tasks")}>
                        <FileText className="h-4 w-4 mr-2" />
                        Tasks
                      </Button>
                      {progressData?.confidenceReportMarkdown && (
                        <Button variant="outline" size="sm" onClick={() => handleView("Confidence Report", progressData.confidenceReportMarkdown, "confidence-report")}>
                          <FileText className="h-4 w-4 mr-2" />
                          Confidence Report
                        </Button>
                      )}
                      {progressData?.migrationReportMarkdown && (
                        <Button variant="default" size="sm" onClick={() => handleView("Migration Report", progressData.migrationReportMarkdown, "migration-report")}>
                          <FileText className="h-4 w-4 mr-2" />
                          Migration Report
                        </Button>
                      )}
                      {progressData?.completenessReportMarkdown && (
                        <Button variant="outline" size="sm" onClick={() => handleView("Completeness Report", progressData.completenessReportMarkdown, "completeness-report")}>
                          <FileText className="h-4 w-4 mr-2" />
                          Completeness ({progressData.completenessReport?.overallScore ?? 0}%)
                        </Button>
                      )}
                      {progressData?.vendorUpdateReportMarkdown && (
                        <Button variant="outline" size="sm" onClick={() => handleView("Vendor Update Report", progressData.vendorUpdateReportMarkdown, "vendor-update-report")}>
                          <FileText className="h-4 w-4 mr-2" />
                          Vendor Updates
                        </Button>
                      )}
                      {progressData?.apiUsageImpactMarkdown && (
                        <Button variant="outline" size="sm" onClick={() => handleView("API Impact Report", progressData.apiUsageImpactMarkdown, "api-impact-report")}>
                          <FileText className="h-4 w-4 mr-2" />
                          API Impact
                        </Button>
                      )}
                      {progressData?.structuralChangesMarkdown && (
                        <Button variant="outline" size="sm" onClick={() => handleView("Structural Changes Report", progressData.structuralChangesMarkdown, "structural-changes-report")}>
                          <FileText className="h-4 w-4 mr-2" />
                          Structural Changes
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>
              <TabsContent value="analytics" className="space-y-4">
                <div className="flex justify-end">
                  <Button variant="outline" size="sm" onClick={() => handleChartsPdfDownload("tests")}>
                    <Download className="h-3.5 w-3.5 mr-1.5" />
                    Export PDF
                  </Button>
                </div>
                <TestGenerationDashboard
                  generatedTests={genTests}
                  isGenerating={false}
                />
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  <Card>
                    <CardContent className="pt-4 pb-3 px-4">
                      <p className="text-xs text-muted-foreground font-medium">Total Tests</p>
                      <p className="text-2xl font-bold mt-1">{genTests.length}</p>
                      <p className="text-xs text-muted-foreground">generated files</p>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="pt-4 pb-3 px-4">
                      <p className="text-xs text-muted-foreground font-medium">Files Covered</p>
                      <p className="text-2xl font-bold mt-1">{new Set(genTests.map((t: any) => t.sourceFile || t.filePath)).size}</p>
                      <p className="text-xs text-muted-foreground">source files</p>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="pt-4 pb-3 px-4">
                      <p className="text-xs text-muted-foreground font-medium">Frameworks</p>
                      <p className="text-2xl font-bold mt-1">{testFrameworkData.length}</p>
                      <p className="text-xs text-muted-foreground">test frameworks</p>
                    </CardContent>
                  </Card>
                </div>
                {testFrameworkData.length > 0 && (
                  <Card>
                    <CardHeader className="py-3 px-4">
                      <CardTitle className="text-sm">Tests by Framework</CardTitle>
                    </CardHeader>
                    <CardContent className="pb-3 px-4">
                      <div className="h-[220px]">
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={testFrameworkData} margin={{ left: 0, right: 20, top: 5, bottom: 5 }}>
                            <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                            <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                            <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                            <Tooltip formatter={(v: number) => [`${v} test(s)`, "Count"]} />
                            <Bar dataKey="value" name="Tests" radius={[4, 4, 0, 0]}>
                              {testFrameworkData.map((_entry, index) => (
                                <Cell key={`tf-${index}`} fill={TEST_COLORS[index % TEST_COLORS.length]} />
                              ))}
                            </Bar>
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    </CardContent>
                  </Card>
                )}
              </TabsContent>
            </Tabs>
          </div>
        );
      }

      case "validating":
        return (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                Run &amp; Validate (Code Execution)
              </CardTitle>
              <CardDescription>
                {progressData?.currentStage || statusMessage || "Preparing project, running install and tests in container…"}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Progress value={progress} className="w-full" />
              <p className="text-sm text-muted-foreground">
                Step: {progressData?.currentStage || statusMessage || "initialized"}
              </p>
            </CardContent>
          </Card>
        );

      case "complete": {
        const completeModFiles = progressData?.modifiedFiles || [];
        const completeTests = progressData?.generatedTests || [];
        const completeExecResults = progressData?.taskExecutionResults || [];
        const completeExecTasks = progressData?.upgradeTasks || [];
        const completeCompleted = completeExecResults.filter((r: any) => r.status === "completed" || r.status === "success").length;
        const completeFailed = completeExecResults.filter((r: any) => r.status === "failed" || r.status === "error").length;
        return (
          <div className="space-y-4 min-w-0 max-w-full overflow-hidden">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 rounded-lg border border-green-500/40 bg-green-50/50 dark:bg-green-950/20 p-4">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-green-500" />
                  <h3 className="font-semibold text-green-700 dark:text-green-300">Stack Modernization Complete!</h3>
                </div>
                <p className="text-sm text-green-600 dark:text-green-400 mt-1">
                  All phases completed successfully. {completeModFiles.length} file(s) upgraded, {completeTests.length} test(s) generated.
                </p>
              </div>
              <div className="flex items-center gap-2 flex-wrap shrink-0">
                {validationEnabled && (
                  <Button variant="outline" size="sm" onClick={() => setShowValidationPanel(true)}>
                    <Play className="mr-1.5 h-3.5 w-3.5" />
                    Code Execution
                  </Button>
                )}
                <Button variant="default" size="sm" onClick={() => handleDownload('upgrade')}>
                  <Download className="mr-1.5 h-3.5 w-3.5" />
                  Download Project
                </Button>
                <Button variant="ghost" size="sm" onClick={() => { setStage("upload"); setFiles([]); setAnalysisId(null); setProgress(0); setProgressData(null); }}>
                  New Analysis
                </Button>
              </div>
            </div>

            <Tabs key={`complete-tabs-${displayStage}`} defaultValue="code-changes">
              <TabsList className="w-auto">
                <TabsTrigger value="code-changes">Code Changes ({completeModFiles.length})</TabsTrigger>
                {completeTests.length > 0 && <TabsTrigger value="tests">Tests ({completeTests.length})</TabsTrigger>}
                <TabsTrigger value="statistics">Statistics</TabsTrigger>
                <TabsTrigger value="reports">Reports & Downloads</TabsTrigger>
              </TabsList>

              {/* ── Code Changes tab: same diff viewer as execution ── */}
              <TabsContent value="code-changes" className="space-y-4">
                {completeExecTasks.length > 0 && (
                  <TaskExecutionAccordion
                    tasks={completeExecTasks}
                    executionResults={completeExecResults}
                    analysisId={analysisId || undefined}
                    onRetryStarted={handleRetryStarted}
                  />
                )}
                {completeModFiles.length > 0 && (
                  <div className="w-full max-w-full min-w-0 overflow-x-auto overflow-y-hidden rounded-lg border border-border/50 bg-muted/5 p-1">
                    <CodeDiffViewer
                      modifiedFiles={completeModFiles}
                      onDownloadZip={() => handleDownload('upgrade')}
                    />
                  </div>
                )}
              </TabsContent>

              {/* ── Tests tab ── */}
              {completeTests.length > 0 && (
                <TabsContent value="tests" className="space-y-4">
                  {validationEnabled && progressData?.validationRun && (
                    <TestExecutionReportDashboard
                      validationRun={progressData.validationRun}
                      generatedTests={progressData.generatedTests}
                    />
                  )}
                  <Card>
                    <CardHeader className="py-3 px-4">
                      <div className="flex items-center justify-between">
                        <CardTitle className="flex items-center gap-2 text-base">
                          <TestTube2 className="h-4 w-4 text-green-500" />
                          Generated Unit Tests ({completeTests.length})
                        </CardTitle>
                        <Button variant="outline" size="sm" onClick={() => handleDownload('tests')}>
                          <Download className="h-3.5 w-3.5 mr-1.5" />
                          Download Tests
                        </Button>
                      </div>
                    </CardHeader>
                    <CardContent className="px-4 pb-4">
                      <ScrollArea className="h-[400px]">
                        <div className="space-y-3">
                          {completeTests.map((test: any, idx: number) => (
                            <div key={idx} className="border rounded-lg p-3">
                              <div className="flex items-center justify-between mb-1.5">
                                <div className="flex items-center gap-2 min-w-0">
                                  <FileCode2 className="h-3.5 w-3.5 flex-shrink-0" />
                                  <span className="font-mono text-xs font-medium truncate">{test.filePath}</span>
                                </div>
                                <Badge variant="outline" className="text-[10px]">{test.testFramework}</Badge>
                              </div>
                              <div className="text-[11px] text-muted-foreground mb-1.5">
                                {test.testCases?.length || 0} test cases &bull; Coverage: {test.coverageTarget?.length || 0} functions
                              </div>
                              <details>
                                <summary className="cursor-pointer text-xs font-medium hover:text-primary">View Test Code</summary>
                                <pre className="mt-1.5 p-2.5 bg-muted rounded text-[11px] font-mono overflow-x-auto max-h-[250px] overflow-y-auto">{test.testCode}</pre>
                              </details>
                            </div>
                          ))}
                        </div>
                      </ScrollArea>
                    </CardContent>
                  </Card>
                </TabsContent>
              )}

              {/* ── Statistics tab ── */}
              <TabsContent value="statistics" className="space-y-4">
                <div className="flex justify-end">
                  <Button variant="outline" size="sm" onClick={() => handleChartsPdfDownload("execution")}>
                    <Download className="h-3.5 w-3.5 mr-1.5" />
                    Export PDF
                  </Button>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <Card><CardContent className="pt-4 pb-3 px-4"><p className="text-xs text-muted-foreground font-medium">Total Tasks</p><p className="text-2xl font-bold mt-1">{completeExecTasks.length}</p></CardContent></Card>
                  <Card><CardContent className="pt-4 pb-3 px-4"><p className="text-xs text-muted-foreground font-medium">Completed</p><p className="text-2xl font-bold mt-1 text-green-600">{completeCompleted}</p></CardContent></Card>
                  <Card><CardContent className="pt-4 pb-3 px-4"><p className="text-xs text-muted-foreground font-medium">Failed</p><p className="text-2xl font-bold mt-1 text-rose-600">{completeFailed}</p></CardContent></Card>
                  <Card><CardContent className="pt-4 pb-3 px-4"><p className="text-xs text-muted-foreground font-medium">Files Modified</p><p className="text-2xl font-bold mt-1">{completeModFiles.length}</p></CardContent></Card>
                </div>
                {(progressData?.completenessReport || progressData?.removedObsoletePackages?.length || progressData?.newLibrariesAdded?.length || progressData?.bundleDetections?.length) && (
                  <Card>
                    <CardContent className="pt-4 pb-3 px-4 space-y-3">
                      {progressData?.completenessReport && (
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-medium">Completeness Score</span>
                          <span className="text-lg font-bold">{progressData.completenessReport.overallScore ?? 0}%</span>
                        </div>
                      )}
                      {progressData?.removedObsoletePackages?.length > 0 && (
                        <div><span className="text-xs text-muted-foreground">Obsolete packages removed:</span><p className="text-sm">{progressData.removedObsoletePackages.join(", ")}</p></div>
                      )}
                      {progressData?.newLibrariesAdded?.length > 0 && (
                        <div><span className="text-xs text-muted-foreground">New libraries wired:</span><p className="text-sm">{progressData.newLibrariesAdded.join(", ")}</p></div>
                      )}
                    </CardContent>
                  </Card>
                )}
              </TabsContent>

              {/* ── Reports & Downloads tab ── */}
              <TabsContent value="reports" className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <Button variant="outline" onClick={() => handleViewStream("Assessment Report", "assessment", "assessment")} className="justify-start h-auto py-2.5">
                    <FileText className="mr-2 h-4 w-4 shrink-0" /><div className="text-left"><div className="text-sm font-medium">Assessment Report</div><div className="text-[10px] text-muted-foreground">Initial code analysis</div></div>
                  </Button>
                  <Button variant="outline" onClick={() => handleViewStream("Upgrade Plan", "plan", "plan")} className="justify-start h-auto py-2.5">
                    <FileText className="mr-2 h-4 w-4 shrink-0" /><div className="text-left"><div className="text-sm font-medium">Upgrade Plan</div><div className="text-[10px] text-muted-foreground">Migration strategy</div></div>
                  </Button>
                  <Button variant="outline" onClick={() => handleView("Execution Tasks", tasksMarkdown, "tasks")} className="justify-start h-auto py-2.5">
                    <FileText className="mr-2 h-4 w-4 shrink-0" /><div className="text-left"><div className="text-sm font-medium">Execution Tasks</div><div className="text-[10px] text-muted-foreground">{completeExecTasks.length} tasks</div></div>
                  </Button>
                  <Button variant="outline" onClick={() => handleView("Test Results", testResultsMarkdown, "test-results")} className="justify-start h-auto py-2.5">
                    <FileText className="mr-2 h-4 w-4 shrink-0" /><div className="text-left"><div className="text-sm font-medium">Test Results</div><div className="text-[10px] text-muted-foreground">{completeTests.length} tests</div></div>
                  </Button>
                  {progressData?.confidenceReportMarkdown && (
                    <Button variant="outline" onClick={() => handleView("Confidence Report", progressData.confidenceReportMarkdown, "confidence-report")} className="justify-start h-auto py-2.5">
                      <FileText className="mr-2 h-4 w-4 shrink-0" /><div className="text-left"><div className="text-sm font-medium">Confidence Report</div><div className="text-[10px] text-muted-foreground">Production readiness</div></div>
                    </Button>
                  )}
                  {progressData?.migrationReportMarkdown && (
                    <Button variant="outline" onClick={() => handleView("Migration Report", progressData.migrationReportMarkdown, "migration-report")} className="justify-start h-auto py-2.5">
                      <FileText className="mr-2 h-4 w-4 shrink-0" /><div className="text-left"><div className="text-sm font-medium">Migration Report</div><div className="text-[10px] text-muted-foreground">Manual steps & handover</div></div>
                    </Button>
                  )}
                  {progressData?.completenessReportMarkdown && (
                    <Button variant="outline" onClick={() => handleView("Completeness Report", progressData.completenessReportMarkdown, "completeness-report")} className="justify-start h-auto py-2.5">
                      <FileText className="mr-2 h-4 w-4 shrink-0" /><div className="text-left"><div className="text-sm font-medium">Completeness Report</div><div className="text-[10px] text-muted-foreground">Score: {progressData.completenessReport?.overallScore ?? 0}%</div></div>
                    </Button>
                  )}
                  {progressData?.vendorUpdateReportMarkdown && (
                    <Button variant="outline" onClick={() => handleView("Vendor Update Report", progressData.vendorUpdateReportMarkdown, "vendor-update-report")} className="justify-start h-auto py-2.5">
                      <FileText className="mr-2 h-4 w-4 shrink-0" /><div className="text-left"><div className="text-sm font-medium">Vendor Updates</div><div className="text-[10px] text-muted-foreground">Library downloads & changes</div></div>
                    </Button>
                  )}
                  {progressData?.apiUsageImpactMarkdown && (
                    <Button variant="outline" onClick={() => handleView("API Impact Report", progressData.apiUsageImpactMarkdown, "api-impact-report")} className="justify-start h-auto py-2.5">
                      <FileText className="mr-2 h-4 w-4 shrink-0" /><div className="text-left"><div className="text-sm font-medium">API Impact</div><div className="text-[10px] text-muted-foreground">Breaking changes</div></div>
                    </Button>
                  )}
                  {progressData?.structuralChangesMarkdown && (
                    <Button variant="outline" onClick={() => handleView("Structural Changes Report", progressData.structuralChangesMarkdown, "structural-changes-report")} className="justify-start h-auto py-2.5">
                      <FileText className="mr-2 h-4 w-4 shrink-0" /><div className="text-left"><div className="text-sm font-medium">Structural Changes</div><div className="text-[10px] text-muted-foreground">File additions & removals</div></div>
                    </Button>
                  )}
                </div>

                <div className="border-t border-border pt-4 space-y-3">
                  <Button variant="default" onClick={() => handleDownload('upgrade')} className="w-full justify-start" size="lg">
                    <Download className="mr-2 h-5 w-5" />
                    Download Complete Project (ZIP)
                  </Button>
                  <p className="text-xs text-muted-foreground">
                    Full repo with {completeModFiles.length} upgraded files merged in. Extract and run directly.
                  </p>
                </div>
              </TabsContent>
            </Tabs>
          </div>
        );
      }

      case "failed":
        return (
          <Card className="border-destructive/50">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-destructive">
                <AlertTriangle className="h-5 w-5" />
                Upgrade Failed
              </CardTitle>
              <CardDescription>
                The process encountered an error during the <strong>{failedAtStage || "processing"}</strong> stage.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>Error Details</AlertTitle>
                <AlertDescription className="mt-2 whitespace-pre-wrap font-mono text-xs overflow-x-auto max-w-full">
                  {failureMessage || "An unknown error occurred. Please try again."}
                </AlertDescription>
              </Alert>
              
              <div className="flex gap-3">
                <Button 
                  onClick={() => {
                    setStage("upload");
                    setFailureMessage("");
                    setFailedAtStage("");
                    setIsProcessing(false);
                    setProgress(0);
                    setAnalysisId(null);
                  }}
                  variant="outline"
                >
                  Start Over
                </Button>
                {failedAtStage === "executing" && analysisId && (
                  <Button onClick={handleExecuteTasks}>
                    <Play className="h-4 w-4 mr-2" />
                    Retry Code Upgrade
                  </Button>
                )}
                {failedAtStage === "task_planning" && analysisId && (
                  <Button onClick={handleGenerateTasks}>
                    <Play className="h-4 w-4 mr-2" />
                    Retry Task Generation
                  </Button>
                )}
                {failedAtStage === "planning" && analysisId && (
                  <Button onClick={handleProceedToPlanning}>
                    <Play className="h-4 w-4 mr-2" />
                    Retry Planning
                  </Button>
                )}
                {failedAtStage === "generating_tests" && analysisId && (
                  <Button onClick={handleGenerateTests}>
                    <Play className="h-4 w-4 mr-2" />
                    Retry Test Generation
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        );

      default:
        return null;
    }
  };

  const renderContentWithFallback = () => {
    const content = renderContent();
    if (content) return content;
    if (viewStage && viewStage !== stage) {
      return (
        <Card>
          <CardContent className="py-12 text-center">
            <AlertTriangle className="h-8 w-8 mx-auto text-muted-foreground/50 mb-3" />
            <p className="text-muted-foreground font-medium">No data available for this phase</p>
            <p className="text-sm text-muted-foreground mt-1">This phase may not have been reached yet, or its data was not persisted.</p>
            <Button variant="outline" size="sm" className="mt-4" onClick={() => setViewStage(null)}>
              Back to current step
            </Button>
          </CardContent>
        </Card>
      );
    }
    return null;
  };

  // Stage progress indicators with ACTIVE state highlighting and FAILURE support
  const isFailed = stage === "failed";
  const stageMapping: Record<string, string> = {
    "assessing": "Assessment",
    "planning": "Planning",
    "task_planning": "Tasks",
    "executing": "Execution",
    "generating_tests": "Tests",
    "validating": "Validation"
  };
  const failedStageLabel = isFailed ? stageMapping[failedAtStage] || "" : "";
  
  // Map workflow bar labels to the "completed" view stage to show when clicked
  const stageViewMap: Record<string, WorkflowStage> = {
    Upload: "upload",
    Assessment: "assessment_complete",
    Planning: "plan_complete",
    Packages: "packages_complete",
    Tasks: "tasks_ready",
    Execution: "execution_complete",
    Tests: "tests_generated",
    Validation: "complete",
  };

  const phaseToLabel: Record<SelectablePhase, string> = {
    assessment: "Assessment",
    planning: "Planning",
    packages: "Packages",
    tasks: "Tasks",
    execution: "Execution",
    tests: "Tests",
    validation: "Validation",
  };

  const stages = [
    {
      id: 1,
      label: "Upload",
      completed: ["assessing", "assessment_complete", "planning", "plan_complete", "downloading_packages", "packages_complete", "task_planning", "tasks_ready", "executing", "execution_complete", "generating_tests", "tests_generated", "validating", "complete"].includes(stage) || (isFailed && failedAtStage !== "upload"),
      active: stage === "upload",
      failed: isFailed && failedAtStage === "upload"
    },
    {
      id: 2,
      label: "Assessment",
      completed: ["assessment_complete", "planning", "plan_complete", "downloading_packages", "packages_complete", "task_planning", "tasks_ready", "executing", "execution_complete", "generating_tests", "tests_generated", "validating", "complete"].includes(stage) || (isFailed && ["planning", "downloading_packages", "task_planning", "executing", "generating_tests", "validating"].includes(failedAtStage)),
      active: stage === "assessing",
      failed: isFailed && failedAtStage === "assessing"
    },
    {
      id: 3,
      label: "Planning",
      completed: ["plan_complete", "downloading_packages", "packages_complete", "task_planning", "tasks_ready", "executing", "execution_complete", "generating_tests", "tests_generated", "validating", "complete"].includes(stage) || (isFailed && ["downloading_packages", "task_planning", "executing", "generating_tests", "validating"].includes(failedAtStage)),
      active: stage === "planning",
      failed: isFailed && failedAtStage === "planning"
    },
    {
      id: 4,
      label: "Packages",
      completed: ["packages_complete", "task_planning", "tasks_ready", "executing", "execution_complete", "generating_tests", "tests_generated", "validating", "complete"].includes(stage) || (isFailed && ["task_planning", "executing", "generating_tests", "validating"].includes(failedAtStage)),
      active: stage === "downloading_packages",
      failed: isFailed && failedAtStage === "downloading_packages"
    },
    {
      id: 5,
      label: "Tasks",
      completed: ["tasks_ready", "executing", "execution_complete", "generating_tests", "tests_generated", "validating", "complete"].includes(stage) || (isFailed && ["executing", "generating_tests", "validating"].includes(failedAtStage)),
      active: stage === "task_planning",
      failed: isFailed && failedAtStage === "task_planning"
    },
    {
      id: 6,
      label: "Execution",
      completed: ["execution_complete", "generating_tests", "tests_generated", "validating", "complete"].includes(stage) || (isFailed && ["generating_tests", "validating"].includes(failedAtStage)),
      active: stage === "executing",
      failed: isFailed && failedAtStage === "executing"
    },
    {
      id: 7,
      label: "Tests",
      completed: ["tests_generated", "validating", "complete"].includes(stage),
      active: stage === "generating_tests" || stage === "tests_generated",
      failed: isFailed && failedAtStage === "generating_tests"
    },
    {
      id: 8,
      label: "Validation",
      completed: ["complete"].includes(stage),
      active: stage === "validating",
      failed: isFailed && failedAtStage === "validating"
    },
  ];

  const filteredStages = stages.filter(s => {
    if (s.label === "Upload") return true;
    if (s.label === "Validation" && !validationEnabled) return false;
    const phaseEntry = Object.entries(phaseToLabel).find(([, label]) => label === s.label);
    if (!phaseEntry) return true;
    return selectedPhases.has(phaseEntry[0] as SelectablePhase);
  });

  return (
    <div className="flex-1 space-y-6 p-6 w-full max-w-full min-w-0 overflow-x-hidden">
      {/* Page Header */}
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-100 dark:bg-violet-950">
          <Sparkles className="h-5 w-5 text-violet-600 dark:text-violet-400" />
        </div>
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Stack Modernization</h1>
          <p className="text-xs text-muted-foreground">AI-powered code upgrade with comprehensive analysis</p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {progressData?.tokenUsage && progressData.tokenUsage.totalLLMCalls > 0 && (
            <button
              onClick={() => setShowMetricsModal(true)}
              className="flex items-center gap-2 text-xs text-muted-foreground bg-amber-50 dark:bg-amber-950/30 rounded-lg px-3 py-1.5 border border-amber-200 dark:border-amber-800 hover:bg-amber-100 dark:hover:bg-amber-950/50 transition-colors cursor-pointer"
            >
              <Zap className="h-3.5 w-3.5 text-amber-500" />
              <span className="font-semibold text-amber-700 dark:text-amber-400">{formatTokens(progressData.tokenUsage.totalTokens)}</span>
              <span className="text-muted-foreground">tokens</span>
              <span className="text-muted-foreground/50">|</span>
              <span className="font-semibold text-foreground">{formatDuration(progressData.tokenUsage.totalDurationMs)}</span>
            </button>
          )}
          {adoOrg && adoProjectName && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground bg-muted/50 rounded-lg px-3 py-1.5 border">
              <Building2 className="h-3.5 w-3.5" />
              <span className="font-medium">{adoOrg}</span>
              <span>/</span>
              <FolderGit2 className="h-3.5 w-3.5" />
              <span className="font-medium">{adoProjectName}</span>
            </div>
          )}
        </div>
      </div>

      {/* Progress Indicators — steps distribute evenly across full width when few are selected */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center w-full min-w-0">
            <div className="flex items-center flex-1 min-w-0 w-full gap-0">
              {filteredStages.map((s, idx) => {
                const isClickable = (s.completed || s.active) && !s.failed;
                // Show "viewing" highlight only when looking at a DIFFERENT phase
                const isViewing = viewStage !== null && stageViewMap[s.label] === viewStage && !s.active;
                const isLast = idx === filteredStages.length - 1;
                const connectorColor = s.failed ? "bg-red-400 dark:bg-red-500" : s.completed ? "bg-green-500 dark:bg-green-400" : "bg-border";

                // When clicking a phase that is currently active (running) or whose
                // mapped viewStage matches the current real stage, clear viewStage
                // to navigate back to the live/current view.
                const targetViewStage = stageViewMap[s.label];
                const isCurrentPhase = s.active || targetViewStage === stage;
                const handleStepClick = () => {
                  if (isCurrentPhase) {
                    // Clicking the current running/waiting phase → go back to live view
                    setViewStage(null);
                  } else {
                    setViewStage(targetViewStage);
                  }
                };

                return (
                  <div key={s.id} className={`flex items-center ${isLast ? "flex-initial" : "flex-1 min-w-0"}`}>
                    <div
                      role={isClickable ? "button" : undefined}
                      tabIndex={isClickable ? 0 : undefined}
                      onClick={isClickable ? handleStepClick : undefined}
                      onKeyDown={isClickable ? (e) => { if (e.key === "Enter") handleStepClick(); } : undefined}
                      className={`
                        flex flex-col items-center gap-0.5 px-4 py-2 rounded-lg transition-all duration-200 flex-shrink-0
                        ${isClickable ? "cursor-pointer hover:ring-2 hover:ring-blue-400/50" : "cursor-default"}
                        ${isViewing
                          ? "ring-2 ring-blue-500 bg-blue-500/10 dark:bg-blue-500/20"
                          : s.failed
                            ? "bg-red-500/15 dark:bg-red-500/25 ring-1 ring-red-500/30"
                            : s.completed
                              ? "bg-green-500/10 dark:bg-green-500/20"
                              : s.active
                                ? "bg-blue-500 dark:bg-blue-600 text-white shadow-lg"
                                : "bg-muted/30"
                        }
                      `}
                    >
                      <div className="flex items-center gap-2">
                        {s.failed ? (
                          <AlertTriangle className="h-4 w-4 text-red-600 dark:text-red-400 shrink-0" />
                        ) : s.completed ? (
                          <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400 shrink-0" />
                        ) : s.active ? (
                          <div className="h-4 w-4 rounded-full bg-white/90 dark:bg-white/20 shrink-0" />
                        ) : (
                          <div className="h-4 w-4 rounded-full border-2 border-muted-foreground shrink-0" />
                        )}
                        <span className={`text-sm font-medium truncate ${
                          isViewing
                            ? "text-blue-700 dark:text-blue-300"
                            : s.failed
                              ? "text-red-700 dark:text-red-300"
                              : s.completed
                                ? "text-green-700 dark:text-green-300"
                                : s.active
                                  ? "text-white"
                                  : "text-muted-foreground"
                        }`}>
                          {s.label}
                        </span>
                      </div>
                      {(() => {
                        const phaseKey = PHASE_KEY_MAP[s.label];
                        const pm = phaseKey && progressData?.tokenUsage?.phases?.[phaseKey];
                        if (!pm || pm.llmCalls === 0) return null;
                        const metricColor = isViewing
                          ? "text-blue-600 dark:text-blue-400"
                          : s.failed
                            ? "text-red-600 dark:text-red-400"
                            : s.completed
                              ? "text-green-600 dark:text-green-400"
                              : s.active
                                ? "text-white/90"
                                : "text-muted-foreground";
                        return (
                          <div className={`mt-1.5 flex flex-col items-center gap-0 whitespace-nowrap ${metricColor}`}>
                            <span className="text-[11px] font-semibold leading-tight">{formatDuration(pm.durationMs)}</span>
                            <span className="text-[10px] font-medium leading-tight opacity-80">{formatTokens(pm.totalTokens)} tokens</span>
                          </div>
                        );
                      })()}
                    </div>
                    {!isLast && (
                      <div className={`h-px flex-1 min-w-8 mx-1 sm:mx-2 transition-colors ${connectorColor}`} aria-hidden />
                    )}
                  </div>
                );
              })}
            </div>
          </div>
          {(() => {
            // Map each workflow stage to the phase it belongs to, so we can detect
            // when viewStage and stage are different variants of the same phase.
            const stageToPhase: Record<string, string> = {
              upload: "Upload",
              assessing: "Assessment", assessment_complete: "Assessment",
              planning: "Planning", plan_complete: "Planning",
              task_planning: "Tasks", tasks_ready: "Tasks",
              executing: "Execution", execution_complete: "Execution",
              generating_tests: "Tests", tests_generated: "Tests",
              validating: "Validation", complete: "Validation",
              failed: "failed",
            };
            const viewingDifferentPhase = viewStage !== null &&
              viewStage !== stage &&
              stageToPhase[viewStage] !== stageToPhase[stage];
            return viewingDifferentPhase;
          })() && (
            <div className="mt-3 flex items-center gap-2 flex-wrap">
              <Badge variant="outline" className="text-xs text-blue-600 dark:text-blue-400 border-blue-300">
                Viewing: {Object.entries(stageViewMap).find(([, v]) => v === viewStage)?.[0] ?? viewStage}
              </Badge>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setViewStage(null)}
                className="text-xs"
              >
                Back to current step
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Pipeline Metrics Modal */}
      <Dialog open={showMetricsModal} onOpenChange={setShowMetricsModal}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Zap className="h-5 w-5 text-amber-500" />
              Pipeline Metrics
            </DialogTitle>
            <DialogDescription>Token usage and duration breakdown for this upgrade session.</DialogDescription>
          </DialogHeader>
          {progressData?.tokenUsage && (
            <div className="space-y-5">
              {/* Summary stat boxes */}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                <div className="bg-muted/40 rounded-xl p-3 text-center">
                  <div className="text-lg font-bold text-foreground">{formatDuration(progressData.tokenUsage.totalDurationMs)}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">Total Time</div>
                </div>
                <div className="bg-muted/40 rounded-xl p-3 text-center">
                  <div className="text-lg font-bold text-foreground">{formatTokens(progressData.tokenUsage.totalTokens)}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    Tokens ({formatTokens(progressData.tokenUsage.totalInputTokens)} in / {formatTokens(progressData.tokenUsage.totalOutputTokens)} out)
                  </div>
                </div>
                <div className="bg-muted/40 rounded-xl p-3 text-center">
                  <div className="text-lg font-bold text-foreground">{progressData.tokenUsage.totalLLMCalls}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">LLM Calls</div>
                </div>
              </div>

              {/* Per-phase breakdown */}
              {Object.keys(progressData.tokenUsage.phases).length > 0 && (
                <div>
                  <h4 className="text-sm font-semibold text-foreground mb-2">Per-Phase Breakdown</h4>
                  <div className="rounded-lg border border-border/40 overflow-hidden">
                    <div className="grid grid-cols-5 gap-3 text-xs font-semibold text-muted-foreground bg-muted/30 px-3 py-2">
                      <span>Phase</span>
                      <span className="text-right">Duration</span>
                      <span className="text-right">LLM Calls</span>
                      <span className="text-right">Input</span>
                      <span className="text-right">Output</span>
                    </div>
                    {Object.values(progressData.tokenUsage.phases)
                      .filter((pm: any) => pm.llmCalls > 0)
                      .map((pm: any) => (
                        <div key={pm.phase} className="grid grid-cols-5 gap-3 text-sm py-2 border-t border-border/10 px-3">
                          <span className="capitalize font-medium text-foreground">{pm.phase}</span>
                          <span className="text-right text-muted-foreground">{formatDuration(pm.durationMs)}</span>
                          <span className="text-right text-muted-foreground">{pm.llmCalls}</span>
                          <span className="text-right text-muted-foreground">{formatTokens(pm.inputTokens)}</span>
                          <span className="text-right text-muted-foreground">{formatTokens(pm.outputTokens)}</span>
                        </div>
                      ))
                    }
                  </div>
                </div>
              )}

              {/* Per-agent breakdown */}
              {progressData.tokenUsage.agents && Object.keys(progressData.tokenUsage.agents).length > 0 && (
                <div>
                  <h4 className="text-sm font-semibold text-foreground mb-2">Per-Agent Breakdown</h4>
                  <div className="rounded-lg border border-border/40 overflow-hidden">
                    <div className="grid grid-cols-6 gap-2 text-xs font-semibold text-muted-foreground bg-muted/30 px-3 py-2">
                      <span>Agent</span>
                      <span>Phase</span>
                      <span className="text-right">Duration</span>
                      <span className="text-right">Calls</span>
                      <span className="text-right">Input</span>
                      <span className="text-right">Output</span>
                    </div>
                    {Object.values(progressData.tokenUsage.agents)
                      .sort((a: any, b: any) => b.totalTokens - a.totalTokens)
                      .map((am: any) => (
                        <div key={`${am.phase}/${am.agent}`} className="grid grid-cols-6 gap-2 text-xs py-1.5 border-t border-border/10 px-3">
                          <span className="font-medium text-foreground truncate" title={am.agent}>{am.agent}</span>
                          <span className="capitalize text-muted-foreground">{am.phase}</span>
                          <span className="text-right text-muted-foreground">{formatDuration(am.durationMs)}</span>
                          <span className="text-right text-muted-foreground">{am.llmCalls}</span>
                          <span className="text-right text-muted-foreground">{formatTokens(am.inputTokens)}</span>
                          <span className="text-right text-muted-foreground">{formatTokens(am.outputTokens)}</span>
                        </div>
                      ))
                    }
                  </div>
                </div>
              )}

              <div className="flex justify-end pt-3 border-t border-border/20">
                <Button variant="outline" size="sm" onClick={() => handleChartsPdfDownload("all")}>
                  <Download className="h-3.5 w-3.5 mr-1.5" />
                  Export Full Report (PDF)
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Main Content: constrain to viewport; only this area scrolls horizontally when content is wide */}
      <div className="w-full min-w-0 max-w-full overflow-x-auto overflow-y-visible flex-1">
      {validationEnabled && (stage === "validating" || (stage === "complete" && showValidationPanel)) ? (
        <StackModIDELayout
          analysisId={analysisId ?? undefined}
          progressData={progressData}
          stage={stage}
          onClose={() => setShowValidationPanel(false)}
          onRunValidation={handleRunValidation}
          onRefresh={refreshProgress}
        />
      ) : ["executing", "execution_complete", "generating_tests", "tests_generated", "complete"].includes(stage) ? (
        <div className="flex gap-4 items-start w-full min-w-0 max-w-full overflow-hidden">
          <div className="flex-1 min-w-0 w-0 overflow-x-auto overflow-y-visible">{renderContentWithFallback()}</div>
          <UpdatedFilesPanel
            modifiedFiles={progressData?.modifiedFiles ?? []}
            generatedTests={progressData?.generatedTests ?? []}
            migrationReportMarkdown={progressData?.migrationReportMarkdown}
            onDownloadZip={() => handleDownload("upgrade")}
            open={filesPanelOpen}
            onOpenChange={setFilesPanelOpen}
          />
        </div>
      ) : (
        renderContentWithFallback()
      )}
      </div>

      {/* Markdown Viewer Modal */}
      <MarkdownViewer
        open={viewerOpen}
        onClose={() => setViewerOpen(false)}
        title={viewerTitle}
        content={viewerContent}
        onDownload={viewerDownloadType ? () => handleDownload(viewerDownloadType) : undefined}
        streamConfig={viewerStreamConfig ?? undefined}
      />

      {/* Publish to ADO Modal */}
      {analysisId && (
        <PublishModal
          open={publishModalOpen}
          onClose={() => setPublishModalOpen(false)}
          analysisId={analysisId}
          adoOrg={adoOrg}
          adoOrgUrl={adoOrgUrl}
          adoProjectName={adoProjectName}
          adoProjectId={adoProjectId}
          uploadedRepoName={
            inputMethod === "git" && repoUrl.trim()
              ? (() => {
                  try {
                    const u = new URL(repoUrl.trim());
                    const seg = u.pathname.replace(/\/$/, "").split("/").pop() || "";
                    return seg.replace(/\.git$/i, "") || "repo";
                  } catch {
                    return "repo";
                  }
                })()
              : (files?.[0]?.name?.replace(/\.(zip|tar\.gz|tgz)$/i, "") || "")
          }
        />
      )}
    </div>
  );
}
