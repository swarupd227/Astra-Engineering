/**
 * Change Summary Generator
 *
 * After each dependency layer completes, produces a compact structured summary
 * of what changed (paths, versions, removed packages, exports). This summary is
 * injected into subsequent LLM calls so downstream files have full context of
 * upstream changes — e.g., a layout file knows the new paths from libman.json.
 *
 * All diffing is programmatic (no LLM call). Summaries are kept small enough
 * to fit within the reserved token budget (~1-2K tokens).
 */

import * as path from "path";

// ── Public types ──

export interface FileChangeSummary {
  path: string;
  changeType: "modified" | "version_update" | "removed_packages" | "path_change";
  summary: string;
  pathChanges: Array<{ oldPath: string; newPath: string }>;
  versionChanges: Array<{ package: string; oldVersion: string; newVersion: string }>;
  removedItems: string[];
  /** Libraries that were substituted with API-incompatible replacements */
  librarySubstitutions: Array<{ removed: string; addedReplacement: string; apiWarning: string }>;
}

export interface LayerChangeSummary {
  layerIndex: number;
  files: FileChangeSummary[];
}

export interface AccumulatedChangeSummary {
  layers: LayerChangeSummary[];
}

// ── Main API ──

/**
 * Build a change summary for one layer by diffing original vs upgraded content.
 */
export function buildLayerChangeSummary(
  layerIndex: number,
  upgradedFiles: Array<{ path: string; content: string; originalContent?: string }>
): LayerChangeSummary {
  const files: FileChangeSummary[] = [];

  for (const file of upgradedFiles) {
    if (!file.originalContent || file.content === file.originalContent) continue;

    const ext = path.extname(file.path).toLowerCase();
    const baseName = path.basename(file.path).toLowerCase();

    let summary: FileChangeSummary | null = null;

    if (baseName === "libman.json" || baseName === "bower.json") {
      summary = diffClientSideManifest(file);
    } else if (ext === ".csproj" || ext === ".vbproj" || ext === ".fsproj") {
      summary = diffCsprojFile(file);
    } else if (baseName === "package.json") {
      summary = diffPackageJson(file);
    } else if (baseName === "pom.xml") {
      summary = diffPomXml(file);
    } else if (baseName === "build.gradle" || baseName === "build.gradle.kts") {
      summary = diffBuildGradle(file);
    } else if (baseName === "requirements.txt" || baseName === "requirements-dev.txt") {
      summary = diffRequirementsTxt(file);
    } else if (baseName === "go.mod") {
      summary = diffGoMod(file);
    } else if (baseName === "cargo.toml") {
      summary = diffCargoToml(file);
    } else if (baseName === "gemfile") {
      summary = diffGemfile(file);
    } else if (baseName === "composer.json") {
      summary = diffComposerJson(file);
    } else if ([".cshtml", ".html", ".razor", ".htm", ".jsp", ".jspf", ".ftl", ".vm", ".erb", ".haml", ".slim", ".twig", ".pug", ".ejs", ".hbs", ".njk", ".j2", ".jinja2", ".vue", ".svelte", ".astro"].includes(ext) || baseName.endsWith(".blade.php")) {
      summary = diffViewFile(file);
      // Also check for CDN version changes in view files
      const cdnSummary = diffCdnReferences(file);
      if (cdnSummary.versionChanges.length > 0) {
        summary.versionChanges.push(...cdnSummary.versionChanges);
        if (cdnSummary.summary) {
          summary.summary = summary.summary
            ? `${summary.summary}; ${cdnSummary.summary}`
            : cdnSummary.summary;
        }
      }
    } else if ([".cs", ".ts", ".js", ".tsx", ".jsx", ".java", ".py", ".go", ".rb", ".php", ".rs", ".kt", ".kts", ".swift", ".dart", ".scala", ".c", ".cpp", ".h", ".hpp", ".ex", ".exs"].includes(ext)) {
      summary = diffCodeFile(file);
    } else {
      summary = diffGeneric(file);
    }

    if (summary && summary.summary) {
      files.push(summary);
    }
  }

  return { layerIndex, files };
}

/**
 * Format an accumulated summary into a compact string for LLM injection.
 * Kept within `maxTokens` estimate (1 token ≈ 3.5 chars).
 */
export function formatChangeSummaryForPrompt(
  accumulated: AccumulatedChangeSummary,
  maxTokens: number = 2000
): string {
  if (accumulated.layers.length === 0) return "";

  const allFiles = accumulated.layers.flatMap(l => l.files);
  if (allFiles.length === 0) return "";

  const lines: string[] = [
    "**CHANGES ALREADY MADE IN PREVIOUS FILES (use these as context for this upgrade):**",
    "",
  ];

  const maxChars = maxTokens * 3.5;
  let charCount = lines.join("\n").length;

  for (const file of allFiles) {
    const fileLines: string[] = [];
    fileLines.push(`- **${file.path}**: ${file.summary}`);

    for (const pc of file.pathChanges) {
      if (pc.oldPath === pc.newPath) {
        fileLines.push(`  - Path: "${pc.newPath}" (unchanged)`);
      } else {
        fileLines.push(`  - Path changed: "${pc.oldPath}" → "${pc.newPath}"`);
      }
    }
    for (const vc of file.versionChanges) {
      fileLines.push(`  - ${vc.package}: ${vc.oldVersion} → ${vc.newVersion}`);
    }
    for (const rm of file.removedItems) {
      fileLines.push(`  - Removed: ${rm}`);
    }
    for (const sub of (file.librarySubstitutions || [])) {
      fileLines.push(`  - ⚠️ LIBRARY SUBSTITUTION: "${sub.removed}" → "${sub.addedReplacement}". ${sub.apiWarning}`);
    }

    const block = fileLines.join("\n");
    if (charCount + block.length > maxChars) {
      lines.push("- _(additional changes truncated for token budget)_");
      break;
    }
    lines.push(block);
    charCount += block.length;
  }

  return lines.join("\n");
}

