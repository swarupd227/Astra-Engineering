/**
 * Pre-Upgrade Impact Analyzer
 * Cross-references AST usage map against migration breaking changes to generate
 * a targeted impact report BEFORE any code changes happen.
 */

import type { ASTAnalysis } from "./ast-parser";
import type { MigrationDocResult } from "./migration-doc-fetcher";

// ── Interfaces ──────────────────────────────────────────────────

export interface FileImpact {
  path: string;
  impacts: ImpactItem[];
  riskScore: number;
  hasEventBindings: boolean;
  hasNavigationLogic: boolean;
}

export interface ImpactItem {
  line: number;
  pattern: string;
  issue: string;
  fix: string;
  severity: "critical" | "high" | "medium" | "low";
  source: "migration-doc" | "deprecated-registry" | "pattern-match";
}

export interface DeprecatedPackage {
  package: string;
  reason: string;
  action: "remove" | "replace";
  replacement?: string;
}

export interface UpgradeImpactReport {
  deprecatedPackages: DeprecatedPackage[];
  affectedFiles: FileImpact[];
  riskScore: number;
  summary: string;
  totalImpacts: number;
  criticalCount: number;
  highCount: number;
}

// ── Known Deprecated Packages ───────────────────────────────────
// Packages that should be removed entirely during upgrades.

const DEPRECATED_PACKAGES: Record<string, DeprecatedPackage> = {
  "microsoft.visualstudio.web.browserlink": {
    package: "Microsoft.VisualStudio.Web.BrowserLink",
    reason: "Removed in .NET 8+",
    action: "remove",
  },
  "microsoft.aspnetcore.browserlink": {
    package: "Microsoft.AspNetCore.BrowserLink",
    reason: "Removed in .NET 8+",
    action: "remove",
  },
  "system.web": {
    package: "System.Web",
    reason: "Not available in .NET Core/.NET 5+",
    action: "replace",
    replacement: "Microsoft.AspNetCore.Http",
  },
  "system.drawing.common": {
    package: "System.Drawing.Common",
    reason: "Windows-only in .NET 7+, restricted in .NET 8+",
    action: "replace",
    replacement: "SkiaSharp or ImageSharp",
  },
  "newtonsoft.json": {
    package: "Newtonsoft.Json",
    reason: "Consider migrating to System.Text.Json (not required but recommended)",
    action: "replace",
    replacement: "System.Text.Json",
  },
  "binaryformatter": {
    package: "BinaryFormatter",
    reason: "Completely removed in .NET 9+, restricted since .NET 8",
    action: "remove",
  },
  "swashbuckle.aspnetcore": {
    package: "Swashbuckle.AspNetCore",
    reason: "Removed from .NET 9+ templates, replaced by Microsoft.AspNetCore.OpenApi",
    action: "replace",
    replacement: "Microsoft.AspNetCore.OpenApi",
  },
  // Java / Spring Boot
  "javax.servlet-api": {
    package: "javax.servlet-api",
    reason: "Replaced by Jakarta Servlet in Jakarta EE 9+",
    action: "replace",
    replacement: "jakarta.servlet-api",
  },
  "spring-cloud-sleuth": {
    package: "spring-cloud-sleuth",
    reason: "Replaced by Micrometer Tracing in Spring Boot 3",
    action: "replace",
    replacement: "micrometer-tracing",
  },
  // Python
  "django-extensions": {
    package: "django-extensions",
    reason: "Some features now in core Django; check compatibility for Django 4+",
    action: "replace",
    replacement: "django (core features) or updated django-extensions",
  },
  // JavaScript / Node.js
  "request": {
    package: "request",
    reason: "Fully deprecated since 2020",
    action: "replace",
    replacement: "node-fetch, axios, or undici",
  },
  "moment": {
    package: "moment",
    reason: "Maintenance mode, recommend modern alternatives",
    action: "replace",
    replacement: "date-fns, dayjs, or Intl.DateTimeFormat",
  },
};

// ── Deprecated API Patterns ─────────────────────────────────────
// Function calls/usages that are deprecated or removed in common upgrades.

interface DeprecatedAPIPattern {
  pattern: string;
  matchType: "exact" | "contains" | "startsWith";
  stacks: string[];
  issue: string;
  fix: string;
  severity: ImpactItem["severity"];
}

