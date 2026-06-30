/**
 * Post-Generation Validator — Main Entry Point
 *
 * Runs all 10 validation gates against a generated project directory.
 * Returns a structured ValidationResult. If passed === false, promptForRetry
 * contains the error text to inject back into the Claude generation prompt.
 */

import { ValidationResult, GateResult } from './types';
import { buildPromptForRetry } from './reporter';
import { runGate01Typescript } from './gates/gate-01-typescript';
import { runGate02PomPurity } from './gates/gate-02-pom-purity';
import { runGate03LocatorPatterns } from './gates/gate-03-locator-patterns';
import { runGate04MethodContracts } from './gates/gate-04-method-contracts';
import { runGate05FileManifest } from './gates/gate-05-file-manifest';
import { runGate06Naming } from './gates/gate-06-naming';
import { runGate07Fixtures } from './gates/gate-07-fixtures';
import { runGate08Imports } from './gates/gate-08-imports';
import { runGate09TestStructure } from './gates/gate-09-test-structure';
import { runGate10ConfigValues } from './gates/gate-10-config-values';

export type { ValidationResult, GateResult } from './types';
export { GenerationValidationError } from './runner';

export async function validateGeneratedProject(outputDir: string): Promise<ValidationResult> {
  // Gates 01 (TypeScript compile) requires node_modules to be present.
  // All other gates are pure static analysis — they run in parallel.
  const [
    g01, g02, g03, g04, g05, g06, g07, g08, g09, g10
  ]: GateResult[] = await Promise.all([
    runGate01Typescript(outputDir),
    runGate02PomPurity(outputDir),
    runGate03LocatorPatterns(outputDir),
    runGate04MethodContracts(outputDir),
    runGate05FileManifest(outputDir),
    runGate06Naming(outputDir),
    runGate07Fixtures(outputDir),
    runGate08Imports(outputDir),
    runGate09TestStructure(outputDir),
    runGate10ConfigValues(outputDir),
  ]);

  const gates: GateResult[] = [g01, g02, g03, g04, g05, g06, g07, g08, g09, g10];
  const allErrors = gates.flatMap(g => g.errors);
  const blockers = allErrors.filter(e => e.severity === 'blocker');
  const majors   = allErrors.filter(e => e.severity === 'major');
  const warnings = allErrors.filter(e => e.severity === 'warning');

  // Warnings do not block delivery — only blockers and majors do
  const passed = blockers.length === 0 && majors.length === 0;

  return {
    passed,
    outputDir,
    gates,
    blockers,
    majors,
    warnings,
    totalErrors: allErrors.length,
    promptForRetry: passed ? '' : buildPromptForRetry(blockers, majors),
  };
}
