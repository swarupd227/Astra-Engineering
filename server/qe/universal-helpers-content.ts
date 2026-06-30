/**
 * Universal Test Helpers — injected into every generated project
 * Handles: consent overlays, popups, URL redirects, new tabs, hover menus, page readiness
 * Works on ANY website — no site-specific code.
 */

// ─── EXPORTED CONTENT (written as a file into every project) ──────────────────
export const UNIVERSAL_HELPERS_CONTENT = `import { Page, BrowserContext, Locator } from '@playwright/test';

// ─── Overlay / Cookie Consent Dismissal ──────────────────────────────────────
// Handles 20+ known consent frameworks + generic patterns
// Called automatically by prepareSite() — no manual calls needed

const CONSENT_SELECTORS = [
  // OneTrust (40%+ of enterprise sites: Microsoft, P&G, Nike, etc.)
  '#onetrust-accept-btn-handler',
  '#onetrust-pc-btn-handler',
  'button#onetrust-accept-btn-handler',
  // Cookiebot
  '#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll',
  '#CybotCookiebotDialogBodyButtonAccept',
  'a#CybotCookiebotDialogBodyLevelButtonAccept',
  // TrustArc / TRUSTe
  '.trustarc-agree-btn',
  'a.call', // TrustArc
  // Quantcast Choice
  '.qc-cmp2-summary-buttons button:first-child',
  '.qc-cmp2-ui button[mode="primary"]',
  // Osano
  '.osano-cm-accept-all',
  '.osano-cm-button--type_accept',
  // Didomi
  '#didomi-notice-agree-button',
  'button.didomi-btn-agree',
  // Google Funding Choices / IAB
  '.fc-button.fc-cta-consent',
  '.fc-cta-consent',
  // UserCentrics
  'button[data-testid="uc-accept-all-button"]',
  // Axeptio
  '#axeptio_btn_acceptAll',
  // Borlabs
  '#borlabs-cookie .cookie-accept',
  // CookieYes
  '.cky-btn-accept',
  // iubenda
  '#iubenda-cs-accept-btn',
  // Termly
  '#termly-code-snippet-support button[class*="accept"]',
  // Klaro
  '.klaro button.cm-btn-accept-all',
  // Civic Cookie Control
  '#ccc-recommended-settings',
  // Generic attribute-based patterns (broader, tried last)
  'button[id*="accept"][id*="cookie" i]',
  'button[id*="allow"][id*="cookie" i]',
  'button[class*="accept-all" i]',
  'button[class*="acceptAll" i]',
  'button[data-testid*="accept" i]',
  '[aria-label*="Accept all" i]',
  '[aria-label*="Accept cookies" i]',
];

const CONSENT_XPATH_PATTERNS = [
  // Case-insensitive text matching — catches any language/framework
  "//button[translate(normalize-space(.),'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz')='accept all cookies']",
  "//button[translate(normalize-space(.),'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz')='accept all']",
  "//button[translate(normalize-space(.),'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz')='allow all cookies']",
  "//button[translate(normalize-space(.),'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz')='allow all']",
  "//button[translate(normalize-space(.),'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz')='i agree']",
  "//button[translate(normalize-space(.),'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz')='agree']",
  "//button[translate(normalize-space(.),'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz')='got it']",
  "//button[translate(normalize-space(.),'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz')='ok']",
  "//button[translate(normalize-space(.),'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz')='continue']",
  "//a[translate(normalize-space(.),'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz')='accept all cookies']",
  "//a[translate(normalize-space(.),'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz')='accept all']",
];

export async function dismissOverlays(page: Page, timeoutMs = 6000): Promise<void> {
  // Try known frameworks first (fast, specific)
  for (const selector of CONSENT_SELECTORS) {
    try {
      const el = page.locator(selector).first();
      if (await el.isVisible({ timeout: 800 })) {
        await el.click({ timeout: 3000 });
        await page.waitForTimeout(600);
        return;
      }
    } catch { /* not present, try next */ }
  }
  // Try generic XPath patterns (catches anything missed above)
  for (const xpath of CONSENT_XPATH_PATTERNS) {
    try {
      const el = page.locator('xpath=' + xpath).first();
      if (await el.isVisible({ timeout: 400 })) {
        await el.click({ timeout: 2000 });
        await page.waitForTimeout(600);
        return;
      }
    } catch { /* not present */ }
  }
}

// ─── Popup / Chat Widget Dismissal ───────────────────────────────────────────
// Handles: newsletter popups, Intercom, Zendesk, Drift, survey prompts
const POPUP_SELECTORS = [
  // Generic modal close buttons
  '[role="dialog"] button[aria-label*="close" i]',
  '[role="dialog"] button[aria-label*="dismiss" i]',
  '[role="dialog"] button[class*="close" i]',
  '.modal button[class*="close" i]',
  '.popup button[class*="close" i]',
  '.overlay button[class*="close" i]',
  // Intercom
  'button[aria-label="Close"]',
  '.intercom-launcher-badge-count',
  // Zendesk
  'button[data-garden-id*="close" i]',
  '#launcher',
  // Drift
  '#drift-widget-container button',
  // Klaviyo popup
  '.needsclick.kl-private-reset-css-Xuajs1 button[class*="close" i]',
  // Privy
  '[data-testid="PrivyCloseButton"]',
];

export async function dismissPopups(page: Page): Promise<void> {
  for (const selector of POPUP_SELECTORS) {
    try {
      const el = page.locator(selector).first();
      if (await el.isVisible({ timeout: 400 })) {
        await el.click({ timeout: 2000 });
        await page.waitForTimeout(400);
      }
    } catch { /* not present */ }
  }
}

// ─── URL Stabilization ───────────────────────────────────────────────────────
// Waits for redirect chains to settle (pg.com → us.pg.com, SSO redirects, etc.)
export async function waitForStableURL(page: Page, timeoutMs = 15000): Promise<string> {
  let lastUrl = '';
  let stableCount = 0;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await page.waitForTimeout(300);
    const url = page.url();
    if (url !== 'about:blank' && url === lastUrl) {
      stableCount++;
      if (stableCount >= 4) return url; // stable for 1.2s
    } else {
      stableCount = 0;
      lastUrl = url;
    }
  }
  return page.url();
}

// ─── Prime Lazy-Reveal Observers ─────────────────────────────────────────────
// Many marketing pages (Hilti, Bosch, Apple, etc.) use IntersectionObserver to
// lazily fade-in / unhide cards as they enter the viewport — the markup goes
// from visibility:hidden / opacity:0 to visible only AFTER the viewer scrolls
// near them. Until that happens, Playwright sees those elements as
// .visible === false, so .filter({ visible: true }) returns zero matches and
// any click below the fold waits until the test timeout fires (~180s) with a
// misleading "Target page has been closed" error.
//
// This helper does a fast top-to-bottom scroll in viewport-sized steps so
// every IntersectionObserver on the page fires once, then returns to the top
// before the test continues. ~300-500ms total per call, run once per
// waitForPageReady so it covers the initial page load and every subsequent
// navigation.
export async function primeLazyReveals(page: Page): Promise<void> {
  try {
    await page.evaluate(async () => {
      const step = Math.max(window.innerHeight, 600);
      const max = Math.max(document.body.scrollHeight, document.documentElement.scrollHeight);
      for (let pos = 0; pos < max; pos += step) {
        window.scrollTo(0, pos);
        await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r as any)));
      }
      window.scrollTo(0, 0);
      await new Promise(r => setTimeout(r, 120));
    });
  } catch { /* page closed or detached — caller will surface a clearer error */ }
}

// ─── Smart Page Ready ────────────────────────────────────────────────────────
// Replaces waitForLoadState('domcontentloaded') — handles SPAs, redirects
export async function waitForPageReady(page: Page): Promise<void> {
  await page.waitForLoadState('domcontentloaded').catch(() => {});
  await waitForStableURL(page, 10000);
  await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
  // Trigger lazy-reveal IntersectionObservers so below-the-fold elements
  // (e.g. Hilti's "Current promotions" card with the "Start saving" link)
  // become Playwright-visible before any locator filter({ visible: true })
  // is evaluated.
  await primeLazyReveals(page);
}

// ─── New Tab Handler ─────────────────────────────────────────────────────────
// Clicks a link that opens target="_blank" and returns the new tab
export async function clickNewTab(
  context: BrowserContext,
  locator: Locator
): Promise<Page> {
  const [newTab] = await Promise.all([
    context.waitForEvent('page', { timeout: 15000 }),
    locator.click(),
  ]);
  await newTab.waitForLoadState('domcontentloaded').catch(() => {});
  await waitForStableURL(newTab, 10000);
  return newTab;
}

// ─── Hover + Wait (Mega Menu Pattern) ────────────────────────────────────────
// Hovers over a nav trigger and waits for dropdown to appear
export async function hoverAndWait(
  locator: Locator,
  waitMs = 600
): Promise<void> {
  await locator.hover();
  await locator.page().waitForTimeout(waitMs);
}

// ─── Self-Healing Locator ────────────────────────────────────────────────────
// Tries primary locator, then each fallback in order
export async function tryLocators(
  page: Page,
  locators: string[],
  action: 'click' | 'fill' | 'isVisible' = 'isVisible',
  fillValue?: string
): Promise<boolean> {
  for (const loc of locators) {
    try {
      const el = page.locator(loc).first();
      if (!(await el.isVisible({ timeout: 2000 }))) continue;
      if (action === 'click') await el.click();
      else if (action === 'fill' && fillValue !== undefined) await el.fill(fillValue);
      return true;
    } catch { /* try next */ }
  }
  return false;
}

// ─── Smart Click ─────────────────────────────────────────────────────────────
// Scrolls the element into view within its scroll container (handles modals,
// dialogs, and nested scrollable divs), then clicks.
export async function smartClick(locator: Locator): Promise<void> {
  await locator.scrollIntoViewIfNeeded().catch(() => {});
  await locator.click();
}

// ─── Smart Check / Uncheck ───────────────────────────────────────────────────
// Scrolls a checkbox into view within its scroll container, then checks/unchecks.
export async function smartCheck(locator: Locator): Promise<void> {
  await locator.scrollIntoViewIfNeeded().catch(() => {});
  await locator.check();
}

export async function smartUncheck(locator: Locator): Promise<void> {
  await locator.scrollIntoViewIfNeeded().catch(() => {});
  await locator.uncheck();
}

// ─── Smart Fill ──────────────────────────────────────────────────────────────
// Scrolls into view, then fills reliably. Falls back to real keystrokes.
export async function smartFill(locator: Locator, value: string): Promise<void> {
  await locator.scrollIntoViewIfNeeded().catch(() => {});
  try {
    await locator.fill(value);
  } catch {
    // Fallback for forms that reject programmatic fill — type character by character
    await locator.click();
    await locator.pressSequentially(value, { delay: 30 });
  }
}

// ─── Full Site Preparation ───────────────────────────────────────────────────
// Call this after page.goto() — handles overlays, popups, URL stability
// This is the MAIN entry point — replaces manual per-site setup
export async function prepareSite(page: Page): Promise<void> {
  await waitForPageReady(page);
  await dismissOverlays(page);
  await dismissPopups(page);
}

// ═══════════════════════════════════════════════════════════════════════════════
// ─── Kendo UI Helpers ────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

export async function kendoSelect(page: Page, locator: Locator, optionText: string): Promise<void> {
  var isDisabled = await locator.getAttribute('aria-disabled');
  if (isDisabled === 'true') {
    throw new Error('kendoSelect: dropdown is disabled. Option: "' + optionText + '"');
  }
  await locator.scrollIntoViewIfNeeded();
  await locator.click();
  var ariaOwns = await locator.getAttribute('aria-owns');
  if (!ariaOwns) {
    throw new Error('kendoSelect: element missing aria-owns attribute.');
  }
  var listbox = page.locator('#' + ariaOwns);
  await listbox.waitFor({ state: 'visible', timeout: 8000 });
  var item = listbox.locator('li.k-item', { hasText: optionText });
  var itemCount = await item.count();
  if (itemCount === 0) {
    await page.keyboard.press('Escape');
    throw new Error('kendoSelect: option "' + optionText + '" not found in #' + ariaOwns);
  }
  await item.first().scrollIntoViewIfNeeded();
  await item.first().click();
  await listbox.waitFor({ state: 'hidden', timeout: 5000 }).catch(function() {});
}

export async function kendoSelectDate(page: Page, locator: Locator, dateValue: string): Promise<void> {
  var inputId = await locator.getAttribute('id').catch(function() { return null; });
  if (!inputId) inputId = await locator.evaluate(function(el) { return el.id; }).catch(function() { return ''; });
  if (!inputId) {
    var inner = locator.locator('input[id]').first();
    inputId = await inner.getAttribute('id').catch(function() { return null; });
    if (inputId) return kendoSelectDate(page, inner, dateValue);
    throw new Error('kendoSelectDate: no id on locator');
  }
  var result = await page.evaluate(function(params) {
    try {
      var jq = window.jQuery || window.$;
      if (!jq) return { ok: false, error: 'jQuery not available' };
      var el = jq('#' + params.inputId);
      if (!el.length) return { ok: false, error: 'Element not found: #' + params.inputId };
      var picker = el.data('kendoDateTimePicker') || el.data('kendoDatePicker') || el.data('kendoTimePicker');
      if (!picker) return { ok: false, error: 'No Kendo picker on #' + params.inputId };
      picker.enable(true);
      var k = window.kendo;
      var parsed = null;
      if (k && k.parseDate) {
        var fmts = ['MM-dd-yyyy hh:mm tt','MM/dd/yyyy hh:mm tt','MM-dd-yyyy','MM/dd/yyyy','yyyy-MM-dd','MM-dd-yyyy HH:mm'];
        for (var i = 0; i < fmts.length; i++) { parsed = k.parseDate(params.dateValue, fmts[i]); if (parsed) break; }
      }
      if (!parsed) { parsed = new Date(params.dateValue); if (isNaN(parsed.getTime())) return { ok: false, error: 'Cannot parse: ' + params.dateValue }; }
      picker.value(parsed);
      picker.trigger('change');
      return { ok: true, setValue: picker.value() ? picker.value().toString() : 'null' };
    } catch(e) { return { ok: false, error: String(e) }; }
  }, { inputId: inputId, dateValue: dateValue });
  if (!result.ok) throw new Error('kendoSelectDate failed on #' + inputId + ': ' + result.error);
  await page.waitForTimeout(500);
}

export async function kendoMultiSelectAdd(page: Page, locator: Locator, itemText: string): Promise<void> {
  await locator.scrollIntoViewIfNeeded().catch(() => {});
  const input = locator.locator('input.k-input-inner, input[role="combobox"], input').first();
  await input.click();
  await input.fill('');
  await input.pressSequentially(itemText.substring(0, 10), { delay: 50 });
  await page.waitForTimeout(400);
  const popup = page.locator('.k-animation-container:visible, .k-popup:visible').last();
  const option = popup.locator('.k-list-item:has-text("' + itemText + '"), .k-item:has-text("' + itemText + '"), li:has-text("' + itemText + '")').first();
  await option.scrollIntoViewIfNeeded().catch(() => {});
  await option.click();
  await page.waitForTimeout(200);
}

export async function kendoTreeToggle(page: Page, nodeText: string): Promise<void> {
  const node = page.locator('.k-treeview .k-item:has-text("' + nodeText + '"), .k-treeview [role="treeitem"]:has-text("' + nodeText + '")').first();
  await node.scrollIntoViewIfNeeded().catch(() => {});
  const arrow = node.locator('.k-icon, .k-svg-icon, .k-i-expand, .k-i-collapse').first();
  await arrow.click();
  await page.waitForTimeout(300);
}

export async function kendoTreeSelect(page: Page, nodeText: string): Promise<void> {
  const node = page.locator('.k-treeview .k-in:has-text("' + nodeText + '"), .k-treeview .k-treeview-leaf-text:has-text("' + nodeText + '")').first();
  await node.scrollIntoViewIfNeeded().catch(() => {});
  await node.click();
}
`;
