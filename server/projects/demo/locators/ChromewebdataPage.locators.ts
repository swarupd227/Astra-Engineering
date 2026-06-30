import { Page } from '@playwright/test';

export const ChromewebdataPageLocators = {
  // Uniqueness: verify | Stability: stable — XPath locator | Fallback: see all strategies in object repository
  hideAdvancedButton: (page: Page) => page.locator('xpath=//*[@id=\'details-button\']').filter({ visible: true }).first(),
  // Uniqueness: verify | Stability: stable — XPath locator | Fallback: see all strategies in object repository
  proceedToNousinfosystemsUnsaLink: (page: Page) => page.locator('xpath=//*[@id=\'proceed-link\']').filter({ visible: true }).first(),
};
