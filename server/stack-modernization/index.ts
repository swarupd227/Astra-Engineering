/**
 * Stack Modernization - Main Orchestrator
 * Entry point for stack modernization analysis system
 */

import type { StackModernizationState, LLMProvider } from "./types";
import { initializeState, updateProgress, completeState, failState } from "./state";
import {
  createTempDirectory,
  scheduleCleanup,
  getUploadDir,
  getExtractedDir
} from "./services/temp-storage";
import {
  processUploadedFiles,
  extractAllFiles,
  updateStateWithFiles
} from "./services/file-handler";
import { executeRepoProfilerAgent } from "./agents/repo-profiler-agent";
import { executeDependencyGraphAgent } from "./agents/dependency-graph-agent";
import { executeVersionIntelligenceAgent } from "./agents/version-intelligence-agent";
import { stateStore } from "./services/state-store";
import { 
  executeAgentSafely, 
  validateState, 
  canContinuePipeline,
  getFallbackState 
} from "./services/safe-executor";

/**
 * Initialize a new Stack Modernization session
 */
export async function initializeSession(
  modernizationType: "upgrade" | "modernization" | "replatform",
  llmProvider: LLMProvider,
  userId: string,
  tenantId: string
): Promise<StackModernizationState> {
  
  // Create temporary directory
  const sessionId = `sm-${Date.now()}-${Math.random().toString(36).substring(7)}`;
  const tempDir = await createTempDirectory(sessionId);
  
  // Schedule cleanup after 24 hours
  scheduleCleanup(tempDir);
  
  // Initialize state
  const state = initializeState(modernizationType, llmProvider, userId, tenantId, tempDir);
  
  return state;
}

/**
 * Process uploaded files and extract contents
 */
export async function processFiles(
  state: StackModernizationState,
  files: any[]
): Promise<StackModernizationState> {
  
  const { logActivity } = await import("./state");
  let currentState = logActivity(state, "FileProcessor", "Starting file processing", `Processing ${files.length} uploaded file(s)`, "info");
  
  try {
    // Step 1: Process uploaded files
    const uploadDir = getUploadDir(currentState.tempDir);
    currentState = logActivity(currentState, "FileProcessor", "Processing uploaded files", `Hashing and classifying files...`, "info");
    
    const uploadedFiles = await processUploadedFiles(files, uploadDir);
    
    currentState = logActivity(
      currentState,
      "FileProcessor",
      "Files uploaded",
      `✅ Processed ${uploadedFiles.length} file(s): ${uploadedFiles.map(f => f.originalName).join(", ")}`,
      "success"
    );
    
    // Step 2: Extract all files (handle ZIPs)
    const extractDir = getExtractedDir(currentState.tempDir);
    
    // Check if we have ZIP files
    const hasZip = uploadedFiles.some(f => f.fileType === "zip");
    if (hasZip) {
      currentState = logActivity(currentState, "FileProcessor", "Extracting ZIP archive", "Unpacking files...", "info");
    }
    
    const extractedFiles = await extractAllFiles(uploadedFiles, extractDir);
    
    currentState = logActivity(
      currentState,
      "FileProcessor",
      "Extraction complete",
      `✅ Extracted ${extractedFiles.length} file(s) - ${extractedFiles.filter(f => f.fileType.includes("script")).length} code files, ${extractedFiles.filter(f => f.fileType === "json").length} config files`,
      "success"
    );
    
    // Step 3: Update state
    const updatedState = updateStateWithFiles(currentState, uploadedFiles, extractedFiles);
    
    
    return updateProgress(updatedState, "files_processed", 5);
  } catch (error) {
    console.error("[StackModernization] Error processing files:", error);
    return failState(state, `File processing failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Execute the analysis pipeline
 * 
 * This orchestrates all agents in sequence (LangGraph-style)
 * Saves intermediate results after each agent
 */
export async function executeAnalysis(
  state: StackModernizationState
): Promise<StackModernizationState> {
  
  const { logActivity } = await import("./state");
  const { executeInitialAnalysisPipeline } = await import("./workflow");
  
  try {
    let currentState = logActivity(
      state,
      "Orchestrator",
      "Analysis pipeline started",
      `Beginning multi-agent analysis for ${state.modernizationType} strategy`,
      "info"
    );
    
    // ===== PRE-ANALYSIS VALIDATION =====
    const preValidation = validateState(currentState, "pre-analysis");
    if (!preValidation.valid) {
      throw new Error(`Pre-analysis validation failed: ${preValidation.errors.join(", ")}`);
    }
    
    if (!canContinuePipeline(currentState)) {
      throw new Error("Cannot continue pipeline: Critical issues detected");
    }
    
    // Save initial state
    stateStore.save(currentState);

    const { useLangGraphStackModernization } = await import("./graph/config");
    if (useLangGraphStackModernization()) {
      // ===== LANGGRAPH: run assessment then interrupt for user selection =====
      const { stackModGraph, graphConfig } = await import("./graph");
      const analysisId = currentState.analysisId;
      await stackModGraph.invoke({ analysisId }, graphConfig(analysisId));
      currentState = stateStore.get(analysisId) ?? currentState;
      stateStore.save(currentState);
    } else {
      // ===== USE WORKFLOW.TS FOR INITIAL ANALYSIS =====
      currentState = await executeInitialAnalysisPipeline(currentState, {
        enableLLM: true,
        llmProvider: currentState.llmProvider
      });
      stateStore.save(currentState);
    }

    return currentState;
    
  } catch (error) {
    console.error("[StackModernization] Analysis pipeline failed:", error);
    const failedState = failState(state, `Analysis failed: ${error instanceof Error ? error.message : String(error)}`);
    stateStore.save(failedState);
    return failedState;
  }
}

/**
 * Get analysis progress
 */
export function getAnalysisProgress(state: StackModernizationState) {
  return {
    sessionId: state.sessionId,
    analysisId: state.analysisId,
    status: state.status,
    progress: state.progress,
    currentStage: state.currentStage,
    errors: state.errors,
  };
}

/**
 * Get analysis results (including intermediate results)
 */
export function getAnalysisResults(state: StackModernizationState) {
  return {
    analysisId: state.analysisId,
    modernizationType: state.modernizationType,
    status: state.status,
    progress: state.progress,
    currentStage: state.currentStage,
    summary: {
      currentState: {
        languages: state.repoProfile?.languages || [],
        frameworks: state.repoProfile?.frameworks || [],
        dependencies: state.dependencyGraph?.totalPackages || 0,
      },
      recommendations: {
        priority: "medium" as const,
        breakingChanges: state.breakingChanges?.length || 0,
        estimatedEffort: "TBD",
        riskLevel: "medium" as const,
      },
    },
    agentReports: {
      repoProfiler: state.repoProfile,
      dependencyGraph: state.dependencyGraph,
      versionIntelligence: state.versionIntelligence || state.versionRecommendations,
      breakingChangeAnalyzer: state.breakingChanges,
      codeCouplingAnalyzer: state.couplingAnalysis,
      upgradeStrategy: state.upgradeStrategy,
      executionPlanner: state.executionPlan,
      riskAssessment: state.risks,
      validationChecklist: state.validationChecklist,
    },
    errors: state.errors,
  };
}

/**
 * Export for use in routes
 */
export type { StackModernizationState } from "./types";

export { stateStore } from "./services/state-store";
