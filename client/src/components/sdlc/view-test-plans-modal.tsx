import { useState, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, FileText, Calendar, Clock, FolderOpen, Trash2, Check, ExternalLink, Download, Copy } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface TestPlan {
  id: string;
  testPlanName: string;
  brdId: string;
  brdTitle: string | null;
  projectId: string | null;
  organizationId: string | null;
  createdAt: Date;
  updatedAt: Date;
  adoId?: string;
  adoOrg?: string;
  adoProject?: string;
}

interface TestPlanWithContent extends TestPlan {
  content: string;
}

interface ViewTestPlansModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId?: string | null;
  organizationId?: string | null;
  integrationType?: string;
  onResume?: (brdId: string, content: string, testPlanId: string) => void;
  onCloseAll?: () => void;
}

export function ViewTestPlansModal({
  open,
  onOpenChange,
  projectId,
  organizationId,
  integrationType = "ado",
  onResume,
  onCloseAll,
}: ViewTestPlansModalProps) {
  const providerShort = integrationType === "jira" ? "Jira" : "ADO";
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [selectedTestPlanId, setSelectedTestPlanId] = useState<string | null>(null);
  const [selectedTestPlanContent, setSelectedTestPlanContent] = useState<string>("");
  const [loadingContent, setLoadingContent] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const contentScrollRef = useRef<HTMLDivElement>(null);

  const { data: testPlans = [], isLoading: loadingList } = useQuery({
    queryKey: ["/api/testing/test-plans", projectId, organizationId],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (projectId && projectId.trim() !== "") {
        params.append("projectId", projectId);
      }
      if (organizationId && organizationId.trim() !== "") {
        params.append("organizationId", organizationId);
      }

      const url = `/api/testing/test-plans${params.toString() ? `?${params.toString()}` : ""}`;
      const res = await apiRequest("GET", url);
      if (!res.ok) throw new Error("Failed to fetch test plans");
      return res.json();
    },
    enabled: open && !!projectId,
  });

  // Reset state when modal closes
  useEffect(() => {
    if (!open) {
      setSelectedTestPlanId(null);
      setSelectedTestPlanContent("");
      setError("");
    }
  }, [open]);

  // Fetch test plan content when a test plan is selected
  useEffect(() => {
    if (selectedTestPlanId) {
      fetchTestPlanContent(selectedTestPlanId);
    } else {
      setSelectedTestPlanContent("");
    }
  }, [selectedTestPlanId]);


  const fetchTestPlanContent = async (testPlanId: string) => {
    setLoadingContent(true);
    setError("");
    try {
      const res = await apiRequest("GET", `/api/testing/test-plans/${testPlanId}`);

      if (res.ok) {
        const data: TestPlanWithContent = await res.json();
        setSelectedTestPlanContent(data.content || "");
      } else {
        const errorData = await res.json().catch(() => ({ error: "Failed to fetch test plan content" }));
        setError(errorData.error || "Failed to fetch test plan content");
        setSelectedTestPlanContent("");
      }
    } catch (err) {
      console.error("[ViewTestPlans] Error fetching test plan content:", err);
      setError("Failed to load test plan content. Please try again.");
      setSelectedTestPlanContent("");
    } finally {
      setLoadingContent(false);
    }
  };

  const deleteMutation = useMutation({
    mutationFn: async () => {
      if (!selectedTestPlanId) return;
      const res = await apiRequest("DELETE", `/api/testing/test-plans/${selectedTestPlanId}`);
      if (!res.ok) throw new Error("Failed to delete session");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/testing/test-plans", projectId, organizationId] });
      toast({
        description: "Test plan session deleted successfully",
        duration: 3000,
      });
      setSelectedTestPlanId(null);
      setSelectedTestPlanContent("");
    },
    onError: (err: any) => {
      setError(err.message || "Failed to delete session");
    }
  });

  const handleContentLinkClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    if (target.tagName === 'A' && target.getAttribute('href')?.startsWith('#')) {
      e.preventDefault();
      const anchor = target.getAttribute('href')?.substring(1);
      if (anchor && contentScrollRef.current) {
        const element = contentScrollRef.current.querySelector(`[id="${anchor}"]`);
        if (element) {
          element.scrollIntoView({ behavior: 'smooth', block: 'start' });
        } else {
          // Fallback: search for heading containing the anchor text
          const headings = contentScrollRef.current.querySelectorAll('h1, h2, h3, h4, h5, h6');
          for (const heading of headings) {
            const text = heading.textContent || '';
            if (text.toLowerCase().includes(anchor.toLowerCase().replace(/-/g, ' '))) {
              heading.scrollIntoView({ behavior: 'smooth', block: 'start' });
              break;
            }
          }
        }
      }
    }
  };

  const handleDeleteSession = async () => {
    if (!selectedTestPlanId) return;
    deleteMutation.mutate();
  };

  const selectedTestPlan = testPlans.find((tp: TestPlan) => tp.id === selectedTestPlanId);

  const handleDownload = () => {
    if (!selectedTestPlanContent || !selectedTestPlan) return;
    const fileName = `${selectedTestPlan.testPlanName.replace(/[^a-z0-9]/gi, '_')}.md`;
    const blob = new Blob([selectedTestPlanContent], { type: "text/markdown" });
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
    if (!selectedTestPlanContent) return;
    try {
      await navigator.clipboard.writeText(selectedTestPlanContent);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      toast({ description: "Test plan copied to clipboard" });
    } catch {
      toast({ description: "Failed to copy test plan", variant: "destructive" });
    }
  };

  // Custom markdown components with heading IDs for scroll navigation
  const markdownComponents = {
    h1: ({ children }: any) => {
      const id = String(children).toLowerCase().replace(/[^\w\s-]/g, '').replace(/\s+/g, '-');
      return <h1 id={id}>{children}</h1>;
    },
    h2: ({ children }: any) => {
      const id = String(children).toLowerCase().replace(/[^\w\s-]/g, '').replace(/\s+/g, '-');
      return <h2 id={id}>{children}</h2>;
    },
    h3: ({ children }: any) => {
      const id = String(children).toLowerCase().replace(/[^\w\s-]/g, '').replace(/\s+/g, '-');
      return <h3 id={id}>{children}</h3>;
    },
    h4: ({ children }: any) => {
      const id = String(children).toLowerCase().replace(/[^\w\s-]/g, '').replace(/\s+/g, '-');
      return <h4 id={id}>{children}</h4>;
    },
    h5: ({ children }: any) => {
      const id = String(children).toLowerCase().replace(/[^\w\s-]/g, '').replace(/\s+/g, '-');
      return <h5 id={id}>{children}</h5>;
    },
    h6: ({ children }: any) => {
      const id = String(children).toLowerCase().replace(/[^\w\s-]/g, '').replace(/\s+/g, '-');
      return <h6 id={id}>{children}</h6>;
    },
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-7xl h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            View Test Plans
          </DialogTitle>
          <DialogDescription>
            Select and view generated test plan documents
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 flex flex-col gap-4 overflow-hidden">
          {/* Test Plan Selection */}
          <div className="space-y-2 px-1">
            <label className="text-sm font-medium">Select Test Plan</label>
            {loadingList ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground p-4 border rounded-md">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading test plans...
              </div>
            ) : testPlans.length > 0 ? (
                <Select
                  value={selectedTestPlanId || ""}
                  onValueChange={setSelectedTestPlanId}
                >
                  <SelectTrigger className="w-full h-auto py-2 pr-10 focus:ring-1 focus:ring-primary/30">
                    <div className="flex items-center justify-between w-full pr-2">
                      <div className="flex flex-col items-start min-w-0">
                        <span className="font-medium text-sm truncate max-w-[400px]">
                          {selectedTestPlan ? selectedTestPlan.testPlanName : "Choose a test plan to view"}
                        </span>
                      </div>
                      {selectedTestPlan && (
                        <div className="ml-auto flex items-center gap-2 text-[10px] text-muted-foreground bg-muted/50 px-2 py-0.5 rounded border border-border/50 whitespace-nowrap opacity-80 uppercase tracking-tight">
                          <span>{selectedTestPlan.brdTitle || "Individual"}</span>
                          <span className="text-border">|</span>
                          <span>Updated: {new Date(selectedTestPlan.updatedAt).toLocaleDateString()}</span>
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
                      {testPlans.map((tp: TestPlan) => (
                        <SelectItem key={tp.id} value={tp.id} textValue={tp.testPlanName} className="max-w-full cursor-pointer focus:bg-accent focus:text-accent-foreground mb-1 rounded-sm transition-colors">
                          <div className="flex flex-col items-start min-w-0 py-1.5 px-0.5 w-full">
                            <div className="flex items-center justify-between w-full mb-1">
                              <span className="font-medium text-sm truncate">{tp.testPlanName}</span>
                              {tp.adoId && (
                                <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200 text-[9px] py-0 h-3.5 px-1 font-normal whitespace-nowrap ml-2 uppercase tracking-tighter">
                                  ADO Linked
                                </Badge>
                              )}
                            </div>
                            <span className="text-[10px] text-muted-foreground/70 truncate uppercase tracking-tighter font-semibold block w-full opacity-80">
                              {tp.brdTitle || "Manual Plan"} • {new Date(tp.createdAt).toLocaleDateString()}
                            </span>
                          </div>
                        </SelectItem>
                      ))}
                      {/* Extreme safety buffer zone to prevent the last item from being clipped by dropdown edges or scroll indicators */}
                      <div className="h-16 w-full opacity-0 pointer-events-none" aria-hidden="true" />
                    </div>
                  </SelectContent>
              </Select>
            ) : (
              <div className="flex items-center gap-2 text-sm text-muted-foreground p-4 border rounded-md">
                <FolderOpen className="h-4 w-4" />
                {error || "No test plans available. Generate a test plan first."}
              </div>
            )}
          </div>

          {/* Test Plan Metadata */}
          {selectedTestPlan && (
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6 p-6 bg-muted/30 border border-border/50 rounded-xl shadow-sm">
              <div className="space-y-1.5">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold">Test Plan Name</p>
                <p className="text-sm font-semibold truncate text-foreground">{selectedTestPlan.testPlanName}</p>
              </div>
              
              <div className="space-y-1.5">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold">BRD Reference</p>
                <p className="text-sm font-semibold truncate text-foreground">{selectedTestPlan.brdTitle || "N/A"}</p>
              </div>

              <div className="space-y-1.5 border-l border-border/30 pl-6">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold flex items-center gap-1.5">
                  <Calendar className="h-3 w-3" /> Created Date
                </p>
                <p className="text-sm font-medium text-foreground/80">{new Date(selectedTestPlan.createdAt).toLocaleString()}</p>
              </div>

              <div className="space-y-1.5 border-l border-border/30 pl-6">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold flex items-center gap-1.5">
                  <Clock className="h-3 w-3" /> Last Updated
                </p>
                <p className="text-sm font-medium text-foreground/80">{new Date(selectedTestPlan.updatedAt).toLocaleString()}</p>
              </div>
            </div>
          )}

          {/* Test Plan Content */}
          <div className="flex-1 overflow-hidden flex flex-col">
            <label className="text-sm font-medium mb-2">Test Plan Content</label>
            <div className="flex-1 overflow-y-auto border rounded-md bg-card" ref={contentScrollRef} onClick={handleContentLinkClick}>
              {loadingContent ? (
                <div className="flex items-center justify-center h-full p-8">
                  <div className="flex flex-col items-center gap-2">
                    <Loader2 className="h-8 w-8 animate-spin text-primary" />
                    <span className="text-sm text-muted-foreground">Loading test plan content...</span>
                  </div>
                </div>
              ) : selectedTestPlanContent ? (
                <div className="prose prose-sm max-w-none dark:prose-invert p-6">
                  <ReactMarkdown 
                    remarkPlugins={[remarkGfm]} 
                    components={markdownComponents}
                  >
                    {selectedTestPlanContent}
                  </ReactMarkdown>
                </div>
              ) : (
                <div className="flex items-center justify-center h-full p-8 text-sm text-muted-foreground">
                  {error || "Select a test plan to view its content"}
                </div>
              )}
            </div>
          </div>

          {/* Error Display */}
          {error && !loadingList && !loadingContent && (
            <div className="p-3 bg-destructive/10 text-destructive rounded-md text-sm">
              {error}
            </div>
          )}
        </div>

        <div className="flex justify-between items-center gap-2 pt-4 border-t w-full">
          <div className="flex gap-2">
            {selectedTestPlan && (
              <Button
                variant="destructive"
                onClick={handleDeleteSession}
                disabled={deleteMutation.isPending}
              >
                {deleteMutation.isPending ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Trash2 className="h-4 w-4 mr-2" />
                )}
                Delete Session
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={handleCopy}
              disabled={!selectedTestPlanContent}
              title="Copy to clipboard"
            >
              {copied ? <Check className="h-4 w-4 mr-2" /> : <Copy className="h-4 w-4 mr-2" />}
              {copied ? "Copied" : "Copy"}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleDownload}
              disabled={!selectedTestPlanContent}
              title="Download as Markdown"
            >
              <Download className="h-4 w-4 mr-2" />
              Download
            </Button>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Back
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                onOpenChange(false);
                if (onCloseAll) {
                  onCloseAll();
                } else {
                  setLocation("/sdlc");
                }
              }}
            >
              Close
            </Button>
            {onResume && selectedTestPlan && (
              <Button
                onClick={() => {
                  onResume(selectedTestPlan.brdId, selectedTestPlanContent, selectedTestPlan.id);
                  onOpenChange(false);
                }}
                disabled={!selectedTestPlanContent || loadingContent}
              >
                Resume Session
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
