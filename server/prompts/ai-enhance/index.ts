import { AI_ENHANCE_DEFAULT_PROMPT } from "./default";
import { AI_ENHANCE_ACCEPTANCE_CRITERIA_PROMPT } from "./acceptance-criteria";
import { AI_ENHANCE_ARTIFACT_PROMPT } from "./artifact";
import { AI_ENHANCE_DESCRIPTION_PROMPT } from "./description";
import { AI_ENHANCE_BRD_FIELD_PROMPT } from "./brd-field";
import { AI_ENHANCE_BRD_SECTION_PROMPT } from "./brd-section";
import { AI_ENHANCE_REPRO_STEPS_PROMPT } from "./repro-steps";
import { AI_ENHANCE_CONTENT_PROMPT } from "./content";

/**
 * Resolve the system prompt for the AI enhance endpoint based on the locationKey.
 *
 * The matching order matters — acceptance criteria must be checked before artifact,
 * since a key could theoretically match both patterns.
 */
export function resolveEnhancePrompt(locationKey: string | undefined): string {
  if (!locationKey) {
    return AI_ENHANCE_DEFAULT_PROMPT;
  }

  // Acceptance criteria — check FIRST before artifact
  if (locationKey.includes("acceptanceCriteria") || locationKey.includes("acceptance-criteria")) {
    return AI_ENHANCE_ACCEPTANCE_CRITERIA_PROMPT;
  }

  // Artifact enhancements (workflow artifacts)
  if (locationKey.includes("artifact.")) {
    return AI_ENHANCE_ARTIFACT_PROMPT;
  }

  // Descriptions
  if (locationKey.includes("description") || locationKey.includes("Description")) {
    return AI_ENHANCE_DESCRIPTION_PROMPT;
  }

  // BRD generated sections (preview editor) — allows adding/modifying requirements
  if (locationKey.includes("brd.section")) {
    return AI_ENHANCE_BRD_SECTION_PROMPT;
  }

  // BRD input form fields
  if (locationKey.includes("brd.field")) {
    return AI_ENHANCE_BRD_FIELD_PROMPT;
  }

  // Reproduction steps
  if (locationKey.includes("reproSteps")) {
    return AI_ENHANCE_REPRO_STEPS_PROMPT;
  }

  // General/hub content
  if (locationKey.includes("hub.content") || locationKey.includes("content")) {
    return AI_ENHANCE_CONTENT_PROMPT;
  }

  return AI_ENHANCE_DEFAULT_PROMPT;
}
