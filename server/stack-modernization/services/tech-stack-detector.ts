/**
 * Deterministic Tech Stack Detection Engine
 * No LLM — manifest parsing and file heuristics only.
 * Scans extracted repository (root and subfolders) and returns:
 *   Primary ecosystem, runtime version, framework, dependency list with versions,
 *   lockfile presence, build system, confidence.
 * Spec: STEP 1–10 (scan root recursively, determine ecosystem, extract runtime/deps, lockfile, structured output).
 */

import * as path from "path";
import type { ExtractedFile } from "../types";
import {
  parseCsproj,
  parsePomXml,
  parseBuildGradle,
  parseGemfile,
  parseComposerJson,
  parseGoMod,
  parseCargoToml,
} from "./file-parser";

const IGNORE_DIRS = new Set(["node_modules", "bin", "obj", ".git", "vendor", "dist", "build"]);

function shouldIgnore(relativePath: string): boolean {
  const parts = relativePath.split(/[/\\]/);
  return parts.some((p) => IGNORE_DIRS.has(p.toLowerCase()));
}

/** STEP 1: High-signal files to scan (recursively over extracted folder) */
const MANIFEST_PATTERNS: Array<{ pattern: string | RegExp; ecosystem: string }> = [
  { pattern: /\.csproj$/i, ecosystem: "dotnet" },
  { pattern: /\.sln$/i, ecosystem: "dotnet" },
  { pattern: "global.json", ecosystem: "dotnet" },
  { pattern: "Directory.Build.props", ecosystem: "dotnet" },
  { pattern: "package.json", ecosystem: "node" },
  { pattern: "package-lock.json", ecosystem: "node" },
  { pattern: "yarn.lock", ecosystem: "node" },
  { pattern: "pnpm-lock.yaml", ecosystem: "node" },
  { pattern: "requirements.txt", ecosystem: "python" },
  { pattern: "pyproject.toml", ecosystem: "python" },
  { pattern: "Pipfile", ecosystem: "python" },
  { pattern: "Pipfile.lock", ecosystem: "python" },
  { pattern: "Gemfile", ecosystem: "ruby" },
  { pattern: "Gemfile.lock", ecosystem: "ruby" },
  { pattern: "pom.xml", ecosystem: "java" },
  { pattern: /build\.gradle(\.kts)?$/i, ecosystem: "java" },
  { pattern: "go.mod", ecosystem: "go" },
  { pattern: "composer.json", ecosystem: "php" },
  { pattern: "composer.lock", ecosystem: "php" },
  { pattern: "Cargo.toml", ecosystem: "rust" },
  { pattern: "Cargo.lock", ecosystem: "rust" },
  // Client-side package managers
  { pattern: "libman.json", ecosystem: "dotnet" },
  { pattern: "bower.json", ecosystem: "node" },
  // C/C++
  { pattern: "CMakeLists.txt", ecosystem: "cpp" },
  { pattern: /\.vcxproj$/i, ecosystem: "cpp" },
  { pattern: "vcpkg.json", ecosystem: "cpp" },
  { pattern: "conanfile.txt", ecosystem: "cpp" },
  { pattern: "conanfile.py", ecosystem: "cpp" },
  // Swift
  { pattern: "Package.swift", ecosystem: "swift" },
  { pattern: "Podfile", ecosystem: "swift" },
  { pattern: "Podfile.lock", ecosystem: "swift" },
  // Dart/Flutter
  { pattern: "pubspec.yaml", ecosystem: "dart" },
  { pattern: "pubspec.lock", ecosystem: "dart" },
  // Scala
  { pattern: "build.sbt", ecosystem: "scala" },
  // Elixir
  { pattern: "mix.exs", ecosystem: "elixir" },
  { pattern: "mix.lock", ecosystem: "elixir" },
];

export interface TechStackRuntime {
  framework?: string;
  /** Multiple TargetFrameworks when present (e.g. net6.0;net7.0) */
  frameworks?: string[];
  sdk?: string;
  version?: string;
}

