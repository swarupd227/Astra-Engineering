/**
 * Resolve .sln and startup .csproj for run/build. Used by run-command and (optionally) container execution.
 * Recursively finds targets; prefers OutputType Exe for "dotnet run".
 */

import * as fs from "fs/promises";
import * as path from "path";

const DEFAULT_MAX_DEPTH = 5;

export interface DotnetTargets {
  sln: string | null;
  slnDir: string | null;
  csprojForRun: string | null;
  csprojDir: string | null;
}

/**
 * Recursively find .sln and non-test .csproj under projectRoot.
 * Prefers .csproj with <OutputType>Exe</OutputType> when multiple exist.
 * Returns paths with forward slashes relative to projectRoot.
 */
export async function resolveDotnetTargets(
  projectRoot: string,
  maxDepth: number = DEFAULT_MAX_DEPTH
): Promise<DotnetTargets> {
  const slnPaths: string[] = [];
  const csprojPaths: string[] = [];

  async function walk(dir: string, depth: number): Promise<void> {
    if (depth <= 0) return;
    const fullDir = path.join(projectRoot, dir);
    const entries = await fs.readdir(fullDir, { withFileTypes: true }).catch(() => []);
    for (const e of entries) {
      const rel = dir ? `${dir}/${e.name}` : e.name;
      const relNorm = rel.replace(/\\/g, "/");
      if (e.isDirectory()) {
        await walk(rel, depth - 1);
      } else {
        const lower = e.name.toLowerCase();
        if (lower.endsWith(".sln")) slnPaths.push(relNorm);
        if (lower.endsWith(".csproj") && !lower.includes("test")) csprojPaths.push(relNorm);
      }
    }
  }

  await walk("", maxDepth);

  const sln = slnPaths[0] ?? null;
  const slnDir = sln ? sln.replace(/\/[^/]+$/, "") : null;

  let csprojForRun: string | null = null;
  if (csprojPaths.length === 0) {
    // no-op
  } else if (csprojPaths.length === 1) {
    csprojForRun = csprojPaths[0];
  } else {
    // Prefer project with OutputType Exe
    for (const rel of csprojPaths) {
      const fullPath = path.join(projectRoot, rel);
      try {
        const content = await fs.readFile(fullPath, "utf8");
        if (/<OutputType\s*>\s*Exe\s*<\/OutputType>/i.test(content)) {
          csprojForRun = rel;
          break;
        }
      } catch {
        /* ignore */
      }
    }
    if (!csprojForRun) csprojForRun = csprojPaths[0];
  }

  const csprojDir = csprojForRun ? csprojForRun.replace(/\/[^/]+$/, "") : null;

  return { sln, slnDir, csprojForRun, csprojDir };
}

/**
 * Get the best cwd for dotnet commands: solution directory if we have .sln, else project directory.
 */
export function getDotnetRunCwd(targets: DotnetTargets): string {
  return targets.slnDir ?? targets.csprojDir ?? "";
}
