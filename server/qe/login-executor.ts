/**
 * LoginExecutor — performs authenticated login on a Playwright Page.
 *
 * IMPORTANT: We receive the CRAWL PAGE itself (not a fresh page).
 * This ensures that cookies + localStorage + sessionStorage obtained
 * during login are available to the crawler without any cross-tab gap.
 *
 * Flow:
 *   1. If loginUrl not provided → auto-discover by probing common paths
 *   2. Navigate crawlPage to the login URL
 *   3. Auto-detect (or use provided) username/password/submit selectors
 *   4. Fill credentials + submit
 *   5. Wait + verify (URL change, auth indicators)
 *   6. On success, navigate crawlPage BACK to startUrl for crawling
 */
import { Page } from 'playwright';

export interface LoginConfig {
  loginUrl?: string;   // optional — auto-discovered if blank
  startUrl: string;    // main crawl target; page is returned here after login
  username: string;
  password: string;
  authType: 'form' | 'basic' | 'custom';
  usernameSelector?: string;
  passwordSelector?: string;
  loginButtonSelector?: string;
  waitAfterLoginMs?: number;
  timeout?: number;
  onProgress?: (message: string, detail?: string) => void;
}

export interface LoginResult {
  success: boolean;
  loginUrl?: string;
  effectiveStartUrl?: string;  // where browser actually landed after auth — use this as crawl start
  error?: string;
  detectedSelectors?: { usernameSelector: string; passwordSelector: string; submitSelector: string };
}

const LOGIN_PATHS = [
  '/login', '/signin', '/sign-in', '/log-in',
  '/auth/login', '/auth/signin',
  '/account/login', '/account/signin',
  '/user/login', '/users/sign_in',
  '/admin/login', '/portal/login',
  '/wp-login.php',
  '/session/new',
  '/members/login',
];

export class LoginExecutor {

