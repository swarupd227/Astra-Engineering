import { useState, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { pollQeJiraPushJob } from "@/lib/poll-qe-jira-push";
import { CoverageIntelligenceDashboard } from "@/components/coverage-intelligence-dashboard";
import { useBranding } from "@/contexts/BrandingContext";
import { useProject } from "@/contexts/ProjectContext";
import { DashboardHeader } from "@/components/dashboard/header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { AgenticProgress } from "@/components/agentic-progress";
import { PushToPlatform } from "@/components/push-to-platform";
import type { Project } from "@shared/qe-schema";
import { 
  Loader2, 
  PanelLeftClose, 
  PanelLeft, 
  Plus,
  FileText,
  ChevronDown,
  ChevronUp,
  Sparkles,
  FolderOpen,
  Calendar,
  ArrowLeft,
  Trash2,
  Download,
  Save,
  Pencil,
  X,
  Brain,
  CloudUpload,
  ExternalLink,
  RefreshCw,
  Cloud,
  FileSpreadsheet,
  FileType,
  Code2,
  FilePlus2,
  FileUp,
  XCircle
} from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Check, ChevronsUpDown, Search, CheckCircle2, AlertCircle, TrendingUp, ShieldCheck } from "lucide-react";
import { idbGet, idbSet, idbRemove } from "@/lib/idb-storage";
import { safeGetItem, safeRemoveItem } from "@/lib/safe-storage";

interface Sprint {
  id: string;
  name: string;
  projectId: string;
  description?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  createdAt: string;
}

interface SprintUserStory {
  id: string;
  sprintId: string;
  title: string;
  description?: string | null;
  acceptanceCriteria?: string | null;
  createdAt: string;
}

interface TestCase {
  id: string;
  title: string;
  description?: string;
  objective?: string;
  category: "functional" | "negative" | "edge_case" | "security" | "accessibility";
  priority: "P0" | "P1" | "P2" | "P3";
  preconditions?: string[];
  steps: Array<{ step_number: number; action: string; expected_behavior?: string }>;
  expectedResult?: string;
  postconditions?: string[];
  playwrightScript?: string;
}

const DEMO_USER_ID = "demo-user-1";
const DOMAINS = ["Insurance", "Healthcare", "Finance", "Retail", "E-Commerce", "Technology", "Other"];

// ADO types
interface AdoProject {
  id: string;
  name: string;
  description: string;
}

interface AdoIteration {
  id: string;
  name: string;
  path: string;
  startDate?: string;
  finishDate?: string;
  timeFrame?: string;
}

interface AdoUserStory {
  id: number;
  title: string;
  description: string;
  state: string;
  acceptanceCriteria: string;
}

// Jira types
interface JiraProject {
  id: string;
  key: string;
  name: string;
  avatarUrl: string;
}

interface JiraBoard {
  id: number;
  name: string;
  type: string;
}

interface JiraSprint {
  id: number;
  name: string;
  state: string;
  startDate?: string;
  endDate?: string;
  goal?: string;
}

interface JiraUserStory {
  id: string;
  title: string;
  description: string;
  state: string;
  acceptanceCriteria: string;
  priority: string;
  assignee: string;
  storyPoints?: number | null;
  issueType?: string;
}

type StorySource = 'ado' | 'jira' | 'local';

