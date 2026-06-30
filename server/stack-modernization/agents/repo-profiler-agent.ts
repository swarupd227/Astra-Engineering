/**
 * Stack Modernization - Repository Profiler Agent
 * First agent in the LangGraph workflow
 * 
 * Responsibility: Analyze uploaded code repository and create comprehensive technology stack profile
 * 
 * This agent establishes "ground truth" about the repository:
 * - Project type (Node.js, Python, Java, etc.)
 * - Programming languages and versions
 * - Frameworks and libraries
 * - Build tools and package managers
 * - CI/CD configuration
 * - Docker/containerization setup
 * - Project structure patterns
 */

import type { StackModernizationState, RepoProfileResult, ProjectType, FrameworkInfo, CIConfig, RuntimeInfo } from "../types";
import { 
  identifyManifestFiles,
  identifyCIFiles,
  identifyDockerFiles,
  getFileStructureStats 
} from "../services/file-handler";
import {
  parseManifestFiles,
  extractRuntimeInfo,
  parseDockerfile
} from "../services/file-parser";
import { detectTechStack } from "../services/tech-stack-detector";
import { 
  REPO_PROFILER_SYSTEM_PROMPT,
  buildRepoProfilerPrompt 
} from "../prompts/repo-profiler";

// Import LLM selector (integrates with existing llm-config)
import { getLLMClient } from "../services/llm-selector";
import { safeMaxTokens } from "../services/token-manager";
import { trackedLLMCall } from "../services/llm-call-tracker";
import { AGENT_TOKEN_BUDGETS, buildBudgetConstraint } from "../services/token-budgets";

// Import code analyzer for deep code analysis
import {
  analyzeAllCodeFiles,
  extractExternalPackages,
  extractFrameworks as extractFrameworksFromCode,
  getCodeSamples
} from "../services/code-analyzer";

// Import runtime detector for version detection
import {
  detectAllRuntimeVersions,
  detectVendorDirectoryLibraries,
  type DetectedRuntime
} from "../services/runtime-detector";
import { collectVendorFilePaths } from "../services/temp-storage";

/**
 * Execute Repository Profiler Agent
 * 
 * This is the FIRST agent in the upgrade analysis pipeline.
 * It establishes the baseline understanding of what the repository is.
 */
