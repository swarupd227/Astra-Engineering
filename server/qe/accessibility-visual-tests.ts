import { Page, Browser, BrowserContext } from 'playwright';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface VisualTestResult {
  testId: string;
  testName: string;
  wcagCriterion: string;
  status: 'pass' | 'fail' | 'warning';
  score: number; // 0-100
  issues: {
    element: string;
    description: string;
    severity: 'critical' | 'serious' | 'moderate' | 'minor';
  }[];
  screenshotBase64?: string;
  duration: number;
}

export interface VisualAccessibilityResult {
  tests: VisualTestResult[];
  overallScore: number;
  passCount: number;
  failCount: number;
  warningCount: number;
  totalDuration: number;
}

export interface ProgressEvent {
  agent: string;
  status: 'working' | 'done' | 'error';
  message: string;
  progress?: number;
  details?: string;
}

type SendProgress = (event: ProgressEvent) => void;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function takeScreenshotBase64(page: Page): Promise<string> {
  const buffer = await page.screenshot({ type: 'jpeg', quality: 60 });
  return buffer.toString('base64');
}

function scoreFromIssues(
  issues: VisualTestResult['issues'],
  weights: Record<string, number> = {
    critical: 25,
    serious: 15,
    moderate: 8,
    minor: 3,
  },
): number {
  let deductions = 0;
  for (const issue of issues) {
    deductions += weights[issue.severity] ?? 5;
  }
  return Math.max(0, 100 - deductions);
}

function statusFromScore(score: number): 'pass' | 'fail' | 'warning' {
  if (score >= 90) return 'pass';
  if (score >= 60) return 'warning';
  return 'fail';
}

function truncateSelector(selector: string, max = 120): string {
  if (selector.length <= max) return selector;
  return selector.slice(0, max) + '...';
}

// ---------------------------------------------------------------------------
// 1. High Contrast Mode — WCAG 1.4.11
// ---------------------------------------------------------------------------

export async function testHighContrastMode(page: Page): Promise<VisualTestResult> {
  const start = Date.now();
  const issues: VisualTestResult['issues'] = [];

  // Count interactive elements visible before emulation
  const beforeCount = await page.evaluate(() => {
    const interactiveSelectors =
      'a[href], button, input, select, textarea, [role="button"], [role="link"], [tabindex]';
    const elements = document.querySelectorAll(interactiveSelectors);
    let visible = 0;
    elements.forEach((el) => {
      const rect = (el as HTMLElement).getBoundingClientRect();
      const style = window.getComputedStyle(el);
      if (
        rect.width > 0 &&
        rect.height > 0 &&
        style.display !== 'none' &&
        style.visibility !== 'hidden'
      ) {
        visible++;
      }
    });
    return visible;
  });

  // Enable forced-colors (High Contrast) emulation
  await page.emulateMedia({ forcedColors: 'active' });
  await delay(300);

  const screenshotBase64 = await takeScreenshotBase64(page);

  // Count interactive elements visible after emulation
  const afterCount = await page.evaluate(() => {
    const interactiveSelectors =
      'a[href], button, input, select, textarea, [role="button"], [role="link"], [tabindex]';
    const elements = document.querySelectorAll(interactiveSelectors);
    let visible = 0;
    elements.forEach((el) => {
      const rect = (el as HTMLElement).getBoundingClientRect();
      const style = window.getComputedStyle(el);
      if (
        rect.width > 0 &&
        rect.height > 0 &&
        style.display !== 'none' &&
        style.visibility !== 'hidden'
      ) {
        visible++;
      }
    });
    return visible;
  });

  const disappeared = beforeCount - afterCount;
  if (disappeared > 0) {
    issues.push({
      element: `${disappeared} interactive element(s)`,
      description: `${disappeared} of ${beforeCount} interactive elements disappeared in High Contrast mode — they likely rely on background images or CSS that is overridden by forced-colors.`,
      severity: 'critical',
    });
  }

  // Check for images used as sole content inside buttons/links (decorative that become invisible)
  const imgOnlyControls = await page.evaluate(() => {
    const controls = document.querySelectorAll('a[href], button, [role="button"]');
    const problems: string[] = [];
    controls.forEach((el) => {
      const text = (el as HTMLElement).innerText?.trim();
      const img = el.querySelector('img');
      const svg = el.querySelector('svg');
      if (!text && (img || svg)) {
        const id = (el as HTMLElement).id || (el as HTMLElement).className?.split(' ')[0] || el.tagName;
        problems.push(id);
      }
    });
    return problems;
  });

  for (const ctrl of imgOnlyControls) {
    issues.push({
      element: truncateSelector(ctrl),
      description:
        'Interactive element contains only an image/SVG with no visible text — content may vanish in forced-colors mode.',
      severity: 'serious',
    });
  }

  // Reset emulation
  await page.emulateMedia({ forcedColors: null as any });

  const score = scoreFromIssues(issues);
  return {
    testId: 'high-contrast',
    testName: 'High Contrast Mode',
    wcagCriterion: '1.4.11',
    status: statusFromScore(score),
    score,
    issues,
    screenshotBase64,
    duration: Date.now() - start,
  };
}

