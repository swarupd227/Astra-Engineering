import { playwrightService } from './playwright-service';
import type { GeneratedTestCase } from './test-case-generator';
import { Page } from 'playwright';

export interface ExecutionResult {
  testId: string;
  status: 'pending' | 'running' | 'passed' | 'failed' | 'skipped';
  executionTime: number;
  screenshotUrl?: string;
  errorMessage?: string;
  consoleLogs: string[];
  networkErrors: string[];
  timestamp: string;
}

export interface ExecutionProgress {
  total: number;
  completed: number;
  passed: number;
  failed: number;
  currentTest?: GeneratedTestCase;
}

export class TestExecutionEngine {
  private consoleLogs: string[] = [];
  private networkErrors: string[] = [];
  private executionResults: Map<string, ExecutionResult> = new Map();

  async executeTestCases(
    testCases: GeneratedTestCase[],
    baseUrl: string,
    onProgress?: (progress: ExecutionProgress, result?: ExecutionResult) => void
  ): Promise<ExecutionResult[]> {
    const results: ExecutionResult[] = [];
    this.reset();

    const progress: ExecutionProgress = {
      total: testCases.length,
      completed: 0,
      passed: 0,
      failed: 0,
    };

    const contextId = `test-execution-${Date.now()}`;
    let page: Page | undefined;

    try {
      const context = await playwrightService.createContext(contextId);
      page = await context.newPage();

      this.setupPageListeners(page);

      for (const testCase of testCases) {
        progress.currentTest = testCase;

        const pendingResult: ExecutionResult = {
          testId: testCase.testId,
          status: 'pending',
          executionTime: 0,
          consoleLogs: [],
          networkErrors: [],
          timestamp: new Date().toISOString(),
        };
        this.executionResults.set(testCase.testId, pendingResult);
        onProgress?.(progress, pendingResult);

        await this.delay(200);

        const runningResult: ExecutionResult = {
          ...pendingResult,
          status: 'running',
        };
        this.executionResults.set(testCase.testId, runningResult);
        onProgress?.(progress, runningResult);

        const result = await this.executeTestCase(testCase, baseUrl, page);
        results.push(result);
        this.executionResults.set(testCase.testId, result);

        progress.completed++;
        if (result.status === 'passed') {
          progress.passed++;
        } else if (result.status === 'failed') {
          progress.failed++;
        }

        onProgress?.(progress, result);

        await this.delay(300);
      }
    } catch (error) {
      console.error('Test execution error:', error);
    } finally {
      await playwrightService.closeContext(contextId);
    }

    return results;
  }

  private async executeTestCase(
    testCase: GeneratedTestCase,
    baseUrl: string,
    page: Page
  ): Promise<ExecutionResult> {
    const startTime = Date.now();
    this.consoleLogs = [];
    this.networkErrors = [];

    const result: ExecutionResult = {
      testId: testCase.testId,
      status: 'running',
      executionTime: 0,
      consoleLogs: [],
      networkErrors: [],
      timestamp: new Date().toISOString(),
    };

    try {
      const success = await this.performTestExecution(testCase, baseUrl, page);
      
      result.status = success ? 'passed' : 'failed';
      result.executionTime = Date.now() - startTime;
      result.consoleLogs = [...this.consoleLogs];
      result.networkErrors = [...this.networkErrors];

      try {
        const screenshot = await page.screenshot({ fullPage: false });
        result.screenshotUrl = `data:image/png;base64,${screenshot.toString('base64')}`;
      } catch (screenshotError) {
        console.error('Screenshot capture failed:', screenshotError);
      }

    } catch (error) {
      result.status = 'failed';
      result.executionTime = Date.now() - startTime;
      result.errorMessage = error instanceof Error ? error.message : String(error);
      result.consoleLogs = [...this.consoleLogs];
      result.networkErrors = [...this.networkErrors];

      try {
        const screenshot = await page.screenshot({ fullPage: false });
        result.screenshotUrl = `data:image/png;base64,${screenshot.toString('base64')}`;
      } catch (screenshotError) {
        console.error('Screenshot capture failed:', screenshotError);
      }
    }

    return result;
  }

  private async performTestExecution(
    testCase: GeneratedTestCase,
    baseUrl: string,
    page: Page
  ): Promise<boolean> {
    try {
      const url = this.normalizeUrl(baseUrl, testCase.workflow.name);
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      
      await this.delay(1000);

      if (testCase.type === 'form_submission' || testCase.type === 'form_validation') {
        return await this.executeFormTest(testCase, page);
      } else if (testCase.type === 'form_interaction') {
        return await this.executeInteractionTest(testCase, page);
      } else if (testCase.type === 'navigation' || testCase.type === 'navigation_accessibility') {
        return await this.executeNavigationTest(testCase, page);
      } else if (testCase.type.includes('cta')) {
        return await this.executeCTATest(testCase, page);
      }

      return await this.executeGenericTest(testCase, page);
      
    } catch (error) {
      console.error(`Test execution failed for ${testCase.testId}:`, error);
      return false;
    }
  }

