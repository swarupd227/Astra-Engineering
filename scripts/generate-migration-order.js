#!/usr/bin/env node
/**
 * Regenerates migrations/migration-order.json incremental file list from migrations/manual/.
 * Run: node scripts/generate-migration-order.js
 */
import { readdirSync, writeFileSync, readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_ROOT = join(__dirname, '..', 'migrations');
const MANIFEST_PATH = join(MIGRATIONS_ROOT, 'migration-order.json');

const BASELINE_EXCLUDE = new Set([
  '01_schema_new1.sql',
  '02_seed.sql',
  'SEED_DATA.sql',
  'RUN_THIS_NOW.sql',
  'seed-subscription-types.sql',
  'fix-schema.sql',
  'fix-subscription-types-id-type.sql',
]);

function listManualIncrementals() {
  const manualDir = join(MIGRATIONS_ROOT, 'manual');
  return readdirSync(manualDir)
    .filter((f) => f.endsWith('.sql') && !BASELINE_EXCLUDE.has(f))
    .sort()
    .map((f) => `manual/${f}`);
}

function loadExistingManifest() {
  if (!existsSync(MANIFEST_PATH)) return null;
  return JSON.parse(readFileSync(MANIFEST_PATH, 'utf-8'));
}

const incrementals = listManualIncrementals();
const existing = loadExistingManifest();

function mergeIncrementalFiles(existingFiles, discoveredFiles) {
  const discovered = new Set(discoveredFiles);
  const merged = [];

  for (const file of existingFiles || []) {
    if (discovered.has(file)) {
      merged.push(file);
      discovered.delete(file);
    }
  }

  return [...merged, ...Array.from(discovered).sort()];
}

const defaultManifest = {
  version: 2,
  description:
    'Full prod schema in baseline/00_full_schema.sql (regenerate: npm run generate:full-schema). Incrementals: npm run migrate:order:generate',
  phases: [
    {
      name: 'legacy_schema_prep',
      description: 'Fix legacy schema mismatches before baseline (e.g. INT subscription_types.id)',
      mode: 'statements',
      ignoreExists: true,
      strict: true,
      files: ['manual/fix-subscription-types-id-type.sql'],
    },
    {
      name: 'full_schema_baseline',
      description: 'All tables — prod parity (176+ CREATE TABLE IF NOT EXISTS)',
      mode: 'multiStatement',
      ignoreExists: true,
      strict: true,
      files: ['baseline/00_full_schema.sql'],
    },
    {
      name: 'incremental_manual',
      description: 'Column and constraint patches after baseline',
      mode: 'statements',
      ignoreExists: true,
      strict: true,
      files: incrementals,
    },
    {
      name: 'seed_reference_data',
      description: 'Roles, subscription types, default personas (idempotent)',
      mode: 'multiStatement',
      ignoreExists: true,
      optional: true,
      env: 'RUN_DB_SEED',
      files: ['manual/02_seed.sql'],
    },
  ],
};

const manifest = existing ?? defaultManifest;
const incrementalPhase = manifest.phases?.find((phase) => phase.name === 'incremental_manual');

if (!incrementalPhase) {
  throw new Error('migration-order.json is missing the incremental_manual phase');
}

incrementalPhase.files = mergeIncrementalFiles(incrementalPhase.files, incrementals);

writeFileSync(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`, 'utf-8');
console.log(`✅ Wrote ${MANIFEST_PATH}`);
console.log(`   Incremental files: ${incrementals.length}`);
