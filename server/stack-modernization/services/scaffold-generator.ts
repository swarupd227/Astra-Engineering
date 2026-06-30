/**
 * Scaffold Generator Service
 *
 * Handles STRUCTURAL changes during major version upgrades that go beyond
 * modifying existing files — i.e., creating NEW files and marking OLD files
 * for deletion. This is critical for major version jumps like:
 *   - .NET Framework → .NET 10 (SDK-style .csproj, minimal hosting, appsettings.json)
 *   - Python 2 → Python 3 (pyproject.toml, setup.cfg)
 *   - Java 8 → Java 17+ (module-info.java, jakarta namespace)
 *   - Angular major upgrades (new angular.json format)
 *   - Express 3 → Express 5 (new middleware pattern)
 *   - Rails 4 → Rails 7 (credentials, Zeitwerk, new defaults)
 *
 * Returns:
 *   - newFiles: files to CREATE (path + content)
 *   - obsoleteFiles: files to mark for deletion
 *   - structuralWarnings: human-readable warnings about manual steps needed
 */

import type { VersionSelection, ExtractedFile, ModifiedFile } from "../types";

// ═══════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════

export interface ScaffoldFile {
  path: string;
  content: string;
  reason: string;
}

export interface ScaffoldResult {
  newFiles: ScaffoldFile[];
  obsoleteFiles: Array<{ path: string; reason: string }>;
  structuralWarnings: string[];
  structuralChangesMarkdown: string;
}

// ═══════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════

function fileExists(files: ExtractedFile[], pattern: RegExp): ExtractedFile | undefined {
  return files.find(f => pattern.test(f.relativePath.replace(/\\/g, "/")));
}

function fileExistsExact(files: ExtractedFile[], name: string): ExtractedFile | undefined {
  const lower = name.toLowerCase();
  return files.find(f => f.relativePath.replace(/\\/g, "/").toLowerCase().endsWith(lower));
}

function alreadyModified(modifiedFiles: ModifiedFile[], pattern: RegExp): boolean {
  return modifiedFiles.some(f => pattern.test(f.path.replace(/\\/g, "/")));
}

function getTargetMajor(selections: VersionSelection[], ...pkgNames: string[]): number | null {
  for (const sel of selections) {
    const lower = sel.package.toLowerCase();
    for (const name of pkgNames) {
      if (lower.includes(name.toLowerCase())) {
        const major = parseInt(sel.selectedVersion.split(".")[0], 10);
        return isNaN(major) ? null : major;
      }
    }
  }
  return null;
}

function getCurrentMajor(selections: VersionSelection[], ...pkgNames: string[]): number | null {
  for (const sel of selections) {
    const lower = sel.package.toLowerCase();
    for (const name of pkgNames) {
      if (lower.includes(name.toLowerCase())) {
        const major = parseInt(sel.currentVersion.split(".")[0], 10);
        return isNaN(major) ? null : major;
      }
    }
  }
  return null;
}

// ═══════════════════════════════════════════════════════════════
// .NET Scaffolding
// ═══════════════════════════════════════════════════════════════

