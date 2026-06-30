/**
 * Module-path helpers that survive both ESM (dev/tsx) and CommonJS (esbuild bundle).
 *
 * Why this exists
 * ---------------
 * The server runs in two very different environments:
 *   1. Dev:        `tsx watch server/index.ts`  → real ESM, `import.meta.url` is a string.
 *   2. Production: `node dist/index.cjs`        → esbuild output, `import.meta` is an
 *                                                 empty object literal, so any
 *                                                 unguarded `fileURLToPath(import.meta.url)`
 *                                                 throws `ERR_INVALID_ARG_TYPE` at module
 *                                                 evaluation time and crashes the
 *                                                 PM2-managed process before Express
 *                                                 binds a port. Nginx upstream then
 *                                                 returns 502 → API Gateway forwards
 *                                                 the 502 to clients.
 *
 * Always go through `getModuleDir()` and (where applicable) `getRepoRoot()` instead of
 * touching `import.meta.url` directly anywhere in `server/**`. A build-time smoke
 * `require('./dist/index.cjs')` enforces this — see package.json `build` script.
 */

import { dirname, resolve } from "path";
import { fileURLToPath } from "url";

/**
 * Return the directory of the calling module.
 *
 * IMPORTANT — pass your own `import.meta.url` in. In ESM, `import.meta.url`
 * resolves to *the current module*, so if this helper read its own
 * `import.meta.url` every caller would get this file's directory instead of
 * theirs. Each caller forwards its own:
 *
 *   const __dirname = getModuleDir(import.meta?.url);
 *
 * Behaviour:
 * - In ESM (dev/tsx) `metaUrl` is a `file://` string — returns
 *   `dirname(fileURLToPath(metaUrl))`.
 * - In the CJS bundle `metaUrl` is `undefined` (esbuild rewrites
 *   `import.meta` to `{}`) — falls back to `process.argv[1]` (the entry
 *   script, e.g. `/opt/devx/dist/index.cjs`) and finally `process.cwd()`.
 *
 * Note: in a single-file CJS bundle every caller resolves to the same
 * directory (the location of `dist/index.cjs`). That is intentional — the
 * source-tree layout no longer exists at runtime, so any path math relative
 * to a per-file `__dirname` is meaningless after bundling. Use `getRepoRoot()`
 * for stable filesystem anchoring instead.
 */
export const getModuleDir = (metaUrl?: unknown): string => {
  if (typeof metaUrl === "string" && metaUrl.length > 0) {
    try {
      return dirname(fileURLToPath(metaUrl));
    } catch {
      // Malformed URL — fall through to argv/cwd
    }
  }
  if (process.argv[1]) {
    return dirname(process.argv[1]);
  }
  return process.cwd();
};

/**
 * Return the application root, anchored to a stable filesystem location that
 * survives bundling. Resolution order:
 *   1. `process.env.DEVX_REPO_ROOT` (set this on EC2 to `/opt/devx`).
 *   2. The directory above the entry script's directory
 *      (e.g. for `/opt/devx/dist/index.cjs` → `/opt/devx`).
 *   3. `process.cwd()` as a last resort.
 *
 * Do NOT compute this from a per-file `__dirname` and `..` traversal: in the
 * bundled CJS every module collapses into `dist/index.cjs`, so relative `..`
 * arithmetic lands in the wrong place silently.
 */
export const getRepoRoot = (): string => {
  const envRoot = process.env.DEVX_REPO_ROOT;
  if (envRoot && envRoot.trim().length > 0) {
    return envRoot.trim();
  }
  if (process.argv[1]) {
    return resolve(dirname(process.argv[1]), "..");
  }
  return process.cwd();
};