// ── Diff helpers ──

function diffClientSideManifest(
  file: { path: string; content: string; originalContent?: string }
): FileChangeSummary {
  const pathChanges: FileChangeSummary["pathChanges"] = [];
  const versionChanges: FileChangeSummary["versionChanges"] = [];
  const removedItems: string[] = [];
  const librarySubstitutions: FileChangeSummary["librarySubstitutions"] = [];
  const summaryParts: string[] = [];

  try {
    const oldParsed = JSON.parse(file.originalContent || "{}");
    const newParsed = JSON.parse(file.content);
    const oldLibs: any[] = oldParsed.libraries || [];
    const newLibs: any[] = newParsed.libraries || [];

    const oldMap = new Map<string, any>();
    for (const lib of oldLibs) {
      const name = extractLibName(lib.library || "");
      oldMap.set(name, lib);
    }

    for (const lib of newLibs) {
      const name = extractLibName(lib.library || "");
      const oldLib = oldMap.get(name);
      const newVer = extractLibVersion(lib.library || "");
      const oldVer = oldLib ? extractLibVersion(oldLib.library || "") : null;

      if (oldVer && newVer && oldVer !== newVer) {
        versionChanges.push({ package: name, oldVersion: oldVer, newVersion: newVer });
        summaryParts.push(`${name} ${oldVer} → ${newVer}`);
      }

      // Track destination + file paths
      const dest = (lib.destination || "").replace(/\\/g, "/");
      const oldDest = oldLib ? (oldLib.destination || "").replace(/\\/g, "/") : "";
      const newFiles: string[] = lib.files || [];
      const oldFiles: string[] = oldLib?.files || [];

      for (const nf of newFiles) {
        const newFullPath = `${dest}${nf}`;
        const oldMatch = oldFiles.find(of => of.split("/").pop() === nf.split("/").pop());
        const oldFullPath = oldMatch ? `${oldDest}${oldMatch}` : "";
        if (oldFullPath && oldFullPath !== newFullPath) {
          pathChanges.push({ oldPath: oldFullPath, newPath: newFullPath });
        } else if (!oldFullPath) {
          pathChanges.push({ oldPath: "(new)", newPath: newFullPath });
        } else {
          pathChanges.push({ oldPath: newFullPath, newPath: newFullPath });
        }
      }
    }

    // Detect removed libraries and potential substitutions
    const removedNames: string[] = [];
    for (const [name] of oldMap) {
      const stillExists = newLibs.some(l => extractLibName(l.library || "") === name);
      if (!stillExists) {
        removedItems.push(name);
        removedNames.push(name);
        summaryParts.push(`removed ${name}`);
      }
    }

    // Detect newly added libraries (not present in old manifest)
    const addedNames: string[] = [];
    for (const lib of newLibs) {
      const name = extractLibName(lib.library || "");
      if (!oldMap.has(name)) {
        addedNames.push(name);
      }
    }

    // If libraries were both removed and added, flag potential API-incompatible substitutions
    if (removedNames.length > 0 && addedNames.length > 0) {
      for (const removed of removedNames) {
        for (const added of addedNames) {
          librarySubstitutions.push({
            removed,
            addedReplacement: added,
            apiWarning: `"${removed}" was replaced by "${added}". ` +
              `If "${removed}" had jQuery plugin APIs (e.g., .${removed.split("-").pop()}()), ` +
              `all view/template files using those APIs must be rewritten to use "${added}"'s API instead. ` +
              `Check all .cshtml, .html, .jsp, .erb files for .${removed.split("-").pop()}() calls.`,
          });
        }
        summaryParts.push(
          `⚠️ "${removed}" was REMOVED and replaced — any files calling .${removed.split("-").pop()}() must migrate to the new library's API`
        );
      }
    }
  } catch { /* non-parseable — fall through */ }

  // Add version-specific migration directives
  const migrationDirectives = buildMigrationDirectives(versionChanges);
  if (migrationDirectives.length > 0) {
    summaryParts.push(...migrationDirectives);
  }

  return {
    path: file.path,
    changeType: "path_change",
    summary: summaryParts.length > 0
      ? `Client-side libraries updated: ${summaryParts.join(", ")}`
      : "Client-side manifest modified",
    pathChanges,
    versionChanges,
    removedItems,
    librarySubstitutions,
  };
}