function scaffoldDotNet(
  selections: VersionSelection[],
  extractedFiles: ExtractedFile[],
  modifiedFiles: ModifiedFile[],
): Partial<ScaffoldResult> {
  const targetMajor = getTargetMajor(selections, ".net", "dotnet");
  const currentMajor = getCurrentMajor(selections, ".net", "dotnet");
  if (targetMajor == null) return { newFiles: [], obsoleteFiles: [], structuralWarnings: [] };

  const newFiles: ScaffoldFile[] = [];
  const obsoleteFiles: Array<{ path: string; reason: string }> = [];
  const warnings: string[] = [];
  const targetTfm = `net${targetMajor}.0`;

  // 1. Check for old-style .csproj and warn (too complex for auto-conversion)
  const csprojFiles = extractedFiles.filter(f => f.relativePath.endsWith(".csproj"));
  for (const csproj of csprojFiles) {
    if (csproj.content.includes('ToolsVersion=') && !csproj.content.includes('Sdk=')) {
      warnings.push(
        `⚠️ ${csproj.relativePath}: Old-style .csproj format detected (ToolsVersion). ` +
        `This needs manual conversion to SDK-style format (<Project Sdk="Microsoft.NET.Sdk.Web">). ` +
        `The auto-upgrade will update versions but cannot restructure the XML format.`
      );
    }
  }

  // 2. appsettings.json — create if missing and target >= 3
  if (targetMajor >= 3) {
    const hasAppSettings = fileExists(extractedFiles, /appsettings\.json$/i);
    if (!hasAppSettings) {
      const hasWebConfig = fileExists(extractedFiles, /web\.config$/i);
      newFiles.push({
        path: "appsettings.json",
        content: JSON.stringify({
          Logging: {
            LogLevel: {
              Default: "Information",
              "Microsoft.AspNetCore": "Warning",
            },
          },
          AllowedHosts: "*",
        }, null, 2),
        reason: "ASP.NET Core requires appsettings.json for configuration" +
          (hasWebConfig ? " (migrating from web.config)" : ""),
      });
      newFiles.push({
        path: "appsettings.Development.json",
        content: JSON.stringify({
          Logging: {
            LogLevel: {
              Default: "Information",
              "Microsoft.AspNetCore": "Warning",
            },
          },
        }, null, 2),
        reason: "Development-specific configuration for ASP.NET Core",
      });
    }
  }

  // 3. _ViewImports.cshtml — create if missing and project has .cshtml files
  if (targetMajor >= 3) {
    const hasCshtml = extractedFiles.some(f => f.relativePath.endsWith(".cshtml") && !f.relativePath.includes("_ViewImports"));
    const hasViewImports = fileExists(extractedFiles, /_ViewImports\.cshtml$/i);
    if (hasCshtml && !hasViewImports) {
      // Detect namespace from .csproj RootNamespace or directory name
      const rootNs = detectRootNamespace(extractedFiles);
      newFiles.push({
        path: "Views/_ViewImports.cshtml",
        content: [
          `@using ${rootNs}`,
          `@using ${rootNs}.Models`,
          `@addTagHelper *, Microsoft.AspNetCore.Mvc.TagHelpers`,
        ].join("\n") + "\n",
        reason: "ASP.NET Core MVC requires _ViewImports.cshtml for tag helpers and shared using directives",
      });
    }
  }

  // 4. _ViewStart.cshtml — create if missing
  if (targetMajor >= 3) {
    const hasCshtml = extractedFiles.some(f => f.relativePath.endsWith(".cshtml"));
    const hasViewStart = fileExists(extractedFiles, /_ViewStart\.cshtml$/i);
    if (hasCshtml && !hasViewStart) {
      newFiles.push({
        path: "Views/_ViewStart.cshtml",
        content: `@{\n    Layout = "_Layout";\n}\n`,
        reason: "ASP.NET Core MVC uses _ViewStart.cshtml to set the default layout",
      });
    }
  }

  // 5. Global usings file for .NET 6+
  if (targetMajor >= 6) {
    const hasGlobalUsings = fileExists(extractedFiles, /GlobalUsings\.cs$/i) ||
      fileExists(extractedFiles, /Usings\.cs$/i);
    if (!hasGlobalUsings) {
      newFiles.push({
        path: "GlobalUsings.cs",
        content: [
          "// Global using directives (auto-generated for .NET " + targetMajor + ")",
          "global using System;",
          "global using System.Collections.Generic;",
          "global using System.Linq;",
          "global using System.Threading.Tasks;",
          "global using Microsoft.AspNetCore.Mvc;",
          "global using Microsoft.Extensions.Logging;",
          "",
        ].join("\n"),
        reason: `.NET ${targetMajor} supports global usings to reduce per-file boilerplate`,
      });
    }
  }

  // 6. Mark Global.asax for deletion if target >= 3
  if (targetMajor >= 3) {
    const globalAsax = fileExists(extractedFiles, /Global\.asax(\.cs)?$/i);
    if (globalAsax) {
      obsoleteFiles.push({
        path: globalAsax.relativePath,
        reason: "Global.asax is not used in ASP.NET Core — lifecycle logic should be in Program.cs middleware pipeline",
      });
      warnings.push(
        `⚠️ ${globalAsax.relativePath}: Application_Start, Application_End, and other lifecycle events ` +
        `must be migrated to middleware in Program.cs. Review the code and move logic manually.`
      );
    }
  }

  // 7. Mark BundleConfig.cs for deletion if target >= 3
  if (targetMajor >= 3) {
    const bundleConfig = fileExists(extractedFiles, /BundleConfig\.cs$/i);
    if (bundleConfig) {
      obsoleteFiles.push({
        path: bundleConfig.relativePath,
        reason: "ASP.NET Core uses libman.json, bundleconfig.json, or npm/webpack for client-side bundling",
      });
    }
  }

  // 8. Mark Startup.cs for deletion if target >= 6 and Program.cs already exists
  if (targetMajor >= 6 && (currentMajor != null && currentMajor < 6)) {
    const hasStartup = fileExists(extractedFiles, /Startup\.cs$/i);
    const hasProgram = fileExists(extractedFiles, /Program\.cs$/i);
    if (hasStartup && hasProgram) {
      warnings.push(
        `⚠️ Startup.cs should be merged into Program.cs for .NET ${targetMajor} minimal hosting. ` +
        `The LLM code upgrade will attempt this merge, but verify the result carefully.`
      );
    }
  }

  // 9. launchSettings.json — create if missing
  if (targetMajor >= 3) {
    const hasLaunchSettings = fileExists(extractedFiles, /launchSettings\.json$/i);
    if (!hasLaunchSettings) {
      newFiles.push({
        path: "Properties/launchSettings.json",
        content: JSON.stringify({
          profiles: {
            http: {
              commandName: "Project",
              dotnetRunMessages: true,
              launchBrowser: true,
              applicationUrl: "http://localhost:5000",
              environmentVariables: { ASPNETCORE_ENVIRONMENT: "Development" },
            },
            https: {
              commandName: "Project",
              dotnetRunMessages: true,
              launchBrowser: true,
              applicationUrl: "https://localhost:5001;http://localhost:5000",
              environmentVariables: { ASPNETCORE_ENVIRONMENT: "Development" },
            },
          },
        }, null, 2),
        reason: "ASP.NET Core uses launchSettings.json for local development profiles",
      });
    }
  }

  return { newFiles, obsoleteFiles, structuralWarnings: warnings };
}

