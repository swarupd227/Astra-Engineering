/**
 * AST Parser Service
 * Structural code analysis for C#, JS/TS, Java, Python.
 * Uses comprehensive regex-based extraction with optional web-tree-sitter enhancement.
 * Extracts: imports, exports, function calls, class instantiations, event bindings, attributes.
 */

import * as path from "path";

// ── Interfaces ──────────────────────────────────────────────────

export interface ASTImport {
  source: string;
  names: string[];
  line: number;
  isStatic?: boolean;
}

export interface ASTExport {
  name: string;
  kind: "class" | "function" | "variable" | "interface" | "type" | "enum" | "default" | "method" | "property";
  line: number;
}

export interface ASTFunctionCall {
  caller: string;
  method: string;
  line: number;
  fullExpression: string;
}

export interface ASTClassInstantiation {
  className: string;
  line: number;
}

export interface ASTEventBinding {
  type: string;
  handler: string;
  line: number;
}

export interface ASTAttribute {
  name: string;
  target: string;
  line: number;
}

export interface ASTAnalysis {
  imports: ASTImport[];
  exports: ASTExport[];
  functionCalls: ASTFunctionCall[];
  classInstantiations: ASTClassInstantiation[];
  eventBindings: ASTEventBinding[];
  attributes: ASTAttribute[];
  language: string;
  filePath: string;
}

export type SupportedLanguage = "csharp" | "javascript" | "typescript" | "java" | "python" | "html" | "other";

// ── Language Detection ──────────────────────────────────────────

const EXTENSION_TO_LANGUAGE: Record<string, SupportedLanguage> = {
  ".cs": "csharp", ".cshtml": "csharp", ".razor": "csharp",
  ".js": "javascript", ".jsx": "javascript", ".mjs": "javascript", ".cjs": "javascript",
  ".ts": "typescript", ".tsx": "typescript",
  ".java": "java", ".kt": "java",
  ".py": "python",
  ".html": "html", ".htm": "html",
  ".vue": "javascript", ".svelte": "javascript",
};

export function detectLanguage(filePath: string): SupportedLanguage {
  const ext = path.extname(filePath).toLowerCase();
  return EXTENSION_TO_LANGUAGE[ext] || "other";
}

// ── Main API ────────────────────────────────────────────────────

export function parseFile(filePath: string, content: string): ASTAnalysis {
  const language = detectLanguage(filePath);
  const lines = content.split("\n");

  const analysis: ASTAnalysis = {
    imports: [],
    exports: [],
    functionCalls: [],
    classInstantiations: [],
    eventBindings: [],
    attributes: [],
    language,
    filePath,
  };

  if (language === "other") return analysis;

  const isMixedFile = /\.cshtml$|\.razor$/i.test(filePath);

  switch (language) {
    case "csharp":
      extractCSharpImports(lines, analysis);
      extractCSharpExports(content, analysis);
      extractCSharpFunctionCalls(lines, analysis);
      extractCSharpInstantiations(lines, analysis);
      extractCSharpAttributes(lines, analysis);
      extractCSharpEventBindings(lines, analysis);
      // .cshtml/.razor files also contain HTML with <script src> and <link href>
      if (isMixedFile) {
        extractHTMLEventBindings(lines, analysis);
        extractHTMLAssetImports(lines, analysis);
      }
      break;

    case "javascript":
    case "typescript":
      extractJSTSImports(lines, analysis);
      extractJSTSExports(content, analysis);
      extractJSTSFunctionCalls(lines, analysis);
      extractJSTSInstantiations(lines, analysis);
      extractJSTSEventBindings(lines, analysis);
      extractJSTSAttributes(lines, analysis);
      break;

    case "java":
      extractJavaImports(lines, analysis);
      extractJavaExports(content, analysis);
      extractJavaFunctionCalls(lines, analysis);
      extractJavaInstantiations(lines, analysis);
      extractJavaAttributes(lines, analysis);
      break;

    case "python":
      extractPythonImports(lines, analysis);
      extractPythonExports(content, analysis);
      extractPythonFunctionCalls(lines, analysis);
      extractPythonInstantiations(lines, analysis);
      extractPythonAttributes(lines, analysis);
      break;

    case "html":
      extractHTMLEventBindings(lines, analysis);
      extractHTMLAssetImports(lines, analysis);
      break;
  }

  return analysis;
}

