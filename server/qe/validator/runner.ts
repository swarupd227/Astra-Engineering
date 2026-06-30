/**
 * Retry Runner — generate → validate → retry loop
 *
 * Orchestrates up to MAX_RETRIES generation attempts. On each failure,
 * the ValidationResult's promptForRetry string is injected back into the
 * next generation call so Claude knows exactly what to fix.
 */

import * as fs from 'fs';
import { validateGeneratedProject } from './index';
import { ValidationResult } from './types';

const MAX_RETRIES = 3;

export interface RecordingSession {
  id: string;
  startUrl: string;
  testName: string;
  nlSteps: string[];
  [key: string]: unknown;
}

export class GenerationValidationError extends Error {
  constructor(message: string, public readonly result: ValidationResult) {
    super(message);
    this.name = 'GenerationValidationError';
  }
}

/**
 * Run the generate → validate → retry loop.
 *
 * @param session         The recording session to generate from.
 * @param generateFn      Async function that synthesises code and writes it to a temp dir,
 *                        returning the output directory path.
 *                        On retries, retryContext is the promptForRetry string from the
 *                        previous validation failure — inject it into the Claude prompt.
 */
export async function generateWithValidation(
  session: RecordingSession,
  generateFn: (session: RecordingSession, retryContext?: string) => Promise<string>
): Promise<{ outputDir: string; result: ValidationResult; attempts: number }> {

  let retryContext: string | undefined = undefined;
  let lastResult: ValidationResult | undefined = undefined;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const outputDir = await generateFn(session, retryContext);
    const result = await validateGeneratedProject(outputDir);

    if (result.passed) {
      console.log(`✅ Validation passed on attempt ${attempt}`);
      return { outputDir, result, attempts: attempt };
    }

    const gatesSummary = result.gates
      .filter(g => !g.passed)
      .map(g => `${g.gate}(${g.errors.length})`)
      .join(', ');

    console.warn(
      `⚠️  Attempt ${attempt}/${MAX_RETRIES} failed: ` +
      `${result.blockers.length} blockers, ${result.majors.length} majors, ` +
      `${result.warnings.length} warnings — failed gates: [${gatesSummary}]`
    );

    if (attempt < MAX_RETRIES) {
      retryContext = result.promptForRetry;
      // Clean up failed output before retry to avoid stale files bleeding into next run
      try {
        await fs.promises.rm(outputDir, { recursive: true, force: true });
      } catch {
        // ignore cleanup errors — directory may have already been cleaned
      }
    } else {
      lastResult = result;
    }
  }

  // All retries exhausted — surface the last result as an error
  throw new GenerationValidationError(
    `Generation failed validation after ${MAX_RETRIES} attempts. ` +
    `Last run: ${lastResult!.blockers.length} blockers, ${lastResult!.majors.length} majors.`,
    lastResult!
  );
}
