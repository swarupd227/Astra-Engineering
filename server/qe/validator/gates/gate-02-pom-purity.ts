/**
 * Gate 02 — POM Layer Purity
 * Checks all files under pages/ for three violations:
 *   1. expect() calls inside a POM file                  (BLOCKER)
 *   2. Hardcoded absolute URLs in page.goto()             (BLOCKER)
 *   3. Method names starting with assert/verify           (MAJOR)
 */

import * as fs from 'fs';
import * as path from 'path';
import { GateResult, ValidationError } from '../types';

const GATE = 'gate-02-pom-purity';

export async function runGate02PomPurity(outputDir: string): Promise<GateResult> {
  const start = Date.now();
  const errors: ValidationError[] = [];
  const pagesDir = path.join(outputDir, 'pages');

  if (!fs.existsSync(pagesDir)) {
    return { gate: GATE, passed: true, errors: [], durationMs: Date.now() - start };
  }

  const files = fs.readdirSync(pagesDir).filter(f => f.endsWith('.ts'));

  for (const filename of files) {
    const filePath = path.join(pagesDir, filename);
    const relPath = `pages/${filename}`;
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');

    lines.forEach((line, idx) => {
      const lineNum = idx + 1;

      // Rule 1 — NO_EXPECT_IN_POM
      if (/await\s+expect\s*\(|import\s*\{[^}]*\bexpect\b/.test(line)) {
        errors.push({
          gate: GATE,
          severity: 'blocker',
          file: relPath,
          line: lineNum,
          rule: 'NO_EXPECT_IN_POM',
          found: line.trim(),
          expected: 'No expect() calls in POM layer',
          promptFix: `Remove all expect() calls from ${relPath}. The POM layer must only interact with the DOM. Move assertions to the business actions layer (actions/business/) using verifyText(), verifyUrl(), verifyVisible(), or verifyNotPresent().`,
        });
      }

      // Rule 2 — NO_HARDCODED_URL_IN_POM
      const urlMatch = line.match(/page\.goto\s*\(\s*['"`]https?:\/\//);
      if (urlMatch) {
        errors.push({
          gate: GATE,
          severity: 'blocker',
          file: relPath,
          line: lineNum,
          rule: 'NO_HARDCODED_URL_IN_POM',
          found: line.trim(),
          expected: 'Relative path in goto() e.g. this.page.goto(\'/path\')',
          promptFix: `Replace the hardcoded URL in ${relPath} line ${lineNum} with a relative path. Use await this.page.goto('/path') — Playwright resolves it against baseURL in playwright.config.ts.`,
        });
      }

      // Rule 3 — NO_ASSERT_VERB_IN_POM_METHOD
      const assertMethodMatch = line.match(/async\s+(assert|verify)([A-Z]\w*)\s*\(/);
      if (assertMethodMatch) {
        const methodName = assertMethodMatch[1] + assertMethodMatch[2];
        errors.push({
          gate: GATE,
          severity: 'major',
          file: relPath,
          line: lineNum,
          rule: 'NO_ASSERT_VERB_IN_POM_METHOD',
          found: `async ${methodName}(`,
          expected: 'Action verb prefix: click, fill, select, navigate, get, wait',
          promptFix: `Rename method ${methodName} in ${relPath}. POM methods must use action verbs (click, fill, select, navigate, get, wait). Rename to get${assertMethodMatch[2]}() if it returns a value, or waitFor${assertMethodMatch[2]}() if it waits for a state.`,
        });
      }
    });
  }

  return { gate: GATE, passed: errors.length === 0, errors, durationMs: Date.now() - start };
}
