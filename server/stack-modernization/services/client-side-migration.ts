/**
 * Client-Side Library Migration Engine
 *
 * Applies DETERMINISTIC, rule-based transformations for client-side library upgrades.
 * This runs as a post-processing step after the LLM code upgrade to catch any
 * transformations the LLM missed. It handles:
 *   - HTML attribute changes (e.g., data-toggle → data-bs-toggle for Bootstrap 5)
 *   - CSS class name changes (e.g., ml-3 → ms-3 for Bootstrap 5)
 *   - Manifest file pinning (libman.json, package.json version bumps)
 *   - Known pattern replacements across template/view files
 *
 * The engine is generic: transformation rules are defined per-library and only
 * activated when the user's version selections indicate a relevant major upgrade.
 */

import type { VersionSelection } from "../types";

// ═══════════════════════════════════════════════════════════════
// TRANSFORMATION RULE TYPES
// ═══════════════════════════════════════════════════════════════

interface AttributeRule {
  from: string;
  to: string;
}

interface ClassRule {
  /** Regex pattern matching inside class="" attributes */
  pattern: RegExp;
  replacement: string;
}

interface PatternRule {
  /** Regex pattern applied to full file content */
  pattern: RegExp;
  replacement: string;
  /** Optional: only apply to files matching this extension set */
  extensions?: string[];
}

interface LibraryMigrationRules {
  /** Library identifier (lowercase) */
  library: string;
  /** Minimum source major version this applies FROM */
  fromMajor: number;
  /** Minimum target major version this applies TO */
  toMajor: number;
  /** HTML attribute transformations */
  attributes: AttributeRule[];
  /** CSS class name transformations */
  classes: ClassRule[];
  /** Full-content pattern transformations */
  patterns: PatternRule[];
  /** File extensions this library's rules apply to */
  targetExtensions: string[];
}

// ═══════════════════════════════════════════════════════════════
// MIGRATION RULE DEFINITIONS
// ═══════════════════════════════════════════════════════════════

