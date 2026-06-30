import { Page } from '@playwright/test';
import { ChromewebdataPageLocators } from '../locators/ChromewebdataPage.locators';
import { smartFill, smartClick, smartCheck, smartUncheck } from '../helpers/universal';
export class ChromewebdataPage {
  private page: Page;
  private L: typeof ChromewebdataPageLocators;
  constructor(page: Page) {
    this.page = page;
    this.L = ChromewebdataPageLocators;
  }
  async clickHideAdvanced() {
    await smartClick(this.L.hideAdvancedButton(this.page));
  }
  async clickProceedToNousinfosystemsUnsa() {
    await smartClick(this.L.proceedToNousinfosystemsUnsaLink(this.page));
  }
}