const DEPRECATED_API_PATTERNS: DeprecatedAPIPattern[] = [
  // .NET deprecated APIs
  { pattern: "UseBrowserLink", matchType: "contains", stacks: ["dotnet"], issue: "Removed in .NET 8+", fix: "Remove this call entirely", severity: "critical" },
  { pattern: "BinaryFormatter", matchType: "contains", stacks: ["dotnet"], issue: "Removed in .NET 9+", fix: "Use System.Text.Json or XmlSerializer", severity: "critical" },
  { pattern: "WebRequest", matchType: "exact", stacks: ["dotnet"], issue: "Deprecated since .NET 6", fix: "Use HttpClient instead", severity: "high" },
  { pattern: "WebClient", matchType: "exact", stacks: ["dotnet"], issue: "Deprecated since .NET 6", fix: "Use HttpClient instead", severity: "high" },
  { pattern: "AddMvc", matchType: "exact", stacks: ["dotnet"], issue: "Deprecated pattern", fix: "Use AddControllersWithViews() or AddControllers()", severity: "medium" },

  // Bootstrap 4 → 5 patterns
  { pattern: "data-toggle", matchType: "contains", stacks: ["bootstrap"], issue: "Renamed in Bootstrap 5", fix: "Change to data-bs-toggle", severity: "high" },
  { pattern: "data-dismiss", matchType: "contains", stacks: ["bootstrap"], issue: "Renamed in Bootstrap 5", fix: "Change to data-bs-dismiss", severity: "high" },
  { pattern: "data-target", matchType: "contains", stacks: ["bootstrap"], issue: "Renamed in Bootstrap 5", fix: "Change to data-bs-target", severity: "high" },
  { pattern: "data-ride", matchType: "contains", stacks: ["bootstrap"], issue: "Renamed in Bootstrap 5", fix: "Change to data-bs-ride", severity: "medium" },
  { pattern: "data-slide", matchType: "contains", stacks: ["bootstrap"], issue: "Renamed in Bootstrap 5", fix: "Change to data-bs-slide", severity: "medium" },
  { pattern: "data-parent", matchType: "contains", stacks: ["bootstrap"], issue: "Renamed in Bootstrap 5", fix: "Change to data-bs-parent", severity: "medium" },
  { pattern: ".jumbotron", matchType: "contains", stacks: ["bootstrap"], issue: "Removed in Bootstrap 5", fix: "Use padding utilities (p-5, bg-body-tertiary, rounded-3)", severity: "high" },
  { pattern: ".media", matchType: "contains", stacks: ["bootstrap"], issue: "Removed in Bootstrap 5", fix: "Use flexbox utilities (d-flex)", severity: "high" },
  { pattern: ".form-group", matchType: "contains", stacks: ["bootstrap"], issue: "Removed in Bootstrap 5", fix: "Use mb-3 or spacing utilities", severity: "medium" },
  { pattern: ".badge-", matchType: "contains", stacks: ["bootstrap"], issue: "Renamed in Bootstrap 5", fix: "Use .bg-* + .text-* classes", severity: "medium" },
  { pattern: ".custom-select", matchType: "contains", stacks: ["bootstrap"], issue: "Renamed in Bootstrap 5", fix: "Use .form-select", severity: "medium" },
  { pattern: ".input-group-prepend", matchType: "contains", stacks: ["bootstrap"], issue: "Removed in Bootstrap 5", fix: "Place elements directly inside .input-group", severity: "medium" },
  { pattern: ".input-group-append", matchType: "contains", stacks: ["bootstrap"], issue: "Removed in Bootstrap 5", fix: "Place elements directly inside .input-group", severity: "medium" },
  { pattern: ".float-left", matchType: "contains", stacks: ["bootstrap"], issue: "Renamed in Bootstrap 5", fix: "Use .float-start", severity: "low" },
  { pattern: ".float-right", matchType: "contains", stacks: ["bootstrap"], issue: "Renamed in Bootstrap 5", fix: "Use .float-end", severity: "low" },
  { pattern: ".ml-", matchType: "contains", stacks: ["bootstrap"], issue: "Renamed in Bootstrap 5", fix: "Use .ms-* (margin-start)", severity: "low" },
  { pattern: ".mr-", matchType: "contains", stacks: ["bootstrap"], issue: "Renamed in Bootstrap 5", fix: "Use .me-* (margin-end)", severity: "low" },
  { pattern: ".pl-", matchType: "contains", stacks: ["bootstrap"], issue: "Renamed in Bootstrap 5", fix: "Use .ps-* (padding-start)", severity: "low" },
  { pattern: ".pr-", matchType: "contains", stacks: ["bootstrap"], issue: "Renamed in Bootstrap 5", fix: "Use .pe-* (padding-end)", severity: "low" },
  { pattern: ".text-left", matchType: "contains", stacks: ["bootstrap"], issue: "Renamed in Bootstrap 5", fix: "Use .text-start", severity: "low" },
  { pattern: ".text-right", matchType: "contains", stacks: ["bootstrap"], issue: "Renamed in Bootstrap 5", fix: "Use .text-end", severity: "low" },

  // jQuery 3 → 4 patterns
  { pattern: ".bind(", matchType: "contains", stacks: ["jquery"], issue: "Removed in jQuery 4", fix: "Use .on() instead", severity: "high" },
  { pattern: ".unbind(", matchType: "contains", stacks: ["jquery"], issue: "Removed in jQuery 4", fix: "Use .off() instead", severity: "high" },
  { pattern: ".delegate(", matchType: "contains", stacks: ["jquery"], issue: "Removed in jQuery 4", fix: "Use .on() with selector", severity: "high" },
  { pattern: ".undelegate(", matchType: "contains", stacks: ["jquery"], issue: "Removed in jQuery 4", fix: "Use .off() with selector", severity: "high" },
  { pattern: "jQuery.isArray", matchType: "contains", stacks: ["jquery"], issue: "Removed in jQuery 4", fix: "Use Array.isArray()", severity: "high" },
  { pattern: "$.isArray", matchType: "contains", stacks: ["jquery"], issue: "Removed in jQuery 4", fix: "Use Array.isArray()", severity: "high" },
  { pattern: "jQuery.parseJSON", matchType: "contains", stacks: ["jquery"], issue: "Removed in jQuery 4", fix: "Use JSON.parse()", severity: "high" },
  { pattern: "$.parseJSON", matchType: "contains", stacks: ["jquery"], issue: "Removed in jQuery 4", fix: "Use JSON.parse()", severity: "high" },
  { pattern: "jQuery.isFunction", matchType: "contains", stacks: ["jquery"], issue: "Removed in jQuery 4", fix: "Use typeof x === 'function'", severity: "medium" },
  { pattern: "$.isFunction", matchType: "contains", stacks: ["jquery"], issue: "Removed in jQuery 4", fix: "Use typeof x === 'function'", severity: "medium" },
  { pattern: "jQuery.type", matchType: "contains", stacks: ["jquery"], issue: "Removed in jQuery 4", fix: "Use typeof", severity: "medium" },
  { pattern: "$.type", matchType: "contains", stacks: ["jquery"], issue: "Removed in jQuery 4", fix: "Use typeof", severity: "medium" },

  // Spring Boot 2 → 3
  { pattern: "javax.", matchType: "startsWith", stacks: ["spring-boot", "java"], issue: "Renamed in Jakarta EE 9+", fix: "Change javax.* → jakarta.*", severity: "critical" },
  { pattern: "WebSecurityConfigurerAdapter", matchType: "contains", stacks: ["spring-boot"], issue: "Removed in Spring Security 6", fix: "Use SecurityFilterChain @Bean", severity: "critical" },
  { pattern: "spring.factories", matchType: "contains", stacks: ["spring-boot"], issue: "Deprecated in Spring Boot 3", fix: "Use META-INF/spring/org.springframework.boot.autoconfigure.AutoConfiguration.imports", severity: "high" },

  // Vue 2 → 3
  { pattern: "new Vue(", matchType: "contains", stacks: ["vue"], issue: "Removed in Vue 3", fix: "Use createApp() instead", severity: "critical" },
  { pattern: "Vue.component(", matchType: "contains", stacks: ["vue"], issue: "Removed global API in Vue 3", fix: "Use app.component() on the app instance", severity: "high" },
  { pattern: "Vue.directive(", matchType: "contains", stacks: ["vue"], issue: "Removed global API in Vue 3", fix: "Use app.directive() on the app instance", severity: "high" },
  { pattern: "Vue.mixin(", matchType: "contains", stacks: ["vue"], issue: "Removed global API in Vue 3", fix: "Use app.mixin() or Composition API", severity: "high" },
  { pattern: "Vue.use(", matchType: "contains", stacks: ["vue"], issue: "Removed global API in Vue 3", fix: "Use app.use() on the app instance", severity: "high" },
  { pattern: "Vue.set(", matchType: "contains", stacks: ["vue"], issue: "Removed in Vue 3", fix: "Use direct assignment (reactivity works automatically)", severity: "high" },
  { pattern: "Vue.delete(", matchType: "contains", stacks: ["vue"], issue: "Removed in Vue 3", fix: "Use delete operator", severity: "high" },
  { pattern: "$on(", matchType: "contains", stacks: ["vue"], issue: "Removed in Vue 3", fix: "Use mitt or tiny-emitter for event bus", severity: "high" },
  { pattern: "$off(", matchType: "contains", stacks: ["vue"], issue: "Removed in Vue 3", fix: "Use mitt or tiny-emitter for event bus", severity: "high" },
  { pattern: "$listeners", matchType: "contains", stacks: ["vue"], issue: "Removed in Vue 3", fix: "Use $attrs (listeners merged into attrs)", severity: "medium" },

  // Express 4 → 5
  { pattern: ".del(", matchType: "contains", stacks: ["express"], issue: "Removed in Express 5", fix: "Use .delete() instead", severity: "high" },
  { pattern: "req.param(", matchType: "contains", stacks: ["express"], issue: "Removed in Express 5", fix: "Use req.params, req.body, or req.query", severity: "high" },

  // Next.js 12 → 13+
  { pattern: "next export", matchType: "contains", stacks: ["nextjs"], issue: "Removed in Next.js 14", fix: "Use output: 'export' in next.config.js", severity: "high" },
  { pattern: "getServerSideProps", matchType: "contains", stacks: ["nextjs"], issue: "Pages Router pattern", fix: "Consider migrating to App Router with Server Components", severity: "medium" },
  { pattern: "getStaticProps", matchType: "contains", stacks: ["nextjs"], issue: "Pages Router pattern", fix: "Consider migrating to App Router with Server Components", severity: "medium" },

  // Django 3 → 4
  { pattern: "from django.conf.urls import url", matchType: "contains", stacks: ["django"], issue: "Removed in Django 4", fix: "Use from django.urls import re_path", severity: "critical" },
  { pattern: "ugettext_lazy", matchType: "contains", stacks: ["django"], issue: "Removed in Django 4", fix: "Use gettext_lazy", severity: "high" },
  { pattern: "ugettext", matchType: "contains", stacks: ["django"], issue: "Removed in Django 4", fix: "Use gettext", severity: "high" },
  { pattern: "USE_L10N", matchType: "contains", stacks: ["django"], issue: "Removed in Django 4", fix: "Remove setting — localization is always enabled", severity: "medium" },

  // Rails 6 → 7
  { pattern: "update_attributes(", matchType: "contains", stacks: ["rails"], issue: "Removed in Rails 7", fix: "Use update() instead", severity: "high" },
  { pattern: "update_attributes!(", matchType: "contains", stacks: ["rails"], issue: "Removed in Rails 7", fix: "Use update!() instead", severity: "high" },

  // React 17 → 18
  { pattern: "ReactDOM.render(", matchType: "contains", stacks: ["react"], issue: "Deprecated in React 18", fix: "Use createRoot().render()", severity: "high" },
  { pattern: "ReactDOM.hydrate(", matchType: "contains", stacks: ["react"], issue: "Deprecated in React 18", fix: "Use hydrateRoot()", severity: "high" },

  // Python 2 → 3
  { pattern: "xrange(", matchType: "contains", stacks: ["python"], issue: "Removed in Python 3", fix: "Use range()", severity: "high" },
  { pattern: "raw_input(", matchType: "contains", stacks: ["python"], issue: "Removed in Python 3", fix: "Use input()", severity: "high" },
  { pattern: ".iteritems()", matchType: "contains", stacks: ["python"], issue: "Removed in Python 3", fix: "Use .items()", severity: "high" },
  { pattern: ".itervalues()", matchType: "contains", stacks: ["python"], issue: "Removed in Python 3", fix: "Use .values()", severity: "high" },
  { pattern: ".has_key(", matchType: "contains", stacks: ["python"], issue: "Removed in Python 3", fix: "Use 'in' operator", severity: "high" },

  // Flask 2 → 3
  { pattern: "before_first_request", matchType: "contains", stacks: ["flask"], issue: "Removed in Flask 2.3+", fix: "Use before_request with a flag or app startup hooks", severity: "high" },

  // Laravel 9 → 10+
  { pattern: "Route::resource", matchType: "contains", stacks: ["laravel"], issue: "Check for API changes", fix: "Review resource route signatures for updated middleware", severity: "low" },

  // Svelte 3 → 4/5
  { pattern: "export let", matchType: "contains", stacks: ["svelte"], issue: "Changed in Svelte 5", fix: "Use $props() rune for component props in Svelte 5", severity: "medium" },
];

