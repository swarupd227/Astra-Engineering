import { type Page, type Locator } from '@playwright/test';

/**
 * Security test helpers for common web vulnerability checks.
 */
export class SecurityHelper {
  /**
   * Tests an input field against a list of XSS payloads.
   * Asserts that none of the payloads execute in the browser context.
   *
   * @param page     the Playwright page
   * @param payloads list of XSS strings to test
   * @param locator  the input field to test against
   */
  static async assertNoXSSExecution(
    page: Page,
    payloads: string[],
    locator: Locator
  ): Promise<void> {
    for (const payload of payloads) {
      // Inject XSS marker before submitting
      await page.evaluate(() => {
        (window as any).__xss_triggered = false;
        const origAlert = window.alert;
        window.alert = () => { (window as any).__xss_triggered = true; };
        setTimeout(() => { window.alert = origAlert; }, 2000);
      });

      await locator.waitFor({ state: 'visible', timeout: 5_000 });
      await locator.click({ clickCount: 3 });
      await locator.fill(payload);

      await page.waitForTimeout(500);

      const triggered = await page.evaluate(
        () => (window as any).__xss_triggered === true
      );
      if (triggered) {
        throw new Error(`XSS payload executed: ${payload}`);
      }
    }
  }

  /**
   * Asserts the page body does not contain database error strings
   * that could indicate SQL injection vulnerability or misconfiguration.
   */
  static async assertNoDBErrorExposed(page: Page): Promise<void> {
    const bodyText = (await page.locator('body').innerText()).toLowerCase();

    const errorPatterns = [
      'sql syntax',
      'mysql_error',
      'ora-',
      'pg::',
      'sqlite3',
      'syntax error near',
      'unclosed quotation mark',
      'database error',
      'pdoexception',
      'sqlstate',
      'stack trace',
      'internal server error',
      'exception in thread',
    ] as const;

    const found = errorPatterns.filter((p) => bodyText.includes(p));

    if (found.length > 0) {
      throw new Error(
        `DB/server error strings exposed in page body: ${found.join(', ')}`
      );
    }
  }
}