function detectRootNamespace(files: ExtractedFile[]): string {
  // Try to extract from .csproj RootNamespace
  for (const f of files) {
    if (!f.relativePath.endsWith(".csproj")) continue;
    const match = f.content.match(/<RootNamespace>([^<]+)<\/RootNamespace>/);
    if (match) return match[1];
    // Fallback: use assembly name
    const asmMatch = f.content.match(/<AssemblyName>([^<]+)<\/AssemblyName>/);
    if (asmMatch) return asmMatch[1];
  }
  // Fallback: look for namespace declarations in .cs files
  for (const f of files) {
    if (!f.relativePath.endsWith(".cs")) continue;
    const nsMatch = f.content.match(/^namespace\s+([\w.]+)/m);
    if (nsMatch) return nsMatch[1].split(".")[0];
  }
  return "MyApp";
}

// ═══════════════════════════════════════════════════════════════
// Java / Spring Scaffolding
// ═══════════════════════════════════════════════════════════════

function scaffoldJava(
  selections: VersionSelection[],
  extractedFiles: ExtractedFile[],
  modifiedFiles: ModifiedFile[],
): Partial<ScaffoldResult> {
  const targetMajor = getTargetMajor(selections, "java", "spring", "spring boot");
  if (targetMajor == null) return { newFiles: [], obsoleteFiles: [], structuralWarnings: [] };

  const newFiles: ScaffoldFile[] = [];
  const obsoleteFiles: Array<{ path: string; reason: string }> = [];
  const warnings: string[] = [];

  // Java 9+: module-info.java might be needed
  if (targetMajor >= 9) {
    const hasModuleInfo = fileExists(extractedFiles, /module-info\.java$/i);
    if (!hasModuleInfo) {
      warnings.push(
        `ℹ️ Java ${targetMajor} supports the module system (module-info.java). ` +
        `Consider adding a module descriptor if your project uses Java Platform Module System.`
      );
    }
  }

  // Spring Boot 3: javax → jakarta namespace (structural warning)
  const springMajor = getTargetMajor(selections, "spring boot", "spring-boot");
  if (springMajor != null && springMajor >= 3) {
    const hasJavax = extractedFiles.some(f =>
      f.relativePath.endsWith(".java") && f.content.includes("import javax.")
    );
    if (hasJavax) {
      warnings.push(
        `⚠️ Spring Boot ${springMajor} requires javax.* → jakarta.* namespace migration across ALL Java files. ` +
        `The code upgrade will handle this, but verify ALL imports are updated.`
      );
    }
  }

  return { newFiles, obsoleteFiles, structuralWarnings: warnings };
}