function diffCsprojFile(
  file: { path: string; content: string; originalContent?: string }
): FileChangeSummary {
  const versionChanges: FileChangeSummary["versionChanges"] = [];
  const removedItems: string[] = [];
  const summaryParts: string[] = [];

  const oldContent = file.originalContent || "";
  const newContent = file.content;

  // TFM change
  const oldTfm = oldContent.match(/<TargetFramework>\s*([^<]+)\s*<\/TargetFramework>/i)?.[1];
  const newTfm = newContent.match(/<TargetFramework>\s*([^<]+)\s*<\/TargetFramework>/i)?.[1];
  if (oldTfm && newTfm && oldTfm !== newTfm) {
    versionChanges.push({ package: "TargetFramework", oldVersion: oldTfm, newVersion: newTfm });
    summaryParts.push(`TFM: ${oldTfm} → ${newTfm}`);
  }

  // Package version changes
  const oldPkgs = extractCsprojPackages(oldContent);
  const newPkgs = extractCsprojPackages(newContent);

  for (const [name, newVer] of newPkgs) {
    const oldVer = oldPkgs.get(name);
    if (oldVer && oldVer !== newVer) {
      versionChanges.push({ package: name, oldVersion: oldVer, newVersion: newVer });
    }
  }

  // Removed packages
  for (const [name] of oldPkgs) {
    if (!newPkgs.has(name)) {
      removedItems.push(name);
    }
  }

  if (versionChanges.length > 0) {
    summaryParts.push(`${versionChanges.length} packages updated`);
  }
  if (removedItems.length > 0) {
    summaryParts.push(`${removedItems.length} packages removed (shared framework)`);
  }

  return {
    path: file.path,
    changeType: removedItems.length > 0 ? "removed_packages" : "version_update",
    summary: summaryParts.join("; ") || "Project file modified",
    pathChanges: [],
    versionChanges,
    removedItems,
    librarySubstitutions: [],
  };
}

function diffPackageJson(
  file: { path: string; content: string; originalContent?: string }
): FileChangeSummary {
  const versionChanges: FileChangeSummary["versionChanges"] = [];
  const removedItems: string[] = [];
  const librarySubstitutions: FileChangeSummary["librarySubstitutions"] = [];

  try {
    const oldParsed = JSON.parse(file.originalContent || "{}");
    const newParsed = JSON.parse(file.content);

    const allOldPkgs = new Set<string>();
    const allNewPkgs = new Set<string>();

    for (const section of ["dependencies", "devDependencies"]) {
      const oldDeps = oldParsed[section] || {};
      const newDeps = newParsed[section] || {};
      for (const [pkg, ver] of Object.entries(newDeps)) {
        allNewPkgs.add(pkg);
        if (oldDeps[pkg] && oldDeps[pkg] !== ver) {
          versionChanges.push({ package: pkg, oldVersion: String(oldDeps[pkg]), newVersion: String(ver) });
        }
      }
      for (const pkg of Object.keys(oldDeps)) {
        allOldPkgs.add(pkg);
        if (!newDeps[pkg]) removedItems.push(pkg);
      }
    }

    // Detect substitutions: packages removed + new ones added
    const added = [...allNewPkgs].filter(p => !allOldPkgs.has(p));
    if (removedItems.length > 0 && added.length > 0) {
      for (const removed of removedItems) {
        for (const replacement of added) {
          librarySubstitutions.push({
            removed,
            addedReplacement: replacement,
            apiWarning: `"${removed}" was replaced by "${replacement}". ` +
              `All files importing/requiring "${removed}" must be updated to use "${replacement}"'s API.`,
          });
        }
      }
    }
  } catch { /* ignore parse errors */ }

  const migrationDirectives = buildMigrationDirectives(versionChanges);
  const summaryParts: string[] = [];
  if (versionChanges.length > 0) summaryParts.push(`${versionChanges.length} npm packages updated`);
  if (migrationDirectives.length > 0) summaryParts.push(...migrationDirectives);

  return {
    path: file.path,
    changeType: "version_update",
    summary: summaryParts.length > 0
      ? summaryParts.join("; ")
      : "package.json modified",
    pathChanges: [],
    versionChanges: versionChanges.slice(0, 10),
    removedItems: removedItems.slice(0, 10),
    librarySubstitutions,
  };
}

function diffViewFile(
  file: { path: string; content: string; originalContent?: string }
): FileChangeSummary {
  const pathChanges: FileChangeSummary["pathChanges"] = [];

  const oldRefs = extractAssetRefs(file.originalContent || "");
  const newRefs = extractAssetRefs(file.content);

  const oldSet = new Set(oldRefs);
  const newSet = new Set(newRefs);

  // Find changed paths (removed old + added new with same filename)
  for (const oldRef of oldRefs) {
    if (!newSet.has(oldRef)) {
      const oldBase = oldRef.split("/").pop() || "";
      const replacement = newRefs.find(nr => !oldSet.has(nr) && (nr.split("/").pop() || "") === oldBase);
      if (replacement) {
        pathChanges.push({ oldPath: oldRef, newPath: replacement });
      } else {
        pathChanges.push({ oldPath: oldRef, newPath: "(removed)" });
      }
    }
  }

  const summaryParts: string[] = [];
  if (pathChanges.length > 0) {
    summaryParts.push(`${pathChanges.length} asset reference(s) changed`);
  }

  // Detect CSS class changes (e.g., Bootstrap migration)
  const oldClasses = extractCssClasses(file.originalContent || "");
  const newClasses = extractCssClasses(file.content);
  const classesChanged = [...oldClasses].filter(c => !newClasses.has(c)).length;
  if (classesChanged > 0) {
    summaryParts.push(`${classesChanged} CSS class(es) migrated`);
  }

  return {
    path: file.path,
    changeType: "modified",
    summary: summaryParts.join("; ") || "View/template modified",
    pathChanges: pathChanges.slice(0, 10),
    versionChanges: [],
    removedItems: [],
    librarySubstitutions: [],
  };
}

