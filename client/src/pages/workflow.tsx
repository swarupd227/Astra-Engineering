import { WorkflowProvider, useWorkflow } from "@/context/workflow-context";
import { StepTracker } from "@/components/workflow/step-tracker";
import { Step1ConversationalRefinement } from "@/components/workflow/step1-conversational-refinement";
import { Step2GeneratedContent } from "@/components/workflow/step2-generated-content";
import { Step3DevOpsPush } from "@/components/workflow/step3-devops-push";
import { Step3DevOpsPushJira } from "@/components/workflow/step3-devops-push-jira";
import { ComplianceGuidelinesModal } from "@/components/workflow/compliance-guidelines-modal";
import { buildGoldenRepoConfigFromProject } from "@/lib/golden-repositories";
import { PersonaSelectorModal } from "@/components/workflow/persona-selector-modal";
import { GenerationActivityLogPanel } from "@/components/workflow/generation-activity-log-panel";
import { WorkflowSessionsPanel } from "@/components/workflow/workflow-sessions-panel";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  RotateCcw,
  FileText,
  Edit2,
  X,
  Users as UsersIcon,
  Building2,
  FolderGit2,
  History,
  GitBranch,
  Loader2,
  Sparkles,
} from "lucide-react";
import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useSDLCProject } from "@/context/sdlc-project-context";
import { useSearch } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useSessionIdentity } from "@/utils/msal-user";
import { getApiUrl } from "@/lib/api-config";
import { useToast } from "@/hooks/use-toast";
import { useJiraOnlyWorkItems } from "@/hooks/use-hosting-config";

interface Persona {
  id: string;
  name: string;
  role: string;
  color: string;
  focus: string;
  painPoints: string[];
  goals: string[];
}

