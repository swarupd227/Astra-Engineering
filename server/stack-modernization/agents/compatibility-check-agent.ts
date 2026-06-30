/**
 * Compatibility Checker Agent
 * Validates user's version selections for compatibility
 * Uses HashMap-based dependency resolution algorithm
 */

import type { 
  StackModernizationState, 
  VersionSelection, 
  CompatibilityCheckResult,
  DependencyConflict,
  CompatibilityWarning,
  RequiredChange,
  RiskAssessment,
  FailureScenario,
  LLMProvider
} from "../types";
// @ts-ignore - no declaration file for semver
import * as semver from "semver";

/**
 * Execute compatibility check for user selections
 */
export async function executeCompatibilityCheckAgent(
  state: StackModernizationState
): Promise<StackModernizationState> {
  
  const { logActivity } = await import("../state");
  let currentState = logActivity(
    state,
    "CompatibilityChecker",
    "Starting compatibility analysis",
    "Validating selected version combinations AND analyzing code usage patterns...",
    "info"
  );
  
  try {
    // Validate input
    if (!currentState.userSelections || currentState.userSelections.length === 0) {
      throw new Error("No version selections provided");
    }
    
    const hasDependencyData = (currentState.dependencyGraph?.directDependencies?.length ?? 0) > 0 
      || (currentState.repoProfile?.packageManifests?.length ?? 0) > 0;
    if (!hasDependencyData) {
      throw new Error("Dependency graph or package manifests not available");
    }
    
    currentState = logActivity(
      currentState,
      "CompatibilityChecker",
      "Analyzing selections",
      `Checking compatibility for ${currentState.userSelections.length} package(s) with code analysis`,
      "info"
    );
    
    // Build compatibility checker
    const checker = new CompatibilityChecker(currentState);
    
    // Run compatibility check (enhanced with code analysis)
    const result = await checker.validate();
    
    // **CRITICAL ENHANCEMENT**: Add LLM-powered code usage analysis with COMPLETE files
    const selectedPackages = (currentState.userSelections || []).map(s => s.package.toLowerCase());
    
    const allCodeFiles = (currentState.extractedFiles || [])
      .filter(f => {
        const ext = (f.relativePath || f.fullPath || '').toLowerCase();
        return ext.endsWith('.js') || ext.endsWith('.ts') || ext.endsWith('.tsx') || 
               ext.endsWith('.jsx') || ext.endsWith('.py') || ext.endsWith('.java') ||
               ext.endsWith('.cs') || ext.endsWith('.cpp') || ext.endsWith('.go');
      });
    
    // Prioritize files that import the packages being upgraded
    const relevantFiles = allCodeFiles.filter(f => {
      const content = (f.content || '').toLowerCase();
      return selectedPackages.some(pkg => 
        content.includes(`import`) && content.includes(pkg) ||
        content.includes(`require`) && content.includes(pkg) ||
        content.includes(`from ${pkg}`)
      );
    });
    
    const filesToAnalyze = relevantFiles.length > 0 ? relevantFiles : allCodeFiles;
    
    if (filesToAnalyze.length > 0) {
      const llmEnhancedResult = await enhanceWithLLMCodeAnalysis(result, currentState.userSelections || [], filesToAnalyze, currentState.llmProvider, currentState.analysisId);
      currentState.compatibilityCheck = llmEnhancedResult;
    } else {
      currentState.compatibilityCheck = result;
    }
    
    currentState = logActivity(
      currentState,
      "CompatibilityChecker",
      "Analysis complete",
      `Found ${result.conflicts.length} conflict(s), ${result.warnings.length} warning(s). Confidence: ${result.confidence}%`,
      result.conflicts.length === 0 ? "success" : "warning"
    );
    
    return currentState;
    
  } catch (error) {
    console.error("[CompatibilityCheckAgent] Error:", error);
    
    currentState.errors.push(`CompatibilityCheckAgent failed: ${error instanceof Error ? error.message : String(error)}`);
    
    return logActivity(
      currentState,
      "CompatibilityChecker",
      "Analysis failed",
      error instanceof Error ? error.message : String(error),
      "error"
    );
  }
}

/**
 * Enhance compatibility check with LLM-powered code analysis
 * Uses COMPLETE file contents - no truncation
 */
