/**
 * Stack Modernization - Dependency Graph Agent
 * Second agent in the LangGraph workflow
 * 
 * Responsibility: Build comprehensive dependency graph and identify conflicts
 * 
 * This agent analyzes package manifests to:
 * - Build complete dependency tree (direct + transitive)
 * - Identify peer dependency conflicts
 * - Detect version conflicts (duplicate packages)
 * - Calculate dependency depth metrics
 * - Assess dependency health
 */

import type { 
  StackModernizationState, 
  DependencyGraphResult,
  DependencyNode 
} from "../types";
import { 
  DEPENDENCY_GRAPH_SYSTEM_PROMPT,
  buildDependencyGraphPrompt 
} from "../prompts/dependency-graph";
import { getLLMClient } from "../services/llm-selector";
import { safeMaxTokens } from "../services/token-manager";
import { trackedLLMCall } from "../services/llm-call-tracker";
import { AGENT_TOKEN_BUDGETS, buildBudgetConstraint } from "../services/token-budgets";
import {
  analyzeAllCodeFiles,
  extractExternalPackages
} from "../services/code-analyzer";

/**
 * Execute Dependency Graph Agent
 * 
 * This is the SECOND agent in the upgrade analysis pipeline.
 * It builds a comprehensive dependency graph from package manifests.
 */
