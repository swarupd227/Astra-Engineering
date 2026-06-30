import { test as base, expect } from '@playwright/test';
import { LoginPage } from '../pages/LoginPage';
import { HomePage } from '../pages/HomePage';

/**
 * Extended Playwright test fixture.
 * Provides pre-constructed page objects to all tests.
 *
 * @example
 * ```typescript
 * import { test, expect } from '@fixtures/BaseTest';
 *
 * test('login works', async ({ loginPage }) => {
 *   await loginPage.navigate('/login');
 *   await loginPage.loginWith({ username: 'user', password: 'pass' });
 *   await expect(loginPage.page).toHaveURL(/dashboard/);
 * });
 * ```
 */
export const test = base.extend<{
  loginPage: LoginPage;
  homePage: HomePage;
}>({
  loginPage: async ({ page }, use) => {
    const loginPage = new LoginPage(page);
    await use(loginPage);
  },

  homePage: async ({ page }, use) => {
    const homePage = new HomePage(page);
    await use(homePage);
  },
});

export { expect } from '@playwright/test';
