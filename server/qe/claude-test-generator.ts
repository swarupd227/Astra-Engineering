import pLimit from "p-limit";
import type { EnrichedProjectContext } from "./context-enricher.js";
export type { EnrichedProjectContext };

export const GENERATOR_VERSION = "1.1.0";

export interface UserStoryInput {
  workItemId: number;
  title: string;
  description: string;
  acceptanceCriteria: string;
}

export interface TestStep {
  step_number: number;
  action: string;
  expected_behavior: string;
}

export interface GeneratedTestCase {
  testCaseId: string;
  title: string;
  description?: string;
  objective: string;
  preconditions: string[];
  testSteps: TestStep[];
  expectedResult: string;
  postconditions?: string[];
  testData: Record<string, any>;
  testType: "Functional" | "Negative" | "Edge" | "Security" | "Accessibility";
  category?: string;
  priority: "P0" | "P1" | "P2" | "P3";
}

export interface CoverageSummary {
  totalTests: number;
  criteriaCount: number;
  fieldsDetected: number;
  valuesDetected: number;
  byCategory: Record<string, number>;
  /** Human-readable one-liner for the UI */
  coverageStatement: string;
  generatorVersion: string;
}

// ─── Story context (extracted from all three fields) ─────────────────────────

interface StoryContext {
  featureName: string;           // from title
  userRole: string;              // "As a [role]" from description (or title fallback)
  goal: string;                  // "I need..." from description
  businessReason: string;        // "so that..." from description
  criteria: string[];            // individual acceptance criteria lines
  specificValues: string[];      // concrete domain values (quoted / hyphenated compound nouns)
  specificFields: string[];      // field names like "product type", "classification"
  specificActions: string[];     // verbs like "stores", "flags", "makes available"
  downstreamEffects: string[];   // downstream systems/checks affected
  entities: string[];            // named proper-noun things from title
}

// ─── Comprehensive stop-word / stop-phrase list ───────────────────────────────
// We reject noun-phrase candidates if ANY word in the phrase is on this list.
const STOP_WORDS = new Set([
  "the", "and", "for", "with", "that", "this", "from", "into", "when", "also",
  "will", "have", "been", "they", "each", "some", "such", "more", "must", "then",
  "make", "user", "system", "should", "shall", "given", "when", "then", "able",
  "using", "used", "use", "can", "may", "does", "done", "data", "test", "case",
  "value", "item", "page", "view", "form", "list", "type", "field", "button",
  "input", "label", "text", "link", "name", "enter", "click", "open", "close",
  "save", "load", "send", "gets", "sets", "has", "its", "any", "all", "not",
  "only", "both", "here", "there", "after", "before", "above", "below", "under",
  "over", "where", "which", "their", "those", "these", "while", "about", "valid",
  "invalid", "new", "old", "first", "last", "next", "back", "home", "main",
  "same", "other", "good", "true", "false", "null", "none", "empty", "full",
  "long", "short", "high", "low", "big", "small", "check", "verify", "ensure",
  "confirm", "please", "correct", "wrong", "error", "right", "left", "top",
]);

function isStopPhrase(phrase: string): boolean {
  const words = phrase.toLowerCase().split(/\s+/);
  return words.some(w => STOP_WORDS.has(w));
}

// Detect structural lines (markdown headings, pure section labels, ALL-CAPS
// labels, multi-word title-case headings) so the criteria parser doesn't
// promote them into phantom acceptance criteria. Mirrors the same heuristic
// used by the Coverage Intelligence dashboard's fallback parser.
function isStructuralLine(raw: string): boolean {
  let s = raw.trim();
  if (!s) return true;
  if (/^#+\s/.test(s)) return true;
  s = s.replace(/^(?:[-*•]\s*|\d+[.)]\s*|AC\s*\d+\s*[:.)]\s*|>\s*)+/i, "").trim();
  if (!s) return true;
  if (/^[^.!?]+:\s*$/.test(s) && s.length < 80) return true;
  if (/^[A-Z][A-Z\s&\/_\-:]+$/.test(s) && s.length < 50) return true;
  if (!/[.!?]/.test(s) && s.length < 80) {
    const words = s.split(/\s+/);
    const titleCount = words.filter(w => /^[A-Z][a-z0-9]+$/.test(w)).length;
    if (titleCount >= 3 && titleCount / words.length >= 0.6) return true;
  }
  return false;
}

