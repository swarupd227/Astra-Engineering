/**
 * skill-llm-generator.ts
 *
 * Generates context-aware SKILL.md bodies using the project's configured LLM.
 * Each skill type (implement, validate, next, autopilot, ui-skill) receives a
 * prompt tailored to the actual project — its name, architecture, features,
 * and golden repo context (when available).
 *
 * Falls back to the static template bodies if any LLM call fails, so
 * generation never aborts because of a SKILL.md error.
 */

import { callLlmWithRetry } from "./llm-caller";

// ── Types ─────────────────────────────────────────────────────────────────

export interface SkillGenerationContext {
  projectName: string;
  projectDescription?: string;
  architectureStyle: "monolith" | "microservices";
  enableTdd: boolean;
  features: Array<{
    id: number;
    title: string;
    userStories: Array<{ id: number; title: string }>;
  }>;
  goldenRepoContext?: {
    repoName?: string;
    organization?: string;
    project?: string;
    selectedPaths?: string[];
    uiDesignPackage?: {
      sourceFiles: Array<{ path: string; size: number }>;
      generatedAt: string;
    };
  };
  llmProvider: string;
}

export interface GeneratedSkillBodies {
  implement: string;
  validate: string;
  next: string;
  autopilot: string;
  uiSkill: string;
}

// ── Shared prompt helpers ──────────────────────────────────────────────────

function buildProjectSummary(ctx: SkillGenerationContext): string {
  const featureList = ctx.features
    .map(
      (f) =>
        `  - ${f.title} (${f.userStories.length} user ${f.userStories.length === 1 ? "story" : "stories"})`,
    )
    .join("\n");

  const descLine = ctx.projectDescription
    ? `Description: ${ctx.projectDescription.slice(0, 300)}\n`
    : "";

  return [
    `Project: ${ctx.projectName}`,
    descLine,
    `Architecture: ${ctx.architectureStyle}`,
    `TDD enabled: ${ctx.enableTdd ? "yes" : "no"}`,
    "",
    `Features (${ctx.features.length}):`,
    featureList,
  ]
    .filter((l) => l !== undefined)
    .join("\n");
}

function buildGoldenRepoSummary(ctx: SkillGenerationContext): string {
  const g = ctx.goldenRepoContext;
  if (!g?.repoName && !g?.organization && !(g?.selectedPaths?.length)) {
    return "No golden repository is configured. Base all guidance on local project conventions.";
  }

  const paths = g.selectedPaths?.filter(Boolean) ?? [];
  const pathLines =
    paths.length > 0
      ? paths.map((p) => `  - ${p}`).join("\n")
      : "  (no explicit paths — derive from feature scope)";

  return [
    `Golden repository: ${g.repoName || "configured"}`,
    g.organization ? `  Organization: ${g.organization}` : "",
    g.project ? `  Project: ${g.project}` : "",
    g.uiDesignPackage
      ? `  Local UI/UX design artifacts: specs/.devx/skills/ui-skill/golden-ui-design-system.md and specs/.devx/skills/ui-skill/golden-ui-design-sources.md (${g.uiDesignPackage.sourceFiles.length} source files)`
      : "",
    "  Preferred reference paths:",
    pathLines,
    "",
    g.uiDesignPackage
      ? "When generating UI guidance, instruct the AI agent to read the local packaged UI/UX artifacts instead of requiring live Golden Repository access."
      : "When generating guidance, instruct the AI agent to reference this golden repo for naming conventions, code structure, and implementation patterns.",
  ]
    .filter(Boolean)
    .join("\n");
}