// ── Analyzer ────────────────────────────────────────────────────

function matchesPattern(text: string, pattern: string, matchType: DeprecatedAPIPattern["matchType"]): boolean {
  const lower = text.toLowerCase();
  const pLower = pattern.toLowerCase();
  switch (matchType) {
    case "exact": return lower === pLower || lower.includes(`.${pLower}(`) || lower.includes(`${pLower}(`);
    case "contains": return lower.includes(pLower);
    case "startsWith": return lower.startsWith(pLower);
    default: return false;
  }
}

function detectActiveStacks(
  selections: Array<{ package: string; currentVersion: string; selectedVersion: string }>,
): Set<string> {
  const stacks = new Set<string>();
  for (const sel of selections) {
    const lower = sel.package.toLowerCase();
    if (lower.includes(".net") || lower.includes("dotnet") || lower.includes("asp.net")) stacks.add("dotnet");
    if (lower.includes("bootstrap")) stacks.add("bootstrap");
    if (lower.includes("jquery") && !lower.includes("validation")) stacks.add("jquery");
    if (lower.includes("spring") || lower.includes("spring-boot")) { stacks.add("spring-boot"); stacks.add("java"); }
    if (lower.includes("react") && !lower.includes("react-")) stacks.add("react");
    if (lower.includes("angular")) stacks.add("angular");
    if (lower.includes("django")) stacks.add("django");
    if (lower.includes("entity framework")) stacks.add("dotnet");
    if (lower.includes("vue") || lower === "vuejs") stacks.add("vue");
    if (lower.includes("express")) stacks.add("express");
    if (lower.includes("next") || lower === "nextjs" || lower === "next.js") stacks.add("nextjs");
    if (lower.includes("flask")) stacks.add("flask");
    if (lower.includes("rails") || lower === "ruby on rails") stacks.add("rails");
    if (lower.includes("laravel")) stacks.add("laravel");
    if (lower.includes("svelte")) stacks.add("svelte");
    if (lower.includes("python")) stacks.add("python");
    if (lower.includes("java") && !lower.includes("javascript")) stacks.add("java");
  }
  return stacks;
}