export interface TechStackResult {
  ecosystem: string;
  runtime: TechStackRuntime;
  dependencies: Array<{ name: string; version: string }>;
  lockfile: boolean;
  buildSystem: string;
  confidence: "high" | "medium" | "low";
  sourcePath?: string;
  /** STEP 2: When multiple ecosystems exist in repo */
  polyglot?: boolean;
  otherEcosystems?: string[];
}

/**
 * Scan extracted files for manifest paths (deterministic).
 */
function findManifestPaths(files: ExtractedFile[]): Map<string, ExtractedFile> {
  const byPath = new Map<string, ExtractedFile>();
  for (const f of files) {
    if (shouldIgnore(f.relativePath)) continue;
    const base = path.basename(f.relativePath).toLowerCase();
    for (const { pattern } of MANIFEST_PATTERNS) {
      const matches =
        typeof pattern === "string"
          ? base === pattern.toLowerCase()
          : (pattern as RegExp).test(f.relativePath);
      if (matches) {
        byPath.set(f.relativePath, f);
        break;
      }
    }
  }
  return byPath;
}

/** Normalize .NET TargetFramework to a version string (e.g. net472 -> 4.7.2, net80 -> 8.0). */
function normalizeDotNetVersion(framework?: string, targetFrameworkVersion?: string): string | undefined {
  if (targetFrameworkVersion) return targetFrameworkVersion.trim();
  if (!framework) return undefined;
  const s = framework.replace(/^v/i, "").trim();
  const netCore = s.match(/^netcoreapp(\d+)\.(\d+)$/i);
  if (netCore) return `${netCore[1]}.${netCore[2]}`;
  const netTwo = s.match(/^net(\d+)\.(\d+)$/i);
  if (netTwo) return `${netTwo[1]}.${netTwo[2]}`;
  const netThree = s.match(/^net(\d)(\d)(\d)$/i);
  if (netThree) return `${netThree[1]}.${netThree[2]}.${netThree[3]}`;
  const netTwoDig = s.match(/^net(\d)(\d)$/i);
  if (netTwoDig) return `${netTwoDig[1]}.${netTwoDig[2]}`;
  return s.replace(/^net/i, "").replace(/^v/, "") || undefined;
}

/** STEP 2: Determine primary ecosystem and detect polyglot (multiple ecosystems). */
function determineEcosystemAndPolyglot(byPath: Map<string, ExtractedFile>): { ecosystem: string; otherEcosystems: string[] } {
  const has = (s: string) => Array.from(byPath.keys()).some((p) => path.basename(p).toLowerCase().includes(s));
  const found: string[] = [];
  if (has(".csproj") || has(".sln")) found.push("dotnet");
  if (has("package.json")) found.push("node");
  if (has("requirements.txt") || has("pyproject.toml") || has("Pipfile")) found.push("python");
  if (has("Gemfile")) found.push("ruby");
  if (has("pom.xml") || has("build.gradle")) found.push("java");
  if (has("go.mod")) found.push("go");
  if (has("composer.json")) found.push("php");
  if (has("Cargo.toml")) found.push("rust");
  const order = ["dotnet", "node", "python", "ruby", "java", "go", "php", "rust"];
  const primary = order.find((e) => found.includes(e)) ?? "unknown";
  const otherEcosystems = found.filter((e) => e !== primary);
  return { ecosystem: primary, otherEcosystems };
}

/** STEP 9: Normalize dependency version — use "floating" when not specified. */
function depVersion(v: string | undefined): string {
  if (v == null || v === "" || v === "*") return "floating";
  return String(v).trim();
}

/**
 * Detect tech stack from extracted files (deterministic, no LLM).
 * Analyzes repository root and all subfolders (extractedFiles is full tree).
 */