const SKILL_SYSTEM_PROMPT = `You are an expert software engineering assistant.
Your task is to write the BODY content for a Claude Code SKILL.md file.

Rules:
- Write practical, actionable guidance tailored to the specific project described.
- Use markdown headings, numbered lists, and bullet points.
- Reference the project name, features, and golden repo where appropriate.
- Do NOT include the YAML frontmatter block (---...---).
- Do NOT include the "## LLM Runtime Context" or "## Golden Repository Context" sections — those are added separately.
- Start directly with the main heading (e.g., "# /implement — ...").
- Be concise but thorough. Target 400–600 words for the body.
- Make the workflow steps feel tailored to this project, not generic boilerplate.`;

// ── Per-skill prompt builders ─────────────────────────────────────────────

function buildImplementPrompt(ctx: SkillGenerationContext): string {
  return `${buildProjectSummary(ctx)}

${buildGoldenRepoSummary(ctx)}

Write the BODY of the /implement SKILL.md for this project.
The skill guides an AI agent to implement one feature at a time using the Spec-Driven Development workflow.
${ctx.enableTdd ? "TDD is enabled — include Red-Green-Refactor cycle guidance." : "TDD is not enabled."}

Include:
1. A short description of what this skill does for ${ctx.projectName}
2. A numbered Workflow section (tracking preflight, reading specs, ${ctx.enableTdd ? "TDD cycle, " : ""}implementation plan, implementing per-requirement, validation, status update)
3. A Rules section with project-aware constraints
4. Reference the ${ctx.architectureStyle} architecture where relevant (${ctx.architectureStyle === "microservices" ? "mention checking feature-routing.json for repo ownership" : "note all specs stay in one repo"})`;
}

function buildValidatePrompt(ctx: SkillGenerationContext): string {
  return `${buildProjectSummary(ctx)}

${buildGoldenRepoSummary(ctx)}

Write the BODY of the /validate SKILL.md for this project.
The skill guides an AI agent to validate implemented code against the requirements checklist for a specific feature.

Include:
1. A short description of what this skill does for ${ctx.projectName}
2. A numbered Workflow section (identify feature, read requirements.md, read specs.md for context, check each requirement in code, generate pass/fail report)
3. A clear Output Format section showing the validation report table format
4. A Rules section emphasising thoroughness and not marking done unless all pass
${ctx.enableTdd ? "5. A note to verify TDD tests pass as part of validation" : ""}`;
}

function buildNextPrompt(ctx: SkillGenerationContext): string {
  const featureTitles = ctx.features.slice(0, 3).map((f) => f.title).join(", ");
  const exampleFeature = ctx.features[0]?.title || "first feature";

  return `${buildProjectSummary(ctx)}

${buildGoldenRepoSummary(ctx)}

Write the BODY of the /next SKILL.md for this project.
The skill guides an AI agent to show the next unimplemented feature from the spec index and ask whether to start implementing it.

Include:
1. A short description tailored to ${ctx.projectName} (mention it has ${ctx.features.length} features like ${featureTitles}${ctx.features.length > 3 ? " and more" : ""})
2. A numbered Workflow section (tracking preflight, read features.json, find first PENDING, display summary including file paths, ask user to proceed)
3. An Output Format section showing a sample output block referencing "${exampleFeature}" as an example
4. A brief note about what happens next (proceed to /implement or show full list)`;
}

function buildAutopilotPrompt(ctx: SkillGenerationContext): string {
  return `${buildProjectSummary(ctx)}

${buildGoldenRepoSummary(ctx)}

Write the BODY of the /autopilot SKILL.md for this project.
The skill guides an AI agent to implement all remaining features end-to-end in a loop.

Include:
1. A short description for ${ctx.projectName} mentioning it will implement up to ${ctx.features.length} features
2. An Arguments section (optional max-features count)
3. A Phase-based Workflow (Phase 0: Tracking Preflight, Phase 1: Pick Next Feature, Phase 2: Read Specs${ctx.enableTdd ? ", Phase 2b: TDD Cycle" : ""}, Phase 3: Implement, Phase 4: Validate, Phase 5: Mark Done, Phase 6: Continue or Stop)
4. Output Between Features section showing a brief status block after each feature
5. A Final Summary section
6. Rules (never skip validation, stop on repeated failure, commit after each feature${ctx.enableTdd ? ", follow TDD strictly" : ""})`;
}

