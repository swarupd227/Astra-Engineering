import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useLocation } from "wouter";
import { useHostingConfig } from "@/hooks/use-hosting-config";
import { DashboardHeader } from "@/components/dashboard/header";

// ─── Object Repository Builder ────────────────────────────────────────────────

interface LocatorStrategy {
  strategy: string;
  confidence: number;
  css?: string;
  xpath?: string;
  playwright: string;
}

interface LocatorData {
  primary: LocatorStrategy;
  all: LocatorStrategy[];
  effectiveEl: {
    tag: string; id: string; name: string; placeholder: string;
    ariaLabel: string; text: string; type: string; cssPath: string | null;
  };
}

interface ObjRepoEntry {
  varName: string;          // e.g. "emailInput"
  playwrightExpr: string;   // e.g. "page.locator('#txtUserName')"
  strategies: LocatorStrategy[];
  label: string;            // human-readable for comment
}

/** Convert text to camelCase variable name (max ~30 chars) */
function _toCamel(str: string): string {
  return str
    .replace(/[^a-zA-Z0-9\s]/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((w, i) => i === 0 ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join('')
    .slice(0, 28);
}

// ─── Page Name Deriver ────────────────────────────────────────────────────────

/**
 * Derive a PascalCase page name from a URL, suitable for use as a TypeScript
 * export/file name in the project library.
 * Examples:
 *   /RedikerAcademy          → RedikerAcademyPage
 *   /Applicant/Landing       → LandingPage
 *   /Invoice/Invoice         → InvoicePage  (deduplicated — no InvoicePagePage)
 *   /ApplicantForm/LoadForm  → LoadFormPage
 * Proxy URLs (/api/recorder/browse?url=...) are decoded first.
 */
function _derivePageName(url: string): string {
  try {
    let realUrl = url;
    // Decode proxy browse URLs
    if (url.includes('/api/recorder/browse?url=')) {
      const m = url.match(/\/api\/recorder\/browse\?url=(.+)/);
      realUrl = m ? decodeURIComponent(m[1]) : url;
    }
    const parsed = new URL(realUrl);
    const segments = parsed.pathname.split('/').filter(Boolean);
    // Drop pure-numeric segments (IDs)
    const useful = segments.filter(s => !/^\d+$/.test(s));
    let raw = useful[useful.length - 1] || '';
    // If no useful segment, use the hostname (e.g., smartbear.com → SmartbearPage)
    if (!raw) {
      raw = parsed.hostname.split('.')[0] || 'Home';
    }
    // PascalCase
    const pascal = raw.charAt(0).toUpperCase() + raw.slice(1);
    // Avoid double "Page" suffix (case-insensitive)
    const pageName = pascal.toLowerCase().endsWith('page') ? pascal : pascal + 'Page';
    // Avoid conflict with Playwright's Page type
    if (pageName === 'Page') return 'HomePage';
    return pageName;
  } catch {
    return 'Page';
  }
}

// ─── Framework File Types ─────────────────────────────────────────────────────

interface LocatorFile {
  pageName: string;          // e.g. "RedikerAcademyPage"
  exportName: string;        // e.g. "RedikerAcademyPageLocators"
  locators: Record<string, string>; // varName → "(page: Page) => <expr>"
  content: string;           // full .locators.ts file content
}

interface PageClassFile {
  pageName: string;          // e.g. "FormSettingsPage"
  className: string;         // e.g. "FormSettingsPage"
  content: string;           // full .ts file content
  methods: string[];         // method names for reference
}

interface FrameworkFiles {
  locatorFiles: LocatorFile[];
  pageFiles: PageClassFile[];               // NEW — Page Object classes
  actionsFile: { path: string; content: string } | null;  // NEW — Business actions
  fixtureFile: { path: string; content: string } | null;  // NEW — Test data
  testContent: string;       // test spec — now calls business actions, not raw locators
  configContent: string;     // playwright.config.ts for the project
  universalHelpersContent: string; // helpers/universal.ts injected into every project
}

// JavaScript reserved words — cannot be used as unquoted property names
const _JS_RESERVED = new Set([
  'break','case','catch','class','const','continue','debugger','default','delete',
  'do','else','export','extends','finally','for','function','if','import','in',
  'instanceof','let','new','null','return','static','super','switch','this',
  'throw','try','typeof','undefined','var','void','while','with','yield'
]);

/** Derive a meaningful variable name from element data */
function _deriveVarName(el: LocatorData['effectiveEl'], eventType: string, usedNames: Set<string>): string {
  let base = '';
  const tag = el.tag;
  const type = el.type;

  if (tag === 'input' || tag === 'textarea') {
    if (type === 'email')    base = 'emailInput';
    else if (type === 'password') base = 'passwordInput';
    else if (type === 'search')   base = 'searchInput';
    else if (type === 'tel')      base = 'phoneInput';
    else if (type === 'number')   base = 'numberInput';
    else if (type === 'date')     base = 'dateInput';
    else if (type === 'checkbox' || eventType === 'check' || eventType === 'uncheck')
      base = _toCamel(el.ariaLabel || el.name || el.id || 'checkbox') + 'Checkbox';
    else if (type === 'radio')
      base = _toCamel(el.ariaLabel || el.name || el.id || 'radio') + 'Radio';
    else if (type === 'submit' || type === 'button')
      base = _toCamel(el.text || el.ariaLabel || el.id || 'submit') + 'Button';
    else {
      const hint = el.placeholder || el.ariaLabel || el.id || el.name;
      base = hint ? _toCamel(hint) + 'Input' : 'textInput';
    }
  } else if (tag === 'button' || type === 'submit') {
    base = _toCamel(el.text || el.ariaLabel || el.id || 'button') + 'Button';
  } else if (tag === 'a') {
    base = _toCamel(el.text || el.ariaLabel || el.id || 'link') + 'Link';
  } else if (tag === 'select') {
    base = _toCamel(el.ariaLabel || el.name || el.id || 'dropdown') + 'Select';
  } else {
    base = _toCamel(el.ariaLabel || el.text || el.id || el.name || tag) || 'element';
  }

  // ── Validate: ensure result is a legal JS identifier ──────────────────────
  // Rule 1: must not start with a digit — prefix with element tag
  if (/^\d/.test(base)) {
    const tagSafe = tag.replace(/[^a-zA-Z]/g, '') || 'el';
    base = tagSafe + base.charAt(0).toUpperCase() + base.slice(1);
  }
  // Rule 2: must not be a JS reserved word
  if (_JS_RESERVED.has(base)) base += 'El';
  // Rule 3: must not be empty
  if (!base) base = 'element';

  // Ensure uniqueness by appending a counter
  let name = base;
  let n = 2;
  while (usedNames.has(name)) { name = base + n++; }
  usedNames.add(name);
  return name;
}

/**
 * Returns true when a button/link label looks like a cookie-consent or
 * privacy-overlay action.  These are handled by prepareSite() so the
 * generated click must be graceful (short timeout, catch-and-continue).
 */
function _isConsentStep(name: string): boolean {
  const n = name.trim().toLowerCase();
  // Exact common phrases
  if (/^(allow all cookies?|accept all cookies?|accept cookies?|accept all|allow all|i agree|got it|agree to all|ok|okay)$/.test(n)) return true;
  // "allow/accept ... cookie" or "cookie ... allow/accept"
  if (/\b(allow|accept|agree)\b.+\b(cookie|cookies|all)\b/i.test(n)) return true;
  if (/\b(cookie|consent|gdpr|privacy)\b.+\b(allow|accept|agree|ok)\b/i.test(n)) return true;
  return false;
}

/**
 * Build an Object Repository from raw events.
 * Key = element identity (id > name > placeholder > text), Value = ObjRepoEntry
 */
/**
 * Detect and repair a broken playwright locator expression before it is
 * written into the Object Repository.
 *
 * The recorder's _getAllLocators() can produce XPath-style paths like
 *   page.locator('div[5]/div/div/ul/li[3]/div/label/span')
 * without the required 'xpath=' prefix.  Playwright then tries to parse the
 * string as CSS and throws "Unexpected token '/'".
 *
 * Healing strategy (in priority order):
 *  1. If the locator is a page.locator('...') whose selector contains '/'
 *     but no 'xpath=' prefix → add the prefix.
 *  2. If the element has a 'for' attribute recorded in effectiveEl
 *     (i.e. it is a <label for="id">) → replace with stable label[for="id"].
 *  3. Try the next-best strategy from the alternatives list instead.
 */
function _healLocator(
  expr: string,
  allStrategies: LocatorStrategy[],
  eff: any
): string {
  // ── Heal unresolved recorder variables (nm, ph stored as literal text) ─────
  // When recorder-ws.ts had a quoting bug, the 'playwright' property stored the
  // concatenation template literally, e.g.: page.locator('[name="' + nm + '"]')
  // These must be substituted with real values from effectiveEl before use.
  if (expr.includes("' + nm + '") && eff?.name) {
    return `page.locator('[name="${eff.name}"]')`;
  }
  if (expr.includes("' + ph + '") && eff?.placeholder) {
    return `page.getByPlaceholder('${eff.placeholder}', { exact: true })`;
  }
  if (expr.includes("' + ariaLbl + '") && eff?.ariaLabel) {
    return `page.getByLabel('${eff.ariaLabel}', { exact: true })`;
  }

  // ── Heal old recordings that stored exact: false (pre-fix) ──────────────────
  // After the recorder-ws.ts fix, all new recordings use exact: true.
  // Old recordings may still have exact: false — normalize them here.
  if (expr.includes('exact: false')) {
    return expr.replace(/exact:\s*false/g, 'exact: true');
  }

  // Detect: page.locator('...') where the selector has '/' but no xpath= prefix
  const rawLocatorMatch = expr.match(/^page\.locator\('([^']+)'\)$/);
  if (rawLocatorMatch) {
    const sel = rawLocatorMatch[1];
    const hasSlash = sel.includes('/');
    const alreadyXpath = sel.startsWith('xpath=') || sel.startsWith('//') || sel.startsWith('./');
    if (hasSlash && !alreadyXpath) {
      // Strategy 2: if element is a label with a for attribute, use that — most stable
      if (eff && eff.tag === 'label' && eff.id === '' && allStrategies) {
        const labelFor = allStrategies.find((s: LocatorStrategy) =>
          s.strategy === 'label-for' && s.css
        );
        if (labelFor && labelFor.css) {
          return `page.locator('${labelFor.css}')`;
        }
      }
      // Strategy 3: try the next-best strategy that doesn't have the same slash problem
      if (allStrategies) {
        const better = allStrategies.find((s: LocatorStrategy) => {
          if (s.playwright === expr) return false; // skip the broken one
          const m = s.playwright.match(/^page\.locator\('([^']+)'\)$/);
          if (m) {
            const innerSel = m[1];
            return !innerSel.includes('/') || innerSel.startsWith('xpath=') || innerSel.startsWith('//');
          }
          return true; // getByRole / getByLabel / getByText etc. are safe
        });
        if (better) return better.playwright;
      }
      // Fallback: prefix the raw path with xpath= so Playwright handles it correctly
      return `page.locator('xpath=${sel}')`;
    }
  }
  return expr;
}

function buildObjectRepository(events: RecordingEvent[]): Map<string, ObjRepoEntry> {
  const repo = new Map<string, ObjRepoEntry>();
  const usedNames = new Set<string>();

  for (const evt of events) {
    const el = (evt as any).element as any;
    if (!el) continue;
    const locData: LocatorData = el.locatorData;
    if (!locData?.primary) continue;

    const eff = locData.effectiveEl;
    // Skip GUID-style IDs — they are dynamically generated and change each run
    const _guidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const _isGuid = eff.id && _guidRe.test(eff.id);
    // Canonical key: prefer stable-id > name > placeholder > text (GUID ids not stable)
    const key = (_isGuid ? null : eff.id) ||
                (eff.name ? `name:${eff.name}` : null) ||
                (eff.placeholder ? `ph:${eff.placeholder}` : null) ||
                (eff.text ? `text:${eff.text.slice(0, 40)}` : null);
    if (!key) continue;
    if (repo.has(key)) continue;  // already catalogued this element

    const varName = _deriveVarName(eff, evt.type as string, usedNames);
    const primary = locData.primary;

    // ── Heal broken locators before storing ────────────────────────────────
    // A locator is broken when page.locator() receives an XPath-style path
    // (contains '/' separators) without an 'xpath=' prefix — Playwright then
    // tries to parse it as CSS and throws "Unexpected token '/'".
    const rawExpr = _healLocator(primary.playwright, locData.all, eff);
    // Append .filter({ visible: true }).first() to prevent strict-mode violations
    // when the same element appears multiple times in the DOM (e.g. desktop nav +
    // hidden mobile nav). .filter({ visible: true }) skips hidden duplicates so
    // the click lands on the element that is actually on screen.
    // Safe no-op when the locator already resolves to exactly 1 visible element.
    const playwrightExpr = rawExpr.endsWith('.first()')
      ? rawExpr
      : rawExpr.includes('.filter(')
      ? rawExpr
      : `${rawExpr}.filter({ visible: true }).first()`;

    repo.set(key, {
      varName,
      playwrightExpr,
      strategies: locData.all,
      label: el.label || eff.text || eff.placeholder || eff.id || varName,
    });
  }
  return repo;
}

/**
 * Resolve the Object Repository var name for an element referenced in an NL step.
 * Uses the [id=xxx] / [name=xxx] hint embedded in the NL step text.
 */
function resolveVarName(
  rawLabel: string,
  repo: Map<string, ObjRepoEntry>
): { varName: string | null; cleanLabel: string } {
  const hintMatch = rawLabel.match(/^(.*?)\[(id|name|testid)=([^\]]+)\](.*)$/);
  const cleanLabel = (hintMatch ? hintMatch[1] : rawLabel).replace(/\*+$/, '').trim();
  const hintType  = hintMatch ? hintMatch[2] : null;
  const hintValue = hintMatch ? hintMatch[3].trim() : null;

  if (hintType && hintValue) {
    const key = hintType === 'id' ? hintValue : `${hintType === 'name' ? 'name' : 'testid'}:${hintValue}`;
    const entry = repo.get(key);
    if (entry) return { varName: entry.varName, cleanLabel };
  }

  // Fallback: try matching by label/text (no spaces → treat as id)
  if (cleanLabel && !/\s/.test(cleanLabel) && /^[a-zA-Z][a-zA-Z0-9_-]*$/.test(cleanLabel)) {
    const entry = repo.get(cleanLabel);
    if (entry) return { varName: entry.varName, cleanLabel };
    // Also try as name-based key (SELECT elements use name:xxx key)
    const nameEntry = repo.get(`name:${cleanLabel}`);
    if (nameEntry) return { varName: nameEntry.varName, cleanLabel };
    // Also try case-insensitive label scan (covers server-format NL steps without locHint)
    const labelEntry = Array.from(repo.values()).find((e: ObjRepoEntry) =>
      e.label.toLowerCase() === cleanLabel.toLowerCase()
    );
    if (labelEntry) return { varName: labelEntry.varName, cleanLabel };
  }

  return { varName: null, cleanLabel };
}

/**
 * Build inline locator expression for a click element (button/link).
 * Tries object repo first, then falls back to intelligent inline selector.
 */
function resolveClickLocator(
  desc: string,
  tag: string,
  repo: Map<string, ObjRepoEntry>
): { expr: string; useL: boolean } {
  // Check repo by text match
  const textKey = `text:${desc.slice(0, 40)}`;
  const entry = repo.get(textKey) || Array.from(repo.values()).find((e: ObjRepoEntry) => e.label === desc);
  if (entry) return { expr: `L.${entry.varName}`, useL: true };

  if (tag === 'a') return { expr: `page.locator('xpath=//a[normalize-space(text())="${desc.replace(/"/g, '\\"')}"]').first()`, useL: false };
  return { expr: `page.locator('xpath=//button[normalize-space(text())="${desc.replace(/"/g, '\\"')}"]').first()`, useL: false };
}

// ─── Playwright Script Generator (NL-based — parses recorded steps) ──────────

/**
 * Derives a site-specific password env var name from the recording URL.
 * e.g. "https://ap-forms.rediker.com/..." → "REDIKER_PASSWORD"
 *      "https://app.salesforce.com/..."   → "SALESFORCE_PASSWORD"
 * Falls back to TEST_PASSWORD if the domain can't be parsed.
 */
function derivePasswordEnvVar(url: string): string {
  try {
    const hostname = new URL(url).hostname; // e.g. "ap-forms.rediker.com"
    const parts = hostname.split('.');
    // Use second-to-last part (the registrable domain name, e.g. "rediker")
    const domain = parts.length >= 2 ? parts[parts.length - 2] : parts[0];
    const clean = domain.toUpperCase().replace(/[^A-Z0-9]/g, '_');
    return `${clean}_PASSWORD`;
  } catch {
    return 'TEST_PASSWORD';
  }
}

function generatePlaywrightScript(events: RecordingEvent[], nlSteps: string[], startUrl: string): string {
  // ── Build object repository from enriched events ─────────────────────────
  const repo = buildObjectRepository(events);

  const lines: string[] = [];
  lines.push(`import { test, expect } from '@playwright/test';`);
  lines.push(`import { prepareSite, waitForPageReady, clickNewTab, hoverAndWait, tryLocators, smartFill, smartClick, smartCheck, smartUncheck } from '../helpers/universal';`);
  lines.push(`import { selectKendoDropdown, selectKendoDate, checkKendoTreeNode, waitAndDismissAnyKendoAlert, fillKendoGridDates } from '../helpers/kendo';`);
  lines.push(``);
  lines.push(`test('Recorded flow', async ({ page, context }) => {`);

  // ── Emit Object Repository block ─────────────────────────────────────────
  if (repo.size > 0) {
    lines.push(`  // ─── Object Repository (auto-captured during recording) ─────────────────`);
    lines.push(`  // Edit locators here — all test steps reference these named variables.`);
    lines.push(`  const L = {`);
    Array.from(repo.values()).forEach((entry: ObjRepoEntry) => {
      // Primary locator
      lines.push(`    ${entry.varName.padEnd(20)}: ${entry.playwrightExpr},`);
      // All alternative strategies as comments
      const alts = entry.strategies.filter((s: LocatorStrategy) => s.playwright !== entry.playwrightExpr);
      alts.forEach((alt: LocatorStrategy) => {
        const detail = alt.css ? `${alt.css}` : alt.xpath ? `xpath: ${alt.xpath}` : alt.playwright;
        lines.push(`    //  ↳ [${alt.strategy}] ${detail}`);
      });
    });
    lines.push(`  };`);
    lines.push(``);
  }

  // ── Navigation ───────────────────────────────────────────────────────────
  if (startUrl) {
    lines.push(`  await page.goto('${startUrl}');`);
    lines.push(`  await prepareSite(page); // dismiss overlays, wait for URL stability`);
    lines.push(``);
  }

  // ── Pre-process: collapse "Click on input → fill field" pairs ──────────────
  // When a user clicks a form field and then types into it, both events are recorded.
  // The click is redundant — fill() handles focus automatically.
  // Strategy: resolve both click and fill through the Object Repository by var name.
  // Fallback to text comparison for elements not in the repo.
  const skipIndices = new Set<number>();
  for (let i = 0; i < nlSteps.length; i++) {
    // Match any click step pattern (generic click, link click, button click)
    const clickM = nlSteps[i].match(/Click (?:on|link|button)\s+"(.+?)"/);
    if (!clickM) continue;
    const clickRaw = clickM[1].replace(/\*+$/, '').trim();

    // Resolve click target through the Object Repository
    const clickResolved = resolveVarName(clickRaw, repo);

    // If this click resolves to an input-type element, it's always redundant
    // (fill() handles focus — no need to click first)
    const isInputTypeClick = !!clickResolved.varName &&
      /Input$|Textarea$|Checkbox$|Select$/i.test(clickResolved.varName);

    // Look ahead up to 4 steps for a fill on the same element
    let suppressClick = false;
    for (let j = i + 1; j < Math.min(i + 4, nlSteps.length); j++) {
      if (/Page loaded\s*[—-]+/.test(nlSteps[j])) continue;
      const fillM = nlSteps[j].match(/Enter\s+".+?"\s+in the\s+"(.+?)"\s+field/);
      if (fillM) {
        const fillResolved = resolveVarName(fillM[1], repo);
        // Primary: suppress if both resolve to the same Object Repository variable
        if (clickResolved.varName && fillResolved.varName &&
            clickResolved.varName === fillResolved.varName) {
          suppressClick = true;
        }
        // Fallback: original text comparison for elements not in the repo
        if (!suppressClick) {
          const clickedText = clickRaw.toLowerCase();
          const fillLabel = fillM[1].replace(/\*+$/, '').trim().toLowerCase();
          if (fillLabel === clickedText ||
              fillLabel.startsWith(clickedText) ||
              clickedText.startsWith(fillLabel)) {
            suppressClick = true;
          }
        }
      }
      break;
    }
    if (suppressClick || isInputTypeClick) skipIndices.add(i);
  }

  let prevWasClick = false;
  let prevWasRadioOrCheckbox = false;
  let inPopup = false;  // tracks if we're in a popup window context

  // Returns the correct locator reference for the current context.
  const repoRef = (entry: ObjRepoEntry): string =>
    inPopup ? entry.playwrightExpr.replace(/^page\./, 'popup.') : `L.${entry.varName}`;

  // Build nlStep index → event index mapping for structural checks.
  // nlSteps are generated from events that have naturalLanguage; indices may differ.
  const nlToEvent: number[] = [];
  {
    let nlIdx = 0;
    for (let ei = 0; ei < events.length && nlIdx < nlSteps.length; ei++) {
      if ((events[ei] as any).naturalLanguage) {
        nlToEvent[nlIdx] = ei;
        nlIdx++;
      }
    }
  }

  // Track Kendo fields already handled by structural handlers to prevent duplicates.
  // When a kendo_select/kendo_date event generates selectKendoDropdown/selectKendoDate,
  // the corresponding blur/input event for the same field must be suppressed.
  const handledKendoFields = new Set<string>();

  for (let si = 0; si < nlSteps.length; si++) {
    if (skipIndices.has(si)) continue;
    const step = nlSteps[si];
    const srcEvent = events[nlToEvent[si]] as any;

    // Detect iframe context — use frameLocator() for elements from a different origin
    let pg = inPopup ? 'popup' : 'page';
    if (srcEvent?.inIframe && srcEvent?.iframeOrigin) {
      const iframeVar = `iframeOn_${srcEvent.iframeOrigin.replace(/https?:\/\//, '').replace(/[^a-zA-Z0-9]/g, '_')}`;
      // Emit frame variable declaration once per iframe origin
      if (!lines.some(l => l.includes(`const ${iframeVar}`))) {
        lines.push(`  const ${iframeVar} = page.frameLocator('iframe[src*="${srcEvent.iframeOrigin}"]');`);
      }
      pg = iframeVar;
    }
    // Snapshot and reset the radio/checkbox flag — Kendo date handlers read it
    const prevWasRadioCheck = prevWasRadioOrCheckbox;
    prevWasRadioOrCheckbox = false;

    // ══════════════════════════════════════════════════════════════════════
    // STRUCTURAL KENDO HANDLERS — fire on event metadata, not NL text.
    // All Kendo events carry kendoInputId (the widget's <input>/<select> id).
    // Generated code uses inputId strings only — no Locator objects needed.
    // ══════════════════════════════════════════════════════════════════════

    // ── Kendo DropDownList / ComboBox ─────────────────────────────────────
    if (srcEvent?.type === 'kendo_select' && srcEvent.kendoInputId) {
      const kid = srcEvent.kendoInputId;
      const selectedText = (srcEvent.selectedText || '').replace(/'/g, "\\'");
      lines.push(`  await selectKendoDropdown(${pg}, '${kid}', '${selectedText}');`);
      handledKendoFields.add(kid);
      prevWasClick = false;
      continue;
    }

    // ── Kendo DateTimePicker / DatePicker / TimePicker ────────────────────
    if (srcEvent?.type === 'kendo_date' && srcEvent.kendoInputId) {
      const kid = srcEvent.kendoInputId;
      const dateVal = (srcEvent.formattedValue || srcEvent.value || '').replace(/'/g, "\\'");
      // If previous step was a radio/checkbox click, insert a wait —
      // radio clicks often enable disabled DateTimePickers asynchronously
      if (prevWasRadioCheck) {
        lines.push(`  await ${pg}.waitForTimeout(2000); // wait for date pickers to enable after radio/checkbox click`);
      }
      lines.push(`  await selectKendoDate(${pg}, '${kid}', '${dateVal}');`);
      handledKendoFields.add(kid);
      prevWasClick = false;
      continue;
    }

    // ── Kendo MultiSelect ────────────────────────────────────────────────
    if (srcEvent?.type === 'kendo_multiselect' && srcEvent.kendoInputId) {
      const kid = srcEvent.kendoInputId;
      const items = srcEvent.selectedItems || [];
      for (const item of items) {
        lines.push(`  await selectKendoDropdown(${pg}, '${kid}', '${(item || '').replace(/'/g, "\\'")}');`);
      }
      prevWasClick = false;
      continue;
    }

    // ── Kendo TreeView checkbox (from locator bridge) ────────────────────
    if (srcEvent?.element?.locatorData?.primary?.strategy === 'kendo-treeview-checkbox') {
      const treeId = srcEvent.element.locatorData.primary.kendoTreeId;
      const nodeVal = srcEvent.element.locatorData.primary.kendoNodeValue;
      if (treeId && nodeVal) {
        const isCheck = srcEvent.type === 'check';
        lines.push(`  await checkKendoTreeNode(${pg}, '${treeId}', '${nodeVal}'${isCheck ? '' : ', false'});`);
        prevWasClick = false;
        continue;
      }
    }

    // ── Kendo Grid cell edit — generate fillKendoGridDates() ──────────────
    // When we see kendo_grid_edit events for date columns, batch them into
    // a single fillKendoGridDates() call instead of individual cell edits.
    if (srcEvent?.type === 'kendo_grid_edit' && srcEvent.gridId) {
      const gid = srcEvent.gridId;
      // Check if we already generated fillKendoGridDates for this grid
      if (!handledKendoFields.has('grid_' + gid)) {
        handledKendoFields.add('grid_' + gid);
        lines.push(`  await fillKendoGridDates(${pg}, '${gid}');`);
      }
      // Skip individual grid edit events — fillKendoGridDates handles all rows
      prevWasClick = false;
      continue;
    }

    // ── Kendo Grid checkbox (from locator bridge) ───────────────────────
    if (srcEvent?.element?.locatorData?.primary?.strategy === 'kendo-grid-header-checkbox') {
      const gridId = srcEvent.element.locatorData.primary.kendoGridId;
      lines.push(`  await ${pg}.evaluate(() => { var $ = (window as any).jQuery; $('#${gridId} th input[type="checkbox"]').first().click(); });`);
      lines.push(`  await ${pg}.waitForTimeout(1000);`);
      prevWasClick = false;
      continue;
    }
    if (srcEvent?.element?.locatorData?.primary?.strategy === 'kendo-grid-row-checkbox') {
      const gridId = srcEvent.element.locatorData.primary.kendoGridId;
      const rowIdx = srcEvent.element.locatorData.primary.kendoRowIndex || 0;
      lines.push(`  await ${pg}.evaluate(() => { var $ = (window as any).jQuery; $('#${gridId} tbody tr').eq(${rowIdx}).find('input[type="checkbox"]').click(); });`);
      lines.push(`  await ${pg}.waitForTimeout(500);`);
      prevWasClick = false;
      continue;
    }

    // ── Kendo DropDownList (from locator bridge — fallback) ──────────────
    if (srcEvent?.element?.locatorData?.primary?.strategy === 'kendo-dropdownlist' &&
        srcEvent.element.locatorData.primary.kendoInputId) {
      const kid = srcEvent.element.locatorData.primary.kendoInputId;
      const disabled = srcEvent.element.locatorData.primary.kendoDisabled;
      const selectedText = (srcEvent.selectedText || srcEvent.element?.description || '').replace(/'/g, "\\'");
      if (disabled) {
        lines.push(`  // SKIPPED: ${kid} was disabled at time of recording`);
      } else {
        lines.push(`  await selectKendoDropdown(${pg}, '${kid}', '${selectedText}');`);
      }
      prevWasClick = false;
      continue;
    }
    // ── Page loaded — skip entirely, navigation is implicit after clicks/goto ──
    if (/Page loaded\s*[—-]+/.test(step)) {
      if (prevWasClick) {
        lines.push(`  await waitForPageReady(${pg});`);
      }
      prevWasClick = false;
      continue;
    }

    // ── Navigate to path (SPA) ──
    const navMatch = step.match(/Navigate to\s+(.+)/);
    if (navMatch) {
      let navUrl = navMatch[1].trim();
      // Strip query params with dynamic IDs (formId=367, id=123, etc.)
      // so the URL works on re-runs where IDs change
      try {
        const urlObj = new URL(navUrl);
        const dynamicParams = ['formId', 'id', 'recordId', 'itemId', 'docId', 'pageId'];
        let hasDynamic = false;
        dynamicParams.forEach(p => { if (urlObj.searchParams.has(p)) { hasDynamic = true; } });
        if (hasDynamic) {
          // Use just the pathname with wildcard for query params
          navUrl = urlObj.origin + urlObj.pathname + '**';
        }
      } catch { /* not a full URL — keep as-is */ }
      lines.push(`  await ${pg}.waitForURL('**${navUrl}');`);
      prevWasClick = false;
      continue;
    }

    // ── Popup window opened ──
    if (/Popup window opened/.test(step)) {
      lines.push(`  // ── Switch to popup window ──`);
      lines.push(`  const [popup] = await Promise.all([`);
      lines.push(`    context.waitForEvent('page'),`);
      lines.push(`  ]);`);
      lines.push(`  await popup.waitForLoadState('domcontentloaded');`);
      lines.push(`  await waitForPageReady(popup);`);
      inPopup = true;
      prevWasClick = false;
      continue;
    }

    // ── Popup window closed — switch back to main page ──
    if (/Popup window closed/.test(step)) {
      lines.push(`  // ── Popup closed — back to main page ──`);
      inPopup = false;
      prevWasClick = false;
      continue;
    }

    // ── Popup navigated ──
    if (/Popup navigated to\s+(.+)/.test(step)) {
      const popupNavMatch = step.match(/Popup navigated to\s+(.+)/);
      if (popupNavMatch) {
        lines.push(`  await popup.waitForURL('**${popupNavMatch[1].trim()}');`);
      }
      prevWasClick = false;
      continue;
    }

    // ── Hover (mega menu trigger) ──
    const hoverMatch = step.match(/Hover over\s+"(.+?)"/);
    if (hoverMatch) {
      const name = hoverMatch[1].replace(/\*+$/, '').trim();
      const repoEntry = Array.from(repo.values()).find((e: ObjRepoEntry) =>
        e.label === name || e.label.toLowerCase() === name.toLowerCase()
      );
      if (repoEntry) {
        lines.push(`  await hoverAndWait(${repoRef(repoEntry)});`);
      } else {
        lines.push(`  await ${pg}.locator('xpath=//*[normalize-space(text())=\\'${name.replace(/'/g, "\\\\'")}\\']').hover();`);
        lines.push(`  await ${pg}.waitForTimeout(600);`);
      }
      prevWasClick = false;
      continue;
    }

    // ── NL FALLBACK: Kendo DropDownList / ComboBox ──
    // (fires when structural handler above didn't match — e.g., older recordings)
    const kendoSelectMatch = step.match(/Select\s+"(.+?)"\s+from the\s+"(.+?)"\s+Kendo\s+(dropdown|dropdownlist|combobox)/i);
    if (kendoSelectMatch) {
      const optionText = kendoSelectMatch[1].replace(/'/g, "\\'");
      const fieldLabel = kendoSelectMatch[2];
      // Try to get inputId from srcEvent, fall back to label
      const kid = srcEvent?.kendoInputId || srcEvent?.element?.elementId || fieldLabel;
      lines.push(`  await selectKendoDropdown(${pg}, '${kid}', '${optionText}');`);
      prevWasClick = false;
      continue;
    }

    // ── NL FALLBACK: Kendo DatePicker / DateTimePicker ──
    const kendoDateMatch = step.match(/Select date\s+"(.+?)"\s+in the\s+"(.+?)"\s+date picker/i);
    if (kendoDateMatch) {
      const dateVal = kendoDateMatch[1];
      const fieldLabel = kendoDateMatch[2];
      const kid = srcEvent?.kendoInputId || srcEvent?.element?.elementId || fieldLabel;
      if (prevWasRadioCheck) {
        lines.push(`  await ${pg}.waitForTimeout(2000);`);
      }
      lines.push(`  await selectKendoDate(${pg}, '${kid}', '${dateVal}');`);
      prevWasClick = false;
      continue;
    }

    // ── NL FALLBACK: Kendo MultiSelect ──
    const kendoMultiMatch = step.match(/Select\s+"(.+?)"\s+in the\s+"(.+?)"\s+Kendo multi-select/i);
    if (kendoMultiMatch) {
      const items = kendoMultiMatch[1].split(/,\s*/);
      const fieldLabel = kendoMultiMatch[2];
      const kid = srcEvent?.kendoInputId || srcEvent?.element?.elementId || fieldLabel;
      for (const item of items) {
        lines.push(`  await selectKendoDropdown(${pg}, '${kid}', '${item.trim().replace(/'/g, "\\'")}');`);
      }
      prevWasClick = false;
      continue;
    }

    // ── NL FALLBACK: Kendo TabStrip ──
    const kendoTabMatch = step.match(/Click tab\s+"(.+?)"/i);
    if (kendoTabMatch) {
      const tabText = kendoTabMatch[1].replace(/'/g, "\\'");
      lines.push(`  await smartClick(${pg}.locator('.k-tabstrip .k-item:has-text("${tabText}"), [role="tab"]:has-text("${tabText}")').first());`);
      prevWasClick = false;
      continue;
    }

    // ── NL FALLBACK: Kendo TreeView toggle ──
    const kendoTreeToggleMatch = step.match(/Toggle tree node\s+"(.+?)"/i);
    if (kendoTreeToggleMatch) {
      const nodeText = kendoTreeToggleMatch[1].replace(/'/g, "\\'");
      lines.push(`  await smartClick(${pg}.locator('.k-treeview .k-item:has-text("${nodeText}") .k-icon, .k-treeview [role="treeitem"]:has-text("${nodeText}") .k-icon').first());`);
      prevWasClick = false;
      continue;
    }

    // ── Kendo Grid sort ──
    const kendoSortMatch = step.match(/Sort grid column\s+"(.+?)"\s+(ascending|descending|none)/i);
    if (kendoSortMatch) {
      const col = kendoSortMatch[1].replace(/'/g, "\\'");
      lines.push(`  await smartClick(${pg}.locator('.k-grid th:has-text("${col}") .k-link, .k-grid th:has-text("${col}")').first());`);
      prevWasClick = false;
      continue;
    }

    // ── Kendo Grid page ──
    const kendoPageMatch = step.match(/Go to grid page\s+(\d+)/i);
    if (kendoPageMatch) {
      const pageNum = kendoPageMatch[1];
      lines.push(`  await smartClick(${pg}.locator('.k-pager .k-link:has-text("${pageNum}"), .k-pager-numbers [data-page="${pageNum}"]').first());`);
      prevWasClick = false;
      continue;
    }

    // ── Click link (anchor tag) ──
    const clickLinkMatch = step.match(/Click link\s+"(.+?)"/);
    if (clickLinkMatch) {
      const name = clickLinkMatch[1].replace(/\*+$/, '').trim();
      // Skip ghost clicks — single character link text is usually a misidentified tag name
      if (name.length <= 1 || /^(a|p|b|i|u|s|div|span|li|td|tr|th|hr|br)$/i.test(name)) {
        prevWasClick = false;
        continue;
      }
      // Check object repo first
      const repoEntry = Array.from(repo.values()).find((e: ObjRepoEntry) =>
        e.label === name || e.label.toLowerCase() === name.toLowerCase()
      );
      if (repoEntry) {
        // Check if this event has isNewTab flag
        const evt = events.find((ev: any) => ev.type === 'click' && (ev.element?.label === name || ev.element?.description === name));
        if (evt?.isNewTab) {
          lines.push(`  const newTab = await clickNewTab(context, L.${repoEntry.varName});`);
        } else if (_isConsentStep(name)) {
          lines.push(`  // Cookie/privacy consent — prepareSite() may have already dismissed this banner`);
          lines.push(`  await ${repoRef(repoEntry)}.click({ timeout: 5000 }).catch(() => {});`);
        } else {
          lines.push(`  await smartClick(${repoRef(repoEntry)});`);
        }
      } else if (_isConsentStep(name)) {
        lines.push(`  // Cookie/privacy consent — prepareSite() may have already dismissed this banner`);
        lines.push(`  await ${pg}.locator('xpath=//a[normalize-space(text())=\\'${name.replace(/'/g, "\\\\'")}\\']').filter({ visible: true }).first().click({ timeout: 5000 }).catch(() => {});`);
      } else {
        lines.push(`  await smartClick(${pg}.locator('xpath=//a[normalize-space(text())=\\'${name.replace(/'/g, "\\\\'")}\\']').filter({ visible: true }).first());`);
      }
      prevWasClick = true;
      continue;
    }

    // ── Click button ──
    const clickBtnMatch = step.match(/Click button\s+"(.+?)"/);
    if (clickBtnMatch) {
      const name = clickBtnMatch[1].replace(/\*+$/, '').trim();
      if (/^(input|button|submit)$/i.test(name)) {
        lines.push(`  await smartClick(${pg}.locator('xpath=//button[@type=\\'submit\\']'));`);
      } else {
        // Check object repo first
        const repoEntry = Array.from(repo.values()).find((e: ObjRepoEntry) =>
          e.label === name || e.label.toLowerCase() === name.toLowerCase()
        );
        if (repoEntry) {
          if (_isConsentStep(name)) {
            lines.push(`  // Cookie/privacy consent — prepareSite() may have already dismissed this banner`);
            lines.push(`  await ${repoRef(repoEntry)}.click({ timeout: 5000 }).catch(() => {});`);
          } else {
            lines.push(`  await smartClick(${repoRef(repoEntry)});`);
          }
        } else if (_isConsentStep(name)) {
          lines.push(`  // Cookie/privacy consent — prepareSite() may have already dismissed this banner`);
          lines.push(`  await ${pg}.locator('xpath=//button[normalize-space(text())=\\'${name.replace(/'/g, "\\\\'")}\\']').filter({ visible: true }).first().click({ timeout: 5000 }).catch(() => {});`);
        } else {
          lines.push(`  await smartClick(${pg}.locator('xpath=//button[normalize-space(text())=\\'${name.replace(/'/g, "\\\\'")}\\']').filter({ visible: true }).first());`);
        }
      }
      // Auto-insert Kendo alert dismiss after Save/Submit button clicks
      if (/^(save|submit|done|confirm|ok|yes)$/i.test(name) ||
          /save|submit/i.test(srcEvent?.element?.elementId || '')) {
        lines.push(`  await waitAndDismissAnyKendoAlert(${pg});`);
      }
      prevWasClick = true;
      continue;
    }

    // ── Generic click ──
    const clickMatch = step.match(/Click on\s+"(.+?)"/);
    if (clickMatch) {
      const text = clickMatch[1].replace(/\*+$/, '').trim();
      // Skip ghost clicks: single-char, bare HTML tags, or JavaScript source code
      if (text.length <= 1) { prevWasClick = false; continue; }
      if (/\bvar\s|function\s*\(|=>|\.prototype|document\.|window\.|if\s*\(.*\{/i.test(text)) { prevWasClick = false; continue; }
      if (text.includes("'") && text.length > 60) { prevWasClick = false; continue; }
      if (text.toLowerCase() === 'input' || text.toLowerCase() === 'button' || text.toLowerCase() === 'submit') {
        lines.push(`  await smartClick(${pg}.locator('xpath=//button[@type=\\'submit\\']'));`);
      } else if (/^[a-z0-9-]+\[\]$/.test(text) || /^checkbox/.test(text.toLowerCase())) {
        lines.push(`  await smartCheck(${pg}.locator('[type="checkbox"]'));`);
      } else if (/^(textarea|select|form|div|span|p|h[1-6]|ul|li|td|tr|th)$/i.test(text)) {
        // Generic HTML tag clicks — skip
        prevWasClick = false;
        continue;
      } else if (/^(menu|☰|≡|open menu|toggle menu|nav toggle|hamburger)$/i.test(text)) {
        lines.push(`  // Hamburger menu toggle skipped — tests run maximized (desktop nav visible directly)`);
        prevWasClick = false;
        continue;
      } else {
        // Check repo by text
        const repoEntry = Array.from(repo.values()).find((e: ObjRepoEntry) =>
          e.label === text || e.label.toLowerCase() === text.toLowerCase()
        );
        if (repoEntry) {
          // Skip click() for input/textarea/select — fill() handles focus automatically
          if (/Input$|Textarea$|Select$/i.test(repoEntry.varName)) {
            prevWasClick = false;
            continue;
          }
          // Check if this event has isNewTab flag
          const evtG = events.find((ev: any) => ev.type === 'click' && (ev.element?.label === text || ev.element?.description === text));
          if (evtG?.isNewTab) {
            lines.push(`  const newTab = await clickNewTab(context, L.${repoEntry.varName});`);
          } else if (_isConsentStep(text)) {
            lines.push(`  // Cookie/privacy consent — prepareSite() may have already dismissed this banner`);
            lines.push(`  await ${repoRef(repoEntry)}.click({ timeout: 5000 }).catch(() => {});`);
          } else {
            lines.push(`  await smartClick(${repoRef(repoEntry)});`);
          }
        } else if (_isConsentStep(text)) {
          lines.push(`  // Cookie/privacy consent — prepareSite() may have already dismissed this banner`);
          lines.push(`  await ${pg}.getByText('${text}', { exact: false }).filter({ visible: true }).first().click({ timeout: 5000 }).catch(() => {});`);
        } else {
          lines.push(`  await smartClick(${pg}.getByText('${text}', { exact: false }).filter({ visible: true }).first());`);
        }
      }
      prevWasClick = true;
      continue;
    }

    // ── Enter value in field ──
    const inputMatch = step.match(/Enter\s+"(.+?)"\s+in the\s+"(.+?)"\s+field/);
    if (inputMatch) {
      const [, value, rawLabel] = inputMatch;
      // Skip empty values
      if (!value || value.trim() === '') { prevWasClick = false; continue; }

      const { varName, cleanLabel } = resolveVarName(rawLabel, repo);

      // Skip checkbox fields, generic tag names
      if (/\[\]$/.test(cleanLabel)) { prevWasClick = false; continue; }
      if (/^(input|button|submit|textarea|select)$/i.test(cleanLabel)) { prevWasClick = false; continue; }

      // ── Skip fields already handled by Kendo structural handlers ──
      // If selectKendoDropdown/selectKendoDate already generated for this field,
      // the blur/input event is a duplicate — suppress smartFill.
      const fieldId = srcEvent?.element?.elementId || cleanLabel;
      if (handledKendoFields.has(fieldId)) {
        prevWasClick = false;
        continue;
      }
      // Also suppress by value pattern — date+time values on Kendo readonly inputs
      if (/^\d{2}-\d{2}-\d{4}\s+\d{1,2}:\d{2}\s*(AM|PM)$/i.test(value) &&
          srcEvent?.element?.locatorData?.effectiveEl?.type === 'text') {
        prevWasClick = false;
        continue;
      }

      // Dynamic form name for FormName fields — prevents duplicate name errors on repeat runs
      if (/^FormName$/i.test(fieldId) || /^formname$/i.test(cleanLabel)) {
        if (varName) {
          const entry = Array.from(repo.values()).find((e: ObjRepoEntry) => e.varName === varName);
          const ref = entry ? repoRef(entry) : `L.${varName}`;
          lines.push(`  await smartFill(${ref}, 'Test_' + Date.now());`);
        } else {
          lines.push(`  await smartFill(${pg}.locator('#FormName'), 'Test_' + Date.now());`);
        }
        prevWasClick = false;
        continue;
      }

      // All fields (including passwords) use the actual captured value directly.
      const escapedValue = value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
      const val = `'${escapedValue}'`;

      if (varName) {
        const entry = Array.from(repo.values()).find((e: ObjRepoEntry) => e.varName === varName);
        const ref = entry ? repoRef(entry) : `L.${varName}`;
        lines.push(`  await smartFill(${ref}, ${val});`);
      } else {
        // Fallback: smart inline locator (hint-based or heuristic)
        const hintMatch = rawLabel.match(/^(.*?)\[(id|name)=([^\]]+)\](.*)$/);
        const hintType  = hintMatch ? hintMatch[2] : null;
        const hintValue = hintMatch ? hintMatch[3].trim() : null;
        let locatorStr: string;
        if (hintType === 'id' && hintValue) {
          locatorStr = `${pg}.locator('#${hintValue}')`;
        } else if (hintType === 'name' && hintValue) {
          locatorStr = `${pg}.locator('[name="${hintValue}"]')`;
        } else if (cleanLabel && !/\s/.test(cleanLabel) && /^[a-zA-Z][a-zA-Z0-9_-]*$/.test(cleanLabel)) {
          locatorStr = `${pg}.locator('#${cleanLabel}, [name="${cleanLabel}"]').first()`;
        } else {
          locatorStr = `${pg}.getByLabel('${cleanLabel}', { exact: false }).or(${pg}.getByPlaceholder('${cleanLabel}', { exact: false })).first()`;
        }
        lines.push(`  await smartFill(${locatorStr}, ${val});`);
      }
      prevWasClick = false;
      continue;
    }

    // ── Check checkbox (with optional row context for grid/list checkboxes) ──
    const checkMatch = step.match(/Check the\s+"(.+?)"\s+checkbox(?:\s+in row\s+"(.+?)")?/i);
    if (checkMatch) {
      const rawLbl = checkMatch[1];
      const rowCtx = checkMatch[2];  // e.g. "apolf_194" — text of the row containing the checkbox
      const { varName: cbVar, cleanLabel: cbLabel } = resolveVarName(rawLbl, repo);

      if (rowCtx) {
        // Row-context checkbox: find the row by its text, then the checkbox inside it
        // e.g. page.locator('tr:has-text("apolf_194"), li:has-text("apolf_194")').locator('input[type="checkbox"]')
        const escapedRow = rowCtx.replace(/'/g, "\\'").substring(0, 50);
        lines.push(`  await smartCheck(${pg}.locator('tr:has-text("${escapedRow}"), li:has-text("${escapedRow}"), [role="row"]:has-text("${escapedRow}")').locator('input[type="checkbox"]').first());`);
      } else if (cbVar) {
        const cbEntry = Array.from(repo.values()).find((e: ObjRepoEntry) => e.varName === cbVar);
        lines.push(`  await smartCheck(${cbEntry ? repoRef(cbEntry) : `L.${cbVar}`});`);
      } else {
        const hintM = rawLbl.match(/^(.*?)\[(id|name)=([^\]]+)\]/);
        const loc = hintM ? (hintM[2] === 'id' ? `${pg}.locator('#${hintM[3]}')` : `${pg}.locator('[name="${hintM[3]}"]')`)
                          : `${pg}.getByLabel('${cbLabel}', { exact: false })`;
        lines.push(`  await smartCheck(${loc});`);
      }
      prevWasClick = false;
      prevWasRadioOrCheckbox = true;
      continue;
    }

    // ── Uncheck checkbox (with optional row context) ──
    const uncheckMatch = step.match(/Uncheck the\s+"(.+?)"\s+checkbox(?:\s+in row\s+"(.+?)")?/i);
    if (uncheckMatch) {
      const rawLbl = uncheckMatch[1];
      const rowCtx = uncheckMatch[2];
      const { varName: cbVar, cleanLabel: cbLabel } = resolveVarName(rawLbl, repo);

      if (rowCtx) {
        const escapedRow = rowCtx.replace(/'/g, "\\'").substring(0, 50);
        lines.push(`  await smartUncheck(${pg}.locator('tr:has-text("${escapedRow}"), li:has-text("${escapedRow}"), [role="row"]:has-text("${escapedRow}")').locator('input[type="checkbox"]').first());`);
      } else if (cbVar) {
        const cbEntry = Array.from(repo.values()).find((e: ObjRepoEntry) => e.varName === cbVar);
        lines.push(`  await smartUncheck(${cbEntry ? repoRef(cbEntry) : `L.${cbVar}`});`);
      } else {
        const hintM = rawLbl.match(/^(.*?)\[(id|name)=([^\]]+)\]/);
        const loc = hintM ? (hintM[2] === 'id' ? `${pg}.locator('#${hintM[3]}')` : `${pg}.locator('[name="${hintM[3]}"]')`)
                          : `${pg}.getByLabel('${cbLabel}', { exact: false })`;
        lines.push(`  await smartUncheck(${loc});`);
      }
      prevWasClick = false;
      continue;
    }

    // ── Select dropdown ──
    // Matches both client format: Select "X" from "Y[name=z]"
    // and server format:         Select "X" from the "Y" dropdown
    const selectMatch = step.match(/Select\s+"(.+?)"\s+from\s+(?:the\s+)?"(.+?)"(?:\s+dropdown)?/);
    if (selectMatch) {
      const [, value, rawLbl] = selectMatch;
      const { varName: selVar, cleanLabel: selLabel } = resolveVarName(rawLbl, repo);
      // Multi-select: comma-separated values → array syntax
      const values = value.split(',').map((v: string) => v.trim()).filter(Boolean);
      const optionArg = values.length > 1
        ? `[${values.map((v: string) => `{ label: '${v}' }`).join(', ')}]`
        : `{ label: '${values[0]}' }`;
      if (selVar) {
        lines.push(`  await L.${selVar}.selectOption(${optionArg});`);
      } else {
        lines.push(`  await ${pg}.getByLabel('${selLabel}').selectOption(${optionArg});`);
      }
      prevWasClick = false;
      continue;
    }

    // ── Assertions ──────────────────────────────────────────────────────────
    const isSoft = /\[soft\]/.test(step);
    const softWrap = (inner: string) => isSoft
      ? `  try { ${inner.trim()} } catch(e) { console.warn('[SOFT ASSERT]', e.message); }`
      : `  ${inner.trim()}`;

    // Assert text (contains / equals / starts_with / not_equals)
    const assertText = step.match(/Assert text (contains|equals|starts with|does not equal)\s+"(.+?)"\s+on\s+"(.+?)"/i);
    if (assertText) {
      const [, op, expected, lbl] = assertText;
      const locator = `page.getByText('${expected}', { exact: ${op === 'equals'} }).first()`;
      if (op === 'does not equal' || op === 'not equals') {
        lines.push(softWrap(`await expect(${locator}).not.toBeVisible();`));
      } else {
        lines.push(softWrap(`await expect(${locator}).toBeVisible();`));
      }
      prevWasClick = false; continue;
    }

    // Assert value (input/textarea current value)
    const assertValue = step.match(/Assert value (contains|equals|starts with|does not equal)\s+"(.+?)"\s+on\s+"(.+?)"/i);
    if (assertValue) {
      const [, op, expected, lbl] = assertValue;
      const { varName: avVar, cleanLabel: avLabel } = resolveVarName(lbl, repo);
      let locator: string;
      if (avVar) {
        locator = `L.${avVar}`;
      } else {
        const avHint = lbl.match(/^(.*?)\[(id|name)=([^\]]+)\](.*)$/);
        const avHintType = avHint ? avHint[2] : null;
        const avHintVal  = avHint ? avHint[3].trim() : null;
        const avLocStr = avHintType === 'id' && avHintVal ? `#${avHintVal}`
          : avHintType === 'name' && avHintVal ? `[name="${avHintVal}"]`
          : !/\s/.test(avLabel) && /^[a-zA-Z][a-zA-Z0-9_-]*$/.test(avLabel)
            ? `#${avLabel}, [name="${avLabel}"]`
            : `input[placeholder*="${avLabel}" i], textarea[placeholder*="${avLabel}" i]`;
        locator = `page.locator('${avLocStr}').first()`;
      }
      if (op === 'does not equal') {
        lines.push(softWrap(`await expect(${locator}).not.toHaveValue('${expected}');`));
      } else if (op === 'contains') {
        lines.push(softWrap(`await expect(${locator}).toHaveValue(new RegExp('${expected}', 'i'));`));
      } else {
        lines.push(softWrap(`await expect(${locator}).toHaveValue('${expected}');`));
      }
      prevWasClick = false; continue;
    }

    // Assert visible / hidden
    const assertVisible = step.match(/Assert\s+"(.+?)"\s+is (visible|hidden)/i);
    if (assertVisible) {
      const [, lbl, state] = assertVisible;
      const locator = `page.getByText('${lbl}', { exact: false }).first()`;
      lines.push(softWrap(state === 'visible'
        ? `await expect(${locator}).toBeVisible();`
        : `await expect(${locator}).not.toBeVisible();`));
      prevWasClick = false; continue;
    }

    // Assert enabled / disabled
    const assertEnabled = step.match(/Assert\s+"(.+?)"\s+is (enabled|disabled)/i);
    if (assertEnabled) {
      const [, lbl, state] = assertEnabled;
      const locator = `page.locator('xpath=//button[normalize-space(text())=\\'${lbl.replace(/'/g, "\\\\'")}\\']')`;
      lines.push(softWrap(state === 'enabled'
        ? `await expect(${locator}).toBeEnabled();`
        : `await expect(${locator}).toBeDisabled();`));
      prevWasClick = false; continue;
    }

    // Assert checked / unchecked
    const assertChecked = step.match(/Assert\s+"(.+?)"\s+is (checked|unchecked)/i);
    if (assertChecked) {
      const [, lbl, state] = assertChecked;
      const { varName: ckVar, cleanLabel: ckLabel } = resolveVarName(lbl, repo);
      const locator = ckVar ? `L.${ckVar}` : `page.getByLabel('${ckLabel}', { exact: false })`;
      lines.push(softWrap(state === 'checked'
        ? `await expect(${locator}).toBeChecked();`
        : `await expect(${locator}).not.toBeChecked();`));
      prevWasClick = false; continue;
    }

    // Assert attribute
    const assertAttr = step.match(/Assert attribute\s+"(.+?)"\s+(contains|equals|starts with)\s+"(.+?)"\s+on\s+"(.+?)"/i);
    if (assertAttr) {
      const [, attr, op, expected, lbl] = assertAttr;
      const locator = `page.getByText('${lbl}', { exact: false }).first()`;
      if (op === 'contains') {
        lines.push(softWrap(`await expect(${locator}).toHaveAttribute('${attr}', new RegExp('${expected}'));`));
      } else {
        lines.push(softWrap(`await expect(${locator}).toHaveAttribute('${attr}', '${expected}');`));
      }
      prevWasClick = false; continue;
    }

    // Assert count
    const assertCount = step.match(/Assert (\d+) elements match\s+"(.+?)"/i);
    if (assertCount) {
      const [, count, lbl] = assertCount;
      lines.push(softWrap(`await expect(page.getByText('${lbl}', { exact: false })).toHaveCount(${count});`));
      prevWasClick = false; continue;
    }

    // ── Fallback: comment ──
    lines.push(`  // ${step}`);
    prevWasClick = false;
  }

  lines.push(`});`);
  return lines.join('\n');
}

// ─── Post-Generation Script Cleanup ──────────────────────────────────────────
// Auto-fixes common issues in the generated script before displaying/saving.
function cleanupGeneratedScript(script: string): string {
  const lines = script.split('\n');
  const cleaned: string[] = [];
  let prev = '';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // 1. Remove duplicate consecutive lines (exact match)
    if (trimmed === prev.trim() && trimmed.startsWith('await ')) continue;

    // 2. Remove lines containing inline JavaScript code
    if (/\bvar\s+\w+\s*=\s*'/.test(trimmed) && /selformats|isValid|function\s*\(/.test(trimmed)) continue;
    if (trimmed.includes('var selformats')) continue;

    // 3. Remove empty comment lines
    if (/^\/\/ Step \d+: Enter "" in/.test(trimmed)) continue;

    // 4. Wildcard dynamic URL IDs
    let fixedLine = line;
    fixedLine = fixedLine.replace(
      /waitForURL\('([^']*\?[^']*(?:formId|id|recordId|itemId|docId|pageId)=\d+[^']*)'\)/g,
      (match, url) => {
        try {
          const u = new URL(url.replace(/^\*+/, 'https://x.com'));
          return `waitForURL('**${u.pathname}**')`;
        } catch { return match; }
      }
    );

    // 5. Add waitUntil: 'domcontentloaded' to waitForURL that doesn't have it
    if (fixedLine.includes('waitForURL(') && !fixedLine.includes('waitUntil') && !fixedLine.includes('domcontentloaded')) {
      fixedLine = fixedLine.replace(
        /waitForURL\(('[^']+')\)/,
        "waitForURL($1, { waitUntil: 'domcontentloaded' })"
      );
    }

    // 6. Replace GUID-based locator IDs with stable alternatives
    const guidInLocator = fixedLine.match(/locator\([^)]*#([A-Za-z]+[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
    if (guidInLocator) {
      // Extract the grid/widget name prefix before the GUID
      const fullId = guidInLocator[1];
      const prefix = fullId.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, '');
      if (prefix) {
        // Replace with header checkbox selector using the prefix as grid ID
        fixedLine = `  await page.evaluate(() => { var $ = (window as any).jQuery; $('th input[type="checkbox"]:visible').first().click(); });`;
      }
    }

    cleaned.push(fixedLine);
    prev = line;
  }

  return cleaned.join('\n');
}

// ─── Framework File Generator (deterministic, no AI) ─────────────────────────

/**
 * Generates a structured project library from recorded events:
 *   - One `locators/<PageName>.locators.ts` per visited page
 *   - One `tests/<test-name>.spec.ts` that imports from those locator files
 *   - A `playwright.config.ts` scoped to the project
 *
 * Unlike `generatePlaywrightScript()` (which embeds all locators inline),
 * this function separates locators into shared files so multiple tests can
 * re-use and extend them without duplication.
 */
function generateFrameworkFiles(
  events: RecordingEvent[],
  nlSteps: string[],
  startUrl: string,
  testName: string
): FrameworkFiles {
  const repo = buildObjectRepository(events);

  // ── Map each element repository key → page name (first occurrence wins) ───
  const keyToPage = new Map<string, string>();
  for (const evt of events) {
    const el = (evt as any).element as any;
    if (!el?.locatorData?.primary) continue;
    const eff = el.locatorData.effectiveEl;
    const key = eff.id
      || (eff.name        ? `name:${eff.name}`               : null)
      || (eff.placeholder ? `ph:${eff.placeholder}`           : null)
      || (eff.text        ? `text:${eff.text.slice(0, 40)}`   : null);
    if (!key || keyToPage.has(key)) continue;

    const rawUrl   = evt.url || startUrl;
    const pageName = _derivePageName(rawUrl);
    keyToPage.set(key, pageName);
  }

  // ── Group repo entries by page name (preserve insertion order per page) ───
  const pageLocators = new Map<string, Array<{ varName: string; expr: string }>>();
  for (const [key, entry] of repo.entries()) {
    const pageName = keyToPage.get(key) || _derivePageName(startUrl);
    if (!pageLocators.has(pageName)) pageLocators.set(pageName, []);
    pageLocators.get(pageName)!.push({ varName: entry.varName, expr: entry.playwrightExpr });
  }

  // ── Generate one .locators.ts file per page ───────────────────────────────
  const locatorFiles: LocatorFile[] = [];
  for (const [pageName, entries] of pageLocators.entries()) {
    const exportName = `${pageName}Locators`;

    // locators map: varName → "(page: Page) => <expr>"
    const locators: Record<string, string> = {};
    const locatorLines: string[] = [];
    for (const { varName, expr } of entries) {
      const fnExpr = `(page: Page) => ${expr}`;
      locators[varName] = fnExpr;
      locatorLines.push(`  // Uniqueness: verify | Stability: stable — XPath locator | Fallback: see all strategies in object repository`);
      locatorLines.push(`  ${varName}: ${fnExpr},`);
    }

    const content = [
      `import { Page } from '@playwright/test';`,
      ``,
      `export const ${exportName} = {`,
      ...locatorLines,
      `};`,
      ``,
    ].join('\n');

    locatorFiles.push({ pageName, exportName, locators, content });
  }

  // ── Generate test file ────────────────────────────────────────────────────
  // Start from the fully-generated standalone script, then:
  //   1. Insert import statements for each locator file
  //   2. Replace the inline `const L = { ... }` block with an import-based one
  const rawScript = generatePlaywrightScript(events, nlSteps, startUrl);

  // Import lines (one per page that has locators)
  const importLines = locatorFiles.map(lf =>
    `import { ${lf.exportName} } from '../locators/${lf.pageName}.locators';`
  );

  // New L block: each varName sourced from its page's locator export
  const newLLines: string[] = ['  const L = {'];
  for (const lf of locatorFiles) {
    for (const varName of Object.keys(lf.locators)) {
      newLLines.push(`    ${varName.padEnd(20)}: ${lf.exportName}.${varName}(page),`);
    }
  }
  newLLines.push('  };');
  newLLines.push('');

  // 1. Insert imports after the dotenv.config() line
  const DOTENV_LINE = `dotenv.config(); // Load .env so TEST_PASSWORD and other env vars are available`;
  let testContent = rawScript.replace(
    DOTENV_LINE,
    `${DOTENV_LINE}\n${importLines.join('\n')}`
  );

  // 2. Replace the Object Repository inline block with the import-based L block
  //    The block starts at "  // ─── Object Repository" and ends after "  };\n\n"
  //    (generatePlaywrightScript emits a blank line after the closing `};`)
  testContent = testContent.replace(
    /  \/\/ ─── Object Repository[\s\S]*?  \};\n\n/,
    newLLines.join('\n') + '\n'
  );

  // ── Generate playwright.config.ts for the project ────────────────────────
  const configContent = [
    `import { defineConfig } from '@playwright/test';`,
    `import * as dotenv from 'dotenv';`,
    `dotenv.config({ path: '../../.env' }); // Load root .env for TEST_PASSWORD etc.`,
    ``,
    `export default defineConfig({`,
    `  testDir: './tests',`,
    `  timeout: 180_000,`,
    `  retries: 0,`,
    `  reporter: 'list',`,
    `  use: {`,
    `    headless: false,`,
    `    viewport: null,`,
    `    launchOptions: {`,
    `      args: [`,
    `        '--start-maximized',`,
    `        '--disable-blink-features=AutomationControlled',`,
    `        '--no-sandbox',`,
    `        '--disable-infobars',`,
    `      ],`,
    `    },`,
    `    actionTimeout: 15_000,`,
    `    navigationTimeout: 30_000,`,
    `    screenshot: 'only-on-failure',`,
    `    video: 'retain-on-failure',`,
    `  },`,
    `});`,
    ``,
  ].join('\n');

  // ── Generate helpers/universal.ts ────────────────────────────────────────
  const universalHelpersContent = `import { Page, BrowserContext, Locator } from '@playwright/test';

const CONSENT_SELECTORS = [
  '#onetrust-accept-btn-handler','#onetrust-pc-btn-handler',
  '#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll','#CybotCookiebotDialogBodyButtonAccept',
  '.trustarc-agree-btn','.qc-cmp2-summary-buttons button:first-child',
  '.osano-cm-accept-all','#didomi-notice-agree-button','.fc-button.fc-cta-consent',
  'button[data-testid="uc-accept-all-button"]','#axeptio_btn_acceptAll','.cky-btn-accept',
  '#iubenda-cs-accept-btn','.klaro button.cm-btn-accept-all',
  'button[id*="accept"][id*="cookie" i]','button[class*="accept-all" i]',
  'button[class*="acceptAll" i]','[aria-label*="Accept all" i]',
];
const CONSENT_XPATH = [
  "//button[translate(normalize-space(.),'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz')='accept all cookies']",
  "//button[translate(normalize-space(.),'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz')='accept all']",
  "//button[translate(normalize-space(.),'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz')='allow all']",
  "//button[translate(normalize-space(.),'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz')='i agree']",
  "//button[translate(normalize-space(.),'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz')='got it']",
  "//a[translate(normalize-space(.),'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz')='accept all cookies']",
];
export async function dismissOverlays(page: Page): Promise<void> {
  for (const s of CONSENT_SELECTORS) { try { const el=page.locator(s).first(); if(await el.isVisible({timeout:800})){await el.click({timeout:3000});await page.waitForTimeout(600);return;} } catch{} }
  for (const x of CONSENT_XPATH) { try { const el=page.locator('xpath='+x).first(); if(await el.isVisible({timeout:400})){await el.click({timeout:2000});await page.waitForTimeout(600);return;} } catch{} }
}
export async function dismissPopups(page: Page): Promise<void> {
  const sels=['[role="dialog"] button[aria-label*="close" i]','[role="dialog"] button[class*="close" i]','.modal button[class*="close" i]','.popup button[class*="close" i]'];
  for(const s of sels){try{const el=page.locator(s).first();if(await el.isVisible({timeout:400})){await el.click({timeout:2000});await page.waitForTimeout(400);}}catch{}}
}
export async function waitForStableURL(page: Page, ms=15000): Promise<string> {
  let last='',stable=0,deadline=Date.now()+ms;
  while(Date.now()<deadline){await page.waitForTimeout(300);const u=page.url();if(u!=='about:blank'&&u===last){stable++;if(stable>=4)return u;}else{stable=0;last=u;}}
  return page.url();
}
export async function waitForPageReady(page: Page): Promise<void> {
  await page.waitForLoadState('domcontentloaded').catch(()=>{});
  await waitForStableURL(page,10000);
  await page.waitForLoadState('networkidle',{timeout:8000}).catch(()=>{});
}
export async function clickNewTab(context: BrowserContext, locator: Locator): Promise<Page> {
  const [newTab]=await Promise.all([context.waitForEvent('page',{timeout:15000}),locator.click()]);
  await newTab.waitForLoadState('domcontentloaded').catch(()=>{});
  await waitForStableURL(newTab,10000);
  return newTab as Page;
}
export async function hoverAndWait(locator: Locator, waitMs=600): Promise<void> {
  await locator.hover(); await locator.page().waitForTimeout(waitMs);
}
export async function tryLocators(page: Page, locators: string[], action: 'click'|'fill'|'check'='click', value?: string): Promise<boolean> {
  for(const loc of locators){try{const el=page.locator(loc).first();if(!(await el.isVisible({timeout:2000})))continue;if(action==='click')await el.click();else if(action==='fill'&&value)await el.fill(value);else if(action==='check')await (el as any).check();return true;}catch{}}return false;
}
export async function prepareSite(page: Page): Promise<void> {
  await waitForPageReady(page);
  await dismissOverlays(page);
  await dismissPopups(page);
}
`;

  // ═══════════════════════════════════════════════════════════════════════════
  // LAYER 2 — PAGE OBJECT CLASSES (pages/{PageName}.ts)
  // One class per page. Imports locators from Layer 1. Contains methods only.
  // ═══════════════════════════════════════════════════════════════════════════
  const pageFiles: PageClassFile[] = [];

  // Group events by page for method generation
  const eventsByPage = new Map<string, any[]>();
  for (const evt of events) {
    if (!evt.url || evt.type === 'page_load') continue;
    const pn = _derivePageName(evt.url || startUrl);
    if (!eventsByPage.has(pn)) eventsByPage.set(pn, []);
    eventsByPage.get(pn)!.push(evt);
  }

  eventsByPage.forEach((pageEvents, pageName) => {
    const locFile = locatorFiles.find(lf => lf.pageName === pageName);
    const className = pageName; // e.g. "FormSettingsPage"
    const methods: string[] = [];
    const methodLines: string[] = [];
    const usedMethodNames = new Set<string>();
    let needsKendo = false;

    for (const evt of pageEvents) {
      const el = (evt as any).element as any;
      const label = el?.label || el?.description || el?.elementId || '';
      const cleanName = _toCamel(label).replace(/Page$/, '');
      if (!cleanName || cleanName.length < 2) continue;

      let methodName = '';
      let methodBody = '';
      let methodSig = '';
      const strategy = el?.locatorData?.primary?.strategy || '';
      const kendoInputId = (evt as any).kendoInputId || el?.locatorData?.primary?.kendoInputId || el?.elementId || '';

      // Decision table for method generation
      if (evt.type === 'kendo_select' || strategy === 'kendo-dropdownlist') {
        methodName = `select${cleanName.charAt(0).toUpperCase() + cleanName.slice(1)}`;
        methodSig = `async ${methodName}(optionText: string)`;
        methodBody = `    await selectKendoDropdown(this.page, '${kendoInputId}', optionText);`;
        needsKendo = true;
      } else if (evt.type === 'kendo_date' || (evt as any).kendoWidgetType === 'datetimepicker' || (evt as any).kendoWidgetType === 'datepicker') {
        methodName = `set${cleanName.charAt(0).toUpperCase() + cleanName.slice(1)}Date`;
        methodSig = `async ${methodName}(dateValue: string)`;
        methodBody = `    await selectKendoDate(this.page, '${kendoInputId}', dateValue);`;
        needsKendo = true;
      } else if (strategy === 'kendo-treeview-checkbox') {
        const treeId = el?.locatorData?.primary?.kendoTreeId || '';
        methodName = `check${cleanName.charAt(0).toUpperCase() + cleanName.slice(1)}Node`;
        methodSig = `async ${methodName}(nodeValue: string, check: boolean = true)`;
        methodBody = `    await checkKendoTreeNode(this.page, '${treeId}', nodeValue, check);`;
        needsKendo = true;
      } else if (evt.type === 'kendo_grid_edit') {
        const gridId = (evt as any).gridId || '';
        methodName = `fillGridDates`;
        methodSig = `async ${methodName}()`;
        methodBody = `    await fillKendoGridDates(this.page, '${gridId}');`;
        needsKendo = true;
      } else if (evt.type === 'input' && !(evt as any).kendoWidgetType) {
        // Regular text fill
        const varName = Array.from(repo.values()).find(e => e.label === label)?.varName;
        if (!varName) continue;
        methodName = `fill${cleanName.charAt(0).toUpperCase() + cleanName.slice(1)}`;
        methodSig = `async ${methodName}(value: string)`;
        methodBody = `    await smartFill(this.L.${varName}, value);`;
      } else if (evt.type === 'click') {
        const varName = Array.from(repo.values()).find(e => e.label === label)?.varName;
        if (!varName) continue;
        const isButton = /Button$|Radio$/i.test(varName);
        const isLink = /Link$/i.test(varName);
        methodName = `click${cleanName.charAt(0).toUpperCase() + cleanName.slice(1)}`;
        methodSig = `async ${methodName}()`;
        methodBody = `    await smartClick(this.L.${varName});`;
        // Add alert dismiss after save/submit buttons
        if (/save|submit|done/i.test(label)) {
          needsKendo = true;
          methodBody += `\n    await waitAndDismissAnyKendoAlert(this.page);`;
        }
      } else if (evt.type === 'check') {
        const varName = Array.from(repo.values()).find(e => e.label === label)?.varName;
        if (!varName) continue;
        methodName = `enable${cleanName.charAt(0).toUpperCase() + cleanName.slice(1)}`;
        methodSig = `async ${methodName}()`;
        methodBody = `    await smartCheck(this.L.${varName});`;
      } else {
        continue; // skip unrecognized events
      }

      // Dedup method names
      if (usedMethodNames.has(methodName)) continue;
      usedMethodNames.add(methodName);
      methods.push(methodName);

      methodLines.push(`  ${methodSig} {`);
      methodLines.push(methodBody);
      methodLines.push(`  }`);
      methodLines.push(``);
    }

    // Build the page class content
    const locImport = locFile
      ? `import { ${locFile.exportName} } from '../locators/${locFile.pageName}.locators';`
      : '';
    const universalImports = `import { smartFill, smartClick, smartCheck, smartUncheck } from '../helpers/universal';`;
    const kendoImports = needsKendo
      ? `import { selectKendoDropdown, selectKendoDate, checkKendoTreeNode, fillKendoGridDates, waitAndDismissAnyKendoAlert } from '../helpers/kendo';`
      : '';

    const classContent = [
      `import { Page } from '@playwright/test';`,
      locImport,
      universalImports,
      kendoImports,
      ``,
      `export class ${className} {`,
      `  private page: Page;`,
      locFile ? `  private L: ReturnType<typeof ${locFile.exportName}>;` : '',
      ``,
      `  constructor(page: Page) {`,
      `    this.page = page;`,
      locFile ? `    this.L = ${locFile.exportName}(page);` : '',
      `  }`,
      ``,
      ...methodLines,
      `}`,
      ``,
    ].filter(Boolean).join('\n');

    pageFiles.push({ pageName, className, content: classContent, methods });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // LAYER 3 — BUSINESS ACTIONS (actions/workflow.actions.ts)
  // Composed workflow that calls page object methods in sequence.
  // ═══════════════════════════════════════════════════════════════════════════
  // ── Build actions file that calls page class methods ────────────────────
  // The actions file imports page classes and calls their methods in sequence.
  // NO locators or raw Playwright calls in the actions file.
  const fnName = `execute${testName.replace(/[^a-zA-Z0-9]/g, '')}Workflow`;

  // Build page class imports
  const pageClassImports = pageFiles
    .filter(pf => pf.methods.length > 0)
    .map(pf => `import { ${pf.className} } from '../pages/${pf.pageName}';`)
    .join('\n');

  const actionsContent = [
    `import { Page } from '@playwright/test';`,
    pageClassImports,
    `import { prepareSite } from '../helpers/universal';`,
    `import { selectKendoDropdown, selectKendoDate, waitAndDismissAnyKendoAlert, fillKendoGridDates } from '../helpers/kendo';`,
    ``,
    `export async function ${fnName}(`,
    `  page: Page,`,
    `  data: Record<string, any>`,
    `) {`,
    `  await page.goto(data.startUrl || '${startUrl}');`,
    `  await prepareSite(page);`,
    ``,
  ];

  // Build method call sequence from events using page classes
  let currentPageName = '';
  let currentPageVar = '';
  let lastUrl = startUrl;
  const usedPageVars = new Set<string>();

  for (const evt of events) {
    // Insert waitForURL when the page URL changes (navigation happened)
    if (evt.type === 'navigation' || evt.type === 'page_load') {
      const navUrl = (evt as any).toUrl || evt.url || '';
      if (navUrl && navUrl !== lastUrl && navUrl.startsWith('http')) {
        let cleanNav = navUrl;
        try {
          const u = new URL(navUrl);
          const dynParams = ['formId', 'id', 'recordId', '_gl', '_gcl_au'];
          let hasDyn = false;
          dynParams.forEach(p => { if (u.searchParams.has(p)) hasDyn = true; });
          if (hasDyn) cleanNav = u.origin + u.pathname + '**';
        } catch {}
        actionsContent.push(`  await page.waitForURL('**${cleanNav}', { waitUntil: 'domcontentloaded' });`);
        lastUrl = navUrl;
      }
      continue;
    }

    if (!evt.url) continue;
    const pn = _derivePageName(evt.url || startUrl);
    const pf = pageFiles.find(p => p.pageName === pn);
    if (!pf || pf.methods.length === 0) continue;

    // Instantiate page class when page changes
    if (pn !== currentPageName) {
      currentPageName = pn;
      currentPageVar = pn.charAt(0).toLowerCase() + pn.slice(1);
      if (!usedPageVars.has(currentPageVar)) {
        actionsContent.push(`  const ${currentPageVar} = new ${pf.className}(page);`);
        usedPageVars.add(currentPageVar);
      }
    }

    // Find the method in the page class that matches this event
    const el = (evt as any).element as any;
    const label = el?.label || el?.description || el?.elementId || '';
    const cleanName = _toCamel(label).replace(/Page$/, '');
    if (!cleanName || cleanName.length < 2) continue;

    const strategy = el?.locatorData?.primary?.strategy || '';
    let methodName = '';
    let methodArgs = '';

    // Match event to page class method using the same naming logic as page class generator
    if (evt.type === 'kendo_select' || strategy === 'kendo-dropdownlist') {
      methodName = `select${cleanName.charAt(0).toUpperCase() + cleanName.slice(1)}`;
      const text = ((evt as any).selectedText || '').replace(/'/g, "\\'");
      methodArgs = `'${text}'`;
    } else if (evt.type === 'kendo_date') {
      methodName = `set${cleanName.charAt(0).toUpperCase() + cleanName.slice(1)}Date`;
      const val = ((evt as any).formattedValue || (evt as any).value || '').replace(/'/g, "\\'");
      methodArgs = `'${val}'`;
    } else if (evt.type === 'kendo_grid_edit') {
      methodName = 'fillGridDates';
    } else if (evt.type === 'input') {
      methodName = `fill${cleanName.charAt(0).toUpperCase() + cleanName.slice(1)}`;
      const val = (evt.value || '').replace(/'/g, "\\'");
      methodArgs = `'${val}'`;
    } else if (evt.type === 'click') {
      methodName = `click${cleanName.charAt(0).toUpperCase() + cleanName.slice(1)}`;
    } else if (evt.type === 'check') {
      methodName = `enable${cleanName.charAt(0).toUpperCase() + cleanName.slice(1)}`;
    }

    // Only emit if the method exists in the page class
    if (methodName && pf.methods.includes(methodName)) {
      actionsContent.push(`  await ${currentPageVar}.${methodName}(${methodArgs});`);
    } else if (evt.type === 'click' || evt.type === 'input') {
      // Fallback: if method not found in page class, use waitForURL for navigation events
      // Skip silently — the page class doesn't have this method
    }
  }

  actionsContent.push(`}`);
  actionsContent.push(``);

  const actionsFile = {
    path: `actions/${testName.replace(/[^a-zA-Z0-9]/g, '')}.actions.ts`,
    content: actionsContent.join('\n')
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // LAYER 4 — TEST DATA FIXTURE (fixtures/test-data.ts)
  // All recorded values in one place. Dynamic values use functions.
  // ═══════════════════════════════════════════════════════════════════════════
  const dataEntries: string[] = [];
  const seenValues = new Set<string>();

  // Extract values from NL steps (works even when raw events lack metadata)
  for (const step of nlSteps) {
    const fillMatch = step.match(/Enter\s+"(.+?)"\s+in the\s+"(.+?)"\s+field/);
    if (fillMatch) {
      const val = fillMatch[1];
      const rawField = fillMatch[2];
      const fieldName = _toCamel(rawField.replace(/\[.*\]/, '').trim());
      if (seenValues.has(fieldName) || !val) continue;
      seenValues.add(fieldName);
      if (/FormName/i.test(fieldName)) {
        dataEntries.push(`  ${fieldName}: () => 'Test_' + Date.now(),`);
      } else if (/password/i.test(fieldName)) {
        dataEntries.push(`  ${fieldName}: process.env.TEST_PASSWORD || '${val.replace(/'/g, "\\'")}',`);
      } else {
        dataEntries.push(`  ${fieldName}: '${val.replace(/'/g, "\\'")}',`);
      }
    }
    const kendoMatch = step.match(/Select\s+"(.+?)"\s+from the\s+"(.+?)"\s+Kendo/);
    if (kendoMatch) {
      const fieldName = _toCamel(kendoMatch[2]);
      if (seenValues.has(fieldName)) continue;
      seenValues.add(fieldName);
      dataEntries.push(`  ${fieldName}: '${kendoMatch[1].replace(/'/g, "\\'")}',`);
    }
    const dateMatch = step.match(/Select date\s+"(.+?)"\s+in the\s+"(.+?)"/);
    if (dateMatch) {
      const fieldName = _toCamel(dateMatch[2]);
      if (seenValues.has(fieldName)) continue;
      seenValues.add(fieldName);
      dataEntries.push(`  ${fieldName}: '${dateMatch[1].replace(/'/g, "\\'")}',`);
    }
  }

  // Also extract from raw events (for Kendo events with metadata)
  for (const evt of events) {
    if (evt.type === 'input' && evt.value) {
      const el = (evt as any).element as any;
      const fieldName = _toCamel(el?.label || el?.elementId || 'field');
      if (seenValues.has(fieldName)) continue;
      seenValues.add(fieldName);

      if (/FormName/i.test(fieldName)) {
        dataEntries.push(`  ${fieldName}: () => 'Test_' + Date.now(),`);
      } else if ((evt as any).isMasked) {
        dataEntries.push(`  ${fieldName}: process.env.TEST_PASSWORD || '',`);
      } else {
        dataEntries.push(`  ${fieldName}: '${evt.value.replace(/'/g, "\\'")}',`);
      }
    } else if (evt.type === 'kendo_select') {
      const name = _toCamel((evt as any).kendoInputId || 'dropdown');
      if (seenValues.has(name)) continue;
      seenValues.add(name);
      dataEntries.push(`  ${name}: '${((evt as any).selectedText || '').replace(/'/g, "\\'")}',`);
    } else if (evt.type === 'kendo_date') {
      const name = _toCamel((evt as any).kendoInputId || 'date');
      if (seenValues.has(name)) continue;
      seenValues.add(name);
      dataEntries.push(`  ${name}: '${((evt as any).formattedValue || (evt as any).value || '').replace(/'/g, "\\'")}',`);
    }
  }

  const fixtureContent = [
    `import * as dotenv from 'dotenv';`,
    `dotenv.config();`,
    ``,
    `export const TestData = {`,
    `  startUrl: '${startUrl}',`,
    ...dataEntries,
    `};`,
    ``,
  ].join('\n');

  const fixtureFile = { path: 'fixtures/test-data.ts', content: fixtureContent };

  // ═══════════════════════════════════════════════════════════════════════════
  // LAYER 5 — CLEAN TEST SPEC (tests/{testName}.spec.ts)
  // Calls business actions only. No locators. No page.locator(). No helpers.
  // ═══════════════════════════════════════════════════════════════════════════
  const workflowFn = `execute${testName.replace(/[^a-zA-Z0-9]/g, '')}Workflow`;
  const cleanTestContent = [
    `import { test, expect } from '@playwright/test';`,
    `import { TestData } from '../fixtures/test-data';`,
    `import { ${workflowFn} } from '../actions/${testName.replace(/[^a-zA-Z0-9]/g, '')}.actions';`,
    ``,
    `test.describe('${testName}', () => {`,
    `  test('Execute recorded workflow', async ({ page }) => {`,
    `    await ${workflowFn}(page, TestData);`,
    `  });`,
    `});`,
    ``,
  ].join('\n');

  // Override testContent with the clean version for new projects
  // (keep the original rawScript-based version available as testContent for backward compat)
  const cleanSpec = cleanTestContent;

  return {
    locatorFiles,
    pageFiles,
    actionsFile,
    fixtureFile,
    testContent: cleanSpec,
    configContent,
    universalHelpersContent
  };
}

// ─── Client-side NL generator (mirrors server toNaturalLanguage) ─────────────

function nlFromEvent(type: string, event: any, stepNum: number): string | null {
  const el = event.element as any;
  const desc = el?.description || el?.label || 'element';
  const label = el?.label || desc;

  // Build locator hint from captured locator data (or fallback to id/name)
  function locHint(): string {
    const locData = el?.locatorData as any;
    const primary = locData?.primary;
    const elemId  = el?.elementId || '';
    const elemName = el?.elementName || '';
    if (primary?.strategy === 'id' && elemId)          return `[id=${elemId}]`;
    if (primary?.strategy === 'name' && elemName)      return `[name=${elemName}]`;
    if (primary?.strategy === 'data-testid') {
      const tid = locData?.effectiveEl?.testId || '';
      if (tid) return `[testid=${tid}]`;
    }
    if (elemId)   return `[id=${elemId}]`;
    if (elemName) return `[name=${elemName}]`;
    return '';
  }

  switch (type) {
    case 'click': {
      const tag = (el?.tag || '').toLowerCase();
      if (tag === 'a') return `Step ${stepNum}: Click link "${desc}"`;
      if (tag === 'button' || (tag === 'input' && (el?.inputType === 'submit' || el?.inputType === 'button')))
        return `Step ${stepNum}: Click button "${desc}"`;
      return `Step ${stepNum}: Click on "${desc}"`;
    }
    case 'input': {
      const val = event.isMasked ? '••••••••' : (event.value || '');
      return `Step ${stepNum}: Enter "${val}" in the "${label}${locHint()}" field`;
    }
    case 'check':
      return `Step ${stepNum}: Check the "${label}${locHint()}" checkbox`;
    case 'uncheck':
      return `Step ${stepNum}: Uncheck the "${label}${locHint()}" checkbox`;
    case 'select':
      return `Step ${stepNum}: Select "${event.displayText || event.value}" from "${label}${locHint()}"`;
    case 'navigation': {
      try { const p = new URL(event.toUrl || event.url).pathname; return `Step ${stepNum}: Navigate to ${p}`; }
      catch { return `Step ${stepNum}: Navigate to ${event.toUrl || event.url}`; }
    }
    case 'page_load':
      return `Step ${stepNum}: Page loaded — "${event.pageTitle || event.url}"`;
    default: return null;
  }
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface AssertElementInfo {
  tag: string;
  text: string;
  value: string;
  placeholder: string;
  ariaLabel: string;
  name: string;
  type: string;
  label: string;
  isInput: boolean;
  isCheckbox: boolean;
  isChecked: boolean;
  attrs: Record<string, string>;
  // Set to `true` when this is a synthetic info object for page-level
  // assertions (URL, title, snapshot) rather than a clicked element.
  isPageLevel?: boolean;
  // For page-level: the captured page URL and title at assert time.
  pageUrl?: string;
  pageTitleText?: string;
}

type AssertType =
  | 'text' | 'value' | 'visible' | 'hidden'
  | 'enabled' | 'disabled' | 'checked' | 'unchecked'
  | 'attribute' | 'count'
  | 'url' | 'title' | 'snapshot';
type AssertOp   = 'contains' | 'equals' | 'starts_with' | 'not_equals';

interface AssertConfig {
  assertType: AssertType;
  op: AssertOp;
  expected: string;
  attrName: string;         // used when assertType === 'attribute'
  failMode: 'hard' | 'soft';
  elementInfo: AssertElementInfo;
}

// ─── Assertion Panel Component ────────────────────────────────────────────────

function AssertionPanel({
  elementInfo,
  onConfirm,
  onCancel,
}: {
  elementInfo: AssertElementInfo;
  onConfirm: (cfg: AssertConfig) => void;
  onCancel: () => void;
}) {
  const isPageLevel = !!elementInfo.isPageLevel;

  // Pick smart default assert type based on element / page-level
  const defaultType: AssertType =
    isPageLevel              ? 'url'      :
    elementInfo.isCheckbox   ? 'checked'  :
    elementInfo.isInput      ? 'value'    : 'text';

  const [assertType, setAssertType] = useState<AssertType>(defaultType);
  const [op,         setOp]         = useState<AssertOp>('contains');
  const [expected,   setExpected]   = useState(() => {
    if (isPageLevel) return elementInfo.pageUrl || '';
    if (elementInfo.isCheckbox) return elementInfo.isChecked ? 'checked' : 'unchecked';
    if (elementInfo.isInput)    return elementInfo.value || elementInfo.placeholder;
    return elementInfo.text.slice(0, 80);
  });
  const [attrName,   setAttrName]   = useState('href');
  const [failMode,   setFailMode]   = useState<'hard' | 'soft'>('hard');

  const needsExpected = !['visible','hidden','enabled','disabled','checked','unchecked','snapshot'].includes(assertType);
  const needsAttr     = assertType === 'attribute';

  // Resolved human label for the element (same fallback chain as buildAssertNlStep)
  const elLabel = (
    elementInfo.label ||
    elementInfo.ariaLabel ||
    elementInfo.text.slice(0, 50) ||
    elementInfo.placeholder ||
    elementInfo.name ||
    (elementInfo.type ? `${elementInfo.type} ${elementInfo.tag}` : elementInfo.tag)
  ).slice(0, 50);

  // Live plain-English preview of what will be asserted
  const buildPreview = (): string => {
    const q = (s: string) => `"${s}"`;
    switch (assertType) {
      case 'visible':   return `Make sure ${q(elLabel)} is visible on the page`;
      case 'hidden':    return `Make sure ${q(elLabel)} is NOT visible on the page`;
      case 'enabled':   return `Make sure ${q(elLabel)} is enabled (not greyed out)`;
      case 'disabled':  return `Make sure ${q(elLabel)} is disabled`;
      case 'checked':   return `Make sure ${q(elLabel)} is checked`;
      case 'unchecked': return `Make sure ${q(elLabel)} is unchecked`;
      case 'text':      return `Make sure ${q(elLabel)} text ${op.replace('_',' ')} ${q(expected || '…')}`;
      case 'value':     return `Make sure ${q(elLabel)} input value ${op.replace('_',' ')} ${q(expected || '…')}`;
      case 'attribute': return `Make sure ${q(elLabel)} attribute "${attrName}" ${op.replace('_',' ')} ${q(expected || '…')}`;
      case 'count':     return `Make sure ${expected || '?'} elements matching ${q(elLabel)} exist`;
      case 'url':       return `Make sure the page URL ${op.replace('_',' ')} ${q(expected || '…')}`;
      case 'title':     return `Make sure the page title ${op.replace('_',' ')} ${q(expected || '…')}`;
      case 'snapshot':  return `Make sure the page screenshot matches the saved baseline`;
      default:          return `Assert ${q(elLabel)}`;
    }
  };

  // Update expected value when type changes
  const handleTypeChange = (t: AssertType) => {
    setAssertType(t);
    if (t === 'value')    setExpected(elementInfo.value || elementInfo.placeholder);
    else if (t === 'text') setExpected(elementInfo.text.slice(0, 80));
    else if (t === 'count') setExpected('1');
    else if (['checked','unchecked'].includes(t)) setExpected(t);
    else if (t === 'url')   setExpected(elementInfo.pageUrl || '');
    else if (t === 'title') setExpected(elementInfo.pageTitleText || '');
    else setExpected('');
  };

  const TYPES: { value: AssertType; label: string; icon: string }[] = isPageLevel ? [
    { value: 'url',        label: 'Page URL',         icon: '🌐' },
    { value: 'title',      label: 'Page title',       icon: '📑' },
    { value: 'snapshot',   label: 'Visual snapshot',  icon: '📸' },
  ] : [
    { value: 'text',       label: 'Text content', icon: '📝' },
    { value: 'value',      label: 'Input value',  icon: '✏️' },
    { value: 'visible',    label: 'Is visible',   icon: '👁' },
    { value: 'hidden',     label: 'Is hidden',    icon: '🙈' },
    { value: 'enabled',    label: 'Is enabled',   icon: '✅' },
    { value: 'disabled',   label: 'Is disabled',  icon: '🚫' },
    { value: 'checked',    label: 'Is checked',   icon: '☑️' },
    { value: 'unchecked',  label: 'Is unchecked', icon: '☐' },
    { value: 'attribute',  label: 'Attribute',    icon: '🏷' },
    { value: 'count',      label: 'Element count',icon: '#' },
  ];

  return (
    <div className="absolute bottom-0 left-0 right-0 z-50 bg-white border-t-2 border-amber-400 shadow-2xl shadow-gray-200/80">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-amber-500/20 bg-amber-500/5">
        <div className="flex items-center gap-2">
          <span className="text-sm">✓</span>
          <span className="text-xs font-bold text-amber-300">
            {isPageLevel ? 'Add Page Assertion' : 'Add Assertion'}
          </span>
          <span className="text-[10px] text-slate-500 ml-1 bg-slate-800 px-1.5 py-0.5 rounded font-mono truncate max-w-[260px]">
            {isPageLevel ? (
              <>page · "{(elementInfo.pageUrl || elementInfo.pageTitleText || '').slice(0, 50)}"</>
            ) : (
              <>{elementInfo.tag}{(() => {
                const l = elementInfo.label || elementInfo.ariaLabel || elementInfo.text.slice(0,40) || elementInfo.placeholder || elementInfo.name || elementInfo.type;
                return l ? ` · "${l.slice(0, 40)}"` : '';
              })()}</>
            )}
          </span>
        </div>
        <button onClick={onCancel} className="text-slate-600 hover:text-slate-400 text-sm leading-none px-1">✕</button>
      </div>

      {/* Live assertion preview */}
      <div className="px-4 py-2 bg-amber-50 border-b border-amber-100 flex items-center gap-2">
        <span className="text-amber-500 text-xs flex-shrink-0">👁</span>
        <span className="text-xs text-amber-800 font-medium italic truncate">{buildPreview()}</span>
      </div>

      <div className="px-4 py-3 grid grid-cols-[1fr_1fr_auto] gap-3 items-end">

        {/* Left col: type + operator */}
        <div className="space-y-2">
          <div>
            <label className="text-[10px] font-semibold text-slate-500 mb-1 block uppercase tracking-wider">Assert Type</label>
            <select
              value={assertType}
              onChange={e => handleTypeChange(e.target.value as AssertType)}
              className="w-full bg-white border border-gray-300 rounded-lg px-2.5 py-1.5 text-xs text-gray-800 outline-none focus:border-amber-400 transition-colors"
            >
              {TYPES.map(t => (
                <option key={t.value} value={t.value}>{t.icon} {t.label}</option>
              ))}
            </select>
          </div>
          {needsExpected && !needsAttr && (
            <div>
              <label className="text-[10px] font-semibold text-slate-500 mb-1 block uppercase tracking-wider">Match</label>
              <select
                value={op}
                onChange={e => setOp(e.target.value as AssertOp)}
                className="w-full bg-white border border-gray-300 rounded-lg px-2.5 py-1.5 text-xs text-gray-800 outline-none focus:border-amber-400 transition-colors"
              >
                <option value="contains">contains</option>
                <option value="equals">equals</option>
                <option value="starts_with">starts with</option>
                <option value="not_equals">does not equal</option>
              </select>
            </div>
          )}
        </div>

        {/* Middle col: expected value + attr name */}
        <div className="space-y-2">
          {needsAttr && (
            <div>
              <label className="text-[10px] font-semibold text-slate-500 mb-1 block uppercase tracking-wider">Attribute Name</label>
              <div className="flex gap-1">
                <input
                  value={attrName}
                  onChange={e => setAttrName(e.target.value)}
                  placeholder="e.g. href"
                  className="flex-1 bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white outline-none focus:border-amber-500 transition-colors"
                />
                {/* Quick attr suggestions */}
                {Object.keys(elementInfo.attrs).slice(0, 3).map(a => (
                  <button key={a} onClick={() => {
                    setAttrName(a);
                    setExpected(elementInfo.attrs[a]);
                  }} className="px-1.5 py-1 bg-slate-800 hover:bg-slate-700 text-[9px] text-slate-400 rounded border border-slate-700 transition-colors">
                    {a}
                  </button>
                ))}
              </div>
            </div>
          )}
          {needsExpected && (
            <div>
              <label className="text-[10px] font-semibold text-slate-500 mb-1 block uppercase tracking-wider">Expected Value</label>
              <input
                value={expected}
                onChange={e => setExpected(e.target.value)}
                placeholder="Enter expected value..."
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white placeholder-slate-600 outline-none focus:border-amber-500 transition-colors"
              />
            </div>
          )}
          {!needsExpected && (
            <div className="flex items-center h-full">
              <div className="text-[10px] text-gray-500 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 w-full">
                No expected value needed for state assertions
              </div>
            </div>
          )}
        </div>

        {/* Right col: failure mode + confirm */}
        <div className="space-y-2">
          <div>
            <label className="text-[10px] font-semibold text-slate-500 mb-1.5 block uppercase tracking-wider">On Failure</label>
            <div className="flex gap-1.5">
              {(['hard','soft'] as const).map(m => (
                <button key={m} onClick={() => setFailMode(m)}
                  className={`px-2.5 py-1.5 rounded-lg text-[10px] font-bold border transition-colors ${failMode === m ? (m === 'hard' ? 'bg-red-100 border-red-300 text-red-600' : 'bg-yellow-100 border-yellow-300 text-yellow-700') : 'bg-white border-gray-300 text-gray-500 hover:border-gray-400'}`}>
                  {m === 'hard' ? '⛔ Abort' : '⚠ Continue'}
                </button>
              ))}
            </div>
          </div>
          <button
            onClick={() => onConfirm({ assertType, op, expected, attrName, failMode, elementInfo })}
            className="w-full py-2 rounded-lg bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-white text-xs font-bold transition-all shadow-lg shadow-amber-500/20"
          >
            ✓ Add Assertion
          </button>
        </div>
      </div>
    </div>
  );
}

interface RecordingEvent {
  sequence: number;
  stepNum?: number;
  timestamp: number;
  type: string;
  url: string;
  pageTitle: string;
  naturalLanguage?: string | null;
  element?: {
    description?: string;
    label?: string;
    primarySelector?: string;
    elementId?: string;
    elementName?: string;
    placeholder?: string;
    locatorData?: LocatorData;    // injected by PW_RECORDER_INIT
  };
  value?: string;
  isMasked?: boolean;
  displayText?: string;
  method?: string;
  responseStatus?: number;
  fromUrl?: string;
  toUrl?: string;
  isNewTab?: boolean;
  inShadowDom?: boolean;
}

interface AgentInfo {
  id: string;
  label: string;
  icon: string;
  color: string;
  ringColor: string;
  status: "idle" | "active" | "done";
}

const AGENTS: AgentInfo[] = [
  { id: "recorder",  label: "Recorder",     icon: "⏺", color: "from-rose-400 to-red-500",       ringColor: "border-rose-400",    status: "idle" },
  { id: "analyzer",  label: "Analyzer",     icon: "🧠", color: "from-violet-400 to-purple-500",  ringColor: "border-violet-400",  status: "idle" },
  { id: "writer",    label: "Script Writer",icon: "⚡", color: "from-cyan-400 to-blue-500",      ringColor: "border-cyan-400",    status: "idle" },
  { id: "executor",  label: "Executor",     icon: "▶",  color: "from-emerald-400 to-green-500",  ringColor: "border-emerald-400", status: "idle" },
  { id: "fixer",     label: "Fixer",        icon: "🔧", color: "from-orange-400 to-red-400",     ringColor: "border-orange-400",  status: "idle" },
];

// ─── Browser Bar Component ───────────────────────────────────────────────────

function BrowserBar({
  sessionId, sessionStatus, extensionConnected, extensionInstalled, isCreatingSession,
  projectName, setProjectName,
  moduleName, setModuleName, tcId, setTcId, testCaseName, setTestCaseName,
  adoStoryId, setAdoStoryId,
  businessContext, setBusinessContext,
  onCreateSession, onStop, onProceed, onOpenUrl, onOpenWindow, onOpenPlaywright,
  nlStepsCount, eventsCount, isRecording, isDone,
  assertMode, onToggleAssert, onPageAssert, iframeUrl, isPlaywrightRecording,
}: any) {
  const [url, setUrl] = useState("https://");
  const [showConfig, setShowConfig] = useState(false);
  const [showModeInfo, setShowModeInfo] = useState(false);
  // On AWS hosting, server-side headed Chromium can't launch (no display on
  // EC2). Hide all "Record with Playwright" entry points and steer users to
  // the Chrome-extension flow instead.
  const { data: hostingConfig } = useHostingConfig();
  const isAwsHosted = hostingConfig?.hosting === "aws";

  const openUrl = () => {
    let target = url.trim();
    if (!target.startsWith("http://") && !target.startsWith("https://")) {
      target = "https://" + target;
    }
    onOpenUrl(target);
  };

  return (
    <div className="flex-shrink-0 border-b-2 border-slate-700 bg-slate-900 shadow-lg">

      {/* URL bar row */}
      <div className="flex items-center gap-2 px-3 py-2">

        {/* Browser nav dots */}
        <div className="flex items-center gap-1 flex-shrink-0">
          <div className="w-3 h-3 rounded-full bg-red-400/80" />
          <div className="w-3 h-3 rounded-full bg-yellow-400/80" />
          <div className="w-3 h-3 rounded-full bg-emerald-400/80" />
        </div>

        {/* Project Name */}
        <div className="flex items-center gap-1 flex-shrink-0">
          <span className="text-[10px] text-indigo-300 flex-shrink-0 font-medium">🏗</span>
          <input
            value={projectName}
            onChange={e => setProjectName(e.target.value)}
            placeholder="Project *"
            title="Project Name (required)"
            className={`w-28 bg-white/10 rounded-lg px-2 py-1.5 text-xs text-white placeholder-indigo-300 outline-none border transition-colors focus:bg-white/20 ${projectName.trim() ? 'border-white/20 focus:border-white/40' : 'border-red-400/60 focus:border-red-400 placeholder-red-300'}`}
          />
        </div>

        {/* URL input — min-w-0 lets the wrapper shrink past its content's
            intrinsic width so the trailing buttons (gear + Start Session)
            remain visible at narrower viewports / when the sidebar is open. */}
        <div className="flex-1 min-w-0 flex items-center gap-1.5 bg-white/10 border border-white/20 rounded-lg px-3 py-1.5 focus-within:border-white/40 focus-within:bg-white/15 transition-colors">
          <span className="text-indigo-300 text-xs flex-shrink-0">🔒</span>
          <input
            value={url}
            onChange={e => setUrl(e.target.value)}
            onKeyDown={e => e.key === "Enter" && openUrl()}
            placeholder="Enter URL to record (e.g. https://amerisure.com)"
            className="flex-1 bg-transparent text-xs text-white placeholder-indigo-300 outline-none min-w-0"
          />
          {url !== "https://" && url.length > 8 && (
            <button
              onClick={() => setUrl("https://")}
              className="text-indigo-300 hover:text-white text-xs flex-shrink-0"
            >✕</button>
          )}
        </div>

        {/* Recording action buttons — hidden when recording is done.
            Order matters: Playwright (primary, recommended) → Window (fallback) → Open (preview).
            On AWS, Playwright is hidden (no display on EC2) so Window becomes the primary path. */}
        {!(isDone && nlStepsCount > 0) && <>
          {/* PRIMARY: Record with Playwright — uses the Playwright library
              programmatic API (chromium.launch). Best assertion experience:
              assert mode survives every navigation, popups & iframes are
              auto-injected, locators are Playwright-native. */}
          {!isAwsHosted && (
            <button
              onClick={() => {
                let target = url.trim();
                if (!target.startsWith('http://') && !target.startsWith('https://')) target = 'https://' + target;
                onOpenPlaywright(target);
              }}
              disabled={(!url || url === "https://" || !projectName.trim()) && !isPlaywrightRecording}
              title={!projectName.trim() ? 'Enter a Project Name first' : 'Recommended — launches Playwright browser. Full assert support across navigations.'}
              className={`flex-shrink-0 px-3.5 py-1.5 rounded-lg text-white text-xs font-bold transition-all flex items-center gap-1.5 border shadow-sm
                ${isPlaywrightRecording
                  ? 'bg-red-500/50 border-red-400/40 hover:bg-red-500/70 animate-pulse'
                  : 'bg-emerald-500/60 hover:bg-emerald-500/80 border-emerald-400/50 disabled:bg-white/5 disabled:text-white/30 disabled:border-white/10 ring-1 ring-emerald-400/40'}`}
            >
              {isPlaywrightRecording
                ? <><span>⏹</span> Stop Playwright</>
                : <><span>🎭</span> Record with Playwright<span className="ml-1 px-1.5 py-0.5 rounded bg-white/20 text-[9px] uppercase tracking-wider">Recommended</span></>}
            </button>
          )}

          {/* FALLBACK: Record in Window — uses HTTP proxy + injected JS in a
              popup. Used when Playwright isn't available (AWS) or when the
              target site refuses to load in the iframe. */}
          <button
            onClick={() => {
              let target = url.trim();
              if (!target.startsWith('http://') && !target.startsWith('https://')) target = 'https://' + target;
              onOpenWindow(target);
            }}
            disabled={!url || url === "https://" || !projectName.trim()}
            title={!projectName.trim() ? 'Enter a Project Name first' : 'Fallback — opens a recording popup via HTTP proxy. Use when Playwright is unavailable.'}
            className={`flex-shrink-0 px-3 py-1.5 rounded-lg disabled:bg-white/5 disabled:text-white/30 border text-white text-xs font-semibold transition-all flex items-center gap-1.5
              ${isAwsHosted
                ? 'bg-violet-500/60 hover:bg-violet-500/80 border-violet-400/50 ring-1 ring-violet-400/40 shadow-sm'
                : 'bg-violet-500/30 hover:bg-violet-500/50 border-violet-400/25'}`}
          >
            <span>⧉</span> Record in Window
            {isAwsHosted && <span className="ml-1 px-1.5 py-0.5 rounded bg-white/20 text-[9px] uppercase tracking-wider">Recommended</span>}
          </button>

          {/* TERTIARY: Open in embedded iframe preview. No assertion guarantee
              across nav — use Playwright or Window for full assert workflows. */}
          <button
            onClick={openUrl}
            disabled={!url || url === "https://" || !projectName.trim()}
            title={!projectName.trim() ? 'Enter a Project Name first' : 'Preview — opens in the embedded iframe. Limited assert support.'}
            className="flex-shrink-0 px-2.5 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 disabled:bg-white/5 disabled:text-white/30 border border-white/15 text-white/80 text-xs font-medium transition-all flex items-center gap-1.5"
          >
            <span>↗</span> Open
          </button>

          {/* Info icon — explains the three modes */}
          <div className="relative flex-shrink-0">
            <button
              type="button"
              onClick={() => setShowModeInfo(v => !v)}
              onMouseEnter={() => setShowModeInfo(true)}
              onMouseLeave={() => setShowModeInfo(false)}
              title="What's the difference?"
              className="w-6 h-6 rounded-full bg-white/10 hover:bg-white/20 border border-white/20 text-white/70 hover:text-white text-[11px] font-bold transition-all flex items-center justify-center"
            >
              ⓘ
            </button>
            {showModeInfo && (
              <div className="absolute right-0 top-full mt-1.5 w-80 z-50 bg-slate-900 border border-slate-600 rounded-lg shadow-2xl p-3 text-[11px] text-slate-200 space-y-2">
                <div className="font-bold text-emerald-300 border-b border-slate-700 pb-1.5 mb-1">Which recording mode?</div>
                <div>
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <span className="text-emerald-400">🎭</span>
                    <span className="font-semibold text-emerald-300">Record with Playwright</span>
                    <span className="px-1 py-0.5 rounded bg-emerald-500/20 text-emerald-300 text-[9px] uppercase">Best</span>
                  </div>
                  <div className="text-slate-300 leading-snug pl-5">
                    Uses Playwright library directly. Assert mode survives every navigation. Works on any site.
                  </div>
                </div>
                <div>
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <span className="text-violet-400">⧉</span>
                    <span className="font-semibold text-violet-300">Record in Window</span>
                  </div>
                  <div className="text-slate-300 leading-snug pl-5">
                    Fallback for AWS / when Playwright isn't available. Uses HTTP proxy in a popup.
                  </div>
                </div>
                <div>
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <span className="text-slate-400">↗</span>
                    <span className="font-semibold text-slate-300">Open (iframe)</span>
                  </div>
                  <div className="text-slate-300 leading-snug pl-5">
                    Quick preview in the embedded iframe. Some sites refuse to be framed.
                  </div>
                </div>
              </div>
            )}
          </div>
        </>}

        {/* Generate Scripts — shown prominently when recording is done */}
        {isDone && nlStepsCount > 0 && (
          <button
            onClick={onProceed}
            className="flex-shrink-0 px-4 py-1.5 rounded-lg bg-emerald-400 hover:bg-emerald-300 text-emerald-900 text-sm font-bold transition-all flex items-center gap-2 shadow-md animate-pulse"
          >
            ✨ Generate Scripts →
          </button>
        )}

        {/* Re-record button — shown when done. Hidden on AWS for the same
            reason as the main "Record with Playwright" button above. */}
        {!isAwsHosted && isDone && nlStepsCount > 0 && (
          <button
            onClick={() => {
              let target = url.trim();
              if (!target.startsWith('http://') && !target.startsWith('https://')) target = 'https://' + target;
              onOpenPlaywright(target);
            }}
            title="Start a new recording"
            className="flex-shrink-0 px-2.5 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 border border-white/20 text-white/70 hover:text-white text-xs font-semibold transition-all flex items-center gap-1.5"
          >
            <span>🎭</span> Re-record
          </button>
        )}

        {/* Divider */}
        <div className="w-px h-5 bg-white/20 flex-shrink-0" />

        {/* Session + recording controls */}
        {sessionStatus === "idle" ? (
          <>
            <button
              onClick={() => setShowConfig(v => !v)}
              className="flex-shrink-0 px-2 py-1.5 rounded-lg border border-white/20 hover:border-white/40 text-white/70 hover:text-white text-xs transition-colors"
              title="Configure session"
            >⚙</button>
            <button
              onClick={onCreateSession}
              disabled={isCreatingSession || !projectName.trim()}
              title={!projectName.trim() ? 'Enter a Project Name first' : ''}
              className="flex-shrink-0 px-3 py-1.5 rounded-lg bg-white text-indigo-700 hover:bg-indigo-50 text-xs font-bold transition-all disabled:opacity-40 flex items-center gap-1.5 shadow-sm"
            >
              {isCreatingSession
                ? <><div className="w-2.5 h-2.5 border border-indigo-300 border-t-indigo-700 rounded-full animate-spin" />Starting...</>
                : <><span>⏺</span> Start Session</>}
            </button>
          </>
        ) : (
          <div className="flex items-center gap-2 flex-shrink-0">
            {/* Session code */}
            <div className="flex items-center gap-1.5 bg-white/10 border border-white/20 rounded-lg px-2.5 py-1.5">
              <div className={`w-1.5 h-1.5 rounded-full ${extensionConnected ? "bg-emerald-400 animate-pulse" : "bg-white/30"}`} />
              <span className="font-mono text-xs font-bold text-white tracking-wider">{sessionId}</span>
              <button onClick={() => navigator.clipboard.writeText(sessionId || "")} className="text-white/50 hover:text-white text-[10px]">📋</button>
            </div>

            {/* Status badge */}
            <span className={`text-[10px] font-bold px-2 py-1 rounded-md border ${
              isRecording
                ? "bg-red-500/20 text-red-200 border-red-400/30"
                : isDone
                ? "bg-emerald-500/20 text-emerald-200 border-emerald-400/30"
                : "bg-yellow-500/20 text-yellow-200 border-yellow-400/30"
            }`}>
              {isRecording ? "● REC" : isDone ? "✓ DONE" : "⏳ WAITING"}
            </span>

            {(isRecording || isPlaywrightRecording) && (
              <button onClick={onStop}
                className="px-2.5 py-1.5 rounded-lg bg-red-500/30 hover:bg-red-500/50 border border-red-400/30 text-red-200 text-xs font-semibold transition-all flex items-center gap-1">
                <div className="w-2 h-2 rounded-sm bg-red-400" /> Stop
              </button>
            )}

            {/* Assert Mode toggle — visible whenever any recording mode is active */}
            {(iframeUrl || isPlaywrightRecording || isRecording) && (
              <button
                onClick={onToggleAssert}
                title={assertMode ? 'Exit Assert Mode' : 'Enter Assert Mode — click elements to assert'}
                className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 border ${
                  assertMode
                    ? 'bg-amber-400/25 border-amber-400/40 text-amber-200'
                    : 'bg-white/10 border-white/20 text-white/80 hover:border-amber-400/40 hover:text-amber-200'
                }`}
              >
                {assertMode
                  ? <><div className="w-1.5 h-1.5 bg-amber-400 rounded-full animate-pulse" /> ✓ Asserting</>
                  : <>✓ Assert</>}
              </button>
            )}

            {/* Page-level Assert — URL, title, snapshot. No element pick required. */}
            {onPageAssert && (iframeUrl || isPlaywrightRecording || isRecording) && (
              <button
                onClick={onPageAssert}
                title="Assert page URL, title, or visual snapshot (no element pick needed)"
                className="px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 border bg-white/10 border-white/20 text-white/80 hover:border-sky-400/40 hover:text-sky-200"
              >
                <span>🌐</span> Page Assert
              </button>
            )}

            {/* Event count */}
            <span className="text-[10px] text-indigo-300">{eventsCount} events</span>
          </div>
        )}
      </div>

      {/* Extension instructions row (when waiting) */}
      {sessionStatus === "waiting" && (
        <div className="flex items-center gap-3 px-3 pb-2">
          {extensionInstalled ? (
            extensionConnected ? (
              <div className="flex items-center gap-3 text-[10px] bg-emerald-500/15 border border-emerald-400/30 rounded-lg px-3 py-1.5 w-full">
                <span className="text-emerald-400 flex-shrink-0 text-sm leading-none">✓</span>
                <span className="text-emerald-300 font-semibold">Extension linked — session {sessionId}</span>
                <span className="text-emerald-200/60 ml-auto">Navigate to your target website and interact with it</span>
              </div>
            ) : (
              <div className="flex items-center gap-3 text-[10px] bg-emerald-500/15 border border-emerald-400/30 rounded-lg px-3 py-1.5 w-full">
                <div className="w-3 h-3 border-2 border-emerald-400/30 border-t-emerald-400 rounded-full animate-spin flex-shrink-0" />
                <span className="text-emerald-300 font-semibold">Extension detected — auto-linking session {sessionId}...</span>
                <span className="text-emerald-200/60 ml-auto">Navigate to your target website and interact with it</span>
              </div>
            )
          ) : (
            <div className="flex flex-col gap-1.5 text-[10px] bg-amber-500/10 border border-amber-400/25 rounded-lg px-3 py-2 w-full">
              <div className="flex items-center gap-2">
                <span className="text-amber-300">⚠️</span>
                <span className="text-amber-200 font-semibold">Chrome Extension not detected — manual setup required:</span>
              </div>
              <div className="flex items-center gap-4 pl-5">
                {[
                  `Install & open the Astra QE Recorder extension`,
                  `Enter code: ${sessionId}`,
                  `Click Join → Start Recording`,
                  `Navigate to your target URL & interact`
                ].map((step, i) => (
                  <div key={i} className="flex items-center gap-1.5">
                    {i > 0 && <span className="text-white/30">→</span>}
                    <span className={i === 1 ? "text-yellow-300 font-mono font-bold" : "text-indigo-200"}>{step}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Collapsible config panel */}
      {showConfig && sessionStatus === "idle" && (
        <div className="px-3 pb-3 grid grid-cols-3 gap-2 border-t border-white/10 pt-2">
          <div>
            <label className="text-[10px] text-indigo-300 mb-1 block">Module / Feature *</label>
            <input value={moduleName} onChange={e => setModuleName(e.target.value)}
              placeholder="e.g. Form Settings"
              className={`w-full bg-white/10 border rounded px-2 py-1.5 text-xs text-white placeholder-indigo-400 outline-none focus:border-white/40 ${moduleName.trim() ? 'border-white/20' : 'border-red-400/60'}`} />
          </div>
          <div>
            <label className="text-[10px] text-indigo-300 mb-1 block">TC ID</label>
            <input value={tcId} onChange={e => setTcId(e.target.value)}
              placeholder="Auto: TC001"
              className="w-full bg-white/10 border border-white/20 rounded px-2 py-1.5 text-xs text-white placeholder-indigo-400 outline-none focus:border-white/40" />
          </div>
          <div>
            <label className="text-[10px] text-indigo-300 mb-1 block">Test Case Name *</label>
            <input value={testCaseName} onChange={e => setTestCaseName(e.target.value)}
              placeholder="e.g. Create form with fee"
              className={`w-full bg-white/10 border rounded px-2 py-1.5 text-xs text-white placeholder-indigo-400 outline-none focus:border-white/40 ${testCaseName.trim() ? 'border-white/20' : 'border-red-400/60'}`} />
          </div>
          <div>
            <label className="text-[10px] text-indigo-300 mb-1 block">ADO Story ID</label>
            <input value={adoStoryId} onChange={e => setAdoStoryId(e.target.value)}
              placeholder="e.g. C36-1789"
              className="w-full bg-white/10 border border-white/20 rounded px-2 py-1.5 text-xs text-white placeholder-indigo-400 outline-none focus:border-white/40" />
          </div>
          <div className="col-span-2">
            <label className="text-[10px] text-indigo-300 mb-1 block">Business Context</label>
            <input value={businessContext} onChange={e => setBusinessContext(e.target.value)}
              placeholder="Describe the app..."
              className="w-full bg-white/10 border border-white/20 rounded px-2 py-1.5 text-xs text-white placeholder-indigo-400 outline-none focus:border-white/40" />
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Agent Orb ────────────────────────────────────────────────────────────────

function AgentOrb({ agent }: { agent: AgentInfo }) {
  const isActive = agent.status === "active";
  const isDone   = agent.status === "done";
  const isIdle   = agent.status === "idle";
  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative flex items-center justify-center" style={{ width: 64, height: 64 }}>
        {/* Outer ring — solid color, spins when active */}
        <div
          className={`absolute inset-0 rounded-full border-[3px] transition-all ${
            isIdle   ? "border-slate-200" :
            isActive ? `${agent.ringColor} opacity-90` :
                       `${agent.ringColor} opacity-70`
          } ${isActive ? "animate-spin" : ""}`}
          style={{ animationDuration: "2.5s", borderTopColor: isActive ? "transparent" : undefined }}
        />
        {/* Inner filled circle */}
        <div
          className={`relative z-10 w-12 h-12 rounded-full flex items-center justify-center transition-all shadow-md ${
            isIdle   ? "bg-slate-100" :
            isDone   ? `bg-gradient-to-br ${agent.color} shadow-lg` :
                       `bg-gradient-to-br ${agent.color} shadow-lg`
          } ${isActive ? "scale-105" : ""}`}
        >
          {/* Checkmark badge bottom-right */}
          <div className={`absolute -bottom-0.5 -right-0.5 w-5 h-5 rounded-full flex items-center justify-center border-2 border-white shadow-sm transition-all ${
            isDone   ? "bg-emerald-500" :
            isActive ? `bg-gradient-to-br ${agent.color}` :
                       "bg-slate-200"
          }`}>
            <span className={`text-[9px] font-bold ${isDone || isActive ? "text-white" : "text-slate-400"}`}>
              {isDone ? "✓" : isActive ? "●" : "○"}
            </span>
          </div>
          {/* Main icon */}
          <span className={`text-lg leading-none transition-all ${isIdle ? "opacity-30 grayscale" : "text-white"}`}>
            {agent.icon}
          </span>
        </div>
        {/* Pulse ring when active */}
        {isActive && (
          <div className={`absolute inset-0 rounded-full border-2 ${agent.ringColor} animate-ping opacity-20`} />
        )}
      </div>
      <span className={`text-[12px] font-semibold tracking-tight transition-colors ${
        isActive ? "text-gray-900" :
        isDone   ? "text-emerald-600" :
                   "text-gray-400"
      }`}>
        {agent.label}
      </span>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

/** Translate raw Playwright errors into plain English for non-programmers */
function _friendlyError(raw: string): string {
  if (!raw) return 'An unknown error occurred';
  if (/TimeoutError|timeout.*exceeded/i.test(raw))
    return 'Element not found — the page may have changed or loaded too slowly';
  if (/strict mode violation|resolved to \d+ elements/i.test(raw))
    return 'Multiple matching elements — the locator is not specific enough';
  if (/net::ERR_NAME_NOT_RESOLVED|ERR_CONNECTION_REFUSED/i.test(raw))
    return 'Cannot reach the website — check your internet connection or URL';
  if (/Navigation timeout/i.test(raw))
    return 'Page took too long to load — try again or check your connection';
  if (/Element is not visible/i.test(raw))
    return 'Element exists but is hidden — it may be behind an overlay or not yet shown';
  if (/detached|no longer in the DOM/i.test(raw))
    return 'Page navigated away — the element disappeared after clicking';
  if (/not defined|ReferenceError/i.test(raw))
    return 'Script error — a variable is undefined. Re-generate the script.';
  if (/FAILED|failed/i.test(raw)) return 'The test step failed unexpectedly';
  return raw.replace(/\x1b\[[0-9;]*m/g, '').slice(0, 100);
}

export default function RecorderPage() {
  const [, navigate] = useLocation();

  // Hide AWS-incompatible "Record with Playwright" affordances. The hook is
  // backed by react-query with infinite cache, so calling it here and inside
  // BrowserBar costs only one network request app-wide.
  const { data: hostingConfig } = useHostingConfig();
  const isAwsHosted = hostingConfig?.hosting === "aws";

  const [sessionId, setSessionId]       = useState<string | null>(null);
  const [sessionStatus, setSessionStatus] = useState<"idle" | "waiting" | "recording" | "completed">("idle");
  const [isCreatingSession, setIsCreatingSession] = useState(false);
  const [extensionConnected, setExtensionConnected] = useState(false);
  const [extensionInstalled, setExtensionInstalled] = useState(false);
  const joinTokenRef = useRef<string | null>(null);
  const extensionIdRef = useRef<string>((window as any).__QE_EXTENSION_ID || "");

  const [events, setEvents]             = useState<RecordingEvent[]>([]);
  const [nlSteps, setNlSteps]           = useState<string[]>([]);
  const [latestScreenshot, setLatestScreenshot] = useState<string | null>(null);
  const [agents, setAgents]             = useState<AgentInfo[]>(AGENTS);
  const [aiSuggestion, setAiSuggestion] = useState<string | null>(null);
  const [iframeUrl, setIframeUrl]         = useState<string | null>(null);
  const [iframeLoading, setIframeLoading] = useState(false);
  const [iframeError, setIframeError]     = useState<{ reason: string; url: string } | null>(null);
  const [showScripts, setShowScripts]     = useState(false);
  const [generatedScript, setGeneratedScript] = useState<string>('');
  const [scriptCopied, setScriptCopied]   = useState(false);
  const [execId, setExecId]               = useState<string | null>(null);
  const [execOutput, setExecOutput]       = useState<{type:string;message:string}[]>([]);
  const [execStatus, setExecStatus]       = useState<'idle'|'running'|'passed'|'failed'>('idle');
  const [showExecute, setShowExecute]     = useState(false);
  const execOutputRef                     = useRef<HTMLDivElement>(null);
  // Setup check
  const [setupReady, setSetupReady]       = useState<boolean | null>(null); // null = checking
  const [setupError, setSetupError]       = useState<string>('');
  const [isInstalling, setIsInstalling]   = useState(false);
  const [installLog, setInstallLog]       = useState<string[]>([]);
  // Credentials (for password fields — replaces need for .env)
  const [credentials, setCredentials]     = useState<Record<string,string>>({});
  const [showCredentials, setShowCredentials] = useState(false);
  // Video playback
  const [videoUrl, setVideoUrl]           = useState<string | null>(null);

  // ─── Setup Check — verify Playwright is installed on mount ──────────────────
  useEffect(() => {
    fetch('/api/playwright/setup-check')
      .then(r => r.json())
      .then(d => { setSetupReady(d.ready); })
      .catch(() => setSetupReady(false));
  }, []);

  // ─── Install Playwright ──────────────────────────────────────────────────────
  const installPlaywright = useCallback(async () => {
    setIsInstalling(true);
    setInstallLog(['Starting installation...']);
    const res = await fetch('/api/playwright/install', { method: 'POST' });
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const parts = buf.split('\n\n'); buf = parts.pop() || '';
      for (const part of parts) {
        const line = part.replace(/^data: /, '').trim();
        if (!line) continue;
        try {
          const evt = JSON.parse(line);
          setInstallLog(prev => [...prev, evt.message]);
          if (evt.done) {
            setIsInstalling(false);
            setSetupReady(evt.message.includes('✅'));
          }
        } catch {}
      }
    }
  }, []);

  // ─── Detect required credentials from generated script ───────────────────────
  const requiredEnvVars = useMemo(() => {
    if (!generatedScript) return [];
    const matches = [...generatedScript.matchAll(/process\.env\.([A-Z_]+)!/g)];
    return [...new Set(matches.map(m => m[1]))];
  }, [generatedScript]);

  // AI Framework generation
  interface LocatorEntry { name: string; strategy: string; description: string; }
  interface FunctionEntry { name: string; description: string; stepCount: number; }
  interface FileMetadata {
    className?: string;
    locators?: LocatorEntry[];
    methods?: string[];
    snapshotUsed?: boolean;
    functions?: FunctionEntry[];
    testCaseName?: string;
    businessScenario?: string;
    businessActionsUsed?: string[];
    assertionsUsed?: string[];
  }
  interface GeneratedFile { path: string; content: string; type: string; metadata?: FileMetadata; }
  const [frameworkFiles, setFrameworkFiles]   = useState<GeneratedFile[]>([]);
  const [activeFilePath, setActiveFilePath]   = useState<string | null>(null);
  const [genStatus, setGenStatus]             = useState<{type:string;message:string}[]>([]);
  const [isGenerating, setIsGenerating]       = useState(false);
  const [showFramework, setShowFramework]     = useState(false);
  const [thinkingBlocks, setThinkingBlocks]   = useState<{label:string;content:string;open:boolean}[]>([]);
  const [showAudit, setShowAudit]             = useState(false);

  // ─── Locator Audit ────────────────────────────────────────────────────────────
  type AuditClass = 'STABLE' | 'ACCEPTABLE' | 'FRAGILE' | 'FORBIDDEN';
  interface AuditRow {
    elementName: string;
    file:        string;
    xpath:       string;
    classification: AuditClass;
    reason:      string;
    suggestedFix: string | null;
  }
  const [auditRows, setAuditRows] = useState<AuditRow[]>([]);

  /** Decide if an id attribute value looks auto-generated / unstable */
  function _isGeneratedId(val: string): boolean {
    if (!val) return false;
    if (/^\d+$/.test(val)) return true;                           // pure number
    if (/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(val)) return true; // GUID
    if (/^(mat-input|mat-select|mat-checkbox|mat-radio|ng-|_ng|react-|css-|sc-|ember)\d*/i.test(val)) return true;
    if (/^(input|select|textarea|form|field|item|row|col|cell|group|tab|panel)[-_]\d+$/i.test(val)) return true;
    if (/[a-f0-9]{5,}$/i.test(val) && /[a-f]{3,}/.test(val) && /\d{2,}/.test(val)) return true; // hex hash
    return false;
  }

  /** Classify a single XPath expression */
  function _classifyXPath(xpath: string): { cls: AuditClass; reason: string; fix: string | null } {
    const x = xpath.trim();

    // ── FORBIDDEN ──────────────────────────────────────────────────────────────
    // Absolute path from root
    if (/^\/html\b/i.test(x) || /^\/body\b/i.test(x)) {
      return { cls: 'FORBIDDEN', reason: 'Absolute path from /html or /body root — breaks on any page structure change', fix: '//element[@data-testid="..."] or //element[@id="..."]' };
    }
    // All-positional: contains [N] with no attribute selector at all
    if (/\[\d+\]/.test(x) && !/@[a-z]/i.test(x) && !/text\(\)/.test(x)) {
      return { cls: 'FORBIDDEN', reason: 'Pure index-based path — no attribute anchors, breaks on UI reorder', fix: '//button[@data-testid="submit"] or //button[normalize-space(text())="Submit"]' };
    }
    // Mixed positional with no stable attr (e.g. //div[3]/button[2])
    if (/\/[a-z]+\[\d+\]\/[a-z]+\[\d+\]/i.test(x) && !/@(id|data-testid|name|aria-label|placeholder)/i.test(x)) {
      return { cls: 'FORBIDDEN', reason: 'Chained positional indexes with no stable attribute — extremely brittle', fix: '//button[@data-testid="..."] or //button[normalize-space(text())="..."]' };
    }

    // ── FRAGILE ────────────────────────────────────────────────────────────────
    // Auto-generated @id
    const idMatch = x.match(/@id\s*=\s*["']([^"']+)["']/i);
    if (idMatch && _isGeneratedId(idMatch[1])) {
      return { cls: 'FRAGILE', reason: `ID "${idMatch[1]}" appears auto-generated and will change across builds/envs`, fix: `//element[@name="fieldName"] or //element[@placeholder="..."] or //element[@aria-label="..."]` };
    }
    // Positional index mixed with attribute (acceptable-ish but still fragile)
    if (/\[\d+\]/.test(x) && /@[a-z]/i.test(x)) {
      return { cls: 'FRAGILE', reason: 'Uses positional index combined with attribute — index portion breaks on reorder', fix: x.replace(/\[\d+\]/g, '') + ' (remove index portion)' };
    }
    // Very long chain (> 5 steps deep from anchor)
    const slashCount = (x.match(/\//g) || []).length;
    if (slashCount > 6) {
      return { cls: 'FRAGILE', reason: `Deep structural path (${slashCount} levels) — any intermediate element change breaks it`, fix: 'Anchor to a closer stable parent: //*[@id="section"]//button[text()="..."]' };
    }
    // class-only selectors
    if (/^\/\/[a-z]+\[@class\s*=/i.test(x) && !/@(id|data-testid|name|aria-label|placeholder)/i.test(x)) {
      return { cls: 'FRAGILE', reason: 'Class-only selector — CSS classes change frequently with styling updates', fix: '//element[@data-testid="..."] or //element[@name="..."] or semantic text XPath' };
    }

    // ── STABLE ─────────────────────────────────────────────────────────────────
    if (/@data-testid\s*=/i.test(x)) return { cls: 'STABLE', reason: 'data-testid is a dedicated test attribute — intentionally stable', fix: null };
    if (/@data-automation-id\s*=/i.test(x)) return { cls: 'STABLE', reason: 'data-automation-id is a dedicated automation attribute', fix: null };
    if (/@aria-label\s*=/i.test(x)) return { cls: 'STABLE', reason: 'aria-label is tied to accessibility — typically stable', fix: null };
    if (idMatch && !_isGeneratedId(idMatch[1])) return { cls: 'STABLE', reason: `ID "${idMatch[1]}" is a hand-authored stable identifier`, fix: null };
    if (/@name\s*=/i.test(x) && /input|select|textarea/i.test(x)) return { cls: 'STABLE', reason: 'name attribute on form controls — stable and semantically meaningful', fix: null };

    // ── ACCEPTABLE ─────────────────────────────────────────────────────────────
    if (/@name\s*=/i.test(x)) return { cls: 'ACCEPTABLE', reason: 'name attribute — generally stable but not dedicated for testing', fix: null };
    if (/@placeholder\s*=/i.test(x)) return { cls: 'ACCEPTABLE', reason: 'placeholder — stable if UI copy is not frequently changed', fix: null };
    if (/normalize-space\(text\(\)\)|contains\(text\(\)/i.test(x)) return { cls: 'ACCEPTABLE', reason: 'Semantic text locator — stable unless visible label text changes', fix: null };
    if (/@type\s*=.*@(name|placeholder|value)/i.test(x)) return { cls: 'ACCEPTABLE', reason: 'Attribute combination — reasonably stable', fix: null };

    // Default: acceptable (has some attribute anchor)
    if (/@[a-z]/i.test(x)) return { cls: 'ACCEPTABLE', reason: 'Has attribute selector — acceptable but consider a more unique anchor', fix: null };

    return { cls: 'FRAGILE', reason: 'Could not determine stable anchor — review manually', fix: '//element[@data-testid="..."] or //element[@id="..."]' };
  }

  /** Parse all locator files and build the audit rows */
  function runLocatorAudit() {
    const rows: AuditRow[] = [];
    const locatorFiles = frameworkFiles.filter(f => f.type === 'pom' && f.path.startsWith('locators/'));

    for (const file of locatorFiles) {
      // Match: varName: (page: Page) => page.locator('xpath=EXPR')  — any quote style
      // Handles escaped inner quotes (e.g. \'Solutions\' inside a single-quoted string)
      // and raw inner single quotes inside double-quoted or backtick strings.
      //   Group 2 → captured from single-quoted  'xpath=...'
      //   Group 3 → captured from double-quoted  "xpath=..."
      //   Group 4 → captured from backtick       `xpath=...`
      const pattern = /(\w+)\s*:\s*\(page\s*:\s*Page\)\s*=>\s*page\.locator\(\s*(?:'xpath=((?:[^'\\]|\\.)*)'|"xpath=((?:[^"\\]|\\.)*)"|`xpath=([^`]*)`)\s*\)/g;
      let m: RegExpExecArray | null;
      while ((m = pattern.exec(file.content)) !== null) {
        const name = m[1];
        // Whichever quote style matched — unescape backslash-escaped chars for display
        const rawXpath = (m[2] ?? m[3] ?? m[4] ?? '').replace(/\\(['"`\\])/g, '$1');
        const { cls, reason, fix } = _classifyXPath(rawXpath);
        rows.push({ elementName: name, file: file.path.split('/').pop() || file.path, xpath: rawXpath, classification: cls, reason, suggestedFix: fix });
      }
    }
    setAuditRows(rows);
    setShowAudit(true);
  }

  // Self-healing Fixer
  const [isHealing, setIsHealing]             = useState(false);
  const [healLog, setHealLog]                 = useState<string[]>([]);

  // Assert mode
  const [assertMode, setAssertMode]           = useState(false);
  const [pendingAssert, setPendingAssert]     = useState<AssertElementInfo | null>(null);
  const iframeRef                             = useRef<HTMLIFrameElement>(null);
  // Mirror of assertMode for use inside message/BroadcastChannel handlers that
  // are registered once and capture stale state. Needed so we can re-send the
  // assert toggle to a freshly loaded page (the injected script's local
  // assertMode var resets to false on every navigation).
  const assertModeRef                         = useRef(false);
  useEffect(() => { assertModeRef.current = assertMode; }, [assertMode]);

  // Save to Library
  const [showSaveModal, setShowSaveModal]     = useState(false);
  const [saveTestName, setSaveTestName]       = useState('');
  const [saveFolderId, setSaveFolderId]       = useState('f-modules');
  const [saveFolders, setSaveFolders]         = useState<{id:string;name:string;parentId:string|null}[]>([]);
  const [saveStatus, setSaveStatus]           = useState<'idle'|'saving'|'saved'|'error'>('idle');
  const [savedTestId, setSavedTestId]         = useState<string|null>(null);

  // Project library state
  const [frameworkFilesResult, setFrameworkFilesResult] = useState<FrameworkFiles | null>(null);
  const [projectSaveStatus, setProjectSaveStatus]       = useState<'idle'|'saving'|'saved'|'error'>('idle');
  const [projectSavedFiles, setProjectSavedFiles]       = useState<{ written: string[]; merged: string[] } | null>(null);
  const [existingLocators, setExistingLocators]         = useState<{ pageName: string; keyCount: number }[]>([]);
  // AI framework save state
  const [aiSaveStatus, setAiSaveStatus]   = useState<'idle'|'saving'|'saved'|'error'>('idle');
  const [aiSaveResult, setAiSaveResult]   = useState<{ written: string[]; skipped: string[]; merged: string[] } | null>(null);

  // Context
  const [projectName, setProjectName]   = useState("");
  const [moduleName, setModuleName]     = useState("");
  const [tcId, setTcId]                 = useState("");
  const [testCaseName, setTestCaseName] = useState("");
  const [businessContext, setBusinessContext] = useState("");
  const [adoStoryId, setAdoStoryId]     = useState("");

  // Auto-fetch next TC ID when project name changes
  useEffect(() => {
    if (!projectName.trim()) { setTcId(''); return; }
    fetch(`/api/projects/${encodeURIComponent(projectName.trim())}/next-tc-id`)
      .then(r => r.json())
      .then(data => { if (data.nextTcId) setTcId(data.nextTcId); })
      .catch(() => setTcId('TC001'));
  }, [projectName]);

  // Auto-save state (triggered on Stop Recording when project context is filled)
  const [autoSaveStatus, setAutoSaveStatus] = useState<string>('idle');
  const [autoSaveResult, setAutoSaveResult] = useState<any>(null);
  const [autoSaveError, setAutoSaveError] = useState('');

  // Playwright recording state — declared here (before stopRecording) to avoid TDZ
  const [isPlaywrightRecording, setIsPlaywrightRecording] = useState(false);

  const sseRef        = useRef<EventSource | null>(null);
  const scriptRef     = useRef<HTMLTextAreaElement>(null);
  const iframeStepRef = useRef<number>(0); // step counter for iframe events
  const eventsRef     = useRef<RecordingEvent[]>([]); // latest events for autoGenerateAndSave
  const nlStepsRef    = useRef<string[]>([]);          // latest nlSteps for autoGenerateAndSave
  // Keep refs in sync with state (so autoGenerateAndSave reads latest values)
  useEffect(() => { eventsRef.current = events; }, [events]);
  useEffect(() => { nlStepsRef.current = nlSteps; }, [nlSteps]);

  // ─── Extension Detection (via postMessage bridge + externally_connectable) ──

  useEffect(() => {
    // Method 1: postMessage bridge — works without knowing extension ID
    const handlePong = (event: MessageEvent) => {
      if (event.source !== window) return;
      if (event.data?.type === 'DEVXQE_PONG' && event.data?.installed) {
        console.log(`[QE-Ext] Extension detected via postMessage bridge`, event.data);
        setExtensionInstalled(true);
        if (event.data.sessionId) setExtensionConnected(true);
      }
    };
    window.addEventListener('message', handlePong);

    const pingViaPostMessage = () => {
      window.postMessage({ type: 'DEVXQE_PING' }, '*');
    };
    pingViaPostMessage();
    const pmInterval = setInterval(pingViaPostMessage, 5000);

    // Method 2: externally_connectable — works if extension ID is known
    const extId = extensionIdRef.current;
    let ecInterval: ReturnType<typeof setInterval> | null = null;
    if (extId) {
      const detect = () => {
        try {
          (chrome as any).runtime.sendMessage(extId, { type: 'PING' }, (resp: any) => {
            if (chrome.runtime.lastError || !resp) return;
            setExtensionInstalled(true);
            if (resp.connected) setExtensionConnected(true);
          });
        } catch {}
      };
      detect();
      ecInterval = setInterval(detect, 8000);
    }

    return () => {
      window.removeEventListener('message', handlePong);
      clearInterval(pmInterval);
      if (ecInterval) clearInterval(ecInterval);
    };
  }, []);

  // Auto-provide session to extension when session is created and extension is detected
  useEffect(() => {
    if (!extensionInstalled || !sessionId) return;

    // Prefer the server-configured public WS URL when present (e.g. on AWS where
    // API Gateway HTTP API rejects WebSocket upgrades, so the extension must
    // connect directly to the EC2 host on port 4000). Fall back to the page
    // origin for localhost and any deployment that supports WS on the same host.
    const fallbackWsUrl = window.location.origin.replace('http://', 'ws://').replace('https://', 'wss://');
    const wsUrl = (hostingConfig?.extensionWsPublicUrl || fallbackWsUrl).replace(/\/+$/, '');
    console.log(`[QE-Ext] Auto-providing session ${sessionId} to extension (serverUrl: ${wsUrl})`);

    // Method 1: postMessage bridge — always works
    window.postMessage({
      type: 'DEVXQE_PROVIDE_SESSION',
      sessionId,
      joinToken: joinTokenRef.current || null,
      serverUrl: wsUrl,
    }, '*');

    // Method 2: externally_connectable — if extension ID is known
    const extId = extensionIdRef.current;
    if (extId) {
      console.log(`[QE-Ext] Also sending via externally_connectable (extId: ${extId})`);
      try {
        (chrome as any).runtime.sendMessage(extId, {
          type: 'SET_SERVER_URL',
          serverUrl: wsUrl,
        }, () => {});
        (chrome as any).runtime.sendMessage(extId, {
          type: 'PROVIDE_SESSION',
          sessionId,
          joinToken: joinTokenRef.current,
        }, () => {});
      } catch {}
    }
  }, [extensionInstalled, sessionId, hostingConfig?.extensionWsPublicUrl]);

  // ─── Create Session ─────────────────────────────────────────────────────────

  const createSession = useCallback(async () => {
    setIsCreatingSession(true);
    try {
      console.log(`[QE-Session] Creating session...`);
      const res = await fetch("/api/recorder/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ metadata: { projectName, moduleName, tcId, testCaseName, businessContext, adoStoryId, applicationUrl: '' } })
      });
      const data = await res.json();
      console.log(`[QE-Session] Session created: ${data.sessionId}, joinToken: ${data.joinToken ? 'yes' : 'no'}`);
      setSessionId(data.sessionId);
      joinTokenRef.current = data.joinToken || null;
      setSessionStatus("waiting");
      setAgents(prev => prev.map(a => a.id === "recorder" ? { ...a, status: "active" } : a));
      connectSSE(data.sessionId);
    } catch (err) {
      console.error(`[QE-Session] Failed to create session:`, err);
    } finally {
      setIsCreatingSession(false);
    }
  }, [projectName, businessContext, adoStoryId]);

  // ─── SSE ────────────────────────────────────────────────────────────────────

  function connectSSE(sid: string) {
    sseRef.current?.close();
    const sseUrl = `/api/recorder/sessions/${sid}/events`;
    console.log(`[QE-SSE] Opening EventSource: ${sseUrl}`);
    const sse = new EventSource(sseUrl);
    sseRef.current = sse;

    sse.onopen = () => {
      console.log(`[QE-SSE] Connection opened successfully`);
    };
    sse.onerror = (err) => {
      console.error(`[QE-SSE] Connection error — readyState: ${sse.readyState}`, err);
    };

    sse.addEventListener("connected", (e) => {
      try {
        const data = JSON.parse((e as MessageEvent).data);
        console.log(`[QE-SSE] ← connected event:`, data);
        const validStatuses = ["idle", "waiting", "recording", "completed"];
        if (data.status === "completed" && data.eventCount === 0) {
          setSessionStatus("waiting");
        } else {
          const status = validStatuses.includes(data.status) ? data.status : "waiting";
          setSessionStatus(status);
        }
      } catch {}
    });

    sse.addEventListener("extension_connected", () => {
      console.log(`[QE-SSE] ← extension_connected`);
      setExtensionConnected(true);
      setSessionStatus("recording");
      setAgents(prev => prev.map(a => a.id === "recorder" ? { ...a, status: "active" } : a));
    });

    sse.addEventListener("extension_disconnected", () => {
      console.log(`[QE-SSE] ← extension_disconnected`);
      setExtensionConnected(false);
    });

    sse.addEventListener("recording_event", (e) => {
      let event: RecordingEvent;
      try { event = JSON.parse((e as MessageEvent).data); } catch { return; }
      console.log(`[QE-SSE] ← recording_event: type=${event.type}, url=${event.url}, NL=${event.naturalLanguage || '(none)'}`);
      const appOrigin = window.location.origin;
      const recorderPath = `${appOrigin}/qe/recorder`;
      if (event.url && event.url.startsWith(recorderPath)) {
        console.log(`[QE-SSE] ← recording_event FILTERED (from recorder page itself)`);
        return;
      }

      // Transition to recording state on first real event (covers Playwright mode where
      // extension_connected never fires)
      setSessionStatus(prev => prev === 'waiting' ? 'recording' : prev);

      // Assert element picked in Playwright assert mode — open assertion panel
      if ((event as any).type === 'assert_element') {
        setPendingAssert((event as any).elementInfo as AssertElementInfo);
        return;
      }

      setEvents(prev => [...prev, event]);

      // Add natural language step — with deduplication and cleanup
      if (event.naturalLanguage) {
        setNlSteps(prev => {
          // ── Skip duplicate input after dropdown select for the same field
          // When user picks from a dropdown, both "Select X from dropdown" AND
          // "Enter X in field" fire — keep only the Select, drop the Enter
          const isInputStep = /^Step \d+: Enter ".+" in the ".+" field/i.test(event.naturalLanguage!);
          if (isInputStep) {
            const inputFieldMatch = event.naturalLanguage!.match(/in the "(.+?)" field/i);
            if (inputFieldMatch) {
              const fieldKey = inputFieldMatch[1].toLowerCase();
              // Check if the last real step was a Select on the same field
              const lastStep = prev[prev.length - 1] || '';
              const isLastSelect = /Select ".+" from the ".+" dropdown/i.test(lastStep) ||
                                   /Select ".+" from the ".+" Kendo/i.test(lastStep);
              if (isLastSelect) {
                const selectFieldMatch = lastStep.match(/from the "(.+?)" (?:dropdown|Kendo)/i);
                if (selectFieldMatch) {
                  const selectField = selectFieldMatch[1].toLowerCase();
                  if (selectField.includes(fieldKey) || fieldKey.includes(selectField)) {
                    return prev; // drop duplicate input step
                  }
                }
              }
            }
          }

          // ── Skip "Navigate to" if immediately preceded by a click that caused it
          const isNavigateStep = /^Step \d+: Navigate to /i.test(event.naturalLanguage!);
          if (isNavigateStep) {
            const lastStep = prev[prev.length - 1] || '';
            if (/^Step \d+: Click (link|button)/i.test(lastStep)) return prev; // redundant navigation
          }

          // Re-number to local position — server stamps steps using session.events.length
          // which may carry over from a previous recording in the same session.
          const localNum  = prev.length + 1;
          const renumbered = event.naturalLanguage!.replace(/^Step \d+:/, `Step ${localNum}:`);
          const updated = [...prev, renumbered];
          // Scroll textarea to bottom
          setTimeout(() => {
            if (scriptRef.current) {
              scriptRef.current.scrollTop = scriptRef.current.scrollHeight;
            }
          }, 50);
          return updated;
        });
        // Show AI suggestion flash
        setAiSuggestion(event.naturalLanguage);
        setTimeout(() => setAiSuggestion(null), 2000);
      }
    });

    sse.addEventListener("screenshot", (e) => {
      const data = JSON.parse((e as MessageEvent).data);
      if (data.dataUrl) setLatestScreenshot(data.dataUrl);
    });

    sse.addEventListener("recording_completed", () => {
      setSessionStatus("completed");
      setExtensionConnected(false);
      setAgents(prev => prev.map(a =>
        a.id === "recorder" ? { ...a, status: "done" } :
        a.id === "analyzer" ? { ...a, status: "active" } : a
      ));
    });

    sse.addEventListener("recording_stopped", (e) => {
      try {
        const data = JSON.parse((e as MessageEvent).data);
        if (data.reason === 'browser_closed') {
          setIsPlaywrightRecording(false);
          setSessionStatus("completed");
        }
      } catch {}
    });
  }

  // ─── Auto-Generate & Save (triggered on Stop when project context exists) ───
  const autoGenerateAndSave = useCallback(async () => {
    try {
      // Phase 1: Generate
      setAutoSaveStatus('generating');
      setAgents(prev => prev.map(a =>
        a.id === 'analyzer' ? { ...a, status: 'active' } : a
      ));

      // Use refs to get latest events/nlSteps (closure may be stale due to setTimeout)
      const currentEvents = eventsRef.current;
      const currentNlSteps = nlStepsRef.current;

      // Derive the recording URL from events
      let originUrl = '';
      const firstHttpEvent = currentEvents.find(e => e.url && e.url.startsWith('http'));
      if (firstHttpEvent) {
        originUrl = firstHttpEvent.url;
      }

      const tn = testCaseName || 'Recorded Flow';
      const rawScript = generatePlaywrightScript(currentEvents, currentNlSteps, originUrl);
      setGeneratedScript(cleanupGeneratedScript(rawScript));
      const frameworkResult = generateFrameworkFiles(currentEvents, currentNlSteps, originUrl, tn);
      setFrameworkFilesResult(frameworkResult);

      // Populate the Script Writer file tree from framework result
      // (so "View Files" works even without AI agent)
      const displayFiles: GeneratedFile[] = [];
      for (const lf of frameworkResult.locatorFiles || []) {
        displayFiles.push({ path: `locators/${lf.pageName}.locators.ts`, content: lf.content, type: 'pom' });
      }
      for (const pf of frameworkResult.pageFiles || []) {
        displayFiles.push({ path: `pages/${pf.pageName}.ts`, content: pf.content, type: 'pom' });
      }
      if (frameworkResult.actionsFile) {
        displayFiles.push({ path: frameworkResult.actionsFile.path, content: frameworkResult.actionsFile.content, type: 'business_action' });
      }
      if (frameworkResult.fixtureFile) {
        displayFiles.push({ path: frameworkResult.fixtureFile.path, content: frameworkResult.fixtureFile.content, type: 'config' });
      }
      if (frameworkResult.testContent) {
        displayFiles.push({ path: `tests/${tn.toLowerCase().replace(/[^a-z0-9]/g, '-')}.spec.ts`, content: frameworkResult.testContent, type: 'test' });
      }
      if (frameworkResult.configContent) {
        displayFiles.push({ path: 'playwright.config.ts', content: frameworkResult.configContent, type: 'config' });
      }
      setFrameworkFiles(displayFiles);
      setIsGenerating(false);

      setAgents(prev => prev.map(a =>
        a.id === 'analyzer' ? { ...a, status: 'done' } :
        a.id === 'writer'   ? { ...a, status: 'active' } : a
      ));

      // Phase 2: Save to project
      setAutoSaveStatus('saving');
      const saveTestName = `${tcId}_${testCaseName.replace(/[^a-zA-Z0-9]/g, '')}`;

      const saveRes = await fetch('/api/projects/save-framework', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectName: projectName.trim(),
          testName: saveTestName,
          moduleName: moduleName.trim(),
          tcId,
          locatorFiles: frameworkResult.locatorFiles,
          pageFiles: frameworkResult.pageFiles || [],
          actionsFile: frameworkResult.actionsFile || null,
          fixtureFile: frameworkResult.fixtureFile || null,
          testContent: frameworkResult.testContent,
          configContent: frameworkResult.configContent,
          universalHelpersContent: frameworkResult.universalHelpersContent,
        }),
      });

      if (!saveRes.ok) throw new Error('Save failed: ' + (await saveRes.text()));
      const saveData = await saveRes.json();

      // Phase 3: Show result
      setAgents(prev => prev.map(a =>
        a.id === 'writer' ? { ...a, status: 'done' } : a
      ));
      setAutoSaveStatus('done');
      setAutoSaveResult({
        tcId,
        projectName: projectName.trim(),
        moduleName: moduleName.trim(),
        written: saveData.written || [],
        merged: saveData.merged || [],
      });
      setShowFramework(true);

    } catch (err: any) {
      setAutoSaveStatus('error');
      setAutoSaveError(err.message || String(err));
      console.error('Auto-save failed:', err);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectName, moduleName, tcId, testCaseName, adoStoryId, businessContext]);

  // ─── Stop ────────────────────────────────────────────────────────────────────

  const stopRecording = useCallback(async () => {
    if (!sessionId) return;
    // Close the Playwright browser first if it's still open
    if (isPlaywrightRecording) {
      try { await fetch(`/api/recorder/playwright-stop/${sessionId}`, { method: 'DELETE' }); } catch {}
      setIsPlaywrightRecording(false);
    }
    await fetch(`/api/recorder/sessions/${sessionId}`, { method: "DELETE" });
    setSessionStatus("completed");
    setAgents(prev => prev.map(a =>
      a.id === "recorder" ? { ...a, status: "done" } :
      a.id === "analyzer" ? { ...a, status: "active" } : a
    ));

    // Auto-generate & save if project context is filled in
    // If not filled: do nothing extra, user clicks Generate Scripts manually
    if (projectName.trim() && moduleName.trim() && testCaseName.trim()) {
      // Small delay to let final events flush from SSE
      setTimeout(() => autoGenerateAndSave(), 500);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, isPlaywrightRecording, projectName, moduleName, testCaseName]);

  const proceedToGenerate = useCallback(async () => {
    let originUrl = '';

    if (iframeUrl) {
      // Iframe mode — extract real URL from proxy path
      try {
        const match = iframeUrl.match(/\/api\/recorder\/browse\?url=(.+)/);
        originUrl = match ? decodeURIComponent(match[1]) : iframeUrl;
      } catch { originUrl = iframeUrl; }
    } else if (recordingWindowUrl.current) {
      // Window mode — use the URL stored when the window was opened
      originUrl = recordingWindowUrl.current;
    } else {
      // Last resort — find the real URL from the first page_load event
      // (event.url = window.location.href inside the proxy = proxy path with encoded target)
      const firstPageEvent = events.find(e => e.url && e.url.includes('/api/recorder/browse'));
      if (firstPageEvent?.url) {
        try {
          const match = firstPageEvent.url.match(/\/api\/recorder\/browse\?url=(.+)/);
          originUrl = match ? decodeURIComponent(match[1]) : '';
        } catch {}
      }
      // If still empty, try the raw URL from any event
      if (!originUrl) {
        const anyUrl = events.find(e => e.url && e.url.startsWith('http'))?.url || '';
        originUrl = anyUrl;
      }
    }

    // Also keep raw script for quick-execute fallback
    const rawScript = generatePlaywrightScript(events, nlSteps, originUrl);
    setGeneratedScript(cleanupGeneratedScript(rawScript));

    // ── Always generate framework files (5-layer POM) ─────────────────────────
    // Previously gated by projectName.trim() — now always runs so the
    // POM Framework tab is available immediately after "Generate Scripts".
    {
      const firstStep2 = nlSteps.find(s => !/Page loaded/.test(s));
      const tn = projectName.trim() || (firstStep2 ? firstStep2.replace(/^Step \d+:\s*/, '').slice(0, 60) : 'Recorded Flow');
      const frameworkResult = generateFrameworkFiles(events, nlSteps, originUrl, tn);
      setFrameworkFilesResult(frameworkResult);
      setProjectSaveStatus('idle');
      setProjectSavedFiles(null);

      // Populate file tree from framework result (works without AI agent)
      const pomFiles: GeneratedFile[] = [];
      for (const lf of frameworkResult.locatorFiles || []) {
        pomFiles.push({ path: `locators/${lf.pageName}.locators.ts`, content: lf.content, type: 'pom' });
      }
      for (const pf of frameworkResult.pageFiles || []) {
        pomFiles.push({ path: `pages/${pf.pageName}.ts`, content: pf.content, type: 'pom' });
      }
      if (frameworkResult.actionsFile) {
        pomFiles.push({ path: frameworkResult.actionsFile.path, content: frameworkResult.actionsFile.content, type: 'business_action' });
      }
      if (frameworkResult.fixtureFile) {
        pomFiles.push({ path: frameworkResult.fixtureFile.path, content: frameworkResult.fixtureFile.content, type: 'config' });
      }
      if (frameworkResult.testContent) {
        pomFiles.push({ path: `tests/${tn.toLowerCase().replace(/[^a-z0-9]/g, '-')}.spec.ts`, content: frameworkResult.testContent, type: 'test' });
      }
      if (frameworkResult.configContent) {
        pomFiles.push({ path: 'playwright.config.ts', content: frameworkResult.configContent, type: 'config' });
      }
      if (pomFiles.length) setFrameworkFiles(pomFiles);

      // Fetch existing locators for the project (for the merge-badge preview)
      if (projectName.trim()) {
        fetch(`/api/projects/${encodeURIComponent(projectName.trim())}/locators`)
          .then(r => r.json())
          .then(data => {
            if (data.files) {
              setExistingLocators(data.files.map((f: any) => ({ pageName: f.pageName, keyCount: f.keyCount })));
            }
          })
          .catch(() => {});
      }
    }

    // Start AI framework generation
    setIsGenerating(true);
    setFrameworkFiles([]);
    setGenStatus([]);
    setThinkingBlocks([]);
    setShowFramework(true);
    setAiSaveStatus('idle');
    setAiSaveResult(null);
    setAgents(prev => prev.map(a =>
      a.id === "analyzer" ? { ...a, status: "done" } :
      a.id === "writer"   ? { ...a, status: "active" } : a
    ));

    const firstStep = nlSteps.find(s => !/Page loaded/.test(s));
    const testName = firstStep ? firstStep.replace(/^Step \d+:\s*/, '').slice(0, 60) : 'Recorded Flow';

    // Polling-based generation. The server kicks off the job and returns a
    // jobId; we then poll for incremental events. Streaming was previously used
    // but it gets cut off at 30s by AWS API Gateway HTTP API, well before
    // generation completes (typical run 60-180s).
    try {
      const startRes = await fetch('/api/playwright/generate-framework', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nlSteps, startUrl: originUrl, testName, events })
      });
      if (!startRes.ok) {
        const errText = await startRes.text().catch(() => '');
        throw new Error(`Failed to start generation (HTTP ${startRes.status}) ${errText}`.trim());
      }
      const { jobId } = await startRes.json() as { jobId: string };
      if (!jobId) throw new Error('Server did not return a jobId');

      const POLL_INTERVAL_MS = 1500;
      const MAX_POLL_DURATION_MS = 30 * 60 * 1000;
      const pollDeadline = Date.now() + MAX_POLL_DURATION_MS;
      let cursor = 0;

      while (true) {
        if (Date.now() > pollDeadline) {
          throw new Error('Generation timed out — please retry');
        }
        await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));

        const pollRes = await fetch(`/api/playwright/generate-framework/${jobId}?since=${cursor}`);
        if (pollRes.status === 404) throw new Error('Generation job expired — please retry');
        if (!pollRes.ok) {
          // Transient failure (e.g. brief gateway hiccup) — retry next tick.
          continue;
        }
        const poll = await pollRes.json() as {
          status: 'running' | 'done' | 'error';
          cursor: number;
          events: Array<{ type: string; [k: string]: any }>;
          done: boolean;
        };

        for (const evt of poll.events) {
          if (evt.type === 'file' && evt.file) {
            setFrameworkFiles(prev => [...prev, evt.file]);
            setActiveFilePath(p => p || evt.file.path);
          } else if (evt.type === 'status') {
            setGenStatus(prev => [...prev, { type: 'status', message: evt.message }]);
          } else if (evt.type === 'error') {
            setGenStatus(prev => [...prev, { type: 'error', message: evt.message }]);
          } else if (evt.type === 'thinking') {
            setThinkingBlocks(prev => [...prev, { label: evt.label, content: evt.content, open: false }]);
            setGenStatus(prev => [...prev, { type: 'thinking', message: `💭 Reasoning captured: ${evt.label}` }]);
          } else if (evt.type === 'done') {
            setAgents(prev => prev.map(a => a.id === "writer" ? { ...a, status: "done" } : a));
          }
        }
        cursor = poll.cursor;

        if (poll.done) break;
      }
    } catch (err: any) {
      setGenStatus(prev => [...prev, { type: 'error', message: `Generation failed: ${err.message}` }]);
    } finally {
      setIsGenerating(false);
    }
  }, [events, nlSteps, iframeUrl]);

  const startExecution = useCallback(async () => {
    if (!generatedScript) return;
    setExecOutput([]);
    setExecStatus('running');
    setShowExecute(true);
    setAgents(prev => prev.map(a =>
      a.id === "writer"   ? { ...a, status: "done" } :
      a.id === "executor" ? { ...a, status: "active" } : a
    ));

    try {
      setVideoUrl(null);
      const res = await fetch('/api/playwright/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ script: generatedScript, credentials })
      });
      const { execId: eid } = await res.json();
      setExecId(eid);

      // Polling-based output capture. The SSE stream variant is kept on the
      // server for local-dev back-compat, but on AWS API Gateway HTTP API the
      // SSE response is killed at ~30s — well before a typical Playwright run
      // finishes, which made every execution falsely report as failed.
      const POLL_INTERVAL_MS = 1000;
      const MAX_POLL_DURATION_MS = 15 * 60 * 1000;
      const pollDeadline = Date.now() + MAX_POLL_DURATION_MS;
      let cursor = 0;
      let runDone = false;
      let visualDone = false;

      while (true) {
        if (Date.now() > pollDeadline) {
          setExecOutput(prev => [...prev, { type: 'fail', message: 'Execution timed out — please retry' }]);
          setExecStatus('failed');
          break;
        }
        await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));

        let pollRes: Response;
        try {
          pollRes = await fetch(`/api/playwright/execute/${eid}?since=${cursor}`);
        } catch {
          // Transient network blip — retry next tick.
          continue;
        }
        if (pollRes.status === 404) {
          setExecOutput(prev => [...prev, { type: 'fail', message: 'Execution expired on server' }]);
          setExecStatus('failed');
          break;
        }
        if (!pollRes.ok) continue;

        const poll = await pollRes.json() as {
          status: 'running' | 'passed' | 'failed';
          cursor: number;
          events: Array<{ type: string; [k: string]: any }>;
          done: boolean;
        };

        if (poll.events.length > 0) {
          setExecOutput(prev => {
            const next = [...prev, ...poll.events];
            setTimeout(() => { if (execOutputRef.current) execOutputRef.current.scrollTop = execOutputRef.current.scrollHeight; }, 30);
            return next;
          });

          for (const event of poll.events) {
            if (event.type === 'done') {
              runDone = true;
              setExecStatus(event.status === 'passed' ? 'passed' : 'failed');
              setAgents(prev => prev.map(a =>
                a.id === "executor" ? { ...a, status: event.status === 'passed' ? 'done' : 'idle' } :
                a.id === "fixer"    ? { ...a, status: event.status !== 'passed' ? 'active' : 'idle' } : a
              ));
              // On failure, check for video recording
              if (event.status !== 'passed') {
                setTimeout(() => {
                  fetch(`/api/playwright/video/${eid}`).then(r => {
                    if (r.ok) setVideoUrl(`/api/playwright/video/${eid}?t=${Date.now()}`);
                  }).catch(() => {});
                }, 2000);
              }
            }
            if (event.type === 'visual_analysis_done') {
              visualDone = true;
            }
          }
        }
        cursor = poll.cursor;

        // Stop once the run finished AND any visual analysis pass also wrapped
        // up. On a passing run there's no visual analysis at all, so runDone
        // alone is enough; on failure we wait for visual_analysis_done so the
        // user can read Claude's analysis.
        if (poll.done && (runDone && (visualDone || poll.status === 'passed'))) break;
        // Server flags done but we never saw the done event — still bail to
        // avoid an infinite loop (defensive; should not normally happen).
        if (poll.done && cursor === poll.cursor && poll.events.length === 0) break;
      }
    } catch (err: any) {
      setExecOutput([{ type: 'fail', message: `Error: ${err.message}` }]);
      setExecStatus('failed');
    }
  }, [generatedScript, credentials]);

  // ─── Self-Healing Fixer ─────────────────────────────────────────────────────

  const startHealing = useCallback(async () => {
    if (!generatedScript || execStatus !== 'failed') return;

    // Extract page URL — works for both iframe and window recording modes
    let pageUrl = '';
    if (iframeUrl) {
      try { const m = iframeUrl.match(/url=(.+)/); pageUrl = m ? decodeURIComponent(m[1]) : ''; } catch {}
    } else if (recordingWindowUrl.current) {
      pageUrl = recordingWindowUrl.current;
    }

    // Send all output to Fixer — Playwright call log (which has the locator) can appear in any line type
    const errorText = execOutput.map(l => l.message).join('\n');

    setIsHealing(true);
    setHealLog([]);
    setAgents(prev => prev.map(a => a.id === "fixer" ? { ...a, status: "active" } : a));

    // Polling-based heal flow. Heal can take 10-90s (DOM snapshot + Claude
    // round-trip), which exceeds the AWS API Gateway HTTP API ~30s timeout.
    // The SSE variant of this endpoint is no longer served — POST now returns
    // { jobId } and we poll GET /api/playwright/heal-script/:jobId?since=N.
    try {
      const startRes = await fetch('/api/playwright/heal-script', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ script: generatedScript, errorOutput: errorText, pageUrl })
      });
      if (!startRes.ok) {
        const errText = await startRes.text().catch(() => '');
        throw new Error(`Failed to start heal (HTTP ${startRes.status}) ${errText}`.trim());
      }
      const { jobId } = await startRes.json() as { jobId: string };
      if (!jobId) throw new Error('Server did not return a heal jobId');

      const POLL_INTERVAL_MS = 1000;
      const MAX_POLL_DURATION_MS = 5 * 60 * 1000;
      const pollDeadline = Date.now() + MAX_POLL_DURATION_MS;
      let cursor = 0;

      while (true) {
        if (Date.now() > pollDeadline) {
          setHealLog(prev => [...prev, '❌ Heal timed out — please retry']);
          break;
        }
        await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));

        let pollRes: Response;
        try {
          pollRes = await fetch(`/api/playwright/heal-script/${jobId}?since=${cursor}`);
        } catch {
          continue;
        }
        if (pollRes.status === 404) {
          setHealLog(prev => [...prev, '❌ Heal job expired on server']);
          break;
        }
        if (!pollRes.ok) continue;

        const poll = await pollRes.json() as {
          status: 'running' | 'done' | 'error';
          cursor: number;
          events: Array<{ type: string; [k: string]: any }>;
          done: boolean;
        };

        for (const evt of poll.events) {
          if (evt.type === 'status') {
            setHealLog(prev => [...prev, evt.message]);
          } else if (evt.type === 'healed') {
            setGeneratedScript(evt.healedScript);
            setHealLog(prev => [...prev,
              `✅ Healed! Replaced:`,
              `  ❌ ${evt.brokenLocator}`,
              `  ✓  ${evt.healedLocator}`
            ]);
            setAgents(prev => prev.map(a => a.id === "fixer" ? { ...a, status: "done" } : a));
            setTimeout(() => startExecution(), 800);
          } else if (evt.type === 'no_locator') {
            setHealLog(prev => [...prev, '⚠️ ' + evt.message]);
          } else if (evt.type === 'error') {
            setHealLog(prev => [...prev, '❌ ' + evt.message]);
          }
        }
        cursor = poll.cursor;

        if (poll.done) break;
      }
    } catch (err: any) {
      setHealLog(prev => [...prev, `Error: ${err.message}`]);
    } finally {
      setIsHealing(false);
    }
  }, [generatedScript, execStatus, execOutput, iframeUrl, startExecution]);

  // ─── Save to Library ────────────────────────────────────────────────────────

  const openSaveModal = useCallback(async () => {
    // Fetch folders for the picker
    try {
      const res = await fetch('/api/test-library/folders');
      const folders = await res.json();
      setSaveFolders(folders);
    } catch {}
    // Pre-fill test name from first NL step or fallback
    const firstStep = nlSteps.find(s => !/Page loaded/.test(s));
    setSaveTestName(firstStep ? firstStep.replace(/^Step \d+:\s*/, '').slice(0, 60) : 'Recorded Flow');
    setSaveFolderId('f-modules');
    setSaveStatus('idle');
    setShowSaveModal(true);
  }, [nlSteps]);

  /**
   * Save framework files (locators + test spec + config) to the project folder
   * on disk under projects/<projectName>/.
   * Locator files are merged if they already exist — existing locators are never
   * overwritten (they may have been manually edited).
   */
  const saveToProjectLibrary = useCallback(async () => {
    if (!frameworkFilesResult || !projectName.trim() || !saveTestName.trim()) return;
    setProjectSaveStatus('saving');
    try {
      // 1. Save framework files to disk
      const res = await fetch('/api/projects/save-framework', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectName: projectName.trim(),
          testName: saveTestName.trim(),
          locatorFiles: frameworkFilesResult.locatorFiles,
          pageFiles: frameworkFilesResult.pageFiles || [],
          actionsFile: frameworkFilesResult.actionsFile || null,
          fixtureFile: frameworkFilesResult.fixtureFile || null,
          testContent: frameworkFilesResult.testContent,
          configContent: frameworkFilesResult.configContent,
          universalHelpersContent: frameworkFilesResult.universalHelpersContent,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Save failed');
      setProjectSavedFiles({ written: data.written, merged: data.merged });
      setProjectSaveStatus('saved');

      // 2. Also register in Test Library so the project appears in the sidebar
      await fetch('/api/test-library/tests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          folderId: saveFolderId || 'f-modules',
          name: saveTestName.trim(),
          url: '',
          script: frameworkFilesResult.testContent || generatedScript || '// see project files',
          nlSteps,
          projectName: projectName.trim(),
        }),
      });
    } catch {
      setProjectSaveStatus('error');
    }
  }, [frameworkFilesResult, projectName, saveTestName, saveFolderId, generatedScript, nlSteps]);

  /**
   * Save AI-generated framework files to the project folder on disk.
   * Applies smart skip/merge rules — shared files are created once,
   * locator files are merged, test specs are always written as new files.
   */
  const saveAiFrameworkToProject = useCallback(async () => {
    if (!frameworkFiles.length || !projectName.trim()) return;
    setAiSaveStatus('saving');
    setAiSaveResult(null);
    try {
      // 1. Save framework files to disk
      const res = await fetch('/api/projects/save-ai-framework', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectName: projectName.trim(),
          files: frameworkFiles,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Save failed');
      setAiSaveResult({ written: data.written, skipped: data.skipped, merged: data.merged });
      setAiSaveStatus('saved');

      // 2. Also register in Test Library so the project appears in the sidebar
      // Use the test spec file content if available, otherwise fall back to generatedScript
      const specFile = frameworkFiles.find(f => f.type === 'test' || f.path.endsWith('.spec.ts'));
      const scriptContent = specFile?.content || generatedScript;
      const firstStep = nlSteps.find(s => !/Page loaded/.test(s));
      const testName = firstStep ? firstStep.replace(/^Step \d+:\s*/, '').slice(0, 60) : 'Recorded Flow';
      if (scriptContent) {
        await fetch('/api/test-library/tests', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            folderId: 'f-modules',
            name: testName,
            url: '',
            script: scriptContent,
            nlSteps,
            projectName: projectName.trim(),
          }),
        });
      }
    } catch {
      setAiSaveStatus('error');
    }
  }, [frameworkFiles, projectName, generatedScript, nlSteps]);

  const saveToLibrary = useCallback(async () => {
    if (!generatedScript || !saveTestName.trim()) return;
    setSaveStatus('saving');
    try {
      const res = await fetch('/api/test-library/tests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          folderId: saveFolderId,
          name: saveTestName.trim(),
          url: iframeUrl ? decodeURIComponent(iframeUrl.replace('/api/recorder/browse?url=', '')) : '',
          script: generatedScript,
          nlSteps,
          ...(projectName.trim() ? { projectName: projectName.trim() } : {})
        })
      });
      const data = await res.json();
      setSavedTestId(data.id);
      setSaveStatus('saved');
    } catch {
      setSaveStatus('error');
    }
  }, [generatedScript, saveTestName, saveFolderId, nlSteps, iframeUrl]);

  const handleOpenUrl = useCallback(async (targetUrl: string) => {
    setIframeLoading(true);
    setIframeError(null);
    iframeStepRef.current = 0;
    setNlSteps([]);
    setEvents([]);
    setAssertMode(false);
    setPendingAssert(null);

    // Pre-check reachability before loading iframe — avoids blank/native-error pages
    try {
      const check = await fetch(`/api/recorder/check-url?url=${encodeURIComponent(targetUrl)}`).then(r => r.json());
      if (!check.reachable) {
        setIframeLoading(false);
        setIframeError({ reason: check.reason || 'network_error', url: targetUrl });
        return;
      }
      // Site is reachable but sets X-Frame-Options/CSP that blocks framing
      if (check.blocksFraming) {
        setIframeError({ reason: 'blocks_framing', url: targetUrl });
        // Still try to load (proxy strips these headers) but warn the user
      }
    } catch {
      // If check-url itself fails, proceed anyway and let the proxy handle it
    }

    setIframeUrl(`/api/recorder/browse?url=${encodeURIComponent(targetUrl)}`);
  }, []);

  // ── Playwright-based recorder ─────────────────────────────────────────────
  const handleOpenPlaywright = useCallback(async (targetUrl: string) => {
    // Ensure a session exists first
    let sid = sessionId;
    if (!sid) {
      try {
        const r = await fetch('/api/recorder/sessions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
        const data = await r.json();
        sid = data.sessionId;
        setSessionId(sid);
        setSessionStatus('waiting');
        connectSSE(sid as string);
      } catch (e) {
        console.error('Failed to create session for Playwright recorder', e);
        return;
      }
    }

    if (isPlaywrightRecording) {
      // Stop: close the Playwright browser
      try {
        await fetch(`/api/recorder/playwright-stop/${sid}`, { method: 'DELETE' });
      } catch {}
      setIsPlaywrightRecording(false);
      return;
    }

    // Start Playwright recorder
    recordingWindowUrl.current = targetUrl;
    setIframeUrl(null);
    setIframeError(null);
    setNlSteps([]);
    setEvents([]);

    try {
      console.log(`[QE-PW] Starting Playwright recorder — session: ${sid}, url: ${targetUrl}`);
      const r = await fetch('/api/recorder/playwright-start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: sid, url: targetUrl }),
      });
      if (r.ok) {
        console.log(`[QE-PW] Playwright recorder started successfully`);
        setIsPlaywrightRecording(true);
        setSessionStatus('recording');
      } else {
        const err = await r.json();
        console.error(`[QE-PW] Playwright recorder failed:`, err);
        alert(`Playwright recorder failed to start: ${err.error || 'Unknown error'}`);
      }
    } catch (e: any) {
      console.error(`[QE-PW] Could not start Playwright recorder:`, e);
      alert(`Could not start Playwright recorder: ${e.message}`);
    }
  }, [sessionId, isPlaywrightRecording]);

  // Open recording in a separate full-screen popup window
  // Events relay back via BroadcastChannel('devxqe-recorder') injected into the proxy page
  const recordingWindowRef  = useRef<Window | null>(null);
  const recordingWindowUrl  = useRef<string>('');   // stores the target URL for window-mode recording
  const [recordingWindowOpen, setRecordingWindowOpen] = useState(false);

  const handleOpenWindow = useCallback((targetUrl: string) => {
    // Close any previous recording window
    if (recordingWindowRef.current && !recordingWindowRef.current.closed) {
      recordingWindowRef.current.close();
    }
    iframeStepRef.current = 0;
    setNlSteps([]);
    setEvents([]);
    setAssertMode(false);
    setPendingAssert(null);
    setIframeUrl(null); // hide iframe — recording happens in popup

    // ← Store the target URL so proceedToGenerate can use it as startUrl
    recordingWindowUrl.current = targetUrl;

    const proxyUrl = `/api/recorder/browse?url=${encodeURIComponent(targetUrl)}`;
    const w = window.screen.width;
    const h = window.screen.height;
    const win = window.open(proxyUrl, 'devxqe-recording', `width=${w},height=${h},left=0,top=0,menubar=no,toolbar=no,location=no,status=no`);
    if (!win || win.closed) {
      alert('Popup blocked! Please allow popups for this site and try again.');
      return;
    }
    recordingWindowRef.current = win;
    setRecordingWindowOpen(true);

    // Poll to detect when window closes
    const poll = setInterval(() => {
      if (!recordingWindowRef.current || recordingWindowRef.current.closed) {
        clearInterval(poll);
        setRecordingWindowOpen(false);
      }
    }, 1000);
  }, []);

  // Toggle assert mode — sends to iframe (proxy mode), popup window (popup mode),
  // or Playwright browser (PW mode). Each recording mode owns a different target
  // for the `__devxqe_assert` message that is consumed by the injected recorder
  // script (see `server/qe/recorder-ws.ts` `recorderScript`).
  const toggleAssertMode = useCallback(async () => {
    const next = !assertMode;
    // Update UI immediately — NEVER revert based on API result.
    // The banner must always reflect what the user clicked.
    setAssertMode(next);
    setPendingAssert(null);

    if (isPlaywrightRecording && sessionId) {
      // Playwright mode: tell the server to inject assert mode into the real browser.
      // Fire-and-forget — failures are logged to console only, UI state is not reverted.
      fetch('/api/recorder/assert-mode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, mode: next ? 'on' : 'off' })
      })
        .then(res => {
          if (!res.ok) res.json().catch(() => ({}))
            .then(b => console.warn('[Assert mode] server error:', b.error || res.status));
        })
        .catch(err => console.warn('[Assert mode] fetch failed:', err));
    } else if (recordingWindowOpen && recordingWindowRef.current && !recordingWindowRef.current.closed) {
      // Popup mode: postMessage to the separate recording window. The popup is
      // same-origin (served via /api/recorder/browse), so postMessage reaches the
      // injected script's `window.addEventListener('message', ...)` handler.
      try {
        recordingWindowRef.current.postMessage(
          { target: '__devxqe_assert', mode: next ? 'on' : 'off' },
          '*'
        );
      } catch (e) {
        console.warn('[Assert mode] popup postMessage failed:', e);
      }
    } else {
      // Iframe proxy mode: postMessage directly into the iframe
      iframeRef.current?.contentWindow?.postMessage(
        { target: '__devxqe_assert', mode: next ? 'on' : 'off' },
        '*'
      );
    }
  }, [assertMode, isPlaywrightRecording, sessionId, recordingWindowOpen]);

  // Build an NL step from confirmed assertion config
  const buildAssertNlStep = (cfg: AssertConfig, stepNum: number): string => {
    // Resolve most meaningful label — fallback chain so we never get Assert "" ...
    const info = cfg.elementInfo;
    const rawLbl =
      info.label ||
      info.ariaLabel ||
      info.text.slice(0, 60) ||
      info.placeholder ||
      info.name ||
      (info.type ? `${info.type} ${info.tag}` : info.tag);
    const lbl = rawLbl.slice(0, 60).replace(/"/g, "'");
    const soft = cfg.failMode === 'soft' ? ' [soft]' : '';
    switch (cfg.assertType) {
      case 'text':      return `Step ${stepNum}: Assert text ${cfg.op.replace('_',' ')} "${cfg.expected}" on "${lbl}"${soft}`;
      case 'value':     return `Step ${stepNum}: Assert value ${cfg.op.replace('_',' ')} "${cfg.expected}" on "${lbl}"${soft}`;
      case 'visible':   return `Step ${stepNum}: Assert "${lbl}" is visible${soft}`;
      case 'hidden':    return `Step ${stepNum}: Assert "${lbl}" is hidden${soft}`;
      case 'enabled':   return `Step ${stepNum}: Assert "${lbl}" is enabled${soft}`;
      case 'disabled':  return `Step ${stepNum}: Assert "${lbl}" is disabled${soft}`;
      case 'checked':   return `Step ${stepNum}: Assert "${lbl}" is checked${soft}`;
      case 'unchecked': return `Step ${stepNum}: Assert "${lbl}" is unchecked${soft}`;
      case 'attribute': return `Step ${stepNum}: Assert attribute "${cfg.attrName}" ${cfg.op.replace('_',' ')} "${cfg.expected}" on "${lbl}"${soft}`;
      case 'count':     return `Step ${stepNum}: Assert ${cfg.expected} elements match "${lbl}"${soft}`;
      case 'url':       return `Step ${stepNum}: Assert page URL ${cfg.op.replace('_',' ')} "${cfg.expected}"${soft}`;
      case 'title':     return `Step ${stepNum}: Assert page title ${cfg.op.replace('_',' ')} "${cfg.expected}"${soft}`;
      case 'snapshot':  return `Step ${stepNum}: Assert page screenshot matches baseline${soft}`;
      default:          return `Step ${stepNum}: Assert "${lbl}"`;
    }
  };

  // Open the AssertionPanel pre-configured for page-level assertions
  // (URL / title / snapshot). Synthesizes an AssertElementInfo with
  // isPageLevel=true so the panel surfaces only page-level types.
  const openPageAssert = useCallback(() => {
    // Best-effort URL: try iframe URL → last recorded event URL → empty
    const lastUrl =
      iframeUrl ||
      [...events].reverse().find(e => e.url)?.url ||
      '';
    const lastTitle =
      [...events].reverse().find(e => e.pageTitle)?.pageTitle || '';
    setPendingAssert({
      tag: 'page',
      text: lastTitle,
      value: '',
      placeholder: '',
      ariaLabel: '',
      name: '',
      type: '',
      label: lastTitle || lastUrl,
      isInput: false,
      isCheckbox: false,
      isChecked: false,
      attrs: {},
      isPageLevel: true,
      pageUrl: lastUrl,
      pageTitleText: lastTitle,
    });
  }, [iframeUrl, events]);

  const confirmAssertion = useCallback((cfg: AssertConfig) => {
    // In Playwright mode iframeStepRef is 0 (SSE manages step count) — use nlSteps length instead
    iframeStepRef.current += 1;
    const stepNum = isPlaywrightRecording ? (nlSteps.length + 1) : iframeStepRef.current;
    const nl = buildAssertNlStep(cfg, stepNum);
    setNlSteps(prev => [...prev, nl]);
    // Use last known event URL (iframeUrl is null in Playwright mode)
    setEvents(prev => {
      const lastUrl = prev.length > 0 ? (prev[prev.length - 1].url || '') : (iframeUrl || '');
      return [...prev, {
        sequence: stepNum,
        timestamp: Date.now(),
        type: 'assertion',
        url: lastUrl,
        pageTitle: '',
        naturalLanguage: nl,
      }];
    });
    setPendingAssert(null);
    // Stay in assert mode so user can add more assertions without re-clicking
  }, [iframeUrl, isPlaywrightRecording, nlSteps.length]);

  // ─── Listen for iframe postMessage events (from injected recorder script) ────
  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (!e.data || e.data.source !== 'devxqe-iframe') return;
      const { type, ...rest } = e.data;

      // Assert element picked in assert mode — open assertion panel
      if (type === 'assert_element') {
        setPendingAssert(rest.elementInfo as AssertElementInfo);
        return;
      }

      // Internal navigation: load new page through proxy without resetting steps
      if (type === '__proxy_navigate') {
        const targetUrl = rest.url as string;
        if (targetUrl) {
          setIframeLoading(true);
          setIframeError(null);
          setIframeUrl(`/api/recorder/browse?url=${encodeURIComponent(targetUrl)}`);
        }
        return;
      }

      // Proxy failed to fetch the page — show banner and prompt "Record in Window"
      if (type === 'proxy_error') {
        setIframeLoading(false);
        setIframeError({ reason: rest.reason || 'network_error', url: rest.url || '' });
        return;
      }

      // User clicked "Record in Window" from inside the proxy error page
      if (type === 'open_in_window') {
        const targetUrl = rest.url as string;
        if (targetUrl) {
          const w = window.screen.width;
          const h = window.screen.height;
          window.open(
            `/api/recorder/browse?url=${encodeURIComponent(targetUrl)}`,
            'devxqe-recording',
            `width=${w},height=${h},left=0,top=0,menubar=no,toolbar=no,location=no,status=no`
          );
        }
        return;
      }

      // page_load fires on every iframe load — only show when session is active
      if (type === 'page_load' && sessionStatus === 'idle') return;

      // Re-arm assert mode after navigation. The injected recorder script's
      // `assertMode` var is local to the IIFE and is reset to false whenever
      // the page reloads, so the parent must re-send the toggle on every
      // page_load to keep the picker alive across navigations.
      if (type === 'page_load' && assertModeRef.current) {
        try {
          iframeRef.current?.contentWindow?.postMessage(
            { target: '__devxqe_assert', mode: 'on' },
            '*'
          );
        } catch { /* iframe gone */ }
      }

      // Iframe/popup events come via postMessage, not via SSE, so the
      // server-driven 'extension_connected' transition never fires for these
      // recording modes. Flip the local pill on the first real event so the
      // UI accurately reflects "we're capturing your interactions".
      setSessionStatus(prev => prev === 'waiting' ? 'recording' : prev);

      iframeStepRef.current += 1;
      const stepNum = iframeStepRef.current;
      const nl = nlFromEvent(type, rest, stepNum);
      if (!nl) return;

      setNlSteps(prev => {
        const updated = [...prev, nl];
        setTimeout(() => { if (scriptRef.current) scriptRef.current.scrollTop = scriptRef.current.scrollHeight; }, 50);
        return updated;
      });
      setAiSuggestion(nl);
      setTimeout(() => setAiSuggestion(null), 2000);

      // Also add to events list
      setEvents(prev => [...prev, { sequence: stepNum, timestamp: Date.now(), type, url: rest.url || '', pageTitle: rest.pageTitle || '', naturalLanguage: nl }]);
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [sessionStatus]);

  useEffect(() => () => sseRef.current?.close(), []);

  // ─── BroadcastChannel: receive events from popup recording window ─────────────
  useEffect(() => {
    let bc: BroadcastChannel | null = null;
    try { bc = new BroadcastChannel('devxqe-recorder'); } catch { return; }

    bc.onmessage = (e) => {
      const data = e.data;
      if (!data || data.source !== 'devxqe-iframe') return;
      const { type, ...rest } = data;

      // assert_save: full AssertConfig captured by the in-popup overlay. The
      // popup runs full-screen and hides the React AssertionPanel, so popup
      // mode does the entire config UX inside the popup (see recorderScript
      // in server/qe/recorder-ws.ts) and posts the finished config back here.
      // We append the NL step directly and skip setPendingAssert (no panel).
      if (type === 'assert_save') {
        const cfg: AssertConfig = {
          assertType: rest.assertType,
          op:         rest.op || 'contains',
          expected:   rest.expected || '',
          attrName:   rest.attrName || 'href',
          failMode:   rest.failMode === 'soft' ? 'soft' : 'hard',
          elementInfo: rest.elementInfo as AssertElementInfo,
        };
        iframeStepRef.current += 1;
        const stepNum = iframeStepRef.current;
        const nl = buildAssertNlStep(cfg, stepNum);
        setNlSteps(prev => {
          const updated = [...prev, nl];
          setTimeout(() => { if (scriptRef.current) scriptRef.current.scrollTop = scriptRef.current.scrollHeight; }, 50);
          return updated;
        });
        setEvents(prev => [...prev, {
          sequence: stepNum,
          timestamp: Date.now(),
          type: 'assertion',
          url: rest.url || '',
          pageTitle: rest.pageTitle || '',
          naturalLanguage: nl,
        }]);
        setAiSuggestion(nl);
        setTimeout(() => setAiSuggestion(null), 2000);
        return;
      }

      // assert_element picked in popup assert mode (legacy / iframe-style flow)
      if (type === 'assert_element') {
        setPendingAssert(rest.elementInfo as AssertElementInfo);
        return;
      }
      if (type === '__proxy_navigate') return; // popup handles its own navigation

      // page_load — only show when session is considered active (window is open)
      if (type === 'page_load' && !recordingWindowOpen) return;

      // Re-arm assert mode after popup navigation — see comment in the
      // postMessage handler above. The popup is same-origin so postMessage
      // reaches the injected script's `window.addEventListener('message')`.
      if (type === 'page_load' && assertModeRef.current && recordingWindowRef.current && !recordingWindowRef.current.closed) {
        try {
          recordingWindowRef.current.postMessage(
            { target: '__devxqe_assert', mode: 'on' },
            '*'
          );
        } catch { /* popup gone */ }
      }

      // Same status-flip rationale as the postMessage handler above: popup
      // events bypass SSE, so flip the pill locally on the first real event.
      setSessionStatus(prev => prev === 'waiting' ? 'recording' : prev);

      iframeStepRef.current += 1;
      const stepNum = iframeStepRef.current;
      const nl = nlFromEvent(type, rest, stepNum);
      if (!nl) return;

      setNlSteps(prev => {
        const updated = [...prev, nl];
        setTimeout(() => { if (scriptRef.current) scriptRef.current.scrollTop = scriptRef.current.scrollHeight; }, 50);
        return updated;
      });
      setAiSuggestion(nl);
      setTimeout(() => setAiSuggestion(null), 2000);
      setEvents(prev => [...prev, { sequence: stepNum, timestamp: Date.now(), type, url: rest.url || '', pageTitle: rest.pageTitle || '', naturalLanguage: nl }]);
    };

    return () => { try { bc?.close(); } catch {} };
  }, [recordingWindowOpen]);

  const scriptContent = nlSteps.join("\n");
  const isRecording = sessionStatus === "recording";
  const isDone = sessionStatus === "completed";

  // ─── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="h-full bg-slate-100 text-gray-900 flex flex-col overflow-hidden">

      <DashboardHeader />

      {/* ── Top bar: Agent pipeline + Test Library link ── */}
      <div className="flex items-center justify-between px-5 py-2 border-b border-slate-300 bg-white shadow-sm flex-shrink-0">

        {/* Left: Back to dashboard */}
        <a href="/qe/dashboard"
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-300 hover:border-slate-400 bg-white hover:bg-slate-50 text-slate-600 text-[13px] font-semibold transition-all flex-shrink-0">
          ← Dashboard
        </a>

        {/* Center: Agent orbs with arrows */}
        <div className="flex items-center gap-2">
          {agents.map((a, i) => (
            <div key={a.id} className="flex items-center gap-2">
              {i > 0 && (
                <svg width="28" height="12" viewBox="0 0 28 12" fill="none" className="flex-shrink-0 opacity-40">
                  <path d="M0 6 H22 M18 2 L26 6 L18 10" stroke="#94a3b8" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              )}
              <AgentOrb agent={a} />
            </div>
          ))}
        </div>

        {/* Right: test library link only */}
        <a href="/qe/test-library"
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-fuchsia-300 hover:border-fuchsia-400 bg-fuchsia-50 hover:bg-fuchsia-100 text-fuchsia-700 text-[13px] font-semibold transition-all">
          🗂 Test Library
        </a>
      </div>

      {/* ── Split screen body ── */}
      <div className="flex flex-1 overflow-hidden">

        {/* ── LEFT: Natural Language Script ── */}
        <div className="w-[42%] flex flex-col border-r-2 border-slate-300 bg-white">

          {/* Panel header */}
          <div className="flex items-center justify-between px-4 py-2.5 border-b-2 border-slate-300 bg-slate-50 flex-shrink-0">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Natural Language Script</span>
              {isRecording && <div className="w-1.5 h-1.5 bg-red-400 rounded-full animate-pulse" />}
            </div>
            <div className="flex items-center gap-3 text-[11px] text-gray-400">
              <span>{nlSteps.length} steps</span>
              {events.length > 0 && events.length !== nlSteps.length && (
                <span className="text-gray-300">({events.length} events)</span>
              )}
              {/* Assert toggle — visible whenever a session is active */}
              {(isRecording || isPlaywrightRecording || iframeUrl) && (
                <button
                  onClick={toggleAssertMode}
                  title={assertMode ? 'Exit Assert Mode' : 'Enter Assert Mode — click any element to add an assertion'}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-semibold transition-all border ${
                    assertMode
                      ? 'bg-amber-100 border-amber-400 text-amber-700 shadow-sm'
                      : 'bg-white border-slate-300 text-slate-600 hover:border-amber-400 hover:text-amber-600'
                  }`}
                >
                  {assertMode
                    ? <><span className="w-1.5 h-1.5 bg-amber-500 rounded-full inline-block animate-pulse" /> Asserting…</>
                    : <>✓ Add Assert</>}
                </button>
              )}
              {nlSteps.length > 0 && (
                <button
                  onClick={() => navigator.clipboard.writeText(scriptContent)}
                  className="text-gray-400 hover:text-gray-600 transition-colors"
                  title="Copy script"
                >
                  📋 Copy
                </button>
              )}
            </div>
          </div>

          {/* Assert mode instruction banner */}
          {assertMode && (
            <div className="flex items-center gap-2 px-4 py-2 bg-amber-50 border-b border-amber-200 flex-shrink-0">
              <span className="text-amber-500 text-sm">✓</span>
              <span className="text-xs text-amber-700 font-medium">
                {isPlaywrightRecording
                  ? 'Assert mode ON — click any element in the Playwright browser window to create an assertion'
                  : 'Assert mode ON — click any element on the embedded page to create an assertion'}
              </span>
              <button
                onClick={toggleAssertMode}
                className="ml-auto text-amber-500 hover:text-amber-700 text-xs font-semibold"
              >
                ✕ Exit
              </button>
            </div>
          )}

          {/* AI Suggestion flash */}
          {aiSuggestion && (
            <div className="mx-3 mt-2 px-3 py-2 bg-indigo-50 border border-indigo-200 rounded-lg text-xs text-indigo-600 animate-pulse flex items-start gap-2 flex-shrink-0">
              <span className="text-indigo-500 mt-0.5 flex-shrink-0">✨</span>
              <span>{aiSuggestion}</span>
            </div>
          )}

          {/* Script area */}
          <div className="flex-1 relative overflow-hidden">
            {nlSteps.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full gap-4 text-gray-400 px-6">
                <div className="text-5xl opacity-20">📝</div>
                <div className="text-center">
                  <p className="text-sm font-medium text-gray-500">Natural language steps appear here</p>
                  <p className="text-xs text-gray-400 mt-1">
                    {sessionStatus === "idle"
                      ? "Start a session to begin"
                      : sessionStatus === "waiting"
                      ? "Connect the Chrome Extension and start recording"
                      : "Interact with your app — steps generate in real time"}
                  </p>
                </div>

                {sessionStatus === "waiting" && (
                  <div className="w-full max-w-xs space-y-3">
                    {/* Extension status pill */}
                    <div className="flex items-center justify-center gap-2">
                      {extensionInstalled && extensionConnected ? (
                        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-100 text-emerald-700 text-xs font-semibold">
                          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" /> Recorder active
                        </span>
                      ) : extensionInstalled ? (
                        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-100 text-amber-700 text-xs font-semibold">
                          <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" /> Auto-connecting...
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-red-100 text-red-700 text-xs font-semibold">
                          <span className="w-2 h-2 rounded-full bg-red-500" /> Extension not detected
                        </span>
                      )}
                    </div>

                    {!extensionInstalled ? (
                      <div className="bg-slate-50 border-2 border-slate-300 rounded-xl p-4 space-y-3 text-center">
                        <p className="text-xs font-semibold text-slate-600">Install the Chrome Extension</p>
                        <p className="text-[11px] text-slate-400">Records interactions on any website and sends them here in real time.</p>
                        <button
                          onClick={() => navigate("/remote-agents")}
                          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-indigo-600 text-white text-xs font-semibold hover:bg-indigo-700 transition-colors"
                        >
                          📦 Setup Instructions
                        </button>
                        <details className="text-left mt-2">
                          <summary className="text-[10px] text-slate-400 cursor-pointer hover:text-slate-600">Having trouble? Enter code manually</summary>
                          <div className="mt-2 space-y-1.5">
                            {[
                              "Open Chrome Extension popup",
                              `Enter code: ${sessionId || "..."}`,
                              "Click Join → Start Recording",
                            ].map((step, i) => (
                              <div key={i} className="flex items-center gap-2 text-[11px] text-slate-500">
                                <div className="w-4 h-4 rounded-full border-2 border-slate-300 flex items-center justify-center text-[9px] text-slate-400 flex-shrink-0">{i + 1}</div>
                                <span className={i === 1 ? "text-indigo-600 font-mono font-semibold" : ""}>{step}</span>
                              </div>
                            ))}
                          </div>
                        </details>
                      </div>
                    ) : extensionConnected ? (
                      <div className="bg-slate-50 border-2 border-emerald-300 rounded-xl p-4 text-center space-y-2">
                        <p className="text-xs font-semibold text-emerald-700">✓ Extension linked — ready to record</p>
                        <p className="text-[11px] text-slate-400">Navigate to your target website and interact with it. Steps will appear here.</p>
                      </div>
                    ) : (
                      <div className="bg-slate-50 border-2 border-emerald-300 rounded-xl p-4 text-center space-y-2">
                        <p className="text-xs font-semibold text-emerald-700">Extension detected — configuring automatically</p>
                        <p className="text-[11px] text-slate-400">Navigate to your target website and interact with it. Steps will appear here.</p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <div className="h-full flex flex-col">
                {/* Auto-save status banner */}
                {autoSaveStatus !== 'idle' && (
                  <div className={`mx-3 mt-2 px-4 py-3 rounded-xl border text-xs ${
                    autoSaveStatus === 'generating' ? 'bg-blue-50 border-blue-200 text-blue-700' :
                    autoSaveStatus === 'saving'     ? 'bg-amber-50 border-amber-200 text-amber-700' :
                    autoSaveStatus === 'done'        ? 'bg-emerald-50 border-emerald-200 text-emerald-700' :
                    autoSaveStatus === 'error'       ? 'bg-red-50 border-red-200 text-red-700' : ''
                  }`}>
                    {autoSaveStatus === 'generating' && <span>⏳ Generating framework files...</span>}
                    {autoSaveStatus === 'saving' && <span>⏳ Merging into project (checking duplicates)...</span>}
                    {autoSaveStatus === 'done' && autoSaveResult && (
                      <div className="space-y-1">
                        <div className="font-semibold">✅ {autoSaveResult.tcId} saved to {autoSaveResult.projectName} / {autoSaveResult.moduleName}</div>
                        <div className="text-[10px] opacity-80">
                          Files written: {autoSaveResult.written.length} | Merged: {autoSaveResult.merged.length}
                        </div>
                        <div className="flex gap-2 mt-2">
                          <button onClick={() => {
                            setShowFramework(true);
                            // Auto-select the first test (.spec.ts) file so the user lands
                            // directly on the saved test content rather than the empty
                            // "Select a file to view here" placeholder.
                            const firstTest =
                              frameworkFiles.find(f => f.type === 'test') ||
                              frameworkFiles.find(f => f.path.endsWith('.spec.ts')) ||
                              frameworkFiles.find(f => f.path.startsWith('tests/'));
                            if (firstTest) setActiveFilePath(firstTest.path);
                          }}
                            className="px-2 py-1 bg-emerald-600 text-white rounded text-[10px] font-semibold">
                            📁 View Files
                          </button>
                          <button onClick={() => { setAutoSaveStatus('idle'); setAutoSaveResult(null); }}
                            className="px-2 py-1 bg-slate-200 text-slate-700 rounded text-[10px]">
                            ↺ Re-generate
                          </button>
                        </div>
                      </div>
                    )}
                    {autoSaveStatus === 'error' && (
                      <div className="space-y-1">
                        <div>❌ Auto-save failed: {autoSaveError}</div>
                        <div className="flex gap-2 mt-1">
                          <button onClick={autoGenerateAndSave}
                            className="px-2 py-1 bg-red-600 text-white rounded text-[10px]">↺ Try Again</button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
                {/* Numbered steps list */}
                <div className="flex-1 overflow-y-auto px-3 py-3 space-y-1" style={{ scrollbarWidth: "thin", scrollbarColor: "#e5e7eb transparent" }}>
                  {nlSteps.map((step, i) => {
                    const isAssert = /^Step \d+: Assert /.test(step);
                    const isLatest = i === nlSteps.length - 1 && isRecording;
                    const canAssertHere = (isRecording || isPlaywrightRecording || iframeUrl) && !isAssert;
                    return (
                      <div
                        key={i}
                        className={`group flex items-start gap-2 px-3 py-2 rounded-lg transition-all ${
                          isAssert
                            ? 'bg-amber-50 border border-amber-200'
                            : isLatest
                            ? 'bg-indigo-50 border border-indigo-200'
                            : 'hover:bg-slate-50'
                        }`}
                      >
                        <span className="text-[10px] text-gray-400 w-5 text-right flex-shrink-0 mt-0.5">{i + 1}</span>
                        {isAssert && <span className="text-[10px] text-amber-500 flex-shrink-0 mt-0.5">✓</span>}
                        <span className={`text-xs leading-relaxed flex-1 ${
                          isAssert ? 'text-amber-700' : isLatest ? 'text-indigo-700' : 'text-gray-700'
                        }`}>
                          {step}
                        </span>
                        {/* Per-step assert button — shown on hover during active recording */}
                        {canAssertHere && (
                          <button
                            onClick={toggleAssertMode}
                            title="Enter assert mode and click an element to assert after this step"
                            className="opacity-0 group-hover:opacity-100 flex-shrink-0 px-1.5 py-0.5 rounded text-[10px] font-semibold text-amber-600 border border-amber-300 bg-amber-50 hover:bg-amber-100 transition-all"
                          >
                            ✓ Assert
                          </button>
                        )}
                      </div>
                    );
                  })}
                  {isRecording && (
                    <div className="flex items-center gap-2 px-3 py-2">
                      <span className="text-[10px] text-gray-300 w-5 text-right">{nlSteps.length + 1}</span>
                      <div className="flex gap-1">
                        <div className="w-1.5 h-1.5 bg-gray-300 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                        <div className="w-1.5 h-1.5 bg-gray-300 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                        <div className="w-1.5 h-1.5 bg-gray-300 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
                      </div>
                    </div>
                  )}
                </div>

                {/* Editable raw view toggle */}
                <div className="border-t-2 border-slate-300 px-3 py-2 flex-shrink-0">
                  <textarea
                    ref={scriptRef}
                    readOnly
                    value={scriptContent}
                    className="w-full h-24 bg-slate-50 border border-slate-300 rounded-lg px-3 py-2 text-[11px] font-mono text-slate-600 resize-none outline-none"
                    style={{ scrollbarWidth: "thin" }}
                  />
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ── RIGHT: Browser View with URL Bar ── */}
        <div className="flex-1 flex flex-col bg-slate-100">

          {/* Browser chrome bar */}
          <BrowserBar
            sessionId={sessionId}
            sessionStatus={sessionStatus}
            extensionConnected={extensionConnected}
            extensionInstalled={extensionInstalled}
            isCreatingSession={isCreatingSession}
            projectName={projectName} setProjectName={setProjectName}
            moduleName={moduleName} setModuleName={setModuleName}
            tcId={tcId} setTcId={setTcId}
            testCaseName={testCaseName} setTestCaseName={setTestCaseName}
            adoStoryId={adoStoryId} setAdoStoryId={setAdoStoryId}
            businessContext={businessContext} setBusinessContext={setBusinessContext}
            onCreateSession={createSession}
            onStop={stopRecording}
            onProceed={proceedToGenerate}
            onOpenUrl={handleOpenUrl}
            onOpenWindow={handleOpenWindow}
            onOpenPlaywright={handleOpenPlaywright}
            isPlaywrightRecording={isPlaywrightRecording}
            nlStepsCount={nlSteps.length}
            eventsCount={events.filter(e => e.type !== 'screenshot').length}
            assertMode={assertMode}
            onToggleAssert={toggleAssertMode}
            onPageAssert={openPageAssert}
            iframeUrl={iframeUrl}
            isRecording={isRecording}
            isDone={isDone}
          />

          {/* Right panel: Scripts view OR Browser iframe */}
          <div className="flex-1 relative overflow-hidden">

            {/* ── FRAMEWORK VIEW (AI-generated multi-file) ── */}
            {showFramework && (
              <div className="absolute inset-0 z-30 flex flex-col bg-slate-900">
                {/* Header */}
                <div className="flex items-start justify-between px-4 py-2 border-b-2 border-slate-700 bg-slate-800 flex-shrink-0 gap-2 flex-wrap">
                  <div className="flex items-center gap-2.5 flex-shrink-0">
                    <div className="w-6 h-6 rounded-md bg-gradient-to-br from-blue-500 to-cyan-500 flex items-center justify-center text-xs flex-shrink-0">✍️</div>
                    <div className="min-w-0">
                      <span className="text-xs font-bold text-slate-100">Script Writer Agent</span>
                      <span className="text-[10px] text-slate-400 ml-2">
                        {isGenerating ? 'Generating framework...' : `${frameworkFiles.length} files generated`}
                      </span>
                    </div>
                    {isGenerating && <div className="w-3 h-3 border border-blue-400/30 border-t-blue-400 rounded-full animate-spin flex-shrink-0" />}
                  </div>
                  <div className="flex items-center gap-1.5 flex-wrap justify-end flex-shrink-0">
                    {/* Locator Audit */}
                    {frameworkFiles.length > 0 && !isGenerating && (
                      <button
                        onClick={() => { runLocatorAudit(); }}
                        className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-semibold transition-colors whitespace-nowrap ${
                          showAudit
                            ? 'bg-amber-600/30 border-amber-500/50 text-amber-300'
                            : 'bg-slate-800 hover:bg-amber-900/30 border-slate-700 hover:border-amber-500/50 text-slate-300 hover:text-amber-300'
                        }`}
                        title="Audit all XPath locators for stability"
                      >🔍 Locator Audit</button>
                    )}
                    {/* ZIP download */}
                    {frameworkFiles.length > 0 && !isGenerating && (
                      <button
                        onClick={async () => {
                          try {
                            const JSZip = (await import('jszip')).default;
                            const zip = new JSZip();
                            // Add every generated file at its full path (preserves folder structure)
                            frameworkFiles.forEach(f => zip.file(f.path, f.content));
                            const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
                            const url  = URL.createObjectURL(blob);
                            const a    = document.createElement('a');
                            a.href     = url;
                            a.download = 'test-framework.zip';
                            document.body.appendChild(a);
                            a.click();
                            document.body.removeChild(a);
                            setTimeout(() => URL.revokeObjectURL(url), 1000);
                          } catch (e: any) {
                            alert(`ZIP download failed: ${e.message}`);
                          }
                        }}
                        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs text-slate-300 transition-colors whitespace-nowrap"
                      >↓ Download .zip</button>
                    )}
                    {/* Save to Project — only shown when projectName is set */}
                    {frameworkFiles.length > 0 && !isGenerating && projectName.trim() && (
                      <button
                        onClick={saveAiFrameworkToProject}
                        disabled={aiSaveStatus === 'saving'}
                        title={`Save to projects/${projectName.trim()}/ on disk`}
                        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-violet-600/20 hover:bg-violet-600/30 border border-violet-500/30 disabled:opacity-50 text-violet-300 text-xs font-semibold transition-colors whitespace-nowrap"
                      >
                        {aiSaveStatus === 'saving'
                          ? <><div className="w-3 h-3 border border-violet-400/30 border-t-violet-400 rounded-full animate-spin" /> Saving...</>
                          : aiSaveStatus === 'saved'
                          ? <>✅ Saved to project</>
                          : <>📁 Save to Project</>}
                      </button>
                    )}
                    <button onClick={openSaveModal}
                      className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-violet-600/20 hover:bg-violet-600/30 border border-violet-500/30 text-violet-300 text-xs font-semibold transition-colors whitespace-nowrap">
                      🗂 Save to Library
                    </button>
                    {/* In-app Playwright execution removed by product decision — the
                        recommended flow is Save / Download the script and run it in
                        the user's own Playwright project. */}
                    <button onClick={() => setShowFramework(false)}
                      className="px-2.5 py-1.5 rounded-lg border border-slate-700 hover:border-slate-600 text-xs text-slate-400 transition-colors whitespace-nowrap">
                      ← Browser
                    </button>
                  </div>
                </div>

                {/* Body: file tree left + editor right + exec panel */}
                <div className="flex-1 overflow-hidden flex">

                  {/* File tree */}
                  <div className="w-52 flex-shrink-0 border-r-2 border-slate-700 bg-slate-900 overflow-auto py-2" style={{ scrollbarWidth: 'thin', scrollbarColor: '#334155 transparent' }}>
                    {/* Generation log */}
                    {genStatus.length > 0 && (
                      <div className="px-2 pb-2 mb-2 border-b border-slate-800">
                        {genStatus.map((s, i) => (
                          <div key={i} className={`text-[9px] font-mono py-0.5 ${s.type === 'error' ? 'text-red-400' : s.type === 'thinking' ? 'text-violet-400' : 'text-slate-400'}`}>{s.message}</div>
                        ))}
                      </div>
                    )}

                    {/* Extended Thinking blocks */}
                    {thinkingBlocks.length > 0 && (
                      <div className="px-2 pb-2 mb-2 border-b border-slate-800 space-y-1">
                        <div className="text-[9px] font-bold text-violet-600 uppercase tracking-wider mb-1">🧠 REASONING</div>
                        {thinkingBlocks.map((blk, i) => (
                          <div key={i} className="rounded-lg border border-violet-800/40 overflow-hidden bg-violet-950/20">
                            <button
                              onClick={() => setThinkingBlocks(prev => prev.map((b, j) => j === i ? { ...b, open: !b.open } : b))}
                              className="w-full flex items-center gap-1.5 px-2 py-1.5 text-left hover:bg-violet-900/20 transition-colors"
                            >
                              <span className="text-violet-400 text-[10px]">{blk.open ? '▼' : '▶'}</span>
                              <span className="text-[9px] text-violet-300 font-semibold truncate flex-1">{blk.label}</span>
                            </button>
                            {blk.open && (
                              <div className="px-2 pb-2 text-[9px] text-violet-300/60 font-mono leading-relaxed whitespace-pre-wrap max-h-48 overflow-auto border-t border-violet-800/30" style={{ scrollbarWidth: 'thin' }}>
                                {blk.content}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                    {/* File type groups */}
                    {[
                      { label: 'TESTS', types: ['test'] },
                      { label: 'BUSINESS ACTIONS', types: ['business_action'] },
                      { label: 'OBJECT REPOSITORY', types: ['pom'], pathFilter: (p: string) => p.startsWith('locators/') },
                      { label: 'PAGE OBJECTS', types: ['pom'], pathFilter: (p: string) => p.startsWith('pages/') },
                      { label: 'FIXTURES', types: ['config'], pathFilter: (p: string) => p.startsWith('fixtures/') },
                      { label: 'AUTH SETUP', types: ['config'], pathFilter: (p: string) => p.startsWith('auth/') },
                      { label: 'GENERIC ACTIONS', types: ['generic_action'] },
                      { label: 'CONFIG', types: ['config'], pathFilter: (p: string) => !p.startsWith('fixtures/') && !p.startsWith('auth/') },
                    ].map(group => {
                      const groupFiles = frameworkFiles.filter(f =>
                        group.types.includes(f.type) &&
                        ((group as any).pathFilter ? (group as any).pathFilter(f.path) : true)
                      );
                      if (groupFiles.length === 0) return null;
                      return (
                        <div key={group.label} className="mb-3">
                          <div className="text-[9px] font-bold text-slate-400 uppercase tracking-wider px-3 mb-1">{group.label}</div>
                          {groupFiles.map(f => (
                            <div key={f.path}
                              onClick={() => setActiveFilePath(f.path)}
                              className={`flex items-center gap-1.5 px-3 py-1.5 cursor-pointer text-[11px] transition-colors ${activeFilePath === f.path ? 'bg-indigo-600/20 text-indigo-300 border-l-2 border-indigo-500' : 'text-slate-500 hover:bg-slate-800/40 hover:text-slate-300'}`}>
                              <span className="text-[10px]">
                                {f.type === 'test'            ? '🧪'
                                : f.type === 'pom' && f.path.startsWith('locators/') ? '🗃️'
                                : f.type === 'pom'            ? '📄'
                                : f.type === 'business_action'? '⚡'
                                : f.type === 'generic_action' ? '🔧'
                                : f.path.startsWith('fixtures/')? '📦'
                                : f.path.startsWith('auth/')  ? '🔐'
                                : f.path === '.env.example'   ? '🔑'
                                : f.path === '.gitignore'     ? '🛡'
                                : '⚙️'}
                              </span>
                              <span className="truncate font-mono">{f.path.split('/').pop()}</span>
                            </div>
                          ))}
                        </div>
                      );
                    })}
                    {isGenerating && (
                      <div className="px-3 py-2 text-[10px] text-slate-700 flex items-center gap-1.5">
                        <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse" />
                        AI generating...
                      </div>
                    )}
                  </div>

                  {/* Code editor area OR Audit view */}
                  <div className={`overflow-auto p-4 flex-1`} style={{ scrollbarWidth: 'thin', scrollbarColor: '#1e293b transparent' }}>
                    {showAudit ? (
                      /* ── LOCATOR AUDIT TABLE ───────────────────────────────── */
                      <div>
                        {/* Audit header */}
                        <div className="flex items-center justify-between mb-4">
                          <div className="flex items-center gap-3">
                            <span className="text-base">🔍</span>
                            <div>
                              <div className="text-sm font-bold text-slate-100">Locator Audit Report</div>
                              <div className="text-[10px] text-slate-500">{auditRows.length} locators across {frameworkFiles.filter(f=>f.type==='pom'&&f.path.startsWith('locators/')).length} files</div>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            {/* Legend */}
                            {(['STABLE','ACCEPTABLE','FRAGILE','FORBIDDEN'] as AuditClass[]).map(cls => {
                              const count = auditRows.filter(r => r.classification === cls).length;
                              const colors: Record<AuditClass, string> = {
                                STABLE: 'bg-emerald-900/30 border-emerald-500/40 text-emerald-400',
                                ACCEPTABLE: 'bg-blue-900/30 border-blue-500/40 text-blue-400',
                                FRAGILE: 'bg-amber-900/30 border-amber-500/40 text-amber-400',
                                FORBIDDEN: 'bg-red-900/30 border-red-500/40 text-red-400',
                              };
                              return (
                                <span key={cls} className={`px-2 py-0.5 rounded-full border text-[10px] font-bold ${colors[cls]}`}>
                                  {count} {cls}
                                </span>
                              );
                            })}
                            <button onClick={() => setShowAudit(false)} className="ml-2 text-slate-500 hover:text-slate-300 text-[10px] px-2 py-1 rounded border border-slate-700 hover:border-slate-600 transition-colors">✕ Close</button>
                          </div>
                        </div>

                        {auditRows.length === 0 ? (
                          <div className="flex flex-col items-center justify-center py-16 text-slate-600">
                            <span className="text-3xl mb-2">✅</span>
                            <p className="text-sm">No XPath locators found in locator files.</p>
                            <p className="text-xs mt-1">Generate framework files first, then run the audit.</p>
                          </div>
                        ) : (
                          <div className="rounded-xl border border-slate-700 overflow-hidden">
                            {/* Table header */}
                            <div className="grid gap-0 text-[10px] font-bold text-slate-400 uppercase tracking-wider bg-slate-800 border-b border-slate-700"
                              style={{ gridTemplateColumns: '160px 1fr 90px 1fr' }}>
                              <div className="px-3 py-2 border-r border-slate-700">Element Name</div>
                              <div className="px-3 py-2 border-r border-slate-700">Current XPath</div>
                              <div className="px-3 py-2 border-r border-slate-700">Classification</div>
                              <div className="px-3 py-2">Suggested Fix</div>
                            </div>
                            {/* Table rows */}
                            {auditRows.map((row, i) => {
                              const clsColors: Record<AuditClass, string> = {
                                STABLE:     'text-emerald-400 bg-emerald-900/20',
                                ACCEPTABLE: 'text-blue-400 bg-blue-900/20',
                                FRAGILE:    'text-amber-400 bg-amber-900/20',
                                FORBIDDEN:  'text-red-400 bg-red-900/20',
                              };
                              const rowBg = row.classification === 'FORBIDDEN' ? 'bg-red-950/10 hover:bg-red-950/20'
                                          : row.classification === 'FRAGILE'   ? 'bg-amber-950/10 hover:bg-amber-950/20'
                                          : 'hover:bg-slate-800/40';
                              return (
                                <div key={i}
                                  className={`grid border-b border-slate-800 last:border-0 transition-colors ${rowBg}`}
                                  style={{ gridTemplateColumns: '160px 1fr 90px 1fr' }}>
                                  {/* Element Name */}
                                  <div className="px-3 py-2.5 border-r border-slate-800 flex flex-col gap-0.5">
                                    <span className="text-[11px] font-semibold text-slate-200 font-mono">{row.elementName}</span>
                                    <span className="text-[9px] text-slate-600">{row.file}</span>
                                  </div>
                                  {/* Current XPath */}
                                  <div className="px-3 py-2.5 border-r border-slate-800 flex items-start gap-1.5">
                                    <code className="text-[10px] text-cyan-400/80 font-mono break-all leading-relaxed flex-1">{row.xpath}</code>
                                    <button
                                      onClick={() => navigator.clipboard.writeText(row.xpath)}
                                      title="Copy XPath"
                                      className="flex-shrink-0 text-slate-700 hover:text-slate-400 text-[9px] mt-0.5"
                                    >📋</button>
                                  </div>
                                  {/* Classification badge */}
                                  <div className="px-3 py-2.5 border-r border-slate-800 flex flex-col gap-1 items-start">
                                    <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${clsColors[row.classification]}`}>
                                      {row.classification}
                                    </span>
                                    <span className="text-[9px] text-slate-600 leading-tight">{row.reason}</span>
                                  </div>
                                  {/* Suggested Fix */}
                                  <div className="px-3 py-2.5 flex items-start gap-1.5">
                                    {row.suggestedFix ? (
                                      <>
                                        <code className="text-[10px] text-emerald-400/80 font-mono break-all leading-relaxed flex-1">{row.suggestedFix}</code>
                                        <button
                                          onClick={() => navigator.clipboard.writeText(row.suggestedFix!)}
                                          title="Copy suggested fix"
                                          className="flex-shrink-0 text-slate-700 hover:text-slate-400 text-[9px] mt-0.5"
                                        >📋</button>
                                      </>
                                    ) : (
                                      <span className="text-[10px] text-slate-600 italic">—</span>
                                    )}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}

                        {/* Export audit as CSV */}
                        {auditRows.length > 0 && (
                          <div className="mt-4 flex justify-end">
                            <button
                              onClick={() => {
                                const header = 'Element Name,File,XPath,Classification,Reason,Suggested Fix\n';
                                const rows = auditRows.map(r =>
                                  [r.elementName, r.file, `"${r.xpath}"`, r.classification, `"${r.reason}"`, r.suggestedFix ? `"${r.suggestedFix}"` : ''].join(',')
                                ).join('\n');
                                const blob = new Blob([header + rows], { type: 'text/csv' });
                                const url = URL.createObjectURL(blob);
                                const a = document.createElement('a'); a.href = url; a.download = 'locator-audit.csv';
                                document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
                              }}
                              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs text-slate-300 transition-colors"
                            >↓ Export CSV</button>
                          </div>
                        )}
                      </div>
                    ) : (() => {
                      const activeFile = frameworkFiles.find(f => f.path === activeFilePath);
                      if (!activeFile) return (
                        <div className="flex items-center justify-center h-full text-slate-700 text-xs flex-col gap-2">
                          <span className="text-3xl">📁</span>
                          <span>{isGenerating ? 'Generating files...' : 'Select a file to preview'}</span>
                        </div>
                      );
                      return (
                        <>
                          {/* File path breadcrumb */}
                          <div className="flex items-center gap-1 mb-3">
                            <span className="text-[10px] text-slate-600 font-mono">{activeFile.path}</span>
                            <button onClick={() => { navigator.clipboard.writeText(activeFile.content); }}
                              className="ml-2 text-[9px] text-slate-700 hover:text-slate-400 px-1.5 py-0.5 rounded bg-slate-900 transition-colors">📋</button>
                          </div>

                          {/* ── Structured Metadata Panel ─────────────────────────── */}
                          {activeFile.type === 'pom' && activeFile.path.startsWith('locators/') && activeFile.metadata && (
                            <div className="mb-3 rounded-xl border border-amber-500/20 bg-amber-950/10 overflow-hidden">
                              <div className="flex items-center gap-2 px-3 py-2 bg-amber-900/20 border-b border-amber-500/15">
                                <span className="text-amber-400">🗃️</span>
                                <span className="text-[10px] font-bold text-amber-300">Object Repository</span>
                                {activeFile.metadata.snapshotUsed && (
                                  <span className="px-1.5 py-0.5 rounded-full bg-emerald-900/40 border border-emerald-500/30 text-[8px] font-bold text-emerald-400 tracking-wide">🎭 DOM-ACCURATE</span>
                                )}
                                <span className="ml-auto text-[9px] text-amber-500">{activeFile.metadata.locators?.length ?? 0} locators</span>
                              </div>
                              <div className="px-3 py-2">
                                <div className="text-[9px] font-bold text-amber-600 uppercase tracking-wider mb-1.5">Locators (single source of truth)</div>
                                {activeFile.metadata.locators?.map((l, i) => (
                                  <div key={i} className="flex items-start gap-1.5 mb-1">
                                    <span className="text-[9px] font-mono text-amber-300 flex-shrink-0">{l.name}</span>
                                    <span className="text-[9px] text-slate-600">·</span>
                                    <span className="text-[9px] text-cyan-500/80 flex-shrink-0">{l.strategy}</span>
                                    <span className="text-[9px] text-slate-500 truncate">{l.description}</span>
                                  </div>
                                ))}
                              </div>
                              <div className="px-3 py-1.5 border-t border-amber-500/10 text-[9px] text-amber-500/60">
                                🎯 Single source of truth — update a locator here once and all tests heal automatically
                              </div>
                            </div>
                          )}
                          {activeFile.type === 'pom' && activeFile.path.startsWith('pages/') && activeFile.metadata && (
                            <div className="mb-3 rounded-xl border border-violet-500/20 bg-violet-950/20 overflow-hidden">
                              <div className="flex items-center gap-2 px-3 py-2 bg-violet-900/20 border-b border-violet-500/15">
                                <span className="text-violet-400">📄</span>
                                <span className="text-[10px] font-bold text-violet-300">{activeFile.metadata.className}</span>
                                <span className="ml-auto text-[9px] text-violet-500">{activeFile.metadata.methods?.length ?? 0} methods</span>
                              </div>
                              <div className="px-3 py-2">
                                <div className="text-[9px] font-bold text-violet-600 uppercase tracking-wider mb-1">Methods</div>
                                {activeFile.metadata.methods?.map((m, i) => (
                                  <div key={i} className="text-[9px] font-mono text-emerald-400/80 mb-1">{m}()</div>
                                ))}
                              </div>
                              <div className="px-3 py-1.5 border-t border-violet-500/10 text-[9px] text-violet-500/60">
                                🛡 Methods only — all selectors are in the Object Repository above
                              </div>
                            </div>
                          )}
                          {activeFile.type === 'pom' && !activeFile.metadata && (
                            <div className="mb-3 px-3 py-2 rounded-lg bg-violet-500/5 border border-violet-500/20 text-[10px] text-violet-300/80">
                              🛡 <strong>Self-healing target</strong> — all locators live here. One fix heals every test that uses this Page Object.
                            </div>
                          )}

                          {activeFile.type === 'business_action' && activeFile.metadata && (
                            <div className="mb-3 rounded-xl border border-blue-500/20 bg-blue-950/20 overflow-hidden">
                              <div className="flex items-center gap-2 px-3 py-2 bg-blue-900/20 border-b border-blue-500/15">
                                <span className="text-blue-400">⚡</span>
                                <span className="text-[10px] font-bold text-blue-300">Business Actions</span>
                                <span className="ml-auto text-[9px] text-blue-500">{activeFile.metadata.functions?.length ?? 0} functions</span>
                              </div>
                              <div className="px-3 py-2 space-y-2">
                                {activeFile.metadata.functions?.map((fn, i) => (
                                  <div key={i} className="flex items-start gap-2">
                                    <span className="text-[9px] font-mono text-blue-300 flex-shrink-0 mt-0.5">{fn.name}()</span>
                                    <span className="text-[9px] text-slate-500">— {fn.description}</span>
                                    <span className="ml-auto text-[9px] text-slate-700 flex-shrink-0">{fn.stepCount} steps</span>
                                  </div>
                                ))}
                              </div>
                              <div className="px-3 py-1.5 border-t border-blue-500/10 text-[9px] text-blue-500/60">
                                ⚡ Change behaviour once here — all tests that call these functions inherit the update
                              </div>
                            </div>
                          )}
                          {activeFile.type === 'business_action' && !activeFile.metadata && (
                            <div className="mb-3 px-3 py-2 rounded-lg bg-blue-500/5 border border-blue-500/20 text-[10px] text-blue-300/80">
                              ⚡ <strong>Business Action</strong> — compose these in test files. Change behaviour once here, all tests inherit it.
                            </div>
                          )}

                          {activeFile.type === 'test' && activeFile.metadata && (
                            <div className="mb-3 rounded-xl border border-emerald-500/20 bg-emerald-950/20 overflow-hidden">
                              <div className="flex items-center gap-2 px-3 py-2 bg-emerald-900/20 border-b border-emerald-500/15">
                                <span className="text-emerald-400">🧪</span>
                                <span className="text-[10px] font-bold text-emerald-300 truncate flex-1">{activeFile.metadata.testCaseName}</span>
                              </div>
                              <div className="px-3 py-2 space-y-2">
                                <div className="text-[9px] text-slate-400 italic">"{activeFile.metadata.businessScenario}"</div>
                                <div className="flex flex-wrap gap-1">
                                  {activeFile.metadata.businessActionsUsed?.map((a, i) => (
                                    <span key={i} className="px-1.5 py-0.5 rounded bg-blue-900/40 text-blue-300 text-[9px] font-mono">{a}</span>
                                  ))}
                                  {activeFile.metadata.assertionsUsed?.map((a, i) => (
                                    <span key={i} className="px-1.5 py-0.5 rounded bg-amber-900/30 text-amber-400 text-[9px] font-mono">{a}</span>
                                  ))}
                                </div>
                              </div>
                              <div className="px-3 py-1.5 border-t border-emerald-500/10 text-[9px] text-emerald-500/60">
                                🧪 Reads like a business specification — no raw locators or Playwright API calls
                              </div>
                            </div>
                          )}
                          {activeFile.type === 'test' && !activeFile.metadata && (
                            <div className="mb-3 px-3 py-2 rounded-lg bg-emerald-500/5 border border-emerald-500/20 text-[10px] text-emerald-300/80">
                              🧪 <strong>Test Scenario</strong> — reads like a business specification. No raw locators or Playwright API calls.
                            </div>
                          )}
                          {activeFile.type === 'generic_action' && (
                            <div className="mb-3 px-3 py-2 rounded-lg bg-amber-500/5 border border-amber-500/20 text-[10px] text-amber-300/80">
                              🔧 <strong>Generic Action</strong> — app-agnostic utility. Stable across UI changes. Reuse across all projects.
                            </div>
                          )}

                          <pre className="text-xs font-mono leading-relaxed whitespace-pre-wrap bg-slate-950/60 border border-slate-800 rounded-xl p-4">
                            {activeFile.content.split('\n').map((line, i) => (
                              <span key={i} className={
                                line.trim().startsWith('//') || line.trim().startsWith('*') || line.trim().startsWith('/*') ? 'text-slate-600' :
                                line.startsWith('import') || line.startsWith('export') ? 'text-violet-400' :
                                line.includes('class ') ? 'text-blue-300' :
                                line.includes('async ') || line.includes('await ') ? 'text-emerald-300' :
                                /readonly|private|public|const|let/.test(line) ? 'text-cyan-300' :
                                'text-slate-300'
                              }>{line}{'\n'}</span>
                            ))}
                          </pre>
                        </>
                      );
                    })()}
                  </div>

                  {/* Execution output + Fixer */}
                  {showExecute && (
                    <div className="w-80 flex-shrink-0 border-l border-slate-800/60 flex flex-col bg-[#030712]">
                      <div className="flex items-center justify-between px-3 py-2 border-b border-slate-800 flex-shrink-0">
                        <div className="flex items-center gap-2">
                          <div className={`w-2 h-2 rounded-full ${execStatus === 'running' ? 'bg-yellow-400 animate-pulse' : execStatus === 'passed' ? 'bg-emerald-400' : execStatus === 'failed' ? 'bg-red-400' : 'bg-slate-600'}`} />
                          <span className="text-xs font-semibold text-slate-300">Execution</span>
                          <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-bold ${execStatus === 'running' ? 'bg-yellow-500/10 text-yellow-400' : execStatus === 'passed' ? 'bg-emerald-500/10 text-emerald-400' : execStatus === 'failed' ? 'bg-red-500/10 text-red-400' : 'bg-slate-800 text-slate-500'}`}>
                            {execStatus.toUpperCase()}
                          </span>
                        </div>
                        <button onClick={() => setShowExecute(false)} className="text-slate-600 hover:text-slate-400 text-xs">✕</button>
                      </div>
                      <div ref={execOutputRef} className="flex-1 overflow-auto p-3 font-mono text-[10px] space-y-0.5 bg-[#030712]" style={{ scrollbarWidth: 'thin', scrollbarColor: '#1e293b transparent' }}>
                        {execOutput.map((line, i) => {
                          if (line.type === 'visual_analysis_start') {
                            return (
                              <div key={i} className="mt-2 px-2 py-1.5 rounded-lg bg-blue-500/10 border border-blue-500/20 text-blue-300 text-[10px] flex items-center gap-1.5">
                                <span className="animate-pulse">🔍</span> {line.message}
                              </div>
                            );
                          }
                          if (line.type === 'visual_analysis_done') {
                            return (
                              <div key={i} className="mt-2 rounded-xl border border-blue-500/25 bg-blue-500/5 overflow-hidden">
                                <div className="flex items-center gap-2 px-3 py-2 border-b border-blue-500/20 bg-blue-500/10">
                                  <span>📸</span>
                                  <span className="text-[10px] font-bold text-blue-300">Visual Failure Analysis</span>
                                  <span className="text-[9px] text-blue-500 ml-auto">Claude Vision</span>
                                </div>
                                <div className="px-3 py-2 text-[11px] text-slate-300 leading-relaxed font-sans whitespace-pre-wrap">
                                  {line.message}
                                </div>
                              </div>
                            );
                          }
                          // skip intermediate chunk events from display (already assembled in done)
                          if (line.type === 'visual_analysis_chunk') return null;
                          return (
                            <div key={i} className={`flex items-start gap-1.5 px-1.5 py-0.5 rounded ${line.type === 'pass' ? 'text-emerald-400' : line.type === 'fail' ? 'text-red-400 bg-red-500/5' : line.type === 'done' ? (line.message.includes('✅') ? 'text-emerald-300 font-bold' : 'text-red-300 font-bold') : line.type === 'trace' ? 'text-slate-700' : line.type === 'start' ? 'text-indigo-400' : 'text-slate-500'}`}>
                              <span className="flex-shrink-0">{line.type === 'pass' ? '✓' : line.type === 'fail' ? '✗' : line.type === 'done' ? (line.message.includes('✅') ? '✅' : '❌') : line.type === 'start' ? '▶' : '  '}</span>
                              <span className="whitespace-pre-wrap break-all">{line.message}</span>
                            </div>
                          );
                        })}
                        {/* Video playback — shows failure video */}
                        {videoUrl && execStatus === 'failed' && (
                          <div className="mt-3 rounded-xl border border-slate-700 overflow-hidden bg-slate-900">
                            <div className="flex items-center gap-2 px-3 py-2 border-b border-slate-700 bg-slate-800">
                              <span>🎥</span>
                              <span className="text-[10px] font-bold text-slate-300">Failure Recording</span>
                              <span className="text-[9px] text-slate-500 ml-auto">Shows what happened</span>
                            </div>
                            <video
                              src={videoUrl}
                              controls
                              autoPlay
                              muted
                              loop
                              className="w-full max-h-40 object-contain bg-black"
                            />
                          </div>
                        )}
                        {/* Fixer Agent panel */}
                        {execStatus === 'failed' && (
                          <div className="mt-3 border border-amber-500/20 rounded-xl bg-amber-500/5 p-3">
                            <div className="flex items-center gap-2 mb-2">
                              <span className="text-[10px] font-bold text-amber-400">🔧 Fixer Agent</span>
                              {isHealing && <div className="w-2 h-2 border border-amber-400/30 border-t-amber-400 rounded-full animate-spin" />}
                            </div>
                            {healLog.map((l, i) => (
                              <div key={i} className="text-[9px] font-mono text-amber-300/70 leading-relaxed">{l}</div>
                            ))}
                            {!isHealing && healLog.length === 0 && (
                              <button onClick={startHealing}
                                className="w-full py-1.5 rounded-lg bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/20 text-amber-300 text-[10px] font-bold transition-colors">
                                🔧 Auto-Heal & Re-run
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>

                {/* AI Save Result Banner */}
                {aiSaveResult && (
                  <div className="flex-shrink-0 px-4 py-2 border-t border-violet-500/20 bg-violet-500/5 text-[10px] font-mono">
                    <div className="flex items-start gap-4">
                      {aiSaveResult.written.length > 0 && (
                        <div>
                          <span className="text-emerald-400 font-bold">✚ Created ({aiSaveResult.written.length})</span>
                          <div className="text-emerald-300/70 mt-0.5 space-y-0.5">
                            {aiSaveResult.written.map(f => <div key={f}>{f}</div>)}
                          </div>
                        </div>
                      )}
                      {aiSaveResult.merged.length > 0 && (
                        <div>
                          <span className="text-blue-400 font-bold">⟳ Merged ({aiSaveResult.merged.length})</span>
                          <div className="text-blue-300/70 mt-0.5 space-y-0.5">
                            {aiSaveResult.merged.map(f => <div key={f}>{f}</div>)}
                          </div>
                        </div>
                      )}
                      {aiSaveResult.skipped.length > 0 && (
                        <div>
                          <span className="text-slate-500 font-bold">⊘ Skipped ({aiSaveResult.skipped.length})</span>
                          <div className="text-slate-600 mt-0.5 space-y-0.5">
                            {aiSaveResult.skipped.slice(0, 5).map(f => <div key={f}>{f}</div>)}
                            {aiSaveResult.skipped.length > 5 && <div className="text-slate-700">…and {aiSaveResult.skipped.length - 5} more</div>}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Footer */}
                <div className="flex items-center justify-between px-4 py-2.5 border-t-2 border-slate-700 bg-slate-800 flex-shrink-0">
                  <div className="text-[10px] text-slate-400">
                    {frameworkFiles.length} files · POM + Business Actions + Generic Actions · Self-healing enabled
                  </div>
                  <button onClick={() => { setShowFramework(false); setSessionStatus('idle'); setNlSteps([]); setEvents([]); setIframeUrl(null); setSessionId(null); setAgents(AGENTS); iframeStepRef.current = 0; }}
                    className="px-3 py-1.5 rounded-lg border border-slate-700 hover:border-slate-600 text-xs text-slate-400 transition-colors">
                    🔄 New Recording
                  </button>
                </div>
              </div>
            )}

            {/* ── SETUP BANNER — shown when Playwright not installed ── */}
            {setupReady === false && (
              <div className="absolute inset-x-0 top-0 z-50 mx-4 mt-3">
                <div className="rounded-xl border border-amber-500/40 bg-amber-950/80 backdrop-blur-sm p-4 shadow-2xl">
                  <div className="flex items-start gap-3">
                    <div className="text-2xl flex-shrink-0">⚠️</div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold text-amber-300 mb-1">Playwright Not Ready</p>
                      {isAwsHosted ? (
                        // On AWS, installing Playwright in-process via the
                        // SSE endpoint hits the API Gateway 30s timeout and
                        // is the wrong place to do it anyway — Playwright
                        // should be installed once, server-side, as part of
                        // EC2 provisioning. Show admin guidance instead.
                        <>
                          <p className="text-xs text-amber-400/80 mb-3">Playwright isn't installed on the server. Ask your administrator to run this command once on the EC2 host:</p>
                          <pre className="mb-2 rounded-lg bg-black/40 px-3 py-2 font-mono text-[10px] text-amber-300/90 overflow-x-auto whitespace-pre">sudo -E npx playwright install --with-deps chromium</pre>
                          <p className="text-[10px] text-amber-400/60">After it finishes, refresh this page.</p>
                        </>
                      ) : (
                        <>
                          <p className="text-xs text-amber-400/80 mb-3">Before you can run tests, Playwright needs to be set up on this computer. This is a one-time step that takes about 1 minute.</p>
                          {installLog.length > 0 && (
                            <div className="mb-3 max-h-24 overflow-auto rounded-lg bg-black/40 px-3 py-2 font-mono text-[10px] text-amber-300/70 space-y-0.5">
                              {installLog.map((l, i) => <div key={i}>{l}</div>)}
                            </div>
                          )}
                          <button
                            onClick={installPlaywright}
                            disabled={isInstalling}
                            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 disabled:opacity-60 text-amber-950 text-xs font-bold transition-all"
                          >
                            {isInstalling
                              ? <><div className="w-3 h-3 border-2 border-amber-950/30 border-t-amber-950 rounded-full animate-spin" /> Setting up...</>
                              : <>🚀 Set Up Playwright (One-time)</>}
                          </button>
                        </>
                      )}
                    </div>
                    <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 mt-1 ${setupReady === null ? 'bg-slate-500 animate-pulse' : setupReady ? 'bg-emerald-400' : 'bg-amber-400 animate-pulse'}`} />
                  </div>
                </div>
              </div>
            )}
            {setupReady === true && !showFramework && !showScripts && (
              <div className="absolute top-3 right-3 z-20 flex items-center gap-1.5 px-2 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20">
                <div className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                <span className="text-[10px] text-emerald-400 font-semibold">Playwright Ready</span>
              </div>
            )}

            {/* ── LEGACY SCRIPTS VIEW (raw .spec.ts) ── */}
            {showScripts && !showFramework && (
              <div className="absolute inset-0 z-30 flex flex-col bg-slate-900">
                {/* Header */}
                <div className="flex items-center justify-between px-4 py-2.5 border-b-2 border-slate-700 bg-slate-800 flex-shrink-0">
                  <div className="flex items-center gap-2.5">
                    <div className="w-6 h-6 rounded-md bg-gradient-to-br from-blue-500 to-cyan-500 flex items-center justify-center text-xs">✍️</div>
                    <div>
                      <span className="text-xs font-bold text-slate-100">Generated Playwright Script</span>
                      <span className="text-[10px] text-slate-400 ml-2">{nlSteps.length} steps → TypeScript</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {/* In-app Playwright execution removed by product decision —
                        the recommended flow is Save / Download the script and
                        run it in the user's own Playwright project. */}
                    {/* Credentials button — shown when script needs env vars */}
                    {requiredEnvVars.length > 0 && (
                      <button
                        onClick={() => setShowCredentials(v => !v)}
                        className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-semibold transition-all ${Object.keys(credentials).length >= requiredEnvVars.length ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300' : 'bg-amber-500/10 border-amber-500/30 text-amber-300 animate-pulse'}`}
                      >
                        🔑 {Object.keys(credentials).length >= requiredEnvVars.length ? 'Credentials ✓' : `Credentials needed (${requiredEnvVars.length})`}
                      </button>
                    )}
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(generatedScript);
                        setScriptCopied(true);
                        setTimeout(() => setScriptCopied(false), 2000);
                      }}
                      className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs text-slate-300 transition-colors"
                    >
                      {scriptCopied ? '✓ Copied!' : '📋 Copy'}
                    </button>
                    <a
                      href={`data:text/plain;charset=utf-8,${encodeURIComponent(generatedScript)}`}
                      download="recorded-flow.spec.ts"
                      className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs text-slate-300 transition-colors"
                    >
                      ↓ .spec.ts
                    </a>
                    <button
                      onClick={openSaveModal}
                      className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-violet-600/20 hover:bg-violet-600/30 border border-violet-500/30 text-violet-300 text-xs font-semibold transition-colors"
                    >
                      🗂 Save to Library
                    </button>
                    <button
                      onClick={() => setShowScripts(false)}
                      className="px-2.5 py-1.5 rounded-lg border border-slate-700 hover:border-slate-600 text-xs text-slate-400 transition-colors"
                    >
                      ← Browser
                    </button>
                  </div>
                </div>

                {/* Credentials Panel */}
                {showCredentials && requiredEnvVars.length > 0 && (
                  <div className="flex-shrink-0 px-4 py-3 border-b border-slate-700 bg-slate-800/80">
                    <div className="flex items-center gap-2 mb-3">
                      <span className="text-xs font-bold text-amber-300">🔑 Test Credentials</span>
                      <span className="text-[10px] text-slate-500">Entered here — never saved to disk</span>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      {requiredEnvVars.map(varName => (
                        <div key={varName}>
                          <label className="block text-[10px] text-slate-400 mb-1">
                            {varName.replace(/_/g, ' ').replace(/\bTEST\b/i, '').trim() || varName}
                          </label>
                          <input
                            type="password"
                            placeholder={`Enter ${varName}`}
                            value={credentials[varName] || ''}
                            onChange={e => setCredentials(prev => ({ ...prev, [varName]: e.target.value }))}
                            className="w-full bg-slate-900 border border-slate-600 focus:border-amber-500 rounded-lg px-3 py-1.5 text-xs text-white outline-none transition-colors"
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* ── Execution Result Summary Banner ── */}
                {execStatus !== 'idle' && (
                  <div className={`flex-shrink-0 px-4 py-3 border-b flex items-center gap-3 ${execStatus === 'running' ? 'border-yellow-500/30 bg-yellow-500/5' : execStatus === 'passed' ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-red-500/30 bg-red-500/5'}`}>
                    <div className={`text-2xl ${execStatus === 'running' ? 'animate-spin' : ''}`}>
                      {execStatus === 'running' ? '⟳' : execStatus === 'passed' ? '✅' : '❌'}
                    </div>
                    <div className="flex-1">
                      <p className={`text-sm font-bold ${execStatus === 'running' ? 'text-yellow-300' : execStatus === 'passed' ? 'text-emerald-300' : 'text-red-300'}`}>
                        {execStatus === 'running' ? 'Test is running...' : execStatus === 'passed' ? 'Test Passed! 🎉' : 'Test Failed'}
                      </p>
                      {execStatus === 'failed' && execOutput.length > 0 && (() => {
                        const failLine = execOutput.find(l => l.type === 'fail' || l.type === 'done');
                        const analysis = execOutput.find(l => l.type === 'visual_analysis_done');
                        return (
                          <p className="text-xs text-red-400/80 mt-0.5 line-clamp-2">
                            {analysis ? analysis.message.slice(0, 120) + '...' : failLine ? _friendlyError(failLine.message) : 'Something went wrong'}
                          </p>
                        );
                      })()}
                      {execStatus === 'passed' && (
                        <p className="text-xs text-emerald-400/70 mt-0.5">All steps completed successfully</p>
                      )}
                    </div>
                    {execStatus === 'failed' && (
                      <button
                        onClick={() => setShowExecute(v => !v)}
                        className="px-3 py-1.5 rounded-lg bg-red-500/10 border border-red-500/20 text-red-300 text-xs font-semibold hover:bg-red-500/20 transition-colors"
                      >
                        {showExecute ? 'Hide Details' : 'See Details'}
                      </button>
                    )}
                    {execStatus === 'running' && (
                      <div className="w-4 h-4 border-2 border-yellow-500/30 border-t-yellow-400 rounded-full animate-spin" />
                    )}
                  </div>
                )}

                {/* Body: script left, execution right when active */}
                <div className={`flex-1 overflow-hidden flex ${showExecute ? 'flex-row' : 'flex-col'}`}>
                  {/* Script code */}
                  <div className={`overflow-auto p-4 ${showExecute ? 'w-1/2 border-r border-slate-800' : 'flex-1'}`} style={{ scrollbarWidth: 'thin', scrollbarColor: '#1e293b transparent' }}>
                    <pre className="text-xs font-mono leading-relaxed whitespace-pre-wrap bg-slate-950/60 border border-slate-800 rounded-xl p-4 min-h-full">
                      {generatedScript.split('\n').map((line, i) => (
                        <span key={i} className={
                          line.trim().startsWith('//') ? 'text-slate-600' :
                          line.startsWith('import') ? 'text-violet-400' :
                          line.includes("test(") ? 'text-blue-400' :
                          line.includes('await') ? 'text-emerald-300' :
                          line.trim() === '});' ? 'text-slate-500' :
                          'text-slate-200'
                        }>{line}{'\n'}</span>
                      ))}
                    </pre>
                  </div>

                  {/* Execution output panel */}
                  {showExecute && (
                    <div className="w-1/2 flex flex-col">
                      <div className="flex items-center justify-between px-3 py-2 border-b border-slate-800 bg-slate-900/60 flex-shrink-0">
                        <div className="flex items-center gap-2">
                          <div className={`w-2 h-2 rounded-full ${execStatus === 'running' ? 'bg-yellow-400 animate-pulse' : execStatus === 'passed' ? 'bg-emerald-400' : execStatus === 'failed' ? 'bg-red-400' : 'bg-slate-600'}`} />
                          <span className="text-xs font-semibold text-slate-300">Execution Output</span>
                          <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${execStatus === 'running' ? 'bg-yellow-500/10 text-yellow-400' : execStatus === 'passed' ? 'bg-emerald-500/10 text-emerald-400' : execStatus === 'failed' ? 'bg-red-500/10 text-red-400' : 'bg-slate-800 text-slate-500'}`}>
                            {execStatus.toUpperCase()}
                          </span>
                        </div>
                        <button onClick={() => setShowExecute(false)} className="text-slate-600 hover:text-slate-400 text-xs">✕</button>
                      </div>
                      <div ref={execOutputRef} className="flex-1 overflow-auto p-3 font-mono text-[11px] space-y-0.5 bg-[#030712]" style={{ scrollbarWidth: 'thin', scrollbarColor: '#1e293b transparent' }}>
                        {execOutput.map((line, i) => {
                          if (line.type === 'visual_analysis_start') {
                            return (
                              <div key={i} className="mt-2 px-2 py-1.5 rounded-lg bg-blue-500/10 border border-blue-500/20 text-blue-300 text-[10px] flex items-center gap-1.5">
                                <span className="animate-pulse">🔍</span> {line.message}
                              </div>
                            );
                          }
                          if (line.type === 'visual_analysis_done') {
                            return (
                              <div key={i} className="mt-2 rounded-xl border border-blue-500/25 bg-blue-500/5 overflow-hidden">
                                <div className="flex items-center gap-2 px-3 py-2 border-b border-blue-500/20 bg-blue-500/10">
                                  <span>📸</span>
                                  <span className="text-[10px] font-bold text-blue-300">Visual Failure Analysis</span>
                                  <span className="text-[9px] text-blue-500 ml-auto">Claude Vision</span>
                                </div>
                                <div className="px-3 py-2 text-[11px] text-slate-300 leading-relaxed font-sans whitespace-pre-wrap">
                                  {line.message}
                                </div>
                              </div>
                            );
                          }
                          if (line.type === 'visual_analysis_chunk') return null;
                          return (
                            <div key={i} className={`flex items-start gap-2 px-2 py-0.5 rounded ${line.type === 'pass' ? 'text-emerald-400' : line.type === 'fail' ? 'text-red-400 bg-red-500/5' : line.type === 'error' ? 'text-red-300' : line.type === 'warn' ? 'text-yellow-500' : line.type === 'summary' ? 'text-white font-bold' : line.type === 'done' ? (line.message.includes('✅') ? 'text-emerald-300 font-bold' : 'text-red-300 font-bold') : line.type === 'trace' ? 'text-slate-700' : line.type === 'start' ? 'text-indigo-400' : 'text-slate-400'}`}>
                              <span className="flex-shrink-0 mt-0.5">
                                {line.type === 'pass' ? '✓' : line.type === 'fail' ? '✗' : line.type === 'done' ? (line.message.includes('✅') ? '✅' : '❌') : line.type === 'start' ? '▶' : line.type === 'summary' ? '📊' : '  '}
                              </span>
                              <span className="whitespace-pre-wrap break-all">{line.message}</span>
                            </div>
                          );
                        })}
                        {/* Video playback — shows failure video */}
                        {videoUrl && execStatus === 'failed' && (
                          <div className="mt-3 rounded-xl border border-slate-700 overflow-hidden bg-slate-900">
                            <div className="flex items-center gap-2 px-3 py-2 border-b border-slate-700 bg-slate-800">
                              <span>🎥</span>
                              <span className="text-[10px] font-bold text-slate-300">Failure Recording</span>
                              <span className="text-[9px] text-slate-500 ml-auto">Shows what happened</span>
                            </div>
                            <video
                              src={videoUrl}
                              controls
                              autoPlay
                              muted
                              loop
                              className="w-full max-h-40 object-contain bg-black"
                            />
                          </div>
                        )}
                        {execStatus === 'running' && (
                          <div className="flex items-center gap-2 px-2 py-1 text-slate-600">
                            <div className="w-1.5 h-1.5 bg-yellow-500 rounded-full animate-bounce" style={{animationDelay:'0ms'}} />
                            <div className="w-1.5 h-1.5 bg-yellow-500 rounded-full animate-bounce" style={{animationDelay:'150ms'}} />
                            <div className="w-1.5 h-1.5 bg-yellow-500 rounded-full animate-bounce" style={{animationDelay:'300ms'}} />
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>

                {/* Footer actions */}
                <div className="flex items-center justify-between px-4 py-3 border-t border-slate-800/60 bg-slate-900/40 flex-shrink-0">
                  <div className="text-[10px] text-slate-600">
                    Playwright TypeScript · {generatedScript.split('\n').length} lines · Based on {nlSteps.length} recorded steps
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => {
                        setShowScripts(false);
                        setSessionStatus('idle');
                        setNlSteps([]);
                        setEvents([]);
                        setIframeUrl(null);
                        setSessionId(null);
                        setAgents(AGENTS);
                        iframeStepRef.current = 0;
                      }}
                      className="px-3 py-1.5 rounded-lg border border-slate-700 hover:border-slate-600 text-xs text-slate-400 transition-colors"
                    >
                      🔄 New Recording
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Save to Library Modal */}
            {showSaveModal && (
              <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
                <div className="w-[420px] bg-[#0d1424] border border-slate-700 rounded-2xl shadow-2xl overflow-hidden">
                  {/* Modal header */}
                  <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800">
                    <div className="flex items-center gap-2.5">
                      <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center text-sm">🗂</div>
                      <div>
                        <div className="text-sm font-bold text-white">Save to Test Library</div>
                        <div className="text-[10px] text-slate-500">Store this test for regression runs</div>
                      </div>
                    </div>
                    <button onClick={() => setShowSaveModal(false)} className="text-slate-600 hover:text-slate-400 text-lg leading-none">✕</button>
                  </div>

                  {saveStatus === 'saved' && projectSaveStatus !== 'saved' ? (
                    <div className="px-5 py-8 text-center">
                      <div className="text-4xl mb-3">✅</div>
                      <div className="text-sm font-bold text-emerald-400 mb-1">Test Saved!</div>
                      <div className="text-xs text-slate-500 mb-5">"{saveTestName}" is now in your Test Library</div>
                      <div className="flex gap-2 justify-center">
                        <button onClick={() => setShowSaveModal(false)} className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs text-slate-300 transition-colors">Close</button>
                        <a href="/qe/test-library" className="px-4 py-2 rounded-lg bg-gradient-to-r from-violet-600 to-purple-600 text-white text-xs font-semibold transition-colors">Open Test Library →</a>
                      </div>
                    </div>
                  ) : projectSaveStatus === 'saved' && projectSavedFiles ? (
                    <div className="px-5 py-8 text-center">
                      <div className="text-4xl mb-3">📁</div>
                      <div className="text-sm font-bold text-emerald-400 mb-1">Project Library Updated!</div>
                      <div className="text-xs text-slate-500 mb-4">Files written to <span className="text-violet-400 font-mono">projects/{projectName.trim()}/</span></div>
                      <div className="text-left bg-slate-900/60 border border-slate-800 rounded-lg px-3 py-2 text-[10px] font-mono space-y-1 mb-4">
                        {projectSavedFiles.written.map(f => (
                          <div key={f} className="flex items-center gap-2 text-emerald-400"><span>✚</span>{f}</div>
                        ))}
                        {projectSavedFiles.merged.map(f => (
                          <div key={f} className="flex items-center gap-2 text-blue-400"><span>⟳</span>{f} <span className="text-slate-600">(merged)</span></div>
                        ))}
                      </div>
                      <div className="text-[10px] text-slate-600 mb-4">
                        Run: <span className="font-mono text-violet-400">npx playwright test --config projects/{projectName.trim()}/playwright.config.ts</span>
                      </div>
                      <button onClick={() => setShowSaveModal(false)} className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs text-slate-300 transition-colors">Close</button>
                    </div>
                  ) : (
                    <div className="px-5 py-4 space-y-4">
                      {/* Test name */}
                      <div>
                        <label className="text-xs font-semibold text-slate-400 mb-1.5 block">Test Name</label>
                        <input
                          value={saveTestName}
                          onChange={e => setSaveTestName(e.target.value)}
                          placeholder="e.g. Submit contact form successfully"
                          className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 outline-none focus:border-violet-500 transition-colors"
                        />
                      </div>

                      {/* ── Project Library section (shown when projectName is set) ── */}
                      {projectName.trim() && frameworkFilesResult && (
                        <div className="border border-violet-500/30 bg-violet-500/5 rounded-xl p-3 space-y-2">
                          <div className="flex items-center gap-2">
                            <span className="text-base">📁</span>
                            <div>
                              <div className="text-xs font-bold text-violet-300">Save to Project Library</div>
                              <div className="text-[10px] text-slate-500">Shared locator files · project: <span className="text-violet-400">{projectName.trim()}</span></div>
                            </div>
                          </div>

                          {/* File preview */}
                          <div className="bg-slate-950/60 border border-slate-800 rounded-lg px-3 py-2 text-[10px] font-mono space-y-1">
                            <div className="text-slate-500 mb-1">📂 projects/{projectName.trim()}/</div>
                            {frameworkFilesResult.locatorFiles.map(lf => {
                              const existing = existingLocators.find(e => e.pageName === lf.pageName);
                              return (
                                <div key={lf.pageName} className="flex items-center justify-between gap-2">
                                  <span className="text-slate-400">  📄 locators/{lf.pageName}.locators.ts</span>
                                  {existing ? (
                                    <span className="text-blue-400 bg-blue-500/10 border border-blue-500/20 rounded px-1.5 py-0.5 text-[9px]">
                                      merge ({Object.keys(lf.locators).length} new + {existing.keyCount} existing)
                                    </span>
                                  ) : (
                                    <span className="text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded px-1.5 py-0.5 text-[9px]">
                                      new ({Object.keys(lf.locators).length} locators)
                                    </span>
                                  )}
                                </div>
                              );
                            })}
                            <div className="text-slate-400">  📄 helpers/universal.ts <span className="text-blue-400 text-[9px]">auto-refreshed</span></div>
                            <div className="text-slate-400">  📄 tests/{saveTestName.toLowerCase().replace(/\s+/g,'-').replace(/[^a-z0-9-]/g,'')}.spec.ts <span className="text-emerald-400 text-[9px]">overwrite</span></div>
                            <div className="text-slate-400">  📄 playwright.config.ts <span className="text-slate-600 text-[9px]">first-time only</span></div>
                          </div>

                          {projectSaveStatus === 'error' && (
                            <div className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-2 py-1">Save failed. Check server logs.</div>
                          )}

                          <button
                            onClick={saveToProjectLibrary}
                            disabled={!saveTestName.trim() || projectSaveStatus === 'saving'}
                            className="w-full py-2 rounded-lg bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 disabled:opacity-50 text-white text-xs font-bold transition-all flex items-center justify-center gap-2"
                          >
                            {projectSaveStatus === 'saving'
                              ? <><div className="w-3 h-3 border border-white/30 border-t-white rounded-full animate-spin" /> Saving...</>
                              : <>📁 Save to Project Library</>}
                          </button>
                        </div>
                      )}

                      {/* Divider when both options shown */}
                      {projectName.trim() && frameworkFilesResult && (
                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-px bg-slate-800" />
                          <span className="text-[10px] text-slate-600">or save to test library</span>
                          <div className="flex-1 h-px bg-slate-800" />
                        </div>
                      )}

                      {/* Folder picker */}
                      <div>
                        <label className="text-xs font-semibold text-slate-400 mb-1.5 block">Save to Folder</label>
                        <select
                          value={saveFolderId}
                          onChange={e => setSaveFolderId(e.target.value)}
                          className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-violet-500 transition-colors"
                        >
                          {saveFolders.map(f => (
                            <option key={f.id} value={f.id}>
                              {f.parentId ? `  └ ${f.name}` : f.name}
                            </option>
                          ))}
                        </select>
                        <div className="text-[10px] text-slate-600 mt-1">You can reorganize folders in the Test Library page</div>
                      </div>

                      {/* Script preview */}
                      <div className="bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-[10px] font-mono text-slate-500 max-h-20 overflow-hidden">
                        {generatedScript.split('\n').slice(0, 5).join('\n')}...
                      </div>

                      {saveStatus === 'error' && (
                        <div className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">Failed to save. Please try again.</div>
                      )}

                      <div className="flex gap-2 pt-1">
                        <button onClick={() => setShowSaveModal(false)} className="flex-1 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs text-slate-400 transition-colors">Cancel</button>
                        <button
                          onClick={saveToLibrary}
                          disabled={!saveTestName.trim() || saveStatus === 'saving'}
                          className="flex-1 py-2 rounded-lg bg-gradient-to-r from-violet-600 to-purple-600 hover:from-violet-500 hover:to-purple-500 disabled:opacity-50 text-white text-xs font-bold transition-all flex items-center justify-center gap-2"
                        >
                          {saveStatus === 'saving' ? <><div className="w-3 h-3 border border-white/30 border-t-white rounded-full animate-spin" /> Saving...</> : <>🗂 Save Test</>}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Subtle grid bg — shown when no iframe */}
            {!iframeUrl && !showScripts && (
              <div className="absolute inset-0 opacity-[0.015]"
                style={{ backgroundImage: "linear-gradient(rgba(99,102,241,1) 1px, transparent 1px), linear-gradient(90deg, rgba(99,102,241,1) 1px, transparent 1px)", backgroundSize: "30px 30px" }} />
            )}

            {/* Recording Window active — show status instead of blank iframe */}
            {recordingWindowOpen && !iframeUrl && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-5 z-10">
                <div className="flex flex-col items-center gap-4 max-w-sm text-center">
                  <div className="w-16 h-16 rounded-2xl bg-violet-500/10 border border-violet-500/30 flex items-center justify-center text-3xl animate-pulse">⧉</div>
                  <div>
                    <p className="text-sm font-bold text-violet-300">Recording in Separate Window</p>
                    <p className="text-xs text-slate-500 mt-1">Interact with the website in the other window.<br/>Steps appear here in real time.</p>
                  </div>
                  <div className="flex items-center gap-2 text-[10px] text-slate-600 bg-slate-900/60 border border-slate-800 rounded-lg px-4 py-2">
                    <div className="w-1.5 h-1.5 bg-violet-400 rounded-full animate-pulse" />
                    Listening for events via BroadcastChannel
                  </div>
                  <button
                    onClick={() => { recordingWindowRef.current?.focus(); }}
                    className="px-4 py-2 rounded-lg bg-violet-600/20 hover:bg-violet-600/30 border border-violet-500/30 text-violet-300 text-xs font-semibold transition-colors"
                  >
                    ↗ Focus Recording Window
                  </button>
                  {nlSteps.length > 0 && (
                    <button
                      onClick={proceedToGenerate}
                      className="px-4 py-2 rounded-lg bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white text-xs font-bold transition-all"
                    >
                      ✨ Generate Scripts →
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* ── Proxy error banner — shown when site can't be loaded in iframe ── */}
            {iframeError && (
              <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-slate-100 gap-4 p-6">
                <div className="w-16 h-16 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-3xl">🌐</div>
                <div className="text-center max-w-md">
                  <p className="text-sm font-bold text-amber-300 mb-1">
                    {iframeError.reason === 'connection_refused' ? 'Site Refused Connection' :
                     iframeError.reason === 'timeout'            ? 'Connection Timed Out' :
                     iframeError.reason === 'dns_failed'         ? 'Domain Not Found' :
                     iframeError.reason === 'blocks_framing'     ? 'Site Blocks Embedding' :
                                                                   'Cannot Load in Embedded View'}
                  </p>
                  <p className="text-xs text-slate-400 leading-relaxed mb-1">
                    {iframeError.reason === 'connection_refused'
                      ? 'This site blocks server-side proxy requests — common with enterprise, education, and banking portals.'
                      : iframeError.reason === 'blocks_framing'
                      ? 'This site sets X-Frame-Options or CSP headers that prevent embedding. The proxy stripped them but the site may still misbehave.'
                      : 'The embedded browser could not reach this site through the proxy.'}
                  </p>
                  {isAwsHosted ? (
                    <p className="text-[11px] text-slate-500">
                      Try <strong className="text-violet-400">Record in Window</strong> to record in a separate browser window via the Chrome extension instead.
                    </p>
                  ) : (
                    <p className="text-[11px] text-slate-500">
                      <strong className="text-emerald-400">Record with Playwright</strong> launches Playwright's own browser — bypasses all proxy, framing and org-policy restrictions. Works on any site.
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => { setIframeError(null); setIframeUrl(null); }}
                    className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold border border-slate-700 transition-colors"
                  >
                    ✕ Dismiss
                  </button>
                  {!isAwsHosted && (
                    <button
                      onClick={() => {
                        const targetUrl = iframeError.url;
                        setIframeError(null);
                        setIframeUrl(null);
                        handleOpenPlaywright(targetUrl);
                      }}
                      className="px-5 py-2 rounded-lg bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white text-xs font-bold transition-all shadow-lg shadow-emerald-900/30 flex items-center gap-2"
                    >
                      🎭 Record with Playwright
                    </button>
                  )}
                  <button
                    onClick={() => {
                      setIframeError(null);
                      setIframeUrl(null);
                      handleOpenWindow(iframeError.url);
                    }}
                    className="px-4 py-2 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-200 text-xs font-semibold border border-slate-600 transition-colors"
                  >
                    ⧉ Record in Window
                  </button>
                </div>
              </div>
            )}

            {iframeUrl && !iframeError ? (
              <div className="relative w-full h-full">
                {/* Loading shimmer */}
                {iframeLoading && (
                  <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-slate-100 gap-3">
                    <div className="w-8 h-8 border-2 border-slate-300 border-t-slate-600 rounded-full animate-spin" />
                    <span className="text-xs text-slate-500">Loading page…</span>
                  </div>
                )}

                {/* The website iframe */}
                <iframe
                  ref={iframeRef}
                  key={iframeUrl}
                  src={iframeUrl}
                  className="w-full h-full border-0"
                  sandbox="allow-scripts allow-forms allow-popups allow-pointer-lock allow-modals"
                  referrerPolicy="no-referrer"
                  onLoad={() => {
                    setIframeLoading(false);
                    // Re-send assert mode state after page reload
                    if (assertMode) {
                      setTimeout(() => {
                        iframeRef.current?.contentWindow?.postMessage(
                          { target: '__devxqe_assert', mode: 'on' }, '*'
                        );
                      }, 300);
                    }
                  }}
                  title="Recorded website"
                />

                {/* REC badge */}
                {isRecording && !assertMode && (
                  <div className="absolute top-3 right-3 z-20 flex items-center gap-1.5 bg-red-500/20 backdrop-blur-sm border border-red-500/40 rounded-full px-2.5 py-1 pointer-events-none">
                    <div className="w-1.5 h-1.5 bg-red-400 rounded-full animate-pulse" />
                    <span className="text-[10px] text-red-400 font-bold">REC</span>
                  </div>
                )}

                {/* Assert mode active banner */}
                {assertMode && !pendingAssert && (
                  <div className="absolute top-3 left-1/2 -translate-x-1/2 z-20 flex items-center gap-2 bg-amber-500/20 backdrop-blur-sm border border-amber-500/40 rounded-full px-3 py-1.5 pointer-events-none">
                    <div className="w-1.5 h-1.5 bg-amber-400 rounded-full animate-pulse" />
                    <span className="text-[10px] text-amber-300 font-bold">ASSERT MODE — hover & click any element</span>
                  </div>
                )}

                {/* Assertion panel — slides up from bottom when element is picked */}
                {pendingAssert && (
                  <AssertionPanel
                    elementInfo={pendingAssert}
                    onConfirm={confirmAssertion}
                    onCancel={() => setPendingAssert(null)}
                  />
                )}

                {/* Screenshot thumbnail — bottom-right corner, shows latest captured frame */}
                {latestScreenshot && (
                  <div className="absolute bottom-3 right-3 z-20 w-40 rounded-lg overflow-hidden border border-indigo-500/40 shadow-xl shadow-black/60 pointer-events-none">
                    <div className="bg-slate-900/90 px-2 py-1 flex items-center gap-1.5">
                      <div className="w-1.5 h-1.5 bg-emerald-400 rounded-full" />
                      <span className="text-[9px] text-slate-400 font-semibold tracking-wide">CAPTURED</span>
                    </div>
                    <img src={latestScreenshot} alt="Latest capture" className="w-full object-cover" />
                  </div>
                )}

                {/* Latest NL step overlay */}
                {nlSteps.length > 0 && (
                  <div className="absolute bottom-3 left-3 right-48 z-20 bg-slate-900/95 backdrop-blur-sm border border-indigo-500/40 rounded-xl px-3 py-2 shadow-xl pointer-events-none">
                    <div className="flex items-start gap-2">
                      <span className="text-indigo-400 text-xs font-bold flex-shrink-0">✨</span>
                      <span className="text-[11px] text-slate-200 leading-relaxed line-clamp-2">{nlSteps[nlSteps.length - 1]}</span>
                    </div>
                  </div>
                )}
              </div>
            ) : recordingWindowOpen ? (
              /* Popup recording active — the "Recording in Separate Window" overlay (rendered via absolute positioning above) handles UI; suppress the empty-state placeholder so it does not bleed through behind the Generate Scripts button. */
              null
            ) : isPlaywrightRecording ? (
              /* ── Playwright Recording Panel ── */
              <div className="relative w-full h-full flex items-center justify-center">
                {/* Assert mode active banner */}
                {assertMode && !pendingAssert && (
                  <div className="absolute top-3 left-1/2 -translate-x-1/2 z-20 flex items-center gap-2 bg-amber-500/20 backdrop-blur-sm border border-amber-500/40 rounded-full px-3 py-1.5 pointer-events-none">
                    <div className="w-1.5 h-1.5 bg-amber-400 rounded-full animate-pulse" />
                    <span className="text-[10px] text-amber-300 font-bold">ASSERT MODE — hover & click any element in the Playwright browser</span>
                  </div>
                )}

                {/* Assertion panel for Playwright mode */}
                {pendingAssert && (
                  <AssertionPanel
                    elementInfo={pendingAssert}
                    onConfirm={confirmAssertion}
                    onCancel={() => setPendingAssert(null)}
                  />
                )}

                {/* Playwright status card */}
                {!pendingAssert && (
                  <div className="flex flex-col items-center gap-4 text-center max-w-xs relative z-10">
                    <div className="w-16 h-16 rounded-2xl bg-emerald-50 border border-emerald-200 flex items-center justify-center text-3xl">
                      🎭
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-emerald-600">Playwright browser is open</p>
                      <p className="text-xs text-gray-500 mt-1">Interact with the browser window — actions are captured here in real-time</p>
                    </div>
                    <div className="flex gap-1.5 items-center text-xs text-gray-400">
                      <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                      <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                      <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
                    </div>
                    {events.filter(e => e.type !== 'screenshot').length > 0 && (
                      <div className="text-xs text-slate-600 bg-slate-900/60 border border-slate-800 rounded-lg px-3 py-2">
                        {events.filter(e => e.type !== 'screenshot').length} action{events.filter(e => e.type !== 'screenshot').length !== 1 ? 's' : ''} recorded
                      </div>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <div className="flex items-center justify-center h-full bg-slate-100">
                <div className="flex flex-col items-center gap-4 text-center max-w-xs relative z-10">
                  <div className="w-16 h-16 rounded-2xl bg-white border-2 border-slate-300 shadow-sm flex items-center justify-center text-3xl">
                    {sessionStatus === "idle" ? "🌐" : sessionStatus === "waiting" ? "⏳" : isRecording ? "📸" : "✓"}
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-slate-500">
                      {sessionStatus === "idle" ? "Enter a URL above and click Open" :
                       sessionStatus === "waiting" ? "Enter a URL above — the site will load here" :
                       isRecording ? "Website loads here — interact and watch steps appear on the left" :
                       "Recording complete"}
                    </p>
                    <p className="text-xs text-slate-400 mt-1">The website renders inside this panel for live recording</p>
                  </div>
                  {isRecording && (
                    <div className="flex gap-1.5 items-center text-xs text-slate-500">
                      <div className="w-1.5 h-1.5 bg-indigo-500 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                      <div className="w-1.5 h-1.5 bg-indigo-500 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                      <div className="w-1.5 h-1.5 bg-indigo-500 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
