/**
 * Rule-based framework parser for Java, TypeScript, and JavaScript files.
 * Extracts function/method signatures, class context, and classifies them by category.
 * No AI/API calls — pure regex and string parsing only.
 */

export interface ParsedParameter {
  name: string;
  type: string;
}

export interface ParsedFunction {
  name: string;
  signature: string;
  description: string;
  category: string;
  returnType: string;
  parameters: ParsedParameter[];
  sourceFile: string;
  className?: string;      // e.g. "LoginPage", "NavigationHelper"
  importPath?: string;     // e.g. "com.company.pages.LoginPage" or "./pages/LoginPage"
}

// ---------------------------------------------------------------------------
// Category classification
// ---------------------------------------------------------------------------
const CATEGORY_PATTERNS: Record<string, RegExp> = {
  navigation: /^(navigate|go|open|load|visit|launch|switchTo|gotoPage|goBack|goForward|clickMenu|clickTab|navTo|browseToPage)/i,
  assertion:  /^(verify|assert|check|validate|expect|should|confirm|assertThat|assertEquals|assertTrue|assertFalse|assertNull|assertNotNull|assertContains)/i,
  generic:    /^(click|type|fill|enter|select|wait|scroll|hover|clear|find|drag|drop|focus|blur|press|submit|upload|download|move)/i,
  setup:      /^(login|logout|setup|init|before|after|create|delete|register|auth|signIn|signOut|teardown|clean|reset|startSession|endSession)/i,
  data:       /^(data|read|write|store|save|fetch|loadData|getData|setData|getValue|setValue|parseData|extractData|buildData|generateData)/i,
};

function classifyCategory(name: string): string {
  for (const [cat, pattern] of Object.entries(CATEGORY_PATTERNS)) {
    if (pattern.test(name)) return cat;
  }
  return "business";
}

// ---------------------------------------------------------------------------
// Skip rules — FIXED: preserve driver/page/element helpers
// ---------------------------------------------------------------------------
const SKIP_NAMES = new Set([
  "toString", "hashCode", "equals", "clone", "finalize",
  "getClass", "notify", "notifyAll", "wait",
  "constructor", "ngOnInit", "ngOnDestroy", "ngAfterViewInit",
  "render", "componentDidMount", "componentWillUnmount",
]);

// Automation-critical helpers that must NOT be skipped despite get/set prefix
const PRESERVE_NAMES = new Set([
  "getDriver", "getPage", "getWebDriver", "getWebElement", "getBrowser",
  "getElement", "getLocator", "getBaseUrl", "getConfig", "getTestData",
  "getLogger", "getTimeout", "getContext", "getFrame", "getWindow",
  "setDriver", "setPage", "setBaseUrl", "setConfig", "setTimeout",
]);

