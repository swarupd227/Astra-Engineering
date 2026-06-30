import { qeAnthropicClient as anthropic } from './ai-client.js';
import pLimit from "p-limit";
import type { DOMStructure } from "./enhanced-crawler";
import type { DiscoveredWorkflow as CrawlWorkflow } from "./crawl-orchestrator";
const limit = pLimit(3);

export interface GeneratedScript {
  fileName: string;
  filePath: string;
  content: string;
  scriptType: "pom_class" | "bdd_feature" | "bdd_step_defs" | "playwright_config" | "cucumber_config";
  pageUrl?: string;
}

export interface ScriptGenerationConfig {
  pattern: "POM" | "BDD" | "both";
  targetUrl: string;
  pages: DOMStructure[];
  workflows: CrawlWorkflow[];
  domain?: string;
  projectName?: string;
}

function pageUrlToClassName(url: string): string {
  try {
    const path = new URL(url).pathname;
    if (path === "/" || path === "") return "HomePage";
    const parts = path.split("/").filter(Boolean);
    return parts
      .map(p => p.charAt(0).toUpperCase() + p.slice(1).replace(/[-_](.)/g, (_, c) => c.toUpperCase()))
      .join("") + "Page";
  } catch {
    return "UnknownPage";
  }
}

function pageUrlToFileName(url: string, ext: string): string {
  try {
    const path = new URL(url).pathname;
    if (path === "/" || path === "") return `home${ext}`;
    const parts = path.split("/").filter(Boolean);
    const last = parts[parts.length - 1] || "home";
    return `${last.replace(/[^a-z0-9]/gi, "-").toLowerCase()}${ext}`;
  } catch {
    return `page${ext}`;
  }
}

async function generatePOMClass(page: DOMStructure, baseUrl: string): Promise<string> {
  const className = pageUrlToClassName(page.url);
  const inputsPreview = JSON.stringify(
    page.interactiveElements.inputs.slice(0, 10).map(i => ({
      type: i.type, name: i.name, label: i.label, selector: i.selector,
    })),
    null, 2
  );
  const buttonsPreview = JSON.stringify(
    page.interactiveElements.buttons.slice(0, 10).map(b => ({
      text: b.text, selector: b.selector, ariaLabel: b.ariaLabel,
    })),
    null, 2
  );
  const formsPreview = JSON.stringify(
    page.forms.slice(0, 3).map(f => ({
      method: f.method, fields: f.fields.slice(0, 6), submitButton: f.submitButton,
    })),
    null, 2
  );

  const prompt = `Generate a complete Playwright Page Object Model class in TypeScript for this page.

PAGE URL: ${page.url}
PAGE TITLE: ${page.title}
BASE URL: ${baseUrl}
CLASS NAME: ${className}

INPUTS (${page.interactiveElements.inputs.length} total, showing first 10):
${inputsPreview}

BUTTONS (${page.interactiveElements.buttons.length} total, showing first 10):
${buttonsPreview}

FORMS (${page.forms.length} total, showing first 3):
${formsPreview}

REQUIREMENTS:
1. Import from '@playwright/test': Page, Locator, expect
2. Class name MUST be: ${className}
3. Constructor takes: page: Page
4. Add readonly Locator for EVERY interactive element found above
5. Locator priority: data-testid > aria-label > #id > [name="..."] > text content
6. Group elements into meaningful action methods (e.g., async login(user, pass))
7. Add a navigate() method using the relative path
8. Add JSDoc comments on each method
9. Export as: export class ${className}

Output ONLY the TypeScript code. No markdown fences. No explanation.`;

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-5",
    max_tokens: 2000,
    messages: [{ role: "user", content: prompt }],
  });

  return (response.content[0] as any).text?.trim() ?? `// Failed to generate POM for ${page.url}`;
}

async function generateBDDFeatureFile(page: DOMStructure, pageWorkflows: CrawlWorkflow[]): Promise<string> {
  const workflowsPreview = JSON.stringify(
    pageWorkflows.slice(0, 3).map(wf => ({
      name: wf.name, type: wf.type,
      steps: wf.steps.slice(0, 4).map(s => ({ action: s.action, description: s.description })),
    })),
    null, 2
  );
  const formsSummary = page.forms.map(f =>
    `Form with fields: ${f.fields.map(fi => fi.label || fi.name || fi.type).join(", ")}`
  ).join("; ");

  const prompt = `Generate a Gherkin BDD feature file for this web page.

PAGE URL: ${page.url}
PAGE TITLE: ${page.title}
FORMS: ${formsSummary || "None"}
WORKFLOWS: ${workflowsPreview}

REQUIREMENTS:
1. Feature name should describe what this page does
2. Use Background: for common setup (navigation to this page)
3. Write 3-4 Scenarios: happy path, validation error, edge case
4. Steps must be parameterized with {string} where values vary
5. All steps must be implementable with Playwright
6. Use only elements that actually exist on this page

Output ONLY the Gherkin. No markdown fences. No explanation.`;

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-5",
    max_tokens: 1500,
    messages: [{ role: "user", content: prompt }],
  });

  return (response.content[0] as any).text?.trim() ?? `# Failed to generate feature for ${page.url}`;
}

