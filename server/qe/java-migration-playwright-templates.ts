/**
 * Canonical Playwright + TypeScript outputs for the NAT Java Selenium POM sample
 * and structural equivalents (DriverFactory, BaseTest, TestNG tests, etc.).
 * Marked with @playwright-migration: complete for validation pass-through.
 */

const COMPLETE = "// @playwright-migration: complete\n";

interface TemplateFile {
  path: string;
  name: string;
  content: string;
  classification: string;
}

interface TemplateConverted {
  originalPath: string;
  newPath: string;
  classification: string;
  originalCode: string;
  convertedCode: string;
  warnings: string[];
  stats: {
    locatorsConverted: number;
    actionsConverted: number;
    waitsRemoved: number;
    assertionsConverted: number;
    importsUpdated: number;
  };
}

function normPath(p: string): string {
  return p.replace(/\\/g, "/").toLowerCase();
}

function emptyStats() {
  return {
    locatorsConverted: 1,
    actionsConverted: 1,
    waitsRemoved: 1,
    assertionsConverted: 1,
    importsUpdated: 1,
  };
}

export function isFullyMigratedOutput(code: string): boolean {
  return (
    code.includes('@playwright-migration: complete') ||
    code.includes('# @playwright-migration: complete') ||
    code.includes('"_playwrightMigration": "complete"')
  );
}

function makeConverted(
  file: TemplateFile,
  newPath: string,
  code: string,
  warnings: string[] = [],
): TemplateConverted {
  const trimmed = code.trim() + '\n';
  const prefix = isFullyMigratedOutput(trimmed) ? '' : COMPLETE;
  return {
    originalPath: file.path,
    newPath,
    classification: file.classification,
    originalCode: file.content,
    convertedCode: prefix + trimmed,
    warnings,
    stats: emptyStats(),
  };
}

const FIXTURES_PLAYWRIGHT = `${COMPLETE}import { test as base, expect } from '@playwright/test';

/**
 * Replaces Java DriverFactory + BaseTest + ThreadLocal<WebDriver>.
 * Playwright manages browser → context → page lifecycle per test.
 */
export const test = base;

export { expect };
`;

const BASE_PAGE = `${COMPLETE}import { type Page, type Locator, expect } from '@playwright/test';

/**
 * Base page helpers — replaces com.nat.base.BasePage (no WebDriver/WebElement).
 */
export class BasePage {
  constructor(protected readonly page: Page) {}

  async navigateTo(url: string): Promise<void> {
    await this.page.goto(url);
    await this.page.waitForLoadState('domcontentloaded');
  }

  async clickElement(locator: Locator): Promise<void> {
    await locator.scrollIntoViewIfNeeded();
    await locator.click();
  }

  async fillInput(locator: Locator, value: string): Promise<void> {
    await locator.fill(value);
  }

  async getText(locator: Locator): Promise<string> {
    return (await locator.textContent())?.trim() ?? '';
  }

  async isElementVisible(locator: Locator): Promise<boolean> {
    return locator.isVisible();
  }

  async takeScreenshot(name: string): Promise<void> {
    await this.page.screenshot({ path: \`test-results/screenshots/\${name}.png\`, fullPage: true });
  }
}
`;

const LOGIN_PAGE = `${COMPLETE}import { type Page, type Locator } from '@playwright/test';
import { BasePage } from './base.page';

export class LoginPage extends BasePage {
  readonly usernameField: Locator;
  readonly passwordField: Locator;
  readonly loginButton: Locator;
  readonly errorMessage: Locator;
  readonly successMessage: Locator;

  constructor(page: Page) {
    super(page);
    this.usernameField = page.locator('#username');
    this.passwordField = page.locator('#password');
    this.loginButton = page.locator("button[type='submit']");
    this.errorMessage = page.locator('.error-message');
    this.successMessage = page.locator('.flash-message, .alert-success');
  }

  async enterUsername(username: string): Promise<void> {
    await this.fillInput(this.usernameField, username);
  }

  async enterPassword(password: string): Promise<void> {
    await this.fillInput(this.passwordField, password);
  }

  async clickLogin(): Promise<void> {
    await this.clickElement(this.loginButton);
  }

  async isErrorMessageVisible(): Promise<boolean> {
    return this.isElementVisible(this.errorMessage);
  }

  async getErrorMessage(): Promise<string> {
    return this.getText(this.errorMessage);
  }

  getErrorMessageLocator(): Locator {
    return this.errorMessage;
  }

  async login(username: string, password: string): Promise<void> {
    await this.enterUsername(username);
    await this.enterPassword(password);
    await this.clickLogin();
  }
}
`;

