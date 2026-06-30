/**
 * Prompts for the Design Card: user journey (interaction flow), output format, and Phase-2 Figma design prompt.
 * User journey = flow of the application (how the user moves through the app), not a visible UI section.
 */

/** User journey instruction prepended to the requirement document (design content generation). */
export function getDesignCardUserJourneyInstruction(epicCount: number): string {
  const flowClarification =
    "Important: User journey is the INTERACTION FLOW of the application (the steps and screens the user goes through), " +
    'not a visible part of the web application. Use it to structure pages and flows; do not create a visible "User Journey" section in the UI.\n\n';

  if (epicCount <= 1) {
    return (
      "## User Journey (required – start here)\n" +
      flowClarification +
      "Describe the end-to-end interaction flow for this epic (e.g. 1. User lands on X, 2. User does Y, 3. System shows Z). " +
      "Place this flow description at the beginning of your output. Then proceed with the rest of the design.\n\n"
    );
  }
  return (
    "## User Journey (required – start here)\n" +
    flowClarification +
    `You have ${epicCount} epics. First, determine intelligently whether these epics have dependencies ` +
    `(e.g. shared user flows, order dependency, or logical sequence). ` +
    `If they DO have dependencies: describe ONE unified interaction flow that spans all epics. ` +
    `If they do NOT have dependencies: describe SEPARATE flows labeled "Journey 1", "Journey 2", "Journey 3", etc., one per epic. ` +
    `Place the flow description(s) at the beginning of your output. Then proceed with the rest of the design.\n\n`
  );
}

/** User journey task for Phase-2 Figma prompt: flow only, not a UI section to draw. */
export function getDesignCardUserJourneyTaskForFigma(
  epicCount: number,
): string {
  if (epicCount <= 1) {
    return (
      "First, in 1–2 short lines, state the interaction flow for this epic (e.g. User lands on X → does Y → sees Z). " +
      'Do NOT create a visible "User Journey" frame or section in the UI; the flow is for structuring only. ' +
      "Then output Figma instructions as plain text, one instruction per line (see OUTPUT FORMAT below)."
    );
  }
  return (
    `You have ${epicCount} epics. Determine if they have dependencies. ` +
    `If yes: state ONE unified interaction flow in 1–2 lines. If no: state "Journey 1: ...", "Journey 2: ..." in 1–2 lines each. ` +
    'Do NOT create visible "User Journey" frames in the UI; flows are for structuring only. ' +
    "Then output Figma instructions as plain text, one instruction per line (see OUTPUT FORMAT below)."
  );
}

/**
 * Figma Design Guideline — structure and format the model must follow.
 * Ensures output is journey-first, plain text, one instruction per line.
 */
export const FIGMA_DESIGN_GUIDELINE_STRUCTURE = `
# Figma Design Guideline — Output Structure & Format

## Summary
- Single source-of-truth structure: Cover, User Journey/Flows (for organization), Design Tokens, Foundations, UI Kit, Prototypes, Specs.
- User journey = INTERACTION FLOW (how the user moves through the app). Use it to name and order pages/flows. Do NOT draw a "User Journey" frame or section as part of the application UI.
- Output must be PLAIN TEXT only: one imperative instruction per line. No code, no JSON, no markdown, no CreateFrame(...).

## Recommended structure (journey-first)
- Cover (file info, owner, version)
- User Journey / Flows (one page or flow per major user journey; flow = steps/screens, not a UI component)
- Design Tokens (Colors, Typography, Spacing)
- Foundations (Grid, Layout, Icons)
- UI Kit / Components
- Screens (pages and sections the user actually sees)
- Prototypes, Specs

## OUTPUT FORMAT (mandatory)
- One instruction per line.
- Use imperative verbs: Create, Add, Insert, Configure, Place.
- Example format: Create new page named "User Profile"
  Add sidebar navigation label "Profile" linked to "User Profile" page
  Insert section title "Profile Information" at the top of the "User Profile" page
  Add text input fields for "First Name", "Last Name", "Email"
  Insert button labeled "Save Changes" below the input fields
- Do NOT output code blocks, JSON, CreateFrame(...), or any programming syntax.
- Do NOT output a visible "User Journey" or "User Journey Section" as part of the app; the journey is the flow used to organize the file only.
`.trim();

