/**
 * Built-in framework presets shown in the Autonomous Testing dropdown.
 *
 * These are virtual catalog entries — they are NOT stored in the database
 * and have no associated uploaded function library. When the user picks one,
 * the script-generation API receives a `frameworkPreset` object (see
 * `/api/autotest/scripts`) that the server uses to build a synthetic
 * `frameworkCtx`, so the generated POM/BDD suite is emitted in the chosen
 * language + tool even though the catalog entry was never uploaded.
 *
 * The default (empty `id`) option remains the implicit Playwright/TypeScript
 * choice for backwards compatibility — only non-default selections forward
 * the preset to the server.
 */

export interface FrameworkPreset {
  id: string;                // stable preset:<slug>
  name: string;              // dropdown label
  framework: string;         // e.g. 'Playwright'
  language: string;          // e.g. 'TypeScript'
  detectedPattern: "POM" | "BDD" | "BDD+POM";
  detectedLanguage:
    | "typescript"
    | "javascript"
    | "java"
    | "python"
    | "csharp";
  detectedTool:
    | "playwright"
    | "cypress"
    | "selenium"
    | "webdriverio"
    | "testcomplete"
    | "unknown";
}

export const FRAMEWORK_PRESETS: FrameworkPreset[] = [
  {
    id: "preset:playwright-ts-pom",
    name: "Playwright + TypeScript (POM)",
    framework: "Playwright",
    language: "TypeScript",
    detectedPattern: "POM",
    detectedLanguage: "typescript",
    detectedTool: "playwright",
  },
  {
    id: "preset:playwright-ts-bdd",
    name: "Playwright + TypeScript (BDD / Cucumber)",
    framework: "Playwright",
    language: "TypeScript",
    detectedPattern: "BDD",
    detectedLanguage: "typescript",
    detectedTool: "playwright",
  },
  {
    id: "preset:playwright-js-pom",
    name: "Playwright + JavaScript (POM)",
    framework: "Playwright",
    language: "JavaScript",
    detectedPattern: "POM",
    detectedLanguage: "javascript",
    detectedTool: "playwright",
  },
  {
    id: "preset:playwright-python-pom",
    name: "Playwright + Python (POM)",
    framework: "Playwright",
    language: "Python",
    detectedPattern: "POM",
    detectedLanguage: "python",
    detectedTool: "playwright",
  },
  {
    id: "preset:cypress-ts-pom",
    name: "Cypress + TypeScript (POM)",
    framework: "Cypress",
    language: "TypeScript",
    detectedPattern: "POM",
    detectedLanguage: "typescript",
    detectedTool: "cypress",
  },
  {
    id: "preset:cypress-js-bdd",
    name: "Cypress + JavaScript (BDD / Cucumber)",
    framework: "Cypress",
    language: "JavaScript",
    detectedPattern: "BDD",
    detectedLanguage: "javascript",
    detectedTool: "cypress",
  },
  {
    id: "preset:selenium-java-pom",
    name: "Selenium + Java (POM)",
    framework: "Selenium",
    language: "Java",
    detectedPattern: "POM",
    detectedLanguage: "java",
    detectedTool: "selenium",
  },
  {
    id: "preset:selenium-java-bdd",
    name: "Selenium + Java (BDD / Cucumber)",
    framework: "Selenium",
    language: "Java",
    detectedPattern: "BDD",
    detectedLanguage: "java",
    detectedTool: "selenium",
  },
  {
    id: "preset:selenium-python-pom",
    name: "Selenium + Python (POM)",
    framework: "Selenium",
    language: "Python",
    detectedPattern: "POM",
    detectedLanguage: "python",
    detectedTool: "selenium",
  },
  {
    id: "preset:selenium-csharp-pom",
    name: "Selenium + C# (POM)",
    framework: "Selenium",
    language: "C#",
    detectedPattern: "POM",
    detectedLanguage: "csharp",
    detectedTool: "selenium",
  },
  {
    id: "preset:webdriverio-ts-pom",
    name: "WebdriverIO + TypeScript (POM)",
    framework: "WebdriverIO",
    language: "TypeScript",
    detectedPattern: "POM",
    detectedLanguage: "typescript",
    detectedTool: "webdriverio",
  },
];

/** True when the given framework selection id refers to a built-in preset. */
export function isPresetId(id: string | null | undefined): boolean {
  return typeof id === "string" && id.startsWith("preset:");
}

export function findPreset(id: string | null | undefined): FrameworkPreset | undefined {
  if (!isPresetId(id)) return undefined;
  return FRAMEWORK_PRESETS.find((p) => p.id === id);
}
