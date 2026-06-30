/**
 * Build import graph: file -> packages, package -> files, file -> files.
 * Used for scope-limited triage, dependency-aware grouping, and context propagation.
 */

import * as path from "path";
import type { ImportGraph, ExtractedFile } from "../types";
import { analyzeAllCodeFiles } from "./code-analyzer";

/**
 * Build import graph from extracted files using code-analyzer,
 * plus file-to-file dependency edges derived from static analysis.
 */
export function buildImportGraph(extractedFiles: ExtractedFile[]): ImportGraph {
  const fileToPackages: Record<string, string[]> = {};
  const packageToFiles: Record<string, string[]> = {};
  const fileToFiles: Record<string, string[]> = {};

  const analyses = analyzeAllCodeFiles(extractedFiles);

  for (const a of analyses) {
    const packages = a.imports.filter((i) => !i.isLocal).map((i) => i.package.split("/")[0]);
    const unique = [...new Set(packages)];
    fileToPackages[a.file] = unique;
    for (const pkg of unique) {
      if (!packageToFiles[pkg]) packageToFiles[pkg] = [];
      if (!packageToFiles[pkg].includes(a.file)) packageToFiles[pkg].push(a.file);
    }
  }

  // Build file-to-file dependency edges
  const allPaths = extractedFiles.map(f => f.relativePath);
  const pathIndex = buildPathIndex(allPaths);

  for (const file of extractedFiles) {
    const deps = detectFileDependencies(file, pathIndex, extractedFiles);
    if (deps.length > 0) {
      fileToFiles[file.relativePath] = deps;
    }
  }

  return { fileToPackages, packageToFiles, fileToFiles };
}

/** Quick lookup: basename (lowercased) → full relative paths */
function buildPathIndex(paths: string[]): Map<string, string[]> {
  const index = new Map<string, string[]>();
  for (const p of paths) {
    const base = path.basename(p).toLowerCase();
    const existing = index.get(base) || [];
    existing.push(p);
    index.set(base, existing);
  }
  return index;
}

function findFileByName(
  pathIndex: Map<string, string[]>,
  name: string,
  importingFile?: string
): string | undefined {
  const candidates = pathIndex.get(name.toLowerCase());
  if (!candidates?.length) return undefined;
  if (candidates.length === 1 || !importingFile) return candidates[0];

  const importDir = path.dirname(importingFile).replace(/\\/g, "/").toLowerCase().split("/");
  let best = candidates[0];
  let bestShared = -1;

  for (const c of candidates) {
    const cDir = path.dirname(c).replace(/\\/g, "/").toLowerCase().split("/");
    let shared = 0;
    while (shared < importDir.length && shared < cDir.length && importDir[shared] === cDir[shared]) {
      shared++;
    }
    if (shared > bestShared) {
      bestShared = shared;
      best = c;
    }
  }
  return best;
}

/**
 * Detect file-to-file dependencies via static analysis (no LLM call).
 * Returns list of file paths that `file` depends on.
 */
