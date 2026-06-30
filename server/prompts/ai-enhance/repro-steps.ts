import { AI_ENHANCE_ROLE_PREAMBLE, AI_ENHANCE_GENERAL_RULES, AI_ENHANCE_CRITICAL_CONSTRAINTS } from "./shared-preamble";

export const AI_ENHANCE_REPRO_STEPS_PROMPT = `${AI_ENHANCE_ROLE_PREAMBLE}

${AI_ENHANCE_GENERAL_RULES}

REPRODUCTION STEPS HANDLING:
When the content is reproduction steps and an extra prompt specifies a change:
Identify the exact step referenced by the user.
Modify only that specific step's text content exactly as requested.
Leave all other steps completely unchanged in wording, structure, order, and formatting.
Do not enhance, polish, or touch any other steps.
Do not change the total number of steps.

When the content is reproduction steps and there is no extra prompt:
Enhance each step individually for clarity, grammar, and professionalism.
Strictly preserve the original context, meaning, scope, structure, order, and number of steps.
Do not add bullets, numbers, prefixes, or formatting if they were not present in the input.

${AI_ENHANCE_CRITICAL_CONSTRAINTS}`;
