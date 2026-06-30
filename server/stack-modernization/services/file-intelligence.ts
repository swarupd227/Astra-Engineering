/**
 * File Intelligence Service
 * Deterministic static analysis that extracts structured metadata from each file.
 * Runs once during assessment — no LLM calls, no vector DB.
 */

import * as path from "path";
import type { ExtractedFile } from "../types";

export interface FileIntelligence {
  path: string;
  language: string;
  purpose: "manifest" | "entry_point" | "config" | "controller" | "model" | "view" | "service" | "utility" | "test" | "migration" | "middleware" | "other";
  imports: Array<{ name: string; source: string; isExternal: boolean; line: number }>;
  exports: Array<{ name: string; kind: "class" | "function" | "variable" | "interface" | "type" | "enum" | "default" }>;
  functions: Array<{ name: string; params: string; returnType?: string; isAsync: boolean; lineStart: number }>;
  classes: Array<{ name: string; extends?: string; implements?: string[]; methods: string[] }>;
  frameworkPatterns: string[];
  assetReferences: string[];
  linesOfCode: number;
  summary: string;
}

// ── Purpose classification ──────────────────────────────────────

const MANIFEST_NAMES = new Set([
  "package.json", "pom.xml", "build.gradle", "build.gradle.kts",
  "requirements.txt", "pyproject.toml", "pipfile", "go.mod",
  "cargo.toml", "gemfile", "composer.json", "libman.json",
  "bower.json", "nuget.config", "global.json", "directory.build.props",
]);

const ENTRY_POINT_NAMES = new Set([
  "program.cs", "startup.cs", "main.ts", "main.js", "index.ts", "index.js",
  "app.ts", "app.js", "server.ts", "server.js", "main.py", "app.py",
  "manage.py", "wsgi.py", "asgi.py", "application.java", "main.java",
  "main.go", "main.rs", "main.rb",
]);

const CONFIG_NAMES = new Set([
  "appsettings.json", "appsettings.development.json", "web.config",
  "tsconfig.json", "webpack.config.js", "vite.config.ts", "vite.config.js",
  ".babelrc", "babel.config.js", "jest.config.js", "jest.config.ts",
  ".eslintrc.js", ".eslintrc.json", "settings.py", "config.py",
  "application.properties", "application.yml", "application.yaml",
  "docker-compose.yml", "dockerfile",
]);

const VIEW_EXTENSIONS = new Set([
  ".cshtml", ".html", ".htm", ".jsx", ".tsx", ".vue", ".svelte",
  ".ejs", ".hbs", ".pug", ".erb", ".blade.php", ".twig",
  ".jsp", ".jinja2", ".mustache",
]);

const TEST_PATTERNS = [/\.test\./i, /\.spec\./i, /tests?\//i, /__tests__/i, /test_/i];

function classifyPurpose(filePath: string, content: string): FileIntelligence["purpose"] {
  const basename = path.basename(filePath).toLowerCase();
  const ext = path.extname(filePath).toLowerCase();

  if (MANIFEST_NAMES.has(basename) || basename.endsWith(".csproj") || basename.endsWith(".fsproj")) return "manifest";
  if (ENTRY_POINT_NAMES.has(basename)) return "entry_point";
  if (CONFIG_NAMES.has(basename)) return "config";
  if (VIEW_EXTENSIONS.has(ext)) return "view";
  if (TEST_PATTERNS.some(p => p.test(filePath))) return "test";

  if (basename.endsWith(".migration.cs") || /class\s+\w+\s*:\s*Migration/i.test(content)) return "migration";

  const lower = content.slice(0, 3000).toLowerCase();
  if (/\b(controller|apicontroller|@controller|@restcontroller)\b/i.test(lower)) return "controller";
  if (/\b(middleware|app\.use\(|@middleware)\b/i.test(lower)) return "middleware";
  if (/\b(service|@service|@injectable|provider)\b/i.test(lower)) return "service";
  if (/\b(model|entity|schema|@entity|dbset|dbcontext)\b/i.test(lower)) return "model";

  return "other";
}

// ── Import extraction ───────────────────────────────────────────

function extractImports(content: string, lang: string): FileIntelligence["imports"] {
  const imports: FileIntelligence["imports"] = [];
  const lines = content.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (lang === "javascript" || lang === "typescript") {
      const esm = line.match(/import\s+(?:{[^}]*}|[\w*]+(?:\s*,\s*{[^}]*})?)\s+from\s+['"]([^'"]+)['"]/);
      if (esm) {
        const src = esm[1];
        imports.push({ name: path.basename(src).replace(/\.[jt]sx?$/, ""), source: src, isExternal: !src.startsWith("."), line: i + 1 });
      }
      const cjs = line.match(/(?:const|let|var)\s+(\w+)\s*=\s*require\s*\(\s*['"]([^'"]+)['"]\s*\)/);
      if (cjs) {
        imports.push({ name: cjs[1], source: cjs[2], isExternal: !cjs[2].startsWith("."), line: i + 1 });
      }
    }

    if (lang === "python") {
      const pyImport = line.match(/^(?:from\s+([\w.]+)\s+)?import\s+([\w., ]+)/);
      if (pyImport) {
        const src = pyImport[1] || pyImport[2].split(",")[0].trim();
        imports.push({ name: pyImport[2].split(",")[0].trim(), source: src, isExternal: !src.startsWith("."), line: i + 1 });
      }
    }

    if (lang === "java") {
      const javaImport = line.match(/^import\s+(?:static\s+)?([\w.]+)\s*;/);
      if (javaImport) {
        const src = javaImport[1];
        const parts = src.split(".");
        imports.push({ name: parts[parts.length - 1], source: src, isExternal: !src.startsWith("com.mycompany"), line: i + 1 });
      }
    }

    if (lang === "csharp") {
      const csUsing = line.match(/^using\s+(?:static\s+)?([\w.]+)\s*;/);
      if (csUsing) {
        const src = csUsing[1];
        imports.push({ name: src.split(".").pop() || src, source: src, isExternal: !src.startsWith("MyApp"), line: i + 1 });
      }
    }

    if (lang === "go") {
      const goImport = line.match(/^\s*"([^"]+)"/);
      if (goImport) {
        const src = goImport[1];
        imports.push({ name: path.basename(src), source: src, isExternal: src.includes("."), line: i + 1 });
      }
    }
  }

  return imports;
}

