import { useEffect, useState } from "react";
import { GenericModal } from "@/components/ui/generic-modal";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  TestTube,
  RefreshCw,
  CheckCircle2,
  XCircle,
  Clock,
  AlertTriangle,
  Download,
  FileText,
  TrendingUp,
  TrendingDown,
  BarChart3,
  GitCompare,
  Sparkles,
  Activity,
  Layers,
  Target,
  PlayCircle,
  Image as ImageIcon,
  Video,
  FileCode,
  Zap,
  Brain,
  AlertCircle,
  Filter,
  Calendar,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { getApiUrl } from "@/lib/api-config";
import { useQuery } from "@tanstack/react-query";
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Cell } from "recharts";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";

interface ADOProject {
  id: string;
  name: string;
  organization: string;
  organizationUrl: string;
}

interface TestReportsModalProps {
  projectId: string;
  adoProject?: ADOProject;
  open: boolean;
  onClose: () => void;
  providerSegment?: string;
}

interface TestRun {
  id: number;
  name: string;
  state: string;
  startedDate: string;
  completedDate?: string;
  totalTests?: number;
  passedTests?: number;
  failedTests?: number;
  skippedTests?: number;
  passed?: number;
  failed?: number;
  skipped?: number;
  total?: number;
  runStatistics?: Array<{
    state: string;
    outcome: string;
    count: number;
  }>;
  duration?: number;
  build?: {
    id: number;
    buildNumber: string;
  };
}

interface TestResult {
  id: number;
  testCase?: {
    name: string;
  };
  testCaseTitle?: string;
  testCaseName?: string;
  outcome?: string;
  state?: string;
  errorMessage?: string;
  stackTrace?: string;
  durationInMs?: number;
  duration?: number;
  associatedWorkItems?: Array<{ id: number; name: string }>;
  attachments?: Array<{ id: number; name: string; url: string }>;
  // AI suggestions fields
  probableCause?: string;
  suggestions?: string[];
  codeHints?: string;
  frequentFailureReason?: string;
  retrySuggestions?: string;
}

interface FlakyTest {
  testName: string;
  passRate: number;
  totalRuns: number;
  failedRuns: number;
  trend: Array<{ run: number; passed: boolean }>;
}

interface FailureCategory {
  type: string;
  count: number;
  tests: string[];
}

