import { type Page, type Locator } from '@playwright/test';
import { BasePage } from '../base/BasePage';

export interface LoginData {
  username: string;
  password: string;
}

/**
 * Page Object for the Login page.
 * All locators are defined as readonly class properties.
 *
 * @example
 * ```typescript
 * const loginPage = new LoginPage(page);
 * await loginPage.navigate('/login');
 * await loginPage.loginWith({ username: 'user@example.com', password: 'pass' });
 * ```
 */
export class LoginPage extends BasePage {
  // ── Locators ────────────────────────────────────────────────────────────────
  readonly usernameField: Locator;
  readonly passwordField: Locator;
  readonly loginButton: Locator;
  readonly errorMessage: Locator;
  readonly successMessage: Locator;
  readonly rememberMeCheckbox: Locator;
  readonly forgotPasswordLink: Locator;

  constructor(page: Page) {
    super(page);
    this.usernameField      = page.locator('#username, input[name="username"], input[type="email"]').first();
    this.passwordField      = page.locator('#password, input[name="password"], input[type="password"]').first();
    this.loginButton        = page.locator('button[type="submit"], input[type="submit"], button:has-text("Login"), button:has-text("Sign In")').first();
    this.errorMessage       = page.locator('.error-message, .alert-danger, [data-testid="error-message"]').first();
    this.successMessage     = page.locator('.flash-message, .alert-success, [data-testid="success-message"]').first();
    this.rememberMeCheckbox = page.locator('input[type="checkbox"][name*="remember"]').first();
    this.forgotPasswordLink = page.locator('a:has-text("Forgot"), a:has-text("Reset")').first();
  }

  // ── Actions ─────────────────────────────────────────────────────────────────

  /**
   * Fills username and password fields, then clicks the submit button.
   */
  async loginWith(data: LoginData): Promise<void> {
    await this.enterUsername(data.username);
    await this.enterPassword(data.password);
    await this.submit();
  }

  async enterUsername(value: string): Promise<void> {
    await this.fillInput(this.usernameField, value);
  }

  async enterPassword(value: string): Promise<void> {
    await this.fillInput(this.passwordField, value);
  }

  async submit(): Promise<void> {
    await this.clickElement(this.loginButton);
    await this.waitForNavigation().catch(() => {
      // navigation may not occur on failed login — that is expected
    });
  }

  async getErrorMessage(): Promise<string> {
    return this.getText(this.errorMessage);
  }

  async isErrorVisible(): Promise<boolean> {
    return this.isVisible(this.errorMessage);
  }
}