function buildUiSkillPrompt(ctx: SkillGenerationContext): string {
  const hasGolden = Boolean(ctx.goldenRepoContext?.repoName || ctx.goldenRepoContext?.organization);
  const hasLocalUiPackage = Boolean(ctx.goldenRepoContext?.uiDesignPackage);
  const goldenNote = hasGolden
    ? hasLocalUiPackage
      ? `The project has a self-contained local UI/UX design package extracted from the golden repo (${ctx.goldenRepoContext?.repoName || "configured"}). Instruct the agent to read \`specs/.devx/skills/ui-skill/golden-ui-design-system.md\` first and use \`specs/.devx/skills/ui-skill/golden-ui-design-sources.md\` for exact source details. Do not require live Golden Repository access.`
      : `The project has a golden repo (${ctx.goldenRepoContext?.repoName || "configured"}) — instruct the agent to reference its UI patterns, component structure, typography, spacing, and interaction states.`
    : "No golden repo is configured — instruct the agent to infer patterns from existing local UI code.";

  return `${buildProjectSummary(ctx)}

${buildGoldenRepoSummary(ctx)}

Write the BODY of the /ui-skill SKILL.md for this project.
The skill guides an AI agent to implement high-quality UI changes with strong design consistency.

${goldenNote}

Include:
1. A short description for ${ctx.projectName} UI work
2. ${hasLocalUiPackage ? "A Local Golden UI/UX Package section that makes the packaged design-system and raw source files mandatory reading" : hasGolden ? "A UI Golden-Repo Application section with specific guidance on referencing the golden repo's UI patterns" : "A UI Fallback Strategy section on deriving patterns from existing local code"}
3. A Workflow section (understand scope from specs, inspect existing UI system, plan states and responsiveness, implement incrementally, validate quality)
4. A UI Quality Checklist (consistency, shared components/tokens, accessibility, responsiveness, state handling)
5. Rules (prefer extending existing components, no global convention changes without explicit requirement)
6. A clear rule that local extracted UI/UX artifacts are authoritative for Golden Repo design guidance when present`;
}

// ── Static fallback bodies (used when LLM fails) ──────────────────────────

function staticImplementBody(enableTdd: boolean): string {
  const tddStep = enableTdd
    ? `
4. Read the TDD test specifications:
   - Open \`specs/<slug>/tdd-tests.md\`
   - For each acceptance criterion, follow the Red-Green-Refactor cycle:
     a. **Red:** Write a failing test that maps to the criterion
     b. **Green:** Write the minimum production code to make the test pass
     c. **Refactor:** Clean up while keeping all tests green
   - Do not proceed to the next criterion until the current one is fully green`
    : "";

  return `# /implement  -  Implement a Feature

> Pick a feature from the spec index, read its full specification, and generate an implementation plan.

## Workflow

0. Run tracking preflight:
   - Execute \`bash specs/.devx/validate-tracking.sh\`
   - If it reports uncommitted or unpushed changes, stop and ask the user to commit/push or stash first

1. Read the feature index:
   - Open \`specs/.devx/features.json\`
   - Open \`specs/.devx/tracker.json\`
   - Find the first feature whose tracker entry has \`"status": "PENDING"\`, or ask the user which feature to implement
   - Note the feature slug

2. Read the full specification:
   - Open \`specs/<slug>/specs.md\`
   - Understand the Summary, Key Features, Functional Requirements, and User Scenarios
   - Do not skip any section

3. Read the requirements checklist:
   - Open \`specs/<slug>/requirements.md\`
   - This is the acceptance criteria  -  every item must be satisfied
${tddStep}

${enableTdd ? "5" : "4"}. Create an implementation plan:
   - Break the work into concrete steps based on the requirements
   - Identify files to create or modify
   - Identify dependencies between requirements
   - Present the plan to the user for approval

${enableTdd ? "6" : "5"}. Implement one requirement at a time:
   - Follow the spec exactly  -  do not add features not described
   - After each requirement, verify it against requirements.md
${enableTdd ? "   - Ensure all TDD tests pass before moving to the next requirement\n" : ""}
${enableTdd ? "7" : "6"}. After all requirements are complete:
   - Review the full requirements.md checklist
   - Verify all user scenarios from specs.md work correctly
   - Update features.json status to "done" and tracker.json status to "COMPLETED"

## Rules

- **Do not deviate from the specification.** If the spec is wrong, update it first.
- **One requirement at a time.** Complete and validate before moving on.
- **Requirements are the source of truth** for what "done" means.
${enableTdd ? "- **Follow TDD strictly.** No production code before a failing test exists.\n" : ""}- **No gold-plating.** Do not add features beyond what the spec describes.
`;
}