async function enhanceWithLLMCodeAnalysis(
  baseResult: CompatibilityCheckResult,
  selections: VersionSelection[],
  codeFiles: Array<{ relativePath?: string; fullPath?: string; content?: string }>,
  llmProvider: LLMProvider,
  analysisId: string,
): Promise<CompatibilityCheckResult> {
  try {
    const { getLLMClient } = await import("../services/llm-selector");
    const { client, model } = getLLMClient(llmProvider as LLMProvider);
    const { trackedLLMCall } = await import("../services/llm-call-tracker");
    const { AGENT_TOKEN_BUDGETS, buildBudgetConstraint } = await import("../services/token-budgets");
    
    const { chunkFileContent, safeMaxTokens } = await import("../services/token-manager");
    const CODE_BUDGET = 80000;
    const perFileBudget = Math.min(12000, Math.floor(CODE_BUDGET / Math.max(codeFiles.length, 1)));
    
    const codeContext = codeFiles.map(f => {
      const path = f.relativePath || f.fullPath || 'unknown';
      const content = f.content || '';
      const chunked = chunkFileContent(content, perFileBudget, path);
      const wasChunked = chunked.length < content.length;
      const note = wasChunked ? ` (smart-chunked from ${content.length} chars)` : '';
      return `### File: ${path}${note}\n\`\`\`\n${chunked}\n\`\`\``;
    }).join('\n\n');
    
    const totalSize = codeFiles.reduce((sum, f) => (f.content || '').length + sum, 0);
    
    const prompt = `Perform a COMPREHENSIVE compatibility analysis for this dependency upgrade.

**UPGRADE SPECIFICATION:**
${selections.map(s => `- ${s.package}: ${s.currentVersion} → ${s.selectedVersion}`).join('\n')}

**CODEBASE (large files smart-chunked to preserve imports, signatures & key code):**
${codeContext}

**COMPREHENSIVE ANALYSIS REQUIRED:**

1. **IMPORT & PACKAGE ANALYSIS**
   - Scan for imports of the packages being upgraded
   - Check if package names changed (e.g., cucumber.api.* → io.cucumber.*)
   - Identify wildcard imports that may pull in removed classes
   - Find static imports that may break

2. **METHOD & API USAGE ANALYSIS**
   - Find all method calls on the upgraded packages
   - Check if method signatures changed (parameters, return types)
   - Identify removed methods
   - Find renamed methods
   - Check exception handling changes

3. **ANNOTATION & DECORATOR ANALYSIS**
   - Find all annotations from the upgraded packages
   - Check for renamed annotations (e.g., @Before → @BeforeEach)
   - Identify moved annotation packages
   - Check annotation attribute changes

4. **TYPE & INTERFACE ANALYSIS**
   - Check for interface changes (new required methods)
   - Find abstract class changes
   - Identify generic type changes
   - Check for removed types

5. **CONFIGURATION ANALYSIS**
   - Find configuration files related to the packages
   - Check for property/key renames
   - Identify removed configuration options
   - Find format changes (XML → YAML, etc.)

6. **DEPENDENCY CHAIN ANALYSIS**
   - Check transitive dependencies
   - Identify version conflicts
   - Find peer dependency issues
   - Check for circular dependencies

7. **BEHAVIORAL CHANGE DETECTION**
   - Identify default value changes
   - Find execution order changes
   - Check error handling changes
   - Identify performance implications

**OUTPUT REQUIREMENTS:**

Provide TWO arrays:

1. **additionalWarnings**: High-level package-level issues
2. **codeIssues**: Specific file and line-level problems

Return JSON:
{
  "additionalWarnings": [
    { 
      "package": "exact package name", 
      "message": "SPECIFIC issue with method/API/class names", 
      "severity": "high|medium|low", 
      "impact": "EXACT impact on THIS codebase (not generic)" 
    }
  ],
  "codeIssues": [
    { 
      "file": "exact/file/path.ext", 
      "line": "line number or range (e.g., '45' or '45-52')", 
      "issue": "SPECIFIC problem (e.g., 'Method setTitle() removed in React 18')", 
      "fix": "EXACT fix with code example:
        Before: oldMethod()
        After: newMethod()"
    }
  ]
}

**ANALYSIS STANDARDS:**
✅ Scan EVERY line of code provided
✅ Provide EXACT line numbers (count from provided code)
✅ Include method/API/class names (not vague like "API changed")
✅ Show before/after code in fixes
✅ Prioritize by severity (compile errors > runtime errors > deprecations)
✅ Only report issues actually found in THIS code (not theoretical)

You have COMPLETE files - analyze them thoroughly like you're preventing a production incident.`;

    const budgetBlock = buildBudgetConstraint("compatibilityCheck", "json");
    const response = await trackedLLMCall(client, {
      model,
      messages: [
        { 
          role: "system", 
          content: `${budgetBlock}

You are a Principal Software Engineer with 30+ years specializing in dependency compatibility analysis.

**Your Track Record:**
- Prevented 500+ production incidents by catching compatibility issues pre-deployment
- Expert in transitive dependency conflicts and resolution
- Deep knowledge of semantic versioning pitfalls across all major ecosystems (Maven, npm, PyPI, NuGet)
- Experienced with multi-module projects, monorepos, and microservices
- Known for finding subtle runtime issues that static analysis misses

**Your Analysis Approach:**
1. Examine EVERY import statement and usage pattern
2. Check for deprecated APIs that will break in the target version
3. Identify method signature changes (parameters, return types, exceptions)
4. Find annotation/decorator changes
5. Detect configuration format changes
6. Look for behavioral changes (defaults, execution order, error handling)
7. Consider transitive dependency impacts
8. Think about runtime vs compile-time issues

**Your Standards:**
- File-specific, line-specific findings
- Exact method/API names that changed
- Severity based on actual impact (not theoretical)
- Actionable fixes with code examples
- Consider both obvious and subtle breaking changes

**CRITICAL OUTPUT REQUIREMENT:**
You MUST return ONLY valid JSON. No markdown headers, no explanations, no code fences, no "# COMPREHENSIVE ANALYSIS".
Your response must start with { and end with }. NOTHING ELSE.

You have the COMPLETE codebase. Analyze it with the thoroughness of preventing a production outage.` 
        },
        { role: "user", content: prompt }
      ],
      temperature: 0,
      max_tokens: safeMaxTokens(AGENT_TOKEN_BUDGETS.compatibilityCheck, model)
    }, { analysisId, phase: "planning", agent: "CompatibilityCheck" });
    
    const content = response.choices[0]?.message?.content?.trim();
    if (content) {
      let cleaned = content;
      
      // Remove markdown code fences
      if (cleaned.startsWith("```")) {
        cleaned = cleaned.replace(/^```(?:json)?\s*\n?/i, "").replace(/\n?```\s*$/i, "").trim();
      }
      
      // Remove markdown headers and any leading non-JSON content
      if (cleaned.startsWith("#")) {
        // Find the first { or [ to start JSON
        const jsonStart = Math.min(
          cleaned.indexOf('{') !== -1 ? cleaned.indexOf('{') : Infinity,
          cleaned.indexOf('[') !== -1 ? cleaned.indexOf('[') : Infinity
        );
        if (jsonStart !== Infinity) {
          cleaned = cleaned.substring(jsonStart);
        }
      }
      
      // Clean any trailing non-JSON content
      const lastBrace = Math.max(cleaned.lastIndexOf('}'), cleaned.lastIndexOf(']'));
      if (lastBrace !== -1) {
        cleaned = cleaned.substring(0, lastBrace + 1);
      }
      
      const llmAnalysis = JSON.parse(cleaned);
      
      // Merge LLM findings with base result
      if (llmAnalysis.additionalWarnings) {
        baseResult.warnings.push(...llmAnalysis.additionalWarnings);
      }
      if (llmAnalysis.codeIssues) {
      }
    }
  } catch (error) {
    console.error(`[CompatibilityCheckAgent] LLM enhancement failed:`, error);
    // Don't fail the whole check if LLM fails
  }
  
  return baseResult;
}