/**
 * Analyze all files for upgrade impact using AST analysis and migration docs.
 */
export function analyzeUpgradeImpact(
  astAnalysis: Record<string, ASTAnalysis>,
  migrationDocs: Map<string, MigrationDocResult>,
  selections: Array<{ package: string; currentVersion: string; selectedVersion: string }>,
): UpgradeImpactReport {
  const activeStacks = detectActiveStacks(selections);
  const affectedFiles: FileImpact[] = [];
  const deprecatedPackages: DeprecatedPackage[] = [];
  let totalImpacts = 0;
  let criticalCount = 0;
  let highCount = 0;

  // Collect all removed/deprecated APIs from migration docs
  const removedAPIs = new Set<string>();
  const deprecatedAPIs = new Set<string>();
  for (const [, doc] of migrationDocs) {
    doc.removedAPIs.forEach(api => removedAPIs.add(api.toLowerCase()));
    doc.deprecatedAPIs.forEach(api => deprecatedAPIs.add(api.toLowerCase()));
  }

  // Detect deprecated packages from imports
  const seenDeprecatedPkgs = new Set<string>();

  for (const [filePath, ast] of Object.entries(astAnalysis)) {
    const impacts: ImpactItem[] = [];

    // Check imports against deprecated packages
    for (const imp of ast.imports) {
      const sourceLower = imp.source.toLowerCase();
      for (const [key, deprecatedPkg] of Object.entries(DEPRECATED_PACKAGES)) {
        if (sourceLower.includes(key) || sourceLower === key) {
          impacts.push({
            line: imp.line,
            pattern: imp.source,
            issue: deprecatedPkg.reason,
            fix: deprecatedPkg.action === "remove"
              ? `Remove this import and all usages of ${imp.source}`
              : `Replace with ${deprecatedPkg.replacement}`,
            severity: "critical",
            source: "deprecated-registry",
          });
          if (!seenDeprecatedPkgs.has(key)) {
            deprecatedPackages.push(deprecatedPkg);
            seenDeprecatedPkgs.add(key);
          }
        }
      }

      // Check imports against migration doc removed APIs
      for (const removedApi of removedAPIs) {
        if (sourceLower.includes(removedApi) || imp.names.some(n => n.toLowerCase() === removedApi)) {
          impacts.push({
            line: imp.line,
            pattern: `${imp.names.join(", ")} from ${imp.source}`,
            issue: `Removed in target version`,
            fix: `Remove or replace this import`,
            severity: "high",
            source: "migration-doc",
          });
        }
      }
    }

    // Check function calls against deprecated patterns
    for (const call of ast.functionCalls) {
      for (const apiPattern of DEPRECATED_API_PATTERNS) {
        if (!apiPattern.stacks.some(s => activeStacks.has(s))) continue;

        const textToCheck = call.fullExpression;
        if (matchesPattern(textToCheck, apiPattern.pattern, apiPattern.matchType)) {
          if (impacts.some(i => i.line === call.line && i.pattern === textToCheck)) continue;
          impacts.push({
            line: call.line,
            pattern: textToCheck,
            issue: apiPattern.issue,
            fix: apiPattern.fix,
            severity: apiPattern.severity,
            source: "pattern-match",
          });
        }
      }

      // Check against migration doc removed APIs
      for (const removedApi of removedAPIs) {
        if (call.fullExpression.toLowerCase().includes(removedApi)) {
          if (impacts.some(i => i.line === call.line && i.source === "migration-doc")) continue;
          impacts.push({
            line: call.line,
            pattern: call.fullExpression,
            issue: `API removed in target version`,
            fix: `See migration documentation`,
            severity: "high",
            source: "migration-doc",
          });
        }
      }
    }

    // Check class instantiations
    for (const inst of ast.classInstantiations) {
      const className = inst.className.toLowerCase();
      if (DEPRECATED_PACKAGES[className]) {
        impacts.push({
          line: inst.line,
          pattern: `new ${inst.className}()`,
          issue: DEPRECATED_PACKAGES[className].reason,
          fix: DEPRECATED_PACKAGES[className].action === "remove"
            ? `Remove usage of ${inst.className}`
            : `Replace with ${DEPRECATED_PACKAGES[className].replacement}`,
          severity: "critical",
          source: "deprecated-registry",
        });
      }
    }

    // Check attributes/annotations for deprecated patterns
    for (const attr of ast.attributes) {
      // Check data-toggle, data-dismiss etc. in HTML files
      if (activeStacks.has("bootstrap")) {
        const attrName = attr.name.toLowerCase();
        if (["data-toggle", "data-dismiss", "data-target", "data-ride", "data-slide", "data-parent"].includes(attrName)) {
          impacts.push({
            line: attr.line,
            pattern: `${attr.name}="${attr.target}"`,
            issue: "Renamed in Bootstrap 5",
            fix: `Change to ${attr.name.replace("data-", "data-bs-")}`,
            severity: "high",
            source: "pattern-match",
          });
        }
      }
    }

    // Full-text scan for CSS class patterns (Bootstrap)
    if (activeStacks.has("bootstrap")) {
      const fileContent = ""; // We check via AST attributes above
      // Additional: scan function calls for jQuery Bootstrap plugin usage
      for (const call of ast.functionCalls) {
        if (call.caller === "$" && ["modal", "tooltip", "popover", "carousel", "collapse", "tab", "dropdown", "scrollspy"].includes(call.method)) {
          impacts.push({
            line: call.line,
            pattern: `$().${call.method}()`,
            issue: "jQuery plugin initialization removed in Bootstrap 5",
            fix: `Use vanilla JS: new bootstrap.${call.method.charAt(0).toUpperCase() + call.method.slice(1)}(element)`,
            severity: "high",
            source: "pattern-match",
          });
        }
      }
    }

    if (impacts.length > 0) {
      const hasEventBindings = ast.eventBindings.length > 0;
      const hasNavigationLogic = ast.eventBindings.some(e =>
        e.type === "navigation" || e.type === "submit" || e.handler.includes("location") || e.handler.includes("redirect")
      );

      const fileRisk = calculateFileRisk(impacts);
      criticalCount += impacts.filter(i => i.severity === "critical").length;
      highCount += impacts.filter(i => i.severity === "high").length;
      totalImpacts += impacts.length;

      affectedFiles.push({
        path: filePath,
        impacts,
        riskScore: fileRisk,
        hasEventBindings,
        hasNavigationLogic,
      });
    }
  }

  // Sort by risk score (highest first)
  affectedFiles.sort((a, b) => b.riskScore - a.riskScore);

  const overallRisk = calculateOverallRisk(affectedFiles, totalImpacts, criticalCount, highCount);

  const summary = generateSummary(affectedFiles, deprecatedPackages, totalImpacts, criticalCount, highCount, overallRisk);

  return {
    deprecatedPackages,
    affectedFiles,
    riskScore: overallRisk,
    summary,
    totalImpacts,
    criticalCount,
    highCount,
  };
}

