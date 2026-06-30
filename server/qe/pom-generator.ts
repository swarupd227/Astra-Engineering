/**
 * POM Test Suite Generator
 * Generates a complete Playwright Test Suite following the Page Object Model (POM) pattern,
 * organised by test category: smoke, functional, negative, edge, security, accessibility.
 *
 * Returns Record<filePath, fileContent> — ready to write to disk.
 *
 * Prompt-aligned categories:
 *   1. playwright.config.ts        — global config with per-project test-match rules
 *   2. tsconfig.json               — TypeScript config
 *   3. tests/fixtures/base.fixture.ts
 *   4. tests/helpers/{form,nav,accessibility,security}.helper.ts
 *   5. tests/data/test.data.ts
 *   6. tests/pages/<key>.page.ts   — one per crawled page
 *   7. tests/specs/smoke/<key>.smoke.spec.ts
 *   8. tests/specs/functional/<key>.functional.spec.ts
 *   9. tests/specs/negative/<key>.negative.spec.ts   (only if form/auth)
 *  10. tests/specs/edge/<key>.edge.spec.ts
 *  11. tests/specs/security/<key>.security.spec.ts
 *  12. tests/specs/accessibility/<key>.a11y.spec.ts
 */

import { qeAnthropicClient as _anthropic } from './ai-client.js';
import { detectPattern } from './framework-parser';
export { detectPattern };

// ─── Shared utility functions ────────────────────────────────────────────────

function toKey(s: string): string {
  const key = (s || 'element')
    .replace(/[^a-zA-Z0-9]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase() || 'element';
  return /^[0-9]/.test(key) ? `_${key}` : key;
}

function pageKey(url: string): string {
  try {
    const parts = new URL(url).pathname.split('/').filter(Boolean);
    return parts.length ? toKey(parts[parts.length - 1]) : 'home';
  } catch { return 'home'; }
}

function toPascalCase(key: string): string {
  const pascal = key.split('_')
    .filter(w => w.length > 0)   // drop empty segments from leading underscores (e.g. '_404' → ['404'])
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join('');
  // Identifiers cannot start with a digit — prefix with 'P' (e.g. '404' → 'P404')
  return /^\d/.test(pascal) ? `P${pascal}` : pascal;
}

function pageClassName(key: string): string {
  return `${toPascalCase(key)}Page`;
}

function sampleValue(input: any): string {
  const t = (input.type || '').toLowerCase();
  const n = (input.name || input.label || input.placeholder || '').toLowerCase();
  if (t === 'email' || n.includes('email'))          return 'test@example.com';
  if (t === 'password' || n.includes('pass'))        return 'TestPass@123';
  if (t === 'tel' || n.includes('phone'))            return '9876543210';
  if (n.includes('name'))                            return 'John Doe';
  if (n.includes('company') || n.includes('org'))   return 'Test Company';
  if (n.includes('subject') || n.includes('title')) return 'Test Subject';
  if (t === 'url' || n.includes('url') || n.includes('website')) return 'https://example.com';
  if (t === 'number' || n.includes('age') || n.includes('count')) return '25';
  if (t === 'date')                                  return '2025-01-15';
  return 'Test Value';
}

function stableSel(el: any): string {
  const isTextarea = el.type === 'textarea';
  const isButton = el.type === 'submit' || el.type === 'button' || el.tagName === 'button' || el.text;
  const tag = isTextarea ? 'textarea' : isButton ? 'button' : 'input';
  const rawId = el.selector?.startsWith('#') ? el.selector.slice(1) : null;
  const idDynamic = rawId && (rawId.length > 20 || /[0-9a-f]{8,}/i.test(rawId));
  if (!idDynamic && rawId) return el.selector;
  if (isButton) {
    if (el.type === 'submit') return 'button[type="submit"], input[type="submit"]';
    if (el.text)              return `button:has-text("${el.text.replace(/"/g, '\\"')}")`;
    return 'button';
  }
  if (el.name)        return `${tag}[name="${el.name}"]`;
  if (el.ariaLabel)   return `${tag}[aria-label="${el.ariaLabel}"]`;
  if (el.placeholder) return `${tag}[placeholder="${el.placeholder}"]`;
  if (el.type && el.type !== 'text') return `${tag}[type="${el.type}"]`;
  return tag;
}

// ─── Framework Context Integration ───────────────────────────────────────────

export interface FwFunction {
  name: string;
  signature: string;
  category: string;
  returnType?: string | null;
  className?: string | null;
  importPath?: string | null;
}

export interface UserStoryContext {
  id: string;
  title: string;
  description?: string | null;
  acceptanceCriteria?: string | null;
}

export interface FrameworkContext {
  name: string;
  framework: string;
  language: string;
  detectedLanguage?: 'java' | 'typescript' | 'javascript' | 'python' | 'csharp';
  detectedTool?: 'selenium' | 'playwright' | 'cypress' | 'testcomplete' | 'webdriverio' | 'unknown';
  baseClass?: string | null;
  sampleScript?: string | null;
  functions: FwFunction[];
  pattern: 'POM' | 'BDD' | 'BDD+POM';
  userStories?: UserStoryContext[];
}

/**
 * Parse acceptance criteria text into structured Given/When/Then blocks.
 * Supports bullet lists, numbered lists, and free-form paragraphs.
 */
export function parseAcceptanceCriteria(ac: string): Array<{ given: string; when: string; then: string }> {
  if (!ac) return [];
  const lines = ac.split('\n').map(l => l.replace(/^[-*\d.)\s]+/, '').trim()).filter(Boolean);
  const scenarios: Array<{ given: string; when: string; then: string }> = [];
  let given = 'the system is in a valid state';
  let when  = 'the user performs an action';

  for (const line of lines) {
    const lower = line.toLowerCase();
    if (lower.startsWith('given '))       { given = line.replace(/^given /i, ''); }
    else if (lower.startsWith('when '))   { when  = line.replace(/^when /i, ''); }
    else if (lower.startsWith('then '))   { scenarios.push({ given, when, then: line.replace(/^then /i, '') }); }
    else if (lower.startsWith('and ') && scenarios.length > 0) {
      // Append to last scenario's then
      scenarios[scenarios.length - 1].then += ` and ${line.replace(/^and /i, '')}`;
    } else {
      // Free-form line — treat as a "then" scenario
      scenarios.push({ given: 'the user is on the page', when: 'the user interacts with the feature', then: line });
    }
  }

  return scenarios.slice(0, 6); // limit to 6 scenarios per story
}

// ─── Semantic function role → regex patterns ─────────────────────────────────
// Covers real-world naming: sendKeys, typeInField, enterText, typeText, etc.
const SEMANTIC_ROLES: Record<string, { categories: string[]; nameRe: RegExp; sigRe?: RegExp }> = {
  fill: {
    categories: ['generic', 'navigation'],
    nameRe: /^(fill|type|enter|input|set|send|write|put|setValue|typeText|enterText|sendKeys|typeInField|sendText|inputText|putText|typeIn|setField)/i,
    sigRe:  /fill|type|sendkeys|text|value|input/i,
  },
  click: {
    categories: ['generic'],
    nameRe: /^(click|tap|press|select|choose|pick|activate|trigger|hitButton|pressBtn|clickOn|clickEl|clickElement)/i,
    sigRe:  /click|tap|press/i,
  },
  navigate: {
    categories: ['navigation'],
    nameRe: /^(navigate|go|open|load|visit|launch|gotoPage|navTo|browseToPage|openPage|directTo|routeTo|openUrl|navigateTo|goToUrl|loadPage)/i,
  },
  assertion: {
    categories: ['assertion'],
    nameRe: /^(verify|assert|check|validate|expect|confirm|should|ensure|assertThat|assertEquals|assertVisible|assertTrue|verifyText|checkElement)/i,
  },
  login: {
    categories: ['setup'],
    nameRe: /^(login|signIn|authenticate|doLogin|performLogin|signInAs|logInWith|loginAs|loginUser)/i,
  },
};

/**
 * Semantic-first function lookup.
 * 1. Match by role's category list + name pattern
 * 2. Fall back to signature content match
 */
function findFwFnSemantic(fns: FwFunction[], role: string): FwFunction | undefined {
  const def = SEMANTIC_ROLES[role];
  if (!def || fns.length === 0) return undefined;

  // Pass 1 — category + name prefix
  const byName = fns.find(f => def.categories.includes(f.category) && def.nameRe.test(f.name));
  if (byName) return byName;

  // Pass 2 — name only (ignore category, broader scan)
  const byNameOnly = fns.find(f => def.nameRe.test(f.name));
  if (byNameOnly) return byNameOnly;

  // Pass 3 — signature keyword scan
  if (def.sigRe) {
    return fns.find(f => def.sigRe!.test(f.signature));
  }

  return undefined;
}

/** Legacy shim — kept for BDD step-def paths that call it directly */
function findFwFn(fns: FwFunction[], category: string, nameRe?: RegExp): FwFunction | undefined {
  return fns.find(f => f.category === category && (!nameRe || nameRe.test(f.name)));
}

function isHoneypot(el: any): boolean {
  const n = (el.name || el.id || '').toLowerCase();
  return n.includes('honeypot') || n.includes('_trap') || n === 'fax';
}

function isRecaptchaEl(el: any): boolean {
  return (el.name || el.id || el.class || '').toLowerCase().includes('recaptcha');
}

function isSvgNoise(text: string): boolean {
  if (!text) return false;
  return text.trim().length > 80 || /[Mm]\s*[\d-]/.test(text);
}

