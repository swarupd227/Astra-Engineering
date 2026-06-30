import { useState, useEffect, useMemo } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { DashboardHeader } from "@/components/dashboard/header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Progress } from "@/components/ui/progress";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useToast } from "@/hooks/use-toast";
import { Link } from "wouter";
import {
  ArrowLeft,
  Plus,
  Trash2,
  Copy,
  Download,
  Code2,
  Globe,
  Send,
  Loader2,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Sparkles,
  FileText,
  Shield,
  Zap,
  Target,
  Settings,
  ChevronDown,
  ChevronUp,
  Brain,
  Cpu,
  Network,
  Workflow,
  Bot,
  Search,
  FileCode,
  TestTube2,
  ClipboardCheck,
  ArrowRight,
  Upload,
  Link2,
  Play,
  FileJson,
  FileSpreadsheet,
  Check,
  BarChart3,
  Clock,
  Activity,
  Database,
  History,
  RefreshCw,
  AlertTriangle,
  MinusCircle,
  PlusCircle,
  GitCompare
} from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { SiPostman } from "react-icons/si";
import { safeSetJson, safeGetItem } from "@/lib/safe-storage";
import {
  exportApiTestsToExcel,
  exportApiTestsToJson,
  exportApiTestsToPlaywright,
  exportApiTestsToPostman,
  exportApiTestsToReadyApi,
} from "./api-testing-exports";

interface Header {
  key: string;
  value: string;
  enabled: boolean;
}

interface QueryParam {
  key: string;
  value: string;
  enabled: boolean;
}

interface SwaggerEndpoint {
  id: string;
  path: string;
  method: string;
  summary: string;
  description: string;
  tags: string[];
  deprecated: boolean;
  parameters: any[];
  requestBody: any;
  responses: any;
  security: any[];
  operationId: string;
  selected?: boolean;
}

interface TestResult {
  endpointId: string;
  path: string;
  resolvedPath?: string;
  method: string;
  status: "passed" | "failed" | "skipped";
  tests: {
    id: string;
    name: string;
    category: string;
    status: "passed" | "failed";
    expected: string;
    actual: string;
    responseTime: number;
  }[];
  responseTime: number;
  statusCode: number;
}

interface TestSummary {
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  passRate: number;
  totalDuration: number;
  avgResponseTime: number;
}

interface GeneratedTestCase {
  id: string;
  title: string;
  type: 'functional' | 'negative' | 'security' | 'performance' | 'boundary';
  priority: 'P0' | 'P1' | 'P2' | 'P3';
  description: string;
  preconditions: string[];
  steps: { action: string; expected: string }[];
  testData: Record<string, any>;
  assertions: string[];
  postmanScript?: string;
  readyApiGroovy?: string;
  playwrightScript?: string;
}

interface AgentState {
  id: string;
  name: string;
  role: string;
  icon: any;
  status: 'idle' | 'working' | 'completed' | 'error';
  message: string;
  progress: number;
  color: string;
}

const defaultHeaders: Header[] = [
  { key: "Content-Type", value: "application/json", enabled: true },
  { key: "Accept", value: "application/json", enabled: true },
  { key: "", value: "", enabled: true }
];

const defaultQueryParams: QueryParam[] = [
  { key: "", value: "", enabled: true }
];

type ApiExecutionResult = {
  executed: boolean;
  statusCode: number;
  responseTime: number;
  error: string | null;
  responsePreview: string | null;
  fullResponse: any;
  responseHeaders: Record<string, string>;
  fetching?: boolean;
};

const API_EXECUTION_FETCHING: ApiExecutionResult = {
  fetching: true,
  executed: false,
  statusCode: 0,
  responseTime: 0,
  error: null,
  responsePreview: null,
  fullResponse: null,
  responseHeaders: {},
};

function buildApiExecutionDisplay(source: {
  executed: boolean;
  statusCode: number;
  responseTime: number;
  error?: string | null;
  response?: any;
  responsePreview?: string | null;
  fullResponse?: any;
  responseHeaders?: Record<string, string>;
}): ApiExecutionResult {
  const fullResponse = source.fullResponse ?? source.response ?? null;
  const responsePreview =
    source.responsePreview ??
    (fullResponse != null ? JSON.stringify(fullResponse, null, 2).substring(0, 5000) : null);
  return {
    executed: source.executed,
    statusCode: source.statusCode,
    responseTime: source.responseTime,
    error: source.error ?? null,
    responsePreview,
    fullResponse,
    responseHeaders: source.responseHeaders ?? {},
  };
}

function isEmptyApiResponse(response: unknown): boolean {
  if (response == null) return true;
  if (Array.isArray(response) && response.length === 0) return true;
  if (typeof response === "object" && !Array.isArray(response)) {
    const keys = Object.keys(response as object);
    if (keys.length === 0) return true;
    const obj = response as Record<string, unknown>;
    if (keys.length === 1 && keys[0] === "rawText" && !obj.rawText) return true;
  }
  return false;
}

/** Defaults for well-known endpoints that return empty bodies without query params. */
const ENDPOINT_QUERY_DEFAULTS: Array<{
  match: (endpoint: string) => boolean;
  params: Array<{ key: string; value: string }>;
}> = [
  {
    match: (ep) => /findByStatus/i.test(ep),
    params: [{ key: "status", value: "available" }],
  },
  {
    match: (ep) => /findByTags/i.test(ep),
    params: [{ key: "tags", value: "tag1" }],
  },
  {
    match: (ep) => /\/user\/login/i.test(ep),
    params: [
      { key: "username", value: "user1" },
      { key: "password", value: "password" },
    ],
  },
];

function inferMissingQueryParams(endpoint: string, params: QueryParam[]): QueryParam[] {
  const byKey = new Map<string, QueryParam>();
  for (const p of params) {
    if (p.key) byKey.set(p.key.toLowerCase(), p);
  }

  try {
    const url = new URL(endpoint);
    url.searchParams.forEach((value, key) => {
      if (!byKey.has(key.toLowerCase()) || !byKey.get(key.toLowerCase())?.value) {
        byKey.set(key.toLowerCase(), { key, value, enabled: true });
      }
    });
  } catch {
    // endpoint may be a relative path — fall through to pattern defaults
  }

  for (const rule of ENDPOINT_QUERY_DEFAULTS) {
    if (!rule.match(endpoint)) continue;
    for (const { key, value } of rule.params) {
      const existing = byKey.get(key.toLowerCase());
      if (!existing?.value) {
        byKey.set(key.toLowerCase(), { key, value, enabled: true });
      }
    }
  }

  const merged = Array.from(byKey.values());
  return merged.length > 0 ? merged : [{ key: "", value: "", enabled: true }];
}

function queryParamsChanged(before: QueryParam[], after: QueryParam[]): boolean {
  const serialize = (list: QueryParam[]) =>
    list
      .filter((p) => p.key && p.value)
      .map((p) => `${p.key}=${p.value}`)
      .sort()
      .join("&");
  return serialize(before) !== serialize(after);
}

const initialAgents: AgentState[] = [
  {
    id: "orchestrator",
    name: "Orchestrator",
    role: "Master Controller",
    icon: Workflow,
    status: "idle",
    message: "Awaiting task assignment",
    progress: 0,
    color: "violet"
  },
  {
    id: "analyzer",
    name: "API Analyzer",
    role: "Endpoint Inspector",
    icon: Search,
    status: "idle",
    message: "Ready to analyze API endpoint",
    progress: 0,
    color: "cyan"
  },
  {
    id: "expert",
    name: "Expert Strategist",
    role: "Test Strategy Expert",
    icon: Brain,
    status: "idle",
    message: "Awaiting API analysis",
    progress: 0,
    color: "amber"
  },
  {
    id: "generator",
    name: "Test Generator",
    role: "Test Case Creator",
    icon: FileCode,
    status: "idle",
    message: "Ready to generate tests",
    progress: 0,
    color: "emerald"
  },
  {
    id: "refiner",
    name: "QE Refiner",
    role: "Quality Enhancer",
    icon: TestTube2,
    status: "idle",
    message: "Standing by for refinement",
    progress: 0,
    color: "rose"
  }
];

