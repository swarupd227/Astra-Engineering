# NAT 2.0 — Autonomous UI Testing Upgrade Prompt
## Upgrade Existing Platform to Playwright CLI-Based Autonomous Execution

**Organization:** Nous Infosystems  
**Platform:** NAT 2.0 (Nous Autonomous Tester 2.0)  
**Prompt Type:** Engineering Upgrade Prompt — AI Coding Assistant / Replit  
**Version:** 1.0  
**Date:** February 2026

---

## CONTEXT: WHAT NAT 2.0 ALREADY HAS

You are upgrading an existing autonomous testing platform called **NAT 2.0 (Nous Autonomous Tester 2.0)**, built by **Nous Infosystems**. This is NOT a greenfield project. The platform is already operational with the following components:

### Existing Agent Architecture (Already Built)

NAT 2.0 currently operates through the following specialized AI agents:

**1. Test Impact Analyzer Agent**
- Parses Git diffs and code change metadata
- Maps code changes to affected tests and business logic
- Classifies risk level as HIGH / MEDIUM / LOW
- Recommends test execution strategy (full regression vs. targeted)

**2. Sprint Agent / Test Case Generator**
- Connects to Azure DevOps and pulls user stories
- Reads acceptance criteria and generates comprehensive test cases
- Generates: Functional, Edge Cases, Negative, Security, and Accessibility test cases
- Outputs test cases in structured BDD Gherkin format

**3. Adaptor Agent (BDD Generator)**
- Transforms AI-generated test cases into executable BDD artifacts
- Currently generates: Cucumber `.feature` files and TypeScript Playwright step definition `.ts` files
- Uses `GenericActions.ts`, `WaitHelpers.ts`, `AssertionHelpers.ts` utility classes
- Also supports PyBehave (Python) for some use cases

**4. Execution Agent (Test Orchestrator)**
- Coordinates cross-browser test execution: Chrome, Firefox, Safari (WebKit)
- Event-driven and scalable
- Currently uses: Traditional Playwright API (`page.click()`, `page.fill()`, `page.locator()`)
- Currently uses: MCP (Model Context Protocol) server for browser automation — THIS IS WHAT WE ARE REPLACING

**5. Self-Healing Agent**
- Detects broken locators due to UI changes
- Auto-suggests alternative locators
- Currently relies on DOM-based selector strategies — TO BE ENHANCED

**6. Defect Investigator Agent**
- Performs automated root cause analysis on test failures
- Auto-creates JIRA tickets on failures
- Analyzes response code mismatches, schema drifts, and UI assertion failures

**7. Reporting & Insights Agent**
- Delivers technical analytics reports and stakeholder-ready business summaries
- Covers test pass/fail rates, quality trends, business impact, and actionable recommendations

**8. CI/CD Integration**
- GitHub Actions workflows for scheduled and trigger-based test execution
- Quality gates on Pull Requests and merges

### Existing Technology Stack

```
Framework:         TypeScript + Playwright (traditional API)
BDD:               Cucumber.js + Gherkin (.feature files)
Step Definitions:  TypeScript (.ts files)
Browser Control:   Playwright MCP Server (CURRENT — BEING REPLACED)
Python Support:    PyBehave (for some agents)
CI/CD:             GitHub Actions
Defect Tracking:   JIRA (auto-ticket creation)
Test Data:         nSynth.AI (synthetic data generation)
Shift-Left:        nTestPro.AI (requirement-to-test generation)
Domains:           Healthcare, Insurance, Banking, Fintech
```

---

## THE PROBLEM WE ARE SOLVING

### Why We Are Replacing MCP with Playwright CLI

The current NAT 2.0 Execution Agent uses **MCP (Model Context Protocol)** for browser automation. This creates the following problems that are limiting NAT 2.0's scalability:

**Problem 1 — Token Bloat**
Every browser interaction sends the full accessibility tree and complete DOM snapshot to the AI agent. This consumes 3,000–5,000 tokens per interaction just for browser state, leaving little context window for actual test logic and reasoning.

**Problem 2 — Context Window Exhaustion**
In complex multi-step UI test flows (e.g., Insurance policy lifecycle: quote → bind → issue → renew → cancel), the context window fills up after just 5–8 interactions, causing the agent to lose memory of earlier test steps.

**Problem 3 — High AI Operational Costs**
Because each interaction consumes ~6,500 tokens (full DOM + tool schemas + reasoning), the per-test-execution cost is high. At scale across Healthcare, Insurance, Banking, and Fintech domains with hundreds of test cases, this becomes economically unsustainable.

**Problem 4 — Slow Execution Feedback Loop**
Processing full DOM trees introduces latency in agent reasoning between steps, slowing down the autonomous test execution loop.

