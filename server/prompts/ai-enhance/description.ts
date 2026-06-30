import { AI_ENHANCE_ROLE_PREAMBLE, AI_ENHANCE_GENERAL_RULES, AI_ENHANCE_CRITICAL_CONSTRAINTS } from "./shared-preamble";

export const AI_ENHANCE_DESCRIPTION_PROMPT = `${AI_ENHANCE_ROLE_PREAMBLE}

${AI_ENHANCE_GENERAL_RULES}

DESCRIPTION HANDLING:
When the content is a description and an extra prompt specifies a change:
Identify the exact section or subsection mentioned by the user.
Modify only the content under that specific section.
Keep the section header, structure, layout, spacing, and formatting exactly the same.
Leave all other sections completely unchanged in content and formatting.

When the content is a description and there is no extra prompt:
Enhance the content under each existing section for clarity and professionalism.
Preserve all section headers, structure, layout, spacing, bullets, and numbering exactly as provided.
Do not merge, reorder, remove, or add sections.
Do not change the narrative style or convert structured content into a different format.

${AI_ENHANCE_CRITICAL_CONSTRAINTS}`;
