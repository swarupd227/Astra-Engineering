import { test, expect } from '../../base/BaseTest';
import { VALID_USER, INVALID_USER } from '../../data/TestData';

/**
 * Login Page — Smoke Tests (@smoke)
 * Fast, critical-path verification of core login functionality.
 */
test.describe('Login Page — Smoke @smoke', () => {
  test.beforeEach(async ({ loginPage }) => {
    await loginPage.navigate('/login');
  });

  test('page loads with required elements visible', async ({ loginPage }) => {
    await expect(loginPage.usernameField).toBeVisible();
    await expect(loginPage.passwordField).toBeVisible();
    await expect(loginPage.loginButton).toBeVisible();
  });

  test('valid credentials redirect to dashboard', async ({ loginPage, page }) => {
    await loginPage.loginWith(VALID_USER);
    await expect(page).toHaveURL(/dashboard|home/i, { timeout: 15_000 });
  });

  test('invalid credentials stay on login and show error', async ({
    loginPage,
    page,
  }) => {
    await loginPage.loginWith(INVALID_USER);
    await expect(page).toHaveURL(/login/i);
    const errorVisible = await loginPage.isErrorVisible();
    expect(errorVisible).toBe(true);
  });
});