### The Solution: Playwright CLI

Microsoft's **Playwright CLI** addresses all the above problems:

- Instead of full DOM trees, it returns **compact element references** (`e15`, `e21`, `e35`) — reducing browser state data from 3,000 tokens to ~50 tokens per interaction
- Browser state is kept **external** to the LLM context, allowing agents to run long multi-step test flows without context window exhaustion
- Enables **persistent named browser sessions** — each NAT 2.0 agent maintains its own session with cookies and auth state preserved
- Supports **headless and headed modes**, video recording, and full screenshot capture natively
- Results in approximately **60% reduction in AI token costs** per test execution

**Token Comparison:**

| Component | MCP (Current) | Playwright CLI (Target) |
|---|---|---|
| User Prompt | 500 tokens | 500 tokens |
| Browser State | 3,000 tokens | 50 tokens |
| Tool Schemas | 1,000 tokens | ~0 tokens |
| Agent Reasoning | 2,000 tokens | 2,000 tokens |
| **Total per Interaction** | **~6,500 tokens** | **~2,550 tokens** |
| **Savings** | — | **~60% reduction** |

---

## UPGRADE OBJECTIVE

Upgrade NAT 2.0's Execution Agent and all related components to replace the current MCP-based browser control with **Playwright CLI**. The upgrade must:

1. Replace MCP server browser automation with Playwright CLI commands across all agents
2. Build a centralized `NAT20PlaywrightCLI` wrapper class that all agents use
3. Implement dedicated named browser sessions per agent type
4. Upgrade the Self-Healing Agent to use CLI snapshot-based element references
5. Integrate Playwright CLI screenshot and video capabilities into the evidence pipeline
6. Connect Playwright CLI execution with the existing BDD step definition architecture (Cucumber + TypeScript)
7. Maintain full compatibility with existing `.feature` files and step definition `.ts` files
8. Preserve nSynth.AI and nTestPro.AI integrations
9. Maintain GitHub Actions CI/CD pipeline compatibility
10. Ensure domain-specific session isolation (Healthcare, Insurance, Banking, Fintech)

---

## DETAILED TECHNICAL REQUIREMENTS

### REQUIREMENT 1: Core Playwright CLI Wrapper Class

**File:** `src/core/NAT20PlaywrightCLI.ts`

Build a centralized TypeScript class that wraps all Playwright CLI commands. All NAT 2.0 agents must use this class — no agent should call Playwright CLI commands directly.

```typescript
// The class must implement the following interface exactly:

interface INAT20PlaywrightCLI {
  // Session Lifecycle
  initialize(url: string, options?: SessionOptions): Promise<void>;
  closeSession(): Promise<void>;
  deleteSession(): Promise<void>;
  listActiveSessions(): Promise<string[]>;

  // Navigation
  goto(url: string): Promise<void>;
  waitForLoadState(state?: 'load' | 'domcontentloaded' | 'networkidle'): Promise<void>;

  // Element Interaction
  getSnapshot(): Promise<ElementRefMap>;
  click(ref: string): Promise<void>;
  fill(ref: string, value: string): Promise<void>;
  type(text: string): Promise<void>;
  check(ref: string): Promise<void>;
  uncheck(ref: string): Promise<void>;
  select(ref: string, value: string): Promise<void>;
  drag(startRef: string, endRef: string): Promise<void>;
  upload(ref: string, filePath: string): Promise<void>;
  hover(ref: string): Promise<void>;
  doubleClick(ref: string): Promise<void>;
  pressKey(key: string): Promise<void>;

  // Data Capture & Evidence
  captureScreenshot(testName: string, options?: ScreenshotOptions): Promise<string>;
  startVideoRecording(testName: string): Promise<void>;
  stopVideoRecording(): Promise<string>;
  evaluate(expression: string): Promise<string>;

  // Internal
  exec(command: string): Promise<string>;
  parseSnapshot(rawOutput: string): ElementRefMap;
}

interface SessionOptions {
  headed?: boolean;          // Default: false (headless)
  sessionName?: string;      // Override auto-generated session name
  viewport?: { width: number; height: number };
  slowMo?: number;           // Milliseconds between actions for debugging
}

interface ScreenshotOptions {
  fullPage?: boolean;        // Capture full scrollable page. Default: false
  clip?: { x: number; y: number; width: number; height: number };
}

type ElementRefMap = Record<string, string>;
// Example: { "Submit Button": "e21", "Patient ID Field": "e15" }
```

