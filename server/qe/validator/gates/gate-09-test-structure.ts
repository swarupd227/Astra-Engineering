/**
 * Gate 09 — Test Structure Atomicity
 * Detects monolithic test blocks (multiple unrelated scenarios in one test())
 * and unused 'context' destructuring in test fixtures.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';
import { GateResult, ValidationError } from '../types';

const GATE = 'gate-09-test-structure';

export async function runGate09TestStructure(outputDir: string): Promise<GateResult> {
  const start = Date.now();
  const errors: ValidationError[] = [];
  const testsDir = path.join(outputDir, 'tests');

  if (!fs.existsSync(testsDir)) {
    return { gate: GATE, passed: true, errors: [], durationMs: Date.now() - start };
  }

  const testFiles = fs.readdirSync(testsDir).filter(f => f.endsWith('.ts') || f.endsWith('.spec.ts'));

  for (const filename of testFiles) {
    const filePath = path.join(testsDir, filename);
    const relPath = `tests/${filename}`;
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');

    // Rule 1 — NO_MONOLITHIC_TEST (text-based analysis)
    const testErrors = detectMonolithicTests(content, relPath);
    errors.push(...testErrors);

    // Rule 2 — NO_UNUSED_CONTEXT (regex-based, simple and reliable)
    const contextErrors = detectUnusedContext(content, relPath, lines);
    errors.push(...contextErrors);
  }

  return { gate: GATE, passed: errors.length === 0, errors, durationMs: Date.now() - start };
}

/**
 * Detect monolithic test blocks using AST analysis.
 * A test is monolithic when it calls more than 2 top-level business actions
 * AND those actions reference more than one distinct URL path via verifyUrl().
 */
function detectMonolithicTests(source: string, relPath: string): ValidationError[] {
  const errors: ValidationError[] = [];
  const srcFile = ts.createSourceFile('_temp.ts', source, ts.ScriptTarget.Latest, true);

  // Find all test() or it() call expressions at the top level
  walkNode(srcFile, (node) => {
    if (!ts.isCallExpression(node)) return;

    const callee = node.expression;
    const calleeName = ts.isIdentifier(callee)
      ? callee.text
      : ts.isPropertyAccessExpression(callee) ? callee.name.text : '';

    if (calleeName !== 'test' && calleeName !== 'it') return;

    // Get test name (first argument)
    const testNameArg = node.arguments[0];
    const testName = ts.isStringLiteral(testNameArg) ? testNameArg.text : '(unnamed test)';

    // Get the test body (second argument — async function)
    const bodyArg = node.arguments[1];
    if (!bodyArg) return;

    // Count top-level await expressions that call a function (business actions)
    let businessActionCount = 0;
    const verifyUrlPaths: string[] = [];

    walkNode(bodyArg, (inner) => {
      if (!ts.isAwaitExpression(inner)) return;
      const expr = inner.expression;
      if (!ts.isCallExpression(expr)) return;

      // Count top-level business action calls (not nested in another await)
      const fnName = ts.isIdentifier(expr.expression)
        ? expr.expression.text
        : ts.isPropertyAccessExpression(expr.expression) ? expr.expression.name.text : '';

      // Business actions are typically imported functions (not page. or expect. methods)
      if (fnName && !fnName.startsWith('wait') && fnName !== 'prepareSite' &&
          fnName !== 'navigateTo' && fnName !== 'verifyText' &&
          fnName !== 'verifyVisible' && fnName !== 'verifyEnabled') {
        businessActionCount++;
      }

      // Collect verifyUrl() path arguments to detect multi-URL tests
      if (fnName === 'verifyUrl' && expr.arguments.length >= 2) {
        const pathArg = expr.arguments[1];
        if (ts.isStringLiteral(pathArg)) {
          verifyUrlPaths.push(pathArg.text);
        }
      }
    });

    const distinctPaths = new Set(verifyUrlPaths).size;

    if (businessActionCount > 2 && distinctPaths > 1) {
      const { line } = srcFile.getLineAndCharacterOfPosition(node.getStart());
      errors.push({
        gate: GATE,
        severity: 'major',
        file: relPath,
        line: line + 1,
        rule: 'MONOLITHIC_TEST',
        found: `Single test block "${testName}" with ${businessActionCount} business actions across ${distinctPaths} URL paths`,
        expected: 'One test block per user scenario (one URL destination per test)',
        promptFix: `Split the test "${testName}" in ${relPath} into ${distinctPaths} separate test() blocks. Each block should cover exactly one user journey and one URL destination. Each block must start with navigateTo(page, testData.baseUrl) and prepareSite(page).`,
      });
    }
  });

  return errors;
}

/**
 * Detect `async ({ page, context })` where context is never used in the test body.
 * Uses regex for simplicity — AST parsing would be overkill for this check.
 */
function detectUnusedContext(source: string, relPath: string, lines: string[]): ValidationError[] {
  const errors: ValidationError[] = [];

  lines.forEach((line, idx) => {
    const lineNum = idx + 1;

    // Match: async ({ page, context }) or async ({ context, page })
    if (!/async\s*\(\s*\{\s*(?:page\s*,\s*context|context\s*,\s*page)\s*\}/.test(line)) return;

    // Check if 'context' is used anywhere in the rest of the file
    // (simple heuristic: count occurrences after this line)
    const bodyAfter = lines.slice(idx + 1).join('\n');
    const contextUsagePattern = /\bcontext\.(newPage|waitForEvent|addCookies|route|tracing)/;

    if (!contextUsagePattern.test(bodyAfter)) {
      errors.push({
        gate: GATE,
        severity: 'major',
        file: relPath,
        line: lineNum,
        rule: 'NO_UNUSED_CONTEXT',
        found: line.trim(),
        expected: 'async ({ page }) — omit context unless it is actually used',
        promptFix: `Remove 'context' from the test fixture in ${relPath} line ${lineNum}. Use async ({ page }) => unless the test explicitly calls context.newPage() or context.waitForEvent().`,
      });
    }
  });

  return errors;
}

function walkNode(node: ts.Node, visitor: (n: ts.Node) => void): void {
  visitor(node);
  ts.forEachChild(node, child => walkNode(child, visitor));
}
