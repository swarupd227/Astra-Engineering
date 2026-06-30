import { useState, useEffect, useCallback } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { PageHeader } from "@/components/ui/page-header";
import {
  Sparkles,
  Globe,
  FileText,
  PenLine,
  Upload,
  Link as LinkIcon,
  Lock,
  ChevronDown,
  RefreshCw,
  ArrowLeft,
  Loader2,
  Trash2,
  ChevronRight,
  Play,
  Download,
  CheckCircle2,
  FileCode,
  Brain,
  BookOpen,
  Database,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";

const TEST_FOCUS_OPTIONS = [
  { value: "all", label: "All Interactions" },
  { value: "forms", label: "Forms & Inputs" },
  { value: "navigation", label: "Navigation" },
  { value: "buttons", label: "Buttons & CTA" },
];

const REQUIREMENTS_FORMAT_OPTIONS = [
  { value: "general", label: "General Context" },
  { value: "user-story", label: "User Stories (As a… I want…)" },
  { value: "gherkin", label: "Gherkin (Given/When/Then)" },
  { value: "brd", label: "BRD / Requirements Doc" },
];

const WEBSITE_TYPE_LABELS: Record<string, string> = {
  ecommerce: "E-Commerce",
  banking: "Banking / Finance",
  crm: "CRM",
  hrms: "HR Management",
  "saas-dashboard": "SaaS Dashboard",
  cms: "Content Management",
  booking: "Booking / Reservations",
  healthcare: "Healthcare",
  education: "Education",
  social: "Social Platform",
  generic: "Generic Web App",
};

interface CrawlProgress {
  status: string;
  pagesDiscovered: number;
  domsExtracted: number;
  currentPage?: string;
  totalPages?: number;
  phase?: string;
  message?: string;
  errorMessage?: string;
}

interface DiscoveredPageRow {
  id: string;
  url: string;
  title?: string | null;
  pageType?: string | null;
  routePattern: string;
  depth: number;
  linkCount: number;
  formCount: number;
  elementCount: number;
  domCount: number;
}

interface DomContract {
  pageMeta?: { title?: string; h1?: string; url?: string };
  forms?: Array<{
    name?: string;
    action?: string;
    method?: string;
    formIndex: number;
    fields: Array<{ name?: string; type?: string; required?: boolean; label?: string; selector: string; xpath: string }>;
  }>;
  actions?: Array<{ name?: string; type: string; visibleText?: string; selector: string; xpath: string }>;
}

interface ClassificationResult {
  websiteType: string;
  confidence: "high" | "medium" | "low";
  detectedSignals: string[];
  standardWorkflows: Array<{
    name: string;
    description: string;
    steps: Array<{ action: string; expectedResult: string }>;
  }>;
}

interface ObjectRepoEntry {
  name: string;
  type: string;
  selector: string;
  xpath: string;
  pageUrl: string;
  pageTitle?: string;
  formName?: string;
}

const POLL_INTERVAL_MS = 2500;

export default function AutonomousTestingPage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const urlParams = new URLSearchParams(
    typeof window !== "undefined" ? window.location.search : ""
  );
  const projectId = urlParams.get("projectId");
  const projectName = urlParams.get("projectName");
  const organization = urlParams.get("organization");

  const [appUrl, setAppUrl] = useState("");
  const [testFocus, setTestFocus] = useState("all");
  const [quickSampleMode, setQuickSampleMode] = useState(true);
  const [authOpen, setAuthOpen] = useState(false);
  const [authUrl, setAuthUrl] = useState("");
  const [authUsername, setAuthUsername] = useState("");
  const [authPassword, setAuthPassword] = useState("");

  // Context input state
  const [requirementsFormat, setRequirementsFormat] = useState("general");
  const [requirementsContent, setRequirementsContent] = useState("");
  const [uploadedDocText, setUploadedDocText] = useState("");
  const [contextUrls, setContextUrls] = useState("");
  const [isParsing, setIsParsing] = useState(false);
  const [parsedScenarioCount, setParsedScenarioCount] = useState<number | null>(null);

  // Crawl state
  const [crawlRunId, setCrawlRunId] = useState<string | null>(null);
  const [progress, setProgress] = useState<CrawlProgress | null>(null);
  const [discoveredPages, setDiscoveredPages] = useState<DiscoveredPageRow[]>([]);
  const [liveScreenshot, setLiveScreenshot] = useState<string | null>(null);
  const [selectedPageId, setSelectedPageId] = useState<string | null>(null);
  const [pageDom, setPageDom] = useState<DomContract | null>(null);
  const [domModalOpen, setDomModalOpen] = useState(false);

  // Classification state
  const [classification, setClassification] = useState<ClassificationResult | null>(null);
  const [isClassifying, setIsClassifying] = useState(false);

  // Object repo state
  const [objectRepo, setObjectRepo] = useState<ObjectRepoEntry[] | null>(null);
  const [isLoadingRepo, setIsLoadingRepo] = useState(false);
  const [repoModalOpen, setRepoModalOpen] = useState(false);
  const [isReExtracting, setIsReExtracting] = useState(false);

  // Script/test state
  const [isStarting, setIsStarting] = useState(false);
  const [isClearing, setIsClearing] = useState(false);
  const [isGeneratingScript, setIsGeneratingScript] = useState(false);
  const [isRunningTests, setIsRunningTests] = useState(false);
  const [generatedScript, setGeneratedScript] = useState<{ fileName: string; scriptContent: string } | null>(null);
  const [testResults, setTestResults] = useState<{
    testRunId: string;
    status: string;
    totalTests: number;
    passedCount: number;
    failedCount: number;
    results?: Array<{ caseCode: string; status: string; errorMessage?: string; durationMs?: number }>;
  } | null>(null);

  const handleBack = () => {
    const params = new URLSearchParams();
    if (projectId) params.set("projectId", projectId);
    if (projectName) params.set("projectName", projectName);
    if (organization) params.set("organization", organization);
    const qs = params.toString();
    setLocation(`/sdlc${qs ? `?${qs}` : ""}`);
  };

  const startCrawl = useCallback(async () => {
    if (!appUrl?.trim()) {
      toast({ title: "URL required", description: "Enter an application URL.", variant: "destructive" });
      return;
    }
    setIsStarting(true);
    setClassification(null);
    setObjectRepo(null);
    setParsedScenarioCount(null);
    try {
      const res = await apiRequest("POST", "/api/automated-test/start-crawl", {
        baseUrl: appUrl.trim(),
        userRole: "default",
        mode: quickSampleMode ? "quick" : "complete",
        authentication: authUrl && authUsername && authPassword ? { authUrl, username: authUsername, password: authPassword } : undefined,
        projectId: projectId ?? undefined,
      });
      const data = (await res.json()) as { crawlRunId?: string };
      if (data.crawlRunId) {
        setCrawlRunId(data.crawlRunId);
        setProgress({ status: "running", pagesDiscovered: 0, domsExtracted: 0, phase: "crawling" });
        setDiscoveredPages([]);
        toast({ title: "Crawl started", description: "Page discovery and DOM extraction are running." });
      }
    } catch (e: any) {
      toast({ title: "Failed to start crawl", description: e?.message ?? "Unknown error", variant: "destructive" });
    } finally {
      setIsStarting(false);
    }
  }, [appUrl, quickSampleMode, authUrl, authUsername, authPassword, projectId, toast]);

  useEffect(() => {
    if (!crawlRunId) return;
    let cancelled = false;
    const tick = async () => {
      if (cancelled) return;
      try {
        const res = await apiRequest("GET", `/api/automated-test/crawl-progress/${crawlRunId}`);
        const data = (await res.json()) as CrawlProgress & { status?: string; message?: string };
        if (cancelled) return;
        if (data.status === "not_found") {
          setProgress(null);
          setCrawlRunId(null);
          setDiscoveredPages([]);
          setLiveScreenshot(null);
          toast({ title: "Crawl run not found", description: data.message ?? "It may have been cleared or the server restarted.", variant: "destructive" });
          return true;
        }
        setProgress(data);
        if (data.status === "completed" || data.status === "failed") {
          const listRes = await apiRequest("GET", `/api/automated-test/discovered-pages/${crawlRunId}`);
          const list = (await listRes.json()) as DiscoveredPageRow[];
          setDiscoveredPages(list);
          setLiveScreenshot(null);
          return true;
        }
        const liveRes = await apiRequest("GET", `/api/automated-test/live-view/${crawlRunId}`);
        if (liveRes.ok) {
          const live = (await liveRes.json()) as { screenshotBase64?: string; url?: string };
          if (live.screenshotBase64) setLiveScreenshot(live.screenshotBase64);
        }
        const listRes = await apiRequest("GET", `/api/automated-test/discovered-pages/${crawlRunId}`);
        const list = (await listRes.json()) as DiscoveredPageRow[];
        setDiscoveredPages(list);
      } catch (_) {}
      return false;
    };
    const id = setInterval(async () => {
      const done = await tick();
      if (done) clearInterval(id);
    }, POLL_INTERVAL_MS);
    tick().then((done) => done && clearInterval(id));
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [crawlRunId, toast]);

  const fetchPageDom = useCallback(async (pageId: string) => {
    try {
      const res = await apiRequest("GET", `/api/automated-test/page-dom/${pageId}`);
      const data = (await res.json()) as DomContract;
      setPageDom(data);
      setSelectedPageId(pageId);
      setDomModalOpen(true);
    } catch (e: any) {
      toast({ title: "Failed to load DOM", description: e?.message ?? "Unknown error", variant: "destructive" });
    }
  }, [toast]);

  const classifySite = useCallback(async () => {
    if (!crawlRunId) return;
    setIsClassifying(true);
    try {
      const res = await apiRequest("POST", "/api/automated-test/classify-website", { crawlRunId });
      const data = (await res.json()) as ClassificationResult;
      setClassification(data);
      toast({
        title: "Website classified",
        description: `Detected: ${WEBSITE_TYPE_LABELS[data.websiteType] ?? data.websiteType} (${data.confidence} confidence)`,
      });
    } catch (e: any) {
      toast({ title: "Classification failed", description: e?.message ?? "Unknown error", variant: "destructive" });
    } finally {
      setIsClassifying(false);
    }
  }, [crawlRunId, toast]);

  const loadObjectRepo = useCallback(async () => {
    if (!crawlRunId) return;
    setIsLoadingRepo(true);
    try {
      const res = await apiRequest("GET", `/api/automated-test/object-repo/${crawlRunId}`);
      const data = (await res.json()) as { objects: ObjectRepoEntry[] };
      setObjectRepo(data.objects);
      setRepoModalOpen(true);
    } catch (e: any) {
      toast({ title: "Failed to load object repository", description: e?.message ?? "Unknown error", variant: "destructive" });
    } finally {
      setIsLoadingRepo(false);
    }
  }, [crawlRunId, toast]);

  const reExtractDom = useCallback(async () => {
    if (!crawlRunId) return;
    setIsReExtracting(true);
    try {
      await apiRequest("POST", `/api/automated-test/re-extract-dom/${crawlRunId}`);
      toast({ title: "DOM re-extraction started", description: "Re-extracting page elements in background. Refresh the Object Repository in ~30s." });
    } catch (e: any) {
      toast({ title: "Re-extraction failed", description: e?.message ?? "Unknown error", variant: "destructive" });
    } finally {
      setIsReExtracting(false);
    }
  }, [crawlRunId, toast]);

  const previewRequirements = useCallback(async () => {
    const content = requirementsContent.trim() || uploadedDocText.trim();
    if (!content) {
      toast({ title: "No content", description: "Enter requirements text first.", variant: "destructive" });
      return;
    }
    setIsParsing(true);
    setParsedScenarioCount(null);
    try {
      const res = await apiRequest("POST", "/api/automated-test/parse-requirements", {
        content,
        format: requirementsFormat,
      });
      const data = (await res.json()) as { scenarios?: unknown[] };
      const count = data.scenarios?.length ?? 0;
      setParsedScenarioCount(count);
      toast({ title: "Requirements parsed", description: `Found ${count} testable scenario(s).` });
    } catch (e: any) {
      toast({ title: "Parse failed", description: e?.message ?? "Unknown error", variant: "destructive" });
    } finally {
      setIsParsing(false);
    }
  }, [requirementsContent, uploadedDocText, requirementsFormat, toast]);

  const handleFileUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      setUploadedDocText(text);
      toast({ title: "Document loaded", description: `${file.name} — ready to parse.` });
    };
    reader.readAsText(file);
  }, [toast]);

  const getActiveRequirementsInput = useCallback(() => {
    const content = requirementsContent.trim() || uploadedDocText.trim() || contextUrls.trim();
    if (!content) return undefined;
    return { format: requirementsFormat as any, content };
  }, [requirementsContent, uploadedDocText, contextUrls, requirementsFormat]);

  const generatePlaywrightScript = useCallback(async () => {
    if (!crawlRunId) {
      toast({ title: "Crawl required", description: "Run website crawl before generating scripts.", variant: "destructive" });
      return;
    }
    setIsGeneratingScript(true);
    try {
      await apiRequest("POST", "/api/automated-test/generate-test-cases", {
        crawlRunId,
        useLLM: true,
        testFocus,
        requirementsInput: getActiveRequirementsInput(),
      });
      const scriptRes = await apiRequest("POST", "/api/automated-test/generate-scripts", {
        crawlRunId,
        useLLM: true,
      });
      const scriptData = (await scriptRes.json()) as { fileName?: string; scriptContent?: string };
      setGeneratedScript({
        fileName: scriptData.fileName || "autonomous.spec.ts",
        scriptContent: scriptData.scriptContent || "// Script generated but content was empty.",
      });
      toast({ title: "Playwright script generated", description: "Automation script is ready for review." });
    } catch (e: any) {
      toast({ title: "Failed to generate script", description: e?.message ?? "Unknown error", variant: "destructive" });
    } finally {
      setIsGeneratingScript(false);
    }
  }, [crawlRunId, testFocus, getActiveRequirementsInput, toast]);

  const downloadGeneratedScript = useCallback(() => {
    if (!generatedScript) {
      toast({ title: "No script available", description: "Generate a Playwright script first.", variant: "destructive" });
      return;
    }
    const blob = new Blob([generatedScript.scriptContent], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = generatedScript.fileName || "autonomous.spec.ts";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [generatedScript, toast]);

  const runTestsNow = useCallback(async () => {
    if (!crawlRunId) {
      toast({ title: "Crawl required", description: "Run website crawl before executing tests.", variant: "destructive" });
      return;
    }
    setIsRunningTests(true);
    setTestResults(null);
    try {
      const runRes = await apiRequest("POST", "/api/automated-test/run-tests", { crawlRunId });
      const runData = (await runRes.json()) as {
        testRunId?: string;
        status?: string;
        totalTests?: number;
        passedCount?: number;
        failedCount?: number;
        errorMessage?: string;
      };
      if (runData.status === "failed" && runData.errorMessage) {
        toast({ title: "Test execution failed", description: runData.errorMessage, variant: "destructive" });
        setTestResults({ testRunId: runData.testRunId || "", status: "failed", totalTests: 0, passedCount: 0, failedCount: 0 });
        return;
      }
      let detailedResults: Array<{ caseCode: string; status: string; errorMessage?: string; durationMs?: number }> = [];
      if (runData.testRunId) {
        try {
          const resultsRes = await apiRequest("GET", `/api/automated-test/test-results/${runData.testRunId}`);
          const resultsData = (await resultsRes.json()) as { results?: Array<{ caseCode: string; status: string; errorMessage?: string; durationMs?: number }> };
          detailedResults = resultsData.results || [];
        } catch (_) {}
      }
      const results = {
        testRunId: runData.testRunId || "",
        status: runData.status || "unknown",
        totalTests: runData.totalTests || 0,
        passedCount: runData.passedCount || 0,
        failedCount: runData.failedCount || 0,
        results: detailedResults,
      };
      setTestResults(results);
      toast({
        title: "Test run complete",
        description: `${results.status} | Total: ${results.totalTests} | Passed: ${results.passedCount} | Failed: ${results.failedCount}`,
      });
    } catch (e: any) {
      toast({ title: "Failed to run tests", description: e?.message ?? "Unknown error", variant: "destructive" });
      setTestResults({ testRunId: "", status: "error", totalTests: 0, passedCount: 0, failedCount: 0 });
    } finally {
      setIsRunningTests(false);
    }
  }, [crawlRunId, toast]);

  const clearAll = useCallback(async () => {
    setIsClearing(true);
    try {
      await apiRequest("DELETE", "/api/automated-test/clear-all");
      setCrawlRunId(null);
      setProgress(null);
      setDiscoveredPages([]);
      setLiveScreenshot(null);
      setPageDom(null);
      setDomModalOpen(false);
      setGeneratedScript(null);
      setTestResults(null);
      setClassification(null);
      setObjectRepo(null);
      setParsedScenarioCount(null);
      toast({ title: "Cleared", description: "All automated test data has been cleared." });
    } catch (e: any) {
      toast({ title: "Failed to clear", description: e?.message ?? "Unknown error", variant: "destructive" });
    } finally {
      setIsClearing(false);
    }
  }, [toast]);

  void selectedPageId;

  return (
    <div className="flex-1 space-y-6 p-6">
      <PageHeader
        icon={Sparkles}
        title="Autonomous Testing"
        subtitle="AI-powered test generation — crawl pages, classify site type, fill forms with smart data, and run Playwright scripts"
        color="violet"
      >
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={clearAll} disabled={isClearing}>
            {isClearing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4 mr-2" />}
            Clear all
          </Button>
          <Button variant="ghost" size="sm" onClick={handleBack}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to SDLC
          </Button>
        </div>
      </PageHeader>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Target Configuration */}
        <Card className="rounded-2xl shadow-sm border border-border/40 hover:shadow-md hover:-translate-y-0.5 transition-all duration-300">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-violet-100 dark:bg-violet-950">
                <Globe className="h-4 w-4 text-violet-600 dark:text-violet-400" />
              </span>
              Target Configuration
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="app-url">Application / Website URL</Label>
              <Input
                id="app-url"
                placeholder="https://www.example.com"
                value={appUrl}
                onChange={(e) => setAppUrl(e.target.value)}
                className="bg-background border-border"
              />
            </div>
            <div className="space-y-2">
              <Label>Test Focus</Label>
              <Select value={testFocus} onValueChange={setTestFocus}>
                <SelectTrigger className="bg-background border-border">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TEST_FOCUS_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center justify-between rounded-lg border border-border/40 bg-muted/30 p-3">
              <div>
                <Label htmlFor="quick-sample" className="text-sm font-medium">Quick Sample Mode</Label>
                <p className="text-xs text-muted-foreground mt-0.5">Generates 3 test cases per discovered page</p>
              </div>
              <Switch id="quick-sample" checked={quickSampleMode} onCheckedChange={setQuickSampleMode} />
            </div>
            <Collapsible open={authOpen} onOpenChange={setAuthOpen}>
              <CollapsibleTrigger asChild>
                <Button variant="ghost" className="w-full justify-between rounded-lg border border-border/40 bg-muted/30 px-3 py-2 h-auto">
                  <span className="flex items-center gap-2 text-sm font-medium">
                    <Lock className="h-4 w-4 text-muted-foreground" />
                    Application Authentication
                  </span>
                  <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${authOpen ? "rotate-180" : ""}`} />
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="pt-3 space-y-2">
                  <Label>Auth URL</Label>
                  <Input placeholder="Login page URL" value={authUrl} onChange={(e) => setAuthUrl(e.target.value)} className="bg-background border-border" />
                  <Label>Username</Label>
                  <Input placeholder="Username" value={authUsername} onChange={(e) => setAuthUsername(e.target.value)} className="bg-background border-border" />
                  <Label>Password</Label>
                  <Input type="password" placeholder="Password" value={authPassword} onChange={(e) => setAuthPassword(e.target.value)} className="bg-background border-border" />
                </div>
              </CollapsibleContent>
            </Collapsible>
            <div className="flex gap-2 pt-2">
              <Button className="flex-1" size="default" onClick={startCrawl} disabled={isStarting || !appUrl?.trim()}>
                {isStarting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Sparkles className="h-4 w-4 mr-2" />}
                Start Crawl
              </Button>
              <Button variant="outline" size="icon" title="Run again" onClick={startCrawl} disabled={isStarting}>
                <RefreshCw className="h-4 w-4" />
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Context Input */}
        <Card className="rounded-2xl shadow-sm border border-border/40 hover:shadow-md hover:-translate-y-0.5 transition-all duration-300">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-violet-100 dark:bg-violet-950">
                <FileText className="h-4 w-4 text-violet-600 dark:text-violet-400" />
              </span>
              Context Input
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-2">
              <Label>Input Format</Label>
              <Select value={requirementsFormat} onValueChange={setRequirementsFormat}>
                <SelectTrigger className="bg-background border-border">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {REQUIREMENTS_FORMAT_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Tabs defaultValue="manual" className="w-full">
              <TabsList className="w-full grid grid-cols-3 bg-muted text-muted-foreground">
                <TabsTrigger value="manual" className="gap-2">
                  <PenLine className="h-3.5 w-3.5" />
                  Manual
                </TabsTrigger>
                <TabsTrigger value="documents" className="gap-2">
                  <Upload className="h-3.5 w-3.5" />
                  Document
                </TabsTrigger>
                <TabsTrigger value="urls" className="gap-2">
                  <LinkIcon className="h-3.5 w-3.5" />
                  Context URLs
                </TabsTrigger>
              </TabsList>
              <TabsContent value="manual" className="mt-3 space-y-3">
                <Textarea
                  placeholder={
                    requirementsFormat === "gherkin"
                      ? "Scenario: User logs in\n  Given I am on the login page\n  When I enter valid credentials\n  Then I should see the dashboard"
                      : requirementsFormat === "user-story"
                      ? "As a registered user\nI want to reset my password\nSo that I can regain access to my account"
                      : requirementsFormat === "brd"
                      ? "The system shall allow users to register with email and password.\nThe system shall send a verification email upon registration..."
                      : "Describe business rules, testing requirements, or workflows..."
                  }
                  value={requirementsContent}
                  onChange={(e) => setRequirementsContent(e.target.value)}
                  className="min-h-[160px] bg-background border-border resize-none text-sm"
                />
              </TabsContent>
              <TabsContent value="documents" className="mt-3 space-y-3">
                <div className="space-y-2">
                  <Label htmlFor="doc-upload" className="text-sm">Upload text document (.txt, .md)</Label>
                  <Input id="doc-upload" type="file" accept=".txt,.md,.csv" onChange={handleFileUpload} className="bg-background border-border" />
                </div>
                {uploadedDocText && (
                  <div className="rounded-lg border border-border/40 bg-muted/20 p-3">
                    <p className="text-xs text-muted-foreground">Document loaded — {uploadedDocText.length} characters</p>
                    <p className="text-xs text-foreground mt-1 line-clamp-3 font-mono">{uploadedDocText.slice(0, 200)}…</p>
                  </div>
                )}
              </TabsContent>
              <TabsContent value="urls" className="mt-3 space-y-2">
                <Label className="text-sm">Context source URLs (one per line)</Label>
                <Textarea
                  placeholder="https://confluence.example.com/requirements&#10;https://jira.example.com/browse/PROJ-123"
                  value={contextUrls}
                  onChange={(e) => setContextUrls(e.target.value)}
                  className="min-h-[100px] bg-background border-border resize-none text-sm"
                />
                <p className="text-xs text-muted-foreground">Paste requirement URLs — their context will guide test generation</p>
              </TabsContent>
            </Tabs>
            <div className="flex items-center gap-2 pt-1">
              <Button variant="outline" size="sm" onClick={previewRequirements} disabled={isParsing}>
                {isParsing ? <Loader2 className="h-4 w-4 animate-spin" /> : <BookOpen className="h-4 w-4 mr-1" />}
                Preview Scenarios
              </Button>
              {parsedScenarioCount !== null && (
                <Badge variant="secondary" className="text-xs">
                  {parsedScenarioCount} scenario{parsedScenarioCount !== 1 ? "s" : ""} detected
                </Badge>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Crawl failed */}
      {progress && progress.status === "failed" && progress.errorMessage && (
        <Card className="rounded-2xl shadow-sm border border-border/40">
          <CardContent className="pt-6">
            <p className="text-sm font-medium text-destructive">Crawl failed</p>
            <p className="text-sm text-muted-foreground mt-1 break-words">{progress.errorMessage}</p>
            <p className="text-xs text-muted-foreground mt-2">Check the server terminal for more detail.</p>
          </CardContent>
        </Card>
      )}

      {/* Crawl Progress */}
      {progress && (
        <Card className="rounded-2xl shadow-sm border border-border/40">
          <CardHeader>
            <CardTitle className="text-base">Crawl Progress</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="flex flex-wrap items-center gap-4 text-sm">
              <span className="font-medium">Status: {progress.status}</span>
              <span>Pages: {progress.pagesDiscovered}</span>
              <span>DOMs extracted: {progress.domsExtracted}</span>
              {progress.message && <span className="text-muted-foreground">{progress.message}</span>}
              {progress.errorMessage && <span className="text-destructive">{progress.errorMessage}</span>}
            </div>
            {liveScreenshot && progress.status === "running" && (
              <div className="mt-2">
                <p className="text-xs text-muted-foreground mb-1">Live view</p>
                <img src={`data:image/png;base64,${liveScreenshot}`} alt="Current page" className="rounded-lg border border-border max-h-48 object-contain" />
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Discovered Pages */}
      {discoveredPages.length > 0 && (
        <Card className="rounded-2xl shadow-sm border border-border/40">
          <CardHeader>
            <CardTitle className="text-base">Discovered Pages</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <ScrollArea className="h-[320px]">
              <ul className="divide-y divide-border/40">
                {discoveredPages.map((p) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      className="w-full flex items-center justify-between gap-4 px-6 py-4 text-left hover:bg-muted/30 transition-colors"
                      onClick={() => fetchPageDom(p.id)}
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-foreground truncate">{p.url}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">{p.title || p.routePattern}</p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {p.formCount > 0 && <Badge variant="outline" className="text-xs">{p.formCount} forms</Badge>}
                        <span className="text-sm text-muted-foreground">{p.domCount} DOM</span>
                        <ChevronRight className="h-4 w-4 text-muted-foreground" />
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            </ScrollArea>
          </CardContent>
        </Card>
      )}

      {/* Analysis Complete + AI Tools */}
      {discoveredPages.length > 0 && (
        <Card className="rounded-2xl shadow-sm border border-border/40">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-emerald-600" />
              Analysis Complete
            </CardTitle>
            <p className="text-sm text-muted-foreground">Website crawling and DOM extraction completed. Use the AI tools below to enhance your test generation.</p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="text-center p-4 rounded-xl bg-card border border-border/40">
                <div className="text-2xl font-semibold text-foreground">{discoveredPages.length}</div>
                <div className="text-sm text-muted-foreground">Pages discovered</div>
              </div>
              <div className="text-center p-4 rounded-xl bg-card border border-border/40">
                <div className="text-2xl font-semibold text-foreground">{discoveredPages.reduce((s, p) => s + p.domCount, 0)}</div>
                <div className="text-sm text-muted-foreground">DOM contracts</div>
              </div>
              <div className="text-center p-4 rounded-xl bg-card border border-border/40">
                <div className="text-2xl font-semibold text-foreground">{discoveredPages.reduce((s, p) => s + p.formCount, 0)}</div>
                <div className="text-sm text-muted-foreground">Forms found</div>
              </div>
              <div className="text-center p-4 rounded-xl bg-card border border-border/40">
                <div className="text-2xl font-semibold text-foreground">{discoveredPages.reduce((s, p) => s + p.elementCount, 0)}</div>
                <div className="text-sm text-muted-foreground">Interactive elements</div>
              </div>
            </div>

            {/* AI Enhancement Tools */}
            <div className="border-t border-border/40 pt-4">
              <p className="text-sm font-medium text-foreground mb-3">AI Enhancement Tools</p>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" onClick={classifySite} disabled={isClassifying || !crawlRunId}>
                  {isClassifying ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Brain className="h-4 w-4 mr-2" />}
                  Classify Website Type
                </Button>
                <Button variant="outline" size="sm" onClick={loadObjectRepo} disabled={isLoadingRepo || !crawlRunId}>
                  {isLoadingRepo ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Database className="h-4 w-4 mr-2" />}
                  View Object Repository
                </Button>
                {discoveredPages.reduce((s, p) => s + p.elementCount, 0) === 0 && crawlRunId && (
                  <Button variant="outline" size="sm" onClick={reExtractDom} disabled={isReExtracting}>
                    {isReExtracting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
                    Re-extract DOM
                  </Button>
                )}
              </div>
            </div>

            {/* Classification result */}
            {classification && (
              <div className="rounded-xl border border-border/40 bg-muted/20 p-4 space-y-3">
                <div className="flex items-center gap-3 flex-wrap">
                  <Brain className="h-4 w-4 text-violet-500 shrink-0" />
                  <span className="font-medium text-foreground">
                    {WEBSITE_TYPE_LABELS[classification.websiteType] ?? classification.websiteType}
                  </span>
                  <Badge
                    variant={classification.confidence === "high" ? "default" : "secondary"}
                    className="text-xs"
                  >
                    {classification.confidence} confidence
                  </Badge>
                </div>
                {classification.detectedSignals.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {classification.detectedSignals.map((s, i) => (
                      <Badge key={i} variant="outline" className="text-xs">{s}</Badge>
                    ))}
                  </div>
                )}
                {classification.standardWorkflows.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Standard Workflows Detected</p>
                    {classification.standardWorkflows.map((w, i) => (
                      <div key={i} className="rounded-lg border border-border/40 bg-background p-3 space-y-1">
                        <p className="text-sm font-medium text-foreground">{w.name}</p>
                        <p className="text-xs text-muted-foreground">{w.description}</p>
                        <ol className="text-xs text-muted-foreground space-y-0.5 list-decimal list-inside">
                          {w.steps.map((s, si) => (
                            <li key={si}>{s.action}</li>
                          ))}
                        </ol>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Playwright Script Generator */}
      {discoveredPages.length > 0 && (
        <Card className="rounded-2xl shadow-sm border border-border/40">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <FileCode className="h-5 w-5 text-cyan-600" />
              Playwright Script Generator
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              Generates test cases using your requirements input, website type context, and smart form data (powered by the synthetic data engine).
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-2">
              <Button onClick={generatePlaywrightScript} disabled={isGeneratingScript || !crawlRunId}>
                {isGeneratingScript ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Play className="h-4 w-4 mr-2" />}
                Generate Playwright Script
              </Button>
              <Button variant="outline" onClick={downloadGeneratedScript} disabled={!generatedScript}>
                <Download className="h-4 w-4 mr-2" />
                Download
              </Button>
              <Button variant="secondary" onClick={runTestsNow} disabled={isRunningTests || !crawlRunId}>
                {isRunningTests ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Play className="h-4 w-4 mr-2" />}
                Run Tests Now
              </Button>
            </div>
            {(requirementsContent.trim() || uploadedDocText.trim()) && (
              <div className="flex items-center gap-2 rounded-lg border border-violet-200 dark:border-violet-800 bg-violet-50 dark:bg-violet-950/30 px-3 py-2 text-xs text-violet-700 dark:text-violet-400">
                <BookOpen className="h-3.5 w-3.5 shrink-0" />
                Requirements ({REQUIREMENTS_FORMAT_OPTIONS.find(f => f.value === requirementsFormat)?.label}) will be used to guide test generation
                {parsedScenarioCount !== null && ` — ${parsedScenarioCount} scenario(s) detected`}
              </div>
            )}
            {classification && classification.websiteType !== "generic" && (
              <div className="flex items-center gap-2 rounded-lg border border-violet-200 dark:border-violet-800 bg-violet-50 dark:bg-violet-950/30 px-3 py-2 text-xs text-violet-700 dark:text-violet-400">
                <Brain className="h-3.5 w-3.5 shrink-0" />
                {WEBSITE_TYPE_LABELS[classification.websiteType]} workflows will be applied to test generation
              </div>
            )}
            {generatedScript && (
              <div className="space-y-2">
                <p className="text-sm font-medium text-foreground">{generatedScript.fileName}</p>
                <Textarea
                  value={generatedScript.scriptContent}
                  readOnly
                  className="min-h-[280px] font-mono text-xs bg-background border-border"
                />
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Test Results */}
      {testResults && (
        <Card className="rounded-2xl shadow-sm border border-border/40 border-l-[3px] border-l-emerald-500">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-emerald-600" />
              Test Results
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {[
                { label: "Total Tests", value: testResults.totalTests },
                { label: "Passed", value: testResults.passedCount },
                { label: "Failed", value: testResults.failedCount },
                { label: "Status", value: testResults.status },
              ].map(({ label, value }) => (
                <div key={label} className="text-center p-4 rounded-xl bg-card border border-border/40">
                  <div className="text-2xl font-semibold text-foreground">{value}</div>
                  <div className="text-sm text-muted-foreground">{label}</div>
                </div>
              ))}
            </div>
            {testResults.results && testResults.results.length > 0 && (
              <div className="space-y-2">
                <h4 className="font-medium text-foreground">Detailed Results</h4>
                <ScrollArea className="h-[200px] rounded-lg border border-border/40">
                  <div className="p-3 space-y-2">
                    {testResults.results.map((result, i) => (
                      <div key={i} className="flex items-center gap-3 p-2 rounded-md bg-muted/30">
                        <div className={`w-2 h-2 rounded-full flex-shrink-0 ${result.status === "passed" ? "bg-green-500" : "bg-red-500"}`} />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <Badge variant="secondary" className="font-mono text-xs">{result.caseCode}</Badge>
                            <span className={`text-sm font-medium ${result.status === "passed" ? "text-green-700 dark:text-green-400" : "text-red-700 dark:text-red-400"}`}>
                              {result.status}
                            </span>
                            {result.durationMs && <span className="text-xs text-muted-foreground">{result.durationMs}ms</span>}
                          </div>
                          {result.errorMessage && (
                            <p className="text-xs text-red-600 dark:text-red-400 mt-1 truncate" title={result.errorMessage}>
                              {result.errorMessage}
                            </p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* DOM Contract Modal */}
      <Dialog open={domModalOpen} onOpenChange={setDomModalOpen}>
        <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>DOM Contract</DialogTitle>
          </DialogHeader>
          {pageDom && (
            <ScrollArea className="flex-1 pr-4">
              <div className="space-y-4 text-sm">
                {pageDom.pageMeta && (
                  <div>
                    <h4 className="font-medium text-foreground mb-1">Page</h4>
                    <p className="text-muted-foreground">{pageDom.pageMeta.title} — {pageDom.pageMeta.url}</p>
                  </div>
                )}
                {pageDom.forms && pageDom.forms.length > 0 && (
                  <div>
                    <h4 className="font-medium text-foreground mb-2">Forms</h4>
                    <ul className="space-y-3">
                      {pageDom.forms.map((form, i) => (
                        <li key={i} className="rounded-lg border border-border/40 p-3 bg-muted/20">
                          <p className="font-medium">{form.name || `Form ${form.formIndex}`} {form.method && `(${form.method})`}</p>
                          <ul className="mt-2 space-y-1 text-muted-foreground">
                            {form.fields?.map((f, j) => (
                              <li key={j} className="flex flex-wrap gap-2">
                                <span>{f.name || f.type || "field"}</span>
                                <code className="text-xs bg-muted px-1 rounded">{f.selector}</code>
                                <code className="text-xs bg-muted px-1 rounded">{f.xpath}</code>
                              </li>
                            ))}
                          </ul>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {pageDom.actions && pageDom.actions.length > 0 && (
                  <div>
                    <h4 className="font-medium text-foreground mb-2">Actions</h4>
                    <ul className="space-y-1">
                      {pageDom.actions.map((a, i) => (
                        <li key={i} className="flex flex-wrap gap-2 items-center">
                          <span>{a.visibleText || a.type}</span>
                          <code className="text-xs bg-muted px-1 rounded">{a.selector}</code>
                          <code className="text-xs bg-muted px-1 rounded">{a.xpath}</code>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </ScrollArea>
          )}
        </DialogContent>
      </Dialog>

      {/* Object Repository Modal */}
      <Dialog open={repoModalOpen} onOpenChange={setRepoModalOpen}>
        <DialogContent className="max-w-3xl max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Database className="h-5 w-5 text-violet-500" />
              Object Repository ({objectRepo?.length ?? 0} elements)
            </DialogTitle>
          </DialogHeader>
          {objectRepo && (
            <ScrollArea className="h-[60vh] pr-4">
              <div className="space-y-2 text-sm">
                {objectRepo.map((obj, i) => (
                  <div key={i} className="rounded-lg border border-border/40 p-3 bg-muted/20 space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-foreground">{obj.name}</span>
                      <Badge variant="outline" className="text-xs">{obj.type}</Badge>
                      {obj.formName && <Badge variant="secondary" className="text-xs">{obj.formName}</Badge>}
                    </div>
                    <p className="text-xs text-muted-foreground truncate" title={obj.pageUrl}>{obj.pageUrl}</p>
                    <div className="flex flex-wrap gap-2">
                      <code className="text-xs bg-muted px-1.5 py-0.5 rounded">{obj.selector}</code>
                      <code className="text-xs bg-muted px-1.5 py-0.5 rounded">{obj.xpath}</code>
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