export function parseFiles(files: Array<{ relativePath: string; content: string }>): Map<string, ASTAnalysis> {
  const result = new Map<string, ASTAnalysis>();
  for (const file of files) {
    if (!file.content || file.content.length === 0) continue;
    try {
      result.set(file.relativePath, parseFile(file.relativePath, file.content));
    } catch (err) {
      console.warn(`[ASTParser] Failed to parse ${file.relativePath}:`, err instanceof Error ? err.message : err);
    }
  }
  return result;
}

// ── C# Extractors ───────────────────────────────────────────────

function extractCSharpImports(lines: string[], analysis: ASTAnalysis): void {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // using System.Web; | using static System.Math; | using X = System.IO;
    const usingMatch = line.match(/^using\s+(static\s+)?([\w.]+)(?:\s*=\s*([\w.]+))?\s*;/);
    if (usingMatch) {
      const source = usingMatch[3] || usingMatch[2];
      const names = [source.split(".").pop() || source];
      analysis.imports.push({
        source,
        names,
        line: i + 1,
        isStatic: !!usingMatch[1],
      });
      continue;
    }

    // Razor directives: @using Namespace, @model Type, @inject Type Name
    const razorUsing = line.match(/^@using\s+([\w.]+)/);
    if (razorUsing) {
      analysis.imports.push({
        source: razorUsing[1],
        names: [razorUsing[1].split(".").pop() || razorUsing[1]],
        line: i + 1,
      });
      continue;
    }

    const razorModel = line.match(/^@model\s+([\w.<>,\s]+)/);
    if (razorModel) {
      const modelType = razorModel[1].trim();
      analysis.imports.push({
        source: modelType,
        names: [modelType.split(".").pop()?.split("<")[0] || modelType],
        line: i + 1,
      });
      continue;
    }

    const razorInject = line.match(/^@inject\s+([\w.<>,\s]+)\s+(\w+)/);
    if (razorInject) {
      analysis.imports.push({
        source: razorInject[1].trim(),
        names: [razorInject[2]],
        line: i + 1,
      });
    }
  }
}

function extractCSharpExports(content: string, analysis: ASTAnalysis): void {
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    const classMatch = line.match(/(?:public|internal)\s+(?:partial\s+|abstract\s+|sealed\s+|static\s+)*(?:class|record)\s+(\w+)/);
    if (classMatch) {
      analysis.exports.push({ name: classMatch[1], kind: "class", line: i + 1 });
    }

    const interfaceMatch = line.match(/(?:public|internal)\s+interface\s+(\w+)/);
    if (interfaceMatch) {
      analysis.exports.push({ name: interfaceMatch[1], kind: "interface", line: i + 1 });
    }

    const enumMatch = line.match(/(?:public|internal)\s+enum\s+(\w+)/);
    if (enumMatch) {
      analysis.exports.push({ name: enumMatch[1], kind: "enum", line: i + 1 });
    }

    const structMatch = line.match(/(?:public|internal)\s+(?:readonly\s+)?struct\s+(\w+)/);
    if (structMatch) {
      analysis.exports.push({ name: structMatch[1], kind: "type", line: i + 1 });
    }

    const methodMatch = line.match(/(?:public|protected|internal)\s+(?:static\s+|virtual\s+|override\s+|async\s+|new\s+)*(?:[\w<>\[\]?,\s]+?)\s+(\w+)\s*\(/);
    if (methodMatch && !["class", "interface", "enum", "struct", "if", "for", "while", "switch", "catch", "namespace", "record"].includes(methodMatch[1])) {
      analysis.exports.push({ name: methodMatch[1], kind: "method", line: i + 1 });
    }
  }
}