function calculateFileRisk(impacts: ImpactItem[]): number {
  let score = 0;
  for (const impact of impacts) {
    switch (impact.severity) {
      case "critical": score += 25; break;
      case "high": score += 15; break;
      case "medium": score += 8; break;
      case "low": score += 3; break;
    }
  }
  return Math.min(100, score);
}

function calculateOverallRisk(
  files: FileImpact[],
  totalImpacts: number,
  critical: number,
  high: number,
): number {
  if (files.length === 0) return 0;
  const avgFileRisk = files.reduce((sum, f) => sum + f.riskScore, 0) / files.length;
  const severityBonus = critical * 10 + high * 5;
  return Math.min(100, Math.round(avgFileRisk + severityBonus));
}

function generateSummary(
  files: FileImpact[],
  deprecatedPkgs: DeprecatedPackage[],
  total: number,
  critical: number,
  high: number,
  riskScore: number,
): string {
  const parts: string[] = [];
  parts.push(`Impact Analysis: ${files.length} files affected, ${total} issues found`);
  parts.push(`Risk Score: ${riskScore}/100`);
  if (critical > 0) parts.push(`⚠️ ${critical} CRITICAL issues (must fix before upgrade)`);
  if (high > 0) parts.push(`${high} HIGH severity issues`);
  if (deprecatedPkgs.length > 0) {
    parts.push(`Deprecated packages to remove: ${deprecatedPkgs.map(p => p.package).join(", ")}`);
  }
  const navFiles = files.filter(f => f.hasNavigationLogic);
  if (navFiles.length > 0) {
    parts.push(`⚠️ ${navFiles.length} file(s) with navigation/redirect logic — test these carefully`);
  }
  const eventFiles = files.filter(f => f.hasEventBindings);
  if (eventFiles.length > 0) {
    parts.push(`${eventFiles.length} file(s) with event bindings — verify interactive behavior preserved`);
  }
  return parts.join("\n");
}

