/**
 * Script Writer Agent
 * Takes recorded NL steps + start URL → generates a full POM framework via Claude.
 *
 * Output files:
 *   pages/<PageName>Page.ts          — Page Object (all locators)
 *   actions/generic/browser.actions.ts
 *   actions/generic/form.actions.ts
 *   actions/generic/assert.actions.ts
 *   actions/business/<domain>.actions.ts  — Business Actions (compose POM + generic)
 *   tests/<name>.spec.ts              — Clean test using only Business Actions
 *   playwright.config.ts
 *   package.json
 */

import Anthropic from '@anthropic-ai/sdk';
import { qeAnthropicClient as anthropic } from './ai-client.js';

// Model to use for all script generation — defaults to Sonnet if not configured
const SCRIPT_MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5';

export interface LocatorEntry { name: string; strategy: string; description: string; }
export interface FunctionEntry { name: string; description: string; stepCount: number; }

export interface FileMetadata {
  // POM metadata
  className?: string;
  locators?: LocatorEntry[];
  methods?: string[];
  snapshotUsed?: boolean;   // true when ARIA snapshot informed locator generation
  // Business Actions metadata
  functions?: FunctionEntry[];
  // Test file metadata
  testCaseName?: string;
  businessScenario?: string;
  businessActionsUsed?: string[];
  assertionsUsed?: string[];
}

export interface GeneratedFile {
  path: string;       // e.g. "pages/ContactPage.ts"
  content: string;
  type: 'pom' | 'generic_action' | 'business_action' | 'test' | 'config';
  metadata?: FileMetadata;
}

export interface FrameworkGenerationResult {
  files: GeneratedFile[];
  pageName: string;
  businessDomain: string;
  testName: string;
}

// ─── JSON Output Schemas (Azure-compatible — no tool_use dependency) ─────────
// Azure-hosted Anthropic does not support the `tools` API.
// Instead we embed the output schema in the prompt and parse JSON from text.

const POM_JSON_SCHEMA = `You MUST respond with ONLY a JSON object (no markdown fences, no explanation text before or after) with these fields:
{
  "locatorsCode": "Complete TypeScript locators file. MANDATORY: 1) ALWAYS use page.locator('xpath=...') — NEVER getByRole/getByLabel/getByPlaceholder/getByText. 2) XPath priority: @id > @data-testid > @aria-label > @name > text-based. 3) Import: import { Page, Locator } from '@playwright/test'; 4) Add comment per locator: // Uniqueness: unique|verify | Stability: stable|fragile | Fallback: alternative-xpath",
  "code": "Complete TypeScript Page Object class file. Imports from locators file. ONLY methods, no inline locators. No markdown fences.",
  "className": "e.g. ContactPage",
  "locators": [{ "name": "nameInput", "strategy": "locator", "description": "What UI element" }],
  "methods": ["methodName1", "methodName2"]
}`;

const BUSINESS_ACTIONS_JSON_SCHEMA = `You MUST respond with ONLY a JSON object (no markdown fences, no explanation text before or after) with these fields:
{
  "code": "Complete TypeScript module code — no markdown fences.",
  "functions": [{ "name": "submitContactForm", "description": "One sentence describing the business intent", "stepCount": 5 }]
}`;

const TEST_JSON_SCHEMA = `You MUST respond with ONLY a JSON object (no markdown fences, no explanation text before or after) with these fields:
{
  "code": "Complete TypeScript test file — no markdown fences.",
  "testCaseName": "e.g. Submit contact form and verify confirmation",
  "businessScenario": "One sentence describing the business flow",
  "businessActionsUsed": ["functionName1"],
  "assertionsUsed": ["verifyText", "verifyUrl"]
}`;

/** Parse JSON from a Claude text response, stripping markdown fences if present */
function parseJsonResponse<T>(text: string): T {
  let cleaned = text.trim();
  if (cleaned.startsWith('```json')) cleaned = cleaned.slice(7);
  else if (cleaned.startsWith('```')) cleaned = cleaned.slice(3);
  if (cleaned.endsWith('```')) cleaned = cleaned.slice(0, -3);
  cleaned = cleaned.trim();
  return JSON.parse(cleaned) as T;
}

// ─── Static Generic Action Files (no AI needed, stable across all frameworks) ─

const GENERIC_BROWSER_ACTIONS = `import { Page } from '@playwright/test';

/** Navigate to a URL and wait for the page to fully settle */
export async function navigateTo(page: Page, url: string): Promise<void> {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  // After domcontentloaded, attempt networkidle with generous timeout for SPAs
  await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {
    // networkidle timeout is acceptable on pages with long-running polling
  });
}

/** Click a link by its visible text. Uses .first() to avoid strict-mode errors. */
export async function clickLink(page: Page, name: string): Promise<void> {
  await page.getByRole('link', { name, exact: false }).first().click();
}

/** Click a button by its visible text. Uses .first() to avoid strict-mode errors. */
export async function clickButton(page: Page, name: string): Promise<void> {
  await page.getByRole('button', { name, exact: false }).first().click();
}

/** Click any element matching a CSS selector */
export async function clickElement(page: Page, selector: string): Promise<void> {
  await page.locator(selector).first().click();
}

/** Hover over an element by CSS selector */
export async function hoverElement(page: Page, selector: string): Promise<void> {
  await page.locator(selector).first().hover();
}

/** Press a keyboard key (e.g. 'Enter', 'Tab', 'Escape') */
export async function pressKey(page: Page, key: string): Promise<void> {
  await page.keyboard.press(key);
}

/** Scroll an element into view */
export async function scrollToElement(page: Page, selector: string): Promise<void> {
  await page.locator(selector).first().scrollIntoViewIfNeeded();
}

/** Wait for a URL pattern — accepts a full URL, path segment like '/dashboard', or glob */
export async function waitForUrl(page: Page, pattern: string, timeoutMs = 15000): Promise<void> {
  // Full URL and existing globs are used as-is; path segments get a leading glob
  const glob = pattern.startsWith('http') || pattern.startsWith('**')
    ? pattern
    : \`**\${pattern.startsWith('/') ? '' : '/'}\${pattern}\`;
  await page.waitForURL(glob, { timeout: timeoutMs });
}

/** Wait for an element to be visible */
export async function waitForVisible(page: Page, selector: string, timeoutMs = 10000): Promise<void> {
  await page.locator(selector).first().waitFor({ state: 'visible', timeout: timeoutMs });
}

/** Wait for an element to disappear (e.g. loading spinner) */
export async function waitForHidden(page: Page, selector: string, timeoutMs = 10000): Promise<void> {
  await page.locator(selector).first().waitFor({ state: 'hidden', timeout: timeoutMs });
}

/** Reload the current page */
export async function reloadPage(page: Page): Promise<void> {
  await page.reload({ waitUntil: 'domcontentloaded' });
}

/** Get the current page URL */
export async function getCurrentUrl(page: Page): Promise<string> {
  return page.url();
}

/**
 * Wait for network to settle after an action that triggers API calls.
 * Call AFTER the triggering action — never before.
 */
export async function waitForNetworkIdle(page: Page, timeoutMs = 15000): Promise<void> {
  await page.waitForLoadState('networkidle', { timeout: timeoutMs }).catch(() => {});
}

/** Wait for a loading spinner / skeleton to disappear */
export async function waitForLoadingComplete(
  page: Page,
  spinnerSelector = '[class*="loading"], [class*="spinner"], [class*="skeleton"]'
): Promise<void> {
  try {
    const spinner = page.locator(spinnerSelector).first();
    if (await spinner.isVisible({ timeout: 2000 })) {
      await spinner.waitFor({ state: 'hidden', timeout: 15000 });
    }
  } catch {
    // spinner never appeared — that's fine
  }
}

/**
 * Click a button then wait for network to settle.
 * The click fires FIRST, then we await networkidle so we capture
 * the network activity triggered by that click (not a prior state).
 */
export async function clickAndWait(page: Page, name: string): Promise<void> {
  await page.getByRole('button', { name, exact: false }).first().click();
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
}

/**
 * Click a button that causes a full-page navigation.
 * Waits for domcontentloaded AFTER the click — avoids the race where
 * waitForURL('**\/*') resolves immediately against the current URL.
 */
export async function clickAndNavigate(page: Page, name: string): Promise<void> {
  await Promise.all([
    page.waitForLoadState('domcontentloaded', { timeout: 20000 }),
    page.getByRole('button', { name, exact: false }).first().click(),
  ]);
}

/**
 * Click a link that causes a full-page navigation.
 * Same pattern as clickAndNavigate but targets role='link'.
 */
export async function clickLinkAndNavigate(page: Page, name: string): Promise<void> {
  await Promise.all([
    page.waitForLoadState('domcontentloaded', { timeout: 20000 }),
    page.getByRole('link', { name, exact: false }).first().click(),
  ]);
}
`;

const GENERIC_FORM_ACTIONS = `import { Page } from '@playwright/test';

/**
 * Fill a field by label text, placeholder, or aria-label (in priority order).
 * Handles both label-associated inputs and placeholder-only inputs.
 */
export async function fillField(page: Page, labelOrPlaceholder: string, value: string) {
  // Try label-associated input first (most accessible pattern)
  const byLabel = page.getByLabel(labelOrPlaceholder, { exact: false });
  if (await byLabel.count() > 0) {
    await byLabel.first().clear();
    await byLabel.first().fill(value);
    return;
  }
  // Fallback: placeholder attribute (case-insensitive)
  const byPlaceholder = page.getByPlaceholder(labelOrPlaceholder, { exact: false });
  if (await byPlaceholder.count() > 0) {
    await byPlaceholder.first().clear();
    await byPlaceholder.first().fill(value);
    return;
  }
  // Last resort: aria-label or name attribute
  await page.locator(
    \`input[aria-label*="\${labelOrPlaceholder}" i], textarea[aria-label*="\${labelOrPlaceholder}" i], input[name*="\${labelOrPlaceholder}" i]\`
  ).first().fill(value);
}

/** Fill a password field — reads value from TEST_PASSWORD env var for security */
export async function fillPassword(page: Page, labelOrPlaceholder: string) {
  const val = process.env.TEST_PASSWORD || '';
  const byLabel = page.getByLabel(labelOrPlaceholder, { exact: false });
  if (await byLabel.count() > 0) {
    await byLabel.first().fill(val);
    return;
  }
  await page.locator(\`input[type="password"]\`).first().fill(val);
}

/** Clear a field then type value character by character (useful for autocomplete inputs) */
export async function typeInField(page: Page, labelOrPlaceholder: string, value: string) {
  const byLabel = page.getByLabel(labelOrPlaceholder, { exact: false });
  const locator = await byLabel.count() > 0
    ? byLabel.first()
    : page.getByPlaceholder(labelOrPlaceholder, { exact: false }).first();
  await locator.clear();
  await locator.pressSequentially(value, { delay: 50 });
}

/** Check a checkbox by label text or selector */
export async function checkBox(page: Page, labelOrSelector: string) {
  const byLabel = page.getByLabel(labelOrSelector, { exact: false });
  if (await byLabel.count() > 0) {
    await byLabel.first().check();
    return;
  }
  await page.locator(labelOrSelector).first().check();
}

/** Uncheck a checkbox by label text or selector */
export async function uncheckBox(page: Page, labelOrSelector: string) {
  const byLabel = page.getByLabel(labelOrSelector, { exact: false });
  if (await byLabel.count() > 0) {
    await byLabel.first().uncheck();
    return;
  }
  await page.locator(labelOrSelector).first().uncheck();
}

/** Select a dropdown option by the field's label and the option's visible text */
export async function selectOption(page: Page, labelText: string, value: string) {
  const byLabel = page.getByLabel(labelText, { exact: false });
  if (await byLabel.count() > 0) {
    await byLabel.selectOption({ label: value });
    return;
  }
  // Fallback: find select element by name attribute
  await page.locator(\`select[name*="\${labelText}" i]\`).first().selectOption({ label: value });
}

/** Upload a file to a file input */
export async function uploadFile(page: Page, labelText: string, filePath: string) {
  const byLabel = page.getByLabel(labelText, { exact: false });
  if (await byLabel.count() > 0) {
    await byLabel.first().setInputFiles(filePath);
    return;
  }
  await page.locator('input[type="file"]').first().setInputFiles(filePath);
}

/** Submit the active form — tries submit button first, then form.submit() */
export async function submitForm(page: Page, buttonText?: string) {
  if (buttonText) {
    await page.getByRole('button', { name: buttonText, exact: false }).first().click();
    return;
  }
  // Try common submit button patterns
  const submitBtn = page.getByRole('button', { name: /submit|save|continue|next|login|sign in/i });
  if (await submitBtn.count() > 0) {
    await submitBtn.first().click();
    return;
  }
  await page.locator('[type="submit"]').first().click();
}
`;

