import { chromium, Browser, BrowserContext, Page } from 'playwright';
import { getBrowserExecutablePath } from './playwright-setup';
import * as fs from 'fs';

export interface PlaywrightConfig {
  headless: boolean;
  slowMo?: number;
  timeout: number;
  viewport: { width: number; height: number };
}

export interface PageElement {
  selector: string;
  type: 'button' | 'link' | 'input' | 'form' | 'select' | 'textarea';
  text?: string;
  href?: string;
  name?: string;
  id?: string;
  className?: string;
  formIndex?: number;
  displayLabel?: string;
  placeholder?: string;
}

export interface PageInfo {
  url: string;
  title: string;
  links: string[];
  forms: PageElement[];
  buttons: PageElement[];
  inputs: PageElement[];
  h1: string[];
}

class PlaywrightService {
  private browser: Browser | null = null;
  private contexts: Map<string, BrowserContext> = new Map();
  private config: PlaywrightConfig = {
    headless: true,
    timeout: 30000,
    viewport: { width: 1920, height: 1080 },
  };

  async initialize(): Promise<void> {
    if (this.browser) return;
    
    try {
      console.log('[Playwright] Attempting to launch browser with headless mode...');
      const execPath = getBrowserExecutablePath();
      if (this.config.headless) {
        // Headless mode — use bundled/installed Playwright Chromium
        this.browser = await chromium.launch({
          headless: true,
          executablePath: execPath ?? undefined,
          args: [
            '--no-sandbox', '--disable-setuid-sandbox',
            '--disable-dev-shm-usage', '--disable-gpu',
            '--disable-blink-features=AutomationControlled',
          ],
        });
        console.log('[Playwright] Launched headless browser');
      } else {
        // Headed mode — open visible Chrome window so user can watch the crawl
        const chromePaths = [
          'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
          'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
        ];
        const chromeExe = chromePaths.find(p => {
          try { return fs.existsSync(p); } catch { return false; }
        });
        console.log(`[Playwright] Launching headed browser — Chrome: ${chromeExe ?? 'channel:chrome'}`);
        this.browser = await chromium.launch({
          headless: false,
          slowMo: this.config.slowMo ?? 150,
          executablePath: chromeExe,
          channel: chromeExe ? undefined : 'chrome',
          args: [
            '--no-sandbox', '--disable-setuid-sandbox',
            '--start-maximized',
            '--disable-blink-features=AutomationControlled',
          ],
        });
        console.log('[Playwright] Headed Chrome window launched successfully');
      }
      console.log('[Playwright] Browser initialized successfully');
    } catch (error: any) {
      const errorMessage = error?.message || String(error);
      console.error('[Playwright] Failed to initialize browser:', errorMessage);
      
      // Provide detailed error info
      if (errorMessage.includes('chromium') || errorMessage.includes('spawn')) {
        console.error('[Playwright] Browser binaries may not be properly installed');
        console.error('[Playwright] Try: npx playwright install chromium');
      }
      if (errorMessage.includes('libc') || errorMessage.includes('dependency')) {
        console.error('[Playwright] Missing system dependencies');
        console.error('[Playwright] Try: npx playwright install-deps chromium');
      }
      
      throw new Error(`Failed to initialize Playwright browser: ${errorMessage}`);
    }
  }

  /** Switch headless mode — closes current browser so next initialize() re-launches with new config */
  async setHeadless(headless: boolean, slowMo?: number): Promise<void> {
    // Force headless on non-Windows — EC2/Linux servers have no display,
    // and headed mode's channel:'chrome' fallback breaks on EC2.
    const effectiveHeadless = process.platform === 'win32' ? headless : true;
    if (process.platform !== 'win32' && !headless) {
      console.warn('[Playwright] Headed mode requested on non-Windows — forcing headless');
    }
    console.log(`[Playwright] setHeadless(${effectiveHeadless}, slowMo=${slowMo}) — current: headless=${this.config.headless}`);
    this.config.headless = effectiveHeadless;
    this.config.slowMo = slowMo;
    // Always close existing browser so initialize() re-launches with new config
    if (this.browser) {
      console.log('[Playwright] Closing existing browser for mode switch...');
      try { await this.browser.close(); } catch {}
      this.browser = null;
    }
    // Also clear stale contexts
    this.contexts.clear();
  }