// ── Export extraction ────────────────────────────────────────────

function extractExports(content: string, lang: string): FileIntelligence["exports"] {
  const exports: FileIntelligence["exports"] = [];

  if (lang === "javascript" || lang === "typescript") {
    const defaultExport = content.match(/export\s+default\s+(?:class|function)?\s*(\w+)/);
    if (defaultExport) exports.push({ name: defaultExport[1], kind: "default" });

    const namedExports = content.matchAll(/export\s+(?:async\s+)?(?:function|class|const|let|var|interface|type|enum)\s+(\w+)/g);
    for (const m of namedExports) {
      const kw = content.slice(m.index!, m.index! + m[0].length).toLowerCase();
      let kind: FileIntelligence["exports"][0]["kind"] = "variable";
      if (kw.includes("function")) kind = "function";
      else if (kw.includes("class")) kind = "class";
      else if (kw.includes("interface")) kind = "interface";
      else if (kw.includes("type ")) kind = "type";
      else if (kw.includes("enum")) kind = "enum";
      exports.push({ name: m[1], kind });
    }
  }

  if (lang === "python") {
    const defs = content.matchAll(/^(?:async\s+)?def\s+(\w+)/gm);
    for (const m of defs) {
      if (!m[1].startsWith("_")) exports.push({ name: m[1], kind: "function" });
    }
    const classes = content.matchAll(/^class\s+(\w+)/gm);
    for (const m of classes) exports.push({ name: m[1], kind: "class" });
  }

  if (lang === "java") {
    const classes = content.matchAll(/public\s+(?:abstract\s+)?class\s+(\w+)/g);
    for (const m of classes) exports.push({ name: m[1], kind: "class" });
    const interfaces = content.matchAll(/public\s+interface\s+(\w+)/g);
    for (const m of interfaces) exports.push({ name: m[1], kind: "interface" });
  }

  if (lang === "csharp") {
    const classes = content.matchAll(/public\s+(?:partial\s+|abstract\s+|static\s+)*class\s+(\w+)/g);
    for (const m of classes) exports.push({ name: m[1], kind: "class" });
    const interfaces = content.matchAll(/public\s+interface\s+(\w+)/g);
    for (const m of interfaces) exports.push({ name: m[1], kind: "interface" });
  }

  return exports;
}

// ── Function extraction ─────────────────────────────────────────

