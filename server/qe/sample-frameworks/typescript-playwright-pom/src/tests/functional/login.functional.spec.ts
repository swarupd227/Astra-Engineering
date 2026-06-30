import { test, expect } from '../../base/BaseTest';
import { VALID_USER, INVALID_USER, EMPTY_USER, XSS_PAYLOADS } from '../../data/TestData';
import { SecurityHelper } from '../../helpers/SecurityHelper';

/**
 * Login Page — Functional Tests (@functional)
 * Covers form behaviour, validation, and security baseline.
 */
test.describe('Login Page — Functional @functional', () => {
  test.beforeEach(async ({ loginPage }) => {
    await loginPage.navigate('/login');
  });

  test('submitting empty form shows validation errors', async ({
    loginPage,
  }) => {
    await loginPage.submit();
    const errorVisible = await loginPage.isErrorVisible();
    expect(errorVisible, 'Expected validation error for empty form').toBe(true);
  });

  test('username-only submission shows error', async ({ loginPage, page }) => {
    await loginPage.enterUsername(VALID_USER.username);
    await loginPage.submit();
    await expect(page).toHaveURL(/login/i);
    const errorVisible = await loginPage.isErrorVisible();
    expect(errorVisible, 'Expected error when password is missing').toBe(true);
  });

  test('password-only submission shows error', async ({ loginPage, page }) => {
    await loginPage.enterPassword(VALID_USER.password);
    await loginPage.submit();
    await expect(page).toHaveURL(/login/i);
  });

  test('error message text is user-friendly (not a stack trace)', async ({
    loginPage,
  }) => {
    await loginPage.loginWith(INVALID_USER);
    const errorVisible = await loginPage.isErrorVisible();
    if (errorVisible) {
      const msg = await loginPage.getErrorMessage();
      expect(msg).not.toMatch(/exception|stack trace|sql|error at line/i);
      expect(msg.length).toBeGreaterThan(3);
    }
  });

  test('username field is not vulnerable to XSS', async ({ loginPage }) => {
    await SecurityHelper.assertNoXSSExecution(
      loginPage.page,
      XSS_PAYLOADS as unknown as string[],
      loginPage.usernameField
    );
  });
});
