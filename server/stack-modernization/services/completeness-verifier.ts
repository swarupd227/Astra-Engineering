/**
 * Completeness Verifier Service
 *
 * GAP 10 fix — Runs at the END of the code upgrade pipeline to verify
 * that ALL upgrade targets were actually addressed. This catches cases where:
 *   - A .csproj still references the old TFM
 *   - A CDN URL still has the old version
 *   - A vendor file was not upgraded
 *   - An obsolete package was not removed
 *   - A new library was not wired into the layout
 *   - Breaking API patterns still exist in modified files
 *
 * Returns a structured verification report with pass/fail per check.
 */

import type { VersionSelection, ExtractedFile, ModifiedFile, VendorLibrary } from "../types";

// ═══════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════

export interface VerificationCheck {
  id: string;
  category: "tfm" | "nuget" | "vendor" | "cdn" | "api" | "layout" | "obsolete" | "structural";
  description: string;
  passed: boolean;
  details?: string;
  severity: "error" | "warning" | "info";
}

export interface CompletenessReport {
  totalChecks: number;
  passed: number;
  failed: number;
  warnings: number;
  checks: VerificationCheck[];
  overallScore: number; // 0-100
  markdown: string;
}

// ═══════════════════════════════════════════════════════════════
// Main verification function
// ═══════════════════════════════════════════════════════════════

