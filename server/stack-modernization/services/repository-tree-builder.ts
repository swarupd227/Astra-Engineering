/**
 * Build a structural view of the repository: entry points, test roots, project roots.
 * Used to limit upgrade scope and inform planning.
 */

import type { RepositoryTree } from "../types";

const ENTRY_DOTNET = ["Program.cs", "Startup.cs", "Global.asax.cs"];
const ENTRY_PYTHON = ["main.py", "app.py", "__main__.py"];
const TEST_DIR_NAMES = ["test", "tests", "Test", "Tests", "__tests__", "spec"];
const MANIFEST_DOTNET = [".csproj", ".sln", ".vbproj"];
const MANIFEST_PYTHON = ["setup.py", "pyproject.toml", "requirements.txt"];

function normalizePath(p: string): string {
  return p.replace(/\\/g, "/");
}

/**
 * Build repository tree from extracted files (paths only).
 */
export function buildRepositoryTree(extractedFiles: Array<{ relativePath?: string; path?: string }>): RepositoryTree {
  const entryPoints: string[] = [];
  const testRoots: string[] = [];
  const projectRoots: string[] = [];
  const paths = extractedFiles.map((f) => normalizePath((f.relativePath ?? f.path) ?? "")).filter(Boolean);

  let framework: "dotnet" | "python" | "node" | "java" | undefined;
  for (const p of paths) {
    const lower = p.toLowerCase();
    const name = p.split("/").pop() ?? "";
    const segments = p.split("/").filter(Boolean);

    if (MANIFEST_DOTNET.some((m) => lower.endsWith(m))) framework = "dotnet";
    if (MANIFEST_PYTHON.some((m) => lower.endsWith(m))) framework = framework ?? "python";
    if (lower.endsWith("pom.xml") || lower.endsWith("build.gradle") || lower.endsWith("build.gradle.kts")) framework = framework ?? "java";
    if (lower.endsWith("package.json")) framework = framework ?? "node";

    if (ENTRY_DOTNET.includes(name)) entryPoints.push(p);
    if (ENTRY_PYTHON.includes(name)) entryPoints.push(p);
    if (name === "Program.cs" || name === "Startup.cs") entryPoints.push(p);

    const inTestDir = segments.some((s) => TEST_DIR_NAMES.includes(s));
    if (inTestDir && (lower.endsWith(".cs") || lower.endsWith(".py") || lower.endsWith(".ts"))) {
      const testRoot = segments[0] ?? "";
      if (testRoot && !testRoots.includes(testRoot)) testRoots.push(testRoot);
    }

    if (lower.endsWith(".csproj") || lower.endsWith(".sln")) {
      const dir = segments.slice(0, -1).join("/");
      if (dir && !projectRoots.includes(dir)) projectRoots.push(dir);
    }
    if (lower.endsWith("pyproject.toml") || lower.endsWith("setup.py")) {
      const dir = segments.slice(0, -1).join("/") || ".";
      if (!projectRoots.includes(dir)) projectRoots.push(dir);
    }
  }

  return {
    entryPoints: [...new Set(entryPoints)],
    testRoots: [...new Set(testRoots)],
    projectRoots: projectRoots.length > 0 ? projectRoots : ["."],
    framework,
  };
}
