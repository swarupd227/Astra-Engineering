/**
 * Stack Modernization - Version Intelligence Agent
 * Third agent in the LangGraph workflow
 * 
 * Responsibility: Research and recommend target versions for dependencies
 * 
 * This agent:
 * - Identifies current versions from manifests
 * - Researches latest stable and LTS versions
 * - Recommends upgrade paths
 * - Assesses upgrade risk levels
 * - Detects EOL (End of Life) versions
 */

import type { 
  StackModernizationState, 
  VersionRecommendation,
  DependencyNode,
  RepoProfileResult
} from "../types";
import { 
  VERSION_INTELLIGENCE_SYSTEM_PROMPT,
  buildVersionIntelligencePrompt,
  buildVersionIntelligencePromptWithRealVersions
} from "../prompts/version-intelligence";
import { getLLMClient } from "../services/llm-selector";
import { safeMaxTokens } from "../services/token-manager";
import { trackedLLMCall } from "../services/llm-call-tracker";
import { AGENT_TOKEN_BUDGETS, buildBudgetConstraint } from "../services/token-budgets";
import { 
  fetchMultiplePackageVersions, 
  detectCurrentVersion,
  type PackageVersionInfo 
} from "../services/version-registry";
import { 
  isValidDotNetVersion,
  getDotNetVersionDetails,
  getAvailableDotNetVersions,
  getRecommendedUpgradeTarget as getDotNetRecommendedUpgrade
} from "../services/dotnet-version-registry";
// @ts-ignore - no declaration file
import * as semver from "semver";

/**
 * Returns true if recommended would be a downgrade from current (e.g. 9.0 -> 8.0, 13.0.0 -> 8.0.0).
 * Never recommend downgrades; keep current or recommend a higher version.
 */
function isVersionDowngrade(current: string, recommended: string): boolean {
  if (!current || !recommended || current === "unknown" || recommended === "unknown") return false;
  const c = semver.coerce(current);
  const r = semver.coerce(recommended);
  if (!c || !r) return false;
  return semver.lt(r, c);
}

/**
 * Exclusion-based filter: keep all real dependencies, only exclude known false positives
 * (local project classes, internal utility modules, file paths, etc.)
 */
function filterMajorTechStack(deps: Array<{ name: string; version: string }>): Array<{ name: string; version: string }> {
  const KNOWN_FALSE_POSITIVES = new Set([
    'genericactions', 'waithelpers', 'browserclient', 'webdriverio',
  ]);

  const EXCLUDE_SUFFIX_PATTERNS = [
    /Helper$/,
    /Helpers$/,
    /Util$/,
    /Utils$/,
    /Extensions$/,
    /\.Tests$/i,
    /\.Test$/i,
    /\.Mock$/i,
    /\.Fakes$/i,
  ];

  return deps.filter(dep => {
    const name = dep.name;
    const lower = name.toLowerCase();

    if (!name || name.length < 2) return false;
    if (KNOWN_FALSE_POSITIVES.has(lower)) return false;

    if (name.startsWith('/') || name.startsWith('./') || name.startsWith('..') || name.includes('\\')) return false;

    if (name.includes(' ') && !name.includes('.') && name.split(' ').length > 3) return false;

    // Scoped npm packages, Maven coordinates — always real dependencies
    if (name.startsWith('@') || (name.includes(':') && !name.startsWith('@'))) return true;

    // NuGet-style dotted packages (Microsoft.*, System.*, etc.) — always real
    if (name.includes('.') && /^[A-Z]/.test(name)) return true;

    // Only exclude suffix patterns for multi-segment names (ProjectName.Helpers)
    if (name.includes('.')) {
      for (const pattern of EXCLUDE_SUFFIX_PATTERNS) {
        if (pattern.test(name)) return false;
      }
    }

    return true;
  });
}

/**
 * Execute Version Intelligence Agent
 * 
 * This is the THIRD agent in the upgrade analysis pipeline.
 * It researches version information and recommends upgrade targets.
 */
