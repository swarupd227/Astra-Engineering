import { Page } from '@playwright/test';

export const ContactUsPageLocators = {
  // Uniqueness: verify | Stability: stable — XPath locator | Fallback: see all strategies in object repository
  nameInput: (page: Page) => page.locator('xpath=//input[@name=\'your-name\']').filter({ visible: true }).first(),
  // Uniqueness: verify | Stability: stable — XPath locator | Fallback: see all strategies in object repository
  emailInput: (page: Page) => page.locator('xpath=//input[@name=\'your-email\']').filter({ visible: true }).first(),
  // Uniqueness: verify | Stability: stable — XPath locator | Fallback: see all strategies in object repository
  companyNameInput: (page: Page) => page.locator('xpath=//input[@name=\'your-subject\']').filter({ visible: true }).first(),
  // Uniqueness: verify | Stability: stable — XPath locator | Fallback: see all strategies in object repository
  checkbox815Checkbox: (page: Page) => page.locator('xpath=//input[@name=\'checkbox-815[]\']').filter({ visible: true }).first(),
  p17329859533: (page: Page) => page.locator('xpath=//*[@id=\'contact-us-column\']//p').filter({ visible: true }).first(),
  phone: (page: Page) => page.locator('xpath=//*[@id=\'contact-us-column\']//h3').filter({ visible: true }).first(),
};
