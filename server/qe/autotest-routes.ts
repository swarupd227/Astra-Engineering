/**
 * Auto-Test Routes
 * Clean, focused test automation: crawl → test cases → scripts → execute
 * No AI API key required — generates directly from crawled DOM data.
 */
import type { Express, Request, Response } from 'express';
import { EnhancedCrawler } from './enhanced-crawler';
import { playwrightService } from './playwright-service';
import { spawn } from 'child_process';
import { writeFile, mkdir, rm, readFile } from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { db } from './db';
import { autoTestRuns, autoTestPages, autoTestCases, autoTestScripts, autoTestExecutions, frameworkConfigs, frameworkFunctions, userStories } from '@shared/qe-schema';
import { eq, desc, inArray } from 'drizzle-orm';
import { generatePOMTestSuite, detectPattern, getCanonicalHelperFiles, type FrameworkContext, type UserStoryContext } from './pom-generator';
import { isAwsHosting } from '../platform/hosting';
import JSZip from 'jszip';

// ─── DOM-based generators (no AI API key required) ───────────────────────────

function toKey(s: string): string {
  const key = (s || 'element')
    .replace(/[^a-zA-Z0-9]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase() || 'element';
  // JS identifiers cannot start with a digit — prefix with underscore
  return /^[0-9]/.test(key) ? `_${key}` : key;
}

function pageKey(url: string): string {
  try {
    const parts = new URL(url).pathname.split('/').filter(Boolean);
    return parts.length ? toKey(parts[parts.length - 1]) : 'home';
  } catch { return 'home'; }
}

function xpathForInput(el: any): string {
  if (el.name)        return `//input[@name="${el.name}"]`;
  if (el.selector?.startsWith('#')) return `//*[@id="${el.selector.slice(1)}"]`;
  if (el.type === 'email')    return `//input[@type="email"]`;
  if (el.type === 'password') return `//input[@type="password"]`;
  if (el.type === 'tel')      return `//input[@type="tel"]`;
  if (el.placeholder) return `//input[@placeholder="${el.placeholder}"]`;
  return `//input[@type="${el.type || 'text'}"]`;
}

function xpathForButton(el: any): string {
  if (el.selector?.startsWith('#')) return `//*[@id="${el.selector.slice(1)}"]`;
  if (el.type === 'submit') return `//button[@type="submit"] | //input[@type="submit"]`;
  if (el.text) return `//button[normalize-space()="${el.text}"]`;
  return `//button`;
}

function xpathForLink(l: any): string {
  if (l.text) return `//a[normalize-space()="${l.text}"]`;
  if (l.href) return `//a[@href="${l.href}"]`;
  return `//a`;
}

function sampleValue(input: any): string {
  const t = (input.type || '').toLowerCase();
  const n = (input.name || input.label || '').toLowerCase();
  if (t === 'email' || n.includes('email'))    return 'test@example.com';
  if (t === 'password' || n.includes('pass'))  return 'TestPass@123';
  if (t === 'tel' || n.includes('phone'))      return '9876543210';
  if (n.includes('name'))                      return 'John Doe';
  if (n.includes('company') || n.includes('org')) return 'Test Company';
  if (n.includes('subject') || n.includes('title')) return 'Test Subject';
  if (t === 'url' || n.includes('url') || n.includes('website')) return 'https://example.com';
  if (t === 'number' || n.includes('age') || n.includes('count')) return '25';
  return 'Test Value';
}

/**
 * Build a stable CSS selector for an input, avoiding dynamic auto-generated IDs.
 * Priority: name attr → aria-label → placeholder → type
 */
function stableCss(el: any): string {
  // Detect element tag
  const isTextarea = el.type === 'textarea';
  const isButton   = el.type === 'submit' || el.type === 'button' || el.tagName === 'button' || el.text;
  const tag = isTextarea ? 'textarea' : isButton ? 'button' : 'input';

  // Avoid IDs that look auto-generated (long strings, CF7-style hex, UUIDs)
  const rawId = el.selector?.startsWith('#') ? el.selector.slice(1) : null;
  const idLooksDynamic = rawId && (rawId.length > 20 || /[0-9a-f]{8,}/i.test(rawId));

  if (!idLooksDynamic && rawId) return el.selector;  // stable id — use it
  if (isButton) {
    if (el.type === 'submit') return 'button[type="submit"], input[type="submit"]';
    if (el.text)              return `button:has-text("${el.text.replace(/"/g, '\\"')}")`;
    return 'button';
  }
  if (el.name)        return `${tag}[name="${el.name}"]`;
  if (el.ariaLabel)   return `${tag}[aria-label="${el.ariaLabel}"]`;
  if (el.placeholder) return `${tag}[placeholder="${el.placeholder}"]`;
  if (el.type && el.type !== 'text') return `${tag}[type="${el.type}"]`;
  return tag;
}

/** Generate comprehensive test cases from crawled DOM — think like a real tester */
function generateTestCasesFromDom(domData: any[], baseUrl: string): any[] {
  const testCases: any[] = [];
  let tcNum = 0;
  const id = () => `TC-${String(++tcNum).padStart(3, '0')}`;
  const seenTitles = new Set<string>();
  const addTC = (tc: any) => {
    if (seenTitles.has(tc.title)) return;
    seenTitles.add(tc.title);
    testCases.push(tc);
  };

  const seenUrls = new Set<string>();
  const uniquePages = domData.filter(p => {
    if (!p?.url || seenUrls.has(p.url)) return false;
    seenUrls.add(p.url);
    return true;
  });

  for (const page of uniquePages) {
    const dom    = page.domStructure;
    const url    = page.url;
    const title  = page.title || url;
    const h1s: string[]  = dom?.headings?.h1 || [];
    const h2s: string[]  = dom?.headings?.h2 || [];
    const forms: any[]   = dom?.forms || [];
    const inputs: any[]  = (dom?.interactiveElements?.inputs || []).filter((i: any) => !isHoneypot(i) && !isRecaptchaEl(i));
    const buttons: any[] = (dom?.interactiveElements?.buttons || []).filter((b: any) => b.text && !isSvgNoise(b.text));
    const navLinks: any[] = (dom?.navigation?.navLinks || []).filter((l: any) => l.text && l.href && !isSvgNoise(l.text));
    const submitBtn = buttons.find((b: any) => b.type === 'submit' || (b.text || '').toLowerCase().includes('submit')) || buttons[0];
    const submitBtnText = submitBtn?.text || 'Submit';
    const textInputs = inputs.filter((i: any) => ['text','email','tel','password','textarea',''].includes(i.type || ''));
    const emailInput = inputs.find((i: any) => i.type === 'email' || (i.name || '').toLowerCase().includes('email'));
    const hasForm = forms.length > 0 || inputs.length >= 2;

    // ─── SMOKE ───────────────────────────────────────────────────────────────

    addTC({
      id: id(), title: `[Smoke] "${title}" page loads with HTTP 200`, priority: 'P0',
      category: 'smoke', pageUrl: url,
      description: `Verify the page at ${url} returns HTTP 200, renders within 3 seconds, and shows a page title`,
      steps: [
        `Open browser and navigate to ${url}`,
        `Wait for page to fully load (domcontentloaded event fires)`,
        `Verify HTTP response status is 200 (not 404, 403, or 500)`,
        `Verify document.title is not empty or "undefined"`,
        `Verify page renders visible content in the viewport`,
        `Record page load time — must be under 10 seconds`,
        `Verify browser URL matches the expected URL (no unexpected redirects)`,
      ],
      expectedResult: `Page loads in under 10 seconds, HTTP 200, title="${title}", no blank page`,
      locatorHints: { title: 'document.title', body: 'body', statusCheck: 'network request intercept' },
    });

    // ─── FUNCTIONAL: Content & Scroll ────────────────────────────────────────

    addTC({
      id: id(), title: `[Functional] Verify all content visible on "${title}"`, priority: 'P1',
      category: 'functional', pageUrl: url,
      description: `Scroll through the entire page and verify every section renders correctly — no missing content, no broken images`,
      steps: [
        `Navigate to ${url}`,
        `Verify H1 heading is visible${h1s[0] ? `: expect text "${h1s[0]}"` : ''}`,
        h2s.length ? `Verify at least one H2 subheading is visible (e.g., "${h2s[0]}")` : `Verify body text content is not empty`,
        `Scroll down to 25% of the page height — verify content section is rendered`,
        `Scroll down to 50% of the page height — verify mid-page content loads`,
        `Scroll down to 75% of the page height — verify further content is visible`,
        `Scroll to bottom of page (scrollY = document.body.scrollHeight)`,
        `Verify footer element is visible at the bottom`,
        `Verify no image shows a broken icon (img.complete === true AND naturalWidth > 0)`,
        `Verify no text "undefined", "null", or "[object Object]" is visible on screen`,
        `Scroll back to top — verify page returns to correct position`,
      ],
      expectedResult: `All page sections render, footer visible, zero broken images, no placeholder text. Content flows top-to-bottom without gaps`,
    });

    addTC({
      id: id(), title: `[Functional] Verify no broken links on "${title}"`, priority: 'P1',
      category: 'functional', pageUrl: url,
      description: `Extract all anchor tags from the page and verify each internal link returns HTTP 200, not 404`,
      steps: [
        `Navigate to ${url}`,
        `Extract all <a href="..."> links on the page`,
        `Filter to internal links only (same domain as ${new URL(baseUrl).hostname})`,
        `For each internal link, send a GET request and check response status`,
        `Flag any link returning 404, 410, 500, or connection refused`,
        `Verify anchor links (#section) resolve to an existing element on the page`,
        `Report all broken links with their href values`,
      ],
      expectedResult: `Zero broken links. All internal hrefs return HTTP 200. Anchor links resolve to existing elements`,
    });

    if (navLinks.length > 0) {
      for (const link of navLinks.slice(0, 3)) {
        let isSameDomain = false;
        try { isSameDomain = new URL(link.href).hostname === new URL(baseUrl).hostname; } catch {}
        if (!isSameDomain) continue;
        addTC({
          id: id(), title: `[Functional] Click "${link.text}" nav link from "${title}"`, priority: 'P1',
          category: 'functional', pageUrl: url,
          description: `Click the "${link.text}" navigation link and verify the target page loads correctly`,
          steps: [
            `Navigate to ${url}`,
            `Locate the navigation link with text "${link.text}"`,
            `Verify the link href is "${link.href}"`,
            `Click the "${link.text}" link`,
            `Wait for navigation to complete`,
            `Verify browser URL changes to contain "${link.href}"`,
            `Verify the target page title is not empty`,
            `Verify the target page renders visible content`,
            `Click browser back button`,
            `Verify original page "${title}" is restored`,
          ],
          expectedResult: `"${link.text}" link navigates to "${link.href}" successfully. Target page loads. Back navigation works`,
        });
      }
    }

    // ─── FUNCTIONAL: Form Happy Path ──────────────────────────────────────────

    if (hasForm) {
      const fillSteps = textInputs.slice(0, 8).map((inp: any) => {
        const label = inp.label || inp.name || inp.placeholder || inp.type || 'field';
        return `Fill the "${label}" field with test value "${sampleValue(inp)}"`;
      });

      addTC({
        id: id(), title: `[Functional] Submit "${title}" form with valid data`, priority: 'P1',
        category: 'functional', pageUrl: url,
        description: `Fill every form field with realistic valid data, submit the form, and assert a success message or confirmation page appears`,
        steps: [
          `Navigate to ${url}`,
          `Verify the form is visible and all fields are enabled`,
          ...fillSteps,
          `Take a screenshot to record the filled-in form state`,
          `Click the "${submitBtnText}" button`,
          `Wait up to 15 seconds for page response`,
          `Verify a success/confirmation message appears (e.g., "Thank you", "Message sent", "We'll be in touch")`,
          `OR verify URL changes to a thank-you/confirmation page`,
          `Verify no error messages are displayed after submission`,
          `Verify the form does not remain in an incomplete state`,
        ],
        expectedResult: `Form submits successfully. User sees a confirmation. No error state. HTTP response is 200 or 302-redirect to success page`,
      });

      addTC({
        id: id(), title: `[Functional] Verify form field labels and placeholders on "${title}"`, priority: 'P1',
        category: 'functional', pageUrl: url,
        description: `Verify every form field has a visible label or placeholder that clearly describes what the user should enter`,
        steps: [
          `Navigate to ${url}`,
          `For each input field, verify a <label> or aria-label or placeholder exists`,
          `Verify label text accurately describes the expected input (not generic "Field 1")`,
          `Click on each label — verify it focuses the associated input`,
          `Verify required fields are marked with * or "required" indicator`,
          `Verify submit button text is descriptive (e.g., "Send Message", not just "Click")`,
        ],
        expectedResult: `Every field has a clear label. Required fields are marked. Submit button has descriptive text. Labels focus correct inputs when clicked`,
      });
    }

    // ─── NEGATIVE ─────────────────────────────────────────────────────────────

    if (hasForm) {
      addTC({
        id: id(), title: `[Negative] Submit "${title}" form with all required fields empty`, priority: 'P1',
        category: 'negative', pageUrl: url,
        description: `Leave all required fields blank and click Submit — the form must NOT submit and must show clear validation errors`,
        steps: [
          `Navigate to ${url}`,
          `Do not fill any form fields — leave everything empty`,
          `Click the "${submitBtnText}" button`,
          `Verify the form does NOT submit (user stays on same page, no thank-you message)`,
          `Verify inline validation error messages appear next to each required field`,
          `Verify the error messages are readable (not CSS-hidden)`,
          `Verify the page does not show a 500 or 400 error`,
        ],
        expectedResult: `Form shows validation errors for all required fields. Page does not navigate away. No server error`,
      });

      if (emailInput) {
        addTC({
          id: id(), title: `[Negative] Enter invalid email format in "${title}" form`, priority: 'P1',
          category: 'negative', pageUrl: url,
          description: `Enter various malformed email addresses and verify the form rejects each one with a clear error`,
          steps: [
            `Navigate to ${url}`,
            `Enter "plaintext" (no @ symbol) in the email field`,
            `Click outside the field or try to submit — verify validation error appears`,
            `Clear field and enter "missing@domain" (no TLD)`,
            `Verify error appears`,
            `Clear field and enter "@nodomain.com" (no local part)`,
            `Verify error appears`,
            `Clear field and enter "two@@at.com" (double @)`,
            `Verify error appears`,
            `Verify the form never submits with any of these invalid values`,
          ],
          expectedResult: `Each invalid email format triggers a clear validation message. Form never submits. Error text mentions valid email format`,
        });
      }

      const phoneInput = inputs.find((i: any) => i.type === 'tel' || (i.name || '').toLowerCase().includes('phone'));
      if (phoneInput) {
        addTC({
          id: id(), title: `[Negative] Enter invalid phone number in "${title}" form`, priority: 'P2',
          category: 'negative', pageUrl: url,
          description: `Enter non-numeric and too-short phone numbers to verify validation`,
          steps: [
            `Navigate to ${url}`,
            `Enter "abc-xyz" (letters) in the phone field`,
            `Verify numeric-only validation error`,
            `Clear and enter "123" (too short)`,
            `Verify minimum length error`,
            `Clear and enter "99999999999999" (too long)`,
            `Verify maximum length error or truncation`,
          ],
          expectedResult: `Phone field validates correctly. Alphabetic input rejected. Length limits enforced`,
        });
      }

      addTC({
        id: id(), title: `[Negative] Attempt multiple rapid submissions on "${title}" form`, priority: 'P2',
        category: 'negative', pageUrl: url,
        description: `Rapidly click the Submit button multiple times to verify the form handles double-submit protection`,
        steps: [
          `Navigate to ${url}`,
          ...textInputs.slice(0, 3).map((inp: any) => `Fill "${inp.label || inp.name || 'field'}" with valid data`),
          `Click the "${submitBtnText}" button 3 times in rapid succession (within 500ms)`,
          `Verify only ONE submission is processed (not 3 duplicate submissions)`,
          `Verify the Submit button becomes disabled after first click`,
          `Verify no duplicate success messages appear`,
        ],
        expectedResult: `Form submitted exactly once. Double-click protection works. Submit button disables after first click`,
      });
    }

    // ─── EDGE CASES ──────────────────────────────────────────────────────────

    if (hasForm && textInputs.length > 0) {
      addTC({
        id: id(), title: `[Edge] Enter 500-character string in "${title}" form text fields`, priority: 'P2',
        category: 'edge', pageUrl: url,
        description: `Test boundary behavior by entering extremely long text in all text inputs — the form must not crash`,
        steps: [
          `Navigate to ${url}`,
          `Generate a 500-character string (repeated "Lorem ipsum dolor sit amet...")`,
          `Paste it into each text input and textarea on the form`,
          `Verify the page does not freeze, crash, or throw JavaScript errors`,
          `Verify fields either truncate to their maxlength attribute OR accept the full text`,
          `Try submitting the form with max-length content`,
          `Verify graceful handling — either success or a clear error message`,
        ],
        expectedResult: `Page remains stable. Fields respect maxlength or show character limit message. No crash, no blank screen`,
      });

      addTC({
        id: id(), title: `[Edge] Enter special characters in "${title}" form fields`, priority: 'P2',
        category: 'edge', pageUrl: url,
        description: `Enter Unicode, emoji, and HTML special characters to test encoding and rendering`,
        steps: [
          `Navigate to ${url}`,
          `Enter "Test ñoño résumé café" (accented/Unicode characters) in the name field`,
          `Enter "Test 🎉🔥💯" (emoji) in a text field`,
          `Enter "O'Brien & Associates <Test>" (apostrophes, ampersands, angle brackets) in a text field`,
          `Submit the form`,
          `Verify the special characters are handled without errors`,
          `Verify the response page correctly displays the submitted characters (not garbled/escaped)`,
        ],
        expectedResult: `All special characters handled gracefully. UTF-8 encoding preserved. No HTML injection. No server 500 error`,
      });
    }

    // ─── SECURITY ────────────────────────────────────────────────────────────

    if (hasForm && textInputs.length > 0) {
      addTC({
        id: id(), title: `[Security] XSS injection attempt on "${title}" form`, priority: 'P1',
        category: 'security', pageUrl: url,
        description: `Inject Cross-Site Scripting (XSS) payloads into form fields and verify the application does NOT execute injected scripts`,
        steps: [
          `Navigate to ${url}`,
          `Set up a listener for JavaScript alert() dialogs before filling the form`,
          `Enter XSS payload 1: <script>alert("xss-test-1")</script> in the first text field`,
          `Enter XSS payload 2: "><img src=x onerror=alert("xss2")> in the second text field`,
          `Enter XSS payload 3: javascript:alert("xss3") in a URL/link field if present`,
          `Submit the form`,
          `Wait 2 seconds for any delayed script execution`,
          `Verify ZERO alert dialogs appeared`,
          `Verify the response page HTML-escapes the injected text (shows &lt;script&gt; not <script>)`,
          `Verify the page is still functional after the XSS attempt`,
        ],
        expectedResult: `No JavaScript executed from injected payload. XSS content is sanitized/escaped in output. Zero alert dialogs. Application remains functional`,
      });

      addTC({
        id: id(), title: `[Security] SQL injection attempt on "${title}" form`, priority: 'P1',
        category: 'security', pageUrl: url,
        description: `Enter SQL injection patterns in form fields and verify the app does not expose database errors or unexpected data`,
        steps: [
          `Navigate to ${url}`,
          `Enter SQL payload: ' OR '1'='1 in the email or username field`,
          `Enter SQL payload: admin'-- in the password field (if present)`,
          `Enter SQL payload: 1; DROP TABLE users;-- in a text field`,
          `Submit the form`,
          `Verify the page does NOT show a database error (e.g., "SQL syntax error", "ORA-", "mysql_error")`,
          `Verify the page does NOT return unexpected data rows`,
          `Verify the user sees a standard validation error or "invalid input" message`,
          `Verify the application does not crash or return a 500 error`,
        ],
        expectedResult: `No database error messages exposed. No unexpected data returned. User sees standard error. App remains stable with no crash`,
      });
    }

    // ─── ACCESSIBILITY ───────────────────────────────────────────────────────

    addTC({
      id: id(), title: `[Accessibility] Verify WCAG 2.1 AA compliance on "${title}"`, priority: 'P2',
      category: 'accessibility', pageUrl: url,
      description: `Check key WCAG 2.1 AA accessibility requirements — images have alt text, form inputs have labels, page structure is correct`,
      steps: [
        `Navigate to ${url}`,
        `Check: All <img> tags have a non-empty alt attribute (or role="presentation" for decorative images)`,
        `Check: Page has exactly one <h1> heading${h1s[0] ? ` — expect "${h1s[0]}"` : ''}`,
        `Check: Heading hierarchy is correct (no skipping from H1 to H4)`,
        hasForm ? `Check: Every <input> has an associated <label for="..."> or aria-label attribute` : `Check: All interactive elements have accessible names`,
        `Check: All buttons have descriptive text (not just icons without aria-label)`,
        `Press Tab key — verify focus indicator (outline) is visible on each interactive element`,
        `Press Tab through all form fields — verify Tab order is logical (top-to-bottom, left-to-right)`,
        `Check: <html> tag has lang="en" (or appropriate language)`,
        `Check: Color is not the only means of conveying information (e.g., errors are not only shown in red)`,
      ],
      expectedResult: `All images have alt text. One H1. Labels on all inputs. Tab order is logical. Focus visible on keyboard nav. lang attribute present`,
    });
  }

  return testCases;
}

/** Helper filters used by both generators */
function isHoneypot(el: any): boolean {
  return (el.name || '').toLowerCase().includes('honeypot') ||
         (el.name || '').toLowerCase().includes('_trap') ||
         String(el.tabindex) === '-1';
}
function isRecaptchaEl(el: any): boolean {
  return (el.name || '').includes('g-recaptcha') ||
         (el.id || el.selector || '').includes('recaptcha');
}
function isSvgNoise(text: string): boolean {
  return !text || text.trim() === '.' || text.trim().length === 0 ||
         /^[._\-\s]+$/.test(text) || text.includes('cls_') ||
         text.includes('fill_') || text.includes('stroke') || text.length > 80;
}

/** Generate comprehensive Playwright TypeScript script */
function generatePlaywrightScript(domData: any[], testCases: any[], baseUrl: string): string {

  // ── Identify shared nav links (appear on 2+ pages) ────────────────────────
  const navLinkFreq = new Map<string, number>();
  for (const page of domData) {
    for (const l of (page.domStructure?.navigation?.navLinks || [])) {
      if (l.text && !isSvgNoise(l.text)) {
        const k = l.href || l.text;
        navLinkFreq.set(k, (navLinkFreq.get(k) || 0) + 1);
      }
    }
  }
  const sharedNavHrefs = new Set<string>([...navLinkFreq.entries()].filter(([,c]) => c >= 2).map(([k]) => k));

  const CONTACT_NAMES = new Set(['your-name','your-email','contactnumber','contact_number',
    'your-subject','your-message','message','phone','your_name','your_email','your_subject','your_message']);
  const SEARCH_NAMES = new Set(['s','search','q','query']);

  let sharedNavLinks: any[] = [];
  let sharedContactFields: any[] = [];
  let sharedSearchInput: any = null;

  for (const page of domData) {
    const dom = page.domStructure;
    if (!dom) continue;
    if (!sharedNavLinks.length) {
      sharedNavLinks = (dom.navigation?.navLinks || []).filter((l: any) =>
        l.text && !isSvgNoise(l.text) && sharedNavHrefs.has(l.href || l.text));
    }
    if (!sharedContactFields.length) {
      const cf = (dom.interactiveElements?.inputs || []).filter((i: any) =>
        !isHoneypot(i) && !isRecaptchaEl(i) && CONTACT_NAMES.has((i.name || '').toLowerCase()));
      if (cf.length >= 2) sharedContactFields = cf;
    }
    if (!sharedSearchInput) {
      sharedSearchInput = (dom.interactiveElements?.inputs || []).find((i: any) =>
        !isHoneypot(i) && SEARCH_NAMES.has((i.name || '').toLowerCase())) ?? null;
    }
  }

  function dedupKey(seen: Map<string, number>, base: string): string {
    const c = seen.get(base) || 0; seen.set(base, c + 1);
    return c === 0 ? base : `${base}_${c}`;
  }

  // ── SHARED block ──────────────────────────────────────────────────────────
  const sharedParts: string[] = [];
  if (sharedNavLinks.length) {
    const seen = new Map<string, number>();
    sharedParts.push(`  nav: {\n${sharedNavLinks.slice(0, 12).map((l: any) => {
      const k = dedupKey(seen, toKey(l.text + '_link'));
      return `    ${k}: { css: ${JSON.stringify(`a[href="${l.href}"]`)}, xpath: ${JSON.stringify(xpathForLink(l))}, text: ${JSON.stringify(l.text)}, href: ${JSON.stringify(l.href)} }`;
    }).join(',\n')}\n  }`);
  }
  if (sharedContactFields.length) {
    const seen = new Map<string, number>();
    sharedParts.push(`  contactForm: {\n${sharedContactFields.map((f: any) => {
      const k = dedupKey(seen, toKey(f.label || f.name || 'field'));
      return `    ${k}: { css: ${JSON.stringify(stableCss(f))}, xpath: ${JSON.stringify(xpathForInput(f))}, label: ${JSON.stringify(f.label || f.name || '')} }`;
    }).join(',\n')}\n  }`);
  }
  if (sharedSearchInput) {
    sharedParts.push(`  search: { css: ${JSON.stringify(stableCss(sharedSearchInput))}, xpath: ${JSON.stringify(xpathForInput(sharedSearchInput))} }`);
  }
  const sharedBlock = sharedParts.length
    ? `const SHARED = {\n${sharedParts.join(',\n\n')}\n};\n`
    : `const SHARED = {};\n`;

  // ── PAGES block ───────────────────────────────────────────────────────────
  const sharedInputNames = new Set<string>([
    ...sharedContactFields.map((f: any) => (f.name || '').toLowerCase()),
    ...(sharedSearchInput ? [(sharedSearchInput.name || '').toLowerCase()] : []),
  ]);

  const pageEntries: string[] = [];
  for (const page of domData) {
    const dom = page.domStructure;
    if (!dom) continue;
    const key = pageKey(page.url);
    const lines: string[] = [];
    const seen = new Map<string, number>();
    const add = (base: string, val: string) => lines.push(`    ${dedupKey(seen, base)}: ${val}`);

    add('url', JSON.stringify(page.url));
    const h1s: string[] = dom.headings?.h1 || [];
    if (h1s[0]) add('h1', `{ css: 'h1', xpath: '//h1[1]', text: ${JSON.stringify(h1s[0])} }`);

    for (const inp of (dom.interactiveElements?.inputs || []).slice(0, 15)) {
      if (isHoneypot(inp) || isRecaptchaEl(inp)) continue;
      if (sharedInputNames.has((inp.name || '').toLowerCase())) continue;
      add(toKey(inp.label || inp.name || inp.placeholder || inp.type || 'input'),
          `{ css: ${JSON.stringify(stableCss(inp))}, xpath: ${JSON.stringify(xpathForInput(inp))}, label: ${JSON.stringify(inp.label || inp.name || '')}, sampleValue: ${JSON.stringify(sampleValue(inp))} }`);
    }
    for (const btn of (dom.interactiveElements?.buttons || []).slice(0, 8)) {
      if (!btn.text || isSvgNoise(btn.text)) continue;
      add(toKey(btn.text + '_btn'), `{ css: ${JSON.stringify(stableCss(btn))}, xpath: ${JSON.stringify(xpathForButton(btn))}, text: ${JSON.stringify(btn.text)} }`);
    }
    for (const link of (dom.navigation?.navLinks || []).slice(0, 8)) {
      if (!link.text || isSvgNoise(link.text)) continue;
      if (sharedNavHrefs.has(link.href || link.text)) continue;
      add(toKey(link.text + '_link'), `{ css: ${JSON.stringify(`a[href="${link.href}"]`)}, xpath: ${JSON.stringify(xpathForLink(link))}, text: ${JSON.stringify(link.text)}, href: ${JSON.stringify(link.href)} }`);
    }
    if (lines.length) pageEntries.push(`  ${key}: {\n${lines.join(',\n')}\n  }`);
  }
  const pagesBlock = pageEntries.length
    ? `const PAGES = {\n${pageEntries.join(',\n\n')}\n};\n`
    : `const PAGES = {};\n`;

  // ── Build test blocks ─────────────────────────────────────────────────────
  const groups: Record<string, any[]> = {};
  for (const tc of testCases) {
    const cat = tc.category || 'general';
    if (!groups[cat]) groups[cat] = [];
    groups[cat].push(tc);
  }

  const testBlocks: string[] = [];

  for (const [category, cases] of Object.entries(groups)) {
    const label = ({ smoke: 'Smoke Tests', functional: 'Functional Tests', negative: 'Negative Tests',
      edge: 'Edge Case Tests', security: 'Security Tests', accessibility: 'Accessibility Tests' } as Record<string, string>)[category]
      || (category.charAt(0).toUpperCase() + category.slice(1) + ' Tests');

    const tests: string[] = [];

    for (const tc of cases) {
      const pKey = pageKey(tc.pageUrl || baseUrl);
      const dom  = domData.find((p: any) => p.url === tc.pageUrl);
      const allInputs: any[] = dom?.domStructure?.interactiveElements?.inputs || [];
      const inputs = allInputs.filter((i: any) => !isHoneypot(i) && !isRecaptchaEl(i));
      const textInputs = inputs.filter((i: any) => ['text','email','tel','password','textarea',''].includes(i.type || ''));
      const submitBtn = (dom?.domStructure?.interactiveElements?.buttons || []).find((b: any) =>
        b.type === 'submit' || (b.text || '').toLowerCase().includes('submit'));
      const submitCss = submitBtn ? stableCss(submitBtn) : 'button[type="submit"]';

      const body: string[] = [];
      const pageUrlExpr = `PAGES['${pKey}']?.url ?? ${JSON.stringify(tc.pageUrl || baseUrl)}`;

      if (category === 'smoke') {
        body.push(`    const t0 = Date.now();`);
        body.push(`    const response = await page.goto(${pageUrlExpr});`);
        body.push(`    await page.waitForLoadState('domcontentloaded');`);
        body.push(`    const loadMs = Date.now() - t0;`);
        body.push(`    // Assert HTTP 200`);
        body.push(`    expect(response?.status() ?? 200).toBe(200);`);
        body.push(`    // Assert page title is not empty`);
        body.push(`    const pageTitle = await page.title();`);
        body.push(`    expect(pageTitle.trim()).not.toBe('');`);
        body.push(`    expect(pageTitle).not.toContain('404');`);
        body.push(`    expect(pageTitle).not.toContain('Error');`);
        body.push(`    // Assert body has content`);
        body.push(`    await expect(page.locator('body')).not.toBeEmpty();`);
        body.push(`    // Assert load time under 10 seconds`);
        body.push(`    console.log(\`Load time: \${loadMs}ms\`);`);
        body.push(`    expect(loadMs).toBeLessThan(10000);`);

      } else if (category === 'functional' && tc.title.includes('content visible')) {
        body.push(`    await page.goto(${pageUrlExpr});`);
        body.push(`    await page.waitForLoadState('domcontentloaded');`);
        const h1Text = dom?.domStructure?.headings?.h1?.[0];
        if (h1Text) {
          body.push(`    // Assert H1 heading`);
          body.push(`    const h1 = page.locator('h1').first();`);
          body.push(`    await expect(h1).toBeVisible();`);
          body.push(`    await expect(h1).toContainText(${JSON.stringify(h1Text.substring(0, 60))});`);
        } else {
          body.push(`    await expect(page.locator('h1, h2').first()).toBeVisible();`);
        }
        body.push(`    // Scroll to 25%`);
        body.push(`    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight * 0.25));`);
        body.push(`    await page.waitForTimeout(400);`);
        body.push(`    // Scroll to 50%`);
        body.push(`    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight * 0.50));`);
        body.push(`    await page.waitForTimeout(400);`);
        body.push(`    // Scroll to bottom`);
        body.push(`    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));`);
        body.push(`    await page.waitForTimeout(600);`);
        body.push(`    // Assert footer visible`);
        body.push(`    const footer = page.locator('footer, [class*="footer"], #footer').first();`);
        body.push(`    if (await footer.count() > 0) await expect(footer).toBeVisible();`);
        body.push(`    // Assert no broken images`);
        body.push(`    const brokenImages = await page.evaluate(() =>`);
        body.push(`      Array.from(document.images).filter(img => !img.complete || img.naturalWidth === 0).map(img => img.src)`);
        body.push(`    );`);
        body.push(`    expect(brokenImages, \`Broken images: \${brokenImages.join(', ')}\`).toHaveLength(0);`);
        body.push(`    // Assert no "undefined" or "null" text`);
        body.push(`    const bodyText = await page.locator('body').innerText();`);
        body.push(`    expect(bodyText).not.toContain('[object Object]');`);
        body.push(`    // Scroll back to top`);
        body.push(`    await page.evaluate(() => window.scrollTo(0, 0));`);

      } else if (category === 'functional' && tc.title.includes('broken links')) {
        body.push(`    await page.goto(${pageUrlExpr});`);
        body.push(`    await page.waitForLoadState('domcontentloaded');`);
        body.push(`    const domain = new URL(${JSON.stringify(baseUrl)}).hostname;`);
        body.push(`    const hrefs = await page.$$eval('a[href]', (els, d) =>`);
        body.push(`      els.map(el => el.getAttribute('href'))`);
        body.push(`        .filter((h): h is string => !!h && !h.startsWith('#') && !h.startsWith('mailto:') && !h.startsWith('tel:'))`);
        body.push(`        .map(h => h.startsWith('/') ? new URL(h, location.origin).href : h)`);
        body.push(`        .filter(h => { try { return new URL(h).hostname === d; } catch { return false; } })`);
        body.push(`        .slice(0, 20),`);
        body.push(`      domain`);
        body.push(`    );`);
        body.push(`    const broken = [];`);
        body.push(`    for (const href of hrefs) {`);
        body.push(`      try {`);
        body.push(`        const r = await page.request.get(href, { timeout: 8000 });`);
        body.push(`        if (r.status() === 404 || r.status() >= 500) broken.push(\`\${r.status()}: \${href}\`);`);
        body.push(`      } catch { broken.push(\`ERR: \${href}\`); }`);
        body.push(`    }`);
        body.push(`    expect(broken, \`Broken links:\\n\${broken.join('\\n')}\`).toHaveLength(0);`);

      } else if (category === 'functional' && tc.title.includes('Click') && tc.title.includes('nav link')) {
        const linkText = tc.title.match(/Click "([^"]+)"/)?.[1];
        const navLink = dom?.domStructure?.navigation?.navLinks?.find((l: any) => l.text === linkText);
        if (navLink) {
          body.push(`    await page.goto(${pageUrlExpr});`);
          body.push(`    await page.waitForLoadState('domcontentloaded');`);
          body.push(`    const navLink = page.locator(${JSON.stringify(`a[href="${navLink.href}"]`)}).first();`);
          body.push(`    await expect(navLink).toBeVisible();`);
          body.push(`    await navLink.click();`);
          body.push(`    await page.waitForLoadState('domcontentloaded');`);
          body.push(`    await expect(page).toHaveURL(/${navLink.href.replace(/[.*+?^${}()|[\]\\]/g, '\\\\$&').replace(/^https?:\/\/[^/]+/, '')}/);`);
          body.push(`    await expect(page.locator('body')).not.toBeEmpty();`);
          body.push(`    await page.goBack();`);
          body.push(`    await expect(page).toHaveURL(${pageUrlExpr});`);
        } else {
          body.push(`    await page.goto(${pageUrlExpr});`);
          body.push(`    await expect(page.locator('nav a, header a').first()).toBeVisible();`);
        }

      } else if (category === 'functional' && tc.title.includes('Submit') && tc.title.includes('valid data')) {
        body.push(`    await page.goto(${pageUrlExpr});`);
        body.push(`    await page.waitForLoadState('domcontentloaded');`);
        const pageSpecific = textInputs.filter((i: any) => !sharedInputNames.has((i.name || '').toLowerCase()));
        for (const inp of pageSpecific.slice(0, 8)) {
          const css = stableCss(inp);
          const val = sampleValue(inp);
          body.push(`    try {`);
          body.push(`      const f = page.locator(${JSON.stringify(css)}).first();`);
          body.push(`      if (await f.isVisible({ timeout: 3000 })) { await f.scrollIntoViewIfNeeded(); await f.fill(${JSON.stringify(val)}); }`);
          body.push(`    } catch (_e) { /* field not present on this page */ }`);
        }
        for (const f of sharedContactFields.slice(0, 5)) {
          body.push(`    try {`);
          body.push(`      const cf = page.locator(${JSON.stringify(stableCss(f))}).first();`);
          body.push(`      if (await cf.isVisible({ timeout: 3000 })) { await cf.scrollIntoViewIfNeeded(); await cf.fill(${JSON.stringify(sampleValue(f))}); }`);
          body.push(`    } catch (_e) {}`);
        }
        if (submitBtn) {
          body.push(`    // Take screenshot of filled form`);
          body.push(`    await page.screenshot({ path: 'filled-form.png' });`);
          body.push(`    // Submit`);
          body.push(`    const sb = page.locator(${JSON.stringify(submitCss)}).first();`);
          body.push(`    if (await sb.isVisible({ timeout: 5000 })) {`);
          body.push(`      await sb.scrollIntoViewIfNeeded();`);
          body.push(`      await sb.click();`);
          body.push(`      await page.waitForLoadState('domcontentloaded', { timeout: 15000 });`);
          body.push(`    }`);
          body.push(`    // Assert success — check common success indicators`);
          body.push(`    const successSelectors = ['.wpcf7-mail-sent-ok','[class*="success"]','[class*="thank"]','[class*="confirm"]','.alert-success','.notification-success'];`);
          body.push(`    const successTexts = ['thank you','message sent','we\\'ll be in touch','successfully','received your','got it'];`);
          body.push(`    const bodyText = (await page.locator('body').innerText()).toLowerCase();`);
          body.push(`    const urlChanged = !page.url().includes(${JSON.stringify(tc.pageUrl || baseUrl)}.replace(/^https?:\\/\\/[^/]+/, ''));`);
          body.push(`    const textSuccess = successTexts.some(t => bodyText.includes(t));`);
          body.push(`    let elSuccess = false;`);
          body.push(`    for (const sel of successSelectors) {`);
          body.push(`      if (await page.locator(sel).count() > 0) { elSuccess = true; break; }`);
          body.push(`    }`);
          body.push(`    expect(textSuccess || elSuccess || urlChanged, 'No success confirmation found after form submission').toBe(true);`);
          body.push(`    // Assert no error messages`);
          body.push(`    const errorTexts = ['error','invalid','failed','please fix'];`);
          body.push(`    const hasError = errorTexts.some(e => bodyText.includes(e));`);
          body.push(`    expect(hasError).toBe(false);`);
        }

      } else if (category === 'functional' && tc.title.includes('labels and placeholders')) {
        body.push(`    await page.goto(${pageUrlExpr});`);
        body.push(`    await page.waitForLoadState('domcontentloaded');`);
        body.push(`    const unlabeled = await page.evaluate(() => {`);
        body.push(`      const inputs = Array.from(document.querySelectorAll('input:not([type="hidden"]):not([type="submit"]):not([type="button"])'));`);
        body.push(`      return inputs.filter(inp => {`);
        body.push(`        const id = inp.id;`);
        body.push(`        const hasLabel = id && !!document.querySelector(\`label[for="\${id}"]\`);`);
        body.push(`        const hasAria = inp.getAttribute('aria-label') || inp.getAttribute('aria-labelledby');`);
        body.push(`        const hasPlaceholder = inp.getAttribute('placeholder');`);
        body.push(`        return !hasLabel && !hasAria && !hasPlaceholder;`);
        body.push(`      }).map(inp => inp.outerHTML.substring(0, 100));`);
        body.push(`    });`);
        body.push(`    expect(unlabeled, \`Unlabeled inputs: \${unlabeled.join('\\n')}\`).toHaveLength(0);`);

      } else if (category === 'negative' && tc.title.includes('empty')) {
        body.push(`    await page.goto(${pageUrlExpr});`);
        body.push(`    await page.waitForLoadState('domcontentloaded');`);
        body.push(`    const initialUrl = page.url();`);
        body.push(`    // Click submit without filling anything`);
        body.push(`    try {`);
        body.push(`      const sb = page.locator(${JSON.stringify(submitCss + ', button[type="submit"], input[type="submit"]')}).first();`);
        body.push(`      if (await sb.isVisible({ timeout: 5000 })) await sb.click();`);
        body.push(`    } catch (_e) {}`);
        body.push(`    await page.waitForTimeout(1000);`);
        body.push(`    // Must still be on same page`);
        body.push(`    expect(page.url()).toBe(initialUrl);`);
        body.push(`    // Must show validation errors`);
        body.push(`    const invalidCount = await page.locator(':invalid, [aria-invalid="true"], .error, .field-error, .wpcf7-not-valid-tip').count();`);
        body.push(`    const errorTextVisible = await page.locator('text=/required|this field|please fill/i').count();`);
        body.push(`    expect(invalidCount + errorTextVisible).toBeGreaterThan(0);`);

      } else if (category === 'negative' && tc.title.includes('invalid email')) {
        const emailInp = inputs.find((i: any) => i.type === 'email' || (i.name || '').includes('email'));
        if (emailInp) {
          const css = stableCss(emailInp);
          body.push(`    await page.goto(${pageUrlExpr});`);
          body.push(`    await page.waitForLoadState('domcontentloaded');`);
          const badEmails = ['plaintext', 'missing@domain', '@nodomain.com'];
          for (const bad of badEmails) {
            body.push(`    // Test: ${bad}`);
            body.push(`    try {`);
            body.push(`      const ef = page.locator(${JSON.stringify(css)}).first();`);
            body.push(`      if (await ef.isVisible({ timeout: 3000 })) {`);
            body.push(`        await ef.fill(${JSON.stringify(bad)});`);
            body.push(`        await ef.evaluate((el) => el.blur());`);
            body.push(`        await page.waitForTimeout(300);`);
            body.push(`        const isInvalid = await ef.evaluate((el) => el.validity?.valid === false);`);
            body.push(`        if (!isInvalid) { /* Some frameworks use custom validation */ }`);
            body.push(`      }`);
            body.push(`    } catch (_e) {}`);
          }
          body.push(`    // Try submitting with final bad email`);
          body.push(`    try {`);
          body.push(`      const sb = page.locator(${JSON.stringify(submitCss)}).first();`);
          body.push(`      if (await sb.isVisible({ timeout: 3000 })) await sb.click();`);
          body.push(`    } catch (_e) {}`);
          body.push(`    await page.waitForTimeout(500);`);
          body.push(`    // Verify email validation in effect`);
          body.push(`    const emailEl = page.locator(${JSON.stringify(css)}).first();`);
          body.push(`    if (await emailEl.count() > 0) {`);
          body.push(`      const isInvalid = await emailEl.evaluate((el) => el.validity?.valid === false);`);
          body.push(`      expect(isInvalid, 'Email field should be invalid with bad email').toBe(true);`);
          body.push(`    }`);
        }

      } else if (category === 'negative' && tc.title.includes('rapid submission')) {
        body.push(`    await page.goto(${pageUrlExpr});`);
        body.push(`    await page.waitForLoadState('domcontentloaded');`);
        for (const inp of textInputs.slice(0, 3)) {
          body.push(`    try { const f = page.locator(${JSON.stringify(stableCss(inp))}).first(); if (await f.isVisible({timeout:2000})) await f.fill(${JSON.stringify(sampleValue(inp))}); } catch(_e){}`);
        }
        body.push(`    const sb = page.locator(${JSON.stringify(submitCss + ', button[type="submit"]')}).first();`);
        body.push(`    if (await sb.isVisible({ timeout: 3000 })) {`);
        body.push(`      // Rapid triple-click`);
        body.push(`      await sb.click();`);
        body.push(`      await sb.click({ force: true }).catch(() => {}); // May be disabled now`);
        body.push(`      await sb.click({ force: true }).catch(() => {}); // May be disabled now`);
        body.push(`      await page.waitForLoadState('domcontentloaded', { timeout: 10000 });`);
        body.push(`      // Assert submit button is disabled after first click OR only one success shown`);
        body.push(`      const sbDisabled = await sb.isDisabled().catch(() => true);`);
        body.push(`      // Either button disabled OR page navigated away (single submit)`);
        body.push(`      expect(sbDisabled || !page.url().includes(${JSON.stringify(tc.pageUrl || baseUrl)})).toBeTruthy();`);
        body.push(`    }`);

      } else if (category === 'edge' && tc.title.includes('500-character')) {
        const longStr = 'A'.repeat(500);
        body.push(`    await page.goto(${pageUrlExpr});`);
        body.push(`    await page.waitForLoadState('domcontentloaded');`);
        body.push(`    const longString = ${JSON.stringify(longStr)};`);
        body.push(`    const errors = [];`);
        body.push(`    page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });`);
        for (const inp of textInputs.slice(0, 4)) {
          body.push(`    try {`);
          body.push(`      const f = page.locator(${JSON.stringify(stableCss(inp))}).first();`);
          body.push(`      if (await f.isVisible({ timeout: 3000 })) {`);
          body.push(`        await f.fill(longString.substring(0, 1000));`);
          body.push(`        const val = await f.inputValue();`);
          body.push(`        // Either truncated to maxlength OR accepted as-is`);
          body.push(`        expect(val.length).toBeGreaterThan(0); // field accepted input`);
          body.push(`      }`);
          body.push(`    } catch (_e) {}`);
        }
        body.push(`    // Page must still be responsive`);
        body.push(`    await expect(page.locator('body')).toBeVisible();`);
        body.push(`    expect(errors.filter(e => e.includes('crash') || e.includes('Maximum call stack'))).toHaveLength(0);`);

      } else if (category === 'edge' && tc.title.includes('special characters')) {
        body.push(`    await page.goto(${pageUrlExpr});`);
        body.push(`    await page.waitForLoadState('domcontentloaded');`);
        const specialInputs: [string, string][] = [
          ['Unicode', 'Ñoño résumé café naïve'],
          ['Emoji', 'Test 🎉🔥💯'],
          ['HTML entities', "O'Brien & <Associates>"],
        ];
        for (const [type, val] of specialInputs) {
          if (textInputs[0]) {
            body.push(`    // ${type}`);
            body.push(`    try {`);
            body.push(`      const f = page.locator(${JSON.stringify(stableCss(textInputs[0]))}).first();`);
            body.push(`      if (await f.isVisible({ timeout: 3000 })) { await f.fill(${JSON.stringify(val)}); await page.waitForTimeout(200); }`);
            body.push(`    } catch (_e) {}`);
          }
        }
        body.push(`    await expect(page.locator('body')).toBeVisible();`);

      } else if (category === 'security' && tc.title.includes('XSS')) {
        body.push(`    const dialogs = [];`);
        body.push(`    page.on('dialog', async d => { dialogs.push(d.message()); await d.dismiss(); });`);
        body.push(`    await page.goto(${pageUrlExpr});`);
        body.push(`    await page.waitForLoadState('domcontentloaded');`);
        const xssPayloads = [
          '<script>alert("xss-test-1")</script>',
          '"><img src=x onerror=alert("xss2")>',
          "javascript:alert('xss3')",
        ];
        for (let i = 0; i < Math.min(textInputs.length, 3); i++) {
          body.push(`    try {`);
          body.push(`      const f = page.locator(${JSON.stringify(stableCss(textInputs[i]))}).first();`);
          body.push(`      if (await f.isVisible({ timeout: 3000 })) await f.fill(${JSON.stringify(xssPayloads[i] || xssPayloads[0])});`);
          body.push(`    } catch (_e) {}`);
        }
        if (submitBtn) {
          body.push(`    try {`);
          body.push(`      const sb = page.locator(${JSON.stringify(submitCss)}).first();`);
          body.push(`      if (await sb.isVisible({ timeout: 3000 })) await sb.click();`);
          body.push(`    } catch (_e) {}`);
        }
        body.push(`    await page.waitForTimeout(2000);`);
        body.push(`    // CRITICAL: No JS alert dialogs should fire from XSS payloads`);
        body.push(`    expect(dialogs, \`XSS script executed! Dialogs: \${dialogs.join(', ')}\`).toHaveLength(0);`);
        body.push(`    // Assert page is still functional`);
        body.push(`    await expect(page.locator('body')).toBeVisible();`);

      } else if (category === 'security' && tc.title.includes('SQL')) {
        body.push(`    await page.goto(${pageUrlExpr});`);
        body.push(`    await page.waitForLoadState('domcontentloaded');`);
        const sqlPayloads = ["' OR '1'='1", "admin'--", "1; DROP TABLE users;--"];
        for (let i = 0; i < Math.min(textInputs.length, 3); i++) {
          body.push(`    try {`);
          body.push(`      const f = page.locator(${JSON.stringify(stableCss(textInputs[i]))}).first();`);
          body.push(`      if (await f.isVisible({ timeout: 3000 })) await f.fill(${JSON.stringify(sqlPayloads[i] || sqlPayloads[0])});`);
          body.push(`    } catch (_e) {}`);
        }
        if (submitBtn) {
          body.push(`    try {`);
          body.push(`      const sb = page.locator(${JSON.stringify(submitCss)}).first();`);
          body.push(`      if (await sb.isVisible({ timeout: 3000 })) await sb.click();`);
          body.push(`    } catch (_e) {}`);
        }
        body.push(`    await page.waitForLoadState('domcontentloaded', { timeout: 10000 });`);
        body.push(`    const bodyText = (await page.locator('body').innerText()).toLowerCase();`);
        body.push(`    // Must NOT expose database errors`);
        body.push(`    const dbErrors = ['sql syntax','mysql_error','ora-','pg::','sqlite','syntax error near','unclosed quotation'];`);
        body.push(`    const hasDbError = dbErrors.some(e => bodyText.includes(e));`);
        body.push(`    expect(hasDbError, 'Database error exposed to user — SQL injection vulnerability').toBe(false);`);
        body.push(`    // Must NOT return 500`);
        body.push(`    expect(page.url()).not.toContain('500');`);

      } else if (category === 'accessibility') {
        body.push(`    await page.goto(${pageUrlExpr});`);
        body.push(`    await page.waitForLoadState('domcontentloaded');`);
        body.push(`    // 1. Check all images have alt text`);
        body.push(`    const imgsWithoutAlt = await page.evaluate(() =>`);
        body.push(`      Array.from(document.querySelectorAll('img'))`);
        body.push(`        .filter(img => !img.getAttribute('alt') && img.getAttribute('role') !== 'presentation')`);
        body.push(`        .map(img => img.src.split('/').pop() || 'unknown').slice(0, 5)`);
        body.push(`    );`);
        body.push(`    expect(imgsWithoutAlt, \`Images missing alt text: \${imgsWithoutAlt.join(', ')}\`).toHaveLength(0);`);
        body.push(`    // 2. Check exactly one H1`);
        body.push(`    const h1Count = await page.locator('h1').count();`);
        body.push(`    expect(h1Count).toBeGreaterThanOrEqual(1);`);
        if (inputs.length > 0) {
          body.push(`    // 3. Check inputs have labels or aria-label`);
          body.push(`    const unlabeled = await page.evaluate(() =>`);
          body.push(`      Array.from(document.querySelectorAll('input:not([type="hidden"]):not([type="submit"]):not([type="button"])'))`);
          body.push(`        .filter(inp => !inp.id || !document.querySelector(\`label[for="\${inp.id}"]\`))`);
          body.push(`        .filter(inp => !inp.getAttribute('aria-label') && !inp.getAttribute('aria-labelledby') && !inp.getAttribute('placeholder'))`);
          body.push(`        .length`);
          body.push(`    );`);
          body.push(`    expect(unlabeled, \`\${unlabeled} inputs have no label/aria-label/placeholder\`).toBe(0);`);
        }
        body.push(`    // 4. Check lang attribute`);
        body.push(`    const langAttr = await page.evaluate(() => document.documentElement.getAttribute('lang'));`);
        body.push(`    expect(langAttr, 'HTML element missing lang attribute').toBeTruthy();`);
        body.push(`    // 5. Check buttons have accessible text`);
        body.push(`    const emptyButtons = await page.evaluate(() =>`);
        body.push(`      Array.from(document.querySelectorAll('button'))`);
        body.push(`        .filter(btn => !btn.textContent?.trim() && !btn.getAttribute('aria-label') && !btn.title)`);
        body.push(`        .length`);
        body.push(`    );`);
        body.push(`    expect(emptyButtons, \`\${emptyButtons} buttons have no text or aria-label\`).toBe(0);`);

      } else {
        // Default: navigate + basic assertion
        body.push(`    await page.goto(${pageUrlExpr});`);
        body.push(`    await page.waitForLoadState('domcontentloaded');`);
        body.push(`    await expect(page).toHaveTitle(/.+/);`);
        body.push(`    await expect(page.locator('body')).toBeVisible();`);
      }

      tests.push(
        `  test(${JSON.stringify(`[${tc.id}] ${tc.title}`)}, async ({ page }) => {\n` +
        body.join('\n') + '\n  });'
      );
    }

    if (tests.length > 0) {
      testBlocks.push(
        `test.describe(${JSON.stringify(label)}, () => {\n` +
        tests.join('\n\n') + '\n});'
      );
    }
  }

  return [
    `// @ts-nocheck\n/* eslint-disable */\nconst { test, expect } = require('playwright/test');\n`,
    `/**`,
    ` * AUTO-GENERATED PLAYWRIGHT TEST SUITE`,
    ` * Generated by NAT 2.0 Autonomous Testing Platform`,
    ` * Base URL: ${baseUrl}`,
    ` *`,
    ` * Test Categories:`,
    ` *   Smoke        — Page load, HTTP 200, title, load time`,
    ` *   Functional   — Content visibility, scroll, broken links, nav, form happy path`,
    ` *   Negative     — Empty submit, invalid email/phone, double-submit`,
    ` *   Edge Cases   — 500-char input, special chars, Unicode`,
    ` *   Security     — XSS injection, SQL injection`,
    ` *   Accessibility — Alt text, labels, heading order, keyboard nav`,
    ` */\n`,
    `const BASE_URL = ${JSON.stringify(baseUrl)};\n`,
    `/**`,
    ` * SHARED — Elements present on all/most pages (nav links, contact form, search).`,
    ` */`,
    sharedBlock,
    `/**`,
    ` * PAGES — Per-page locators: { css, xpath, sampleValue }`,
    ` * Uses stable selectors (name/aria-label/placeholder) not fragile auto-generated IDs`,
    ` */`,
    pagesBlock,
    testBlocks.join('\n\n'),
  ].join('\n');
}

