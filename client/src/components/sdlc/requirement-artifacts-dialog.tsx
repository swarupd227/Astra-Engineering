import { ReactNode, useEffect, useMemo, useState } from "react";
import { GenericModal } from "@/components/ui/generic-modal";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ArtifactEditDialog } from "@/components/workflow/artifact-edit-dialog";
import { DevOpsPushModal } from "@/components/sdlc/devops-push-modal";
import { LinkedItemsTree } from "@/components/sdlc/linked-items-tree";
import type { Epic, Feature, UserStory } from "@shared/schema";
import {
  ArrowDown,
  ArrowUp,
  Edit,
  Eye,
  Filter,
  Search,
  CheckCircle2,
  Cloud,
  FileText,
  Save,
  Loader2,
  Trash2,
  AlertTriangle,
  ExternalLink,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { getApiUrl } from "@/lib/api-config";
import { pollAsyncJob } from "@/lib/async-job-poller";
import toast from "react-hot-toast";

type ArtifactTab = "linked" | "overview" | "epics" | "features" | "userstories";

interface RequirementArtifactsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectName?: string | null;
  projectId?: string;
  defaultTab?: ArtifactTab;
  epics: Epic[];
  features: Feature[];
  userStories: UserStory[];
  requirement?: string | null;
  artifactId?: string | null;
  onArtifactUpdate?: () => void;
  personas?: any[];
  adoProjectId?: string | null;
  adoProjectName?: string | null;
  adoOrganization?: string | null;
  // Optional display-friendly organization string (e.g. full URL)
  adoOrganizationDisplay?: string | null;
  integrationType?: string;
}

type ArtifactUnion = Epic | Feature | UserStory;

const statusFilters = ["all", "approved", "backlog"];

const typeLabelMap: Record<ArtifactTab, string> = {
  linked: "Linked Items",
  overview: "Overview",
  epics: "Epics",
  features: "Features",
  userstories: "User Stories",
};

const typeColorMap: Record<ArtifactTab, string> = {
  linked: "bg-slate-500",
  overview: "bg-slate-500",
  epics: "bg-purple-500",
  features: "bg-blue-500",
  userstories: "bg-green-500",
};

const toSingularArtifactType = (
  tab: "epics" | "features" | "userstories"
): "epic" | "feature" | "story" =>
  tab === "epics" ? "epic" : tab === "features" ? "feature" : "story";

const formatDisplayLabel = (value?: string | null) =>
  value ? value.charAt(0).toUpperCase() + value.slice(1) : "";

const isAdoArtifact = (artifact: any) =>
  Boolean(artifact?._isAdoItem || artifact?.adoWorkItemId || artifact?._adoId);

const isDbOnlyArtifact = (artifact: any) => !isAdoArtifact(artifact);

const typeBadgeStyles: Record<"epic" | "feature" | "story", string> = {
  epic: "bg-purple-500/20 text-purple-500",
  feature: "bg-blue-500/20 text-blue-500",
  story: "bg-green-500/20 text-green-500",
};

const priorityBadgeStyles: Record<string, string> = {
  high: "bg-red-500/15 text-red-500 border border-red-500/30",
  medium: "bg-amber-500/15 text-amber-500 border border-amber-500/30",
  low: "bg-blue-500/15 text-blue-500 border border-blue-500/30",
};

const statusBadgeStyles: Record<string, string> = {
  approved: "bg-emerald-500/15 text-emerald-500 border border-emerald-500/30",
  backlog: "bg-orange-500/15 text-orange-500 border border-orange-500/30",
  "in-progress": "bg-sky-500/15 text-sky-500 border border-sky-500/30",
  completed: "bg-green-500/15 text-green-500 border border-green-500/30",
  draft: "bg-slate-500/15 text-slate-500 border border-slate-500/30",
};

