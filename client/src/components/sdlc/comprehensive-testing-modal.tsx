import { useState, useEffect, useMemo, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  FileText,
  User,
  ArrowLeft,
  Folder,
  TestTube,
  Code,
  Loader2,
  RefreshCw,
  Eye,
  Download,
  CheckCircle,
  ChevronRight,
  ChevronDown,
  Copy,
} from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useQuery } from "@tanstack/react-query";
import toast from "react-hot-toast";
import type { Epic, Feature, UserStory } from "@shared/schema";
import { cn } from "@/lib/utils";
import { UserStorySelectionModal } from "../workflow/user-story-selection-modal";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

// WorkItem type to match phase-feature-dialog
type WorkItem = {
  id: string;
  title: string;
  type: string;
  status?: string;
  priority?: string;
  linkedItems?: WorkItem[];
  source?: "ADO" | "DB";
  dbArtifact?: any;
  dbArtifactType?: string;
  parentId?: string;
  description?: string;
  acceptanceCriteria?: string;
  persona?: string;
  storyPoints?: number;
  // Hierarchical filtering metadata
  brdId?: string;
  epicId?: string;
  featureId?: string;
};

interface ComprehensiveTestingModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedAdoProject?: {
    id: string;
    name: string;
    organization: string;
    organizationUrl: string;
    artifactOrgId?: string;
  } | null;
  apiProjectId?: string | null;
  integrationType?: string;
}

