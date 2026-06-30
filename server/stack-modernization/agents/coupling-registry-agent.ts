/**
 * Coupling Registry Agent
 *
 * Purely static analysis (no LLM). Scans extractedFiles, importGraph, and
 * repoProfile to build CouplingGroup[] — groups of files that MUST be
 * upgraded together to avoid split-state inconsistencies.
 */

import type {
  StackModernizationState,
  CouplingGroup,
  ExtractedFile,
  ImportGraph,
} from "../types";
import { isVendorPath } from "../services/temp-storage";

const VIEW_EXTENSIONS = new Set([
  ".cshtml", ".html", ".htm", ".razor", ".aspx", ".ascx", ".master",
  ".vue", ".jsx", ".tsx", ".hbs", ".ejs", ".pug", ".php", ".erb",
  ".blade.php", ".twig",
]);

const STYLE_EXTENSIONS = new Set([".css", ".scss", ".less", ".sass"]);

const MANIFEST_NAMES = new Set([
  "package.json", "libman.json", "bower.json", "bundleconfig.json",
  "pom.xml", "build.gradle", "build.gradle.kts",
  "composer.json", "Gemfile", "go.mod", "Cargo.toml",
]);

// ── Bootstrap coupling ─────────────────────────────────────────

const BS4_ATTR_RE = /data-(toggle|dismiss|target|parent|ride|slide|spy|offset)=/;
const BS5_ATTR_RE = /data-bs-(toggle|dismiss|target|parent|ride|slide|spy|offset)=/;
const BOOTSTRAP_REF_RE = /bootstrap/i;

function detectBootstrapCoupling(files: ExtractedFile[]): CouplingGroup | null {
  const viewsUsingBootstrap: string[] = [];
  const criticalFiles: string[] = [];
  const allGroupFiles = new Set<string>();

  for (const f of files) {
    if (isVendorPath(f.relativePath)) continue;

    const ext = f.relativePath.substring(f.relativePath.lastIndexOf(".")).toLowerCase();

    const usesBootstrapAttrs = BS4_ATTR_RE.test(f.content) || BS5_ATTR_RE.test(f.content);
    const refsBootstrap = BOOTSTRAP_REF_RE.test(f.content);

    if (VIEW_EXTENSIONS.has(ext) && (usesBootstrapAttrs || refsBootstrap)) {
      viewsUsingBootstrap.push(f.relativePath);
      allGroupFiles.add(f.relativePath);
    }

    if (STYLE_EXTENSIONS.has(ext) && refsBootstrap) {
      allGroupFiles.add(f.relativePath);
    }

    const baseName = f.relativePath.split(/[/\\]/).pop()?.toLowerCase() ?? "";
    const isLayout = baseName.includes("layout") || baseName.includes("_layout") ||
                     baseName.includes("master") || baseName.includes("_master");
    const isBundleConfig = baseName === "bundleconfig.json";
    const isManifest = baseName === "libman.json" || baseName === "bower.json" || baseName === "package.json";

    if ((isLayout || isBundleConfig || isManifest) && refsBootstrap) {
      criticalFiles.push(f.relativePath);
      allGroupFiles.add(f.relativePath);
    }
  }

  if (viewsUsingBootstrap.length === 0) return null;

  return {
    name: "bootstrap",
    library: "bootstrap",
    files: [...allGroupFiles],
    criticalFiles,
    rule: "All files must use the same Bootstrap major version — HTML data-attributes, CSS/JS bundles, layout script tags, and manifests must agree.",
  };
}

// ── jQuery coupling ────────────────────────────────────────────

