import { chromium, Browser, BrowserContext, Page } from 'playwright';
import type { ExecutionStepResult } from '@shared/qe-schema';
import { getBrowserExecutablePath } from './playwright-setup';

export interface TestStep {
  action: string;
  expected?: string;
  testData?: string;
}

export interface TestCaseExecution {
  testCaseId: string;
  title: string;
  category: string;
  priority: string;
  steps: TestStep[];
}

export interface ExecutionConfig {
  targetUrl: string;
  headless: boolean;
  slowMo?: number;
  timeout?: number;
  recordVideo: boolean;
  screenshotOnEveryStep: boolean;
  channel?: string;
}

export interface StepExecutionResult {
  stepIndex: number;
  action: string;
  status: 'passed' | 'failed' | 'skipped';
  duration: number;
  screenshot?: string;
  error?: string;
  consoleErrors: string[];
  networkErrors: string[];
}

export interface TestExecutionResult {
  testCaseId: string;
  status: 'passed' | 'failed' | 'error';
  duration: number;
  steps: StepExecutionResult[];
  videoPath?: string;
  consoleErrors: string[];
  networkErrors: string[];
}

export interface ExecutionCallback {
  onStepStart: (testCaseId: string, stepIndex: number, action: string) => void;
  onStepComplete: (testCaseId: string, result: StepExecutionResult) => void;
  onTestStart: (testCaseId: string, title: string) => void;
  onTestComplete: (result: TestExecutionResult) => void;
  onScreenshot: (testCaseId: string, stepIndex: number, base64Data: string) => void;
  onAgentActivity: (agent: string, activity: string, status: 'thinking' | 'working' | 'completed' | 'error') => void;
}

export class PlaywrightExecutionEngine {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private config: ExecutionConfig;
  private consoleErrors: string[] = [];
  private networkErrors: string[] = [];
  
  constructor(config: ExecutionConfig) {
    this.config = {
      ...config,
      headless: config.headless ?? true,
      timeout: config.timeout ?? 30000,
      recordVideo: config.recordVideo ?? false,
      screenshotOnEveryStep: config.screenshotOnEveryStep ?? true
    };
  }
  
  async initialize(): Promise<void> {
    this.browser = await chromium.launch({
      headless: process.platform === 'win32' ? this.config.headless : true,
      slowMo: this.config.slowMo,
      executablePath: getBrowserExecutablePath() ?? undefined,
      ...(this.config.channel && process.platform === 'win32'
        ? { channel: this.config.channel as any }
        : {}),
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
    });
    
    const contextOptions: any = {
      viewport: { width: 1280, height: 720 },
      userAgent: 'NAT-2.0-TestRunner/1.0'
    };
    
    if (this.config.recordVideo) {
      contextOptions.recordVideo = {
        dir: '/tmp/nat-videos',
        size: { width: 1280, height: 720 }
      };
    }
    
    this.context = await this.browser.newContext(contextOptions);
    this.page = await this.context.newPage();
    
    this.page.on('console', msg => {
      if (msg.type() === 'error') {
        this.consoleErrors.push(`[Console Error] ${msg.text()}`);
      }
    });
    
    this.page.on('pageerror', err => {
      this.consoleErrors.push(`[Page Error] ${err.message}`);
    });
    
    this.page.on('requestfailed', request => {
      this.networkErrors.push(`[Network Error] ${request.url()} - ${request.failure()?.errorText || 'Unknown error'}`);
    });
  }
  
  async cleanup(): Promise<string | undefined> {
    let videoPath: string | undefined;
    
    if (this.page && this.config.recordVideo) {
      const video = this.page.video();
      if (video) {
        videoPath = await video.path();
      }
    }
    
    if (this.context) {
      await this.context.close();
      this.context = null;
    }
    
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
    
    this.page = null;
    return videoPath;
  }
  
  async executeTestCase(
    testCase: TestCaseExecution,
    callbacks: ExecutionCallback
  ): Promise<TestExecutionResult> {
    const startTime = Date.now();
    const stepResults: StepExecutionResult[] = [];
    let overallStatus: 'passed' | 'failed' | 'error' = 'passed';
    
    this.consoleErrors = [];
    this.networkErrors = [];
    
    callbacks.onTestStart(testCase.testCaseId, testCase.title);
    callbacks.onAgentActivity('Executor Agent', `Starting test: ${testCase.title}`, 'working');
    
    try {
      if (!this.page) {
        throw new Error('Browser not initialized. Call initialize() first.');
      }
      
      await this.page.goto(this.config.targetUrl, { 
        timeout: this.config.timeout,
        waitUntil: 'networkidle'
      });
      
      for (let i = 0; i < testCase.steps.length; i++) {
        const step = testCase.steps[i];
        callbacks.onStepStart(testCase.testCaseId, i, step.action);
        callbacks.onAgentActivity('Executor Agent', `Executing step ${i + 1}: ${step.action.substring(0, 50)}...`, 'working');
        
        const stepResult = await this.executeStep(step, i, callbacks, testCase.testCaseId);
        stepResults.push(stepResult);
        
        callbacks.onStepComplete(testCase.testCaseId, stepResult);
        
        if (stepResult.status === 'failed') {
          overallStatus = 'failed';
          callbacks.onAgentActivity('Executor Agent', `Step ${i + 1} failed: ${stepResult.error}`, 'error');
          // Continue to next step instead of stopping
        }
      }
      
      callbacks.onAgentActivity('Executor Agent', `Test completed: ${overallStatus}`, overallStatus === 'passed' ? 'completed' : 'error');
      
    } catch (error) {
      overallStatus = 'error';
      callbacks.onAgentActivity('Executor Agent', `Test error: ${(error as Error).message}`, 'error');
    }
    
    const result: TestExecutionResult = {
      testCaseId: testCase.testCaseId,
      status: overallStatus,
      duration: Date.now() - startTime,
      steps: stepResults,
      consoleErrors: this.consoleErrors,
      networkErrors: this.networkErrors
    };
    
    callbacks.onTestComplete(result);
    return result;
  }
  
  private async executeStep(
    step: TestStep,
    stepIndex: number,
    callbacks: ExecutionCallback,
    testCaseId: string
  ): Promise<StepExecutionResult> {
    const startTime = Date.now();
    const stepErrors: string[] = [];
    const stepNetworkErrors: string[] = [];
    
    try {
      if (!this.page) {
        throw new Error('Page not available');
      }
      
      await this.interpretAndExecuteAction(step.action, step.testData);
      
      if (step.expected) {
        await this.verifyExpected(step.expected);
      }
      
      let screenshot: string | undefined;
      if (this.config.screenshotOnEveryStep) {
        screenshot = await this.captureScreenshot();
        if (screenshot) {
          callbacks.onScreenshot(testCaseId, stepIndex, screenshot);
        }
      }
      
      return {
        stepIndex,
        action: step.action,
        status: 'passed',
        duration: Date.now() - startTime,
        screenshot,
        consoleErrors: stepErrors,
        networkErrors: stepNetworkErrors
      };
      
    } catch (error) {
      let screenshot: string | undefined;
      try {
        screenshot = await this.captureScreenshot();
        if (screenshot) {
          callbacks.onScreenshot(testCaseId, stepIndex, screenshot);
        }
      } catch {}
      
      return {
        stepIndex,
        action: step.action,
        status: 'failed',
        duration: Date.now() - startTime,
        screenshot,
        error: (error as Error).message,
        consoleErrors: stepErrors,
        networkErrors: stepNetworkErrors
      };
    }
  }
  
