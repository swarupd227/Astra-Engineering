import { playwrightService, PageInfo, PageElement } from './playwright-service';
import { Page } from 'playwright';
import type { CrawlProgress } from '@shared/qe-schema';
import * as fs from 'fs';
import * as path from 'path';

// Ensure screenshots directory exists
const SCREENSHOTS_DIR = path.join(process.cwd(), 'screenshots');
if (!fs.existsSync(SCREENSHOTS_DIR)) {
  fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
}

export interface LoginCredentials {
  loginUrl?: string;
  username: string;
  password: string;
  authType: 'form' | 'basic' | 'custom';
  usernameSelector?: string;
  passwordSelector?: string;
  loginButtonSelector?: string;
}

export interface EnhancedCrawlConfig {
  maxDepth: number;
  maxPages: number;
  sameDomainOnly: boolean;
  timeout: number;
  includeSitemap: boolean;
  probeCommonPaths: boolean;
  credentials?: LoginCredentials;
  headless?: boolean;  // default true — set false to open a real browser window
  slowMo?: number;     // ms delay between actions when headed (default 200)
}

export interface DOMStructure {
  url: string;
  title: string;
  meta: {
    description?: string;
    keywords?: string;
    viewport?: string;
  };
  headings: {
    h1: string[];
    h2: string[];
    h3: string[];
  };
  navigation: {
    navLinks: Array<{ text: string; href: string }>;
    breadcrumbs: string[];
  };
  interactiveElements: {
    buttons: Array<{ text: string; selector: string; type: string; ariaLabel?: string }>;
    links: Array<{ text: string; href: string; isExternal: boolean }>;
    inputs: Array<{ type: string; name?: string; label?: string; placeholder?: string; required: boolean; selector: string }>;
    selects: Array<{ name?: string; label?: string; options: string[]; selector: string }>;
    checkboxes: Array<{ name?: string; label?: string; checked: boolean; selector: string }>;
    radios: Array<{ name?: string; label?: string; groupName: string; selector: string }>;
  };
  forms: Array<{
    action?: string;
    method: string;
    fields: Array<{ type: string; name?: string; label?: string; required: boolean }>;
    submitButton?: string;
  }>;
  media: {
    images: Array<{ src: string; alt?: string; hasAlt: boolean }>;
    videos: number;
    iframes: number;
  };
  tables: Array<{
    headers: string[];
    rowCount: number;
  }>;
  modals: Array<{ id?: string; ariaLabel?: string }>;
  accessibility: {
    hasSkipLink: boolean;
    hasMainLandmark: boolean;
    hasNavLandmark: boolean;
    imagesWithoutAlt: number;
    buttonsWithoutLabel: number;
    inputsWithoutLabel: number;
  };
  textContent: {
    mainContentSample: string;
    errorMessages: string[];
    successMessages: string[];
  };
}

export interface EnhancedPageInfo extends PageInfo {
  domStructure: DOMStructure;
}

const COMMON_PATHS = [
  '/login', '/signin', '/sign-in',
  '/register', '/signup', '/sign-up',
  '/logout', '/signout',
  '/dashboard', '/admin',
  '/profile', '/account', '/settings',
  '/about', '/about-us',
  '/contact', '/contact-us',
  '/help', '/faq', '/support',
  '/privacy', '/privacy-policy',
  '/terms', '/terms-of-service', '/tos',
  '/search',
  '/cart', '/cart.html', '/checkout', '/checkout.html',
  '/checkout-step-one.html', '/checkout-step-two.html', '/checkout-complete.html',
  '/inventory.html', '/inventory-item.html',
  '/products', '/services', '/products.html',
  '/blog', '/news',
  '/404', '/error',
];

export class EnhancedCrawler {
  private config: EnhancedCrawlConfig;
  private visitedUrls: Set<string> = new Set();
  private urlQueue: Array<{ url: string; depth: number; source: string }> = [];
  private pageDataMap: Map<string, EnhancedPageInfo> = new Map();
  private progress: CrawlProgress & { 
    sitemapPagesFound: number;
    commonPathsFound: number;
    totalPagesDiscovered: number;
  } = {
    status: 'initializing',
    pagesVisited: 0,
    pagesQueued: 0,
    formsFound: 0,
    buttonsFound: 0,
    inputsFound: 0,
    sitemapPagesFound: 0,
    commonPathsFound: 0,
    totalPagesDiscovered: 0,
  };

