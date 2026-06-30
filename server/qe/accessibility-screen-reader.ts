// ============================================================================
// Screen Reader Simulation Engine — NAT 2.0
// ============================================================================
// Simulates NVDA/JAWS announcements using Playwright accessibility APIs.
// No actual screen reader installation required.
// ============================================================================

import type { Page } from 'playwright';

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

export interface AccessibilityNode {
  role: string;
  name: string;
  value?: string;
  description?: string;
  checked?: boolean | 'mixed';
  disabled?: boolean;
  expanded?: boolean;
  focused?: boolean;
  level?: number;
  required?: boolean;
  selected?: boolean;
  children?: AccessibilityNode[];
  depth: number;
  index: number;
}

export interface HeadingEntry {
  level: number;
  text: string;
}

export interface HeadingIssue {
  type: 'multiple-h1' | 'skipped-level' | 'empty-heading' | 'missing-h1';
  message: string;
}

export interface HeadingHierarchyResult {
  headings: HeadingEntry[];
  issues: HeadingIssue[];
  pass: boolean;
}

export interface LandmarkEntry {
  role: string;
  name: string;
  count: number;
}

export interface LandmarkResult {
  found: LandmarkEntry[];
  missing: string[];
  duplicates: string[];
  pass: boolean;
}

export interface LinkEntry {
  text: string;
  href: string;
  issues: string[];
}

export interface LinkAnalysisResult {
  links: LinkEntry[];
  totalLinks: number;
  problematicLinks: number;
  pass: boolean;
}

export interface FocusSequenceEntry {
  index: number;
  tag: string;
  role: string;
  name: string;
  x: number;
  y: number;
}

export interface FocusIssue {
  type: 'backwards-focus' | 'focus-trap' | 'unreachable-element';
  message: string;
  element?: string;
}

export interface FocusOrderResult {
  sequence: FocusSequenceEntry[];
  issues: FocusIssue[];
  pass: boolean;
}

export interface ARIAElementEntry {
  selector: string;
  role: string;
  ariaAttrs: Record<string, string>;
  issues: string[];
}

export interface ARIAValidationResult {
  elements: ARIAElementEntry[];
  totalARIAElements: number;
  issueCount: number;
  pass: boolean;
}

export interface ReadingOrderElement {
  element: string;
  domIndex: number;
  visualPosition: { x: number; y: number };
}

export interface ReadingOrderResult {
  outOfOrderElements: ReadingOrderElement[];
  pass: boolean;
}

export interface TranscriptEntry {
  index: number;
  announcement: string;
  role: string;
  name: string;
  landmark: string;
  depth: number;
  issues: string[];
}

export interface ScreenReaderTranscript {
  entries: TranscriptEntry[];
  totalElements: number;
  duration: number;
}

export interface ProgressEvent {
  agent: string;
  status: 'working' | 'complete' | 'error';
  message: string;
  progress: number;
  details?: string;
}

export type SendProgressCallback = (event: ProgressEvent) => void;

export interface ScreenReaderSimulationResult {
  accessibilityTree: AccessibilityNode[];
  headingHierarchy: HeadingHierarchyResult;
  landmarks: LandmarkResult;
  links: LinkAnalysisResult;
  focusOrder: FocusOrderResult;
  ariaValidation: ARIAValidationResult;
  readingOrder: ReadingOrderResult;
  transcript: ScreenReaderTranscript;
  overallScore: number;
  totalIssues: number;
  summary: string;
}

// ---------------------------------------------------------------------------
// Valid WAI-ARIA roles (subset covering most common roles)
// ---------------------------------------------------------------------------

const VALID_ARIA_ROLES = new Set([
  'alert', 'alertdialog', 'application', 'article', 'banner', 'blockquote',
  'button', 'caption', 'cell', 'checkbox', 'code', 'columnheader', 'combobox',
  'command', 'comment', 'complementary', 'composite', 'contentinfo', 'definition',
  'deletion', 'dialog', 'directory', 'document', 'emphasis', 'feed', 'figure',
  'form', 'generic', 'grid', 'gridcell', 'group', 'heading', 'img', 'input',
  'insertion', 'landmark', 'link', 'list', 'listbox', 'listitem', 'log', 'main',
  'mark', 'marquee', 'math', 'menu', 'menubar', 'menuitem', 'menuitemcheckbox',
  'menuitemradio', 'meter', 'navigation', 'none', 'note', 'option', 'paragraph',
  'presentation', 'progressbar', 'radio', 'radiogroup', 'range', 'region',
  'roletype', 'row', 'rowgroup', 'rowheader', 'scrollbar', 'search', 'searchbox',
  'section', 'sectionhead', 'select', 'separator', 'slider', 'spinbutton',
  'status', 'strong', 'structure', 'subscript', 'superscript', 'switch', 'tab',
  'table', 'tablist', 'tabpanel', 'term', 'textbox', 'time', 'timer', 'toolbar',
  'tooltip', 'tree', 'treegrid', 'treeitem', 'widget', 'window',
]);

// Roles that require specific children
const REQUIRED_CHILDREN: Record<string, string[]> = {
  tablist: ['tab'],
  menu: ['menuitem', 'menuitemcheckbox', 'menuitemradio'],
  menubar: ['menuitem', 'menuitemcheckbox', 'menuitemradio'],
  list: ['listitem'],
  listbox: ['option'],
  tree: ['treeitem'],
  grid: ['row', 'rowgroup'],
  table: ['row', 'rowgroup'],
  radiogroup: ['radio'],
  row: ['cell', 'columnheader', 'rowheader', 'gridcell'],
};

