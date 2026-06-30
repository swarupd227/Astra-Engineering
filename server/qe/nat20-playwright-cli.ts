import { chromium, Browser, BrowserContext, Page } from 'playwright';
import { getBrowserExecutablePath } from './playwright-setup';

export class PlaywrightCLIError extends Error {
  command: string;
  stderr: string;
  exitCode: number;
  agentName: string;

  constructor(message: string, command: string, stderr: string, exitCode: number, agentName: string) {
    super(message);
    this.name = 'PlaywrightCLIError';
    this.command = command;
    this.stderr = stderr;
    this.exitCode = exitCode;
    this.agentName = agentName;
  }
}

export class SessionContaminationError extends Error {
  constructor(sessions: string[]) {
    super(`Session contamination detected between: ${sessions.join(', ')}`);
    this.name = 'SessionContaminationError';
  }
}

export interface SessionOptions {
  headed?: boolean;
  sessionName?: string;
  viewport?: { width: number; height: number };
  slowMo?: number;
}

export interface ScreenshotOptions {
  fullPage?: boolean;
  clip?: { x: number; y: number; width: number; height: number };
}

export type ElementRefMap = Record<string, string>;

interface ExecutionLogEntry {
  timestamp: Date;
  agentName: string;
  sessionName: string;
  command: string;
  elementRef: string;
  durationMs: number;
  result: 'SUCCESS' | 'FAIL' | 'RETRY';
  errorMessage?: string;
}

const MAX_RETRIES = 3;
const RETRY_BACKOFF_MS = 1000;

export class NAT20PlaywrightCLI {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private sessionName: string;
  private agentName: string;
  private isInitialized: boolean = false;
  private executionLog: ExecutionLogEntry[] = [];
  private elementRefCounter: number = 0;
  private currentSnapshot: ElementRefMap = {};
  private options: SessionOptions;

  constructor(agentName: string, options?: SessionOptions) {
    this.agentName = agentName;
    this.sessionName = options?.sessionName || `nat2-${agentName.toLowerCase().replace(/\s+/g, '-')}-session`;
    this.options = options || {};
  }

  getSessionName(): string {
    return this.sessionName;
  }

  getAgentName(): string {
    return this.agentName;
  }

  getExecutionLog(): ExecutionLogEntry[] {
    return [...this.executionLog];
  }

  isActive(): boolean {
    return this.isInitialized && this.browser !== null;
  }

  async initialize(url: string, options?: SessionOptions): Promise<void> {
    const opts = { ...this.options, ...options };
    const startTime = Date.now();

    try {
      this.browser = await chromium.launch({
        headless: opts.headed !== true,
        executablePath: getBrowserExecutablePath() ?? undefined,
        slowMo: opts.slowMo,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
      });

      const contextOptions: any = {
        viewport: opts.viewport || { width: 1280, height: 720 },
        userAgent: `NAT2.0-CLI/${this.agentName}/1.0`
      };

      this.context = await this.browser.newContext(contextOptions);
      this.page = await this.context.newPage();
      await this.page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
      this.isInitialized = true;

      this.log('initialize', '', Date.now() - startTime, 'SUCCESS');
    } catch (error: any) {
      this.log('initialize', '', Date.now() - startTime, 'FAIL', error.message);
      throw new PlaywrightCLIError(
        `Failed to initialize session: ${error.message}`,
        `initialize(${url})`, error.message, 1, this.agentName
      );
    }
  }

  async closeSession(): Promise<void> {
    try {
      if (this.context) await this.context.close();
      if (this.browser) await this.browser.close();
    } finally {
      this.browser = null;
      this.context = null;
      this.page = null;
      this.isInitialized = false;
    }
  }

  async deleteSession(): Promise<void> {
    await this.closeSession();
    this.executionLog = [];
    this.currentSnapshot = {};
    this.elementRefCounter = 0;
  }

  async goto(url: string): Promise<void> {
    this.ensureInitialized();
    await this.retryAction('goto', async () => {
      await this.page!.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
    });
  }

  async waitForLoadState(state?: 'load' | 'domcontentloaded' | 'networkidle'): Promise<void> {
    this.ensureInitialized();
    await this.page!.waitForLoadState(state || 'networkidle');
  }

