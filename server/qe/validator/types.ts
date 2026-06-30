/**
 * Shared types for the post-generation validator.
 * All gates produce GateResult objects; the main entry point aggregates them into ValidationResult.
 */

export type Severity = 'blocker' | 'major' | 'warning';

export interface ValidationError {
  gate: string;       // e.g. "gate-02-pom-purity"
  severity: Severity;
  file: string;       // relative path from outputDir e.g. "pages/OnespanHomePage.ts"
  line?: number;      // line number if detectable
  rule: string;       // short rule code e.g. "NO_EXPECT_IN_POM"
  found: string;      // what was found e.g. "await expect(loc).toBeVisible()"
  expected: string;   // what should be there
  promptFix: string;  // sentence injected back into generation prompt on retry
}

export interface GateResult {
  gate: string;
  passed: boolean;
  errors: ValidationError[];
  durationMs: number;
}

export interface ValidationResult {
  passed: boolean;
  outputDir: string;
  gates: GateResult[];
  blockers: ValidationError[];
  majors: ValidationError[];
  warnings: ValidationError[];
  totalErrors: number;
  promptForRetry: string; // aggregated re-injection string, empty if passed
}
