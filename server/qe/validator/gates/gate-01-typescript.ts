/**
 * Gate 01 — TypeScript Compilation
 * Runs tsc --noEmit in the generated project directory.
 * Any compile error is a BLOCKER.
 */

import { execSync } from 'child_process';
import { existsSync } from 'fs';
import * as path from 'path';
import { GateResult, ValidationError } from '../types';

const GATE = 'gate-01-typescript';

export async function runGate01Typescript(outputDir: string): Promise<GateResult> {
  const start = Date.now();

  // If tsconfig.json is missing, Gate 05 will report it — skip tsc to avoid
  // falling back to a parent tsconfig and producing thousands of false errors.
  const tsconfigPath = path.join(outputDir, 'tsconfig.json');
  if (!existsSync(tsconfigPath)) {
    return { gate: GATE, passed: true, errors: [], durationMs: Date.now() - start };
  }

  try {
    execSync('npx tsc --noEmit', { cwd: outputDir, stdio: 'pipe' });
    return { gate: GATE, passed: true, errors: [], durationMs: Date.now() - start };
  } catch (e: any) {
    const output: string = (e.stdout?.toString() || '') + (e.stderr?.toString() || '') || e.message || '';
    const errors = parseTscOutput(output, outputDir);
    return { gate: GATE, passed: errors.length === 0, errors, durationMs: Date.now() - start };
  }
}

function parseTscOutput(output: string, outputDir: string): ValidationError[] {
  // Match: path/to/file.ts(12,5): error TS2339: Property 'x' does not exist
  const lineRegex = /^(.+?)\((\d+),\d+\):\s+error\s+(TS\d+):\s+(.+)$/gm;
  const errors: ValidationError[] = [];
  let match: RegExpExecArray | null;

  // Normalise Windows backslashes so stripping outputDir prefix works on both platforms
  const normalDir = outputDir.replace(/\\/g, '/').replace(/\/$/, '');

  while ((match = lineRegex.exec(output)) !== null) {
    const [, rawFile, lineStr, tsCode, message] = match;
    const normFile = rawFile.replace(/\\/g, '/');
    const file = normFile.startsWith(normalDir + '/')
      ? normFile.slice(normalDir.length + 1)
      : normFile;

    errors.push({
      gate: GATE,
      severity: 'blocker',
      file,
      line: parseInt(lineStr, 10),
      rule: tsCode,
      found: message.trim(),
      expected: 'Zero TypeScript errors',
      promptFix: `TypeScript error in ${file} line ${lineStr}: ${message.trim()}. Fix the code to resolve this compile error.`,
    });
  }
  return errors;
}