  constructor(config: Partial<EnhancedCrawlConfig> = {}) {
    this.config = {
      maxDepth: config.maxDepth ?? 5,
      maxPages: config.maxPages ?? 100,
      sameDomainOnly: config.sameDomainOnly !== false,
      timeout: config.timeout ?? 30000,
      includeSitemap: config.includeSitemap !== false,
      probeCommonPaths: config.probeCommonPaths !== false,
      credentials: config.credentials,
      headless: config.headless,
      slowMo: config.slowMo,
    };
  }

  getProgress() {
    return { ...this.progress };
  }

  getPageData(): Map<string, EnhancedPageInfo> {
    return new Map(this.pageDataMap);
  }

  private normalizeUrl(url: string): string {
    try {
      const parsed = new URL(url);
      parsed.hash = '';
      let path = parsed.pathname;
      if (path.endsWith('/') && path.length > 1) {
        path = path.slice(0, -1);
      }
      parsed.pathname = path;
      return parsed.origin + parsed.pathname + parsed.search;
    } catch {
      return url;
    }
  }

  private isSameDomain(baseUrl: string, targetUrl: string): boolean {
    try {
      const base = new URL(baseUrl);
      const target = new URL(targetUrl);
      return base.hostname === target.hostname || 
             target.hostname.endsWith('.' + base.hostname) ||
             base.hostname.endsWith('.' + target.hostname);
    } catch {
      return false;
    }
  }

