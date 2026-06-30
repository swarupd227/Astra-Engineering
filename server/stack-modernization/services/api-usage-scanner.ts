/**
 * Client Code API Usage Scanner
 *
 * GAP 3 fix — Scans application code (JS, TS, HTML, Razor, etc.) to detect
 * specific library API calls that would BREAK during a version upgrade.
 *
 * This is NOT just import detection. This maps concrete API calls like:
 *   - `.modal('hide')` → Bootstrap modal API
 *   - `jQuery.support.cors` → jQuery deprecated API
 *   - `data-toggle="modal"` → Bootstrap HTML attribute
 *   - `fa fa-spinner` → Font Awesome class prefix
 *
 * The output feeds into the code upgrade agent so it knows EXACTLY which
 * files and lines need modification.
 */

import type { ExtractedFile, VersionSelection } from "../types";

// ═══════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════

export interface APIUsageMatch {
  file: string;
  line: number;
  column: number;
  matchedText: string;
  library: string;
  apiName: string;
  changeType: "removed" | "renamed" | "changed" | "deprecated";
  /** How to fix this usage */
  fix: string;
  /** Can be automatically fixed with regex? */
  autoFixable: boolean;
}

export interface FileImpactItem {
  file: string;
  line: number;
  apiName: string;
  library: string;
  currentVersion: string;
  targetVersion: string;
  changeType: "removed" | "renamed" | "changed" | "deprecated";
  fix: string;
  autoFixable: boolean;
}

export interface FileImpactReport {
  totalImpactedFiles: number;
  totalImpactItems: number;
  items: FileImpactItem[];
  byLibrary: Record<string, number>;
  byFile: Record<string, number>;
}

// ═══════════════════════════════════════════════════════════════
// API patterns per library upgrade
// ═══════════════════════════════════════════════════════════════

interface APIPattern {
  regex: RegExp;
  library: string;
  apiName: string;
  changeType: APIUsageMatch["changeType"];
  fix: string;
  autoFixable: boolean;
  /** Minimum target version that triggers this pattern */
  minTargetMajor: number;
  /** File extensions to scan (empty = all code files) */
  extensions?: string[];
}

