/**
 * Prepare project directory for execution (Docker mount or local run).
 * Prefer full project copy from extracted dir (as uploaded), then overlay upgraded files and generated tests.
 * Fallback: write from state.extractedFiles only when extract dir is not available.
 */

import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import type { StackModernizationState, VersionSelection } from "../types";
import { getExtractedDir } from "./temp-storage";

/**
 * Extract the intended .NET target framework moniker from user version selections.
 * Returns e.g. "net10.0" or "" if no .NET selection found.
 * Broadly matches any .NET-ecosystem selection (runtime, SDK, ASP.NET, EF Core, etc.).
 */
export function resolveIntendedTfm(selections: VersionSelection[] | undefined): string {
  if (!selections) return "";
  const dotnetKeywords = [
    ".net", "dotnet", "netcore", "microsoft.netcore", "asp.net", "aspnet",
    "entity framework", "efcore", "entityframework", "microsoft.aspnetcore",
    "microsoft.entityframeworkcore", "microsoft.extensions", "sdk", "runtime",
  ];
  for (const s of selections) {
    const pkg = (s.package || "").toLowerCase();
    if (pkg === "dotnet" || dotnetKeywords.some(k => pkg.includes(k))) {
      const ver = (s.selectedVersion || "").replace(/^v/i, "").trim();
      const major = parseInt(ver.split(".")[0], 10);
      if (major >= 5) return `net${major}.0`;
    }
  }
  // Fallback: if any selection has a version >= 5 and package starts with "microsoft."
  for (const s of selections) {
    const pkg = (s.package || "").toLowerCase();
    if (pkg.startsWith("microsoft.")) {
      const ver = (s.selectedVersion || "").replace(/^v/i, "").trim();
      const major = parseInt(ver.split(".")[0], 10);
      if (major >= 5) return `net${major}.0`;
    }
  }
  return "";
}

/**
 * Build a map of path -> content from state.modifiedFiles (and codeUpgrade.modifiedFiles).
 */
function resolveStackForScaffold(state: StackModernizationState): "dotnet" | "python" | "java" | "node" | null {
  function normalize(raw: string | undefined): "dotnet" | "python" | "java" | "node" | null {
    if (!raw) return null;
    const l = raw.toLowerCase().trim();
    if (l === "dotnet" || l === ".net" || l === "csharp" || l === "c#") return "dotnet";
    if (l === "python") return "python";
    if (l === "java" || l === "maven" || l === "gradle" || l === "spring" || l === "spring boot") return "java";
    if (l === "node" || l === "nodejs" || l === "javascript" || l === "typescript" || l === "react" || l === "angular" || l === "vue" || l === "express" || l === "nextjs") return "node";
    return null;
  }
  const framework = (state as any).repositoryTree?.framework;
  const fromFramework = normalize(framework);
  if (fromFramework) return fromFramework;
  const pt = (state as any).repoProfile?.projectType;
  const fromPt = normalize(pt);
  if (fromPt) return fromPt;
  const ts = ((state as any).techStack ?? "").toLowerCase();
  const fromTs = normalize(ts);
  if (fromTs) return fromTs;
  const tests = state.generatedTests ?? [];
  if (tests.some((t: any) => (t.filePath || "").endsWith(".cs"))) return "dotnet";
  if (tests.some((t: any) => (t.filePath || "").endsWith(".py"))) return "python";
  if (tests.some((t: any) => (t.filePath || "").endsWith(".java"))) return "java";
  if (tests.some((t: any) => /\.(js|ts|jsx|tsx)$/.test(t.filePath || ""))) return "node";
  return null;
}

function getUpgradedMap(state: StackModernizationState): Map<string, string> {
  const extractedPaths = (state.extractedFiles ?? []).map((f: any) =>
    ((f as any).relativePath ?? (f as any).path ?? "").replace(/\\/g, "/")
  );

  function resolveToCanonical(rawPath: string): string {
    const normalized = rawPath.replace(/\\/g, "/");
    if (extractedPaths.includes(normalized)) return normalized;
    const lower = normalized.toLowerCase();
    for (const ep of extractedPaths) {
      if (ep.toLowerCase() === lower) return ep;
      if (ep.replace(/\\/g, "/").endsWith("/" + normalized)) return ep;
      if (ep.replace(/\\/g, "/").toLowerCase().endsWith("/" + lower)) return ep;
    }
    return normalized;
  }

  const map = new Map<string, string>();
  const modified = state.modifiedFiles ?? (state as any).codeUpgrade?.modifiedFiles ?? [];
  for (const f of modified) {
    const filePath = (f as any).path ?? (f as any).filePath;
    const content = (f as any).content ?? (f as any).modifiedContent;
    if (filePath && content != null) {
      map.set(resolveToCanonical(filePath), String(content));
    }
  }
  return map;
}

/**
 * Prepare a directory on disk with the full project: copy from extracted dir when available,
 * then overlay upgraded files and generated tests. Returns the absolute path to the project root.
 */
