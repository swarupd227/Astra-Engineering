import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Save } from "lucide-react";
import { useState, useEffect } from "react";
import { useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { getApiUrl } from "@/lib/api-config";
import { useToast } from "@/hooks/use-toast";
import { AiEnhanceWithDiff } from "@/components/AiEnhanceWithDiff";
import { getDescriptionLocationKey } from "@/config/ai-enhance-locations";

interface WorkItemEditDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  item: any;
  itemType: "story" | "requirement" | "backlog" | "document" | "epic";
  projectId: string;
  phaseNumber: number;
  projectName?: string;
  artifactOrgId?: string;
  organizationUrl?: string;
}

export function WorkItemEditDialog({
  open,
  onOpenChange,
  item,
  itemType,
  projectId,
  phaseNumber,
  projectName,
  artifactOrgId,
  organizationUrl,
}: WorkItemEditDialogProps) {
  const { toast } = useToast();
  
  // Check if this is an ADO item (from Azure DevOps)
  const isAdoItem = item?._isAdoItem || item?._originalItem?.fields || item?.fields;
  
  const [formData, setFormData] = useState({
    title: "",
    description: "",
    acceptanceCriteria: "",
    status: "todo",
    priority: "medium",
    assignedTo: "",
    storyPoints: "",
    category: "",
    content: "",
  });

  // Helper function to strip HTML tags and convert to plain text
  const stripHtmlTags = (html: string): string => {
    if (!html) return "";
    // Create a temporary DOM element to parse HTML
    const tmp = document.createElement("div");
    tmp.innerHTML = html;
    // Get text content and preserve line breaks
    let text = tmp.textContent || tmp.innerText || "";
    // Replace multiple spaces with single space, but preserve line breaks
    text = text.replace(/\s+/g, " ").trim();
    // If the original HTML had list items or paragraphs, try to preserve structure
    // Convert <li> to bullet points
    if (html.includes("<li>")) {
      const listItems = tmp.querySelectorAll("li");
      if (listItems.length > 0) {
        text = Array.from(listItems)
          .map((li) => `• ${li.textContent?.trim() || ""}`)
          .join("\n");
      }
    }
    // If the original HTML had <p> tags, preserve paragraph breaks
    if (html.includes("<p>")) {
      const paragraphs = tmp.querySelectorAll("p");
      if (paragraphs.length > 1) {
        text = Array.from(paragraphs)
          .map((p) => p.textContent?.trim() || "")
          .filter((p) => p.length > 0)
          .join("\n\n");
      }
    }
    return text;
  };

  useEffect(() => {
    if (item && open) {
      // Use original item data if available (from transformation), otherwise use item directly
      const originalItem = item._originalItem || item;
      
      // Handle both ADO items (with fields property) and local items
      const fields = originalItem.fields || {};
      
      // Extract values from transformed item first (display values), then check original if needed
      const title = item.title || originalItem.title || fields['System.Title'] || "";
      let description = item.description || originalItem.description || fields['System.Description'] || "";
      const status = item.status || originalItem.status || fields['System.State'] || "todo";
      const priority = item.priority || originalItem.priority || fields['Microsoft.VSTS.Common.Priority'] || "medium";
      const assignedTo = item.assignedTo || originalItem.assignedTo || fields['System.AssignedTo']?.displayName || "";
      const storyPoints = item.storyPoints || originalItem.storyPoints || fields['Microsoft.VSTS.Scheduling.StoryPoints'] || "";
      
      // Strip HTML tags from description and acceptance criteria for display in textarea
      description = stripHtmlTags(description);
      let acceptanceCriteria = item.acceptanceCriteria || originalItem.acceptanceCriteria || fields['Microsoft.VSTS.Common.AcceptanceCriteria'] || "";
      acceptanceCriteria = stripHtmlTags(acceptanceCriteria);
      
      // Normalize status to match our form options (todo, in_progress, done)
      let normalizedStatus = status.toLowerCase().replace(/\s+/g, '_');
      // Map common ADO statuses and workflow statuses to our internal ones
      if (normalizedStatus === 'new' || normalizedStatus === 'proposed' || normalizedStatus === 'backlog' || normalizedStatus === 'planned') normalizedStatus = 'todo';
      if (normalizedStatus === 'active' || normalizedStatus === 'committed') normalizedStatus = 'in_progress';
      if (normalizedStatus === 'closed' || normalizedStatus === 'resolved' || normalizedStatus === 'done') normalizedStatus = 'done';
      
      // Normalize priority to match our form options (low, medium, high)
      let normalizedPriority = priority.toString().toLowerCase();
      if (normalizedPriority === '1' || normalizedPriority === '2') normalizedPriority = 'high';
      if (normalizedPriority === '3') normalizedPriority = 'medium';
      if (normalizedPriority === '4') normalizedPriority = 'low';
      
      const formValues = {
        title,
        description,
        acceptanceCriteria,
        status: normalizedStatus,
        priority: normalizedPriority || 'medium',
        assignedTo,
        storyPoints: storyPoints?.toString() || "",
        category: item.category || originalItem.category || "",
        content: item.content || originalItem.content || "",
      };
      
      setFormData(formValues);
    }
  }, [item, open]);

  const updateMutation = useMutation({
    mutationFn: async (data: any) => {
      let endpoint = "";
      
      // Check if this is a wiki page (must be checked FIRST before other checks)
      const isWikiPage = item.type === 'wiki' || item.pageType;
      
      if (isWikiPage) {
        // For wiki pages, use the wiki-pages endpoint
        endpoint = `/api/wiki-pages/${item.id}`;
        // Include sessionId in the data
        data = {
          ...data,
          sessionId: item.sessionId,
        };
      } else if (isAdoItem) {
        // Check if this is an ADO item (from Azure DevOps)
        // Use the same API endpoint as hub-artifacts for consistency
        // Build query parameters for ADO config
        const queryParams = new URLSearchParams();
        // Use projectName from props, or try to get from item
        const effectiveProjectName = projectName || item.projectName || item.project || "";
        if (effectiveProjectName) {
          queryParams.append("projectName", effectiveProjectName);
        }
        if (artifactOrgId) {
          queryParams.append("artifactOrgId", artifactOrgId);
        }
        if (organizationUrl) {
          queryParams.append("organizationUrl", organizationUrl);
        }
        const queryString = queryParams.toString();
        // Use hub-artifacts API endpoint for consistency
        endpoint = `/api/hub/artifacts/${effectiveProjectName}/work-item/${item.id}${queryString ? `?${queryString}` : ""}`;
      } else {
        // Use local database endpoint - check item.workItemType or item.category first
        const actualType = item.workItemType?.toLowerCase() || item.category?.toLowerCase() || itemType;
        
        switch (actualType) {
          case "epic":
            endpoint = `/api/sdlc/projects/${projectId}/phases/${phaseNumber}/epics/${item.id}`;
            break;
          case "feature":
            endpoint = `/api/sdlc/projects/${projectId}/phases/${phaseNumber}/features/${item.id}`;
            break;
          case "story":
          case "backlog":
          case "user story":
            endpoint = `/api/sdlc/projects/${projectId}/phases/${phaseNumber}/backlog/${item.id}`;
            break;
          case "requirement":
            endpoint = `/api/sdlc/projects/${projectId}/phases/${phaseNumber}/requirements/${item.id}`;
            break;
          case "document":
            endpoint = `/api/sdlc/documents/${item.id}`;
            break;
          default:
            endpoint = `/api/sdlc/projects/${projectId}/phases/${phaseNumber}/backlog/${item.id}`;
        }
      }
      
      const response = await fetch(getApiUrl(endpoint), {
        method: "PATCH",
        body: JSON.stringify(data),
        headers: { "Content-Type": "application/json" },
        credentials: "include",
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        try {
          const errorJson = JSON.parse(errorText);
          throw new Error(errorJson.message || errorJson.error || errorJson.details || `Failed to update item (${response.status})`);
        } catch (e) {
          throw new Error(errorText || `Failed to update item (${response.status})`);
        }
      }
      
      const result = await response.json();
      return result;
    },
    onSuccess: () => {
      // Invalidate relevant queries
      queryClient.invalidateQueries({ queryKey: [`/api/sdlc/projects/${projectId}/phases/${phaseNumber}/backlog`] });
      queryClient.invalidateQueries({ queryKey: [`/api/sdlc/projects/${projectId}/phases/${phaseNumber}/requirements`] });
      queryClient.invalidateQueries({ queryKey: [`/api/sdlc/projects/${projectId}/phases/${phaseNumber}/documents`] });
      queryClient.invalidateQueries({ queryKey: [`/api/sdlc/projects/${projectId}/phases/${phaseNumber}/epics`] });
      queryClient.invalidateQueries({ queryKey: [`/api/sdlc/projects/${projectId}/phases/${phaseNumber}/features`] });
      
      // Invalidate wiki pages query if this was a wiki page
      const isWikiPage = item.type === 'wiki' || item.pageType;
      if (isWikiPage) {
        queryClient.invalidateQueries({ queryKey: [`/api/sdlc/projects/${projectId}/wiki-pages`] });
      }
      
      // Invalidate Hub Artifacts work items if this was an ADO item
      if (isAdoItem) {
        // Invalidate Hub Artifacts endpoint - this will refresh ADO work items
        const effectiveProjectName = projectName || item.projectName || item.project || "";
        if (effectiveProjectName) {
          queryClient.invalidateQueries({ queryKey: [`/api/hub/artifacts/${effectiveProjectName}/work-items`] });
        }
        queryClient.invalidateQueries({ queryKey: [`/api/hub/artifacts`] });
      }
      
      toast({
        title: "Success",
        description: `${itemType === "story" ? "User story" : itemType} updated successfully${isAdoItem ? " in Azure DevOps" : ""}`,
      });
      onOpenChange(false);
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: `Failed to update ${itemType}: ${error.message}`,
        variant: "destructive",
      });
    },
  });

  const isDocument = itemType === "document";

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    const updateData: any = {
      title: formData.title,
    };

    if (isDocument) {
      updateData.content = formData.content;
    } else {
      updateData.description = formData.description;
      updateData.status = formData.status;
      updateData.priority = formData.priority;
    }

    // Add optional fields based on item type
    if (!isDocument && formData.acceptanceCriteria) {
      updateData.acceptanceCriteria = formData.acceptanceCriteria;
    }
    if (!isDocument && formData.assignedTo) updateData.assignedTo = formData.assignedTo;
    if (!isDocument && formData.storyPoints) updateData.storyPoints = parseInt(formData.storyPoints);
    if (!isDocument && formData.content) updateData.content = formData.content;
    
    // Note: 'category' is only for UI display, never send it to the API

    updateMutation.mutate(updateData);
  };

  if (!item) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-7xl max-h-[90vh] w-[95vw]" key={item?.id || 'new'}>
        <DialogHeader>
          <DialogTitle>Edit {itemType === "story" ? "User Story" : itemType}{isAdoItem ? " (Azure DevOps)" : ""}</DialogTitle>
        </DialogHeader>

        <ScrollArea className="max-h-[calc(90vh-160px)]">
          <form onSubmit={handleSubmit} className="space-y-4 pr-4">
            {/* Title */}
            <div className="space-y-2">
              <Label htmlFor="title">Title *</Label>
              <Input
                id="title"
                value={formData.title || ''}
                onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                required
                placeholder="Enter title..."
                data-testid="input-edit-title"
              />
            </div>

            {/* Description */}
            {!isDocument && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="description" className="text-base font-semibold">Description</Label>
                  <AiEnhanceWithDiff
                    locationKey={getDescriptionLocationKey(
                      item?.workItemType || item?.type || itemType
                    )}
                    value={formData.description}
                    onEnhanced={(enhancedText) =>
                      setFormData({ ...formData, description: enhancedText })
                    }
                    placeholderExtraPrompt={`Context: ${formData.title || item?.title || ''}\n\nAdd any additional instructions for enhancing the description (optional)...`}
                    itemName={`${formData.title || item?.title || 'Work Item'} Description`}
                  />
                </div>
                <Textarea
                  id="description"
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  rows={7}
                  placeholder="Enter description or click AI Enhance to generate one..."
                  className="resize-none font-mono text-sm min-h-[180px]"
                  data-testid="textarea-edit-description"
                />
              </div>
            )}

            {/* Acceptance Criteria */}
            {!isDocument && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="acceptanceCriteria" className="text-base font-semibold">Acceptance Criteria</Label>
                  <AiEnhanceWithDiff
                    locationKey="hub.acceptanceCriteria"
                    value={formData.acceptanceCriteria}
                    onEnhanced={(enhancedText) =>
                      setFormData({
                        ...formData,
                        acceptanceCriteria: enhancedText,
                      })
                    }
                    placeholderExtraPrompt={`Context: ${formData.title || item?.title || ''}\n\nAdd any additional instructions for enhancing the acceptance criteria (optional)...`}
                    itemName={`${formData.title || item?.title || 'Work Item'} Acceptance Criteria`}
                  />
                </div>
                <Textarea
                  id="acceptanceCriteria"
                  value={formData.acceptanceCriteria}
                  onChange={(e) => setFormData({ ...formData, acceptanceCriteria: e.target.value })}
                  rows={5}
                  placeholder="Enter acceptance criteria (one per line)..."
                  className="resize-none font-mono text-sm min-h-[130px]"
                  data-testid="textarea-edit-acceptance"
                />
              </div>
            )}

            {/* Content (for documents) */}
            {isDocument && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="content" className="text-base font-semibold">Content</Label>
                  <AiEnhanceWithDiff
                    locationKey="hub.content"
                    value={formData.content}
                    onEnhanced={(enhancedText) =>
                      setFormData({ ...formData, content: enhancedText })
                    }
                    placeholderExtraPrompt="Add any additional instructions for enhancing the document content (optional)..."
                    itemName="Document Content"
                  />
                </div>
                <Textarea
                  id="content"
                  value={formData.content}
                  onChange={(e) => setFormData({ ...formData, content: e.target.value })}
                  rows={16}
                  className="resize-none font-mono text-sm min-h-[400px]"
                  data-testid="textarea-edit-content"
                  placeholder="Edit the document content or click AI Enhance to improve it..."
                />
              </div>
            )}

            {/* Category (for requirements) */}
            {itemType === "requirement" && (
              <div className="space-y-2">
                <Label htmlFor="category">Category</Label>
                <Select
                  value={formData.category}
                  onValueChange={(value) => setFormData({ ...formData, category: value })}
                >
                  <SelectTrigger data-testid="select-edit-category">
                    <SelectValue placeholder="Select category" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="functional">Functional</SelectItem>
                    <SelectItem value="non-functional">Non-Functional</SelectItem>
                    <SelectItem value="business">Business</SelectItem>
                    <SelectItem value="technical">Technical</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Status and Priority - Hide for documents */}
            {!isDocument && (
              <div className="grid grid-cols-2 gap-4">
                {/* Status */}
                <div className="space-y-2">
                  <Label htmlFor="status">Status *</Label>
                  <Select
                    value={formData.status}
                    onValueChange={(value) => setFormData({ ...formData, status: value })}
                  >
                    <SelectTrigger data-testid="select-edit-status">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="todo">To Do</SelectItem>
                      <SelectItem value="in_progress">In Progress</SelectItem>
                      <SelectItem value="done">Done</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* Priority */}
                <div className="space-y-2">
                  <Label htmlFor="priority">Priority</Label>
                  <Select
                    value={formData.priority}
                    onValueChange={(value) => setFormData({ ...formData, priority: value })}
                  >
                    <SelectTrigger data-testid="select-edit-priority">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="low">Low</SelectItem>
                      <SelectItem value="medium">Medium</SelectItem>
                      <SelectItem value="high">High</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}

            {/* Assigned To & Story Points (for stories) */}
            {(itemType === "story" || itemType === "backlog") && (
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="assignedTo">Assigned To</Label>
                  <Input
                    id="assignedTo"
                    value={formData.assignedTo}
                    onChange={(e) => setFormData({ ...formData, assignedTo: e.target.value })}
                    data-testid="input-edit-assigned"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="storyPoints">Story Points</Label>
                  <Input
                    id="storyPoints"
                    type="number"
                    min="0"
                    max="100"
                    value={formData.storyPoints}
                    onChange={(e) => setFormData({ ...formData, storyPoints: e.target.value })}
                    data-testid="input-edit-points"
                  />
                </div>
              </div>
            )}
          </form>
        </ScrollArea>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            data-testid="button-cancel-edit"
          >
            Cancel
          </Button>
          <Button
            type="submit"
            onClick={handleSubmit}
            disabled={updateMutation.isPending}
            data-testid="button-save-edit"
          >
            <Save className="h-4 w-4 mr-2" />
            {updateMutation.isPending ? "Saving..." : "Save Changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
