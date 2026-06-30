/**
 * Jira-specific push logic for Step 3
 * Handles pushing to Jira and Confluence when project integrationType is 'jira'
 */

import { getApiUrl } from "@/lib/api-config";
import { apiRequest } from "@/lib/queryClient";
import { pollAsyncJob } from "@/lib/async-job-poller";
import toast from "react-hot-toast";
import { useState, useMemo, useEffect } from "react";
import { useWorkflow } from "@/context/workflow-context";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, Rocket, CheckCircle2, AlertCircle, ExternalLink, BookOpen, ChevronLeft } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import type { Epic, Feature, UserStory, WikiPage } from "@shared/schema";

export interface JiraPushConfig {
  instanceUrl: string;
  projectKey: string;
  email: string;
  apiToken: string;
  spaceKey?: string;
}

/**
 * Push work items to Jira
 */
export async function pushToJira(
  projectId: string,
  selectedItems: Array<{ type: string; id: string }>,
  epics: any[],
  features: any[],
  userStories: any[],
  personas: any[],
  brdId: string | null,
  requirementIds: string[],
  config?: JiraPushConfig,
  onProgress?: (message: string, percent?: number) => void,
  onJobStarted?: (jobId: string) => void
): Promise<{
  success: boolean;
  message: string;
  created: number;
  skipped: number;
  failed: number;
  createdItems: any[];
  skippedItems: any[];
  failedItems: any[];
  errors: string[];
  subtasksCreated: number;
  testCasesCreated: number;
  url: string;
  pagesCreated?: number;
  confluenceUrl?: string;
  pageUrls?: string[];
}> {
  const response = await apiRequest(
    "POST",
    `/api/sdlc/projects/${projectId}/push-to-jira`,
    {
      selectedItems,
      epics,
      features,
      userStories,
      personas,
      brdId,
      requirementIds,
      config: config ? {
        instanceUrl: config.instanceUrl,
        projectKey: config.projectKey,
        email: config.email,
        apiToken: config.apiToken,
        spaceKey: config.spaceKey,
      } : undefined,
    }
  );

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || "Failed to push to Jira");
  }

  let result = await response.json();

  // Async-job pattern: server returns 202 + jobId immediately to dodge AWS
  // API Gateway's 29s timeout. Poll the universal job status endpoint.
  if (response.status === 202 && result?.jobId) {
    onJobStarted?.(result.jobId);
    result = await pollAsyncJob<typeof result>("sdlc-push-to-jira", result.jobId, {
      onProgress
    });
  }

  return {
    success: result.success,
    message: result.message || "Push completed",
    created: result.created || 0,
    skipped: result.skipped || 0,
    failed: result.failed || 0,
    createdItems: result.createdItems || [],
    skippedItems: result.skippedItems || [],
    failedItems: result.failedItems || [],
    errors: result.errors || [],
    subtasksCreated: result.subtasksCreated || 0,
    testCasesCreated: result.testCasesCreated || 0,
    url: result.url || "",
    pagesCreated: result.pagesCreated,
    confluenceUrl: result.confluenceUrl,
    pageUrls: result.pageUrls,
  };
}

/**
 * Push wiki pages to Confluence
 */
export async function pushToConfluence(
  projectId: string,
  wikiPages: Array<{ id: string; title: string; content: string; pageType: string; order: number }>,
  config?: JiraPushConfig,
  onProgress?: (message: string, percent?: number) => void
): Promise<{
  success: boolean;
  partialSuccess?: boolean;
  message: string;
  pagesCreated: number;
  pagesUpdated?: number;
  pagesSucceeded?: number;
  succeededWikiIds?: string[];
  confluenceUrl?: string;
  pageUrls: string[];
  errors: string[];
}> {
  const response = await apiRequest(
    "POST",
    `/api/sdlc/projects/${projectId}/push-to-confluence`,
    {
      wikiPages,
      config: config ? {
        instanceUrl: config.instanceUrl,
        projectKey: config.projectKey,
        email: config.email,
        apiToken: config.apiToken,
        spaceKey: config.spaceKey,
      } : undefined,
    }
  );

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || "Failed to push to Confluence");
  }

  let result = await response.json();

  // Async-job pattern: server returns 202 + jobId immediately to dodge AWS
  // API Gateway's 29s timeout (which 503s any synchronous bulk push).
  if (response.status === 202 && result?.jobId) {
    result = await pollAsyncJob<typeof result>("sdlc-push-to-confluence", result.jobId, {
      onProgress
    });
  }

  return {
    success: result.success,
    partialSuccess: result.partialSuccess,
    message: result.message || "Push completed",
    pagesCreated: result.pagesCreated || 0,
    pagesUpdated: result.pagesUpdated || 0,
    pagesSucceeded: result.pagesSucceeded ?? result.pagesCreated ?? 0,
    succeededWikiIds: result.succeededWikiIds || [],
    confluenceUrl: result.confluenceUrl,
    pageUrls: result.pageUrls || [],
    errors: result.errors || [],
  };
}

/**
 * Get project integration type
 */
