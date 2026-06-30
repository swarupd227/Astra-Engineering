import fs from "fs";
import path from "path";

// ─── Directories to skip entirely ────────────────────────────────────────────
const SKIP_DIRS = new Set([
  "node_modules", ".git", "dist", "build", ".next", ".nuxt",
  "coverage", ".cache", ".vscode", ".idea", "attached_assets",
  "public", "server/public", ".turbo", "out",
]);

// ─── Only scan these source file extensions ───────────────────────────────────
const SCAN_EXTENSIONS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".prisma", ".sql",
]);

const MAX_FILE_LINES = 300;
const MAX_FILES      = 200;
const MAX_DEPTH      = 6;

// ─── Output types ─────────────────────────────────────────────────────────────

export interface ApiRoute {
  method: string;
  path: string;
  file: string;
}

export interface SchemaTable {
  name: string;
  columns: Array<{ name: string; type: string }>;
  file: string;
}

export interface TypeDef {
  name: string;
  kind: "interface" | "type" | "enum";
  fields: string[];
  file: string;
}

export interface TestSuite {
  file: string;
  tests: string[];
  type: "unit" | "integration" | "e2e" | "bdd";
}

export interface ServiceInfo {
  name: string;
  methods: string[];
  file: string;
}

export interface ProjectIndex {
  projectPath: string;
  routes: ApiRoute[];
  schemas: SchemaTable[];
  types: TypeDef[];
  existingTests: TestSuite[];
  services: ServiceInfo[];
  eventPatterns: string[];
  validationFunctions: string[];
  envVariables: string[];
  totalFilesScanned: number;
  indexedAt: string;
}

// ─── In-memory cache (5-minute TTL) ──────────────────────────────────────────

const _cache = new Map<string, { index: ProjectIndex; expiry: number }>();
const CACHE_TTL = 5 * 60 * 1000;

// ─── Public API ───────────────────────────────────────────────────────────────

export async function indexRepo(repoPath: string): Promise<ProjectIndex> {
  const hit = _cache.get(repoPath);
  if (hit && Date.now() < hit.expiry) {
    console.log(`[Indexer] Cache hit for ${repoPath}`);
    return hit.index;
  }

  if (!fs.existsSync(repoPath)) {
    throw new Error(`Repository path does not exist: ${repoPath}`);
  }

  console.log(`[Indexer] Scanning ${repoPath} ...`);

  const index: ProjectIndex = {
    projectPath: repoPath,
    routes: [], schemas: [], types: [], existingTests: [],
    services: [], eventPatterns: [], validationFunctions: [],
    envVariables: [], totalFilesScanned: 0,
    indexedAt: new Date().toISOString(),
  };

  const files = collectFiles(repoPath, 0);
  index.totalFilesScanned = files.length;

  for (const filePath of files) {
    try {
      const content = readLines(filePath, MAX_FILE_LINES);
      const rel = path.relative(repoPath, filePath).replace(/\\/g, "/");
      extractRoutes(content, rel, index.routes);
      extractSchema(content, filePath, rel, index.schemas);
      extractTypes(content, rel, index.types);
      extractTests(content, filePath, rel, index.existingTests);
      extractServices(content, rel, index.services);
      extractEvents(content, index.eventPatterns);
      extractValidations(content, index.validationFunctions);
      extractEnvVars(content, index.envVariables);
    } catch {
      // skip unreadable files silently
    }
  }

  // Deduplicate flat arrays
  index.eventPatterns      = [...new Set(index.eventPatterns)];
  index.validationFunctions = [...new Set(index.validationFunctions)];
  index.envVariables       = [...new Set(index.envVariables)];

  console.log(
    `[Indexer] Done: ${files.length} files | ` +
    `${index.routes.length} routes | ${index.schemas.length} tables | ` +
    `${index.types.length} types | ${index.existingTests.length} test suites`
  );

  _cache.set(repoPath, { index, expiry: Date.now() + CACHE_TTL });
  return index;
}

