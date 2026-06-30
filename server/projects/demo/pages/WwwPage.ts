import { Page } from '@playwright/test';
import { WwwPageLocators } from '../locators/WwwPage.locators';
import { smartFill, smartClick, smartCheck, smartUncheck } from '../helpers/universal';
export class WwwPage {
  private page: Page;
  private L: typeof WwwPageLocators;
  constructor(page: Page) {
    this.page = page;
    this.L = WwwPageLocators;
  }
  async clickLearnMore() {
    await smartClick(this.L.learnMoreLink(this.page));
  }
}