  private async executeFormTest(testCase: GeneratedTestCase, page: Page): Promise<boolean> {
    try {
      if (testCase.type === 'form_validation') {
        if (testCase.selector) {
          const submitButton = await page.$(testCase.selector);
          if (submitButton) {
            await submitButton.click();
            await this.delay(1000);
            
            const hasValidation = await page.evaluate(() => {
              const inputs = Array.from(document.querySelectorAll('input[required], textarea[required], select[required]'));
              for (const input of inputs) {
                if ((input as HTMLInputElement).validationMessage) {
                  return true;
                }
              }
              const errorMessages = document.querySelectorAll('[class*="error"], [class*="invalid"], [role="alert"]');
              return errorMessages.length > 0;
            });
            
            return hasValidation;
          }
        }
        return false;
      }

      const inputs = await page.$$('input, textarea, select');
      for (const input of inputs) {
        const tagName = await input.evaluate((el) => el.tagName.toLowerCase());
        const type = await input.evaluate((el) => (el as HTMLInputElement).type);
        
        if (tagName === 'input') {
          if (type === 'email') {
            await input.fill('test@example.com');
          } else if (type === 'password') {
            await input.fill('TestPassword123!');
          } else if (type === 'tel') {
            await input.fill('555-123-4567');
          } else if (type === 'text' || type === 'search') {
            await input.fill('Test Input');
          } else if (type === 'number') {
            await input.fill('42');
          } else if (type === 'checkbox' || type === 'radio') {
            await input.check();
          }
        } else if (tagName === 'textarea') {
          await input.fill('This is a test message.');
        } else if (tagName === 'select') {
          const options = await input.$$('option');
          if (options.length > 1) {
            await input.selectOption({ index: 1 });
          }
        }
        
        await this.delay(200);
      }

      if (testCase.selector) {
        const submitButton = await page.$(testCase.selector);
        if (submitButton) {
          await submitButton.click();
          await this.delay(2000);
        }
      }

      return true;
    } catch (error) {
      console.error('Form test execution failed:', error);
      return false;
    }
  }

  private async executeInteractionTest(testCase: GeneratedTestCase, page: Page): Promise<boolean> {
    try {
      if (testCase.selector) {
        const element = await page.$(testCase.selector);
        if (element) {
          await element.focus();
          await this.delay(500);
          return true;
        }
      }

      const inputs = await page.$$('input, textarea');
      for (const input of inputs) {
        await input.focus();
        await this.delay(200);
      }
      
      return inputs.length > 0;
    } catch (error) {
      console.error('Interaction test execution failed:', error);
      return false;
    }
  }

  private async executeNavigationTest(testCase: GeneratedTestCase, page: Page): Promise<boolean> {
    try {
      if (testCase.selector) {
        const link = await page.$(testCase.selector);
        if (link) {
          const isVisible = await link.isVisible();
          const isEnabled = await link.isEnabled();
          return isVisible && isEnabled;
        }
      }

      const links = await page.$$('a[href]');
      let visibleLinks = 0;
      
      for (const link of links.slice(0, 10)) {
        const isVisible = await link.isVisible();
        if (isVisible) {
          visibleLinks++;
        }
      }
      
      return visibleLinks > 0;
    } catch (error) {
      console.error('Navigation test execution failed:', error);
      return false;
    }
  }

  private async executeCTATest(testCase: GeneratedTestCase, page: Page): Promise<boolean> {
    try {
      if (testCase.selector) {
        const button = await page.$(testCase.selector);
        if (button) {
          const isVisible = await button.isVisible();
          
          if (testCase.type === 'cta_visibility') {
            return isVisible;
          }

          if (isVisible) {
            await button.click();
            await this.delay(1000);
            return true;
          }
        }
      }

      const buttons = await page.$$('button, a.button, [role="button"]');
      for (const button of buttons) {
        const isVisible = await button.isVisible();
        if (isVisible) {
          return true;
        }
      }
      
      return false;
    } catch (error) {
      console.error('CTA test execution failed:', error);
      return false;
    }
  }

  private async executeGenericTest(testCase: GeneratedTestCase, page: Page): Promise<boolean> {
    try {
      if (testCase.selector) {
        const element = await page.$(testCase.selector);
        if (element) {
          const isVisible = await element.isVisible();
          return isVisible;
        }
      }

      await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
      return true;
    } catch (error) {
      console.error('Generic test execution failed:', error);
      return false;
    }
  }

  private setupPageListeners(page: Page): void {
    page.on('console', (msg) => {
      const type = msg.type();
      const text = msg.text();
      
      if (type === 'error' || type === 'warning') {
        this.consoleLogs.push(`[${type.toUpperCase()}] ${text}`);
      }
    });

    page.on('pageerror', (error) => {
      this.consoleLogs.push(`[PAGE ERROR] ${error.message}`);
    });

    page.on('requestfailed', (request) => {
      const failure = request.failure();
      if (failure) {
        this.networkErrors.push(
          `[${request.method()}] ${request.url()} - ${failure.errorText}`
        );
      }
    });
  }

  private normalizeUrl(baseUrl: string, workflowName: string): string {
    if (workflowName.toLowerCase().includes('contact')) {
      return `${baseUrl}/contact`;
    }
    if (workflowName.toLowerCase().includes('login') || workflowName.toLowerCase().includes('sign in')) {
      return `${baseUrl}/login`;
    }
    if (workflowName.toLowerCase().includes('register') || workflowName.toLowerCase().includes('sign up')) {
      return `${baseUrl}/register`;
    }
    
    return baseUrl;
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  getResult(testId: string): ExecutionResult | undefined {
    return this.executionResults.get(testId);
  }

  getAllResults(): ExecutionResult[] {
    return Array.from(this.executionResults.values());
  }

  reset(): void {
    this.consoleLogs = [];
    this.networkErrors = [];
    this.executionResults.clear();
  }
}

export const testExecutionEngine = new TestExecutionEngine();