**Snapshot Parsing Rules:**
The `parseSnapshot()` method must parse the raw CLI output and map human-readable element labels to their compact reference IDs. The parser must handle:
- Standard interactive elements (buttons, inputs, selects, checkboxes)
- Multi-word element labels with spaces
- Duplicate element labels (append index suffix: `Submit Button_1`, `Submit Button_2`)
- Elements with special characters in labels (sanitize to alphanumeric + spaces)
- Return an empty map (not an error) if the page has no interactive elements

**Error Handling Rules:**
- All CLI command failures must throw a typed `PlaywrightCLIError` with: `command`, `stderr`, `exitCode`, and `agentName`
- Retry transient failures (network timeouts, session not ready) up to 3 times with 1-second backoff
- Log all commands and responses to the NAT 2.0 execution log with timestamps

---

### REQUIREMENT 2: Session Registry and Agent Session Isolation

**File:** `src/core/SessionRegistry.ts`

Build a `SessionRegistry` singleton that manages one named browser session per NAT 2.0 agent domain. Sessions must be strictly isolated — no shared state between agent types.

```typescript
// Session names must follow this convention exactly:
const SESSION_REGISTRY = {
  HEALTHCARE:    'nat2-healthcare-session',
  INSURANCE:     'nat2-insurance-session',
  BANKING:       'nat2-banking-session',
  FINTECH:       'nat2-fintech-session',
  REGRESSION:    'nat2-regression-session',
  ACCESSIBILITY: 'nat2-accessibility-session',
  VISUAL:        'nat2-visual-session',
};

// The registry must support:
// 1. Creating a session if it does not exist
// 2. Reusing an existing session (preserves cookies, auth tokens, localStorage)
// 3. Forcibly resetting a session (clears all stored state — used before clean test runs)
// 4. Listing all currently active sessions
// 5. Cleaning up stale sessions older than a configurable TTL (default: 4 hours)
```

**Session Persistence Rules:**
- Login/authentication state MUST be preserved within a session across test cases in the same suite run
- Sessions MUST be reset between test suite runs (not between individual test cases)
- If a session crashes mid-test, the registry must auto-recreate it and log the recovery
- Session creation and cleanup must be logged to the NAT 2.0 audit trail

---

### REQUIREMENT 3: Update the Execution Agent to Use Playwright CLI

**File:** `src/agents/ExecutionAgent.ts`

The existing Execution Agent must be refactored to replace all MCP server calls with `NAT20PlaywrightCLI` wrapper calls. The agent's external interface (inputs and outputs) must remain unchanged so the Orchestrator Agent needs no modification.

**What Must Change:**
- Remove all imports and references to the MCP Playwright server
- Remove all calls to MCP tool schemas
- Replace every `page.click()`, `page.fill()`, `page.locator()` call with equivalent `cli.click(ref)`, `cli.fill(ref, value)`, `cli.getSnapshot()` calls
- Browser state must never be passed to the LLM context — only element references from snapshots
- All step execution must go through the `NAT20PlaywrightCLI` wrapper

**Execution Flow (per test scenario):**

```
1. ExecutionAgent receives a compiled test scenario from the Adaptor Agent
2. ExecutionAgent initializes a CLI session for the appropriate domain
   (Healthcare → nat2-healthcare-session, Insurance → nat2-insurance-session, etc.)
3. For each BDD step in the scenario:
   a. Call cli.getSnapshot() to get current element references
   b. Resolve the step action to a CLI command
   c. Execute the CLI command using the wrapper
   d. Capture post-action screenshot if the step is a critical assertion
   e. Log: step name, CLI command, element ref used, duration, pass/fail
4. On completion, call cli.stopVideoRecording() and attach video to the test result
5. Pass the full execution result (steps, screenshots, video, logs) to the Defect Investigator
   and Reporting Agent
```

**Parallel Execution Rules:**
- Multiple test scenarios for the same domain must share the same named session
- Scenarios for different domains must use different sessions and run fully in parallel
- Maximum 6 parallel sessions (one per domain) at any time
- Each session must run in its own Node.js worker thread (use `worker_threads`)

---

### REQUIREMENT 4: Upgrade the Self-Healing Agent with CLI Snapshot Strategy

**File:** `src/agents/SelfHealingAgent.ts`

The Self-Healing Agent must be upgraded to use Playwright CLI's snapshot-based element discovery as its primary healing strategy, replacing the current DOM XPath/CSS fallback approach.

**New Self-Healing Strategy — Four Levels:**

**Level 1: Fresh Snapshot Lookup (Primary)**
When an element reference (`e21`) fails, immediately call `cli.getSnapshot()` to get an updated reference map. Look up the element by its semantic label in the new snapshot. If found, use the new reference and proceed.

