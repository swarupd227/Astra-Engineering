/**
 * Validator module self-tests (Part 7 of spec)
 * Run with: npx ts-node server/validator/validator.test.ts
 * (or integrate into your test runner)
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { validateGeneratedProject } from './index';
import { generateWithValidation, GenerationValidationError, RecordingSession } from './runner';

// ─── Test helpers ─────────────────────────────────────────────────────────────

type AssertFn = () => void;
const results: { name: string; ok: boolean; error?: string }[] = [];

async function test(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`  ✅ ${name}`);
  } catch (e: any) {
    results.push({ name, ok: false, error: e.message });
    console.error(`  ❌ ${name}\n     ${e.message}`);
  }
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

/** Create a minimal temporary project directory with required structure */
function createTmpProject(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nat20-validator-test-'));
  // Create required skeleton directories and files
  const dirs = [
    'locators', 'pages', 'actions/generic', 'actions/business', 'tests',
    'fixtures', 'helpers',
  ];
  for (const d of dirs) fs.mkdirSync(path.join(dir, d), { recursive: true });
  // Minimal required static files
  fs.writeFileSync(path.join(dir, 'playwright.config.ts'), minimalPlaywrightConfig());
  fs.writeFileSync(path.join(dir, 'package.json'), minimalPackageJson());
  fs.writeFileSync(path.join(dir, 'tsconfig.json'), minimalTsConfig());
  fs.writeFileSync(path.join(dir, '.env.example'), 'BASE_URL=https://example.com\n');
  fs.writeFileSync(path.join(dir, 'fixtures/test-data.ts'), minimalTestData());
  fs.writeFileSync(path.join(dir, 'helpers/universal.ts'), minimalUniversal());
  // Minimal placeholder files so directories are non-empty
  fs.writeFileSync(path.join(dir, 'locators/TestPage.locators.ts'), minimalLocators());
  fs.writeFileSync(path.join(dir, 'pages/TestPage.ts'), minimalPage());
  fs.writeFileSync(path.join(dir, 'actions/generic/browser.actions.ts'), 'export {};\n');
  fs.writeFileSync(path.join(dir, 'actions/business/test.actions.ts'), minimalBusinessActions());
  fs.writeFileSync(path.join(dir, 'tests/test.spec.ts'), minimalTest());
  return dir;
}

function cleanup(dir: string): void {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
}

// ─── Minimal file content factories ──────────────────────────────────────────

function minimalPlaywrightConfig(): string {
  return `import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  use: {
    baseURL: process.env.BASE_URL || 'https://example.com',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
`;
}

function minimalPackageJson(): string {
  return JSON.stringify({
    name: 'test-framework',
    devDependencies: { '@playwright/test': '^1.52.0', typescript: '^5.5.0' },
  }, null, 2);
}

function minimalTsConfig(): string {
  return JSON.stringify({
    compilerOptions: {
      target: 'ES2020', module: 'commonjs', strict: true, skipLibCheck: true,
      esModuleInterop: true,
    },
    include: ['**/*.ts'],
  }, null, 2);
}

function minimalTestData(): string {
  return `export const testData = { baseUrl: process.env.BASE_URL || 'https://example.com' } as const;\n`;
}

function minimalUniversal(): string {
  return `import { Page } from '@playwright/test';\nexport async function prepareSite(page: Page): Promise<void> {}\n`;
}

function minimalLocators(): string {
  return `import { Page, Locator } from '@playwright/test';
export const TestPageLocators = {
  someButton: (page: Page): Locator => page.locator("xpath=//button[contains(normalize-space(text()),'Click')]"),
};
`;
}

function minimalPage(): string {
  return `import { Page } from '@playwright/test';
import { TestPageLocators } from '@locators/TestPage.locators';
export class TestPage {
  constructor(private readonly page: Page) {}
  async clickButton(): Promise<void> {
    const loc = TestPageLocators.someButton(this.page);
    await loc.waitFor({ state: 'visible' });
    await loc.click();
  }
}
`;
}

function minimalBusinessActions(): string {
  return `import { Page } from '@playwright/test';
import { TestPage } from '@pages/TestPage';
import { testData } from '@fixtures/test-data';
export async function doSomething(page: Page, data = testData): Promise<void> {
  const pg = new TestPage(page);
  await pg.clickButton();
}
`;
}