  private async fetchNestedSitemap(sitemapUrl: string): Promise<string[]> {
    const urls: string[] = [];
    try {
      console.log(`[EnhancedCrawler] Fetching nested sitemap: ${sitemapUrl}`);
      const response = await fetch(sitemapUrl, { 
        signal: AbortSignal.timeout(3000),
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; TestCrawler/1.0)' }
      });
      
      if (response.ok) {
        const text = await response.text();
        const locRegex = /<loc>([^<]+)<\/loc>/gi;
        let match;
        while ((match = locRegex.exec(text)) !== null) {
          const url = match[1].trim();
          if (url.endsWith('.xml')) {
            const nestedUrls = await this.fetchNestedSitemap(url);
            urls.push(...nestedUrls);
          } else {
            urls.push(url);
          }
        }
      }
    } catch (error: any) {
      console.log(`[EnhancedCrawler] Failed to fetch nested sitemap ${sitemapUrl}: ${error.message}`);
    }
    return urls;
  }

  private async fetchSitemap(baseUrl: string): Promise<string[]> {
    const urls: string[] = [];
    const sitemapUrls = [
      `${baseUrl}/sitemap.xml`,
      `${baseUrl}/sitemap_index.xml`,
    ];

    for (const sitemapUrl of sitemapUrls) {
      try {
        console.log(`[EnhancedCrawler] Checking sitemap: ${sitemapUrl}`);
        const response = await fetch(sitemapUrl, { 
          signal: AbortSignal.timeout(3000),
          headers: { 'User-Agent': 'Mozilla/5.0 (compatible; TestCrawler/1.0)' }
        });
        
        if (response.ok) {
          const text = await response.text();
          const locRegex = /<loc>([^<]+)<\/loc>/gi;
          let match;
          while ((match = locRegex.exec(text)) !== null) {
            const url = match[1].trim();
            if (url.endsWith('.xml')) {
              // Recursively fetch nested sitemap using the full URL
              const nestedUrls = await this.fetchNestedSitemap(url);
              urls.push(...nestedUrls);
            } else {
              urls.push(url);
            }
          }
          if (urls.length > 0) {
            console.log(`[EnhancedCrawler] Found ${urls.length} URLs from sitemap`);
            break;
          }
        }
      } catch (error: any) {
        console.log(`[EnhancedCrawler] Sitemap not found at ${sitemapUrl}`);
      }
    }

    return urls;
  }

  private async probeCommonPaths(baseUrl: string, _contextId: string): Promise<string[]> {
    const base = new URL(baseUrl);
    console.log(`[EnhancedCrawler] Probing ${COMMON_PATHS.length} common paths in parallel…`);

    // Run all HEAD requests concurrently with a tight 2s timeout — no sequential waits
    const results = await Promise.allSettled(
      COMMON_PATHS.map(async (path) => {
        const testUrl = `${base.origin}${path}`;
        if (this.visitedUrls.has(this.normalizeUrl(testUrl))) return null;
        const response = await fetch(testUrl, {
          method: 'HEAD',
          signal: AbortSignal.timeout(2000),
          redirect: 'manual',
          headers: { 'User-Agent': 'Mozilla/5.0 (compatible; TestCrawler/1.0)' },
        });
        return (response.status >= 200 && response.status < 400) ? testUrl : null;
      })
    );

    const foundUrls = results
      .map(r => r.status === 'fulfilled' ? r.value : null)
      .filter((u): u is string => !!u);

    console.log(`[EnhancedCrawler] Common paths found: ${foundUrls.length}`);
    return foundUrls;
  }

  async extractDOMStructure(page: Page): Promise<DOMStructure> {
    const url = page.url();
    const title = await page.title();

    // Use string-based evaluate to avoid esbuild __name injection issue
    // All template literals replaced with string concatenation
    const domData = await page.evaluate(`
      (function() {
        var getLabel = function(input) {
          var id = input.getAttribute('id');
          if (id) {
            var label = document.querySelector('label[for="' + id + '"]');
            if (label) return label.textContent ? label.textContent.trim() : '';
          }
          var parentLabel = input.closest('label');
          if (parentLabel) return parentLabel.textContent ? parentLabel.textContent.trim() : '';
          var ariaLabel = input.getAttribute('aria-label');
          if (ariaLabel) return ariaLabel;
          return undefined;
        };

        var meta = {
          description: (document.querySelector('meta[name="description"]') || {}).getAttribute ? document.querySelector('meta[name="description"]').getAttribute('content') : undefined,
          keywords: (document.querySelector('meta[name="keywords"]') || {}).getAttribute ? document.querySelector('meta[name="keywords"]').getAttribute('content') : undefined,
          viewport: (document.querySelector('meta[name="viewport"]') || {}).getAttribute ? document.querySelector('meta[name="viewport"]').getAttribute('content') : undefined,
        };

        var headings = {
          h1: Array.from(document.querySelectorAll('h1')).map(function(el) { return el.textContent ? el.textContent.trim() : ''; }),
          h2: Array.from(document.querySelectorAll('h2')).map(function(el) { return el.textContent ? el.textContent.trim() : ''; }).slice(0, 10),
          h3: Array.from(document.querySelectorAll('h3')).map(function(el) { return el.textContent ? el.textContent.trim() : ''; }).slice(0, 10),
        };

        var navElements = document.querySelectorAll('nav a, header a, [role="navigation"] a');
        var navLinks = Array.from(navElements).slice(0, 20).map(function(el) {
          return {
            text: el.textContent ? el.textContent.trim() : '',
            href: el.href || '',
          };
        });

        var breadcrumbEl = document.querySelector('[aria-label*="breadcrumb"], .breadcrumb, .breadcrumbs');
        var breadcrumbs = breadcrumbEl 
          ? Array.from(breadcrumbEl.querySelectorAll('a, span')).map(function(el) { return el.textContent ? el.textContent.trim() : ''; })
          : [];

        var buttons = Array.from(document.querySelectorAll('button, [role="button"], input[type="submit"], input[type="button"]'))
          .slice(0, 50)
          .map(function(el, idx) {
            return {
              text: (el.textContent ? el.textContent.trim() : '') || el.value || '',
              selector: el.id ? '#' + el.id : 'button:nth-of-type(' + (idx + 1) + ')',
              type: el.getAttribute('type') || 'button',
              ariaLabel: el.getAttribute('aria-label') || undefined,
            };
          });

        var hostname = window.location.hostname;
        var links = Array.from(document.querySelectorAll('a[href]'))
          .slice(0, 100)
          .map(function(el) {
            var href = el.href;
            var isExternal = false;
            try {
              isExternal = new URL(href).hostname !== hostname;
            } catch(e) {}
            return {
              text: el.textContent ? el.textContent.trim() : '',
              href: href,
              isExternal: isExternal,
            };
          });

        var inputs = Array.from(document.querySelectorAll('input:not([type="submit"]):not([type="button"]):not([type="hidden"]), textarea'))
          .slice(0, 50)
          .map(function(el, idx) {
            return {
              type: el.type || 'text',
              name: el.name || undefined,
              label: getLabel(el),
              placeholder: el.placeholder || undefined,
              required: el.required || el.hasAttribute('required'),
              selector: el.id ? '#' + el.id : 'input:nth-of-type(' + (idx + 1) + ')',
            };
          });

        var selects = Array.from(document.querySelectorAll('select'))
          .slice(0, 20)
          .map(function(el, idx) {
            return {
              name: el.name || undefined,
              label: getLabel(el),
              options: Array.from(el.options).map(function(opt) { return opt.text; }),
              selector: el.id ? '#' + el.id : 'select:nth-of-type(' + (idx + 1) + ')',
            };
          });

        var checkboxes = Array.from(document.querySelectorAll('input[type="checkbox"]'))
          .slice(0, 20)
          .map(function(el, idx) {
            return {
              name: el.name || undefined,
              label: getLabel(el),
              checked: el.checked,
              selector: el.id ? '#' + el.id : 'input[type="checkbox"]:nth-of-type(' + (idx + 1) + ')',
            };
          });

        var radios = Array.from(document.querySelectorAll('input[type="radio"]'))
          .slice(0, 20)
          .map(function(el, idx) {
            return {
              name: el.name || undefined,
              label: getLabel(el),
              groupName: el.name || '',
              selector: el.id ? '#' + el.id : 'input[type="radio"]:nth-of-type(' + (idx + 1) + ')',
            };
          });

        var forms = Array.from(document.querySelectorAll('form'))
          .slice(0, 10)
          .map(function(form) {
            var formInputs = Array.from(form.querySelectorAll('input, textarea, select'))
              .filter(function(el) { return ['submit', 'button', 'hidden'].indexOf(el.type) === -1; })
              .map(function(el) {
                return {
                  type: el.type || el.tagName.toLowerCase(),
                  name: el.name || undefined,
                  label: getLabel(el),
                  required: el.required,
                };
              });
            
            var submitBtn = form.querySelector('button[type="submit"], input[type="submit"], button:not([type])');
            
            return {
              action: form.action || undefined,
              method: (form.method || 'GET').toUpperCase(),
              fields: formInputs,
              submitButton: submitBtn ? ((submitBtn.textContent ? submitBtn.textContent.trim() : '') || submitBtn.value || undefined) : undefined,
            };
          });

        var images = Array.from(document.querySelectorAll('img'))
          .slice(0, 50)
          .map(function(img) {
            return {
              src: img.src,
              alt: img.alt || undefined,
              hasAlt: !!img.alt,
            };
          });

        var videos = document.querySelectorAll('video').length;
        var iframes = document.querySelectorAll('iframe').length;

        var tables = Array.from(document.querySelectorAll('table'))
          .slice(0, 10)
          .map(function(table) {
            return {
              headers: Array.from(table.querySelectorAll('th')).map(function(th) { return th.textContent ? th.textContent.trim() : ''; }),
              rowCount: table.querySelectorAll('tr').length,
            };
          });

        var modals = Array.from(document.querySelectorAll('[role="dialog"], .modal, [aria-modal="true"]'))
          .map(function(el) {
            return {
              id: el.id || undefined,
              ariaLabel: el.getAttribute('aria-label') || undefined,
            };
          });

        var hasSkipLink = !!document.querySelector('a[href="#main"], a[href="#content"], .skip-link');
        var hasMainLandmark = !!document.querySelector('main, [role="main"]');
        var hasNavLandmark = !!document.querySelector('nav, [role="navigation"]');
        var imagesWithoutAlt = document.querySelectorAll('img:not([alt])').length;
        var buttonsWithoutLabel = Array.from(document.querySelectorAll('button, [role="button"]'))
          .filter(function(btn) { return !(btn.textContent ? btn.textContent.trim() : '') && !btn.getAttribute('aria-label'); }).length;
        var inputsWithoutLabel = Array.from(document.querySelectorAll('input:not([type="hidden"]):not([type="submit"])'))
          .filter(function(input) { return !getLabel(input) && !input.placeholder; }).length;

        var mainContent = document.querySelector('main, [role="main"], .main-content, #main, article');
        var mainContentSample = mainContent && mainContent.textContent ? mainContent.textContent.slice(0, 500).trim() : '';

        var errorMessages = Array.from(document.querySelectorAll('.error, [role="alert"], .alert-danger, .alert-error, .error-message'))
          .map(function(el) { return el.textContent ? el.textContent.trim() : ''; })
          .filter(function(t) { return t.length > 0; })
          .slice(0, 5);

        var successMessages = Array.from(document.querySelectorAll('.success, .alert-success, .success-message'))
          .map(function(el) { return el.textContent ? el.textContent.trim() : ''; })
          .filter(function(t) { return t.length > 0; })
          .slice(0, 5);

        return {
          meta: meta,
          headings: headings,
          navigation: { navLinks: navLinks, breadcrumbs: breadcrumbs },
          interactiveElements: { buttons: buttons, links: links, inputs: inputs, selects: selects, checkboxes: checkboxes, radios: radios },
          forms: forms,
          media: { images: images, videos: videos, iframes: iframes },
          tables: tables,
          modals: modals,
          accessibility: {
            hasSkipLink: hasSkipLink,
            hasMainLandmark: hasMainLandmark,
            hasNavLandmark: hasNavLandmark,
            imagesWithoutAlt: imagesWithoutAlt,
            buttonsWithoutLabel: buttonsWithoutLabel,
            inputsWithoutLabel: inputsWithoutLabel,
          },
          textContent: { mainContentSample: mainContentSample, errorMessages: errorMessages, successMessages: successMessages },
        };
      })()
    `);

    return {
      url,
      title,
      ...domData,
    };
  }

  async crawl(
    startUrl: string,
    onProgress?: (progress: any) => void,
    onScreenshot?: (base64: string, url: string) => void
  ): Promise<{ pages: EnhancedPageInfo[]; domStructures: DOMStructure[]; screenshotPath?: string }> {
    const contextId = `enhanced-crawl-${Date.now()}`;
    let screenshotPath: string | undefined;
    
    this.visitedUrls.clear();
    this.urlQueue = [];
    this.pageDataMap.clear();
    this.progress = {
      status: 'initializing',
      pagesVisited: 0,
      pagesQueued: 0,
      formsFound: 0,
      buttonsFound: 0,
      inputsFound: 0,
      sitemapPagesFound: 0,
      commonPathsFound: 0,
      totalPagesDiscovered: 0,
    };

    try {
      onProgress?.(this.progress);
      // Switch browser mode if headless preference differs from current
      const headless = this.config.headless ?? true;
      const slowMo   = headless ? undefined : (this.config.slowMo ?? 200);
      console.log(`[EnhancedCrawler] crawl() — headless=${headless}, slowMo=${slowMo}`);
      await playwrightService.setHeadless(headless, slowMo);
      await playwrightService.initialize();

      // Create the single persistent page immediately after browser launch so the
      // user sees the browser navigating to the start URL right away — not a blank tab.
      const context = await playwrightService.createContext(contextId);
      const crawlPage = await context.newPage();
      // Set a fixed viewport so headless screenshots are always consistent
      await crawlPage.setViewportSize({ width: 1280, height: 720 });
      console.log(`[EnhancedCrawler] Browser ready — navigating to start URL immediately`);
      await crawlPage.goto(startUrl, { waitUntil: 'domcontentloaded', timeout: this.config.timeout }).catch(() => {});

      // Execute login if credentials provided
      // We pass crawlPage directly so that cookies + localStorage + sessionStorage
      // obtained during login are immediately usable by the crawl loop.
      if (this.config.credentials) {
        this.progress.status = 'logging_in' as any;
        onProgress?.(this.progress);

        try {
          const { loginExecutor } = await import('./login-executor');
          const loginResult = await loginExecutor.executeLogin(crawlPage, {
            loginUrl: this.config.credentials.loginUrl,
            startUrl,
            username: this.config.credentials.username,
            password: this.config.credentials.password,
            authType: this.config.credentials.authType,
            usernameSelector: this.config.credentials.usernameSelector,
            passwordSelector: this.config.credentials.passwordSelector,
            loginButtonSelector: this.config.credentials.loginButtonSelector,
            timeout: this.config.timeout,
            onProgress: (message: string, detail?: string) => {
              (this.progress as any).loginStatus  = message;
              (this.progress as any).loginDetail  = detail;
              (this.progress as any).loginSuccess = undefined; // clear old result during login
              onProgress?.(this.progress);
            },
          });

          // Store final login outcome on progress so autotest-routes can read it
          (this.progress as any).loginSuccess = loginResult.success;
          (this.progress as any).loginUrl     = loginResult.loginUrl;
          (this.progress as any).loginStatus  = undefined;  // clear interim messages
          (this.progress as any).loginDetail  = undefined;

          if (!loginResult.success) {
            console.warn(`[EnhancedCrawler] Login failed: ${loginResult.error}. Crawling as guest.`);
            (this.progress as any).loginError = loginResult.error;
            onProgress?.(this.progress);
          } else {
            console.log('[EnhancedCrawler] ✓ Login successful — crawl page is authenticated');
            // Use the effectiveStartUrl returned by loginExecutor — it correctly handles:
            //   • sites where startUrl ≠ loginUrl (navigate back to startUrl)
            //   • sites where startUrl IS the login page (stay on post-auth page, e.g. saucedemo)
            //   • OAuth/SSO multi-redirect flows
            if (loginResult.effectiveStartUrl && loginResult.effectiveStartUrl !== 'about:blank') {
              console.log(`[EnhancedCrawler] Using effectiveStartUrl: ${loginResult.effectiveStartUrl}`);
              startUrl = loginResult.effectiveStartUrl;
            } else {
              // Fallback: read browser's current URL
              const currentUrl = crawlPage.url();
              if (currentUrl && currentUrl !== 'about:blank') {
                console.log(`[EnhancedCrawler] effectiveStartUrl not set — using crawlPage.url(): ${currentUrl}`);
                startUrl = currentUrl;
              }
            }
          }
        } catch (err: any) {
          console.warn(`[EnhancedCrawler] Login threw: ${err.message}`);
          (this.progress as any).loginError   = err.message;
          (this.progress as any).loginSuccess = false;
          onProgress?.(this.progress);
        }
      }

      if (this.config.includeSitemap) {
        this.progress.status = 'fetching_sitemap';
        onProgress?.(this.progress);
        
        const sitemapUrls = await this.fetchSitemap(startUrl);
        this.progress.sitemapPagesFound = sitemapUrls.length;
        
        for (const url of sitemapUrls) {
          // Never queue more URLs than the page budget
          if (this.urlQueue.length + this.visitedUrls.size >= this.config.maxPages) break;
          const normalized = this.normalizeUrl(url);
          if (!this.visitedUrls.has(normalized) &&
              (!this.config.sameDomainOnly || this.isSameDomain(startUrl, url))) {
            this.urlQueue.push({ url: normalized, depth: 1, source: 'sitemap' });
          }
        }
      }

      if (this.config.probeCommonPaths) {
        this.progress.status = 'probing_paths';
        onProgress?.(this.progress);
        
        const commonUrls = await this.probeCommonPaths(startUrl, contextId);
        this.progress.commonPathsFound = commonUrls.length;
        
        for (const url of commonUrls) {
          if (this.urlQueue.length + this.visitedUrls.size >= this.config.maxPages) break;
          const normalized = this.normalizeUrl(url);
          if (!this.urlQueue.find(q => q.url === normalized)) {
            this.urlQueue.push({ url: normalized, depth: 1, source: 'common_path' });
          }
        }
      }

      const normalizedStart = this.normalizeUrl(startUrl);
      if (!this.urlQueue.find(q => q.url === normalizedStart)) {
        this.urlQueue.unshift({ url: normalizedStart, depth: 0, source: 'start' });
      }

      this.progress.totalPagesDiscovered = this.urlQueue.length;
      this.progress.pagesQueued = this.urlQueue.length;
      this.progress.status = 'crawling';
      onProgress?.(this.progress);

      // Reuse the page that was opened immediately after browser launch
      const page = crawlPage;

      try {
        while (
          this.urlQueue.length > 0 &&
          this.visitedUrls.size < this.config.maxPages
        ) {
          const { url, depth, source } = this.urlQueue.shift()!;
          const normalized = this.normalizeUrl(url);

          if (this.visitedUrls.has(normalized) || depth > this.config.maxDepth) {
            continue;
          }

          try {
            console.log(`[EnhancedCrawler] Visiting (${source}): ${url} (depth: ${depth})`);
            this.progress.currentUrl = url;
            onProgress?.(this.progress);

            // Use 'domcontentloaded' — far more resilient than 'load' which waits for
            // all resources (images, ads, trackers) and often times out on protected sites.
            // A subsequent networkidle wait handles SPA rendering without hard-failing.
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: this.config.timeout });
            // Wait for JS frameworks (React/Vue/Angular SPAs) to render content.
            // Keep this short — it's a best-effort wait, not a hard requirement.
            try { await page.waitForLoadState('networkidle', { timeout: 3000 }); } catch {}

            // Capture screenshot for live streaming (headless mode — no desktop window)
            if (onScreenshot) {
              try {
                const buf = await page.screenshot({ type: 'jpeg', quality: 35, fullPage: false, clip: { x: 0, y: 0, width: 1280, height: 720 } });
                onScreenshot(`data:image/jpeg;base64,${buf.toString('base64')}`, normalized);
              } catch (_ssErr) { /* non-fatal */ }
            }

            // Capture screenshot of the first page for preview file
            if (this.visitedUrls.size === 0) {
              try {
                const screenshotFilename = `preview_${Date.now()}.png`;
                screenshotPath = path.join(SCREENSHOTS_DIR, screenshotFilename);
                await page.screenshot({ path: screenshotPath, fullPage: false });
                console.log(`[EnhancedCrawler] Captured screenshot: ${screenshotPath}`);
              } catch (screenshotError: any) {
                console.log(`[EnhancedCrawler] Failed to capture screenshot: ${screenshotError.message}`);
              }
            }

            const basicInfo = await playwrightService.extractPageInfo(page);
            const domStructure = await this.extractDOMStructure(page);

            const enhancedInfo: EnhancedPageInfo = {
              ...basicInfo,
              domStructure,
            };

            this.pageDataMap.set(normalized, enhancedInfo);
            this.visitedUrls.add(normalized);

            this.progress.pagesVisited = this.visitedUrls.size;
            this.progress.formsFound += basicInfo.forms.length;
            this.progress.buttonsFound += basicInfo.buttons.length;
            this.progress.inputsFound += basicInfo.inputs.length;

            if (depth < this.config.maxDepth) {
              // ── Standard link discovery ──────────────────────────────────────
              for (const link of basicInfo.links) {
                if (this.urlQueue.length + this.visitedUrls.size >= this.config.maxPages) break;
                const normalizedLink = this.normalizeUrl(link);
                if (
                  !this.visitedUrls.has(normalizedLink) &&
                  !this.urlQueue.find(q => q.url === normalizedLink) &&
                  (!this.config.sameDomainOnly || this.isSameDomain(startUrl, normalizedLink))
                ) {
                  this.urlQueue.push({ url: normalizedLink, depth: depth + 1, source: 'link' });
                  this.progress.totalPagesDiscovered++;
                }
              }

              // ── JS-SPA discovery: click href="#" links and observe URL changes ──
              // Many SPAs (React Router, Vue Router) use href="#" + onClick for navigation.
              // Standard link extraction misses these — we click each and record URL changes.
              const sameDomainLinkCount = basicInfo.links.filter(l => this.isSameDomain(startUrl, l)).length;
              if (sameDomainLinkCount < 3 && this.urlQueue.length + this.visitedUrls.size < this.config.maxPages) {
                const currentPageUrl = page.url();
                try {
                  // Get all visible clickable elements that might navigate (href="#", data-href, role="link")
                  const jsNavSelectors = ['a[href="#"]', 'a[href="javascript:void(0)"]', '[data-href]', '[role="link"]'];
                  const clickTargets = await page.$$(jsNavSelectors.join(', ')).catch(() => [] as any[]);
                  console.log(`[EnhancedCrawler] JS-SPA mode: found ${clickTargets.length} potential JS-nav elements`);

                  for (const el of clickTargets.slice(0, 25)) {
                    if (this.urlQueue.length + this.visitedUrls.size >= this.config.maxPages) break;
                    try {
                      const box = await el.boundingBox().catch(() => null);
                      if (!box || box.width < 2 || box.height < 2) continue; // skip invisible elements

                      await el.click({ timeout: 1500, force: false });
                      await page.waitForTimeout(700); // wait for React Router to update URL

                      const newUrl = page.url();
                      if (newUrl !== currentPageUrl) {
                        const normalizedNew = this.normalizeUrl(newUrl);
                        if (
                          !this.visitedUrls.has(normalizedNew) &&
                          !this.urlQueue.find(q => q.url === normalizedNew) &&
                          this.isSameDomain(startUrl, newUrl)
                        ) {
                          console.log(`[EnhancedCrawler] JS-nav discovered: ${newUrl}`);
                          this.urlQueue.push({ url: newUrl, depth: depth + 1, source: 'js_click' });
                          this.progress.totalPagesDiscovered++;
                        }
                        // Navigate back to the page we were crawling
                        await page.goto(currentPageUrl, { waitUntil: 'load', timeout: this.config.timeout });
                        try { await page.waitForLoadState('networkidle', { timeout: 3000 }); } catch {}
                      }
                    } catch { /* non-fatal — skip this element */ }
                  }
                } catch (jsNavErr: any) {
                  console.log(`[EnhancedCrawler] JS-nav discovery skipped: ${jsNavErr.message}`);
                }
              }
            }

            this.progress.pagesQueued = this.urlQueue.length;
            onProgress?.(this.progress);

          } catch (error: any) {
            console.error(`[EnhancedCrawler] ✗ Failed to visit ${url}: [${error.name}] ${error.message}`);
            // If this is the very first URL (start URL) and we have no pages yet, retry once
            // with a longer timeout — the browser may still be warming up.
            if (this.visitedUrls.size === 0 && depth === 0) {
              console.log(`[EnhancedCrawler] Retrying start URL once after 2s...`);
              try {
                await page.waitForTimeout(2000);
                await page.goto(url, { waitUntil: 'domcontentloaded', timeout: this.config.timeout });
                try { await page.waitForLoadState('networkidle', { timeout: 3000 }); } catch {}
                const basicInfo = await playwrightService.extractPageInfo(page);
                const domStructure = await this.extractDOMStructure(page);
                this.pageDataMap.set(normalized, { ...basicInfo, domStructure });
                this.visitedUrls.add(normalized);
                this.progress.pagesVisited = this.visitedUrls.size;
                this.progress.formsFound   += basicInfo.forms.length;
                this.progress.buttonsFound += basicInfo.buttons.length;
                this.progress.inputsFound  += basicInfo.inputs.length;
                this.progress.pagesQueued = this.urlQueue.length;
                onProgress?.(this.progress);
                console.log(`[EnhancedCrawler] ✓ Retry succeeded for start URL`);
              } catch (retryErr: any) {
                console.error(`[EnhancedCrawler] ✗ Retry also failed: ${retryErr.message}`);
              }
            }
          }
        }
      } finally {
        // Close the single page when all URLs are done (or on error)
        await page.close().catch(() => {});
      }

      this.progress.status = 'completed';
      this.progress.currentUrl = undefined;
      onProgress?.(this.progress);

      const pages = Array.from(this.pageDataMap.values());
      const domStructures = pages.map(p => p.domStructure);

      console.log(`[EnhancedCrawler] Crawl complete. Visited ${pages.length} pages.`);

      return { pages, domStructures, screenshotPath };
    } catch (error: any) {
      console.error('[EnhancedCrawler] Crawl failed:', error);
      this.progress.status = 'error';
      this.progress.error = error.message;
      onProgress?.(this.progress);
      throw error;
    } finally {
      await playwrightService.closeContext(contextId);
    }
  }

  reset(): void {
    this.visitedUrls.clear();
    this.urlQueue = [];
    this.pageDataMap.clear();
  }
}

export const enhancedCrawler = new EnhancedCrawler();
