import { Page } from '@playwright/test';

export const WwwPageLocators = {
  // Uniqueness: verify | Stability: stable — XPath locator | Fallback: see all strategies in object repository
  learnMoreLink: (page: Page) => page.locator('xpath=//a[normalize-space(text())=\'Learn More\']').filter({ visible: true }).first(),
  contactUsLink: (page: Page) => page.locator('xpath=//a[normalize-space(text())=\'Contact Us\']').filter({ visible: true }).first(),
  aboutUsLink: (page: Page) => page.locator('xpath=//a[normalize-space(text())=\'About Us\']').filter({ visible: true }).first(),
};