  async createContext(contextId: string): Promise<BrowserContext> {
    // Check if browser exists and is connected
    if (!this.browser || !this.browser.isConnected()) {
      console.log('[Playwright] Browser not connected, reinitializing...');
      this.browser = null; // Clear stale reference
      await this.initialize();
    }

    if (!this.browser) {
      throw new Error('Browser not initialized');
    }

    try {
      const context = await this.browser.newContext({
        // viewport: null lets --start-maximized take full effect in headed mode;
        // in headless mode use the configured fixed viewport.
        viewport: this.config.headless ? this.config.viewport : null,
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        ignoreHTTPSErrors: true,   // handle self-signed / expired certs without failing
        bypassCSP: true,           // allow JS execution on strict-CSP sites
        extraHTTPHeaders: {
          'Accept-Language': 'en-US,en;q=0.9',
        },
      });

      context.setDefaultTimeout(this.config.timeout);
      this.contexts.set(contextId, context);
      
      console.log(`[Playwright] Created context: ${contextId}`);
      return context;
    } catch (error: any) {
      // If context creation fails, browser might be dead - reinitialize and retry once
      if (error.message && error.message.includes('Target page, context or browser has been closed')) {
        console.log('[Playwright] Browser died during context creation, reinitializing...');
        this.browser = null;
        await this.initialize();
        
        if (!this.browser) {
          throw new Error('Browser not initialized after retry');
        }
        
        const context = await (this.browser as Browser).newContext({
          viewport: this.config.headless ? this.config.viewport : null,
          userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          ignoreHTTPSErrors: true,
          bypassCSP: true,
          extraHTTPHeaders: { 'Accept-Language': 'en-US,en;q=0.9' },
        });

        context.setDefaultTimeout(this.config.timeout);
        this.contexts.set(contextId, context);
        
        console.log(`[Playwright] Created context after retry: ${contextId}`);
        return context;
      }
      
      throw error;
    }
  }

  async navigateToPage(contextId: string, url: string): Promise<Page> {
    let context = this.contexts.get(contextId);
    
    if (!context) {
      context = await this.createContext(contextId);
    }

    const page = await context.newPage();
    
    try {
      console.log(`[Playwright] Navigating to: ${url}`);
      await page.goto(url, { 
        waitUntil: 'domcontentloaded',
        timeout: this.config.timeout 
      });
      console.log(`[Playwright] Successfully loaded: ${url}`);
      return page;
    } catch (error) {
      console.error(`[Playwright] Failed to navigate to ${url}:`, error);
      throw error;
    }
  }