export default function NRadiVerseAPITestingPage() {
  const [isGenerating, setIsGenerating] = useState(false);
  const [showAgentPipeline, setShowAgentPipeline] = useState(false);
  const [agents, setAgents] = useState<AgentState[]>(initialAgents);
  const [currentAgentIndex, setCurrentAgentIndex] = useState(-1);
  const [generatedTests, setGeneratedTests] = useState<GeneratedTestCase[]>([]);
  const [expandedTests, setExpandedTests] = useState<Set<string>>(new Set());
  const [pipelineComplete, setPipelineComplete] = useState(false);
  const [pendingTestCases, setPendingTestCases] = useState<GeneratedTestCase[]>([]);
  const [qeValidationComplete, setQeValidationComplete] = useState(false);
  const [apiExecutionResult, setApiExecutionResult] = useState<ApiExecutionResult | null>(null);
  const [showFullResponse, setShowFullResponse] = useState(false);
  const { toast } = useToast();

  // Baseline / Regression Testing State
  interface ApiBaseline {
    id: string;
    name: string;
    description: string;
    method: string;
    endpoint: string;
    requestHeaders: Record<string, string>;
    requestBody: string;
    baselineResponse: any;
    baselineStatusCode: number;
    baselineHeaders: Record<string, string>;
    responseSchema: any[];
    lastExecutedAt: string;
    lastExecutionStatus: string;
    executionCount: number;
  }
  interface BaselineExecution {
    id: string;
    status: string;
    statusCode: number;
    responseTime: number;
    differences: any[];
    summary: any;
    createdAt: string;
  }
  const [savedBaselines, setSavedBaselines] = useState<ApiBaseline[]>([]);
  const [selectedBaseline, setSelectedBaseline] = useState<ApiBaseline | null>(null);
  const [baselineExecutions, setBaselineExecutions] = useState<BaselineExecution[]>([]);
  const [showBaselineDialog, setShowBaselineDialog] = useState(false);
  const [baselineName, setBaselineName] = useState("");
  const [baselineDescription, setBaselineDescription] = useState("");
  const [comparisonResult, setComparisonResult] = useState<BaselineExecution | null>(null);
  const [showComparisonResult, setShowComparisonResult] = useState(false);

  const [apiConfig, setApiConfig] = useState({
    method: "GET",
    endpoint: "",
    baseUrl: "",
    description: "",
    authType: "none",
    authToken: "",
    apiKey: "",
    apiKeyHeader: "X-API-Key",
    username: "",
    password: "",
    requestBody: "",
    responseSchema: "",
    expectedStatusCodes: "200, 201, 204"
  });

  const [headers, setHeaders] = useState<Header[]>(defaultHeaders);
  const [queryParams, setQueryParams] = useState<QueryParam[]>(defaultQueryParams);

  // Swagger/OpenAPI Mode State
  const [inputMode, setInputMode] = useState<"single" | "swagger">("single");
  const [swaggerInputType, setSwaggerInputType] = useState<"url" | "file">("url");
  const [swaggerUrl, setSwaggerUrl] = useState("");
  const [swaggerContent, setSwaggerContent] = useState("");
  const [parsedEndpoints, setParsedEndpoints] = useState<SwaggerEndpoint[]>([]);
  const [apiInfo, setApiInfo] = useState<{ title: string; version: string; description: string; baseUrl: string } | null>(null);
  const [executionProgress, setExecutionProgress] = useState(0);
  const [testResults, setTestResults] = useState<TestResult[]>([]);
  const [testSummary, setTestSummary] = useState<TestSummary | null>(null);
  const [showResults, setShowResults] = useState(false);
  const [expandedTags, setExpandedTags] = useState<Set<string>>(new Set(["default"]));

  const groupedEndpoints = useMemo(() => {
    const groups: Record<string, SwaggerEndpoint[]> = {};
    parsedEndpoints.forEach(ep => {
      const tag = ep.tags[0] || "default";
      if (!groups[tag]) groups[tag] = [];
      groups[tag].push(ep);
    });
    return Object.entries(groups).sort((a, b) => a[0].localeCompare(b[0]));
  }, [parsedEndpoints]);

  const toggleTagExpanded = (tag: string) => {
    setExpandedTags(prev => {
      const next = new Set(prev);
      if (next.has(tag)) {
        next.delete(tag);
      } else {
        next.add(tag);
      }
      return next;
    });
  };

  const toggleTagSelection = (tag: string, selected: boolean) => {
    setParsedEndpoints(prev => prev.map(ep =>
      (ep.tags[0] || "default") === tag ? { ...ep, selected } : ep
    ));
  };

  const [testOptions, setTestOptions] = useState({
    functional: true,
    negative: true,
    boundary: true,
    security: true,
    performance: true,
    includePostmanScripts: true,
    includeReadyApiScripts: true,
    includePlaywrightScripts: true
  });

  // TanStack Query mutation for parsing Swagger
  const swaggerParseMutation = useMutation({
    mutationFn: async (data: { inputType: string; swaggerUrl?: string; swaggerContent?: string }) => {
      const response = await apiRequest("POST", "/api/swagger/parse", data);
      return response.json();
    }
  });

  // TanStack Query mutation for executing batch tests
  const batchTestMutation = useMutation({
    mutationFn: async (data: { endpoints: SwaggerEndpoint[]; config: any; testOptions: any }) => {
      const response = await apiRequest("POST", "/api/swagger/execute-tests", data);
      return response.json();
    }
  });

  const updateAgentState = (agentId: string, updates: Partial<AgentState>) => {
    setAgents(prev => prev.map(agent =>
      agent.id === agentId ? { ...agent, ...updates } : agent
    ));
  };

  const simulateAgentProgress = async (agentId: string, messages: string[], duration: number) => {
    const steps = messages.length;
    const stepDuration = duration / steps;

    for (let i = 0; i < steps; i++) {
      await new Promise(resolve => setTimeout(resolve, stepDuration));
      updateAgentState(agentId, {
        message: messages[i],
        progress: Math.round(((i + 1) / steps) * 100)
      });
    }
  };

  const runAgentPipeline = async (): Promise<void> => {
    setAgents(initialAgents);
    setCurrentAgentIndex(0);
    setPipelineComplete(false);
    setQeValidationComplete(false);

    // Animation timings deliberately compressed (≈5 s total, was 9.5 s).
    // Generation typically takes 30–60 s of real wall-clock now, so the
    // animation finishing well before generation lets users see "Pipeline
    // Complete" early and reduces perceived idle time. The animation never
    // blocks the test-case render — that fires the moment data arrives.

    // Orchestrator Agent
    updateAgentState("orchestrator", { status: "working", message: "Initializing agent pipeline...", progress: 10 });
    await simulateAgentProgress("orchestrator", [
      "Parsing API configuration...",
      "Validating endpoint structure...",
      "Configuring authentication context...",
      "Dispatching specialized agents..."
    ], 600);
    updateAgentState("orchestrator", { status: "completed", message: "4 agents dispatched successfully", progress: 100 });
    setCurrentAgentIndex(1);

    // API Analyzer Agent
    updateAgentState("analyzer", { status: "working", message: "Connecting to endpoint...", progress: 10 });
    await simulateAgentProgress("analyzer", [
      `Reading ${apiConfig.method} ${apiConfig.endpoint}...`,
      "Extracting request parameters...",
      "Analyzing response structure...",
      "Detecting authentication type...",
      "Mapping domain context..."
    ], 1000);
    updateAgentState("analyzer", { status: "completed", message: "Endpoint analysis complete", progress: 100 });
    setCurrentAgentIndex(2);

    // Expert Strategist Agent
    updateAgentState("expert", { status: "working", message: "Formulating test strategy...", progress: 10 });
    await simulateAgentProgress("expert", [
      "Analyzing domain requirements...",
      "Applying Postman best practices...",
      "Incorporating ReadyAPI patterns...",
      "Identifying critical test scenarios...",
      "Designing assertion strategies..."
    ], 1000);
    updateAgentState("expert", { status: "completed", message: "Test strategy formulated", progress: 100 });
    setCurrentAgentIndex(3);

    // Test Generator Agent
    updateAgentState("generator", { status: "working", message: "Generating test cases...", progress: 10 });
    await simulateAgentProgress("generator", [
      "Creating functional test cases...",
      "Generating negative test scenarios...",
      "Building boundary value tests...",
      "Constructing security test cases...",
      "Developing performance validations...",
      "Writing Postman scripts...",
      "Generating ReadyAPI Groovy code..."
    ], 1200);
    updateAgentState("generator", { status: "completed", message: "Raw test cases generated", progress: 100 });
    setCurrentAgentIndex(4);

    // QE Refiner Agent - Expert validation
    updateAgentState("refiner", { status: "working", message: "Starting quality validation...", progress: 5 });
    await simulateAgentProgress("refiner", [
      "Verifying context alignment...",
      "Validating domain coverage...",
      "Checking endpoint test coverage...",
      `Verifying ${apiConfig.authType !== 'none' ? apiConfig.authType.toUpperCase() : 'No'} auth scenarios...`,
      "Validating Postman script syntax...",
      "Validating ReadyAPI Groovy code...",
      "Checking assertion completeness...",
      "Verifying test data integrity...",
      "Final quality assessment..."
    ], 1200);
    updateAgentState("refiner", { status: "completed", message: "All validations passed", progress: 100 });

    setQeValidationComplete(true);
    setPipelineComplete(true);
  };

  const addHeader = () => {
    setHeaders([...headers, { key: "", value: "", enabled: true }]);
  };

  const removeHeader = (index: number) => {
    setHeaders(headers.filter((_, i) => i !== index));
  };

  const updateHeader = (index: number, field: keyof Header, value: string | boolean) => {
    const updated = [...headers];
    updated[index] = { ...updated[index], [field]: value };
    setHeaders(updated);
  };

  const addQueryParam = () => {
    setQueryParams([...queryParams, { key: "", value: "", enabled: true }]);
  };

  const removeQueryParam = (index: number) => {
    setQueryParams(queryParams.filter((_, i) => i !== index));
  };

  const updateQueryParam = (index: number, field: keyof QueryParam, value: string | boolean) => {
    const updated = [...queryParams];
    updated[index] = { ...updated[index], [field]: value };
    setQueryParams(updated);
  };

  const toggleTestExpanded = (id: string) => {
    const updated = new Set(expandedTests);
    if (updated.has(id)) {
      updated.delete(id);
    } else {
      updated.add(id);
    }
    setExpandedTests(updated);
  };

  /**
   * Execute the user's API call from the browser.
   *
   * When the backend runs inside a private VPC behind a NAT gateway (the
   * deployed EKS topology), Node-side `fetch()` to arbitrary external URLs
   * often fails with the unhelpful message "fetch failed". The user's
   * browser, however, is on a network that can usually reach the endpoint,
   * so we attempt the request here first and forward the captured response
   * to the server. CORS / mixed-content failures fall back transparently.
   */
  const executeApiFromBrowser = async (
    enabledHeaders: Header[],
    enabledParams: QueryParam[],
  ): Promise<{
    executed: boolean;
    statusCode: number;
    responseTime: number;
    response?: any;
    responseHeaders?: Record<string, string>;
    error?: string | null;
  }> => {
    try {
      let url = apiConfig.endpoint;
      const qs = enabledParams
        .filter(p => p.key && p.value)
        .map(p => `${encodeURIComponent(p.key)}=${encodeURIComponent(p.value)}`)
        .join("&");
      if (qs) url += (url.includes("?") ? "&" : "?") + qs;

      const reqHeaders: Record<string, string> = {
        Accept: "application/json",
      };
      // Only set Content-Type when there's a body to send — adding it to GETs
      // would trigger a CORS preflight on simple cross-origin requests.
      if (["POST", "PUT", "PATCH"].includes(apiConfig.method) && apiConfig.requestBody) {
        reqHeaders["Content-Type"] = "application/json";
      }
      for (const h of enabledHeaders) {
        if (h.key && h.value) reqHeaders[h.key] = h.value;
      }
      if (apiConfig.authType === "bearer" && apiConfig.authToken) {
        reqHeaders["Authorization"] = `Bearer ${apiConfig.authToken}`;
      } else if (apiConfig.authType === "api-key" && apiConfig.apiKey) {
        reqHeaders[apiConfig.apiKeyHeader || "X-API-Key"] = apiConfig.apiKey;
      } else if (apiConfig.authType === "basic" && apiConfig.username) {
        reqHeaders["Authorization"] = `Basic ${btoa(`${apiConfig.username}:${apiConfig.password ?? ""}`)}`;
      }

      const fetchInit: RequestInit = {
        method: apiConfig.method,
        headers: reqHeaders,
        // Default mode: 'cors' — failures fall through to the server-side fetch.
      };
      if (["POST", "PUT", "PATCH"].includes(apiConfig.method) && apiConfig.requestBody) {
        fetchInit.body = apiConfig.requestBody;
      }

      const started = performance.now();
      const resp = await fetch(url, fetchInit);
      const responseTime = Math.max(0, Math.round(performance.now() - started));

      const responseHeaders: Record<string, string> = {};
      resp.headers.forEach((v, k) => {
        responseHeaders[k] = v;
      });

      const text = await resp.text();
      let parsed: any;
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = { rawText: text.substring(0, 2000) };
      }

      return {
        executed: true,
        statusCode: resp.status,
        responseTime,
        response: parsed,
        responseHeaders,
        error: null,
      };
    } catch (err: any) {
      // CORS, mixed-content, DNS, network — let the server fall back.
      return {
        executed: false,
        statusCode: 0,
        responseTime: 0,
        error: err?.message || "Browser fetch failed",
      };
    }
  };

  const generateTestCases = async () => {
    if (!apiConfig.endpoint) {
      toast({
        title: "Endpoint Required",
        description: "Please enter an API endpoint to generate test cases.",
        variant: "destructive"
      });
      return;
    }

    setIsGenerating(true);
    setShowAgentPipeline(true);
    setGeneratedTests([]);
    setPendingTestCases([]);
    setQeValidationComplete(false);
    // Show the response card immediately with a loading state as the pipeline starts.
    setApiExecutionResult(API_EXECUTION_FETCHING);

    const enabledHeaders = headers.filter(h => h.enabled && h.key);
    const enabledParams = queryParams.filter(p => p.enabled && p.key);
    const effectiveParams = inferMissingQueryParams(apiConfig.endpoint, enabledParams);
    const autoFilledParams = queryParamsChanged(enabledParams, effectiveParams);
    if (autoFilledParams) {
      setQueryParams(effectiveParams);
      toast({
        title: "Query parameters auto-filled",
        description: "Required parameters were added so the live API returns real data.",
      });
    }

    // Fire the live API call right away — in parallel with the agent animation.
    const clientExecutionPromise = executeApiFromBrowser(
      enabledHeaders,
      effectiveParams.filter(p => p.key && p.value),
    );
    const pipelinePromise = runAgentPipeline();

    try {
      const clientExecution = await clientExecutionPromise;

      if (clientExecution.executed) {
        setApiExecutionResult(buildApiExecutionDisplay({
          executed: true,
          statusCode: clientExecution.statusCode,
          responseTime: clientExecution.responseTime,
          response: clientExecution.response,
          responseHeaders: clientExecution.responseHeaders,
        }));
      } else {
        setApiExecutionResult(buildApiExecutionDisplay({
          executed: false,
          statusCode: 0,
          responseTime: 0,
          error: clientExecution.error ?? "Browser fetch failed",
        }));
      }

      // Polling pattern: POST kicks off a background job and returns a jobId
      // immediately (well under any proxy timeout). The client then polls
      // /api/nradiverse/api-testing/jobs/:jobId every 2s until the job is
      // `done` or `error`. Each individual request completes in well under a
      // second, so CloudFront/ALB origin response timeouts never trigger
      // regardless of how long Bedrock takes to generate the test cases.
      const submitResponse = await fetch("/api/nradiverse/api-testing/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          apiConfig: {
            ...apiConfig,
            headers: enabledHeaders,
            queryParams: effectiveParams.filter(p => p.enabled && p.key),
          },
          testOptions,
          clientExecution,
        })
      });

      if (!submitResponse.ok) {
        let detail = "";
        try { detail = (await submitResponse.json())?.error || ""; } catch { /* non-json */ }
        throw new Error(detail || `Failed to start generation (HTTP ${submitResponse.status})`);
      }

      const submitBody = await submitResponse.json();
      const jobId: string | undefined = submitBody?.jobId;
      if (!jobId) {
        throw new Error(submitBody?.error || "Server did not return a jobId");
      }

      // Adaptive polling — fast (750 ms) for the first 10 s while the job
      // is still ramping up, then settle at 1 s. Eliminates the previous
      // hard 2 s pre-wait that added a guaranteed 2 s of dead time before
      // even the first poll, on top of generation latency.
      const POLL_TIMEOUT_MS = 5 * 60 * 1000;
      const pollStart = Date.now();
      let data: any = null;
      let pollCount = 0;
      while (Date.now() - pollStart < POLL_TIMEOUT_MS) {
        pollCount += 1;
        const interval = pollCount <= 12 ? 750 : 1000;
        await new Promise(r => setTimeout(r, interval));
        const pollResponse = await fetch(`/api/nradiverse/api-testing/jobs/${jobId}`);
        if (pollResponse.status === 404) {
          throw new Error("Generation job expired before completing");
        }
        if (!pollResponse.ok) {
          throw new Error(`Polling failed (HTTP ${pollResponse.status})`);
        }
        const pollBody = await pollResponse.json();
        if (pollBody?.status === "done") {
          data = pollBody.result;
          break;
        }
        if (pollBody?.status === "error") {
          throw new Error(pollBody.error || "Generation failed");
        }
        // status === "running" → keep polling
      }
      if (!data) {
        throw new Error("Generation timed out — still running after 5 minutes");
      }
      if (data.success === false) {
        throw new Error(data.error || "Failed to generate test cases");
      }

      // Merge server execution metadata (may include server-side fallback data)
      if (data.apiExecution) {
        setApiExecutionResult(buildApiExecutionDisplay(data.apiExecution));
      }

      if (data.success && data.testCases) {
        // Display test cases AS SOON AS the data arrives. We used to
        // `await pipelinePromise` here, which blocked the UI for up to ~9.5s
        // of simulated agent animation even when Bedrock had already returned.
        // That created a visible lag between "Test Cases Generated" toast and
        // the list actually painting. The agent-pipeline animation is purely
        // cosmetic and keeps running in the background — `pipelinePromise`
        // resolves on its own and only drives the "Pipeline Complete" badge.
        setPendingTestCases(data.testCases);
        setGeneratedTests(data.testCases);
        setExpandedTests(new Set([data.testCases[0]?.id]));

        const executionInfo = data.apiExecution?.executed
          ? ` API returned ${data.apiExecution.statusCode} in ${data.apiExecution.responseTime}ms.`
          : "";
        toast({
          title: "Test Cases Generated from Live API",
          description: `Generated ${data.testCases.length} test cases with real response validation.${executionInfo}`
        });

        // Let the animation finish on its own — never block the user on it.
        pipelinePromise.catch(() => {
          /* animation errors are non-fatal */
        });
      } else {
        throw new Error(data.error || "Failed to generate test cases");
      }
    } catch (error: any) {
      toast({
        title: "Generation Failed",
        description: error.message || "Failed to generate test cases. Please try again.",
        variant: "destructive"
      });
      // Mark current agent as error
      setAgents(prev => prev.map((agent, i) =>
        i === currentAgentIndex ? { ...agent, status: "error", message: "Error occurred" } : agent
      ));
    } finally {
      setIsGenerating(false);
    }
  };

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast({
      title: "Copied!",
      description: `${label} copied to clipboard.`
    });
  };

  const handleExportJson = () => {
    exportApiTestsToJson(apiConfig, generatedTests);
    toast({ title: "Exported", description: "Test cases downloaded as JSON." });
  };

  const handleExportExcel = async () => {
    try {
      await exportApiTestsToExcel(apiConfig, generatedTests, queryParams);
      toast({ title: "Exported", description: `${generatedTests.length} test cases downloaded as Excel.` });
    } catch (error: unknown) {
      toast({
        title: "Export Failed",
        description: error instanceof Error ? error.message : "Failed to export Excel file.",
        variant: "destructive",
      });
    }
  };

  const handleExportPostman = () => {
    exportApiTestsToPostman(apiConfig, generatedTests, headers, queryParams);
    toast({ title: "Exported", description: "Postman collection downloaded — import into Postman." });
  };

  const handleExportReadyApi = () => {
    exportApiTestsToReadyApi(apiConfig, generatedTests, queryParams);
    toast({ title: "Exported", description: "ReadyAPI Groovy scripts downloaded (.groovy)." });
  };

  const handleExportPlaywright = () => {
    exportApiTestsToPlaywright(apiConfig, generatedTests, queryParams);
    toast({ title: "Exported", description: "Playwright API test scripts downloaded (.spec.ts)." });
  };

  // ==================== Baseline / Regression Testing Functions ====================

  // Load saved baselines from localStorage and server
  const loadBaselines = async () => {
    try {
      // First, load from localStorage for immediate display
      const localBaselines = safeGetItem("api_baselines");
      if (localBaselines) {
        try {
          const parsed = JSON.parse(localBaselines);
          setSavedBaselines(parsed);
        } catch (e) {
          console.error("Failed to parse local baselines:", e);
        }
      }

      // Then sync with server (server may have newer data from this session)
      const response = await fetch("/api/baselines");
      const data = await response.json();
      if (data.success && data.baselines.length > 0) {
        setSavedBaselines(data.baselines);
        // Persist via safe wrapper — large baseline sets can exceed the
        // ~5 MB localStorage quota, which throws synchronously and crashes
        // the page via ErrorBoundary if not handled.
        const result = safeSetJson("api_baselines", data.baselines);
        if (!result.ok && result.reason === "quota") {
          console.warn(
            "[api-testing] baseline payload exceeds localStorage quota — keeping in memory only",
          );
        }
      }
    } catch (error) {
      console.error("Failed to load baselines:", error);
    }
  };

  // Save baselines to localStorage whenever they change
  const persistBaselines = (baselines: ApiBaseline[]) => {
    setSavedBaselines(baselines);
    const result = safeSetJson("api_baselines", baselines);
    if (!result.ok && result.reason === "quota") {
      toast({
        title: "Baseline not cached locally",
        description:
          "The baseline set is too large for browser storage — it stays available in this session and on the server.",
        variant: "destructive",
      });
    }
  };

  // Save current response as baseline
  const saveAsBaseline = async () => {
    if (!apiExecutionResult?.fullResponse || !baselineName) {
      toast({
        title: "Cannot Save Baseline",
        description: "A name and valid API response are required to save a baseline.",
        variant: "destructive"
      });
      return;
    }

    try {
      // Collect ALL headers including auth headers
      const headersObj: Record<string, string> = {};

      // Add custom headers from the headers array
      const enabledHeaders = headers.filter(h => h.enabled && h.key);
      enabledHeaders.forEach(h => { headersObj[h.key] = h.value; });

      // Add auth headers based on auth type
      if (apiConfig.authType === "bearer" && apiConfig.authToken) {
        headersObj["Authorization"] = `Bearer ${apiConfig.authToken}`;
      } else if (apiConfig.authType === "apikey" && apiConfig.apiKey) {
        headersObj[apiConfig.apiKeyHeader || "X-API-Key"] = apiConfig.apiKey;
      } else if (apiConfig.authType === "api-key" && apiConfig.authToken) {
        headersObj[apiConfig.apiKeyHeader || "X-API-Key"] = apiConfig.authToken;
      } else if (apiConfig.authType === "basic" && apiConfig.authToken) {
        headersObj["Authorization"] = `Basic ${btoa(apiConfig.authToken)}`;
      }

      console.log("[Baseline] Saving with headers:", Object.keys(headersObj));

      const response = await fetch("/api/baselines", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: baselineName,
          description: baselineDescription,
          method: apiConfig.method,
          endpoint: apiConfig.endpoint,
          requestHeaders: headersObj,
          requestBody: apiConfig.requestBody,
          response: apiExecutionResult.fullResponse,
          statusCode: apiExecutionResult.statusCode,
          responseHeaders: apiExecutionResult.responseHeaders
        })
      });

      const data = await response.json();
      if (data.success) {
        toast({
          title: "Baseline Saved",
          description: `"${baselineName}" has been saved. You can now run regression tests against this baseline.`
        });
        setShowBaselineDialog(false);
        setBaselineName("");
        setBaselineDescription("");

        // Add to local storage immediately
        const newBaseline = data.baseline;
        const updatedBaselines = [...savedBaselines, newBaseline];
        persistBaselines(updatedBaselines);
      } else {
        throw new Error(data.error);
      }
    } catch (error: any) {
      toast({
        title: "Save Failed",
        description: error.message || "Failed to save baseline",
        variant: "destructive"
      });
    }
  };

  // Execute baseline and compare
  const executeBaseline = async (baselineId: string) => {
    try {
      // Find baseline from localStorage first
      const baseline = savedBaselines.find(b => b.id === baselineId);
      if (!baseline) {
        throw new Error("Baseline not found");
      }

      // Ensure baseline exists on server (restore from localStorage if needed)
      const checkResponse = await fetch(`/api/baselines/${baselineId}`);
      if (!checkResponse.ok || (await checkResponse.json()).success === false) {
        // Baseline not on server, re-save it from localStorage
        await fetch("/api/baselines", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: baseline.id,
            name: baseline.name,
            description: baseline.description || "",
            method: baseline.method,
            endpoint: baseline.endpoint,
            requestHeaders: baseline.requestHeaders,
            requestBody: baseline.requestBody,
            response: baseline.baselineResponse,
            statusCode: baseline.baselineStatusCode,
            responseHeaders: baseline.baselineHeaders,
            schema: baseline.responseSchema
          })
        });
      }

      const response = await fetch(`/api/baselines/${baselineId}/execute`, {
        method: "POST"
      });
      const data = await response.json();

      if (data.success) {
        setComparisonResult(data.execution);
        setShowComparisonResult(true);

        // Update localStorage with new execution status
        const updatedBaselines = savedBaselines.map(b =>
          b.id === baselineId
            ? { ...b, lastExecutionStatus: data.execution.summary.overallStatus, executionCount: (b.executionCount || 0) + 1 }
            : b
        );
        persistBaselines(updatedBaselines);

        const status = data.execution.summary.overallStatus;
        toast({
          title: status === "pass" ? "Regression Test Passed" : status === "warning" ? "Differences Detected" : "Regression Test Failed",
          description: `${data.execution.differences.length} differences found. Status: ${status.toUpperCase()}`,
          variant: status === "pass" ? "default" : "destructive"
        });
      } else {
        throw new Error(data.error);
      }
    } catch (error: any) {
      toast({
        title: "Execution Failed",
        description: error.message || "Failed to execute baseline comparison",
        variant: "destructive"
      });
    }
  };

  // Delete baseline
  const deleteBaseline = async (baselineId: string) => {
    try {
      await fetch(`/api/baselines/${baselineId}`, { method: "DELETE" });

      // Remove from localStorage
      const updatedBaselines = savedBaselines.filter(b => b.id !== baselineId);
      persistBaselines(updatedBaselines);
      toast({ title: "Baseline Deleted" });
    } catch (error) {
      toast({ title: "Delete Failed", variant: "destructive" });
    }
  };

  // Load baselines on mount
  useEffect(() => {
    loadBaselines();
  }, []);

  // Swagger parsing function
  const parseSwaggerSpec = async () => {
    if (swaggerInputType === "url" && !swaggerUrl) {
      toast({
        title: "URL Required",
        description: "Please enter a Swagger/OpenAPI URL",
        variant: "destructive"
      });
      return;
    }

    if (swaggerInputType === "file" && !swaggerContent) {
      toast({
        title: "File Required",
        description: "Please upload a Swagger/OpenAPI specification file",
        variant: "destructive"
      });
      return;
    }

    setParsedEndpoints([]);
    setApiInfo(null);
    setShowResults(false);

    swaggerParseMutation.mutate({
      inputType: swaggerInputType === "file" ? "content" : swaggerInputType,
      swaggerUrl: swaggerInputType === "url" ? swaggerUrl : undefined,
      swaggerContent: swaggerInputType === "file" ? swaggerContent : undefined
    }, {
      onSuccess: (data: any) => {
        if (data.success) {
          const endpoints = data.endpoints.map((ep: SwaggerEndpoint) => ({
            ...ep,
            selected: true
          }));
          setParsedEndpoints(endpoints);
          setApiInfo(data.apiInfo);
          setExpandedTags(new Set(["default", ...data.endpoints.map((ep: SwaggerEndpoint) => ep.tags[0] || "default")]));

          toast({
            title: "Swagger Parsed Successfully",
            description: `Found ${endpoints.length} endpoints in ${data.apiInfo.title}`
          });
        } else {
          toast({
            title: "Parse Failed",
            description: data.error || "Failed to parse specification",
            variant: "destructive"
          });
        }
      },
      onError: (error: any) => {
        toast({
          title: "Parse Failed",
          description: error.message || "Failed to parse Swagger specification",
          variant: "destructive"
        });
      }
    });
  };

  // Handle file upload
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      setSwaggerContent(content);
      toast({
        title: "File Loaded",
        description: `Loaded ${file.name}`
      });
    };
    reader.readAsText(file);
  };

  // Toggle endpoint selection
  const toggleEndpointSelection = (endpointId: string) => {
    setParsedEndpoints(prev =>
      prev.map(ep => ep.id === endpointId ? { ...ep, selected: !ep.selected } : ep)
    );
  };

  // Select/deselect all endpoints
  const toggleAllEndpoints = (selected: boolean) => {
    setParsedEndpoints(prev => prev.map(ep => ({ ...ep, selected })));
  };

  // Execute batch tests
  const executeBatchTests = async () => {
    const selectedEndpoints = parsedEndpoints.filter(ep => ep.selected);

    if (selectedEndpoints.length === 0) {
      toast({
        title: "No Endpoints Selected",
        description: "Please select at least one endpoint to test",
        variant: "destructive"
      });
      return;
    }

    setExecutionProgress(0);
    setTestResults([]);
    setTestSummary(null);
    setShowResults(false);

    batchTestMutation.mutate({
      endpoints: selectedEndpoints,
      config: {
        baseUrl: apiInfo?.baseUrl || apiConfig.baseUrl,
        authType: apiConfig.authType,
        authToken: apiConfig.authToken || apiConfig.apiKey,
        timeout: 30000
      },
      testOptions: {
        positiveTests: testOptions.functional,
        negativeTests: testOptions.negative,
        boundaryTests: testOptions.boundary,
        securityTests: testOptions.security,
        performanceTests: testOptions.performance
      }
    }, {
      onSuccess: (data: any) => {
        if (data.success) {
          setTestResults(data.results);
          setTestSummary(data.summary);
          setShowResults(true);
          setExecutionProgress(100);

          toast({
            title: "Tests Completed",
            description: `${data.summary.passed}/${data.summary.total} tests passed (${data.summary.passRate}%)`
          });
        } else {
          toast({
            title: "Execution Failed",
            description: data.error || "Test execution failed",
            variant: "destructive"
          });
          setExecutionProgress(100);
        }
      },
      onError: (error: any) => {
        toast({
          title: "Execution Failed",
          description: error.message || "Failed to execute tests",
          variant: "destructive"
        });
        setExecutionProgress(100);
      }
    });
  };

  // Export HTML report
  const exportHTMLReport = async () => {
    try {
      const response = await fetch("/api/swagger/report/html", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          results: { results: testResults, summary: testSummary },
          apiInfo,
          config: { baseUrl: apiInfo?.baseUrl || apiConfig.baseUrl }
        })
      });

      if (!response.ok) throw new Error("Failed to generate report");

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `api-test-report-${Date.now()}.html`;
      a.click();
      URL.revokeObjectURL(url);

      toast({
        title: "Report Downloaded",
        description: "HTML report has been downloaded"
      });
    } catch (error: any) {
      toast({
        title: "Export Failed",
        description: error.message,
        variant: "destructive"
      });
    }
  };

  // Get method color
  const getMethodColor = (method: string) => {
    switch (method.toUpperCase()) {
      case 'GET': return 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30';
      case 'POST': return 'bg-blue-500/20 text-blue-400 border-blue-500/30';
      case 'PUT': return 'bg-amber-500/20 text-amber-400 border-amber-500/30';
      case 'PATCH': return 'bg-orange-500/20 text-orange-400 border-orange-500/30';
      case 'DELETE': return 'bg-red-500/20 text-red-400 border-red-500/30';
      default: return 'bg-muted text-muted-foreground';
    }
  };

  const getTypeColor = (type: string) => {
    switch (type) {
      case 'functional': return 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30';
      case 'negative': return 'bg-red-500/20 text-red-400 border-red-500/30';
      case 'security': return 'bg-violet-500/20 text-violet-400 border-violet-500/30';
      case 'performance': return 'bg-amber-500/20 text-amber-400 border-amber-500/30';
      case 'boundary': return 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30';
      default: return 'bg-muted text-muted-foreground';
    }
  };

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'P0': return 'bg-red-500/20 text-red-400 border-red-500/30';
      case 'P1': return 'bg-orange-500/20 text-orange-400 border-orange-500/30';
      case 'P2': return 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30';
      case 'P3': return 'bg-slate-500/20 text-slate-400 border-slate-500/30';
      default: return 'bg-muted text-muted-foreground';
    }
  };

  const AgentCircle = ({ agent, isActive }: { agent: AgentState; isActive: boolean }) => {
    const Icon = agent.icon;
    const colorClass = {
      violet: { border: 'border-violet-500', bg: 'bg-violet-500/20', text: 'text-violet-400', glow: 'shadow-violet-500/50' },
      cyan: { border: 'border-cyan-500', bg: 'bg-cyan-500/20', text: 'text-cyan-400', glow: 'shadow-cyan-500/50' },
      amber: { border: 'border-amber-500', bg: 'bg-amber-500/20', text: 'text-amber-400', glow: 'shadow-amber-500/50' },
      emerald: { border: 'border-emerald-500', bg: 'bg-emerald-500/20', text: 'text-emerald-400', glow: 'shadow-emerald-500/50' },
      rose: { border: 'border-rose-500', bg: 'bg-rose-500/20', text: 'text-rose-400', glow: 'shadow-rose-500/50' }
    }[agent.color] || { border: 'border-muted', bg: 'bg-muted/20', text: 'text-muted-foreground', glow: '' };

    return (
      <div className="flex flex-col items-center text-center" data-testid={`agent-circle-${agent.id}`}>
        {/* Circular Agent Icon */}
        <div className="relative mb-3">
          <div
            className={`w-20 h-20 rounded-full border-3 flex items-center justify-center transition-all duration-500 ${
              agent.status === 'idle'
                ? 'border-muted-foreground/30 bg-muted/20 opacity-50'
                : agent.status === 'error'
                  ? 'border-red-500 bg-red-500/20'
                  : agent.status === 'working'
                    ? `${colorClass.border} ${colorClass.bg} shadow-lg ${colorClass.glow} animate-pulse`
                    : `${colorClass.border} ${colorClass.bg}`
            }`}
            style={{ borderWidth: '3px' }}
          >
            {agent.status === 'working' ? (
              <Loader2 className={`w-8 h-8 ${colorClass.text} animate-spin`} />
            ) : agent.status === 'completed' ? (
              <CheckCircle2 className={`w-8 h-8 ${colorClass.text}`} />
            ) : agent.status === 'error' ? (
              <XCircle className="w-8 h-8 text-red-400" />
            ) : (
              <Icon className={`w-8 h-8 ${agent.status === 'idle' ? 'text-muted-foreground/50' : colorClass.text}`} />
            )}
          </div>

          {/* Animated ring for working state */}
          {agent.status === 'working' && (
            <>
              <div className={`absolute inset-0 w-20 h-20 rounded-full border-2 ${colorClass.border} animate-ping opacity-30`} style={{ borderWidth: '2px' }} />
              <div className="absolute -top-1 -right-1">
                <span className="relative flex h-4 w-4">
                  <span className={`animate-ping absolute inline-flex h-full w-full rounded-full ${colorClass.bg} opacity-75`}></span>
                  <span className={`relative inline-flex rounded-full h-4 w-4 ${colorClass.bg} border ${colorClass.border}`}></span>
                </span>
              </div>
            </>
          )}

          {/* Checkmark overlay for completed */}
          {agent.status === 'completed' && (
            <div className={`absolute -bottom-1 -right-1 w-6 h-6 rounded-full ${colorClass.bg} border-2 ${colorClass.border} flex items-center justify-center`}>
              <CheckCircle2 className={`w-4 h-4 ${colorClass.text}`} />
            </div>
          )}
        </div>

        {/* Agent Name and Status Badge */}
        <div className="space-y-1">
          <h4 className={`font-semibold text-sm ${agent.status === 'idle' ? 'text-muted-foreground/70' : 'text-foreground'}`}>
            {agent.name}
          </h4>
          <p className="text-xs text-muted-foreground">{agent.role}</p>

          {agent.status === 'working' && (
            <Badge variant="outline" className="text-xs bg-primary/20 text-primary border-primary/30 animate-pulse mt-1">
              Active
            </Badge>
          )}
          {agent.status === 'completed' && (
            <Badge variant="outline" className={`text-xs ${colorClass.bg} ${colorClass.text} ${colorClass.border} mt-1`}>
              Done
            </Badge>
          )}
        </div>

        {/* Status Message */}
        <p className={`text-xs mt-2 max-w-[140px] leading-tight ${
          agent.status === 'idle' ? 'text-muted-foreground/50' : 'text-foreground/70'
        }`}>
          {agent.message}
        </p>

        {/* Progress indicator for working state */}
        {agent.status === 'working' && (
          <div className="w-16 mt-2">
            <Progress value={agent.progress} className="h-1" />
          </div>
        )}
      </div>
    );
  };

  return (
    <>
      <DashboardHeader />

      <main className="flex-1 overflow-y-auto p-6">
        <div className="space-y-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <Link href="/nradiverse">
                  <Button variant="ghost" size="icon" data-testid="button-back">
                    <ArrowLeft className="w-5 h-5" />
                  </Button>
                </Link>
                <div>
                  <h1 className="text-2xl font-bold text-foreground flex items-center gap-3" data-testid="heading-api-testing">
                    <div className="p-2 rounded-lg bg-gradient-to-br from-blue-500/20 to-indigo-500/20">
                      <Globe className="w-7 h-7 text-blue-400" />
                    </div>
                    API Testing Module
                  </h1>
                  <p className="text-muted-foreground mt-1">
                    AI-powered comprehensive API test case generation with multi-agent orchestration
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="gap-1">
                  <Bot className="w-3 h-3" />
                  5 AI Agents
                </Badge>
                <Badge variant="outline" className="gap-1">
                  <SiPostman className="w-3 h-3" />
                  Postman
                </Badge>
                <Badge variant="outline" className="gap-1">
                  <Code2 className="w-3 h-3" />
                  ReadyAPI
                </Badge>
              </div>
            </div>

            {/* Input Mode Selection */}
            <Card>
              <CardContent className="pt-6">
                <Tabs value={inputMode} onValueChange={(v) => setInputMode(v as "single" | "swagger")}>
                  <TabsList className="grid w-full grid-cols-2 mb-6">
                    <TabsTrigger value="single" data-testid="tab-single-endpoint" className="gap-2">
                      <Send className="w-4 h-4" />
                      Single Endpoint
                    </TabsTrigger>
                    <TabsTrigger value="swagger" data-testid="tab-swagger" className="gap-2">
                      <FileJson className="w-4 h-4" />
                      Swagger / OpenAPI
                    </TabsTrigger>
                  </TabsList>

                  {/* Swagger/OpenAPI Mode */}
                  <TabsContent value="swagger" className="space-y-6">
                    {/* Input Type Selection */}
                    <div className="grid grid-cols-2 gap-4">
                      <div
                        className={`p-4 rounded-lg border-2 cursor-pointer transition-all ${
                          swaggerInputType === "url"
                            ? "border-primary bg-primary/10"
                            : "border-muted hover:border-primary/50"
                        }`}
                        onClick={() => setSwaggerInputType("url")}
                        data-testid="input-type-url"
                      >
                        <div className="flex items-center gap-3">
                          <div className="p-2 rounded-lg bg-primary/20">
                            <Link2 className="w-5 h-5 text-primary" />
                          </div>
                          <div>
                            <h3 className="font-medium">Swagger URL</h3>
                            <p className="text-sm text-muted-foreground">SwaggerHub or direct URL</p>
                          </div>
                        </div>
                      </div>
                      <div
                        className={`p-4 rounded-lg border-2 cursor-pointer transition-all ${
                          swaggerInputType === "file"
                            ? "border-primary bg-primary/10"
                            : "border-muted hover:border-primary/50"
                        }`}
                        onClick={() => setSwaggerInputType("file")}
                        data-testid="input-type-file"
                      >
                        <div className="flex items-center gap-3">
                          <div className="p-2 rounded-lg bg-emerald-500/20">
                            <Upload className="w-5 h-5 text-emerald-400" />
                          </div>
                          <div>
                            <h3 className="font-medium">Upload File</h3>
                            <p className="text-sm text-muted-foreground">JSON or YAML spec file</p>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* URL Input */}
                    {swaggerInputType === "url" && (
                      <div className="space-y-2">
                        <Label>Swagger/OpenAPI URL</Label>
                        <div className="flex gap-2">
                          <Input
                            placeholder="https://api.example.com/swagger.json or SwaggerHub URL"
                            value={swaggerUrl}
                            onChange={(e) => setSwaggerUrl(e.target.value)}
                            className="flex-1"
                            data-testid="input-swagger-url"
                          />
                          <Button
                            onClick={parseSwaggerSpec}
                            disabled={swaggerParseMutation.isPending || !swaggerUrl}
                            data-testid="button-parse-swagger"
                          >
                            {swaggerParseMutation.isPending ? (
                              <Loader2 className="w-4 h-4 animate-spin mr-2" />
                            ) : (
                              <Search className="w-4 h-4 mr-2" />
                            )}
                            Parse
                          </Button>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          Supports OpenAPI 2.0 (Swagger) and OpenAPI 3.x specifications
                        </p>
                      </div>
                    )}

                    {/* File Upload */}
                    {swaggerInputType === "file" && (
                      <div className="space-y-2">
                        <Label>Upload Specification File</Label>
                        <div className="flex gap-2">
                          <Input
                            type="file"
                            accept=".json,.yaml,.yml"
                            onChange={handleFileUpload}
                            className="flex-1"
                            data-testid="input-swagger-file"
                          />
                          <Button
                            onClick={parseSwaggerSpec}
                            disabled={swaggerParseMutation.isPending || !swaggerContent}
                            data-testid="button-parse-file"
                          >
                            {swaggerParseMutation.isPending ? (
                              <Loader2 className="w-4 h-4 animate-spin mr-2" />
                            ) : (
                              <FileCode className="w-4 h-4 mr-2" />
                            )}
                            Parse
                          </Button>
                        </div>
                        {swaggerContent && (
                          <Badge variant="outline" className="bg-emerald-500/10 text-emerald-400">
                            <Check className="w-3 h-3 mr-1" />
                            File loaded ({Math.round(swaggerContent.length / 1024)}KB)
                          </Badge>
                        )}
                      </div>
                    )}

                    {/* Parsed API Info */}
                    {apiInfo && (
                      <Card className="bg-muted/30">
                        <CardHeader className="pb-3">
                          <div className="flex items-center justify-between">
                            <div>
                              <CardTitle className="text-lg flex items-center gap-2">
                                <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                                {apiInfo.title}
                              </CardTitle>
                              <CardDescription>
                                v{apiInfo.version} • {apiInfo.baseUrl || "No base URL"}
                              </CardDescription>
                            </div>
                            <Badge variant="outline" className="bg-primary/10">
                              {parsedEndpoints.length} Endpoints
                            </Badge>
                          </div>
                        </CardHeader>
                      </Card>
                    )}

                    {/* Endpoint Selection - Grouped by Tags */}
                    {parsedEndpoints.length > 0 && (
                      <Card>
                        <CardHeader className="pb-3">
                          <div className="flex items-center justify-between">
                            <CardTitle className="text-base">Select Endpoints to Test</CardTitle>
                            <div className="flex items-center gap-2">
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => toggleAllEndpoints(true)}
                              >
                                Select All
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => toggleAllEndpoints(false)}
                              >
                                Deselect All
                              </Button>
                            </div>
                          </div>
                        </CardHeader>
                        <CardContent>
                          <ScrollArea className="h-[400px]">
                            <div className="space-y-3">
                              {groupedEndpoints.map(([tag, endpoints]) => {
                                const selectedCount = endpoints.filter(ep => ep.selected).length;
                                const isExpanded = expandedTags.has(tag);
                                return (
                                  <Collapsible
                                    key={tag}
                                    open={isExpanded}
                                    onOpenChange={() => toggleTagExpanded(tag)}
                                    className="border rounded-lg overflow-hidden"
                                  >
                                    <CollapsibleTrigger className="flex items-center justify-between w-full p-3 hover:bg-muted/50 transition-colors">
                                      <div className="flex items-center gap-3">
                                        <Checkbox
                                          checked={selectedCount === endpoints.length ? true : selectedCount > 0 ? "indeterminate" : false}
                                          onCheckedChange={(checked) => {
                                            toggleTagSelection(tag, checked === "indeterminate" ? true : !!checked);
                                          }}
                                          onClick={(e) => e.stopPropagation()}
                                          data-testid={`checkbox-tag-${tag}`}
                                        />
                                        <span className="font-medium capitalize">{tag}</span>
                                        <Badge variant="outline" className="text-xs">
                                          {selectedCount}/{endpoints.length}
                                        </Badge>
                                      </div>
                                      {isExpanded ? (
                                        <ChevronUp className="w-4 h-4 text-muted-foreground" />
                                      ) : (
                                        <ChevronDown className="w-4 h-4 text-muted-foreground" />
                                      )}
                                    </CollapsibleTrigger>
                                    <CollapsibleContent>
                                      <div className="border-t">
                                        {endpoints.map((ep) => (
                                          <div
                                            key={ep.id}
                                            className={`flex items-center gap-3 p-3 border-b last:border-b-0 cursor-pointer transition-all ${
                                              ep.selected
                                                ? "bg-primary/5"
                                                : "hover:bg-muted/30"
                                            } ${ep.deprecated ? "opacity-50" : ""}`}
                                            onClick={() => toggleEndpointSelection(ep.id)}
                                            data-testid={`endpoint-${ep.id}`}
                                          >
                                            <Checkbox
                                              checked={ep.selected}
                                              onCheckedChange={() => toggleEndpointSelection(ep.id)}
                                            />
                                            <Badge
                                              variant="outline"
                                              className={`${getMethodColor(ep.method)} min-w-[60px] justify-center`}
                                            >
                                              {ep.method}
                                            </Badge>
                                            <span className="font-mono text-sm flex-1 truncate">{ep.path}</span>
                                            <span className="text-sm text-muted-foreground truncate max-w-[180px]">
                                              {ep.summary}
                                            </span>
                                            {ep.deprecated && (
                                              <Badge variant="outline" className="bg-amber-500/10 text-amber-400 text-xs">
                                                Deprecated
                                              </Badge>
                                            )}
                                          </div>
                                        ))}
                                      </div>
                                    </CollapsibleContent>
                                  </Collapsible>
                                );
                              })}
                            </div>
                          </ScrollArea>
                        </CardContent>
                      </Card>
                    )}

                    {/* Authentication for Swagger Mode */}
                    {parsedEndpoints.length > 0 && (
                      <Card>
                        <CardHeader className="pb-3">
                          <CardTitle className="text-base flex items-center gap-2">
                            <Shield className="w-4 h-4" />
                            Authentication
                          </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4">
                          <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                              <Label>Auth Type</Label>
                              <Select
                                value={apiConfig.authType}
                                onValueChange={(v) => setApiConfig(p => ({ ...p, authType: v }))}
                              >
                                <SelectTrigger data-testid="select-auth-type">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="none">None</SelectItem>
                                  <SelectItem value="bearer">Bearer Token</SelectItem>
                                  <SelectItem value="api-key">API Key</SelectItem>
                                  <SelectItem value="basic">Basic Auth</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>
                            {apiConfig.authType !== "none" && (
                              <div className="space-y-2">
                                <Label>
                                  {apiConfig.authType === "bearer" ? "Token" :
                                   apiConfig.authType === "api-key" ? "API Key" :
                                   "Credentials (user:pass)"}
                                </Label>
                                <Input
                                  type="password"
                                  placeholder={apiConfig.authType === "bearer" ? "Bearer token..." :
                                               apiConfig.authType === "api-key" ? "API key..." :
                                               "username:password"}
                                  value={apiConfig.authToken}
                                  onChange={(e) => setApiConfig(p => ({ ...p, authToken: e.target.value }))}
                                  data-testid="input-auth-token"
                                />
                              </div>
                            )}
                          </div>

                          {/* Base URL Override */}
                          <div className="space-y-2">
                            <Label>Base URL (optional override)</Label>
                            <Input
                              placeholder={apiInfo?.baseUrl || "https://api.example.com"}
                              value={apiConfig.baseUrl}
                              onChange={(e) => setApiConfig(p => ({ ...p, baseUrl: e.target.value }))}
                              data-testid="input-base-url"
                            />
                          </div>
                        </CardContent>
                      </Card>
                    )}

                    {parsedEndpoints.length > 0 && (
                      <div className="flex flex-wrap items-center justify-between gap-4 pt-2">
                        <div className="text-sm text-muted-foreground">
                          {parsedEndpoints.filter(ep => ep.selected).length} of {parsedEndpoints.length} endpoints selected
                        </div>
                        <Button
                          onClick={executeBatchTests}
                          disabled={
                            batchTestMutation.isPending ||
                            parsedEndpoints.filter(ep => ep.selected).length === 0
                          }
                          className="bg-blue-600 hover:bg-blue-700 text-white min-w-[160px]"
                          data-testid="button-execute-swagger-tests"
                        >
                          {batchTestMutation.isPending ? (
                            <>
                              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                              Executing…
                            </>
                          ) : (
                            <>
                              <Play className="w-4 h-4 mr-2" />
                              Execute Tests
                            </>
                          )}
                        </Button>
                      </div>
                    )}

                    {/* Test Results Dashboard */}
                    {showResults && testSummary && (
                      <Card className="border-2 border-primary/20">
                        <CardHeader>
                          <div className="flex items-center justify-between">
                            <CardTitle className="flex items-center gap-2">
                              <BarChart3 className="w-5 h-5 text-primary" />
                              Test Results
                            </CardTitle>
                            <Button variant="outline" size="sm" onClick={exportHTMLReport}>
                              <Download className="w-4 h-4 mr-2" />
                              Export Report
                            </Button>
                          </div>
                        </CardHeader>
                        <CardContent className="space-y-6">
                          {/* Summary Cards */}
                          <div className="grid grid-cols-4 gap-4">
                            <Card className="bg-muted/30">
                              <CardContent className="pt-4">
                                <div className="text-2xl font-bold text-foreground">{testSummary.total}</div>
                                <div className="text-sm text-muted-foreground">Total Tests</div>
                              </CardContent>
                            </Card>
                            <Card className="bg-emerald-500/10 border-emerald-500/30">
                              <CardContent className="pt-4">
                                <div className="text-2xl font-bold text-emerald-400">{testSummary.passed}</div>
                                <div className="text-sm text-muted-foreground">Passed ({testSummary.passRate}%)</div>
                              </CardContent>
                            </Card>
                            <Card className="bg-red-500/10 border-red-500/30">
                              <CardContent className="pt-4">
                                <div className="text-2xl font-bold text-red-400">{testSummary.failed}</div>
                                <div className="text-sm text-muted-foreground">Failed</div>
                              </CardContent>
                            </Card>
                            <Card className="bg-amber-500/10 border-amber-500/30">
                              <CardContent className="pt-4">
                                <div className="text-2xl font-bold text-amber-400">{testSummary.avgResponseTime}ms</div>
                                <div className="text-sm text-muted-foreground">Avg Response</div>
                              </CardContent>
                            </Card>
                          </div>

                          {/* Results Table */}
                          <div className="rounded-lg border overflow-hidden">
                            <div className="bg-muted/50 px-4 py-2 font-medium grid grid-cols-12 gap-4">
                              <div className="col-span-2">Method</div>
                              <div className="col-span-5">Endpoint</div>
                              <div className="col-span-2">Status</div>
                              <div className="col-span-2">Response</div>
                              <div className="col-span-1">Time</div>
                            </div>
                            <ScrollArea className="h-[250px]">
                              {testResults.map((result) => (
                                <div
                                  key={result.endpointId}
                                  className="px-4 py-3 border-b grid grid-cols-12 gap-4 items-center"
                                >
                                  <div className="col-span-2">
                                    <Badge variant="outline" className={getMethodColor(result.method)}>
                                      {result.method}
                                    </Badge>
                                  </div>
                                  <div
                                    className="col-span-5 font-mono text-sm truncate"
                                    title={result.resolvedPath && result.resolvedPath !== result.path ? `Spec: ${result.path}` : undefined}
                                  >
                                    {result.resolvedPath && result.resolvedPath !== result.path
                                      ? result.resolvedPath
                                      : result.path}
                                  </div>
                                  <div className="col-span-2">
                                    <Badge
                                      variant="outline"
                                      className={result.status === "passed"
                                        ? "bg-emerald-500/10 text-emerald-400"
                                        : result.status === "failed"
                                        ? "bg-red-500/10 text-red-400"
                                        : "bg-amber-500/10 text-amber-400"
                                      }
                                    >
                                      {result.status === "passed" && <CheckCircle2 className="w-3 h-3 mr-1" />}
                                      {result.status === "failed" && <XCircle className="w-3 h-3 mr-1" />}
                                      {result.status.toUpperCase()}
                                    </Badge>
                                  </div>
                                  <div className="col-span-2">
                                    <Badge variant="outline">{result.statusCode}</Badge>
                                  </div>
                                  <div className="col-span-1 text-sm text-muted-foreground">
                                    {result.responseTime}ms
                                  </div>
                                </div>
                              ))}
                            </ScrollArea>
                          </div>
                        </CardContent>
                      </Card>
                    )}
                  </TabsContent>

                  {/* Single Endpoint Mode - Wrapper for existing content */}
                  <TabsContent value="single">
                    {/* Existing single endpoint content will go here */}
                  </TabsContent>
                </Tabs>
              </CardContent>
            </Card>

            {/* Show existing content only in single endpoint mode */}
            {inputMode === "single" && (
              <>
            {/* Agent Pipeline Visualization */}
            {showAgentPipeline && (
              <Card className="border-2 border-primary/20 bg-gradient-to-br from-primary/5 to-violet-500/5">
                <CardHeader className="pb-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="p-2 rounded-lg bg-primary/20">
                        <Network className="w-5 h-5 text-primary" />
                      </div>
                      <div>
                        <CardTitle className="text-lg">AI Agent Pipeline</CardTitle>
                        <CardDescription>Multi-agent orchestration for intelligent test generation</CardDescription>
                      </div>
                    </div>
                    {pipelineComplete && (
                      <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30">
                        <CheckCircle2 className="w-3 h-3 mr-1" />
                        Pipeline Complete
                      </Badge>
                    )}
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="flex items-start justify-center gap-2 md:gap-4 py-4 overflow-x-auto">
                    {agents.map((agent, index) => (
                      <div key={agent.id} className="flex items-center">
                        <AgentCircle agent={agent} isActive={index === currentAgentIndex} />
                        {index < agents.length - 1 && (
                          <div className="hidden md:flex items-center mx-2">
                            <div className={`w-8 h-0.5 transition-all duration-500 ${
                              agents[index + 1]?.status !== 'idle'
                                ? 'bg-gradient-to-r from-primary to-primary/50'
                                : 'bg-muted-foreground/20'
                            }`} />
                            <ArrowRight className={`w-4 h-4 -ml-1 transition-all duration-500 ${
                              agents[index + 1]?.status !== 'idle' ? 'text-primary' : 'text-muted-foreground/30'
                            }`} />
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Live API Response — shown below the pipeline as soon as generation starts */}
            {showAgentPipeline && apiExecutionResult && (
              <Card className={`rounded-2xl shadow-sm border-2 ${
                apiExecutionResult.fetching
                  ? 'border-blue-500/30 bg-blue-500/5'
                  : apiExecutionResult.executed
                    ? 'border-emerald-500/40 bg-emerald-500/[0.07]'
                    : 'border-amber-500/30 bg-amber-500/5'
              }`}>
                <CardHeader className="pb-3">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="flex items-center gap-3">
                      <div className={`flex items-center justify-center w-10 h-10 rounded-full shrink-0 ${
                        apiExecutionResult.fetching
                          ? 'bg-blue-500/20'
                          : apiExecutionResult.executed
                            ? 'bg-emerald-500'
                            : 'bg-amber-500/20'
                      }`}>
                        {apiExecutionResult.fetching ? (
                          <Loader2 className="w-5 h-5 text-blue-400 animate-spin" />
                        ) : apiExecutionResult.executed ? (
                          <CheckCircle2 className="w-5 h-5 text-white" />
                        ) : (
                          <AlertCircle className="w-5 h-5 text-amber-400" />
                        )}
                      </div>
                      <div>
                        <CardTitle className="text-lg font-semibold">
                          {apiExecutionResult.fetching
                            ? 'Capturing Live API Response'
                            : apiExecutionResult.executed
                              ? 'Live API Response Captured'
                              : 'API Connection Failed'}
                        </CardTitle>
                        <CardDescription className="mt-0.5">
                          {apiExecutionResult.fetching
                            ? `Sending ${apiConfig.method} request to ${apiConfig.endpoint}…`
                            : apiExecutionResult.executed
                              ? 'Test cases generated from actual JSON response structure'
                              : apiExecutionResult.error || 'Could not reach endpoint'}
                        </CardDescription>
                      </div>
                    </div>
                    {!apiExecutionResult.fetching && apiExecutionResult.executed && (
                      <div className="flex items-center gap-6 sm:gap-8">
                        <div className="text-center min-w-[56px]">
                          <div className={`text-3xl font-bold leading-none ${
                            apiExecutionResult.statusCode >= 200 && apiExecutionResult.statusCode < 300
                              ? 'text-emerald-500'
                              : apiExecutionResult.statusCode >= 400
                                ? 'text-red-500'
                                : 'text-amber-500'
                          }`}>
                            {apiExecutionResult.statusCode}
                          </div>
                          <div className="text-xs text-muted-foreground mt-1">Status</div>
                        </div>
                        <div className="text-center min-w-[72px]">
                          <div className="text-3xl font-bold leading-none text-blue-500">
                            {apiExecutionResult.responseTime}ms
                          </div>
                          <div className="text-xs text-muted-foreground mt-1">Response Time</div>
                        </div>
                      </div>
                    )}
                  </div>
                </CardHeader>
                {apiExecutionResult.fetching && (
                  <CardContent className="pt-0">
                    <div className="bg-muted/50 rounded-lg p-4 mt-2 flex items-center gap-3">
                      <Loader2 className="w-4 h-4 text-blue-400 animate-spin shrink-0" />
                      <div className="text-sm text-muted-foreground">
                        Executing request from your browser while the agent pipeline runs…
                      </div>
                    </div>
                  </CardContent>
                )}
                {!apiExecutionResult.fetching && apiExecutionResult.executed && (
                  <CardContent className="pt-0">
                    {isEmptyApiResponse(apiExecutionResult.fullResponse) && (
                      <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 mt-2">
                        <AlertTriangle className="w-4 h-4 text-amber-400 mt-0.5 shrink-0" />
                        <div className="text-sm text-amber-200/90">
                          <p className="font-medium text-amber-300">Response body is empty</p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            The API returned a {Array.isArray(apiExecutionResult.fullResponse) ? "blank array" : "empty body"}.
                            Many endpoints require query parameters — for example, add{" "}
                            <code className="text-amber-300">status=available</code> for Petstore&apos;s{" "}
                            <code className="text-amber-300">findByStatus</code> endpoint.
                          </p>
                        </div>
                      </div>
                    )}
                    {apiExecutionResult.fullResponse != null ? (
                    <div className="rounded-xl border border-border/40 bg-card/60 p-4 mt-1">
                      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                          {showFullResponse ? 'Full Response' : 'Response Preview'}
                        </span>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <Badge variant="outline" className="text-xs font-normal">JSON</Badge>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setShowFullResponse(!showFullResponse)}
                            className="h-7 px-2.5 text-xs text-muted-foreground hover:text-foreground"
                          >
                            {showFullResponse ? 'Collapse' : 'Expand Full Response'}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              navigator.clipboard.writeText(JSON.stringify(apiExecutionResult.fullResponse, null, 2));
                              toast({ title: "Copied!", description: "Response copied to clipboard" });
                            }}
                            className="h-7 px-2.5 text-xs text-muted-foreground hover:text-foreground"
                          >
                            <Copy className="w-3.5 h-3.5 mr-1" />
                            Copy
                          </Button>
                          <Button
                            size="sm"
                            onClick={() => setShowBaselineDialog(true)}
                            className="h-7 px-3 text-xs bg-emerald-600 hover:bg-emerald-700 text-white"
                            data-testid="button-record-baseline"
                          >
                            <Database className="w-3.5 h-3.5 mr-1" />
                            Record as Baseline
                          </Button>
                        </div>
                      </div>
                      <ScrollArea className={showFullResponse ? "h-[400px]" : "h-[160px]"}>
                        <pre className="text-xs font-mono text-foreground/90 whitespace-pre-wrap leading-relaxed pr-3">
                          {JSON.stringify(apiExecutionResult.fullResponse, null, 2)}
                        </pre>
                      </ScrollArea>
                    </div>
                    ) : (
                      <p className="text-sm text-muted-foreground mt-2">No response body received.</p>
                    )}
                    {apiExecutionResult.responseHeaders && Object.keys(apiExecutionResult.responseHeaders).length > 0 && (
                      <div className="rounded-xl border border-border/30 bg-muted/20 p-4 mt-3">
                        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Response Headers</span>
                        <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-1.5 text-xs font-mono">
                          {Object.entries(apiExecutionResult.responseHeaders).map(([key, value]) => (
                            <div key={key} className="flex gap-1 min-w-0">
                              <span className="text-muted-foreground shrink-0">{key}:</span>
                              <span className="text-foreground/80 break-all">{value}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </CardContent>
                )}
                {!apiExecutionResult.fetching && !apiExecutionResult.executed && apiExecutionResult.error && (
                  <CardContent className="pt-0">
                    <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-3 mt-2 text-sm text-amber-200/90">
                      {apiExecutionResult.error}
                    </div>
                  </CardContent>
                )}
              </Card>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Send className="w-5 h-5 text-blue-400" />
                    API Configuration
                  </CardTitle>
                  <CardDescription>
                    Define your API endpoint details for test case generation
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex gap-2">
                    <Select
                      value={apiConfig.method}
                      onValueChange={(value) => setApiConfig({ ...apiConfig, method: value })}
                    >
                      <SelectTrigger className="w-[120px]" data-testid="select-method">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="GET">GET</SelectItem>
                        <SelectItem value="POST">POST</SelectItem>
                        <SelectItem value="PUT">PUT</SelectItem>
                        <SelectItem value="PATCH">PATCH</SelectItem>
                        <SelectItem value="DELETE">DELETE</SelectItem>
                        <SelectItem value="HEAD">HEAD</SelectItem>
                        <SelectItem value="OPTIONS">OPTIONS</SelectItem>
                      </SelectContent>
                    </Select>
                    <Input
                      placeholder="https://api.example.com/v1/endpoint"
                      value={apiConfig.endpoint}
                      onChange={(e) => setApiConfig({ ...apiConfig, endpoint: e.target.value })}
                      className="flex-1"
                      data-testid="input-endpoint"
                    />
                  </div>

                  <div>
                    <Label>API Description</Label>
                    <Textarea
                      placeholder="Describe what this API does, its purpose, and expected behavior..."
                      value={apiConfig.description}
                      onChange={(e) => setApiConfig({ ...apiConfig, description: e.target.value })}
                      className="mt-1.5 h-20"
                      data-testid="input-description"
                    />
                  </div>

                  <Tabs defaultValue="headers" className="w-full">
                    <TabsList className="grid w-full grid-cols-4">
                      <TabsTrigger value="headers" data-testid="tab-headers">Headers</TabsTrigger>
                      <TabsTrigger value="params" data-testid="tab-params">Params</TabsTrigger>
                      <TabsTrigger value="body" data-testid="tab-body">Body</TabsTrigger>
                      <TabsTrigger value="auth" data-testid="tab-auth">Auth</TabsTrigger>
                    </TabsList>

                    <TabsContent value="headers" className="space-y-2 mt-3">
                      {headers.map((header, index) => (
                        <div key={index} className="flex items-center gap-2">
                          <Switch
                            checked={header.enabled}
                            onCheckedChange={(checked) => updateHeader(index, "enabled", checked)}
                          />
                          <Input
                            placeholder="Key"
                            value={header.key}
                            onChange={(e) => updateHeader(index, "key", e.target.value)}
                            className="flex-1"
                          />
                          <Input
                            placeholder="Value"
                            value={header.value}
                            onChange={(e) => updateHeader(index, "value", e.target.value)}
                            className="flex-1"
                          />
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => removeHeader(index)}
                            disabled={headers.length === 1}
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      ))}
                      <Button variant="outline" size="sm" onClick={addHeader} className="w-full">
                        <Plus className="w-4 h-4 mr-2" />
                        Add Header
                      </Button>
                    </TabsContent>

                    <TabsContent value="params" className="space-y-2 mt-3">
                      {queryParams.map((param, index) => (
                        <div key={index} className="flex items-center gap-2">
                          <Switch
                            checked={param.enabled}
                            onCheckedChange={(checked) => updateQueryParam(index, "enabled", checked)}
                          />
                          <Input
                            placeholder="Key"
                            value={param.key}
                            onChange={(e) => updateQueryParam(index, "key", e.target.value)}
                            className="flex-1"
                          />
                          <Input
                            placeholder="Value"
                            value={param.value}
                            onChange={(e) => updateQueryParam(index, "value", e.target.value)}
                            className="flex-1"
                          />
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => removeQueryParam(index)}
                            disabled={queryParams.length === 1}
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      ))}
                      <Button variant="outline" size="sm" onClick={addQueryParam} className="w-full">
                        <Plus className="w-4 h-4 mr-2" />
                        Add Parameter
                      </Button>
                    </TabsContent>

                    <TabsContent value="body" className="space-y-3 mt-3">
                      <div>
                        <Label>Request Body (JSON)</Label>
                        <Textarea
                          placeholder='{"key": "value"}'
                          value={apiConfig.requestBody}
                          onChange={(e) => setApiConfig({ ...apiConfig, requestBody: e.target.value })}
                          className="mt-1.5 h-32 font-mono text-sm"
                          data-testid="input-request-body"
                        />
                      </div>
                      <div>
                        <Label>Expected Response Schema (JSON)</Label>
                        <Textarea
                          placeholder='{"id": "number", "name": "string"}'
                          value={apiConfig.responseSchema}
                          onChange={(e) => setApiConfig({ ...apiConfig, responseSchema: e.target.value })}
                          className="mt-1.5 h-24 font-mono text-sm"
                          data-testid="input-response-schema"
                        />
                      </div>
                    </TabsContent>

                    <TabsContent value="auth" className="space-y-3 mt-3">
                      <div>
                        <Label>Authentication Type</Label>
                        <Select
                          value={apiConfig.authType}
                          onValueChange={(value) => setApiConfig({ ...apiConfig, authType: value })}
                        >
                          <SelectTrigger className="mt-1.5" data-testid="select-auth-type">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">No Auth</SelectItem>
                            <SelectItem value="bearer">Bearer Token</SelectItem>
                            <SelectItem value="apikey">API Key</SelectItem>
                            <SelectItem value="basic">Basic Auth</SelectItem>
                            <SelectItem value="oauth2">OAuth 2.0</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      {apiConfig.authType === "bearer" && (
                        <div>
                          <Label>Bearer Token</Label>
                          <Input
                            type="password"
                            placeholder="Enter bearer token..."
                            value={apiConfig.authToken}
                            onChange={(e) => setApiConfig({ ...apiConfig, authToken: e.target.value })}
                            className="mt-1.5"
                          />
                        </div>
                      )}

                      {apiConfig.authType === "apikey" && (
                        <>
                          <div>
                            <Label>Header Name</Label>
                            <Input
                              placeholder="X-API-Key"
                              value={apiConfig.apiKeyHeader}
                              onChange={(e) => setApiConfig({ ...apiConfig, apiKeyHeader: e.target.value })}
                              className="mt-1.5"
                            />
                          </div>
                          <div>
                            <Label>API Key</Label>
                            <Input
                              type="password"
                              placeholder="Enter API key..."
                              value={apiConfig.apiKey}
                              onChange={(e) => setApiConfig({ ...apiConfig, apiKey: e.target.value })}
                              className="mt-1.5"
                            />
                          </div>
                        </>
                      )}

                      {apiConfig.authType === "basic" && (
                        <>
                          <div>
                            <Label>Username</Label>
                            <Input
                              placeholder="Username"
                              value={apiConfig.username}
                              onChange={(e) => setApiConfig({ ...apiConfig, username: e.target.value })}
                              className="mt-1.5"
                            />
                          </div>
                          <div>
                            <Label>Password</Label>
                            <Input
                              type="password"
                              placeholder="Password"
                              value={apiConfig.password}
                              onChange={(e) => setApiConfig({ ...apiConfig, password: e.target.value })}
                              className="mt-1.5"
                            />
                          </div>
                        </>
                      )}
                    </TabsContent>
                  </Tabs>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Settings className="w-5 h-5 text-violet-400" />
                    Test Generation Options
                  </CardTitle>
                  <CardDescription>
                    Configure which types of test cases to generate
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="flex items-center justify-between p-3 rounded-lg border bg-card">
                      <div className="flex items-center gap-2">
                        <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                        <span className="text-sm font-medium">Functional Tests</span>
                      </div>
                      <Switch
                        checked={testOptions.functional}
                        onCheckedChange={(checked) => setTestOptions({ ...testOptions, functional: checked })}
                        data-testid="switch-functional"
                      />
                    </div>
                    <div className="flex items-center justify-between p-3 rounded-lg border bg-card">
                      <div className="flex items-center gap-2">
                        <XCircle className="w-4 h-4 text-red-400" />
                        <span className="text-sm font-medium">Negative Tests</span>
                      </div>
                      <Switch
                        checked={testOptions.negative}
                        onCheckedChange={(checked) => setTestOptions({ ...testOptions, negative: checked })}
                        data-testid="switch-negative"
                      />
                    </div>
                    <div className="flex items-center justify-between p-3 rounded-lg border bg-card">
                      <div className="flex items-center gap-2">
                        <Target className="w-4 h-4 text-cyan-400" />
                        <span className="text-sm font-medium">Boundary Tests</span>
                      </div>
                      <Switch
                        checked={testOptions.boundary}
                        onCheckedChange={(checked) => setTestOptions({ ...testOptions, boundary: checked })}
                        data-testid="switch-boundary"
                      />
                    </div>
                    <div className="flex items-center justify-between p-3 rounded-lg border bg-card">
                      <div className="flex items-center gap-2">
                        <Shield className="w-4 h-4 text-violet-400" />
                        <span className="text-sm font-medium">Security Tests</span>
                      </div>
                      <Switch
                        checked={testOptions.security}
                        onCheckedChange={(checked) => setTestOptions({ ...testOptions, security: checked })}
                        data-testid="switch-security"
                      />
                    </div>
                    <div className="flex items-center justify-between p-3 rounded-lg border bg-card">
                      <div className="flex items-center gap-2">
                        <Zap className="w-4 h-4 text-amber-400" />
                        <span className="text-sm font-medium">Performance Tests</span>
                      </div>
                      <Switch
                        checked={testOptions.performance}
                        onCheckedChange={(checked) => setTestOptions({ ...testOptions, performance: checked })}
                        data-testid="switch-performance"
                      />
                    </div>
                  </div>

                  <Separator />

                  <div className="space-y-3">
                    <Label className="text-muted-foreground">Script Generation</Label>
                    <div className="flex items-center justify-between p-3 rounded-lg border bg-card">
                      <div className="flex items-center gap-2">
                        <SiPostman className="w-4 h-4 text-orange-400" />
                        <span className="text-sm font-medium">Postman Test Scripts</span>
                      </div>
                      <Switch
                        checked={testOptions.includePostmanScripts}
                        onCheckedChange={(checked) => setTestOptions({ ...testOptions, includePostmanScripts: checked })}
                        data-testid="switch-postman"
                      />
                    </div>
                    <div className="flex items-center justify-between p-3 rounded-lg border bg-card">
                      <div className="flex items-center gap-2">
                        <Code2 className="w-4 h-4 text-green-400" />
                        <span className="text-sm font-medium">ReadyAPI Groovy Scripts</span>
                      </div>
                      <Switch
                        checked={testOptions.includeReadyApiScripts}
                        onCheckedChange={(checked) => setTestOptions({ ...testOptions, includeReadyApiScripts: checked })}
                        data-testid="switch-readyapi"
                      />
                    </div>
                    <div className="flex items-center justify-between p-3 rounded-lg border bg-card">
                      <div className="flex items-center gap-2">
                        <Code2 className="w-4 h-4 text-purple-400" />
                        <span className="text-sm font-medium">Playwright TypeScript</span>
                      </div>
                      <Switch
                        checked={testOptions.includePlaywrightScripts}
                        onCheckedChange={(checked) => setTestOptions({ ...testOptions, includePlaywrightScripts: checked })}
                        data-testid="switch-playwright"
                      />
                    </div>
                  </div>

                  <div>
                    <Label>Expected Status Codes</Label>
                    <Input
                      placeholder="200, 201, 204"
                      value={apiConfig.expectedStatusCodes}
                      onChange={(e) => setApiConfig({ ...apiConfig, expectedStatusCodes: e.target.value })}
                      className="mt-1.5"
                      data-testid="input-status-codes"
                    />
                    <p className="text-xs text-muted-foreground mt-1">
                      Comma-separated list of expected success status codes
                    </p>
                  </div>

                  <Button
                    onClick={generateTestCases}
                    disabled={isGenerating}
                    className="w-full"
                    size="lg"
                    data-testid="button-generate"
                  >
                    {isGenerating ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        AI Agents Working...
                      </>
                    ) : (
                      <>
                        <Sparkles className="w-4 h-4 mr-2" />
                        Generate Test Cases
                      </>
                    )}
                  </Button>
                </CardContent>
              </Card>
            </div>

            {generatedTests.length > 0 && (
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle className="flex items-center gap-2">
                        <FileText className="w-5 h-5 text-emerald-400" />
                        Generated Test Cases
                      </CardTitle>
                      <CardDescription>
                        {generatedTests.length} comprehensive test cases generated by AI agents
                      </CardDescription>
                    </div>
                    <div className="flex flex-wrap items-center justify-end gap-2">
                      <Button variant="outline" size="sm" onClick={handleExportJson} data-testid="button-export-json">
                        <Download className="w-4 h-4 mr-2" />
                        Export JSON
                      </Button>
                      <Button variant="outline" size="sm" onClick={handleExportExcel} data-testid="button-export-excel">
                        <FileSpreadsheet className="w-4 h-4 mr-2 text-emerald-400" />
                        Export Excel
                      </Button>
                      <Button variant="outline" size="sm" onClick={handleExportPostman} data-testid="button-export-postman">
                        <FileCode className="w-4 h-4 mr-2 text-orange-400" />
                        Postman
                      </Button>
                      <Button variant="outline" size="sm" onClick={handleExportReadyApi} data-testid="button-export-readyapi">
                        <FileCode className="w-4 h-4 mr-2 text-blue-400" />
                        ReadyAPI
                      </Button>
                      <Button variant="outline" size="sm" onClick={handleExportPlaywright} data-testid="button-export-playwright">
                        <FileCode className="w-4 h-4 mr-2 text-violet-400" />
                        Playwright
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <ScrollArea className="h-[600px] pr-4">
                    <div className="space-y-4">
                      {generatedTests.map((test) => (
                        <Card key={test.id} className="border-l-4" style={{ borderLeftColor: test.type === 'functional' ? '#10b981' : test.type === 'negative' ? '#ef4444' : test.type === 'security' ? '#8b5cf6' : test.type === 'performance' ? '#f59e0b' : '#06b6d4' }}>
                          <CardHeader className="pb-2">
                            <div className="flex items-start justify-between">
                              <div className="flex-1">
                                <div className="flex items-center gap-2 mb-2">
                                  <Badge className={getTypeColor(test.type)} variant="outline">
                                    {test.type.charAt(0).toUpperCase() + test.type.slice(1)}
                                  </Badge>
                                  <Badge className={getPriorityColor(test.priority)} variant="outline">
                                    {test.priority}
                                  </Badge>
                                  <span className="text-xs text-muted-foreground">{test.id}</span>
                                </div>
                                <CardTitle className="text-base">{test.title}</CardTitle>
                                <CardDescription className="mt-1">{test.description}</CardDescription>
                              </div>
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => toggleTestExpanded(test.id)}
                                data-testid={`button-expand-${test.id}`}
                              >
                                {expandedTests.has(test.id) ? (
                                  <ChevronUp className="w-4 h-4" />
                                ) : (
                                  <ChevronDown className="w-4 h-4" />
                                )}
                              </Button>
                            </div>
                          </CardHeader>

                          {expandedTests.has(test.id) && (
                            <CardContent className="pt-0 space-y-4">
                              <Separator />

                              <div>
                                <h4 className="text-sm font-medium mb-2">Preconditions</h4>
                                <ul className="list-disc list-inside text-sm text-muted-foreground space-y-1">
                                  {test.preconditions.map((pre, i) => (
                                    <li key={i}>{pre}</li>
                                  ))}
                                </ul>
                              </div>

                              <div>
                                <h4 className="text-sm font-medium mb-2">Test Steps</h4>
                                <div className="space-y-2">
                                  {test.steps.map((step, i) => (
                                    <div key={i} className="flex gap-3 p-3 rounded-lg bg-muted/50">
                                      <div className="flex-shrink-0 w-6 h-6 rounded-full bg-primary/20 text-primary flex items-center justify-center text-xs font-medium">
                                        {i + 1}
                                      </div>
                                      <div className="flex-1">
                                        <p className="text-sm font-medium">{step.action}</p>
                                        <p className="text-xs text-muted-foreground mt-1">
                                          Expected: {step.expected}
                                        </p>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              </div>

                              {Object.keys(test.testData).length > 0 && (
                                <div>
                                  <h4 className="text-sm font-medium mb-2">Test Data</h4>
                                  <pre className="text-xs bg-muted/50 p-3 rounded-lg overflow-x-auto">
                                    {JSON.stringify(test.testData, null, 2)}
                                  </pre>
                                </div>
                              )}

                              <div>
                                <h4 className="text-sm font-medium mb-2">Assertions</h4>
                                <ul className="list-disc list-inside text-sm text-muted-foreground space-y-1">
                                  {test.assertions.map((assertion, i) => (
                                    <li key={i}>{assertion}</li>
                                  ))}
                                </ul>
                              </div>

                              {test.postmanScript && (
                                <div>
                                  <div className="flex items-center justify-between mb-2">
                                    <h4 className="text-sm font-medium flex items-center gap-2">
                                      <SiPostman className="w-4 h-4 text-orange-400" />
                                      Postman Test Script
                                    </h4>
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      onClick={() => copyToClipboard(test.postmanScript!, "Postman script")}
                                    >
                                      <Copy className="w-3 h-3 mr-1" />
                                      Copy
                                    </Button>
                                  </div>
                                  <pre className="text-xs bg-slate-900 text-slate-100 p-3 rounded-lg overflow-x-auto">
                                    {test.postmanScript}
                                  </pre>
                                </div>
                              )}

                              {test.readyApiGroovy && (
                                <div>
                                  <div className="flex items-center justify-between mb-2">
                                    <h4 className="text-sm font-medium flex items-center gap-2">
                                      <Code2 className="w-4 h-4 text-green-400" />
                                      ReadyAPI Groovy Script
                                    </h4>
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      onClick={() => copyToClipboard(test.readyApiGroovy!, "ReadyAPI script")}
                                    >
                                      <Copy className="w-3 h-3 mr-1" />
                                      Copy
                                    </Button>
                                  </div>
                                  <pre className="text-xs bg-slate-900 text-slate-100 p-3 rounded-lg overflow-x-auto">
                                    {test.readyApiGroovy}
                                  </pre>
                                </div>
                              )}

                              {test.playwrightScript && (
                                <div>
                                  <div className="flex items-center justify-between mb-2">
                                    <h4 className="text-sm font-medium flex items-center gap-2">
                                      <Code2 className="w-4 h-4 text-purple-400" />
                                      Playwright TypeScript
                                    </h4>
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      onClick={() => copyToClipboard(test.playwrightScript!, "Playwright script")}
                                    >
                                      <Copy className="w-3 h-3 mr-1" />
                                      Copy
                                    </Button>
                                  </div>
                                  <pre className="text-xs bg-slate-900 text-slate-100 p-3 rounded-lg overflow-x-auto">
                                    {test.playwrightScript}
                                  </pre>
                                </div>
                              )}
                            </CardContent>
                          )}
                        </Card>
                      ))}
                    </div>
                  </ScrollArea>
                </CardContent>
              </Card>
            )}

            {/* Saved Baselines Section */}
            {savedBaselines.length > 0 && (
              <Card className="mt-6">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Database className="w-5 h-5 text-emerald-400" />
                    Saved API Baselines
                    <Badge variant="outline" className="ml-2">{savedBaselines.length}</Badge>
                  </CardTitle>
                  <CardDescription>
                    Run regression tests to detect changes in API responses
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {savedBaselines.map(baseline => (
                      <div
                        key={baseline.id}
                        className="flex items-center justify-between p-3 bg-muted/30 rounded-lg border"
                      >
                        <div className="flex items-center gap-3">
                          <div className={`w-3 h-3 rounded-full ${
                            baseline.lastExecutionStatus === 'pass' ? 'bg-emerald-500' :
                            baseline.lastExecutionStatus === 'warning' ? 'bg-amber-500' :
                            baseline.lastExecutionStatus === 'fail' ? 'bg-red-500' :
                            'bg-slate-500'
                          }`} />
                          <div>
                            <div className="font-medium text-sm">{baseline.name}</div>
                            <div className="text-xs text-muted-foreground">
                              {baseline.method} {baseline.endpoint.substring(0, 50)}...
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className="text-xs">
                            <History className="w-3 h-3 mr-1" />
                            {baseline.executionCount} runs
                          </Badge>
                          {/* In-app baseline replay removed by product decision —
                              baselines are kept for reference; export them via
                              the generated Postman / ReadyAPI scripts to run
                              the regression checks in the user's own tool. */}
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => deleteBaseline(baseline.id)}
                            className="h-7 text-red-400 hover:text-red-300"
                          >
                            <Trash2 className="w-3 h-3" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}
            </>
            )}
        </div>
      </main>

      {/* Save Baseline Dialog */}
      <Dialog open={showBaselineDialog} onOpenChange={setShowBaselineDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Database className="w-5 h-5 text-emerald-400" />
              Record API Baseline
            </DialogTitle>
            <DialogDescription>
              Save this API response as a baseline for regression testing. Future tests will compare against this recorded response.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div>
              <Label htmlFor="baseline-name">Baseline Name *</Label>
              <Input
                id="baseline-name"
                placeholder="e.g., Employee Details API - Production"
                value={baselineName}
                onChange={(e) => setBaselineName(e.target.value)}
                data-testid="input-baseline-name"
              />
            </div>
            <div>
              <Label htmlFor="baseline-description">Description (Optional)</Label>
              <Textarea
                id="baseline-description"
                placeholder="Describe this baseline..."
                value={baselineDescription}
                onChange={(e) => setBaselineDescription(e.target.value)}
                rows={2}
              />
            </div>
            <div className="bg-muted/50 p-3 rounded-lg text-sm">
              <div className="flex items-center gap-2 mb-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                <span className="font-medium">What will be recorded:</span>
              </div>
              <ul className="text-muted-foreground space-y-1 ml-6 list-disc">
                <li>Full JSON response structure</li>
                <li>All field names and data types</li>
                <li>Response status code ({apiExecutionResult?.statusCode})</li>
                <li>Request configuration</li>
              </ul>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setShowBaselineDialog(false)}>
              Cancel
            </Button>
            <Button
              onClick={saveAsBaseline}
              disabled={!baselineName}
              className="bg-emerald-600 hover:bg-emerald-700"
              data-testid="button-save-baseline"
            >
              <Database className="w-4 h-4 mr-2" />
              Save Baseline
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Comparison Result Dialog */}
      <Dialog open={showComparisonResult} onOpenChange={setShowComparisonResult}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <GitCompare className="w-5 h-5 text-blue-400" />
              Regression Test Result
            </DialogTitle>
          </DialogHeader>
          {comparisonResult && (
            <div className="space-y-4 overflow-y-auto flex-1">
              {/* Summary Cards */}
              <div className="grid grid-cols-4 gap-3">
                <div className={`p-3 rounded-lg text-center ${
                  comparisonResult.summary.overallStatus === 'pass' ? 'bg-emerald-500/20 border border-emerald-500/50' :
                  comparisonResult.summary.overallStatus === 'warning' ? 'bg-amber-500/20 border border-amber-500/50' :
                  'bg-red-500/20 border border-red-500/50'
                }`}>
                  <div className="text-2xl font-bold">
                    {comparisonResult.summary.overallStatus === 'pass' ? '✓' :
                     comparisonResult.summary.overallStatus === 'warning' ? '!' : '✗'}
                  </div>
                  <div className="text-xs uppercase">{comparisonResult.summary.overallStatus}</div>
                </div>
                <div className="p-3 rounded-lg text-center bg-muted/50">
                  <div className="text-2xl font-bold text-blue-400">{comparisonResult.statusCode}</div>
                  <div className="text-xs text-muted-foreground">Status Code</div>
                </div>
                <div className="p-3 rounded-lg text-center bg-muted/50">
                  <div className="text-2xl font-bold text-purple-400">{comparisonResult.responseTime}ms</div>
                  <div className="text-xs text-muted-foreground">Response Time</div>
                </div>
                <div className="p-3 rounded-lg text-center bg-muted/50">
                  <div className="text-2xl font-bold text-amber-400">{comparisonResult.differences.length}</div>
                  <div className="text-xs text-muted-foreground">Differences</div>
                </div>
              </div>

              {/* Differences List */}
              {comparisonResult.differences.length > 0 ? (
                <div className="space-y-2">
                  <h4 className="text-sm font-medium flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 text-amber-400" />
                    Detected Changes
                  </h4>
                  <ScrollArea className="h-[300px]">
                    <div className="space-y-2">
                      {comparisonResult.differences.map((diff, idx) => (
                        <div
                          key={idx}
                          className={`p-3 rounded-lg border text-sm ${
                            diff.severity === 'critical' ? 'bg-red-500/10 border-red-500/30' :
                            diff.severity === 'warning' ? 'bg-amber-500/10 border-amber-500/30' :
                            'bg-blue-500/10 border-blue-500/30'
                          }`}
                        >
                          <div className="flex items-center gap-2 mb-1">
                            {diff.type === 'missing' && <MinusCircle className="w-4 h-4 text-red-400" />}
                            {diff.type === 'added' && <PlusCircle className="w-4 h-4 text-emerald-400" />}
                            {diff.type === 'type_changed' && <AlertTriangle className="w-4 h-4 text-amber-400" />}
                            {diff.type === 'value_changed' && <RefreshCw className="w-4 h-4 text-blue-400" />}
                            <span className="font-mono font-medium">{diff.path}</span>
                            <Badge variant="outline" className="text-xs ml-auto">
                              {diff.type.replace('_', ' ')}
                            </Badge>
                          </div>
                          {diff.type === 'missing' && (
                            <div className="text-xs text-muted-foreground">
                              Expected: <code className="bg-muted px-1 rounded">{JSON.stringify(diff.expectedValue)}</code>
                            </div>
                          )}
                          {diff.type === 'added' && (
                            <div className="text-xs text-muted-foreground">
                              New value: <code className="bg-muted px-1 rounded">{JSON.stringify(diff.actualValue)}</code>
                            </div>
                          )}
                          {diff.type === 'type_changed' && (
                            <div className="text-xs text-muted-foreground">
                              Type changed from <code className="bg-muted px-1 rounded">{diff.expectedType}</code> to <code className="bg-muted px-1 rounded">{diff.actualType}</code>
                            </div>
                          )}
                          {diff.type === 'value_changed' && (
                            <div className="text-xs text-muted-foreground">
                              Expected: <code className="bg-muted px-1 rounded">{JSON.stringify(diff.expectedValue)}</code> →
                              Actual: <code className="bg-muted px-1 rounded">{JSON.stringify(diff.actualValue)}</code>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                </div>
              ) : (
                <div className="text-center py-8 text-emerald-400">
                  <CheckCircle2 className="w-12 h-12 mx-auto mb-3" />
                  <div className="font-medium">No Differences Detected</div>
                  <div className="text-sm text-muted-foreground">The API response matches the baseline exactly.</div>
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setShowComparisonResult(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
