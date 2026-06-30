import { defineConfig } from '@playwright/test';
import * as dotenv from 'dotenv';
dotenv.config({ path: '../../.env' }); // Load root .env for TEST_PASSWORD etc.

export default defineConfig({
  testDir: './tests',
  timeout: 180_000,
  retries: 0,
  reporter: 'list',
  use: {
    headless: false,
    viewport: null,
    launchOptions: {
      args: [
        '--start-maximized',
        '--disable-blink-features=AutomationControlled',
        '--no-sandbox',
        '--disable-infobars',
      ],
    },
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
});
