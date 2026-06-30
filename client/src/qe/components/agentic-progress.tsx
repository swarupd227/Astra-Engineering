import { useState, useEffect, useRef } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  Brain,
  Search,
  FileText,
  Shield,
  CheckCircle2,
  Loader2,
  Sparkles,
  Target,
  Zap,
  GitBranch,
  Activity,
  Eye,
  Code2,
  Download,
  Timer,
  ArrowRight,
  ChevronDown,
  ChevronUp,
  ListChecks,
  Wrench,
  ClipboardCheck,
  Circle,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

interface AgentStatus {
  agent: string;
  status: "idle" | "thinking" | "working" | "completed" | "error";
  message: string;
  details?: string;
  progress?: number;
}

interface AgenticEvent {
  type: "agent_status" | "pipeline_stage" | "test_case" | "category_complete" | "analysis_result" | "plan_result" | "refinement" | "refined_test_cases" | "bdd_assets" | "complete" | "error";
  agent?: string;
  stage?: string;
  status?: AgentStatus;
  testCase?: any;
  category?: string;
  count?: number;
  data?: any;
  message?: string;
}

interface BDDAssetsData {
  featureFiles: Array<{ name: string; content: string; module: string }>;
  stepDefinitions: Array<{ name: string; content: string; module: string }>;
  pageObjects: Array<{ name: string; content: string }>;
  utilities: { genericActions: string; waitHelpers: string; assertionHelpers: string };
  config: { playwrightConfig: string; cucumberConfig: string };
}

interface CategoryProgress {
  name: string;
  label: string;
  count: number;
  status: "pending" | "generating" | "completed";
}

interface AgenticProgressProps {
  isActive: boolean;
  events: AgenticEvent[];
  categoryCounts: Record<string, number>;
}

const AGENTS = [
  { id: "Orchestrator", name: "Orchestrator", icon: GitBranch, description: "Coordinates multi-agent workflow", duration: 5 },
  { id: "Story Analyzer", name: "Story Analyzer", icon: Search, description: "Extracts requirements & context", duration: 15 },
  { id: "Planner", name: "Planner", icon: Target, description: "Creates comprehensive test strategy", duration: 10 },
  { id: "Generator", name: "Generator", icon: FileText, description: "Generates test cases by category", duration: 45 },
  { id: "QA Refiner", name: "QA Refiner", icon: Shield, description: "Validates & refines test quality", duration: 15 },
  { id: "Test Script Generator", name: "Script Generator", icon: Code2, description: "Creates BDD assets & scripts", duration: 10 },
];

interface AgentProfile {
  id: string;
  color: string;
  bgColor: string;
  borderColor: string;
  skills: string[];
  tasks: string[];
  acceptanceCriteria: string[];
}

