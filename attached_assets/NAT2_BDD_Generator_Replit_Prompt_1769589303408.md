# NAT 2.0 - BDD Test Asset Generator Module
## Playwright + TypeScript with Generic Methods Architecture
### Replit Development Prompt

---

## PROJECT CONTEXT

I am building NAT 2.0 (Nous Autonomous Tester 2.0), an AI-powered autonomous testing platform. After generating test cases from user stories, users need to generate **BDD Test Assets** including:

1. **Feature Files** (.feature) - Gherkin syntax
2. **Step Definition Files** (.ts) - Playwright + TypeScript
3. **Page Object Classes** (.ts) - Reusable page interactions
4. **Generic Utility Methods** (.ts) - Common reusable functions

The architecture must follow **Test Architect best practices** with maximum code reusability.

---

## INPUT FORMAT (Test Cases from NAT 2.0)

```typescript
interface TestCase {
  id: string;                    // TC-001, TC-002, etc.
  title: string;                 // Test case title
  category: string;              // functional | accessibility | security | negative | edge_case
  priority: string;              // P0 | P1 | P2 | P3 | P4
  preconditions: string;         // Pre-requisites
  steps: Array<{
    stepNumber: number;
    action: string;              // What to do
    expected: string;            // Expected result
  }>;
  tags?: string[];               // @smoke, @regression, etc.
}

interface TestCaseInput {
  testCases: TestCase[];
  metadata: {
    projectName: string;
    sprintName: string;
    applicationUrl: string;
    domain: string;              // Insurance | Healthcare | Banking | Fintech
  };
}
```

---

## OUTPUT STRUCTURE

Generate the following BDD test assets:

```
/generated-tests
├── /features
│   ├── navigation.feature
│   ├── authentication.feature
│   ├── payment.feature
│   └── [module-name].feature
├── /step-definitions
│   ├── navigation.steps.ts
│   ├── authentication.steps.ts
│   ├── payment.steps.ts
│   ├── common.steps.ts
│   └── [module-name].steps.ts
├── /pages
│   ├── BasePage.ts
│   ├── HomePage.ts
│   ├── LoginPage.ts
│   ├── PaymentPage.ts
│   └── [PageName]Page.ts
├── /utils
│   ├── GenericActions.ts
│   ├── WaitHelpers.ts
│   ├── AssertionHelpers.ts
│   ├── DataHelpers.ts
│   ├── BrowserHelpers.ts
│   └── ReportHelpers.ts
├── /config
│   ├── playwright.config.ts
│   ├── cucumber.config.ts
│   └── environment.config.ts
├── /test-data
│   ├── testData.json
│   └── environments.json
└── /types
    └── custom.d.ts
```

---

## ARCHITECTURE SPECIFICATIONS

### 1. GENERIC ACTIONS CLASS (Core Utility)