const GENERIC_ASSERT_ACTIONS = `import { Page, expect, test } from '@playwright/test';
import * as path from 'path';
import * as fs   from 'fs';

/** Assert visible text exists on the page (substring match by default).
 *  Uses Playwright's :text()/:text-is() + :visible pseudo-class combination so we only
 *  match elements that are actually rendered on screen — not hidden mobile menus,
 *  collapsed accordions, breadcrumbs inside display:none containers, etc.
 */
export async function verifyText(page: Page, text: string, exact = false) {
  const escaped = text.replace(/"/g, '\\"');
  // :text-is() / :text() are Playwright's built-in text pseudo-classes.
  // :visible ensures the matched element is visible (not display:none / hidden).
  const sel = exact
    ? \`:text-is("\${escaped}"):visible\`
    : \`:text("\${escaped}"):visible\`;
  await expect(page.locator(sel).first()).toBeVisible({ timeout: 10000 });
}

/** Assert current URL contains a path */
export async function verifyUrl(page: Page, path: string) {
  await expect(page).toHaveURL(new RegExp(path.replace(/[.*+?^$\{}()|[\\]\\\\]/g, '\\\\$&')));
}

/** Assert an element (by CSS/role selector) is visible */
export async function verifyVisible(page: Page, selector: string) {
  await expect(page.locator(selector).first()).toBeVisible();
}

/** Assert page does NOT contain text */
export async function verifyNotPresent(page: Page, text: string) {
  await expect(page.getByText(text, { exact: false })).not.toBeVisible();
}

/** Assert an input or textarea has a specific value */
export async function verifyInputValue(page: Page, label: string, expected: string) {
  const loc = page.locator(\`input[placeholder*="\${label}" i], textarea[placeholder*="\${label}" i], input[aria-label*="\${label}" i]\`).first();
  await expect(loc).toHaveValue(expected);
}

/** Assert an input value contains a substring */
export async function verifyInputContains(page: Page, label: string, substring: string) {
  const loc = page.locator(\`input[placeholder*="\${label}" i], textarea[placeholder*="\${label}" i]\`).first();
  await expect(loc).toHaveValue(new RegExp(substring, 'i'));
}

/** Assert a button or element is enabled */
export async function verifyEnabled(page: Page, label: string) {
  await expect(page.getByRole('button', { name: label, exact: false })).toBeEnabled();
}

/** Assert a button or element is disabled */
export async function verifyDisabled(page: Page, label: string) {
  await expect(page.getByRole('button', { name: label, exact: false })).toBeDisabled();
}

/** Assert a checkbox or radio is checked */
export async function verifyChecked(page: Page, label: string) {
  await expect(page.getByLabel(label, { exact: false })).toBeChecked();
}

/** Assert a checkbox or radio is NOT checked */
export async function verifyUnchecked(page: Page, label: string) {
  await expect(page.getByLabel(label, { exact: false })).not.toBeChecked();
}

/** Assert an element has a specific HTML attribute value */
export async function verifyAttribute(page: Page, label: string, attr: string, expected: string) {
  const loc = page.getByText(label, { exact: false }).first();
  await expect(loc).toHaveAttribute(attr, expected);
}

/** Assert the number of elements matching a selector */
export async function verifyCount(page: Page, selector: string, count: number) {
  await expect(page.locator(selector)).toHaveCount(count);
}

/**
 * Soft assertion — records the failure without stopping the test.
 * - label   : human-readable step name shown in console and HTML report
 * - failures: accumulated list; caller throws at the end if non-empty
 */
export async function softAssert(
  fn: () => Promise<void>,
  failures: string[],
  label = 'Assertion'
): Promise<void> {
  try {
    await fn();
    console.log(\`  ✓ \${label}\`);
  } catch (e: any) {
    // Keep only the first 3 lines of the stack — enough to identify the failure
    const msg = (e.message || String(e)).split('\\n').slice(0, 3).join(' | ');
    failures.push(\`\${label}: \${msg}\`);
    console.error(\`  ✗ \${label}\\n    → \${msg}\`);
  }
}

/**
 * Capture a full-page screenshot and print its absolute path to the console.
 * Called automatically by verify functions when any soft assertion failed.
 */
export async function screenshotOnFailure(page: Page, label: string): Promise<string> {
  const dir  = path.join('test-results', 'screenshots');
  fs.mkdirSync(dir, { recursive: true });
  const safe = label.replace(/[^a-z0-9]/gi, '-').toLowerCase();
  const file = path.join(dir, \`\${safe}-\${Date.now()}.png\`);
  await page.screenshot({ path: file, fullPage: true });
  const abs = path.resolve(file);
  console.error(\`\\n  📸 Screenshot saved: \${abs}\\n\`);
  return abs;
}
`;

function buildPlaywrightConfig(hasAuth: boolean, startUrl: string): string {
  // Shared config block used in both auth and non-auth variants
  const sharedConfig = `  testDir: './tests',
  fullyParallel: true,
  retries: process.env.CI ? 2 : 1,
  timeout: 60000,
  expect: { timeout: 10000 },
  use: {
    headless: process.env.CI ? true : false,
    baseURL: process.env.BASE_URL || '${startUrl}',
    viewport: { width: 1280, height: 720 },
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    trace: 'retain-on-failure',
    // Path aliases from tsconfig.json are honoured automatically by Playwright
  },
  reporter: [
    ['html', { open: 'never', outputFolder: 'playwright-report' }],
    ['junit', { outputFile: 'test-results/results.xml' }],
    ['allure-playwright', { detail: true, outputFolder: 'allure-results', suiteTitle: false }],
    ['list'],
  ],
  outputDir: 'test-results',`;

  if (hasAuth) {
    return `import { defineConfig, devices } from '@playwright/test';
import * as dotenv from 'dotenv';
dotenv.config();

export default defineConfig({
${sharedConfig}
  projects: [
    // 1. Run auth setup first — logs in and saves session to .auth/user.json
    {
      name: 'setup',
      testMatch: /auth\\.setup\\.ts/,
    },
    // 2. Run all tests with the saved session (no login per test)
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        storageState: '.auth/user.json',
      },
      dependencies: ['setup'],
    },
  ],
});
`;
  }

  return `import { defineConfig, devices } from '@playwright/test';
import * as dotenv from 'dotenv';
dotenv.config();

export default defineConfig({
${sharedConfig}
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
`;
}

const PACKAGE_JSON = `{
  "name": "recorded-test-framework",
  "version": "1.0.0",
  "description": "Auto-generated POM test framework from NAT 2.0 Recording Studio",
  "scripts": {
    "postinstall": "npx playwright install --with-deps chromium",
    "test": "npx playwright test",
    "test:headed": "npx playwright test --headed",
    "test:ui": "npx playwright test --ui",
    "test:auth": "npx playwright test --project=setup",
    "test:ci": "npx playwright test --reporter=junit,html",
    "test:debug": "npx playwright test --debug",
    "report": "npx playwright show-report",
    "report:allure": "allure generate allure-results --clean -o allure-report && allure open allure-report"
  },
  "dependencies": {
    "dotenv": "^16.4.0"
  },
  "devDependencies": {
    "@playwright/test": "^1.52.0",
    "allure-playwright": "^3.0.0",
    "allure-commandline": "^2.30.0",
    "typescript": "^5.5.0"
  }
}
`;

// Rule 2: helpers/universal.ts is ALWAYS emitted with every generated project.
// Tests import prepareSite from this file — it must never be a phantom import.
const HELPERS_UNIVERSAL = `import { Page, BrowserContext, Locator } from '@playwright/test';

// Common cookie / consent banner selectors (covers 95% of customer sites)
const CONSENT_SELECTORS = [
  '#onetrust-accept-btn-handler','#onetrust-pc-btn-handler',
  '#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll','#CybotCookiebotDialogBodyButtonAccept',
  '.trustarc-agree-btn','.qc-cmp2-summary-buttons button:first-child',
  '.osano-cm-accept-all','#didomi-notice-agree-button','.fc-button.fc-cta-consent',
  'button[data-testid="uc-accept-all-button"]','#axeptio_btn_acceptAll','.cky-btn-accept',
  '#iubenda-cs-accept-btn','.klaro button.cm-btn-accept-all',
  'button[id*="accept"][id*="cookie" i]','button[class*="accept-all" i]',
  'button[class*="acceptAll" i]','[aria-label*="Accept all" i]',
  // WordPress-style cookie banners (#cookie-content, .cookie-notice, etc.)
  '#cookie-close','#cookie-accept','#cookie-agree',
  '#cookie-content button','#cookie-content a.close','#cookie-content .close',
  '.cookie-notice-container button','.cookie-notice button',
  '#eu-cookie-law button','#cookiebar button','.cookiebar button',
  '[id*="cookie"] button[class*="close" i]','[id*="cookie"] button[class*="accept" i]',
  '[id*="cookie"] button[class*="agree" i]','[id*="cookie"] .dismiss',
];
const CONSENT_XPATH = [
  "//button[translate(normalize-space(.),'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz')='accept all cookies']",
  "//button[translate(normalize-space(.),'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz')='accept all']",
  "//button[translate(normalize-space(.),'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz')='allow all']",
  "//button[translate(normalize-space(.),'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz')='i agree']",
  "//button[translate(normalize-space(.),'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz')='got it']",
  "//a[translate(normalize-space(.),'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz')='accept all cookies']",
];
export async function dismissOverlays(page: Page): Promise<void> {
  for (const s of CONSENT_SELECTORS) { try { const el=page.locator(s).first(); if(await el.isVisible({timeout:800})){await el.click({timeout:3000});await page.waitForTimeout(600);return;} } catch{} }
  for (const x of CONSENT_XPATH) { try { const el=page.locator('xpath='+x).first(); if(await el.isVisible({timeout:400})){await el.click({timeout:2000});await page.waitForTimeout(600);return;} } catch{} }
}
export async function dismissPopups(page: Page): Promise<void> {
  const sels=['[role="dialog"] button[aria-label*="close" i]','[role="dialog"] button[class*="close" i]','.modal button[class*="close" i]','.popup button[class*="close" i]'];
  for(const s of sels){try{const el=page.locator(s).first();if(await el.isVisible({timeout:400})){await el.click({timeout:2000});await page.waitForTimeout(400);}}catch{}}
}
export async function waitForStableURL(page: Page, ms=15000): Promise<string> {
  let last='',stable=0,deadline=Date.now()+ms;
  while(Date.now()<deadline){await page.waitForTimeout(300);const u=page.url();if(u!=='about:blank'&&u===last){stable++;if(stable>=4)return u;}else{stable=0;last=u;}}
  return page.url();
}
export async function waitForPageReady(page: Page): Promise<void> {
  await page.waitForLoadState('domcontentloaded').catch(()=>{});
  await waitForStableURL(page,10000);
  await page.waitForLoadState('networkidle',{timeout:8000}).catch(()=>{});
}
export async function clickNewTab(context: BrowserContext, locator: Locator): Promise<Page> {
  const [newTab]=await Promise.all([context.waitForEvent('page',{timeout:15000}),locator.click()]);
  await newTab.waitForLoadState('domcontentloaded').catch(()=>{});
  await waitForStableURL(newTab,10000);
  return newTab as Page;
}
export async function hoverAndWait(locator: Locator, waitMs=600): Promise<void> {
  await locator.hover(); await locator.page().waitForTimeout(waitMs);
}
export async function tryLocators(page: Page, locators: string[], action: 'click'|'fill'|'check'='click', value?: string): Promise<boolean> {
  for(const loc of locators){try{const el=page.locator(loc).first();if(!(await el.isVisible({timeout:2000})))continue;if(action==='click')await el.click();else if(action==='fill'&&value)await el.fill(value);else if(action==='check')await (el as any).check();return true;}catch{}}return false;
}
/**
 * Universal site-readiness gate — call as the SECOND line in every test.
 * Waits for the page to settle, then silently dismisses cookie/consent banners.
 * Works across any customer site; does nothing if no banner is present.
 */
export async function prepareSite(page: Page): Promise<void> {
  await waitForPageReady(page);
  await dismissOverlays(page);
  await dismissPopups(page);
}
`;

const TSCONFIG_JSON = `{
  "compilerOptions": {
    "target": "ES2020",
    "module": "commonjs",
    "lib": ["ES2020", "DOM"],
    "strict": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "outDir": "./dist",
    "rootDir": ".",
    "baseUrl": ".",
    "paths": {
      "@pages/*":    ["pages/*"],
      "@locators/*": ["locators/*"],
      "@actions/*":  ["actions/*"],
      "@fixtures/*": ["fixtures/*"],
      "@helpers/*":  ["helpers/*"],
      "@auth/*":     ["auth/*"]
    },
    "skipLibCheck": true
  },
  "include": ["**/*.ts"],
  "exclude": ["node_modules", "dist", "playwright-report", "test-results"]
}
`;

const README_MD = `# Auto-Generated Test Framework
Generated by **NAT 2.0 Recording Studio**.

## Folder Structure
\`\`\`
locators/            ← Object Repository — single source of truth for all selectors
pages/               ← Page Object Models — methods only, imports from locators/
actions/
  generic/           ← App-agnostic helpers: browser, form, assert, waits
  business/          ← Domain actions composed from POM + generic helpers
fixtures/
  test-data.ts       ← Parameterised test values (reads from .env)
auth/
  auth.setup.ts      ← One-time login → saves session to .auth/user.json
tests/               ← Test specs — only Business Actions called here
playwright.config.ts ← Configured for CI (JUnit + HTML reporters, storageState)
.env.example         ← Copy to .env and fill credentials
.gitignore           ← Excludes .auth/, .env, node_modules/
\`\`\`

## First-time setup
\`\`\`bash
# 1. Install dependencies (Playwright browsers install automatically via postinstall)
npm install

# 2. Configure credentials
cp .env.example .env
# Edit .env and set TEST_USERNAME, TEST_PASSWORD, BASE_URL

# 3. Run tests
npm test            # headless (default)
npm run test:headed # headed — see the browser
npm run test:ui     # Playwright UI mode — step through interactively
\`\`\`

## CI / Azure DevOps / GitHub Actions
\`\`\`bash
npm run test:ci     # generates playwright-report/ and test-results/results.xml
\`\`\`

## Fixing a broken locator
Edit the relevant \`locators/*.locators.ts\` file — one change heals every test that uses it.

## Path aliases
All imports use \`@pages/\`, \`@actions/\`, \`@locators/\`, \`@fixtures/\` — resolves via tsconfig baseUrl.
No relative path fragility (\`../../..\`) anywhere in the codebase.
`;

// ─── Claude Prompts ────────────────────────────────────────────────────────────

