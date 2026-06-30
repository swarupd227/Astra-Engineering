/**
 * Stack Modernization - Code Upgrade Agent
 * TASK-BY-TASK execution: iterates over upgradeTasks[] sequentially,
 * executes each task individually, saves per-task execution results
 * to state after each completion for real-time UI updates.
 */

import type { LLMProvider, StackModernizationState, VersionSelection, TaskExecutionResult, ModifiedFile } from "../types";
import { logActivity } from "../state";
import {
  safeMaxTokens, estimateTokens, getInputTokenBudget, chunkFileContent,
  MODEL_TOKEN_LIMITS,
} from "../services/token-manager";
import { trackedLLMCall } from "../services/llm-call-tracker";
import { normalizeRequestParams } from "../services/token-manager";
import { AGENT_TOKEN_BUDGETS, buildBudgetConstraint } from "../services/token-budgets";
import { minimatch } from "minimatch";
import * as path from "path";
import { z } from "zod";
import { parseFile, type ASTAnalysis } from "../services/ast-parser";
import { updateCdnVersions, extractCdnVersions } from "../services/deterministic-transforms";

// ═══════════════════════════════════════════════════════════════
// ZOD SCHEMAS FOR LLM OUTPUT VALIDATION
// ═══════════════════════════════════════════════════════════════

const LLMModifiedFileSchema = z.object({
  path: z.string().min(1),
  content: z.string().min(1),
  changes: z.union([z.array(z.string()), z.array(z.object({
    description: z.string().optional(),
  }).passthrough())]).optional(),
});

const LLMUpgradeResponseSchema = z.object({
  modifiedFiles: z.array(LLMModifiedFileSchema),
  summary: z.string().optional(),
  fixedIssues: z.array(z.string()).optional(),
});

function validateLLMResponse(parsed: any): z.infer<typeof LLMUpgradeResponseSchema> | null {
  const result = LLMUpgradeResponseSchema.safeParse(parsed);
  if (result.success) return result.data;
  console.warn("[CodeUpgradeAgent] Zod validation failed:", result.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join(", "));
  return null;
}

// ═══════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════

const MAX_FILES_PER_TASK = parseInt(process.env.UPGRADE_MAX_FILES_PER_TASK || "50", 10);
const MAX_RETRIES = 2;
const RETRY_BASE_DELAY_MS = 2000;
const LLM_TIMEOUT_MS = parseInt(process.env.UPGRADE_LLM_TIMEOUT_MS || "120000", 10);

const ALL_CODE_EXTENSIONS = new Set([
  ".js", ".ts", ".tsx", ".jsx", ".mjs", ".cjs",
  ".py", ".java", ".cs", ".go", ".rb", ".php", ".rs", ".kt", ".kts",
  ".c", ".cpp", ".h", ".hpp", ".swift", ".dart", ".scala", ".ex", ".exs",
  ".vue", ".svelte", ".astro",
  ".json", ".xml", ".yaml", ".yml", ".toml", ".cfg", ".ini", ".properties",
  ".csproj", ".fsproj", ".vbproj", ".sln", ".props", ".targets", ".nuspec",
  ".gradle", ".sbt",
  ".html", ".htm", ".cshtml", ".razor", ".aspx", ".ascx", ".master",
  ".jsp", ".jspf", ".ftl", ".vm", ".erb", ".haml", ".slim",
  ".twig", ".blade.php", ".pug", ".ejs", ".hbs", ".njk", ".j2", ".jinja2",
  ".css", ".scss", ".less",
  ".txt", ".mod", ".sum", ".lock", ".gemspec", ".rake",
  ".config",
]);

const MANIFEST_NAMES = new Set([
  "package.json", "pom.xml", "build.gradle", "build.gradle.kts",
  "requirements.txt", "pyproject.toml", "cargo.toml", "go.mod",
  "libman.json", "bower.json", "global.json", "nuget.config",
  "tsconfig.json", "gemfile", "composer.json", "pipfile",
  "setup.py", "setup.cfg", "gradle.properties", "settings.gradle",
  "settings.gradle.kts", "cmakelists.txt", "vcpkg.json", "conanfile.txt",
  "package.swift", "podfile", "pubspec.yaml", "build.sbt", "mix.exs",
  "directory.build.props", "directory.packages.props", "packages.config",
]);

const MANIFEST_EXTENSIONS = new Set([
  ".csproj", ".fsproj", ".vbproj", ".sln", ".props", ".targets", ".vcxproj",
]);

const ENTRY_POINT_NAMES = new Set([
  "program.cs", "startup.cs", "app.cs", "main.cs",
  "main.py", "app.py", "manage.py", "wsgi.py", "asgi.py",
  "main.java", "application.java",
  "main.go", "main.rs", "main.kt",
  "index.js", "index.ts", "app.js", "app.ts", "server.js", "server.ts",
  "main.dart", "main.swift", "main.cpp", "main.c",
]);

const CONFIG_NAMES = new Set([
  "appsettings.json", "appsettings.development.json", "web.config", "app.config",
  "application.properties", "application.yml", "application.yaml",
  "bootstrap.yml", "bootstrap.properties",
  "settings.py", "urls.py", "config.py",
  "angular.json", "next.config.js", "next.config.mjs", "nuxt.config.ts",
  "nuxt.config.js", "vue.config.js", "vite.config.ts", "vite.config.js",
  "gatsby-config.js", "webpack.config.js",
  "karma.conf.js", "jest.config.js", "jest.config.ts",
  "dockerfile", "docker-compose.yml", "docker-compose.yaml",
]);

// ═══════════════════════════════════════════════════════════════
// .NET ABSORBED PACKAGES — removed from shared framework in .NET 6+
// ═══════════════════════════════════════════════════════════════

const DOTNET_ABSORBED_PACKAGES_NET6: string[] = [
  "Microsoft.AspNetCore.Authentication",
  "Microsoft.AspNetCore.Authentication.Abstractions",
  "Microsoft.AspNetCore.Authentication.Cookies",
  "Microsoft.AspNetCore.Authentication.JwtBearer",
  "Microsoft.AspNetCore.Authentication.OAuth",
  "Microsoft.AspNetCore.Authentication.OpenIdConnect",
  "Microsoft.AspNetCore.Authorization",
  "Microsoft.AspNetCore.Authorization.Policy",
  "Microsoft.AspNetCore.Components",
  "Microsoft.AspNetCore.Components.Authorization",
  "Microsoft.AspNetCore.Components.Forms",
  "Microsoft.AspNetCore.Components.Web",
  "Microsoft.AspNetCore.CookiePolicy",
  "Microsoft.AspNetCore.Cors",
  "Microsoft.AspNetCore.Cryptography.Internal",
  "Microsoft.AspNetCore.Cryptography.KeyDerivation",
  "Microsoft.AspNetCore.DataProtection",
  "Microsoft.AspNetCore.DataProtection.Abstractions",
  "Microsoft.AspNetCore.Diagnostics",
  "Microsoft.AspNetCore.Diagnostics.HealthChecks",
  "Microsoft.AspNetCore.HostFiltering",
  "Microsoft.AspNetCore.Hosting",
  "Microsoft.AspNetCore.Hosting.Abstractions",
  "Microsoft.AspNetCore.Html.Abstractions",
  "Microsoft.AspNetCore.Http",
  "Microsoft.AspNetCore.Http.Abstractions",
  "Microsoft.AspNetCore.Http.Connections",
  "Microsoft.AspNetCore.Http.Extensions",
  "Microsoft.AspNetCore.Http.Features",
  "Microsoft.AspNetCore.HttpOverrides",
  "Microsoft.AspNetCore.HttpsPolicy",
  "Microsoft.AspNetCore.Identity",
  "Microsoft.AspNetCore.Localization",
  "Microsoft.AspNetCore.Metadata",
  "Microsoft.AspNetCore.Mvc",
  "Microsoft.AspNetCore.Mvc.Abstractions",
  "Microsoft.AspNetCore.Mvc.ApiExplorer",
  "Microsoft.AspNetCore.Mvc.Core",
  "Microsoft.AspNetCore.Mvc.Cors",
  "Microsoft.AspNetCore.Mvc.DataAnnotations",
  "Microsoft.AspNetCore.Mvc.Formatters.Json",
  "Microsoft.AspNetCore.Mvc.Formatters.Xml",
  "Microsoft.AspNetCore.Mvc.Localization",
  "Microsoft.AspNetCore.Mvc.NewtonsoftJson",
  "Microsoft.AspNetCore.Mvc.Razor",
  "Microsoft.AspNetCore.Mvc.RazorPages",
  "Microsoft.AspNetCore.Mvc.TagHelpers",
  "Microsoft.AspNetCore.Mvc.ViewFeatures",
  "Microsoft.AspNetCore.Razor",
  "Microsoft.AspNetCore.Razor.Runtime",
  "Microsoft.AspNetCore.ResponseCaching",
  "Microsoft.AspNetCore.ResponseCompression",
  "Microsoft.AspNetCore.Rewrite",
  "Microsoft.AspNetCore.Routing",
  "Microsoft.AspNetCore.Routing.Abstractions",
  "Microsoft.AspNetCore.Server.HttpSys",
  "Microsoft.AspNetCore.Server.IIS",
  "Microsoft.AspNetCore.Server.IISIntegration",
  "Microsoft.AspNetCore.Server.Kestrel",
  "Microsoft.AspNetCore.Server.Kestrel.Core",
  "Microsoft.AspNetCore.Server.Kestrel.Https",
  "Microsoft.AspNetCore.Server.Kestrel.Transport.Sockets",
  "Microsoft.AspNetCore.Session",
  "Microsoft.AspNetCore.SignalR",
  "Microsoft.AspNetCore.SignalR.Common",
  "Microsoft.AspNetCore.SignalR.Core",
  "Microsoft.AspNetCore.SignalR.Protocols.Json",
  "Microsoft.AspNetCore.StaticFiles",
  "Microsoft.AspNetCore.WebSockets",
  "Microsoft.AspNetCore.WebUtilities",
  "Microsoft.Extensions.Caching.Abstractions",
  "Microsoft.Extensions.Caching.Memory",
  "Microsoft.Extensions.Configuration",
  "Microsoft.Extensions.Configuration.Abstractions",
  "Microsoft.Extensions.Configuration.Binder",
  "Microsoft.Extensions.Configuration.CommandLine",
  "Microsoft.Extensions.Configuration.EnvironmentVariables",
  "Microsoft.Extensions.Configuration.FileExtensions",
  "Microsoft.Extensions.Configuration.Json",
  "Microsoft.Extensions.Configuration.UserSecrets",
  "Microsoft.Extensions.DependencyInjection",
  "Microsoft.Extensions.DependencyInjection.Abstractions",
  "Microsoft.Extensions.Diagnostics.HealthChecks",
  "Microsoft.Extensions.FileProviders.Abstractions",
  "Microsoft.Extensions.FileProviders.Physical",
  "Microsoft.Extensions.Hosting",
  "Microsoft.Extensions.Hosting.Abstractions",
  "Microsoft.Extensions.Http",
  "Microsoft.Extensions.Logging",
  "Microsoft.Extensions.Logging.Abstractions",
  "Microsoft.Extensions.Logging.Configuration",
  "Microsoft.Extensions.Logging.Console",
  "Microsoft.Extensions.Logging.Debug",
  "Microsoft.Extensions.Logging.EventLog",
  "Microsoft.Extensions.Logging.EventSource",
  "Microsoft.Extensions.Options",
  "Microsoft.Extensions.Options.ConfigurationExtensions",
  "Microsoft.Extensions.Primitives",
  "Microsoft.Net.Http.Headers",
];

const DOTNET_OBSOLETE_TOOLING_PACKAGES: Record<string, string | null> = {
  "Microsoft.VisualStudio.Web.CodeGeneration.Design": null,
  "Microsoft.VisualStudio.Web.CodeGenerators.Mvc": null,
  "Microsoft.AspNetCore.Razor.Design": null,
  "Microsoft.AspNetCore.All": null,
  "Microsoft.AspNetCore.App": null,
};

function removeAbsorbedDotnetPackages(content: string, dotnetMajorVersion: number): string {
  if (dotnetMajorVersion < 6) return content;

  let result = content;
  const packagesToRemove = [...DOTNET_ABSORBED_PACKAGES_NET6];

  for (const [pkg, _] of Object.entries(DOTNET_OBSOLETE_TOOLING_PACKAGES)) {
    packagesToRemove.push(pkg);
  }

  for (const pkg of packagesToRemove) {
    const re = new RegExp(
      `^\\s*<PackageReference\\s+Include="${escapeRegexForDotnet(pkg)}"[^/]*?/>\\s*\\n?`,
      "gmi"
    );
    result = result.replace(re, "");

    const reMultiLine = new RegExp(
      `^\\s*<PackageReference\\s+Include="${escapeRegexForDotnet(pkg)}"[^>]*>\\s*\\n?[\\s\\S]*?</PackageReference>\\s*\\n?`,
      "gmi"
    );
    result = result.replace(reMultiLine, "");
  }

  // Ensure FrameworkReference for Microsoft.AspNetCore.App exists for web projects
  if (!result.includes('Include="Microsoft.AspNetCore.App"') &&
      (result.includes("Microsoft.NET.Sdk.Web") || result.includes("Microsoft.NET.Sdk.Razor"))) {
    result = result.replace(
      /(<\/PropertyGroup>)/,
      `$1\n\n  <ItemGroup>\n    <FrameworkReference Include="Microsoft.AspNetCore.App" />\n  </ItemGroup>`
    );
  }

  return result;
}

