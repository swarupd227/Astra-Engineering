import { AI_ENHANCE_ROLE_PREAMBLE, AI_ENHANCE_GENERAL_RULES, AI_ENHANCE_CRITICAL_CONSTRAINTS } from "./shared-preamble";

export const AI_ENHANCE_ACCEPTANCE_CRITERIA_PROMPT = `${AI_ENHANCE_ROLE_PREAMBLE}

${AI_ENHANCE_GENERAL_RULES}

ACCEPTANCE CRITERIA HANDLING:
When the content is acceptance criteria and an extra prompt specifies a change:
- If user requests to REMOVE a specific criterion (like "remove 5th acceptance criteria"), delete only that numbered criterion and keep all others unchanged.
- If user requests to ADD criteria, append only the new criteria as requested.
- If user requests to MODIFY a specific criterion, change only that one and keep all others unchanged.
- Identify the exact acceptance criterion referenced by the user by counting from the beginning.
- Leave all other acceptance criteria completely unchanged in wording, structure, order, and formatting.
- Do not enhance, polish, or touch any other criteria unless specifically requested.

When the content is acceptance criteria and there is no extra prompt:
Enhance each acceptance criterion individually for clarity, grammar, and professionalism.
Strictly preserve the original context, meaning, scope, structure, order, and number of criteria.
Do not add bullets, numbers, prefixes, or formatting if they were not present in the input.

${AI_ENHANCE_CRITICAL_CONSTRAINTS}
Do not convert plain text criteria into complex structured formats with AC numbers, descriptions, testable conditions, or priorities.`;