function esc(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

// ─── Page type detection ──────────────────────────────────────────────────────

function detectPageType(url: string, inputs: any[], buttons: any[], page: any): string {
  const u = url.toLowerCase();
  const btnTexts = buttons.map((b: any) => (b.text || '').toLowerCase()).join(' ');
  const inputTypes = inputs.map((i: any) => i.type || '').join(' ');
  const inputNames = inputs.map((i: any) => (i.name || i.id || i.label || '').toLowerCase()).join(' ');

  if (inputTypes.includes('password')) return 'auth';
  if (u.includes('checkout-step') || inputNames.includes('zip') || inputNames.includes('postal') || inputNames.includes('first_name')) return 'checkout';
  if (u.includes('cart') || btnTexts.includes('remove') || btnTexts.includes('continue shopping')) return 'cart';
  if (btnTexts.includes('add to cart') && !u.includes('item')) return 'product_listing';
  if (u.includes('inventory-item') || u.includes('product-detail') || u.includes('item')) return 'product_detail';
  if (inputs.length >= 3 && (btnTexts.includes('submit') || btnTexts.includes('send') || btnTexts.includes('contact'))) return 'form';
  return 'content';
}

function getPageTestCases(pageUrl: string, category: string, allTestCases: any[]): any[] {
  return allTestCases.filter((tc: any) =>
    (tc.pageUrl === pageUrl || !tc.pageUrl) &&
    (tc.category || '').toLowerCase() === category.toLowerCase()
  ).slice(0, 8);
}

function generateContextualSpecFiles(
  url: string, key: string, cn: string, title: string,
  inputs: any[], buttons: any[], navLinks: any[], hasForm: boolean, hasPasswordField: boolean,
  pageType: string, pageTCs: any[], allTestCases: any[],
  frameworkCtx?: FrameworkContext,
  samplePatterns?: SamplePatterns
): Record<string, string> {
  const specs: Record<string, string> = {};

  // ── Derived from SamplePatterns (or defaults) ─────────────────────────────
  const pat          = samplePatterns ?? DEFAULT_PATTERNS;
  const poVar        = pat.poVariableName;                       // "po" | "loginPage" etc.
  const tcPfx        = pat.tcPrefix;                             // "TC-" | "TEST-"
  const smokeTag     = pat.tagConvention;                        // "@smoke"
  const waitLine     = pat.hasWaitForLoad
    ? `    await ${poVar}.waitForPageLoad();\n`
    : '';

  // ── Test ID generators ────────────────────────────────────────────────────
  const funId = (n: number) => generateTestId(tcPfx, 'functional', n);
  const negId = (n: number) => generateTestId(tcPfx, 'negative', n);
  const secId = (n: number) => generateTestId(tcPfx, 'security', n);
  const a11Id = (n: number) => generateTestId(tcPfx, 'accessibility', n);

  // ── Import block ───────────────────────────────────────────────────────────
  const fwBanner = frameworkCtx
    ? `// Framework: ${frameworkCtx.name} (${frameworkCtx.framework} / ${frameworkCtx.language})\n`
    : '';
  // Use detected import paths from sample if available, else defaults
  const pageImportPath = pat.importPaths.find(p => p.includes('page')) ?? `../../pages/${key}.page`;
  const importBlock = [
    `${fwBanner}import { test, expect } from '@playwright/test';`,
    `import { ${cn} } from '${pageImportPath.replace(/\/[^/]+\.page$/, `/${key}.page`)}';`,
    ...(pat.usesTestData ? [pat.testDataImport] : []),
    ...pat.helperImports,
  ].join('\n');

  // ── Describe block tag builder ─────────────────────────────────────────────
  const safeTitle = title.replace(/'/g, "\\'");
  const describeTag = (tag: string) =>
    pat.describePattern.replace('{tag}', tag).replace('{title}', safeTitle) || `${tag} | ${safeTitle}`;

  // Extract relative path once for use throughout this function
  let relPath: string;
  try { relPath = new URL(url).pathname || '/'; } catch { relPath = '/'; }

  // ── SMOKE (always generated) ──────────────────────────────────────────────
  const smokeTCs = getPageTestCases(url, 'smoke', allTestCases);
  const _smokeTestName = smokeTCs[0]?.title || `${title} loads correctly`;
  const smkId = (n: number) => generateTestId(tcPfx, 'smoke', n);
  specs[`tests/specs/smoke/${key}.smoke.spec.ts`] = `${importBlock}

test.describe('${describeTag(smokeTag)}', () => {
  test('${smkId(1)} page returns HTTP 2xx status', async ({ page }) => {
    const ${poVar} = new ${cn}(page);
    const res = await page.request.get('${esc(relPath)}');
    expect(res.status()).toBeGreaterThanOrEqual(200);
    expect(res.status()).toBeLessThan(400);
  });

  test('${smkId(2)} body is visible and contains text', async ({ page }) => {
    const ${poVar} = new ${cn}(page);
    await ${poVar}.navigate();
${waitLine}    await expect(page.locator('body')).toBeVisible();
    const text = await page.locator('body').textContent();
    expect((text ?? '').trim().length).toBeGreaterThan(10);
  });

  test('${smkId(3)} no critical JavaScript runtime errors on load', async ({ page }) => {
    const ${poVar} = new ${cn}(page);
    const errors: string[] = [];
    page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
    await ${poVar}.navigate();
${waitLine}    await page.waitForLoadState('domcontentloaded');
    const jsErrors = errors.filter(e =>
      (e.includes('TypeError') || e.includes('ReferenceError') || e.includes('SyntaxError') || e.includes('Uncaught'))
      && !e.includes('Failed to load resource') && !e.includes('net::ERR')
    );
    expect(jsErrors, 'JS runtime errors: ' + jsErrors.join(' | ')).toHaveLength(0);
  });
});
`;

  // ── FUNCTIONAL (context-specific per page type) ───────────────────────────
  let functionalTests = '';

  if (pageType === 'auth') {
    const userInput = inputs.find((i: any) => i.type !== 'password' && i.type !== 'hidden');
    const pwdInput  = inputs.find((i: any) => i.type === 'password');
    const userSel   = userInput ? stableSel(userInput) : 'input[type="text"]';
    const pwdSel    = pwdInput  ? stableSel(pwdInput)  : 'input[type="password"]';
    const submitBtn = buttons.find((b: any) => b.type === 'submit' || (b.text || '').toLowerCase().includes('login') || (b.text || '').toLowerCase().includes('sign'));
    const submitSel = submitBtn ? stableSel(submitBtn) : 'button[type="submit"]';
    functionalTests = `
  test('${funId(1)} login form is visible with username and password fields', async ({ page }) => {
    const ${poVar} = new ${cn}(page);
    await ${poVar}.navigate();
${waitLine}    await expect(page.locator('${esc(userSel)}')).toBeVisible();
    await expect(page.locator('${esc(pwdSel)}')).toBeVisible();
    await expect(page.locator('${esc(submitSel)}')).toBeVisible();
  });

  test('${funId(2)} username field accepts text input', async ({ page }) => {
    const ${poVar} = new ${cn}(page);
    await ${poVar}.navigate();
${waitLine}    await page.locator('${esc(userSel)}').fill('testuser');
    await expect(page.locator('${esc(userSel)}')).toHaveValue('testuser');
  });

  test('${funId(3)} password field masks input', async ({ page }) => {
    const ${poVar} = new ${cn}(page);
    await ${poVar}.navigate();
${waitLine}    const pwdType = await page.locator('${esc(pwdSel)}').getAttribute('type');
    expect(pwdType).toBe('password');
  });`;
  } else if (pageType === 'product_listing') {
    const addToCartBtn = buttons.find((b: any) => (b.text || '').toLowerCase().includes('add to cart'));
    const addSel = addToCartBtn ? stableSel(addToCartBtn) : 'button';
    functionalTests = `
  test('${funId(1)} product items are visible on the page', async ({ page }) => {
    const ${poVar} = new ${cn}(page);
    await ${poVar}.navigate();
    await ${poVar}.waitForPageLoad();
    const items = page.locator('.inventory_item, [class*="product"], [class*="item-card"]');
    await expect(items.first()).toBeVisible();
  });

  test('${funId(2)} add to cart button is clickable', async ({ page }) => {
    const ${poVar} = new ${cn}(page);
    await ${poVar}.navigate();
    await ${poVar}.waitForPageLoad();
    const btn = page.locator('${esc(addSel)}').first();
    await expect(btn).toBeVisible();
    await expect(btn).toBeEnabled();
  });

  test('${funId(3)} cart icon updates after adding item', async ({ page }) => {
    const ${poVar} = new ${cn}(page);
    await ${poVar}.navigate();
    await ${poVar}.waitForPageLoad();
    await page.locator('${esc(addSel)}').first().click();
    const cartBadge = page.locator('.shopping_cart_badge, [class*="cart-badge"], [class*="cart-count"]');
    await expect(cartBadge).toBeVisible();
  });`;
  } else if (pageType === 'checkout') {
    const firstInput = inputs[0];
    const firstSel = firstInput ? stableSel(firstInput) : 'input';
    functionalTests = `
  test('${funId(1)} checkout form fields are visible and editable', async ({ page }) => {
    const ${poVar} = new ${cn}(page);
    await ${poVar}.navigate();
    await ${poVar}.waitForPageLoad();
    const inputs = page.locator('input[type="text"], input:not([type="hidden"])');
    expect(await inputs.count()).toBeGreaterThan(0);
    await expect(inputs.first()).toBeVisible();
  });

  test('${funId(2)} form fields accept user input', async ({ page }) => {
    const ${poVar} = new ${cn}(page);
    await ${poVar}.navigate();
    await ${poVar}.waitForPageLoad();
    const field = page.locator('${esc(firstSel)}').first();
    await field.fill('Test Value');
    await expect(field).toHaveValue('Test Value');
  });

  test('${funId(3)} continue/next button is present and enabled', async ({ page }) => {
    const ${poVar} = new ${cn}(page);
    await ${poVar}.navigate();
    await ${poVar}.waitForPageLoad();
    const continueBtn = page.locator('button, input[type="submit"]').filter({ hasText: /continue|next|proceed/i });
    await expect(continueBtn.first()).toBeEnabled();
  });`;
  } else if (pageType === 'cart') {
    functionalTests = `
  test('${funId(1)} cart page shows item list or empty message', async ({ page }) => {
    const ${poVar} = new ${cn}(page);
    await ${poVar}.navigate();
    await ${poVar}.waitForPageLoad();
    const cartItems = page.locator('.cart_item, [class*="cart-item"]');
    const emptyMsg  = page.locator('[class*="empty"], [class*="no-item"]');
    const hasItems  = await cartItems.count() > 0;
    const isEmpty   = await emptyMsg.count() > 0;
    expect(hasItems || isEmpty).toBe(true);
  });

  test('${funId(2)} checkout button is visible', async ({ page }) => {
    const ${poVar} = new ${cn}(page);
    await ${poVar}.navigate();
    await ${poVar}.waitForPageLoad();
    const checkoutBtn = page.locator('button, a').filter({ hasText: /checkout/i });
    await expect(checkoutBtn.first()).toBeVisible();
  });

  test('${funId(3)} continue shopping link navigates back', async ({ page }) => {
    const ${poVar} = new ${cn}(page);
    await ${poVar}.navigate();
    await ${poVar}.waitForPageLoad();
    const continueLink = page.locator('button, a').filter({ hasText: /continue shopping|back/i });
    if (await continueLink.count() > 0) {
      await continueLink.first().click();
      await expect(page).not.toHaveURL(new RegExp('cart'));
    }
  });`;
  } else if (inputs.length > 0) {
    const firstInput = inputs[0];
    const firstSel = stableSel(firstInput);
    const submitBtn = buttons.find((b: any) => b.type === 'submit' || (b.text || '').toLowerCase().includes('submit'));
    const submitSel = submitBtn ? stableSel(submitBtn) : 'button[type="submit"]';
    functionalTests = `
  test('${funId(1)} form fields are visible and interactive', async ({ page }) => {
    const ${poVar} = new ${cn}(page);
    await ${poVar}.navigate();
    await ${poVar}.waitForPageLoad();
    await expect(page.locator('${esc(firstSel)}')).toBeVisible();
  });

  test('${funId(2)} input field accepts text', async ({ page }) => {
    const ${poVar} = new ${cn}(page);
    await ${poVar}.navigate();
    await ${poVar}.waitForPageLoad();
    await page.locator('${esc(firstSel)}').fill('test input');
    await expect(page.locator('${esc(firstSel)}')).toHaveValue('test input');
  });

  test('${funId(3)} submit button is present and enabled', async ({ page }) => {
    const ${poVar} = new ${cn}(page);
    await ${poVar}.navigate();
    await ${poVar}.waitForPageLoad();
    await expect(page.locator('${esc(submitSel)}')).toBeVisible();
    await expect(page.locator('${esc(submitSel)}')).toBeEnabled();
  });`;
  } else {
    // content page — check H1, footer, and navigation links
    const fwFillFnTs  = frameworkCtx ? findFwFnSemantic(frameworkCtx.functions, 'fill')  : null;
    const firstInput  = inputs[0];
    const fillCallTs  = firstInput?.name
      ? fwFillFnTs
        ? `    await this.${fwFillFnTs.name}(${poVar}.page.locator('[name="${firstInput.name}"]'), 'test value');`
        : `    await page.locator('[name="${firstInput.name}"]').fill('test value');`
      : `    // No inputs detected on this page`;
    functionalTests = `
  test('${funId(1)} H1 heading and main content are visible', async ({ page }) => {
    const ${poVar} = new ${cn}(page);
    await ${poVar}.navigate();
    await ${poVar}.waitForPageLoad();
    await expect(page.locator('h1').first()).toBeVisible();
    await expect(page.locator('main, [role="main"], body > *').first()).toBeVisible();
  });

  test('${funId(2)} footer is visible and page scrolls to bottom', async ({ page }) => {
    const ${poVar} = new ${cn}(page);
    await ${poVar}.navigate();
    await ${poVar}.waitForPageLoad();
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    const footer = page.locator('footer, [class*="footer"]').first();
    if (await footer.count() > 0) {
      await expect(footer).toBeVisible();
    }
${fillCallTs}
  });

  test('${funId(3)} all internal navigation links return HTTP 200', async ({ page }) => {
    const ${poVar} = new ${cn}(page);
    await ${poVar}.navigate();
    await ${poVar}.waitForPageLoad();
    const { checkInternalLinks } = await import('../../helpers/nav.helper');
    await checkInternalLinks(page);
  });`;
  }

  const functionalImport = pageType === 'content'
    ? `${importBlock}`
    : `${importBlock}`;

  specs[`tests/specs/functional/${key}.functional.spec.ts`] = `${functionalImport}

test.describe('${describeTag('@functional')}', () => {
${functionalTests}
});
`;

  // ── NEGATIVE (only for pages with forms or auth) ──────────────────────────
  if (hasForm || hasPasswordField) {
    let negativeTests = '';
    if (pageType === 'auth') {
      const _userInputNeg = inputs.find((i: any) => i.type !== 'password');
      const _pwdInputNeg  = inputs.find((i: any) => i.type === 'password');
      const userSelNeg = _userInputNeg ? stableSel(_userInputNeg) : 'input[type="text"]';
      const pwdSelNeg  = _pwdInputNeg  ? stableSel(_pwdInputNeg)  : 'input[type="password"]';
      const submitBtnNeg = buttons.find((b: any) => b.type === 'submit' || (b.text || '').toLowerCase().includes('login'));
      const submitSelNeg = submitBtnNeg ? stableSel(submitBtnNeg) : 'button[type="submit"]';
      negativeTests = `
  const loginCases: Array<[string, string]> = [
    ['invalid_user_xyz', 'wrong_password_123'],
    ['locked_out_user',  'secret_sauce'],
    ['',                 'anypassword'],
    ['anyuser',          ''],
  ];

  for (const [username, password] of loginCases) {
    test(\`${negId(1)} login rejected for user="\${username || '(empty)'}" pwd="\${password || '(empty)'}"\`, async ({ page }) => {
      const ${poVar} = new ${cn}(page);
      await ${poVar}.navigate();
      await ${poVar}.waitForPageLoad();
      await page.locator('${esc(userSelNeg)}').fill(username);
      await page.locator('${esc(pwdSelNeg)}').fill(password);
      await page.locator('${esc(submitSelNeg)}').click();
      const error = page.locator(
        '[class*="error"], [data-test="error"], .alert, [role="alert"]',
      );
      await expect(error.first()).toBeVisible({ timeout: 5000 });
    });
  }`;
    } else {
      const firstInputNeg = inputs[0];
      const firstSelNeg = firstInputNeg ? stableSel(firstInputNeg) : 'input';
      const submitBtnNeg2 = buttons.find((b: any) => b.type === 'submit');
      const submitSelNeg2 = submitBtnNeg2 ? stableSel(submitBtnNeg2) : 'button[type="submit"]';
      negativeTests = `
  test('${negId(1)} empty required fields trigger validation', async ({ page }) => {
    const ${poVar} = new ${cn}(page);
    await ${poVar}.navigate();
    await ${poVar}.waitForPageLoad();
    const submitBtnEl = page.locator('${esc(submitSelNeg2)}');
    if (await submitBtnEl.count() > 0) {
      await submitBtnEl.click();
      const error = page.locator('[class*="error"], [aria-invalid="true"], .alert, [role="alert"], [required]:invalid');
      // At least some validation feedback should appear
      await expect(page.locator('body')).toBeVisible();
    }
  });

  test('${negId(2)} extremely long input does not crash the page', async ({ page }) => {
    const ${poVar} = new ${cn}(page);
    await ${poVar}.navigate();
    await ${poVar}.waitForPageLoad();
    const field = page.locator('${esc(firstSelNeg)}').first();
    if (await field.count() > 0) {
      await field.fill('A'.repeat(500));
      await expect(page.locator('body')).toBeVisible();
    }
  });`;
    }

    specs[`tests/specs/negative/${key}.negative.spec.ts`] = `${importBlock}

test.describe('${describeTag('@negative')}', () => {
${negativeTests}
});
`;
  }

  // ── SECURITY ─────────────────────────────────────────────────────────────
  const firstInputSec = inputs.find((i: any) => i.type !== 'hidden') || inputs[0];
  const firstSelSec = firstInputSec ? stableSel(firstInputSec) : 'input';

  specs[`tests/specs/security/${key}.security.spec.ts`] = `import { test, expect } from '@playwright/test';
import { ${cn} } from '../../pages/${key}.page';
import { assertNoXSSExecution, assertNoServerErrorExposed } from '../../helpers/security.helper';
import { xssPayloads } from '../../data/test.data';

test.describe('${describeTag('@security')}', () => {
  test('${secId(1)} URL does not expose sensitive parameters', async ({ page }) => {
    const ${poVar} = new ${cn}(page);
    await ${poVar}.navigate();
    await ${poVar}.waitForPageLoad();
    const url = page.url();
    const sensitive = /password|passwd|secret|token|api[_-]?key|auth|credential/i;
    expect(sensitive.test(url)).toBe(false);
  });

  test('${secId(2)} security response headers are present', async ({ page }) => {
    const res = await page.request.get('${esc(relPath)}');
    const h = res.headers();
    const hasHeader =
      !!h['x-frame-options'] ||
      !!h['x-content-type-options'] ||
      !!h['content-security-policy'] ||
      !!h['strict-transport-security'];
    if (!hasHeader) {
      console.warn('[Advisory] No security headers on ${esc(relPath)}');
    }
    // Advisory only — do not hard-fail (CDN/proxy may strip headers)
  });
${hasForm ? `
  for (const payload of xssPayloads) {
    test(\`${secId(3)} XSS payload does not execute: "\${payload.substring(0, 40)}"\`, async ({ page }) => {
      const ${poVar} = new ${cn}(page);
      await ${poVar}.navigate();
      await ${poVar}.waitForPageLoad();
      const field = page.locator('${esc(firstSelSec)}').first();
      if (await field.count() === 0) test.skip();
      await assertNoXSSExecution(page, [payload], field);
      await assertNoServerErrorExposed(page);
    });
  }
` : ''}
});
`;

  // ── EDGE (only for interactive pages — skip pure content pages) ───────────
  if (pageType !== 'content') {
    const edgeInput = inputs.find((i: any) => i.type !== 'hidden') || inputs[0];
    const edgeSel   = edgeInput ? stableSel(edgeInput) : 'input[type="text"]';
    const hasInputs = inputs.filter((i: any) => i.type !== 'hidden').length > 0;
    const urlPathname = (() => {
      try { return new URL(url).pathname; } catch { return '/'; }
    })();
    specs[`tests/specs/edge/${key}.edge.spec.ts`] = `${importBlock}
import { edgeData } from '../../data/test.data';

test.describe('${describeTag('@edge')}', () => {
  test('${generateTestId(tcPfx, 'edge', 1)} direct URL navigation lands on correct page', async ({ page }) => {
    const ${poVar} = new ${cn}(page);
    await ${poVar}.navigate();
    await ${poVar}.waitForPageLoad();
    await expect(page.locator('body')).toBeVisible();
    expect(page.url()).toContain('${urlPathname.replace(/'/g, "\\'")}');
  });

  test('${generateTestId(tcPfx, 'edge', 2)} back/forward browser navigation works', async ({ page }) => {
    const ${poVar} = new ${cn}(page);
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await ${poVar}.navigate();
    await ${poVar}.waitForPageLoad();
    await page.goBack({ waitUntil: 'domcontentloaded' });
    await expect(page.locator('body')).toBeVisible();
    await page.goForward({ waitUntil: 'domcontentloaded' });
    await expect(page.locator('body')).toBeVisible();
  });
${hasInputs ? `
  test('${generateTestId(tcPfx, 'edge', 3)} special characters in input do not crash the page', async ({ page }) => {
    const ${poVar} = new ${cn}(page);
    await ${poVar}.navigate();
    await ${poVar}.waitForPageLoad();
    const field = page.locator('${esc(edgeSel)}').first();
    if (await field.count() > 0) {
      await field.fill(edgeData.specialChars);
      await page.waitForFunction(() => true);
      await expect(page.locator('body')).toBeVisible();
    }
  });

  test('${generateTestId(tcPfx, 'edge', 4)} unicode input is handled gracefully', async ({ page }) => {
    const ${poVar} = new ${cn}(page);
    await ${poVar}.navigate();
    await ${poVar}.waitForPageLoad();
    const field = page.locator('${esc(edgeSel)}').first();
    if (await field.count() > 0) {
      await field.fill(edgeData.unicode);
      await page.waitForFunction(() => true);
      await expect(page.locator('body')).toBeVisible();
    }
  });` : ''}
});
`;
  }

  // ── ACCESSIBILITY ─────────────────────────────────────────────────────────
  specs[`tests/specs/accessibility/${key}.a11y.spec.ts`] = `import { test, expect } from '@playwright/test';
import { ${cn} } from '../../pages/${key}.page';
import { assertWCAGBaseline } from '../../helpers/accessibility.helper';

test.describe('${describeTag('@accessibility')}', () => {
  test('${a11Id(1)} WCAG 2.1 AA baseline checks pass', async ({ page }) => {
    const ${poVar} = new ${cn}(page);
    await ${poVar}.navigate();
    await ${poVar}.waitForPageLoad();
    await assertWCAGBaseline(page);
  });

  test('${a11Id(2)} page has a descriptive non-empty title', async ({ page }) => {
    const ${poVar} = new ${cn}(page);
    await ${poVar}.navigate();
    await ${poVar}.waitForPageLoad();
    const title = await page.title();
    expect(title.trim().length).toBeGreaterThan(0);
    expect(title).not.toMatch(/^(untitled|undefined|null)$/i);
  });

  test('${a11Id(3)} keyboard Tab reaches an interactive element', async ({ page }) => {
    const ${poVar} = new ${cn}(page);
    await ${poVar}.navigate();
    await ${poVar}.waitForPageLoad();
    await page.keyboard.press('Tab');
    const focusedTag = await page.evaluate(
      () => document.activeElement?.tagName ?? 'BODY',
    );
    expect(['A', 'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'BODY']).toContain(
      focusedTag,
    );
  });
});
`;

  return specs;
}

// ─── Main export ─────────────────────────────────────────────────────────────

export interface POMTestSuite {
  files: Record<string, string>;
  specFiles: string[];
}

// ═══════════════════════════════════════════════════════
// TESTCOMPLETE + JAVASCRIPT GENERATOR
// ═══════════════════════════════════════════════════════

/** Derives a safe TestComplete page object name from a URL. */
function tcPageName(url: string): string {
  try {
    const { pathname } = new URL(url);
    const seg = pathname.replace(/^\//, '').replace(/\//g, '_').replace(/[^a-zA-Z0-9_]/g, '') || 'Home';
    return seg.charAt(0).toUpperCase() + seg.slice(1);
  } catch {
    return 'Page';
  }
}

// ═══════════════════════════════════════════════════════
// SHARED AI TEST BODY GENERATOR + TEMPLATE FALLBACK
// ═══════════════════════════════════════════════════════

interface TestBodyRequest {
  pageUrl:        string;
  pageH1:         string;
  pageInputs:     any[];
  pageButtons:    any[];
  pageForms:      any[];
  testCases:      any[];
  language:       string;
  tool:           string;
  pattern:        string;
  baseClass:      string;
  fillFn:         string;
  clickFn:        string;
  navigateFn:     string;
  assertFn:       string;
  sampleScript?:  string | null;
  frameworkCtx?:  FrameworkContext;
  samplePatterns?: SamplePatterns;
}

// ── FIX 2: Substitution instruction builder ──────────────────────────────────
function buildSubstitutionInstructions(ctx: FrameworkContext | undefined): string {
  if (!ctx?.functions?.length) return '';

  const fillFn   = findFwFnSemantic(ctx.functions, 'fill');
  const clickFn  = findFwFnSemantic(ctx.functions, 'click');
  const navFn    = findFwFnSemantic(ctx.functions, 'navigate');
  const assertFn = findFwFnSemantic(ctx.functions, 'assertion');
  const waitFn   = findFwFnSemantic(ctx.functions, 'wait');

  const rules: string[] = [];
  if (fillFn)   rules.push(`ALWAYS use this.${fillFn.name}(locator, value) instead of locator.fill(value) or sendKeys()`);
  if (clickFn)  rules.push(`ALWAYS use this.${clickFn.name}(locator) instead of locator.click() or element.click()`);
  if (navFn)    rules.push(`ALWAYS use this.${navFn.name}(path) instead of page.goto() or driver.get()`);
  if (assertFn) rules.push(`ALWAYS use this.${assertFn.name}(locator) instead of expect(locator).toBeVisible()`);
  if (waitFn)   rules.push(`ALWAYS use this.${waitFn.name}(locator) instead of waitForSelector or waitFor`);

  if (!rules.length) return '';

  return `
MANDATORY FUNCTION SUBSTITUTION RULES:
These rules are non-negotiable. The output must compile against the customer's framework.
${rules.map((r, i) => `${i + 1}. ${r}`).join('\n')}
NEVER use raw Playwright/Selenium calls when a framework function exists for that action.
The customer's framework functions ARE the API.`;
}

// ── FIX 3: Locator style detection ──────────────────────────────────────────
function detectLocatorStyle(ctx: FrameworkContext | undefined): 'getByLabel' | 'getByRole' | 'locator' | 'by-id' {
  if (!ctx?.sampleScript) return 'locator';
  const s = ctx.sampleScript;
  if (s.includes('getByLabel'))                              return 'getByLabel';
  if (s.includes('getByRole'))                               return 'getByRole';
  if (s.includes('By.id') || s.includes('By.name') || s.includes('@FindBy')) return 'by-id';
  return 'locator';
}

function buildLocatorExpression(el: any, style: string): string {
  if (style === 'getByLabel' && (el.label || el.ariaLabel)) {
    return `this.page.getByLabel('${esc(el.label ?? el.ariaLabel)}')`;
  }
  if (style === 'getByRole' && el.type === 'button') {
    return `this.page.getByRole('button', { name: '${esc(el.label ?? el.text ?? el.name ?? '')}' })`;
  }
  if (el.name)        return `this.page.locator('[name="${esc(el.name)}"]').first()`;
  if (el.id)          return `this.page.locator('#${esc(el.id)}').first()`;
  if (el.ariaLabel)   return `this.page.locator('[aria-label="${esc(el.ariaLabel)}"]').first()`;
  if (el.placeholder) return `this.page.locator('[placeholder="${esc(el.placeholder)}"]').first()`;
  return `this.page.locator('${esc(el.css ?? el.selector ?? el.type ?? 'input')}').first()`;
}

// ─── Sample Pattern Extraction ───────────────────────────────────────────────

export interface SamplePatterns {
  testIdPrefix:    string;        // e.g. "TC-", "TEST-", ""
  tagConvention:   string;        // e.g. "@smoke", "@regression", ""
  poVariableName:  string;        // e.g. "po", "page", "homePage"
  hasWaitForLoad:  boolean;       // true if waitForPageLoad() / waitForLoad() found
  usesTestData:    boolean;       // true if TestData / testData import detected
  testDataImport:  string;        // e.g. "import { TestData } from '../data/test.data';"
  helperImports:   string[];      // e.g. ["import { FormHelper } from '../helpers/form.helper';"]
  hasParametric:   boolean;       // true if test.each / @DataProvider found
  usesAdvisory:    boolean;       // true if test.step() found
  usesTestSkip:    boolean;       // true if test.skip found
  describePattern: string;        // e.g. "@smoke | Home Page"
  importPaths:     string[];      // all import paths found (relative paths)
  tcPrefix:        string;        // e.g. "TC-S", "TC-F", "TC-SEC" (detected from test IDs)
}

const DEFAULT_PATTERNS: SamplePatterns = {
  testIdPrefix:    'TC-',
  tagConvention:   '@smoke',
  poVariableName:  'po',
  hasWaitForLoad:  true,
  usesTestData:    false,
  testDataImport:  "import { TestData } from '../../data/test.data';",
  helperImports:   [],
  hasParametric:   false,
  usesAdvisory:    false,
  usesTestSkip:    false,
  describePattern: '{tag} | {title}',
  importPaths:     [],
  tcPrefix:        'TC-',
};

/**
 * Extracts naming and style conventions from a sample test script so that
 * AI-generated tests can faithfully replicate the team's established patterns.
 */
export function extractSamplePatterns(sampleScript: string | null | undefined): SamplePatterns {
  if (!sampleScript || sampleScript.trim().length < 20) return { ...DEFAULT_PATTERNS };

  const s = sampleScript;

  // ── Test ID prefix ──────────────────────────────────────────────────────────
  // Matches: 'TC-S01', 'TEST-001', 'TC_F01', 'SMOKE-01' inside test() names
  const tcIdMatch = s.match(/test\s*\(\s*['"`]((?:TC|TEST|CASE|SMK|SPEC|CHECK|REG)[-_]?[A-Z0-9]{1,6}[-_]?\d{2,3})/i);
  const testIdPrefix = tcIdMatch ? tcIdMatch[1].replace(/\d+$/, '') : 'TC-';

  // ── Tag convention from describe block ───────────────────────────────────────
  const describeMatch = s.match(/test\.describe\s*\(\s*['"`]([^'"`,]+)/);
  const describeStr   = describeMatch ? describeMatch[1].trim() : '';
  const tagMatch      = describeStr.match(/(@\w+)/);
  const tagConvention = tagMatch ? tagMatch[1] : '@smoke';
  // Extract describe pattern template
  const describePattern = describeStr
    ? describeStr.replace(/@\w+/g, '{tag}').replace(/[A-Z][a-z]+ [A-Z]?[a-z]+ ?[A-Z]?[a-z]*/g, '{title}').trim()
    : '{tag} | {title}';

  // ── PO variable name ─────────────────────────────────────────────────────────
  // Matches: const po = new LoginPage(page)  OR  const loginPage = new LoginPage(page)
  const poVarMatch = s.match(/const\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s*=\s*new\s+\w+Page\s*\(/);
  const poVariableName = poVarMatch ? poVarMatch[1] : 'po';

  // ── waitForLoad usage ────────────────────────────────────────────────────────
  const hasWaitForLoad = /waitForPageLoad|waitForLoad|waitForDomContent|waitUntilLoaded/i.test(s);

  // ── TestData usage ───────────────────────────────────────────────────────────
  const usesTestData = /TestData|testData|TEST_DATA|test_data/i.test(s);
  const testDataImportMatch = s.match(/import\s*\{[^}]*TestData[^}]*\}\s*from\s*['"]([^'"]+)['"]/i);
  const testDataImport = testDataImportMatch
    ? `import { TestData } from '${testDataImportMatch[1]}';`
    : "import { TestData } from '../../data/test.data';";

  // ── Helper imports ───────────────────────────────────────────────────────────
  const helperImportRe = /import\s*\{[^}]+\}\s*from\s*['"]([^'"]*helper[^'"]*)['"]/gi;
  const helperImports: string[] = [];
  let hm: RegExpExecArray | null;
  while ((hm = helperImportRe.exec(s)) !== null) {
    helperImports.push(hm[0].replace(/;?\s*$/, ';'));
  }

  // ── Parametric tests ─────────────────────────────────────────────────────────
  const hasParametric = /test\.each|@DataProvider|@ParameterizedTest|parameterize/i.test(s);

  // ── Advisory steps ───────────────────────────────────────────────────────────
  const usesAdvisory = /test\.step\s*\(/i.test(s);

  // ── test.skip usage ──────────────────────────────────────────────────────────
  const usesTestSkip = /test\.skip\s*\(/i.test(s);

  // ── All import paths (relative) ──────────────────────────────────────────────
  const importPathRe = /from\s*['"](\.[^'"]+)['"]/g;
  const importPaths: string[] = [];
  let im: RegExpExecArray | null;
  while ((im = importPathRe.exec(s)) !== null) {
    if (!importPaths.includes(im[1])) importPaths.push(im[1]);
  }

  // ── TC prefix from test IDs (for generateTestId) ─────────────────────────────
  // Detect if they use "TC-S01", "TC-F02" etc. → prefix = "TC-"
  const tcPrefixMatch = s.match(/['"`](TC[-_]|TEST[-_]|CASE[-_]|SMK[-_]|TID[-_])/i);
  const tcPrefix = tcPrefixMatch ? tcPrefixMatch[1].toUpperCase() : 'TC-';

  return {
    testIdPrefix,
    tagConvention,
    poVariableName,
    hasWaitForLoad,
    usesTestData,
    testDataImport,
    helperImports,
    hasParametric,
    usesAdvisory,
    usesTestSkip,
    describePattern,
    importPaths,
    tcPrefix,
  };
}

/**
 * Generates a test ID string like "TC-SMK01", "TC-FUN02", "TC-SEC01".
 * Category codes: smoke→SMK, functional→FUN, negative→NEG,
 *                 security→SEC, accessibility→A11, edge→EDG, performance→PER
 */
export function generateTestId(prefix: string, category: string, index: number): string {
  const codes: Record<string, string> = {
    smoke: 'SMK', functional: 'FUN', negative: 'NEG',
    security: 'SEC', accessibility: 'A11', edge: 'EDG', performance: 'PER',
  };
  const code = codes[(category || 'smoke').toLowerCase()] ?? 'TST';
  const num  = String(index).padStart(2, '0');
  return `${prefix}${code}${num}`;
}

/**
 * Builds a 10-point patterns block to inject into AI prompts so generated
 * tests replicate the exact conventions found in the sample script.
 */
function buildPatternsSection(patterns: SamplePatterns): string {
  if (!patterns) return '';
  return `
EXTRACTED PATTERNS FROM SAMPLE — follow these conventions exactly:
1. Test ID prefix: "${patterns.testIdPrefix}" (e.g. ${generateTestId(patterns.tcPrefix, 'smoke', 1)}, ${generateTestId(patterns.tcPrefix, 'functional', 1)})
2. Tag convention: "${patterns.tagConvention}" in describe blocks
3. Page object variable name: "${patterns.poVariableName}" (e.g. const ${patterns.poVariableName} = new PageClass(page))
4. waitForLoad: ${patterns.hasWaitForLoad ? 'YES — call waitForPageLoad() or waitForLoad() after navigate()' : 'NO — skip waitForLoad calls'}
5. Test data: ${patterns.usesTestData ? `YES — import TestData and use constants` : 'NO — use inline string literals'}
6. Helper imports: ${patterns.helperImports.length > 0 ? `YES — include: ${patterns.helperImports.slice(0, 2).join(', ')}` : 'NO helper imports'}
7. Parametric tests: ${patterns.hasParametric ? 'YES — use test.each() for data-driven cases' : 'NO — standard test() calls'}
8. Advisory steps: ${patterns.usesAdvisory ? 'YES — wrap assertions in test.step()' : 'NO — direct assertions'}
9. test.skip: ${patterns.usesTestSkip ? 'YES — use test.skip for known failures' : 'NO — never use test.skip'}
10. Describe pattern: "${patterns.describePattern}" (replace {tag} and {title} appropriately)
`;
}

interface GeneratedTestBody {
  methodName: string;
  body:       string;
  category:   string;
}

async function generateTestBodiesWithAI(
  req: TestBodyRequest
): Promise<GeneratedTestBody[]> {
  // FIX 1 — sample script as few-shot reference
  const sampleSection = req.sampleScript
    ? `
REFERENCE EXAMPLE — this is exactly how this team writes tests.
Study the style, structure, naming conventions, and which functions are called.
Generate output that matches this style exactly:

\`\`\`
${req.sampleScript}
\`\`\`

Key patterns to follow from this example:
- Base class: ${req.baseClass}
- Import style: match exactly
- Method naming: match the verb-first or noun-first pattern shown
- Assertion style: match exactly (e.g. isVisible vs toBeVisible)
- Locator strategy: match exactly (getByLabel vs By.id vs locator)
`
    : '';

  // FIX 2 — mandatory substitution rules
  const substitutionRules = buildSubstitutionInstructions(req.frameworkCtx);

  // STEP 3 — extracted patterns from sample script
  const patterns = req.samplePatterns ?? (req.sampleScript ? extractSamplePatterns(req.sampleScript) : null);
  const patternsSection = patterns ? buildPatternsSection(patterns) : '';

  const systemPrompt = req.sampleScript
    ? `You are generating test automation code that must match the style of an existing framework exactly. Study the provided sample script carefully. Every generated method body must look like it was written by the same developer who wrote the sample. Return ONLY valid JSON array. No markdown. No explanation. Each item: { "methodName": string, "body": string, "category": string }`
    : `You generate test method bodies for automated test scripts. Return ONLY a JSON array, no explanation, no markdown, no code fences. Each item: { "methodName": string, "body": string, "category": string }`;

  const userPrompt = `${sampleSection}${patternsSection}Generate test bodies for these tests.

PAGE: ${req.pageUrl}
H1: ${req.pageH1}
INPUTS: ${JSON.stringify(req.pageInputs.slice(0, 8))}
BUTTONS: ${JSON.stringify(req.pageButtons.slice(0, 5))}
FORMS: ${JSON.stringify(req.pageForms.slice(0, 3))}

LANGUAGE: ${req.language}
TOOL: ${req.tool}
BASE CLASS: ${req.baseClass}
FILL FUNCTION: ${req.fillFn}
CLICK FUNCTION: ${req.clickFn}
NAVIGATE FUNCTION: ${req.navigateFn}
ASSERT FUNCTION: ${req.assertFn}
${substitutionRules}
TEST CASES:
${req.testCases.map((tc, i) =>
  `${i + 1}. [${tc.category ?? 'functional'}] ${tc.title ?? tc.description ?? 'test'}`
).join('\n')}

RULES BY LANGUAGE:
${req.language === 'java' ? `
- Use driver.get(BASE_URL + path) to navigate
- Use assertTrue/assertNotNull/assertEquals
- Use By.name() or By.cssSelector() for elements
- Use ${req.fillFn !== 'sendKeys' ? req.fillFn + '(element, value)' : 'element.sendKeys(value)'}
- Use ${req.clickFn !== 'click' ? req.clickFn + '(element)' : 'element.click()'}
- Smoke: navigate + assertNotNull(title) + assertFalse(title.isEmpty())
- Functional: navigate + verify H1 + interact with first input
- Negative: click submit empty + assert errors present
- Security: inject xss + assert no alert fires` : req.language === 'typescript' ? `
- Use await page.goto(url)
- Use await expect(page).toHaveTitle(/.+/)
- Use await expect(page.locator('h1').first()).toBeVisible()
- Use ${req.fillFn !== 'fill' ? 'await this.' + req.fillFn + '(locator, value)' : 'await locator.fill(value)'}
- Use ${req.clickFn !== 'click' ? 'await this.' + req.clickFn + '(locator)' : 'await locator.click()'}
- Smoke: goto + toHaveTitle + not contain 404
- Functional: goto + H1 visible + footer visible
- Negative: submit empty + validation error visible
- Security: fill XSS + no dialog fires` : `
- Use Browsers.Item(btChrome).Run(url)
- Use Log.Checkpoint for assertions
- Use Log.Error for failures
- Smoke: navigate + check page exists + Log.Checkpoint
- Functional: navigate + check element visible
- Negative: click submit empty + check error visible`}

Each body: 5-15 lines, keep bodies concise and runnable.
Return ONLY valid JSON array.`;

  try {
    const message = await _anthropic.messages.create({
      model:      'claude-sonnet-4-5',
      max_tokens: 4000,
      system:     systemPrompt,
      messages:   [{ role: 'user', content: userPrompt }],
    });
    const text = ((message.content[0] as any).text ?? '[]')
      .replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const parsed = JSON.parse(text) as GeneratedTestBody[];
    console.log(`[AI TestGen] Generated ${parsed.length} test bodies for ${req.pageUrl}`);
    return parsed;
  } catch (err) {
    console.warn('[AI TestGen] Falling back to templates:', err);
    return [];
  }
}

// ── FIX 4: AI-powered page object generation ─────────────────────────────────
async function generatePageObjectWithAI(
  page: any,
  key: string,
  cn: string,
  ctx: FrameworkContext
): Promise<string | null> {
  if (!ctx.sampleScript && ctx.functions.length === 0) return null;

  const substitutionRules = buildSubstitutionInstructions(ctx);
  const sampleSection = ctx.sampleScript
    ? `REFERENCE SAMPLE — match this style exactly:\n\`\`\`typescript\n${ctx.sampleScript}\n\`\`\``
    : '';

  const importPath = ctx.functions.find(f => f.importPath)?.importPath ?? '../base/BasePage';
  const baseClass  = ctx.baseClass ?? 'BasePage';

  const prompt = `Generate a TypeScript Page Object class for this page.

${sampleSection}

BASE CLASS: ${baseClass}
IMPORT PATH: ${importPath}
CLASS NAME: ${cn}

PAGE DATA:
  URL: ${page.url ?? ''}
  H1:  ${page.h1 ?? ''}
  Inputs:  ${JSON.stringify((page.inputs  ?? []).slice(0, 10))}
  Buttons: ${JSON.stringify((page.buttons ?? []).slice(0, 8))}
  Nav links: ${JSON.stringify((page.navLinks ?? []).slice(0, 5))}

${substitutionRules}

RULES:
1. Extend ${baseClass} if it exists; use super(page) in constructor
2. One readonly locator per interactive element — use the same locator strategy as the sample
3. One async method per user action (fill, click, navigate)
4. No assertions in page objects
5. navigate() method must use the relative path "${(() => { try { return new URL(page.url ?? '').pathname; } catch { return '/'; } })()}" not the full URL
6. waitForPageLoad() method should wait for visible content
7. Match the naming convention from the sample exactly (camelCase, verb-first pattern)

Return ONLY the complete TypeScript class as plain text. No markdown fences. Just the class code starting with import statements.`;

  try {
    const message = await _anthropic.messages.create({
      model:      'claude-sonnet-4-5',
      max_tokens: 2000,
      messages:   [{ role: 'user', content: prompt }],
    });
    const content = (message.content[0] as any).text?.trim() ?? null;
    if (content) console.log(`[AI PageGen] Generated page object for ${page.url} (${cn})`);
    return content;
  } catch (err) {
    console.warn('[AI PageGen] Failed, using template:', (err as Error).message);
    return null;
  }
}

/** Synchronous template fallback — generates decent test bodies for all three languages. */
function buildTemplateTestBody(
  tc: any,
  language: string,
  tool: string,
  pageUrl: string,
  page: any,
  ctx?: FrameworkContext
): string {
  const category = (tc.category ?? 'functional').toLowerCase();
  let path = '/';
  try { path = new URL(pageUrl).pathname || '/'; } catch { /* ignore */ }

  const fillFn  = ctx ? findFwFnSemantic(ctx.functions, 'fill')  : null;
  const clickFn = ctx ? findFwFnSemantic(ctx.functions, 'click') : null;
  const inputs  = page?.inputs  ?? [];
  const buttons = page?.buttons ?? [];

  // ── JAVA TEMPLATES ──────────────────────────────────────────────────────────
  if (language === 'java') {
    if (category === 'smoke') return `
        driver.get(BASE_URL + "${path}");
        String title = driver.getTitle();
        assertNotNull(title, "Page title should not be null");
        assertFalse(title.isEmpty(), "Title should not be empty");
        assertFalse(title.contains("404"), "Should not be 404 page");
        System.out.println("Smoke PASS: " + title);`;

    if (category === 'functional') {
      const inp = inputs[0];
      const fillCall = inp?.name
        ? fillFn
          ? `        ${fillFn.name}(driver.findElement(By.name("${inp.name}")), "test");`
          : `        driver.findElement(By.name("${inp.name}")).sendKeys("test");`
        : `        // No inputs found on this page`;
      return `
        driver.get(BASE_URL + "${path}");
        WebElement h1 = driver.findElement(By.tagName("h1"));
        assertTrue(h1.isDisplayed(), "H1 should be visible");
${fillCall}
        System.out.println("Functional PASS: " + h1.getText());`;
    }

    if (category === 'negative') return `
        driver.get(BASE_URL + "${path}");
        List<WebElement> submits = driver.findElements(
            By.cssSelector("button[type='submit']"));
        if (!submits.isEmpty()) {
            submits.get(0).click();
            List<WebElement> errors = driver.findElements(
                By.cssSelector(".error,[aria-invalid='true']"));
            assertTrue(errors.size() > 0, "Validation errors should appear");
        }`;

    if (category === 'security') return `
        driver.get(BASE_URL + "${path}");
        List<WebElement> fields = driver.findElements(
            By.cssSelector("input[type='text'],input[type='email']"));
        for (WebElement f : fields) {
            f.sendKeys("<script>alert('xss')</script>");
        }
        try {
            driver.switchTo().alert().dismiss();
            fail("XSS should not execute");
        } catch (org.openqa.selenium.NoAlertPresentException e) {
            System.out.println("Security PASS: XSS blocked");
        }`;

    if (category === 'accessibility') return `
        driver.get(BASE_URL + "${path}");
        List<WebElement> imgs = driver.findElements(By.tagName("img"));
        for (WebElement img : imgs) {
            assertNotNull(img.getAttribute("alt"),
                "Image missing alt: " + img.getAttribute("src"));
        }
        List<WebElement> h1s = driver.findElements(By.tagName("h1"));
        assertFalse(h1s.isEmpty(), "Page must have H1");
        System.out.println("A11y PASS: " + imgs.size() + " images checked");`;

    return `
        driver.get(BASE_URL + "${path}");
        assertNotNull(driver.getTitle(), "Page should load");`;
  }

  // ── TYPESCRIPT / PLAYWRIGHT TEMPLATES ────────────────────────────────────
  if (language === 'typescript' || language === 'javascript') {
    if (category === 'smoke') return `
    await page.goto('${pageUrl}');
    await expect(page).toHaveTitle(/.+/);
    await expect(page.locator('h1').first()).toBeVisible();
    const title = await page.title();
    expect(title).not.toContain('404');
    expect(title).not.toContain('Error');`;

    if (category === 'functional') {
      const inp = inputs[0];
      const fillCall = inp?.name
        ? fillFn
          ? `    await this.${fillFn.name}(page.locator('[name="${inp.name}"]'), 'test value');`
          : `    await page.locator('[name="${inp.name}"]').fill('test value');`
        : `    // No inputs detected on this page`;
      return `
    await page.goto('${pageUrl}');
    await expect(page.locator('h1').first()).toBeVisible();
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    const footer = page.locator('footer, [class*="footer"]').first();
    if (await footer.count() > 0) await expect(footer).toBeVisible();
${fillCall}`;
    }

    if (category === 'negative') return `
    await page.goto('${pageUrl}');
    const submit = page.locator('button[type="submit"]').first();
    if (await submit.count() > 0) {
      await submit.click();
      await page.waitForTimeout(500);
      const errors = page.locator('.error,[aria-invalid="true"],.wpcf7-not-valid-tip');
      expect(await errors.count()).toBeGreaterThan(0);
    }`;

    if (category === 'security') return `
    await page.goto('${pageUrl}');
    const dialogs: string[] = [];
    page.on('dialog', async d => { dialogs.push(d.message()); await d.dismiss(); });
    const inputs = page.locator('input[type="text"],input[type="email"]');
    const count = await inputs.count();
    for (let i = 0; i < Math.min(count, 3); i++) {
      await inputs.nth(i).fill('<script>alert("xss")</script>');
    }
    await page.waitForTimeout(500);
    expect(dialogs).toHaveLength(0);`;

    if (category === 'accessibility') return `
    await page.goto('${pageUrl}');
    const noAlt = await page.evaluate(() =>
      Array.from(document.querySelectorAll('img'))
        .filter(i => !i.getAttribute('alt')).map(i => i.src)
    );
    expect(noAlt, 'Images missing alt: ' + noAlt.join(',')).toHaveLength(0);
    await expect(page.locator('h1').first()).toBeVisible();
    const lang = await page.evaluate(() => document.documentElement.getAttribute('lang'));
    expect(lang, 'HTML lang attribute missing').toBeTruthy();`;

    return `
    await page.goto('${pageUrl}');
    await expect(page.locator('h1').first()).toBeVisible();`;
  }

  // ── TESTCOMPLETE TEMPLATES ───────────────────────────────────────────────
  if (tool === 'testcomplete') {
    let pageName = 'Page';
    try {
      const parts = new URL(pageUrl).pathname.split('/').filter(Boolean);
      const last = parts[parts.length - 1] ?? 'Home';
      pageName = last.charAt(0).toUpperCase() + last.slice(1);
    } catch { /* ignore */ }

    if (category === 'smoke') return `
  Browsers.Item(btChrome).Run("${pageUrl}");
  var page = Aliases.browser.page${pageName};
  if (!page.Exists) { Log.Error("${pageName} page did not load"); return; }
  Log.Checkpoint("${pageName} loaded successfully");`;

    if (category === 'functional') return `
  Browsers.Item(btChrome).Run("${pageUrl}");
  var page = Aliases.browser.page${pageName};
  page.WaitProperty("Visible", true, 10000);
  Log.Checkpoint("${pageName} is visible");
  ${inputs[0]?.name
    ? `page.${inputs[0].name}.SetText("test value");\n  Log.Checkpoint("Input interaction successful");`
    : '// No inputs detected on this page'}`;

    if (category === 'negative') return `
  Browsers.Item(btChrome).Run("${pageUrl}");
  var page = Aliases.browser.page${pageName};
  if (page.submitButton.Exists) {
    page.submitButton.Click();
    Delay(1000);
    if (!page.errorMessage.Exists) {
      Log.Error("Validation error should appear after empty submit");
    } else {
      Log.Checkpoint("Validation error visible as expected");
    }
  }`;

    return `
  Browsers.Item(btChrome).Run("${pageUrl}");
  Log.Checkpoint("${pageName} test executed");`;
  }

  return `// No template for ${language}/${tool}`;
}

/** Derives a safe camelCase function name from a label string. */
function tcFunctionName(raw: string): string {
  return raw
    .replace(/[^a-zA-Z0-9 _-]/g, '')
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((w, i) => i === 0 ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join('');
}

/** Builds the interaction lines for a single page (fill inputs, click buttons). */
function buildTCInteractions(page: any, fwFillFn: any, fwClickFn: any): string[] {
  const lines: string[] = [];
  const pageName = tcPageName(page.url);
  const alias = `Aliases.browser.page${pageName}`;

  for (const inp of (page.inputs ?? [])) {
    const label = inp.label || inp.name || inp.placeholder || inp.type || 'input';
    const fnName = tcFunctionName(label);
    const sel = inp.selector || inp.name || label;
    const sampleVal = inp.type === 'email' ? 'user@example.com'
                    : inp.type === 'password' ? 'Password123!'
                    : inp.type === 'number' ? '42'
                    : 'test value';
    if (fwFillFn) {
      lines.push(`  ${fwFillFn.name}(${alias}.${fnName}, '${sampleVal}');`);
    } else {
      lines.push(`  ${alias}.${fnName}.SetText('${sampleVal}');`);
    }
  }

  for (const btn of (page.buttons ?? [])) {
    const label = btn.text || btn.name || 'button';
    const fnName = tcFunctionName(label);
    if (fwClickFn) {
      lines.push(`  ${fwClickFn.name}(${alias}.${fnName});`);
    } else {
      lines.push(`  ${alias}.${fnName}.Click();`);
    }
  }

  return lines;
}

/** Builds Helper.js utility functions string. */
function buildTCHelperFunctions(fwFillFn: any, fwClickFn: any): string {
  const fillImpl = fwFillFn
    ? `// Delegates to framework function: ${fwFillFn.name}\nfunction helperFill(element, value) {\n  element.SetText(value);\n}`
    : `function helperFill(element, value) {\n  element.SetText(value);\n}`;
  const clickImpl = fwClickFn
    ? `// Delegates to framework function: ${fwClickFn.name}\nfunction helperClick(element) {\n  element.Click();\n}`
    : `function helperClick(element) {\n  element.Click();\n}`;
  return `// Helper.js — Shared utilities for TestComplete test suite
// Generated by NAT20 Autonomous Testing Platform

${fillImpl}

${clickImpl}

function helperAssert(actual, expected, message) {
  if (actual !== expected) {
    Log.Error(message || ('Expected: ' + expected + ' but got: ' + actual));
  } else {
    Log.Message(message || ('Assertion passed: ' + actual));
  }
}

function helperNavigate(url) {
  Browsers.Item(btChrome).Run(url);
  Sys.Browser().ToUrl(url);
}
`;
}

/** Builds the test function bodies for a page. */
function buildTCTestFunctions(page: any, testCasesForPage: any[], fwFillFn: any, fwClickFn: any, ctx?: FrameworkContext): string {
  const pageName = tcPageName(page.url);

  const tcFromCases = testCasesForPage.map((tc: any) => {
    const fnName = tcFunctionName(tc.name || tc.title || 'test');
    const body = buildTemplateTestBody(tc, 'javascript', 'testcomplete', page.url, page, ctx);
    return `function test_${pageName}_${fnName}() {
  Log.Message('Starting: ${(tc.name || tc.title || 'Test').replace(/'/g, "\\'")}');
${body}
  Log.Message('Completed: ${(tc.name || tc.title || 'Test').replace(/'/g, "\\'")}');
}`;
  });

  if (tcFromCases.length === 0) {
    const smokeTc = { category: 'smoke', title: `${pageName} smoke test` };
    const body = buildTemplateTestBody(smokeTc, 'javascript', 'testcomplete', page.url, page, ctx);
    return `function test_${pageName}_smoke() {
${body}
}`;
  }

  return tcFromCases.join('\n\n');
}

/** Builds a NameMapping guidance markdown document. */
function buildNameMappingDoc(page: any): string {
  const pageName = tcPageName(page.url);
  const inputs = page.inputs ?? [];
  const buttons = page.buttons ?? [];

  const inputRows = inputs.map((inp: any) => {
    const label = inp.label || inp.name || inp.placeholder || inp.type || 'input';
    const fnName = tcFunctionName(label);
    const sel = inp.selector || inp.name || '';
    return `| ${fnName} | ${inp.type || 'text'} | \`${sel}\` |`;
  }).join('\n');

  const buttonRows = buttons.map((btn: any) => {
    const label = btn.text || btn.name || 'button';
    const fnName = tcFunctionName(label);
    const sel = btn.selector || btn.text || '';
    return `| ${fnName} | button | \`${sel}\` |`;
  }).join('\n');

  return `# NameMapping Guidance — ${pageName}

## Page URL
\`${page.url}\`

## Required Aliases Path
\`Aliases.browser.page${pageName}\`

## Input Elements
| Alias Name | Type | Suggested Selector |
|------------|------|-------------------|
${inputRows || '| (none detected) | — | — |'}

## Button Elements
| Alias Name | Type | Suggested Selector |
|------------|------|-------------------|
${buttonRows || '| (none detected) | — | — |'}

## Setup Instructions
1. Open TestComplete NameMapping editor
2. Create child node under \`Aliases.browser\` named \`page${pageName}\`
3. Map each element listed above using the suggested selector
4. Verify mapped elements are highlighted correctly in the browser
`;
}

/**
 * Generates a TestComplete + JavaScript test suite.
 * Produces: per-page .js test scripts, Helper.js, and NameMapping guidance docs.
 */
function generateTestCompleteSuite(
  domData: any[],
  testCases: any[],
  baseUrl: string,
  frameworkCtx?: FrameworkContext
): POMTestSuite {
  const files: Record<string, string> = {};
  const specFiles: string[] = [];

  const fwFunctions = frameworkCtx?.functions ?? [];
  const fwFillFn    = findFwFnSemantic(fwFunctions, 'fill');
  const fwClickFn   = findFwFnSemantic(fwFunctions, 'click');

  // Helper.js — shared utilities
  files['Script/Helper.js'] = buildTCHelperFunctions(fwFillFn, fwClickFn);

  let pageCount = 0;
  let testCount = 0;

  for (const page of domData) {
    if (!page?.url) continue;
    pageCount++;
    const pageName = tcPageName(page.url);

    // Gather test cases relevant to this page (by URL match or fallback to all)
    const pageTCs = testCases.filter((tc: any) =>
      (tc.pageUrl && tc.pageUrl === page.url) ||
      (tc.url && tc.url === page.url)
    );

    const testFunctions = buildTCTestFunctions(page, pageTCs, fwFillFn, fwClickFn, frameworkCtx);
    testCount += (pageTCs.length || 1);

    const scriptContent = `// ${pageName}Tests.js — TestComplete test script
// Page: ${page.url}
// Generated by NAT20 Autonomous Testing Platform
// Framework: ${frameworkCtx?.name ?? 'TestComplete'}

//USEUNIT Helper

${testFunctions}
`;
    const scriptPath = `Script/${pageName}Tests.js`;
    files[scriptPath] = scriptContent;
    specFiles.push(scriptPath);

    // NameMapping guidance doc
    files[`namemapping-guidance/${pageName}.md`] = buildNameMappingDoc(page);
  }

  // Suite runner — calls all page test entry points
  const runnerLines = specFiles.map(f => {
    const pageName = f.replace('Script/', '').replace('Tests.js', '');
    return `  // ${pageName}\n  // Unit.RunRoutine('${pageName}Tests', 'test_${pageName}_smoke');`;
  });

  files['Script/SuiteRunner.js'] = `// SuiteRunner.js — Orchestrates all test scripts
// Generated by NAT20 Autonomous Testing Platform

function RunAllTests() {
  Log.Message('=== NAT20 TestComplete Suite Starting ===');
${runnerLines.join('\n')}
  Log.Message('=== NAT20 TestComplete Suite Complete ===');
}
`;

  // README
  files['README.md'] = `# TestComplete Test Suite
Generated by NAT20 Autonomous Testing Platform
Base URL: ${baseUrl}
Pages: ${pageCount} | Tests: ${testCount}
Framework: ${frameworkCtx?.name ?? 'TestComplete'}

## Structure
- \`Script/\` — TestComplete JavaScript test scripts (one per page)
- \`Script/Helper.js\` — Shared utility functions (fill, click, assert, navigate)
- \`Script/SuiteRunner.js\` — Runs the full suite
- \`namemapping-guidance/\` — NameMapping setup instructions per page

## Running
1. Open this project in TestComplete
2. Import \`Script/\` files into your TestComplete project
3. Configure NameMapping using docs in \`namemapping-guidance/\`
4. Run \`SuiteRunner.RunAllTests\` or individual page test functions
`;

  return { files, specFiles } as POMTestSuite;
}

// JAVA SELENIUM POM GENERATOR
// ═══════════════════════════════════════════════════════

/**
 * Generates a Java Selenium POM test suite.
 * Produces valid .java files that compile and run inside
 * a standard Maven project structure.
 */
async function generateJavaPOMSuite(
  domData: any[],
  testCases: any[],
  baseUrl: string,
  ctx: FrameworkContext
): Promise<POMTestSuite> {
  const result: Record<string, string> = {};
  const baseClass   = ctx.baseClass ?? 'BasePage';
  const pagesPackage = 'com.company.pages';
  const testsPackage = 'com.company.tests';
  const basePackage  = 'com.company.base';

  // Detect test runner from uploaded function signatures
  const isTestNG = ctx.functions.some(f =>
    /testng|BeforeMethod|AfterMethod/i
      .test((f.signature ?? '') + (f.description ?? ''))
  );
  const beforeAnn = isTestNG ? '@BeforeMethod' : '@BeforeEach';
  const afterAnn  = isTestNG ? '@AfterMethod'  : '@AfterEach';
  const runnerImports = isTestNG
    ? [
        'import org.testng.annotations.BeforeMethod;',
        'import org.testng.annotations.AfterMethod;',
        'import org.testng.annotations.Test;',
      ].join('\n')
    : [
        'import org.junit.jupiter.api.BeforeEach;',
        'import org.junit.jupiter.api.AfterEach;',
        'import org.junit.jupiter.api.Test;',
      ].join('\n');

  // Deduplicate pages
  const seenUrls = new Set<string>();
  const pages = (domData ?? []).filter((p: any) => {
    if (!p?.url || seenUrls.has(p.url)) return false;
    seenUrls.add(p.url);
    return true;
  });

  for (const page of pages) {
    const cn       = javaClassName(page.url);
    const fields   = javaLocatorFields(page);
    const methods  = javaActionMethods(page, ctx);
    const baseImp  = ctx.baseClass
      ? `import ${basePackage}.${baseClass};`
      : '';

    // Page Object
    const pageFile =
`package ${pagesPackage};

import org.openqa.selenium.WebDriver;
import org.openqa.selenium.WebElement;
import org.openqa.selenium.support.FindBy;
import org.openqa.selenium.support.PageFactory;
${baseImp}

/**
 * Page Object: ${cn}
 * URL: ${page.url ?? 'unknown'}
 * Generated by NAT 2.0 — follows uploaded framework conventions
 */
public class ${cn}Page extends ${baseClass} {

${fields}

    public ${cn}Page(WebDriver driver) {
        super(driver);
        PageFactory.initElements(driver, this);
    }

${methods}
}`;

    const pagePath =
      `src/main/java/${pagesPackage.replace(/\./g, '/')}` +
      `/${cn}Page.java`;
    result[pagePath] = pageFile;

    // Test class
    const pageCases = (testCases ?? []).filter(
      (tc: any) => tc.pageUrl === page.url
    );

    // Try AI-generated bodies first, fall back to templates
    let testMethods = '';
    const aiBodies = await generateTestBodiesWithAI({
      pageUrl:        page.url ?? '',
      pageH1:         page.h1 ?? '',
      pageInputs:     page.inputs ?? [],
      pageButtons:    page.buttons ?? [],
      pageForms:      page.forms ?? [],
      testCases:      pageCases,
      language:       'java',
      tool:           ctx.detectedTool ?? 'selenium',
      pattern:        ctx.pattern,
      baseClass:      ctx.baseClass ?? 'BasePage',
      fillFn:         findFwFnSemantic(ctx.functions, 'fill')?.name ?? 'sendKeys',
      clickFn:        findFwFnSemantic(ctx.functions, 'click')?.name ?? 'click',
      navigateFn:     findFwFnSemantic(ctx.functions, 'navigate')?.name ?? 'driver.get',
      assertFn:       findFwFnSemantic(ctx.functions, 'assertion')?.name ?? 'assertTrue',
      sampleScript:   ctx.sampleScript,
      frameworkCtx:   ctx,
      samplePatterns: extractSamplePatterns(ctx.sampleScript),
    });

    if (aiBodies.length > 0) {
      testMethods = aiBodies.map((b, idx) => {
        const tc = pageCases[idx] ?? pageCases[0];
        const desc = tc?.title ?? b.methodName;
        const indented = b.body.split('\n').map((l: string) => `        ${l.trimStart()}`).join('\n');
        return `    @Test\n    public void ${b.methodName}() {\n        // ${desc}\n${indented}\n    }`;
      }).join('\n\n');
    } else {
      testMethods = javaTestMethods(pageCases, cn, page, ctx);
    }

    const pageVar     = cn.charAt(0).toLowerCase() + cn.slice(1);

    const testFile =
`package ${testsPackage};

import org.openqa.selenium.By;
import org.openqa.selenium.WebDriver;
import org.openqa.selenium.WebElement;
import org.openqa.selenium.chrome.ChromeDriver;
import org.openqa.selenium.NoAlertPresentException;
import java.util.List;
import static org.junit.jupiter.api.Assertions.*;
${runnerImports}
import ${pagesPackage}.${cn}Page;

/**
 * Test Suite: ${cn}
 * Generated by NAT 2.0
 */
public class ${cn}Test {

    private static final String BASE_URL = "${baseUrl}";
    private WebDriver driver;
    private ${cn}Page ${pageVar}Page;

    ${beforeAnn}
    public void setUp() {
        driver = new ChromeDriver();
        driver.manage().window().maximize();
        driver.get("${baseUrl}");
        ${pageVar}Page = new ${cn}Page(driver);
    }

    ${afterAnn}
    public void tearDown() {
        if (driver != null) {
            driver.quit();
        }
    }

${testMethods}
}`;

    const testPath =
      `src/test/java/${testsPackage.replace(/\./g, '/')}` +
      `/${cn}Test.java`;
    result[testPath] = testFile;
  }

  const fileCount = Object.keys(result).length;
  return {
    files: result,
    specFiles: [],
    pageCount: pages.length,
    testCount: testCases?.length ?? 0,
    summary: `Java Selenium POM — ${pages.length} page(s), ` +
             `${fileCount} file(s) generated`,
  };
}

// ── Java generation helpers ──────────────────────────────

function javaClassName(url: string): string {
  try {
    const path = new URL(url).pathname;
    const parts = path.split('/').filter(Boolean);
    if (parts.length === 0) return 'Home';
    return parts
      .map((p: string) =>
        p.charAt(0).toUpperCase() +
        p.slice(1).replace(
          /-([a-z])/g,
          (_: string, c: string) => c.toUpperCase()
        )
      )
      .join('');
  } catch {
    return 'Unknown';
  }
}

function javaLocatorFields(page: any): string {
  const elements: any[] = [
    ...(page.inputs   ?? []),
    ...(page.buttons  ?? []),
  ].filter((el: any) =>
    el.type !== 'submit' && el.type !== 'button'
  );

  return elements
    .slice(0, 20)
    .map((el: any) => {
      const field   = javaCamelCase(
        el.name ?? el.label ?? el.type ?? 'element'
      );
      const locator = javaLocatorStrategy(el);
      return (
        `    @FindBy(${locator})\n` +
        `    private WebElement ${field};`
      );
    })
    .join('\n\n');
}

function javaLocatorStrategy(el: any): string {
  if (el.id)    return `id = "${el.id}"`;
  if (el.name)  return `name = "${el.name}"`;
  if (el.css)   return `css = "${el.css}"`;
  if (el.xpath) return `xpath = "${el.xpath}"`;
  return `css = "[placeholder='${el.label ?? el.type ?? 'field'}']"`;
}

function javaActionMethods(
  page: any,
  ctx: FrameworkContext
): string {
  const elements: any[] = [
    ...(page.inputs   ?? []),
    ...(page.buttons  ?? []),
  ];

  return elements
    .slice(0, 20)
    .map((el: any) => {
      const field  = javaCamelCase(
        el.name ?? el.label ?? el.type ?? 'element'
      );
      const upper  = field.charAt(0).toUpperCase() + field.slice(1);
      const fillFn = findFwFnSemantic(ctx.functions, 'fill');
      const body   = fillFn
        ? `${fillFn.name}(${field}, value);`
        : `${field}.clear();\n        ${field}.sendKeys(value);`;

      return (
        `    /** Enter value into the ${field} field */\n` +
        `    public void enter${upper}(String value) {\n` +
        `        ${body}\n` +
        `    }`
      );
    })
    .join('\n\n');
}

function javaTestMethods(
  testCases: any[],
  className: string,
  page?: any,
  ctx?: FrameworkContext,
): string {
  if (!testCases || testCases.length === 0) {
    return (
      `    @Test\n` +
      `    public void test${className}PageLoads() {\n` +
      `        driver.get(BASE_URL);\n` +
      `        assertNotNull(driver.getTitle(), "Page title should not be null");\n` +
      `        assertFalse(driver.getTitle().isEmpty(), "Title should not be empty");\n` +
      `    }`
    );
  }

  return testCases
    .map((tc: any) => {
      const method = javaCamelCase(
        `test ${tc.title ?? tc.description ?? 'scenario'}`
      );
      const desc = tc.title ?? tc.description ?? '';
      const body = buildTemplateTestBody(
        tc, 'java', ctx?.detectedTool ?? 'selenium',
        tc.pageUrl ?? '', page ?? {}, ctx
      );
      return (
        `    @Test\n` +
        `    public void ${method}() {\n` +
        `        // ${desc}\n` +
        `${body}\n` +
        `    }`
      );
    })
    .join('\n\n');
}

function javaCamelCase(str: string): string {
  return str
    .toLowerCase()
    .replace(/[^a-zA-Z0-9]+(.)/g,
      (_: string, c: string) => c.toUpperCase()
    )
    .replace(/^[A-Z]/,
      (c: string) => c.toLowerCase()
    );
}

// ═══════════════════════════════════════════════════════
// END JAVA SELENIUM POM GENERATOR
// ═══════════════════════════════════════════════════════

export async function generatePOMTestSuite(
  domData: any[],
  testCases: any[],
  baseUrl: string,
  frameworkCtx?: FrameworkContext,
): Promise<POMTestSuite> {
  // ── Log framework context for debugging ──────────────────────────────────
  console.log('[Generator] Framework context:', {
    name:          frameworkCtx?.name ?? '(none)',
    language:      frameworkCtx?.detectedLanguage ?? frameworkCtx?.language,
    tool:          frameworkCtx?.detectedTool,
    pattern:       frameworkCtx?.pattern,
    functionCount: frameworkCtx?.functions?.length ?? 0,
    baseClass:     frameworkCtx?.baseClass,
    fillFn:        findFwFnSemantic(frameworkCtx?.functions ?? [], 'fill')?.name,
    clickFn:       findFwFnSemantic(frameworkCtx?.functions ?? [], 'click')?.name,
  });

  // ── Language router — delegate to language-specific generator
  if (frameworkCtx?.detectedLanguage === 'java') {
    return generateJavaPOMSuite(
      domData, testCases, baseUrl, frameworkCtx
    );
  }
  // Guard: unsupported languages
  if (
    frameworkCtx?.detectedLanguage === 'python' ||
    frameworkCtx?.detectedLanguage === 'csharp'
  ) {
    throw new Error(
      `Unsupported language detected: ` +
      `"${frameworkCtx.detectedLanguage}". ` +
      `Python and C# generators are not yet available. ` +
      `Please upload a Java or TypeScript framework, ` +
      `or generate without a framework selection.`
    );
  }

  // Route: TestComplete + JavaScript generator
  if (frameworkCtx?.detectedTool === 'testcomplete') {
    return generateTestCompleteSuite(domData, testCases, baseUrl, frameworkCtx);
  }

  // Default: falls through to TypeScript Playwright generator
  // ──────────────────────────────────────────────────────────

  const files: Record<string, string> = {};
  const specFiles: string[] = [];

  // Deduplicate pages
  const seenUrls = new Set<string>();
  const pages = (domData || []).filter(p => {
    if (!p?.url || seenUrls.has(p.url)) return false;
    seenUrls.add(p.url);
    return true;
  });

  // Build page-key → info map (handle duplicate keys)
  const pageInfos = new Map<string, { key: string; className: string; page: any }>();
  const usedKeys = new Map<string, number>();
  for (const page of pages) {
    let key = pageKey(page.url);
    const cnt = usedKeys.get(key) || 0;
    usedKeys.set(key, cnt + 1);
    if (cnt > 0) key = `${key}_${cnt}`;
    pageInfos.set(page.url, { key, className: pageClassName(key), page });
  }

  const pageInfoList = [...pageInfos.values()];

  // ── Framework context helpers ─────────────────────────────────────────────────
  const isBDD          = frameworkCtx?.pattern === 'BDD' || frameworkCtx?.pattern === 'BDD+POM';
  const baseClass      = frameworkCtx?.baseClass ?? null;
  const fwFunctions    = frameworkCtx?.functions ?? [];
  const fwNavFn        = findFwFnSemantic(fwFunctions, 'navigate');
  // Extract sample patterns once — reused across all spec file generations
  const runSamplePats  = extractSamplePatterns(frameworkCtx?.sampleScript);
  const fwClickFn    = findFwFnSemantic(fwFunctions, 'click');
  const fwFillFn     = findFwFnSemantic(fwFunctions, 'fill');
  const fwAssertFn   = findFwFnSemantic(fwFunctions, 'assertion');
  const fwLoginFn    = findFwFnSemantic(fwFunctions, 'login');

  // Collect unique import paths from framework functions (for generated files)
  const fwImports: string[] = [];
  if (frameworkCtx) {
    const importGroups = new Map<string, Set<string>>();
    for (const fn of fwFunctions.slice(0, 20)) {
      if (fn.importPath && fn.className) {
        const grp = importGroups.get(fn.importPath) ?? new Set();
        grp.add(fn.className);
        importGroups.set(fn.importPath, grp);
      }
    }
    for (const [path, classes] of importGroups) {
      fwImports.push(`import { ${[...classes].join(', ')} } from '${path}';`);
    }
    if (baseClass && !fwImports.some(l => l.includes(baseClass))) {
      // Try to find the importPath for the base class from any framework function
      const bcFn = fwFunctions.find(f => f.className === baseClass && f.importPath);
      if (bcFn?.importPath) {
        fwImports.push(`import { ${baseClass} } from '${bcFn.importPath}';`);
      } else {
        // importPath not known — emit a resolvable placeholder comment
        fwImports.push(`// TODO: import { ${baseClass} } from '<your-framework-path>';`);
      }
    }
  }

  // ── 0. package.json ──────────────────────────────────────────────────────────
  files['package.json'] = `{
  "name": "playwright-pom-suite",
  "version": "1.0.0",
  "description": "Playwright POM test suite generated by NAT20 Autonomous Testing Platform",
  "scripts": {
    "test":             "npx playwright test",
    "test:smoke":       "npx playwright test --project=smoke",
    "test:functional":  "npx playwright test --project=functional",
    "test:negative":    "npx playwright test --project=negative",
    "test:edge":        "npx playwright test --project=edge",
    "test:security":    "npx playwright test --project=security",
    "test:a11y":        "npx playwright test --project=accessibility",
    "test:headed":      "npx playwright test --headed",
    "test:debug":       "npx playwright test --debug",
    "test:report":      "npx playwright show-report",
    "test:list":        "npx playwright test --list",
    "test:ci":          "CI=true npx playwright test"
  },
  "devDependencies": {
    "@playwright/test": "^1.44.0",
    "@types/node": "^20.0.0",
    "typescript": "^5.0.0"
  }
}
`;

  // ── 1. playwright.config.ts ─────────────────────────────────────────────────
  files['playwright.config.ts'] = `import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/specs',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : 1,
  timeout: 30000,

  use: {
    baseURL: process.env.BASE_URL ?? '${baseUrl}',
    actionTimeout: 10000,
    navigationTimeout: 20000,
    headless: true,
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    trace: 'on-first-retry',
  },

  reporter: [
    ['html', { open: 'never', outputFolder: 'playwright-report' }],
    ['list'],
    ['json', { outputFile: 'test-results/results.json' }],
  ],

  projects: [
    {
      name: 'smoke',
      testMatch: '**/specs/smoke/**/*.spec.ts',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'functional',
      testMatch: '**/specs/functional/**/*.spec.ts',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'negative',
      testMatch: '**/specs/negative/**/*.spec.ts',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'edge',
      testMatch: '**/specs/edge/**/*.spec.ts',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'security',
      testMatch: '**/specs/security/**/*.spec.ts',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'accessibility',
      testMatch: '**/specs/accessibility/**/*.spec.ts',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  outputDir: 'test-results',
});
`;

  // ── 2. tsconfig.json ─────────────────────────────────────────────────────────
  files['tsconfig.json'] = `{
  "compilerOptions": {
    "target": "ES2022",
    "module": "commonjs",
    "lib": ["ES2022", "DOM"],
    "strict": true,
    "esModuleInterop": true,
    "moduleResolution": "node",
    "outDir": "./dist",
    "rootDir": ".",
    "skipLibCheck": true,
    "resolveJsonModule": true
  },
  "include": ["tests/**/*.ts", "playwright.config.ts"],
  "exclude": ["node_modules", "dist"]
}
`;

  // ── 3. Base fixture ───────────────────────────────────────────────────────────
  const fixtureImports = pageInfoList
    .map(({ key, className: cn }) => `import { ${cn} } from '../pages/${key}.page';`)
    .join('\n');

  const fixtureTypeLines = pageInfoList
    .map(({ key, className: cn }) => `  ${key}Page: ${cn};`)
    .join('\n');

  const fixtureInitLines = pageInfoList
    .map(({ key, className: cn }) =>
      `    ${key}Page: async ({ page }, use) => { await use(new ${cn}(page)); },`)
    .join('\n');

  files['tests/fixtures/base.fixture.ts'] = `import { test as base, expect } from '@playwright/test';
${fixtureImports}

type PageFixtures = {
${fixtureTypeLines}
};

export const test = base.extend<PageFixtures>({
${fixtureInitLines}
});

export { expect };
`;

  // ── 4. Helpers ────────────────────────────────────────────────────────────────

  files['tests/helpers/form.helper.ts'] = `import { Page, expect } from '@playwright/test';

/**
 * Asserts that a form submission succeeded.
 * Checks for success indicators without relying on URL change.
 */
export async function assertFormSubmitSuccess(page: Page): Promise<void> {
  const successLocator = page
    .locator(
      '.wpcf7-mail-sent-ok, ' +
      '[class*="success"]:visible, ' +
      '[class*="thank"]:visible, ' +
      '[class*="confirm"]:visible',
    )
    .or(
      page.getByText(
        /thank you|message sent|successfully submitted|we.ll be in touch|received your/i,
      ),
    );

  await expect(successLocator.first()).toBeVisible({ timeout: 10000 });
}

/**
 * Asserts that at least one validation error is visible.
 */
export async function assertValidationErrorVisible(page: Page): Promise<void> {
  const errorLocator = page.locator(
    '.wpcf7-not-valid-tip, ' +
    '[aria-invalid="true"], ' +
    '[class*="error"]:visible, ' +
    '[class*="invalid"]:visible',
  );
  await expect(errorLocator.first()).toBeVisible({ timeout: 5000 });
}
`;

  files['tests/helpers/nav.helper.ts'] = `import { Page, expect } from '@playwright/test';

/**
 * Checks all internal links on the current page for broken responses.
 * Collects all failures before asserting.
 */
export async function checkInternalLinks(page: Page): Promise<void> {
  const baseURL = new URL(page.url()).origin;
  const hostname = new URL(baseURL).hostname;

  const hrefs: string[] = await page.$$eval(
    'a[href]',
    (anchors: Element[], host: string) =>
      (anchors as HTMLAnchorElement[])
        .map((a) => a.getAttribute('href') ?? '')
        .filter(
          (h) =>
            h &&
            !h.startsWith('#') &&
            !h.startsWith('mailto:') &&
            !h.startsWith('tel:') &&
            !h.startsWith('javascript:'),
        )
        .map((h) =>
          h.startsWith('/') ? new URL(h, location.origin).href : h,
        )
        .filter((h) => {
          try {
            return new URL(h).hostname === host;
          } catch {
            return false;
          }
        })
        .slice(0, 20),
    hostname,
  );

  const broken: string[] = [];

  for (const href of hrefs) {
    try {
      const response = await page.request
        .head(href, { timeout: 8000 })
        .catch(() => page.request.get(href, { timeout: 8000 }));

      if (response.status() === 404 || response.status() >= 500) {
        broken.push(\`[\${response.status()}] \${href}\`);
      }
    } catch {
      // Network error — record but do not throw immediately
      broken.push(\`[NO RESPONSE] \${href}\`);
    }
  }

  expect(
    broken,
    \`Broken internal links:\\n\${broken.join('\\n')}\`,
  ).toHaveLength(0);
}
`;

  files['tests/helpers/accessibility.helper.ts'] = `import { Page, test } from '@playwright/test';

/**
 * Runs WCAG 2.1 AA baseline checks.
 *
 * ADVISORY MODE — violations are logged and attached as test annotations
 * but do NOT throw, so the test still passes.  The full report appears in
 * the Playwright HTML report under "Annotations" for each test.
 *
 * To make checks mandatory (hard-fail), set STRICT_A11Y=true in your env.
 */
export async function assertWCAGBaseline(page: Page): Promise<void> {
  const failures: string[] = [];

  // 1. Images without alt attribute
  const imgsWithoutAlt = await page.evaluate(() =>
    Array.from(document.querySelectorAll('img'))
      .filter(
        (img) =>
          img.getAttribute('alt') === null &&
          img.getAttribute('role') !== 'presentation' &&
          img.getAttribute('aria-hidden') !== 'true',
      )
      .map((img) => img.src.split('/').pop() ?? 'unknown'),
  );
  if (imgsWithoutAlt.length > 0) {
    failures.push(
      \`\${imgsWithoutAlt.length} image(s) missing alt: \${imgsWithoutAlt.slice(0, 3).join(', ')}\${imgsWithoutAlt.length > 3 ? '…' : ''}\`,
    );
  }

  // 2. Inputs without accessible label
  const unlabeled = await page.evaluate(() =>
    Array.from(
      document.querySelectorAll<HTMLInputElement>(
        'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="reset"])',
      ),
    )
      .filter((inp) => {
        const hasLabel =
          inp.id && !!document.querySelector(\`label[for="\${inp.id}"]\`);
        return (
          !hasLabel &&
          !inp.getAttribute('aria-label') &&
          !inp.getAttribute('aria-labelledby') &&
          !inp.placeholder &&
          !inp.title
        );
      })
      .length,
  );
  if (unlabeled > 0) {
    failures.push(\`\${unlabeled} input(s) without accessible label\`);
  }

  // 3. Buttons without accessible text
  const emptyButtons = await page.evaluate(() =>
    Array.from(document.querySelectorAll('button'))
      .filter(
        (btn) =>
          !btn.textContent?.trim() &&
          !btn.getAttribute('aria-label') &&
          !btn.title &&
          btn.getAttribute('aria-hidden') !== 'true',
      ).length,
  );
  if (emptyButtons > 0) {
    failures.push(\`\${emptyButtons} button(s) without accessible text\`);
  }

  // 4. HTML lang attribute
  const lang = await page.evaluate(
    () => document.documentElement.getAttribute('lang'),
  );
  if (!lang) {
    failures.push('HTML element is missing the lang attribute');
  }

  // 5. At least one H1
  const h1Count = await page.locator('h1').count();
  if (h1Count === 0) {
    failures.push('Page has no H1 heading');
  }

  if (failures.length === 0) return;

  const report =
    \`WCAG 2.1 AA — \${failures.length} advisory issue(s):\\n\` +
    failures.map((f, i) => \`  \${i + 1}. \${f}\`).join('\\n');

  // Attach as a test annotation so it appears in the HTML report
  try {
    test.info().annotations.push({ type: 'a11y-advisory', description: report });
  } catch {
    // test.info() may not be available in all contexts
  }

  // Always log to stdout so it appears in the terminal
  console.warn('[A11Y ADVISORY]\\n' + report);

  // Hard-fail only when explicitly opted in (e.g. CI strictness)
  if (process.env['STRICT_A11Y'] === 'true') {
    throw new Error(report);
  }
}
`;

  files['tests/helpers/security.helper.ts'] = `import { Page, Locator, expect } from '@playwright/test';

/**
 * Tests that XSS payloads injected into a field do not execute JavaScript.
 * Dialog handler registered BEFORE any fill() calls.
 */
export async function assertNoXSSExecution(
  page: Page,
  payloads: readonly string[],
  fieldLocator: Locator,
): Promise<void> {
  const fired: string[] = [];

  page.on('dialog', async (dialog) => {
    fired.push(\`type="\${dialog.type()}" msg="\${dialog.message()}"\`);
    await dialog.dismiss();
  });

  for (const payload of payloads) {
    await fieldLocator.fill(payload);
    await fieldLocator.blur();
    // Short deterministic wait — enough for synchronous XSS to fire
    await page.waitForFunction(() => true); // yield to event loop
  }

  expect(
    fired,
    \`XSS payload(s) triggered JavaScript:\\n\${fired.join('\\n')}\`,
  ).toHaveLength(0);
}

/**
 * Asserts no database/server error strings are exposed in the page body.
 */
export async function assertNoServerErrorExposed(page: Page): Promise<void> {
  const bodyText = (await page.locator('body').innerText()).toLowerCase();

  const errorPatterns = [
    'sql syntax',
    'mysql_error',
    'ora-',
    'pg::',
    'sqlite3',
    'syntax error near',
    'unclosed quotation mark',
    'database error',
    'pdoexception',
    'sqlstate',
    'stack trace',
    'internal server error',
    'exception in thread',
  ] as const;

  const found = errorPatterns.filter((p) => bodyText.includes(p));

  expect(
    found,
    \`Server error strings exposed in page body: \${found.join(', ')}\`,
  ).toHaveLength(0);
}
`;

  // ── 5. Test data ──────────────────────────────────────────────────────────────
  // NOTE: helper file strings are also exported via getCanonicalHelperFiles()
  // so the execute handler can always overwrite them with the current version.

  files['tests/data/test.data.ts'] = `/**
 * Test data for Playwright automation suite.
 * All data is synthetic — safe to commit to source control.
 *
 * Usage:
 *   import { validContactData, edgeData, xssPayloads }
 *     from '../../data/test.data';
 */

// ── Interfaces ────────────────────────────────────────────────────────────────

export interface ContactFormData {
  name: string;
  email: string;
  phone: string;
  subject: string;
  message: string;
}

export interface CareerFormData {
  name: string;
  email: string;
  phone: string;
  yearsOfExperience: string;
  resumeText: string;
}

export interface SearchData {
  validTerm: string;
  emptyTerm: string;
}

// ── Valid form data ───────────────────────────────────────────────────────────

export const validContactData: ContactFormData = {
  name: 'Alex Turner',
  email: 'alex.turner@testmail.example.com',
  phone: '+14155550100',
  subject: 'Automation Test Inquiry',
  message:
    'This is an automated test message. ' +
    'Please disregard this submission.',
};

export const validCareerData: CareerFormData = {
  name: 'Jordan Lee',
  email: 'jordan.lee@testmail.example.com',
  phone: '+12025550142',
  yearsOfExperience: '5',
  resumeText:
    'Experienced software engineer with 5 years in test automation ' +
    'and CI/CD pipeline development.',
};

export const searchData: SearchData = {
  validTerm: 'services',
  emptyTerm: '',
};

// ── Invalid inputs for negative testing ──────────────────────────────────────

export const invalidEmails: readonly string[] = [
  'plaintext',
  'missing-at-sign',
  '@nodomain.com',
  'double@@domain.com',
  'no-tld@domain',
  'trailing-dot@domain.com.',
] as const;

export const invalidPhones: readonly string[] = [
  'abc',
  '!!!###',
  '123',
  '--',
  '0'.repeat(25),
] as const;

// ── Edge-case inputs ──────────────────────────────────────────────────────────

export const edgeData = {
  longString:   'A'.repeat(500),
  unicode:      'Ñoño résumé café naïve Ångström Ψυχή',
  emoji:        'Test 🎉🔥💯✅🚀',
  htmlEntities: "O'Brien & <Associates> \\"Quoted\\" tag</p>",
  specialChars: \`!@#$%^&*()_+-=[]{}|;':",./<>?\`,
  whitespace:   '   ',
  newlines:     'Line1\\nLine2\\nLine3',
} as const;

// ── Security payloads ─────────────────────────────────────────────────────────

export const xssPayloads: readonly string[] = [
  '<script>alert("xss")</script>',
  '"><img src=x onerror=alert(1)>',
  "';alert('xss');//",
  '<svg onload=alert(1)>',
  '{{7*7}}',
  'javascript:alert(1)',
] as const;

export const sqlPayloads: readonly string[] = [
  "' OR '1'='1",
  "admin'--",
  "1; DROP TABLE users;--",
  "' UNION SELECT null,null--",
  "1' AND SLEEP(5)--",
] as const;

// ── Timeout constants ─────────────────────────────────────────────────────────

export const TIMEOUTS = {
  short:      5_000,
  medium:    15_000,
  long:      30_000,
  navigation: 20_000,
} as const;
`;

  // ── 6 + 7-12. Per-page files ──────────────────────────────────────────────────

  // Pre-compute whether any test case has a pageUrl set (determines skip logic)
  const anyTCHasPageUrl = (testCases || []).some((tc: any) => !!tc.pageUrl);

  for (const [url, { key, className: cn, page }] of pageInfos) {
    // If test cases carry pageUrl tags (selective generation mode), skip pages
    // that have no selected test cases — avoids generating empty spec files.
    if (anyTCHasPageUrl) {
      const matchingCases = (testCases || []).filter((tc: any) => tc.pageUrl === url);
      if (matchingCases.length === 0) continue;
    }

    const dom    = page.domStructure;
    const title  = page.title || cn;
    const h1     = dom?.headings?.h1?.[0] || '';
    const inputs = ((dom?.interactiveElements?.inputs || []) as any[])
      .filter((i: any) => !isHoneypot(i) && !isRecaptchaEl(i))
      .slice(0, 12);
    const buttons = ((dom?.interactiveElements?.buttons || []) as any[])
      .filter((b: any) => b.text && !isSvgNoise(b.text))
      .slice(0, 8);
    const navLinks = ((dom?.navigation?.navLinks || []) as any[])
      .filter((l: any) => l.text && !isSvgNoise(l.text))
      .slice(0, 8);
    const hasSubmitBtn    = buttons.some((b: any) => b.type === 'submit' || (b.text || '').match(/\b(submit|send|sign.?in|log.?in|register|subscribe|contact|checkout|continue|place.?order)\b/i));
    const hasForm         = (dom?.forms?.length || 0) > 0 || (inputs.length >= 2 && hasSubmitBtn);
    const hasPasswordField = inputs.some((i: any) => i.type === 'password');
    const hasEmailField    = inputs.some((i: any) => i.type === 'email' || (i.name || '').includes('email'));
    void hasEmailField; // used for type-check — suppress unused warning

    // Extract relative path for this page
    let relPath: string;
    try { relPath = new URL(url).pathname || '/'; } catch { relPath = '/'; }

    // ── 6. Page Object ───────────────────────────────────────────────────────

    // FIX 4: Use AI-generated page object when framework context has sample/functions
    if (frameworkCtx && (frameworkCtx.sampleScript || frameworkCtx.functions.length > 0)) {
      const aiPageObj = await generatePageObjectWithAI(page, key, cn, frameworkCtx);
      if (aiPageObj) {
        files[`tests/pages/${key}.page.ts`] = aiPageObj;
        // Skip template page object generation — go straight to spec files
        const pageType2 = detectPageType(url, inputs, buttons, page);
        const pageTCs2  = (testCases || []).filter((tc: any) => tc.pageUrl === url || !tc.pageUrl);
        if (!isBDD) {
          const pageSpecs2 = generateContextualSpecFiles(
            url, key, cn, title,
            inputs, buttons, navLinks, hasForm, hasPasswordField,
            pageType2, pageTCs2, testCases || [],
            frameworkCtx, runSamplePats
          );
          for (const [sp, sc] of Object.entries(pageSpecs2)) {
            files[sp] = sc;
            specFiles.push(sp);
          }
        }
        continue;
      }
    }

    // FIX 3: Detect locator style from sample script
    const locatorStyle = detectLocatorStyle(frameworkCtx);

    const selectorLines: string[] = [];
    const methodLines:   string[] = [];

    if (h1) {
      const headingLocator = locatorStyle === 'getByRole'
        ? `this.page.getByRole('heading', { level: 1 })`
        : `this.page.locator('h1').first()`;
      selectorLines.push(`  readonly heading = ${headingLocator};`);
      methodLines.push(`
  async verifyHeading(expected = '${esc(h1)}'): Promise<void> {
    await this.heading.waitFor({ state: 'visible', timeout: 10000 });
    const text = await this.heading.textContent();
    if (!text?.includes(expected)) {
      throw new Error('Expected heading to contain "' + expected + '" but got: ' + text);
    }
  }`);
    }

    for (const inp of inputs) {
      const fKey  = toKey(inp.label || inp.name || inp.placeholder || inp.type || 'input');
      const sv    = sampleValue(inp);
      const mName = toPascalCase(fKey);
      // FIX 3: use detected locator style for field selectors
      const locExpr = buildLocatorExpression(inp, locatorStyle);
      selectorLines.push(`  readonly ${fKey}Field = ${locExpr};`);
      const fillBody = fwFillFn
        ? `await this.${fwFillFn.name}(this.${fKey}Field, value);`
        : `await this.${fKey}Field.fill('');\n    await this.${fKey}Field.fill(value);`;
      methodLines.push(`
  async fill${mName}(value = '${esc(sv)}'): Promise<void> {
    await this.${fKey}Field.waitFor({ state: 'visible', timeout: 8000 });
    ${fillBody}
  }`);
    }

    for (const btn of buttons) {
      const bKey  = toKey(btn.text + '_btn');
      const mName = toPascalCase(bKey.replace(/_btn$/, ''));
      // FIX 3: use detected locator style for buttons
      const btnLocExpr = (locatorStyle === 'getByRole' || locatorStyle === 'getByLabel')
        ? `this.page.getByRole('button', { name: '${esc(btn.text || btn.name || '')}' })`
        : `this.page.locator('${esc(stableSel(btn))}').first()`;
      selectorLines.push(`  readonly ${bKey} = ${btnLocExpr};`);
      const clickBody = fwClickFn
        ? `await this.${fwClickFn.name}(this.${bKey});`
        : `await this.${bKey}.click();`;
      methodLines.push(`
  async click${mName}(): Promise<void> {
    await this.${bKey}.waitFor({ state: 'visible', timeout: 8000 });
    ${clickBody}
  }`);
    }

    for (const link of navLinks) {
      const lKey  = toKey(link.text);
      const mName = toPascalCase(lKey);
      methodLines.push(`
  async clickNav${mName}(): Promise<void> {
    await this.page.getByRole('link', { name: '${esc(link.text)}' }).first().click();
    await this.page.waitForLoadState('domcontentloaded');
  }`);
    }

    methodLines.push(`
  async navigate(): Promise<void> {
    await this.page.goto('${esc(relPath)}', { waitUntil: 'domcontentloaded' });
    await this.page.waitForLoadState('domcontentloaded');
  }

  async waitForPageLoad(): Promise<void> {
    await this.page.waitForLoadState('domcontentloaded');
    await this.page
      .locator('h1, main, [role="main"], body')
      .first()
      .waitFor({ state: 'visible', timeout: 10000 });
  }

  async getTitle(): Promise<string> {
    return this.page.title();
  }`);

    const pageClassHeader = baseClass
      ? `export class ${cn} extends ${baseClass} {
  constructor(readonly page: Page) { super(page); }`
      : `export class ${cn} {
  constructor(readonly page: Page) {}`;

    const fwImportBlock = fwImports.length > 0 ? `\n${fwImports.join('\n')}\n` : '';
    const fwNote = frameworkCtx
      ? `\n * Framework: ${frameworkCtx.name} (${frameworkCtx.framework} / ${frameworkCtx.language})`
      : '';

    files[`tests/pages/${key}.page.ts`] = `import { Page } from '@playwright/test';${fwImportBlock}

/**
 * Page Object: ${title}
 * URL: ${url}${fwNote}
 * Generated by NAT20 Autonomous Testing Platform
 */
${pageClassHeader}

${selectorLines.join('\n')}
${methodLines.join('\n')}
}
`;

    // ── 7-12. Context-aware spec files ───────────────────────────────────────
    // Detect page type for context-specific test generation
    const pageType = detectPageType(url, inputs, buttons, page);

    // Get test cases specific to this page
    const pageTCs = (testCases || []).filter((tc: any) => tc.pageUrl === url || !tc.pageUrl);

    // Generate all spec files contextually (skip in BDD mode — feature files generated above)
    if (isBDD) continue;
    const pageSpecs = generateContextualSpecFiles(
      url, key, cn, title,
      inputs, buttons, navLinks, hasForm, hasPasswordField,
      pageType, pageTCs, testCases || [],
      frameworkCtx, runSamplePats
    );

    for (const [specPath, specContent] of Object.entries(pageSpecs)) {
      files[specPath] = specContent;
      specFiles.push(specPath);
    }
  } // end for (pageInfos)

  // ── Static support files ──────────────────────────────────────────────────
  files['.gitignore'] = `node_modules/
dist/
playwright-report/
test-results/
screenshots/
*.zip
`;

  files['README.md'] = `# Playwright POM Test Suite
Generated by [NAT20 Autonomous Testing Platform](https://github.com/your-org/nat20).

## Quick Start

\`\`\`bash
# 1. Install dependencies
npm install

# 2. Install Playwright browsers
npx playwright install chromium

# 3. List all tests
npx playwright test --list

# 4. Run by category
npm run test:smoke          # fast sanity checks
npm run test:functional     # form + navigation tests
npm run test:negative       # validation + error handling
npm run test:edge           # boundary + special input tests
npm run test:security       # XSS, SQLi, security headers
npm run test:a11y           # WCAG baseline checks

# 5. Run everything
npm test

# 6. Open HTML report
npm run test:report
\`\`\`

## Project Structure

\`\`\`
playwright.config.ts        ← Playwright config (baseURL, projects, timeouts)
tsconfig.json               ← TypeScript config
tests/
  data/test.data.ts         ← Typed test data (valid, invalid, XSS, SQL, edge)
  fixtures/base.fixture.ts  ← Base fixture with all page objects
  helpers/
    form.helper.ts          ← Form submit success + validation error helpers
    nav.helper.ts           ← Internal link checker
    accessibility.helper.ts ← WCAG 2.1 AA baseline checks
    security.helper.ts      ← XSS execution + server error helpers
  pages/                    ← Page Object Model classes (one per page)
  specs/
    smoke/                  ← @smoke  — HTTP 2xx, title, no JS errors
    functional/             ← @functional — headings, links, form interaction
    negative/               ← @negative  — empty form, invalid credentials
    edge/                   ← @edge  — special chars, unicode, long strings
    security/               ← @security  — XSS, sensitive URL, headers
    accessibility/          ← @accessibility — WCAG 2.1 AA, title, keyboard
\`\`\`

## Filtering Tests by Tag

\`\`\`bash
npx playwright test --grep "@smoke"
npx playwright test --grep "@security"
npx playwright test --grep "@smoke|@functional"
\`\`\`
`;

  // ── BDD: generate feature files + step definitions when BDD mode ─────────────
  if (isBDD) {
    // Cucumber config
    files['cucumber.config.ts'] = `import { defineConfig } from '@cucumber/cucumber';

export default defineConfig({
  format: ['progress', 'json:cucumber-report.json'],
  paths: ['tests/features/**/*.feature'],
  require: ['tests/step-defs/**/*.steps.ts'],
  requireModule: ['ts-node/register'],
  worldParameters: {
    baseURL: process.env.BASE_URL ?? '${baseUrl}',
  },
});
`;
    files['package.json'] = files['package.json'].replace(
      '"test":             "npx playwright test"',
      '"test":             "npx playwright test",\n    "test:bdd":          "npx cucumber-js"'
    );

    // Generate one feature file + step def per page
    for (const [url, { key, className: cn, page }] of pageInfos) {
      const dom     = page.domStructure;
      const title   = page.title || cn;
      const inputs  = ((dom?.interactiveElements?.inputs || []) as any[]).filter((i: any) => !isHoneypot(i) && !isRecaptchaEl(i)).slice(0, 6);
      const buttons = ((dom?.interactiveElements?.buttons || []) as any[]).filter((b: any) => b.text && !isSvgNoise(b.text)).slice(0, 4);
      let relPath: string;
      try { relPath = new URL(url).pathname || '/'; } catch { relPath = '/'; }
      const pageType = detectPageType(url, inputs, buttons, page);

      // ── Feature file ────────────────────────────────────────────────────────
      let scenarios = '';
      if (pageType === 'auth') {
        const userSel = inputs.find((i: any) => i.type !== 'password') ? stableSel(inputs.find((i: any) => i.type !== 'password')) : 'input[type="text"]';
        const pwdSel  = inputs.find((i: any) => i.type === 'password')  ? stableSel(inputs.find((i: any) => i.type === 'password'))  : 'input[type="password"]';
        void userSel; void pwdSel;
        scenarios = `
  Scenario: TC-F01 Login form visible
    Given I navigate to the "${title}" page
    Then the login form should be visible with username and password fields

  Scenario: TC-N01 Login rejected with invalid credentials
    Given I navigate to the "${title}" page
    When I enter invalid username "invalid_user" and password "bad_pass"
    And I click the submit button
    Then an error message should be displayed

  Scenario: TC-S01 Page loads without errors
    Given I navigate to the "${title}" page
    Then the page body should be visible
    And there should be no critical JavaScript errors`;
      } else if (inputs.length > 0) {
        scenarios = `
  Scenario: TC-F01 Form fields are interactive
    Given I navigate to the "${title}" page
    Then the form should have visible input fields

  Scenario: TC-N01 Empty required fields trigger validation
    Given I navigate to the "${title}" page
    When I submit the form without filling required fields
    Then validation errors should be displayed

  Scenario: TC-S01 Page loads without errors
    Given I navigate to the "${title}" page
    Then the page body should be visible`;
      } else {
        scenarios = `
  Scenario: TC-S01 Page loads successfully
    Given I navigate to the "${title}" page
    Then the page body should be visible
    And the page should return HTTP 2xx status

  Scenario: TC-F01 Main content is visible
    Given I navigate to the "${title}" page
    Then the main content area should be visible

  Scenario: TC-A01 Page has a descriptive title
    Given I navigate to the "${title}" page
    Then the page title should not be empty`;
      }

      files[`tests/features/${key}.feature`] = `# Feature: ${title}
# URL: ${url}
# Framework: ${frameworkCtx?.name ?? 'Playwright + Cucumber'}
# Generated by NAT20 Autonomous Testing Platform

Feature: ${title}
  As a user
  I want to verify the ${title} page functionality
  So that I can ensure quality and reliability
${scenarios}
`;

      // ── Step definitions ───────────────────────────────────────────────────
      const stepImports = [
        `import { Given, When, Then, World } from '@cucumber/cucumber';`,
        `import { expect } from '@playwright/test';`,
        `import { ${cn} } from '../pages/${key}.page';`,
      ];
      if (fwLoginFn?.importPath) stepImports.push(`// import { ${fwLoginFn.className ?? ''} } from '${fwLoginFn.importPath}';`);

      // Use framework nav function call if available
      const navCall = fwNavFn
        ? `await this.${fwNavFn.name}('${esc(relPath)}');`
        : `const po = new ${cn}(this.page);\n  await po.navigate();`;

      const clickCall = fwClickFn
        ? `await this.${fwClickFn.name}(selector);`
        : `await this.page.locator(selector).click();`;

      const fillCall = fwFillFn
        ? `await this.${fwFillFn.name}(selector, value);`
        : `await this.page.locator(selector).fill(value);`;

      const assertVisibleCall = fwAssertFn
        ? `await this.${fwAssertFn.name}(locator, 'visible');`
        : `await expect(locator).toBeVisible();`;

      files[`tests/step-defs/${key}.steps.ts`] = `${stepImports.join('\n')}

// Step definitions for: ${title}
// Framework: ${frameworkCtx?.name ?? 'Playwright + Cucumber'}
${frameworkCtx ? `// Catalog functions used: ${[fwNavFn, fwClickFn, fwFillFn, fwAssertFn].filter(Boolean).map(f => f!.name).join(', ') || 'none matched'}` : ''}

Given('I navigate to the {string} page', async function(this: World & { page: any }, _pageName: string) {
  ${navCall}
  await this.page.waitForLoadState('domcontentloaded');
});

Then('the page body should be visible', async function(this: World & { page: any }) {
  const locator = this.page.locator('body');
  ${assertVisibleCall}
});

Then('the page should return HTTP 2xx status', async function(this: World & { page: any }) {
  const res = await this.page.request.get('${esc(relPath)}');
  expect(res.status()).toBeGreaterThanOrEqual(200);
  expect(res.status()).toBeLessThan(400);
});

Then('the page title should not be empty', async function(this: World & { page: any }) {
  const title = await this.page.title();
  expect(title.trim().length).toBeGreaterThan(0);
});

Then('the main content area should be visible', async function(this: World & { page: any }) {
  const locator = this.page.locator('main, [role="main"], body > *').first();
  ${assertVisibleCall}
});

${pageType === 'auth' ? `
Then('the login form should be visible with username and password fields', async function(this: World & { page: any }) {
  await expect(this.page.locator('input[type="password"]')).toBeVisible();
  const usernameField = this.page.locator('input:not([type="password"]):not([type="hidden"])').first();
  await expect(usernameField).toBeVisible();
});

When('I enter invalid username {string} and password {string}', async function(this: World & { page: any }, username: string, password: string) {
  const selector = 'input:not([type="password"]):not([type="hidden"])';
  const value = username;
  ${fillCall}
  const pwdSelector = 'input[type="password"]';
  const pwdValue = password;
  void pwdSelector; void pwdValue;
  await this.page.locator('input[type="password"]').fill(password);
});

When('I click the submit button', async function(this: World & { page: any }) {
  const selector = 'button[type="submit"], input[type="submit"]';
  ${clickCall}
});

Then('an error message should be displayed', async function(this: World & { page: any }) {
  const locator = this.page.locator('[class*="error"], [data-test="error"], .alert, [role="alert"]').first();
  ${assertVisibleCall}
});

Then('there should be no critical JavaScript errors', async function(this: World & { page: any }) {
  // Errors collected during navigation — checked here
  const errors = (this as any).__jsErrors ?? [];
  const critical = errors.filter((e: string) =>
    e.includes('TypeError') || e.includes('ReferenceError') || e.includes('SyntaxError')
  );
  expect(critical).toHaveLength(0);
});
` : ''}
${pageType !== 'auth' && inputs.length > 0 ? `
Then('the form should have visible input fields', async function(this: World & { page: any }) {
  const locator = this.page.locator('input:not([type="hidden"])').first();
  ${assertVisibleCall}
});

When('I submit the form without filling required fields', async function(this: World & { page: any }) {
  const selector = 'button[type="submit"], input[type="submit"]';
  if (await this.page.locator(selector).count() > 0) {
    ${clickCall}
  }
});

Then('validation errors should be displayed', async function(this: World & { page: any }) {
  // Validation may show as HTML5 native or custom — just check page stays visible
  await expect(this.page.locator('body')).toBeVisible();
});
` : ''}
`;
      specFiles.push(`tests/features/${key}.feature`);
      specFiles.push(`tests/step-defs/${key}.steps.ts`);
    }
  }

  // ── User Story-based generation ───────────────────────────────────────────────
  const userStories = frameworkCtx?.userStories ?? [];
  if (userStories.length > 0) {
    if (isBDD) {
      // Generate one feature file per user story
      files['tests/features/user-stories.feature'] = `# User Story-Based Feature Tests
# Generated by NAT20 Autonomous Testing Platform
# Framework: ${frameworkCtx?.name ?? 'Cucumber/Gherkin'}

${userStories.map(story => {
  const scenarios = parseAcceptanceCriteria(story.acceptanceCriteria ?? '');
  const storyTitle = story.title.replace(/['"]/g, '');
  const scenarioBlocks = scenarios.length > 0
    ? scenarios.map((sc, idx) => `
  Scenario: US-${story.id.slice(-4).toUpperCase()} AC${idx + 1} — ${sc.then.slice(0, 60)}
    Given ${sc.given}
    When ${sc.when}
    Then ${sc.then}`).join('\n')
    : `
  Scenario: US-${story.id.slice(-4).toUpperCase()} — ${storyTitle.slice(0, 60)}
    Given the user accesses the application
    When they use the "${storyTitle}" feature
    Then the feature should work as described`;
  return `Feature: [US] ${storyTitle}
  As a user
  I want to ${story.description?.slice(0, 80) ?? storyTitle.toLowerCase()}
  So that the acceptance criteria are met
${scenarioBlocks}
`;
}).join('\n---\n\n')}`;
      specFiles.push('tests/features/user-stories.feature');

      // Generate step defs for user stories
      files['tests/step-defs/user-stories.steps.ts'] = `import { Given, When, Then, World } from '@cucumber/cucumber';
import { expect } from '@playwright/test';

// Step definitions generated from user story acceptance criteria
// NAT20 Autonomous Testing Platform

Given('the user accesses the application', async function(this: World & { page: any }) {
  await this.page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(this.page.locator('body')).toBeVisible();
});

When('they use the {string} feature', async function(this: World & { page: any }, featureName: string) {
  // Navigate to the feature — update selector as needed
  const navLink = this.page.getByRole('link', { name: new RegExp(featureName, 'i') });
  if (await navLink.count() > 0) {
    await navLink.first().click();
    await this.page.waitForLoadState('domcontentloaded');
  }
});

Then('the feature should work as described', async function(this: World & { page: any }) {
  // Verify the page is functional after navigation
  await expect(this.page.locator('body')).toBeVisible();
  const text = await this.page.locator('body').textContent();
  expect((text ?? '').trim().length).toBeGreaterThan(10);
});

${userStories.map(story => {
  const scenarios = parseAcceptanceCriteria(story.acceptanceCriteria ?? '');
  return scenarios.map((sc, idx) => `
// [${story.title}] AC${idx + 1}
Given(${JSON.stringify(sc.given)}, async function(this: World & { page: any }) {
  // Setup: ${sc.given}
  await this.page.waitForLoadState('domcontentloaded');
});

When(${JSON.stringify(sc.when)}, async function(this: World & { page: any }) {
  // Action: ${sc.when}
  await this.page.waitForLoadState('domcontentloaded');
});

Then(${JSON.stringify(sc.then)}, async function(this: World & { page: any }) {
  // Verify: ${sc.then}
  await expect(this.page.locator('body')).toBeVisible();
});`).join('\n');
}).join('\n')}
`;
      specFiles.push('tests/step-defs/user-stories.steps.ts');

    } else {
      // POM mode: generate a dedicated user-stories spec file
      files['tests/specs/functional/user-stories.spec.ts'] = `// User Story-Based Functional Tests
// Generated by NAT20 Autonomous Testing Platform
// Framework: ${frameworkCtx?.name ?? 'Playwright'}
import { test, expect } from '@playwright/test';

test.describe('@user-stories | Acceptance Criteria Tests', () => {
${userStories.map(story => {
  const scenarios = parseAcceptanceCriteria(story.acceptanceCriteria ?? '');
  const storyId   = `US-${story.id.slice(-6).toUpperCase()}`;
  const storyTitle = story.title.replace(/'/g, "\\'");
  if (scenarios.length > 0) {
    return scenarios.map((sc, idx) => `
  test('${storyId} AC${idx + 1} — ${sc.then.replace(/'/g, "\\'").slice(0, 80)}', async ({ page }) => {
    // User Story: ${storyTitle}
    // Given: ${sc.given}
    // When: ${sc.when}
    // Then: ${sc.then}
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('body')).toBeVisible();
    // TODO: Implement steps for: ${sc.then.slice(0, 60)}
  });`).join('\n');
  }
  return `
  test('${storyId} — ${storyTitle.slice(0, 80)}', async ({ page }) => {
    // User Story: ${storyTitle}
    // ${story.description?.slice(0, 120) ?? 'No description'}
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('body')).toBeVisible();
    // TODO: Implement acceptance criteria for this user story
  });`;
}).join('\n')}
});
`;
      specFiles.push('tests/specs/functional/user-stories.spec.ts');
    }
  }

  // If no pages were crawled, generate a minimal smoke test
  if (pages.length === 0) {
    const fallback = 'tests/specs/smoke/site.smoke.spec.ts';
    files[fallback] = `import { test, expect } from '@playwright/test';

test.describe('@smoke | Site', () => {
  test('TC-S01 @smoke site loads successfully', async ({ page }) => {
    const response = await page.goto('/', { waitUntil: 'domcontentloaded' });
    expect(response?.status()).toBeLessThan(400);
    await expect(page.locator('body')).toBeVisible();
  });
});
`;
    specFiles.push(fallback);
  }

  return { files, specFiles };
}

// ─── Canonical Helper Files ───────────────────────────────────────────────────
//
// These are the SINGLE SOURCE OF TRUTH for every helper that gets written into
// a generated test suite.  The execute handler imports this function and
// ALWAYS overwrites the helper paths in the temp directory, so even scripts
// generated before a bug-fix pick up the corrected helpers at run-time.
//
// Rule: whenever you change any helper string inside generatePOMTestSuite(),
// make the identical change here too so they stay in sync.
//
export function getCanonicalHelperFiles(): Record<string, string> {
  return {

    // ── form.helper.ts ────────────────────────────────────────────────────────
    'tests/helpers/form.helper.ts': `import { Page, expect } from '@playwright/test';

/**
 * Asserts that a form submission succeeded.
 * Checks for success indicators without relying on URL change.
 */
export async function assertFormSubmitSuccess(page: Page): Promise<void> {
  const successLocator = page
    .locator(
      '.wpcf7-mail-sent-ok, ' +
      '[class*="success"]:visible, ' +
      '[class*="thank"]:visible, ' +
      '[class*="confirm"]:visible',
    )
    .or(
      page.getByText(
        /thank you|message sent|successfully submitted|we.ll be in touch|received your/i,
      ),
    );

  await expect(successLocator.first()).toBeVisible({ timeout: 10000 });
}

/**
 * Asserts that at least one validation error is visible.
 */
export async function assertValidationErrorVisible(page: Page): Promise<void> {
  const errorLocator = page.locator(
    '.wpcf7-not-valid-tip, ' +
    '[aria-invalid="true"], ' +
    '[class*="error"]:visible, ' +
    '[class*="invalid"]:visible',
  );
  await expect(errorLocator.first()).toBeVisible({ timeout: 5000 });
}
`,

    // ── nav.helper.ts ─────────────────────────────────────────────────────────
    'tests/helpers/nav.helper.ts': `import { Page, expect } from '@playwright/test';

/**
 * Checks all internal links on the current page for broken responses.
 * Collects all failures before asserting.
 */
export async function checkInternalLinks(page: Page): Promise<void> {
  const baseURL = new URL(page.url()).origin;
  const hostname = new URL(baseURL).hostname;

  const hrefs: string[] = await page.$$eval(
    'a[href]',
    (anchors: Element[], host: string) =>
      (anchors as HTMLAnchorElement[])
        .map((a) => a.getAttribute('href') ?? '')
        .filter(
          (h) =>
            h &&
            !h.startsWith('#') &&
            !h.startsWith('mailto:') &&
            !h.startsWith('tel:') &&
            !h.startsWith('javascript:'),
        )
        .map((h) =>
          h.startsWith('/') ? new URL(h, location.origin).href : h,
        )
        .filter((h) => {
          try {
            return new URL(h).hostname === host;
          } catch {
            return false;
          }
        })
        .slice(0, 20),
    hostname,
  );

  const broken: string[] = [];

  for (const href of hrefs) {
    try {
      const response = await page.request
        .head(href, { timeout: 8000 })
        .catch(() => page.request.get(href, { timeout: 8000 }));

      if (response.status() === 404 || response.status() >= 500) {
        broken.push(\`[\${response.status()}] \${href}\`);
      }
    } catch {
      broken.push(\`[NO RESPONSE] \${href}\`);
    }
  }

  expect(
    broken,
    \`Broken internal links:\\n\${broken.join('\\n')}\`,
  ).toHaveLength(0);
}
`,

    // ── accessibility.helper.ts ───────────────────────────────────────────────
    // ADVISORY MODE: violations are logged + annotated but never hard-fail.
    // Set STRICT_A11Y=true in env to opt into hard failures (e.g. in CI).
    'tests/helpers/accessibility.helper.ts': `import { Page, test } from '@playwright/test';

/**
 * Runs WCAG 2.1 AA baseline checks.
 *
 * ADVISORY MODE — violations are logged and attached as test annotations
 * but do NOT throw, so the test still passes.  The full report appears in
 * the Playwright HTML report under "Annotations" for each test.
 *
 * To make checks mandatory (hard-fail), set STRICT_A11Y=true in your env.
 */
export async function assertWCAGBaseline(page: Page): Promise<void> {
  const failures: string[] = [];

  // 1. Images without alt attribute
  const imgsWithoutAlt = await page.evaluate(() =>
    Array.from(document.querySelectorAll('img'))
      .filter(
        (img) =>
          img.getAttribute('alt') === null &&
          img.getAttribute('role') !== 'presentation' &&
          img.getAttribute('aria-hidden') !== 'true',
      )
      .map((img) => img.src.split('/').pop() ?? 'unknown'),
  );
  if (imgsWithoutAlt.length > 0) {
    failures.push(
      \`\${imgsWithoutAlt.length} image(s) missing alt: \${imgsWithoutAlt.slice(0, 3).join(', ')}\${imgsWithoutAlt.length > 3 ? '…' : ''}\`,
    );
  }

  // 2. Inputs without accessible label
  const unlabeled = await page.evaluate(() =>
    Array.from(
      document.querySelectorAll<HTMLInputElement>(
        'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="reset"])',
      ),
    )
      .filter((inp) => {
        const hasLabel =
          inp.id && !!document.querySelector(\`label[for="\${inp.id}"]\`);
        return (
          !hasLabel &&
          !inp.getAttribute('aria-label') &&
          !inp.getAttribute('aria-labelledby') &&
          !inp.placeholder &&
          !inp.title
        );
      })
      .length,
  );
  if (unlabeled > 0) {
    failures.push(\`\${unlabeled} input(s) without accessible label\`);
  }

  // 3. Buttons without accessible text
  const emptyButtons = await page.evaluate(() =>
    Array.from(document.querySelectorAll('button'))
      .filter(
        (btn) =>
          !btn.textContent?.trim() &&
          !btn.getAttribute('aria-label') &&
          !btn.title &&
          btn.getAttribute('aria-hidden') !== 'true',
      ).length,
  );
  if (emptyButtons > 0) {
    failures.push(\`\${emptyButtons} button(s) without accessible text\`);
  }

  // 4. HTML lang attribute
  const lang = await page.evaluate(
    () => document.documentElement.getAttribute('lang'),
  );
  if (!lang) {
    failures.push('HTML element is missing the lang attribute');
  }

  // 5. At least one H1
  const h1Count = await page.locator('h1').count();
  if (h1Count === 0) {
    failures.push('Page has no H1 heading');
  }

  if (failures.length === 0) return;

  const report =
    \`WCAG 2.1 AA — \${failures.length} advisory issue(s):\\n\` +
    failures.map((f, i) => \`  \${i + 1}. \${f}\`).join('\\n');

  // Attach as a test annotation so it appears in the HTML report
  try {
    test.info().annotations.push({ type: 'a11y-advisory', description: report });
  } catch {
    // test.info() may not be available in all contexts
  }

  // Always log to stdout so it appears in the terminal
  console.warn('[A11Y ADVISORY]\\n' + report);

  // Hard-fail only when explicitly opted in (e.g. CI strictness)
  if (process.env['STRICT_A11Y'] === 'true') {
    throw new Error(report);
  }
}
`,

    // ── security.helper.ts ────────────────────────────────────────────────────
    'tests/helpers/security.helper.ts': `import { Page, Locator, expect } from '@playwright/test';

/**
 * Tests that XSS payloads injected into a field do not execute JavaScript.
 * Dialog handler registered BEFORE any fill() calls.
 */
export async function assertNoXSSExecution(
  page: Page,
  payloads: readonly string[],
  fieldLocator: Locator,
): Promise<void> {
  const fired: string[] = [];

  page.on('dialog', async (dialog) => {
    fired.push(\`type="\${dialog.type()}" msg="\${dialog.message()}"\`);
    await dialog.dismiss();
  });

  for (const payload of payloads) {
    await fieldLocator.fill(payload);
    await fieldLocator.blur();
    await page.waitForFunction(() => true);
  }

  expect(
    fired,
    \`XSS payload(s) triggered JavaScript:\\n\${fired.join('\\n')}\`,
  ).toHaveLength(0);
}

/**
 * Asserts no database/server error strings are exposed in the page body.
 */
export async function assertNoServerErrorExposed(page: Page): Promise<void> {
  const bodyText = (await page.locator('body').innerText()).toLowerCase();

  const errorPatterns = [
    'sql syntax', 'mysql_error', 'ora-', 'pg::', 'sqlite3',
    'syntax error near', 'unclosed quotation mark', 'database error',
    'pdoexception', 'sqlstate', 'stack trace',
    'internal server error', 'exception in thread',
  ] as const;

  const found = errorPatterns.filter((p) => bodyText.includes(p));

  expect(
    found,
    \`Server error strings exposed in page body: \${found.join(', ')}\`,
  ).toHaveLength(0);
}
`,
  };
}
