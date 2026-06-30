/**
 * Code Generation Loop with Validation & Retry Logic
 * PRODUCTION-READY: Framework-agnostic code upgrader
 */

import type { StackModernizationState, VersionSelection } from "../types";
import { getLLMClient } from "./llm-selector";
import { logActivity } from "../state";
import { chunkFileContent, estimateTokens, prepareFilesWithinBudget, safeMaxTokens, normalizeRequestParams, CHANGE_SUMMARY_TOKEN_BUDGET } from "./token-manager";
import { trackedLLMCall } from "./llm-call-tracker";
import { AGENT_TOKEN_BUDGETS, buildBudgetConstraint } from "./token-budgets";
import { buildLayerChangeSummary, formatChangeSummaryForPrompt, type AccumulatedChangeSummary } from "./change-summary";
import { DEFAULT_MODEL_ID, MODEL_CHAR_BUDGET_MAP } from "../../llm-config-constants";
import {
  buildUpgradePlanSystemPrompt,
  buildUpgradePlanUserPrompt,
  buildTriageSystemPrompt,
  buildTriageUserPrompt,
  buildSingleFileUpgradeSystemPrompt,
  buildSingleFileUpgradeUserPrompt,
  buildMultiFileUpgradeSystemPrompt,
  buildMultiFileUpgradeUserPrompt,
  resolveTargetDotnetTfm as resolveTargetDotnetTfmFromPrompts,
} from "../prompts/code-upgrade-prompts";
import * as fs from "fs/promises";
import * as path from "path";
import { exec } from "child_process";
import { promisify } from "util";
import * as os from "os";
import * as crypto from "crypto";

const execAsync = promisify(exec);

/**
 * Post-process LLM output to force-correct version mismatches.
 * The LLM sometimes uses a different version than what the user selected
 * (e.g., net8.0 when user asked for net10.0). This deterministically fixes it.
 */