// ═══════════════════════════════════════════════════════════════
// Python Scaffolding
// ═══════════════════════════════════════════════════════════════

function scaffoldPython(
  selections: VersionSelection[],
  extractedFiles: ExtractedFile[],
  modifiedFiles: ModifiedFile[],
): Partial<ScaffoldResult> {
  const targetMajor = getTargetMajor(selections, "python");
  if (targetMajor == null) return { newFiles: [], obsoleteFiles: [], structuralWarnings: [] };

  const newFiles: ScaffoldFile[] = [];
  const obsoleteFiles: Array<{ path: string; reason: string }> = [];
  const warnings: string[] = [];

  // Python 3: pyproject.toml (modern packaging)
  if (targetMajor >= 3) {
    const hasPyproject = fileExists(extractedFiles, /pyproject\.toml$/i);
    const hasSetupPy = fileExists(extractedFiles, /setup\.py$/i);
    if (!hasPyproject && hasSetupPy) {
      warnings.push(
        `⚠️ Consider migrating from setup.py to pyproject.toml for modern Python packaging. ` +
        `pyproject.toml is the standard build configuration format for Python 3.6+.`
      );
    }
  }

  // Django-specific
  const djangoMajor = getTargetMajor(selections, "django");
  if (djangoMajor != null && djangoMajor >= 3) {
    // Check for missing DEFAULT_AUTO_FIELD in settings.py
    const settingsFile = fileExists(extractedFiles, /settings\.py$/i);
    if (settingsFile && !settingsFile.content.includes("DEFAULT_AUTO_FIELD")) {
      warnings.push(
        `⚠️ Django ${djangoMajor} requires DEFAULT_AUTO_FIELD in settings.py. ` +
        `Add: DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'`
      );
    }
  }

  return { newFiles, obsoleteFiles, structuralWarnings: warnings };
}

// ═══════════════════════════════════════════════════════════════
// Node.js / Frontend Scaffolding
// ═══════════════════════════════════════════════════════════════