**Level 2: Semantic Label Fuzzy Match (Secondary)**
If the exact label is not in the new snapshot, use fuzzy string matching (Levenshtein distance ≤ 2) to find the closest matching label. Require a confidence score of 85% or higher before accepting the match.

**Level 3: ARIA Role + Text Content Match (Tertiary)**
If Level 2 fails, call `cli.evaluate()` to query the DOM for elements matching the expected ARIA role (button, textbox, combobox) AND containing the expected visible text. Return the first matching element reference.

**Level 4: AI-Assisted Element Recovery (Fallback)**
If all above levels fail, send the full page snapshot text to the NAT 2.0 LLM with the prompt:
```
"The element labeled '[ELEMENT_LABEL]' with action '[ACTION]' is missing from the current 
page snapshot. Based on the snapshot below, identify the most likely replacement element 
and return its reference ID and confidence score (0–100).

Page Snapshot:
[SNAPSHOT_TEXT]"
```
Accept the AI suggestion only if confidence score ≥ 80. If confidence < 80, mark the test as BLOCKED and notify the Defect Investigator.

**Healing Audit Requirements:**
- Every healing action must be logged with: original ref, new ref, healing level used, confidence score, timestamp
- Persist healed element mappings to `nat2-healing-registry.json` for reuse in future runs
- Generate a weekly healing report showing: most frequently healed elements, healing success rate, and elements that consistently fail healing (indicating structural application changes)

---

### REQUIREMENT 5: Upgrade the Adaptor Agent's Step Definition Generator

**File:** `src/agents/AdaptorAgent.ts` and `src/templates/step-definition.template.ts`

The Adaptor Agent generates TypeScript step definition `.ts` files from AI-generated test cases. Update the step definition template to natively use the `NAT20PlaywrightCLI` wrapper instead of direct Playwright page API calls.

**Current Pattern (TO BE REMOVED):**
```typescript
// OLD — Direct Playwright API — Remove this pattern entirely
When('I click the submit button', async function () {
  await this.page.click('#submit-btn');
});

When('I fill the patient ID field with {string}', async function (value: string) {
  await this.page.fill('[data-testid="patient-id"]', value);
});
```

**New Pattern (TARGET):**
```typescript
// NEW — Playwright CLI via NAT20PlaywrightCLI wrapper
import { NAT20PlaywrightCLI } from '../../core/NAT20PlaywrightCLI';

let cli: NAT20PlaywrightCLI;

Before(async function () {
  // Session is initialized by the Execution Agent before steps run
  // Step definitions receive the cli instance via World context
  cli = this.cli as NAT20PlaywrightCLI;
});

When('I click the submit button', async function () {
  const elements = await cli.getSnapshot();
  const ref = elements['Submit Button'] || elements['Submit'] || elements['Save'];
  if (!ref) throw new Error('Submit button not found in snapshot');
  await cli.click(ref);
});

When('I fill the {string} field with {string}', async function (fieldLabel: string, value: string) {
  const elements = await cli.getSnapshot();
  const ref = elements[fieldLabel];
  if (!ref) throw new Error(`Field "${fieldLabel}" not found in snapshot`);
  await cli.fill(ref, value);
});

Then('the {string} field should display {string}', async function (fieldLabel: string, expected: string) {
  const actual = await cli.evaluate(
    `() => document.querySelector('[aria-label="${fieldLabel}"]')?.value || 
           document.querySelector('[placeholder="${fieldLabel}"]')?.value || ''`
  );
  expect(actual).toBe(expected);
  await cli.captureScreenshot(`assertion-${fieldLabel}-${Date.now()}`);
});
```

**Cucumber World Context Update:**
The Cucumber World object must be updated to carry the `NAT20PlaywrightCLI` instance so all step definitions share the same session within a scenario:

```typescript
// src/support/world.ts
import { setWorldConstructor, World } from '@cucumber/cucumber';
import { NAT20PlaywrightCLI } from '../core/NAT20PlaywrightCLI';
import { SessionRegistry } from '../core/SessionRegistry';

export interface NAT2World extends World {
  cli: NAT20PlaywrightCLI;
  domain: string;
  testName: string;
  evidencePaths: string[];
}

setWorldConstructor(function (this: NAT2World, options) {
  this.domain = options.parameters?.domain || 'regression';
  this.testName = '';
  this.evidencePaths = [];

  // CLI instance is injected by the Execution Agent before scenario starts
  // Do NOT instantiate it here — the Execution Agent controls session lifecycle
});
```

**Step Definition Generation Rules:**
When the Adaptor Agent generates step definitions, it must follow these rules:

