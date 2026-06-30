/**
 * Gate 06 — Class and File Naming
 * Checks that no generated class name in pages/ or locators/ is a garbled
 * string (session ID, recording artifact, random alphanumeric).
 */

import * as fs from 'fs';
import * as path from 'path';
import { GateResult, ValidationError } from '../types';

const GATE = 'gate-06-naming';

export async function runGate06Naming(outputDir: string): Promise<GateResult> {
  const start = Date.now();
  const errors: ValidationError[] = [];

  const dirsToCheck = [
    { dir: path.join(outputDir, 'pages'),    prefix: 'pages/' },
    { dir: path.join(outputDir, 'locators'), prefix: 'locators/' },
  ];

  for (const { dir, prefix } of dirsToCheck) {
    if (!fs.existsSync(dir)) continue;
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.ts'));

    for (const filename of files) {
      const filePath = path.join(dir, filename);
      const relPath = `${prefix}${filename}`;
      const content = fs.readFileSync(filePath, 'utf-8');

      // Extract the first exported class or const name
      const name = extractPrimaryName(content);
      if (!name) continue;

      if (isGarbledName(name)) {
        errors.push({
          gate: GATE,
          severity: 'blocker',
          file: relPath,
          rule: 'GARBLED_CLASS_NAME',
          found: name,
          expected: 'PascalCase name derived from page URL or page title',
          promptFix: `The class name "${name}" in ${relPath} appears to be a session ID or random string. Rename it using the page URL: take the last 1-2 meaningful path segments, convert hyphens to PascalCase, prepend the brand name, append Page. Example: brand.com/contact-us → BrandContactUsPage.`,
        });
      }
    }
  }

  return { gate: GATE, passed: errors.length === 0, errors, durationMs: Date.now() - start };
}

/**
 * Detect garbled/random class names. Returns true when the name looks like a
 * session token, recording channel ID, or other non-English alphanumeric string.
 */
function isGarbledName(name: string): boolean {
  // Strip common suffixes before analysis
  const coreName = name.replace(/Page$|Locators$/, '');
  if (coreName.length < 3) return false;

  // Pattern 1: 4+ consecutive consonants — not natural English
  const consonantRun = /[bcdfghjklmnpqrstvwxyzBCDFGHJKLMNPQRSTVWXYZ]{4,}/;
  if (consonantRun.test(coreName)) return true;

  // Pattern 2: mixed alphanumeric like a session ID (letter-digit-letter-digit or similar)
  const sessionIdPattern = /[a-z][0-9][a-z][0-9]|[0-9][a-z][0-9][a-z]/i;
  if (sessionIdPattern.test(coreName)) return true;

  // Pattern 3: 8+ char all-lowercase run (possibly followed by PascalCase tail)
  // e.g. "gvvvgdmiq" in GvvvGdmiqjccvc7cMessenger
  const randomLower = /[a-z]{8,}/;
  if (randomLower.test(coreName)) return true;

  return false;
}

/** Extract the primary exported identifier from a TypeScript source file */
function extractPrimaryName(source: string): string | null {
  // Match: export class ClassName or export const ClassName
  const classMatch = source.match(/export\s+class\s+([A-Za-z_]\w*)/);
  if (classMatch) return classMatch[1];

  const constMatch = source.match(/export\s+const\s+([A-Za-z_]\w*)/);
  if (constMatch) return constMatch[1];

  return null;
}