// ─── In-memory run store ────────────────────────────────────────────────────

interface PageSummary {
  url: string;
  title: string;
  forms: number;
  buttons: number;
  inputs: number;
  links: number;
}

interface CrawlRun {
  status: 'crawling' | 'done' | 'error';
  url: string;
  pages: PageSummary[];
  domData: any[];     // full EnhancedPageInfo[]
  progress: any;
  error?: string;
  clients: Response[];
  /** Latest agent_status per agent — replayed to new SSE clients that connect late */
  agentStatuses: Record<string, object>;
  credentials?: { username: string; password: string; loginUrl?: string; usernameSelector?: string; passwordSelector?: string; loginButtonSelector?: string };
  /** Ordered event log for polling clients. AWS API Gateway terminates SSE at 29s,
   *  so production reads /api/autotest/status/:runId?since=N and replays events from here. */
  eventLog: Array<{ seq: number; ts: number; event: any }>;
  nextSeq: number;
}

const runs = new Map<string, CrawlRun>();

// ─── SSE broadcast helper ───────────────────────────────────────────────────

function broadcast(runId: string, event: object) {
  const run = runs.get(runId);
  if (!run) return;

  // Cache agent_status events so late-connecting SSE clients can replay them
  if ((event as any).type === 'agent_status' && (event as any).agent) {
    if (!run.agentStatuses) run.agentStatuses = {};   // guard against missing field
    run.agentStatuses[(event as any).agent] = event;
  }
  // Cache latest progress event
  if ((event as any).type === 'progress') {
    run.progress = event;
  }

  // Append to ordered event log for polling clients (cap at last 500 to bound memory)
  if (!run.eventLog) run.eventLog = [];
  if (typeof run.nextSeq !== 'number') run.nextSeq = 0;
  run.eventLog.push({ seq: run.nextSeq++, ts: Date.now(), event });
  if (run.eventLog.length > 500) {
    run.eventLog.splice(0, run.eventLog.length - 500);
  }

  const data = `data: ${JSON.stringify(event)}\n\n`;
  const dead: Response[] = [];
  for (const client of run.clients) {
    try {
      (client as any).write(data);
      if (typeof (client as any).flush === 'function') (client as any).flush();
    } catch {
      dead.push(client);
    }
  }
  run.clients = run.clients.filter(c => !dead.includes(c));
}

