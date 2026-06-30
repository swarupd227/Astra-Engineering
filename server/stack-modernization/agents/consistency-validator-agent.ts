/**
 * Consistency Validator Agent
 *
 * Runs after code_upgrade, before test_generation.
 * Performs deterministic cross-file checks to catch split-state
 * inconsistencies (e.g., Bootstrap 5 markup but Bootstrap 4 bundles).
 * Auto-fixes deterministic violations; collects the rest for an
 * optional targeted LLM fix pass.
 */

import type {
  StackModernizationState,
  ConsistencyReport,
  ConsistencyViolation,
  ModifiedFile,
  VersionSelection,
} from "../types";
import {
  applyTransforms,
  getApplicableRules,
  detectActiveStacks,
  extractCdnVersions,
  updateCdnVersions,
  type TransformRule,
} from "../services/deterministic-transforms";

// ── Pattern registries ──────────────────────────────────────────

const BS4_ATTR_RE = /data-(toggle|dismiss|target|parent|ride|slide|spy|offset)=/g;
const BS5_ATTR_RE = /data-bs-(toggle|dismiss|target|parent|ride|slide|spy|offset)=/g;

const VIEW_EXTENSIONS = new Set([
  ".cshtml", ".html", ".htm", ".razor", ".aspx", ".vue",
  ".jsx", ".tsx", ".hbs", ".ejs", ".pug", ".php", ".erb",
]);

function ext(filePath: string): string {
  const dot = filePath.lastIndexOf(".");
  return dot >= 0 ? filePath.substring(dot).toLowerCase() : "";
}

// ── Checks ──────────────────────────────────────────────────────

function checkBootstrapConsistency(
  files: ModifiedFile[],
  selections: VersionSelection[],
): ConsistencyViolation[] {
  const bsSel = selections.find(s => s.package.toLowerCase().includes("bootstrap"));
  if (!bsSel) return [];

  const targetMajor = parseInt(bsSel.selectedVersion.split(".")[0], 10);
  if (isNaN(targetMajor)) return [];

  const violations: ConsistencyViolation[] = [];

  for (const f of files) {
    if (!VIEW_EXTENSIONS.has(ext(f.path))) continue;

    BS4_ATTR_RE.lastIndex = 0;
    BS5_ATTR_RE.lastIndex = 0;
    const hasBs4 = BS4_ATTR_RE.test(f.content);
    const hasBs5 = BS5_ATTR_RE.test(f.content);

    if (hasBs4 && hasBs5) {
      violations.push({
        file: f.path,
        issue: "Mixed Bootstrap 4 and Bootstrap 5 data-attributes in the same file",
        severity: "critical",
        pattern: "data-toggle + data-bs-toggle",
        autoFixable: true,
      });
    } else if (targetMajor >= 5 && hasBs4 && !hasBs5) {
      violations.push({
        file: f.path,
        issue: `File still uses Bootstrap 4 data-* attributes but target is Bootstrap ${targetMajor}`,
        severity: "critical",
        pattern: "data-toggle (should be data-bs-toggle)",
        autoFixable: true,
      });
    } else if (targetMajor < 5 && hasBs5 && !hasBs4) {
      violations.push({
        file: f.path,
        issue: `File uses Bootstrap 5 data-bs-* attributes but target is Bootstrap ${targetMajor}`,
        severity: "critical",
        pattern: "data-bs-toggle (should be data-toggle)",
        autoFixable: true,
      });
    }
  }

  return violations;
}