function staticValidateBody(): string {
  return `# /validate  -  Validate Implementation Against Requirements

> Check the current code against the requirements checklist for a specific feature.

## Workflow

0. Run tracking preflight:
   - Execute \`bash specs/.devx/validate-tracking.sh\`

1. Identify the feature to validate:
   - Ask the user which feature to validate, or use the most recently implemented one
   - Find it in \`specs/.devx/features.json\` by slug, title, or ID

2. Read the requirements checklist:
   - Open \`specs/<slug>/requirements.md\`

3. Read the specification for context:
   - Open \`specs/<slug>/specs.md\`

4. For each requirement in the checklist:
   - Search the codebase to verify it is implemented
   - Mark each requirement as PASS or FAIL with a brief explanation

5. Generate a validation report:
   - List each requirement with its PASS/FAIL status
   - Provide a summary: X of Y requirements satisfied

## Output Format

\`\`\`
## Validation Report  -  <Feature Title>

| # | Requirement | Status | Notes |
|---|-------------|--------|-------|
| 1 | <requirement text> | PASS/FAIL | <explanation> |

**Result: X/Y requirements satisfied**
\`\`\`

## Rules

- Be thorough  -  check actual implementation, not just file existence
- Do not mark a requirement as PASS if it is only partially implemented
`;
}

function staticNextBody(): string {
  return `# /next  -  Show Next Feature to Implement

> Display the next unimplemented feature from the spec index.

## Workflow

0. Run tracking preflight:
   - Execute \`bash specs/.devx/validate-tracking.sh\`

1. Read the feature index:
   - Open \`specs/.devx/features.json\`

2. Find the next feature:
   - Look for the first feature with \`"status": "not-started"\`

3. Display the feature summary:
   - Title, slug, user story count, and file paths

4. Ask the user if they want to start implementing it.
`;
}

function staticAutopilotBody(enableTdd: boolean): string {
  return `# /autopilot  -  Implement All Features Automatically

> Chains the full SDD${enableTdd ? " + TDD" : ""} workflow in a loop: pick next  ->  implement  ->  validate  ->  mark done  ->  repeat.

## Workflow

For each unimplemented feature, execute these phases:

### Phase 0  -  Tracking Preflight
Run \`bash specs/.devx/validate-tracking.sh\` and stop if dirty.

### Phase 1  -  Pick Next Feature
Find the first feature with tracker status "PENDING".

### Phase 2  -  Read Specs
Read specs.md, requirements.md${enableTdd ? ", tdd-tests.md" : ""}.

### Phase 3  -  Implement
Implement each requirement one at a time.

### Phase 4  -  Validate
Verify all requirements are satisfied.

### Phase 5  -  Mark Done
Update features.json and tracker.json.

### Phase 6  -  Continue or Stop
Check max-features limit, continue or report completion.

## Rules

- Never skip validation.
- Stop on repeated failure (3 times).
- Commit after each feature.
${enableTdd ? "- Follow TDD strictly.\n" : ""}- No gold-plating.
`;
}

