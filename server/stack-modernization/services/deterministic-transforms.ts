/**
 * Deterministic Transforms Service
 *
 * Applies known find/replace transformations to file content BEFORE the LLM
 * processes the file. This ensures that simple, well-known breaking changes
 * (data-toggle → data-bs-toggle, $.isArray → Array.isArray, javax → jakarta)
 * are handled deterministically rather than relying on the LLM to follow instructions.
 *
 * Also provides a post-LLM verification pass that checks every impact item
 * was addressed and applies the deterministic fix if the LLM missed it.
 */

import type { ImpactItem, UpgradeImpactReport, FileImpact } from "./pre-upgrade-impact-analyzer";
import type { MigrationDocResult } from "./migration-doc-fetcher";

// ── Transform Rule Interfaces ───────────────────────────────────

export interface TransformRule {
  id: string;
  find: string | RegExp;
  replace: string;
  type: "text" | "regex" | "line-remove";
  stacks: string[];
  description: string;
  /** If true, the rule can be applied safely without LLM context */
  deterministic: boolean;
  /** Package name this rule is tied to (for version lookup in selections) */
  packageName?: string;
  /** Minimum target version required for this rule to apply (semver-like, e.g. "5.0.0") */
  minTargetVersion?: string;
}

export interface TransformResult {
  filePath: string;
  originalContent: string;
  transformedContent: string;
  appliedRules: Array<{ ruleId: string; description: string; count: number }>;
  totalChanges: number;
}

export interface VerificationResult {
  filePath: string;
  missedItems: ImpactItem[];
  autoFixedItems: ImpactItem[];
  content: string;
  wasModified: boolean;
}

// ── Built-in Transform Rules ────────────────────────────────────
// Deterministic rules that are safe to apply without LLM context.

