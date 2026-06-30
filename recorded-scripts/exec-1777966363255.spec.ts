import { test, expect } from '@playwright/test';
import { prepareSite, waitForPageReady, clickNewTab, hoverAndWait, tryLocators, smartFill, smartClick, smartCheck, smartUncheck } from '../helpers/universal';
import { selectKendoDropdown, selectKendoDate, checkKendoTreeNode, waitAndDismissAnyKendoAlert, fillKendoGridDates } from '../helpers/kendo';

test('Recorded flow', async ({ page, context }) => {
  // ─── Object Repository (auto-captured during recording) ─────────────────
  // Edit locators here — all test steps reference these named variables.
  const L = {
    aboutUsLink         : page.locator('xpath=//a[normalize-space(text())=\'About Us\']').filter({ visible: true }).first(),
    //  ↳ [link-text] xpath: //a[normalize-space(text())='About Us']
    //  ↳ [relative-structural] xpath: //*[@id='menu-item-2264']//a[normalize-space(text())='About Us']
    contactUsLink       : page.locator('xpath=//a[normalize-space(text())=\'Contact Us\']').filter({ visible: true }).first(),
    //  ↳ [link-text] xpath: //a[normalize-space(text())='Contact Us']
    //  ↳ [relative-structural] xpath: //*[@id='menu-item-2271']//a[normalize-space(text())='Contact Us']
    p17329859533        : page.locator('xpath=//*[@id=\'contact-us-column\']//p').filter({ visible: true }).first(),
    //  ↳ [relative-structural] xpath: //*[@id='contact-us-column']//p
  };

  await page.goto('https://nousinfosystems.com');
  await prepareSite(page); // dismiss overlays, wait for URL stability

  await page.waitForURL('**https://www.nousinfosystems.com/', { waitUntil: 'domcontentloaded' });
  const iframeOn_www_nousinfosystems_com = page.frameLocator('iframe[src*="https://www.nousinfosystems.com"]');
  await smartClick(L.aboutUsLink);
  await waitForPageReady(page);
  await smartClick(L.contactUsLink);
  await waitForPageReady(iframeOn_www_nousinfosystems_com);
  await smartClick(L.p17329859533);
  await expect(page.getByText('+1 732 985 9533', { exact: false }).first()).toBeVisible();
});