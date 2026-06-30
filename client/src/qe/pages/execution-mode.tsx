import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation, Link } from "wouter";
import { DashboardHeader } from "@/components/dashboard/header";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { invalidateTmOverview } from "@/lib/tm-overview";
import { Copy, Download } from "lucide-react";
import type { Project, Sprint, SprintTestCase, ExecutionRun, FunctionalTestRun } from "@shared/qe-schema";
import {
  Play,
  ArrowLeft,
  Pause,
  Square,
  RefreshCw,
  CheckCircle,
  XCircle,
  Clock,
  Bot,
  Eye,
  FileCode,
  Settings,
  Folder,
  ChevronRight,
  Cpu,
  Activity,
  Terminal,
  Camera,
  Video,
  FileText,
  Sparkles,
  Loader2,
  AlertCircle,
  LayoutDashboard,
  Globe,
  Zap,
} from "lucide-react";

type ExecutionPhase = 'select' | 'configure' | 'running' | 'results';
type AgentStatus = 'idle' | 'thinking' | 'working' | 'completed' | 'error';

interface AgentState {
  name: string;
  status: AgentStatus;
  activity: string;
  icon: React.ReactNode;
}

interface ExecutionProgress {
  currentTest: number;
  totalTests: number;
  currentStep: number;
  totalSteps: number;
  screenshot?: string;
  logs: string[];
  featureFile?: string;
  stepDefinitions?: string;
}

interface PlaywrightLog {
  timestamp: string;
  level: 'info' | 'warn' | 'error';
  category: 'browser' | 'page' | 'console' | 'network' | 'navigation' | 'action' | 'assertion' | 'test' | 'result';
  message: string;
}

const categoryColors: Record<string, string> = {
  functional: 'bg-blue-500/10 text-blue-400 border-blue-500/30',
  negative: 'bg-amber-500/10 text-amber-400 border-amber-500/30',
  edge_case: 'bg-purple-500/10 text-purple-400 border-purple-500/30',
  security: 'bg-red-500/10 text-red-400 border-red-500/30',
  accessibility: 'bg-green-500/10 text-green-400 border-green-500/30',
  workflow: 'bg-indigo-500/10 text-indigo-500 border-indigo-500/30',
};