1. Never use hard-coded CSS selectors or XPaths in generated step definitions
2. Always use `cli.getSnapshot()` + label lookup as the primary element location strategy
3. Every `When` step that performs a UI action must be followed by an implicit wait (use `cli.waitForLoadState('networkidle')` after navigation-triggering actions)
4. Every `Then` assertion step must capture a screenshot as evidence
5. Use Cucumber expressions (`{string}`, `{int}`, `{float}`) — never raw regex patterns
6. Step definitions must be reusable across domains — no domain-specific logic inside step definitions (domain context comes from the World object)
7. Group step definitions by action category: Navigation steps, Form interaction steps, Assertion steps, Wait steps

---

### REQUIREMENT 6: Evidence Pipeline Upgrade

**File:** `src/core/EvidencePipeline.ts`

Build a centralized evidence collection and storage pipeline that the `NAT20PlaywrightCLI` wrapper feeds into automatically.

**Evidence Types to Capture:**

```typescript
interface TestEvidence {
  testName:       string;
  scenarioId:     string;
  domain:         string;
  screenshots:    ScreenshotEvidence[];
  video:          VideoEvidence | null;
  executionLog:   ExecutionLogEntry[];
  healingLog:     HealingLogEntry[];
  startTime:      Date;
  endTime:        Date;
  durationMs:     number;
  status:         'PASS' | 'FAIL' | 'BLOCKED' | 'SKIPPED';
}

interface ScreenshotEvidence {
  stepName:       string;
  filePath:       string;
  capturedAt:     Date;
  isFailureShot:  boolean;    // true if captured at point of failure
  elementRef:     string;     // The element reference that was interacted with
}

interface VideoEvidence {
  filePath:       string;
  durationSecs:   number;
  recordedAt:     Date;
}

interface ExecutionLogEntry {
  timestamp:      Date;
  stepName:       string;
  cliCommand:     string;
  elementRef:     string;
  status:         'PASS' | 'FAIL' | 'RETRY';
  durationMs:     number;
  errorMessage?:  string;
}
```

**Evidence Storage Rules:**
- Store all evidence under: `./evidence/{domain}/{testName}/{timestamp}/`
- Screenshots: `./evidence/{domain}/{testName}/{timestamp}/screenshots/`
- Videos: `./evidence/{domain}/{testName}/{timestamp}/videos/`
- Logs: `./evidence/{domain}/{testName}/{timestamp}/execution.log`
- Healing log: `./evidence/{domain}/{testName}/{timestamp}/healing.log`
- On test failure, auto-capture a full-page screenshot immediately at the point of failure
- Evidence must be attached to JIRA tickets created by the Defect Investigator Agent
- Evidence must be uploaded as GitHub Actions artifacts on CI/CD runs

---

### REQUIREMENT 7: Visual Regression Testing Module

**File:** `src/modules/VisualRegressionModule.ts`

Build a visual regression testing module that uses Playwright CLI's screenshot capability as its image capture engine. This module is used by the Visual agent session (`nat2-visual-session`).

**Core Functions:**

```typescript
class VisualRegressionModule {

  // Capture a baseline screenshot for a given page and test name
  async captureBaseline(
    url: string,
    testName: string,
    options?: { fullPage?: boolean; waitForSelector?: string }
  ): Promise<BaselineRecord>;

  // Compare current page against baseline
  async compareAgainstBaseline(
    url: string,
    testName: string
  ): Promise<VisualComparisonResult>;

  // Approve a new baseline (replaces existing baseline after intentional UI change)
  async approveNewBaseline(testName: string): Promise<void>;

  // Generate a visual regression report for all tests
  async generateReport(): Promise<VisualRegressionReport>;
}

interface VisualComparisonResult {
  testName:           string;
  baselineImagePath:  string;
  currentImagePath:   string;
  diffImagePath:      string;
  diffPercentage:     number;
  pixelsDifferent:    number;
  status:             'PASS' | 'FAIL' | 'BASELINE_MISSING';
  threshold:          number;     // Configurable. Default: 0.5%
  regions:            DiffRegion[];  // Highlighted diff regions
}

interface DiffRegion {
  x: number;
  y: number;
  width: number;
  height: number;
  severity: 'MINOR' | 'MODERATE' | 'MAJOR';
}
```

**Visual Regression Rules:**
- Default diff threshold: 0.5% pixel difference (configurable per test)
- If diff exceeds threshold, automatically send to Defect Investigator with: test name, diff percentage, diff image, affected regions
- Baseline images stored under: `./baselines/{domain}/{testName}/baseline.png`
- Diff images stored under: `./evidence/{domain}/{testName}/{timestamp}/visual-diff.png`
- Support region exclusions (e.g., exclude date/time fields, dynamic counters) via config
- Generate an HTML visual regression report with side-by-side baseline vs. current images