// Focusable element selectors
const FOCUSABLE_SELECTOR = [
  'a[href]', 'button:not([disabled])', 'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])', 'textarea:not([disabled])', '[tabindex]:not([tabindex="-1"])',
  '[contenteditable="true"]',
].join(', ');

// Vague link text patterns
const VAGUE_LINK_TEXT = /^(click here|here|read more|more|learn more|link|this|go|details|info)$/i;

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// 1. extractAccessibilityTree
// ---------------------------------------------------------------------------

export async function extractAccessibilityTree(
  page: Page,
  sendProgress?: SendProgressCallback,
): Promise<AccessibilityNode[]> {
  sendProgress?.({
    agent: 'screen-reader',
    status: 'working',
    message: 'Extracting accessibility tree...',
    progress: 5,
  });

  const snapshot = await page.accessibility.snapshot();
  if (!snapshot) {
    return [];
  }

  const flat: AccessibilityNode[] = [];
  let idx = 0;

  function walk(node: any, depth: number): AccessibilityNode {
    const mapped: AccessibilityNode = {
      role: node.role ?? '',
      name: node.name ?? '',
      value: node.value,
      description: node.description,
      checked: node.checked,
      disabled: node.disabled,
      expanded: node.expanded,
      focused: node.focused,
      level: node.level,
      required: node.required,
      selected: node.selected,
      depth,
      index: idx++,
    };

    if (node.children && node.children.length > 0) {
      mapped.children = node.children.map((child: any) => walk(child, depth + 1));
    }

    flat.push(mapped);
    return mapped;
  }

  walk(snapshot, 0);

  sendProgress?.({
    agent: 'screen-reader',
    status: 'working',
    message: `Extracted ${flat.length} nodes from accessibility tree`,
    progress: 10,
  });

  return flat;
}

// ---------------------------------------------------------------------------
// 2. computeAnnouncement
// ---------------------------------------------------------------------------

export function computeAnnouncement(node: AccessibilityNode): string {
  const parts: string[] = [];
  const role = node.role;
  const name = (node.name ?? '').trim();

  // Handle unlabeled images
  if (role === 'img' && !name) {
    return 'unlabeled image';
  }

  // Add the name first (how screen readers announce)
  if (name) {
    parts.push(name);
  }

  // Map role to screen-reader-friendly label
  const roleLabel = mapRoleToAnnouncement(role);
  if (roleLabel) {
    parts.push(roleLabel);
  }

  // Add heading level
  if (role === 'heading' && node.level != null) {
    // Replace last entry with level-annotated version
    parts[parts.length - 1] = `heading level ${node.level}`;
  }

  // Add state information
  if (node.checked === true) {
    parts.push('checked');
  } else if (node.checked === false) {
    parts.push('not checked');
  } else if (node.checked === 'mixed') {
    parts.push('partially checked');
  }

  if (node.expanded === true) {
    parts.push('expanded');
  } else if (node.expanded === false) {
    parts.push('collapsed');
  }

  if (node.selected === true) {
    parts.push('selected');
  }

  if (node.disabled === true) {
    parts.push('dimmed');
  }

  if (node.required === true) {
    parts.push('required');
  }

  if (node.value != null && node.value !== '' && node.value !== name) {
    parts.push(node.value);
  }

  return parts.join(', ') || role || 'unknown element';
}

function mapRoleToAnnouncement(role: string): string {
  const map: Record<string, string> = {
    button: 'button',
    link: 'link',
    checkbox: 'checkbox',
    radio: 'radio button',
    textbox: 'edit',
    searchbox: 'search edit',
    combobox: 'combo box',
    slider: 'slider',
    spinbutton: 'spin button',
    progressbar: 'progress bar',
    switch: 'switch',
    tab: 'tab',
    tabpanel: 'tab panel',
    menuitem: 'menu item',
    menuitemcheckbox: 'menu item checkbox',
    menuitemradio: 'menu item radio',
    option: 'option',
    treeitem: 'tree item',
    listitem: 'list item',
    img: 'image',
    figure: 'figure',
    heading: 'heading',
    navigation: 'navigation',
    main: 'main landmark',
    banner: 'banner',
    contentinfo: 'content info',
    complementary: 'complementary',
    search: 'search',
    form: 'form',
    region: 'region',
    alert: 'alert',
    alertdialog: 'alert dialog',
    dialog: 'dialog',
    status: 'status',
    tooltip: 'tooltip',
    table: 'table',
    row: 'row',
    cell: 'cell',
    columnheader: 'column header',
    rowheader: 'row header',
    grid: 'grid',
    gridcell: 'grid cell',
    list: 'list',
    separator: 'separator',
    toolbar: 'toolbar',
    menu: 'menu',
    menubar: 'menu bar',
    tree: 'tree',
    treegrid: 'tree grid',
    article: 'article',
    document: 'document',
    application: 'application',
    log: 'log',
    marquee: 'marquee',
    timer: 'timer',
    math: 'math',
    definition: 'definition',
    note: 'note',
    directory: 'directory',
  };
  return map[role] ?? '';
}

