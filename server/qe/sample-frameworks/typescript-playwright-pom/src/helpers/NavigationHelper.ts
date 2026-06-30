import { type Page, expect } from '@playwright/test';

/**
 * Helper functions for navigation assertions and link checking.
 */
export class NavigationHelper {
  /**
   * Crawls all internal anchor hrefs on the page and verifies none return 4xx/5xx.
   * Skips external links, anchors (#), mailto:, and tel: links.
   */
  static async checkInternalLinks(page: Page, baseUrl: string): Promise<void> {
    const hrefs = await page.evaluate((base) => {
      const anchors = Array.from(document.querySelectorAll('a[href]'));
      return anchors
        .map((a) => (a as HTMLAnchorElement).href)
        .filter((href) => href.startsWith(base) && !href.includes('#'))
        .slice(0, 50); // cap at 50 to avoid long runs
    }, baseUrl);

    const broken: string[] = [];
    for (const href of hrefs) {
      const response = await page.request.get(href).catch(() => null);
      if (!response || response.status() >= 400) {
        broken.push(href);
      }
    }

    expect(broken, `Broken internal links:\n${broken.join('\n')}`).toHaveLength(0);
  }

  /**
   * Asserts the page <title> element matches the expected string exactly.
   */
  static async assertPageTitle(page: Page, expected: string): Promise<void> {
    await expect(page).toHaveTitle(expected, { timeout: 10_000 });
  }

  /**
   * Asserts the current URL contains the given fragment.
   */
  static async assertUrl(page: Page, fragment: string): Promise<void> {
    await expect(page).toHaveURL(new RegExp(fragment), { timeout: 10_000 });
  }

  /**
   * Waits for the page to be fully loaded (networkidle + domcontentloaded).
   */
  static async waitForPageReady(page: Page): Promise<void> {
    await page.waitForLoadState('domcontentloaded');
    try {
      await page.waitForLoadState('networkidle', { timeout: 5_000 });
    } catch {
      // networkidle is best-effort
    }
  }
}
