/**
 * CSS Class Diff Engine
 *
 * Generates migration rules DYNAMICALLY by comparing old and new CSS files.
 * Instead of maintaining hardcoded lists of class renames (e.g., pr-2 → pe-2),
 * this engine parses the actual downloaded CSS files and produces exact rules.
 *
 * Works for ANY CSS library: Bootstrap, Tailwind, Font Awesome, Material UI, etc.
 */

export interface CssMigrationRule {
  oldClass: string;
  newClass: string;
  library: string;
  confidence: "high" | "medium" | "low";
}

// ═══════════════════════════════════════════════════════════════
// Known rename patterns — used to boost confidence and guide matching
// ═══════════════════════════════════════════════════════════════

const KNOWN_RENAME_PATTERNS: Array<{ oldPrefix: string; newPrefix: string }> = [
  // Bootstrap 4 → 5 directional renames (LTR → logical)
  { oldPrefix: "ml-", newPrefix: "ms-" },
  { oldPrefix: "mr-", newPrefix: "me-" },
  { oldPrefix: "pl-", newPrefix: "ps-" },
  { oldPrefix: "pr-", newPrefix: "pe-" },
  { oldPrefix: "text-left", newPrefix: "text-start" },
  { oldPrefix: "text-right", newPrefix: "text-end" },
  { oldPrefix: "float-left", newPrefix: "float-start" },
  { oldPrefix: "float-right", newPrefix: "float-end" },
  { oldPrefix: "border-left", newPrefix: "border-start" },
  { oldPrefix: "border-right", newPrefix: "border-end" },
  // Bootstrap 4 → 5 utility renames
  { oldPrefix: "font-weight-bold", newPrefix: "fw-bold" },
  { oldPrefix: "font-weight-bolder", newPrefix: "fw-bolder" },
  { oldPrefix: "font-weight-normal", newPrefix: "fw-normal" },
  { oldPrefix: "font-weight-light", newPrefix: "fw-light" },
  { oldPrefix: "font-weight-lighter", newPrefix: "fw-lighter" },
  { oldPrefix: "font-italic", newPrefix: "fst-italic" },
  { oldPrefix: "badge-pill", newPrefix: "rounded-pill" },
  { oldPrefix: "no-gutters", newPrefix: "g-0" },
  { oldPrefix: "sr-only", newPrefix: "visually-hidden" },
  { oldPrefix: "sr-only-focusable", newPrefix: "visually-hidden-focusable" },
  // Bootstrap 4 → 5 component renames
  { oldPrefix: "btn-default", newPrefix: "btn-secondary" },
  { oldPrefix: "badge-primary", newPrefix: "bg-primary" },
  { oldPrefix: "badge-secondary", newPrefix: "bg-secondary" },
  { oldPrefix: "badge-success", newPrefix: "bg-success" },
  { oldPrefix: "badge-danger", newPrefix: "bg-danger" },
  { oldPrefix: "badge-warning", newPrefix: "bg-warning" },
  { oldPrefix: "badge-info", newPrefix: "bg-info" },
  { oldPrefix: "badge-light", newPrefix: "bg-light" },
  { oldPrefix: "badge-dark", newPrefix: "bg-dark" },
  { oldPrefix: "form-group", newPrefix: "mb-3" },
  { oldPrefix: "form-inline", newPrefix: "d-flex" },
  { oldPrefix: "form-row", newPrefix: "row g-3" },
  { oldPrefix: "custom-select", newPrefix: "form-select" },
  { oldPrefix: "custom-range", newPrefix: "form-range" },
  { oldPrefix: "custom-file", newPrefix: "form-control" },
  { oldPrefix: "custom-control-input", newPrefix: "form-check-input" },
  { oldPrefix: "custom-control-label", newPrefix: "form-check-label" },
  { oldPrefix: "custom-checkbox", newPrefix: "form-check" },
  { oldPrefix: "custom-radio", newPrefix: "form-check" },
  { oldPrefix: "custom-switch", newPrefix: "form-check form-switch" },
  { oldPrefix: "input-group-append", newPrefix: "" },
  { oldPrefix: "input-group-prepend", newPrefix: "" },
  { oldPrefix: "input-group-addon", newPrefix: "input-group-text" },
  { oldPrefix: "media", newPrefix: "d-flex" },
  { oldPrefix: "media-body", newPrefix: "flex-grow-1 ms-3" },
  { oldPrefix: "jumbotron", newPrefix: "p-5 mb-4 bg-light rounded-3" },
  // Font Awesome 4/5 → 6
  { oldPrefix: "fa fa-", newPrefix: "fa-solid fa-" },
  { oldPrefix: "far fa-", newPrefix: "fa-regular fa-" },
  { oldPrefix: "fab fa-", newPrefix: "fa-brands fa-" },
];

// ═══════════════════════════════════════════════════════════════
// Core Functions
// ═══════════════════════════════════════════════════════════════

/**
 * Extract all CSS class names from a CSS file.
 * Parses selectors like `.btn-default`, `.pr-2`, `.text-right`
 */
