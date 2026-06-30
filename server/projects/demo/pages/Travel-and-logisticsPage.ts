import { Page } from '@playwright/test';
import { TravelAndLogisticsPageLocators } from '../locators/Travel-and-logisticsPage.locators';
import { smartFill, smartClick, smartCheck, smartUncheck } from '../helpers/universal';
export class TravelAndLogisticsPage {
  private page: Page;
  private L: typeof TravelAndLogisticsPageLocators;
  constructor(page: Page) {
    this.page = page;
    this.L = TravelAndLogisticsPageLocators;
  }
  async clickContactUs() {
    await smartClick(this.L.contactUsLink(this.page));
  }
}