const JQUERY_USAGE_RE = /\$\(|\jQuery[\s.(]/;
const JQUERY_REF_RE = /jquery/i;

function detectjQueryCoupling(files: ExtractedFile[]): CouplingGroup | null {
  const allGroupFiles = new Set<string>();
  const criticalFiles: string[] = [];

  for (const f of files) {
    if (isVendorPath(f.relativePath)) continue;

    const ext = f.relativePath.substring(f.relativePath.lastIndexOf(".")).toLowerCase();
    const baseName = f.relativePath.split(/[/\\]/).pop()?.toLowerCase() ?? "";

    if ((VIEW_EXTENSIONS.has(ext) || ext === ".js" || ext === ".ts") && JQUERY_USAGE_RE.test(f.content)) {
      allGroupFiles.add(f.relativePath);
    }

    const isManifest = MANIFEST_NAMES.has(baseName);
    const isLayout = baseName.includes("layout") || baseName.includes("_layout");

    if ((isManifest || isLayout) && JQUERY_REF_RE.test(f.content)) {
      criticalFiles.push(f.relativePath);
      allGroupFiles.add(f.relativePath);
    }
  }

  if (allGroupFiles.size === 0) return null;

  return {
    name: "jquery",
    library: "jquery",
    files: [...allGroupFiles],
    criticalFiles,
    rule: "All jQuery usage and version declarations must target the same major version.",
  };
}

// ── CDN / script-tag coupling ──────────────────────────────────

const SCRIPT_TAG_RE = /<script[^>]+src=["']([^"']+)["']/gi;
const LINK_TAG_RE = /<link[^>]+href=["']([^"']+)["']/gi;

function detectCdnScriptCoupling(
  files: ExtractedFile[],
  importGraph?: ImportGraph,
): CouplingGroup[] {
  const libraryToFiles = new Map<string, Set<string>>();
  const libraryCritical = new Map<string, Set<string>>();

  for (const f of files) {
    if (isVendorPath(f.relativePath)) continue;

    const ext = f.relativePath.substring(f.relativePath.lastIndexOf(".")).toLowerCase();
    if (!VIEW_EXTENSIONS.has(ext)) continue;

    for (const re of [SCRIPT_TAG_RE, LINK_TAG_RE]) {
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(f.content)) !== null) {
        const src = m[1];
        const libMatch = src.match(/\/([a-z][\w.-]+?)[@/]/i) || src.match(/lib\/([a-z][\w.-]+?)\//i);
        if (!libMatch) continue;
        const lib = libMatch[1].toLowerCase();
        if (lib === "bootstrap" || lib === "jquery") continue; // handled separately

        if (!libraryToFiles.has(lib)) libraryToFiles.set(lib, new Set());
        libraryToFiles.get(lib)!.add(f.relativePath);

        const baseName = f.relativePath.split(/[/\\]/).pop()?.toLowerCase() ?? "";
        if (baseName.includes("layout") || baseName.includes("_layout")) {
          if (!libraryCritical.has(lib)) libraryCritical.set(lib, new Set());
          libraryCritical.get(lib)!.add(f.relativePath);
        }
      }
    }
  }

  const groups: CouplingGroup[] = [];
  for (const [lib, fileSet] of libraryToFiles) {
    if (fileSet.size < 2) continue;
    groups.push({
      name: `cdn-${lib}`,
      library: lib,
      files: [...fileSet],
      criticalFiles: [...(libraryCritical.get(lib) ?? [])],
      rule: `All files referencing ${lib} via script/link tags must agree on the same version.`,
    });
  }
  return groups;
}

// ── Manifest <-> code coupling ─────────────────────────────────

function detectManifestCodeCoupling(
  files: ExtractedFile[],
  importGraph?: ImportGraph,
): CouplingGroup[] {
  if (!importGraph?.packageToFiles) return [];

  const manifestPaths = files
    .filter(f => {
      const baseName = f.relativePath.split(/[/\\]/).pop()?.toLowerCase() ?? "";
      return MANIFEST_NAMES.has(baseName) || baseName.endsWith(".csproj");
    })
    .map(f => f.relativePath);

  if (manifestPaths.length === 0) return [];

  const groups: CouplingGroup[] = [];

  for (const [pkg, consumers] of Object.entries(importGraph.packageToFiles)) {
    if (!consumers || consumers.length === 0) continue;

    const userConsumers = consumers.filter(c => !isVendorPath(c));
    if (userConsumers.length === 0) continue;

    const declaringManifests = manifestPaths.filter(mp => {
      const mf = files.find(f => f.relativePath === mp);
      return mf && mf.content.toLowerCase().includes(pkg.toLowerCase());
    });

    if (declaringManifests.length === 0) continue;

    const allFiles = new Set([...declaringManifests, ...userConsumers]);
    if (allFiles.size < 2) continue;

    groups.push({
      name: `manifest-${pkg}`,
      library: pkg,
      files: [...allFiles],
      criticalFiles: declaringManifests,
      rule: `Manifest version for ${pkg} must be consistent with code that imports it.`,
    });
  }

  return groups;
}

// ── Public API ──────────────────────────────────────────────────

export function buildCouplingRegistry(state: StackModernizationState): CouplingGroup[] {
  const files = state.extractedFiles ?? [];
  if (files.length === 0) return [];

  const groups: CouplingGroup[] = [];

  const bsCoupling = detectBootstrapCoupling(files);
  if (bsCoupling) groups.push(bsCoupling);

  const jqCoupling = detectjQueryCoupling(files);
  if (jqCoupling) groups.push(jqCoupling);

  const cdnGroups = detectCdnScriptCoupling(files, state.importGraph);
  groups.push(...cdnGroups);

  const manifestGroups = detectManifestCodeCoupling(files, state.importGraph);
  groups.push(...manifestGroups);

  return groups;
}