const JQUERY_PATTERNS: APIPattern[] = [
  // jQuery 4 removals
  { regex: /jQuery\.support\.cors\s*=\s*true;?/g, library: "jquery", apiName: "jQuery.support.cors", changeType: "removed", fix: "Delete this line — jQuery.support.cors was removed in jQuery 4", autoFixable: true, minTargetMajor: 4 },
  { regex: /\$\.support\.cors\s*=\s*true;?/g, library: "jquery", apiName: "$.support.cors", changeType: "removed", fix: "Delete this line", autoFixable: true, minTargetMajor: 4 },
  { regex: /\$\.isArray\s*\(/g, library: "jquery", apiName: "$.isArray()", changeType: "removed", fix: "Replace with Array.isArray()", autoFixable: true, minTargetMajor: 4 },
  { regex: /jQuery\.isArray\s*\(/g, library: "jquery", apiName: "jQuery.isArray()", changeType: "removed", fix: "Replace with Array.isArray()", autoFixable: true, minTargetMajor: 4 },
  { regex: /\$\.parseJSON\s*\(/g, library: "jquery", apiName: "$.parseJSON()", changeType: "removed", fix: "Replace with JSON.parse()", autoFixable: true, minTargetMajor: 4 },
  { regex: /\$\.trim\s*\(/g, library: "jquery", apiName: "$.trim()", changeType: "removed", fix: "Replace with str.trim()", autoFixable: true, minTargetMajor: 4 },
  { regex: /\$\.isFunction\s*\(/g, library: "jquery", apiName: "$.isFunction()", changeType: "removed", fix: "Replace with typeof fn === 'function'", autoFixable: true, minTargetMajor: 4 },
  { regex: /\$\.isNumeric\s*\(/g, library: "jquery", apiName: "$.isNumeric()", changeType: "removed", fix: "Replace with !isNaN(parseFloat(n)) && isFinite(n)", autoFixable: true, minTargetMajor: 4 },
  { regex: /\$\.isWindow\s*\(/g, library: "jquery", apiName: "$.isWindow()", changeType: "removed", fix: "Replace with obj != null && obj === obj.window", autoFixable: true, minTargetMajor: 4 },
  { regex: /\$\.camelCase\s*\(/g, library: "jquery", apiName: "$.camelCase()", changeType: "removed", fix: "Implement custom camelCase function", autoFixable: false, minTargetMajor: 4 },
  { regex: /\$\.type\s*\(/g, library: "jquery", apiName: "$.type()", changeType: "removed", fix: "Replace with typeof or Object.prototype.toString.call()", autoFixable: false, minTargetMajor: 4 },
  { regex: /\$\.now\s*\(/g, library: "jquery", apiName: "$.now()", changeType: "removed", fix: "Replace with Date.now()", autoFixable: true, minTargetMajor: 4 },
  { regex: /\.size\s*\(\s*\)/g, library: "jquery", apiName: ".size()", changeType: "removed", fix: "Replace with .length property", autoFixable: true, minTargetMajor: 4 },
  { regex: /\.bind\s*\(\s*['"][a-z]/g, library: "jquery", apiName: ".bind() event", changeType: "deprecated", fix: "Replace with .on()", autoFixable: false, minTargetMajor: 4 },
  { regex: /\.unbind\s*\(/g, library: "jquery", apiName: ".unbind()", changeType: "deprecated", fix: "Replace with .off()", autoFixable: true, minTargetMajor: 4 },
  { regex: /\.delegate\s*\(/g, library: "jquery", apiName: ".delegate()", changeType: "removed", fix: "Replace with .on()", autoFixable: false, minTargetMajor: 4 },
  { regex: /\.undelegate\s*\(/g, library: "jquery", apiName: ".undelegate()", changeType: "removed", fix: "Replace with .off()", autoFixable: true, minTargetMajor: 4 },
  { regex: /\$\.ajaxSetup\s*\(/g, library: "jquery", apiName: "$.ajaxSetup()", changeType: "changed", fix: "Review — global AJAX settings behavior changed in jQuery 4", autoFixable: false, minTargetMajor: 4 },
];

const BOOTSTRAP_JS_PATTERNS: APIPattern[] = [
  // Bootstrap 5 JS API changes (jQuery plugin → vanilla JS)
  { regex: /\.\s*modal\s*\(\s*['"]/g, library: "bootstrap", apiName: ".modal() jQuery plugin", changeType: "changed", fix: "Replace with bootstrap.Modal.getInstance(el) or new bootstrap.Modal(el)", autoFixable: false, minTargetMajor: 5, extensions: [".js", ".ts", ".jsx", ".tsx"] },
  { regex: /\.\s*tooltip\s*\(\s*[{'"]/g, library: "bootstrap", apiName: ".tooltip() jQuery plugin", changeType: "changed", fix: "Replace with new bootstrap.Tooltip(el, options)", autoFixable: false, minTargetMajor: 5, extensions: [".js", ".ts", ".jsx", ".tsx"] },
  { regex: /\.\s*popover\s*\(\s*[{'"]/g, library: "bootstrap", apiName: ".popover() jQuery plugin", changeType: "changed", fix: "Replace with new bootstrap.Popover(el, options)", autoFixable: false, minTargetMajor: 5, extensions: [".js", ".ts", ".jsx", ".tsx"] },
  { regex: /\.\s*carousel\s*\(\s*[{'"]/g, library: "bootstrap", apiName: ".carousel() jQuery plugin", changeType: "changed", fix: "Replace with new bootstrap.Carousel(el)", autoFixable: false, minTargetMajor: 5, extensions: [".js", ".ts", ".jsx", ".tsx"] },
  { regex: /\.\s*collapse\s*\(\s*[{'"]/g, library: "bootstrap", apiName: ".collapse() jQuery plugin", changeType: "changed", fix: "Replace with new bootstrap.Collapse(el)", autoFixable: false, minTargetMajor: 5, extensions: [".js", ".ts", ".jsx", ".tsx"] },
  { regex: /\.\s*dropdown\s*\(\s*[{'"]/g, library: "bootstrap", apiName: ".dropdown() jQuery plugin", changeType: "changed", fix: "Replace with new bootstrap.Dropdown(el)", autoFixable: false, minTargetMajor: 5, extensions: [".js", ".ts", ".jsx", ".tsx"] },
  { regex: /\.\s*tab\s*\(\s*['"]/g, library: "bootstrap", apiName: ".tab() jQuery plugin", changeType: "changed", fix: "Replace with bootstrap.Tab.getInstance(el)", autoFixable: false, minTargetMajor: 5, extensions: [".js", ".ts", ".jsx", ".tsx"] },
];

const BOOTSTRAP_HTML_PATTERNS: APIPattern[] = [
  // Bootstrap 5 data attribute renames
  { regex: /data-toggle\s*=/g, library: "bootstrap", apiName: "data-toggle", changeType: "renamed", fix: "Rename to data-bs-toggle", autoFixable: true, minTargetMajor: 5, extensions: [".cshtml", ".html", ".htm", ".razor", ".aspx", ".vue", ".jsx", ".tsx", ".hbs", ".ejs", ".pug", ".php", ".erb", ".blade.php", ".twig", ".jsp"] },
  { regex: /data-dismiss\s*=/g, library: "bootstrap", apiName: "data-dismiss", changeType: "renamed", fix: "Rename to data-bs-dismiss", autoFixable: true, minTargetMajor: 5, extensions: [".cshtml", ".html", ".htm", ".razor", ".aspx", ".vue", ".jsx", ".tsx", ".hbs", ".ejs", ".pug", ".php", ".erb", ".blade.php", ".twig", ".jsp"] },
  { regex: /data-target\s*=/g, library: "bootstrap", apiName: "data-target", changeType: "renamed", fix: "Rename to data-bs-target", autoFixable: true, minTargetMajor: 5, extensions: [".cshtml", ".html", ".htm", ".razor", ".aspx", ".vue", ".jsx", ".tsx", ".hbs", ".ejs", ".pug", ".php", ".erb", ".blade.php", ".twig", ".jsp"] },
  { regex: /data-slide\s*=/g, library: "bootstrap", apiName: "data-slide", changeType: "renamed", fix: "Rename to data-bs-slide", autoFixable: true, minTargetMajor: 5, extensions: [".cshtml", ".html", ".htm", ".razor", ".aspx", ".vue", ".jsx", ".tsx"] },
  { regex: /data-ride\s*=/g, library: "bootstrap", apiName: "data-ride", changeType: "renamed", fix: "Rename to data-bs-ride", autoFixable: true, minTargetMajor: 5, extensions: [".cshtml", ".html", ".htm", ".razor", ".aspx", ".vue", ".jsx", ".tsx"] },
  { regex: /data-parent\s*=/g, library: "bootstrap", apiName: "data-parent", changeType: "renamed", fix: "Rename to data-bs-parent", autoFixable: true, minTargetMajor: 5, extensions: [".cshtml", ".html", ".htm", ".razor", ".aspx", ".vue", ".jsx", ".tsx"] },
  { regex: /data-spy\s*=/g, library: "bootstrap", apiName: "data-spy", changeType: "renamed", fix: "Rename to data-bs-spy", autoFixable: true, minTargetMajor: 5, extensions: [".cshtml", ".html", ".htm", ".razor", ".aspx", ".vue", ".jsx", ".tsx"] },
  { regex: /data-offset\s*=/g, library: "bootstrap", apiName: "data-offset", changeType: "renamed", fix: "Rename to data-bs-offset", autoFixable: true, minTargetMajor: 5, extensions: [".cshtml", ".html", ".htm", ".razor", ".aspx", ".vue", ".jsx", ".tsx"] },
];

const BOOTSTRAP_CSS_PATTERNS: APIPattern[] = [
  { regex: /\bml-(\d+)\b/g, library: "bootstrap", apiName: "ml-* class", changeType: "renamed", fix: "Rename to ms-* (margin-start)", autoFixable: true, minTargetMajor: 5 },
  { regex: /\bmr-(\d+)\b/g, library: "bootstrap", apiName: "mr-* class", changeType: "renamed", fix: "Rename to me-* (margin-end)", autoFixable: true, minTargetMajor: 5 },
  { regex: /\bpl-(\d+)\b/g, library: "bootstrap", apiName: "pl-* class", changeType: "renamed", fix: "Rename to ps-* (padding-start)", autoFixable: true, minTargetMajor: 5 },
  { regex: /\bpr-(\d+)\b/g, library: "bootstrap", apiName: "pr-* class", changeType: "renamed", fix: "Rename to pe-* (padding-end)", autoFixable: true, minTargetMajor: 5 },
  { regex: /\bfloat-left\b/g, library: "bootstrap", apiName: "float-left", changeType: "renamed", fix: "Rename to float-start", autoFixable: true, minTargetMajor: 5 },
  { regex: /\bfloat-right\b/g, library: "bootstrap", apiName: "float-right", changeType: "renamed", fix: "Rename to float-end", autoFixable: true, minTargetMajor: 5 },
  { regex: /\btext-left\b/g, library: "bootstrap", apiName: "text-left", changeType: "renamed", fix: "Rename to text-start", autoFixable: true, minTargetMajor: 5 },
  { regex: /\btext-right\b/g, library: "bootstrap", apiName: "text-right", changeType: "renamed", fix: "Rename to text-end", autoFixable: true, minTargetMajor: 5 },
];

const FONTAWESOME_PATTERNS: APIPattern[] = [
  { regex: /\bfa\s+fa-/g, library: "fontawesome", apiName: "fa fa-* class", changeType: "renamed", fix: "Rename to fa-solid fa-*", autoFixable: true, minTargetMajor: 6, extensions: [".cshtml", ".html", ".htm", ".razor", ".vue", ".jsx", ".tsx", ".js", ".ts", ".css", ".scss"] },
  { regex: /\bfas\s+fa-/g, library: "fontawesome", apiName: "fas fa-* class", changeType: "renamed", fix: "Rename to fa-solid fa-*", autoFixable: true, minTargetMajor: 6 },
  { regex: /\bfar\s+fa-/g, library: "fontawesome", apiName: "far fa-* class", changeType: "renamed", fix: "Rename to fa-regular fa-*", autoFixable: true, minTargetMajor: 6 },
  { regex: /\bfab\s+fa-/g, library: "fontawesome", apiName: "fab fa-* class", changeType: "renamed", fix: "Rename to fa-brands fa-*", autoFixable: true, minTargetMajor: 6 },
  { regex: /\bfal\s+fa-/g, library: "fontawesome", apiName: "fal fa-* class", changeType: "renamed", fix: "Rename to fa-light fa-*", autoFixable: true, minTargetMajor: 6 },
  { regex: /\bfa-times\b/g, library: "fontawesome", apiName: "fa-times icon", changeType: "renamed", fix: "Rename to fa-xmark", autoFixable: true, minTargetMajor: 6 },
  { regex: /\bfa-window-close\b/g, library: "fontawesome", apiName: "fa-window-close icon", changeType: "renamed", fix: "Rename to fa-rectangle-xmark", autoFixable: true, minTargetMajor: 6 },
  { regex: /\bfa-check-circle\b/g, library: "fontawesome", apiName: "fa-check-circle icon", changeType: "renamed", fix: "Rename to fa-circle-check", autoFixable: true, minTargetMajor: 6 },
  { regex: /\bfa-exclamation-triangle\b/g, library: "fontawesome", apiName: "fa-exclamation-triangle icon", changeType: "renamed", fix: "Rename to fa-triangle-exclamation", autoFixable: true, minTargetMajor: 6 },
  { regex: /\bfa-exclamation-circle\b/g, library: "fontawesome", apiName: "fa-exclamation-circle icon", changeType: "renamed", fix: "Rename to fa-circle-exclamation", autoFixable: true, minTargetMajor: 6 },
  { regex: /\bfa-info-circle\b/g, library: "fontawesome", apiName: "fa-info-circle icon", changeType: "renamed", fix: "Rename to fa-circle-info", autoFixable: true, minTargetMajor: 6 },
  { regex: /\bfa-question-circle\b/g, library: "fontawesome", apiName: "fa-question-circle icon", changeType: "renamed", fix: "Rename to fa-circle-question", autoFixable: true, minTargetMajor: 6 },
  { regex: /\bfa-arrow-circle-right\b/g, library: "fontawesome", apiName: "fa-arrow-circle-right icon", changeType: "renamed", fix: "Rename to fa-circle-arrow-right", autoFixable: true, minTargetMajor: 6 },
  { regex: /\bfa-arrow-circle-left\b/g, library: "fontawesome", apiName: "fa-arrow-circle-left icon", changeType: "renamed", fix: "Rename to fa-circle-arrow-left", autoFixable: true, minTargetMajor: 6 },
  { regex: /\bfa-external-link\b/g, library: "fontawesome", apiName: "fa-external-link icon", changeType: "renamed", fix: "Rename to fa-arrow-up-right-from-square", autoFixable: true, minTargetMajor: 6 },
];

// React patterns
const REACT_PATTERNS: APIPattern[] = [
  { regex: /ReactDOM\.render\s*\(/g, library: "react", apiName: "ReactDOM.render()", changeType: "removed", fix: "Replace with createRoot().render()", autoFixable: false, minTargetMajor: 18, extensions: [".js", ".jsx", ".ts", ".tsx"] },
  { regex: /ReactDOM\.hydrate\s*\(/g, library: "react", apiName: "ReactDOM.hydrate()", changeType: "removed", fix: "Replace with hydrateRoot()", autoFixable: false, minTargetMajor: 18, extensions: [".js", ".jsx", ".ts", ".tsx"] },
  { regex: /ReactDOM\.unmountComponentAtNode\s*\(/g, library: "react", apiName: "ReactDOM.unmountComponentAtNode()", changeType: "removed", fix: "Replace with root.unmount()", autoFixable: false, minTargetMajor: 18, extensions: [".js", ".jsx", ".ts", ".tsx"] },
];

// Angular patterns
const ANGULAR_PATTERNS: APIPattern[] = [
  { regex: /entryComponents\s*:/g, library: "angular", apiName: "entryComponents", changeType: "removed", fix: "Remove entryComponents — no longer needed in Angular 13+", autoFixable: true, minTargetMajor: 13, extensions: [".ts"] },
  { regex: /ViewEncapsulation\.Native/g, library: "angular", apiName: "ViewEncapsulation.Native", changeType: "removed", fix: "Replace with ViewEncapsulation.ShadowDom", autoFixable: true, minTargetMajor: 11, extensions: [".ts"] },
];

// Django patterns
const DJANGO_PATTERNS: APIPattern[] = [
  { regex: /\bfrom django\.conf\.urls import url\b/g, library: "django", apiName: "url() import", changeType: "removed", fix: "Replace with from django.urls import path, re_path", autoFixable: true, minTargetMajor: 4, extensions: [".py"] },
  { regex: /\burl\s*\(\s*r['"]/g, library: "django", apiName: "url() function", changeType: "removed", fix: "Replace with re_path() or path()", autoFixable: false, minTargetMajor: 4, extensions: [".py"] },
  { regex: /\bMIDDLEWARE_CLASSES\b/g, library: "django", apiName: "MIDDLEWARE_CLASSES", changeType: "renamed", fix: "Rename to MIDDLEWARE", autoFixable: true, minTargetMajor: 2, extensions: [".py"] },
  { regex: /\bDEFAULT_AUTO_FIELD\b/g, library: "django", apiName: "DEFAULT_AUTO_FIELD", changeType: "changed", fix: "Ensure DEFAULT_AUTO_FIELD is set in settings.py for Django 3.2+", autoFixable: false, minTargetMajor: 4, extensions: [".py"] },
];

// Spring Boot patterns
const SPRING_PATTERNS: APIPattern[] = [
  { regex: /import\s+javax\.\w+/g, library: "spring", apiName: "javax.* import", changeType: "renamed", fix: "Replace javax.* with jakarta.*", autoFixable: true, minTargetMajor: 3, extensions: [".java", ".kt"] },
  { regex: /@EnableWebSecurity/g, library: "spring", apiName: "@EnableWebSecurity", changeType: "changed", fix: "Review — Spring Security config has changed in Spring Boot 3", autoFixable: false, minTargetMajor: 3, extensions: [".java", ".kt"] },
];

const ALL_PATTERNS: APIPattern[] = [
  ...JQUERY_PATTERNS,
  ...BOOTSTRAP_JS_PATTERNS,
  ...BOOTSTRAP_HTML_PATTERNS,
  ...BOOTSTRAP_CSS_PATTERNS,
  ...FONTAWESOME_PATTERNS,
  ...REACT_PATTERNS,
  ...ANGULAR_PATTERNS,
  ...DJANGO_PATTERNS,
  ...SPRING_PATTERNS,
];

// ═══════════════════════════════════════════════════════════════
// Library name normalization
// ═══════════════════════════════════════════════════════════════

const LIBRARY_ALIASES: Record<string, string[]> = {
  jquery: ["jquery", "jquery-slim"],
  bootstrap: ["bootstrap", "twitter-bootstrap"],
  fontawesome: ["font-awesome", "@fortawesome/fontawesome-free", "fontawesome", "fontawesome-free"],
  react: ["react", "react-dom"],
  angular: ["@angular/core", "angular"],
  django: ["django"],
  spring: ["spring-boot", "org.springframework.boot"],
  vue: ["vue"],
};

function normalizeLibraryName(name: string): string {
  const lower = name.toLowerCase();
  for (const [canonical, aliases] of Object.entries(LIBRARY_ALIASES)) {
    if (aliases.some(a => lower.includes(a))) return canonical;
  }
  return lower;
}

// ═══════════════════════════════════════════════════════════════
// Scannable file extensions
// ═══════════════════════════════════════════════════════════════

const CODE_EXTENSIONS = new Set([
  ".js", ".ts", ".jsx", ".tsx", ".mjs", ".cjs",
  ".cs", ".java", ".kt", ".py", ".go", ".rb", ".php",
  ".cshtml", ".html", ".htm", ".razor", ".aspx", ".ascx",
  ".vue", ".svelte", ".hbs", ".ejs", ".pug", ".erb",
  ".blade.php", ".twig", ".jsp", ".jinja2", ".mustache",
  ".css", ".scss", ".less", ".sass",
]);

const VENDOR_PATH_SEGMENTS = new Set([
  "node_modules", "vendor", "bower_components", "packages",
  "dist", "build", "min", ".min.",
]);

function isVendorFile(filePath: string): boolean {
  const lower = filePath.toLowerCase().replace(/\\/g, "/");
  // Allow files in wwwroot/js/ and similar app code dirs
  // but skip node_modules, vendor dirs, and known library files
  for (const seg of VENDOR_PATH_SEGMENTS) {
    if (lower.includes(`/${seg}/`) || lower.includes(`\\${seg}\\`)) return true;
  }
  // Skip the bundled base-library files (they're vendor code)
  if (lower.includes("base-library.")) return true;
  return false;
}

// ═══════════════════════════════════════════════════════════════
// Main scan function
// ═══════════════════════════════════════════════════════════════

/**
 * Scan all application code files for API usage patterns that will break
 * during the specified library upgrades.
 */
export function scanAPIUsage(
  files: ExtractedFile[],
  selections: VersionSelection[],
): APIUsageMatch[] {
  // Determine which libraries are being upgraded and their target major versions
  const activeUpgrades = new Map<string, number>(); // canonical name → target major
  for (const sel of selections) {
    const canonical = normalizeLibraryName(sel.package);
    const targetMajor = parseInt(sel.selectedVersion.split(".")[0], 10);
    if (!isNaN(targetMajor)) {
      const existing = activeUpgrades.get(canonical);
      if (!existing || targetMajor > existing) {
        activeUpgrades.set(canonical, targetMajor);
      }
    }
  }

  if (activeUpgrades.size === 0) return [];

  // Filter patterns to only those relevant to active upgrades
  const activePatterns = ALL_PATTERNS.filter(p => {
    const targetMajor = activeUpgrades.get(normalizeLibraryName(p.library));
    return targetMajor != null && targetMajor >= p.minTargetMajor;
  });

  if (activePatterns.length === 0) return [];

  const matches: APIUsageMatch[] = [];

  for (const file of files) {
    const ext = file.relativePath.substring(file.relativePath.lastIndexOf(".")).toLowerCase();
    if (!CODE_EXTENSIONS.has(ext)) continue;
    if (isVendorFile(file.relativePath)) continue;
    if (!file.content || file.content.length < 10) continue;

    const lines = file.content.split("\n");

    for (const pattern of activePatterns) {
      // Check extension filter
      if (pattern.extensions && pattern.extensions.length > 0) {
        if (!pattern.extensions.includes(ext)) continue;
      }

      // Reset regex lastIndex for global patterns
      pattern.regex.lastIndex = 0;

      // Scan line by line for precise line numbers
      for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
        const line = lines[lineIdx];
        pattern.regex.lastIndex = 0;
        let match: RegExpExecArray | null;
        while ((match = pattern.regex.exec(line)) !== null) {
          matches.push({
            file: file.relativePath,
            line: lineIdx + 1,
            column: match.index + 1,
            matchedText: match[0],
            library: pattern.library,
            apiName: pattern.apiName,
            changeType: pattern.changeType,
            fix: pattern.fix,
            autoFixable: pattern.autoFixable,
          });
        }
      }
    }
  }

  return matches;
}

/**
 * Build a file impact report by cross-referencing API usage matches
 * with the user's version selections.
 */
export function buildFileImpactReport(
  files: ExtractedFile[],
  selections: VersionSelection[],
): FileImpactReport {
  const matches = scanAPIUsage(files, selections);

  const selectionMap = new Map<string, VersionSelection>();
  for (const sel of selections) {
    const canonical = normalizeLibraryName(sel.package);
    selectionMap.set(canonical, sel);
  }

  const items: FileImpactItem[] = matches.map(m => {
    const sel = selectionMap.get(normalizeLibraryName(m.library));
    return {
      file: m.file,
      line: m.line,
      apiName: m.apiName,
      library: m.library,
      currentVersion: sel?.currentVersion ?? "unknown",
      targetVersion: sel?.selectedVersion ?? "unknown",
      changeType: m.changeType,
      fix: m.fix,
      autoFixable: m.autoFixable,
    };
  });

  const byLibrary: Record<string, number> = {};
  const byFile: Record<string, number> = {};
  for (const item of items) {
    byLibrary[item.library] = (byLibrary[item.library] ?? 0) + 1;
    byFile[item.file] = (byFile[item.file] ?? 0) + 1;
  }

  return {
    totalImpactedFiles: Object.keys(byFile).length,
    totalImpactItems: items.length,
    items,
    byLibrary,
    byFile,
  };
}

/**
 * Format the impact report as markdown text suitable for LLM prompt injection.
 */
export function formatImpactForPrompt(report: FileImpactReport, maxItems: number = 50): string {
  if (report.totalImpactItems === 0) return "";

  const lines: string[] = [
    `\n## Breaking API Usage Detected (${report.totalImpactItems} items in ${report.totalImpactedFiles} files)\n`,
  ];

  // Group by file
  const byFile = new Map<string, FileImpactItem[]>();
  for (const item of report.items.slice(0, maxItems)) {
    if (!byFile.has(item.file)) byFile.set(item.file, []);
    byFile.get(item.file)!.push(item);
  }

  for (const [file, items] of byFile) {
    lines.push(`### ${file}`);
    for (const item of items) {
      lines.push(`- Line ${item.line}: \`${item.apiName}\` (${item.changeType}) → ${item.fix}`);
    }
    lines.push("");
  }

  if (report.totalImpactItems > maxItems) {
    lines.push(`... and ${report.totalImpactItems - maxItems} more items (truncated)`);
  }

  return lines.join("\n");
}