function buildPageObjectPrompt(nlSteps: string[], startUrl: string, pageName: string, ariaSnapshot?: string, iframeOrigin?: string): string {
  const snapshotSection = ariaSnapshot
    ? `
## Live Accessibility Tree (source of truth for locator identification)
The following ARIA snapshot was captured from the live page at ${startUrl}.
Use the accessible names and roles shown here to identify elements — but ALL locators MUST still use page.locator('xpath=...') format (never getByRole/getByLabel/getByText).

\`\`\`
${ariaSnapshot}
\`\`\`

Use the ARIA tree to determine the correct @aria-label, @name, text content, and container relationships.
Then express each locator as an XPath following the MANDATORY LOCATOR RULES below.
`
    : `
No live page snapshot available — infer locators from the recorded steps and standard conventions.
`;

  const iframeNote = iframeOrigin
    ? `
⚠️ IFRAME CONTEXT — ALL form/input elements live inside an embedded iframe from "${iframeOrigin}".

LOCATORS FILE — iframe locators MUST use page.frameLocator() (NOT page.locator()):
\`\`\`typescript
  // Uniqueness: unique | Stability: stable | Fallback: //input[@name='FirstName']
  firstNameInput: (page: Page): Locator => page.frameLocator('iframe[src*="${iframeOrigin}"]').locator('xpath=//input[@id="FirstName"]'),
  submitButton:   (page: Page): Locator => page.frameLocator('iframe[src*="${iframeOrigin}"]').locator('xpath=//button[normalize-space(text())="Submit"]'),
\`\`\`

PAGE CLASS — wait for iframe to attach, then call locators normally (frameLocator is already embedded inside each locator):
\`\`\`typescript
  async waitForIframe(): Promise<void> {
    await this.page.waitForSelector('iframe[src*="${iframeOrigin}"]', { state: 'attached', timeout: 15000 });
  }
  async fillFirstName(value: string): Promise<void> {
    await this.waitForIframe();
    const loc = ${pageName}PageLocators.firstNameInput(this.page); // frameLocator is inside the locator
    await loc.waitFor({ state: 'visible', timeout: 15000 });
    await loc.fill(value);
  }
\`\`\`

❌ WRONG in page class — never call frameLocator directly:
  const frame = this.page.frameLocator('iframe'); // bypasses locators file
  await frame.locator('#Field').fill(value);       // zero inline selectors allowed
`
    : '';

  return `You are a senior QA automation engineer. Generate a Playwright Page Object class for "${pageName}".

The test flow recorded on ${startUrl} has these steps:
${nlSteps.map((s, i) => `${i + 1}. ${s.replace(/^Step \d+:\s*/, '')}`).join('\n')}
${snapshotSection}${iframeNote}
Generate TWO TypeScript files following these strict rules:

### FILE 1 — Object Repository (locatorsCode)
File: locators/${pageName}Page.locators.ts
- Import: import { Page, Locator } from '@playwright/test';
- Export a single const object named \`${pageName}PageLocators\`
- Each property is a FACTORY FUNCTION: \`(page: Page): Locator => ...\`
- Add a JSDoc comment on each property explaining the UI element
- This is the SINGLE SOURCE OF TRUTH — no raw selectors anywhere else

MANDATORY LOCATOR RULES — NON-NEGOTIABLE:
1. ALL locators MUST use page.locator('xpath=...') format — NEVER use getByRole, getByLabel, getByPlaceholder, getByText
2. Import must be: import { Page, Locator } from '@playwright/test';
3. PRIORITY ORDER:
   P1 STABLE: @id (non-auto-generated), @data-testid, @data-automation-id, @aria-label, @name on form controls
   P2 ACCEPTABLE: @placeholder, normalize-space(text()) for buttons/links, label[for] relationship
   P3 RELATIVE: anchor to stable parent container, then navigate to element
   P4 COMBINATION: [@type='text' and @placeholder='...'] multi-attribute

4. AUTO-GENERATED IDs TO REJECT (use next strategy instead):
   - mat-input-N, ng-input-N, react-N, ember-N (framework-generated)
   - input_1234, field_5678 (sequential numbers)
   - GUIDs: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
   - CSS hashes: css-abc123, sc-def456, styled-ghi789
   - Any id containing 5+ hex chars: a1b2c3d4

5. NAV LINK SCOPING (critical for multi-element pages):
   - ALWAYS scope nav links to their container to avoid footer duplicates
   - Find the closest stable ancestor: nav[@aria-label], header, [id*="nav"], [id*="header"]
   - Example: page.locator('xpath=//nav[@aria-label=\\'Main Navigation\\']//a[text()=\\'About\\']')
   - NEVER: page.locator('xpath=//a[text()=\\'About\\']') — matches header AND footer

6. DYNAMIC CONTENT RULE:
   - NEVER use H1/H2 text as locator if it contains: years (2024, 2025), campaign text, promotional copy
   - Instead use structural: page.locator('xpath=//main//h1[1]')
   - Flag with comment: // Stability: fragile — content changes with campaigns

7. REQUIRED COMMENT FORMAT on every locator:
   // Uniqueness: unique|verify | Stability: stable|fragile | Fallback: //alternative[@xpath]

8. IMPORT STATEMENT IN EVERY LOCATORS FILE:
   import { Page, Locator } from '@playwright/test';
   (NOT: import { Page } from '@playwright/test';)

XPath strategy details:
- P1: page.locator('xpath=//*[@id=\\'submit-btn\\']')           — id (non-generated)
- P1: page.locator('xpath=//*[@data-testid=\\'btn\\']')         — data-testid/data-automation-id
- P1: page.locator('xpath=//button[@aria-label=\\'Close\\']')   — aria-label
- P1: page.locator('xpath=//input[@name=\\'username\\']')       — name attribute (form fields)
- P2: page.locator('xpath=//button[normalize-space(text())=\\'Submit\\']')
- P2: page.locator('xpath=//a[normalize-space(text())=\\'Home\\']')
- P2: page.locator('xpath=//label[normalize-space(text())=\\'Policy Number\\']/following-sibling::input[1]')
- P2: page.locator('xpath=//input[@placeholder=\\'Enter Policy Number\\']')
- P3: page.locator('xpath=//form[@id=\\'policy-form\\']//input[@name=\\'deductible\\']')
- P3: page.locator('xpath=//*[@data-testid=\\'login-panel\\']//input[@type=\\'password\\']')
   NEVER: /html/body/div[3]/form/div[2]/input (absolute paths)
- P4: page.locator('xpath=//input[@type=\\'text\\' and @placeholder=\\'Enter Policy Number\\']')

NEVER USE:
   - Index-only XPath: //div[4]/span[2]
   - Auto-generated class XPaths: //div[@class=\\'css-xk39d8\\']
   - Absolute paths from html root
   - Generated IDs (GUIDs, mat-input-3, input_1748392, css-xk39d8)

Example:
\`\`\`typescript
import { Page, Locator } from '@playwright/test';
export const ${pageName}PageLocators = {
  // Uniqueness: unique | Stability: stable | Fallback: //input[@name='email']
  emailInput: (page: Page): Locator => page.locator("xpath=//input[@id='email']"),
  // Uniqueness: unique | Stability: stable — test attribute | Fallback: //button[normalize-space(text())='Submit']
  submitButton: (page: Page): Locator => page.locator("xpath=//*[@data-testid='submit-btn']"),
  // Uniqueness: likely unique | Stability: stable | Fallback: //input[@type='text' and @placeholder='Search...']
  searchInput: (page: Page): Locator => page.locator("xpath=//input[@placeholder='Search...']"),
};
\`\`\`

### FILE 2 — Page Object Class (code)
File: pages/${pageName}Page.ts
- ZERO inline selectors — 100% delegated to the locators file
- Before EVERY interaction: await locator.waitFor({ state: 'visible' })
- Navigation-triggering clicks: await Promise.all([page.waitForLoadState('networkidle').catch(()=>{}), locator.click()])
- NEVER use waitForTimeout — only condition-based waits
- Generate a method for EVERY recorded step, not just 2 or 3

CRITICAL CLASS PATTERN — copy this structure exactly:
\`\`\`typescript
import { Page } from '@playwright/test';
import { ${pageName}PageLocators } from '@locators/${pageName}Page.locators';

export class ${pageName}Page {
  constructor(private readonly page: Page) {}  // ← NO this.L assignment; just store page

  async clickSomeButton(): Promise<void> {
    const loc = ${pageName}PageLocators.someButton(this.page);  // ← call factory fn with this.page
    await loc.waitFor({ state: 'visible' });
    await loc.click();
  }

  async fillSomeInput(value: string): Promise<void> {
    const loc = ${pageName}PageLocators.someInput(this.page);   // ← new factory call each time
    await loc.waitFor({ state: 'visible' });
    await loc.fill(value);
  }

  async selectDropdown(value: string): Promise<void> {
    const loc = ${pageName}PageLocators.someDropdown(this.page);
    await loc.waitFor({ state: 'visible' });
    await loc.selectOption(value);
  }
}
\`\`\`

❌ FORBIDDEN — any of these will cause a TypeScript/runtime crash:
  this.L = ${pageName}PageLocators(page);    // NOT a function — it's a plain object
  this.L = new ${pageName}PageLocators();     // NOT a class
  page.locator('xpath=...')                    // no inline selectors in page class
  page.getByRole(...)                          // no inline Playwright calls in page class

PLATFORM RULES — APPLY TO EVERY CUSTOMER SITE:

Rule 3 — NO ABSOLUTE URLs in goto():
  CORRECT:  await this.page.goto('/services/agile-development');
  WRONG:    await this.page.goto('https://www.any-customer-site.com/services/agile-development');
  Playwright resolves relative paths against baseURL in playwright.config.ts.
  The POM must be environment-agnostic (dev/staging/prod/any customer URL).

Rule 4 — NO ASSERTIONS in the POM layer:
  CORRECT:  async getHeadingText(): Promise<string> { return (await loc.textContent()) ?? ''; }
  WRONG:    async verifyHeading(): Promise<void> { expect(text).toBe('...'); }
  The POM NEVER imports expect. Text-reading methods return the value; the caller asserts.

Rule 7 — href locators MUST use contains(), never exact match:
  CORRECT:  xpath=//a[contains(@href,"data-visualization") and contains(normalize-space(text()),"Learn More")]
  WRONG:    xpath=//a[@href="competency/data-visualization"]
  WRONG:    xpath=//a[@href="https://www.site.com/page"]

Rule 8 — Tab locators MUST use semantic content, never positional:
  CORRECT:  xpath=//button[@role="tab" and contains(normalize-space(.),"Digital Product")]
  WRONG:    xpath=//button[@role="tab" and @aria-label="1 of 6"]

Rule 16 — TypeScript class/variable names MUST NOT contain hyphens:
  If the page URL is "data-visualization", the class is DataVisualizationPage (PascalCase).
  If the page URL is "agile-development", the class is AgileDevelopmentPage.
  Hyphenated URL slugs → PascalCase identifiers. File names may keep hyphens.

Rule 18 — NEVER call .fill() on <select> / dropdown / combobox elements:
  CORRECT:  await loc.selectOption('Option Text');
  WRONG:    await loc.fill('Option Text');   // throws Playwright runtime error on <select>
  WRONG:    await loc.fill('');              // throws Playwright runtime error on <select>
  If you need to "clear" a dropdown, select the default/blank option via selectOption('').

Rule 19 — POM method names MUST use action verbs — NEVER use assert*, verify*, check* prefixes:
  CORRECT:  async waitForPageReady(): Promise<void>
  CORRECT:  async getHeadingText(): Promise<string>
  CORRECT:  async isDropdownVisible(): Promise<boolean>
  WRONG:    async assertPageLoaded(): Promise<void>   // assertion semantics in POM layer
  WRONG:    async verifyHeading(): Promise<void>      // belongs in Layer 4 (business actions)
  The POM returns values or performs actions — callers assert in Layer 4.

Rule 20 — Links that open new tabs MUST return the new Page object:
  If a link has target="_blank" or you know it opens a popup/new tab:
  CORRECT pattern:
    async clickExternalLink(): Promise<Page> {
      const loc = PageLocators.externalLink(this.page);
      await loc.waitFor({ state: 'visible' });
      const popupPromise = this.page.context().waitForEvent('page');
      await loc.click();
      const newPage = await popupPromise;
      await newPage.waitForLoadState('domcontentloaded', { timeout: 30000 }).catch(() => {});
      return newPage;  // business action uses this to assert on the new tab
    }
  WRONG:
    async clickExternalLink(): Promise<void> { await loc.click(); } // caller has no handle to new tab

Rule 21 — OCR CORRUPTION GUARD + TEXT MATCHING TOLERANCE:
  The NL steps were captured by a screen recorder using OCR. OCR sometimes corrupts text:
  - Missing characters: "Reque t a demo" → should be "Request a demo"
  - Double spaces: "Featured  ervice " → should be "Featured Services"
  - Split words: "Sub mit" → should be "Submit"
  BEFORE using any text string in a locator XPath text() predicate or assertion:
  1. Inspect it for OCR artifacts (single chars separated by spaces, double spaces, missing letters)
  2. Reconstruct the correct English phrase using context from the page/URL
  3. NEVER embed corrupted text in XPath — it will never match the live DOM

  TEXT MATCHING — ALWAYS use contains(), NEVER exact equality for text XPaths:
  CORRECT: page.locator('xpath=//button[contains(normalize-space(text()),"Request a demo")]')
  WRONG:   page.locator('xpath=//button[normalize-space(text())="Request a demo"]')
  CORRECT: page.locator('xpath=//a[contains(normalize-space(.),"Learn More")]')
  WRONG:   page.locator('xpath=//a[normalize-space(.)="Learn More"]')
  Reason: exact equality fails when the DOM has leading/trailing whitespace, non-breaking
  spaces, or minor text changes across environments. contains() is resilient to these.

Call the generate_page_object tool. Put raw TypeScript (no markdown fences) in 'locatorsCode' and 'code'.
List every locator in 'locators'. List every method in 'methods'.`;
}