/** Invalidate the cache entry for a path (call after code changes). */
export function invalidateCache(repoPath: string): void {
  _cache.delete(repoPath);
}

// ─── File collection ──────────────────────────────────────────────────────────

function collectFiles(dir: string, depth: number): string[] {
  if (depth > MAX_DEPTH) return [];
  const results: string[] = [];

  let entries: fs.Dirent[];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
  catch { return []; }

  for (const entry of entries) {
    if (results.length >= MAX_FILES) break;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      results.push(...collectFiles(full, depth + 1));
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      if (SCAN_EXTENSIONS.has(ext)) results.push(full);
    }
  }
  return results;
}

function readLines(filePath: string, maxLines: number): string {
  const content = fs.readFileSync(filePath, "utf8");
  return content.split("\n").slice(0, maxLines).join("\n");
}

// ─── Extractors ───────────────────────────────────────────────────────────────

function extractRoutes(content: string, file: string, out: ApiRoute[]): void {
  // Express: app.get('/path') / router.post('/path')
  const rx = /(?:app|router)\.(get|post|put|patch|delete|options)\s*\(\s*['"`]([^'"`]+)['"`]/gi;
  for (const m of content.matchAll(rx)) {
    out.push({ method: m[1].toUpperCase(), path: m[2], file });
  }
  // app.route('/path').get(...)
  const chainRx = /\.route\s*\(\s*['"`]([^'"`]+)['"`]\s*\)\s*\.(get|post|put|patch|delete)/gi;
  for (const m of content.matchAll(chainRx)) {
    out.push({ method: m[2].toUpperCase(), path: m[1], file });
  }
}

function extractSchema(content: string, filePath: string, file: string, out: SchemaTable[]): void {
  // Drizzle ORM: pgTable('name', { col: type() })
  const drizzleRx = /pgTable\s*\(\s*['"`](\w+)['"`]\s*,\s*\{([^}]+)\}/g;
  for (const m of content.matchAll(drizzleRx)) {
    const cols: { name: string; type: string }[] = [];
    const colRx = /(\w+)\s*:\s*(\w+)\s*\(/g;
    for (const cm of m[2].matchAll(colRx)) cols.push({ name: cm[1], type: cm[2] });
    if (cols.length > 0) out.push({ name: m[1], columns: cols, file });
  }

  // Prisma .prisma files
  if (filePath.endsWith(".prisma")) {
    const modelRx = /model\s+(\w+)\s*\{([^}]+)\}/g;
    for (const m of content.matchAll(modelRx)) {
      const cols: { name: string; type: string }[] = [];
      const fieldRx = /^\s+(\w+)\s+(\w+)/gm;
      for (const fm of m[2].matchAll(fieldRx)) {
        if (!fm[0].includes("@@") && !fm[0].trim().startsWith("@")) {
          cols.push({ name: fm[1], type: fm[2] });
        }
      }
      if (cols.length > 0) out.push({ name: m[1], columns: cols, file });
    }
  }

  // Raw SQL CREATE TABLE
  const sqlRx = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?[`"']?(\w+)[`"']?\s*\(([^;]+)/gi;
  for (const m of content.matchAll(sqlRx)) {
    const cols: { name: string; type: string }[] = [];
    const colRx = /^\s+[`"']?(\w+)[`"']?\s+(\w+)/gm;
    const RESERVED = new Set(["PRIMARY", "UNIQUE", "INDEX", "FOREIGN", "CHECK", "CONSTRAINT", "KEY"]);
    for (const cm of m[2].matchAll(colRx)) {
      if (!RESERVED.has(cm[1].toUpperCase())) cols.push({ name: cm[1], type: cm[2] });
    }
    if (cols.length > 0) out.push({ name: m[1], columns: cols, file });
  }
}

function extractTypes(content: string, file: string, out: TypeDef[]): void {
  // TypeScript interfaces
  const ifaceRx = /export\s+interface\s+(\w+)[^{]*\{([^}]+)\}/g;
  for (const m of content.matchAll(ifaceRx)) {
    const fields: string[] = [];
    const fRx = /(\w+)\??:\s*([^;\n,]+)/g;
    for (const fm of m[2].matchAll(fRx)) fields.push(`${fm[1]}: ${fm[2].trim()}`);
    if (fields.length > 0) out.push({ name: m[1], kind: "interface", fields, file });
  }

  // Enums
  const enumRx = /export\s+enum\s+(\w+)\s*\{([^}]+)\}/g;
  for (const m of content.matchAll(enumRx)) {
    const values = m[2]
      .split(",")
      .map(v => v.trim().split("=")[0].trim())
      .filter(v => v.length > 0 && !v.startsWith("//"));
    if (values.length > 0) out.push({ name: m[1], kind: "enum", fields: values, file });
  }

  // Union type aliases  (export type Status = 'active' | 'inactive')
  const typeRx = /export\s+type\s+(\w+)\s*=\s*([^;]+)/g;
  for (const m of content.matchAll(typeRx)) {
    if (m[2].includes("|")) {
      const values = m[2]
        .split("|")
        .map(v => v.trim().replace(/['"]/g, ""))
        .filter(v => v.length > 0 && !["null", "undefined"].includes(v));
      if (values.length > 1) out.push({ name: m[1], kind: "type", fields: values, file });
    }
  }
}

function extractTests(content: string, filePath: string, file: string, out: TestSuite[]): void {
  const isTestFile = /\.(test|spec)\.(ts|tsx|js|jsx)$/.test(filePath) || filePath.includes("__tests__");
  const isBDD = filePath.endsWith(".feature");
  if (!isTestFile && !isBDD) return;

  const tests: string[] = [];
  if (isBDD) {
    const rx = /Scenario(?:\s+Outline)?\s*:\s*(.+)/g;
    for (const m of content.matchAll(rx)) tests.push(m[1].trim());
    if (tests.length > 0) out.push({ file, tests, type: "bdd" });
  } else {
    const rx = /(?:it|test|describe)\s*\(\s*['"`]([^'"`]+)['"`]/g;
    for (const m of content.matchAll(rx)) tests.push(m[1]);
    const type: TestSuite["type"] =
      file.includes("e2e") ? "e2e" : file.includes("integration") ? "integration" : "unit";
    if (tests.length > 0) out.push({ file, tests, type });
  }
}

function extractServices(content: string, file: string, out: ServiceInfo[]): void {
  const isServiceFile = /service|repository|repo|handler|provider/i.test(file);
  if (!isServiceFile) return;

  const classRx = /(?:export\s+)?class\s+(\w+)/g;
  for (const m of content.matchAll(classRx)) {
    const methods: string[] = [];
    const methodRx = /(?:async\s+)?(\w+)\s*\([^)]*\)\s*(?::\s*[^{]+)?\s*\{/g;
    const SKIP = new Set(["if", "for", "while", "switch", "catch", "constructor", "function"]);
    for (const mm of content.matchAll(methodRx)) {
      if (!SKIP.has(mm[1])) methods.push(mm[1]);
    }
    if (methods.length > 0) out.push({ name: m[1], methods: [...new Set(methods)], file });
  }
}

function extractEvents(content: string, out: string[]): void {
  const emitRx = /(?:emit|publish|dispatch)\s*\(\s*['"`]([^'"`]+)['"`]/g;
  for (const m of content.matchAll(emitRx)) out.push(m[1]);
}

function extractValidations(content: string, out: string[]): void {
  const rx = /(?:export\s+)?(?:async\s+)?function\s+((?:validate|check|verify|enforce|assert|ensure)\w*)/g;
  for (const m of content.matchAll(rx)) out.push(m[1]);
  // Zod schemas
  const zodRx = /const\s+(\w+Schema)\s*=\s*z\./g;
  for (const m of content.matchAll(zodRx)) out.push(m[1]);
}

function extractEnvVars(content: string, out: string[]): void {
  const rx = /process\.env\.(\w+)/g;
  for (const m of content.matchAll(rx)) out.push(m[1]);
}