```typescript
// utils/GenericActions.ts
import { Page, Locator, expect, BrowserContext } from '@playwright/test';

export class GenericActions {
  private page: Page;
  private context: BrowserContext;
  private defaultTimeout: number = 30000;

  constructor(page: Page, context?: BrowserContext) {
    this.page = page;
    this.context = context!;
  }

  // ==================== NAVIGATION METHODS ====================
  
  /**
   * Navigate to a URL with optional wait for load state
   */
  async navigateTo(url: string, waitUntil: 'load' | 'domcontentloaded' | 'networkidle' = 'load'): Promise<void> {
    await this.page.goto(url, { waitUntil, timeout: this.defaultTimeout });
  }

  /**
   * Navigate back in browser history
   */
  async navigateBack(): Promise<void> {
    await this.page.goBack({ waitUntil: 'load' });
  }

  /**
   * Navigate forward in browser history
   */
  async navigateForward(): Promise<void> {
    await this.page.goForward({ waitUntil: 'load' });
  }

  /**
   * Refresh the current page
   */
  async refreshPage(): Promise<void> {
    await this.page.reload({ waitUntil: 'load' });
  }

  // ==================== CLICK METHODS ====================

  /**
   * Click on an element with auto-wait
   */
  async click(locator: string | Locator, options?: { force?: boolean; timeout?: number }): Promise<void> {
    const element = typeof locator === 'string' ? this.page.locator(locator) : locator;
    await element.click({ 
      force: options?.force || false, 
      timeout: options?.timeout || this.defaultTimeout 
    });
  }

  /**
   * Double click on an element
   */
  async doubleClick(locator: string | Locator): Promise<void> {
    const element = typeof locator === 'string' ? this.page.locator(locator) : locator;
    await element.dblclick({ timeout: this.defaultTimeout });
  }

  /**
   * Right click on an element
   */
  async rightClick(locator: string | Locator): Promise<void> {
    const element = typeof locator === 'string' ? this.page.locator(locator) : locator;
    await element.click({ button: 'right', timeout: this.defaultTimeout });
  }

  /**
   * Click and hold for specified duration
   */
  async clickAndHold(locator: string | Locator, duration: number = 1000): Promise<void> {
    const element = typeof locator === 'string' ? this.page.locator(locator) : locator;
    await element.hover();
    await this.page.mouse.down();
    await this.page.waitForTimeout(duration);
    await this.page.mouse.up();
  }

  // ==================== INPUT METHODS ====================

  /**
   * Fill text into an input field (clears existing text)
   */
  async fill(locator: string | Locator, text: string): Promise<void> {
    const element = typeof locator === 'string' ? this.page.locator(locator) : locator;
    await element.fill(text, { timeout: this.defaultTimeout });
  }

  /**
   * Type text character by character (simulates real typing)
   */
  async type(locator: string | Locator, text: string, delay: number = 50): Promise<void> {
    const element = typeof locator === 'string' ? this.page.locator(locator) : locator;
    await element.pressSequentially(text, { delay });
  }

  /**
   * Clear text from an input field
   */
  async clearText(locator: string | Locator): Promise<void> {
    const element = typeof locator === 'string' ? this.page.locator(locator) : locator;
    await element.clear();
  }

  /**
   * Fill text and press Enter
   */
  async fillAndEnter(locator: string | Locator, text: string): Promise<void> {
    const element = typeof locator === 'string' ? this.page.locator(locator) : locator;
    await element.fill(text);
    await element.press('Enter');
  }

  // ==================== DROPDOWN METHODS ====================

  /**
   * Select dropdown option by visible text
   */
  async selectByText(locator: string | Locator, text: string): Promise<void> {
    const element = typeof locator === 'string' ? this.page.locator(locator) : locator;
    await element.selectOption({ label: text });
  }

  /**
   * Select dropdown option by value
   */
  async selectByValue(locator: string | Locator, value: string): Promise<void> {
    const element = typeof locator === 'string' ? this.page.locator(locator) : locator;
    await element.selectOption({ value });
  }

  /**
   * Select dropdown option by index
   */
  async selectByIndex(locator: string | Locator, index: number): Promise<void> {
    const element = typeof locator === 'string' ? this.page.locator(locator) : locator;
    await element.selectOption({ index });
  }

  /**
   * Get all dropdown options
   */
  async getDropdownOptions(locator: string | Locator): Promise<string[]> {
    const element = typeof locator === 'string' ? this.page.locator(locator) : locator;
    return await element.locator('option').allTextContents();
  }

  // ==================== CHECKBOX & RADIO METHODS ====================

  /**
   * Check a checkbox (only if not already checked)
   */
  async check(locator: string | Locator): Promise<void> {
    const element = typeof locator === 'string' ? this.page.locator(locator) : locator;
    await element.check({ timeout: this.defaultTimeout });
  }

  /**
   * Uncheck a checkbox (only if checked)
   */
  async uncheck(locator: string | Locator): Promise<void> {
    const element = typeof locator === 'string' ? this.page.locator(locator) : locator;
    await element.uncheck({ timeout: this.defaultTimeout });
  }

  /**
   * Set checkbox state
   */
  async setChecked(locator: string | Locator, checked: boolean): Promise<void> {
    const element = typeof locator === 'string' ? this.page.locator(locator) : locator;
    await element.setChecked(checked);
  }

  /**
   * Check if checkbox/radio is checked
   */
  async isChecked(locator: string | Locator): Promise<boolean> {
    const element = typeof locator === 'string' ? this.page.locator(locator) : locator;
    return await element.isChecked();
  }

  // ==================== GET METHODS ====================

  /**
   * Get text content of an element
   */
  async getText(locator: string | Locator): Promise<string> {
    const element = typeof locator === 'string' ? this.page.locator(locator) : locator;
    return (await element.textContent()) || '';
  }

  /**
   * Get inner text of an element
   */
  async getInnerText(locator: string | Locator): Promise<string> {
    const element = typeof locator === 'string' ? this.page.locator(locator) : locator;
    return await element.innerText();
  }

  /**
   * Get attribute value
   */
  async getAttribute(locator: string | Locator, attributeName: string): Promise<string | null> {
    const element = typeof locator === 'string' ? this.page.locator(locator) : locator;
    return await element.getAttribute(attributeName);
  }

  /**
   * Get input value
   */
  async getInputValue(locator: string | Locator): Promise<string> {
    const element = typeof locator === 'string' ? this.page.locator(locator) : locator;
    return await element.inputValue();
  }

  /**
   * Get CSS property value
   */
  async getCssValue(locator: string | Locator, propertyName: string): Promise<string> {
    const element = typeof locator === 'string' ? this.page.locator(locator) : locator;
    return await element.evaluate((el, prop) => 
      window.getComputedStyle(el).getPropertyValue(prop), propertyName);
  }

  /**
   * Get element count
   */
  async getElementCount(locator: string | Locator): Promise<number> {
    const element = typeof locator === 'string' ? this.page.locator(locator) : locator;
    return await element.count();
  }

  /**
   * Get all text contents from multiple elements
   */
  async getAllTexts(locator: string | Locator): Promise<string[]> {
    const element = typeof locator === 'string' ? this.page.locator(locator) : locator;
    return await element.allTextContents();
  }

  // ==================== VISIBILITY METHODS ====================

  /**
   * Check if element is visible
   */
  async isVisible(locator: string | Locator): Promise<boolean> {
    const element = typeof locator === 'string' ? this.page.locator(locator) : locator;
    return await element.isVisible();
  }

  /**
   * Check if element is enabled
   */
  async isEnabled(locator: string | Locator): Promise<boolean> {
    const element = typeof locator === 'string' ? this.page.locator(locator) : locator;
    return await element.isEnabled();
  }

  /**
   * Check if element is disabled
   */
  async isDisabled(locator: string | Locator): Promise<boolean> {
    const element = typeof locator === 'string' ? this.page.locator(locator) : locator;
    return await element.isDisabled();
  }

  /**
   * Check if element is editable
   */
  async isEditable(locator: string | Locator): Promise<boolean> {
    const element = typeof locator === 'string' ? this.page.locator(locator) : locator;
    return await element.isEditable();
  }

  /**
   * Check if element is hidden
   */
  async isHidden(locator: string | Locator): Promise<boolean> {
    const element = typeof locator === 'string' ? this.page.locator(locator) : locator;
    return await element.isHidden();
  }

  // ==================== WAIT METHODS ====================

  /**
   * Wait for element to be visible
   */
  async waitForVisible(locator: string | Locator, timeout?: number): Promise<void> {
    const element = typeof locator === 'string' ? this.page.locator(locator) : locator;
    await element.waitFor({ state: 'visible', timeout: timeout || this.defaultTimeout });
  }

  /**
   * Wait for element to be hidden
   */
  async waitForHidden(locator: string | Locator, timeout?: number): Promise<void> {
    const element = typeof locator === 'string' ? this.page.locator(locator) : locator;
    await element.waitFor({ state: 'hidden', timeout: timeout || this.defaultTimeout });
  }

  /**
   * Wait for element to be attached to DOM
   */
  async waitForAttached(locator: string | Locator, timeout?: number): Promise<void> {
    const element = typeof locator === 'string' ? this.page.locator(locator) : locator;
    await element.waitFor({ state: 'attached', timeout: timeout || this.defaultTimeout });
  }

  /**
   * Wait for element to be detached from DOM
   */
  async waitForDetached(locator: string | Locator, timeout?: number): Promise<void> {
    const element = typeof locator === 'string' ? this.page.locator(locator) : locator;
    await element.waitFor({ state: 'detached', timeout: timeout || this.defaultTimeout });
  }

  /**
   * Wait for page load state
   */
  async waitForPageLoad(state: 'load' | 'domcontentloaded' | 'networkidle' = 'load'): Promise<void> {
    await this.page.waitForLoadState(state);
  }

  /**
   * Wait for URL to contain specific text
   */
  async waitForUrlContains(urlPart: string, timeout?: number): Promise<void> {
    await this.page.waitForURL(`**/*${urlPart}*`, { timeout: timeout || this.defaultTimeout });
  }

  /**
   * Wait for specific time (use sparingly)
   */
  async wait(milliseconds: number): Promise<void> {
    await this.page.waitForTimeout(milliseconds);
  }

  // ==================== HOVER & SCROLL METHODS ====================

  /**
   * Hover over an element
   */
  async hover(locator: string | Locator): Promise<void> {
    const element = typeof locator === 'string' ? this.page.locator(locator) : locator;
    await element.hover({ timeout: this.defaultTimeout });
  }

  /**
   * Scroll element into view
   */
  async scrollIntoView(locator: string | Locator): Promise<void> {
    const element = typeof locator === 'string' ? this.page.locator(locator) : locator;
    await element.scrollIntoViewIfNeeded();
  }

  /**
   * Scroll to top of page
   */
  async scrollToTop(): Promise<void> {
    await this.page.evaluate(() => window.scrollTo(0, 0));
  }

  /**
   * Scroll to bottom of page
   */
  async scrollToBottom(): Promise<void> {
    await this.page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  }

  /**
   * Scroll by specific pixels
   */
  async scrollBy(x: number, y: number): Promise<void> {
    await this.page.evaluate(([scrollX, scrollY]) => window.scrollBy(scrollX, scrollY), [x, y]);
  }

  // ==================== FRAME METHODS ====================

  /**
   * Switch to frame by locator
   */
  async switchToFrame(frameLocator: string): Promise<any> {
    return this.page.frameLocator(frameLocator);
  }

  /**
   * Get main frame
   */
  getMainFrame(): any {
    return this.page.mainFrame();
  }

  // ==================== ALERT METHODS ====================

  /**
   * Handle alert - accept
   */
  async acceptAlert(): Promise<void> {
    this.page.on('dialog', dialog => dialog.accept());
  }

  /**
   * Handle alert - dismiss
   */
  async dismissAlert(): Promise<void> {
    this.page.on('dialog', dialog => dialog.dismiss());
  }

  /**
   * Handle alert with text input
   */
  async acceptAlertWithText(text: string): Promise<void> {
    this.page.on('dialog', dialog => dialog.accept(text));
  }

  /**
   * Get alert text
   */
  async getAlertText(): Promise<string> {
    return new Promise((resolve) => {
      this.page.on('dialog', dialog => {
        resolve(dialog.message());
        dialog.accept();
      });
    });
  }

  // ==================== SCREENSHOT METHODS ====================

  /**
   * Take full page screenshot
   */
  async takeScreenshot(path: string, fullPage: boolean = true): Promise<void> {
    await this.page.screenshot({ path, fullPage });
  }

  /**
   * Take element screenshot
   */
  async takeElementScreenshot(locator: string | Locator, path: string): Promise<void> {
    const element = typeof locator === 'string' ? this.page.locator(locator) : locator;
    await element.screenshot({ path });
  }

  // ==================== KEYBOARD METHODS ====================

  /**
   * Press a key
   */
  async pressKey(key: string): Promise<void> {
    await this.page.keyboard.press(key);
  }

  /**
   * Press multiple keys combination
   */
  async pressKeys(keys: string): Promise<void> {
    await this.page.keyboard.press(keys); // e.g., 'Control+A'
  }

  // ==================== FILE UPLOAD ====================

  /**
   * Upload file
   */
  async uploadFile(locator: string | Locator, filePath: string): Promise<void> {
    const element = typeof locator === 'string' ? this.page.locator(locator) : locator;
    await element.setInputFiles(filePath);
  }

  /**
   * Upload multiple files
   */
  async uploadMultipleFiles(locator: string | Locator, filePaths: string[]): Promise<void> {
    const element = typeof locator === 'string' ? this.page.locator(locator) : locator;
    await element.setInputFiles(filePaths);
  }

  // ==================== TABLE METHODS ====================

  /**
   * Get table row count
   */
  async getTableRowCount(tableLocator: string): Promise<number> {
    return await this.page.locator(`${tableLocator} tbody tr`).count();
  }

  /**
   * Get table cell value
   */
  async getTableCellValue(tableLocator: string, row: number, col: number): Promise<string> {
    return await this.page.locator(`${tableLocator} tbody tr:nth-child(${row}) td:nth-child(${col})`).textContent() || '';
  }

  /**
   * Get all table data
   */
  async getTableData(tableLocator: string): Promise<string[][]> {
    const rows = await this.page.locator(`${tableLocator} tbody tr`).all();
    const tableData: string[][] = [];
    
    for (const row of rows) {
      const cells = await row.locator('td').allTextContents();
      tableData.push(cells);
    }
    
    return tableData;
  }

  // ==================== URL & TITLE METHODS ====================

  /**
   * Get current URL
   */
  getCurrentUrl(): string {
    return this.page.url();
  }

  /**
   * Get page title
   */
  async getTitle(): Promise<string> {
    return await this.page.title();
  }

  // ==================== BROWSER CONTEXT METHODS ====================

  /**
   * Open new tab
   */
  async openNewTab(): Promise<Page> {
    return await this.context.newPage();
  }

  /**
   * Close current tab
   */
  async closeCurrentTab(): Promise<void> {
    await this.page.close();
  }

  /**
   * Get all open pages
   */
  getAllPages(): Page[] {
    return this.context.pages();
  }
}
```

---

### 2. WAIT HELPERS CLASS

```typescript
// utils/WaitHelpers.ts
import { Page, Locator, expect } from '@playwright/test';