const BUILTIN_TRANSFORM_RULES: TransformRule[] = [
  // ── Bootstrap 4 → 5 ──
  { id: "bs5-data-toggle", find: "data-toggle", replace: "data-bs-toggle", type: "text", stacks: ["bootstrap"], description: "Bootstrap 5: data-toggle → data-bs-toggle", deterministic: true, packageName: "bootstrap", minTargetVersion: "5.0.0" },
  { id: "bs5-data-dismiss", find: "data-dismiss", replace: "data-bs-dismiss", type: "text", stacks: ["bootstrap"], description: "Bootstrap 5: data-dismiss → data-bs-dismiss", deterministic: true, packageName: "bootstrap", minTargetVersion: "5.0.0" },
  { id: "bs5-data-target", find: "data-target", replace: "data-bs-target", type: "text", stacks: ["bootstrap"], description: "Bootstrap 5: data-target → data-bs-target", deterministic: true, packageName: "bootstrap", minTargetVersion: "5.0.0" },
  { id: "bs5-data-ride", find: "data-ride", replace: "data-bs-ride", type: "text", stacks: ["bootstrap"], description: "Bootstrap 5: data-ride → data-bs-ride", deterministic: true, packageName: "bootstrap", minTargetVersion: "5.0.0" },
  { id: "bs5-data-slide", find: "data-slide=", replace: "data-bs-slide=", type: "text", stacks: ["bootstrap"], description: "Bootstrap 5: data-slide → data-bs-slide", deterministic: true, packageName: "bootstrap", minTargetVersion: "5.0.0" },
  { id: "bs5-data-slide-to", find: "data-slide-to", replace: "data-bs-slide-to", type: "text", stacks: ["bootstrap"], description: "Bootstrap 5: data-slide-to → data-bs-slide-to", deterministic: true, packageName: "bootstrap", minTargetVersion: "5.0.0" },
  { id: "bs5-data-parent", find: "data-parent", replace: "data-bs-parent", type: "text", stacks: ["bootstrap"], description: "Bootstrap 5: data-parent → data-bs-parent", deterministic: true, packageName: "bootstrap", minTargetVersion: "5.0.0" },
  { id: "bs5-data-spy", find: "data-spy", replace: "data-bs-spy", type: "text", stacks: ["bootstrap"], description: "Bootstrap 5: data-spy → data-bs-spy", deterministic: true, packageName: "bootstrap", minTargetVersion: "5.0.0" },
  { id: "bs5-data-offset", find: "data-offset", replace: "data-bs-offset", type: "text", stacks: ["bootstrap"], description: "Bootstrap 5: data-offset → data-bs-offset", deterministic: true, packageName: "bootstrap", minTargetVersion: "5.0.0" },
  { id: "bs5-float-left", find: /\bfloat-left\b/g, replace: "float-start", type: "regex", stacks: ["bootstrap"], description: "Bootstrap 5: float-left → float-start", deterministic: true, packageName: "bootstrap", minTargetVersion: "5.0.0" },
  { id: "bs5-float-right", find: /\bfloat-right\b/g, replace: "float-end", type: "regex", stacks: ["bootstrap"], description: "Bootstrap 5: float-right → float-end", deterministic: true, packageName: "bootstrap", minTargetVersion: "5.0.0" },
  { id: "bs5-text-left", find: /\btext-left\b/g, replace: "text-start", type: "regex", stacks: ["bootstrap"], description: "Bootstrap 5: text-left → text-start", deterministic: true, packageName: "bootstrap", minTargetVersion: "5.0.0" },
  { id: "bs5-text-right", find: /\btext-right\b/g, replace: "text-end", type: "regex", stacks: ["bootstrap"], description: "Bootstrap 5: text-right → text-end", deterministic: true, packageName: "bootstrap", minTargetVersion: "5.0.0" },
  { id: "bs5-ml", find: /\bml-(\d+)\b/g, replace: "ms-$1", type: "regex", stacks: ["bootstrap"], description: "Bootstrap 5: ml-* → ms-*", deterministic: true, packageName: "bootstrap", minTargetVersion: "5.0.0" },
  { id: "bs5-mr", find: /\bmr-(\d+)\b/g, replace: "me-$1", type: "regex", stacks: ["bootstrap"], description: "Bootstrap 5: mr-* → me-*", deterministic: true, packageName: "bootstrap", minTargetVersion: "5.0.0" },
  { id: "bs5-pl", find: /\bpl-(\d+)\b/g, replace: "ps-$1", type: "regex", stacks: ["bootstrap"], description: "Bootstrap 5: pl-* → ps-*", deterministic: true, packageName: "bootstrap", minTargetVersion: "5.0.0" },
  { id: "bs5-pr", find: /\bpr-(\d+)\b/g, replace: "pe-$1", type: "regex", stacks: ["bootstrap"], description: "Bootstrap 5: pr-* → pe-*", deterministic: true, packageName: "bootstrap", minTargetVersion: "5.0.0" },
  { id: "bs5-no-gutters", find: /\bno-gutters\b/g, replace: "g-0", type: "regex", stacks: ["bootstrap"], description: "Bootstrap 5: no-gutters → g-0", deterministic: true, packageName: "bootstrap", minTargetVersion: "5.0.0" },
  { id: "bs5-custom-select", find: /\bcustom-select\b/g, replace: "form-select", type: "regex", stacks: ["bootstrap"], description: "Bootstrap 5: custom-select → form-select", deterministic: true, packageName: "bootstrap", minTargetVersion: "5.0.0" },
  { id: "bs5-custom-range", find: /\bcustom-range\b/g, replace: "form-range", type: "regex", stacks: ["bootstrap"], description: "Bootstrap 5: custom-range → form-range", deterministic: true, packageName: "bootstrap", minTargetVersion: "5.0.0" },
  { id: "bs5-custom-file", find: /\bcustom-file\b/g, replace: "form-control", type: "regex", stacks: ["bootstrap"], description: "Bootstrap 5: custom-file → form-control", deterministic: true, packageName: "bootstrap", minTargetVersion: "5.0.0" },
  { id: "bs5-font-weight-bold", find: /\bfont-weight-bold\b/g, replace: "fw-bold", type: "regex", stacks: ["bootstrap"], description: "Bootstrap 5: font-weight-bold → fw-bold", deterministic: true, packageName: "bootstrap", minTargetVersion: "5.0.0" },
  { id: "bs5-font-weight-normal", find: /\bfont-weight-normal\b/g, replace: "fw-normal", type: "regex", stacks: ["bootstrap"], description: "Bootstrap 5: font-weight-normal → fw-normal", deterministic: true, packageName: "bootstrap", minTargetVersion: "5.0.0" },
  { id: "bs5-font-weight-light", find: /\bfont-weight-light\b/g, replace: "fw-light", type: "regex", stacks: ["bootstrap"], description: "Bootstrap 5: font-weight-light → fw-light", deterministic: true, packageName: "bootstrap", minTargetVersion: "5.0.0" },
  { id: "bs5-font-italic", find: /\bfont-italic\b/g, replace: "fst-italic", type: "regex", stacks: ["bootstrap"], description: "Bootstrap 5: font-italic → fst-italic", deterministic: true, packageName: "bootstrap", minTargetVersion: "5.0.0" },

  // ── jQuery 3 → 4 ──
  { id: "jq4-isArray", find: /\$\.isArray\s*\(/g, replace: "Array.isArray(", type: "regex", stacks: ["jquery"], description: "jQuery 4: $.isArray() → Array.isArray()", deterministic: true, packageName: "jquery", minTargetVersion: "4.0.0" },
  { id: "jq4-jQuery-isArray", find: /jQuery\.isArray\s*\(/g, replace: "Array.isArray(", type: "regex", stacks: ["jquery"], description: "jQuery 4: jQuery.isArray() → Array.isArray()", deterministic: true, packageName: "jquery", minTargetVersion: "4.0.0" },
  { id: "jq4-parseJSON", find: /\$\.parseJSON\s*\(/g, replace: "JSON.parse(", type: "regex", stacks: ["jquery"], description: "jQuery 4: $.parseJSON() → JSON.parse()", deterministic: true, packageName: "jquery", minTargetVersion: "4.0.0" },
  { id: "jq4-jQuery-parseJSON", find: /jQuery\.parseJSON\s*\(/g, replace: "JSON.parse(", type: "regex", stacks: ["jquery"], description: "jQuery 4: jQuery.parseJSON() → JSON.parse()", deterministic: true, packageName: "jquery", minTargetVersion: "4.0.0" },
  { id: "jq4-isFunction", find: /\$\.isFunction\s*\(\s*(\w+)\s*\)/g, replace: "typeof $1 === 'function'", type: "regex", stacks: ["jquery"], description: "jQuery 4: $.isFunction(x) → typeof x === 'function'", deterministic: true, packageName: "jquery", minTargetVersion: "4.0.0" },
  { id: "jq4-jQuery-isFunction", find: /jQuery\.isFunction\s*\(\s*(\w+)\s*\)/g, replace: "typeof $1 === 'function'", type: "regex", stacks: ["jquery"], description: "jQuery 4: jQuery.isFunction(x) → typeof x === 'function'", deterministic: true, packageName: "jquery", minTargetVersion: "4.0.0" },
  { id: "jq4-bind", find: /\.bind\s*\(\s*(['"`])/g, replace: ".on($1", type: "regex", stacks: ["jquery"], description: "jQuery 4: .bind() → .on()", deterministic: true, packageName: "jquery", minTargetVersion: "4.0.0" },
  { id: "jq4-unbind", find: /\.unbind\s*\(/g, replace: ".off(", type: "regex", stacks: ["jquery"], description: "jQuery 4: .unbind() → .off()", deterministic: true, packageName: "jquery", minTargetVersion: "4.0.0" },
  { id: "jq4-delegate", find: /\.delegate\s*\(/g, replace: ".on(", type: "regex", stacks: ["jquery"], description: "jQuery 4: .delegate() → .on()", deterministic: true, packageName: "jquery", minTargetVersion: "4.0.0" },
  { id: "jq4-undelegate", find: /\.undelegate\s*\(/g, replace: ".off(", type: "regex", stacks: ["jquery"], description: "jQuery 4: .undelegate() → .off()", deterministic: true, packageName: "jquery", minTargetVersion: "4.0.0" },
  { id: "jq4-uniqueSort", find: /jQuery\.unique\s*\(/g, replace: "jQuery.uniqueSort(", type: "regex", stacks: ["jquery"], description: "jQuery 4: jQuery.unique() → jQuery.uniqueSort()", deterministic: true, packageName: "jquery", minTargetVersion: "4.0.0" },
  { id: "jq4-uniqueSort2", find: /\$\.unique\s*\(/g, replace: "$.uniqueSort(", type: "regex", stacks: ["jquery"], description: "jQuery 4: $.unique() → $.uniqueSort()", deterministic: true, packageName: "jquery", minTargetVersion: "4.0.0" },
  // jQuery.support.cors removal — the line should be deleted entirely
  { id: "jq4-support-cors", find: /^\s*jQuery\.support\.cors\s*=\s*true;?\s*$/gm, replace: "/* jQuery.support.cors removed in jQuery 4 */", type: "regex", stacks: ["jquery"], description: "jQuery 4: jQuery.support.cors removed", deterministic: true, packageName: "jquery", minTargetVersion: "4.0.0" },
  { id: "jq4-support-cors2", find: /^\s*\$\.support\.cors\s*=\s*true;?\s*$/gm, replace: "/* $.support.cors removed in jQuery 4 */", type: "regex", stacks: ["jquery"], description: "jQuery 4: $.support.cors removed", deterministic: true, packageName: "jquery", minTargetVersion: "4.0.0" },
  { id: "jq4-trim", find: /\$\.trim\s*\(/g, replace: "String.prototype.trim.call(", type: "regex", stacks: ["jquery"], description: "jQuery 4: $.trim() → native .trim()", deterministic: true, packageName: "jquery", minTargetVersion: "4.0.0" },
  { id: "jq4-now", find: /\$\.now\s*\(\s*\)/g, replace: "Date.now()", type: "regex", stacks: ["jquery"], description: "jQuery 4: $.now() → Date.now()", deterministic: true, packageName: "jquery", minTargetVersion: "4.0.0" },
  { id: "jq4-jQuery-now", find: /jQuery\.now\s*\(\s*\)/g, replace: "Date.now()", type: "regex", stacks: ["jquery"], description: "jQuery 4: jQuery.now() → Date.now()", deterministic: true, packageName: "jquery", minTargetVersion: "4.0.0" },

  // ── Font Awesome 5 → 6 ──
  { id: "fa6-solid", find: /\bfa\s+fa-/g, replace: "fa-solid fa-", type: "regex", stacks: ["fontawesome", "font-awesome"], description: "Font Awesome 6: fa fa-* → fa-solid fa-*", deterministic: true, packageName: "font-awesome", minTargetVersion: "6.0.0" },
  { id: "fa6-fas", find: /\bfas\s+fa-/g, replace: "fa-solid fa-", type: "regex", stacks: ["fontawesome", "font-awesome"], description: "Font Awesome 6: fas fa-* → fa-solid fa-*", deterministic: true, packageName: "font-awesome", minTargetVersion: "6.0.0" },
  { id: "fa6-far", find: /\bfar\s+fa-/g, replace: "fa-regular fa-", type: "regex", stacks: ["fontawesome", "font-awesome"], description: "Font Awesome 6: far fa-* → fa-regular fa-*", deterministic: true, packageName: "font-awesome", minTargetVersion: "6.0.0" },
  { id: "fa6-fab", find: /\bfab\s+fa-/g, replace: "fa-brands fa-", type: "regex", stacks: ["fontawesome", "font-awesome"], description: "Font Awesome 6: fab fa-* → fa-brands fa-*", deterministic: true, packageName: "font-awesome", minTargetVersion: "6.0.0" },
  { id: "fa6-fal", find: /\bfal\s+fa-/g, replace: "fa-light fa-", type: "regex", stacks: ["fontawesome", "font-awesome"], description: "Font Awesome 6: fal fa-* → fa-light fa-*", deterministic: true, packageName: "font-awesome", minTargetVersion: "6.0.0" },
  // Font Awesome 6 renamed icons
  { id: "fa6-times", find: /\bfa-times\b/g, replace: "fa-xmark", type: "regex", stacks: ["fontawesome", "font-awesome"], description: "Font Awesome 6: fa-times → fa-xmark", deterministic: true, packageName: "font-awesome", minTargetVersion: "6.0.0" },
  { id: "fa6-window-close", find: /\bfa-window-close\b/g, replace: "fa-rectangle-xmark", type: "regex", stacks: ["fontawesome", "font-awesome"], description: "Font Awesome 6: fa-window-close → fa-rectangle-xmark", deterministic: true, packageName: "font-awesome", minTargetVersion: "6.0.0" },
  { id: "fa6-check-circle", find: /\bfa-check-circle\b/g, replace: "fa-circle-check", type: "regex", stacks: ["fontawesome", "font-awesome"], description: "Font Awesome 6: fa-check-circle → fa-circle-check", deterministic: true, packageName: "font-awesome", minTargetVersion: "6.0.0" },
  { id: "fa6-exclamation-triangle", find: /\bfa-exclamation-triangle\b/g, replace: "fa-triangle-exclamation", type: "regex", stacks: ["fontawesome", "font-awesome"], description: "Font Awesome 6: fa-exclamation-triangle → fa-triangle-exclamation", deterministic: true, packageName: "font-awesome", minTargetVersion: "6.0.0" },
  { id: "fa6-exclamation-circle", find: /\bfa-exclamation-circle\b/g, replace: "fa-circle-exclamation", type: "regex", stacks: ["fontawesome", "font-awesome"], description: "Font Awesome 6: fa-exclamation-circle → fa-circle-exclamation", deterministic: true, packageName: "font-awesome", minTargetVersion: "6.0.0" },
  { id: "fa6-info-circle", find: /\bfa-info-circle\b/g, replace: "fa-circle-info", type: "regex", stacks: ["fontawesome", "font-awesome"], description: "Font Awesome 6: fa-info-circle → fa-circle-info", deterministic: true, packageName: "font-awesome", minTargetVersion: "6.0.0" },
  { id: "fa6-question-circle", find: /\bfa-question-circle\b/g, replace: "fa-circle-question", type: "regex", stacks: ["fontawesome", "font-awesome"], description: "Font Awesome 6: fa-question-circle → fa-circle-question", deterministic: true, packageName: "font-awesome", minTargetVersion: "6.0.0" },
  { id: "fa6-external-link", find: /\bfa-external-link\b/g, replace: "fa-arrow-up-right-from-square", type: "regex", stacks: ["fontawesome", "font-awesome"], description: "Font Awesome 6: fa-external-link → fa-arrow-up-right-from-square", deterministic: true, packageName: "font-awesome", minTargetVersion: "6.0.0" },
  { id: "fa6-arrow-circle-right", find: /\bfa-arrow-circle-right\b/g, replace: "fa-circle-arrow-right", type: "regex", stacks: ["fontawesome", "font-awesome"], description: "Font Awesome 6: fa-arrow-circle-right → fa-circle-arrow-right", deterministic: true, packageName: "font-awesome", minTargetVersion: "6.0.0" },
  { id: "fa6-arrow-circle-left", find: /\bfa-arrow-circle-left\b/g, replace: "fa-circle-arrow-left", type: "regex", stacks: ["fontawesome", "font-awesome"], description: "Font Awesome 6: fa-arrow-circle-left → fa-circle-arrow-left", deterministic: true, packageName: "font-awesome", minTargetVersion: "6.0.0" },

  // ── Font Awesome 4 → 6 ──
  // FA4 used "fa fa-*" class prefix; FA5+ uses "fas fa-*", "far fa-*", "fab fa-*"
  // and FA6 renamed many icons. The most impactful deterministic transform:
  // "fa " prefix → "fas " (solid is the default replacement for FA4's single style)
  { id: "fa6-prefix-fa-to-fas", find: /\bfa\b(?=\s+fa-)/g, replace: "fas", type: "regex", stacks: ["fontawesome"], description: "Font Awesome 6: fa → fas (solid icons)", deterministic: true, packageName: "Font Awesome", minTargetVersion: "5.0.0" },
  // Common FA4 icon renames in FA5/6
  { id: "fa6-arrow-right", find: /\bfa-arrow-right\b/g, replace: "fa-arrow-right", type: "regex", stacks: ["fontawesome"], description: "FA6: fa-arrow-right (preserved)", deterministic: true, packageName: "Font Awesome", minTargetVersion: "6.0.0" },
  { id: "fa6-cog-to-gear", find: /\bfa-cog\b/g, replace: "fa-gear", type: "regex", stacks: ["fontawesome"], description: "FA6: fa-cog → fa-gear", deterministic: true, packageName: "Font Awesome", minTargetVersion: "6.0.0" },
  { id: "fa6-cogs-to-gears", find: /\bfa-cogs\b/g, replace: "fa-gears", type: "regex", stacks: ["fontawesome"], description: "FA6: fa-cogs → fa-gears", deterministic: true, packageName: "Font Awesome", minTargetVersion: "6.0.0" },
  { id: "fa6-remove-to-xmark", find: /\bfa-remove\b/g, replace: "fa-xmark", type: "regex", stacks: ["fontawesome"], description: "FA6: fa-remove → fa-xmark", deterministic: true, packageName: "Font Awesome", minTargetVersion: "6.0.0" },
  { id: "fa6-close-to-xmark", find: /\bfa-close\b/g, replace: "fa-xmark", type: "regex", stacks: ["fontawesome"], description: "FA6: fa-close → fa-xmark", deterministic: true, packageName: "Font Awesome", minTargetVersion: "6.0.0" },
  { id: "fa6-times-to-xmark", find: /\bfa-times\b/g, replace: "fa-xmark", type: "regex", stacks: ["fontawesome"], description: "FA6: fa-times → fa-xmark", deterministic: true, packageName: "Font Awesome", minTargetVersion: "6.0.0" },
  { id: "fa6-times-circle-to-circle-xmark", find: /\bfa-times-circle\b/g, replace: "fa-circle-xmark", type: "regex", stacks: ["fontawesome"], description: "FA6: fa-times-circle → fa-circle-xmark", deterministic: true, packageName: "Font Awesome", minTargetVersion: "6.0.0" },
  { id: "fa6-check-circle-to-circle-check", find: /\bfa-check-circle\b/g, replace: "fa-circle-check", type: "regex", stacks: ["fontawesome"], description: "FA6: fa-check-circle → fa-circle-check", deterministic: true, packageName: "Font Awesome", minTargetVersion: "6.0.0" },
  { id: "fa6-exclamation-circle", find: /\bfa-exclamation-circle\b/g, replace: "fa-circle-exclamation", type: "regex", stacks: ["fontawesome"], description: "FA6: fa-exclamation-circle → fa-circle-exclamation", deterministic: true, packageName: "Font Awesome", minTargetVersion: "6.0.0" },
  { id: "fa6-exclamation-triangle", find: /\bfa-exclamation-triangle\b/g, replace: "fa-triangle-exclamation", type: "regex", stacks: ["fontawesome"], description: "FA6: fa-exclamation-triangle → fa-triangle-exclamation", deterministic: true, packageName: "Font Awesome", minTargetVersion: "6.0.0" },
  { id: "fa6-info-circle", find: /\bfa-info-circle\b/g, replace: "fa-circle-info", type: "regex", stacks: ["fontawesome"], description: "FA6: fa-info-circle → fa-circle-info", deterministic: true, packageName: "Font Awesome", minTargetVersion: "6.0.0" },
  { id: "fa6-question-circle", find: /\bfa-question-circle\b/g, replace: "fa-circle-question", type: "regex", stacks: ["fontawesome"], description: "FA6: fa-question-circle → fa-circle-question", deterministic: true, packageName: "Font Awesome", minTargetVersion: "6.0.0" },
  { id: "fa6-pencil-to-pen", find: /\bfa-pencil\b/g, replace: "fa-pen", type: "regex", stacks: ["fontawesome"], description: "FA6: fa-pencil → fa-pen", deterministic: true, packageName: "Font Awesome", minTargetVersion: "6.0.0" },
  { id: "fa6-pencil-alt-to-pen-to-square", find: /\bfa-pencil-alt\b/g, replace: "fa-pen-to-square", type: "regex", stacks: ["fontawesome"], description: "FA6: fa-pencil-alt → fa-pen-to-square", deterministic: true, packageName: "Font Awesome", minTargetVersion: "6.0.0" },
  { id: "fa6-edit-to-pen-to-square", find: /\bfa-edit\b/g, replace: "fa-pen-to-square", type: "regex", stacks: ["fontawesome"], description: "FA6: fa-edit → fa-pen-to-square", deterministic: true, packageName: "Font Awesome", minTargetVersion: "6.0.0" },
  { id: "fa6-trash-alt", find: /\bfa-trash-alt\b/g, replace: "fa-trash-can", type: "regex", stacks: ["fontawesome"], description: "FA6: fa-trash-alt → fa-trash-can", deterministic: true, packageName: "Font Awesome", minTargetVersion: "6.0.0" },
  { id: "fa6-sign-in-alt", find: /\bfa-sign-in-alt\b/g, replace: "fa-right-to-bracket", type: "regex", stacks: ["fontawesome"], description: "FA6: fa-sign-in-alt → fa-right-to-bracket", deterministic: true, packageName: "Font Awesome", minTargetVersion: "6.0.0" },
  { id: "fa6-sign-out-alt", find: /\bfa-sign-out-alt\b/g, replace: "fa-right-from-bracket", type: "regex", stacks: ["fontawesome"], description: "FA6: fa-sign-out-alt → fa-right-from-bracket", deterministic: true, packageName: "Font Awesome", minTargetVersion: "6.0.0" },
  { id: "fa6-external-link-alt", find: /\bfa-external-link-alt\b/g, replace: "fa-up-right-from-square", type: "regex", stacks: ["fontawesome"], description: "FA6: fa-external-link-alt → fa-up-right-from-square", deterministic: true, packageName: "Font Awesome", minTargetVersion: "6.0.0" },
  { id: "fa6-sort-amount-down", find: /\bfa-sort-amount-down\b/g, replace: "fa-sort-amount-desc", type: "regex", stacks: ["fontawesome"], description: "FA6: fa-sort-amount-down → fa-sort-amount-desc", deterministic: true, packageName: "Font Awesome", minTargetVersion: "6.0.0" },
  { id: "fa6-user-circle", find: /\bfa-user-circle\b/g, replace: "fa-circle-user", type: "regex", stacks: ["fontawesome"], description: "FA6: fa-user-circle → fa-circle-user", deterministic: true, packageName: "Font Awesome", minTargetVersion: "6.0.0" },

  // ── Spring Boot 2 → 3 / Jakarta EE ──
  { id: "jakarta-persistence", find: "javax.persistence", replace: "jakarta.persistence", type: "text", stacks: ["spring-boot", "java"], description: "Jakarta EE 9+: javax.persistence → jakarta.persistence", deterministic: true, packageName: "spring-boot", minTargetVersion: "3.0.0" },
  { id: "jakarta-servlet", find: "javax.servlet", replace: "jakarta.servlet", type: "text", stacks: ["spring-boot", "java"], description: "Jakarta EE 9+: javax.servlet → jakarta.servlet", deterministic: true, packageName: "spring-boot", minTargetVersion: "3.0.0" },
  { id: "jakarta-annotation", find: "javax.annotation", replace: "jakarta.annotation", type: "text", stacks: ["spring-boot", "java"], description: "Jakarta EE 9+: javax.annotation → jakarta.annotation", deterministic: true, packageName: "spring-boot", minTargetVersion: "3.0.0" },
  { id: "jakarta-inject", find: "javax.inject", replace: "jakarta.inject", type: "text", stacks: ["spring-boot", "java"], description: "Jakarta EE 9+: javax.inject → jakarta.inject", deterministic: true, packageName: "spring-boot", minTargetVersion: "3.0.0" },
  { id: "jakarta-validation", find: "javax.validation", replace: "jakarta.validation", type: "text", stacks: ["spring-boot", "java"], description: "Jakarta EE 9+: javax.validation → jakarta.validation", deterministic: true, packageName: "spring-boot", minTargetVersion: "3.0.0" },
  { id: "jakarta-ws", find: "javax.ws.rs", replace: "jakarta.ws.rs", type: "text", stacks: ["spring-boot", "java"], description: "Jakarta EE 9+: javax.ws.rs → jakarta.ws.rs", deterministic: true, packageName: "spring-boot", minTargetVersion: "3.0.0" },
  { id: "jakarta-mail", find: "javax.mail", replace: "jakarta.mail", type: "text", stacks: ["spring-boot", "java"], description: "Jakarta EE 9+: javax.mail → jakarta.mail", deterministic: true, packageName: "spring-boot", minTargetVersion: "3.0.0" },
  { id: "jakarta-transaction", find: "javax.transaction", replace: "jakarta.transaction", type: "text", stacks: ["spring-boot", "java"], description: "Jakarta EE 9+: javax.transaction → jakarta.transaction", deterministic: true, packageName: "spring-boot", minTargetVersion: "3.0.0" },
  { id: "jakarta-xml-bind", find: "javax.xml.bind", replace: "jakarta.xml.bind", type: "text", stacks: ["spring-boot", "java"], description: "Jakarta EE 9+: javax.xml.bind → jakarta.xml.bind", deterministic: true, packageName: "spring-boot", minTargetVersion: "3.0.0" },
  { id: "jakarta-websocket", find: "javax.websocket", replace: "jakarta.websocket", type: "text", stacks: ["spring-boot", "java"], description: "Jakarta EE 9+: javax.websocket → jakarta.websocket", deterministic: true, packageName: "spring-boot", minTargetVersion: "3.0.0" },
  { id: "jakarta-ejb", find: "javax.ejb", replace: "jakarta.ejb", type: "text", stacks: ["spring-boot", "java"], description: "Jakarta EE 9+: javax.ejb → jakarta.ejb", deterministic: true, packageName: "spring-boot", minTargetVersion: "3.0.0" },
  { id: "jakarta-json", find: "javax.json", replace: "jakarta.json", type: "text", stacks: ["spring-boot", "java"], description: "Jakarta EE 9+: javax.json → jakarta.json", deterministic: true, packageName: "spring-boot", minTargetVersion: "3.0.0" },

  // ── Spring Security 5 → 6 ──
  { id: "spring-security6-csrf", find: /\.csrf\(\)\.disable\(\)/g, replace: ".csrf(csrf -> csrf.disable())", type: "regex", stacks: ["spring-boot", "java"], description: "Spring Security 6: Lambda DSL for csrf()", deterministic: true, packageName: "spring-boot", minTargetVersion: "3.0.0" },
  { id: "spring-security6-cors", find: /\.cors\(\)\.and\(\)/g, replace: ".cors(Customizer.withDefaults())", type: "regex", stacks: ["spring-boot", "java"], description: "Spring Security 6: Lambda DSL for cors()", deterministic: true, packageName: "spring-boot", minTargetVersion: "3.0.0" },
  { id: "spring-security6-authorize", find: /\.authorizeRequests\(\)/g, replace: ".authorizeHttpRequests()", type: "regex", stacks: ["spring-boot", "java"], description: "Spring Security 6: authorizeRequests() → authorizeHttpRequests()", deterministic: true, packageName: "spring-boot", minTargetVersion: "3.0.0" },
  { id: "spring-security6-antmatchers", find: /\.antMatchers\(/g, replace: ".requestMatchers(", type: "regex", stacks: ["spring-boot", "java"], description: "Spring Security 6: antMatchers() → requestMatchers()", deterministic: true, packageName: "spring-boot", minTargetVersion: "3.0.0" },
  { id: "spring-security6-mvcmatchers", find: /\.mvcMatchers\(/g, replace: ".requestMatchers(", type: "regex", stacks: ["spring-boot", "java"], description: "Spring Security 6: mvcMatchers() → requestMatchers()", deterministic: true, packageName: "spring-boot", minTargetVersion: "3.0.0" },
  { id: "spring-security6-websecurity", find: /WebSecurityConfigurerAdapter/g, replace: "/* WebSecurityConfigurerAdapter removed in Spring Security 6 — use SecurityFilterChain @Bean */", type: "regex", stacks: ["spring-boot", "java"], description: "Spring Security 6: WebSecurityConfigurerAdapter removed", deterministic: false, packageName: "spring-boot", minTargetVersion: "3.0.0" },

  // ── Hibernate 5 → 6 ──
  { id: "hibernate6-criteria-list", find: /\.getResultList\(\)/g, replace: ".getResultList()", type: "regex", stacks: ["java"], description: "Hibernate 6: getResultList() preserved", deterministic: true },
  { id: "hibernate6-type-descriptor", find: /org\.hibernate\.type\.descriptor\.java\./g, replace: "org.hibernate.type.descriptor.java.", type: "regex", stacks: ["java"], description: "Hibernate 6: type descriptor package preserved", deterministic: true },

  // ── Vue 2 → 3 ──
  { id: "vue3-set", find: /Vue\.set\s*\(/g, replace: "/* Vue.set removed in Vue 3 — use direct assignment */ (", type: "regex", stacks: ["vue"], description: "Vue 3: Vue.set() removed", deterministic: false },
  { id: "vue3-delete", find: /Vue\.delete\s*\(/g, replace: "/* Vue.delete removed in Vue 3 — use delete operator */ (", type: "regex", stacks: ["vue"], description: "Vue 3: Vue.delete() removed", deterministic: false },

  // ── Angular 15+ ──
  { id: "ng-entryComponents", find: /entryComponents\s*:\s*\[[\s\S]*?\]/g, replace: "/* entryComponents removed in Angular 15+ */", type: "regex", stacks: ["angular"], description: "Angular 15+: entryComponents removed", deterministic: true },

  // ── Express 4 → 5 ──
  { id: "express5-del", find: /\.del\s*\(/g, replace: ".delete(", type: "regex", stacks: ["express"], description: "Express 5: app.del() → app.delete()", deterministic: true },

  // ── Django 3 → 4 ──
  { id: "django4-url", find: /\bfrom django\.conf\.urls import url\b/g, replace: "from django.urls import re_path", type: "regex", stacks: ["django"], description: "Django 4: url() → re_path()", deterministic: true },
  { id: "django4-url-call", find: /\burl\s*\(\s*r'/g, replace: "re_path(r'", type: "regex", stacks: ["django"], description: "Django 4: url(r'...') → re_path(r'...')", deterministic: true },
  { id: "django4-ugettext", find: /\bugettext_lazy\b/g, replace: "gettext_lazy", type: "regex", stacks: ["django"], description: "Django 4: ugettext_lazy → gettext_lazy", deterministic: true },
  { id: "django4-ugettext2", find: /\bugettext\b/g, replace: "gettext", type: "regex", stacks: ["django"], description: "Django 4: ugettext → gettext", deterministic: true },

  // ── React 17 → 18 ──
  { id: "react18-render", find: /ReactDOM\.render\s*\(/g, replace: "/* React 18: use createRoot().render() instead */ ReactDOM.render(", type: "regex", stacks: ["react"], description: "React 18: ReactDOM.render → createRoot().render()", deterministic: false },

  // ── Next.js 12 → 13+ ──
  { id: "nextjs-image", find: /from ['"]next\/image['"]/g, replace: "from 'next/image'", type: "regex", stacks: ["nextjs"], description: "Next.js 13: next/image is new default (next/legacy/image for old)", deterministic: false },

  // ── Python 2 → 3 ──
  { id: "py3-print", find: /\bprint\s+(?![\(])/g, replace: "print(", type: "regex", stacks: ["python"], description: "Python 3: print statement → print()", deterministic: false },
  { id: "py3-xrange", find: /\bxrange\s*\(/g, replace: "range(", type: "regex", stacks: ["python"], description: "Python 3: xrange() → range()", deterministic: true },
  { id: "py3-raw-input", find: /\braw_input\s*\(/g, replace: "input(", type: "regex", stacks: ["python"], description: "Python 3: raw_input() → input()", deterministic: true },
  { id: "py3-has-key", find: /\.has_key\s*\(/g, replace: " in ", type: "regex", stacks: ["python"], description: "Python 3: dict.has_key() → 'in' operator", deterministic: false },
  { id: "py3-iteritems", find: /\.iteritems\s*\(\s*\)/g, replace: ".items()", type: "regex", stacks: ["python"], description: "Python 3: dict.iteritems() → dict.items()", deterministic: true },
  { id: "py3-itervalues", find: /\.itervalues\s*\(\s*\)/g, replace: ".values()", type: "regex", stacks: ["python"], description: "Python 3: dict.itervalues() → dict.values()", deterministic: true },
  { id: "py3-iterkeys", find: /\.iterkeys\s*\(\s*\)/g, replace: ".keys()", type: "regex", stacks: ["python"], description: "Python 3: dict.iterkeys() → dict.keys()", deterministic: true },

  // ── Django 1.x/2.x → 3.x/4.x ──
  { id: "django-middleware-classes", find: "MIDDLEWARE_CLASSES", replace: "MIDDLEWARE", type: "text", stacks: ["django"], description: "Django 2.0+: MIDDLEWARE_CLASSES → MIDDLEWARE", deterministic: true },
  { id: "django-force-text", find: /\bforce_text\b/g, replace: "force_str", type: "regex", stacks: ["django"], description: "Django 4.0: force_text → force_str", deterministic: true },
  { id: "django-smart-text", find: /\bsmart_text\b/g, replace: "smart_str", type: "regex", stacks: ["django"], description: "Django 4.0: smart_text → smart_str", deterministic: true },
  { id: "django-encoding-import", find: "from django.utils.encoding import force_text", replace: "from django.utils.encoding import force_str", type: "text", stacks: ["django"], description: "Django 4.0: force_text import", deterministic: true },
  { id: "django-encoding-import2", find: "from django.utils.encoding import smart_text", replace: "from django.utils.encoding import smart_str", type: "text", stacks: ["django"], description: "Django 4.0: smart_text import", deterministic: true },

  // ── Flask 2 → 3 ──
  { id: "flask3-before-request", find: /\b@(\w+)\.before_first_request\b/g, replace: "# before_first_request removed in Flask 2.3+\n@$1.before_request", type: "regex", stacks: ["flask"], description: "Flask 2.3+: before_first_request removed", deterministic: false },
  { id: "flask3-json-module", find: "from flask import json", replace: "import json", type: "text", stacks: ["flask"], description: "Flask 2.3+: flask.json deprecated, use stdlib json", deterministic: true },

  // ── Ruby on Rails 6 → 7 ──
  { id: "rails7-update-attributes", find: /\.update_attributes\s*\(/g, replace: ".update(", type: "regex", stacks: ["rails"], description: "Rails 7: update_attributes → update", deterministic: true },
  { id: "rails7-update-attributes-bang", find: /\.update_attributes!\s*\(/g, replace: ".update!(", type: "regex", stacks: ["rails"], description: "Rails 7: update_attributes! → update!", deterministic: true },
  { id: "rails7-before-filter", find: /\bbefore_filter\b/g, replace: "before_action", type: "regex", stacks: ["rails"], description: "Rails 5+: before_filter → before_action", deterministic: true },
  { id: "rails7-after-filter", find: /\bafter_filter\b/g, replace: "after_action", type: "regex", stacks: ["rails"], description: "Rails 5+: after_filter → after_action", deterministic: true },
  { id: "rails7-skip-before-filter", find: /\bskip_before_filter\b/g, replace: "skip_before_action", type: "regex", stacks: ["rails"], description: "Rails 5+: skip_before_filter → skip_before_action", deterministic: true },

  // ── Laravel 8 → 9/10/11 ──
  { id: "laravel9-route-model", find: /Route::resource\s*\(/g, replace: "Route::resource(", type: "regex", stacks: ["laravel", "php"], description: "Laravel: Route::resource preserved", deterministic: true },
  { id: "laravel10-dates-prop", find: /protected\s+\$dates\s*=/g, replace: "/* $dates property removed in Laravel 10 — use $casts instead */\n    protected $casts =", type: "regex", stacks: ["laravel", "php"], description: "Laravel 10: $dates → $casts", deterministic: false },
  { id: "laravel-str-helper", find: /\bstr_contains\s*\(/g, replace: "str_contains(", type: "regex", stacks: ["laravel", "php"], description: "Laravel: str_contains() native in PHP 8+", deterministic: true },
];

// ── Core Functions ──────────────────────────────────────────────

/**
 * Detect which stacks are active based on user selections.
 */
export function detectActiveStacks(
  selections: Array<{ package: string; currentVersion: string; selectedVersion: string }>,
): Set<string> {
  const stacks = new Set<string>();
  for (const sel of selections) {
    const lower = sel.package.toLowerCase();
    if (lower.includes(".net") || lower.includes("dotnet") || lower.includes("asp.net")) stacks.add("dotnet");
    if (lower.includes("bootstrap")) stacks.add("bootstrap");
    if (lower.includes("jquery") && !lower.includes("validation")) stacks.add("jquery");
    if (lower.includes("font-awesome") || lower.includes("fontawesome") || lower.includes("fortawesome")) { stacks.add("fontawesome"); stacks.add("font-awesome"); }
    if (lower.includes("spring") || lower.includes("spring-boot")) { stacks.add("spring-boot"); stacks.add("java"); }
    if (lower.includes("react")) stacks.add("react");
    if (lower.includes("angular")) stacks.add("angular");
    if (lower.includes("django")) stacks.add("django");
    if (lower.includes("vue")) stacks.add("vue");
    if (lower.includes("express")) stacks.add("express");
    if (lower.includes("next") || lower.includes("nextjs")) stacks.add("nextjs");
    if (lower.includes("flask")) stacks.add("flask");
    if (lower.includes("rails") || lower.includes("ruby")) stacks.add("rails");
    if (lower.includes("python")) stacks.add("python");
    if (lower.includes("laravel")) { stacks.add("laravel"); stacks.add("php"); }
    if (lower.includes("php") || lower.includes("symfony")) stacks.add("php");
    if (lower.includes("rust") || lower.includes("cargo")) stacks.add("rust");
    if (lower.includes("go") || lower.includes("golang")) stacks.add("go");
    if (lower.includes("entity framework")) stacks.add("dotnet");
    if (lower.includes("java") && !lower.includes("javascript")) stacks.add("java");
    if (lower.includes("font awesome") || lower.includes("fontawesome") || lower.includes("font-awesome")) stacks.add("fontawesome");
  }
  return stacks;
}

/**
 * Get all applicable transform rules for the active stacks,
 * combining built-in rules with any dynamically generated rules.
 * Version-aware: rules with minTargetVersion are only included when
 * the user's target version for that package meets or exceeds the minimum.
 */
export function getApplicableRules(
  activeStacks: Set<string>,
  dynamicRules: TransformRule[] = [],
  selections: Array<{ package: string; currentVersion: string; selectedVersion: string }> = [],
): TransformRule[] {
  const allRules = [...BUILTIN_TRANSFORM_RULES, ...dynamicRules];
  return allRules.filter(rule => {
    if (!rule.deterministic) return false;
    if (!rule.stacks.some(s => activeStacks.has(s))) return false;

    if (rule.minTargetVersion && rule.packageName) {
      const targetVersion = findTargetVersionForPackage(rule.packageName, selections);
      if (!targetVersion) return false;
      if (!meetsMinVersion(targetVersion, rule.minTargetVersion)) return false;
    }

    return true;
  });
}

/**
 * Find the user's target version for a given package name by fuzzy-matching
 * against the selections array.
 */
function findTargetVersionForPackage(
  packageName: string,
  selections: Array<{ package: string; currentVersion: string; selectedVersion: string }>,
): string | null {
  const lower = packageName.toLowerCase();
  for (const sel of selections) {
    const pkg = (sel.package || "").toLowerCase();
    if (pkg.includes(lower) || lower.includes(pkg)) {
      return sel.selectedVersion || null;
    }
  }
  return null;
}

/**
 * Check if `version` meets or exceeds `minVersion`.
 * Compares major.minor.patch numerically.
 */
function meetsMinVersion(version: string, minVersion: string): boolean {
  const parse = (v: string) => {
    const parts = v.replace(/^[^0-9]*/, "").split(".").map(p => parseInt(p, 10) || 0);
    return { major: parts[0] || 0, minor: parts[1] || 0, patch: parts[2] || 0 };
  };
  const ver = parse(version);
  const min = parse(minVersion);
  if (ver.major !== min.major) return ver.major > min.major;
  if (ver.minor !== min.minor) return ver.minor > min.minor;
  return ver.patch >= min.patch;
}

/**
 * Apply deterministic transforms to a single file's content.
 * Returns the transformed content and a log of what was changed.
 */
export function applyTransforms(
  filePath: string,
  content: string,
  rules: TransformRule[],
): TransformResult {
  let transformed = content;
  const appliedRules: TransformResult["appliedRules"] = [];
  let totalChanges = 0;

  for (const rule of rules) {
    const before = transformed;

    if (rule.type === "text") {
      const findStr = rule.find as string;
      if (!transformed.includes(findStr)) continue;

      let count = 0;
      let idx = transformed.indexOf(findStr);
      while (idx !== -1) {
        count++;
        idx = transformed.indexOf(findStr, idx + 1);
      }

      // Avoid double-applying: if the replacement is already present for all occurrences, skip
      if (count > 0 && !transformed.includes(rule.replace)) {
        transformed = transformed.split(findStr).join(rule.replace);
      } else if (count > 0) {
        // Partial apply: some occurrences already fixed, fix remaining
        transformed = transformed.split(findStr).join(rule.replace);
      }

      if (transformed !== before) {
        appliedRules.push({ ruleId: rule.id, description: rule.description, count });
        totalChanges += count;
      }
    } else if (rule.type === "regex") {
      const regex = rule.find as RegExp;
      // Reset regex lastIndex in case it was used before
      regex.lastIndex = 0;

      const matches = transformed.match(regex);
      if (!matches || matches.length === 0) continue;

      transformed = transformed.replace(regex, rule.replace);

      if (transformed !== before) {
        appliedRules.push({ ruleId: rule.id, description: rule.description, count: matches.length });
        totalChanges += matches.length;
      }
    } else if (rule.type === "line-remove") {
      const findStr = rule.find as string;
      const lines = transformed.split("\n");
      const filteredLines = lines.filter(line => !line.includes(findStr));
      const removed = lines.length - filteredLines.length;

      if (removed > 0) {
        transformed = filteredLines.join("\n");
        appliedRules.push({ ruleId: rule.id, description: rule.description, count: removed });
        totalChanges += removed;
      }
    }
  }

  return {
    filePath,
    originalContent: content,
    transformedContent: transformed,
    appliedRules,
    totalChanges,
  };
}

/**
 * Apply deterministic transforms to all files in a fileMap.
 * Modifies the map in place and returns a summary of changes.
 */
export function applyTransformsToFileMap(
  fileMap: Map<string, { content: string; original: string }>,
  selections: Array<{ package: string; currentVersion: string; selectedVersion: string }>,
  dynamicRules: TransformRule[] = [],
): { totalFiles: number; totalChanges: number; results: TransformResult[] } {
  const activeStacks = detectActiveStacks(selections);
  const rules = getApplicableRules(activeStacks, dynamicRules, selections);

  if (rules.length === 0) {
    return { totalFiles: 0, totalChanges: 0, results: [] };
  }

  const results: TransformResult[] = [];
  let totalChanges = 0;

  for (const [filePath, entry] of fileMap) {
    const result = applyTransforms(filePath, entry.content, rules);
    if (result.totalChanges > 0) {
      entry.content = result.transformedContent;
      results.push(result);
      totalChanges += result.totalChanges;
    }
  }

  return { totalFiles: results.length, totalChanges, results };
}

// ── Post-LLM Verification ───────────────────────────────────────

/**
 * Verify that the LLM output actually addressed all impact items.
 * For items that were missed and have deterministic fixes, apply them.
 */
export function verifyAndFixImpactItems(
  filePath: string,
  content: string,
  impactReport: UpgradeImpactReport,
  selections: Array<{ package: string; currentVersion: string; selectedVersion: string }>,
  dynamicRules: TransformRule[] = [],
): VerificationResult {
  const fileImpact = impactReport.affectedFiles.find(f =>
    f.path === filePath || f.path.replace(/\\/g, "/") === filePath.replace(/\\/g, "/")
  );

  if (!fileImpact || fileImpact.impacts.length === 0) {
    return { filePath, missedItems: [], autoFixedItems: [], content, wasModified: false };
  }

  const activeStacks = detectActiveStacks(selections);
  const rules = getApplicableRules(activeStacks, dynamicRules, selections);
  const missedItems: ImpactItem[] = [];
  const autoFixedItems: ImpactItem[] = [];
  let modified = content;
  let wasModified = false;

  for (const impact of fileImpact.impacts) {
    const patternLower = impact.pattern.toLowerCase();
    const contentLower = modified.toLowerCase();

    // Check if the issue pattern still exists in the content (LLM didn't fix it)
    if (contentLower.includes(patternLower)) {
      // Find a matching deterministic rule
      const matchingRule = rules.find(rule => {
        if (rule.type === "text") {
          return contentLower.includes((rule.find as string).toLowerCase());
        }
        if (rule.type === "regex") {
          (rule.find as RegExp).lastIndex = 0;
          return (rule.find as RegExp).test(modified);
        }
        return false;
      });

      if (matchingRule) {
        const result = applyTransforms(filePath, modified, [matchingRule]);
        if (result.totalChanges > 0) {
          modified = result.transformedContent;
          autoFixedItems.push(impact);
          wasModified = true;
        } else {
          missedItems.push(impact);
        }
      } else {
        missedItems.push(impact);
      }
    }
  }

  return { filePath, missedItems, autoFixedItems, content: modified, wasModified };
}

// ── Dynamic Rule Generation from Migration Docs ─────────────────

/**
 * Generate additional transform rules from migration documentation.
 * Parses structured breaking changes and creates find/replace rules
 * for patterns that are simple renames or removals.
 */
export function generateRulesFromMigrationDocs(
  migrationDocs: Map<string, MigrationDocResult>,
  selections: Array<{ package: string; currentVersion: string; selectedVersion: string }>,
): TransformRule[] {
  const dynamicRules: TransformRule[] = [];
  const activeStacks = detectActiveStacks(selections);
  const existingFinds = new Set(BUILTIN_TRANSFORM_RULES.map(r =>
    typeof r.find === "string" ? r.find : r.find.source
  ));

  for (const [pkg, doc] of migrationDocs) {
    const pkgStacks = inferStacksFromPackage(pkg);

    // Parse removedAPIs for rename patterns like "oldName (use newName)"
    for (const api of doc.removedAPIs) {
      const renameMatch = api.match(/^(.+?)\s*\(use\s+(.+?)\)$/i)
        || api.match(/^(.+?)\s*[→→]\s*(.+)$/i)
        || api.match(/^(.+?)\s*[-–—]\s*(?:use|replaced? (?:by|with))\s+(.+)$/i);

      if (renameMatch) {
        const from = renameMatch[1].trim();
        const to = renameMatch[2].trim();

        if (from.length >= 3 && to.length >= 3 && !existingFinds.has(from)) {
          dynamicRules.push({
            id: `dynamic-${pkg}-${dynamicRules.length}`,
            find: from,
            replace: to,
            type: "text",
            stacks: pkgStacks,
            description: `${pkg}: ${from} → ${to}`,
            deterministic: isSimpleRename(from, to),
          });
          existingFinds.add(from);
        }
      }
    }

    // Parse behavioral changes for simple renames
    for (const change of doc.behaviorChanges) {
      const renameMatch = change.match(/^(.+?)\s*[→→]\s*(.+)$/i)
        || change.match(/^(.+?)\s+renamed?\s+to\s+(.+)$/i);

      if (renameMatch) {
        const from = renameMatch[1].trim();
        const to = renameMatch[2].trim();

        if (from.length >= 3 && to.length >= 3 && !existingFinds.has(from)) {
          dynamicRules.push({
            id: `dynamic-behavior-${pkg}-${dynamicRules.length}`,
            find: from,
            replace: to,
            type: "text",
            stacks: pkgStacks,
            description: `${pkg}: ${from} → ${to} (behavior change)`,
            deterministic: isSimpleRename(from, to),
          });
          existingFinds.add(from);
        }
      }
    }
  }

  return dynamicRules;
}

function inferStacksFromPackage(pkg: string): string[] {
  const lower = pkg.toLowerCase();
  if (lower.includes("dotnet") || lower.includes(".net") || lower.includes("asp.net")) return ["dotnet"];
  if (lower.includes("bootstrap")) return ["bootstrap"];
  if (lower.includes("jquery")) return ["jquery"];
  if (lower.includes("spring")) return ["spring-boot", "java"];
  if (lower.includes("react")) return ["react"];
  if (lower.includes("angular")) return ["angular"];
  if (lower.includes("django")) return ["django"];
  if (lower.includes("vue")) return ["vue"];
  if (lower.includes("express")) return ["express"];
  if (lower.includes("flask")) return ["flask"];
  if (lower.includes("rails") || lower.includes("ruby")) return ["rails"];
  if (lower.includes("entity-framework")) return ["dotnet"];
  if (lower.includes("java")) return ["java"];
  if (lower.includes("python")) return ["python"];
  return [lower];
}

/** Simple renames are deterministic (same structure, just different name). */
function isSimpleRename(from: string, to: string): boolean {
  if (from.includes("(") || to.includes("(")) return false;
  if (to.includes("instead") || to.includes("use ")) return false;
  if (to.length > from.length * 3) return false;
  return true;
}

// ── CDN Version Detection and Enforcement ───────────────────────

export interface CdnReference {
  fullUrl: string;
  library: string;
  version: string;
  provider: string;
}

const CDN_PATTERNS: Array<{ provider: string; pattern: RegExp; libGroup: number; versionGroup: number }> = [
  { provider: "jsdelivr", pattern: /cdn\.jsdelivr\.net\/npm\/(@?[^@/]+)@([^/'"]+)/g, libGroup: 1, versionGroup: 2 },
  { provider: "cdnjs", pattern: /cdnjs\.cloudflare\.com\/ajax\/libs\/([^/]+)\/([^/'"]+)/g, libGroup: 1, versionGroup: 2 },
  { provider: "unpkg", pattern: /unpkg\.com\/(@?[^@/]+)@([^/'"]+)/g, libGroup: 1, versionGroup: 2 },
  { provider: "googleapis", pattern: /ajax\.googleapis\.com\/ajax\/libs\/([^/]+)\/([^/'"]+)/g, libGroup: 1, versionGroup: 2 },
  { provider: "jquery-cdn", pattern: /code\.jquery\.com\/jquery-([0-9][^/'"]*?)(?:\.min)?\.js/g, libGroup: 0, versionGroup: 1 },
  { provider: "bootstrapcdn", pattern: /stackpath\.bootstrapcdn\.com\/bootstrap\/([^/'"]+)/g, libGroup: 0, versionGroup: 1 },
  { provider: "bootstrapcdn-new", pattern: /cdn\.jsdelivr\.net\/npm\/bootstrap@([^/'"]+)/g, libGroup: 0, versionGroup: 1 },
  { provider: "aspnetcdn", pattern: /ajax\.aspnetcdn\.com\/ajax\/([^/]+)\/([^/'"]+)/g, libGroup: 1, versionGroup: 2 },
  { provider: "cloudflare-generic", pattern: /cdnjs\.cloudflare\.com\/ajax\/libs\/([^/]+)\/([0-9][^/'"]*)/g, libGroup: 1, versionGroup: 2 },
  { provider: "jsdelivr-gh", pattern: /cdn\.jsdelivr\.net\/gh\/([^@/]+)@([^/'"]+)/g, libGroup: 1, versionGroup: 2 },
  { provider: "jquery-cdn-ui", pattern: /code\.jquery\.com\/ui\/([0-9][^/'"]*)/g, libGroup: 0, versionGroup: 1 },
  { provider: "jquery-cdn-validate", pattern: /code\.jquery\.com\/([a-z][\w.-]+)-([0-9][^/'"]*?)(?:\.min)?\.js/g, libGroup: 1, versionGroup: 2 },
];

/**
 * Extract library versions from CDN URLs in file content.
 */
export function extractCdnVersions(content: string): CdnReference[] {
  const refs: CdnReference[] = [];
  for (const cdnDef of CDN_PATTERNS) {
    const regex = new RegExp(cdnDef.pattern.source, cdnDef.pattern.flags);
    let match: RegExpExecArray | null;
    while ((match = regex.exec(content)) !== null) {
      const library = cdnDef.libGroup === 0
        ? inferLibraryFromProvider(cdnDef.provider)
        : match[cdnDef.libGroup];
      const version = match[cdnDef.versionGroup];
      if (library && version) {
        refs.push({
          fullUrl: match[0],
          library: library.toLowerCase().replace(/^@/, ""),
          version,
          provider: cdnDef.provider,
        });
      }
    }
  }
  return refs;
}

function inferLibraryFromProvider(provider: string): string {
  if (provider === "jquery-cdn") return "jquery";
  if (provider === "jquery-cdn-ui") return "jquery-ui";
  if (provider.includes("bootstrap")) return "bootstrap";
  return "";
}

/**
 * Update CDN URL versions in file content to match user's target selections.
 * Returns the updated content and a list of changes made.
 */
export function updateCdnVersions(
  content: string,
  selections: Array<{ package: string; currentVersion: string; selectedVersion: string }>,
): { content: string; changes: Array<{ library: string; oldVersion: string; newVersion: string }> } {
  const changes: Array<{ library: string; oldVersion: string; newVersion: string }> = [];
  let result = content;

  const refs = extractCdnVersions(content);
  const updatedLibs = new Map<string, { oldVersion: string; newVersion: string }>();

  for (const ref of refs) {
    const targetVersion = findCdnTargetVersion(ref.library, selections);
    if (!targetVersion || targetVersion === ref.version) continue;

    const escaped = escapeRegexStr(ref.fullUrl);
    const updatedUrl = ref.fullUrl.replace(ref.version, targetVersion);
    result = result.replace(new RegExp(escaped, "g"), updatedUrl);
    changes.push({ library: ref.library, oldVersion: ref.version, newVersion: targetVersion });
    updatedLibs.set(ref.library, { oldVersion: ref.version, newVersion: targetVersion });
  }

  // After version replacement, strip integrity attributes on changed tags
  if (changes.length > 0) {
    result = result.replace(
      /(<(?:script|link)\b[^>]*?)\s+integrity="[^"]*"/gi,
      (fullMatch, prefix) => {
        const refsAfter = extractCdnVersions(fullMatch);
        const wasChanged = refsAfter.some(r => updatedLibs.has(r.library));
        return wasChanged ? prefix : fullMatch;
      }
    );

    // Update asp-fallback-src / asp-fallback-href attributes to match new version
    for (const [, { oldVersion, newVersion }] of updatedLibs) {
      const aspFallbackSrcRe = new RegExp(
        `(asp-fallback-src\\s*=\\s*["'][^"']*?)${escapeRegexStr(oldVersion)}([^"']*?["'])`,
        "gi"
      );
      result = result.replace(aspFallbackSrcRe, `$1${newVersion}$2`);

      const aspFallbackHrefRe = new RegExp(
        `(asp-fallback-href\\s*=\\s*["'][^"']*?)${escapeRegexStr(oldVersion)}([^"']*?["'])`,
        "gi"
      );
      result = result.replace(aspFallbackHrefRe, `$1${newVersion}$2`);
    }

    // Strip asp-fallback-test attributes when integrity was removed (SRI fallback no longer valid)
    result = result.replace(
      /\s+asp-fallback-test-class="[^"]*"/gi, ""
    );
    result = result.replace(
      /\s+asp-fallback-test-property="[^"]*"/gi, ""
    );
    result = result.replace(
      /\s+asp-fallback-test-value="[^"]*"/gi, ""
    );
  }

  return { content: result, changes };
}

/**
 * Normalize a library name for fuzzy matching: lowercase, strip all
 * punctuation/whitespace so "jquery-validate", "jquery.validate",
 * "jQuery Validation", "jquery_validation" all become "jqueryvalidat..." stems.
 */
function normalizeLibName(name: string): string {
  return name.toLowerCase().replace(/[-_.@\s/]/g, "");
}

const LIB_NAME_ALIASES: Record<string, string[]> = {
  jqueryvalidate:              ["jqueryvalidation", "jqueryvalidateunobtrusive", "jqueryvalunobtrusive", "jqueryvalidationunobtrusive"],
  jqueryvalidation:            ["jqueryvalidate", "jqueryvalidateunobtrusive", "jqueryvalunobtrusive"],
  jqueryvalidateunobtrusive:   ["jqueryvalidation", "jqueryvalidate", "jqueryvalunobtrusive", "jqueryvalidationunobtrusive"],
  jqueryvalidationunobtrusive: ["jqueryvalidateunobtrusive", "jqueryvalunobtrusive"],
  jquery:                      ["jquerycore", "jqueryslim", "jquerymin"],
  jqueryui:                    ["jqueryuicore"],
  bootstrap:                   ["twitterbootstrap", "bootstrapjs", "bootstrapcss"],
  fontawesome:                 ["fortawesome", "fontawesomefree", "fontawesomesvgcore"],
  popperjs:                    ["popper", "poppercore", "popperjs2"],
  popper:                      ["popperjs", "poppercore", "popperjs2"],
  datatables:                  ["datatablesnet", "jquerydatatables", "datatablesnet"],
  select2:                     ["select2js"],
  sweetalert:                  ["sweetalert2"],
  momentjs:                    ["moment"],
  moment:                      ["momentjs"],
  lodash:                      ["lodashjs", "lodashmin"],
  axios:                       ["axioshttp"],
  signalr:                     ["aspnetsignalr", "microsoftsignalr", "microsoftaspnetcoresignalr"],
  microsoftsignalr:            ["signalr", "aspnetsignalr"],
};

function findCdnTargetVersion(
  library: string,
  selections: Array<{ package: string; currentVersion: string; selectedVersion: string }>,
): string | null {
  const normLib = normalizeLibName(library);

  // Multi-pass matching: prefer the most specific match to avoid e.g.
  // "jquery" selection overriding "jquery-validate" CDN URLs.
  // Pass 1: exact normalized match
  // Pass 2: alias match
  // Pass 3: substring match (most specific first — longer normPkg preferred)

  // Pass 1: exact match
  for (const sel of selections) {
    const normPkg = normalizeLibName(sel.package || "");
    if (!normPkg) continue;
    if (normLib === normPkg) {
      return sel.selectedVersion || null;
    }
  }

  // Pass 2: alias-based match
  for (const sel of selections) {
    const normPkg = normalizeLibName(sel.package || "");
    if (!normPkg) continue;
    const libAliases = LIB_NAME_ALIASES[normLib] || [];
    const pkgAliases = LIB_NAME_ALIASES[normPkg] || [];
    if (libAliases.includes(normPkg) || pkgAliases.includes(normLib)) {
      return sel.selectedVersion || null;
    }
  }

  // Pass 3: substring containment — but ONLY allow when:
  // 1. The shorter string covers at least 70% of the longer string (prevents "jquery" matching "jqueryvalidation")
  // 2. Prefer the LONGEST (most specific) match
  // 3. If a more specific selection exists (e.g., "jqueryvalidation" for "jqueryvalidate"), skip the generic one ("jquery")
  let bestMatch: { version: string; specificity: number } | null = null;
  for (const sel of selections) {
    const normPkg = normalizeLibName(sel.package || "");
    if (!normPkg || normPkg.length < 4) continue;

    if (normLib.includes(normPkg) || normPkg.includes(normLib)) {
      const shorter = Math.min(normLib.length, normPkg.length);
      const longer = Math.max(normLib.length, normPkg.length);
      const coverageRatio = shorter / longer;

      // Require >= 70% coverage to prevent "jquery" (6 chars) matching "jqueryvalidation" (16 chars) = 37%
      if (coverageRatio < 0.7) continue;

      const specificity = shorter + (normLib.length === normPkg.length ? 100 : 0);
      if (!bestMatch || specificity > bestMatch.specificity) {
        bestMatch = { version: sel.selectedVersion || "", specificity };
      }
    }

    // Also check aliases for substring containment (with same coverage rule)
    const pkgAliases = LIB_NAME_ALIASES[normPkg] || [];
    for (const alias of pkgAliases) {
      if (normLib.includes(alias) || alias.includes(normLib)) {
        const shorter = Math.min(normLib.length, alias.length);
        const longer = Math.max(normLib.length, alias.length);
        const coverageRatio = shorter / longer;
        if (coverageRatio < 0.7) continue;

        const specificity = shorter + (normLib.length === alias.length ? 100 : 0);
        if (!bestMatch || specificity > bestMatch.specificity) {
          bestMatch = { version: sel.selectedVersion || "", specificity };
        }
      }
    }
  }
  return bestMatch?.version || null;
}

function escapeRegexStr(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ── HTML Reference Deduplication ─────────────────────────────────

interface ParsedHtmlRef {
  fullTag: string;
  library: string;
  version: string | null;
  url: string;
  tagType: "script" | "link";
  lineIndex: number;
}

const SCRIPT_SRC_RE = /<script\b[^>]*?\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi;
const LINK_HREF_RE = /<link\b[^>]*?\bhref\s*=\s*["']([^"']+)["'][^>]*>/gi;

const VIEW_EXTENSIONS = new Set([
  ".html", ".cshtml", ".razor", ".htm", ".aspx", ".master",
  ".jsp", ".erb", ".ejs", ".hbs", ".pug", ".vue", ".svelte",
  ".astro", ".php", ".twig", ".blade.php", ".njk",
]);

function parseHtmlRefs(content: string): ParsedHtmlRef[] {
  const refs: ParsedHtmlRef[] = [];
  const lines = content.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let match: RegExpExecArray | null;

    const scriptRe = new RegExp(SCRIPT_SRC_RE.source, "gi");
    while ((match = scriptRe.exec(line)) !== null) {
      const url = match[1];
      const lib = identifyLibraryFromUrl(url);
      const version = extractVersionFromUrl(url);
      refs.push({ fullTag: match[0], library: lib, version, url, tagType: "script", lineIndex: i });
    }

    const linkRe = new RegExp(LINK_HREF_RE.source, "gi");
    while ((match = linkRe.exec(line)) !== null) {
      const url = match[1];
      if (!url.endsWith(".css") && !line.includes('rel="stylesheet"') && !line.includes("rel='stylesheet'")) continue;
      const lib = identifyLibraryFromUrl(url);
      const version = extractVersionFromUrl(url);
      refs.push({ fullTag: match[0], library: lib, version, url, tagType: "link", lineIndex: i });
    }
  }

  return refs;
}

const LIB_URL_PATTERNS: Array<{ pattern: RegExp; library: string }> = [
  { pattern: /jquery[-.]validate/i, library: "jquery-validation" },
  { pattern: /jquery[-.]validation/i, library: "jquery-validation" },
  { pattern: /jquery[-.]?ui/i, library: "jquery-ui" },
  { pattern: /jquery/i, library: "jquery" },
  { pattern: /bootstrap[-.]datepicker/i, library: "bootstrap-datepicker" },
  { pattern: /bootstrap/i, library: "bootstrap" },
  { pattern: /font-?awesome/i, library: "font-awesome" },
  { pattern: /fortawesome/i, library: "font-awesome" },
  { pattern: /popper/i, library: "popper" },
  { pattern: /signalr/i, library: "signalr" },
  { pattern: /toastr/i, library: "toastr" },
  { pattern: /select2/i, library: "select2" },
  { pattern: /handlebars/i, library: "handlebars" },
  { pattern: /knockout/i, library: "knockout" },
  { pattern: /moment/i, library: "moment" },
  { pattern: /lodash/i, library: "lodash" },
  { pattern: /sweetalert/i, library: "sweetalert" },
  { pattern: /datatables/i, library: "datatables" },
  { pattern: /animate\.css/i, library: "animate.css" },
  { pattern: /d3/i, library: "d3" },
];

function identifyLibraryFromUrl(url: string): string {
  for (const { pattern, library } of LIB_URL_PATTERNS) {
    if (pattern.test(url)) return library;
  }
  const segments = url.split("/").filter(Boolean);
  const lastSeg = segments[segments.length - 1] || "";
  return lastSeg.replace(/[.-]min\.(js|css)$/i, "").replace(/\.(js|css)$/i, "").toLowerCase();
}

function extractVersionFromUrl(url: string): string | null {
  const m = url.match(/(\d+\.\d+(?:\.\d+)?)/);
  return m ? m[1] : null;
}

/**
 * Remove duplicate <script> / <link> tags for the same library, keeping only
 * the target-version reference. Also strips phantom library additions that
 * were not in the original file and not in userSelections.
 */
export function deduplicateHtmlReferences(
  modifiedFiles: Array<{ path: string; content: string; originalContent?: string; isNew?: boolean }>,
  extractedFiles: Array<{ relativePath: string; content: string }>,
  userSelections: Array<{ package: string; currentVersion: string; selectedVersion: string }>,
): typeof modifiedFiles {
  const selectionLibs = new Set(
    userSelections.map(s => normalizeLibName(s.package))
  );

  const extractedMap = new Map<string, string>();
  for (const ef of extractedFiles) {
    extractedMap.set(ef.relativePath.replace(/\\/g, "/").toLowerCase(), ef.content);
  }

  return modifiedFiles.map(file => {
    const ext = getFileExtension(file.path);
    if (!VIEW_EXTENSIONS.has(ext)) return file;

    const refs = parseHtmlRefs(file.content);
    if (refs.length === 0) return file;

    // Group refs by library
    const byLib = new Map<string, ParsedHtmlRef[]>();
    for (const ref of refs) {
      if (!ref.library) continue;
      const key = ref.library.toLowerCase();
      if (!byLib.has(key)) byLib.set(key, []);
      byLib.get(key)!.push(ref);
    }

    let content = file.content;
    const linesToRemove = new Set<number>();

    for (const [libKey, libRefs] of byLib) {
      // Check for duplicates (same library, multiple references)
      if (libRefs.length > 1) {
        const targetSel = userSelections.find(s =>
          normalizeLibName(s.package) === normalizeLibName(libKey) ||
          (LIB_NAME_ALIASES[normalizeLibName(libKey)] || []).includes(normalizeLibName(s.package)) ||
          (LIB_NAME_ALIASES[normalizeLibName(s.package)] || []).includes(normalizeLibName(libKey))
        );
        const targetVersion = targetSel?.selectedVersion;

        if (targetVersion) {
          // Keep only refs matching target version, remove old version refs
          for (const ref of libRefs) {
            if (ref.version && ref.version !== targetVersion) {
              linesToRemove.add(ref.lineIndex);
            }
          }
        } else {
          // No selection for this lib — keep the last reference (most recent), remove others
          for (let i = 0; i < libRefs.length - 1; i++) {
            linesToRemove.add(libRefs[i].lineIndex);
          }
        }
      }

      // Detect phantom additions: libraries NOT in original file AND NOT in selections
      const origContent = extractedMap.get(file.path.replace(/\\/g, "/").toLowerCase()) ?? file.originalContent ?? "";
      const normalizedLib = normalizeLibName(libKey);

      if (origContent) {
        const origRefs = parseHtmlRefs(origContent);
        const origLibs = new Set(origRefs.map(r => r.library.toLowerCase()));

        if (!origLibs.has(libKey) && !selectionLibs.has(normalizedLib)) {
          const isAliasInSelections = Object.entries(LIB_NAME_ALIASES).some(([alias, alts]) =>
            (alias === normalizedLib || alts.includes(normalizedLib)) &&
            (selectionLibs.has(alias) || alts.some(a => selectionLibs.has(a)))
          );
          if (!isAliasInSelections) {
            for (const ref of libRefs) {
              linesToRemove.add(ref.lineIndex);
            }
          }
        }
      }
    }

    if (linesToRemove.size === 0) return file;

    const lines = content.split("\n");
    const filteredLines = lines.filter((_, i) => !linesToRemove.has(i));
    content = filteredLines.join("\n");
    content = content.replace(/\n{3,}/g, "\n\n");

    return { ...file, content };
  });
}

function getFileExtension(filePath: string): string {
  const lower = filePath.toLowerCase();
  if (lower.endsWith(".blade.php")) return ".blade.php";
  const lastDot = lower.lastIndexOf(".");
  return lastDot >= 0 ? lower.slice(lastDot) : "";
}

// ── Static Vendor File Detection ────────────────────────────────

export interface StaticVendorFile {
  path: string;
  library: string;
  detectedVersion: string | null;
  targetVersion: string | null;
}

const VENDOR_FILE_PATTERNS: Array<{ pattern: RegExp; library: string }> = [
  { pattern: /bootstrap[.-]?(\d)?.*\.(min\.)?(?:js|css)$/i, library: "bootstrap" },
  { pattern: /jquery[.-]?(\d)?.*\.(min\.)?js$/i, library: "jquery" },
  { pattern: /popper[.-]?(\d)?.*\.(min\.)?js$/i, library: "popper.js" },
  { pattern: /font-?awesome.*\.(min\.)?(?:js|css)$/i, library: "font-awesome" },
  { pattern: /select2.*\.(min\.)?(?:js|css)$/i, library: "select2" },
  { pattern: /datatables.*\.(min\.)?(?:js|css)$/i, library: "datatables" },
  { pattern: /moment[.-]?(\d)?.*\.(min\.)?js$/i, library: "moment" },
  { pattern: /lodash[.-]?(\d)?.*\.(min\.)?js$/i, library: "lodash" },
  { pattern: /angular[.-]?(\d)?.*\.(min\.)?js$/i, library: "angular" },
  { pattern: /vue[.-]?(\d)?.*\.(min\.)?js$/i, library: "vue" },
  { pattern: /react[.-]?(\d)?.*\.(min\.)?js$/i, library: "react" },
  { pattern: /datepicker.*\.(min\.)?(?:js|css)$/i, library: "datepicker" },
  { pattern: /toastr.*\.(min\.)?(?:js|css)$/i, library: "toastr" },
  { pattern: /sweetalert.*\.(min\.)?(?:js|css)$/i, library: "sweetalert" },
];

/**
 * Detect committed static vendor files and extract version from header comments.
 */
export function detectStaticVendorFiles(
  files: Array<{ relativePath: string; content: string }>,
  selections: Array<{ package: string; currentVersion: string; selectedVersion: string }>,
): StaticVendorFile[] {
  const results: StaticVendorFile[] = [];
  const vendorDirs = ["wwwroot/", "static/", "public/", "assets/", "lib/", "vendor/", "Scripts/", "Content/"];

  for (const file of files) {
    const norm = file.relativePath.replace(/\\/g, "/");
    const isInVendorDir = vendorDirs.some(d => norm.toLowerCase().includes(d.toLowerCase()));
    if (!isInVendorDir) continue;

    const basename = norm.split("/").pop() || "";
    for (const vp of VENDOR_FILE_PATTERNS) {
      if (!vp.pattern.test(basename)) continue;

      const detectedVersion = extractVersionFromHeader(file.content);
      const targetVersion = findCdnTargetVersion(vp.library, selections);

      if (targetVersion) {
        results.push({
          path: norm,
          library: vp.library,
          detectedVersion,
          targetVersion,
        });
      }
      break;
    }
  }

  return results;
}

/**
 * Extract version from file header comments (e.g., `/*! Bootstrap v4.6.2`)
 *
 * GAP 1 fix: Now scans a larger portion of the file (first 5000 chars) and
 * returns ALL detected libraries+versions for bundled files.
 */
function extractVersionFromHeader(content: string): string | null {
  // Scan first 5000 chars for version headers (covers most file headers even in bundles)
  const headerLines = content.substring(0, 5000);
  const versionPatterns = [
    /[*!]\s*(?:Bootstrap|jQuery|Popper|Font\s*Awesome|Select2|DataTables|Moment|Lodash|Angular|Vue|React|Handlebars|Sammy|Knockout|Underscore|Backbone|Bootbox|Kendo)\s*v?(\d+\.\d+(?:\.\d+)?)/i,
    /\*\s*v(\d+\.\d+(?:\.\d+)?)/,
    /version[:\s]+["']?(\d+\.\d+(?:\.\d+)?)/i,
  ];
  for (const pat of versionPatterns) {
    const m = headerLines.match(pat);
    if (m) return m[1];
  }
  return null;
}