function scaffoldNode(
  selections: VersionSelection[],
  extractedFiles: ExtractedFile[],
  modifiedFiles: ModifiedFile[],
): Partial<ScaffoldResult> {
  const newFiles: ScaffoldFile[] = [];
  const obsoleteFiles: Array<{ path: string; reason: string }> = [];
  const warnings: string[] = [];

  // Angular-specific
  const angularMajor = getTargetMajor(selections, "angular", "@angular/core");
  if (angularMajor != null && angularMajor >= 13) {
    // Check for angular.json vs .angular-cli.json
    const hasOldConfig = fileExists(extractedFiles, /\.angular-cli\.json$/i);
    if (hasOldConfig) {
      obsoleteFiles.push({
        path: hasOldConfig.relativePath,
        reason: `Angular ${angularMajor} uses angular.json instead of .angular-cli.json`,
      });
      warnings.push(
        `⚠️ .angular-cli.json must be migrated to angular.json format for Angular ${angularMajor}.`
      );
    }
  }

  // React major version
  const reactMajor = getTargetMajor(selections, "react");
  if (reactMajor != null && reactMajor >= 18) {
    const hasIndex = extractedFiles.find(f =>
      f.relativePath.endsWith("index.js") || f.relativePath.endsWith("index.tsx")
    );
    if (hasIndex && hasIndex.content.includes("ReactDOM.render")) {
      warnings.push(
        `⚠️ React ${reactMajor} uses createRoot() instead of ReactDOM.render(). ` +
        `The entry point file needs to be updated.`
      );
    }
  }

  // Express major version
  const expressMajor = getTargetMajor(selections, "express");
  if (expressMajor != null && expressMajor >= 5) {
    warnings.push(
      `⚠️ Express ${expressMajor} has breaking changes in middleware, routing, and error handling. ` +
      `Review path route matching, removed req.param(), and new promise-based error handling.`
    );
  }

  // Vue 3
  const vueMajor = getTargetMajor(selections, "vue");
  if (vueMajor != null && vueMajor >= 3) {
    warnings.push(
      `ℹ️ Vue ${vueMajor} uses Composition API, createApp() instead of new Vue(), ` +
      `and has changes to v-model, filters, event bus, and global API.`
    );
  }

  return { newFiles, obsoleteFiles, structuralWarnings: warnings };
}

// ═══════════════════════════════════════════════════════════════
// Go Scaffolding
// ═══════════════════════════════════════════════════════════════

function scaffoldGo(
  selections: VersionSelection[],
  extractedFiles: ExtractedFile[],
): Partial<ScaffoldResult> {
  const targetMajor = getTargetMajor(selections, "go", "golang");
  if (targetMajor == null) return { newFiles: [], obsoleteFiles: [], structuralWarnings: [] };

  const warnings: string[] = [];

  if (targetMajor >= 18) {
    warnings.push(
      `ℹ️ Go 1.${targetMajor} supports generics. Consider adopting where it simplifies code.`
    );
  }

  return { newFiles: [], obsoleteFiles: [], structuralWarnings: warnings };
}

// ═══════════════════════════════════════════════════════════════
// Ruby / Rails Scaffolding
// ═══════════════════════════════════════════════════════════════

function scaffoldRuby(
  selections: VersionSelection[],
  extractedFiles: ExtractedFile[],
): Partial<ScaffoldResult> {
  const railsMajor = getTargetMajor(selections, "rails", "ruby on rails");
  if (railsMajor == null) return { newFiles: [], obsoleteFiles: [], structuralWarnings: [] };

  const warnings: string[] = [];
  const obsoleteFiles: Array<{ path: string; reason: string }> = [];

  if (railsMajor >= 6) {
    // secrets.yml → credentials
    const hasSecrets = fileExists(extractedFiles, /secrets\.yml$/i);
    if (hasSecrets) {
      obsoleteFiles.push({
        path: hasSecrets.relativePath,
        reason: `Rails ${railsMajor} uses credentials.yml.enc instead of secrets.yml`,
      });
      warnings.push(
        `⚠️ secrets.yml should be migrated to credentials.yml.enc for Rails ${railsMajor}. ` +
        `Run: rails credentials:edit`
      );
    }
  }

  return { newFiles: [], obsoleteFiles, structuralWarnings: warnings };
}

// ═══════════════════════════════════════════════════════════════
// Main Entry Point
// ═══════════════════════════════════════════════════════════════

