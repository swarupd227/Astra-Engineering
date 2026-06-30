/**
 * LangGraph-style workflow orchestration for Stack Modernization
 * 
 * Enhanced workflow using unified agents:
 * 1. AssessmentAgent (combines RepoProfiler + DependencyGraph + VersionIntelligence) →
 * 2. (User Selection) → 
 * 3. PlanningAgent (CompatibilityCheck + RiskReport) → 
 * 4. TaskPlannerAgent → 
 * 5. CodeUpgradeAgent → 
 * 6. TestGenerationAgent
 */

import { StackModernizationState, VersionSelection } from "./types";
import { hasAtLeastOneUpgrade } from "./utils/version-selection-validation";
import { executeRepoProfilerAgent } from "./agents/repo-profiler-agent";
import { executeDependencyGraphAgent } from "./agents/dependency-graph-agent";
import { executeVersionIntelligenceAgent } from "./agents/version-intelligence-agent";
import { executeCompatibilityCheckAgent } from "./agents/compatibility-check-agent";
import { executeRiskReportAgent } from "./agents/risk-report-agent";
import { executeCodeUpgradeAgent } from "./agents/code-upgrade-agent";
import { executeAssessmentAgent } from "./agents/assessment-agent";

export type WorkflowStage = 
  | 'repo_profiler'
  | 'dependency_graph'
  | 'version_intelligence'
  | 'awaiting_user_selection'
  | 'compatibility_check'
  | 'risk_report'
  | 'code_upgrade'
  | 'validation'
  | 'completed'
  | 'failed';

export interface WorkflowConfig {
  enableLLM: boolean;
  llmProvider?: string;
  skipVersionIntelligence?: boolean;
  skipCompatibilityCheck?: boolean;
}

/**
 * Execute the initial analysis pipeline (before user selection)
 * 
 * Pipeline: RepoProfiler → DependencyGraph → VersionIntelligence
 */