export async function prepareProjectDir(
  state: StackModernizationState,
  tempBasePath?: string
): Promise<string> {
  const { stackModConfig } = await import("../config");
  const base = tempBasePath ?? stackModConfig.codeExecutionBaseDir ?? os.tmpdir();
  await fs.mkdir(base, { recursive: true });
  const runId = `stack-mod-${state.analysisId ?? Date.now()}`;
  const projectRoot = path.join(base, runId);
  try {
    await fs.rm(projectRoot, { recursive: true, force: true });
  } catch {}
  await fs.mkdir(projectRoot, { recursive: true });

  const upgradedMap = getUpgradedMap(state);
  const extractedFiles = state.extractedFiles ?? [];

  // Prefer: copy entire extracted project from disk (full folder as uploaded) so structure matches repo
  let usedExtractDir = false;
  if (state.tempDir) {
    const extractDir = getExtractedDir(state.tempDir);
    try {
      await fs.access(extractDir);
      const entries = await fs.readdir(extractDir, { withFileTypes: true });
      if (entries.length > 0) {
        await fs.cp(extractDir, projectRoot, { recursive: true });
        usedExtractDir = true;
      }
    } catch (err) {
      console.warn("[PrepareProjectDir] Could not copy from extractDir, using extractedFiles:", err instanceof Error ? err.message : String(err));
    }
  } else {
    console.warn("[PrepareProjectDir] No state.tempDir; using extractedFiles only.");
  }

  if (!usedExtractDir) {
    // Fallback: write from state.extractedFiles (with upgraded content where applicable)
    for (const file of extractedFiles) {
      const relativePath = (file as any).relativePath ?? (file as any).path;
      if (!relativePath) continue;
      const normalized = relativePath.replace(/\\/g, "/");
      const content = upgradedMap.get(normalized) ?? (file as any).content ?? "";
      const fullPath = path.join(projectRoot, normalized);
      await fs.mkdir(path.dirname(fullPath), { recursive: true });
      await fs.writeFile(fullPath, content, "utf8");
    }
    for (const [filePath, content] of upgradedMap) {
      if (!extractedFiles.some((f: any) => ((f.relativePath ?? f.path) || "").replace(/\\/g, "/") === filePath)) {
        const fullPath = path.join(projectRoot, filePath);
        await fs.mkdir(path.dirname(fullPath), { recursive: true });
        await fs.writeFile(fullPath, content, "utf8");
      }
    }
  } else {
    // Overlay upgraded files on top of copied project
    for (const [filePath, content] of upgradedMap) {
      const fullPath = path.join(projectRoot, filePath);
      await fs.mkdir(path.dirname(fullPath), { recursive: true });
      await fs.writeFile(fullPath, content, "utf8");
    }
  }

  // Always write generated tests (overlay)
  const generatedTests = state.generatedTests ?? [];
  for (const test of generatedTests) {
    const filePath = (test as any).filePath;
    const testCode = (test as any).testCode;
    if (!filePath || testCode == null) continue;
    const normalized = String(filePath).replace(/\\/g, "/");
    const fullPath = path.join(projectRoot, normalized);
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, testCode, "utf8");
  }

  // Resolve the intended TFM early so it can be used by scaffold + force-patch
  const intendedTfm = resolveIntendedTfm(state.userSelections);

  // Scaffold test project so generated tests are discoverable by the test runner
  if (generatedTests.length > 0) {
    const detectedStack = resolveStackForScaffold(state);
    if (detectedStack === "dotnet") {
      await scaffoldDotnetTestProject(projectRoot, generatedTests, intendedTfm);
    } else if (detectedStack === "python") {
      await scaffoldPythonTestDiscovery(projectRoot, generatedTests);
    } else if (detectedStack === "java") {
      await scaffoldJavaTestProject(projectRoot, generatedTests, state);
    } else if (detectedStack === "node") {
      await scaffoldNodeTestProject(projectRoot, generatedTests);
    }
  }

  // Remove user-deleted paths from project root
  const deletedPaths = (state as any).deletedPaths ?? [];
  for (const rel of deletedPaths) {
    const normalized = String(rel).replace(/\\/g, "/");
    if (!normalized) continue;
    const fullPath = path.join(projectRoot, normalized);
    try {
      await fs.rm(fullPath, { force: true });
    } catch (e) {
      console.warn("[PrepareProjectDir] Could not delete deletedPath:", normalized, e instanceof Error ? e.message : String(e));
    }
  }

  // Force-patch TargetFramework if user selected a specific .NET version
  if (intendedTfm) {
    await forcePatchTargetFramework(projectRoot, intendedTfm);
  }

  // Fix .NET SDK duplicate Compile items (NETSDK1022): SDK-style projects that still have
  // explicit <Compile Include="..."> get EnableDefaultCompileItems=false so build succeeds.
  await patchDotnetCsprojDuplicateCompile(projectRoot);

  // Fix NuGet issues: remove packages absorbed into shared framework, fix version inconsistencies.
  await patchDotnetNugetIssues(projectRoot, intendedTfm);

  // Detect libman.json and log client-side libraries for downstream agents
  await detectAndLogLibManManifests(projectRoot);

  // Final safety net: ensure every .csproj (including test projects) uses the same TFM
  if (intendedTfm) {
    await validateTfmConsistency(projectRoot, intendedTfm);
  }

  return path.resolve(projectRoot);
}

/**
 * Detect libman.json files in the project and log the libraries they manage.
 * This helps downstream agents (dependency install, build) know they need to run `libman restore`.
 */