function diffCodeFile(
  file: { path: string; content: string; originalContent?: string }
): FileChangeSummary {
  const oldImports = extractImportLines(file.originalContent || "");
  const newImports = extractImportLines(file.content);

  const added = newImports.filter(i => !oldImports.includes(i));
  const removed = oldImports.filter(i => !newImports.includes(i));

  const summaryParts: string[] = [];
  if (added.length > 0) summaryParts.push(`${added.length} import(s) added`);
  if (removed.length > 0) summaryParts.push(`${removed.length} import(s) removed`);
  if (summaryParts.length === 0) summaryParts.push("Code modified");

  return {
    path: file.path,
    changeType: "modified",
    summary: summaryParts.join("; "),
    pathChanges: [],
    versionChanges: [],
    removedItems: removed.slice(0, 5),
    librarySubstitutions: [],
  };
}

function diffPomXml(
  file: { path: string; content: string; originalContent?: string }
): FileChangeSummary {
  const versionChanges: FileChangeSummary["versionChanges"] = [];
  const removedItems: string[] = [];
  const summaryParts: string[] = [];
  const oldContent = file.originalContent || "";
  const newContent = file.content;

  const oldParentVer = oldContent.match(/<parent>[\s\S]*?<version>\s*([^<]+)\s*<\/version>[\s\S]*?<\/parent>/i)?.[1];
  const newParentVer = newContent.match(/<parent>[\s\S]*?<version>\s*([^<]+)\s*<\/version>[\s\S]*?<\/parent>/i)?.[1];
  if (oldParentVer && newParentVer && oldParentVer !== newParentVer) {
    versionChanges.push({ package: "parent", oldVersion: oldParentVer, newVersion: newParentVer });
    summaryParts.push(`parent ${oldParentVer} → ${newParentVer}`);
  }

  const oldDeps = extractPomDependencies(oldContent);
  const newDeps = extractPomDependencies(newContent);
  for (const [name, newVer] of newDeps) {
    const oldVer = oldDeps.get(name);
    if (oldVer && oldVer !== newVer) {
      versionChanges.push({ package: name, oldVersion: oldVer, newVersion: newVer });
    }
  }
  for (const [name] of oldDeps) {
    if (!newDeps.has(name)) removedItems.push(name);
  }

  const oldProps = extractPomProperties(oldContent);
  const newProps = extractPomProperties(newContent);
  let propsChanged = 0;
  for (const [name, newVal] of newProps) {
    const oldVal = oldProps.get(name);
    if (oldVal && oldVal !== newVal) {
      propsChanged++;
      if (name.includes("version")) {
        versionChanges.push({ package: name, oldVersion: oldVal, newVersion: newVal });
      }
    }
  }

  if (versionChanges.length > 0) summaryParts.push(`${versionChanges.length} dependency version(s) updated`);
  if (removedItems.length > 0) summaryParts.push(`${removedItems.length} dependencies removed`);
  if (propsChanged > 0) summaryParts.push(`${propsChanged} properties changed`);

  return {
    path: file.path,
    changeType: removedItems.length > 0 ? "removed_packages" : "version_update",
    summary: summaryParts.join("; ") || "pom.xml modified",
    pathChanges: [],
    versionChanges: versionChanges.slice(0, 15),
    removedItems: removedItems.slice(0, 10),
    librarySubstitutions: [],
  };
}

function extractPomDependencies(content: string): Map<string, string> {
  const map = new Map<string, string>();
  const pattern = /<dependency>\s*<groupId>\s*([^<]+)\s*<\/groupId>\s*<artifactId>\s*([^<]+)\s*<\/artifactId>(?:\s*<version>\s*([^<]+)\s*<\/version>)?/gi;
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(content)) !== null) {
    const key = `${m[1].trim()}:${m[2].trim()}`;
    const ver = m[3]?.trim() || "managed";
    map.set(key, ver);
  }
  return map;
}

function extractPomProperties(content: string): Map<string, string> {
  const map = new Map<string, string>();
  const propsMatch = content.match(/<properties>([\s\S]*?)<\/properties>/i);
  if (propsMatch) {
    const propPattern = /<(\S+?)>\s*([^<]+)\s*<\/\1>/g;
    let m: RegExpExecArray | null;
    while ((m = propPattern.exec(propsMatch[1])) !== null) {
      map.set(m[1], m[2].trim());
    }
  }
  return map;
}