export class WaitHelpers {
  private page: Page;
  private defaultTimeout: number = 30000;

  constructor(page: Page) {
    this.page = page;
  }

  /**
   * Wait for network to be idle
   */
  async waitForNetworkIdle(timeout?: number): Promise<void> {
    await this.page.waitForLoadState('networkidle', { timeout: timeout || this.defaultTimeout });
  }

  /**
   * Wait for API response
   */
  async waitForApiResponse(urlPattern: string | RegExp): Promise<any> {
    const response = await this.page.waitForResponse(urlPattern);
    return response.json();
  }

  /**
   * Wait for API request
   */
  async waitForApiRequest(urlPattern: string | RegExp): Promise<any> {
    const request = await this.page.waitForRequest(urlPattern);
    return request;
  }

  /**
   * Wait for element text to change
   */
  async waitForTextChange(locator: string | Locator, initialText: string, timeout?: number): Promise<void> {
    const element = typeof locator === 'string' ? this.page.locator(locator) : locator;
    await expect(element).not.toHaveText(initialText, { timeout: timeout || this.defaultTimeout });
  }

  /**
   * Wait for element to have specific text
   */
  async waitForText(locator: string | Locator, expectedText: string, timeout?: number): Promise<void> {
    const element = typeof locator === 'string' ? this.page.locator(locator) : locator;
    await expect(element).toHaveText(expectedText, { timeout: timeout || this.defaultTimeout });
  }