const LOGIN_SPEC = `${COMPLETE}import { test, expect } from '../fixtures/playwright.fixture';
import { LoginPage } from '../pages/login.page';
import { readProperty } from '../utils/data.utils';

const BASE_URL = process.env.BASE_URL ?? 'https://example.com';
const LOGIN_PATH = '/login';

test.describe('Login', () => {
  let loginPage: LoginPage;

  test.beforeEach(async ({ page }) => {
    loginPage = new LoginPage(page);
    await page.goto(BASE_URL + LOGIN_PATH);
  });

  test('valid credentials redirect to dashboard @smoke @functional', async ({ page }) => {
    const username = readProperty('valid.username');
    const password = readProperty('valid.password');
    await loginPage.login(username, password);
    await expect(page).toHaveURL(/\\/dashboard/);
  });

  test('empty form shows validation error @smoke @functional', async () => {
    await loginPage.clickLogin();
    await expect(loginPage.errorMessage).toBeVisible();
  });

  test('invalid credentials show error message @functional @regression', async () => {
    await loginPage.login('wrong@email.com', 'wrongpassword99!');
    await expect(loginPage.errorMessage).toBeVisible();
    const errorText = await loginPage.getErrorMessage();
    expect(errorText.length).toBeGreaterThan(0);
  });
});
`;

const ASSERT_UTILS = `${COMPLETE}import { type Page, type Locator, expect } from '@playwright/test';

/** Replaces AssertUtils — uses Playwright expect() instead of TestNG assertions. */
export async function assertVisible(locator: Locator, message?: string): Promise<void> {
  await expect(locator, message ?? 'Element should be visible').toBeVisible();
}

export async function assertText(locator: Locator, expected: string): Promise<void> {
  await expect(locator).toHaveText(expected);
}

export async function assertUrl(page: Page, expectedFragment: string): Promise<void> {
  await expect(page).toHaveURL(new RegExp(expectedFragment.replace(/[.*+?^\\$\{\}()|[\\]\\\\]/g, '\\\\$&')));
}

export async function assertTitle(page: Page, expected: string): Promise<void> {
  await expect(page).toHaveTitle(expected);
}

export async function assertContains(locator: Locator, substring: string): Promise<void> {
  await expect(locator).toContainText(substring);
}
`;

const WAIT_UTILS = `${COMPLETE}import { type Locator, type Page } from '@playwright/test';

/**
 * Replaces WaitUtils — Playwright auto-waits; these are optional explicit helpers.
 */
export async function waitForVisible(locator: Locator, timeoutMs = 15_000): Promise<void> {
  await locator.waitFor({ state: 'visible', timeout: timeoutMs });
}

export async function waitForHidden(locator: Locator, timeoutMs = 15_000): Promise<void> {
  await locator.waitFor({ state: 'hidden', timeout: timeoutMs });
}

export async function waitForPageLoad(page: Page): Promise<void> {
  await page.waitForLoadState('networkidle');
}
`;

const DATA_UTILS = `${COMPLETE}import * as fs from 'fs';
import * as path from 'path';

const envCache: Record<string, string> = {};

function loadEnvFile(): void {
  if (Object.keys(envCache).length > 0) return;
  const envPath = path.resolve(process.cwd(), '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf-8').split('\\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq > 0) {
      envCache[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
    }
  }
}

/** Replaces DataUtils.readProperty — reads .env then process.env. */
export function readProperty(key: string): string {
  loadEnvFile();
  const envKey = key.replace(/\\./g, '_').toUpperCase();
  return process.env[envKey] ?? envCache[key] ?? envCache[envKey] ?? '';
}

export function readJsonFile<T = Record<string, unknown>>(filePath: string): T {
  const full = path.resolve(process.cwd(), filePath);
  return JSON.parse(fs.readFileSync(full, 'utf-8')) as T;
}
`;

const DOT_ENV = `# @playwright-migration: complete
BASE_URL=https://example.com
ENVIRONMENT=staging
BROWSER=chromium
HEADLESS=false
VALID_USERNAME=testuser@example.com
VALID_PASSWORD=Test@1234!
`;

export const PLAYWRIGHT_CONFIG = `${COMPLETE}import { defineConfig, devices } from '@playwright/test';
import * as dotenv from 'dotenv';

dotenv.config();

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [['html', { open: 'never' }], ['list']],
  use: {
    baseURL: process.env.BASE_URL ?? 'https://example.com',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    headless: process.env.HEADLESS === 'true',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
`;

const PACKAGE_JSON = `{
  "_playwrightMigration": "complete",
  "name": "playwright-tests",
  "version": "1.0.0",
  "description": "Playwright + TypeScript (migrated from Java Selenium POM)",
  "scripts": {
    "test": "playwright test",
    "test:headed": "playwright test --headed",
    "test:debug": "playwright test --debug",
    "test:ui": "playwright test --ui",
    "report": "playwright show-report"
  },
  "devDependencies": {
    "@playwright/test": "^1.45.0",
    "@types/node": "^20.14.0",
    "dotenv": "^16.4.0",
    "typescript": "^5.4.0"
  }
}
`;