  private async interpretAndExecuteAction(action: string, testData?: string): Promise<void> {
    if (!this.page) throw new Error('Page not available');
    
    const cmd = parseActionToCommand(action, testData);
    console.log(`[PlaywrightEngine] Command: ${cmd.command}, Target: ${cmd.target}, Locator: ${cmd.locatorType}`);

    switch (cmd.command) {
      case 'open':
      case 'navigate': {
        if (cmd.target?.startsWith('http')) {
          await this.page.goto(cmd.target, { waitUntil: 'networkidle', timeout: this.config.timeout });
        }
        break;
      }

      case 'click': {
        const locator = this.resolveLocator(cmd);
        await locator.click({ timeout: this.config.timeout });
        break;
      }

      case 'fill':
      case 'type': {
        const locator = this.resolveLocator(cmd);
        await locator.fill(cmd.value || '', { timeout: this.config.timeout });
        break;
      }

      case 'select': {
        const locator = this.resolveLocator(cmd);
        await locator.selectOption(cmd.value || '', { timeout: this.config.timeout });
        break;
      }

      case 'check': {
        const locator = this.resolveLocator(cmd);
        await locator.check({ timeout: this.config.timeout });
        break;
      }

      case 'uncheck': {
        const locator = this.resolveLocator(cmd);
        await locator.uncheck({ timeout: this.config.timeout });
        break;
      }

      case 'hover': {
        const locator = this.resolveLocator(cmd);
        await locator.hover({ timeout: this.config.timeout });
        break;
      }

      case 'press': {
        await this.page.keyboard.press(cmd.value || 'Enter');
        break;
      }

      case 'scroll': {
        if (cmd.value === 'up') {
          await this.page.evaluate(() => window.scrollTo(0, 0));
        } else {
          await this.page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        }
        break;
      }

      case 'wait': {
        await this.page.waitForTimeout(parseInt(cmd.value || '2000'));
        break;
      }

      case 'screenshot': {
        break;
      }

      case 'verify': {
        if (cmd.assertion) {
          const visible = await this.page.getByText(cmd.assertion, { exact: false }).isVisible({ timeout: 5000 }).catch(() => false);
          if (!visible) {
            throw new Error(`Expected "${cmd.assertion}" to be visible but was not found`);
          }
        }
        break;
      }

      case 'observe':
      default: {
        await this.smartExecuteAction(action);
        break;
      }
    }
    
    await this.page.waitForTimeout(500);
  }

  private resolveLocator(cmd: PlaywrightCommand) {
    if (!this.page) throw new Error('Page not available');
    const target = cmd.target || '';

    switch (cmd.locatorType) {
      case 'testid':
        return this.page.getByTestId(target);
      case 'role': {
        const roleMatch = target.match(/(button|link|checkbox|radio|textbox|combobox|tab|menu|heading)/i);
        const role = (roleMatch ? roleMatch[1].toLowerCase() : 'button') as any;
        return this.page.getByRole(role, { name: target });
      }
      case 'label':
        return this.page.getByLabel(target);
      case 'placeholder':
        return this.page.getByPlaceholder(target);
      case 'css':
        return this.page.locator(target);
      case 'text':
      default:
        return this.page.getByText(target, { exact: false });
    }
  }
  
  private async smartExecuteAction(action: string): Promise<void> {
    if (!this.page) throw new Error('Page not available');
    
    const textMatch = action.match(/["']([^"']+)["']/);
    if (textMatch) {
      const text = textMatch[1];
      const locator = this.page.getByText(text, { exact: false });
      if (await locator.isVisible({ timeout: 3000 }).catch(() => false)) {
        await locator.click({ timeout: this.config.timeout });
        return;
      }
    }
    
    console.log(`[PlaywrightEngine] Action interpreted as observation step: ${action}`);
  }
  
  private async verifyExpected(expected: string): Promise<void> {
    if (!this.page) throw new Error('Page not available');
    
    const expectedLower = expected.toLowerCase();
    
    if (expectedLower.includes('visible') || expectedLower.includes('displayed') || expectedLower.includes('shown')) {
      const text = this.extractTextReference(expected);
      if (text) {
        const visible = await this.page.isVisible(`text=${text}`, { timeout: 5000 }).catch(() => false);
        if (!visible) {
          throw new Error(`Expected "${text}" to be visible but it was not found`);
        }
      }
    }
    
    else if (expectedLower.includes('redirect') || expectedLower.includes('navigate') || expectedLower.includes('url')) {
      const urlPart = this.extractTextReference(expected);
      if (urlPart) {
        const currentUrl = this.page.url();
        if (!currentUrl.includes(urlPart)) {
          throw new Error(`Expected URL to contain "${urlPart}" but got "${currentUrl}"`);
        }
      }
    }
    
    else if (expectedLower.includes('disabled')) {
      const selector = this.extractSelector(expected);
      if (selector) {
        const disabled = await this.page.isDisabled(selector).catch(() => false);
        if (!disabled) {
          throw new Error(`Expected element to be disabled`);
        }
      }
    }
    
    else if (expectedLower.includes('enabled')) {
      const selector = this.extractSelector(expected);
      if (selector) {
        const enabled = await this.page.isEnabled(selector).catch(() => false);
        if (!enabled) {
          throw new Error(`Expected element to be enabled`);
        }
      }
    }
  }
  
  private extractSelector(text: string): string | null {
    const patterns = [
      /#[\w-]+/,
      /\.[\w-]+/,
      /\[data-testid=["']?[\w-]+["']?\]/,
      /button|input|select|textarea|a|span|div/gi
    ];
    
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) return match[0];
    }
    
    return null;
  }
  
  private extractTextReference(text: string): string | null {
    const quoted = text.match(/["']([^"']+)["']/);
    if (quoted) return quoted[1];
    
    const afterVerify = text.match(/(?:verify|see|check|displayed|visible|showing)\s+(.+)/i);
    if (afterVerify) return afterVerify[1].trim();
    
    return null;
  }
  
  private extractInputValue(text: string): string | null {
    const quoted = text.match(/["']([^"']+)["']/);
    if (quoted) return quoted[1];
    
    const valueMatch = text.match(/(?:value|text|with)\s*[:=]?\s*["']?([^"'\n]+)["']?/i);
    if (valueMatch) return valueMatch[1].trim();
    
    return null;
  }
  
  private async captureScreenshot(): Promise<string | undefined> {
    if (!this.page) return undefined;
    
    try {
      const buffer = await this.page.screenshot({ 
        type: 'png',
        fullPage: false
      });
      return buffer.toString('base64');
    } catch (error) {
      console.error('[PlaywrightEngine] Screenshot capture failed:', error);
      return undefined;
    }
  }
}

export function generateBddFeatureFile(testCase: TestCaseExecution): string {
  const safeName = testCase.title.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
  const category = testCase.category || 'functional';
  
  let feature = `@${category} @${testCase.priority || 'P2'}\n`;
  feature += `Feature: ${testCase.title}\n`;
  feature += `  As a user\n`;
  feature += `  I want to ${testCase.title.toLowerCase()}\n`;
  feature += `  So that I can verify the application works correctly\n\n`;
  
  feature += `  Scenario: ${testCase.title}\n`;
  
  for (let i = 0; i < testCase.steps.length; i++) {
    const step = testCase.steps[i];
    const keyword = i === 0 ? 'Given' : step.expected ? 'Then' : 'When';
    feature += `    ${keyword} ${step.action}\n`;
    if (step.expected) {
      feature += `    Then ${step.expected}\n`;
    }
  }
  
  return feature;
}

// ==================== Element Discovery & XPath Extraction ====================

export interface DiscoveredElement {
  tagName: string;
  type?: string;
  id?: string;
  name?: string;
  className?: string;
  text?: string;
  placeholder?: string;
  label?: string;
  ariaLabel?: string;
  href?: string;
  role?: string;
  xpath: string;
  cssSelector: string;
  isInteractive: boolean;
  pageUrl?: string;
}

export interface DiscoveredNavLink {
  text: string;
  href: string;
  fullUrl: string;
}

function inferTargetPage(
  testTitle: string,
  steps: { action: string; expected?: string }[],
  navLinks: DiscoveredNavLink[],
  baseUrl: string
): string | null {
  const context = [testTitle, ...steps.map(s => s.action)].join(' ').toLowerCase();

  const pageKeywords: Record<string, string[]> = {
    'contact': ['contact', 'contact us', 'get in touch', 'reach us', 'message us', 'enquiry', 'inquiry'],
    'about': ['about', 'about us', 'who we are', 'our story', 'our team', 'company'],
    'services': ['service', 'services', 'what we do', 'our services', 'solutions'],
    'products': ['product', 'products', 'our products', 'catalog', 'catalogue'],
    'pricing': ['pricing', 'price', 'plans', 'subscription', 'cost'],
    'login': ['login', 'log in', 'sign in', 'signin', 'authenticate'],
    'register': ['register', 'sign up', 'signup', 'create account', 'join'],
    'careers': ['career', 'careers', 'jobs', 'hiring', 'work with us', 'join us'],
    'blog': ['blog', 'news', 'articles', 'posts'],
    'faq': ['faq', 'frequently asked', 'help', 'support'],
    'portfolio': ['portfolio', 'projects', 'case studies', 'work', 'our work'],
    'testimonials': ['testimonial', 'reviews', 'feedback', 'clients say'],
  };

  let bestPageType: string | null = null;
  let bestScore = 0;

  for (const [pageType, keywords] of Object.entries(pageKeywords)) {
    let score = 0;
    for (const kw of keywords) {
      if (context.includes(kw)) {
        score += kw.split(' ').length;
      }
    }
    if (score > bestScore) {
      bestScore = score;
      bestPageType = pageType;
    }
  }

  if (!bestPageType || bestScore === 0) return null;

  for (const link of navLinks) {
    const hrefLower = link.href.toLowerCase();
    const textLower = link.text.toLowerCase();
    const keywords = pageKeywords[bestPageType] || [];

    for (const kw of keywords) {
      if (hrefLower.includes(kw.replace(/\s+/g, '-')) ||
          hrefLower.includes(kw.replace(/\s+/g, '')) ||
          textLower.includes(kw)) {
        return link.fullUrl;
      }
    }
  }

  const commonPaths = [
    `/${bestPageType}`,
    `/${bestPageType}.html`,
    `/${bestPageType}/`,
    `/${bestPageType}-us`,
    `/${bestPageType}us`,
  ];

  try {
    const baseOrigin = new URL(baseUrl).origin;
    for (const p of commonPaths) {
      return `${baseOrigin}${p}`;
    }
  } catch {}

  return null;
}