// ---------------------------------------------------------------------------
// 2. Dark Mode — WCAG 1.4.3
// ---------------------------------------------------------------------------

export async function testDarkMode(page: Page): Promise<VisualTestResult> {
  const start = Date.now();
  const issues: VisualTestResult['issues'] = [];

  await page.emulateMedia({ colorScheme: 'dark' });
  await delay(300);

  const screenshotBase64 = await takeScreenshotBase64(page);

  // Scan for hardcoded colors that do not respond to dark mode
  const hardcodedColorResults = await page.evaluate(() => {
    const hardcodedIssues: { selector: string; property: string; value: string }[] = [];
    const textElements = document.querySelectorAll(
      'p, span, h1, h2, h3, h4, h5, h6, a, li, td, th, label, div, section',
    );

    textElements.forEach((el) => {
      const style = window.getComputedStyle(el);
      const color = style.color;
      const bgColor = style.backgroundColor;

      // Check for near-black text on dark backgrounds (low contrast in dark mode)
      // Parse rgb values
      const parseRgb = (c: string): [number, number, number] | null => {
        const match = c.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
        if (!match) return null;
        return [parseInt(match[1]), parseInt(match[2]), parseInt(match[3])];
      };

      const textRgb = parseRgb(color);
      const bgRgb = parseRgb(bgColor);

      if (textRgb && bgRgb) {
        // Relative luminance calculation (simplified)
        const luminance = (rgb: [number, number, number]) => {
          const [r, g, b] = rgb.map((v) => {
            const s = v / 255;
            return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
          });
          return 0.2126 * r + 0.7152 * g + 0.0722 * b;
        };

        const l1 = luminance(textRgb);
        const l2 = luminance(bgRgb);
        const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);

        // WCAG AA requires 4.5:1 for normal text
        if (ratio < 3.0) {
          const id =
            (el as HTMLElement).id ||
            (el as HTMLElement).className?.toString().split(' ')[0] ||
            el.tagName.toLowerCase();
          const text = (el as HTMLElement).innerText?.trim().slice(0, 40);
          hardcodedIssues.push({
            selector: text ? `${id} ("${text}")` : id,
            property: 'color-contrast',
            value: `ratio ${ratio.toFixed(2)}:1 (text: ${color}, bg: ${bgColor})`,
          });
        }
      }
    });

    // Deduplicate — keep first 20
    const seen = new Set<string>();
    return hardcodedIssues.filter((i) => {
      const key = i.selector + i.value;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).slice(0, 20);
  });

  for (const item of hardcodedColorResults) {
    issues.push({
      element: truncateSelector(item.selector),
      description: `Low contrast in dark mode: ${item.value}`,
      severity: 'serious',
    });
  }

  // Reset emulation
  await page.emulateMedia({ colorScheme: null as any });

  const score = scoreFromIssues(issues);
  return {
    testId: 'dark-mode',
    testName: 'Dark Mode',
    wcagCriterion: '1.4.3',
    status: statusFromScore(score),
    score,
    issues,
    screenshotBase64,
    duration: Date.now() - start,
  };
}

// ---------------------------------------------------------------------------
// 3. Text Spacing — WCAG 1.4.12
// ---------------------------------------------------------------------------

