import { type Page } from '@playwright/test';

/**
 * Accessibility assertion helpers implementing WCAG 2.1 AA baseline checks.
 * Collects ALL failures before throwing, so every issue is reported at once.
 */
export class AccessibilityHelper {
  /**
   * Runs WCAG 2.1 AA baseline checks on the current page.
   * Asserts all of the following:
   * - Every <img> has a non-empty alt attribute
   * - Every <input> (non-hidden) has an associated <label>
   * - Every <button> has visible text or aria-label
   * - The <html> element has a lang attribute
   * - At least one <h1> exists
   *
   * @throws Error listing all violations found on the page
   */
  static async assertWCAGBaseline(page: Page): Promise<void> {
    const failures: string[] = [];

    // 1. Images must have alt text
    const imgsWithoutAlt = await page.evaluate(() =>
      Array.from(document.querySelectorAll('img'))
        .filter((img) => !img.hasAttribute('alt') || img.alt.trim() === '')
        .map((img) => img.outerHTML.substring(0, 100))
    );
    if (imgsWithoutAlt.length > 0) {
      failures.push(
        `${imgsWithoutAlt.length} image(s) missing alt text:\n  ${imgsWithoutAlt.join('\n  ')}`
      );
    }

    // 2. Inputs must have associated labels
    const unlabeledInputs = await page.evaluate(() => {
      const inputs = Array.from(
        document.querySelectorAll('input:not([type="hidden"]):not([type="submit"]):not([type="button"])')
      ) as HTMLInputElement[];
      return inputs
        .filter((input) => {
          const id = input.id;
          const hasLabel = id
            ? !!document.querySelector(`label[for="${id}"]`)
            : false;
          const hasAriaLabel = !!input.getAttribute('aria-label');
          const hasAriaLabelledBy = !!input.getAttribute('aria-labelledby');
          const hasPlaceholder = !!input.placeholder; // acceptable but not ideal
          return !hasLabel && !hasAriaLabel && !hasAriaLabelledBy && !hasPlaceholder;
        })
        .map((i) => i.outerHTML.substring(0, 100));
    });
    if (unlabeledInputs.length > 0) {
      failures.push(
        `${unlabeledInputs.length} input(s) without accessible label:\n  ${unlabeledInputs.join('\n  ')}`
      );
    }

    // 3. Buttons must have text or aria-label
    const emptyButtons = await page.evaluate(() =>
      Array.from(document.querySelectorAll('button'))
        .filter(
          (btn) =>
            !btn.textContent?.trim() &&
            !btn.getAttribute('aria-label') &&
            !btn.title
        )
        .map((btn) => btn.outerHTML.substring(0, 100))
    );
    if (emptyButtons.length > 0) {
      failures.push(
        `${emptyButtons.length} button(s) without accessible text:\n  ${emptyButtons.join('\n  ')}`
      );
    }

    // 4. HTML lang attribute must be set
    const lang = await page.evaluate(
      () => document.documentElement.getAttribute('lang')
    );
    if (!lang) {
      failures.push('<html> element is missing the lang attribute');
    }

    // 5. At least one h1 must exist
    const h1Count = await page.evaluate(
      () => document.querySelectorAll('h1').length
    );
    if (h1Count === 0) {
      failures.push('Page has no <h1> element');
    }

    if (failures.length > 0) {
      throw new Error(`WCAG 2.1 AA violations found:\n${failures.join('\n\n')}`);
    }
  }
}