const AGENT_PROFILES: AgentProfile[] = [
  {
    id: "Orchestrator",
    color: "text-violet-600",
    bgColor: "bg-violet-50",
    borderColor: "border-violet-200",
    skills: ["Multi-agent coordination", "Context passing", "Error recovery", "Pipeline sequencing", "Handoff management"],
    tasks: [
      "Initialize agent communication channels",
      "Pass user story context to Story Analyzer",
      "Relay analysis results to Planner",
      "Monitor each agent for errors or timeouts",
      "Aggregate final output from all agents",
    ],
    acceptanceCriteria: [
      "All 5 downstream agents complete without error",
      "Context is passed correctly between each agent",
      "Final test case list is assembled and returned",
    ],
  },
  {
    id: "Story Analyzer",
    color: "text-blue-600",
    bgColor: "bg-blue-50",
    borderColor: "border-blue-200",
    skills: ["NLP entity extraction", "Acceptance criteria parsing", "Role & actor identification", "Domain classification", "Risk area detection"],
    tasks: [
      "Parse title, description, and acceptance criteria",
      "Extract actors, entities, and domain context",
      "Identify testable requirements from AC lines",
      "Detect field names, data types, and value ranges",
      "Flag risk areas and integration touch-points",
    ],
    acceptanceCriteria: [
      "All acceptance criteria lines are parsed into testable items",
      "Primary actor and system entities are identified",
      "Domain classification is assigned (e.g. Insurance, Finance)",
      "Risk areas are flagged for additional test coverage",
    ],
  },
  {
    id: "Planner",
    color: "text-amber-600",
    bgColor: "bg-amber-50",
    borderColor: "border-amber-200",
    skills: ["Test strategy design", "Category distribution", "Count optimisation", "Coverage gap analysis", "Priority mapping"],
    tasks: [
      "Evaluate user story complexity score",
      "Decide test count targets per category",
      "Map AC items to test categories (Functional/Negative/Edge/Security/A11y)",
      "Identify coverage gaps not in AC",
      "Assign P0–P3 priority bands to scenarios",
    ],
    acceptanceCriteria: [
      "Test count targets defined for all 5 categories",
      "Every AC item is mapped to at least one test category",
      "Coverage gaps are documented and addressed",
      "Priority distribution follows P0 > P1 > P2 > P3 weighting",
    ],
  },
  {
    id: "Generator",
    color: "text-indigo-600",
    bgColor: "bg-indigo-50",
    borderColor: "border-indigo-200",
    skills: ["Claude AI prompting", "BDD step authoring", "Test data generation", "Traceability linking", "6-step test structure"],
    tasks: [
      "Generate Functional test cases (happy path scenarios)",
      "Generate Negative test cases (invalid inputs, error states)",
      "Generate Edge Case test cases (boundaries, concurrency)",
      "Generate Security test cases (XSS, auth, injection probes)",
      "Generate Accessibility test cases (WCAG 2.1, keyboard nav)",
    ],
    acceptanceCriteria: [
      "Each test case has exactly 6 steps (action + expected behaviour)",
      "Step 6 always verifies final system state (DB, API, UI)",
      "Every test case includes a traceability link to the user story",
      "Test data fields are populated with realistic sample values",
      "Test titles use [Happy Path] / [Negative] / [Edge Case] prefixes",
    ],
  },
  {
    id: "QA Refiner",
    color: "text-emerald-600",
    bgColor: "bg-emerald-50",
    borderColor: "border-emerald-200",
    skills: ["Duplicate detection", "Coverage completeness check", "Step clarity review", "Quality scoring", "AC traceability validation"],
    tasks: [
      "Detect and remove duplicate or redundant test cases",
      "Verify every AC item has at least one test case",
      "Check step actions are specific and unambiguous",
      "Validate expected behaviours are measurable",
      "Calculate quality score (target > 80%)",
    ],
    acceptanceCriteria: [
      "Zero duplicate test scenarios in the final set",
      "Every acceptance criteria line is covered by at least one test",
      "All test steps have clear action verbs (click, enter, verify)",
      "Quality score ≥ 80% before passing to Script Generator",
    ],
  },
  {
    id: "Test Script Generator",
    color: "text-rose-600",
    bgColor: "bg-rose-50",
    borderColor: "border-rose-200",
    skills: ["Gherkin authoring", "Playwright step bindings", "BDD scaffolding", "Framework catalog integration", "Config generation"],
    tasks: [
      "Map test steps to Given / When / Then Gherkin keywords",
      "Generate .feature files (one Scenario per test case)",
      "Write Playwright + Cucumber step definition bindings",
      "Inject reusable framework catalog functions where available",
      "Produce playwright.config.ts with screenshot and video settings",
    ],
    acceptanceCriteria: [
      "Valid Gherkin syntax with no orphaned steps",
      "Every Given/When/Then has a matching step definition",
      "Framework catalog functions are referenced where applicable",
      "Playwright config includes screenshot-on-failure and video-on-failure",
    ],
  },
];

const CATEGORIES = [
  { name: "functional", label: "Functional", color: "bg-blue-500", textColor: "text-blue-400" },
  { name: "negative", label: "Negative", color: "bg-orange-500", textColor: "text-orange-400" },
  { name: "edge_case", label: "Edge Cases", color: "bg-purple-500", textColor: "text-purple-400" },
  { name: "security", label: "Security", color: "bg-emerald-500", textColor: "text-emerald-400" },
  { name: "accessibility", label: "Accessibility", color: "bg-cyan-500", textColor: "text-cyan-400" },
];

const TOTAL_ESTIMATED_TIME = AGENTS.reduce((sum, a) => sum + a.duration, 0);