// ---------------------------------------------------------------------------
// 3. validateHeadingHierarchy
// ---------------------------------------------------------------------------

export async function validateHeadingHierarchy(
  page: Page,
  sendProgress?: SendProgressCallback,
): Promise<HeadingHierarchyResult> {
  sendProgress?.({
    agent: 'heading-checker',
    status: 'working',
    message: 'Validating heading hierarchy...',
    progress: 20,
  });

  const headings: HeadingEntry[] = await page.$$eval(
    'h1, h2, h3, h4, h5, h6',
    (els) =>
      els.map((el) => ({
        level: parseInt(el.tagName.substring(1), 10),
        text: (el.textContent ?? '').trim(),
      })),
  );

  const issues: HeadingIssue[] = [];

  // Check for missing H1
  const h1Count = headings.filter((h) => h.level === 1).length;
  if (h1Count === 0) {
    issues.push({
      type: 'missing-h1',
      message: 'Page has no H1 heading. Every page should have exactly one H1.',
    });
  }

  // Check for multiple H1s
  if (h1Count > 1) {
    issues.push({
      type: 'multiple-h1',
      message: `Page has ${h1Count} H1 headings. Only one H1 is recommended per page.`,
    });
  }

  // Check for empty headings
  for (const h of headings) {
    if (!h.text) {
      issues.push({
        type: 'empty-heading',
        message: `Empty H${h.level} heading found. Headings must have visible text content.`,
      });
    }
  }

  // Check for skipped levels
  for (let i = 1; i < headings.length; i++) {
    const prev = headings[i - 1].level;
    const curr = headings[i].level;
    if (curr > prev + 1) {
      issues.push({
        type: 'skipped-level',
        message: `Heading level skip from H${prev} to H${curr}. Expected H${prev + 1} before H${curr}. ("${headings[i].text || '(empty)'}")`,
      });
    }
  }

  sendProgress?.({
    agent: 'heading-checker',
    status: 'complete',
    message: `Found ${headings.length} headings, ${issues.length} issue(s)`,
    progress: 25,
  });

  return {
    headings,
    issues,
    pass: issues.length === 0,
  };
}

// ---------------------------------------------------------------------------
// 4. validateLandmarkStructure
// ---------------------------------------------------------------------------

export async function validateLandmarkStructure(
  page: Page,
  sendProgress?: SendProgressCallback,
): Promise<LandmarkResult> {
  sendProgress?.({
    agent: 'landmark-checker',
    status: 'working',
    message: 'Validating landmark structure...',
    progress: 30,
  });

  const snapshot = await page.accessibility.snapshot();
  if (!snapshot) {
    return { found: [], missing: ['main', 'navigation', 'banner', 'contentinfo'], duplicates: [], pass: false };
  }

  const landmarkRoles = ['main', 'navigation', 'banner', 'contentinfo', 'complementary', 'search'];
  const counts: Record<string, { names: string[]; count: number }> = {};

  function walkLandmarks(node: any): void {
    if (node.role && landmarkRoles.includes(node.role)) {
      if (!counts[node.role]) {
        counts[node.role] = { names: [], count: 0 };
      }
      counts[node.role].count++;
      if (node.name) {
        counts[node.role].names.push(node.name);
      }
    }
    if (node.children) {
      for (const child of node.children) {
        walkLandmarks(child);
      }
    }
  }

  walkLandmarks(snapshot);

  const found: LandmarkEntry[] = [];
  for (const [role, data] of Object.entries(counts)) {
    found.push({
      role,
      name: data.names.join(', ') || '(unnamed)',
      count: data.count,
    });
  }

  // Required landmarks
  const requiredLandmarks = ['main', 'navigation', 'banner', 'contentinfo'];
  const missing: string[] = requiredLandmarks.filter((r) => !counts[r]);

  // Check for duplicates (main should be unique)
  const duplicates: string[] = [];
  if (counts['main'] && counts['main'].count > 1) {
    duplicates.push('main');
  }

  const pass = missing.length === 0 && duplicates.length === 0;

  sendProgress?.({
    agent: 'landmark-checker',
    status: 'complete',
    message: `Found ${found.length} landmark types, ${missing.length} missing, ${duplicates.length} duplicated`,
    progress: 35,
  });

  return { found, missing, duplicates, pass };
}

// ---------------------------------------------------------------------------
// 5. analyzeLinks
// ---------------------------------------------------------------------------