export function TestReportsModal({ projectId, adoProject, open, onClose, providerSegment = "ado" }: TestReportsModalProps) {
  const isAdo = providerSegment === "ado";
  const { toast } = useToast();
  const [selectedTab, setSelectedTab] = useState("overview");
  const [selectedRunId, setSelectedRunId] = useState<number | null>(null);
  const [comparisonRun1, setComparisonRun1] = useState<number | null>(null);
  const [comparisonRun2, setComparisonRun2] = useState<number | null>(null);
  const [selectedFailedTest, setSelectedFailedTest] = useState<TestResult | null>(null);
  const [selectedSprintPath, setSelectedSprintPath] = useState<string | null>(null);

  // Build query params for ADO project info
  const params = new URLSearchParams();
  if (adoProject?.organization) {
    params.append('organization', adoProject.organization);
  }
  if (adoProject?.name) {
    params.append('projectName', adoProject.name);
  }
  const queryString = params.toString();

  // Fetch ADO config
  const { data: adoConfig, error: configError } = useQuery<{ hasConfig: boolean; organization: string; project: string }>({
    queryKey: [`/api/sdlc/projects/${projectId}/ado-config`, queryString],
    queryFn: async () => {
      const configUrl = getApiUrl(`/api/sdlc/projects/${projectId}/ado-config${queryString ? `?${queryString}` : ''}`);
      const configRes = await fetch(configUrl, { credentials: "include" });

      if (!configRes.ok) {
        throw new Error(`Configuration check failed: ${configRes.status} ${configRes.statusText}`);
      }

      const contentType = configRes.headers.get("content-type");
      if (!contentType || !contentType.includes("application/json")) {
        throw new Error("Server returned invalid response. Please check if the server is running correctly.");
      }

      return configRes.json();
    },
    enabled: open && !!projectId,
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
    retry: 1,
  });

  const hasAdoConfig = adoConfig?.hasConfig || false;

  // Fetch all sprints
  const { data: allSprints = [] } = useQuery<Array<{
    id: string;
    name: string;
    path: string;
    startDate?: string;
    endDate?: string;
    timeFrame?: string;
  }>>({
    queryKey: [
      "/api/sdlc/projects",
      projectId,
      "ado/sprints",
      adoProject?.organization,
      adoProject?.name,
    ],
    queryFn: async () => {
      if (!hasAdoConfig) {
        return [];
      }

      const sprintsUrl = getApiUrl(
        `/api/sdlc/projects/${projectId}/ado/sprints${
          queryString ? `?${queryString}` : ""
        }`
      );
      const sprintsRes = await fetch(sprintsUrl, { credentials: "include" });

      if (!sprintsRes.ok) {
        const errorText = await sprintsRes.text();
        console.warn(`[TestReportsModal] Failed to fetch sprints: ${sprintsRes.status}`, errorText);
        return [];
      }

      const sprints = await sprintsRes.json();
      return sprints;
    },
    enabled: open && !!projectId && hasAdoConfig,
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
    retry: 1,
  });

  // Reset sprint selection when modal closes
  useEffect(() => {
    if (!open) {
      setSelectedSprintPath(null);
    }
  }, [open]);

  // Fetch test runs
  const { data: testRunsData, isLoading: loadingTests, isFetching: fetchingTests, refetch: refetchTests } = useQuery<{ value: TestRun[] }>({
    queryKey: [`/api/sdlc/projects/${projectId}/ado/test-runs`, queryString, selectedSprintPath],
    queryFn: async () => {
      if (!hasAdoConfig) return { value: [] };
      const testQuery = new URLSearchParams(queryString);
      if (selectedSprintPath) {
        // URL encode the sprint path to handle special characters like backslashes
        // URLSearchParams.set() already handles encoding, so we don't need encodeURIComponent
        testQuery.set('sprintPath', selectedSprintPath);
      }
      const url = getApiUrl(`/api/sdlc/projects/${projectId}/ado/test-runs${testQuery.toString() ? `?${testQuery.toString()}` : ''}`);
      console.log(`[TestReportsModal] Fetching test runs with sprint: ${selectedSprintPath}, URL: ${url}`);
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) {
        if (res.status === 404) return { value: [] };
        throw new Error(`Failed to fetch test runs: ${res.status}`);
      }
      return res.json();
    },
    enabled: open && !!projectId && hasAdoConfig,
    staleTime: 2 * 60 * 1000,
    retry: 1,
  });

  // Fetch detailed test results for selected run
  const { data: testResultsData, isLoading: loadingTestResults } = useQuery<{ value: TestResult[] }>({
    queryKey: [`/api/sdlc/projects/${projectId}/ado/test-results`, selectedRunId, queryString],
    queryFn: async () => {
      if (!selectedRunId || !hasAdoConfig) return { value: [] };
      const url = getApiUrl(`/api/sdlc/projects/${projectId}/ado/test-results/${selectedRunId}${queryString ? `?${queryString}` : ''}`);
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) {
        console.error('Failed to fetch test results:', res.status, res.statusText);
        return { value: [] };
      }
      const data = await res.json();
      console.log('Test results fetched:', data.value?.length || 0, 'results');
      return data;
    },
    enabled: open && !!projectId && hasAdoConfig && !!selectedRunId,
    staleTime: 2 * 60 * 1000,
  });

  useEffect(() => {
    if (configError) {
      toast({
        title: "Error",
        description: configError instanceof Error ? configError.message : "Failed to fetch ADO configuration",
        variant: "destructive",
      });
    }
  }, [configError, toast]);

  const handleRefresh = async () => {
    await refetchTests();
  };

  const testRuns = testRunsData?.value || [];
  const testResults = testResultsData?.value || [];

  // Helper function to get test counts from a run (handles different field names)
  const getTestCounts = (run: TestRun) => {
    // Try different field name variations - check both camelCase and the actual field names
    let total = run.totalTests || run.total || 0;
    let passed = run.passedTests || run.passed || 0;
    let failed = run.failedTests || run.failed || 0;
    let skipped = run.skippedTests || run.skipped || 0;
    
    // If runStatistics is available, calculate from it (this is the most reliable source)
    if (run.runStatistics && Array.isArray(run.runStatistics) && run.runStatistics.length > 0) {
      const stats = run.runStatistics;
      const statsTotal = stats.reduce((sum: number, s: any) => sum + (s.count || 0), 0);
      const statsPassed = stats.find((s: any) => 
        s.outcome === 'Passed' || s.outcome === 'passed'
      )?.count || 0;
      const statsFailed = stats.find((s: any) => 
        s.outcome === 'Failed' || s.outcome === 'failed'
      )?.count || 0;
      const statsSkipped = stats.find((s: any) => 
        s.outcome === 'NotExecuted' || 
        s.outcome === 'notExecuted' || 
        s.outcome === 'Skipped' || 
        s.outcome === 'skipped'
      )?.count || 0;
      
      // Use statistics if they exist, otherwise use the direct fields
      total = statsTotal || total;
      passed = statsPassed || passed;
      failed = statsFailed || failed;
      skipped = statsSkipped || skipped;
    }
    
    // Also check if the run has a statistics object
    const runAny = run as any;
    if (runAny.statistics) {
      const stats = runAny.statistics;
      total = stats.total || total;
      passed = stats.passed || passed;
      failed = stats.failed || failed;
      skipped = stats.skipped || skipped;
    }
    
    // If we have total and passed but failed/skipped don't add up, calculate the difference
    // This handles cases where Azure DevOps doesn't explicitly report failed/skipped counts
    if (total > 0 && passed >= 0) {
      const calculatedTotal = passed + failed + skipped;
      // If the sum doesn't match total, adjust failed to account for the difference
      if (calculatedTotal < total) {
        // Missing tests - assume they're failed
        failed = total - passed - skipped;
      } else if (calculatedTotal > total) {
        // More than total - something's wrong, but don't adjust
        // Keep the values as they are
      }
      // If calculatedTotal === total, everything is accounted for
    }
    
    return { total, passed, failed, skipped };
  };

  // Calculate statistics
  const totalPassed = testRuns.reduce((sum, run) => sum + getTestCounts(run).passed, 0);
  const totalFailed = testRuns.reduce((sum, run) => sum + getTestCounts(run).failed, 0);
  const totalSkipped = testRuns.reduce((sum, run) => sum + getTestCounts(run).skipped, 0);
  const totalTests = testRuns.reduce((sum, run) => sum + getTestCounts(run).total, 0);

  // Feature 4: Pass/Fail Trend Data
  const trendData = testRuns
    .slice(-30) // Last 30 runs
    .map((run, index) => {
      const counts = getTestCounts(run);
      const date = run.startedDate ? new Date(run.startedDate) : null;
      return {
        run: index + 1,
        runLabel: date ? date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : `Run ${index + 1}`,
        name: run.name,
        passed: counts.passed,
        failed: counts.failed,
        passRate: counts.total > 0 ? Math.round((counts.passed / counts.total) * 100) : 0,
        date: date ? date.toLocaleDateString() : '',
        fullDate: date ? date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '',
      };
    });

  // Feature 5: Test Duration Analytics
  const durationData = testRuns
    .filter(run => run.duration)
    .sort((a, b) => (b.duration || 0) - (a.duration || 0))
    .slice(0, 10)
    .map(run => ({
      name: run.name.substring(0, 30) + (run.name.length > 30 ? '...' : ''),
      duration: run.duration ? Math.round(run.duration / 1000) : 0, // Convert to seconds
    }));

  // Feature 6: Failure Categories
  const failureCategories: FailureCategory[] = testResults
    .filter(r => {
      const outcome = (r.outcome || r.state || '').toLowerCase();
      return (outcome === 'failed' || outcome === 'failure') && r.errorMessage;
    })
    .reduce((acc: FailureCategory[], result) => {
      const errorMsg = result.errorMessage || '';
      const testName = result.testCase?.name || result.testCaseTitle || result.testCaseName || 'Unknown Test';
      let category = 'Other';
      
      if (errorMsg.includes('Timeout') || errorMsg.includes('timeout')) {
        category = 'TimeoutException';
      } else if (errorMsg.includes('Assertion') || errorMsg.includes('assert')) {
        category = 'AssertionError';
      } else if (errorMsg.includes('NullPointer') || errorMsg.includes('null')) {
        category = 'NullPointerException';
      } else if (errorMsg.includes('Network') || errorMsg.includes('HTTP') || errorMsg.includes('Connection')) {
        category = 'Network/HTTP Error';
      }
      
      const existing = acc.find(c => c.type === category);
      if (existing) {
        existing.count++;
        if (!existing.tests.includes(testName)) {
          existing.tests.push(testName);
        }
      } else {
        acc.push({ type: category, count: 1, tests: [testName] });
      }
      return acc;
    }, []);

  // Feature 3: Flaky Test Detection
  const detectFlakyTests = (): FlakyTest[] => {
    // Group test results by test name across all runs
    const testHistory = new Map<string, Array<{ runId: number; passed: boolean }>>();
    
    testRuns.forEach(run => {
      // This would need detailed results per run - simplified for now
      // In real implementation, we'd fetch results for each run
    });
    
    return [];
  };

  // Feature 9: Stability Score per Test Suite
  const calculateStabilityScore = (run: TestRun): number => {
    const counts = getTestCounts(run);
    if (counts.total === 0) return 0;
    const passRate = (counts.passed / counts.total) * 100;
    // Simplified - in real implementation, factor in flaky penalty
    return Math.round(passRate);
  };

  const getStatusIcon = (state: string, failedTests: number) => {
    if (state === "inProgress") return <Clock className="h-4 w-4 text-blue-600" />;
    if (failedTests > 0) return <XCircle className="h-4 w-4 text-red-600" />;
    return <CheckCircle2 className="h-4 w-4 text-green-600" />;
  };

  const getStatusColor = (state: string, failedTests: number) => {
    if (state === "inProgress") return "bg-blue-500";
    if (failedTests > 0) return "bg-red-500";
    return "bg-green-500";
  };

  const getStatusText = (state: string, failedTests: number) => {
    // If there are failed tests, show "Failed" regardless of state
    if (failedTests > 0) return "Failed";
    // Otherwise show the actual state
    return state;
  };

  const formatDate = (dateString: string) => {
    if (!dateString) return "N/A";
    return new Date(dateString).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  // Feature 1: Download handlers
  const handleDownload = async (format: 'pdf' | 'excel' | 'csv' | 'json') => {
    try {
      const url = getApiUrl(`/api/sdlc/projects/${projectId}/ado/test-reports/export?format=${format}${queryString ? `&${queryString}` : ''}`);
      
      if (format === 'pdf') {
        // For PDF, open in new window for printing
        const newWindow = window.open(url, '_blank');
        if (!newWindow) {
          toast({
            title: "Error",
            description: "Please allow popups to download PDF",
            variant: "destructive",
          });
        } else {
          toast({
            title: "Success",
            description: "PDF report opened in new window. Use browser print to save as PDF.",
          });
        }
        return;
      }
      
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error('Export failed');
      
      const blob = await res.blob();
      const downloadUrl = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = downloadUrl;
      // Excel is actually CSV format, so use .csv extension
      const extension = format === 'excel' ? 'csv' : format;
      a.download = `test-report-${Date.now()}.${extension}`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(downloadUrl);
      document.body.removeChild(a);
      
      toast({
        title: "Success",
        description: `Test report downloaded as ${format === 'excel' ? 'CSV' : format.toUpperCase()}`,
      });
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to download test report",
        variant: "destructive",
      });
    }
  };

  // Feature 2: AI Fix Suggestions
  const handleGetAISuggestions = async (testResult: TestResult) => {
    try {
      const url = getApiUrl(`/api/sdlc/projects/${projectId}/ado/test-results/ai-suggestions${queryString ? `?${queryString}` : ''}`);
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: "include",
        body: JSON.stringify({
          testName: testResult.testCase?.name || testResult.testCaseTitle || testResult.testCaseName || 'Unknown Test',
          errorMessage: testResult.errorMessage || 'No error message available',
          stackTrace: testResult.stackTrace || '',
        }),
      });
      
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({ error: `HTTP ${res.status}: ${res.statusText}` }));
        throw new Error(errorData.error || 'AI suggestion failed');
      }
      
      const data = await res.json();
      return data;
    } catch (error: any) {
      console.error('AI suggestion error:', error);
      const errorMessage = error?.message || error?.error || "Failed to get AI suggestions. Please check if AI is configured.";
      toast({
        title: "Error",
        description: errorMessage,
        variant: "destructive",
      });
      return null;
    }
  };

  // Feature 10: Re-run failed tests
  const handleRerunFailedTests = async (runId: number) => {
    try {
      const url = getApiUrl(`/api/sdlc/projects/${projectId}/ado/test-runs/${runId}/rerun-failed${queryString ? `?${queryString}` : ''}`);
      const res = await fetch(url, {
        method: 'POST',
        credentials: "include",
      });
      if (!res.ok) throw new Error('Rerun failed');
      toast({
        title: "Success",
        description: "Failed tests rerun initiated",
      });
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to rerun tests",
        variant: "destructive",
      });
    }
  };

  return (
    <GenericModal
      open={open}
      onOpenChange={onClose}
      title="Test Reports"
      description="View test runs, results, and automated test summaries"
      icon={TestTube}
      iconClassName="bg-gradient-to-br from-green-500 to-green-600"
      fullScreen={true}
      contentClassName="space-y-4"
      headerActions={
        <div className="flex items-center gap-2">
          <Select
            value={selectedSprintPath || "all"}
            onValueChange={(value) => {
              if (value === "all") {
                setSelectedSprintPath(null);
              } else {
                setSelectedSprintPath(value);
              }
            }}
          >
            <SelectTrigger className="w-[220px]">
              <SelectValue placeholder="Choose Sprint">
                {selectedSprintPath && allSprints.length > 0
                  ? allSprints.find(s => s.path === selectedSprintPath)?.name || "All Sprints"
                  : "All Sprints"}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {allSprints.length > 0 ? (
                <>
                  <SelectItem value="all">
                    <div className="flex flex-col">
                      <span>All Sprints</span>
                    </div>
                  </SelectItem>
                  {allSprints.map((sprint) => (
                    <SelectItem key={sprint.path} value={sprint.path}>
                      <div className="flex flex-col">
                        <span>{sprint.name}</span>
                        {sprint.startDate && sprint.endDate && (
                          <span className="text-xs text-muted-foreground">
                            {new Date(sprint.startDate).toLocaleDateString()} - {new Date(sprint.endDate).toLocaleDateString()}
                          </span>
                        )}
                      </div>
                    </SelectItem>
                  ))}
                </>
              ) : (
                <div className="px-2 py-1.5 text-sm text-muted-foreground">
                  No sprints available
                </div>
              )}
            </SelectContent>
          </Select>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleRefresh}
            disabled={fetchingTests}
            className="h-8 w-8 p-0 flex items-center justify-center"
            aria-label="Refresh test reports"
          >
            <RefreshCw className={`h-4 w-4 ${fetchingTests ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      }
    >
      {/* Action Buttons */}
      <div className="flex justify-end items-center gap-2 -mt-2 mb-4">
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="sm"
            onClick={() => handleDownload('pdf')}
            className="h-8"
          >
            <Download className="h-4 w-4 mr-1" />
            PDF
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => handleDownload('excel')}
            className="h-8"
          >
            <Download className="h-4 w-4 mr-1" />
            Excel
          </Button>
        </div>
      </div>

        {!isAdo || !hasAdoConfig ? (
          <Card className="mt-6">
            <CardContent className="pt-6">
              <div className="text-center space-y-4">
                <AlertTriangle className="h-12 w-12 text-yellow-500 mx-auto" />
                <h3 className="text-lg font-semibold">No Data Available</h3>
                <p className="text-muted-foreground">
                  No data is available for this metric at the moment.
                </p>
              </div>
            </CardContent>
          </Card>
        ) : (
          <Tabs value={selectedTab} onValueChange={setSelectedTab} className="flex-1 flex flex-col overflow-hidden">
            <TabsList className="grid w-full grid-cols-7">
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="details">Details</TabsTrigger>
              <TabsTrigger value="trends">Trends</TabsTrigger>
              <TabsTrigger value="analytics">Analytics</TabsTrigger>
              <TabsTrigger value="comparison">Compare</TabsTrigger>
              <TabsTrigger value="flaky">Flaky Tests</TabsTrigger>
              <TabsTrigger value="failures">Failures</TabsTrigger>
            </TabsList>

            <ScrollArea className="flex-1 overflow-y-auto mt-4">
              <div className="flex flex-col space-y-6 pr-4">
                {/* Overview Tab */}
                <TabsContent value="overview" className="space-y-6 mt-0">
                  {/* Key Metrics - Total Test Cases Executed, Passed, Failed, Blocked/Skipped, Pass Percentage */}
                  {testRuns.length > 0 && (
                    <>
                      <div className="grid grid-cols-5 gap-4">
                        <Card>
                          <CardHeader className="pb-3">
                            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                              <TestTube className="h-4 w-4 text-blue-600" />
                              Total Test Runs
                            </CardTitle>
                          </CardHeader>
                          <CardContent>
                            <div className="text-4xl font-bold text-blue-600">{testRuns.length}</div>
                          </CardContent>
                        </Card>
                        <Card>
                          <CardHeader className="pb-3">
                            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                              <Activity className="h-4 w-4 text-purple-600" />
                              Total Test Cases
                            </CardTitle>
                          </CardHeader>
                          <CardContent>
                            <div className="text-4xl font-bold text-purple-600">{totalTests}</div>
                            <p className="text-xs text-muted-foreground mt-1">Executed</p>
                          </CardContent>
                        </Card>
                        <Card>
                          <CardHeader className="pb-3">
                            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                              <CheckCircle2 className="h-4 w-4 text-green-600" />
                              Passed
                            </CardTitle>
                          </CardHeader>
                          <CardContent>
                            <div className="text-4xl font-bold text-green-600">{totalPassed}</div>
                            <p className="text-xs text-muted-foreground mt-1">of {totalTests} tests</p>
                          </CardContent>
                        </Card>
                        <Card>
                          <CardHeader className="pb-3">
                            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                              <XCircle className="h-4 w-4 text-red-600" />
                              Failed
                            </CardTitle>
                          </CardHeader>
                          <CardContent>
                            <div className="text-4xl font-bold text-red-600">{totalFailed}</div>
                            <p className="text-xs text-muted-foreground mt-1">of {totalTests} tests</p>
                          </CardContent>
                        </Card>
                        <Card>
                          <CardHeader className="pb-3">
                            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                              <Clock className="h-4 w-4 text-amber-600" />
                              Blocked/Skipped
                            </CardTitle>
                          </CardHeader>
                          <CardContent>
                            <div className="text-4xl font-bold text-amber-600">{totalSkipped}</div>
                            <p className="text-xs text-muted-foreground mt-1">of {totalTests} tests</p>
                          </CardContent>
                        </Card>
                      </div>
                      
                      {/* Test Pass Percentage and Historical Trends - Side by Side */}
                      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                        {/* Test Pass Percentage */}
                        <Card>
                          <CardHeader>
                            <CardTitle className="text-base flex items-center gap-2">
                              <Target className="h-5 w-5 text-green-600" />
                              Test Pass Percentage
                            </CardTitle>
                          </CardHeader>
                          <CardContent>
                            <div className="flex items-center justify-between">
                              <div>
                                <div className="text-5xl font-bold text-green-600">
                                  {totalTests > 0 ? Math.round((totalPassed / totalTests) * 100) : 0}%
                                </div>
                                <p className="text-sm text-muted-foreground mt-2">
                                  {totalPassed} passed out of {totalTests} total test cases
                                </p>
                              </div>
                              <div className="w-32 h-32 relative">
                                <svg className="w-32 h-32 transform -rotate-90">
                                  <circle
                                    cx="64"
                                    cy="64"
                                    r="56"
                                    stroke="currentColor"
                                    strokeWidth="8"
                                    fill="none"
                                    className="text-gray-200 dark:text-gray-700"
                                  />
                                  <circle
                                    cx="64"
                                    cy="64"
                                    r="56"
                                    stroke="currentColor"
                                    strokeWidth="8"
                                    fill="none"
                                    strokeDasharray={`${totalTests > 0 ? (totalPassed / totalTests) * 351.86 : 0} 351.86`}
                                    className="text-green-600"
                                  />
                                </svg>
                                <div className="absolute inset-0 flex items-center justify-center">
                                  <span className="text-2xl font-bold text-green-600">
                                    {totalTests > 0 ? Math.round((totalPassed / totalTests) * 100) : 0}%
                                  </span>
                                </div>
                              </div>
                            </div>
                          </CardContent>
                        </Card>

                        {/* Historical Trends - Quick View */}
                        {trendData.length > 0 && (
                          <Card>
                            <CardHeader>
                              <CardTitle className="flex items-center gap-2">
                                <TrendingUp className="h-5 w-5 text-blue-600" />
                                Historical Trends Across Runs
                              </CardTitle>
                            </CardHeader>
                            <CardContent>
                              <div className="space-y-4">
                                <div className="grid grid-cols-3 gap-4">
                                  <div>
                                    <p className="text-sm text-muted-foreground mb-1">Average Pass Rate</p>
                                    <p className="text-2xl font-bold text-green-600">
                                      {trendData.length > 0
                                        ? Math.round(trendData.reduce((sum, d) => sum + d.passRate, 0) / trendData.length)
                                        : 0}%
                                    </p>
                                  </div>
                                  <div>
                                    <p className="text-sm text-muted-foreground mb-1">Total Runs Analyzed</p>
                                    <p className="text-2xl font-bold text-blue-600">{trendData.length}</p>
                                  </div>
                                  <div>
                                    <p className="text-sm text-muted-foreground mb-1">Trend</p>
                                    <div className="flex items-center gap-2">
                                      {trendData.length >= 2 && (
                                        <>
                                          {trendData[trendData.length - 1].passRate > trendData[trendData.length - 2].passRate ? (
                                            <>
                                              <TrendingUp className="h-5 w-5 text-green-600" />
                                              <span className="text-sm font-semibold text-green-600">Improving</span>
                                            </>
                                          ) : trendData[trendData.length - 1].passRate < trendData[trendData.length - 2].passRate ? (
                                            <>
                                              <TrendingDown className="h-5 w-5 text-red-600" />
                                              <span className="text-sm font-semibold text-red-600">Declining</span>
                                            </>
                                          ) : (
                                            <>
                                              <Activity className="h-5 w-5 text-blue-600" />
                                              <span className="text-sm font-semibold text-blue-600">Stable</span>
                                            </>
                                          )}
                                        </>
                                      )}
                                    </div>
                                  </div>
                                </div>
                                <div className="h-[200px]">
                                  <ChartContainer
                                    config={{
                                      passed: { label: "Passed", color: "hsl(var(--chart-1))" },
                                      failed: { label: "Failed", color: "hsl(var(--chart-2))" },
                                      passRate: { label: "Pass Rate %", color: "hsl(var(--chart-3))" },
                                    }}
                                    className="h-full"
                                  >
                                    <ResponsiveContainer width="100%" height="100%">
                                      <LineChart data={trendData}>
                                        <CartesianGrid strokeDasharray="3 3" />
                                        <XAxis dataKey="run" />
                                        <YAxis yAxisId="left" />
                                        <YAxis yAxisId="right" orientation="right" />
                                        <ChartTooltip content={<ChartTooltipContent />} />
                                        <Legend />
                                        <Line yAxisId="left" type="monotone" dataKey="passed" stroke="#22c55e" name="Passed" />
                                        <Line yAxisId="left" type="monotone" dataKey="failed" stroke="#ef4444" name="Failed" />
                                        <Line yAxisId="right" type="monotone" dataKey="passRate" stroke="#3b82f6" name="Pass Rate %" />
                                      </LineChart>
                                    </ResponsiveContainer>
                                  </ChartContainer>
                                </div>
                              </div>
                            </CardContent>
                          </Card>
                        )}
                      </div>
                    </>
                  )}

                  {/* Test Runs List */}
                  <Card>
                    <CardHeader>
                      <CardTitle>Test Runs</CardTitle>
                    </CardHeader>
                    <CardContent>
                      {loadingTests ? (
                        <p className="text-center text-muted-foreground py-8">Loading test runs...</p>
                      ) : testRuns.length === 0 ? (
                        <p className="text-center text-muted-foreground py-8">
                          No test runs found. Test runs are available when tests are executed as part of pipeline builds.
                        </p>
                      ) : (
                        <div className="space-y-2">
                          {testRuns.map((run) => {
                            const counts = getTestCounts(run);
                            const passRate = counts.total > 0 
                              ? Math.round((counts.passed / counts.total) * 100) 
                              : 0;
                            const stabilityScore = calculateStabilityScore(run);
                            return (
                              <div key={run.id} className="p-4 border rounded-lg hover:bg-muted/50 transition-colors">
                                <div className="flex items-start justify-between gap-4">
                                  <div className="flex items-start gap-3 flex-1">
                                    {getStatusIcon(run.state, counts.failed)}
                                    <div className="flex-1">
                                      <div className="flex items-center gap-2 mb-2 flex-wrap">
                                        <span className="font-medium">{run.name}</span>
                                        <Badge className={`${getStatusColor(run.state, counts.failed)} text-white text-xs`}>
                                          {getStatusText(run.state, counts.failed)}
                                        </Badge>
                                        {run.build && (
                                          <span className="text-sm text-muted-foreground">
                                            Build #{run.build.buildNumber}
                                          </span>
                                        )}
                                        {/* Feature 9: Stability Score */}
                                        <Badge variant="outline" className="text-xs">
                                          <Target className="h-3 w-3 mr-1" />
                                          Stability: {stabilityScore}/100
                                        </Badge>
                                      </div>
                                      <div className="text-sm text-muted-foreground space-y-1 mb-3">
                                        <div>Total Tests: {counts.total}</div>
                                        <div className="flex items-center gap-4">
                                          <span className="text-green-600">Passed: {counts.passed}</span>
                                          <span className="text-red-600">Failed: {counts.failed}</span>
                                          <span className="text-amber-600">Skipped: {counts.skipped}</span>
                                        </div>
                                        <div>Pass Rate: {passRate}%</div>
                                        {run.startedDate && <div>Started: {formatDate(run.startedDate)}</div>}
                                        {run.completedDate && <div>Completed: {formatDate(run.completedDate)}</div>}
                                      </div>
                                      <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2 relative overflow-hidden">
                                        {passRate === 100 ? (
                                          // If 100% passed, show all green
                                          <div
                                            className="bg-green-500 h-2 absolute left-0 transition-all"
                                            style={{ width: '100%' }}
                                          />
                                        ) : (
                                          <>
                                            {/* Green for passed */}
                                            {passRate > 0 && (
                                              <div
                                                className="bg-green-500 h-2 absolute left-0 transition-all"
                                                style={{ width: `${passRate}%` }}
                                              />
                                            )}
                                            {/* Red for failed - show red for any non-passed portion if not 100% */}
                                            {counts.failed > 0 && counts.total > 0 && (
                                              <div
                                                className="bg-red-500 h-2 absolute transition-all"
                                                style={{ 
                                                  left: `${passRate}%`, 
                                                  width: `${Math.round((counts.failed / counts.total) * 100)}%` 
                                                }}
                                              />
                                            )}
                                            {/* If no explicit failed count but not 100%, show remaining as red */}
                                            {counts.failed === 0 && passRate < 100 && counts.total > 0 && (
                                              <div
                                                className="bg-red-500 h-2 absolute transition-all"
                                                style={{ 
                                                  left: `${passRate}%`, 
                                                  width: `${100 - passRate}%` 
                                                }}
                                              />
                                            )}
                                            {/* Orange for skipped */}
                                            {counts.skipped > 0 && counts.total > 0 && (
                                              <div
                                                className="bg-amber-500 h-2 absolute transition-all"
                                                style={{ 
                                                  left: `${passRate + Math.round((counts.failed / counts.total) * 100)}%`, 
                                                  width: `${Math.round((counts.skipped / counts.total) * 100)}%` 
                                                }}
                                              />
                                            )}
                                          </>
                                        )}
                                      </div>
                                    </div>
                                  </div>
                                  <div className="flex flex-col gap-2">
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      onClick={() => {
                                        setSelectedRunId(run.id);
                                        setSelectedTab('details');
                                      }}
                                    >
                                      View Details
                                    </Button>
                                    {/* Feature 10: Re-run failed tests */}
                                    {counts.failed > 0 && (
                                      <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => handleRerunFailedTests(run.id)}
                                      >
                                        <PlayCircle className="h-4 w-4 mr-1" />
                                        Rerun Failed
                                      </Button>
                                    )}
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </TabsContent>

                {/* Details Tab - Show detailed information about selected test run */}
                <TabsContent value="details" className="space-y-6 mt-0">
                  {selectedRunId ? (
                    (() => {
                      const selectedRun = testRuns.find(r => r.id === selectedRunId);
                      if (!selectedRun) {
                        return (
                          <Card>
                            <CardContent className="pt-6">
                              <p className="text-center text-muted-foreground py-8">Test run not found</p>
                            </CardContent>
                          </Card>
                        );
                      }
                      // Calculate counts from actual test results if available, otherwise use summary
                      let counts = getTestCounts(selectedRun);
                      if (testResults.length > 0) {
                        // Recalculate from actual test results
                        counts = {
                          total: testResults.length,
                          passed: testResults.filter(r => {
                            const outcome = (r.outcome || r.state || '').toLowerCase();
                            return outcome === 'passed' || outcome === 'completed';
                          }).length,
                          failed: testResults.filter(r => {
                            const outcome = (r.outcome || r.state || '').toLowerCase();
                            return outcome === 'failed' || outcome === 'failure';
                          }).length,
                          skipped: testResults.filter(r => {
                            const outcome = (r.outcome || r.state || '').toLowerCase();
                            return outcome === 'skipped' || outcome === 'notexecuted' || outcome === 'not executed';
                          }).length,
                        };
                      }
                      const passRate = counts.total > 0 
                        ? Math.round((counts.passed / counts.total) * 100) 
                        : 0;
                      const failRate = counts.total > 0 
                        ? Math.round((counts.failed / counts.total) * 100) 
                        : 0;
                      const skipRate = counts.total > 0 
                        ? Math.round((counts.skipped / counts.total) * 100) 
                        : 0;
                      return (
                        <>
                          <Card>
                            <CardHeader>
                              <CardTitle className="flex items-center gap-2">
                                <FileText className="h-5 w-5" />
                                Test Run Details: {selectedRun.name}
                              </CardTitle>
                            </CardHeader>
                            <CardContent>
                              <div className="grid grid-cols-2 gap-6">
                                <div>
                                  <h3 className="font-semibold mb-3">Summary</h3>
                                  <div className="space-y-2 text-sm">
                                    <div className="flex justify-between">
                                      <span className="text-muted-foreground">State:</span>
                                      <Badge className={`${getStatusColor(selectedRun.state, counts.failed)} text-white`}>
                                        {getStatusText(selectedRun.state, counts.failed)}
                                      </Badge>
                                    </div>
                                    <div className="flex justify-between">
                                      <span className="text-muted-foreground">Total Tests:</span>
                                      <span className="font-medium">{counts.total}</span>
                                    </div>
                                    <div className="flex justify-between">
                                      <span className="text-muted-foreground">Passed:</span>
                                      <span className="font-medium text-green-600">{counts.passed}</span>
                                    </div>
                                    <div className="flex justify-between">
                                      <span className="text-muted-foreground">Failed:</span>
                                      <span className="font-medium text-red-600">{counts.failed}</span>
                                    </div>
                                    <div className="flex justify-between">
                                      <span className="text-muted-foreground">Skipped:</span>
                                      <span className="font-medium text-amber-600">{counts.skipped}</span>
                                    </div>
                                    <div className="flex justify-between">
                                      <span className="text-muted-foreground">Pass Rate:</span>
                                      <span className="font-medium">{passRate}%</span>
                                    </div>
                                    {selectedRun.build && (
                                      <div className="flex justify-between">
                                        <span className="text-muted-foreground">Build:</span>
                                        <span className="font-medium">#{selectedRun.build.buildNumber}</span>
                                      </div>
                                    )}
                                  </div>
                                </div>
                                <div>
                                  <h3 className="font-semibold mb-3">Timing</h3>
                                  <div className="space-y-2 text-sm">
                                    {selectedRun.startedDate && (
                                      <div className="flex justify-between">
                                        <span className="text-muted-foreground">Started:</span>
                                        <span className="font-medium">{formatDate(selectedRun.startedDate)}</span>
                                      </div>
                                    )}
                                    {selectedRun.completedDate && (
                                      <div className="flex justify-between">
                                        <span className="text-muted-foreground">Completed:</span>
                                        <span className="font-medium">{formatDate(selectedRun.completedDate)}</span>
                                      </div>
                                    )}
                                    {selectedRun.duration && (
                                      <div className="flex justify-between">
                                        <span className="text-muted-foreground">Duration:</span>
                                        <span className="font-medium">{Math.round((selectedRun.duration || 0) / 1000)}s</span>
                                      </div>
                                    )}
                                  </div>
                                </div>
                              </div>
                              <div className="mt-6">
                                <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-3 relative overflow-hidden">
                                  {passRate === 100 ? (
                                    // If 100% passed, show all green
                                    <div
                                      className="bg-green-500 h-3 absolute left-0 transition-all"
                                      style={{ width: '100%' }}
                                    />
                                  ) : (
                                    <>
                                      {/* Green for passed */}
                                      {passRate > 0 && (
                                        <div
                                          className="bg-green-500 h-3 absolute left-0 transition-all"
                                          style={{ width: `${passRate}%` }}
                                        />
                                      )}
                                      {/* Red for failed */}
                                      {failRate > 0 && (
                                        <div
                                          className="bg-red-500 h-3 absolute transition-all"
                                          style={{ left: `${passRate}%`, width: `${failRate}%` }}
                                        />
                                      )}
                                      {/* If no explicit failed count but not 100%, show remaining as red */}
                                      {failRate === 0 && passRate < 100 && counts.total > 0 && (
                                        <div
                                          className="bg-red-500 h-3 absolute transition-all"
                                          style={{ 
                                            left: `${passRate}%`, 
                                            width: `${100 - passRate}%` 
                                          }}
                                        />
                                      )}
                                      {/* Orange for skipped */}
                                      {skipRate > 0 && (
                                        <div
                                          className="bg-amber-500 h-3 absolute transition-all"
                                          style={{ left: `${passRate + failRate}%`, width: `${skipRate}%` }}
                                        />
                                      )}
                                    </>
                                  )}
                                </div>
                              </div>
                            </CardContent>
                          </Card>

                          {/* Test Results with Categories and Associated Work Items */}
                          {testResults.length > 0 && (
                            <>
                              <Card>
                                <CardHeader>
                                  <CardTitle>Test Results ({testResults.length} tests)</CardTitle>
                                </CardHeader>
                                <CardContent>
                                  <div className="space-y-2">
                                    {testResults.map((result) => {
                                      const outcome = (result.outcome || result.state || '').toLowerCase();
                                      const testName = result.testCase?.name || result.testCaseTitle || result.testCaseName || 'Unknown Test';
                                      
                                      // Determine test category based on test name and outcome
                                      let testCategory = 'General';
                                      if (testName.toLowerCase().includes('unit')) testCategory = 'Unit Tests';
                                      else if (testName.toLowerCase().includes('integration')) testCategory = 'Integration Tests';
                                      else if (testName.toLowerCase().includes('e2e') || testName.toLowerCase().includes('end-to-end')) testCategory = 'E2E Tests';
                                      else if (testName.toLowerCase().includes('api')) testCategory = 'API Tests';
                                      else if (testName.toLowerCase().includes('ui') || testName.toLowerCase().includes('ui')) testCategory = 'UI Tests';
                                      else if (testName.toLowerCase().includes('performance')) testCategory = 'Performance Tests';
                                      else if (testName.toLowerCase().includes('security')) testCategory = 'Security Tests';
                                      
                                      return (
                                        <div key={result.id} className="p-3 border rounded-lg hover:bg-muted/50 transition-colors">
                                          <div className="flex items-start justify-between gap-4">
                                            <div className="flex items-start gap-3 flex-1">
                                              {outcome === 'passed' || outcome === 'completed' ? (
                                                <CheckCircle2 className="h-4 w-4 text-green-600 mt-1" />
                                              ) : outcome === 'failed' || outcome === 'failure' ? (
                                                <XCircle className="h-4 w-4 text-red-600 mt-1" />
                                              ) : (
                                                <Clock className="h-4 w-4 text-amber-600 mt-1" />
                                              )}
                                              <div className="flex-1">
                                                <div className="flex items-center gap-2 flex-wrap mb-2">
                                                  <span className="font-medium">{testName}</span>
                                                  <Badge variant="outline" className="text-xs">
                                                    {testCategory}
                                                  </Badge>
                                                  <Badge variant={(() => {
                                                    if (outcome === 'passed' || outcome === 'completed') return 'default';
                                                    if (outcome === 'failed' || outcome === 'failure') return 'destructive';
                                                    return 'secondary';
                                                  })()}>
                                                    {result.outcome || result.state || 'Unknown'}
                                                  </Badge>
                                                </div>
                                                
                                                {/* Associated Stories or Tasks */}
                                                {result.associatedWorkItems && result.associatedWorkItems.length > 0 && (
                                                  <div className="mt-2 mb-2">
                                                    <div className="flex items-center gap-2 flex-wrap">
                                                      <span className="text-xs text-muted-foreground font-medium">Linked to:</span>
                                                      {result.associatedWorkItems.map((item, idx) => (
                                                        <Badge key={idx} variant="outline" className="text-xs">
                                                          <Layers className="h-3 w-3 mr-1" />
                                                          {item.name || `Work Item #${item.id}`}
                                                        </Badge>
                                                      ))}
                                                    </div>
                                                  </div>
                                                )}
                                                
                                                {result.errorMessage && (
                                                  <div className="mt-2 text-sm text-red-600 bg-red-50 dark:bg-red-950/20 p-2 rounded">
                                                    <div className="font-semibold mb-1">Error:</div>
                                                    {result.errorMessage}
                                                  </div>
                                                )}
                                                
                                                {result.stackTrace && (
                                                  <details className="mt-2">
                                                    <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground">
                                                      Stack Trace
                                                    </summary>
                                                    <pre className="mt-2 text-xs bg-muted p-2 rounded overflow-x-auto">
                                                      {result.stackTrace}
                                                    </pre>
                                                  </details>
                                                )}
                                                
                                                <div className="mt-2 flex items-center gap-4 text-xs text-muted-foreground">
                                                  {result.duration && (
                                                    <span>Duration: {Math.round((result.durationInMs || result.duration) / 1000)}s</span>
                                                  )}
                                                </div>
                                              </div>
                                            </div>
                                          </div>
                                        </div>
                                      );
                                    })}
                                  </div>
                                </CardContent>
                              </Card>
                              
                              {/* Test Categories Summary */}
                              {(() => {
                                const categoryCounts = testResults.reduce((acc: Record<string, { total: number; passed: number; failed: number; skipped: number }>, result) => {
                                  const outcome = (result.outcome || result.state || '').toLowerCase();
                                  const testName = result.testCase?.name || result.testCaseTitle || result.testCaseName || 'Unknown Test';
                                      
                                  let category = 'General';
                                  if (testName.toLowerCase().includes('unit')) category = 'Unit Tests';
                                  else if (testName.toLowerCase().includes('integration')) category = 'Integration Tests';
                                  else if (testName.toLowerCase().includes('e2e') || testName.toLowerCase().includes('end-to-end')) category = 'E2E Tests';
                                  else if (testName.toLowerCase().includes('api')) category = 'API Tests';
                                  else if (testName.toLowerCase().includes('ui')) category = 'UI Tests';
                                  else if (testName.toLowerCase().includes('performance')) category = 'Performance Tests';
                                  else if (testName.toLowerCase().includes('security')) category = 'Security Tests';
                                      
                                  if (!acc[category]) {
                                    acc[category] = { total: 0, passed: 0, failed: 0, skipped: 0 };
                                  }
                                  acc[category].total++;
                                  if (outcome === 'passed' || outcome === 'completed') acc[category].passed++;
                                  else if (outcome === 'failed' || outcome === 'failure') acc[category].failed++;
                                  else acc[category].skipped++;
                                      
                                  return acc;
                                }, {});
                                
                                if (Object.keys(categoryCounts).length === 0) return null;
                                
                                return (
                                  <Card>
                                    <CardHeader>
                                      <CardTitle className="flex items-center gap-2">
                                        <Layers className="h-5 w-5" />
                                        Test Categories
                                      </CardTitle>
                                    </CardHeader>
                                    <CardContent>
                                      <div className="grid grid-cols-2 gap-4">
                                        {Object.entries(categoryCounts).map(([category, counts]) => {
                                          const passRate = counts.total > 0 ? Math.round((counts.passed / counts.total) * 100) : 0;
                                          return (
                                            <Card key={category} className="border">
                                              <CardContent className="pt-4">
                                                <div className="flex items-center justify-between mb-2">
                                                  <span className="font-semibold">{category}</span>
                                                  <Badge variant="outline">{counts.total} tests</Badge>
                                                </div>
                                                <div className="space-y-1 text-sm">
                                                  <div className="flex justify-between">
                                                    <span className="text-muted-foreground">Passed:</span>
                                                    <span className="text-green-600 font-medium">{counts.passed}</span>
                                                  </div>
                                                  <div className="flex justify-between">
                                                    <span className="text-muted-foreground">Failed:</span>
                                                    <span className="text-red-600 font-medium">{counts.failed}</span>
                                                  </div>
                                                  <div className="flex justify-between">
                                                    <span className="text-muted-foreground">Skipped:</span>
                                                    <span className="text-amber-600 font-medium">{counts.skipped}</span>
                                                  </div>
                                                  <div className="mt-2 pt-2 border-t">
                                                    <div className="flex justify-between">
                                                      <span className="text-muted-foreground">Pass Rate:</span>
                                                      <span className="font-semibold">{passRate}%</span>
                                                    </div>
                                                    <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2 mt-1">
                                                      <div
                                                        className="bg-green-500 h-2 rounded-full transition-all"
                                                        style={{ width: `${passRate}%` }}
                                                      />
                                                    </div>
                                                  </div>
                                                </div>
                                              </CardContent>
                                            </Card>
                                          );
                                        })}
                                      </div>
                                    </CardContent>
                                  </Card>
                                );
                              })()}
                            </>
                          )}
                        </>
                      );
                    })()
                  ) : (
                    <Card>
                      <CardContent className="pt-6">
                        <p className="text-center text-muted-foreground py-8">
                          Select a test run and click "View Details" to see detailed information
                        </p>
                      </CardContent>
                    </Card>
                  )}
                </TabsContent>

                {/* Trends Tab - Feature 4 */}
                <TabsContent value="trends" className="space-y-6 mt-0">
                  <Card>
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2">
                        <TrendingUp className="h-5 w-5" />
                        Pass/Fail Trend Over Time
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      {trendData.length > 0 ? (
                        <ChartContainer
                          config={{
                            passed: { label: "Passed", color: "hsl(var(--chart-1))" },
                            failed: { label: "Failed", color: "hsl(var(--chart-2))" },
                            passRate: { label: "Pass Rate %", color: "hsl(var(--chart-3))" },
                          }}
                          className="h-[400px]"
                        >
                          <ResponsiveContainer width="100%" height="100%">
                            <LineChart data={trendData}>
                              <CartesianGrid strokeDasharray="3 3" />
                              <XAxis 
                                dataKey="runLabel" 
                                label={{ value: 'Test Run (Date)', position: 'insideBottom', offset: -5 }}
                                tick={{ fontSize: 11 }}
                                angle={-45}
                                textAnchor="end"
                                height={80}
                              />
                              <YAxis 
                                yAxisId="left" 
                                label={{ value: 'Test Count', angle: -90, position: 'insideLeft' }}
                                domain={[0, 'dataMax + 2']}
                                tick={{ fontSize: 12 }}
                              />
                              <YAxis 
                                yAxisId="right" 
                                orientation="right" 
                                label={{ value: 'Pass Rate (%)', angle: 90, position: 'insideRight' }}
                                domain={[0, 100]}
                                tick={{ fontSize: 12 }}
                              />
                              <ChartTooltip 
                                content={({ active, payload }) => {
                                  if (active && payload && payload.length) {
                                    const data = payload[0].payload;
                                    return (
                                      <div className="bg-background border border-border rounded-lg p-3 shadow-lg">
                                        <p className="font-semibold mb-2">Run #{data.run}</p>
                                        {data.fullDate && <p className="text-xs text-muted-foreground mb-2">{data.fullDate}</p>}
                                        {data.name && <p className="text-xs text-muted-foreground mb-2">{data.name}</p>}
                                        {payload.map((entry, index) => (
                                          <p key={index} className="text-sm" style={{ color: entry.color }}>
                                            {entry.name}: {entry.value}
                                            {entry.dataKey === 'passRate' ? '%' : ''}
                                          </p>
                                        ))}
                                      </div>
                                    );
                                  }
                                  return null;
                                }}
                              />
                              <Legend />
                              <Line 
                                yAxisId="left" 
                                type="monotone" 
                                dataKey="passed" 
                                stroke="#22c55e" 
                                name="Passed" 
                                strokeWidth={2}
                                dot={{ r: 4 }}
                                activeDot={{ r: 6 }}
                              />
                              <Line 
                                yAxisId="left" 
                                type="monotone" 
                                dataKey="failed" 
                                stroke="#ef4444" 
                                name="Failed" 
                                strokeWidth={2}
                                dot={{ r: 4 }}
                                activeDot={{ r: 6 }}
                              />
                              <Line 
                                yAxisId="right" 
                                type="monotone" 
                                dataKey="passRate" 
                                stroke="#3b82f6" 
                                name="Pass Rate %" 
                                strokeWidth={2}
                                dot={{ r: 4 }}
                                activeDot={{ r: 6 }}
                              />
                            </LineChart>
                          </ResponsiveContainer>
                        </ChartContainer>
                      ) : (
                        <p className="text-center text-muted-foreground py-8">No trend data available</p>
                      )}
                    </CardContent>
                  </Card>
                </TabsContent>

                {/* Analytics Tab - Feature 5 */}
                <TabsContent value="analytics" className="space-y-6 mt-0">
                  <Card>
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2">
                        <BarChart3 className="h-5 w-5" />
                        Test Duration Analytics
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      {durationData.length > 0 ? (
                        <ChartContainer
                          config={{
                            duration: { label: "Duration (seconds)", color: "hsl(var(--chart-1))" },
                          }}
                          className="h-[400px]"
                        >
                          <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={durationData}>
                              <CartesianGrid strokeDasharray="3 3" />
                              <XAxis dataKey="name" angle={-45} textAnchor="end" height={100} />
                              <YAxis />
                              <ChartTooltip content={<ChartTooltipContent />} />
                              <Bar dataKey="duration" fill="#3b82f6" name="Duration (seconds)" />
                            </BarChart>
                          </ResponsiveContainer>
                        </ChartContainer>
                      ) : (
                        <p className="text-center text-muted-foreground py-8">No duration data available</p>
                      )}
                    </CardContent>
                  </Card>
                </TabsContent>

                {/* Comparison Tab - Feature 7 */}
                <TabsContent value="comparison" className="space-y-6 mt-0">
                  <Card>
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2">
                        <GitCompare className="h-5 w-5" />
                        Side-by-Side Run Comparison
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="grid grid-cols-2 gap-4 mb-4">
                        <div>
                          <label className="text-sm font-medium mb-2 block">Run 1</label>
                          <Select
                            value={comparisonRun1?.toString() || ''}
                            onValueChange={(value) => setComparisonRun1(value ? Number(value) : null)}
                          >
                            <SelectTrigger className="w-full">
                              <SelectValue placeholder="Select run..." />
                            </SelectTrigger>
                            <SelectContent>
                              {testRuns.map(run => (
                                <SelectItem key={run.id} value={run.id.toString()}>
                                  {run.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div>
                          <label className="text-sm font-medium mb-2 block">Run 2</label>
                          <Select
                            value={comparisonRun2?.toString() || ''}
                            onValueChange={(value) => setComparisonRun2(value ? Number(value) : null)}
                          >
                            <SelectTrigger className="w-full">
                              <SelectValue placeholder="Select run..." />
                            </SelectTrigger>
                            <SelectContent>
                              {testRuns.map(run => (
                                <SelectItem key={run.id} value={run.id.toString()}>
                                  {run.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                      {comparisonRun1 && comparisonRun2 && (
                        <div className="grid grid-cols-2 gap-4">
                          {[comparisonRun1, comparisonRun2].map((runId, idx) => {
                            const run = testRuns.find(r => r.id === runId);
                            if (!run) return null;
                            return (
                              <Card key={runId}>
                                <CardHeader>
                                  <CardTitle>Run {idx + 1}: {run.name}</CardTitle>
                                </CardHeader>
                                <CardContent>
                                  <div className="space-y-2">
                                    {(() => {
                                      const runCounts = getTestCounts(run);
                                      const runPassRate = runCounts.total > 0 ? Math.round((runCounts.passed / runCounts.total) * 100) : 0;
                                      return (
                                        <>
                                          <div>Total: {runCounts.total}</div>
                                          <div className="text-green-600">Passed: {runCounts.passed}</div>
                                          <div className="text-red-600">Failed: {runCounts.failed}</div>
                                          <div className="text-amber-600">Skipped: {runCounts.skipped}</div>
                                          <div>Pass Rate: {runPassRate}%</div>
                                        </>
                                      );
                                    })()}
                                  </div>
                                </CardContent>
                              </Card>
                            );
                          })}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </TabsContent>

                {/* Flaky Tests Tab - Feature 3 */}
                <TabsContent value="flaky" className="space-y-6 mt-0">
                  <Card>
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2">
                        <AlertCircle className="h-5 w-5 text-amber-600" />
                        Flaky Test Detection
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <p className="text-muted-foreground">
                        Flaky test detection requires detailed test result history. This feature will analyze test results across multiple runs to identify tests that pass and fail intermittently.
                      </p>
                      {/* Implementation would go here */}
                    </CardContent>
                  </Card>
                </TabsContent>

                {/* Failures Tab - Features 2, 6, 8, 11, 12 */}
                <TabsContent value="failures" className="space-y-6 mt-0">
                  {/* Feature 6: Failure Categories */}
                  {failureCategories.length > 0 && (
                    <Card>
                      <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                          <Filter className="h-5 w-5" />
                          Failure Categories
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="space-y-2">
                          {failureCategories.map((category, idx) => (
                            <div key={idx} className="p-3 border rounded-lg">
                              <div className="flex items-center justify-between mb-2">
                                <span className="font-medium">{category.type}</span>
                                <Badge variant="destructive">{category.count} failures</Badge>
                              </div>
                              <div className="text-sm text-muted-foreground">
                                Affected tests: {category.tests.slice(0, 3).join(', ')}
                                {category.tests.length > 3 && ` +${category.tests.length - 3} more`}
                              </div>
                            </div>
                          ))}
                        </div>
                      </CardContent>
                    </Card>
                  )}

                  {/* Failed Tests with AI Suggestions */}
                  <Card>
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2">
                        <XCircle className="h-5 w-5 text-red-600" />
                        Failed Tests
                        {selectedRunId && testResults.length > 0 && (
                          <Badge variant="destructive" className="ml-2">
                            {testResults.filter(r => {
                              const outcome = (r.outcome || r.state || '').toLowerCase();
                              return outcome === 'failed' || outcome === 'failure';
                            }).length} failed
                          </Badge>
                        )}
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      {!selectedRunId ? (
                        <div className="text-center py-8 text-muted-foreground">
                          <p>Select a test run and click "View Details" to see failed tests, or</p>
                          <p className="mt-2">select a run from the overview tab that has failures.</p>
                        </div>
                      ) : testResults.length === 0 ? (
                        <div className="text-center py-8 text-muted-foreground">
                          <p>Loading test results...</p>
                        </div>
                      ) : (
                        <div className="space-y-4">
                          {(() => {
                            const failedTests = testResults.filter(r => {
                              const outcome = (r.outcome || r.state || '').toLowerCase();
                              return outcome === 'failed' || outcome === 'failure';
                            });
                            
                            if (failedTests.length === 0) {
                              return (
                                <div className="text-center py-8 text-muted-foreground">
                                  <CheckCircle2 className="h-12 w-12 text-green-600 mx-auto mb-2" />
                                  <p>No failed tests in this run!</p>
                                </div>
                              );
                            }
                            
                            return failedTests.map((result) => (
                              <div key={result.id} className="p-4 border rounded-lg">
                                <div className="flex items-start justify-between mb-2">
                                  <div className="flex-1">
                                    <h4 className="font-medium">{result.testCase?.name || result.testCaseTitle || result.testCaseName || 'Unknown Test'}</h4>
                                    {result.errorMessage && (
                                      <p className="text-sm text-muted-foreground mt-1">{result.errorMessage}</p>
                                    )}
                                  </div>
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={async () => {
                                      const suggestions = await handleGetAISuggestions(result);
                                      if (suggestions) {
                                        setSelectedFailedTest({ ...result, ...suggestions });
                                      }
                                    }}
                                  >
                                    <Brain className="h-4 w-4 mr-1" />
                                    AI Fix
                                  </Button>
                                </div>
                                
                                {/* Feature 11: Attachments */}
                                {result.attachments && result.attachments.length > 0 && (
                                  <div className="mt-2 flex gap-2">
                                    {result.attachments.map((att, idx) => (
                                      <Button
                                        key={idx}
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => window.open(att.url, '_blank')}
                                      >
                                        {att.name.includes('screenshot') || att.name.includes('image') ? (
                                          <ImageIcon className="h-4 w-4 mr-1" />
                                        ) : att.name.includes('video') ? (
                                          <Video className="h-4 w-4 mr-1" />
                                        ) : (
                                          <FileCode className="h-4 w-4 mr-1" />
                                        )}
                                        {att.name}
                                      </Button>
                                    ))}
                                  </div>
                                )}

                                {/* Feature 8: User Story Mapping */}
                                {result.associatedWorkItems && result.associatedWorkItems.length > 0 && (
                                  <div className="mt-2">
                                    <span className="text-sm text-muted-foreground">Linked to: </span>
                                    {result.associatedWorkItems.map((item, idx) => (
                                      <Badge key={idx} variant="outline" className="ml-1">
                                        {item.name}
                                      </Badge>
                                    ))}
                                  </div>
                                 )}
                               </div>
                            ));
                          })()}
                        </div>
                      )}
                    </CardContent>
                  </Card>

                  {/* Feature 2: AI Suggestions Panel */}
                  {selectedFailedTest && (
                    <Card>
                      <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                          <Sparkles className="h-5 w-5" />
                          AI-Generated Fix Suggestions
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setSelectedFailedTest(null)}
                            className="ml-auto"
                          >
                            Close
                          </Button>
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        {selectedFailedTest.probableCause || selectedFailedTest.suggestions ? (
                          <div className="space-y-4">
                            {selectedFailedTest.probableCause && (
                              <div>
                                <h4 className="font-semibold mb-2">Probable Cause</h4>
                                <p className="text-sm text-muted-foreground">{selectedFailedTest.probableCause}</p>
                              </div>
                            )}
                            {selectedFailedTest.suggestions && Array.isArray(selectedFailedTest.suggestions) && selectedFailedTest.suggestions.length > 0 && (
                              <div>
                                <h4 className="font-semibold mb-2">Suggestions</h4>
                                <ul className="list-disc list-inside space-y-1 text-sm text-muted-foreground">
                                  {selectedFailedTest.suggestions.map((suggestion: string, idx: number) => (
                                    <li key={idx}>{suggestion}</li>
                                  ))}
                                </ul>
                              </div>
                            )}
                            {selectedFailedTest.codeHints && (
                              <div>
                                <h4 className="font-semibold mb-2">Code Hints</h4>
                                <pre className="text-xs bg-muted p-3 rounded overflow-x-auto">
                                  {selectedFailedTest.codeHints}
                                </pre>
                              </div>
                            )}
                            {selectedFailedTest.retrySuggestions && (
                              <div>
                                <h4 className="font-semibold mb-2">Retry Suggestions</h4>
                                <p className="text-sm text-muted-foreground">{selectedFailedTest.retrySuggestions}</p>
                              </div>
                            )}
                          </div>
                        ) : (
                          <p className="text-muted-foreground">AI suggestions will appear here after analysis.</p>
                        )}
                      </CardContent>
                    </Card>
                  )}
                </TabsContent>
              </div>
            </ScrollArea>
          </Tabs>
        )}
    </GenericModal>
  );
}