export function RequirementArtifactsDialog({
  open,
  onOpenChange,
  projectName,
  projectId,
  defaultTab = "userstories",
  epics,
  features,
  userStories,
  requirement,
  artifactId,
  onArtifactUpdate,
  personas = [],
  adoProjectId,
  adoProjectName,
  adoOrganization,
  adoOrganizationDisplay,
  integrationType = "ado",
}: RequirementArtifactsDialogProps) {
  const isJira = integrationType === "jira";
  const providerName = isJira ? "Jira" : "Azure DevOps";
  const providerShort = isJira ? "Jira" : "ADO";

  const [activeTab, setActiveTab] = useState<ArtifactTab>(defaultTab);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [editArtifact, setEditArtifact] = useState<ArtifactUnion | null>(null);
  const [editType, setEditType] = useState<"epic" | "feature" | "story">(
    "story"
  );
  const [viewArtifact, setViewArtifact] = useState<{
    artifact: ArtifactUnion;
    type: "epic" | "feature" | "story";
  } | null>(null);
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [isApproved, setIsApproved] = useState(false);
  const [devopsPushModalOpen, setDevopsPushModalOpen] = useState(false);
  const [isPushingItem, setIsPushingItem] = useState<string | null>(null);
  const [pushProgress, setPushProgress] = useState(0);
  const [pushProgressMessage, setPushProgressMessage] = useState("");
  const [isSavingItem, setIsSavingItem] = useState<string | null>(null);
  const [deletingItem, setDeletingItem] = useState<string | null>(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [itemToDelete, setItemToDelete] = useState<{
    artifact: ArtifactUnion;
    type: "epic" | "feature" | "story";
    cascadeMessage?: string;
  } | null>(null);

  // Local state copies for immediate UI updates
  const [localEpics, setLocalEpics] = useState<Epic[]>(epics);
  const [localFeatures, setLocalFeatures] = useState<Feature[]>(features);
  const [localUserStories, setLocalUserStories] =
    useState<UserStory[]>(userStories);

  // Sync local state when props change
  useEffect(() => {
    const allItems = [...epics, ...features, ...userStories];
    const dbOnlyItems = allItems.filter(
      (i: any) => !i._isAdoItem && !i.adoWorkItemId
    );
    const adoItems = allItems.filter(
      (i: any) => i._isAdoItem || i.adoWorkItemId
    );

    console.log("[RequirementArtifactsDialog] Props updated:", {
      totalItems: allItems.length,
      epics: epics.length,
      features: features.length,
      userStories: userStories.length,
      "DB-only items (not pushed)": dbOnlyItems.length,
      "ADO items (synced or pushed)": adoItems.length,
      epicsWithAdoId: epics.filter((e: any) => e.adoWorkItemId).length,
      featuresWithAdoId: features.filter((f: any) => f.adoWorkItemId).length,
      storiesWithAdoId: userStories.filter((s: any) => s.adoWorkItemId).length,
      epicsWithIsAdoFlag: epics.filter((e: any) => e._isAdoItem).length,
      featuresWithIsAdoFlag: features.filter((f: any) => f._isAdoItem).length,
      storiesWithIsAdoFlag: userStories.filter((s: any) => s._isAdoItem).length,
    });
    setLocalEpics(epics);
    setLocalFeatures(features);
    setLocalUserStories(userStories);
  }, [epics, features, userStories]);

  useEffect(() => {
    if (open) {
      setActiveTab(defaultTab);
      setStatusFilter("all");
      setSearchQuery("");
      setSelectedItems(new Set());
      setIsApproved(false);
    }
  }, [open, defaultTab]);

  // Selection handlers
  const toggleItemSelection = (itemId: string) => {
    setSelectedItems((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) {
        next.delete(itemId);
      } else {
        next.add(itemId);
      }
      return next;
    });
  };

  const handleView = (
    artifact: ArtifactUnion,
    type: "epic" | "feature" | "story"
  ) => {
    setViewArtifact({ artifact, type });
  };

  const handleApprove = () => {
    setIsApproved(true);
    toast.success("Artifacts approved! You can now push to Azure DevOps.");
  };

  const handlePushToDevOps = () => {
    if (!isApproved) {
      toast.error(
        `Please approve artifacts first before pushing to ${providerName}.`
      );
      return;
    }

    if (selectedItems.size === 0) {
      toast.error("Please select at least one item to push.");
      return;
    }

    // Open the DevOps push modal
    setDevopsPushModalOpen(true);
  };

  const filteredEpics = useMemo(() => {
    return (localEpics || []).filter((epic) => {
      const matchesSearch =
        !searchQuery ||
        epic.title?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        epic.description?.toLowerCase().includes(searchQuery.toLowerCase());

      // Status filter
      if (statusFilter === "approved") {
        const statusValue = ((epic as any).status ?? "planned").toLowerCase();
        const isStatusApproved = statusValue === "approved";
        const isCheckpointApprovedItem =
          isApproved && selectedItems.has(epic.id);
        return (
          matchesSearch &&
          (isStatusApproved || isCheckpointApprovedItem)
        );
      }

      const matchesStatus =
        statusFilter === "all" ||
        ((epic as any).status ?? "planned").toLowerCase() ===
          statusFilter.toLowerCase();
      return matchesSearch && matchesStatus;
    });
  }, [
    localEpics,
    searchQuery,
    statusFilter,
    isApproved,
    selectedItems,
  ]);

  const filteredFeatures = useMemo(() => {
    return (localFeatures || []).filter((feature) => {
      const matchesSearch =
        !searchQuery ||
        feature.title?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        feature.description?.toLowerCase().includes(searchQuery.toLowerCase());

      if (statusFilter === "approved") {
        const statusValue = (
          (feature as any).status ?? "planned"
        ).toLowerCase();
        const isStatusApproved = statusValue === "approved";
        const isCheckpointApprovedItem =
          isApproved && selectedItems.has(feature.id);
        return (
          matchesSearch &&
          (isStatusApproved || isCheckpointApprovedItem)
        );
      }

      const matchesStatus =
        statusFilter === "all" ||
        ((feature as any).status ?? "planned").toLowerCase() ===
          statusFilter.toLowerCase();
      return matchesSearch && matchesStatus;
    });
  }, [
    localFeatures,
    searchQuery,
    statusFilter,
    isApproved,
    selectedItems,
  ]);

  const filteredStories = useMemo(() => {
    return (localUserStories || []).filter((story) => {
      const matchesSearch =
        !searchQuery ||
        story.title?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        story.description?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        story.persona?.toLowerCase().includes(searchQuery.toLowerCase());

      // Epic and Feature filters removed for User Stories as they are not working

      if (statusFilter === "approved") {
        const statusValue = ((story as any).status ?? "planned").toLowerCase();
        const isStatusApproved = statusValue === "approved";
        const isCheckpointApprovedItem =
          isApproved && selectedItems.has(story.id);
        return (
          matchesSearch &&
          (isStatusApproved || isCheckpointApprovedItem)
        );
      }

      const matchesStatus =
        statusFilter === "all" ||
        ((story as any).status ?? "planned").toLowerCase() ===
          statusFilter.toLowerCase();
      return matchesSearch && matchesStatus;
    });
  }, [
    localUserStories,
    searchQuery,
    statusFilter,
    isApproved,
    selectedItems,
  ]);

  const getListForActiveTab = () => {
    switch (activeTab) {
      case "epics":
        return filteredEpics;
      case "features":
        return filteredFeatures;
      case "userstories":
        return filteredStories;
      default:
        return [...filteredEpics, ...filteredFeatures, ...filteredStories];
    }
  };

  const list = getListForActiveTab();

  const adoEpics = useMemo(
    () => filteredEpics.filter(isAdoArtifact),
    [filteredEpics]
  );
  const dbEpics = useMemo(
    () => filteredEpics.filter(isDbOnlyArtifact),
    [filteredEpics]
  );
  const adoFeatures = useMemo(
    () => filteredFeatures.filter(isAdoArtifact),
    [filteredFeatures]
  );
  const dbFeatures = useMemo(
    () => filteredFeatures.filter(isDbOnlyArtifact),
    [filteredFeatures]
  );
  const adoStories = useMemo(
    () => filteredStories.filter(isAdoArtifact),
    [filteredStories]
  );
  const dbStories = useMemo(
    () => filteredStories.filter(isDbOnlyArtifact),
    [filteredStories]
  );

  const buildHierarchy = (
    epicList: Epic[],
    featureList: Feature[],
    storyList: UserStory[]
  ) => {
    const hierarchy = epicList.map((epic) => ({
      epic,
      features: featureList
        .filter((feature) => feature.epicId === epic.id)
        .map((feature) => ({
          feature,
          stories: storyList.filter((story) => story.featureId === feature.id),
        })),
    }));

    const epicIds = new Set(epicList.map((epic) => epic.id));
    const featureIds = new Set(featureList.map((feature) => feature.id));

    const orphanFeatures = featureList.filter(
      (feature) => !epicIds.has(feature.epicId)
    );
    const orphanStories = storyList.filter(
      (story) => !featureIds.has(story.featureId)
    );

    return { hierarchy, orphanFeatures, orphanStories };
  };

  const {
    hierarchy: adoHierarchy,
    orphanFeatures: adoOrphanFeatures,
    orphanStories: adoOrphanStories,
  } = useMemo(
    () => buildHierarchy(adoEpics, adoFeatures, adoStories),
    [adoEpics, adoFeatures, adoStories]
  );

  const {
    hierarchy: dbHierarchy,
    orphanFeatures: dbOrphanFeatures,
    orphanStories: dbOrphanStories,
  } = useMemo(
    () => buildHierarchy(dbEpics, dbFeatures, dbStories),
    [dbEpics, dbFeatures, dbStories]
  );

  const handleSelectAll = () => {
    const allIds = new Set<string>();
    list.forEach((item) => allIds.add(item.id));

    if (selectedItems.size === list.length && list.length > 0) {
      // Deselect all
      setSelectedItems(new Set());
    } else {
      // Select all
      setSelectedItems(allIds);
    }
  };

  const handleEdit = (
    artifact: ArtifactUnion,
    type: "epic" | "feature" | "story"
  ) => {
    setEditArtifact(artifact);
    setEditType(type);
  };

  const handleSave = async (updatedArtifact: ArtifactUnion) => {
    try {
      // Build updated arrays
      let updatedEpics = [...localEpics];
      let updatedFeatures = [...localFeatures];
      let updatedUserStories = [...localUserStories];

      if (editType === "epic") {
        const index = updatedEpics.findIndex(
          (e) => e.id === updatedArtifact.id
        );
        if (index >= 0) {
          updatedEpics[index] = updatedArtifact as Epic;
        }
      } else if (editType === "feature") {
        const index = updatedFeatures.findIndex(
          (f) => f.id === updatedArtifact.id
        );
        if (index >= 0) {
          updatedFeatures[index] = updatedArtifact as Feature;
        }
      } else {
        const index = updatedUserStories.findIndex(
          (s) => s.id === updatedArtifact.id
        );
        if (index >= 0) {
          updatedUserStories[index] = updatedArtifact as UserStory;
        }
      }

      // Update local state immediately for UI feedback
      setLocalEpics(updatedEpics);
      setLocalFeatures(updatedFeatures);
      setLocalUserStories(updatedUserStories);

      // Persist to backend if artifactId is available
      if (artifactId) {
        const response = await fetch(
          getApiUrl(`/api/workflow/artifacts/${artifactId}`),
          {
            method: "PUT",
            headers: {
              "Content-Type": "application/json",
            },
            credentials: "include",
            body: JSON.stringify({
              epics: updatedEpics,
              features: updatedFeatures,
              userStories: updatedUserStories,
            }),
          }
        );

        if (!response.ok) {
          throw new Error("Failed to save changes");
        }

        toast.success("Changes saved successfully!");

        if (isAdoArtifact(updatedArtifact)) {
          await handleSaveADOItem(updatedArtifact, editType);
        }

        // Notify parent to refresh data
        if (onArtifactUpdate) {
          onArtifactUpdate();
        }
      } else {
        toast.success("Changes saved locally");
      }
    } catch (error) {
      console.error("Error saving artifact:", error);
      toast.error("Failed to save changes. Please try again.");
      // Revert local state on error
      setLocalEpics(epics);
      setLocalFeatures(features);
      setLocalUserStories(userStories);
    }
  };

  // Push individual item to ADO with hierarchy validation
  const handlePushItemToADO = async (
    artifact: ArtifactUnion,
    type: "epic" | "feature" | "story"
  ) => {
    if (!projectId) {
      toast.error("Project ID is required");
      return;
    }

    setIsPushingItem(artifact.id);
    setPushProgress(0);
    setPushProgressMessage(`Preparing ${providerName} push...`);
    try {
      // Collect items to push based on hierarchy
      const itemsToPush: {
        epics: Epic[];
        features: Feature[];
        userStories: UserStory[];
      } = {
        epics: [],
        features: [],
        userStories: [],
      };

      const selectedItemsArray: { type: "epic" | "feature" | "story"; id: string }[] = [];

      const addItemToPush = (
        newItem: ArtifactUnion | null | undefined,
        artifactType: "epic" | "feature" | "story",
        includeInSelected: boolean | undefined = true
      ) => {
        if (!newItem) return;

        const list =
          artifactType === "epic"
            ? itemsToPush.epics
            : artifactType === "feature"
            ? itemsToPush.features
            : itemsToPush.userStories;

        if (!list.some((existing) => existing.id === newItem.id)) {
          list.push(newItem as any);
        }

        if (
          includeInSelected &&
          !selectedItemsArray.some(
            (item) => item.type === artifactType && item.id === newItem.id
          )
        ) {
          selectedItemsArray.push({ type: artifactType, id: newItem.id });
        }
      };

      let includedParents = false;

      if (type === "epic") {
        addItemToPush(artifact as Epic, "epic");
      } else if (type === "feature") {
        const feature = artifact as Feature;
        addItemToPush(feature, "feature");

        // Check if parent epic exists in local data
        const parentEpic = localEpics.find((e) => e.id === feature.epicId);
        if (!parentEpic) {
          throw new Error(
            `Cannot push Feature: Parent Epic (${feature.epicId}) not found in database. Please ensure the parent Epic exists in this project.`
          );
        }

        const shouldPushParentEpic = isDbOnlyArtifact(parentEpic);
        addItemToPush(parentEpic, "epic", shouldPushParentEpic);
        if (shouldPushParentEpic) {
          includedParents = true;
        }
      } else if (type === "story") {
        const story = artifact as UserStory;
        addItemToPush(story, "story");

        // Check if parent feature exists in local data
        const parentFeature = localFeatures.find(
          (f) => f.id === story.featureId
        );
        if (!parentFeature) {
          throw new Error(
            `Cannot push User Story: Parent Feature (${story.featureId}) not found in database. Please ensure the parent Feature exists in this project.`
          );
        }

        const shouldPushParentFeature = isDbOnlyArtifact(parentFeature);
        addItemToPush(parentFeature, "feature", shouldPushParentFeature);
        if (shouldPushParentFeature) {
          includedParents = true;
        }

        // Check if parent epic exists in local data
        const parentEpic = localEpics.find((e) => e.id === parentFeature.epicId);
        if (!parentEpic) {
          throw new Error(
            `Cannot push User Story: Parent Epic (${parentFeature.epicId}) not found in database. Please ensure the parent Epic exists in this project.`
          );
        }

        const shouldPushParentEpic = isDbOnlyArtifact(parentEpic);
        addItemToPush(parentEpic, "epic", shouldPushParentEpic);
        if (shouldPushParentEpic) {
          includedParents = true;
        }
      }

      if (includedParents) {
        toast.success("Including parent items to maintain hierarchy", {
          duration: 3000,
        });
      }

      // Fetch brdId from workflow artifact if available
      let brdId = null;
      if (artifactId) {
        try {
          const artifactResponse = await fetch(
            getApiUrl(`/api/workflow/artifacts/${artifactId}`),
            {
              method: "GET",
              credentials: "include",
            }
          );
          if (artifactResponse.ok) {
            const artifactData = await artifactResponse.json();
            const artifact = artifactData.artifact || artifactData;
            brdId = artifact.brdId || null;
          }
        } catch (error) {
          console.warn("[Push] Failed to fetch brdId from artifact:", error);
        }
      }

      const pushEndpoint = isJira
        ? `/api/sdlc/projects/${projectId}/push-to-jira`
        : `/api/sdlc/projects/${projectId}/push-to-ado`;
      const response = await fetch(
        getApiUrl(pushEndpoint),
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          credentials: "include",
          body: JSON.stringify({
            epics: itemsToPush.epics,
            features: itemsToPush.features,
            userStories: itemsToPush.userStories,
            selectedItems: selectedItemsArray,
            artifactId: artifactId || undefined,
            brdId: brdId,
            config:
              adoOrganization && adoProjectName
                ? {
                    organization: adoOrganization,
                    project: adoProjectName,
                  }
                : undefined,
          }),
        }
      );

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const detailedMessage =
          errorData.details ||
          errorData.error ||
          `Failed to push to ${providerName}`;
        throw new Error(detailedMessage);
      }

      let result = await response.json();

      // Async-job pattern: server returns 202 + jobId immediately to avoid
      // AWS API Gateway's 29s timeout. Poll until completion.
      if (response.status === 202 && result?.jobId) {
        const namespace = isJira ? "sdlc-push-to-jira" : "sdlc-push-to-ado";
        result = await pollAsyncJob<typeof result>(namespace, result.jobId, {
          onProgress: (message, percent) => {
            if (message) {
              setPushProgressMessage(message);
              toast.loading(message, { id: "push-progress" });
            }
            if (percent !== undefined) {
              setPushProgress(percent);
            }
          },
        });
        setPushProgress(100);
        setPushProgressMessage(`Finished pushing to ${providerName}.`);
        toast.dismiss("push-progress");
      }

      console.log(`[Push to ${providerShort}] Response:`, {
        success: result.success,
        created: result.created,
        skipped: result.skipped,
        createdItems: result.createdItems,
        skippedItems: result.skippedItems,
      });

      if (result.success) {
        // Check if items were actually created or just skipped
        const createdCount =
          (result.created?.epics || 0) +
          (result.created?.features || 0) +
          (result.created?.userStories || 0);
        const skippedCount =
          (result.skipped?.epics || 0) +
          (result.skipped?.features || 0) +
          (result.skipped?.userStories || 0);

        // Check for items skipped due to missing parents
        const missingParentItems = (result.skippedItems || []).filter(
          (item: any) =>
            item.reason === "missing_parent_epic" ||
            item.reason === "missing_parent_feature"
        );

        if (missingParentItems.length > 0) {
          // Show error for missing parents
          const missingParentMsg = missingParentItems
            .map((item: any) => {
              if (item.reason === "missing_parent_feature") {
                return `Cannot push "${item.title.substring(
                  0,
                  50
                )}..." - Parent Feature (${
                  item.parentFeatureId
                }) not found in database. Please ensure the parent Feature exists.`;
              } else if (item.reason === "missing_parent_epic") {
                return `Cannot push "${item.title.substring(
                  0,
                  50
                )}..." - Parent Epic (${
                  item.parentEpicId
                }) not found in database. Please ensure the parent Epic exists.`;
              }
              return "";
            })
            .join("\n");

          toast.error(`Failed to push:\n${missingParentMsg}`, {
            duration: 10000,
          });
        } else if (createdCount > 0) {
          toast.success(
            `Successfully created ${createdCount} work item(s) in ${providerName}!`
          );
        } else if (skippedCount > 0) {
          toast.success(
            `All ${skippedCount} item(s) already exist in ${providerName}.`
          );
        }

        // Update local state immediately with ADO work item IDs for BOTH created AND skipped items
        // This makes items move from Database to ADO filter instantly
        const createdItemsMap = new Map(
          (result.createdItems || []).map((item: any) => [
            item.id,
            item.adoWorkItemId,
          ])
        );
        const skippedItemsMap = new Map(
          (result.skippedItems || [])
            .filter(
              (item: any) =>
                item.reason === "already_exists" && item.adoWorkItemId
            )
            .map((item: any) => [item.id, item.adoWorkItemId])
        );

        // Merge both maps
        const allItemsMap = new Map([...createdItemsMap, ...skippedItemsMap]);

        if (allItemsMap.size > 0) {
          console.log(
            "[Push to ADO] Updating local state with ADO IDs:",
            Object.fromEntries(allItemsMap)
          );

          // Update epics with ADO work item IDs
          const updatedEpics = localEpics.map((epic) => {
            if (allItemsMap.has(epic.id)) {
              return {
                ...epic,
                adoWorkItemId: allItemsMap.get(epic.id) as number,
              };
            }
            return epic;
          });

          // Update features with ADO work item IDs
          const updatedFeatures = localFeatures.map((feature) => {
            if (allItemsMap.has(feature.id)) {
              return {
                ...feature,
                adoWorkItemId: allItemsMap.get(feature.id) as number,
              };
            }
            return feature;
          });

          // Update user stories with ADO work item IDs
          const updatedUserStories = localUserStories.map((story) => {
            if (allItemsMap.has(story.id)) {
              return {
                ...story,
                adoWorkItemId: allItemsMap.get(story.id) as number,
              };
            }
            return story;
          });

          // Update local state immediately for instant UI feedback
          setLocalEpics(updatedEpics);
          setLocalFeatures(updatedFeatures);
          setLocalUserStories(updatedUserStories);

          console.log("[Push to ADO] Local state updated. New counts:", {
            dbItems: [
              ...updatedEpics,
              ...updatedFeatures,
              ...updatedUserStories,
            ].filter((i: any) => !i._isAdoItem && !i.adoWorkItemId).length,
            adoItems: [
              ...updatedEpics,
              ...updatedFeatures,
              ...updatedUserStories,
            ].filter((i: any) => i._isAdoItem || i.adoWorkItemId).length,
          });
        }

        // Refresh data from parent to ensure consistency
        if (onArtifactUpdate) {
          onArtifactUpdate();
        }
      } else {
        throw new Error(result.error || "Push failed");
      }
    } catch (error) {
      console.error("Error pushing to ADO:", error);
      toast.error(
        error instanceof Error
          ? error.message
          : "Failed to push to Azure DevOps"
      );
    } finally {
      setIsPushingItem(null);
    }
  };

  // Save ADO item (update in Azure DevOps)
  const handleSaveADOItem = async (
    artifact: ArtifactUnion,
    type: "epic" | "feature" | "story"
  ) => {
    if (!projectId) {
      toast.error("Project ID is required");
      return;
    }

    const adoWorkItemId =
      (artifact as any).adoWorkItemId ?? (artifact as any)._adoId;
    if (!adoWorkItemId) {
      toast.error("This item is not linked to Azure DevOps");
      return;
    }

    setIsSavingItem(artifact.id);
    try {
      const response = await fetch(
        getApiUrl(`/api/sdlc/projects/${projectId}/ado-items/${adoWorkItemId}`),
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
          },
          credentials: "include",
          body: JSON.stringify({
            artifact,
            type,
            organization: adoOrganization,
            projectName: adoProjectName,
          }),
        }
      );

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || "Failed to update in Azure DevOps");
      }

      const result = await response.json();

      if (result.success) {
        toast.success("Successfully updated in Azure DevOps!");

        // Refresh data
        if (onArtifactUpdate) {
          onArtifactUpdate();
        }
      } else {
        throw new Error(result.error || "Update failed");
      }
    } catch (error) {
      console.error("Error updating ADO item:", error);
      toast.error(
        error instanceof Error
          ? error.message
          : "Failed to update in Azure DevOps"
      );
    } finally {
      setIsSavingItem(null);
    }
  };

  // Handle delete confirmation dialog
  const handleDeleteClick = (
    artifact: ArtifactUnion,
    type: "epic" | "feature" | "story"
  ) => {
    // Calculate cascade delete impact
    let childCount = 0;
    let cascadeMessage = "";

    if (type === "epic") {
      // Count features and user stories under this epic
      const relatedFeatures = localFeatures.filter(
        (f) => f.epicId === artifact.id
      );
      const relatedStories = localUserStories.filter(
        (s) => s.epicId === artifact.id
      );
      childCount = relatedFeatures.length + relatedStories.length;

      if (childCount > 0) {
        cascadeMessage = ` This will also delete ${relatedFeatures.length} feature(s) and ${relatedStories.length} user story(ies) related to this epic.`;
      }
    } else if (type === "feature") {
      // Count user stories under this feature
      const relatedStories = localUserStories.filter(
        (s) => s.featureId === artifact.id
      );
      childCount = relatedStories.length;

      if (childCount > 0) {
        cascadeMessage = ` This will also delete ${relatedStories.length} user story(ies) related to this feature.`;
      }
    }

    setItemToDelete({ artifact, type, cascadeMessage });
    setDeleteConfirmOpen(true);
  };

  // Execute delete after confirmation
  const handleDeleteConfirm = async () => {
    if (!itemToDelete) return;

    const { artifact, type } = itemToDelete;
    const isAdoItem = isAdoArtifact(artifact);
    const adoWorkItemId =
      (artifact as any).adoWorkItemId ?? (artifact as any)._adoId;

    setDeletingItem(artifact.id);
    setDeleteConfirmOpen(false);

    try {
      if (isAdoItem) {
        // Delete from Azure DevOps
        if (!projectId) {
          throw new Error("Project ID is required");
        }

        // For ADO items synced from Azure, use _adoId
        // For DB items pushed to ADO, use adoWorkItemId
        const workItemId = adoWorkItemId;

        if (!workItemId) {
          console.error("[Delete ADO Item] Missing work item ID:", {
            artifact,
            isAdoItem,
            adoWorkItemId,
          });
          throw new Error(
            "Work Item ID is missing. This item may not be properly synced with Azure DevOps."
          );
        }

        console.log(`[Delete ADO Item] Deleting work item ID: ${workItemId}`);

        const response = await fetch(
          getApiUrl(`/api/sdlc/projects/${projectId}/ado-items/${workItemId}`),
          {
            method: "DELETE",
            headers: {
              "Content-Type": "application/json",
            },
            credentials: "include",
            body: JSON.stringify({
              organization: adoOrganization,
              projectName: adoProjectName,
            }),
          }
        );

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          console.error(`[Delete ADO Item] Failed:`, errorData);
          throw new Error(
            errorData.error ||
              errorData.details ||
              "Failed to delete from Azure DevOps"
          );
        }

        const result = await response.json();
        console.log(`[Delete ADO Item] Success:`, result);

        // Update local state to reflect cascade delete
        if (type === "epic") {
          const epicId = artifact.id;
          setLocalEpics(localEpics.filter((e) => e.id !== epicId));
          setLocalFeatures(localFeatures.filter((f) => f.epicId !== epicId));
          setLocalUserStories(
            localUserStories.filter((s) => s.epicId !== epicId)
          );
        } else if (type === "feature") {
          const featureId = artifact.id;
          setLocalFeatures(localFeatures.filter((f) => f.id !== featureId));
          setLocalUserStories(
            localUserStories.filter((s) => s.featureId !== featureId)
          );
        } else {
          setLocalUserStories(
            localUserStories.filter((s) => s.id !== artifact.id)
          );
        }

        toast.success(`Successfully deleted ${type} from Azure DevOps!`);
      } else {
        // Delete from database only
        if (!artifactId) {
          throw new Error("Artifact ID is required");
        }

        // Get current artifact data
        const response = await fetch(
          getApiUrl(`/api/workflow/artifacts/${artifactId}`),
          {
            method: "GET",
            credentials: "include",
          }
        );

        if (!response.ok) {
          throw new Error("Failed to fetch current artifact data");
        }

        const currentArtifact = await response.json();
        const artifactData = currentArtifact.artifact || currentArtifact;

        // Remove the item from the appropriate array (with CASCADE DELETE)
        let updatedEpics = artifactData.epics || [];
        let updatedFeatures = artifactData.features || [];
        let updatedUserStories = artifactData.userStories || [];

        if (type === "epic") {
          // CASCADE DELETE: Remove epic AND all its features AND all user stories under those features
          const epicId = artifact.id;

          // Find all features under this epic
          const featuresToDelete = updatedFeatures.filter(
            (f: any) => f.epicId === epicId
          );
          const featureIdsToDelete = featuresToDelete.map((f: any) => f.id);

          // Remove the epic
          updatedEpics = updatedEpics.filter((e: any) => e.id !== epicId);

          // Remove all features under this epic
          updatedFeatures = updatedFeatures.filter(
            (f: any) => f.epicId !== epicId
          );

          // Remove all user stories under this epic OR under the deleted features
          updatedUserStories = updatedUserStories.filter(
            (s: any) =>
              s.epicId !== epicId && !featureIdsToDelete.includes(s.featureId)
          );

          console.log(
            `[Cascade Delete Epic] Deleted epic ${epicId}, ${featuresToDelete.length} features, and related user stories`
          );
        } else if (type === "feature") {
          // CASCADE DELETE: Remove feature AND all its user stories
          const featureId = artifact.id;

          // Remove the feature
          updatedFeatures = updatedFeatures.filter(
            (f: any) => f.id !== featureId
          );

          // Remove all user stories under this feature
          updatedUserStories = updatedUserStories.filter(
            (s: any) => s.featureId !== featureId
          );

          console.log(
            `[Cascade Delete Feature] Deleted feature ${featureId} and its user stories`
          );
        } else {
          // Just remove the user story
          updatedUserStories = updatedUserStories.filter(
            (s: any) => s.id !== artifact.id
          );
        }

        // Save updated arrays to database
        const saveResponse = await fetch(
          getApiUrl(`/api/workflow/artifacts/${artifactId}`),
          {
            method: "PUT",
            headers: {
              "Content-Type": "application/json",
            },
            credentials: "include",
            body: JSON.stringify({
              epics: updatedEpics,
              features: updatedFeatures,
              userStories: updatedUserStories,
            }),
          }
        );

        if (!saveResponse.ok) {
          throw new Error("Failed to save changes to database");
        }

        // Update local state immediately
        setLocalEpics(updatedEpics);
        setLocalFeatures(updatedFeatures);
        setLocalUserStories(updatedUserStories);

        // Calculate how many items were deleted
        const originalCounts = {
          epics: (artifactData.epics || []).length,
          features: (artifactData.features || []).length,
          stories: (artifactData.userStories || []).length,
        };
        const newCounts = {
          epics: updatedEpics.length,
          features: updatedFeatures.length,
          stories: updatedUserStories.length,
        };
        const deletedCounts = {
          epics: originalCounts.epics - newCounts.epics,
          features: originalCounts.features - newCounts.features,
          stories: originalCounts.stories - newCounts.stories,
        };

        let successMessage = `Successfully deleted ${type} from database!`;
        if (
          type === "epic" &&
          (deletedCounts.features > 0 || deletedCounts.stories > 0)
        ) {
          successMessage = `Successfully deleted epic and ${deletedCounts.features} feature(s) with ${deletedCounts.stories} user story(ies) from database!`;
        } else if (type === "feature" && deletedCounts.stories > 0) {
          successMessage = `Successfully deleted feature and ${deletedCounts.stories} user story(ies) from database!`;
        }

        toast.success(successMessage);
      }

      // Refresh data from parent
      if (onArtifactUpdate) {
        onArtifactUpdate();
      }
    } catch (error) {
      console.error("Error deleting item:", error);
      toast.error(
        error instanceof Error ? error.message : "Failed to delete item"
      );
    } finally {
      setDeletingItem(null);
      setItemToDelete(null);
    }
  };

  const renderArtifactCard = (
    artifact: any,
    forcedType?: "epics" | "features" | "userstories",
    sectionType?: "ado" | "db",
    indentLevel = 0
  ) => {
    const type = (
      forcedType ||
      (activeTab === "overview"
        ? artifact.persona
          ? "userstories"
          : artifact.epicId
          ? "features"
          : "epics"
        : activeTab)
    ) as "epics" | "features" | "userstories";
    const singularType = toSingularArtifactType(type as any);
    const status = artifact.status || "planned";

    const priorityBadge =
      artifact.priority === "High"
        ? "bg-red-500/15 text-red-500"
        : artifact.priority === "Medium"
        ? "bg-amber-500/15 text-amber-500"
        : "bg-blue-500/15 text-blue-500";

    const isSelected = selectedItems.has(artifact.id);

    const classification =
      sectionType || (isAdoArtifact(artifact) ? "ado" : "db");
    const isAdoItem = classification === "ado";

    const indentStyle =
      indentLevel > 0 ? { marginLeft: `${indentLevel * 1.5}rem` } : undefined;

    return (
      <div
        key={artifact.id}
        className="rounded-xl border border-border bg-card/80 p-4 space-y-3"
        style={indentStyle}
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Checkbox
              checked={isSelected}
              onCheckedChange={() => toggleItemSelection(artifact.id)}
              className="h-4 w-4"
            />
            <Badge className={`${typeColorMap[type]} text-white text-xs`}>
              {type === "epics"
                ? "Epic"
                : type === "features"
                ? "Feature"
                : "User Story"}
            </Badge>
            {isAdoItem ? (
              <Badge
                variant="outline"
                className="text-xs border-blue-500 text-blue-500"
              >
                {providerShort}
              </Badge>
            ) : (
              <Badge
                variant="outline"
                className="text-xs border-orange-500 text-orange-500"
              >
                Draft
              </Badge>
            )}
            {isAdoItem && (artifact.adoWorkItemId || artifact._adoId) && (
              <Badge
                variant="outline"
                className="text-xs border-green-500 text-green-500"
              >
                #{artifact.adoWorkItemId ?? artifact._adoId}
              </Badge>
            )}
            <Badge variant="secondary" className="text-xs capitalize">
              {status}
            </Badge>
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            {type === "userstories" && artifact.storyPoints && (
              <Badge variant="outline">{artifact.storyPoints} pts</Badge>
            )}
            <span>{artifact.id}</span>
          </div>
        </div>

        <div className="space-y-1">
          <h3 className="text-base font-semibold text-foreground">
            {artifact.title}
          </h3>
          {artifact.description && (
            <p
              className={cn(
                "text-sm text-muted-foreground whitespace-pre-line line-clamp-2"
              )}
            >
              {artifact.description}
            </p>
          )}
        </div>

        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Badge className={priorityBadge}>
              {artifact.priority || "medium"}
            </Badge>
            {type === "userstories" && artifact.persona && (
              <span>Persona: {artifact.persona}</span>
            )}
            {type === "features" && artifact.epicId && (
              <span>Epic: {artifact.epicId}</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              className="h-8"
              onClick={() => handleView(artifact, singularType)}
            >
              <Eye className="h-3.5 w-3.5 mr-1" />
              View
            </Button>
            <Button
              size="sm"
              className="h-8"
              onClick={() =>
                handleEdit(
                  artifact,
                  singularType
                )
              }
            >
              <Edit className="h-3.5 w-3.5 mr-1" />
              Edit
            </Button>

            {/* Only show Push button for non-ADO items */}
            {!isAdoItem && (
              // DB Item (not yet in ADO) - Show Push button
              <Button
                size="sm"
                variant="default"
                className="h-8 bg-orange-600 hover:bg-orange-700"
                onClick={() =>
                  handlePushItemToADO(
                    artifact,
                    singularType
                  )
                }
                disabled={isPushingItem === artifact.id}
              >
                {isPushingItem === artifact.id ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                    Pushing...
                  </>
                ) : (
                  <>
                    <Cloud className="h-3.5 w-3.5 mr-1" />
                    Push to {providerShort}
                  </>
                )}
              </Button>
            )}

            {/* Delete button for all items */}
            <Button
              size="sm"
              variant="destructive"
              className="h-8"
              onClick={() =>
                handleDeleteClick(
                  artifact,
                  singularType
                )
              }
              disabled={deletingItem === artifact.id}
            >
              {deletingItem === artifact.id ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                  Deleting...
                </>
              ) : (
                <>
                  <Trash2 className="h-3.5 w-3.5 mr-1" />
                  Delete
                </>
              )}
            </Button>
          </div>
        </div>
        {isPushingItem === artifact.id && (
          <div className="mt-3 rounded-md border border-primary/20 bg-primary/5 p-3">
            <div className="mb-2 flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2 text-xs font-medium">
                <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-primary" />
                <span className="truncate">
                  {pushProgressMessage || `Pushing to ${providerShort}...`}
                </span>
              </div>
              <span className="text-xs font-semibold text-primary">{pushProgress}%</span>
            </div>
            <Progress value={pushProgress} className="h-1.5" />
          </div>
        )}
      </div>
    );
  };

  const renderHierarchySection = (
    title: string,
    hierarchy: {
      epic: Epic;
      features: { feature: Feature; stories: UserStory[] }[];
    }[],
    orphanFeatures: Feature[],
    orphanStories: UserStory[],
    counts: { epics: number; features: number; stories: number },
    sectionType: "ado" | "db"
  ) => {
    const totalCount = counts.epics + counts.features + counts.stories;
    const emptyState = totalCount === 0;

    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <h3 className="text-lg font-semibold text-foreground">{title}</h3>
            <p className="text-sm text-muted-foreground">
              <strong>{counts.epics}</strong> Epics •{" "}
              <strong>{counts.features}</strong> Features •{" "}
              <strong>{counts.stories}</strong> User Stories
            </p>
          </div>
          <Badge
            variant="outline"
            className={
              sectionType === "ado"
                ? "border-blue-500/40 text-blue-500 bg-blue-500/10"
                : "border-orange-500/40 text-orange-500 bg-orange-500/10"
            }
          >
            {sectionType === "ado" ? providerName : "Draft"}
          </Badge>
        </div>

        {emptyState ? (
          <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
            {sectionType === "ado"
              ? `No ${providerName} work items match your current filters.`
              : "No draft items pending push match your current filters."}
          </div>
        ) : (
          <div className="space-y-4">
            {hierarchy.map(({ epic, features }) => (
              <div key={epic.id} className="space-y-3">
                {renderArtifactCard(epic, "epics", sectionType, 0)}
                {features.length === 0 && (
                  <p className="ml-6 text-xs text-muted-foreground">
                    No features linked to this epic.
                  </p>
                )}
                {features.map(({ feature, stories }) => (
                  <div key={feature.id} className="space-y-2">
                    {renderArtifactCard(feature, "features", sectionType, 1)}
                    {stories.length === 0 && (
                      <p className="ml-12 text-xs text-muted-foreground">
                        No user stories linked to this feature.
                      </p>
                    )}
                    {stories.map((story) =>
                      renderArtifactCard(story, "userstories", sectionType, 2)
                    )}
                  </div>
                ))}
              </div>
            ))}
            {orphanFeatures.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase text-muted-foreground">
                  Features without parent epic
                </p>
                {orphanFeatures.map((feature) =>
                  renderArtifactCard(feature, "features", sectionType, 0)
                )}
              </div>
            )}
            {orphanStories.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase text-muted-foreground">
                  User stories without parent feature
                </p>
                {orphanStories.map((story) =>
                  renderArtifactCard(story, "userstories", sectionType, 0)
                )}
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  const counts = {
    epics: epics.length,
    features: features.length,
    userStories: userStories.length,
  };

  return (
    <>
      <GenericModal
        open={open}
        onOpenChange={onOpenChange}
        title="User Stories"
        description={`Workflow Project ${
          projectName || ""
        } • ${new Date().toLocaleString()}`}
        icon={FileText}
        width="1152px"
        maxHeight="90vh"
        contentClassName="space-y-4"
      >
        <div className="flex flex-wrap gap-2 text-sm text-muted-foreground">
          <span>
            <strong className="text-foreground">{counts.epics}</strong> epics
          </span>
          <span>
            <strong className="text-foreground">{counts.features}</strong>{" "}
            features
          </span>
          <span>
            <strong className="text-foreground">{counts.userStories}</strong>{" "}
            user stories
          </span>
        </div>

        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="relative w-full md:w-1/2">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search..."
              className="pl-9"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          <div className="flex gap-2 flex-wrap">
            {statusFilters.map((status) => (
              <Button
                key={status}
                size="sm"
                variant={statusFilter === status ? "default" : "outline"}
                onClick={() => setStatusFilter(status)}
              >
                {status === "all" ? (
                  <>
                    <Filter className="h-3.5 w-3.5 mr-1" /> All
                  </>
                ) : (
                  status.charAt(0).toUpperCase() + status.slice(1)
                )}
              </Button>
            ))}
          </div>
        </div>

        <div className="flex gap-2 flex-wrap items-center">
          {(Object.keys(typeLabelMap) as ArtifactTab[]).map((tab) => (
            <Button
              key={tab}
              size="sm"
              variant={tab === activeTab ? "default" : "ghost"}
              onClick={() => setActiveTab(tab)}
            >
              {typeLabelMap[tab]}
            </Button>
          ))}
        </div>


        <div className="space-y-3 pr-2">
          {/* Linked Items tab - show hierarchical tree */}
          {activeTab === "linked" && (
            <LinkedItemsTree
              epics={filteredEpics}
              features={filteredFeatures}
              userStories={filteredStories}
              selectedItems={selectedItems}
              onSelectionChange={setSelectedItems}
              onEdit={(artifact, type) => handleEdit(artifact, type)}
              onView={(artifact, type) => handleView(artifact, type)}
              showCheckboxes={true}
              showActions={true}
              compact={false}
            />
          )}
          {/* Overview tab - show summary only */}
          {activeTab === "overview" && (
            <div className="rounded-xl border border-border bg-card/80 p-4 space-y-3">
              <div className="flex items-center gap-2">
                <FileText className="h-4 w-4 text-muted-foreground" />
                <h3 className="text-base font-semibold text-foreground">
                  Workflow Artifacts Summary
                </h3>
              </div>
              <div className="text-sm text-muted-foreground space-y-2">
                <p>
                  This project contains the following workflow-generated
                  artifacts:
                </p>
                <ul className="list-disc list-inside space-y-1">
                  <li>
                    <strong>{counts.epics}</strong> epics
                  </li>
                  <li>
                    <strong>{counts.features}</strong> features
                  </li>
                  <li>
                    <strong>{counts.userStories}</strong> user stories
                  </li>
                </ul>
                <p className="text-xs pt-2">
                  Use the tabs above to view and manage each artifact type.
                </p>
              </div>
            </div>
          )}
          {activeTab === "userstories" ? (
            list.length === 0 ? (
              <div className="rounded-lg border border-dashed p-10 text-center text-muted-foreground">
                No user stories match your filters yet.
              </div>
            ) : (
              <div className="space-y-3">
                {list.map((item) => renderArtifactCard(item))}
              </div>
            )
          ) : list.length === 0 &&
            activeTab !== "overview" &&
            activeTab !== "linked" ? (
            <div className="rounded-lg border border-dashed p-10 text-center text-muted-foreground">
              No artifacts match your filters yet.
            </div>
          ) : activeTab !== "overview" && activeTab !== "linked" ? (
            <>{list.map((item) => renderArtifactCard(item))}</>
          ) : null}
        </div>
      </GenericModal>

      <ArtifactEditDialog
        open={!!editArtifact}
        onOpenChange={(open) => {
          if (!open) {
            setEditArtifact(null);
          }
        }}
        artifact={editArtifact}
        artifactType={editType}
        onSave={handleSave}
        artifactId={artifactId}
        projectId={projectId}
        personas={personas}
        onArtifactUpdate={onArtifactUpdate}
      />

      <DevOpsPushModal
        open={devopsPushModalOpen}
        onOpenChange={setDevopsPushModalOpen}
        epics={localEpics.filter(isDbOnlyArtifact)}
        features={localFeatures.filter(isDbOnlyArtifact)}
        userStories={localUserStories.filter(isDbOnlyArtifact)}
        personas={personas}
        artifactId={artifactId}
        selectedItems={selectedItems}
        projectId={projectId}
        adoOrganization={adoOrganization || null}
        adoOrganizationDisplay={adoOrganizationDisplay || null}
        adoProjectName={adoProjectName || projectName || null}
        integrationType={integrationType}
        onSuccess={() => {
          setDevopsPushModalOpen(false);
          setSelectedItems(new Set());
          if (onArtifactUpdate) {
            onArtifactUpdate();
          }
        }}
      />

      <ArtifactDetailsDialog
        open={!!viewArtifact}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) {
            setViewArtifact(null);
          }
        }}
        artifact={viewArtifact?.artifact ?? null}
        type={viewArtifact?.type ?? "story"}
        providerName={providerName}
        providerShort={providerShort}
      />

      <GenericModal
        open={deleteConfirmOpen}
        onOpenChange={setDeleteConfirmOpen}
        title="Confirm Deletion"
        icon={AlertTriangle}
        iconClassName="text-destructive bg-destructive/10"
        width="480px"
        contentClassName="space-y-4 text-sm"
        footerButtons={[
          {
            label: "Cancel",
            variant: "outline",
            onClick: () => setDeleteConfirmOpen(false),
          },
          {
            label: deletingItem ? "Deleting..." : "Delete",
            variant: "destructive",
            onClick: handleDeleteConfirm,
            loading: !!deletingItem,
          },
        ]}
      >
        {itemToDelete && (
          <div className="space-y-4 text-muted-foreground">
            <p>
              Are you sure you want to delete this {itemToDelete.type}?
            </p>
            <div className="rounded-md border border-border p-3 bg-muted/40">
              <p className="font-semibold text-foreground">
                {itemToDelete.artifact.title}
              </p>
            </div>
            {itemToDelete.cascadeMessage && (
              <div className="rounded-md border border-destructive/20 bg-destructive/10 p-3 text-destructive">
                <p className="font-semibold flex items-center gap-1">
                  <AlertTriangle className="h-4 w-4" />
                  Cascade Delete Warning
                </p>
                <p className="mt-1 text-sm">{itemToDelete.cascadeMessage}</p>
              </div>
            )}
            <p className="text-xs">
              {isAdoArtifact(itemToDelete.artifact)
                ? "This will permanently delete the item from Azure DevOps and cannot be undone."
                : "This will permanently delete the item from the database and cannot be undone."}
            </p>
          </div>
        )}
      </GenericModal>
    </>
  );
}

