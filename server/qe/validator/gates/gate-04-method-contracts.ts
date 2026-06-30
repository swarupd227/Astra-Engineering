/**
 * Gate 04 — Method Contract Verification
 * Verifies that every method called on a POM instance in business actions
 * actually exists as a defined method in that POM class.
 * Uses TypeScript AST parsing (ts.createSourceFile) for accuracy.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';
import { GateResult, ValidationError } from '../types';

const GATE = 'gate-04-method-contracts';

type MethodRegistry = Map<string, Set<string>>; // ClassName → Set<methodName>

export async function runGate04MethodContracts(outputDir: string): Promise<GateResult> {
  const start = Date.now();
  const errors: ValidationError[] = [];
  const pagesDir = path.join(outputDir, 'pages');
  const actionsDir = path.join(outputDir, 'actions', 'business');

  if (!fs.existsSync(pagesDir) || !fs.existsSync(actionsDir)) {
    return { gate: GATE, passed: true, errors: [], durationMs: Date.now() - start };
  }

  // STEP 1 — Build method registry from all pages/*.ts files
  const registry: MethodRegistry = new Map();
  const pageFiles = fs.readdirSync(pagesDir).filter(f => f.endsWith('.ts'));

  for (const filename of pageFiles) {
    const content = fs.readFileSync(path.join(pagesDir, filename), 'utf-8');
    const className = extractClassName(content);
    if (!className) continue;
    const methods = extractClassMethods(content);
    registry.set(className, methods);
  }

  // STEP 2 — Scan every business action file for POM method calls
  const actionFiles = fs.readdirSync(actionsDir).filter(f => f.endsWith('.ts'));

  for (const filename of actionFiles) {
    const filePath = path.join(actionsDir, filename);
    const relPath = `actions/business/${filename}`;
    const content = fs.readFileSync(filePath, 'utf-8');

    const fileErrors = verifyMethodCalls(content, relPath, registry);
    errors.push(...fileErrors);
  }

  return { gate: GATE, passed: errors.length === 0, errors, durationMs: Date.now() - start };
}

/** Extract the first exported class name from a TypeScript source file */
function extractClassName(source: string): string | null {
  const srcFile = ts.createSourceFile('_temp.ts', source, ts.ScriptTarget.Latest, true);
  for (const stmt of srcFile.statements) {
    if (
      ts.isClassDeclaration(stmt) &&
      stmt.name &&
      stmt.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword)
    ) {
      return stmt.name.text;
    }
  }
  return null;
}

/** Extract all public async method names from a class declaration */
function extractClassMethods(source: string): Set<string> {
  const methods = new Set<string>();
  const srcFile = ts.createSourceFile('_temp.ts', source, ts.ScriptTarget.Latest, true);

  for (const stmt of srcFile.statements) {
    if (!ts.isClassDeclaration(stmt)) continue;
    for (const member of stmt.members) {
      if (!ts.isMethodDeclaration(member)) continue;
      // Skip private methods
      const isPrivate = member.modifiers?.some(m => m.kind === ts.SyntaxKind.PrivateKeyword);
      if (isPrivate) continue;
      if (ts.isIdentifier(member.name)) {
        methods.add(member.name.text);
      }
    }
  }
  return methods;
}

/** Check all POM method calls in a business action file against the registry */
function verifyMethodCalls(
  source: string,
  relPath: string,
  registry: MethodRegistry
): ValidationError[] {
  const errors: ValidationError[] = [];
  const srcFile = ts.createSourceFile('_temp.ts', source, ts.ScriptTarget.Latest, true);

  // Map: variable name → class name, built from `new ClassName(page)` expressions
  const varToClass = new Map<string, string>();

  // First pass: collect all `const varName = new ClassName(page)` assignments
  collectInstantiations(srcFile, varToClass, registry);

  // Second pass: find all `await varName.methodName()` calls
  walkNode(srcFile, (node) => {
    if (!ts.isCallExpression(node)) return;
    const expr = node.expression;
    if (!ts.isPropertyAccessExpression(expr)) return;
    const obj = expr.expression;
    if (!ts.isIdentifier(obj)) return;

    const varName = obj.text;
    const methodName = expr.name.text;
    const className = varToClass.get(varName);
    if (!className) return; // not a POM variable — skip

    const classRegistry = registry.get(className);
    if (!classRegistry) return; // class not in registry — skip (may be from another module)

    if (!classRegistry.has(methodName)) {
      // Get line number from source position
      const { line } = srcFile.getLineAndCharacterOfPosition(node.getStart());
      const availableMethods = Array.from(classRegistry).join(', ');
      errors.push({
        gate: GATE,
        severity: 'blocker',
        file: relPath,
        line: line + 1,
        rule: 'METHOD_NOT_IN_POM',
        found: `${varName}.${methodName}()`,
        expected: `Method ${methodName} to exist in class ${className}`,
        promptFix: `In ${relPath} line ${line + 1}, the call ${varName}.${methodName}() does not exist in ${className}. Available methods are: ${availableMethods}. Use one of these exact names or add the missing method to the POM first.`,
      });
    }
  });

  return errors;
}

/** Walk an AST node and all its descendants, calling visitor on each */
function walkNode(node: ts.Node, visitor: (n: ts.Node) => void): void {
  visitor(node);
  ts.forEachChild(node, child => walkNode(child, visitor));
}

/** Collect `const varName = new ClassName(page)` assignments into varToClass map */
function collectInstantiations(
  srcFile: ts.SourceFile,
  varToClass: Map<string, string>,
  registry: MethodRegistry
): void {
  walkNode(srcFile, (node) => {
    // Match: const varName = new ClassName(...)
    if (!ts.isVariableDeclaration(node)) return;
    if (!node.initializer) return;
    if (!ts.isNewExpression(node.initializer)) return;
    const ctor = node.initializer.expression;
    if (!ts.isIdentifier(ctor)) return;
    const className = ctor.text;
    if (!registry.has(className)) return; // not a known POM class
    if (ts.isIdentifier(node.name)) {
      varToClass.set(node.name.text, className);
    }
  });
}