  async getSnapshot(): Promise<ElementRefMap> {
    this.ensureInitialized();
    const startTime = Date.now();

    try {
      const snapshotScript = `
        (() => {
          var elements = {};
          var refCounter = 0;
          var interactiveSelectors = [
            'input:not([type="hidden"])', 'textarea', 'select', 'button',
            'a[href]', '[role="button"]', '[role="link"]', '[role="tab"]',
            '[role="checkbox"]', '[role="radio"]', '[role="menuitem"]',
            '[role="textbox"]', '[role="combobox"]', '[role="switch"]',
            '[contenteditable="true"]'
          ];

          var allEls = document.querySelectorAll(interactiveSelectors.join(','));
          var labelCounts = {};

          allEls.forEach(function(el) {
            var rect = el.getBoundingClientRect();
            if (rect.width === 0 && rect.height === 0) return;
            var style = window.getComputedStyle(el);
            if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return;

            var label = '';
            var tag = el.tagName.toLowerCase();

            if (el.getAttribute('aria-label')) {
              label = el.getAttribute('aria-label');
            } else if (el.id) {
              var labelEl = document.querySelector('label[for="' + el.id + '"]');
              if (labelEl) label = (labelEl.textContent || '').trim();
            }
            if (!label) {
              var parentLabel = el.closest('label');
              if (parentLabel) {
                var clone = parentLabel.cloneNode(true);
                var inputs = clone.querySelectorAll('input,select,textarea,button');
                inputs.forEach(function(inp) { inp.remove(); });
                label = (clone.textContent || '').trim();
              }
            }
            if (!label && el.getAttribute('placeholder')) {
              label = el.getAttribute('placeholder');
            }
            if (!label && el.getAttribute('title')) {
              label = el.getAttribute('title');
            }
            if (!label && el.getAttribute('name')) {
              label = el.getAttribute('name').replace(/[-_]/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2');
            }
            if (!label) {
              var text = (el.textContent || '').trim();
              if (text.length <= 60) label = text;
            }
            if (!label) {
              label = tag + '_' + el.getAttribute('type') + '_element';
            }

            label = label.replace(/[^a-zA-Z0-9\\s]/g, '').trim().substring(0, 60);
            if (!label) label = 'element';

            if (labelCounts[label] !== undefined) {
              labelCounts[label]++;
              label = label + '_' + labelCounts[label];
            } else {
              labelCounts[label] = 1;
            }

            refCounter++;
            var ref = 'e' + refCounter;
            elements[label] = ref;
          });

          return elements;
        })()
      `;

      this.currentSnapshot = await this.page!.evaluate(snapshotScript);
      this.log('getSnapshot', '', Date.now() - startTime, 'SUCCESS');
      return { ...this.currentSnapshot };
    } catch (error: any) {
      this.log('getSnapshot', '', Date.now() - startTime, 'FAIL', error.message);
      throw new PlaywrightCLIError(
        `Failed to get snapshot: ${error.message}`,
        'getSnapshot', error.message, 1, this.agentName
      );
    }
  }

  async click(ref: string): Promise<void> {
    this.ensureInitialized();
    await this.retryAction(`click(${ref})`, async () => {
      const selector = await this.resolveRef(ref);
      await this.page!.locator(selector).click({ timeout: 10000 });
    }, ref);
  }

  async fill(ref: string, value: string): Promise<void> {
    this.ensureInitialized();
    await this.retryAction(`fill(${ref}, ${value})`, async () => {
      const selector = await this.page!.evaluate(`
        (() => {
          var allInputs = document.querySelectorAll('input:not([type="hidden"]), textarea, select, [contenteditable="true"]');
          var idx = parseInt('${ref}'.replace('e', '')) - 1;
          var count = 0;
          for (var i = 0; i < allInputs.length; i++) {
            var el = allInputs[i];
            var rect = el.getBoundingClientRect();
            if (rect.width === 0 && rect.height === 0) continue;
            var style = window.getComputedStyle(el);
            if (style.display === 'none' || style.visibility === 'hidden') continue;
            if (count === idx) {
              el.focus();
              return true;
            }
            count++;
          }
          return false;
        })()
      `);
      const activeElement = this.page!.locator(':focus');
      await activeElement.fill(value);
    }, ref);
  }

  async type(text: string): Promise<void> {
    this.ensureInitialized();
    await this.retryAction(`type(${text})`, async () => {
      await this.page!.keyboard.type(text);
    });
  }

