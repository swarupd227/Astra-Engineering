import { Page } from '@playwright/test';
import { CompanyPageLocators } from '../locators/CompanyPage.locators';
import { smartFill, smartClick, smartCheck, smartUncheck } from '../helpers/universal';
export class CompanyPage {
  private page: Page;
  private L: typeof CompanyPageLocators;
  constructor(page: Page) {
    this.page = page;
    this.L = CompanyPageLocators;
  }
  async clickContactUs() {
    await smartClick(this.L.contactUsLink(this.page));
  }
}