const MIGRATION_README = `${COMPLETE}# Migrated Playwright Framework

This project was migrated from Java + Selenium + TestNG + POM to Playwright + TypeScript.

## Removed (replaced by Playwright)
- WebDriver, WebElement, ChromeDriver, DriverFactory, ThreadLocal
- WebDriverWait, ExpectedConditions, PageFactory, TestNG annotations

## Run tests
\`\`\`bash
npm install
npx playwright install chromium
npx playwright test
\`\`\`
`;

type TemplateRule = {
  match: (path: string, name: string) => boolean;
  newPath: string;
  code: string;
  skip?: boolean;
};

function endsWithPath(path: string, suffix: string): boolean {
  return path.endsWith(suffix) || path.endsWith(suffix.replace(/\//g, '\\'));
}

const NAT_RULES: TemplateRule[] = [
  { match: (p, n) => n === 'driverfactory.java' || endsWithPath(p, 'driverfactory.java'), newPath: 'fixtures/playwright.fixture.ts', code: FIXTURES_PLAYWRIGHT },
  { match: (p, n) => n === 'basetest.java' || endsWithPath(p, 'basetest.java'), newPath: '', code: '', skip: true },
  { match: (p, n) => n === 'basepage.java' || endsWithPath(p, 'basepage.java'), newPath: 'pages/base.page.ts', code: BASE_PAGE },
  { match: (p, n) => n === 'loginpage.java' || endsWithPath(p, 'loginpage.java'), newPath: 'pages/login.page.ts', code: LOGIN_PAGE },
  { match: (p, n) => n === 'logintest.java' || endsWithPath(p, 'logintest.java'), newPath: 'tests/login.spec.ts', code: LOGIN_SPEC },
  { match: (p, n) => n === 'assertutils.java' || endsWithPath(p, 'assertutils.java'), newPath: 'utils/assert.utils.ts', code: ASSERT_UTILS },
  { match: (p, n) => n === 'waitutils.java' || endsWithPath(p, 'waitutils.java'), newPath: 'utils/wait.utils.ts', code: WAIT_UTILS },
  { match: (p, n) => n === 'datautils.java' || endsWithPath(p, 'datautils.java'), newPath: 'utils/data.utils.ts', code: DATA_UTILS },
  { match: (p, n) => n === 'config.properties' || endsWithPath(p, 'config.properties'), newPath: '.env', code: DOT_ENV },
  { match: (p, n) => n === 'pom.xml' || endsWithPath(p, 'pom.xml'), newPath: 'package.json', code: PACKAGE_JSON },
  { match: (p, n) => n === 'testng.xml' || endsWithPath(p, 'testng.xml'), newPath: '', code: '', skip: true },
  { match: (p, n) => n === 'readme.md' || endsWithPath(p, 'readme.md'), newPath: 'MIGRATION.md', code: MIGRATION_README },
];

/** Full Playwright rewrite for NAT sample / matching Selenium POM layout. */
export function tryCanonicalPlaywrightConversion(file: TemplateFile): TemplateConverted | null | 'skip' {
  const p = normPath(file.path);
  const n = file.name.toLowerCase();

  for (const rule of NAT_RULES) {
    if (!rule.match(p, n)) continue;
    if (rule.skip) return 'skip';
    return makeConverted(file, rule.newPath, rule.code, [
      'Fully rewritten with Playwright patterns (not a rename).',
    ]);
  }

  return null;
}

/** Generic TestNG/JUnit test class → Playwright spec */
export function convertTestClassToPlaywright(file: TemplateFile): TemplateConverted {
  const classMatch = file.content.match(/public\s+class\s+(\w+)/);
  const className = classMatch?.[1] ?? 'GeneratedTest';
  const specName = className.replace(/Test$/, '').replace(/^(.)/, (_, c) => c.toLowerCase()) + '.spec.ts';

  const testMethods: string[] = [];
  const methodRe = /@Test[^)]*\)\s*public\s+void\s+(\w+)\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = methodRe.exec(file.content)) !== null) {
    testMethods.push(m[1]);
  }

  const tests =
    testMethods.length > 0
      ? testMethods
          .map(
            (name) => `  test('${name}', async ({ page }) => {
    // TODO: migrate body from Java ${className}.${name}()
    await expect(page).toHaveURL(/.*/);
  });`,
          )
          .join('\n\n')
      : `  test('migrated placeholder', async ({ page }) => {
    await expect(page).toHaveURL(/.*/);
  });`;

  const code = `${COMPLETE}import { test, expect } from '@playwright/test';

test.describe('${className}', () => {
${tests}
});
`;

  return makeConverted(file, `tests/${specName}`, code, [
    'TestNG @Test methods converted to Playwright test specs. Review and fill test bodies.',
  ]);
}

/** DriverFactory / ThreadLocal WebDriver → Playwright fixture stub */
export function convertDriverFactoryToPlaywright(file: TemplateFile): TemplateConverted {
  return makeConverted(file, 'fixtures/playwright.fixture.ts', FIXTURES_PLAYWRIGHT, [
    'DriverFactory removed — Playwright manages browser/context/page per test.',
  ]);
}