function extractFunctions(content: string, lang: string): FileIntelligence["functions"] {
  const fns: FileIntelligence["functions"] = [];
  const lines = content.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (lang === "javascript" || lang === "typescript") {
      const fn = line.match(/(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\(([^)]*)\)(?:\s*:\s*(\w[^{]*))?/);
      if (fn) fns.push({ name: fn[1], params: fn[2].trim(), returnType: fn[3]?.trim(), isAsync: line.includes("async"), lineStart: i + 1 });
      const arrow = line.match(/(?:export\s+)?(?:const|let)\s+(\w+)\s*=\s*(?:async\s+)?\(([^)]*)\)(?:\s*:\s*(\w[^=]*))?/);
      if (arrow) fns.push({ name: arrow[1], params: arrow[2].trim(), returnType: arrow[3]?.trim(), isAsync: line.includes("async"), lineStart: i + 1 });
    }

    if (lang === "python") {
      const fn = line.match(/^\s*(?:async\s+)?def\s+(\w+)\s*\(([^)]*)\)(?:\s*->\s*(\S+))?/);
      if (fn) fns.push({ name: fn[1], params: fn[2].trim(), returnType: fn[3]?.trim(), isAsync: line.includes("async"), lineStart: i + 1 });
    }

    if (lang === "java") {
      const fn = line.match(/(?:public|protected|private)\s+(?:static\s+)?(?:async\s+)?(\w[\w<>,\s]*?)\s+(\w+)\s*\(([^)]*)\)/);
      if (fn && !["class", "interface", "enum", "if", "for", "while"].includes(fn[2])) {
        fns.push({ name: fn[2], params: fn[3].trim(), returnType: fn[1].trim(), isAsync: false, lineStart: i + 1 });
      }
    }

    if (lang === "csharp") {
      const fn = line.match(/(?:public|protected|private|internal)\s+(?:static\s+|virtual\s+|override\s+|async\s+)*(\w[\w<>,?\s]*?)\s+(\w+)\s*\(([^)]*)\)/);
      if (fn && !["class", "interface", "enum", "struct", "if", "for", "while", "namespace"].includes(fn[2])) {
        fns.push({ name: fn[2], params: fn[3].trim(), returnType: fn[1].trim(), isAsync: line.includes("async"), lineStart: i + 1 });
      }
    }
  }

  return fns;
}

// ── Class extraction ────────────────────────────────────────────