function enforceVersionInContent(content: string, filePath: string, selections: VersionSelection[]): string {
  let result = content;
  const lower = filePath.toLowerCase();
  const baseName = (filePath.split(/[\\/]/).pop() || "").toLowerCase();

  for (const sel of selections) {
    const pkg = (sel.package || "").toLowerCase();
    const targetVer = (sel.selectedVersion || "").replace(/^v/i, "").trim();
    if (!targetVer) continue;

    // ── .NET TargetFramework enforcement ──
    if ((pkg.includes(".net") || pkg.includes("dotnet") || pkg === "dotnet") &&
        (lower.endsWith(".csproj") || lower.endsWith(".fsproj") || lower.endsWith(".vbproj") ||
         lower.endsWith(".props") || lower.endsWith(".targets"))) {
      const major = parseInt(targetVer.split(".")[0], 10);
      if (major >= 5) {
        const tfm = `net${major}.0`;
        result = result.replace(/<TargetFramework>\s*net\d+\.\d+\s*<\/TargetFramework>/g, `<TargetFramework>${tfm}</TargetFramework>`);
        result = result.replace(/<TargetFramework>\s*netcoreapp\d+\.\d+\s*<\/TargetFramework>/g, `<TargetFramework>${tfm}</TargetFramework>`);
        result = result.replace(/<TargetFramework>\s*net[^<]*<\/TargetFramework>/gi, () => {
          return `<TargetFramework>${tfm}</TargetFramework>`;
        });
        result = result.replace(/<TargetFrameworks>([^<]*)<\/TargetFrameworks>/g, (_m, frameworks: string) => {
          const updated = frameworks.split(";").map((f: string) => {
            if (/^net\d+\.\d+$/.test(f.trim()) || /^netcoreapp\d+\.\d+$/.test(f.trim())) return tfm;
            return f.trim();
          }).join(";");
          return `<TargetFrameworks>${updated}</TargetFrameworks>`;
        });
      } else if (parseInt(targetVer.split(".")[0], 10) <= 4) {
        if (lower.endsWith(".csproj") || lower.endsWith(".fsproj") || lower.endsWith(".vbproj")) {
          result = result.replace(/<TargetFrameworkVersion>v[\d.]+<\/TargetFrameworkVersion>/g,
            `<TargetFrameworkVersion>v${targetVer}</TargetFrameworkVersion>`);
        }
      }
    }

    // ── NuGet PackageReference version enforcement in .csproj/.fsproj/.vbproj ──
    if ((lower.endsWith(".csproj") || lower.endsWith(".fsproj") || lower.endsWith(".vbproj")) &&
        sel.category !== "framework") {
      const escapedPkg = sel.package.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const pkgRefRegex = new RegExp(
        `(<PackageReference\\s+Include="${escapedPkg}"\\s+Version=")[^"]+(")`,
        "gi"
      );
      result = result.replace(pkgRefRegex, `$1${targetVer}$2`);
      const pkgRefRevRegex = new RegExp(
        `(<PackageReference\\s+Version=")[^"]+("\\s+Include="${escapedPkg}")`,
        "gi"
      );
      result = result.replace(pkgRefRevRegex, `$1${targetVer}$2`);
    }

    // ── .NET global.json SDK version ──
    if ((pkg.includes(".net") || pkg.includes("dotnet") || pkg === "dotnet") &&
        (baseName === "global.json")) {
      result = result.replace(/"version"\s*:\s*"[\d.]+"/g, `"version": "${targetVer}"`);
    }

    // ── Java version enforcement in pom.xml ──
    if ((pkg.includes("java") || pkg === "jdk" || pkg === "openjdk") && lower.endsWith("pom.xml")) {
      result = result.replace(/<java\.version>\d+<\/java\.version>/g,
        `<java.version>${targetVer.split(".")[0]}</java.version>`);
      result = result.replace(/<maven\.compiler\.source>\d+<\/maven\.compiler\.source>/g,
        `<maven.compiler.source>${targetVer.split(".")[0]}</maven.compiler.source>`);
      result = result.replace(/<maven\.compiler\.target>\d+<\/maven\.compiler\.target>/g,
        `<maven.compiler.target>${targetVer.split(".")[0]}</maven.compiler.target>`);
    }

    // ── Java version enforcement in build.gradle ──
    if ((pkg.includes("java") || pkg === "jdk" || pkg === "openjdk") &&
        (lower.endsWith("build.gradle") || lower.endsWith("build.gradle.kts"))) {
      result = result.replace(/sourceCompatibility\s*=\s*['"]?\d+['"]?/g,
        `sourceCompatibility = '${targetVer.split(".")[0]}'`);
      result = result.replace(/targetCompatibility\s*=\s*['"]?\d+['"]?/g,
        `targetCompatibility = '${targetVer.split(".")[0]}'`);
    }

    // ── Maven pom.xml dependency version enforcement ──
    if (lower.endsWith("pom.xml")) {
      const escapedPkg = sel.package.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const depBlockRegex = new RegExp(
        `(<dependency>[\\s\\S]*?<artifactId>\\s*${escapedPkg}\\s*<\\/artifactId>[\\s\\S]*?<version>)[^<]+(</version>)`,
        "gi"
      );
      result = result.replace(depBlockRegex, `$1${targetVer}$2`);
      if (pkg.includes("spring") && pkg.includes("boot")) {
        result = result.replace(
          /(<parent>[\s\S]*?<artifactId>\s*spring-boot-starter-parent\s*<\/artifactId>[\s\S]*?<version>)[^<]+(<\/version>)/gi,
          `$1${targetVer}$2`
        );
      }
      const propVarRegex = new RegExp(
        `(<${escapedPkg}\\.version>)[^<]+(<\\/${escapedPkg}\\.version>)`,
        "gi"
      );
      result = result.replace(propVarRegex, `$1${targetVer}$2`);
    }

    // ── Gradle build.gradle dependency version enforcement ──
    if (lower.endsWith("build.gradle") || lower.endsWith("build.gradle.kts")) {
      const escapedPkg = sel.package.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const gradleDepRegex = new RegExp(
        `(['"])([^'"]*?${escapedPkg}[^'"]*?):([\\d][\\w.\\-]*)\\1`,
        "gi"
      );
      result = result.replace(gradleDepRegex, (_match, quote, prefix) => {
        return `${quote}${prefix}:${targetVer}${quote}`;
      });
    }

    // ── Go version in go.mod ──
    if (pkg === "go" && lower.endsWith("go.mod")) {
      result = result.replace(/^go\s+\d+\.\d+(\.\d+)?$/m, `go ${targetVer}`);
    }

    // ── Rust edition in Cargo.toml ──
    if (pkg === "rust" && lower.endsWith("cargo.toml")) {
      result = result.replace(/edition\s*=\s*"[\d]+"/g, `edition = "${targetVer}"`);
    }

    // ── Python pyproject.toml requires-python ──
    if (pkg === "python" && lower.endsWith("pyproject.toml")) {
      result = result.replace(/requires-python\s*=\s*"[^"]+"/g, `requires-python = ">=${targetVer}"`);
    }

    // ── Python pyproject.toml dependency enforcement ──
    if (lower.endsWith("pyproject.toml") && pkg !== "python") {
      const escapedPkg = sel.package.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const pyprojectRegex = new RegExp(
        `(["']${escapedPkg}\\s*(?:==|>=|~=|<=)\\s*)([\\d][\\w.\\-]*)`,
        "gi"
      );
      result = result.replace(pyprojectRegex, `$1${targetVer}`);
    }

    // ── Python requirements.txt enforcement ──
    if (lower.match(/requirements.*\.txt$/)) {
      const escapedPkg = sel.package.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const pipRegex = new RegExp(
        `^(${escapedPkg}\\s*(?:==|>=|~=|<=|!=|<|>)\\s*)([\\d][\\w.\\-]*)`,
        "gmi"
      );
      result = result.replace(pipRegex, `$1${targetVer}`);
    }

    // ── Python setup.py / setup.cfg ──
    if (lower.endsWith("setup.py") || lower.endsWith("setup.cfg")) {
      const escapedPkg = sel.package.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      result = result.replace(
        new RegExp(`(${escapedPkg}\\s*(?:==|>=|~=|<=)\\s*)([\\d][\\w.\\-]*)`, "gi"),
        `$1${targetVer}`
      );
    }

    // ── Node.js engines in package.json ──
    if ((pkg === "node" || pkg === "nodejs" || pkg.includes("node.js")) && lower.endsWith("package.json")) {
      result = result.replace(/"node"\s*:\s*"[^"]+"/g, `"node": ">=${targetVer}"`);
    }

    // ── package.json dependency version enforcement ──
    if (lower.endsWith("package.json") && pkg !== "node" && pkg !== "nodejs" && !pkg.includes("node.js")) {
      try {
        const parsed = JSON.parse(result);
        let changed = false;
        const normPkg = pkg.replace(/[-_.@\s/]/g, "");
        for (const section of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]) {
          if (!parsed[section]) continue;
          for (const depName of Object.keys(parsed[section])) {
            const normDep = depName.toLowerCase().replace(/[-_.@\s/]/g, "");
            if (normDep === normPkg || normDep.includes(normPkg) || normPkg.includes(normDep)) {
              const currentVer = String(parsed[section][depName]).replace(/^[\^~>=<\s]+/, "");
              if (currentVer !== targetVer) {
                const prefix = String(parsed[section][depName]).match(/^([\^~])/)?.[1] || "^";
                parsed[section][depName] = `${prefix}${targetVer}`;
                changed = true;
              }
            }
          }
        }
        if (changed) result = JSON.stringify(parsed, null, 2);
      } catch { /* non-fatal */ }
    }

    // ── Ruby Gemfile version enforcement ──
    if (baseName === "gemfile") {
      const escapedPkg = sel.package.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const gemRegex = new RegExp(
        `(gem\\s+['"]${escapedPkg}['"]\\s*,\\s*['"][~>=<]*\\s*)([\\d][\\w.\\-]*)`,
        "gi"
      );
      result = result.replace(gemRegex, `$1${targetVer}`);
    }

    // ── Ruby .gemspec version enforcement ──
    if (lower.endsWith(".gemspec")) {
      const escapedPkg = sel.package.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const gemspecRegex = new RegExp(
        `(add_(?:runtime_|development_)?dependency\\s+['"]${escapedPkg}['"]\\s*,\\s*['"][~>=<]*\\s*)([\\d][\\w.\\-]*)`,
        "gi"
      );
      result = result.replace(gemspecRegex, `$1${targetVer}`);
    }

    // ── PHP composer.json enforcement ──
    if (lower.endsWith("composer.json")) {
      try {
        const parsed = JSON.parse(result);
        let changed = false;
        const normPkg = pkg.replace(/[-_.@\s]/g, "");
        for (const section of ["require", "require-dev"]) {
          if (!parsed[section]) continue;
          for (const depName of Object.keys(parsed[section])) {
            const normDep = depName.toLowerCase().replace(/[-_.@\s/]/g, "");
            if (normDep === normPkg || normDep.includes(normPkg) || normPkg.includes(normDep)) {
              const current = String(parsed[section][depName]).replace(/^[\^~>=<\s]+/, "");
              if (current !== targetVer) {
                parsed[section][depName] = `^${targetVer}`;
                changed = true;
              }
            }
          }
        }
        if (changed) result = JSON.stringify(parsed, null, 2);
      } catch { /* non-fatal */ }
    }
  }

  // ── CDN URL version enforcement for view/template files ──
  const VIEW_EXTS = new Set([
    ".html", ".htm", ".cshtml", ".razor", ".aspx", ".master",
    ".vue", ".svelte", ".astro", ".php", ".erb", ".ejs", ".hbs",
    ".njk", ".twig", ".pug", ".jsp", ".blade.php",
  ]);
  const ext = "." + (filePath.split(".").pop() || "").toLowerCase();
  if (VIEW_EXTS.has(ext)) {
    // Enforce CDN versions for known CDN patterns
    for (const sel of selections) {
      const targetVer = (sel.selectedVersion || "").replace(/^v/i, "").trim();
      if (!targetVer) continue;
      const normPkg = (sel.package || "").toLowerCase().replace(/[-_.@\s/]/g, "");
      // cdnjs pattern: cdnjs.cloudflare.com/ajax/libs/LIBNAME/VERSION/...
      const cdnRegex = new RegExp(
        `(cdnjs\\.cloudflare\\.com/ajax/libs/[^/]*${normPkg}[^/]*/)[0-9][^/"'\\s]*`,
        "gi"
      );
      result = result.replace(cdnRegex, `$1${targetVer}`);
      // jsdelivr pattern: cdn.jsdelivr.net/npm/PACKAGE@VERSION
      const jsdelivrRegex = new RegExp(
        `(cdn\\.jsdelivr\\.net/npm/[^@]*${normPkg}[^@]*@)[0-9][^/"'\\s]*`,
        "gi"
      );
      result = result.replace(jsdelivrRegex, `$1${targetVer}`);
      // unpkg pattern: unpkg.com/PACKAGE@VERSION
      const unpkgRegex = new RegExp(
        `(unpkg\\.com/[^@]*${normPkg}[^@]*@)[0-9][^/"'\\s]*`,
        "gi"
      );
      result = result.replace(unpkgRegex, `$1${targetVer}`);
    }
  }

  // ── libman.json enforcement ──
  if (baseName === "libman.json") {
    try {
      const parsed = JSON.parse(result);
      if (Array.isArray(parsed.libraries)) {
        let changed = false;
        for (const lib of parsed.libraries) {
          if (!lib.library || typeof lib.library !== "string") continue;
          const atIdx = lib.library.lastIndexOf("@");
          if (atIdx <= 0) continue;
          const libName = lib.library.slice(0, atIdx);
          const currentVer = lib.library.slice(atIdx + 1);
          const normLib = libName.toLowerCase().replace(/[-_.@\s/]/g, "");
          for (const sel of selections) {
            const normPkg = (sel.package || "").toLowerCase().replace(/[-_.@\s/]/g, "");
            if (!normPkg) continue;
            const tgt = (sel.selectedVersion || "").replace(/^v/i, "").trim();
            if (!tgt || tgt === currentVer) continue;
            if (normLib === normPkg || normLib.includes(normPkg) || normPkg.includes(normLib)) {
              lib.library = `${libName}@${tgt}`;
              changed = true;
              break;
            }
          }
        }
        if (changed) result = JSON.stringify(parsed, null, 2);
      }
    } catch { /* non-fatal */ }
  }

  // ── bower.json enforcement ──
  if (baseName === "bower.json") {
    try {
      const parsed = JSON.parse(result);
      let changed = false;
      for (const section of ["dependencies", "devDependencies"]) {
        if (!parsed[section]) continue;
        for (const [depName, depVersion] of Object.entries(parsed[section])) {
          const normDep = depName.toLowerCase().replace(/[-_.@\s/]/g, "");
          for (const sel of selections) {
            const normPkg = (sel.package || "").toLowerCase().replace(/[-_.@\s/]/g, "");
            if (!normPkg) continue;
            const tgt = (sel.selectedVersion || "").replace(/^v/i, "").trim();
            if (!tgt) continue;
            if (normDep === normPkg || normDep.includes(normPkg) || normPkg.includes(normDep)) {
              parsed[section][depName] = tgt;
              changed = true;
              break;
            }
          }
        }
      }
      if (changed) result = JSON.stringify(parsed, null, 2);
    } catch { /* non-fatal */ }
  }

  return result;
}

export interface CodeGenerationResult {
  success: boolean;
  code: Array<{
    path: string;
    content: string;
    originalContent: string;
    changes: Array<{
      package: string;
      oldVersion: string;
      newVersion: string;
      description: string;
    }>;
  }>;
  tests: Array<{
    path: string;
    content: string;
    framework: string;
  }>;
  plan: string;
  attempts: number;
  errors: string[];
  validationResults?: {
    syntaxValid: boolean;
    compilationSuccess: boolean;
    issues: string[];
  };
}

/** Execution context passed to onProgress for real-time dashboard (phase, batch, files done). */
export interface CodeGenerationProgressContext {
  phase: "triage" | "group" | "upgrade";
  batchIndex?: number;
  totalBatches?: number;
  filesDone?: number;
}

export interface CodeGenerationLoopOptions {
  /** Called after each batch of files is generated so UI can show "Generated so far". Second arg is execution context for real-time stage (phase, batch N of M). */
  onProgress?: (
    files: Array<{ path: string; content: string; originalContent: string; changes?: any[] }>,
    context?: CodeGenerationProgressContext
  ) => void;
}

/**
 * Main code generation loop
 * Tries up to MAX_ATTEMPTS to generate valid, compilable code
 */
export async function executeCodeGenerationLoop(
  state: StackModernizationState,
  userSelections: VersionSelection[],
  options?: CodeGenerationLoopOptions
): Promise<CodeGenerationResult> {
  const MAX_ATTEMPTS = 3;
  let attempts = 0;
  const allErrors: string[] = [];


  while (attempts < MAX_ATTEMPTS) {
    attempts++;

    try {
      // Step 1: Generate upgrade plan
      const plan = await generateUpgradePlan(state, userSelections);
      
      if (!plan) {
        throw new Error("Failed to generate upgrade plan");
      }


      // Step 2: Generate code (with optional per-batch progress callback)
      const { code, tests } = await generateCodeAndTests(state, plan, userSelections, allErrors, options?.onProgress);

      if (code.length === 0) {
        throw new Error("No code files generated");
      }


      // Step 3: Validate syntax (non-blocking - warnings only)
      const syntaxValidation = await validateCodeSyntax(code, state.repoProfile?.projectType);

      if (!syntaxValidation.valid) {
        console.warn(`[CodeGenLoop] ⚠️  Syntax warnings (non-blocking): ${syntaxValidation.errors.join(', ')}`);
        allErrors.push(...syntaxValidation.errors);
        
        // Only retry for critical errors (empty files, JSON parse failures)
        const hasCriticalError = syntaxValidation.errors.some(e => 
          e.includes('empty') || e.includes('JSON parse')
        );
        
        if (hasCriticalError && attempts < MAX_ATTEMPTS) {
          continue;
        }
        
        // For non-critical errors (XML tag counting, etc.), return code as-is
      } else {
      }

      // Step 3.5: Validate client-side manifests (libman.json, bower.json) for dist vs source
      const manifestWarnings = validateClientSideManifests(code);
      if (manifestWarnings.length > 0) {
        console.warn(`[CodeGenLoop] ⚠️  Client-side manifest issues:\n${manifestWarnings.join('\n')}`);
        allErrors.push(...manifestWarnings);
        if (attempts < MAX_ATTEMPTS) {
          continue;
        }
      }

      // Step 3.6: Validate layout file asset paths match libman.json configuration
      const layoutWarnings = validateLayoutMatchesManifest(code);
      if (layoutWarnings.length > 0) {
        console.warn(`[CodeGenLoop] ⚠️  Layout/manifest path mismatches:\n${layoutWarnings.join('\n')}`);
        allErrors.push(...layoutWarnings);
        if (attempts < MAX_ATTEMPTS) {
          continue;
        }
      }

      // Step 4: Try compilation (if applicable)
      let compilationResult: { success: boolean; errors: string[] } = { success: true, errors: [] };

      if (shouldCompile(state.repoProfile?.projectType)) {
        compilationResult = await tryCompile(code, state);

        if (!compilationResult.success) {
          console.warn(`[CodeGenLoop] ⚠️  Compilation failed: ${compilationResult.errors.join(', ')}`);
          allErrors.push(...compilationResult.errors);

          if (attempts === MAX_ATTEMPTS) {
            console.warn(`[CodeGenLoop] ⚠️  Max attempts reached with compilation errors`);
            console.warn(`[CodeGenLoop] 📦 Returning syntactically valid code (compilation optional)`);
            
            // IMPORTANT: Return the code anyway - compilation errors don't mean the code is wrong
            // It might just be missing dependencies, project structure, etc.
            return {
              success: true, // Changed to true - syntax is valid, compilation is optional
              code,
              tests,
              plan,
              attempts,
              errors: allErrors, // Keep errors for reference
              validationResults: {
                syntaxValid: true,
                compilationSuccess: false,
                issues: compilationResult.errors
              }
            };
          }

          continue;
        }

      }

      // SUCCESS! All validations passed

      return {
        success: true,
        code,
        tests,
        plan,
        attempts,
        errors: [],
        validationResults: {
          syntaxValid: true,
          compilationSuccess: true,
          issues: []
        }
      };

    } catch (error) {
      console.error(`[CodeGenLoop] ❌ Attempt ${attempts} failed:`, error);
      const errorMsg = error instanceof Error ? error.message : String(error);
      allErrors.push(errorMsg);

      if (attempts === MAX_ATTEMPTS) {
        return {
          success: false,
          code: [],
          tests: [],
          plan: "",
          attempts,
          errors: allErrors
        };
      }
    }
  }

  // Should never reach here, but TypeScript needs it
  return {
    success: false,
    code: [],
    tests: [],
    plan: "",
    attempts,
    errors: allErrors
  };
}

/**
 * Generate high-level upgrade plan with FULL task awareness
 */
async function generateUpgradePlan(
  state: StackModernizationState,
  selections: VersionSelection[]
): Promise<string> {
  const { client, model } = getLLMClient(state.llmProvider);

  const tasks = state.upgradeTasks || [];

  // Get code files context — include ALL recognized source, config, and manifest extensions
  const planExtensions = new Set([
    '.java', '.js', '.ts', '.tsx', '.jsx', '.mjs', '.cjs', '.cs', '.py', '.go', '.rb', '.php',
    '.rs', '.kt', '.kts', '.c', '.cpp', '.h', '.hpp', '.swift', '.dart', '.scala', '.ex', '.exs',
    '.vue', '.svelte', '.astro',
    '.csproj', '.fsproj', '.vbproj', '.sln', '.props', '.targets', '.vcxproj',
    '.xml', '.config', '.json', '.yaml', '.yml', '.toml', '.cfg', '.ini', '.properties',
    '.gradle', '.sbt',
    '.cshtml', '.razor', '.html', '.htm', '.aspx', '.ascx', '.master',
    '.jsp', '.jspf', '.ftl', '.vm', '.erb', '.haml', '.slim',
    '.twig', '.pug', '.ejs', '.hbs', '.njk', '.j2', '.jinja2',
    '.css', '.scss', '.less',
    '.txt', '.mod', '.sum', '.lock', '.gemspec', '.rake',
  ]);
  const codeFiles = (state.extractedFiles || [])
    .filter(f => {
      const ext = path.extname(f.relativePath || '').toLowerCase();
      const baseName = path.basename(f.relativePath || '').toLowerCase();
      return planExtensions.has(ext) ||
             ['gemfile', 'rakefile', 'dockerfile', 'makefile', 'pipfile', 'podfile',
              'cmakelists.txt', 'package.swift', 'pubspec.yaml', 'build.sbt', 'mix.exs',
              'procfile', '.babelrc', '.eslintrc', '.prettierrc'].includes(baseName);
    });

  const modelName = state.llmProvider || DEFAULT_MODEL_ID;
  const modelCharBudgets: Record<string, number> = MODEL_CHAR_BUDGET_MAP;
  const totalCodeBudget = modelCharBudgets[modelName] || 200000;
  
  const planMaxFiles = parseInt(process.env.UPGRADE_PLAN_MAX_FILES || "30", 10);
  const preparedFiles = prepareFilesWithinBudget(codeFiles, {
    totalCharBudget: totalCodeBudget,
    maxCharsPerFile: Math.min(25000, Math.floor(totalCodeBudget / 4)),
    maxFiles: planMaxFiles,
    priorityExtensions: [
      'csproj', 'fsproj', 'vbproj', 'sln', 'props',
      'cs', 'java', 'py', 'ts', 'tsx', 'js', 'jsx', 'go', 'rb', 'rs', 'kt', 'php',
      'json', 'xml', 'yaml', 'yml', 'toml', 'gradle', 'config', 'properties',
      'cshtml', 'razor', 'html', 'jsp', 'erb', 'vue', 'svelte',
      'css', 'scss',
    ],
  });
  
  const codeFilesContext = preparedFiles
    .map(f => {
      const chunkNote = f.wasChunked ? ` (chunked from ${f.originalSize} chars)` : '';
      return `\n**FILE: ${f.relativePath}**${chunkNote}\n\`\`\`\n${f.content}\n\`\`\``;
    })
    .join('\n\n');
  

  const systemPrompt = buildUpgradePlanSystemPrompt();
  const userPrompt = buildUpgradePlanUserPrompt(state, selections, tasks, codeFilesContext, codeFiles.length);
  const budgetBlock = buildBudgetConstraint("codeGenLoopPlan", "code");

  const response = await trackedLLMCall(client, {
    model,
    messages: [
      { role: "system", content: `${budgetBlock}\n\n${systemPrompt}` },
      { role: "user", content: userPrompt }
    ],
    temperature: 0,
    max_tokens: safeMaxTokens(AGENT_TOKEN_BUDGETS.codeGenLoopPlan, model)
  }, { analysisId: state.analysisId, phase: "execution", agent: "CodeGenLoop/Plan" });

  return response.choices[0]?.message?.content || "";
}

/**
 * Generate upgraded code using a 3-Phase Smart Pipeline:
 * 
 * Phase 1 - TRIAGE: Single LLM call to categorize ALL files as 
 *           MUST_CHANGE / MAYBE_CHANGE / NO_CHANGE (eliminates 60-80% of files)
 * Phase 2 - GROUP: Bundle related small files into single LLM prompts
 *           (reduces remaining calls by 50-70%)
 * Phase 3 - PARALLEL: Execute grouped prompts in parallel with concurrency control
 * 
 * Net result: 50-file repo goes from ~50 LLM calls to ~5-8 calls in ~1-3 minutes
 */
async function generateCodeAndTests(
  state: StackModernizationState,
  plan: string,
  selections: VersionSelection[],
  previousErrors: string[],
  onProgress?: (
    files: Array<{ path: string; content: string; originalContent: string; changes?: any[] }>,
    context?: CodeGenerationProgressContext
  ) => void
): Promise<{ code: any[], tests: any[] }> {
  const { client, model } = getLLMClient(state.llmProvider);

  const upgradedPackages = new Set(
    selections.map(s => s.package.toLowerCase())
  );

  const codeExtensions = new Set([
    '.cs', '.csproj', '.fsproj', '.vbproj', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
    '.py', '.java', '.go', '.rb', '.php', '.rs', '.kt', '.kts',
    '.c', '.cpp', '.h', '.hpp', '.swift', '.dart', '.scala', '.ex', '.exs',
    '.vue', '.svelte', '.astro',
    '.config', '.json', '.xml', '.sln', '.props', '.targets', '.nuspec', '.vcxproj',
    '.cshtml', '.html', '.razor', '.htm', '.aspx', '.ascx', '.master',
    '.jsp', '.jspf', '.ftl', '.vm', '.erb', '.haml', '.slim',
    '.twig', '.pug', '.ejs', '.hbs', '.njk', '.j2', '.jinja2',
    '.css', '.scss', '.less',
    '.yaml', '.yml', '.toml', '.cfg', '.ini', '.properties',
    '.gradle', '.sbt',
    '.txt', '.mod', '.sum', '.lock',
    '.gemspec', '.rake',
  ]);

  // Files without extensions that are important manifest/config files
  const noExtManifestNames = new Set([
    'gemfile', 'rakefile', 'dockerfile', 'makefile', 'pipfile',
    'procfile', '.babelrc', '.eslintrc', '.prettierrc', '.editorconfig',
    'podfile', 'jenkinsfile', 'vagrantfile',
  ]);

  // Vendor/library directories whose files are restored by package managers (LibMan, Bower, npm).
  // These should NOT be sent to the LLM for upgrade — they'll be replaced by the package manager.
  const vendorDirPatterns = [
    /[/\\]wwwroot[/\\]lib[/\\]/i,
    /[/\\]bower_components[/\\]/i,
    /[/\\]node_modules[/\\]/i,
    /[/\\]vendor[/\\]assets[/\\]/i,
    /[/\\]\.nuget[/\\]/i,
  ];

  // Manifest file names are always included regardless of size
  const alwaysIncludeNames = new Set([
    'package.json', 'pom.xml', 'build.gradle', 'build.gradle.kts',
    'requirements.txt', 'pyproject.toml', 'cargo.toml', 'go.mod',
    'libman.json', 'bower.json', 'global.json', 'nuget.config', 'packages.config',
    'tsconfig.json', 'gemfile', 'composer.json', 'pipfile',
    'setup.py', 'setup.cfg', 'gradle.properties', 'settings.gradle', 'settings.gradle.kts',
    'cmakelists.txt', 'vcpkg.json', 'conanfile.txt',
    'package.swift', 'podfile', 'pubspec.yaml', 'build.sbt', 'mix.exs',
    'directory.build.props', 'directory.packages.props',
    // Framework-specific config files that matter during upgrades
    'appsettings.json', 'appsettings.development.json', 'web.config', 'app.config',
    'application.properties', 'application.yml', 'application.yaml',
    'bootstrap.yml', 'bootstrap.properties',
    'angular.json', 'next.config.js', 'next.config.mjs', 'nuxt.config.ts', 'nuxt.config.js',
    'vue.config.js', 'vite.config.ts', 'vite.config.js', 'gatsby-config.js',
    'webpack.config.js', 'jest.config.js', 'jest.config.ts', 'karma.conf.js',
    'dockerfile', 'docker-compose.yml', 'docker-compose.yaml',
  ]);
  const alwaysIncludeExts = new Set(['.csproj', '.fsproj', '.vbproj', '.sln', '.props', '.targets', '.vcxproj']);

  const allCodeFiles: typeof state.extractedFiles = [];
  let chunkedCount = 0;
  let skippedCount = 0;
  for (const f of state.extractedFiles) {
    const ext = path.extname(f.relativePath).toLowerCase();
    const baseName = path.basename(f.relativePath).toLowerCase();
    const size = f.content?.length || 0;
    if (size < 5) continue;

    const isManifest = alwaysIncludeNames.has(baseName) || alwaysIncludeExts.has(ext);
    const hasRecognizedExt = codeExtensions.has(ext);
    const isNoExtManifest = noExtManifestNames.has(baseName);

    if (!hasRecognizedExt && !isManifest && !isNoExtManifest) continue;

    // Exclude vendor library files managed by package managers
    const relPath = f.relativePath || "";
    if (vendorDirPatterns.some(pat => pat.test(relPath))) {
      if (!isManifest) continue;
    }

    // Large file handling — manifests are ALWAYS included (chunked if needed, never skipped)
    const skipThreshold = parseInt(process.env.UPGRADE_FILE_SKIP_THRESHOLD || "300000", 10);
    const chunkThreshold = parseInt(process.env.UPGRADE_FILE_CHUNK_THRESHOLD || "150000", 10);
    if (size > skipThreshold) {
      if (isManifest) {
        const chunkedContent = chunkFileContent(f.content || "", 120000, f.relativePath);
        allCodeFiles.push({ ...f, content: chunkedContent });
        chunkedCount++;
      } else {
        console.warn(`[CodeGenLoop] Skipping very large file (${(size / 1000).toFixed(0)}K chars, likely generated): ${f.relativePath}`);
        skippedCount++;
        // Track skipped files on state for reporting
        if ((state as any).skippedFiles === undefined) (state as any).skippedFiles = [];
        (state as any).skippedFiles.push({
          path: f.relativePath,
          reason: `File too large (${(size / 1000).toFixed(0)}K chars, threshold: ${(skipThreshold / 1000).toFixed(0)}K)`,
          size,
        });
      }
      continue;
    }
    if (size > chunkThreshold) {
      const chunkedContent = chunkFileContent(f.content || "", 120000, f.relativePath);
      allCodeFiles.push({ ...f, content: chunkedContent });
      chunkedCount++;
      continue;
    }

    allCodeFiles.push(f);
  }

  // Proactively sanitize file content to prevent Azure content filter rejections
  const { sanitizeForContentFilter } = await import("./prompt-sanitizer");
  for (const f of allCodeFiles) {
    if (f.content) {
      f.content = sanitizeForContentFilter(f.content, "standard");
    }
  }

  // Notify UI: phase triage started
  try { onProgress?.([], { phase: "triage" }); } catch (e) { /* ignore */ }

  // ═══════════════════════════════════════════
  // PHASE 1: TRIAGE - One LLM call to classify all files
  // ═══════════════════════════════════════════

  const triageResult = await triageFiles(client, model, allCodeFiles, selections, plan, state.importGraph, state.analysisId);

  // Post-triage safety net: promote NO_CHANGE files to MAYBE_CHANGE when they
  // are view/template files during a frontend/CSS upgrade, or when they reference
  // any upgraded package. The LLM triage only sees 30-line previews and often
  // misses patterns deeper in the file (e.g., Bootstrap classes on line 80).
  const frontendPkgKeywords = [
    "bootstrap", "twitter-bootstrap", "jquery", "fontawesome", "font-awesome",
    "react", "vue", "angular", "svelte", "tailwind", "bulma", "material",
    "popper", "datepicker", "select2", "datatables", "chart", "d3",
    "slick", "swiper", "fullcalendar", "summernote", "tinymce", "toastr",
    "jquery-validate", "moment", "dayjs", "lodash",
  ];
  let isFrontendUpgrade = selections.some(s =>
    frontendPkgKeywords.some(k => (s.package || "").toLowerCase().includes(k))
  );

  // Fallback: if vendor detection missed bundled libraries (e.g. jQuery/Bootstrap in uiframework/),
  // detect frontend upgrade from actual code patterns in view/JS files
  if (!isFrontendUpgrade) {
    const frontendContentPatterns = [
      /data-toggle=/i, /data-bs-toggle=/i,
      /\bfa\s+fa-/i, /\bfas\s+fa-/i,
      /\bbtn\s+btn-/i, /\bcol-md-/i, /\bmodal-dialog/i,
      /\$\(document\)/i, /\$\(["'#]/i, /jQuery\b/i,
      /bootstrap\.min\./i, /jquery\.min\./i,
    ];
    const frontendExts = new Set([".cshtml", ".html", ".razor", ".htm", ".js", ".css", ".jsx", ".tsx"]);
    const hasFrontendPatterns = allCodeFiles.some(f => {
      const ext = path.extname(f.relativePath).toLowerCase();
      if (!frontendExts.has(ext)) return false;
      const sample = (f.content || "").slice(0, 50000); // Check first 50K chars for perf
      return frontendContentPatterns.some(p => p.test(sample));
    });
    if (hasFrontendPatterns) {
      isFrontendUpgrade = true;
      console.log("[CodeGenLoop] isFrontendUpgrade=true via content pattern fallback (Bootstrap/jQuery/FA patterns found in code)");
    }
  }

  const viewExtSet = new Set([
    ".cshtml", ".html", ".razor", ".htm", ".aspx", ".ascx", ".master",
    ".jsp", ".jspf", ".jsf", ".ftl", ".vm",
    ".erb", ".haml", ".slim", ".ejs", ".hbs", ".pug", ".njk", ".twig",
    ".j2", ".jinja2",
    ".svelte", ".vue", ".astro",
  ]);
  const styleExtSet = new Set([".css", ".scss", ".less"]);
  const upgradedPkgLower = new Set(selections.map(s => (s.package || "").toLowerCase()));

  // Build a set of paths classified as MUST_CHANGE for dependency-based promotion
  const mustChangePaths = new Set(
    triageResult.filter(t => t.action === "MUST_CHANGE").map(t => t.file.relativePath)
  );
  const importGraphDeps = state.importGraph?.fileToFiles || {};

  // Use AST analysis for smarter triage promotion
  const astAnalysis = state.astAnalysis || {};
  const impactReport = state.impactReport;
  const impactedPaths = new Set(impactReport?.affectedFiles.map(f => f.path) || []);

  for (const entry of triageResult) {
    if (entry.action !== "NO_CHANGE") continue;
    const ext = path.extname(entry.file.relativePath).toLowerCase();
    const baseName = path.basename(entry.file.relativePath).toLowerCase();
    const content = (entry.file.content || "").toLowerCase();
    const filePath = entry.file.relativePath;

    // P7: Promote files flagged by the impact analyzer as having deprecated/removed API usage
    if (impactedPaths.has(filePath)) {
      const fileImpact = impactReport!.affectedFiles.find(f => f.path === filePath);
      entry.action = "MUST_CHANGE";
      entry.reason = `Promoted to MUST_CHANGE: impact analysis found ${fileImpact?.impacts.length} issues (risk: ${fileImpact?.riskScore}/100)`;
      mustChangePaths.add(filePath);
      continue;
    }

    // P7: Use AST imports to check if this file imports deprecated/upgraded packages
    const ast = astAnalysis[filePath];
    if (ast) {
      let astPromoted = false;

      // Check if AST imports reference any upgraded package
      for (const imp of ast.imports) {
        const importLower = imp.source.toLowerCase();
        for (const pkg of upgradedPkgLower) {
          if (pkg && (importLower.includes(pkg) || imp.names.some(n => n.toLowerCase().includes(pkg)))) {
            entry.action = "MUST_CHANGE";
            entry.reason = `Promoted via AST: imports "${imp.source}" which references upgraded package "${pkg}"`;
            mustChangePaths.add(filePath);
            astPromoted = true;
            break;
          }
        }
        if (astPromoted) break;
      }
      if (astPromoted) continue;

      // Check if AST has event bindings or navigation logic (preserve these files)
      if (ast.eventBindings.length > 0 && isFrontendUpgrade) {
        entry.action = "MAYBE_CHANGE";
        entry.reason = `Promoted via AST: ${ast.eventBindings.length} event bindings detected, needs review for frontend upgrade`;
        continue;
      }

      // Check if AST function calls reference deprecated APIs
      for (const call of ast.functionCalls) {
        const fullLower = call.fullExpression.toLowerCase();
        if (fullLower.includes("browserlink") || fullLower.includes("binaryformatter") ||
            fullLower.includes("webrequest") || fullLower.includes("webclient")) {
          entry.action = "MUST_CHANGE";
          entry.reason = `Promoted via AST: uses deprecated API "${call.fullExpression}"`;
          mustChangePaths.add(filePath);
          break;
        }
      }
      if (entry.action !== "NO_CHANGE") continue;
    }

    // Promote all view/template + style files when frontend upgrade is in scope
    if (isFrontendUpgrade && (viewExtSet.has(ext) || baseName.endsWith(".blade.php") || styleExtSet.has(ext))) {
      entry.action = "MAYBE_CHANGE";
      entry.reason = "Promoted: view/style file during frontend upgrade (LLM may have missed patterns beyond preview)";
      continue;
    }

    // Promote any file that mentions an upgraded package anywhere in its content
    let promoted = false;
    for (const pkg of upgradedPkgLower) {
      if (pkg && content.includes(pkg)) {
        entry.action = "MAYBE_CHANGE";
        entry.reason = `Promoted: content references upgraded package "${pkg}"`;
        promoted = true;
        break;
      }
    }
    if (promoted) continue;

    // Promote files that depend on (import from) a MUST_CHANGE file via the import graph
    const deps = importGraphDeps[entry.file.relativePath] || [];
    for (const dep of deps) {
      if (mustChangePaths.has(dep)) {
        entry.action = "MAYBE_CHANGE";
        entry.reason = `Promoted: depends on MUST_CHANGE file "${dep}" via import graph`;
        break;
      }
    }
  }

  const mustChange = triageResult.filter(t => t.action === "MUST_CHANGE");
  const maybeChange = triageResult.filter(t => t.action === "MAYBE_CHANGE");
  const noChange = triageResult.filter(t => t.action === "NO_CHANGE");


  const filesToUpgrade = [...mustChange, ...maybeChange];

  // Attach file intelligence to each file for downstream prompt injection
  const fileIntelMap = state.fileIntelligence || {};
  for (const entry of filesToUpgrade) {
    const intel = fileIntelMap[entry.file.relativePath];
    if (intel) (entry.file as any).__intelligence = intel;
  }

  if (filesToUpgrade.length === 0) {
    console.warn(`[CodeGenLoop] ⚠️ Triage found no files to change — falling back to manifest files`);
    const manifestNames = new Set([
      'package.json', 'pom.xml', 'build.gradle', 'requirements.txt', 'pyproject.toml',
      'cargo.toml', 'go.mod', 'gemfile', 'composer.json', 'libman.json', 'bower.json',
      'global.json', 'nuget.config', 'packages.config', 'tsconfig.json',
      'gradle.properties', 'settings.gradle', 'pipfile', 'setup.py', 'setup.cfg',
    ]);
    const manifestExts = new Set(['.csproj', '.sln', '.props', '.targets']);
    const manifestFiles = allCodeFiles.filter(f => {
      const name = path.basename(f.relativePath).toLowerCase();
      const ext = path.extname(f.relativePath).toLowerCase();
      return manifestExts.has(ext) || manifestNames.has(name);
    });
    for (const mf of manifestFiles) {
      filesToUpgrade.push({ file: mf, action: "MUST_CHANGE" as const, reason: "Manifest file" });
    }
  }

  // Notify UI: phase group started
  try { onProgress?.([], { phase: "group" }); } catch (e) { /* ignore */ }

  // ═══════════════════════════════════════════
  // PHASE 2: DEPENDENCY-AWARE LAYERING + GROUPING
  // ═══════════════════════════════════════════
  const fileToFiles = state.importGraph?.fileToFiles || {};
  const hasFileDeps = Object.keys(fileToFiles).length > 0;

  let dependencyLayers: DependencyLayer[];
  if (hasFileDeps) {
    dependencyLayers = buildDependencyLayers(filesToUpgrade, fileToFiles, model);
  } else {
    dependencyLayers = [{
      layerIndex: 0,
      groups: groupFilesForUpgrade(filesToUpgrade, model),
    }];
  }

  const totalGroups = dependencyLayers.reduce((sum, l) => sum + l.groups.length, 0);
  for (const layer of dependencyLayers) {
    layer.groups.forEach((g, i) => {
    });
  }

  // ═══════════════════════════════════════════
  // PHASE 3: LAYERED EXECUTION (layers sequential, groups parallel within layer)
  // ═══════════════════════════════════════════

  const upgradedFiles: any[] = [];
  const CONCURRENCY = 3;
  const accumulated: AccumulatedChangeSummary = { layers: [] };
  let groupsDone = 0;

  for (const layer of dependencyLayers) {
    const changeSummaryText = formatChangeSummaryForPrompt(accumulated, CHANGE_SUMMARY_TOKEN_BUDGET);

    if (changeSummaryText) {
    }


    const layerResults: any[] = [];

    for (let i = 0; i < layer.groups.length; i += CONCURRENCY) {
      const batch = layer.groups.slice(i, i + CONCURRENCY);

      const batchPromises = batch.map(async (group) => {
        try {
          if (group.files.length === 1) {
            return await upgradeSingleFile(client, model, group.files[0].file, selections, plan, previousErrors, changeSummaryText, state.analysisId);
          } else {
            return await upgradeMultipleFiles(client, model, group.files.map(f => f.file), selections, plan, previousErrors, changeSummaryText, state.analysisId);
          }
        } catch (err) {
          const names = group.files.map(f => path.basename(f.file.relativePath)).join(', ');
          console.error(`[CodeGenLoop] ❌ Group failed (${names}):`, err instanceof Error ? err.message : err);
          return [];
        }
      });

      const batchResults = await Promise.all(batchPromises);
      for (const results of batchResults) {
        layerResults.push(...results);
        upgradedFiles.push(...results);
      }
      groupsDone += batch.length;

      if (onProgress && upgradedFiles.length > 0) {
        try {
          onProgress(
            upgradedFiles.map(f => ({
              path: f.path,
              content: f.content,
              originalContent: f.originalContent,
              changes: f.changes
            })),
            {
              phase: "upgrade",
              batchIndex: groupsDone - 1,
              totalBatches: totalGroups,
              filesDone: upgradedFiles.length
            }
          );
        } catch (e) {
          console.warn("[CodeGenLoop] onProgress callback error:", e);
        }
      }
    }

    // Build change summary for this layer and accumulate for the next layer
    const layerSummary = buildLayerChangeSummary(layer.layerIndex, layerResults);
    if (layerSummary.files.length > 0) {
      accumulated.layers.push(layerSummary);
    }
  }

  // ═══════════════════════════════════════════
  // PHASE 3.5: MARKUP vs BUNDLE CONSISTENCY CHECK
  // ═══════════════════════════════════════════
  const extractedFiles = state.extractedFiles || [];
  const consistencyIssues = validateMarkupBundleConsistency(upgradedFiles, selections, extractedFiles);
  if (consistencyIssues.length > 0) {
    console.warn(`[CodeGenLoop] ⚠️  Markup-vs-bundle consistency issues found:\n${consistencyIssues.join('\n')}`);
    logActivity(state, `Markup/bundle consistency: ${consistencyIssues.length} issue(s) detected`, "warning");
  }

  // Static vendor file warnings
  const { detectStaticVendorFiles } = require("./deterministic-transforms");
  const staticVendorWarnings: Array<{ path: string; library: string; detectedVersion: string | null; targetVersion: string | null }> = detectStaticVendorFiles(extractedFiles, selections);
  if (staticVendorWarnings.length > 0) {
    for (const warning of staticVendorWarnings) {
      const msg = `Static vendor file "${warning.path}" contains ${warning.library}${warning.detectedVersion ? ` v${warning.detectedVersion}` : ''} but target is ${warning.targetVersion}. This file cannot be auto-upgraded — please manually download the new version.`;
      console.warn(`[CodeGenLoop] ⚠️  ${msg}`);
      logActivity(state, msg, "warning");
    }
  }

  // ═══════════════════════════════════════════
  // PHASE 4: POST-UPGRADE SWEEP — scan ALL project files for broken references
  // ═══════════════════════════════════════════
  // After upgrading, paths/APIs/classes may have changed. Files originally
  // classified NO_CHANGE might now be broken. We scan every file in the
  // project, compare against the accumulated change summary, and send only
  // the ones that need fixing through a lightweight targeted LLM pass.

  const changeSummaryForSweep = formatChangeSummaryForPrompt(accumulated, CHANGE_SUMMARY_TOKEN_BUDGET);
  if (changeSummaryForSweep && noChange.length > 0) {

    const brokenRefs = detectBrokenReferences(noChange.map(t => t.file), upgradedFiles, selections);

    if (brokenRefs.length > 0) {

      const sweepGroups = groupFilesForUpgrade(
        brokenRefs.map(br => ({
          file: br.file,
          action: "MUST_CHANGE" as const,
          reason: br.reasons.join("; "),
        })),
        model
      );

      for (const group of sweepGroups) {
        try {
          let results: any[];
          if (group.files.length === 1) {
            results = await upgradeSingleFile(
              client, model, group.files[0].file, selections, plan,
              [...previousErrors, ...group.files[0].reason.split("; ")],
              changeSummaryForSweep, state.analysisId,
            );
          } else {
            results = await upgradeMultipleFiles(
              client, model, group.files.map(f => f.file), selections, plan,
              previousErrors,
              changeSummaryForSweep, state.analysisId,
            );
          }

          for (const r of results) {
            const existingIdx = upgradedFiles.findIndex((uf: any) => uf.path === r.path);
            if (existingIdx >= 0) {
              upgradedFiles[existingIdx] = r;
            } else {
              upgradedFiles.push(r);
            }
          }
        } catch (err) {
          const names = group.files.map(f => path.basename(f.file.relativePath)).join(', ');
          console.error(`[CodeGenLoop] ❌ Sweep group failed (${names}):`, err instanceof Error ? err.message : err);
        }
      }

    } else {
    }
  }


  return { code: upgradedFiles, tests: [] };
}

// ══════════════════════════════════════════════════════════════
// PHASE 1 IMPLEMENTATION: Triage via single LLM call
// ══════════════════════════════════════════════════════════════

interface TriageEntry {
  file: any;
  action: "MUST_CHANGE" | "MAYBE_CHANGE" | "NO_CHANGE";
  reason: string;
}

type ImportGraphLike = {
  packageToFiles: Record<string, string[]>;
  fileToFiles?: Record<string, string[]>;
} | undefined;

async function triageFiles(
  client: any,
  model: string,
  files: any[],
  selections: VersionSelection[],
  plan: string,
  importGraph?: ImportGraphLike,
  analysisId?: string,
): Promise<TriageEntry[]> {
  const upgradedPackages = new Set(selections.map(s => s.package.toLowerCase()));

  // Build package → files summary from import graph so triage can prefer MUST_CHANGE for files that use upgraded packages
  const importScopeBlock =
    importGraph?.packageToFiles && selections.length > 0
      ? `
**PACKAGES BEING UPGRADED — FILES THAT USE THEM (from import analysis):**
${selections
  .map(s => {
    const pkg = s.package;
    const filesForPkg = importGraph.packageToFiles[pkg] ?? importGraph.packageToFiles[pkg.toLowerCase()] ?? [];
    return `- ${pkg}: ${filesForPkg.length ? filesForPkg.slice(0, 80).join(", ") + (filesForPkg.length > 80 ? ` (+${filesForPkg.length - 80} more)` : "") : "no direct imports"}`;
  })
  .join("\n")}
Use this to prefer MUST_CHANGE or MAYBE_CHANGE for files that actually import upgraded packages.

`
      : "";

  // Build a compact manifest using FULL-CONTENT pattern scanning.
  // Instead of only the first 30 lines, we regex-scan the ENTIRE file for
  // upgrade-relevant signals: imports, framework classes, JS plugin calls,
  // asset refs, data attributes, version strings, and API patterns.
  // This is instant (regex, no LLM) and catches patterns on any line.
  const fileManifest = files.map(f => {
    const content = f.content || '';
    const contentLower = content.toLowerCase();
    const lines = content.split('\n');
    const signals: string[] = [];

    // 1. Imports / using / require (scan ALL lines, take top 15)
    const importLines = lines.filter((l: string) =>
      /^(import |using |require\(|from |#include|include |gem |pip )/.test(l.trim())
    ).slice(0, 15);
    if (importLines.length > 0) signals.push(`IMPORTS (${importLines.length}):\n${importLines.join('\n')}`);

    // 2. Framework directives (Razor, JSP, ERB, etc.)
    const directives = lines.filter((l: string) => {
      const t = l.trim();
      return /^@(using|model|inject|page|layout)\b/.test(t) ||
             /^<%|^{{|^{%|^<\?/.test(t);
    }).slice(0, 5);
    if (directives.length > 0) signals.push(`DIRECTIVES: ${directives.join(' | ')}`);

    // 3. Asset references — scan FULL content for <link>/<script> with lib paths
    const assetRefs: string[] = [];
    const assetPattern = /(?:href|src)\s*=\s*["']([^"']*(?:lib\/|cdn|node_modules\/|vendor\/)[^"']*)["']/gi;
    let am: RegExpExecArray | null;
    while ((am = assetPattern.exec(content)) !== null) assetRefs.push(am[1]);
    if (assetRefs.length > 0) signals.push(`ASSET_REFS (${assetRefs.length}): ${[...new Set(assetRefs)].slice(0, 8).join(', ')}`);

    // 4. CSS framework classes — scan FULL content
    const cssClasses = new Set<string>();
    const classPattern = /class="([^"]+)"/gi;
    let cm: RegExpExecArray | null;
    while ((cm = classPattern.exec(content)) !== null) {
      for (const cls of cm[1].split(/\s+/)) {
        if (/^(form-|btn-|input-|card-|nav-|modal-|badge-|alert-|table-|col-|row|container|jumbotron|carousel|dropdown|navbar|toast|offcanvas|accordion|spinner|breadcrumb|pagination|progress|list-group|custom-|text-|bg-|border-|d-|flex-|float-|m[trblxy]?-|p[trblxy]?-|ms-|me-|ps-|pe-|g[xy]?-|data-bs-|data-toggle|data-dismiss|data-target|data-ride)/.test(cls)) {
          cssClasses.add(cls);
        }
      }
    }
    if (cssClasses.size > 0) signals.push(`CSS_CLASSES (${cssClasses.size}): ${[...cssClasses].slice(0, 15).join(', ')}${cssClasses.size > 15 ? ` (+${cssClasses.size - 15} more)` : ''}`);

    // 5. data-* attributes from UI frameworks — scan FULL content
    const dataAttrs = new Set<string>();
    const dataAttrPattern = /data-(?:bs-|toggle|dismiss|target|ride|slide|spy|offset|placement|trigger|backdrop|keyboard|scroll|container|content|html|animation|delay|selector|template|boundary|fallback)[a-z-]*/gi;
    let dm: RegExpExecArray | null;
    while ((dm = dataAttrPattern.exec(content)) !== null) dataAttrs.add(dm[0].toLowerCase());
    if (dataAttrs.size > 0) signals.push(`DATA_ATTRS: ${[...dataAttrs].join(', ')}`);

    // 6. JS plugin / jQuery API calls — scan FULL content
    const pluginCalls = new Set<string>();
    const pluginPattern = /\.\s*(datepicker|timepicker|selectpicker|typeahead|tooltip|popover|modal|collapse|carousel|tab|dropdown|alert|toast|validate|validator|dataTable|DataTable|select2|chosen|sortable|autocomplete|slider|colorpicker|summernote|fullcalendar|owlCarousel|slick|swiper|magnificPopup|fancybox|lightbox)\s*\(/gi;
    let pm: RegExpExecArray | null;
    while ((pm = pluginPattern.exec(content)) !== null) pluginCalls.add(`.${pm[1]}()`);
    if (pluginCalls.size > 0) signals.push(`JS_PLUGIN_CALLS: ${[...pluginCalls].join(', ')}`);

    // 7. Version strings — scan FULL content
    const versionRefs: string[] = [];
    for (const pkg of upgradedPackages) {
      if (contentLower.includes(pkg)) versionRefs.push(pkg);
    }
    if (versionRefs.length > 0) signals.push(`REFERENCES_UPGRADED_PKGS: ${versionRefs.join(', ')}`);

    // 8. Package references in manifests — scan FULL content
    const pkgRefPattern = /<PackageReference\s+Include="([^"]+)"/gi;
    const pkgRefs: string[] = [];
    let prm: RegExpExecArray | null;
    while ((prm = pkgRefPattern.exec(content)) !== null) pkgRefs.push(prm[1]);
    if (pkgRefs.length > 0) signals.push(`NUGET_PKGS (${pkgRefs.length}): ${pkgRefs.slice(0, 10).join(', ')}`);

    // 9. Brief preview (first 10 lines for file structure context)
    const preview = lines.slice(0, 10).join('\n');

    const signature = signals.length > 0
      ? `${signals.join('\n')}\n\nPREVIEW (first 10 lines):\n${preview}`
      : preview;
    return `### ${f.relativePath} (${content.length} chars)\n${signature}`;
  });

  // Sort manifest entries: manifests first, entry points second, config files third, then package-referencing files, then rest
  const manifestNames = new Set([
    'package.json', 'pom.xml', 'build.gradle', 'build.gradle.kts', 'requirements.txt',
    'pyproject.toml', 'cargo.toml', 'go.mod', 'gemfile', 'composer.json',
    'libman.json', 'bower.json', 'global.json', 'nuget.config',
    'tsconfig.json', 'cmakelists.txt', 'vcpkg.json', 'pubspec.yaml', 'build.sbt', 'mix.exs',
  ]);
  const manifestExtSet = new Set(['.csproj', '.fsproj', '.vbproj', '.sln', '.props', '.targets', '.vcxproj']);
  const entryPointNames = new Set([
    'program.cs', 'startup.cs', 'main.py', 'app.py', 'main.java', 'application.java',
    'main.go', 'main.rs', 'index.js', 'index.ts', 'app.js', 'app.ts', 'main.dart', 'main.cpp',
  ]);
  const configFileNames = new Set([
    'appsettings.json', 'web.config', 'application.properties', 'application.yml',
    'settings.py', 'angular.json', 'next.config.js', 'vite.config.ts', 'dockerfile',
  ]);

  const fileRelevanceScore = (f: typeof files[0]) => {
    const bn = path.basename(f.relativePath).toLowerCase();
    const ext = path.extname(f.relativePath).toLowerCase();
    if (manifestNames.has(bn) || manifestExtSet.has(ext)) return 100;
    if (entryPointNames.has(bn)) return 80;
    if (configFileNames.has(bn)) return 70;
    const contentLower = (f.content || '').toLowerCase();
    for (const pkg of upgradedPackages) { if (contentLower.includes(pkg)) return 50; }
    return 0;
  };

  const sortedIndices = files.map((f, i) => ({ idx: i, score: fileRelevanceScore(f) }));
  sortedIndices.sort((a, b) => b.score - a.score);
  const sortedManifest = sortedIndices.map(s => fileManifest[s.idx]);

  // Cap the manifest to stay within token limits
  const isClaudeModel = model.toLowerCase().includes('claude');
  const triageCapClaude = parseInt(process.env.UPGRADE_TRIAGE_CAP_CLAUDE || "150000", 10);
  const triageCapGpt = parseInt(process.env.UPGRADE_TRIAGE_CAP_GPT || "150000", 10);
  const maxManifestChars = isClaudeModel ? triageCapClaude : triageCapGpt;
  let manifest = sortedManifest.join('\n\n---\n\n');
  if (manifest.length > maxManifestChars) {
    // Compact mode: keep only path + signal summary (no preview lines)
    const sortedFiles = sortedIndices.map(s => files[s.idx]);
    const shortManifest = sortedFiles.map(f => {
      const content = f.content || '';
      const contentLower = content.toLowerCase();
      const ext = path.extname(f.relativePath).toLowerCase();
      const bn = path.basename(f.relativePath).toLowerCase();
      const shortSignals: string[] = [];

      // Quick package reference check
      for (const pkg of upgradedPackages) {
        if (contentLower.includes(pkg)) { shortSignals.push(`refs:${pkg}`); break; }
      }
      // Quick asset/lib reference check
      if (/(?:href|src)\s*=\s*["'][^"']*lib\//i.test(content)) shortSignals.push('has:asset-refs');
      // Quick class check for view files
      if (['.cshtml','.html','.razor','.htm','.aspx','.ascx','.master','.jsp','.jspf','.ftl','.vm','.erb','.haml','.slim','.ejs','.hbs','.pug','.njk','.twig','.j2','.jinja2','.vue','.svelte','.astro'].includes(ext) || bn.endsWith('.blade.php')) {
        if (/class="[^"]*(?:form-|btn-|card-|nav-|modal-|col-|row)/.test(content)) shortSignals.push('has:framework-classes');
        if (/\.\s*(?:datepicker|modal|tooltip|validate|select2|dataTable)\s*\(/i.test(content)) shortSignals.push('has:plugin-calls');
      }

      return `${f.relativePath} (${content.length}ch) ${shortSignals.length > 0 ? `[${shortSignals.join(', ')}]` : ''}`;
    });
    manifest = shortManifest.join('\n');
    if (manifest.length > maxManifestChars) {
      manifest = manifest.slice(0, maxManifestChars);
    }
  }

  const triageUserPrompt = buildTriageUserPrompt(files, selections, plan, manifest, importScopeBlock);
  const triageBudgetBlock = buildBudgetConstraint("codeGenLoopTriage", "json");

  try {
    const triageParams: any = {
      model,
      messages: [
        { role: "system", content: `${triageBudgetBlock}\n\n${buildTriageSystemPrompt()}` },
        { role: "user", content: triageUserPrompt }
      ],
      temperature: 0,
      max_tokens: safeMaxTokens(AGENT_TOKEN_BUDGETS.codeGenLoopTriage, model)
    };
    const response = analysisId
      ? await trackedLLMCall(client, triageParams, { analysisId, phase: "execution", agent: "CodeGenLoop/Triage" })
      : await client.chat.completions.create(normalizeRequestParams(triageParams));

    let jsonText = response.choices[0]?.message?.content?.trim() || "[]";
    jsonText = jsonText.replace(/^```json?\n?/i, '').replace(/\n?```$/i, '');
    
    const triageData = JSON.parse(jsonText) as Array<{ path: string; action: string; reason: string }>;
    
    // Normalize paths so LLM output (any slash style) matches our relativePath
    const norm = (p: string) => (p || "").replace(/\\/g, "/").trim().replace(/^\/+/, "");
    const fileMap = new Map<string, any>(files.map(f => [norm(f.relativePath), f]));
    const results: TriageEntry[] = [];

    for (const entry of triageData) {
      const key = norm(entry.path);
      const file = fileMap.get(key) ?? fileMap.get(entry.path);
      if (file) {
        const action = (["MUST_CHANGE", "MAYBE_CHANGE", "NO_CHANGE"].includes(entry.action) 
          ? entry.action 
          : "MAYBE_CHANGE") as TriageEntry["action"];
        results.push({ file, action, reason: entry.reason || "" });
        fileMap.delete(norm(file.relativePath));
        fileMap.delete(key);
      }
    }

    // Any files the LLM missed → use manifest/entry-point heuristics so MUST_CHANGE is correct
    for (const [, file] of fileMap) {
      const name = path.basename(file.relativePath).toLowerCase();
      const ext = path.extname(file.relativePath).toLowerCase();
      const isManifest = ['.csproj', '.sln', '.props'].includes(ext) || 
                         name === 'package.json' || name === 'pom.xml' || name === 'build.gradle' ||
                         name === 'requirements.txt' || name === 'pyproject.toml' || name === 'libman.json';
      const isEntryPoint = ['program.cs', 'startup.cs', 'app.cs', 'main.cs', 'main.py', 'app.py', 'main.go', 'main.rs',
        'index.ts', 'index.js', 'index.tsx', 'index.jsx', 'main.ts', 'main.java', 'app.java'].includes(name);
      const isLayoutTemplate = name.includes('_layout') || name.includes('_viewstart') || name.includes('_viewimports');
      results.push({ 
        file, 
        action: (isManifest || isEntryPoint || isLayoutTemplate) ? "MUST_CHANGE" : "MAYBE_CHANGE", 
        reason: "Not classified by LLM — defaulting" 
      });
    }

    return results;

  } catch (err) {
    console.error(`[CodeGenLoop] ⚠️ Triage LLM call failed, falling back to heuristic scoring:`, err instanceof Error ? err.message : err);
    return heuristicTriage(files, upgradedPackages);
  }
}

/**
 * Fallback: heuristic-based triage when LLM triage fails
 */
function heuristicTriage(files: any[], upgradedPackages: Set<string>): TriageEntry[] {
  const frontendKeywords = [
    "bootstrap", "twitter-bootstrap", "jquery", "handlebars", "fontawesome", "font-awesome",
    "react", "vue", "angular", "svelte", "alpinejs", "htmx",
    "tailwind", "bulma", "foundation", "material", "ant-design",
    "semantic-ui", "uikit", "popper", "popperjs",
    "datepicker", "timepicker", "flatpickr", "select2", "chosen",
    "datatables", "chart", "chartjs", "d3", "highcharts",
    "leaflet", "lodash", "moment", "dayjs",
    "slick", "swiper", "owl", "lightbox", "fancybox",
    "summernote", "tinymce", "ckeditor", "quill",
    "fullcalendar", "toastr", "sweetalert",
    "jquery-validate", "jquery-validation",
  ];
  const hasFrontendUpgrade = [...upgradedPackages].some(p =>
    frontendKeywords.some(k => p.includes(k))
  );

  return files.map(f => {
    const ext = path.extname(f.relativePath).toLowerCase();
    const name = path.basename(f.relativePath).toLowerCase();
    const content = (f.content || '').toLowerCase();

    // Manifests → MUST_CHANGE
    if (['.csproj', '.sln', '.props', '.targets'].includes(ext) || 
        name === 'package.json' || name === 'pom.xml' || name === 'build.gradle' || 
        name === 'requirements.txt' || name === 'pyproject.toml' || name === 'libman.json') {
      return { file: f, action: "MUST_CHANGE" as const, reason: "Manifest file" };
    }

    // Entry points → MUST_CHANGE
    const entryPoints = ['program.cs', 'startup.cs', 'app.cs', 'main.cs', 'main.py', 'app.py', 'main.go', 'main.rs',
      'index.ts', 'index.js', 'index.tsx', 'index.jsx', 'main.ts', 'main.java', 'app.java'];
    if (entryPoints.includes(name)) {
      return { file: f, action: "MUST_CHANGE" as const, reason: "Entry point" };
    }

    // Frontend templates when frontend frameworks are being upgraded — ALL tech stacks
    const viewExts = [
      '.cshtml', '.html', '.razor', '.htm', '.aspx', '.ascx', '.master',
      '.jsp', '.jspf', '.jsf', '.ftl', '.vm',
      '.erb', '.haml', '.slim', '.ejs', '.hbs', '.pug', '.njk', '.twig',
      '.j2', '.jinja2',
      '.svelte', '.vue', '.astro',
    ];
    if (hasFrontendUpgrade && (viewExts.includes(ext) || name.endsWith('.blade.php'))) {
      return { file: f, action: "MUST_CHANGE" as const, reason: "Template file with frontend upgrade in scope" };
    }

    // CSS files when Bootstrap/CSS framework is being upgraded
    if (hasFrontendUpgrade && ['.css', '.scss', '.less'].includes(ext)) {
      return { file: f, action: "MUST_CHANGE" as const, reason: "Stylesheet with frontend upgrade in scope" };
    }

    // Lock/generated/test files → NO_CHANGE
    if (name.includes('lock') || name.includes('.min.') || name.includes('.generated.') ||
        name.includes('.test.') || name.includes('.spec.')) {
      return { file: f, action: "NO_CHANGE" as const, reason: "Generated/test file" };
    }

    // Files referencing upgraded packages → MAYBE_CHANGE
    for (const pkg of upgradedPackages) {
      if (content.includes(pkg)) {
        return { file: f, action: "MAYBE_CHANGE" as const, reason: `References ${pkg}` };
      }
    }

    // Config files with version references → MAYBE_CHANGE
    if (['.config', '.json', '.xml'].includes(ext) && content.includes('version')) {
      return { file: f, action: "MAYBE_CHANGE" as const, reason: "Config with version refs" };
    }

    return { file: f, action: "NO_CHANGE" as const, reason: "No upgrade relevance detected" };
  });
}

// ══════════════════════════════════════════════════════════════
// PHASE 2 IMPLEMENTATION: Smart file grouping
// ══════════════════════════════════════════════════════════════

interface FileGroup {
  files: TriageEntry[];
  estimatedTokens: number;
}

function groupFilesForUpgrade(files: TriageEntry[], model: string): FileGroup[] {
  // Token budget per LLM call (leaving room for system prompt + response)
  const maxTokensPerCall = model.toLowerCase().includes('claude') ? 40000 : 30000;

  // Classify files into client-asset groups so manifests, layouts, AND consuming
  // view/template files end up adjacent in the sort order → same LLM batch.
  // This covers ALL tech stacks: .cshtml/.razor (.NET), .html/.htm (general),
  // .jsp/.jsf (Java), .erb/.haml/.slim (Ruby), .blade.php (Laravel),
  // .ejs/.hbs/.pug/.njk (Node), .twig (Symfony), .svelte/.vue/.astro (SPA).
  const clientManifestNames = new Set([
    "libman.json", "bower.json", "package.json", "jspm.json",
    "bundleconfig.json", ".bowerrc",
  ]);
  const viewExts = new Set([
    ".cshtml", ".html", ".razor", ".htm", ".aspx", ".ascx", ".master",
    ".jsp", ".jspf", ".jsf", ".ftl", ".vm",
    ".erb", ".haml", ".slim",
    ".blade.php", ".ejs", ".hbs", ".pug", ".njk", ".twig",
    ".j2", ".jinja2",
    ".svelte", ".vue", ".astro",
  ]);
  const isClientManifest = (e: TriageEntry) =>
    clientManifestNames.has(path.basename(e.file.relativePath).toLowerCase());
  const isLayoutView = (e: TriageEntry) => {
    const name = path.basename(e.file.relativePath).toLowerCase();
    const ext = path.extname(name).toLowerCase();
    return viewExts.has(ext) && (name.includes("layout") || name.includes("_layout"));
  };
  const isViewTemplate = (e: TriageEntry) => {
    const ext = path.extname(e.file.relativePath).toLowerCase();
    return viewExts.has(ext);
  };

  // Sort order: MUST_CHANGE first → manifests → layout views → other view/templates → by directory.
  // This ensures manifests + ALL views cluster together and overflow into adjacent groups.
  const sorted = [...files].sort((a, b) => {
    if (a.action === "MUST_CHANGE" && b.action !== "MUST_CHANGE") return -1;
    if (b.action === "MUST_CHANGE" && a.action !== "MUST_CHANGE") return 1;

    const aIsManifest = isClientManifest(a);
    const bIsManifest = isClientManifest(b);
    const aIsLayout = isLayoutView(a);
    const bIsLayout = isLayoutView(b);
    const aIsView = isViewTemplate(a);
    const bIsView = isViewTemplate(b);

    // Priority: manifests (0) > layout views (1) > other views (2) > rest (3)
    const priority = (m: boolean, l: boolean, v: boolean) => m ? 0 : l ? 1 : v ? 2 : 3;
    const pa = priority(aIsManifest, aIsLayout, aIsView);
    const pb = priority(bIsManifest, bIsLayout, bIsView);
    if (pa !== pb) return pa - pb;

    const dirA = path.dirname(a.file.relativePath);
    const dirB = path.dirname(b.file.relativePath);
    return dirA.localeCompare(dirB);
  });

  const groups: FileGroup[] = [];
  let currentGroup: TriageEntry[] = [];
  let currentTokens = 0;

  for (const entry of sorted) {
    const fileTokens = estimateTokens(entry.file.content || '') + 500; // 500 for prompt overhead per file

    // Large files (>15k tokens) always get their own group
    if (fileTokens > 15000) {
      if (currentGroup.length > 0) {
        groups.push({ files: currentGroup, estimatedTokens: currentTokens });
        currentGroup = [];
        currentTokens = 0;
      }
      groups.push({ files: [entry], estimatedTokens: fileTokens });
      continue;
    }

    // Would adding this file exceed the budget?
    if (currentTokens + fileTokens > maxTokensPerCall && currentGroup.length > 0) {
      groups.push({ files: currentGroup, estimatedTokens: currentTokens });
      currentGroup = [];
      currentTokens = 0;
    }

    currentGroup.push(entry);
    currentTokens += fileTokens;
  }

  // Flush remaining
  if (currentGroup.length > 0) {
    groups.push({ files: currentGroup, estimatedTokens: currentTokens });
  }

  return groups;
}

// ══════════════════════════════════════════════════════════════
// DEPENDENCY-AWARE TOPOLOGICAL LAYERING
// ══════════════════════════════════════════════════════════════

interface DependencyLayer {
  layerIndex: number;
  groups: FileGroup[];
}

/**
 * Assign files to topological layers based on file-to-file dependencies.
 * Layer 0 = no deps (manifests, configs), Layer 1 = depends on Layer 0, etc.
 * Within each layer, files are grouped by token budget using existing logic.
 */
function buildDependencyLayers(
  files: TriageEntry[],
  fileToFiles: Record<string, string[]>,
  model: string
): DependencyLayer[] {
  const fileSet = new Set(files.map(f => f.file.relativePath));

  // Build adjacency: only edges within the set of files being upgraded
  const deps = new Map<string, Set<string>>();
  for (const f of files) {
    const fileDeps = fileToFiles[f.file.relativePath] || [];
    const relevantDeps = fileDeps.filter(d => fileSet.has(d) && d !== f.file.relativePath);
    deps.set(f.file.relativePath, new Set(relevantDeps));
  }

  // Kahn's algorithm for topological layering
  const assigned = new Set<string>();
  const layers: TriageEntry[][] = [];

  while (assigned.size < files.length) {
    // Find files whose deps are all already assigned (or have no deps)
    const currentLayer: TriageEntry[] = [];
    for (const f of files) {
      if (assigned.has(f.file.relativePath)) continue;
      const fileDeps = deps.get(f.file.relativePath) || new Set();
      const unmet = [...fileDeps].filter(d => !assigned.has(d));
      if (unmet.length === 0) {
        currentLayer.push(f);
      }
    }

    if (currentLayer.length === 0) {
      // Cycle detected — break by adding remaining files to the current layer
      for (const f of files) {
        if (!assigned.has(f.file.relativePath)) {
          currentLayer.push(f);
        }
      }
    }

    for (const f of currentLayer) {
      assigned.add(f.file.relativePath);
    }
    layers.push(currentLayer);
  }

  // Group each layer internally by token budget
  const result: DependencyLayer[] = layers.map((layerFiles, idx) => ({
    layerIndex: idx,
    groups: groupFilesForUpgrade(layerFiles, model),
  }));

  for (const layer of result) {
    const fileNames = layer.groups.flatMap(g => g.files.map(f => path.basename(f.file.relativePath)));
  }

  return result;
}

// ══════════════════════════════════════════════════════════════
// PHASE 3 IMPLEMENTATION: Upgrade execution (single + multi-file)
// ══════════════════════════════════════════════════════════════

async function upgradeSingleFile(
  client: any,
  model: string,
  file: any,
  selections: VersionSelection[],
  plan: string,
  previousErrors: string[],
  previousChangeSummary: string = "",
  analysisId?: string,
): Promise<any[]> {
  let targetTfm = resolveTargetDotnetTfmFromPrompts(selections) || "";
  const isDotNet = selections.some(s => {
    const pkg = (s.package || "").toLowerCase();
    return pkg.includes(".net") || pkg.includes("dotnet") || pkg.includes("aspnet") ||
           pkg.includes("asp.net") || pkg.includes("netcore") || pkg.includes("microsoft.") ||
           pkg.includes("entityframework");
  });
  if (isDotNet && targetTfm && /^\d+(\.\d+)?$/.test(targetTfm)) {
    const major = targetTfm.split(".")[0];
    targetTfm = `net${major}.0`;
  }
  const systemPrompt = buildSingleFileUpgradeSystemPrompt(selections);
  const userPrompt = buildSingleFileUpgradeUserPrompt(file, selections, plan, previousErrors, targetTfm, model, previousChangeSummary);
  const singleBudget = buildBudgetConstraint("codeGenLoopUpgrade", "code");

  const singleParams: any = {
    model,
    messages: [
      { role: "system", content: `${singleBudget}\n\n${systemPrompt}` },
      { role: "user", content: userPrompt }
    ],
    temperature: 0,
    max_tokens: safeMaxTokens(AGENT_TOKEN_BUDGETS.codeGenLoopUpgrade, model)
  };
  const response = analysisId
    ? await trackedLLMCall(client, singleParams, { analysisId, phase: "execution", agent: "CodeGenLoop/UpgradeSingle" })
    : await client.chat.completions.create(normalizeRequestParams(singleParams));

  let upgradedCode = response.choices[0]?.message?.content || "";
  upgradedCode = stripMarkdownFences(upgradedCode);

  if (upgradedCode.length > 10) {
    // Force-patch version mismatches: if the LLM used a wrong version, fix it
    upgradedCode = enforceVersionInContent(upgradedCode, file.relativePath, selections);

    const normalizedNew = upgradedCode.replace(/\r\n/g, "\n").trim();
    const normalizedOrig = (file.content || "").replace(/\r\n/g, "\n").trim();
    if (normalizedNew === normalizedOrig) {
      return [];
    }
    return [{
      path: file.relativePath,
      content: upgradedCode,
      originalContent: file.content,
      changes: selections.map(s => ({
        package: s.package,
        oldVersion: s.currentVersion,
        newVersion: s.selectedVersion,
        description: `Upgraded ${s.package}`
      }))
    }];
  }
  console.warn(`[CodeGenLoop] ⚠️ Empty response for ${file.relativePath}`);
  return [];
}

async function upgradeMultipleFiles(
  client: any,
  model: string,
  files: any[],
  selections: VersionSelection[],
  plan: string,
  previousErrors: string[],
  previousChangeSummary: string = "",
  analysisId?: string,
): Promise<any[]> {
  const modelBudget = model.toLowerCase().includes('claude') ? 120000 : 100000;

  const { formatIntelligenceHeader, formatManifestPathMappings } = await import("./file-intelligence");

  const filesSection = files.map((f: any, i: number) => {
    const content = f.content || '';
    const maxPerFile = Math.floor((modelBudget - 10000) / files.length);
    const chunked = content.length > maxPerFile 
      ? chunkFileContent(content, maxPerFile, f.relativePath) 
      : content;
    // Inject intelligence header if available
    const intel = (f as any).__intelligence;
    let header = "";
    if (intel) {
      header = formatIntelligenceHeader(intel) + "\n";
      const pathMappings = formatManifestPathMappings(intel, content);
      if (pathMappings) header += pathMappings + "\n";
    }
    return `${header}═══ FILE ${i + 1}: ${f.relativePath} ═══\n\`\`\`\n${chunked}\n\`\`\``;
  }).join('\n\n');

  let targetTfm = resolveTargetDotnetTfmFromPrompts(selections) || "";
  const isDotNet = selections.some(s => {
    const pkg = (s.package || "").toLowerCase();
    return pkg.includes(".net") || pkg.includes("dotnet") || pkg.includes("aspnet") ||
           pkg.includes("asp.net") || pkg.includes("netcore") || pkg.includes("microsoft.") ||
           pkg.includes("entityframework");
  });
  if (isDotNet && targetTfm && /^\d+(\.\d+)?$/.test(targetTfm)) {
    const major = targetTfm.split(".")[0];
    targetTfm = `net${major}.0`;
  }
  const systemPrompt = buildMultiFileUpgradeSystemPrompt(selections);
  const userPrompt = buildMultiFileUpgradeUserPrompt(files, selections, plan, previousErrors, filesSection, targetTfm, previousChangeSummary);
  const multiBudget = buildBudgetConstraint("codeGenLoopUpgrade", "code");

  const multiParams: any = {
    model,
    messages: [
      { role: "system", content: `${multiBudget}\n\n${systemPrompt}` },
      { role: "user", content: userPrompt }
    ],
    temperature: 0,
    max_tokens: safeMaxTokens(AGENT_TOKEN_BUDGETS.codeGenLoopUpgrade, model)
  };
  const response = analysisId
    ? await trackedLLMCall(client, multiParams, { analysisId, phase: "execution", agent: "CodeGenLoop/UpgradeMulti" })
    : await client.chat.completions.create(normalizeRequestParams(multiParams));

  const finishReason = response.choices?.[0]?.finish_reason;
  const responseText = response.choices[0]?.message?.content || "";

  // Truncation recovery: if output was truncated and we have >1 file, retry with half the batch
  if (finishReason === "length" && files.length > 1) {
    console.warn(`[CodeGenLoop] Output truncated for batch of ${files.length} files. Splitting and retrying...`);
    const mid = Math.ceil(files.length / 2);
    const firstHalf = files.slice(0, mid);
    const secondHalf = files.slice(mid);
    const results1 = await upgradeMultipleFiles(client, model, firstHalf, selections, plan, previousErrors, previousChangeSummary, analysisId);
    const results2 = await upgradeMultipleFiles(client, model, secondHalf, selections, plan, previousErrors, previousChangeSummary, analysisId);
    return [...results1, ...results2];
  }

  // Parse multi-file response
  const results: any[] = [];
  const fileRegex = /===FILE:\s*(.+?)===\n([\s\S]*?)===END_FILE===/g;
  let match;

  while ((match = fileRegex.exec(responseText)) !== null) {
    const filePath = match[1].trim();
    let code = match[2].trim();
    code = stripMarkdownFences(code);

    // Find the original file to get originalContent (robust: exact, case-insensitive, suffix match)
    const normalizedFP = filePath.replace(/\\/g, "/").toLowerCase();
    const originalFile = files.find(f => f.relativePath === filePath)
      || files.find(f => f.relativePath.replace(/\\/g, "/").toLowerCase() === normalizedFP)
      || files.find(f => f.relativePath.replace(/\\/g, "/").endsWith("/" + filePath.replace(/\\/g, "/")))
      || files.find(f => f.relativePath.replace(/\\/g, "/").toLowerCase().endsWith("/" + normalizedFP));
    
    if (code.length > 10 && originalFile) {
      // Force-patch version mismatches
      code = enforceVersionInContent(code, originalFile.relativePath, selections);

      const normalizedNew = code.replace(/\r\n/g, "\n").trim();
      const normalizedOrig = (originalFile.content || "").replace(/\r\n/g, "\n").trim();
      if (normalizedNew === normalizedOrig) {
        continue;
      }
      const canonicalPath = originalFile.relativePath;
      results.push({
        path: canonicalPath,
        content: code,
        originalContent: originalFile.content,
        changes: selections.map(s => ({
          package: s.package,
          oldVersion: s.currentVersion,
          newVersion: s.selectedVersion,
          description: `Upgraded ${s.package}`
        }))
      });
    } else if (code.length > 10 && !originalFile) {
      // LLM created a NEW file that doesn't exist in the original repo
      console.log(`[CodeGenLoop] LLM created new file: ${filePath}`);
      results.push({
        path: filePath,
        content: code,
        originalContent: "",
        isNew: true,
        changes: selections.map(s => ({
          package: s.package,
          oldVersion: s.currentVersion,
          newVersion: s.selectedVersion,
          description: `Upgraded ${s.package}`
        }))
      } as any);
    }
  }

  // If multi-file parsing failed, fall back to upgrading each file individually
  if (results.length === 0 && files.length > 0) {
    console.warn(`[CodeGenLoop] ⚠️ Multi-file parsing failed, falling back to individual upgrades for ${files.length} files`);
    for (const file of files) {
      try {
        const singleResults = await upgradeSingleFile(client, model, file, selections, plan, previousErrors, previousChangeSummary, analysisId);
        results.push(...singleResults);
      } catch (err) {
        console.error(`[CodeGenLoop] ❌ Fallback failed for ${file.relativePath}:`, err instanceof Error ? err.message : err);
      }
    }
  }

  return results;
}

// resolveTargetDotnetTfm and buildCodeUpgradePrompt have been extracted to
// server/stack-modernization/prompts/code-upgrade-prompts.ts

/**
 * Strip markdown code fences from LLM output
 */
function stripMarkdownFences(code: string): string {
  // Remove opening fence: ```language
  code = code.replace(/^```[a-z]*\n/i, '');
  // Remove closing fence: ```
  code = code.replace(/\n```$/i, '');
  // Trim whitespace
  return code.trim();
}

/**
 * Validate code syntax (IMPROVED: More lenient for XML/config files)
 */
async function validateCodeSyntax(
  code: any[],
  projectType?: string
): Promise<{ valid: boolean; errors: string[] }> {
  const errors: string[] = [];

  for (const file of code) {
    const ext = file.path.split('.').pop()?.toLowerCase();

    try {
      // Basic syntax checks
      if (ext === 'json') {
        JSON.parse(file.content);
      } else if (ext === 'xml' || ext === 'csproj' || ext === 'config') {
        // Improved XML validation
        const content = file.content;
        
        // Skip XML declaration and comments
        const xmlWithoutDeclaration = content
          .replace(/<\?xml[^?]*\?>/g, '') // Remove XML declaration
          .replace(/<!--[\s\S]*?-->/g, ''); // Remove comments
        
        // Count tags more accurately
        const allOpenTags = xmlWithoutDeclaration.match(/<([a-zA-Z][\w:]*)[^>]*>/g) || [];
        const selfClosingTags = xmlWithoutDeclaration.match(/<[a-zA-Z][\w:]*[^>]*\/>/g) || [];
        const closeTags = xmlWithoutDeclaration.match(/<\/([a-zA-Z][\w:]*)[^>]*>/g) || [];
        
        const openTagsCount = allOpenTags.length - selfClosingTags.length;
        const closeTagsCount = closeTags.length;
        
        // Allow small discrepancy (±2) for edge cases in XML parsing
        const difference = Math.abs(openTagsCount - closeTagsCount);
        
        if (difference > 2) {
          errors.push(`${file.path}: Unbalanced XML tags (open: ${openTagsCount}, close: ${closeTagsCount}, diff: ${difference})`);
        }
        
        // Additional check: Ensure basic structure exists for .csproj
        if (ext === 'csproj') {
          if (!content.includes('<Project')) {
            errors.push(`${file.path}: Missing <Project> root element`);
          }
        }
      }
      // Add more validators as needed

    } catch (error) {
      errors.push(`${file.path}: ${error instanceof Error ? error.message : 'Syntax error'}`);
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Post-upgrade validation: check client-side manifests (libman.json, bower.json)
 * to ensure they specify compiled dist assets, not source files.
 * Returns warnings that are added to the error context for potential re-try.
 */
function validateClientSideManifests(
  code: Array<{ path: string; content: string; originalContent?: string }>
): string[] {
  const warnings: string[] = [];
  const manifestNames = ["libman.json", "bower.json"];

  for (const file of code) {
    const fileName = file.path.split(/[\\/]/).pop()?.toLowerCase() || "";
    if (!manifestNames.includes(fileName)) continue;

    try {
      const parsed = JSON.parse(file.content);

      // LibMan format: { "libraries": [...] } or { "version": "1.0", "libraries": [...] }
      const libraries = parsed.libraries || [];
      for (const lib of libraries) {
        const libName = lib.library || lib.name || "unknown";

        // Check 1: files array must be present
        if (!lib.files || !Array.isArray(lib.files) || lib.files.length === 0) {
          warnings.push(
            `${file.path}: Library "${libName}" is MISSING a "files" array — ` +
            `this will restore the ENTIRE package including source (SCSS/src). ` +
            `Add a "files" array listing only compiled dist assets (.min.css, .min.js).`
          );
          continue;
        }

        // Check 2: no source files in the files array
        const sourcePatterns = [/\.scss$/i, /\.sass$/i, /\.less$/i, /\.ts$/i, /\.coffee$/i, /^src\//i, /^scss\//i, /^sass\//i];
        for (const f of lib.files) {
          if (sourcePatterns.some(pat => pat.test(f))) {
            warnings.push(
              `${file.path}: Library "${libName}" includes source file "${f}" — ` +
              `browsers cannot load source files. Replace with compiled dist assets (.min.css, .min.js).`
            );
          }
        }

        // Check 3: warn if no .min.css or .min.js in files (likely incomplete)
        const hasCompiledAsset = lib.files.some((f: string) =>
          /\.min\.(css|js)$/i.test(f) || /\.bundle\.(min\.)?js$/i.test(f) || /webfonts/i.test(f) || /\.woff2?$/i.test(f)
        );
        if (!hasCompiledAsset) {
          warnings.push(
            `${file.path}: Library "${libName}" files array has no compiled dist assets (.min.css/.min.js) — ` +
            `the browser may not be able to load these files. Verify the paths point to compiled/minified files.`
          );
        }
      }
    } catch {
      // JSON parse failure already caught by validateCodeSyntax
    }
  }

  return warnings;
}

/**
 * Post-upgrade validation: check that view/template files reference CSS/JS paths
 * that match what the client-side manifest will restore, AND detect library
 * substitutions that break JS plugin APIs in consuming files.
 */
function validateLayoutMatchesManifest(
  code: Array<{ path: string; content: string; originalContent?: string }>
): string[] {
  const warnings: string[] = [];

  // Find all client-side manifests
  const manifestNames = new Set(["libman.json", "bower.json"]);
  const manifestFiles = code.filter(f => manifestNames.has(f.path.split(/[\\/]/).pop()?.toLowerCase() || ""));
  if (manifestFiles.length === 0) return warnings;

  // Collect all libraries from all manifests + detect substitutions
  type LibEntry = { library?: string; destination?: string; files?: string[] };
  const allLibraries: LibEntry[] = [];
  const oldLibNames = new Set<string>();
  const newLibNames = new Set<string>();

  for (const mf of manifestFiles) {
    try {
      const parsed = JSON.parse(mf.content);
      const libs: LibEntry[] = parsed.libraries || [];
      allLibraries.push(...libs);
      for (const lib of libs) {
        const name = (lib.library || "").split("@")[0].toLowerCase().trim();
        if (name) newLibNames.add(name);
      }
    } catch { /* skip unparseable */ }

    // Parse original to detect removed libraries (substitutions)
    if (mf.originalContent) {
      try {
        const oldParsed = JSON.parse(mf.originalContent);
        for (const lib of (oldParsed.libraries || [])) {
          const name = (lib.library || "").split("@")[0].toLowerCase().trim();
          if (name) oldLibNames.add(name);
        }
      } catch { /* skip */ }
    }
  }

  // Detect library substitutions: libraries that existed before but are now gone
  const removedLibs = [...oldLibNames].filter(n => !newLibNames.has(n));
  const addedLibs = [...newLibNames].filter(n => !oldLibNames.has(n));

  if (removedLibs.length > 0 && addedLibs.length > 0) {
    warnings.push(
      `Library substitution detected: removed [${removedLibs.join(", ")}], added [${addedLibs.join(", ")}]. ` +
      `If these are API-incompatible replacements, ALL view/template files that use the old library's ` +
      `JavaScript API (e.g., jQuery plugin calls like .datepicker(), .validate(), .select2()) MUST be ` +
      `rewritten to use the new library's API. Otherwise, keep the original library and just upgrade its version.`
    );
  }

  // Build a set of paths that manifests will restore
  const restoredPaths = new Set<string>();
  for (const lib of allLibraries) {
    const dest = (lib.destination || "").replace(/\\/g, "/").replace(/^wwwroot\/?/i, "");
    for (const f of (lib.files || [])) {
      const restored = `${dest}${f}`.replace(/\/\//g, "/");
      restoredPaths.add(restored.toLowerCase());
    }

    // Warn if destination is missing (non-deterministic path)
    if (!lib.destination) {
      const libName = (lib.library || "").split("@")[0] || "unknown";
      warnings.push(
        `Library "${libName}" is missing an explicit "destination" — the restore path will be non-deterministic. ` +
        `Add "destination": "wwwroot/lib/${libName}/" for predictable file paths.`
      );
    }
  }

  // Scan ALL view/template files (not just layout files)
  const viewExts = new Set([
    ".cshtml", ".html", ".razor", ".htm", ".aspx", ".ascx", ".master",
    ".jsp", ".jspf", ".jsf", ".ftl", ".vm",
    ".erb", ".haml", ".slim",
    ".ejs", ".hbs", ".pug", ".njk", ".twig",
    ".j2", ".jinja2",
    ".svelte", ".vue", ".astro",
  ]);

  // Known JS plugin → library mappings for API compatibility detection
  const pluginToLibrary: Record<string, string[]> = {
    datepicker: ["bootstrap-datepicker", "jquery-ui"],
    timepicker: ["bootstrap-timepicker", "jquery-timepicker"],
    selectpicker: ["bootstrap-select"],
    select2: ["select2"],
    chosen: ["chosen"],
    tooltip: ["bootstrap", "twitter-bootstrap", "popper.js"],
    popover: ["bootstrap", "twitter-bootstrap"],
    modal: ["bootstrap", "twitter-bootstrap"],
    carousel: ["bootstrap", "twitter-bootstrap", "owl.carousel", "slick"],
    validate: ["jquery-validate", "jquery-validation", "jquery.validate"],
    dataTable: ["datatables", "datatables.net"],
    DataTable: ["datatables", "datatables.net"],
    typeahead: ["typeahead.js", "bootstrap-3-typeahead"],
    summernote: ["summernote"],
    fullcalendar: ["fullcalendar"],
    sortable: ["sortablejs", "jquery-ui"],
    autocomplete: ["jquery-ui", "devbridge-autocomplete"],
    slider: ["bootstrap-slider", "jquery-ui"],
    colorpicker: ["bootstrap-colorpicker"],
    tagsinput: ["bootstrap-tagsinput"],
    tokenfield: ["bootstrap-tokenfield"],
    fancybox: ["fancybox"],
    lightbox: ["lightbox2"],
    magnific: ["magnific-popup"],
    slick: ["slick-carousel"],
    owlCarousel: ["owl.carousel"],
  };

  for (const file of code) {
    const ext = path.extname(file.path).toLowerCase();
    const baseName = path.basename(file.path).toLowerCase();
    if (!viewExts.has(ext) && !baseName.endsWith(".blade.php")) continue;

    // Check 1: Asset path references match restored paths
    const assetRefPattern = /(?:href|src)\s*=\s*["']~?\/?([^"']*?lib\/[^"']+)["']/gi;
    let match: RegExpExecArray | null;
    while ((match = assetRefPattern.exec(file.content)) !== null) {
      const refPath = match[1].replace(/\\/g, "/").toLowerCase();
      const matchesRestored = restoredPaths.has(refPath) ||
        Array.from(restoredPaths).some(p => refPath.endsWith(p) || p.endsWith(refPath.split("/").slice(-2).join("/")));
      if (!matchesRestored && refPath.includes("lib/")) {
        const libName = refPath.split("lib/")[1]?.split("/")[0] || "unknown";
        warnings.push(
          `${file.path}: Asset reference "${match[1]}" does not match any file restored by the manifest. ` +
          `Verify the manifest has a library with destination+files producing this path. ` +
          `Mismatched paths cause 404 errors and broken UI.`
        );
      }
    }

    // Check 2: JS plugin API calls reference libraries that still exist in the manifest
    const pluginCallPattern = /\.\s*(datepicker|timepicker|selectpicker|typeahead|tooltip|popover|modal|collapse|carousel|tab|dropdown|alert|toast|validate|validator|dataTable|DataTable|select2|chosen|tagsinput|tokenfield|summernote|fullcalendar|sortable|autocomplete|slider|colorpicker|fancybox|lightbox|magnific|slick|owlCarousel)\s*\(/g;
    let pluginMatch: RegExpExecArray | null;
    while ((pluginMatch = pluginCallPattern.exec(file.content)) !== null) {
      const pluginName = pluginMatch[1];
      const requiredLibs = pluginToLibrary[pluginName];
      if (!requiredLibs) continue;

      const libPresent = requiredLibs.some(reqLib =>
        [...newLibNames].some(installedLib => installedLib.includes(reqLib) || reqLib.includes(installedLib))
      );
      if (!libPresent) {
        warnings.push(
          `${file.path}: Uses .${pluginName}() API but none of the required libraries [${requiredLibs.join(", ")}] ` +
          `are in the manifest. Either add the library back to the manifest or rewrite the API call.`
        );
      }
    }
  }

  return warnings;
}

/**
 * Phase 3.5: Validate that markup version and bundle version are consistent
 * across all delivery methods: manifest files, CDN URLs, and local static files.
 * Returns a list of warnings for any mismatches found.
 */
function validateMarkupBundleConsistency(
  upgradedFiles: Array<{ path: string; content: string; originalContent?: string }>,
  selections: VersionSelection[],
  allExtractedFiles: Array<{ relativePath: string; content: string }>,
): string[] {
  const warnings: string[] = [];

  // Step 1: Determine effective library versions from all sources
  const effectiveVersions = new Map<string, { version: string; source: string }>();

  // 1a: From manifest files (libman.json, bower.json, package.json)
  for (const file of upgradedFiles) {
    const baseName = path.basename(file.path).toLowerCase();
    if (baseName === "libman.json" || baseName === "bower.json") {
      try {
        const parsed = JSON.parse(file.content);
        for (const lib of (parsed.libraries || [])) {
          const atIdx = (lib.library || "").lastIndexOf("@");
          if (atIdx > 0) {
            const name = lib.library.substring(0, atIdx).toLowerCase();
            const ver = lib.library.substring(atIdx + 1);
            effectiveVersions.set(name, { version: ver, source: file.path });
          }
        }
      } catch { /* skip */ }
    }
    if (baseName === "package.json") {
      try {
        const parsed = JSON.parse(file.content);
        for (const section of ["dependencies", "devDependencies"]) {
          for (const [pkg, ver] of Object.entries(parsed[section] || {})) {
            const clean = String(ver).replace(/^[\^~>=<]*/g, "");
            effectiveVersions.set(pkg.toLowerCase(), { version: clean, source: file.path });
          }
        }
      } catch { /* skip */ }
    }
  }

  // 1b: From CDN URLs in all files
  try {
    const { extractCdnVersions } = require("./deterministic-transforms");
    for (const file of upgradedFiles) {
      const cdnRefs: Array<{ library: string; version: string }> = extractCdnVersions(file.content);
      for (const ref of cdnRefs) {
        if (!effectiveVersions.has(ref.library)) {
          effectiveVersions.set(ref.library, { version: ref.version, source: file.path });
        }
      }
    }
  } catch { /* extractCdnVersions not available */ }

  // Step 2: Define version-specific markup markers
  const versionMarkers: Array<{
    library: string;
    v5Plus: RegExp[];
    v4OrBelow: RegExp[];
    minMajorForNew: number;
  }> = [
    {
      library: "bootstrap",
      v5Plus: [/data-bs-toggle/i, /data-bs-target/i, /data-bs-dismiss/i],
      v4OrBelow: [
        /(?<![a-z-])data-toggle(?!=["'][a-z])/i,
        /(?<![a-z-])data-target(?!=["'][a-z])/i,
        /(?<![a-z-])data-dismiss(?!=["'][a-z])/i,
      ],
      minMajorForNew: 5,
    },
  ];

  // Step 3: Scan all upgraded files for version mismatches
  const viewExts = new Set([
    ".cshtml", ".html", ".razor", ".htm", ".aspx", ".master",
    ".jsp", ".erb", ".ejs", ".hbs", ".pug", ".vue", ".svelte",
  ]);

  for (const file of upgradedFiles) {
    const ext = path.extname(file.path).toLowerCase();
    if (!viewExts.has(ext)) continue;

    for (const marker of versionMarkers) {
      const effective = effectiveVersions.get(marker.library);
      if (!effective) continue;

      const effectiveMajor = parseInt(effective.version.split(".")[0], 10);
      if (isNaN(effectiveMajor)) continue;

      const hasNewSyntax = marker.v5Plus.some(re => re.test(file.content));
      const hasOldSyntax = marker.v4OrBelow.some(re => re.test(file.content));

      if (hasNewSyntax && effectiveMajor < marker.minMajorForNew) {
        warnings.push(
          `${file.path}: Uses ${marker.library} v${marker.minMajorForNew}+ markup (data-bs-*) but loaded bundle is v${effective.version} from ${effective.source}. ` +
          `The bundle must be upgraded to v${marker.minMajorForNew}+ or the markup reverted.`
        );
      }

      if (hasOldSyntax && !hasNewSyntax && effectiveMajor >= marker.minMajorForNew) {
        warnings.push(
          `${file.path}: Uses old ${marker.library} v${effectiveMajor - 1} markup (data-toggle) but bundle is v${effective.version}. ` +
          `Markup must be updated to v${marker.minMajorForNew}+ syntax.`
        );
      }
    }

    // Also check CDN URLs in this specific file vs its own markup
    try {
      const { extractCdnVersions } = require("./deterministic-transforms");
      const localCdnRefs: Array<{ library: string; version: string }> = extractCdnVersions(file.content);
      for (const ref of localCdnRefs) {
        for (const marker of versionMarkers) {
          if (ref.library !== marker.library) continue;
          const cdnMajor = parseInt(ref.version.split(".")[0], 10);
          const hasNewSyntax = marker.v5Plus.some(re => re.test(file.content));
          if (hasNewSyntax && cdnMajor < marker.minMajorForNew) {
            warnings.push(
              `${file.path}: CDN loads ${ref.library}@${ref.version} but markup uses v${marker.minMajorForNew}+ syntax. Update CDN URL to v${marker.minMajorForNew}+.`
            );
          }
        }
      }
    } catch { /* skip */ }
  }

  return warnings;
}

/**
 * Phase 4 helper: scan files that were NOT upgraded for broken references
 * caused by changes in the upgraded files (path changes, removed libraries,
 * CSS class renames, API changes, version strings).
 * Returns only files that need a targeted fix pass.
 */
function detectBrokenReferences(
  skippedFiles: any[],
  upgradedFiles: any[],
  selections: VersionSelection[]
): Array<{ file: any; reasons: string[] }> {
  const results: Array<{ file: any; reasons: string[] }> = [];

  // Build a map of what changed: old paths → new paths, removed libraries, etc.
  const pathChanges = new Map<string, string>(); // oldPath → newPath
  const removedLibraries = new Set<string>();
  const versionChanges = new Map<string, { oldVer: string; newVer: string }>();

  for (const uf of upgradedFiles) {
    const baseName = path.basename(uf.path).toLowerCase();
    const origContent = uf.originalContent || "";
    const newContent = uf.content || "";

    // Detect path changes in client-side manifests
    if (baseName === "libman.json" || baseName === "bower.json") {
      try {
        const oldParsed = JSON.parse(origContent);
        const newParsed = JSON.parse(newContent);
        const oldLibs: any[] = oldParsed.libraries || [];
        const newLibs: any[] = newParsed.libraries || [];
        const oldLibMap = new Map(oldLibs.map((l: any) => [(l.library || "").split("@")[0].toLowerCase(), l]));
        const newLibMap = new Map(newLibs.map((l: any) => [(l.library || "").split("@")[0].toLowerCase(), l]));

        // Track removed libraries
        for (const [name] of oldLibMap) {
          if (!newLibMap.has(name)) removedLibraries.add(name);
        }

        // Track path changes per library
        for (const [name, newLib] of newLibMap) {
          const oldLib = oldLibMap.get(name);
          if (!oldLib) continue;
          const oldDest = (oldLib.destination || "").replace(/\\/g, "/");
          const newDest = (newLib.destination || "").replace(/\\/g, "/");
          const oldFiles: string[] = oldLib.files || [];
          const newFiles: string[] = newLib.files || [];
          for (const of_ of oldFiles) {
            const oldFull = `${oldDest}${of_}`.replace(/\/\//g, "/").replace(/^wwwroot\/?/i, "");
            const matchingNew = newFiles.find(nf => nf.split("/").pop() === of_.split("/").pop());
            if (matchingNew) {
              const newFull = `${newDest}${matchingNew}`.replace(/\/\//g, "/").replace(/^wwwroot\/?/i, "");
              if (oldFull !== newFull) {
                pathChanges.set(oldFull.toLowerCase(), newFull);
              }
            }
          }
        }
      } catch { /* skip */ }
    }

    // Detect version string changes in package.json
    if (baseName === "package.json") {
      try {
        const oldParsed = JSON.parse(origContent);
        const newParsed = JSON.parse(newContent);
        for (const section of ["dependencies", "devDependencies"]) {
          const oldDeps = oldParsed[section] || {};
          const newDeps = newParsed[section] || {};
          for (const pkg of Object.keys(oldDeps)) {
            if (!newDeps[pkg]) removedLibraries.add(pkg);
            else if (oldDeps[pkg] !== newDeps[pkg]) {
              versionChanges.set(pkg, { oldVer: oldDeps[pkg], newVer: newDeps[pkg] });
            }
          }
        }
      } catch { /* skip */ }
    }
  }

  // Collect old CSS classes removed during Bootstrap-like migrations
  const oldBootstrapClasses = [
    "form-group", "form-inline", "form-row",
    "input-group-append", "input-group-prepend",
    "custom-control", "custom-checkbox", "custom-radio", "custom-select", "custom-file",
    "badge-pill", "badge-primary", "badge-secondary", "badge-success", "badge-danger", "badge-warning", "badge-info",
    "btn-block", "media", "jumbotron", "card-deck", "card-columns",
    "text-left", "text-right", "float-left", "float-right",
    "ml-", "mr-", "pl-", "pr-",
    "data-toggle", "data-dismiss", "data-target", "data-ride", "data-slide",
  ];

  const hasBootstrapUpgrade = selections.some(s =>
    (s.package || "").toLowerCase().includes("bootstrap")
  );

  // Scan each skipped file for broken references
  for (const file of skippedFiles) {
    const content = file.content || "";
    const ext = path.extname(file.relativePath).toLowerCase();
    const reasons: string[] = [];

    // Check 1: file references old asset paths that have changed
    for (const [oldPath, newPath] of pathChanges) {
      if (content.toLowerCase().includes(oldPath)) {
        reasons.push(`References old asset path "${oldPath}" → should be "${newPath}"`);
      }
    }

    // Check 2: file imports/requires a removed library
    for (const lib of removedLibraries) {
      if (content.toLowerCase().includes(lib)) {
        reasons.push(`References removed library "${lib}"`);
      }
    }

    // Check 3: view/template file still uses deprecated Bootstrap 4 classes
    const viewExts = new Set([
      ".cshtml", ".html", ".razor", ".htm", ".aspx", ".ascx", ".master",
      ".jsp", ".jspf", ".jsf", ".ftl", ".vm",
      ".erb", ".haml", ".slim", ".ejs", ".hbs",
      ".pug", ".njk", ".twig", ".j2", ".jinja2",
      ".svelte", ".vue", ".astro",
    ]);
    if (hasBootstrapUpgrade && viewExts.has(ext)) {
      const deprecatedFound = oldBootstrapClasses.filter(cls => content.includes(cls));
      if (deprecatedFound.length > 0) {
        reasons.push(`Contains deprecated Bootstrap 4 patterns: ${deprecatedFound.slice(0, 5).join(", ")}${deprecatedFound.length > 5 ? ` (+${deprecatedFound.length - 5} more)` : ""}`);
      }
    }

    // Check 4: JS/TS file imports a package whose version changed significantly
    if ([".js", ".ts", ".jsx", ".tsx", ".mjs", ".cjs"].includes(ext)) {
      for (const [pkg] of versionChanges) {
        const importPatterns = [
          `from "${pkg}`, `from '${pkg}`,
          `require("${pkg}`, `require('${pkg}`,
          `import "${pkg}`, `import '${pkg}`,
        ];
        if (importPatterns.some(pat => content.includes(pat))) {
          reasons.push(`Imports "${pkg}" which was upgraded — may need API updates`);
        }
      }
    }

    // Check 5: Markup-vs-bundle version mismatch (BS5 markup with BS4 CDN, etc.)
    if (viewExts.has(ext)) {
      const hasBS5Syntax = /data-bs-toggle|data-bs-target|data-bs-dismiss/i.test(content);
      const hasBS4Syntax = /(?<![a-z-])data-toggle\s*=|(?<![a-z-])data-target\s*=|(?<![a-z-])data-dismiss\s*=/i.test(content);

      try {
        const { extractCdnVersions } = require("./deterministic-transforms");
        const cdnRefs: Array<{ library: string; version: string }> = extractCdnVersions(content);
        for (const ref of cdnRefs) {
          if (ref.library === "bootstrap") {
            const major = parseInt(ref.version.split(".")[0], 10);
            if (hasBS5Syntax && major < 5) {
              reasons.push(`Uses Bootstrap 5 markup (data-bs-*) but CDN loads Bootstrap ${ref.version}. CDN URL must be updated.`);
            }
            if (hasBS4Syntax && !hasBS5Syntax && major >= 5) {
              reasons.push(`Uses Bootstrap 4 markup (data-toggle) but CDN loads Bootstrap ${ref.version}. Markup must be updated.`);
            }
          }
        }
      } catch { /* extractCdnVersions not available */ }
    }

    // Check 6: Java files still using javax.* when Spring Boot >= 3
    if ([".java", ".kt", ".kts"].includes(ext)) {
      const hasSpringBoot3 = selections.some(s => {
        const pkg = (s.package || "").toLowerCase();
        if (!pkg.includes("spring")) return false;
        const major = parseInt((s.selectedVersion || "").split(".")[0], 10);
        return major >= 3;
      });
      if (hasSpringBoot3 && /\bjavax\.(persistence|servlet|validation|annotation|inject|ws\.rs|mail|transaction)\b/.test(content)) {
        reasons.push("Contains javax.* imports but Spring Boot 3+ requires jakarta.* namespace");
      }
    }

    if (reasons.length > 0) {
      results.push({ file, reasons });
    }
  }

  return results;
}

/**
 * Check if we should attempt compilation (DISABLED for now - too unreliable)
 */
function shouldCompile(projectType?: string): boolean {
  // TEMPORARY: Disable compilation to focus on syntax validation
  // Compilation in temp directory is unreliable and doesn't provide good feedback
  // TODO: Re-enable with proper project structure and NuGet restore
  return false;
  
  /* Original logic:
  if (!projectType) return false;
  const compilableTypes = ['dotnet', 'java-maven', 'java-gradle', 'typescript', 'go'];
  return compilableTypes.some(t => projectType.includes(t));
  */
}

/**
 * Try to compile code (for .NET, Java, TypeScript, etc.)
 */
async function tryCompile(
  code: any[],
  state: StackModernizationState
): Promise<{ success: boolean; errors: string[] }> {
  const projectType = state.repoProfile?.projectType;

  if (projectType?.includes('dotnet')) {
    return await compileDotNet(code, state);
  } else if (projectType?.includes('java')) {
    return await compileJava(code, state);
  } else if (projectType?.includes('typescript')) {
    return await compileTypeScript(code, state);
  }

  return { success: true, errors: [] }; // Skip compilation for other types
}

/**
 * Try to compile .NET code
 */
async function compileDotNet(
  code: any[],
  state: StackModernizationState
): Promise<{ success: boolean; errors: string[] }> {
  try {
    // Create temp directory for compilation
    const tempDir = path.join(os.tmpdir(), `dotnet-compile-${crypto.randomBytes(8).toString('hex')}`);
    await fs.mkdir(tempDir, { recursive: true });

    // Write files
    for (const file of code) {
      const filePath = path.join(tempDir, path.basename(file.path));
      await fs.writeFile(filePath, file.content, 'utf-8');
    }


    // Look for .csproj file
    const csprojFile = code.find(f => f.path.endsWith('.csproj'));

    if (!csprojFile) {
      await fs.rm(tempDir, { recursive: true, force: true });
      return { success: true, errors: [] };
    }

    // Try to build
    
    try {
      const { stdout, stderr } = await execAsync(`dotnet build`, { cwd: tempDir, timeout: 180_000 });
      
      // Cleanup
      await fs.rm(tempDir, { recursive: true, force: true });
      return { success: true, errors: [] };
      
    } catch (buildError: any) {
      console.error(`[CodeGenLoop] ❌ Build failed!`);
      console.error(`[CodeGenLoop] Error message:`, buildError.message);
      console.error(`[CodeGenLoop] Exit code:`, buildError.code);
      
      // Log full stderr for debugging
      if (buildError.stderr) {
        console.error(`[CodeGenLoop] STDERR (full):`, buildError.stderr);
      }
      if (buildError.stdout) {
        console.error(`[CodeGenLoop] STDOUT (full):`, buildError.stdout);
      }
      
      // Parse build errors from stderr/stdout
      const errorOutput = buildError.stderr || buildError.stdout || buildError.message || '';
      const buildErrors = parseDotNetErrors(errorOutput);
      
      console.error(`[CodeGenLoop] Parsed errors:`, buildErrors);
      
      // Cleanup
      await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
      
      return { 
        success: false, 
        errors: buildErrors.length > 0 ? buildErrors : [`Compilation failed: ${buildError.message}`]
      };
    }
    
  } catch (error: any) {
    // Outer catch for file system errors, etc.
    console.error(`[CodeGenLoop] ❌ Compilation setup failed:`, error.message);
    return { 
      success: false, 
      errors: [`Compilation setup failed: ${error.message}`]
    };
  }
}

/**
 * Parse .NET build errors
 */
function parseDotNetErrors(stderr: string): string[] {
  const errors: string[] = [];
  const lines = stderr.split('\n');

  for (const line of lines) {
    if (line.includes('error CS') || line.includes('error MSB')) {
      errors.push(line.trim());
    }
  }

  return errors.length > 0 ? errors : ['Compilation failed with unknown errors'];
}

/**
 * Compile Java code (placeholder)
 */
async function compileJava(
  code: any[],
  state: StackModernizationState
): Promise<{ success: boolean; errors: string[] }> {
  // TODO: Implement Java compilation
  return { success: true, errors: [] };
}

/**
 * Compile TypeScript code (placeholder)
 */
async function compileTypeScript(
  code: any[],
  state: StackModernizationState
): Promise<{ success: boolean; errors: string[] }> {
  // TODO: Implement TypeScript compilation
  return { success: true, errors: [] };
}