export async function analyzeLinks(
  page: Page,
  sendProgress?: SendProgressCallback,
): Promise<LinkAnalysisResult> {
  sendProgress?.({
    agent: 'link-analyzer',
    status: 'working',
    message: 'Analyzing link accessibility...',
    progress: 40,
  });

  const rawLinks: Array<{ text: string; href: string; ariaLabel: string; hasImageChild: boolean; imageAlt: string }> =
    await page.$$eval('a', (anchors) =>
      anchors.map((a) => {
        const img = a.querySelector('img');
        return {
          text: (a.textContent ?? '').trim(),
          href: a.getAttribute('href') ?? '',
          ariaLabel: a.getAttribute('aria-label') ?? '',
          hasImageChild: !!img,
          imageAlt: img?.getAttribute('alt') ?? '',
        };
      }),
    );

  const links: LinkEntry[] = [];
  let problematicLinks = 0;

  // Track link text -> hrefs for duplicate detection
  const textToHrefs: Map<string, Set<string>> = new Map();

  for (const raw of rawLinks) {
    const issues: string[] = [];
    const effectiveText = raw.ariaLabel || raw.text;

    // Empty text link
    if (!effectiveText && !raw.hasImageChild) {
      issues.push('Link has no accessible text');
    }

    // Image-only link without alt text
    if (raw.hasImageChild && !raw.imageAlt && !raw.ariaLabel && !raw.text) {
      issues.push('Link contains only an image with no alt text or aria-label');
    }

    // Vague link text
    if (effectiveText && VAGUE_LINK_TEXT.test(effectiveText)) {
      issues.push(`Vague link text "${effectiveText}" — use descriptive text that explains the destination`);
    }

    // Track for duplicate detection
    if (effectiveText) {
      const normalized = effectiveText.toLowerCase();
      if (!textToHrefs.has(normalized)) {
        textToHrefs.set(normalized, new Set());
      }
      textToHrefs.get(normalized)!.add(raw.href);
    }

    if (issues.length > 0) {
      problematicLinks++;
    }

    links.push({
      text: effectiveText || '(empty)',
      href: raw.href,
      issues,
    });
  }

  // Flag duplicate link text pointing to different URLs
  for (const [text, hrefs] of textToHrefs) {
    if (hrefs.size > 1) {
      for (const link of links) {
        if (link.text.toLowerCase() === text) {
          const dupIssue = `Duplicate link text "${text}" points to ${hrefs.size} different URLs`;
          if (!link.issues.includes(dupIssue)) {
            link.issues.push(dupIssue);
            if (link.issues.length === 1) {
              problematicLinks++;
            }
          }
        }
      }
    }
  }

  sendProgress?.({
    agent: 'link-analyzer',
    status: 'complete',
    message: `Analyzed ${links.length} links, ${problematicLinks} with issues`,
    progress: 50,
  });

  return {
    links,
    totalLinks: links.length,
    problematicLinks,
    pass: problematicLinks === 0,
  };
}

// ---------------------------------------------------------------------------
// 6. testFocusOrder
// ---------------------------------------------------------------------------

export async function testFocusOrder(
  page: Page,
  sendProgress?: SendProgressCallback,
): Promise<FocusOrderResult> {
  sendProgress?.({
    agent: 'focus-tester',
    status: 'working',
    message: 'Testing keyboard focus order...',
    progress: 55,
  });

  const MAX_TABS = 100;
  const sequence: FocusSequenceEntry[] = [];
  const issues: FocusIssue[] = [];

  // Reset focus to the document body first
  await page.evaluate(() => {
    (document.activeElement as HTMLElement)?.blur?.();
    document.body.focus();
  });

  let consecutiveSameElement = 0;
  let lastElementDesc = '';

  for (let i = 0; i < MAX_TABS; i++) {
    await page.keyboard.press('Tab');

    const info = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el || el === document.body) {
        return null;
      }
      const rect = el.getBoundingClientRect();
      return {
        tag: el.tagName.toLowerCase(),
        role: el.getAttribute('role') ?? '',
        name:
          el.getAttribute('aria-label') ??
          (el as HTMLElement).innerText?.substring(0, 80) ??
          '',
        ariaLabel: el.getAttribute('aria-label') ?? '',
        x: Math.round(rect.x),
        y: Math.round(rect.y),
      };
    });

    if (!info) {
      // Focus cycled back to body — end of tab order
      break;
    }

    const elementDesc = `${info.tag}:${info.role}:${info.name}:${info.x}:${info.y}`;

    // Detect focus trap (same element 3+ times in a row)
    if (elementDesc === lastElementDesc) {
      consecutiveSameElement++;
      if (consecutiveSameElement >= 3) {
        issues.push({
          type: 'focus-trap',
          message: `Potential focus trap: focus stuck on <${info.tag}> "${info.name}" for ${consecutiveSameElement + 1} consecutive tabs`,
          element: `<${info.tag}> "${info.name}"`,
        });
        break; // Stop — we're trapped
      }
    } else {
      consecutiveSameElement = 0;
    }
    lastElementDesc = elementDesc;

    sequence.push({
      index: i,
      tag: info.tag,
      role: info.role,
      name: info.name.substring(0, 80),
      x: info.x,
      y: info.y,
    });
  }

  // Detect visual backwards movement
  // Focus should generally move top-to-bottom, left-to-right
  for (let i = 1; i < sequence.length; i++) {
    const prev = sequence[i - 1];
    const curr = sequence[i];

    // Significant backwards vertical movement (more than 50px jump upward)
    // while not being a minor horizontal shift
    if (curr.y < prev.y - 50 && Math.abs(curr.x - prev.x) < 200) {
      issues.push({
        type: 'backwards-focus',
        message: `Focus moves visually backwards at step ${i}: from (${prev.x}, ${prev.y}) to (${curr.x}, ${curr.y}). Element <${curr.tag}> "${curr.name}" appears above the previously focused element.`,
        element: `<${curr.tag}> "${curr.name}"`,
      });
    }
  }

  // Check for interactive elements that never received focus
  const focusedTags = new Set(sequence.map((s) => `${s.tag}:${s.x}:${s.y}`));
  const allInteractive: Array<{ tag: string; name: string; x: number; y: number }> = await page.$$eval(
    FOCUSABLE_SELECTOR,
    (els) =>
      els
        .filter((el) => {
          const style = window.getComputedStyle(el);
          return style.display !== 'none' && style.visibility !== 'hidden';
        })
        .map((el) => {
          const rect = el.getBoundingClientRect();
          return {
            tag: el.tagName.toLowerCase(),
            name:
              el.getAttribute('aria-label') ??
              (el as HTMLElement).innerText?.substring(0, 80) ??
              '',
            x: Math.round(rect.x),
            y: Math.round(rect.y),
          };
        }),
  );

  // Only flag visible, on-screen interactive elements that were never focused
  for (const el of allInteractive) {
    if (el.x >= 0 && el.y >= 0 && el.x < 5000 && el.y < 5000) {
      const key = `${el.tag}:${el.x}:${el.y}`;
      if (!focusedTags.has(key) && sequence.length > 0) {
        issues.push({
          type: 'unreachable-element',
          message: `Interactive <${el.tag}> "${el.name}" at (${el.x}, ${el.y}) was not reached during keyboard navigation`,
          element: `<${el.tag}> "${el.name}"`,
        });
      }
    }
  }

  sendProgress?.({
    agent: 'focus-tester',
    status: 'complete',
    message: `Tested ${sequence.length} focus stops, ${issues.length} issue(s)`,
    progress: 65,
  });

  return {
    sequence,
    issues,
    pass: issues.length === 0,
  };
}