export async function executeDependencyGraphAgent(
  state: StackModernizationState
): Promise<StackModernizationState> {
  
  // Import logActivity
  const { logActivity } = await import("../state");
  
  let currentState = logActivity(state, "DependencyGraph", "Starting dependency analysis", "Building dependency tree...", "info");
  
  try {
    // Step 1: Validate we have repo profile
    if (!currentState.repoProfile) {
      throw new Error("Repository profile not available. Run RepoProfilerAgent first.");
    }
    
    // Check if we have manifests OR code files to analyze
    const hasManifests = currentState.repoProfile.packageManifests && currentState.repoProfile.packageManifests.length > 0;
    const hasCodeFiles = currentState.extractedFiles.some(f =>
      ['javascript', 'typescript', 'python', 'java', 'csharp'].includes(f.fileType)
    );
    
    if (!hasManifests && !hasCodeFiles) {
      console.warn("[DependencyGraphAgent] No manifests or code files found, skipping");
      
      currentState = logActivity(
        currentState,
        "DependencyGraph",
        "No analyzable files",
        "Skipping dependency analysis - no manifests or code files found",
        "warning"
      );
      
      return {
        ...currentState,
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
        },
        currentStage: "dependency_graph_complete",
        progress: 25
      };
    }
    
    // If no manifests but we have code files, extract dependencies from code
    let extractedDependencies: Array<{ name: string; version: string }> = [];
    
    if (!hasManifests && hasCodeFiles) {
      
      currentState = logActivity(
        currentState,
        "DependencyGraph",
        "Analyzing code for dependencies",
        "No manifests found - parsing import statements from code files",
        "info"
      );
      
      // Analyze code to extract dependencies
      const codeAnalyses = analyzeAllCodeFiles(currentState.extractedFiles);
      const packagesFromCode = extractExternalPackages(codeAnalyses);
      
      extractedDependencies = packagesFromCode.map(p => ({
        name: p.package,
        version: "unknown", // Version will be researched by VersionIntelligenceAgent
        isDev: false
      }));
      
      
      currentState = logActivity(
        currentState,
        "DependencyGraph",
        "Dependencies extracted from code",
        `Found ${extractedDependencies.length} packages from import statements`,
        "success"
      );
    }
    
    // Step 2: Extract dependencies from manifests OR code
    if (hasManifests) {
      
      currentState = logActivity(
        currentState,
        "DependencyGraph",
        "Extracting dependencies from manifests",
        `Processing ${currentState.repoProfile?.packageManifests?.length ?? 0} manifest file(s)`,
        "info"
      );
      
      extractedDependencies = extractDependenciesFromManifests(
        currentState.repoProfile?.packageManifests ?? []
      );
      
      
      // Fallback: if manifests yielded 0 deps but we have code files, extract from code
      if (extractedDependencies.length === 0 && hasCodeFiles) {
        currentState = logActivity(
          currentState,
          "DependencyGraph",
          "Using code-based extraction",
          "Manifests had no parseable deps - extracting from import statements",
          "info"
        );
        const codeAnalyses = analyzeAllCodeFiles(currentState.extractedFiles);
        const packagesFromCode = extractExternalPackages(codeAnalyses);
        extractedDependencies = packagesFromCode.map(p => ({
          name: p.package,
          version: "unknown",
          isDev: false
        }));
      }
      
      currentState = logActivity(
        currentState,
        "DependencyGraph",
        "Dependencies extracted from manifests",
        `Found ${extractedDependencies.length} direct dependencies`,
        "success"
      );
    }
    
    // At this point, extractedDependencies is populated either from manifests OR from code
    
    // Step 3: Build AI prompt with manifest data
    const promptData = {
      projectType: (state.repoProfile?.projectType ?? "unknown") as string,
      manifests: (state.repoProfile?.packageManifests ?? []).map(m => ({
        type: m.type as string,
        path: m.path,
        parsed: (m as any).parsed || {}
      })),
      extractedDependencies: extractedDependencies.map(d => ({
        name: d.name,
        version: d.version,
        isDev: 'isDev' in d ? !!(d as any).isDev : false
      })) as Array<{ name: string; version: string; isDev: boolean }>
    };
    
    const userPrompt = buildDependencyGraphPrompt(promptData);
    
    // Step 4: Call AI to analyze dependencies (using user-selected LLM)
    
    currentState = logActivity(
      currentState,
      "DependencyGraph",
      "Calling AI for analysis",
      `Using ${currentState.llmProvider} to build dependency graph and identify conflicts`,
      "info"
    );
    
    const { client, model, provider } = getLLMClient(currentState.llmProvider);
    
    const budgetBlock = buildBudgetConstraint("dependencyGraph", "json");
    const requestParams: any = {
      model,
      messages: [
        { role: "system", content: `${budgetBlock}\n\n${DEPENDENCY_GRAPH_SYSTEM_PROMPT}` },
        { role: "user", content: userPrompt }
      ],
      temperature: 0
    };
    
    if (provider === "azure-openai") {
      requestParams.response_format = { type: "json_object" };
    }
    requestParams.max_tokens = safeMaxTokens(AGENT_TOKEN_BUDGETS.dependencyGraph, model);
    
    const response = await trackedLLMCall(client, requestParams, { analysisId: currentState.analysisId, phase: "assessment", agent: "DependencyGraph" });
    
    const analysisResult = response.choices[0]?.message?.content;
    
    if (!analysisResult) {
      throw new Error("AI returned empty response");
    }
    
    // Step 5: Parse AI response (handle both raw JSON and markdown-wrapped JSON)
    let aiAnalysis: {
      directDependencies?: Array<{ name: string; version: string; isDirect?: boolean; isDevDependency?: boolean; dependsOn?: string[] }>;
      transitiveDependencies?: any[];
      peerConflicts?: any[];
      duplicateVersions?: any[];
      totalPackages?: number;
      depthAnalysis?: { maxDepth: number; averageDepth: number };
    };
    try {
      // Clean up the response - remove markdown code fences if present
      let cleanedResult = analysisResult.trim();
      
      // Remove markdown code fences (```json ... ``` or ``` ... ```)
      if (cleanedResult.startsWith("```")) {
        cleanedResult = cleanedResult.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim();
      }
      
      const tryParse = (str: string) => {
        try {
          return JSON.parse(str);
        } catch {
          return null;
        }
      };
      
      aiAnalysis = tryParse(cleanedResult);
      
      if (!aiAnalysis) {
        // Fix truncated JSON: remove trailing incomplete object and clean trailing commas
        let repaired = cleanedResult;
        repaired = repaired.replace(/,?\s*\{[^}]*$/, ''); // trailing incomplete object
        repaired = repaired.replace(/,(\s*[}\]])/g, '$1'); // remove trailing commas before } or ]
        aiAnalysis = tryParse(repaired);
      }
      
      if (!aiAnalysis) {
        // Try extracting up to last complete } or ]
        const lastBrace = cleanedResult.lastIndexOf('}');
        const lastBracket = cleanedResult.lastIndexOf(']');
        const cutPoint = Math.max(lastBrace, lastBracket);
        if (cutPoint > 100) {
          let truncated = cleanedResult.substring(0, cutPoint + 1);
          const openBraces = (truncated.match(/\{/g) || []).length;
          const closeBraces = (truncated.match(/\}/g) || []).length;
          const openBrackets = (truncated.match(/\[/g) || []).length;
          const closeBrackets = (truncated.match(/\]/g) || []).length;
          for (let i = 0; i < openBrackets - closeBrackets; i++) truncated += ']';
          for (let i = 0; i < openBraces - closeBraces; i++) truncated += '}';
          aiAnalysis = tryParse(truncated);
        }
      }
      
      if (!aiAnalysis) {
        console.warn("[DependencyGraphAgent] AI response parse failed, using extracted dependencies (truncated or invalid JSON)");
        aiAnalysis = {
          directDependencies: extractedDependencies.map(d => ({
            name: d.name,
            version: (d as any).version || "unknown",
            isDirect: true,
            isDevDependency: (d as any).isDev,
            dependsOn: []
          })),
          transitiveDependencies: [],
          peerConflicts: [],
          duplicateVersions: [],
          totalPackages: extractedDependencies.length
        };
      }
    } catch (parseError) {
      console.warn("[DependencyGraphAgent] Parse error, using extracted dependencies:", parseError);
      aiAnalysis = {
        directDependencies: extractedDependencies.map(d => ({
          name: d.name,
          version: (d as any).version || "unknown",
          isDirect: true,
          isDevDependency: (d as any).isDev,
          dependsOn: []
        })),
        transitiveDependencies: [],
        peerConflicts: [],
        duplicateVersions: [],
        totalPackages: extractedDependencies.length
      };
    }
    
    // Step 6: Merge LLM output with manifest-parsed data.
    // For Java/Maven projects, the LLM often simplifies "org.springframework.boot:spring-boot-starter-web"
    // to just "spring" or "spring-boot", which breaks Maven Central lookups.
    // We trust the parsed manifest data over the LLM for dependency names.
    const projectType = (state.repoProfile?.projectType ?? "unknown") as string;
    const isMavenProject = projectType.includes("java") || projectType.includes("maven") || projectType.includes("gradle");

    let mergedDeps: DependencyNode[];
    if (isMavenProject && extractedDependencies.length > 0) {
      // Build lookup from LLM output for extra metadata (dependsOn, isDevDependency, etc.)
      const aiDeps = aiAnalysis.directDependencies || [];
      const aiByName = new Map<string, any>();
      for (const d of aiDeps) {
        if (d.name) aiByName.set(d.name.toLowerCase(), d);
      }

      // Prefer manifest-parsed deps (they have proper groupId:artifactId format)
      mergedDeps = extractedDependencies.map((d: any): DependencyNode => {
        const name = d.name || "unknown";
        // Try to find matching AI dep by exact name or by artifactId part
        const aiMatch =
          aiByName.get(name.toLowerCase()) ||
          aiByName.get(name.split(":").pop()?.toLowerCase() || "");

        return {
          name,
          version: d.version || aiMatch?.version || "unknown",
          isDirect: true,
          isDevDependency: d.isDev ?? aiMatch?.isDevDependency ?? false,
          dependencies: aiMatch?.dependencies || aiMatch?.dependsOn || [],
        };
      });

      // Also add any LLM deps that weren't in the manifest (transitive that LLM promoted)
      const manifestNames = new Set(extractedDependencies.map((d: any) => (d.name || "").toLowerCase()));
      for (const aiDep of aiDeps) {
        if (!aiDep.name) continue;
        const n = aiDep.name.toLowerCase();
        // Only add if it has ":" (Maven format) and wasn't already included
        if (n.includes(":") && !manifestNames.has(n)) {
          mergedDeps.push({
            name: aiDep.name,
            version: aiDep.version || "unknown",
            isDirect: aiDep.isDirect ?? true,
            isDevDependency: aiDep.isDevDependency ?? false,
            dependencies: aiDep.dependencies || aiDep.dependsOn || [],
          });
        }
      }

    } else {
      // Non-Maven: use LLM output as before, falling back to extracted
      mergedDeps = ((aiAnalysis.directDependencies || extractedDependencies.map((d: any) => ({
        name: d.name,
        version: d.version || "unknown",
        isDirect: true,
        isDevDependency: !!d.isDev,
        dependencies: [],
      }))) as any[]).map((d: any): DependencyNode => ({
        name: d.name || "unknown",
        version: d.version || "unknown",
        isDirect: d.isDirect ?? true,
        isDevDependency: d.isDevDependency ?? false,
        dependencies: d.dependencies || d.dependsOn || [],
      }));
    }

    // Build dependency graph result
    const dependencyGraph: DependencyGraphResult = {
      directDependencies: mergedDeps,
      transitiveDependencies: aiAnalysis.transitiveDependencies || [],
      peerConflicts: aiAnalysis.peerConflicts || [],
      duplicateVersions: aiAnalysis.duplicateVersions || [],
      totalPackages: aiAnalysis.totalPackages || mergedDeps.length,
      depthAnalysis: aiAnalysis.depthAnalysis || {
        maxDepth: 1,
        averageDepth: 1
      }
    };
    
    
    currentState = logActivity(
      currentState,
      "DependencyGraph",
      "Dependency analysis complete",
      `✅ Total: ${dependencyGraph.totalPackages} packages, Conflicts: ${dependencyGraph.peerConflicts.length}, Duplicates: ${dependencyGraph.duplicateVersions.length}`,
      "success"
    );
    
    // Step 7: Update state
    return {
      ...currentState,
      dependencyGraph,
      currentStage: "dependency_graph_complete",
      progress: 25 // Second agent = 25% progress
    };
    
  } catch (error) {
    console.error("[DependencyGraphAgent] Error during analysis:", error);
    
    const { logActivity } = await import("../state");
    const errorState = logActivity(
      currentState,
      "DependencyGraph",
      "Analysis failed",
      error instanceof Error ? error.message : String(error),
      "error"
    );
    
    return {
      ...errorState,
      errors: [...errorState.errors, `DependencyGraphAgent failed: ${error instanceof Error ? error.message : String(error)}`]
    };
  }
}