export function AgenticProgress({ isActive, events, categoryCounts }: AgenticProgressProps) {
  const [agentStatuses, setAgentStatuses] = useState<Record<string, AgentStatus>>({});
  const [currentStage, setCurrentStage] = useState<string>("");
  const [stageMessage, setStageMessage] = useState<string>("");
  const [analysisData, setAnalysisData] = useState<any>(null);
  const [planData, setPlanData] = useState<any>(null);
  const [refinementMessages, setRefinementMessages] = useState<string[]>([]);
  const [refinedData, setRefinedData] = useState<{ totalTests: number; qualityScore: number } | null>(null);
  const [bddAssets, setBddAssets] = useState<BDDAssetsData | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);
  const [elapsedTime, setElapsedTime] = useState(0);
  const [showWorkflow, setShowWorkflow] = useState(true);
  const startTimeRef = useRef<number | null>(null);
  const [categoryProgress, setCategoryProgress] = useState<CategoryProgress[]>(
    CATEGORIES.map(c => ({ name: c.name, label: c.label, count: 0, status: "pending" }))
  );

  // Track elapsed time
  useEffect(() => {
    if (isActive && !startTimeRef.current) {
      startTimeRef.current = Date.now();
    }
    if (!isActive) {
      startTimeRef.current = null;
      setElapsedTime(0);
      return;
    }

    const interval = setInterval(() => {
      if (startTimeRef.current) {
        setElapsedTime(Math.floor((Date.now() - startTimeRef.current) / 1000));
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [isActive]);

  // Process ALL events from scratch each time to avoid stale closure issues
  useEffect(() => {
    console.log("[AgenticProgress] Events updated, count:", events.length);
    
    if (events.length === 0) {
      setAgentStatuses({});
      setCurrentStage("");
      setStageMessage("");
      setAnalysisData(null);
      setPlanData(null);
      setRefinementMessages([]);
      setRefinedData(null);
      setBddAssets(null);
      setCategoryProgress(CATEGORIES.map(c => ({ name: c.name, label: c.label, count: 0, status: "pending" })));
      return;
    }

    // Process ALL events from the beginning to build current state
    const newAgentStatuses: Record<string, AgentStatus> = {};
    let newCurrentStage = "";
    let newStageMessage = "";
    let newAnalysisData: any = null;
    let newPlanData: any = null;
    let newRefinementMessages: string[] = [];
    let newRefinedData: { totalTests: number; qualityScore: number } | null = null;
    let newBddAssets: BDDAssetsData | null = null;
    const newCategoryProgress: CategoryProgress[] = CATEGORIES.map(c => ({ name: c.name, label: c.label, count: 0, status: "pending" }));

    for (const event of events) {
      if (event.type === "agent_status" && event.status) {
        newAgentStatuses[event.status.agent] = event.status;
      } else if (event.type === "pipeline_stage") {
        newCurrentStage = event.stage || "";
        newStageMessage = event.message || "";
      } else if (event.type === "analysis_result" && event.data) {
        newAnalysisData = event.data;
      } else if (event.type === "plan_result" && event.data) {
        newPlanData = event.data;
      } else if (event.type === "refinement") {
        if (event.message) {
          newRefinementMessages = [...newRefinementMessages, event.message];
        }
        if (event.data) {
          newRefinedData = {
            totalTests: event.data.totalTests || 0,
            qualityScore: event.data.qualityScore || 0
          };
        }
      } else if (event.type === "category_complete") {
        const catIndex = newCategoryProgress.findIndex(c => c.name === event.category);
        if (catIndex >= 0) {
          newCategoryProgress[catIndex].count = event.count || 0;
          newCategoryProgress[catIndex].status = "completed";
        }
      } else if (event.type === "bdd_assets" && event.data) {
        newBddAssets = event.data;
      }
    }

    // Mark generating categories based on current stage
    if (newCurrentStage === "generation") {
      const generatingCat = newCategoryProgress.find(c => c.status === "pending");
      if (generatingCat) {
        generatingCat.status = "generating";
      }
    }

    setAgentStatuses(newAgentStatuses);
    setCurrentStage(newCurrentStage);
    setStageMessage(newStageMessage);
    setAnalysisData(newAnalysisData);
    setPlanData(newPlanData);
    setRefinementMessages(newRefinementMessages);
    setRefinedData(newRefinedData);
    setBddAssets(newBddAssets);
    setCategoryProgress(newCategoryProgress);

  }, [events]);

  useEffect(() => {
    setCategoryProgress(prev => prev.map(c => ({
      ...c,
      count: categoryCounts[c.name] || c.count
    })));
  }, [categoryCounts]);

  const getAgentIcon = (agentId: string) => {
    const agent = AGENTS.find(a => a.id === agentId);
    return agent?.icon || Brain;
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "thinking": return "text-amber-400";
      case "working": return "text-blue-400";
      case "completed": return "text-emerald-400";
      case "error": return "text-destructive";
      default: return "text-muted-foreground/40";
    }
  };

  const getStatusBgColor = (status: string) => {
    switch (status) {
      case "thinking": return "bg-amber-500/20 border-amber-500/40";
      case "working": return "bg-blue-500/20 border-blue-500/40";
      case "completed": return "bg-emerald-500/20 border-emerald-500/40";
      case "error": return "bg-red-500/20 border-red-500/40";
      default: return "bg-muted/20 border-border/30";
    }
  };

  const handleDownloadBddAssets = async () => {
    if (!bddAssets) return;
    
    setIsDownloading(true);
    try {
      const response = await fetch("/api/export/bdd-assets/zip", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bddAssets: {
            featureFiles: bddAssets.featureFiles?.map(f => ({
              name: f.name,
              content: f.content
            })) || [],
            stepDefinitions: bddAssets.stepDefinitions?.map(s => ({
              name: s.name,
              content: s.content
            })) || [],
            pageObjects: bddAssets.pageObjects?.map(p => ({
              name: p.name,
              content: p.content
            })) || [],
            utilities: [
              { name: "generic-actions", content: bddAssets.utilities?.genericActions || "" },
              { name: "wait-helpers", content: bddAssets.utilities?.waitHelpers || "" },
              { name: "assertion-helpers", content: bddAssets.utilities?.assertionHelpers || "" }
            ]
          },
          projectName: analysisData?.storyTitle || "BDD-Test-Suite",
          domain: analysisData?.domainContext || "General"
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
    } catch (error) {
      console.error("Failed to download BDD assets:", error);
    } finally {
      setIsDownloading(false);
    }
  };

  // Calculate progress and ETA
  const completedAgents = AGENTS.filter(a => agentStatuses[a.id]?.status === "completed").length;
  const activeAgentIndex = AGENTS.findIndex(a => 
    agentStatuses[a.id]?.status === "thinking" || agentStatuses[a.id]?.status === "working"
  );
  
  // Calculate remaining time based on agents not yet started
  const remainingAgentsTime = AGENTS.slice(activeAgentIndex >= 0 ? activeAgentIndex + 1 : completedAgents)
    .reduce((sum, a) => sum + a.duration, 0);
  // Add time for current agent based on its estimated duration
  const currentAgentRemainingTime = activeAgentIndex >= 0 
    ? Math.max(0, AGENTS[activeAgentIndex].duration - 5) // Assume 5s into current agent
    : 0;
  const estimatedRemainingTime = Math.max(0, remainingAgentsTime + currentAgentRemainingTime);
  
  const completedCount = categoryProgress.filter(c => c.status === "completed").length;
  const totalTests = Object.values(categoryCounts).reduce((a, b) => a + b, 0);
  const overallProgress = isActive 
    ? Math.min(95, (completedAgents / AGENTS.length) * 100 + (activeAgentIndex >= 0 ? 8 : 0))
    : completedAgents === AGENTS.length ? 100 : 0;

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
  };

  if (!isActive && events.length === 0) {
    return null;
  }

  return (
    <div className="space-y-4 w-full" data-testid="agentic-progress">
      {/* Main Pipeline Card */}
      <Card className="overflow-hidden border-primary/20 bg-gradient-to-br from-background via-background to-primary/5">
        {/* Header with gradient accent */}
        <div className="h-1 bg-gradient-to-r from-blue-500 via-purple-500 to-emerald-500" />
        
        <div className="p-6">
          {/* Title Row */}
          <div className="flex items-center justify-between gap-4 mb-6">
            <div className="flex items-center gap-4">
              <div className="relative">
                <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center border border-primary/20">
                  <Sparkles className="h-7 w-7 text-primary" />
                </div>
                {isActive && (
                  <motion.div 
                    className="absolute -top-1 -right-1 w-4 h-4 bg-emerald-500 rounded-full border-2 border-background"
                    animate={{ scale: [1, 1.2, 1] }}
                    transition={{ repeat: Infinity, duration: 1.5 }}
                  />
                )}
              </div>
              <div>
                <h2 className="text-lg font-semibold">Agentic AI Pipeline</h2>
                <p className="text-sm text-muted-foreground">
                  {isActive ? stageMessage || "Multi-agent test generation in progress..." : "Pipeline execution complete"}
                </p>
              </div>
            </div>
            
            <div className="flex items-center gap-3">
              {isActive && (
                <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-muted/30 border border-border/50">
                  <Timer className="h-4 w-4 text-muted-foreground" />
                  <div className="text-sm">
                    <span className="text-muted-foreground">Elapsed: </span>
                    <span className="font-medium">{formatTime(elapsedTime)}</span>
                  </div>
                  <div className="w-px h-4 bg-border mx-1" />
                  <div className="text-sm">
                    <span className="text-muted-foreground">ETA: </span>
                    <span className="font-medium text-primary">~{formatTime(estimatedRemainingTime)}</span>
                  </div>
                </div>
              )}
              
              <Badge 
                variant="outline" 
                className={`text-sm px-3 py-1.5 ${
                  isActive 
                    ? "bg-emerald-500/10 border-emerald-500/40 text-emerald-400" 
                    : "bg-muted/30 border-border text-muted-foreground"
                }`}
              >
                <Zap className="h-3.5 w-3.5 mr-1.5" />
                {isActive ? "Active" : "Complete"}
              </Badge>
            </div>
          </div>

          {/* Progress Bar */}
          <div className="mb-6">
            <div className="flex justify-between gap-4 text-sm text-muted-foreground mb-2">
              <span>Pipeline Progress</span>
              <span className="font-medium">{Math.round(overallProgress)}%</span>
            </div>
            <div className="relative h-3 bg-muted/30 rounded-full overflow-hidden">
              <motion.div 
                className="absolute inset-y-0 left-0 bg-gradient-to-r from-blue-500 via-purple-500 to-emerald-500 rounded-full"
                initial={{ width: 0 }}
                animate={{ width: `${overallProgress}%` }}
                transition={{ duration: 0.5, ease: "easeOut" }}
              />
              {isActive && (
                <motion.div 
                  className="absolute inset-y-0 right-0 w-full bg-gradient-to-r from-transparent via-white/20 to-transparent"
                  animate={{ x: ["-100%", "100%"] }}
                  transition={{ repeat: Infinity, duration: 1.5, ease: "linear" }}
                />
              )}
            </div>
          </div>

          {/* Agent Pipeline - Wide responsive grid */}
          <div className="grid grid-cols-3 md:grid-cols-6 gap-3 md:gap-6 lg:gap-8">
            {AGENTS.map((agent, index) => {
              const status = agentStatuses[agent.id];
              const AgentIcon = agent.icon;
              const isActiveAgent = status?.status === "thinking" || status?.status === "working";
              const isCompleted = status?.status === "completed";
              
              return (
                <motion.div
                  key={agent.id}
                  className={`relative p-3 md:p-4 rounded-lg border transition-all ${getStatusBgColor(status?.status || "idle")}`}
                  animate={isActiveAgent ? { 
                    boxShadow: ["0 0 0 0 rgba(59, 130, 246, 0)", "0 0 15px 3px rgba(59, 130, 246, 0.3)", "0 0 0 0 rgba(59, 130, 246, 0)"]
                  } : {}}
                  transition={{ repeat: Infinity, duration: 2 }}
                >
                  {/* Connection Arrow */}
                  {/* Connection Arrow - hidden on small screens, visible between columns on md+ */}
                  {index < AGENTS.length - 1 && (
                    <div className="hidden md:flex absolute top-1/2 -right-4 lg:-right-5 -translate-y-1/2 z-10 items-center">
                      <div className={`w-2 lg:w-3 h-0.5 ${isCompleted ? "bg-emerald-400/60" : "bg-border"}`} />
                      <ArrowRight className={`h-4 w-4 ${
                        isCompleted ? "text-emerald-400" : "text-muted-foreground/40"
                      }`} />
                    </div>
                  )}
                  
                  {/* Agent Icon */}
                  <div className={`mx-auto w-11 h-11 md:w-12 md:h-12 rounded-xl flex items-center justify-center mb-2 transition-all ${
                    isActiveAgent 
                      ? "bg-gradient-to-br from-blue-500/30 to-purple-500/30 border border-blue-400/50" 
                      : isCompleted 
                      ? "bg-gradient-to-br from-emerald-500/30 to-teal-500/30 border border-emerald-400/50"
                      : "bg-muted/40 border border-border/30"
                  }`}>
                    {isActiveAgent ? (
                      <motion.div
                        animate={{ rotate: 360 }}
                        transition={{ repeat: Infinity, duration: 3, ease: "linear" }}
                      >
                        <AgentIcon className={`h-5 w-5 md:h-6 md:w-6 ${getStatusColor(status?.status || "idle")}`} />
                      </motion.div>
                    ) : (
                      <AgentIcon className={`h-5 w-5 md:h-6 md:w-6 ${getStatusColor(status?.status || "idle")}`} />
                    )}
                  </div>
                  
                  {/* Agent Name */}
                  <h4 className="text-[11px] md:text-xs font-medium text-center leading-tight">
                    {agent.name}
                  </h4>
                  
                  {/* Status Indicator */}
                  <div className="flex justify-center mt-2">
                    {status?.status === "thinking" && (
                      <Badge className="text-[9px] md:text-[10px] px-2 py-0.5 bg-amber-500/20 text-amber-400 border-amber-500/40">
                        <Brain className="h-2.5 w-2.5 mr-1 animate-pulse" />
                        Analyzing
                      </Badge>
                    )}
                    {status?.status === "working" && (
                      <Badge className="text-[9px] md:text-[10px] px-2 py-0.5 bg-blue-500/20 text-blue-400 border-blue-500/40">
                        <Loader2 className="h-2.5 w-2.5 mr-1 animate-spin" />
                        Processing
                      </Badge>
                    )}
                    {status?.status === "completed" && (
                      <Badge className="text-[9px] md:text-[10px] px-2 py-0.5 bg-emerald-500/20 text-emerald-400 border-emerald-500/40">
                        <CheckCircle2 className="h-2.5 w-2.5 mr-1" />
                        Done
                      </Badge>
                    )}
                    {!status?.status && (
                      <Badge variant="outline" className="text-[9px] md:text-[10px] px-2 py-0.5 text-muted-foreground/50">
                        Pending
                      </Badge>
                    )}
                  </div>
                  
                  {/* Estimated Time */}
                  <p className="text-[9px] md:text-[10px] text-muted-foreground/50 text-center mt-1.5">
                    ~{agent.duration}s
                  </p>
                </motion.div>
              );
            })}
          </div>
        </div>
      </Card>

      {/* ── Agent Workflow Panel ── */}
      <Card className="border border-gray-200 bg-white overflow-hidden">
        <button
          className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-gray-50 transition-colors"
          onClick={() => setShowWorkflow(v => !v)}
        >
          <div className="flex items-center gap-2.5">
            <ListChecks className="w-4 h-4 text-indigo-500" />
            <span className="text-sm font-semibold text-gray-900">Agent Workflow — Skills, Tasks & Acceptance Criteria</span>
            <Badge variant="outline" className="text-[10px] px-2 py-0 border-indigo-200 text-indigo-600 bg-indigo-50">
              {AGENT_PROFILES.length} agents
            </Badge>
          </div>
          {showWorkflow
            ? <ChevronUp className="w-4 h-4 text-gray-400" />
            : <ChevronDown className="w-4 h-4 text-gray-400" />}
        </button>

        <AnimatePresence initial={false}>
          {showWorkflow && (
            <motion.div
              key="workflow-panel"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.25, ease: "easeInOut" }}
              className="overflow-hidden"
            >
              <div className="border-t border-gray-100 p-4">
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  {AGENT_PROFILES.map((profile) => {
                    const status = agentStatuses[profile.id];
                    const agentStatus = status?.status;
                    const isActive = agentStatus === "thinking" || agentStatus === "working";
                    const isDone = agentStatus === "completed";
                    const isPending = !agentStatus;

                    const agentDef = AGENTS.find(a => a.id === profile.id);
                    const AgentIcon = agentDef?.icon;

                    return (
                      <motion.div
                        key={profile.id}
                        className={`rounded-xl border-2 p-4 transition-all ${
                          isActive
                            ? "border-indigo-400 shadow-md shadow-indigo-100 bg-indigo-50/40"
                            : isDone
                            ? `border-emerald-200 bg-emerald-50/30`
                            : `${profile.borderColor} ${profile.bgColor} opacity-70`
                        }`}
                        animate={isActive ? { scale: [1, 1.01, 1] } : {}}
                        transition={{ repeat: Infinity, duration: 2 }}
                      >
                        {/* Agent header */}
                        <div className="flex items-center justify-between mb-3">
                          <div className="flex items-center gap-2">
                            {AgentIcon && (
                              <div className={`w-7 h-7 rounded-lg flex items-center justify-center ${
                                isActive ? "bg-indigo-100" : isDone ? "bg-emerald-100" : profile.bgColor
                              }`}>
                                <AgentIcon className={`w-3.5 h-3.5 ${
                                  isActive ? "text-indigo-600" : isDone ? "text-emerald-600" : profile.color
                                }`} />
                              </div>
                            )}
                            <span className={`text-xs font-bold ${
                              isActive ? "text-indigo-700" : isDone ? "text-emerald-700" : "text-gray-700"
                            }`}>{profile.id}</span>
                          </div>
                          {isActive && (
                            <Badge className="text-[9px] px-1.5 py-0 bg-indigo-500 text-white border-0">
                              <Loader2 className="w-2.5 h-2.5 mr-1 animate-spin" />Active
                            </Badge>
                          )}
                          {isDone && (
                            <Badge className="text-[9px] px-1.5 py-0 bg-emerald-500 text-white border-0">
                              <CheckCircle2 className="w-2.5 h-2.5 mr-1" />Done
                            </Badge>
                          )}
                          {isPending && (
                            <Badge variant="outline" className="text-[9px] px-1.5 py-0 text-gray-400 border-gray-200">
                              Pending
                            </Badge>
                          )}
                        </div>

                        {/* Skills */}
                        <div className="mb-2.5">
                          <div className="flex items-center gap-1 mb-1.5">
                            <Wrench className="w-3 h-3 text-gray-400" />
                            <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">Skills</span>
                          </div>
                          <div className="flex flex-wrap gap-1">
                            {profile.skills.map((skill, i) => (
                              <span
                                key={i}
                                className={`text-[9px] px-2 py-0.5 rounded-full border font-medium ${
                                  isActive
                                    ? "bg-indigo-100 border-indigo-200 text-indigo-700"
                                    : isDone
                                    ? "bg-emerald-100 border-emerald-200 text-emerald-700"
                                    : `${profile.bgColor} ${profile.borderColor} ${profile.color}`
                                }`}
                              >
                                {skill}
                              </span>
                            ))}
                          </div>
                        </div>

                        {/* Tasks */}
                        <div className="mb-2.5">
                          <div className="flex items-center gap-1 mb-1.5">
                            <ListChecks className="w-3 h-3 text-gray-400" />
                            <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">Tasks</span>
                          </div>
                          <ul className="space-y-1">
                            {profile.tasks.map((task, i) => (
                              <li key={i} className="flex items-start gap-1.5">
                                {isDone ? (
                                  <CheckCircle2 className="w-3 h-3 text-emerald-500 flex-shrink-0 mt-0.5" />
                                ) : isActive ? (
                                  <motion.div
                                    animate={{ opacity: [0.4, 1, 0.4] }}
                                    transition={{ repeat: Infinity, duration: 1.5, delay: i * 0.2 }}
                                  >
                                    <Circle className="w-3 h-3 text-indigo-400 flex-shrink-0 mt-0.5" />
                                  </motion.div>
                                ) : (
                                  <Circle className="w-3 h-3 text-gray-300 flex-shrink-0 mt-0.5" />
                                )}
                                <span className={`text-[10px] leading-relaxed ${
                                  isDone ? "text-emerald-700" : isActive ? "text-indigo-800" : "text-gray-500"
                                }`}>{task}</span>
                              </li>
                            ))}
                          </ul>
                        </div>

                        {/* Acceptance Criteria */}
                        <div>
                          <div className="flex items-center gap-1 mb-1.5">
                            <ClipboardCheck className="w-3 h-3 text-gray-400" />
                            <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">Acceptance Criteria</span>
                          </div>
                          <ul className="space-y-1">
                            {profile.acceptanceCriteria.map((ac, i) => (
                              <li key={i} className="flex items-start gap-1.5">
                                {isDone ? (
                                  <CheckCircle2 className="w-3 h-3 text-emerald-500 flex-shrink-0 mt-0.5" />
                                ) : (
                                  <div className={`w-3 h-3 rounded-sm border-2 flex-shrink-0 mt-0.5 ${
                                    isActive ? "border-indigo-400 bg-indigo-50" : "border-gray-300"
                                  }`} />
                                )}
                                <span className={`text-[10px] leading-relaxed ${
                                  isDone ? "text-emerald-700 line-through decoration-emerald-300" : isActive ? "text-gray-700" : "text-gray-400"
                                }`}>{ac}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      </motion.div>
                    );
                  })}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </Card>

      {/* Active Agent Details */}
      <AnimatePresence>
        {Object.entries(agentStatuses).map(([agentName, status]) => {
          if (status.status !== "thinking" && status.status !== "working") return null;
          const agent = AGENTS.find(a => a.id === agentName);
          
          return (
            <motion.div
              key={agentName}
              initial={{ opacity: 0, y: -10, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -10, scale: 0.98 }}
              transition={{ duration: 0.2 }}
            >
              <Card className="p-4 border-2 border-primary/30 bg-gradient-to-r from-primary/5 to-transparent">
                <div className="flex items-start gap-4">
                  <div className={`w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 ${
                    status.status === "thinking" 
                      ? "bg-gradient-to-br from-amber-500/20 to-orange-500/20 border border-amber-400/50" 
                      : "bg-gradient-to-br from-blue-500/20 to-purple-500/20 border border-blue-400/50"
                  }`}>
                    {status.status === "thinking" ? (
                      <Brain className="h-6 w-6 text-amber-400 animate-pulse" />
                    ) : (
                      <Loader2 className="h-6 w-6 text-blue-400 animate-spin" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3 mb-1">
                      <span className="text-base font-semibold">{agentName}</span>
                      <Badge className={`text-xs ${
                        status.status === "thinking" 
                          ? "bg-amber-500/20 text-amber-400 border-amber-500/40" 
                          : "bg-blue-500/20 text-blue-400 border-blue-500/40"
                      }`}>
                        {status.status === "thinking" ? "Analyzing" : "Processing"}
                      </Badge>
                    </div>
                    <p className="text-sm text-foreground/80">{status.message}</p>
                    {status.details && (
                      <p className="text-xs text-muted-foreground mt-1">{status.details}</p>
                    )}
                    {agent && (
                      <p className="text-xs text-muted-foreground/60 mt-2">{agent.description}</p>
                    )}
                  </div>
                </div>
              </Card>
            </motion.div>
          );
        })}
      </AnimatePresence>

      {/* Two Column Layout for Analysis & Categories */}
      <div className="grid grid-cols-2 gap-4">
        {/* Story Analysis Card */}
        {analysisData && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
          >
            <Card className="p-4 h-full bg-gradient-to-br from-muted/30 to-transparent">
              <div className="flex items-center gap-2 mb-4">
                <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
                  <Eye className="h-4 w-4 text-primary" />
                </div>
                <div>
                  <span className="text-sm font-semibold">Story Analysis</span>
                  <Badge variant="outline" className="text-[10px] ml-2 uppercase">
                    {analysisData.complexity || "Medium"} complexity
                  </Badge>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div className="bg-background/50 rounded-lg p-3 text-center border border-border/30">
                  <p className="text-2xl font-bold text-primary">{analysisData.testableRequirements?.length || 0}</p>
                  <span className="text-[10px] text-muted-foreground">Requirements</span>
                </div>
                <div className="bg-background/50 rounded-lg p-3 text-center border border-border/30">
                  <p className="text-2xl font-bold text-orange-400">{analysisData.riskAreas?.length || 0}</p>
                  <span className="text-[10px] text-muted-foreground">Risk Areas</span>
                </div>
                <div className="bg-background/50 rounded-lg p-3 text-center border border-border/30">
                  <p className="text-2xl font-bold text-purple-400">{analysisData.edgeCases?.length || 0}</p>
                  <span className="text-[10px] text-muted-foreground">Edge Cases</span>
                </div>
              </div>
            </Card>
          </motion.div>
        )}

        {/* Test Generation Progress */}
        <Card className={`p-4 bg-gradient-to-br from-muted/30 to-transparent ${!analysisData ? 'col-span-2' : ''}`}>
          <div className="flex items-center justify-between gap-4 mb-4">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-blue-500/10 flex items-center justify-center">
                <FileText className="h-4 w-4 text-blue-400" />
              </div>
              <span className="text-sm font-semibold">Test Generation Progress</span>
            </div>
            <Badge variant="outline" className="text-sm font-semibold">
              {totalTests} tests
            </Badge>
          </div>
          
          <div className="space-y-2">
            {categoryProgress.map((cat) => {
              const catConfig = CATEGORIES.find(c => c.name === cat.name);
              const isGenerating = cat.status === "generating";
              const isCompleted = cat.status === "completed";
              
              return (
                <div key={cat.name} className="flex items-center gap-3 p-2 rounded-lg bg-background/30">
                  <div className={`w-2.5 h-2.5 rounded-full ${catConfig?.color || "bg-muted"} ${
                    isGenerating ? "animate-pulse" : ""
                  }`} />
                  <span className={`text-sm flex-1 ${isCompleted ? catConfig?.textColor : "text-muted-foreground"}`}>
                    {cat.label}
                  </span>
                  <div className="flex items-center gap-2">
                    {isGenerating && <Loader2 className="h-3 w-3 animate-spin text-blue-400" />}
                    {isCompleted && <CheckCircle2 className="h-3 w-3 text-emerald-400" />}
                    <Badge variant="outline" className={`text-xs min-w-[2.5rem] justify-center ${
                      isCompleted ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30" : ""
                    }`}>
                      {cat.count}
                    </Badge>
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      </div>

      {/* QA Refinement Card */}
      {refinedData && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <Card className="p-4 bg-gradient-to-r from-emerald-500/5 to-teal-500/5">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500/20 to-teal-500/20 flex items-center justify-center border border-emerald-400/30">
                  <Shield className="h-5 w-5 text-emerald-400" />
                </div>
                <div>
                  <span className="text-sm font-semibold">QA Validation Complete</span>
                  <p className="text-xs text-muted-foreground">{refinedData.totalTests} test cases validated and refined</p>
                </div>
              </div>
              <div className="flex items-center gap-4">
                <div className="text-center">
                  <p className="text-2xl font-bold text-emerald-400">{refinedData.qualityScore}%</p>
                  <span className="text-[10px] text-muted-foreground">Quality Score</span>
                </div>
              </div>
            </div>
          </Card>
        </motion.div>
      )}

      {/* BDD Assets Card */}
      {bddAssets && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <Card className="p-4 bg-gradient-to-r from-violet-500/5 to-purple-500/5">
            <div className="flex items-center justify-between gap-4 mb-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500/20 to-purple-500/20 flex items-center justify-center border border-violet-400/30">
                  <Code2 className="h-5 w-5 text-violet-400" />
                </div>
                <div>
                  <span className="text-sm font-semibold">BDD Test Assets Generated</span>
                  <p className="text-xs text-muted-foreground">Complete Playwright + Cucumber.js test suite ready</p>
                </div>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={handleDownloadBddAssets}
                disabled={isDownloading}
                data-testid="button-download-bdd-assets"
              >
                {isDownloading ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Download className="h-4 w-4 mr-2" />
                )}
                Download ZIP
              </Button>
            </div>
            
            <div className="grid grid-cols-4 gap-3">
              <div className="bg-background/50 rounded-lg p-3 text-center border border-violet-500/20">
                <p className="text-xl font-bold text-violet-400">{bddAssets.featureFiles?.length || 0}</p>
                <span className="text-[10px] text-muted-foreground">Feature Files</span>
              </div>
              <div className="bg-background/50 rounded-lg p-3 text-center border border-violet-500/20">
                <p className="text-xl font-bold text-violet-400">{bddAssets.stepDefinitions?.length || 0}</p>
                <span className="text-[10px] text-muted-foreground">Step Definitions</span>
              </div>
              <div className="bg-background/50 rounded-lg p-3 text-center border border-violet-500/20">
                <p className="text-xl font-bold text-violet-400">{bddAssets.pageObjects?.length || 0}</p>
                <span className="text-[10px] text-muted-foreground">Page Objects</span>
              </div>
              <div className="bg-background/50 rounded-lg p-3 text-center border border-violet-500/20">
                <p className="text-xl font-bold text-violet-400">3</p>
                <span className="text-[10px] text-muted-foreground">Utility Classes</span>
              </div>
            </div>
            
            <div className="mt-3 pt-3 border-t border-violet-500/20">
              <div className="flex flex-wrap gap-1.5">
                {bddAssets.featureFiles?.map((f, i) => (
                  <Badge key={i} variant="outline" className="text-[10px] bg-violet-500/10 border-violet-500/20 text-violet-400">
                    {f.name}.feature
                  </Badge>
                ))}
              </div>
            </div>
          </Card>
        </motion.div>
      )}
    </div>
  );
}
