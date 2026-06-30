export type AiEnhanceLocationKey =
  | "artifact.description"
  | "artifact.acceptanceCriteria"
  | "hub.description"
  | "hub.acceptanceCriteria"
  | "hub.content"
  | "brd.field"
  | "brd.section"
  | "ado.description"
  | "ado.acceptanceCriteria"
  | "ado.reproSteps"
  | "epic-description-enhancer"
  | "feature-description-enhancer"
  | "story-description-enhancer"
  | "task-description-enhancer"
  | "design-card.figmaPrompt";

export interface AiEnhanceLocation {
  key: AiEnhanceLocationKey;
  label: string;
  description: string;
}

export const AI_ENHANCE_LOCATIONS: AiEnhanceLocation[] = [
  {
    key: "artifact.description",
    label: "Artifact Description",
    description: "Workflow artifact edit dialog – description field for epics, features, and user stories.",
  },
  {
    key: "epic-description-enhancer",
    label: "Epic Description Enhancer",
    description: "Guidelines for enhancing epic descriptions. Uses: epic-description-enhancer.md",
  },
  {
    key: "feature-description-enhancer",
    label: "Feature Description Enhancer",
    description: "Guidelines for enhancing feature descriptions. Uses: feature-description-enhancer.md",
  },
  {
    key: "story-description-enhancer",
    label: "User Story Description Enhancer",
    description: "Guidelines for enhancing user story descriptions. Uses: story-description-enhancer.md",
  },
  {
    key: "task-description-enhancer",
    label: "Task Description Enhancer",
    description: "Guidelines for enhancing task descriptions. Uses: task-description-enhancer.md",
  },
  {
    key: "artifact.acceptanceCriteria",
    label: "Artifact Acceptance Criteria",
    description: "Workflow artifact edit dialog – acceptance criteria field. Uses: acceptance-criteria-enhancer.md",
  },
  {
    key: "hub.description",
    label: "Hub Work Item Description",
    description: "Hub work item edit dialog – description field.",
  },
  {
    key: "hub.acceptanceCriteria",
    label: "Hub Acceptance Criteria",
    description: "Hub work item edit dialog – acceptance criteria field. Uses: acceptance-criteria-enhancer.md",
  },
  {
    key: "hub.content",
    label: "Hub Content",
    description: "Hub document content field.",
  },
  {
    key: "brd.field",
    label: "BRD Field",
    description: "Any BRD field enhanced via the BRD input form. Uses: generic-brd-field-enhancer.md",
  },
  {
    key: "brd.section",
    label: "BRD Section",
    description: "BRD section content – preserves markdown tables and headers.",
  },
  {
    key: "ado.description",
    label: "Work Item Description",
    description: "Default description enhancer for work items (fallback for unlisted types).",
  },
  {
    key: "ado.acceptanceCriteria",
    label: "ADO Acceptance Criteria",
    description: "ADO work item dialog – acceptance criteria field. Uses: acceptance-criteria-enhancer.md",
  },
  {
    key: "ado.reproSteps",
    label: "ADO Repro Steps",
    description: "ADO work item dialog – reproduction steps field. Uses: ado-repro-steps-enhancer.md",
  },
  {
    key: "design-card.figmaPrompt",
    label: "Design Card – Figma Prompt",
    description: "Generate Design with AI modal – generated Figma design prompt (above Save & Design). Map a guideline file to enhance the prompt. Uses: design-card-figma-prompt-enhancer.md (or your file).",
  },
];

/**
 * Get the appropriate location key for a work item description based on its type
 */
export function getDescriptionLocationKey(workItemType: string | null | undefined): AiEnhanceLocationKey {
  if (!workItemType) {
    return "ado.description"; // Default fallback
  }
  
  const normalizedType = workItemType.toLowerCase().trim().replace(/\s+/g, " ");
  
  // Map work item types to their specific enhancer location keys
  // Epic types
  if (normalizedType === "epic") {
    return "epic-description-enhancer";
  }
  
  // Feature types
  if (normalizedType === "feature") {
    return "feature-description-enhancer";
  }
  
  // User Story types (handle various formats)
  if (
    normalizedType === "user story" ||
    normalizedType === "userstory" ||
    normalizedType === "story" ||
    normalizedType === "backlog"
  ) {
    return "story-description-enhancer";
  }
  
  // Task types
  if (normalizedType === "task") {
    return "task-description-enhancer";
  }
  
  // Fallback to generic based on context
  return "ado.description";
}