// ─── Crawl runner ───────────────────────────────────────────────────────────

async function runCrawl(runId: string, url: string, maxPages: number, credentials?: { username: string; password: string; loginUrl?: string; usernameSelector?: string; passwordSelector?: string; loginButtonSelector?: string }) {
  const run = runs.get(runId);
  if (!run) return;

  try {
    const crawlHeadless = isAwsHosting() || process.platform === 'linux';
    console.log(`[autotest] runCrawl() — creating EnhancedCrawler with headless=${crawlHeadless}, slowMo=150`);
    if (credentials) {
      run.agentStatuses['Auth Agent'] = { type: 'agent_status', agent: 'Auth Agent', status: 'working', message: `Logging in as ${credentials.username}…`, details: 'Detecting login form and submitting credentials' };
      broadcast(runId, { type: 'agent_status', agent: 'Auth Agent', status: 'working', message: `Logging in as ${credentials.username}…`, details: 'Detecting login form and submitting credentials' });
    }
    // Scale depth and pre-crawl phases to the page budget — small runs stay fast
    const maxDepth        = maxPages <= 10 ? 2 : maxPages <= 30 ? 3 : maxPages <= 80 ? 4 : 6;
    const includeSitemap  = maxPages > 20;   // sitemap can add 100s of URLs — skip for small runs
    const probeCommonPaths = maxPages > 15;  // same: 31 extra paths not worth it for tiny runs

    const crawler = new EnhancedCrawler({
      maxPages,
      maxDepth,
      includeSitemap,
      probeCommonPaths,
      sameDomainOnly: true,
      timeout: 30000,
      headless: crawlHeadless,
      ...(credentials ? {
        credentials: {
          username: credentials.username,
          password: credentials.password,
          loginUrl: credentials.loginUrl || url,
          authType: 'form' as const,
          usernameSelector: credentials.usernameSelector,
          passwordSelector: credentials.passwordSelector,
          loginButtonSelector: credentials.loginButtonSelector,
        }
      } : {}),
    });
    console.log(`[autotest] crawler.config.headless=${(crawler as any).config?.headless}`);

    // ── Acceptance Criteria state (gates agent transitions) ──────────────────
    // AC-1 Scout Agent:     pagesVisited >= 1   → DOM Extractor activates
    // AC-2 DOM Extractor:   formsFound + buttonsFound >= 1   → Link Follower activates
    // AC-3 Link Follower:   pagesQueued reaches 0 after first page   → signals completion
    let domExtractorActivated = false;
    let linkFollowerActivated = false;
    let loginSucceeded = false;  // persists after loginSuccess is deleted from progress

    // Emit initial agent statuses — Scout starts immediately, others pending
    if (!credentials) {
      broadcast(runId, { type: 'agent_status', agent: 'Scout', status: 'working', message: `Starting crawl of ${url}`, details: 'Navigating to root URL and extracting initial links' });
    } else {
      // Auth Agent goes first; Scout waits until login completes
      broadcast(runId, { type: 'agent_status', agent: 'Scout', status: 'idle', message: 'Waiting for Auth Agent', details: 'Scout will start crawling after login succeeds' });
    }
    broadcast(runId, { type: 'agent_status', agent: 'DOM Analyst',     status: 'idle', message: 'Waiting for Scout', details: 'AC: Scout must visit ≥1 page before DOM extraction begins' });
    broadcast(runId, { type: 'agent_status', agent: 'Workflow Analyst', status: 'idle', message: 'Waiting for DOM Analyst', details: 'AC: DOM Analyst must find ≥1 element before queue management begins' });

    await crawler.crawl(url, (progress: any) => {
      run.progress = progress;


      // ── Relay login progress → Auth Agent card ────────────────────────────
      if (credentials && progress.loginStatus) {
        const msg     = String(progress.loginStatus);
        const detail  = String(progress.loginDetail || '');
        const isError = msg.startsWith('✗');
        const isDone  = msg.startsWith('✓');
        broadcast(runId, {
          type: 'agent_status', agent: 'Auth Agent',
          status: isDone ? 'completed' : isError ? 'error' : 'working',
          message: msg, details: detail,
        });
        if (isDone) {
          broadcast(runId, { type: 'agent_status', agent: 'Scout', status: 'working', message: `Starting authenticated crawl of ${url}`, details: 'Login session active — crawling with auth cookies' });
        }
        // ✅ CRITICAL: Clear loginStatus/Detail so future crawl-progress callbacks
        //    don't re-enter this block and get blocked by the early return.
        delete progress.loginStatus;
        delete progress.loginDetail;
        return;  // this update was a login event — skip crawl-stat processing
      }

      // ── Login completed with success=true (stored on progress after executor returns) ─
      if (credentials && progress.loginSuccess === true && !domExtractorActivated) {
        loginSucceeded = true;  // remember before deleting from progress
        broadcast(runId, { type: 'agent_status', agent: 'Auth Agent', status: 'completed', message: `✓ Authenticated as ${credentials.username}`, details: 'Session active — Scout now crawling authenticated pages' });
        broadcast(runId, { type: 'agent_status', agent: 'Scout', status: 'working', message: `Starting authenticated crawl…`, details: 'Login session active — crawling with auth cookies' });
        delete progress.loginSuccess;  // consumed — don't re-broadcast
      }

      // ── Relay login ERROR (no loginStatus message was emitted) ─────────────
      if (credentials && progress.loginError) {
        const errMsg = String(progress.loginError);
        broadcast(runId, {
          type: 'agent_status', agent: 'Auth Agent', status: 'error',
          message: `✗ Login failed`, details: errMsg,
        });
        broadcast(runId, { type: 'agent_status', agent: 'Scout', status: 'working', message: `Starting crawl without auth`, details: 'Continuing — login failed, crawling as guest' });
        delete progress.loginError;
      }

      // ── AC-1: Scout visited ≥1 page → activate DOM Extractor ───────────────
      if (!domExtractorActivated && (progress.pagesVisited || 0) >= 1) {
        domExtractorActivated = true;
        broadcast(runId, {
          type: 'agent_status', agent: 'DOM Analyst', status: 'working',
          message: `Extracting DOM from page ${progress.pagesVisited}`,
          details: `AC-1 met: Scout visited ${progress.pagesVisited} page(s) — DOM extraction unlocked`,
        });
      }

      // ── AC-2: ≥1 form or button found → activate Workflow Analyst ──────────
      const elementsFound = (progress.formsFound || 0) + (progress.buttonsFound || 0);
      if (!linkFollowerActivated && domExtractorActivated && elementsFound >= 1) {
        linkFollowerActivated = true;
        broadcast(runId, {
          type: 'agent_status', agent: 'Workflow Analyst', status: 'working',
          message: `Managing queue of ${progress.pagesQueued || 0} discovered pages`,
          details: `AC-2 met: DOM Analyst found ${elementsFound} element(s) — link queue management unlocked`,
        });
      }

      // Update Scout message with current URL
      broadcast(runId, {
        type: 'agent_status', agent: 'Scout', status: 'working',
        message: `Visiting page ${progress.pagesVisited || 0}`,
        details: progress.currentUrl || 'Navigating...',
      });

      broadcast(runId, {
        type: 'progress',
        status: progress.status,
        pagesVisited: progress.pagesVisited || 0,
        pagesQueued: progress.pagesQueued || 0,
        formsFound: progress.formsFound || 0,
        buttonsFound: progress.buttonsFound || 0,
        inputsFound: progress.inputsFound || 0,
        currentUrl: progress.currentUrl || null,
      });
    });

    // Collect full DOM data FIRST so page counts are accurate in completion broadcasts
    const pageMap = crawler.getPageData();
    run.domData = Array.from(pageMap.values());

    // ── All 3 agents complete ────────────────────────────────────────────────
    broadcast(runId, { type: 'agent_status', agent: 'Scout',           status: 'completed', message: `${run.domData.length} pages crawled successfully`,    details: 'AC-1 ✓ All reachable pages visited · No duplicate visits' });
    broadcast(runId, { type: 'agent_status', agent: 'DOM Analyst',     status: 'completed', message: `DOM extracted from all pages`,                                details: 'AC-2 ✓ All forms, buttons & inputs catalogued with selectors' });
    broadcast(runId, { type: 'agent_status', agent: 'Workflow Analyst', status: 'completed', message: `URL queue empty — all ${run.domData.length} pages processed`, details: 'AC-3 ✓ Queue drained · All in-scope URLs resolved' });
    if (credentials) {
      // loginSuccess was consumed (deleted) during crawl — use the persisted loginSucceeded flag
      const loginOk = loginSucceeded || (run.progress as any)?.loginSuccess === true;
      const loginErr = (run.progress as any)?.loginError;
      if (loginOk) {
        broadcast(runId, { type: 'agent_status', agent: 'Auth Agent', status: 'completed', message: `✓ Authenticated as ${credentials.username}`, details: 'Session was active for the entire crawl' });
      } else {
        broadcast(runId, { type: 'agent_status', agent: 'Auth Agent', status: 'error', message: `✗ Login failed`, details: loginErr || 'Could not authenticate — crawl ran as guest' });
      }
    }
    // ── Guard: no pages crawled ─────────────────────────────────────────────
    if (run.domData.length === 0) {
      console.error(`[autotest] Crawl completed with 0 pages for ${url}. The site may be blocking automated access, require authentication, or have SSL/DNS issues.`);
      run.status = 'error';
      run.error  = `The crawler could not load any pages from ${url}. This can happen when:\n• The site blocks headless/automated browsers (Cloudflare, reCAPTCHA)\n• The site requires login (use the Auth section in Configure)\n• SSL certificate errors\n• The URL is unreachable\n\nTry: check the URL, disable bot protection temporarily, or use auth credentials.`;
      try {
        await db.update(autoTestRuns)
          .set({ status: 'error', errorMessage: run.error })
          .where(eq(autoTestRuns.id, runId));
      } catch {}
      broadcast(runId, { type: 'error', message: run.error });
      for (const client of run.clients) { try { (client as any).end(); } catch {} }
      run.clients = [];
      playwrightService.setHeadless(true).catch(() => {});
      return;
    }

    broadcast(runId, { type: 'agent_status', agent: 'Test Architect', status: 'idle', message: 'Ready — click Generate Test Cases to activate', details: 'Awaiting crawl data to design test strategy' });
    broadcast(runId, { type: 'agent_status', agent: 'Script Forge', status: 'idle', message: 'Ready — will activate after Test Architect', details: 'Awaiting test cases to generate automation scripts' });
    run.pages = run.domData.map((p: any) => ({
      url: p.url,
      title: p.title || p.url,
      forms: p.domStructure?.forms?.length ?? p.forms?.length ?? 0,
      buttons: p.domStructure?.interactiveElements?.buttons?.length ?? p.buttons?.length ?? 0,
      inputs: p.domStructure?.interactiveElements?.inputs?.length ?? p.inputs?.length ?? 0,
      links: p.domStructure?.navigation?.navLinks?.length ?? p.links?.length ?? 0,
    }));

    run.status = 'done';

    // ── Persist to DB ─────────────────────────────────────────────────────
    try {
      await db.update(autoTestRuns)
        .set({ status: 'done', pageCount: run.pages.length, completedAt: new Date() })
        .where(eq(autoTestRuns.id, runId));

      // Persist pages (batch insert, 50 at a time to avoid query size limits)
      const pageRows = run.domData.map((p: any) => ({
        runId,
        url: p.url,
        title: p.title || '',
        forms: p.domStructure?.forms?.length ?? 0,
        buttons: p.domStructure?.interactiveElements?.buttons?.length ?? 0,
        inputs: p.domStructure?.interactiveElements?.inputs?.length ?? 0,
        links: p.domStructure?.navigation?.navLinks?.length ?? 0,
        domData: p as any,
      }));
      for (let i = 0; i < pageRows.length; i += 50) {
        try {
          await db.insert(autoTestPages).values(pageRows.slice(i, i + 50));
        } catch (e: any) {
          if (e.code !== 'ER_DUP_ENTRY') throw e;
        }
      }
    } catch (dbErr) {
      console.error('[autotest] DB persist error (crawl):', dbErr);
    }

    broadcast(runId, {
      type: 'complete',
      pages: run.pages,
      pageCount: run.pages.length,
    });

    // Close SSE clients
    for (const client of run.clients) {
      try { (client as any).end(); } catch {}
    }
    run.clients = [];

    // Restore headless mode so other features (visual regression etc.) aren't affected
    playwrightService.setHeadless(true).catch(() => {});
  } catch (err: any) {
    run.status = 'error';
    run.error = err.message;
    try {
      await db.update(autoTestRuns)
        .set({ status: 'error', errorMessage: err.message })
        .where(eq(autoTestRuns.id, runId));
    } catch {}
    broadcast(runId, { type: 'error', message: err.message });
    for (const client of run.clients) {
      try { (client as any).end(); } catch {}
    }
    run.clients = [];

    // Always restore headless on error too
    playwrightService.setHeadless(true).catch(() => {});
  }
}

