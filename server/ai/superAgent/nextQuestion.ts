import type { StoryState, StoryField } from "./state";

export interface NextQuestionResult {
  field: StoryField | null;
  questionText: string;
  suggestions: string[];
}

const FIELD_QUESTIONS: Record<StoryField, string> = {
  organization: "Which organization would you like to work with?",
  project: "Which project should this story be added to?",
  goal: "Please tell me what feature you want to create a story for and what is the main goal of this user story. Describe your complete requirement.",
  persona: "Who will be the primary user benefiting from this feature?",
  benefit: "Why is this important? What benefit does it provide?",
  priority: "What priority should this story have?",
  storyPoints: "How would you estimate the effort for this story?",
};

const FIELD_SUGGESTIONS: Record<StoryField, string[]> = {
  organization: [],
  project: [],
  goal: [
    "Add user authentication",
    "Improve search functionality",
    "Create dashboard reports",
    "Build notification system",
    "Help"
  ],
  persona: [
    "End User",
    "Administrator", 
    "Developer",
    "Product Owner",
    "Customer",
    "Help"
  ],
  benefit: [
    "Increase efficiency",
    "Improve user experience",
    "Reduce manual effort",
    "Enable better decisions",
    "Help"
  ],
  priority: [
    "High",
    "Medium",
    "Low"
  ],
  storyPoints: [
    "1 point (trivial)",
    "2 points (small)",
    "3 points (medium)",
    "5 points (large)",
    "8 points (very large)",
    "13 points (epic-sized)"
  ],
};

export function pickNextQuestion(state: StoryState): NextQuestionResult {
  if (state.missingFields.length === 0) {
    return {
      field: null,
      questionText: "",
      suggestions: ["Confirm story", "Edit details", "Start over"],
    };
  }
  
  const nextField = state.missingFields[0];
  
  return {
    field: nextField,
    questionText: FIELD_QUESTIONS[nextField],
    suggestions: FIELD_SUGGESTIONS[nextField],
  };
}

export function getQuestionTextForField(field: StoryField): string {
  return FIELD_QUESTIONS[field];
}

export function getBaseSuggestionsForField(field: StoryField): string[] {
  return [...FIELD_SUGGESTIONS[field]];
}

export function buildConfirmationPrompt(state: StoryState): string {
  const { provided, generatedSummary } = state;
  
  if (generatedSummary) {
    return `Here's the story I've created based on your inputs:

**${generatedSummary.title}**

**User Story:** ${generatedSummary.userStory}

**Description:** ${generatedSummary.description}

**Acceptance Criteria:**
${generatedSummary.acceptanceCriteria.map((c, i) => `${i + 1}. ${c}`).join("\n")}

**Priority:** ${generatedSummary.priority}
**Story Points:** ${generatedSummary.storyPoints}

Would you like to create this story in Azure DevOps?`;
  }
  
  return `Great! I have all the information needed:

- **Organization:** ${provided.organization}
- **Project:** ${provided.project}
- **Persona:** ${provided.persona}
- **Goal:** ${provided.goal}
- **Benefit:** ${provided.benefit}
- **Priority:** ${provided.priority}
- **Story Points:** ${provided.storyPoints}

Would you like me to generate the full story now?`;
}

export function shouldSkipField(state: StoryState, field: StoryField): boolean {
  return field === state.lastAsked && state.provided[field] === undefined;
}