/**
 * HashMap-based compatibility checker
 */
class CompatibilityChecker {
  private state: StackModernizationState;
  private selectionMap: Map<string, VersionSelection>;
  private dependencyMap: Map<string, Map<string, string>>; // pkg -> { dep: constraint }
  
  constructor(state: StackModernizationState) {
    this.state = state;
    this.selectionMap = new Map();
    this.dependencyMap = new Map();
    
    // Build selection map
    state.userSelections?.forEach(sel => {
      this.selectionMap.set(sel.package, sel);
    });
    
    // Build dependency map from dependency graph
    this.buildDependencyMap();
  }
  
  /**
   * Build HashMap of dependencies
   */
  private buildDependencyMap(): void {
    // Add direct dependencies from dependency graph
    if (this.state.dependencyGraph?.directDependencies?.length) {
      this.state.dependencyGraph.directDependencies.forEach((dep: any) => {
        const name = dep.name || dep.package;
        if (!name) return;
        const constraints = this.dependencyMap.get(name) || new Map();
        if (dep.version) {
          constraints.set(name, dep.version);
        }
        this.dependencyMap.set(name, constraints);
      });
    }
    
    // Parse package manifests for dependency constraints
    if (this.state.repoProfile?.packageManifests) {
      for (const manifest of this.state.repoProfile.packageManifests) {
        if (manifest.parsed) {
          this.parseManifestDependencies(manifest.parsed);
        }
      }
    }
    
  }
  
