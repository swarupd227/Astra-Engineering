import { Page, BrowserContext, Locator } from '@playwright/test';

const CONSENT_SELECTORS = [
  '#onetrust-accept-btn-handler','#onetrust-pc-btn-handler',
  '#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll','#CybotCookiebotDialogBodyButtonAccept',
  '.trustarc-agree-btn','.qc-cmp2-summary-buttons button:first-child',
  '.osano-cm-accept-all','#didomi-notice-agree-button','.fc-button.fc-cta-consent',
  'button[data-testid="uc-accept-all-button"]','#axeptio_btn_acceptAll','.cky-btn-accept',
  '#iubenda-cs-accept-btn','.klaro button.cm-btn-accept-all',
  'button[id*="accept"][id*="cookie" i]','button[class*="accept-all" i]',
  'button[class*="acceptAll" i]','[aria-label*="Accept all" i]',
];
const CONSENT_XPATH = [
  "//button[translate(normalize-space(.),'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz')='accept all cookies']",
  "//button[translate(normalize-space(.),'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz')='accept all']",
  "//button[translate(normalize-space(.),'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz')='allow all']",
  "//button[translate(normalize-space(.),'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz')='i agree']",
  "//button[translate(normalize-space(.),'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz')='got it']",
  "//a[translate(normalize-space(.),'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz')='accept all cookies']",
];
export async function dismissOverlays(page: Page): Promise<void> {
  for (const s of CONSENT_SELECTORS) { try { const el=page.locator(s).first(); if(await el.isVisible({timeout:800})){await el.click({timeout:3000});await page.waitForTimeout(600);return;} } catch{} }
  for (const x of CONSENT_XPATH) { try { const el=page.locator('xpath='+x).first(); if(await el.isVisible({timeout:400})){await el.click({timeout:2000});await page.waitForTimeout(600);return;} } catch{} }
}
export async function dismissPopups(page: Page): Promise<void> {
  const sels=['[role="dialog"] button[aria-label*="close" i]','[role="dialog"] button[class*="close" i]','.modal button[class*="close" i]','.popup button[class*="close" i]'];
  for(const s of sels){try{const el=page.locator(s).first();if(await el.isVisible({timeout:400})){await el.click({timeout:2000});await page.waitForTimeout(400);}}catch{}}
}
export async function waitForStableURL(page: Page, ms=15000): Promise<string> {
  let last='',stable=0,deadline=Date.now()+ms;
  while(Date.now()<deadline){await page.waitForTimeout(300);const u=page.url();if(u!=='about:blank'&&u===last){stable++;if(stable>=4)return u;}else{stable=0;last=u;}}
  return page.url();
}
export async function waitForPageReady(page: Page): Promise<void> {
  await page.waitForLoadState('domcontentloaded').catch(()=>{});
  await waitForStableURL(page,10000);
  await page.waitForLoadState('networkidle',{timeout:8000}).catch(()=>{});
}
export async function clickNewTab(context: BrowserContext, locator: Locator): Promise<Page> {
  const [newTab]=await Promise.all([context.waitForEvent('page',{timeout:15000}),locator.click()]);
  await newTab.waitForLoadState('domcontentloaded').catch(()=>{});
  await waitForStableURL(newTab,10000);
  return newTab as Page;
}
export async function hoverAndWait(locator: Locator, waitMs=600): Promise<void> {
  await locator.hover(); await locator.page().waitForTimeout(waitMs);
}
export async function smartClick(locator: Locator): Promise<void> {
  await locator.click();
}
export async function smartFill(locator: Locator, value: string): Promise<void> {
  await locator.fill(value);
}
export async function smartCheck(locator: Locator): Promise<void> {
  await locator.check();
}
export async function smartUncheck(locator: Locator): Promise<void> {
  await locator.uncheck();
}
export async function tryLocators(page: Page, locators: string[], action: 'click'|'fill'|'check'='click', value?: string): Promise<boolean> {
  for(const loc of locators){try{const el=page.locator(loc).first();if(!(await el.isVisible({timeout:2000})))continue;if(action==='click')await el.click();else if(action==='fill'&&value)await el.fill(value);else if(action==='check')await (el as any).check();return true;}catch{}}return false;
}
export async function prepareSite(page: Page): Promise<void> {
  await waitForPageReady(page);
  await dismissOverlays(page);
  await dismissPopups(page);
}