function extractClasses(content: string, lang: string): FileIntelligence["classes"] {
  const classes: FileIntelligence["classes"] = [];

  if (lang === "javascript" || lang === "typescript") {
    const classMatches = content.matchAll(/class\s+(\w+)(?:\s+extends\s+(\w+))?(?:\s+implements\s+([\w,\s]+))?\s*\{/g);
    for (const m of classMatches) {
      const methods = extractClassMethods(content, m.index!);
      classes.push({
        name: m[1],
        extends: m[2],
        implements: m[3]?.split(",").map(s => s.trim()),
        methods,
      });
    }
  }

  if (lang === "csharp" || lang === "java") {
    const classMatches = content.matchAll(/class\s+(\w+)(?:\s*:\s*([\w,\s<>]+))?\s*\{/g);
    for (const m of classMatches) {
      const methods = extractClassMethods(content, m.index!);
      const bases = m[2]?.split(",").map(s => s.trim()) || [];
      classes.push({
        name: m[1],
        extends: bases[0],
        implements: bases.slice(1),
        methods,
      });
    }
  }

  if (lang === "python") {
    const classMatches = content.matchAll(/class\s+(\w+)\s*(?:\(([^)]*)\))?\s*:/g);
    for (const m of classMatches) {
      const methods: string[] = [];
      const startIdx = m.index! + m[0].length;
      const block = content.slice(startIdx, startIdx + 3000);
      const methodMatches = block.matchAll(/def\s+(\w+)\s*\(/g);
      for (const mm of methodMatches) methods.push(mm[1]);
      classes.push({
        name: m[1],
        extends: m[2]?.split(",")[0]?.trim(),
        implements: [],
        methods,
      });
    }
  }

  return classes;
}

function extractClassMethods(content: string, classStart: number): string[] {
  const methods: string[] = [];
  let depth = 0;
  let started = false;

  for (let i = classStart; i < content.length && i < classStart + 10000; i++) {
    if (content[i] === "{") { depth++; started = true; }
    if (content[i] === "}") { depth--; if (started && depth === 0) break; }
  }

  const classBody = content.slice(classStart, classStart + 10000);
  const methodMatches = classBody.matchAll(/(?:async\s+)?(?:public\s+|private\s+|protected\s+|static\s+)*(\w+)\s*\([^)]*\)\s*(?::\s*\w[^{]*)?[{:]/g);
  for (const m of methodMatches) {
    if (!["if", "for", "while", "switch", "catch", "class", "new", "return"].includes(m[1])) {
      methods.push(m[1]);
    }
  }

  return methods.slice(0, 20);
}

// ── Framework patterns ──────────────────────────────────────────

function detectFrameworkPatterns(content: string, lang: string): string[] {
  const patterns: string[] = [];
  const lower = content.toLowerCase();

  if (lang === "javascript" || lang === "typescript") {
    if (/react/i.test(content) && /usestate|useeffect|useref/i.test(content)) patterns.push("React Hooks");
    if (/express/i.test(content) && /app\.(get|post|put|delete|use)/i.test(content)) patterns.push("Express.Router");
    if (/@component|@injectable|@ngmodule/i.test(content)) patterns.push("Angular decorators");
    if (/<template>/i.test(content) && /export\s+default/i.test(content)) patterns.push("Vue SFC");
  }

  if (lang === "csharp") {
    if (/@model\s|@page\s|@\{/i.test(content)) patterns.push("Razor views");
    if (/\[apicontroller\]|\[httpget\]|\[httppost\]/i.test(content)) patterns.push("ASP.NET Web API");
    if (/builder\.services|app\.map|app\.use/i.test(lower)) patterns.push("ASP.NET minimal hosting");
    if (/dbcontext|dbset|entity/i.test(lower)) patterns.push("Entity Framework");
  }

  if (lang === "java") {
    if (/@controller|@restcontroller/i.test(content)) patterns.push("Spring MVC");
    if (/@service|@component|@autowired/i.test(content)) patterns.push("Spring DI");
    if (/@entity|@table|@column/i.test(content)) patterns.push("JPA/Hibernate");
    if (/@configuration|@bean/i.test(content)) patterns.push("Spring Configuration");
  }

  if (lang === "python") {
    if (/from\s+django/i.test(content)) patterns.push("Django");
    if (/from\s+flask/i.test(content)) patterns.push("Flask");
    if (/from\s+fastapi/i.test(content)) patterns.push("FastAPI");
  }

  // Frontend patterns (any language with HTML content)
  if (/bootstrap/i.test(lower)) patterns.push("Bootstrap");
  if (/jquery/i.test(lower)) patterns.push("jQuery");
  if (/\.datepicker\(/i.test(content)) patterns.push("jQuery datepicker");
  if (/fontawesome|fa-/i.test(lower)) patterns.push("Font Awesome");

  return patterns;
}

// ── Asset reference extraction ──────────────────────────────────

function extractAssetReferences(content: string): string[] {
  const refs: string[] = [];
  const seen = new Set<string>();

  const scriptSrc = content.matchAll(/(?:src|href)\s*=\s*["']([^"']+)["']/gi);
  for (const m of scriptSrc) {
    const ref = m[1].trim();
    if ((ref.includes("/lib/") || ref.includes("/dist/") || ref.includes(".min.") || ref.includes("cdn")) && !seen.has(ref)) {
      seen.add(ref);
      refs.push(ref);
    }
  }

  const cssUrl = content.matchAll(/url\s*\(\s*["']?([^"')]+)["']?\s*\)/gi);
  for (const m of cssUrl) {
    const ref = m[1].trim();
    if (!ref.startsWith("data:") && !seen.has(ref)) {
      seen.add(ref);
      refs.push(ref);
    }
  }

  return refs;
}

// ── Language detection ───────────────────────────────────────────

function detectLanguage(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  const map: Record<string, string> = {
    ".js": "javascript", ".jsx": "javascript", ".mjs": "javascript",
    ".ts": "typescript", ".tsx": "typescript",
    ".py": "python",
    ".java": "java", ".kt": "java",
    ".cs": "csharp",
    ".go": "go",
    ".rb": "ruby",
    ".php": "php",
    ".rs": "rust",
    ".cshtml": "csharp", ".razor": "csharp",
    ".html": "html", ".htm": "html",
    ".vue": "javascript", ".svelte": "javascript",
  };
  return map[ext] || "other";
}

// ── Summary generation ──────────────────────────────────────────

function generateSummary(intel: Omit<FileIntelligence, "summary">): string {
  const parts: string[] = [];
  parts.push(`${intel.purpose} file`);

  if (intel.classes.length > 0) {
    parts.push(`defines ${intel.classes.map(c => c.name).join(", ")}`);
  } else if (intel.functions.length > 0) {
    const names = intel.functions.slice(0, 3).map(f => f.name);
    parts.push(`has ${intel.functions.length} function(s): ${names.join(", ")}${intel.functions.length > 3 ? "..." : ""}`);
  }

  if (intel.frameworkPatterns.length > 0) {
    parts.push(`uses ${intel.frameworkPatterns.join(", ")}`);
  }

  if (intel.assetReferences.length > 0) {
    parts.push(`references ${intel.assetReferences.length} asset(s)`);
  }

  return parts.join("; ") + `. ${intel.linesOfCode} lines.`;
}

// ── Main API ────────────────────────────────────────────────────

export function analyzeFile(file: ExtractedFile): FileIntelligence {
  const content = file.content || "";
  const lang = detectLanguage(file.relativePath);
  const tsOrJs = lang === "javascript" || lang === "typescript" ? lang : undefined;
  const effectiveLang = tsOrJs || lang;

  const partial: Omit<FileIntelligence, "summary"> = {
    path: file.relativePath,
    language: lang,
    purpose: classifyPurpose(file.relativePath, content),
    imports: extractImports(content, effectiveLang),
    exports: extractExports(content, effectiveLang),
    functions: extractFunctions(content, effectiveLang),
    classes: extractClasses(content, effectiveLang),
    frameworkPatterns: detectFrameworkPatterns(content, effectiveLang),
    assetReferences: extractAssetReferences(content),
    linesOfCode: content.split("\n").filter(l => l.trim().length > 0).length,
  };

  return { ...partial, summary: generateSummary(partial) };
}

export function buildFileIntelligenceMap(extractedFiles: ExtractedFile[]): Map<string, FileIntelligence> {
  const map = new Map<string, FileIntelligence>();

  for (const file of extractedFiles) {
    if (!file.content || file.content.length === 0) continue;
    try {
      const intel = analyzeFile(file);
      map.set(file.relativePath, intel);
    } catch (err) {
      console.warn(`[FileIntelligence] Failed to analyze ${file.relativePath}:`, err);
    }
  }

  return map;
}

/**
 * Format intelligence as a compact header for LLM prompts.
 */
export function formatIntelligenceHeader(intel: FileIntelligence): string {
  const lines: string[] = [];
  lines.push(`--- FILE INTELLIGENCE: ${intel.path} ---`);
  lines.push(`Purpose: ${intel.purpose} | Language: ${intel.language} | ${intel.linesOfCode} lines`);

  if (intel.imports.length > 0) {
    const ext = intel.imports.filter(i => i.isExternal).slice(0, 10);
    if (ext.length > 0) lines.push(`External imports: ${ext.map(i => i.source).join(", ")}`);
  }

  if (intel.exports.length > 0) {
    lines.push(`Exports: ${intel.exports.map(e => `${e.kind} ${e.name}`).join(", ")}`);
  }

  if (intel.functions.length > 0) {
    const fns = intel.functions.slice(0, 8);
    lines.push(`Functions: ${fns.map(f => `${f.isAsync ? "async " : ""}${f.name}(${f.params})${f.returnType ? ": " + f.returnType : ""}`).join(", ")}`);
  }

  if (intel.classes.length > 0) {
    lines.push(`Classes: ${intel.classes.map(c => `${c.name}${c.extends ? " extends " + c.extends : ""}${c.methods.length > 0 ? " [" + c.methods.slice(0, 5).join(", ") + "]" : ""}`).join("; ")}`);
  }

  if (intel.frameworkPatterns.length > 0) {
    lines.push(`Framework patterns: ${intel.frameworkPatterns.join(", ")}`);
  }

  if (intel.assetReferences.length > 0) {
    lines.push(`Asset refs: ${intel.assetReferences.join(", ")}`);
    lines.push(`DO NOT change these asset paths unless the upgrade specifically requires it.`);
  }

  lines.push(`---`);
  return lines.join("\n");
}

/**
 * For manifest files (libman.json, bower.json), generate path mappings.
 */
export function formatManifestPathMappings(intel: FileIntelligence, content: string): string {
  const basename = path.basename(intel.path).toLowerCase();
  if (basename !== "libman.json" && basename !== "bower.json") return "";

  const mappings: string[] = [];
  try {
    const parsed = JSON.parse(content);
    const libs = parsed.libraries || [];
    for (const lib of libs) {
      const dest = (lib.destination || "").replace(/\\/g, "/").replace(/\/$/, "");
      const files = lib.files || [];
      const libName = lib.library || "unknown";
      for (const f of files) {
        const fullPath = `${dest}/${f}`.replace("wwwroot/", "~/");
        mappings.push(`  ${libName} → ${dest}/ + ${f} = ${fullPath}`);
      }
    }
  } catch { /* not parseable */ }

  if (mappings.length === 0) return "";
  return `Path mappings (manifest destination + files = resolved path):\n${mappings.join("\n")}\nWhen upgrading versions, keep these EXACT path structures unless the new version changed its dist layout.`;
}