  /**
   * Wait for element to contain text
   */
  async waitForContainsText(locator: string | Locator, expectedText: string, timeout?: number): Promise<void> {
    const element = typeof locator === 'string' ? this.page.locator(locator) : locator;
    await expect(element).toContainText(expectedText, { timeout: timeout || this.defaultTimeout });
  }

  /**
   * Wait with retry
   */
  async waitWithRetry<T>(
    action: () => Promise<T>,
    maxRetries: number = 3,
    delayBetweenRetries: number = 1000
  ): Promise<T> {
    let lastError: Error | undefined;
    
    for (let i = 0; i < maxRetries; i++) {
      try {
        return await action();
      } catch (error) {
        lastError = error as Error;
        if (i < maxRetries - 1) {
          await this.page.waitForTimeout(delayBetweenRetries);
        }
      }
    }
    
    throw lastError;
  }

  /**
   * Wait for element count
   */
  async waitForElementCount(locator: string | Locator, count: number, timeout?: number): Promise<void> {
    const element = typeof locator === 'string' ? this.page.locator(locator) : locator;
    await expect(element).toHaveCount(count, { timeout: timeout || this.defaultTimeout });
  }
}
```

---

### 3. ASSERTION HELPERS CLASS

```typescript
// utils/AssertionHelpers.ts
import { Page, Locator, expect } from '@playwright/test';

export class AssertionHelpers {
  private page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  /**
   * Assert element is visible
   */
  async assertVisible(locator: string | Locator): Promise<void> {
    const element = typeof locator === 'string' ? this.page.locator(locator) : locator;
    await expect(element).toBeVisible();
  }

  /**
   * Assert element is hidden
   */
  async assertHidden(locator: string | Locator): Promise<void> {
    const element = typeof locator === 'string' ? this.page.locator(locator) : locator;
    await expect(element).toBeHidden();
  }

  /**
   * Assert element is enabled
   */
  async assertEnabled(locator: string | Locator): Promise<void> {
    const element = typeof locator === 'string' ? this.page.locator(locator) : locator;
    await expect(element).toBeEnabled();
  }

  /**
   * Assert element is disabled
   */
  async assertDisabled(locator: string | Locator): Promise<void> {
    const element = typeof locator === 'string' ? this.page.locator(locator) : locator;
    await expect(element).toBeDisabled();
  }

  /**
   * Assert element has text
   */
  async assertText(locator: string | Locator, expectedText: string): Promise<void> {
    const element = typeof locator === 'string' ? this.page.locator(locator) : locator;
    await expect(element).toHaveText(expectedText);
  }

  /**
   * Assert element contains text
   */
  async assertContainsText(locator: string | Locator, expectedText: string): Promise<void> {
    const element = typeof locator === 'string' ? this.page.locator(locator) : locator;
    await expect(element).toContainText(expectedText);
  }

  /**
   * Assert element has value
   */
  async assertValue(locator: string | Locator, expectedValue: string): Promise<void> {
    const element = typeof locator === 'string' ? this.page.locator(locator) : locator;
    await expect(element).toHaveValue(expectedValue);
  }

  /**
   * Assert element has attribute
   */
  async assertAttribute(locator: string | Locator, attrName: string, attrValue: string): Promise<void> {
    const element = typeof locator === 'string' ? this.page.locator(locator) : locator;
    await expect(element).toHaveAttribute(attrName, attrValue);
  }

  /**
   * Assert element has CSS
   */
  async assertCss(locator: string | Locator, cssProperty: string, cssValue: string): Promise<void> {
    const element = typeof locator === 'string' ? this.page.locator(locator) : locator;
    await expect(element).toHaveCSS(cssProperty, cssValue);
  }

  /**
   * Assert element has class
   */
  async assertHasClass(locator: string | Locator, className: string): Promise<void> {
    const element = typeof locator === 'string' ? this.page.locator(locator) : locator;
    await expect(element).toHaveClass(new RegExp(className));
  }

  /**
   * Assert URL contains
   */
  async assertUrlContains(urlPart: string): Promise<void> {
    await expect(this.page).toHaveURL(new RegExp(urlPart));
  }

  /**
   * Assert URL equals
   */
  async assertUrl(expectedUrl: string): Promise<void> {
    await expect(this.page).toHaveURL(expectedUrl);
  }

  /**
   * Assert page title
   */
  async assertTitle(expectedTitle: string): Promise<void> {
    await expect(this.page).toHaveTitle(expectedTitle);
  }

  /**
   * Assert title contains
   */
  async assertTitleContains(titlePart: string): Promise<void> {
    await expect(this.page).toHaveTitle(new RegExp(titlePart));
  }

