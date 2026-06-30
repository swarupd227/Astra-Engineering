/**
 * Stack Modernization - Safe Agent Executor
 * Bulletproof wrapper for all agents with comprehensive error handling
 */

import type { StackModernizationState } from "../types";

export interface AgentResult<T> {
  success: boolean;
  data: T;
  error?: string;
  warnings: string[];
}

/**
 * Execute an agent safely with comprehensive error handling
 */
export async function executeAgentSafely<T>(
  agentName: string,
  agentFn: (state: StackModernizationState) => Promise<StackModernizationState>,
  state: StackModernizationState,
  fallbackData?: Partial<StackModernizationState>
): Promise<StackModernizationState> {
  
  
  try {
    // Validate input state
    if (!state) {
      throw new Error("State is undefined");
    }
    
    const result = await agentFn(state);
    
    return result;
    
  } catch (error) {
    console.error(`[SafeExecutor] ${agentName} failed:`, error);
    
    // Log to activity log
    const errorState = {
      ...state,
      errors: [
        ...state.errors,
        `${agentName} failed: ${error instanceof Error ? error.message : String(error)}`
      ],
      activityLog: [
        ...state.activityLog,
        {
          timestamp: new Date(),
          agent: agentName,
          action: "Agent failed",
          details: error instanceof Error ? error.message : String(error),
          status: "error" as const
        }
      ]
    };
    
    // Apply fallback data if provided
    if (fallbackData) {
      return { ...errorState, ...fallbackData };
    }
    
    return errorState;
  }
}

/**
 * Validate state at different pipeline stages
 */
export function validateState(state: StackModernizationState, stage: string): {
  valid: boolean;
  errors: string[];
  warnings: string[];
} {
  const errors: string[] = [];
  const warnings: string[] = [];
  
  // Always validate basic structure
  if (!state) {
    errors.push("State is undefined");
    return { valid: false, errors, warnings };
  }
  
  if (!state.sessionId) {
    errors.push("Missing sessionId");
  }
  
  if (!state.analysisId) {
    errors.push("Missing analysisId");
  }
  
  // Stage-specific validations
  switch (stage) {
    case "pre-analysis":
      if (!Array.isArray(state.extractedFiles)) {
        errors.push("extractedFiles is not an array");
      } else if (state.extractedFiles.length === 0) {
        warnings.push("No files extracted");
      }
      break;
      
    case "post-repo-profiler":
      if (!state.repoProfile) {
        errors.push("RepoProfiler did not produce repoProfile");
      } else {
        if (!state.repoProfile.projectType) {
          warnings.push("Project type not detected");
        }
        if (!state.repoProfile.languages || state.repoProfile.languages.length === 0) {
          warnings.push("No languages detected");
        }
      }
      break;
      
    case "post-dependency-graph":
      if (!state.dependencyGraph) {
        warnings.push("DependencyGraph not produced (may be no manifests)");
      } else {
        if (state.dependencyGraph.totalPackages === 0) {
          warnings.push("No dependencies found");
        }
      }
      break;
      
    case "post-version-intelligence":
      if (!state.versionIntelligence) {
        warnings.push("VersionIntelligence not produced");
      } else {
        if (state.versionIntelligence.length === 0) {
          warnings.push("No version recommendations generated");
        }
      }
      break;
  }
  
  const valid = errors.length === 0;
  
  if (!valid) {
    console.error(`[StateValidator] Validation failed at ${stage}:`, errors);
  }
  
  if (warnings.length > 0) {
    console.warn(`[StateValidator] Warnings at ${stage}:`, warnings);
  }
  
  return { valid, errors, warnings };
}

/**
 * Check if state has minimum required data to continue
 */
export function canContinuePipeline(state: StackModernizationState): boolean {
  // Must have files
  if (!Array.isArray(state.extractedFiles) || state.extractedFiles.length === 0) {
    console.error("[Pipeline] Cannot continue: No extracted files");
    return false;
  }
  
  // Must not have critical errors
  const criticalErrors = state.errors.filter(e => 
    e.includes("critical") || e.includes("fatal") || e.includes("cannot continue")
  );
  
  if (criticalErrors.length > 0) {
    console.error("[Pipeline] Cannot continue: Critical errors present", criticalErrors);
    return false;
  }
  
  return true;
}

/**
 * Get safe fallback state for an agent
 */
export function getFallbackState(agentName: string): Partial<StackModernizationState> {
  switch (agentName) {
    case "RepoProfiler":
      return {
        repoProfile: {
          projectType: "unknown",
          languages: [],
          runtimeInfo: [],
          frameworks: [],
          packageManifests: [],
          fileStructure: {
            totalFiles: 0,
            codeFiles: 0,
            configFiles: 0,
            testFiles: 0
          },
          detectedPatterns: {
            isMonorepo: false,
            hasTests: false,
            hasDocker: false,
            hasCI: false,
            hasLinting: false
          }
        }
      };
      
    case "DependencyGraph":
      return {
        dependencyGraph: {
          directDependencies: [],
          transitiveDependencies: [],
          peerConflicts: [],
          duplicateVersions: [],
          totalPackages: 0,
          depthAnalysis: {
            maxDepth: 0,
            averageDepth: 0
          }
        }
      };
      
    case "VersionIntelligence":
      return {
        versionIntelligence: []
      };
      
    default:
      return {};
  }
}