export async function testTextSpacing(page: Page): Promise<VisualTestResult> {
  const start = Date.now();
  const issues: VisualTestResult['issues'] = [];

  // Inject WCAG 1.4.12 text-spacing overrides
  await page.addStyleTag({
    content: `
      * {
        line-height: 1.5 !important;
        letter-spacing: 0.12em !important;
        word-spacing: 0.16em !important;
      }
      p {
        margin-bottom: 2em !important;
      }
    `,
  });
  await delay(300);

  const screenshotBase64 = await takeScreenshotBase64(page);

  // Detect elements where content is clipped after spacing changes
  const clippedElements = await page.evaluate(() => {
    const clipped: { selector: string; scrollH: number; clientH: number }[] = [];
    const candidates = document.querySelectorAll(
      'div, section, article, main, aside, nav, p, span, li, td, th, label, a, button, h1, h2, h3, h4, h5, h6',
    );

    candidates.forEach((el) => {
      const htmlEl = el as HTMLElement;
      const style = window.getComputedStyle(el);
      const overflowY = style.overflowY;
      const overflowX = style.overflowX;

      // Elements with overflow: hidden that clip text are the main concern
      if (overflowY === 'hidden' || overflowX === 'hidden') {
        if (htmlEl.scrollHeight > htmlEl.clientHeight + 2 || htmlEl.scrollWidth > htmlEl.clientWidth + 2) {
          const id =
            htmlEl.id ||
            htmlEl.className?.toString().split(' ')[0] ||
            htmlEl.tagName.toLowerCase();
          const text = htmlEl.innerText?.trim().slice(0, 40);
          clipped.push({
            selector: text ? `${id} ("${text}")` : id,
            scrollH: htmlEl.scrollHeight,
            clientH: htmlEl.clientHeight,
          });
        }
      }
    });

    // Deduplicate, keep first 15
    const seen = new Set<string>();
    return clipped
      .filter((c) => {
        if (seen.has(c.selector)) return false;
        seen.add(c.selector);
        return true;
      })
      .slice(0, 15);
  });

  for (const el of clippedElements) {
    issues.push({
      element: truncateSelector(el.selector),
      description: `Content clipped when text spacing is increased (scrollHeight ${el.scrollH}px > clientHeight ${el.clientH}px with overflow: hidden).`,
      severity: 'serious',
    });
  }

  const score = scoreFromIssues(issues);
  return {
    testId: 'text-spacing',
    testName: 'Text Spacing Override',
    wcagCriterion: '1.4.12',
    status: statusFromScore(score),
    score,
    issues,
    screenshotBase64,
    duration: Date.now() - start,
  };
}

// ---------------------------------------------------------------------------
// 4. Text Resize 200% — WCAG 1.4.4
// ---------------------------------------------------------------------------

