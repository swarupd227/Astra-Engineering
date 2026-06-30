import React, { useState, useEffect } from 'react';
import { useLocation, useRoute } from 'wouter';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Input } from '@/components/ui/input';
import { ArrowLeft, Zap, Loader2, GitBranch, FileDown, FileSpreadsheet, CheckCircle2, FlaskConical, Search } from 'lucide-react';
import { apiRequest } from '@/lib/queryClient';
import { pollAsyncJob } from '@/lib/async-job-poller';
import { PageHeader } from "@/components/ui/page-header";
import { TestViewSkeleton } from "@/components/ui/page-skeletons";
import { TestCaseReviewModal } from '@/components/sdlc/test-case-review-modal';
import { GitConfigModal } from '@/components/sdlc/git-config-modal';
import toast from 'react-hot-toast';
import { useJiraOnlyWorkItems } from "@/hooks/use-hosting-config";

interface TestCaseType {
  id: string;
  label: string;
  selected: boolean;
}

interface AutomationFramework {
  value: string;
  label: string;
}

export default function TestGenerationPage({
  embeddedProjectId,
  embeddedOrganization,
  embeddedProjectName,
  onEmbeddedClose
}: {
  embeddedProjectId?: string;
  embeddedOrganization?: string;
  embeddedProjectName?: string;
  onEmbeddedClose?: () => void;
} = {}) {
  // Helper function to strip HTML tags and decode entities for display
  const stripHtml = (html: string): string => {
    if (!html) return '';
    const doc = new DOMParser().parseFromString(html, 'text/html');
    return doc.body.textContent || '';
  };

  // Helper function to decode HTML entities
  const decodeHtmlEntities = (html: string): string => {
    if (!html) return '';
    const textarea = document.createElement('textarea');
    textarea.innerHTML = html;
    return textarea.value;
  };

  // Helper component to render HTML content safely with proper formatting
  const HtmlContent = ({ html }: { html: string }) => {
    if (!html) return null;
    const decoded = decodeHtmlEntities(html);
    
    // Format the content with proper line breaks and structure
    const formatted = decoded
      // Add line breaks before capital letter headings (e.g., "CONTEXT & BACKGROUND:")
      .replace(/([A-Z][A-Z\s&:\-]+:)\s+/g, '<strong>$1</strong>')
      // Add line breaks before numbered items (1., 2., 3., etc.)
      .replace(/(\d+\.)\s+/g, '$1 ')
      // Add line breaks before bullet points
      .replace(/•\s+/g, '• ')
      // Remove multiple consecutive line breaks, keep max 2
      .replace(/<br\/><br\/><br\/>/g, '<br/><br/>');
    
    return (
      <div 
        dangerouslySetInnerHTML={{ __html: formatted }} 
        className="text-foreground dark:text-gray-100 [&_strong]:font-bold [&_strong]:text-foreground dark:[&_strong]:text-gray-100 [&_strong]:block [&_strong]:mt-0 [&_strong]:mb-0"
      />
    );
  };
  const [, params] = useRoute('/test-generation/:projectId');
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const projectId = embeddedProjectId || params?.projectId;
  const jiraOnly = useJiraOnlyWorkItems();
  const platformName = jiraOnly ? "Jira" : "Azure DevOps";
  
  // Get project details from URL params
  const urlParams = new URLSearchParams(window.location.search);
  const organization = embeddedOrganization || urlParams.get('organization');
  const projectName = embeddedProjectName || urlParams.get('projectName');
  const preSelectedStoryId = urlParams.get('storyId');  // Pre-selected story from other pages
  const preSelectedStoryTitle = urlParams.get('storyTitle');

  // State management
  const [selectedBrdId, setSelectedBrdId] = useState<string>('');
  const [selectedEpicId, setSelectedEpicId] = useState<string>('');
  const [selectedFeatureId, setSelectedFeatureId] = useState<string>('');
  const [selectedUserStory, setSelectedUserStory] = useState<any>(null);
  const [showUserStoryDetails, setShowUserStoryDetails] = useState<boolean>(false);
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [jobStatus, setJobStatus] = useState<any>(null);
  const [generationResult, setGenerationResult] = useState<any>(null);
  const [automationFramework, setAutomationFramework] = useState<string>('playwright-typescript');
  const [showReviewModal, setShowReviewModal] = useState<boolean>(false);
  const [generatedTestCasesForReview, setGeneratedTestCasesForReview] = useState<any>(null);
  // Tracks the "Push to ADO/Jira" round-trip from the review modal so the
  // modal can show a spinner and stay disabled until the push completes.
  const [isPushingToAdo, setIsPushingToAdo] = useState<boolean>(false);
  // Push intimation + success-card state driven by handlePushToAdo checkpoints.
  // These let the review modal show a labelled progress bar while the push is
  // in-flight and a "Push Completed!" card afterwards instead of silently closing.
  const [pushMessage, setPushMessage] = useState<string>("");
  const [pushProgress, setPushProgress] = useState<number>(0);
  const [pushCompleted, setPushCompleted] = useState<boolean>(false);
  const [pushedViewUrl, setPushedViewUrl] = useState<string | null>(null);
  const [pushedSummary, setPushedSummary] = useState<{
    created?: number;
    skipped?: number;
    failed?: number;
  } | null>(null);
  
  // BDD Generation states
  const [isGeneratingBDD, setIsGeneratingBDD] = useState<boolean>(false);
  const [bddGenerationResult, setBddGenerationResult] = useState<any>(null);
  const [bddJobStatus, setBddJobStatus] = useState<any>(null);
  
  // Track which user stories have generated artifacts in Git
  const [generatedStories, setGeneratedStories] = useState<Record<string, boolean>>({});
  const [showGitConfigModal, setShowGitConfigModal] = useState(false);
  const [userStorySearch, setUserStorySearch] = useState('');
  
  // BDD Generation Option - User can opt-in to generate BDD assets
  const [shouldGenerateBddAssets, setShouldGenerateBddAssets] = useState<boolean>(false);

  // Active LLM provider (fetched once on mount)
  const [llmProvider, setLlmProvider] = useState<'anthropic' | 'azure' | 'bedrock' | 'none'>('azure');
  useEffect(() => {
    apiRequest('GET', '/api/llm-provider')
      .then(r => r.json())
      .then(d => setLlmProvider(d.provider ?? 'azure'))
      .catch(() => setLlmProvider('azure'));
  }, []);
  const llmLabel = llmProvider === 'bedrock' ? 'Amazon Bedrock (Claude)'
    : llmProvider === 'anthropic' ? 'Anthropic Claude'
    : 'Azure OpenAI';

  // Test case types - Core types selected by default, extended types optional
  const [testCaseTypes, setTestCaseTypes] = useState<TestCaseType[]>([
    // Core Test Types (Batch 1 - Always recommended)
    { id: 'functional', label: 'Functional Tests', selected: true },
    { id: 'edgeCases', label: 'Edge Cases', selected: true },
    { id: 'negative', label: 'Negative Tests', selected: true },
    { id: 'accessibility', label: 'Accessibility Tests', selected: true },
    // Extended Test Types (Batch 2 - Optional, for comprehensive testing)
    { id: 'performance', label: 'Performance & Load Tests', selected: false },
    { id: 'security', label: 'Security & Vulnerability Tests', selected: false },
    { id: 'usability', label: 'Usability Tests (Nielsen Heuristics)', selected: false },
    { id: 'reliability', label: 'Reliability & Resiliency Tests', selected: false },
  ]);

  const frameworkOptions: AutomationFramework[] = [
    { value: 'playwright-typescript', label: 'Playwright (TypeScript)'},
    // { value: 'playwright-javascript', label: 'Playwright (JavaScript)' }, // Coming soon
    { value: 'selenium-java', label: 'Selenium (JAVA)' },
    // { value: 'cypress', label: 'Cypress' }, // Coming soon
  ];

  // Fetch BRDs
  const { data: brdsData = [], isLoading: isLoadingBrds } = useQuery({
    queryKey: [`/api/dev-brd/approved`, projectId],
    queryFn: async () => {
      if (!projectId) return [];
      try {
        const response = await apiRequest("GET", `/api/dev-brd/approved?projectId=${projectId}`);
        if (!response.ok) return [];
        const data = await response.json();
        return data;
      } catch (error) {
        console.error("Error fetching BRDs:", error);
        return [];
      }
    },
    enabled: !!projectId,
  });

  // Fetch hierarchical workflow artifacts data (BRD → Epic → Feature → User Story)
  // **CRITICAL: Now fetches from ADO first, then enriches with DB data**
  const { data: hierarchyData, isLoading: isLoadingHierarchy } = useQuery({
    queryKey: ["/api/workflow/artifacts/hierarchy", projectId, selectedBrdId, selectedEpicId, selectedFeatureId, organization, projectName],
    queryFn: async () => {
      if (!projectId) return { success: false, epics: [], features: [], userStories: [], summary: {} };
      
      try {
        const params = new URLSearchParams({ projectId });
        if (selectedBrdId) params.append('brdId', selectedBrdId);
        if (selectedEpicId) params.append('epicId', selectedEpicId);
        if (selectedFeatureId) params.append('featureId', selectedFeatureId);
        // **CRITICAL: Pass organization and projectName to fetch from ADO**
        if (organization) params.append('organization', organization);
        if (projectName) params.append('projectName', projectName);
        
        const response = await apiRequest("GET", `/api/workflow/artifacts/hierarchy?${params.toString()}`);
        
        if (!response.ok) return { success: false, epics: [], features: [], userStories: [], summary: {} };
        const data = await response.json();
        
        if (data.filteringNote) {
          toast.error(data.filteringNote, { duration: 8000 });
        }
        
        if (data.summary?.adoFetchSuccessful && data.summary.totalUserStories === 0) {
          const integrationName = data.summary.integrationType === 'jira' ? 'Jira' : 'Azure DevOps';
          toast.error(
            `No user stories found in ${integrationName}. Please check:\n• Does the project have User Stories/Backlog Items?\n• Does your configuration have read permissions?\n• Check ${integrationName} project settings`,
            { duration: 10000 }
          );
        }
        
        return data;
      } catch (error) {
        console.error("Error fetching hierarchy data:", error);
        return { success: false, epics: [], features: [], userStories: [], summary: {} };
      }
    },
    enabled: !!projectId,
  });

  // Extract hierarchical data
  const workflowEpics = hierarchyData?.epics || [];
  const workflowFeatures = hierarchyData?.features || [];
  const workflowUserStories = hierarchyData?.userStories || [];

  // Traceability lookup maps for enriching story objects sent to AI generation
  const epicMap = workflowEpics.reduce((acc: Record<string, string>, e: any) => {
    acc[e.id] = e.title; return acc;
  }, {} as Record<string, string>);
  const featureMap = workflowFeatures.reduce((acc: Record<string, string>, f: any) => {
    acc[f.id] = f.title; return acc;
  }, {} as Record<string, string>);
  const brdMap = brdsData.reduce((acc: Record<string, string>, b: any) => {
    acc[b.id] = b.title; return acc;
  }, {} as Record<string, string>);

  // Returns a copy of a story enriched with traceability context fields
  const enrichStoryWithTraceability = (story: any) => ({
    ...story,
    brdTitle: (selectedBrdId && brdMap[selectedBrdId]) || (story.brdId && brdMap[story.brdId]) || null,
    epicTitle: epicMap[story?.epicId] || null,
    featureTitle: featureMap[story?.featureId] || null,
  });

  // Filter based on selections
  const allUserStories = workflowUserStories;
  const searchLower = userStorySearch.trim().toLowerCase();
  const filteredUserStories = searchLower
    ? allUserStories.filter((story: any) => {
        const title = (story.title || '').toLowerCase();
        const desc = stripHtml(story.description || '').toLowerCase();
        return title.includes(searchLower) || desc.includes(searchLower);
      })
    : allUserStories;
  const storyCount = allUserStories.length;

  const isLoading = isLoadingBrds || isLoadingHierarchy;

  // Check GitHub for generated artifacts when user stories load
  useEffect(() => {
    const checkGeneratedArtifacts = async () => {
      if (allUserStories.length === 0 || !organization || !projectName) {
        return;
      }

      try {
        const response = await apiRequest('POST', '/api/bdd-assets/check-generated', {
          userStories: allUserStories.map((story: any) => ({
            id: story.id,
            title: story.title
          })),
          organization,
          projectName,
          projectId: projectId || undefined,
        });

        if (response.ok) {
          const data = await response.json();
          if (data.success && data.results) {
            setGeneratedStories(data.results);
          }
        }
      } catch (error) {
        console.error('[TestGenerationPage] Error checking GitHub for generated artifacts:', error);
        // Fail silently - not critical
      }
    };

    checkGeneratedArtifacts();
  }, [allUserStories.length, organization, projectName]);

  // Auto-select user story from URL params (when navigating from other pages)
  useEffect(() => {
    if (preSelectedStoryId && allUserStories.length > 0 && !selectedUserStory) {
      const story = allUserStories.find((s: any) => s.id === preSelectedStoryId || s.adoWorkItemId?.toString() === preSelectedStoryId);
      if (story) {
        setSelectedUserStory(story);
        setShowUserStoryDetails(true);
        // Show toast to inform user
        toast.success(`Story pre-selected: ${story.title}`, { duration: 3000 });
      } else {
        console.warn('[TestGenerationPage] Pre-selected story not found:', preSelectedStoryId);
        toast.error('Pre-selected story not found in current filters');
      }
    }
  }, [preSelectedStoryId, allUserStories.length, selectedUserStory]);

  // Handle test type selection
  const handleTestTypeToggle = (typeId: string) => {
    setTestCaseTypes(prev =>
      prev.map(type =>
        type.id === typeId ? { ...type, selected: !type.selected } : type
      )
    );
  };

  // Handle user story selection
  const handleUserStorySelect = (story: any) => {
    setSelectedUserStory(story);
    setShowUserStoryDetails(true);
  };

  // Handle back to story list
  const handleBackToList = () => {
    setShowUserStoryDetails(false);
  };

  // Register a test plan in the database after successful generation to update the count on SDLC page
  const registerTestPlan = async (testCases: any) => {
    if (!testCases || !selectedBrdId) {
      console.warn('[TestGenerationPage] registerTestPlan: Missing test cases or BRD ID');
      return;
    }

    try {
      const brd = brdsData.find((b: any) => b.id === selectedBrdId);
      const brdTitle = brd?.title || 'System Generated';
      
      const storyTitle = selectedUserStory?.title || 'Unknown Story';
      const userStoryId = selectedUserStory?.id || 'unknown';
      
      // Determine artifact types generated
      const generatedTypes = [];
      if (testCases.functional?.length > 0) generatedTypes.push('Functional');
      if (testCases.negative?.length > 0) generatedTypes.push('Negative');
      if (testCases.edgeCases?.length > 0) generatedTypes.push('Edge Case');
      if (testCases.accessibility?.length > 0) generatedTypes.push('Accessibility');
      
      const typeStr = generatedTypes.length > 0 ? generatedTypes.join(', ') : 'Testing';
      
      const content = `# Generated Test Plan\n\n**Story:** ${storyTitle} (${userStoryId})\n**Date:** ${new Date().toLocaleString()}\n**Type:** ${typeStr}\n\nThis test plan was automatically registered following the successful generation of test artifacts.`;

      await apiRequest('POST', '/api/testing/save-test-plan', {
        testPlanContent: content,
        brdId: selectedBrdId,
        brdTitle: brdTitle,
        projectId: projectId,
        organizationId: organization
      });
      
      console.log('[TestGenerationPage] Test plan registered successfully');
      
      // Invalidate the counts query for the SDLC page
      queryClient.invalidateQueries({ queryKey: ["/api/testing/test-plans", projectId, organization] });
    } catch (error) {
      console.error('[TestGenerationPage] Failed to register test plan:', error);
    }
  };

  // Poll job status for progress updates during Anthropic Claude generation
  const pollJobStatus = async (currentJobId: string) => {
    try {
      const response = await apiRequest('GET', `/api/manual-test-cases/status/${currentJobId}`);
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const data = await response.json();
      
      if (data.success && data.job) {
        const job = data.job;
        setJobStatus(job);

        if (job.status === 'completed') {
          // Fetch the result
          try {
            const resultResponse = await apiRequest('GET', `/api/manual-test-cases/result/${currentJobId}`);
            if (resultResponse.ok) {
              const resultData = await resultResponse.json();
              
              const actualResult = resultData.result || resultData;
              const testCasesData = actualResult.testCases || actualResult;
              
              setGenerationResult(actualResult);
              setIsGenerating(false);
              
              // Set up review modal data with test cases
              const testCasesWithMetadata = {
                ...testCasesData,
                selectedTypes: testCaseTypes.reduce((acc, type) => ({ ...acc, [type.id]: type.selected }), {}),
                userStoryObject: selectedUserStory
              };
              setGeneratedTestCasesForReview(testCasesWithMetadata);
              setShowReviewModal(true);
            } else {
              throw new Error('Failed to fetch results');
            }
          } catch (resultError) {
            console.error('Error fetching result:', resultError);
            setIsGenerating(false);
            toast.error(resultError instanceof Error ? resultError.message : 'Error fetching results');
          }
        } else if (job.status === 'failed') {
          console.error('Job failed:', job.error);
          setIsGenerating(false);
          toast.error(job.error || 'Generation failed');
        } else if (job.status === 'processing' || job.status === 'pending') {
          // Continue polling every 2 seconds
          setTimeout(() => pollJobStatus(currentJobId), 2000);
        }
      } else {
        throw new Error('Invalid response format');
      }
    } catch (error) {
      console.error('Error polling job status:', error);
      setIsGenerating(false);
      toast.error(error instanceof Error ? error.message : 'Polling error');
    }
  };

  // Save manual test cases and push to ADO/Jira (without BDD generation)
  const handlePushToAdo = async (editedTestCases: any) => {
    const userStory = editedTestCases.userStoryObject || selectedUserStory;
    
    if (!userStory) {
      toast.error('No user story selected');
      return;
    }

    let adoPushSucceeded = false;
    const hasExternalId = userStory.adoWorkItemId || userStory.jiraIssueId || userStory.externalId;

    // Detect Jira vs ADO based on the story's IDs or the project's integration type.
    // `jiraOnly` reflects hosting platform (AWS=Jira only) but Azure can also have Jira projects.
    // Priority: story's own jiraIssueId/externalId → project integrationType → hosting flag.
    const projectIntegrationType = hierarchyData?.summary?.integrationType;
    const isJiraProject = jiraOnly
      || projectIntegrationType === 'jira'
      || !!(userStory.jiraIssueId || userStory.externalId);
    const effectivePlatformName = isJiraProject ? 'Jira' : 'Azure DevOps';

    // Flag the modal's push button as in-progress for the entire round trip
    // (push + optional repo save + register test plan). Cleared in `finally`.
    setIsPushingToAdo(true);
    // Reset push intimation state for this fresh attempt. The review modal
    // uses these to render the labelled progress bar and the success card.
    setPushCompleted(false);
    setPushedViewUrl(null);
    setPushedSummary(null);
    setPushMessage("Preparing test cases…");
    setPushProgress(5);

    // Track whether the primary push (or, when there is no external id, the
    // repo save fallback) actually succeeded — we only flip the modal into the
    // "Push Completed!" success state when something meaningful did land.
    let primaryPushSucceeded = false;
    let capturedViewUrl: string | null = null;

    try {
      if (hasExternalId && (organization || projectId) && (projectName || isJiraProject)) {
        try {
          const testCasesByCategory = {
            functional: editedTestCases.functional || [],
            negative: editedTestCases.negative || [],
            edgeCases: editedTestCases.edgeCases || [],
            accessibility: editedTestCases.accessibility || [],
            performance: editedTestCases.performance || [],
            security: editedTestCases.security || [],
            usability: editedTestCases.usability || [],
            reliability: editedTestCases.reliability || [],
          };

          const totalToPush = Object.values(testCasesByCategory).reduce(
            (sum, arr) => sum + (Array.isArray(arr) ? arr.length : 0),
            0,
          );

          const pushEndpoint = isJiraProject
            ? `/api/sdlc/projects/${projectId}/jira/push-test-cases`
            : '/api/test-cases/push-to-ado';

          console.log(`[TestGenerationPage] Pushing to ${effectivePlatformName} via ${pushEndpoint}`);

          setPushMessage(`Pushing ${totalToPush} test case${totalToPush === 1 ? "" : "s"} to ${effectivePlatformName}…`);
          setPushProgress(15);

          const adoResponse = await apiRequest('POST', pushEndpoint, {
            testCasesByCategory,
            testCases: Object.values(testCasesByCategory).flat(),
            userStory: {
              id: editedTestCases.storyId || userStory.id,
              title: editedTestCases.storyTitle || userStory.title,
              adoWorkItemId: userStory.adoWorkItemId,
              jiraIssueId: userStory.jiraIssueId || userStory.externalId,
            },
            organization,
            projectName,
            projectId,
          });

          let adoResult = await adoResponse.json();

          // Async-job pattern (Jira only): backend returns 202 + jobId for
          // bulk test-case pushes to dodge AWS API Gateway's 29s timeout.
          // Poll the universal status endpoint until completion.
          if (isJiraProject && adoResponse.status === 202 && adoResult?.jobId) {
            adoResult = await pollAsyncJob<typeof adoResult>(
              'test-cases-push-to-jira',
              adoResult.jobId,
              {
                onProgress: (message, percent) => {
                  if (message) setPushMessage(message);
                  if (typeof percent === 'number') {
                    // Map backend 0–100 into our outer 15→60 push segment so the
                    // bar still has room to grow for repo save + plan registration.
                    setPushProgress(15 + Math.round((percent / 100) * 45));
                  }
                },
              },
            );
          }

          if (adoResult.success) {
            adoPushSucceeded = true;
            primaryPushSucceeded = true;

            const summary = adoResult.summary;
            const created = summary?.created ?? adoResult.createdKeys?.length ?? 0;
            const skipped = summary?.skipped ?? adoResult.skippedKeys?.length ?? 0;
            const failed = summary?.failed ?? adoResult.errors?.length ?? 0;

            setPushedSummary({ created, skipped, failed });
            if (adoResult.userStoryUrl) {
              capturedViewUrl = adoResult.userStoryUrl;
              setPushedViewUrl(adoResult.userStoryUrl);
            }

            setPushMessage(
              `Pushed ${created} created${skipped ? ` · ${skipped} skipped` : ""}${failed ? ` · ${failed} failed` : ""}`,
            );
            setPushProgress(60);
          } else {
            throw new Error(adoResult.error || adoResult.message || `Failed to push to ${effectivePlatformName}`);
          }
        } catch (adoError) {
          console.error('[TestGenerationPage] push failed:', adoError);
          const errMsg = adoError instanceof Error ? adoError.message : `Failed to push to ${effectivePlatformName}`;
          toast.error(`⚠️ ${errMsg}`, { duration: 5000 });
          setPushMessage(`Push to ${effectivePlatformName} failed`);
        }
      } else {
        // No external id — primary push is skipped, fall through to repo save.
        // Start the bar partway so the user still sees motion.
        setPushMessage("Saving to repository…");
        setPushProgress(50);
      }

      // Step 2: Optionally save to Git repository (GitHub or ADO Wiki).
      // This is a background/optional save — silently skip if not configured.
      setPushMessage("Saving to repository…");
      setPushProgress(75);
      try {
        const saveResponse = await apiRequest(
          "POST",
          "/api/save-reviewed-testcases",
          {
            testCases: editedTestCases,
            userStory: userStory,
            projectId,
            projectName,
            organization,
          }
        );

        if (saveResponse.ok) {
          const saveResult = await saveResponse.json();
          const viewUrl = saveResult?.viewUrl as string | undefined;
          if (viewUrl) {
            // Prefer the ADO/Jira story URL captured above; fall back to repo URL.
            if (!capturedViewUrl) {
              capturedViewUrl = viewUrl;
              setPushedViewUrl(viewUrl);
            }
            // If the primary push didn't run (no external id), surface the repo
            // save as the "primary" success so we still show the completion card.
            if (!hasExternalId) {
              primaryPushSucceeded = true;
            }
          }
        }
        // If saveResponse is not ok (e.g. GitHub not configured), silently ignore
      } catch (saveError: any) {
        // GitHub/ADO repo not configured for this project — not a blocking error
        console.warn('[TestGenerationPage] Repository save skipped:', saveError?.message);
      }

      // Step 3: Register the test plan in the DB to update SDLC counts
      setPushMessage("Registering test plan…");
      setPushProgress(90);
      await registerTestPlan(editedTestCases);

      if (primaryPushSucceeded) {
        setPushMessage("Push complete");
        setPushProgress(100);
        setPushCompleted(true);
        // Modal stays open so the user sees the success card + View link.
        // Closing is now driven by the modal's "Done" button → onClose handler.
      }
      // If nothing succeeded, leave the modal as-is so the user can retry.

    } catch (error: any) {
      console.error('[TestGenerationPage] ADO push failed:', error);
      const data = error?.response?.data ?? error;
      const details = data.details ?? data.error;
      const message = typeof details === 'string' ? details : (error?.message || `Failed to push to ${platformName}`);
      toast.error(message);
      setPushMessage(`Push failed: ${message}`);
    } finally {
      setIsPushingToAdo(false);
    }
  };

  // Reset push intimation state when the user dismisses the review modal so
  // the next push starts from a clean slate.
  const handleReviewModalClose = () => {
    setShowReviewModal(false);
    setPushCompleted(false);
    setPushProgress(0);
    setPushMessage("");
    setPushedViewUrl(null);
    setPushedSummary(null);
  };


  // Save manual test cases and start BDD generation
  const handleSaveAndGenerateBDD = async (editedTestCases: any) => {
    const userStory = editedTestCases.userStoryObject || selectedUserStory;
    
    if (!userStory) {
      toast.error('No user story selected');
      return;
    }

    try {
      const hasExtId = userStory.adoWorkItemId || userStory.jiraIssueId || userStory.externalId;
      if (hasExtId && (organization || projectId) && (projectName || jiraOnly)) {
        toast.loading(`Pushing to ${platformName}... 0%`, { id: 'ado-push' });
        
        let progressInterval: NodeJS.Timeout | null = null;
        if (jiraOnly) {
          let simulatedProgress = 0;
          progressInterval = setInterval(() => {
            simulatedProgress += simulatedProgress < 50 ? 5 : simulatedProgress < 80 ? 2 : 1;
            if (simulatedProgress >= 95) simulatedProgress = 95;
            toast.loading(`Pushing to Jira... ${simulatedProgress}%`, { id: 'ado-push' });
          }, 1500);
        }

        try {
          const testCasesByCategory = {
            functional: editedTestCases.functional || [],
            negative: editedTestCases.negative || [],
            edgeCases: editedTestCases.edgeCases || [],
            accessibility: editedTestCases.accessibility || [],
            performance: editedTestCases.performance || [],
            security: editedTestCases.security || [],
            usability: editedTestCases.usability || [],
            reliability: editedTestCases.reliability || [],
          };

          const bddPushEndpoint = jiraOnly
            ? `/api/sdlc/projects/${projectId}/jira/push-test-cases`
            : '/api/test-cases/push-to-ado';
          const adoResponse = await apiRequest('POST', bddPushEndpoint, {
            testCasesByCategory,
            testCases: Object.values(testCasesByCategory).flat(),
            userStory: {
              id: editedTestCases.storyId || userStory.id,
              title: editedTestCases.storyTitle || userStory.title,
              adoWorkItemId: userStory.adoWorkItemId,
              jiraIssueId: userStory.jiraIssueId || userStory.externalId,
            },
            organization,
            projectName,
            projectId,
          });

          let adoResult = await adoResponse.json();

          // Async-job pattern (Jira only): poll the status endpoint until
          // the bulk test-case push completes. Avoids the 29s gateway 503.
          if (jiraOnly && adoResponse.status === 202 && adoResult?.jobId) {
            adoResult = await pollAsyncJob<typeof adoResult>('test-cases-push-to-jira', adoResult.jobId);
          }

          if (adoResult.success) {
            const summary = adoResult.summary;
            const created = summary?.created ?? adoResult.createdKeys?.length ?? 0;
            const skipped = summary?.skipped ?? adoResult.skippedKeys?.length ?? 0;
            const failed = summary?.failed ?? adoResult.errors?.length ?? 0;

            toast.success(
              `Pushed to ${platformName}: ${created} created, ${skipped} skipped`,
              { id: 'ado-push', duration: 3000 }
            );

            if (failed > 0) {
              toast.error(
                `${failed} test case(s) failed to push`,
                { duration: 4000 }
              );
            }

            if (adoResult.userStoryUrl) {
              toast.success(
                `View test cases in ${platformName}`,
                { duration: 5000, id: 'ado-url' }
              );
            }
          } else {
            throw new Error(adoResult.error || adoResult.message || `Failed to push to ${platformName}`);
          }
        } catch (adoError) {
          if (progressInterval) clearInterval(progressInterval);
          console.error('[TestGenerationPage] push failed:', adoError);
          toast.error(
            adoError instanceof Error ? adoError.message : `Failed to push to ${platformName}`,
            { id: 'ado-push' }
          );
        } finally {
          if (progressInterval) clearInterval(progressInterval);
        }
      }

      // Step 2: Save manual test cases to GitHub (silent - no notification)
      const saveResponse = await apiRequest(
        "POST",
        "/api/save-reviewed-testcases",
        {
          testCases: editedTestCases,
          userStory: userStory,
          projectId,
          projectName,
          organization,
        }
      );

      const saveResult = await saveResponse.json();
      if (!saveResponse.ok) {
        const error = saveResult;
        const message = error.details ? `${error.error}: ${error.details}` : (error.error || "Failed to save test cases");
        throw new Error(message);
      }

      const viewUrl = saveResult?.viewUrl as string | undefined;
      if (viewUrl) {
        const isAdo = viewUrl.includes("dev.azure.com");
        toast.success(
          (t) => (
            <span>
              Test cases saved.{" "}
              <a
                href={viewUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="underline font-medium text-primary hover:opacity-90"
              >
                {isAdo ? `View in ${platformName}` : "View in repository"}
              </a>
            </span>
          ),
          { duration: 8000 }
        );
      }

      // Step 3: Register the test plan in the DB to update SDLC counts
      await registerTestPlan(editedTestCases);

      // Close the review modal (no notification for GitHub save - it's automatic)
      setShowReviewModal(false);
      
      // Step 3: Start BDD generation
      setIsGeneratingBDD(true);
      setBddJobStatus({ status: 'starting', progress: 0 });
      toast.loading('Generating BDD assets...', { id: 'bdd-gen' });
      
      // Normalize framework name for backend
      let normalizedFramework = 'playwright';
      if (automationFramework.includes('selenium')) {
        normalizedFramework = 'selenium';
      } else if (automationFramework.includes('playwright')) {
        normalizedFramework = 'playwright';
      }
      
      const startResponse = await apiRequest(
        "POST",
        "/api/bdd-assets/generate",
        {
          testCases: editedTestCases,
          userStory: enrichStoryWithTraceability(userStory),
          testFramework: normalizedFramework
        }
      );

      if (!startResponse.ok) {
        const error = await startResponse.json();
        throw new Error(error.error || "Failed to start BDD generation");
      }

      const { jobId } = await startResponse.json();
      toast.success('✅ BDD generation started', { id: 'bdd-gen' });
      
      // Step 4: Poll for completion
      pollBDDJobStatus(jobId);

    } catch (error: any) {
      console.error('[TestGenerationPage] Save/generation failed:', error);
      const data = error?.response?.data ?? error;
      const details = data.details ?? data.error;
      const message = typeof details === 'string' ? details : (error?.message || 'Failed to save test cases');
      toast.error(message);
      setIsGeneratingBDD(false);
    }
  };

  // Generate ONLY BDD assets (no ADO push, no GitHub save)
  const handleGenerateBDDOnly = async (editedTestCases: any) => {
    const userStory = editedTestCases.userStoryObject || selectedUserStory;
    
    if (!userStory) {
      toast.error('No user story selected');
      return;
    }

    try {
      // Step 3: Register the test plan in the DB to update SDLC counts
      await registerTestPlan(editedTestCases);

      // Close the review modal immediately
      setShowReviewModal(false);
      
      // Start BDD generation only
      setIsGeneratingBDD(true);
      setBddJobStatus({ status: 'starting', progress: 0 });
      toast.loading('Generating BDD assets...', { id: 'bdd-gen' });
      
      // Normalize framework name for backend
      let normalizedFramework = 'playwright';
      if (automationFramework.includes('selenium')) {
        normalizedFramework = 'selenium';
      } else if (automationFramework.includes('playwright')) {
        normalizedFramework = 'playwright';
      }
      
      const startResponse = await apiRequest(
        "POST",
        "/api/bdd-assets/generate",
        {
          testCases: editedTestCases,
          userStory: enrichStoryWithTraceability(userStory),
          testFramework: normalizedFramework
        }
      );

      if (!startResponse.ok) {
        const error = await startResponse.json();
        throw new Error(error.error || "Failed to start BDD generation");
      }

      const { jobId } = await startResponse.json();
      toast.success('✅ BDD generation started', { id: 'bdd-gen' });
      
      // Poll for completion
      pollBDDJobStatus(jobId);

    } catch (error: any) {
      console.error('[TestGenerationPage] BDD generation failed:', error);
      const data = error?.response?.data ?? error;
      const details = data.details ?? data.error;
      const message = typeof details === 'string' ? details : (error?.message || 'Failed to generate BDD assets');
      toast.error(message);
      setIsGeneratingBDD(false);
    }
  };

  // Poll BDD job status
  const pollBDDJobStatus = async (currentJobId: string) => {
    try {
      const statusResponse = await apiRequest("GET", `/api/bdd-assets/generation-status/${currentJobId}`);
      
      if (!statusResponse.ok) {
        throw new Error('Failed to fetch status');
      }
      
      const statusData = await statusResponse.json();
      const job = statusData.job;
      
      setBddJobStatus(job);

      if (job.status === 'completed') {
        // Fetch result
        const resultResponse = await apiRequest("GET", `/api/bdd-assets/generation-result/${currentJobId}`);
        
        if (resultResponse.ok) {
          const resultData = await resultResponse.json();
          setBddGenerationResult(resultData.result);
          setIsGeneratingBDD(false);
          toast.success('BDD assets generated successfully');
        } else {
          throw new Error('Failed to fetch result');
        }
      } else if (job.status === 'failed') {
        setIsGeneratingBDD(false);
        toast.error(job.error || 'BDD generation failed');
      } else {
        // Continue polling
        setTimeout(() => pollBDDJobStatus(currentJobId), 3000);
      }
    } catch (error: any) {
      console.error('Error polling BDD status:', error);
      setIsGeneratingBDD(false);
      toast.error(error.message || 'Error during BDD generation');
    }
  };

  // Export manual test cases to Excel
  const handleExportToExcel = async () => {
    console.log(`[UI] 📥 handleExportToExcel called - Has generationResult: ${!!generationResult} - Timestamp: ${new Date().toISOString()}`);
    
    if (!generationResult) {
      toast.error('No test cases to export');
      return;
    }
    
    try {
      toast.loading('Generating Excel file...', { id: 'excel-export' });
      
      // Extract test cases from result (handle both nested and flat structures)
      const testCasesData = generationResult.testCases || generationResult;
      
      console.log('[UI] 📊 Exporting test cases:', {
        hasTestCases: !!testCasesData,
        keys: Object.keys(testCasesData),
        functionalCount: testCasesData.functional?.length || 0
      });
      
      const response = await apiRequest('POST', '/api/export-testcases-excel', {
        testCases: testCasesData,
        metadata: {
          storyTitle: selectedUserStory?.title || 'Test Cases',
          storyId: selectedUserStory?.id,
          generatedAt: new Date().toISOString()
        }
      });

      // apiRequest already validates response.ok, so we can directly call .blob()
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      
      const dateStr = new Date().toISOString().split('T')[0];
      const titleSlug = (selectedUserStory?.title || 'TestCases')
        .replace(/[^a-z0-9]/gi, '_')
        .substring(0, 50);
      link.download = `TestCases_${titleSlug}_${dateStr}.xlsx`;
      
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
      
      toast.success('Exported to Excel successfully', { id: 'excel-export' });
    } catch (error: any) {
      console.error('Export to Excel error:', error);
      toast.error(error.message || 'Failed to export test cases', { id: 'excel-export' });
    }
  };

  // Push BDD assets to repository (GitHub or ADO per project config)
  const handlePushToRepository = async () => {
    if (!bddGenerationResult) {
      toast.error('No BDD assets to push');
      return;
    }
    if (!projectId) {
      toast.error('Project context missing');
      return;
    }
    try {
      toast.loading('Pushing to repository...', { id: 'git-push' });
      const response = await apiRequest('POST', '/api/bdd-assets/push-to-git', {
        featureFiles: bddGenerationResult.featureFiles,
        stepDefFiles: bddGenerationResult.stepDefFiles,
        userStory: selectedUserStory,
        framework: automationFramework,
        organization: organization,
        projectName: projectName,
        projectId,
      });
      if (response.ok) {
        const data = await response.json();
        toast.success('Pushed to repository successfully', { id: 'git-push' });
        if (selectedUserStory?.id) {
          setGeneratedStories(prev => ({ ...prev, [selectedUserStory.id]: true }));
        }
      } else {
        const error = await response.json();
        throw new Error(error.details || error.error || 'Failed to push to repository');
      }
    } catch (error: any) {
      console.error('Push to repository error:', error);
      toast.error(error.message || 'Failed to push to repository', { id: 'git-push' });
    }
  };

  // Export BDD assets as ZIP
  const handleExportBDDAsZIP = async () => {
    if (!bddGenerationResult) {
      toast.error('No BDD assets to export');
      return;
    }
    
    if (!bddGenerationResult.featureFiles || !bddGenerationResult.stepDefFiles) {
      toast.error('BDD assets are incomplete. Please regenerate.');
      return;
    }
    
    try {
      toast.loading('Creating ZIP file...', { id: 'zip-export' });
      
      const response = await apiRequest('POST', '/api/bdd-assets/export-zip', {
        featureFiles: bddGenerationResult.featureFiles,
        stepDefFiles: bddGenerationResult.stepDefFiles,
        userStory: selectedUserStory,
        organization: organization,
        projectName: projectName,
        framework: automationFramework
      });

      // apiRequest already validates response.ok, so we can directly call .blob()
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      
      const dateStr = new Date().toISOString().split('T')[0];
      const storySlug = (selectedUserStory?.title || 'BDD_Assets')
        .replace(/[^a-z0-9]/gi, '_')
        .substring(0, 50);
      link.download = `BDD_${storySlug}_${dateStr}.zip`;
      
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
      
      toast.success('Exported as ZIP successfully', { id: 'zip-export' });
    } catch (error: any) {
      console.error('Export ZIP error:', error);
      toast.error(error.message || 'Failed to export BDD assets', { id: 'zip-export' });
    }
  };

  // Generate test cases handler - with polling for LLM calls to keep browser alive
  const handleGenerateTestCases = async () => {
    if (!selectedUserStory) return;
    
    const selectedTypes = testCaseTypes.filter(type => type.selected);
    if (selectedTypes.length === 0) {
      toast.error('Please select at least one test case type');
      return;
    }
    
    // Reset states before starting
    setIsGenerating(true);
    setJobId(null);
    setJobStatus({ status: 'starting', progress: 0 });
    setGenerationResult(null);
    
    try {
      // Convert test case types to expected format: { functional: true, negative: false, ... }
      const testCaseTypesObject = {
        // Core test types
        functional: selectedTypes.some(t => t.id === 'functional'),
        negative: selectedTypes.some(t => t.id === 'negative'),
        edgeCases: selectedTypes.some(t => t.id === 'edgeCases'),
        accessibility: selectedTypes.some(t => t.id === 'accessibility'),
        // Extended test types
        performance: selectedTypes.some(t => t.id === 'performance'),
        security: selectedTypes.some(t => t.id === 'security'),
        usability: selectedTypes.some(t => t.id === 'usability'),
        reliability: selectedTypes.some(t => t.id === 'reliability'),
      };
      
      const response = await apiRequest('POST', '/api/manual-test-cases/generate', {
        userStory: enrichStoryWithTraceability(selectedUserStory),
        testCaseTypes: testCaseTypesObject,
        automationFramework,
        projectId,
        organization,
      });
      
      if (response.ok) {
        const data = await response.json();
        
        if (data.success && data.jobId) {
          setJobId(data.jobId);
          setJobStatus({ status: 'pending', progress: 0 });
          // Start polling to keep browser alive during LLM processing
          pollJobStatus(data.jobId);
        } else {
          throw new Error(data.error || data.message || 'No job ID returned');
        }
      } else {
        const errorData = await response.json().catch(() => ({ error: 'Server error' }));
        throw new Error(errorData.error || `HTTP ${response.status}`);
      }
      
    } catch (error) {
      console.error('Error starting generation:', error);
      setIsGenerating(false);
      toast.error(error instanceof Error ? error.message : 'Error starting generation');
    }
  };

  // Cancel handler (matches SDLC back behavior)
  const handleCancel = () => {
    const backParams = new URLSearchParams();
    if (organization) backParams.set('organization', organization);
    if (projectId) backParams.set('projectId', projectId);
    if (projectName) backParams.set('projectName', projectName);
    backParams.set('phase', '4');

    const query = backParams.toString();
    setLocation(query ? `/sdlc?${query}` : '/sdlc');
  };

  if (isLoading) {
    return <TestViewSkeleton />;
  }

  return (
    <div className={embeddedProjectId ? "h-[85vh] bg-background flex flex-col overflow-hidden rounded-md" : "h-screen bg-background flex flex-col overflow-hidden"}>
      {/* TOP FILTER BAR */}
      <div className="border-b border-border bg-card p-6 flex-shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <PageHeader
              icon={FlaskConical}
              title="Test Artifacts Generator"
              color="amber"
            >
              {projectName && (
                <Badge variant="secondary" className="text-sm">
                  {projectName}
                </Badge>
              )}
              {projectId && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-muted-foreground"
                  onClick={() => setShowGitConfigModal(true)}
                >
                  <GitBranch className="h-4 w-4 mr-1" />
                  Repository settings
                </Button>
              )}
            </PageHeader>
          </div>
          
          {/* Filters (Left) and Story Count (Right) */}
          <div className="flex items-center gap-6">
            {/* Hierarchical Filters: BRD → Epic → Feature → User Story */}
            <div className="flex gap-3">
              {/* BRD Filter */}
              <Select 
                value={selectedBrdId || "all"} 
                onValueChange={(value) => {
                  setSelectedBrdId(value === "all" ? "" : value);
                  setSelectedUserStory(null);
                }}
              >
                <SelectTrigger className="w-44 border-border">
                  <SelectValue placeholder="All BRDs" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All BRDs</SelectItem>
                  {brdsData.map((brd: any) => (
                    <SelectItem key={brd.id} value={brd.id}>
                      {brd.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              
              {/* Epic Filter - Always visible */}
              <Select 
                value={selectedEpicId || "all"} 
                onValueChange={(value) => {
                  setSelectedEpicId(value === "all" ? "" : value);
                  setSelectedUserStory(null);
                }}
              >
                <SelectTrigger className="w-44 border-border">
                  <SelectValue placeholder="All Epics" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Epics</SelectItem>
                  {workflowEpics.map((epic: any) => (
                    <SelectItem key={epic.id} value={epic.id}>
                      {epic.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              
              {/* Feature Filter - Always visible */}
              <Select 
                value={selectedFeatureId || "all"} 
                onValueChange={(value) => {
                  setSelectedFeatureId(value === "all" ? "" : value);
                  setSelectedUserStory(null);
                }}
              >
                <SelectTrigger className="w-44 border-border">
                  <SelectValue placeholder="All Features" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Features</SelectItem>
                  {workflowFeatures.map((feature: any) => (
                    <SelectItem key={feature.id} value={feature.id}>
                      {feature.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            
            {/* Story Count & Clear Filters */}
            <div className="flex items-center gap-3">
              {(selectedBrdId || selectedEpicId || selectedFeatureId) && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setSelectedBrdId('');
                    setSelectedEpicId('');
                    setSelectedFeatureId('');
                    setSelectedUserStory(null);
                  }}
                  className="text-xs text-muted-foreground hover:text-foreground"
                  title="Reset all filters to 'All'"
                >
                  Clear Filters
                </Button>
              )}
              {/* Data Source Indicator */}
              {hierarchyData?.summary?.adoFetchSuccessful ? (
                <Badge variant="default" className="px-3 py-1 bg-green-600 hover:bg-green-700 text-white" title={`User stories fetched from ${platformName}`}>
                  ✓ {jiraOnly ? "Jira" : "ADO"} Synced
                </Badge>
              ) : (
                <Badge variant="outline" className="px-3 py-1 border-yellow-600 text-yellow-600" title={`Using database only (${platformName} not configured or fetch failed)`}>
                  ⚠ DB Only
                </Badge>
              )}
              <Badge variant="outline" className="px-3 py-1 border-border text-foreground">
                {storyCount} {storyCount === 1 ? 'Story' : 'Stories'}
              </Badge>
            </div>
          </div>
        </div>
      </div>

      {/* MAIN LAYOUT - TWO COLUMN */}
      <div className="flex flex-row flex-1 min-h-0 overflow-hidden">
        {/* LEFT PANEL - USER STORY LIST */}
        <div className="flex-none w-[420px] min-w-[420px] max-w-[420px] border-r border-border bg-card flex flex-col min-h-0 overflow-x-hidden overflow-y-auto">
          {!showUserStoryDetails ? (
            <>
              {/* Header */}
              <div className="p-4 border-b border-border flex-shrink-0 bg-muted/30">
                <div className="flex items-center gap-3">
                  <Button 
                    variant="ghost" 
                    size="sm" 
                    onClick={() => onEmbeddedClose ? onEmbeddedClose() : setLocation('/sdlc')}
                    className="flex items-center gap-2 -ml-2 text-muted-foreground hover:text-foreground"
                  >
                    <ArrowLeft className="h-4 w-4" />
                    {onEmbeddedClose ? 'Close Dialog' : 'Back to SDLC'}
                  </Button>
                </div>
                <h2 className="text-lg font-semibold mt-3 text-foreground">User Stories</h2>
                <p className="text-sm text-muted-foreground mt-1">
                  Select a story to generate test cases
                </p>
                <div className="mt-3 relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                  <Input
                    type="search"
                    placeholder="Search user stories..."
                    value={userStorySearch}
                    onChange={(e) => setUserStorySearch(e.target.value)}
                    className="pl-9 bg-background border-border"
                  />
                </div>
              </div>
              
              {/* Story Cards - Fixed Height with Scroll */}
              <div className="flex-1 min-h-0 overflow-hidden">
                <ScrollArea className="h-full">
                  <div className="p-4 space-y-3">
                    {filteredUserStories.map((story: any) => {
                      const isGenerated = generatedStories[story.id];
                      
                      return (
                      <Card 
                        key={story.id} 
                        className={`w-full box-border min-w-0 cursor-pointer transition-all hover:shadow-md rounded-lg ${
                          selectedUserStory?.id === story.id
                            ? 'bg-primary/5 border-primary border-2'
                            : 'border-border hover:border-primary/50'
                        }`}
                        onClick={() => handleUserStorySelect(story)}
                      >
                        <CardContent className="p-4 h-full min-w-0 break-words overflow-wrap-anywhere">
                          <div className="space-y-2">
                            <div className="flex items-start justify-between gap-2">
                              <h4 className="font-semibold text-sm leading-relaxed text-foreground flex-1 min-w-0 break-word whitespace-pre-wrap" style={{ wordBreak: 'break-word', overflowWrap: 'anywhere' }}>
                                {story.title}
                              </h4>
                              {isGenerated && (
                                <Badge className="text-xs bg-green-100 text-green-700 border-green-300 flex-shrink-0">
                                  <CheckCircle2 className="h-3 w-3 mr-1" />
                                  Generated
                                </Badge>
                              )}
                            </div>
                            
                            <div className="flex gap-2 flex-wrap">
                              {story.role && (
                                <Badge variant="secondary" className="text-xs">
                                  {story.role}
                                </Badge>
                              )}
                              {story.priority && (
                                <Badge 
                                  variant={story.priority === 'High' ? 'destructive' : story.priority === 'Medium' ? 'default' : 'secondary'}
                                  className="text-xs"
                                >
                                  {story.priority}
                                </Badge>
                              )}
                              {story.storyPoints && (
                                <Badge variant="outline" className="text-xs">
                                  {story.storyPoints} pts
                                </Badge>
                              )}
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                      );
                    })}
                    
                    {filteredUserStories.length === 0 && (
                      <div className="text-center py-12 px-4">
                        <p className="text-muted-foreground font-medium">
                          {allUserStories.length === 0
                            ? "No user stories found"
                            : "No user stories match your search"}
                        </p>
                        <p className="text-sm text-muted-foreground mt-2">
                          {allUserStories.length === 0
                            ? (selectedBrdId || selectedEpicId || selectedFeatureId
                                ? "No user stories match the selected filters. Try adjusting your filter selections."
                                : "Make sure you have workflow artifacts saved for this project.")
                            : "Try a different search term or clear the search."}
                        </p>
                      </div>
                    )}
                  </div>
                </ScrollArea>
              </div>
            </>
          ) : (
            /* EXPANDED USER STORY VIEW */
            <>
              {/* Header with Back Button */}
              <div className="p-4 border-b border-border flex-shrink-0">
                <div className="flex items-center gap-3">
                  <Button 
                    variant="ghost" 
                    size="sm" 
                    onClick={handleBackToList}
                    className="flex items-center gap-2 -ml-2 text-muted-foreground hover:text-foreground"
                  >
                    <ArrowLeft className="h-4 w-4" />
                    Back to SDLC
                  </Button>
                </div>
                <h2 className="text-lg font-semibold mt-3 text-foreground">Selected Story</h2>
              </div>
              
              {/* Story Details */}
              <div className="flex-1 overflow-hidden">
                <ScrollArea className="h-full">
                  <div className="p-4">
                    {selectedUserStory && (
                      <Card className="border-border">
                        <CardHeader>
                          <div className="space-y-3">
                            <div className="flex gap-2 flex-wrap">
                              <Badge variant="outline" className="border-border text-foreground">Story #{selectedUserStory.id}</Badge>
                              {selectedUserStory.role && (
                                <Badge variant="secondary" className="bg-secondary text-foreground">
                                  {selectedUserStory.role}
                                </Badge>
                              )}
                              {selectedUserStory.priority && (
                                <Badge 
                                  variant={selectedUserStory.priority === 'High' ? 'destructive' : selectedUserStory.priority === 'Medium' ? 'default' : 'secondary'}
                                >
                                  {selectedUserStory.priority}
                                </Badge>
                              )}
                              {selectedUserStory.storyPoints && (
                                <Badge variant="outline" className="border-border text-foreground">
                                  {selectedUserStory.storyPoints} pts
                                </Badge>
                              )}
                            </div>
                            <CardTitle className="text-base leading-relaxed text-foreground">
                              {selectedUserStory.title}
                            </CardTitle>
                          </div>
                        </CardHeader>
                        <CardContent>
                          {/* User Story Content Display - Show Exact Database Content */}
                          <div className="space-y-4">
                            {selectedUserStory.description && (
                              <div className="space-y-2">
                                <h4 className="font-medium text-sm text-foreground">Description</h4>
                                <div className="text-sm text-foreground dark:text-gray-100 leading-relaxed">
                                  <HtmlContent html={selectedUserStory.description} />
                                </div>
                              </div>
                            )}
                            
                            {/* Separate Acceptance Criteria section if it exists as a separate field */}
                            {selectedUserStory.acceptanceCriteria && (
                              <div className="space-y-2 border-t border-border pt-4">
                                <h4 className="font-medium text-sm text-foreground">Acceptance Criteria</h4>
                                <div className="text-sm text-foreground dark:text-gray-100 leading-relaxed">
                                  {Array.isArray(selectedUserStory.acceptanceCriteria) ? (
                                    <HtmlContent html={selectedUserStory.acceptanceCriteria.join('<br/>')} />
                                  ) : (
                                    <HtmlContent html={selectedUserStory.acceptanceCriteria} />
                                  )}
                                </div>
                              </div>
                            )}
                            
                            {/* Additional metadata if available */}
                            {(selectedUserStory.businessValue || selectedUserStory.estimatedHours || selectedUserStory.dependencies) && (
                              <div className="space-y-3 border-t border-border pt-4">
                                <h4 className="font-medium text-sm text-foreground">Additional Details</h4>
                                <div className="grid grid-cols-1 gap-3 text-sm">
                                  {selectedUserStory.businessValue && (
                                    <div>
                                      <span className="font-medium text-foreground">Business Value: </span>
                                      <span className="text-foreground">{selectedUserStory.businessValue}</span>
                                    </div>
                                  )}
                                  {selectedUserStory.estimatedHours && (
                                    <div>
                                      <span className="font-medium text-foreground">Estimated Hours: </span>
                                      <span className="text-foreground">{selectedUserStory.estimatedHours}</span>
                                    </div>
                                  )}
                                  {selectedUserStory.dependencies && (
                                    <div>
                                      <span className="font-medium text-foreground">Dependencies: </span>
                                      <span className="text-foreground">{selectedUserStory.dependencies}</span>
                                    </div>
                                  )}
                                </div>
                              </div>
                            )}
                          </div>
                        </CardContent>
                      </Card>
                    )}
                  </div>
                </ScrollArea>
              </div>
            </>
          )}
        </div>

        {/* RIGHT PANEL - TEST CONFIGURATION */}
        <div className="flex-1 overflow-y-auto min-w-0 flex flex-col relative">
          {!selectedUserStory ? (
            /* No Story Selected State */
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center space-y-4 max-w-md">
                <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mx-auto">
                  <Zap className="h-8 w-8 text-muted-foreground" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-foreground">No User Story Selected</h3>
                  <p className="text-muted-foreground mt-2">
                    Select a user story from the left panel to configure and generate test cases.
                  </p>
                </div>
              </div>
            </div>
          ) : (
            /* Configuration Panel */
            <>
              {/* Scrollable Content Area */}
              <ScrollArea className="flex-1">
                <div className="p-4 space-y-4 pb-24">
                  {/* SECTION 1: Test Case Types */}
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-foreground">Test Case Types</CardTitle>
                      <p className="text-sm text-muted-foreground">
                        Select the types of test cases to generate with {llmLabel}
                      </p>
                    </CardHeader>
                    <CardContent className="space-y-6">
                      {/* Core Test Types (Batch 1) */}
                      <div>
                        <h4 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
                          Core Test Types
                          <Badge variant="secondary" className="text-xs">Batch 1</Badge>
                        </h4>
                        <div className="grid grid-cols-2 gap-4">
                          {testCaseTypes.slice(0, 4).map((type) => (
                            <div key={type.id} className="flex items-center space-x-3">
                              <Checkbox
                                id={type.id}
                                checked={type.selected}
                                onCheckedChange={() => handleTestTypeToggle(type.id)}
                                disabled={isGenerating}
                              />
                              <label
                                htmlFor={type.id}
                                className="text-sm font-medium leading-none cursor-pointer text-foreground"
                              >
                                {type.label}
                              </label>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Extended Test Types (Batch 2) */}
                      <div className="border-t pt-4">
                        <h4 className="text-sm font-semibold text-foreground mb-2 flex items-center gap-2">
                          Extended Test Types
                          <Badge variant="outline" className="text-xs">Batch 2 - Optional</Badge>
                        </h4>
                        <p className="text-xs text-muted-foreground mb-3">
                          Advanced test types for comprehensive validation (Performance, Security, Usability, Reliability)
                        </p>
                        <div className="grid grid-cols-2 gap-4">
                          {testCaseTypes.slice(4).map((type) => (
                            <div key={type.id} className="flex items-center space-x-3">
                              <Checkbox
                                id={type.id}
                                checked={type.selected}
                                onCheckedChange={() => handleTestTypeToggle(type.id)}
                                disabled={isGenerating}
                              />
                              <label
                                htmlFor={type.id}
                                className="text-sm font-medium leading-none cursor-pointer text-foreground"
                              >
                                {type.label}
                              </label>
                            </div>
                          ))}
                        </div>
                        <div className="mt-3 p-3 bg-blue-50 dark:bg-blue-950/20 rounded-md border border-blue-200 dark:border-blue-800">
                          <p className="text-xs text-blue-700 dark:text-blue-300">
                            💡 <span className="font-semibold">Performance Tip:</span> Extended types run in a separate batch (4 parallel calls) after core types to optimize LLM usage and reduce generation time.
                          </p>
                        </div>
                      </div>

                      {/* BDD Generation Option */}
                      <div className="border-t pt-4">
                        <div className="flex items-center space-x-3">
                          <Checkbox
                            id="generateBddAssets"
                            checked={shouldGenerateBddAssets}
                            onCheckedChange={(checked) => {
                              if (checked === 'indeterminate') return;
                              setShouldGenerateBddAssets(checked as boolean);
                            }}
                            disabled={isGenerating || isGeneratingBDD}
                          />
                          <label
                            htmlFor="generateBddAssets"
                            className="text-sm font-medium cursor-pointer text-foreground flex-1"
                          >
                            Generate Automation Script
                          </label>
                        </div>
                        <p className="text-xs text-muted-foreground mt-2">
                          When checked, BDD feature files and step definitions will be generated
                        </p>
                      </div>
                    </CardContent>
                  </Card>

                  {/* SECTION 2: Automation Framework */}
                  <Card className="border-border">
                    <CardHeader>
                      <CardTitle className="text-foreground">Automation Framework</CardTitle>
                      <p className="text-sm text-muted-foreground">
                        Choose your test automation framework
                      </p>
                    </CardHeader>
                    <CardContent>
                      <Select 
                        value={automationFramework} 
                        defaultValue="playwright-typescript"
                        onValueChange={setAutomationFramework} 
                        disabled={isGenerating || isGeneratingBDD}
                      >
                        <SelectTrigger className="w-full border-border">
                          <SelectValue placeholder="Playwright (TypeScript)" />
                        </SelectTrigger>
                        <SelectContent>
                          {frameworkOptions.map((framework) => (
                            <SelectItem key={framework.value} value={framework.value}>
                              {framework.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </CardContent>
                  </Card>

                  {/* SECTION 3: Manual Test Case Generation */}
                  <Card className="border-border">
                    <CardHeader>
                      <CardTitle className="text-foreground">Manual Test Case Generation</CardTitle>
                      <p className="text-sm text-muted-foreground">
                        AI-powered test cases with detailed steps, preconditions, and results
                      </p>
                    </CardHeader>
                    <CardContent>
                      <div className="min-h-[100px] flex items-center justify-center text-muted-foreground border-2 border-dashed border-border rounded-lg p-4">
                        {isGenerating ? (
                          <div className="space-y-3 text-center w-full">
                            <div className="flex items-center gap-3 justify-center">
                              <Loader2 className="h-5 w-5 animate-spin text-foreground" />
                              <span>Generating with {llmLabel}...</span>
                            </div>
                            
                            {jobStatus && jobStatus.progress > 0 && (
                              <div className="space-y-2">
                                <div className="w-full bg-muted rounded-full h-2">
                                  <div 
                                    className="bg-primary h-2 rounded-full transition-all duration-300" 
                                    style={{ width: `${Math.min(jobStatus.progress, 100)}%` }}
                                  />
                                </div>
                                <p className="text-xs text-muted-foreground">{jobStatus.progress}% complete</p>
                              </div>
                            )}
                          </div>
                        ) : generationResult ? (
                          <div className="w-full space-y-3">
                            <div className="text-center">
                              <div className="text-green-600 dark:text-green-400 font-medium mb-2">✓ Generation Complete</div>
                              <p className="text-sm text-foreground">
                                Test cases generated successfully
                              </p>
                            </div>
                            <Button 
                              type="button"
                              onClick={handleExportToExcel}
                              variant="outline"
                              className="w-full"
                            >
                              <FileSpreadsheet className="h-4 w-4 mr-2" />
                              Export to Excel
                            </Button>
                          </div>
                        ) : (
                          <div className="text-center space-y-1">
                            <span className="text-sm">Click "Generate Test Cases" to start</span>
                            <p className="text-xs text-muted-foreground">
                              Uses {llmLabel}
                            </p>
                          </div>
                        )}
                      </div>
                    </CardContent>
                  </Card>

                  {/* SECTION 4: BDD Assets Generation - ONLY SHOW IF USER OPTED-IN */}
                  {shouldGenerateBddAssets && (
                  <Card className="border-border">
                    <CardHeader>
                      <CardTitle className="text-foreground">Automation Script Generation</CardTitle>
                      <p className="text-sm text-muted-foreground">
                        Feature files and step definitions for automated testing
                      </p>
                    </CardHeader>
                    <CardContent>
                      <div className="min-h-[100px] flex items-center justify-center text-muted-foreground border-2 border-dashed border-border rounded-lg p-4">
                        {isGeneratingBDD ? (
                          <div className="space-y-3 text-center w-full">
                            <div className="flex items-center gap-3 justify-center">
                              <Loader2 className="h-5 w-5 animate-spin text-foreground" />
                              <span>Generating BDD Assets...</span>
                            </div>
                            
                            {bddJobStatus && bddJobStatus.progress > 0 && (
                              <div className="space-y-2">
                                <div className="w-full bg-muted rounded-full h-2">
                                  <div 
                                    className="bg-primary h-2 rounded-full transition-all duration-300" 
                                    style={{ width: `${Math.min(bddJobStatus.progress, 100)}%` }}
                                  />
                                </div>
                                <p className="text-xs text-muted-foreground">{bddJobStatus.progress}% complete</p>
                              </div>
                            )}
                          </div>
                        ) : bddGenerationResult ? (
                          <div className="w-full space-y-3">
                            <div className="text-center">
                              <div className="text-green-600 dark:text-green-400 font-medium mb-2">✓ BDD Assets Generated</div>
                              <p className="text-sm text-foreground mb-2">
                                {bddGenerationResult.featureFiles?.length || 0} features, {bddGenerationResult.stepDefFiles?.length || 0} step definitions
                              </p>
                            </div>
                            <div className="flex gap-2">
                              <Button 
                                onClick={handlePushToRepository}
                                variant="default"
                                className="flex-1"
                              >
                                <GitBranch className="h-4 w-4 mr-2" />
                                Push to Repository
                              </Button>
                              <Button 
                                onClick={handleExportBDDAsZIP}
                                variant="outline"
                                className="flex-1"
                              >
                                <FileDown className="h-4 w-4 mr-2" />
                                Export ZIP
                              </Button>
                            </div>
                          </div>
                        ) : generationResult ? (
                          <div className="text-center text-sm text-muted-foreground">
                            Save manual test cases to generate BDD assets
                          </div>
                        ) : (
                          <div className="text-center text-sm text-muted-foreground">
                            Generate manual test cases first
                          </div>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                  )}
                </div>
              </ScrollArea>

              {/* FIXED FOOTER ACTIONS - Always visible at bottom */}
              <div className="absolute bottom-0 left-0 right-0 border-t border-border bg-card px-4 py-3 shadow-lg">
                <div className="flex justify-between items-center gap-4">
                  <Button 
                    variant="outline" 
                    onClick={() => onEmbeddedClose ? onEmbeddedClose() : handleCancel()} 
                    disabled={isGenerating || isGeneratingBDD}
                  >
                    {onEmbeddedClose ? 'Close' : 'Cancel'}
                  </Button>
                  <Button 
                    onClick={handleGenerateTestCases}
                    disabled={!selectedUserStory || isGenerating || isGeneratingBDD || testCaseTypes.filter(t => t.selected).length === 0}
                    className="flex items-center gap-2"
                  >
                    {isGenerating ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Generating...
                      </>
                    ) : (
                      <>
                        <Zap className="h-4 w-4" />
                        Generate Test Cases
                      </>
                    )}
                  </Button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
      
      {/* Review & Edit Modal - ONLY modal that opens */}
      <TestCaseReviewModal
        open={showReviewModal}
        onOpenChange={(next) => {
          if (!next) {
            handleReviewModalClose();
          } else {
            setShowReviewModal(true);
          }
        }}
        testCasesData={generatedTestCasesForReview}
        onSave={handlePushToAdo}
        onGenerateBdd={handleGenerateBDDOnly}
        shouldShowBddButton={shouldGenerateBddAssets}
        isSaving={isPushingToAdo}
        integrationType={hierarchyData?.summary?.integrationType}
        pushMessage={pushMessage}
        pushProgress={pushProgress}
        pushCompleted={pushCompleted}
        pushedViewUrl={pushedViewUrl}
        pushedItemsSummary={pushedSummary}
        onClose={handleReviewModalClose}
      />
      {projectId && (
        <GitConfigModal
          open={showGitConfigModal}
          onOpenChange={setShowGitConfigModal}
          projectId={projectId}
        />
      )}
    </div>
  );
}