export function generateStructuralScaffold(
  selections: VersionSelection[],
  extractedFiles: ExtractedFile[],
  modifiedFiles: ModifiedFile[],
): ScaffoldResult {
  const allNew: ScaffoldFile[] = [];
  const allObsolete: Array<{ path: string; reason: string }> = [];
  const allWarnings: string[] = [];

  // Detect which stacks are being upgraded and run respective scaffolders
  const selLower = selections.map(s => s.package.toLowerCase()).join(" ");

  if (selLower.includes(".net") || selLower.includes("dotnet")) {
    const r = scaffoldDotNet(selections, extractedFiles, modifiedFiles);
    allNew.push(...(r.newFiles ?? []));
    allObsolete.push(...(r.obsoleteFiles ?? []));
    allWarnings.push(...(r.structuralWarnings ?? []));
  }

  if (selLower.includes("java") || selLower.includes("spring")) {
    const r = scaffoldJava(selections, extractedFiles, modifiedFiles);
    allNew.push(...(r.newFiles ?? []));
    allObsolete.push(...(r.obsoleteFiles ?? []));
    allWarnings.push(...(r.structuralWarnings ?? []));
  }

  if (selLower.includes("python") || selLower.includes("django") || selLower.includes("flask")) {
    const r = scaffoldPython(selections, extractedFiles, modifiedFiles);
    allNew.push(...(r.newFiles ?? []));
    allObsolete.push(...(r.obsoleteFiles ?? []));
    allWarnings.push(...(r.structuralWarnings ?? []));
  }

  if (selLower.includes("angular") || selLower.includes("react") || selLower.includes("vue") ||
      selLower.includes("express") || selLower.includes("node")) {
    const r = scaffoldNode(selections, extractedFiles, modifiedFiles);
    allNew.push(...(r.newFiles ?? []));
    allObsolete.push(...(r.obsoleteFiles ?? []));
    allWarnings.push(...(r.structuralWarnings ?? []));
  }

  if (selLower.includes("go") || selLower.includes("golang")) {
    const r = scaffoldGo(selections, extractedFiles);
    allNew.push(...(r.newFiles ?? []));
    allObsolete.push(...(r.obsoleteFiles ?? []));
    allWarnings.push(...(r.structuralWarnings ?? []));
  }

  if (selLower.includes("rails") || selLower.includes("ruby")) {
    const r = scaffoldRuby(selections, extractedFiles);
    allNew.push(...(r.newFiles ?? []));
    allObsolete.push(...(r.obsoleteFiles ?? []));
    allWarnings.push(...(r.structuralWarnings ?? []));
  }

  // Deduplicate
  const seenPaths = new Set<string>();
  const dedupedNew = allNew.filter(f => {
    const key = f.path.toLowerCase();
    if (seenPaths.has(key)) return false;
    seenPaths.add(key);
    return true;
  });

  // Also filter out new files that already exist in modifiedFiles
  const modifiedPaths = new Set(modifiedFiles.map(f => f.path.replace(/\\/g, "/").toLowerCase()));
  const filteredNew = dedupedNew.filter(f => !modifiedPaths.has(f.path.toLowerCase()));

  // Build markdown summary
  const md = buildScaffoldMarkdown(filteredNew, allObsolete, allWarnings);

  return {
    newFiles: filteredNew,
    obsoleteFiles: allObsolete,
    structuralWarnings: allWarnings,
    structuralChangesMarkdown: md,
  };
}

function buildScaffoldMarkdown(
  newFiles: ScaffoldFile[],
  obsoleteFiles: Array<{ path: string; reason: string }>,
  warnings: string[],
): string {
  const lines: string[] = ["## Structural Changes"];

  if (newFiles.length === 0 && obsoleteFiles.length === 0 && warnings.length === 0) {
    lines.push("", "No structural changes required for this upgrade.");
    return lines.join("\n");
  }

  if (newFiles.length > 0) {
    lines.push("", `### New Files Created (${newFiles.length})`);
    for (const f of newFiles) {
      lines.push(`- **${f.path}** — ${f.reason}`);
    }
  }

  if (obsoleteFiles.length > 0) {
    lines.push("", `### Obsolete Files (${obsoleteFiles.length})`);
    for (const f of obsoleteFiles) {
      lines.push(`- ~~${f.path}~~ — ${f.reason}`);
    }
  }

  if (warnings.length > 0) {
    lines.push("", `### Manual Review Required (${warnings.length})`);
    for (const w of warnings) {
      lines.push(`- ${w}`);
    }
  }

  lines.push("");
  return lines.join("\n");
}
