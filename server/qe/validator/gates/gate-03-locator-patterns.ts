/**
 * Gate 03 — Locator Pattern Safety
 * Checks all files under locators/ for fragile XPath patterns:
 *   1. Exact text equality in XPath normalize-space()    (MAJOR)
 *   2. Exact @href equality in XPath                     (MAJOR)
 */

import * as fs from 'fs';
import * as path from 'path';
import { GateResult, ValidationError } from '../types';

const GATE = 'gate-03-locator-patterns';

export async function runGate03LocatorPatterns(outputDir: string): Promise<GateResult> {
  const start = Date.now();
  const errors: ValidationError[] = [];
  const locatorsDir = path.join(outputDir, 'locators');

  if (!fs.existsSync(locatorsDir)) {
    return { gate: GATE, passed: true, errors: [], durationMs: Date.now() - start };
  }

  const files = fs.readdirSync(locatorsDir).filter(f => f.endsWith('.ts'));

  for (const filename of files) {
    const filePath = path.join(locatorsDir, filename);
    const relPath = `locators/${filename}`;
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');

    lines.forEach((line, idx) => {
      const lineNum = idx + 1;

      // Rule 1 — NO_EXACT_TEXT_EQUALITY_XPATH
      // Catches: normalize-space(text())="some text" or normalize-space(.)="some text"
      // Uses .*? (lazy) so it correctly handles nested parens inside normalize-space(text())
      const exactTextMatch = line.match(/normalize-space\(.*?\)\s*=\s*["']([^"']+)["']/);
      if (exactTextMatch) {
        const text = exactTextMatch[1];
        errors.push({
          gate: GATE,
          severity: 'major',
          file: relPath,
          line: lineNum,
          rule: 'NO_EXACT_TEXT_EQUALITY_XPATH',
          found: line.trim(),
          expected: 'contains(normalize-space(...), "text") instead of exact equality',
          promptFix: `In ${relPath} line ${lineNum}, replace exact XPath text equality normalize-space(...)="${text}" with contains(normalize-space(...), "${text}"). Exact equality breaks when the DOM has minor whitespace differences.`,
        });
      }

      // Rule 2 — NO_EXACT_HREF_EQUALITY_XPATH
      // Catches: @href="some/path" exact match
      const exactHrefMatch = line.match(/@href\s*=\s*["']([^"']+)["']/);
      if (exactHrefMatch) {
        const href = exactHrefMatch[1];
        // Extract a distinctive segment from the href for the fix suggestion
        const segments = href.split('/').filter(Boolean);
        const distinctiveSegment = segments[segments.length - 1] || href;
        errors.push({
          gate: GATE,
          severity: 'major',
          file: relPath,
          line: lineNum,
          rule: 'NO_EXACT_HREF_EQUALITY_XPATH',
          found: line.trim(),
          expected: `contains(@href, "${distinctiveSegment}") instead of exact equality`,
          promptFix: `In ${relPath} line ${lineNum}, replace @href="${href}" with contains(@href, "${distinctiveSegment}"). Exact href matching breaks in staging environments and when the domain changes.`,
        });
      }
    });
  }

  return { gate: GATE, passed: errors.length === 0, errors, durationMs: Date.now() - start };
}