export default function ExecutionModePage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  
  const [phase, setPhase] = useState<ExecutionPhase>('select');
  // Persist last valid screenshot so re-renders don't blank the live view
  const lastScreenshotRef = useRef<string | undefined>(undefined);
  const [selectedProject, setSelectedProject] = useState<string>('');
  const [testSource, setTestSource] = useState<'sprint' | 'autonomous' | 'jira'>('sprint');
  const [selectedSprint, setSelectedSprint] = useState<string>('all');
  const [selectedFunctionalRun, setSelectedFunctionalRun] = useState<string>('all');
  const [selectedJiraProject, setSelectedJiraProject] = useState<string>('');
  const [selectedJiraStory, setSelectedJiraStory] = useState<string>('all');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [selectedTestCases, setSelectedTestCases] = useState<Set<string>>(new Set());
  const [targetUrl, setTargetUrl] = useState<string>('');
  const [recordVideo, setRecordVideo] = useState<boolean>(true);
  const [generateBdd, setGenerateBdd] = useState<boolean>(true);
  const [showHtmlReport, setShowHtmlReport] = useState(false);
  const [htmlReportContent, setHtmlReportContent] = useState<string>('');
  
  const [executionProgress, setExecutionProgress] = useState<ExecutionProgress>({
    currentTest: 0,
    totalTests: 0,
    currentStep: 0,
    totalSteps: 0,
    logs: []
  });
  
  const [agents, setAgents] = useState<AgentState[]>([
    { name: 'Orchestrator', status: 'idle', activity: 'Waiting to start', icon: <Bot className="w-4 h-4" /> },
    { name: 'Navigator', status: 'idle', activity: 'Ready to navigate', icon: <Cpu className="w-4 h-4" /> },
    { name: 'Executor', status: 'idle', activity: 'Awaiting commands', icon: <Terminal className="w-4 h-4" /> },
    { name: 'Validator', status: 'idle', activity: 'Standing by', icon: <CheckCircle className="w-4 h-4" /> },
    { name: 'Reporter', status: 'idle', activity: 'Ready to report', icon: <FileText className="w-4 h-4" /> },
  ]);
  
  const [showFeatureModal, setShowFeatureModal] = useState(false);
  const [showStepDefModal, setShowStepDefModal] = useState(false);
  const [playwrightLogs, setPlaywrightLogs] = useState<PlaywrightLog[]>([]);
  const [logFilter, setLogFilter] = useState<string>('all');
  
  const { data: projectsData, isLoading: projectsLoading } = useQuery<Project[]>({
    queryKey: ['/api/projects']
  });
  
  const { data: sprintsData } = useQuery<Sprint[]>({
    queryKey: ['/api/projects', selectedProject, 'sprints'],
    queryFn: async () => {
      const res = await fetch(`/api/projects/${selectedProject}/sprints`, {
        credentials: 'include'
      });
      if (!res.ok) throw new Error('Failed to fetch sprints');
      return res.json();
    },
    enabled: !!selectedProject && testSource === 'sprint'
  });

  const { data: functionalRunsData } = useQuery<{ success: boolean; runs: FunctionalTestRun[] }>({
    queryKey: ['/api/execution/functional-runs', selectedProject],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (selectedProject) params.append('projectId', selectedProject);
      const res = await fetch(`/api/execution/functional-runs?${params.toString()}`, {
        credentials: 'include'
      });
      if (!res.ok) throw new Error('Failed to fetch functional runs');
      return res.json();
    },
    enabled: testSource === 'autonomous'
  });

  const { data: jiraProjectsData } = useQuery<{ success: boolean; projects: Array<{ projectKey: string; storyCount: number; testCaseCount: number }> }>({
    queryKey: ['/api/execution/jira-projects'],
    queryFn: async () => {
      const res = await fetch('/api/execution/jira-projects', { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch Jira projects');
      return res.json();
    },
    enabled: testSource === 'jira'
  });

  const { data: jiraStoriesData } = useQuery<{ success: boolean; stories: Array<{ storyId: string; storyTitle: string; testCaseCount: number }> }>({
    queryKey: ['/api/execution/jira-stories', selectedJiraProject],
    queryFn: async () => {
      const res = await fetch(`/api/execution/jira-stories/${selectedJiraProject}`, { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch Jira stories');
      return res.json();
    },
    enabled: testSource === 'jira' && !!selectedJiraProject
  });
  
  const { data: testCasesData, isLoading: testCasesLoading, refetch: refetchTestCases } = useQuery<{ success: boolean; testCases: any[] }>({
    queryKey: ['/api/execution/test-cases', selectedProject, testSource, selectedSprint, selectedFunctionalRun, selectedCategory, selectedJiraProject, selectedJiraStory],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.append('source', testSource);
      if (testSource === 'jira') {
        if (selectedJiraProject) params.append('jiraProjectKey', selectedJiraProject);
        if (selectedJiraStory && selectedJiraStory !== 'all') params.append('jiraStoryId', selectedJiraStory);
      } else {
        if (selectedProject) params.append('projectId', selectedProject);
        if (testSource === 'sprint' && selectedSprint && selectedSprint !== 'all') {
          params.append('sprintId', selectedSprint);
        }
        if (testSource === 'autonomous' && selectedFunctionalRun && selectedFunctionalRun !== 'all') {
          params.append('functionalRunId', selectedFunctionalRun);
        }
      }
      if (selectedCategory) params.append('category', selectedCategory);
      const res = await fetch(`/api/execution/test-cases?${params.toString()}`, {
        credentials: 'include'
      });
      if (!res.ok) throw new Error('Failed to fetch test cases');
      return res.json();
    },
    enabled: testSource === 'jira' ? !!selectedJiraProject : (testSource === 'autonomous' || !!selectedProject)
  });
  
  const { data: executionRunsData } = useQuery<{ success: boolean; runs: ExecutionRun[] }>({
    queryKey: ['/api/execution-runs', selectedProject],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (selectedProject) params.append('projectId', selectedProject);
      const res = await fetch(`/api/execution-runs?${params.toString()}`, {
        credentials: 'include'
      });
      if (!res.ok) throw new Error('Failed to fetch execution runs');
      return res.json();
    },
    enabled: !!selectedProject
  });
  
  useEffect(() => {
    if (testSource === 'jira' ? selectedJiraProject : selectedProject) {
      refetchTestCases();
    }
  }, [selectedProject, testSource, selectedSprint, selectedFunctionalRun, selectedCategory, selectedJiraProject, selectedJiraStory, refetchTestCases]);
  
  const createExecutionMutation = useMutation({
    mutationFn: async (data: any) => {
      const response = await apiRequest('POST', '/api/execution-runs', data);
      return response.json();
    },
    onSuccess: (data: any) => {
      toast({
        title: "Execution Started",
        description: "Test execution has been initiated"
      });
      setPhase('running');
      startExecution(data.run.id);
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to start execution",
        variant: "destructive"
      });
    }
  });
  
  const startExecution = async (runId: string) => {
    updateAgentStatus('Orchestrator', 'working', 'Initializing execution pipeline...');
    setPlaywrightLogs([]); // Clear previous logs
    lastScreenshotRef.current = undefined; // Reset cached screenshot for new run
    
    const testCaseIdsParam = Array.from(selectedTestCases).join(',');
    const sourceParam = testSource;
    let streamUrl = `/api/execution-runs/${runId}/stream?targetUrl=${encodeURIComponent(targetUrl)}&testCaseIds=${encodeURIComponent(testCaseIdsParam)}&testCaseSource=${sourceParam}`;
    if (testSource === 'jira' && selectedJiraProject) {
      streamUrl += `&jiraProjectKey=${encodeURIComponent(selectedJiraProject)}`;
    }
    const eventSource = new EventSource(streamUrl);
    
    eventSource.addEventListener('connected', () => {
      updateAgentStatus('Orchestrator', 'working', 'Connected to execution stream');
    });
    
    eventSource.addEventListener('agent_status', (event) => {
      const data = JSON.parse(event.data);
      updateAgentStatus(data.agent, data.status, data.activity);
    });
    
    eventSource.addEventListener('step_progress', (event) => {
      const data = JSON.parse(event.data);
      setExecutionProgress(prev => ({
        ...prev,
        currentStep: data.stepIndex,
        totalSteps: data.totalSteps
      }));
    });
    
    eventSource.addEventListener('screenshot', (event) => {
      const data = JSON.parse(event.data);
      setExecutionProgress(prev => ({
        ...prev,
        screenshot: data.screenshot
      }));
    });
    
    eventSource.addEventListener('test_complete', (event) => {
      const data = JSON.parse(event.data);
      setExecutionProgress(prev => ({
        ...prev,
        currentTest: prev.currentTest + 1,
        logs: [...prev.logs, `Test ${data.testCaseId}: ${data.status}`]
      }));
    });
    
    eventSource.addEventListener('bdd_artifacts', (event) => {
      const data = JSON.parse(event.data);
      setExecutionProgress(prev => ({
        ...prev,
        featureFile: data.featureFile,
        stepDefinitions: data.stepDefinitions
      }));
    });
    
    eventSource.addEventListener('html_report', (event) => {
      const data = JSON.parse(event.data);
      setHtmlReportContent(data.htmlReport);
    });
    
    eventSource.addEventListener('playwright_log', (event) => {
      const data = JSON.parse(event.data);
      setPlaywrightLogs(prev => [...prev, data as PlaywrightLog]);
    });
    
    eventSource.addEventListener('complete', () => {
      eventSource.close();
      setPhase('results');
      updateAgentStatus('Orchestrator', 'completed', 'Execution completed');
      invalidateTmOverview();
      toast({
        title: "Execution Complete",
        description: "All test cases have been executed"
      });
    });
    
    // Handle custom error events from the server (navigation failures, etc.)
    eventSource.addEventListener('execution_error', (event) => {
      const data = JSON.parse(event.data);
      eventSource.close();
      setPhase('results');
      toast({
        title: "Execution Failed",
        description: data.message || "An error occurred during execution",
        variant: "destructive"
      });
    });
    
    // Handle SSE connection errors
    eventSource.addEventListener('error', () => {
      eventSource.close();
      updateAgentStatus('Orchestrator', 'error', 'Connection to execution stream failed');
    });
  };
  
  const updateAgentStatus = (agentName: string, status: AgentStatus, activity: string) => {
    setAgents(prev => prev.map(agent => 
      agent.name === agentName ? { ...agent, status, activity } : agent
    ));
  };
  
  const handleProjectChange = (projectId: string) => {
    setSelectedProject(projectId);
    setSelectedTestCases(new Set());
    setSelectedSprint('all');
    setSelectedFunctionalRun('all');
    
    const project = projectsData?.find((p) => p.id === projectId);
    if (project?.websiteUrl) {
      setTargetUrl(project.websiteUrl);
    } else {
      setTargetUrl('');
    }
  };
  
  const handleTestCaseToggle = (testCaseId: string) => {
    setSelectedTestCases(prev => {
      const next = new Set(prev);
      if (next.has(testCaseId)) {
        next.delete(testCaseId);
      } else {
        next.add(testCaseId);
      }
      return next;
    });
  };
  
  const handleSelectAll = () => {
    if (testCasesData?.testCases) {
      setSelectedTestCases(new Set(testCasesData.testCases.map(tc => tc.id)));
    }
  };
  
  const handleDeselectAll = () => {
    setSelectedTestCases(new Set());
  };
  
  const handleStartExecution = () => {
    const needsProject = testSource === 'sprint' && !selectedProject;
    const needsJiraProject = testSource === 'jira' && !selectedJiraProject;
    if (needsProject || needsJiraProject || !targetUrl || selectedTestCases.size === 0) {
      toast({
        title: "Missing Configuration",
        description: needsProject || needsJiraProject
          ? "Please select a project, enter target URL, and select test cases"
          : "Please enter target URL and select test cases",
        variant: "destructive"
      });
      return;
    }
    
    setExecutionProgress({
      currentTest: 0,
      totalTests: selectedTestCases.size,
      currentStep: 0,
      totalSteps: 0,
      logs: []
    });
    
    createExecutionMutation.mutate({
      projectId: testSource === 'jira' ? selectedJiraProject : selectedProject,
      targetUrl,
      testCaseIds: Array.from(selectedTestCases),
      testCaseSource: testSource,
      config: {
        recordVideo,
        generateBdd,
        headless: true
      }
    });
  };
  
  const getStatusColor = (status: AgentStatus) => {
    switch (status) {
      case 'idle': return 'text-muted-foreground';
      case 'thinking': return 'text-amber-400';
      case 'working': return 'text-indigo-500';
      case 'completed': return 'text-green-400';
      case 'error': return 'text-red-400';
      default: return 'text-muted-foreground';
    }
  };
  
  const getStatusBg = (status: AgentStatus) => {
    switch (status) {
      case 'idle': return 'bg-muted/50';
      case 'thinking': return 'bg-amber-500/10';
      case 'working': return 'bg-indigo-500/10';
      case 'completed': return 'bg-green-500/10';
      case 'error': return 'bg-red-500/10';
      default: return 'bg-muted/50';
    }
  };

  const projects = projectsData || [];
  const testCases = testCasesData?.testCases || [];
  const executionRuns = executionRunsData?.runs || [];
  const functionalRuns = functionalRunsData?.runs || [];

  return (
    <>
      <DashboardHeader />
      <main className="flex-1 overflow-y-auto">
        <div className="p-6 space-y-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Link href="/dashboard">
                <button
                  type="button"
                  className="flex items-center gap-2 px-3 py-2 rounded-lg border border-border bg-background text-sm font-medium text-foreground hover:bg-muted/50 transition-colors"
                  data-testid="button-nav-dashboard"
                >
                  <ArrowLeft className="h-4 w-4 shrink-0" aria-hidden />
                  Dashboard
                </button>
              </Link>
              <div className="p-2 rounded-lg bg-gradient-to-br from-primary/20 to-primary/10">
                <Play className="w-6 h-6 text-primary" />
              </div>
              <div>
                <h1 className="text-2xl font-bold text-foreground">Execution Mode</h1>
                <p className="text-sm text-muted-foreground">Run automated tests with AI agents</p>
              </div>
            </div>
            
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="gap-1">
                <Activity className="w-3 h-3" />
                {phase === 'running' ? 'Executing' : 'Ready'}
              </Badge>
            </div>
          </div>
          
          <div className="grid grid-cols-12 gap-6">
            <div className="col-span-8 space-y-6">
              <Card className="border-border/50 bg-card/50">
                <CardHeader className="pb-4">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-lg flex items-center gap-2">
                      <Folder className="w-5 h-5 text-indigo-500" />
                      Test Selection
                    </CardTitle>
                    <div className="flex items-center gap-4">
                      <div className="flex items-center gap-2">
                        <Checkbox
                          id="select-all-tests"
                          checked={selectedTestCases.size > 0 && selectedTestCases.size === testCases.length}
                          onCheckedChange={(checked) => {
                            if (checked) {
                              handleSelectAll();
                            } else {
                              handleDeselectAll();
                            }
                          }}
                          disabled={phase === 'running' || testCases.length === 0}
                          data-testid="checkbox-select-all"
                        />
                        <Label htmlFor="select-all-tests" className="text-sm cursor-pointer font-medium">
                          Select All ({selectedTestCases.size}/{testCases.length})
                        </Label>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={handleDeselectAll}
                        disabled={phase === 'running' || selectedTestCases.size === 0}
                        data-testid="button-clear-selection"
                      >
                        Clear
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    {testSource !== 'jira' && (
                      <div className="space-y-2">
                        <Label>Project</Label>
                        <Select
                          value={selectedProject}
                          onValueChange={handleProjectChange}
                          disabled={phase === 'running'}
                        >
                          <SelectTrigger data-testid="select-project">
                            <SelectValue placeholder="Select a project" />
                          </SelectTrigger>
                          <SelectContent>
                            {projects.filter(p => p.id).map((project) => (
                              <SelectItem 
                                key={project.id} 
                                value={String(project.id)}
                                data-testid={`select-project-option-${project.id}`}
                              >
                                {project.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    )}

                    <div className="space-y-2">
                      <Label>Test Source</Label>
                      <Select
                        value={testSource}
                        onValueChange={(val: 'sprint' | 'autonomous' | 'jira') => {
                          setTestSource(val);
                          setSelectedTestCases(new Set());
                          setSelectedSprint('all');
                          setSelectedFunctionalRun('all');
                          setSelectedJiraProject('');
                          setSelectedJiraStory('all');
                          if (val === 'autonomous') setSelectedCategory('all');
                        }}
                        disabled={phase === 'running'}
                      >
                        <SelectTrigger data-testid="select-test-source">
                          <SelectValue placeholder="Select source" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="sprint">
                            <span className="flex items-center gap-2">
                              <Zap className="w-3 h-3" /> Sprint Agent
                            </span>
                          </SelectItem>
                          <SelectItem value="jira">
                            <span className="flex items-center gap-2">
                              <FileText className="w-3 h-3" /> Jira User Stories
                            </span>
                          </SelectItem>
                          <SelectItem value="autonomous">
                            <span className="flex items-center gap-2">
                              <Globe className="w-3 h-3" /> Autonomous Testing
                            </span>
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    {testSource === 'sprint' ? (
                      <div className="space-y-2">
                        <Label>Sprint</Label>
                        <Select
                          value={selectedSprint}
                          onValueChange={(val) => {
                            setSelectedSprint(val);
                            setSelectedTestCases(new Set());
                          }}
                          disabled={phase === 'running' || !selectedProject}
                        >
                          <SelectTrigger data-testid="select-sprint">
                            <SelectValue placeholder="All sprints" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="all">All Sprints</SelectItem>
                            {(sprintsData || []).filter(s => s.id).map((sprint) => (
                              <SelectItem 
                                key={sprint.id} 
                                value={String(sprint.id)}
                                data-testid={`select-sprint-option-${sprint.id}`}
                              >
                                {sprint.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    ) : testSource === 'jira' ? (
                      <div className="space-y-2">
                        <Label>Jira Project</Label>
                        <Select
                          value={selectedJiraProject}
                          onValueChange={(val) => {
                            setSelectedJiraProject(val);
                            setSelectedJiraStory('all');
                            setSelectedTestCases(new Set());
                          }}
                          disabled={phase === 'running'}
                        >
                          <SelectTrigger data-testid="select-jira-project">
                            <SelectValue placeholder="Select Jira project" />
                          </SelectTrigger>
                          <SelectContent>
                            {(jiraProjectsData?.projects || []).length === 0 ? (
                              <SelectItem value="_empty" disabled>No projects with test cases</SelectItem>
                            ) : (
                              (jiraProjectsData?.projects || []).filter(p => p.projectKey).map((proj) => (
                                <SelectItem 
                                  key={proj.projectKey} 
                                  value={String(proj.projectKey)}
                                  data-testid={`select-jira-project-option-${proj.projectKey}`}
                                >
                                  {proj.projectKey} ({proj.testCaseCount} cases, {proj.storyCount} stories)
                                </SelectItem>
                              ))
                            )}
                          </SelectContent>
                        </Select>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        <Label>Test Run</Label>
                        <Select
                          value={selectedFunctionalRun}
                          onValueChange={(val) => {
                            setSelectedFunctionalRun(val);
                            setSelectedTestCases(new Set());
                            if (val !== 'all') {
                              const run = functionalRuns.find(r => r.id === val);
                              if (run?.websiteUrl) setTargetUrl(run.websiteUrl);
                            }
                          }}
                          disabled={phase === 'running'}
                        >
                          <SelectTrigger data-testid="select-functional-run">
                            <SelectValue placeholder="All test runs" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="all">All Test Runs</SelectItem>
                            {functionalRuns.filter(r => r.id).map((run) => (
                              <SelectItem 
                                key={run.id} 
                                value={String(run.id)}
                                data-testid={`select-functional-run-option-${run.id}`}
                              >
                                {run.websiteUrl} ({run.totalTestCases} cases) - {run.domain || 'general'}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    )}
                    
                    <div className="space-y-2">
                      <Label>Category Filter</Label>
                      <Select
                        value={selectedCategory}
                        onValueChange={setSelectedCategory}
                        disabled={phase === 'running'}
                      >
                        <SelectTrigger data-testid="select-category">
                          <SelectValue placeholder="All categories" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">All Categories</SelectItem>
                          <SelectItem value="functional">Functional</SelectItem>
                          <SelectItem value="negative">Negative</SelectItem>
                          <SelectItem value="edge_case">Edge Case</SelectItem>
                          <SelectItem value="security">Security</SelectItem>
                          <SelectItem value="accessibility">Accessibility</SelectItem>
                          <SelectItem value="workflow">Workflow</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  {testSource === 'jira' && selectedJiraProject && (
                    <div className="space-y-2">
                      <Label>User Story</Label>
                      <Select
                        value={selectedJiraStory}
                        onValueChange={(val) => {
                          setSelectedJiraStory(val);
                          setSelectedTestCases(new Set());
                        }}
                        disabled={phase === 'running'}
                      >
                        <SelectTrigger data-testid="select-jira-story">
                          <SelectValue placeholder="All stories" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">All User Stories</SelectItem>
                          {(jiraStoriesData?.stories || []).filter(s => s.storyId).map((story) => (
                            <SelectItem 
                              key={story.storyId} 
                              value={String(story.storyId)}
                              data-testid={`select-jira-story-option-${story.storyId}`}
                            >
                              {story.storyId}: {story.storyTitle} ({story.testCaseCount} cases)
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                  
                  <div className="space-y-2">
                    <Label>Target URL</Label>
                    <Input
                      placeholder="https://your-application.com"
                      value={targetUrl}
                      onChange={(e) => setTargetUrl(e.target.value)}
                      disabled={phase === 'running'}
                      data-testid="input-target-url"
                    />
                  </div>
                  
                  <Separator />
                  
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label>Test Cases</Label>
                      <span className="text-sm text-muted-foreground">
                        {selectedTestCases.size} of {testCases.length} selected
                      </span>
                    </div>
                    
                    {testCasesLoading ? (
                      <div className="flex items-center justify-center py-8">
                        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                      </div>
                    ) : testCases.length === 0 ? (
                      <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
                        <AlertCircle className="w-8 h-8 mb-2" />
                        <p>No test cases found{testSource === 'jira' ? ' for this Jira project' : ' for this project'}</p>
                        <p className="text-xs mt-1">
                          {testSource === 'sprint' 
                            ? 'Generate test cases via Sprint Agent, or switch to another source'
                            : testSource === 'jira'
                            ? 'Generate test cases from Jira user stories in Sprint Agent first'
                            : 'Run autonomous tests first, or switch to Sprint Agent source'}
                        </p>
                        <Button
                          variant="ghost"
                          className="mt-2 underline"
                          onClick={() => setLocation(testSource === 'autonomous' ? '/autonomous-testing' : '/sprint-agent')}
                          data-testid="button-generate-tests"
                        >
                          {testSource === 'sprint' ? 'Go to Sprint Agent' : testSource === 'jira' ? 'Go to Sprint Agent (Jira Mode)' : 'Go to Autonomous Testing'}
                        </Button>
                      </div>
                    ) : (
                      <ScrollArea className="h-64 border rounded-lg">
                        <div className="p-2 space-y-1">
                          {testCases.map((testCase) => (
                            <div
                              key={testCase.id}
                              className={`flex items-center gap-3 p-2 rounded-lg transition-colors ${
                                phase === 'running'
                                  ? 'opacity-60 cursor-not-allowed'
                                  : 'cursor-pointer'
                              } ${
                                selectedTestCases.has(String(testCase.id))
                                  ? 'bg-primary/10 border border-primary/30'
                                  : phase !== 'running' ? 'hover:bg-muted/50' : ''
                              }`}
                              onClick={(e) => {
                                if (phase === 'running') return;
                                e.stopPropagation();
                                handleTestCaseToggle(String(testCase.id));
                              }}
                              data-testid={`test-case-${testCase.id}`}
                            >
                              <Checkbox
                                checked={selectedTestCases.has(String(testCase.id))}
                                onCheckedChange={() => { if (phase !== 'running') handleTestCaseToggle(String(testCase.id)); }}
                                onClick={(e) => e.stopPropagation()}
                                disabled={phase === 'running'}
                              />
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium truncate">{testCase.title}</p>
                                <p className="text-xs text-muted-foreground">
                                  {testCase.testSteps?.length || 0} steps
                                </p>
                              </div>
                              <Badge
                                variant="outline"
                                className={categoryColors[testCase.category?.toLowerCase() || 'functional'] || categoryColors.functional}
                              >
                                {testCase.category || 'Functional'}
                              </Badge>
                              <Badge variant="outline" className="text-xs">
                                {testCase.priority || 'P2'}
                              </Badge>
                              {testCase.source === 'autonomous' && (
                                <Badge variant="outline" className="text-xs bg-emerald-500/10 text-emerald-400 border-emerald-500/30">
                                  Auto
                                </Badge>
                              )}
                              {testCase.source === 'jira' && (
                                <Badge variant="outline" className="text-xs bg-blue-500/10 text-blue-400 border-blue-500/30">
                                  Jira
                                </Badge>
                              )}
                            </div>
                          ))}
                        </div>
                      </ScrollArea>
                    )}
                  </div>
                </CardContent>
                <CardFooter className="border-t pt-4 gap-4">
                  <div className="flex items-center gap-4">
                    <div className="flex items-center gap-2">
                      <Checkbox
                        id="recordVideo"
                        checked={recordVideo}
                        onCheckedChange={(checked) => setRecordVideo(checked as boolean)}
                        disabled={phase === 'running'}
                      />
                      <Label htmlFor="recordVideo" className="text-sm cursor-pointer flex items-center gap-1">
                        <Video className="w-4 h-4" />
                        Record Video
                      </Label>
                    </div>
                    
                    <div className="flex items-center gap-2">
                      <Checkbox
                        id="generateBdd"
                        checked={generateBdd}
                        onCheckedChange={(checked) => setGenerateBdd(checked as boolean)}
                        disabled={phase === 'running'}
                      />
                      <Label htmlFor="generateBdd" className="text-sm cursor-pointer flex items-center gap-1">
                        <FileCode className="w-4 h-4" />
                        Generate BDD Files
                      </Label>
                    </div>
                  </div>
                  
                  <div className="flex-1" />
                  
                  <Button
                    onClick={handleStartExecution}
                    disabled={phase === 'running' || selectedTestCases.size === 0 || !targetUrl}
                    className="bg-gradient-to-r from-primary to-primary/80 hover:from-primary/90 hover:to-primary/70 text-primary-foreground"
                    data-testid="button-start-execution"
                  >
                    {phase === 'running' ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Executing...
                      </>
                    ) : (
                      <>
                        <Play className="w-4 h-4 mr-2" />
                        Start Execution
                      </>
                    )}
                  </Button>
                </CardFooter>
              </Card>
              
              {phase === 'running' && (
                <Card className="border-border/50 bg-card/50">
                  <CardHeader className="pb-4">
                    <CardTitle className="text-lg flex items-center gap-2">
                      <Camera className="w-5 h-5 text-indigo-500" />
                      Live Screenshot
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="aspect-video bg-black/50 rounded-lg overflow-hidden flex items-center justify-center">
                      {(() => {
                        const shot = executionProgress.screenshot || lastScreenshotRef.current;
                        if (executionProgress.screenshot) lastScreenshotRef.current = executionProgress.screenshot;
                        return shot ? (
                          <img
                            src={shot.startsWith('data:') ? shot : `data:image/png;base64,${shot}`}
                            alt="Current execution screenshot"
                            className="w-full h-full object-contain"
                          />
                        ) : (
                          <div className="text-muted-foreground flex flex-col items-center gap-2">
                            <Loader2 className="w-8 h-8 animate-spin" />
                            <p>Waiting for screenshot...</p>
                          </div>
                        );
                      })()}
                    </div>
                    
                    <div className="mt-4 flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">
                        Test {executionProgress.currentTest} of {executionProgress.totalTests}
                      </span>
                      <span className="text-muted-foreground">
                        Step {executionProgress.currentStep} of {executionProgress.totalSteps}
                      </span>
                    </div>
                  </CardContent>
                </Card>
              )}
              
              {(phase === 'running' || phase === 'results') && playwrightLogs.length > 0 && (
                <Card className="border-border/50 bg-card/50">
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-lg flex items-center gap-2">
                        <Terminal className="w-5 h-5 text-green-400" />
                        Playwright Execution Logs
                      </CardTitle>
                      <div className="flex items-center gap-2">
                        <Select value={logFilter} onValueChange={setLogFilter}>
                          <SelectTrigger className="w-32 h-8" data-testid="select-log-filter">
                            <SelectValue placeholder="Filter" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="all">All Logs</SelectItem>
                            <SelectItem value="browser">Browser</SelectItem>
                            <SelectItem value="network">Network</SelectItem>
                            <SelectItem value="console">Console</SelectItem>
                            <SelectItem value="action">Actions</SelectItem>
                            <SelectItem value="navigation">Navigation</SelectItem>
                            <SelectItem value="result">Results</SelectItem>
                            <SelectItem value="error">Errors Only</SelectItem>
                          </SelectContent>
                        </Select>
                        <Badge variant="outline" className="text-xs">
                          {playwrightLogs.length} logs
                        </Badge>
                      </div>
                    </div>
                    <CardDescription>Real-time headless browser execution logs</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <ScrollArea className="h-64 rounded-lg bg-black/80 border border-green-500/20">
                      <div className="p-3 font-mono text-xs space-y-1">
                        {playwrightLogs
                          .filter(log => {
                            if (logFilter === 'all') return true;
                            if (logFilter === 'error') return log.level === 'error';
                            return log.category === logFilter;
                          })
                          .map((log, index) => (
                            <div
                              key={index}
                              className={`flex items-start gap-2 ${
                                log.level === 'error' ? 'text-red-400' :
                                log.level === 'warn' ? 'text-amber-400' :
                                log.category === 'network' ? 'text-blue-300' :
                                log.category === 'console' ? 'text-purple-300' :
                                log.category === 'navigation' ? 'text-indigo-400' :
                                log.category === 'action' ? 'text-green-300' :
                                log.category === 'result' ? (log.message.includes('PASSED') ? 'text-green-400' : 'text-red-400') :
                                'text-gray-300'
                              }`}
                              data-testid={`playwright-log-${index}`}
                            >
                              <span className="text-gray-500 shrink-0">
                                {new Date(log.timestamp).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                              </span>
                              <span className={`shrink-0 uppercase text-[10px] px-1 rounded ${
                                log.category === 'browser' ? 'bg-indigo-500/10 text-indigo-500' :
                                log.category === 'network' ? 'bg-blue-500/20 text-blue-400' :
                                log.category === 'console' ? 'bg-purple-500/20 text-purple-400' :
                                log.category === 'navigation' ? 'bg-emerald-500/20 text-emerald-400' :
                                log.category === 'action' ? 'bg-green-500/20 text-green-400' :
                                log.category === 'assertion' ? 'bg-amber-500/20 text-amber-400' :
                                log.category === 'test' ? 'bg-indigo-500/20 text-indigo-400' :
                                log.category === 'result' ? 'bg-pink-500/20 text-pink-400' :
                                'bg-gray-500/20 text-gray-400'
                              }`}>
                                {log.category}
                              </span>
                              <span className="break-all">{log.message}</span>
                            </div>
                          ))}
                        {playwrightLogs.length === 0 && (
                          <div className="text-gray-500 text-center py-4">
                            Waiting for Playwright logs...
                          </div>
                        )}
                      </div>
                    </ScrollArea>
                  </CardContent>
                </Card>
              )}
              
              {phase === 'results' && (
                <Card className="border-border/50 bg-card/50">
                  <CardHeader className="pb-4">
                    <CardTitle className="text-lg flex items-center gap-2">
                      <CheckCircle className="w-5 h-5 text-green-400" />
                      Execution Results
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-4">
                      <div className="grid grid-cols-4 gap-4">
                        <Card className="bg-green-500/10 border-green-500/30">
                          <CardContent className="p-4 text-center">
                            <p className="text-2xl font-bold text-green-400">
                              {executionProgress.logs.filter(l => l.includes('passed')).length}
                            </p>
                            <p className="text-sm text-green-400/80">Passed</p>
                          </CardContent>
                        </Card>
                        <Card className="bg-red-500/10 border-red-500/30">
                          <CardContent className="p-4 text-center">
                            <p className="text-2xl font-bold text-red-400">
                              {executionProgress.logs.filter(l => l.includes('failed')).length}
                            </p>
                            <p className="text-sm text-red-400/80">Failed</p>
                          </CardContent>
                        </Card>
                        <Card className="bg-amber-500/10 border-amber-500/30">
                          <CardContent className="p-4 text-center">
                            <p className="text-2xl font-bold text-amber-400">0</p>
                            <p className="text-sm text-amber-400/80">Skipped</p>
                          </CardContent>
                        </Card>
                        <Card className="bg-blue-500/10 border-blue-500/30">
                          <CardContent className="p-4 text-center">
                            <p className="text-2xl font-bold text-blue-400">
                              {executionProgress.totalTests}
                            </p>
                            <p className="text-sm text-blue-400/80">Total</p>
                          </CardContent>
                        </Card>
                      </div>
                      
                      <ScrollArea className="h-48 border rounded-lg">
                        <div className="p-4 space-y-2 font-mono text-sm">
                          {executionProgress.logs.map((log, index) => (
                            <div
                              key={index}
                              className={`flex items-center gap-2 ${
                                log.includes('passed') ? 'text-green-400' :
                                log.includes('failed') ? 'text-red-400' :
                                'text-muted-foreground'
                              }`}
                            >
                              {log.includes('passed') ? (
                                <CheckCircle className="w-4 h-4" />
                              ) : log.includes('failed') ? (
                                <XCircle className="w-4 h-4" />
                              ) : (
                                <Clock className="w-4 h-4" />
                              )}
                              {log}
                            </div>
                          ))}
                        </div>
                      </ScrollArea>
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>
            
            <div className="col-span-4 space-y-6">
              <Card className="border-border/50 bg-card/50">
                <CardHeader className="pb-4">
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Bot className="w-5 h-5 text-indigo-500" />
                    Agent Orchestrator
                  </CardTitle>
                  <CardDescription>AI agents coordinating test execution</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {agents.map((agent) => (
                    <div
                      key={agent.name}
                      className={`p-3 rounded-lg border transition-colors ${getStatusBg(agent.status)}`}
                    >
                      <div className="flex items-center gap-3">
                        <div className={`p-2 rounded-lg ${getStatusBg(agent.status)} ${getStatusColor(agent.status)}`}>
                          {agent.icon}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="font-medium text-sm">{agent.name}</p>
                            {agent.status === 'working' && (
                              <div className="flex gap-0.5">
                                <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-pulse" />
                                <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-pulse" style={{ animationDelay: '0.2s' }} />
                                <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-pulse" style={{ animationDelay: '0.4s' }} />
                              </div>
                            )}
                            {agent.status === 'thinking' && (
                              <Sparkles className="w-3 h-3 text-amber-400 animate-pulse" />
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground truncate">
                            {agent.activity}
                          </p>
                        </div>
                        <Badge
                          variant="outline"
                          className={`text-xs ${getStatusColor(agent.status)}`}
                        >
                          {agent.status}
                        </Badge>
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
              
              <Card className="border-border/50 bg-card/50">
                <CardHeader className="pb-4">
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Clock className="w-5 h-5 text-indigo-500" />
                    Recent Runs
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {executionRuns.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-4">
                      No previous execution runs
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {executionRuns.slice(0, 5).map((run) => (
                        <div
                          key={run.id}
                          className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted/50 cursor-pointer"
                        >
                          {run.status === 'completed' ? (
                            <CheckCircle className="w-4 h-4 text-green-400" />
                          ) : run.status === 'failed' ? (
                            <XCircle className="w-4 h-4 text-red-400" />
                          ) : (
                            <Clock className="w-4 h-4 text-muted-foreground" />
                          )}
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate">
                              {run.totalTests} tests
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {run.createdAt ? new Date(run.createdAt).toLocaleDateString() : 'N/A'}
                            </p>
                          </div>
                          <Badge variant="outline" className="text-xs">
                            {run.passedTests}/{run.totalTests}
                          </Badge>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
              
              <Card className="border-border/50 bg-card/50">
                <CardHeader className="pb-4">
                  <CardTitle className="text-lg flex items-center gap-2">
                    <FileCode className="w-5 h-5 text-indigo-500" />
                    BDD Artifacts
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    <Button
                      variant="outline"
                      className="w-full justify-start gap-2"
                      disabled={phase !== 'results' || !htmlReportContent}
                      onClick={() => setShowHtmlReport(true)}
                      data-testid="button-view-html-report"
                    >
                      <LayoutDashboard className="w-4 h-4" />
                      View HTML Report
                    </Button>
                    <Button
                      variant="outline"
                      className="w-full justify-start gap-2"
                      disabled={phase !== 'results' || !generateBdd || !executionProgress.featureFile}
                      onClick={() => setShowFeatureModal(true)}
                      data-testid="button-view-feature-files"
                    >
                      <FileText className="w-4 h-4" />
                      View Feature Files
                    </Button>
                    <Button
                      variant="outline"
                      className="w-full justify-start gap-2"
                      disabled={phase !== 'results' || !generateBdd || !executionProgress.stepDefinitions}
                      onClick={() => setShowStepDefModal(true)}
                      data-testid="button-download-bdd"
                    >
                      <FileCode className="w-4 h-4" />
                      View Step Definitions
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
      </main>
      
      {/* Feature Files Modal */}
      <Dialog open={showFeatureModal} onOpenChange={setShowFeatureModal}>
        <DialogContent className="max-w-4xl max-h-[80vh]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="w-5 h-5 text-indigo-500" />
              Feature File (Gherkin)
            </DialogTitle>
            <DialogDescription>
              BDD feature file generated from executed test cases
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2 mb-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                navigator.clipboard.writeText(executionProgress.featureFile || '');
                toast({ title: "Copied", description: "Feature file copied to clipboard" });
              }}
            >
              <Copy className="w-4 h-4 mr-2" />
              Copy
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                const blob = new Blob([executionProgress.featureFile || ''], { type: 'text/plain' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = 'test-execution.feature';
                a.click();
                URL.revokeObjectURL(url);
              }}
            >
              <Download className="w-4 h-4 mr-2" />
              Download
            </Button>
          </div>
          <ScrollArea className="h-[50vh] border rounded-lg bg-black/50">
            <pre className="p-4 text-sm font-mono text-indigo-300 whitespace-pre-wrap">
              {executionProgress.featureFile || 'No feature file generated'}
            </pre>
          </ScrollArea>
        </DialogContent>
      </Dialog>
      
      {/* Step Definitions Modal */}
      <Dialog open={showStepDefModal} onOpenChange={setShowStepDefModal}>
        <DialogContent className="max-w-4xl max-h-[80vh]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileCode className="w-5 h-5 text-indigo-500" />
              Step Definitions (Playwright)
            </DialogTitle>
            <DialogDescription>
              Playwright step definitions with real automation code
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2 mb-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                navigator.clipboard.writeText(executionProgress.stepDefinitions || '');
                toast({ title: "Copied", description: "Step definitions copied to clipboard" });
              }}
            >
              <Copy className="w-4 h-4 mr-2" />
              Copy
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                const blob = new Blob([executionProgress.stepDefinitions || ''], { type: 'text/typescript' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = 'step-definitions.ts';
                a.click();
                URL.revokeObjectURL(url);
              }}
            >
              <Download className="w-4 h-4 mr-2" />
              Download
            </Button>
          </div>
          <ScrollArea className="h-[50vh] border rounded-lg bg-black/50">
            <pre className="p-4 text-sm font-mono text-green-300 whitespace-pre-wrap">
              {executionProgress.stepDefinitions || 'No step definitions generated'}
            </pre>
          </ScrollArea>
        </DialogContent>
      </Dialog>
      
      {/* HTML Report Modal */}
      <Dialog open={showHtmlReport} onOpenChange={setShowHtmlReport}>
        <DialogContent className="max-w-6xl max-h-[90vh]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <LayoutDashboard className="w-5 h-5 text-indigo-500" />
              Test Execution Report
            </DialogTitle>
            <DialogDescription>
              Beautiful formatted HTML report with test results and screenshots
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2 mb-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                const newWindow = window.open('', '_blank');
                if (newWindow) {
                  newWindow.document.write(htmlReportContent);
                  newWindow.document.close();
                }
              }}
            >
              <Eye className="w-4 h-4 mr-2" />
              Open in New Tab
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                const blob = new Blob([htmlReportContent], { type: 'text/html' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `nat-execution-report-${new Date().toISOString().split('T')[0]}.html`;
                a.click();
                URL.revokeObjectURL(url);
              }}
            >
              <Download className="w-4 h-4 mr-2" />
              Download HTML
            </Button>
          </div>
          <div className="h-[60vh] border rounded-lg overflow-hidden bg-slate-900">
            <iframe
              srcDoc={htmlReportContent}
              className="w-full h-full"
              title="Execution Report"
              sandbox="allow-same-origin"
            />
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