// ── Prompt Formatting ───────────────────────────────────────────

/**
 * Format the impact report for injection into LLM upgrade prompts.
 * Scoped to a specific file.
 */
export function formatImpactReportForFile(report: UpgradeImpactReport, filePath: string): string {
  const fileImpact = report.affectedFiles.find(f => f.path === filePath);
  if (!fileImpact || fileImpact.impacts.length === 0) return "";

  const lines: string[] = [
    "## PRE-UPGRADE IMPACT ANALYSIS (from official migration docs + AST scan)",
    "The following issues were detected in this file. You MUST address ALL of them:",
  ];

  for (const impact of fileImpact.impacts) {
    const prefix = impact.severity === "critical" ? "🚨 CRITICAL" : impact.severity === "high" ? "⚠️ HIGH" : impact.severity === "medium" ? "MEDIUM" : "LOW";
    lines.push(`- Line ${impact.line}: \`${impact.pattern}\` — ${prefix}: ${impact.issue}. Action: ${impact.fix}`);
  }

  if (fileImpact.hasEventBindings) {
    lines.push("\n⚠️ This file has EVENT BINDINGS. Do NOT alter event handler names, types, or behavior.");
  }
  if (fileImpact.hasNavigationLogic) {
    lines.push("\n⚠️ This file has NAVIGATION/REDIRECT logic. Do NOT change URLs, routes, or navigation behavior.");
  }

  return lines.join("\n");
}

