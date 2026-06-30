import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { Plus, Loader2 } from "lucide-react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { 
  SDLCIssue, 
  SDLCEpic, 
  SDLCRequirement, 
  SDLCBacklogItem, 
  SDLCDocument 
} from "@shared/schema";

type WorkItemType = "issues" | "epics" | "requirements" | "backlog" | "documents";

interface WorkItemDialogProps {
  projectId: string;
  phaseId: number;
  phaseName?: string;
  type: WorkItemType;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type WorkItem = SDLCIssue | SDLCEpic | SDLCRequirement | SDLCBacklogItem | SDLCDocument;

export function WorkItemDialog({ projectId, phaseId, phaseName, type, open, onOpenChange }: WorkItemDialogProps) {
  const { toast } = useToast();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState("medium");
  const [status, setStatus] = useState("");
  const [itemType, setItemType] = useState("");
  const [storyPoints, setStoryPoints] = useState("");
  const [content, setContent] = useState("");

  // Reset form when dialog opens
  useEffect(() => {
    if (open) {
      setTitle("");
      setDescription("");
      setPriority("medium");
      setStatus("");
      setItemType("");
      setStoryPoints("");
      setContent("");
    }
  }, [open]);

  // Fetch work items
  const { data: items = [], isLoading } = useQuery<WorkItem[]>({
    queryKey: [`/api/sdlc/projects/${projectId}/phases/${phaseId}/${type}`],
    enabled: open,
  });

  // Create work item mutation
  const createMutation = useMutation({
    mutationFn: async (data: any) => {
      return apiRequest("POST", `/api/sdlc/projects/${projectId}/phases/${phaseId}/${type}`, data);
    },
    onSuccess: (response: any) => {
      queryClient.invalidateQueries({ queryKey: [`/api/sdlc/projects/${projectId}/phases/${phaseId}/${type}`] });
      queryClient.invalidateQueries({ queryKey: [`/api/sdlc/projects/${projectId}/details`] });
      toast({ title: `${getTypeLabel(type)} created successfully` });
      
      // Check if a phase was unlocked
      if (response?._phaseUnlocked?.unlocked) {
        toast({
          title: "✅ Phase Unlocked!",
          description: `${response._phaseUnlocked.phaseName} — You can now proceed.`,
        });
      }
      
      resetForm();
    },
    onError: () => {
      toast({ 
        title: `Failed to create ${getTypeLabel(type).toLowerCase()}`,
        variant: "destructive" 
      });
    },
  });

  // Delete work item mutation
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest("DELETE", `/api/sdlc/${type}/${id}`, {});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/sdlc/projects/${projectId}/phases/${phaseId}/${type}`] });
      toast({ title: `${getTypeLabel(type)} deleted successfully` });
    },
  });

  const resetForm = () => {
    setTitle("");
    setDescription("");
    setPriority("medium");
    setStatus("");
    setItemType("");
    setStoryPoints("");
    setContent("");
  };

  const handleCreate = () => {
    if (!title.trim()) {
      toast({ title: "Title is required", variant: "destructive" });
      return;
    }

    const baseData = {
      title: title.trim(),
      description: description.trim() || null,
      priority,
    };

    let data: any = baseData;

    switch (type) {
      case "issues":
        data = { ...baseData, status: status || "open" };
        break;
      case "epics":
        data = { ...baseData, status: status || "planned", featureCount: 0 };
        break;
      case "requirements":
        data = { ...baseData, type: itemType || "functional", status: status || "draft" };
        break;
      case "backlog":
        data = { 
          ...baseData, 
          type: itemType || "story", 
          status: status || "backlog",
          storyPoints: storyPoints ? parseInt(storyPoints) : null,
        };
        break;
      case "documents":
        data = { 
          title: title.trim(), 
          content: content.trim() || null,
          type: itemType || "general",
        };
        break;
    }

    createMutation.mutate(data);
  };

  const getTypeLabel = (type: WorkItemType): string => {
    const labels = {
      issues: "Issue",
      epics: "Epic",
      requirements: "Requirement",
      backlog: "Backlog Item",
      documents: "Document",
    };
    return labels[type];
  };

  const getStatusOptions = () => {
    switch (type) {
      case "issues":
        return [
          { value: "open", label: "Open" },
          { value: "in_progress", label: "In Progress" },
          { value: "resolved", label: "Resolved" },
          { value: "closed", label: "Closed" },
        ];
      case "epics":
        return [
          { value: "planned", label: "Planned" },
          { value: "in_progress", label: "In Progress" },
          { value: "completed", label: "Completed" },
        ];
      case "requirements":
        return [
          { value: "draft", label: "Draft" },
          { value: "approved", label: "Approved" },
          { value: "implemented", label: "Implemented" },
        ];
      case "backlog":
        return [
          { value: "backlog", label: "Backlog" },
          { value: "ready", label: "Ready" },
          { value: "in_progress", label: "In Progress" },
          { value: "done", label: "Done" },
        ];
      default:
        return [];
    }
  };

  const getTypeOptions = () => {
    switch (type) {
      case "requirements":
        return [
          { value: "functional", label: "Functional" },
          { value: "non_functional", label: "Non-Functional" },
          { value: "business", label: "Business" },
        ];
      case "backlog":
        return [
          { value: "story", label: "Story" },
          { value: "bug", label: "Bug" },
          { value: "task", label: "Task" },
        ];
      case "documents":
        return [
          { value: "general", label: "General" },
          { value: "technical", label: "Technical" },
          { value: "user_guide", label: "User Guide" },
          { value: "api_doc", label: "API Documentation" },
        ];
      default:
        return [];
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle data-testid="dialog-title">{getTypeLabel(type)} Management</DialogTitle>
          <DialogDescription>
            {phaseName && `Phase: ${phaseName} • `}View and manage {type} for this project
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {/* Create New Form */}
          <div className="space-y-4 p-4 border rounded-md">
            <h3 className="font-semibold">Create New {getTypeLabel(type)}</h3>
            
            <div className="space-y-2">
              <Label htmlFor="title">Title</Label>
              <Input
                id="title"
                data-testid="input-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={`Enter ${type.slice(0, -1)} title`}
              />
            </div>

            {type !== "documents" && (
              <div className="space-y-2">
                <Label htmlFor="description">Description</Label>
                <Textarea
                  id="description"
                  data-testid="input-description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Enter description (optional)"
                  rows={3}
                />
              </div>
            )}

            {type === "documents" && (
              <div className="space-y-2">
                <Label htmlFor="content">Content</Label>
                <Textarea
                  id="content"
                  data-testid="input-content"
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  placeholder="Enter document content"
                  rows={5}
                />
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              {type !== "documents" && (
                <div className="space-y-2">
                  <Label htmlFor="priority">Priority</Label>
                  <Select value={priority} onValueChange={setPriority}>
                    <SelectTrigger id="priority" data-testid="select-priority">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="low">Low</SelectItem>
                      <SelectItem value="medium">Medium</SelectItem>
                      <SelectItem value="high">High</SelectItem>
                      {type === "issues" && <SelectItem value="critical">Critical</SelectItem>}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {getStatusOptions().length > 0 && (
                <div className="space-y-2">
                  <Label htmlFor="status">Status</Label>
                  <Select value={status} onValueChange={setStatus}>
                    <SelectTrigger id="status" data-testid="select-status">
                      <SelectValue placeholder="Select status" />
                    </SelectTrigger>
                    <SelectContent>
                      {getStatusOptions().map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {getTypeOptions().length > 0 && (
                <div className="space-y-2">
                  <Label htmlFor="type">Type</Label>
                  <Select value={itemType} onValueChange={setItemType}>
                    <SelectTrigger id="type" data-testid="select-type">
                      <SelectValue placeholder="Select type" />
                    </SelectTrigger>
                    <SelectContent>
                      {getTypeOptions().map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {type === "backlog" && (
                <div className="space-y-2">
                  <Label htmlFor="storyPoints">Story Points</Label>
                  <Input
                    id="storyPoints"
                    data-testid="input-story-points"
                    type="number"
                    min="0"
                    value={storyPoints}
                    onChange={(e) => setStoryPoints(e.target.value)}
                    placeholder="0"
                  />
                </div>
              )}
            </div>

            <Button 
              onClick={handleCreate} 
              disabled={createMutation.isPending}
              data-testid="button-create"
              className="w-full"
            >
              {createMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Creating...
                </>
              ) : (
                <>
                  <Plus className="h-4 w-4 mr-2" />
                  Create {getTypeLabel(type)}
                </>
              )}
            </Button>
          </div>

          {/* Items List */}
          <div className="space-y-3">
            <h3 className="font-semibold">Existing {getTypeLabel(type)}s</h3>
            {isLoading ? (
              <div className="flex items-center justify-center p-8">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : items.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center p-8">
                No {type} yet. Create one above to get started.
              </p>
            ) : (
              <div className="space-y-2 max-h-96 overflow-y-auto">
                {items.map((item: any) => (
                  <div
                    key={item.id}
                    className="flex items-start justify-between p-3 border rounded-md hover-elevate"
                    data-testid={`item-${item.id}`}
                  >
                    <div className="flex-1 min-w-0">
                      <h4 className="font-medium text-sm">{item.title}</h4>
                      {item.description && (
                        <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                          {item.description}
                        </p>
                      )}
                      {item.content && (
                        <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                          {item.content}
                        </p>
                      )}
                      <div className="flex items-center gap-2 mt-2">
                        {item.priority && (
                          <span className="text-xs px-2 py-0.5 rounded-full bg-muted">
                            {item.priority}
                          </span>
                        )}
                        {item.status && (
                          <span className="text-xs px-2 py-0.5 rounded-full bg-muted">
                            {item.status}
                          </span>
                        )}
                        {item.type && (
                          <span className="text-xs px-2 py-0.5 rounded-full bg-muted">
                            {item.type}
                          </span>
                        )}
                        {item.storyPoints !== undefined && item.storyPoints !== null && (
                          <span className="text-xs px-2 py-0.5 rounded-full bg-muted">
                            {item.storyPoints} pts
                          </span>
                        )}
                      </div>
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => deleteMutation.mutate(item.id)}
                      disabled={deleteMutation.isPending}
                      data-testid={`button-delete-${item.id}`}
                      className="ml-2 shrink-0"
                    >
                      Delete
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