function escapeRegexForDotnet(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ═══════════════════════════════════════════════════════════════
// VERSION ENFORCEMENT (all ecosystems)
// ═══════════════════════════════════════════════════════════════

export function enforceUserVersions(content: string, filePath: string, selections: VersionSelection[]): string {
  let result = content;
  const lowerPath = filePath.toLowerCase();

  for (const sel of selections) {
    const pkg = (sel.package || "").toLowerCase();
    const targetVer = (sel.selectedVersion || "").replace(/^v/i, "").trim();
    if (!targetVer) continue;

    // .NET TargetFramework enforcement — applies to ALL file types
    if ((pkg.includes(".net") || pkg.includes("dotnet") || pkg === "dotnet")) {
      const major = parseInt(targetVer.split(".")[0], 10);
      if (isNaN(major)) continue;

      if (major >= 5) {
        const targetTfm = `net${major}.0`;

        // Project files: TargetFramework XML elements
        if (lowerPath.endsWith(".csproj") || lowerPath.endsWith(".fsproj") || lowerPath.endsWith(".vbproj") ||
            lowerPath.endsWith(".props") || lowerPath.endsWith(".targets")) {
          // Use flexible whitespace matching to catch LLM outputs with spaces inside XML elements
          result = result.replace(/<TargetFramework>\s*net\d+\.\d+\s*<\/TargetFramework>/g,
            `<TargetFramework>${targetTfm}</TargetFramework>`);
          result = result.replace(/<TargetFramework>\s*netcoreapp\d+\.\d+\s*<\/TargetFramework>/g,
            `<TargetFramework>${targetTfm}</TargetFramework>`);
          // Also catch any generic content in TargetFramework that looks like a wrong .NET moniker
          result = result.replace(/<TargetFramework>\s*net[^<]*<\/TargetFramework>/gi, (match) => {
            // If it already has the correct TFM, leave it
            if (match.includes(targetTfm)) return `<TargetFramework>${targetTfm}</TargetFramework>`;
            // Otherwise force the correct TFM
            return `<TargetFramework>${targetTfm}</TargetFramework>`;
          });
          result = result.replace(/<TargetFrameworks>([^<]*)<\/TargetFrameworks>/g, (_m, frameworks: string) => {
            const updated = frameworks.split(";").map((f: string) => {
              if (/^net\d+\.\d+$/.test(f.trim()) || /^netcoreapp\d+\.\d+$/.test(f.trim())) return targetTfm;
              return f.trim();
            }).join(";");
            return `<TargetFrameworks>${updated}</TargetFrameworks>`;
          });
        } else if (major <= 4) {
          if (lowerPath.endsWith(".csproj") || lowerPath.endsWith(".fsproj") || lowerPath.endsWith(".vbproj")) {
            result = result.replace(/<TargetFrameworkVersion>v[\d.]+<\/TargetFrameworkVersion>/g,
              `<TargetFrameworkVersion>v${targetVer}</TargetFrameworkVersion>`);
          }
        }

        // ANY file: fix wrong TFM monikers (netXX.0 where XX != target major)
        // This catches hallucinated TFMs in Dockerfiles, launchSettings, CI configs, code comments, etc.
        if (major >= 5) {
          result = result.replace(/\bnet(\d+)\.0\b/g, (match, ver) => {
            const v = parseInt(ver, 10);
            // Only replace if it looks like a .NET TFM (>= 5) and is NOT the correct target
            if (v >= 5 && v !== major) {
              return targetTfm;
            }
            return match;
          });
          // Also fix "dotnet X.Y" / ".NET X.Y" references where X is wrong
          result = result.replace(/(?<=mcr\.microsoft\.com\/dotnet\/[a-z]+:)\d+\.\d+/g, `${major}.0`);
        }
      }

      // Remove absorbed packages from .csproj files when targeting .NET 6+
      if (major >= 6 && (lowerPath.endsWith(".csproj") || lowerPath.endsWith(".fsproj") || lowerPath.endsWith(".vbproj"))) {
        result = removeAbsorbedDotnetPackages(result, major);
      }

      // global.json SDK version
      if (lowerPath === "global.json" || lowerPath.endsWith("/global.json") || lowerPath.endsWith("\\global.json")) {
        result = result.replace(/"version"\s*:\s*"[\d.]+"/g, `"version": "${targetVer}"`);
      }
    }

    // Java version enforcement in pom.xml
    if ((pkg.includes("java") || pkg === "jdk" || pkg === "openjdk") &&
        (lowerPath.endsWith("pom.xml"))) {
      result = result.replace(/<java\.version>\d+<\/java\.version>/g,
        `<java.version>${targetVer.split(".")[0]}</java.version>`);
      result = result.replace(/<maven\.compiler\.source>\d+<\/maven\.compiler\.source>/g,
        `<maven.compiler.source>${targetVer.split(".")[0]}</maven.compiler.source>`);
      result = result.replace(/<maven\.compiler\.target>\d+<\/maven\.compiler\.target>/g,
        `<maven.compiler.target>${targetVer.split(".")[0]}</maven.compiler.target>`);
    }

    // Java version enforcement in build.gradle / build.gradle.kts
    if ((pkg.includes("java") || pkg === "jdk" || pkg === "openjdk") &&
        (lowerPath.endsWith("build.gradle") || lowerPath.endsWith("build.gradle.kts"))) {
      result = result.replace(/sourceCompatibility\s*=\s*['"]?\d+['"]?/g,
        `sourceCompatibility = '${targetVer.split(".")[0]}'`);
      result = result.replace(/targetCompatibility\s*=\s*['"]?\d+['"]?/g,
        `targetCompatibility = '${targetVer.split(".")[0]}'`);
      // Kotlin DSL: jvmTarget
      result = result.replace(/jvmTarget\s*=\s*["']\d+["']/g,
        `jvmTarget = "${targetVer.split(".")[0]}"`);
      // Kotlin DSL: JavaVersion.VERSION_XX
      result = result.replace(/JavaVersion\.VERSION_\d+/g,
        `JavaVersion.VERSION_${targetVer.split(".")[0]}`);
    }

    // Go version enforcement in go.mod
    if (pkg === "go" && lowerPath.endsWith("go.mod")) {
      result = result.replace(/^go\s+\d+\.\d+(\.\d+)?$/m, `go ${targetVer}`);
    }

    // Rust edition enforcement in Cargo.toml
    if (pkg === "rust" && lowerPath.endsWith("cargo.toml")) {
      result = result.replace(/edition\s*=\s*"[\d]+"/g, `edition = "${targetVer}"`);
    }

    // Python version enforcement in pyproject.toml
    if (pkg === "python" && lowerPath.endsWith("pyproject.toml")) {
      result = result.replace(/requires-python\s*=\s*"[^"]+"/g, `requires-python = ">=${targetVer}"`);
    }

    // Node.js version enforcement in package.json engines
    if ((pkg === "node" || pkg === "nodejs" || pkg.includes("node.js")) && lowerPath.endsWith("package.json")) {
      result = result.replace(/"node"\s*:\s*"[^"]+"/g, `"node": ">=${targetVer}"`);
    }


    // ── npm package.json dependency enforcement ──
    if (lowerPath.endsWith("package.json")) {
      try {
        const parsed = JSON.parse(result);
        let changed = false;
        const normPkg = pkg.replace(/[-_.@\s/]/g, "");
        for (const section of ["dependencies", "devDependencies", "peerDependencies"]) {
          if (!parsed[section]) continue;
          for (const depName of Object.keys(parsed[section])) {
            const normDep = depName.toLowerCase().replace(/[-_.@\s/]/g, "");
            if (normDep === normPkg || normDep.includes(normPkg) || normPkg.includes(normDep)) {
              const currentVer = String(parsed[section][depName]).replace(/^[\^~>=<\s]+/, "");
              if (currentVer !== targetVer) {
                parsed[section][depName] = `^${targetVer}`;
                changed = true;
              }
            }
          }
        }
        if (changed) result = JSON.stringify(parsed, null, 2);
      } catch { /* non-fatal */ }
    }

    // ── Spring Boot parent version in pom.xml ──
    if (pkg.includes("spring") && pkg.includes("boot") && lowerPath.endsWith("pom.xml")) {
      result = result.replace(
        /(<parent>[\s\S]*?<artifactId>\s*spring-boot-starter-parent\s*<\/artifactId>[\s\S]*?<version>)[^<]+(<\/version>)/gi,
        `$1${targetVer}$2`
      );
    }

    // ── PHP composer.json enforcement ──
    if (lowerPath.endsWith("composer.json")) {
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

  return result;
}

/**
 * Enforce user-selected versions in libman.json library entries.
 * Matches library names via normalized fuzzy comparison.
 */
function enforceLibmanVersions(content: string, selections: VersionSelection[]): string {
  try {
    const parsed = JSON.parse(content);
    if (!Array.isArray(parsed.libraries)) return content;

    let changed = false;
    for (const lib of parsed.libraries) {
      if (!lib.library || typeof lib.library !== "string") continue;
      // libman format: "library-name@version" or "provider:library-name@version"
      const atIdx = lib.library.lastIndexOf("@");
      if (atIdx <= 0) continue;
      const libName = lib.library.slice(0, atIdx);
      const currentVer = lib.library.slice(atIdx + 1);

      const normLib = libName.toLowerCase().replace(/[-_.@\s/]/g, "");
      for (const sel of selections) {
        const normPkg = (sel.package || "").toLowerCase().replace(/[-_.@\s/]/g, "");
        if (!normPkg) continue;
        const targetVer = (sel.selectedVersion || "").replace(/^v/i, "").trim();
        if (!targetVer || targetVer === currentVer) continue;

        if (normLib === normPkg || normLib.includes(normPkg) || normPkg.includes(normLib)) {
          lib.library = `${libName}@${targetVer}`;
          changed = true;
          break;
        }
      }
    }
    return changed ? JSON.stringify(parsed, null, 2) : content;
  } catch {
    return content;
  }
}

/**
 * Enforce user-selected versions in bower.json dependency entries.
 */
function enforceBowerVersions(content: string, selections: VersionSelection[]): string {
  try {
    const parsed = JSON.parse(content);
    const deps = { ...parsed.dependencies, ...parsed.devDependencies };
    let changed = false;

    for (const section of ["dependencies", "devDependencies"]) {
      if (!parsed[section]) continue;
      for (const [depName, depVersion] of Object.entries(parsed[section])) {
        const normDep = depName.toLowerCase().replace(/[-_.@\s/]/g, "");
        for (const sel of selections) {
          const normPkg = (sel.package || "").toLowerCase().replace(/[-_.@\s/]/g, "");
          if (!normPkg) continue;
          const targetVer = (sel.selectedVersion || "").replace(/^v/i, "").trim();
          if (!targetVer) continue;

          if (normDep === normPkg || normDep.includes(normPkg) || normPkg.includes(normDep)) {
            parsed[section][depName] = targetVer;
            changed = true;
            break;
          }
        }
      }
    }
    return changed ? JSON.stringify(parsed, null, 2) : content;
  } catch {
    return content;
  }
}

/**
 * After updating a CDN URL version, the associated `integrity="sha..."` and
 * `crossorigin="anonymous"` attributes on the same <script>/<link> tag become stale.
 * This removes them so the browser doesn't block the resource due to hash mismatch.
 *
 * It finds <script>/<link> tags that reference the given library+version and
 * strips the integrity attribute. crossorigin is left since it doesn't break anything.
 */
function removeStaleIntegrityAttributes(content: string, _library: string, _newVersion: string): string {
  // Remove integrity="sha..." from any <script> or <link> tag.
  // We target all integrity attrs because we only call this after a CDN version was changed,
  // so any integrity hash in this file is potentially stale.
  return content.replace(
    /(<(?:script|link)\b[^>]*?)\s+integrity="[^"]*"/gi,
    "$1"
  );
}

// ═══════════════════════════════════════════════════════════════
// PATH RESOLUTION
// ═══════════════════════════════════════════════════════════════

function resolvePathToFileMap(llmPath: string, fileMap: Map<string, any>): string | null {
  const normalized = llmPath.replace(/\\/g, "/").replace(/^\/+/, "");
  if (fileMap.has(normalized)) return normalized;

  const lower = normalized.toLowerCase();
  for (const key of fileMap.keys()) {
    if (key.replace(/\\/g, "/").toLowerCase() === lower) return key;
  }

  for (const key of fileMap.keys()) {
    const keyNorm = key.replace(/\\/g, "/");
    if (keyNorm.endsWith("/" + normalized) || keyNorm.toLowerCase().endsWith("/" + lower)) {
      return key;
    }
  }

  for (const key of fileMap.keys()) {
    const keyNorm = key.replace(/\\/g, "/").toLowerCase();
    if (lower.endsWith("/" + keyNorm) || lower.endsWith(keyNorm)) {
      return key;
    }
  }

  // Not found — return null instead of creating phantom entries
  return null;
}

// ═══════════════════════════════════════════════════════════════
// BALANCED JSON EXTRACTION
// ═══════════════════════════════════════════════════════════════

/**
 * Multi-strategy JSON extraction.
 * Tries progressively more lenient methods to recover valid JSON from LLM output.
 */
function extractJsonObject(text: string): string | null {
  // Strategy 1: balanced-brace extraction from first `{`
  const fromBrace = _extractBalancedBraces(text);
  if (fromBrace) {
    try { JSON.parse(fromBrace); return fromBrace; } catch { /* continue */ }
  }

  // Strategy 2: look for `"modifiedFiles"` anchor and work outward
  const anchor = text.indexOf('"modifiedFiles"');
  if (anchor !== -1) {
    let searchStart = anchor;
    while (searchStart > 0 && text[searchStart] !== '{') searchStart--;
    if (text[searchStart] === '{') {
      const sub = _extractBalancedBraces(text.slice(searchStart));
      if (sub) { try { JSON.parse(sub); return sub; } catch { /* continue */ } }
    }
  }

  // Strategy 3: ===FILE: delimiters → convert to JSON
  if (text.includes("===FILE:")) {
    const converted = convertFileDelimitersToJson(text);
    if (converted) return converted;
  }

  // Strategy 4: truncation recovery — close unclosed braces/brackets
  if (fromBrace === null) {
    const start = text.indexOf("{");
    if (start !== -1) {
      const truncated = _recoverTruncatedJson(text.slice(start));
      if (truncated) return truncated;
    }
  }

  return null;
}

function _extractBalancedBraces(text: string): string | null {
  const start = text.indexOf("{");
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (escape) { escape = false; continue; }
    if (ch === "\\") { escape = true; continue; }
    if (ch === '"' && !escape) { inString = !inString; continue; }
    if (inString) continue;
    if (ch === "{") depth++;
    if (ch === "}") { depth--; if (depth === 0) return text.slice(start, i + 1); }
  }
  return null;
}

function _recoverTruncatedJson(text: string): string | null {
  let depth = 0;
  let bracketDepth = 0;
  let inString = false;
  let escape = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (escape) { escape = false; continue; }
    if (ch === "\\") { escape = true; continue; }
    if (ch === '"' && !escape) { inString = !inString; continue; }
    if (inString) continue;
    if (ch === "{") depth++;
    if (ch === "}") depth--;
    if (ch === "[") bracketDepth++;
    if (ch === "]") bracketDepth--;
  }

  if (depth <= 0 && bracketDepth <= 0) return null;
  if (inString) text += '"';

  let patched = text;
  for (let i = 0; i < bracketDepth; i++) patched += "]";
  for (let i = 0; i < depth; i++) patched += "}";

  try { JSON.parse(patched); return patched; } catch { return null; }
}

function convertFileDelimitersToJson(text: string): string | null {
  const fileRegex = /===FILE:\s*(.+?)===\n([\s\S]*?)===END_FILE===/g;
  const files: Array<{ path: string; content: string }> = [];
  let match;
  while ((match = fileRegex.exec(text)) !== null) {
    const fp = match[1].trim();
    let code = match[2].trim();
    code = code.replace(/^```[a-z]*\n?/i, "").replace(/\n?```$/i, "").trim();
    if (fp && code) files.push({ path: fp, content: code });
  }
  if (files.length === 0) return null;
  try {
    return JSON.stringify({
      modifiedFiles: files.map(f => ({ path: f.path, content: f.content, changes: ["Upgraded"] })),
      summary: `Upgraded ${files.length} file(s)`,
    });
  } catch { return null; }
}

// ═══════════════════════════════════════════════════════════════
// UNIFIED PARSE + VALIDATE
// ═══════════════════════════════════════════════════════════════

/**
 * Multi-strategy parse and validate: tries direct JSON, fence-strip, balanced
 * extraction, ===FILE: delimiters, truncation recovery, bare code fallback.
 * Also handles `null` / empty object responses (LLM says "nothing to change").
 */
function parseAndValidateLLMResponse(
  responseText: string,
  scopeFiles: Array<{ path: string; content: string }>,
): z.infer<typeof LLMUpgradeResponseSchema> | null {
  let parsed: any = null;

  try {
    let clean = responseText;
    if (clean.startsWith("```")) clean = clean.replace(/^```(?:json)?\n?/i, "").replace(/\n?```$/i, "").trim();
    parsed = JSON.parse(clean);
  } catch {
    const jsonStr = extractJsonObject(responseText);
    if (jsonStr) {
      try { parsed = JSON.parse(jsonStr); } catch { /* fall through */ }
    }
  }

  // Handle `null`, empty string, or empty object — treat as "no changes needed"
  if (parsed === null || parsed === undefined || (typeof parsed === "object" && !Array.isArray(parsed) && Object.keys(parsed).length === 0)) {
    return { modifiedFiles: [], summary: "No changes needed for this task" };
  }

  // Handle response with empty modifiedFiles
  if (parsed && Array.isArray(parsed.modifiedFiles) && parsed.modifiedFiles.length === 0) {
    return { modifiedFiles: [], summary: parsed.summary || "No changes needed for this task" };
  }

  let validated = validateLLMResponse(parsed);
  if (validated) return validated;

  // Fallback: ===FILE: delimiters
  if (responseText.includes("===FILE:")) {
    const converted = convertFileDelimitersToJson(responseText);
    if (converted) {
      try {
        parsed = JSON.parse(converted);
        validated = validateLLMResponse(parsed);
        if (validated) return validated;
      } catch { /* fall through */ }
    }
  }

  // Fallback: bare code for single-file tasks
  if (responseText.length > 50 && scopeFiles.length === 1) {
    const bareCode = responseText.replace(/^```[a-z]*\n?/i, "").replace(/\n?```$/i, "").trim();
    if (bareCode.length > 20) {
      const synthetic = {
        modifiedFiles: [{ path: scopeFiles[0].path, content: bareCode, changes: ["Upgraded"] }],
        summary: "Single file upgrade",
      };
      validated = validateLLMResponse(synthetic);
      if (validated) return validated;
    }
  }

  return null;
}

// ═══════════════════════════════════════════════════════════════
// FILE SELECTION & PRIORITIZATION
// ═══════════════════════════════════════════════════════════════

function matchFileToPatterns(filePath: string, patterns: string[]): boolean {
  const normalized = filePath.replace(/\\/g, "/");
  return patterns.some((pattern) => {
    if (pattern.includes("*") || pattern.includes("{") || pattern.includes("?")) {
      return minimatch(normalized, pattern, { nocase: true, matchBase: true });
    }
    return normalized.toLowerCase().includes(pattern.toLowerCase());
  });
}

function classifyFileRelevance(
  filePath: string,
  _content: string,
  task: any,
  selections: VersionSelection[]
): number {
  const baseName = path.basename(filePath).toLowerCase();
  const ext = path.extname(filePath).toLowerCase();
  let score = 0;

  if (MANIFEST_NAMES.has(baseName) || MANIFEST_EXTENSIONS.has(ext)) score += 100;
  if (ENTRY_POINT_NAMES.has(baseName)) score += 80;
  if (CONFIG_NAMES.has(baseName)) score += 70;

  const taskTitle = ((task.title || "") + " " + (task.description || "")).toLowerCase();
  const contentLower = _content.toLowerCase();

  for (const sel of selections) {
    const pkgLower = sel.package.toLowerCase();
    if (taskTitle.includes(pkgLower) && contentLower.includes(pkgLower)) {
      score += 60;
    } else if (contentLower.includes(pkgLower)) {
      score += 30;
    }
  }

  return score;
}

/**
 * Extract only the lines from a file that reference a library (script tags,
 * data-attributes, import/using statements). Used for "context" files so
 * the LLM sees the coupling surface without the full file content.
 */
function extractRelevantLines(content: string, filePath: string, libraryNames: string[]): string {
  const lines = content.split("\n");
  const relevant: string[] = [];
  const libPattern = new RegExp(libraryNames.map(l => l.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"), "i");
  const attrPattern = /data-(bs-)?(toggle|dismiss|target|parent|ride|slide|spy|offset)=/i;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (libPattern.test(line) || attrPattern.test(line) ||
        /^(import |using |require\(|from |@import )/.test(line.trim())) {
      relevant.push(`L${i + 1}: ${line.trimEnd()}`);
    }
  }

  if (relevant.length === 0) return "";
  return `=== ${filePath} (relevant lines only — read-only context) ===\n${relevant.join("\n")}`;
}

function selectAndPrepareFiles(
  fileMap: Map<string, { content: string; original: string }>,
  task: any,
  selections: VersionSelection[],
  model: string,
  couplingRegistry?: import("../types").CouplingGroup[],
  importGraph?: import("../types").ImportGraph,
  impactReport?: import("../services/pre-upgrade-impact-analyzer").UpgradeImpactReport,
  promptOverheadChars?: number,
): Array<{ path: string; content: string; chunked: boolean; contextOnly?: boolean }> {
  const affectedPatterns = (task.affectedFiles || []) as string[];
  let anchorCandidates: Array<{ path: string; content: string }> = [];

  if (affectedPatterns.length > 0) {
    for (const [fp, data] of fileMap) {
      if (matchFileToPatterns(fp, affectedPatterns)) {
        anchorCandidates.push({ path: fp, content: data.content });
      }
    }
  }

  if (anchorCandidates.length === 0) {
    for (const [fp, data] of fileMap) {
      const ext = path.extname(fp).toLowerCase();
      if (ALL_CODE_EXTENSIONS.has(ext)) {
        anchorCandidates.push({ path: fp, content: data.content });
      }
    }
  }

  const anchorPaths = new Set(anchorCandidates.map(c => c.path));

  // Coupling awareness: coupled files that aren't already anchors become
  // "context" files — the LLM sees only their relevant lines, not full content.
  const contextCandidates: Array<{ path: string; content: string; libraries: string[] }> = [];
  if (couplingRegistry && couplingRegistry.length > 0) {
    for (const group of couplingRegistry) {
      const hasOverlap = group.files.some(gf => anchorPaths.has(gf));
      if (!hasOverlap) continue;

      for (const gf of group.files) {
        if (!anchorPaths.has(gf) && fileMap.has(gf)) {
          const existing = contextCandidates.find(c => c.path === gf);
          if (existing) {
            existing.libraries.push(group.library);
          } else {
            contextCandidates.push({
              path: gf,
              content: fileMap.get(gf)!.content,
              libraries: [group.library],
            });
          }
        }
      }

      // Also promote critical files (manifests/layouts) to anchors if not already
      for (const cf of group.criticalFiles) {
        if (!anchorPaths.has(cf) && fileMap.has(cf)) {
          anchorCandidates.push({ path: cf, content: fileMap.get(cf)!.content });
          anchorPaths.add(cf);
        }
      }
    }
  }

  // Import graph expansion (these stay as anchors — they need changes)
  if (importGraph?.fileToFiles) {
    const dependents = new Set<string>();
    for (const candidatePath of anchorPaths) {
      const deps = importGraph.fileToFiles[candidatePath];
      if (deps) {
        for (const dep of deps) {
          if (!anchorPaths.has(dep)) dependents.add(dep);
        }
      }
    }
    for (const [file, deps] of Object.entries(importGraph.fileToFiles)) {
      if (anchorPaths.has(file)) continue;
      if (deps.some(d => anchorPaths.has(d))) dependents.add(file);
    }
    for (const dep of dependents) {
      if (fileMap.has(dep) && !anchorPaths.has(dep)) {
        anchorCandidates.push({ path: dep, content: fileMap.get(dep)!.content });
        anchorPaths.add(dep);
      }
    }
  }

  // Impact report expansion
  if (impactReport?.affectedFiles) {
    for (const fi of impactReport.affectedFiles) {
      if (fi.riskScore >= 3 && !anchorPaths.has(fi.path) && fileMap.has(fi.path)) {
        anchorCandidates.push({ path: fi.path, content: fileMap.get(fi.path)!.content });
        anchorPaths.add(fi.path);
      }
    }
  }

  // Score and sort anchors
  const scoredAnchors = anchorCandidates.map(f => ({
    ...f,
    score: classifyFileRelevance(f.path, f.content, task, selections),
  }));
  scoredAnchors.sort((a, b) => b.score - a.score);
  const topAnchors = scoredAnchors.slice(0, MAX_FILES_PER_TASK);

  // Budget calculation — use dynamic overhead if provided, otherwise estimate
  const inputBudgetChars = Math.floor(getInputTokenBudget(model) * 3.5);
  const overhead = promptOverheadChars ?? 8000;
  const availableForFiles = inputBudgetChars - overhead;

  // Reserve 15% of file budget for context files, 85% for anchors
  const contextBudget = Math.floor(availableForFiles * 0.15);
  const anchorBudget = availableForFiles - contextBudget;
  const perAnchorBudget = Math.max(4000, Math.floor(anchorBudget / Math.max(topAnchors.length, 1)));

  const results: Array<{ path: string; content: string; chunked: boolean; contextOnly?: boolean }> = [];

  // Anchors: full content (chunked if needed)
  for (const f of topAnchors) {
    if (f.content.length <= perAnchorBudget) {
      results.push({ path: f.path, content: f.content, chunked: false });
    } else {
      results.push({
        path: f.path,
        content: chunkFileContent(f.content, perAnchorBudget, f.path),
        chunked: true,
      });
    }
  }

  // Context files: relevant lines only, within context budget
  // Remove any that were promoted to anchors
  const finalContextFiles = contextCandidates.filter(c => !anchorPaths.has(c.path));
  let contextUsed = 0;
  const allLibraries = [...new Set(finalContextFiles.flatMap(c => c.libraries))];

  for (const cf of finalContextFiles) {
    const summary = extractRelevantLines(cf.content, cf.path, allLibraries);
    if (!summary) continue;
    if (contextUsed + summary.length > contextBudget) break;
    results.push({ path: cf.path, content: summary, chunked: false, contextOnly: true });
    contextUsed += summary.length;
  }

  return results;
}

// ═══════════════════════════════════════════════════════════════
// CHANGE SUMMARY FOR CROSS-TASK CONTEXT
// ═══════════════════════════════════════════════════════════════

function buildTaskChangeSummary(
  taskResults: TaskExecutionResult[],
  completedIndex: number,
  fileMap?: Map<string, { content: string; original: string }>,
): string {
  const summaries: string[] = [];
  for (let i = 0; i <= completedIndex; i++) {
    const r = taskResults[i];
    if (r.status !== "completed" || !r.alteredFiles?.length) continue;

    const fileDetails = r.alteredFiles.map((f: any) => {
      const parts: string[] = [`  - ${f.path}: ${f.changeDescription || "modified"}`];
      // Add version change details from the modified content if available
      if (fileMap) {
        const entry = fileMap.get(f.path);
        if (entry) {
          const versionChanges = extractVersionChanges(entry.original, entry.content);
          if (versionChanges.length > 0) {
            parts.push(`    Versions: ${versionChanges.join(", ")}`);
          }
          const pathChanges = extractPathChanges(entry.original, entry.content);
          if (pathChanges.length > 0) {
            parts.push(`    Paths changed: ${pathChanges.join(", ")}`);
          }
        }
      }
      return parts.join("\n");
    }).join("\n");

    summaries.push(`Task ${i + 1} (${r.summary?.slice(0, 100) || "done"}):\n${fileDetails}`);
  }
  if (summaries.length === 0) return "";

  // Keep summary compact to reduce token waste on later tasks.
  // Only include the last 3 task summaries (most recent context).
  const recentSummaries = summaries.slice(-3);
  const maxChars = 2000;
  let text = `\n**CHANGES BY PREVIOUS TASKS (context only, do NOT undo):**\n${recentSummaries.join("\n")}`;
  if (text.length > maxChars) text = text.slice(0, maxChars) + "\n... (truncated)";
  return text;
}

function extractVersionChanges(original: string, updated: string): string[] {
  const changes: string[] = [];
  const versionRe = /["']?([\d]+\.[\d]+\.[\d]+(?:[.-][\w.]+)?)["']?/g;
  const origVersions = new Set<string>();
  let m;
  while ((m = versionRe.exec(original)) !== null) origVersions.add(m[1]);
  const newRe = /["']?([\d]+\.[\d]+\.[\d]+(?:[.-][\w.]+)?)["']?/g;
  while ((m = newRe.exec(updated)) !== null) {
    if (!origVersions.has(m[1]) && !original.includes(m[1])) {
      changes.push(m[1]);
    }
  }
  return [...new Set(changes)].slice(0, 5);
}

function extractPathChanges(original: string, updated: string): string[] {
  const changes: string[] = [];
  const pathRe = /(?:src|href)\s*=\s*["']([^"']+)["']/gi;
  const origPaths = new Set<string>();
  let m;
  while ((m = pathRe.exec(original)) !== null) origPaths.add(m[1]);
  const newRe = /(?:src|href)\s*=\s*["']([^"']+)["']/gi;
  while ((m = newRe.exec(updated)) !== null) {
    if (!origPaths.has(m[1])) changes.push(m[1]);
  }
  return changes.slice(0, 5);
}

// ═══════════════════════════════════════════════════════════════
// LLM CALL WITH RETRY + TIMEOUT
// ═══════════════════════════════════════════════════════════════

async function callLLMWithRetry(
  client: any,
  model: string,
  messages: Array<{ role: string; content: string }>,
  maxTokens: number,
  jsonMode: boolean = false,
  trackingCtx?: { analysisId: string; phase: string; agent: string },
): Promise<string> {
  const { stackModConfig } = await import("../config");
  const { sanitizeMessages, isContentFilterError } = await import("../services/prompt-sanitizer");
  let lastError: Error | null = null;
  const isGpt = model.toLowerCase().includes("gpt");
  const useJsonResponse = jsonMode && stackModConfig.useStructuredOutput && isGpt;

  let currentMessages = messages;
  let contentFilterRetries = 0;
  const MAX_CONTENT_FILTER_RETRIES = 2;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);

      try {
        const params: any = {
          model,
          messages: currentMessages,
          temperature: 0,
          max_tokens: maxTokens,
        };
        if (useJsonResponse) {
          params.response_format = { type: "json_object" };
        }
        const response = trackingCtx
          ? await trackedLLMCall(client, params, trackingCtx)
          : await client.chat.completions.create(normalizeRequestParams(params), { signal: controller.signal });

        clearTimeout(timeout);
        return response.choices[0]?.message?.content?.trim() || "";
      } finally {
        clearTimeout(timeout);
      }
    } catch (err: any) {
      lastError = err instanceof Error ? err : new Error(String(err));
      const status = err?.status || err?.response?.status;

      // Content filter → sanitize prompt and retry with increasing aggressiveness
      if (isContentFilterError(err) && contentFilterRetries < MAX_CONTENT_FILTER_RETRIES) {
        contentFilterRetries++;
        const level = contentFilterRetries === 1 ? "standard" : "aggressive";
        console.warn(
          `[CodeUpgradeAgent] Content filter triggered (retry ${contentFilterRetries}/${MAX_CONTENT_FILTER_RETRIES}), ` +
          `sanitizing messages at level="${level}" and retrying...`,
        );
        currentMessages = sanitizeMessages(currentMessages, level as any);
        continue;
      }

      if (status === 429 || status === 500 || status === 502 || status === 503 || status === 529 ||
          err?.code === "ECONNRESET" || err?.code === "ETIMEDOUT" || err?.name === "AbortError" ||
          err?.message?.includes("overloaded") || err?.message?.includes("Overloaded")) {
        const delay = RETRY_BASE_DELAY_MS * Math.pow(2, attempt);
        console.warn(`[CodeUpgradeAgent] LLM call failed (attempt ${attempt + 1}/${MAX_RETRIES + 1}), retrying in ${delay}ms: ${lastError.message}`);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      throw lastError;
    }
  }
  throw lastError || new Error("LLM call failed after retries");
}

// ═══════════════════════════════════════════════════════════════
// DYNAMIC TOKEN ALLOCATION
// ═══════════════════════════════════════════════════════════════

function calculateOutputTokens(scopeFiles: Array<{ content: string; contextOnly?: boolean }>, model: string): number {
  const anchorFiles = scopeFiles.filter(f => !f.contextOnly);
  const totalInputChars = anchorFiles.reduce((sum, f) => sum + f.content.length, 0);
  // Output must hold COMPLETE file contents (not diffs) + JSON wrapper overhead.
  // Estimate ~1 token per 3.5 chars, plus overhead for JSON structure.
  const estimatedOutputTokens = Math.ceil(totalInputChars / 3.5) + 2000;
  const limits = MODEL_TOKEN_LIMITS[model] || MODEL_TOKEN_LIMITS["default"];
  const maxOutput = Math.floor(limits.output * 0.95);
  return Math.min(Math.max(estimatedOutputTokens, 8000), maxOutput);
}

// ═══════════════════════════════════════════════════════════════
// MIGRATION GUIDANCE (ported from deprecated functions)
// ═══════════════════════════════════════════════════════════════

function getMigrationGuidance(selections: VersionSelection[]): string {
  const guidance: string[] = [];
  for (const sel of selections) {
    const pkg = sel.package.toLowerCase();
    const currentMajor = parseInt(sel.currentVersion?.split(".")[0] || "0");
    const targetMajor = parseInt(sel.selectedVersion.split(".")[0]);
    if (isNaN(targetMajor)) continue;

    if (pkg.includes("cucumber") && currentMajor < 6 && targetMajor >= 6) {
      guidance.push("Cucumber 6+: cucumber.api.java.* → io.cucumber.java.*, Scenario.write() → Scenario.log(), DataTable API changed");
    }
    if (pkg === "react" && currentMajor < 18 && targetMajor >= 18) {
      guidance.push("React 18: ReactDOM.render() → createRoot(), automatic batching, StrictMode double-renders in dev");
    }
    if (pkg.includes("spring-boot") && currentMajor < 3 && targetMajor >= 3) {
      guidance.push("Spring Boot 3: javax.* → jakarta.*, Java 17 minimum, Spring Security 6.0 config changes, @ConstructorBinding location changed");
    }
    if ((pkg === "node" || pkg.includes("nodejs")) && currentMajor < 18 && targetMajor >= 18) {
      guidance.push("Node.js 18+: fetch() built-in, OpenSSL 3.0, built-in test runner (node:test)");
    }
    if (pkg.includes("junit") && currentMajor < 5 && targetMajor >= 5) {
      guidance.push("JUnit 5: org.junit.* → org.junit.jupiter.api.*, @Before → @BeforeEach, @RunWith → @ExtendWith, assertion parameter order changed");
    }
    if (pkg === "express" && currentMajor < 5 && targetMajor >= 5) {
      guidance.push("Express 5: app.del() removed, req.param() removed, path matching syntax changed, promise rejections auto-caught");
    }
    if (pkg === "angular" && currentMajor < 17 && targetMajor >= 17) {
      guidance.push("Angular 17+: standalone components by default, new control flow syntax (@if/@for), signals API");
    }
    if ((pkg === "django" || pkg.includes("django")) && currentMajor < 4 && targetMajor >= 4) {
      guidance.push("Django 4+: USE_L10N removed, url() → re_path()/path(), default auto field changed");
    }
    if ((pkg.includes(".net") || pkg.includes("dotnet")) && targetMajor >= 8) {
      guidance.push(`.NET ${targetMajor}: shared framework packages don't need explicit versions, use <ImplicitUsings>enable</ImplicitUsings>`);
    }
    if (pkg === "vue" && currentMajor < 3 && targetMajor >= 3) {
      guidance.push("Vue 3: Options API still works but Composition API preferred, createApp() replaces new Vue(), filters removed, $on/$off/$once removed");
    }
  }
  return guidance.length > 0 ? "\n\nKNOWN MIGRATION CHANGES:\n- " + guidance.join("\n- ") : "";
}

// ═══════════════════════════════════════════════════════════════
// POST-LLM IMPORT/EXPORT VALIDATOR
// ═══════════════════════════════════════════════════════════════

interface ImportValidationResult {
  valid: boolean;
  violations: string[];
  fixedContent?: string;
}

// Deprecated packages that are allowed to be removed during upgrades.
// This list is extended dynamically from the impact report when available.
const BASE_DEPRECATED_IMPORTS = [
  "microsoft.visualstudio.web.browserlink",
  "microsoft.aspnetcore.browserlink",
  "system.web",
  "binaryformatter",
  "system.runtime.serialization.formatters.binary",
  "swashbuckle.aspnetcore",
  "spring.cloud.sleuth",
  "javax.servlet",
  "javax.persistence",
  "javax.annotation",
  "javax.inject",
  "javax.validation",
];

function validateImportsPreserved(
  originalContent: string,
  modifiedContent: string,
  filePath: string,
  allowedRenames?: Record<string, string>,
  deprecatedPackages?: Array<{ package: string }>,
): ImportValidationResult {
  const violations: string[] = [];

  try {
    const originalAST = parseFile(filePath, originalContent);
    const modifiedAST = parseFile(filePath, modifiedContent);

    if (originalAST.imports.length === 0) {
      return { valid: true, violations: [] };
    }

    // Build comprehensive deprecated list from base + impact report
    const deprecatedLower = new Set(BASE_DEPRECATED_IMPORTS);
    if (deprecatedPackages) {
      for (const dp of deprecatedPackages) {
        deprecatedLower.add(dp.package.toLowerCase());
      }
    }

    const modifiedImportSources = new Set(modifiedAST.imports.map(i => i.source.toLowerCase()));
    const modifiedExportNames = new Set(modifiedAST.exports.map(e => e.name.toLowerCase()));

    for (const origImport of originalAST.imports) {
      const origSource = origImport.source.toLowerCase();

      if (modifiedImportSources.has(origSource)) continue;

      // Check if this is an allowed rename (e.g., javax → jakarta)
      let isAllowedRename = false;
      if (allowedRenames) {
        for (const [from, to] of Object.entries(allowedRenames)) {
          if (origSource.startsWith(from.toLowerCase())) {
            const expectedNew = origSource.replace(from.toLowerCase(), to.toLowerCase());
            if (modifiedImportSources.has(expectedNew)) {
              isAllowedRename = true;
              break;
            }
          }
          // Also check if the modified file has the "to" version (partial match)
          if (origSource.includes(from.toLowerCase())) {
            isAllowedRename = true;
            break;
          }
        }
      }

      if (isAllowedRename) continue;

      // Check if the import was of a deprecated package (allowed to remove)
      const isDeprecated = [...deprecatedLower].some(dep => origSource.includes(dep));
      if (isDeprecated) continue;

      violations.push(
        `Import "${origImport.source}" (line ${origImport.line}) was removed or renamed. ` +
        `Original: "${origImport.source}" → Missing in modified file. ` +
        `This is NOT allowed unless it's a migration-required change.`
      );
    }

    // Validate exports are preserved (public API must not change)
    for (const origExport of originalAST.exports) {
      if (origExport.kind === "method" || origExport.kind === "property") continue;

      const origName = origExport.name.toLowerCase();
      if (!modifiedExportNames.has(origName)) {
        violations.push(
          `Export "${origExport.name}" (${origExport.kind}, line ${origExport.line}) was removed or renamed. ` +
          `Public API names must be preserved.`
        );
      }
    }
  } catch (err) {
    console.warn(`[ImportValidator] AST parsing failed for ${filePath}, skipping validation:`, err instanceof Error ? err.message : err);
    return { valid: true, violations: [] };
  }

  return { valid: violations.length === 0, violations };
}

/**
 * Attempt to fix unauthorized import renames by surgically restoring only the
 * imports that were incorrectly changed, while preserving:
 * - Imports that were correctly added (new packages for the upgrade)
 * - Imports that were legitimately renamed (javax → jakarta)
 * - All other code changes made by the LLM
 */
function restoreOriginalImports(
  originalContent: string,
  modifiedContent: string,
  filePath: string,
  allowedRenames?: Record<string, string>,
): string | null {
  try {
    const originalAST = parseFile(filePath, originalContent);
    const modifiedAST = parseFile(filePath, modifiedContent);

    if (originalAST.imports.length === 0) return modifiedContent;

    const modifiedImportSources = new Set(modifiedAST.imports.map(i => i.source.toLowerCase()));

    // Find imports that were incorrectly removed/renamed
    const missingImports: Array<{ source: string; line: string }> = [];
    const origLines = originalContent.split("\n");

    for (const origImport of originalAST.imports) {
      const origSource = origImport.source.toLowerCase();
      if (modifiedImportSources.has(origSource)) continue;

      // Skip allowed renames
      let isAllowed = false;
      if (allowedRenames) {
        for (const [from] of Object.entries(allowedRenames)) {
          if (origSource.includes(from.toLowerCase())) { isAllowed = true; break; }
        }
      }
      if (isAllowed) continue;

      // Skip deprecated packages
      if (BASE_DEPRECATED_IMPORTS.some(dep => origSource.includes(dep))) continue;

      // This import was wrongly removed — we need to restore it
      const originalLine = origLines[origImport.line - 1];
      if (originalLine) {
        missingImports.push({ source: origImport.source, line: originalLine });
      }
    }

    if (missingImports.length === 0) return modifiedContent;

    // Strategy: find the import region in modified content and insert missing imports
    const modLines = modifiedContent.split("\n");
    const modImportLines = modifiedAST.imports.map(i => i.line - 1);

    if (modImportLines.length > 0) {
      // Insert missing imports right after the last existing import
      const insertPoint = Math.max(...modImportLines) + 1;
      for (const mi of missingImports) {
        modLines.splice(insertPoint, 0, mi.line);
      }
    } else {
      // No imports left in modified file — insert at the top
      const insertLines = missingImports.map(mi => mi.line);
      modLines.splice(0, 0, ...insertLines);
    }

    return modLines.join("\n");
  } catch (err) {
    console.warn(`[ImportValidator] restoreOriginalImports failed for ${filePath}:`, err instanceof Error ? err.message : err);
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════
// PUBLIC API
// ═══════════════════════════════════════════════════════════════

export interface CodeUpgradeResult {
  modifiedFiles: Array<{
    path: string;
    content: string;
    originalContent: string;
    changes: Array<{ package: string; oldVersion: string; newVersion: string }>;
  }>;
  summary: {
    totalFilesModified: number;
    totalPackagesUpgraded: number;
    success: boolean;
  };
  errors: string[];
}

export interface CodeUpgradeAgentOptions {
  onProgress?: (files: Array<{ path: string; content: string; originalContent: string; changes?: any[] }>) => void;
}

async function persistState(state: StackModernizationState): Promise<void> {
  try {
    const { stateStore } = await import("../services/state-store");
    stateStore.save(state);
  } catch (err) {
    console.warn("[CodeUpgradeAgent] State persistence failed:", err instanceof Error ? err.message : err);
  }
}

/**
 * Execute code upgrade TASK BY TASK.
 * Each task from upgradeTasks[] is executed sequentially with its own
 * LLM call scoped to the task's affected files. Per-task results are
 * saved to state immediately so the frontend can show live progress.
 */
export async function executeCodeUpgradeAgent(
  currentState: StackModernizationState,
  userSelections: VersionSelection[],
  options?: CodeUpgradeAgentOptions
): Promise<StackModernizationState> {
  const tasks = currentState.upgradeTasks || [];

  currentState = logActivity(currentState, "CodeUpgrade", "Starting task-by-task execution", `${tasks.length} tasks queued`, "info");

  if (!currentState.extractedFiles || currentState.extractedFiles.length === 0) {
    throw new Error("No extracted files available for upgrade");
  }
  if (!userSelections || userSelections.length === 0) {
    throw new Error("No version selections provided");
  }

  // Build impact report from migration docs (read from state — already fetched by fetchMigrationDocsNode)
  try {
    const { analyzeUpgradeImpact, getAllowedRenames } = await import("../services/pre-upgrade-impact-analyzer");

    // Use pre-fetched docs from state; fall back to live fetch only if state is empty
    let migrationDocs: Map<string, any>;
    if (currentState.migrationDocs && Object.keys(currentState.migrationDocs).length > 0) {
      migrationDocs = new Map(Object.entries(currentState.migrationDocs));
    } else {
      const { fetchAllMigrationDocs } = await import("../services/migration-doc-fetcher");
      migrationDocs = await fetchAllMigrationDocs(userSelections);
    }

    if (currentState.astAnalysis && Object.keys(currentState.astAnalysis).length > 0) {
      const impactReport = analyzeUpgradeImpact(currentState.astAnalysis, migrationDocs, userSelections);
      currentState.impactReport = impactReport;
      currentState.migrationAllowedRenames = getAllowedRenames(migrationDocs);

      currentState = logActivity(
        currentState, "CodeUpgrade",
        "Pre-upgrade impact analysis complete",
        `${impactReport.totalImpacts} issues found in ${impactReport.affectedFiles.length} files, risk score ${impactReport.riskScore}/100`,
        impactReport.criticalCount > 0 ? "warning" : "info"
      );
    }
  } catch (err) {
    console.warn("[CodeUpgradeAgent] Impact analysis failed (non-blocking):", err instanceof Error ? err.message : err);
  }

  if (tasks.length === 0) {
    console.warn("[CodeUpgradeAgent] No tasks found, falling back to code generation loop");
    return executeMonolithicFallback(currentState, userSelections, options);
  }

  // Reorder tasks: use recommended upgrade order from plan when available, then manifest → config → code within that
  const upgradeOrder = currentState.planningVisualizationData?.upgradeOrder ?? [];
  const reorderedTasks = reorderTasksByDependency(tasks, currentState.importGraph, upgradeOrder);

  const taskResults: TaskExecutionResult[] = reorderedTasks.map((t: any) => ({
    taskId: t.id || `task-${Math.random().toString(36).slice(2, 8)}`,
    status: "pending" as const,
    summary: "",
    alteredFiles: [],
    fixedIssues: [],
    verificationFiles: [],
  }));
  currentState.taskExecutionResults = taskResults;
  await persistState(currentState);

  const allModifiedFiles: Array<{ path: string; content: string; originalContent: string; changes: any[] }> = [];
  const { getLLMClient } = await import("../services/llm-selector");
  const { client, model } = getLLMClient(currentState.llmProvider);

  const fileMap = new Map<string, { content: string; original: string }>();
  for (const f of currentState.extractedFiles) {
    fileMap.set(f.relativePath, { content: f.content, original: f.content });
  }

  // PRE-LLM: Apply deterministic transforms (known find/replace patterns)
  // These handle simple, well-known breaking changes (data-toggle → data-bs-toggle,
  // $.isArray → Array.isArray, javax → jakarta, etc.) BEFORE the LLM sees the code.
  let dynamicTransformRules: import("../services/deterministic-transforms").TransformRule[] = [];
  try {
    const { applyTransformsToFileMap, generateRulesFromMigrationDocs } = await import("../services/deterministic-transforms");

    // Use pre-built rules from state (populated by fetchMigrationDocsNode); fall back to live generation
    if (currentState.deterministicRules && currentState.deterministicRules.length > 0) {
      dynamicTransformRules = currentState.deterministicRules;
    } else {
      const { fetchAllMigrationDocs } = await import("../services/migration-doc-fetcher");
      const migrationDocs = await fetchAllMigrationDocs(userSelections);
      dynamicTransformRules = generateRulesFromMigrationDocs(migrationDocs, userSelections);
    }

    const transformResult = applyTransformsToFileMap(fileMap, userSelections, dynamicTransformRules);
    if (transformResult.totalChanges > 0) {
      console.log(`[CodeUpgradeAgent] Deterministic transforms: ${transformResult.totalChanges} changes in ${transformResult.totalFiles} files added to modifiedFiles`);
      currentState = logActivity(
        currentState, "CodeUpgrade",
        "Deterministic pre-LLM transforms applied",
        `${transformResult.totalChanges} known breaking changes fixed in ${transformResult.totalFiles} files before LLM processing`,
        "info"
      );
    }
  } catch (err) {
    console.warn("[CodeUpgradeAgent] Pre-LLM deterministic transforms failed (non-blocking):", err instanceof Error ? err.message : err);
  }

  for (let i = 0; i < reorderedTasks.length; i++) {
    const task = reorderedTasks[i];
    const result = taskResults[i];
    result.status = "in_progress";
    result.startedAt = new Date();
    currentState.currentStage = `Task ${i + 1}/${reorderedTasks.length}: ${task.title || task.id}`;
    currentState.taskExecutionResults = [...taskResults];
    await persistState(currentState);


    try {
      // Pre-compute non-file prompt overhead so selectAndPrepareFiles can
      // allocate the right token budget for file content.
      let migrationGuidancePre = getMigrationGuidance(userSelections);
      if (currentState.migrationDocs && Object.keys(currentState.migrationDocs).length > 0) {
        const { formatDocsForCodeUpgrade, extractTaskPackages } = await import("../services/migration-doc-formatter");
        const allPkgNames = Object.keys(currentState.migrationDocs);
        const taskPkgs = extractTaskPackages(task.title, task.description || "", allPkgNames);
        const targeted = formatDocsForCodeUpgrade(
          currentState.migrationDocs, taskPkgs, [],
          currentState.migrationDocsIndex,
        );
        if (targeted) migrationGuidancePre += "\n\n" + targeted;
      }
      const changeSummaryPre = buildTaskChangeSummary(taskResults, i - 1, fileMap);
      const systemPromptEstimate = 4000;
      const jsonFormatOverhead = 2000;
      const dynamicOverhead = estimateTokens(migrationGuidancePre) + estimateTokens(changeSummaryPre)
        + systemPromptEstimate + jsonFormatOverhead;
      const overheadChars = Math.floor(dynamicOverhead * 3.5);

      const scopeFiles = selectAndPrepareFiles(fileMap, task, userSelections, model, currentState.couplingRegistry, currentState.importGraph, currentState.impactReport, overheadChars);

      if (scopeFiles.length === 0) {
        result.status = "completed";
        result.summary = "No matching files found for this task";
        result.completedAt = new Date();
        continue;
      }

      // Proactively sanitize file content to prevent Azure content filter rejections.
      // This replaces SRI hashes, connection string passwords, tokens, etc. with
      // safe placeholders BEFORE the content is sent to the LLM.
      const { sanitizeForContentFilter } = await import("../services/prompt-sanitizer");
      for (const f of scopeFiles) {
        f.content = sanitizeForContentFilter(f.content, "standard");
      }

      // Filter out no-op selections (same current and target version) — they add noise
      const effectiveSelections = userSelections.filter(s => {
        const cur = (s.currentVersion || "").replace(/^v/i, "").trim();
        const tgt = (s.selectedVersion || "").replace(/^v/i, "").trim();
        return cur !== tgt;
      });

      // Filter selections relevant to this task
      const taskTitle = ((task.title || "") + " " + (task.description || "")).toLowerCase();
      const relevantSelections = effectiveSelections.filter(s => {
        const pkgLower = s.package.toLowerCase();
        if (taskTitle.includes(pkgLower)) return true;
        return scopeFiles.some(f => f.content.toLowerCase().includes(pkgLower));
      });
      const selectionsForPrompt = relevantSelections.length > 0 ? relevantSelections : effectiveSelections;

      // Inject file intelligence headers if available
      const { formatIntelligenceHeader, formatManifestPathMappings } = await import("../services/file-intelligence");
      const fileIntel = currentState.fileIntelligence || {};

      // Separate anchor files (full content, modifiable) from context files (relevant lines, read-only)
      const anchorFiles = scopeFiles.filter(f => !(f as any).contextOnly);
      const contextFiles = scopeFiles.filter(f => (f as any).contextOnly);

      const filesContext = anchorFiles
        .map(f => {
          const intel = fileIntel[f.path];
          let header = "";
          if (intel) {
            header = formatIntelligenceHeader(intel) + "\n";
            const pathMappings = formatManifestPathMappings(intel, f.content);
            if (pathMappings) header += pathMappings + "\n";
          }
          return `${header}=== ${f.path}${f.chunked ? " (chunked)" : ""} ===\n${f.content}`;
        })
        .join("\n\n");

      let contextSection = "";
      if (contextFiles.length > 0) {
        contextSection = "\n\nCONTEXT FILES (read-only — check for consistency, do NOT modify these):\n"
          + contextFiles.map(f => f.content).join("\n\n");
      }

      const selectionsContext = selectionsForPrompt
        .map(s => `${s.package}: ${s.currentVersion} -> ${s.selectedVersion}`)
        .join("\n");

      // Build change summary from previous tasks
      const changeSummary = buildTaskChangeSummary(taskResults, i - 1, fileMap);

      // Include code examples from task planner if available
      let codeExampleSection = "";
      if (task.codeExample?.before && task.codeExample?.after) {
        codeExampleSection = `\nEXAMPLE (before → after):\nBefore:\n${task.codeExample.before}\nAfter:\n${task.codeExample.after}\n`;
      }

      let migrationGuidance = getMigrationGuidance(selectionsForPrompt);

      if (currentState.migrationDocs && Object.keys(currentState.migrationDocs).length > 0) {
        const { formatDocsForCodeUpgrade, extractTaskPackages } = await import("../services/migration-doc-formatter");
        const allPkgNames = Object.keys(currentState.migrationDocs);
        const taskPkgs = extractTaskPackages(
          task.title,
          task.description || "",
          allPkgNames,
        );
        const scopeFilePaths = scopeFiles.map(f => f.path);
        const targeted = formatDocsForCodeUpgrade(
          currentState.migrationDocs,
          taskPkgs,
          scopeFilePaths,
          currentState.migrationDocsIndex,
        );
        if (targeted) {
          // Cap migration docs to avoid token bloat — the task description
          // already contains the key info; docs are supplementary.
          const maxMigDocChars = 4000;
          const trimmed = targeted.length > maxMigDocChars
            ? targeted.slice(0, maxMigDocChars) + "\n... (migration docs truncated)"
            : targeted;
          migrationGuidance += "\n\n" + trimmed;
        }
      }

      // Inject per-file impact reports from P3 analysis (capped to save tokens)
      let impactSection = "";
      if (currentState.impactReport) {
        const { formatImpactReportForFile } = await import("../services/pre-upgrade-impact-analyzer");
        const fileImpacts = scopeFiles
          .filter(f => !(f as any).contextOnly) // only anchor files
          .map(f => formatImpactReportForFile(currentState.impactReport!, f.path))
          .filter(Boolean);
        if (fileImpacts.length > 0) {
          let joined = fileImpacts.join("\n\n");
          if (joined.length > 3000) {
            joined = joined.slice(0, 3000) + "\n... (impact report truncated)";
          }
          impactSection = "\n" + joined + "\n";
        }
      }

      // Build coupling constraint section when this task overlaps with coupling groups
      let couplingConstraint = "";
      if (currentState.couplingRegistry && currentState.couplingRegistry.length > 0) {
        const allTaskPaths = new Set(scopeFiles.map(f => f.path));
        const overlapping = currentState.couplingRegistry.filter(g =>
          g.files.some(gf => allTaskPaths.has(gf))
        );
        if (overlapping.length > 0) {
          const parts = overlapping.map(g =>
            `COUPLING CONSTRAINT for "${g.library}":\n${g.rule}\nFiles in this group: ${g.files.join(", ")}\nDO NOT upgrade some files while leaving others on the old version.`
          );
          couplingConstraint = "\n\n" + parts.join("\n\n") + "\n";
        }
      }

      // Build verification checklist from task verificationCriteria
      let verificationSection = "";
      if (task.verificationCriteria && task.verificationCriteria.length > 0) {
        verificationSection = `\nVERIFICATION CHECKLIST (your output MUST satisfy ALL of these):\n${(task.verificationCriteria as string[]).map((vc: string, idx: number) => `${idx + 1}. ${vc}`).join("\n")}\n`;
      }

      // Build risk context
      let riskSection = "";
      if (task.riskLevel === "high" || task.riskLevel === "medium") {
        riskSection = `\n⚠️ RISK LEVEL: ${task.riskLevel.toUpperCase()} — Be extra careful. Double-check every change against the description. This task has potential to break functionality if done incorrectly.\n`;
      }

      // Build vendor download context so the LLM knows where library files actually live on disk.
      // Generic: works for any tech stack — instructions adapt based on detected web-root convention.
      let vendorPathsSection = "";
      const dlResults = currentState.vendorDownloadResults;
      if (dlResults && dlResults.downloaded && dlResults.downloaded.length > 0) {
        const entries = (dlResults.downloaded as any[]).map(
          (d: any) => `  - ${d.library} @${d.version}: ${d.destination} (${d.type || "file"})`
        );

        // Detect web-root convention from extracted files
        const extractedPaths = (currentState.extractedFiles ?? []).map(f => f.relativePath.replace(/\\/g, "/"));
        const hasWwwroot = extractedPaths.some(p => /^wwwroot\//i.test(p));
        const hasPublic = extractedPaths.some(p => /^public\//i.test(p));
        const hasStaticRoot = extractedPaths.some(p => /^static\//i.test(p));
        let pathConversionHint: string;
        if (hasWwwroot) {
          pathConversionHint = 'Convert destination paths to web references by stripping "wwwroot/" and prepending "~/" (e.g., "wwwroot/lib/bootstrap/css/bootstrap.min.css" → "~/lib/bootstrap/css/bootstrap.min.css").';
        } else if (hasPublic) {
          pathConversionHint = 'Convert destination paths to web references by stripping "public/" (e.g., "public/vendor/bootstrap/bootstrap.min.css" → "/vendor/bootstrap/bootstrap.min.css").';
        } else if (hasStaticRoot) {
          pathConversionHint = 'Convert destination paths to web references by stripping "static/" and using the static files URL prefix configured for your framework (e.g., "/static/vendor/bootstrap.min.css").';
        } else {
          pathConversionHint = 'Convert destination paths to web-accessible URLs according to your project\'s web-root convention. Use the directory structure visible in the file list to determine the correct prefix.';
        }

        vendorPathsSection = `
VENDOR LIBRARY FILE LOCATIONS (already downloaded — these are the ACTUAL paths on disk):
${entries.join("\n")}
IMPORTANT: When modifying layout, template, or view files, ensure all <script src> and <link href> references point to these ACTUAL downloaded paths. Do NOT invent different paths or directory names. ${pathConversionHint}
`;
      }

      // Log selections being used for this task for debugging
      console.log(`[CodeUpgradeAgent] Task ${i + 1} "${task.title}" — selections: ${selectionsForPrompt.map(s => `${s.package}: ${s.currentVersion} → ${s.selectedVersion}`).join(", ")}`);

      const prompt = `You are executing a specific upgrade task as part of a multi-task code modernization pipeline.

MANDATORY TARGET VERSIONS (user-selected — ZERO TOLERANCE for wrong versions):
${selectionsForPrompt.map(s => `  ★ ${s.package}: ${s.currentVersion || "unknown"} → ${s.selectedVersion} [MUST BE EXACTLY ${s.selectedVersion}]`).join("\n")}

CRITICAL: The above versions are ABSOLUTE and NON-NEGOTIABLE. Every single reference to these packages in every output file MUST use EXACTLY these version numbers. Do NOT hallucinate different version numbers. Do NOT substitute versions. If the task description mentions a different version, IGNORE it — ONLY use the versions listed above.
${vendorPathsSection}${migrationGuidance}
${couplingConstraint}${riskSection}
Task: ${task.title}

Description:
${task.description || "No description provided."}

Steps:
${(task.steps || []).map((s: string, idx: number) => `${idx + 1}. ${s}`).join("\n")}
${codeExampleSection}${verificationSection}${changeSummary}${impactSection}

Files to modify (${anchorFiles.length} files):
${filesContext}
${contextSection}

Rules:
1. Use the target versions listed above as the source of truth for ALL version numbers.
2. Apply only the changes required by this specific task.
3. Return complete modified files (not diffs) with all lines included.
4. If a file doesn't need changes for this task, omit it from the output.
5. Preserve existing functionality; only change what the task requires.
6. Do not rename imports, exports, class names, or function names unless migration requires it.
7. Preserve event handlers, navigation logic, and interactive behavior.

VERSION COMPLETENESS CHECK — MANDATORY before returning:
For each target version listed above, verify that EVERY reference to that package in the files has been updated. Specifically check:
- CDN URLs (e.g., code.jquery.com/jquery-VERSION.min.js, cdnjs.cloudflare.com/ajax/libs/LIBRARY/VERSION/)
- Library manifest entries (e.g., "library": "name@VERSION" in libman.json, bower.json)
- Package references (e.g., PackageReference in .csproj, dependency versions in package.json)
- Script/link tag src/href attributes referencing old versions
If ANY old version reference remains for a target package, FIX IT before returning.

Output format (valid JSON):
{
  "modifiedFiles": [
    {
      "path": "exact/file/path",
      "content": "complete file content after changes",
      "changes": ["description of change 1", "description of change 2"]
    }
  ],
  "summary": "Brief summary of what was done",
  "fixedIssues": ["issue 1 fixed", "issue 2 fixed"]
}
Return only valid JSON.`;

      const { buildImportPreservationRule, buildFunctionalPreservationRules } = await import("../prompts/code-upgrade-prompts");

      const systemPrompt = `You are a senior code upgrade specialist executing one task from a multi-task upgrade plan.

CRITICAL RULES:
1. Use the EXACT target versions from the user message. They are authoritative. Do not substitute.
2. Execute steps in order. Satisfy all verification criteria.
3. Return only valid JSON with complete file contents (not diffs).
4. Scan EVERY line of EVERY file. A single missed version reference or deprecated pattern is a failure.
5. ALL version references (CDN URLs, manifest entries, script/link tags, config values) for the target packages MUST be updated to the target version. Leaving ANY old version reference is unacceptable.

Version enforcement:
- Update ALL occurrences: manifest files, CDN <script>/<link> tags, libman.json entries, bower.json entries, package.json entries, config files, inline version comments.
- For CDN URLs: update the version segment in the URL (e.g., jquery-3.3.1.min.js → jquery-3.7.1.min.js).
- For library manifests (libman.json, bower.json): update the version in the library field (e.g., "jquery@3.3.1" → "jquery@3.7.1").
- If a file references a package from the target versions list, its version MUST match the target.

Import/export preservation:
- Preserve all import/using/require statements and public type names unless migration requires renaming (e.g., javax→jakarta).
- Preserve event handlers, navigation, form validation, interactive behavior.

Sanitized placeholders (preserve as-is): [SRI-HASH-REMOVED], [PASSWORD-REDACTED], [SECRET-REDACTED], [TOKEN-REDACTED], [HEX-DATA-REDACTED], [ANTIFORGERY-TOKEN], [HIDDEN-VALUE-REDACTED].`;

      const outputTokens = calculateOutputTokens(scopeFiles, model);

      const budgetBlock = buildBudgetConstraint("codeUpgrade", "code");
      const responseText = await callLLMWithRetry(client, model, [
        { role: "system", content: `${budgetBlock}\n\n${systemPrompt}` },
          { role: "user", content: prompt },
      ], safeMaxTokens(outputTokens, model), true, { analysisId: currentState.analysisId, phase: "execution", agent: "CodeUpgrade" });

      if (!responseText) {
        result.status = "failed";
        result.error = "LLM returned empty response";
        result.summary = "Failed: empty LLM response";
        result.completedAt = new Date();
        continue;
      }

      let validated = parseAndValidateLLMResponse(responseText, scopeFiles);

      // Retry once with higher output tokens if first attempt failed validation
      if (!validated) {
        console.warn(`[CodeUpgradeAgent] Task ${task.id} failed validation on first attempt, retrying with higher token budget...`);
        try {
          const retryOutputTokens = safeMaxTokens(
            Math.floor((MODEL_TOKEN_LIMITS[model] || MODEL_TOKEN_LIMITS["default"]).output * 0.95),
            model,
          );
          const retryResponseText = await callLLMWithRetry(client, model, [
            { role: "system", content: `${budgetBlock}\n\n${systemPrompt}` },
            { role: "user", content: prompt },
          ], retryOutputTokens, true, { analysisId: currentState.analysisId, phase: "execution", agent: "CodeUpgrade" });
          if (retryResponseText) {
            validated = parseAndValidateLLMResponse(retryResponseText, scopeFiles);
          }
        } catch (retryErr) {
          console.warn(`[CodeUpgradeAgent] Retry LLM call failed:`, retryErr instanceof Error ? retryErr.message : retryErr);
        }
      }

      if (!validated) {
        result.status = "failed";
        result.error = "LLM response failed schema validation after retry";
        result.summary = `Failed: invalid JSON response (${responseText.length} chars)`;
        result.completedAt = new Date();
        console.warn(`[CodeUpgradeAgent] Task ${task.id} produced invalid response after retry`);
        continue;
      }

      // Handle "no changes needed" — LLM returned null or empty modifiedFiles
      if (validated.modifiedFiles.length === 0) {
        result.status = "completed";
        result.summary = validated.summary || `No changes needed for: ${task.title}`;
        result.completedAt = new Date();
        console.log(`[CodeUpgradeAgent] Task ${task.id} completed with no file changes`);
        continue;
      }

        const taskModifiedFiles: typeof result.alteredFiles = [];

      for (const mf of validated.modifiedFiles) {
          if (!mf.path || !mf.content) continue;

          const resolvedPath = resolvePathToFileMap(mf.path, fileMap);
        if (!resolvedPath) {
          console.warn(`[CodeUpgradeAgent] Skipping hallucinated path: ${mf.path}`);
          continue;
        }

        const existing = fileMap.get(resolvedPath)!;
        const originalContent = existing.original;

          let content = enforceUserVersions(mf.content, resolvedPath, userSelections);

          const normalizedNew = content.replace(/\r\n/g, "\n").trim();
          const normalizedOrig = originalContent.replace(/\r\n/g, "\n").trim();
        if (normalizedNew === normalizedOrig) continue;

        // Post-LLM import/export validation — REJECT files with unauthorized import renames
        const allowedRenames = currentState.migrationAllowedRenames as Record<string, string> | undefined;
        const deprecatedPkgs = currentState.impactReport?.deprecatedPackages;
        const importValidation = validateImportsPreserved(originalContent, content, resolvedPath, allowedRenames, deprecatedPkgs);
        if (!importValidation.valid) {
          console.warn(`[CodeUpgradeAgent] Import validation violations in ${resolvedPath}:`);
          for (const v of importValidation.violations) {
            console.warn(`  - ${v}`);
          }

          // Try to fix: surgically restore only the incorrectly changed imports
          const fixedContent = restoreOriginalImports(originalContent, content, resolvedPath, allowedRenames);
          if (fixedContent) {
            content = fixedContent;
            currentState = logActivity(
              currentState, "CodeUpgrade",
              `Import auto-fix: ${resolvedPath}`,
              `${importValidation.violations.length} unauthorized rename(s) detected and auto-fixed.`,
              "warning"
            );
          } else {
            console.warn(`[CodeUpgradeAgent] REJECTING changes to ${resolvedPath}: import renames detected, cannot auto-fix`);
            currentState = logActivity(
              currentState, "CodeUpgrade",
              `Import validation REJECTED: ${resolvedPath}`,
              `${importValidation.violations.length} unauthorized rename(s). File reverted to original.`,
              "error"
            );
            continue;
          }
        }

        // POST-LLM: Verify impact items were addressed; auto-fix missed ones deterministically
        if (currentState.impactReport) {
          try {
            const { verifyAndFixImpactItems } = await import("../services/deterministic-transforms");
            const verification = verifyAndFixImpactItems(resolvedPath, content, currentState.impactReport, userSelections, dynamicTransformRules);
            if (verification.wasModified) {
              content = verification.content;
            }
            if (verification.missedItems.length > 0) {
              console.warn(`[CodeUpgradeAgent] Post-LLM verification: ${verification.missedItems.length} items still unresolved in ${resolvedPath}`);
            }
          } catch (verifyErr) {
            console.warn(`[CodeUpgradeAgent] Post-LLM verification failed for ${resolvedPath}:`, verifyErr instanceof Error ? verifyErr.message : verifyErr);
          }
        }

        // Restore sanitized credential/token placeholders from original content.
        // SRI hashes are NOT restored (they're invalid after a CDN URL change).
        const { restoreSanitizedPlaceholders } = await import("../services/prompt-sanitizer");
        content = restoreSanitizedPlaceholders(content, originalContent);

          fileMap.set(resolvedPath, { content, original: originalContent });

          const changeDescs = Array.isArray(mf.changes) ? mf.changes : ["Updated for task"];
          taskModifiedFiles.push({
            path: resolvedPath,
            changeDescription: changeDescs.join("; "),
          linesChanged: countChangedLines(originalContent, content),
          });

        const existingIdx = allModifiedFiles.findIndex(f => f.path === resolvedPath);
          const fileEntry = {
            path: resolvedPath,
            content,
            originalContent,
          changes: selectionsForPrompt
            .filter(s => content.toLowerCase().includes(s.package.toLowerCase()))
            .map(s => ({ package: s.package, oldVersion: s.currentVersion, newVersion: s.selectedVersion })),
        };
        if (existingIdx >= 0) allModifiedFiles[existingIdx] = fileEntry;
        else allModifiedFiles.push(fileEntry);
        }

        result.status = "completed";
      result.summary = validated.summary || `Completed: ${task.title}`;
        result.alteredFiles = taskModifiedFiles;
      result.fixedIssues = validated.fixedIssues || [];
      result.verificationFiles = taskModifiedFiles.map(f => f.path);
        result.completedAt = new Date();

    } catch (err) {
      console.error(`[CodeUpgradeAgent] Task ${task.id} failed:`, err);
      result.status = "failed";
      result.error = err instanceof Error ? err.message : String(err);
      result.summary = `Failed: ${err instanceof Error ? err.message : String(err)}`;
      result.completedAt = new Date();
    }

    currentState.taskExecutionResults = [...taskResults];
    currentState.modifiedFiles = allModifiedFiles.map(f => ({
      path: f.path,
      content: f.content,
      originalContent: f.originalContent,
    }));
    await persistState(currentState);

    // Persist to DB after every task so resume/history works even if server restarts
    try {
      const { stateStore: _ss } = await import("../services/state-store");
      _ss.saveToDb(currentState.analysisId).catch(() => {});
      _ss.savePhaseToDb(currentState.analysisId, "code_upgrade", "in_progress", {
        taskExecutionResults: currentState.taskExecutionResults,
        modifiedFiles: currentState.modifiedFiles ?? [],
      }).catch(() => {});
    } catch { /* non-critical */ }

    if (options?.onProgress) {
      options.onProgress(allModifiedFiles);
    }

    currentState = logActivity(
      currentState, "CodeUpgrade",
      `Task ${i + 1}/${reorderedTasks.length}: ${result.status}`,
      result.summary,
      result.status === "completed" ? "success" : "error"
    );

    // Stop execution on task failure — mark remaining tasks as skipped
    if (result.status === "failed") {
      for (let j = i + 1; j < reorderedTasks.length; j++) {
        taskResults[j].status = "skipped" as any;
        taskResults[j].summary = "Skipped due to previous task failure";
        taskResults[j].completedAt = new Date();
      }
      currentState.taskExecutionResults = [...taskResults];
      await persistState(currentState);
      currentState = logActivity(
        currentState, "CodeUpgrade",
        "Execution halted",
        `Stopped after task ${i + 1} failed. ${reorderedTasks.length - i - 1} remaining tasks skipped.`,
        "warning"
      );
      break;
    }
  }

  // ── FIX 2: Post-execution enforcement sweep ──────────────────────────────
  // The LLM only processes files scoped to each task. Files not in any task
  // scope (or skipped by the LLM) may still contain old version references.
  // Sweep ALL fileMap entries with enforceUserVersions to catch stragglers.
  let sweepCount = 0;
  for (const [filePath, entry] of fileMap.entries()) {
    const enforced = enforceUserVersions(entry.content, filePath, userSelections);
    if (enforced !== entry.content) {
      fileMap.set(filePath, { content: enforced, original: entry.original });
      const existingIdx = allModifiedFiles.findIndex(f => f.path === filePath);
      const fileEntry = {
        path: filePath,
        content: enforced,
        originalContent: entry.original,
        changes: userSelections
          .filter(s => enforced.toLowerCase().includes(s.package.toLowerCase()))
          .map(s => ({ package: s.package, oldVersion: s.currentVersion, newVersion: s.selectedVersion })),
      };
      if (existingIdx >= 0) allModifiedFiles[existingIdx] = fileEntry;
      else allModifiedFiles.push(fileEntry);
      sweepCount++;
    }
  }
  if (sweepCount > 0) {
    console.log(`[CodeUpgradeAgent] Post-execution enforcement sweep: ${sweepCount} additional files enforced`);
    currentState = logActivity(
      currentState, "CodeUpgrade",
      "Post-execution version enforcement sweep",
      `${sweepCount} additional files had version references corrected after LLM processing`,
      "info"
    );
    // Re-persist with sweep results
    currentState.modifiedFiles = allModifiedFiles.map(f => ({
      path: f.path,
      content: f.content,
      originalContent: f.originalContent,
    }));
    await persistState(currentState);
  }

  const completedTasks = taskResults.filter(r => r.status === "completed").length;
  const failedTasks = taskResults.filter(r => r.status === "failed").length;

  // ═══════════════════════════════════════════════════════════════
  // POST-EXECUTION: Double-verify ALL user selections are addressed
  // Sweep all modified files and apply deterministic version enforcement
  // for any selections the LLM missed.
  // ═══════════════════════════════════════════════════════════════

  // Log all CDN references found across all files before the sweep
  const allCdnRefs: Array<{ file: string; library: string; version: string; provider: string }> = [];
  for (const [fp, entry] of fileMap) {
    try {
      const refs = extractCdnVersions(entry.content);
      for (const r of refs) allCdnRefs.push({ file: fp, library: r.library, version: r.version, provider: r.provider });
    } catch { /* ignore */ }
  }
  if (allCdnRefs.length > 0) {
    console.log(`[CodeUpgradeAgent] CDN sweep: found ${allCdnRefs.length} CDN references across ${new Set(allCdnRefs.map(r => r.file)).size} files:`);
    for (const r of allCdnRefs) {
      console.log(`  ${r.file} — ${r.library}@${r.version} (${r.provider})`);
    }
  }

  let postFixCount = 0;
  for (const mf of allModifiedFiles) {
    const beforeEnforce = mf.content;
    let enforced = enforceUserVersions(mf.content, mf.path, userSelections);

    // Also apply CDN version updates to ALL text-based files (not just view files)
    // as a final sweep. The LLM might have missed CDN refs in layout files.
    try {
      const cdnResult = updateCdnVersions(enforced, userSelections);
      if (cdnResult.changes.length > 0) {
        enforced = cdnResult.content;
        for (const change of cdnResult.changes) {
          enforced = removeStaleIntegrityAttributes(enforced, change.library, change.newVersion);
        }
      }
    } catch { /* non-critical */ }

    if (enforced !== beforeEnforce) {
      mf.content = enforced;
      fileMap.set(mf.path, { content: enforced, original: mf.originalContent });
      postFixCount++;
    }
  }

  // Also sweep ORIGINAL files that weren't modified but contain version refs
  // for the selected packages — these are files the LLM completely missed.
  for (const [fp, entry] of fileMap) {
    if (allModifiedFiles.some(m => m.path === fp)) continue;
    const beforeEnforce = entry.content;
    let enforced = enforceUserVersions(entry.content, fp, userSelections);

    try {
      const cdnResult = updateCdnVersions(enforced, userSelections);
      if (cdnResult.changes.length > 0) {
        enforced = cdnResult.content;
        for (const change of cdnResult.changes) {
          enforced = removeStaleIntegrityAttributes(enforced, change.library, change.newVersion);
        }
      }
    } catch { /* non-critical */ }

    if (enforced !== beforeEnforce) {
      fileMap.set(fp, { content: enforced, original: entry.original });
      allModifiedFiles.push({
        path: fp,
        content: enforced,
        originalContent: entry.original,
        changes: userSelections
          .filter(s => enforced.toLowerCase().includes(s.package.toLowerCase()))
          .map(s => ({ package: s.package, oldVersion: s.currentVersion, newVersion: s.selectedVersion })),
      });
      postFixCount++;
    }
  }

  if (postFixCount > 0) {
    console.log(`[CodeUpgradeAgent] CDN sweep: fixed ${postFixCount} file(s) with missed version references`);
    currentState = logActivity(
      currentState, "CodeUpgrade",
      "Post-execution version enforcement",
      `${postFixCount} file(s) had missed version references — deterministically fixed`,
      "warning"
    );
  } else {
    console.log("[CodeUpgradeAgent] CDN sweep: no missed version references found — all CDN refs already up to date");
  }

  // ── Final TFM diagnostic + enforcement ──
  // Log the actual TFM values in .csproj files after ALL enforcement passes,
  // to diagnose cases where the LLM hallucinates a wrong version (e.g., net13.0 vs net10.0).
  const dotnetSel = userSelections.find(s => {
    const pkg = (s.package || "").toLowerCase();
    return pkg.includes(".net") || pkg.includes("dotnet") || pkg === "dotnet";
  });
  if (dotnetSel) {
    const targetVer = (dotnetSel.selectedVersion || "").replace(/^v/i, "").trim();
    const major = parseInt(targetVer.split(".")[0], 10);
    if (major >= 5 && !isNaN(major)) {
      const correctTfm = `net${major}.0`;
      console.log(`[CodeUpgradeAgent] .NET TFM target: package="${dotnetSel.package}" selectedVersion="${dotnetSel.selectedVersion}" → correctTfm="${correctTfm}"`);
      for (const mf of allModifiedFiles) {
        const lowerPath = mf.path.toLowerCase();
        if (lowerPath.endsWith(".csproj") || lowerPath.endsWith(".fsproj") || lowerPath.endsWith(".vbproj")) {
          const tfmMatch = mf.content.match(/<TargetFramework>([^<]+)<\/TargetFramework>/);
          if (tfmMatch) {
            const currentTfm = tfmMatch[1].trim();
            if (currentTfm !== correctTfm) {
              console.warn(`[CodeUpgradeAgent] TFM MISMATCH in ${mf.path}: found "${currentTfm}" but expected "${correctTfm}" — fixing now`);
              mf.content = mf.content.replace(/<TargetFramework>[^<]+<\/TargetFramework>/g,
                `<TargetFramework>${correctTfm}</TargetFramework>`);
            } else {
              console.log(`[CodeUpgradeAgent] TFM OK in ${mf.path}: ${currentTfm}`);
            }
          }
        }
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // CRITICAL: Sync allModifiedFiles back to currentState.modifiedFiles
  // The per-task loop set currentState.modifiedFiles with pre-enforcement data.
  // The post-execution enforcement sweep (above) may have:
  //   (a) fixed versions in existing entries
  //   (b) added NEW files that the LLM skipped entirely
  // We MUST update currentState.modifiedFiles with the final enforced data.
  // ═══════════════════════════════════════════════════════════════
  currentState.modifiedFiles = allModifiedFiles.map(f => ({
    path: f.path,
    content: f.content,
    originalContent: f.originalContent,
  }));
  console.log(`[CodeUpgradeAgent] FINAL modifiedFiles synced: ${allModifiedFiles.length} files (post-enforcement)`);

  currentState.codeUpgrade = {
    modifiedFiles: allModifiedFiles,
    summary: {
      totalFilesModified: allModifiedFiles.length,
      totalPackagesUpgraded: userSelections.length,
      success: failedTasks === 0,
    },
    errors: taskResults.filter(r => r.error).map(r => r.error!),
  };

  currentState = logActivity(
    currentState, "CodeUpgrade", "Task-by-task execution complete",
    `${completedTasks} completed, ${failedTasks} failed, ${allModifiedFiles.length} files modified`,
    failedTasks === 0 ? "success" : "warning"
  );

  return currentState;
}

// ═══════════════════════════════════════════════════════════════
// TASK REORDERING BY DEPENDENCY AND RECOMMENDED UPGRADE ORDER
// ═══════════════════════════════════════════════════════════════

/** Infer which upgradeOrder entry (by index) a task relates to from title/description. */
function taskUpgradeOrderIndex(task: any, upgradeOrder: string[]): number {
  if (!upgradeOrder.length) return 0;
  const text = `${task.title || ""} ${task.description || ""}`.toLowerCase();
  for (let i = 0; i < upgradeOrder.length; i++) {
    const part = upgradeOrder[i];
    // Match package names: ".NET 7 to 10" -> net/dotnet, "Bootstrap 4 to 5" -> bootstrap, "jQuery" -> jquery
    const normalized = part.replace(/\s+/g, " ").toLowerCase();
    if (normalized.includes("net") && (text.includes("net") || text.includes("dotnet") || text.includes(".csproj") || text.includes("c#"))) return i;
    if (normalized.includes("bootstrap") && text.includes("bootstrap")) return i;
    if (normalized.includes("jquery") && text.includes("jquery")) return i;
    if (normalized.includes("react") && text.includes("react")) return i;
    if (normalized.includes("angular") && text.includes("angular")) return i;
    if (normalized.includes("vue") && text.includes("vue")) return i;
    if (normalized.includes("node") && (text.includes("node") || text.includes("package.json") || text.includes("npm"))) return i;
    if (normalized.includes("java") && (text.includes("java") || text.includes("pom.xml") || text.includes("gradle"))) return i;
    if (normalized.includes("python") && (text.includes("python") || text.includes("requirements") || text.includes("pip"))) return i;
    // Generic: if the order string contains a word that appears in the task, consider it a match
    const words = part.split(/[\s.to→-]+/).filter(Boolean).map(w => w.toLowerCase());
    for (const w of words) {
      if (w.length >= 3 && text.includes(w)) return i;
    }
  }
  return upgradeOrder.length; // no match: run after all ordered packages
}

function reorderTasksByDependency(tasks: any[], importGraph?: any, upgradeOrder: string[] = []): any[] {
  const manifestPhase: any[] = [];
  const configPhase: any[] = [];
  const codePhase: any[] = [];

  for (const task of tasks) {
    const patterns = (task.affectedFiles || []) as string[];
    const title = (task.title || "").toLowerCase();
    const isManifest = patterns.some((p: string) => {
      const lower = p.toLowerCase();
      return MANIFEST_NAMES.has(lower) || MANIFEST_EXTENSIONS.has(path.extname(lower)) ||
             lower.includes("package.json") || lower.includes("pom.xml") || lower.includes(".csproj") ||
             lower.includes("build.gradle") || lower.includes("requirements.txt") || lower.includes("cargo.toml") ||
             lower.includes("go.mod") || lower.includes("gemfile") || lower.includes("composer.json");
    }) || title.includes("dependency") || title.includes("package") || title.includes("manifest") ||
         title.includes("nuget") || title.includes("maven") || title.includes("gradle") || title.includes("npm");

    const isConfig = !isManifest && (
      patterns.some((p: string) => CONFIG_NAMES.has(p.toLowerCase())) ||
      title.includes("config") || title.includes("setting") || title.includes("framework")
    );

    if (isManifest) manifestPhase.push(task);
    else if (isConfig) configPhase.push(task);
    else codePhase.push(task);
  }

  const bucketed = [...manifestPhase, ...configPhase, ...codePhase];

  if (upgradeOrder.length === 0) return bucketed;

  // Sort by recommended upgrade order: tasks touching the first package first, then second, etc.
  return [...bucketed].sort((a, b) => {
    const idxA = taskUpgradeOrderIndex(a, upgradeOrder);
    const idxB = taskUpgradeOrderIndex(b, upgradeOrder);
    return idxA - idxB;
  });
}

// ═══════════════════════════════════════════════════════════════
// UTILITIES
// ═══════════════════════════════════════════════════════════════

function countChangedLines(original: string, modified: string): number {
  const origLines = original.split("\n");
  const modLines = modified.split("\n");
  let changed = 0;
  const maxLen = Math.max(origLines.length, modLines.length);
  for (let i = 0; i < maxLen; i++) {
    if ((origLines[i] || "") !== (modLines[i] || "")) changed++;
  }
  return changed;
}

// ═══════════════════════════════════════════════════════════════
// FALLBACK
// ═══════════════════════════════════════════════════════════════

async function executeMonolithicFallback(
  currentState: StackModernizationState,
  userSelections: VersionSelection[],
  options?: CodeUpgradeAgentOptions
): Promise<StackModernizationState> {
  const { executeCodeGenerationLoop } = await import("../services/code-generation-loop");

  currentState = logActivity(currentState, "CodeUpgrade", "Fallback mode", "No tasks available, using code generation loop", "warning");

  const loopResult = await executeCodeGenerationLoop(currentState, userSelections, {
    onProgress: options?.onProgress,
  });

  const modifiedFiles = (loopResult.code || []).map((file: any) => ({
    path: file.path,
    content: file.content,
    originalContent: file.originalContent,
    changes: file.changes || [],
  }));

  currentState.codeUpgrade = {
    modifiedFiles,
    summary: {
      totalFilesModified: modifiedFiles.length,
      totalPackagesUpgraded: userSelections.length,
      success: loopResult.success,
    },
    errors: loopResult.errors || [],
  };

  if (!loopResult.success && modifiedFiles.length === 0) {
    throw new Error(`Code generation failed: ${loopResult.errors[0] || "Unknown error"}`);
  }

  return currentState;
}

// ═══════════════════════════════════════════════════════════════
// INDIVIDUAL TASK RETRY
// ═══════════════════════════════════════════════════════════════

export async function retryFailedTask(
  currentState: StackModernizationState,
  taskId: string,
): Promise<StackModernizationState> {
  const tasks = currentState.upgradeTasks || [];
  const taskResults = currentState.taskExecutionResults || [];
  const userSelections = currentState.userSelections || [];
  const task = tasks.find((t: any) => t.id === taskId);

  if (!task) throw new Error(`Task ${taskId} not found`);

  const existingResultIdx = taskResults.findIndex((r: any) => r.taskId === taskId);
  const existingResult = existingResultIdx >= 0 ? taskResults[existingResultIdx] : null;
  // Allow "failed" or "in_progress" (route handler may have already set in_progress)
  if (existingResult && existingResult.status !== "failed" && existingResult.status !== "in_progress") {
    throw new Error(`Task ${taskId} is not in a retryable state (current: ${existingResult.status})`);
  }

  // Ensure the task is marked as in_progress (may already be set by route handler)
  if (existingResultIdx >= 0 && taskResults[existingResultIdx].status !== "in_progress") {
    taskResults[existingResultIdx] = {
      ...taskResults[existingResultIdx],
      status: "in_progress" as const,
      error: undefined,
      startedAt: new Date(),
      completedAt: undefined,
    };
    currentState.taskExecutionResults = [...taskResults];
    await persistState(currentState);
  }

  if (!currentState.extractedFiles || currentState.extractedFiles.length === 0) {
    throw new Error("No extracted files available for retry");
  }

  const { getLLMClient } = await import("../services/llm-selector");
  const { client, model } = getLLMClient(currentState.llmProvider);

  const fileMap = new Map<string, { content: string; original: string }>();
  for (const f of currentState.extractedFiles) {
    fileMap.set(f.relativePath, { content: f.content, original: f.content });
  }
  // Apply any previously modified file contents so the retry sees current state
  for (const mf of (currentState.modifiedFiles || [])) {
    const existing = fileMap.get(mf.path);
    if (existing) {
      fileMap.set(mf.path, { content: mf.content, original: existing.original });
    }
  }

  // PRE-LLM: Apply deterministic transforms for retry as well
  let retryDynamicRules: import("../services/deterministic-transforms").TransformRule[] = [];
  try {
    const { applyTransformsToFileMap, generateRulesFromMigrationDocs } = await import("../services/deterministic-transforms");

    if (currentState.deterministicRules && currentState.deterministicRules.length > 0) {
      retryDynamicRules = currentState.deterministicRules;
    } else {
      const { fetchAllMigrationDocs } = await import("../services/migration-doc-fetcher");
      const migrationDocs = await fetchAllMigrationDocs(userSelections);
      retryDynamicRules = generateRulesFromMigrationDocs(migrationDocs, userSelections);
    }

    const transformResult = applyTransformsToFileMap(fileMap, userSelections, retryDynamicRules);
    if (transformResult.totalChanges > 0) {
    }
  } catch (err) {
    console.warn("[RetryTask] Pre-LLM deterministic transforms failed (non-blocking):", err instanceof Error ? err.message : err);
  }

  // Dynamic overhead for retry path
  const retryOverheadChars = Math.floor((4000 + 2000) * 3.5);
  const scopeFiles = selectAndPrepareFiles(fileMap, task, userSelections, model, currentState.couplingRegistry, currentState.importGraph, currentState.impactReport, retryOverheadChars);

  if (scopeFiles.length === 0) {
    const result: TaskExecutionResult = {
      taskId, status: "completed",
      summary: "No matching files found for this task (retry)",
      completedAt: new Date(), alteredFiles: [], fixedIssues: [], verificationFiles: [],
    };
    if (existingResultIdx >= 0) taskResults[existingResultIdx] = result;
    else taskResults.push(result);
    currentState.taskExecutionResults = [...taskResults];
    await persistState(currentState);
    return currentState;
  }

  // Build context from completed tasks
  const completedSummaries = taskResults
    .filter((r: any) => r.status === "completed" && r.alteredFiles?.length > 0)
    .map((r: any) => {
      const files = r.alteredFiles.map((f: any) => `  - ${f.path}: ${f.changeDescription || "modified"}`).join("\n");
      return `Task ${r.taskId} (${r.summary?.slice(0, 100) || "done"}):\n${files}`;
    })
    .join("\n");

  const previousErrorContext = existingResult?.error
    ? `\n⚠️ PREVIOUS ATTEMPT FAILED WITH: ${existingResult.error}\nPlease address this issue in your retry.\n`
    : "";

  const { formatIntelligenceHeader, formatManifestPathMappings } = await import("../services/file-intelligence");
  const fileIntel = currentState.fileIntelligence || {};

  const retryAnchorFiles = scopeFiles.filter(f => !(f as any).contextOnly);
  const retryContextFiles = scopeFiles.filter(f => (f as any).contextOnly);

  const filesContext = retryAnchorFiles
    .map(f => {
      const intel = fileIntel[f.path];
      let header = "";
      if (intel) {
        header = formatIntelligenceHeader(intel) + "\n";
        const pathMappings = formatManifestPathMappings(intel, f.content);
        if (pathMappings) header += pathMappings + "\n";
      }
      return `${header}=== ${f.path}${f.chunked ? " (chunked)" : ""} ===\n${f.content}`;
    })
    .join("\n\n");

  let retryContextSection = "";
  if (retryContextFiles.length > 0) {
    retryContextSection = "\n\nCONTEXT FILES (read-only — check for consistency, do NOT modify these):\n"
      + retryContextFiles.map(f => f.content).join("\n\n");
  }

  const selectionsContext = userSelections
    .map(s => `${s.package}: ${s.currentVersion} -> ${s.selectedVersion}`)
    .join("\n");

  // Build verification checklist for retry
  let retryVerification = "";
  if (task.verificationCriteria && task.verificationCriteria.length > 0) {
    retryVerification = `\nVERIFICATION CHECKLIST (your output MUST satisfy ALL of these):\n${(task.verificationCriteria as string[]).map((vc: string, idx: number) => `${idx + 1}. ${vc}`).join("\n")}\n`;
  }

  const prompt = `You are retrying a previously failed upgrade task.

Target versions (user-selected):
${userSelections.map(s => `  ${s.package}: ${s.currentVersion || "unknown"} -> ${s.selectedVersion}`).join("\n")}

Note: Always use the target versions above. If the task description mentions a different version, prefer these.
${previousErrorContext}
Task: ${task.title}

Description:
${task.description || "No description provided."}

Steps:
${(task.steps || []).map((s: string, idx: number) => `${idx + 1}. ${s}`).join("\n")}
${retryVerification}

${completedSummaries ? `Changes already made by other tasks (use as context, do not undo):\n${completedSummaries}` : ""}

Files to modify (${retryAnchorFiles.length} files):
${filesContext}
${retryContextSection}

Return JSON: { "modifiedFiles": [{ "path": "...", "content": "...", "changes": ["..."] }], "summary": "..." }`;

  const systemPrompt = `You are a code upgrade specialist retrying a failed task. Be precise and complete.
Output only valid JSON with the complete file contents (not partial or diff).
Always output the full file content.

Version guidance:
Use these exact versions: ${userSelections.map(s => `${s.package}=${s.selectedVersion}`).join(", ")}
Do not downgrade or use different versions. If the task description references a different version, use the versions above since they were provided by the user.`;

  const outputTokens = calculateOutputTokens(scopeFiles, model);
  const responseText = await callLLMWithRetry(client, model, [
    { role: "system", content: systemPrompt },
    { role: "user", content: prompt },
  ], safeMaxTokens(outputTokens, model), true, { analysisId: currentState.analysisId, phase: "execution", agent: "CodeUpgrade" });

  const validated = parseAndValidateLLMResponse(responseText, scopeFiles.map(f => ({ path: f.path, content: f.content })));

  const result: TaskExecutionResult = {
    taskId,
    status: validated ? "completed" : "failed",
    summary: validated ? (validated.summary || `Retry completed: ${task.title}`) : `Retry failed: invalid JSON response`,
    error: validated ? undefined : "LLM response failed schema validation on retry",
    completedAt: new Date(),
    alteredFiles: [],
    fixedIssues: validated?.fixedIssues || [],
    verificationFiles: [],
  };

  if (validated) {
    const modifiedFiles = currentState.modifiedFiles || [];
    for (const mf of validated.modifiedFiles) {
      if (!mf.path || !mf.content) continue;
      const resolvedPath = resolvePathToFileMap(mf.path, fileMap);
      if (!resolvedPath) continue;

      const existing = fileMap.get(resolvedPath)!;
      const originalContent = existing.original;
      let content = enforceUserVersions(mf.content, resolvedPath, userSelections);

      // Post-LLM import/export validation for retry (was missing before)
      const retryAllowedRenames = currentState.migrationAllowedRenames as Record<string, string> | undefined;
      const retryDeprecatedPkgs = currentState.impactReport?.deprecatedPackages;
      const retryImportValidation = validateImportsPreserved(originalContent, content, resolvedPath, retryAllowedRenames, retryDeprecatedPkgs);
      if (!retryImportValidation.valid) {
        console.warn(`[RetryTask] Import validation violations in ${resolvedPath}:`);
        for (const v of retryImportValidation.violations) {
          console.warn(`  - ${v}`);
        }
        const fixedContent = restoreOriginalImports(originalContent, content, resolvedPath, retryAllowedRenames);
        if (fixedContent) {
          content = fixedContent;
        }
      }

      // POST-LLM: Verify impact items were addressed in retry as well
      if (currentState.impactReport) {
        try {
          const { verifyAndFixImpactItems } = await import("../services/deterministic-transforms");
          const verification = verifyAndFixImpactItems(resolvedPath, content, currentState.impactReport, userSelections, retryDynamicRules);
          if (verification.wasModified) {
            content = verification.content;
          }
        } catch (verifyErr) {
          console.warn(`[RetryTask] Post-LLM verification failed for ${resolvedPath}:`, verifyErr instanceof Error ? verifyErr.message : verifyErr);
        }
      }

      const normalizedNew = content.replace(/\r\n/g, "\n").trim();
      const normalizedOrig = originalContent.replace(/\r\n/g, "\n").trim();
      if (normalizedNew === normalizedOrig) continue;

      fileMap.set(resolvedPath, { content, original: originalContent });

      result.alteredFiles!.push({
        path: resolvedPath,
        changeDescription: (Array.isArray(mf.changes) ? mf.changes : ["Retried upgrade"]).join("; "),
        linesChanged: countChangedLines(originalContent, content),
      });
      result.verificationFiles!.push(resolvedPath);

      const existingFileIdx = modifiedFiles.findIndex((f: any) => f.path === resolvedPath);
      const fileEntry = { path: resolvedPath, content, originalContent };
      if (existingFileIdx >= 0) modifiedFiles[existingFileIdx] = fileEntry;
      else modifiedFiles.push(fileEntry);
    }
    currentState.modifiedFiles = modifiedFiles;
  }

  if (existingResultIdx >= 0) taskResults[existingResultIdx] = result;
  else taskResults.push(result);

  currentState.taskExecutionResults = [...taskResults];
  await persistState(currentState);

  return currentState;
}