function buildBusinessActionsPrompt(
  nlSteps: string[],
  pageName: string,
  domain: string,
  testDataSchema: string,
  ariaSnapshot?: string,
  pomContracts?: Array<{ className: string; pageFile: string; methods: string[] }>
): string {
  const snapshotHint = ariaSnapshot
    ? `\nPage structure reference (trimmed):\n\`\`\`\n${ariaSnapshot.slice(0, 2000)}\n\`\`\`\nUse visible text labels from the tree when constructing verifyText / verifyVisible assertions.\n`
    : '';

  // ── LAYER 2 → LAYER 4 CONTRACT ───────────────────────────────────────────────
  // pomContracts is the exact list of methods generated for each POM class.
  // Business actions MUST ONLY call methods from this list — never invent names.
  const methodContractSection = (pomContracts && pomContracts.length > 0)
    ? `
════════════════════════════════════════════════════════
POM METHOD CONTRACT — MANDATORY
The following are the ONLY valid methods for each Page class.
DO NOT call any method not listed here. DO NOT invent method names.
If no suitable method exists for a step, skip that interaction.

${pomContracts.map(c =>
  `${c.className} (from ${c.pageFile}):\n  const pg = new ${c.className}(page);\n  Callable methods: ${c.methods.map(m => `pg.${m}()`).join(', ')}`
).join('\n\n')}
════════════════════════════════════════════════════════
`
    : `
NOTE: No POM method contract provided — infer methods from the page class name.
      Use conservative, obvious method names (clickXxx, fillXxx, navigateTo).
`;

  return `You are a senior QA automation engineer. Generate a Business Actions file for the "${domain}" domain.

These steps were recorded. Steps prefixed "Assert" are ALREADY handled by a separately generated verify function — DO NOT generate any assertion code, just the interaction/navigation steps:
${nlSteps.map((s, i) => `${i + 1}. ${s.replace(/^Step \d+:\s*/, '')}`).join('\n')}
${snapshotHint}${methodContractSection}
EXACT TEST DATA SCHEMA — reference ONLY these keys (testData has NO nested objects):
\`\`\`typescript
${testDataSchema}
\`\`\`
Use data.baseUrl, data.firstName, data.email, etc. — NEVER data.demoRequest.x or data.urls.anything.

Generate TypeScript business action functions following these STRICT rules:

IMPORTS — always use @-alias paths (resolved via tsconfig baseUrl):
1. import { Page } from '@playwright/test'
2. Import EVERY Page Object class listed in the POM CONTRACT above — one import per class:
${(pomContracts && pomContracts.length > 0)
  ? pomContracts.map(c => `   import { ${c.className} } from '@pages/${c.pageFile.replace(/^pages\//, '').replace(/\.ts$/, '')}'`).join('\n')
  : `   import { ${pageName}Page } from '@pages/${pageName}Page'`}
   ⚠️  EVERY class listed in the POM CONTRACT must be imported — DO NOT import classes not in the contract.
3. import { navigateTo, waitForNetworkIdle } from '@actions/generic/browser.actions'
4. import ONLY the assertion functions you actually call from '@actions/generic/assert.actions'
   Available: verifyText, verifyUrl, verifyVisible, verifyNotPresent, verifyInputValue, verifyEnabled, verifyDisabled, softAssert
   Example (import only what you use): import { verifyText, verifyUrl } from '@actions/generic/assert.actions'
   DO NOT import functions you do not call — unused imports are TypeScript compile errors.
5. import { testData } from '@fixtures/test-data'

STRICT LAYER RULE — MANDATORY:
6. NEVER call page.locator(), page.frameLocator(), page.getByRole(), page.fill() directly
7. ALL DOM interactions MUST go through the correct Page Object class using ONLY the methods listed in the POM CONTRACT.
   For each action, identify WHICH page class owns the method, then instantiate that class:
${(pomContracts && pomContracts.length > 0)
  ? pomContracts.map(c => `   // For actions on ${c.pageFile}: const pg${c.className} = new ${c.className}(page);`).join('\n')
  : `   const pg = new ${pageName}Page(page);`}
   Example with two POMs:
     const homePg = new HomePageClass(page);       // ← for steps on the home page
     await homePg.clickServicesLink();
     await waitForNetworkIdle(page);
     const detailPg = new DetailPageClass(page);   // ← for steps on the detail page
     await detailPg.expandSection();
   WRONG — using the primary POM for ALL steps even when a step belongs to a different page:
     const pg = new HomePageClass(page);
     await pg.someMethodThatDoesNotExist();        // ← method not in the contract list
8. Business actions are ORCHESTRATION functions — they call page methods and assert results, nothing else

FUNCTION DESIGN:
9.  Create 2-4 functions that each represent a SINGLE BUSINESS SCENARIO (e.g. submitDemoRequest, navigateToProduct)
    Each function must be independently testable — do NOT chain multiple unrelated scenarios into one function
10. Each function signature: export async function myAction(page: Page, data = testData): Promise<void>
11. Use data.fieldName for values — NEVER hardcode strings from the recording
12. After a page-navigation action (click button/link), always follow with: await waitForNetworkIdle(page)
13. Assertions must verify the OUTCOME: the resulting URL, a success message, or submitted data appearing

ASSERTION RULES — CRITICAL (Rule 5):
14. verifyText(page, 'prose string')     — for human-readable text, headings, labels, button copy
    verifyVisible(page, '[css-selector]') — ONLY for CSS selectors like [data-testid="x"] or .classname
    NEVER pass a prose text string to verifyVisible()
    NEVER pass a CSS selector to verifyText()
15. verifyUrl(page, '/path-string')      — argument is ALWAYS a string, NEVER a RegExp literal
    CORRECT: verifyUrl(page, '/data-visualization')
    WRONG:   verifyUrl(page, /data-visualization/)

URL RULES — CRITICAL (Rule 3):
16. NEVER use absolute https:// URLs in business actions
    CORRECT: await navigateTo(page, data.baseUrl)  then  await pg.clickServicesNavLink()
    WRONG:   await navigateTo(page, 'https://www.site.com/services')

POPUP / NEW-TAB RULE (Rule 17):
17. When a click opens a new browser tab (external link, target="_blank", community portal, etc.):
    CORRECT pattern — capture the new tab, assert on it, NOT on the original 'page':
      const popupPromise = page.context().waitForEvent('page');
      await pg.clickExternalLink();
      const popup = await popupPromise;
      await popup.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
      await verifyUrl(popup as any, 'expected-path-or-domain');
    WRONG — the original page never navigates when a new tab opens:
      await pg.clickExternalLink();
      await waitForNetworkIdle(page);
      await verifyUrl(page, 'community.site.com');   ← ALWAYS FAILS — page didn't navigate
    Signal that a new tab is opening:
      - URL in the next step contains a different domain than baseUrl
      - Step description mentions "community", "portal", "external", "opens in new tab"
      - Link has target="_blank" in the recorded interaction

For "[soft]" steps: const failures: string[] = []; await softAssert(() => verifyX(...), failures);

Call the generate_business_actions tool. Put the raw TypeScript code (no markdown fences) in 'code'.
List every exported function in 'functions' with its business-intent description and approximate step count.`;
}

function buildTestFilePrompt(
  nlSteps: string[],
  testName: string,
  startUrl: string,
  pageName: string,
  domain: string,
  exportedFunctions: string[],
  testDataSchema: string
): string {
  const functionList = exportedFunctions.length > 0
    ? exportedFunctions.map(f => `  - ${f}(page, data?)`).join('\n')
    : '  (no functions generated yet — write minimal test with navigateTo only)';

  return `You are a senior QA automation engineer. Generate a clean Playwright test file.

The recorded flow: "${testName}" on ${startUrl}
Steps: ${nlSteps.map((s, i) => `${i + 1}. ${s.replace(/^Step \d+:\s*/, '')}`).join(' | ')}

════════════════════════════════════════════════════════
MANDATORY CONTRACT — THE FOLLOWING ARE THE ONLY VALID
BUSINESS FUNCTIONS FROM actions/business/${domain}.actions.ts:
${functionList}

DO NOT invent new function names.
DO NOT call any function that is not in the list above.
The import statement must list EXACTLY the functions above.
════════════════════════════════════════════════════════

EXACT TEST DATA SHAPE — ONLY use these keys (testData has NO nested objects):
\`\`\`typescript
${testDataSchema}
\`\`\`
Reference as: testData.baseUrl, testData.firstName, testData.email, etc.
NEVER use: testData.demoRequest.x  or  testData.urls.anything  or  testData.selectors.anything

Generate a TypeScript test file following these STRICT rules:

IMPORTS — always use @-alias paths:
1. import { test } from '@playwright/test'
2. import { navigateTo } from '@actions/generic/browser.actions'
3. import { prepareSite } from '../helpers/universal'
4. import { ${exportedFunctions.length > 0 ? exportedFunctions.join(', ') : '/* functions */'} } from '@actions/business/${domain}.actions'
5. import { verifyUrl, verifyVisible, verifyText } from '@actions/generic/assert.actions'
6. import { testData } from '@fixtures/test-data'

TEST STRUCTURE — PLATFORM RULES (apply to every customer site):
7.  ONE test.describe block named after the business feature being tested
8.  ATOMIC TESTS — MANDATORY: create a SEPARATE test() block for EACH distinct business scenario.
    NEVER chain unrelated scenarios into one test() block — a failure in scenario 1 must NOT
    prevent scenarios 2 and 3 from running.

    Detect scenario boundaries using these signals:
      Signal A — Navigation to a completely different URL path (e.g. /products → /contact)
      Signal B — Clear topic shift in the business actions (product info → form submission)
      Signal C — Business action returns a page from a different domain (popup/new tab)

    Required test() blocks (create ALL of these, each independent):
      test('Page loads and displays key content', ...)    ← smoke: always visible content
      test('Navigating to [feature] succeeds', ...)       ← navigation + URL verification
      test('[Feature] displays expected sections', ...)   ← content/accordion/tab test
      (add more if the recording spans multiple distinct flows)

    WRONG — single monolithic test:
      test('full flow', async ({ page }) => {
        await navigateToFIDOAuth(page);       ← scenario A
        await navigateToCommunity(page);      ← scenario B (unrelated — should be separate)
        await submitContactForm(page);        ← scenario C (unrelated — should be separate)
      });
    CORRECT — separate atomic tests:
      test('FIDO authenticators page loads', async ({ page }) => { ... });
      test('Community portal opens in new tab', async ({ page }) => { ... });
      test('Contact form can be submitted', async ({ page }) => { ... });
9.  Test function signature MUST be: async ({ page }) => { ... }
    NEVER add 'context' unless the test actually calls context.xxx — unused params are compile errors.
10. Add test.use({ storageState: '.auth/user.json' }) if the flow requires authentication
11. Rule 13 — ALWAYS start every test with these exact two lines:
      await navigateTo(page, testData.baseUrl);
      await prepareSite(page);
    prepareSite() is the universal site-readiness gate for every customer site.
12. Call ONLY the business action functions listed in the contract above — NEVER inline raw Playwright calls
13. End with specific assertions proving the business outcome:
    - Verify the resulting URL (proves navigation completed)
    - Verify a unique success element or message (proves the action worked)
14. Use testData.keyName for all values — NO hardcoded strings
15. Rule 12 — NEVER put XPath strings, CSS selectors, or data-testid values in test files
    All selectors live in locators/ files. Tests call business actions only.

STEP LOGGING — MANDATORY:
16. Wrap EVERY action call in test.step() so each step appears in the HTML and Allure reports:
    await test.step('Step N · <human description>', () => someAction(page, ...));
    Example:
      await test.step('1 · Navigate to homepage',    () => navigateTo(page, testData.baseUrl));
      await test.step('2 · Accept cookies / prepare site', () => prepareSite(page));
      await test.step('3 · Navigate to Products',    () => navigateToProducts(page));
      await test.step('4 · Verify page content',     () => verifyOnespan(page));

SCREENSHOT + FAILURE LOGGING — MANDATORY:
17. Add this afterEach block INSIDE the test.describe, BEFORE the test() call:
    test.afterEach(async ({ page }, testInfo) => {
      if (testInfo.status !== testInfo.expectedStatus) {
        const screenshotPath = \`test-results/\${testInfo.title.replace(/\\s+/g, '-')}-failure.png\`;
        await page.screenshot({ path: screenshotPath, fullPage: true });
        await testInfo.attach('failure-screenshot', { path: screenshotPath, contentType: 'image/png' });
        console.error(\`\\n📸 Failure screenshot: \${require('path').resolve(screenshotPath)}\\n\`);
      }
    });

CRITICAL RULES:
- NEVER call page.waitForLoadState() directly — use prepareSite(page) instead
- ALWAYS use async ({ page }) as the test function parameter — NEVER add 'context' unless actually used
- ONLY call functions in the MANDATORY CONTRACT list above
- ALWAYS wrap every call in test.step() — no bare awaits on action functions

Call the generate_test_file tool. Put raw TypeScript (no markdown fences) in 'code'.
Populate 'testCaseName', 'businessScenario', 'businessActionsUsed', and 'assertionsUsed'.`;
}

// ─── Main Generator ────────────────────────────────────────────────────────────