const BOOTSTRAP_4_TO_5: LibraryMigrationRules = {
  library: "bootstrap",
  fromMajor: 3,
  toMajor: 5,
  targetExtensions: [".html", ".cshtml", ".razor", ".vue", ".jsx", ".tsx", ".hbs", ".ejs", ".pug", ".php", ".erb", ".twig", ".blade.php", ".htm", ".aspx", ".master"],
  attributes: [
    { from: "data-toggle", to: "data-bs-toggle" },
    { from: "data-target", to: "data-bs-target" },
    { from: "data-dismiss", to: "data-bs-dismiss" },
    { from: "data-ride", to: "data-bs-ride" },
    { from: "data-slide", to: "data-bs-slide" },
    { from: "data-slide-to", to: "data-bs-slide-to" },
    { from: "data-spy", to: "data-bs-spy" },
    { from: "data-offset", to: "data-bs-offset" },
    { from: "data-parent", to: "data-bs-parent" },
    { from: "data-content", to: "data-bs-content" },
    { from: "data-trigger", to: "data-bs-trigger" },
    { from: "data-placement", to: "data-bs-placement" },
    { from: "data-backdrop", to: "data-bs-backdrop" },
    { from: "data-keyboard", to: "data-bs-keyboard" },
    { from: "data-interval", to: "data-bs-interval" },
    { from: "data-wrap", to: "data-bs-wrap" },
    { from: "data-touch", to: "data-bs-touch" },
  ],
  classes: [
    // Margin/padding direction renames
    { pattern: /\bml-(\d+)\b/g, replacement: "ms-$1" },
    { pattern: /\bmr-(\d+)\b/g, replacement: "me-$1" },
    { pattern: /\bpl-(\d+)\b/g, replacement: "ps-$1" },
    { pattern: /\bpr-(\d+)\b/g, replacement: "pe-$1" },
    // Float utilities
    { pattern: /\bfloat-left\b/g, replacement: "float-start" },
    { pattern: /\bfloat-right\b/g, replacement: "float-end" },
    // Text alignment
    { pattern: /\btext-left\b/g, replacement: "text-start" },
    { pattern: /\btext-right\b/g, replacement: "text-end" },
    // Border utilities
    { pattern: /\bborder-left\b/g, replacement: "border-start" },
    { pattern: /\bborder-right\b/g, replacement: "border-end" },
    // Rounded utilities
    { pattern: /\brounded-left\b/g, replacement: "rounded-start" },
    { pattern: /\brounded-right\b/g, replacement: "rounded-end" },
    // Form changes (BS4 → BS5)
    { pattern: /\bform-group\b/g, replacement: "mb-3" },
    { pattern: /\bform-row\b/g, replacement: "row g-3" },
    { pattern: /\bform-inline\b/g, replacement: "d-flex align-items-center" },
    { pattern: /\bcustom-control\b/g, replacement: "form-check" },
    { pattern: /\bcustom-control-input\b/g, replacement: "form-check-input" },
    { pattern: /\bcustom-control-label\b/g, replacement: "form-check-label" },
    { pattern: /\bcustom-select\b/g, replacement: "form-select" },
    { pattern: /\bcustom-file\b/g, replacement: "form-control" },
    { pattern: /\bcustom-range\b/g, replacement: "form-range" },
    { pattern: /\bcustom-switch\b/g, replacement: "form-check form-switch" },
    // Input group changes
    { pattern: /\binput-group-append\b/g, replacement: "" },
    { pattern: /\binput-group-prepend\b/g, replacement: "" },
    // Badge changes
    { pattern: /\bbadge-primary\b/g, replacement: "bg-primary" },
    { pattern: /\bbadge-secondary\b/g, replacement: "bg-secondary" },
    { pattern: /\bbadge-success\b/g, replacement: "bg-success" },
    { pattern: /\bbadge-danger\b/g, replacement: "bg-danger" },
    { pattern: /\bbadge-warning\b/g, replacement: "bg-warning text-dark" },
    { pattern: /\bbadge-info\b/g, replacement: "bg-info" },
    { pattern: /\bbadge-light\b/g, replacement: "bg-light text-dark" },
    { pattern: /\bbadge-dark\b/g, replacement: "bg-dark" },
    // Close button
    { pattern: /\bclose\b(?=["'\s>])/g, replacement: "btn-close" },
    // Jumbotron removed
    { pattern: /\bjumbotron\b/g, replacement: "bg-light p-5 rounded-3" },
    // Media object removed
    { pattern: /\bmedia\b/g, replacement: "d-flex" },
    { pattern: /\bmedia-body\b/g, replacement: "flex-grow-1 ms-3" },
    // Screenreader utilities renamed
    { pattern: /\bsr-only\b/g, replacement: "visually-hidden" },
    { pattern: /\bsr-only-focusable\b/g, replacement: "visually-hidden-focusable" },
    // Font weight
    { pattern: /\bfont-weight-bold\b/g, replacement: "fw-bold" },
    { pattern: /\bfont-weight-bolder\b/g, replacement: "fw-bolder" },
    { pattern: /\bfont-weight-normal\b/g, replacement: "fw-normal" },
    { pattern: /\bfont-weight-light\b/g, replacement: "fw-light" },
    { pattern: /\bfont-weight-lighter\b/g, replacement: "fw-lighter" },
    { pattern: /\bfont-italic\b/g, replacement: "fst-italic" },
    // No gutters → g-0
    { pattern: /\bno-gutters\b/g, replacement: "g-0" },
    // Badge pill → rounded-pill
    { pattern: /\bbadge-pill\b/g, replacement: "rounded-pill" },
    // Embed responsive
    { pattern: /\bembed-responsive\b/g, replacement: "ratio" },
    { pattern: /\bembed-responsive-16by9\b/g, replacement: "ratio-16x9" },
    { pattern: /\bembed-responsive-4by3\b/g, replacement: "ratio-4x3" },
    { pattern: /\bembed-responsive-item\b/g, replacement: "" },
  ],
  patterns: [
    // Remove empty wrapper divs left behind by input-group-append/prepend removal
    {
      pattern: /<div\s+class="\s*"\s*>/g,
      replacement: "",
      extensions: [".html", ".cshtml", ".razor", ".hbs"],
    },
    // jQuery-style Bootstrap JS initialization (BS4 used jQuery, BS5 uses vanilla JS)
    {
      pattern: /\$\(\s*['"]([^'"]+)['"]\s*\)\.tooltip\(\)/g,
      replacement: `document.querySelectorAll('$1').forEach(el => new bootstrap.Tooltip(el))`,
      extensions: [".js", ".ts", ".html", ".cshtml"],
    },
    {
      pattern: /\$\(\s*['"]([^'"]+)['"]\s*\)\.popover\(\)/g,
      replacement: `document.querySelectorAll('$1').forEach(el => new bootstrap.Popover(el))`,
      extensions: [".js", ".ts", ".html", ".cshtml"],
    },
  ],
};

const FONT_AWESOME_5_TO_6: LibraryMigrationRules = {
  library: "font-awesome",
  fromMajor: 4,
  toMajor: 6,
  targetExtensions: [".html", ".cshtml", ".razor", ".vue", ".jsx", ".tsx", ".hbs", ".ejs", ".pug", ".php", ".erb", ".twig", ".blade.php", ".htm", ".js", ".ts", ".css", ".scss", ".aspx", ".master"],
  attributes: [],
  classes: [
    // Prefix style renames
    { pattern: /\bfa\s+fa-/g, replacement: "fa-solid fa-" },
    { pattern: /\bfas\s+fa-/g, replacement: "fa-solid fa-" },
    { pattern: /\bfar\s+fa-/g, replacement: "fa-regular fa-" },
    { pattern: /\bfab\s+fa-/g, replacement: "fa-brands fa-" },
    { pattern: /\bfal\s+fa-/g, replacement: "fa-light fa-" },
    // Renamed icons
    { pattern: /\bfa-times\b/g, replacement: "fa-xmark" },
    { pattern: /\bfa-window-close\b/g, replacement: "fa-rectangle-xmark" },
    { pattern: /\bfa-check-circle\b/g, replacement: "fa-circle-check" },
    { pattern: /\bfa-exclamation-triangle\b/g, replacement: "fa-triangle-exclamation" },
    { pattern: /\bfa-exclamation-circle\b/g, replacement: "fa-circle-exclamation" },
    { pattern: /\bfa-info-circle\b/g, replacement: "fa-circle-info" },
    { pattern: /\bfa-question-circle\b/g, replacement: "fa-circle-question" },
    { pattern: /\bfa-arrow-circle-right\b/g, replacement: "fa-circle-arrow-right" },
    { pattern: /\bfa-arrow-circle-left\b/g, replacement: "fa-circle-arrow-left" },
    { pattern: /\bfa-external-link\b/g, replacement: "fa-arrow-up-right-from-square" },
    { pattern: /\bfa-cog\b/g, replacement: "fa-gear" },
    { pattern: /\bfa-cogs\b/g, replacement: "fa-gears" },
    { pattern: /\bfa-edit\b/g, replacement: "fa-pen-to-square" },
    { pattern: /\bfa-trash-alt\b/g, replacement: "fa-trash-can" },
    { pattern: /\bfa-check-square-o\b/g, replacement: "fa-square-check" },
    { pattern: /\bfa-check-square\b/g, replacement: "fa-square-check" },
    { pattern: /\bfa-plus-square\b/g, replacement: "fa-square-plus" },
    { pattern: /\bfa-minus-square\b/g, replacement: "fa-square-minus" },
    { pattern: /\bfa-calendar-alt\b/g, replacement: "fa-calendar-days" },
    { pattern: /\bfa-save\b/g, replacement: "fa-floppy-disk" },
    { pattern: /\bfa-clipboard-list\b/g, replacement: "fa-clipboard-list" },
    { pattern: /\bfa-sign-out-alt\b/g, replacement: "fa-right-from-bracket" },
    { pattern: /\bfa-sign-in-alt\b/g, replacement: "fa-right-to-bracket" },
    { pattern: /\bfa-user-circle\b/g, replacement: "fa-circle-user" },
    { pattern: /\bfa-times-circle\b/g, replacement: "fa-circle-xmark" },
    { pattern: /\bfa-arrow-circle-up\b/g, replacement: "fa-circle-arrow-up" },
    { pattern: /\bfa-arrow-circle-down\b/g, replacement: "fa-circle-arrow-down" },
    { pattern: /\bfa-file-alt\b/g, replacement: "fa-file-lines" },
    { pattern: /\bfa-sort-amount-down\b/g, replacement: "fa-sort-amount-desc" },
    { pattern: /\bfa-exchange-alt\b/g, replacement: "fa-right-left" },
    { pattern: /\bfa-step-forward\b/g, replacement: "fa-forward-step" },
    { pattern: /\bfa-step-backward\b/g, replacement: "fa-backward-step" },
    { pattern: /\bfa-ban\b/g, replacement: "fa-ban" },
    { pattern: /\bfa-tachometer-alt\b/g, replacement: "fa-gauge-high" },
    { pattern: /\bfa-address-card\b/g, replacement: "fa-address-card" },
    { pattern: /\bfa-comment-alt\b/g, replacement: "fa-message" },
    { pattern: /\bfa-comments-alt\b/g, replacement: "fa-messages" },
  ],
  patterns: [],
};

const JQUERY_3_TO_4: LibraryMigrationRules = {
  library: "jquery",
  fromMajor: 1,
  toMajor: 4,
  targetExtensions: [".js", ".ts", ".jsx", ".tsx", ".html", ".cshtml", ".razor", ".htm", ".aspx", ".master"],
  attributes: [],
  classes: [],
  patterns: [
    // Remove jQuery.support.cors = true lines
    { pattern: /^\s*jQuery\.support\.cors\s*=\s*true;?\s*$/gm, replacement: "/* jQuery.support.cors removed in jQuery 4 */", extensions: [".js", ".ts"] },
    { pattern: /^\s*\$\.support\.cors\s*=\s*true;?\s*$/gm, replacement: "/* $.support.cors removed in jQuery 4 */", extensions: [".js", ".ts"] },
    // $.isArray → Array.isArray
    { pattern: /\$\.isArray\s*\(/g, replacement: "Array.isArray(", extensions: [".js", ".ts"] },
    { pattern: /jQuery\.isArray\s*\(/g, replacement: "Array.isArray(", extensions: [".js", ".ts"] },
    // $.parseJSON → JSON.parse
    { pattern: /\$\.parseJSON\s*\(/g, replacement: "JSON.parse(", extensions: [".js", ".ts"] },
    { pattern: /jQuery\.parseJSON\s*\(/g, replacement: "JSON.parse(", extensions: [".js", ".ts"] },
    // $.trim → native trim
    { pattern: /\$\.trim\s*\(/g, replacement: "String.prototype.trim.call(", extensions: [".js", ".ts"] },
    // $.now() → Date.now()
    { pattern: /\$\.now\s*\(\s*\)/g, replacement: "Date.now()", extensions: [".js", ".ts"] },
    { pattern: /jQuery\.now\s*\(\s*\)/g, replacement: "Date.now()", extensions: [".js", ".ts"] },
    // .bind() → .on()
    { pattern: /\.bind\s*\(\s*(['"`])/g, replacement: ".on($1", extensions: [".js", ".ts"] },
    // .unbind() → .off()
    { pattern: /\.unbind\s*\(/g, replacement: ".off(", extensions: [".js", ".ts"] },
    // .delegate() → .on()
    { pattern: /\.delegate\s*\(/g, replacement: ".on(", extensions: [".js", ".ts"] },
    // .undelegate() → .off()
    { pattern: /\.undelegate\s*\(/g, replacement: ".off(", extensions: [".js", ".ts"] },
    // .size() → .length
    { pattern: /\.size\s*\(\s*\)/g, replacement: ".length", extensions: [".js", ".ts"] },
    // $.type() → typeof (removed in jQuery 4)
    { pattern: /\$\.type\s*\(/g, replacement: "typeof(", extensions: [".js", ".ts"] },
    { pattern: /jQuery\.type\s*\(/g, replacement: "typeof(", extensions: [".js", ".ts"] },
    // $.isFunction() → typeof fn === 'function'
    { pattern: /\$\.isFunction\s*\(\s*(\w+)\s*\)/g, replacement: "typeof $1 === 'function'", extensions: [".js", ".ts"] },
    { pattern: /jQuery\.isFunction\s*\(\s*(\w+)\s*\)/g, replacement: "typeof $1 === 'function'", extensions: [".js", ".ts"] },
    // $.isWindow() — removed in jQuery 4 with no replacement
    { pattern: /\$\.isWindow\s*\([^)]*\)/g, replacement: "/* $.isWindow() removed in jQuery 4 — no direct replacement */false", extensions: [".js", ".ts"] },
    { pattern: /jQuery\.isWindow\s*\([^)]*\)/g, replacement: "/* jQuery.isWindow() removed in jQuery 4 — no direct replacement */false", extensions: [".js", ".ts"] },
    // $.camelCase() — removed in jQuery 4
    { pattern: /\$\.camelCase\s*\(/g, replacement: "/* $.camelCase() removed in jQuery 4 */ ((s) => s.replace(/-([a-z])/g, (_, c) => c.toUpperCase()))(", extensions: [".js", ".ts"] },
    { pattern: /jQuery\.camelCase\s*\(/g, replacement: "/* jQuery.camelCase() removed in jQuery 4 */ ((s) => s.replace(/-([a-z])/g, (_, c) => c.toUpperCase()))(", extensions: [".js", ".ts"] },
    // $.isNumeric() → !isNaN(parseFloat()) && isFinite()
    { pattern: /\$\.isNumeric\s*\(\s*(\w+)\s*\)/g, replacement: "(!isNaN(parseFloat($1)) && isFinite($1))", extensions: [".js", ".ts"] },
    { pattern: /jQuery\.isNumeric\s*\(\s*(\w+)\s*\)/g, replacement: "(!isNaN(parseFloat($1)) && isFinite($1))", extensions: [".js", ".ts"] },
  ],
};

// ── React 17 → 18 ──

const REACT_17_TO_18: LibraryMigrationRules = {
  library: "react",
  fromMajor: 16,
  toMajor: 18,
  targetExtensions: [".tsx", ".ts", ".jsx", ".js", ".mjs"],
  attributes: [],
  classes: [],
  patterns: [
    // ReactDOM.render() → createRoot().render()
    // Matches: ReactDOM.render(<App />, document.getElementById('root'))
    {
      pattern: /ReactDOM\.render\s*\(\s*(<[^,]+>)\s*,\s*(document\.getElementById\s*\(\s*['"][^'"]+['"]\s*\))\s*\)/g,
      replacement: `(() => { const root = ReactDOM.createRoot($2); root.render($1); })()`,
      extensions: [".tsx", ".jsx", ".ts", ".js"],
    },
    // Simpler single-line form: ReactDOM.render(element, container)
    {
      pattern: /ReactDOM\.render\s*\(\s*(\w+)\s*,\s*(document\.getElementById\s*\(\s*['"][^'"]+['"]\s*\))\s*\)/g,
      replacement: `(() => { const root = ReactDOM.createRoot($2); root.render($1); })()`,
      extensions: [".tsx", ".jsx", ".ts", ".js"],
    },
    // ReactDOM.hydrate() → hydrateRoot()
    {
      pattern: /ReactDOM\.hydrate\s*\(\s*(<[^,]+>)\s*,\s*(document\.getElementById\s*\(\s*['"][^'"]+['"]\s*\))\s*\)/g,
      replacement: `ReactDOM.hydrateRoot($2, $1)`,
      extensions: [".tsx", ".jsx", ".ts", ".js"],
    },
    // import ReactDOM from 'react-dom' → import ReactDOM from 'react-dom/client' (for files using render/createRoot)
    {
      pattern: /import\s+ReactDOM\s+from\s+['"]react-dom['"]/g,
      replacement: `import ReactDOM from 'react-dom/client'`,
      extensions: [".tsx", ".jsx", ".ts", ".js"],
    },
    // import { render } from 'react-dom' → import { createRoot } from 'react-dom/client'
    {
      pattern: /import\s*\{\s*render\s*\}\s*from\s+['"]react-dom['"]/g,
      replacement: `import { createRoot } from 'react-dom/client'`,
      extensions: [".tsx", ".jsx", ".ts", ".js"],
    },
  ],
};

// ── React Router v5 → v6 ──

const REACT_ROUTER_5_TO_6: LibraryMigrationRules = {
  library: "react-router-dom",
  fromMajor: 5,
  toMajor: 6,
  targetExtensions: [".tsx", ".ts", ".jsx", ".js"],
  attributes: [],
  classes: [],
  patterns: [
    // <Switch> → <Routes>
    { pattern: /<Switch>/g, replacement: "<Routes>", extensions: [".tsx", ".jsx"] },
    { pattern: /<\/Switch>/g, replacement: "</Routes>", extensions: [".tsx", ".jsx"] },
    // import { Switch } from 'react-router-dom' → import { Routes } from 'react-router-dom'
    {
      pattern: /\bSwitch\b/g,
      replacement: "Routes",
      extensions: [".tsx", ".jsx", ".ts", ".js"],
    },
    // <Route component={X} /> → <Route element={<X />} />
    {
      pattern: /<Route\s+component=\{(\w+)\}/g,
      replacement: `<Route element={<$1 />}`,
      extensions: [".tsx", ".jsx"],
    },
    // <Route render={() => <X />} → <Route element={<X />}
    {
      pattern: /<Route\s+render=\{\s*\(\)\s*=>\s*(<[^}]+>)\s*\}/g,
      replacement: `<Route element={$1}`,
      extensions: [".tsx", ".jsx"],
    },
    // useHistory() → useNavigate()
    { pattern: /\buseHistory\b/g, replacement: "useNavigate", extensions: [".tsx", ".jsx", ".ts", ".js"] },
    // history.push('/path') → navigate('/path')
    { pattern: /history\.push\s*\(/g, replacement: "navigate(", extensions: [".tsx", ".jsx", ".ts", ".js"] },
    // history.replace('/path') → navigate('/path', { replace: true })
    {
      pattern: /history\.replace\s*\(\s*(['"][^'"]+['"])\s*\)/g,
      replacement: `navigate($1, { replace: true })`,
      extensions: [".tsx", ".jsx", ".ts", ".js"],
    },
    // history.goBack() → navigate(-1)
    { pattern: /history\.goBack\s*\(\s*\)/g, replacement: "navigate(-1)", extensions: [".tsx", ".jsx", ".ts", ".js"] },
    // <Redirect to="/path" /> → <Navigate to="/path" replace />
    {
      pattern: /<Redirect\s+to=/g,
      replacement: `<Navigate to=`,
      extensions: [".tsx", ".jsx"],
    },
    // import { Redirect } → import { Navigate }
    { pattern: /\bRedirect\b/g, replacement: "Navigate", extensions: [".tsx", ".jsx", ".ts", ".js"] },
  ],
};

const ALL_MIGRATION_RULES: LibraryMigrationRules[] = [
  BOOTSTRAP_4_TO_5,
  FONT_AWESOME_5_TO_6,
  JQUERY_3_TO_4,
  REACT_17_TO_18,
  REACT_ROUTER_5_TO_6,
];

// ═══════════════════════════════════════════════════════════════
// MIGRATION ENGINE
// ═══════════════════════════════════════════════════════════════

/**
 * Detect which migration rules should be applied based on version selections
 * and detected current versions.
 */
/** Map rule library names to possible selection package names */
const RULE_LIBRARY_ALIASES: Record<string, string[]> = {
  "bootstrap": ["bootstrap", "twitter-bootstrap"],
  "font-awesome": ["font-awesome", "fontawesome", "@fortawesome/fontawesome-free", "fontawesome-free"],
  "jquery": ["jquery"],
  "react": ["react", "react-dom"],
  "react-router-dom": ["react-router-dom", "react-router"],
};

function detectApplicableRules(
  selections: VersionSelection[],
  currentVersions?: Record<string, string>
): LibraryMigrationRules[] {
  const applicable: LibraryMigrationRules[] = [];

  for (const rule of ALL_MIGRATION_RULES) {
    for (const sel of selections) {
      const pkg = (sel.package || "").toLowerCase();
      const aliases = RULE_LIBRARY_ALIASES[rule.library] ?? [rule.library];
      if (!aliases.some(a => pkg.includes(a)) && !pkg.includes(rule.library)) continue;

      const targetMajor = parseInt((sel.selectedVersion || "").split(".")[0], 10);
      const currentMajor = parseInt((sel.currentVersion || "").split(".")[0], 10);

      if (isNaN(targetMajor) || targetMajor < rule.toMajor) continue;
      if (!isNaN(currentMajor) && currentMajor >= rule.toMajor) continue;

      applicable.push(rule);
      break;
    }
  }

  return applicable;
}

/**
 * Apply HTML attribute transformations to file content.
 * Uses regex that matches attributes in HTML tags, not inside strings or scripts.
 */
function applyAttributeRules(content: string, rules: AttributeRule[]): string {
  let result = content;
  for (const rule of rules) {
    // Match the attribute name in tag context: preceded by whitespace, followed by = or whitespace
    const pattern = new RegExp(
      `(\\s)${escapeRegex(rule.from)}(\\s*=)`,
      "gi"
    );
    result = result.replace(pattern, `$1${rule.to}$2`);
  }
  return result;
}

/**
 * Apply CSS class name transformations within class="..." attributes and
 * @class directives.
 */
function applyClassRules(content: string, rules: ClassRule[]): string {
  let result = content;

  // Apply within class="..." attributes
  result = result.replace(
    /(class\s*=\s*["'])([^"']*)(["'])/gi,
    (_match, prefix, classValue, suffix) => {
      let updated = classValue;
      for (const rule of rules) {
        updated = updated.replace(rule.pattern, rule.replacement);
      }
      // Clean up double spaces from removed classes
      updated = updated.replace(/\s{2,}/g, " ").trim();
      return `${prefix}${updated}${suffix}`;
    }
  );

  // Also apply to className="..." (JSX/React)
  result = result.replace(
    /(className\s*=\s*["'])([^"']*)(["'])/gi,
    (_match, prefix, classValue, suffix) => {
      let updated = classValue;
      for (const rule of rules) {
        updated = updated.replace(rule.pattern, rule.replacement);
      }
      updated = updated.replace(/\s{2,}/g, " ").trim();
      return `${prefix}${updated}${suffix}`;
    }
  );

  return result;
}

/**
 * Apply full-content pattern rules (e.g., jQuery→vanilla JS).
 */
function applyPatternRules(content: string, rules: PatternRule[], fileExt: string): string {
  let result = content;
  for (const rule of rules) {
    if (rule.extensions && !rule.extensions.some(ext => fileExt.endsWith(ext))) continue;
    result = result.replace(rule.pattern, rule.replacement);
  }
  return result;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function getExtension(filePath: string): string {
  const lower = filePath.toLowerCase();
  // Handle compound extensions like .blade.php
  if (lower.endsWith(".blade.php")) return ".blade.php";
  const lastDot = lower.lastIndexOf(".");
  return lastDot >= 0 ? lower.slice(lastDot) : "";
}

// ═══════════════════════════════════════════════════════════════
// PUBLIC API
// ═══════════════════════════════════════════════════════════════

export interface MigrationResult {
  path: string;
  content: string;
  originalContent: string;
  transformationsApplied: string[];
}

/**
 * Run deterministic client-side library migration on all modified files.
 * Returns updated files with transformations applied + a list of files that were
 * additionally modified by the engine (not by the LLM).
 *
 * @param modifiedFiles - Files already upgraded by the LLM
 * @param allFiles - All extracted files from the repo (to catch files LLM skipped)
 * @param selections - User's version selections
 */
export function applyClientSideMigrations(
  modifiedFiles: Array<{ path: string; content: string; originalContent?: string }>,
  allFiles: Array<{ relativePath: string; content: string }>,
  selections: VersionSelection[]
): { updatedModified: typeof modifiedFiles; newlyModified: MigrationResult[] } {
  let rules = detectApplicableRules(selections);

  // Fallback: if no rules matched from selections (e.g. bundled libs not detected),
  // scan actual file content for patterns that indicate Bootstrap 4, Font Awesome 4, jQuery 3 usage.
  // If found, force-activate the corresponding migration rules.
  if (rules.length === 0) {
    const allContent = [...modifiedFiles.map(f => f.content), ...allFiles.slice(0, 50).map(f => f.content)].join("\n").slice(0, 100000);
    const hasBootstrap4 = /data-toggle=|data-dismiss=|\bml-\d\b|\bmr-\d\b|\bfont-weight-bold\b|\bform-group\b/.test(allContent);
    const hasFA4 = /\bfa\s+fa-/.test(allContent);
    const hasJQuery3 = /jQuery\.support\.cors|\$\.isArray\(|\$\.trim\(|\$\.parseJSON\(/.test(allContent);
    const hasReact17 = /ReactDOM\.render\s*\(|from\s+['"]react-dom['"]/.test(allContent);
    const hasRouterV5 = /<Switch>|useHistory\b|import.*from\s+['"]react-router/.test(allContent);

    if (hasBootstrap4) rules.push(BOOTSTRAP_4_TO_5);
    if (hasFA4) rules.push(FONT_AWESOME_5_TO_6);
    if (hasJQuery3) rules.push(JQUERY_3_TO_4);
    if (hasReact17) rules.push(REACT_17_TO_18);
    if (hasRouterV5) rules.push(REACT_ROUTER_5_TO_6);

    if (rules.length > 0) {
      console.log(`[ClientSideMigration] No rules from selections, but content-based fallback activated: ${rules.map(r => r.library).join(", ")}`);
    }
  }

  if (rules.length === 0) {
    return { updatedModified: modifiedFiles, newlyModified: [] };
  }


  const allTargetExtensions = new Set<string>();
  for (const r of rules) {
    for (const ext of r.targetExtensions) allTargetExtensions.add(ext);
  }

  // Build a set of already-modified paths for quick lookup
  const modifiedPathSet = new Set(modifiedFiles.map(f => f.path.replace(/\\/g, "/")));

  // 1. Apply rules to already-modified files
  const updatedModified = modifiedFiles.map(f => {
    const ext = getExtension(f.path);
    let content = f.content;
    const transforms: string[] = [];

    for (const ruleSet of rules) {
      if (!ruleSet.targetExtensions.some(e => ext.endsWith(e))) continue;

      const before = content;
      content = applyAttributeRules(content, ruleSet.attributes);
      content = applyClassRules(content, ruleSet.classes);
      content = applyPatternRules(content, ruleSet.patterns, ext);

      if (content !== before) {
        transforms.push(`${ruleSet.library}: attribute/class/pattern migration`);
      }
    }

    if (transforms.length > 0) {
    }

    return { ...f, content };
  });

  // 2. Find files the LLM skipped but that need client-side transformations
  const newlyModified: MigrationResult[] = [];

  for (const file of allFiles) {
    const normalized = file.relativePath.replace(/\\/g, "/");
    if (modifiedPathSet.has(normalized)) continue;

    const ext = getExtension(normalized);
    if (!allTargetExtensions.has(ext)) continue;

    let content = file.content;
    const transforms: string[] = [];

    for (const ruleSet of rules) {
      if (!ruleSet.targetExtensions.some(e => ext.endsWith(e))) continue;

      const before = content;
      content = applyAttributeRules(content, ruleSet.attributes);
      content = applyClassRules(content, ruleSet.classes);
      content = applyPatternRules(content, ruleSet.patterns, ext);

      if (content !== before) {
        transforms.push(`${ruleSet.library}: attribute/class/pattern migration`);
      }
    }

    if (transforms.length > 0 && content !== file.content) {
      newlyModified.push({
        path: normalized,
        content,
        originalContent: file.content,
        transformationsApplied: transforms,
      });
    }
  }

  // 3. Manifest version pinning: ensure manifest versions match upgraded markup
  const manifestPinResults = pinManifestVersions(updatedModified, selections, rules);

  // 4. CDN URL version enforcement: update CDN URLs in view/layout files
  const cdnResults = enforceCdnVersions([...updatedModified, ...newlyModified.map(m => ({ path: m.path, content: m.content }))], selections);


  return { updatedModified, newlyModified };
}

// ═══════════════════════════════════════════════════════════════
// MANIFEST VERSION PINNING
// ═══════════════════════════════════════════════════════════════

const LIBRARY_ALIASES: Record<string, string[]> = {
  bootstrap: ["bootstrap", "twitter-bootstrap"],
  jquery: ["jquery"],
  "font-awesome": ["font-awesome", "@fortawesome/fontawesome-free"],
  "popper.js": ["popper.js", "@popperjs/core"],
};

function findTargetVersion(
  library: string,
  selections: VersionSelection[],
): string | null {
  const lower = library.toLowerCase();
  for (const sel of selections) {
    const pkg = (sel.package || "").toLowerCase();
    if (pkg.includes(lower) || lower.includes(pkg)) {
      return sel.selectedVersion || null;
    }
    const aliases = Object.entries(LIBRARY_ALIASES).find(([, alts]) =>
      alts.some(a => lower.includes(a) || a.includes(lower))
    );
    if (aliases && pkg.includes(aliases[0])) {
      return sel.selectedVersion || null;
    }
  }
  return null;
}

/**
 * Pin manifest file versions to match the user's target selections.
 * Handles libman.json, bower.json, and package.json.
 */
function pinManifestVersions(
  files: Array<{ path: string; content: string }>,
  selections: VersionSelection[],
  applicableRules: LibraryMigrationRules[],
): { pinnedCount: number; warnings: string[] } {
  let pinnedCount = 0;
  const warnings: string[] = [];

  for (const file of files) {
    const baseName = file.path.replace(/\\/g, "/").split("/").pop()?.toLowerCase() || "";

    if (baseName === "libman.json" || baseName === "bower.json") {
      try {
        const parsed = JSON.parse(file.content);
        const libs: Array<{ library?: string; destination?: string; files?: string[] }> = parsed.libraries || [];
        let modified = false;

        for (const lib of libs) {
          if (!lib.library) continue;
          const atIndex = lib.library.lastIndexOf("@");
          if (atIndex <= 0) continue;

          const name = lib.library.substring(0, atIndex).toLowerCase();
          const currentVer = lib.library.substring(atIndex + 1);
          const targetVer = findTargetVersion(name, selections);

          if (targetVer && targetVer !== currentVer) {
            lib.library = `${lib.library.substring(0, atIndex)}@${targetVer}`;
            modified = true;
          }
        }

        if (modified) {
          file.content = JSON.stringify(parsed, null, 2);
          pinnedCount++;
        }
      } catch {
        warnings.push(`Failed to parse ${file.path} for version pinning`);
      }
    }

    if (baseName === "package.json") {
      try {
        const parsed = JSON.parse(file.content);
        let modified = false;

        for (const section of ["dependencies", "devDependencies"]) {
          const deps = parsed[section];
          if (!deps || typeof deps !== "object") continue;

          for (const [pkg, ver] of Object.entries(deps)) {
            const targetVer = findTargetVersion(pkg, selections);
            if (!targetVer) continue;

            const currentClean = String(ver).replace(/^[\^~>=<]*/g, "");
            const targetClean = targetVer.replace(/^[\^~>=<]*/g, "");
            if (currentClean === targetClean) continue;

            const prefix = String(ver).match(/^([\^~>=<]*)/)?.[1] || "^";
            deps[pkg] = `${prefix}${targetClean}`;
            modified = true;
          }
        }

        if (modified) {
          file.content = JSON.stringify(parsed, null, 2);
          pinnedCount++;
        }
      } catch {
        warnings.push(`Failed to parse ${file.path} for version pinning`);
      }
    }
  }

  return { pinnedCount, warnings };
}

// ═══════════════════════════════════════════════════════════════
// CDN VERSION ENFORCEMENT
// ═══════════════════════════════════════════════════════════════

/**
 * Enforce CDN URL versions in view/layout files to match user's target selections.
 */
function enforceCdnVersions(
  files: Array<{ path: string; content: string }>,
  selections: VersionSelection[],
): { updatedCount: number } {
  let updatedCount = 0;

  const viewExts = new Set([
    ".cshtml", ".html", ".razor", ".htm", ".aspx", ".master",
    ".jsp", ".erb", ".ejs", ".hbs", ".pug", ".njk", ".twig",
    ".vue", ".svelte", ".astro", ".php",
  ]);

  for (const file of files) {
    const ext = getExtension(file.path);
    if (!viewExts.has(ext)) continue;

    const { updateCdnVersions } = require("./deterministic-transforms");
    const result = updateCdnVersions(file.content, selections);
    if (result.changes.length > 0) {
      file.content = result.content;
      updatedCount += result.changes.length;

      // Remove stale integrity attributes — the SRI hash is no longer valid
      // after the CDN URL version was changed
      file.content = file.content.replace(
        /(<(?:script|link)\b[^>]*?)\s+integrity="[^"]*"/gi,
        "$1"
      );
    }
  }

  return { updatedCount };
}