function detectFileDependencies(
  file: ExtractedFile,
  pathIndex: Map<string, string[]>,
  allFiles: ExtractedFile[]
): string[] {
  const deps = new Set<string>();
  const relPath = file.relativePath;
  const ext = path.extname(relPath).toLowerCase();
  const content = file.content || "";
  const baseName = path.basename(relPath).toLowerCase();

  // View/template extensions across all tech stacks
  const viewExts = [
    ".cshtml", ".html", ".razor", ".htm",
    ".jsp", ".jsf", ".erb", ".haml", ".slim",
    ".ejs", ".hbs", ".pug", ".njk", ".twig",
    ".svelte", ".vue", ".astro",
  ];
  const isViewFile = viewExts.includes(ext) || baseName.endsWith(".blade.php");

  // --- 1a. Asset path references: ~/lib/, node_modules/, vendor/ → depends on manifest ---
  if (isViewFile) {
    if (/(?:href|src)\s*=\s*["']~?\/?[^"']*lib\//i.test(content)) {
      const libman = findFileByName(pathIndex, "libman.json");
      if (libman && libman !== relPath) deps.add(libman);
      const bower = findFileByName(pathIndex, "bower.json");
      if (bower && bower !== relPath) deps.add(bower);
    }
    if (/(?:href|src)\s*=\s*["'][^"']*node_modules\//i.test(content)) {
      const pkgJson = findFileByName(pathIndex, "package.json");
      if (pkgJson && pkgJson !== relPath) deps.add(pkgJson);
    }
    if (/bundleconfig/i.test(content)) {
      const bundleCfg = findFileByName(pathIndex, "bundleconfig.json");
      if (bundleCfg && bundleCfg !== relPath) deps.add(bundleCfg);
    }

    // --- 1b. API-level dependencies: inline JS/jQuery plugin calls, framework init patterns ---
    // If a view file uses JS plugin APIs (e.g. .datepicker(), .modal(), .tooltip()),
    // it depends on the client-side manifest that provides those libraries.
    const jsPluginCallPattern = /\.\s*(datepicker|timepicker|selectpicker|typeahead|tooltip|popover|modal|collapse|carousel|tab|dropdown|alert|toast|offcanvas|scrollspy|autocomplete|slider|sortable|draggable|droppable|resizable|dialog|accordion|colorpicker|rangeslider|lightbox|fancybox|magnific|select2|chosen|tagsinput|tokenfield|summernote|tinymce|ckeditor|quill|codemirror|fullcalendar|dataTable|DataTable|slick|owlCarousel|swiper|flickity|masonry|isotope|waypoint|counterUp|animateNumber|validate|validator)\s*\(/i;
    const jqReadyPattern = /\$\s*\(\s*(document|function|['"])/;
    const jqSelectorPattern = /\$\s*\(\s*["'][^"']*["']\s*\)\s*\.\s*\w+\s*\(/;

    if (jsPluginCallPattern.test(content) || jqReadyPattern.test(content) || jqSelectorPattern.test(content)) {
      const libman = findFileByName(pathIndex, "libman.json");
      if (libman && libman !== relPath) deps.add(libman);
      const bower = findFileByName(pathIndex, "bower.json");
      if (bower && bower !== relPath) deps.add(bower);
      const pkgJson = findFileByName(pathIndex, "package.json");
      if (pkgJson && pkgJson !== relPath) deps.add(pkgJson);
    }

    // --- 1c. Layout dependency: Razor/template engines ---
    if (/@(using|model|inject)\s/.test(content)) {
      const viewImports = findFileByName(pathIndex, "_viewimports.cshtml");
      if (viewImports && viewImports !== relPath) deps.add(viewImports);
    }
    const layoutMatch = content.match(/Layout\s*=\s*["']([^"']+)["']/);
    if (layoutMatch) {
      const layoutName = path.basename(layoutMatch[1]).toLowerCase();
      const layoutFile = findFileByName(pathIndex, layoutName.endsWith(".cshtml") ? layoutName : `${layoutName}.cshtml`);
      if (layoutFile && layoutFile !== relPath) deps.add(layoutFile);
    }

    // --- 1d. Any view depends on _Layout if it exists (inherits scripts/styles) ---
    if (!baseName.includes("_layout")) {
      const layoutFile = findFileByName(pathIndex, "_layout.cshtml");
      if (layoutFile && layoutFile !== relPath) deps.add(layoutFile);
    }
  }

  // --- 2. Entry points depend on project config ---
  const entryPointNames = new Set([
    "program.cs", "startup.cs", "app.cs", "main.cs",
    "main.py", "app.py", "main.ts", "main.js", "index.ts", "index.js",
    "main.java", "app.java",
  ]);
  if (entryPointNames.has(baseName)) {
    // Depends on the nearest .csproj / package.json / pom.xml
    const csproj = findClosestManifest(relPath, allFiles, [".csproj"]);
    if (csproj) deps.add(csproj);
    const pkgJson = findFileByName(pathIndex, "package.json");
    if (pkgJson && pkgJson !== relPath) deps.add(pkgJson);
    const pomXml = findFileByName(pathIndex, "pom.xml");
    if (pomXml && pomXml !== relPath) deps.add(pomXml);
  }

  // --- 3. .csproj ProjectReference → depends on referenced .csproj ---
  if (ext === ".csproj") {
    const projRefPattern = /<ProjectReference\s+Include="([^"]+)"/gi;
    let m: RegExpExecArray | null;
    while ((m = projRefPattern.exec(content)) !== null) {
      const refPath = m[1].replace(/\\/g, "/");
      const refBase = path.basename(refPath).toLowerCase();
      const target = findFileByName(pathIndex, refBase);
      if (target && target !== relPath) deps.add(target);
    }
  }

  // --- 4. _ViewImports.cshtml depends on .csproj (for available namespaces) ---
  if (baseName === "_viewimports.cshtml") {
    const csproj = findClosestManifest(relPath, allFiles, [".csproj"]);
    if (csproj) deps.add(csproj);
  }

  // --- 5. CSS/SCSS files referencing fonts/icons from lib/ → depends on libman.json ---
  if ([".css", ".scss", ".less"].includes(ext)) {
    if (/url\s*\([^)]*lib\//i.test(content)) {
      const libman = findFileByName(pathIndex, "libman.json");
      if (libman && libman !== relPath) deps.add(libman);
    }
  }

  // --- 6. JavaScript/TypeScript with local imports → file-to-file ---
  if ([".js", ".jsx", ".ts", ".tsx"].includes(ext)) {
    const localImportPattern = /(?:import\s+.*from\s+|require\s*\(\s*)['"](\.[^'"]+)['"]/g;
    let lm: RegExpExecArray | null;
    while ((lm = localImportPattern.exec(content)) !== null) {
      const importPath = lm[1];
      const resolved = resolveLocalImport(relPath, importPath, pathIndex);
      if (resolved && resolved !== relPath) deps.add(resolved);
    }
  }

  // --- 7. C# (.cs) using statements → file-to-file ---
  if (ext === ".cs") {
    const usingPattern = /^using\s+([\w.]+)\s*;/gm;
    let um: RegExpExecArray | null;
    while ((um = usingPattern.exec(content)) !== null) {
      const ns = um[1];
      const lastSegment = ns.split(".").pop();
      if (lastSegment) {
        const target = findFileByName(pathIndex, `${lastSegment}.cs`, relPath);
        if (target && target !== relPath) deps.add(target);
      }
    }
  }

  // --- 8. Python (.py) from/import statements → file-to-file ---
  if (ext === ".py") {
    const pyImportPattern = /(?:from\s+(\S+)\s+import|^import\s+(\S+))/gm;
    let pm: RegExpExecArray | null;
    while ((pm = pyImportPattern.exec(content)) !== null) {
      const modulePath = (pm[1] || pm[2]).replace(/\./g, "/");
      const asPy = `${path.basename(modulePath)}.py`;
      const target = findFileByName(pathIndex, asPy, relPath);
      if (target && target !== relPath) {
        deps.add(target);
      } else {
        const initTarget = findFileByName(pathIndex, "__init__.py", relPath);
        if (initTarget && initTarget.replace(/\\/g, "/").toLowerCase().includes(modulePath.toLowerCase()) && initTarget !== relPath) {
          deps.add(initTarget);
        }
      }
    }
  }

  // --- 9. Java (.java) import statements → file-to-file ---
  if (ext === ".java") {
    const javaImportPattern = /^import\s+(?:static\s+)?([a-zA-Z][\w.]*);/gm;
    let jm: RegExpExecArray | null;
    while ((jm = javaImportPattern.exec(content)) !== null) {
      const fqcn = jm[1];
      const segments = fqcn.split(".");
      const className = segments.pop();
      if (className) {
        const target = findFileByName(pathIndex, `${className}.java`, relPath);
        if (target && target !== relPath) deps.add(target);
      }
    }
  }

  // --- 10. Go (.go) import statements → file-to-file ---
  if (ext === ".go") {
    const goImportPattern = /"([^"]+)"/g;
    let gm: RegExpExecArray | null;
    while ((gm = goImportPattern.exec(content)) !== null) {
      const importPkg = gm[1];
      if (!importPkg.includes("/")) continue; // skip standard library
      const pkgDir = importPkg.split("/").pop();
      if (pkgDir) {
        const candidates = pathIndex.get(`${pkgDir}.go`);
        if (candidates) {
          for (const c of candidates) {
            if (c !== relPath && c.replace(/\\/g, "/").includes(importPkg)) {
              deps.add(c);
            }
          }
        }
        for (const [base, paths] of pathIndex) {
          if (!base.endsWith(".go")) continue;
          for (const p of paths) {
            if (p !== relPath && p.replace(/\\/g, "/").includes(importPkg + "/")) {
              deps.add(p);
            }
          }
        }
      }
    }
  }

  // --- 11. Ruby (.rb) require_relative / require → file-to-file ---
  if (ext === ".rb") {
    const requireRelPattern = /require_relative\s+['"]([^'"]+)['"]/g;
    let rrm: RegExpExecArray | null;
    while ((rrm = requireRelPattern.exec(content)) !== null) {
      const reqPath = rrm[1].endsWith(".rb") ? rrm[1] : `${rrm[1]}.rb`;
      const resolved = resolveLocalImport(relPath, `./${reqPath}`, pathIndex);
      if (resolved && resolved !== relPath) deps.add(resolved);
    }
    const requirePattern = /require\s+['"]([^'"]+)['"]/g;
    let rm: RegExpExecArray | null;
    while ((rm = requirePattern.exec(content)) !== null) {
      const reqName = rm[1];
      if (reqName.startsWith(".")) continue; // already handled by require_relative
      const baseName = path.basename(reqName);
      const target = findFileByName(pathIndex, baseName.endsWith(".rb") ? baseName : `${baseName}.rb`, relPath);
      if (target && target !== relPath) deps.add(target);
    }
  }

  // --- 12. PHP (.php) use statements → file-to-file ---
  if (ext === ".php") {
    const phpUsePattern = /^use\s+([\w\\]+);/gm;
    let phpm: RegExpExecArray | null;
    while ((phpm = phpUsePattern.exec(content)) !== null) {
      const fqcn = phpm[1].replace(/\\/g, "/");
      const className = path.basename(fqcn);
      const target = findFileByName(pathIndex, `${className}.php`, relPath);
      if (target && target !== relPath) deps.add(target);
    }
  }

  // --- 13. Rust (.rs) mod declarations → file-to-file ---
  if (ext === ".rs") {
    const modPattern = /^mod\s+(\w+);/gm;
    let mm: RegExpExecArray | null;
    while ((mm = modPattern.exec(content)) !== null) {
      const modName = mm[1];
      const direct = findFileByName(pathIndex, `${modName}.rs`, relPath);
      if (direct && direct !== relPath) {
        deps.add(direct);
      } else {
        const modFile = findFileByName(pathIndex, "mod.rs", relPath);
        if (modFile && modFile.replace(/\\/g, "/").includes(`${modName}/mod.rs`) && modFile !== relPath) {
          deps.add(modFile);
        }
      }
    }
  }

  // --- 14. C/C++ (.c, .cpp, .h, .hpp) local #include "..." → file-to-file ---
  if ([".c", ".cpp", ".h", ".hpp", ".cc", ".cxx", ".hxx"].includes(ext)) {
    const includePattern = /#include\s+"([^"]+)"/g;
    let im: RegExpExecArray | null;
    while ((im = includePattern.exec(content)) !== null) {
      const headerName = path.basename(im[1]);
      const target = findFileByName(pathIndex, headerName, relPath);
      if (target && target !== relPath) deps.add(target);
    }
  }

  return [...deps];
}

/** Find the closest manifest file (e.g., .csproj) in the same directory tree. */
function findClosestManifest(
  filePath: string,
  allFiles: ExtractedFile[],
  extensions: string[]
): string | undefined {
  const fileDir = path.dirname(filePath).replace(/\\/g, "/").toLowerCase();
  let bestMatch: string | undefined;
  let bestDepth = Infinity;

  for (const f of allFiles) {
    const ext = path.extname(f.relativePath).toLowerCase();
    if (!extensions.includes(ext)) continue;
    const manifestDir = path.dirname(f.relativePath).replace(/\\/g, "/").toLowerCase();
    // Prefer manifests in the same directory or a parent directory
    if (fileDir.startsWith(manifestDir) || manifestDir === ".") {
      const depth = fileDir.replace(manifestDir, "").split("/").filter(Boolean).length;
      if (depth < bestDepth) {
        bestDepth = depth;
        bestMatch = f.relativePath;
      }
    }
  }
  return bestMatch;
}

/** Resolve a relative import path to an actual file in the project. */
function resolveLocalImport(
  fromFile: string,
  importPath: string,
  pathIndex: Map<string, string[]>
): string | undefined {
  const fromDir = path.dirname(fromFile);
  const resolved = path.posix.normalize(path.posix.join(fromDir.replace(/\\/g, "/"), importPath));
  const base = path.basename(resolved).toLowerCase();

  // Try exact match
  const exact = pathIndex.get(base);
  if (exact) {
    const match = exact.find(p => p.replace(/\\/g, "/").toLowerCase().includes(resolved.toLowerCase()));
    if (match) return match;
  }

  // Try with common extensions
  for (const tryExt of [".ts", ".tsx", ".js", ".jsx", ".mjs"]) {
    const withExt = `${base}${tryExt}`;
    const candidates = pathIndex.get(withExt);
    if (candidates?.length) return candidates[0];
  }

  // Try index file in directory
  for (const idx of ["index.ts", "index.js", "index.tsx", "index.jsx"]) {
    const candidates = pathIndex.get(idx);
    if (candidates) {
      const match = candidates.find(p =>
        p.replace(/\\/g, "/").toLowerCase().startsWith(resolved.toLowerCase() + "/")
      );
      if (match) return match;
    }
  }

  return undefined;
}