function extractCSharpFunctionCalls(lines: string[], analysis: ASTAnalysis): void {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.startsWith("//") || line.startsWith("using ")) continue;

    // Static and instance method calls: Type.Method(...), obj.Method(...), await obj.Method(...)
    const callPattern = /(?:await\s+)?(\w[\w.]*?)\.(\w+)\s*\(/g;
    let match;
    while ((match = callPattern.exec(line)) !== null) {
      const caller = match[1];
      const method = match[2];
      if (["if", "for", "while", "switch", "catch", "var", "new", "return", "typeof"].includes(caller)) continue;
      analysis.functionCalls.push({
        caller,
        method,
        line: i + 1,
        fullExpression: `${caller}.${method}()`,
      });
    }

    // Extension method / standalone calls: MethodName(...)
    const standalonePattern = /(?:^|[\s=+(,])(?:await\s+)?([A-Z]\w+)\s*\(/g;
    while ((match = standalonePattern.exec(line)) !== null) {
      const method = match[1];
      if (["If", "For", "While", "Switch", "Catch", "Return", "Throw", "New"].includes(method)) continue;
      if (analysis.functionCalls.some(c => c.line === i + 1 && c.method === method)) continue;
      analysis.functionCalls.push({
        caller: "",
        method,
        line: i + 1,
        fullExpression: `${method}()`,
      });
    }
  }
}

function extractCSharpInstantiations(lines: string[], analysis: ASTAnalysis): void {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const pattern = /new\s+([\w.]+(?:<[^>]+>)?)\s*[\({]/g;
    let match;
    while ((match = pattern.exec(line)) !== null) {
      analysis.classInstantiations.push({
        className: match[1],
        line: i + 1,
      });
    }
  }
}

function extractCSharpAttributes(lines: string[], analysis: ASTAnalysis): void {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const attrPattern = /\[\s*(\w+)(?:\s*\([^)]*\))?\s*\]/g;
    let match;
    while ((match = attrPattern.exec(line)) !== null) {
      const nextLine = (lines[i + 1] || "").trim();
      const targetMatch = nextLine.match(/(?:public|private|protected|internal)\s+.*?(\w+)\s*[({;=]/);
      analysis.attributes.push({
        name: match[1],
        target: targetMatch ? targetMatch[1] : "unknown",
        line: i + 1,
      });
    }
  }
}

function extractCSharpEventBindings(lines: string[], analysis: ASTAnalysis): void {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // event += handler
    const eventMatch = line.match(/(\w+)\s*\+=\s*(?:new\s+\w+\s*\()?\s*(\w+)/);
    if (eventMatch) {
      analysis.eventBindings.push({ type: eventMatch[1], handler: eventMatch[2], line: i + 1 });
    }
  }
}

// ── JS/TS Extractors ────────────────────────────────────────────

function extractJSTSImports(lines: string[], analysis: ASTAnalysis): void {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // ESM: import { X, Y } from 'source'
    const esmNamed = line.match(/import\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"]/);
    if (esmNamed) {
      analysis.imports.push({
        source: esmNamed[2],
        names: esmNamed[1].split(",").map(n => n.trim().split(/\s+as\s+/)[0].trim()).filter(Boolean),
        line: i + 1,
      });
      continue;
    }

    // ESM: import Default from 'source'
    const esmDefault = line.match(/import\s+(\w+)\s+from\s+['"]([^'"]+)['"]/);
    if (esmDefault) {
      analysis.imports.push({ source: esmDefault[2], names: [esmDefault[1]], line: i + 1 });
      continue;
    }

    // ESM: import * as X from 'source'
    const esmStar = line.match(/import\s+\*\s+as\s+(\w+)\s+from\s+['"]([^'"]+)['"]/);
    if (esmStar) {
      analysis.imports.push({ source: esmStar[2], names: [esmStar[1]], line: i + 1 });
      continue;
    }

    // ESM: import Default, { Named } from 'source'
    const esmMixed = line.match(/import\s+(\w+)\s*,\s*\{([^}]+)\}\s+from\s+['"]([^'"]+)['"]/);
    if (esmMixed) {
      const names = [esmMixed[1], ...esmMixed[2].split(",").map(n => n.trim().split(/\s+as\s+/)[0].trim()).filter(Boolean)];
      analysis.imports.push({ source: esmMixed[3], names, line: i + 1 });
      continue;
    }

    // ESM side-effect: import 'source'
    const esmSideEffect = line.match(/^import\s+['"]([^'"]+)['"]\s*;?\s*$/);
    if (esmSideEffect) {
      analysis.imports.push({ source: esmSideEffect[1], names: [], line: i + 1 });
      continue;
    }

    // CJS: const X = require('source')
    const cjs = line.match(/(?:const|let|var)\s+(?:\{([^}]+)\}|(\w+))\s*=\s*require\s*\(\s*['"]([^'"]+)['"]\s*\)/);
    if (cjs) {
      const names = cjs[1]
        ? cjs[1].split(",").map(n => n.trim().split(/\s*:\s*/)[0].trim()).filter(Boolean)
        : [cjs[2]];
      analysis.imports.push({ source: cjs[3], names, line: i + 1 });
    }

    // Dynamic import: import('source')
    const dynamicImport = line.match(/import\s*\(\s*['"]([^'"]+)['"]\s*\)/);
    if (dynamicImport) {
      analysis.imports.push({ source: dynamicImport[1], names: [], line: i + 1 });
    }
  }
}