function staticUiSkillBody(hasGolden: boolean, hasLocalUiPackage: boolean): string {
  return `# /ui-skill  -  UI Implementation Excellence

> Build production-ready UI with strong consistency, accessibility, and responsiveness.

${hasLocalUiPackage ? "## Local Golden UI/UX Package\n\nRead `specs/.devx/skills/ui-skill/golden-ui-design-system.md` before implementation. Use `specs/.devx/skills/ui-skill/golden-ui-design-sources.md` for exact source details, token values, CSS/SCSS rules, component examples, utilities, layout behavior, accessibility requirements, and naming conventions. These files are the local Golden Repo design source of truth; do not require live Golden Repository access in the IDE." : hasGolden ? "## UI Golden-Repo Application\n\nReference the configured golden repository for UI patterns, component structure, and design conventions." : "## UI Fallback Strategy\n\nInfer patterns from existing local UI code. Reuse shared primitives and utilities."}

## Workflow

1. Understand scope — read specs and requirements files
2. Read local UI guidance — start with the packaged Golden UI/UX artifacts when present
3. Inspect existing UI system — locate shared components and tokens
4. Plan before coding — list files, states, and responsive breakpoints
5. Implement incrementally — semantic HTML, accessible labels, consistent spacing
6. Validate quality — responsiveness, contrast, state behavior, no regressions

## UI Quality Checklist

- Consistent with existing design language
- Uses shared components/tokens where available
- Accessible labels, keyboard flow, and focus states
- Responsive across key viewports
- Clear state handling and user feedback

## Rules

- Prefer extending existing components over creating new patterns.
- Keep implementation maintainable and testable.
`;
}

// ── Main exported function ────────────────────────────────────────────────

/**
 * Generates all 5 SKILL.md bodies using the configured LLM.
 * Runs all calls in parallel. Falls back to static templates on any failure.
 */
export async function generateAllSkillBodies(
  ctx: SkillGenerationContext,
): Promise<GeneratedSkillBodies> {
  const hasGolden = Boolean(
    ctx.goldenRepoContext?.repoName || ctx.goldenRepoContext?.organization,
  );
  const hasLocalUiPackage = Boolean(ctx.goldenRepoContext?.uiDesignPackage);

  const callSkillLlm = async (
    label: string,
    userPrompt: string,
    fallback: string,
  ): Promise<string> => {
    try {
      const result = await callLlmWithRetry(`SKILL.md [${label}] for "${ctx.projectName}"`, {
        systemPrompt: SKILL_SYSTEM_PROMPT,
        userPrompt,
        temperature: 0.3,
        maxTokens: 1200,
      });
      return result.trim() || fallback;
    } catch (err) {
      console.warn(
        `[SpecsGenerator] SKILL.md LLM generation failed for "${label}", using static fallback.`,
        err,
      );
      return fallback;
    }
  };

  const [implement, validate, next, autopilot, uiSkill] = await Promise.all([
    callSkillLlm(
      "implement",
      buildImplementPrompt(ctx),
      staticImplementBody(ctx.enableTdd),
    ),
    callSkillLlm(
      "validate",
      buildValidatePrompt(ctx),
      staticValidateBody(),
    ),
    callSkillLlm(
      "next",
      buildNextPrompt(ctx),
      staticNextBody(),
    ),
    callSkillLlm(
      "autopilot",
      buildAutopilotPrompt(ctx),
      staticAutopilotBody(ctx.enableTdd),
    ),
    callSkillLlm(
      "ui-skill",
      buildUiSkillPrompt(ctx),
      staticUiSkillBody(hasGolden, hasLocalUiPackage),
    ),
  ]);

  return { implement, validate, next, autopilot, uiSkill };
}
