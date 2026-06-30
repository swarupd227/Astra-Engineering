import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { useQueryClient } from "@tanstack/react-query";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  FileText,
  Loader2,
  Download,
  Copy,
  Check,
  RefreshCw,
  Send,
  History,
  Eye,
} from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { ViewTestPlansModal } from "./view-test-plans-modal";
import { assembleSectionsMarkdown, prepareBrdDocument, type BRDDocument } from "@/lib/brd-utils";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { z } from "zod";

const ApprovedBRDDocumentSchema = z.object({
  id: z.string(),
  title: z.string(),
  generatedMarkdown: z.string().optional(),
  generatedBrdJson: z.any().optional(),
  brdFileName: z.string().nullable().optional(),
  brdFileType: z.string().nullable().optional(),
});

interface ApprovedBRD {
  id: string;
  title: string;
  updated_at: string;
  generatedMarkdown?: string;
  projectId?: string;
}

/**
 * Poll `/api/testing/test-plan/status/:jobId` until the async job finishes.
 *
 * The generate endpoint returns 202 + jobId immediately to avoid AWS API Gateway's
 * ~29s timeout (which surfaces as a 503 Service Unavailable). We poll every 2s
 * and resolve with the generated test plan markdown.
 */
async function pollTestPlanGenerationStatus(jobId: string): Promise<string> {
  const POLL_INTERVAL_MS = 2000;
  const MAX_DURATION_MS = 10 * 60 * 1000; // 10 minutes hard cap
  const startedAt = Date.now();

  while (true) {
    if (Date.now() - startedAt > MAX_DURATION_MS) {
      throw new Error(
        "Timed out waiting for test plan generation. Please try again."
      );
    }
    const resp = await apiRequest("GET", `/api/testing/test-plan/status/${jobId}`);
    if (!resp.ok) {
      // Hard-fail on definite 4xx (except 408/429); retry transient errors.
      if (resp.status >= 400 && resp.status < 500 && resp.status !== 408 && resp.status !== 429) {
        const errBody = await resp.json().catch(() => ({} as any));
        throw new Error(
          errBody?.message ||
            errBody?.error ||
            `Failed to fetch test plan generation status (HTTP ${resp.status})`
        );
      }
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      continue;
    }
    const data = await resp.json().catch(() => ({} as any));
    if (data?.status === "completed") {
      const testPlan = data?.result?.testPlan;
      if (!testPlan) {
        throw new Error("Test plan generation completed but no content was returned.");
      }
      return testPlan as string;
    }
    if (data?.status === "failed") {
      throw new Error(
        data?.error || "Test plan generation failed on the server."
      );
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
}

interface TestPlanGenerationModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId?: string | null;
  organizationId?: string | null;
  integrationType?: string;
  onSaved?: () => void;
  onViewSaved?: () => void;
}

export function TestPlanGenerationModal({
  open,
  onOpenChange,
  projectId,
  organizationId,
  integrationType = "ado",
  onSaved,
  onViewSaved,
}: TestPlanGenerationModalProps) {
  const isJira = integrationType === "jira";
  const providerShort = isJira ? "Jira" : "ADO";
  const [, setLocation] = useLocation();

  // BRD selection state
  const [approvedBrds, setApprovedBrds] = useState<ApprovedBRD[]>([]);
  const [selectedBrdId, setSelectedBrdId] = useState<string>("");
  const [selectedBrd, setSelectedBrd] = useState<ApprovedBRD | null>(null);
  const [selectedBrdContent, setSelectedBrdContent] = useState<string>("");
  const [selectedBrdData, setSelectedBrdData] = useState<BRDDocument | null>(null);
  const [loadingBrds, setLoadingBrds] = useState(false);
  const [loadingBrdContent, setLoadingBrdContent] = useState(false);

  // Test plan state
  const [testPlan, setTestPlan] = useState("");
  const [testPlanId, setTestPlanId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [pushed, setPushed] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [sessionsPanelOpen, setSessionsPanelOpen] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Fetch approved BRDs when modal opens
  useEffect(() => {
    if (open) {
      fetchApprovedBrds();
      // Reset state when modal opens
      setSelectedBrdId("");
      setSelectedBrd(null);
      setSelectedBrdContent("");
      setTestPlan("");
      setTestPlanId(null);
      setPushed(false);
      setError("");
    }
  }, [open]);

  // Fetch full BRD content when a BRD is selected
  useEffect(() => {
    if (selectedBrdId && selectedBrdId !== "") {
      const brd = approvedBrds.find(b => b.id === selectedBrdId);
      if (brd) {
        setSelectedBrd(brd);
        fetchBrdContent(selectedBrdId);
      }
    } else {
      setSelectedBrd(null);
      setSelectedBrdContent("");
    }
  }, [selectedBrdId, approvedBrds]);

  const fetchApprovedBrds = async () => {
    // If no projectId, try to fetch all approved BRDs
    setLoadingBrds(true);
    try {
      const url = projectId && projectId.trim() !== ''
        ? `/api/dev-brd/approved?projectId=${encodeURIComponent(projectId)}`
        : `/api/dev-brd/approved`;

      const res = await apiRequest("GET", url);
      const data = await res.json();

      if (res.ok && Array.isArray(data)) {
        setApprovedBrds(data);
      } else {
        console.warn("[TestPlan] Invalid response format:", { res, data });
        setApprovedBrds([]);
      }
    } catch (error) {
      console.error("[TestPlan] Failed to load approved BRDs:", error);
      setApprovedBrds([]);
      toast({
        description: "Failed to load approved BRDs",
        variant: "destructive"
      });
    } finally {
      setLoadingBrds(false);
    }
  };

  const fetchBrdContent = async (brdId: string) => {
    setLoadingBrdContent(true);
    try {
      console.log("[TestPlan] Fetching BRD content for ID:", brdId);

      // Fetch full BRD document including generatedMarkdown
      const res = await apiRequest("GET", `/api/dev-brd/${brdId}`);

      if (!res.ok) {
        console.error("[TestPlan] Failed to fetch BRD, status:", res.status);
        throw new Error(`Failed to fetch BRD: ${res.status}`);
      }

      const brd = await res.json();
      setSelectedBrd(brd);

      // TOTAL DIRECT EXTRACTION: Straight pipe from API to Screen. No utils, no parsing.
      if (brd.generatedMarkdown) {
        setSelectedBrdContent(brd.generatedMarkdown);
        // We only use the util for the background data (like dropdowns), 
        // but the actual CONTENT you see is the raw string from the DB.
        setSelectedBrdData(prepareBrdDocument(brd));
      } else {
        setSelectedBrdContent("");
        toast({
          description: "No markdown content found for this BRD",
          variant: "destructive"
        });
      }
    } catch (error) {
      console.error("[TestPlan] Failed to load BRD content:", error);
      toast({
        description: "Failed to load BRD content",
        variant: "destructive"
      });
      setSelectedBrdContent("");
    } finally {
      setLoadingBrdContent(false);
    }
  };

  const handleGenerate = async () => {
    console.log("[TestPlan] Generate button clicked");
    console.log("[TestPlan] Selected BRD:", selectedBrd);
    console.log("[TestPlan] BRD content length:", selectedBrdContent?.length || 0);
    console.log("[TestPlan] Project ID:", projectId);
    console.log("[TestPlan] Organization ID:", organizationId);

    if (!selectedBrdContent?.trim()) {
      console.error("[TestPlan] No BRD content available");
      setError("Please select a BRD");
      toast({
        description: "Please select a BRD first",
        variant: "destructive"
      });
      return;
    }

    if (!selectedBrd) {
      console.error("[TestPlan] No BRD selected");
      setError("BRD information is missing");
      toast({
        description: "BRD information is missing",
        variant: "destructive"
      });
      return;
    }

    setLoading(true);
    setError("");
    setTestPlan("");
    setTestPlanId(null);
    setPushed(false);

    try {
      console.log("[TestPlan] Starting test plan generation...");

      const payload = {
        brdContent: selectedBrdContent.trim(),
        projectId: projectId || selectedBrd?.projectId || null,
      };

      console.log("[TestPlan] Request payload:", {
        brdContentLength: payload.brdContent.length,
      });

      const response = await apiRequest("POST", "/api/testing/generate-test-plan", payload);

      console.log("[TestPlan] Response status:", response.status);

      if (!response.ok) {
        let errorMessage = "Failed to generate test plan";
        try {
          const errorData = await response.json();
          errorMessage = errorData.error || errorData.details || `Server error: ${response.status} ${response.statusText}`;
        } catch {
          errorMessage = `Server error: ${response.status} ${response.statusText}`;
        }
        setError(errorMessage);
        return;
      }

      const result = await response.json();

      let finalTestPlan: string | null = null;

      if (response.status === 202 && result?.jobId) {
        // Async-job pattern: poll status until completion. Long-running LLM calls
        // would otherwise hit AWS API Gateway's 29s timeout (503 Service Unavailable).
        console.log("[TestPlan] Job accepted:", result.jobId, "- polling status...");
        finalTestPlan = await pollTestPlanGenerationStatus(result.jobId);
      } else if (result?.success && result?.testPlan) {
        // Legacy synchronous response (older backend)
        finalTestPlan = result.testPlan;
      } else {
        console.error("[TestPlan] Generation failed:", result?.error);
        setError(result?.error || "Failed to generate test plan. Please try again.");
        return;
      }

      if (!finalTestPlan) {
        setError("Failed to generate test plan. The result was empty.");
        return;
      }

      setTestPlan(finalTestPlan);
      toast({
        description: "Test plan generated successfully. Session auto-saved.",
        duration: 3000
      });

      try {
        const saveResponse = await apiRequest("POST", "/api/testing/save-test-plan", {
          testPlanContent: finalTestPlan,
          brdId: selectedBrd?.id,
          brdTitle: selectedBrd?.title,
          projectId: projectId || selectedBrd?.projectId || null,
          organizationId: organizationId || null,
        });
        if (saveResponse.ok) {
          const saveData = await saveResponse.json();
          if (saveData.success && saveData.testPlanId) {
            setTestPlanId(saveData.testPlanId);
            console.log("[TestPlan] Session saved with ID:", saveData.testPlanId);
            queryClient.invalidateQueries({ queryKey: ["/api/testing/test-plans", projectId, organizationId] });
          }
        }
      } catch (e) {
        console.error("[TestPlan] Auto-save session failed", e);
      }
    } catch (err) {
      console.error("[TestPlan] Error during generation:", err);
      const errorMessage = err instanceof Error ? err.message : "Unknown error occurred";
      setError(`Generation failed: ${errorMessage}`);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!testPlan) return null;

    try {
      const response = await apiRequest("POST", "/api/testing/save-test-plan", {
        testPlanContent: testPlan,
        brdId: selectedBrd?.id,
        brdTitle: selectedBrd?.title,
        projectId: projectId || selectedBrd?.projectId || null,
        organizationId: organizationId || null,
      });

      if (response.ok) {
        const data = await response.json();
        if (data.success && data.testPlanId) {
          setTestPlanId(data.testPlanId);
          // Invalidate test plans cache
          queryClient.invalidateQueries({ queryKey: ["/api/testing/test-plans", projectId, organizationId] });
          return data.testPlanId;
        }
      }
    } catch (e) {
      console.error("[TestPlan] Manual save failed", e);
    }
    return null;
  };

  const handlePushToAdo = async () => {
    if (!testPlan || !selectedBrd) {
      setError("No test plan to push");
      return;
    }

    setPushing(true);
    setError("");

    try {
      let currentTestPlanId = testPlanId;

      // If we don't have a testPlanId yet, force a save first
      if (!currentTestPlanId) {
        console.log("[TestPlan] No testPlanId found, forcing save before push...");
        currentTestPlanId = await handleSave();
      }

      console.log(`[TestPlan] Pushing test plan to ${providerShort}...`);

      const payload = {
        testPlanId: currentTestPlanId,
        testPlanContent: testPlan,
        brdId: selectedBrd.id,
        brdTitle: selectedBrd.title,
        projectId: projectId || selectedBrd.projectId || null,
        organizationId: organizationId || null,
      };

      const pushEndpoint = isJira
        ? "/api/testing/push-test-plan-to-jira"
        : "/api/testing/push-test-plan-to-ado";
      const response = await apiRequest("POST", pushEndpoint, payload);

      if (response.ok) {
        const result = await response.json();
        console.log("[TestPlan] Push result:", result);

        if (result.success) {
          setPushed(true);
          setTestPlanId(result.testPlanId);
          onSaved?.();
          // Invalidate test plans query to reflect the push status in session view
          queryClient.invalidateQueries({ queryKey: ["/api/testing/test-plans", projectId, organizationId] });
          toast({
            description: `Test plan pushed to ${providerShort} successfully!`,
            duration: 3000
          });
        } else {
          setError(result.error || "Failed to push test plan");
          toast({
            description: result.error || "Failed to push test plan",
            variant: "destructive"
          });
        }
      } else {
        const errorData = await response.json().catch(() => ({ error: "Unknown error" }));
        setError(errorData.error || "Failed to push test plan");
        toast({
          description: errorData.error || "Failed to push test plan",
          variant: "destructive"
        });
      }
    } catch (err) {
      console.error("[TestPlan] Error pushing test plan:", err);
      const errorMessage = err instanceof Error ? err.message : "Network error occurred";
      setError(errorMessage);
      toast({
        description: `Error: ${errorMessage}`,
        variant: "destructive"
      });
    } finally {
      setPushing(false);
    }
  };

  const handleDownload = () => {
    if (!testPlan) return;

    const fileName = selectedBrd
      ? `Test_Plan_${selectedBrd.title.replace(/[^a-z0-9]/gi, '_')}_${new Date().toISOString().split('T')[0]}.md`
      : `Test_Plan_${new Date().toISOString().split('T')[0]}.md`;

    const blob = new Blob([testPlan], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    toast({ description: "Test plan downloaded successfully" });
  };

  const handleCopy = async () => {
    if (!testPlan) return;

    try {
      await navigator.clipboard.writeText(testPlan);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      toast({ description: "Test plan copied to clipboard" });
    } catch (error) {
      toast({ description: "Failed to copy test plan", variant: "destructive" });
    }
  };

  const handleClose = () => {
    // Reset all state
    setSelectedBrdId("");
    setSelectedBrd(null);
    setSelectedBrdContent("");
    setTestPlan("");
    setTestPlanId(null);
    setPushed(false);
    setError("");
    onOpenChange(false);
    setLocation("/sdlc");
  };

  // Remove duplicate markdown headings (any level) from BRD/test-plan content.
  // The DB may store markdown where a heading appears twice in a row (e.g. two
  // consecutive "## 1. Document Information" lines). This strips the duplicates
  // before rendering so only the first occurrence of each heading is shown.
  const removeDuplicateHeadings = (content: string): string => {
    const seen = new Set<string>();
    return content
      .split('\n')
      .filter(line => {
        const m = line.match(/^#{1,6}\s+(.+)/);
        if (m) {
          const key = m[1].toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
          if (seen.has(key)) return false;
          seen.add(key);
        }
        return true;
      })
      .join('\n');
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-7xl h-[90vh] flex flex-col overflow-hidden">
          <DialogHeader className="flex-shrink-0 flex flex-row items-start justify-between pr-8">
            <div>
              <DialogTitle className="flex items-center gap-2 mb-1">
                <FileText className="h-5 w-5" />
                Generate Test Plan from BRD
              </DialogTitle>
              <DialogDescription>
                Select an existing BRD to generate a comprehensive test plan
              </DialogDescription>
            </div>
          </DialogHeader>

          <div className="flex flex-1 gap-4 min-h-0 overflow-hidden">
            {/* Left Panel - BRD Selection and Content */}
            <div className="w-1/2 border rounded-lg flex flex-col">
              <div className="p-4 border-b space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="font-medium text-sm">Select BRD</h3>
                  <Button size="sm" variant="ghost" onClick={fetchApprovedBrds} disabled={loadingBrds}>
                    <RefreshCw className={`h-4 w-4 ${loadingBrds ? 'animate-spin' : ''}`} />
                  </Button>
                </div>

                <Select value={selectedBrdId} onValueChange={setSelectedBrdId}>
                  <SelectTrigger className="w-full h-auto py-2 pr-10 focus:ring-1 focus:ring-primary/30">
                    <div className="flex items-center justify-between w-full pr-2">
                      <div className="flex flex-col items-start min-w-0">
                        <span className="font-medium text-sm truncate max-w-[300px]">
                          {selectedBrdId ? (approvedBrds.find(b => b.id === selectedBrdId)?.title || "Select a BRD...") : "Select a BRD..."}
                        </span>
                      </div>
                      {selectedBrdId && (
                        <div className="ml-auto text-[10px] text-muted-foreground bg-muted/50 px-2 py-0.5 rounded border border-border/50 whitespace-nowrap opacity-80 uppercase tracking-tight">
                          Updated: {approvedBrds.find(b => b.id === selectedBrdId)?.updated_at 
                            ? new Date(approvedBrds.find(b => b.id === selectedBrdId)!.updated_at).toLocaleDateString() 
                            : 'Unknown'}
                        </div>
                      )}
                    </div>
                  </SelectTrigger>
                  <SelectContent
                    className="w-[var(--radix-select-trigger-width)] min-w-[var(--radix-select-trigger-width)] max-h-[400px] overflow-hidden p-0 bg-popover border border-border shadow-md rounded-md"
                    position="popper"
                    sideOffset={5}
                    collisionPadding={20}
                  >
                    <div className="overflow-y-auto py-1 px-1 custom-scrollbar max-h-[350px] pb-12">
                      {loadingBrds ? (
                        <SelectItem value="loading" disabled className="py-8">
                          <div className="flex items-center justify-center gap-2 w-full">
                            <Loader2 className="h-4 w-4 animate-spin text-primary" />
                            <span className="text-sm font-medium">Loading BRDs...</span>
                          </div>
                        </SelectItem>
                      ) : approvedBrds.length === 0 ? (
                        <SelectItem value="empty" disabled className="py-8 text-center">
                          <span className="text-muted-foreground italic text-sm">No approved BRDs available</span>
                        </SelectItem>
                      ) : (
                        <div className="flex flex-col gap-1 pr-1">
                          {approvedBrds.map((brd) => (
                            <SelectItem 
                              key={brd.id} 
                              value={brd.id} 
                              className="max-w-full cursor-pointer focus:bg-accent focus:text-accent-foreground mb-1 rounded-sm transition-colors"
                            >
                              <div className="flex flex-col w-full overflow-hidden py-1.5 px-0.5">
                                <span className="font-medium text-sm truncate block w-full leading-tight mb-1">
                                  {brd.title}
                                </span>
                                <span className="text-[9px] text-muted-foreground/70 truncate block w-full uppercase tracking-tighter font-semibold">
                                  Updated: {brd.updated_at ? new Date(brd.updated_at).toLocaleDateString() : 'Unknown'}
                                </span>
                              </div>
                            </SelectItem>
                          ))}
                          {/* Extreme safety spacer to ensure last item is pushed far above the clipping zone */}
                          <div className="h-16 w-full opacity-0" aria-hidden="true" />
                        </div>
                      )}
                    </div>
                  </SelectContent>
                </Select>
              </div>

              <div className="flex-1 overflow-hidden p-4">
                {loadingBrdContent ? (
                  <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    Loading BRD content...
                  </div>
                ) : selectedBrdContent ? (
                  <div className="h-full overflow-y-auto custom-scrollbar p-6">
                    <div className="prose prose-sm dark:prose-invert max-w-none">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>
                        {removeDuplicateHeadings(selectedBrdContent)}
                      </ReactMarkdown>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
                    Select a BRD to view content
                  </div>
                )}
              </div>
            </div>

            {/* Right Panel - Generated Test Plan */}
            <div className="w-1/2 border rounded-lg flex flex-col">
              <div className="p-4 border-b flex items-center justify-between">
                <h3 className="font-medium text-sm">Generated Test Plan</h3>
                {testPlan && (
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={handleCopy} title="Copy to clipboard">
                      {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                    </Button>
                    <Button size="sm" variant="outline" onClick={handleDownload} title="Download as Markdown">
                      <Download className="h-4 w-4" />
                    </Button>
                  </div>
                )}
              </div>

              <div className="flex-1 overflow-hidden">
                <ScrollArea className="h-full">
                  {loading ? (
                    <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-3">
                      <Loader2 className="h-8 w-8 animate-spin" />
                      <div className="text-center">
                        <p className="font-medium">Generating comprehensive test plan...</p>
                        <p className="text-xs mt-1">This may take a minute</p>
                      </div>
                    </div>
                  ) : error ? (
                    <div className="p-4">
                      <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-800 text-sm">
                        <strong className="font-semibold">Error:</strong> {error}
                      </div>
                    </div>
                  ) : testPlan ? (
                    <div className="p-4">
                      <div className="bg-card border rounded-lg p-6 prose prose-sm max-w-none dark:prose-invert">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>{testPlan}</ReactMarkdown>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center justify-center h-full text-muted-foreground text-sm text-center px-8">
                      Select a BRD and click Generate to create a test plan
                    </div>
                  )}
                </ScrollArea>
              </div>
            </div>
          </div>

          <div className="flex justify-between items-center pt-4 border-t flex-shrink-0">
            <div className="flex items-center gap-2 text-sm">
              {testPlan && !pushed && (
                <span className="text-amber-500 font-medium">Unpushed test plan - Review and push to {providerShort} when ready</span>
              )}
              {pushed && (
                <span className="text-emerald-500 font-medium flex items-center gap-1">
                  <Check className="h-4 w-4" />
                  Test plan pushed successfully
                </span>
              )}
            </div>

            <div className="flex gap-2">
              <Button variant="outline" onClick={handleClose}>
                Close
              </Button>

              {/* View Saved Test Plans - always available when callback is provided */}
              {onViewSaved && (
                <Button
                  variant="outline"
                  onClick={() => { onViewSaved(); }}
                >
                  <Eye className="h-4 w-4 mr-2" />
                  View Saved Test Plans
                </Button>
              )}

              {/* Push Button - Always visible but disabled if no plan or already pushed */}
              <Button
                onClick={handlePushToAdo}
                disabled={pushing || !testPlan || pushed}
                variant="default"
                className={`min-w-[140px] ${pushed ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-blue-600 hover:bg-blue-700'}`}
              >
                {pushing ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Pushing...
                  </>
                ) : pushed ? (
                  <>
                    <Check className="h-4 w-4 mr-2" />
                    Pushed to {providerShort}
                  </>
                ) : (
                  <>
                    <Send className="h-4 w-4 mr-2" />
                    Push to {providerShort}
                  </>
                )}
              </Button>

              {/* Generate Button */}
              <Button
                onClick={handleGenerate}
                disabled={loading || !selectedBrdContent || selectedBrdContent.trim() === ""}
                className="min-w-[160px]"
              >
                {loading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    Generating...
                  </>
                ) : testPlan ? (
                  <>
                    <RefreshCw className="h-4 w-4 mr-2" />
                    Regenerate
                  </>
                ) : (
                  <>
                    <FileText className="h-4 w-4 mr-2" />
                    Generate Test Plan
                  </>
                )}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