export async function executeRepoProfilerAgent(
  state: StackModernizationState
): Promise<StackModernizationState> {
  
  // Import logActivity
  const { logActivity } = await import("../state");
  
  let currentState = logActivity(state, "RepoProfiler", "Starting repository analysis", `Analyzing ${state.extractedFiles.length} files`, "info");
  
  try {
    // Step 1: Validate we have extracted files
    if (!currentState.extractedFiles || currentState.extractedFiles.length === 0) {
      throw new Error("No extracted files available for analysis");
    }
    
    currentState = logActivity(currentState, "RepoProfiler", "Files validated", `${currentState.extractedFiles.length} files ready for analysis`, "success");
    
    // Step 2: Identify key files
    currentState = logActivity(currentState, "RepoProfiler", "Scanning for key files", "Looking for package.json, pom.xml, requirements.txt...", "info");
    
    const manifestFiles = identifyManifestFiles(currentState.extractedFiles);
    const ciFiles = identifyCIFiles(currentState.extractedFiles);
    const dockerFiles = identifyDockerFiles(currentState.extractedFiles);
    const fileStats = getFileStructureStats(currentState.extractedFiles);
    
    
    currentState = logActivity(
      currentState, 
      "RepoProfiler", 
      "Key files identified", 
      `Found: ${manifestFiles.length} manifests, ${ciFiles.length} CI configs, ${dockerFiles.length} Docker files`,
      "success"
    );
    
    // Step 3: Parse manifest files
    if (manifestFiles.length > 0) {
      currentState = logActivity(
        currentState,
        "RepoProfiler",
        "Parsing package manifests",
        manifestFiles.map(f => f.relativePath).join(", "),
        "info"
      );
    }
    
    const parsedManifests = parseManifestFiles(manifestFiles);
    let runtimeInfo = extractRuntimeInfo(parsedManifests);

    // Deterministic tech stack detector (no LLM) — ensures .NET etc. are detected even if manifest list missed files
    const techStack = detectTechStack(currentState.extractedFiles);
    let manifestsToUse = parsedManifests;

    if (techStack && techStack.confidence !== "low") {
      if (techStack.ecosystem === "dotnet" && techStack.runtime?.version) {
        const rtName = techStack.runtime.framework?.startsWith("net") && !techStack.runtime.framework.includes("4.")
          ? ".NET"
          : ".NET Framework";
        if (!runtimeInfo.some((r) => r.language === ".NET" || r.language === ".NET Framework")) {
          runtimeInfo = [
            ...runtimeInfo,
            {
              language: rtName,
              version: techStack.runtime.version,
              source: techStack.sourcePath ? `tech-stack-detector (${techStack.sourcePath})` : "tech-stack-detector",
            },
          ];
        }
      }
      if (parsedManifests.length === 0 && techStack.dependencies?.length > 0 && techStack.sourcePath) {
        const synthetic = {
          type: "csproj" as const,
          path: techStack.sourcePath,
          content: "",
          parsed: {
            targetFramework: techStack.runtime?.framework,
            dependencies: techStack.dependencies,
          },
        };
        manifestsToUse = [synthetic as any];
      }
    }

    if (parsedManifests.length > 0 || manifestsToUse.length > 0) {
      currentState = logActivity(
        currentState,
        "RepoProfiler",
        "Manifests parsed",
        `Extracted ${runtimeInfo.length} runtime version(s), ${manifestsToUse.length} manifest(s)`,
        "success"
      );
    }

    // ===== NEW: DEEP CODE ANALYSIS =====
    // Analyze ACTUAL code files, not just manifests
    currentState = logActivity(
      currentState,
      "RepoProfiler",
      "Deep code analysis starting",
      `Reading and parsing ${currentState.extractedFiles.length} code files for imports and patterns`,
      "info"
    );
    
    const codeAnalyses = analyzeAllCodeFiles(currentState.extractedFiles);
    
    // Extract packages from code (even if no manifest exists)
    const packagesFromCode = extractExternalPackages(codeAnalyses);
    const frameworksFromCode = extractFrameworksFromCode(codeAnalyses);
    
    // Get actual code samples to send to AI
    const codeSamples = getCodeSamples(currentState.extractedFiles, 10, 100);
    
    
    currentState = logActivity(
      currentState,
      "RepoProfiler",
      "Code analysis complete",
      `✅ Found ${packagesFromCode.length} packages, ${frameworksFromCode.length} frameworks from ${codeAnalyses.length} code files`,
      "success"
    );
    
    // ===== NEW: RUNTIME VERSION DETECTION =====
    currentState = logActivity(
      currentState,
      "RepoProfiler",
      "Detecting runtime versions",
      "Scanning for Node.js, Python, React, TypeScript versions...",
      "info"
    );
    
    const detectedRuntimes = detectAllRuntimeVersions(currentState.extractedFiles);

    // Supplement with vendor directory scanning (reads lightweight headers from vendor dirs
    // that are excluded from extractedFiles for performance)
    if (currentState.tempDir) {
      try {
        const vendorPaths = await collectVendorFilePaths(currentState.tempDir);
        if (vendorPaths.length > 0) {
          const vendorLibs = detectVendorDirectoryLibraries(
            vendorPaths.map(vp => ({
              relativePath: vp.relativePath,
              content: vp.content,
              fullPath: "",
              size: 0,
              extension: vp.relativePath.substring(vp.relativePath.lastIndexOf('.')).toLowerCase(),
              fileType: "javascript" as const,
            }))
          );
          const existingNames = new Set(detectedRuntimes.map(r => r.name));
          for (const lib of vendorLibs) {
            if (!existingNames.has(lib.name)) {
              detectedRuntimes.push(lib);
              existingNames.add(lib.name);
            }
          }
          if (vendorLibs.length > 0) {
            console.log(`[RepoProfiler] Detected ${vendorLibs.length} additional libraries from vendor directories`);
          }
        }
      } catch (err) {
        console.warn(`[RepoProfiler] Vendor directory scan failed:`, err);
      }
    }
    
    currentState = logActivity(
      currentState,
      "RepoProfiler",
      "Runtime versions detected",
      `✅ Detected ${detectedRuntimes.length} runtime/framework versions: ${detectedRuntimes.map((r: any) => `${r.name || r.language}@${r.currentVersion || r.version}`).join(', ')}`,
      "success"
    );
    
    // Step 4: Parse Docker files for additional runtime info
    let dockerInfo = {
      hasDockerfile: false,
      hasDockerCompose: false,
    };
    
    for (const dockerFile of dockerFiles) {
      const filename = dockerFile.relativePath.toLowerCase();
      if (filename.includes("dockerfile")) {
        dockerInfo.hasDockerfile = true;
        const parsed = parseDockerfile(dockerFile.content);
        dockerInfo = { ...dockerInfo, ...parsed };
      } else if (filename.includes("docker-compose")) {
        dockerInfo.hasDockerCompose = true;
      }
    }
    
    // Step 5: Build AI prompt with repository context INCLUDING ACTUAL CODE
    const fileStructurePreview = buildFileStructureTree(currentState.extractedFiles.slice(0, 50));
    
    const promptData = {
      totalFiles: currentState.extractedFiles.length,
      codeFiles: fileStats.codeFiles,
      configFiles: fileStats.configFiles,
      manifests: parsedManifests.map(m => ({
        type: m.type,
        path: m.path,
        content: m.content
      })),
      ciFiles: ciFiles.map(f => ({
        path: f.relativePath,
        content: f.content.substring(0, 1000)
      })),
      dockerFiles: dockerFiles.map(f => ({
        path: f.relativePath,
        content: f.content.substring(0, 1000)
      })),
      fileStructure: fileStructurePreview,
      keyFiles: manifestFiles.slice(0, 5).map(f => ({
        path: f.relativePath,
        content: f.content
      })),
      // NEW: Include deep code analysis results
      codeAnalysis: {
        analyzedFiles: codeAnalyses.length,
        totalLOC: codeAnalyses.reduce((sum, a) => sum + a.linesOfCode, 0),
        packagesFromCode: packagesFromCode.slice(0, 30).map((p: any) => ({
          package: p.package,
          importCount: p.importCount,
          usedInFiles: (p.usedIn || []).length
        })),
        frameworksFromCode: frameworksFromCode.map((f: any) => ({
          name: f.name,
          usedInFiles: (f.usedIn || []).length
        })),
        codeSamples: codeSamples.slice(0, 5).map(s => ({
          file: s.file,
          language: s.language,
          preview: s.preview
        }))
      }
    };
    
    const userPrompt = buildRepoProfilerPrompt(promptData);
    
    // Step 6: Call AI to analyze the repository (using user-selected LLM)
    
    currentState = logActivity(
      currentState,
      "RepoProfiler",
      "Calling AI for analysis",
      `Using ${currentState.llmProvider} to analyze repository structure and tech stack`,
      "info"
    );
    
    const { client, model, provider } = getLLMClient(currentState.llmProvider);
    
    const budgetBlock = buildBudgetConstraint("repoProfiler", "json");
    const requestParams: any = {
      model,
      messages: [
        { role: "system", content: `${budgetBlock}\n\n${REPO_PROFILER_SYSTEM_PROMPT}` },
        { role: "user", content: userPrompt }
      ],
      temperature: 0
    };
    
    if (provider === "azure-openai") {
      requestParams.response_format = { type: "json_object" };
    }
    requestParams.max_tokens = safeMaxTokens(AGENT_TOKEN_BUDGETS.repoProfiler, model);
    
    const response = await trackedLLMCall(client, requestParams, { analysisId: currentState.analysisId, phase: "assessment", agent: "RepoProfiler" });
    
    const analysisResult = response.choices[0]?.message?.content;
    
    if (!analysisResult) {
      throw new Error("AI returned empty response");
    }
    
    // Step 7: Parse AI response (handle both raw JSON and markdown-wrapped JSON)
    let aiAnalysis;
    try {
      // Clean up the response - remove markdown code fences if present
      let cleanedResult = analysisResult.trim();
      
      // Remove markdown code fences (```json ... ``` or ``` ... ```)
      if (cleanedResult.startsWith("```")) {
        cleanedResult = cleanedResult.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim();
      }
      
      aiAnalysis = JSON.parse(cleanedResult);
      
      currentState = logActivity(
        currentState,
        "RepoProfiler",
        "AI analysis complete",
        `Identified: ${aiAnalysis.projectType || 'unknown'} project with ${aiAnalysis.languages?.length || 0} language(s)`,
        "success"
      );
      
    } catch (parseError) {
      console.warn("[RepoProfilerAgent] AI parse failed, building minimal profile from manifests");
      aiAnalysis = {
        projectType: determineProjectType(manifestsToUse),
        languages: extractLanguages(currentState.extractedFiles),
        frameworks: extractFrameworks(manifestsToUse),
        runtimeInfo: []
      };
    }
    
    // Step 8: Enrich AI analysis with our parsed data
    // CRITICAL: Merge runtimeInfo from manifests + tech-stack detector + detectedRuntimes
    const combinedRuntimeInfo: RuntimeInfo[] = [
      ...runtimeInfo,
      ...detectedRuntimes.map((rt: DetectedRuntime) => ({
        language: (rt as any).name || (rt as any).language || "unknown",
        version: (rt as any).currentVersion || (rt as any).version || "unknown",
        source: (rt as any).source || "code-analysis",
      } as RuntimeInfo)),
    ];
    
    // Deduplicate by language (keep first occurrence)
    const seen = new Set<string>();
    const uniqueRuntimeInfo = combinedRuntimeInfo.filter(rt => {
      const key = rt.language.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    
    uniqueRuntimeInfo.forEach(rt => {
    });
    
    const repoProfile: RepoProfileResult = {
      projectType: aiAnalysis.projectType || determineProjectType(manifestsToUse),
      languages: aiAnalysis.languages || extractLanguages(currentState.extractedFiles),
      runtimeInfo: uniqueRuntimeInfo.length > 0 ? uniqueRuntimeInfo : aiAnalysis.runtimeInfo || [],
      frameworks: aiAnalysis.frameworks || extractFrameworks(manifestsToUse),
      packageManifests: manifestsToUse.map(m => ({
        type: m.type,
        path: m.path,
        content: m.content,
        parsed: m.parsed,
        summary: summarizeManifest(m)
      })) as any,
      ciConfig: ciFiles.length > 0 ? ({
        platform: detectCIPlatform(ciFiles[0].relativePath),
        config: {},
        path: ciFiles[0].relativePath
      } as any) : undefined,
      dockerInfo: dockerInfo as any,
      fileStructure: fileStats,
      detectedPatterns: {
        isMonorepo: detectMonorepo(parsedManifests),
        hasTests: fileStats.testFiles > 0,
        hasDocker: dockerInfo.hasDockerfile,
        hasCI: ciFiles.length > 0,
        hasLinting: detectLinting(currentState.extractedFiles)
      },
      detectedRuntimes: detectedRuntimes // NEW: Include detected runtime versions
    };
    
    
    currentState = logActivity(
      currentState,
      "RepoProfiler",
      "Repository profiling complete",
      `✅ Project: ${repoProfile.projectType}, Languages: ${repoProfile.languages.join(", ")}, Frameworks: ${repoProfile.frameworks.length}`,
      "success"
    );
    
    // Step 9: Update state with analysis results
    return {
      ...currentState,
      repoProfile,
      currentStage: "repo_profiling_complete",
      progress: 10, // First agent = 10% progress
    };
    
  } catch (error) {
    console.error("[RepoProfilerAgent] Error during analysis:", error);
    
    const { logActivity } = await import("../state");
    let errorState = logActivity(
      currentState,
      "RepoProfiler",
      "AI unavailable - building minimal profile from manifests",
      error instanceof Error ? error.message : String(error),
      "warning"
    );
    
    // CRITICAL: Build minimal repoProfile so downstream agents (DependencyGraph, VersionIntelligence) can run
    try {
      const manifestFiles = identifyManifestFiles(currentState.extractedFiles || []);
      const parsedManifests = parseManifestFiles(manifestFiles);
      let runtimeInfoMin = extractRuntimeInfo(parsedManifests);
      let manifestsMin = parsedManifests;

      const techStackMin = detectTechStack(currentState.extractedFiles || []);
      if (techStackMin && techStackMin.confidence !== "low" && techStackMin.ecosystem === "dotnet" && techStackMin.runtime?.version) {
        if (!runtimeInfoMin.some((r) => r.language === ".NET" || r.language === ".NET Framework")) {
          const rtName = techStackMin.runtime.framework?.startsWith("net") && !String(techStackMin.runtime.framework).includes("4.") ? ".NET" : ".NET Framework";
          runtimeInfoMin = [...runtimeInfoMin, { language: rtName, version: techStackMin.runtime.version, source: "tech-stack-detector" }];
        }
        if (parsedManifests.length === 0 && techStackMin.dependencies?.length > 0 && techStackMin.sourcePath) {
          manifestsMin = [{
            type: "csproj",
            path: techStackMin.sourcePath,
            content: "",
            parsed: { targetFramework: techStackMin.runtime?.framework, dependencies: techStackMin.dependencies },
          } as any];
        }
      }

      const fileStats = getFileStructureStats(currentState.extractedFiles);
      const dockerFiles = identifyDockerFiles(currentState.extractedFiles);
      let dockerInfo = { hasDockerfile: false, hasDockerCompose: false };
      for (const df of dockerFiles) {
        if (df.relativePath.toLowerCase().includes('dockerfile')) dockerInfo.hasDockerfile = true;
        if (df.relativePath.toLowerCase().includes('docker-compose')) dockerInfo.hasDockerCompose = true;
      }

      const minimalProfile: RepoProfileResult = {
        projectType: determineProjectType(manifestsMin),
        languages: extractLanguages(currentState.extractedFiles),
        runtimeInfo: runtimeInfoMin,
        frameworks: extractFrameworks(manifestsMin),
        packageManifests: manifestsMin.map(m => ({
          type: m.type,
          path: m.path,
          content: m.content,
          parsed: m.parsed,
          summary: summarizeManifest(m)
        })) as any,
        fileStructure: fileStats,
        detectedPatterns: {
          isMonorepo: detectMonorepo(manifestsMin),
          hasTests: fileStats.testFiles > 0,
          hasDocker: dockerInfo.hasDockerfile,
          hasCI: false,
          hasLinting: false
        }
      };
      
      return {
        ...errorState,
        repoProfile: minimalProfile,
        currentStage: "repo_profiling_complete",
        progress: 10,
        errors: [...errorState.errors, `RepoProfiler AI unavailable. Using minimal profile from ${parsedManifests.length} manifest(s).`]
      };
    } catch (fallbackError) {
      return {
        ...errorState,
        errors: [...errorState.errors, `RepoProfilerAgent failed: ${error instanceof Error ? error.message : String(error)}`],
      };
    }
  }
}

// ===== Helper Functions =====

/**
 * Build a visual tree of file structure
 */
function buildFileStructureTree(files: any[]): string {
  const paths = files.map(f => f.relativePath).sort();
  const tree: string[] = ["File Structure (first 50 files):", ""];
  
  for (const path of paths) {
    const depth = path.split("/").length - 1;
    const indent = "  ".repeat(depth);
    const filename = path.split("/").pop();
    tree.push(`${indent}${filename}`);
  }
  
  return tree.join("\n");
}

/**
 * Determine project type from manifests
 */
function determineProjectType(manifests: any[]): ProjectType {
  for (const manifest of manifests) {
    if (manifest.type === "csproj") return "dotnet";
    if (manifest.type === "package.json") return "nodejs";
    if (manifest.type === "requirements.txt") return "python";
    if (manifest.type === "pom.xml") return "java-maven";
    if (manifest.type === "build.gradle") return "java-gradle";
    if (manifest.type === "go.mod") return "go";
    if (manifest.type === "Gemfile") return "ruby";
    if (manifest.type === "composer.json") return "php";
  }
  return "unknown";
}

/**
 * Extract languages from file extensions
 */
function extractLanguages(files: any[]): string[] {
  const languageMap: Record<string, string> = {
    ".js": "JavaScript",
    ".jsx": "JavaScript",
    ".ts": "TypeScript",
    ".tsx": "TypeScript",
    ".py": "Python",
    ".java": "Java",
    ".cs": "C#",
    ".go": "Go",
    ".rb": "Ruby",
    ".php": "PHP",
  };
  
  const languages = new Set<string>();
  for (const file of files) {
    const lang = languageMap[file.extension];
    if (lang) languages.add(lang);
  }
  
  return Array.from(languages);
}

/**
 * Extract frameworks from parsed manifests
 */
function extractFrameworks(manifests: any[]): FrameworkInfo[] {
  const frameworks: FrameworkInfo[] = [];
  
  for (const manifest of manifests) {
    if (manifest.type === "package.json") {
      const deps = { ...manifest.parsed.dependencies, ...manifest.parsed.devDependencies };
      
      // Web frameworks
      if (deps.react) frameworks.push({ name: "React", version: deps.react, type: "web" });
      if (deps.vue) frameworks.push({ name: "Vue", version: deps.vue, type: "web" });
      if (deps.angular || deps["@angular/core"]) frameworks.push({ name: "Angular", version: deps["@angular/core"] || deps.angular, type: "web" });
      if (deps.next) frameworks.push({ name: "Next.js", version: deps.next, type: "web" });
      
      // API frameworks
      if (deps.express) frameworks.push({ name: "Express", version: deps.express, type: "api" });
      if (deps["@nestjs/core"]) frameworks.push({ name: "NestJS", version: deps["@nestjs/core"], type: "api" });
      
      // Build tools
      if (deps.webpack) frameworks.push({ name: "Webpack", version: deps.webpack, type: "build" });
      if (deps.vite) frameworks.push({ name: "Vite", version: deps.vite, type: "build" });
    }
  }
  
  return frameworks;
}

/**
 * Summarize a package manifest
 */
function summarizeManifest(manifest: any): string {
  if (manifest.type === "package.json") {
    const depCount = Object.keys(manifest.parsed.dependencies || {}).length;
    const devDepCount = Object.keys(manifest.parsed.devDependencies || {}).length;
    return `${depCount} dependencies, ${devDepCount} dev dependencies`;
  }
  return "Package manifest";
}

/**
 * Detect CI platform from file path
 */
function detectCIPlatform(path: string): string {
  if (path.includes(".github/workflows")) return "github-actions";
  if (path.includes(".gitlab-ci")) return "gitlab-ci";
  if (path.includes("Jenkinsfile")) return "jenkins";
  if (path.includes("azure-pipelines")) return "azure-devops";
  if (path.includes(".circleci")) return "circleci";
  if (path.includes(".travis")) return "travis";
  return "unknown";
}

/**
 * Detect if project is a monorepo
 */
function detectMonorepo(manifests: any[]): boolean {
  // Multiple package.json files = likely monorepo
  const packageJsonCount = manifests.filter(m => m.type === "package.json").length;
  return packageJsonCount > 1;
}

/**
 * Detect linting configuration
 */
function detectLinting(files: any[]): boolean {
  const lintFiles = [".eslintrc", ".eslintrc.json", ".eslintrc.js", "eslint.config.js", ".pylintrc", "pylint.cfg"];
  return files.some(f => lintFiles.some(lf => f.relativePath.toLowerCase().includes(lf)));
}