function diffBuildGradle(
  file: { path: string; content: string; originalContent?: string }
): FileChangeSummary {
  const versionChanges: FileChangeSummary["versionChanges"] = [];
  const removedItems: string[] = [];
  const summaryParts: string[] = [];

  const oldDeps = extractGradleDependencies(file.originalContent || "");
  const newDeps = extractGradleDependencies(file.content);
  for (const [name, newVer] of newDeps) {
    const oldVer = oldDeps.get(name);
    if (oldVer && oldVer !== newVer) {
      versionChanges.push({ package: name, oldVersion: oldVer, newVersion: newVer });
    }
  }
  for (const [name] of oldDeps) {
    if (!newDeps.has(name)) removedItems.push(name);
  }

  if (versionChanges.length > 0) summaryParts.push(`${versionChanges.length} dependency version(s) updated`);
  if (removedItems.length > 0) summaryParts.push(`${removedItems.length} dependencies removed`);

  return {
    path: file.path,
    changeType: removedItems.length > 0 ? "removed_packages" : "version_update",
    summary: summaryParts.join("; ") || "build.gradle modified",
    pathChanges: [],
    versionChanges: versionChanges.slice(0, 15),
    removedItems: removedItems.slice(0, 10),
    librarySubstitutions: [],
  };
}

function extractGradleDependencies(content: string): Map<string, string> {
  const map = new Map<string, string>();
  const pattern = /(?:implementation|api|compile|compileOnly|runtimeOnly|testImplementation|testCompile|classpath)\s+['"]([^'"]+)['"]/gi;
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(content)) !== null) {
    const parts = m[1].split(":");
    if (parts.length >= 3) {
      map.set(`${parts[0]}:${parts[1]}`, parts[2]);
    } else if (parts.length === 2) {
      map.set(parts[0], parts[1]);
    }
  }
  return map;
}

function diffRequirementsTxt(
  file: { path: string; content: string; originalContent?: string }
): FileChangeSummary {
  const versionChanges: FileChangeSummary["versionChanges"] = [];
  const removedItems: string[] = [];
  const summaryParts: string[] = [];

  const oldDeps = extractPipRequirements(file.originalContent || "");
  const newDeps = extractPipRequirements(file.content);
  for (const [name, newVer] of newDeps) {
    const oldVer = oldDeps.get(name);
    if (oldVer && oldVer !== newVer) {
      versionChanges.push({ package: name, oldVersion: oldVer, newVersion: newVer });
    }
  }
  for (const [name] of oldDeps) {
    if (!newDeps.has(name)) removedItems.push(name);
  }

  if (versionChanges.length > 0) summaryParts.push(`${versionChanges.length} package version(s) updated`);
  if (removedItems.length > 0) summaryParts.push(`${removedItems.length} packages removed`);

  return {
    path: file.path,
    changeType: removedItems.length > 0 ? "removed_packages" : "version_update",
    summary: summaryParts.join("; ") || "requirements.txt modified",
    pathChanges: [],
    versionChanges: versionChanges.slice(0, 15),
    removedItems: removedItems.slice(0, 10),
    librarySubstitutions: [],
  };
}

function extractPipRequirements(content: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("-")) continue;
    const match = trimmed.match(/^([a-zA-Z0-9_.-]+)\s*([=<>!~]+)\s*(.+)/);
    if (match) {
      map.set(match[1].toLowerCase(), `${match[2]}${match[3].trim()}`);
    }
  }
  return map;
}

function diffGoMod(
  file: { path: string; content: string; originalContent?: string }
): FileChangeSummary {
  const versionChanges: FileChangeSummary["versionChanges"] = [];
  const removedItems: string[] = [];
  const summaryParts: string[] = [];

  const oldDeps = extractGoModDependencies(file.originalContent || "");
  const newDeps = extractGoModDependencies(file.content);
  for (const [name, newVer] of newDeps) {
    const oldVer = oldDeps.get(name);
    if (oldVer && oldVer !== newVer) {
      versionChanges.push({ package: name, oldVersion: oldVer, newVersion: newVer });
    }
  }
  for (const [name] of oldDeps) {
    if (!newDeps.has(name)) removedItems.push(name);
  }

  const oldGoVer = (file.originalContent || "").match(/^go\s+(\S+)/m)?.[1];
  const newGoVer = file.content.match(/^go\s+(\S+)/m)?.[1];
  if (oldGoVer && newGoVer && oldGoVer !== newGoVer) {
    versionChanges.unshift({ package: "go", oldVersion: oldGoVer, newVersion: newGoVer });
    summaryParts.push(`go ${oldGoVer} → ${newGoVer}`);
  }

  if (versionChanges.length > 0) summaryParts.push(`${versionChanges.length} module version(s) updated`);
  if (removedItems.length > 0) summaryParts.push(`${removedItems.length} modules removed`);

  return {
    path: file.path,
    changeType: removedItems.length > 0 ? "removed_packages" : "version_update",
    summary: summaryParts.join("; ") || "go.mod modified",
    pathChanges: [],
    versionChanges: versionChanges.slice(0, 15),
    removedItems: removedItems.slice(0, 10),
    librarySubstitutions: [],
  };
}