function TraceabilityPanel({ report }: { report: any }) {
  const [expanded, setExpanded] = useState(false);
  if (!report) return null;

  const { requirements = [], totalRequirements, coveredCount, uncoveredCount, coveragePercentage, confidenceScore, summary } = report;
  const coverageColor = coveragePercentage >= 90 ? "text-green-400" : coveragePercentage >= 70 ? "text-yellow-400" : "text-red-400";
  const coverageBg = coveragePercentage >= 90 ? "bg-green-500/10 border-green-500/30" : coveragePercentage >= 70 ? "bg-yellow-500/10 border-yellow-500/30" : "bg-red-500/10 border-red-500/30";

  return (
    <Card className="p-5" data-testid="traceability-panel">
      <div className="flex items-center justify-between flex-wrap gap-2 mb-4">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-blue-400" />
          <h3 className="font-semibold">Requirement Traceability Matrix</h3>
          <Badge variant="outline" className="text-xs">QA Refiner Agent</Badge>
        </div>
        <Button variant="ghost" size="sm" onClick={() => setExpanded(e => !e)} data-testid="button-toggle-traceability">
          {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          {expanded ? "Collapse" : "Expand"}
        </Button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <div className={`rounded-md border p-3 text-center ${coverageBg}`}>
          <div className={`text-2xl font-bold ${coverageColor}`}>{coveragePercentage}%</div>
          <div className="text-xs text-muted-foreground mt-1">Requirements Covered</div>
        </div>
        <div className="rounded-md border bg-card p-3 text-center">
          <div className="text-2xl font-bold text-foreground">{totalRequirements}</div>
          <div className="text-xs text-muted-foreground mt-1">Total Requirements</div>
        </div>
        <div className="rounded-md border bg-green-500/10 border-green-500/30 p-3 text-center">
          <div className="text-2xl font-bold text-green-400">{coveredCount}</div>
          <div className="text-xs text-muted-foreground mt-1">Covered</div>
        </div>
        <div className={`rounded-md border p-3 text-center ${uncoveredCount > 0 ? "bg-red-500/10 border-red-500/30" : "bg-card"}`}>
          <div className={`text-2xl font-bold ${uncoveredCount > 0 ? "text-red-400" : "text-muted-foreground"}`}>{uncoveredCount}</div>
          <div className="text-xs text-muted-foreground mt-1">Uncovered</div>
        </div>
      </div>

      <div className="flex items-center gap-3 mb-3">
        <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${coveragePercentage >= 90 ? "bg-green-500" : coveragePercentage >= 70 ? "bg-yellow-500" : "bg-red-500"}`}
            style={{ width: `${coveragePercentage}%` }}
          />
        </div>
        <div className="flex items-center gap-1.5 text-sm">
          <TrendingUp className="h-4 w-4 text-blue-400" />
          <span className="text-muted-foreground">Confidence:</span>
          <span className="font-semibold">{confidenceScore}%</span>
        </div>
      </div>

      {summary && (
        <p className="text-sm text-muted-foreground italic mb-3">{summary}</p>
      )}

      {expanded && requirements.length > 0 && (
        <div className="space-y-2 mt-3 border-t pt-3">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">Requirement Details</p>
          {requirements.map((req: any, idx: number) => (
            <div key={idx} className={`rounded-md p-3 border ${req.isCovered ? "bg-green-500/5 border-green-500/20" : "bg-red-500/5 border-red-500/20"}`} data-testid={`traceability-req-${idx}`}>
              <div className="flex items-start gap-2">
                {req.isCovered
                  ? <CheckCircle2 className="h-4 w-4 text-green-400 mt-0.5 shrink-0" />
                  : <AlertCircle className="h-4 w-4 text-red-400 mt-0.5 shrink-0" />
                }
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-mono text-muted-foreground">{req.id}</span>
                    <Badge variant="outline" className="text-xs capitalize">{(req.source || "").replace("_", " ")}</Badge>
                    {!req.isCovered && <Badge variant="outline" className="text-xs text-red-400 border-red-400/40">Not covered</Badge>}
                  </div>
                  <p className="text-sm mt-1 leading-snug">{req.text}</p>
                  {req.isCovered && req.coveredBy?.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1.5">
                      {req.coveredBy.map((tcId: string) => (
                        <span key={tcId} className="text-xs px-1.5 py-0.5 rounded bg-green-500/20 text-green-300 font-mono">{tcId}</span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

interface TCFile { name: string; content: string; type: string; }

export default function SprintAgentV2() {
  const { toast } = useToast();
  const { brand } = useBranding();
  const [, setLocation] = useLocation();
  const { selectedProjectId: ctxProjectId, devxContext, isFromDevx } = useProject();
  
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(ctxProjectId);
  const [selectedSprintId, setSelectedSprintId] = useState<string | null>(null);
  const [selectedUserStoryId, setSelectedUserStoryId] = useState<string | null>(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(true);
  const [selectedTab, setSelectedTab] = useState("all");
  const [isGenerating, setIsGenerating] = useState(false);
  // Test cases are persisted in IndexedDB (localStorage is capped at ~5 MB and
  // throws `QuotaExceededError` synchronously once large generations finish,
  // which previously crashed the page via ErrorBoundary). We hydrate
  // asynchronously and one-time migrate any pre-existing localStorage payload.
  const [testCases, setTestCases] = useState<TestCase[]>([]);
  const testCasesHydratedRef = useRef(false);
  const [expandedTestId, setExpandedTestId] = useState<string | null>(null);
  const [isSavingUserStory, setIsSavingUserStory] = useState(false);
  
  const [newProjectName, setNewProjectName] = useState("");
  const [newProjectDomain, setNewProjectDomain] = useState("insurance");
  const [newProjectDesc, setNewProjectDesc] = useState("");
  const [showCreateProject, setShowCreateProject] = useState(false);
  
  const [newSprintName, setNewSprintName] = useState("");
  const [showCreateSprint, setShowCreateSprint] = useState(false);
  
  const [storyTitle, setStoryTitle] = useState("");
  const [storyDescription, setStoryDescription] = useState("");
  const [acceptanceCriteria, setAcceptanceCriteria] = useState("");
  
  // Edit modal state
  const [editingTestCase, setEditingTestCase] = useState<TestCase | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editPriority, setEditPriority] = useState<string>("P2");
  const [editSteps, setEditSteps] = useState<Array<{ step_number: number; action: string; expected_behavior?: string }>>([]);

  // Bulk-selection state. We keep a Set<string> of test-case ids that the user
  // has checked. Bulk delete + bulk-edit (priority / category) operate on this
  // set. The single-card delete also funnels through `pendingDeleteIds` so it
  // gets the same confirmation dialog -- delete is irreversible (test cases
  // live only in IDB until pushed to ADO/Jira).
  const [selectedTestCaseIds, setSelectedTestCaseIds] = useState<Set<string>>(new Set());
  const [pendingDeleteIds, setPendingDeleteIds] = useState<string[] | null>(null);
  const [bulkEditOpen, setBulkEditOpen] = useState(false);
  const [bulkEditPriority, setBulkEditPriority] = useState<"unchanged" | TestCase["priority"]>("unchanged");
  const [bulkEditCategory, setBulkEditCategory] = useState<"unchanged" | TestCase["category"]>("unchanged");
  const [isSaving, setIsSaving] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isExportingBdd, setIsExportingBdd] = useState(false);
  const [generatedBddAssets, setGeneratedBddAssets] = useState<any>(null);
  const [traceabilityReport, setTraceabilityReport] = useState<any>(null);
  const [repoPath, setRepoPath] = useState<string>("");
  // SDLC Golden Repo guidance toggle. Mirrors BRD's "Use Golden Repo Guidance"
  // switch -- when ON (default) and a project is selected, the server pulls
  // pre-vectorized chunks from sdlc_projects.golden_repo_reference and threads
  // them into the LLM prompts. OFF skips the SDLC RAG load entirely (faster
  // generation, falls back to local repoPath / uploaded docs only).
  const [useGoldenRepoGuidance, setUseGoldenRepoGuidance] = useState<boolean>(true);
  const [coverageSummary, setCoverageSummary] = useState<any>(null);
  const [enrichedContext, setEnrichedContext] = useState<any>(null);

  // Document upload state
  interface UploadedDoc { fileName: string; content: string; charCount: number; truncated: boolean; fileType: string; }
  const [uploadedDocs, setUploadedDocs] = useState<UploadedDoc[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  
  // Agentic AI state
  const [agenticEvents, setAgenticEvents] = useState<any[]>([]);
  const agenticEventsRef = useRef<any[]>([]);
  
  // Track if test cases were just generated (to prevent useEffect from clearing them)
  const justGeneratedRef = useRef(false);
  
  // Story source mode: 'jira' | 'local' (ADO removed)
  const [storySource, setStorySource] = useState<StorySource>('jira');
  const useAdoMode = false;
  const useJiraMode = storySource === 'jira';

  // ADO mode state
  const [selectedAdoProject, setSelectedAdoProject] = useState<string | null>(null);
  const [selectedAdoIteration, setSelectedAdoIteration] = useState<string | null>(null);
  const [selectedAdoIterationPath, setSelectedAdoIterationPath] = useState<string | null>(null);
  const [selectedAdoUserStory, setSelectedAdoUserStory] = useState<AdoUserStory | null>(null);
  const [isPushingToAdo, setIsPushingToAdo] = useState(false);
  const [pushResults, setPushResults] = useState<{ success: boolean; message: string; createdTestCases?: any[] } | null>(null);

  // Jira mode state
  const [selectedJiraProject, setSelectedJiraProject] = useState<string | null>(null);
  const [selectedJiraProjectKey, setSelectedJiraProjectKey] = useState<string | null>(null);
  const [jiraProjectOpen, setJiraProjectOpen] = useState(false);
  const [isLoadingExistingCases, setIsLoadingExistingCases] = useState(false);
  const [jiraComments, setJiraComments] = useState<string>("");
  const [showAutomationScript, setShowAutomationScript] = useState<string | null>(null);
  const [automationFramework, setAutomationFramework] = useState<'playwright' | 'selenium'>('playwright');
  const [isGeneratingScripts, setIsGeneratingScripts] = useState(false);
  const [showTCScripts, setShowTCScripts] = useState<{ files: TCFile[]; bddFeature: string; ddtTemplate: string } | null>(null);
  const [tcActiveFile, setTcActiveFile] = useState<string>('Main.js');
  const [isGeneratingTC, setIsGeneratingTC] = useState(false);
  const [selectedJiraBoard, setSelectedJiraBoard] = useState<number | null>(null);
  const [selectedJiraSprint, setSelectedJiraSprint] = useState<number | null>(null);
  const [selectedJiraUserStory, setSelectedJiraUserStory] = useState<JiraUserStory | null>(null);
  const [jiraIssueTypeFilter, setJiraIssueTypeFilter] = useState<string[]>([]);
  const [jiraSprintFilterActive, setJiraSprintFilterActive] = useState(false);
  const [isPushingToJira, setIsPushingToJira] = useState(false);
  const [jiraPushResults, setJiraPushResults] = useState<{ success: boolean; message: string; createdTestCases?: any[] } | null>(null);

  // Framework Config state
  const [selectedFrameworkConfigId, setSelectedFrameworkConfigId] = useState<string>("");

  // Sync QE project ID from DevX context
  useEffect(() => {
    if (ctxProjectId && ctxProjectId !== selectedProjectId) {
      setSelectedProjectId(ctxProjectId);
    }
  }, [ctxProjectId]);

  const { data: projects = [], isLoading: projectsLoading } = useQuery<Project[]>({
    queryKey: ["/api/projects"],
  });

  // Framework configs for the catalog selector
  const { data: frameworkConfigs = [] } = useQuery<Array<{ id: string; name: string; framework: string; language: string; isGlobal: boolean; functionCount?: number }>>({
    queryKey: ["/api/framework-config"],
  });

  const { data: sprints = [], isLoading: sprintsLoading } = useQuery<Sprint[]>({
    queryKey: ["/api/projects", selectedProjectId, "sprints"],
    queryFn: async () => {
      if (!selectedProjectId) return [];
      const res = await fetch(`/api/projects/${selectedProjectId}/sprints`);
      if (!res.ok) throw new Error("Failed to fetch sprints");
      return res.json();
    },
    enabled: !!selectedProjectId,
  });

  // Fetch user stories for the sprint
  const { data: userStories = [], isLoading: loadingUserStories } = useQuery<SprintUserStory[]>({
    queryKey: ["/api/sprints", selectedSprintId, "user-stories"],
    queryFn: async () => {
      if (!selectedSprintId) return [];
      const res = await fetch(`/api/sprints/${selectedSprintId}/user-stories`);
      if (!res.ok) throw new Error("Failed to fetch user stories");
      return res.json();
    },
    enabled: !!selectedSprintId,
  });

  // Fetch saved test cases when user story is selected
  const { data: savedTestCases = [], isLoading: loadingTestCases } = useQuery<any[]>({
    queryKey: ["/api/sprint-user-stories", selectedUserStoryId, "test-cases"],
    queryFn: async () => {
      if (!selectedUserStoryId) return [];
      const res = await fetch(`/api/sprint-user-stories/${selectedUserStoryId}/test-cases`);
      if (!res.ok) throw new Error("Failed to fetch test cases");
      const data = await res.json();
      // Transform saved data to TestCase format — use testCaseId (FUN-1) not DB row id (UUID)
      return data.map((tc: any, idx: number) => ({
        id: tc.testCaseId || tc.id || `TC-${idx + 1}`,
        title: tc.title,
        description: tc.description || "",
        objective: tc.objective || "",
        category: tc.category,
        priority: tc.priority || "P2",
        preconditions: tc.preconditions || [],
        traceability: tc.traceability || "",
        steps: tc.testSteps?.map((s: any, i: number) => ({
          step_number: s.step_number || i + 1,
          action: s.action,
          expected_behavior: s.expected_behavior || ""
        })) || [],
        expectedResult: tc.expectedResult || "",
        postconditions: tc.postconditions || [],
        testData: tc.testData || {},
      }));
    },
    enabled: !!selectedUserStoryId,
  });

  // ADO Queries
  const { data: adoProjectsData, isLoading: adoProjectsLoading, error: adoProjectsError, refetch: refetchAdoProjects } = useQuery<{ success: boolean; projects: AdoProject[]; defaultProject: string | null }>({
    queryKey: ["/api/ado/env/projects"],
    queryFn: async () => {
      const res = await fetch("/api/ado/env/projects");
      if (!res.ok) {
        const error = await res.json().catch(() => ({ error: "Failed to fetch ADO projects" }));
        throw new Error(error.error || "Failed to fetch ADO projects");
      }
      return res.json();
    },
    enabled: useAdoMode,
    retry: false,
  });

  const adoProjects = adoProjectsData?.projects || [];
  const adoDefaultProject = adoProjectsData?.defaultProject;

  const { data: adoIterationsData, isLoading: adoIterationsLoading, error: adoIterationsError, refetch: refetchAdoIterations } = useQuery<{ success: boolean; iterations: AdoIteration[] }>({
    queryKey: ["/api/ado/env/projects", selectedAdoProject, "iterations"],
    queryFn: async () => {
      if (!selectedAdoProject) return { success: false, iterations: [] };
      const res = await fetch(`/api/ado/env/projects/${encodeURIComponent(selectedAdoProject)}/iterations`);
      if (!res.ok) {
        const error = await res.json().catch(() => ({ error: "Failed to fetch iterations" }));
        throw new Error(error.error || "Failed to fetch iterations");
      }
      return res.json();
    },
    enabled: useAdoMode && !!selectedAdoProject,
    retry: false,
  });

  const adoIterations = adoIterationsData?.iterations || [];

  const { data: adoUserStoriesData, isLoading: adoUserStoriesLoading, error: adoUserStoriesError, refetch: refetchAdoUserStories } = useQuery<{ success: boolean; userStories: AdoUserStory[] }>({
    queryKey: ["/api/ado/env/projects", selectedAdoProject, "user-stories", selectedAdoIterationPath],
    queryFn: async () => {
      if (!selectedAdoProject) return { success: false, userStories: [] };
      const url = selectedAdoIterationPath 
        ? `/api/ado/env/projects/${encodeURIComponent(selectedAdoProject)}/user-stories?iterationPath=${encodeURIComponent(selectedAdoIterationPath)}`
        : `/api/ado/env/projects/${encodeURIComponent(selectedAdoProject)}/user-stories`;
      const res = await fetch(url);
      if (!res.ok) {
        const error = await res.json().catch(() => ({ error: "Failed to fetch user stories" }));
        throw new Error(error.error || "Failed to fetch user stories");
      }
      return res.json();
    },
    enabled: useAdoMode && !!selectedAdoProject && !!selectedAdoIteration,
    retry: false,
  });

  const adoUserStories = adoUserStoriesData?.userStories || [];

  // Show toast for ADO query errors
  useEffect(() => {
    if (adoProjectsError) {
      toast({ title: "ADO Connection Error", description: (adoProjectsError as Error).message, variant: "destructive" });
    }
  }, [adoProjectsError, toast]);

  useEffect(() => {
    if (adoIterationsError) {
      toast({ title: "Failed to load sprints", description: (adoIterationsError as Error).message, variant: "destructive" });
    }
  }, [adoIterationsError, toast]);

  useEffect(() => {
    if (adoUserStoriesError) {
      toast({ title: "Failed to load user stories", description: (adoUserStoriesError as Error).message, variant: "destructive" });
    }
  }, [adoUserStoriesError, toast]);

  // Auto-select default ADO project if available
  useEffect(() => {
    if (useAdoMode && adoDefaultProject && !selectedAdoProject && adoProjects.length > 0) {
      const defaultProj = adoProjects.find(p => p.name === adoDefaultProject);
      if (defaultProj) {
        setSelectedAdoProject(defaultProj.name);
      }
    }
  }, [useAdoMode, adoDefaultProject, adoProjects, selectedAdoProject]);

  // Load user story details when ADO user story is selected
  useEffect(() => {
    if (selectedAdoUserStory) {
      setStoryTitle(selectedAdoUserStory.title);
      // Strip HTML tags from description and acceptance criteria
      const stripHtml = (html: string) => html?.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim() || '';
      setStoryDescription(stripHtml(selectedAdoUserStory.description));
      setAcceptanceCriteria(stripHtml(selectedAdoUserStory.acceptanceCriteria));
    }
  }, [selectedAdoUserStory]);

  // Clear iteration and user story when ADO project changes
  useEffect(() => {
    setSelectedAdoIteration(null);
    setSelectedAdoIterationPath(null);
    setSelectedAdoUserStory(null);
    justGeneratedRef.current = false;
    setTestCases([]);
  }, [selectedAdoProject]);

  // Clear user story when ADO iteration changes
  useEffect(() => {
    setSelectedAdoUserStory(null);
    justGeneratedRef.current = false;
    setTestCases([]);
  }, [selectedAdoIteration]);

  // ==================== JIRA QUERIES ====================
  const { data: jiraProjectsData, isLoading: jiraProjectsLoading, error: jiraProjectsError, refetch: refetchJiraProjects } = useQuery<{ success: boolean; projects: JiraProject[] }>({
    queryKey: ["/api/jira/projects", selectedProjectId],
    queryFn: async () => {
      const params = selectedProjectId ? `?qeProjectId=${encodeURIComponent(selectedProjectId)}` : '';
      const res = await fetch(`/api/jira/projects${params}`);
      if (!res.ok) {
        const error = await res.json().catch(() => ({ error: "Failed to fetch Jira projects" }));
        throw new Error(error.error || "Failed to fetch Jira projects");
      }
      return res.json();
    },
    enabled: useJiraMode,
    retry: false,
  });
  const jiraProjects = jiraProjectsData?.projects || [];

  const { data: jiraBoardsData, isLoading: jiraBoardsLoading, refetch: refetchJiraBoards } = useQuery<{ success: boolean; boards: JiraBoard[] }>({
    queryKey: ["/api/jira/projects", selectedJiraProjectKey, "boards"],
    queryFn: async () => {
      if (!selectedJiraProjectKey) return { success: false, boards: [] };
      const params = selectedProjectId ? `?qeProjectId=${encodeURIComponent(selectedProjectId)}` : '';
      const res = await fetch(`/api/jira/projects/${encodeURIComponent(selectedJiraProjectKey)}/boards${params}`);
      if (!res.ok) throw new Error("Failed to fetch boards");
      return res.json();
    },
    enabled: useJiraMode && !!selectedJiraProjectKey,
    retry: false,
  });
  const jiraBoards = jiraBoardsData?.boards || [];

  const { data: jiraSprintsData, isLoading: jiraSprintsLoading, refetch: refetchJiraSprints } = useQuery<{ success: boolean; sprints: JiraSprint[] }>({
    queryKey: ["/api/jira/boards", selectedJiraBoard, "sprints"],
    queryFn: async () => {
      if (!selectedJiraBoard) return { success: false, sprints: [] };
      const params = selectedProjectId ? `?qeProjectId=${encodeURIComponent(selectedProjectId)}` : '';
      const res = await fetch(`/api/jira/boards/${selectedJiraBoard}/sprints${params}`);
      if (!res.ok) return { success: true, sprints: [] };
      return res.json();
    },
    enabled: useJiraMode && !!selectedJiraBoard,
    retry: false,
  });
  const jiraSprints = jiraSprintsData?.sprints || [];

  const { data: jiraSprintStoriesData, isLoading: jiraSprintStoriesLoading, refetch: refetchJiraSprintStories } = useQuery<{ success: boolean; userStories: JiraUserStory[] }>({
    queryKey: ["/api/jira/sprints", selectedJiraSprint, "user-stories"],
    queryFn: async () => {
      if (!selectedJiraSprint) return { success: false, userStories: [] };
      const params = selectedProjectId ? `?qeProjectId=${encodeURIComponent(selectedProjectId)}` : '';
      const res = await fetch(`/api/jira/sprints/${selectedJiraSprint}/user-stories${params}`);
      if (!res.ok) throw new Error("Failed to fetch user stories");
      return res.json();
    },
    enabled: useJiraMode && !!selectedJiraSprint,
    retry: false,
  });

  const { data: jiraProjectStoriesData, isLoading: jiraProjectStoriesLoading, refetch: refetchJiraProjectStories } = useQuery<{ success: boolean; userStories: JiraUserStory[] }>({
    queryKey: ["/api/jira/projects", selectedJiraProjectKey, "user-stories", jiraIssueTypeFilter, jiraSprintFilterActive],
    queryFn: async () => {
      if (!selectedJiraProjectKey) return { success: false, userStories: [] };
      const params = new URLSearchParams();
      if (selectedProjectId) params.set('qeProjectId', selectedProjectId);
      if (jiraIssueTypeFilter.length > 0) params.set('issueTypes', jiraIssueTypeFilter.join(','));
      if (jiraSprintFilterActive) params.set('sprintFilter', 'active');
      const qs = params.toString();
      const res = await fetch(`/api/jira/projects/${encodeURIComponent(selectedJiraProjectKey)}/user-stories${qs ? `?${qs}` : ''}`);
      if (!res.ok) throw new Error("Failed to fetch work items");
      return res.json();
    },
    enabled: useJiraMode && !!selectedJiraProjectKey && !selectedJiraSprint,
    retry: false,
  });

  const useSprintStories = !!selectedJiraSprint;
  const jiraUserStories = useSprintStories ? (jiraSprintStoriesData?.userStories || []) : (jiraProjectStoriesData?.userStories || []);
  const jiraUserStoriesLoading = useSprintStories ? jiraSprintStoriesLoading : jiraProjectStoriesLoading;
  const refetchJiraUserStories = useSprintStories ? refetchJiraSprintStories : refetchJiraProjectStories;

  useEffect(() => {
    if (jiraProjectsError) {
      toast({ title: "Jira Connection Error", description: (jiraProjectsError as Error).message, variant: "destructive" });
    }
  }, [jiraProjectsError, toast]);

  useEffect(() => {
    if (selectedJiraUserStory) {
      setStoryTitle(selectedJiraUserStory.title);
      const rawDesc = selectedJiraUserStory.description || '';
      const rawAC = selectedJiraUserStory.acceptanceCriteria || '';

      if (rawAC) {
        setStoryDescription(rawDesc);
        setAcceptanceCriteria(rawAC);
      } else {
        const acPatterns = [
          /\*Acceptance\s*Criteria:?\*\s*/i,
          /h[1-6]\.\s*Acceptance\s*Criteria:?\s*/i,
          /#+\s*Acceptance\s*Criteria:?\s*/i,
          /Acceptance\s*Criteria:?\s*\n/i,
        ];
        let descPart = rawDesc;
        let acPart = '';
        for (const pattern of acPatterns) {
          const match = rawDesc.search(pattern);
          if (match !== -1) {
            descPart = rawDesc.substring(0, match).trim();
            const fullMatch = rawDesc.substring(match);
            acPart = fullMatch.replace(acPatterns.find(p => p.test(fullMatch))!, '').trim();
            break;
          }
        }
        setStoryDescription(descPart);
        setAcceptanceCriteria(acPart);
      }

      if (selectedJiraUserStory.id) {
        fetch(`/api/jira/issues/${encodeURIComponent(selectedJiraUserStory.id)}/comments`)
          .then(res => res.ok ? res.json() : { success: false, comments: [] })
          .then(data => {
            if (data.success && data.comments?.length > 0) {
              const commentText = data.comments
                .map((c: { author: string; body: string }) => `[${c.author}]: ${c.body}`)
                .join("\n\n---\n\n");
              setJiraComments(commentText);
            } else {
              setJiraComments("");
            }
          })
          .catch(() => setJiraComments(""));
      }

      if (selectedJiraProjectKey && selectedJiraUserStory.id) {
        setIsLoadingExistingCases(true);
        fetch(`/api/jira/test-cases/${encodeURIComponent(selectedJiraProjectKey)}/${encodeURIComponent(selectedJiraUserStory.id)}`)
          .then(res => {
            if (!res.ok) throw new Error('Failed to fetch');
            return res.json();
          })
          .then(data => {
            if (data.success && data.testCases && data.testCases.length > 0) {
              const existingCases: TestCase[] = data.testCases.map((tc: any) => ({
                id: tc.testCaseId || tc.id,
                title: tc.title,
                description: tc.description || '',
                objective: tc.objective || '',
                category: tc.category || 'functional',
                priority: tc.priority || 'P2',
                preconditions: tc.preconditions || [],
                steps: (tc.testSteps || []).map((s: any, i: number) => ({
                  step_number: s.step_number || i + 1,
                  action: s.action,
                  expected_behavior: s.expected_behavior || '',
                })),
                expectedResult: tc.expectedResult || '',
                postconditions: tc.postconditions || [],
                playwrightScript: tc.playwrightScript || undefined,
              }));
              justGeneratedRef.current = true;
              setTestCases(existingCases);
              toast({ title: "Existing Test Cases Loaded", description: `${existingCases.length} previously generated test cases found` });
            } else {
              setTestCases([]);
            }
          })
          .catch(() => setTestCases([]))
          .finally(() => setIsLoadingExistingCases(false));
      }
    }
  }, [selectedJiraUserStory]);

  useEffect(() => {
    setSelectedJiraBoard(null);
    setSelectedJiraSprint(null);
    setSelectedJiraUserStory(null);
    justGeneratedRef.current = false;
    setTestCases([]);
  }, [selectedJiraProjectKey]);

  useEffect(() => {
    setSelectedJiraSprint(null);
    setSelectedJiraUserStory(null);
    justGeneratedRef.current = false;
    setTestCases([]);
  }, [selectedJiraBoard]);

  useEffect(() => {
    setSelectedJiraUserStory(null);
    justGeneratedRef.current = false;
    setTestCases([]);
  }, [selectedJiraSprint]);

  // ==================== END JIRA QUERIES ====================

  // Load saved test cases when they are fetched, or clear if none exist
  // Don't overwrite test cases while generation is in progress or just completed
  useEffect(() => {
    if (!loadingTestCases && !isGenerating) {
      if (justGeneratedRef.current) {
        return;
      }
      if (savedTestCases.length > 0) {
        setTestCases(savedTestCases);
      }
    }
  }, [savedTestCases, loadingTestCases, selectedUserStoryId, isGenerating]);

  // Load user story details when selected
  useEffect(() => {
    if (selectedUserStoryId) {
      const story = userStories.find(s => s.id === selectedUserStoryId);
      if (story) {
        setStoryTitle(story.title);
        setStoryDescription(story.description || "");
        setAcceptanceCriteria(story.acceptanceCriteria || "");
      }
    }
  }, [selectedUserStoryId, userStories]);

  // Clear user story selection when sprint changes
  useEffect(() => {
    setSelectedUserStoryId(null);
    setStoryTitle("");
    setStoryDescription("");
    setAcceptanceCriteria("");
    // Don't clear test cases on sprint change - keep them in localStorage
  }, [selectedSprintId]);

  // Hydrate test cases from IndexedDB on first mount (with one-time migration
  // from the legacy localStorage key — old sessions stored the array under
  // "sprint-agent-test-cases" which is the same key that overflowed quota).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const fromIdb = await idbGet<TestCase[]>("sprint-agent-test-cases");
        if (!cancelled && fromIdb && fromIdb.length > 0) {
          setTestCases(fromIdb);
          testCasesHydratedRef.current = true;
          return;
        }
        const legacy = safeGetItem("sprint-agent-test-cases");
        if (legacy) {
          try {
            const parsed = JSON.parse(legacy) as TestCase[];
            if (Array.isArray(parsed) && parsed.length > 0) {
              await idbSet("sprint-agent-test-cases", parsed);
              if (!cancelled) setTestCases(parsed);
            }
          } catch {
            // Ignore corrupt legacy payload.
          }
          // Always free the localStorage slot to prevent re-quota errors.
          safeRemoveItem("sprint-agent-test-cases");
        }
      } catch (err) {
        console.warn("[sprint-agent] failed to hydrate test cases from IDB:", err);
      } finally {
        testCasesHydratedRef.current = true;
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Persist test cases to IndexedDB whenever they change. Skipped until the
  // initial hydration completes so we never overwrite stored data with an
  // empty array on first paint.
  useEffect(() => {
    if (!testCasesHydratedRef.current) return;
    if (testCases.length === 0) {
      idbRemove("sprint-agent-test-cases").catch(() => {});
      return;
    }
    idbSet("sprint-agent-test-cases", testCases).catch((err) => {
      console.warn("[sprint-agent] failed to persist test cases to IDB:", err);
    });
  }, [testCases]);

  const createProjectMutation = useMutation({
    mutationFn: async () => {
      if (!newProjectName.trim()) throw new Error("Project name required");
      const res = await apiRequest("POST", "/api/projects", {
        userId: DEMO_USER_ID,
        name: newProjectName,
        description: newProjectDesc,
        type: "sprint",
        domain: newProjectDomain,
        productDescription: newProjectDesc,
      });
      return res.json();
    },
    onSuccess: (data) => {
      setNewProjectName("");
      setNewProjectDesc("");
      setShowCreateProject(false);
      queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
      setSelectedProjectId(data.id);
      toast({ title: "Project created", description: data.name });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const createSprintMutation = useMutation({
    mutationFn: async () => {
      if (!newSprintName.trim()) throw new Error("Sprint name required");
      if (!selectedProjectId) throw new Error("Project not selected");
      const res = await apiRequest("POST", `/api/projects/${selectedProjectId}/sprints`, {
        name: newSprintName,
      });
      return res.json();
    },
    onSuccess: (data) => {
      setNewSprintName("");
      setShowCreateSprint(false);
      queryClient.invalidateQueries({ queryKey: ["/api/projects", selectedProjectId, "sprints"] });
      setSelectedSprintId(data.id);
      toast({ title: "Sprint created", description: data.name });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const handleCreateSprint = () => {
    createSprintMutation.mutate();
  };

  // ── Document upload handler ─────────────────────────────────────────────────
  const handleDocumentUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;

    const MAX_FILES = 5;
    const MAX_SIZE_MB = 10;
    const allowedExts = [".pdf", ".docx", ".xlsx", ".xls", ".txt", ".md", ".feature", ".spec.ts", ".spec.js", ".json"];

    const fileArray = Array.from(files);

    // Validate
    for (const file of fileArray) {
      const ext = "." + file.name.split(".").pop()?.toLowerCase();
      if (!allowedExts.some(a => file.name.toLowerCase().endsWith(a.replace(".", ".")))) {
        toast({
          title: "Unsupported file type",
          description: `"${file.name}" is not a supported format. Allowed: ${allowedExts.join(", ")}`,
          variant: "destructive",
        });
        return;
      }
      if (file.size > MAX_SIZE_MB * 1024 * 1024) {
        toast({
          title: "File too large",
          description: `"${file.name}" exceeds the ${MAX_SIZE_MB} MB limit.`,
          variant: "destructive",
        });
        return;
      }
    }

    if (uploadedDocs.length + fileArray.length > MAX_FILES) {
      toast({
        title: "Too many files",
        description: `You can upload at most ${MAX_FILES} context documents.`,
        variant: "destructive",
      });
      return;
    }

    setIsUploading(true);
    try {
      const formData = new FormData();
      for (const file of fileArray) {
        formData.append("files", file);
      }

      const response = await fetch("/api/tests/upload-context", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const errBody = await response.json().catch(() => ({ error: "Upload failed" }));
        throw new Error(errBody.error ?? "Upload failed");
      }

      const result = await response.json() as { documents: UploadedDoc[] };
      setUploadedDocs(prev => [...prev, ...result.documents]);

      toast({
        title: "Documents uploaded",
        description: `${result.documents.length} file(s) extracted and ready to use as context.`,
      });
    } catch (err: any) {
      toast({
        title: "Upload failed",
        description: err?.message ?? "Could not extract document text.",
        variant: "destructive",
      });
    } finally {
      setIsUploading(false);
    }
  };

  const handleRemoveUploadedDoc = (index: number) => {
    setUploadedDocs(prev => prev.filter((_, i) => i !== index));
  };

  const handleGenerate = async () => {
    console.log("[Generate] handleGenerate called");
    if (!storyTitle.trim()) {
      toast({ title: "Error", description: "Please enter a user story title", variant: "destructive" });
      return;
    }

    console.log("[Generate] Starting generation for:", storyTitle);
    setIsGenerating(true);
    setTestCases([]);
    setAgenticEvents([]);
    agenticEventsRef.current = [];
    setTraceabilityReport(null);

    try {
      const project = projects.find(p => p.id === selectedProjectId);
      console.log("[Generate] Project:", project?.name, "Domain:", project?.domain);
      
      const selectedSprint = jiraSprints.find(s => s.id === selectedJiraSprint);
      const storyMetadata = useJiraMode && selectedJiraUserStory ? {
        jiraKey: selectedJiraUserStory.id,
        priority: selectedJiraUserStory.priority || undefined,
        storyPoints: selectedJiraUserStory.storyPoints ?? undefined,
        assignee: selectedJiraUserStory.assignee || undefined,
        sprintName: selectedSprint?.name || undefined,
        projectName: selectedJiraProject || undefined,
        status: selectedJiraUserStory.state || undefined,
        comments: jiraComments || undefined,
      } : undefined;

      const response = await fetch("/api/tests/sprint-generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userStoryId: `story-${Date.now()}`,
          title: storyTitle,
          description: storyDescription,
          acceptanceCriteria: acceptanceCriteria,
          domain: project?.domain || "general",
          productDescription: project?.description || "",
          storyMetadata,
          frameworkConfigId: selectedFrameworkConfigId || undefined,
          repoPath: repoPath.trim() || undefined,
          uploadedDocuments: uploadedDocs.length > 0
            ? uploadedDocs.map(d => ({ fileName: d.fileName, content: d.content, charCount: d.charCount, fileType: d.fileType }))
            : undefined,
          // Pass the QE project id so the server can resolve the SDLC
          // golden_repo_reference and inject chunked guidance into the LLM
          // prompts -- mirrors how BRD generation already uses it.
          projectId: selectedProjectId || undefined,
          useGoldenRepo: useGoldenRepoGuidance,
        }),
      });

      console.log("[Generate] Response status:", response.status, "ok:", response.ok);
      console.log("[Generate] Response headers:", response.headers.get('content-type'));
      
      if (!response.ok) {
        throw new Error("Test generation failed");
      }

      if (!response.body) {
        console.error("[Generate] Response body is null/undefined");
        throw new Error("Response body is not available");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      const generatedCases: TestCase[] = [];

      // Reset per-generation transient state
      setCoverageSummary(null);
      setEnrichedContext(null);
      // Note: uploadedDocs are intentionally kept — user may re-generate with same docs

      let buffer = '';
      let chunkCount = 0;
      console.log("[SSE] Starting to read events, reader:", !!reader);
      
      while (true) {
        const { done, value } = await reader.read();
        chunkCount++;
        console.log(`[SSE] Read chunk #${chunkCount}, done:`, done, "bytes:", value?.length || 0);
        
        if (done) {
          console.log("[SSE] Stream ended after", chunkCount, "chunks. Total cases:", generatedCases.length);
          break;
        }
        
        const chunk = decoder.decode(value, { stream: true });
        console.log("[SSE] Chunk content preview:", chunk.substring(0, 200));
        buffer += chunk;
        const events = buffer.split('\n\n');
        buffer = events.pop() || '';
        
        for (const event of events) {
          const lines = event.split('\n');
          for (const line of lines) {
            if (line.startsWith('data: ')) {
              try {
                const jsonStr = line.slice(6);
                console.log("[SSE] Raw JSON:", jsonStr.substring(0, 100));
                const data = JSON.parse(jsonStr);
                console.log("[SSE] Parsed event type:", data.type);
                
                // Add to agentic events for visualization
                agenticEventsRef.current = [...agenticEventsRef.current, data];
                setAgenticEvents([...agenticEventsRef.current]);
                console.log("[SSE] Total events:", agenticEventsRef.current.length);
                
                if (data.type === 'complete') {
                  justGeneratedRef.current = generatedCases.length > 0;
                  setIsGenerating(false);
                  // Auto-save refined test cases to DB — map id to testCaseId for storage
                  if (generatedCases.length > 0 && selectedUserStoryId) {
                    const saveCases = generatedCases.map(tc => ({
                      ...tc,
                      testCaseId: tc.id,
                      testSteps: tc.steps,
                    }));
                    fetch(`/api/sprint-user-stories/${selectedUserStoryId}/test-cases`, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ testCases: saveCases }),
                    }).then(() => console.log(`[Auto-save] ${saveCases.length} test cases saved to DB`))
                      .catch(err => console.error('[Auto-save] Failed:', err));
                  }
                } else if (data.type === 'error') {
                  toast({ title: "Error", description: data.message || "Generation failed", variant: "destructive" });
                  setIsGenerating(false);
                } else if (data.type === 'refined_test_cases' && data.data?.testCases) {
                  // Replace the list with QA-refined test cases
                  const refinedCases: TestCase[] = data.data.testCases.map((tc: any, idx: number) => ({
                    id: tc.testCaseId || `TC-${idx + 1}`,
                    title: tc.title,
                    description: tc.description || "",
                    objective: tc.objective || "",
                    category: tc.category,
                    priority: tc.priority || "P2",
                    preconditions: tc.preconditions || [],
                    steps: tc.testSteps?.map((s: any, i: number) => ({
                      step_number: s.step_number || i + 1,
                      action: s.action,
                      expected_behavior: s.expected_behavior || ""
                    })) || [],
                    expectedResult: tc.expectedResult || "",
                    postconditions: tc.postconditions || []
                  }));
                  generatedCases.length = 0;
                  generatedCases.push(...refinedCases);
                  setTestCases([...refinedCases]);
                } else if (data.type === 'test_case' && data.testCase) {
                  const tc: TestCase = {
                    id: data.testCase.testCaseId || `TC-${generatedCases.length + 1}`,
                    title: data.testCase.title,
                    description: data.testCase.description || "",
                    objective: data.testCase.objective || "",
                    category: data.testCase.category,
                    priority: data.testCase.priority || "P2",
                    preconditions: data.testCase.preconditions || [],
                    steps: data.testCase.testSteps?.map((s: any, i: number) => ({
                      step_number: s.step_number || i + 1,
                      action: s.action,
                      expected_behavior: s.expected_behavior || ""
                    })) || [],
                    expectedResult: data.testCase.expectedResult || "",
                    postconditions: data.testCase.postconditions || []
                  };
                  generatedCases.push(tc);
                  setTestCases([...generatedCases]);
                } else if (data.type === 'traceability_report' && data.data) {
                  setTraceabilityReport(data.data);
                } else if (data.type === 'bdd_assets' && data.data) {
                  // Store BDD assets for later export
                  setGeneratedBddAssets(data.data);
                } else if (data.type === 'coverage_summary' && data.data) {
                  setCoverageSummary(data.data);
                } else if (data.type === 'enriched_context' && data.data) {
                  setEnrichedContext(data.data);
                }
              } catch (e) {
                // Ignore parse errors for incomplete data
              }
            }
          }
        }
      }

      setIsGenerating(false);
      if (generatedCases.length > 0) {
        justGeneratedRef.current = true;
        toast({ title: "Agentic pipeline complete", description: `${generatedCases.length} test cases generated` });

        if (useJiraMode && selectedJiraProjectKey && selectedJiraUserStory) {
          try {
            await fetch('/api/jira/save-test-cases', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                jiraProjectKey: selectedJiraProjectKey,
                jiraStoryId: selectedJiraUserStory.id,
                jiraStoryTitle: selectedJiraUserStory.title,
                testCases: generatedCases,
                jiraBoardId: selectedJiraBoard,
                jiraSprintId: selectedJiraSprint,
              }),
            });
          } catch (e) {
            console.error('Failed to save Jira test cases:', e);
          }
        }
      }
    } catch (error: any) {
      setIsGenerating(false);
      toast({ title: "Error", description: error.message, variant: "destructive" });
    }
  };

  const getFilteredTestCases = () => {
    if (selectedTab === "all") return testCases;
    return testCases.filter(tc => tc.category === selectedTab);
  };

  const categoryCounts = {
    all: testCases.length,
    functional: testCases.filter(tc => tc.category === "functional").length,
    negative: testCases.filter(tc => tc.category === "negative").length,
    edge_case: testCases.filter(tc => tc.category === "edge_case").length,
    security: testCases.filter(tc => tc.category === "security").length,
    accessibility: testCases.filter(tc => tc.category === "accessibility").length,
  };

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case "P0": return "bg-purple-500/20 text-purple-400 border-purple-500/30";
      case "P1": return "bg-orange-500/20 text-orange-400 border-orange-500/30";
      case "P2": return "bg-blue-500/20 text-blue-400 border-blue-500/30";
      case "P3": return "bg-slate-500/20 text-slate-400 border-slate-500/30";
      default: return "bg-slate-500/20 text-slate-400 border-slate-500/30";
    }
  };

  const getCategoryLabel = (category: string) => {
    switch (category) {
      case "functional": return "Functional";
      case "negative": return "Negative";
      case "edge_case": return "Edge Case";
      case "security": return "Security";
      case "accessibility": return "Accessibility";
      default: return category;
    }
  };

  // Open edit modal
  const handleEditTestCase = (tc: TestCase) => {
    setEditingTestCase(tc);
    setEditTitle(tc.title);
    setEditPriority(tc.priority);
    setEditSteps([...tc.steps]);
  };

  // Save edited test case
  const handleSaveEdit = () => {
    if (!editingTestCase) return;
    
    const updatedTestCases = testCases.map(tc => 
      tc.id === editingTestCase.id 
        ? { ...tc, title: editTitle, priority: editPriority as TestCase["priority"], steps: editSteps }
        : tc
    );
    setTestCases(updatedTestCases);
    setEditingTestCase(null);
    toast({ title: "Test case updated", description: "Changes saved successfully" });
  };

  // Delete test case -- routes through the confirmation dialog so single +
  // bulk delete share one code path. Use `confirmDeleteIds` to actually
  // remove the cases once the user confirms.
  const handleDeleteTestCase = (id: string) => {
    setPendingDeleteIds([id]);
  };

  const confirmDeleteIds = (ids: string[]) => {
    if (ids.length === 0) return;
    const idSet = new Set(ids);
    setTestCases((prev) => prev.filter((tc) => !idSet.has(tc.id)));
    setSelectedTestCaseIds((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => next.delete(id));
      return next;
    });
    if (expandedTestId && idSet.has(expandedTestId)) {
      setExpandedTestId(null);
    }
    setPendingDeleteIds(null);
    toast({
      title: ids.length === 1 ? "Test case deleted" : `${ids.length} test cases deleted`,
    });
  };

  // Bulk-selection helpers
  const isTestCaseSelected = (id: string) => selectedTestCaseIds.has(id);

  const toggleTestCaseSelected = (id: string) => {
    setSelectedTestCaseIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // "Select all" applies to whatever the user is currently looking at -- i.e.
  // the cases that pass the selectedTab filter, not all generated cases. This
  // matches what the user sees and avoids the surprise of accidentally
  // deleting cases on a hidden tab.
  const getVisibleTestCases = (tab: string): TestCase[] =>
    testCases.filter((tc) => tab === "all" || tc.category === tab);

  const areAllVisibleSelected = (tab: string): boolean => {
    const visible = getVisibleTestCases(tab);
    if (visible.length === 0) return false;
    return visible.every((tc) => selectedTestCaseIds.has(tc.id));
  };

  const toggleSelectAllVisible = (tab: string) => {
    const visible = getVisibleTestCases(tab);
    if (visible.length === 0) return;
    setSelectedTestCaseIds((prev) => {
      const next = new Set(prev);
      const allSelected = visible.every((tc) => next.has(tc.id));
      if (allSelected) {
        visible.forEach((tc) => next.delete(tc.id));
      } else {
        visible.forEach((tc) => next.add(tc.id));
      }
      return next;
    });
  };

  const clearSelection = () => setSelectedTestCaseIds(new Set());

  const requestDeleteSelected = () => {
    if (selectedTestCaseIds.size === 0) return;
    setPendingDeleteIds(Array.from(selectedTestCaseIds));
  };

  const openBulkEdit = () => {
    if (selectedTestCaseIds.size === 0) return;
    setBulkEditPriority("unchanged");
    setBulkEditCategory("unchanged");
    setBulkEditOpen(true);
  };

  const applyBulkEdit = () => {
    if (selectedTestCaseIds.size === 0) {
      setBulkEditOpen(false);
      return;
    }
    if (bulkEditPriority === "unchanged" && bulkEditCategory === "unchanged") {
      setBulkEditOpen(false);
      toast({
        title: "Nothing to apply",
        description: "Pick at least one field to update.",
      });
      return;
    }
    const ids = selectedTestCaseIds;
    setTestCases((prev) =>
      prev.map((tc) =>
        ids.has(tc.id)
          ? {
              ...tc,
              priority: bulkEditPriority === "unchanged" ? tc.priority : bulkEditPriority,
              category: bulkEditCategory === "unchanged" ? tc.category : bulkEditCategory,
            }
          : tc,
      ),
    );
    setBulkEditOpen(false);
    toast({
      title: "Bulk update applied",
      description: `${ids.size} test case${ids.size === 1 ? "" : "s"} updated`,
    });
  };

  // Reusable bulk-action bar -- rendered above each test-case list
  // (Local / Jira / Ado views). Visible whenever at least one card is
  // selected. `currentTab` is plumbed through so "Select all" only operates
  // on what the user is currently looking at.
  const renderBulkActionBar = (currentTab: string) => {
    if (testCases.length === 0) return null;
    const visible = getVisibleTestCases(currentTab);
    const allVisibleSelected = areAllVisibleSelected(currentTab);
    const selectedCount = selectedTestCaseIds.size;
    return (
      <div className="flex items-center justify-between flex-wrap gap-2 rounded-md border bg-muted/30 px-3 py-2">
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-xs font-medium cursor-pointer select-none">
            <Checkbox
              checked={allVisibleSelected}
              onCheckedChange={() => toggleSelectAllVisible(currentTab)}
              aria-label="Select all visible test cases"
              data-testid="checkbox-select-all"
            />
            Select all
            <span className="text-muted-foreground">({visible.length})</span>
          </label>
          {selectedCount > 0 && (
            <span className="text-xs text-muted-foreground">
              {selectedCount} selected
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={openBulkEdit}
            disabled={selectedCount === 0}
            data-testid="button-bulk-edit"
          >
            <Pencil className="h-3 w-3 mr-1" />
            Bulk Edit
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={requestDeleteSelected}
            disabled={selectedCount === 0}
            className="text-destructive hover:text-destructive"
            data-testid="button-bulk-delete"
          >
            <Trash2 className="h-3 w-3 mr-1" />
            Delete Selected
          </Button>
          {selectedCount > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={clearSelection}
              data-testid="button-clear-selection"
            >
              Clear
            </Button>
          )}
        </div>
      </div>
    );
  };

  // Per-card checkbox that toggles inclusion in the bulk-selection set.
  // Stops propagation so clicking the checkbox doesn't also expand the card.
  const renderTestCaseCheckbox = (id: string) => (
    <div
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      className="flex-shrink-0 pt-0.5"
    >
      <Checkbox
        checked={isTestCaseSelected(id)}
        onCheckedChange={() => toggleTestCaseSelected(id)}
        aria-label={`Select test case ${id}`}
        data-testid={`checkbox-testcase-${id}`}
      />
    </div>
  );

  // Shared dialogs for editing a single test case, bulk-editing many at
  // once, and confirming destructive deletes. Rendered once per top-level
  // return (Local / Jira / Ado) so the same trigger buttons work in every
  // mode -- previously the single-edit dialog was only mounted in the Local
  // tree, which silently broke Edit in the other two modes.
  const renderTestCaseDialogs = () => (
    <>
      {/* Edit Test Case Modal */}
      <Dialog open={!!editingTestCase} onOpenChange={(open) => !open && setEditingTestCase(null)}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Test Case</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div>
              <Label className="text-sm mb-1.5 block">Title</Label>
              <Input
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                data-testid="input-edit-title"
              />
            </div>
            <div>
              <Label className="text-sm mb-1.5 block">Priority</Label>
              <Select value={editPriority} onValueChange={setEditPriority}>
                <SelectTrigger data-testid="select-edit-priority">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="P0">P0 - Critical</SelectItem>
                  <SelectItem value="P1">P1 - High</SelectItem>
                  <SelectItem value="P2">P2 - Medium</SelectItem>
                  <SelectItem value="P3">P3 - Low</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <div className="flex items-center justify-between mb-2">
                <Label className="text-sm">Steps</Label>
                <Button size="sm" variant="outline" onClick={handleAddStep} data-testid="button-add-step">
                  <Plus className="h-3 w-3 mr-1" />
                  Add Step
                </Button>
              </div>
              <div className="space-y-2">
                {editSteps.map((step, index) => (
                  <div key={index} className="flex gap-2 items-start">
                    <span className="text-xs text-muted-foreground font-mono w-6 pt-2.5 flex-shrink-0">
                      {index + 1}.
                    </span>
                    <Textarea
                      value={step.action}
                      onChange={(e) => handleUpdateStep(index, e.target.value)}
                      className="flex-1 min-h-[60px] resize-none"
                      placeholder="Enter step action..."
                      data-testid={`input-step-${index}`}
                    />
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8 flex-shrink-0"
                      onClick={() => handleRemoveStep(index)}
                      data-testid={`button-remove-step-${index}`}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingTestCase(null)}>
              Cancel
            </Button>
            <Button onClick={handleSaveEdit} data-testid="button-save-edit">
              <Save className="h-4 w-4 mr-1" />
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk Edit dialog -- update Priority and/or Category across every
          selected test case in one go. Each field can be left "Unchanged"
          so the user can update only what they want. */}
      <Dialog open={bulkEditOpen} onOpenChange={setBulkEditOpen}>
        <DialogContent className="max-w-md" data-testid="dialog-bulk-edit">
          <DialogHeader>
            <DialogTitle>Bulk Edit Test Cases</DialogTitle>
            <DialogDescription>
              Apply changes to {selectedTestCaseIds.size} selected test case
              {selectedTestCaseIds.size === 1 ? "" : "s"}. Leave a field as
              <span className="font-medium"> &quot;Unchanged&quot;</span> to keep
              its current value.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label className="text-sm mb-1.5 block">Priority</Label>
              <Select
                value={bulkEditPriority}
                onValueChange={(v) => setBulkEditPriority(v as typeof bulkEditPriority)}
              >
                <SelectTrigger data-testid="select-bulk-priority">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="unchanged">Unchanged</SelectItem>
                  <SelectItem value="P0">P0 - Critical</SelectItem>
                  <SelectItem value="P1">P1 - High</SelectItem>
                  <SelectItem value="P2">P2 - Medium</SelectItem>
                  <SelectItem value="P3">P3 - Low</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-sm mb-1.5 block">Category</Label>
              <Select
                value={bulkEditCategory}
                onValueChange={(v) => setBulkEditCategory(v as typeof bulkEditCategory)}
              >
                <SelectTrigger data-testid="select-bulk-category">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="unchanged">Unchanged</SelectItem>
                  <SelectItem value="functional">Functional</SelectItem>
                  <SelectItem value="negative">Negative</SelectItem>
                  <SelectItem value="edge_case">Edge Case</SelectItem>
                  <SelectItem value="security">Security</SelectItem>
                  <SelectItem value="accessibility">Accessibility</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBulkEditOpen(false)}>
              Cancel
            </Button>
            <Button onClick={applyBulkEdit} data-testid="button-bulk-edit-apply">
              <Save className="h-4 w-4 mr-1" />
              Apply
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation -- shared by single-card delete and bulk
          delete. Test cases live only in IndexedDB until the user pushes
          them out, so removal is irreversible for the session. */}
      <AlertDialog
        open={pendingDeleteIds !== null}
        onOpenChange={(open) => { if (!open) setPendingDeleteIds(null); }}
      >
        <AlertDialogContent data-testid="dialog-delete-confirm">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pendingDeleteIds && pendingDeleteIds.length === 1
                ? "Delete this test case?"
                : `Delete ${pendingDeleteIds?.length ?? 0} test cases?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              This will remove the selected test case
              {pendingDeleteIds && pendingDeleteIds.length === 1 ? "" : "s"} from the
              current generation. You will need to regenerate or re-import to
              get them back.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-delete-cancel">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => confirmDeleteIds(pendingDeleteIds ?? [])}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="button-delete-confirm"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );

  // Add step to edit form
  const handleAddStep = () => {
    setEditSteps([...editSteps, { step_number: editSteps.length + 1, action: "" }]);
  };

  // Update step in edit form
  const handleUpdateStep = (index: number, action: string) => {
    const updated = [...editSteps];
    updated[index] = { ...updated[index], action };
    setEditSteps(updated);
  };

  // Remove step from edit form
  const handleRemoveStep = (index: number) => {
    const updated = editSteps.filter((_, i) => i !== index).map((s, i) => ({ ...s, step_number: i + 1 }));
    setEditSteps(updated);
  };

  // Export test cases to Excel format with professional formatting via backend API
  const handleExportExcel = async () => {
    if (!testCases || testCases.length === 0) {
      toast({ title: "No Test Cases", description: "Please generate test cases first", variant: "destructive" });
      return;
    }

    setIsExporting(true);
    try {
      const metadata = {
        projectName: selectedProject?.name || brand.platformName,
        sprintName: selectedSprint?.name || 'Export',
        userStoryTitle: storyTitle || '',
        domain: newProjectDomain || 'General'
      };

      const response = await fetch('/api/export/test-cases/excel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ testCases, metadata })
      });

      if (!response.ok) {
        throw new Error('Export failed');
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      const sprintName = (selectedSprint?.name || 'Export').replace(/[^a-zA-Z0-9]/g, '_');
      const dateStr = new Date().toISOString().split('T')[0];
      link.download = `NAT2_TestCases_${sprintName}_${dateStr}.xlsx`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
      
      toast({ title: "Excel Exported", description: `${testCases.length} test cases exported with professional formatting` });
    } catch (error) {
      console.error('Export error:', error);
      toast({ title: "Export Failed", description: "Failed to export test cases to Excel", variant: "destructive" });
    } finally {
      setIsExporting(false);
    }
  };

  // Export test cases to formatted Text
  const handleExportText = () => {
    let textContent = `TEST CASES EXPORT\n`;
    textContent += `${"=".repeat(80)}\n`;
    textContent += `User Story: ${storyTitle || "N/A"}\n`;
    textContent += `Sprint: ${selectedSprint?.name || "N/A"}\n`;
    textContent += `Export Date: ${new Date().toLocaleString()}\n`;
    textContent += `Total Test Cases: ${testCases.length}\n`;
    textContent += `${"=".repeat(80)}\n\n`;
    
    testCases.forEach((tc, index) => {
      textContent += `\n${"─".repeat(80)}\n`;
      textContent += `TEST CASE ${index + 1}: ${tc.id || `TC_${String(index + 1).padStart(3, '0')}`}\n`;
      textContent += `${"─".repeat(80)}\n\n`;
      
      textContent += `TITLE: ${tc.title}\n\n`;
      
      if (tc.description) {
        textContent += `DESCRIPTION:\n${tc.description}\n\n`;
      }
      
      textContent += `CATEGORY: ${tc.category}\n`;
      textContent += `PRIORITY: ${tc.priority}\n\n`;
      
      if (tc.preconditions) {
        const preconditions = Array.isArray(tc.preconditions) ? tc.preconditions : [tc.preconditions];
        textContent += `PRECONDITIONS:\n`;
        preconditions.forEach((p, i) => {
          textContent += `  ${i + 1}. ${p}\n`;
        });
        textContent += `\n`;
      }
      
      textContent += `TEST STEPS:\n`;
      tc.steps.forEach((step, stepIndex) => {
        textContent += `  Step ${stepIndex + 1}: ${step.action}\n`;
        if (step.expected_behavior) {
          textContent += `    Expected: ${step.expected_behavior}\n`;
        }
      });
      textContent += `\n`;
      
      if (tc.expectedResult) {
        textContent += `EXPECTED RESULT:\n${tc.expectedResult}\n\n`;
      }
      
      if (tc.postconditions && tc.postconditions.length > 0) {
        textContent += `POSTCONDITIONS:\n`;
        tc.postconditions.forEach((p, i) => {
          textContent += `  ${i + 1}. ${p}\n`;
        });
        textContent += `\n`;
      }
    });
    
    textContent += `\n${"=".repeat(80)}\n`;
    textContent += `END OF TEST CASES\n`;
    textContent += `${"=".repeat(80)}\n`;
    
    const blob = new Blob([textContent], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `test-cases-${selectedSprint?.name || "export"}-${Date.now()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
    toast({ title: "Text Exported", description: `${testCases.length} test cases exported to Text` });
  };

  // Export BDD assets as ZIP
  const handleExportBddAssets = async () => {
    if (!generatedBddAssets) {
      toast({ title: "No BDD Assets", description: "Generate test cases first to create BDD assets", variant: "destructive" });
      return;
    }

    setIsExportingBdd(true);
    try {
      const response = await fetch("/api/export/bdd-assets/zip", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          testCases: testCases,
          userStoryTitle: storyTitle || selectedSprint?.name || "BDD-Test-Suite",
          userStoryDescription: storyDescription || storyTitle || selectedSprint?.name || "test story",
          frameworkConfigId: selectedFrameworkConfigId || null,
          // Legacy fields kept for backward compatibility
          bddAssets: {
            featureFiles: generatedBddAssets.featureFiles?.map((f: any) => ({
              name: f.name,
              content: f.content
            })) || [],
            stepDefinitions: generatedBddAssets.stepDefinitions?.map((s: any) => ({
              name: s.name,
              content: s.content
            })) || [],
            pageObjects: generatedBddAssets.pageObjects?.map((p: any) => ({
              name: p.name,
              content: p.content
            })) || [],
            utilities: [
              { name: "generic-actions", content: generatedBddAssets.utilities?.genericActions || "" },
              { name: "wait-helpers", content: generatedBddAssets.utilities?.waitHelpers || "" },
              { name: "assertion-helpers", content: generatedBddAssets.utilities?.assertionHelpers || "" }
            ]
          },
          projectName: storyTitle || selectedSprint?.name || "BDD-Test-Suite",
          domain: "General"
        })
      });

      if (!response.ok) throw new Error("Failed to download BDD assets");

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = response.headers.get("Content-Disposition")?.split("filename=")[1]?.replace(/"/g, "") || "bdd-assets.zip";
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      a.remove();
      toast({ title: "BDD Assets Exported", description: "Complete Playwright + Cucumber.js test suite downloaded" });
    } catch (error) {
      console.error("Failed to download BDD assets:", error);
      toast({ title: "Export Failed", description: "Failed to export BDD assets", variant: "destructive" });
    } finally {
      setIsExportingBdd(false);
    }
  };

  const handleExportPlaywright = () => {
    if (testCases.length === 0) return;
    try {
      const scriptContent = generateFullPlaywrightScript(testCases);
      setShowAutomationScript(scriptContent);
      setAutomationFramework('playwright');
      const blob = new Blob([scriptContent], { type: "text/typescript" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "generated-tests.spec.ts";
      a.click();
      URL.revokeObjectURL(url);
      toast({ title: "Playwright Script Downloaded", description: `${testCases.length} test cases exported as .spec.ts` });
    } catch (error) {
      console.error("Failed to export Playwright script:", error);
      toast({ title: "Export Failed", description: "Failed to generate Playwright script", variant: "destructive" });
    }
  };

  const handleExportSelenium = () => {
    if (testCases.length === 0) return;
    const script = generateFullSeleniumScript(testCases);
    const safeTitle = (storyTitle || 'GeneratedTests').replace(/[^a-zA-Z0-9]/g, '');
    const blob = new Blob([script], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${safeTitle}.java`;
    a.click();
    URL.revokeObjectURL(url);
    toast({ title: "Selenium Script Downloaded", description: `${testCases.length} test cases exported as .java` });
  };

  const handleExportTestComplete = async () => {
    if (testCases.length === 0) return;
    try {
      const tcTitle = storyTitle || 'GeneratedTest';
      const tcModule = selectedProject?.domain || 'Application';
      const response = await fetch("/api/generate/testcomplete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: tcTitle,
          module: tcModule,
          acceptanceCriteria: acceptanceCriteria || testCases.map(tc => tc.title).join('\n'),
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Generation failed');
      const safeTitle = tcTitle.replace(/[^a-zA-Z0-9]/g, '_');
      // Download each JS file
      (result.files || []).forEach((f: { name: string; content: string }, idx: number) => {
        setTimeout(() => {
          const blob = new Blob([f.content], { type: "text/javascript" });
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url; a.download = f.name; a.click();
          URL.revokeObjectURL(url);
        }, idx * 200);
      });
      // Download BDD feature
      setTimeout(() => {
        const blobF = new Blob([result.bddFeature], { type: "text/plain" });
        const urlF = URL.createObjectURL(blobF);
        const aF = document.createElement("a");
        aF.href = urlF; aF.download = `${safeTitle}.feature`; aF.click();
        URL.revokeObjectURL(urlF);
      }, (result.files?.length || 4) * 200 + 200);
      toast({ title: "TestComplete Project Downloaded", description: `${(result.files?.length || 4) + 1} files downloaded` });
    } catch (err: any) {
      toast({ title: "Export Failed", description: err.message, variant: "destructive" });
    }
  };

  const handleGenerateScriptsInline = async (framework: 'playwright' | 'selenium') => {
    if (testCases.length === 0) return;
    setIsGeneratingScripts(true);
    setAutomationFramework(framework);
    try {
      if (framework === 'playwright') {
        const scriptContent = generateFullPlaywrightScript(testCases);
        setShowAutomationScript(scriptContent);
        const updatedCases = testCases.map(tc => ({
          ...tc,
          playwrightScript: generatePlaywrightScript(tc),
        }));
        setTestCases(updatedCases);
        saveTestCasesToDb(updatedCases);
        toast({ title: "Playwright + TypeScript Scripts Generated", description: `Scripts generated for ${testCases.length} test cases` });
      } else {
        const fullScript = generateFullSeleniumScript(testCases);
        setShowAutomationScript(fullScript);
        const updatedCases = testCases.map(tc => ({
          ...tc,
          playwrightScript: generateSeleniumScript(tc),
        }));
        setTestCases(updatedCases);
        saveTestCasesToDb(updatedCases);
        toast({ title: "Selenium + Java Scripts Generated", description: `Scripts generated for ${testCases.length} test cases` });
      }
    } catch (error) {
      console.error(`Failed to generate ${framework} scripts:`, error);
      toast({ title: "Generation Failed", description: `Failed to generate ${framework} scripts`, variant: "destructive" });
    } finally {
      setIsGeneratingScripts(false);
    }
  };

  const saveTestCasesToDb = async (cases: TestCase[]) => {
    if (useJiraMode && selectedJiraProjectKey && selectedJiraUserStory) {
      try {
        await fetch('/api/jira/save-test-cases', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jiraProjectKey: selectedJiraProjectKey,
            jiraStoryId: selectedJiraUserStory.id,
            jiraStoryTitle: selectedJiraUserStory.title,
            testCases: cases,
            jiraBoardId: selectedJiraBoard,
            jiraSprintId: selectedJiraSprint,
          }),
        });
      } catch (e) {
        console.error('Failed to save test cases:', e);
      }
    }
  };

  const generatePlaywrightScript = (tc: TestCase): string => {
    const steps = tc.steps.map(s => {
      const action = s.action.toLowerCase();
      if (action.includes('navigate') || action.includes('go to') || action.includes('open')) {
        return `  // Step ${s.step_number}: ${s.action}\n  await page.goto('https://your-app.com');\n  // Expected: ${s.expected_behavior || 'Page loads'}`;
      } else if (action.includes('click')) {
        return `  // Step ${s.step_number}: ${s.action}\n  await page.click('[data-testid="target-element"]');\n  // Expected: ${s.expected_behavior || 'Action completed'}`;
      } else if (action.includes('enter') || action.includes('type') || action.includes('input') || action.includes('fill')) {
        return `  // Step ${s.step_number}: ${s.action}\n  await page.fill('[data-testid="input-field"]', 'test-data');\n  // Expected: ${s.expected_behavior || 'Input accepted'}`;
      } else if (action.includes('verify') || action.includes('assert') || action.includes('check') || action.includes('confirm')) {
        return `  // Step ${s.step_number}: ${s.action}\n  await expect(page.locator('[data-testid="target-element"]')).toBeVisible();\n  // Expected: ${s.expected_behavior || 'Verification passed'}`;
      } else {
        return `  // Step ${s.step_number}: ${s.action}\n  // TODO: Implement this step\n  // Expected: ${s.expected_behavior || 'Step completed'}`;
      }
    }).join('\n\n');

    return `import { test, expect } from '@playwright/test';\n\ntest('${tc.title.replace(/'/g, "\\'")}', async ({ page }) => {\n${steps}\n});`;
  };

  const generateFullPlaywrightScript = (cases: TestCase[]): string => {
    const tests = cases.map(tc => {
      const single = generatePlaywrightScript(tc);
      return single.replace(/^import[^\n]+\n\n?/, '').trim();
    }).join('\n\n');
    return `import { test, expect } from '@playwright/test';\n\n${tests}`;
  };

  const generateSeleniumScript = (tc: TestCase): string => {
    const className = tc.id.replace(/[^a-zA-Z0-9]/g, '_');
    const steps = tc.steps.map(s => {
      const action = s.action.toLowerCase();
      if (action.includes('navigate') || action.includes('go to') || action.includes('open')) {
        return `        // Step ${s.step_number}: ${s.action}\n        driver.get("https://your-app.com");\n        // Expected: ${s.expected_behavior || 'Page loads'}`;
      } else if (action.includes('click')) {
        return `        // Step ${s.step_number}: ${s.action}\n        WebElement element${s.step_number} = wait.until(ExpectedConditions.elementToBeClickable(By.cssSelector("[data-testid='target-element']")));\n        element${s.step_number}.click();\n        // Expected: ${s.expected_behavior || 'Action completed'}`;
      } else if (action.includes('enter') || action.includes('type') || action.includes('input') || action.includes('fill')) {
        return `        // Step ${s.step_number}: ${s.action}\n        WebElement input${s.step_number} = wait.until(ExpectedConditions.visibilityOfElementLocated(By.cssSelector("[data-testid='input-field']")));\n        input${s.step_number}.clear();\n        input${s.step_number}.sendKeys("test-data");\n        // Expected: ${s.expected_behavior || 'Input accepted'}`;
      } else if (action.includes('verify') || action.includes('assert') || action.includes('check') || action.includes('confirm')) {
        return `        // Step ${s.step_number}: ${s.action}\n        WebElement verify${s.step_number} = wait.until(ExpectedConditions.visibilityOfElementLocated(By.cssSelector("[data-testid='target-element']")));\n        Assert.assertTrue("Element should be visible", verify${s.step_number}.isDisplayed());\n        // Expected: ${s.expected_behavior || 'Verification passed'}`;
      } else if (action.includes('select') || action.includes('dropdown') || action.includes('choose')) {
        return `        // Step ${s.step_number}: ${s.action}\n        WebElement dropdown${s.step_number} = wait.until(ExpectedConditions.elementToBeClickable(By.cssSelector("[data-testid='dropdown']")));\n        new Select(dropdown${s.step_number}).selectByVisibleText("option");\n        // Expected: ${s.expected_behavior || 'Option selected'}`;
      } else if (action.includes('wait')) {
        return `        // Step ${s.step_number}: ${s.action}\n        Thread.sleep(2000); // TODO: Replace with explicit wait\n        // Expected: ${s.expected_behavior || 'Wait completed'}`;
      } else {
        return `        // Step ${s.step_number}: ${s.action}\n        // TODO: Implement this step\n        // Expected: ${s.expected_behavior || 'Step completed'}`;
      }
    }).join('\n\n');

    return `package tests;\n\nimport org.junit.Assert;\nimport org.junit.After;\nimport org.junit.Before;\nimport org.junit.Test;\nimport org.openqa.selenium.By;\nimport org.openqa.selenium.WebDriver;\nimport org.openqa.selenium.WebElement;\nimport org.openqa.selenium.chrome.ChromeDriver;\nimport org.openqa.selenium.support.ui.ExpectedConditions;\nimport org.openqa.selenium.support.ui.Select;\nimport org.openqa.selenium.support.ui.WebDriverWait;\nimport java.time.Duration;\n\npublic class ${className}Test {\n    private WebDriver driver;\n    private WebDriverWait wait;\n\n    @Before\n    public void setUp() {\n        driver = new ChromeDriver();\n        driver.manage().window().maximize();\n        wait = new WebDriverWait(driver, Duration.ofSeconds(10));\n    }\n\n    @Test\n    public void ${className.charAt(0).toLowerCase() + className.slice(1)}() {\n${steps}\n    }\n\n    @After\n    public void tearDown() {\n        if (driver != null) {\n            driver.quit();\n        }\n    }\n}`;
  };

  const generateFullSeleniumScript = (cases: TestCase[]): string => {
    const imports = `package tests;\n\nimport org.junit.Assert;\nimport org.junit.After;\nimport org.junit.Before;\nimport org.junit.Test;\nimport org.openqa.selenium.By;\nimport org.openqa.selenium.WebDriver;\nimport org.openqa.selenium.WebElement;\nimport org.openqa.selenium.chrome.ChromeDriver;\nimport org.openqa.selenium.support.ui.ExpectedConditions;\nimport org.openqa.selenium.support.ui.Select;\nimport org.openqa.selenium.support.ui.WebDriverWait;\nimport java.time.Duration;\n`;

    const testMethods = cases.map(tc => {
      const methodName = tc.id.replace(/[^a-zA-Z0-9]/g, '_');
      const steps = tc.steps.map(s => {
        const action = s.action.toLowerCase();
        if (action.includes('navigate') || action.includes('go to') || action.includes('open')) {
          return `        // Step ${s.step_number}: ${s.action}\n        driver.get("https://your-app.com");`;
        } else if (action.includes('click')) {
          return `        // Step ${s.step_number}: ${s.action}\n        wait.until(ExpectedConditions.elementToBeClickable(By.cssSelector("[data-testid='target-element']"))).click();`;
        } else if (action.includes('enter') || action.includes('type') || action.includes('input') || action.includes('fill')) {
          return `        // Step ${s.step_number}: ${s.action}\n        WebElement input${s.step_number} = wait.until(ExpectedConditions.visibilityOfElementLocated(By.cssSelector("[data-testid='input-field']")));\n        input${s.step_number}.clear();\n        input${s.step_number}.sendKeys("test-data");`;
        } else if (action.includes('verify') || action.includes('assert') || action.includes('check') || action.includes('confirm')) {
          return `        // Step ${s.step_number}: ${s.action}\n        Assert.assertTrue(wait.until(ExpectedConditions.visibilityOfElementLocated(By.cssSelector("[data-testid='target-element']"))).isDisplayed());`;
        } else if (action.includes('select') || action.includes('dropdown')) {
          return `        // Step ${s.step_number}: ${s.action}\n        new Select(wait.until(ExpectedConditions.elementToBeClickable(By.cssSelector("[data-testid='dropdown']")))).selectByVisibleText("option");`;
        } else {
          return `        // Step ${s.step_number}: ${s.action}\n        // TODO: Implement this step`;
        }
      }).join('\n\n');

      return `    @Test\n    public void test_${methodName}() {\n        // ${tc.title}\n${steps}\n    }`;
    }).join('\n\n');

    return `${imports}\npublic class GeneratedTests {\n    private WebDriver driver;\n    private WebDriverWait wait;\n\n    @Before\n    public void setUp() {\n        driver = new ChromeDriver();\n        driver.manage().window().maximize();\n        wait = new WebDriverWait(driver, Duration.ofSeconds(10));\n    }\n\n${testMethods}\n\n    @After\n    public void tearDown() {\n        if (driver != null) {\n            driver.quit();\n        }\n    }\n}`;
  };

  const handleGenerateTestComplete = async () => {
    if (testCases.length === 0) {
      toast({ title: "No test cases", description: "Generate test cases first before creating TestComplete scripts", variant: "destructive" });
      return;
    }
    setIsGeneratingTC(true);
    setShowAutomationScript(null);
    setShowTCScripts(null);
    try {
      const tcStoryTitle = storyTitle || 'GeneratedTest';
      const tcStoryModule = selectedProject?.domain || 'Application';
      const response = await fetch("/api/generate/testcomplete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: tcStoryTitle,
          module: tcStoryModule,
          acceptanceCriteria: acceptanceCriteria || testCases.map(tc => tc.title).join('\n'),
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Generation failed');
      setShowTCScripts(result);
      setTcActiveFile('Main.js');
      const fileCount = (result.files?.length || 0) + 2; // +BDD +DDT
      toast({ title: "TestComplete Project Generated", description: `${fileCount} files ready: ${(result.files || []).map((f: { name: string }) => f.name).join(', ')}, BDD, DDT` });
    } catch (err: any) {
      toast({ title: "Generation failed", description: err.message, variant: "destructive" });
    } finally {
      setIsGeneratingTC(false);
    }
  };

  // Save user story to database
  const handleSaveUserStory = async () => {
    if (!selectedSprintId || !storyTitle.trim()) {
      toast({ title: "Error", description: "Please enter a user story title", variant: "destructive" });
      return;
    }
    
    setIsSavingUserStory(true);
    try {
      const res = await apiRequest("POST", `/api/sprints/${selectedSprintId}/user-stories`, {
        title: storyTitle,
        description: storyDescription,
        acceptanceCriteria: acceptanceCriteria,
      });
      const newUserStory = await res.json();
      setSelectedUserStoryId(newUserStory.id);
      queryClient.invalidateQueries({ queryKey: ["/api/sprints", selectedSprintId, "user-stories"] });
      toast({ title: "User story saved", description: storyTitle });
    } catch (error: any) {
      toast({ title: "Save failed", description: error.message, variant: "destructive" });
    } finally {
      setIsSavingUserStory(false);
    }
  };

  // Save all test cases to database (linked to user story)
  const handleSaveAll = async () => {
    if (!selectedUserStoryId || testCases.length === 0) {
      toast({ title: "Error", description: "Please save the user story first", variant: "destructive" });
      return;
    }
    
    setIsSaving(true);
    try {
      await apiRequest("POST", `/api/sprint-user-stories/${selectedUserStoryId}/test-cases`, {
        testCases: testCases.map(tc => ({
          testCaseId: tc.id,
          title: tc.title,
          category: tc.category,
          priority: tc.priority,
          steps: tc.steps
        }))
      });
      queryClient.invalidateQueries({ queryKey: ["/api/sprint-user-stories", selectedUserStoryId, "test-cases"] });
      toast({ title: "Saved", description: `${testCases.length} test cases saved` });
    } catch (error: any) {
      toast({ title: "Save failed", description: error.message, variant: "destructive" });
    } finally {
      setIsSaving(false);
    }
  };

  // Push test cases to Azure DevOps
  const handlePushToAdo = async () => {
    if (!selectedAdoProject || testCases.length === 0) {
      toast({ title: "Error", description: "Please select an ADO project and generate test cases first", variant: "destructive" });
      return;
    }
    
    setIsPushingToAdo(true);
    setPushResults(null);
    
    try {
      const response = await fetch("/api/ado/env/push-test-cases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectName: selectedAdoProject,
          testCases: testCases.map(tc => ({
            testCaseId: tc.id,
            title: tc.title,
            description: tc.description || tc.objective || "",
            objective: tc.objective || "",
            priority: tc.priority,
            testSteps: tc.steps.map(s => ({
              action: s.action,
              expected_behavior: s.expected_behavior || ""
            }))
          }))
        })
      });
      
      const result = await response.json();
      
      if (result.success) {
        setPushResults({
          success: true,
          message: result.message,
          createdTestCases: result.createdTestCases
        });
        toast({ 
          title: "Pushed to Azure DevOps", 
          description: `${result.pushedCount} test cases pushed successfully` 
        });
      } else {
        setPushResults({
          success: false,
          message: result.error || "Failed to push test cases"
        });
        toast({ 
          title: "Push failed", 
          description: result.error || "Failed to push test cases to Azure DevOps", 
          variant: "destructive" 
        });
      }
    } catch (error: any) {
      setPushResults({
        success: false,
        message: error.message || "Failed to push test cases"
      });
      toast({ 
        title: "Push failed", 
        description: error.message || "Failed to push test cases to Azure DevOps", 
        variant: "destructive" 
      });
    } finally {
      setIsPushingToAdo(false);
    }
  };

  const handlePushToJira = async () => {
    if (!selectedJiraProjectKey || testCases.length === 0) {
      toast({ title: "Error", description: "Please select a Jira project and generate test cases first", variant: "destructive" });
      return;
    }
    
    setIsPushingToJira(true);
    setJiraPushResults(null);

    const pushToast = toast({
      title: "Pushing to Jira",
      description: `Pushing ${testCases.length} test case(s) to Jira. Please wait…`,
      duration: Infinity,
    });

    try {
      const response = await fetch("/api/jira/push-test-cases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          projectKey: selectedJiraProjectKey,
          ...(selectedProjectId ? { qeProjectId: selectedProjectId } : {}),
          testCases: testCases.map(tc => ({
            testCaseId: tc.id,
            title: tc.title,
            description: tc.description || tc.objective || "",
            objective: tc.objective || "",
            priority: tc.priority,
            testSteps: tc.steps.map(s => ({
              action: s.action,
              expected_behavior: s.expected_behavior || ""
            }))
          }))
        })
      });

      if (!response.ok && response.status !== 202) {
        const errBody = await response.json().catch(() => ({} as { error?: string; message?: string }));
        throw new Error(errBody.error || errBody.message || `Push failed (HTTP ${response.status})`);
      }

      let result = await response.json();

      // Hosted API Gateway times out long requests (~29s → 503). Backend returns 202 + jobId.
      if (response.status === 202 && result?.jobId) {
        result = await pollQeJiraPushJob<typeof result>(result.jobId);
      }
      
      pushToast.dismiss();

      if (result.success) {
        setJiraPushResults({
          success: true,
          message: result.message,
          createdTestCases: result.createdTestCases
        });
        toast({
          title: "Pushed to Jira",
          description: `${result.pushedCount} test cases pushed successfully`,
          variant: "success",
        });
      } else {
        setJiraPushResults({ success: false, message: result.error || "Failed to push test cases" });
        toast({ title: "Push failed", description: result.error || "Failed to push test cases to Jira", variant: "destructive" });
      }
    } catch (error: any) {
      pushToast.dismiss();
      setJiraPushResults({ success: false, message: error.message || "Failed to push test cases" });
      toast({ title: "Push failed", description: error.message || "Failed to push test cases to Jira", variant: "destructive" });
    } finally {
      setIsPushingToJira(false);
    }
  };

  const getDomainColor = (domain: string) => {
    switch (domain?.toLowerCase()) {
      case "insurance": return "border-l-purple-500 bg-purple-500/5";
      case "healthcare": return "border-l-cyan-500 bg-cyan-500/5";
      case "finance": return "border-l-amber-500 bg-amber-500/5";
      case "e-commerce": return "border-l-emerald-500 bg-emerald-500/5";
      case "technology": return "border-l-blue-500 bg-blue-500/5";
      default: return "border-l-slate-500 bg-slate-500/5";
    }
  };

  const selectedProject = projects.find(p => p.id === selectedProjectId);
  const selectedSprint = sprints.find(s => s.id === selectedSprintId);

  // Check if the mode is active and user story is selected
  const isReadyToGenerate = useAdoMode 
    ? (selectedAdoProject && selectedAdoIteration && selectedAdoUserStory)
    : useJiraMode
    ? (selectedJiraProjectKey && selectedJiraUserStory)
    : (selectedProjectId && selectedSprintId);

  // ADO Mode: Single page with dropdowns for project, sprint, and user story
  if (useAdoMode) {
    return (
      <>
        <DashboardHeader />
        <main className="flex-1 overflow-y-auto">
            <div className="border-b p-6 bg-card">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setLocation('/dashboard')}
                    className="h-9 shrink-0 gap-1.5 rounded-full border-border bg-card px-4 font-medium text-foreground shadow-sm hover:bg-muted"
                    data-testid="button-back-dashboard"
                  >
                    <ArrowLeft className="h-4 w-4 shrink-0" />
                    Dashboard
                  </Button>
                  <div className="w-px h-8 bg-border" />
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <Cloud className="h-5 w-5 text-blue-500" />
                      <h1 className="text-2xl font-bold">Generate from User Stories</h1>
                    </div>
                    <p className="text-sm text-muted-foreground">Connected to Azure DevOps - Select a project, sprint, and user story</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button 
                    variant="outline" 
                    size="sm"
                    onClick={() => setStorySource('jira')}
                    data-testid="button-switch-jira"
                  >
                    Jira
                  </Button>
                  <Button 
                    variant="outline" 
                    size="sm"
                    onClick={() => setStorySource('local')}
                    data-testid="button-switch-local"
                  >
                    Local Projects
                  </Button>
                </div>
              </div>
            </div>

            <div className="flex flex-1 overflow-hidden">
              {/* Left Panel - Selection */}
              <div className="w-96 border-r overflow-y-auto p-6 space-y-6">
                {/* ADO Project Selection */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <Label className="text-sm font-medium">Project</Label>
                    <Button 
                      size="icon" 
                      variant="ghost" 
                      className="h-6 w-6"
                      onClick={() => refetchAdoProjects()}
                      data-testid="button-refresh-projects"
                    >
                      <RefreshCw className="h-3 w-3" />
                    </Button>
                  </div>
                  <Select 
                    value={selectedAdoProject || ""} 
                    onValueChange={(val) => setSelectedAdoProject(val)}
                  >
                    <SelectTrigger data-testid="select-ado-project">
                      <SelectValue placeholder={adoProjectsLoading ? "Loading projects..." : "Select a project"} />
                    </SelectTrigger>
                    <SelectContent>
                      {adoProjects.map(p => (
                        <SelectItem key={p.id} value={p.name}>
                          <div className="flex items-center gap-2">
                            <Cloud className="h-4 w-4 text-blue-500" />
                            {p.name}
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* ADO Sprint/Iteration Selection */}
                {selectedAdoProject && (
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <Label className="text-sm font-medium">Sprint / Iteration</Label>
                      <Button 
                        size="icon" 
                        variant="ghost" 
                        className="h-6 w-6"
                        onClick={() => refetchAdoIterations()}
                        data-testid="button-refresh-iterations"
                      >
                        <RefreshCw className="h-3 w-3" />
                      </Button>
                    </div>
                    <Select 
                      value={selectedAdoIteration || ""} 
                      onValueChange={(val) => {
                        setSelectedAdoIteration(val);
                        const iter = adoIterations.find(i => i.id === val);
                        setSelectedAdoIterationPath(iter?.path || null);
                      }}
                    >
                      <SelectTrigger data-testid="select-ado-sprint">
                        <SelectValue placeholder={adoIterationsLoading ? "Loading sprints..." : "Select a sprint"} />
                      </SelectTrigger>
                      <SelectContent>
                        {adoIterations.map(i => (
                          <SelectItem key={i.id} value={i.id}>
                            <div className="flex items-center gap-2">
                              <Calendar className="h-4 w-4 text-muted-foreground" />
                              {i.name}
                              {i.timeFrame && (
                                <Badge variant="outline" className="ml-2 text-xs">{i.timeFrame}</Badge>
                              )}
                            </div>
                          </SelectItem>
                        ))}
                        {adoIterations.length === 0 && !adoIterationsLoading && (
                          <SelectItem value="_none" disabled>No sprints found</SelectItem>
                        )}
                      </SelectContent>
                    </Select>
                  </div>
                )}

                {/* ADO User Story Selection */}
                {selectedAdoIteration && (
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <Label className="text-sm font-medium">User Story</Label>
                      <Button 
                        size="icon" 
                        variant="ghost" 
                        className="h-6 w-6"
                        onClick={() => refetchAdoUserStories()}
                        data-testid="button-refresh-stories"
                      >
                        <RefreshCw className="h-3 w-3" />
                      </Button>
                    </div>
                    {adoUserStoriesLoading ? (
                      <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Loading user stories...
                      </div>
                    ) : adoUserStories.length === 0 ? (
                      <div className="text-sm text-muted-foreground py-2">
                        No user stories found in this sprint
                      </div>
                    ) : (
                      <ScrollArea className="h-64 border rounded-md">
                        <div className="p-2 space-y-2">
                          {adoUserStories.map(story => (
                            <Card
                              key={story.id}
                              className={`p-3 cursor-pointer hover-elevate ${selectedAdoUserStory?.id === story.id ? 'border-primary bg-primary/5' : ''}`}
                              onClick={() => setSelectedAdoUserStory(story)}
                              data-testid={`card-ado-story-${story.id}`}
                            >
                              <div className="flex items-start gap-2">
                                <FileText className="h-4 w-4 mt-0.5 text-muted-foreground flex-shrink-0" />
                                <div className="flex-1 min-w-0">
                                  <p className="text-sm font-medium line-clamp-2">{story.title}</p>
                                  <div className="flex items-center gap-2 mt-1">
                                    <Badge variant="outline" className="text-xs">#{story.id}</Badge>
                                    <Badge variant="secondary" className="text-xs">{story.state}</Badge>
                                  </div>
                                </div>
                              </div>
                            </Card>
                          ))}
                        </div>
                      </ScrollArea>
                    )}
                  </div>
                )}
              </div>

              {/* Right Panel - User Story Details & Generation */}
              <div className="flex-1 overflow-y-auto p-6">
                {selectedAdoUserStory ? (
                  <div className="w-full space-y-6">
                    <Card className="p-6">
                      <div className="flex items-start justify-between mb-4">
                        <div>
                          <Badge variant="outline" className="mb-2">#{selectedAdoUserStory.id}</Badge>
                          <h2 className="text-xl font-semibold">{selectedAdoUserStory.title}</h2>
                        </div>
                        <Badge variant="secondary">{selectedAdoUserStory.state}</Badge>
                      </div>
                      
                      <div className="space-y-4">
                        <div>
                          <Label className="text-sm mb-1.5 block">User Story Title</Label>
                          <Input 
                            value={storyTitle}
                            onChange={e => setStoryTitle(e.target.value)}
                            data-testid="input-story-title"
                          />
                        </div>
                        <div>
                          <Label className="text-sm mb-1.5 block">Description</Label>
                          <Textarea 
                            value={storyDescription}
                            onChange={e => setStoryDescription(e.target.value)}
                            className="min-h-[100px]"
                            data-testid="textarea-story-desc"
                          />
                        </div>
                        <div>
                          <Label className="text-sm mb-1.5 block">Acceptance Criteria</Label>
                          <Textarea
                            value={acceptanceCriteria}
                            onChange={e => setAcceptanceCriteria(e.target.value)}
                            className="min-h-[100px]"
                            data-testid="textarea-acceptance-criteria"
                          />
                        </div>

                        {/* Framework Config Selector */}
                        {frameworkConfigs.length > 0 && (
                          <div>
                            <Label className="text-sm mb-1.5 block flex items-center gap-1.5">
                              <span>Framework Catalog</span>
                              <span className="text-xs text-muted-foreground font-normal">(optional — shapes generated scripts to your team's patterns)</span>
                            </Label>
                            <select
                              value={selectedFrameworkConfigId}
                              onChange={e => setSelectedFrameworkConfigId(e.target.value)}
                              className="w-full h-9 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
                              data-testid="select-framework-config"
                            >
                              <option value="">— None (use generic patterns) —</option>
                              {frameworkConfigs.map(fc => (
                                <option key={fc.id} value={fc.id}>
                                  {fc.name} ({fc.framework}/{fc.language}){fc.isGlobal ? " 🌐" : ""}{fc.functionCount ? ` · ${fc.functionCount} fns` : ""}
                                </option>
                              ))}
                            </select>
                          </div>
                        )}

                        {/* Use Golden Repo Guidance toggle (SDLC RAG, mirrors BRD) */}
                        <div className="flex items-center justify-between rounded-md border border-input bg-background px-3 py-2">
                          <div className="space-y-0.5">
                            <label className="text-xs font-medium text-foreground flex items-center gap-1.5">
                              <span>🏛️</span> Use Golden Repo Guidance
                            </label>
                            <p className="text-[11px] text-muted-foreground/80 leading-snug max-w-[26rem]">
                              Pull standards & patterns from this project's SDLC Golden Repo into test generation. Same data source BRD uses. No-op if no Golden Repo files are configured.
                            </p>
                          </div>
                          <Switch
                            checked={useGoldenRepoGuidance}
                            onCheckedChange={setUseGoldenRepoGuidance}
                            disabled={isGenerating}
                            data-testid="qe-toggle-use-golden-repo"
                          />
                        </div>

                        {/* Golden Repo Path input */}
                        <div className="space-y-1">
                          <label className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                            <span>📁</span> Local Repo Path
                            <span className="text-xs font-normal text-muted-foreground/60">(optional — local-only fallback for codebase scanning)</span>
                          </label>
                          <input
                            type="text"
                            placeholder="e.g. C:\Projects\my-app  or  /home/user/my-app"
                            value={repoPath}
                            onChange={e => setRepoPath(e.target.value)}
                            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 font-mono"
                            disabled={isGenerating}
                          />
                          {repoPath.trim() && (
                            <p className="text-xs text-emerald-500 flex items-center gap-1">
                              <span>✓</span> Claude will scan this repo and use real endpoints, schema fields, and risk areas to enrich test cases
                            </p>
                          )}
                        </div>

                        {/* Context Documents upload */}
                        <div className="space-y-2">
                          <label className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                            <FilePlus2 className="h-3.5 w-3.5" />
                            Context Documents
                            <span className="text-xs font-normal text-muted-foreground/60">(optional — BRD, FRD, existing test cases, SRS)</span>
                          </label>

                          {/* Drop zone / file picker */}
                          <label
                            className={[
                              "flex flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed px-4 py-5 cursor-pointer transition-colors",
                              isUploading
                                ? "border-muted/40 bg-muted/10 cursor-not-allowed opacity-60"
                                : "border-muted/50 bg-muted/5 hover:border-primary/40 hover:bg-primary/5",
                            ].join(" ")}
                          >
                            <input
                              type="file"
                              multiple
                              accept=".pdf,.docx,.xlsx,.xls,.txt,.md,.feature,.spec.ts,.spec.js,.json"
                              className="sr-only"
                              disabled={isUploading || isGenerating}
                              onChange={e => handleDocumentUpload(e.target.files)}
                            />
                            {isUploading ? (
                              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                            ) : (
                              <FileUp className="h-5 w-5 text-muted-foreground" />
                            )}
                            <span className="text-xs text-muted-foreground text-center">
                              {isUploading
                                ? "Extracting text…"
                                : "Click to upload or drag files here"}
                            </span>
                            <span className="text-[10px] text-muted-foreground/60">
                              PDF, DOCX, XLSX, TXT, MD, .feature · up to 5 files · 10 MB each
                            </span>
                          </label>

                          {/* Uploaded files list */}
                          {uploadedDocs.length > 0 && (
                            <ul className="space-y-1">
                              {uploadedDocs.map((doc, idx) => (
                                <li
                                  key={idx}
                                  className="flex items-center gap-2 rounded-md bg-muted/20 px-3 py-1.5 text-xs"
                                >
                                  <FileText className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                                  <span className="truncate flex-1 font-mono text-[11px]">{doc.fileName}</span>
                                  <span className="text-muted-foreground/70 shrink-0">
                                    {(doc.charCount / 1000).toFixed(1)}k chars
                                    {doc.truncated && <span className="text-amber-400 ml-1">(truncated)</span>}
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() => handleRemoveUploadedDoc(idx)}
                                    disabled={isGenerating}
                                    className="ml-1 text-muted-foreground/50 hover:text-destructive disabled:cursor-not-allowed"
                                    aria-label={`Remove ${doc.fileName}`}
                                  >
                                    <XCircle className="h-3.5 w-3.5" />
                                  </button>
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>

                        <Button
                          onClick={handleGenerate}
                          disabled={isGenerating || !storyTitle.trim()}
                          className="w-full"
                          data-testid="button-generate-tests"
                        >
                          {isGenerating ? (
                            <>
                              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                              Generating Test Cases...
                            </>
                          ) : (
                            <>
                              <Sparkles className="h-4 w-4 mr-2" />
                              Generate Test Cases
                            </>
                          )}
                        </Button>
                      </div>
                    </Card>

                    {/* Agentic Progress */}
                    {isGenerating && agenticEvents.length > 0 && (
                      <Card className="p-4">
                        <AgenticProgress
                          isActive={isGenerating}
                          events={agenticEvents}
                          categoryCounts={{
                            functional: testCases.filter(t => t.category === "functional").length,
                            negative: testCases.filter(t => t.category === "negative").length,
                            edge_case: testCases.filter(t => t.category === "edge_case").length,
                            security: testCases.filter(t => t.category === "security").length,
                            accessibility: testCases.filter(t => t.category === "accessibility").length
                          }} 
                        />
                      </Card>
                    )}

                    {/* Coverage Intelligence Dashboard */}
                    {(traceabilityReport || testCases.length > 0) && (
                      <CoverageIntelligenceDashboard
                        testCases={testCases}
                        traceabilityReport={traceabilityReport}
                        coverageSummary={coverageSummary}
                        acceptanceCriteria={acceptanceCriteria}
                      />
                    )}

                    {/* Golden Repo / Document Context Banner */}
                    {enrichedContext && testCases.length > 0 && (
                      <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/8 px-4 py-3 flex flex-col gap-2">
                        <div className="flex items-center gap-2 font-semibold text-emerald-400 text-sm">
                          <span>🏛️</span>
                          {enrichedContext.uploadedDocCount > 0 && !repoPath.trim()
                            ? "Document Context Applied"
                            : "Golden Repo Context Applied"}
                          {enrichedContext.uploadedDocCount > 0 && (
                            <span className="inline-flex items-center gap-1 text-xs font-normal text-blue-300 bg-blue-500/10 px-2 py-0.5 rounded-full">
                              <FilePlus2 className="h-3 w-3" />
                              +{enrichedContext.uploadedDocCount} document{enrichedContext.uploadedDocCount !== 1 ? "s" : ""} analysed
                            </span>
                          )}
                          <span className="ml-auto text-xs font-normal text-emerald-400/70 bg-emerald-500/10 px-2 py-0.5 rounded-full">AI-enriched</span>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {enrichedContext.uploadedDocCount > 0 && !repoPath.trim()
                            ? `Claude analysed ${enrichedContext.uploadedDocCount} uploaded document(s) and enriched the test cases with context from your requirements and reference materials.`
                            : "Claude scanned your codebase and enriched the test cases with real project context. The test cases below reference actual endpoints, schema fields, and risks found in your repo."}
                          {enrichedContext.uploadedDocCount > 0 && repoPath.trim() && ` Additionally, ${enrichedContext.uploadedDocCount} uploaded document(s) were included as context.`}
                        </p>
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-1">
                          {enrichedContext.realApiEndpoints?.length > 0 && (
                            <div className="rounded bg-emerald-500/10 px-2 py-1.5 text-center">
                              <div className="text-lg font-bold text-emerald-400">{enrichedContext.realApiEndpoints.length}</div>
                              <div className="text-xs text-muted-foreground">API Endpoints</div>
                            </div>
                          )}
                          {enrichedContext.realFieldNames?.length > 0 && (
                            <div className="rounded bg-emerald-500/10 px-2 py-1.5 text-center">
                              <div className="text-lg font-bold text-emerald-400">{enrichedContext.realFieldNames.length}</div>
                              <div className="text-xs text-muted-foreground">Schema Fields</div>
                            </div>
                          )}
                          {enrichedContext.coverageGaps?.length > 0 && (
                            <div className="rounded bg-amber-500/10 px-2 py-1.5 text-center">
                              <div className="text-lg font-bold text-amber-400">{enrichedContext.coverageGaps.length}</div>
                              <div className="text-xs text-muted-foreground">Coverage Gaps</div>
                            </div>
                          )}
                          {enrichedContext.riskAreas?.length > 0 && (
                            <div className="rounded bg-red-500/10 px-2 py-1.5 text-center">
                              <div className="text-lg font-bold text-red-400">{enrichedContext.riskAreas.length}</div>
                              <div className="text-xs text-muted-foreground">Risk Areas</div>
                            </div>
                          )}
                        </div>
                        {coverageSummary?.coverageStatement && (
                          <p className="text-xs text-emerald-400/80 font-mono mt-1 border-t border-emerald-500/20 pt-2">
                            {coverageSummary.coverageStatement}
                          </p>
                        )}
                      </div>
                    )}

                    {/* Coverage summary banner (rule-based only, no enrichment) */}
                    {!enrichedContext && coverageSummary && testCases.length > 0 && (
                      <div className="rounded-lg border border-blue-500/30 bg-blue-500/5 px-4 py-2.5 flex items-center gap-2 text-xs text-blue-300">
                        <span>📊</span>
                        <span className="font-mono">{coverageSummary.coverageStatement}</span>
                      </div>
                    )}

                    {/* Test Cases Results */}
                    {testCases.length > 0 && (
                      <Card className="p-6">
                        <div className="flex items-center justify-between mb-4">
                          <h3 className="font-semibold flex items-center gap-2">
                            <FileText className="h-5 w-5" />
                            Generated Test Cases ({testCases.length})
                          </h3>
                          <div className="flex items-center gap-2">
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button 
                                  variant="outline" 
                                  size="sm"
                                  data-testid="button-export"
                                >
                                  <Download className="h-4 w-4 mr-2" />
                                  Export
                                  <ChevronDown className="h-3 w-3 ml-1" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem onClick={handleExportExcel} disabled={isExporting} data-testid="export-excel">
                                  {isExporting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <FileSpreadsheet className="h-4 w-4 mr-2" />}
                                  {isExporting ? 'Exporting...' : 'Export to Excel (.xlsx)'}
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={handleExportText} disabled={isExporting} data-testid="export-text">
                                  <FileType className="h-4 w-4 mr-2" />
                                  Export to Text (.txt)
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={handleExportBddAssets} disabled={isExportingBdd || !generatedBddAssets} data-testid="export-bdd">
                                  {isExportingBdd ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Code2 className="h-4 w-4 mr-2" />}
                                  {isExportingBdd ? 'Exporting...' : 'Export BDD Assets (.zip)'}
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={handleExportPlaywright} data-testid="export-playwright">
                                  <FileText className="h-4 w-4 mr-2" />
                                  Download Playwright Script (.ts)
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={handleExportSelenium} data-testid="export-selenium">
                                  <Code2 className="h-4 w-4 mr-2" />
                                  Download Selenium Script (.java)
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={handleExportTestComplete} data-testid="export-testcomplete">
                                  <Code2 className="h-4 w-4 mr-2" />
                                  Download TestComplete Script (.js)
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                            <Button
                              size="sm"
                              onClick={handlePushToAdo}
                              disabled={isPushingToAdo}
                              data-testid="button-push-ado"
                            >
                              {isPushingToAdo ? (
                                <>
                                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                  Pushing...
                                </>
                              ) : (
                                <>
                                  <CloudUpload className="h-4 w-4 mr-2" />
                                  Push to ADO
                                </>
                              )}
                            </Button>
                          </div>
                        </div>

                        {/* Push Results */}
                        {pushResults && (
                          <div className={`mb-4 p-3 rounded-md ${pushResults.success ? 'bg-green-500/10 border border-green-500/20' : 'bg-red-500/10 border border-red-500/20'}`}>
                            <p className={`text-sm ${pushResults.success ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                              {pushResults.message}
                            </p>
                            {pushResults.createdTestCases && pushResults.createdTestCases.length > 0 && (
                              <div className="mt-2 space-y-1">
                                <p className="text-xs text-muted-foreground">Created test cases:</p>
                                {pushResults.createdTestCases.slice(0, 5).map(tc => (
                                  <a 
                                    key={tc.id}
                                    href={tc.url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="flex items-center gap-1 text-xs text-blue-500 hover:underline"
                                  >
                                    <ExternalLink className="h-3 w-3" />
                                    #{tc.id} - {tc.title}
                                  </a>
                                ))}
                                {pushResults.createdTestCases.length > 5 && (
                                  <p className="text-xs text-muted-foreground">
                                    ...and {pushResults.createdTestCases.length - 5} more
                                  </p>
                                )}
                              </div>
                            )}
                          </div>
                        )}

                        {/* Test Cases List */}
                        <Tabs value={selectedTab} onValueChange={setSelectedTab}>
                          <TabsList className="mb-4">
                            <TabsTrigger value="all">All ({testCases.length})</TabsTrigger>
                            <TabsTrigger value="functional">Functional ({testCases.filter(t => t.category === "functional").length})</TabsTrigger>
                            <TabsTrigger value="negative">Negative ({testCases.filter(t => t.category === "negative").length})</TabsTrigger>
                            <TabsTrigger value="edge_case">Edge Case ({testCases.filter(t => t.category === "edge_case").length})</TabsTrigger>
                          </TabsList>
                        </Tabs>

                        <div className="mb-3">{renderBulkActionBar(selectedTab)}</div>

                        <ScrollArea className="h-96">
                          <div className="space-y-3">
                            {testCases
                              .filter(tc => selectedTab === "all" || tc.category === selectedTab)
                              .map((tc) => (
                                <Card 
                                  key={tc.id} 
                                  className={`p-4 hover-elevate cursor-pointer ${isTestCaseSelected(tc.id) ? "ring-1 ring-primary/40" : ""}`}
                                  onClick={() => setExpandedTestId(expandedTestId === tc.id ? null : tc.id)}
                                  data-testid={`card-testcase-${tc.id}`}
                                >
                                  <div className="flex items-start justify-between gap-2">
                                    {renderTestCaseCheckbox(tc.id)}
                                    <div className="flex-1 min-w-0">
                                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                                        <Badge variant="outline" className="text-xs">{tc.id}</Badge>
                                        <Badge variant="secondary" className="text-xs capitalize">{tc.category?.replace('_', ' ')}</Badge>
                                        <Badge variant={tc.priority === 'P0' ? 'destructive' : 'outline'} className="text-xs">{tc.priority}</Badge>
                                      </div>
                                      <h4 className="font-medium text-sm break-words">{tc.title}</h4>
                                    </div>
                                    <div className="flex-shrink-0">{expandedTestId === tc.id ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}</div>
                                  </div>
                                  
                                  {expandedTestId === tc.id && (
                                    <div className="mt-4 pt-4 border-t space-y-3">
                                      {tc.objective && (
                                        <div>
                                          <Label className="text-xs text-muted-foreground">Objective</Label>
                                          <p className="text-sm">{tc.objective}</p>
                                        </div>
                                      )}
                                      <div>
                                        <Label className="text-xs text-muted-foreground">Test Steps ({tc.steps.length})</Label>
                                        <div className="mt-2 space-y-2">
                                          {tc.steps.map((step, i) => (
                                            <div key={i} className="flex gap-2 text-sm">
                                              <span className="font-medium text-muted-foreground w-6">{i + 1}.</span>
                                              <div className="flex-1">
                                                <p>{step.action}</p>
                                                {step.expected_behavior && (
                                                  <p className="text-muted-foreground text-xs mt-1">Expected: {step.expected_behavior}</p>
                                                )}
                                              </div>
                                            </div>
                                          ))}
                                        </div>
                                      </div>
                                      <div className="flex gap-2 mt-3">
                                        <Button 
                                          size="sm" 
                                          variant="outline"
                                          onClick={(e) => { e.stopPropagation(); handleEditTestCase(tc); }}
                                        >
                                          <Pencil className="h-3 w-3 mr-1" />
                                          Edit
                                        </Button>
                                        <Button 
                                          size="sm" 
                                          variant="outline"
                                          onClick={(e) => { e.stopPropagation(); handleDeleteTestCase(tc.id); }}
                                        >
                                          <Trash2 className="h-3 w-3 mr-1" />
                                          Delete
                                        </Button>
                                      </div>
                                    </div>
                                  )}
                                </Card>
                              ))}
                          </div>
                        </ScrollArea>
                      </Card>
                    )}
                  </div>
                ) : (
                  <div className="flex items-center justify-center h-full text-muted-foreground">
                    <div className="text-center">
                      <FileText className="h-12 w-12 mx-auto mb-3 opacity-50" />
                      <p>Select a user story from the left panel to get started</p>
                    </div>
                  </div>
                )}
              </div>
            </div>
            {renderTestCaseDialogs()}
        </main>
      </>
    );
  }

  // JIRA Mode
  if (useJiraMode) {
    return (
      <>
        <DashboardHeader />
          <main className="flex-1 overflow-y-auto">
            <div className="border-b p-6 bg-card">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setLocation('/dashboard')}
                    className="h-9 shrink-0 gap-1.5 rounded-full border-border bg-card px-4 font-medium text-foreground shadow-sm hover:bg-muted"
                    data-testid="button-back-dashboard"
                  >
                    <ArrowLeft className="h-4 w-4 shrink-0" />
                    Dashboard
                  </Button>
                  <div className="w-px h-8 bg-border" />
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <Cloud className="h-5 w-5 text-blue-500" />
                      <h1 className="text-2xl font-bold">Generate from User Stories</h1>
                    </div>
                    <p className="text-sm text-muted-foreground">Connected to Jira - Select a project and user story</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button 
                    variant="outline" 
                    size="sm"
                    onClick={() => setStorySource('local')}
                    data-testid="button-switch-local-from-jira"
                  >
                    Switch to Local Projects
                  </Button>
                </div>
              </div>
            </div>

            <div className="flex flex-1 overflow-hidden">
              {/* Left Panel - Jira Selection */}
              <div className="w-96 border-r overflow-y-auto p-6 space-y-6">
                {/* Jira Project Selection */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <Label className="text-sm font-medium">Jira Project</Label>
                    <Button 
                      size="icon" 
                      variant="ghost" 
                      onClick={() => refetchJiraProjects()}
                      data-testid="button-refresh-jira-projects"
                    >
                      <RefreshCw className="h-3 w-3" />
                    </Button>
                  </div>
                  <Popover open={jiraProjectOpen} onOpenChange={setJiraProjectOpen}>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        role="combobox"
                        aria-expanded={jiraProjectOpen}
                        className="w-full justify-between font-normal"
                        data-testid="select-jira-project"
                      >
                        {selectedJiraProjectKey
                          ? (() => {
                              const proj = jiraProjects.find(p => p.key === selectedJiraProjectKey);
                              return proj ? `${proj.name} (${proj.key})` : selectedJiraProjectKey;
                            })()
                          : jiraProjectsLoading ? "Loading projects..." : "Search Jira projects..."}
                        <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-[350px] p-0" align="start">
                      <Command>
                        <CommandInput placeholder="Search projects by name or key..." data-testid="input-search-jira-project" />
                        <CommandList>
                          <CommandEmpty>No projects found.</CommandEmpty>
                          <CommandGroup>
                            {jiraProjects.map(p => (
                              <CommandItem
                                key={p.key}
                                value={`${p.name} ${p.key}`}
                                onSelect={() => {
                                  setSelectedJiraProjectKey(p.key);
                                  setSelectedJiraProject(p.name);
                                  setJiraProjectOpen(false);
                                }}
                                data-testid={`option-jira-project-${p.key}`}
                              >
                                <Check className={`mr-2 h-4 w-4 ${selectedJiraProjectKey === p.key ? "opacity-100" : "opacity-0"}`} />
                                <Cloud className="h-4 w-4 mr-2 text-blue-500" />
                                <span className="truncate">{p.name}</span>
                                <Badge variant="outline" className="ml-auto text-xs">{p.key}</Badge>
                              </CommandItem>
                            ))}
                          </CommandGroup>
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>
                </div>

                {/* Jira Board Selection */}
                {/* Issue type filter chips + active sprint toggle */}
                {selectedJiraProjectKey && (
                  <div className="flex items-center gap-2 flex-wrap">
                    {(['Epic', 'Story', 'Task', 'Sub-task', 'Bug'] as const).map(type => (
                      <Badge
                        key={type}
                        variant={jiraIssueTypeFilter.includes(type) ? 'default' : 'outline'}
                        className="cursor-pointer select-none"
                        onClick={() => setJiraIssueTypeFilter(prev =>
                          prev.includes(type) ? prev.filter(t => t !== type) : [...prev, type]
                        )}
                      >
                        {type}
                      </Badge>
                    ))}
                    <div className="flex items-center gap-1.5 ml-auto">
                      <Switch
                        id="jira-sprint-filter"
                        checked={jiraSprintFilterActive}
                        onCheckedChange={setJiraSprintFilterActive}
                      />
                      <Label htmlFor="jira-sprint-filter" className="text-xs cursor-pointer whitespace-nowrap">Active Sprint only</Label>
                    </div>
                  </div>
                )}

                {/* Work item list */}
                {selectedJiraProjectKey && (
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <Label className="text-sm font-medium">Work Items</Label>
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => refetchJiraUserStories()}
                        data-testid="button-refresh-jira-stories"
                      >
                        <RefreshCw className="h-3 w-3" />
                      </Button>
                    </div>
                    {jiraUserStoriesLoading ? (
                      <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Loading work items...
                      </div>
                    ) : jiraUserStories.length === 0 ? (
                      <div className="text-sm text-muted-foreground py-2">
                        No work items found
                      </div>
                    ) : (
                      <ScrollArea className="h-64 border rounded-md">
                        <div className="p-2 space-y-2">
                          {jiraUserStories.map(story => (
                            <Card
                              key={story.id}
                              className={`p-3 cursor-pointer hover-elevate ${selectedJiraUserStory?.id === story.id ? 'border-primary bg-primary/5' : ''}`}
                              onClick={() => setSelectedJiraUserStory(story)}
                              data-testid={`card-jira-story-${story.id}`}
                            >
                              <div className="flex items-start gap-2">
                                <FileText className="h-4 w-4 mt-0.5 text-muted-foreground flex-shrink-0" />
                                <div className="flex-1 min-w-0">
                                  <p className="text-sm font-medium line-clamp-2">{story.title}</p>
                                  <div className="flex items-center gap-2 mt-1 flex-wrap">
                                    <Badge variant="outline" className="text-xs">{story.id}</Badge>
                                    {story.issueType && <Badge variant="secondary" className="text-xs">{story.issueType}</Badge>}
                                    <Badge variant="outline" className="text-xs">{story.state}</Badge>
                                    {story.priority && <Badge variant="outline" className="text-xs">{story.priority}</Badge>}
                                  </div>
                                </div>
                              </div>
                            </Card>
                          ))}
                        </div>
                      </ScrollArea>
                    )}
                  </div>
                )}
              </div>

              {/* Right Panel - User Story Details & Generation */}
              <div className="flex-1 overflow-y-auto p-6">
                {selectedJiraUserStory ? (
                  <div className="w-full space-y-6">
                    <Card className="p-6">
                      <div className="flex items-start justify-between mb-4">
                        <div>
                          <Badge variant="outline" className="mb-2">{selectedJiraUserStory.id}</Badge>
                          <h2 className="text-xl font-semibold">{selectedJiraUserStory.title}</h2>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge variant="secondary">{selectedJiraUserStory.state}</Badge>
                          {selectedJiraUserStory.priority && <Badge variant="outline">{selectedJiraUserStory.priority}</Badge>}
                        </div>
                      </div>
                      
                      <div className="space-y-4">
                        <div>
                          <Label className="text-sm mb-1.5 block">User Story Title</Label>
                          <Input 
                            value={storyTitle}
                            onChange={e => setStoryTitle(e.target.value)}
                            data-testid="input-jira-story-title"
                          />
                        </div>
                        <div>
                          <Label className="text-sm mb-1.5 block">Description</Label>
                          <Textarea 
                            value={storyDescription}
                            onChange={e => setStoryDescription(e.target.value)}
                            className="min-h-[100px] resize-none"
                            data-testid="input-jira-story-description"
                          />
                        </div>
                        <div>
                          <Label className="text-sm mb-1.5 block">Acceptance Criteria</Label>
                          <Textarea 
                            value={acceptanceCriteria}
                            onChange={e => setAcceptanceCriteria(e.target.value)}
                            className="min-h-[80px] resize-none"
                            data-testid="input-jira-story-ac"
                          />
                        </div>
                      </div>
                    </Card>

                    {/* Framework Config Selector — Jira mode */}
                    {frameworkConfigs.length > 0 && (
                      <div className="mb-2">
                        <Label className="text-sm mb-1.5 block flex items-center gap-1.5">
                          <span>Framework Catalog</span>
                          <span className="text-xs text-muted-foreground font-normal">(optional)</span>
                        </Label>
                        <select
                          value={selectedFrameworkConfigId}
                          onChange={e => setSelectedFrameworkConfigId(e.target.value)}
                          className="w-full h-9 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
                          data-testid="select-framework-config-jira"
                        >
                          <option value="">— None (generic patterns) —</option>
                          {frameworkConfigs.map(fc => (
                            <option key={fc.id} value={fc.id}>
                              {fc.name} ({fc.framework}/{fc.language}){fc.isGlobal ? " 🌐" : ""}{fc.functionCount ? ` · ${fc.functionCount} fns` : ""}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}

                    <div className="flex items-center gap-3">
                      <Select value={newProjectDomain} onValueChange={setNewProjectDomain}>
                        <SelectTrigger className="w-48" data-testid="select-jira-domain">
                          <SelectValue placeholder="Select Domain" />
                        </SelectTrigger>
                        <SelectContent>
                          {DOMAINS.map(d => (
                            <SelectItem key={d} value={d}>{d}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Button
                        onClick={handleGenerate}
                        disabled={isGenerating || !storyTitle}
                        data-testid="button-jira-generate"
                      >
                        {isGenerating ? (
                          <>
                            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                            Generating...
                          </>
                        ) : (
                          <>
                            <Sparkles className="h-4 w-4 mr-2" />
                            Generate Test Cases
                          </>
                        )}
                      </Button>
                    </div>

                    {isGenerating && agenticEvents.length > 0 && (
                      <AgenticProgress 
                        isActive={isGenerating} 
                        events={agenticEvents} 
                        categoryCounts={{
                          functional: testCases.filter(t => t.category === "functional").length,
                          negative: testCases.filter(t => t.category === "negative").length,
                          edge_case: testCases.filter(t => t.category === "edge_case").length,
                          security: testCases.filter(t => t.category === "security").length,
                          accessibility: testCases.filter(t => t.category === "accessibility").length
                        }}
                      />
                    )}

                    {/* Coverage Intelligence Dashboard */}
                    {(traceabilityReport || testCases.length > 0) && (
                      <CoverageIntelligenceDashboard
                        testCases={testCases}
                        traceabilityReport={traceabilityReport}
                        coverageSummary={coverageSummary}
                        acceptanceCriteria={acceptanceCriteria}
                      />
                    )}

                    {/* Golden Repo / Document Context Banner */}
                    {enrichedContext && testCases.length > 0 && (
                      <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/8 px-4 py-3 flex flex-col gap-2">
                        <div className="flex items-center gap-2 font-semibold text-emerald-400 text-sm">
                          <span>🏛️</span>
                          {enrichedContext.uploadedDocCount > 0 && !repoPath.trim()
                            ? "Document Context Applied"
                            : "Golden Repo Context Applied"}
                          {enrichedContext.uploadedDocCount > 0 && (
                            <span className="inline-flex items-center gap-1 text-xs font-normal text-blue-300 bg-blue-500/10 px-2 py-0.5 rounded-full">
                              <FilePlus2 className="h-3 w-3" />
                              +{enrichedContext.uploadedDocCount} document{enrichedContext.uploadedDocCount !== 1 ? "s" : ""} analysed
                            </span>
                          )}
                          <span className="ml-auto text-xs font-normal text-emerald-400/70 bg-emerald-500/10 px-2 py-0.5 rounded-full">AI-enriched</span>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {enrichedContext.uploadedDocCount > 0 && !repoPath.trim()
                            ? `Claude analysed ${enrichedContext.uploadedDocCount} uploaded document(s) and enriched the test cases with context from your requirements and reference materials.`
                            : "Claude scanned your codebase and enriched the test cases with real project context. The test cases below reference actual endpoints, schema fields, and risks found in your repo."}
                          {enrichedContext.uploadedDocCount > 0 && repoPath.trim() && ` Additionally, ${enrichedContext.uploadedDocCount} uploaded document(s) were included as context.`}
                        </p>
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-1">
                          {enrichedContext.realApiEndpoints?.length > 0 && (
                            <div className="rounded bg-emerald-500/10 px-2 py-1.5 text-center">
                              <div className="text-lg font-bold text-emerald-400">{enrichedContext.realApiEndpoints.length}</div>
                              <div className="text-xs text-muted-foreground">API Endpoints</div>
                            </div>
                          )}
                          {enrichedContext.realFieldNames?.length > 0 && (
                            <div className="rounded bg-emerald-500/10 px-2 py-1.5 text-center">
                              <div className="text-lg font-bold text-emerald-400">{enrichedContext.realFieldNames.length}</div>
                              <div className="text-xs text-muted-foreground">Schema Fields</div>
                            </div>
                          )}
                          {enrichedContext.coverageGaps?.length > 0 && (
                            <div className="rounded bg-amber-500/10 px-2 py-1.5 text-center">
                              <div className="text-lg font-bold text-amber-400">{enrichedContext.coverageGaps.length}</div>
                              <div className="text-xs text-muted-foreground">Coverage Gaps</div>
                            </div>
                          )}
                          {enrichedContext.riskAreas?.length > 0 && (
                            <div className="rounded bg-red-500/10 px-2 py-1.5 text-center">
                              <div className="text-lg font-bold text-red-400">{enrichedContext.riskAreas.length}</div>
                              <div className="text-xs text-muted-foreground">Risk Areas</div>
                            </div>
                          )}
                        </div>
                        {coverageSummary?.coverageStatement && (
                          <p className="text-xs text-emerald-400/80 font-mono mt-1 border-t border-emerald-500/20 pt-2">
                            {coverageSummary.coverageStatement}
                          </p>
                        )}
                      </div>
                    )}

                    {/* Coverage summary banner (rule-based only, no enrichment) */}
                    {!enrichedContext && coverageSummary && testCases.length > 0 && (
                      <div className="rounded-lg border border-blue-500/30 bg-blue-500/5 px-4 py-2.5 flex items-center gap-2 text-xs text-blue-300">
                        <span>📊</span>
                        <span className="font-mono">{coverageSummary.coverageStatement}</span>
                      </div>
                    )}

                    {testCases.length > 0 && (
                      <div className="space-y-4">
                        <div className="flex items-center justify-between flex-wrap gap-2">
                          <h3 className="text-lg font-semibold">Generated Test Cases ({testCases.length})</h3>
                          <div className="flex items-center gap-2 flex-wrap">
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  disabled={isGeneratingScripts}
                                  data-testid="button-generate-scripts"
                                >
                                  {isGeneratingScripts ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Code2 className="h-4 w-4 mr-2" />}
                                  Generate Scripts
                                  <ChevronDown className="h-3 w-3 ml-1" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent>
                                <DropdownMenuItem onClick={() => handleGenerateScriptsInline('playwright')} data-testid="button-generate-playwright">
                                  <Code2 className="h-4 w-4 mr-2" />
                                  Playwright + TypeScript
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => handleGenerateScriptsInline('selenium')} data-testid="button-generate-selenium">
                                  <Code2 className="h-4 w-4 mr-2" />
                                  Selenium + Java
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={handleGenerateTestComplete} disabled={isGeneratingTC} data-testid="button-generate-testcomplete">
                                  <Code2 className="h-4 w-4 mr-2" />
                                  {isGeneratingTC ? 'Generating...' : 'TestComplete + JavaScript'}
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                            <Button 
                              variant="outline" 
                              size="sm"
                              onClick={handlePushToJira}
                              disabled={isPushingToJira}
                              data-testid="button-push-to-jira"
                            >
                              {isPushingToJira ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <CloudUpload className="h-4 w-4 mr-2" />}
                              Push to Jira
                            </Button>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="outline" size="sm" data-testid="button-jira-export-dropdown">
                                  <Download className="h-4 w-4 mr-2" />
                                  Export
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent>
                                <DropdownMenuItem onClick={handleExportExcel} disabled={isExporting} data-testid="button-jira-export-excel">
                                  <FileSpreadsheet className="h-4 w-4 mr-2" />
                                  Excel (.xlsx)
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={handleExportText} disabled={isExporting} data-testid="button-jira-export-text">
                                  <FileType className="h-4 w-4 mr-2" />
                                  Formatted Text
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={handleExportPlaywright} data-testid="button-jira-export-playwright">
                                  <Code2 className="h-4 w-4 mr-2" />
                                  Playwright Script (.spec.ts)
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => {
                                  const script = generateFullSeleniumScript(testCases);
                                  const blob = new Blob([script], { type: "text/java" });
                                  const url = URL.createObjectURL(blob);
                                  const a = document.createElement("a");
                                  a.href = url;
                                  a.download = "GeneratedTests.java";
                                  a.click();
                                  URL.revokeObjectURL(url);
                                  toast({ title: "Selenium Script Downloaded", description: `${testCases.length} test cases exported as .java` });
                                }} data-testid="button-jira-export-selenium">
                                  <Code2 className="h-4 w-4 mr-2" />
                                  Selenium Script (.java)
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={handleExportTestComplete} data-testid="button-jira-export-testcomplete">
                                  <Code2 className="h-4 w-4 mr-2" />
                                  TestComplete Script (.js)
                                </DropdownMenuItem>
                                {generatedBddAssets && (
                                  <DropdownMenuItem onClick={handleExportBddAssets} disabled={isExportingBdd} data-testid="button-jira-export-bdd">
                                    <Download className="h-4 w-4 mr-2" />
                                    BDD Assets (ZIP)
                                  </DropdownMenuItem>
                                )}
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>
                        </div>

                        {jiraPushResults && (
                          <Card className={`p-4 ${jiraPushResults.success ? 'border-green-500/50' : 'border-destructive/50'}`}>
                            <p className={`text-sm ${jiraPushResults.success ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                              {jiraPushResults.message}
                            </p>
                            {jiraPushResults.createdTestCases && jiraPushResults.createdTestCases.length > 0 && (
                              <div className="mt-2 space-y-1">
                                {jiraPushResults.createdTestCases.map((tc: any, idx: number) => (
                                  <div key={idx} className="flex items-center gap-2 text-xs">
                                    <Badge variant="outline">{tc.key}</Badge>
                                    <span>{tc.title}</span>
                                    <a href={tc.url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                                      <ExternalLink className="h-3 w-3" />
                                    </a>
                                  </div>
                                ))}
                              </div>
                            )}
                          </Card>
                        )}

                        <Tabs value={selectedTab} onValueChange={(v) => setSelectedTab(v as any)}>
                          <TabsList>
                            <TabsTrigger value="all" data-testid="tab-all">All ({testCases.length})</TabsTrigger>
                            <TabsTrigger value="functional" data-testid="tab-functional">Functional</TabsTrigger>
                            <TabsTrigger value="negative" data-testid="tab-negative">Negative</TabsTrigger>
                            <TabsTrigger value="edge_case" data-testid="tab-edge">Edge Case</TabsTrigger>
                            <TabsTrigger value="security" data-testid="tab-security">Security</TabsTrigger>
                            <TabsTrigger value="accessibility" data-testid="tab-a11y">Accessibility</TabsTrigger>
                          </TabsList>
                        </Tabs>

                        {renderBulkActionBar(selectedTab)}

                        <div className="space-y-3">
                          {testCases
                            .filter(tc => selectedTab === "all" || tc.category === selectedTab)
                            .map((tc) => (
                              <Card 
                                key={tc.id} 
                                className={`p-4 hover-elevate cursor-pointer ${isTestCaseSelected(tc.id) ? "ring-1 ring-primary/40" : ""}`}
                                onClick={() => setExpandedTestId(expandedTestId === tc.id ? null : tc.id)}
                                data-testid={`card-jira-testcase-${tc.id}`}
                              >
                                <div className="flex items-start justify-between gap-2">
                                  {renderTestCaseCheckbox(tc.id)}
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                                      <Badge variant="outline" className="text-xs">{tc.id}</Badge>
                                      <Badge variant="secondary" className="text-xs capitalize">{tc.category?.replace('_', ' ')}</Badge>
                                      <Badge variant={tc.priority === 'P0' ? 'destructive' : 'outline'} className="text-xs">{tc.priority}</Badge>
                                    </div>
                                    <h4 className="font-medium text-sm break-words">{tc.title}</h4>
                                  </div>
                                  <div className="flex-shrink-0">{expandedTestId === tc.id ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}</div>
                                </div>
                                
                                {expandedTestId === tc.id && (
                                  <div className="mt-4 pt-4 border-t space-y-3">
                                    {tc.objective && (
                                      <div>
                                        <Label className="text-xs text-muted-foreground">Objective</Label>
                                        <p className="text-sm">{tc.objective}</p>
                                      </div>
                                    )}
                                    {tc.preconditions && tc.preconditions.length > 0 && (
                                      <div>
                                        <Label className="text-xs text-muted-foreground">Preconditions</Label>
                                        <ul className="text-sm list-disc list-inside">
                                          {tc.preconditions.map((p, i) => <li key={i}>{p}</li>)}
                                        </ul>
                                      </div>
                                    )}
                                    <div>
                                      <Label className="text-xs text-muted-foreground">Test Steps</Label>
                                      <div className="space-y-2 mt-1">
                                        {tc.steps.map((step, i) => (
                                          <div key={i} className="text-sm">
                                            <p><span className="font-medium">Step {step.step_number}:</span> {step.action}</p>
                                            {step.expected_behavior && (
                                              <p className="text-muted-foreground ml-4">Expected: {step.expected_behavior}</p>
                                            )}
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                    {tc.expectedResult && (
                                      <div>
                                        <Label className="text-xs text-muted-foreground">Expected Result</Label>
                                        <p className="text-sm">{tc.expectedResult}</p>
                                      </div>
                                    )}
                                    {tc.playwrightScript && (
                                      <div>
                                        <div className="flex items-center justify-between mb-1">
                                          <Label className="text-xs text-muted-foreground">
                                            {tc.playwrightScript.includes('import org.') ? 'Selenium + Java Script' : 'Playwright + TypeScript Script'}
                                          </Label>
                                          <Button
                                            size="sm"
                                            variant="ghost"
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              navigator.clipboard.writeText(tc.playwrightScript!);
                                              toast({ title: "Copied", description: "Automation script copied to clipboard" });
                                            }}
                                            data-testid={`button-copy-script-${tc.id}`}
                                          >
                                            <Code2 className="h-3 w-3 mr-1" />
                                            Copy
                                          </Button>
                                        </div>
                                        <pre className="text-xs bg-muted p-3 rounded-md overflow-x-auto max-h-[300px] overflow-y-auto" data-testid={`code-playwright-${tc.id}`}>
                                          <code>{tc.playwrightScript}</code>
                                        </pre>
                                      </div>
                                    )}
                                    <div className="flex gap-2 pt-1">
                                      <Button
                                        size="sm"
                                        variant="outline"
                                        onClick={(e) => { e.stopPropagation(); handleEditTestCase(tc); }}
                                        data-testid={`button-jira-edit-${tc.id}`}
                                      >
                                        <Pencil className="h-3 w-3 mr-1" />
                                        Edit
                                      </Button>
                                      <Button
                                        size="sm"
                                        variant="outline"
                                        onClick={(e) => { e.stopPropagation(); handleDeleteTestCase(tc.id); }}
                                        className="text-destructive hover:text-destructive"
                                        data-testid={`button-jira-delete-${tc.id}`}
                                      >
                                        <Trash2 className="h-3 w-3 mr-1" />
                                        Delete
                                      </Button>
                                    </div>
                                  </div>
                                )}
                              </Card>
                            ))}
                        </div>

                        {showAutomationScript && (
                          <Card className="p-4 mt-4">
                            <div className="flex items-center justify-between mb-3">
                              <h4 className="font-semibold text-sm flex items-center gap-2">
                                <Code2 className="h-4 w-4" />
                                {automationFramework === 'playwright' ? 'Playwright + TypeScript' : 'Selenium + Java'} Test Script
                                <Badge variant="secondary" className="text-xs">{automationFramework === 'playwright' ? '.spec.ts' : '.java'}</Badge>
                              </h4>
                              <div className="flex items-center gap-2">
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => {
                                    navigator.clipboard.writeText(showAutomationScript);
                                    toast({ title: "Copied", description: `Full ${automationFramework === 'playwright' ? 'Playwright' : 'Selenium'} script copied to clipboard` });
                                  }}
                                  data-testid="button-copy-full-script"
                                >
                                  Copy All
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => {
                                    const ext = automationFramework === 'playwright' ? 'spec.ts' : 'java';
                                    const type = automationFramework === 'playwright' ? 'text/typescript' : 'text/java';
                                    const filename = automationFramework === 'playwright' ? `generated-tests.${ext}` : `GeneratedTests.${ext}`;
                                    const blob = new Blob([showAutomationScript], { type });
                                    const url = URL.createObjectURL(blob);
                                    const a = document.createElement("a");
                                    a.href = url;
                                    a.download = filename;
                                    a.click();
                                    URL.revokeObjectURL(url);
                                    toast({ title: "Downloaded", description: `Script saved as ${filename}` });
                                  }}
                                  data-testid="button-download-full-script"
                                >
                                  <Download className="h-3 w-3 mr-1" />
                                  Download
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => setShowAutomationScript(null)}
                                  data-testid="button-close-script"
                                >
                                  <X className="h-4 w-4" />
                                </Button>
                              </div>
                            </div>
                            <pre className="text-xs bg-muted p-4 rounded-md overflow-x-auto max-h-[500px] overflow-y-auto" data-testid="code-full-script">
                              <code>{showAutomationScript}</code>
                            </pre>
                          </Card>
                        )}

                        {showTCScripts && (() => {
                          const safeFilename = (storyTitle || 'Story').replace(/[^a-zA-Z0-9]/g, '_');
                          // Build unified file list: JS files + BDD + DDT
                          type TCFileEntry = { name: string; content: string; ext: string; mime: string; };
                          const allFiles: TCFileEntry[] = [
                            ...(showTCScripts.files || []).map(f => ({
                              name: f.name,
                              content: f.content,
                              ext: 'js',
                              mime: 'text/javascript',
                            })),
                            {
                              name: `${safeFilename}.feature`,
                              content: showTCScripts.bddFeature,
                              ext: 'feature',
                              mime: 'text/plain',
                            },
                            {
                              name: `${safeFilename}_DDT.js`,
                              content: showTCScripts.ddtTemplate,
                              ext: 'js',
                              mime: 'text/javascript',
                            },
                          ];
                          const activeFile = allFiles.find(f => f.name === tcActiveFile) || allFiles[0];
                          const downloadSingle = (f: TCFileEntry) => {
                            const blob = new Blob([f.content], { type: f.mime });
                            const url = URL.createObjectURL(blob);
                            const a = document.createElement('a');
                            a.href = url; a.download = f.name; a.click();
                            URL.revokeObjectURL(url);
                          };
                          const downloadAll = () => {
                            allFiles.forEach((f, idx) => {
                              setTimeout(() => downloadSingle(f), idx * 200);
                            });
                          };
                          return (
                            <Card className="p-4 mt-4" data-testid="card-tc-scripts">
                              <div className="flex items-center justify-between mb-3">
                                <h4 className="font-semibold text-sm flex items-center gap-2">
                                  <Code2 className="h-4 w-4" />
                                  TestComplete Project
                                  <Badge variant="secondary" className="text-xs">{allFiles.length} files</Badge>
                                </h4>
                                <div className="flex items-center gap-2">
                                  <Button size="sm" variant="outline" className="text-xs" onClick={downloadAll} data-testid="button-tc-download-all">
                                    <Download className="h-3 w-3 mr-1" />
                                    Download All
                                  </Button>
                                  <Button size="sm" variant="ghost" onClick={() => setShowTCScripts(null)} data-testid="button-close-tc-scripts">
                                    <X className="h-4 w-4" />
                                  </Button>
                                </div>
                              </div>

                              <div className="flex gap-3" style={{ minHeight: '460px' }}>
                                {/* Left sidebar: file list */}
                                <div className="flex flex-col gap-1 border-r pr-3" style={{ minWidth: '150px' }}>
                                  <p className="text-xs text-muted-foreground font-medium mb-1">Project Files</p>
                                  {allFiles.map(f => (
                                    <button
                                      key={f.name}
                                      onClick={() => setTcActiveFile(f.name)}
                                      data-testid={`tab-tc-file-${f.name.replace(/\W/g, '_')}`}
                                      className={`text-left px-2 py-1.5 text-xs rounded font-mono transition-colors ${
                                        tcActiveFile === f.name
                                          ? 'bg-primary text-primary-foreground'
                                          : 'hover:bg-muted text-muted-foreground'
                                      }`}
                                    >
                                      {f.name}
                                    </button>
                                  ))}
                                </div>

                                {/* Right panel: code */}
                                <div className="flex-1 flex flex-col gap-2 min-w-0">
                                  <div className="flex items-center justify-between">
                                    <span className="text-xs font-mono text-muted-foreground">{activeFile?.name}</span>
                                    <div className="flex gap-1">
                                      <Button
                                        size="sm"
                                        variant="outline"
                                        className="text-xs"
                                        data-testid="button-tc-copy"
                                        onClick={() => {
                                          navigator.clipboard.writeText(activeFile?.content || '');
                                          toast({ title: "Copied", description: `${activeFile?.name} copied to clipboard` });
                                        }}
                                      >
                                        Copy
                                      </Button>
                                      <Button
                                        size="sm"
                                        variant="outline"
                                        className="text-xs"
                                        data-testid="button-tc-download"
                                        onClick={() => activeFile && downloadSingle(activeFile)}
                                      >
                                        <Download className="h-3 w-3 mr-1" />
                                        Download
                                      </Button>
                                    </div>
                                  </div>
                                  <pre
                                    className="text-xs bg-muted p-3 rounded-md overflow-x-auto overflow-y-auto flex-1"
                                    style={{ fontFamily: "var(--font-mono, 'Courier New', monospace)", height: '420px', whiteSpace: 'pre' }}
                                    data-testid="code-tc-script"
                                  >
                                    <code>{activeFile?.content || ''}</code>
                                  </pre>
                                </div>
                              </div>
                            </Card>
                          );
                        })()}
                      </div>
                    )}

                    {isLoadingExistingCases && (
                      <div className="flex items-center justify-center py-12">
                        <Loader2 className="h-6 w-6 animate-spin mr-2" />
                        <span className="text-muted-foreground">Loading existing test cases...</span>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="flex items-center justify-center h-full text-muted-foreground">
                    <div className="text-center">
                      <FileText className="h-12 w-12 mx-auto mb-3 opacity-50" />
                      <p>Select a user story from the left panel to get started</p>
                    </div>
                  </div>
                )}
              </div>
            </div>
            {renderTestCaseDialogs()}
        </main>
      </>
    );
  }

  // LOCAL MODE: STEP 1: Project Selection
  if (!selectedProjectId) {
    return (
      <>
        <DashboardHeader />
        <main className="flex-1 overflow-y-auto">
            <div className="border-b p-6 bg-card">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setLocation('/dashboard')}
                    className="h-9 shrink-0 gap-1.5 rounded-full border-border bg-card px-4 font-medium text-foreground shadow-sm hover:bg-muted"
                    data-testid="button-back-dashboard"
                  >
                    <ArrowLeft className="h-4 w-4 shrink-0" />
                    Dashboard
                  </Button>
                  <div className="w-px h-8 bg-border" />
                  <div>
                    <h1 className="text-2xl font-bold mb-1">Generate from User Stories</h1>
                    <p className="text-sm text-muted-foreground">Select or create a project to get started</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button 
                    variant="outline" 
                    size="sm"
                    onClick={() => setStorySource('jira')}
                    data-testid="button-switch-jira-from-local"
                  >
                    <Cloud className="h-4 w-4 mr-2" />
                    Jira
                  </Button>
                </div>
              </div>
            </div>

            <ScrollArea className="flex-1">
          <div className="p-6">
            {/* Create Project Card */}
            {!showCreateProject ? (
              <Card 
                className="p-6 mb-6 border-dashed border-2 hover-elevate cursor-pointer"
                onClick={() => setShowCreateProject(true)}
                data-testid="card-create-project"
              >
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
                    <Plus className="h-6 w-6 text-primary" />
                  </div>
                  <div>
                    <h3 className="font-semibold">Create New Project</h3>
                    <p className="text-sm text-muted-foreground">Start a new testing project</p>
                  </div>
                </div>
              </Card>
            ) : (
              <Card className="p-6 mb-6" data-testid="form-create-project">
                <h3 className="font-semibold mb-4">Create New Project</h3>
                <div className="space-y-4">
                  <div>
                    <Label className="text-sm mb-1.5 block">Project Name</Label>
                    <Input 
                      placeholder="Enter project name"
                      value={newProjectName}
                      onChange={e => setNewProjectName(e.target.value)}
                      data-testid="input-project-name"
                    />
                  </div>
                  <div>
                    <Label className="text-sm mb-1.5 block">Domain</Label>
                    <Select value={newProjectDomain} onValueChange={setNewProjectDomain}>
                      <SelectTrigger data-testid="select-project-domain">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {DOMAINS.map(d => (
                          <SelectItem key={d.toLowerCase()} value={d.toLowerCase()}>{d}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-sm mb-1.5 block">Project Context / Description</Label>
                    <Textarea 
                      placeholder="Describe your project, its purpose, and any relevant context..."
                      value={newProjectDesc}
                      onChange={e => setNewProjectDesc(e.target.value)}
                      className="min-h-[100px]"
                      data-testid="textarea-project-desc"
                    />
                  </div>
                  <div className="flex gap-2">
                    <Button 
                      onClick={() => createProjectMutation.mutate()} 
                      disabled={createProjectMutation.isPending}
                      data-testid="button-create-project"
                    >
                      {createProjectMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                      Create Project
                    </Button>
                    <Button 
                      variant="outline" 
                      onClick={() => { setShowCreateProject(false); setNewProjectName(""); setNewProjectDesc(""); }}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              </Card>
            )}

            {/* Existing Projects */}
            {projects.length > 0 && (
              <div>
                <h3 className="text-sm font-medium text-muted-foreground mb-3">Existing Projects</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {projects.map(p => (
                    <Card
                      key={p.id}
                      className={`p-4 cursor-pointer hover-elevate border-l-4 ${getDomainColor(p.domain || "")}`}
                      onClick={() => setSelectedProjectId(p.id)}
                      data-testid={`card-project-${p.id}`}
                    >
                      <div className="flex items-start gap-3">
                        <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center flex-shrink-0">
                          <FolderOpen className="h-5 w-5 text-muted-foreground" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <h4 className="font-semibold text-sm truncate">{p.name}</h4>
                          <p className="text-xs text-muted-foreground capitalize">{p.domain}</p>
                          <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                            {p.description || "No description"}
                          </p>
                        </div>
                      </div>
                    </Card>
                  ))}
                </div>
              </div>
            )}

            {projects.length === 0 && !showCreateProject && !projectsLoading && (
              <div className="text-center py-12 text-muted-foreground">
                <FolderOpen className="h-12 w-12 mx-auto mb-3 opacity-50" />
                <p>No projects yet. Create your first project to get started.</p>
              </div>
            )}
          </div>
        </ScrollArea>
        </main>
      </>
    );
  }

  // STEP 2: Sprint Selection
  if (!selectedSprintId) {
    return (
      <>
        <DashboardHeader />
        <main className="flex-1 overflow-y-auto">
            <div className="border-b p-6 bg-card">
              <div className="flex items-center gap-3 mb-1">
                <Button 
                  size="icon" 
                  variant="ghost" 
                  onClick={() => setSelectedProjectId(null)}
                  data-testid="button-back-projects"
                >
                  <ArrowLeft className="h-5 w-5" />
                </Button>
                <div>
                  <h1 className="text-2xl font-bold">Generate from User Stories</h1>
                  <p className="text-sm text-muted-foreground">
                    Project: <span className="text-foreground">{selectedProject?.name}</span> | Select or create a sprint
                  </p>
                </div>
              </div>
            </div>

            <ScrollArea className="flex-1">
          <div className="p-6">
            {/* Create Sprint Card */}
            {!showCreateSprint ? (
              <Card 
                className="p-6 mb-6 border-dashed border-2 hover-elevate cursor-pointer"
                onClick={() => setShowCreateSprint(true)}
                data-testid="card-create-sprint"
              >
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
                    <Plus className="h-6 w-6 text-primary" />
                  </div>
                  <div>
                    <h3 className="font-semibold">Create New Sprint</h3>
                    <p className="text-sm text-muted-foreground">Add a new sprint to organize user stories</p>
                  </div>
                </div>
              </Card>
            ) : (
              <Card className="p-6 mb-6" data-testid="form-create-sprint">
                <h3 className="font-semibold mb-4">Create New Sprint</h3>
                <div className="space-y-4">
                  <div>
                    <Label className="text-sm mb-1.5 block">Sprint Name</Label>
                    <Input 
                      placeholder="e.g., Sprint 1, Release 2.0"
                      value={newSprintName}
                      onChange={e => setNewSprintName(e.target.value)}
                      data-testid="input-sprint-name"
                    />
                  </div>
                  <div className="flex gap-2">
                    <Button onClick={handleCreateSprint} data-testid="button-create-sprint">
                      Create Sprint
                    </Button>
                    <Button 
                      variant="outline" 
                      onClick={() => { setShowCreateSprint(false); setNewSprintName(""); }}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              </Card>
            )}

            {/* Existing Sprints */}
            {sprints.length > 0 && (
              <div>
                <h3 className="text-sm font-medium text-muted-foreground mb-3">Sprints</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {sprints.map(s => (
                    <Card
                      key={s.id}
                      className="p-4 cursor-pointer hover-elevate"
                      onClick={() => setSelectedSprintId(s.id)}
                      data-testid={`card-sprint-${s.id}`}
                    >
                      <div className="flex items-start gap-3">
                        <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center flex-shrink-0">
                          <Calendar className="h-5 w-5 text-muted-foreground" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <h4 className="font-semibold text-sm">{s.name}</h4>
                          <p className="text-xs text-muted-foreground">
                            {new Date(s.createdAt).toLocaleDateString()}
                          </p>
                        </div>
                      </div>
                    </Card>
                  ))}
                </div>
              </div>
            )}
          </div>
        </ScrollArea>
        </main>
      </>
    );
  }

  // STEP 3: Collapsible Drawer UI (User Story Input + Test Cases)
  return (
    <>
      <DashboardHeader />
      <main className="flex-1 overflow-hidden flex">
          {/* Collapsible Left Drawer */}
      <div 
        className={`border-r bg-card flex flex-col transition-all duration-300 ${
          isDrawerOpen ? "w-[420px]" : "w-[50px]"
        }`}
      >
        {/* Drawer Header */}
        <div className="p-3 border-b flex items-center justify-between">
          {isDrawerOpen && (
            <div className="flex items-center gap-2">
              <FileText className="h-4 w-4 text-primary" />
              <span className="font-semibold text-sm">User Story Input</span>
            </div>
          )}
          <Button
            size="icon"
            variant="ghost"
            onClick={() => setIsDrawerOpen(!isDrawerOpen)}
            className="h-8 w-8"
            data-testid="button-toggle-drawer"
          >
            {isDrawerOpen ? <PanelLeftClose className="h-4 w-4" /> : <PanelLeft className="h-4 w-4" />}
          </Button>
        </div>

        {/* Drawer Content */}
        {isDrawerOpen && (
          <ScrollArea className="flex-1 p-4">
            <div className="space-y-4">
              {/* Project & Sprint Info */}
              <div className="p-3 rounded-lg bg-muted/50 space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">Project</span>
                  <Button 
                    variant="ghost" 
                    size="sm" 
                    className="h-6 text-xs px-2"
                    onClick={() => { setSelectedSprintId(null); setSelectedProjectId(null); }}
                  >
                    Change
                  </Button>
                </div>
                <p className="text-sm font-medium truncate">{selectedProject?.name}</p>
                <div className="flex items-center justify-between pt-1">
                  <span className="text-xs text-muted-foreground">Sprint</span>
                  <Button 
                    variant="ghost" 
                    size="sm" 
                    className="h-6 text-xs px-2"
                    onClick={() => setSelectedSprintId(null)}
                  >
                    Change
                  </Button>
                </div>
                <p className="text-sm font-medium">{selectedSprint?.name}</p>
              </div>

              {/* User Story Dropdown */}
              <div>
                <Label className="text-xs text-muted-foreground mb-1.5 block">Select User Story</Label>
                <Select 
                  value={selectedUserStoryId || ""} 
                  onValueChange={(value) => {
                    if (value === "new") {
                      setSelectedUserStoryId(null);
                      setStoryTitle("");
                      setStoryDescription("");
                      setAcceptanceCriteria("");
                      setTestCases([]);
                    } else {
                      setSelectedUserStoryId(value);
                    }
                  }}
                >
                  <SelectTrigger data-testid="select-user-story">
                    <SelectValue placeholder="Create new or select existing..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="new">+ Create New User Story</SelectItem>
                    {userStories.map(story => (
                      <SelectItem key={story.id} value={story.id}>
                        {story.title}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {loadingUserStories && (
                  <p className="text-xs text-muted-foreground mt-1">Loading user stories...</p>
                )}
              </div>

              {/* User Story Title */}
              <div>
                <Label className="text-xs text-muted-foreground mb-1.5 block">User Story Title</Label>
                <Input 
                  placeholder="As a user, I want to..."
                  value={storyTitle}
                  onChange={e => setStoryTitle(e.target.value)}
                  className="h-9"
                  data-testid="input-story-title"
                />
              </div>

              {/* Description */}
              <div>
                <Label className="text-xs text-muted-foreground mb-1.5 block">Description</Label>
                <Textarea 
                  placeholder="Paste or type the user story description..."
                  value={storyDescription}
                  onChange={e => setStoryDescription(e.target.value)}
                  className="min-h-[100px] resize-none"
                  data-testid="textarea-story-description"
                />
              </div>

              {/* Acceptance Criteria - Single Text Box */}
              <div>
                <Label className="text-xs text-muted-foreground mb-1.5 block">Acceptance Criteria</Label>
                <Textarea 
                  placeholder="Enter all acceptance criteria here...

Example:
- User should be able to login with email and password
- System should display error for invalid credentials
- User should be redirected to dashboard after successful login"
                  value={acceptanceCriteria}
                  onChange={e => setAcceptanceCriteria(e.target.value)}
                  className="min-h-[150px] resize-none"
                  data-testid="textarea-acceptance-criteria"
                />
              </div>

              {/* Framework Catalog */}
              {frameworkConfigs.length > 0 && (
                <div>
                  <Label className="text-xs text-muted-foreground mb-1.5 block flex items-center gap-1.5">
                    Framework Catalog
                    <span className="font-normal text-muted-foreground/60">(optional)</span>
                  </Label>
                  <select
                    value={selectedFrameworkConfigId}
                    onChange={e => setSelectedFrameworkConfigId(e.target.value)}
                    className="w-full h-9 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
                    data-testid="select-framework-config"
                  >
                    <option value="">— None (use generic patterns) —</option>
                    {frameworkConfigs.map(fc => (
                      <option key={fc.id} value={fc.id}>
                        {fc.name} ({fc.framework}/{fc.language}){fc.isGlobal ? " 🌐" : ""}{fc.functionCount ? ` · ${fc.functionCount} fns` : ""}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* Use Golden Repo Guidance toggle (SDLC RAG, mirrors BRD) */}
              <div className="flex items-center justify-between rounded-md border border-input bg-background px-3 py-2">
                <div className="space-y-0.5">
                  <Label className="text-xs font-medium text-foreground flex items-center gap-1.5 mb-0">
                    🏛️ Use Golden Repo Guidance
                  </Label>
                  <p className="text-[11px] text-muted-foreground/80 leading-snug max-w-[26rem]">
                    Pull standards & patterns from this project's SDLC Golden Repo into test generation. Same data source BRD uses. No-op if no Golden Repo files are configured.
                  </p>
                </div>
                <Switch
                  checked={useGoldenRepoGuidance}
                  onCheckedChange={setUseGoldenRepoGuidance}
                  disabled={isGenerating}
                  data-testid="qe-toggle-use-golden-repo-2"
                />
              </div>

              {/* Local Repo Path (optional fallback) */}
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground mb-1.5 block flex items-center gap-1.5">
                  📁 Local Repo Path
                  <span className="font-normal text-muted-foreground/60">(optional — local-only fallback for codebase scanning)</span>
                </Label>
                <input
                  type="text"
                  placeholder="e.g. C:\Projects\my-app  or  /home/user/my-app"
                  value={repoPath}
                  onChange={e => setRepoPath(e.target.value)}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 font-mono"
                  disabled={isGenerating}
                />
                {repoPath.trim() && (
                  <p className="text-xs text-emerald-500 flex items-center gap-1">
                    <span>✓</span> Claude will scan this repo and use real endpoints, schema fields, and risk areas to enrich test cases
                  </p>
                )}
              </div>

              {/* Context Documents upload */}
              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground mb-1.5 block flex items-center gap-1.5">
                  <FilePlus2 className="h-3.5 w-3.5" />
                  Context Documents
                  <span className="font-normal text-muted-foreground/60">(optional — BRD, FRD, existing test cases, SRS)</span>
                </Label>

                {/* Drop zone / file picker */}
                <label
                  className={[
                    "flex flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed px-4 py-5 cursor-pointer transition-colors",
                    isUploading
                      ? "border-muted/40 bg-muted/10 cursor-not-allowed opacity-60"
                      : "border-muted/50 bg-muted/5 hover:border-primary/40 hover:bg-primary/5",
                  ].join(" ")}
                >
                  <input
                    type="file"
                    multiple
                    accept=".pdf,.docx,.xlsx,.xls,.txt,.md,.feature,.spec.ts,.spec.js,.json"
                    className="sr-only"
                    disabled={isUploading || isGenerating}
                    onChange={e => handleDocumentUpload(e.target.files)}
                  />
                  {isUploading ? (
                    <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                  ) : (
                    <FileUp className="h-5 w-5 text-muted-foreground" />
                  )}
                  <span className="text-xs text-muted-foreground text-center">
                    {isUploading ? "Extracting text…" : "Click to upload or drag files here"}
                  </span>
                  <span className="text-[10px] text-muted-foreground/60">
                    PDF, DOCX, XLSX, TXT, MD, .feature · up to 5 files · 10 MB each
                  </span>
                </label>

                {/* Uploaded files list */}
                {uploadedDocs.length > 0 && (
                  <ul className="space-y-1">
                    {uploadedDocs.map((doc, idx) => (
                      <li
                        key={idx}
                        className="flex items-center gap-2 rounded-md bg-muted/20 px-3 py-1.5 text-xs"
                      >
                        <FileText className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                        <span className="truncate flex-1 font-mono text-[11px]">{doc.fileName}</span>
                        <span className="text-muted-foreground/70 shrink-0">
                          {(doc.charCount / 1000).toFixed(1)}k chars
                          {doc.truncated && <span className="text-amber-400 ml-1">(truncated)</span>}
                        </span>
                        <button
                          type="button"
                          onClick={() => handleRemoveUploadedDoc(idx)}
                          disabled={isGenerating}
                          className="ml-1 text-muted-foreground/50 hover:text-destructive disabled:cursor-not-allowed"
                          aria-label={`Remove ${doc.fileName}`}
                        >
                          <XCircle className="h-3.5 w-3.5" />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {/* Save Story Button */}
              <Button
                variant="outline"
                className="w-full"
                onClick={handleSaveUserStory}
                disabled={!storyTitle.trim() || isSavingUserStory}
                data-testid="button-save-story"
              >
                {isSavingUserStory ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Saving...
                  </>
                ) : (
                  <>
                    <Save className="h-4 w-4 mr-2" />
                    Save User Story
                  </>
                )}
              </Button>

              {/* Generate Button */}
              <Button 
                className="w-full"
                onClick={handleGenerate}
                disabled={isGenerating || !storyTitle.trim()}
                data-testid="button-generate-tests"
              >
                {isGenerating ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Generating...
                  </>
                ) : (
                  <>
                    <Sparkles className="h-4 w-4 mr-2" />
                    Generate Test Cases
                  </>
                )}
              </Button>
            </div>
          </ScrollArea>
        )}

        {/* Collapsed State */}
        {!isDrawerOpen && (
          <div className="flex-1 flex flex-col items-center pt-4 gap-4">
            <Button
              size="icon"
              variant="ghost"
              onClick={() => setIsDrawerOpen(true)}
              className="h-10 w-10"
              title="Edit User Story"
              data-testid="button-edit-story"
            >
              <FileText className="h-5 w-5" />
            </Button>
          </div>
        )}
      </div>

      {/* Main Content - Test Cases */}
      <div className="flex-1 flex flex-col overflow-y-auto">
        {/* Header */}
        <div className="p-4 border-b bg-card">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-xl font-bold">Generated Test Cases</h1>
              <p className="text-sm text-muted-foreground">
                {testCases.length > 0 
                  ? `${testCases.length} test cases generated`
                  : "Enter a user story to generate test cases"
                }
              </p>
            </div>
            {testCases.length > 0 && (
              <div className="flex gap-2">
                <PushToPlatform 
                  testCases={testCases.map(tc => ({
                    id: tc.id,
                    title: tc.title,
                    category: tc.category,
                    priority: tc.priority,
                    steps: tc.steps.map(s => ({ action: s.action })),
                  }))}
                  size="sm"
                />
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="sm" data-testid="button-export-2">
                      <Download className="h-4 w-4 mr-1" />
                      Export
                      <ChevronDown className="h-3 w-3 ml-1" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={handleExportExcel} disabled={isExporting} data-testid="export-excel-2">
                      {isExporting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <FileSpreadsheet className="h-4 w-4 mr-2" />}
                      {isExporting ? 'Exporting...' : 'Export to Excel (.xlsx)'}
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={handleExportText} disabled={isExporting} data-testid="export-text-2">
                      <FileType className="h-4 w-4 mr-2" />
                      Export to Text (.txt)
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={handleExportBddAssets} disabled={isExportingBdd || !generatedBddAssets} data-testid="export-bdd-2">
                      {isExportingBdd ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Code2 className="h-4 w-4 mr-2" />}
                      {isExportingBdd ? 'Exporting...' : 'Export BDD Assets (.zip)'}
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={handleExportPlaywright} data-testid="export-playwright-2">
                      <FileText className="h-4 w-4 mr-2" />
                      Download Playwright Script (.ts)
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={handleExportSelenium} data-testid="export-selenium-2">
                      <Code2 className="h-4 w-4 mr-2" />
                      Download Selenium Script (.java)
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={handleExportTestComplete} data-testid="export-testcomplete-2">
                      <Code2 className="h-4 w-4 mr-2" />
                      Download TestComplete Script (.js)
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
                <Button variant="outline" size="sm" onClick={handleSaveAll} disabled={isSaving} data-testid="button-save-all">
                  {isSaving ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Save className="h-4 w-4 mr-1" />}
                  Save All
                </Button>
              </div>
            )}
          </div>
        </div>

        {/* Category Tabs (sticky) */}
        {testCases.length > 0 && (
          <div className="border-b bg-card px-4 flex-shrink-0">
            <Tabs value={selectedTab} onValueChange={setSelectedTab}>
              <TabsList className="h-10 bg-transparent border-b-0">
                <TabsTrigger value="all" className="data-[state=active]:bg-muted" data-testid="tab-all">
                  All ({categoryCounts.all})
                </TabsTrigger>
                <TabsTrigger value="functional" className="data-[state=active]:bg-muted" data-testid="tab-functional">
                  Functional ({categoryCounts.functional})
                </TabsTrigger>
                <TabsTrigger value="negative" className="data-[state=active]:bg-muted" data-testid="tab-negative">
                  Negative ({categoryCounts.negative})
                </TabsTrigger>
                <TabsTrigger value="edge_case" className="data-[state=active]:bg-muted" data-testid="tab-edge">
                  Edge ({categoryCounts.edge_case})
                </TabsTrigger>
                <TabsTrigger value="security" className="data-[state=active]:bg-muted" data-testid="tab-security">
                  Security ({categoryCounts.security})
                </TabsTrigger>
                <TabsTrigger value="accessibility" className="data-[state=active]:bg-muted" data-testid="tab-accessibility">
                  A11y ({categoryCounts.accessibility})
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
        )}

        {/* Scrollable content: Dashboard + Test Cases */}
        <ScrollArea className="flex-1 p-4">
          {/* Coverage Intelligence Dashboard (Local Mode) */}
          {testCases.length > 0 && (
            <div className="mb-4">
              <CoverageIntelligenceDashboard
                testCases={testCases}
                traceabilityReport={traceabilityReport}
                coverageSummary={coverageSummary}
                acceptanceCriteria={acceptanceCriteria}
              />
            </div>
          )}
          {testCases.length === 0 && !isGenerating ? (
            <div className="flex flex-col items-center justify-center h-full text-center">
              <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-4">
                <Sparkles className="h-8 w-8 text-muted-foreground" />
              </div>
              <h3 className="font-semibold mb-2">No Test Cases Yet</h3>
              <p className="text-sm text-muted-foreground max-w-md">
                {isDrawerOpen 
                  ? "Enter a user story with acceptance criteria, then click 'Generate Test Cases' to create comprehensive test coverage."
                  : "Click the panel icon on the left to enter a user story and generate test cases."
                }
              </p>
            </div>
          ) : testCases.length === 0 && isGenerating ? (
            <div className="w-full">
              <AgenticProgress 
                isActive={isGenerating}
                events={agenticEvents}
                categoryCounts={categoryCounts}
              />
            </div>
          ) : (
            <div className="space-y-4">
              {/* Show Agentic Progress while generating with test cases already showing */}
              {isGenerating && (
                <div className="w-full mb-6">
                  <AgenticProgress 
                    isActive={isGenerating}
                    events={agenticEvents}
                    categoryCounts={categoryCounts}
                  />
                </div>
              )}
              
              {renderBulkActionBar(selectedTab)}
              <div className="grid gap-3 w-full">
              {getFilteredTestCases().map(tc => (
                <Card
                  key={tc.id}
                  className={`w-full ${isTestCaseSelected(tc.id) ? "ring-1 ring-primary/40" : ""}`}
                  data-testid={`card-testcase-${tc.id}`}
                >
                  {/* Test Case Header */}
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: 10,
                      padding: '12px 16px',
                      width: '100%',
                    }}
                  >
                    {renderTestCaseCheckbox(tc.id)}
                  <button
                    onClick={() => setExpandedTestId(expandedTestId === tc.id ? null : tc.id)}
                    data-testid={`button-expand-${tc.id}`}
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: 10,
                      flex: 1,
                      minWidth: 0,
                      textAlign: 'left',
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      padding: 0,
                    }}
                  >
                    {/* ID badge — top-left, never shrinks */}
                    <div style={{ flexShrink: 0, paddingTop: 2 }}>
                      <span className={`text-xs font-mono font-semibold ${tc.priority === 'P0' ? 'text-red-500' : tc.priority === 'P1' ? 'text-orange-500' : 'text-muted-foreground'}`}>
                        {tc.id}
                      </span>
                    </div>

                    {/* Title — takes all remaining space, wraps freely */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{
                        margin: 0,
                        fontSize: 13,
                        fontWeight: 500,
                        lineHeight: 1.5,
                        color: 'inherit',
                        whiteSpace: 'normal',
                        wordBreak: 'break-word',
                        overflowWrap: 'break-word',
                      }}>
                        {tc.title}
                      </p>
                    </div>

                    {/* Priority + Category badges + chevron — top-right, never shrink */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0, paddingTop: 1 }}>
                      <Badge variant="outline" className={`text-xs ${getPriorityColor(tc.priority)}`}>
                        {tc.priority}
                      </Badge>
                      <Badge variant="outline" className="text-xs">
                        {getCategoryLabel(tc.category)}
                      </Badge>
                      {expandedTestId === tc.id
                        ? <ChevronUp className="h-4 w-4 text-muted-foreground" />
                        : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                    </div>
                  </button>
                  </div>

                  {/* Expanded Test Case Details */}
                  {expandedTestId === tc.id && (
                    <div className="px-4 pb-4 border-t bg-muted/30">
                      {/* Description */}
                      {tc.description && (
                        <div className="pt-3">
                          <Label className="text-xs text-muted-foreground mb-1 block font-semibold">Description</Label>
                          <p className="text-sm text-foreground">{tc.description}</p>
                        </div>
                      )}
                      
                      {/* Objective */}
                      {tc.objective && (
                        <div className="pt-3">
                          <Label className="text-xs text-muted-foreground mb-1 block font-semibold">Objective</Label>
                          <p className="text-sm text-foreground">{tc.objective}</p>
                        </div>
                      )}
                      
                      {/* Preconditions */}
                      {tc.preconditions && tc.preconditions.length > 0 && (
                        <div className="pt-3">
                          <Label className="text-xs text-muted-foreground mb-1 block font-semibold">Preconditions</Label>
                          <ul className="text-sm space-y-1 list-disc list-inside text-foreground">
                            {tc.preconditions.map((pre, idx) => (
                              <li key={idx}>{pre}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                      
                      {/* Test Steps with Expected Behavior */}
                      <div className="pt-3">
                        <Label className="text-xs text-muted-foreground mb-2 block font-semibold">Test Steps</Label>
                        <div className="space-y-3">
                          {tc.steps.map(step => (
                            <div key={step.step_number} className="border-l-2 border-primary/30 pl-3">
                              <div className="flex gap-2 text-sm">
                                <span className="text-primary font-mono text-xs font-bold w-5 flex-shrink-0">
                                  {step.step_number}.
                                </span>
                                <div className="flex-1">
                                  <p className="font-medium">{step.action}</p>
                                  {step.expected_behavior && (
                                    <p className="text-muted-foreground text-xs mt-1">
                                      <span className="font-semibold">Expected:</span> {step.expected_behavior}
                                    </p>
                                  )}
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                      
                      {/* Expected Result */}
                      {tc.expectedResult && (
                        <div className="pt-3">
                          <Label className="text-xs text-muted-foreground mb-1 block font-semibold">Expected Results</Label>
                          <div className="text-sm text-foreground whitespace-pre-line bg-green-500/10 border border-green-500/20 rounded p-2">
                            {tc.expectedResult}
                          </div>
                        </div>
                      )}
                      
                      {/* Postconditions */}
                      {tc.postconditions && tc.postconditions.length > 0 && (
                        <div className="pt-3">
                          <Label className="text-xs text-muted-foreground mb-1 block font-semibold">Postconditions</Label>
                          <ul className="text-sm space-y-1 list-disc list-inside text-foreground">
                            {tc.postconditions.map((post, idx) => (
                              <li key={idx}>{post}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                      
                      <div className="flex gap-2 mt-4">
                        <Button 
                          size="sm" 
                          variant="outline" 
                          className="text-xs"
                          onClick={(e) => { e.stopPropagation(); handleEditTestCase(tc); }}
                          data-testid={`button-edit-${tc.id}`}
                        >
                          <Pencil className="h-3 w-3 mr-1" />
                          Edit
                        </Button>
                        <Button 
                          size="sm" 
                          variant="outline" 
                          className="text-xs"
                          onClick={(e) => { e.stopPropagation(); handleDeleteTestCase(tc.id); }}
                          data-testid={`button-delete-${tc.id}`}
                        >
                          <Trash2 className="h-3 w-3 mr-1" />
                          Delete
                        </Button>
                      </div>
                    </div>
                  )}
                </Card>
              ))}
              </div>
            </div>
          )}
        </ScrollArea>
      </div>

      {renderTestCaseDialogs()}
      </main>
    </>
  );
}
