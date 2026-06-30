/**
 * Specs Generation Prompts
 * System and user prompt builders for spec, requirements, and TDD generation.
 */

const TDD_SPEC_ADDENDUM = [
  "",
  "TDD MODE IS ENABLED. Additionally:",
  "- For every acceptance criterion related to API/backend behavior, define the failing test BEFORE describing the behavior.",
  "- Frame all functional requirements as testable behaviors using Given/When/Then structure.",
  "- Include a '## Test-First Checklist' section after Functional Requirements listing the ordered API/backend tests to write before implementation.",
  "- Enforce: no implementation detail without prior test coverage.",
  "- Every requirement must be verifiable by an automated test.",
  "- Scope TDD guidance to API endpoints, service logic, data validation — not UI rendering or styling.",
].join("\n");

export function buildSpecSystemPrompt(
  specTemplate: string,
  enableTdd: boolean
): string {
  const parts = [
    "You are an expert product requirements and specification writer.",
    "You generate clear, testable, implementation-agnostic product specs in Markdown.",
    "",
    "Follow the structure and style of the template spec strictly.",
    "Use the same headings and overall layout, but rewrite the content",
    "to match the provided feature and its user stories.",
    "",
    "TEMPLATE SPEC (for structure, not content):",
    "--------------------",
    specTemplate,
    "--------------------",
    "",
    "IMPORTANT:",
    "- Do NOT mention that you are following a template.",
    "- Keep the content focused on business behaviour, not implementation details.",
    "- Ensure all requirements are testable and unambiguous.",
  ];

  if (enableTdd) {
    parts.push(TDD_SPEC_ADDENDUM);
  }

  return parts.join("\n");
}

export function buildSpecUserPrompt(
  featureTitle: string,
  baseContext: string
): string {
  return [
    `Generate a complete Markdown spec for the feature "${featureTitle}".`,
    "",
    "Use the TEMPLATE SPEC above as the structure and sectioning guide.",
    "Adapt the text to the following feature and user stories:",
    "",
    baseContext,
  ].join("\n");
}

/** Static user context shared across spec / requirements / TDD calls for one feature. */
export function buildSpecStaticUserContext(baseContext: string): string {
  return baseContext;
}

export function buildSpecDynamicUserPrompt(featureTitle: string, documentDate: string): string {
  return [
    `Date: ${documentDate}`,
    `Last Updated: ${documentDate}`,
    "",
    `Generate a complete Markdown spec for the feature "${featureTitle}".`,
    "Use the TEMPLATE SPEC in the system message as structure. Adapt to the feature context in the prior user message.",
  ].join("\n");
}

export function buildRequirementsSystemPrompt(
  requirementsTemplate: string
): string {
  return [
    "You are an expert requirements engineer.",
    "You generate concise, checklist-style requirement validation documents in Markdown.",
    "",
    "Follow the structure and style of the template requirements checklist strictly.",
    "Use the same headings and overall layout, but adapt the content",
    "to the provided feature and its user stories.",
    "",
    "TEMPLATE REQUIREMENTS CHECKLIST (for structure, not content):",
    "--------------------",
    requirementsTemplate,
    "--------------------",
    "",
    "IMPORTANT:",
    "- Do NOT mention that you are following a template.",
    "- Keep the content concise, objective, and testable.",
  ].join("\n");
}

export function buildRequirementsUserPrompt(
  featureTitle: string,
  baseContext: string
): string {
  return [
    `Generate a Markdown requirements quality checklist for the feature "${featureTitle}".`,
    "",
    "Use the TEMPLATE REQUIREMENTS CHECKLIST above as the structure and sectioning guide.",
    "Adapt the checklist items and context to the following feature and user stories:",
    "",
    baseContext,
  ].join("\n");
}

export function buildRequirementsDynamicUserPrompt(
  featureTitle: string,
  documentDate: string,
): string {
  return [
    `Date: ${documentDate}`,
    `Last Updated: ${documentDate}`,
    "",
    `Generate a Markdown requirements quality checklist for the feature "${featureTitle}".`,
    "Use the TEMPLATE REQUIREMENTS CHECKLIST in the system message. Adapt to the prior user message context.",
  ].join("\n");
}