  async extractPageInfo(page: Page): Promise<PageInfo> {
    const url = page.url();
    const title = await page.title();

    const links = await page.$$eval('a[href]', (elements) =>
      elements
        .map((el) => (el as HTMLAnchorElement).href)
        .filter((href) => href && href.startsWith('http'))
    );

    const forms = await page.$$eval('form', (elements) =>
      elements.map((el, index) => ({
        selector: `form:nth-of-type(${index + 1})`,
        type: 'form' as const,
        name: (el as HTMLFormElement).name || undefined,
        id: (el as HTMLFormElement).id || undefined,
        className: (el as HTMLFormElement).className || undefined,
      }))
    );

    const buttons = await page.$$eval('button, input[type="submit"], input[type="button"]', (elements) =>
      elements.map((el, index) => {
        const tagName = el.tagName.toLowerCase();
        const type = el.getAttribute('type') || 'button';
        return {
          selector: `${tagName}${el.id ? `#${el.id}` : `:nth-of-type(${index + 1})`}`,
          type: 'button' as const,
          text: (el as HTMLButtonElement).textContent?.trim() || undefined,
          name: (el as HTMLInputElement).name || undefined,
          id: (el as HTMLElement).id || undefined,
        };
      })
    );

    const inputs = await page.$$eval('input:not([type="submit"]):not([type="button"]), textarea, select', (elements) =>
      elements.map((el) => {
        const tagName = el.tagName.toLowerCase();
        const formParent = (el as HTMLElement).closest('form');
        let formIndex = -1;
        
        if (formParent) {
          const allForms = Array.from(document.querySelectorAll('form'));
          formIndex = allForms.indexOf(formParent);
        }
        
        // Extract human-readable label with priority fallback
        let displayLabel: string | undefined;
        const placeholder = (el as HTMLInputElement).placeholder;
        
        // 1. Try associated <label for="id">
        if (el.id) {
          const associatedLabel = document.querySelector(`label[for="${el.id}"]`);
          if (associatedLabel?.textContent) {
            displayLabel = associatedLabel.textContent.trim();
          }
        }
        
        // 2. Try parent <label>
        if (!displayLabel) {
          const parentLabel = (el as HTMLElement).closest('label');
          if (parentLabel?.textContent) {
            displayLabel = parentLabel.textContent.trim();
          }
        }
        
        // 3. Try aria-label
        if (!displayLabel) {
          const ariaLabel = el.getAttribute('aria-label');
          if (ariaLabel) {
            displayLabel = ariaLabel.trim();
          }
        }
        
        // 4. Try aria-labelledby
        if (!displayLabel) {
          const ariaLabelledby = el.getAttribute('aria-labelledby');
          if (ariaLabelledby) {
            const labelElement = document.getElementById(ariaLabelledby);
            if (labelElement?.textContent) {
              displayLabel = labelElement.textContent.trim();
            }
          }
        }
        
        // 5. Try placeholder
        if (!displayLabel && placeholder) {
          displayLabel = placeholder;
        }
        
        // 6. Try nearby preceding text (previous sibling or parent)
        if (!displayLabel) {
          const previousSibling = el.previousElementSibling;
          if (previousSibling && previousSibling.tagName !== 'INPUT' && previousSibling.textContent) {
            const text = previousSibling.textContent.trim();
            if (text && text.length < 50) {
              displayLabel = text;
            }
          }
        }
        
        return {
          selector: el.id ? `#${el.id}` : `${tagName}[name="${(el as HTMLInputElement).name}"]`,
          type: (tagName === 'textarea' ? 'textarea' : tagName === 'select' ? 'select' : 'input') as any,
          name: (el as HTMLInputElement).name || undefined,
          id: (el as HTMLElement).id || undefined,
          formIndex: formIndex,
          displayLabel: displayLabel,
          placeholder: placeholder,
        };
      })
    );

    const h1 = await page.$$eval('h1', (elements) =>
      elements.map((el) => el.textContent?.trim() || '')
    );

    return {
      url,
      title,
      links: Array.from(new Set(links)),
      forms,
      buttons,
      inputs,
      h1,
    };
  }

  async takeScreenshot(page: Page): Promise<string> {
    const screenshot = await page.screenshot({ 
      fullPage: true,
      type: 'png' 
    });
    return screenshot.toString('base64');
  }

  async closeContext(contextId: string): Promise<void> {
    const context = this.contexts.get(contextId);
    if (context) {
      await context.close();
      this.contexts.delete(contextId);
      console.log(`[Playwright] Closed context: ${contextId}`);
    }
  }

  async shutdown(): Promise<void> {
    const contexts = Array.from(this.contexts.entries());
    for (const [id, context] of contexts) {
      await context.close();
      this.contexts.delete(id);
    }

    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      console.log('[Playwright] Browser shut down');
    }
  }

  async executeTest(
    page: Page,
    action: string,
    selector: string,
    value?: string
  ): Promise<{ success: boolean; error?: string; screenshot?: string }> {
    try {
      const element = await page.waitForSelector(selector, { timeout: 10000 });
      
      if (!element) {
        return { success: false, error: `Element not found: ${selector}` };
      }

      switch (action) {
        case 'click':
          await element.click();
          break;
        case 'fill':
          if (value) {
            await element.fill(value);
          }
          break;
        case 'type':
          if (value) {
            await element.type(value);
          }
          break;
        case 'select':
          if (value) {
            await element.selectOption(value);
          }
          break;
        default:
          return { success: false, error: `Unknown action: ${action}` };
      }

      const screenshot = await this.takeScreenshot(page);
      return { success: true, screenshot };
    } catch (error: any) {
      return { 
        success: false, 
        error: error.message || 'Test execution failed',
      };
    }
  }
}

export const playwrightService = new PlaywrightService();
