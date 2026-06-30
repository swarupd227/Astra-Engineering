/**
 * Gate 10 — Config Values
 * Checks playwright.config.ts and package.json for required configuration values.
 */

import * as fs from 'fs';
import * as path from 'path';
import { GateResult, ValidationError } from '../types';

const GATE = 'gate-10-config-values';

export async function runGate10ConfigValues(outputDir: string): Promise<GateResult> {
  const start = Date.now();
  const errors: ValidationError[] = [];

  errors.push(...checkPlaywrightConfig(outputDir));
  errors.push(...checkPackageJson(outputDir));

  return { gate: GATE, passed: errors.length === 0, errors, durationMs: Date.now() - start };
}

function checkPlaywrightConfig(outputDir: string): ValidationError[] {
  const errors: ValidationError[] = [];
  const configPath = path.join(outputDir, 'playwright.config.ts');

  if (!fs.existsSync(configPath)) return errors; // Gate 05 handles missing file

  const content = fs.readFileSync(configPath, 'utf-8');
  const lines = content.split('\n');

  lines.forEach((line, idx) => {
    const lineNum = idx + 1;
    const trimmed = line.trim();

    // RULE: FULLPARALLEL_MUST_BE_TRUE
    if (/fullyParallel\s*:\s*false/.test(trimmed)) {
      errors.push({
        gate: GATE,
        severity: 'major',
        file: 'playwright.config.ts',
        line: lineNum,
        rule: 'FULLPARALLEL_MUST_BE_TRUE',
        found: trimmed,
        expected: 'fullyParallel: true',
        promptFix: 'Change fullyParallel: false to fullyParallel: true in playwright.config.ts.',
      });
    }

    // RULE: BASE_URL_MUST_USE_ENV_VAR
    // Catches: baseURL: 'https://...' (hardcoded, no env var)
    if (/baseURL\s*:/.test(trimmed) && !trimmed.includes('process.env')) {
      // Only flag if it's a hardcoded string (contains a quote with http)
      if (/baseURL\s*:\s*['"`]https?:\/\//.test(trimmed)) {
        errors.push({
          gate: GATE,
          severity: 'blocker',
          file: 'playwright.config.ts',
          line: lineNum,
          rule: 'BASE_URL_MUST_USE_ENV_VAR',
          found: trimmed,
          expected: "baseURL: process.env.BASE_URL || 'https://fallback-url.com'",
          promptFix: "Replace the hardcoded baseURL in playwright.config.ts with: baseURL: process.env.BASE_URL || 'https://fallback-url.com'",
        });
      }
    }
  });

  return errors;
}

function checkPackageJson(outputDir: string): ValidationError[] {
  const errors: ValidationError[] = [];
  const pkgPath = path.join(outputDir, 'package.json');

  if (!fs.existsSync(pkgPath)) return errors; // Gate 05 handles missing file

  let pkg: Record<string, any>;
  try {
    pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
  } catch {
    return errors; // JSON parse error — not this gate's concern
  }

  const allDeps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };

  // RULE: PLAYWRIGHT_VERSION_MINIMUM
  const playwrightVersion = allDeps['@playwright/test'] as string | undefined;
  if (playwrightVersion) {
    const { major, minor } = parseSemver(playwrightVersion);
    if (major < 1 || (major === 1 && minor < 50)) {
      errors.push({
        gate: GATE,
        severity: 'major',
        file: 'package.json',
        rule: 'PLAYWRIGHT_VERSION_MINIMUM',
        found: `"@playwright/test": "${playwrightVersion}"`,
        expected: '"@playwright/test": "^1.52.0" or higher',
        promptFix: 'Update @playwright/test to ^1.52.0 in package.json.',
      });
    }
  }

  // RULE: TYPESCRIPT_VERSION_MINIMUM
  const tsVersion = allDeps['typescript'] as string | undefined;
  if (tsVersion) {
    const { major, minor } = parseSemver(tsVersion);
    if (major < 5 || (major === 5 && minor < 5)) {
      errors.push({
        gate: GATE,
        severity: 'warning',
        file: 'package.json',
        rule: 'TYPESCRIPT_VERSION_MINIMUM',
        found: `"typescript": "${tsVersion}"`,
        expected: '"typescript": "^5.5.0" or higher',
        promptFix: 'Update typescript to ^5.5.0 in package.json.',
      });
    }
  }

  return errors;
}

/** Parse a semver string like "^1.52.0", "~5.4.0", "1.44" into {major, minor, patch} */
function parseSemver(version: string): { major: number; minor: number; patch: number } {
  const cleaned = version.replace(/^[\^~>=<\s]+/, '');
  const parts = cleaned.split('.').map(p => parseInt(p, 10) || 0);
  return { major: parts[0] ?? 0, minor: parts[1] ?? 0, patch: parts[2] ?? 0 };
}
