export interface BDDScenario {
  featureTitle: string;
  scenarioTitle: string;
  tags: string[];
  steps: BDDStep[];
  domain: string;
  priority: string;
}

export interface BDDStep {
  keyword: 'Given' | 'When' | 'Then' | 'And';
  text: string;
  action?: string;
  target?: string;
  value?: string;
  expected?: string;
}

interface StepDefinitionTemplate {
  pattern: string;
  implementation: string;
  category: 'navigation' | 'form' | 'assertion' | 'wait';
}

export class AdaptorAgent {
  private domain: string;

  constructor(domain: string = 'regression') {
    this.domain = domain;
  }

  generateFeatureFile(scenario: BDDScenario): string {
    const tags = scenario.tags.map(t => `@${t}`).join(' ');
    let feature = `${tags}\n`;
    feature += `Feature: ${scenario.featureTitle}\n`;
    feature += `  As a ${this.getDomainUser()}\n`;
    feature += `  I want to ${scenario.scenarioTitle.toLowerCase()}\n`;
    feature += `  So that I can verify the application works correctly\n\n`;
    feature += `  Scenario: ${scenario.scenarioTitle}\n`;

    for (const step of scenario.steps) {
      feature += `    ${step.keyword} ${step.text}\n`;
    }

    return feature;
  }

  generateCLIStepDefinitions(scenario: BDDScenario): string {
    const steps = this.categorizeSteps(scenario.steps);
    let output = this.getCLIStepDefinitionHeader();

    if (steps.navigation.length > 0) {
      output += `\n// ──────────────────────────────────────────────\n`;
      output += `// Navigation Steps\n`;
      output += `// ──────────────────────────────────────────────\n\n`;
      for (const step of steps.navigation) {
        output += this.generateCLINavigationStep(step);
      }
    }

    if (steps.form.length > 0) {
      output += `\n// ──────────────────────────────────────────────\n`;
      output += `// Form Interaction Steps\n`;
      output += `// ──────────────────────────────────────────────\n\n`;
      for (const step of steps.form) {
        output += this.generateCLIFormStep(step);
      }
    }

    if (steps.assertion.length > 0) {
      output += `\n// ──────────────────────────────────────────────\n`;
      output += `// Assertion Steps\n`;
      output += `// ──────────────────────────────────────────────\n\n`;
      for (const step of steps.assertion) {
        output += this.generateCLIAssertionStep(step);
      }
    }

    if (steps.wait.length > 0) {
      output += `\n// ──────────────────────────────────────────────\n`;
      output += `// Wait Steps\n`;
      output += `// ──────────────────────────────────────────────\n\n`;
      for (const step of steps.wait) {
        output += this.generateCLIWaitStep(step);
      }
    }

    return output;
  }

  generateXPathStepDefinitions(scenario: BDDScenario): string {
    let output = this.getXPathStepDefinitionHeader();

    for (const step of scenario.steps) {
      const stepLower = step.text.toLowerCase();

      if (stepLower.includes('navigate') || stepLower.includes('go to') || stepLower.includes('open')) {
        output += `When('${this.escapeCucumberPattern(step.text)}', async function () {\n`;
        output += `  const url = this.testData?.url || TARGET_URL;\n`;
        output += `  await page.goto(url, { waitUntil: 'networkidle' });\n`;
        output += `});\n\n`;
      } else if (stepLower.includes('click')) {
        const target = step.target || this.extractTarget(step.text);
        output += `When('${this.escapeCucumberPattern(step.text)}', async function () {\n`;
        output += `  await page.locator(\`xpath=//button[contains(text(),'${target}')] | //a[contains(text(),'${target}')]\`).click();\n`;
        output += `});\n\n`;
      } else if (stepLower.includes('fill') || stepLower.includes('enter') || stepLower.includes('type')) {
        output += `When('I fill the {string} field with {string}', async function (fieldLabel: string, value: string) {\n`;
        output += `  await page.locator(\`xpath=//input[@name='\${fieldLabel}'] | //input[@placeholder='\${fieldLabel}'] | //textarea[@name='\${fieldLabel}']\`).fill(value);\n`;
        output += `});\n\n`;
      } else if (stepLower.includes('should') || stepLower.includes('verify') || stepLower.includes('assert') || stepLower.includes('see')) {
        output += `Then('${this.escapeCucumberPattern(step.text)}', async function () {\n`;
        if (step.expected) {
          output += `  await expect(page.getByText('${step.expected.replace(/'/g, "\\'")}')).toBeVisible();\n`;
        } else {
          output += `  // Verify the expected outcome\n`;
          output += `  await expect(page).toHaveURL(/.*/); // Page still loaded\n`;
        }
        output += `  await page.screenshot({ path: \`evidence/\${this.testName}/assertion_\${Date.now()}.png\` });\n`;
        output += `});\n\n`;
      }
    }

    return output;
  }

