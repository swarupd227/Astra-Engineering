interface MigrationResult {
  success: boolean;
  fileType: 'feature' | 'stepDefinition' | 'pageObject' | 'hooks' | 'unknown';
  originalCode: string;
  convertedCode: string;
  warnings: string[];
  errors: string[];
  stats: {
    locatorsConverted: number;
    actionsConverted: number;
    assertionsConverted: number;
    hooksConverted: number;
    stepsConverted: number;
  };
}

interface ProjectMigrationResult {
  success: boolean;
  files: {
    stepDefinitions: { name: string; code: string }[];
    pageObjects: { name: string; code: string }[];
    features: { name: string; code: string }[];
    support: { name: string; code: string }[];
    config: { name: string; code: string }[];
  };
  summary: {
    totalFiles: number;
    successfulConversions: number;
    failedConversions: number;
    warnings: string[];
  };
}

const LOCATOR_MAPPINGS: [RegExp, string][] = [
  [/_driver\.FindElement\(By\.Id\("([^"]+)"\)\)/g, "this.page!.locator('#$1')"],
  [/_driver\.FindElement\(By\.Id\('([^']+)'\)\)/g, "this.page!.locator('#$1')"],
  [/(?<![_\w])driver\.FindElement\(By\.Id\("([^"]+)"\)\)/g, "page.locator('#$1')"],
  [/(?<![_\w])driver\.FindElement\(By\.Id\('([^']+)'\)\)/g, "page.locator('#$1')"],
  [/_driver\.FindElement\(By\.Name\("([^"]+)"\)\)/g, "this.page!.locator('[name=\"$1\"]')"],
  [/(?<![_\w])driver\.FindElement\(By\.Name\("([^"]+)"\)\)/g, "page.locator('[name=\"$1\"]')"],
  [/_driver\.FindElement\(By\.ClassName\("([^"]+)"\)\)/g, "this.page!.locator('.$1')"],
  [/(?<![_\w])driver\.FindElement\(By\.ClassName\("([^"]+)"\)\)/g, "page.locator('.$1')"],
  [/_driver\.FindElement\(By\.CssSelector\("([^"]+)"\)\)/g, "this.page!.locator('$1')"],
  [/(?<![_\w])driver\.FindElement\(By\.CssSelector\("([^"]+)"\)\)/g, "page.locator('$1')"],
  [/_driver\.FindElement\(By\.XPath\("([^"]+)"\)\)/g, 'this.page!.locator("$1")'],
  [/(?<![_\w])driver\.FindElement\(By\.XPath\("([^"]+)"\)\)/g, 'page.locator("$1")'],
  [/_driver\.FindElement\(By\.LinkText\("([^"]+)"\)\)/g, "this.page!.getByRole('link', { name: '$1', exact: true })"],
  [/(?<![_\w])driver\.FindElement\(By\.LinkText\("([^"]+)"\)\)/g, "page.getByRole('link', { name: '$1', exact: true })"],
  [/_driver\.FindElement\(By\.PartialLinkText\("([^"]+)"\)\)/g, "this.page!.getByRole('link', { name: /$1/i })"],
  [/(?<![_\w])driver\.FindElement\(By\.PartialLinkText\("([^"]+)"\)\)/g, "page.getByRole('link', { name: /$1/i })"],
  [/_driver\.FindElement\(By\.TagName\("([^"]+)"\)\)/g, "this.page!.locator('$1')"],
  [/(?<![_\w])driver\.FindElement\(By\.TagName\("([^"]+)"\)\)/g, "page.locator('$1')"],
  [/_driver\.FindElements\(By\.ClassName\("([^"]+)"\)\)/g, "this.page!.locator('.$1').all()"],
  [/(?<![_\w])driver\.FindElements\(By\.ClassName\("([^"]+)"\)\)/g, "page.locator('.$1').all()"],
  [/_driver\.FindElements\(By\.CssSelector\("([^"]+)"\)\)/g, "this.page!.locator('$1').all()"],
  [/(?<![_\w])driver\.FindElements\(By\.CssSelector\("([^"]+)"\)\)/g, "page.locator('$1').all()"],
];

const ACTION_MAPPINGS: [RegExp, string][] = [
  [/\.Click\(\)/g, '.click()'],
  [/\.SendKeys\(Keys\.Enter\)/g, ".press('Enter')"],
  [/\.SendKeys\(Keys\.Tab\)/g, ".press('Tab')"],
  [/\.SendKeys\(Keys\.Escape\)/g, ".press('Escape')"],
  [/\.SendKeys\(Keys\.Backspace\)/g, ".press('Backspace')"],
  [/\.SendKeys\(Keys\.Delete\)/g, ".press('Delete')"],
  [/\.SendKeys\(Keys\.ArrowDown\)/g, ".press('ArrowDown')"],
  [/\.SendKeys\(Keys\.ArrowUp\)/g, ".press('ArrowUp')"],
  [/\.SendKeys\("([^"]+)"\)/g, ".fill('$1')"],
  [/\.SendKeys\('([^']+)'\)/g, ".fill('$1')"],
  [/\.SendKeys\(([^)]+)\)/g, '.fill($1)'],
  [/\.Clear\(\)/g, '.clear()'],
  [/\.Text/g, '.textContent()'],
  [/\.GetAttribute\("([^"]+)"\)/g, ".getAttribute('$1')"],
  [/\.Displayed/g, '.isVisible()'],
  [/\.Enabled/g, '.isEnabled()'],
  [/\.Selected/g, '.isChecked()'],
];

const NAVIGATION_MAPPINGS: [RegExp, string][] = [
  [/_driver\.Navigate\(\)\.GoToUrl\("([^"]+)"\)/g, "await this.page!.goto('$1')"],
  [/(?<![_\w])driver\.Navigate\(\)\.GoToUrl\("([^"]+)"\)/g, "await page.goto('$1')"],
  [/_driver\.Navigate\(\)\.Back\(\)/g, 'await this.page!.goBack()'],
  [/(?<![_\w])driver\.Navigate\(\)\.Back\(\)/g, 'await page.goBack()'],
  [/_driver\.Navigate\(\)\.Forward\(\)/g, 'await this.page!.goForward()'],
  [/(?<![_\w])driver\.Navigate\(\)\.Forward\(\)/g, 'await page.goForward()'],
  [/_driver\.Navigate\(\)\.Refresh\(\)/g, 'await this.page!.reload()'],
  [/(?<![_\w])driver\.Navigate\(\)\.Refresh\(\)/g, 'await page.reload()'],
  [/_driver\.Url/g, 'this.page!.url()'],
  [/(?<![_\w])driver\.Url/g, 'page.url()'],
  [/_driver\.Title/g, 'await this.page!.title()'],
  [/(?<![_\w])driver\.Title/g, 'await page.title()'],
];

const WAIT_MAPPINGS: [RegExp, string][] = [
  [/wait\.Until\(ExpectedConditions\.ElementIsVisible\(By\.Id\("([^"]+)"\)\)\)/g, "await page.locator('#$1').waitFor({ state: 'visible' })"],
  [/wait\.Until\(ExpectedConditions\.ElementToBeClickable\(By\.Id\("([^"]+)"\)\)\)/g, "await page.locator('#$1').waitFor({ state: 'visible' })"],
  [/wait\.Until\(ExpectedConditions\.InvisibilityOfElementLocated\(By\.Id\("([^"]+)"\)\)\)/g, "await page.locator('#$1').waitFor({ state: 'hidden' })"],
  [/wait\.Until\(ExpectedConditions\.UrlContains\("([^"]+)"\)\)/g, "await page.waitForURL('**/$1**')"],
  [/Thread\.Sleep\((\d+)\)/g, 'await page.waitForTimeout($1)'],
];

const ASSERTION_MAPPINGS: [RegExp, string][] = [
  [/Assert\.IsTrue\(([^)]+)\.Displayed\)/g, 'await expect($1).toBeVisible()'],
  [/Assert\.IsFalse\(([^)]+)\.Displayed\)/g, 'await expect($1).not.toBeVisible()'],
  [/Assert\.IsTrue\(([^)]+)\.Enabled\)/g, 'await expect($1).toBeEnabled()'],
  [/Assert\.IsFalse\(([^)]+)\.Enabled\)/g, 'await expect($1).toBeDisabled()'],
  [/Assert\.AreEqual\(([^,]+),\s*([^)]+)\.Text\)/g, 'await expect($2).toHaveText($1)'],
  [/Assert\.AreEqual\(([^,]+),\s*([^)]+)\)/g, 'expect($2).toBe($1)'],
  [/Assert\.IsTrue\(([^)]+)\)/g, 'expect($1).toBeTruthy()'],
  [/Assert\.IsFalse\(([^)]+)\)/g, 'expect($1).toBeFalsy()'],
  [/Assert\.IsNotNull\(([^)]+)\)/g, 'expect($1).not.toBeNull()'],
  [/Assert\.IsNull\(([^)]+)\)/g, 'expect($1).toBeNull()'],
  [/StringAssert\.Contains\("([^"]+)",\s*([^)]+)\)/g, "expect($2).toContain('$1')"],
];

const CONTEXT_MAPPINGS: [RegExp, string][] = [
  [/ScenarioContext\.Current\["([^"]+)"\]\s*=\s*/g, "this.scenarioData['$1'] = "],
  [/ScenarioContext\.Current\["([^"]+)"\]/g, "this.scenarioData['$1']"],
  [/_scenarioContext\["([^"]+)"\]\s*=\s*/g, "this.scenarioData['$1'] = "],
  [/_scenarioContext\["([^"]+)"\]/g, "this.scenarioData['$1']"],
  [/scenarioContext\["([^"]+)"\]\s*=\s*/g, "this.scenarioData['$1'] = "],
  [/scenarioContext\["([^"]+)"\]/g, "this.scenarioData['$1']"],
  [/FeatureContext\.Current\["([^"]+)"\]\s*=\s*/g, "this.featureData['$1'] = "],
  [/FeatureContext\.Current\["([^"]+)"\]/g, "this.featureData['$1']"],
  [/_featureContext\["([^"]+)"\]/g, "this.featureData['$1']"],
  [/featureContext\["([^"]+)"\]/g, "this.featureData['$1']"],
  [/ScenarioContext\.Current\.Get<([^>]+)>\("([^"]+)"\)/g, "this.scenarioData['$2'] as $1"],
  [/ScenarioContext\.Current\.TryGetValue\("([^"]+)",\s*out\s+var\s+(\w+)\)/g, "const $2 = this.scenarioData['$1']"],
];

const TYPE_MAPPINGS: Record<string, string> = {
  'string': 'string',
  'int': 'number',
  'Int32': 'number',
  'long': 'number',
  'Int64': 'number',
  'double': 'number',
  'Double': 'number',
  'float': 'number',
  'Single': 'number',
  'decimal': 'number',
  'bool': 'boolean',
  'Boolean': 'boolean',
  'void': 'void',
  'List<string>': 'string[]',
  'List<int>': 'number[]',
  'Dictionary<string, string>': 'Record<string, string>',
  'Dictionary<string, object>': 'Record<string, any>',
  'IWebDriver': 'Page',
  'IWebElement': 'Locator',
  'Table': 'DataTable',
  'DateTime': 'Date',
};

const HOOK_MAPPINGS: Record<string, string> = {
  '[BeforeScenario]': 'Before',
  '[AfterScenario]': 'After',
  '[BeforeFeature]': 'BeforeAll',
  '[AfterFeature]': 'AfterAll',
  '[BeforeStep]': 'BeforeStep',
  '[AfterStep]': 'AfterStep',
  '[BeforeTestRun]': 'BeforeAll',
  '[AfterTestRun]': 'AfterAll',
};

const TAG_MAPPINGS: Record<string, string> = {
  '@ignore': '@skip',
  '@Ignore': '@skip',
  '@pending': '@skip',
  '@wip': '@skip',
};

function detectFileType(code: string, hint?: string): MigrationResult['fileType'] | 'alreadyPlaywright' {
  // Check if code is already in Playwright format
  if (code.includes('@playwright/test') || code.includes("from '@playwright/test'") || 
      code.includes("from \"@playwright/test\"") || code.includes("require('@playwright/test')") ||
      code.includes("require(\"@playwright/test\")")) {
    return 'alreadyPlaywright';
  }
  
  // Check for Cucumber.js patterns (already migrated)
  if (code.includes('@cucumber/cucumber') || code.includes("from '@cucumber/cucumber'")) {
    return 'alreadyPlaywright';
  }
  
  if (code.includes('Feature:') && code.includes('Scenario')) {
    return 'feature';
  }
  
  // Step definition detection - more flexible (doesn't require [Binding] on same block)
  if (code.includes('[Given') || code.includes('[When') || code.includes('[Then')) {
    return 'stepDefinition';
  }
  
  // Also detect step definitions by method patterns with Selenium
  if ((code.includes('public void') || code.includes('public async')) && 
      (code.includes('FindElement') || code.includes('IWebDriver') || code.includes('_driver'))) {
    // If hint is provided, trust it
    if (hint === 'stepDefinition' || hint === 'pageObject') {
      return hint;
    }
    return 'stepDefinition';
  }
  
  if (code.includes('[BeforeScenario]') || code.includes('[AfterScenario]') || 
      code.includes('[BeforeFeature]') || code.includes('[AfterFeature]')) {
    return 'hooks';
  }
  if (code.includes('class') && code.includes('IWebDriver') && !code.includes('[Binding]')) {
    return 'pageObject';
  }
  
  // If hint provided and code has C# patterns, trust the hint
  if (hint && (code.includes('public') || code.includes('private') || code.includes('void') || 
               code.includes('class') || code.includes('namespace'))) {
    if (hint === 'stepDefinition' || hint === 'pageObject' || hint === 'hooks' || hint === 'feature') {
      return hint;
    }
  }
  
  return 'unknown';
}

function convertFeatureFile(code: string): { converted: string; warnings: string[] } {
  const warnings: string[] = [];
  let converted = code;
  
  for (const [csharpTag, playwrightTag] of Object.entries(TAG_MAPPINGS)) {
    if (converted.includes(csharpTag)) {
      converted = converted.replace(new RegExp(csharpTag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), playwrightTag);
      warnings.push(`Converted tag ${csharpTag} to ${playwrightTag}`);
    }
  }
  
  return { converted, warnings };
}

function extractStepPattern(attributeLine: string): string {
  const match = attributeLine.match(/\[(?:Given|When|Then|And|But)\(@?"([^"]+)"\)\]/);
  if (match) {
    let pattern = match[1];
    pattern = pattern.replace(/\(\.\*\)/g, '{string}');
    pattern = pattern.replace(/\(\\d\+\)/g, '{int}');
    pattern = pattern.replace(/\(\[^"\]\*\)/g, '{string}');
    pattern = pattern.replace(/\(\.\+\)/g, '{string}');
    pattern = pattern.replace(/^@/, '');
    return pattern;
  }
  return '';
}

function extractMethodParameters(methodSignature: string): { name: string; type: string }[] {
  const params: { name: string; type: string }[] = [];
  const match = methodSignature.match(/\(([^)]*)\)/);
  if (match && match[1].trim()) {
    const paramList = match[1].split(',').map(p => p.trim());
    for (const param of paramList) {
      if (param.includes('Table ') || param.includes('DataTable ')) {
        const name = param.split(' ').pop() || 'dataTable';
        params.push({ name, type: 'DataTable' });
      } else {
        const parts = param.split(' ').filter(p => p);
        if (parts.length >= 2) {
          const csharpType = parts[0];
          const name = parts[parts.length - 1];
          const tsType = TYPE_MAPPINGS[csharpType] || 'any';
          params.push({ name, type: tsType });
        }
      }
    }
  }
  return params;
}

function convertMethodBody(body: string): string {
  let converted = body;
  
  for (const [pattern, replacement] of LOCATOR_MAPPINGS) {
    converted = converted.replace(pattern, replacement);
  }
  
  for (const [pattern, replacement] of NAVIGATION_MAPPINGS) {
    converted = converted.replace(pattern, replacement);
  }
  
  for (const [pattern, replacement] of WAIT_MAPPINGS) {
    converted = converted.replace(pattern, replacement);
  }
  
  for (const [pattern, replacement] of ASSERTION_MAPPINGS) {
    converted = converted.replace(pattern, replacement);
  }
  
  for (const [pattern, replacement] of ACTION_MAPPINGS) {
    converted = converted.replace(pattern, replacement);
  }
  
  for (const [pattern, replacement] of CONTEXT_MAPPINGS) {
    converted = converted.replace(pattern, replacement);
  }
  
  converted = converted.replace(/var\s+(\w+)\s*=/g, 'const $1 =');
  converted = converted.replace(/^\s*\/\/(.+)/gm, '// $1');
  
  const lines = converted.split('\n');
  const convertedLines = lines.map(line => {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('//') && !trimmed.startsWith('{') && !trimmed.startsWith('}')) {
      const asyncCalls = ['.click()', '.fill(', '.goto(', '.waitFor(', '.textContent()', '.isVisible()', '.getAttribute(', '.press(', '.clear()', '.innerText()'];
      const hasAsyncCall = asyncCalls.some(call => trimmed.includes(call));
      
      if (hasAsyncCall) {
        if (trimmed.startsWith('const ') || trimmed.startsWith('var ') || trimmed.startsWith('let ')) {
          const match = line.match(/^(\s*)(const|var|let)\s+(\w+)\s*=\s*(.+)$/);
          if (match) {
            const [, indent, keyword, varName, value] = match;
            if (!value.trim().startsWith('await ')) {
              return `${indent}${keyword} ${varName} = await ${value.trim()}`;
            }
          }
        } else if (!trimmed.startsWith('await ') && !trimmed.startsWith('return ')) {
          return line.replace(trimmed, `await ${trimmed}`);
        }
      }
    }
    return line;
  });
  
  return convertedLines.join('\n');
}

function extractMethodBody(code: string, startIndex: number): string {
  let braceCount = 0;
  let started = false;
  let bodyStart = -1;
  
  for (let i = startIndex; i < code.length; i++) {
    if (code[i] === '{') {
      if (!started) {
        started = true;
        bodyStart = i + 1;
      }
      braceCount++;
    } else if (code[i] === '}') {
      braceCount--;
      if (braceCount === 0 && started) {
        return code.substring(bodyStart, i);
      }
    }
  }
  return '';
}

function convertStepDefinition(code: string): { converted: string; warnings: string[]; stepsConverted: number } {
  const warnings: string[] = [];
  let stepsConverted = 0;
  
  const stepAttributeRegex = /\[(Given|When|Then|And|But)\(@?"((?:[^"]|"")*)"\)\]\s*(?:public\s+)?(?:async\s+)?(?:Task|void)\s+(\w+)\s*\(([^)]*)\)/g;
  
  const steps: string[] = [];
  let match;
  
  let lastPrimaryStepType = 'Given';
  
  while ((match = stepAttributeRegex.exec(code)) !== null) {
    const [fullMatch, stepType, pattern, methodName, params] = match;
    const bodyStartIndex = match.index + fullMatch.length;
    const body = extractMethodBody(code, bodyStartIndex);
    
    if (!body) {
      warnings.push(`Could not extract body for method ${methodName}`);
      continue;
    }
    
    stepsConverted++;
    
    let normalizedStepType = stepType;
    if (stepType === 'And' || stepType === 'But') {
      normalizedStepType = lastPrimaryStepType;
      warnings.push(`Converted [${stepType}] to ${normalizedStepType} (Cucumber.js doesn't have And/But functions)`);
    } else {
      lastPrimaryStepType = stepType;
    }
    
    let stepPattern = pattern
      .replace(/""\(\.\*\)""/g, '{string}')
      .replace(/\(\.\*\)/g, '{string}')
      .replace(/\(\\d\+\)/g, '{int}')
      .replace(/\(\[^"\]\*\)/g, '{string}')
      .replace(/\(\.\+\)/g, '{string}')
      .replace(/""/g, '"')
      .replace(/^@/, '');
    
    const parameters = extractMethodParameters(`(${params})`);
    const paramString = parameters
      .filter(p => p.type !== 'DataTable' || parameters.some(pp => pp.type === 'DataTable'))
      .map(p => `${p.name}: ${p.type}`)
      .join(', ');
    
    const hasDataTable = parameters.some(p => p.type === 'DataTable');
    const funcParams = hasDataTable 
      ? `this: ICustomWorld${paramString ? ', ' + paramString : ''}`
      : `this: ICustomWorld${paramString ? ', ' + paramString : ''}`;
    
    const convertedBody = convertMethodBody(body);
    
    const step = `${normalizedStepType}('${stepPattern}', async function (${funcParams}) {${convertedBody}});`;
    steps.push(step);
  }
  
  if (steps.length === 0) {
    // Fallback: try to convert plain Selenium methods without SpecFlow attributes
    const plainMethodRegex = /(?:public\s+)?(?:async\s+)?(?:Task|void)\s+(\w+)\s*\(([^)]*)\)\s*\{/g;
    let methodMatch;
    
    while ((methodMatch = plainMethodRegex.exec(code)) !== null) {
      const [fullMatch, methodName, params] = methodMatch;
      const bodyStartIndex = methodMatch.index + fullMatch.length - 1; // -1 to include the {
      const body = extractMethodBody(code, bodyStartIndex);
      
      if (!body) continue;
      
      // Convert method name to step pattern (camelCase to readable)
      const stepPattern = methodName
        .replace(/([A-Z])/g, ' $1')
        .toLowerCase()
        .trim()
        .replace(/\s+/g, ' ');
      
      const parameters = extractMethodParameters(`(${params})`);
      const paramString = parameters
        .map(p => `${p.name}: ${p.type}`)
        .join(', ');
      
      const funcParams = `this: ICustomWorld${paramString ? ', ' + paramString : ''}`;
      const convertedBody = convertMethodBody(body);
      
      // Default to When for action methods
      const step = `When('${stepPattern}', async function (${funcParams}) {${convertedBody}});`;
      steps.push(step);
      stepsConverted++;
    }
    
    if (steps.length === 0) {
      warnings.push('No step definitions or methods with Selenium patterns found in the code. Make sure code has [Given], [When], [Then] attributes or Selenium actions like FindElement.');
    } else {
      warnings.push(`Converted ${stepsConverted} plain method(s) to step definitions. Review step patterns and step types (Given/When/Then) as needed.`);
    }
  }
  
  const hasDataTable = code.includes('Table table') || code.includes('Table ');
  const imports = [
    "import { Given, When, Then } from '@cucumber/cucumber';",
    "import { expect } from '@playwright/test';",
    "import { ICustomWorld } from '../support/custom-world';",
  ];
  
  if (hasDataTable) {
    imports.push("import { DataTable } from '@cucumber/cucumber';");
  }
  
  const converted = `${imports.join('\n')}\n\n${steps.join('\n\n')}`;
  
  return { converted, warnings, stepsConverted };
}

function convertHooks(code: string): { converted: string; warnings: string[]; hooksConverted: number } {
  const warnings: string[] = [];
  let hooksConverted = 0;
  
  const hookStubs: string[] = [];
  
  for (const [csharpHook, playwrightHook] of Object.entries(HOOK_MAPPINGS)) {
    if (code.includes(csharpHook)) {
      hooksConverted++;
    }
  }
  
  const hasBeforeFeature = code.includes('[BeforeFeature]') || code.includes('[BeforeTestRun]');
  const hasAfterFeature = code.includes('[AfterFeature]') || code.includes('[AfterTestRun]');
  const hasBeforeScenario = code.includes('[BeforeScenario]');
  const hasAfterScenario = code.includes('[AfterScenario]');
  const hasScreenshotOnFailure = code.includes('TestError') || code.includes('screenshot');
  
  const converted = `import { Before, After, BeforeAll, AfterAll, BeforeStep, AfterStep, Status } from '@cucumber/cucumber';
import { chromium, Browser, BrowserContext, Page } from '@playwright/test';
import { ICustomWorld } from './custom-world';

let browser: Browser;

${hasBeforeFeature ? `BeforeAll(async function () {
    browser = await chromium.launch({
        headless: true,
        args: ['--start-maximized']
    });
});` : ''}

${hasAfterFeature ? `AfterAll(async function () {
    await browser.close();
});` : ''}

${hasBeforeScenario ? `Before(async function (this: ICustomWorld) {
    this.context = await browser.newContext({
        viewport: { width: 1920, height: 1080 }
    });
    this.page = await this.context.newPage();
});` : ''}

${hasAfterScenario ? `After(async function (this: ICustomWorld, scenario) {
    ${hasScreenshotOnFailure ? `if (scenario.result?.status === Status.FAILED && this.page) {
        const screenshot = await this.page.screenshot();
        this.attach(screenshot, 'image/png');
    }` : ''}
    await this.page?.close();
    await this.context?.close();
});` : ''}

${code.includes('[BeforeStep]') ? `BeforeStep(async function (this: ICustomWorld) {
    // Before each step
});` : ''}

${code.includes('[AfterStep]') ? `AfterStep(async function (this: ICustomWorld) {
    // After each step
});` : ''}`;
  
  return { converted: converted.replace(/\n{3,}/g, '\n\n'), warnings, hooksConverted };
}

function convertPageObject(code: string): { converted: string; warnings: string[] } {
  const warnings: string[] = [];
  
  const classMatch = code.match(/(?:public\s+)?class\s+(\w+)/);
  const className = classMatch ? classMatch[1] : 'PageObject';
  
  const propertyRegex = /private\s+(?:readonly\s+)?IWebElement\s+(\w+)\s*=>\s*[^;]+By\.(?:Id|Name|ClassName|CssSelector|XPath)\("([^"]+)"\)[^;]*;/g;
  const properties: { name: string; selector: string; locatorType: string }[] = [];
  
  let propMatch;
  while ((propMatch = propertyRegex.exec(code)) !== null) {
    const [fullMatch, name, selector] = propMatch;
    let locatorType = 'css';
    if (fullMatch.includes('By.Id')) {
      locatorType = 'id';
    } else if (fullMatch.includes('By.ClassName')) {
      locatorType = 'class';
    } else if (fullMatch.includes('By.XPath')) {
      locatorType = 'xpath';
    }
    properties.push({ name, selector, locatorType });
  }
  
  const methodRegex = /public\s+(?:async\s+)?(?:Task<)?(\w+)(?:>)?\s+(\w+)\s*\(([^)]*)\)\s*\{([^}]*(?:\{[^}]*\}[^}]*)*)\}/gs;
  const methods: { returnType: string; name: string; params: string; body: string }[] = [];
  
  let methodMatch;
  while ((methodMatch = methodRegex.exec(code)) !== null) {
    const [, returnType, name, params, body] = methodMatch;
    if (name !== className) {
      methods.push({ returnType, name, params, body });
    }
  }
  
  const locatorDeclarations = properties.map(p => {
    let selector = p.selector;
    if (p.locatorType === 'id') selector = `#${p.selector}`;
    else if (p.locatorType === 'class') selector = `.${p.selector}`;
    return `    private readonly ${p.name.charAt(0).toLowerCase() + p.name.slice(1)}: Locator;`;
  }).join('\n');
  
  const locatorAssignments = properties.map(p => {
    let selector = p.selector;
    if (p.locatorType === 'id') selector = `#${p.selector}`;
    else if (p.locatorType === 'class') selector = `.${p.selector}`;
    return `        this.${p.name.charAt(0).toLowerCase() + p.name.slice(1)} = page.locator('${selector}');`;
  }).join('\n');
  
  const convertedMethods = methods.map(m => {
    const tsReturnType = TYPE_MAPPINGS[m.returnType] || 'void';
    const methodName = m.name.charAt(0).toLowerCase() + m.name.slice(1);
    
    let tsParams = '';
    if (m.params.trim()) {
      const params = m.params.split(',').map(p => {
        const parts = p.trim().split(' ');
        if (parts.length >= 2) {
          const csharpType = parts[0];
          const name = parts[parts.length - 1];
          const tsType = TYPE_MAPPINGS[csharpType] || 'any';
          return `${name}: ${tsType}`;
        }
        return p;
      });
      tsParams = params.join(', ');
    }
    
    const convertedBody = convertMethodBody(m.body);
    
    return `    async ${methodName}(${tsParams}): Promise<${tsReturnType === 'void' ? 'void' : tsReturnType}> {${convertedBody}    }`;
  }).join('\n\n');
  
  const converted = `import { Page, Locator, expect } from '@playwright/test';

export class ${className} {
    private readonly page: Page;
${locatorDeclarations}

    constructor(page: Page) {
        this.page = page;
${locatorAssignments}
    }

${convertedMethods}
}`;
  
  return { converted, warnings };
}

export function migrateCode(code: string, fileTypeHint?: string): MigrationResult {
  const fileType = detectFileType(code, fileTypeHint);
  const warnings: string[] = [];
  const errors: string[] = [];
  const stats = {
    locatorsConverted: 0,
    actionsConverted: 0,
    assertionsConverted: 0,
    hooksConverted: 0,
    stepsConverted: 0,
  };
  
  let convertedCode = '';
  
  try {
    switch (fileType) {
      case 'alreadyPlaywright': {
        warnings.push('This code is already in Playwright/Cucumber.js format - no migration needed!');
        warnings.push('This migration tool converts Selenium C# (SpecFlow/NUnit) to Playwright TypeScript.');
        warnings.push('Your code already uses @playwright/test or @cucumber/cucumber.');
        return {
          success: true,
          fileType: 'unknown',
          convertedCode: code,
          warnings,
          errors: [],
          stats,
        };
      }
      case 'feature': {
        const result = convertFeatureFile(code);
        convertedCode = result.converted;
        warnings.push(...result.warnings);
        break;
      }
      case 'stepDefinition': {
        const result = convertStepDefinition(code);
        convertedCode = result.converted;
        warnings.push(...result.warnings);
        stats.stepsConverted = result.stepsConverted;
        break;
      }
      case 'hooks': {
        const result = convertHooks(code);
        convertedCode = result.converted;
        warnings.push(...result.warnings);
        stats.hooksConverted = result.hooksConverted;
        break;
      }
      case 'pageObject': {
        const result = convertPageObject(code);
        convertedCode = result.converted;
        warnings.push(...result.warnings);
        break;
      }
      default:
        errors.push('Unable to detect file type. Please ensure the code follows SpecFlow/Selenium conventions (e.g., [Binding], [Given], [When], [Then] attributes).');
        convertedCode = code;
    }
    
    for (const [pattern] of LOCATOR_MAPPINGS) {
      const matches = code.match(pattern);
      if (matches) stats.locatorsConverted += matches.length;
    }
    for (const [pattern] of ACTION_MAPPINGS) {
      const matches = code.match(pattern);
      if (matches) stats.actionsConverted += matches.length;
    }
    for (const [pattern] of ASSERTION_MAPPINGS) {
      const matches = code.match(pattern);
      if (matches) stats.assertionsConverted += matches.length;
    }
    
  } catch (error: any) {
    errors.push(`Migration error: ${error.message}`);
    convertedCode = code;
  }
  
  return {
    success: errors.length === 0,
    fileType,
    originalCode: code,
    convertedCode,
    warnings,
    errors,
    stats,
  };
}

export function generateProjectStructure(): ProjectMigrationResult['files'] {
  return {
    stepDefinitions: [],
    pageObjects: [],
    features: [],
    support: [
      {
        name: 'custom-world.ts',
        code: `import { World, IWorldOptions, setWorldConstructor } from '@cucumber/cucumber';
import { BrowserContext, Page } from '@playwright/test';

export interface ICustomWorld extends World {
    context?: BrowserContext;
    page?: Page;
    scenarioData: Record<string, any>;
    featureData: Record<string, any>;
}

export class CustomWorld extends World implements ICustomWorld {
    context?: BrowserContext;
    page?: Page;
    scenarioData: Record<string, any> = {};
    featureData: Record<string, any> = {};

    constructor(options: IWorldOptions) {
        super(options);
    }
}

setWorldConstructor(CustomWorld);`
      },
      {
        name: 'hooks.ts',
        code: `import { Before, After, BeforeAll, AfterAll, Status } from '@cucumber/cucumber';
import { chromium, Browser } from '@playwright/test';
import { ICustomWorld } from './custom-world';

let browser: Browser;

BeforeAll(async function () {
    browser = await chromium.launch({
        headless: true,
        args: ['--start-maximized']
    });
});

AfterAll(async function () {
    await browser.close();
});

Before(async function (this: ICustomWorld) {
    this.context = await browser.newContext({
        viewport: { width: 1920, height: 1080 }
    });
    this.page = await this.context.newPage();
});

After(async function (this: ICustomWorld, scenario) {
    if (scenario.result?.status === Status.FAILED && this.page) {
        const screenshot = await this.page.screenshot();
        this.attach(screenshot, 'image/png');
    }
    await this.page?.close();
    await this.context?.close();
});`
      }
    ],
    config: [
      {
        name: 'cucumber.js',
        code: `module.exports = {
    default: {
        require: ['./step-definitions/**/*.ts', './support/**/*.ts'],
        requireModule: ['ts-node/register'],
        format: [
            'progress-bar',
            'html:reports/cucumber-report.html',
            'json:reports/cucumber-report.json'
        ],
        formatOptions: { snippetInterface: 'async-await' },
        publishQuiet: true
    }
};`
      },
      {
        name: 'playwright.config.ts',
        code: `import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
    testDir: './features',
    timeout: 30000,
    retries: 1,
    workers: 1,
    reporter: [
        ['list'],
        ['html', { outputFolder: 'playwright-report' }]
    ],
    use: {
        headless: true,
        viewport: { width: 1920, height: 1080 },
        screenshot: 'only-on-failure',
        video: 'retain-on-failure',
        trace: 'retain-on-failure',
    },
    projects: [
        {
            name: 'chromium',
            use: { ...devices['Desktop Chrome'] },
        },
    ],
});`
      },
      {
        name: 'package.json',
        code: `{
  "name": "playwright-bdd-project",
  "version": "1.0.0",
  "scripts": {
    "test": "cucumber-js",
    "test:parallel": "cucumber-js --parallel 4",
    "report": "open reports/cucumber-report.html"
  },
  "devDependencies": {
    "@cucumber/cucumber": "^10.0.0",
    "@playwright/test": "^1.40.0",
    "@types/node": "^20.0.0",
    "ts-node": "^10.9.0",
    "typescript": "^5.0.0"
  }
}`
      },
      {
        name: 'tsconfig.json',
        code: `{
  "compilerOptions": {
    "target": "ES2022",
    "module": "commonjs",
    "lib": ["ES2022"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "outDir": "./dist",
    "rootDir": ".",
    "resolveJsonModule": true,
    "declaration": true
  },
  "include": ["**/*.ts"],
  "exclude": ["node_modules", "dist"]
}`
      }
    ]
  };
}

export function generateSampleCSharpCode(): { stepDefinition: string; hooks: string; pageObject: string; feature: string } {
  return {
    stepDefinition: `using TechTalk.SpecFlow;
using OpenQA.Selenium;
using NUnit.Framework;

[Binding]
public class LoginSteps
{
    private readonly IWebDriver _driver;
    private readonly ScenarioContext _scenarioContext;
    
    public LoginSteps(IWebDriver driver, ScenarioContext scenarioContext)
    {
        _driver = driver;
        _scenarioContext = scenarioContext;
    }
    
    [Given(@"I am on the login page")]
    public void GivenIAmOnTheLoginPage()
    {
        _driver.Navigate().GoToUrl("https://example.com/login");
    }
    
    [When(@"I enter username ""(.*)""")]
    public void WhenIEnterUsername(string username)
    {
        _driver.FindElement(By.Id("username")).SendKeys(username);
    }
    
    [When(@"I enter password ""(.*)""")]
    public void WhenIEnterPassword(string password)
    {
        _driver.FindElement(By.Id("password")).SendKeys(password);
    }
    
    [When(@"I click the login button")]
    public void WhenIClickTheLoginButton()
    {
        _driver.FindElement(By.XPath("//button[@type='submit']")).Click();
    }
    
    [Then(@"I should see the dashboard")]
    public void ThenIShouldSeeTheDashboard()
    {
        var dashboard = _driver.FindElement(By.ClassName("dashboard"));
        Assert.IsTrue(dashboard.Displayed);
    }
    
    [Then(@"I should see welcome message ""(.*)""")]
    public void ThenIShouldSeeWelcomeMessage(string message)
    {
        var welcomeText = _driver.FindElement(By.CssSelector(".welcome-msg")).Text;
        Assert.AreEqual(message, welcomeText);
    }
}`,
    hooks: `using TechTalk.SpecFlow;
using OpenQA.Selenium;
using OpenQA.Selenium.Chrome;

[Binding]
public class Hooks
{
    private readonly IWebDriver _driver;
    private readonly ScenarioContext _scenarioContext;
    
    public Hooks(ScenarioContext scenarioContext)
    {
        _scenarioContext = scenarioContext;
    }
    
    [BeforeFeature]
    public static void BeforeFeature()
    {
        // Feature setup
    }
    
    [AfterFeature]
    public static void AfterFeature()
    {
        // Feature teardown
    }
    
    [BeforeScenario]
    public void BeforeScenario()
    {
        // Setup browser
    }
    
    [AfterScenario]
    public void AfterScenario()
    {
        if (_scenarioContext.TestError != null)
        {
            // Take screenshot on failure
        }
        _driver?.Quit();
    }
    
    [BeforeStep]
    public void BeforeStep()
    {
        // Before each step
    }
    
    [AfterStep]
    public void AfterStep()
    {
        // After each step
    }
}`,
    pageObject: `using OpenQA.Selenium;
using OpenQA.Selenium.Support.UI;

public class LoginPage
{
    private readonly IWebDriver _driver;
    private readonly WebDriverWait _wait;
    
    private IWebElement UsernameInput => _driver.FindElement(By.Id("username"));
    private IWebElement PasswordInput => _driver.FindElement(By.Id("password"));
    private IWebElement LoginButton => _driver.FindElement(By.XPath("//button[@type='submit']"));
    private IWebElement ErrorMessage => _driver.FindElement(By.ClassName("error-message"));
    
    public LoginPage(IWebDriver driver)
    {
        _driver = driver;
        _wait = new WebDriverWait(driver, TimeSpan.FromSeconds(10));
    }
    
    public void EnterUsername(string username)
    {
        UsernameInput.Clear();
        UsernameInput.SendKeys(username);
    }
    
    public void EnterPassword(string password)
    {
        PasswordInput.Clear();
        PasswordInput.SendKeys(password);
    }
    
    public DashboardPage ClickLogin()
    {
        LoginButton.Click();
        return new DashboardPage(_driver);
    }
    
    public string GetErrorMessage()
    {
        return ErrorMessage.Text;
    }
    
    public bool IsErrorDisplayed()
    {
        return ErrorMessage.Displayed;
    }
}`,
    feature: `@login
Feature: User Login
    As a registered user
    I want to be able to login
    So that I can access my account
    
    Background:
        Given I am on the login page
    
    @smoke @critical
    Scenario: Successful login with valid credentials
        When I enter username "admin"
        And I enter password "admin123"
        And I click the login button
        Then I should see the dashboard
        And I should see welcome message "Welcome, Admin!"
    
    @negative
    Scenario: Login with invalid credentials
        When I enter username "invalid"
        And I enter password "wrong"
        And I click the login button
        Then I should see error message "Invalid credentials"
    
    @ignore
    Scenario Outline: Login with multiple credentials
        When I enter username "<username>"
        And I enter password "<password>"
        And I click the login button
        Then I should see "<result>"
        
        Examples:
            | username | password  | result              |
            | admin    | admin123  | Dashboard           |
            | user     | user123   | Dashboard           |
            | blocked  | blocked123| Account is blocked  |`
  };
}
