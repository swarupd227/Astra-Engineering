import { Page } from '@playwright/test';
import { AgileDevelopmentPageLocators } from '../locators/Agile-developmentPage.locators';
import { smartFill, smartClick, smartCheck, smartUncheck } from '../helpers/universal';
export class AgileDevelopmentPage {
  private page: Page;
  private L: typeof AgileDevelopmentPageLocators;
  constructor(page: Page) {
    this.page = page;
    this.L = AgileDevelopmentPageLocators;
  }
  async clickInHouseDevelopedFrameworkAnd() {
    await smartClick(this.L.inHouseDevelopedFrameworkAndButton(this.page));
  }
  async clickBestInClassAgileTools() {
    await smartClick(this.L.bestInClassAgileToolsButton(this.page));
  }
  async clickAboutUs() {
    await smartClick(this.L.aboutUsLink(this.page));
  }
}