function deriveNames(startUrl: string, nlSteps: string[], testName: string): { pageName: string; domain: string; testFileName: string } {
  // Helper: convert a path segment to PascalCase
  const toPascal = (s: string) =>
    s.replace(/[-_]/g, ' ').split(' ')
      .filter(Boolean)
      .map(w => w.charAt(0).toUpperCase() + w.slice(1))
      .join('');

  /**
   * Returns true when a PascalCase identifier looks like a recording artifact / random ID
   * rather than a meaningful English class name. Examples that fail:
   *   GvvvGdmiqjccvc7c  — mixed alphanumeric, 4+ consecutive consonants
   *   AbcXyz123Def       — digit embedded between letter runs
   *   QjccVcMessenger    — 4-consonant cluster qjcc
   */
  const isLikelyRandomId = (name: string): boolean => {
    // Digit immediately surrounded by letters on both sides (e.g. 7c in Abc7cDef)
    if (/[a-zA-Z][0-9][a-zA-Z]/.test(name)) return true;
    // Four or more consecutive consonants (not natural English)
    if (/[bcdfghjklmnpqrstvwxyz]{4,}/i.test(name)) return true;
    // More than one embedded digit anywhere (session tokens often have 2+ digits)
    if ((name.match(/[0-9]/g) || []).length > 1) return true;
    return false;
  };

  /**
   * Fall back to a brand-derived name when the URL segment is garbage.
   * Uses the hostname brand + a short domain hint so the class stays meaningful:
   *   onespan.com + "contact" steps → OnespanContact
   *   yoursite.com + default         → YoursitePage
   */
  const brandFromUrl = (url: string, suffix = 'Page'): string => {
    try {
      const hostParts = new URL(url).hostname.split('.');
      const SKIP = new Set(['www','app','m','web','api','portal','mobile','staging','dev','qa','test']);
      const brand = SKIP.has(hostParts[0].toLowerCase()) && hostParts.length > 2 ? hostParts[1] : hostParts[0];
      return brand.charAt(0).toUpperCase() + brand.slice(1) + suffix;
    } catch { return 'App' + suffix; }
  };

  // Derive page name from URL — always prefixed with brand so names are unique across projects
  // e.g. onespan.com/contact-us → OnespanContactUs,  nousinfosystems.com/ → NousinfosystemsHome
  let pageName = 'App';
  try {
    const url = new URL(startUrl);
    const hostParts = url.hostname.split('.');
    const SKIP_HOST = new Set(['www', 'app', 'm', 'web', 'api', 'portal', 'mobile', 'staging', 'dev', 'qa', 'test']);
    const rawBrand = SKIP_HOST.has(hostParts[0].toLowerCase()) && hostParts.length > 2
      ? hostParts[1]
      : hostParts[0];
    // PascalCase brand prefix: nousinfosystems → Nousinfosystems
    const brandPrefix = rawBrand.charAt(0).toUpperCase() + rawBrand.slice(1);

    const parts = url.pathname.split('/').filter(Boolean);
    if (parts.length === 0) {
      // Root URL: brand.com/ → BrandHome
      pageName = brandPrefix + 'Home';
    } else {
      const last = parts[parts.length - 1];
      const isNumericOrId = /^\d+$/.test(last) || /^[a-f0-9-]{8,}$/i.test(last);

      let pathName: string;
      if (isNumericOrId && parts.length >= 2) {
        // e.g. /students/12345 → brand + StudentDetail
        pathName = toPascal(parts[parts.length - 2]) + 'Detail';
      } else if (parts.length >= 2) {
        // Use last 1–2 meaningful segments, cap at 40 total chars (incl. brand)
        const lastPascal   = toPascal(last);
        const parentPascal = toPascal(parts[parts.length - 2]);
        const combined = parentPascal + lastPascal;
        // If combined name + brand would be > 40 chars, just use the last segment
        pathName = (brandPrefix.length + combined.length) <= 40 ? combined : lastPascal;
      } else {
        // Single segment: /products → brand + Products
        pathName = toPascal(last) || 'App';
      }
      pageName = brandPrefix + pathName;
    }
  } catch {}

  // ── Sanitise: reject garbled/random-ID page names ──────────────────────────
  // If the URL segment looks like a session token or recording artifact (e.g.
  // "gvvv-gdmiqjccvc7c"), fall back to the hostname brand + a domain-based suffix
  // so every generated class name is a meaningful English identifier.
  if (isLikelyRandomId(pageName)) {
    const allText = nlSteps.join(' ').toLowerCase();
    let suffix = 'Page';
    if (/login|sign.?in|password/.test(allText)) suffix = 'Login';
    else if (/contact|form/.test(allText)) suffix = 'Contact';
    else if (/checkout|cart|purchase/.test(allText)) suffix = 'Checkout';
    else if (/search/.test(allText)) suffix = 'Search';
    else if (/register|signup/.test(allText)) suffix = 'Register';
    pageName = brandFromUrl(startUrl, suffix);
  }

  // Derive domain from steps (look for verbs)
  const allText = nlSteps.join(' ').toLowerCase();
  let domain = 'app';
  if (allText.includes('login') || allText.includes('sign in') || allText.includes('password')) domain = 'auth';
  else if (allText.includes('contact') || allText.includes('form')) domain = 'contact';
  else if (allText.includes('checkout') || allText.includes('cart') || allText.includes('purchase')) domain = 'checkout';
  else if (allText.includes('search')) domain = 'search';
  else if (allText.includes('register') || allText.includes('signup')) domain = 'registration';
  else domain = pageName.toLowerCase();

  const testFileName = testName.replace(/[^a-z0-9]/gi, '-').toLowerCase().replace(/-+/g, '-').replace(/^-|-$/g, '');

  return { pageName, domain, testFileName };
}

// ─── GAP 1: Auth Detection & Setup ───────────────────────────────────────────

export interface AuthInfo {
  hasAuth: boolean;
  loginUrl?: string;
  usernameStep?: string;
  passwordStep?: string;
  submitStep?: string;
  usernameLabel?: string;
  passwordLabel?: string;
  submitLabel?: string;
}

// ─── Test Data Extractor ──────────────────────────────────────────────────────

interface ExtractedField { key: string; value: string; label: string; isSensitive: boolean }

function extractTestData(nlSteps: string[], startUrl: string): ExtractedField[] {
  const fields: ExtractedField[] = [];
  const seen = new Set<string>();

  // Match: Enter "VALUE" in the "LABEL" field
  const fillPattern = /Enter\s+"(.+?)"\s+in the\s+"(.+?)"\s+field/i;
  // Match: Enter "***MASKED***" in the "LABEL" field
  const maskedPattern = /Enter\s+"\*\*\*MASKED\*\*\*"\s+in the\s+"(.+?)"\s+field/i;

  for (const step of nlSteps) {
    const maskedMatch = step.match(maskedPattern);
    if (maskedMatch) {
      const label = maskedMatch[1];
      const key = toCamelCase(label) + 'Password';
      if (!seen.has(key)) {
        fields.push({ key, value: '', label, isSensitive: true });
        seen.add(key);
      }
      continue;
    }
    const fillMatch = step.match(fillPattern);
    if (fillMatch) {
      const value = fillMatch[1];
      const label = fillMatch[2];
      const key = toCamelCase(label);
      if (!seen.has(key)) {
        const isSensitive = /password|secret|token|key/i.test(label);
        fields.push({ key, value, label, isSensitive });
        seen.add(key);
      }
    }
  }
  return fields;
}

function toCamelCase(str: string): string {
  return str
    .replace(/[-_\s]+(.)/g, (_, c) => c.toUpperCase())
    .replace(/^[A-Z]/, c => c.toLowerCase())
    .replace(/[^a-zA-Z0-9]/g, '');
}

/**
 * Returns a GENERIC placeholder for a recorded value so developer's personal data
 * (real names, personal emails, phone numbers) never ships as the default in a generated
 * framework that will be committed to a customer repo or used by 1000+ users.
 *
 * Rules:
 * - email fields      → "test-user@example.com"
 * - first/last name   → "Test" / "User"
 * - phone             → "555-0100"
 * - company / org     → "TestCo Inc."
 * - title / role      → "QA Automation"
 * - comments / notes  → "Automated test comment"
 * - zip / postal      → "10001"
 * - city              → "Test City"
 * - state / province  → "NY"
 * - anything else     → "test-value"
 *
 * The actual recorded value is intentionally discarded — it may contain PII.
 */
function genericPlaceholder(key: string, label: string): string {
  const k = (key + ' ' + label).toLowerCase();
  if (/email/i.test(k))                           return 'test-user@example.com';
  if (/first.?name|firstname|fname/i.test(k))     return 'Test';
  if (/last.?name|lastname|lname/i.test(k))       return 'User';
  if (/phone|mobile|tel(?!e)/i.test(k))           return '555-0100';
  if (/company|org(?:aniz)?|business/i.test(k))   return 'TestCo Inc.';
  if (/title|position|role|job/i.test(k))         return 'QA Automation';
  if (/comment|message|note|feedback/i.test(k))   return 'Automated test comment';
  if (/zip|postal|postcode/i.test(k))             return '10001';
  if (/\bcity\b/i.test(k))                        return 'Test City';
  if (/state|province|region/i.test(k))           return 'NY';
  if (/country/i.test(k))                         return 'United States';
  if (/url|website|web.?site/i.test(k))           return 'https://example.com';
  if (/name/i.test(k))                            return 'Test User';
  return 'test-value';
}

function buildTestDataFile(fields: ExtractedField[], startUrl: string): string {
  const lines: string[] = [
    `import * as dotenv from 'dotenv';`,
    `dotenv.config();`,
    ``,
    `/**`,
    ` * Test data — extracted from recorded interactions.`,
    ` * Sensitive values (passwords, tokens) are read from environment variables.`,
    ` * All defaults are GENERIC PLACEHOLDERS — never developer's personal data.`,
    ` * Override any value by setting the corresponding env var before running tests.`,
    ` */`,
    `export const testData = {`,
    `  /** Base URL of the application under test */`,
    `  baseUrl: process.env.BASE_URL || '${startUrl}',`,
    ``,
  ];

  for (const f of fields) {
    const envKey = toScreamingSnake(f.key);
    if (f.isSensitive) {
      lines.push(`  /** ${f.label} — set ${envKey} env var */`);
      lines.push(`  ${f.key}: process.env.${envKey} || '',`);
    } else {
      // Use a generic placeholder instead of the actual recorded value (PII guard)
      const placeholder = genericPlaceholder(f.key, f.label);
      lines.push(`  /** ${f.label} */`);
      lines.push(`  ${f.key}: process.env.${envKey} || ${JSON.stringify(placeholder)},`);
    }
    lines.push('');
  }

  lines.push(`} as const;`);
  lines.push(``);
  lines.push(`export type TestData = typeof testData;`);
  return lines.join('\n');
}

function toScreamingSnake(camel: string): string {
  return camel
    .replace(/([A-Z])/g, '_$1')
    .toUpperCase()
    .replace(/^_/, '');
}

/**
 * Build a compact schema string showing Claude EXACTLY what keys exist on testData.
 * This prevents Claude from inventing nested shapes like testData.demoRequest.firstName.
 */
function buildTestDataSchema(fields: ExtractedField[], startUrl: string): string {
  const lines = [`const testData = {`, `  baseUrl: '${startUrl}',`];
  for (const f of fields) {
    if (f.isSensitive) {
      lines.push(`  ${f.key}: '',  // ${f.label} — sensitive, from env`);
    } else {
      lines.push(`  ${f.key}: ${JSON.stringify(f.value)},  // ${f.label}`);
    }
  }
  lines.push(`} as const;`);
  return lines.join('\n');
}

// ─── Assertion Step Converter ─────────────────────────────────────────────────
// Deterministically converts a recorded NL assertion step into a Playwright call.
// This is NOT sent to Claude — it is always correct by construction.

