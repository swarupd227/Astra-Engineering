import { chromium, type FullConfig } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Global setup — runs once before all tests.
 * Verifies the baseURL is reachable and creates required directories.
 */
async function globalSetup(config: FullConfig): Promise<void> {
  const baseURL = config.projects[0]?.use?.baseURL || 'https://example.com';
  console.log(`\n[global-setup] Base URL: ${baseURL}`);

  // Create required directories
  const dirs = [
    path.join(process.cwd(), 'test-results', 'screenshots'),
    path.join(process.cwd(), 'allure-results'),
  ];
  for (const dir of dirs) {
    fs.mkdirSync(dir, { recursive: true });
    console.log(`[global-setup] Directory ready: ${dir}`);
  }

  // Verify baseURL is reachable
  const browser = await chromium.launch();
  const page = await browser.newPage();
  try {
    const response = await page.goto(baseURL, {
      waitUntil: 'domcontentloaded',
      timeout: 15_000,
    });
    if (!response || response.status() >= 500) {
      console.warn(
        `[global-setup] WARNING Base URL returned ${response?.status() ?? 'no response'}: ${baseURL}`
      );
    } else {
      console.log(
        `[global-setup] OK Base URL reachable (${response.status()}): ${baseURL}`
      );
    }
  } catch (err) {
    console.warn(`[global-setup] WARNING Could not reach base URL: ${err}`);
    // Do not throw — tests will report individual failures
  } finally {
    await browser.close();
  }

  console.log('[global-setup] Complete\n');
}

export default globalSetup;