// ---------------------------------------------------------------------------
// 7. validateARIA
// ---------------------------------------------------------------------------

export async function validateARIA(
  page: Page,
  sendProgress?: SendProgressCallback,
): Promise<ARIAValidationResult> {
  sendProgress?.({
    agent: 'aria-validator',
    status: 'working',
    message: 'Validating ARIA usage...',
    progress: 70,
  });

  const rawElements: Array<{
    selector: string;
    tagName: string;
    role: string;
    ariaAttrs: Record<string, string>;
    isFocusable: boolean;
    hasTabindex: boolean;
    childRoles: string[];
    allIds: string[];
  }> = await page.$$eval('[role], [aria-hidden], [aria-label], [aria-labelledby], [aria-describedby], [aria-expanded], [aria-checked], [aria-required], [aria-disabled], [aria-selected], [aria-haspopup], [aria-controls], [aria-owns]', (els) => {
    // Collect all IDs on the page for reference checking
    const allIds = Array.from(document.querySelectorAll('[id]')).map((e) => e.id);

    return els.map((el, idx) => {
      const attrs: Record<string, string> = {};
      for (const attr of Array.from(el.attributes)) {
        if (attr.name === 'role' || attr.name.startsWith('aria-')) {
          attrs[attr.name] = attr.value;
        }
      }

      // Get child roles (for required children checks)
      const childRoles = Array.from(el.children).map(
        (c) => c.getAttribute('role') ?? '',
      ).filter(Boolean);

      // Determine focusability
      const focusableTags = ['A', 'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA'];
      const isFocusable = focusableTags.includes(el.tagName) || el.hasAttribute('tabindex');
      const hasTabindex = el.hasAttribute('tabindex');

      // Build a unique-ish selector
      const id = el.id ? `#${el.id}` : '';
      const cls = el.className && typeof el.className === 'string'
        ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.')
        : '';
      const selector = id || `${el.tagName.toLowerCase()}${cls}` || `[role="${attrs['role']}"][${idx}]`;

      return {
        selector,
        tagName: el.tagName.toLowerCase(),
        role: attrs['role'] ?? '',
        ariaAttrs: attrs,
        isFocusable,
        hasTabindex,
        childRoles,
        allIds,
      };
    });
  });

  // Collect page IDs once (from first element, they all have the same set)
  const pageIds = new Set(rawElements.length > 0 ? rawElements[0].allIds : []);

  const elements: ARIAElementEntry[] = [];
  let issueCount = 0;

  for (const raw of rawElements) {
    const elIssues: string[] = [];

    // Invalid role value
    if (raw.role && !VALID_ARIA_ROLES.has(raw.role)) {
      elIssues.push(`Invalid ARIA role "${raw.role}" — not a recognized WAI-ARIA role`);
    }

    // aria-hidden="true" on focusable element
    if (raw.ariaAttrs['aria-hidden'] === 'true' && raw.isFocusable) {
      elIssues.push('aria-hidden="true" on a focusable element — screen reader users can still focus it but it will be invisible to them');
    }

    // role="button" on non-button without tabindex
    if (raw.role === 'button' && raw.tagName !== 'button' && !raw.hasTabindex) {
      elIssues.push('Element has role="button" but is not a <button> and lacks tabindex — it cannot receive keyboard focus');
    }

    // Missing required ARIA children
    if (raw.role && REQUIRED_CHILDREN[raw.role]) {
      const requiredChildRoles = REQUIRED_CHILDREN[raw.role];
      const hasRequired = raw.childRoles.some((cr) => requiredChildRoles.includes(cr));
      if (!hasRequired && raw.childRoles.length > 0) {
        elIssues.push(
          `role="${raw.role}" requires child with role="${requiredChildRoles.join('" or "')}" but none found among direct children`,
        );
      }
    }

    // aria-labelledby pointing to non-existent ID
    if (raw.ariaAttrs['aria-labelledby']) {
      const ids = raw.ariaAttrs['aria-labelledby'].split(/\s+/);
      for (const id of ids) {
        if (id && !pageIds.has(id)) {
          elIssues.push(`aria-labelledby references ID "${id}" which does not exist in the document`);
        }
      }
    }

    // aria-describedby pointing to non-existent ID
    if (raw.ariaAttrs['aria-describedby']) {
      const ids = raw.ariaAttrs['aria-describedby'].split(/\s+/);
      for (const id of ids) {
        if (id && !pageIds.has(id)) {
          elIssues.push(`aria-describedby references ID "${id}" which does not exist in the document`);
        }
      }
    }

    issueCount += elIssues.length;

    elements.push({
      selector: raw.selector,
      role: raw.role,
      ariaAttrs: raw.ariaAttrs,
      issues: elIssues,
    });
  }

  sendProgress?.({
    agent: 'aria-validator',
    status: 'complete',
    message: `Validated ${elements.length} ARIA elements, ${issueCount} issue(s)`,
    progress: 78,
  });

  return {
    elements,
    totalARIAElements: elements.length,
    issueCount,
    pass: issueCount === 0,
  };
}