/**
 * Format global impact summary for the planning phase.
 */
export function formatImpactSummaryForPrompt(report: UpgradeImpactReport): string {
  if (report.totalImpacts === 0) return "";

  const lines: string[] = [
    "## PRE-UPGRADE IMPACT REPORT",
    report.summary,
    "",
  ];

  if (report.deprecatedPackages.length > 0) {
    lines.push("### Deprecated Packages");
    for (const pkg of report.deprecatedPackages) {
      lines.push(`- **${pkg.package}**: ${pkg.reason} → ${pkg.action === "remove" ? "REMOVE" : `Replace with ${pkg.replacement}`}`);
    }
    lines.push("");
  }

  lines.push("### Most Affected Files");
  for (const file of report.affectedFiles.slice(0, 15)) {
    const critical = file.impacts.filter(i => i.severity === "critical").length;
    const high = file.impacts.filter(i => i.severity === "high").length;
    lines.push(`- **${file.path}** (risk: ${file.riskScore}/100, ${file.impacts.length} issues${critical > 0 ? `, ${critical} critical` : ""}${high > 0 ? `, ${high} high` : ""}${file.hasEventBindings ? ", has events" : ""})`);
  }

  return lines.join("\n");
}

/**
 * Get a list of patterns that the LLM is allowed to rename (from migration docs).
 * Used by the import validator to distinguish legitimate renames from errors.
 */