function extractGoModDependencies(content: string): Map<string, string> {
  const map = new Map<string, string>();
  const blockMatch = content.match(/require\s*\(([\s\S]*?)\)/g);
  if (blockMatch) {
    for (const block of blockMatch) {
      const inner = block.replace(/^require\s*\(/, "").replace(/\)$/, "");
      for (const line of inner.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("//")) continue;
        const parts = trimmed.split(/\s+/);
        if (parts.length >= 2) {
          map.set(parts[0], parts[1]);
        }
      }
    }
  }
  const singlePattern = /^require\s+(\S+)\s+(\S+)/gm;
  let m: RegExpExecArray | null;
  while ((m = singlePattern.exec(content)) !== null) {
    map.set(m[1], m[2]);
  }
  return map;
}

function diffCargoToml(
  file: { path: string; content: string; originalContent?: string }
): FileChangeSummary {
  const versionChanges: FileChangeSummary["versionChanges"] = [];
  const removedItems: string[] = [];
  const summaryParts: string[] = [];

  const oldDeps = extractCargoDependencies(file.originalContent || "");
  const newDeps = extractCargoDependencies(file.content);
  for (const [name, newVer] of newDeps) {
    const oldVer = oldDeps.get(name);
    if (oldVer && oldVer !== newVer) {
      versionChanges.push({ package: name, oldVersion: oldVer, newVersion: newVer });
    }
  }
  for (const [name] of oldDeps) {
    if (!newDeps.has(name)) removedItems.push(name);
  }

  if (versionChanges.length > 0) summaryParts.push(`${versionChanges.length} crate version(s) updated`);
  if (removedItems.length > 0) summaryParts.push(`${removedItems.length} crates removed`);

  return {
    path: file.path,
    changeType: removedItems.length > 0 ? "removed_packages" : "version_update",
    summary: summaryParts.join("; ") || "Cargo.toml modified",
    pathChanges: [],
    versionChanges: versionChanges.slice(0, 15),
    removedItems: removedItems.slice(0, 10),
    librarySubstitutions: [],
  };
}

function extractCargoDependencies(content: string): Map<string, string> {
  const map = new Map<string, string>();
  const sections = content.match(/\[((?:dev-|build-)?dependencies)\]([\s\S]*?)(?=\n\[|$)/gi);
  if (sections) {
    for (const section of sections) {
      const simplePattern = /^(\w[\w-]*)\s*=\s*"([^"]+)"/gm;
      let m: RegExpExecArray | null;
      while ((m = simplePattern.exec(section)) !== null) {
        map.set(m[1], m[2]);
      }
      const tablePattern = /^(\w[\w-]*)\s*=\s*\{[^}]*version\s*=\s*"([^"]+)"/gm;
      while ((m = tablePattern.exec(section)) !== null) {
        map.set(m[1], m[2]);
      }
    }
  }
  return map;
}

function diffGemfile(
  file: { path: string; content: string; originalContent?: string }
): FileChangeSummary {
  const versionChanges: FileChangeSummary["versionChanges"] = [];
  const removedItems: string[] = [];
  const summaryParts: string[] = [];

  const oldDeps = extractGemfileDependencies(file.originalContent || "");
  const newDeps = extractGemfileDependencies(file.content);
  for (const [name, newVer] of newDeps) {
    const oldVer = oldDeps.get(name);
    if (oldVer && oldVer !== newVer) {
      versionChanges.push({ package: name, oldVersion: oldVer, newVersion: newVer });
    }
  }
  for (const [name] of oldDeps) {
    if (!newDeps.has(name)) removedItems.push(name);
  }

  if (versionChanges.length > 0) summaryParts.push(`${versionChanges.length} gem version(s) updated`);
  if (removedItems.length > 0) summaryParts.push(`${removedItems.length} gems removed`);

  return {
    path: file.path,
    changeType: removedItems.length > 0 ? "removed_packages" : "version_update",
    summary: summaryParts.join("; ") || "Gemfile modified",
    pathChanges: [],
    versionChanges: versionChanges.slice(0, 15),
    removedItems: removedItems.slice(0, 10),
    librarySubstitutions: [],
  };
}

function extractGemfileDependencies(content: string): Map<string, string> {
  const map = new Map<string, string>();
  const pattern = /gem\s+['"]([^'"]+)['"]\s*,\s*['"]([^'"]+)['"]/gi;
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(content)) !== null) {
    map.set(m[1], m[2]);
  }
  return map;
}

