/**
 * Gate 08 — Import Hygiene
 * Checks all .ts files for named imports that are never referenced in the file body.
 * Uses TypeScript AST parsing for accurate symbol tracking.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';
import { GateResult, ValidationError } from '../types';

const GATE = 'gate-08-imports';

// Directories to check
const CHECK_DIRS = [
  'pages',
  'actions/generic',
  'actions/business',
  'tests',
];

export async function runGate08Imports(outputDir: string): Promise<GateResult> {
  const start = Date.now();
  const errors: ValidationError[] = [];

  for (const relDir of CHECK_DIRS) {
    const fullDir = path.join(outputDir, relDir);
    if (!fs.existsSync(fullDir)) continue;

    const files = fs.readdirSync(fullDir).filter(f => f.endsWith('.ts'));
    for (const filename of files) {
      const filePath = path.join(fullDir, filename);
      const relPath = `${relDir}/${filename}`;
      const content = fs.readFileSync(filePath, 'utf-8');

      const fileErrors = findUnusedImports(content, relPath);
      errors.push(...fileErrors);
    }
  }

  return { gate: GATE, passed: errors.length === 0, errors, durationMs: Date.now() - start };
}

function findUnusedImports(source: string, relPath: string): ValidationError[] {
  const errors: ValidationError[] = [];
  const srcFile = ts.createSourceFile('_temp.ts', source, ts.ScriptTarget.Latest, true);

  // Collect all named imports: { name, importedFrom, line }
  const imports: Array<{ name: string; from: string; line: number; isTypeOnly: boolean }> = [];

  for (const stmt of srcFile.statements) {
    if (!ts.isImportDeclaration(stmt)) continue;
    if (!stmt.importClause) continue;

    const moduleSpec = (stmt.moduleSpecifier as ts.StringLiteral).text;
    const isTypeOnly = stmt.importClause.isTypeOnly;

    const namedBindings = stmt.importClause.namedBindings;
    if (!namedBindings || !ts.isNamedImports(namedBindings)) continue;

    for (const element of namedBindings.elements) {
      const localName = element.name.text;
      const elementTypeOnly = isTypeOnly || element.isTypeOnly;
      const { line } = srcFile.getLineAndCharacterOfPosition(element.getStart());
      imports.push({ name: localName, from: moduleSpec, line: line + 1, isTypeOnly: elementTypeOnly });
    }
  }

  if (imports.length === 0) return errors;

  // Count all non-import references to each name in the file body
  const refCounts = new Map<string, number>();
  for (const imp of imports) refCounts.set(imp.name, 0);

  walkNode(srcFile, (node) => {
    // Skip import declarations themselves
    if (ts.isImportDeclaration(node)) return;

    // Count identifier references in the body
    if (ts.isIdentifier(node) && refCounts.has(node.text)) {
      // Make sure we're not inside an import specifier
      const parent = node.parent;
      if (parent && ts.isImportSpecifier(parent)) return;
      if (parent && ts.isImportClause(parent)) return;
      refCounts.set(node.text, (refCounts.get(node.text) ?? 0) + 1);
    }
  });

  for (const imp of imports) {
    // Skip type-only imports — they may only appear in type positions
    if (imp.isTypeOnly) continue;

    const count = refCounts.get(imp.name) ?? 0;
    if (count === 0) {
      errors.push({
        gate: GATE,
        severity: 'major',
        file: relPath,
        line: imp.line,
        rule: 'UNUSED_IMPORT',
        found: `import { ${imp.name} } from '${imp.from}'`,
        expected: `${imp.name} must be called at least once in the file`,
        promptFix: `Remove the unused import "${imp.name}" from ${relPath}. Only import symbols that are actually called in the file.`,
      });
    }
  }

  return errors;
}

function walkNode(node: ts.Node, visitor: (n: ts.Node) => void): void {
  visitor(node);
  ts.forEachChild(node, child => walkNode(child, visitor));
}