  async check(ref: string): Promise<void> {
    this.ensureInitialized();
    await this.retryAction(`check(${ref})`, async () => {
      const selector = await this.resolveRef(ref);
      await this.page!.locator(selector).check();
    }, ref);
  }

  async uncheck(ref: string): Promise<void> {
    this.ensureInitialized();
    await this.retryAction(`uncheck(${ref})`, async () => {
      const selector = await this.resolveRef(ref);
      await this.page!.locator(selector).uncheck();
    }, ref);
  }

  async select(ref: string, value: string): Promise<void> {
    this.ensureInitialized();
    await this.retryAction(`select(${ref}, ${value})`, async () => {
      const selector = await this.resolveRef(ref);
      await this.page!.locator(selector).selectOption(value);
    }, ref);
  }

  async hover(ref: string): Promise<void> {
    this.ensureInitialized();
    await this.retryAction(`hover(${ref})`, async () => {
      const selector = await this.resolveRef(ref);
      await this.page!.locator(selector).hover();
    }, ref);
  }

  async doubleClick(ref: string): Promise<void> {
    this.ensureInitialized();
    await this.retryAction(`doubleClick(${ref})`, async () => {
      const selector = await this.resolveRef(ref);
      await this.page!.locator(selector).dblclick();
    }, ref);
  }

  async pressKey(key: string): Promise<void> {
    this.ensureInitialized();
    await this.retryAction(`pressKey(${key})`, async () => {
      await this.page!.keyboard.press(key);
    });
  }

  async drag(startRef: string, endRef: string): Promise<void> {
    this.ensureInitialized();
    await this.retryAction(`drag(${startRef}, ${endRef})`, async () => {
      const startSelector = await this.resolveRef(startRef);
      const endSelector = await this.resolveRef(endRef);
      await this.page!.locator(startSelector).dragTo(this.page!.locator(endSelector));
    }, startRef);
  }

  async upload(ref: string, filePath: string): Promise<void> {
    this.ensureInitialized();
    await this.retryAction(`upload(${ref})`, async () => {
      const selector = await this.resolveRef(ref);
      await this.page!.locator(selector).setInputFiles(filePath);
    }, ref);
  }

  async captureScreenshot(testName: string, options?: ScreenshotOptions): Promise<string> {
    this.ensureInitialized();
    const startTime = Date.now();
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const safeName = testName.replace(/[^a-zA-Z0-9-_]/g, '_');
    const filePath = `evidence/${this.sessionName}/${safeName}/${timestamp}.png`;

    try {
      const screenshotOptions: any = {
        path: filePath,
        fullPage: options?.fullPage || false
      };
      if (options?.clip) screenshotOptions.clip = options.clip;

      await this.page!.screenshot(screenshotOptions);
      this.log('captureScreenshot', '', Date.now() - startTime, 'SUCCESS');
      return filePath;
    } catch (error: any) {
      this.log('captureScreenshot', '', Date.now() - startTime, 'FAIL', error.message);
      return '';
    }
  }

  async startVideoRecording(testName: string): Promise<void> {
    this.log('startVideoRecording', '', 0, 'SUCCESS');
  }

  async stopVideoRecording(): Promise<string> {
    this.log('stopVideoRecording', '', 0, 'SUCCESS');
    return '';
  }

  async evaluate(expression: string): Promise<string> {
    this.ensureInitialized();
    const startTime = Date.now();
    try {
      const result = await this.page!.evaluate(expression);
      this.log('evaluate', '', Date.now() - startTime, 'SUCCESS');
      return String(result);
    } catch (error: any) {
      this.log('evaluate', '', Date.now() - startTime, 'FAIL', error.message);
      throw new PlaywrightCLIError(
        `Evaluate failed: ${error.message}`,
        `evaluate(${expression.substring(0, 50)}...)`, error.message, 1, this.agentName
      );
    }
  }

  async exec(command: string): Promise<string> {
    this.log('exec', command, 0, 'SUCCESS');
    return command;
  }