  /**
   * Execute login on the given page.
   * The page is navigated to loginUrl, credentials filled, then
   * returned to startUrl on success.
   */
  async executeLogin(page: Page, config: LoginConfig): Promise<LoginResult> {
    const timeout = config.timeout ?? 30000;
    const on = config.onProgress;

    try {
      // ── Step 1: Resolve login URL ──────────────────────────────────────────
      let loginUrl = config.loginUrl;

      if (!loginUrl) {
        on?.('Discovering login page…', 'Scanning common paths on the target domain');
        loginUrl = await this.discoverLoginUrl(config.startUrl, page, timeout, on) ?? undefined;
        if (!loginUrl) {
          on?.('✗ Login page not found', 'No login form found at /login, /signin, etc. — enter Login URL manually.');
          return { success: false, error: 'Could not find a login page. Enter the Login URL in the auth settings.' };
        }
      }

      // ── Step 2: Navigate to login page ─────────────────────────────────────
      on?.(`Navigating to login page…`, loginUrl);
      console.log(`[LoginExecutor] Navigating to: ${loginUrl}`);
      await page.goto(loginUrl, { waitUntil: 'domcontentloaded', timeout });
      // Extra wait for JS-heavy SPAs to render the login form
      await page.waitForTimeout(1800);
      on?.(`Login page ready`, `Loaded: ${page.url()}`);

      // Make sure we're actually on the login page (handle redirects)
      const actualLoginUrl = page.url();
      if (actualLoginUrl !== loginUrl && !actualLoginUrl.includes('login') && !actualLoginUrl.includes('signin')) {
        console.log(`[LoginExecutor] Redirected from ${loginUrl} to ${actualLoginUrl} — trying again`);
        await page.goto(loginUrl, { waitUntil: 'domcontentloaded', timeout }).catch(() => {});
        await page.waitForTimeout(1200);
      }

      // ── Step 3: Resolve selectors ──────────────────────────────────────────
      let usernameSelector = config.usernameSelector;
      let passwordSelector = config.passwordSelector;
      let submitSelector   = config.loginButtonSelector;

      if (!usernameSelector || !passwordSelector) {
        on?.('Detecting form fields…', 'Looking for username + password inputs');
        const detected = await this.detectLoginForm(page);
        if (detected) {
          usernameSelector = usernameSelector || detected.usernameSelector;
          passwordSelector = passwordSelector || detected.passwordSelector;
          submitSelector   = submitSelector   || detected.submitSelector;
          console.log(`[LoginExecutor] Detected → user: ${usernameSelector}  pwd: ${passwordSelector}  submit: ${submitSelector}`);
        } else {
          on?.('✗ Login form not detected', 'No password field found — specify selectors in Advanced settings');
          return { success: false, error: 'No login form found on the page', loginUrl };
        }
      } else {
        console.log(`[LoginExecutor] Using provided selectors → user: ${usernameSelector}  pwd: ${passwordSelector}`);
      }

      // ── Step 4: Clear fields + fill credentials ────────────────────────────
      on?.(`Filling credentials…`, `username: ${config.username}`);
      console.log(`[LoginExecutor] Filling username (${usernameSelector}) with: ${config.username}`);
      try {
        await page.waitForSelector(usernameSelector!, { state: 'visible', timeout: 8000 });
        await page.click(usernameSelector!);
        await page.fill(usernameSelector!, '');            // clear first
        await page.fill(usernameSelector!, config.username);
      } catch (e: any) {
        on?.(`✗ Cannot fill username`, `Selector: ${usernameSelector} — ${e.message}`);
        return { success: false, error: `Cannot fill username (${usernameSelector}): ${e.message}`, loginUrl };
      }

      console.log(`[LoginExecutor] Filling password (${passwordSelector})`);
      try {
        await page.waitForSelector(passwordSelector!, { state: 'visible', timeout: 5000 });
        await page.click(passwordSelector!);
        await page.fill(passwordSelector!, '');            // clear first
        await page.fill(passwordSelector!, config.password);
      } catch (e: any) {
        on?.(`✗ Cannot fill password`, `Selector: ${passwordSelector} — ${e.message}`);
        return { success: false, error: `Cannot fill password (${passwordSelector}): ${e.message}`, loginUrl };
      }

      // ── Step 5: Take screenshot before submit (for debugging) ─────────────
      try {
        await page.screenshot({ path: 'screenshots/login-before-submit.png', type: 'png' });
        console.log('[LoginExecutor] Screenshot saved: login-before-submit.png');
      } catch {}

      // ── Step 6: Submit ─────────────────────────────────────────────────────
      on?.(`Submitting login form…`, submitSelector ? `Clicking: ${submitSelector}` : 'Pressing Enter');
      console.log(`[LoginExecutor] Submitting via: ${submitSelector || 'Enter key'}`);
      if (submitSelector) {
        try {
          await page.waitForSelector(submitSelector, { state: 'visible', timeout: 5000 });
          await page.click(submitSelector);
        } catch {
          // Fallback to Enter key
          await page.keyboard.press('Enter');
        }
      } else {
        await page.keyboard.press('Enter');
      }

      // ── Step 7: Wait for login response ───────────────────────────────────
      on?.('Waiting for login response…', 'Allowing up to 5s for redirect/session');
      await page.waitForTimeout(config.waitAfterLoginMs ?? 4000);
      try { await page.waitForLoadState('networkidle', { timeout: 6000 }); } catch {}

      const postLoginUrl = page.url();
      console.log(`[LoginExecutor] Post-login URL: ${postLoginUrl}`);

      // ── Step 8: Take post-login screenshot ────────────────────────────────
      try {
        await page.screenshot({ path: 'screenshots/login-after-submit.png', type: 'png' });
        console.log('[LoginExecutor] Screenshot saved: login-after-submit.png');
      } catch {}

      // ── Step 9: Verify login success ──────────────────────────────────────
      on?.('Verifying login…', `Current URL: ${postLoginUrl}`);
      const success = await this.verifyLoginSuccess(page, loginUrl!);
      console.log(`[LoginExecutor] Verification: ${success ? 'SUCCESS' : 'FAILED'} at ${postLoginUrl}`);

      let effectiveStartUrl: string | undefined;

      if (success) {
        // Determine the effective crawl start URL:
        // Case A: startUrl !== loginUrl (e.g. start=https://app.com, login=https://app.com/login)
        //         → navigate back to startUrl; user lands on authenticated home page
        // Case B: startUrl === loginUrl (e.g. saucedemo.com — the root IS the login page)
        //         → navigating back to startUrl would show the login form again
        //         → instead stay on postLoginUrl (the authenticated landing page)
        const normalizedStart = config.startUrl.replace(/\/$/, '');
        const normalizedLogin = (loginUrl || '').replace(/\/$/, '');
        const startIsLoginPage = normalizedStart === normalizedLogin ||
          config.startUrl.startsWith(loginUrl || '___') ||
          (loginUrl || '').startsWith(config.startUrl);

        if (!startIsLoginPage) {
          // Normal case — navigate back to startUrl
          console.log(`[LoginExecutor] Navigating back to startUrl: ${config.startUrl}`);
          await page.goto(config.startUrl, { waitUntil: 'load', timeout }).catch(() => {});
          // Wait for any JS-based redirect to settle
          try { await page.waitForLoadState('networkidle', { timeout: 4000 }); } catch {}
          await page.waitForTimeout(500);
          effectiveStartUrl = page.url();
        } else {
          // startUrl IS the login page — stay on the post-login authenticated page
          // The browser is already at the authenticated landing (e.g. /inventory.html)
          console.log(`[LoginExecutor] startUrl is the login page — staying on post-login URL: ${postLoginUrl}`);
          effectiveStartUrl = postLoginUrl;
        }

        // Final safety check: if effective URL still has a password field, something went wrong
        const hasPasswordField = await page.$('input[type="password"]').then(el => !!el).catch(() => false);
        if (hasPasswordField) {
          console.warn(`[LoginExecutor] Password field still visible at ${page.url()} — trying post-login URL`);
          effectiveStartUrl = postLoginUrl;
        }

        console.log(`[LoginExecutor] ✓ Effective crawl start URL: ${effectiveStartUrl}`);
        on?.(`✓ Login successful`, `Authenticated as ${config.username} — crawl will start at ${effectiveStartUrl}`);
      } else {
        const stillOnLogin = postLoginUrl.includes('login') || postLoginUrl.includes('signin');
        const reason = stillOnLogin
          ? `Still on login page (${postLoginUrl}) — verify username/password`
          : `Auth indicators not found after redirect to ${postLoginUrl}`;
        on?.(`✗ Login failed`, reason);
        console.log(`[LoginExecutor] Login failed: ${reason}`);
      }

      return {
        success,
        loginUrl,
        effectiveStartUrl,
        error: success ? undefined : `Login verification failed`,
        detectedSelectors: {
          usernameSelector: usernameSelector!,
          passwordSelector: passwordSelector!,
          submitSelector: submitSelector ?? 'Enter key',
        },
      };

    } catch (err: any) {
      console.error(`[LoginExecutor] Unexpected error: ${err.message}`);
      on?.(`✗ Login error`, err.message);
      return { success: false, error: err.message };
    }
    // NOTE: We do NOT close the page — it IS the crawlPage and must stay open.
  }