---

### REQUIREMENT 8: nSynth.AI Integration Update

**File:** `src/integrations/NSynthIntegration.ts`

Update the nSynth.AI synthetic data generation integration to work with the new Playwright CLI form-filling approach.

**Integration Pattern:**

```typescript
class NSynthIntegration {

  // Generate synthetic test data for a given domain and form
  async generateFormData(
    domain: 'healthcare' | 'insurance' | 'banking' | 'fintech',
    formType: string,
    options?: DataGenerationOptions
  ): Promise<SyntheticFormData>;

  // Fill a form using synthetic data via Playwright CLI
  async fillFormWithSyntheticData(
    cli: NAT20PlaywrightCLI,
    domain: string,
    formType: string
  ): Promise<FilledFieldReport>;
}

interface SyntheticFormData {
  domain:         string;
  formType:       string;
  fields:         Record<string, string>;  // { "Patient ID": "PT-2026-88432", ... }
  generatedAt:    Date;
  dataProfileId:  string;   // For traceability and reproducibility
}

interface FilledFieldReport {
  totalFields:    number;
  filledFields:   number;
  skippedFields:  string[];   // Fields in nSynth data but not found in snapshot
  unmatchedRefs:  string[];   // Fields in snapshot but not in nSynth data
}
```

**Form Filling Flow:**

```typescript
// Example: Fill an insurance policy creation form with synthetic data
const syntheticData = await nSynth.generateFormData('insurance', 'new-policy');

// Get current page snapshot
const elements = await cli.getSnapshot();

// Match synthetic data fields to snapshot element references
for (const [fieldLabel, value] of Object.entries(syntheticData.fields)) {
  const ref = elements[fieldLabel];
  if (ref) {
    await cli.fill(ref, value);
  } else {
    // Log to FilledFieldReport.skippedFields — do not throw
    report.skippedFields.push(fieldLabel);
  }
}
```

---

### REQUIREMENT 9: nTestPro.AI Shift-Left Integration Update

**File:** `src/integrations/NTestProIntegration.ts`

Update the nTestPro.AI shift-left testing integration to pass generated test scenarios directly to the upgraded Execution Agent (which now uses Playwright CLI).

**Integration Flow:**

```typescript
// nTestPro.AI generates test scenarios from requirements BEFORE code is written
// Those scenarios are passed to the Execution Agent as soon as a feature is deployed to Dev

class NTestProIntegration {

  // Receive a generated test scenario from nTestPro.AI
  async receiveScenario(scenario: NTestProScenario): Promise<void>;

  // Convert nTestPro scenario format to NAT 2.0 BDD step format
  convertToBDDSteps(scenario: NTestProScenario): BDDScenario;

  // Trigger immediate execution via the Execution Agent
  async executeScenario(scenario: BDDScenario, domain: string): Promise<TestResult>;
}

interface NTestProScenario {
  requirementId:  string;
  title:          string;
  steps: {
    action:       string;   // "navigate", "click", "fill", "assert"
    target:       string;   // Human-readable element label
    value?:       string;   // For fill actions
    expected?:    string;   // For assertion steps
  }[];
  priority:       'HIGH' | 'MEDIUM' | 'LOW';
  domain:         string;
}
```

---

### REQUIREMENT 10: GitHub Actions CI/CD Pipeline Update

**File:** `.github/workflows/nat2-autonomous-ui-tests.yml`

Update the GitHub Actions workflow to support Playwright CLI-based execution. The workflow must support the following trigger modes:

**Trigger Modes:**
1. On Pull Request — Run smoke tests only (fast feedback, < 5 minutes)
2. On Merge to Develop — Run full regression suite per domain in parallel
3. On Schedule (nightly) — Run full suite including visual regression
4. On Manual Dispatch — Run specific domain or specific test by name

```yaml
# The workflow must implement:

name: NAT 2.0 Autonomous UI Tests (Playwright CLI)

on:
  pull_request:
    branches: [main, develop]
  push:
    branches: [develop, main]
  schedule:
    - cron: '0 1 * * *'    # Nightly at 1:00 AM UTC
  workflow_dispatch:
    inputs:
      domain:
        description: 'Domain to test (healthcare/insurance/banking/fintech/all)'
        required: true
        default: 'all'
      test_suite:
        description: 'Test suite (smoke/regression/visual/all)'
        required: true
        default: 'smoke'

jobs:
  # Job 1: Determine what to run based on trigger
  test-strategy:
    # Outputs: domains_to_test, suite_type, run_visual_regression

  # Job 2: Run Playwright CLI tests per domain in parallel matrix
  autonomous-ui-tests:
    needs: test-strategy
    strategy:
      matrix:
        domain: ${{ fromJSON(needs.test-strategy.outputs.domains_to_test) }}
      fail-fast: false    # Do NOT stop other domains if one fails
    steps:
      - Install Node.js and Playwright CLI
      - Install Chromium, Firefox, WebKit browsers
      - Run NAT 2.0 Execution Agent for domain
      - Upload evidence artifacts (screenshots, videos, logs)
      - Publish test results to GitHub Actions summary

  # Job 3: Quality Gate Check
  quality-gate:
    needs: autonomous-ui-tests
    steps:
      - Check pass rate threshold (default: 95% for main, 85% for develop)
      - Block merge if visual regression failures detected
      - Post results summary as PR comment
      - Notify via Slack/Teams on failure
```