function diffComposerJson(
  file: { path: string; content: string; originalContent?: string }
): FileChangeSummary {
  const versionChanges: FileChangeSummary["versionChanges"] = [];
  const removedItems: string[] = [];
  const librarySubstitutions: FileChangeSummary["librarySubstitutions"] = [];

  try {
    const oldParsed = JSON.parse(file.originalContent || "{}");
    const newParsed = JSON.parse(file.content);
    const allOldPkgs = new Set<string>();
    const allNewPkgs = new Set<string>();

    for (const section of ["require", "require-dev"]) {
      const oldDeps = oldParsed[section] || {};
      const newDeps = newParsed[section] || {};
      for (const [pkg, ver] of Object.entries(newDeps)) {
        allNewPkgs.add(pkg);
        if (oldDeps[pkg] && oldDeps[pkg] !== ver) {
          versionChanges.push({ package: pkg, oldVersion: String(oldDeps[pkg]), newVersion: String(ver) });
        }
      }
      for (const pkg of Object.keys(oldDeps)) {
        allOldPkgs.add(pkg);
        if (!(pkg in (newParsed[section] || {}))) removedItems.push(pkg);
      }
    }

    const added = [...allNewPkgs].filter(p => !allOldPkgs.has(p));
    if (removedItems.length > 0 && added.length > 0) {
      for (const removed of removedItems) {
        for (const replacement of added) {
          librarySubstitutions.push({
            removed,
            addedReplacement: replacement,
            apiWarning: `"${removed}" was replaced by "${replacement}". All files using "${removed}" must be updated.`,
          });
        }
      }
    }
  } catch { /* ignore parse errors */ }

  return {
    path: file.path,
    changeType: "version_update",
    summary: versionChanges.length > 0
      ? `${versionChanges.length} composer packages updated`
      : "composer.json modified",
    pathChanges: [],
    versionChanges: versionChanges.slice(0, 15),
    removedItems: removedItems.slice(0, 10),
    librarySubstitutions,
  };
}

function diffGenericManifest(
  file: { path: string; content: string; originalContent?: string }
): FileChangeSummary {
  return {
    path: file.path,
    changeType: "modified",
    summary: "Manifest file modified",
    pathChanges: [],
    versionChanges: [],
    removedItems: [],
    librarySubstitutions: [],
  };
}

function diffGeneric(
  file: { path: string; content: string; originalContent?: string }
): FileChangeSummary {
  return {
    path: file.path,
    changeType: "modified",
    summary: "File modified",
    pathChanges: [],
    versionChanges: [],
    removedItems: [],
    librarySubstitutions: [],
  };
}

// ── Version-specific migration directives ──

const MIGRATION_DIRECTIVES: Array<{
  library: string;
  fromMajor: number;
  toMajor: number;
  directives: string[];
}> = [
  {
    library: "bootstrap",
    fromMajor: 4,
    toMajor: 5,
    directives: [
      "ALL views MUST use data-bs-* attributes (NOT data-toggle, data-target, data-dismiss)",
      "ALL views MUST replace: form-group→mb-3, ml-*→ms-*, mr-*→me-*, pl-*→ps-*, pr-*→pe-*",
      "ALL views MUST replace: float-left→float-start, float-right→float-end, text-left→text-start, text-right→text-end",
      "jQuery-based Bootstrap plugins (.tooltip(), .modal(), etc.) MUST use vanilla JS: new bootstrap.Tooltip(el)",
    ],
  },
  {
    library: "bootstrap",
    fromMajor: 3,
    toMajor: 5,
    directives: [
      "ALL views MUST use data-bs-* attributes (NOT data-toggle, data-target, data-dismiss)",
      "ALL views MUST replace deprecated BS3 classes with BS5 equivalents",
      "Panel→Card, Glyphicon→removed (use Font Awesome or Bootstrap Icons), Well→Card with bg-light",
    ],
  },
  {
    library: "jquery",
    fromMajor: 3,
    toMajor: 4,
    directives: [
      "$.isArray() MUST become Array.isArray()",
      "$.parseJSON() MUST become JSON.parse()",
      "$.trim() MUST become String.prototype.trim()",
      ".bind()/.unbind() MUST become .on()/.off()",
      ".delegate()/.undelegate() MUST become .on()/.off()",
    ],
  },
  {
    library: "spring-boot",
    fromMajor: 2,
    toMajor: 3,
    directives: [
      "ALL javax.* imports MUST become jakarta.* (persistence, servlet, validation, annotation, inject, etc.)",
      "Spring Security: antMatchers→requestMatchers, mvcMatchers→requestMatchers",
      "spring.factories→META-INF/spring/org.springframework.boot.autoconfigure.AutoConfiguration.imports",
    ],
  },
  {
    library: "angular",
    fromMajor: 14,
    toMajor: 15,
    directives: [
      "entryComponents removed — delete from all @NgModule declarations",
      "Standalone components are now default",
    ],
  },
  {
    library: "django",
    fromMajor: 3,
    toMajor: 4,
    directives: [
      "url() MUST become re_path() or path()",
      "ugettext/ugettext_lazy MUST become gettext/gettext_lazy",
    ],
  },
  {
    library: "vue",
    fromMajor: 2,
    toMajor: 3,
    directives: [
      "Vue.set()/Vue.delete() removed — use direct assignment/delete",
      "Filters removed — use computed properties or methods",
      "new Vue() MUST become createApp()",
    ],
  },
  {
    library: "react",
    fromMajor: 17,
    toMajor: 18,
    directives: [
      "ReactDOM.render() MUST become createRoot().render()",
      "Automatic batching is now default",
    ],
  },
];