async function detectAndLogLibManManifests(projectRoot: string): Promise<void> {
  const libmanFiles = await findFilesByName(projectRoot, "", 5, "libman.json");
  if (libmanFiles.length === 0) return;

  for (const rel of libmanFiles) {
    const fullPath = path.join(projectRoot, rel);
    try {
      const content = await fs.readFile(fullPath, "utf8");
      const parsed = JSON.parse(content);
      const libraries = parsed.libraries || [];
      const names = libraries.map((lib: any) => lib.library || lib.name || "unknown");

      // Validate each library entry has a "files" array (warn if missing — will download entire source tree)
      for (const lib of libraries) {
        const libName = lib.library || lib.name || "unknown";
        if (!lib.files || !Array.isArray(lib.files) || lib.files.length === 0) {
          console.warn(`[PrepareProjectDir] WARNING: Library "${libName}" in ${rel} has no "files" array — libman restore will download entire package (including source). This may cause unstyled UI.`);
        }
      }
    } catch {
      console.warn(`[PrepareProjectDir] Could not parse libman.json at ${rel}`);
    }
  }
}

/** Recursively find files with a specific name under dir (max depth). */
async function findFilesByName(dir: string, relativeDir: string, depth: number, targetName: string): Promise<string[]> {
  if (depth <= 0) return [];
  const out: string[] = [];
  const entries = await fs.readdir(path.join(dir, relativeDir), { withFileTypes: true }).catch(() => []);
  for (const e of entries) {
    const rel = relativeDir ? `${relativeDir}/${e.name}` : e.name;
    if (e.isDirectory()) {
      out.push(...(await findFilesByName(dir, rel, depth - 1, targetName)));
    } else if (e.name.toLowerCase() === targetName.toLowerCase()) {
      out.push(rel.replace(/\\/g, "/"));
    }
  }
  return out;
}

/**
 * Recursively find .csproj files under dir (max depth 5).
 */
async function findCsprojFiles(dir: string, relativeDir: string, depth: number): Promise<string[]> {
  if (depth <= 0) return [];
  const out: string[] = [];
  const entries = await fs.readdir(path.join(dir, relativeDir), { withFileTypes: true }).catch(() => []);
  for (const e of entries) {
    const rel = relativeDir ? `${relativeDir}/${e.name}` : e.name;
    if (e.isDirectory()) {
      out.push(...(await findCsprojFiles(dir, rel, depth - 1)));
    } else if (e.name.toLowerCase().endsWith(".csproj")) {
      out.push(rel.replace(/\\/g, "/"));
    }
  }
  return out;
}

/**
 * Force-patch all .csproj TargetFramework to the intended version from user selections.
 * E.g. if user selected .NET 10 but LLM wrote net8.0, rewrite to net10.0.
 */
async function forcePatchTargetFramework(projectRoot: string, intendedTfm: string): Promise<void> {
  if (!intendedTfm) return;
  const csprojPaths = await findCsprojFiles(projectRoot, "", 5);
  for (const rel of csprojPaths) {
    const fullPath = path.join(projectRoot, rel);
    try {
      let content = await fs.readFile(fullPath, "utf8");
      const tfMatch = content.match(/<TargetFramework>\s*(net[\d.]+)\s*<\/TargetFramework>/i);
      if (tfMatch && tfMatch[1] !== intendedTfm) {
        content = content.replace(
          /<TargetFramework>\s*net[\d.]+\s*<\/TargetFramework>/gi,
          `<TargetFramework>${intendedTfm}</TargetFramework>`
        );
        await fs.writeFile(fullPath, content, "utf8");
      }
    } catch { /* skip */ }
  }
}

/**
 * Final safety net: read ALL .csproj files (including test projects) and ensure
 * every single one uses the exact same TFM. Patches any mismatches.
 */
async function validateTfmConsistency(projectRoot: string, intendedTfm: string): Promise<void> {
  if (!intendedTfm) return;
  const csprojPaths = await findCsprojFiles(projectRoot, "", 8);
  let patchCount = 0;
  for (const rel of csprojPaths) {
    const fullPath = path.join(projectRoot, rel);
    try {
      let content = await fs.readFile(fullPath, "utf8");
      const allTfms = [...content.matchAll(/<TargetFramework>\s*(net[\d.]+)\s*<\/TargetFramework>/gi)];
      for (const m of allTfms) {
        if (m[1] !== intendedTfm) {
          content = content.replace(
            /<TargetFramework>\s*net[\d.]+\s*<\/TargetFramework>/gi,
            `<TargetFramework>${intendedTfm}</TargetFramework>`
          );
          await fs.writeFile(fullPath, content, "utf8");
          console.warn(`[ValidateTfmConsistency] MISMATCH in ${rel}: ${m[1]} → ${intendedTfm}`);
          patchCount++;
          break;
        }
      }
    } catch { /* skip */ }
  }
  if (patchCount > 0) {
    console.warn(`[ValidateTfmConsistency] Patched ${patchCount} .csproj file(s) to enforce ${intendedTfm}`);
  } else {
  }
}

/**
 * Ensure .csproj has a single root element (fix MSB4025 "multiple root elements").
 * Keeps only content up to and including the first </Project>, discarding any trailing junk or duplicate roots.
 */
function sanitizeCsprojSingleRoot(content: string): string {
  const trimmed = content.replace(/^\uFEFF/, "").trim();
  const closeIdx = trimmed.indexOf("</Project>");
  if (closeIdx === -1) return trimmed;
  return trimmed.slice(0, closeIdx + "</Project>".length);
}