function checkCdnVersionConsistency(
  files: ModifiedFile[],
  selections: VersionSelection[],
): ConsistencyViolation[] {
  const violations: ConsistencyViolation[] = [];

  for (const f of files) {
    if (!VIEW_EXTENSIONS.has(ext(f.path))) continue;

    const cdnRefs = extractCdnVersions(f.content);
    for (const ref of cdnRefs) {
      const matchSel = selections.find(
        s => s.package.toLowerCase().includes(ref.library.toLowerCase()),
      );
      if (!matchSel) continue;

      const targetMajor = parseInt(matchSel.selectedVersion.split(".")[0], 10);
      const cdnMajor = parseInt(ref.version.split(".")[0], 10);

      if (!isNaN(targetMajor) && !isNaN(cdnMajor) && cdnMajor !== targetMajor) {
        violations.push({
          file: f.path,
          issue: `CDN reference to ${ref.library}@${ref.version} does not match target ${matchSel.selectedVersion}`,
          severity: "critical",
          pattern: ref.fullUrl,
          autoFixable: true,
        });
      }
    }
  }

  return violations;
}

function checkManifestVersionConsistency(
  files: ModifiedFile[],
  selections: VersionSelection[],
): ConsistencyViolation[] {
  const violations: ConsistencyViolation[] = [];

  for (const f of files) {
    const baseName = f.path.split(/[/\\]/).pop()?.toLowerCase() ?? "";
    const lowerPath = f.path.toLowerCase();

    // .csproj TargetFramework check
    if (baseName.endsWith(".csproj") || baseName.endsWith(".fsproj") || baseName.endsWith(".vbproj")) {
      const tfmMatch = f.content.match(/<TargetFramework>(net[\d.]+)<\/TargetFramework>/i);
      if (tfmMatch) {
        const dotnetSel = selections.find(s => {
          const pkg = s.package.toLowerCase();
          return pkg.includes(".net") || pkg.includes("dotnet") || pkg.includes("asp.net");
        });
        if (dotnetSel) {
          const major = parseInt(dotnetSel.selectedVersion.split(".")[0], 10);
          const targetTfm = major >= 5 ? `net${major}.0` : `net${dotnetSel.selectedVersion}`;
          if (tfmMatch[1] !== targetTfm) {
            violations.push({
              file: f.path,
              issue: `TargetFramework is ${tfmMatch[1]} but target is ${targetTfm}`,
              severity: "critical",
              pattern: tfmMatch[0],
              autoFixable: true,
            });
          }
        }
      }

      // NuGet PackageReference version check
      for (const sel of selections) {
        if (sel.category === "framework") continue;
        const escapedPkg = sel.package.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const pkgRefRegex = new RegExp(`<PackageReference\\s+Include="${escapedPkg}"\\s+Version="([^"]+)"`, "i");
        const pkgMatch = f.content.match(pkgRefRegex);
        if (pkgMatch) {
          const currentVer = pkgMatch[1];
          const targetVer = sel.selectedVersion.replace(/^v/i, "").trim();
          if (currentVer !== targetVer) {
            violations.push({
              file: f.path,
              issue: `NuGet ${sel.package} is version ${currentVer} but target is ${targetVer}`,
              severity: "critical",
              pattern: pkgMatch[0],
              autoFixable: true,
            });
          }
        }
      }
    }

    // package.json version check (exact version, not just major)
    if (baseName === "package.json") {
      try {
        const pkg = JSON.parse(f.content);
        const allDeps = { ...pkg.dependencies, ...pkg.devDependencies, ...pkg.peerDependencies };
        for (const sel of selections) {
          const normPkg = sel.package.toLowerCase().replace(/[-_.@\s/]/g, "");
          for (const [depName, depVersion] of Object.entries(allDeps)) {
            const normDep = depName.toLowerCase().replace(/[-_.@\s/]/g, "");
            if (normDep !== normPkg && !normDep.includes(normPkg) && !normPkg.includes(normDep)) continue;
            const cleanVer = String(depVersion).replace(/^[\^~>=<\s]+/, "");
            const targetVer = sel.selectedVersion.replace(/^v/i, "").trim();
            if (cleanVer !== targetVer) {
              violations.push({
                file: f.path,
                issue: `package.json has ${depName}@${depVersion} but target is ${targetVer}`,
                severity: "critical",
                autoFixable: true,
              });
            }
          }
        }
      } catch { /* not valid JSON */ }
    }

    // pom.xml dependency version check
    if (baseName === "pom.xml") {
      for (const sel of selections) {
        const pkg = sel.package.toLowerCase();
        if (pkg.includes("java") || pkg === "jdk" || pkg === "openjdk") {
          const javaVerMatch = f.content.match(/<java\.version>(\d+)<\/java\.version>/);
          if (javaVerMatch) {
            const targetMajor = sel.selectedVersion.split(".")[0];
            if (javaVerMatch[1] !== targetMajor) {
              violations.push({
                file: f.path,
                issue: `java.version is ${javaVerMatch[1]} but target is ${targetMajor}`,
                severity: "critical",
                autoFixable: true,
              });
            }
          }
        }
        // Check artifact versions
        const escapedPkg = sel.package.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const depRegex = new RegExp(
          `<dependency>[\\s\\S]*?<artifactId>\\s*${escapedPkg}\\s*</artifactId>[\\s\\S]*?<version>([^<]+)</version>`,
          "i"
        );
        const depMatch = f.content.match(depRegex);
        if (depMatch) {
          const targetVer = sel.selectedVersion.replace(/^v/i, "").trim();
          if (depMatch[1].trim() !== targetVer) {
            violations.push({
              file: f.path,
              issue: `pom.xml has ${sel.package}@${depMatch[1].trim()} but target is ${targetVer}`,
              severity: "critical",
              autoFixable: true,
            });
          }
        }
      }
    }

    // requirements.txt version check
    if (lowerPath.match(/requirements.*\.txt$/)) {
      for (const sel of selections) {
        const escapedPkg = sel.package.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const pipRegex = new RegExp(`^${escapedPkg}\\s*==\\s*([\\d][\\w.\\-]*)`, "mi");
        const pipMatch = f.content.match(pipRegex);
        if (pipMatch) {
          const targetVer = sel.selectedVersion.replace(/^v/i, "").trim();
          if (pipMatch[1] !== targetVer) {
            violations.push({
              file: f.path,
              issue: `${sel.package}==${pipMatch[1]} but target is ${targetVer}`,
              severity: "critical",
              autoFixable: true,
            });
          }
        }
      }
    }

    // Gemfile version check
    if (baseName === "gemfile") {
      for (const sel of selections) {
        const escapedPkg = sel.package.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const gemRegex = new RegExp(`gem\\s+['"]${escapedPkg}['"]\\s*,\\s*['"][~>=<]*\\s*([\\d][\\w.\\-]*)`, "i");
        const gemMatch = f.content.match(gemRegex);
        if (gemMatch) {
          const targetVer = sel.selectedVersion.replace(/^v/i, "").trim();
          if (gemMatch[1] !== targetVer) {
            violations.push({
              file: f.path,
              issue: `Gemfile has ${sel.package}@${gemMatch[1]} but target is ${targetVer}`,
              severity: "critical",
              autoFixable: true,
            });
          }
        }
      }
    }

    // composer.json version check
    if (baseName === "composer.json") {
      try {
        const parsed = JSON.parse(f.content);
        for (const section of ["require", "require-dev"]) {
          if (!parsed[section]) continue;
          for (const sel of selections) {
            const normPkg = sel.package.toLowerCase().replace(/[-_.@\s]/g, "");
            for (const [depName, depVersion] of Object.entries(parsed[section])) {
              const normDep = depName.toLowerCase().replace(/[-_.@\s/]/g, "");
              if (normDep !== normPkg && !normDep.includes(normPkg) && !normPkg.includes(normDep)) continue;
              const cleanVer = String(depVersion).replace(/^[\^~>=<\s]+/, "");
              const targetVer = sel.selectedVersion.replace(/^v/i, "").trim();
              if (cleanVer !== targetVer) {
                violations.push({
                  file: f.path,
                  issue: `composer.json has ${depName}@${depVersion} but target is ${targetVer}`,
                  severity: "critical",
                  autoFixable: true,
                });
              }
            }
          }
        }
      } catch { /* not valid JSON */ }
    }

    // libman.json version check
    if (baseName === "libman.json") {
      try {
        const parsed = JSON.parse(f.content);
        if (Array.isArray(parsed.libraries)) {
          for (const lib of parsed.libraries) {
            if (!lib.library || typeof lib.library !== "string") continue;
            const atIdx = lib.library.lastIndexOf("@");
            if (atIdx <= 0) continue;
            const libName = lib.library.slice(0, atIdx);
            const currentVer = lib.library.slice(atIdx + 1);
            const normLib = libName.toLowerCase().replace(/[-_.@\s/]/g, "");
            for (const sel of selections) {
              const normPkg = sel.package.toLowerCase().replace(/[-_.@\s/]/g, "");
              if (normLib !== normPkg && !normLib.includes(normPkg) && !normPkg.includes(normLib)) continue;
              const targetVer = sel.selectedVersion.replace(/^v/i, "").trim();
              if (currentVer !== targetVer) {
                violations.push({
                  file: f.path,
                  issue: `libman.json has ${libName}@${currentVer} but target is ${targetVer}`,
                  severity: "critical",
                  autoFixable: true,
                });
              }
            }
          }
        }
      } catch { /* not valid JSON */ }
    }

    // bower.json version check
    if (baseName === "bower.json") {
      try {
        const parsed = JSON.parse(f.content);
        for (const section of ["dependencies", "devDependencies"]) {
          if (!parsed[section]) continue;
          for (const sel of selections) {
            const normPkg = sel.package.toLowerCase().replace(/[-_.@\s/]/g, "");
            for (const [depName, depVersion] of Object.entries(parsed[section])) {
              const normDep = depName.toLowerCase().replace(/[-_.@\s/]/g, "");
              if (normDep !== normPkg && !normDep.includes(normPkg) && !normPkg.includes(normDep)) continue;
              const cleanVer = String(depVersion).replace(/^[\^~>=<\s]+/, "");
              const targetVer = sel.selectedVersion.replace(/^v/i, "").trim();
              if (cleanVer !== targetVer) {
                violations.push({
                  file: f.path,
                  issue: `bower.json has ${depName}@${depVersion} but target is ${targetVer}`,
                  severity: "critical",
                  autoFixable: true,
                });
              }
            }
          }
        }
      } catch { /* not valid JSON */ }
    }

    // build.gradle dependency version check
    if (baseName === "build.gradle" || baseName === "build.gradle.kts") {
      for (const sel of selections) {
        const pkg = sel.package.toLowerCase();
        if (pkg.includes("java") || pkg === "jdk" || pkg === "openjdk") {
          const srcCompat = f.content.match(/sourceCompatibility\s*=\s*['"]?(\d+)['"]?/);
          if (srcCompat) {
            const targetMajor = sel.selectedVersion.split(".")[0];
            if (srcCompat[1] !== targetMajor) {
              violations.push({
                file: f.path,
                issue: `sourceCompatibility is ${srcCompat[1]} but target Java version is ${targetMajor}`,
                severity: "critical",
                autoFixable: true,
              });
            }
          }
        }
      }
    }

    // go.mod version check
    if (baseName === "go.mod") {
      const goSel = selections.find(s => s.package.toLowerCase() === "go");
      if (goSel) {
        const goVerMatch = f.content.match(/^go\s+(\d+\.\d+(?:\.\d+)?)/m);
        if (goVerMatch) {
          const targetVer = goSel.selectedVersion.replace(/^v/i, "").trim();
          if (goVerMatch[1] !== targetVer) {
            violations.push({
              file: f.path,
              issue: `go.mod specifies Go ${goVerMatch[1]} but target is ${targetVer}`,
              severity: "critical",
              autoFixable: true,
            });
          }
        }
      }
    }
  }

  return violations;
}

// ── Auto-fix ────────────────────────────────────────────────────

function autoFixViolations(
  files: ModifiedFile[],
  violations: ConsistencyViolation[],
  selections: VersionSelection[],
  rules: TransformRule[],
): { fixedFiles: ModifiedFile[]; fixedCount: number } {
  const violatedPaths = new Set(violations.filter(v => v.autoFixable).map(v => v.file));
  if (violatedPaths.size === 0) return { fixedFiles: files, fixedCount: 0 };

  let fixedCount = 0;
  const activeStacks = detectActiveStacks(selections);
  const applicableRules = getApplicableRules(activeStacks, rules, selections);

  const fixedFiles = files.map(f => {
    if (!violatedPaths.has(f.path)) return f;

    let content = f.content;

    // Apply deterministic transform rules
    if (applicableRules.length > 0) {
      const result = applyTransforms(f.path, content, applicableRules);
      if (result.totalChanges > 0) {
        content = result.transformedContent;
        fixedCount += result.totalChanges;
      }
    }

    // Fix CDN versions
    const cdnResult = updateCdnVersions(content, selections);
    if (cdnResult.changes.length > 0) {
      content = cdnResult.content;
      fixedCount += cdnResult.changes.length;
    }

    if (content !== f.content) {
      return { ...f, content };
    }
    return f;
  });

  return { fixedFiles, fixedCount };
}

// ── Public API ──────────────────────────────────────────────────

export async function executeConsistencyValidator(
  state: StackModernizationState,
): Promise<StackModernizationState> {
  const modifiedFiles = state.modifiedFiles ?? [];
  const selections = state.userSelections ?? [];

  if (modifiedFiles.length === 0 || selections.length === 0) {
    return {
      ...state,
      consistencyReport: {
        totalChecked: 0,
        passed: 0,
        autoFixed: 0,
        llmFixPassFiles: 0,
        violations: [],
      },
    };
  }

  const allViolations: ConsistencyViolation[] = [
    ...checkBootstrapConsistency(modifiedFiles, selections),
    ...checkCdnVersionConsistency(modifiedFiles, selections),
    ...checkManifestVersionConsistency(modifiedFiles, selections),
  ];

  const rules = state.deterministicRules ?? [];

  const { fixedFiles, fixedCount } = autoFixViolations(
    modifiedFiles,
    allViolations,
    selections,
    rules,
  );

  // Final sweep: enforce CDN versions on ALL modified files, not just
  // those with detected violations. This catches CDN refs the violation
  // checks missed (e.g., libraries without explicit CDN pattern detectors).
  let cdnSweepFixes = 0;
  const sweptFiles = fixedFiles.map(f => {
    const cdnResult = updateCdnVersions(f.content, selections);
    if (cdnResult.changes.length > 0) {
      cdnSweepFixes += cdnResult.changes.length;
      return { ...f, content: cdnResult.content };
    }
    return f;
  });

  if (cdnSweepFixes > 0) {
    console.log(`[ConsistencyValidator] CDN sweep: ${cdnSweepFixes} additional version fixes applied`);
  }

  const remainingViolations = allViolations.filter(v => !v.autoFixable);

  const report: ConsistencyReport = {
    totalChecked: modifiedFiles.length,
    passed: modifiedFiles.length - new Set(allViolations.map(v => v.file)).size,
    autoFixed: fixedCount,
    llmFixPassFiles: new Set(remainingViolations.map(v => v.file)).size,
    violations: remainingViolations,
  };

  console.log(
    `[ConsistencyValidator] Checked ${report.totalChecked} files: ` +
    `${report.passed} clean, ${fixedCount} auto-fixed, ` +
    `${report.llmFixPassFiles} need manual review. ` +
    `${allViolations.length} total violations found.`,
  );

  return {
    ...state,
    modifiedFiles: sweptFiles,
    consistencyReport: report,
  };
}