// ---------------------------------------------------------------------------
// 8. validateReadingOrder
// ---------------------------------------------------------------------------

export async function validateReadingOrder(
  page: Page,
  sendProgress?: SendProgressCallback,
): Promise<ReadingOrderResult> {
  sendProgress?.({
    agent: 'reading-order',
    status: 'working',
    message: 'Validating reading order vs visual order...',
    progress: 82,
  });

  const domElements: Array<{ text: string; domIndex: number; x: number; y: number; tag: string }> =
    await page.evaluate(() => {
      const textTags = [
        'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'P', 'LI', 'TD', 'TH',
        'LABEL', 'SPAN', 'A', 'BUTTON', 'CAPTION', 'FIGCAPTION', 'BLOCKQUOTE',
        'DT', 'DD', 'LEGEND', 'SUMMARY',
      ];

      const elements: Array<{ text: string; domIndex: number; x: number; y: number; tag: string }> = [];
      const allEls = document.querySelectorAll(textTags.join(', '));
      let idx = 0;

      allEls.forEach((el) => {
        const htmlEl = el as HTMLElement;
        const text = (htmlEl.innerText ?? '').trim();
        if (!text) return;

        const style = window.getComputedStyle(htmlEl);
        if (style.display === 'none' || style.visibility === 'hidden') return;

        const rect = htmlEl.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return;

        elements.push({
          text: text.substring(0, 60),
          domIndex: idx++,
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          tag: htmlEl.tagName.toLowerCase(),
        });
      });

      return elements;
    });

  // Build visual order: sort by y first (with tolerance band), then x
  const ROW_TOLERANCE = 20; // Elements within 20px vertically are considered "same row"
  const visuallySorted = [...domElements].sort((a, b) => {
    const rowDiff = Math.abs(a.y - b.y);
    if (rowDiff <= ROW_TOLERANCE) {
      return a.x - b.x; // Same visual row, sort left to right
    }
    return a.y - b.y; // Different rows, sort top to bottom
  });

  // Assign visual position index
  const visualPositionMap = new Map<number, number>();
  visuallySorted.forEach((el, visualIdx) => {
    visualPositionMap.set(el.domIndex, visualIdx);
  });

  // Find elements where DOM order significantly differs from visual order
  const outOfOrderElements: ReadingOrderElement[] = [];
  const THRESHOLD = 5; // Allow minor reordering (e.g., CSS flex order)

  for (const el of domElements) {
    const visualPos = visualPositionMap.get(el.domIndex)!;
    const posDiff = Math.abs(el.domIndex - visualPos);

    if (posDiff > THRESHOLD) {
      outOfOrderElements.push({
        element: `<${el.tag}> "${el.text}"`,
        domIndex: el.domIndex,
        visualPosition: { x: el.x, y: el.y },
      });
    }
  }

  sendProgress?.({
    agent: 'reading-order',
    status: 'complete',
    message: `Checked ${domElements.length} text elements, ${outOfOrderElements.length} out of order`,
    progress: 88,
  });

  return {
    outOfOrderElements,
    pass: outOfOrderElements.length === 0,
  };
}

// ---------------------------------------------------------------------------
// 9. generateScreenReaderTranscript
// ---------------------------------------------------------------------------