// ===== Helper Functions =====

/**
 * Extract dependencies from package manifests
 */
function extractDependenciesFromManifests(manifests: any[]): Array<{
  name: string;
  version: string;
  isDev: boolean;
}> {
  const dependencies: Array<{ name: string; version: string; isDev: boolean }> = [];
  
  // Validate input
  if (!Array.isArray(manifests) || manifests.length === 0) {
    console.warn(`[DependencyGraphAgent] extractDependenciesFromManifests: No manifests provided`);
    return dependencies;
  }
  
  
  for (const manifest of manifests) {
    const parsed = (manifest as any).parsed;
    
    // Skip if no parsed data
    if (!parsed) {
      console.warn(`[DependencyGraphAgent] Manifest ${manifest.path} has no parsed data, skipping`);
      continue;
    }
    
    if (manifest.type === "package.json") {
      // Production dependencies
      if (parsed.dependencies) {
        Object.entries(parsed.dependencies).forEach(([name, version]) => {
          dependencies.push({
            name,
            version: version as string,
            isDev: false
          });
        });
      }
      
      // Dev dependencies
      if (parsed.devDependencies) {
        Object.entries(parsed.devDependencies).forEach(([name, version]) => {
          dependencies.push({
            name,
            version: version as string,
            isDev: true
          });
        });
      }
    } else if (manifest.type === "requirements.txt") {
      // Python dependencies
      if (parsed.dependencies && Array.isArray(parsed.dependencies)) {
        parsed.dependencies.forEach((dep: any) => {
          if (dep && dep.package) {
            dependencies.push({
              name: dep.package,
              version: dep.version || "*",
              isDev: false
            });
          }
        });
      }
    } else if (manifest.type === "pom.xml") {
      // Maven parent POM (e.g., spring-boot-starter-parent)
      if (parsed.parent?.groupId && parsed.parent?.artifactId) {
        dependencies.push({
          name: `${parsed.parent.groupId}:${parsed.parent.artifactId}`,
          version: parsed.parent.version || "unknown",
          isDev: false
        });
      }
      // Maven dependencies
      if (parsed.dependencies && Array.isArray(parsed.dependencies)) {
        parsed.dependencies.forEach((dep: any) => {
          if (dep && dep.groupId && dep.artifactId) {
            dependencies.push({
              name: `${dep.groupId}:${dep.artifactId}`,
              version: dep.version || "unknown",
              isDev: dep.scope === "test"
            });
          }
        });
      }
    } else if (manifest.type === "build.gradle") {
      // Gradle dependencies
      if (parsed.dependencies && Array.isArray(parsed.dependencies)) {
        parsed.dependencies.forEach((dep: any) => {
          if (dep && dep.notation) {
            dependencies.push({
              name: dep.notation,
              version: "unknown",
              isDev: dep.configuration === "testImplementation"
            });
          }
        });
      }
    } else if (manifest.type === "go.mod") {
      // Go dependencies
      if (parsed.dependencies && Array.isArray(parsed.dependencies)) {
        parsed.dependencies.forEach((dep: any) => {
          if (dep && dep.module) {
            dependencies.push({
              name: dep.module,
              version: dep.version || "unknown",
              isDev: false
            });
          }
        });
      }
    } else if (manifest.type === "csproj") {
      // .NET PackageReference
      if (parsed.dependencies && Array.isArray(parsed.dependencies)) {
        parsed.dependencies.forEach((dep: any) => {
          if (dep && dep.name) {
            dependencies.push({
              name: dep.name,
              version: dep.version || "unknown",
              isDev: false
            });
          }
        });
      }
    } else if (manifest.type === "Gemfile") {
      // Ruby dependencies
      if (parsed.dependencies && Array.isArray(parsed.dependencies)) {
        parsed.dependencies.forEach((dep: any) => {
          if (dep && dep.name) {
            dependencies.push({
              name: dep.name,
              version: dep.version || "*",
              isDev: false
            });
          }
        });
      }
    } else if (manifest.type === "composer.json") {
      // PHP dependencies
      if (parsed.require && typeof parsed.require === 'object') {
        Object.entries(parsed.require).forEach(([name, version]) => {
          if (name && version) {
            dependencies.push({
              name,
              version: version as string,
              isDev: false
            });
          }
        });
      }
      
      if (parsed["require-dev"] && typeof parsed["require-dev"] === 'object') {
        Object.entries(parsed["require-dev"]).forEach(([name, version]) => {
          if (name && version) {
            dependencies.push({
              name,
              version: version as string,
              isDev: true
            });
          }
        });
      }
    }

    // libman.json – ASP.NET Core client-side library manager
    if (manifest.type === "libman.json") {
      const libDeps = parsed.dependencies || [];
      if (Array.isArray(libDeps)) {
        for (const dep of libDeps) {
          if (dep && dep.name) {
            dependencies.push({ name: dep.name, version: dep.version || "*", isDev: false });
          }
        }
      }
    }

    // bower.json – Bower package manager
    if (manifest.type === "bower.json") {
      const bowerDeps = parsed.dependencies || [];
      if (Array.isArray(bowerDeps)) {
        for (const dep of bowerDeps) {
          if (dep && dep.name) {
            dependencies.push({ name: dep.name, version: dep.version || "*", isDev: false });
          }
        }
      }
    }
  }
  
  
  return dependencies;
}
