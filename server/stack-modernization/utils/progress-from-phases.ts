/**
 * Compute progress (0-100) based only on selected phases and their completion.
 * Unselected phases are ignored so that e.g. disabling validation doesn't cap progress at 80%.
 */

import type { StackModernizationState } from "../types";
import type { SelectablePhase } from "../types";

const ALL_PHASES: SelectablePhase[] = [
  "assessment",
  "planning",
  "tasks",
  "execution",
  "tests",
  "validation",
];

function isPhaseCompleted(phase: SelectablePhase, state: StackModernizationState): boolean {
  switch (phase) {
    case "assessment":
      return !!state.repoProfile;
    case "planning":
      return !!(state.planMarkdown || state.riskReport);
    case "tasks":
      return !!(state.upgradeTasks && state.upgradeTasks.length > 0);
    case "execution": {
      const hasModified =
        (state.modifiedFiles && state.modifiedFiles.length > 0) ||
        (state.codeUpgrade?.modifiedFiles && state.codeUpgrade.modifiedFiles.length > 0);
      return !!hasModified;
    }
    case "tests":
      return !!(state.generatedTests && state.generatedTests.length > 0);
    case "validation":
      return !!state.validationRun;
    default:
      return false;
  }
}

/**
 * When selectedPhases is missing (e.g. old analysis or not sent), infer that
 * if tests are done and validation was never run, the user had tests as last phase → 100%.
 */
function inferEffectiveSelectedPhases(state: StackModernizationState): SelectablePhase[] {
  const hasTests = !!(state.generatedTests && state.generatedTests.length > 0);
  const hasValidation = !!state.validationRun;
  if (hasTests && !hasValidation) {
    return ["assessment", "planning", "tasks", "execution", "tests"];
  }
  return ALL_PHASES;
}

/**
 * Returns progress 0-100 based solely on how many selected phases are completed.
 * If no phases are selected, infers from state (tests done + no validation → 100%) or uses all phases.
 */
export function computeProgressFromSelectedPhases(state: StackModernizationState): number {
  const selected =
    state.selectedPhases?.length > 0
      ? state.selectedPhases
      : inferEffectiveSelectedPhases(state);
  if (selected.length === 0) return state.progress ?? 0;
  let completed = 0;
  for (const phase of selected) {
    if (isPhaseCompleted(phase, state)) completed++;
  }
  const pct = Math.round((completed / selected.length) * 100);
  return Math.min(100, Math.max(0, pct));
}