export function verifyUpgradeCompleteness(
  modifiedFiles: ModifiedFile[],
  extractedFiles: ExtractedFile[],
  selections: VersionSelection[],
  vendorLibraries?: VendorLibrary[],
  apiUsageReport?: any,
  vendorDownloadResults?: { downloaded?: Array<{ library: string; version: string; destination: string; type?: string }> },
): CompletenessReport {
  const checks: VerificationCheck[] = [];

  // Build lookup of final file contents (modified takes precedence over extracted)
  const finalFiles = new Map<string, string>();
  for (const f of extractedFiles) {
    finalFiles.set(f.relativePath.replace(/\\/g, "/").toLowerCase(), f.content);
  }
  for (const f of modifiedFiles) {
    finalFiles.set(f.path.replace(/\\/g, "/").toLowerCase(), f.content);
  }

  // ── Check 1: Target Framework Moniker (TFM) in .csproj files ──
  const dotnetSel = selections.find(s =>
    s.package.toLowerCase().includes(".net") || s.package.toLowerCase().includes("dotnet")
  );
  if (dotnetSel) {
    const targetTfm = `net${dotnetSel.selectedVersion.replace(/\.0$/, "")}.0`;
    for (const [path, content] of finalFiles) {
      if (!path.endsWith(".csproj")) continue;
      const tfmMatch = content.match(/<TargetFramework>([^<]+)<\/TargetFramework>/);
      if (tfmMatch) {
        const currentTfm = tfmMatch[1];
        const passed = currentTfm === targetTfm;
        checks.push({
          id: `tfm-${path}`,
          category: "tfm",
          description: `${path}: TargetFramework should be ${targetTfm}`,
          passed,
          details: passed ? undefined : `Still set to ${currentTfm}`,
          severity: passed ? "info" : "error",
        });
      }
    }
  }

  // ── Check 2: NuGet package versions in .csproj ──
  for (const sel of selections) {
    if (sel.category !== "library" && sel.category !== "framework") continue;
    for (const [path, content] of finalFiles) {
      if (!path.endsWith(".csproj")) continue;
      const escapedPkg = sel.package.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const pkgRefRegex = new RegExp(`<PackageReference\\s+Include="${escapedPkg}"\\s+Version="([^"]+)"`, "i");
      const match = content.match(pkgRefRegex);
      if (match) {
        const currentVer = match[1];
        const passed = currentVer === sel.selectedVersion;
        checks.push({
          id: `nuget-${sel.package}-${path}`,
          category: "nuget",
          description: `${path}: ${sel.package} should be version ${sel.selectedVersion}`,
          passed,
          details: passed ? undefined : `Still at version ${currentVer}`,
          severity: passed ? "info" : "error",
        });
      }
    }
  }

  // ── Check 3: Vendor library versions ──
  if (vendorLibraries && vendorLibraries.length > 0) {
    const selMap = new Map<string, string>();
    for (const s of selections) selMap.set(s.package.toLowerCase(), s.selectedVersion);

    for (const vendor of vendorLibraries) {
      const target = selMap.get(vendor.name.toLowerCase());
      if (!target) continue;
      // Check if the vendor file in modifiedFiles contains the target version
      const vendorFile = modifiedFiles.find(m =>
        vendor.existingFiles.some(ef => m.path.replace(/\\/g, "/") === ef)
      );
      const passed = !!vendorFile;
      checks.push({
        id: `vendor-${vendor.name}`,
        category: "vendor",
        description: `Vendor library ${vendor.name} should be upgraded to ${target}`,
        passed,
        details: passed ? undefined : `No modified file found for ${vendor.name} vendor files`,
        severity: passed ? "info" : "warning",
      });
    }
  }

  // ── Check 4: CDN URL versions in view files (all CDN hosts) ──
  const viewExtensions = [".cshtml", ".html", ".htm", ".razor", ".aspx", ".vue", ".jsx", ".tsx", ".master"];
  let extractCdnVersionsFn: typeof import("./deterministic-transforms").extractCdnVersions | null = null;
  try {
    const dt = require("./deterministic-transforms");
    extractCdnVersionsFn = dt.extractCdnVersions;
  } catch { /* fallback below */ }

  for (const [path, content] of finalFiles) {
    if (!viewExtensions.some(ext => path.endsWith(ext))) continue;

    const cdnRefs = extractCdnVersionsFn ? extractCdnVersionsFn(content) : [];
    for (const ref of cdnRefs) {
      const normLib = ref.library.toLowerCase().replace(/[-_.@\s/]/g, "");
      let matched = false;
      for (const sel of selections) {
        const normPkg = sel.package.toLowerCase().replace(/[-_.@\s/]/g, "");
        if (normLib === normPkg || normLib.includes(normPkg) || normPkg.includes(normLib)) {
          if (ref.version !== sel.selectedVersion) {
            checks.push({
              id: `cdn-${ref.library}-${ref.version}-${path}`,
              category: "cdn",
              description: `${path}: CDN reference to ${ref.library} (${ref.provider}) should use version ${sel.selectedVersion}`,
              passed: false,
              details: `Still referencing version ${ref.version} via ${ref.provider}`,
              severity: "error",
            });
          } else {
            checks.push({
              id: `cdn-${ref.library}-${ref.version}-${path}`,
              category: "cdn",
              description: `${path}: CDN reference to ${ref.library} at target version ${sel.selectedVersion}`,
              passed: true,
              severity: "info",
            });
          }
          matched = true;
          break;
        }
      }
      if (!matched && ref.version) {
        // CDN lib not in selections — just note it
        checks.push({
          id: `cdn-unselected-${ref.library}-${path}`,
          category: "cdn",
          description: `${path}: CDN reference to ${ref.library} v${ref.version} (no upgrade selection)`,
          passed: true,
          severity: "info",
        });
      }
    }
  }

  // ── Check 4b: package.json dependency version check (exact match) ──
  for (const [path, content] of finalFiles) {
    if (!path.endsWith("package.json")) continue;
    try {
      const pkg = JSON.parse(content);
      const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
      for (const sel of selections) {
        const normPkg = sel.package.toLowerCase().replace(/[-_.@\s/]/g, "");
        for (const [depName, depVersion] of Object.entries(allDeps)) {
          const normDep = depName.toLowerCase().replace(/[-_.@\s/]/g, "");
          if (normDep !== normPkg && !normDep.includes(normPkg) && !normPkg.includes(normDep)) continue;
          const cleanVer = String(depVersion).replace(/^[\^~>=<\s]+/, "");
          const targetVer = sel.selectedVersion.replace(/^v/i, "").trim();
          const passed = cleanVer === targetVer;
          checks.push({
            id: `npm-${depName}-${path}`,
            category: "vendor",
            description: `${path}: ${depName} should be version ${targetVer}`,
            passed,
            details: passed ? undefined : `Currently at ${depVersion}`,
            severity: passed ? "info" : "error",
          });
        }
      }
    } catch { /* not valid JSON */ }
  }

  // ── Check 4c: libman.json version check ──
  for (const [path, content] of finalFiles) {
    if (!path.endsWith("libman.json")) continue;
    try {
      const parsed = JSON.parse(content);
      if (!Array.isArray(parsed.libraries)) continue;
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
          const passed = currentVer === targetVer;
          checks.push({
            id: `libman-${libName}-${path}`,
            category: "vendor",
            description: `${path}: ${libName} should be version ${targetVer}`,
            passed,
            details: passed ? undefined : `Currently at ${currentVer}`,
            severity: passed ? "info" : "error",
          });
        }
      }
    } catch { /* not valid JSON */ }
  }

  // ── Check 4d: pom.xml dependency version check ──
  for (const [path, content] of finalFiles) {
    if (!path.endsWith("pom.xml")) continue;
    for (const sel of selections) {
      const escapedPkg = sel.package.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const depRegex = new RegExp(
        `<dependency>[\\s\\S]*?<artifactId>\\s*${escapedPkg}\\s*</artifactId>[\\s\\S]*?<version>([^<]+)</version>`,
        "i"
      );
      const depMatch = content.match(depRegex);
      if (depMatch) {
        const currentVer = depMatch[1].trim();
        const targetVer = sel.selectedVersion.replace(/^v/i, "").trim();
        const passed = currentVer === targetVer;
        checks.push({
          id: `maven-${sel.package}-${path}`,
          category: "vendor",
          description: `${path}: ${sel.package} should be version ${targetVer}`,
          passed,
          details: passed ? undefined : `Currently at ${currentVer}`,
          severity: passed ? "info" : "error",
        });
      }
    }
  }

  // ── Check 4e: requirements.txt version check ──
  for (const [path, content] of finalFiles) {
    if (!path.match(/requirements.*\.txt$/)) continue;
    for (const sel of selections) {
      const escapedPkg = sel.package.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const pipRegex = new RegExp(`^${escapedPkg}\\s*==\\s*([\\d][\\w.\\-]*)`, "mi");
      const pipMatch = content.match(pipRegex);
      if (pipMatch) {
        const targetVer = sel.selectedVersion.replace(/^v/i, "").trim();
        const passed = pipMatch[1] === targetVer;
        checks.push({
          id: `pip-${sel.package}-${path}`,
          category: "vendor",
          description: `${path}: ${sel.package} should be version ${targetVer}`,
          passed,
          details: passed ? undefined : `Currently at ${pipMatch[1]}`,
          severity: passed ? "info" : "error",
        });
      }
    }
  }

  // ── Check 4f: Gemfile version check ──
  for (const [path, content] of finalFiles) {
    if (!path.endsWith("gemfile")) continue;
    for (const sel of selections) {
      const escapedPkg = sel.package.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const gemRegex = new RegExp(`gem\\s+['"]${escapedPkg}['"]\\s*,\\s*['"][~>=<]*\\s*([\\d][\\w.\\-]*)`, "i");
      const gemMatch = content.match(gemRegex);
      if (gemMatch) {
        const targetVer = sel.selectedVersion.replace(/^v/i, "").trim();
        const passed = gemMatch[1] === targetVer;
        checks.push({
          id: `gem-${sel.package}-${path}`,
          category: "vendor",
          description: `${path}: ${sel.package} should be version ${targetVer}`,
          passed,
          details: passed ? undefined : `Currently at ${gemMatch[1]}`,
          severity: passed ? "info" : "error",
        });
      }
    }
  }

  // ── Check 4g: composer.json version check ──
  for (const [path, content] of finalFiles) {
    if (!path.endsWith("composer.json")) continue;
    try {
      const parsed = JSON.parse(content);
      for (const section of ["require", "require-dev"]) {
        if (!parsed[section]) continue;
        for (const sel of selections) {
          const normPkg = sel.package.toLowerCase().replace(/[-_.@\s]/g, "");
          for (const [depName, depVersion] of Object.entries(parsed[section])) {
            const normDep = depName.toLowerCase().replace(/[-_.@\s/]/g, "");
            if (normDep !== normPkg && !normDep.includes(normPkg) && !normPkg.includes(normDep)) continue;
            const cleanVer = String(depVersion).replace(/^[\^~>=<\s]+/, "");
            const targetVer = sel.selectedVersion.replace(/^v/i, "").trim();
            const passed = cleanVer === targetVer;
            checks.push({
              id: `composer-${depName}-${path}`,
              category: "vendor",
              description: `${path}: ${depName} should be version ${targetVer}`,
              passed,
              details: passed ? undefined : `Currently at ${depVersion}`,
              severity: passed ? "info" : "error",
            });
          }
        }
      }
    } catch { /* not valid JSON */ }
  }

  // ── Check 4h: bower.json version check ──
  for (const [path, content] of finalFiles) {
    if (!path.endsWith("bower.json")) continue;
    try {
      const parsed = JSON.parse(content);
      for (const section of ["dependencies", "devDependencies"]) {
        if (!parsed[section]) continue;
        for (const sel of selections) {
          const normPkg = sel.package.toLowerCase().replace(/[-_.@\s/]/g, "");
          for (const [depName, depVersion] of Object.entries(parsed[section])) {
            const normDep = depName.toLowerCase().replace(/[-_.@\s/]/g, "");
            if (normDep !== normPkg && !normDep.includes(normPkg) && !normPkg.includes(normDep)) continue;
            const cleanVer = String(depVersion).replace(/^[\^~>=<\s]+/, "");
            const targetVer = sel.selectedVersion.replace(/^v/i, "").trim();
            const passed = cleanVer === targetVer;
            checks.push({
              id: `bower-${depName}-${path}`,
              category: "vendor",
              description: `${path}: ${depName} should be version ${targetVer}`,
              passed,
              details: passed ? undefined : `Currently at ${depVersion}`,
              severity: passed ? "info" : "error",
            });
          }
        }
      }
    } catch { /* not valid JSON */ }
  }

  // ── Check 5 (GAP 12): SRI hash integrity attributes should be stripped after CDN version change ──
  for (const [path, content] of finalFiles) {
    if (!viewExtensions.some(ext => path.endsWith(ext))) continue;
    // Look for integrity attributes on script/link tags
    const sriRegex = /integrity="sha\d+-[A-Za-z0-9+/=]+"/g;
    let sriMatch: RegExpExecArray | null;
    while ((sriMatch = sriRegex.exec(content)) !== null) {
      // Check if this file was modified (CDN version was changed)
      const wasModified = modifiedFiles.some(m => m.path.replace(/\\/g, "/").toLowerCase() === path);
      if (wasModified) {
        checks.push({
          id: `sri-stale-${path}`,
          category: "cdn",
          description: `${path}: SRI integrity hash may be stale after CDN version update`,
          passed: false,
          details: `Found integrity attribute that may not match updated CDN version. Remove or regenerate.`,
          severity: "warning",
        });
        break; // One warning per file is enough
      }
    }
  }

  // ── Check 6: Breaking API patterns still present ──
  if (apiUsageReport?.items) {
    const itemsByFile = new Map<string, number>();
    for (const item of apiUsageReport.items) {
      const filePath = item.file.replace(/\\/g, "/").toLowerCase();
      // Check if this file was modified
      const wasModified = modifiedFiles.some(m => m.path.replace(/\\/g, "/").toLowerCase() === filePath);
      if (!wasModified) {
        itemsByFile.set(filePath, (itemsByFile.get(filePath) ?? 0) + 1);
      }
    }
    for (const [file, count] of itemsByFile) {
      checks.push({
        id: `api-unmodified-${file}`,
        category: "api",
        description: `${file} has ${count} breaking API patterns but was not modified`,
        passed: false,
        details: `File needs manual review for deprecated API usage`,
        severity: "warning",
      });
    }
  }

  // ── Check 7: Structural requirements for major version jumps ──
  // .NET 6+ structural checks
  if (dotnetSel) {
    const targetMajor = parseInt((dotnetSel.selectedVersion || "").replace(/\..*/, ""), 10) || 0;
    if (targetMajor >= 6) {
      // Check: appsettings.json should exist
      const hasAppSettings = finalFiles.has("appsettings.json") ||
        [...finalFiles.keys()].some(k => k.endsWith("/appsettings.json"));
      checks.push({
        id: "structural-appsettings",
        category: "structural",
        description: "appsettings.json should exist for .NET 6+ projects",
        passed: hasAppSettings,
        details: hasAppSettings ? undefined : "No appsettings.json found — required for .NET 6+ configuration",
        severity: hasAppSettings ? "info" : "warning",
      });

      // Check: Global.asax should NOT exist (obsolete in .NET Core)
      const hasGlobalAsax = [...finalFiles.keys()].some(k => k.endsWith("global.asax") || k.endsWith("global.asax.cs"));
      if (hasGlobalAsax) {
        // Check if it's been flagged for deletion (in modifiedFiles with empty content or not)
        checks.push({
          id: "structural-global-asax",
          category: "structural",
          description: "Global.asax is obsolete in .NET 6+ — should be removed or migrated to Program.cs",
          passed: false,
          details: "Global.asax found in project — startup logic should be in Program.cs for .NET 6+",
          severity: "warning",
        });
      }

      // Check: Program.cs should exist
      const hasProgramCs = [...finalFiles.keys()].some(k => k.endsWith("program.cs"));
      checks.push({
        id: "structural-program-cs",
        category: "structural",
        description: "Program.cs should exist as the entry point for .NET 6+ projects",
        passed: hasProgramCs,
        details: hasProgramCs ? undefined : "No Program.cs found — .NET 6+ requires a top-level entry point",
        severity: hasProgramCs ? "info" : "warning",
      });
    }
  }

  // Java/Spring structural checks
  const javaSel = selections.find(s => {
    const pkg = (s.package || "").toLowerCase();
    return pkg.includes("java") || pkg.includes("spring") || pkg.includes("jakarta");
  });
  if (javaSel) {
    const targetVer = parseFloat(javaSel.selectedVersion || "0");
    // Spring Boot 3+ requires jakarta namespace
    if (javaSel.package.toLowerCase().includes("spring") && targetVer >= 3) {
      const hasJavaxImports = [...finalFiles.entries()].some(([path, content]) =>
        path.endsWith(".java") && content.includes("import javax.") && !content.includes("import javax.crypto")
      );
      if (hasJavaxImports) {
        checks.push({
          id: "structural-javax-jakarta",
          category: "structural",
          description: "javax.* imports should be migrated to jakarta.* for Spring Boot 3+",
          passed: false,
          details: "Found javax.* imports in Java files — Spring Boot 3+ requires jakarta.* namespace",
          severity: "error",
        });
      }
    }
  }

  // Python/Django structural checks
  const pythonSel = selections.find(s => {
    const pkg = (s.package || "").toLowerCase();
    return pkg.includes("django");
  });
  if (pythonSel) {
    const targetVer = parseFloat(pythonSel.selectedVersion || "0");
    if (targetVer >= 3.2) {
      // Check DEFAULT_AUTO_FIELD in settings.py
      const settingsFiles = [...finalFiles.entries()].filter(([k]) => k.endsWith("settings.py"));
      for (const [path, content] of settingsFiles) {
        const hasDefaultAutoField = content.includes("DEFAULT_AUTO_FIELD");
        checks.push({
          id: `structural-django-autofield-${path}`,
          category: "structural",
          description: `${path}: DEFAULT_AUTO_FIELD should be set for Django 3.2+`,
          passed: hasDefaultAutoField,
          details: hasDefaultAutoField ? undefined : "Missing DEFAULT_AUTO_FIELD — required since Django 3.2",
          severity: hasDefaultAutoField ? "info" : "warning",
        });
      }
    }
  }

  // ── React 17→18 checks ──
  const reactSel = selections.find(s => {
    const pkg = (s.package || "").toLowerCase();
    return pkg === "react" || pkg === "react-dom";
  });
  if (reactSel) {
    const targetMajor = parseInt((reactSel.selectedVersion || "").split(".")[0], 10);
    if (targetMajor >= 18) {
      // Check that ReactDOM.render() is not used (should be createRoot)
      const jsxFiles = [...finalFiles.entries()].filter(([k]) => /\.(tsx|jsx|ts|js)$/i.test(k));
      for (const [filePath, content] of jsxFiles) {
        if (/ReactDOM\.render\s*\(/.test(content)) {
          checks.push({
            id: `react18-render-${filePath}`,
            category: "api",
            description: `${filePath}: ReactDOM.render() still used — must migrate to createRoot() for React 18`,
            passed: false,
            details: "ReactDOM.render() is deprecated in React 18. Use createRoot() from 'react-dom/client'.",
            severity: "error",
          });
        }
      }
      // Check that import is from react-dom/client (not react-dom)
      const entryFiles = [...finalFiles.entries()].filter(([k]) => /index\.(tsx|jsx|ts|js)$/i.test(k));
      for (const [filePath, content] of entryFiles) {
        if (/from\s+['"]react-dom['"]/.test(content) && /createRoot|render/.test(content)) {
          checks.push({
            id: `react18-import-${filePath}`,
            category: "api",
            description: `${filePath}: Should import from 'react-dom/client' (not 'react-dom') for React 18`,
            passed: false,
            details: "In React 18, createRoot is exported from 'react-dom/client', not 'react-dom'.",
            severity: "warning",
          });
        }
      }
    }
  }

  // ── React Router v5→v6 checks ──
  const routerSel = selections.find(s => {
    const pkg = (s.package || "").toLowerCase();
    return pkg.includes("react-router");
  });
  if (routerSel) {
    const targetMajor = parseInt((routerSel.selectedVersion || "").split(".")[0], 10);
    if (targetMajor >= 6) {
      const jsxFiles = [...finalFiles.entries()].filter(([k]) => /\.(tsx|jsx)$/i.test(k));
      for (const [filePath, content] of jsxFiles) {
        if (/<Switch>/.test(content)) {
          checks.push({
            id: `router6-switch-${filePath}`,
            category: "api",
            description: `${filePath}: <Switch> still used — must migrate to <Routes> for react-router-dom v6`,
            passed: false,
            details: "<Switch> was removed in react-router-dom v6. Replace with <Routes>.",
            severity: "error",
          });
        }
        if (/useHistory\b/.test(content)) {
          checks.push({
            id: `router6-history-${filePath}`,
            category: "api",
            description: `${filePath}: useHistory() still used — must migrate to useNavigate() for v6`,
            passed: false,
            details: "useHistory() was removed in react-router-dom v6. Replace with useNavigate().",
            severity: "error",
          });
        }
      }
    }
  }

  // ── Bootstrap 4→5 attribute checks ──
  const bsSel = selections.find(s => {
    const pkg = (s.package || "").toLowerCase();
    return pkg.includes("bootstrap") && !pkg.includes("datepicker");
  });
  if (bsSel) {
    const targetMajor = parseInt((bsSel.selectedVersion || "").split(".")[0], 10);
    if (targetMajor >= 5) {
      const viewFiles = [...finalFiles.entries()].filter(([k]) => /\.(cshtml|html|razor|htm|tsx|jsx)$/i.test(k));
      for (const [filePath, content] of viewFiles) {
        if (/data-toggle=/.test(content)) {
          checks.push({
            id: `bs5-data-toggle-${filePath}`,
            category: "vendor",
            description: `${filePath}: data-toggle still used — must be data-bs-toggle for Bootstrap 5`,
            passed: false,
            details: "Bootstrap 5 renamed data-toggle to data-bs-toggle.",
            severity: "error",
          });
        }
        if (/\bml-\d|\bmr-\d/.test(content)) {
          checks.push({
            id: `bs5-margin-${filePath}`,
            category: "vendor",
            description: `${filePath}: ml-*/mr-* classes still used — must be ms-*/me-* for Bootstrap 5`,
            passed: false,
            details: "Bootstrap 5 renamed ml-* to ms-* and mr-* to me-*.",
            severity: "warning",
          });
        }
      }
    }
  }

  // ── Font Awesome 4→6 checks ──
  const faSel = selections.find(s => {
    const pkg = (s.package || "").toLowerCase();
    return pkg.includes("font-awesome") || pkg.includes("fontawesome");
  });
  if (faSel) {
    const targetMajor = parseInt((faSel.selectedVersion || "").split(".")[0], 10);
    if (targetMajor >= 6) {
      const viewFiles = [...finalFiles.entries()].filter(([k]) => /\.(cshtml|html|razor|htm|tsx|jsx|css)$/i.test(k));
      for (const [filePath, content] of viewFiles) {
        if (/\bfa\s+fa-/.test(content)) {
          checks.push({
            id: `fa6-old-class-${filePath}`,
            category: "vendor",
            description: `${filePath}: "fa fa-*" class still used — must be "fa-solid fa-*" for Font Awesome 6`,
            passed: false,
            details: 'Font Awesome 6 requires "fa-solid", "fa-regular", or "fa-brands" prefix instead of "fa".',
            severity: "warning",
          });
        }
      }
    }
  }

  // Asset path verification: check that vendor asset references in view/template files
  // match actual vendor download destinations (prevents 404s for CSS/JS assets).
  // Works across all stacks — not limited to ~/lib/ patterns.
  const webRootPrefixes = /^(wwwroot|public|static|dist|resources\/static|web|htdocs)\/?/i;
  const vendorDirPattern = /(?:lib|vendor|assets|static|dist|bower_components|node_modules|packages)\//i;
  if (vendorDownloadResults?.downloaded && vendorDownloadResults.downloaded.length > 0) {
    const downloadedWebPaths = new Set(
      vendorDownloadResults.downloaded
        .map(d => (d.destination || "").replace(/\\/g, "/").replace(webRootPrefixes, "").toLowerCase())
        .filter(Boolean)
    );
    const downloadedFileNames = new Set(
      vendorDownloadResults.downloaded
        .map(d => ((d.destination || "").replace(/\\/g, "/").split("/").pop() || "").toLowerCase())
        .filter(Boolean)
    );

    const viewExts = /\.(cshtml|html|razor|htm|aspx|master|jsp|ejs|hbs|pug|erb|php|blade\.php|vue|tsx|jsx|svelte|astro|twig|njk)$/i;
    for (const [path, content] of finalFiles) {
      if (!viewExts.test(path)) continue;

      const assetRefPattern = /(?:href|src)\s*=\s*["']([^"']+\.(?:js|css))["']/gi;
      let match: RegExpExecArray | null;
      while ((match = assetRefPattern.exec(content)) !== null) {
        const rawRef = match[1];
        if (!vendorDirPattern.test(rawRef)) continue;

        const refPath = rawRef.replace(/\\/g, "/").replace(/^~?\/?/, "").replace(webRootPrefixes, "").toLowerCase();
        const fileName = refPath.split("/").pop() || "";
        if (!fileName) continue;

        // Skip files that aren't related to any downloaded vendor file
        if (!downloadedFileNames.has(fileName)) continue;

        const matchesDownload = downloadedWebPaths.has(refPath) ||
          Array.from(downloadedWebPaths).some(dp => dp.endsWith("/" + fileName));

        if (!matchesDownload) {
          const suggestions = Array.from(downloadedWebPaths).filter(dp => dp.endsWith("/" + fileName));
          checks.push({
            id: `layout-path-${path}-${fileName}`,
            category: "layout",
            description: `${path}: Asset reference "${rawRef}" may not match any downloaded vendor file`,
            passed: false,
            details: suggestions.length > 0
              ? `Correct path is likely: ${suggestions.join(" or ")}. Update the src/href attribute in this file.`
              : `No downloaded file named "${fileName}" was found. Verify the path exists or download the library manually.`,
            severity: "warning",
          });
        }
      }
    }
  }

  // Calculate summary
  const passed = checks.filter(c => c.passed).length;
  const failed = checks.filter(c => !c.passed && c.severity === "error").length;
  const warnings = checks.filter(c => !c.passed && c.severity === "warning").length;
  const overallScore = checks.length > 0 ? Math.round((passed / checks.length) * 100) : 100;

  // Build markdown report
  const mdLines: string[] = [
    "## Upgrade Completeness Verification",
    "",
    `**Score**: ${overallScore}% (${passed}/${checks.length} checks passed)`,
    "",
  ];

  if (failed > 0) {
    mdLines.push(`### ❌ Errors (${failed})`);
    for (const c of checks.filter(c => c.severity === "error" && !c.passed)) {
      mdLines.push(`- ${c.description}${c.details ? ` — ${c.details}` : ""}`);
    }
    mdLines.push("");
  }

  if (warnings > 0) {
    mdLines.push(`### ⚠️ Warnings (${warnings})`);
    for (const c of checks.filter(c => c.severity === "warning" && !c.passed)) {
      mdLines.push(`- ${c.description}${c.details ? ` — ${c.details}` : ""}`);
    }
    mdLines.push("");
  }

  const structuralIssues = checks.filter(c => c.category === "structural" && !c.passed);
  if (structuralIssues.length > 0) {
    mdLines.push(`### 🏗️ Structural Issues (${structuralIssues.length})`);
    for (const c of structuralIssues) {
      mdLines.push(`- ${c.description}${c.details ? ` — ${c.details}` : ""}`);
    }
    mdLines.push("");
  }

  if (passed > 0) {
    mdLines.push(`### ✅ Passed (${passed})`);
    for (const c of checks.filter(c => c.passed)) {
      mdLines.push(`- ${c.description}`);
    }
    mdLines.push("");
  }

  return {
    totalChecks: checks.length,
    passed,
    failed,
    warnings,
    checks,
    overallScore,
    markdown: mdLines.join("\n"),
  };
}