  private async discoverLoginUrl(
    startUrl: string,
    page: Page,
    timeout: number,
    on?: (msg: string, detail?: string) => void,
  ): Promise<string | null> {
    let origin: string;
    try { origin = new URL(startUrl).origin; } catch { return null; }

    // 1. Check if startUrl itself redirects to login
    try {
      await page.goto(startUrl, { waitUntil: 'domcontentloaded', timeout: Math.min(timeout, 12000) });
      await page.waitForTimeout(600);
      const finalUrl = page.url();
      if (await page.$('input[type="password"]')) {
        on?.(`Login page found via redirect`, `Redirected to ${finalUrl}`);
        return finalUrl;
      }
      // Look for a login link on the homepage
      const loginLink = await page.$('a[href*="login"], a[href*="signin"], a[href*="sign-in"]');
      if (loginLink) {
        const href = await loginLink.getAttribute('href') || '';
        const targetUrl = href.startsWith('http') ? href : `${origin}${href.startsWith('/') ? '' : '/'}${href}`;
        on?.(`Following login link…`, targetUrl);
        try {
          await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: Math.min(timeout, 8000) });
          await page.waitForTimeout(500);
          if (await page.$('input[type="password"]')) {
            on?.(`Login page found!`, targetUrl);
            return targetUrl;
          }
        } catch {}
      }
    } catch {}

    // 2. Probe common paths
    for (const path of LOGIN_PATHS) {
      const testUrl = `${origin}${path}`;
      on?.(`Probing ${path}…`, testUrl);
      try {
        const resp = await page.goto(testUrl, { waitUntil: 'domcontentloaded', timeout: Math.min(timeout, 7000) });
        if (resp && resp.status() < 400) {
          await page.waitForTimeout(350);
          if (await page.$('input[type="password"]')) {
            on?.(`Login page found!`, `${testUrl} has a password field`);
            return testUrl;
          }
        }
      } catch {}
    }

    return null;
  }

  private async detectLoginForm(page: Page): Promise<{ usernameSelector: string; passwordSelector: string; submitSelector: string } | null> {
    return page.evaluate(() => {
      const pwd = document.querySelector('input[type="password"]') as HTMLInputElement | null;
      if (!pwd) return null;

      const pwdSel = pwd.id ? `#${pwd.id}` : pwd.name ? `input[name="${pwd.name}"]` : 'input[type="password"]';

      const candidates = [
        'input[type="email"]',
        'input[autocomplete="username"]',
        'input[autocomplete="email"]',
        'input[type="text"][name*="user"]',
        'input[type="text"][name*="email"]',
        'input[type="text"][name*="login"]',
        'input[type="text"][id*="user"]',
        'input[type="text"][id*="email"]',
        'input[type="text"][id*="login"]',
        'input[type="text"]',
      ];
      let user: HTMLInputElement | null = null;
      for (const sel of candidates) {
        const el = document.querySelector(sel) as HTMLInputElement | null;
        if (el && el !== pwd) { user = el; break; }
      }
      if (!user) return null;

      const userSel = user.id ? `#${user.id}` : user.name ? `input[name="${user.name}"]` : user.type === 'email' ? 'input[type="email"]' : 'input[type="text"]';

      let submit: HTMLElement | null = null;
      for (const sel of ['button[type="submit"]', 'input[type="submit"]', 'button:not([type])']) {
        submit = document.querySelector(sel);
        if (submit) break;
      }
      if (!submit) {
        submit = Array.from(document.querySelectorAll<HTMLElement>('button,[role="button"],a[class*="btn"]')).find(b => {
          const t = (b.textContent ?? '').toLowerCase();
          return t.includes('log') || t.includes('sign') || t.includes('submit') || t.includes('enter') || t.includes('continue') || t.includes('next');
        }) ?? null;
      }
      const submitSel = submit
        ? (submit.id ? `#${submit.id}` : submit.getAttribute('data-testid') ? `[data-testid="${submit.getAttribute('data-testid')}"]` : 'button[type="submit"]')
        : 'button[type="submit"]';

      return { usernameSelector: userSel, passwordSelector: pwdSel, submitSelector: submitSel };
    });
  }

  private async verifyLoginSuccess(page: Page, loginUrl: string): Promise<boolean> {
    try {
      const cur = page.url();
      // URL clearly moved away from login
      if (cur !== loginUrl && !cur.includes('/login') && !cur.includes('/signin') && !cur.includes('/sign-in')) return true;
      // Password field gone → navigated away
      if (!await page.$('input[type="password"]')) return true;
      // Authenticated UI indicators
      for (const sel of ['.dashboard', '[data-user]', '.user-menu', '.logout', '[class*="logout"]',
          '.avatar', '.profile', '[aria-label*="account"]', '[aria-label*="profile"]',
          '.welcome', '[class*="username"]', 'nav [class*="user"]']) {
        if (await page.$(sel)) return true;
      }
      return false;
    } catch { return false; }
  }
}

export const loginExecutor = new LoginExecutor();
