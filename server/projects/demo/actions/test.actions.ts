import { Page } from '@playwright/test';

import { prepareSite } from '../helpers/universal';
import { selectKendoDropdown, selectKendoDate, waitAndDismissAnyKendoAlert, fillKendoGridDates } from '../helpers/kendo';

export async function executetestWorkflow(
  page: Page,
  data: Record<string, any>
) {
  await page.goto(data.startUrl || 'http://localhost:4000/api/recorder/browse?url=https%3A%2F%2Fwww.nousinfosystems.com%2F');
  await prepareSite(page);

}