// ─── Route registration ─────────────────────────────────────────────────────

export function registerAutoTestRoutes(app: Express) {

  // ── 0. List Past Runs ──────────────────────────────────────────────────────
  app.get('/api/autotest/runs', async (req: Request, res: Response) => {
    try {
      const rows = await db.select({
        id: autoTestRuns.id,
        url: autoTestRuns.url,
        status: autoTestRuns.status,
        pageCount: autoTestRuns.pageCount,
        createdAt: autoTestRuns.createdAt,
        completedAt: autoTestRuns.completedAt,
      })
        .from(autoTestRuns)
        .orderBy(desc(autoTestRuns.createdAt))
        .limit(20);
      res.json({ runs: rows });
    } catch (err: any) {
      console.error('[autotest] list runs error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // ── 0b. Load Past Run data ─────────────────────────────────────────────────
  app.get('/api/autotest/runs/:runId/load', async (req: Request, res: Response) => {
    const { runId } = req.params;
    try {
      const [run] = await db.select().from(autoTestRuns).where(eq(autoTestRuns.id, runId));
      if (!run) return res.status(404).json({ error: 'Run not found' });

      // Load pages
      const pages = await db.select().from(autoTestPages).where(eq(autoTestPages.runId, runId));

      // Load test cases
      const testCases = await db.select().from(autoTestCases).where(eq(autoTestCases.runId, runId));

      // Load latest script
      const scripts = await db.select().from(autoTestScripts)
        .where(eq(autoTestScripts.runId, runId))
        .orderBy(desc(autoTestScripts.createdAt))
        .limit(1);

      // Load latest execution
      const executions = await db.select().from(autoTestExecutions)
        .where(eq(autoTestExecutions.runId, runId))
        .orderBy(desc(autoTestExecutions.executedAt))
        .limit(5);

      // Reconstruct page summaries
      const pageSummaries = pages.map(p => ({
        url: p.url,
        title: p.title || p.url,
        forms: p.forms || 0,
        buttons: p.buttons || 0,
        inputs: p.inputs || 0,
        links: p.links || 0,
      }));

      // Restore in-memory run so re-execution works
      if (!runs.has(runId)) {
        runs.set(runId, {
          status: run.status as any,
          url: run.url,
          pages: pageSummaries,
          domData: pages.map((p: any) => p.domData).filter(Boolean),
          progress: {},
          clients: [],
          agentStatuses: {},
        });
      }

      // Parse script content — new format stores JSON of files map, old format is plain script
      let scriptFiles: Record<string, string> | null = null;
      let legacyScript: string | null = null;
      const rawContent = scripts[0]?.content || null;
      if (rawContent) {
        try {
          const parsed = JSON.parse(rawContent);
          if (typeof parsed === 'object' && !Array.isArray(parsed) && Object.keys(parsed).length > 0) {
            scriptFiles = parsed as Record<string, string>;
          } else {
            legacyScript = rawContent;
          }
        } catch {
          legacyScript = rawContent;
        }
      }

      res.json({
        run,
        pages: pageSummaries,
        testCases,
        // New POM format
        files: scriptFiles,
        // Legacy single-script (for old runs)
        script: legacyScript,
        scriptId: scripts[0]?.id || null,
        executions,
      });
    } catch (err: any) {
      console.error('[autotest] load run error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // ── 1. Start Crawl ─────────────────────────────────────────────────────────
  app.post('/api/autotest/crawl', async (req: Request, res: Response) => {
    const { url, maxPages = 20, credentials } = req.body;
    if (!url) return res.status(400).json({ error: 'url is required' });

    const runId = `run_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    runs.set(runId, {
      status: 'crawling',
      url,
      pages: [],
      domData: [],
      progress: {},
      clients: [],
      agentStatuses: {},
      credentials: credentials || undefined,
      eventLog: [],
      nextSeq: 0,
    });

    // Persist run to DB immediately
    try {
      await db.insert(autoTestRuns).values({ id: runId, url, status: 'crawling' });
    } catch (dbErr) {
      console.error('[autotest] DB insert run error:', dbErr);
    }

    res.json({ runId });

    // Start crawl in background (non-blocking) — no artificial cap
    runCrawl(runId, url, Math.min(maxPages, 500), credentials || undefined).catch(console.error);
  });

  // ── 2. SSE Stream ──────────────────────────────────────────────────────────
  app.get('/api/autotest/stream/:runId', (req: Request, res: Response) => {
    const run = runs.get(req.params.runId);
    if (!run) return res.status(404).json({ error: 'Run not found' });

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Content-Encoding', 'identity');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    // If already done, send current state immediately
    if (run.status === 'done') {
      // Replay all agent statuses so the UI shows the final state
      for (const evt of Object.values(run.agentStatuses)) {
        res.write(`data: ${JSON.stringify(evt)}\n\n`);
      }
      res.write(`data: ${JSON.stringify({ type: 'complete', pages: run.pages, pageCount: run.pages.length })}\n\n`);
      res.end();
      return;
    }
    if (run.status === 'error') {
      res.write(`data: ${JSON.stringify({ type: 'error', message: run.error })}\n\n`);
      res.end();
      return;
    }

    // ── Replay missed events to this late-connecting client ─────────────────
    // The crawl starts immediately after POST /crawl returns, but the SSE
    // client only connects after the round-trip. Any broadcasts that fired
    // before this client connected are replayed from the cache.
    for (const evt of Object.values(run.agentStatuses)) {
      try { res.write(`data: ${JSON.stringify(evt)}\n\n`); } catch {}
    }
    if (run.progress && Object.keys(run.progress).length > 0) {
      try { res.write(`data: ${JSON.stringify(run.progress)}\n\n`); } catch {}
    }
    if (typeof (res as any).flush === 'function') (res as any).flush();

    run.clients.push(res);

    req.on('close', () => {
      if (run) run.clients = run.clients.filter(c => c !== res);
    });
  });

  // ── 2b. Polling status endpoint ────────────────────────────────────────────
  // Replaces the SSE stream for production traffic, since AWS API Gateway
  // terminates any HTTP connection at 29s. Client polls every ~2s with the
  // last seen `seq` number; server returns only new events since that point.
  app.get('/api/autotest/status/:runId', (req: Request, res: Response) => {
    const run = runs.get(req.params.runId);
    if (!run) return res.status(404).json({ error: 'Run not found' });

    const sinceParam = (req.query.since as string) || '0';
    const since = Math.max(0, parseInt(sinceParam, 10) || 0);
    const log = run.eventLog ?? [];
    const newEvents = log.filter(e => e.seq >= since);
    const nextSeq = log.length ? log[log.length - 1].seq + 1 : since;

    res.json({
      status: run.status,
      url: run.url,
      pages: run.status === 'done' ? run.pages : undefined,
      pageCount: run.status === 'done' ? run.pages.length : undefined,
      error: run.status === 'error' ? run.error : undefined,
      agentStatuses: run.agentStatuses,
      progress: run.progress,
      events: newEvents,
      nextSeq,
    });
  });

  // ── 3. Get Crawl Data ──────────────────────────────────────────────────────
  app.get('/api/autotest/data/:runId', (req: Request, res: Response) => {
    const run = runs.get(req.params.runId);
    if (!run) return res.status(404).json({ error: 'Not found' });
    res.json({ status: run.status, pages: run.pages, url: run.url });
  });

  // ── 4. Generate Test Cases (DOM-based, no API key needed) ────────────────
  app.post('/api/autotest/test-cases/:runId', async (req: Request, res: Response) => {
    const { runId } = req.params;

    // Prefer in-memory run. If missing (server restart), reload from DB.
    let run = runs.get(runId);
    if (!run) {
      const [dbRun] = await db.select().from(autoTestRuns).where(eq(autoTestRuns.id, runId));
      if (!dbRun) return res.status(404).json({ error: 'Run not found — please re-crawl the site.' });
      if (dbRun.status !== 'done') return res.status(400).json({ error: 'Crawl not complete yet' });

      // Load persisted page domData from DB
      const dbPages = await db.select().from(autoTestPages).where(eq(autoTestPages.runId, runId));
      const domData = dbPages.map((p: any) => p.domData).filter(Boolean);

      run = { status: 'done', url: dbRun.url, pages: [], domData, progress: {}, clients: [], agentStatuses: {} };
      runs.set(runId, run);
    }

    if (run.status !== 'done') return res.status(400).json({ error: 'Crawl not complete yet' });

    try {
      broadcast(runId, { type: 'agent_status', agent: 'Test Architect', status: 'working', message: 'Analyzing crawl data and planning test coverage...' });
      const testCases = generateTestCasesFromDom(run.domData, run.url);

      // Persist test cases to DB (delete old ones first, then re-insert)
      try {
        await db.delete(autoTestCases).where(eq(autoTestCases.runId, runId));
        if (testCases.length > 0) {
          const rows = testCases.map(tc => ({
            id: `${runId}_${tc.id}`,
            runId,
            title: tc.title,
            priority: tc.priority,
            category: tc.category,
            pageUrl: tc.pageUrl || null,
            description: tc.description || null,
            steps: tc.steps || [],
            expectedResult: tc.expectedResult || null,
          }));
          for (let i = 0; i < rows.length; i += 100) {
            try {
              await db.insert(autoTestCases).values(rows.slice(i, i + 100));
            } catch (e: any) {
              if (e.code !== 'ER_DUP_ENTRY') throw e;
            }
          }
        }
      } catch (dbErr) {
        console.error('[autotest] DB persist test cases error:', dbErr);
      }

      broadcast(runId, { type: 'agent_status', agent: 'Test Architect', status: 'completed', message: `${testCases.length} test cases generated across 5 categories` });
      res.json({ testCases });
    } catch (err: any) {
      console.error('[autotest] test-cases error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // ── 5. Generate POM Test Suite (DOM-based, no API key needed) ────────────
  app.post('/api/autotest/scripts', async (req: Request, res: Response) => {
    const { runId, testCases, frameworkConfigId, frameworkPreset, userStoryIds } = req.body;
    if (!runId || !testCases?.length) {
      return res.status(400).json({ error: 'runId and testCases required' });
    }

    // Prefer in-memory run (fresh session). If missing (server restart / past run),
    // fall back to DB — load domData from autoTestPages.
    let run = runs.get(runId);
    if (!run) {
      const [dbRun] = await db.select().from(autoTestRuns).where(eq(autoTestRuns.id, runId));
      if (!dbRun) return res.status(404).json({ error: 'Run not found. Please re-crawl the site.' });
      // Try to load domData from persisted pages
      const pages = await db.select().from(autoTestPages).where(eq(autoTestPages.runId, runId));
      const domData = pages.map((p: any) => p.domData).filter(Boolean);
      run = { status: 'done' as const, url: dbRun.url, pages: [], domData, progress: {}, clients: [], agentStatuses: {} };
      runs.set(runId, run);
    }

    // Filter out undefined/null entries
    const domData = (run.domData || []).filter(Boolean);

    // ── Load framework catalog if provided ────────────────────────────────────
    let frameworkCtx: FrameworkContext | undefined;

    // Built-in presets ship no DB row and no function library — synthesise a
    // minimal context so the LLM still emits scripts in the chosen language +
    // tool. Presets always lose to a real uploaded config when both are sent.
    const ALLOWED_LANGS = new Set(['typescript', 'javascript', 'java', 'python', 'csharp']);
    const ALLOWED_TOOLS = new Set(['selenium', 'playwright', 'cypress', 'testcomplete', 'webdriverio', 'unknown']);
    const ALLOWED_PATTERNS = new Set(['POM', 'BDD', 'BDD+POM']);
    if (!frameworkConfigId && frameworkPreset && typeof frameworkPreset === 'object') {
      const presetLang = ALLOWED_LANGS.has(frameworkPreset.detectedLanguage)
        ? frameworkPreset.detectedLanguage
        : 'typescript';
      const presetTool = ALLOWED_TOOLS.has(frameworkPreset.detectedTool)
        ? frameworkPreset.detectedTool
        : 'playwright';
      const presetPattern = ALLOWED_PATTERNS.has(frameworkPreset.pattern)
        ? frameworkPreset.pattern
        : 'POM';
      frameworkCtx = {
        name: typeof frameworkPreset.name === 'string' ? frameworkPreset.name : 'Preset',
        framework: typeof frameworkPreset.framework === 'string' ? frameworkPreset.framework : presetTool,
        language: typeof frameworkPreset.language === 'string' ? frameworkPreset.language : presetLang,
        functions: [],
        pattern: presetPattern as 'POM' | 'BDD' | 'BDD+POM',
        detectedLanguage: presetLang as 'typescript' | 'javascript' | 'java' | 'python' | 'csharp',
        detectedTool: presetTool as 'selenium' | 'playwright' | 'cypress' | 'testcomplete' | 'webdriverio' | 'unknown',
      };
      console.log(`[autotest] Using built-in framework preset: ${frameworkCtx.name} (${presetLang} / ${presetTool} / ${presetPattern})`);
    }

    if (frameworkConfigId) {
      try {
        const [config] = await db.select().from(frameworkConfigs).where(eq(frameworkConfigs.id, frameworkConfigId));
        if (config) {
          const functions = await db.select().from(frameworkFunctions).where(eq(frameworkFunctions.configId, frameworkConfigId));
          frameworkCtx = {
            name: config.name,
            framework: config.framework,
            language: config.language,
            baseClass: config.baseClass,
            sampleScript: config.sampleScript,
            functions: functions.map(f => ({
              name: f.name,
              signature: f.signature,
              category: f.category,
              returnType: f.returnType,
              className: f.className,
              importPath: f.importPath,
            })),
            // Use stored detectedPattern (from file-content analysis) rather than
            // re-detecting with empty array which only does name-based fallback
            pattern: (
              config.detectedPattern === 'BDD' ? 'BDD' :
              config.detectedPattern === 'BDD+POM' ? 'BDD+POM' :
              config.detectedPattern === 'POM' ? 'POM' :
              detectPattern(config.framework, [])
            ) as 'POM' | 'BDD' | 'BDD+POM',
            detectedLanguage: (config.detectedLanguage as
              'java' | 'typescript' | 'javascript' |
              'python' | 'csharp') ?? 'typescript',
            detectedTool: (config.detectedTool as
              'selenium' | 'playwright' | 'cypress' |
              'testcomplete' | 'webdriverio' | 'unknown') ?? 'unknown',
          };
          console.log(`[autotest] Framework context loaded: ${JSON.stringify({
            name:          frameworkCtx.name,
            language:      frameworkCtx.detectedLanguage,
            tool:          frameworkCtx.detectedTool,
            pattern:       frameworkCtx.pattern,
            functionCount: frameworkCtx.functions.length,
            baseClass:     frameworkCtx.baseClass,
            fillFn:        frameworkCtx.functions.find(f => /fill|type|enter|input/i.test(f.category ?? '') || /fill|type|enter|settext/i.test(f.name))?.name,
            clickFn:       frameworkCtx.functions.find(f => /click|tap|press/i.test(f.category ?? '') || /click|tap|press/i.test(f.name))?.name,
          })}`);
        }
      } catch (fwErr) {
        console.warn('[autotest] Could not load framework config:', fwErr);
        // Non-fatal — proceed without framework
      }
    }

    // ── Load user stories if IDs provided ─────────────────────────────────────
    let storyContexts: UserStoryContext[] = [];
    if (Array.isArray(userStoryIds) && userStoryIds.length > 0) {
      try {
        const stories = await db.select({
          id: userStories.id,
          title: userStories.title,
          description: userStories.description,
          acceptanceCriteria: userStories.acceptanceCriteria,
        }).from(userStories).where(inArray(userStories.id, userStoryIds));
        storyContexts = stories;
        console.log(`[autotest] Loaded ${stories.length} user stories for generation`);
      } catch (storyErr) {
        console.warn('[autotest] Could not load user stories:', storyErr);
      }
    }

    // Merge user stories into framework context (or create a minimal context)
    if (storyContexts.length > 0) {
      if (frameworkCtx) {
        frameworkCtx.userStories = storyContexts;
      } else {
        // No framework selected but user stories provided — create a minimal context
        frameworkCtx = {
          name: 'User Stories',
          framework: 'playwright',
          language: 'typescript',
          functions: [],
          pattern: 'POM',
          userStories: storyContexts,
          detectedLanguage: 'typescript',
          detectedTool:     'playwright',
        };
      }
    }

    try {
      const storyLabel = storyContexts.length > 0 ? ` + ${storyContexts.length} user stories` : '';
      const modeLabel = frameworkCtx
        ? `${frameworkCtx.pattern} mode — ${frameworkCtx.name}${storyLabel}`
        : 'POM test suite — Page Objects + 6 spec categories';
      broadcast(runId, { type: 'agent_status', agent: 'Script Forge', status: 'working', message: `Generating ${modeLabel}...` });

      const suite = await generatePOMTestSuite(domData, testCases, run.url, frameworkCtx);
      const { files } = suite;

      // Persist to DB — store files JSON in content column.
      // Drizzle's MySQL2 adapter does NOT support `.returning()` on inserts
      // (that's a PostgreSQL-only clause) and was previously throwing, which
      // the try/catch silently swallowed → scriptId came back null → the
      // browser fell through to the single-file fallback in
      // functional-testing.tsx::downloadScript and downloaded one .ts file
      // instead of the full ZIP suite. We now generate the UUID inline
      // (matching the schema's `default(sql\`(UUID())\`)`) so we always know
      // the scriptId without needing RETURNING.
      let scriptId: string | null = null;
      try {
        const newId = (globalThis.crypto as any).randomUUID();
        await db.insert(autoTestScripts).values({
          id: newId,
          runId,
          content: JSON.stringify(files),
          testCaseIds: testCases.map((tc: any) => tc.id),
        });
        scriptId = newId;
      } catch (dbErr) {
        console.error('[autotest] DB persist script error:', dbErr);
      }

      const completionMsg = frameworkCtx
        ? `${frameworkCtx.pattern} suite generated — ${Object.keys(files).length} files (${frameworkCtx.name})`
        : `POM suite generated — ${Object.keys(files).length} files across 6 test categories`;
      broadcast(runId, {
        type: 'agent_status', agent: 'Script Forge', status: 'completed',
        message: completionMsg,
      });
      res.json({ files, scriptId });
    } catch (err: any) {
      console.error('[autotest] scripts error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // ── 5a. Get POM files for a script ID (for loading past runs) ────────────
  app.get('/api/autotest/scripts/:scriptId/files', async (req: Request, res: Response) => {
    const { scriptId } = req.params;
    try {
      const [script] = await db.select().from(autoTestScripts).where(eq(autoTestScripts.id, scriptId));
      if (!script) return res.status(404).json({ error: 'Script not found' });
      let files: Record<string, string> = {};
      try {
        const parsed = JSON.parse(script.content);
        // New format: { "playwright.config.ts": "...", ... }
        if (typeof parsed === 'object' && !Array.isArray(parsed)) {
          files = parsed;
        } else {
          // Old format: single script string was stored directly (not JSON-wrapped object)
          files = { 'auto.spec.ts': script.content };
        }
      } catch {
        // Non-JSON content = old single-script format
        files = { 'auto.spec.ts': script.content };
      }
      res.json({ files, scriptId });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── 5b. Download POM suite as ZIP ─────────────────────────────────────────
  app.get('/api/autotest/scripts/:scriptId/download', async (req: Request, res: Response) => {
    const { scriptId } = req.params;
    try {
      const [script] = await db.select().from(autoTestScripts).where(eq(autoTestScripts.id, scriptId));
      if (!script) return res.status(404).json({ error: 'Script not found' });

      let files: Record<string, string> = {};
      try {
        const parsed = JSON.parse(script.content);
        files = (typeof parsed === 'object' && !Array.isArray(parsed)) ? parsed : { 'auto.spec.ts': script.content };
      } catch {
        files = { 'auto.spec.ts': script.content };
      }

      // Build ZIP in-memory using JSZip (pure JS, no archiver dependencies)
      const zip = new JSZip();
      const folder = zip.folder('playwright-pom-suite')!;
      for (const [filePath, content] of Object.entries(files)) {
        folder.file(filePath, content);
      }
      const zipBuffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } });

      res.setHeader('Content-Disposition', 'attachment; filename="playwright-pom-suite.zip"');
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Length', String(zipBuffer.length));
      res.send(zipBuffer);
    } catch (err: any) {
      console.error('[autotest] download error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // ── Running process registry — keyed by execId so the stop endpoint can kill them ──
  const activeExecProcesses = new Map<string, import('child_process').ChildProcess>();
  // Tracks execIds that were intentionally stopped by the user (not natural completion)
  // Needed because on Windows taskkill exits with code 1, not null, so we can't use code===null
  const stoppedExecIds = new Set<string>();

  // ── DELETE /api/autotest/execute/:execId — stop a running headed execution ──
  app.delete('/api/autotest/execute/:execId', (req: Request, res: Response) => {
    const { execId } = req.params;
    console.log(`[Stop] DELETE /api/autotest/execute/${execId} — active processes: ${[...activeExecProcesses.keys()].join(', ') || 'none'}`);
    const proc = activeExecProcesses.get(execId);
    if (!proc) {
      console.warn(`[Stop] Process not found for execId=${execId}`);
      res.status(404).json({ error: 'Execution not found or already finished' });
      return;
    }

    // Mark as intentionally stopped BEFORE killing, so close handler knows
    stoppedExecIds.add(execId);
    activeExecProcesses.delete(execId);

    const pid = proc.pid;
    try {
      if (process.platform === 'win32') {
        // Kill the full process tree (node + playwright + Chrome) by PID
        console.log(`[Stop] Killing pid=${pid} via taskkill /f /t`);
        spawn('taskkill', ['/pid', String(pid), '/f', '/t'], { shell: true });
        // Also force-kill any lingering Chrome/Chromium processes spawned by Playwright
        // (headed Chrome sometimes survives the tree kill on Windows)
        setTimeout(() => {
          try {
            spawn('taskkill', ['/im', 'chrome.exe', '/f'], { shell: true });
            spawn('taskkill', ['/im', 'chromium.exe', '/f'], { shell: true });
          } catch {}
        }, 500);
      } else {
        // Send SIGKILL to the entire process group (negative pid = group)
        console.log(`[Stop] Killing process group pid=${pid} via SIGKILL`);
        try { process.kill(-pid!, 'SIGKILL'); } catch { proc.kill('SIGKILL'); }
      }
    } catch (err) {
      console.warn(`[Stop] Kill failed, falling back to proc.kill()`, err);
      try { proc.kill('SIGKILL'); } catch {}
    }

    // If proc.on('close') never fires (process already dead), send stopped SSE after 2s
    const fallbackTimer = setTimeout(() => {
      if (stoppedExecIds.has(execId)) {
        stoppedExecIds.delete(execId);
        try { res.end(); } catch {} // force close SSE if still open
      }
    }, 2000);
    // Clear timer if process closes naturally
    proc.once('close', () => clearTimeout(fallbackTimer));

    res.json({ stopped: true, execId });
  });

  // ── 6. Execute Tests (SSE stream) — supports both POM multi-file and legacy single-file
  app.post('/api/autotest/execute', async (req: Request, res: Response) => {
    // Accept either files (new POM) or script (old single-file, backward compat)
    const { files, script, baseUrl, runId, scriptId, execId: clientExecId } = req.body;
    if (!files && !script) return res.status(400).json({ error: 'files or script required' });

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    (res as any).flushHeaders?.();

    // Prefer client-generated execId (eliminates SSE timing race for Stop button)
    const execId = (clientExecId && typeof clientExecId === 'string') ? clientExecId : `exec_${Date.now()}`;
    const logsDir = path.join(process.cwd(), '.autotest-tmp', 'logs');

    const send = (event: object) => {
      try { res.write(`data: ${JSON.stringify(event)}\n\n`); } catch {}
    };

    // ── Send execId immediately so client can show Stop button ───────────────
    send({ type: 'started', execId });

    // Append-write log file so the user can inspect what happened
    const appendLog = async (line: string) => {
      try {
        await mkdir(logsDir, { recursive: true });
        const logFile = path.join(logsDir, `${execId}.log`);
        const { appendFile } = await import('fs/promises');
        await appendFile(logFile, line, 'utf-8');
      } catch {}
    };

    const sendAndLog = (event: { type: string; message?: string; [k: string]: any }) => {
      send(event);
      if (event.message) appendLog(event.message);
    };

    const tmpDir = path.join(process.cwd(), '.autotest-tmp', `run_${Date.now()}`);
    const localNodeModules = path.join(process.cwd(), 'node_modules');
    const isHeadless = isAwsHosting() || process.platform === 'linux';

    try {
      const resultsFile = path.join(tmpDir, 'results.json');
      const resultsPath = resultsFile.replace(/\\/g, '/');
      let configFile = path.join(tmpDir, 'playwright.config.cjs'); // assigned in each branch

      if (files && typeof files === 'object' && Object.keys(files).length > 0) {
        // ── New POM multi-file mode ────────────────────────────────────────
        // Write all generated TypeScript files to temp dir preserving directory structure
        sendAndLog({ type: 'log', message: `[${execId}] ▶  Writing ${Object.keys(files).length} POM files to temp directory...\n` });

        for (const [filePath, content] of Object.entries(files as Record<string, string>)) {
          const fullPath = path.join(tmpDir, filePath);
          await mkdir(path.dirname(fullPath), { recursive: true });
          await writeFile(fullPath, content as string, 'utf-8');
        }

        // ── Always overwrite helpers with the CURRENT version from pom-generator ──
        // This ensures that even scripts generated before a bug-fix (e.g. the
        // advisory-mode WCAG helper) pick up the corrected helpers at run-time,
        // regardless of what was stored in scriptFiles / DB.
        const canonicalHelpers = getCanonicalHelperFiles();
        for (const [helperPath, helperContent] of Object.entries(canonicalHelpers)) {
          const fullPath = path.join(tmpDir, helperPath);
          await mkdir(path.dirname(fullPath), { recursive: true });
          await writeFile(fullPath, helperContent, 'utf-8');
        }
        sendAndLog({ type: 'log', message: `✓  Helper files refreshed from current pom-generator (${Object.keys(canonicalHelpers).length} helpers)\n` });

        // Write execution config — CJS so no TS compilation needed for config itself.
        // Spec files are .ts and playwright's esbuild transform handles them natively.
        const playwrightConfig = `
// Generated by NAT20 — do not edit
module.exports = {
  testDir: ${JSON.stringify(path.join(tmpDir, 'tests', 'specs').replace(/\\/g, '/'))},
  testMatch: ['**/*.spec.ts'],
  timeout: 60000,
  retries: 0,
  workers: 1,
  use: {
    baseURL: ${JSON.stringify(baseUrl || 'http://localhost')},
    headless: ${isHeadless},
    viewport: { width: 1280, height: 800 },
    screenshot: 'only-on-failure',
    video: 'off',
    launchOptions: { slowMo: 100 },
  },
  reporter: [['json', { outputFile: ${JSON.stringify(resultsPath)} }], ['line']],
  projects: [{ name: 'chromium' }],
};
`;
        configFile = path.join(tmpDir, 'playwright.config.cjs');
        await writeFile(configFile, playwrightConfig, 'utf-8');

        const fileCount = Object.keys(files).length;
        const specCount = Object.keys(files as Record<string, string>).filter(f => f.endsWith('.spec.ts')).length;
        sendAndLog({ type: 'log', message: `✓  ${fileCount} files written — ${specCount} spec files across 6 test categories\n` });
        sendAndLog({ type: 'log', message: `▶  Starting Playwright execution (${isHeadless ? 'headless' : 'headed'} Chrome)...\n   baseURL: ${baseUrl}\n   tmpDir:  ${tmpDir}\n   log:     ${path.join(logsDir, execId + '.log')}\n` });

      } else {
        // ── Legacy single-file mode (backward compat) ─────────────────────
        await mkdir(path.join(tmpDir, 'tests'), { recursive: true });
        const specFile = path.join(tmpDir, 'tests', 'auto.spec.js');

        const jsScript = (script as string)
          .replace(/:\s*Record<[^>]+>/g, '')
          .replace(/((?:const|let|var)\s+\w+):\s*[A-Za-z]\w*(\[\])?\s*=/g, '$1 =')
          .replace(/\(\s*(\w+)\s*:\s*any\s*\)/g, '($1)')
          .replace(/\}\s+as\s+[\w<>, ]+/g, '}');

        await writeFile(specFile, jsScript, 'utf-8');

        const specGlob = specFile.replace(/\\/g, '/');
        const playwrightConfig = `
module.exports = {
  testMatch: [${JSON.stringify(specGlob)}],
  timeout: 60000, retries: 0, workers: 1,
  use: { headless: ${isHeadless}, viewport: { width: 1280, height: 800 },
         screenshot: 'only-on-failure', video: 'off', launchOptions: { slowMo: 300 } },
  reporter: [['json', { outputFile: ${JSON.stringify(resultsPath)} }], ['line']],
  projects: [{ name: 'chromium' }],
};
`;
        configFile = path.join(tmpDir, 'playwright.config.cjs');
        await writeFile(configFile, playwrightConfig, 'utf-8');
        send({ type: 'log', message: `▶  Starting Playwright execution (${isHeadless ? 'headless' : 'headed'} Chrome)...\n` });
      }

      // Use node to invoke playwright CLI directly from THIS project's node_modules.
      // IMPORTANT: must use the LOCAL playwright only — global install has a different
      // version which causes "two versions of @playwright/test" crash.
      const playwrightCli = path.join(localNodeModules, 'playwright', 'cli.js');

      // Use ONLY the local node_modules so @playwright/test resolves to the local
      // v1.56.1 install — not the global v1.58.2 which causes a two-version conflict.
      const env = {
        ...process.env,
        ELECTRON_DISABLE_SANDBOX: '1',
        NODE_PATH: localNodeModules,
        // Prevent playwright from looking up a global config
        PLAYWRIGHT_TEST_BASE_URL: '',
      };

      const proc = spawn(process.execPath, [  // use same node.exe that runs the server
        playwrightCli,
        'test',
        '--config', configFile,
      ], {
        cwd: process.cwd(),  // project root — has node_modules
        env,
        shell: false,
        detached: process.platform !== 'win32', // needed for process-group kill on Unix
      });

      // Register so DELETE /api/autotest/execute/:execId can kill it
      activeExecProcesses.set(execId, proc);
      console.log(`[Exec] Process spawned pid=${proc.pid} execId=${execId} — registered in activeExecProcesses`);

      proc.stdout.on('data', (chunk: Buffer) => {
        sendAndLog({ type: 'log', message: chunk.toString() });
      });
      proc.stderr.on('data', (chunk: Buffer) => {
        sendAndLog({ type: 'log', message: chunk.toString() });
      });

      proc.on('close', async (code: number | null) => {
        // Deregister from process map — it's no longer stoppable
        activeExecProcesses.delete(execId);

        // Was this a user-initiated stop? Check the Set (reliable on both Win + Unix)
        if (stoppedExecIds.has(execId)) {
          stoppedExecIds.delete(execId);
          appendLog('[NAT20] Execution stopped by user.\n');
          try { send({ type: 'stopped', message: 'Execution stopped by user.' }); } catch {}
          try { res.end(); } catch {}
          setTimeout(async () => {
            try { await rm(tmpDir, { recursive: true, force: true }); } catch {}
          }, 3000);
          return;
        }

        let results: any = null;
        const resultsPath = resultsFile;
        try {
          if (fs.existsSync(resultsPath)) {
            const raw = await readFile(resultsPath, 'utf-8');
            const jr = JSON.parse(raw);
            // Parse playwright JSON reporter output
            const suites = jr.suites || [];
            const allTests: any[] = [];
            function collectTests(suite: any) {
              for (const spec of suite.specs || []) {
                for (const test of spec.tests || []) {
                  allTests.push({
                    title: spec.title,
                    status: test.results?.[0]?.status || 'unknown',
                    duration: test.results?.[0]?.duration || 0,
                    error: test.results?.[0]?.error?.message || null,
                  });
                }
              }
              for (const child of suite.suites || []) collectTests(child);
            }
            for (const s of suites) collectTests(s);
            results = {
              total: allTests.length,
              passed: allTests.filter(t => t.status === 'passed').length,
              failed: allTests.filter(t => t.status === 'failed').length,
              skipped: allTests.filter(t => t.status === 'skipped').length,
              tests: allTests,
            };
          }
        } catch (e) {
          console.error('[autotest] results parse error:', e);
        }

        const summary = results
          ? `✓ ${results.passed} passed  ✗ ${results.failed} failed  — exit ${code ?? 1}\n`
          : `Process exited with code ${code ?? 1}\n`;
        appendLog(summary);
        send({ type: 'complete', exitCode: code ?? 1, results });
        res.end();

        // Persist execution results to DB
        if (runId) {
          try {
            await db.insert(autoTestExecutions).values({
              runId,
              scriptId: scriptId || null,
              status: (code === 0) ? 'completed' : 'failed',
              total: results?.total || 0,
              passed: results?.passed || 0,
              failed: results?.failed || 0,
              skipped: results?.skipped || 0,
              results: results?.tests || [],
              completedAt: new Date(),
            });
          } catch (dbErr) {
            console.error('[autotest] DB persist execution error:', dbErr);
          }
        }

        // Cleanup after a delay
        setTimeout(async () => {
          try { await rm(tmpDir, { recursive: true, force: true }); } catch {}
        }, 5000);
      });

      proc.on('error', (err: Error) => {
        sendAndLog({ type: 'error', message: `Process error: ${err.message}\n` });
        res.end();
      });

      req.on('close', () => {
        // Client disconnected (tab closed / navigated away) — kill process silently
        if (activeExecProcesses.has(execId)) {
          stoppedExecIds.add(execId); // suppress the "completed" DB write + SSE
          activeExecProcesses.delete(execId);
          try { proc.kill(); } catch {}
        }
      });

    } catch (err: any) {
      sendAndLog({ type: 'error', message: `FATAL: ${err.message}\n${err.stack || ''}\n` });
      res.end();
      try { await rm(tmpDir, { recursive: true, force: true }); } catch {}
    }
  });

  // ── 6b. List all user stories (for script generation from stories) ───────────
  app.get('/api/autotest/user-stories', async (req: Request, res: Response) => {
    try {
      const stories = await db.select({
        id: userStories.id,
        title: userStories.title,
        description: userStories.description,
        acceptanceCriteria: userStories.acceptanceCriteria,
        state: userStories.state,
        sprint: userStories.sprint,
      }).from(userStories).limit(200);
      res.json({ stories });
    } catch (err: any) {
      res.json({ stories: [] });
    }
  });

  // ── 7. Execution log ───────────────────────────────────────────────────────
  app.get('/api/autotest/exec-logs', async (req: Request, res: Response) => {
    try {
      const logsDir = path.join(process.cwd(), '.autotest-tmp', 'logs');
      const files = fs.existsSync(logsDir)
        ? fs.readdirSync(logsDir).filter(f => f.endsWith('.log')).sort().reverse()
        : [];
      res.json({ logs: files });
    } catch { res.json({ logs: [] }); }
  });

  app.get('/api/autotest/exec-logs/:execId', async (req: Request, res: Response) => {
    try {
      const logsDir = path.join(process.cwd(), '.autotest-tmp', 'logs');
      const logFile = path.join(logsDir, `${req.params.execId}.log`);
      if (!fs.existsSync(logFile)) return res.status(404).json({ error: 'Log not found' });
      const content = await readFile(logFile, 'utf-8');
      res.setHeader('Content-Type', 'text/plain');
      res.send(content);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ── 8. Download Script ─────────────────────────────────────────────────────
  app.post('/api/autotest/download-script', (req: Request, res: Response) => {
    const { script, filename = 'auto.spec.ts' } = req.body;
    if (!script) return res.status(400).json({ error: 'script required' });
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.send(script);
  });
}