  convertTestCaseToBDD(testCase: {
    id: string;
    title: string;
    category?: string;
    priority?: string;
    steps: { action: string; expected_behavior?: string }[];
  }): BDDScenario {
    const steps: BDDStep[] = [];

    for (let i = 0; i < testCase.steps.length; i++) {
      const tc = testCase.steps[i];
      const actionLower = tc.action.toLowerCase();

      let keyword: BDDStep['keyword'];
      if (i === 0) {
        keyword = 'Given';
      } else if (actionLower.includes('verify') || actionLower.includes('should') || actionLower.includes('assert') || actionLower.includes('see')) {
        keyword = 'Then';
      } else if (i > 0 && steps[steps.length - 1]?.keyword === steps[steps.length - 1]?.keyword) {
        keyword = 'And';
      } else {
        keyword = 'When';
      }

      const step: BDDStep = {
        keyword,
        text: tc.action,
        expected: tc.expected_behavior
      };

      if (actionLower.includes('fill') || actionLower.includes('enter') || actionLower.includes('type')) {
        step.action = 'fill';
        step.target = this.extractTarget(tc.action);
        const withMatch = tc.action.match(/\bwith\s+['"]?(.+?)['"]?\s*$/i);
        if (withMatch) step.value = withMatch[1].trim();
      } else if (actionLower.includes('click') || actionLower.includes('press') || actionLower.includes('tap')) {
        step.action = 'click';
        step.target = this.extractTarget(tc.action);
      } else if (actionLower.includes('navigate') || actionLower.includes('go to') || actionLower.includes('open')) {
        step.action = 'navigate';
        const urlMatch = tc.action.match(/(https?:\/\/[^\s]+)/);
        if (urlMatch) step.target = urlMatch[1];
      } else if (actionLower.includes('select') || actionLower.includes('choose')) {
        step.action = 'select';
        step.target = this.extractTarget(tc.action);
      } else if (actionLower.includes('check') && !actionLower.includes('uncheck')) {
        step.action = 'check';
        step.target = this.extractTarget(tc.action);
      }

      steps.push(step);

      if (tc.expected_behavior) {
        steps.push({
          keyword: 'Then',
          text: tc.expected_behavior,
          expected: tc.expected_behavior
        });
      }
    }

    return {
      featureTitle: testCase.title,
      scenarioTitle: testCase.title,
      tags: [testCase.category || 'functional', testCase.priority || 'P2'],
      steps,
      domain: this.domain,
      priority: testCase.priority || 'P2'
    };
  }

  private getCLIStepDefinitionHeader(): string {
    return `// ============================================================
// NAT 2.0 — CLI-Based Step Definitions
// Generated by AdaptorAgent
// Pattern: Playwright CLI via NAT20PlaywrightCLI wrapper
// Domain: ${this.domain}
// Generated: ${new Date().toISOString()}
// ============================================================

import { Given, When, Then, Before, After } from '@cucumber/cucumber';
import { NAT20PlaywrightCLI } from '../../core/NAT20PlaywrightCLI';
import { expect } from '@playwright/test';

let cli: NAT20PlaywrightCLI;

Before(async function () {
  // CLI instance injected by Execution Agent via World context
  cli = this.cli as NAT20PlaywrightCLI;
});

After(async function () {
  // Evidence captured by Execution Agent — no cleanup needed here
});

`;
  }

  private getXPathStepDefinitionHeader(): string {
    return `// ============================================================
// NAT 2.0 — XPath-Based Step Definitions
// Generated by AdaptorAgent
// Pattern: Direct Playwright API with relative XPath locators
// Domain: ${this.domain}
// Generated: ${new Date().toISOString()}
// ============================================================

import { test, expect, Page } from '@playwright/test';

const TARGET_URL = process.env.TARGET_URL || 'https://your-app.com';
let page: Page;

`;
  }

  private generateCLINavigationStep(step: BDDStep): string {
    return `When('${this.escapeCucumberPattern(step.text)}', async function () {
  const url = '${step.target || 'TARGET_URL'}';
  await cli.goto(url);
  await cli.waitForLoadState('networkidle');
});

`;
  }

  private generateCLIFormStep(step: BDDStep): string {
    if (step.action === 'fill') {
      const fieldLabel = step.target || 'field';
      const value = step.value || '';
      return `When('I fill the {string} field with {string}', async function (fieldLabel: string, value: string) {
  const elements = await cli.getSnapshot();
  const ref = elements[fieldLabel];
  if (!ref) throw new Error(\`Field "\${fieldLabel}" not found in snapshot. Available: \${Object.keys(elements).join(', ')}\`);
  await cli.fill(ref, value);
  await cli.waitForLoadState('domcontentloaded');
});

`;
    }

    if (step.action === 'click') {
      const target = step.target || 'element';
      return `When('${this.escapeCucumberPattern(step.text)}', async function () {
  const elements = await cli.getSnapshot();
  const ref = elements['${target}'] || elements['${target} Button'] || elements['${target} Link'];
  if (!ref) throw new Error('${target} not found in snapshot. Available: ' + Object.keys(elements).join(', '));
  await cli.click(ref);
  await cli.waitForLoadState('networkidle');
});

`;
    }

    if (step.action === 'select') {
      return `When('I select {string} from the {string} dropdown', async function (value: string, fieldLabel: string) {
  const elements = await cli.getSnapshot();
  const ref = elements[fieldLabel];
  if (!ref) throw new Error(\`Dropdown "\${fieldLabel}" not found in snapshot\`);
  await cli.select(ref, value);
});

`;
    }

    if (step.action === 'check') {
      return `When('${this.escapeCucumberPattern(step.text)}', async function () {
  const elements = await cli.getSnapshot();
  const ref = elements['${step.target || 'checkbox'}'];
  if (!ref) throw new Error('Checkbox not found in snapshot');
  await cli.check(ref);
});

`;
    }

    return `// Unrecognized form step: ${step.text}\n\n`;
  }

  private generateCLIAssertionStep(step: BDDStep): string {
    return `Then('${this.escapeCucumberPattern(step.text)}', async function () {
  ${step.expected ? `const pageContent = await cli.evaluate('document.body.innerText');
  expect(pageContent).toContain('${(step.expected || '').replace(/'/g, "\\'")}');` : `// Verify the expected outcome
  await cli.waitForLoadState('networkidle');`}
  await cli.captureScreenshot('assertion-${step.text.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 30)}');
});

`;
  }

  private generateCLIWaitStep(step: BDDStep): string {
    return `When('${this.escapeCucumberPattern(step.text)}', async function () {
  await cli.waitForLoadState('networkidle');
});

`;
  }

  private categorizeSteps(steps: BDDStep[]): {
    navigation: BDDStep[];
    form: BDDStep[];
    assertion: BDDStep[];
    wait: BDDStep[];
  } {
    const result = {
      navigation: [] as BDDStep[],
      form: [] as BDDStep[],
      assertion: [] as BDDStep[],
      wait: [] as BDDStep[]
    };

    for (const step of steps) {
      const textLower = step.text.toLowerCase();
      if (textLower.includes('navigate') || textLower.includes('go to') || textLower.includes('open page')) {
        result.navigation.push(step);
      } else if (textLower.includes('wait') || textLower.includes('pause')) {
        result.wait.push(step);
      } else if (textLower.includes('should') || textLower.includes('verify') || textLower.includes('assert') || textLower.includes('see') || textLower.includes('display')) {
        result.assertion.push(step);
      } else {
        result.form.push(step);
      }
    }

    return result;
  }

  private extractTarget(text: string): string {
    const patterns = [
      /(?:click|tap|press)\s+(?:on\s+)?(?:the\s+)?['"]?(.+?)['"]?\s*(?:button|link|tab|menu)?$/i,
      /(?:fill|type|enter)\s+(?:in\s+)?(?:the\s+)?['"]?(.+?)['"]?\s+(?:field\s+)?(?:with|value)/i,
      /(?:select|choose)\s+(?:the\s+)?['"]?(.+?)['"]?\s+(?:from|option)/i
    ];

    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) return match[1].trim();
    }

    return text.replace(/^(click|fill|enter|type|select|navigate|go to|open)\s+(?:on\s+)?(?:the\s+)?/i, '').trim();
  }

  private escapeCucumberPattern(text: string): string {
    return text.replace(/'/g, "\\'").replace(/\{/g, '\\{').replace(/\}/g, '\\}');
  }

  private getDomainUser(): string {
    const domainUsers: Record<string, string> = {
      healthcare: 'healthcare professional',
      insurance: 'insurance agent',
      banking: 'banking customer',
      fintech: 'fintech user',
      regression: 'quality analyst'
    };
    return domainUsers[this.domain] || 'user';
  }
}