export async function testTextResize200(page: Page): Promise<VisualTestResult> {
  const start = Date.now();
  const issues: VisualTestResult['issues'] = [];

  // Zoom text to 200%
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '200%';
  });
  await delay(400);

  const screenshotBase64 = await takeScreenshotBase64(page);

  // Check for horizontal scrollbar
  const hasHorizontalScroll = await page.evaluate(() => {
    return document.documentElement.scrollWidth > document.documentElement.clientWidth;
  });

  if (hasHorizontalScroll) {
    const scrollDiff = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    issues.push({
      element: 'document',
      description: `Horizontal scrollbar appeared at 200% text size (content overflows by ${scrollDiff}px).`,
      severity: 'serious',
    });
  }

  // Check for clipped content (overflow: hidden cutting off text)
  const clippedCount = await page.evaluate(() => {
    let count = 0;
    const elements = document.querySelectorAll('*');
    elements.forEach((el) => {
      const style = window.getComputedStyle(el);
      const htmlEl = el as HTMLElement;
      if (
        (style.overflow === 'hidden' || style.overflowY === 'hidden' || style.overflowX === 'hidden') &&
        (htmlEl.scrollHeight > htmlEl.clientHeight + 4 || htmlEl.scrollWidth > htmlEl.clientWidth + 4)
      ) {
        // Only count elements that contain meaningful text
        const text = htmlEl.innerText?.trim();
        if (text && text.length > 5) {
          count++;
        }
      }
    });
    return count;
  });

  if (clippedCount > 0) {
    issues.push({
      element: `${clippedCount} element(s)`,
      description: `${clippedCount} element(s) have text clipped by overflow: hidden at 200% zoom.`,
      severity: 'serious',
    });
  }

  // Check for overlapping text using bounding box intersection heuristic
  const overlappingPairs = await page.evaluate(() => {
    const textElements = document.querySelectorAll(
      'p, span, h1, h2, h3, h4, h5, h6, a, button, label, li, td, th',
    );
    const rects: { selector: string; rect: DOMRect }[] = [];

    textElements.forEach((el) => {
      const htmlEl = el as HTMLElement;
      const text = htmlEl.innerText?.trim();
      if (!text || text.length < 2) return;
      const rect = htmlEl.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      const id = htmlEl.id || htmlEl.className?.toString().split(' ')[0] || htmlEl.tagName.toLowerCase();
      rects.push({ selector: id, rect });
    });

    let overlaps = 0;
    for (let i = 0; i < rects.length && i < 200; i++) {
      for (let j = i + 1; j < rects.length && j < 200; j++) {
        const a = rects[i].rect;
        const b = rects[j].rect;
        // Check if rects overlap substantially (more than 30% of smaller element)
        const overlapX = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
        const overlapY = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
        const overlapArea = overlapX * overlapY;
        const smallerArea = Math.min(a.width * a.height, b.width * b.height);
        if (smallerArea > 0 && overlapArea / smallerArea > 0.3) {
          overlaps++;
        }
      }
    }
    return overlaps;
  });

  if (overlappingPairs > 0) {
    issues.push({
      element: `${overlappingPairs} pair(s)`,
      description: `${overlappingPairs} text element pair(s) overlap at 200% text size.`,
      severity: overlappingPairs > 5 ? 'critical' : 'moderate',
    });
  }

  // Reset
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '';
  });

  const score = scoreFromIssues(issues);
  return {
    testId: 'text-resize-200',
    testName: 'Text Resize 200%',
    wcagCriterion: '1.4.4',
    status: statusFromScore(score),
    score,
    issues,
    screenshotBase64,
    duration: Date.now() - start,
  };
}

// ---------------------------------------------------------------------------
// 5. Reduced Motion — WCAG 2.3.3
// ---------------------------------------------------------------------------