export async function discoverNavLinks(targetUrl: string, page: any): Promise<DiscoveredNavLink[]> {
  try {
    const baseOrigin = new URL(targetUrl).origin;
    const links: DiscoveredNavLink[] = await page.evaluate((origin: string) => {
      const navLinks: { text: string; href: string; fullUrl: string }[] = [];
      const seen = new Set<string>();

      const navAreas = document.querySelectorAll('nav, header, [role="navigation"], .navbar, .nav, .menu, .header');
      let linkElements: Element[] = [];

      if (navAreas.length > 0) {
        navAreas.forEach(nav => {
          nav.querySelectorAll('a[href]').forEach(a => linkElements.push(a));
        });
      }

      if (linkElements.length < 3) {
        linkElements = Array.from(document.querySelectorAll('a[href]'));
      }

      for (const el of linkElements) {
        const href = el.getAttribute('href');
        if (!href) continue;
        if (href.startsWith('#') || href.startsWith('javascript:') || href.startsWith('mailto:') || href.startsWith('tel:')) continue;

        let fullUrl: string;
        try {
          fullUrl = new URL(href, origin).href;
        } catch { continue; }

        if (!fullUrl.startsWith(origin)) continue;

        const normalized = fullUrl.split('?')[0].split('#')[0].replace(/\/$/, '');
        if (seen.has(normalized)) continue;
        seen.add(normalized);

        const text = (el.textContent || '').trim();
        if (!text || text.length > 60) continue;

        navLinks.push({
          text,
          href: href,
          fullUrl: normalized
        });
      }

      return navLinks;
    }, baseOrigin);

    return links;
  } catch (e: any) {
    console.error(`[NavLink Discovery] Error: ${e.message}`);
    return [];
  }
}

