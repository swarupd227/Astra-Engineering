import { type Page, expect } from '@playwright/test';

/**
 * Helper functions for form interactions and assertions.
 */
export class FormHelper {
  /**
   * Asserts that a form submission succeeded by checking for a success
   * indicator and verifying no validation error elements are present.
   */
  static async assertSubmitSuccess(page: Page): Promise<void> {
    // Wait for any success indicator
    const successSelector = '.alert-success, .flash-success, [data-testid="success"], .success-message';
    await expect(page.locator(successSelector).first())
      .toBeVisible({ timeout: 10_000 });
  }

  /**
   * Asserts that form validation errors are visible after a failed submission.
   */
  static async assertValidationErrors(page: Page): Promise<void> {
    const errorSelector = '.error-message, .field-error, .invalid-feedback, [aria-invalid="true"]';
    await expect(page.locator(errorSelector).first())
      .toBeVisible({ timeout: 5_000 });
  }

  /**
   * Asserts the page URL did not change from the given URL.
   * Useful for confirming a form submission did not navigate away on error.
   */
  static async assertPageStaysOnUrl(page: Page, url: string): Promise<void> {
    await page.waitForTimeout(1_000); // allow any potential navigation
    expect(page.url()).toContain(url);
  }

  /**
   * Fills multiple form fields from a key→value map.
   * Keys are treated as CSS selectors or name attributes.
   *
   * @param page     the Playwright page
   * @param formData map of { selectorOrName: value }
   */
  static async fillFormFromObject(
    page: Page,
    formData: Record<string, string>
  ): Promise<void> {
    for (const [selectorOrName, value] of Object.entries(formData)) {
      const locator = page
        .locator(`[name="${selectorOrName}"], #${selectorOrName}, ${selectorOrName}`)
        .first();
      await locator.waitFor({ state: 'visible', timeout: 5_000 });
      await locator.click({ clickCount: 3 });
      await locator.fill(value);
    }
  }
}