export function extractCssClasses(cssContent: string): Set<string> {
  const classes = new Set<string>();
  // Match .classname in selectors (not inside url(), content:, etc.)
  const re = /\.([a-zA-Z_][\w-]*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(cssContent)) !== null) {
    const cls = m[1];
    // Skip common CSS non-class patterns
    if (cls.length < 2 || cls.length > 60) continue;
    if (/^\d/.test(cls)) continue; // skip .5rem, .25 etc
    classes.add(cls);
  }
  return classes;
}

/**
 * Compare old and new CSS files and generate migration rules dynamically.
 * Uses known rename patterns for high-confidence matches,
 * and string similarity for medium-confidence matches.
 */
export function generateCssMigrationRules(
  oldCss: string,
  newCss: string,
  libraryName: string
): CssMigrationRule[] {
  const oldClasses = extractCssClasses(oldCss);
  const newClasses = extractCssClasses(newCss);

  console.log(`[CssDiffer] ${libraryName}: old has ${oldClasses.size} classes, new has ${newClasses.size} classes`);

  // Find classes removed in the new version
  const removed = [...oldClasses].filter(c => !newClasses.has(c));
  console.log(`[CssDiffer] ${libraryName}: ${removed.length} classes removed in new version`);

  const rules: CssMigrationRule[] = [];
  const matched = new Set<string>();

  // Phase 1: Use KNOWN_RENAME_PATTERNS for high-confidence matches
  for (const rename of KNOWN_RENAME_PATTERNS) {
    for (const old of removed) {
      if (old === rename.oldPrefix || old.startsWith(rename.oldPrefix)) {
        // Exact match or prefix match
        let newClass = rename.newPrefix;
        if (old !== rename.oldPrefix && old.startsWith(rename.oldPrefix)) {
          // Prefix match: "ml-3" → "ms-3" (replace prefix, keep suffix)
          newClass = rename.newPrefix + old.slice(rename.oldPrefix.length);
        }
        // Verify the new class exists in the new CSS (or it's empty = removal)
        if (newClass === "" || newClasses.has(newClass) || newClass.includes(" ")) {
          rules.push({
            oldClass: old,
            newClass,
            library: libraryName,
            confidence: "high",
          });
          matched.add(old);
        }
      }
    }
  }

  // Phase 2: String similarity for remaining removed classes
  for (const old of removed) {
    if (matched.has(old)) continue;

    // Try to find the best match in new classes by Levenshtein-like similarity
    const candidate = findBestMatch(old, newClasses);
    if (candidate) {
      rules.push({
        oldClass: old,
        newClass: candidate,
        library: libraryName,
        confidence: "medium",
      });
    }
  }

  console.log(`[CssDiffer] ${libraryName}: generated ${rules.length} migration rules (${rules.filter(r => r.confidence === "high").length} high, ${rules.filter(r => r.confidence === "medium").length} medium)`);
  return rules;
}

/**
 * Find the best matching class name in a set using string similarity.
 * Only returns a match if the similarity is above threshold.
 */
function findBestMatch(oldClass: string, newClasses: Set<string>): string | null {
  let bestScore = 0;
  let bestMatch: string | null = null;

  for (const nc of newClasses) {
    const score = similarity(oldClass, nc);
    if (score > bestScore && score >= 0.6) {
      bestScore = score;
      bestMatch = nc;
    }
  }

  return bestMatch;
}

/**
 * Simple string similarity (Sørensen–Dice coefficient on bigrams).
 * Returns 0.0 to 1.0 where 1.0 = identical.
 */
function similarity(a: string, b: string): number {
  if (a === b) return 1.0;
  if (a.length < 2 || b.length < 2) return 0;

  const bigramsA = new Set<string>();
  for (let i = 0; i < a.length - 1; i++) bigramsA.add(a.substring(i, i + 2));

  let intersection = 0;
  for (let i = 0; i < b.length - 1; i++) {
    if (bigramsA.has(b.substring(i, i + 2))) intersection++;
  }

  return (2 * intersection) / (a.length - 1 + b.length - 1);
}

/**
 * Filter rules to only include those that are actually used in the codebase.
 * This prevents applying rules for classes that don't appear in any view file.
 */
export function filterRulesByUsage(
  rules: CssMigrationRule[],
  fileContents: string[]
): CssMigrationRule[] {
  const allContent = fileContents.join("\n");
  return rules.filter(r => {
    if (r.confidence === "high") return true; // Always include high-confidence known renames
    // For medium confidence, only include if the old class is actually used in code
    return allContent.includes(r.oldClass);
  });
}

/**
 * Apply CSS migration rules to a file's content.
 * Returns the modified content and count of changes made.
 */
export function applyCssRules(
  content: string,
  rules: CssMigrationRule[]
): { content: string; changeCount: number } {
  let result = content;
  let changeCount = 0;

  for (const rule of rules) {
    if (!rule.oldClass || rule.oldClass.length < 2) continue;
    // Use word boundary matching to avoid partial class name replacements
    const escaped = rule.oldClass.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(`\\b${escaped}\\b`, "g");
    const before = result;
    result = result.replace(regex, rule.newClass);
    if (result !== before) changeCount++;
  }

  return { content: result, changeCount };
}
