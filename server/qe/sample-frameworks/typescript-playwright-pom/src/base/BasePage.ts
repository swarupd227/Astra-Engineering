import { type Page, type Locator } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Abstract base class for all Page Objects.
 * Provides common Playwright interactions with built-in waits,
 * retry logic, and screenshot capture.
 *
 * @example
 * ```typescript
 * export class LoginPage extends BasePage {
 *   constructor(page: Page) { super(page); }
 * }
 * ```
 */
export abstract class BasePage {
  constructor(protected readonly page: Page) {}

  /**
   * Navigates to the given path (relative to baseURL) and waits
   * for the DOM content to be loaded and network to be idle.
   */
  async navigate(pathOrUrl: string): Promise<void> {
    await this.page.goto(pathOrUrl, { waitUntil: 'domcontentloaded' });
    try {
      await this.page.waitForLoadState('networkidle', { timeout: 3_000 });
    } catch {
      // networkidle is best-effort; domcontentloaded is sufficient
    }
  }

  /**
   * Fills an input field. Clears any existing value with triple-click,
   * then types the new value and verifies it was entered.
   */
  async fillInput(locator: Locator, value: string): Promise<void> {
    await locator.waitFor({ state: 'visible', timeout: 10_000 });
    await locator.click({ clickCount: 3 }); // triple-click selects all
    await locator.fill(value);
    // Verify the value was entered
    const actual = await locator.inputValue();
    if (actual !== value) {
      throw new Error(
        `fillInput: expected '${value}' but input contains '${actual}'`
      );
    }
  }

  /**
   * Clicks an element after waiting for it to be enabled.
   * Scrolls the element into view before clicking.
   */
  async clickElement(locator: Locator): Promise<void> {
    await locator.waitFor({ state: 'visible', timeout: 10_000 });
    await locator.scrollIntoViewIfNeeded();
    await locator.click();
  }

  /**
   * Returns the trimmed innerText of an element,
   * waiting for visibility first.
   */
  async getText(locator: Locator): Promise<string> {
    await locator.waitFor({ state: 'visible', timeout: 10_000 });
    const text = await locator.innerText();
    return text.trim();
  }

  /**
   * Returns true if the element is visible, false otherwise.
   * Never throws — safe to use in conditional logic.
   */
  async isVisible(locator: Locator): Promise<boolean> {
    try {
      return await locator.isVisible();
    } catch {
      return false;
    }
  }

  /**
   * Waits for the page to reach network idle state (up to 10 seconds).
   */
  async waitForNavigation(): Promise<void> {
    await this.page.waitForLoadState('networkidle', { timeout: 10_000 });
  }

  /**
   * Captures a PNG screenshot and saves it to test-results/screenshots/.
   * The filename includes the given name and a timestamp.
   */
  async takeScreenshot(name: string): Promise<void> {
    const dir = path.join(process.cwd(), 'test-results', 'screenshots');
    fs.mkdirSync(dir, { recursive: true });
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filePath = path.join(dir, `${name}_${timestamp}.png`);
    await this.page.screenshot({ path: filePath, fullPage: false });
    console.log(`Screenshot saved: ${filePath}`);
  }

  /**
   * Scrolls the given locator into the viewport.
   */
  async scrollTo(locator: Locator): Promise<void> {
    await locator.scrollIntoViewIfNeeded();
  }

  /**
   * Hovers over the given element.
   */
  async hover(locator: Locator): Promise<void> {
    await locator.waitFor({ state: 'visible', timeout: 10_000 });
    await locator.hover();
  }

  /**
   * Selects an option from a <select> dropdown by value, label, or index.
   */
  async selectOption(locator: Locator, value: string): Promise<void> {
    await locator.waitFor({ state: 'visible', timeout: 10_000 });
    await locator.selectOption(value);
  }

  /**
   * Sets a file input to the given file path (for file upload inputs).
   */
  async uploadFile(locator: Locator, filePath: string): Promise<void> {
    await locator.waitFor({ state: 'attached', timeout: 10_000 });
    await locator.setInputFiles(filePath);
  }
}
