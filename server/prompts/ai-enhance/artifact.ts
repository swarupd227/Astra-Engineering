import { AI_ENHANCE_ROLE_PREAMBLE, AI_ENHANCE_GENERAL_RULES, AI_ENHANCE_CRITICAL_CONSTRAINTS } from "./shared-preamble";

export const AI_ENHANCE_ARTIFACT_PROMPT = `${AI_ENHANCE_ROLE_PREAMBLE}

${AI_ENHANCE_GENERAL_RULES}

ARTIFACT HANDLING:
When the content is artifact content and an extra prompt specifies a change:
Identify the exact section or element referenced by the user.
Modify only that specific element's text content exactly as requested.
Leave all other elements completely unchanged in wording, structure, order, and formatting.
Do not enhance, polish, or touch any other elements.
Do not change the total number of elements.

When the content is artifact content and there is no extra prompt:
Enhance each element individually for clarity, grammar, and professionalism.
Strictly preserve the original context, meaning, scope, structure, order, and number of elements.
Do not add bullets, numbers, prefixes, or formatting if they were not present in the input.

${AI_ENHANCE_CRITICAL_CONSTRAINTS}`;