function extractJSTSExports(content: string, analysis: ASTAnalysis): void {
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    const defaultExport = line.match(/export\s+default\s+(?:class|function\*?|abstract\s+class)?\s*(\w+)?/);
    if (defaultExport) {
      analysis.exports.push({ name: defaultExport[1] || "default", kind: "default", line: i + 1 });
      continue;
    }

    const namedExport = line.match(/export\s+(?:async\s+)?(?:function\*?|class|abstract\s+class|const|let|var|interface|type|enum)\s+(\w+)/);
    if (namedExport) {
      const kw = line.toLowerCase();
      let kind: ASTExport["kind"] = "variable";
      if (kw.includes("function")) kind = "function";
      else if (kw.includes("class")) kind = "class";
      else if (kw.includes("interface")) kind = "interface";
      else if (kw.includes("type ")) kind = "type";
      else if (kw.includes("enum")) kind = "enum";
      analysis.exports.push({ name: namedExport[1], kind, line: i + 1 });
    }

    // module.exports
    const moduleExports = line.match(/module\.exports\s*=\s*(?:\{|(\w+))/);
    if (moduleExports) {
      analysis.exports.push({ name: moduleExports[1] || "module.exports", kind: "default", line: i + 1 });
    }
  }
}

function extractJSTSFunctionCalls(lines: string[], analysis: ASTAnalysis): void {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.startsWith("//") || line.startsWith("*") || line.startsWith("import ") || line.startsWith("export ")) continue;

    // Method calls: obj.method(), $.fn(), this.method()
    const callPattern = /(\$|[\w]+(?:\.[\w]+)*)\.(\w+)\s*\(/g;
    let match;
    while ((match = callPattern.exec(line)) !== null) {
      const caller = match[1];
      const method = match[2];
      if (["if", "for", "while", "switch", "catch", "function", "return", "var", "let", "const", "new", "typeof"].includes(caller)) continue;
      analysis.functionCalls.push({
        caller,
        method,
        line: i + 1,
        fullExpression: `${caller}.${method}()`,
      });
    }

    // jQuery selector calls: $(...).method()
    const jqueryPattern = /\$\s*\([^)]*\)\s*\.(\w+)\s*\(/g;
    while ((match = jqueryPattern.exec(line)) !== null) {
      analysis.functionCalls.push({
        caller: "$",
        method: match[1],
        line: i + 1,
        fullExpression: `$().${match[1]}()`,
      });
    }

    // Top-level function calls: fetch(), require(), setTimeout()
    const topLevelPattern = /(?:^|[\s=+(,!])(?:await\s+)?(fetch|setTimeout|setInterval|clearTimeout|clearInterval|alert|confirm|prompt|console\.(?:log|warn|error|info))\s*\(/g;
    while ((match = topLevelPattern.exec(line)) !== null) {
      const parts = match[1].split(".");
      analysis.functionCalls.push({
        caller: parts.length > 1 ? parts[0] : "",
        method: parts.length > 1 ? parts[1] : parts[0],
        line: i + 1,
        fullExpression: `${match[1]}()`,
      });
    }
  }
}

function extractJSTSInstantiations(lines: string[], analysis: ASTAnalysis): void {
  for (let i = 0; i < lines.length; i++) {
    const pattern = /new\s+([\w.]+(?:<[^>]+>)?)\s*\(/g;
    let match;
    while ((match = pattern.exec(lines[i])) !== null) {
      analysis.classInstantiations.push({ className: match[1], line: i + 1 });
    }
  }
}

function extractJSTSEventBindings(lines: string[], analysis: ASTAnalysis): void {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // addEventListener('event', handler)
    const addListenerMatch = line.match(/\.addEventListener\s*\(\s*['"](\w+)['"]\s*,\s*(\w+|function|\()/);
    if (addListenerMatch) {
      analysis.eventBindings.push({ type: addListenerMatch[1], handler: addListenerMatch[2], line: i + 1 });
    }

    // jQuery .on('event', handler), .click(handler), .submit(handler)
    const jqueryEventPattern = /\.\s*(on|click|dblclick|mousedown|mouseup|mouseover|mouseout|mouseenter|mouseleave|keydown|keyup|keypress|focus|blur|change|submit|scroll|resize|load|ready)\s*\(/g;
    let match;
    while ((match = jqueryEventPattern.exec(line)) !== null) {
      const method = match[1];
      let eventType = method;
      if (method === "on") {
        const eventArg = line.slice(match.index).match(/\.on\s*\(\s*['"](\w+)['"]/);
        if (eventArg) eventType = eventArg[1];
      }
      analysis.eventBindings.push({ type: eventType, handler: method, line: i + 1 });
    }

    // onclick, onchange, etc. (inline event handlers in JSX/HTML-in-JS)
    const inlineEventPattern = /\b(on[A-Z]\w+)\s*=\s*\{?\s*(\w+)/g;
    while ((match = inlineEventPattern.exec(line)) !== null) {
      analysis.eventBindings.push({ type: match[1], handler: match[2], line: i + 1 });
    }

    // window.location assignments
    if (/window\.location\s*[=.]/.test(line)) {
      analysis.eventBindings.push({ type: "navigation", handler: "window.location", line: i + 1 });
    }

    // form.submit()
    if (/\.submit\s*\(\s*\)/.test(line)) {
      analysis.eventBindings.push({ type: "submit", handler: "form.submit", line: i + 1 });
    }
  }
}

function extractJSTSAttributes(lines: string[], analysis: ASTAnalysis): void {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    // TypeScript/JS decorators: @Component, @Injectable, @Decorator()
    const decoratorMatch = line.match(/^@(\w+)(?:\s*\()?/);
    if (decoratorMatch) {
      const nextLine = (lines[i + 1] || "").trim();
      const targetMatch = nextLine.match(/(?:export\s+)?(?:class|function|const|let|var)\s+(\w+)/);
      analysis.attributes.push({
        name: decoratorMatch[1],
        target: targetMatch ? targetMatch[1] : "unknown",
        line: i + 1,
      });
    }

    // data-* attributes in JSX
    const dataAttrPattern = /data-([\w-]+)\s*=\s*["'{]/g;
    let match;
    while ((match = dataAttrPattern.exec(line)) !== null) {
      analysis.attributes.push({ name: `data-${match[1]}`, target: "element", line: i + 1 });
    }
  }
}

// ── Java Extractors ─────────────────────────────────────────────

function extractJavaImports(lines: string[], analysis: ASTAnalysis): void {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const importMatch = line.match(/^import\s+(static\s+)?([\w.*]+)\s*;/);
    if (importMatch) {
      const source = importMatch[2];
      const parts = source.split(".");
      const name = parts[parts.length - 1];
      analysis.imports.push({
        source,
        names: [name],
        line: i + 1,
        isStatic: !!importMatch[1],
      });
    }
  }
}

function extractJavaExports(content: string, analysis: ASTAnalysis): void {
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    const classMatch = line.match(/(?:public|protected)\s+(?:abstract\s+|final\s+|static\s+)*class\s+(\w+)/);
    if (classMatch) {
      analysis.exports.push({ name: classMatch[1], kind: "class", line: i + 1 });
    }

    const interfaceMatch = line.match(/(?:public|protected)\s+interface\s+(\w+)/);
    if (interfaceMatch) {
      analysis.exports.push({ name: interfaceMatch[1], kind: "interface", line: i + 1 });
    }

    const enumMatch = line.match(/(?:public|protected)\s+enum\s+(\w+)/);
    if (enumMatch) {
      analysis.exports.push({ name: enumMatch[1], kind: "enum", line: i + 1 });
    }

    const methodMatch = line.match(/(?:public|protected)\s+(?:static\s+|abstract\s+|final\s+|synchronized\s+)*(?:[\w<>\[\]?,\s]+?)\s+(\w+)\s*\(/);
    if (methodMatch && !["class", "interface", "enum", "if", "for", "while", "switch", "catch"].includes(methodMatch[1])) {
      analysis.exports.push({ name: methodMatch[1], kind: "method", line: i + 1 });
    }
  }
}

function extractJavaFunctionCalls(lines: string[], analysis: ASTAnalysis): void {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.startsWith("//") || line.startsWith("*") || line.startsWith("import ") || line.startsWith("package ")) continue;

    const callPattern = /(\w[\w.]*?)\.(\w+)\s*\(/g;
    let match;
    while ((match = callPattern.exec(line)) !== null) {
      const caller = match[1];
      const method = match[2];
      if (["if", "for", "while", "switch", "catch", "return", "new", "throw"].includes(caller)) continue;
      analysis.functionCalls.push({
        caller,
        method,
        line: i + 1,
        fullExpression: `${caller}.${method}()`,
      });
    }
  }
}

function extractJavaInstantiations(lines: string[], analysis: ASTAnalysis): void {
  for (let i = 0; i < lines.length; i++) {
    const pattern = /new\s+([\w.]+(?:<[^>]*>)?)\s*\(/g;
    let match;
    while ((match = pattern.exec(lines[i])) !== null) {
      analysis.classInstantiations.push({ className: match[1], line: i + 1 });
    }
  }
}

function extractJavaAttributes(lines: string[], analysis: ASTAnalysis): void {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const annotationMatch = line.match(/^@(\w+)(?:\s*\()?/);
    if (annotationMatch) {
      const nextLine = (lines[i + 1] || "").trim();
      const targetMatch = nextLine.match(/(?:public|private|protected|static|abstract|final)\s+.*?(\w+)\s*[({;]/);
      analysis.attributes.push({
        name: annotationMatch[1],
        target: targetMatch ? targetMatch[1] : "unknown",
        line: i + 1,
      });
    }
  }
}

// ── Python Extractors ───────────────────────────────────────────

function extractPythonImports(lines: string[], analysis: ASTAnalysis): void {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // from X import Y, Z
    const fromImport = line.match(/^from\s+([\w.]+)\s+import\s+(.+)/);
    if (fromImport) {
      const source = fromImport[1];
      const names = fromImport[2].split(",").map(n => n.trim().split(/\s+as\s+/)[0].trim()).filter(Boolean);
      analysis.imports.push({ source, names, line: i + 1 });
      continue;
    }

    // import X, Y
    const importMatch = line.match(/^import\s+([\w., ]+)/);
    if (importMatch) {
      const modules = importMatch[1].split(",").map(m => m.trim().split(/\s+as\s+/)[0].trim()).filter(Boolean);
      for (const mod of modules) {
        analysis.imports.push({ source: mod, names: [mod.split(".").pop() || mod], line: i + 1 });
      }
    }
  }
}

function extractPythonExports(content: string, analysis: ASTAnalysis): void {
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Top-level class definitions
    const classMatch = line.match(/^class\s+(\w+)/);
    if (classMatch) {
      analysis.exports.push({ name: classMatch[1], kind: "class", line: i + 1 });
    }

    // Top-level function definitions (not private)
    const funcMatch = line.match(/^(?:async\s+)?def\s+(\w+)/);
    if (funcMatch && !funcMatch[1].startsWith("_")) {
      analysis.exports.push({ name: funcMatch[1], kind: "function", line: i + 1 });
    }

    // Module-level variable assignments (UPPER_CASE constants)
    const constMatch = line.match(/^([A-Z][A-Z_0-9]+)\s*=/);
    if (constMatch) {
      analysis.exports.push({ name: constMatch[1], kind: "variable", line: i + 1 });
    }
  }
}

function extractPythonFunctionCalls(lines: string[], analysis: ASTAnalysis): void {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.startsWith("#") || line.startsWith("import ") || line.startsWith("from ")) continue;

    const callPattern = /(\w[\w.]*?)\.(\w+)\s*\(/g;
    let match;
    while ((match = callPattern.exec(line)) !== null) {
      const caller = match[1];
      const method = match[2];
      if (["if", "for", "while", "def", "class", "return", "import", "from", "with", "as"].includes(caller)) continue;
      analysis.functionCalls.push({
        caller,
        method,
        line: i + 1,
        fullExpression: `${caller}.${method}()`,
      });
    }
  }
}

function extractPythonInstantiations(lines: string[], analysis: ASTAnalysis): void {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Python class instantiation: ClassName(args) — uppercase first letter, not a known function
    const pattern = /(?:^|[\s=+(,])([A-Z]\w+)\s*\(/g;
    let match;
    while ((match = pattern.exec(line)) !== null) {
      const name = match[1];
      if (["If", "For", "While", "With", "Try", "Except", "True", "False", "None", "Return", "Class", "Def"].includes(name)) continue;
      analysis.classInstantiations.push({ className: name, line: i + 1 });
    }
  }
}

function extractPythonAttributes(lines: string[], analysis: ASTAnalysis): void {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    // Python decorators: @app.route, @staticmethod, @property
    const decoratorMatch = line.match(/^@([\w.]+)(?:\s*\()?/);
    if (decoratorMatch) {
      const nextLine = (lines[i + 1] || "").trim();
      const targetMatch = nextLine.match(/(?:async\s+)?(?:def|class)\s+(\w+)/);
      analysis.attributes.push({
        name: decoratorMatch[1],
        target: targetMatch ? targetMatch[1] : "unknown",
        line: i + 1,
      });
    }
  }
}

// ── HTML Extractors ─────────────────────────────────────────────

function extractHTMLEventBindings(lines: string[], analysis: ASTAnalysis): void {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Inline event handlers: onclick="handler()", onchange="...", etc.
    const inlinePattern = /\b(on\w+)\s*=\s*["']([^"']*?)["']/gi;
    let match;
    while ((match = inlinePattern.exec(line)) !== null) {
      analysis.eventBindings.push({ type: match[1].toLowerCase(), handler: match[2].slice(0, 50), line: i + 1 });
    }

    // data-toggle, data-bs-toggle, data-dismiss, data-bs-dismiss (Bootstrap)
    const dataTogglePattern = /data-(?:bs-)?(toggle|dismiss|target|slide|ride|interval)\s*=\s*["']([^"']+)["']/gi;
    while ((match = dataTogglePattern.exec(line)) !== null) {
      analysis.attributes.push({ name: `data-${match[1]}`, target: match[2], line: i + 1 });
    }
  }
}

function extractHTMLAssetImports(lines: string[], analysis: ASTAnalysis): void {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // <script src="..."> and <link href="...">
    const srcMatch = line.match(/(?:src|href)\s*=\s*["']([^"']+)["']/i);
    if (srcMatch) {
      const ref = srcMatch[1];
      if (ref.includes(".js") || ref.includes(".css") || ref.includes("/lib/") || ref.includes("cdn")) {
        analysis.imports.push({ source: ref, names: [], line: i + 1 });
      }
    }
  }
}

// ── Utility: Format AST for Prompt Injection ────────────────────

export function formatASTForPrompt(ast: ASTAnalysis): string {
  const parts: string[] = [];
  parts.push(`--- AST ANALYSIS: ${ast.filePath} (${ast.language}) ---`);

  if (ast.imports.length > 0) {
    parts.push(`Imports (${ast.imports.length}):`);
    for (const imp of ast.imports.slice(0, 20)) {
      parts.push(`  L${imp.line}: ${imp.names.join(", ") || "*"} from "${imp.source}"${imp.isStatic ? " (static)" : ""}`);
    }
    if (ast.imports.length > 20) parts.push(`  ... and ${ast.imports.length - 20} more`);
  }

  if (ast.exports.length > 0) {
    parts.push(`Exports (${ast.exports.length}):`);
    for (const exp of ast.exports.slice(0, 15)) {
      parts.push(`  L${exp.line}: ${exp.kind} ${exp.name}`);
    }
  }

  if (ast.functionCalls.length > 0) {
    const unique = new Map<string, ASTFunctionCall>();
    for (const call of ast.functionCalls) {
      const key = call.fullExpression;
      if (!unique.has(key)) unique.set(key, call);
    }
    parts.push(`Function calls (${unique.size} unique):`);
    for (const [, call] of [...unique].slice(0, 20)) {
      parts.push(`  L${call.line}: ${call.fullExpression}`);
    }
  }

  if (ast.classInstantiations.length > 0) {
    parts.push(`Instantiations: ${[...new Set(ast.classInstantiations.map(c => c.className))].join(", ")}`);
  }

  if (ast.eventBindings.length > 0) {
    parts.push(`Event bindings (${ast.eventBindings.length}):`);
    for (const eb of ast.eventBindings.slice(0, 10)) {
      parts.push(`  L${eb.line}: ${eb.type} → ${eb.handler}`);
    }
  }

  if (ast.attributes.length > 0) {
    const attrNames = [...new Set(ast.attributes.map(a => a.name))];
    parts.push(`Attributes: ${attrNames.join(", ")}`);
  }

  parts.push("---");
  return parts.join("\n");
}

/**
 * Get a compact summary of deprecated/risky API usage from AST analysis.
 */
export function getDeprecatedAPIUsage(ast: ASTAnalysis, deprecatedPatterns: string[]): ASTFunctionCall[] {
  const lowerPatterns = deprecatedPatterns.map(p => p.toLowerCase());
  return ast.functionCalls.filter(call => {
    const fullLower = call.fullExpression.toLowerCase();
    return lowerPatterns.some(p => fullLower.includes(p));
  });
}