/**
 * Patch SDK-style .csproj files:
 * - Fix multiple root elements (MSB4025) by keeping only the first <Project>...</Project>.
 * - When there are explicit <Compile Include=>, set EnableDefaultCompileItems=false (fix NETSDK1022).
 * - Set GenerateAssemblyInfo=false when we have explicit Compile so the SDK does not generate
 *   obj/.../AssemblyInfo.cs and duplicate assembly attributes (CS0579) with Properties/AssemblyInfo.cs.
 * Exported so run-command can patch existing run directories on first dotnet command.
 */
export async function patchDotnetCsprojDuplicateCompile(projectRoot: string): Promise<void> {
  const csprojPaths = await findCsprojFiles(projectRoot, "", 5);
  for (const rel of csprojPaths) {
    const fullPath = path.join(projectRoot, rel);
    let content: string;
    try {
      content = await fs.readFile(fullPath, "utf8");
    } catch {
      continue;
    }
    // Fix MSB4025: multiple root elements
    const sanitized = sanitizeCsprojSingleRoot(content);
    if (sanitized !== content) {
      await fs.writeFile(fullPath, sanitized, "utf8");
      content = sanitized;
    }

    const isSdk = /Sdk\s*=\s*["']Microsoft\.NET\.Sdk["']/i.test(content);
    const hasExplicitCompile = /<Compile\s+Include\s*=/i.test(content);
    const hasEnableDefault = /EnableDefaultCompileItems/i.test(content);
    const hasGenerateAssemblyInfo = /GenerateAssemblyInfo/i.test(content);
    if (!isSdk || !hasExplicitCompile) continue;
    const propsToAdd: string[] = [];
    if (!hasEnableDefault) propsToAdd.push("<EnableDefaultCompileItems>false</EnableDefaultCompileItems>");
    if (!hasGenerateAssemblyInfo) propsToAdd.push("<GenerateAssemblyInfo>false</GenerateAssemblyInfo>");
    if (propsToAdd.length === 0) continue;
    // Insert at start of first PropertyGroup
    const inserted = content.replace(
      /(<PropertyGroup[^>]*>)/i,
      `$1\n    ${propsToAdd.join("\n    ")}`
    );
    if (inserted !== content) {
      await fs.writeFile(fullPath, inserted, "utf8");
    }
  }
}

/**
 * Packages that were absorbed into the ASP.NET Core shared framework in .NET Core 3.0+
 * and should be REMOVED from PackageReference when TargetFramework >= net6.0.
 */
const SHARED_FRAMEWORK_PACKAGES = new Set([
  "microsoft.aspnetcore.session",
  "microsoft.aspnetcore.http",
  "microsoft.aspnetcore.http.abstractions",
  "microsoft.aspnetcore.http.extensions",
  "microsoft.aspnetcore.diagnostics",
  "microsoft.aspnetcore.diagnostics.entityframeworkcore",
  "microsoft.aspnetcore.hosting",
  "microsoft.aspnetcore.hosting.abstractions",
  "microsoft.aspnetcore.server.kestrel",
  "microsoft.aspnetcore.server.iis",
  "microsoft.aspnetcore.server.iisintegration",
  "microsoft.aspnetcore.staticfiles",
  "microsoft.aspnetcore.routing",
  "microsoft.aspnetcore.mvc",
  "microsoft.aspnetcore.mvc.core",
  "microsoft.aspnetcore.mvc.viewfeatures",
  "microsoft.aspnetcore.mvc.taghelpers",
  "microsoft.aspnetcore.mvc.razor",
  "microsoft.aspnetcore.razor",
  "microsoft.aspnetcore.razor.runtime",
  "microsoft.aspnetcore.identity",
  "microsoft.aspnetcore.authentication",
  "microsoft.aspnetcore.authorization",
  "microsoft.aspnetcore.cors",
  "microsoft.aspnetcore.cryptography.keyderivation",
  "microsoft.aspnetcore.responsecaching",
  "microsoft.aspnetcore.responsecompression",
  "microsoft.aspnetcore.websockets",
  "microsoft.aspnetcore.cookiepolicy",
  "microsoft.extensions.logging",
  "microsoft.extensions.logging.abstractions",
  "microsoft.extensions.configuration",
  "microsoft.extensions.configuration.abstractions",
  "microsoft.extensions.dependencyinjection",
  "microsoft.extensions.dependencyinjection.abstractions",
  "microsoft.extensions.options",
  "microsoft.extensions.caching.memory",
  "microsoft.extensions.caching.abstractions",
  "microsoft.extensions.primitives",
  "microsoft.extensions.fileproviders.physical",
  "microsoft.extensions.filesystemglobbing",
  "microsoft.extensions.hosting.abstractions",
  "microsoft.aspnetcore.antiforgery",
  "microsoft.aspnetcore.dataprotection",
  "microsoft.aspnetcore.dataprotection.abstractions",
]);

/**
 * Extract the major version number from a NuGet package version string (e.g. "10.0.3" → 10).
 */
function pkgMajor(version: string): number {
  return parseInt(version.split(".")[0], 10) || 0;
}

/**
 * Fix NuGet issues in .csproj files:
 * 1. Remove packages absorbed into the shared framework (NU1102 for version >= 8.0).
 * 2. Harmonize EF Core package versions across the solution — respecting TargetFramework.
 * 3. Patch global.json rollForward in subdirectories.
 */
export async function patchDotnetNugetIssues(projectRoot: string, intendedTfm?: string): Promise<void> {
  const csprojPaths = await findCsprojFiles(projectRoot, "", 5);

  // If user selected a specific TFM, use it as the authoritative version
  const intendedMajor = intendedTfm ? parseInt(intendedTfm.replace("net", ""), 10) || 0 : 0;

  // ── Pass 1: Determine solution-wide TargetFramework and collect EF Core versions ──
  const efCoreRefPattern = /<PackageReference\s+Include="(Microsoft\.EntityFrameworkCore[^"]*)"\s+Version="([^"]+)"\s*\/>/gi;
  let lowestTfmMajor = 99;
  const allEfVersions: string[] = [];

  for (const rel of csprojPaths) {
    let content: string;
    try { content = await fs.readFile(path.join(projectRoot, rel), "utf8"); } catch { continue; }

    const tfMatch = content.match(/<TargetFramework>\s*(net\d+\.\d+)\s*<\/TargetFramework>/i);
    const tfmMajor = parseInt((tfMatch?.[1] ?? "").replace("net", ""), 10) || 0;
    if (tfmMajor > 0 && tfmMajor < lowestTfmMajor) lowestTfmMajor = tfmMajor;

    let m: RegExpExecArray | null;
    efCoreRefPattern.lastIndex = 0;
    while ((m = efCoreRefPattern.exec(content)) !== null) {
      allEfVersions.push(m[2]);
    }
  }

  if (lowestTfmMajor === 99) lowestTfmMajor = 0;

  // If user specified an intended TFM, override the on-disk TFM
  if (intendedMajor > 0) {
    if (lowestTfmMajor !== intendedMajor) {
    }
    lowestTfmMajor = intendedMajor;
  }

  // EF Core major must match TFM major (EF 8.x for net8.0, EF 10.x for net10.0)
  // Filter versions to those compatible with the TFM, then pick the highest
  const compatibleVersions = allEfVersions.filter((v) => pkgMajor(v) <= lowestTfmMajor);
  const incompatibleVersions = allEfVersions.filter((v) => pkgMajor(v) > lowestTfmMajor);

  let targetEfVersion: string;
  if (compatibleVersions.length > 0) {
    targetEfVersion = compatibleVersions.reduce((a, b) =>
      b.localeCompare(a, undefined, { numeric: true }) > 0 ? b : a
    );
  } else if (lowestTfmMajor > 0) {
    // No compatible version found — create one from TFM (e.g. net8.0 → "8.0.0")
    targetEfVersion = `${lowestTfmMajor}.0.0`;
  } else {
    targetEfVersion = "";
  }

  if (incompatibleVersions.length > 0) {
  }

  // ── Pass 2: Patch each .csproj ──
  for (const rel of csprojPaths) {
    const fullPath = path.join(projectRoot, rel);
    let content: string;
    try {
      content = await fs.readFile(fullPath, "utf8");
    } catch {
      continue;
    }

    const tfMatch = content.match(/<TargetFramework>\s*(net\d+\.\d+)\s*<\/TargetFramework>/i);
    const majorVersion = parseInt((tfMatch?.[1] ?? "").replace("net", ""), 10) || 0;
    const isModernDotNet = majorVersion >= 6;

    let modified = false;

    // 1. Remove shared framework packages (NU1102 on .NET 6+)
    if (isModernDotNet) {
      const packageRefRegex = /<PackageReference\s+Include="([^"]+)"\s+Version="([^"]*)"\s*\/>/gi;
      let match: RegExpExecArray | null;
      const toRemove: string[] = [];
      while ((match = packageRefRegex.exec(content)) !== null) {
        const pkgName = match[1].toLowerCase();
        const pkgVer = match[2];
        const verMajor = parseInt(pkgVer.split(".")[0], 10) || 0;

        // Explicitly listed absorbed packages — always remove
        if (SHARED_FRAMEWORK_PACKAGES.has(pkgName)) {
          toRemove.push(match[0]);
          continue;
        }

        // Catch-all: any Microsoft.AspNetCore.* package with version >= 6.0 that
        // doesn't actually exist on NuGet (these were absorbed into the shared framework).
        // Packages like Microsoft.AspNetCore.Session last shipped at 2.3.9 — versions
        // 6.x, 8.x, 10.x etc. don't exist and cause NU1102.
        if (pkgName.startsWith("microsoft.aspnetcore.") && verMajor >= 6) {
          const ACTIVE_ASPNETCORE_PACKAGES = new Set([
            "microsoft.aspnetcore.authentication.jwtbearer",
            "microsoft.aspnetcore.authentication.openidconnect",
            "microsoft.aspnetcore.authentication.negotiate",
            "microsoft.aspnetcore.authentication.certificate",
            "microsoft.aspnetcore.components",
            "microsoft.aspnetcore.components.web",
            "microsoft.aspnetcore.components.webassembly",
            "microsoft.aspnetcore.grpc.jsonttranscoding",
            "microsoft.aspnetcore.identity.entityframeworkcore",
            "microsoft.aspnetcore.identity.ui",
            "microsoft.aspnetcore.mvc.testing",
            "microsoft.aspnetcore.openapi",
            "microsoft.aspnetcore.signalr.client",
            "microsoft.aspnetcore.signalr.protocols.messagepack",
            "microsoft.aspnetcore.spa.proxy",
            "microsoft.aspnetcore.testhost",
            "microsoft.aspnetcore.odata",
          ]);
          if (!ACTIVE_ASPNETCORE_PACKAGES.has(pkgName)) {
            toRemove.push(match[0]);
            continue;
          }
        }
      }
      for (const ref of toRemove) {
        content = content.replace(ref, `<!-- Removed: absorbed into shared framework -->`);
        modified = true;
      }
    }

    // 2. Harmonize EF Core versions — capped to TFM-compatible version
    if (targetEfVersion) {
      const efPattern = /(<PackageReference\s+Include="(Microsoft\.EntityFrameworkCore[^"]*)")\s+Version="([^"]+)"\s*\/>/gi;
      let efMatch: RegExpExecArray | null;
      const replacements: Array<{ from: string; to: string; name: string; oldVer: string }> = [];
      while ((efMatch = efPattern.exec(content)) !== null) {
        if (efMatch[3] !== targetEfVersion) {
          replacements.push({
            from: efMatch[0],
            to: efMatch[0].replace(`Version="${efMatch[3]}"`, `Version="${targetEfVersion}"`),
            name: efMatch[2],
            oldVer: efMatch[3],
          });
        }
      }
      for (const r of replacements) {
        content = content.replace(r.from, r.to);
        modified = true;
        const direction = r.oldVer.localeCompare(targetEfVersion, undefined, { numeric: true }) > 0 ? "↓" : "↑";
      }
    }

    if (modified) {
      await fs.writeFile(fullPath, content, "utf8");
    }
  }

  // 3. Patch global.json in all subdirectories (not just project root)
  await patchGlobalJsonRecursive(projectRoot, 4);
}

/**
 * Create a DevX_testScripts.csproj inside the DevX_testScripts folder so ALL generated
 * .cs test files are automatically discovered by `dotnet test`. SDK-style projects
 * auto-include all .cs files in the directory tree.
 */
async function scaffoldDotnetTestProject(projectRoot: string, generatedTests: any[], intendedTfm: string = ""): Promise<void> {
  const testDir = path.join(projectRoot, "DevX_testScripts");
  try { await fs.access(testDir); } catch {
    await fs.mkdir(testDir, { recursive: true });
  }

  const csTestFiles = generatedTests.filter((t: any) => (t.filePath || "").endsWith(".cs"));
  if (csTestFiles.length === 0) return;

  // Use the user-selected TFM; only fall back to detection if not provided
  const csprojPaths = await findCsprojFiles(projectRoot, "", 5);
  let targetFramework = intendedTfm || "net8.0";
  const projectRefs: string[] = [];
  const detectedPackages = new Set<string>();
  for (const rel of csprojPaths) {
    if (rel.toLowerCase().includes("devx_testscripts") || rel.toLowerCase().includes("generatedtests")) continue;
    const fullPath = path.join(projectRoot, rel);
    try {
      const content = await fs.readFile(fullPath, "utf8");
      const tfMatch = content.match(/<TargetFramework>\s*(net\d+\.\d+)\s*<\/TargetFramework>/i);
      // Only use detected TFM if user didn't provide a specific one
      if (tfMatch && !intendedTfm) targetFramework = tfMatch[1];
      // Add a ProjectReference for EVERY project in the solution so tests can reference any namespace
      const relToTestDir = path.relative(testDir, fullPath).replace(/\\/g, "/");
      projectRefs.push(`<ProjectReference Include="${relToTestDir}" />`);
      // Detect if project uses EF Core or ASP.NET to add matching test packages
      if (content.includes("EntityFrameworkCore")) detectedPackages.add("efcore");
      if (content.includes("Microsoft.NET.Sdk.Web") || content.includes("AspNetCore")) detectedPackages.add("aspnet");
    } catch { /* skip */ }
  }

  // Build extra package references based on what the projects use
  const extraPackages: string[] = [];
  if (detectedPackages.has("efcore")) {
    const efMajor = targetFramework.replace("net", "").split(".")[0];
    extraPackages.push(`<PackageReference Include="Microsoft.EntityFrameworkCore.InMemory" Version="${efMajor}.*" />`);
  }
  if (detectedPackages.has("aspnet")) {
    extraPackages.push(`<PackageReference Include="Microsoft.AspNetCore.Mvc.Testing" Version="${targetFramework.replace("net", "").split(".")[0]}.*" />`);
  }

  const projectRefBlock = projectRefs.length > 0
    ? `<ItemGroup>\n    ${projectRefs.join("\n    ")}\n  </ItemGroup>`
    : "";

  const csprojContent = `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <TargetFramework>${targetFramework}</TargetFramework>
    <IsPackable>false</IsPackable>
    <ImplicitUsings>enable</ImplicitUsings>
    <Nullable>enable</Nullable>
  </PropertyGroup>
  <ItemGroup>
    <PackageReference Include="Microsoft.NET.Test.Sdk" Version="17.*" />
    <PackageReference Include="xunit" Version="2.*" />
    <PackageReference Include="xunit.runner.visualstudio" Version="2.*" />
    <PackageReference Include="Moq" Version="4.*" />
    ${extraPackages.join("\n    ")}
  </ItemGroup>
  ${projectRefBlock}
</Project>
`;
  await fs.writeFile(path.join(testDir, "DevX_testScripts.csproj"), csprojContent, "utf8");

  // Add to .sln if one exists
  const slnFiles = await findSlnFiles(projectRoot, "", 3);
  for (const slnRel of slnFiles) {
    const slnFull = path.join(projectRoot, slnRel);
    try {
      let slnContent = await fs.readFile(slnFull, "utf8");
      if (slnContent.includes("DevX_testScripts")) continue;
      const testCsprojRelToSln = path.relative(path.dirname(slnFull), path.join(testDir, "DevX_testScripts.csproj")).replace(/\\/g, "\\");
      const guid = "AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE";
      const faqGuid = "FAE04EC0-301F-11D3-BF4B-00C04F79EFBC";
      const projBlock = `\nProject("{${faqGuid}}") = "DevX_testScripts", "${testCsprojRelToSln}", "{${guid}}"\nEndProject\n`;
      slnContent = slnContent.replace(/(Global\r?\n)/, projBlock + "$1");
      await fs.writeFile(slnFull, slnContent, "utf8");
    } catch (err) {
      console.warn("[PrepareProjectDir] Could not add to .sln:", err instanceof Error ? err.message : String(err));
    }
  }
}

async function findSlnFiles(dir: string, relativeDir: string, depth: number): Promise<string[]> {
  if (depth <= 0) return [];
  const out: string[] = [];
  const entries = await fs.readdir(path.join(dir, relativeDir), { withFileTypes: true }).catch(() => []);
  for (const e of entries) {
    const rel = relativeDir ? `${relativeDir}/${e.name}` : e.name;
    if (e.isDirectory()) {
      out.push(...(await findSlnFiles(dir, rel, depth - 1)));
    } else if (e.name.toLowerCase().endsWith(".sln")) {
      out.push(rel.replace(/\\/g, "/"));
    }
  }
  return out;
}

/**
 * Ensure generated Python test files are discoverable by pytest.
 * Creates a conftest.py and requirements.txt for pytest if needed.
 */
async function scaffoldPythonTestDiscovery(projectRoot: string, generatedTests: any[]): Promise<void> {
  const testDirs = new Set<string>();
  for (const t of generatedTests) {
    const filePath = (t as any).filePath;
    if (!filePath) continue;
    const dir = path.dirname(path.join(projectRoot, filePath.replace(/\\/g, "/")));
    testDirs.add(dir);
  }

  for (const dir of testDirs) {
    const conftestPath = path.join(dir, "conftest.py");
    try {
      await fs.access(conftestPath);
    } catch {
      await fs.mkdir(dir, { recursive: true });
      // Compute the relative depth from the test dir to the project root
      const relToRoot = path.relative(dir, projectRoot).replace(/\\/g, "/");
      const depthSegments = relToRoot.split("/").filter(Boolean).map(() => "'..'").join(", ");
      const confContent = `# Auto-generated conftest for pytest discovery\nimport sys, os\n_project_root = os.path.abspath(os.path.join(os.path.dirname(__file__), ${depthSegments}))\nif _project_root not in sys.path:\n    sys.path.insert(0, _project_root)\n`;
      await fs.writeFile(conftestPath, confContent, "utf8");
    }
  }

  // Ensure pytest is in requirements
  const reqPath = path.join(projectRoot, "requirements-test.txt");
  try {
    await fs.access(reqPath);
  } catch {
    await fs.writeFile(reqPath, "pytest>=7.0\npytest-cov>=4.0\n", "utf8");
  }
}

/**
 * Scaffold a Maven test project so JUnit 5 tests in DevX_testScripts are discoverable by `mvn test`.
 */
async function scaffoldJavaTestProject(projectRoot: string, generatedTests: any[], state: any): Promise<void> {
  const testDir = path.join(projectRoot, "DevX_testScripts");
  try { await fs.access(testDir); } catch {
    await fs.mkdir(testDir, { recursive: true });
  }

  const javaTestFiles = generatedTests.filter((t: any) => (t.filePath || "").endsWith(".java"));
  if (javaTestFiles.length === 0) return;

  // Detect Java version from the parent pom.xml or state
  let javaVersion = "17";
  const runtimeInfo = state?.repoProfile?.runtimeInfo;
  if (runtimeInfo) {
    const javaRt = runtimeInfo.find((r: any) => r.language === "java");
    if (javaRt?.version) {
      const ver = String(javaRt.version).replace(/^1\./, "").split(".")[0];
      if (parseInt(ver, 10) >= 8) javaVersion = ver;
    }
  }

  // Read parent pom to extract groupId/dependencies if possible
  let parentGroupId = "com.example";
  let parentArtifactId = "parent-project";
  let parentVersion = "1.0-SNAPSHOT";
  const parentPomPath = path.join(projectRoot, "pom.xml");
  try {
    const parentPom = await fs.readFile(parentPomPath, "utf8");
    const gid = parentPom.match(/<groupId>\s*(.*?)\s*<\/groupId>/);
    const aid = parentPom.match(/<artifactId>\s*(.*?)\s*<\/artifactId>/);
    const ver = parentPom.match(/<version>\s*(.*?)\s*<\/version>/);
    if (gid) parentGroupId = gid[1];
    if (aid) parentArtifactId = aid[1];
    if (ver) parentVersion = ver[1];
  } catch { /* no parent pom */ }

  // The generated tests may import classes from the main project. To make compilation work,
  // we reference the main project as a dependency.
  const pomContent = `<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0"
         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:schemaLocation="http://maven.apache.org/POM/4.0.0 http://maven.apache.org/xsd/maven-4.0.0.xsd">
  <modelVersion>4.0.0</modelVersion>
  <groupId>devx.testscripts</groupId>
  <artifactId>devx-test-scripts</artifactId>
  <version>1.0-SNAPSHOT</version>
  <properties>
    <maven.compiler.source>${javaVersion}</maven.compiler.source>
    <maven.compiler.target>${javaVersion}</maven.compiler.target>
    <project.build.sourceEncoding>UTF-8</project.build.sourceEncoding>
  </properties>
  <dependencies>
    <dependency>
      <groupId>org.junit.jupiter</groupId>
      <artifactId>junit-jupiter</artifactId>
      <version>5.10.2</version>
      <scope>test</scope>
    </dependency>
    <dependency>
      <groupId>org.mockito</groupId>
      <artifactId>mockito-core</artifactId>
      <version>5.11.0</version>
      <scope>test</scope>
    </dependency>
    <dependency>
      <groupId>org.mockito</groupId>
      <artifactId>mockito-junit-jupiter</artifactId>
      <version>5.11.0</version>
      <scope>test</scope>
    </dependency>
    <dependency>
      <groupId>${parentGroupId}</groupId>
      <artifactId>${parentArtifactId}</artifactId>
      <version>${parentVersion}</version>
    </dependency>
  </dependencies>
  <build>
    <plugins>
      <plugin>
        <groupId>org.apache.maven.plugins</groupId>
        <artifactId>maven-surefire-plugin</artifactId>
        <version>3.2.5</version>
      </plugin>
    </plugins>
  </build>
</project>
`;
  const devxPomPath = path.join(testDir, "pom.xml");
  try {
    await fs.access(devxPomPath);
  } catch {
    await fs.writeFile(devxPomPath, pomContent, "utf8");
  }
}

/**
 * Scaffold a Node.js test project so Jest tests in DevX_testScripts are discoverable by `npx jest`.
 */
async function scaffoldNodeTestProject(projectRoot: string, generatedTests: any[]): Promise<void> {
  const testDir = path.join(projectRoot, "DevX_testScripts");
  try { await fs.access(testDir); } catch {
    await fs.mkdir(testDir, { recursive: true });
  }

  const jsTestFiles = generatedTests.filter((t: any) => /\.(js|ts|jsx|tsx)$/.test(t.filePath || ""));
  if (jsTestFiles.length === 0) return;

  const hasTs = jsTestFiles.some((t: any) => /\.tsx?$/.test(t.filePath || ""));

  // Check if the root project already has jest + package.json
  const rootPkgPath = path.join(projectRoot, "package.json");
  let rootHasJest = false;
  try {
    const rootPkg = JSON.parse(await fs.readFile(rootPkgPath, "utf8"));
    const allDeps = { ...rootPkg.dependencies, ...rootPkg.devDependencies };
    rootHasJest = "jest" in allDeps || "@jest/core" in allDeps;
  } catch { /* no root package.json */ }

  if (rootHasJest) {
    // Root already has Jest — just ensure the Jest config includes DevX_testScripts
    return;
  }

  // Create a package.json for the test project
  const pkgContent: Record<string, any> = {
    name: "devx-test-scripts",
    version: "1.0.0",
    private: true,
    scripts: {
      test: "jest --verbose",
    },
    devDependencies: {
      jest: "^29.7.0",
    },
  };
  if (hasTs) {
    pkgContent.devDependencies["ts-jest"] = "^29.1.0";
    pkgContent.devDependencies["typescript"] = "^5.0.0";
    pkgContent.devDependencies["@types/jest"] = "^29.5.0";
  }

  const devxPkgPath = path.join(testDir, "package.json");
  try {
    await fs.access(devxPkgPath);
  } catch {
    await fs.writeFile(devxPkgPath, JSON.stringify(pkgContent, null, 2), "utf8");
  }

  // Create jest.config.js if TypeScript tests present
  if (hasTs) {
    const jestConfigPath = path.join(testDir, "jest.config.js");
    try {
      await fs.access(jestConfigPath);
    } catch {
      const jestConfig = `module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/*.test.ts', '**/*.test.tsx', '**/*.test.js', '**/*.test.jsx'],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json'],
  transform: {
    '^.+\\\\.tsx?$': 'ts-jest',
  },
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/../$1',
  },
};
`;
      await fs.writeFile(jestConfigPath, jestConfig, "utf8");
    }
  }
}

/**
 * Recursively find and patch global.json files to add rollForward: "latestMajor".
 */
async function patchGlobalJsonRecursive(dir: string, maxDepth: number): Promise<void> {
  if (maxDepth <= 0) return;
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const e of entries) {
    const fullPath = path.join(dir, e.name);
    if (e.isDirectory()) {
      await patchGlobalJsonRecursive(fullPath, maxDepth - 1);
    } else if (e.name.toLowerCase() === "global.json") {
      try {
        const raw = await fs.readFile(fullPath, "utf8");
        const json = JSON.parse(raw) as { sdk?: { version?: string; rollForward?: string } };
        if (json.sdk?.version) {
          await fs.unlink(fullPath);
        }
      } catch {
        // ignore
      }
    }
  }
}