function minimalTest(): string {
  return `import { test } from '@playwright/test';
import { doSomething } from '@actions/business/test.actions';
test.describe('Test Suite', () => {
  test('does something', async ({ page }) => {
    await doSomething(page);
  });
});
`;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

console.log('\n🧪 Validator module self-tests\n');

// TEST 2 — Gate 02 catches expect() in POM
await test('Gate 02: catches expect() in POM', async () => {
  const dir = createTmpProject();
  try {
    fs.writeFileSync(path.join(dir, 'pages/TestPage.ts'), `
import { Page } from '@playwright/test';
import { expect } from '@playwright/test';
export class TestPage {
  constructor(private readonly page: Page) {}
  async checkVisible(): Promise<void> {
    await expect(this.page.locator('button')).toBeVisible();
  }
}
`);
    const result = await validateGeneratedProject(dir);
    const match = result.blockers.find(e => e.rule === 'NO_EXPECT_IN_POM');
    assert(!!match, `Expected NO_EXPECT_IN_POM blocker, got: ${JSON.stringify(result.blockers.map(e => e.rule))}`);
  } finally { cleanup(dir); }
});

// TEST 3 — Gate 03 catches exact XPath equality
await test('Gate 03: catches exact XPath text equality', async () => {
  const dir = createTmpProject();
  try {
    fs.writeFileSync(path.join(dir, 'locators/TestPage.locators.ts'), `
import { Page, Locator } from '@playwright/test';
export const TestPageLocators = {
  submitBtn: (page: Page): Locator => page.locator("xpath=//button[normalize-space(text())='Submit']"),
};
`);
    const result = await validateGeneratedProject(dir);
    const match = result.majors.find(e => e.rule === 'NO_EXACT_TEXT_EQUALITY_XPATH');
    assert(!!match, `Expected NO_EXACT_TEXT_EQUALITY_XPATH major, got: ${JSON.stringify(result.majors.map(e => e.rule))}`);
  } finally { cleanup(dir); }
});

// TEST 4 — Gate 04 catches method name mismatch
await test('Gate 04: catches method not in POM', async () => {
  const dir = createTmpProject();
  try {
    // POM has clickButton, but business action calls clickBtn
    fs.writeFileSync(path.join(dir, 'actions/business/test.actions.ts'), `
import { Page } from '@playwright/test';
import { TestPage } from '@pages/TestPage';
import { testData } from '@fixtures/test-data';
export async function doSomething(page: Page, data = testData): Promise<void> {
  const pg = new TestPage(page);
  await pg.clickBtn();  // wrong name — POM has clickButton()
}
`);
    const result = await validateGeneratedProject(dir);
    const match = result.blockers.find(e => e.rule === 'METHOD_NOT_IN_POM');
    assert(!!match, `Expected METHOD_NOT_IN_POM blocker, got: ${JSON.stringify(result.blockers.map(e => e.rule))}`);
  } finally { cleanup(dir); }
});

// TEST 5 — Gate 05 catches missing helpers/universal.ts
await test('Gate 05: catches missing helpers/universal.ts', async () => {
  const dir = createTmpProject();
  try {
    fs.unlinkSync(path.join(dir, 'helpers/universal.ts'));
    const result = await validateGeneratedProject(dir);
    const match = result.blockers.find(e => e.rule === 'REQUIRED_FILE_MISSING' && e.file === 'helpers/universal.ts');
    assert(!!match, `Expected REQUIRED_FILE_MISSING for helpers/universal.ts, got: ${JSON.stringify(result.blockers.map(e => e.rule + ':' + e.file))}`);
  } finally { cleanup(dir); }
});

// TEST 6 — Gate 06 catches garbled class name
await test('Gate 06: catches garbled class name', async () => {
  const dir = createTmpProject();
  try {
    fs.writeFileSync(path.join(dir, 'pages/GvvvGdmiqjccvc7cPage.ts'), `
import { Page } from '@playwright/test';
export class GvvvGdmiqjccvc7cPage {
  constructor(private readonly page: Page) {}
}
`);
    const result = await validateGeneratedProject(dir);
    const match = result.blockers.find(e => e.rule === 'GARBLED_CLASS_NAME');
    assert(!!match, `Expected GARBLED_CLASS_NAME blocker, got: ${JSON.stringify(result.blockers.map(e => e.rule))}`);
  } finally { cleanup(dir); }
});

// TEST 7 — Gate 07 catches real email in fixtures
await test('Gate 07: catches real email in fixture defaults', async () => {
  const dir = createTmpProject();
  try {
    fs.writeFileSync(path.join(dir, 'fixtures/test-data.ts'), `
export const testData = {
  baseUrl: process.env.BASE_URL || 'https://example.com',
  email: process.env.EMAIL || "user@gmail.com",
} as const;
`);
    const result = await validateGeneratedProject(dir);
    const match = result.blockers.find(e => e.rule === 'NO_REAL_EMAIL_IN_FIXTURE');
    assert(!!match, `Expected NO_REAL_EMAIL_IN_FIXTURE blocker, got: ${JSON.stringify(result.blockers.map(e => e.rule))}`);
  } finally { cleanup(dir); }
});

// TEST 9 — Gate 10 catches fullyParallel: false
await test('Gate 10: catches fullyParallel: false', async () => {
  const dir = createTmpProject();
  try {
    fs.writeFileSync(path.join(dir, 'playwright.config.ts'), `
import { defineConfig } from '@playwright/test';
export default defineConfig({ testDir: './tests', fullyParallel: false });
`);
    const result = await validateGeneratedProject(dir);
    const match = result.majors.find(e => e.rule === 'FULLPARALLEL_MUST_BE_TRUE');
    assert(!!match, `Expected FULLPARALLEL_MUST_BE_TRUE major, got: ${JSON.stringify(result.majors.map(e => e.rule))}`);
  } finally { cleanup(dir); }
});

// TEST 10 — Clean project passes all gates
await test('TEST 10: clean project passes all gates', async () => {
  const dir = createTmpProject();
  try {
    const result = await validateGeneratedProject(dir);
    // Gate 01 may fail without node_modules — skip it for this smoke test
    const nonTscErrors = result.blockers.filter(e => e.gate !== 'gate-01-typescript')
      .concat(result.majors.filter(e => e.gate !== 'gate-01-typescript'));
    assert(
      nonTscErrors.length === 0,
      `Expected no blockers/majors (ignoring tsc gate), got: ${JSON.stringify(nonTscErrors.map(e => `[${e.rule}] ${e.file}`))}`
    );
  } finally { cleanup(dir); }
});

// TEST 11 — Retry loop terminates after MAX_RETRIES
await test('TEST 11: retry loop terminates after 3 attempts', async () => {
  let callCount = 0;
  const fakeSession: RecordingSession = { id: 'test', startUrl: 'https://example.com', testName: 'test', nlSteps: [] };

  // generateFn always produces a project with a missing required file (blocker)
  const generateFn = async (_sess: RecordingSession, _ctx?: string): Promise<string> => {
    callCount++;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nat20-retry-test-'));
    // Create just enough to pass most gates but missing helpers/universal.ts
    fs.mkdirSync(path.join(dir, 'helpers'), { recursive: true });
    // Don't write helpers/universal.ts → Gate 05 fires
    return dir;
  };

  try {
    await generateWithValidation(fakeSession, generateFn);
    assert(false, 'Expected GenerationValidationError to be thrown');
  } catch (e: any) {
    assert(e instanceof GenerationValidationError, `Expected GenerationValidationError, got ${e.constructor.name}`);
    assert(callCount === 3, `Expected exactly 3 attempts, got ${callCount}`);
  }
});

// TEST 12 — Retry loop injects error context on second attempt
await test('TEST 12: retryContext injected on second attempt', async () => {
  let secondCallContext: string | undefined = 'NOT_SET';
  let callCount = 0;
  const fakeSession: RecordingSession = { id: 'test', startUrl: 'https://example.com', testName: 'test', nlSteps: [] };

  const generateFn = async (_sess: RecordingSession, ctx?: string): Promise<string> => {
    callCount++;
    if (callCount === 2) secondCallContext = ctx;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nat20-ctx-test-'));
    fs.mkdirSync(path.join(dir, 'helpers'), { recursive: true });
    // Trigger Gate 05 blocker on every call
    return dir;
  };

  try {
    await generateWithValidation(fakeSession, generateFn);
  } catch {
    // expected
  }

  assert(callCount >= 2, `Expected at least 2 attempts, got ${callCount}`);
  assert(
    secondCallContext !== undefined && secondCallContext !== 'NOT_SET' && secondCallContext.length > 0,
    `Expected non-empty retryContext on second call, got: "${secondCallContext}"`
  );
  assert(
    secondCallContext!.includes('REQUIRED_FILE_MISSING') || secondCallContext!.includes('BLOCKER') || secondCallContext!.includes('helpers'),
    `retryContext should mention the error, got: "${secondCallContext}"`
  );
});

// ─── Summary ──────────────────────────────────────────────────────────────────

const passed = results.filter(r => r.ok).length;
const failed = results.filter(r => !r.ok).length;
console.log(`\n${'─'.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed out of ${results.length} tests`);

if (failed > 0) {
  console.error('\nFailed tests:');
  results.filter(r => !r.ok).forEach(r => console.error(`  • ${r.name}: ${r.error}`));
  process.exit(1);
} else {
  console.log('All tests passed ✅');
}
