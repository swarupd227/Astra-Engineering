/**
 * Gate 05 — Required File Manifest
 * Verifies that every required file and directory exists in the generated project.
 */

import * as fs from 'fs';
import * as path from 'path';
import { GateResult, ValidationError } from '../types';

const GATE = 'gate-05-file-manifest';

const REQUIRED_FILES = [
  'helpers/universal.ts',
  'playwright.config.ts',
  'tsconfig.json',
  'package.json',
  'fixtures/test-data.ts',
  '.env.example',
];

const REQUIRED_DIRECTORIES = [
  'locators',
  'pages',
  'actions/generic',
  'actions/business',
  'tests',
];

export async function runGate05FileManifest(outputDir: string): Promise<GateResult> {
  const start = Date.now();
  const errors: ValidationError[] = [];

  // Check required files
  for (const relFile of REQUIRED_FILES) {
    const fullPath = path.join(outputDir, relFile);
    if (!fs.existsSync(fullPath)) {
      errors.push({
        gate: GATE,
        severity: 'blocker',
        file: relFile,
        rule: 'REQUIRED_FILE_MISSING',
        found: `File not found: ${relFile}`,
        expected: `${relFile} must exist in every generated project`,
        promptFix: `The file ${relFile} is missing from the generated project. Generate it now. Its required content is defined in the generator's static output manifest.`,
      });
    }
  }

  // Check required directories (must exist and have at least one .ts file)
  for (const relDir of REQUIRED_DIRECTORIES) {
    const fullPath = path.join(outputDir, relDir);
    if (!fs.existsSync(fullPath)) {
      errors.push({
        gate: GATE,
        severity: 'blocker',
        file: relDir,
        rule: 'REQUIRED_DIRECTORY_EMPTY',
        found: `Directory not found: ${relDir}`,
        expected: `${relDir}/ must exist and contain at least one .ts file`,
        promptFix: `The directory ${relDir}/ is missing from the generated project. Create it and add the appropriate TypeScript files.`,
      });
      continue;
    }

    // Check it contains at least one .ts file (recursively for nested dirs)
    const hasTs = containsAnyTs(fullPath);
    if (!hasTs) {
      errors.push({
        gate: GATE,
        severity: 'blocker',
        file: relDir,
        rule: 'REQUIRED_DIRECTORY_EMPTY',
        found: `Directory exists but contains no .ts files: ${relDir}`,
        expected: `${relDir}/ must contain at least one .ts file`,
        promptFix: `The directory ${relDir}/ exists but is empty. Generate the required TypeScript file(s) for this layer.`,
      });
    }
  }

  return { gate: GATE, passed: errors.length === 0, errors, durationMs: Date.now() - start };
}

function containsAnyTs(dir: string): boolean {
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith('.ts')) return true;
      if (entry.isDirectory()) {
        if (containsAnyTs(path.join(dir, entry.name))) return true;
      }
    }
  } catch {
    // ignore read errors
  }
  return false;
}
