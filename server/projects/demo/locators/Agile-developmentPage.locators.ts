import { Page } from '@playwright/test';

export const AgileDevelopmentPageLocators = {
  // Uniqueness: verify | Stability: stable — XPath locator | Fallback: see all strategies in object repository
  inHouseDevelopedFrameworkAndButton: (page: Page) => page.locator('xpath=//button[normalize-space(text())=\'In-house developed framework and metrics\']').filter({ visible: true }).first(),
  // Uniqueness: verify | Stability: stable — XPath locator | Fallback: see all strategies in object repository
  bestInClassAgileToolsButton: (page: Page) => page.locator('xpath=//button[normalize-space(text())=\'Best-in-class Agile tools\']').filter({ visible: true }).first(),
  // Uniqueness: verify | Stability: stable — XPath locator | Fallback: see all strategies in object repository
  aboutUsLink: (page: Page) => page.locator('xpath=//a[normalize-space(text())=\'About Us\']').filter({ visible: true }).first(),
  contactUsLink: (page: Page) => page.locator('xpath=//a[normalize-space(text())=\'Contact Us\']').filter({ visible: true }).first(),
};