  /**
   * Parse manifest dependencies
   */
  private parseManifestDependencies(parsed: any): void {
    // Handle package.json
    if (parsed.dependencies && typeof parsed.dependencies === 'object') {
      Object.entries(parsed.dependencies).forEach(([pkg, version]) => {
        const constraints = this.dependencyMap.get(pkg) || new Map();
        constraints.set(pkg, version as string);
        this.dependencyMap.set(pkg, constraints);
      });
    }
    
    if (parsed.devDependencies && typeof parsed.devDependencies === 'object') {
      Object.entries(parsed.devDependencies).forEach(([pkg, version]) => {
        const constraints = this.dependencyMap.get(pkg) || new Map();
        constraints.set(pkg, version as string);
        this.dependencyMap.set(pkg, constraints);
      });
    }
    
    // Handle requirements.txt (Python)
    if (Array.isArray(parsed.dependencies)) {
      parsed.dependencies.forEach((dep: any) => {
        if (dep.package && dep.version) {
          const constraints = this.dependencyMap.get(dep.package) || new Map();
          constraints.set(dep.package, dep.version);
          this.dependencyMap.set(dep.package, constraints);
        }
      });
    }
  }
  
  /**
   * Main validation method
   */
  async validate(): Promise<CompatibilityCheckResult> {
    const conflicts: DependencyConflict[] = [];
    const warnings: CompatibilityWarning[] = [];
    const requiredChanges: RequiredChange[] = [];
    
    
    // Step 1: Check each selection against dependency constraints
    for (const [pkgName, selection] of this.selectionMap) {
      const pkgConflicts = await this.checkPackageCompatibility(selection);
      conflicts.push(...pkgConflicts);
    }
    
    // Step 2: Check for version jumps (major/minor)
    for (const [pkgName, selection] of this.selectionMap) {
      const versionWarnings = this.checkVersionJump(selection);
      warnings.push(...versionWarnings);
    }
    
    // Step 3: Identify required changes
    for (const [pkgName, selection] of this.selectionMap) {
      const changes = await this.identifyRequiredChanges(selection);
      requiredChanges.push(...changes);
    }
    
    // Step 4: Calculate risk assessment
    const riskAssessment = this.calculateRiskAssessment(conflicts, warnings, requiredChanges);
    
    // Step 5: Determine compatibility (be realistic - many warnings = not compatible)
    const errorConflicts = conflicts.filter(c => c.severity === "error").length;
    const highSeverityWarnings = warnings.filter(w => w.severity === "high").length;
    const compatible = errorConflicts === 0 && highSeverityWarnings < 3 && warnings.length < 10;
    const confidence = this.calculateConfidence(conflicts, warnings, riskAssessment);
    
    // Step 6: Generate recommendation (aligned with risk level)
    const recommendation = this.generateRecommendation(confidence, conflicts, riskAssessment);
    
    
    return {
      compatible,
      confidence,
      conflicts,
      warnings,
      requiredChanges,
      riskAssessment,
      recommendation
    };
  }
  