async function generateStepDefinitions(featureContent: string, page: DOMStructure, className: string): Promise<string> {
  const inputsPreview = JSON.stringify(
    page.interactiveElements.inputs.slice(0, 8).map(i => ({ type: i.type, selector: i.selector, label: i.label })),
    null, 2
  );

  const prompt = `Generate Playwright + Cucumber step definitions for this BDD feature file.

FEATURE FILE:
${featureContent}

PAGE CLASS: ${className}
INPUTS: ${inputsPreview}

REQUIREMENTS:
1. Import: Given, When, Then from '@cucumber/cucumber'
2. Import: expect from '@playwright/test'
3. Import the Page Object class: import { ${className} } from '../pages/${className}'
4. Use this.page for the Playwright page (available from World context)
5. Implement EVERY step mentioned in the feature file
6. For each step, use the matching Page Object locators
7. Add error handling with clear messages
8. Export nothing — just define the steps

Output ONLY TypeScript code. No markdown. No explanation.`;

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-5",
    max_tokens: 2000,
    messages: [{ role: "user", content: prompt }],
  });

  return (response.content[0] as any).text?.trim() ?? `// Failed to generate step defs for ${page.url}`;
}

function generatePlaywrightConfig(baseUrl: string): string {
  return `import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [['html'], ['list']],
  use: {
    baseURL: '${baseUrl}',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'on-first-retry',
    headless: true,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
  ],
});
`;
}

function generateCucumberConfig(): string {
  return `const common = {
  paths: ['features/**/*.feature'],
  require: ['step-definitions/**/*.ts'],
  requireModule: ['ts-node/register'],
  format: [
    'progress-bar',
    'html:reports/cucumber-report.html',
    'json:reports/cucumber-results.json'
  ],
  formatOptions: { snippetInterface: 'async-await' },
};

module.exports = { default: common };
`;
}

function generatePlaywrightPackageJson(projectName: string): string {
  return JSON.stringify({
    name: projectName.toLowerCase().replace(/[^a-z0-9]/g, "-"),
    version: "1.0.0",
    scripts: {
      test: "playwright test",
      "test:headed": "playwright test --headed",
      "test:debug": "playwright test --debug",
      "test:cucumber": "cucumber-js",
      report: "playwright show-report"
    },
    dependencies: {
      "@playwright/test": "^1.40.0",
      "@cucumber/cucumber": "^10.0.0",
      "ts-node": "^10.9.0",
      "typescript": "^5.0.0"
    },
    devDependencies: {
      "@types/node": "^20.0.0"
    }
  }, null, 2);
}

function generateTsConfig(): string {
  return JSON.stringify({
    compilerOptions: {
      target: "ES2020",
      module: "commonjs",
      moduleResolution: "node",
      strict: true,
      esModuleInterop: true,
      outDir: "dist",
      rootDir: ".",
    },
    include: ["**/*.ts"],
    exclude: ["node_modules", "dist"]
  }, null, 2);
}

export async function generateAutomationScripts(
  config: ScriptGenerationConfig,
  onProgress?: (message: string, current: number, total: number) => void
): Promise<GeneratedScript[]> {
  const scripts: GeneratedScript[] = [];
  const { pattern, targetUrl, pages, workflows, projectName = "playwright-tests" } = config;

  // Only process pages with meaningful content (have inputs or buttons)
  const meaningfulPages = pages.filter(p =>
    p.interactiveElements.inputs.length > 0 ||
    p.interactiveElements.buttons.length > 0 ||
    p.forms.length > 0
  ).slice(0, 15); // Max 15 pages

  const total = meaningfulPages.length * (pattern === "both" ? 3 : pattern === "POM" ? 1 : 2) + 2;
  let current = 0;

  // Config files (no AI)
  scripts.push({
    fileName: "playwright.config.ts",
    filePath: "playwright.config.ts",
    content: generatePlaywrightConfig(targetUrl),
    scriptType: "playwright_config",
  });

  if (pattern === "BDD" || pattern === "both") {
    scripts.push({
      fileName: "cucumber.config.js",
      filePath: "cucumber.config.js",
      content: generateCucumberConfig(),
      scriptType: "cucumber_config",
    });
  }

  scripts.push({
    fileName: "package.json",
    filePath: "package.json",
    content: generatePlaywrightPackageJson(projectName),
    scriptType: "playwright_config",
  });

  scripts.push({
    fileName: "tsconfig.json",
    filePath: "tsconfig.json",
    content: generateTsConfig(),
    scriptType: "playwright_config",
  });

  // Generate page-specific scripts
  const tasks = meaningfulPages.map(page => limit(async () => {
    const className = pageUrlToClassName(page.url);
    const baseName = pageUrlToFileName(page.url, "");
    const pageWorkflows = workflows.filter(wf => wf.entryPoint === page.url);

    if (pattern === "POM" || pattern === "both") {
      current++;
      onProgress?.(`Generating POM class for ${page.title || baseName}...`, current, total);
      const pomContent = await generatePOMClass(page, targetUrl);
      scripts.push({
        fileName: `${className}.ts`,
        filePath: `pages/${className}.ts`,
        content: pomContent,
        scriptType: "pom_class",
        pageUrl: page.url,
      });
    }

    if (pattern === "BDD" || pattern === "both") {
      current++;
      onProgress?.(`Generating BDD feature for ${page.title || baseName}...`, current, total);
      const featureContent = await generateBDDFeatureFile(page, pageWorkflows);
      scripts.push({
        fileName: `${baseName}.feature`,
        filePath: `features/${baseName}.feature`,
        content: featureContent,
        scriptType: "bdd_feature",
        pageUrl: page.url,
      });

      current++;
      onProgress?.(`Generating step definitions for ${page.title || baseName}...`, current, total);
      const stepContent = await generateStepDefinitions(featureContent, page, className);
      scripts.push({
        fileName: `${baseName}.steps.ts`,
        filePath: `step-definitions/${baseName}.steps.ts`,
        content: stepContent,
        scriptType: "bdd_step_defs",
        pageUrl: page.url,
      });
    }
  }));

  await Promise.all(tasks);

  onProgress?.("Script generation complete!", total, total);
  return scripts;
}