export function getAllowedRenames(migrationDocs: Map<string, MigrationDocResult>): Record<string, string> {
  const renames: Record<string, string> = {};

  for (const [pkg, doc] of migrationDocs) {
    const lower = pkg.toLowerCase();

    // Spring Boot javax → jakarta
    if (lower.includes("spring") || lower.includes("java")) {
      for (const api of doc.removedAPIs) {
        if (api.includes("javax") && api.includes("jakarta")) {
          renames["javax."] = "jakarta.";
        }
      }
      if (doc.breakingChanges.toLowerCase().includes("javax") && doc.breakingChanges.toLowerCase().includes("jakarta")) {
        renames["javax."] = "jakarta.";
      }
    }

    // Bootstrap data- → data-bs-
    if (lower.includes("bootstrap")) {
      renames["data-toggle"] = "data-bs-toggle";
      renames["data-dismiss"] = "data-bs-dismiss";
      renames["data-target"] = "data-bs-target";
      renames["data-ride"] = "data-bs-ride";
      renames["data-slide"] = "data-bs-slide";
      renames["data-slide-to"] = "data-bs-slide-to";
      renames["data-parent"] = "data-bs-parent";
      renames["data-spy"] = "data-bs-spy";
      renames["data-offset"] = "data-bs-offset";
    }

    // jQuery deprecated → modern equivalents
    if (lower.includes("jquery")) {
      renames["$.isArray"] = "Array.isArray";
      renames["jQuery.isArray"] = "Array.isArray";
      renames["$.parseJSON"] = "JSON.parse";
      renames["jQuery.parseJSON"] = "JSON.parse";
      renames[".bind("] = ".on(";
      renames[".unbind("] = ".off(";
      renames[".delegate("] = ".on(";
      renames[".undelegate("] = ".off(";
    }

    // Django 4: ugettext → gettext
    if (lower.includes("django")) {
      renames["ugettext_lazy"] = "gettext_lazy";
      renames["ugettext"] = "gettext";
      renames["from django.conf.urls import url"] = "from django.urls import re_path";
    }

    // Vue 2 → 3 renames
    if (lower.includes("vue")) {
      renames["new Vue("] = "createApp(";
      renames["Vue.component("] = "app.component(";
      renames["Vue.directive("] = "app.directive(";
      renames["Vue.use("] = "app.use(";
    }

    // Rails 7 renames
    if (lower.includes("rails")) {
      renames["update_attributes("] = "update(";
      renames["update_attributes!("] = "update!(";
    }

    // Python 3 renames
    if (lower.includes("python")) {
      renames["xrange("] = "range(";
      renames["raw_input("] = "input(";
      renames[".iteritems()"] = ".items()";
      renames[".itervalues()"] = ".values()";
      renames[".iterkeys()"] = ".keys()";
    }

    // React 18 renames
    if (lower.includes("react")) {
      renames["ReactDOM.render("] = "createRoot().render(";
      renames["ReactDOM.hydrate("] = "hydrateRoot(";
    }

    // Express 5 renames
    if (lower.includes("express")) {
      renames[".del("] = ".delete(";
    }

    // Dynamic: parse removedAPIs for rename patterns "(use X)"
    for (const api of doc.removedAPIs) {
      const renameMatch = api.match(/^(.+?)\s*\(use\s+(.+?)\)$/i);
      if (renameMatch) {
        const from = renameMatch[1].trim();
        const to = renameMatch[2].trim();
        if (from.length >= 3 && to.length >= 3 && !renames[from]) {
          renames[from] = to;
        }
      }
    }
  }

  return renames;
}