export async function testReducedMotion(page: Page): Promise<VisualTestResult> {
  const start = Date.now();
  const issues: VisualTestResult['issues'] = [];

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await delay(400);

  const screenshotBase64 = await takeScreenshotBase64(page);

  // Check for elements that still have non-zero animation/transition durations
  const animatingElements = await page.evaluate(() => {
    const results: { selector: string; property: string; value: string }[] = [];
    const elements = document.querySelectorAll('*');

    elements.forEach((el) => {
      const style = window.getComputedStyle(el);
      const htmlEl = el as HTMLElement;
      const id = htmlEl.id || htmlEl.className?.toString().split(' ')[0] || htmlEl.tagName.toLowerCase();

      // Check animation-duration
      const animDuration = style.animationDuration;
      if (animDuration && animDuration !== '0s' && animDuration !== '0ms') {
        const playState = style.animationPlayState;
        if (playState !== 'paused') {
          results.push({
            selector: id,
            property: 'animation-duration',
            value: `${animDuration} (play-state: ${playState})`,
          });
        }
      }

      // Check transition-duration (skip very short transitions like 0.01s as they are effectively instant)
      const transDuration = style.transitionDuration;
      if (transDuration && transDuration !== '0s' && transDuration !== '0ms') {
        const parsed = parseFloat(transDuration);
        if (parsed > 0.05) {
          results.push({
            selector: id,
            property: 'transition-duration',
            value: transDuration,
          });
        }
      }
    });

    // Deduplicate by selector + property, keep first 20
    const seen = new Set<string>();
    return results
      .filter((r) => {
        const key = `${r.selector}::${r.property}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, 20);
  });

  for (const item of animatingElements) {
    issues.push({
      element: truncateSelector(item.selector),
      description: `Element still has ${item.property}: ${item.value} even with prefers-reduced-motion: reduce.`,
      severity: item.property === 'animation-duration' ? 'serious' : 'moderate',
    });
  }

  // Reset
  await page.emulateMedia({ reducedMotion: null as any });

  const score = scoreFromIssues(issues);
  return {
    testId: 'reduced-motion',
    testName: 'Reduced Motion',
    wcagCriterion: '2.3.3',
    status: statusFromScore(score),
    score,
    issues,
    screenshotBase64,
    duration: Date.now() - start,
  };
}

// ---------------------------------------------------------------------------
// 6. Focus Indicator Visibility — WCAG 2.4.7
// ---------------------------------------------------------------------------

export async function testFocusIndicatorVisibility(page: Page): Promise<VisualTestResult> {
  const start = Date.now();
  const issues: VisualTestResult['issues'] = [];

  const screenshotBase64 = await takeScreenshotBase64(page);

  // Tab through interactive elements and check for focus indicators
  const focusResults = await page.evaluate(() => {
    const interactiveElements = document.querySelectorAll(
      'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"]), [role="button"], [role="link"]',
    );

    const results: {
      selector: string;
      hasFocusIndicator: boolean;
      details: string;
    }[] = [];

    const elementsToTest = Array.from(interactiveElements).slice(0, 30);

    for (const el of elementsToTest) {
      const htmlEl = el as HTMLElement;
      const rect = htmlEl.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;

      const style = window.getComputedStyle(htmlEl);
      if (style.display === 'none' || style.visibility === 'hidden') continue;

      // Capture unfocused state
      const unfocusedOutline = style.outline;
      const unfocusedOutlineWidth = style.outlineWidth;
      const unfocusedBorder = style.border;
      const unfocusedBoxShadow = style.boxShadow;

      // Focus the element
      htmlEl.focus();
      const focusedStyle = window.getComputedStyle(htmlEl);

      const focusedOutline = focusedStyle.outline;
      const focusedOutlineWidth = focusedStyle.outlineWidth;
      const focusedBorder = focusedStyle.border;
      const focusedBoxShadow = focusedStyle.boxShadow;

      // Check if there is any visible focus indicator
      const hasOutline =
        focusedOutlineWidth !== '0px' &&
        focusedStyle.outlineStyle !== 'none' &&
        focusedStyle.outlineColor !== 'transparent';

      const borderChanged = focusedBorder !== unfocusedBorder;
      const boxShadowAdded =
        focusedBoxShadow !== 'none' && focusedBoxShadow !== unfocusedBoxShadow;
      const outlineChanged = focusedOutline !== unfocusedOutline;

      const hasFocusIndicator = hasOutline || borderChanged || boxShadowAdded || outlineChanged;

      const id = htmlEl.id || htmlEl.className?.toString().split(' ')[0] || htmlEl.tagName.toLowerCase();
      const text = htmlEl.innerText?.trim().slice(0, 30) || htmlEl.getAttribute('aria-label') || '';
      const label = text ? `${id} ("${text}")` : id;

      results.push({
        selector: label,
        hasFocusIndicator,
        details: hasFocusIndicator
          ? `outline: ${focusedOutline}, box-shadow: ${focusedBoxShadow}`
          : 'No visible focus indicator detected',
      });

      // Blur before moving to next
      htmlEl.blur();
    }

    return results;
  });

  for (const result of focusResults) {
    if (!result.hasFocusIndicator) {
      issues.push({
        element: truncateSelector(result.selector),
        description: `${result.details}. Users navigating with keyboard cannot see which element is focused.`,
        severity: 'critical',
      });
    }
  }

  const score = scoreFromIssues(issues);
  return {
    testId: 'focus-indicator',
    testName: 'Focus Indicator Visibility',
    wcagCriterion: '2.4.7',
    status: statusFromScore(score),
    score,
    issues,
    screenshotBase64,
    duration: Date.now() - start,
  };
}

// ---------------------------------------------------------------------------
// 7. Touch Target Size — WCAG 2.5.8
// ---------------------------------------------------------------------------

export async function testTouchTargetSize(page: Page): Promise<VisualTestResult> {
  const start = Date.now();
  const issues: VisualTestResult['issues'] = [];

  const screenshotBase64 = await takeScreenshotBase64(page);

  const undersizedTargets = await page.evaluate(() => {
    const MIN_TARGET_SIZE = 44; // px — WCAG 2.5.8 minimum
    const interactive = document.querySelectorAll(
      'a[href], button, input:not([type="hidden"]), select, textarea, [role="button"], [role="link"], [role="checkbox"], [role="radio"], [role="tab"], [role="menuitem"], [tabindex]:not([tabindex="-1"])',
    );

    const undersized: {
      selector: string;
      width: number;
      height: number;
    }[] = [];

    interactive.forEach((el) => {
      const htmlEl = el as HTMLElement;
      const rect = htmlEl.getBoundingClientRect();
      const style = window.getComputedStyle(htmlEl);

      if (style.display === 'none' || style.visibility === 'hidden') return;
      if (rect.width === 0 || rect.height === 0) return;

      if (rect.width < MIN_TARGET_SIZE || rect.height < MIN_TARGET_SIZE) {
        const id = htmlEl.id || htmlEl.className?.toString().split(' ')[0] || htmlEl.tagName.toLowerCase();
        const text = htmlEl.innerText?.trim().slice(0, 30) || htmlEl.getAttribute('aria-label') || '';
        undersized.push({
          selector: text ? `${id} ("${text}")` : id,
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        });
      }
    });

    // Keep first 25
    return undersized.slice(0, 25);
  });

  for (const target of undersizedTargets) {
    const severity: 'critical' | 'serious' | 'moderate' | 'minor' =
      target.width < 24 || target.height < 24 ? 'critical' : 'moderate';
    issues.push({
      element: truncateSelector(target.selector),
      description: `Touch target is ${target.width}x${target.height}px (minimum 44x44px required).`,
      severity,
    });
  }

  const score = scoreFromIssues(issues);
  return {
    testId: 'touch-target-size',
    testName: 'Touch Target Size',
    wcagCriterion: '2.5.8',
    status: statusFromScore(score),
    score,
    issues,
    screenshotBase64,
    duration: Date.now() - start,
  };
}

// ---------------------------------------------------------------------------
// 8. Reflow at 320px — WCAG 1.4.10
// ---------------------------------------------------------------------------

export async function testReflow320(
  page: Page,
  url: string,
  browser: Browser,
): Promise<VisualTestResult> {
  const start = Date.now();
  const issues: VisualTestResult['issues'] = [];
  let screenshotBase64: string | undefined;

  let context: BrowserContext | null = null;
  try {
    context = await browser.newContext({
      viewport: { width: 320, height: 480 },
    });
    const narrowPage = await context.newPage();
    await narrowPage.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await delay(500);

    screenshotBase64 = await takeScreenshotBase64(narrowPage);

    // Check for horizontal scrollbar
    const scrollData = await narrowPage.evaluate(() => {
      const bodyScrollWidth = document.body.scrollWidth;
      const docScrollWidth = document.documentElement.scrollWidth;
      const viewportWidth = document.documentElement.clientWidth;
      return {
        bodyScrollWidth,
        docScrollWidth,
        viewportWidth,
        hasHorizontalScroll: Math.max(bodyScrollWidth, docScrollWidth) > viewportWidth + 2,
        overflow: Math.max(bodyScrollWidth, docScrollWidth) - viewportWidth,
      };
    });

    if (scrollData.hasHorizontalScroll) {
      issues.push({
        element: 'document',
        description: `Page requires horizontal scrolling at 320px width (content is ${scrollData.overflow}px wider than viewport).`,
        severity: 'critical',
      });
    }

    // Check for elements that overflow the viewport
    const overflowingElements = await narrowPage.evaluate(() => {
      const results: { selector: string; rightEdge: number }[] = [];
      const elements = document.querySelectorAll('*');
      const viewportWidth = document.documentElement.clientWidth;

      elements.forEach((el) => {
        const rect = (el as HTMLElement).getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return;
        if (rect.right > viewportWidth + 5) {
          const htmlEl = el as HTMLElement;
          const id = htmlEl.id || htmlEl.className?.toString().split(' ')[0] || htmlEl.tagName.toLowerCase();
          results.push({
            selector: id,
            rightEdge: Math.round(rect.right),
          });
        }
      });

      // Deduplicate, keep first 10
      const seen = new Set<string>();
      return results
        .filter((r) => {
          if (seen.has(r.selector)) return false;
          seen.add(r.selector);
          return true;
        })
        .slice(0, 10);
    });

    for (const el of overflowingElements) {
      issues.push({
        element: truncateSelector(el.selector),
        description: `Element extends to ${el.rightEdge}px (beyond 320px viewport), breaking reflow.`,
        severity: 'serious',
      });
    }

    await narrowPage.close();
  } catch (err: any) {
    issues.push({
      element: 'page',
      description: `Failed to test reflow: ${err.message || String(err)}`,
      severity: 'moderate',
    });
  } finally {
    if (context) {
      await context.close();
    }
  }

  const score = scoreFromIssues(issues);
  return {
    testId: 'reflow-320',
    testName: 'Reflow at 320px',
    wcagCriterion: '1.4.10',
    status: statusFromScore(score),
    score,
    issues,
    screenshotBase64,
    duration: Date.now() - start,
  };
}

// ---------------------------------------------------------------------------
// 9. Orientation — WCAG 1.3.4
// ---------------------------------------------------------------------------

export async function testOrientation(
  page: Page,
  url: string,
  browser: Browser,
): Promise<VisualTestResult> {
  const start = Date.now();
  const issues: VisualTestResult['issues'] = [];
  let screenshotBase64: string | undefined;

  let portraitContext: BrowserContext | null = null;
  let landscapeContext: BrowserContext | null = null;

  try {
    // Test portrait
    portraitContext = await browser.newContext({
      viewport: { width: 375, height: 812 },
    });
    const portraitPage = await portraitContext.newPage();
    await portraitPage.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await delay(400);

    const portraitScreenshot = await takeScreenshotBase64(portraitPage);
    screenshotBase64 = portraitScreenshot; // Use portrait as the primary screenshot

    // Check if page forces orientation via CSS or JS
    const portraitForced = await portraitPage.evaluate(() => {
      // Check for orientation lock via CSS
      const styleSheets = Array.from(document.styleSheets);
      let hasOrientationMedia = false;
      try {
        for (const sheet of styleSheets) {
          try {
            const rules = Array.from(sheet.cssRules || []);
            for (const rule of rules) {
              const ruleText = rule.cssText || '';
              if (
                ruleText.includes('orientation: portrait') &&
                ruleText.includes('display: none')
              ) {
                hasOrientationMedia = true;
              }
              if (
                ruleText.includes('orientation: landscape') &&
                ruleText.includes('display: none')
              ) {
                hasOrientationMedia = true;
              }
            }
          } catch {
            // Cross-origin stylesheet — skip
          }
        }
      } catch {
        // Ignore
      }

      // Check if body or root has a fixed width that prevents reorientation
      const bodyWidth = document.body.getBoundingClientRect().width;
      const viewportWidth = window.innerWidth;
      const hasFixedWidth = bodyWidth > viewportWidth + 20;

      return { hasOrientationMedia, hasFixedWidth, bodyWidth, viewportWidth };
    });

    // Test landscape
    landscapeContext = await browser.newContext({
      viewport: { width: 812, height: 375 },
    });
    const landscapePage = await landscapeContext.newPage();
    await landscapePage.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await delay(400);

    const landscapeData = await landscapePage.evaluate(() => {
      const bodyRect = document.body.getBoundingClientRect();
      const hasContent = document.body.innerText?.trim().length > 0;
      const hasHorizontalScroll =
        document.documentElement.scrollWidth > document.documentElement.clientWidth + 5;

      // Check for orientation-related messages
      const allText = document.body.innerText?.toLowerCase() || '';
      const hasOrientationMessage =
        allText.includes('rotate your device') ||
        allText.includes('portrait mode') ||
        allText.includes('landscape mode') ||
        allText.includes('rotate to');

      return {
        bodyWidth: bodyRect.width,
        bodyHeight: bodyRect.height,
        hasContent,
        hasHorizontalScroll,
        hasOrientationMessage,
      };
    });

    if (portraitForced.hasOrientationMedia) {
      issues.push({
        element: 'CSS media query',
        description:
          'Page uses CSS media queries that hide content based on orientation — may lock users to a single orientation.',
        severity: 'serious',
      });
    }

    if (landscapeData.hasOrientationMessage) {
      issues.push({
        element: 'page content',
        description:
          'Page displays a message asking users to rotate their device, potentially restricting orientation.',
        severity: 'critical',
      });
    }

    if (!landscapeData.hasContent) {
      issues.push({
        element: 'page',
        description: 'Page appears blank in landscape orientation — content may be orientation-locked.',
        severity: 'critical',
      });
    }

    if (landscapeData.hasHorizontalScroll) {
      issues.push({
        element: 'document',
        description:
          'Horizontal scrollbar appears in landscape mode — layout may not adapt to orientation changes.',
        severity: 'moderate',
      });
    }

    await portraitPage.close();
    await landscapePage.close();
  } catch (err: any) {
    issues.push({
      element: 'page',
      description: `Failed to test orientation: ${err.message || String(err)}`,
      severity: 'moderate',
    });
  } finally {
    if (portraitContext) await portraitContext.close();
    if (landscapeContext) await landscapeContext.close();
  }

  const score = scoreFromIssues(issues);
  return {
    testId: 'orientation',
    testName: 'Orientation Support',
    wcagCriterion: '1.3.4',
    status: statusFromScore(score),
    score,
    issues,
    screenshotBase64,
    duration: Date.now() - start,
  };
}

// ---------------------------------------------------------------------------
// 10. Orchestrator
// ---------------------------------------------------------------------------

export async function runVisualAccessibilityTests(
  page: Page,
  url: string,
  browser: Browser,
  sendProgress?: SendProgress,
): Promise<VisualAccessibilityResult> {
  const totalStart = Date.now();
  const tests: VisualTestResult[] = [];

  const notify = (message: string, progress: number) => {
    if (sendProgress) {
      sendProgress({
        agent: 'visual-tester',
        status: 'working',
        message,
        progress,
      });
    }
  };

  const testPlan: {
    label: string;
    progress: number;
    run: () => Promise<VisualTestResult>;
  }[] = [
    {
      label: 'Testing High Contrast Mode...',
      progress: 10,
      run: () => testHighContrastMode(page),
    },
    {
      label: 'Testing Dark Mode...',
      progress: 22,
      run: () => testDarkMode(page),
    },
    {
      label: 'Testing Text Spacing...',
      progress: 33,
      run: () => testTextSpacing(page),
    },
    {
      label: 'Testing Text Resize 200%...',
      progress: 44,
      run: () => testTextResize200(page),
    },
    {
      label: 'Testing Reduced Motion...',
      progress: 55,
      run: () => testReducedMotion(page),
    },
    {
      label: 'Testing Focus Indicator Visibility...',
      progress: 66,
      run: () => testFocusIndicatorVisibility(page),
    },
    {
      label: 'Testing Touch Target Size...',
      progress: 72,
      run: () => testTouchTargetSize(page),
    },
    {
      label: 'Testing Reflow at 320px...',
      progress: 83,
      run: () => testReflow320(page, url, browser),
    },
    {
      label: 'Testing Orientation Support...',
      progress: 94,
      run: () => testOrientation(page, url, browser),
    },
  ];

  for (const step of testPlan) {
    notify(step.label, step.progress);

    try {
      const result = await step.run();
      tests.push(result);
    } catch (err: any) {
      // If an individual test throws, record a failure and continue
      tests.push({
        testId: step.label.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase(),
        testName: step.label.replace(/^Testing\s+/, '').replace(/\.{3}$/, ''),
        wcagCriterion: 'N/A',
        status: 'fail',
        score: 0,
        issues: [
          {
            element: 'test-runner',
            description: `Test threw an error: ${err.message || String(err)}`,
            severity: 'critical',
          },
        ],
        duration: 0,
      });
    }

    // Small delay between tests so the UI progress is visible
    await delay(400);

    // Reset media emulation between tests (safety net)
    try {
      await page.emulateMedia({
        colorScheme: null as any,
        reducedMotion: null as any,
        forcedColors: null as any,
      });
    } catch {
      // Page may have been closed by a fresh-context test — ignore
    }
  }

  // Aggregate results
  const passCount = tests.filter((t) => t.status === 'pass').length;
  const failCount = tests.filter((t) => t.status === 'fail').length;
  const warningCount = tests.filter((t) => t.status === 'warning').length;
  const overallScore =
    tests.length > 0
      ? Math.round(tests.reduce((sum, t) => sum + t.score, 0) / tests.length)
      : 0;

  if (sendProgress) {
    sendProgress({
      agent: 'visual-tester',
      status: 'done',
      message: `Completed ${tests.length} visual accessibility tests — score: ${overallScore}/100`,
      progress: 100,
    });
  }

  return {
    tests,
    overallScore,
    passCount,
    failCount,
    warningCount,
    totalDuration: Date.now() - totalStart,
  };
}