export function ComprehensiveTestingModal({
  open,
  onOpenChange,
  selectedAdoProject,
  apiProjectId,
  integrationType = "ado",
}: ComprehensiveTestingModalProps) {
  const [selectedTab, setSelectedTab] = useState("stories");
  const [showGenerateModal, setShowGenerateModal] = useState(false);
  const [preSelectedStoryId, setPreSelectedStoryId] = useState<string | null>(null);
  const [generatedStoriesMap, setGeneratedStoriesMap] = useState<Record<string, boolean>>({});
  const [loadingGeneratedStatus, setLoadingGeneratedStatus] = useState(false);
  const [generatedStoriesList, setGeneratedStoriesList] = useState<any[]>([]);
  const [loadingGeneratedList, setLoadingGeneratedList] = useState(false);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState<string>("");
  const [loadingFileContent, setLoadingFileContent] = useState(false);
  const [directoryStructure, setDirectoryStructure] = useState<any>(null);
  const [hasLoadedGeneratedOnce, setHasLoadedGeneratedOnce] = useState(false); // Track if we've loaded generated stories once
  
  // Hierarchical filtering states (null = "All")
  const [selectedBrdId, setSelectedBrdId] = useState<string | null>(null);
  const [selectedEpicId, setSelectedEpicId] = useState<string | null>(null);
  const [selectedFeatureId, setSelectedFeatureId] = useState<string | null>(null);

  // Log when modal opens to help debug
  useEffect(() => {
    if (open) {
      console.log("[ComprehensiveTestingModal] Modal opened", {
        apiProjectId,
        selectedAdoProject: selectedAdoProject ? {
          id: selectedAdoProject.id,
          name: selectedAdoProject.name,
          organization: selectedAdoProject.organization,
        } : null,
      });
    }
  }, [open, apiProjectId, selectedAdoProject]);

  // EXACT SAME IMPLEMENTATION AS UserStoriesContent in phase-feature-dialog.tsx
  const effectiveProjectName = selectedAdoProject?.name || apiProjectId;
  const artifactOrgId = selectedAdoProject?.artifactOrgId;
  const organizationUrl = selectedAdoProject?.organizationUrl;

  // 1. Fetch from Azure DevOps/JIRA work items
  const { data: workItems = [], isLoading: isLoadingWorkItems, refetch: refetchUserStories, error: workItemsError } = useQuery<WorkItem[]>({
    queryKey: [
      integrationType === "jira" 
        ? `/api/sdlc/projects/${apiProjectId}/jira/development/work-items`
        : `/api/hub/artifacts/${effectiveProjectName}/work-items`
    ],
    queryFn: async () => {
      if (integrationType === "jira") {
        if (!apiProjectId) return [];
        console.log("[ComprehensiveTestingModal] Fetching Jira work items for project:", apiProjectId);
        try {
          const response = await apiRequest(
            "GET",
            `/api/sdlc/projects/${apiProjectId}/jira/development/work-items`
          );
          const data = (await response.json()) as any[];
          console.log("[ComprehensiveTestingModal] Received Jira work items:", data.length);
          return data;
        } catch (error) {
          console.error("[ComprehensiveTestingModal] Error fetching Jira work items:", error);
          return [];
        }
      }

      if (!effectiveProjectName) {
        console.log("[ComprehensiveTestingModal] No effective project name, returning empty");
        return [];
      }
      
      console.log("[ComprehensiveTestingModal] Fetching ADO work items for:", effectiveProjectName);
      try {
        const response = await apiRequest(
          "GET",
          `/api/hub/artifacts/${effectiveProjectName}/work-items`
        );
        
        // apiRequest already validates response.ok, so we can directly call .json()
        const data = (await response.json()) as any[];
        console.log("[ComprehensiveTestingModal] Received ADO work items:", data.length);
        return data;
      } catch (error) {
        console.error("[ComprehensiveTestingModal] Error fetching ADO work items:", error);
        return [];
      }
    },
    enabled: (!!effectiveProjectName || !!apiProjectId) && open,
    retry: false,
    staleTime: 2 * 60 * 1000,
    gcTime: 5 * 60 * 1000,
    throwOnError: false,
  });

  // 2. Fetch workflow artifacts from database
  const { data: workflowArtifactsData } = useQuery<{ success: boolean; artifacts: any[] }>({
    queryKey: ["/api/workflow/artifacts", apiProjectId],
    queryFn: async () => {
      if (!apiProjectId) {
        console.log("[ComprehensiveTestingModal] No apiProjectId, skipping workflow artifacts");
        return { success: true, artifacts: [] };
      }
      
      console.log("[ComprehensiveTestingModal] Fetching workflow artifacts for:", apiProjectId);
      try {
        const response = await apiRequest(
          "GET",
          `/api/workflow/artifacts?filters=${encodeURIComponent(JSON.stringify({ projectId: apiProjectId }))}`
        );
        
        // apiRequest already validates response.ok, so we can directly call .json()
        const data = await response.json();
        return data as any;
      } catch (error) {
        console.error("[ComprehensiveTestingModal] Error fetching workflow artifacts:", error);
        return { success: false, artifacts: [] };
      }
    },
    enabled: !!apiProjectId && open,
    retry: false,
    staleTime: 2 * 60 * 1000,
    gcTime: 5 * 60 * 1000,
    throwOnError: false,
  });

  // Extract latest workflow artifact and PROPAGATE brdId to epics
  const workflowArtifactsForProject = workflowArtifactsData?.artifacts ?? [];
  const latestWorkflowArtifact = workflowArtifactsForProject?.[0] ?? null;

  // CRITICAL: Propagate brdId from artifact to each epic
  const workflowEpics: any[] = Array.isArray(latestWorkflowArtifact?.epics)
    ? (latestWorkflowArtifact.epics as any[]).map((epic: any) => ({
        ...epic,
        brdId: epic.brdId || latestWorkflowArtifact.brdId, // Use epic's brdId if exists, otherwise use artifact's brdId
        requirementId: epic.requirementId || latestWorkflowArtifact.requirementIds?.[0], // Propagate requirementId
      }))
    : [];
  
  console.log(`[ComprehensiveTestingModal] Workflow artifact brdId: ${latestWorkflowArtifact?.brdId}`);
  console.log(`[ComprehensiveTestingModal] Propagated brdId to ${workflowEpics.length} epics`);
  
  // Log all workflow epics with their brdIds for debugging
  workflowEpics.forEach((epic: any, index: number) => {
    console.log(`[ComprehensiveTestingModal] Workflow Epic ${index + 1}:`, {
      title: epic.title,
      id: epic.id,
      brdId: epic.brdId,
      adoWorkItemId: epic.adoWorkItemId,
      requirementId: epic.requirementId
    });
  });
  
  // 3. Fetch BRDs for hierarchical filtering
  const { data: brdsData = [], isLoading: isLoadingBrds } = useQuery<Array<{ id: string; title: string; status?: string; updated_at: string }>>({
    queryKey: ["/api/dev-brd/approved", apiProjectId],
    queryFn: async () => {
      if (!apiProjectId) {
        console.log("[ComprehensiveTestingModal] No apiProjectId, skipping BRDs");
        return [];
      }
      
      console.log("[ComprehensiveTestingModal] Fetching BRDs for:", apiProjectId);
      try {
        const response = await apiRequest(
          "GET",
          `/api/dev-brd/approved?projectId=${encodeURIComponent(apiProjectId)}`
        );
        
        // apiRequest already validates response.ok, so we can directly call .json()
        const data = await response.json();
        console.log("[ComprehensiveTestingModal] Received BRDs:", data.length);
        return Array.isArray(data) ? data : [];
      } catch (error) {
        console.error("[ComprehensiveTestingModal] Error fetching BRDs:", error);
        return [];
      }
    },
    enabled: !!apiProjectId && open,
    retry: false,
    staleTime: 2 * 60 * 1000,
    gcTime: 5 * 60 * 1000,
    throwOnError: false,
  });
  // CRITICAL: Features already have epicId from generation, just ensure it's there
  const workflowFeatures: any[] = Array.isArray(latestWorkflowArtifact?.features)
    ? (latestWorkflowArtifact.features as any[])
    : [];
  
  // CRITICAL: User stories already have featureId and epicId from generation
  const workflowUserStories: any[] = Array.isArray(latestWorkflowArtifact?.userStories)
    ? (latestWorkflowArtifact.userStories as any[])
    : [];
    
  console.log(`[ComprehensiveTestingModal] Workflow Features: ${workflowFeatures.length}`);
  console.log(`[ComprehensiveTestingModal] Workflow User Stories: ${workflowUserStories.length}`);

  // 3. Fetch from SDLC phase-specific endpoints as fallback
  const { data: localBacklog = [] } = useQuery<any[]>({
    queryKey: [`/api/sdlc/projects/${apiProjectId}/phases/1/backlog`],
    enabled: !!apiProjectId && open,
    retry: false,
    throwOnError: false,
  });

  const { data: dbEpics = [] } = useQuery<any[]>({
    queryKey: [`/api/sdlc/projects/${apiProjectId}/phases/1/epics`],
    enabled: !!apiProjectId && open,
    retry: false,
    throwOnError: false,
  });

  const { data: dbFeatures = [] } = useQuery<any[]>({
    queryKey: [`/api/sdlc/projects/${apiProjectId}/phases/1/features`],
    enabled: !!apiProjectId && open,
    retry: false,
    throwOnError: false,
  });

  const loadingUserStories = isLoadingWorkItems;
  // Since we handle errors in queryFn and return [], don't show error state
  const loadingError = false;

  // 4. Combine ADO/JIRA items with DB items (EXACT same logic as UserStoriesContent)
  const combinedWorkItems: WorkItem[] = useMemo(() => {
    // Transform ADO items and ENRICH with brdId/epicId/featureId from workflow artifacts
    const adoItems: WorkItem[] = workItems.map((item) => {
      const enrichedItem: WorkItem = {
        ...item,
        source: (item.source ?? "ADO") as "ADO",
      };
      
      // CRITICAL: Enrich Epics with brdId from workflow artifacts
      if (item.type === "Epic" && latestWorkflowArtifact?.epics) {
        const matchingEpic = workflowEpics.find((wfEpic: any) => {
          const matchByAdoId = wfEpic.adoWorkItemId && wfEpic.adoWorkItemId.toString() === item.id;
          const matchByTitle = wfEpic.title && item.title && wfEpic.title.trim().toLowerCase() === item.title.trim().toLowerCase();
          
          if (matchByAdoId || matchByTitle) {
            console.log(`[ComprehensiveTestingModal] 🔗 Matching Epic "${item.title}" (ADO ID: ${item.id})`, {
              matchByAdoId,
              matchByTitle,
              wfEpicId: wfEpic.id,
              wfEpicBrdId: wfEpic.brdId,
              wfEpicAdoId: wfEpic.adoWorkItemId
            });
          }
          
          return matchByAdoId || matchByTitle;
        });
        
        if (matchingEpic?.brdId) {
          console.log(`[ComprehensiveTestingModal] ✅ Epic "${item.title}" enriched with brdId: ${matchingEpic.brdId}`);
          enrichedItem.dbArtifact = matchingEpic;
        } else if (matchingEpic) {
          console.warn(`[ComprehensiveTestingModal] ⚠️ Epic "${item.title}" matched but NO brdId found!`, matchingEpic);
        } else {
          console.warn(`[ComprehensiveTestingModal] ⚠️ Epic "${item.title}" (ADO ID: ${item.id}) NOT matched with any workflow epic`);
        }
      }
      
      // CRITICAL: Enrich Features with epicId from workflow artifacts
      if (item.type === "Feature" && latestWorkflowArtifact?.features) {
        const matchingFeature = workflowFeatures.find((wfFeature: any) => {
          return (
            (wfFeature.adoWorkItemId && wfFeature.adoWorkItemId.toString() === item.id) ||
            (wfFeature.title && item.title && wfFeature.title.trim().toLowerCase() === item.title.trim().toLowerCase())
          );
        });
        
        if (matchingFeature?.epicId) {
          console.log(`[ComprehensiveTestingModal] ✅ Feature "${item.title}" enriched with epicId: ${matchingFeature.epicId}`);
          enrichedItem.dbArtifact = matchingFeature;
        }
      }
      
      // CRITICAL: Enrich User Stories with featureId and epicId from workflow artifacts
      if (item.type === "User Story" && latestWorkflowArtifact?.userStories) {
        const matchingStory = workflowUserStories.find((wfStory: any) => {
          return (
            (wfStory.adoWorkItemId && wfStory.adoWorkItemId.toString() === item.id) ||
            (wfStory.title && item.title && wfStory.title.trim().toLowerCase() === item.title.trim().toLowerCase())
          );
        });
        
        if (matchingStory?.featureId) {
          console.log(`[ComprehensiveTestingModal] ✅ User Story "${item.title}" enriched with featureId: ${matchingStory.featureId}`);
          enrichedItem.dbArtifact = matchingStory;
        }
      }
      
      return enrichedItem;
    });

    // Use workflow artifacts as primary source
    const hasWorkflowArtifacts = latestWorkflowArtifact && 
      (workflowEpics.length > 0 || workflowFeatures.length > 0 || workflowUserStories.length > 0);
    
    // If no workflow artifacts and no SDLC phase items, just return ADO items
    if (!hasWorkflowArtifacts && !dbEpics.length && !dbFeatures.length && !localBacklog.length) {
      console.log("[ComprehensiveTestingModal] No DB items, returning ADO items only:", adoItems.length);
      return adoItems;
    }

    // Use workflow artifacts if available, otherwise use SDLC phase endpoints
    const epicsToUse = hasWorkflowArtifacts ? workflowEpics : dbEpics;
    const featuresToUse = hasWorkflowArtifacts ? workflowFeatures : dbFeatures;
    const storiesToUse = hasWorkflowArtifacts ? workflowUserStories : localBacklog;

    // CRITICAL FIX: Include ALL DB artifacts (both pushed and unpushed)
    // because DB is the source of truth for brdId, epicId, featureId
    // We need these for filtering even if they're already in ADO
    const dbEpicsWithMetadata = hasWorkflowArtifacts ? epicsToUse : [];
    const dbFeaturesWithMetadata = hasWorkflowArtifacts ? featuresToUse : [];
    const dbStoriesWithMetadata = hasWorkflowArtifacts ? storiesToUse : [];
    
    console.log("[ComprehensiveTestingModal] Building hierarchical structure...", {
      dbEpics: dbEpicsWithMetadata.length,
      dbFeatures: dbFeaturesWithMetadata.length,
      dbStories: dbStoriesWithMetadata.length,
      adoItems: adoItems.length
    });
    
    // Log sample epic to verify brdId
    if (dbEpicsWithMetadata.length > 0) {
      console.log("[ComprehensiveTestingModal] Sample DB Epic:", {
        title: dbEpicsWithMetadata[0].title,
        id: dbEpicsWithMetadata[0].id,
        brdId: dbEpicsWithMetadata[0].brdId,
        adoWorkItemId: dbEpicsWithMetadata[0].adoWorkItemId
      });
    }

    // Build hierarchical maps from DB artifacts
    const epicMap = new Map<string, WorkItem>();
    const featureMap = new Map<string, WorkItem>();
    const storyMap = new Map<string, WorkItem>();

    // Add ALL DB epics (with brdId) to the map
    dbEpicsWithMetadata.forEach((epic: any) => {
      const dbEpic: WorkItem = {
        id: epic.adoWorkItemId ? epic.adoWorkItemId.toString() : `db-epic-${epic.id}`, // Use ADO ID if exists
        title: epic.title || "Untitled",
        type: "Epic",
        status: epic.status || "Backlog",
        priority: epic.priority || "Medium",
        linkedItems: [],
        source: epic.adoWorkItemId ? "ADO" : "DB", // Mark as ADO if pushed
        dbArtifact: epic,
        dbArtifactType: "Epic",
        description: epic.description || "",
        brdId: epic.brdId, // CRITICAL: Preserve brdId
      };
      epicMap.set(epic.id, dbEpic);
      
      // Also add by ADO ID for easier lookup
      if (epic.adoWorkItemId) {
        epicMap.set(epic.adoWorkItemId.toString(), dbEpic);
      }
    });

    // Add ALL DB features (with epicId) to the map
    dbFeaturesWithMetadata.forEach((feature: any) => {
      const dbFeature: WorkItem = {
        id: feature.adoWorkItemId ? feature.adoWorkItemId.toString() : `db-feature-${feature.id}`,
        title: feature.title || "Untitled",
        type: "Feature",
        status: feature.status || "Backlog",
        priority: feature.priority || "Medium",
        linkedItems: [],
        source: feature.adoWorkItemId ? "ADO" : "DB",
        dbArtifact: feature,
        dbArtifactType: "Feature",
        description: feature.description || "",
        acceptanceCriteria: feature.acceptanceCriteria || "",
        epicId: feature.epicId, // CRITICAL: Preserve epicId
      };
      featureMap.set(feature.id, dbFeature);
      
      // Also add by ADO ID for easier lookup
      if (feature.adoWorkItemId) {
        featureMap.set(feature.adoWorkItemId.toString(), dbFeature);
      }

      const parentEpic = feature.epicId ? epicMap.get(feature.epicId) : null;
      if (parentEpic) {
        (parentEpic.linkedItems ||= []).push(dbFeature);
      }
    });

    // Add ALL DB user stories (with featureId, epicId) to the map
    dbStoriesWithMetadata.forEach((story: any) => {
      const dbStory: WorkItem = {
        id: story.adoWorkItemId ? story.adoWorkItemId.toString() : `db-story-${story.id}`,
        title: story.title || "Untitled",
        type: "User Story",
        status: story.status || "Backlog",
        priority: story.priority || "Medium",
        linkedItems: [],
        source: story.adoWorkItemId ? "ADO" : "DB",
        dbArtifact: story,
        dbArtifactType: "User Story",
        description: story.description || "",
        acceptanceCriteria: story.acceptanceCriteria || "",
        persona: story.persona || "User",
        storyPoints: story.storyPoints || 0,
        featureId: story.featureId, // CRITICAL: Preserve featureId
        epicId: story.epicId, // CRITICAL: Preserve epicId
      };
      storyMap.set(story.id, dbStory);
      
      // Also add by ADO ID for easier lookup
      if (story.adoWorkItemId) {
        storyMap.set(story.adoWorkItemId.toString(), dbStory);
      }

      const parentFeature = story.featureId ? featureMap.get(story.featureId) : null;
      const parentEpic = !parentFeature && story.epicId ? epicMap.get(story.epicId) : null;

      if (parentFeature) {
        (parentFeature.linkedItems ||= []).push(dbStory);
      } else if (parentEpic) {
        (parentEpic.linkedItems ||= []).push(dbStory);
      }
    });

    // Collect DB root items (items without parents in the hierarchy)
    const dbRootItems: WorkItem[] = [];
    
    // Add all epics as root items (epics are always top-level)
    epicMap.forEach((epicItem) => {
      // Avoid duplicates by checking if already added
      if (!dbRootItems.some(item => item.id === epicItem.id)) {
        dbRootItems.push(epicItem);
      }
    });
    
    // Add features that don't have a parent epic in the map
    dbFeaturesWithMetadata.forEach((feature: any) => {
      const featureItem = featureMap.get(feature.id);
      if (featureItem) {
        const isAttachedToEpic = feature.epicId && epicMap.has(feature.epicId);
        if (!feature.epicId || !isAttachedToEpic) {
          if (!dbRootItems.some(item => item.id === featureItem.id)) {
            dbRootItems.push(featureItem);
          }
        }
      }
    });

    // Add stories that don't have a parent feature or epic in the map
    dbStoriesWithMetadata.forEach((story: any) => {
      const hasFeatureParent = story.featureId ? featureMap.has(story.featureId) : false;
      const hasEpicParent = story.epicId ? epicMap.has(story.epicId) : false;
      if (!hasFeatureParent && !hasEpicParent) {
        const existingStory = storyMap.get(story.id);
        if (existingStory && !dbRootItems.some(item => item.id === existingStory.id)) {
          dbRootItems.push(existingStory);
        }
      }
    });

    // CRITICAL FIX: Replace ADO items with DB items (DB has brdId, epicId, featureId)
    // Instead of deduplicating DB items, we replace ADO items with their DB counterparts
    const buildKey = (wi: WorkItem) => wi.title.trim().toLowerCase();
    
    // Create a map of DB items by title for easy lookup
    const dbItemsByTitle = new Map<string, WorkItem>();
    const collectDbItemsByTitle = (items: WorkItem[]) => {
      for (const wi of items) {
        dbItemsByTitle.set(buildKey(wi), wi);
        if (wi.linkedItems && wi.linkedItems.length > 0) {
          collectDbItemsByTitle(wi.linkedItems);
        }
      }
    };
    collectDbItemsByTitle(dbRootItems);
    
    console.log(`[ComprehensiveTestingModal] DB items by title map size: ${dbItemsByTitle.size}`);
    
    // Replace ADO items with DB items where they exist (DB has metadata!)
    const replacedAdoItems = adoItems.map((adoItem) => {
      const key = buildKey(adoItem);
      const dbItem = dbItemsByTitle.get(key);
      
      if (dbItem) {
        // Use DB item instead of ADO item (DB has brdId, epicId, featureId)
        console.log(`[ComprehensiveTestingModal] 🔄 Replacing ADO item "${adoItem.title}" with DB item (has metadata)`);
        dbItemsByTitle.delete(key); // Remove from map to avoid adding twice
        return dbItem;
      }
      
      // Keep ADO item if no DB match
      return adoItem;
    });
    
    // Add remaining DB items that don't match any ADO item
    const remainingDbItems: WorkItem[] = [];
    dbItemsByTitle.forEach((dbItem) => remainingDbItems.push(dbItem));
    
    console.log(`[ComprehensiveTestingModal] Remaining DB-only items: ${remainingDbItems.length}`);
    
    const combined = [...replacedAdoItems, ...remainingDbItems];
    
    console.log("[ComprehensiveTestingModal] Combined work items:", {
      replacedAdoItems: replacedAdoItems.length,
      remainingDbItems: remainingDbItems.length,
      combined: combined.length,
      epics: combined.filter(item => item.type === "Epic").length,
      features: combined.filter(item => item.type === "Feature").length,
      userStories: combined.filter(item => item.type === "User Story").length,
    });
    
    return combined;
  }, [workItems, latestWorkflowArtifact, workflowEpics, workflowFeatures, workflowUserStories, dbEpics, dbFeatures, localBacklog]);

  // Extract user stories from combined work items
  // Helper function to check for work item type match (case-insensitive and handles variations)
  const isTypeMatch = (type: string | undefined, target: string): boolean => {
    if (!type) return false;
    const lowerType = type.toLowerCase().replace(/-/g, " ").trim();
    const lowerTarget = target.toLowerCase().replace(/-/g, " ").trim();
    return lowerType === lowerTarget;
  };

  const extractUserStories = (items: WorkItem[]): any[] => {
    const stories: any[] = [];
    
    const traverse = (item: WorkItem) => {
      if (isTypeMatch(item.type, "User Story")) {
        stories.push({
          id: item.id,
          title: item.title,
          description: item.description || "",
          persona: item.persona || "User",
          personaId: "",
          acceptanceCriteria: item.acceptanceCriteria || "",
          priority: item.priority || "Medium",
          storyPoints: item.storyPoints || 0,
          featureId: item.parentId,
          epicId: "",
          status: item.status || "New",
        });
      }
      if (item.linkedItems) {
        item.linkedItems.forEach(traverse);
      }
    };
    
    items.forEach(traverse);
    return stories;
  };

  // Extract epics, features, and user stories for hierarchical filtering
  const allEpicsList = combinedWorkItems.filter(item => isTypeMatch(item.type, "Epic"));
  const allFeaturesList = combinedWorkItems.filter(item => isTypeMatch(item.type, "Feature"));
  const allUserStories = extractUserStories(combinedWorkItems);
  
  // Log all epics with their brdIds for debugging
  console.log(`[ComprehensiveTestingModal] ========== ALL EPICS LIST ==========`);
  console.log(`[ComprehensiveTestingModal] Total epics: ${allEpicsList.length}`);
  allEpicsList.forEach((epic, index) => {
    console.log(`[ComprehensiveTestingModal] Epic ${index + 1}:`, {
      title: epic.title,
      id: epic.id,
      source: epic.source,
      brdId: epic.brdId,
      dbArtifactBrdId: epic.dbArtifact?.brdId,
      hasBrdId: !!(epic.brdId || epic.dbArtifact?.brdId)
    });
  });
  console.log(`[ComprehensiveTestingModal] ==========================================`);
  
  // Apply hierarchical filtering with cross-referencing between ADO IDs and workflow IDs
  // Filter Epics by selected BRD
  const filteredEpics = useMemo(() => {
    if (!selectedBrdId) return allEpicsList;
    
    console.log(`[ComprehensiveTestingModal] ========== FILTERING EPICS ==========`);
    console.log(`[ComprehensiveTestingModal] Selected BRD ID: ${selectedBrdId}`);
    console.log(`[ComprehensiveTestingModal] Total Epics to filter: ${allEpicsList.length}`);
    
    // Log all epics with their brdIds before filtering
    allEpicsList.forEach((epic: any, index: number) => {
      console.log(`[ComprehensiveTestingModal] Epic ${index + 1}:`, {
        title: epic.title,
        id: epic.id,
        type: epic.type,
        source: epic.source,
        epicBrdId: epic.brdId,
        dbArtifactBrdId: epic.dbArtifact?.brdId,
        willMatch: epic.brdId === selectedBrdId || epic.dbArtifact?.brdId === selectedBrdId
      });
    });
    
    const filtered = allEpicsList.filter((epic: any) => {
      // Check if epic has brdId property (from workflow artifacts or enriched dbArtifact)
      const matches = epic.brdId === selectedBrdId || epic.dbArtifact?.brdId === selectedBrdId;
      
      if (matches) {
        console.log(`[ComprehensiveTestingModal] ✅ Epic "${epic.title}" MATCHES BRD ${selectedBrdId}`);
      }
      
      return matches;
    });
    
    console.log(`[ComprehensiveTestingModal] ========== FILTER RESULT: ${filtered.length} epics ==========`);
    return filtered;
  }, [allEpicsList, selectedBrdId]);
  
  // Build ID mapping for cross-referencing
  const { epicIdMap, featureIdMap } = useMemo(() => {
    const epicMap = new Map<string, string>();
    const featureMap = new Map<string, string>();
    
    // Map workflow epic IDs to ADO IDs and vice versa
    allEpicsList.forEach((epic: any) => {
      if (epic.dbArtifact) {
        // Epic from ADO with workflow artifact data
        epicMap.set(epic.id, epic.dbArtifact.id); // ADO ID -> workflow ID
        epicMap.set(epic.dbArtifact.id, epic.id); // workflow ID -> ADO ID
      } else if (epic.id && epic.id.startsWith('db-epic-')) {
        // Epic from workflow artifacts only (not pushed)
        const workflowId = epic.id.replace('db-epic-', '');
        epicMap.set(epic.id, workflowId);
        epicMap.set(workflowId, epic.id);
      }
    });
    
    // Map workflow feature IDs to ADO IDs and vice versa
    allFeaturesList.forEach((feature: any) => {
      if (feature.dbArtifact) {
        featureMap.set(feature.id, feature.dbArtifact.id);
        featureMap.set(feature.dbArtifact.id, feature.id);
      } else if (feature.id && feature.id.startsWith('db-feature-')) {
        const workflowId = feature.id.replace('db-feature-', '');
        featureMap.set(feature.id, workflowId);
        featureMap.set(workflowId, feature.id);
      }
    });
    
    return { epicIdMap: epicMap, featureIdMap: featureMap };
  }, [allEpicsList, allFeaturesList]);
  
  // Filter Features by selected Epic (with ID cross-referencing)
  const filteredFeatures = useMemo(() => {
    if (!selectedEpicId) return allFeaturesList;
    
    // Get all possible IDs for the selected epic (ADO ID + workflow ID)
    const possibleEpicIds = new Set([
      selectedEpicId,
      epicIdMap.get(selectedEpicId)
    ].filter(Boolean));
    
    console.log(`[ComprehensiveTestingModal] Filtering features for epic: ${selectedEpicId}`, {
      possibleEpicIds: Array.from(possibleEpicIds),
      totalFeatures: allFeaturesList.length
    });
    
    const filtered = allFeaturesList.filter((feature: any) => {
      // Check epicId from work item, dbArtifact, or parentId
      const featureEpicId = feature.epicId || feature.dbArtifact?.epicId || feature.parentId;
      
      // Check if any of the possible epic IDs match
      const matches = featureEpicId && possibleEpicIds.has(featureEpicId);
      
      if (matches) {
        console.log(`[ComprehensiveTestingModal] ✅ Feature "${feature.title}" matches epic ${featureEpicId}`);
      }
      
      return matches;
    });
    
    console.log(`[ComprehensiveTestingModal] Filtered ${filtered.length} features for selected epic`);
    return filtered;
  }, [allFeaturesList, selectedEpicId, epicIdMap]);
  
  // Filter User Stories by selected Feature (with ID cross-referencing and hierarchy lookup)
  const filteredUserStories = useMemo(() => {
    if (!selectedFeatureId) return allUserStories;
    
    // Get all possible IDs for the selected feature (ADO ID + workflow ID)
    const possibleFeatureIds = new Set([
      selectedFeatureId,
      featureIdMap.get(selectedFeatureId)
    ].filter(Boolean));
    
    console.log(`[ComprehensiveTestingModal] Filtering user stories for feature: ${selectedFeatureId}`, {
      possibleFeatureIds: Array.from(possibleFeatureIds),
      totalStories: allUserStories.length
    });
    
    const filtered = allUserStories.filter((story: any) => {
      // Check featureId from work item, dbArtifact, or parentId
      const storyFeatureId = story.featureId || story.dbArtifact?.featureId || story.parentId;
      
      // For ADO user stories, parentId points to the Feature (direct parent in hierarchy)
      // For workflow stories, featureId is the explicit link
      const matches = storyFeatureId && possibleFeatureIds.has(storyFeatureId);
      
      if (matches) {
        console.log(`[ComprehensiveTestingModal] ✅ Story "${story.title}" matches feature ${storyFeatureId}`);
      }
      
      return matches;
    });
    
    console.log(`[ComprehensiveTestingModal] Filtered ${filtered.length} user stories for selected feature`);
    return filtered;
  }, [allUserStories, selectedFeatureId, featureIdMap]);
  
  // Use filtered lists
  const epicsList = filteredEpics;
  const featuresList = filteredFeatures;
  const userStories = filteredUserStories;

  // Sanitize filename the same way as backend
  const sanitizeFileName = (name: string): string => {
    return name
      .replace(/[^a-zA-Z0-9\s\-_]/g, '')
      .replace(/\s+/g, '-')
      .toLowerCase()
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
  };


  // Load directory structure recursively
  const loadDirectoryStructure = useCallback(async () => {
    if (!selectedAdoProject) return;
    
    setLoadingGeneratedList(true);
    const organization = sanitizeFileName(selectedAdoProject.organization || 'unknown-org');
    const project = sanitizeFileName(selectedAdoProject.name || 'default-project');
    const directoryName = `${organization}-${project}`;
    
    // Browse the project directory: AutomationScript/{org-project}/{project}/
    const projectPath = `AutomationScript/${directoryName}/${project}`;
    
    console.log("[ComprehensiveTestingModal] Loading directory structure from:", projectPath);
    
    try {
      const response = await apiRequest(
        "GET",
        `/api/browse-directory?projectId=${encodeURIComponent(directoryName)}&dirPath=${encodeURIComponent(projectPath)}`
      );
      
      // apiRequest already validates response.ok, so we can directly call .json()
      const result = await response.json();
      
      if (result.success && result.items) {
          // Create directory structure
          const structure = {
            name: project,
            path: projectPath,
            type: 'dir',
            children: result.items || []
          };
          
          console.log("[ComprehensiveTestingModal] Loaded directory structure:", structure);
          setDirectoryStructure(structure);
          
          // Also update the map for badges
          const storyDirs = result.items.filter((item: any) => item.type === 'dir');
          const statusMap: Record<string, boolean> = {};
          
          console.log("[ComprehensiveTestingModal] Checking", storyDirs.length, "directories against", userStories.length, "user stories");
          
          storyDirs.forEach((dir: any) => {
            const sanitizedDirName = dir.name;
            const matchingStory = userStories.find(story => {
              const sanitizedStoryTitle = sanitizeFileName(story.title);
              const matches = sanitizedStoryTitle === sanitizedDirName;
              if (matches) {
                console.log("[ComprehensiveTestingModal] ✅ MATCH:", story.title, "->", sanitizedDirName);
              }
              return matches;
            });
            if (matchingStory) {
              statusMap[matchingStory.id] = true;
            } else {
              console.log("[ComprehensiveTestingModal] ❌ NO MATCH for directory:", sanitizedDirName);
            }
          });
          
          console.log("[ComprehensiveTestingModal] Generated stories map:", statusMap, "Total matched:", Object.keys(statusMap).length);
          setGeneratedStoriesMap(statusMap);
        } else {
          console.log("[ComprehensiveTestingModal] No generated content found");
          setDirectoryStructure(null);
          setGeneratedStoriesMap({});
        }
    } catch (error) {
      console.error("[ComprehensiveTestingModal] Error loading directory structure:", error);
      setDirectoryStructure(null);
    } finally {
      setLoadingGeneratedList(false);
    }
  }, [selectedAdoProject, userStories]);
  
  // Load generated stories by browsing the directory structure
  const loadGeneratedStories = useCallback(async () => {
    loadDirectoryStructure();
  }, [loadDirectoryStructure]);
  
  // Toggle folder expansion and load children if needed
  const toggleFolder = useCallback(async (folderPath: string, currentChildren: any[]) => {
    const newExpanded = new Set(expandedFolders);
    
    if (expandedFolders.has(folderPath)) {
      // Collapse
      newExpanded.delete(folderPath);
    } else {
      // Expand
      newExpanded.add(folderPath);
      
      // If folder has no children loaded yet, fetch them
      if (!currentChildren || currentChildren.length === 0) {
        const organization = sanitizeFileName(selectedAdoProject?.organization || 'unknown-org');
        const project = sanitizeFileName(selectedAdoProject?.name || 'default-project');
        const directoryName = `${organization}-${project}`;
        
        try {
          const response = await apiRequest(
            "GET",
            `/api/browse-directory?projectId=${encodeURIComponent(directoryName)}&dirPath=${encodeURIComponent(folderPath)}`
          );
          
          // apiRequest already validates response.ok, so we can directly call .json()
          const result = await response.json();
          if (result.success && result.items) {
            // Update the directory structure with children
            const updateChildren = (node: any): any => {
              if (node.fullPath === folderPath || node.path === folderPath) {
                return { ...node, children: result.items };
              }
              if (node.children) {
                return { ...node, children: node.children.map(updateChildren) };
              }
              return node;
            };
            
            setDirectoryStructure((prev: any) => prev ? updateChildren(prev) : prev);
          }
        } catch (error) {
          console.error("Error loading folder contents:", error);
        }
      }
    }
    
    setExpandedFolders(newExpanded);
  }, [expandedFolders, selectedAdoProject]);
  
  // Load file content
  const loadFileContent = useCallback(async (filePath: string) => {
    setSelectedFilePath(filePath);
    setLoadingFileContent(true);

    const org = sanitizeFileName(selectedAdoProject?.organization || "unknown-org");
    const proj = sanitizeFileName(selectedAdoProject?.name || "default-project");
    const browseProjectId = `${org}-${proj}`;
    
    try {
      const response = await apiRequest(
        "GET",
        `/api/preview-file-content?filePath=${encodeURIComponent(filePath)}&projectId=${encodeURIComponent(browseProjectId)}`
      );
      
      // apiRequest already validates response.ok, so we can directly call .json()
      const result = await response.json();
      setFileContent(result.content || '');
    } catch (error) {
      console.error("Error loading file content:", error);
      toast.error("Error loading file content");
      setFileContent('');
    } finally {
      setLoadingFileContent(false);
    }
  }, [selectedAdoProject]);
  
  // Check which user stories have generated tests (for badges)
  const checkGeneratedTests = useCallback(async () => {
    // Just call loadGeneratedStories which does both
    loadGeneratedStories();
  }, [loadGeneratedStories]);

  // Reset state when modal opens
  useEffect(() => {
    if (open) {
      setSelectedTab("stories");
      setSelectedFilePath(null);
      setFileContent("");
      setExpandedFolders(new Set());
    }
  }, [open]);

  // Render file tree node recursively
  const renderFileTreeNode = (node: any, level: number = 0) => {
    const isExpanded = expandedFolders.has(node.fullPath || node.path);
    const isSelected = selectedFilePath === (node.fullPath || node.path);
    const isDir = node.type === 'dir';
    
    return (
      <div key={node.fullPath || node.path} className="w-full">
        <div
          className={cn(
            "flex items-center gap-2 px-2 py-1.5 cursor-pointer hover:bg-accent rounded-sm transition-colors w-full",
            isSelected && "bg-accent"
          )}
          style={{ paddingLeft: `${level * 16 + 8}px` }}
          onClick={() => {
            if (isDir) {
              toggleFolder(node.fullPath || node.path, node.children);
            } else {
              loadFileContent(node.fullPath || node.path);
            }
          }}
        >
          {isDir ? (
            <>
              {isExpanded ? (
                <ChevronDown className="h-4 w-4 flex-shrink-0" />
              ) : (
                <ChevronRight className="h-4 w-4 flex-shrink-0" />
              )}
              <Folder className="h-4 w-4 flex-shrink-0 text-blue-500" />
            </>
          ) : (
            <>
              <div className="w-4 flex-shrink-0" /> {/* Spacer for alignment */}
              <FileText className="h-4 w-4 flex-shrink-0 text-gray-500" />
            </>
          )}
          <span className="text-sm truncate overflow-hidden" title={node.name}>{node.name}</span>
        </div>
        
        {isDir && isExpanded && node.children && node.children.length > 0 && (
          <div>
            {node.children.map((child: any) => renderFileTreeNode(child, level + 1))}
          </div>
        )}
      </div>
    );
  };
  
  // Load generated stories when tab is switched or modal opens
  // IMPORTANT: Only run when user stories are FULLY loaded (not loading anymore)
  useEffect(() => {
    if (open && selectedTab === "generated-content" && userStories.length > 0 && selectedAdoProject && !loadingUserStories) {
      console.log("[ComprehensiveTestingModal] Loading generated stories for Generated Content tab");
      loadGeneratedStories();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, selectedTab, userStories.length, selectedAdoProject, loadingUserStories]);
  
  // Check generated tests ONCE when modal opens and ALL user stories are fully loaded
  useEffect(() => {
    // Only run once per modal open session, when loading is complete
    if (open && !loadingUserStories && userStories.length > 0 && selectedAdoProject && !hasLoadedGeneratedOnce) {
      console.log("[ComprehensiveTestingModal] Initial badge count check - Total stories:", userStories.length);
      loadGeneratedStories();
      setHasLoadedGeneratedOnce(true); // Mark as loaded to prevent re-runs
    }
    
    // Reset the flag when modal closes
    if (!open) {
      setHasLoadedGeneratedOnce(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, loadingUserStories, userStories.length, selectedAdoProject, hasLoadedGeneratedOnce]);

  const handleGenerationComplete = () => {
    if (effectiveProjectName) {
      queryClient.invalidateQueries({ 
        queryKey: [`/api/hub/artifacts/${effectiveProjectName}/work-items`] 
      });
    }
    queryClient.invalidateQueries({ queryKey: ["/api/workflow/artifacts", apiProjectId] });
    refetchUserStories();
    // Reset flag to allow recalculation and refresh generated status
    setHasLoadedGeneratedOnce(false);
    loadGeneratedStories();
    toast.success("Test generation completed!");
  };

  const handleStoryClick = (storyId: string) => {
    setPreSelectedStoryId(storyId);
    setShowGenerateModal(true);
  };

  // Navigate to generated content tab
  const handleViewGeneratedContent = () => {
    setSelectedTab("generated-content");
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-[95vw] h-[95vh] flex flex-col overflow-hidden">
          <DialogHeader className="flex-shrink-0">
            <DialogTitle className="flex items-center gap-2">
              <Code className="h-5 w-5" />
              Test Artifacts Generator - {selectedAdoProject?.name || "Project"}
            </DialogTitle>
            <DialogDescription>
              {integrationType === "jira"
                ? "Select BRD and work items to generate test artifacts"
                : "Select BRD, Epics, Features, and User Stories to generate test artifacts"}
            </DialogDescription>
          </DialogHeader>

          {/* Hierarchical Filters - Placed right after description */}
          <div className="grid grid-cols-3 gap-3 px-6 py-3 border-b flex-shrink-0 bg-muted/30">
            {/* BRD Filter */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-foreground">Select BRD</label>
              <Select
                value={selectedBrdId || "all"}
                onValueChange={(value) => {
                  setSelectedBrdId(value === "all" ? null : value);
                  setSelectedEpicId(null);
                  setSelectedFeatureId(null);
                }}
              >
                <SelectTrigger className="h-9">
                  <SelectValue placeholder="All BRDs" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All BRDs</SelectItem>
                  {isLoadingBrds ? (
                    <SelectItem value="loading" disabled>Loading...</SelectItem>
                  ) : brdsData.length === 0 ? (
                    <SelectItem value="none" disabled>No BRDs available</SelectItem>
                  ) : (
                    brdsData.map((brd) => (
                      <SelectItem key={brd.id} value={brd.id}>
                        {brd.title}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </div>
            
            {/* Epic Filter */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-foreground">Select Epic</label>
              <Select
                value={selectedEpicId || "all"}
                onValueChange={(value) => {
                  setSelectedEpicId(value === "all" ? null : value);
                  setSelectedFeatureId(null);
                }}
              >
                <SelectTrigger className="h-9">
                  <SelectValue placeholder="All Epics" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Epics</SelectItem>
                  {filteredEpics.length === 0 ? (
                    <SelectItem value="none" disabled>No Epics available</SelectItem>
                  ) : (
                    filteredEpics.map((epic: any) => (
                      <SelectItem key={epic.id} value={epic.id}>
                        {epic.title}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </div>
            
            {/* Feature Filter */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-foreground">Select Feature</label>
              <Select
                value={selectedFeatureId || "all"}
                onValueChange={(value) => {
                  setSelectedFeatureId(value === "all" ? null : value);
                }}
              >
                <SelectTrigger className="h-9">
                  <SelectValue placeholder="All Features" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Features</SelectItem>
                  {filteredFeatures.length === 0 ? (
                    <SelectItem value="none" disabled>No Features available</SelectItem>
                  ) : (
                    filteredFeatures.map((feature: any) => (
                      <SelectItem key={feature.id} value={feature.id}>
                        {feature.title}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </div>
          </div>

          <Tabs value={selectedTab} onValueChange={setSelectedTab} className="flex-1 flex flex-col overflow-hidden">
            <TabsList className="grid w-full grid-cols-3 flex-shrink-0">
              <TabsTrigger value="stories" className="flex items-center gap-2">
                <User className="h-4 w-4" />
                User Stories ({userStories.length})
              </TabsTrigger>
              <TabsTrigger value="generated-content" className="flex items-center gap-2">
                <FileText className="h-4 w-4" />
                Generated Content
                {Object.values(generatedStoriesMap).filter(v => v).length > 0 && (
                  <Badge variant="secondary" className="ml-1 text-xs">
                    {Object.values(generatedStoriesMap).filter(v => v).length}
                  </Badge>
                )}
              </TabsTrigger>
              <TabsTrigger value="summary" className="flex items-center gap-2">
                <FileText className="h-4 w-4" />
                Summary
              </TabsTrigger>
            </TabsList>

            {/* User Stories Tab */}
            <TabsContent value="stories" className="flex-1 overflow-hidden mt-4">
              <div className="flex flex-col h-full">
                <div className="flex justify-between items-center mb-4 flex-shrink-0">
                  <div className="flex gap-2">
                    <Button 
                      variant="outline" 
                      size="sm"
                      onClick={() => refetchUserStories()}
                      disabled={loadingUserStories}
                    >
                      <RefreshCw className={`h-4 w-4 mr-2 ${loadingUserStories ? 'animate-spin' : ''}`} />
                      Refresh Stories
                    </Button>
                    <Button 
                      variant="outline" 
                      size="sm"
                      onClick={() => {
                        setHasLoadedGeneratedOnce(false);
                        loadGeneratedStories();
                        toast("Refreshing generated content status...", { icon: "🔄" });
                      }}
                      disabled={loadingGeneratedList}
                    >
                      <RefreshCw className={`h-4 w-4 mr-2 ${loadingGeneratedList ? 'animate-spin' : ''}`} />
                      Refresh Generated Status
                    </Button>
                  </div>
                </div>

                <ScrollArea className="flex-1">
                  {!selectedAdoProject ? (
                    <div className="flex items-center justify-center h-64 text-muted-foreground">
                      <div className="text-center">
                        <User className="h-12 w-12 mx-auto mb-4 opacity-50" />
                        <p>{integrationType === "jira" ? "No Jira project selected" : "No Azure DevOps project selected"}</p>
                        <p className="text-sm mt-2">Please select a project in SDLC settings</p>
                      </div>
                    </div>
                  ) : loadingUserStories ? (
                    <div className="flex items-center justify-center h-64 text-muted-foreground">
                      <div className="text-center">
                        <Loader2 className="h-12 w-12 mx-auto mb-4 opacity-50 animate-spin" />
                        <p>Loading user stories...</p>
                      </div>
                    </div>
                  ) : loadingError ? (
                    <div className="flex items-center justify-center h-64 text-muted-foreground">
                      <div className="text-center">
                        <User className="h-12 w-12 mx-auto mb-4 opacity-50 text-destructive" />
                        <p className="text-destructive">Failed to load user stories</p>
                        <p className="text-sm mt-2">{(loadingError as Error).message}</p>
                        <Button 
                          variant="outline" 
                          size="sm" 
                          className="mt-4"
                          onClick={() => refetchUserStories()}
                        >
                          <RefreshCw className="h-4 w-4 mr-2" />
                          Retry
                        </Button>
                      </div>
                    </div>
                  ) : userStories.length === 0 ? (
                    <div className="flex items-center justify-center h-64 text-muted-foreground">
                      <div className="text-center">
                        <User className="h-12 w-12 mx-auto mb-4 opacity-50" />
                        <p>No user stories found</p>
                        <p className="text-sm mt-2">
                          {(selectedBrdId || selectedEpicId || selectedFeatureId) 
                            ? `Try adjusting your filters or create ${integrationType === "jira" ? "work items in Jira" : "user stories in Azure DevOps"}`
                            : integrationType === "jira" ? "Create work items in Jira to get started" : "Create user stories in Azure DevOps to get started"}
                        </p>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {/* Filter Info Bar */}
                      <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg border">
                        <div className="flex items-center gap-2 text-sm">
                          <FileText className="h-4 w-4 text-primary" />
                          <span className="font-medium">{userStories.length} user stor{userStories.length === 1 ? 'y' : 'ies'} found</span>
                          {(selectedBrdId || selectedEpicId || selectedFeatureId) && (
                            <span className="text-muted-foreground">
                              {selectedFeatureId ? 'for selected feature' : selectedEpicId ? 'for selected epic' : 'for selected BRD'}
                            </span>
                          )}
                          {!selectedBrdId && !selectedEpicId && !selectedFeatureId && (
                            <span className="text-muted-foreground">
                              (showing all)
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          Click on any story to generate test cases
                        </div>
                      </div>
                      
                      <div className="grid gap-3">
                        {userStories.map((story) => {
                        const feature = featuresList.find((f: any) => f.id === story.featureId || `db-feature-${story.featureId}` === f.id);
                        const epic = epicsList.find((e: any) => e.id === (feature as any)?.epicId || `db-epic-${(feature as any)?.epicId}` === e.id);
                        const hasGenerated = generatedStoriesMap[story.id];

                        return (
                          <Card 
                            key={story.id} 
                            className="hover:shadow-md transition-all hover:border-primary group relative"
                          >
                            <CardHeader className="pb-3">
                              <div className="flex justify-between items-start gap-2">
                                <div className="flex-1 cursor-pointer" onClick={() => handleStoryClick(story.id)}>
                                  <CardTitle className="text-base flex items-center gap-2">
                                    <TestTube className="h-4 w-4 text-primary" />
                                    {story.title}
                                    {hasGenerated && (
                                      <Badge variant="default" className="text-xs bg-green-600 hover:bg-green-700 ml-2">
                                        <CheckCircle className="h-3 w-3 mr-1" />
                                        Generated
                                      </Badge>
                                    )}
                                  </CardTitle>
                                  <div className="flex gap-2 mt-2 text-xs text-muted-foreground">
                                    {epic && <Badge variant="outline">{epic.title}</Badge>}
                                    {feature && <Badge variant="outline">{feature.title}</Badge>}
                                  </div>
                                </div>
                                <div className="flex flex-col items-end gap-2">
                                  {hasGenerated && (
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      className="h-7 text-xs opacity-0 group-hover:opacity-100 transition-opacity"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleViewGeneratedContent();
                                      }}
                                      title="View generated content in file browser"
                                    >
                                      <FileText className="h-3 w-3 mr-1" />
                                      View Files
                                    </Button>
                                  )}
                                  <Badge variant="secondary">{story.storyPoints || 0} pts</Badge>
                                </div>
                              </div>
                            </CardHeader>
                            <CardContent>
                              <p className="text-sm text-muted-foreground line-clamp-2">
                                {story.description || "No description available"}
                              </p>
                              {story.persona && (
                                <div className="flex items-center gap-2 mt-2">
                                  <User className="h-3 w-3" />
                                  <span className="text-xs text-muted-foreground">{story.persona}</span>
                                </div>
                              )}
                            </CardContent>
                          </Card>
                        );
                      })}
                      </div>
                    </div>
                  )}
                </ScrollArea>
              </div>
            </TabsContent>

            {/* Generated Content Tab */}
            <TabsContent value="generated-content" className="flex-1 overflow-hidden mt-4">
              {/* Two-pane file browser */}
              <div className="flex h-full gap-4 overflow-hidden">
                {/* Left Pane - Directory Tree */}
                <Card className="w-[30%] flex-shrink-0 flex flex-col overflow-hidden">
                  <CardHeader className="pb-3">
                    <div className="flex justify-between items-center">
                      <CardTitle className="text-base flex items-center gap-2">
                        <Folder className="h-4 w-4" />
                        Generated Scripts
                      </CardTitle>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={loadGeneratedStories}
                        disabled={loadingGeneratedList}
                      >
                        <RefreshCw className={`h-3 w-3 ${loadingGeneratedList ? 'animate-spin' : ''}`} />
                      </Button>
                    </div>
                  </CardHeader>
                  <CardContent className="flex-1 overflow-hidden p-0">
                    <ScrollArea className="h-full px-4 pb-4">
                      {loadingGeneratedList ? (
                        <div className="flex items-center justify-center h-32">
                          <Loader2 className="h-6 w-6 animate-spin text-primary" />
                        </div>
                      ) : !directoryStructure ? (
                        <div className="text-center text-sm text-muted-foreground py-8">
                          <Folder className="h-8 w-8 mx-auto mb-2 opacity-50" />
                          <p>No generated content found</p>
                        </div>
                      ) : (
                        <div className="space-y-1">
                          {renderFileTreeNode(directoryStructure)}
                        </div>
                      )}
                    </ScrollArea>
                  </CardContent>
                </Card>

                {/* Right Pane - File Content */}
                <Card className="w-[70%] flex-shrink-0 flex flex-col overflow-hidden">
                  <CardHeader className="pb-3">
                    <div className="flex justify-between items-center">
                      <CardTitle className="text-base flex items-center gap-2 truncate">
                        <FileText className="h-4 w-4 flex-shrink-0" />
                        {selectedFilePath ? selectedFilePath.split('/').pop() : 'Select a file'}
                      </CardTitle>
                      {selectedFilePath && fileContent && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            navigator.clipboard.writeText(fileContent);
                            toast.success('Copied to clipboard!');
                          }}
                        >
                          <Copy className="h-3 w-3 mr-1" />
                          Copy
                        </Button>
                      )}
                    </div>
                    {selectedFilePath && (
                      <p className="text-xs text-muted-foreground truncate">{selectedFilePath}</p>
                    )}
                  </CardHeader>
                  <CardContent className="flex-1 min-h-0 p-0 relative">
                    {loadingFileContent ? (
                      <div className="h-full flex items-center justify-center">
                        <div className="text-center">
                          <Loader2 className="h-8 w-8 mx-auto mb-2 animate-spin text-primary" />
                          <p className="text-sm text-muted-foreground">Loading file content...</p>
                        </div>
                      </div>
                    ) : !selectedFilePath ? (
                      <div className="h-full flex items-center justify-center text-muted-foreground">
                        <div className="text-center">
                          <FileText className="h-12 w-12 mx-auto mb-4 opacity-50" />
                          <p>Select a file to view its content</p>
                        </div>
                      </div>
                    ) : (
                      <ScrollArea className="h-full">
                        <div className="p-4">
                          <pre className="text-xs bg-muted/50 p-4 rounded-md overflow-x-auto">
                            <code>{fileContent || 'Empty file'}</code>
                          </pre>
                        </div>
                      </ScrollArea>
                    )}
                  </CardContent>
                </Card>
              </div>
            </TabsContent>

            {/* Summary Tab */}
            <TabsContent value="summary" className="flex-1 overflow-hidden mt-4">
              <ScrollArea className="h-full">
                <div className="grid gap-4">
                  <Card>
                    <CardHeader>
                      <CardTitle>Test Coverage Summary</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="grid grid-cols-3 gap-4">
                        <div>
                          <div className="text-2xl font-bold text-blue-600">{userStories.length}</div>
                          <div className="text-sm text-muted-foreground">Total User Stories</div>
                        </div>
                        <div>
                          <div className="text-2xl font-bold text-green-600">{Object.values(generatedStoriesMap).filter(v => v).length}</div>
                          <div className="text-sm text-muted-foreground">Generated Tests</div>
                        </div>
                        <div>
                          <div className="text-2xl font-bold text-purple-600">{epicsList.length}</div>
                          <div className="text-sm text-muted-foreground">Epics</div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader>
                      <CardTitle>Quick Actions</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2">
                      <Button 
                        className="w-full justify-start" 
                        variant="outline"
                        onClick={() => setShowGenerateModal(true)}
                        disabled={userStories.length === 0}
                      >
                        <TestTube className="h-4 w-4 mr-2" />
                        Generate Test Cases for User Story
                      </Button>
                    </CardContent>
                  </Card>
                </div>
              </ScrollArea>
            </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>

      {/* User Story Selection Modal for Generation */}
      <UserStorySelectionModal
        open={showGenerateModal}
        onOpenChange={(isOpen) => {
          setShowGenerateModal(isOpen);
          if (!isOpen) {
            setPreSelectedStoryId(null);
          }
        }}
        epics={epicsList.map((e: any) => ({
          id: e.id,
          title: e.title,
          description: e.description || "",
          status: e.status || "Active",
          priority: e.priority || "Medium",
          ...(e.dbArtifact || {}),
        }))}
        features={featuresList.map((f: any) => ({
          id: f.id,
          title: f.title,
          description: f.description || "",
          status: f.status || "Active",
          priority: f.priority || "Medium",
          epicId: f.parentId || (f.dbArtifact?.epicId),
          ...(f.dbArtifact || {}),
        }))}
        userStories={userStories}
        projectId={apiProjectId}
        sdlcProjectId={apiProjectId}
        projectName={selectedAdoProject?.name || ""}
        azureConfig={{
          organization: selectedAdoProject?.organization || "",
          project: selectedAdoProject?.name || "",
        }}
        wikiJobId={null}
        onGenerationComplete={handleGenerationComplete}
        preSelectedStoryId={preSelectedStoryId}
      />
    </>
  );
}
