import { GenericModal } from "@/components/ui/generic-modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Save,
  Loader2,
  Plus,
  Sparkles,
  ChevronsUpDown,
  Check,
  Clock,
} from "lucide-react";
import { useState, useEffect } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { getApiUrl } from "@/lib/api-config";
import { cn } from "@/lib/utils";
import { AiEnhanceWithDiff } from "@/components/AiEnhanceWithDiff";
import { getDescriptionLocationKey } from "@/config/ai-enhance-locations";

// Utility function to strip HTML tags and decode HTML entities
function stripHtmlAndDecode(html: string): string {
  if (!html) return "";

  const tempDiv = document.createElement("div");
  tempDiv.innerHTML = html;

  let text = tempDiv.textContent || tempDiv.innerText || "";
  text = text
    .replace(/\n\s*\n/g, "\n\n")
    .replace(/[ \t]+/g, " ")
    .trim();

  return text;
}

export interface DetailedWorkItem {
  id: string;
  title: string;
  type: string;
  state: string;
  assignedTo: string;
  createdBy: string;
  createdDate: string;
  changedDate: string;
  description: string;
  acceptanceCriteria: string;
  storyPoints: number | null;
  priority: number | null;
  severity: string | null;
  businessValue: number | null;
  timeCriticality: number | null;
  effort: number | null;
  remainingWork: number | null;
  originalEstimate: number | null;
  completedWork: number | null;
  reproSteps: string;
  tags: string;
  iterationPath: string;
  areaPath: string;
  url: string;
  relations: any[];
}

export interface AdoWorkItemDialogProps {
  mode: "create" | "edit";
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectName: string;
  artifactOrgId?: string;
  organizationUrl?: string;
  projectId?: string;
  organization?: string;
  /**
   * Integration type for the project. When set to "jira" the dialog uses
   * Jira-aware endpoints (assignable users, work-item type list, etc.) and
   * surfaces Jira-flavored toasts/help text. Falls back to URL-based
   * detection (`atlassian.net`) when not provided so existing callers
   * keep working.
   */
  integrationType?: "ado" | "jira";
  /**
   * For Jira projects: the actual issue types available in the project.
   * When provided the work-item-type dropdown will be limited to these
   * (subtasks excluded). Falls back to the hardcoded ADO list when omitted.
   */
  availableIssueTypes?: Array<{
    id: string;
    name: string;
    subtask?: boolean;
  }>;
  workItem?: DetailedWorkItem | null;
  workItemId?: string | null;
  initialWorkItemType?: string;
}

// Allowed type conversions based on Azure DevOps rules
const typeConversionMap: Record<string, string[]> = {
  Epic: ["Feature"],
  Feature: ["Epic"],
  "User Story": ["Bug", "Issue"],
  Bug: ["User Story", "Issue"],
  Task: ["Issue"],
  Issue: ["User Story", "Bug", "Task"],
};

const getConvertibleTypes = (currentType: string | undefined | null) => {
  if (!currentType) return [];
  return typeConversionMap[currentType] || [];
};