// Headers that mark the END of the acceptance criteria block. Anything below
// these (design prompts, Figma instructions, UI interaction flows, wireframe
// notes) is design-time guidance, not testable acceptance criteria. We
// truncate the AC text at the first such marker so verbose Jira/ADO stories
// that paste the entire description + AC + design notes into a single AC
// field don't blow up the test generator with hundreds of phantom criteria.
const SECTION_BOUNDARY_RE =
  /^(?:#+\s*)?(?:design\s+prompt|figma(?:\s+make)?\s+instructions?|interaction\s+flow|user\s+interaction\s+flow|wireframe|mockup|create\s+(?:page|component|system\s+state|admin\s+page)|layout|components?|sections?|behavior|responsive\s+behavior|error\s+state|states|validation\s+rules|feedback\s+states|out\s+of\s+scope|technical\s+considerations|key\s+functionality|user\s+story\s+title|description|context\s*&\s*background|current\s+state|desired\s+state)\b\s*:?\s*$/i;

// Truncate the raw AC blob at the first section boundary so we only consider
// the lines that genuinely belong to the acceptance-criteria region. If an
// explicit "Acceptance Criteria:" header exists, we additionally trim
// everything above it so SUCCESS METRICS / KEY FUNCTIONALITY etc. above the
// header don't leak into the criteria list.
function extractCriteriaSection(raw: string): string {
  if (!raw) return "";
  const lines = raw.split(/\n/);

  let endIdx = lines.length;
  for (let i = 0; i < lines.length; i++) {
    if (SECTION_BOUNDARY_RE.test(lines[i].trim())) {
      endIdx = i;
      break;
    }
  }
  let region = lines.slice(0, endIdx);

  const acHeaderRe = /^(?:#+\s*)?acceptance\s+criteria\s*:?\s*$/i;
  for (let i = region.length - 1; i >= 0; i--) {
    if (acHeaderRe.test(region[i].trim())) {
      region = region.slice(i + 1);
      break;
    }
  }

  return region.join("\n");
}

// Hard cap on the number of acceptance criteria the rule-based generator
// will accept from a single story. Beyond this we're almost certainly looking
// at design notes / UI flow steps that survived the structural filter and
// would otherwise blow up the test count via the per-criterion multiplier.
const MAX_CRITERIA = 25;

function extractContext(story: UserStoryInput, enriched?: EnrichedProjectContext): StoryContext {
  const fullText = `${story.title} ${story.description} ${story.acceptanceCriteria}`;

  // User role: "As a [role]" from description — fallback to title pattern — fallback default
  let userRole = "authenticated user";
  const roleDescMatch = story.description.match(/as an?\s+([^,.\n]+)/i);
  if (roleDescMatch) {
    userRole = roleDescMatch[1].trim();
  } else {
    // Try title: "Product Manager can..." / "Admin user should..." / "Underwriter must..."
    const roleTitleMatch = story.title.match(
      /^([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\s+(?:can|should|must|is able|needs|wants)/i
    );
    if (roleTitleMatch) {
      userRole = roleTitleMatch[1].trim();
    }
  }

  // Goal: "I need [...]"
  const goalMatch = story.description.match(/i need\s+(?:the system to\s+)?([^so\n]+)/i);
  const goal = goalMatch ? goalMatch[1].trim() : story.title;

  // Business reason: "so that [...]"
  const reasonMatch = story.description.match(/so that\s+([^.\n]+)/i);
  const businessReason = reasonMatch
    ? reasonMatch[1].trim()
    : "downstream processes work correctly";

  // Parse criteria lines.
  // 1. Truncate at the first design/figma/interaction-flow section header.
  //    Anything below that is design guidance, not testable criteria.
  // 2. If an "Acceptance Criteria:" header exists, drop everything above it
  //    so SUCCESS METRICS / KEY FUNCTIONALITY etc. don't leak through.
  // 3. Strip bullet/numbering prefixes and structural lines (markdown
  //    headings, ALL-CAPS labels, colon-suffixed section names).
  // 4. Deduplicate (substring-prefix match) and hard-cap at MAX_CRITERIA.
  //    Verbose Jira stories that paste the whole story (description + AC +
  //    design prompt) into the AC textarea otherwise produce 100-200
  //    "criteria" → 5,000+ tests via the per-criterion multiplier downstream.
  const acRegion = extractCriteriaSection(story.acceptanceCriteria);
  const rawCriteria = acRegion
    .split(/\n|;/)
    .map(s => s.replace(/^[-•*\d.)\s]+/, "").trim())
    .filter(s => s.length > 4 && !isStructuralLine(s));

  const seen = new Set<string>();
  const dedupedCriteria: string[] = [];
  for (const c of rawCriteria) {
    const key = c.toLowerCase().slice(0, 60);
    if (seen.has(key)) continue;
    seen.add(key);
    dedupedCriteria.push(c);
  }
  const criteria = dedupedCriteria.slice(0, MAX_CRITERIA);
  if (dedupedCriteria.length > MAX_CRITERIA) {
    console.warn(
      `[claude-test-generator] Truncated acceptance criteria from ${dedupedCriteria.length} to ${MAX_CRITERIA} for story "${story.title}" — verbose story format detected.`
    );
  }

  // ── Specific values ──────────────────────────────────────────────────────
  // Only pull genuinely domain-specific values:
  //  1. Quoted strings (most reliable)
  //  2. Hyphenated compound nouns (e.g. "rinse-off cosmetic")
  //  3. Known pattern: "finished <noun>" / "chemical <noun>"
  const specificValues = new Set<string>();

  // 1. Quoted strings
  for (const rx of [/"([^"]{3,60})"/g, /'([^']{3,60})'/g]) {
    for (const m of fullText.matchAll(rx)) {
      if (!isStopPhrase(m[1])) specificValues.add(m[1].trim());
    }
  }

  // 2. Hyphenated compound nouns (rinse-off cosmetic, leave-on conditioner, etc.)
  const hyphenRx = /\b([a-z]+-[a-z]+(?:\s+[a-z]+)?)\b/gi;
  for (const m of fullText.matchAll(hyphenRx)) {
    const phrase = m[1].trim();
    if (phrase.length > 5 && !isStopPhrase(phrase)) specificValues.add(phrase);
  }

  // 3. Domain noun phrases: "chemical mixture", "finished preparation", "spray product"
  const domainRx =
    /\b((?:chemical|finished|raw|manufactured|intermediate|final|active)\s+[a-z]+(?:\s+[a-z]+)?)\b/gi;
  for (const m of fullText.matchAll(domainRx)) {
    const phrase = m[1].trim();
    if (!isStopPhrase(phrase)) specificValues.add(phrase);
  }

  // ── Specific fields ──────────────────────────────────────────────────────
  const fieldPatterns = fullText.match(
    /\b(\w+(?:\s+\w+)?)\s+(?:type|status|flag|id|code|name|value|number|date|description|classification|breakdown|assessment)\b/gi
  ) ?? [];
  const specificFields = [...new Set(fieldPatterns.map(f => f.trim()))]
    .filter(f => !isStopPhrase(f))
    .slice(0, 10);

  // ── Action verbs ─────────────────────────────────────────────────────────
  const actionMatches = story.acceptanceCriteria.match(
    /\b(stores?|flags?|makes?\s+\w+(?:\s+\w+)?|enables?|creates?|updates?|deletes?|saves?|validates?|classifies?|marks?|assigns?|sets?|generates?|sends?|displays?|shows?|hides?|allows?|prevents?|restricts?|records?|applies?|links?|associates?)\b/gi
  ) ?? [];
  const specificActions = [...new Set(actionMatches.map(a => a.toLowerCase()))];

  // ── Downstream effects ───────────────────────────────────────────────────
  const downstreamMatches = fullText.match(/downstream\s+([^.,\n]+)/gi) ?? [];
  const soThatMatches = reasonMatch ? [reasonMatch[1]] : [];
  const downstreamEffects = [
    ...new Set([...downstreamMatches, ...soThatMatches].map(s => s.trim())),
  ];

  // ── Named entities (proper nouns from title) ─────────────────────────────
  const entityMatches = story.title.match(
    /\b([A-Z][A-Za-z0-9]+(?:\s+[A-Z][A-Za-z0-9]+)*)\b/g
  ) ?? [];
  const entities = [...new Set(entityMatches)].filter(e => e.length > 2);

  // ── Merge enriched context if provided ───────────────────────────────────
  const mergedValues = [
    ...[...specificValues].filter(v => v.length > 3),
    ...(enriched?.realTestDataValues ?? []),
  ];
  const mergedFields = [
    ...(specificFields.length > 0 ? specificFields : ["input field", "text field", "classification field"]),
    ...(enriched?.realFieldNames ?? []),
  ];
  const mergedActions = [
    ...(specificActions.length > 0 ? specificActions : ["submit", "save", "update"]),
  ];
  const mergedDownstream = [
    ...(downstreamEffects.length > 0 ? downstreamEffects : ["downstream processes work correctly"]),
    ...(enriched?.integrationTouchpoints ?? []),
  ];

  return {
    featureName: story.title,
    userRole,
    goal,
    businessReason,
    criteria: criteria.length > 0 ? criteria : [story.title],
    specificValues: [...new Set(mergedValues)],
    specificFields: [...new Set(mergedFields)].slice(0, 15),
    specificActions: [...new Set(mergedActions)],
    downstreamEffects: [...new Set(mergedDownstream)],
    entities: entities.length > 0 ? entities : [story.title],
  };
}

// ─── Deduplication tracker ────────────────────────────────────────────────────

class TestRegistry {
  private seen = new Set<string>();
  private counters: Record<string, number> = {};

  nextId(prefix: string): string {
    this.counters[prefix] = (this.counters[prefix] ?? 0) + 1;
    return `${prefix}_${String(this.counters[prefix]).padStart(3, "0")}`;
  }

  isDuplicate(key: string): boolean {
    if (this.seen.has(key)) return true;
    this.seen.add(key);
    return false;
  }
}

// ─── Step builder ─────────────────────────────────────────────────────────────

function steps(list: Array<[string, string]>): TestStep[] {
  return list.map(([action, expected_behavior], i) => ({
    step_number: i + 1,
    action,
    expected_behavior,
  }));
}

// ─── FUNCTIONAL TESTS ─────────────────────────────────────────────────────────
// Per criterion: happy path + one alt-data test per specific value + persistence + downstream

function generateFunctionalTests(
  ctx: StoryContext,
  reg: TestRegistry
): GeneratedTestCase[] {
  const results: GeneratedTestCase[] = [];

  ctx.criteria.forEach((criterion, cIdx) => {
    const priority = cIdx === 0 ? "P0" : cIdx === 1 ? "P1" : "P2";

    // F-Happy: primary happy path for this criterion
    const happyKey = `func-happy-${criterion.substring(0, 40)}`;
    if (!reg.isDuplicate(happyKey)) {
      results.push({
        testCaseId: reg.nextId("TC_FUNC"),
        title: `[Happy Path] ${criterion.substring(0, 85)}`,
        description: `As a ${ctx.userRole}, verify the system correctly satisfies: "${criterion}"`,
        objective: `Confirm the system fulfils: ${criterion}`,
        preconditions: [
          `User is logged in as: ${ctx.userRole}`,
          `${ctx.entities[0] ?? "the target record"} is available in the system`,
          "Application is fully loaded in a clean state",
        ],
        testSteps: steps([
          [
            `Log in as "${ctx.userRole}" and navigate to the "${ctx.featureName}" module`,
            "Module loads with all fields and controls visible",
          ],
          [
            `Locate ${ctx.entities[0] ?? "the target record"} and open it for editing`,
            "Record opens in edit mode with current values displayed",
          ],
          [
            `Perform the action to satisfy: "${criterion.substring(0, 70)}"`,
            "System accepts the input and begins processing",
          ],
          [
            "Observe the system's confirmation or progress feedback",
            "System provides clear positive feedback",
          ],
          [
            "Complete any remaining workflow steps",
            "Workflow completes without errors or warnings",
          ],
          [
            `Verify the outcome: "${criterion.substring(0, 70)}"`,
            "System state, stored data, and UI all confirm the criterion is met",
          ],
        ]),
        expectedResult: `• ${criterion}\n• No errors or warnings\n• Data persisted correctly\n• Audit log records the action by ${ctx.userRole}`,
        postconditions: [
          "Data persisted correctly",
          "Audit trail recorded",
          "Downstream processes can access updated data",
        ],
        testData: {
          userRole: ctx.userRole,
          entity: ctx.entities[0],
          scenario: "happy_path",
        },
        testType: "Functional",
        category: "functional",
        priority,
      });
    }

    // F-AltData: one test per specific domain value. Only emitted for the
    // FIRST criterion so we don't multiply criteria × specificValues — that
    // multiplier produced ~5,000 functional tests for verbose Jira stories
    // (200 criteria × 20 values). Each value still gets a dedicated test;
    // the remaining criteria are covered by happy-path / persistence /
    // downstream tests below.
    if (cIdx === 0) {
      ctx.specificValues.forEach((val) => {
        const altKey = `func-alt-${val.substring(0, 30)}`;
        if (!reg.isDuplicate(altKey)) {
          results.push({
            testCaseId: reg.nextId("TC_FUNC"),
            title: `[Alt Data] "${val}" satisfies: ${criterion.substring(0, 60)}`,
            description: `Verify that the specific value "${val}" correctly satisfies the criterion "${criterion}"`,
            objective: `Confirm "${val}" is a valid value for: ${criterion}`,
            preconditions: [
              `User is logged in as: ${ctx.userRole}`,
              `Test data with value "${val}" is prepared`,
              "System is in a clean state",
            ],
            testSteps: steps([
              [
                `Navigate to the "${ctx.featureName}" module as ${ctx.userRole}`,
                "Module loads successfully",
              ],
              [
                `Open ${ctx.entities[0] ?? "the target record"}`,
                "Record is open for editing",
              ],
              [
                `Set the relevant field to "${val}"`,
                `"${val}" is accepted by the field`,
              ],
              ["Submit or save the change", "System validates and saves the value"],
              [
                `Verify the stored value is exactly "${val}" — no truncation or transformation`,
                `Stored value matches "${val}" exactly`,
              ],
              [
                "Confirm downstream processes reflect this value correctly",
                `${ctx.businessReason}`,
              ],
            ]),
            expectedResult: `• Value "${val}" accepted and stored\n• Criterion "${criterion}" satisfied with this value\n• Downstream: ${ctx.businessReason}`,
            postconditions: [`"${val}" correctly persisted`, "Downstream state updated"],
            testData: { value: val, criterion: criterion.substring(0, 60) },
            testType: "Functional",
            category: "functional",
            priority: "P1",
          });
        }
      });
    }

    // F-Persistence: data survives session refresh
    const persistKey = `func-persist-${criterion.substring(0, 40)}`;
    if (!reg.isDuplicate(persistKey)) {
      results.push({
        testCaseId: reg.nextId("TC_FUNC"),
        title: `[Persistence] Data persists after session refresh for: ${criterion.substring(0, 60)}`,
        description: `Verify that data satisfying "${criterion}" persists after logout/login and page refresh`,
        objective: `Ensure data persistence and session independence for: ${criterion}`,
        preconditions: [
          `User has completed the action satisfying: "${criterion}"`,
          "Record ID/reference noted before session refresh",
        ],
        testSteps: steps([
          [
            `Complete the action satisfying "${criterion}" and note the record reference`,
            "Record saved and reference noted",
          ],
          ["Log out of the application completely", "User is logged out; session cleared"],
          [
            `Log back in as ${ctx.userRole} and navigate to the record`,
            "Record is accessible after re-login",
          ],
          [
            "Verify all field values are identical to what was saved",
            "All values match — no data loss on session refresh",
          ],
          ["Refresh the page (F5) and re-check values", "Values persist across page refresh"],
          [
            "Confirm downstream processes still reflect the correct data",
            `${ctx.downstreamEffects[0] ?? "Downstream state is correct"}`,
          ],
        ]),
        expectedResult: `• Data satisfying "${criterion}" persists across logout/login\n• Page refresh does not alter stored values\n• Downstream effects remain applied`,
        postconditions: ["Data persisted in DB", "Downstream unaffected by session events"],
        testData: { scenario: "persistence", criterion: criterion.substring(0, 60) },
        testType: "Functional",
        category: "functional",
        priority: "P1",
      });
    }

    // F-Downstream: verify the business reason is achieved
    if (ctx.downstreamEffects.length > 0) {
      const downKey = `func-downstream-${criterion.substring(0, 30)}-${ctx.downstreamEffects[0].substring(0, 20)}`;
      if (!reg.isDuplicate(downKey)) {
        results.push({
          testCaseId: reg.nextId("TC_FUNC"),
          title: `[Downstream] After "${criterion.substring(0, 50)}" — verify: ${ctx.downstreamEffects[0].substring(0, 50)}`,
          description: `Verify the business outcome: "${ctx.businessReason}" is achieved once "${criterion}" is satisfied`,
          objective: `Confirm downstream effect: ${ctx.downstreamEffects[0]}`,
          preconditions: [
            `Criterion "${criterion}" has been satisfied`,
            "Downstream module/process is accessible",
          ],
          testSteps: steps([
            [
              `Satisfy criterion "${criterion.substring(0, 60)}" with valid data`,
              "Criterion satisfied",
            ],
            [
              "Navigate to the downstream module/process that depends on this data",
              "Downstream module opens",
            ],
            [
              "Trigger or observe the downstream process (e.g. compliance check, report, calculation)",
              "Downstream process runs",
            ],
            [
              `Verify the downstream result reflects: "${ctx.businessReason}"`,
              "Downstream outcome matches expected business result",
            ],
            [
              "Check that incorrect/missing upstream data would block the downstream process",
              "Downstream correctly depends on upstream data",
            ],
            [
              "Confirm audit trail shows the connection between upstream action and downstream effect",
              "Audit trail is complete end-to-end",
            ],
          ]),
          expectedResult: `• ${ctx.businessReason}\n• Downstream process uses the correct upstream data\n• End-to-end audit trail is complete`,
          postconditions: ["Downstream state reflects upstream changes", "Audit trail complete"],
          testData: {
            downstream: ctx.downstreamEffects[0],
            criterion: criterion.substring(0, 60),
          },
          testType: "Functional",
          category: "functional",
          priority: "P1",
        });
      }
    }
  });

  return results;
}

// ─── NEGATIVE TESTS ───────────────────────────────────────────────────────────

function generateNegativeTests(
  ctx: StoryContext,
  reg: TestRegistry
): GeneratedTestCase[] {
  const results: GeneratedTestCase[] = [];

  // Per-criterion: what happens when each criterion is violated
  ctx.criteria.forEach((criterion) => {
    const key = `neg-violation-${criterion.substring(0, 40)}`;
    if (!reg.isDuplicate(key)) {
      results.push({
        testCaseId: reg.nextId("TC_NEG"),
        title: `[Criterion Violated] System rejects when: "${criterion.substring(0, 70)}" is not met`,
        description: `Verify the system prevents saving/submitting when the criterion "${criterion}" is violated`,
        objective: `Ensure system enforces: ${criterion}`,
        preconditions: [
          `User is logged in as: ${ctx.userRole}`,
          `${ctx.entities[0] ?? "record"} exists`,
          "Test data that violates this criterion is prepared",
        ],
        testSteps: steps([
          [`Navigate to "${ctx.featureName}" and open the record`, "Record opens in edit mode"],
          ["Enter data that directly violates this criterion", "Invalid/non-compliant data entered"],
          ["Attempt to save or submit", "System triggers validation"],
          [
            `Verify system blocks the action with a specific error referencing: "${criterion.substring(0, 50)}"`,
            "Clear, specific error message displayed",
          ],
          [
            "Note that the error message tells the user exactly what is wrong and how to fix it",
            "Error is actionable, not generic",
          ],
          ["Confirm no partial/invalid data was persisted", "Database unchanged from before the failed attempt"],
        ]),
        expectedResult: `• System blocks save with clear error\n• Error specifically references the violated criterion\n• No data saved\n• User can correct and resubmit`,
        postconditions: ["No invalid data in DB", "System in clean state"],
        testData: { violatedCriterion: criterion.substring(0, 70), state: "violated" },
        testType: "Negative",
        category: "negative",
        priority: "P0",
      });
    }
  });

  // Per specific field: invalid data type
  ctx.specificFields.slice(0, 5).forEach((field) => {
    const key = `neg-invalidtype-${field}`;
    if (!reg.isDuplicate(key)) {
      results.push({
        testCaseId: reg.nextId("TC_NEG"),
        title: `[Invalid Type] "${field}" rejects wrong data type`,
        description: `Verify "${field}" in "${ctx.featureName}" rejects input of an incorrect data type`,
        objective: `Ensure "${field}" enforces correct data type validation`,
        preconditions: [`User logged in as ${ctx.userRole}`, `"${field}" field is editable`],
        testSteps: steps([
          [
            `Navigate to "${ctx.featureName}" and locate "${field}"`,
            `"${field}" field is visible and editable`,
          ],
          [
            `Enter an invalid data type into "${field}" (e.g., text in a numeric field, number in a date field)`,
            "System receives wrong-type input",
          ],
          ["Attempt to move to next field or submit", "System triggers type validation"],
          [
            `Verify "${field}" shows a type-validation error`,
            "Error clearly states the expected data type",
          ],
          [
            "Correct the input to the right type and verify acceptance",
            "Correct type accepted without errors",
          ],
          [
            "Save and confirm correct type-checked value is stored",
            "Correctly-typed value persisted",
          ],
        ]),
        expectedResult: `• "${field}" rejects wrong data type with clear error\n• Correct type accepted\n• No corrupt data stored`,
        postconditions: ["Correctly typed data stored", "Type validation enforced"],
        testData: { field, invalidValue: "WRONG_TYPE_abc123", type: "invalid_type" },
        testType: "Negative",
        category: "negative",
        priority: "P1",
      });
    }
  });

  // Missing required data
  if (!reg.isDuplicate("neg-missing-required")) {
    results.push({
      testCaseId: reg.nextId("TC_NEG"),
      title: `[Missing Required] All required fields blank — system blocks submission`,
      description: `Verify "${ctx.featureName}" blocks submission when all required fields are left blank`,
      objective: "Ensure required-field validation prevents empty form submission",
      preconditions: [`User logged in as ${ctx.userRole}`, "Form is open and in default empty state"],
      testSteps: steps([
        [`Navigate to "${ctx.featureName}" with an empty/new record`, "Empty form loads"],
        ["Leave ALL fields blank — do not enter any data", "All fields remain empty"],
        ["Attempt to save or submit", "System triggers required-field validation"],
        [
          "Verify ALL required fields are highlighted with individual error messages",
          "Each required field shows its own specific error",
        ],
        [
          "Fill in only some required fields and re-attempt",
          "System still blocks — shows remaining missing fields",
        ],
        [
          "Confirm no partial record was created in the database",
          "DB is unchanged; no orphan record",
        ],
      ]),
      expectedResult: `• All required fields flagged individually\n• Submission blocked\n• No partial record created\n• User knows exactly which fields to fill`,
      postconditions: ["No data persisted", "Clean state maintained"],
      testData: { scenario: "all_fields_blank" },
      testType: "Negative",
      category: "negative",
      priority: "P0",
    });
  }

  // Unauthorized role
  if (!reg.isDuplicate("neg-unauthorized-role")) {
    results.push({
      testCaseId: reg.nextId("TC_NEG"),
      title: `[Unauthorized Role] Non-${ctx.userRole} role cannot perform "${ctx.featureName}" actions`,
      description: `Verify that a user without the "${ctx.userRole}" role cannot access or modify "${ctx.featureName}"`,
      objective: `Ensure role-based access control enforces ${ctx.userRole} requirement`,
      preconditions: [
        "User is logged in with a LOWER-privilege role (e.g., Read-Only viewer)",
        `"${ctx.featureName}" is accessible to privileged users`,
      ],
      testSteps: steps([
        [
          `Log in with a read-only or unprivileged role (NOT ${ctx.userRole})`,
          "User is logged in with limited role",
        ],
        [
          `Navigate to or attempt to access "${ctx.featureName}"`,
          "System evaluates access",
        ],
        ["Attempt to create, edit, or submit any data", "System evaluates write permission"],
        [
          "Verify access is denied with a permission error",
          "System returns 403 or equivalent — action blocked",
        ],
        ["Confirm no data was changed by the unauthorized attempt", "Data unchanged"],
        [
          `Log in as ${ctx.userRole} and confirm the feature works normally`,
          "Feature accessible and functional for authorized role",
        ],
      ]),
      expectedResult: `• Unauthorized role denied access\n• Clear permission-denied message\n• No data modified by unauthorized attempt\n• ${ctx.userRole} can still access normally`,
      postconditions: ["No unauthorized changes", "RBAC enforced"],
      testData: { unauthorizedRole: "ReadOnly", authorizedRole: ctx.userRole },
      testType: "Negative",
      category: "negative",
      priority: "P0",
    });
  }

  // Duplicate record
  if (!reg.isDuplicate("neg-duplicate-record")) {
    results.push({
      testCaseId: reg.nextId("TC_NEG"),
      title: `[Duplicate] System prevents creating duplicate of "${ctx.entities[0] ?? "record"}"`,
      description: `Verify system detects and blocks duplicate record creation for ${ctx.entities[0] ?? ctx.featureName}`,
      objective: "Ensure uniqueness constraints are enforced",
      preconditions: [
        `${ctx.entities[0] ?? "A record"} already exists in the system`,
        `User logged in as ${ctx.userRole}`,
      ],
      testSteps: steps([
        [
          `Navigate to "${ctx.featureName}" and attempt to create a new record with the same unique identifier as an existing one`,
          "Duplicate data entered",
        ],
        [
          "Fill all required fields with the same values as the existing record",
          "Form populated with duplicate data",
        ],
        ["Attempt to save", "System triggers uniqueness validation"],
        [
          `Verify system returns a duplicate-record error identifying the conflicting value`,
          "Specific duplicate error shown",
        ],
        ["Confirm the duplicate record was NOT created", "Only original record exists in DB"],
        [
          "Modify the unique field to a new value and verify the new record is then accepted",
          "Unique value accepted — record created",
        ],
      ]),
      expectedResult: `• Duplicate rejected with specific error\n• Original record untouched\n• No duplicate in DB\n• Unique value accepted`,
      postconditions: ["No duplicate records", "DB integrity maintained"],
      testData: { scenario: "duplicate_record", entity: ctx.entities[0] ?? "record" },
      testType: "Negative",
      category: "negative",
      priority: "P1",
    });
  }

  // Concurrent edit conflict
  if (!reg.isDuplicate("neg-concurrent-edit")) {
    results.push({
      testCaseId: reg.nextId("TC_NEG"),
      title: `[Concurrent Edit] System detects conflict when two users edit same record simultaneously`,
      description: `Verify optimistic locking or conflict detection when two ${ctx.userRole} users edit the same record`,
      objective: "Ensure no silent data overwrite on concurrent edits",
      preconditions: [
        "Two separate user sessions logged in as authorized role",
        "Same record open in both sessions",
      ],
      testSteps: steps([
        ["Open the target record in Session A and start editing", "Session A has record open in edit mode"],
        ["Open the same record in Session B and start editing", "Session B also has record open in edit mode"],
        ["Save changes from Session A first", "Session A saves successfully"],
        ["Attempt to save changes from Session B (now stale)", "System detects stale/conflicting data"],
        [
          "Verify Session B receives a conflict warning and is NOT silently overwritten",
          "Conflict error shown — user prompted to refresh",
        ],
        [
          "Refresh Session B, apply its changes, and verify successful save",
          "Session B can save after refreshing to latest state",
        ],
      ]),
      expectedResult: `• Concurrent edit conflict detected\n• No silent data overwrite\n• Conflict message is clear\n• Both users can resolve and save`,
      postconditions: ["Final record is in consistent state", "No lost updates"],
      testData: { scenario: "concurrent_edit", sessions: 2 },
      testType: "Negative",
      category: "negative",
      priority: "P1",
    });
  }

  return results;
}

// ─── EDGE TESTS ───────────────────────────────────────────────────────────────

function generateEdgeTests(
  ctx: StoryContext,
  reg: TestRegistry
): GeneratedTestCase[] {
  const results: GeneratedTestCase[] = [];

  const edgeCases: Array<{
    variant: string;
    data: Record<string, any>;
    expect: string;
  }> = [
    {
      variant: "minimum boundary (1 char / minimum allowed value)",
      data: { value: "A", type: "min" },
      expect: "Minimum value accepted and stored correctly",
    },
    {
      variant: "maximum boundary (255 chars / max allowed value)",
      data: { value: "A".repeat(255), type: "max" },
      expect: "Maximum value accepted and stored correctly",
    },
    {
      variant: "just beyond maximum (256 chars / one over limit)",
      data: { value: "A".repeat(256), type: "over_max" },
      expect: "System rejects with max-length error",
    },
    {
      variant: "whitespace-only input",
      data: { value: "   ", type: "whitespace" },
      expect: "System trims and rejects or normalises whitespace-only input",
    },
    {
      variant: "Unicode and multi-byte characters",
      data: { value: "测试 тест テスト", type: "unicode" },
      expect: "Unicode stored and displayed without corruption",
    },
    {
      variant: "leading and trailing spaces",
      data: { value: "  value  ", type: "trim" },
      expect: "Spaces trimmed before save; stored value has no leading/trailing spaces",
    },
    {
      variant: "numeric zero as a value",
      data: { value: 0, type: "zero" },
      expect: "Zero treated as a valid numeric — not treated as empty/null",
    },
    {
      variant: "special characters (!@#$%^&*)",
      data: { value: "!@#$%^&*()", type: "special_chars" },
      expect:
        "Special chars sanitised, rejected, or stored per business rules — no crash",
    },
    {
      variant: "empty string on optional field",
      data: { value: "", type: "empty_optional" },
      expect: "Empty optional field accepted; record still saves",
    },
    {
      variant: "rapid double-submit (click Save twice quickly)",
      data: { action: "double_click", delay_ms: 50 },
      expect: "Only one record created; second submission ignored or rejected",
    },
  ];

  // Each field gets a unique edge variant (round-robin)
  const fields =
    ctx.specificFields.length > 0 ? ctx.specificFields : ["input field"];
  const usedVariantIndices = new Set<number>();

  fields.forEach((field, fIdx) => {
    const variantIdx = fIdx % edgeCases.length;
    usedVariantIndices.add(variantIdx);
    const variant = edgeCases[variantIdx];
    const key = `edge-${field.substring(0, 20)}-${variant.variant.substring(0, 20)}`;
    if (!reg.isDuplicate(key)) {
      results.push({
        testCaseId: reg.nextId("TC_EDGE"),
        title: `[Edge] "${field}" — ${variant.variant}`,
        description: `Edge case: test "${field}" in "${ctx.featureName}" with ${variant.variant}`,
        objective: `Verify "${field}" handles the edge condition: ${variant.variant}`,
        preconditions: [
          `User logged in as ${ctx.userRole}`,
          `"${field}" field is editable`,
          `Edge case data prepared: ${JSON.stringify(variant.data)}`,
        ],
        testSteps: steps([
          [`Navigate to "${ctx.featureName}" as ${ctx.userRole}`, "Page loads successfully"],
          [`Locate and focus the "${field}" field`, `"${field}" is visible and interactive`],
          [
            `Enter edge case value into "${field}": ${JSON.stringify(variant.data)}`,
            "Edge input entered",
          ],
          ["Submit or move to next field to trigger validation", `${variant.expect}`],
          [
            "Verify surrounding fields and data are completely unaffected by this edge input",
            "No side-effects on other fields or records",
          ],
          [
            "Confirm system remains stable — no crash, hang, or data corruption",
            "System stable and ready for normal use",
          ],
        ]),
        expectedResult: `• ${variant.expect}\n• No crash or unhandled exception\n• Other fields unaffected\n• System remains stable`,
        postconditions: ["System in consistent state", "No orphaned data"],
        testData: { field, ...variant.data },
        testType: "Edge",
        category: "edge",
        priority: "P2",
      });
    }
  });

  // Cover remaining edge variants not yet assigned to any field
  edgeCases.forEach((variant, idx) => {
    if (usedVariantIndices.has(idx)) return;
    const field = fields[idx % fields.length];
    const key = `edge-extra-${variant.variant.substring(0, 30)}`;
    if (!reg.isDuplicate(key)) {
      results.push({
        testCaseId: reg.nextId("TC_EDGE"),
        title: `[Edge] ${variant.variant} — "${ctx.featureName}"`,
        description: `Edge case: verify "${ctx.featureName}" handles ${variant.variant} gracefully`,
        objective: `Ensure system robustness for edge condition: ${variant.variant}`,
        preconditions: [
          `User logged in as ${ctx.userRole}`,
          `Edge case data prepared: ${JSON.stringify(variant.data)}`,
        ],
        testSteps: steps([
          [`Navigate to "${ctx.featureName}"`, "Page loads successfully"],
          ["Set up the edge case scenario", `Edge condition "${variant.variant}" is in place`],
          [`Apply edge input: ${JSON.stringify(variant.data)}`, "System receives edge-case input"],
          ["Trigger processing/submission", `${variant.expect}`],
          ["Verify no related data was corrupted by the edge case", "Surrounding data intact"],
          [
            "Confirm system recovers cleanly and is ready for normal use",
            "System stable",
          ],
        ]),
        expectedResult: `• ${variant.expect}\n• No crash or data corruption\n• System stable after edge condition`,
        postconditions: ["System state consistent"],
        testData: { ...variant.data, scenario: variant.variant },
        testType: "Edge",
        category: "edge",
        priority: "P2",
      });
    }
  });

  return results;
}

// ─── SECURITY TESTS ───────────────────────────────────────────────────────────
// 8 OWASP-aligned threat vectors. Endpoint references use a safe placeholder.

function generateSecurityTests(
  ctx: StoryContext,
  reg: TestRegistry
): GeneratedTestCase[] {
  const featureEndpointPlaceholder = "[FEATURE_API_ENDPOINT — replace with actual route]";

  const threats = [
    {
      id: "xss-reflected",
      label: "Reflected XSS via input fields",
      payload: { value: "<script>alert('XSS')</script>", type: "reflected_xss" },
      expect: "Script tag is sanitised/escaped; not executed in browser DOM",
    },
    {
      id: "xss-stored",
      label: "Stored XSS — malicious script saved and re-rendered",
      payload: { value: "<img src=x onerror=alert(document.cookie)>", type: "stored_xss" },
      expect: "Saved data is HTML-escaped on render; no script execution on page load",
    },
    {
      id: "sql-injection",
      label: "SQL injection via search/filter inputs",
      payload: { value: "' OR '1'='1'; DROP TABLE users;--", type: "sql_injection" },
      expect: "Parameterised queries prevent injection; DB structure unchanged",
    },
    {
      id: "horizontal-privesc",
      label: "Horizontal privilege escalation — accessing another user's record",
      payload: { method: "URL/ID manipulation", targetId: "OTHER_USER_ID" },
      expect: "System returns 403 Forbidden; other user's data not accessible",
    },
    {
      id: "vertical-privesc",
      label: "Vertical privilege escalation — read-only user calling write endpoint",
      payload: {
        role: "ReadOnly",
        endpoint: featureEndpointPlaceholder,
        method: "POST",
      },
      expect: "System returns 403 Forbidden; action blocked and logged",
    },
    {
      id: "csrf",
      label: "CSRF — cross-site request forgery on state-changing action",
      payload: { method: "cross-origin POST", csrfToken: "(missing/invalid)" },
      expect: "Request rejected due to missing/invalid CSRF token",
    },
    {
      id: "idor",
      label: "IDOR — insecure direct object reference via sequential ID enumeration",
      payload: { method: "enumerate IDs in URL params", ids: [1, 2, 3] },
      expect: "Object-level authorisation enforced; 403 returned for unauthorised IDs",
    },
    {
      id: "path-traversal",
      label: "Path traversal in any file/resource reference parameter",
      payload: { value: "../../etc/passwd", type: "path_traversal" },
      expect: "System rejects traversal path; server file system not exposed",
    },
  ];

  return threats
    .filter(t => !reg.isDuplicate(`sec-${t.id}`))
    .map(threat => ({
      testCaseId: reg.nextId("TC_SEC"),
      title: `[Security] ${threat.label}`,
      description: `Security test for "${ctx.featureName}": ${threat.label}`,
      objective: `Verify "${ctx.featureName}" is protected against: ${threat.label}`,
      preconditions: [
        "Isolated security test environment (NOT production)",
        `Test account for ${ctx.userRole} available`,
        `Attack payload: ${JSON.stringify(threat.payload)}`,
      ],
      testSteps: steps([
        [
          `Navigate to "${ctx.featureName}" and confirm normal flow works (baseline)`,
          "Baseline behaviour confirmed",
        ],
        [
          `As ${ctx.userRole}, locate the input surface for the attack`,
          "Target input surface identified",
        ],
        [
          `Inject attack payload: ${JSON.stringify(threat.payload)}`,
          "System receives the malicious input",
        ],
        ["Submit or trigger the action", `${threat.expect}`],
        [
          "Check server-side security/audit logs for the blocked attempt",
          "Security event logged with appropriate severity",
        ],
        [
          "Verify application state and data integrity after the attack",
          "No data was modified; system in clean, stable state",
        ],
      ]),
      expectedResult: `• ${threat.expect}\n• No sensitive data exposed\n• Attempt logged in security audit log\n• Application remains stable`,
      postconditions: ["Security event in audit log", "No data breach", "System stable"],
      testData: threat.payload,
      testType: "Security" as const,
      category: "security",
      priority: "P0" as const,
    }));
}

// ─── ACCESSIBILITY TESTS ──────────────────────────────────────────────────────

function generateAccessibilityTests(
  ctx: StoryContext,
  reg: TestRegistry
): GeneratedTestCase[] {
  const cases = [
    {
      id: "keyboard-nav",
      label: "Keyboard-only navigation — all interactive elements reachable without mouse",
      data: { keys: "Tab, Shift+Tab, Enter, Space, Arrow keys" },
      expect: "Every control is focusable and operable by keyboard alone; no focus traps",
    },
    {
      id: "screen-reader",
      label: "Screen reader announces all controls, labels, errors, and state changes",
      data: { tool: "NVDA / VoiceOver / JAWS", standard: "WCAG 2.1 AA" },
      expect: "All form labels, buttons, errors, and dynamic updates are announced correctly",
    },
    {
      id: "colour-contrast",
      label: "Colour contrast — all text meets WCAG 2.1 AA minimum 4.5:1 ratio",
      data: { minRatio: "4.5:1", tool: "axe DevTools / Colour Contrast Analyser" },
      expect: "All text passes contrast check; no information conveyed by colour alone",
    },
    {
      id: "error-association",
      label: "Validation errors programmatically linked to fields (aria-describedby / WCAG 3.3.1)",
      data: { attribute: "aria-describedby", standard: "WCAG 3.3.1" },
      expect:
        "Screen reader announces each error in context of its field; errors not just visually indicated",
    },
    {
      id: "focus-management",
      label: "Focus management after dynamic content updates (modals, alerts, toasts)",
      data: { scenarios: ["modal open/close", "toast notification", "inline validation"] },
      expect:
        "Focus moves to new content on open; returns to trigger element on close; no focus loss",
    },
    {
      id: "zoom-200",
      label: "Zoom to 200% — layout usable without horizontal scrolling",
      data: { zoom: "200%", viewport: "1280px wide" },
      expect: "All content and controls remain accessible and visible at 200% zoom",
    },
    {
      id: "touch-target",
      label: "Touch target size — all interactive elements meet 44×44px minimum (WCAG 2.5.5)",
      data: { minSize: "44x44px", standard: "WCAG 2.5.5" },
      expect: "All buttons, links, and inputs have a minimum 44×44px tap target",
    },
  ];

  return cases
    .filter(a => !reg.isDuplicate(`a11y-${a.id}`))
    .map(a => ({
      testCaseId: reg.nextId("TC_ACC"),
      title: `[A11y] ${a.label}`,
      description: `Accessibility test for "${ctx.featureName}": ${a.label}`,
      objective: `Ensure WCAG 2.1 AA compliance for: ${a.label}`,
      preconditions: [
        `Assistive tool/method available: ${JSON.stringify(a.data)}`,
        `User logged in as ${ctx.userRole}`,
        "Feature fully rendered with representative data",
      ],
      testSteps: steps([
        [
          `Open "${ctx.featureName}" as ${ctx.userRole}`,
          "Page fully rendered with all controls visible",
        ],
        [`Enable assistive method: ${JSON.stringify(a.data)}`, "Assistive method active"],
        [
          "Navigate or interact using only the assistive method",
          "Interaction proceeds through all elements",
        ],
        [
          "Verify each element is reachable, operable, and/or announced correctly",
          `${a.expect}`,
        ],
        [
          "Check for traps, skipped elements, missing labels, or broken focus flow",
          "No accessibility blockers found",
        ],
        [
          "Document results — pass each element or log violation with selector + WCAG criterion reference",
          "All elements pass or violations logged for remediation",
        ],
      ]),
      expectedResult: `• ${a.expect}\n• WCAG 2.1 AA compliance confirmed\n• No focus traps or dead-ends\n• Dynamic content announced`,
      postconditions: ["Accessibility results recorded", "Violations (if any) logged"],
      testData: a.data,
      testType: "Accessibility" as const,
      category: "accessibility",
      priority: "P1" as const,
    }));
}

// ─── INTEGRATION TESTS (enriched context only) ────────────────────────────────
// One test per integration touchpoint identified in the golden repo

function generateIntegrationTests(
  ctx: StoryContext,
  reg: TestRegistry,
  enriched: EnrichedProjectContext
): GeneratedTestCase[] {
  const results: GeneratedTestCase[] = [];

  enriched.integrationTouchpoints.forEach((touchpoint, i) => {
    const key = `integration-${touchpoint.substring(0, 50)}`;
    if (reg.isDuplicate(key)) return;
    results.push({
      testCaseId: reg.nextId("TC_INT"),
      title: `[Integration] ${touchpoint}`,
      description: `Verify that "${ctx.featureName}" correctly triggers: ${touchpoint}`,
      objective: `Confirm integration touchpoint is invoked with correct data: ${touchpoint}`,
      preconditions: [
        `User logged in as ${ctx.userRole}`,
        `${touchpoint} is reachable and observable (mock/spy in place)`,
        "Feature is fully loaded with test data",
      ],
      testSteps: steps([
        [`Navigate to "${ctx.featureName}" as ${ctx.userRole}`, "Feature loads correctly"],
        [`Complete the primary action that should trigger: ${touchpoint}`, "Primary action performed"],
        [`Verify that ${touchpoint} was called`, `${touchpoint} invoked once with correct arguments`],
        ["Verify the payload/arguments passed to the touchpoint are correct", "Arguments match expected shape and values"],
        ["Simulate a failure in the touchpoint and verify graceful error handling", "Error handled gracefully — no data corruption"],
        ["Verify audit log records the integration call outcome", "Integration call logged"],
      ]),
      expectedResult: `• ${touchpoint} invoked correctly\n• Payload contains expected data\n• Failure scenario handled gracefully\n• Call logged in audit trail`,
      postconditions: ["Integration state updated", "Audit trail complete"],
      testData: { touchpoint, scenario: "integration_call" },
      testType: "Functional",
      category: "functional",
      priority: i === 0 ? "P0" : "P1",
    });
  });

  // Test each real API endpoint if found
  enriched.realApiEndpoints.slice(0, 5).forEach((endpoint) => {
    const key = `integration-endpoint-${endpoint.substring(0, 50)}`;
    if (reg.isDuplicate(key)) return;
    results.push({
      testCaseId: reg.nextId("TC_INT"),
      title: `[API] Verify endpoint: ${endpoint}`,
      description: `Direct API test for endpoint: ${endpoint} — related to "${ctx.featureName}"`,
      objective: `Verify the API endpoint ${endpoint} behaves correctly for this story`,
      preconditions: [
        `Valid auth token for ${ctx.userRole}`,
        "API environment is up and healthy",
        "Test data prepared matching schema",
      ],
      testSteps: steps([
        [`Obtain valid auth token for ${ctx.userRole}`, "Token obtained successfully"],
        [`Send valid request to ${endpoint}`, "Response received — status 200/201"],
        ["Verify response body matches expected schema", "Response schema is correct"],
        [`Send request without auth to ${endpoint}`, "Response is 401 Unauthorized"],
        [`Send request with insufficient role to ${endpoint}`, "Response is 403 Forbidden"],
        ["Verify response headers include correct Content-Type and security headers", "Headers correct"],
      ]),
      expectedResult: `• ${endpoint} returns correct response for valid request\n• 401 for missing auth\n• 403 for wrong role\n• Response schema is valid`,
      postconditions: ["API in stable state", "No unintended side-effects"],
      testData: { endpoint, method: endpoint.split(" ")[0], path: endpoint.split(" ")[1] },
      testType: "Functional",
      category: "functional",
      priority: "P1",
    });
  });

  return results;
}

// ─── RISK-BASED TESTS (enriched context only) ──────────────────────────────────
// One test per risk area identified in the golden repo

function generateRiskTests(
  ctx: StoryContext,
  reg: TestRegistry,
  enriched: EnrichedProjectContext
): GeneratedTestCase[] {
  const results: GeneratedTestCase[] = [];

  enriched.riskAreas.forEach((risk, i) => {
    const key = `risk-${risk.substring(0, 50)}`;
    if (reg.isDuplicate(key)) return;
    results.push({
      testCaseId: reg.nextId("TC_RISK"),
      title: `[Risk] ${risk}`,
      description: `Risk-based test for "${ctx.featureName}": ${risk}`,
      objective: `Verify the identified risk is mitigated: ${risk}`,
      preconditions: [
        `User logged in as ${ctx.userRole}`,
        "Risk scenario conditions are reproducible in test environment",
        "Monitoring/logging is active to capture the risk event",
      ],
      testSteps: steps([
        [`Set up the scenario that exposes the risk: "${risk}"`, "Risk scenario is in place"],
        ["Trigger the action that could exploit or encounter this risk", "Action triggered"],
        ["Verify the system handles this risk correctly — no exploit, no crash, no data loss", "Risk is mitigated"],
        ["Verify appropriate error or warning is surfaced to the user if applicable", "User is informed appropriately"],
        ["Check security/error logs for the risk event", "Risk event logged with correct severity"],
        ["Verify system returns to a stable state after the risk scenario", "System stable"],
      ]),
      expectedResult: `• Risk "${risk}" is handled correctly\n• No security breach or data loss\n• Appropriate logging in place\n• System stable after risk scenario`,
      postconditions: ["System in clean state", "Risk event in audit log"],
      testData: { risk, scenario: "risk_mitigation" },
      testType: "Security",
      category: "security",
      priority: "P0",
    });
  });

  // Test each business rule from the codebase
  enriched.businessRules.forEach((rule) => {
    const key = `risk-bizrule-${rule.substring(0, 50)}`;
    if (reg.isDuplicate(key)) return;
    results.push({
      testCaseId: reg.nextId("TC_RISK"),
      title: `[Business Rule] ${rule}`,
      description: `Verify business rule is enforced: ${rule}`,
      objective: `Ensure the system enforces: ${rule}`,
      preconditions: [
        `User logged in as ${ctx.userRole}`,
        "Test data that would violate this rule is prepared",
      ],
      testSteps: steps([
        [`Navigate to "${ctx.featureName}"`, "Feature loaded"],
        [`Attempt an action that violates the rule: "${rule}"`, "Violating data entered"],
        ["Submit or save", "System triggers business rule validation"],
        [`Verify the system enforces: "${rule}" with a clear error message`, "Rule enforced — clear message shown"],
        ["Correct the data to comply with the rule and re-submit", "Compliant data accepted"],
        ["Verify compliant data is saved and downstream processes work correctly", "Data saved, downstream updated"],
      ]),
      expectedResult: `• Business rule "${rule}" is enforced\n• Violation blocked with clear message\n• Compliant data accepted\n• Downstream state correct`,
      postconditions: ["Valid data stored", "Business rule enforced"],
      testData: { businessRule: rule },
      testType: "Negative",
      category: "negative",
      priority: "P1",
    });
  });

  return results;
}

// ─── GAP COVERAGE TESTS (enriched context only) ────────────────────────────────
// One test per coverage gap identified by Claude's analysis of the codebase

function generateGapTests(
  ctx: StoryContext,
  reg: TestRegistry,
  enriched: EnrichedProjectContext
): GeneratedTestCase[] {
  const results: GeneratedTestCase[] = [];

  enriched.coverageGaps.forEach((gap, i) => {
    const key = `gap-${gap.substring(0, 50)}`;
    if (reg.isDuplicate(key)) return;
    results.push({
      testCaseId: reg.nextId("TC_GAP"),
      title: `[Coverage Gap] ${gap}`,
      description: `This scenario was found in the codebase but NOT covered by the acceptance criteria: ${gap}`,
      objective: `Fill identified coverage gap: ${gap}`,
      preconditions: [
        `User logged in as ${ctx.userRole}`,
        `Gap scenario preconditions in place: ${gap}`,
        "Feature is fully loaded",
      ],
      testSteps: steps([
        [`Navigate to "${ctx.featureName}" as ${ctx.userRole}`, "Feature loaded"],
        [`Set up the gap scenario: "${gap}"`, "Gap scenario conditions are active"],
        ["Perform the action relevant to this gap scenario", "Action performed"],
        ["Observe system behaviour — this scenario is not in the AC so document actual behaviour", "Behaviour observed and documented"],
        ["Determine if the observed behaviour is correct or a defect", "Pass/Fail determination made"],
        ["If defect: raise it; if correct: add to regression suite", "Outcome actioned"],
      ]),
      expectedResult: `• Gap scenario "${gap}" is tested\n• Actual system behaviour is documented\n• Any defects are identified\n• Scenario added to regression if passing`,
      postconditions: ["Gap scenario outcome documented", "Defects raised if applicable"],
      testData: { gap, source: "golden_repo_analysis" },
      testType: "Functional",
      category: "functional",
      priority: i === 0 ? "P1" : "P2",
    });
  });

  return results;
}

// ─── Coverage summary ─────────────────────────────────────────────────────────

function buildCoverageSummary(
  cases: GeneratedTestCase[],
  ctx: StoryContext
): CoverageSummary {
  const byCategory: Record<string, number> = {};
  for (const tc of cases) {
    const cat = tc.category ?? tc.testType.toLowerCase();
    byCategory[cat] = (byCategory[cat] ?? 0) + 1;
  }

  const parts: string[] = [];
  if (byCategory["functional"]) parts.push(`${byCategory["functional"]} functional`);
  if (byCategory["negative"])   parts.push(`${byCategory["negative"]} negative`);
  if (byCategory["edge"])       parts.push(`${byCategory["edge"]} edge`);
  if (byCategory["security"])   parts.push(`${byCategory["security"]} security`);
  if (byCategory["accessibility"]) parts.push(`${byCategory["accessibility"]} a11y`);

  const integrationCount = byCategory["integration"] ?? 0;
  const riskCount        = byCategory["risk"] ?? 0;
  const gapCount         = byCategory["gap"] ?? 0;
  const enrichedNote     = (integrationCount + riskCount + gapCount) > 0
    ? ` · +${integrationCount + riskCount + gapCount} project-specific (${integrationCount} integration, ${riskCount} risk, ${gapCount} gap)`
    : "";

  const coverageStatement =
    `${cases.length} tests · ${ctx.criteria.length} criteria · ` +
    `${ctx.specificFields.length} fields · all 5 categories covered · ` +
    parts.join(", ") + enrichedNote;

  return {
    totalTests: cases.length,
    criteriaCount: ctx.criteria.length,
    fieldsDetected: ctx.specificFields.length,
    valuesDetected: ctx.specificValues.length,
    byCategory,
    coverageStatement,
    generatorVersion: GENERATOR_VERSION,
  };
}

// ─── Main entry points ────────────────────────────────────────────────────────

export function generateTestCasesRuleBased(
  userStory: UserStoryInput,
  enriched?: EnrichedProjectContext
): GeneratedTestCase[] {
  const ctx = extractContext(userStory, enriched);
  const reg = new TestRegistry();

  return [
    ...generateFunctionalTests(ctx, reg),
    ...generateNegativeTests(ctx, reg),
    ...generateEdgeTests(ctx, reg),
    ...generateSecurityTests(ctx, reg),
    ...generateAccessibilityTests(ctx, reg),
    ...(enriched ? generateIntegrationTests(ctx, reg, enriched) : []),
    ...(enriched ? generateRiskTests(ctx, reg, enriched) : []),
    ...(enriched ? generateGapTests(ctx, reg, enriched) : []),
  ];
}

/** Returns both test cases and a coverage summary for display in the UI. */
export function generateWithCoverageSummary(
  userStory: UserStoryInput,
  enriched?: EnrichedProjectContext
): {
  cases: GeneratedTestCase[];
  summary: CoverageSummary;
} {
  const ctx = extractContext(userStory, enriched);
  const reg = new TestRegistry();

  const cases = [
    ...generateFunctionalTests(ctx, reg),
    ...generateNegativeTests(ctx, reg),
    ...generateEdgeTests(ctx, reg),
    ...generateSecurityTests(ctx, reg),
    ...generateAccessibilityTests(ctx, reg),
    ...(enriched ? generateIntegrationTests(ctx, reg, enriched) : []),
    ...(enriched ? generateRiskTests(ctx, reg, enriched) : []),
    ...(enriched ? generateGapTests(ctx, reg, enriched) : []),
  ];

  return { cases, summary: buildCoverageSummary(cases, ctx) };
}

export async function generateTestCasesWithClaude(
  userStory: UserStoryInput
): Promise<GeneratedTestCase[]> {
  return generateTestCasesRuleBased(userStory);
}

export async function batchGenerateTestCases(
  userStories: UserStoryInput[]
): Promise<Map<number, GeneratedTestCase[]>> {
  const limit = pLimit(4);
  const results = new Map<number, GeneratedTestCase[]>();
  await Promise.all(
    userStories.map(story =>
      limit(async () => {
        results.set(story.workItemId, await generateTestCasesWithClaude(story));
      })
    )
  );
  return results;
}