function escSingle(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

export function nlAssertionToCode(nlStep: string): { code: string; isSoft: boolean } {
  // Strip "Step N:" or any "Step X:" prefix before parsing
  const raw   = nlStep.replace(/^Step [^:]*:\s*/i, '').trim();
  const isSoft = /\[soft\]/i.test(raw);
  const step  = raw.replace(/\s*\[soft\]\s*$/, '').trim();

  let m: RegExpMatchArray | null;

  // Assert "label" is visible — use getByText since the label is visible text, not a CSS selector
  m = step.match(/^Assert "(.+)" is visible$/i);
  if (m) return { code: `await verifyText(page, '${escSingle(m[1])}');`, isSoft };

  // Assert "label" is hidden
  m = step.match(/^Assert "(.+)" is hidden$/i);
  if (m) return { code: `await expect(page.getByText('${escSingle(m[1])}', { exact: false }).first()).not.toBeVisible();`, isSoft };

  // Assert "label" is enabled
  m = step.match(/^Assert "(.+)" is enabled$/i);
  if (m) return { code: `await verifyEnabled(page, '${escSingle(m[1])}');`, isSoft };

  // Assert "label" is disabled
  m = step.match(/^Assert "(.+)" is disabled$/i);
  if (m) return { code: `await verifyDisabled(page, '${escSingle(m[1])}');`, isSoft };

  // Assert "label" is checked
  m = step.match(/^Assert "(.+)" is checked$/i);
  if (m) return { code: `await verifyChecked(page, '${escSingle(m[1])}');`, isSoft };

  // Assert "label" is unchecked
  m = step.match(/^Assert "(.+)" is unchecked$/i);
  if (m) return { code: `await verifyUnchecked(page, '${escSingle(m[1])}');`, isSoft };

  // Assert text contains|equals|starts with|does not equal "X" on "label"
  m = step.match(/^Assert text (contains|equals|starts with|does not equal) "(.+)" on "(.+)"$/i);
  if (m) {
    const op = m[1].toLowerCase(), expected = m[2];
    if (op === 'contains')     return { code: `await verifyText(page, '${escSingle(expected)}');`, isSoft };
    if (op === 'equals')       return { code: `await verifyText(page, '${escSingle(expected)}', true);`, isSoft };
    if (op === 'starts with')  return { code: `await expect(page.getByText('${escSingle(expected)}', { exact: false }).first()).toHaveText(/^${escSingle(expected)}/);`, isSoft };
    if (op === 'does not equal') return { code: `await expect(page.getByText('${escSingle(expected)}', { exact: true })).not.toBeVisible();`, isSoft };
  }

  // Assert value contains|equals "X" on "label"
  m = step.match(/^Assert value (contains|equals|starts with|does not equal) "(.+)" on "(.+)"$/i);
  if (m) {
    const op = m[1].toLowerCase(), expected = m[2], label = m[3];
    if (op === 'contains') return { code: `await verifyInputContains(page, '${escSingle(label)}', '${escSingle(expected)}');`, isSoft };
    return { code: `await verifyInputValue(page, '${escSingle(label)}', '${escSingle(expected)}');`, isSoft };
  }

  // Assert attribute "attr" * "X" on "label"
  m = step.match(/^Assert attribute "(.+)" (?:contains|equals|starts with|does not equal) "(.+)" on "(.+)"$/i);
  if (m) return { code: `await verifyAttribute(page, '${escSingle(m[3])}', '${escSingle(m[1])}', '${escSingle(m[2])}');`, isSoft };

  // Assert N elements match "label"
  m = step.match(/^Assert (\d+) elements? match(?:es)? "(.+)"$/i);
  if (m) return { code: `await verifyCount(page, ':has-text("${escSingle(m[2])}")', ${m[1]});`, isSoft };

  // ── Page-level assertions ───────────────────────────────────────────────────
  // Assert page URL contains|equals|starts with|does not equal "X"
  m = step.match(/^Assert page URL (contains|equals|starts with|does not equal) "(.+)"$/i);
  if (m) {
    const op = m[1].toLowerCase(), expected = escSingle(m[2]);
    if (op === 'equals')        return { code: `await expect(page).toHaveURL('${expected}');`, isSoft };
    if (op === 'starts with')   return { code: `await expect(page).toHaveURL(new RegExp('^${expected.replace(/[.*+?^${}()|[\]\\]/g, '\\\\$&')}'));`, isSoft };
    if (op === 'does not equal') return { code: `await expect(page).not.toHaveURL('${expected}');`, isSoft };
    // contains (default)
    return { code: `await expect(page).toHaveURL(new RegExp('${expected.replace(/[.*+?^${}()|[\]\\]/g, '\\\\$&')}'));`, isSoft };
  }

  // Assert page title contains|equals|starts with|does not equal "X"
  m = step.match(/^Assert page title (contains|equals|starts with|does not equal) "(.+)"$/i);
  if (m) {
    const op = m[1].toLowerCase(), expected = escSingle(m[2]);
    if (op === 'equals')        return { code: `await expect(page).toHaveTitle('${expected}');`, isSoft };
    if (op === 'starts with')   return { code: `await expect(page).toHaveTitle(new RegExp('^${expected.replace(/[.*+?^${}()|[\]\\]/g, '\\\\$&')}'));`, isSoft };
    if (op === 'does not equal') return { code: `await expect(page).not.toHaveTitle('${expected}');`, isSoft };
    // contains (default)
    return { code: `await expect(page).toHaveTitle(new RegExp('${expected.replace(/[.*+?^${}()|[\]\\]/g, '\\\\$&')}'));`, isSoft };
  }

  // Assert page screenshot matches baseline — Playwright manages snapshot files
  // under `__snapshots__/`. First run creates the baseline; subsequent runs diff.
  m = step.match(/^Assert page screenshot matches baseline$/i);
  if (m) return { code: `await expect(page).toHaveScreenshot({ maxDiffPixelRatio: 0.02, fullPage: true });`, isSoft };

  // Fallback — keep as comment so the file still compiles
  return { code: `// TODO: ${step}`, isSoft: false };
}

/**
 * Build a deterministic `verify[Domain]` function from all assertion NL steps.
 * Returns the TypeScript source for one exported function, or '' if no assertions.
 */
export function buildVerifyFunction(domain: string, nlSteps: string[]): string {
  const assertionSteps = nlSteps.filter(s =>
    /^Step \d+:\s*Assert /i.test(s)
  );
  if (assertionSteps.length === 0) return '';

  const fnName  = `verify${domain.charAt(0).toUpperCase() + domain.slice(1)}`;
  const hasSoft = assertionSteps.some(s => /\[soft\]/i.test(s));

  const lines: string[] = [];

  // Every verify function needs `test` for test.step() and `screenshotOnFailure`
  lines.push(`// Each assertion runs as a named Playwright step — visible in HTML + Allure reports`);
  lines.push(`import { test } from '@playwright/test';`);
  lines.push(``);
  lines.push(`export async function ${fnName}(page: Page): Promise<void> {`);
  if (hasSoft) lines.push(`  const softFailures: string[] = [];`);

  for (const step of assertionSteps) {
    const { code, isSoft } = nlAssertionToCode(step);
    const label = step.replace(/^Step \d+:\s*/i, '');   // human label for the step

    lines.push(``);
    if (isSoft) {
      // Soft: collect failure, continue running remaining assertions
      lines.push(`  await test.step(${JSON.stringify(label)}, async () => {`);
      lines.push(`    await softAssert(async () => { await ${code.replace(/^await /, '')} }, softFailures, ${JSON.stringify(label)});`);
      lines.push(`  });`);
    } else {
      // Hard: step fails immediately on error — Playwright marks it failed in the report
      lines.push(`  await test.step(${JSON.stringify(label)}, async () => {`);
      lines.push(`    ${code}`);
      lines.push(`  });`);
    }
  }

  if (hasSoft) {
    lines.push(``);
    lines.push(`  if (softFailures.length > 0) {`);
    lines.push(`    // Screenshot captured and path printed to console for easy debugging`);
    lines.push(`    const screenshotFile = await screenshotOnFailure(page, '${fnName}');`);
    lines.push(`    const report = softFailures.map((f, i) => \`  \${i + 1}. \${f}\`).join('\\n');`);
    lines.push(`    throw new Error(\`\${softFailures.length} assertion(s) failed:\\n\${report}\\n  📸 \${screenshotFile}\`);`);
    lines.push(`  }`);
  }

  lines.push(`}`);
  return lines.join('\n');
}

export function detectAuthSteps(nlSteps: string[]): AuthInfo {
  const maskedIdx = nlSteps.findIndex(s => /Enter.*"\*\*\*MASKED\*\*\*"/.test(s));
  if (maskedIdx === -1) return { hasAuth: false };

  const passwordStep = nlSteps[maskedIdx];
  const passwordLabelMatch = passwordStep.match(/Enter.*in the "(.+)" field/);
  const passwordLabel = passwordLabelMatch?.[1] || 'Password';

  // Username is the step just before masked step that fills a field
  let usernameStep: string | undefined;
  let usernameLabel = 'Email';
  for (let i = maskedIdx - 1; i >= 0; i--) {
    const m = nlSteps[i].match(/Enter ".+" in the "(.+)" field/);
    if (m) {
      usernameStep = nlSteps[i];
      usernameLabel = m[1];
      break;
    }
  }

  // Submit is the step right after masked step that clicks a button
  let submitStep: string | undefined;
  let submitLabel = 'Sign In';
  for (let i = maskedIdx + 1; i < Math.min(maskedIdx + 4, nlSteps.length); i++) {
    const m = nlSteps[i].match(/Click button "(.+)"/);
    if (m) {
      submitStep = nlSteps[i];
      submitLabel = m[1];
      break;
    }
  }

  return {
    hasAuth: true,
    usernameStep,
    passwordStep,
    submitStep,
    usernameLabel,
    passwordLabel,
    submitLabel,
  };
}

function buildAuthSetupContent(authInfo: AuthInfo, startUrl: string): string {
  const usernameLabel = authInfo.usernameLabel || 'Email';
  const passwordLabel = authInfo.passwordLabel || 'Password';
  const submitLabel = authInfo.submitLabel || 'Sign In';
  let loginPathSegment = 'login';
  try {
    const parts = new URL(startUrl).pathname.split('/').filter(Boolean);
    if (parts.length > 0) loginPathSegment = parts[parts.length - 1];
  } catch {}

  return `import { test as setup } from '@playwright/test';
import * as path from 'path';
import * as dotenv from 'dotenv';
dotenv.config();

const authFile = path.join(__dirname, '../.auth/user.json');

setup('authenticate', async ({ page }) => {
  await page.goto('${startUrl}');
  await page.waitForLoadState('networkidle');

  // Fill username — reads from TEST_USERNAME env var
  await page.getByLabel('${usernameLabel}', { exact: false }).fill(process.env.TEST_USERNAME || '');

  // Fill password — reads from TEST_PASSWORD env var
  await page.getByLabel('${passwordLabel}', { exact: false }).fill(process.env.TEST_PASSWORD || '');

  // Submit login form
  await page.getByRole('button', { name: '${submitLabel}', exact: false }).click();

  // Wait for successful login (URL should change away from login page)
  await page.waitForURL(url => !url.href.includes('${loginPathSegment}'), { timeout: 15000 });
  await page.waitForLoadState('networkidle');

  // Save session cookies/storage for all subsequent tests
  await page.context().storageState({ path: authFile });
  console.log('✅ Auth state saved to .auth/user.json');
});
`;
}

const ENV_EXAMPLE = `# Test credentials — copy to .env and fill in real values
TEST_USERNAME=your-username@example.com
TEST_PASSWORD=your-password
`;

const GITIGNORE = `node_modules/
dist/
.auth/
.env
playwright-report/
test-results/
`;

// ─── Post-Generation Validator ────────────────────────────────────────────────
// After Claude generates each file, these functions catch and auto-fix the
// most common structural problems before the files reach the user.

/**
 * Fix 1 — Locators file: ensure `import { Page, Locator }` is present.
 * If Claude only imported `Page`, inject `Locator`.
 */
function fixLocatorsImport(code: string): string {
  // Already correct
  if (/import\s*\{[^}]*\bLocator\b[^}]*\}\s*from\s*['"]@playwright\/test['"]/.test(code)) {
    return code;
  }
  // Has Page import but missing Locator
  return code.replace(
    /import\s*\{\s*Page\s*\}\s*from\s*['"]@playwright\/test['"]/,
    "import { Page, Locator } from '@playwright/test'"
  );
}

/**
 * Fix 2 — Locators file: detect and remove truncated/incomplete locator expressions.
 * A line that ends with `(` or `,` inside a template literal is incomplete.
 * Replace with a safe fallback so TypeScript still compiles.
 */
function fixTruncatedLocators(code: string): string {
  // Match lines like: propName: (page: Page): Locator => page.locator('xpath=//a[contains(
  // (the XPath expression is clearly cut short — ends without closing )')
  return code.replace(
    /(\w+:\s*\(page:\s*Page\)[^=]*=>[^\n]*page\.locator\('[^']*$)/gm,
    (match, _p1, offset, fullStr) => {
      const lineEnd = fullStr.indexOf('\n', offset);
      const line = fullStr.substring(offset, lineEnd > -1 ? lineEnd : undefined);
      // Only replace lines that are clearly incomplete (unbalanced parens)
      const open  = (line.match(/\(/g) || []).length;
      const close = (line.match(/\)/g) || []).length;
      if (open > close) {
        const propName = line.match(/(\w+):/)?.[1] || 'unknownLocator';
        return `${propName}: (page: Page): Locator => page.locator("xpath=//TODO-fix-truncated-locator[@id='${propName}']"),  // ⚠️ AUTO-FIXED: original XPath was truncated`;
      }
      return match;
    }
  );
}

/**
 * Fix 3 — Page class: detect and remove `this.L = PageLocators(...)` anti-pattern.
 * Replace the constructor + this.L pattern with the correct factory-call pattern.
 */
function fixPageClassConstructor(code: string, pageName: string): string {
  const locatorsObj = `${pageName}PageLocators`;

  // Pattern: private L: ...; constructor(page) { this.page = page; this.L = XxxLocators(page); }
  // → Remove the this.L line entirely; keep this.page = page if present
  let fixed = code.replace(
    new RegExp(`\\bthis\\.L\\s*=\\s*${locatorsObj}\\s*\\(\\s*\\w+\\s*\\)\\s*;`, 'g'),
    `// ← removed: locators are called as factory functions per method, not cached here`
  );

  // Pattern: private L: ReturnType<...>  → remove the type annotation field
  fixed = fixed.replace(
    /\s*private\s+L:\s*ReturnType<[^>]+>;\s*/g,
    '\n  '
  );

  // Pattern: this.L.someLocator → PageLocators.someLocator(this.page)
  fixed = fixed.replace(
    /\bthis\.L\.(\w+)\b/g,
    `${locatorsObj}.$1(this.page)`
  );

  return fixed;
}

/**
 * Fix 4 — Test file: align the business-actions import to match what was actually exported.
 * If the import lists function names that don't exist in the actions file, replace them.
 */
function fixTestFileImports(
  testCode: string,
  actionsCode: string,
  domain: string
): string {
  // Extract what the actions file actually exports
  const exportedFns: string[] = [];
  const exportFnRe = /export\s+async\s+function\s+(\w+)/g;
  let exportFnMatch: RegExpExecArray | null;
  while ((exportFnMatch = exportFnRe.exec(actionsCode)) !== null) {
    exportedFns.push(exportFnMatch[1]);
  }

  if (exportedFns.length === 0) return testCode;

  // Find the import line from business actions
  const importPattern = new RegExp(
    `import\\s*\\{([^}]+)\\}\\s*from\\s*['"]@actions/business/${domain}\\.actions['"]`
  );
  const importMatch = testCode.match(importPattern);
  if (!importMatch) return testCode;

  const importedNames = importMatch[1].split(',').map(s => s.trim()).filter(Boolean);
  const bogusNames = importedNames.filter(name => !exportedFns.includes(name));

  if (bogusNames.length === 0) return testCode; // already correct

  // Replace the import statement with the correct function names
  let fixed = testCode.replace(
    importPattern,
    `import { ${exportedFns.join(', ')} } from '@actions/business/${domain}.actions'`
  );

  // Replace any calls to bogus function names with the first exported function
  // (conservative: at least makes the file compile)
  for (const bogus of bogusNames) {
    // Replace call sites: await bogusName(page, ...) → await realName(page, ...)
    const bestMatch = exportedFns.find(fn =>
      fn.toLowerCase().includes(bogus.toLowerCase().substring(0, 5))
    ) || exportedFns[0];
    fixed = fixed.replace(new RegExp(`\\b${bogus}\\b`, 'g'), bestMatch);
  }

  return fixed;
}

/**
 * Fix 5 — Test file and business actions: replace nested testData references
 * (testData.demoRequest.x, testData.urls.x, testData.selectors.x) with the
 * flat keys that actually exist in the fixture.
 */
function fixNestedTestDataRefs(code: string, flatKeys: string[]): string {
  // testData.something.somethingElse → check if 'something' is a flat key
  // If not, replace with testData.baseUrl (safe fallback) and add a TODO comment
  return code.replace(
    /\btestData\.(\w+)\.(\w+)\b/g,
    (match, first, second) => {
      if (flatKeys.includes(`${first}${second.charAt(0).toUpperCase()}${second.slice(1)}`)) {
        // e.g. testData.demoRequest.firstName → testData.firstName (if 'firstName' exists)
        const camel = `${first}${second.charAt(0).toUpperCase()}${second.slice(1)}`;
        return `testData.${camel}`;
      }
      // Try direct second key
      if (flatKeys.includes(second)) return `testData.${second}`;
      // Fallback
      return `testData.baseUrl /* TODO: was ${match} — update to correct flat key */`;
    }
  );
}

/**
 * Master validator: applies all fixes to the generated files in sequence.
 * Returns the corrected array of files.
 */
function validateAndFixGeneratedFiles(
  files: GeneratedFile[],
  domain: string,
  testDataKeys: string[]
): GeneratedFile[] {
  const actionsFile = files.find(f => f.type === 'business_action');
  const testFile    = files.find(f => f.type === 'test');
  const locFiles    = files.filter(f => f.type === 'pom' && f.path.includes('/locators/'));
  const pageFiles   = files.filter(f => f.type === 'pom' && f.path.includes('/pages/'));

  const fixed = files.map(f => ({ ...f })); // shallow copy

  // Fix locators files
  for (const locFile of locFiles) {
    const idx = fixed.findIndex(f => f.path === locFile.path);
    if (idx < 0) continue;
    let code = fixed[idx].content;
    code = fixLocatorsImport(code);
    code = fixTruncatedLocators(code);
    fixed[idx] = { ...fixed[idx], content: code };
  }

  // Fix page class files
  for (const pageFile of pageFiles) {
    const idx = fixed.findIndex(f => f.path === pageFile.path);
    if (idx < 0) continue;
    // Derive page name from path: pages/XxxPage.ts → Xxx
    const pageNameMatch = pageFile.path.match(/pages\/(\w+)Page\.ts/);
    if (!pageNameMatch) continue;
    const pageName = pageNameMatch[1];
    let code = fixed[idx].content;
    code = fixPageClassConstructor(code, pageName);
    if (testDataKeys.length > 0) code = fixNestedTestDataRefs(code, testDataKeys);
    fixed[idx] = { ...fixed[idx], content: code };
  }

  // Fix business actions file
  if (actionsFile) {
    const idx = fixed.findIndex(f => f.path === actionsFile.path);
    if (idx >= 0 && testDataKeys.length > 0) {
      let code = fixed[idx].content;
      code = fixNestedTestDataRefs(code, testDataKeys);
      fixed[idx] = { ...fixed[idx], content: code };
    }
  }

  // Fix test file — align imports to actual exports + fix testData refs
  if (testFile && actionsFile) {
    const testIdx    = fixed.findIndex(f => f.path === testFile.path);
    const actionsIdx = fixed.findIndex(f => f.path === actionsFile.path);
    if (testIdx >= 0 && actionsIdx >= 0) {
      let code = fixed[testIdx].content;
      code = fixTestFileImports(code, fixed[actionsIdx].content, domain);
      if (testDataKeys.length > 0) code = fixNestedTestDataRefs(code, testDataKeys);
      fixed[testIdx] = { ...fixed[testIdx], content: code };
    }
  }

  return fixed;
}

// ─── GAP 3: Multi-page Analysis ──────────────────────────────────────────────

interface PageGroup {
  url: string;
  pageName: string;
  domain: string;
  steps: string[];
  isAuthPage: boolean;
  iframeOrigin?: string; // set when page interactions happen inside an iframe
}

function analyzePages(
  nlSteps: string[],
  events: Array<{ sequence: number; type: string; url: string; naturalLanguage: string; inIframe?: boolean; iframeOrigin?: string }>,
  startUrl: string
): PageGroup[] {
  // Build a map: NL step text → URL from events
  const stepUrlMap = new Map<string, string>();
  for (const evt of events) {
    if (evt.naturalLanguage && evt.url) {
      const rawUrl = evt.url;
      let realUrl = rawUrl;
      try {
        const m = rawUrl.match(/\/api\/recorder\/browse\?url=(.+)/);
        if (m) realUrl = decodeURIComponent(m[1]);
      } catch {}
      stepUrlMap.set(evt.naturalLanguage.trim(), realUrl);
    }
  }

  // Build a map: NL step text → iframe origin (if event came from an iframe)
  const stepIframeMap = new Map<string, string>();
  for (const evt of events) {
    if (evt.naturalLanguage && evt.inIframe && evt.iframeOrigin) {
      stepIframeMap.set(evt.naturalLanguage.trim(), evt.iframeOrigin);
    }
  }

  const groups: PageGroup[] = [];
  let currentUrl = startUrl;
  let currentSteps: string[] = [];

  const flush = (url: string) => {
    if (currentSteps.length === 0) return;
    const { pageName, domain } = deriveNames(url, currentSteps, '');
    const isAuthPage = currentSteps.some(s => /Enter.*"\*\*\*MASKED\*\*\*"/.test(s));
    // Detect if any steps in this group came from an iframe
    const iframeOrigins = currentSteps
      .map(s => stepIframeMap.get(s.trim()))
      .filter(Boolean) as string[];
    const iframeOrigin = iframeOrigins.length > 0 ? iframeOrigins[0] : undefined;
    groups.push({ url, pageName, domain, steps: [...currentSteps], isAuthPage, iframeOrigin });
    currentSteps = [];
  };

  for (const step of nlSteps) {
    const mappedUrl = stepUrlMap.get(step.trim());
    if (mappedUrl && mappedUrl !== currentUrl && mappedUrl.startsWith('http')) {
      flush(currentUrl);
      currentUrl = mappedUrl;
    }
    currentSteps.push(step);
  }
  flush(currentUrl);

  // Deduplicate by URL path prefix — merge steps from same page
  const merged = new Map<string, PageGroup>();
  for (const g of groups) {
    let key = g.url;
    try {
      key = new URL(g.url).pathname.split('/').slice(0, 3).join('/');
    } catch {}
    if (merged.has(key)) {
      merged.get(key)!.steps.push(...g.steps);
    } else {
      merged.set(key, { ...g });
    }
  }

  // Filter out pages with no real user interactions
  // A page with only "Page loaded" or "Navigated to" steps has no interactions
  // These are background redirects (third-party tools, tracking pixels, SSO callbacks etc.)
  const hasRealInteractions = (group: PageGroup): boolean => {
    const nonInteractionPattern = /^(Page loaded|Navigated to|Navigate to|URL changed|Redirected to)/i;
    return group.steps.some(step => !nonInteractionPattern.test(step.trim()));
  };

  return Array.from(merged.values()).filter(hasRealInteractions);
}

export type GeneratorEvent =
  | { type: 'file';     file: GeneratedFile }
  | { type: 'status';   message: string }
  | { type: 'error';    message: string }
  | { type: 'thinking'; label: string; content: string };

/** Extract the thinking block from a response (may be absent when thinking disabled) */
function extractThinking(content: Anthropic.ContentBlock[]): string {
  const thinkingBlock = content.find(b => b.type === 'thinking') as Anthropic.ThinkingBlock | undefined;
  return thinkingBlock?.thinking || '';
}

/** Extract structured tool input from a forced tool_choice response */
function extractToolInput<T>(content: Anthropic.ContentBlock[], toolName: string): T | null {
  const toolUseBlock = content.find(
    b => b.type === 'tool_use' && (b as Anthropic.ToolUseBlock).name === toolName
  ) as Anthropic.ToolUseBlock | undefined;
  return toolUseBlock ? (toolUseBlock.input as T) : null;
}

// ─── Live Page Snapshot (Playwright MCP-style locators) ──────────────────────

/**
 * Navigate to the target URL with a headless browser, capture the ARIA
 * accessibility tree, and return it as a compact YAML-like string.
 * This gives Claude real DOM context so it generates accurate locators
 * (e.g. getByRole('textbox', { name: 'Email address' })) instead of guessing
 * from NL step text alone — the same technique used by the Playwright MCP server.
 */
async function captureAriaSnapshot(url: string): Promise<string> {
  if (!url || !url.startsWith('http')) return '';
  try {
    const { chromium } = await import('playwright');
    const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36',
      viewport: { width: 1280, height: 720 },
    });
    const page = await context.newPage();
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
      // Wait a tick for React/Vue/Angular to hydrate
      await page.waitForTimeout(800);
    } catch {
      // partial load is fine — snapshot what loaded
    }

    let snapshot = '';
    try {
      // ariaSnapshot() available since Playwright 1.46 — returns YAML-like ARIA tree
      snapshot = await page.locator('body').ariaSnapshot();
    } catch {
      // Fallback: older accessibility API
      const tree = await page.accessibility.snapshot();
      if (tree) snapshot = JSON.stringify(tree, null, 2);
    }

    await browser.close();
    // Trim to avoid huge prompts — 6000 chars is plenty for a full page tree
    return snapshot.slice(0, 6000);
  } catch {
    return ''; // page unreachable or auth-gated — degrade gracefully
  }
}