export async function getProjectIntegrationType(projectId: string): Promise<'ado' | 'jira'> {
  try {
    const response = await fetch(
      getApiUrl(`/api/sdlc/projects/${projectId}/details`),
      {
        credentials: "include",
      }
    );

    if (response.ok) {
      const data = await response.json();
      return data.project?.integrationType || 'ado';
    }
  } catch (error) {
    console.error("Error fetching project integration type:", error);
  }

  return 'ado'; // Default to ADO
}

/**
 * Step3DevOpsPushJira Component
 * Provides UI for pushing artifacts to Jira and Confluence
 */
type ActiveJiraPushJob = {
  jobId: string;
  selectedEpics: string[];
  selectedFeatures: string[];
  selectedStories: string[];
  startedAt: string;
};

const getActiveJiraPushStorageKey = (sessionId: string) =>
  `workflowActiveJiraPush_${sessionId}`;

export function Step3DevOpsPushJira() {
  const {
    sessionId,
    projectId,
    epics,
    features,
    userStories,
    personas,
    wikiPages,
    selectedEpics,
    selectedFeatures,
    selectedStories,
    selectedWikiPages,
    setSelectedEpics,
    setSelectedFeatures,
    setSelectedStories,
    setSelectedWikiPages,
    toggleEpic,
    toggleFeature,
    toggleStory,
    brdId,
    selectedRequirementIds: requirementIds,
    setCurrentStep,
    pushedEpics,
    pushedFeatures,
    pushedStories,
    pushedWikiPages,
    setPushedEpics,
    setPushedFeatures,
    setPushedStories,
    setPushedWikiPages,
    selectAllUnpushed,
  } = useWorkflow();

  const [isPushingJira, setIsPushingJira] = useState(false);
  const [isPushingConfluence, setIsPushingConfluence] = useState(false);
  const [hasAutoSelected, setHasAutoSelected] = useState(false);
  const [pushUrl, setPushUrl] = useState("");
  const [confluenceUrl, setConfluenceUrl] = useState("");
  const [progressJira, setProgressJira] = useState(0);
  const [progressConfluence, setProgressConfluence] = useState(0);
  const [currentStepLabelJira, setCurrentStepLabelJira] = useState("");
  const [currentStepLabelConfluence, setCurrentStepLabelConfluence] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [resumedJiraJobId, setResumedJiraJobId] = useState<string | null>(null);

  // Dialog state for showing issue types
  const [showIssueTypesDialog, setShowIssueTypesDialog] = useState(false);
  const [projectIssueTypes, setProjectIssueTypes] = useState<any[]>([]);
  const [loadingIssueTypes, setLoadingIssueTypes] = useState(false);

  useEffect(() => {
    if (epics.length > 0 && !hasAutoSelected && selectedEpics.size === 0) {
      selectAllUnpushed();
      setHasAutoSelected(true);
    }
  }, [epics.length, hasAutoSelected, selectedEpics.size, selectAllUnpushed]);

  const visibleWikiPages = useMemo(() => {
    return wikiPages.filter((w) => {
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        return (
          w.title?.toLowerCase().includes(q) ||
          w.pageType?.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [wikiPages, searchQuery]);

  const unpushedSelectedEpics = [...selectedEpics].filter(id => !pushedEpics.has(id)).length;
  const unpushedSelectedFeatures = [...selectedFeatures].filter(id => !pushedFeatures.has(id)).length;
  const unpushedSelectedStories = [...selectedStories].filter(id => !pushedStories.has(id)).length;
  const totalToPush = unpushedSelectedEpics + unpushedSelectedFeatures + unpushedSelectedStories;

  const selectedWikiCount = selectedWikiPages.size;
  const totalWikiToPush = selectedWikiCount;

  const allJiraItemsPushed = epics.length > 0 &&
    epics.every(e => pushedEpics.has(e.id)) &&
    features.every(f => pushedFeatures.has(f.id)) &&
    userStories.every(s => pushedStories.has(s.id));

  const allWikiPagesPushed = wikiPages.length > 0 &&
    wikiPages.every(w => pushedWikiPages.has(w.id));

  const persistPushedState = (
    epicIds: Set<string>,
    featureIds: Set<string>,
    storyIds: Set<string>,
    wikiIds: Set<string>,
  ) => {
    if (!sessionId) return;
    const pushedItems = {
      epics: Array.from(epicIds).map(id => ({ id })),
      features: Array.from(featureIds).map(id => ({ id })),
      userStories: Array.from(storyIds).map(id => ({ id })),
      wikiPages: Array.from(wikiIds).map(id => ({ id })),
    };
    apiRequest("POST", `/api/sessions/${sessionId}/workflow-steps/3`, {
      stepName: "devops_push",
      step3Data: { pushedItems, pushStatus: "completed" },
    }).catch(err => console.warn("[Step3-Jira] Failed to persist pushed state:", err));
  };

  const persistActiveJiraPushJob = (job: ActiveJiraPushJob) => {
    if (!sessionId) return;
    localStorage.setItem(getActiveJiraPushStorageKey(sessionId), JSON.stringify(job));
    apiRequest("POST", `/api/sessions/${sessionId}/workflow-steps/3`, {
      stepName: "devops_push",
      step3Data: { pushStatus: "in_progress" },
    }).catch(err => console.warn("[Step3-Jira] Failed to persist active push status:", err));
  };

  const clearActiveJiraPushJob = () => {
    if (!sessionId) return;
    localStorage.removeItem(getActiveJiraPushStorageKey(sessionId));
  };

  useEffect(() => {
    if (!sessionId || resumedJiraJobId || isPushingJira) return;

    const raw = localStorage.getItem(getActiveJiraPushStorageKey(sessionId));
    if (!raw) {
      let cancelled = false;
      fetch(getApiUrl(`/api/sessions/${sessionId}/workflow-steps/3`), {
        credentials: "include",
      })
        .then((response) => response.ok ? response.json() : null)
        .then((payload) => {
          if (cancelled) return;
          if (payload?.data?.pushStatus === "in_progress") {
            setError("A Jira push was started for this session, but its live job id is not available in this browser. Refresh artifacts and retry only remaining unpushed items.");
          }
        })
        .catch(() => {});
      return () => {
        cancelled = true;
      };
    }

    let activeJob: ActiveJiraPushJob | null = null;
    try {
      activeJob = JSON.parse(raw) as ActiveJiraPushJob;
    } catch {
      localStorage.removeItem(getActiveJiraPushStorageKey(sessionId));
      return;
    }

    if (!activeJob?.jobId) return;

    let cancelled = false;
    setResumedJiraJobId(activeJob.jobId);
    setIsPushingJira(true);
    setError(null);
    setProgressJira(0);
    setCurrentStepLabelJira("Reconnecting to Jira push status...");

    void pollAsyncJob<any>("sdlc-push-to-jira", activeJob.jobId, {
      onProgress: (message, percent) => {
        if (cancelled) return;
        if (message) setCurrentStepLabelJira(message);
        if (percent !== undefined) setProgressJira(percent);
      },
    })
      .then((result) => {
        if (cancelled) return;
        const newPushedEpics = new Set([...pushedEpics, ...activeJob!.selectedEpics]);
        const newPushedFeatures = new Set([...pushedFeatures, ...activeJob!.selectedFeatures]);
        const newPushedStories = new Set([...pushedStories, ...activeJob!.selectedStories]);
        setPushedEpics(newPushedEpics);
        setPushedFeatures(newPushedFeatures);
        setPushedStories(newPushedStories);
        persistPushedState(newPushedEpics, newPushedFeatures, newPushedStories, pushedWikiPages);
        clearActiveJiraPushJob();
        setPushUrl(result?.url || "");
        setProgressJira(100);
        setCurrentStepLabelJira("Jira push completed.");
        toast.success(`Successfully pushed ${result?.created || 0} items to Jira`);
      })
      .catch((err) => {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : String(err);
        if (message.toLowerCase().includes("job not found")) {
          setError("Previous Jira push status is no longer available. Refresh the artifacts and retry only any remaining unpushed items.");
          clearActiveJiraPushJob();
        } else {
          setError(message || "Jira push failed");
        }
      })
      .finally(() => {
        if (cancelled) return;
        setIsPushingJira(false);
      });

    return () => {
      cancelled = true;
    };
  }, [sessionId, resumedJiraJobId, isPushingJira]);

  // Function to fetch and show issue types dialog
  const showIssueTypesDialogHandler = async () => {
    if (totalToPush === 0) {
      if (allJiraItemsPushed) {
        toast.error("All items have already been pushed to Jira");
      } else {
        toast.error("Please select at least one item to push to Jira");
      }
      return;
    }

    setIsPushingJira(true); // Show loading state on the button
    
    try {
      // 1. Check permissions first
      const permRes = await fetch(`/api/jira/projects/${projectId}/permissions`, { credentials: 'include' });
      if (permRes.ok) {
        const permData = await permRes.json();
        if (permData.success && permData.hasPermission === false && !permData.unknown) {
          // Attempt auto-add
          toast.loading("Adding you to the Jira project...", { id: "auto-add-toast" });
          const addRes = await fetch(`/api/jira/projects/${projectId}/auto-add`, { 
            method: 'POST',
            credentials: 'include' 
          });
          
          if (addRes.ok) {
            const addData = await addRes.json();
            if (addData.success) {
              toast.success("Successfully added you to the Jira project!", { id: "auto-add-toast" });
            } else {
              toast.error("Failed to add you to the Jira project. Please ask a project admin to add you.", { id: "auto-add-toast" });
              setIsPushingJira(false);
              return;
            }
          } else {
            toast.error("You don't have permission to push to this Jira project. Please ask an admin to add you.", { id: "auto-add-toast" });
            setIsPushingJira(false);
            return;
          }
        }
      } else if (permRes.status === 428 || permRes.status === 401) {
        const data = await permRes.json().catch(() => ({}));
        toast.error(data.error || data.message || "Configure and validate your personal Jira API key before pushing to this project.");
        setIsPushingJira(false);
        return;
      }

      setLoadingIssueTypes(true);
      setShowIssueTypesDialog(true);
      setIsPushingJira(false); // Remove spinner from button now that dialog is opening

      const response = await fetch(`/api/jira/projects/${projectId}/issue-types`, {
        credentials: 'include'
      });

      if (response.ok) {
        const data = await response.json();
        if (data.success && data.issueTypes) {
          setProjectIssueTypes(data.issueTypes);
        } else {
          setProjectIssueTypes([]);
        }
      } else if (response.status === 428 || response.status === 401) {
        const data = await response.json().catch(() => ({}));
        setProjectIssueTypes([]);
        toast.error(data.error || data.message || "Configure and validate your personal Jira API key before pushing to this project.");
        setShowIssueTypesDialog(false);
      } else {
        setProjectIssueTypes([]);
      }
    } catch (error) {
      console.error('Error fetching issue types or checking permissions:', error);
      setProjectIssueTypes([]);
      toast.error("An error occurred while preparing to push.");
      setIsPushingJira(false);
    } finally {
      setLoadingIssueTypes(false);
    }
  };

  const handlePush = async () => {

    setIsPushingJira(true);
    setError(null);
    setProgressJira(0);
    setCurrentStepLabelJira("Push in progress. This may take a few minutes...");

    try {
      const selectedItems = [
        ...Array.from(selectedEpics).filter(id => !pushedEpics.has(id)).map(id => ({ type: "epic" as const, id })),
        ...Array.from(selectedFeatures).filter(id => !pushedFeatures.has(id)).map(id => ({ type: "feature" as const, id })),
        ...Array.from(selectedStories).filter(id => !pushedStories.has(id)).map(id => ({ type: "story" as const, id })),
      ];
      const selectedEpicIdsForPush = Array.from(selectedEpics).filter(id => !pushedEpics.has(id));
      const selectedFeatureIdsForPush = Array.from(selectedFeatures).filter(id => !pushedFeatures.has(id));
      const selectedStoryIdsForPush = Array.from(selectedStories).filter(id => !pushedStories.has(id));

      const result = await pushToJira(
        projectId!,
        selectedItems,
        epics,
        features,
        userStories,
        personas,
        brdId,
        requirementIds,
        undefined,
        (message, percent) => {
          if (message) setCurrentStepLabelJira(message);
          if (percent !== undefined) setProgressJira(percent);
        },
        (jobId) => {
          persistActiveJiraPushJob({
            jobId,
            selectedEpics: selectedEpicIdsForPush,
            selectedFeatures: selectedFeatureIdsForPush,
            selectedStories: selectedStoryIdsForPush,
            startedAt: new Date().toISOString(),
          });
        }
      );

      if (result.success) {
        setPushUrl(result.url);
        if (result.confluenceUrl) setConfluenceUrl(result.confluenceUrl);

        const newPushedEpics = new Set(pushedEpics);
        selectedEpics.forEach(id => newPushedEpics.add(id));
        setPushedEpics(newPushedEpics);

        const newPushedFeatures = new Set(pushedFeatures);
        selectedFeatures.forEach(id => newPushedFeatures.add(id));
        setPushedFeatures(newPushedFeatures);

        const newPushedStories = new Set(pushedStories);
        selectedStories.forEach(id => newPushedStories.add(id));
        setPushedStories(newPushedStories);

        persistPushedState(newPushedEpics, newPushedFeatures, newPushedStories, pushedWikiPages);
        clearActiveJiraPushJob();

        toast.success(`Successfully pushed ${result.created} items to Jira`);
      } else {
        throw new Error(result.message || "Failed to push to Jira");
      }
    } catch (err: any) {
      console.error("Push Error:", err);
      clearActiveJiraPushJob();
      setError(err.message || "An error occurred during the push process");
      toast.error(err.message || "Failed to push to Jira");
    } finally {
      setIsPushingJira(false);
      setProgressJira(100);
    }
  };

  const handlePushConfluence = async () => {
    if (totalWikiToPush === 0) {
      toast.error("Please select at least one Confluence page to push");
      return;
    }

    setIsPushingConfluence(true);
    setError(null);
    setProgressConfluence(0);
    setCurrentStepLabelConfluence("Pushing documentation to Confluence...");

    try {
      const selectedWiki = wikiPages
        .filter(p => selectedWikiPages.has(p.id))
        .map(p => ({
          id: p.id,
          title: p.title,
          content: p.content,
          pageType: p.pageType,
          order: p.order || 0
        }));

      if (selectedWiki.length === 0) {
        throw new Error(
          "No matching wiki pages found for your selection. Regenerate Confluence docs in Step 2, then try again."
        );
      }
      if (selectedWiki.length < totalWikiToPush) {
        toast(
          `Only ${selectedWiki.length} of ${totalWikiToPush} selected pages are loaded — pushing those now. Refresh Step 2 if pages are missing.`,
          { icon: "!" }
        );
      }

      const result = await pushToConfluence(
        projectId!,
        selectedWiki,
        undefined,
        (message, percent) => {
          if (message) setCurrentStepLabelConfluence(message);
          if (percent !== undefined) setProgressConfluence(percent);
        }
      );

      const succeeded = result.succeededWikiIds?.length
        ? result.succeededWikiIds
        : selectedWiki.map(p => p.id);

      if (result.success || result.partialSuccess) {
        setConfluenceUrl(result.confluenceUrl || "");

        const newPushedWiki = new Set(pushedWikiPages);
        succeeded.forEach(id => newPushedWiki.add(id));
        setPushedWikiPages(newPushedWiki);

        persistPushedState(pushedEpics, pushedFeatures, pushedStories, newPushedWiki);

        const total = result.pagesSucceeded ?? result.pagesCreated ?? selectedWiki.length;
        toast.success(`Pushed ${total} page(s) to Confluence`);
        if (result.errors?.length) {
          toast.error(
            `${result.errors.length} page(s) failed: ${result.errors.slice(0, 2).join("; ")}${result.errors.length > 2 ? "…" : ""}`
          );
        }
      } else {
        const detail =
          result.errors?.length
            ? result.errors.join("\n")
            : result.message || "Failed to push to Confluence";
        throw new Error(detail);
      }
    } catch (err: any) {
      console.error("Confluence Push Error:", err);
      setError(err.message || "An error occurred during the Confluence push process");
      toast.error(err.message || "Failed to push to Confluence");
    } finally {
      setIsPushingConfluence(false);
      setProgressConfluence(100);
    }
  };

  const selectAllEpics = () => {
    const newSelected = new Set(selectedEpics);
    epics.forEach(e => { if (!pushedEpics.has(e.id)) newSelected.add(e.id); });
    setSelectedEpics(newSelected);
  };
  const deselectAllEpics = () => {
    const newSelected = new Set(selectedEpics);
    epics.forEach(e => newSelected.delete(e.id));
    setSelectedEpics(newSelected);
  };
  const selectAllFeatures = () => {
    const newSelected = new Set(selectedFeatures);
    features.forEach(f => { if (!pushedFeatures.has(f.id)) newSelected.add(f.id); });
    setSelectedFeatures(newSelected);
  };
  const deselectAllFeatures = () => {
    const newSelected = new Set(selectedFeatures);
    features.forEach(f => newSelected.delete(f.id));
    setSelectedFeatures(newSelected);
  };
  const selectAllStories = () => {
    const newSelected = new Set(selectedStories);
    userStories.forEach(s => { if (!pushedStories.has(s.id)) newSelected.add(s.id); });
    setSelectedStories(newSelected);
  };
  const deselectAllStories = () => {
    const newSelected = new Set(selectedStories);
    userStories.forEach(s => newSelected.delete(s.id));
    setSelectedStories(newSelected);
  };

  return (
    <div className="container mx-auto py-8 max-w-4xl space-y-6">
      <div className="flex items-center justify-between mb-2">
        <Button
          variant="ghost"
          onClick={() => setCurrentStep(2)}
          disabled={isPushingJira || isPushingConfluence}
          className="gap-2"
        >
          <ChevronLeft className="h-4 w-4" />
          Back to Content Review
        </Button>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="px-3 py-1">Jira Integration</Badge>
        </div>
      </div>

      <Card className="border-2">
        <CardHeader className="bg-muted/30 pb-4">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-2xl flex items-center gap-2">
                <Rocket className="h-6 w-6 text-primary" />
                Push to Jira & Confluence
              </CardTitle>
              <CardDescription>
                Select the artifacts you want to push, then click the push button.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-6 space-y-8">
          {/* Status Section for Jira */}
          {isPushingJira && (
            <div className="space-y-4 p-6 bg-primary/5 rounded-xl border border-primary/10 animate-in fade-in slide-in-from-top-4 duration-500">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Loader2 className="h-5 w-5 text-primary animate-spin" />
                  <span className="font-medium">{currentStepLabelJira || "Processing Jira push..."}</span>
                </div>
                <span className="text-sm font-bold text-primary">{progressJira}%</span>
              </div>
              <Progress value={progressJira} className="h-2" />
            </div>
          )}

          {/* Status Section for Confluence */}
          {isPushingConfluence && (
            <div className="space-y-4 p-6 bg-amber-500/5 rounded-xl border border-amber-500/10 animate-in fade-in slide-in-from-top-4 duration-500">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Loader2 className="h-5 w-5 text-amber-500 animate-spin" />
                  <span className="font-medium">{currentStepLabelConfluence || "Processing Confluence push..."}</span>
                </div>
                <span className="text-sm font-bold text-amber-500">{progressConfluence}%</span>
              </div>
              <Progress value={progressConfluence} className="h-2" />
            </div>
          )}

          {error && (
            <div className="p-4 bg-destructive/10 text-destructive rounded-lg flex items-start gap-3 border border-destructive/20">
              <AlertCircle className="h-5 w-5 shrink-0 mt-0.5" />
              <div className="text-sm font-medium">{error}</div>
            </div>
          )}

          {(pushUrl || confluenceUrl) && (
            <div className="p-6 bg-emerald-50 dark:bg-emerald-950/20 text-emerald-700 dark:text-emerald-400 rounded-xl border border-emerald-200 dark:border-emerald-800 space-y-4">
              <div className="flex items-center gap-3">
                <CheckCircle2 className="h-6 w-6" />
                <span className="font-bold text-lg">Push Completed!</span>
              </div>
              <div className="flex flex-wrap gap-3">
                {pushUrl && (
                  <Button asChild variant="outline" className="bg-background">
                    <a href={pushUrl} target="_blank" rel="noopener noreferrer" className="gap-2">
                      View in Jira <ExternalLink className="h-4 w-4" />
                    </a>
                  </Button>
                )}
                {confluenceUrl && (
                  <Button asChild variant="outline" className="bg-background">
                    <a href={confluenceUrl} target="_blank" rel="noopener noreferrer" className="gap-2">
                      View in Confluence <ExternalLink className="h-4 w-4" />
                    </a>
                  </Button>
                )}
              </div>
            </div>
          )}

          {/* Epics Selection */}
          {epics.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold flex items-center gap-2">
                  <Rocket className="h-4 w-4 text-purple-500" />
                  Epics
                  <Badge variant="secondary" className="px-2 py-0 h-5 text-[10px] bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400 border-none">
                    {[...selectedEpics].filter(id => !pushedEpics.has(id)).length} / {epics.length}
                  </Badge>
                </h3>
                <div className="flex items-center gap-2">
                  <Button variant="ghost" size="sm" className="h-7 text-xs text-primary hover:text-primary hover:bg-primary/10" onClick={selectAllEpics}>Select All</Button>
                  <span className="text-muted-foreground text-[10px]">|</span>
                  <Button variant="ghost" size="sm" className="h-7 text-xs text-muted-foreground hover:text-destructive hover:bg-destructive/10" onClick={deselectAllEpics}>Deselect All</Button>
                </div>
              </div>
              <div className="grid grid-cols-1 gap-2 max-h-[250px] overflow-y-auto pr-2 custom-scrollbar">
                {epics.map((epic) => {
                  const isPushed = pushedEpics.has(epic.id);
                  const isSelected = selectedEpics.has(epic.id);
                  return (
                    <div
                      key={epic.id}
                      className={cn(
                        "flex items-center gap-4 p-3 rounded-xl border transition-all cursor-pointer group",
                        isPushed && "opacity-60 bg-muted/20 border-muted cursor-default",
                        isSelected && !isPushed && "border-purple-400/40 bg-purple-500/[0.03] shadow-sm ring-1 ring-purple-400/10",
                        !isSelected && !isPushed && "hover:bg-muted/30"
                      )}
                      onClick={() => { if (!isPushed) toggleEpic(epic.id); }}
                    >
                      <div className={cn(
                        "h-5 w-5 rounded border flex items-center justify-center transition-colors shrink-0",
                        isPushed ? "bg-emerald-500 border-emerald-500" : isSelected ? "bg-purple-600 border-purple-600" : "border-muted-foreground/30 bg-background group-hover:border-purple-400/50"
                      )}>
                        {(isSelected || isPushed) && <CheckCircle2 className="h-3.5 w-3.5 text-white" strokeWidth={3} />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-sm truncate">{epic.title}</p>
                      </div>
                      {isPushed && (
                        <Badge className="bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300 border-none px-2 py-0 h-5 text-[10px]">Pushed</Badge>
                      )}
                      <Badge variant="outline" className="whitespace-nowrap h-5 px-2 py-0 font-normal text-[10px] opacity-60">Epic</Badge>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Features Selection */}
          {features.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold flex items-center gap-2">
                  <Rocket className="h-4 w-4 text-blue-500" />
                  Features
                  <Badge variant="secondary" className="px-2 py-0 h-5 text-[10px] bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 border-none">
                    {[...selectedFeatures].filter(id => !pushedFeatures.has(id)).length} / {features.length}
                  </Badge>
                </h3>
                <div className="flex items-center gap-2">
                  <Button variant="ghost" size="sm" className="h-7 text-xs text-primary hover:text-primary hover:bg-primary/10" onClick={selectAllFeatures}>Select All</Button>
                  <span className="text-muted-foreground text-[10px]">|</span>
                  <Button variant="ghost" size="sm" className="h-7 text-xs text-muted-foreground hover:text-destructive hover:bg-destructive/10" onClick={deselectAllFeatures}>Deselect All</Button>
                </div>
              </div>
              <div className="grid grid-cols-1 gap-2 max-h-[250px] overflow-y-auto pr-2 custom-scrollbar">
                {features.map((feature) => {
                  const isPushed = pushedFeatures.has(feature.id);
                  const isSelected = selectedFeatures.has(feature.id);
                  return (
                    <div
                      key={feature.id}
                      className={cn(
                        "flex items-center gap-4 p-3 rounded-xl border transition-all cursor-pointer group",
                        isPushed && "opacity-60 bg-muted/20 border-muted cursor-default",
                        isSelected && !isPushed && "border-blue-400/40 bg-blue-500/[0.03] shadow-sm ring-1 ring-blue-400/10",
                        !isSelected && !isPushed && "hover:bg-muted/30"
                      )}
                      onClick={() => { if (!isPushed) toggleFeature(feature.id); }}
                    >
                      <div className={cn(
                        "h-5 w-5 rounded border flex items-center justify-center transition-colors shrink-0",
                        isPushed ? "bg-emerald-500 border-emerald-500" : isSelected ? "bg-blue-600 border-blue-600" : "border-muted-foreground/30 bg-background group-hover:border-blue-400/50"
                      )}>
                        {(isSelected || isPushed) && <CheckCircle2 className="h-3.5 w-3.5 text-white" strokeWidth={3} />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-sm truncate">{feature.title}</p>
                        <p className="text-xs text-muted-foreground truncate opacity-70">Epic: {epics.find(e => e.id === feature.epicId)?.title || "—"}</p>
                      </div>
                      {isPushed && (
                        <Badge className="bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300 border-none px-2 py-0 h-5 text-[10px]">Pushed</Badge>
                      )}
                      <Badge variant="outline" className="whitespace-nowrap h-5 px-2 py-0 font-normal text-[10px] opacity-60">Feature</Badge>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* User Stories Selection */}
          {userStories.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold flex items-center gap-2">
                  <Rocket className="h-4 w-4 text-emerald-500" />
                  User Stories
                  <Badge variant="secondary" className="px-2 py-0 h-5 text-[10px] bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 border-none">
                    {[...selectedStories].filter(id => !pushedStories.has(id)).length} / {userStories.length}
                  </Badge>
                </h3>
                <div className="flex items-center gap-2">
                  <Button variant="ghost" size="sm" className="h-7 text-xs text-primary hover:text-primary hover:bg-primary/10" onClick={selectAllStories}>Select All</Button>
                  <span className="text-muted-foreground text-[10px]">|</span>
                  <Button variant="ghost" size="sm" className="h-7 text-xs text-muted-foreground hover:text-destructive hover:bg-destructive/10" onClick={deselectAllStories}>Deselect All</Button>
                </div>
              </div>
              <div className="grid grid-cols-1 gap-2 max-h-[250px] overflow-y-auto pr-2 custom-scrollbar">
                {userStories.map((story) => {
                  const isPushed = pushedStories.has(story.id);
                  const isSelected = selectedStories.has(story.id);
                  return (
                    <div
                      key={story.id}
                      className={cn(
                        "flex items-center gap-4 p-3 rounded-xl border transition-all cursor-pointer group",
                        isPushed && "opacity-60 bg-muted/20 border-muted cursor-default",
                        isSelected && !isPushed && "border-emerald-400/40 bg-emerald-500/[0.03] shadow-sm ring-1 ring-emerald-400/10",
                        !isSelected && !isPushed && "hover:bg-muted/30"
                      )}
                      onClick={() => { if (!isPushed) toggleStory(story.id); }}
                    >
                      <div className={cn(
                        "h-5 w-5 rounded border flex items-center justify-center transition-colors shrink-0",
                        isPushed ? "bg-emerald-500 border-emerald-500" : isSelected ? "bg-emerald-600 border-emerald-600" : "border-muted-foreground/30 bg-background group-hover:border-emerald-400/50"
                      )}>
                        {(isSelected || isPushed) && <CheckCircle2 className="h-3.5 w-3.5 text-white" strokeWidth={3} />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-sm truncate">{story.title}</p>
                        <p className="text-xs text-muted-foreground truncate opacity-70">{story.persona || "—"}</p>
                      </div>
                      {isPushed && (
                        <Badge className="bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300 border-none px-2 py-0 h-5 text-[10px]">Pushed</Badge>
                      )}
                      <Badge variant="outline" className="whitespace-nowrap h-5 px-2 py-0 font-normal text-[10px] opacity-60">Story</Badge>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Jira Push Button with Issue Types Dialog */}
          <div className="pt-2">
            <Dialog open={showIssueTypesDialog} onOpenChange={setShowIssueTypesDialog}>
              <Button
                className="w-full bg-gradient-to-r from-primary to-primary/80"
                disabled={isPushingJira || totalToPush === 0}
                onClick={showIssueTypesDialogHandler}
              >
                {isPushingJira ? (
                  <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Pushing to Jira...</>
                ) : allJiraItemsPushed ? (
                  <><CheckCircle2 className="mr-2 h-4 w-4" /> All Items Pushed to Jira</>
                ) : (
                  <>Push to Jira Backlog ({totalToPush} items)</>
                )}
              </Button>
              <DialogContent className="sm:max-w-md">
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2">
                    <ExternalLink className="h-5 w-5 text-blue-600" />
                    Jira Issue Types Configuration
                  </DialogTitle>
                  <DialogDescription>
                    These are the issue types configured for this Jira project. Your items will be created using these types based on the hierarchy strategy.
                  </DialogDescription>
                </DialogHeader>
                <div className="py-4">
                  {loadingIssueTypes ? (
                    <div className="space-y-3">
                      <Skeleton className="h-12 w-full" />
                      <Skeleton className="h-12 w-full" />
                      <Skeleton className="h-12 w-full" />
                    </div>
                  ) : projectIssueTypes.length > 0 ? (
                    <div className="space-y-2 max-h-64 overflow-y-auto">
                      {projectIssueTypes.map((issueType) => (
                        <div key={issueType.id} className="flex items-center justify-between p-3 border rounded-lg bg-white dark:bg-gray-800 shadow-sm">
                          <div className="flex items-center gap-3">
                            {issueType.iconUrl && (
                              <img src={issueType.iconUrl} alt={issueType.name} className="w-5 h-5" />
                            )}
                            <div>
                              <div className="font-medium text-sm text-black dark:text-white">{issueType.name}</div>
                              {issueType.description && (
                                <div className="text-xs text-gray-700 dark:text-gray-300">{issueType.description}</div>
                              )}
                            </div>
                          </div>
                          <Badge
                            variant="secondary"
                            className="text-[10px] h-5 bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-200"
                            title={`Hierarchy Level: ${issueType.hierarchyLevel ?? 'N/A'}`}
                          >
                            L{issueType.hierarchyLevel ?? '0'}
                          </Badge>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-center py-8 text-muted-foreground">
                      <ExternalLink className="h-8 w-8 mx-auto mb-2 text-gray-400" />
                      <p className="text-sm">No issue types found for this project</p>
                    </div>
                  )}
                </div>
                <DialogFooter className="gap-2">
                  <Button variant="outline" onClick={() => setShowIssueTypesDialog(false)}>
                    Cancel
                  </Button>
                  <Button
                    onClick={() => {
                      setShowIssueTypesDialog(false);
                      handlePush();
                    }}
                    className="bg-gradient-to-r from-primary to-primary/80"
                  >
                    Continue Push to Jira
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>

          {/* Divider */}
          <div className="border-t" />

          {/* Wiki Pages Selection */}
          {visibleWikiPages.length > 0 && (
            <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-500">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold flex items-center gap-2">
                  <BookOpen className="h-4 w-4 text-amber-500" />
                  Confluence Documentation
                  <Badge variant="secondary" className="px-2 py-0 h-5 text-[10px] bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 border-none">
                    {selectedWikiCount} / {wikiPages.length}
                  </Badge>
                </h3>
                <div className="flex items-center gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs text-primary hover:text-primary hover:bg-primary/10"
                    onClick={() => {
                      const newSelected = new Set(selectedWikiPages);
                      visibleWikiPages.forEach(p => newSelected.add(p.id));
                      setSelectedWikiPages(newSelected);
                    }}
                  >
                    Select All
                  </Button>
                  <span className="text-muted-foreground text-[10px]">|</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                    onClick={() => {
                      const newSelected = new Set(selectedWikiPages);
                      visibleWikiPages.forEach(p => {
                        newSelected.delete(p.id);
                      });
                      setSelectedWikiPages(newSelected);
                    }}
                  >
                    Deselect All
                  </Button>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-2 max-h-[300px] overflow-y-auto pr-2 custom-scrollbar">
                {visibleWikiPages.map((page) => {
                  const isPushed = pushedWikiPages.has(page.id);
                  const isSelected = selectedWikiPages.has(page.id);

                  return (
                    <div
                      key={page.id}
                      className={cn(
                        "flex items-center gap-4 p-3 rounded-xl border transition-all cursor-pointer group",
                        isPushed && !isSelected && "opacity-80 bg-muted/20 border-muted",
                        isSelected && "border-amber-400/40 bg-amber-500/[0.03] shadow-sm ring-1 ring-amber-400/10",
                        !isSelected && !isPushed && "hover:bg-muted/30"
                      )}
                      onClick={() => {
                        const newSelected = new Set(selectedWikiPages);
                        if (isSelected) {
                          newSelected.delete(page.id);
                        } else {
                          newSelected.add(page.id);
                        }
                        setSelectedWikiPages(newSelected);
                      }}
                    >
                      <div className={cn(
                        "h-5 w-5 rounded border flex items-center justify-center transition-colors shrink-0",
                        isSelected
                          ? "bg-amber-600 border-amber-600"
                          : isPushed
                            ? "border-emerald-500/60 bg-emerald-500/10"
                            : "border-muted-foreground/30 bg-background group-hover:border-amber-400/50"
                      )}>
                        {isSelected && <CheckCircle2 className="h-3.5 w-3.5 text-white" strokeWidth={3} />}
                        {!isSelected && isPushed && (
                          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" strokeWidth={2.5} />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-sm truncate">{page.title}</p>
                        <p className="text-xs text-muted-foreground truncate uppercase tracking-wider font-medium opacity-70">
                          {page.pageType}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        {isPushed && (
                          <Badge className="bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300 border-none px-2 py-0 h-5 text-[10px]">Pushed</Badge>
                        )}
                        <Badge variant="outline" className="whitespace-nowrap h-5 px-2 py-0 font-normal text-[10px] opacity-60">Confluence</Badge>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Confluence Push Button */}
          {wikiPages.length > 0 && (
            <div>
              <Button
                variant="outline"
                className="w-full border-primary/20 hover:bg-primary/5"
                disabled={isPushingConfluence || totalWikiToPush === 0}
                onClick={handlePushConfluence}
              >
                {isPushingConfluence ? (
                  <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Pushing to Confluence...</>
                ) : (
                  <>Push to Confluence ({selectedWikiCount} selected)</>
                )}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
