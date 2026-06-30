import { useState, useEffect } from "react";
import { GenericModal } from "@/components/ui/generic-modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { X, Save, Loader2, Edit } from "lucide-react";
import type { Epic, Feature, UserStory } from "@shared/schema";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { getApiUrl } from "@/lib/api-config";
import toast from "react-hot-toast";
import { AiEnhanceWithDiff } from "@/components/AiEnhanceWithDiff";
import { getDescriptionLocationKey } from "@/config/ai-enhance-locations";

type ArtifactType = Epic | Feature | UserStory;

interface ArtifactEditDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  artifact: ArtifactType | null;
  artifactType: "epic" | "feature" | "story";
  onSave: (updatedArtifact: ArtifactType) => void;
  artifactId?: string | null;
  projectId?: string;
  personas?: any[];
  onArtifactUpdate?: () => void;
}

export function ArtifactEditDialog({
  open,
  onOpenChange,
  artifact,
  artifactType,
  onSave,
  artifactId,
  projectId,
  personas = [],
  onArtifactUpdate,
}: ArtifactEditDialogProps) {
  const [editedArtifact, setEditedArtifact] = useState<ArtifactType | null>(
    null
  );
  const [subtasks, setSubtasks] = useState<string[]>([]);
  const [acceptanceCriteriaText, setAcceptanceCriteriaText] =
    useState<string>("");
  const [isSaving, setIsSaving] = useState(false);

  // Helper function to convert acceptance criteria array to text
  const acceptanceCriteriaArrayToText = (ac: any[] | undefined): string => {
    if (!ac || ac.length === 0) return "";
    if (typeof ac[0] === "string") {
      return ac.join("\n");
    }
    // Handle structured format (given/when/then)
    return ac
      .map((criteria: any, idx: number) => {
        let text = `AC #${idx + 1}`;
        if (criteria.title) text += `: ${criteria.title}`;
        if (criteria.given) text += `\nGiven: ${criteria.given}`;
        if (criteria.when) text += `\nWhen: ${criteria.when}`;
        if (criteria.then) text += `\nThen: ${criteria.then}`;
        if (criteria.and) text += `\nAnd: ${criteria.and}`;
        return text;
      })
      .join("\n\n");
  };

  // Helper function to convert text back to array format
  const acceptanceCriteriaTextToArray = (text: string): any[] => {
    if (!text.trim()) return [];

    // Try to parse structured format first (Given-When-Then)
    const lines = text.split("\n");
    const structuredACs: any[] = [];
    let currentAC: any = null;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) {
        if (
          currentAC &&
          (currentAC.given || currentAC.when || currentAC.then)
        ) {
          structuredACs.push(currentAC);
        }
        currentAC = null;
        continue;
      }

      // Check for AC # pattern
      if (/^AC #\d+/.test(line)) {
        if (
          currentAC &&
          (currentAC.given || currentAC.when || currentAC.then)
        ) {
          structuredACs.push(currentAC);
        }
        const titleMatch = line.match(/^AC #\d+:?\s*(.+)?$/);
        currentAC = {
          title: titleMatch?.[1]?.trim() || undefined,
          given: "",
          when: "",
          then: "",
        };
      } else if (currentAC) {
        // Check for Given/When/Then/And patterns
        if (line.startsWith("Given:")) {
          currentAC.given = line.replace(/^Given:\s*/, "").trim();
        } else if (line.startsWith("When:")) {
          currentAC.when = line.replace(/^When:\s*/, "").trim();
        } else if (line.startsWith("Then:")) {
          currentAC.then = line.replace(/^Then:\s*/, "").trim();
        } else if (line.startsWith("And:")) {
          currentAC.and = line.replace(/^And:\s*/, "").trim();
        }
      }
    }

    // Add the last AC if exists
    if (currentAC && (currentAC.given || currentAC.when || currentAC.then)) {
      structuredACs.push(currentAC);
    }

    // If we found structured ACs, return them
    if (structuredACs.length > 0) {
      return structuredACs;
    }

    // Otherwise, treat as simple line-separated list
    return text
      .split("\n")
      .filter((line) => line.trim())
      .map((line) => line.trim());
  };

  useEffect(() => {
    if (artifact) {
      setEditedArtifact({ ...artifact });
      if ("subtasks" in artifact && artifact.subtasks) {
        setSubtasks([...artifact.subtasks]);
      }
      // Initialize acceptance criteria text
      if (artifactType === "story" && "acceptanceCriteria" in artifact) {
        const acText = acceptanceCriteriaArrayToText(
          artifact.acceptanceCriteria
        );
        setAcceptanceCriteriaText(acText);
      }
    }
  }, [artifact, artifactType]);

  if (!editedArtifact) return null;

  const handleSave = async () => {
    if (!artifactId) {
      toast.error("No artifact ID found. Cannot save.");
      return;
    }

    setIsSaving(true);
    try {
      // Build the updated artifact with all modifications
      const updated: any = {
        ...editedArtifact,
      };

      // For stories, ensure subtasks and acceptance criteria are included
      if (artifactType === "story") {
        updated.subtasks = subtasks || [];
        // Convert acceptance criteria text to array format
        const acArray = acceptanceCriteriaTextToArray(acceptanceCriteriaText);
        updated.acceptanceCriteria = acArray.length > 0 ? acArray : [];
      }

      // First, update local state via onSave callback
      onSave(updated as ArtifactType);

      // Then, save to database by updating the workflow artifact
      // We need to fetch the current artifact, update the specific item, and save back
      const response = await fetch(
        getApiUrl(`/api/workflow/artifacts/${artifactId}`),
        {
          method: "GET",
          credentials: "include",
        }
      );

      if (!response.ok) {
        throw new Error("Failed to fetch current artifact");
      }

      const currentArtifact = await response.json();
      const artifact = currentArtifact.artifact || currentArtifact;

      // Update the specific artifact in the collection
      let updatedEpics = artifact.epics || [];
      let updatedFeatures = artifact.features || [];
      let updatedUserStories = artifact.userStories || [];

      if (artifactType === "epic") {
        const index = updatedEpics.findIndex((e: any) => e.id === updated.id);
        if (index >= 0) {
          updatedEpics[index] = updated;
        } else {
          updatedEpics.push(updated);
        }
      } else if (artifactType === "feature") {
        const index = updatedFeatures.findIndex(
          (f: any) => f.id === updated.id
        );
        if (index >= 0) {
          updatedFeatures[index] = updated;
        } else {
          updatedFeatures.push(updated);
        }
      } else if (artifactType === "story") {
        const index = updatedUserStories.findIndex(
          (s: any) => s.id === updated.id
        );
        if (index >= 0) {
          updatedUserStories[index] = updated;
        } else {
          updatedUserStories.push(updated);
        }
      }

      // Save updated collections to database
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
            requirement: artifact.requirement || "",
          }),
        }
      );

      if (!saveResponse.ok) {
        const errorData = await saveResponse
          .json()
          .catch(() => ({ error: "Failed to save" }));
        throw new Error(errorData.error || "Failed to save artifact");
      }

      toast.success("Artifact saved successfully!");

      // Notify parent to refresh data
      if (onArtifactUpdate) {
        onArtifactUpdate();
      }

      onOpenChange(false);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Failed to save artifact. Please try again."
      );
    } finally {
      setIsSaving(false);
    }
  };

  const addSubtask = () => {
    setSubtasks([...subtasks, ""]);
  };

  const updateSubtask = (index: number, value: string) => {
    const updated = [...subtasks];
    updated[index] = value;
    setSubtasks(updated);
  };

  const removeSubtask = (index: number) => {
    setSubtasks(subtasks.filter((_, i) => i !== index));
  };
  const getTitle = () => {
    switch (artifactType) {
      case "epic":
        return "Edit Epic";
      case "feature":
        return "Edit Feature";
      case "story":
        return "Edit User Story";
    }
  };

  return (
    <GenericModal
      open={open}
      onOpenChange={onOpenChange}
      title={getTitle()}
      description={`Make changes to the ${artifactType} details below`}
      icon={Edit}
      //width="1280px"
      maxHeight="90vh"
      contentClassName="space-y-4"
      footerButtons={[
        {
          label: "Cancel",
          onClick: () => onOpenChange(false),
          variant: "outline",
          disabled: isSaving,
        },
        {
          label: isSaving ? "Saving..." : "Save",
          onClick: handleSave,
          variant: "default",
          disabled: isSaving,
          loading: isSaving,
          "data-testid": "button-save-artifact",
        },
      ]}
    >
      {/* Title */}
      <div className="space-y-2">
        <Label htmlFor="edit-title">Title</Label>
        <Input
          id="edit-title"
          value={editedArtifact.title || ""}
          onChange={(e) =>
            setEditedArtifact({ ...editedArtifact, title: e.target.value })
          }
          data-testid="input-edit-title"
        />
      </div>

      {/* Description */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label htmlFor="edit-description">Description</Label>
          {(artifactType === "epic" ||
            artifactType === "feature" ||
            artifactType === "story") && (
            <AiEnhanceWithDiff
              locationKey={getDescriptionLocationKey(artifactType)}
              value={editedArtifact.description || ""}
              onEnhanced={(enhancedText) =>
                setEditedArtifact({
                  ...editedArtifact,
                  description: enhancedText,
                })
              }
              buttonVariant="ghost"
              buttonSize="sm"
              className="justify-end"
              itemName="Description"
            />
          )}
        </div>
        <Textarea
          id="edit-description"
          value={editedArtifact.description || ""}
          onChange={(e) =>
            setEditedArtifact({
              ...editedArtifact,
              description: e.target.value,
            })
          }
          className="min-h-[160px] text-sm leading-relaxed"
          data-testid="textarea-edit-description"
        />
      </div>

      {/* Acceptance Criteria (Story only) */}
      {artifactType === "story" && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="edit-acceptance-criteria">
              Acceptance Criteria
            </Label>
            <AiEnhanceWithDiff
              locationKey="artifact.acceptanceCriteria"
              value={acceptanceCriteriaText}
              onEnhanced={(enhancedText) => setAcceptanceCriteriaText(enhancedText)}
              buttonVariant="ghost"
              buttonSize="sm"
              className="justify-end"
              itemName="Acceptance Criteria"
            />
          </div>
          <Textarea
            id="edit-acceptance-criteria"
            value={acceptanceCriteriaText}
            onChange={(e) => setAcceptanceCriteriaText(e.target.value)}
            className="min-h-[160px] text-sm leading-relaxed"
            placeholder="Enter acceptance criteria (one per line or in Given-When-Then format)..."
            data-testid="textarea-edit-acceptance-criteria"
          />
        </div>
      )}

      {/* Status */}
      <div className="space-y-2">
        <Label htmlFor="edit-status">Status</Label>
        <Select
          value={editedArtifact.status || "planned"}
          onValueChange={(value: string) =>
            setEditedArtifact({ ...editedArtifact, status: value })
          }
        >
          <SelectTrigger id="edit-status" data-testid="select-edit-status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="planned">Planned</SelectItem>
            <SelectItem value="approved">Approved</SelectItem>
            <SelectItem value="backlog">Backlog</SelectItem>
            <SelectItem value="in-progress">In Progress</SelectItem>
            <SelectItem value="completed">Completed</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Priority */}
      <div className="space-y-2">
        <Label htmlFor="edit-priority">Priority</Label>
        <Select
          value={editedArtifact.priority}
          onValueChange={(value: "High" | "Medium" | "Low") =>
            setEditedArtifact({ ...editedArtifact, priority: value })
          }
        >
          <SelectTrigger id="edit-priority" data-testid="select-edit-priority">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="High">High</SelectItem>
            <SelectItem value="Medium">Medium</SelectItem>
            <SelectItem value="Low">Low</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Story Points (Story only) */}
      {artifactType === "story" && "storyPoints" in editedArtifact && (
        <div className="space-y-2">
          <Label htmlFor="edit-story-points">Story Points</Label>
          <Input
            id="edit-story-points"
            type="number"
            min="1"
            max="13"
            value={editedArtifact.storyPoints || 1}
            onChange={(e) =>
              setEditedArtifact({
                ...editedArtifact,
                storyPoints: parseInt(e.target.value) || 1,
              })
            }
            data-testid="input-edit-story-points"
          />
        </div>
      )}

      {/* Persona (Story only) */}
      {artifactType === "story" && "persona" in editedArtifact && (
        <div className="space-y-2">
          <Label htmlFor="edit-persona">Persona</Label>
          <Input
            id="edit-persona"
            value={editedArtifact.persona || ""}
            onChange={(e) =>
              setEditedArtifact({ ...editedArtifact, persona: e.target.value })
            }
            data-testid="input-edit-persona"
          />
        </div>
      )}

      {/* Subtasks (Story only) */}
      {artifactType === "story" && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label>Subtasks</Label>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={addSubtask}
              data-testid="button-add-subtask"
            >
              Add Subtask
            </Button>
          </div>
          <div className="space-y-2">
            {subtasks.map((subtask, index) => (
              <div key={index} className="flex items-center gap-2">
                <Input
                  placeholder="Subtask description"
                  value={subtask}
                  onChange={(e) => updateSubtask(index, e.target.value)}
                  className="flex-1"
                  data-testid={`input-subtask-${index}`}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => removeSubtask(index)}
                  data-testid={`button-remove-subtask-${index}`}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}
    </GenericModal>
  );
}