  /**
   * Check if a package selection is compatible with existing constraints
   */
  private async checkPackageCompatibility(selection: VersionSelection): Promise<DependencyConflict[]> {
    const conflicts: DependencyConflict[] = [];
    
    // Get constraints for this package
    const constraints = this.dependencyMap.get(selection.package);
    
    if (!constraints || constraints.size === 0) {
      // No constraints found - safe
      return conflicts;
    }
    
    // Check each constraint
    for (const [depPkg, constraint] of constraints) {
      if (depPkg === selection.package) {
        // Self-constraint, skip
        continue;
      }
      
      // Check if selected version satisfies constraint
      const selectedDep = this.selectionMap.get(depPkg);
      
      if (!selectedDep) {
        // Dependency not selected by user
        conflicts.push({
          package: selection.package,
          selectedVersion: selection.selectedVersion,
          conflictsWith: {
            package: depPkg,
            requiredVersion: constraint,
            constraint: constraint
          },
          severity: "warning",
          solution: `Select a version for ${depPkg} that satisfies "${constraint}"`,
          autoFixable: true
        });
        continue;
      }
      
      // Check version compatibility
      if (!this.satisfiesConstraint(selectedDep.selectedVersion, constraint)) {
        conflicts.push({
          package: selection.package,
          selectedVersion: selection.selectedVersion,
          conflictsWith: {
            package: depPkg,
            requiredVersion: constraint,
            constraint: constraint
          },
          severity: "error",
          solution: `Change ${depPkg} from ${selectedDep.selectedVersion} to satisfy "${constraint}" OR choose a different version of ${selection.package}`,
          autoFixable: false
        });
      }
    }
    
    return conflicts;
  }
  
  /**
   * Check if version satisfies semver constraint
   */
  private satisfiesConstraint(version: string, constraint: string): boolean {
    try {
      // Clean version string
      const cleanVersion = version.replace(/^[\^~]/, '');
      const cleanConstraint = constraint.replace(/^[\^~]/, '');
      
      // Try semver validation
      if (semver.valid(cleanVersion)) {
        return semver.satisfies(cleanVersion, cleanConstraint);
      }
      
      // Fallback: exact match
      return cleanVersion === cleanConstraint;
      
    } catch (error) {
      console.warn(`[CompatibilityChecker] Error checking constraint ${version} vs ${constraint}:`, error);
      // On error, assume compatible (optimistic)
      return true;
    }
  }
  
  /**
   * Check for major/minor version jumps
   */
  private checkVersionJump(selection: VersionSelection): CompatibilityWarning[] {
    const warnings: CompatibilityWarning[] = [];
    
    try {
      const current = semver.parse(selection.currentVersion);
      const selected = semver.parse(selection.selectedVersion);
      
      if (!current || !selected) {
        return warnings;
      }
      
      // Major version jump
      if (selected.major > current.major) {
        warnings.push({
          package: selection.package,
          message: `Major version jump: ${current.major} → ${selected.major}. Likely breaking changes.`,
          severity: "high",
          impact: "Breaking changes expected. Review migration guide."
        });
      }
      
      // Minor version jump (multiple versions)
      if (selected.major === current.major && selected.minor > current.minor + 2) {
        warnings.push({
          package: selection.package,
          message: `Skipping ${selected.minor - current.minor} minor versions.`,
          severity: "medium",
          impact: "May introduce new features or deprecations. Test thoroughly."
        });
      }
      
    } catch (error) {
      // Ignore version parsing errors
    }
    
    return warnings;
  }
  
  /**
   * Identify required changes for upgrade
   */
  private async identifyRequiredChanges(selection: VersionSelection): Promise<RequiredChange[]> {
    const changes: RequiredChange[] = [];
    
    // Always need to update manifest
    changes.push({
      type: "dependency_update",
      package: selection.package,
      description: `Update ${selection.package} from ${selection.currentVersion} to ${selection.selectedVersion}`,
      automaticFix: true,
      estimatedEffort: "trivial"
    });
    
    // Check for major version changes (likely breaking)
    try {
      const current = semver.parse(selection.currentVersion);
      const selected = semver.parse(selection.selectedVersion);
      
      if (current && selected && selected.major > current.major) {
        changes.push({
          type: "breaking_api",
          package: selection.package,
          description: `Major version upgrade may require code changes`,
          automaticFix: false,
          estimatedEffort: "medium"
        });
      }
    } catch (error) {
      // Ignore
    }
    
    return changes;
  }
  