function WorkflowContent() {
  const {
    currentStep,
    setCurrentStep,
    resetWorkflow,
    complianceGuidelines,
    removeComplianceGuideline,
    clearComplianceGuidelines,
    selectedPersonaIds,
    setSelectedPersonaIds,
    projectId,
    sdlcProjectId,
    brdId,
    setProjectId,
    setRepositoryConfig,
    setProjectName,
    setSessionId,
    setRequirement,
    setEpics,
    setFeatures,
    setUserStories,
    setPersonas,
    setStep1Complete,
    setCapturedRequirements,
    setConversationMessages,
    setConversationPhase,
    setAskedQuestions,
    setWikiPages,
    setPushedEpics,
    setPushedFeatures,
    setPushedStories,
    setPushedWikiPages,
    setSelectedEpics,
    setSelectedFeatures,
    setSelectedStories,
    setSelectedWikiPages,
    // Generation log & status for Step 2 (restored from session for QA report download & activity log)
    setIsGeneratingArtifacts,
    addGenerationLog,
    setGuidelines,
    setQualityReport,
    setGenerationLogs,
    setDomainExpertAnalysis,
    integrationType,
    setIntegrationType,
  } = useWorkflow();
  const { projectConfig } = useSDLCProject();
  const sessionIdentity = useSessionIdentity();
  const jiraOnly = useJiraOnlyWorkItems();
  const [showGuidelinesModal, setShowGuidelinesModal] = useState(false);
  const [showPersonaModal, setShowPersonaModal] = useState(false);
  const [showSessionsPanel, setShowSessionsPanel] = useState(false);
  const [isResumingSession, setIsResumingSession] = useState(false);
  const resumePollingActiveRef = useRef(false);
  const { toast } = useToast();

  // Fetch personas from API
  const { data: personas = [] } = useQuery({
    queryKey: ["personas"],
    queryFn: async () => {
      const response = await apiRequest("GET", "/api/personas");
      return (await response.json()) as Persona[];
    },
    enabled: selectedPersonaIds.length > 0, // Only fetch when personas are selected
  });

  // Fetch approved BRDs so we can show which BRD the current artifacts belong to
  const brdProjectId = projectId || sdlcProjectId;
  const { data: approvedBrds = [] } = useQuery({
    queryKey: ["/api/dev-brd/approved", brdProjectId],
    queryFn: async () => {
      if (!brdProjectId) return [] as Array<{ id: string; title: string }>;
      const response = await apiRequest(
        "GET",
        `/api/dev-brd/approved?projectId=${encodeURIComponent(brdProjectId)}`
      );
      const data = await response.json();
      return Array.isArray(data)
        ? (data as Array<{ id: string; title: string }>)
        : [];
    },
    enabled: !!brdProjectId,
  });
  const selectedBrdTitle =
    approvedBrds.find((b) => b.id === brdId)?.title ?? null;

  // Get platform project ID (jiraProjectId or adoProjectId), organization name, and project name from URL params
  const search = useSearch();
  const params = new URLSearchParams(search);
  const urlProjectId = params.get("projectId");
  const urlPlatformProjectId = params.get("jiraProjectId") || params.get("adoProjectId");
  const urlOrganizationName = params.get("organizationName");
  const urlProjectName = params.get("projectName");
  const urlGoldenRepoName = params.get("goldenRepoName");

  // Set projectId in context when URL param is available
  useEffect(() => {
    const newProjectId = urlPlatformProjectId || urlProjectId || null;
    
    console.log("[Workflow] Setting projectId from URL params:", {
      urlProjectId,
      urlPlatformProjectId,
      newProjectId,
      timestamp: new Date().toISOString(),
    });
    
    if (newProjectId !== null) {
      setProjectId(newProjectId);
    } else {
      setProjectId(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlProjectId, urlPlatformProjectId]);

  // Fetch project details (single source for golden repo config and guideline filePaths)
  const { data: projectData, refetch: refetchProjectDetails } = useQuery({
    queryKey: ["/api/sdlc/projects", urlProjectId || urlPlatformProjectId],
    queryFn: async () => {
      if (!urlProjectId && !urlPlatformProjectId && !urlOrganizationName && !urlProjectName) return null;

      // If we have organization and project names, prefer GitHub workflow over ADO
      if (urlOrganizationName && urlProjectName) {
        console.log(
          "[Workflow] Using GitHub workflow with organization:", urlOrganizationName, "project:", urlProjectName
        );
        return {
          project: {
            id: urlProjectId || `${urlOrganizationName}-${urlProjectName}`,
            name: urlProjectName,
            organization: urlOrganizationName,
            github_based: true,
            integrationType: "jira",
          },
          phases: [],
          repository: null
        };
      }

      // Try to fetch by ADO project ID first (when coming from projects nav, projectId is usually an ADO project ID)
      // This ensures we get repository information needed for file selection
      const identifier = urlPlatformProjectId || urlProjectId;
      if (identifier) {
        try {
          // Skip ADO lookup if we have GitHub configuration in environment
          try {
            const githubConfigResponse = await apiRequest("GET", "/api/github-config");
            if (githubConfigResponse.ok) {
              const githubConfig = await githubConfigResponse.json();
              if (githubConfig.githubToken && githubConfig.githubOwner && githubConfig.githubRepo) {
                console.log(
                  "[Workflow] GitHub configuration detected, skipping ADO lookup for identifier:", identifier
                );
                return {
                  project: {
                    id: identifier,
                    name: urlProjectName || identifier,
                    organization: urlOrganizationName || githubConfig.githubOwner,
                    github_based: true,
                    integrationType: "jira",
                  },
                  phases: [],
                  repository: null
                };
              }
            }
          } catch (githubError) {
            console.log("[Workflow] Could not check GitHub config, proceeding with ADO lookup");
          }

          const encodedIdentifier = encodeURIComponent(identifier);
          const adoResponse = await apiRequest(
            "GET",
            `/api/sdlc/projects/by-ado/${encodedIdentifier}/details`
          );
          if (adoResponse.ok) {
            const adoData = await adoResponse.json();
            console.log(
              "[Workflow] Successfully fetched project by ADO identifier"
            );
            return adoData;
          }
          // If ADO lookup fails and we have urlProjectId (not urlPlatformProjectId), try SDLC project lookup
          if (urlProjectId && !urlPlatformProjectId) {
            console.log(
              "[Workflow] ADO project lookup failed, trying SDLC project lookup"
            );
            const sdlcResponse = await apiRequest(
              "GET",
              `/api/sdlc/projects/${urlProjectId}/details`
            );
            if (sdlcResponse.ok) {
              return await sdlcResponse.json();
            }
          }
        } catch (error) {
          console.error(
            "[Workflow] Error fetching project by ADO identifier:",
            error
          );
          // If ADO lookup fails and we have urlProjectId (not urlPlatformProjectId), try SDLC project lookup
          if (urlProjectId && !urlPlatformProjectId) {
            try {
              console.log("[Workflow] Trying SDLC project lookup as fallback");
              const sdlcResponse = await apiRequest(
                "GET",
                `/api/sdlc/projects/${urlProjectId}/details`
              );
              if (sdlcResponse.ok) {
                return await sdlcResponse.json();
              }
            } catch (sdlcError) {
              console.error(
                "[Workflow] Error fetching project by SDLC ID:",
                sdlcError
              );
            }
          }
        }
      }

      return null;
    },
    enabled: !!(urlProjectId || urlPlatformProjectId),
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnReconnect: true,
    refetchOnWindowFocus: true,
  });

  // Sync integrationType from project details to context (hosting mode takes priority)
  useEffect(() => {
    if (jiraOnly) {
      setIntegrationType("jira");
    } else if (projectData?.project) {
      const type = projectData.project.integrationType || 
                   (projectData.project.cloudProvider === "Jira" ? "jira" : "ado");
      setIntegrationType(type as "ado" | "jira");
    }
  }, [projectData, setIntegrationType, jiraOnly]);

  // Normalize project from details API (support both camelCase and snake_case from server)
  const project = projectData?.project as Record<string, unknown> | undefined;
  const linkedGoldenRepoOrg =
    (project?.linkedGoldenRepoOrg as string) ?? (project?.linked_golden_repo_org as string);
  const linkedGoldenRepoProject =
    (project?.linkedGoldenRepoProject as string) ?? (project?.linked_golden_repo_project as string);
  const goldenRepoRef = (project?.goldenRepoReference ?? project?.golden_repo_reference) as
    | { repoId?: string; repoName?: string; filePaths?: string[]; provider?: string; url?: string; repoUrl?: string }
    | undefined;
  // repository_id can be camelCase or snake_case from API; use when goldenRepoReference is null
  const projectRepoId = (project?.repository_id as string) ?? (project?.repositoryId as string);
  // Server may resolve internal repository_id to ADO repo GUID (effectiveAdoRepositoryId) for tree/file APIs
  const effectiveAdoRepoId = (projectData as { effectiveAdoRepositoryId?: string } | undefined)?.effectiveAdoRepositoryId;

  // Use effective ADO repo ID (resolved by server), then goldenRepoReference.repoId, else project's repository_id
  const linkedGoldenRepoId = effectiveAdoRepoId ?? goldenRepoRef?.repoId ?? projectRepoId;

  // Golden repo display name – follow BRD generate behavior: rely solely on URL param
  const goldenRepoNameDisplay = urlGoldenRepoName || "";

  // Normalized display values from details API (support both camelCase and snake_case)
  const projectNameDisplay = (project?.name as string) ?? urlProjectName ?? "";
  const projectOrgDisplay = (project?.organization as string) ?? urlOrganizationName ?? "";

  const goldenRepoConfig = useMemo(
    () => (project ? buildGoldenRepoConfigFromProject(project, effectiveAdoRepoId) : null),
    [project, effectiveAdoRepoId],
  );

  // Golden repo config: single source of truth from details API (no separate config fetch).
  // When project is updated elsewhere, refetch details so context and guideline files stay in sync.
  useEffect(() => {
    if (!goldenRepoConfig) return;
    setRepositoryConfig({
      repositoryId: goldenRepoConfig.repositoryId,
      organization: goldenRepoConfig.organization,
      projectName: goldenRepoConfig.projectName,
      patToken: "",
      provider: goldenRepoConfig.provider,
      url: goldenRepoConfig.url,
    });
    setProjectName(goldenRepoConfig.projectName);
  }, [goldenRepoConfig, setRepositoryConfig, setProjectName]);

  // Auto-open compliance guidelines modal on page load when golden repo is linked
  // and no guidelines are selected yet (skip for session resumes)
  const [hasAutoOpened, setHasAutoOpened] = useState(false);
  useEffect(() => {
    if (
      hasAutoOpened ||
      isResumingSession ||
      showGuidelinesModal ||
      complianceGuidelines.length > 0
    ) return;
    if (goldenRepoConfig && complianceGuidelines.length === 0) {
      setHasAutoOpened(true);
      requestAnimationFrame(() => setShowGuidelinesModal(true));
    }
  }, [
    goldenRepoConfig,
    hasAutoOpened,
    isResumingSession,
    showGuidelinesModal,
    complianceGuidelines.length,
  ]);

  // Re-attach to an in-progress generation job based on a persisted jobId.
  const resumeGenerationFromJob = useCallback(
    async (jobId: string, mode: "council" | "single" | string | undefined) => {
      if (resumePollingActiveRef.current) return;
      resumePollingActiveRef.current = true;
      try {
        setIsGeneratingArtifacts(true);
        setGenerationLogs([{ message: `Resuming generation job...`, timestamp: new Date() }]);

        const isCouncil = mode === "council";
        const statusEndpoint = isCouncil
          ? `/api/workflow/generate-artifacts-council/status/${jobId}`
          : `/api/workflow/generate-artifacts/status/${jobId}`;

        let done = false;
        let consecutiveNetworkErrors = 0;
        const maxNetworkRetries = 5;
        let lastLoggedStep: string | null = null;
        let logsRestored = false;

        while (!done) {
          try {
            const res = await apiRequest("GET", statusEndpoint);
            consecutiveNetworkErrors = 0;
            const statusData = await res.json();

            // On first successful poll, restore all accumulated generation logs from the server
            if (!logsRestored && Array.isArray(statusData.generationLogs) && statusData.generationLogs.length > 0) {
              logsRestored = true;
              const restored = statusData.generationLogs.map((l: { message: string; timestamp: string }) => ({
                message: l.message,
                timestamp: typeof l.timestamp === "string" ? new Date(l.timestamp) : new Date(),
              }));
              setGenerationLogs(restored);
              lastLoggedStep = statusData.step ?? null;
            }

            if (statusData.step && statusData.step !== lastLoggedStep) {
              lastLoggedStep = statusData.step;
              addGenerationLog(statusData.step);
            }

            if (statusData.qualityReport) {
              setQualityReport(statusData.qualityReport);
            }
            if (statusData.domainExpertAnalysis) {
              setDomainExpertAnalysis(statusData.domainExpertAnalysis);
            }

            if (statusData.status === "completed") {
              const result = statusData.result ?? {};
              const artifacts = result.artifacts ?? result;

              setEpics(artifacts.epics ?? []);
              setFeatures(artifacts.features ?? []);
              setUserStories(artifacts.userStories ?? []);
              setPersonas(artifacts.personas ?? []);
              setWikiPages(artifacts.wikiPages ?? []);
              if ((artifacts.epics?.length ?? 0) > 0) {
                setStep1Complete(true);
              }

              addGenerationLog(`✅ Generation completed`);
              done = true;
            } else if (statusData.status === "failed") {
              addGenerationLog(
                `❌ Generation failed: ${statusData.error || "Unknown error"}`
              );
              done = true;
            } else if (statusData.status === "cancelled") {
              addGenerationLog(`⚠️ Generation was cancelled`);
              done = true;
            } else {
              await new Promise((r) => setTimeout(r, 3000));
            }
          } catch (pollError: any) {
            const msg = pollError instanceof Error ? pollError.message : String(pollError);
            const isTransient =
              msg.includes("Failed to fetch") ||
              msg.includes("NetworkError") ||
              msg.includes("Load failed") ||
              msg.includes("net::ERR_") ||
              msg.includes("Network request failed");
            if (isTransient && consecutiveNetworkErrors < maxNetworkRetries) {
              consecutiveNetworkErrors++;
              const backoffMs = Math.min(2000 * Math.pow(2, consecutiveNetworkErrors - 1), 15000);
              console.warn(
                `[Workflow] Transient network error resuming job ${jobId} (retry ${consecutiveNetworkErrors}/${maxNetworkRetries}), retrying in ${backoffMs}ms`,
              );
              await new Promise((r) => setTimeout(r, backoffMs));
            } else {
              throw pollError;
            }
          }
        }
      } catch (e) {
        console.error("[Workflow] Failed to resume generation job:", e);
        addGenerationLog("❌ Error while resuming generation job");
      } finally {
        resumePollingActiveRef.current = false;
        setIsGeneratingArtifacts(false);
      }
    },
    [
      setIsGeneratingArtifacts,
      setGenerationLogs,
      addGenerationLog,
      setQualityReport,
      setDomainExpertAnalysis,
      setEpics,
      setFeatures,
      setUserStories,
      setPersonas,
      setWikiPages,
      setStep1Complete,
    ]
  );

  // Resume a saved session: load session + workflow steps and restore context
  const handleResumeSession = useCallback(
    async (sessionIdToLoad: string) => {
      if (!sessionIdentity || isResumingSession) return;
      try {
        setIsResumingSession(true);
        const headers = {
          "X-AAD-Object-ID": sessionIdentity.aadObjectId,
          "X-User-Email": sessionIdentity.userEmail,
          "X-User-Name": sessionIdentity.userName,
        };
        const [sessionRes, stepsRes] = await Promise.all([
          fetch(getApiUrl(`/api/sessions/${sessionIdToLoad}`), {
            credentials: "include",
            headers,
          }),
          fetch(getApiUrl(`/api/sessions/${sessionIdToLoad}/workflow-steps`), {
            credentials: "include",
            headers,
          }),
        ]);
        if (!sessionRes.ok || !stepsRes.ok) {
          const failedRes = !sessionRes.ok ? sessionRes : stepsRes;
          const errBody = await failedRes.json().catch(() => ({}));
          const errMsg = (errBody as { error?: string }).error ?? "Session not found or access denied.";
          toast({
            title: "Cannot load session",
            description: errMsg,
            variant: "destructive",
          });
          return;
        }
        const sessionData = await sessionRes.json();
        const stepsData = await stepsRes.json();
        const session = sessionData?.session;
        const state = sessionData?.state;
        const step1 = stepsData?.step1Data;
        const step2 = stepsData?.step2Data;
        const steps = stepsData?.steps ?? [];

        setSessionId(sessionIdToLoad);

        // Prefer detailed workflow step data if present
        if (step1) {
          setConversationMessages(step1.conversationHistory ?? []);
          setCapturedRequirements(step1.capturedRequirements ?? {});
          setConversationPhase(step1.currentPhase ?? "understanding");
          setAskedQuestions(step1.askedQuestions ?? []);
          if (step1.requirement) setRequirement(step1.requirement);
        }

        if (step2) {
          let step2Epics = step2.epics ?? [];
          let step2Features = step2.features ?? [];
          const step2Personas = step2.personas ?? [];
          const step2WikiPages = step2.wikiPages ?? [];
          const step2UserStoriesRaw = Array.isArray(step2.userStories)
            ? [...step2.userStories]
            : [];
          const step2TestCases = Array.isArray(step2.testCases)
            ? step2.testCases
            : [];

          // Re-attach persisted test cases to their related user stories on resume
          let restoredUserStories = step2UserStoriesRaw;
          if (step2TestCases.length > 0 && restoredUserStories.length > 0) {
            const testCasesByStory: Record<string, any[]> = {};

            step2TestCases.forEach((tc: any) => {
              const storyId =
                tc.relatedStoryId || tc.userStoryId || tc.storyId;
              if (!storyId) return;
              if (!testCasesByStory[storyId]) {
                testCasesByStory[storyId] = [];
              }
              testCasesByStory[storyId].push(tc);
            });

            if (Object.keys(testCasesByStory).length > 0) {
              restoredUserStories = restoredUserStories.map((story: any) => {
                const storyTestCases = testCasesByStory[story.id];
                if (storyTestCases && storyTestCases.length > 0) {
                  const existing =
                    Array.isArray(story.testCases) && story.testCases.length > 0
                      ? story.testCases
                      : [];
                  return {
                    ...story,
                    testCases: [...existing, ...storyTestCases],
                  };
                }
                return story;
              });
            }
          }

          // If we have test cases but no user stories (e.g. "only test cases" flows),
          // create a minimal placeholder epic/feature/story so Step 2 can render them.
          if (step2TestCases.length > 0 && restoredUserStories.length === 0) {
            const fullText =
              (step1 && typeof step1.requirement === "string"
                ? step1.requirement
                : "") || "";

            let storyTitle = "User Story for Test Cases";
            let storyDescription = "";

            const lines = fullText
              .split("\n")
              .filter((l: string) => l.trim().length > 10);
            if (lines.length > 0) {
              storyTitle = lines[0].trim().substring(0, 200);
              storyDescription = lines
                .slice(0, 10)
                .join("\n")
                .substring(0, 2000);
            } else if (fullText.trim().length > 0) {
              storyDescription = fullText.substring(0, 2000);
            }

            const personaName = "User";
            const personaId = `persona-${Date.now()}`;

            let epicId =
              step2Epics && step2Epics.length > 0
                ? step2Epics[0].id
                : `epic-${Date.now()}`;
            let featureId =
              step2Features && step2Features.length > 0
                ? step2Features[0].id
                : `feature-${Date.now()}`;

            if (!step2Epics || step2Epics.length === 0) {
              step2Epics = [
                {
                  id: epicId,
                  title: "Standalone Epic",
                  description: "Epic created for test case generation",
                  priority: "Medium" as const,
                },
              ];
            }

            if (!step2Features || step2Features.length === 0) {
              step2Features = [
                {
                  id: featureId,
                  title: "Standalone Feature",
                  description: "Feature created for test case generation",
                  epicId,
                  priority: "Medium" as const,
                },
              ];
            }

            const newStory = {
              id: `story-${Date.now()}`,
              title: storyTitle,
              description:
                storyDescription || "User story for generated test cases",
              testCases: step2TestCases,
              acceptanceCriteria: [],
              storyPoints: 3,
              priority: "Medium" as const,
              status: "backlog",
              persona: personaName,
              personaId,
              epicId,
              featureId,
            };

            restoredUserStories = [newStory];
          }

          setEpics(step2Epics);
          setFeatures(step2Features);
          setUserStories(restoredUserStories);
          setPersonas(step2Personas);
          setWikiPages(step2WikiPages);
          // Restore design guidelines / design prompt for Step 2 if present
          if (typeof step2.guidelines === "string" && step2.guidelines.trim().length > 0) {
            setGuidelines(step2.guidelines);
          }
          // Restore QA report and activity logs so download and panel work after navigation
          if (step2.qualityReport != null) {
            setQualityReport(step2.qualityReport);
          }
          if (Array.isArray(step2.generationLogs) && step2.generationLogs.length > 0) {
            setGenerationLogs(
              step2.generationLogs.map((l: { message: string; timestamp: string }) => ({
                message: l.message,
                timestamp: typeof l.timestamp === "string" ? new Date(l.timestamp) : new Date(),
              }))
            );
          }
          if (step2.domainExpertAnalysis != null && typeof step2.domainExpertAnalysis === "object") {
            setDomainExpertAnalysis({
              domain: step2.domainExpertAnalysis.domain ?? "general",
              domainAnalysis: step2.domainExpertAnalysis.domainAnalysis ?? "",
            });
          }
          if (step2Epics.length > 0) setStep1Complete(true);

          // If step2 has no artifacts but session is still IN_PROGRESS, check snapshot for running job
          if (
            step2Epics.length === 0 &&
            session?.status === "IN_PROGRESS" &&
            state?.stateSnapshot
          ) {
            try {
              const snap = JSON.parse(state.stateSnapshot);
              if (snap?.generationJob?.jobId) {
                void resumeGenerationFromJob(
                  snap.generationJob.jobId as string,
                  (snap.generationJob.mode as "council" | "single" | string) ?? "single"
                );
              }
            } catch { /* ignore parse errors */ }
          }

          // If step2 had no wiki pages (e.g. save failed after wiki generation), load from wiki session API
          if (step2WikiPages.length === 0) {
            fetch(getApiUrl(`/api/wiki/session/${sessionIdToLoad}`), {
              credentials: "include",
              headers,
            })
              .then((r) => (r.ok ? r.json() : null))
              .then((data: { pages?: unknown[] } | null) => {
                if (data?.pages && data.pages.length > 0) {
                  setWikiPages(data.pages as Parameters<typeof setWikiPages>[0]);
                }
              })
              .catch(() => {});
          }

          // Restore Step 3 pushed state so already-pushed items show ADO tag and are unchecked/disabled
          const step3 = stepsData?.step3Data;
          if (step3?.pushedItems) {
            const pushedEpicIds = new Set<string>((step3.pushedItems.epics ?? []).map((e: { id: string }) => e.id));
            const pushedFeatureIds = new Set<string>((step3.pushedItems.features ?? []).map((e: { id: string }) => e.id));
            const pushedStoryIds = new Set<string>((step3.pushedItems.userStories ?? []).map((e: { id: string }) => e.id));
            const pushedWikiIds = new Set<string>((step3.pushedItems.wikiPages ?? []).map((e: { id: string }) => e.id));
            setPushedEpics(pushedEpicIds);
            setPushedFeatures(pushedFeatureIds);
            setPushedStories(pushedStoryIds);
            setPushedWikiPages(pushedWikiIds);
            setSelectedEpics(new Set<string>(step2Epics.filter((e: { id: string }) => !pushedEpicIds.has(e.id)).map((e: { id: string }) => e.id)));
            setSelectedFeatures(new Set<string>(step2Features.filter((f: { id: string }) => !pushedFeatureIds.has(f.id)).map((f: { id: string }) => f.id)));
            setSelectedStories(new Set<string>(restoredUserStories.filter((s: { id: string }) => !pushedStoryIds.has(s.id)).map((s: { id: string }) => s.id)));
            setSelectedWikiPages(new Set<string>(step2WikiPages.filter((w: { id: string }) => !pushedWikiIds.has(w.id)).map((w: { id: string }) => w.id)));
          }
        } else if (state?.stateSnapshot) {
          // Fallback: restore from generic session state snapshot
          try {
            const snapshot = JSON.parse(state.stateSnapshot);
            const inputs = snapshot.inputs || {};
            const outputs = snapshot.outputs || {};
            const generationJob = snapshot.generationJob;

            // Restore main requirement text if available so wiki generation works
            if (
              typeof inputs.requirement === "string" &&
              inputs.requirement.trim().length > 0
            ) {
              setRequirement(inputs.requirement);
            }

            let snapshotEpics = outputs.epics ?? [];
            let snapshotFeatures = outputs.features ?? [];
            const snapshotPersonas = outputs.personas ?? [];
            const snapshotWikiPages = outputs.wikiPages ?? [];
            const snapshotUserStoriesRaw = Array.isArray(outputs.userStories)
              ? [...outputs.userStories]
              : [];
            const snapshotTestCases = Array.isArray(outputs.testCases)
              ? outputs.testCases
              : [];

            // Re-attach any persisted test cases from generic state snapshot
            let restoredSnapshotStories = snapshotUserStoriesRaw;
            if (
              snapshotTestCases.length > 0 &&
              restoredSnapshotStories.length > 0
            ) {
              const testCasesByStory: Record<string, any[]> = {};

              snapshotTestCases.forEach((tc: any) => {
                const storyId =
                  tc.relatedStoryId || tc.userStoryId || tc.storyId;
                if (!storyId) return;
                if (!testCasesByStory[storyId]) {
                  testCasesByStory[storyId] = [];
                }
                testCasesByStory[storyId].push(tc);
              });

              if (Object.keys(testCasesByStory).length > 0) {
                restoredSnapshotStories = restoredSnapshotStories.map(
                  (story: any) => {
                    const storyTestCases = testCasesByStory[story.id];
                    if (storyTestCases && storyTestCases.length > 0) {
                      const existing =
                        Array.isArray(story.testCases) &&
                        story.testCases.length > 0
                          ? story.testCases
                          : [];
                      return {
                        ...story,
                        testCases: [...existing, ...storyTestCases],
                      };
                    }
                    return story;
                  }
                );
              }
            }

            // If we have test cases but no user stories in the snapshot, create a placeholder
            if (
              snapshotTestCases.length > 0 &&
              restoredSnapshotStories.length === 0
            ) {
              const fullText =
                typeof inputs.requirement === "string"
                  ? inputs.requirement
                  : "";

              let storyTitle = "User Story for Test Cases";
              let storyDescription = "";

              const lines = fullText
                .split("\n")
                .filter((l: string) => l.trim().length > 10);
              if (lines.length > 0) {
                storyTitle = lines[0].trim().substring(0, 200);
                storyDescription = lines
                  .slice(0, 10)
                  .join("\n")
                  .substring(0, 2000);
              } else if (fullText.trim().length > 0) {
                storyDescription = fullText.substring(0, 2000);
              }

              const personaName = "User";
              const personaId = `persona-${Date.now()}`;

              let epicId =
                snapshotEpics && snapshotEpics.length > 0
                  ? snapshotEpics[0].id
                  : `epic-${Date.now()}`;
              let featureId =
                snapshotFeatures && snapshotFeatures.length > 0
                  ? snapshotFeatures[0].id
                  : `feature-${Date.now()}`;

              if (!snapshotEpics || snapshotEpics.length === 0) {
                snapshotEpics = [
                  {
                    id: epicId,
                    title: "Standalone Epic",
                    description: "Epic created for test case generation",
                    priority: "Medium" as const,
                  },
                ];
              }

              if (!snapshotFeatures || snapshotFeatures.length === 0) {
                snapshotFeatures = [
                  {
                    id: featureId,
                    title: "Standalone Feature",
                    description: "Feature created for test case generation",
                    epicId,
                    priority: "Medium" as const,
                  },
                ];
              }

              const newStory = {
                id: `story-${Date.now()}`,
                title: storyTitle,
                description:
                  storyDescription || "User story for generated test cases",
                testCases: snapshotTestCases,
                acceptanceCriteria: [],
                storyPoints: 3,
                priority: "Medium" as const,
                status: "backlog",
                persona: personaName,
                personaId,
                epicId,
                featureId,
              };

              restoredSnapshotStories = [newStory];
            }

            setEpics(snapshotEpics);
            setFeatures(snapshotFeatures);
            setUserStories(restoredSnapshotStories);
            setPersonas(snapshotPersonas);
            setWikiPages(snapshotWikiPages);
            // Restore design guidelines / design prompt if present in generic snapshot
            if (
              typeof outputs.guidelines === "string" &&
              outputs.guidelines.trim().length > 0
            ) {
              setGuidelines(outputs.guidelines);
            }
            if (snapshotEpics.length > 0) setStep1Complete(true);

            if (typeof snapshot.screen === "string") {
              // Infer step from saved screen if available
              if (snapshot.screen === "STEP_2_GENERATED_CONTENT") {
                setCurrentStep(2);
              } else if (snapshot.screen === "STEP_3_DEVOPS_PUSH") {
                setCurrentStep(3);
              }
            }

            // If there is a persisted job and no artifacts yet, re-attach polling
            const hasArtifacts =
              (outputs.epics?.length ?? 0) > 0 ||
              (outputs.features?.length ?? 0) > 0 ||
              (outputs.userStories?.length ?? 0) > 0;

            if (generationJob?.jobId && !hasArtifacts) {
              void resumeGenerationFromJob(
                generationJob.jobId as string,
                (generationJob.mode as "council" | "single" | string) ?? "single"
              );
            }
          } catch (e) {
            console.error("[Workflow] Failed to parse session state snapshot:", e);
          }
        }

        // If we have workflow step metadata, use it to pick the target step.
        // Otherwise, keep whatever step was inferred from the saved snapshot.
        if (steps.length > 0) {
          const inProgress = steps.find(
            (s: { status: string }) => s.status === "IN_PROGRESS"
          );
          const lastCompleted = steps.filter(
            (s: { status: string }) => s.status === "COMPLETED"
          ).length;
          const targetStep = inProgress
            ? inProgress.stepNumber
            : Math.min(lastCompleted + 1, 3);
          setCurrentStep(targetStep);
        }

        // When session status is COMPLETED, always load Step 3 (Push to ADO / Save)
        if (session?.status === "COMPLETED") {
          setCurrentStep(3);
        }
      } catch (e) {
        console.error("[Workflow] Resume session failed:", e);
      } finally {
        setIsResumingSession(false);
      }
    },
    [
      sessionIdentity,
      setSessionId,
      setRequirement,
      setEpics,
      setFeatures,
      setUserStories,
      setPersonas,
      setStep1Complete,
      setCapturedRequirements,
      setConversationMessages,
      setConversationPhase,
      setAskedQuestions,
      setWikiPages,
      setPushedEpics,
      setPushedFeatures,
      setPushedStories,
      setPushedWikiPages,
      setSelectedEpics,
      setSelectedFeatures,
      setSelectedStories,
      setSelectedWikiPages,
      setCurrentStep,
      resumeGenerationFromJob,
      isResumingSession,
      setGenerationLogs,
      setQualityReport,
      setDomainExpertAnalysis,
      setGuidelines,
      toast,
    ]
  );

  // Project id used for session list (matches URL)
  const sessionsProjectId = urlPlatformProjectId || urlProjectId || null;

  // Modal is no longer opened automatically on page load
  // Users can manually open it using the "Select Guidelines" button

  return (
    <div className="min-h-screen bg-background relative">
      {isResumingSession && (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-background/80 backdrop-blur-sm">
          <div className="w-full max-w-3xl px-4">
            <div className="flex flex-col items-center gap-4">
              <Loader2 className="h-10 w-10 animate-spin text-primary" aria-hidden />
              <p className="text-center text-xl font-semibold tracking-tight text-foreground">
                Loading your session
              </p>
              <p className="text-sm text-muted-foreground">
                Restoring your workflow…
              </p>
            </div>
          </div>
        </div>
      )}
      <div>
        {/* Header with Actions */}
        <div className="border-b bg-card sticky top-0 z-50">
          <div className="p-6">
      <PageHeader
        icon={Sparkles}
        title="AI-Powered SDLC Workflow"
        subtitle="Transform requirements into actionable agile artifacts with AI"
        color="violet"
      >
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowPersonaModal(true)}
            data-testid={
              selectedPersonaIds.length > 0
                ? "button-edit-personas"
                : "button-select-personas"
            }
          >
            {selectedPersonaIds.length > 0 ? (
              <>
                <UsersIcon className="h-4 w-4 mr-2" />
                Edit Personas ({selectedPersonaIds.length})
              </>
            ) : (
              <>
                <UsersIcon className="h-4 w-4 mr-2" />
                Select Personas
              </>
            )}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={async () => {
              // Refetch project details so we have latest golden repo config (and filePaths if goldenRepoReference is set)
              await refetchProjectDetails();
              // Allow React to re-render with new projectData so repositoryConfigFromProject prop is current
              requestAnimationFrame(() => {
                requestAnimationFrame(() => setShowGuidelinesModal(true));
              });
            }}
            data-testid={
              complianceGuidelines.length > 0
                ? "button-edit-guidelines"
                : "button-select-guidelines"
            }
          >
            {complianceGuidelines.length > 0 ? (
              <>
                <Edit2 className="h-4 w-4 mr-2" />
                Edit Guidelines
              </>
            ) : (
              <>
                <FileText className="h-4 w-4 mr-2" />
                Select Guidelines
              </>
            )}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowSessionsPanel(true)}
            data-testid="button-show-sessions"
            title="Show saved sessions for this project"
          >
            <History className="h-4 w-4 mr-2" />
            My Sessions
          </Button>
          <Button
            variant="outline"
            onClick={resetWorkflow}
            data-testid="button-reset-workflow"
          >
            <RotateCcw className="h-4 w-4 mr-2" />
            Reset Workflow
          </Button>
        </div>
      </PageHeader>

      {/* Display Organization, Project, and Golden Repo tag */}
      {(projectNameDisplay ||
        projectOrgDisplay ||
        urlOrganizationName ||
        urlProjectName ||
        selectedBrdTitle ||
        goldenRepoNameDisplay) && (
        <div className="flex flex-wrap items-center gap-3 text-sm mt-4">
          {(projectOrgDisplay || urlOrganizationName) && (
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800">
              <Building2 className="h-4 w-4 text-blue-600 dark:text-blue-400" />
              <span className="font-medium text-blue-800 dark:text-blue-300">
                Organization:{" "}
                {projectOrgDisplay
                  ? projectOrgDisplay
                      .toString()
                      .replace(/^https?:\/\//, "")
                      .replace(/\/+$/, "")
                  : urlOrganizationName}
              </span>
            </div>
          )}
          {(projectNameDisplay || urlProjectName) && (
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-800">
              <FolderGit2 className="h-4 w-4 text-green-600 dark:text-green-400" />
              <span className="font-medium text-green-800 dark:text-green-300">
                Project: {projectNameDisplay || urlProjectName}
              </span>
            </div>
          )}
          {selectedBrdTitle && (
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-violet-50 dark:bg-violet-950/20 border border-violet-200 dark:border-violet-800">
              <FileText className="h-4 w-4 text-violet-600 dark:text-violet-400" />
              <span className="font-medium text-violet-800 dark:text-violet-300">
                BRD: {selectedBrdTitle}
              </span>
            </div>
          )}
          {goldenRepoNameDisplay && (
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800">
              <GitBranch className="h-4 w-4 text-amber-600 dark:text-amber-400" />
              <span className="font-medium text-amber-800 dark:text-amber-300">
                Golden Repo: {goldenRepoNameDisplay}
              </span>
            </div>
          )}
        </div>
      )}
          </div>
        </div>

      {/* Main Content */}
      <div className="max-w-[1800px] mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-6">

      <WorkflowSessionsPanel
        open={showSessionsPanel}
        onOpenChange={setShowSessionsPanel}
        projectId={sessionsProjectId}
        onResume={handleResumeSession}
      />

      {/* Selected Personas Display */}
      {selectedPersonaIds.length > 0 && (
        <div
          className="border rounded-lg p-4 bg-card"
          data-testid="selected-personas-display"
        >
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <UsersIcon className="h-4 w-4 text-primary" />
              <h3 className="font-medium text-sm">
                {selectedPersonaIds.length} Persona
                {selectedPersonaIds.length > 1 ? "s" : ""} Selected
              </h3>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSelectedPersonaIds([])}
              data-testid="button-clear-all-personas"
            >
              Clear All
            </Button>
          </div>
          <div className="flex flex-wrap gap-2">
            {selectedPersonaIds.map((personaId) => {
              // Find the persona from the fetched data
              const persona = personas.find((p: Persona) => p.id === personaId);
              const displayName = persona
                ? `${persona.name} (${persona.role})`
                : `Persona ${personaId}`;

              return (
                <Badge
                  key={personaId}
                  variant="secondary"
                  className="gap-1 pr-1"
                  data-testid={`badge-persona-${personaId}`}
                >
                  <UsersIcon className="h-3 w-3" />
                  <span>{displayName}</span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-4 w-4 p-0 hover:bg-transparent"
                    onClick={() =>
                      setSelectedPersonaIds(
                        selectedPersonaIds.filter((id) => id !== personaId)
                      )
                    }
                    data-testid={`button-remove-persona-${personaId}`}
                  >
                    <X className="h-3 w-3" />
                  </Button>
                </Badge>
              );
            })}
          </div>
        </div>
      )}

      {/* Compliance Guidelines Display */}
      {complianceGuidelines.length > 0 && (
        <div
          className="border rounded-lg p-4 bg-card"
          data-testid="compliance-guidelines-display"
        >
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <FileText className="h-4 w-4 text-primary" />
              <h3 className="font-medium text-sm">
                {complianceGuidelines.length} Compliance Guideline
                {complianceGuidelines.length > 1 ? "s" : ""} Active
              </h3>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={clearComplianceGuidelines}
              data-testid="button-clear-all-guidelines"
            >
              Clear All
            </Button>
          </div>
          <div className="flex flex-wrap gap-2">
            {complianceGuidelines.map((guideline) => (
              <Badge
                key={guideline.id}
                variant="secondary"
                className="gap-1 pr-1"
                data-testid={`badge-guideline-${guideline.name}`}
              >
                <FileText className="h-3 w-3" />
                <span>{guideline.name}</span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-4 w-4 p-0 hover:bg-transparent"
                  onClick={() => removeComplianceGuideline(guideline.id)}
                  data-testid={`button-remove-guideline-${guideline.name}`}
                >
                  <X className="h-3 w-3" />
                </Button>
              </Badge>
            ))}
          </div>
        </div>
      )}

      <StepTracker />

      {/* Generation Activity Log Panel - visible during artifact generation */}
      <GenerationActivityLogPanel />

      {currentStep === 1 && <Step1ConversationalRefinement />}
      {currentStep === 2 && <Step2GeneratedContent />}
      {currentStep === 3 && (
        integrationType === "jira" ? <Step3DevOpsPushJira /> : <Step3DevOpsPush />
      )}

      <ComplianceGuidelinesModal
        open={showGuidelinesModal}
        onClose={() => setShowGuidelinesModal(false)}
        goldenRepoFilePaths={goldenRepoRef?.filePaths}
        repositoryConfigFromProject={goldenRepoConfig ?? undefined}
        projectIdentifier={urlPlatformProjectId || urlProjectId || null}
      />

      <PersonaSelectorModal
        open={showPersonaModal}
        onClose={() => setShowPersonaModal(false)}
        selectedPersonaIds={selectedPersonaIds}
        onConfirm={(ids) => setSelectedPersonaIds(ids)}
      />
      </div>
      </div>
    </div>
  );
}

export default function Workflow() {
  return (
    <WorkflowProvider>
      <WorkflowContent />
    </WorkflowProvider>
  );
}