**GitHub Actions Requirements:**
- Evidence artifacts (screenshots, videos) must be uploaded with 30-day retention
- Test results must be published in JUnit XML format for GitHub's test reporting UI
- Failed tests must auto-create JIRA tickets (via Defect Investigator Agent webhook)
- The quality gate must be a required status check on the main branch

---

### REQUIREMENT 11: Accessibility Testing Integration

**File:** `src/modules/AccessibilityModule.ts`

The Accessibility agent session (`nat2-accessibility-session`) must use Playwright CLI for page navigation and screenshot capture, while running axe-core for WCAG 2.2 Level AA validation.

```typescript
class AccessibilityModule {

  async runAccessibilityAudit(
    url: string,
    standard: 'WCAG_2_1_AA' | 'WCAG_2_2_AA' | 'Section508'
  ): Promise<AccessibilityReport>;

  // Navigate to the page using Playwright CLI
  // Inject axe-core via cli.evaluate()
  // Run axe analysis via cli.evaluate()
  // Return structured violations report

  async generateRemediationGuide(violations: AxeViolation[]): Promise<string>;
}

interface AccessibilityReport {
  url:            string;
  standard:       string;
  totalViolations: number;
  criticalCount:  number;
  seriousCount:   number;
  moderateCount:  number;
  minorCount:     number;
  violations:     AxeViolation[];
  screenshot:     string;     // Full-page screenshot path
  auditedAt:      Date;
  wcagComplianceScore: number;  // 0–100
}
```

---

## IMPLEMENTATION SEQUENCE

Build in this exact order. Do not skip phases or build out of sequence.

### Phase 1: Foundation Layer (Build First)
1. Build `NAT20PlaywrightCLI.ts` wrapper class with all commands and error handling
2. Build `SessionRegistry.ts` with all six domain sessions
3. Write unit tests for the wrapper class and session registry
4. Verify Playwright CLI commands work correctly in the project environment

### Phase 2: Execution Agent Upgrade (Build Second)
5. Refactor `ExecutionAgent.ts` to remove all MCP dependencies
6. Replace all MCP calls with `NAT20PlaywrightCLI` wrapper calls
7. Implement parallel session management using worker threads
8. Build `EvidencePipeline.ts` and connect it to the Execution Agent
9. Run existing feature files against the upgraded Execution Agent and verify all pass

### Phase 3: Adaptor Agent and Step Definitions (Build Third)
10. Update `AdaptorAgent.ts` step definition template to use CLI wrapper pattern
11. Update Cucumber World context to carry CLI instance
12. Regenerate step definition files for existing feature files using the new template
13. Verify all step definitions execute correctly with the new pattern

### Phase 4: Self-Healing Agent Upgrade (Build Fourth)
14. Upgrade `SelfHealingAgent.ts` with four-level snapshot-based healing strategy
15. Build the healing registry persistence (`nat2-healing-registry.json`)
16. Test self-healing with intentionally broken element references

### Phase 5: Advanced Modules (Build Fifth)
17. Build `VisualRegressionModule.ts` and capture baselines for all existing test pages
18. Update `NSynthIntegration.ts` for new CLI form-filling pattern
19. Update `NTestProIntegration.ts` for shift-left scenario execution
20. Build `AccessibilityModule.ts` with axe-core integration

### Phase 6: CI/CD and Reporting (Build Last)
21. Update GitHub Actions workflow (`nat2-autonomous-ui-tests.yml`)
22. Test full pipeline end-to-end: PR trigger → parallel domain execution → quality gate → evidence upload
23. Update Reporting Agent to include CLI execution metrics (token savings, session reuse rate, healing success rate)

---

## FILE STRUCTURE

The upgrade must result in the following file structure (new or modified files only):