/**
 * Builds the Phase-2 design prompt template for Figma Make.
 * Enforces plain-text, one-instruction-per-line format and journey-as-flow (not UI).
 */
export function buildPhase2DesignPromptTemplate(
  userJourneyTask: string = "",
  baseDesignContext: string = "",
  designIntent: string = "",
  storyContext: string = "",
  epicDomainContext: string = "",
): string {
  const journeySection = userJourneyTask
    ? `USER JOURNEY (flow only – do this first):\n${userJourneyTask}\n\n`
    : "";

  const baseContextSection =
    baseDesignContext && baseDesignContext.trim()
      ? `PHASE-1 BASE DESIGN PROMPT (already exists — build on top of it, do NOT recreate it):\n${baseDesignContext.trim()}\n\n`
      : "";

  // Epic/product backdrop: keeps every story visually and semantically consistent
  // with the real product (use real domain screens/terms, NOT generic placeholders
  // like "AppName"). This is supporting context only — the USER STORY is primary.
  const epicDomainSection =
    epicDomainContext && epicDomainContext.trim()
      ? `PRODUCT / EPIC DOMAIN CONTEXT (backdrop — keep the design consistent with THIS product and use its real domain terminology; the USER STORY below is the primary driver):\n${epicDomainContext.trim()}\n\n`
      : "";

  const storySection =
    storyContext && storyContext.trim()
      ? `USER STORY & ACCEPTANCE CRITERIA (design specifically for THIS story — this is the part that changes per story):\n${storyContext.trim()}\n\n`
      : "";

  const intentSection =
    designIntent && designIntent.trim()
      ? `DERIVED UI REQUIREMENTS FOR THIS STORY:\n${designIntent.trim()}\n\n`
      : "";

  return `
You are CONTINUING an existing application design created in Phase-1.

${FIGMA_DESIGN_GUIDELINE_STRUCTURE}

---

Context already exists:
- Global application layout
- Sidebar navigation
- Dashboard shell
- Design tokens (colors, typography, spacing)
- Reusable component library

You are provided with the following inputs. You MUST design for the SPECIFIC user story below — do not produce generic output, and base every new UI element on this story's content and acceptance criteria. Use the PRODUCT / EPIC DOMAIN CONTEXT to ground the design in real domain terminology and screens (never use generic placeholders like "AppName", "Welcome Back", or fake stats):

${baseContextSection}${epicDomainSection}${storySection}${intentSection}TASK:
${journeySection}Analyze all provided context above and determine what new UI elements are required
to continue the existing design FOR THIS SPECIFIC STORY.

You must dynamically infer and resolve:
- Whether the feature requires a NEW PAGE or an EXTENSION of an existing page
- The appropriate page name and sidebar navigation label (if a page is needed)
- Section titles derived from the user story and domain language
- Required UI components based on acceptance criteria
- Necessary UI states (loading, error, empty, success)

RULES:
- Assume all Phase-1 structures already exist
- Do NOT redefine or recreate global layout, sidebar, dashboard, or tokens
- Do NOT hardcode names unless clearly derived from the user story
- Resolve ALL labels and names explicitly (no placeholders)
- Decide placement logically (page vs dashboard) based on feature depth
- Output ONLY plain text: one Figma instruction per line (e.g. "Create new page named \"X\"", "Add sidebar navigation label \"Y\"")
- Use only imperative verbs: Create, Add, Insert, Configure, Place
- Do NOT output code (no CreateFrame, no JSON, no markdown, no backticks)
- Do NOT include explanations, headings, or summaries
- Do NOT create a visible "User Journey" frame or section in the application UI; user journey is the interaction flow for structuring only

OUTPUT:
Plain text only. One instruction per line. Ready for execution. No code blocks.
Example first lines:
Create new page named "<Page Name>"
Add sidebar navigation label "<Label>" linked to "<Page Name>" page
Insert section title "<Title>" at the top of the "<Page Name>" page
`.trim();
}