export async function executeInitialAnalysisPipeline(
  state: StackModernizationState,
  config: WorkflowConfig = { enableLLM: true }
): Promise<StackModernizationState> {
  const startTime = Date.now();
  
  try {
    state.currentStage = 'Running comprehensive assessment...';
    state.progress = 10;
    
    // Execute unified AssessmentAgent (replaces 3 separate agents)
    state = await executeAssessmentAgent(state);
    
    // AssessmentAgent sets assessmentMarkdown and versionRecommendationsText
    
    // Mark as awaiting user selection
    state.currentStage = 'awaiting_user_selection';
    state.progress = 95;
    state.status = 'awaiting_user_selection';
    
    const duration = Date.now() - startTime;
    
    return state;
    
  } catch (error) {
    console.error('[Workflow] Initial pipeline failed:', error);
    state.status = 'failed';
    state.errors.push(`Workflow failed: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
}

/**
 * Execute the post-selection pipeline (after user selects versions)
 * 
 * Pipeline: CompatibilityCheck → RiskReport
 */
export async function executePostSelectionPipeline(
  state: StackModernizationState,
  userSelections: Array<{ package: string; selectedVersion: string; currentVersion?: string; category?: string }>
): Promise<StackModernizationState> {
  const startTime = Date.now();
  
  try {
    // Validate state
    if (!state.versionIntelligence?.length) {
      throw new Error('Version intelligence not available - run initial pipeline first');
    }
    
    // Store selections and RESUME workflow (change status from awaiting_user_selection to in_progress)
    state.userSelections = userSelections.map(s => ({
      package: s.package,
      selectedVersion: s.selectedVersion,
      currentVersion: s.currentVersion || "unknown",
      category: (s.category as "runtime" | "framework" | "library") || "runtime"
    })) as VersionSelection[];
    state.currentStage = 'Processing user selections...';
    state.progress = 40;
    state.status = 'in_progress'; // Resume workflow

    if (!hasAtLeastOneUpgrade(state.userSelections)) {
      throw new Error('No upgrade needed. All selected versions match current. Change at least one target to proceed.');
    }
    
    // Stage 4: Compatibility Check
    state.currentStage = 'Checking compatibility...';
    state.progress = 45;
    
    // Save state before agent execution
    const { stateStore } = await import("./services/state-store");
    stateStore.save(state);
    
    state = await executeCompatibilityCheckAgent(state);
    state.progress = 55;
    state.activityLog.push({
      timestamp: new Date(),
      agent: 'CompatibilityCheckAgent',
      action: 'Compatibility check complete',
      details: JSON.stringify({ 
        conflicts: state.compatibilityCheck?.conflicts?.length || 0,
        warnings: state.compatibilityCheck?.warnings?.length || 0,
        recommendation: state.compatibilityCheck?.recommendation
      }),
      status: 'success'
    });
    
    // Save state after compatibility check
    stateStore.save(state);
    
    // Stage 5: Risk Report (LLM-powered comprehensive analysis)
    state.currentStage = 'Generating risk report (LLM)...';
    state.progress = 60;
    
    // Save state before agent execution
    stateStore.save(state);
    
    const riskReport = await executeRiskReportAgent(state, (state.userSelections || []) as VersionSelection[]);
    (state as any).riskReport = riskReport;
    state.progress = 70;
    state.activityLog.push({
      timestamp: new Date(),
      agent: 'RiskReportAgent',
      action: 'Risk report generated',
      details: JSON.stringify({ 
        overallRisk: riskReport.overallRisk,
        recommendation: riskReport.recommendation,
        breakingChanges: riskReport.breakingChanges?.length || 0
      }),
      status: 'success'
    });
    
    // Save state after risk report
    stateStore.save(state);
    
    // Stage 6: Code Upgrade (Apply version changes to manifests)
    state.currentStage = 'Upgrading code with selected versions...';
    state.progress = 75;
    
    // Save state before agent execution
    stateStore.save(state);
    
    const analysisId = state.analysisId;
    const onProgress = (files: Array<{ path: string; content: string; originalContent: string }>) => {
      const s = stateStore.get(analysisId);
      if (s) {
        s.modifiedFiles = files.map((f) => ({ path: f.path, content: f.content, originalContent: f.originalContent }));
        stateStore.save(s);
      }
    };
    state = await executeCodeUpgradeAgent(state, (state.userSelections || []) as VersionSelection[], { onProgress });
    // Ensure state.modifiedFiles is set so progress API and downstream use it (agent only sets codeUpgrade.modifiedFiles)
    const codeUpgrade = (state as any).codeUpgrade;
    if (codeUpgrade?.modifiedFiles?.length && !state.modifiedFiles?.length) {
      state.modifiedFiles = codeUpgrade.modifiedFiles;
    }
    state.progress = 90;
    state.activityLog.push({
      timestamp: new Date(),
      agent: 'CodeUpgradeAgent',
      action: 'Code upgrade complete',
      details: JSON.stringify({ 
        filesModified: (state as any).codeUpgrade?.summary?.totalFilesModified || 0,
        packagesUpgraded: (state as any).codeUpgrade?.summary?.totalPackagesUpgraded || 0,
        success: (state as any).codeUpgrade?.summary?.success || false
      }),
      status: 'success'
    });
    
    // Save state after code upgrade
    const { stateStore: finalStateStore } = await import("./services/state-store");
    finalStateStore.save(state);
    
    // Mark as fully complete
    state.currentStage = 'Stack modernization complete';
    state.progress = 100;
    state.status = 'completed';
    
    // Final state save
    finalStateStore.save(state);
    
    const duration = Date.now() - startTime;
    
    return state;
    
  } catch (error) {
    console.error('[Workflow] Post-selection pipeline failed:', error);
    state.status = 'failed';
    state.errors.push(`Post-selection workflow failed: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
}

/**
 * Execute the complete workflow from start to finish
 * (For testing or batch processing - not typical for interactive use)
 */
export async function executeCompleteWorkflow(
  state: StackModernizationState,
  config: WorkflowConfig = { enableLLM: true }
): Promise<StackModernizationState> {
  
  // Phase 1: Initial analysis
  state = await executeInitialAnalysisPipeline(state, config);
  
  // Note: In real usage, we'd stop here and wait for user selection
  // For automated workflows, you could auto-select latest stable versions here
  
  return state;
}

/**
 * Workflow state machine helper
 */
export function getNextStage(currentStage: WorkflowStage): WorkflowStage | null {
  const stages: WorkflowStage[] = [
    'repo_profiler',
    'dependency_graph',
    'version_intelligence',
    'awaiting_user_selection',
    'compatibility_check',
    'risk_report',
    'code_upgrade',
    'validation',
    'completed'
  ];
  
  const currentIndex = stages.indexOf(currentStage);
  if (currentIndex === -1 || currentIndex === stages.length - 1) {
    return null;
  }
  
  return stages[currentIndex + 1];
}

/**
 * Check if state is ready for next stage
 */
export function canProceedToNextStage(state: StackModernizationState, targetStage: WorkflowStage): boolean {
  switch (targetStage) {
    case 'dependency_graph':
      return !!state.repoProfile;
    
    case 'version_intelligence':
      return !!state.dependencyGraph;
    
    case 'awaiting_user_selection':
      return !!state.versionIntelligence?.length;
    
    case 'compatibility_check':
      return !!state.userSelections?.length && !!state.versionIntelligence?.length;
    
    case 'risk_report':
      return !!state.compatibilityCheck;
    
    case 'code_upgrade':
      return !!(state as any).riskReport && state.compatibilityCheck?.recommendation !== 'do_not_proceed';
    
    default:
      return false;
  }
}