  /**
   * Assert element count
   */
  async assertCount(locator: string | Locator, expectedCount: number): Promise<void> {
    const element = typeof locator === 'string' ? this.page.locator(locator) : locator;
    await expect(element).toHaveCount(expectedCount);
  }

  /**
   * Assert checkbox is checked
   */
  async assertChecked(locator: string | Locator): Promise<void> {
    const element = typeof locator === 'string' ? this.page.locator(locator) : locator;
    await expect(element).toBeChecked();
  }

  /**
   * Assert checkbox is not checked
   */
  async assertNotChecked(locator: string | Locator): Promise<void> {
    const element = typeof locator === 'string' ? this.page.locator(locator) : locator;
    await expect(element).not.toBeChecked();
  }

  /**
   * Soft assertion - continues test even if fails
   */
  async softAssertVisible(locator: string | Locator): Promise<boolean> {
    try {
      const element = typeof locator === 'string' ? this.page.locator(locator) : locator;
      await expect(element).toBeVisible({ timeout: 5000 });
      return true;
    } catch {
      return false;
    }
  }
}
```

---

### 4. BASE PAGE CLASS

```typescript
// pages/BasePage.ts
import { Page, BrowserContext, Locator } from '@playwright/test';
import { GenericActions } from '../utils/GenericActions';
import { WaitHelpers } from '../utils/WaitHelpers';
import { AssertionHelpers } from '../utils/AssertionHelpers';

export abstract class BasePage {
  protected page: Page;
  protected context: BrowserContext;
  protected actions: GenericActions;
  protected waits: WaitHelpers;
  protected assertions: AssertionHelpers;

  constructor(page: Page, context?: BrowserContext) {
    this.page = page;
    this.context = context!;
    this.actions = new GenericActions(page, context);
    this.waits = new WaitHelpers(page);
    this.assertions = new AssertionHelpers(page);
  }

  /**
   * Abstract method - each page must define its URL
   */
  abstract getPageUrl(): string;

  /**
   * Abstract method - each page must define how to verify it's loaded
   */
  abstract isPageLoaded(): Promise<boolean>;

  /**
   * Navigate to this page
   */
  async navigate(): Promise<void> {
    await this.actions.navigateTo(this.getPageUrl());
    await this.waits.waitForNetworkIdle();
  }

  /**
   * Get page instance
   */
  getPage(): Page {
    return this.page;
  }

  /**
   * Get locator shorthand
   */
  protected locator(selector: string): Locator {
    return this.page.locator(selector);
  }

  /**
   * Wait for page to be fully loaded
   */
  async waitForPageReady(): Promise<void> {
    await this.waits.waitForNetworkIdle();
    await this.page.waitForLoadState('domcontentloaded');
  }
}
```

---

### 5. SAMPLE FEATURE FILE GENERATION

```gherkin
# features/navigation.feature
@navigation @smoke
Feature: Main Navigation Menu Functionality
  As a user of Goodville Insurance website
  I want to navigate through the main menu
  So that I can access different sections of the website

  Background:
    Given I am on the Goodville homepage

  @P0 @critical
  Scenario: TC-001 - Verify main navigation menu functionality
    When I locate the main navigation menu on the homepage
    Then the navigation menu should be visible and accessible
    When I hover over the Products menu option
    Then sub-options for Auto, Home, Farm, Business, and Church insurance should be displayed
    When I click on the About Us link
    Then I should be redirected to the "/aboutus/" page
    When I click on the Make A Payment link
    Then I should be redirected to the "/makepay/" page with payment portal visible
    When I click on the Contact Us link
    Then I should be redirected to the "/contactus/" page with agent locator functionality visible

  @P0 @functional
  Scenario: TC-002 - Verify homepage loads successfully within 3 seconds
    When I open a web browser and navigate to "www.goodville.com"
    Then the browser should begin to load the Goodville homepage
    When I start a timer as soon as the URL is entered
    Then the timer should start without delay
    When I observe the loading progress of the homepage
    Then the homepage should fully load within 3 seconds
    And all main sections including the navigation menu should be displayed correctly
    And the browser console should have no critical errors or warnings

  @P1 @functional
  Scenario Outline: TC-003 - Verify navigation links redirect correctly
    Given I am on the Goodville homepage
    When I click on the "<menu_link>" link in the navigation menu
    Then I should be redirected to the "<expected_url>" page
    And the page should display "<expected_content>"

    Examples:
      | menu_link     | expected_url | expected_content           |
      | About Us      | /aboutus/    | company mission            |
      | Make A Payment| /makepay/    | payment portal             |
      | Report A Claim| /claims/     | claim submission form      |
      | Contact Us    | /contactus/  | agent locator search field |
```

---

### 6. SAMPLE STEP DEFINITIONS

```typescript
// step-definitions/navigation.steps.ts
import { Given, When, Then, Before, After } from '@cucumber/cucumber';
import { Page, Browser, BrowserContext, chromium, expect } from '@playwright/test';
import { HomePage } from '../pages/HomePage';
import { GenericActions } from '../utils/GenericActions';
import { AssertionHelpers } from '../utils/AssertionHelpers';
import { WaitHelpers } from '../utils/WaitHelpers';

let browser: Browser;
let context: BrowserContext;
let page: Page;
let homePage: HomePage;
let actions: GenericActions;
let assertions: AssertionHelpers;
let waits: WaitHelpers;

Before(async function () {
  browser = await chromium.launch({ headless: false });
  context = await browser.newContext();
  page = await context.newPage();
  
  // Initialize helpers
  actions = new GenericActions(page, context);
  assertions = new AssertionHelpers(page);
  waits = new WaitHelpers(page);
  
  // Initialize page objects
  homePage = new HomePage(page, context);
});

After(async function () {
  await page.close();
  await context.close();
  await browser.close();
});

// ==================== GIVEN STEPS ====================

Given('I am on the Goodville homepage', async function () {
  await homePage.navigate();
  await homePage.waitForPageReady();
});

Given('I open a web browser and navigate to {string}', async function (url: string) {
  await actions.navigateTo(`https://${url}`);
  await waits.waitForNetworkIdle();
});

// ==================== WHEN STEPS ====================