export async function executeVersionIntelligenceAgent(
  state: StackModernizationState
): Promise<StackModernizationState> {
  
  // Import logActivity
  const { logActivity } = await import("../state");
  
  let currentState = logActivity(
    state, 
    "VersionIntelligence", 
    "Starting version analysis", 
    "Researching latest versions and upgrade paths...", 
    "info"
  );
  
  let registryVersions: PackageVersionInfo[] = [];
  let successfulRegistry: PackageVersionInfo[] = [];
  
  try {
    // Step 1: Validate prerequisites
    if (!currentState.repoProfile) {
      throw new Error("Repository profile not available. Run RepoProfilerAgent first.");
    }
    
    // Step 2: Extract dependency information - use dependency graph or fallback to manifests
    let directDeps: Array<{ name: string; version: string }> = [];
    let transitiveDeps: any[] = [];
    let conflicts: any[] = [];
    
    // FIRST: Add runtime versions (Node, Python, Java, .NET, etc.) - These are MOST IMPORTANT
    const runtimeVersions: Array<{ name: string; version: string }> = [];
    
    // Check both runtimeInfo (new) and runtimeVersions (old) for backwards compatibility
    const runtimeSource = currentState.repoProfile?.runtimeInfo || [];
    
    if (runtimeSource.length > 0) {
      runtimeSource.forEach((runtime: any) => {
        const runtimeName = runtime.name || runtime.runtime || runtime.technology || runtime.language;
        const runtimeVersion = runtime.version || runtime.currentVersion;
        
        if (runtimeName && runtimeVersion) {
          // Keep original name (don't lowercase for .NET)
          const name = runtimeName === '.NET' || runtimeName === '.NET Framework' 
            ? runtimeName 
            : runtimeName;
          runtimeVersions.push({
            name,
            version: runtimeVersion
          });
        }
      });
    } else {
      console.warn(`[VersionIntelligenceAgent] ⚠️ No runtime versions found in repoProfile!`);
    }
    
    // SECOND: Add major frameworks from RepoProfiler (React, Express, Django, etc.)
    const frameworkVersions: Array<{ name: string; version: string }> = [];
    if (currentState.repoProfile?.frameworks?.length) {
      currentState.repoProfile.frameworks.forEach((fw: any) => {
        if (fw.name && fw.version) {
          frameworkVersions.push({
            name: fw.name.toLowerCase(),
            version: fw.version
          });
        }
      });
    }

    // SECOND-B: Add all detected runtimes/libraries (jQuery, Bootstrap, Handlebars, etc.) from runtime detector
    const detectedLibraryVersions: Array<{ name: string; version: string }> = [];
    const clientSidePackageNames = new Set<string>();
    const detectedRuntimes = (currentState.repoProfile as any)?.detectedRuntimes || currentState.repoProfile?.runtimeInfo || [];
    detectedRuntimes.forEach((rt: any) => {
      const name = rt.name || rt.language || rt.runtime || rt.technology;
      const version = rt.version || rt.currentVersion;
      if (name && version) {
        const displayName = name === '.NET' || name === '.NET Framework' ? name : name;
        detectedLibraryVersions.push({ name: displayName, version: String(version) });
      }
      const method = rt.detectionMethod || '';
      if (rt.type === 'library' || method === 'script-tag' || method === 'vendor-directory' || method === 'libman.json') {
        clientSidePackageNames.add((name || '').toLowerCase());
      }
    });

    // THIRD: Add package dependencies from dependency graph
    if (currentState.dependencyGraph?.directDependencies?.length) {
      const rawDeps = currentState.dependencyGraph.directDependencies;
      const packageDeps = rawDeps.map((d: any) => ({
        name: d.name || d.package || String(d),
        version: d.version || d.currentVersion || 'unknown'
      }));
      
      // Filter to keep only major packages (not local utility classes)
      directDeps = filterMajorTechStack(packageDeps);
      
      transitiveDeps = extractTransitiveDependencies(currentState.dependencyGraph.transitiveDependencies || []);
      conflicts = currentState.dependencyGraph.duplicateVersions || [];
      currentState = logActivity(
        currentState,
        "VersionIntelligence",
        "Prerequisites validated",
        `Found ${directDeps.length} major packages from dependency graph (filtered from ${packageDeps.length} total)`,
        "success"
      );
    }
    
    // For Java projects, prefer Maven-format deps over framework shorthand names.
    const detectedProjectType = currentState.repoProfile?.projectType || 'unknown';
    const hasPomInFiles = (currentState.extractedFiles ?? []).some(
      (f: { relativePath?: string; fullPath?: string }) =>
        ((f.relativePath || f.fullPath || '').toLowerCase().endsWith('pom.xml'))
    );
    const isJavaProject =
      detectedProjectType.includes("java") ||
      detectedProjectType.includes("maven") ||
      detectedProjectType.includes("gradle") ||
      hasPomInFiles;

    // Build a set of Maven artifactIds so we can skip duplicate framework short-names
    const mavenArtifactIds = new Set<string>();
    if (isJavaProject) {
      for (const dep of directDeps) {
        const n = dep.name.toLowerCase();
        if (n.includes(":")) {
          mavenArtifactIds.add(n.split(":")[1]);
          // Also add common short names this Maven dep covers
          if (n.includes("springframework")) mavenArtifactIds.add("spring");
          if (n.includes("spring-boot")) mavenArtifactIds.add("spring boot");
          if (n.includes("spring-boot")) mavenArtifactIds.add("spring-boot");
          if (n.includes("hibernate")) mavenArtifactIds.add("hibernate");
          if (n.includes("jackson")) mavenArtifactIds.add("jackson");
          if (n.includes("junit")) mavenArtifactIds.add("junit");
          if (n.includes("slf4j")) mavenArtifactIds.add("slf4j");
          if (n.includes("logback")) mavenArtifactIds.add("logback");
          if (n.includes("log4j")) mavenArtifactIds.add("log4j");
        }
      }
    }

    // Filter framework/library short names that are already covered by Maven deps
    const filteredFrameworkVersions = isJavaProject
      ? frameworkVersions.filter(fw => !mavenArtifactIds.has(fw.name.toLowerCase()))
      : frameworkVersions;
    const filteredLibVersions = isJavaProject
      ? detectedLibraryVersions.filter(lib => !mavenArtifactIds.has(lib.name.toLowerCase()))
      : detectedLibraryVersions;

    // Combine: Runtime + Frameworks + Detected libraries + Major Dependencies from graph
    // For Java: Maven deps (directDeps) come first to take priority in dedup
    const allMajorDeps = isJavaProject
      ? [...runtimeVersions, ...directDeps, ...filteredFrameworkVersions, ...filteredLibVersions]
      : [...runtimeVersions, ...frameworkVersions, ...detectedLibraryVersions, ...directDeps];

    // Deduplicate by name (keep first occurrence)
    const seen = new Set<string>();
    directDeps = allMajorDeps.filter(dep => {
      const key = dep.name.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    // Java/Maven: ensure we have groupId:artifactId from pom.xml so Maven Central is queried
    if (isJavaProject && currentState.extractedFiles?.length) {
      const pomDeps = extractDepsFromExtractedFiles(currentState.extractedFiles);
      const mavenCoords = pomDeps.filter(d => d.name.includes(':'));
      for (const d of mavenCoords) {
        const key = d.name.toLowerCase();
        if (!seen.has(key)) {
          seen.add(key);
          directDeps.push(d);
        }
      }
      if (mavenCoords.length > 0) {
      }
    }
    
    
    if (directDeps.length === 0 && currentState.repoProfile) {
      // Fallback: extract from repo profile manifests when dependency graph is empty/missing
      console.warn("[VersionIntelligenceAgent] Dependency graph empty or missing, extracting from manifests");
      directDeps = extractDependenciesFromManifests(currentState.repoProfile.packageManifests || []);
    }
    if (directDeps.length === 0 && currentState.extractedFiles?.length) {
      // Fallback 2: parse manifests directly from extractedFiles (pom.xml, package.json, requirements.txt)
      directDeps = extractDepsFromExtractedFiles(currentState.extractedFiles);
      if (directDeps.length > 0) {
        currentState = logActivity(
          currentState,
          "VersionIntelligence",
          "Using file scan fallback",
          `Extracted ${directDeps.length} packages from project manifests`,
          "warning"
        );
      }
    }
    // Maven: if still empty but pom.xml exists in files, force extraction (path/casing edge cases)
    if (directDeps.length === 0 && hasPomInFiles && currentState.extractedFiles?.length) {
      const fromPom = extractDepsFromExtractedFiles(currentState.extractedFiles).filter(d => d.name.includes(':'));
      if (fromPom.length > 0) {
        directDeps = fromPom;
      }
    }
    if (directDeps.length === 0 && currentState.dependencyGraph?.directDependencies?.length) {
      // Fallback 3: dependency graph might have different structure
      const alt = currentState.dependencyGraph.directDependencies;
      directDeps = alt.map((d: any) => ({
        name: typeof d === 'string' ? d : (d.name || d.package || 'unknown'),
        version: typeof d === 'object' && d?.version ? d.version : 'unknown'
      }));
    }
    if (directDeps.length === 0) {
      currentState = logActivity(
        currentState,
        "VersionIntelligence",
        "No dependencies found",
        "Could not extract dependencies from graph, manifests, or files",
        "warning"
      );
    }
    
    if (directDeps.length === 0) {
      console.warn("[VersionIntelligenceAgent] No direct dependencies found, returning empty version intelligence");
      return {
        ...currentState,
        versionIntelligence: [],
        currentStage: "version_intelligence_complete",
        progress: 40
      };
    }
    
    // FILTER: Keep only major tech stack (runtime, frameworks, major libs) - Remove local classes
    directDeps = filterMajorTechStack(directDeps);
    
    if (directDeps.length === 0) {
      console.warn("[VersionIntelligenceAgent] No major tech stack packages found after filtering");
      return {
        ...currentState,
        versionIntelligence: [],
        currentStage: "version_intelligence_complete",
        progress: 40
      };
    }
    
    // Limit to 50 packages to avoid rate limits and overwhelming UI (prioritize direct deps)
    const MAX_PACKAGES = 50;
    if (directDeps.length > MAX_PACKAGES) {
      directDeps = directDeps.slice(0, MAX_PACKAGES);
    }
    
    
    // Step 2.5: Fetch REAL versions from package registries (npm, PyPI, Maven)
    currentState = logActivity(
      currentState,
      "VersionIntelligence",
      "Fetching versions from registries",
      `Querying npm, PyPI, Maven Central for ${directDeps.length} packages`,
      "info"
    );
    
    
    // Prepare packages with per-package language so .NET uses dotnet registry, not npm.
    // Client-side libraries detected from script tags, vendor dirs, or libman.json
    // should always route to npm even in .NET projects.
    const projectType = currentState.repoProfile?.projectType || 'unknown';
    const packagesToFetch = directDeps.map((dep) => {
      if (clientSidePackageNames.has(dep.name.toLowerCase())) {
        return { name: dep.name, language: 'javascript', version: dep.version };
      }
      const lang = getLanguageForPackage(dep, projectType);
      return { name: dep.name, language: lang, version: dep.version };
    });

    // Log routing decisions for debugging
    for (const pkg of packagesToFetch) {
    }

    // Fetch versions concurrently (with rate limiting)
    registryVersions = await fetchMultiplePackageVersions(packagesToFetch, 5);
    successfulRegistry = registryVersions.filter(v => !v.error);
    
    // Detect current versions from manifest if available
    const manifest = currentState.repoProfile?.packageManifests?.[0]?.parsed;
    registryVersions.forEach(versionInfo => {
      const detectedVersion = detectCurrentVersion(versionInfo.package, manifest);
      if (detectedVersion) {
        versionInfo.currentVersion = detectedVersion;
      }
    });
    
    const successfulFetches = registryVersions.filter(v => !v.error).length;
    
    currentState = logActivity(
      currentState,
      "VersionIntelligence",
      "Registry fetch complete",
      `✅ Retrieved versions for ${successfulFetches}/${directDeps.length} packages from registries`,
      "success"
    );
    
    currentState = logActivity(
      currentState,
      "VersionIntelligence",
      "Dependencies extracted",
      `Processing ${directDeps.length} direct and ${transitiveDeps.length} transitive dependencies`,
      "info"
    );
    
    // Step 3: Build version recommendations using TOOL-CALLING pattern.
    // Registry API data is the SOURCE OF TRUTH for versions.
    // LLM only provides reasoning, risk analysis, and upgrade recommendations
    // based on the real registry data it receives via tool results.


    // Build base recommendations from registry data first (no LLM needed for version facts)
    const registryBasedRecs: Array<{
      package: string;
      currentVersion: string;
      latestStable: string;
      latestLTS: string | null;
      recommended: string;
      reasoning: string;
      riskLevel: "low" | "medium" | "high";
    }> = [];

    for (const dep of directDeps) {
      const regData = registryVersions.find(
        (v) => v.package.toLowerCase() === dep.name.toLowerCase()
      );
      const currentVer = regData?.currentVersion || dep.version || "unknown";
      const latestStable = regData?.latestVersion || "unknown";
      const latestLTS = regData?.latestLTS || null;
      const recommended = latestLTS || latestStable;

      // Determine risk from version distance
      let riskLevel: "low" | "medium" | "high" = "low";
      try {
        const curCoerced = semver.coerce(currentVer);
        const recCoerced = semver.coerce(recommended);
        if (curCoerced && recCoerced) {
          if (semver.major(recCoerced) > semver.major(curCoerced)) riskLevel = "high";
          else if (semver.minor(recCoerced) > semver.minor(curCoerced) + 2) riskLevel = "medium";
        }
      } catch { /* keep default */ }

      if (recommended !== "unknown") {
        registryBasedRecs.push({
          package: dep.name,
          currentVersion: currentVer,
          latestStable,
          latestLTS,
          recommended,
          reasoning: `Registry data: latest stable ${latestStable}${latestLTS ? `, LTS ${latestLTS}` : ""}`,
          riskLevel,
        });
      }
    }

    // Now use LLM with tool-calling to enrich the registry data with reasoning
    let aiAnalysis: { recommendations: typeof registryBasedRecs } = { recommendations: registryBasedRecs };

    try {
      const { client, model, provider } = getLLMClient(currentState.llmProvider);

      currentState = logActivity(
        currentState,
        "VersionIntelligence",
        "LLM analyzing registry data",
        `Enriching ${registryBasedRecs.length} packages with risk reasoning via tool-calling`,
        "info"
      );

      // Define the version lookup tool for the LLM
      const tools = [{
        type: "function" as const,
        function: {
          name: "get_package_versions",
          description: "Get real version data for a package from npm/PyPI/NuGet/Maven registries. Returns latest stable, LTS, and available versions.",
          parameters: {
            type: "object",
            properties: {
              packageName: { type: "string", description: "Package name" },
              registry: { type: "string", enum: ["npm", "pypi", "nuget", "maven", "dotnet"], description: "Package registry" },
            },
            required: ["packageName"],
          },
        },
      }];

      // Prepare the registry data summary for the LLM
      const registrySummary = registryBasedRecs
        .map((r) => `- ${r.package}: current=${r.currentVersion}, latest=${r.latestStable}, lts=${r.latestLTS || "N/A"}, risk=${r.riskLevel}`)
        .join("\n");

      const messages: any[] = [
        {
          role: "system",
          content: `You are a version upgrade risk analyst. You receive REAL version data from package registries (this data is accurate and must NOT be overridden). Your job is to:
1. Analyze the risk of upgrading each package
2. Provide reasoning for the recommendation (breaking changes, deprecations, migration effort)
3. Confirm or adjust the risk level based on your knowledge of the packages

Note: The version numbers provided are from live registry APIs. Do not substitute different version numbers. Only provide reasoning and risk analysis.

Return a JSON object: { "recommendations": [{ "package": "name", "reasoning": "detailed reasoning", "riskLevel": "low"|"medium"|"high" }] }
Return ONLY valid JSON.`,
        },
        {
          role: "user",
          content: `Analyze upgrade risks for these packages (version data from live registries):\n\n${registrySummary}\n\nProject type: ${currentState.repoProfile?.projectType || "unknown"}\nLanguages: ${(currentState.repoProfile?.languages || []).join(", ")}`,
        },
      ];

      const response = await trackedLLMCall(client, {
        model,
        messages,
        tools,
        temperature: 0,
        max_tokens: safeMaxTokens(AGENT_TOKEN_BUDGETS.versionIntelligence, model),
      } as any, { analysisId: currentState.analysisId, phase: "assessment", agent: "VersionIntelligence" });

      // Handle tool calls if the LLM wants to look up additional packages
      let finalResponse = response;
      const toolCallMsg = response.choices[0]?.message;

      if (toolCallMsg?.tool_calls && toolCallMsg.tool_calls.length > 0) {
        messages.push(toolCallMsg);
        for (const tc of toolCallMsg.tool_calls) {
          if (tc.function.name === "get_package_versions") {
            try {
              const args = JSON.parse(tc.function.arguments);
              const vInfo = await fetchMultiplePackageVersions(
                [{ name: args.packageName, language: args.registry || undefined }],
                1
              );
              messages.push({
                role: "tool",
                tool_call_id: tc.id,
                content: JSON.stringify(vInfo[0] || { error: "Not found" }),
              });
            } catch {
              messages.push({ role: "tool", tool_call_id: tc.id, content: '{"error":"fetch failed"}' });
            }
          }
        }
        finalResponse = await trackedLLMCall(client, { model, messages, temperature: 0, max_tokens: safeMaxTokens(AGENT_TOKEN_BUDGETS.versionIntelligence, model) }, { analysisId: currentState.analysisId, phase: "assessment", agent: "VersionIntelligence" });
      }

      const analysisResult = finalResponse.choices[0]?.message?.content?.trim() || "";
      if (analysisResult.length > 10) {
        let clean = analysisResult;
        if (clean.startsWith("```")) clean = clean.replace(/^```(?:json)?\n?/i, "").replace(/\n?```$/i, "").trim();
        try {
          const parsed = JSON.parse(clean);
          if (Array.isArray(parsed.recommendations)) {
            // Merge LLM reasoning with registry data (registry versions are truth)
            for (const aiRec of parsed.recommendations) {
              const baseRec = registryBasedRecs.find(
                (r) => r.package.toLowerCase() === (aiRec.package || "").toLowerCase()
              );
              if (baseRec) {
                if (aiRec.reasoning) baseRec.reasoning = aiRec.reasoning;
                if (aiRec.riskLevel) baseRec.riskLevel = aiRec.riskLevel;
              }
            }
          }
        } catch { /* keep registry-only data */ }
      }

      currentState = logActivity(
        currentState,
        "VersionIntelligence",
        "Tool-call analysis complete",
        `Enriched ${registryBasedRecs.length} packages with LLM reasoning`,
        "success"
      );
    } catch (llmError) {
      console.warn("[VersionIntelligenceAgent] LLM enrichment failed, using registry data only:", llmError instanceof Error ? llmError.message : llmError);
      currentState = logActivity(
        currentState,
        "VersionIntelligence",
        "Using registry-only data",
        "LLM enrichment failed; version data from registries is still accurate",
        "warning"
      );
    }

    aiAnalysis = { recommendations: registryBasedRecs };
    
    // Step 6: Transform to VersionRecommendation format with registry data
    // SPECIAL HANDLING for .NET: Use dotnet-version-registry for accurate recommendations
    // CRITICAL: Never recommend a downgrade (e.g. ASP.NET Core 9.0 -> 8.0 or Aspire 13 -> 8)
    const versionRecommendations: VersionRecommendation[] = (aiAnalysis?.recommendations || []).map(rec => {
      const registryData = registryVersions.find(v => v.package === rec.package);
      
      // Determine category
      const category = categorizePackage(rec.package, currentState.repoProfile);
      
      // Special handling for .NET runtime only (not ASP.NET Core / Aspire packages)
      if (rec.package === '.NET' || rec.package === '.NET Framework' || rec.package.toLowerCase() === 'dotnet') {
        const currentVersion = rec.currentVersion || 'unknown';
        const isValid = isValidDotNetVersion(currentVersion);
        
        if (isValid) {
          const details = getDotNetVersionDetails(currentVersion);
          const recommended = getDotNetRecommendedUpgrade(currentVersion);
          const availableVersions = getAvailableDotNetVersions();
          // .NET registry already only recommends newer; use it
          const targetVersion = recommended?.version || currentVersion;
          return {
            package: '.NET',
            currentVersion: currentVersion,
            latestStable: recommended?.version || currentVersion,
            latestLTS: recommended?.version || currentVersion,
            recommended: targetVersion,
            reasoning: recommended
              ? `Upgrade from ${currentVersion} to ${recommended.version} (${recommended.channel}). ${details?.status === 'eol' ? '⚠️ Current version is End-of-Life.' : ''}`
              : `Current version ${currentVersion} is already latest or newer than LTS. No downgrade; keep current.`,
            riskLevel: details?.status === 'eol' ? 'high' : (parseFloat(currentVersion) < 6 ? 'high' : 'medium'),
            allVersions: availableVersions.map(v => v.version),
            registry: 'dotnet-official',
            category: 'runtime'
          };
        }
      }
      
      const currentVersion = registryData?.currentVersion || rec.currentVersion || 'unknown';
      let recommended = rec.recommended;
      let reasoning = rec.reasoning;
      // Never recommend a downgrade for any package (ASP.NET Core, Aspire, etc.)
      if (isVersionDowngrade(currentVersion, recommended)) {
        recommended = currentVersion;
        reasoning = `Current version ${currentVersion} is already at or above the suggested target. No downgrade recommended; keep current version.`;
      }

      // Guard: if registry has real version data and the AI recommended a version that
      // doesn't exist in the registry (e.g., 10.0.0 for a package whose latest is 2.3.9),
      // fall back to the registry's latest version. This prevents NU1102 errors for
      // discontinued NuGet packages that the LLM incorrectly assumes have high versions.
      if (registryData?.latestVersion && registryData.allVersions.length > 0 && recommended) {
        const recMajor = parseInt(recommended.split(".")[0], 10) || 0;
        const latestMajor = parseInt(registryData.latestVersion.split(".")[0], 10) || 0;
        if (recMajor > latestMajor + 1) {
          reasoning = `${reasoning || ''} [Auto-corrected: AI suggested ${recommended} but the package's actual latest on ${registryData.registry} is ${registryData.latestVersion}. The recommended version does not exist in the registry.]`;
          recommended = registryData.latestVersion;
        }
      }
      
      return {
        package: rec.package,
        currentVersion,
        latestStable: registryData?.latestVersion || rec.latestStable || 'unknown',
        latestLTS: registryData?.latestLTS || rec.latestLTS || undefined,
        recommended,
        reasoning,
        riskLevel: rec.riskLevel,
        allVersions: registryData?.allVersions || [],
        registry: registryData?.registry || 'unknown',
        category,
      };
    });

    // Ensure .NET (and any) registry-only entries are included when AI omitted them
    const includedPackages = new Set(versionRecommendations.map((r) => r.package.toLowerCase()));
    for (const v of registryVersions) {
      if (v.error) continue;
      const key = v.package.toLowerCase();
      if (includedPackages.has(key)) continue;
      if (v.registry === "dotnet-official" || key === ".net" || key === ".net framework" || key === "dotnet") {
        let rec = v.latestLTS || v.latestVersion || "unknown";
        if (v.currentVersion && isVersionDowngrade(v.currentVersion, rec)) rec = v.currentVersion;
        versionRecommendations.push({
          package: v.package,
          currentVersion: v.currentVersion || "unknown",
          latestStable: v.latestVersion || "unknown",
          latestLTS: v.latestLTS || undefined,
          recommended: rec,
          reasoning: rec === (v.currentVersion || "unknown") ? "Keep current version; no downgrade." : "Version data from .NET official registry",
          riskLevel: "medium",
          allVersions: v.allVersions || [],
          registry: v.registry || "dotnet-official",
          category: "runtime",
        });
        includedPackages.add(key);
      }
    }

    
    const riskSummary = versionRecommendations.reduce((acc, rec) => {
      acc[rec.riskLevel] = (acc[rec.riskLevel] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    
    
    currentState = logActivity(
      currentState,
      "VersionIntelligence",
      "Version intelligence complete",
      `✅ Analyzed ${versionRecommendations.length} packages - Low: ${riskSummary.low || 0}, Medium: ${riskSummary.medium || 0}, High: ${riskSummary.high || 0}`,
      "success"
    );
    
    // Step 7: Update state
    return {
      ...currentState,
      versionIntelligence: versionRecommendations,
      currentStage: "version_intelligence_complete",
      progress: 40 // Third agent = 40% progress
    };
    
  } catch (error) {
    console.error("[VersionIntelligenceAgent] Error during analysis:", error);
    
    const { logActivity } = await import("../state");
    let errorState = logActivity(
      currentState,
      "VersionIntelligence",
      "AI unavailable - using registry data",
      error instanceof Error ? error.message : String(error),
      "warning"
    );
    
    // CRITICAL: Use registry data when AI fails - user MUST see available versions
    if (successfulRegistry.length > 0) {
      const registryRecommendations = successfulRegistry.map(v => {
        let rec = v.latestVersion || v.latestLTS || 'unknown';
        const cur = v.currentVersion || 'unknown';
        if (cur !== 'unknown' && isVersionDowngrade(cur, rec)) rec = cur;
        return {
          package: v.package,
          currentVersion: cur,
          latestStable: v.latestVersion || 'unknown',
          latestLTS: v.latestLTS || undefined,
          recommended: rec,
          reasoning: rec === cur ? "Keep current version; no downgrade." : "Version data from npm/PyPI/Maven registry",
          riskLevel: "medium" as const,
          allVersions: v.allVersions || [],
          registry: v.registry || 'unknown',
          category: categorizePackage(v.package, currentState.repoProfile)
        };
      }) as VersionRecommendation[];
      
      return {
        ...errorState,
        versionIntelligence: registryRecommendations,
        currentStage: "version_intelligence_complete",
        progress: 40,
        errors: [...errorState.errors, `AI unavailable: ${error instanceof Error ? error.message : String(error)}. Using registry data.`]
      };
    }
    
    return {
      ...errorState,
      versionIntelligence: [],
      errors: [...errorState.errors, `VersionIntelligenceAgent failed: ${error instanceof Error ? error.message : String(error)}`]
    };
  }
}

// ===== Helper Functions =====

/**
 * Extract dependencies from extractedFiles (scan for package.json content)
 */
function extractDepsFromExtractedFiles(extractedFiles: any[]): Array<{ name: string; version: string }> {
  const deps: Array<{ name: string; version: string }> = [];
  for (const f of extractedFiles) {
    const filePath = (f.relativePath || f.fullPath || '').toLowerCase();
    const content = f.content || '';
    if (filePath.endsWith('package.json') && content) {
      try {
        const parsed = JSON.parse(content);
        const all = { ...(parsed.dependencies || {}), ...(parsed.devDependencies || {}) };
        for (const [name, version] of Object.entries(all)) {
          if (name && typeof version === 'string') deps.push({ name, version });
        }
      } catch (_) {}
    }
    if (filePath.endsWith('requirements.txt') && content) {
      content.split('\n').forEach((line: string) => {
        const m = line.trim().match(/^([a-zA-Z0-9_-]+)/);
        if (m) deps.push({ name: m[1], version: '*' });
      });
    }
    if (filePath.endsWith('pom.xml') && content) {
      // Extract properties for ${...} variable resolution
      const pomProperties: Record<string, string> = {};
      const propsBlock = content.match(/<properties>([\s\S]*?)<\/properties>/);
      if (propsBlock) {
        const propRegex = /<([\w.-]+)>\s*(.*?)\s*<\/\1>/g;
        let propMatch;
        while ((propMatch = propRegex.exec(propsBlock[1])) !== null) {
          pomProperties[propMatch[1]] = propMatch[2];
        }
      }

      const resolvePomVersion = (v: string | undefined): string => {
        if (!v) return 'unknown';
        if (v.startsWith('${') && v.endsWith('}')) {
          const propName = v.slice(2, -1);
          return pomProperties[propName] || 'unknown';
        }
        return v;
      };

      // Parent POM (e.g. spring-boot-starter-parent)
      const parentBlock = content.match(/<parent>([\s\S]*?)<\/parent>/);
      let parentVersion: string | undefined;
      if (parentBlock) {
        const pGroupId = parentBlock[1].match(/<groupId>\s*(.*?)\s*<\/groupId>/)?.[1];
        const pArtifactId = parentBlock[1].match(/<artifactId>\s*(.*?)\s*<\/artifactId>/)?.[1];
        const pVersion = parentBlock[1].match(/<version>\s*(.*?)\s*<\/version>/)?.[1];
        parentVersion = pVersion;
        if (pGroupId && pArtifactId) {
          deps.push({ name: `${pGroupId}:${pArtifactId}`, version: resolvePomVersion(pVersion) });
        }
      }

      // Extract managed versions from <dependencyManagement>
      const managedVersions: Record<string, string> = {};
      const depMgmtBlock = content.match(/<dependencyManagement>([\s\S]*?)<\/dependencyManagement>/);
      if (depMgmtBlock) {
        const mgmtDepRegex = /<dependency>([\s\S]*?)<\/dependency>/g;
        let mgmtMatch;
        while ((mgmtMatch = mgmtDepRegex.exec(depMgmtBlock[1])) !== null) {
          const block = mgmtMatch[1];
          const gId = block.match(/<groupId>\s*(.*?)\s*<\/groupId>/)?.[1];
          const aId = block.match(/<artifactId>\s*(.*?)\s*<\/artifactId>/)?.[1];
          const ver = block.match(/<version>\s*(.*?)\s*<\/version>/)?.[1];
          if (gId && aId && ver) {
            managedVersions[`${gId}:${aId}`] = resolvePomVersion(ver);
          }
        }
      }

      // Dependencies (direct)
      // Skip the dependencyManagement section for direct deps
      const contentWithoutMgmt = content.replace(/<dependencyManagement>[\s\S]*?<\/dependencyManagement>/, '');
      const depBlockRegex = /<dependency>([\s\S]*?)<\/dependency>/g;
      let blockMatch;
      while ((blockMatch = depBlockRegex.exec(contentWithoutMgmt)) !== null) {
        const block = blockMatch[1];
        const groupId = block.match(/<groupId>\s*(.*?)\s*<\/groupId>/)?.[1];
        const artifactId = block.match(/<artifactId>\s*(.*?)\s*<\/artifactId>/)?.[1];
        const version = block.match(/<version>\s*(.*?)\s*<\/version>/)?.[1];
        if (groupId && artifactId) {
          const coord = `${groupId}:${artifactId}`;
          let resolvedVersion = resolvePomVersion(version);
          // Fall back to dependencyManagement version, then parent version
          if (resolvedVersion === 'unknown') {
            resolvedVersion = managedVersions[coord] || resolvePomVersion(parentVersion) || 'unknown';
          }
          deps.push({ name: coord, version: resolvedVersion });
        }
      }
      // Build plugins (groupId, artifactId, version)
      const pluginBlockRegex = /<plugin>([\s\S]*?)<\/plugin>/g;
      let pluginMatch;
      while ((pluginMatch = pluginBlockRegex.exec(content)) !== null) {
        const block = pluginMatch[1];
        const groupId = block.match(/<groupId>\s*(.*?)\s*<\/groupId>/)?.[1] || 'org.apache.maven.plugins';
        const artifactId = block.match(/<artifactId>\s*(.*?)\s*<\/artifactId>/)?.[1];
        const version = block.match(/<version>\s*(.*?)\s*<\/version>/)?.[1];
        if (artifactId) {
          deps.push({ name: `${groupId}:${artifactId}`, version: resolvePomVersion(version) });
        }
      }
    }
  }
  return deps;
}

/**
 * Extract dependencies from manifests (fallback when dependency graph is unavailable)
 */
function extractDependenciesFromManifests(manifests: any[]): Array<{ name: string; version: string }> {
  const deps: Array<{ name: string; version: string }> = [];
  if (!Array.isArray(manifests) || manifests.length === 0) return deps;
  for (const m of manifests) {
    const parsed = (m as any).parsed;
    if (!parsed) continue;
    if (m.type === "package.json") {
      if (parsed.dependencies) {
        Object.entries(parsed.dependencies).forEach(([name, version]) =>
          deps.push({ name, version: (version as string) || "unknown" })
        );
      }
      if (parsed.devDependencies) {
        Object.entries(parsed.devDependencies).forEach(([name, version]) =>
          deps.push({ name, version: (version as string) || "unknown" })
        );
      }
    } else if (m.type === "requirements.txt" && Array.isArray(parsed.dependencies)) {
      parsed.dependencies.forEach((d: any) => d?.package && deps.push({ name: d.package, version: d.version || "*" }));
    } else if (m.type === "pom.xml") {
      if (parsed.parent?.groupId && parsed.parent?.artifactId) {
        deps.push({
          name: `${parsed.parent.groupId}:${parsed.parent.artifactId}`,
          version: parsed.parent.version || "unknown"
        });
      }
      if (Array.isArray(parsed.dependencies)) {
        parsed.dependencies.forEach((d: any) =>
          d?.groupId && d?.artifactId && deps.push({ name: `${d.groupId}:${d.artifactId}`, version: d.version || "unknown" })
        );
      }
    } else if ((m as any).type === "csproj" && Array.isArray(parsed.dependencies)) {
      parsed.dependencies.forEach((d: any) => {
        if (d?.name) deps.push({ name: d.name, version: (d.version as string) || "unknown" });
      });
    }
  }
  return deps;
}

/**
 * Extract direct dependencies in simplified format
 */
function extractDirectDependencies(nodes: DependencyNode[]): Array<{ name: string; version: string }> {
  return nodes.map(node => ({
    name: node.name,
    version: node.version
  }));
}

/**
 * Extract transitive dependencies in simplified format
 */
function extractTransitiveDependencies(nodes: DependencyNode[]): Array<{ name: string; version: string }> {
  return nodes.map(node => ({
    name: node.name,
    version: node.version
  }));
}

/**
 * Determine language from project type (used for registry selection)
 */
function determineLanguage(projectType: string): string {
  if (projectType.includes('dotnet')) {
    return 'dotnet';
  }
  if (projectType.includes('node') || projectType.includes('react') || projectType.includes('vue') || projectType.includes('angular')) {
    return 'javascript';
  }
  if (projectType.includes('python')) {
    return 'python';
  }
  if (projectType.includes('java')) {
    return 'java';
  }
  return 'javascript'; // Default
}

/**
 * Per-package language/registry hint so .NET packages use dotnet registry and
 * Maven-format packages always route to Maven Central.
 */
function getLanguageForPackage(
  dep: { name: string; version: string },
  projectType: string
): string {
  const n = dep.name.toLowerCase().trim();
  if (n === '.net' || n === '.net framework' || n === 'dotnet') {
    return 'dotnet';
  }
  // Maven coordinate format (groupId:artifactId) always means Java
  if (n.includes(':') && !n.startsWith('@')) {
    return 'java';
  }
  return determineLanguage(projectType);
}

/**
 * Categorize package as runtime, framework, or library
 */
function categorizePackage(packageName: string, repoProfile?: RepoProfileResult): "runtime" | "framework" | "library" {
  const runtimePackages = ['node', 'nodejs', 'python', 'java', 'jdk', 'openjdk', 'dotnet', 'go', 'rust', 'ruby', 'php'];
  const frameworkPackages = ['react', 'vue', 'angular', 'svelte', 'next', 'nuxt', 'gatsby', 'express', 'fastify', 'koa', 'hapi', 'nestjs', 'django', 'flask', 'fastapi', 'spring', 'spring-boot', 'rails', 'laravel'];
  
  const lowerName = packageName.toLowerCase();
  
  // Check runtime
  if (runtimePackages.some(r => lowerName.includes(r))) {
    return "runtime";
  }
  
  // Check framework
  if (frameworkPackages.some(f => lowerName.includes(f))) {
    return "framework";
  }
  
  // Check against detected frameworks in repo profile
  if (repoProfile?.frameworks) {
    const isDetectedFramework = repoProfile.frameworks.some(f => 
      f.name.toLowerCase() === lowerName || lowerName.includes(f.name.toLowerCase())
    );
    if (isDetectedFramework) {
      return "framework";
    }
  }
  
  // Default to library
  return "library";
}
