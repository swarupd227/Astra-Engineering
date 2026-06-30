#!/usr/bin/env node
/**
 * Build smoke test: forces top-level evaluation of dist/index.cjs to catch
 * the class of bug where ESM-only constructs (notably `import.meta.url`)
 * leak into the CJS bundle and throw at module-load time.
 *
 * Why this is needed
 * ------------------
 * `npm run dev` uses `tsx` (real ESM) so `import.meta.url` works. The build
 * uses esbuild `--format=cjs` to produce `dist/index.cjs`, where unguarded
 * `fileURLToPath(import.meta.url)` calls throw `ERR_INVALID_ARG_TYPE` during
 * the very first `require()` — well before Express binds a port. On EC2,
 * PM2 then crash-loops the process and nginx returns 502 indefinitely.
 *
 * What this script does
 * ---------------------
 * 1. Sets DEVX_BUILD_SMOKETEST=1 so any startup code that wants to short-
 *    circuit network/db/secret bootstrap can opt out.
 * 2. Synchronously `require()`s the bundle. If any module-load throws, that
 *    error propagates here and we exit non-zero.
 * 3. If `require()` returns successfully, the top-level evaluation passed
 *    and we exit immediately (the bundle's async startup IIFE may have been
 *    queued, but we don't let it run — no DB/secrets needed for the check).
 *
 * Failure here = ship-stopper. Fix the offending file (likely an unguarded
 * `import.meta.url`) and route it through `server/utils/module-paths.ts`.
 */

import { createRequire } from 'module';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const require = createRequire(import.meta.url);

process.env.DEVX_BUILD_SMOKETEST = '1';

const origLog = console.log;
const origInfo = console.info;
console.log = () => {};
console.info = () => {};

process.on('uncaughtException', (err) => {
  console.error = console.error || origLog;
  console.error('[build:smoketest] uncaughtException during smoke test:', err);
  process.exit(1);
});
process.on('unhandledRejection', () => {
  // Unhandled rejections from the async IIFE typically mean missing env
  // (DB/secrets/etc.) — that's fine in a build smoke test, not our concern.
  // Only the *synchronous* require() throw matters here.
});

const bundlePath = resolve(__dirname, '..', 'dist', 'index.cjs');

try {
  require(bundlePath);
} catch (err) {
  console.log = origLog;
  console.info = origInfo;
  console.error('\n[build:smoketest] FAIL — bundle threw at module-load time.');
  console.error('[build:smoketest]   Path:', bundlePath);
  console.error('[build:smoketest]   Error:', err && err.stack ? err.stack : err);
  console.error('\n[build:smoketest] If this is `ERR_INVALID_ARG_TYPE` from `fileURLToPath`,');
  console.error('[build:smoketest] some file is calling `fileURLToPath(import.meta.url)` at top');
  console.error('[build:smoketest] level. Route it through server/utils/module-paths.ts.\n');
  process.exit(1);
}

console.log = origLog;
console.info = origInfo;
console.log('[build:smoketest] OK — bundle loaded without throwing at module-load time.');
process.exit(0);
