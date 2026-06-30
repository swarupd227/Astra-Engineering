/**
 * Formats ValidationErrors into a terse, actionable string that gets injected
 * back into the Claude generation prompt on retry.
 */

import { ValidationError } from './types';

export function buildPromptForRetry(
  blockers: ValidationError[],
  majors: ValidationError[]
): string {
  const lines: string[] = [
    'The previously generated code failed post-generation validation.',
    'You MUST fix ALL of the following issues before the output is acceptable.',
    'Do not regenerate files that passed — only fix the files listed below.',
    '',
  ];

  if (blockers.length > 0) {
    lines.push(`BLOCKERS (${blockers.length}) — must be fixed, project cannot compile or run:`);
    for (const e of blockers) {
      lines.push(`  [${e.rule}] ${e.file}${e.line ? `:${e.line}` : ''}`);
      lines.push(`    Found:    ${e.found}`);
      lines.push(`    Fix:      ${e.promptFix}`);
    }
    lines.push('');
  }

  if (majors.length > 0) {
    lines.push(`MAJORS (${majors.length}) — must be fixed, tests will produce wrong results:`);
    for (const e of majors) {
      lines.push(`  [${e.rule}] ${e.file}${e.line ? `:${e.line}` : ''}`);
      lines.push(`    Found:    ${e.found}`);
      lines.push(`    Fix:      ${e.promptFix}`);
    }
  }

  return lines.join('\n');
}