export async function generateScreenReaderTranscript(
  page: Page,
  sendProgress?: SendProgressCallback,
): Promise<ScreenReaderTranscript> {
  sendProgress?.({
    agent: 'transcript-generator',
    status: 'working',
    message: 'Generating screen reader transcript...',
    progress: 90,
  });

  const startTime = Date.now();

  // Get the tree for transcript walking
  const flatTree = await extractAccessibilityTree(page);

  // Determine landmark regions for context grouping
  const landmarkRoles = new Set([
    'main', 'navigation', 'banner', 'contentinfo', 'complementary',
    'search', 'form', 'region',
  ]);

  // Build a map: for each node, determine which landmark it belongs to
  // Walk from the snapshot to track parent landmarks
  const snapshot = await page.accessibility.snapshot();
  const nodeLandmarkMap = new Map<number, string>();
  let globalIdx = 0;

  function walkForLandmarks(node: any, currentLandmark: string): void {
    const thisLandmark = landmarkRoles.has(node.role)
      ? `${node.role}${node.name ? ': ' + node.name : ''}`
      : currentLandmark;

    nodeLandmarkMap.set(globalIdx++, thisLandmark);

    if (node.children) {
      for (const child of node.children) {
        walkForLandmarks(child, thisLandmark);
      }
    }
  }

  if (snapshot) {
    walkForLandmarks(snapshot, '(document root)');
  }

  // Generate transcript entries
  const entries: TranscriptEntry[] = [];

  for (const node of flatTree) {
    // Skip generic/none roles that screen readers typically skip
    if (node.role === 'none' || node.role === 'presentation' || node.role === 'generic') {
      continue;
    }

    // Skip nodes with no name and no meaningful role
    if (!node.name && !['separator', 'img'].includes(node.role)) {
      continue;
    }

    const announcement = computeAnnouncement(node);
    const landmark = nodeLandmarkMap.get(node.index) ?? '(unknown)';

    const nodeIssues: string[] = [];

    // Flag common issues in the transcript
    if (node.role === 'img' && !node.name) {
      nodeIssues.push('Image lacks alternative text');
    }
    if (node.role === 'link' && !node.name) {
      nodeIssues.push('Link has no accessible name');
    }
    if (node.role === 'button' && !node.name) {
      nodeIssues.push('Button has no accessible name');
    }
    if (node.role === 'textbox' && !node.name) {
      nodeIssues.push('Form input has no accessible label');
    }

    entries.push({
      index: entries.length,
      announcement,
      role: node.role,
      name: node.name,
      landmark,
      depth: node.depth,
      issues: nodeIssues,
    });
  }

  const duration = Date.now() - startTime;

  sendProgress?.({
    agent: 'transcript-generator',
    status: 'complete',
    message: `Generated transcript with ${entries.length} announcements in ${duration}ms`,
    progress: 95,
  });

  return {
    entries,
    totalElements: flatTree.length,
    duration,
  };
}

// ---------------------------------------------------------------------------
// 10. runScreenReaderSimulation — ORCHESTRATOR
// ---------------------------------------------------------------------------