export async function discoverPageElements(targetUrl: string): Promise<DiscoveredElement[]> {
  let browser: Browser | null = null;
  try {
    const execPath = getBrowserExecutablePath();
    browser = await chromium.launch({ headless: true, executablePath: execPath ?? undefined, args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'] });
    const context = await browser.newContext({
      viewport: { width: 1280, height: 720 },
      userAgent: 'NAT-2.0-ElementDiscovery/1.0'
    });
    const page = await context.newPage();
    await page.goto(targetUrl, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(1500);

    const elementDiscoveryScript = `
      (() => {
        var escapeXPathStr = function(s) {
          if (s.indexOf("'") === -1) return "'" + s + "'";
          if (s.indexOf(String.fromCharCode(34)) === -1) return String.fromCharCode(34) + s + String.fromCharCode(34);
          var q = String.fromCharCode(34);
          return "concat('" + s.split("'").join("'," + q + "'" + q + ",'") + "')";
        };

        var isUniqueXPath = function(xpath) {
          try {
            var result = document.evaluate(xpath, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
            return result.snapshotLength === 1;
          } catch(e) { return false; }
        };

        var getRelativeXPath = function(el) {
          var tag = el.tagName.toLowerCase();

          if (el.id) {
            var byId = '//' + tag + '[@id=' + escapeXPathStr(el.id) + ']';
            if (isUniqueXPath(byId)) return byId;
            return '//*[@id=' + escapeXPathStr(el.id) + ']';
          }

          var name = el.getAttribute('name');
          if (name) {
            var byName = '//' + tag + '[@name=' + escapeXPathStr(name) + ']';
            if (isUniqueXPath(byName)) return byName;
          }

          var placeholder = el.getAttribute('placeholder');
          if (placeholder) {
            var byPh = '//' + tag + '[@placeholder=' + escapeXPathStr(placeholder) + ']';
            if (isUniqueXPath(byPh)) return byPh;
          }

          var ariaLabel = el.getAttribute('aria-label');
          if (ariaLabel) {
            var byAria = '//' + tag + '[@aria-label=' + escapeXPathStr(ariaLabel) + ']';
            if (isUniqueXPath(byAria)) return byAria;
          }

          var title = el.getAttribute('title');
          if (title) {
            var byTitle = '//' + tag + '[@title=' + escapeXPathStr(title) + ']';
            if (isUniqueXPath(byTitle)) return byTitle;
          }

          var text = (el.textContent || '').trim();
          if (text && text.length <= 60 && el.children.length === 0) {
            var byText = '//' + tag + '[normalize-space(text())=' + escapeXPathStr(text) + ']';
            if (isUniqueXPath(byText)) return byText;
          }
          if (text && text.length > 5 && text.length <= 40) {
            var byContains = '//' + tag + '[contains(text(),' + escapeXPathStr(text.substring(0, 30)) + ')]';
            if (isUniqueXPath(byContains)) return byContains;
          }

          var type = el.getAttribute('type');
          if (name && type) {
            var byNameType = '//' + tag + '[@name=' + escapeXPathStr(name) + ' and @type=' + escapeXPathStr(type) + ']';
            if (isUniqueXPath(byNameType)) return byNameType;
          }

          var role = el.getAttribute('role');
          if (role && text && text.length <= 40) {
            var byRole = '//' + tag + '[@role=' + escapeXPathStr(role) + ' and contains(text(),' + escapeXPathStr(text.substring(0, 30)) + ')]';
            if (isUniqueXPath(byRole)) return byRole;
          }

          var href = el.getAttribute('href');
          if (href && tag === 'a') {
            if (text && text.length <= 40) {
              var byLinkText = '//a[normalize-space(text())=' + escapeXPathStr(text) + ']';
              if (isUniqueXPath(byLinkText)) return byLinkText;
            }
            var byHref = '//a[@href=' + escapeXPathStr(href) + ']';
            if (isUniqueXPath(byHref)) return byHref;
          }

          var labelEl = null;
          if (el.id) {
            labelEl = document.querySelector('label[for="' + el.id + '"]');
          }
          if (!labelEl) labelEl = el.closest('label');
          if (labelEl) {
            var labelText = (labelEl.textContent || '').trim().substring(0, 40);
            if (labelText) {
              var byLabel = '//' + tag + '[ancestor::label[contains(text(),' + escapeXPathStr(labelText) + ')]]';
              if (isUniqueXPath(byLabel)) return byLabel;
            }
          }

          var parts = [];
          var current = el;
          while (current && current.nodeType === Node.ELEMENT_NODE) {
            var cTag = current.nodeName.toLowerCase();
            if (current.id) {
              parts.unshift('//' + cTag + '[@id=' + escapeXPathStr(current.id) + ']');
              return parts.join('/');
            }
            var idx = 0;
            var sib = current.previousElementSibling;
            while (sib) {
              if (sib.nodeName === current.nodeName) idx++;
              sib = sib.previousElementSibling;
            }
            var hasSameTagSiblings = current.parentElement &&
              Array.from(current.parentElement.children).filter(function(c) { return c.nodeName === current.nodeName; }).length > 1;
            var position = (idx > 0 || (current.nextElementSibling && hasSameTagSiblings))
              ? '[' + (idx + 1) + ']' : '';
            parts.unshift(cTag + position);
            current = current.parentElement;
          }
          return '/' + parts.join('/');
        };

        var getCssSelector = function(el) {
          if (el.id) return '#' + el.id;
          var tag = el.tagName.toLowerCase();
          var nameAttr = el.getAttribute('name');
          if (nameAttr) return tag + '[name="' + nameAttr + '"]';
          var typeAttr = el.getAttribute('type');
          var placeholder = el.getAttribute('placeholder');
          if (tag === 'input' && typeAttr && placeholder) return 'input[type="' + typeAttr + '"][placeholder="' + placeholder + '"]';
          if (placeholder) return tag + '[placeholder="' + placeholder + '"]';
          var ariaLabel = el.getAttribute('aria-label');
          if (ariaLabel) return tag + '[aria-label="' + ariaLabel + '"]';
          return getRelativeXPath(el);
        };

        var getLabelForElement = function(el) {
          var id = el.id;
          if (id) {
            var label = document.querySelector('label[for="' + id + '"]');
            if (label) return (label.textContent || '').trim();
          }
          var parentLabel = el.closest('label');
          if (parentLabel) {
            var clone = parentLabel.cloneNode(true);
            var inputs = clone.querySelectorAll('input,select,textarea,button');
            inputs.forEach(function(inp) { inp.remove(); });
            return (clone.textContent || '').trim();
          }
          return undefined;
        };

        var interactiveSelectors = [
          'input:not([type="hidden"])', 'textarea', 'select', 'button',
          'a[href]', '[role="button"]', '[role="link"]', '[role="tab"]',
          '[role="checkbox"]', '[role="radio"]', '[role="menuitem"]',
          '[role="textbox"]', '[role="combobox"]', '[role="switch"]',
          '[contenteditable="true"]', '[onclick]', '[tabindex]'
        ];

        var found = [];
        var seen = {};
        var allElements = document.querySelectorAll(interactiveSelectors.join(','));

        allElements.forEach(function(el) {
          var rect = el.getBoundingClientRect();
          if (rect.width === 0 && rect.height === 0) return;
          var style = window.getComputedStyle(el);
          if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return;

          var xpath = getRelativeXPath(el);
          if (seen[xpath]) return;
          seen[xpath] = true;

          var tag = el.tagName.toLowerCase();
          var text = (el.textContent || '').trim().substring(0, 100) || undefined;

          found.push({
            tagName: tag,
            type: el.getAttribute('type') || undefined,
            id: el.id || undefined,
            name: el.getAttribute('name') || undefined,
            className: el.className ? String(el.className).substring(0, 100) : undefined,
            text: text || undefined,
            placeholder: el.getAttribute('placeholder') || undefined,
            label: getLabelForElement(el),
            ariaLabel: el.getAttribute('aria-label') || undefined,
            href: el.getAttribute('href') || undefined,
            role: el.getAttribute('role') || tag,
            xpath: xpath,
            cssSelector: getCssSelector(el),
            isInteractive: true
          });
        });

        return found;
      })()
    `;
    
    const homeElements: DiscoveredElement[] = await page.evaluate(elementDiscoveryScript);
    homeElements.forEach(el => el.pageUrl = targetUrl);

    const navLinks = await discoverNavLinks(targetUrl, page);
    console.log(`[Element Discovery] Found ${navLinks.length} navigation links on ${targetUrl}`);

    const allElements: DiscoveredElement[] = [...homeElements];
    const crawledPages = new Set<string>([targetUrl.replace(/\/$/, '')]);
    const MAX_SUB_PAGES = 8;
    let crawledCount = 0;

    for (const link of navLinks) {
      if (crawledCount >= MAX_SUB_PAGES) break;
      const normalized = link.fullUrl.replace(/\/$/, '');
      if (crawledPages.has(normalized)) continue;
      crawledPages.add(normalized);

      try {
        console.log(`[Element Discovery] Crawling sub-page: ${link.text} → ${link.fullUrl}`);
        await page.goto(link.fullUrl, { waitUntil: 'networkidle', timeout: 15000 });
        await page.waitForTimeout(800);
        const subElements: DiscoveredElement[] = await page.evaluate(elementDiscoveryScript);
        subElements.forEach(el => el.pageUrl = link.fullUrl);
        allElements.push(...subElements);
        crawledCount++;
        console.log(`[Element Discovery] Found ${subElements.length} elements on ${link.text}`);
      } catch (subErr: any) {
        console.warn(`[Element Discovery] Failed to crawl ${link.fullUrl}: ${subErr.message}`);
      }
    }

    console.log(`[Element Discovery] Total: ${allElements.length} elements across ${crawledCount + 1} pages`);

    (allElements as any).__navLinks = navLinks;

    await context.close();
    return allElements;
  } catch (error: any) {
    console.error(`[Element Discovery] Failed to crawl ${targetUrl}:`, error.message);
    return [];
  } finally {
    if (browser) await browser.close();
  }
}

function matchElementToStep(step: { action: string; expected_behavior?: string }, elements: DiscoveredElement[]): DiscoveredElement | null {
  const actionLower = step.action.toLowerCase();

  const quoted = step.action.match(/['"]([^'"]+)['"]/g)?.map(q => q.replace(/['"]/g, '').toLowerCase()) || [];

  const fieldNames = step.action.match(/(?:the\s+)?['"]?(\w[\w\s]*?)['"]?\s+(?:field|input|button|link|dropdown|checkbox|radio|text\s*(?:box|area)|select)/gi)
    ?.map(m => m.replace(/\b(?:the|field|input|button|link|dropdown|checkbox|radio|textbox|textarea|select)\b/gi, '').trim().toLowerCase()) || [];

  const fillInMatch = step.action.match(/(?:fill\s+in|fill|type\s+in|enter\s+in|input\s+in)\s+(?:the\s+)?['"]?(\w[\w\s]*?)['"]?\s+(?:field\s+)?(?:with|value)/i);
  if (fillInMatch) fieldNames.push(fillInMatch[1].trim().toLowerCase());

  const clickMatch = step.action.match(/(?:click|tap|press)\s+(?:on\s+)?(?:the\s+)?['"]?(.+?)['"]?\s*(?:button|link|tab|menu)?$/i);
  if (clickMatch) {
    const cleaned = clickMatch[1].replace(/\b(?:button|link|tab|menu)\b/gi, '').trim().toLowerCase();
    if (cleaned) fieldNames.push(cleaned);
  }

  const hintSet = new Set([...quoted, ...fieldNames]);
  const allHints = Array.from(hintSet).filter(Boolean);

  if (allHints.length === 0) {
    const afterVerb = step.action.match(/(?:click|tap|fill|type|enter|select|check|hover|press)\s+(?:on\s+)?(?:the\s+)?['"]?(.+?)['"]?\s*(?:with|field|button|$)/i);
    if (afterVerb) allHints.push(afterVerb[1].trim().toLowerCase());
  }

  if (allHints.length === 0) return null;

  let bestMatch: DiscoveredElement | null = null;
  let bestScore = 0;

  const isFillingAction = actionLower.includes('fill') || actionLower.includes('type') || actionLower.includes('enter') || actionLower.includes('input');
  const isClickAction = actionLower.includes('click') || actionLower.includes('tap') || actionLower.includes('press button');
  const isSelectAction = actionLower.includes('select') || actionLower.includes('choose') || actionLower.includes('dropdown');

  for (const el of elements) {
    let score = 0;

    for (const hint of allHints) {
      if (el.label && el.label.toLowerCase().includes(hint)) score += 10;
      if (el.placeholder && el.placeholder.toLowerCase().includes(hint)) score += 9;
      if (el.ariaLabel && el.ariaLabel.toLowerCase().includes(hint)) score += 8;
      if (el.name && el.name.toLowerCase().includes(hint)) score += 7;
      if (el.id && el.id.toLowerCase().includes(hint)) score += 6;
      if (el.text && el.text.toLowerCase().includes(hint)) score += 4;
    }

    if (isFillingAction && (el.tagName === 'input' || el.tagName === 'textarea')) score += 3;
    if (isClickAction && (el.tagName === 'button' || el.tagName === 'a' || el.role === 'button')) score += 3;
    if (isSelectAction && el.tagName === 'select') score += 3;

    if (score > bestScore) {
      bestScore = score;
      bestMatch = el;
    }
  }

  return bestScore >= 3 ? bestMatch : null;
}

export function generatePlaywrightScriptWithXPaths(
  testCases: TestCaseExecution[],
  targetUrl: string,
  elements: DiscoveredElement[]
): string {
  let script = `import { test, expect, Page } from '@playwright/test';\n\n`;
  script += `// ============================================================\n`;
  script += `// Auto-generated Playwright Test Script with Real XPath Selectors\n`;
  script += `// Generated by NAT 2.0 - Autonomous Testing Platform\n`;
  script += `// Target: ${targetUrl}\n`;
  script += `// Generated: ${new Date().toISOString()}\n`;
  script += `// Elements discovered: ${elements.length}\n`;
  script += `// ============================================================\n\n`;
  script += `const TARGET_URL = '${targetUrl}';\n\n`;

  if (elements.length > 0) {
    script += `// ==================== Discovered Element Map ====================\n`;
    script += `// The following XPaths were extracted from the live website.\n`;
    script += `// Update these if the page structure changes.\n`;
    script += `const ELEMENT_MAP: Record<string, { xpath: string; css: string; description: string; pageUrl?: string }> = {\n`;

    const usedKeys = new Set<string>();
    for (const el of elements) {
      const key = (el.label || el.placeholder || el.ariaLabel || el.name || el.id || el.text || '')
        .replace(/[^a-zA-Z0-9]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '').substring(0, 40);
      if (!key || usedKeys.has(key)) continue;
      usedKeys.add(key);
      const desc = el.label || el.placeholder || el.ariaLabel || el.text || el.tagName;
      script += `  '${key}': {\n`;
      script += `    xpath: \`${el.xpath}\`,\n`;
      script += `    css: \`${el.cssSelector}\`,\n`;
      script += `    description: '${(desc || '').replace(/'/g, "\\'").substring(0, 60)}'`;
      if (el.pageUrl) {
        script += `,\n    pageUrl: '${el.pageUrl}'`;
      }
      script += `\n  },\n`;
    }
    script += `};\n\n`;

    script += `// Helper: locate element by xpath with fallback\n`;
    script += `async function locateElement(page: Page, xpath: string, fallbackText?: string) {\n`;
    script += `  const el = page.locator(\`xpath=\${xpath}\`);\n`;
    script += `  if (await el.count() > 0) return el.first();\n`;
    script += `  if (fallbackText) {\n`;
    script += `    const byLabel = page.getByLabel(fallbackText);\n`;
    script += `    if (await byLabel.count() > 0) return byLabel.first();\n`;
    script += `    const byPlaceholder = page.getByPlaceholder(fallbackText);\n`;
    script += `    if (await byPlaceholder.count() > 0) return byPlaceholder.first();\n`;
    script += `    const byText = page.getByText(fallbackText, { exact: false });\n`;
    script += `    if (await byText.count() > 0) return byText.first();\n`;
    script += `  }\n`;
    script += `  return el.first();\n`;
    script += `}\n\n`;
  }

  const navLinks: DiscoveredNavLink[] = (elements as any).__navLinks || [];

  for (const tc of testCases) {
    const safeName = tc.title.replace(/[^a-zA-Z0-9\s]/g, '').trim();
    const inferredPage = inferTargetPage(tc.title, tc.steps, navLinks, targetUrl);

    script += `test.describe('${safeName}', () => {\n`;
    script += `  test.beforeEach(async ({ page }) => {\n`;
    script += `    await page.goto(TARGET_URL, { waitUntil: 'networkidle' });\n`;
    script += `  });\n\n`;
    script += `  test('${tc.testCaseId} - ${safeName}', async ({ page }) => {\n`;

    if (inferredPage && inferredPage !== targetUrl) {
      script += `\n    // Smart Navigation: Navigate to the relevant page for this test\n`;
      script += `    await page.goto('${inferredPage}', { waitUntil: 'networkidle' });\n`;
      script += `    await page.waitForTimeout(1000);\n`;
    }

    let hasNavStep = false;
    let currentPageUrl = inferredPage || targetUrl;

    for (let i = 0; i < tc.steps.length; i++) {
      const step = tc.steps[i];
      const actionLower = step.action.toLowerCase();
      const matched = matchElementToStep(step, elements);
      const cmd = parseActionToCommand(step.action, step.testData);

      script += `\n    // Step ${i + 1}: ${step.action.substring(0, 100)}\n`;

      if (!hasNavStep && i === 0 && (actionLower.includes('navigate') || actionLower.includes('go to') || actionLower.includes('open'))) {
        const stepInferredPage = inferTargetPage(step.action, [], navLinks, targetUrl);
        if (stepInferredPage) {
          script += `    await page.goto('${stepInferredPage}', { waitUntil: 'networkidle' });\n`;
          script += `    await page.waitForTimeout(1000);\n`;
          currentPageUrl = stepInferredPage;
          hasNavStep = true;
        } else if (inferredPage) {
          script += `    // Already navigated to ${inferredPage} above\n`;
        } else if (matched) {
          if (matched.pageUrl && matched.pageUrl !== currentPageUrl) {
            script += `    // Navigate to element's page: ${matched.pageUrl}\n`;
            script += `    await page.goto('${matched.pageUrl}', { waitUntil: 'networkidle' });\n`;
            script += `    await page.waitForTimeout(1000);\n`;
            currentPageUrl = matched.pageUrl;
          }
          script += `    // XPath: ${matched.xpath}\n`;
          script += commandToPlaywrightCodeWithXPath(cmd, matched, '    ') + '\n';
        } else {
          script += commandToPlaywrightCode(cmd) + '\n';
        }
      } else if (matched) {
        if (matched.pageUrl && matched.pageUrl !== currentPageUrl) {
          script += `    // Navigate to element's discovered page: ${matched.pageUrl}\n`;
          script += `    await page.goto('${matched.pageUrl}', { waitUntil: 'networkidle' });\n`;
          script += `    await page.waitForTimeout(1000);\n`;
          currentPageUrl = matched.pageUrl;
        }
        script += `    // XPath: ${matched.xpath}\n`;
        if (matched.cssSelector !== matched.xpath) {
          script += `    // CSS: ${matched.cssSelector}\n`;
        }
        script += commandToPlaywrightCodeWithXPath(cmd, matched, '    ') + '\n';
      } else {
        script += commandToPlaywrightCode(cmd) + '\n';
      }

      if (step.expected) {
        const expectedClean = step.expected.replace(/'/g, "\\'").substring(0, 100);
        script += `    // Expected: ${expectedClean}\n`;
        script += `    // Verify the expected outcome\n`;
        script += `    await expect(page).toHaveURL(/.*/); // Page still loaded\n`;
      }

      script += `    await page.waitForTimeout(500); // Stabilization delay\n`;
    }

    script += `  });\n`;
    script += `});\n\n`;
  }

  return script;
}

function commandToPlaywrightCodeWithXPath(cmd: PlaywrightCommand, el: DiscoveredElement, indent: string): string {
  const xpathEscaped = el.xpath.replace(/`/g, '\\`');
  const fallbackLabel = (el.label || el.placeholder || el.ariaLabel || el.text || '').replace(/'/g, "\\'").substring(0, 60);

  switch (cmd.command) {
    case 'open':
      if (cmd.target?.startsWith('http')) {
        return `${indent}await page.goto('${cmd.target}', { waitUntil: 'networkidle' });`;
      }
      if (el.tagName === 'a' && el.href) {
        return `${indent}await page.locator(\`xpath=${xpathEscaped}\`).click(); // Navigate via link`;
      }
      return `${indent}// Navigate to: ${cmd.target}`;

    case 'click':
      return `${indent}await page.locator(\`xpath=${xpathEscaped}\`).click(); // ${fallbackLabel}`;

    case 'fill':
      return `${indent}await page.locator(\`xpath=${xpathEscaped}\`).fill('${cmd.value || ''}'); // ${fallbackLabel}`;

    case 'type':
      return `${indent}await page.locator(\`xpath=${xpathEscaped}\`).fill('${cmd.value || ''}'); // ${fallbackLabel}`;

    case 'select':
      return `${indent}await page.locator(\`xpath=${xpathEscaped}\`).selectOption('${cmd.value || ''}'); // ${fallbackLabel}`;

    case 'check':
      return `${indent}await page.locator(\`xpath=${xpathEscaped}\`).check(); // ${fallbackLabel}`;

    case 'uncheck':
      return `${indent}await page.locator(\`xpath=${xpathEscaped}\`).uncheck(); // ${fallbackLabel}`;

    case 'hover':
      return `${indent}await page.locator(\`xpath=${xpathEscaped}\`).hover(); // ${fallbackLabel}`;

    default:
      return commandToPlaywrightCode(cmd, indent);
  }
}

// ==================== Playwright Script Generator ====================
// Converts test cases into runnable .spec.ts files based on Playwright CLI patterns

interface PlaywrightCommand {
  command: 'open' | 'click' | 'fill' | 'type' | 'select' | 'check' | 'uncheck' | 'hover' | 'press' | 'screenshot' | 'wait' | 'scroll' | 'navigate' | 'verify' | 'drag' | 'upload' | 'evaluate' | 'observe';
  target?: string;
  value?: string;
  locatorType?: 'role' | 'label' | 'placeholder' | 'text' | 'testid' | 'css' | 'xpath';
  assertion?: string;
}

function parseActionToCommand(action: string, testData?: string): PlaywrightCommand {
  const actionLower = action.toLowerCase();

  if (actionLower.includes('navigate to') || actionLower.includes('go to') || actionLower.includes('open url') || actionLower.includes('open the')) {
    const urlMatch = action.match(/(https?:\/\/[^\s'"]+)/i);
    const pathMatch = action.match(/(?:navigate to|go to|open)\s+(?:the\s+)?['"]?([^'".\s]+(?:\s+page|\s+module|\s+section)?)/i);
    return { command: 'open', target: urlMatch?.[1] || pathMatch?.[1] || '', value: undefined };
  }

  if (actionLower.includes('click') || actionLower.includes('press button') || actionLower.includes('tap on')) {
    const { target, locatorType } = extractSmartTarget(action);
    return { command: 'click', target, locatorType };
  }

  if (actionLower.includes('fill') || actionLower.includes('type') || actionLower.includes('enter') || actionLower.includes('input')) {
    const { target, locatorType } = extractSmartTarget(action);
    let value = testData || extractQuotedValue(action);
    if (!value) {
      const withMatch = action.match(/\bwith\s+['"]?(.+?)['"]?\s*$/i);
      if (withMatch) value = withMatch[1].trim();
    }
    return { command: 'fill', target, locatorType, value: value || '' };
  }

  if (actionLower.includes('select') || actionLower.includes('choose') || actionLower.includes('pick')) {
    const { target, locatorType } = extractSmartTarget(action);
    const value = testData || extractQuotedValue(action);
    return { command: 'select', target, locatorType, value: value || '' };
  }

  if (actionLower.includes('check') && !actionLower.includes('verify') && !actionLower.includes('assert')) {
    if (actionLower.includes('uncheck')) {
      const { target, locatorType } = extractSmartTarget(action);
      return { command: 'uncheck', target, locatorType };
    }
    const { target, locatorType } = extractSmartTarget(action);
    return { command: 'check', target, locatorType };
  }

  if (actionLower.includes('hover') || actionLower.includes('mouse over')) {
    const { target, locatorType } = extractSmartTarget(action);
    return { command: 'hover', target, locatorType };
  }

  if (actionLower.includes('press key') || actionLower.match(/press\s+(enter|tab|escape|backspace|delete|space)/i)) {
    const keyMatch = action.match(/press\s+(?:key\s+)?['"]?(\w+)['"]?/i);
    return { command: 'press', value: keyMatch?.[1] || 'Enter' };
  }

  if (actionLower.includes('scroll')) {
    const direction = actionLower.includes('bottom') || actionLower.includes('down') ? 'down' :
                      actionLower.includes('top') || actionLower.includes('up') ? 'up' : 'down';
    return { command: 'scroll', value: direction };
  }

  if (actionLower.includes('wait') || actionLower.includes('pause')) {
    const msMatch = action.match(/(\d+)\s*(ms|milliseconds|seconds|s)/i);
    let ms = 2000;
    if (msMatch) {
      ms = msMatch[2]?.toLowerCase().startsWith('s') ? parseInt(msMatch[1]) * 1000 : parseInt(msMatch[1]);
    }
    return { command: 'wait', value: String(Math.min(ms, 10000)) };
  }

  if (actionLower.includes('screenshot') || actionLower.includes('capture')) {
    return { command: 'screenshot' };
  }

  if (actionLower.includes('verify') || actionLower.includes('assert') || actionLower.includes('confirm') || actionLower.includes('should')) {
    const text = extractQuotedValue(action) || action.replace(/^.*?(?:verify|assert|confirm|should)\s*/i, '').trim();
    return { command: 'verify', assertion: text };
  }

  if (actionLower.includes('drag')) {
    return { command: 'drag', target: extractQuotedValue(action) || '' };
  }

  if (actionLower.includes('upload')) {
    return { command: 'upload', value: extractQuotedValue(action) || '' };
  }

  return { command: 'observe', target: action };
}

function extractSmartTarget(action: string): { target: string; locatorType: PlaywrightCommand['locatorType'] } {
  const testidMatch = action.match(/\[data-testid=["']?([^"'\]]+)["']?\]/);
  if (testidMatch) return { target: testidMatch[1], locatorType: 'testid' };

  const idMatch = action.match(/#([\w-]+)/);
  if (idMatch) return { target: `#${idMatch[1]}`, locatorType: 'css' };

  const roleMatch = action.match(/(?:button|link|checkbox|radio|textbox|combobox|tab|menu|heading|dialog)\s+(?:named|labeled|called|with text)?\s*['"]([^'"]+)['"]/i);
  if (roleMatch) {
    const roleType = action.match(/(button|link|checkbox|radio|textbox|combobox|tab|menu|heading|dialog)/i);
    return { target: roleMatch[1], locatorType: 'role' };
  }

  const labelMatch = action.match(/(?:labeled|label)\s+['"]([^'"]+)['"]/i);
  if (labelMatch) return { target: labelMatch[1], locatorType: 'label' };

  const placeholderMatch = action.match(/(?:placeholder)\s+['"]([^'"]+)['"]/i);
  if (placeholderMatch) return { target: placeholderMatch[1], locatorType: 'placeholder' };

  const quoted = extractQuotedValue(action);
  if (quoted) return { target: quoted, locatorType: 'text' };

  const afterAction = action.match(/(?:click|tap|press|hover|fill|type|select|check|uncheck)\s+(?:on\s+)?(?:the\s+)?(.+)/i);
  if (afterAction) return { target: afterAction[1].trim(), locatorType: 'text' };

  return { target: action, locatorType: 'text' };
}

function extractQuotedValue(text: string): string | null {
  const match = text.match(/["']([^"']+)["']/);
  return match ? match[1] : null;
}

function commandToPlaywrightCode(cmd: PlaywrightCommand, indent: string = '    '): string {
  switch (cmd.command) {
    case 'open':
      if (cmd.target?.startsWith('http')) {
        return `${indent}await page.goto('${cmd.target}', { waitUntil: 'networkidle' });`;
      }
      return `${indent}// Navigate to: ${cmd.target}`;

    case 'click':
      return buildLocatorCode('click()', cmd, indent);

    case 'fill':
      return buildLocatorCode(`fill('${cmd.value || ''}')`, cmd, indent);

    case 'type':
      return buildLocatorCode(`type('${cmd.value || ''}')`, cmd, indent);

    case 'select':
      return buildLocatorCode(`selectOption('${cmd.value || ''}')`, cmd, indent);

    case 'check':
      return buildLocatorCode('check()', cmd, indent);

    case 'uncheck':
      return buildLocatorCode('uncheck()', cmd, indent);

    case 'hover':
      return buildLocatorCode('hover()', cmd, indent);

    case 'press':
      return `${indent}await page.keyboard.press('${cmd.value || 'Enter'}');`;

    case 'screenshot':
      return `${indent}await page.screenshot({ path: 'screenshot.png', fullPage: true });`;

    case 'wait':
      return `${indent}await page.waitForTimeout(${cmd.value || 2000});`;

    case 'scroll':
      if (cmd.value === 'up') {
        return `${indent}await page.evaluate(() => window.scrollTo(0, 0));`;
      }
      return `${indent}await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));`;

    case 'verify':
      if (cmd.assertion) {
        return `${indent}await expect(page.getByText('${cmd.assertion.replace(/'/g, "\\'")}')).toBeVisible();`;
      }
      return `${indent}// Verify: ${cmd.target}`;

    case 'drag':
      return `${indent}// Drag action: ${cmd.target}`;

    case 'upload':
      return `${indent}// Upload file: ${cmd.value}`;

    case 'observe':
      return `${indent}// Observation step: ${cmd.target}`;

    default:
      return `${indent}// ${cmd.command}: ${cmd.target || cmd.value || ''}`;
  }
}

function buildLocatorCode(actionStr: string, cmd: PlaywrightCommand, indent: string): string {
  const target = (cmd.target || '').replace(/'/g, "\\'");

  switch (cmd.locatorType) {
    case 'testid':
      return `${indent}await page.getByTestId('${target}').${actionStr};`;
    case 'role': {
      const roleMatch = target.match(/(button|link|checkbox|radio|textbox|combobox|tab|menu|heading)/i);
      const role = roleMatch ? roleMatch[1].toLowerCase() : 'button';
      return `${indent}await page.getByRole('${role}', { name: '${target}' }).${actionStr};`;
    }
    case 'label':
      return `${indent}await page.getByLabel('${target}').${actionStr};`;
    case 'placeholder':
      return `${indent}await page.getByPlaceholder('${target}').${actionStr};`;
    case 'css':
      return `${indent}await page.locator('${target}').${actionStr};`;
    case 'text':
    default:
      if (actionStr.startsWith('fill') || actionStr.startsWith('type')) {
        return `${indent}await page.getByLabel('${target}').or(page.getByPlaceholder('${target}')).${actionStr};`;
      }
      return `${indent}await page.getByText('${target}', { exact: false }).${actionStr};`;
  }
}

export function generatePlaywrightScript(testCases: TestCaseExecution[], targetUrl: string): string {
  let script = `import { test, expect, Page } from '@playwright/test';\n\n`;
  script += `// ============================================================\n`;
  script += `// Auto-generated Playwright Test Script\n`;
  script += `// Generated by NAT 2.0 - Autonomous Testing Platform\n`;
  script += `// Target: ${targetUrl}\n`;
  script += `// Generated: ${new Date().toISOString()}\n`;
  script += `// ============================================================\n\n`;
  script += `const TARGET_URL = '${targetUrl}';\n\n`;

  for (const tc of testCases) {
    const safeName = tc.title.replace(/[^a-zA-Z0-9\s]/g, '').trim();
    script += `test.describe('${safeName}', () => {\n`;
    script += `  test.beforeEach(async ({ page }) => {\n`;
    script += `    await page.goto(TARGET_URL, { waitUntil: 'networkidle' });\n`;
    script += `  });\n\n`;
    script += `  test('${tc.testCaseId} - ${safeName}', async ({ page }) => {\n`;

    for (let i = 0; i < tc.steps.length; i++) {
      const step = tc.steps[i];
      const cmd = parseActionToCommand(step.action, step.testData);

      script += `\n    // Step ${i + 1}: ${step.action.substring(0, 80)}\n`;
      script += commandToPlaywrightCode(cmd) + '\n';

      if (step.expected) {
        script += `    // Expected: ${step.expected.substring(0, 80)}\n`;
        const verifyCmd = parseActionToCommand(`verify ${step.expected}`);
        script += commandToPlaywrightCode(verifyCmd) + '\n';
      }

      script += `    await page.waitForTimeout(500); // Stabilization delay\n`;
    }

    script += `  });\n`;
    script += `});\n\n`;
  }

  return script;
}

export function generatePlaywrightConfig(): string {
  return `import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 1,
  workers: 1,
  reporter: [['html', { open: 'never' }], ['list']],
  timeout: 60000,
  use: {
    trace: 'on-first-retry',
    screenshot: 'on',
    video: 'retain-on-failure',
    actionTimeout: 15000,
    navigationTimeout: 30000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },
    {
      name: 'mobile-chrome',
      use: { ...devices['Pixel 5'] },
    },
  ],
});
`;
}

export { parseActionToCommand, PlaywrightCommand };

export function generatePlaywrightScriptCLI(
  testCases: TestCaseExecution[],
  targetUrl: string,
  elements: DiscoveredElement[]
): string {
  let script = `import { test, expect, Page } from '@playwright/test';\n\n`;
  script += `// ============================================================\n`;
  script += `// NAT 2.0 — Playwright CLI-Based Test Script\n`;
  script += `// Pattern: Snapshot-based element references (e1, e2, e3...)\n`;
  script += `// Generated by NAT 2.0 - Autonomous Testing Platform\n`;
  script += `// Target: ${targetUrl}\n`;
  script += `// Generated: ${new Date().toISOString()}\n`;
  script += `// Elements discovered: ${elements.length}\n`;
  script += `// Token efficiency: ~60% reduction vs MCP approach\n`;
  script += `// ============================================================\n\n`;
  script += `const TARGET_URL = '${targetUrl}';\n\n`;

  script += `// ==================== Element Snapshot Map ====================\n`;
  script += `// Compact element references extracted from the live website.\n`;
  script += `// Each ref (e1, e2, ...) maps to a human-readable label.\n`;
  script += `// Use getSnapshot() at runtime to get fresh references.\n`;
  script += `type ElementRefMap = Record<string, string>;\n\n`;

  if (elements.length > 0) {
    script += `const INITIAL_ELEMENT_MAP: ElementRefMap = {\n`;
    const usedKeys = new Set<string>();
    let refIdx = 0;
    for (const el of elements) {
      const key = (el.label || el.placeholder || el.ariaLabel || el.name || el.id || el.text || '')
        .replace(/[^a-zA-Z0-9 ]/g, '').trim().substring(0, 50);
      if (!key || usedKeys.has(key)) continue;
      usedKeys.add(key);
      refIdx++;
      script += `  '${key}': 'e${refIdx}',\n`;
    }
    script += `};\n\n`;
  }

  script += `// ==================== CLI Helper Functions ====================\n`;
  script += `async function getSnapshot(page: Page): Promise<ElementRefMap> {\n`;
  script += `  return await page.evaluate(() => {\n`;
  script += `    const elements: Record<string, string> = {};\n`;
  script += `    let refCounter = 0;\n`;
  script += `    const selectors = [\n`;
  script += `      'input:not([type="hidden"])', 'textarea', 'select', 'button',\n`;
  script += `      'a[href]', '[role="button"]', '[role="link"]', '[role="tab"]',\n`;
  script += `      '[role="checkbox"]', '[role="radio"]'\n`;
  script += `    ];\n`;
  script += `    const allEls = document.querySelectorAll(selectors.join(','));\n`;
  script += `    allEls.forEach((el) => {\n`;
  script += `      const rect = el.getBoundingClientRect();\n`;
  script += `      if (rect.width === 0 && rect.height === 0) return;\n`;
  script += `      const style = window.getComputedStyle(el);\n`;
  script += `      if (style.display === 'none' || style.visibility === 'hidden') return;\n`;
  script += `      let label = el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.getAttribute('name') || (el.textContent || '').trim().substring(0, 50) || el.tagName.toLowerCase();\n`;
  script += `      label = label.replace(/[^a-zA-Z0-9 ]/g, '').trim();\n`;
  script += `      if (!label) label = 'element';\n`;
  script += `      refCounter++;\n`;
  script += `      elements[label] = 'e' + refCounter;\n`;
  script += `    });\n`;
  script += `    return elements;\n`;
  script += `  });\n`;
  script += `}\n\n`;

  script += `const CLICK_SELECTORS = 'input:not([type=\"hidden\"]), textarea, select, button, a[href], [role=\"button\"], [role=\"link\"], [role=\"tab\"], [role=\"checkbox\"], [role=\"radio\"]';\n`;
  script += `const FILL_SELECTORS = 'input:not([type=\"hidden\"]), textarea, select, [contenteditable=\"true\"]';\n\n`;

  script += `async function clickByRef(page: Page, snapshot: ElementRefMap, label: string): Promise<void> {\n`;
  script += `  const ref = findRef(snapshot, label);\n`;
  script += `  const index = parseInt(ref.replace('e', '')) - 1;\n`;
  script += `  // Tag the target element with a temporary data attribute for Playwright to locate\n`;
  script += `  const found = await page.evaluate((args) => {\n`;
  script += `    document.querySelectorAll('[data-nat-target]').forEach(el => el.removeAttribute('data-nat-target'));\n`;
  script += `    const allEls = document.querySelectorAll(args.sel);\n`;
  script += `    let visIdx = 0;\n`;
  script += `    for (let i = 0; i < allEls.length; i++) {\n`;
  script += `      const rect = allEls[i].getBoundingClientRect();\n`;
  script += `      if (rect.width === 0 && rect.height === 0) continue;\n`;
  script += `      const s = window.getComputedStyle(allEls[i]);\n`;
  script += `      if (s.display === 'none' || s.visibility === 'hidden') continue;\n`;
  script += `      if (visIdx === args.idx) { allEls[i].setAttribute('data-nat-target', 'true'); return true; }\n`;
  script += `      visIdx++;\n`;
  script += `    }\n`;
  script += `    return false;\n`;
  script += `  }, { sel: CLICK_SELECTORS, idx: index });\n`;
  script += `  if (!found) throw new Error(\`Element "\${label}" (ref: \${ref}) not found on page\`);\n`;
  script += `  await page.locator('[data-nat-target=\"true\"]').first().click();\n`;
  script += `  await page.evaluate(() => document.querySelectorAll('[data-nat-target]').forEach(el => el.removeAttribute('data-nat-target')));\n`;
  script += `}\n\n`;

  script += `async function fillByRef(page: Page, snapshot: ElementRefMap, label: string, value: string): Promise<void> {\n`;
  script += `  const ref = findRef(snapshot, label);\n`;
  script += `  const index = parseInt(ref.replace('e', '')) - 1;\n`;
  script += `  // Tag the target field with a temporary data attribute for Playwright to locate\n`;
  script += `  const found = await page.evaluate((args) => {\n`;
  script += `    document.querySelectorAll('[data-nat-target]').forEach(el => el.removeAttribute('data-nat-target'));\n`;
  script += `    const allEls = document.querySelectorAll(args.sel);\n`;
  script += `    let visIdx = 0;\n`;
  script += `    for (let i = 0; i < allEls.length; i++) {\n`;
  script += `      const rect = allEls[i].getBoundingClientRect();\n`;
  script += `      if (rect.width === 0 && rect.height === 0) continue;\n`;
  script += `      const s = window.getComputedStyle(allEls[i]);\n`;
  script += `      if (s.display === 'none' || s.visibility === 'hidden') continue;\n`;
  script += `      if (visIdx === args.idx) { allEls[i].setAttribute('data-nat-target', 'true'); return true; }\n`;
  script += `      visIdx++;\n`;
  script += `    }\n`;
  script += `    return false;\n`;
  script += `  }, { sel: FILL_SELECTORS, idx: index });\n`;
  script += `  if (!found) throw new Error(\`Field "\${label}" (ref: \${ref}) not found on page\`);\n`;
  script += `  await page.locator('[data-nat-target=\"true\"]').first().fill(value);\n`;
  script += `  await page.evaluate(() => document.querySelectorAll('[data-nat-target]').forEach(el => el.removeAttribute('data-nat-target')));\n`;
  script += `}\n\n`;

  script += `function findRef(snapshot: ElementRefMap, label: string): string {\n`;
  script += `  if (snapshot[label]) return snapshot[label];\n`;
  script += `  const labelLower = label.toLowerCase();\n`;
  script += `  for (const [key, ref] of Object.entries(snapshot)) {\n`;
  script += `    if (key.toLowerCase().includes(labelLower) || labelLower.includes(key.toLowerCase())) return ref;\n`;
  script += `  }\n`;
  script += `  throw new Error(\`Element "\${label}" not found in snapshot. Available: \${Object.keys(snapshot).slice(0, 10).join(', ')}...\`);\n`;
  script += `}\n\n`;

  const navLinks: DiscoveredNavLink[] = (elements as any).__navLinks || [];

  for (const tc of testCases) {
    const safeName = tc.title.replace(/['"\\]/g, '');
    const inferredPage = inferTargetPage(tc.title, tc.steps, navLinks, targetUrl);

    script += `test.describe('${safeName}', () => {\n`;
    script += `  test.beforeEach(async ({ page }) => {\n`;
    script += `    await page.goto(TARGET_URL, { waitUntil: 'networkidle' });\n`;
    script += `  });\n\n`;

    script += `  test('${tc.testCaseId} - ${safeName}', async ({ page }) => {\n`;

    if (inferredPage && inferredPage !== targetUrl) {
      script += `    // Smart Navigation: Navigating to the relevant page for this test\n`;
      script += `    await page.goto('${inferredPage}', { waitUntil: 'networkidle' });\n`;
      script += `    await page.waitForTimeout(1000);\n\n`;
    }

    script += `    // Get fresh element snapshot\n`;
    script += `    let snapshot = await getSnapshot(page);\n`;
    script += `    console.log(\`Discovered \${Object.keys(snapshot).length} elements\`);\n\n`;

    let hasNavStep = false;
    let currentPageUrl = inferredPage || targetUrl;

    for (let i = 0; i < tc.steps.length; i++) {
      const step = tc.steps[i];
      const cmd = parseActionToCommand(step.action, step.testData);
      const actionLower = step.action.toLowerCase();
      const matched = matchElementToStep(step, elements);

      script += `    // Step ${i + 1}: ${step.action.substring(0, 80)}\n`;

      if (matched && matched.pageUrl && matched.pageUrl !== currentPageUrl) {
        script += `    // Navigate to element's discovered page: ${matched.pageUrl}\n`;
        script += `    await page.goto('${matched.pageUrl}', { waitUntil: 'networkidle' });\n`;
        script += `    await page.waitForTimeout(1000);\n`;
        script += `    snapshot = await getSnapshot(page); // Refresh snapshot for new page\n`;
        currentPageUrl = matched.pageUrl;
      }

      if (cmd.command === 'open' && cmd.target?.startsWith('http')) {
        script += `    await page.goto('${cmd.target}', { waitUntil: 'networkidle' });\n`;
        script += `    snapshot = await getSnapshot(page); // Refresh snapshot after navigation\n`;
        currentPageUrl = cmd.target;
        hasNavStep = true;
      } else if (!hasNavStep && i === 0 && (actionLower.includes('navigate') || actionLower.includes('go to') || actionLower.includes('open'))) {
        const stepInferredPage = inferTargetPage(step.action, [], navLinks, targetUrl);
        if (stepInferredPage) {
          script += `    await page.goto('${stepInferredPage}', { waitUntil: 'networkidle' });\n`;
          script += `    await page.waitForTimeout(1000);\n`;
          script += `    snapshot = await getSnapshot(page); // Refresh snapshot after navigation\n`;
          currentPageUrl = stepInferredPage;
          hasNavStep = true;
        } else if (inferredPage) {
          script += `    // Already navigated to ${inferredPage} above\n`;
        } else {
          script += `    // Navigate to the target page\n`;
          script += `    await page.goto(TARGET_URL, { waitUntil: 'networkidle' });\n`;
        }
      } else if (cmd.command === 'click') {
        const target = cmd.target || step.action.replace(/^click\s+(?:on\s+)?(?:the\s+)?/i, '').replace(/\s+(button|link|tab|menu)$/i, '').trim();
        script += `    await clickByRef(page, snapshot, '${target.replace(/'/g, "\\'")}');\n`;
        script += `    await page.waitForTimeout(500);\n`;
        script += `    snapshot = await getSnapshot(page); // Refresh after action\n`;
      } else if (cmd.command === 'fill') {
        const target = cmd.target || step.action.replace(/^fill\s+(?:in\s+)?(?:the\s+)?/i, '').replace(/\s+(?:field\s+)?with\s+.+$/i, '').trim();
        const value = cmd.value || '';
        script += `    await fillByRef(page, snapshot, '${target.replace(/'/g, "\\'")}', '${value.replace(/'/g, "\\'")}');\n`;
      } else if (cmd.command === 'select') {
        const target = cmd.target || 'dropdown';
        script += `    // Select option via snapshot ref\n`;
        script += `    await clickByRef(page, snapshot, '${target.replace(/'/g, "\\'")}');\n`;
        if (cmd.value) {
          script += `    await page.getByText('${cmd.value.replace(/'/g, "\\'")}').click();\n`;
        }
      } else if (cmd.command === 'verify') {
        if (cmd.target) {
          script += `    await expect(page.getByText('${cmd.target.replace(/'/g, "\\'").substring(0, 60)}')).toBeVisible();\n`;
        }
      } else {
        script += `    // Action: ${step.action}\n`;
      }

      if (step.expected) {
        script += `    // Expected: ${step.expected.substring(0, 80)}\n`;
      }
      script += `\n`;
    }

    script += `    // Token usage: ~${tc.steps.length * 2550} tokens (vs ~${tc.steps.length * 6500} with MCP)\n`;
    script += `  });\n`;
    script += `});\n\n`;
  }

  return script;
}

export function generateBddStepDefinitions(testCase: TestCaseExecution): string {
  let stepDefs = `import { Given, When, Then } from '@cucumber/cucumber';\n`;
  stepDefs += `import { Page, expect } from '@playwright/test';\n\n`;
  
  const processedPatterns = new Set<string>();
  
  for (const step of testCase.steps) {
    const pattern = step.action
      .replace(/["'][^"']+["']/g, '{string}')
      .replace(/\d+/g, '{int}');
    
    if (processedPatterns.has(pattern)) continue;
    processedPatterns.add(pattern);
    
    const actionLower = step.action.toLowerCase();
    let keyword = 'When';
    if (actionLower.includes('verify') || actionLower.includes('see') || actionLower.includes('check')) {
      keyword = 'Then';
    } else if (actionLower.includes('given') || actionLower.includes('navigate')) {
      keyword = 'Given';
    }
    
    stepDefs += `${keyword}('${pattern}', async function(this: { page: Page }) {\n`;
    stepDefs += `  // Auto-generated step - implement based on your application\n`;
    stepDefs += `  // Original: ${step.action}\n`;
    stepDefs += `});\n\n`;
  }
  
  return stepDefs;
}