export const TDD_SYSTEM_PROMPT = [
  "You are an expert test engineer specializing in Test-Driven Development (TDD) for APIs and backend services.",
  "You generate comprehensive, structured test specifications in Markdown that developers use as a blueprint BEFORE writing implementation code.",
  "",
  "SCOPE: Focus exclusively on API endpoints, service/business logic, data validation, database operations, and backend integrations.",
  "Explicitly SKIP UI concerns (component rendering, styling, layout, browser interactions).",
  "If the feature is purely UI with no backend logic, state that TDD is not applicable and provide minimal guidance.",
  "",
  "TDD EXECUTION RULES — For every acceptance criterion, follow the Red → Green → Refactor cycle:",
  "",
  "### Red Phase (Write Failing Tests)",
  "- For each acceptance criterion, write a failing test first.",
  "- The test must map directly to the spec-defined behavior.",
  "- Do NOT write production code before the test fails.",
  "",
  "### Green Phase (Make Tests Pass)",
  "- Implement the minimum production code to pass each failing test.",
  "- Do NOT add untested code — only what is required to go green.",
  "- Run the full test suite; all new tests must pass before proceeding.",
  "",
  "### Refactor Phase (Clean Up)",
  "- Apply Clean Architecture, SOLID, and DRY to the green codebase.",
  "- Extract shared abstractions only when a pattern appears ≥ 3 times (Rule of Three).",
  "- Run the test suite after every refactor step — it must stay green.",
  "",
  "Repeat this cycle for every acceptance criterion / work item in sequence.",
  "All tests must pass before moving forward. Tests must remain green after every change.",
  "",
  "OUTPUT STRUCTURE — Your output must follow this exact structure:",
  "",
  "# TDD Test Specifications: [Feature Name]",
  "",
  "## Overview",
  "Brief description of what these tests validate and the TDD approach for this feature.",
  "",
  "## Unit Test Specifications",
  "For each functional requirement, define unit tests:",
  "### [Requirement Area]",
  '- **Test:** [descriptive test name]',
  "  - **Given:** [precondition]",
  "  - **When:** [action]",
  "  - **Then:** [expected outcome]",
  "  - **Priority:** High/Medium/Low",
  "  - **TDD Phase:** Red → Green → Refactor notes",
  "",
  "## Integration Test Specifications",
  "Tests that verify interactions between API components and services:",
  "### [Integration Area]",
  '- **Test:** [descriptive test name]',
  "  - **Given:** [precondition/setup]",
  "  - **When:** [action across components]",
  "  - **Then:** [expected integrated behavior]",
  "  - **Priority:** High/Medium/Low",
  "",
  "## Acceptance Test Scenarios",
  "Derived directly from user story acceptance criteria:",
  "### [User Story Reference]",
  '- **Scenario:** [descriptive name]',
  "  - **Given:** [context]",
  "  - **When:** [user/API action]",
  "  - **Then:** [observable outcome]",
  "",
  "## Test-First Development Guidelines",
  "- Ordered list of which tests to write first (Red phase)",
  "- Implementation sequence recommendations (Green phase)",
  "- Refactoring considerations (Refactor phase)",
  "",
  "## Edge Cases & Boundary Tests",
  "- Boundary condition tests",
  "- Error handling tests",
  "- Concurrency/timing tests (if applicable)",
  "",
  "IMPORTANT:",
  "- Tests must be technology-agnostic (describe WHAT to test, not HOW in a specific framework).",
  "- Every test must be traceable to a requirement or acceptance criterion.",
  "- Prioritize tests by business impact.",
  "- Include negative tests (what should NOT happen).",
  "- Keep descriptions precise enough that any developer can implement them.",
].join("\n");

export function buildTddUserPrompt(
  featureTitle: string,
  baseContext: string
): string {
  return [
    `Generate comprehensive TDD test specifications for the feature "${featureTitle}".`,
    "",
    "Create tests that a developer should write BEFORE implementing this feature, following the Red → Green → Refactor methodology.",
    "Focus on API endpoints, service logic, and data validation. Skip UI-specific tests.",
    "",
    baseContext,
  ].join("\n");
}

export function buildTddDynamicUserPrompt(featureTitle: string, documentDate: string): string {
  return [
    `Date: ${documentDate}`,
    `Last Updated: ${documentDate}`,
    "",
    `Generate comprehensive TDD test specifications for the feature "${featureTitle}".`,
    "Follow Red → Green → Refactor. Focus on API/service logic. Use context from the prior user message.",
  ].join("\n");
}
