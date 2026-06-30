import { Page } from '@playwright/test';

export const CompanyPageLocators = {
  // Uniqueness: verify | Stability: stable — XPath locator | Fallback: see all strategies in object repository
  contactUsLink: (page: Page) => page.locator('xpath=//a[normalize-space(text())=\'Contact Us\']').filter({ visible: true }).first(),
};