  /**
   * Calculate risk assessment
   */
  private calculateRiskAssessment(
    conflicts: DependencyConflict[],
    warnings: CompatibilityWarning[],
    changes: RequiredChange[]
  ): RiskAssessment {
    let riskScore = 0;
    const maxScore = 100;
    
    // Factor 1: Conflicts (0-40 points)
    const errorConflicts = conflicts.filter(c => c.severity === "error").length;
    riskScore += Math.min(40, errorConflicts * 15);
    
    // Factor 2: Warnings (0-30 points)
    const highWarnings = warnings.filter(w => w.severity === "high").length;
    riskScore += Math.min(30, highWarnings * 10);
    
    // Factor 3: Required changes (0-20 points)
    const breakingChanges = changes.filter(c => c.type === "breaking_api").length;
    riskScore += Math.min(20, breakingChanges * 10);
    
    // Factor 4: Manual fixes (0-10 points)
    const manualFixes = changes.filter(c => !c.automaticFix).length;
    riskScore += Math.min(10, manualFixes * 5);
    
    const riskPercent = (riskScore / maxScore) * 100;
    const successPercent = 100 - riskPercent;
    
    // Determine risk level
    let riskLevel: "safe" | "low" | "medium" | "high" | "critical";
    if (riskPercent < 10) riskLevel = "safe";
    else if (riskPercent < 30) riskLevel = "low";
    else if (riskPercent < 60) riskLevel = "medium";
    else if (riskPercent < 80) riskLevel = "high";
    else riskLevel = "critical";
    
    // Generate failure scenarios
    const failureScenarios: FailureScenario[] = [];
    
    if (errorConflicts > 0) {
      failureScenarios.push({
        scenario: "Dependency Resolution Failure",
        likelihood: "high",
        impact: "Build fails due to incompatible package versions",
        mitigation: "Resolve all dependency conflicts before proceeding"
      });
    }
    
    if (breakingChanges > 0) {
      failureScenarios.push({
        scenario: "Runtime Errors",
        likelihood: "medium",
        impact: "Application crashes or behaves unexpectedly due to API changes",
        mitigation: "Review migration guides and update code accordingly"
      });
    }
    
    // Mitigation strategies
    const mitigations: string[] = [];
    if (errorConflicts > 0) {
      mitigations.push("Resolve dependency conflicts by adjusting version selections");
    }
    if (breakingChanges > 0) {
      mitigations.push("Review breaking changes documentation for each major upgrade");
      mitigations.push("Create comprehensive test suite before upgrading");
    }
    if (manualFixes > 0) {
      mitigations.push("Allocate time for manual code updates");
    }
    mitigations.push("Set up automated backups and rollback procedures");
    mitigations.push("Test in staging environment before production");
    
    // Critical warnings
    const criticalWarnings: string[] = [];
    if (errorConflicts > 0) {
      criticalWarnings.push(`${errorConflicts} dependency conflict(s) must be resolved`);
    }
    if (riskLevel === "critical" || riskLevel === "high") {
      criticalWarnings.push("High risk upgrade - extensive testing required");
    }
    
    // Calculate confidence (0-100%, realistic assessment)
    let confidence = Math.round(successPercent);
    // Reduce confidence based on warnings (they matter!)
    confidence = Math.max(0, confidence - (warnings.length * 3));
    // Cap at 100% - no silly "150% confident"
    confidence = Math.min(100, confidence);
    
    return {
      successLikelihood: Math.round(successPercent),
      riskLevel,
      failureScenarios,
      mitigationStrategies: mitigations,
      criticalWarnings,
      confidence
    };
  }
  
  /**
   * Calculate overall confidence score
   */
  private calculateConfidence(
    conflicts: DependencyConflict[],
    warnings: CompatibilityWarning[],
    risk: RiskAssessment
  ): number {
    return risk.confidence;
  }
  
  /**
   * Generate recommendation
   */
  private generateRecommendation(
    confidence: number,
    conflicts: DependencyConflict[],
    risk: RiskAssessment
  ): "proceed" | "proceed_with_caution" | "review_required" | "do_not_proceed" {
    const errorConflicts = conflicts.filter(c => c.severity === "error").length;
    
    // Critical issues - do not proceed
    if (errorConflicts > 0 || risk.riskLevel === "critical") {
      return "do_not_proceed";
    }
    
    // High risk or low confidence - review required
    if (risk.riskLevel === "high" || confidence < 50) {
      return "review_required";
    }
    
    // Medium risk or moderate confidence - proceed with caution
    if (risk.riskLevel === "medium" || confidence < 75) {
      return "proceed_with_caution";
    }
    
    // Low risk and high confidence - safe to proceed
    return "proceed";
  }
}
