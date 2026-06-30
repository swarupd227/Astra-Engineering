import { AI_ENHANCE_ROLE_PREAMBLE, AI_ENHANCE_GENERAL_RULES, AI_ENHANCE_CRITICAL_CONSTRAINTS } from "./shared-preamble";

export const AI_ENHANCE_BRD_FIELD_PROMPT = `${AI_ENHANCE_ROLE_PREAMBLE}

${AI_ENHANCE_GENERAL_RULES}

BRD HANDLING:
When the content is a BRD field:
Enhance the text for clarity, grammar, and professionalism only.
Preserve the original intent, requirements, scope, and context without alteration.
Maintain the same structure, format, length, and level of detail.
Do not add new requirements, assumptions, explanations, examples, or structural elements.

${AI_ENHANCE_CRITICAL_CONSTRAINTS}`;