When('I locate the main navigation menu on the homepage', async function () {
  await waits.waitForVisible(homePage.navigationMenu);
});

When('I hover over the Products menu option', async function () {
  await actions.hover(homePage.productsMenuLink);
});

When('I click on the {string} link', async function (linkText: string) {
  await actions.click(homePage.getNavLinkByText(linkText));
  await waits.waitForNetworkIdle();
});

When('I click on the {string} link in the navigation menu', async function (linkText: string) {
  await actions.click(homePage.getNavLinkByText(linkText));
  await waits.waitForNetworkIdle();
});

When('I start a timer as soon as the URL is entered', async function () {
  this.startTime = Date.now();
});

When('I observe the loading progress of the homepage', async function () {
  await waits.waitForNetworkIdle();
  this.loadTime = Date.now() - this.startTime;
});

When('I enter {string} in the {string} field', async function (value: string, fieldName: string) {
  const fieldLocator = homePage.getFieldByName(fieldName);
  await actions.fill(fieldLocator, value);
});

When('I click on the {string} button', async function (buttonText: string) {
  await actions.click(homePage.getButtonByText(buttonText));
  await waits.waitForNetworkIdle();
});

// ==================== THEN STEPS ====================

Then('the navigation menu should be visible and accessible', async function () {
  await assertions.assertVisible(homePage.navigationMenu);
});

Then('sub-options for Auto, Home, Farm, Business, and Church insurance should be displayed', async function () {
  const subOptions = ['Auto', 'Home', 'Farm', 'Business', 'Church'];
  for (const option of subOptions) {
    await assertions.assertVisible(homePage.getSubMenuOption(option));
  }
});

Then('I should be redirected to the {string} page', async function (expectedUrl: string) {
  await assertions.assertUrlContains(expectedUrl);
});

Then('I should be redirected to the {string} page with payment portal visible', async function (expectedUrl: string) {
  await assertions.assertUrlContains(expectedUrl);
  await assertions.assertVisible(homePage.paymentPortal);
});

Then('I should be redirected to the {string} page with agent locator functionality visible', async function (expectedUrl: string) {
  await assertions.assertUrlContains(expectedUrl);
  await assertions.assertVisible(homePage.agentLocatorSearch);
});

Then('the browser should begin to load the Goodville homepage', async function () {
  await waits.waitForVisible(homePage.pageContainer);
});

Then('the timer should start without delay', async function () {
  expect(this.startTime).toBeDefined();
});

Then('the homepage should fully load within 3 seconds', async function () {
  expect(this.loadTime).toBeLessThanOrEqual(3000);
});

Then('all main sections including the navigation menu should be displayed correctly', async function () {
  await assertions.assertVisible(homePage.navigationMenu);
  await assertions.assertVisible(homePage.heroSection);
  await assertions.assertVisible(homePage.footerSection);
});

Then('the browser console should have no critical errors or warnings', async function () {
  const errors = await page.evaluate(() => {
    return (window as any).__consoleErrors || [];
  });
  expect(errors.filter((e: string) => e.includes('error'))).toHaveLength(0);
});

Then('the page should display {string}', async function (expectedContent: string) {
  await assertions.assertContainsText('body', expectedContent);
});

Then('I should see an error message {string}', async function (errorMessage: string) {
  await assertions.assertVisible(homePage.errorMessage);
  await assertions.assertContainsText(homePage.errorMessage, errorMessage);
});

Then('the {string} field should be highlighted as invalid', async function (fieldName: string) {
  const fieldLocator = homePage.getFieldByName(fieldName);
  await assertions.assertHasClass(fieldLocator, 'invalid');
});
```

---

### 7. SAMPLE PAGE OBJECT

```typescript
// pages/HomePage.ts
import { Page, BrowserContext, Locator } from '@playwright/test';
import { BasePage } from './BasePage';

export class HomePage extends BasePage {
  // ==================== LOCATORS ====================
  
  // Navigation
  readonly navigationMenu: Locator;
  readonly productsMenuLink: Locator;
  readonly aboutUsLink: Locator;
  readonly makePaymentLink: Locator;
  readonly reportClaimLink: Locator;
  readonly contactUsLink: Locator;
  readonly findAgentButton: Locator;
  readonly getQuoteButton: Locator;

  // Page Sections
  readonly pageContainer: Locator;
  readonly heroSection: Locator;
  readonly footerSection: Locator;
  
  // Components
  readonly paymentPortal: Locator;
  readonly agentLocatorSearch: Locator;
  readonly errorMessage: Locator;

  constructor(page: Page, context?: BrowserContext) {
    super(page, context);
    
    // Initialize locators
    this.navigationMenu = this.locator('nav.main-navigation, #main-nav, [role="navigation"]');
    this.productsMenuLink = this.locator('a:has-text("Products"), [data-menu="products"]');
    this.aboutUsLink = this.locator('a:has-text("About Us")');
    this.makePaymentLink = this.locator('a:has-text("Make A Payment"), a:has-text("Make Payment")');
    this.reportClaimLink = this.locator('a:has-text("Report A Claim"), a:has-text("Claims")');
    this.contactUsLink = this.locator('a:has-text("Contact Us")');
    this.findAgentButton = this.locator('button:has-text("Find an Agent"), a:has-text("Find an Agent")');
    this.getQuoteButton = this.locator('button:has-text("Get a Quote"), a:has-text("Get a Quote")');
    
    this.pageContainer = this.locator('body, #app, #root, .page-container');
    this.heroSection = this.locator('.hero, .hero-section, [data-section="hero"]');
    this.footerSection = this.locator('footer, .footer, [role="contentinfo"]');
    
    this.paymentPortal = this.locator('.payment-portal, #payment-form, [data-component="payment"]');
    this.agentLocatorSearch = this.locator('.agent-search, #agent-locator, [data-component="agent-search"]');
    this.errorMessage = this.locator('.error-message, .alert-error, [role="alert"]');
  }

  // ==================== PAGE INTERFACE METHODS ====================

  getPageUrl(): string {
    return 'https://www.goodville.com';
  }

  async isPageLoaded(): Promise<boolean> {
    return await this.navigationMenu.isVisible();
  }