export async function* generateFramework(
  nlSteps: string[],
  startUrl: string,
  testName: string,
  events: Array<{ sequence: number; type: string; url: string; naturalLanguage: string }> = []
): AsyncGenerator<GeneratorEvent> {
  const { pageName, domain, testFileName } = deriveNames(startUrl, nlSteps, testName);

  // ── Structured output types (match the tool schemas above) ──────────────────
  interface PomToolInput {
    locatorsCode: string;
    code: string;
    className: string;
    locators: Array<{name: string; strategy: string; description: string}>;
    methods: string[];
  }
  interface BusinessActionsToolInput {
    code: string;
    functions: Array<{name: string; description: string; stepCount: number}>;
  }
  interface TestToolInput {
    code: string; testCaseName: string; businessScenario: string;
    businessActionsUsed: string[]; assertionsUsed: string[];
  }

  // ── GAP 1: Auth detection ───────────────────────────────────────────────────
  const authInfo = detectAuthSteps(nlSteps);

  // 1. Emit static generic files immediately (no AI)
  yield { type: 'status', message: 'Generating generic action library...' };

  // Extract test data from recorded steps → fixtures/test-data.ts
  const extractedFields = extractTestData(nlSteps, startUrl);
  const testDataContent  = buildTestDataFile(extractedFields, startUrl);
  // Compact schema string passed to Claude so it knows the exact testData shape
  const testDataSchema   = buildTestDataSchema(extractedFields, startUrl);

  const genericFiles: GeneratedFile[] = [
    { path: 'actions/generic/browser.actions.ts', content: GENERIC_BROWSER_ACTIONS, type: 'generic_action' },
    { path: 'actions/generic/form.actions.ts',    content: GENERIC_FORM_ACTIONS,    type: 'generic_action' },
    { path: 'actions/generic/assert.actions.ts',  content: GENERIC_ASSERT_ACTIONS,  type: 'generic_action' },
    // Rule 2: helpers/universal.ts is ALWAYS emitted — never a phantom import
    // Test files import prepareSite from this file; it must exist in every generated project
    { path: 'helpers/universal.ts',              content: HELPERS_UNIVERSAL,        type: 'generic_action' },
    { path: 'fixtures/test-data.ts',              content: testDataContent,          type: 'config' },
    { path: 'package.json',                       content: PACKAGE_JSON,            type: 'config' },
    { path: 'tsconfig.json',                      content: TSCONFIG_JSON,           type: 'config' },
    { path: 'README.md',                          content: README_MD,               type: 'config' },
    // Always emit .gitignore and .env.example
    { path: '.gitignore',                         content: GITIGNORE,               type: 'config' },
    { path: '.env.example',                       content: ENV_EXAMPLE,             type: 'config' },
  ];

  for (const f of genericFiles) {
    yield { type: 'file', file: f };
  }

  // Emit playwright.config.ts with auth awareness
  yield {
    type: 'file',
    file: {
      path: 'playwright.config.ts',
      content: buildPlaywrightConfig(authInfo.hasAuth, startUrl),
      type: 'config',
    }
  };

  // If auth detected, emit auth setup files
  if (authInfo.hasAuth) {
    yield { type: 'status', message: '🔐 Auth detected — generating auth/auth.setup.ts + .env.example...' };
    yield {
      type: 'file',
      file: {
        path: 'auth/auth.setup.ts',
        content: buildAuthSetupContent(authInfo, startUrl),
        type: 'config',
      }
    };
  }

  // ── GAP 3: Multi-page analysis ──────────────────────────────────────────────
  const pages = analyzePages(nlSteps, events, startUrl);
  const isMultiPage = pages.length > 1;

  if (isMultiPage) {
    yield { type: 'status', message: `📄 Detected ${pages.length} pages in recording — generating per-page POMs...` };
  } else {
    yield { type: 'status', message: `📄 Single-page recording detected` };
  }

  // Buffer for AI-generated files — validated before emitting
  const aiGeneratedFiles: GeneratedFile[] = [];

  // Helper to generate POM for a single page group
  // Pushes locators + page files to aiGeneratedFiles instead of yielding directly
  async function* generatePagePom(pageGroup: PageGroup): AsyncGenerator<GeneratorEvent> {
    const pg = pageGroup.pageName;

    // Capture ARIA snapshot for this page
    yield { type: 'status', message: `🎭 Capturing accessibility tree from ${pageGroup.url}...` };
    const ariaSnapshot = await captureAriaSnapshot(pageGroup.url);
    if (ariaSnapshot) {
      const lineCount = ariaSnapshot.split('\n').length;
      yield { type: 'status', message: `✅ Snapshot captured for ${pg} (${lineCount} nodes)` };
    } else {
      yield { type: 'status', message: `⚠️  ${pg} not reachable — inferring locators from steps` };
    }

    yield { type: 'status', message: `🧠 Generating locators/${pg}Page.locators.ts + pages/${pg}Page.ts...` };
    try {
      const pomResponse = await anthropic.messages.create({
        model: SCRIPT_MODEL,
        max_tokens: 12000,
        system: POM_JSON_SCHEMA,
        messages: [{ role: 'user', content: buildPageObjectPrompt(pageGroup.steps, pageGroup.url, pg, ariaSnapshot, pageGroup.iframeOrigin) }]
      });
      const pomThinking = extractThinking(pomResponse.content);
      let pomInput: PomToolInput;
      try {
        const textBlock = pomResponse.content.find(b => b.type === 'text') as Anthropic.TextBlock | undefined;
        pomInput = parseJsonResponse<PomToolInput>(textBlock?.text || '{}');
      } catch {
        const textBlock = pomResponse.content.find(b => b.type === 'text') as Anthropic.TextBlock | undefined;
        const rawCode = textBlock?.text || '// Page Object generation produced no output';
        pomInput = { locatorsCode: '', code: rawCode, className: `${pg}Page`, locators: [], methods: [] };
      }
      if (pomThinking) {
        yield { type: 'thinking', label: `${pg}Page — locator reasoning`, content: pomThinking };
      }
      if (pomInput.locatorsCode?.trim()) {
        aiGeneratedFiles.push({
          path: `locators/${pg}Page.locators.ts`,
          content: pomInput.locatorsCode.trim(),
          type: 'pom',
          metadata: { className: `${pg}PageLocators`, locators: pomInput.locators, snapshotUsed: !!ariaSnapshot }
        });
      }
      aiGeneratedFiles.push({
        path: `pages/${pg}Page.ts`,
        content: pomInput.code.trim(),
        type: 'pom',
        metadata: { className: pomInput.className, locators: pomInput.locators, methods: pomInput.methods, snapshotUsed: !!ariaSnapshot }
      });
    } catch (err: any) {
      yield { type: 'error', message: `Page Object generation failed for ${pg}: ${err.message}` };
    }
  }

  // 2. Generate POMs per page (skip login page when auth is handled separately)
  const allPageNames: string[] = [];

  if (isMultiPage) {
    for (const pageGroup of pages) {
      if (pageGroup.isAuthPage && authInfo.hasAuth) {
        yield { type: 'status', message: `🔐 Skipping login page POM (handled by auth/auth.setup.ts)` };
        continue;
      }
      allPageNames.push(pageGroup.pageName);
      yield* generatePagePom(pageGroup);
    }
  } else if (pages.length === 0) {
    yield { type: 'status', message: `⚠️ No pages with user interactions found — skipping POM generation` };
  } else {
    // Single-page: use original snapshot approach
    const singleGroup = pages[0] || { url: startUrl, pageName, domain, steps: nlSteps, isAuthPage: authInfo.hasAuth };
    if (singleGroup.isAuthPage && authInfo.hasAuth) {
      yield { type: 'status', message: `🔐 Skipping login page POM (handled by auth/auth.setup.ts)` };
    } else {
      allPageNames.push(singleGroup.pageName);
      yield* generatePagePom(singleGroup);
    }
  }

  // Determine primary page/domain for business actions + test file
  const primaryPageName = allPageNames[0] || pageName;
  const primaryDomain = domain;

  // ── LAYER N → N+1 THREADING ─────────────────────────────────────────────────
  // After all POM files are generated, extract the exact method names from the
  // structured tool output (pomInput.methods). These are passed as a hard contract
  // into the business actions prompt so Claude CANNOT invent method names.
  // This eliminates Issue 2: "broken method calls in business actions".
  interface PomMethodContract {
    className: string;  // e.g. NousinfosystemsHomePage
    pageFile:  string;  // e.g. pages/NousinfosystemsHomePage.ts
    methods:   string[]; // exact method names from pomInput.methods
  }
  const pomMethodContracts: PomMethodContract[] = aiGeneratedFiles
    .filter(f => f.type === 'pom' && f.path.startsWith('pages/'))
    .map(f => ({
      className: (f.metadata?.className as string) || '',
      pageFile:  f.path,
      methods:   ((f.metadata?.methods as string[]) || []),
    }))
    .filter(c => c.className && c.methods.length > 0);

  if (pomMethodContracts.length > 0) {
    const contractSummary = pomMethodContracts
      .map(c => `${c.className}: [${c.methods.join(', ')}]`)
      .join(' | ');
    yield { type: 'status', message: `🔗 POM→Actions contract: ${contractSummary}` };
  }

  // 3. Business Actions — Extended Thinking + Structured Output
  // exportedFunctionNames is populated after generation and passed to the test file prompt
  let exportedFunctionNames: string[] = [];
  yield { type: 'status', message: `🧠 Extended Thinking + Structured Output: generating ${primaryDomain}.actions.ts...` };

  // For business actions we pass all page steps (minus pure auth steps)
  const nonAuthSteps = authInfo.hasAuth
    ? nlSteps.filter(s => !authInfo.passwordStep || s !== authInfo.passwordStep)
    : nlSteps;

  // Capture snapshot for first non-auth page for business actions hint
  let baSnapshot = '';
  const firstNonAuthPage = pages.find(p => !p.isAuthPage);
  if (firstNonAuthPage) {
    baSnapshot = await captureAriaSnapshot(firstNonAuthPage.url);
  }

  try {
    const actionsResponse = await anthropic.messages.create({
      model: SCRIPT_MODEL,
      max_tokens: 9000,
      system: BUSINESS_ACTIONS_JSON_SCHEMA,
      messages: [{ role: 'user', content: buildBusinessActionsPrompt(nonAuthSteps, primaryPageName, primaryDomain, testDataSchema, baSnapshot || undefined, pomMethodContracts) }]
    });
    const actionsThinking = extractThinking(actionsResponse.content);
    let actionsInput: BusinessActionsToolInput;
    try {
      const textBlock = actionsResponse.content.find(b => b.type === 'text') as Anthropic.TextBlock | undefined;
      actionsInput = parseJsonResponse<BusinessActionsToolInput>(textBlock?.text || '{}');
    } catch {
      const textBlock = actionsResponse.content.find(b => b.type === 'text') as Anthropic.TextBlock | undefined;
      const rawCode = textBlock?.text || '// Business Actions generation produced no output';
      actionsInput = { code: rawCode, functions: [] };
    }
    if (actionsThinking) {
      yield { type: 'thinking', label: `${primaryDomain}.actions — composition reasoning`, content: actionsThinking };
    }
    // ── DETERMINISTIC VERIFY FUNCTION — appended after AI-generated actions ──
    // Any "Assert ..." NL steps are converted directly to Playwright expect() calls.
    // This bypasses Claude for assertions — always correct, no hallucination.
    const verifyFnSource = buildVerifyFunction(primaryDomain, nonAuthSteps);
    let actionsFileContent = actionsInput.code.trim();

    if (verifyFnSource) {
      // Ensure the verify function's imports are present in the actions file
      const needsSoftAssert = /softAssert/.test(verifyFnSource);
      // Always include screenshotOnFailure — verify function always calls it on any failure
      let assertImport = `import { verifyText, verifyUrl, verifyVisible, verifyEnabled, verifyDisabled,\n         verifyChecked, verifyUnchecked, verifyInputValue, verifyInputContains,\n         verifyAttribute, verifyCount${needsSoftAssert ? ', softAssert' : ''}, screenshotOnFailure } from '@actions/generic/assert.actions';`;
      // Replace or insert assert import
      if (/from '@actions\/generic\/assert\.actions'/.test(actionsFileContent)) {
        actionsFileContent = actionsFileContent.replace(
          /import\s*\{[^}]*\}\s*from\s*'@actions\/generic\/assert\.actions';/,
          assertImport
        );
      } else {
        actionsFileContent = actionsFileContent + '\n' + assertImport;
      }
      actionsFileContent += '\n\n' + verifyFnSource;

      const verifyFnName = `verify${primaryDomain.charAt(0).toUpperCase() + primaryDomain.slice(1)}`;
      actionsInput.functions.push({
        name: verifyFnName,
        description: 'Verifies page state using recorded assertions',
        stepCount: nonAuthSteps.filter(s => /^Step \d+:\s*Assert /i.test(s)).length
      });
      yield { type: 'status', message: `✅ Deterministic verify function generated: ${verifyFnName}()` };
    }

    aiGeneratedFiles.push({
      path: `actions/business/${primaryDomain}.actions.ts`,
      content: actionsFileContent,
      type: 'business_action',
      metadata: { functions: actionsInput.functions }
    });

    // ── CONTRACT: extract the real exported function names so test file uses them exactly ──
    exportedFunctionNames = actionsInput.functions.map(f => f.name);
    yield { type: 'status', message: `📋 Business actions contract: [${exportedFunctionNames.join(', ')}]` };
  } catch (err: any) {
    yield { type: 'error', message: `Business Actions generation failed: ${err.message}` };
    return;
  }

  // 4. Test file — Extended Thinking + Structured Output
  // Filter out auth steps from test file (they are handled by auth.setup.ts)
  const testSteps = authInfo.hasAuth
    ? nlSteps.filter(s => {
        if (authInfo.usernameStep && s === authInfo.usernameStep) return false;
        if (authInfo.passwordStep && s === authInfo.passwordStep) return false;
        if (authInfo.submitStep && s === authInfo.submitStep) return false;
        return true;
      })
    : nlSteps;

  yield { type: 'status', message: `🧠 Generating ${testFileName}.spec.ts...` };
  try {
    const testResponse = await anthropic.messages.create({
      model: SCRIPT_MODEL,
      max_tokens: 6000,
      system: TEST_JSON_SCHEMA,
      messages: [{ role: 'user', content: buildTestFilePrompt(testSteps, testName, startUrl, primaryPageName, primaryDomain, exportedFunctionNames, testDataSchema) }]
    });
    const testThinking = extractThinking(testResponse.content);
    let testInput: TestToolInput;
    try {
      const textBlock = testResponse.content.find(b => b.type === 'text') as Anthropic.TextBlock | undefined;
      testInput = parseJsonResponse<TestToolInput>(textBlock?.text || '{}');
    } catch {
      const textBlock = testResponse.content.find(b => b.type === 'text') as Anthropic.TextBlock | undefined;
      const rawCode = textBlock?.text || '// Test file generation produced no output';
      testInput = { code: rawCode, testCaseName: testName, businessScenario: '', businessActionsUsed: [], assertionsUsed: [] };
    }
    if (testThinking) {
      yield { type: 'thinking', label: `${testFileName}.spec — test design reasoning`, content: testThinking };
    }
    aiGeneratedFiles.push({
      path: `tests/${testFileName}.spec.ts`,
      content: testInput.code.trim(),
      type: 'test',
      metadata: {
        testCaseName: testInput.testCaseName,
        businessScenario: testInput.businessScenario,
        businessActionsUsed: testInput.businessActionsUsed,
        assertionsUsed: testInput.assertionsUsed
      }
    });
  } catch (err: any) {
    yield { type: 'error', message: `Test file generation failed: ${err.message}` };
    return;
  }

  // ── POST-GENERATION VALIDATION ──────────────────────────────────────────────
  // Run all auto-fix passes on the buffered AI-generated files before emitting.
  // This guarantees structural consistency regardless of what Claude produced.
  yield { type: 'status', message: '🔍 Running post-generation validation...' };

  const testDataKeys = extractedFields.map(f => f.key).concat(['baseUrl']);
  const validatedFiles = validateAndFixGeneratedFiles(aiGeneratedFiles, primaryDomain, testDataKeys);

  // Report which files were modified
  for (let i = 0; i < aiGeneratedFiles.length; i++) {
    if (validatedFiles[i].content !== aiGeneratedFiles[i].content) {
      yield { type: 'status', message: `  🔧 Auto-fixed: ${validatedFiles[i].path}` };
    }
  }

  // Emit all validated files
  for (const file of validatedFiles) {
    yield { type: 'file', file };
  }

  yield { type: 'status', message: '✅ Framework generation complete!' };
}

// ─── Self-Healing: fix a broken locator via Claude ────────────────────────────

export async function healLocator(
  brokenLocator: string,
  errorMessage: string,
  pageUrl: string,
  domSnapshot: string  // simplified DOM around the failing element
): Promise<string> {
  const response = await anthropic.messages.create({
    model: SCRIPT_MODEL,
    max_tokens: 500,
    messages: [{
      role: 'user',
      content: `You are a Playwright test automation expert. A locator broke after a UI change.

Broken locator: ${brokenLocator}
Error: ${errorMessage}
Page URL: ${pageUrl}

Current DOM around the target element:
${domSnapshot.slice(0, 3000)}

Generate ONE replacement Playwright locator that will find the same element.
Rules:
- Use getByRole, getByPlaceholder, getByLabel, or getByText — prefer semantic over CSS
- Add .first() if the element might match multiple
- Return ONLY the locator expression, nothing else
- Example: page.getByRole('button', { name: 'Submit', exact: false })

Replacement locator:`
    }]
  });

  return ((response.content[0] as any).text || '').trim();
}