export async function runScreenReaderSimulation(
  page: Page,
  sendProgress?: SendProgressCallback,
): Promise<ScreenReaderSimulationResult> {
  const startTime = Date.now();

  sendProgress?.({
    agent: 'screen-reader',
    status: 'working',
    message: 'Starting screen reader simulation...',
    progress: 0,
  });

  // ── Step 1: Accessibility Tree ────────────────────────────────────────
  let accessibilityTree: AccessibilityNode[] = [];
  try {
    accessibilityTree = await extractAccessibilityTree(page, sendProgress);
  } catch (err) {
    console.error('[ScreenReader] Failed to extract accessibility tree:', err);
    sendProgress?.({
      agent: 'screen-reader',
      status: 'error',
      message: `Accessibility tree extraction failed: ${err instanceof Error ? err.message : String(err)}`,
      progress: 10,
    });
  }

  await delay(400);

  // ── Step 2: Heading Hierarchy ─────────────────────────────────────────
  let headingHierarchy: HeadingHierarchyResult = { headings: [], issues: [], pass: true };
  try {
    headingHierarchy = await validateHeadingHierarchy(page, sendProgress);
  } catch (err) {
    console.error('[ScreenReader] Heading hierarchy validation failed:', err);
    headingHierarchy = {
      headings: [],
      issues: [{ type: 'missing-h1', message: `Validation error: ${err instanceof Error ? err.message : String(err)}` }],
      pass: false,
    };
    sendProgress?.({
      agent: 'heading-checker',
      status: 'error',
      message: `Heading validation failed: ${err instanceof Error ? err.message : String(err)}`,
      progress: 25,
    });
  }

  await delay(300);

  // ── Step 3: Landmark Structure ────────────────────────────────────────
  let landmarks: LandmarkResult = { found: [], missing: [], duplicates: [], pass: true };
  try {
    landmarks = await validateLandmarkStructure(page, sendProgress);
  } catch (err) {
    console.error('[ScreenReader] Landmark validation failed:', err);
    landmarks = { found: [], missing: ['main'], duplicates: [], pass: false };
    sendProgress?.({
      agent: 'landmark-checker',
      status: 'error',
      message: `Landmark validation failed: ${err instanceof Error ? err.message : String(err)}`,
      progress: 35,
    });
  }

  await delay(300);

  // ── Step 4: Link Analysis ─────────────────────────────────────────────
  let links: LinkAnalysisResult = { links: [], totalLinks: 0, problematicLinks: 0, pass: true };
  try {
    links = await analyzeLinks(page, sendProgress);
  } catch (err) {
    console.error('[ScreenReader] Link analysis failed:', err);
    links = { links: [], totalLinks: 0, problematicLinks: 0, pass: false };
    sendProgress?.({
      agent: 'link-analyzer',
      status: 'error',
      message: `Link analysis failed: ${err instanceof Error ? err.message : String(err)}`,
      progress: 50,
    });
  }

  await delay(400);

  // ── Step 5: Focus Order ───────────────────────────────────────────────
  let focusOrder: FocusOrderResult = { sequence: [], issues: [], pass: true };
  try {
    focusOrder = await testFocusOrder(page, sendProgress);
  } catch (err) {
    console.error('[ScreenReader] Focus order test failed:', err);
    focusOrder = { sequence: [], issues: [{ type: 'focus-trap', message: `Test failed: ${err instanceof Error ? err.message : String(err)}` }], pass: false };
    sendProgress?.({
      agent: 'focus-tester',
      status: 'error',
      message: `Focus order test failed: ${err instanceof Error ? err.message : String(err)}`,
      progress: 65,
    });
  }

  await delay(300);

  // ── Step 6: ARIA Validation ───────────────────────────────────────────
  let ariaValidation: ARIAValidationResult = { elements: [], totalARIAElements: 0, issueCount: 0, pass: true };
  try {
    ariaValidation = await validateARIA(page, sendProgress);
  } catch (err) {
    console.error('[ScreenReader] ARIA validation failed:', err);
    ariaValidation = { elements: [], totalARIAElements: 0, issueCount: 0, pass: false };
    sendProgress?.({
      agent: 'aria-validator',
      status: 'error',
      message: `ARIA validation failed: ${err instanceof Error ? err.message : String(err)}`,
      progress: 78,
    });
  }

  await delay(300);

  // ── Step 7: Reading Order ─────────────────────────────────────────────
  let readingOrder: ReadingOrderResult = { outOfOrderElements: [], pass: true };
  try {
    readingOrder = await validateReadingOrder(page, sendProgress);
  } catch (err) {
    console.error('[ScreenReader] Reading order validation failed:', err);
    readingOrder = { outOfOrderElements: [], pass: false };
    sendProgress?.({
      agent: 'reading-order',
      status: 'error',
      message: `Reading order validation failed: ${err instanceof Error ? err.message : String(err)}`,
      progress: 88,
    });
  }

  await delay(400);

  // ── Step 8: Screen Reader Transcript ──────────────────────────────────
  let transcript: ScreenReaderTranscript = { entries: [], totalElements: 0, duration: 0 };
  try {
    transcript = await generateScreenReaderTranscript(page, sendProgress);
  } catch (err) {
    console.error('[ScreenReader] Transcript generation failed:', err);
    transcript = { entries: [], totalElements: 0, duration: 0 };
    sendProgress?.({
      agent: 'transcript-generator',
      status: 'error',
      message: `Transcript generation failed: ${err instanceof Error ? err.message : String(err)}`,
      progress: 95,
    });
  }

  // ── Scoring ───────────────────────────────────────────────────────────

  let score = 100;
  let totalIssues = 0;

  // Heading issues: -3 each (structural)
  score -= headingHierarchy.issues.length * 3;
  totalIssues += headingHierarchy.issues.length;

  // Missing landmarks: -5 each (navigation)
  score -= landmarks.missing.length * 5;
  totalIssues += landmarks.missing.length;

  // Duplicate landmarks: -3 each
  score -= landmarks.duplicates.length * 3;
  totalIssues += landmarks.duplicates.length;

  // Problematic links: -2 each (usability)
  score -= links.problematicLinks * 2;
  totalIssues += links.problematicLinks;

  // Focus order issues: -5 each (critical for keyboard users)
  score -= focusOrder.issues.length * 5;
  totalIssues += focusOrder.issues.length;

  // ARIA issues: -3 each (semantic)
  score -= ariaValidation.issueCount * 3;
  totalIssues += ariaValidation.issueCount;

  // Reading order out-of-order elements: -2 each
  score -= readingOrder.outOfOrderElements.length * 2;
  totalIssues += readingOrder.outOfOrderElements.length;

  // Transcript issues (unlabeled elements): -1 each
  const transcriptIssueCount = transcript.entries.reduce((sum, e) => sum + e.issues.length, 0);
  score -= transcriptIssueCount;
  totalIssues += transcriptIssueCount;

  // Clamp score to 0-100
  score = Math.max(0, Math.min(100, score));

  // Build summary
  const passedChecks: string[] = [];
  const failedChecks: string[] = [];

  if (headingHierarchy.pass) passedChecks.push('Heading Hierarchy');
  else failedChecks.push('Heading Hierarchy');

  if (landmarks.pass) passedChecks.push('Landmarks');
  else failedChecks.push('Landmarks');

  if (links.pass) passedChecks.push('Link Accessibility');
  else failedChecks.push('Link Accessibility');

  if (focusOrder.pass) passedChecks.push('Focus Order');
  else failedChecks.push('Focus Order');

  if (ariaValidation.pass) passedChecks.push('ARIA Validation');
  else failedChecks.push('ARIA Validation');

  if (readingOrder.pass) passedChecks.push('Reading Order');
  else failedChecks.push('Reading Order');

  const elapsed = Date.now() - startTime;
  const summary =
    `Screen reader simulation completed in ${elapsed}ms. ` +
    `Score: ${score}/100. ` +
    `${totalIssues} issue(s) found across ${6 - passedChecks.length} failing check(s). ` +
    (passedChecks.length > 0 ? `Passed: ${passedChecks.join(', ')}. ` : '') +
    (failedChecks.length > 0 ? `Failed: ${failedChecks.join(', ')}.` : 'All checks passed.');

  sendProgress?.({
    agent: 'screen-reader',
    status: 'complete',
    message: summary,
    progress: 100,
    details: `Score: ${score}/100 | ${totalIssues} issues | ${elapsed}ms`,
  });

  return {
    accessibilityTree,
    headingHierarchy,
    landmarks,
    links,
    focusOrder,
    ariaValidation,
    readingOrder,
    transcript,
    overallScore: score,
    totalIssues,
    summary,
  };
}