  // ==================== DYNAMIC LOCATOR METHODS ====================

  getNavLinkByText(linkText: string): Locator {
    return this.locator(`nav a:has-text("${linkText}"), header a:has-text("${linkText}")`);
  }

  getSubMenuOption(optionText: string): Locator {
    return this.locator(`.submenu a:has-text("${optionText}"), .dropdown a:has-text("${optionText}")`);
  }

  getButtonByText(buttonText: string): Locator {
    return this.locator(`button:has-text("${buttonText}"), a.btn:has-text("${buttonText}")`);
  }

  getFieldByName(fieldName: string): Locator {
    const normalizedName = fieldName.toLowerCase().replace(/\s+/g, '-');
    return this.locator(`input[name="${normalizedName}"], input[id="${normalizedName}"], input[placeholder*="${fieldName}" i]`);
  }

  // ==================== PAGE-SPECIFIC ACTIONS ====================

  async hoverOnProductsMenu(): Promise<void> {
    await this.actions.hover(this.productsMenuLink);
    await this.waits.waitForVisible(this.locator('.submenu, .dropdown-menu'));
  }

  async selectInsuranceType(insuranceType: string): Promise<void> {
    await this.hoverOnProductsMenu();
    await this.actions.click(this.getSubMenuOption(insuranceType));
    await this.waits.waitForNetworkIdle();
  }

  async searchForAgent(zipCode: string): Promise<void> {
    await this.actions.click(this.findAgentButton);
    await this.waits.waitForVisible(this.agentLocatorSearch);
    await this.actions.fill(this.locator('input[name="zipcode"], input[placeholder*="zip" i]'), zipCode);
    await this.actions.click(this.locator('button:has-text("Search"), button[type="submit"]'));
    await this.waits.waitForNetworkIdle();
  }

  async navigateToQuote(): Promise<void> {
    await this.actions.click(this.getQuoteButton);
    await this.waits.waitForNetworkIdle();
  }
}
```

---

### 8. COMMON STEPS (Reusable across features)

```typescript
// step-definitions/common.steps.ts
import { Given, When, Then } from '@cucumber/cucumber';
import { expect } from '@playwright/test';

// ==================== COMMON GIVEN STEPS ====================

Given('I wait for {int} seconds', async function (seconds: number) {
  await this.actions.wait(seconds * 1000);
});

Given('I am logged in as {string}', async function (userType: string) {
  // Implementation based on user type
  const credentials = this.testData.users[userType];
  await this.loginPage.login(credentials.username, credentials.password);
});

// ==================== COMMON WHEN STEPS ====================

When('I scroll to the bottom of the page', async function () {
  await this.actions.scrollToBottom();
});

When('I scroll to the top of the page', async function () {
  await this.actions.scrollToTop();
});

When('I refresh the page', async function () {
  await this.actions.refreshPage();
  await this.waits.waitForNetworkIdle();
});

When('I navigate back', async function () {
  await this.actions.navigateBack();
  await this.waits.waitForNetworkIdle();
});

When('I press the {string} key', async function (key: string) {
  await this.actions.pressKey(key);
});

When('I clear the {string} field', async function (fieldName: string) {
  const fieldLocator = this.currentPage.getFieldByName(fieldName);
  await this.actions.clearText(fieldLocator);
});

When('I upload file {string} to {string}', async function (fileName: string, fieldName: string) {
  const fieldLocator = this.currentPage.getFieldByName(fieldName);
  await this.actions.uploadFile(fieldLocator, `./test-data/files/${fileName}`);
});

When('I select {string} from the {string} dropdown', async function (optionText: string, dropdownName: string) {
  const dropdownLocator = this.currentPage.getFieldByName(dropdownName);
  await this.actions.selectByText(dropdownLocator, optionText);
});

When('I check the {string} checkbox', async function (checkboxName: string) {
  const checkboxLocator = this.currentPage.getFieldByName(checkboxName);
  await this.actions.check(checkboxLocator);
});

When('I uncheck the {string} checkbox', async function (checkboxName: string) {
  const checkboxLocator = this.currentPage.getFieldByName(checkboxName);
  await this.actions.uncheck(checkboxLocator);
});

// ==================== COMMON THEN STEPS ====================

Then('the page title should be {string}', async function (expectedTitle: string) {
  await this.assertions.assertTitle(expectedTitle);
});

Then('the page title should contain {string}', async function (titlePart: string) {
  await this.assertions.assertTitleContains(titlePart);
});

Then('the URL should contain {string}', async function (urlPart: string) {
  await this.assertions.assertUrlContains(urlPart);
});

Then('the URL should be {string}', async function (expectedUrl: string) {
  await this.assertions.assertUrl(expectedUrl);
});

Then('the {string} element should be visible', async function (elementName: string) {
  const elementLocator = this.currentPage.getElementByName(elementName);
  await this.assertions.assertVisible(elementLocator);
});

Then('the {string} element should not be visible', async function (elementName: string) {
  const elementLocator = this.currentPage.getElementByName(elementName);
  await this.assertions.assertHidden(elementLocator);
});

Then('the {string} element should be enabled', async function (elementName: string) {
  const elementLocator = this.currentPage.getElementByName(elementName);
  await this.assertions.assertEnabled(elementLocator);
});

Then('the {string} element should be disabled', async function (elementName: string) {
  const elementLocator = this.currentPage.getElementByName(elementName);
  await this.assertions.assertDisabled(elementLocator);
});

Then('the {string} field should have value {string}', async function (fieldName: string, expectedValue: string) {
  const fieldLocator = this.currentPage.getFieldByName(fieldName);
  await this.assertions.assertValue(fieldLocator, expectedValue);
});

Then('I should see {int} {string} elements', async function (count: number, elementName: string) {
  const elementLocator = this.currentPage.getElementByName(elementName);
  await this.assertions.assertCount(elementLocator, count);
});

Then('I take a screenshot named {string}', async function (screenshotName: string) {
  await this.actions.takeScreenshot(`./reports/screenshots/${screenshotName}.png`);
});