```
nat2.0/
├── src/
│   ├── core/
│   │   ├── NAT20PlaywrightCLI.ts          ← NEW: Core CLI wrapper
│   │   ├── SessionRegistry.ts             ← NEW: Agent session manager
│   │   └── EvidencePipeline.ts            ← NEW: Evidence collection
│   ├── agents/
│   │   ├── ExecutionAgent.ts              ← MODIFIED: Replace MCP with CLI
│   │   ├── SelfHealingAgent.ts            ← MODIFIED: Snapshot-based healing
│   │   └── AdaptorAgent.ts               ← MODIFIED: New step def template
│   ├── modules/
│   │   ├── VisualRegressionModule.ts      ← NEW: CLI-based visual regression
│   │   └── AccessibilityModule.ts         ← MODIFIED: CLI navigation + axe
│   ├── integrations/
│   │   ├── NSynthIntegration.ts          ← MODIFIED: CLI form filling
│   │   └── NTestProIntegration.ts        ← MODIFIED: CLI scenario execution
│   ├── support/
│   │   └── world.ts                      ← MODIFIED: CLI in World context
│   └── templates/
│       └── step-definition.template.ts    ← MODIFIED: CLI-based template
├── evidence/                              ← NEW: Evidence output directory
│   ├── healthcare/
│   ├── insurance/
│   ├── banking/
│   └── fintech/
├── baselines/                             ← NEW: Visual regression baselines
├── nat2-healing-registry.json            ← NEW: Healing audit registry
└── .github/workflows/
    └── nat2-autonomous-ui-tests.yml      ← MODIFIED: CLI-based pipeline
```

---

## CONSTRAINTS AND NON-NEGOTIABLES

1. **No Hard-Coded Selectors** — Zero CSS selectors or XPaths in any generated step definition. Element lookup must always go through `cli.getSnapshot()` + label matching.

2. **No Direct Playwright API Calls in Step Definitions** — Step definitions must never call `page.click()`, `page.fill()`, `page.locator()`. Only `cli.*` methods are allowed.

3. **No Shared State Between Domain Sessions** — Healthcare session and Insurance session must never share cookies, localStorage, or auth tokens. If contamination is detected, throw a `SessionContaminationError` and reset both sessions.

4. **Backward Compatibility** — All existing `.feature` files must continue to work without modification. Only step definition implementations change, not Gherkin scenarios.

5. **Evidence for Every Assertion** — Every `Then` step that makes an assertion must automatically capture a screenshot. This is not optional.

6. **Token Budget Per Test** — The total token consumption per test scenario must not exceed 3,000 tokens (down from the current ~6,500). Log token usage per test.

7. **Session Cleanup on Completion** — Every test suite run must clean up its sessions after completion. Orphaned sessions must not accumulate.

8. **Audit Trail** — Every CLI command executed must be logged with: timestamp, agent name, session name, command, element ref, duration, result. This log is mandatory for compliance in Healthcare and Insurance domains.

9. **Domain Language in Logs** — Log messages must use domain-appropriate language. Healthcare tests log "patient", "claim", "EHR". Insurance tests log "policy", "premium", "coverage". Do not mix domain terminology in logs.

10. **Graceful Degradation** — If Playwright CLI is unavailable (e.g., environment issue), the system must gracefully fall back to the legacy MCP approach and alert the ops team, rather than crashing.

---

## ACCEPTANCE CRITERIA

The upgrade is complete when ALL of the following are true:

- [ ] All existing feature files execute successfully using the new CLI-based Execution Agent
- [ ] Token consumption per test interaction is ≤ 50 tokens for browser state (vs. 3,000 current)
- [ ] Six domain-isolated sessions operate in parallel without interference
- [ ] Self-Healing Agent successfully heals broken element references in at least Level 1 or Level 2 for 90%+ of test failures caused by UI changes
- [ ] Visual regression module captures baselines and detects intentional pixel diffs above threshold
- [ ] Evidence pipeline captures screenshots and videos for every scenario
- [ ] GitHub Actions pipeline completes a full domain regression run in under 15 minutes
- [ ] All JIRA tickets created by Defect Investigator include attached CLI execution logs and failure screenshots
- [ ] nSynth.AI synthetic data correctly populates form fields via CLI fill commands
- [ ] Accessibility module detects WCAG 2.2 Level AA violations on test pages
- [ ] Zero hard-coded selectors exist anywhere in the generated or static step definition files
- [ ] Healing registry persists across runs and grows over time with healed mappings

---

*This prompt is the authoritative engineering specification for the NAT 2.0 Playwright CLI upgrade. All implementation decisions must be traceable back to one of the requirements above. If a requirement is ambiguous, default to the stricter interpretation.*

*Built for Nous Infosystems — NAT 2.0 Engineering Team*
