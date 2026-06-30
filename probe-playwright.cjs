const { execSync } = require('child_process');
const { mkdirSync, writeFileSync, readFileSync } = require('fs');
const { join } = require('path');
const os = require('os');

const workDir = join(os.tmpdir(), 'devx-test-debug-' + Date.now());
mkdirSync(join(workDir, 'tests'), { recursive: true });

writeFileSync(join(workDir, 'playwright.config.js'), `
const { defineConfig, devices } = require('playwright/test');
module.exports = defineConfig({
  testDir: './tests',
  timeout: 10000,
  workers: 1,
  reporter: [['json', { outputFile: './test-results.json' }]],
  use: { headless: true },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
`);

writeFileSync(join(workDir, 'tests', 'sample.spec.js'), `
const { test, expect } = require('@playwright/test');
test('DOM-TC-0001: sample test', async ({ page }) => {
  await page.goto('about:blank');
  expect(true).toBe(true);
});
`);

const resultsPath = join(workDir, 'test-results.json');

try {
  execSync(
    'node node_modules/playwright/cli.js test --config ' + join(workDir, 'playwright.config.js') + ' --reporter=json',
    {
      cwd: workDir,
      env: { ...process.env, PLAYWRIGHT_JSON_OUTPUT_NAME: resultsPath },
      timeout: 30000,
      stdio: 'pipe'
    }
  );
} catch(e) {}

const json = readFileSync(resultsPath, 'utf-8');
const parsed = JSON.parse(json);
console.log('=== TOP LEVEL KEYS:', Object.keys(parsed).join(', '));
const suite = (parsed.suites || parsed.results)?.[0];
if (suite) {
  console.log('=== SUITE KEYS:', Object.keys(suite).join(', '));
  console.log('=== SUITE TITLE:', suite.title);
  const spec = (suite.specs || suite.tests)?.[0];
  if (spec) {
    console.log('=== SPEC/TEST KEYS:', Object.keys(spec).join(', '));
    console.log('=== SPEC TITLE:', spec.title);
    const test = spec.tests?.[0];
    if (test) {
      console.log('=== TEST KEYS:', Object.keys(test).join(', '));
      const result = test.results?.[0];
      if (result) {
        console.log('=== RESULT KEYS:', Object.keys(result).join(', '));
        console.log('=== RESULT STATUS:', result.status);
      }
    }
  }
}
console.log('\n=== FULL JSON (first 1500 chars):\n', json.slice(0, 1500));