function shouldSkip(name: string): boolean {
  if (SKIP_NAMES.has(name)) return true;
  if (name.length < 3) return true;
  // Preserve critical automation helpers regardless of get/set pattern
  if (PRESERVE_NAMES.has(name)) return false;
  // Skip plain short getters/setters (getFoo <= 9 chars) but keep longer ones
  if (/^(get|set)[A-Z]/.test(name) && name.length <= 9) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Java parser
// ---------------------------------------------------------------------------

/**
 * Extract Javadoc comment immediately before a line (if any).
 * Returns the text content stripped of * prefixes.
 */
function extractJavadoc(lines: string[], methodLineIndex: number): string {
  let i = methodLineIndex - 1;
  // Skip blank lines
  while (i >= 0 && lines[i].trim() === "") i--;
  if (i < 0) return "";

  const trimmed = lines[i].trim();
  // End of Javadoc block
  if (!trimmed.endsWith("*/")) return "";

  const docLines: string[] = [];
  while (i >= 0) {
    const t = lines[i].trim();
    docLines.unshift(t);
    if (t.startsWith("/**") || t === "/**") break;
    i--;
  }

  return docLines
    .map(l => l.replace(/^\/\*\*/, "").replace(/^\*\//, "").replace(/^\*\s?/, "").trim())
    .filter(l => !l.startsWith("@") && l.length > 0)
    .join(" ")
    .trim();
}

function parseJavaParams(paramStr: string): ParsedParameter[] {
  const raw = paramStr.trim();
  if (!raw) return [];

  const params: ParsedParameter[] = [];
  // Simple split by comma — won't handle generics with commas, but covers most cases
  const parts = raw.split(",");
  for (const part of parts) {
    const tokens = part.trim().split(/\s+/);
    if (tokens.length >= 2) {
      const name = tokens[tokens.length - 1].replace(/\.\.\.$/, ""); // varargs
      const type = tokens.slice(0, tokens.length - 1).join(" ");
      params.push({ name, type });
    } else if (tokens.length === 1 && tokens[0]) {
      params.push({ name: tokens[0], type: "Object" });
    }
  }
  return params;
}

/**
 * Extract class name and package from a Java file.
 * Returns { className, packageName } if found.
 */
function extractJavaClassContext(lines: string[]): { className: string; packageName: string } {
  let packageName = "";
  let className = "";

  for (const line of lines) {
    const t = line.trim();

    // package com.company.pages;
    if (!packageName) {
      const pkgMatch = /^package\s+([\w.]+)\s*;/.exec(t);
      if (pkgMatch) packageName = pkgMatch[1];
    }

    // public class LoginPage extends BasePage {
    // public abstract class BaseHelper implements IHelper {
    if (!className) {
      const classMatch = /(?:public|protected|private)?\s*(?:abstract\s+)?class\s+([A-Za-z_$][A-Za-z0-9_$]*)/.exec(t);
      if (classMatch) { className = classMatch[1]; }
    }

    if (className) break; // stop after first class declaration
  }

  return { className, packageName };
}

/**
 * Main Java method regex:
 * - Access modifier: public or protected
 * - Optional: static, final, synchronized, abstract, native
 * - Return type (may include generics — simplified: non-capturing for <...>)
 * - Method name
 * - Parameter list
 */
const JAVA_METHOD_RE =
  /(?:public|protected)\s+(?:static\s+)?(?:final\s+)?(?:synchronized\s+)?(?:abstract\s+)?([A-Za-z_$][A-Za-z0-9_$<>\[\],\s]*?)\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*\(([^)]*)\)\s*(?:throws\s+[^{;]+)?[{;]/;

export function parseJavaFile(content: string, filename: string): ParsedFunction[] {
  const lines = content.split("\n");
  const results: ParsedFunction[] = [];
  const seen = new Set<string>();

  const { className, packageName } = extractJavaClassContext(lines);
  const importPath = packageName && className ? `${packageName}.${className}` : className || filename;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const match = JAVA_METHOD_RE.exec(line);
    if (!match) continue;

    const returnType = match[1].trim();
    const name = match[2].trim();
    const paramStr = match[3];

    // Skip constructors: if return type equals the class name
    if (returnType === name) continue;
    if (className && returnType === className) continue;
    if (shouldSkip(name)) continue;

    const key = `${name}(${paramStr.trim()})`;
    if (seen.has(key)) continue;
    seen.add(key);

    const parameters = parseJavaParams(paramStr);
    const paramSignature = parameters.map(p => `${p.type} ${p.name}`).join(", ");
    const signature = `${returnType} ${name}(${paramSignature})`;
    const description = extractJavadoc(lines, i);
    const category = classifyCategory(name);

    results.push({
      name, signature, description, category, returnType, parameters,
      sourceFile: filename, className: className || undefined, importPath: importPath || undefined
    });
  }

  return results;
}

// ---------------------------------------------------------------------------
// TypeScript / JavaScript parser
// ---------------------------------------------------------------------------

/**
 * Extract a JSDoc comment above a given line index.
 */
function extractJsDoc(lines: string[], methodLineIndex: number): string {
  let i = methodLineIndex - 1;
  while (i >= 0 && lines[i].trim() === "") i--;
  if (i < 0) return "";

  const trimmed = lines[i].trim();
  if (!trimmed.endsWith("*/")) return "";

  const docLines: string[] = [];
  while (i >= 0) {
    const t = lines[i].trim();
    docLines.unshift(t);
    if (t.startsWith("/**") || t.startsWith("/*")) break;
    i--;
  }

  return docLines
    .map(l => l.replace(/^\/\*\*?/, "").replace(/\*\/$/, "").replace(/^\*\s?/, "").trim())
    .filter(l => !l.startsWith("@") && l.length > 0)
    .join(" ")
    .trim();
}

function parseTsParams(paramStr: string): ParsedParameter[] {
  const raw = paramStr.trim();
  if (!raw) return [];

  const params: ParsedParameter[] = [];
  // Split by comma (naive — won't handle nested generics with commas)
  const parts = raw.split(",");
  for (const part of parts) {
    const p = part.trim().replace(/^\.\.\./, ""); // rest params
    if (!p) continue;
    const colonIdx = p.indexOf(":");
    if (colonIdx !== -1) {
      const name = p.substring(0, colonIdx).trim().replace(/[?]$/, ""); // optional param
      const type = p.substring(colonIdx + 1).trim().replace(/\s*=\s*.+$/, ""); // strip default
      params.push({ name, type: type || "any" });
    } else {
      // No type annotation
      const name = p.split(/\s+/)[0] || p;
      params.push({ name, type: "any" });
    }
  }
  return params;
}

/**
 * Extract class name from a TS/JS file.
 * Returns className and optional module path hint.
 */
function extractTsClassContext(lines: string[], filename: string): { className: string; importPath: string } {
  let className = "";

  for (const line of lines) {
    const t = line.trim();
    // export class LoginPage extends BasePage {
    // class NavigationHelper {
    const classMatch = /(?:export\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][A-Za-z0-9_$]*)/.exec(t);
    if (classMatch) {
      className = classMatch[1];
      break;
    }
  }

  // Derive import path from filename (strip extension, use relative style)
  const base = filename.replace(/\.(ts|tsx|js|jsx)$/i, "");
  const importPath = className ? `./${base}` : base;
  return { className, importPath };
}

// Patterns for TS/JS functions (order matters — most specific first)
const TS_PATTERNS: Array<{ re: RegExp; returnTypeGroup: number; nameGroup: number; paramGroup: number }> = [
  // export function name(params): ReturnType
  {
    re: /export\s+(?:async\s+)?function\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*\(([^)]*)\)\s*(?::\s*([A-Za-z_$][A-Za-z0-9_$<>\[\]|&\s,]*?))?\s*[{]/,
    nameGroup: 1, paramGroup: 2, returnTypeGroup: 3,
  },
  // export const name = (params): ReturnType =>
  {
    re: /export\s+const\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*(?:async\s+)?\(([^)]*)\)\s*(?::\s*([A-Za-z_$][A-Za-z0-9_$<>\[\]|&\s,]*?))?\s*=>/,
    nameGroup: 1, paramGroup: 2, returnTypeGroup: 3,
  },
  // public/protected async? name(params): ReturnType (explicit access modifier class method)
  {
    re: /(?:public|protected)\s+(?:async\s+)?(?:static\s+)?([A-Za-z_$][A-Za-z0-9_$]*)\s*\(([^)]*)\)\s*(?::\s*([A-Za-z_$][A-Za-z0-9_$<>\[\]|&\s,]*?))?\s*[{]/,
    nameGroup: 1, paramGroup: 2, returnTypeGroup: 3,
  },
  // async? name(params): ReturnType { — indented class method WITHOUT access modifier (most common in real TS POM frameworks)
  // The leading whitespace (^\s+) ensures we only match inside a class body, not top-level statements
  {
    re: /^\s+(?:async\s+)([A-Za-z_$][A-Za-z0-9_$]*)\s*\(([^)]*)\)\s*(?::\s*([A-Za-z_$][A-Za-z0-9_$<>\[\]|&\s,]*?))?\s*\{/,
    nameGroup: 1, paramGroup: 2, returnTypeGroup: 3,
  },
  // Non-async indented class method: name(params): ReturnType {
  {
    re: /^\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*\(([^)]*)\)\s*:\s*([A-Za-z_$][A-Za-z0-9_$<>\[\]|&\s,]*?)\s*\{/,
    nameGroup: 1, paramGroup: 2, returnTypeGroup: 3,
  },
  // async name(params): ReturnType { — top-level async function declaration without export
  {
    re: /^(?:async\s+)?function\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*\(([^)]*)\)\s*(?::\s*([A-Za-z_$][A-Za-z0-9_$<>\[\]|&\s,]*?))?\s*[{]/,
    nameGroup: 1, paramGroup: 2, returnTypeGroup: 3,
  },
  // const/let/var name = async (params) => { — non-exported JS/TS arrow function
  {
    re: /^(?:const|let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*(?:async\s+)?\(([^)]*)\)\s*(?::\s*([A-Za-z_$][A-Za-z0-9_$<>\[\]|&\s,]*?))?\s*=>/,
    nameGroup: 1, paramGroup: 2, returnTypeGroup: 3,
  },
  // const/let/var name = async function(params) { — non-exported named function expression
  {
    re: /^(?:const|let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*(?:async\s+)?function\s*\(([^)]*)\)/,
    nameGroup: 1, paramGroup: 2, returnTypeGroup: 3,
  },
  // name: async function(params) { — object method shorthand (e.g. exports.name)
  {
    re: /^\s*([A-Za-z_$][A-Za-z0-9_$]*)\s*:\s*(?:async\s+)?function\s*\(([^)]*)\)/,
    nameGroup: 1, paramGroup: 2, returnTypeGroup: 3,
  },
  // name: async (params) => { — object property arrow function
  {
    re: /^\s*([A-Za-z_$][A-Za-z0-9_$]*)\s*:\s*(?:async\s+)?\(([^)]*)\)\s*=>/,
    nameGroup: 1, paramGroup: 2, returnTypeGroup: 3,
  },
];

