import { Page } from '@playwright/test';
import { ContactUsPageLocators } from '../locators/Contact-usPage.locators';
import { smartFill, smartClick, smartCheck, smartUncheck } from '../helpers/universal';
export class ContactUsPage {
  private page: Page;
  private L: typeof ContactUsPageLocators;
  constructor(page: Page) {
    this.page = page;
    this.L = ContactUsPageLocators;
  }
  async fillName(value: string) {
    await smartFill(this.L.nameInput(this.page), value);
  }
  async fillEmail(value: string) {
    await smartFill(this.L.emailInput(this.page), value);
  }
  async fillCompanyName(value: string) {
    await smartFill(this.L.companyNameInput(this.page), value);
  }
  async enableCheckbox815() {
    await smartCheck(this.L.checkbox815Checkbox(this.page));
  }
}
