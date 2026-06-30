import { useState, useEffect, useMemo, useRef } from "react";
import { useLocation, useSearch } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import {
  Cloud,
  Loader2,
  CheckCircle2,
  ExternalLink,
  Save,
  ChevronRight,
  ChevronDown,
  ArrowLeft,
  Filter,
  Search,
} from "lucide-react";
import { useWorkflow } from "@/context/workflow-context";
import toast from "react-hot-toast";
import { useJiraOnlyWorkItems } from "@/hooks/use-hosting-config";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { getApiUrl } from "@/lib/api-config";
import { useSessionIdentity } from "@/utils/msal-user";
import { UserStoryModal } from "./user-story-modal";
import { EpicModal } from "./epic-modal";
import { FeatureModal } from "./feature-modal";
import { WikiPageModal } from "./wiki-page-modal";
import type { UserStory, Epic, Feature, WikiPage } from "@shared/schema";
import { cn } from "@/lib/utils";

export function Step3DevOpsPush() {
  const jiraOnly = useJiraOnlyWorkItems();
  const identity = useSessionIdentity();
  const [, setLocation] = useLocation();
  const search = useSearch();
  const urlParams = new URLSearchParams(search);
  const urlOrganizationName = urlParams.get("organizationName");
  const urlProjectName = urlParams.get("projectName");
  const {
    azureConfig,
    setAzureConfig,
    epics,
    features,
    userStories,
    personas,
    wikiPages,
    requirement,
    guidelines,
    sessionId,
    projectId,
    projectName,
    brdId,
    selectedRequirementIds,
    selectedEpics,
    selectedFeatures,
    selectedStories,
    selectedWikiPages,
    toggleEpic,
    toggleFeature,
    toggleStory,
    toggleWikiPage,
    setSelectedEpics,
    setSelectedFeatures,
    setSelectedStories,
    setSelectedWikiPages,
    selectAll,
    selectAllUnpushed,
    deselectAll,
    pushedEpics,
    pushedFeatures,
    pushedStories,
    pushedWikiPages,
    setPushedEpics,
    setPushedFeatures,
    setPushedStories,
    setPushedWikiPages,
    isPushing,
    setIsPushing,
    isSaving,
    setIsSaving,
    savedArtifactId,
    setSavedArtifactId,
    setStep3Complete,
    setCurrentStep,
  } = useWorkflow();

  const [pushSuccess, setPushSuccess] = useState(false);
  const [filterBy, setFilterBy] = useState<"all" | "ado" | "draft">("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [devopsUrl, setDevopsUrl] = useState("");
  const [wikiUrl, setWikiUrl] = useState("");
  const [wikiPagesCount, setWikiPagesCount] = useState(0);
  const [workItemsCount, setWorkItemsCount] = useState(0);
  const [testCasesCount, setTestCasesCount] = useState(0);
  const [subtasksCount, setSubtasksCount] = useState(0);
  const [selectedStory, setSelectedStory] = useState<UserStory | null>(null);
  const [selectedEpic, setSelectedEpic] = useState<Epic | null>(null);
  const [selectedFeature, setSelectedFeature] = useState<Feature | null>(null);
  const [selectedWikiPage, setSelectedWikiPage] = useState<WikiPage | null>(
    null,
  );
  const [projectOrganization, setProjectOrganization] = useState<string | null>(
    null,
  );
  const [hasAutoSelected, setHasAutoSelected] = useState(false);
  const [selectedTestCases, setSelectedTestCases] = useState<Set<string>>(
    new Set(),
  );
  const [selectedSubtasks, setSelectedSubtasks] = useState<Set<string>>(
    new Set(),
  );
  const [integrationType, setIntegrationType] = useState<"ado" | "jira">(jiraOnly ? "jira" : "ado");

  // Flatten all test cases and subtasks from all user stories (must be defined before useEffects)
  // Memoize to prevent infinite loops in useEffect
  const allTestCases = useMemo(() => {
    return userStories.flatMap((story) => {
      const storyAny = story as any;
      if (storyAny.testCases && Array.isArray(storyAny.testCases)) {
        return storyAny.testCases.map((tc: any, idx: number) => ({
          id: `${story.id}-tc-${idx}`,
          storyId: story.id,
          storyTitle: story.title,
          title: tc.title || tc.scenario || "Test Case",
          steps: tc.steps || [],
        }));
      }
      return [];
    });
  }, [userStories]);

  const allSubtasks = useMemo(() => {
    return userStories.flatMap((story) => {
      const storyAny = story as any;
      if (storyAny.subtasks && Array.isArray(storyAny.subtasks)) {
        // Handle both string and object formats
        return storyAny.subtasks.map((subtask: any, idx: number) => {
          const subtaskTitle =
            typeof subtask === "string"
              ? subtask
              : subtask.title || subtask.description || `Subtask ${idx + 1}`;
          return {
            id: `${story.id}-subtask-${idx}`,
            storyId: story.id,
            storyTitle: story.title,
            title: subtaskTitle,
          };
        });
      }
      return [];
    });
  }, [userStories]);

  const q = searchQuery.trim().toLowerCase();
  const matchesSearch = useMemo(() => {
    return {
      epic: (e: Epic) =>
        !q ||
        e.title?.toLowerCase().includes(q) ||
        e.description?.toLowerCase().includes(q),
      feature: (f: Feature) =>
        !q ||
        f.title?.toLowerCase().includes(q) ||
        f.description?.toLowerCase().includes(q),
      story: (s: UserStory) =>
        !q ||
        s.title?.toLowerCase().includes(q) ||
        s.description?.toLowerCase().includes(q) ||
        s.persona?.toLowerCase().includes(q),
      wiki: (w: WikiPage) =>
        !q ||
        w.title?.toLowerCase().includes(q) ||
        w.pageType?.toLowerCase().includes(q),
    };
  }, [q]);

  const visibleEpics = useMemo(() => {
    return epics.filter((e) => {
      const pushed = pushedEpics.has(e.id);
      if (filterBy === "ado" && !pushed) return false;
      if (filterBy === "draft" && pushed) return false;
      return matchesSearch.epic(e);
    });
  }, [epics, filterBy, pushedEpics, matchesSearch]);
  const visibleFeatures = useMemo(() => {
    return features.filter((f) => {
      const pushed = pushedFeatures.has(f.id);
      if (filterBy === "ado" && !pushed) return false;
      if (filterBy === "draft" && pushed) return false;
      return matchesSearch.feature(f);
    });
  }, [features, filterBy, pushedFeatures, matchesSearch]);
  const visibleUserStories = useMemo(() => {
    return userStories.filter((s) => {
      const pushed = pushedStories.has(s.id);
      if (filterBy === "ado" && !pushed) return false;
      if (filterBy === "draft" && pushed) return false;
      return matchesSearch.story(s);
    });
  }, [userStories, filterBy, pushedStories, matchesSearch]);
  const visibleWikiPages = useMemo(() => {
    return wikiPages.filter((w) => {
      const pushed = pushedWikiPages.has(w.id);
      if (filterBy === "ado" && !pushed) return false;
      if (filterBy === "draft" && pushed) return false;
      return matchesSearch.wiki(w);
    });
  }, [wikiPages, filterBy, pushedWikiPages, matchesSearch]);

  const visibleEpicIds = useMemo(
    () => new Set(visibleEpics.map((e) => e.id)),
    [visibleEpics],
  );
  const visibleFeatureIds = useMemo(
    () => new Set(visibleFeatures.map((f) => f.id)),
    [visibleFeatures],
  );
  const visibleStoryIds = useMemo(
    () => new Set(visibleUserStories.map((s) => s.id)),
    [visibleUserStories],
  );

  const hierarchyEpics = useMemo(() => {
    return epics.filter((epic) => {
      if (visibleEpicIds.has(epic.id)) return true;
      const hasVisibleFeature = features.some(
        (f) => f.epicId === epic.id && visibleFeatureIds.has(f.id),
      );
      if (hasVisibleFeature) return true;
      const hasVisibleStory = userStories.some(
        (s) => s.epicId === epic.id && visibleStoryIds.has(s.id),
      );
      return hasVisibleStory;
    });
  }, [
    epics,
    features,
    userStories,
    visibleEpicIds,
    visibleFeatureIds,
    visibleStoryIds,
  ]);

  const getFeaturesForEpic = (epicId: string) =>
    features.filter((f) => f.epicId === epicId);
  const getStoriesForFeature = (featureId: string) =>
    userStories.filter((s) => s.featureId === featureId);

  const featureVisibleInHierarchy = (f: Feature) =>
    visibleFeatureIds.has(f.id) ||
    userStories.some((s) => s.featureId === f.id && visibleStoryIds.has(s.id));

  type HierarchyNode =
    | {
        kind: "epic";
        id: string;
        title: string;
        subtitle: string;
        artifact: Epic;
        isPushed: boolean;
        children: HierarchyNode[];
      }
    | {
        kind: "feature";
        id: string;
        title: string;
        subtitle: string;
        artifact: Feature;
        isPushed: boolean;
        children: HierarchyNode[];
      }
    | {
        kind: "story";
        id: string;
        title: string;
        subtitle: string;
        artifact: UserStory;
        isPushed: boolean;
        children: HierarchyNode[];
      }
    | {
        kind: "subtask";
        id: string;
        title: string;
        subtitle: string;
        isPushed: boolean;
        children: HierarchyNode[];
      };

  const hierarchyTree = useMemo((): HierarchyNode[] => {
    const nodes: HierarchyNode[] = [];
    for (const epic of hierarchyEpics) {
      const epicPushed = pushedEpics.has(epic.id);
      const featureNodes: HierarchyNode[] = [];
      for (const feature of getFeaturesForEpic(epic.id).filter(
        featureVisibleInHierarchy,
      )) {
        const featurePushed = pushedFeatures.has(feature.id);
        const storyNodes: HierarchyNode[] = [];
        for (const story of getStoriesForFeature(feature.id).filter((s) =>
          visibleStoryIds.has(s.id),
        )) {
          const storyPushed = pushedStories.has(story.id);
          const storyAny = story as { subtasks?: unknown[] };
          const subtasksList = Array.isArray(storyAny.subtasks)
            ? storyAny.subtasks
            : [];
          const subtaskNodes: HierarchyNode[] = subtasksList.map(
            (sub: unknown, idx: number) => {
              const isObj = typeof sub === "object" && sub !== null;
              const subAny = sub as { title?: string; description?: string };
              const title =
                typeof sub === "string"
                  ? sub
                  : ((subAny?.title || subAny?.description) ??
                    `Subtask ${idx + 1}`);
              const description = isObj ? (subAny?.description ?? "") : "";
              const subtitle =
                description && description !== title ? description : "";
              return {
                kind: "subtask" as const,
                id: `${story.id}-st-${idx}`,
                title,
                subtitle,
                isPushed: storyPushed,
                children: [],
              };
            },
          );
          storyNodes.push({
            kind: "story",
            id: story.id,
            title: story.title,
            subtitle: story.persona ?? "",
            artifact: story,
            isPushed: storyPushed,
            children: subtaskNodes,
          });
        }
        featureNodes.push({
          kind: "feature",
          id: feature.id,
          title: feature.title,
          subtitle: feature.description ?? "",
          artifact: feature,
          isPushed: featurePushed,
          children: storyNodes,
        });
      }
      nodes.push({
        kind: "epic",
        id: epic.id,
        title: epic.title,
        subtitle: epic.description ?? "",
        artifact: epic,
        isPushed: epicPushed,
        children: featureNodes,
      });
    }
    return nodes;
  }, [
    hierarchyEpics,
    getFeaturesForEpic,
    getStoriesForFeature,
    featureVisibleInHierarchy,
    visibleStoryIds,
    pushedEpics,
    pushedFeatures,
    pushedStories,
  ]);

  const toggleExpand = (itemId: string) => {
    setExpandedItems((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
  };

  // Auto-select only unpushed items when component mounts or when artifacts change (so resumed completed session doesn't select already-pushed)
  useEffect(() => {
    if (epics.length > 0 && !hasAutoSelected && selectedEpics.size === 0) {
      selectAllUnpushed();
      // Sync test cases and subtasks to selected stories only (unpushed stories)
      const unpushedStoryIds = new Set(
        userStories.filter((s) => !pushedStories.has(s.id)).map((s) => s.id),
      );
      setSelectedTestCases(
        new Set(
          allTestCases
            .filter((tc) => unpushedStoryIds.has(tc.storyId))
            .map((tc) => tc.id),
        ),
      );
      setSelectedSubtasks(
        new Set(
          allSubtasks
            .filter((st) => unpushedStoryIds.has(st.storyId))
            .map((st) => st.id),
        ),
      );
      setHasAutoSelected(true);
    }
  }, [
    epics.length,
    features.length,
    userStories.length,
    hasAutoSelected,
    selectedEpics.size,
    selectAllUnpushed,
    allTestCases,
    allSubtasks,
    pushedStories,
  ]);

  // Track previous selectedStories to prevent unnecessary updates
  const prevSelectedStoriesRef = useRef<string>(
    JSON.stringify(Array.from(selectedStories).sort()),
  );
  const prevAllTestCasesRef = useRef<string>(
    JSON.stringify(allTestCases.map((tc) => tc.id).sort()),
  );
  const prevAllSubtasksRef = useRef<string>(
    JSON.stringify(allSubtasks.map((st) => st.id).sort()),
  );

  // Auto-select/deselect test cases and subtasks when their parent stories are selected/deselected
  useEffect(() => {
    const currentSelectedStories = JSON.stringify(
      Array.from(selectedStories).sort(),
    );
    const currentAllTestCases = JSON.stringify(
      allTestCases.map((tc) => tc.id).sort(),
    );
    const currentAllSubtasks = JSON.stringify(
      allSubtasks.map((st) => st.id).sort(),
    );

    // Only update if something actually changed
    if (
      currentSelectedStories === prevSelectedStoriesRef.current &&
      currentAllTestCases === prevAllTestCasesRef.current &&
      currentAllSubtasks === prevAllSubtasksRef.current
    ) {
      return; // No changes, skip update
    }

    // Update refs
    prevSelectedStoriesRef.current = currentSelectedStories;
    prevAllTestCasesRef.current = currentAllTestCases;
    prevAllSubtasksRef.current = currentAllSubtasks;

    const newSelectedTestCases = new Set<string>();
    const newSelectedSubtasks = new Set<string>();

    selectedStories.forEach((storyId) => {
      allTestCases.forEach((tc) => {
        if (tc.storyId === storyId) {
          newSelectedTestCases.add(tc.id);
        }
      });
      allSubtasks.forEach((st) => {
        if (st.storyId === storyId) {
          newSelectedSubtasks.add(st.id);
        }
      });
    });

    setSelectedTestCases(newSelectedTestCases);
    setSelectedSubtasks(newSelectedSubtasks);
  }, [selectedStories, allTestCases, allSubtasks]);

  // Warn user before leaving/refreshing page - they will lose all generated data
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      // Only warn if there are generated artifacts that haven't been pushed/saved
      if (
        (epics.length > 0 || features.length > 0 || userStories.length > 0) &&
        !pushSuccess &&
        !saveSuccess
      ) {
        e.preventDefault();
        e.returnValue =
          "⚠️ WARNING: You have unsaved generated artifacts (Epics, Features, User Stories). Refreshing or leaving this page will cause you to LOSE ALL GENERATED DATA. Are you sure you want to continue?";
        return e.returnValue;
      }
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, [
    epics.length,
    features.length,
    userStories.length,
    pushSuccess,
    saveSuccess,
  ]);

  // Calculate total selected items
  const totalSelected =
    selectedEpics.size +
    selectedFeatures.size +
    selectedStories.size +
    selectedWikiPages.size +
    selectedTestCases.size +
    selectedSubtasks.size;

  // Count only selected items that are NOT already pushed (so button enables when user selects unpushed items again)
  const totalUnpushedSelected =
    Array.from(selectedEpics).filter((id) => !pushedEpics.has(id)).length +
    Array.from(selectedFeatures).filter((id) => !pushedFeatures.has(id))
      .length +
    Array.from(selectedStories).filter((id) => !pushedStories.has(id)).length +
    Array.from(selectedWikiPages).filter((id) => !pushedWikiPages.has(id))
      .length;

  // Fetch ADO config and project details internally on component load
  useEffect(() => {
    if (projectId) {
      const fetchAdoConfig = async () => {
        try {
          const response = await fetch(
            getApiUrl(`/api/sdlc/projects/${projectId}/ado-config`),
            {
              credentials: "include",
            },
          );
          if (response.ok) {
            const config = await response.json();
            if (config.hasConfig && (config.organization || config.project)) {
              // Set config internally without showing to user
              setAzureConfig({
                ...azureConfig,
                organization: config.organization || azureConfig.organization,
                project: config.project || azureConfig.project,
                repository: azureConfig.repository || "main",
                branch: azureConfig.branch || "main",
                // PAT will be fetched on backend when pushing
              });
              // Store organization for redirect
              if (config.organization) {
                setProjectOrganization(config.organization);
              }
            }
          }
        } catch (error) {
          console.log("Could not fetch ADO config (non-critical):", error);
        }
      };

      // Also fetch project details to get organization and integrationType
      const fetchProjectDetails = async () => {
        try {
          const response = await fetch(
            getApiUrl(`/api/sdlc/projects/${projectId}/details`),
            {
              credentials: "include",
            },
          );
          if (response.ok) {
            const projectData = await response.json();
            if (projectData?.project?.organization) {
              setProjectOrganization(projectData.project.organization);
            }
            if (!jiraOnly && projectData?.project?.integrationType) {
              setIntegrationType(projectData.project.integrationType);
            }
          }
        } catch (error) {
          console.log("Could not fetch project details (non-critical):", error);
        }
      };

      fetchAdoConfig();
      fetchProjectDetails();
    }
  }, [projectId]); // Only run once when projectId is available

  const handleSave = async () => {
    if (epics.length === 0) {
      toast.error("No artifacts to save. Please generate artifacts first.");
      return;
    }

    setIsSaving(true);
    setSaveSuccess(false);

    try {
      // Extract subtasks from user stories
      const subtasks = userStories.flatMap((story) =>
        (story.subtasks || []).map((subtaskTitle, index) => ({
          userStoryId: story.id,
          title: subtaskTitle,
          description: `Subtask for ${story.title}`,
          estimatedHours: 4,
          status: "pending",
        })),
      );

      console.log("[Step3] Saving artifacts with:", {
        sessionId,
        projectId,
        epicsCount: epics?.length || 0,
        featuresCount: features?.length || 0,
        userStoriesCount: userStories?.length || 0,
        wikiPagesCount: wikiPages?.length || 0,
      });

      // Build request payload - always include brdId and selectedRequirementIds
      const requestPayload: any = {
        sessionId,
        projectId,
        brdId: brdId && brdId.trim() !== "" ? brdId : null, // Always include brdId, set to null if not available
        selectedRequirementIds:
          Array.isArray(selectedRequirementIds) &&
          selectedRequirementIds.length > 0
            ? selectedRequirementIds
            : undefined, // Backend expects selectedRequirementIds
        requirement,
        guidelines,
        epics,
        features,
        userStories,
        personas,
        wikiPages,
        figmaGuidelines: guidelines, // Using guidelines as figma guidelines for now
        subtasks,
      };
      if (identity) {
        requestPayload.aadObjectId = identity.aadObjectId;
        requestPayload.userName = identity.userName;
        requestPayload.userEmail = identity.userEmail;
      }

      console.log("[Step3] Save artifacts request payload:", requestPayload);
      console.log("[Step3] brdId value:", requestPayload.brdId);
      console.log(
        "[Step3] selectedRequirementIds being sent:",
        requestPayload.selectedRequirementIds,
      );
      console.log(
        "[Step3] selectedRequirementIds type:",
        typeof requestPayload.selectedRequirementIds,
      );
      console.log(
        "[Step3] selectedRequirementIds is array:",
        Array.isArray(requestPayload.selectedRequirementIds),
      );
      console.log(
        "[Step3] selectedRequirementIds length:",
        requestPayload.selectedRequirementIds?.length || 0,
      );
      const res = await apiRequest(
        "POST",
        "/api/workflow/save-artifacts",
        requestPayload,
      );

      const responseData = await res.json();
      if (responseData.success) {
        setSaveSuccess(true);
        setSavedArtifactId(responseData.artifact.id);
        toast.success("Artifacts saved successfully! Redirecting to SDLC...", {
          duration: 2000,
        });

        // Refresh sessions list so status shows COMPLETED
        if (projectId) {
          queryClient.invalidateQueries({
            queryKey: ["workflow-sessions", projectId],
          });
          queryClient.invalidateQueries({
            queryKey: ["workflow-sessions-total-cost"],
          });
        }

        // Use URL params (organizationName and projectName) - these are the selected values from UI
        // Don't fetch project details as it might return golden repo context
        const finalProjectName = urlProjectName || projectName;
        const finalOrganization = urlOrganizationName || projectOrganization;

        // Redirect to SDLC page after 2 seconds with project information
        setTimeout(() => {
          // Build URL with projectId, projectName, and organization to persist selection in SDLC page
          const params = new URLSearchParams();
          if (projectId) {
            params.set("projectId", projectId);
          }
          // Use projectName from URL params (selected in UI), context, or fallback
          const nameToUse = finalProjectName || projectId;
          if (nameToUse) {
            params.set("projectName", nameToUse);
          }
          // Add organization from URL params (selected in UI) or state
          const orgToUse = finalOrganization;
          if (orgToUse) {
            params.set("organization", orgToUse);
          }
          // Indicate that this navigation originated from Workflow so SDLC
          // can intentionally show its loader and refresh data.
          params.set("fromWorkflow", "1");
          setLocation(`/sdlc?${params.toString()}`);
        }, 2000);
      }
    } catch (error) {
      console.error("Save artifacts error:", error);
      toast.error("Failed to save artifacts. Please try again.");
    } finally {
      setIsSaving(false);
    }
  };

  const handlePush = async () => {
    if (totalUnpushedSelected === 0) {
      toast.error("Please select at least one item to push");
      return;
    }

    if (!projectId) {
      toast.error("Project ID is required");
      return;
    }

    setIsPushing(true);
    setPushSuccess(false);

    try {
      // When a user story is selected, automatically include its parent feature and epic
      // When a feature is selected, automatically include its parent epic
      // This ensures hierarchical integrity in Azure DevOps
      const epicsToCreate = new Set(selectedEpics);
      const featuresToCreate = new Set(selectedFeatures);
      const storiesToCreate = new Set(selectedStories);

      // For each selected story, ensure its parent feature and epic are included
      for (const storyId of storiesToCreate) {
        const story = userStories.find((s) => s.id === storyId);
        if (story && story.featureId) {
          featuresToCreate.add(story.featureId);
          // Also add the feature's parent epic
          const feature = features.find((f) => f.id === story.featureId);
          if (feature && feature.epicId) {
            epicsToCreate.add(feature.epicId);
          }
        }
      }

      // For each selected feature, ensure its parent epic is included
      for (const featureId of featuresToCreate) {
        const feature = features.find((f) => f.id === featureId);
        if (feature && feature.epicId) {
          epicsToCreate.add(feature.epicId);
        }
      }

      // Build selected items array with auto-included parents
      const selectedItems = [
        ...Array.from(epicsToCreate).map((id) => ({ type: "epic", id })),
        ...Array.from(featuresToCreate).map((id) => ({ type: "feature", id })),
        ...Array.from(storiesToCreate).map((id) => ({ type: "story", id })),
        ...Array.from(selectedWikiPages).map((id) => ({ type: "wiki", id })),
      ];

      // Extract subtasks from user stories for saving
      const subtasks = userStories.flatMap((story) =>
        (story.subtasks || []).map((subtaskTitle, index) => ({
          userStoryId: story.id,
          title: subtaskTitle,
          description: `Subtask for ${story.title}`,
          estimatedHours: 4,
          status: "pending",
        })),
      );

      // Start push to Azure DevOps (now uses polling for long-running operations)
      // Payload enhancement: include artifactId so server can resolve BRD/requirements from DB; include brdId/requirementIds for fallback
      const pushPayload: any = {
        projectId, // Send projectId instead of full config
        sessionId, // So backend can mark session COMPLETED when push succeeds
        selectedItems,
        epics,
        features,
        userStories,
        personas,
        wikiPages,
      };
      if (identity) {
        pushPayload.aadObjectId = identity.aadObjectId;
        pushPayload.userName = identity.userName;
        pushPayload.userEmail = identity.userEmail;
      }
 // Pass through organization and project name from URL params if available,
      // so the backend can use the exact ADO org/project selected in the UI.
      const finalOrganizationForPush =
        urlOrganizationName || projectOrganization;
      const finalProjectNameForPush = urlProjectName || projectName;

      if (finalOrganizationForPush) {
        pushPayload.organizationName = finalOrganizationForPush;
      }
      if (finalProjectNameForPush) {
        pushPayload.projectName = finalProjectNameForPush;
      }
      // artifactId (workflow artifact id) lets the server look up brdId/requirementIds from dev_brd_requirements
      if (savedArtifactId) {
        pushPayload.artifactId = savedArtifactId;
      }

      // BRD ID and requirement IDs: server uses these when DB lookup by artifactId returns nothing
      if (brdId) {
        pushPayload.brdId = brdId;
      } else {
        pushPayload.brdId = null;
      }
      pushPayload.requirementIds = Array.isArray(selectedRequirementIds)
        ? selectedRequirementIds
        : [];

      // Append organization / project as query params so backend overrides
      // use the exact ADO org/project selected in the UI.
      const queryParams = new URLSearchParams();
      if (finalOrganizationForPush) {
        queryParams.set("organization", finalOrganizationForPush);
      }
      if (finalProjectNameForPush) {
        queryParams.set("project", finalProjectNameForPush);
      }

      const pushRes = await apiRequest(
        "POST",
        `/api/workflow/push-devops${
          queryParams.toString() ? `?${queryParams.toString()}` : ""
        }`,
        pushPayload,
      );

      if (!pushRes.ok) {
        const errorData = await pushRes.json().catch(() => ({}));
        throw new Error(
          errorData.error || "Failed to start push to Azure DevOps",
        );
      }

      const jobResponse = await pushRes.json();
      const jobId = jobResponse.jobId;

      if (!jobId) {
        throw new Error("Failed to start push-devops job");
      }

      // Poll for job status
      const pollInterval = 3000; // Poll every 3 seconds
      const maxPollAttempts = 400; // Max 20 minutes (400 * 3 seconds)
      let pollAttempts = 0;

      const pollJobStatus = async (): Promise<any> => {
        while (pollAttempts < maxPollAttempts) {
          try {
            pollAttempts++;

            const statusRes = await apiRequest(
              "GET",
              `/api/workflow/push-devops/status/${jobId}`,
            );

            // Check for error status codes (failed jobs return 500, not found returns 404)
            if (!statusRes.ok) {
              const errorData = await statusRes.json().catch(() => ({}));
              const errorMessage =
                errorData.error ||
                `Failed to fetch job status (${statusRes.status})`;

              // If status is 500, it means the job failed - stop polling immediately
              if (statusRes.status === 500) {
                console.error(
                  `[Push DevOps] Job ${jobId} failed with status 500:`,
                  errorMessage,
                );
                toast.error(errorMessage, { duration: 10000 });
                throw new Error(errorMessage);
              }

              // If status is 404, job not found - stop polling
              if (statusRes.status === 404) {
                console.error(`[Push DevOps] Job ${jobId} not found (404)`);
                throw new Error("Job not found. It may have expired.");
              }

              // For other errors, throw to be handled by catch block
              throw new Error(errorMessage);
            }

            const statusData = await statusRes.json();

            // Update progress if available (could be used for UI progress indicator)
            if (statusData.step) {
              console.log(
                `[Push DevOps] Job ${jobId}: ${statusData.step} (${statusData.progress}%)`,
              );
            }

            // Check for completed status first
            if (statusData.status === "completed") {
              return statusData.result;
            } else if (statusData.status === "failed") {
              // Stop polling immediately when failed
              const errorMessage =
                statusData.error || `Push to ${integrationType === "jira" ? "Jira" : "Azure DevOps"} failed`;
              console.error(`[Push DevOps] Job ${jobId} failed:`, errorMessage);
              toast.error(errorMessage, { duration: 10000 });
              throw new Error(errorMessage);
            }

            // If still processing, wait before next poll
            await new Promise((resolve) => setTimeout(resolve, pollInterval));
          } catch (error) {
            // Stop polling immediately on ANY error - don't continue the loop
            const errorMessage =
              error instanceof Error ? error.message : "Unknown error occurred";
            console.error(
              `[Push DevOps] Error polling job status for ${jobId}:`,
              errorMessage,
            );

            // Show error to user
            if (!errorMessage.includes("Job not found")) {
              toast.error(`Push error: ${errorMessage}`, {
                duration: 10000,
              });
            }

            // Stop polling by throwing error (breaks the while loop)
            throw error;
          }
        }

        throw new Error(`Push to ${integrationType === "jira" ? "Jira" : "Azure DevOps"} timed out. Please try again.`);
      };

      // Poll for push result
      const responseData = await pollJobStatus();

      // Handle push result
      if (responseData.success) {
        setPushSuccess(true);
        setDevopsUrl(responseData.url);
        setWikiUrl(responseData.wikiUrl || "");
        setWikiPagesCount(responseData.wikiPagesCreated || 0);
        setWorkItemsCount(responseData.workItemIds?.length || 0);
        setTestCasesCount(responseData.testCasesCreated || 0);
        setSubtasksCount(responseData.subtasksCreated || 0);
        setStep3Complete(true);

        // Mark pushed items in context and persist to session (step3Data) so resume shows ADO tag and disabled checkboxes
        setPushedEpics(new Set([...pushedEpics, ...epicsToCreate]));
        setPushedFeatures(new Set([...pushedFeatures, ...featuresToCreate]));
        setPushedStories(new Set([...pushedStories, ...storiesToCreate]));
        setPushedWikiPages(new Set([...pushedWikiPages, ...selectedWikiPages]));

        const pushedItems = {
          epics: Array.from(epicsToCreate).map((id) => ({ id })),
          features: Array.from(featuresToCreate).map((id) => ({ id })),
          userStories: Array.from(storiesToCreate).map((id) => ({ id })),
          wikiPages: Array.from(selectedWikiPages).map((id) => ({ id })),
        };
        apiRequest("POST", `/api/sessions/${sessionId}/workflow-steps/3`, {
          stepName: "devops_push",
          step3Data: { pushedItems, pushStatus: "completed" },
        }).catch((err) =>
          console.warn("[Step3] Failed to persist pushed state:", err),
        );

        // Refresh sessions list so status shows COMPLETED
        if (projectId) {
          queryClient.invalidateQueries({
            queryKey: ["workflow-sessions", projectId],
          });
          queryClient.invalidateQueries({
            queryKey: ["workflow-sessions-total-cost"],
          });
        }

        // Invalidate all relevant queries to refresh SDLC screens immediately
        if (projectId) {
          queryClient.invalidateQueries({
            queryKey: ["/api/workflow/artifacts", projectId],
          });
          queryClient.invalidateQueries({
            queryKey: ["/api/workflow/artifacts"],
          });
          // Invalidate SDLC phase queries for all phases
          for (let phase = 1; phase <= 10; phase++) {
            queryClient.invalidateQueries({
              queryKey: [
                `/api/sdlc/projects/${projectId}/phases/${phase}/backlog`,
              ],
            });
            queryClient.invalidateQueries({
              queryKey: [
                `/api/sdlc/projects/${projectId}/phases/${phase}/epics`,
              ],
            });
            queryClient.invalidateQueries({
              queryKey: [
                `/api/sdlc/projects/${projectId}/phases/${phase}/features`,
              ],
            });
          }
          queryClient.invalidateQueries({
            queryKey: [`/api/sdlc/projects/${projectId}/details`],
          });
        }
        // Invalidate work items queries if project name is available
        if (projectName) {
          queryClient.invalidateQueries({
            queryKey: [`/api/hub/artifacts/${projectName}/work-items`],
          });
        }

        const successMsg = [];
        if (responseData.workItemIds?.length > 0) {
          successMsg.push(`${responseData.workItemIds.length} work items`);
        }
        if (responseData.testCasesCreated > 0) {
          successMsg.push(`${responseData.testCasesCreated} test cases`);
        }
        if (responseData.subtasksCreated > 0) {
          successMsg.push(`${responseData.subtasksCreated} subtasks`);
        }
        if (responseData.wikiPagesCreated > 0) {
          successMsg.push(`${responseData.wikiPagesCreated} ${jiraOnly ? "Confluence" : "wiki"} pages`);
        }

        toast.success(
          `Successfully pushed ${successMsg.join(", ")} to Azure DevOps!`,
          { duration: 5000 },
        );
      } else {
        throw new Error(responseData.error || "Failed to push to Azure DevOps");
      }

      // Save to database (don't block on it, run asynchronously)
      console.log("[Step3] brdId from workflow context:", brdId);
      console.log("[Step3] brdId type:", typeof brdId);
      console.log("[Step3] brdId value to be sent:", brdId || null);

      const asyncSavePayload: Record<string, unknown> = {
        sessionId,
        projectId,
        brdId: brdId || null,
        requirement,
        guidelines,
        epics,
        features,
        userStories,
        personas,
        wikiPages,
        figmaGuidelines: guidelines,
        subtasks,
        selectedRequirementIds:
          Array.isArray(selectedRequirementIds) &&
          selectedRequirementIds.length > 0
            ? selectedRequirementIds
            : undefined, // Backend expects selectedRequirementIds
      };
      if (identity) {
        asyncSavePayload.aadObjectId = identity.aadObjectId;
        asyncSavePayload.userName = identity.userName;
        asyncSavePayload.userEmail = identity.userEmail;
      }

      console.log("[Step3] Async save artifacts payload:", asyncSavePayload);
      console.log("[Step3] Async brdId in payload:", asyncSavePayload.brdId);
      console.log(
        "[Step3] Async selectedRequirementIds:",
        asyncSavePayload.selectedRequirementIds,
      );
      console.log(
        "[Step3] Async save - selectedRequirementIds being sent:",
        asyncSavePayload.selectedRequirementIds,
      );
      console.log(
        "[Step3] Async save - selectedRequirementIds length:",
        Array.isArray(asyncSavePayload.selectedRequirementIds)
          ? asyncSavePayload.selectedRequirementIds.length
          : 0,
      );

      Promise.allSettled([
        apiRequest("POST", "/api/workflow/save-artifacts", asyncSavePayload),
      ]).then((saveResults) => {
        // Handle save result (don't fail if save fails, just log it)
        if (saveResults[0].status === "fulfilled") {
          saveResults[0].value
            .json()
            .then((saveData: any) => {
              if (saveData.success) {
                setSavedArtifactId(saveData.artifact.id);
                console.log("[Step3] Artifacts saved to database during push");
              }
            })
            .catch((error) => {
              console.error("[Step3] Error parsing save response:", error);
            });
        } else {
          console.error(
            "[Step3] Failed to save artifacts during push:",
            saveResults[0].reason,
          );
          // Don't show error to user - save is secondary operation
        }
      });
    } catch (error) {
      console.error("DevOps push error:", error);
      toast.error(
        "Failed to push to Azure DevOps. Please check your configuration.",
      );
    } finally {
      setIsPushing(false);
    }
  };

  const hasFilterOrSearch = filterBy !== "all" || searchQuery.trim() !== "";
  const selectVisibleUnpushed = () => {
    const unpushedEpicIds = visibleEpics
      .filter((e) => !pushedEpics.has(e.id))
      .map((e) => e.id);
    const unpushedFeatureIds = visibleFeatures
      .filter((f) => !pushedFeatures.has(f.id))
      .map((f) => f.id);
    const unpushedStoryIds = visibleUserStories
      .filter((s) => !pushedStories.has(s.id))
      .map((s) => s.id);
    const unpushedWikiIds = visibleWikiPages
      .filter((w) => !pushedWikiPages.has(w.id))
      .map((w) => w.id);
    setSelectedEpics(new Set(unpushedEpicIds));
    setSelectedFeatures(new Set(unpushedFeatureIds));
    setSelectedStories(new Set(unpushedStoryIds));
    setSelectedWikiPages(new Set(unpushedWikiIds));
    const storyIdSet = new Set(unpushedStoryIds);
    setSelectedTestCases(
      new Set(
        allTestCases
          .filter((tc) => storyIdSet.has(tc.storyId))
          .map((tc) => tc.id),
      ),
    );
    setSelectedSubtasks(
      new Set(
        allSubtasks
          .filter((st) => storyIdSet.has(st.storyId))
          .map((st) => st.id),
      ),
    );
  };

  return (
    <div className="w-full space-y-6">
      {/* Back to Step 2 */}
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setCurrentStep(2)}
          className="text-muted-foreground hover:text-foreground"
          data-testid="button-back-to-step2"
        >
          <ArrowLeft className="h-4 w-4 mr-1" />
          Back to Step 2
        </Button>
      </div>
      {/* Selection Interface */}
      <Card>
        <CardHeader>
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <CardTitle>Select Items to Push</CardTitle>
              <div className="flex flex-wrap items-center gap-2 justify-end">
                <div className="relative">
                  <Button
                    variant={filterBy !== "all" ? "secondary" : "outline"}
                    size="sm"
                    onClick={() => setFilterOpen((o) => !o)}
                    className="gap-1"
                    data-testid="button-filter"
                  >
                    <Filter className="h-4 w-4" />
                    Filter {filterBy !== "all" ? `(${filterBy})` : ""}
                  </Button>
                  {filterOpen && (
                    <div className="absolute top-full right-0 mt-1 z-10 bg-background border rounded-md shadow-lg py-1 min-w-[120px]">
                      <button
                        type="button"
                        className="w-full px-3 py-1.5 text-left text-sm hover:bg-muted"
                        onClick={() => {
                          setFilterBy("all");
                          setFilterOpen(false);
                        }}
                      >
                        All
                      </button>
                      <button
                        type="button"
                        className="w-full px-3 py-1.5 text-left text-sm hover:bg-muted"
                        onClick={() => {
                          setFilterBy("ado");
                          setFilterOpen(false);
                        }}
                      >
                        ADO (pushed)
                      </button>
                      <button
                        type="button"
                        className="w-full px-3 py-1.5 text-left text-sm hover:bg-muted"
                        onClick={() => {
                          setFilterBy("draft");
                          setFilterOpen(false);
                        }}
                      >
                        Draft
                      </button>
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-1">
                  {searchOpen ? (
                    <>
                      <input
                        type="text"
                        placeholder="Search by title, description..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="h-9 px-3 rounded-md border bg-background text-sm w-48 focus:outline-none focus:ring-2 focus:ring-ring"
                        data-testid="input-search"
                        autoFocus
                      />
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setSearchOpen(false);
                          setSearchQuery("");
                        }}
                      >
                        Cancel
                      </Button>
                    </>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setSearchOpen(true)}
                      className="gap-1"
                      data-testid="button-search"
                    >
                      <Search className="h-4 w-4" />
                      Search
                    </Button>
                  )}
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    if (hasFilterOrSearch) {
                      selectVisibleUnpushed();
                    } else {
                      selectAllUnpushed();
                      const unpushedStoryIds = new Set(
                        userStories
                          .filter((s) => !pushedStories.has(s.id))
                          .map((s) => s.id),
                      );
                      setSelectedTestCases(
                        new Set(
                          allTestCases
                            .filter((tc) => unpushedStoryIds.has(tc.storyId))
                            .map((tc) => tc.id),
                        ),
                      );
                      setSelectedSubtasks(
                        new Set(
                          allSubtasks
                            .filter((st) => unpushedStoryIds.has(st.storyId))
                            .map((st) => st.id),
                        ),
                      );
                    }
                  }}
                  data-testid="button-select-all"
                >
                  Select All
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    deselectAll();
                    setSelectedTestCases(new Set());
                    setSelectedSubtasks(new Set());
                  }}
                  data-testid="button-deselect-all"
                >
                  Deselect All
                </Button>
              </div>
            </div>
          </div>
          <div className="flex flex-wrap gap-2 mt-4">
            <Badge variant="secondary">{selectedEpics.size} Epics</Badge>
            <Badge variant="secondary">{selectedFeatures.size} Features</Badge>
            <Badge variant="secondary">{selectedStories.size} Stories</Badge>
            <Badge variant="secondary">
              {selectedWikiPages.size} {jiraOnly ? "Confluence" : "Wiki"} Pages
            </Badge>
            <Badge variant="default">Total: {totalSelected}</Badge>
          </div>
          <div className="flex flex-wrap gap-2 mt-3 pt-3 border-t">
            <Badge
              variant="outline"
              className="bg-blue-50 dark:bg-blue-950/20 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-800"
            >
              {selectedTestCases.size} Test Cases
            </Badge>
            <Badge
              variant="outline"
              className="bg-purple-50 dark:bg-purple-950/20 text-purple-700 dark:text-purple-300 border-purple-200 dark:border-purple-800"
            >
              {selectedSubtasks.size} Subtasks
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-6 max-h-[600px] overflow-y-auto overflow-x-hidden">
          {/* Hierarchy: Epic → Feature → User Story → Subtask (same expand/collapse pattern as Hub Artifacts) */}
          <div className="space-y-2">
            <h3 className="text-sm font-semibold">
              Artifacts (Epic → Feature → User Story → Subtask)
            </h3>
            {hierarchyTree.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4">
                {epics.length === 0
                  ? "No artifacts yet."
                  : "No artifacts match the current filter or search."}
              </p>
            ) : (
              <div className="space-y-2">
                {hierarchyTree.map((root) => {
                  function renderArtifactTree(
                    node: HierarchyNode,
                    level: number,
                  ) {
                    const hasChildren = node.children.length > 0;
                    const isExpanded = expandedItems.has(node.id);
                    const typeLabel =
                      node.kind === "epic"
                        ? "Epic"
                        : node.kind === "feature"
                          ? "Feature"
                          : node.kind === "story"
                            ? "User Story"
                            : "Subtask";
                    const typeInitial =
                      node.kind === "epic"
                        ? "E"
                        : node.kind === "feature"
                          ? "F"
                          : node.kind === "story"
                            ? "S"
                            : "T";
                    const typeIconBg =
                      node.kind === "epic"
                        ? "bg-purple-500 text-white"
                        : node.kind === "feature"
                          ? "bg-blue-500 text-white"
                          : node.kind === "story"
                            ? "bg-green-500 text-white"
                            : "bg-orange-500 text-white";

                    return (
                      <div key={node.id} className="space-y-2">
                        <div
                          className={cn(
                            "flex items-center gap-2 p-3 rounded-md border hover-elevate overflow-hidden transition-all cursor-pointer min-w-0",
                            node.isPushed && "opacity-75",
                          )}
                          style={
                            level > 0
                              ? { marginLeft: `${level * 2}rem` }
                              : undefined
                          }
                          onClick={(e) => {
                            const target = e.target as HTMLElement;
                            if (
                              target.closest("button") ||
                              target.closest('[role="button"]')
                            )
                              return;
                            if (node.kind === "epic" && !node.isPushed)
                              setSelectedEpic(node.artifact);
                            if (node.kind === "feature" && !node.isPushed)
                              setSelectedFeature(node.artifact);
                            if (node.kind === "story" && !node.isPushed)
                              setSelectedStory(node.artifact);
                          }}
                        >
                          {hasChildren ? (
                            <>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 flex-shrink-0 p-0 hover:bg-accent"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  toggleExpand(node.id);
                                }}
                                title={isExpanded ? "Collapse" : "Expand"}
                              >
                                {isExpanded ? (
                                  <ChevronDown className="h-5 w-5 text-foreground" />
                                ) : (
                                  <ChevronRight className="h-5 w-5 text-foreground" />
                                )}
                              </Button>
                              <div
                                className={cn(
                                  "flex h-7 w-7 items-center justify-center rounded-full text-[10px] font-semibold shrink-0",
                                  typeIconBg,
                                )}
                              >
                                {typeInitial}
                              </div>
                            </>
                          ) : (
                            <>
                              <div
                                className="h-8 w-8 flex-shrink-0"
                                aria-hidden
                              />
                              <div
                                className={cn(
                                  "flex h-7 w-7 items-center justify-center rounded-full text-[10px] font-semibold shrink-0",
                                  typeIconBg,
                                )}
                              >
                                {typeInitial}
                              </div>
                            </>
                          )}
                          {node.kind !== "subtask" && (
                            <Checkbox
                              checked={
                                node.kind === "epic"
                                  ? selectedEpics.has(node.id)
                                  : node.kind === "feature"
                                    ? selectedFeatures.has(node.id)
                                    : selectedStories.has(node.id)
                              }
                              onCheckedChange={() => {
                                if (node.isPushed) return;
                                if (node.kind === "epic") toggleEpic(node.id);
                                else if (node.kind === "feature")
                                  toggleFeature(node.id);
                                else if (node.kind === "story")
                                  toggleStory(node.id);
                              }}
                              onClick={(e) => e.stopPropagation()}
                              disabled={node.isPushed}
                              data-testid={`checkbox-${node.kind}-${node.id}`}
                              className="mr-2"
                            />
                          )}
                          <div className="flex-1 min-w-0 overflow-hidden">
                            <div className="flex flex-wrap items-center gap-2 mb-0.5">
                              <Badge
                                variant="outline"
                                className="text-xs shrink-0"
                              >
                                {typeLabel}
                              </Badge>
                              {node.isPushed && (
                                <Badge className="bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300 border-emerald-300 text-xs shrink-0">
                                  ADO
                                </Badge>
                              )}
                              {(node.kind === "epic" ||
                                node.kind === "feature") &&
                                "priority" in node.artifact && (
                                  <Badge
                                    variant="secondary"
                                    className="text-xs shrink-0"
                                  >
                                    {String(node.artifact.priority)}
                                  </Badge>
                                )}
                              {node.kind === "story" && (
                                <Badge
                                  variant="secondary"
                                  className="text-xs shrink-0"
                                >
                                  {node.artifact.storyPoints} pts
                                </Badge>
                              )}
                            </div>
                            <p className="text-sm font-medium line-clamp-2 break-words">
                              {node.title}
                            </p>
                            {node.subtitle && (
                              <p className="text-xs text-muted-foreground line-clamp-2 break-words mt-0.5">
                                {node.subtitle}
                              </p>
                            )}
                          </div>
                        </div>
                        {hasChildren && isExpanded && (
                          <div className="space-y-2">
                            {node.children.map((child) =>
                              renderArtifactTree(child, level + 1),
                            )}
                          </div>
                        )}
                      </div>
                    );
                  }
                  return renderArtifactTree(root, 0);
                })}
              </div>
            )}
          </div>

          {/* Wiki Pages Selection */}
          {visibleWikiPages.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold">{jiraOnly ? "Confluence" : "Wiki"} Documentation</h3>
                <div className="flex items-center gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs text-primary hover:text-primary hover:bg-primary/10"
                    onClick={() => {
                      const newSelected = new Set(selectedWikiPages);
                      visibleWikiPages.forEach((p) => {
                        if (!pushedWikiPages.has(p.id)) {
                          newSelected.add(p.id);
                        }
                      });
                      setSelectedWikiPages(newSelected);
                    }}
                  >
                    Select All
                  </Button>
                  <span className="text-muted-foreground">|</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                    onClick={() => {
                      const newSelected = new Set(selectedWikiPages);
                      visibleWikiPages.forEach((p) => {
                        newSelected.delete(p.id);
                      });
                      setSelectedWikiPages(newSelected);
                    }}
                  >
                    Deselect All
                  </Button>
                </div>
              </div>
              {visibleWikiPages.map((page) => {
                const isPushed = pushedWikiPages.has(page.id);
                return (
                  <div
                    key={page.id}
                    className={`flex items-center gap-3 p-3 rounded-lg border hover-elevate cursor-pointer ${isPushed ? "opacity-75" : ""}`}
                    onClick={() => !isPushed && setSelectedWikiPage(page)}
                  >
                    <Checkbox
                      checked={selectedWikiPages.has(page.id)}
                      onCheckedChange={() =>
                        !isPushed && toggleWikiPage(page.id)
                      }
                      onClick={(e) => e.stopPropagation()}
                      disabled={isPushed}
                      data-testid={`checkbox-wiki-${page.id}`}
                    />
                    <div className="flex-1">
                      <p className="font-medium text-sm">{page.title}</p>
                      <p className="text-xs text-muted-foreground">
                        {page.pageType}
                      </p>
                    </div>
                    {isPushed && (
                      <Badge className="bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300 border-emerald-300">
                        {integrationType === "jira" ? "Jira" : "ADO"}
                      </Badge>
                    )}
                    <Badge variant="outline">{jiraOnly ? "Confluence" : "Wiki"}</Badge>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Action Buttons */}
      <div className="flex items-center gap-4">
        {/* Save for Later Button */}
        <Button
          onClick={handleSave}
          disabled={isSaving || totalSelected === 0 || saveSuccess}
          size="lg"
          variant="outline"
          className="flex-1 border-2"
          data-testid="button-save-artifacts"
        >
          {isSaving ? (
            <>
              <Loader2 className="h-5 w-5 mr-2 animate-spin" />
              Saving...
            </>
          ) : saveSuccess ? (
            <>
              <CheckCircle2 className="h-5 w-5 mr-2" />
              Saved!
            </>
          ) : (
            <>
              <Save className="h-5 w-5 mr-2" />
              Save for Later
            </>
          )}
        </Button>

        {/* Push to ADO Button - enabled when at least one selected item is not yet pushed */}
        <Button
          onClick={handlePush}
          disabled={isPushing || totalUnpushedSelected === 0}
          size="lg"
          className="flex-1 bg-gradient-to-r from-orange-600 to-orange-700 hover:from-orange-700 hover:to-orange-800"
          data-testid="button-push-devops"
        >
          {isPushing ? (
            <>
              <Loader2 className="h-5 w-5 mr-2 animate-spin" />
              Pushing to {integrationType === "jira" ? "Jira" : "ADO"}...
            </>
          ) : totalUnpushedSelected === 0 ? (
            <>
              <CheckCircle2 className="h-5 w-5 mr-2" />
              {pushSuccess ? "Successfully Pushed!" : `Push to ${integrationType === "jira" ? "Jira" : "ADO"}`}
            </>
          ) : (
            <>
              <Cloud className="h-5 w-5 mr-2" />
              Push to {integrationType === "jira" ? "Jira" : "ADO"} ({totalUnpushedSelected} items)
            </>
          )}
        </Button>
      </div>

      {/* Save Success Message */}
      {saveSuccess && savedArtifactId && (
        <Card className="w-full bg-blue-50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-800">
          <CardContent className="p-6 text-center space-y-3">
            <CheckCircle2 className="h-12 w-12 text-blue-600 mx-auto" />
            <h3 className="text-lg font-semibold">Artifacts Saved!</h3>
            <p className="text-sm text-muted-foreground">
              All generated artifacts have been saved to the database and can be
              accessed from other pages.
            </p>
            <p className="text-xs text-muted-foreground font-mono">
              Session ID: {sessionId}
            </p>
          </CardContent>
        </Card>
      )}

      {/* Push Success Message */}
      {pushSuccess && devopsUrl && (
        <Card className="w-full bg-emerald-50 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-800">
          <CardContent className="p-6 text-center space-y-3">
            <CheckCircle2 className="h-12 w-12 text-emerald-600 mx-auto" />
            <h3 className="text-lg font-semibold">Push Successful!</h3>
            <p className="text-sm text-muted-foreground">
              {(() => {
                const parts = [];
                if (workItemsCount > 0)
                  parts.push(`${workItemsCount} work items`);
                if (testCasesCount > 0)
                  parts.push(`${testCasesCount} test cases`);
                if (subtasksCount > 0) parts.push(`${subtasksCount} subtasks`);
                if (wikiPagesCount > 0)
                  parts.push(`${wikiPagesCount} ${jiraOnly ? "Confluence" : "wiki"} pages`);
                const total =
                  workItemsCount +
                  testCasesCount +
                  subtasksCount +
                  wikiPagesCount;
                return parts.length > 0
                  ? `${parts.join(
                      ", ",
                    )} (Total: ${total} items) have been created in ${integrationType === "jira" ? "Jira/Confluence" : "Azure DevOps"}`
                  : "No items were created";
              })()}
            </p>
            <div className="flex flex-col sm:flex-row gap-2 justify-center">
              {workItemsCount > 0 && (
                <Button
                  variant="outline"
                  onClick={() => window.open(devopsUrl, "_blank")}
                  data-testid="button-view-devops"
                >
                  View Work Items
                  <ExternalLink className="h-4 w-4 ml-2" />
                </Button>
              )}
              {wikiPagesCount > 0 && wikiUrl && (
                <Button
                  variant="outline"
                  onClick={() => window.open(wikiUrl, "_blank")}
                  data-testid="button-view-wiki"
                >
                  View {jiraOnly ? "Confluence" : "Wiki"} Pages
                  <ExternalLink className="h-4 w-4 ml-2" />
                </Button>
              )}
              {projectId && (
                <Button
                  onClick={() => {
                    // Use URL params (organizationName and projectName) - these are the selected values from UI
                    // Don't fetch project details as it might return golden repo context
                    const finalProjectName = urlProjectName || projectName;
                    const finalOrganization =
                      urlOrganizationName || projectOrganization;

                    // Build URL with projectId, projectName, and organization to persist selection in SDLC page
                    const params = new URLSearchParams();
                    if (projectId) params.set("projectId", projectId);
                    // Use projectName from URL params (selected in UI), context, or fallback
                    const nameToUse = finalProjectName || projectName || projectId || "";
                    if (nameToUse) {
                      params.set("projectName", nameToUse);
                    }
                    // Add organization from URL params (selected in UI) or state
                    const orgToUse = finalOrganization;
                    if (orgToUse) {
                      params.set("organization", orgToUse);
                    }
                    setLocation(`/sdlc?${params.toString()}`);
                  }}
                  className="bg-blue-600 hover:bg-blue-700 text-white"
                  data-testid="button-go-to-sdlc"
                >
                  Go to SDLC Page
                  <ChevronRight className="h-4 w-4 ml-2" />
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* User Story Detail Modal */}
      {selectedStory &&
        personas &&
        personas.find((p) => p.id === selectedStory.personaId) && (
          <UserStoryModal
            story={selectedStory!}
            persona={personas.find((p) => p.id === selectedStory.personaId)!}
            open={!!selectedStory}
            onClose={() => setSelectedStory(null)}
          />
        )}

      {/* Epic Detail Modal */}
      {selectedEpic && (
        <EpicModal
          epic={selectedEpic!}
          open={!!selectedEpic}
          onClose={() => setSelectedEpic(null)}
        />
      )}

      {/* Feature Detail Modal */}
      {selectedFeature && (
        <FeatureModal
          feature={selectedFeature!}
          open={!!selectedFeature}
          onClose={() => setSelectedFeature(null)}
        />
      )}

      {/* Wiki Page Detail Modal */}
      {selectedWikiPage && (
        <WikiPageModal
          wikiPage={selectedWikiPage!}
          open={!!selectedWikiPage}
          onClose={() => setSelectedWikiPage(null)}
          integrationType={integrationType}
        />
      )}
    </div>
  );
}