export function parseTsJsFile(content: string, filename: string): ParsedFunction[] {
  const lines = content.split("\n");
  const results: ParsedFunction[] = [];
  const seen = new Set<string>();

  const { className, importPath } = extractTsClassContext(lines, filename);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const pattern of TS_PATTERNS) {
      const match = pattern.re.exec(line);
      if (!match) continue;

      const name = match[pattern.nameGroup]?.trim();
      if (!name || shouldSkip(name)) continue;

      const paramStr = match[pattern.paramGroup] ?? "";
      const returnType = (match[pattern.returnTypeGroup] ?? "void").trim() || "void";

      const key = `${name}(${paramStr.trim()})`;
      if (seen.has(key)) continue;
      seen.add(key);

      const parameters = parseTsParams(paramStr);
      const paramSignature = parameters.map(p => `${p.name}: ${p.type}`).join(", ");
      const signature = `${name}(${paramSignature}): ${returnType}`;
      const description = extractJsDoc(lines, i);
      const category = classifyCategory(name);

      results.push({
        name, signature, description, category, returnType, parameters,
        sourceFile: filename, className: className || undefined, importPath: importPath || undefined
      });
      break; // Only match first pattern per line
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// File classification helpers
// ---------------------------------------------------------------------------

/**
 * Returns true if the filename suggests a helper / base / utility class —
 * i.e. a file likely to contain reusable functions worth extracting.
 */
function isHelperFile(filename: string): boolean {
  const lower = filename.toLowerCase();
  const basename = lower.split('/').pop() ?? lower;
  const helperPatterns = [
    'base', 'helper', 'util', 'utils', 'common',
    'shared', 'core', 'support', 'fixture',
    'page-object', 'pageobject', 'pagefactory',
    'driver', 'browser', 'wait', 'action',
    'assertion', 'assert', 'expect',
  ];
  return helperPatterns.some(p => basename.includes(p));
}

/**
 * Returns true if the filename is a test spec / test data file.
 * These files are still parsed for detection signals but their
 * functions are not added to the reusable catalog.
 */
function isSpecFile(filename: string): boolean {
  const lower = filename.toLowerCase();
  return (
    lower.includes('.spec.') ||
    lower.includes('.test.') ||
    lower.includes('_test.') ||
    lower.includes('_spec.') ||
    lower.includes('/test/') ||
    lower.includes('/tests/') ||
    lower.includes('/spec/') ||
    lower.includes('/specs/')
  );
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------
export function parseFrameworkFile(content: string, filename: string): ParsedFunction[] {
  const lower = filename.toLowerCase();

  // Config / data files — not source, skip function extraction
  const noFunctionExts = ['.xml', '.gradle', '.properties', '.json', '.yml', '.yaml', '.feature'];
  if (noFunctionExts.some(ext => lower.endsWith(ext))) return [];

  // Spec / test files — skip function extraction (too noisy; keep for detection only)
  if (isSpecFile(filename)) return [];

  if (lower.endsWith(".java")) return parseJavaFile(content, filename);
  if (lower.endsWith(".ts") || lower.endsWith(".tsx") || lower.endsWith(".js") || lower.endsWith(".jsx")) {
    return parseTsJsFile(content, filename);
  }
  return [];
}

// ---------------------------------------------------------------------------
// Framework intelligence detectors
// ---------------------------------------------------------------------------

/**
 * Detects BDD vs POM by analyzing actual uploaded file content.
 * Falls back to framework name string only if no files provided.
 */
export function detectPattern(
  framework: string,
  uploadedFiles?: Array<{ filename: string; content: string }>
): 'POM' | 'BDD' | 'BDD+POM' {

  if (uploadedFiles && uploadedFiles.length > 0) {
    const hasFeatureFiles = uploadedFiles.some(f =>
      f.filename.endsWith('.feature')
    );
    const hasGherkinSyntax = uploadedFiles.some(f =>
      /^\s*(Feature:|Scenario:|Given |When |Then )/m.test(f.content)
    );
    const hasStepAnnotations = uploadedFiles.some(f =>
      /@Given|@When|@Then|Given\(|When\(|Then\(/.test(f.content)
    );
    const hasCucumberImport = uploadedFiles.some(f =>
      /import.*cucumber|require.*cucumber/i.test(f.content)
    );
    const hasBDD = hasFeatureFiles || hasGherkinSyntax || hasStepAnnotations || hasCucumberImport;

    const hasPageClasses = uploadedFiles.some(f =>
      /class\s+\w+(Page|Screen|PageObject)\b/.test(f.content)
    );
    const hasLocatorFields = uploadedFiles.some(f =>
      /@FindBy|By\.|page\.locator|page\.getByRole/.test(f.content)
    );
    const hasPageObjectPattern = uploadedFiles.some(f =>
      /extends\s+BasePage|PageObject|new\s+\w+(Page|Screen)\(/.test(f.content)
    );
    const hasPOM = hasPageClasses || hasLocatorFields || hasPageObjectPattern;

    if (hasBDD && hasPOM) return 'BDD+POM';
    if (hasBDD) return 'BDD';
    if (hasPOM) return 'POM';
  }

  // Fallback: name-based only when no file content available
  const f = framework.toLowerCase();
  if (f.includes('cucumber') || f.includes('bdd') || f.includes('gherkin')) {
    return 'BDD';
  }
  if (f.includes('pom') || f.includes('page object')) {
    return 'POM';
  }

  return 'POM';
}

/**
 * Detects programming language from uploaded file content.
 * Uses file extensions first, then content signals.
 */
export function detectLanguage(
  uploadedFiles: Array<{ filename: string; content: string }>
): 'java' | 'typescript' | 'javascript' | 'python' | 'csharp' {

  if (!uploadedFiles || uploadedFiles.length === 0) {
    return 'typescript';
  }

  const filenames = uploadedFiles.map(f => f.filename);
  const allContent = uploadedFiles.map(f => f.content).join('\n');

  // File extension — most reliable signal
  if (filenames.some(f => f.endsWith('.java'))) return 'java';
  if (filenames.some(f => f.endsWith('.py'))) return 'python';
  if (filenames.some(f => f.endsWith('.cs'))) return 'csharp';
  if (filenames.some(f => f.endsWith('.ts'))) return 'typescript';
  if (filenames.some(f => f.endsWith('.js'))) return 'javascript';

  // Content signals fallback
  if (/^package\s+[\w.]+;/m.test(allContent)) return 'java';
  if (/^import\s+pytest|def\s+test_/m.test(allContent)) return 'python';
  if (/^using\s+\w+;|namespace\s+\w+/m.test(allContent)) return 'csharp';
  if (/:\s*(string|number|boolean|void)\b/.test(allContent)) {
    return 'typescript';
  }

  return 'javascript';
}

/**
 * Detects test tool/runner from uploaded file content.
 */
export function detectTool(
  uploadedFiles: Array<{ filename: string; content: string }>
): 'selenium' | 'playwright' | 'cypress' | 'testcomplete' | 'webdriverio' | 'unknown' {

  if (!uploadedFiles || uploadedFiles.length === 0) {
    return 'unknown';
  }

  const allContent = uploadedFiles.map(f => f.content).join('\n');

  if (
    /import.*openqa\.selenium|WebDriver\s+\w+|By\.(id|name|css)/m
      .test(allContent)
  ) return 'selenium';

  if (
    /@playwright\/test|import.*playwright|chromium\.launch/m
      .test(allContent)
  ) return 'playwright';

  if (/cy\.visit|cy\.get|Cypress\./m.test(allContent)) {
    return 'cypress';
  }

  if (/NameMapping\.|Aliases\.|Log\.Message/m.test(allContent)) {
    return 'testcomplete';
  }

  if (/browser\.url\(|browser\.\$\(|\$\$\(/m.test(allContent)) {
    return 'webdriverio';
  }

  return 'unknown';
}