export function AdoWorkItemDialog({
  mode,
  open,
  onOpenChange,
  projectName,
  artifactOrgId,
  organizationUrl,
  projectId,
  organization,
  integrationType,
  availableIssueTypes,
  workItem,
  workItemId,
  initialWorkItemType = "User Story",
}: AdoWorkItemDialogProps) {
  const { toast } = useToast();

  // Single source of truth for "is this a Jira project?". Prefer the
  // explicit prop and fall back to URL-based detection so older callers
  // that don't pass integrationType still get the right behavior.
  const isJiraProject =
    integrationType === "jira" ||
    (typeof organizationUrl === "string" &&
      organizationUrl.toLowerCase().includes("atlassian.net"));
  const platformLabel = isJiraProject ? "Jira" : "Azure DevOps";

  // DEBUG: Log dialog context on open (edit mode)
  useEffect(() => {
    if (mode === "edit" && open) {
      // eslint-disable-next-line no-console
      console.log("[DEBUG][AdoWorkItemDialog] Opened in edit mode", {
        workItemId,
        projectName,
        artifactOrgId,
        organizationUrl,
        projectId,
        organization,
      });
    }
  }, [mode, open, workItemId, projectName, artifactOrgId, organizationUrl, projectId, organization]);

  // Fetch work item details if only workItemId is provided (edit mode)
  const { data: fetchedWorkItem, isLoading: isLoadingWorkItem, error: fetchError } = useQuery<DetailedWorkItem | null>({
    queryKey: ["/api/hub/artifacts", projectName, "work-item", workItemId],
    enabled: mode === "edit" && !!workItemId && !workItem && open,
    queryFn: async () => {
      if (!workItemId) return null;
      const params = new URLSearchParams();
      if (artifactOrgId) {
        params.append("artifactOrgId", artifactOrgId);
      } else if (organizationUrl) {
        params.append("organizationUrl", organizationUrl);
      }
      if (projectId) {
  params.append("projectId", projectId);
}
      const basePath = isJiraProject
  ? `/api/hub/artifacts/jira/${projectName}/work-item/${workItemId}`
  : `/api/hub/artifacts/${projectName}/work-item/${workItemId}`;

const url = getApiUrl(
  `${basePath}${params.toString() ? `?${params.toString()}` : ""}`
);
      const response = await apiRequest("GET", url);
      if (!response.ok) throw new Error("Work item not found");
      return response.json();
    },
  });

  // Use either provided workItem or fetchedWorkItem
  const effectiveWorkItem = workItem || fetchedWorkItem;

  const [formData, setFormData] = useState({
    workItemType: initialWorkItemType,
    title: "",
    description: "",
    state: mode === "create" ? "New" : "",
    assignedTo: "",
    storyPoints: "",
    priority: mode === "create" ? "2" : "",
    severity: "",
    businessValue: "",
    timeCriticality: "",
    effort: "",
    remainingWork: "",
    originalEstimate: "",
    completedWork: "",
    acceptanceCriteria: "",
    reproSteps: "",
    tags: "",
    parentId: "",
    childId: "",
  });

  const [parentSearchTerm, setParentSearchTerm] = useState("");
  const [childSearchTerm, setChildSearchTerm] = useState("");
  const [parentComboboxOpen, setParentComboboxOpen] = useState(false);
  const [childComboboxOpen, setChildComboboxOpen] = useState(false);
  const isEditingWithFetchedItem = mode === "edit" && !!workItemId && !workItem;
  const showFetchedItemLoading = isEditingWithFetchedItem && isLoadingWorkItem;
  const showFetchedItemError = isEditingWithFetchedItem && !!fetchError;

  // Assignee dropdown source.
  // - ADO:  /api/hub/artifacts/:project/team-members      (existing endpoint)
  // - Jira: /api/hub/artifacts/jira/:project/users        (calls Jira's
  //         /user/assignable/search and returns accountIds)
  //
  // We normalize both into a common shape:
  //   { id, displayName, value }
  // where `value` is what we store in formData.assignedTo and send to the
  // server (displayName for ADO, accountId for Jira).
  type AssigneeOption = {
    id: string;
    displayName: string;
    value: string;
    emailAddress?: string;
  };

  const { data: assigneeOptions = [] } = useQuery<AssigneeOption[]>({
    queryKey: [
      "/api/hub/artifacts",
      projectName,
      "assignees",
      isJiraProject ? "jira" : "ado",
      artifactOrgId,
      organizationUrl,
      projectId,
    ],
    enabled: open && !!projectName,
    queryFn: async () => {
      if (isJiraProject) {
        if (!projectId) return [];
        const params = new URLSearchParams({ projectId });
        const url = getApiUrl(
          `/api/hub/artifacts/jira/${projectName}/users?${params.toString()}`,
        );
        const response = await apiRequest("GET", url);
        if (!response.ok) {
          throw new Error("Failed to fetch Jira users");
        }
        const json = (await response.json()) as {
          users?: Array<{
            accountId: string;
            displayName: string;
            emailAddress?: string;
            active?: boolean;
          }>;
        };
        return (json.users || [])
          .filter((u) => u.active !== false)
          .map<AssigneeOption>((u) => ({
            id: u.accountId,
            displayName: u.displayName,
            emailAddress: u.emailAddress,
            value: u.accountId,
          }));
      }

      const params = new URLSearchParams();
      if (artifactOrgId) {
        params.append("artifactOrgId", artifactOrgId);
      } else if (organizationUrl) {
        params.append("organizationUrl", organizationUrl);
      }
      const url = getApiUrl(
        `/api/hub/artifacts/${projectName}/team-members${
          params.toString() ? `?${params.toString()}` : ""
        }`,
      );
      const response = await apiRequest("GET", url);
      if (!response.ok) {
        throw new Error("Failed to fetch team members");
      }
      const json = (await response.json()) as {
        members?: Array<{
          displayName: string;
          uniqueName: string;
          id: string;
        }>;
      };
      return (json.members || []).map<AssigneeOption>((m) => ({
        id: m.id,
        displayName: m.displayName,
        value: m.displayName,
      }));
    },
  });

  // Build autocomplete URL for parent/child search (only for create mode)
  const buildAutocompleteUrl = (search: string) => {
    const params = new URLSearchParams();
    if (artifactOrgId) {
      params.append("artifactOrgId", artifactOrgId);
    } else if (organizationUrl) {
      params.append("organizationUrl", organizationUrl);
    }
    if (search.trim()) {
      params.append("search", search.trim());
    }
    return getApiUrl(
      `/api/hub/artifacts/${projectName}/work-items/autocomplete${
        params.toString() ? `?${params.toString()}` : ""
      }`
    );
  };

  const { data: parentOptions = [], isLoading: isLoadingParent } = useQuery<
    Array<{ id: string; title: string; type: string; state: string }>
  >({
    queryKey: [
      "/api/hub/artifacts/autocomplete/parent",
      projectName,
      artifactOrgId,
      organizationUrl,
      parentSearchTerm,
    ],
    enabled: mode === "create" && open && parentComboboxOpen && !!projectName,
    queryFn: async () => {
      const url = buildAutocompleteUrl(parentSearchTerm);
      const response = await apiRequest("GET", url);
      if (!response.ok) {
        throw new Error("Failed to fetch work items");
      }
      return response.json();
    },
  });

  const { data: childOptions = [], isLoading: isLoadingChild } = useQuery<
    Array<{ id: string; title: string; type: string; state: string }>
  >({
    queryKey: [
      "/api/hub/artifacts/autocomplete/child",
      projectName,
      artifactOrgId,
      organizationUrl,
      childSearchTerm,
    ],
    enabled: mode === "create" && open && childComboboxOpen && !!projectName,
    queryFn: async () => {
      const url = buildAutocompleteUrl(childSearchTerm);
      const response = await apiRequest("GET", url);
      if (!response.ok) {
        throw new Error("Failed to fetch work items");
      }
      return response.json();
    },
  });

  // Initialize form data based on mode
  useEffect(() => {
    if (mode === "edit" && effectiveWorkItem && open) {
      const assignedToValue =
        effectiveWorkItem.assignedTo && effectiveWorkItem.assignedTo !== "Unassigned"
          ? effectiveWorkItem.assignedTo
          : "";

      setFormData({
        workItemType: effectiveWorkItem.type || "",
        title: effectiveWorkItem.title || "",
        description: stripHtmlAndDecode(effectiveWorkItem.description || ""),
        state: effectiveWorkItem.state || "",
        assignedTo: assignedToValue,
        storyPoints: effectiveWorkItem.storyPoints?.toString() || "",
        priority: effectiveWorkItem.priority?.toString() || "",
        severity: effectiveWorkItem.severity || "",
        businessValue: effectiveWorkItem.businessValue?.toString() || "",
        timeCriticality: effectiveWorkItem.timeCriticality?.toString() || "",
        effort: effectiveWorkItem.effort?.toString() || "",
        remainingWork: effectiveWorkItem.remainingWork?.toString() || "",
        originalEstimate: effectiveWorkItem.originalEstimate?.toString() || "",
        completedWork: effectiveWorkItem.completedWork?.toString() || "",
        acceptanceCriteria: stripHtmlAndDecode(
          effectiveWorkItem.acceptanceCriteria || ""
        ),
        reproSteps: stripHtmlAndDecode(effectiveWorkItem.reproSteps || ""),
        tags: effectiveWorkItem.tags || "",
        parentId: "",
        childId: "",
      });
    } else if (mode === "create" && open) {
      // Reset to defaults for create mode
      setFormData({
        workItemType: initialWorkItemType,
        title: "",
        description: "",
        state: "New",
        assignedTo: "",
        storyPoints: "",
        priority: "2",
        severity: "",
        businessValue: "",
        timeCriticality: "",
        effort: "",
        remainingWork: "",
        originalEstimate: "",
        completedWork: "",
        acceptanceCriteria: "",
        reproSteps: "",
        tags: "",
        parentId: "",
        childId: "",
      });
    }
  }, [mode, effectiveWorkItem, open, initialWorkItemType]);

  // Jira create mode: when the project doesn't have "User Story" (or
  // whatever initialWorkItemType is), pick the first non-subtask issue
  // type that actually exists so the dropdown isn't showing a value with
  // no matching option.
  useEffect(() => {
    if (
      !isJiraProject ||
      mode !== "create" ||
      !open ||
      !availableIssueTypes ||
      availableIssueTypes.length === 0
    ) {
      return;
    }
    const usable = availableIssueTypes.filter(
      (t) =>
        !t.subtask &&
        !["sub-task", "subtask"].includes((t.name || "").toLowerCase().trim()),
    );
    if (usable.length === 0) return;
    if (usable.some((t) => t.name === formData.workItemType)) return;
    setFormData((prev) => ({ ...prev, workItemType: usable[0].name }));
  }, [isJiraProject, mode, open, availableIssueTypes, formData.workItemType]);

  // Jira edit mode only: the work item's assignedTo from the API is a display
  // name or email, but the dropdown options for Jira use accountId as the
  // value. Once the assignable-users list loads, resolve the current
  // assignedTo to an accountId so the Select shows the right user — and so
  // we send a real accountId on save instead of a stray display name.
  useEffect(() => {
    if (
      !isJiraProject ||
      mode !== "edit" ||
      !open ||
      !formData.assignedTo ||
      assigneeOptions.length === 0
    ) {
      return;
    }
    // Already an accountId in the option set → nothing to do.
    if (assigneeOptions.some((o) => o.value === formData.assignedTo)) return;

    const target = formData.assignedTo.trim().toLowerCase();
    const match = assigneeOptions.find(
      (o) =>
        o.displayName.trim().toLowerCase() === target ||
        (o.emailAddress && o.emailAddress.trim().toLowerCase() === target),
    );
    if (match) {
      setFormData((prev) => ({ ...prev, assignedTo: match.value }));
    }
  }, [isJiraProject, mode, open, assigneeOptions, formData.assignedTo]);

  // AI enhance mutation
  const aiEnhanceMutation = useMutation({
    mutationFn: async ({
      fieldType,
      currentText,
      title,
    }: {
      fieldType: string;
      currentText: string;
      title: string;
    }) => {
      const response = await apiRequest("POST", "/api/ai/enhance-text", {
        title: title,
        currentText: currentText || "",
        fieldType: fieldType,
        itemType: formData.workItemType,
      });
      return await response.json();
    },
    onSuccess: (data, variables) => {
      const fieldKey = variables.fieldType as keyof typeof formData;
      if (fieldKey in formData) {
        setFormData((prev) => ({ ...prev, [fieldKey]: data.enhancedText }));
        toast({
          title: "Text Enhanced",
          description: `AI has improved your ${variables.fieldType}`,
        });
      }
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: `Failed to enhance text: ${
          error.message || "Unknown error"
        }`,
        variant: "destructive",
      });
    },
  });

  // Create mutation
  const createMutation = useMutation({
    mutationFn: async (data: any) => {
      const params = new URLSearchParams();
      if (artifactOrgId) {
        params.append("artifactOrgId", artifactOrgId);
      } else if (organizationUrl) {
        params.append("organizationUrl", organizationUrl);
      }
      if (projectName) {
        params.append("project", projectName);
      }
      if (projectId) {
        params.append("projectId", projectId);
      }
      if (organization) {
        params.append("organization", organization);
      }
      const url = `/api/hub/artifacts/${projectName}/work-item${
        params.toString() ? `?${params.toString()}` : ""
      }`;
      const response = await apiRequest("POST", url, data);
      return await response.json();
    },
    onSuccess: (created: any) => {
      queryClient.invalidateQueries({
        queryKey: [
          `/api/hub/artifacts/${projectName}/work-items`,
          artifactOrgId,
          organizationUrl,
        ],
      });

      const ref = created?.key || created?.id;
      toast({
        title: "Work Item Created",
        description: ref
          ? `Work item ${isJiraProject ? ref : `#${ref}`} created successfully in ${platformLabel}.`
          : `Work item created successfully in ${platformLabel}.`,
      });
      onOpenChange(false);
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to create work item",
        variant: "destructive",
      });
    },
  });

  // Update mutation
  const updateMutation = useMutation({
    mutationFn: async (data: any) => {
      const params = new URLSearchParams();
      if (artifactOrgId) {
        params.append("artifactOrgId", artifactOrgId);
      } else if (organizationUrl) {
        params.append("organizationUrl", organizationUrl);
      }
      // Ensure projectId or project is always sent
      if (projectId) {
        params.append("projectId", projectId);
      } else if (projectName) {
        params.append("project", projectName);
      }
      const targetWorkItemId = effectiveWorkItem?.id || workItemId;
      const url = `/api/hub/artifacts/${projectName}/work-item/${targetWorkItemId}${
        params.toString() ? `?${params.toString()}` : ""
      }`;
      const response = await apiRequest("PATCH", url, data);
      return await response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: [
          `/api/hub/artifacts/${projectName}/work-items`,
          artifactOrgId,
          organizationUrl,
        ],
      });
      queryClient.invalidateQueries({
        queryKey: [
          `/api/hub/artifacts/${projectName}/work-item/${
            effectiveWorkItem?.id || workItemId
          }`,
        ],
      });

      toast({
        title: "Success",
        description: `Work item updated successfully in ${platformLabel}`,
      });
      onOpenChange(false);
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update work item",
        variant: "destructive",
      });
    },
  });

  const validateLinkedId = async (id: string, label: "Parent" | "Child") => {
    const trimmed = id.trim();
    // ADO uses numeric IDs (e.g. 1234). Jira uses keys like "PROJ-123".
    const adoIdPattern = /^\d+$/;
    const jiraKeyPattern = /^[A-Za-z][A-Za-z0-9_]+-\d+$/;
    const valid = isJiraProject
      ? jiraKeyPattern.test(trimmed) || adoIdPattern.test(trimmed)
      : adoIdPattern.test(trimmed);
    if (!valid) {
      toast({
        title: "Invalid ID",
        description: isJiraProject
          ? `${label} ID must be a Jira issue key (e.g. PROJ-123) or numeric ID.`
          : `${label} ID must be a numeric Azure DevOps work item ID.`,
        variant: "destructive",
      });
      return false;
    }

    const params = new URLSearchParams();
    if (artifactOrgId) {
      params.append("artifactOrgId", artifactOrgId);
    } else if (organizationUrl) {
      params.append("organizationUrl", organizationUrl);
    }

    const url = getApiUrl(
      `/api/hub/artifacts/${projectName}/work-item/${trimmed}${
        params.toString() ? `?${params.toString()}` : ""
      }`
    );

    try {
      const res = await apiRequest("GET", url);
      if (!res.ok) {
        toast({
          title: "Invalid ID",
          description: `${label} work item #${trimmed} was not found for this project.`,
          variant: "destructive",
        });
        return false;
      }
      return true;
    } catch {
      toast({
        title: "Validation failed",
        description: `Could not validate ${label.toLowerCase()} ID. Please try again.`,
        variant: "destructive",
      });
      return false;
    }
  };

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) {
      e.preventDefault();
    }

    if (!formData.title.trim()) {
      toast({
        title: "Error",
        description: "Title is required",
        variant: "destructive",
      });
      return;
    }

    if (mode === "create") {
      // Validate parent/child IDs if provided
      if (
        formData.parentId &&
        !(await validateLinkedId(formData.parentId, "Parent"))
      ) {
        return;
      }
      if (
        formData.childId &&
        !(await validateLinkedId(formData.childId, "Child"))
      ) {
        return;
      }

      const createData: any = {
        workItemType: formData.workItemType,
        title: formData.title.trim(),
      };

      if (formData.description) createData.description = formData.description;
      if (formData.state) createData.state = formData.state;
      if (
        formData.assignedTo &&
        formData.assignedTo.trim() !== "" &&
        formData.assignedTo !== "Unassigned"
      ) {
        createData.assignedTo = formData.assignedTo.trim();
      }
      if (formData.storyPoints !== "" && formData.storyPoints !== null) {
        createData.storyPoints = parseFloat(formData.storyPoints);
      }
      if (formData.priority !== "" && formData.priority !== null) {
        createData.priority = parseInt(formData.priority);
      }
      if (formData.severity) createData.severity = formData.severity;
      if (formData.businessValue !== "" && formData.businessValue !== null) {
        createData.businessValue = parseFloat(formData.businessValue);
      }
      if (
        formData.timeCriticality !== "" &&
        formData.timeCriticality !== null
      ) {
        createData.timeCriticality = parseFloat(formData.timeCriticality);
      }
      if (formData.effort !== "" && formData.effort !== null) {
        createData.effort = parseFloat(formData.effort);
      }
      if (formData.remainingWork !== "" && formData.remainingWork !== null) {
        createData.remainingWork = parseFloat(formData.remainingWork);
      }
      if (
        formData.originalEstimate !== "" &&
        formData.originalEstimate !== null
      ) {
        createData.originalEstimate = parseFloat(formData.originalEstimate);
      }
      if (formData.completedWork !== "" && formData.completedWork !== null) {
        createData.completedWork = parseFloat(formData.completedWork);
      }
      if (formData.acceptanceCriteria)
        createData.acceptanceCriteria = formData.acceptanceCriteria;
      if (formData.reproSteps) createData.reproSteps = formData.reproSteps;
      if (formData.tags) createData.tags = formData.tags;
      if (formData.parentId && formData.parentId.trim() !== "") {
        createData.parentId = formData.parentId.trim();
      }
      if (formData.childId && formData.childId.trim() !== "") {
        createData.childId = formData.childId.trim();
      }

      createMutation.mutate(createData);
    } else {
      // Edit mode
      const updateData: any = {};

      const workItemTypeChanged =
        formData.workItemType &&
        formData.workItemType !== effectiveWorkItem?.type;

      if (workItemTypeChanged) {
        updateData.workItemType = formData.workItemType;
      }

      if (formData.title) updateData.title = formData.title;
      if (formData.description !== undefined)
        updateData.description = formData.description;

      if (!workItemTypeChanged && formData.state) {
        updateData.state = formData.state;
      }

      if (
        formData.assignedTo &&
        formData.assignedTo.trim() !== "" &&
        formData.assignedTo !== "Unassigned"
      ) {
        updateData.assignedTo = formData.assignedTo.trim();
      }

      if (formData.storyPoints !== "" && formData.storyPoints !== null) {
        updateData.storyPoints = parseFloat(formData.storyPoints);
      }
      if (formData.priority !== "" && formData.priority !== null) {
        updateData.priority = parseInt(formData.priority);
      }
      if (formData.severity) updateData.severity = formData.severity;
      if (formData.businessValue !== "" && formData.businessValue !== null) {
        updateData.businessValue = parseFloat(formData.businessValue);
      }
      if (
        formData.timeCriticality !== "" &&
        formData.timeCriticality !== null
      ) {
        updateData.timeCriticality = parseFloat(formData.timeCriticality);
      }
      if (formData.effort !== "" && formData.effort !== null) {
        updateData.effort = parseFloat(formData.effort);
      }

      if (formData.remainingWork !== "" && formData.remainingWork !== null) {
        updateData.remainingWork = parseFloat(formData.remainingWork);
      }
      if (
        formData.originalEstimate !== "" &&
        formData.originalEstimate !== null
      ) {
        updateData.originalEstimate = parseFloat(formData.originalEstimate);
      }
      if (formData.completedWork !== "" && formData.completedWork !== null) {
        updateData.completedWork = parseFloat(formData.completedWork);
      }

      if (formData.acceptanceCriteria !== undefined)
        updateData.acceptanceCriteria = formData.acceptanceCriteria;
      if (formData.reproSteps !== undefined)
        updateData.reproSteps = formData.reproSteps;
      if (formData.tags !== undefined) updateData.tags = formData.tags;

      updateMutation.mutate(updateData);
    }
  };

  const isUserStory = formData.workItemType === "User Story";
  const isEpicOrFeature =
    formData.workItemType === "Epic" || formData.workItemType === "Feature";
  const isBug = formData.workItemType === "Bug";
  const isTaskOrIssue =
    formData.workItemType === "Task" || formData.workItemType === "Issue";

  const currentMutation = mode === "create" ? createMutation : updateMutation;
  const isPending = currentMutation.isPending;
  const canSubmit =
    mode === "create"
      ? formData.title.trim()
      : formData.title.trim() && effectiveWorkItem;

  const modalTitle =
    mode === "create"
      ? "Create New Work Item"
      : effectiveWorkItem
      ? `Edit ${effectiveWorkItem.type} - ${effectiveWorkItem.id}`
      : "Loading work item...";

  const modalIcon = mode === "create" ? Plus : Clock;

  return (
    <GenericModal
      open={open}
      onOpenChange={onOpenChange}
      title={modalTitle}
      icon={modalIcon}
      //width="768px"
      maxHeight="90vh"
      contentClassName="space-y-4"
      closeOnOverlayClick={false}
      footerButtons={[
        {
          label: "Cancel",
          onClick: () => onOpenChange(false),
          variant: "outline",
          disabled: isPending,
        },
        {
          label: isPending
            ? mode === "create"
              ? "Creating..."
              : "Updating..."
            : mode === "create"
            ? "Create Work Item"
            : "Save Changes",
          onClick: handleSubmit,
          variant: "default",
          disabled: isPending || !canSubmit,
          loading: isPending,
        },
      ]}
    >
      {showFetchedItemError ? (
        <div className="p-4 text-destructive">
          Error: The requested resource could not be found.
        </div>
      ) : showFetchedItemLoading || (mode === "edit" && !effectiveWorkItem) ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 mr-2 animate-spin text-muted-foreground" />
          <span className="text-sm text-muted-foreground">
            Loading work item details...
          </span>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Work Item Type */}
          <div className="space-y-2">
            <Label htmlFor="workItemType">
              Work Item Type {mode === "create" && "*"}
            </Label>
            <Select
              value={
                formData.workItemType ||
                (mode === "edit"
                  ? effectiveWorkItem?.type
                  : initialWorkItemType)
              }
              onValueChange={(value) =>
                setFormData((prev) => ({ ...prev, workItemType: value }))
              }
            >
              <SelectTrigger id="workItemType">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {mode === "edit" && effectiveWorkItem?.type && (
                  <SelectItem value={effectiveWorkItem.type}>
                    {effectiveWorkItem.type} (current)
                  </SelectItem>
                )}
                {mode === "edit" ? (
                  // Show convertible types for edit
                  getConvertibleTypes(effectiveWorkItem?.type).map((type) => (
                    <SelectItem key={type} value={type}>
                      {type}
                    </SelectItem>
                  ))
                ) : isJiraProject &&
                  availableIssueTypes &&
                  availableIssueTypes.length > 0 ? (
                  // Jira: only show types that actually exist in this project.
                  // Sub-tasks are excluded — they're created from a parent
                  // story, not as a top-level item.
                  availableIssueTypes
                    .filter(
                      (t) =>
                        !t.subtask &&
                        !["sub-task", "subtask"].includes(
                          (t.name || "").toLowerCase().trim(),
                        ),
                    )
                    .map((t) => (
                      <SelectItem key={t.id} value={t.name}>
                        {t.name}
                      </SelectItem>
                    ))
                ) : (
                  // ADO (or Jira fallback when types haven't loaded yet)
                  <>
                    <SelectItem value="User Story">User Story</SelectItem>
                    <SelectItem value="Task">Task</SelectItem>
                    <SelectItem value="Bug">Bug</SelectItem>
                    <SelectItem value="Epic">Epic</SelectItem>
                    <SelectItem value="Feature">Feature</SelectItem>
                    <SelectItem value="Issue">Issue</SelectItem>
                  </>
                )}
              </SelectContent>
            </Select>
            {mode === "edit" && (
              <p className="text-xs text-muted-foreground">
                Change the {platformLabel} work item type (for example, convert
                an Epic to a Feature or User Story) according to your
                project&apos;s process configuration.
              </p>
            )}
          </div>

          {/* Title */}
          <div className="space-y-2">
            <Label htmlFor="title">Title *</Label>
            <Input
              id="title"
              value={formData.title}
              onChange={(e) =>
                setFormData({ ...formData, title: e.target.value })
              }
              required
              placeholder="Enter work item title..."
            />
          </div>

              {/* Description */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="description">Description</Label>
                  <AiEnhanceWithDiff
                    locationKey={getDescriptionLocationKey(formData.workItemType)}
                    value={formData.description}
                    onEnhanced={(enhancedText) => setFormData({ ...formData, description: enhancedText })}
                    placeholderExtraPrompt="Add any additional instructions for enhancing the description (optional)..."
                    itemName="Description"
                  />
                </div>
                <Textarea
                  id="description"
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  rows={18}
                  className="resize-y min-h-[45vh] break-words whitespace-pre-wrap"
                  placeholder="Enter description..."
                />
              </div>

          {/* State and Priority */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="state">State</Label>
              <Select
                value={formData.state}
                onValueChange={(value) =>
                  setFormData({ ...formData, state: value })
                }
              >
                <SelectTrigger id="state">
                  <SelectValue placeholder="Select state" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="New">New</SelectItem>
                  <SelectItem value="Active">Active</SelectItem>
                  <SelectItem value="Resolved">Resolved</SelectItem>
                  <SelectItem value="Closed">Closed</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="priority">
                Priority (1=High, 2=Medium, 3=Low, 4=Lowest)
              </Label>
              <Input
                id="priority"
                type="number"
                min="1"
                max="4"
                value={formData.priority}
                onChange={(e) =>
                  setFormData({ ...formData, priority: e.target.value })
                }
                placeholder="1-4"
              />
            </div>
          </div>

          {/* Assigned To */}
          <div className="space-y-2">
            <Label htmlFor="assignedTo">Assigned To</Label>
            <Select
              value={formData.assignedTo || "unassigned"}
              onValueChange={(value) =>
                setFormData({
                  ...formData,
                  assignedTo: value === "unassigned" ? "" : value,
                })
              }
            >
              <SelectTrigger id="assignedTo">
                <SelectValue
                  placeholder={
                    isJiraProject ? "Select Jira user" : "Select team member"
                  }
                />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="unassigned">Unassigned</SelectItem>
                {assigneeOptions.map((opt) => (
                  <SelectItem key={opt.id} value={opt.value}>
                    {opt.displayName}
                    {opt.emailAddress ? (
                      <span className="text-xs text-muted-foreground ml-1.5">
                        ({opt.emailAddress})
                      </span>
                    ) : null}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {isJiraProject && assigneeOptions.length === 0 && (
              <p className="text-xs text-muted-foreground">
                No assignable Jira users found. The configured account may
                lack the &ldquo;Browse users&rdquo; global permission, or the
                project has no assignable users.
              </p>
            )}
          </div>

          {/* Time Tracking Fields */}
          <div className="border-t pt-4 space-y-4">
            <h3 className="text-sm font-semibold flex items-center gap-2">
              <Clock className="h-4 w-4" />
              Time Tracking
            </h3>

            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label htmlFor="originalEstimate">
                  Original Estimate (hours)
                </Label>
                <Input
                  id="originalEstimate"
                  type="number"
                  step="0.5"
                  min="0"
                  value={formData.originalEstimate}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      originalEstimate: e.target.value,
                    })
                  }
                  placeholder="0"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="remainingWork">Remaining Work (hours)</Label>
                <Input
                  id="remainingWork"
                  type="number"
                  step="0.5"
                  min="0"
                  value={formData.remainingWork}
                  onChange={(e) =>
                    setFormData({ ...formData, remainingWork: e.target.value })
                  }
                  placeholder="0"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="completedWork">Completed Work (hours)</Label>
                <Input
                  id="completedWork"
                  type="number"
                  step="0.5"
                  min="0"
                  value={formData.completedWork}
                  onChange={(e) =>
                    setFormData({ ...formData, completedWork: e.target.value })
                  }
                  placeholder="0"
                />
              </div>
            </div>
          </div>

          {/* Type-specific fields */}
          {isUserStory && (
            <>
              <div className="space-y-2">
                <Label htmlFor="storyPoints">Story Points</Label>
                <Input
                  id="storyPoints"
                  type="number"
                  min="0"
                  max="100"
                  value={formData.storyPoints}
                  onChange={(e) =>
                    setFormData({ ...formData, storyPoints: e.target.value })
                  }
                  placeholder="0"
                />
              </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label htmlFor="acceptanceCriteria">Acceptance Criteria</Label>
                      <AiEnhanceWithDiff
                        locationKey="ado.acceptanceCriteria"
                        value={formData.acceptanceCriteria}
                        onEnhanced={(enhancedText) => setFormData({ ...formData, acceptanceCriteria: enhancedText })}
                        placeholderExtraPrompt="Add any additional instructions for enhancing the acceptance criteria (optional)..."
                        itemName="Acceptance Criteria"
                      />
                    </div>
                    <Textarea
                      id="acceptanceCriteria"
                      value={formData.acceptanceCriteria}
                      onChange={(e) => setFormData({ ...formData, acceptanceCriteria: e.target.value })}
                      rows={6}
                      className="resize-y min-h-[120px] break-words whitespace-pre-wrap"
                      placeholder="Enter acceptance criteria..."
                    />
                  </div>
                </>
              )}

          {isEpicOrFeature && (
            <>
              <div className="space-y-2">
                <Label htmlFor="businessValue">Business Value</Label>
                <Input
                  id="businessValue"
                  type="number"
                  min="0"
                  max="100"
                  value={formData.businessValue}
                  onChange={(e) =>
                    setFormData({ ...formData, businessValue: e.target.value })
                  }
                  placeholder="0"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="timeCriticality">Time Criticality</Label>
                  <Input
                    id="timeCriticality"
                    type="number"
                    min="0"
                    max="100"
                    value={formData.timeCriticality}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        timeCriticality: e.target.value,
                      })
                    }
                    placeholder="0"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="effort">Effort</Label>
                  <Input
                    id="effort"
                    type="number"
                    min="0"
                    max="100"
                    value={formData.effort}
                    onChange={(e) =>
                      setFormData({ ...formData, effort: e.target.value })
                    }
                    placeholder="0"
                  />
                </div>
              </div>
            </>
          )}

          {isBug && (
            <>
              <div className="space-y-2">
                <Label htmlFor="severity">Severity</Label>
                <Input
                  id="severity"
                  value={formData.severity}
                  onChange={(e) =>
                    setFormData({ ...formData, severity: e.target.value })
                  }
                  placeholder="e.g., 1 - Critical, 2 - High, 3 - Medium, 4 - Low"
                />
              </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label htmlFor="reproSteps">Repro Steps</Label>
                      <AiEnhanceWithDiff
                        locationKey="ado.reproSteps"
                        value={formData.reproSteps}
                        onEnhanced={(enhancedText) => setFormData({ ...formData, reproSteps: enhancedText })}
                        placeholderExtraPrompt="Add any additional instructions for enhancing the reproduction steps (optional)..."
                        itemName="Reproduction Steps"
                      />
                    </div>
                    <Textarea
                      id="reproSteps"
                      value={formData.reproSteps}
                      onChange={(e) => setFormData({ ...formData, reproSteps: e.target.value })}
                      rows={6}
                      className="resize-y min-h-[120px] break-words whitespace-pre-wrap"
                      placeholder="Enter reproduction steps..."
                    />
                  </div>
                </>
              )}

          {/* Tags */}
          <div className="space-y-2">
            <Label htmlFor="tags">Tags (semicolon-separated)</Label>
            <Input
              id="tags"
              value={formData.tags}
              onChange={(e) =>
                setFormData({ ...formData, tags: e.target.value })
              }
              placeholder="tag1; tag2; tag3"
            />
          </div>

          {/* Parent/Child links - only for create mode */}
          {mode === "create" && (
            <div className="grid grid-cols-2 gap-4 border-t pt-4">
              <div className="space-y-2">
                <Label htmlFor="parentId">Parent ID (optional)</Label>
                <Popover
                  open={parentComboboxOpen}
                  onOpenChange={(open) => {
                    setParentComboboxOpen(open);
                    if (!open) {
                      setParentSearchTerm("");
                    }
                  }}
                >
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      role="combobox"
                      aria-expanded={parentComboboxOpen}
                      className="w-full justify-between"
                    >
                      {formData.parentId
                        ? `#${formData.parentId}`
                        : "Select or type work item ID..."}
                      <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0 max-h-80">
                    <Command
                      shouldFilter={false}
                      className="flex flex-col h-full"
                    >
                      <CommandInput
                        placeholder="Search by ID or title..."
                        value={parentSearchTerm}
                        onValueChange={(value: string) => {
                          setParentSearchTerm(value);
                          if (/^\d+$/.test(value)) {
                            setFormData((prev) => ({
                              ...prev,
                              parentId: value,
                            }));
                          } else if (value === "") {
                            setFormData((prev) => ({ ...prev, parentId: "" }));
                          }
                        }}
                      />
                      <CommandList
                        className="flex-1 overflow-y-auto max-h-64"
                        onWheel={(e) => {
                          e.stopPropagation();
                        }}
                      >
                        <CommandEmpty>
                          {isLoadingParent ? (
                            <div className="flex items-center justify-center py-4 gap-2 text-sm text-muted-foreground">
                              <Loader2 className="h-4 w-4 animate-spin" />
                              Loading...
                            </div>
                          ) : (
                            "No work items found."
                          )}
                        </CommandEmpty>
                        <CommandGroup>
                          {parentOptions.map((item) => (
                            <CommandItem
                              key={item.id}
                              value={`${item.id} ${item.title}`}
                              onSelect={() => {
                                setFormData((prev) => ({
                                  ...prev,
                                  parentId: item.id,
                                }));
                                setParentComboboxOpen(false);
                                setParentSearchTerm("");
                              }}
                            >
                              <Check
                                className={cn(
                                  "mr-2 h-4 w-4",
                                  formData.parentId === item.id
                                    ? "opacity-100"
                                    : "opacity-0"
                                )}
                              />
                              <span className="font-medium truncate">
                                #{item.id} - {item.title}
                              </span>
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
              </div>

              <div className="space-y-2">
                <Label htmlFor="childId">Child ID (optional)</Label>
                <Popover
                  open={childComboboxOpen}
                  onOpenChange={(open) => {
                    setChildComboboxOpen(open);
                    if (!open) {
                      setChildSearchTerm("");
                    }
                  }}
                >
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      role="combobox"
                      aria-expanded={childComboboxOpen}
                      className="w-full justify-between"
                    >
                      {formData.childId
                        ? `#${formData.childId}`
                        : "Select or type work item ID..."}
                      <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0 max-h-80">
                    <Command
                      shouldFilter={false}
                      className="flex flex-col h-full"
                    >
                      <CommandInput
                        placeholder="Search by ID or title..."
                        value={childSearchTerm}
                        onValueChange={(value: string) => {
                          setChildSearchTerm(value);
                          if (/^\d+$/.test(value)) {
                            setFormData((prev) => ({
                              ...prev,
                              childId: value,
                            }));
                          } else if (value === "") {
                            setFormData((prev) => ({ ...prev, childId: "" }));
                          }
                        }}
                      />
                      <CommandList
                        className="flex-1 overflow-y-auto max-h-64"
                        onWheel={(e) => {
                          e.stopPropagation();
                        }}
                      >
                        <CommandEmpty>
                          {isLoadingChild ? (
                            <div className="flex items-center justify-center py-4 gap-2 text-sm text-muted-foreground">
                              <Loader2 className="h-4 w-4 animate-spin" />
                              Loading...
                            </div>
                          ) : (
                            "No work items found."
                          )}
                        </CommandEmpty>
                        <CommandGroup>
                          {childOptions.map((item) => (
                            <CommandItem
                              key={item.id}
                              value={`${item.id} ${item.title}`}
                              onSelect={() => {
                                setFormData((prev) => ({
                                  ...prev,
                                  childId: item.id,
                                }));
                                setChildComboboxOpen(false);
                                setChildSearchTerm("");
                              }}
                            >
                              <Check
                                className={cn(
                                  "mr-2 h-4 w-4",
                                  formData.childId === item.id
                                    ? "opacity-100"
                                    : "opacity-0"
                                )}
                              />
                              <span className="font-medium truncate">
                                #{item.id} - {item.title}
                              </span>
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
              </div>
            </div>
          )}

          {/* Metadata section - only show in edit mode */}
          {mode === "edit" && effectiveWorkItem && (
            <div className="border-t pt-4">
              <div className="space-y-3">
                <Label className="text-sm font-medium text-muted-foreground">Work Item Information</Label>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
                  <div className="space-y-1">
                    <Label className="text-xs font-medium text-muted-foreground">Created By</Label>
                    <p className="text-sm">{effectiveWorkItem.createdBy || "Unknown"}</p>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs font-medium text-muted-foreground">Created Date</Label>
                    <p className="text-sm">
                      {effectiveWorkItem.createdDate 
                        ? new Date(effectiveWorkItem.createdDate).toLocaleString() 
                        : "Unknown"
                      }
                    </p>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs font-medium text-muted-foreground">Last Changed</Label>
                    <p className="text-sm">
                      {effectiveWorkItem.changedDate 
                        ? new Date(effectiveWorkItem.changedDate).toLocaleString() 
                        : "Unknown"
                      }
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}
        </form>
      )}
    </GenericModal>
  );
}