function buildMigrationDirectives(
  versionChanges: Array<{ package: string; oldVersion: string; newVersion: string }>,
): string[] {
  const directives: string[] = [];
  for (const vc of versionChanges) {
    const lib = vc.package.toLowerCase();
    const oldMajor = parseInt(vc.oldVersion.split(".")[0], 10);
    const newMajor = parseInt(vc.newVersion.split(".")[0], 10);
    if (isNaN(oldMajor) || isNaN(newMajor)) continue;

    for (const md of MIGRATION_DIRECTIVES) {
      if (!lib.includes(md.library)) continue;
      if (oldMajor < md.toMajor && newMajor >= md.toMajor) {
        directives.push(`⚠️ MIGRATION REQUIRED (${vc.package} ${vc.oldVersion}→${vc.newVersion}): ${md.directives.join("; ")}`);
      }
    }
  }
  return directives;
}

// ── CDN Reference Diff ──

function diffCdnReferences(
  file: { path: string; content: string; originalContent?: string }
): FileChangeSummary {
  const versionChanges: FileChangeSummary["versionChanges"] = [];
  const summaryParts: string[] = [];

  try {
    const { extractCdnVersions } = require("./deterministic-transforms");
    const oldRefs: Array<{ library: string; version: string }> = extractCdnVersions(file.originalContent || "");
    const newRefs: Array<{ library: string; version: string }> = extractCdnVersions(file.content);

    const oldMap = new Map<string, string>();
    for (const ref of oldRefs) oldMap.set(ref.library, ref.version);

    for (const ref of newRefs) {
      const oldVer = oldMap.get(ref.library);
      if (oldVer && oldVer !== ref.version) {
        versionChanges.push({ package: ref.library, oldVersion: oldVer, newVersion: ref.version });
        summaryParts.push(`CDN ${ref.library}: ${oldVer} → ${ref.version}`);
      }
    }
  } catch { /* extractCdnVersions not available */ }

  const migrationDirectives = buildMigrationDirectives(versionChanges);
  if (migrationDirectives.length > 0) {
    summaryParts.push(...migrationDirectives);
  }

  return {
    path: file.path,
    changeType: "version_update",
    summary: summaryParts.length > 0
      ? `CDN references updated: ${summaryParts.join(", ")}`
      : "",
    pathChanges: [],
    versionChanges,
    removedItems: [],
    librarySubstitutions: [],
  };
}

// ── Utility extractors ──

function extractLibName(libStr: string): string {
  if (libStr.startsWith("@")) {
    const secondAt = libStr.indexOf("@", 1);
    return (secondAt > 0 ? libStr.substring(0, secondAt) : libStr).toLowerCase().trim();
  }
  return (libStr.split("@")[0] || libStr).toLowerCase().trim();
}

function extractLibVersion(libStr: string): string {
  const parts = libStr.split("@");
  return parts.length > 1 ? parts[parts.length - 1] : "";
}

function extractCsprojPackages(content: string): Map<string, string> {
  const map = new Map<string, string>();
  const pattern = /<PackageReference\s+Include="([^"]+)"\s+Version="([^"]+)"/gi;
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(content)) !== null) {
    map.set(m[1].toLowerCase(), m[2]);
  }
  return map;
}

function extractAssetRefs(content: string): string[] {
  const refs: string[] = [];
  const pattern = /(?:href|src)\s*=\s*["']([^"']+)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(content)) !== null) {
    const ref = m[1].trim();
    if (ref.includes("lib/") || ref.includes("cdn") || ref.endsWith(".css") || ref.endsWith(".js")) {
      refs.push(ref);
    }
  }
  return refs;
}

function extractCssClasses(content: string): Set<string> {
  const classes = new Set<string>();
  const addClasses = (raw: string) => {
    for (const cls of raw.split(/\s+/)) {
      if (cls) classes.add(cls);
    }
  };

  const staticPatterns = [
    /\bclass="([^"]+)"/gi,
    /\bclass='([^']+)'/gi,
    /\bclassName="([^"]+)"/gi,
    /\bclassName='([^']+)'/gi,
  ];
  for (const pattern of staticPatterns) {
    let m: RegExpExecArray | null;
    while ((m = pattern.exec(content)) !== null) {
      addClasses(m[1]);
    }
  }

  const bindingPatterns = [
    /\[ngClass\]="([^"]+)"/gi,
    /:class="([^"]+)"/gi,
  ];
  for (const pattern of bindingPatterns) {
    let m: RegExpExecArray | null;
    while ((m = pattern.exec(content)) !== null) {
      const quoted = m[1].match(/'([^']+)'/g);
      if (quoted) {
        for (const q of quoted) addClasses(q.replace(/'/g, ""));
      }
    }
  }
  return classes;
}

function extractImportLines(content: string): string[] {
  const lines = content.split("\n").map(l => l.trim());
  const imports: string[] = [];
  let inGoImportBlock = false;

  for (const line of lines) {
    if (/^import\s*\(/.test(line)) {
      inGoImportBlock = true;
      continue;
    }
    if (inGoImportBlock) {
      if (line === ")") {
        inGoImportBlock = false;
        continue;
      }
      if (line) imports.push(`import ${line}`);
      continue;
    }
    if (/^(import |using |use |require\(|require |from |#include|include )/.test(line)) {
      imports.push(line);
    }
  }
  return imports;
}