Then('the {string} checkbox should be checked', async function (checkboxName: string) {
  const checkboxLocator = this.currentPage.getFieldByName(checkboxName);
  await this.assertions.assertChecked(checkboxLocator);
});

Then('the {string} checkbox should not be checked', async function (checkboxName: string) {
  const checkboxLocator = this.currentPage.getFieldByName(checkboxName);
  await this.assertions.assertNotChecked(checkboxLocator);
});
```

---

### 9. CONFIGURATION FILES

```typescript
// config/playwright.config.ts
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './features',
  timeout: 60000,
  expect: {
    timeout: 10000,
  },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [
    ['html', { outputFolder: 'reports/html-report' }],
    ['json', { outputFile: 'reports/test-results.json' }],
    ['junit', { outputFile: 'reports/junit-results.xml' }],
  ],
  use: {
    baseURL: process.env.BASE_URL || 'https://www.goodville.com',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
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
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
    },
  ],
});
```

```typescript
// config/cucumber.config.ts
export default {
  default: {
    require: ['step-definitions/**/*.ts', 'support/**/*.ts'],
    requireModule: ['ts-node/register'],
    format: [
      'progress-bar',
      'html:reports/cucumber-report.html',
      'json:reports/cucumber-report.json',
    ],
    formatOptions: { snippetInterface: 'async-await' },
    publishQuiet: true,
  },
};
```

---

## API ENDPOINTS

### Generate BDD Assets Endpoint

```typescript
POST /api/generate/bdd-assets

// Request Body
{
  testCases: TestCase[],
  metadata: {
    projectName: string,
    sprintName: string,
    applicationUrl: string,
    domain: string
  },
  options: {
    generateFeatureFiles: boolean,      // default: true
    generateStepDefinitions: boolean,   // default: true
    generatePageObjects: boolean,       // default: true
    generateUtilities: boolean,         // default: true
    outputFormat: 'zip' | 'individual'  // default: 'zip'
  }
}

// Response
// Content-Type: application/zip
// Content-Disposition: attachment; filename="NAT2_BDD_Assets_Sprint1_2025-01-28.zip"
```

---

## UI COMPONENT

```jsx
// components/BDDExportButton.jsx
import React, { useState } from 'react';
import { FileCode, Download, Loader2, Check } from 'lucide-react';

const BDDExportButton = ({ testCases, metadata }) => {
  const [generating, setGenerating] = useState(false);
  const [options, setOptions] = useState({
    generateFeatureFiles: true,
    generateStepDefinitions: true,
    generatePageObjects: true,
    generateUtilities: true,
  });

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      const response = await fetch('/api/generate/bdd-assets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ testCases, metadata, options }),
      });

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `NAT2_BDD_Assets_${metadata.sprintName}_${new Date().toISOString().split('T')[0]}.zip`;
      a.click();
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Generation failed:', error);
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="bdd-export-panel">
      <h3>Generate BDD Test Assets</h3>
      
      <div className="options-grid">
        {Object.entries(options).map(([key, value]) => (
          <label key={key} className="option-checkbox">
            <input
              type="checkbox"
              checked={value}
              onChange={(e) => setOptions({ ...options, [key]: e.target.checked })}
            />
            {key.replace(/([A-Z])/g, ' $1').replace('generate', 'Generate')}
          </label>
        ))}
      </div>

      <button onClick={handleGenerate} disabled={generating} className="generate-btn">
        {generating ? (
          <>
            <Loader2 className="animate-spin" /> Generating...
          </>
        ) : (
          <>
            <FileCode /> Generate Playwright + TypeScript BDD Assets
          </>
        )}
      </button>
    </div>
  );
};

export default BDDExportButton;
```

---

## DEPENDENCIES

```json
{
  "dependencies": {
    "@playwright/test": "^1.40.0",
    "@cucumber/cucumber": "^10.0.0",
    "typescript": "^5.3.0",
    "ts-node": "^10.9.0",
    "archiver": "^6.0.0"
  },
  "devDependencies": {
    "@types/node": "^20.0.0"
  }
}
```

---

## TESTING CHECKLIST

- [ ] Feature files follow Gherkin syntax correctly
- [ ] Step definitions compile without TypeScript errors
- [ ] Generic actions cover all common Playwright operations
- [ ] Page objects extend BasePage correctly
- [ ] Locators use best practices (data-testid, semantic selectors)
- [ ] Wait helpers handle async operations properly
- [ ] Assertion helpers provide meaningful error messages
- [ ] Generated code passes ESLint checks
- [ ] Tests can run in parallel without conflicts
- [ ] Screenshots captured on failures
- [ ] Reports generated in multiple formats

---

## GENERIC METHODS SUMMARY

| Category | Methods Count | Key Methods |
|----------|--------------|-------------|
| Navigation | 4 | navigateTo, navigateBack, refreshPage |
| Click Actions | 4 | click, doubleClick, rightClick, clickAndHold |
| Input Actions | 4 | fill, type, clearText, fillAndEnter |
| Dropdown | 4 | selectByText, selectByValue, selectByIndex, getOptions |
| Checkbox/Radio | 4 | check, uncheck, setChecked, isChecked |
| Get Methods | 8 | getText, getAttribute, getInputValue, getCssValue, getCount |
| Visibility | 5 | isVisible, isEnabled, isDisabled, isEditable, isHidden |
| Wait Methods | 8 | waitForVisible, waitForHidden, waitForNetworkIdle, waitForUrl |
| Scroll/Hover | 5 | hover, scrollIntoView, scrollToTop, scrollToBottom, scrollBy |
| Alerts | 4 | acceptAlert, dismissAlert, acceptAlertWithText, getAlertText |
| Screenshots | 2 | takeScreenshot, takeElementScreenshot |
| Keyboard | 2 | pressKey, pressKeys |
| File Upload | 2 | uploadFile, uploadMultipleFiles |
| Table | 3 | getTableRowCount, getTableCellValue, getTableData |
| Assertions | 15+ | assertVisible, assertText, assertUrl, assertTitle, etc. |

---

**END OF PROMPT**

Copy this entire prompt into Replit Agent to implement the BDD Test Asset Generator for NAT 2.0.