export function detectTechStack(extractedFiles: ExtractedFile[]): TechStackResult | null {
  if (!extractedFiles?.length) return null;

  const byPath = findManifestPaths(extractedFiles);
  const { ecosystem, otherEcosystems } = determineEcosystemAndPolyglot(byPath);
  const polyglot = otherEcosystems.length > 0;
  const baseResult = (overrides: Partial<TechStackResult>): TechStackResult => ({
    ecosystem,
    runtime: {},
    dependencies: [],
    lockfile: false,
    buildSystem: "unknown",
    confidence: "low",
    ...overrides,
    ...(polyglot && { polyglot: true, otherEcosystems }),
  });

  if (ecosystem === "dotnet") {
    const csprojPath = Array.from(byPath.keys()).find((p) => /\.csproj$/i.test(p));
    const file = csprojPath ? byPath.get(csprojPath) : undefined;
    if (!file?.content) {
      return baseResult({ buildSystem: "msbuild", runtime: { version: "unknown" } });
    }
    const manifest = parseCsproj(file.content, file.relativePath);
    if (!manifest?.parsed) {
      return baseResult({
        buildSystem: "msbuild",
        confidence: "medium",
        sourcePath: file.relativePath,
        runtime: { version: "unknown" },
      });
    }
    const p = manifest.parsed as {
      targetFramework?: string;
      targetFrameworks?: string[];
      targetFrameworkVersion?: string;
      dependencies?: Array<{ name: string; version: string }>;
    };
    const framework = p.targetFramework || (p.targetFrameworks && p.targetFrameworks[0]) || (p.targetFrameworkVersion ? `v${p.targetFrameworkVersion}` : undefined);
    const frameworks = p.targetFrameworks?.length ? p.targetFrameworks : undefined;
    const version = normalizeDotNetVersion(framework, p.targetFrameworkVersion) ?? (framework ? framework.replace(/^v/i, "").trim() : undefined) ?? "unknown";
    const dependencies = (p.dependencies || []).map((d) => ({ name: d.name, version: depVersion(d.version) }));
    let sdk: string | undefined;
    const globalJsonPath = Array.from(byPath.keys()).find((k) => path.basename(k).toLowerCase() === "global.json");
    if (globalJsonPath) {
      const gfile = byPath.get(globalJsonPath);
      if (gfile?.content) {
        try {
          const gj = JSON.parse(gfile.content) as { sdk?: { version?: string } };
          sdk = gj.sdk?.version;
        } catch {
          // ignore
        }
      }
    }
    return baseResult({
      runtime: { framework, frameworks, version: version || "unknown", sdk },
      dependencies,
      buildSystem: "msbuild",
      confidence: "high",
      sourcePath: file.relativePath,
    });
  }

  if (ecosystem === "node") {
    const pkgPath = Array.from(byPath.keys()).find((k) => path.basename(k).toLowerCase() === "package.json");
    const file = pkgPath ? byPath.get(pkgPath) : undefined;
    let dependencies: Array<{ name: string; version: string }> = [];
    let runtime: TechStackRuntime = {};
    if (file?.content) {
      try {
        const parsed = JSON.parse(file.content);
        const deps = { ...parsed.dependencies, ...parsed.devDependencies };
        dependencies = Object.entries(deps).map(([name, version]) => ({
          name,
          version: depVersion(version as string),
        }));
        if (parsed.engines?.node) {
          runtime.version = String(parsed.engines.node).replace(/[\^~>=<]/g, "").trim();
        } else {
          runtime.version = "unknown";
        }
      } catch {
        runtime.version = "unknown";
      }
    } else {
      runtime.version = "unknown";
    }
    const lockfile = Array.from(byPath.keys()).some((k) => {
      const b = path.basename(k).toLowerCase();
      return b === "package-lock.json" || b === "yarn.lock" || b === "pnpm-lock.yaml";
    });
    return baseResult({
      runtime,
      dependencies,
      lockfile,
      buildSystem: "npm",
      confidence: file?.content ? "high" : "medium",
      sourcePath: file?.relativePath,
    });
  }

  if (ecosystem === "python") {
    const reqPath = Array.from(byPath.keys()).find((k) => path.basename(k).toLowerCase() === "requirements.txt");
    const pyprojPath = Array.from(byPath.keys()).find((k) => path.basename(k).toLowerCase() === "pyproject.toml");
    const reqFile = reqPath ? byPath.get(reqPath) : undefined;
    const pyprojFile = pyprojPath ? byPath.get(pyprojPath) : undefined;
    let dependencies: Array<{ name: string; version: string }> = [];
    let runtime: TechStackRuntime = {};
    if (reqFile?.content) {
      reqFile.content.split("\n").forEach((line) => {
        const m = line.trim().match(/^([a-zA-Z0-9_-]+)(.*)$/);
        if (m) dependencies.push({ name: m[1], version: depVersion(m[2].trim() || undefined) });
      });
    }
    if (pyprojFile?.content) {
      const c = pyprojFile.content;
      const requiresPython = c.match(/requires-python\s*=\s*["']([^"']+)["']/)?.[1];
      if (requiresPython) runtime.version = requiresPython.replace(/[\^~>=<]/g, "").trim();
      else if (!runtime.version) runtime.version = "unknown";
      const depSection = c.match(/dependencies\s*=\s*\[([\s\S]*?)\]/);
      if (depSection) {
        const depList = depSection[1].match(/["']([^"']+)["']/g) || [];
        depList.forEach((d: string) => {
          const name = d.replace(/["']/g, "").split(/[>=<~!]/)[0].trim();
          if (name && !dependencies.some((x) => x.name === name)) dependencies.push({ name, version: "floating" });
        });
      }
    }
    if (!runtime.version) runtime.version = "unknown";
    const lockfile = Array.from(byPath.keys()).some((k) => path.basename(k).toLowerCase() === "pipfile.lock");
    return baseResult({
      runtime,
      dependencies,
      lockfile,
      buildSystem: "pip",
      confidence: reqFile?.content || pyprojFile?.content ? "high" : "medium",
      sourcePath: reqFile?.relativePath || pyprojFile?.relativePath,
    });
  }

  if (ecosystem === "java") {
    const pomPath = Array.from(byPath.keys()).find((k) => path.basename(k).toLowerCase() === "pom.xml");
    const gradlePath = Array.from(byPath.keys()).find((k) => /build\.gradle(\.kts)?$/i.test(path.basename(k)));
    const file = pomPath ? byPath.get(pomPath) : (gradlePath ? byPath.get(gradlePath) : undefined);
    let runtime: TechStackRuntime = {};
    let dependencies: Array<{ name: string; version: string }> = [];
    let buildSystem = "maven";
    if (file?.content) {
      if (pomPath && file.content) {
        const manifest = parsePomXml(file.content, file.relativePath);
        if (manifest?.parsed) {
          const parsed = manifest.parsed as any;
          runtime.version = parsed.javaVersion ?? "unknown";
          if (parsed.springBootVersion) {
            runtime.framework = `Spring Boot ${parsed.springBootVersion}`;
          }
          const deps = (parsed.dependencies || []) as Array<{ groupId: string; artifactId: string; version?: string }>;
          dependencies = deps.map((d) => ({ name: `${d.groupId}:${d.artifactId}`, version: depVersion(d.version) }));
          // Include parent POM as a dependency (e.g., spring-boot-starter-parent)
          if (parsed.parent?.groupId && parsed.parent?.artifactId) {
            dependencies.unshift({
              name: `${parsed.parent.groupId}:${parsed.parent.artifactId}`,
              version: depVersion(parsed.parent.version),
            });
          }
        }
      } else if (gradlePath) {
        const manifest = parseBuildGradle(file.content, file.relativePath);
        if (manifest?.parsed) {
          buildSystem = "gradle";
          runtime.version = (manifest.parsed as { javaVersion?: string }).javaVersion ?? "unknown";
          const deps = (manifest.parsed as { dependencies?: Array<{ notation: string }> }).dependencies || [];
          dependencies = deps.map((d) => ({ name: d.notation, version: "floating" }));
        }
      }
    }
    if (!runtime.version) runtime.version = "unknown";
    return baseResult({
      runtime,
      dependencies,
      buildSystem,
      confidence: file?.content ? "high" : "medium",
      sourcePath: file?.relativePath,
    });
  }

  if (ecosystem === "ruby") {
    const gemPath = Array.from(byPath.keys()).find((k) => path.basename(k).toLowerCase() === "gemfile");
    const file = gemPath ? byPath.get(gemPath) : undefined;
    let runtime: TechStackRuntime = {};
    let dependencies: Array<{ name: string; version: string }> = [];
    if (file?.content) {
      const manifest = parseGemfile(file.content, file.relativePath);
      if (manifest?.parsed) {
        runtime.version = (manifest.parsed as { rubyVersion?: string }).rubyVersion ?? "unknown";
        const deps = (manifest.parsed as { dependencies?: Array<{ name: string; version?: string }> }).dependencies || [];
        dependencies = deps.map((d) => ({ name: d.name, version: depVersion(d.version) }));
      }
    }
    if (!runtime.version) runtime.version = "unknown";
    const lockfile = Array.from(byPath.keys()).some((k) => path.basename(k).toLowerCase() === "gemfile.lock");
    return baseResult({
      runtime,
      dependencies,
      lockfile,
      buildSystem: "bundler",
      confidence: file?.content ? "high" : "medium",
      sourcePath: file?.relativePath,
    });
  }

  if (ecosystem === "php") {
    const composerPath = Array.from(byPath.keys()).find((k) => path.basename(k).toLowerCase() === "composer.json");
    const file = composerPath ? byPath.get(composerPath) : undefined;
    let dependencies: Array<{ name: string; version: string }> = [];
    if (file?.content) {
      const manifest = parseComposerJson(file.content, file.relativePath);
      if (manifest?.parsed) {
        const req = (manifest.parsed as { require?: Record<string, string> }).require || {};
        dependencies = Object.entries(req).map(([name, version]) => ({ name, version: depVersion(version) }));
      }
    }
    const lockfile = Array.from(byPath.keys()).some((k) => path.basename(k).toLowerCase() === "composer.lock");
    return baseResult({
      runtime: { version: "unknown" },
      dependencies,
      lockfile,
      buildSystem: "composer",
      confidence: file?.content ? "high" : "medium",
      sourcePath: file?.relativePath,
    });
  }

  if (ecosystem === "go") {
    const goPath = Array.from(byPath.keys()).find((k) => path.basename(k).toLowerCase() === "go.mod");
    const file = goPath ? byPath.get(goPath) : undefined;
    let runtime: TechStackRuntime = {};
    let dependencies: Array<{ name: string; version: string }> = [];
    if (file?.content) {
      const manifest = parseGoMod(file.content, file.relativePath);
      if (manifest?.parsed) {
        runtime.version = (manifest.parsed as { goVersion?: string }).goVersion ?? "unknown";
        const deps = (manifest.parsed as { dependencies?: Array<{ module: string; version: string }> }).dependencies || [];
        dependencies = deps.map((d) => ({ name: d.module, version: depVersion(d.version) }));
      }
    }
    if (!runtime.version) runtime.version = "unknown";
    return baseResult({
      runtime,
      dependencies,
      buildSystem: "go",
      confidence: file?.content ? "high" : "medium",
      sourcePath: file?.relativePath,
    });
  }

  if (ecosystem === "rust") {
    const cargoPath = Array.from(byPath.keys()).find((k) => path.basename(k).toLowerCase() === "cargo.toml");
    const file = cargoPath ? byPath.get(cargoPath) : undefined;
    let dependencies: Array<{ name: string; version: string }> = [];
    if (file?.content) {
      const manifest = parseCargoToml(file.content, file.relativePath);
      if (manifest?.parsed) {
        const deps = (manifest.parsed as { dependencies?: Array<{ name: string; version: string }> }).dependencies || [];
        dependencies = deps.map((d) => ({ name: d.name, version: depVersion(d.version) }));
      }
    }
    const lockfile = Array.from(byPath.keys()).some((k) => path.basename(k).toLowerCase() === "cargo.lock");
    return baseResult({
      runtime: { version: "unknown" },
      dependencies,
      lockfile,
      buildSystem: "cargo",
      confidence: file?.content ? "high" : "medium",
      sourcePath: file?.relativePath,
    });
  }

  return baseResult({ confidence: byPath.size > 0 ? "medium" : "low", runtime: { version: "unknown" } });
}
