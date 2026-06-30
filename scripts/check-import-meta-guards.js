#!/usr/bin/env node
/**
 * Static guard: forbid bare `fileURLToPath(import.meta.url)` (and similar)
 * in `server/**` outside of the canonical helper.
 *
 * Why: ESM-only constructs like `import.meta.url` evaluate to `undefined` in
 * the bundled CJS output (`dist/index.cjs`) produced by esbuild. Any
 * top-level call therefore throws `ERR_INVALID_ARG_TYPE` during `require()`,
 * crashes the PM2-managed process before Express binds a port, and produces
 * an indefinite 502 from the EC2 nginx upstream. See server/utils/module-paths.ts.
 *
 * Allowed:
 *   - server/utils/module-paths.ts                       (the helper itself)
 *
 * Forbidden everywhere else in server/**:
 *   - `fileURLToPath(import.meta.url)` at top level
 *   - bare `import.meta.url` reads outside a try/catch + `typeof` guard
 *
 * Run via `npm run check:import-meta-guards` or as part of `precommit`.
 */

import { readdirSync, readFileSync } from 'fs';
import { join, relative, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const ROOT = resolve(__dirname, '..');
const SCAN_DIR = join(ROOT, 'server');
const ALLOWLIST = new Set([
  join(SCAN_DIR, 'utils', 'module-paths.ts'),
]);

const violations = [];

function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue;
      walk(abs);
    } else if (entry.isFile() && /\.(ts|tsx|js|cjs|mjs)$/.test(entry.name)) {
      checkFile(abs);
    }
  }
}

function isCommentOnlyLine(line) {
  const trimmed = line.trim();
  return (
    trimmed.startsWith('//') ||
    trimmed.startsWith('/*') ||
    trimmed.startsWith('*') ||
    trimmed === ''
  );
}

function checkFile(abs) {
  if (ALLOWLIST.has(abs)) return;
  const src = readFileSync(abs, 'utf8');
  if (!/import\.meta\.url/.test(src)) return;

  const lines = src.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!/import\.meta\.url/.test(line)) continue;
    if (isCommentOnlyLine(line)) continue;

    const window = lines.slice(Math.max(0, i - 4), i).join('\n');
    const guarded =
      /typeof\s+import\.meta\b/.test(line) ||
      /typeof\s+import\.meta\b/.test(window) ||
      /\btry\s*\{/.test(window) ||
      // `getModuleDir(import.meta?.url)` and `getRepoRoot(import.meta?.url)` —
      // safe because the helper internally checks the value before passing
      // it to fileURLToPath and falls back to process.argv[1]/cwd in CJS.
      /getModuleDir\s*\(\s*import\.meta\?\.url\s*\)/.test(line) ||
      /getRepoRoot\s*\(\s*import\.meta\?\.url\s*\)/.test(line);

    if (!guarded) {
      violations.push({
        file: relative(ROOT, abs),
        line: i + 1,
        text: line.trim(),
      });
    }
  }
}

walk(SCAN_DIR);

if (violations.length === 0) {
  console.log('[check:import-meta-guards] OK — no unguarded import.meta.url usage in server/**.');
  process.exit(0);
}

console.error('[check:import-meta-guards] FAIL — unguarded import.meta.url usage found.');
console.error('Each occurrence below must be routed through server/utils/module-paths.ts (getModuleDir/getRepoRoot)');
console.error('or wrapped in `try { import.meta.url } catch {}` / a `typeof import.meta` guard.\n');
for (const v of violations) {
  console.error(`  ${v.file}:${v.line}  ${v.text}`);
}
console.error('\nWhy this matters: in the CJS bundle (dist/index.cjs) `import.meta.url` is undefined');
console.error('and `fileURLToPath(undefined)` throws at require()-time, crashing the server before');
console.error('Express binds a port. EC2 nginx then returns 502 indefinitely.');
process.exit(1);
