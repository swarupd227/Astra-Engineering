/**
 * Gate 07 — Fixture PII Detection
 * Checks fixtures/test-data.ts for personal data in default values.
 * Catches real email addresses, short personal names, and bare numeric strings.
 */

import * as fs from 'fs';
import * as path from 'path';
import { GateResult, ValidationError } from '../types';

const GATE = 'gate-07-fixtures';

// Values that are explicitly safe (not personal data)
const SAFE_EMAIL_DOMAINS = new Set(['example.com', 'test.com', 'example.org', 'test.org']);
const SAFE_WORDS = new Set(['test', 'user', 'admin', 'guest', 'demo', 'sample', 'testco', 'testvalue']);

export async function runGate07Fixtures(outputDir: string): Promise<GateResult> {
  const start = Date.now();
  const errors: ValidationError[] = [];
  const fixturesFile = path.join(outputDir, 'fixtures', 'test-data.ts');

  if (!fs.existsSync(fixturesFile)) {
    // Gate 05 handles missing files; skip here
    return { gate: GATE, passed: true, errors: [], durationMs: Date.now() - start };
  }

  const content = fs.readFileSync(fixturesFile, 'utf-8');
  const lines = content.split('\n');

  lines.forEach((line, idx) => {
    const lineNum = idx + 1;

    // Extract default values from patterns like: || "value" or || 'value'
    const defaultMatch = line.match(/\|\|\s*['"]([^'"]+)['"]/);
    if (!defaultMatch) return;
    const value = defaultMatch[1];

    // Rule 1 — NO_REAL_EMAIL_IN_FIXTURE (BLOCKER)
    if (isRealEmail(value)) {
      errors.push({
        gate: GATE,
        severity: 'blocker',
        file: 'fixtures/test-data.ts',
        line: lineNum,
        rule: 'NO_REAL_EMAIL_IN_FIXTURE',
        found: value,
        expected: 'Generic placeholder e.g. test-user@example.com',
        promptFix: `Replace the email default value "${value}" in fixtures/test-data.ts with "test-user@example.com". Never record real email addresses in fixture defaults.`,
      });
      return;
    }

    // Rule 2 — NO_SHORT_PERSONAL_NAME (MAJOR)
    if (isLikelyPersonalName(value)) {
      errors.push({
        gate: GATE,
        severity: 'major',
        file: 'fixtures/test-data.ts',
        line: lineNum,
        rule: 'NO_SHORT_PERSONAL_NAME',
        found: value,
        expected: 'Generic placeholder e.g. "Test" or "User"',
        promptFix: `Replace the default value "${value}" in fixtures/test-data.ts with a generic placeholder like "Test" (for first name) or "User" (for last name).`,
      });
      return;
    }

    // Rule 3 — NO_NUMERIC_ONLY_SHORT_STRING (WARNING)
    if (/^\d+$/.test(value) && value.length < 5) {
      errors.push({
        gate: GATE,
        severity: 'warning',
        file: 'fixtures/test-data.ts',
        line: lineNum,
        rule: 'NO_NUMERIC_ONLY_SHORT_STRING',
        found: value,
        expected: 'Full placeholder number e.g. "0000000000" or "10001"',
        promptFix: `Replace default value "${value}" in fixtures/test-data.ts with "0000000000" for phone fields or a descriptive placeholder.`,
      });
    }
  });

  return { gate: GATE, passed: errors.length === 0, errors, durationMs: Date.now() - start };
}

/** Returns true if the value looks like a real (non-placeholder) email address */
function isRealEmail(value: string): boolean {
  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailPattern.test(value)) return false;

  // Allow explicitly safe placeholder domains
  const domain = value.split('@')[1].toLowerCase();
  if (SAFE_EMAIL_DOMAINS.has(domain)) return false;

  return true;
}

/**
 * Returns true if the value looks like a personal name:
 *  - 2–12 characters
 *  - All lowercase letters only
 *  - Not in the safe-words list
 */
function isLikelyPersonalName(value: string): boolean {
  if (value.length < 2 || value.length > 12) return false;
  if (!/^[a-z]+$/.test(value)) return false; // must be all lowercase alpha
  if (SAFE_WORDS.has(value.toLowerCase())) return false;
  return true;
}