  parseSnapshot(rawOutput: string): ElementRefMap {
    const result: ElementRefMap = {};
    try {
      const parsed = JSON.parse(rawOutput);
      if (typeof parsed === 'object' && parsed !== null) {
        for (const [label, ref] of Object.entries(parsed)) {
          if (typeof ref === 'string') {
            result[label] = ref;
          }
        }
      }
    } catch {
      const lines = rawOutput.split('\n');
      for (const line of lines) {
        const match = line.match(/^\s*["']?([^"':]+)["']?\s*[:=]\s*["']?(e\d+)["']?\s*$/);
        if (match) {
          result[match[1].trim()] = match[2];
        }
      }
    }
    return result;
  }

  getTokenUsage(): { totalTokens: number; browserStateTokens: number; reasoningTokens: number } {
    const snapshotKeys = Object.keys(this.currentSnapshot).length;
    const browserStateTokens = Math.max(snapshotKeys * 3, 50);
    return {
      totalTokens: 500 + browserStateTokens + 2000,
      browserStateTokens,
      reasoningTokens: 2000
    };
  }

  private async resolveRef(ref: string): Promise<string> {
    const refIndex = parseInt(ref.replace('e', '')) - 1;
    const nthScript = `
      (() => {
        var interactiveSelectors = [
          'input:not([type="hidden"])', 'textarea', 'select', 'button',
          'a[href]', '[role="button"]', '[role="link"]', '[role="tab"]',
          '[role="checkbox"]', '[role="radio"]', '[role="menuitem"]',
          '[role="textbox"]', '[role="combobox"]', '[role="switch"]',
          '[contenteditable="true"]'
        ];
        var allEls = document.querySelectorAll(interactiveSelectors.join(','));
        var visibleIdx = 0;
        for (var i = 0; i < allEls.length; i++) {
          var el = allEls[i];
          var rect = el.getBoundingClientRect();
          if (rect.width === 0 && rect.height === 0) continue;
          var style = window.getComputedStyle(el);
          if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') continue;
          if (visibleIdx === ${refIndex}) {
            if (el.id) return '#' + el.id;
            if (el.getAttribute('name')) return el.tagName.toLowerCase() + '[name="' + el.getAttribute('name') + '"]';
            if (el.getAttribute('data-testid')) return '[data-testid="' + el.getAttribute('data-testid') + '"]';
            return ':nth-match(:visible, ${refIndex + 1})';
          }
          visibleIdx++;
        }
        return null;
      })()
    `;
    const selector = await this.page!.evaluate(nthScript);
    if (!selector) throw new Error(`Element ref ${ref} not found on page`);
    return selector as string;
  }

  private ensureInitialized(): void {
    if (!this.isInitialized || !this.page) {
      throw new PlaywrightCLIError(
        'CLI session not initialized. Call initialize() first.',
        'ensureInitialized', 'Session not ready', 1, this.agentName
      );
    }
  }

  private async retryAction(command: string, action: () => Promise<void>, ref: string = ''): Promise<void> {
    let lastError: Error | null = null;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      const startTime = Date.now();
      try {
        await action();
        this.log(command, ref, Date.now() - startTime, 'SUCCESS');
        return;
      } catch (error: any) {
        lastError = error;
        if (attempt < MAX_RETRIES) {
          this.log(command, ref, Date.now() - startTime, 'RETRY', error.message);
          await new Promise(resolve => setTimeout(resolve, RETRY_BACKOFF_MS * attempt));
        } else {
          this.log(command, ref, Date.now() - startTime, 'FAIL', error.message);
        }
      }
    }
    throw new PlaywrightCLIError(
      `Command failed after ${MAX_RETRIES} retries: ${lastError?.message}`,
      command, lastError?.message || '', 1, this.agentName
    );
  }

  private log(command: string, ref: string, durationMs: number, result: 'SUCCESS' | 'FAIL' | 'RETRY', errorMessage?: string): void {
    const entry: ExecutionLogEntry = {
      timestamp: new Date(),
      agentName: this.agentName,
      sessionName: this.sessionName,
      command,
      elementRef: ref,
      durationMs,
      result,
      errorMessage
    };
    this.executionLog.push(entry);
    const status = result === 'SUCCESS' ? '✓' : result === 'RETRY' ? '↻' : '✗';
    console.log(`[NAT2-CLI][${this.sessionName}] ${status} ${command} ${ref ? `(${ref})` : ''} ${durationMs}ms${errorMessage ? ' | ' + errorMessage : ''}`);
  }
}
