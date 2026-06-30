import { type Page, type Locator } from '@playwright/test';
import { BasePage } from '../base/BasePage';

/**
 * Page Object for the Home / Dashboard page.
 */
export class HomePage extends BasePage {
  readonly heading: Locator;
  readonly navMenu: Locator;
  readonly userGreeting: Locator;
  readonly logoutButton: Locator;
  readonly searchInput: Locator;
  readonly searchButton: Locator;

  constructor(page: Page) {
    super(page);
    this.heading      = page.locator('h1, [data-testid="page-heading"]').first();
    this.navMenu      = page.locator('nav, [role="navigation"]').first();
    this.userGreeting = page.locator('[data-testid="user-greeting"], .user-name, .greeting').first();
    this.logoutButton = page.locator('button:has-text("Logout"), a:has-text("Logout"), a:has-text("Sign out")').first();
    this.searchInput  = page.locator('input[type="search"], input[placeholder*="Search"]').first();
    this.searchButton = page.locator('button[type="submit"]:near(input[type="search"])').first();
  }

  async getHeading(): Promise<string> {
    return this.getText(this.heading);
  }

  async logout(): Promise<void> {
    await this.clickElement(this.logoutButton);
    await this.waitForNavigation();
  }

  async search(term: string): Promise<void> {
    await this.fillInput(this.searchInput, term);
    await this.clickElement(this.searchButton);
    await this.waitForNavigation().catch(() => {});
  }
}