interface ArtifactDetailsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  artifact: ArtifactUnion | null;
  type: "epic" | "feature" | "story";
  providerName: string;
  providerShort: string;
}

const ArtifactDetailsDialog = ({
  open,
  onOpenChange,
  artifact,
  type,
  providerName,
  providerShort,
}: ArtifactDetailsDialogProps) => {
  if (!artifact) {
    return null;
  }

  const isAdoItem = isAdoArtifact(artifact);
  const statusValue =
    typeof (artifact as any).status === "string"
      ? (artifact as any).status.toLowerCase()
      : "";
  const priorityValue =
    typeof (artifact as any).priority === "string"
      ? (artifact as any).priority.toLowerCase()
      : "";

  const statusLabel =
    typeof (artifact as any).status === "string"
      ? (artifact as any).status
      : "Draft";
  const priorityLabel =
    typeof (artifact as any).priority === "string"
      ? (artifact as any).priority
      : "";

  const acceptanceCriteriaArray = Array.isArray(
    (artifact as any).acceptanceCriteria
  )
    ? (artifact as any).acceptanceCriteria
    : null;
  const subtasksArray = Array.isArray((artifact as any).subtasks)
    ? (artifact as any).subtasks
    : null;

  const detailItems: { label: string; value: ReactNode }[] = [
    { label: "Artifact ID", value: artifact.id },
    {
      label: "Source",
      value: isAdoItem ? providerName : "Draft",
    },
  ];

  if ((artifact as any).assignedTo) {
    detailItems.push({
      label: "Assigned To",
      value: (artifact as any).assignedTo,
    });
  }

  if ((artifact as any).persona) {
    detailItems.push({
      label: "Persona",
      value: (artifact as any).persona,
    });
  }

  if ((artifact as any).storyPoints !== undefined) {
    detailItems.push({
      label: "Story Points",
      value: (artifact as any).storyPoints,
    });
  }

  if ((artifact as any).epicId) {
    detailItems.push({
      label: "Epic ID",
      value: (artifact as any).epicId,
    });
  }

  if ((artifact as any).featureId) {
    detailItems.push({
      label: "Feature ID",
      value: (artifact as any).featureId,
    });
  }

  if ((artifact as any)._adoState) {
    detailItems.push({
      label: `${providerShort} State`,
      value: (artifact as any)._adoState,
    });
  }

  const linkItems: { label: string; href?: string; value?: string }[] = [];
  if ((artifact as any).figmaLink) {
    linkItems.push({
      label: "Design Spec",
      href: (artifact as any).figmaLink,
    });
  }
  if ((artifact as any)._adoUrl || (artifact as any).adoWorkItemId) {
    linkItems.push({
      label: `${providerShort} Work Item #${
        (artifact as any)._adoId ?? (artifact as any).adoWorkItemId ?? ""
      }`,
      href: (artifact as any)._adoUrl,
      value: (artifact as any)._adoUrl
        ? undefined
        : `ID ${(artifact as any).adoWorkItemId}`,
    });
  }

  const headerDescription = `${formatDisplayLabel(type)} • ${
    isAdoItem ? providerName : "Draft"
  }`;

  return (
    <GenericModal
      open={open}
      onOpenChange={onOpenChange}
      title={artifact.title}
      description={headerDescription}
      width="1200px"
      maxHeight="75vh"
      contentClassName="space-y-6"
      footerButtons={[
        {
          label: "Close",
          variant: "outline",
          onClick: () => onOpenChange(false),
        },
      ]}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Badge className={cn("text-xs", typeBadgeStyles[type])}>
          {formatDisplayLabel(type)}
        </Badge>
        {priorityLabel && (
          <Badge
            className={cn(
              "text-xs",
              priorityBadgeStyles[priorityValue] ||
                "bg-muted text-foreground border border-border/50"
            )}
          >
            {formatDisplayLabel(priorityLabel)}
          </Badge>
        )}
        {statusLabel && (
          <Badge
            className={cn(
              "text-xs",
              statusBadgeStyles[statusValue] ||
                "bg-muted text-foreground border border-border/50"
            )}
          >
            {formatDisplayLabel(statusLabel)}
          </Badge>
        )}
        {isAdoItem && (
          <Badge variant="outline" className="text-xs border-blue-500/40">
            {providerShort} Item
          </Badge>
        )}
      </div>

      <section>
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Description
        </p>
        <div className="mt-3 rounded-xl border border-border/70 bg-muted/30 p-4 text-sm leading-relaxed text-foreground whitespace-pre-line">
          {(artifact as any).description || "No description provided."}
        </div>
      </section>

      {detailItems.length > 0 && (
        <section>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Key Details
          </p>
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            {detailItems.map((item) => (
              <div key={`${artifact.id}-${item.label}`} className="space-y-1">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/70">
                  {item.label}
                </p>
                <div className="text-sm text-foreground">{item.value}</div>
              </div>
            ))}
          </div>
        </section>
      )}

      <section>
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Acceptance Criteria
        </p>
        {acceptanceCriteriaArray && acceptanceCriteriaArray.length > 0 ? (
          <ul className="mt-3 list-disc space-y-2 rounded-xl border border-border/60 bg-card/40 p-4 pl-6 text-sm text-foreground">
            {acceptanceCriteriaArray.map((criteria: any, index: number) => {
              // Handle descriptive string format (new format)
              let displayText = '';
              
              if (typeof criteria === "string") {
                displayText = criteria;
              } else if (typeof criteria === 'object' && criteria !== null) {
                // For backward compatibility, extract descriptive text
                // If it has given/when/then, combine them into a descriptive statement
                if (criteria.given || criteria.when || criteria.then) {
                  const parts = [];
                  if (criteria.given) parts.push(`Given ${criteria.given}`);
                  if (criteria.when) parts.push(`when ${criteria.when}`);
                  if (criteria.then) parts.push(`then ${criteria.then}`);
                  if (criteria.and) parts.push(`and ${criteria.and}`);
                  displayText = parts.join(', ');
                } else {
                  displayText = criteria.title || criteria.description || Object.values(criteria).filter(v => typeof v === 'string' && v.trim()).join(' ') || `Acceptance Criterion ${index + 1}`;
                }
              } else {
                displayText = `Acceptance Criterion ${index + 1}`;
              }
              
              return <li key={index}>{displayText}</li>;
            })}
          </ul>
        ) : (artifact as any).acceptanceCriteria ? (
          <div className="mt-3 rounded-xl border border-border/60 bg-card/40 p-4 text-sm text-foreground whitespace-pre-line">
            {(artifact as any).acceptanceCriteria}
          </div>
        ) : (
          <p className="mt-3 text-sm text-muted-foreground">
            No acceptance criteria documented.
          </p>
        )}
      </section>

      {type === "story" && (
        <section>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Subtasks
          </p>
          {subtasksArray && subtasksArray.length > 0 ? (
            <ul className="mt-3 list-disc space-y-2 rounded-xl border border-border/60 bg-card/40 p-4 pl-6 text-sm text-foreground">
              {subtasksArray.map((subtask: any, index: number) => (
                <li key={index}>
                  {typeof subtask === "string"
                    ? subtask
                    : subtask?.title || `Subtask ${index + 1}`}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-sm text-muted-foreground">
              No subtasks captured.
            </p>
          )}
        </section>
      )}

      {linkItems.length > 0 && (
        <section>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Links
          </p>
          <div className="mt-3 flex flex-col gap-2 text-sm">
            {linkItems.map((link) => (
              <div
                key={link.label}
                className="flex items-center justify-between rounded-lg border border-border/60 bg-muted/20 px-3 py-2"
              >
                <span className="font-medium text-foreground">
                  {link.label}
                </span>
                {link.href ? (
                  <Button
                    asChild
                    variant="ghost"
                    size="sm"
                    className="h-8 px-3 text-primary"
                  >
                    <a href={link.href} target="_blank" rel="noreferrer">
                      Open <ExternalLink className="ml-1 h-4 w-4" />
                    </a>
                  </Button>
                ) : (
                  <span className="text-xs text-muted-foreground">
                    {link.value}
                  </span>
                )}
              </div>
            ))}
          </div>
        </section>
      )}
    </GenericModal>
  );
};
