/**
 * DOM Intelligence Agent: extracts forms (with fields), actions (buttons/links), optional tables/modals.
 * Uses Puppeteer to load page and run extraction in browser; builds XPath and CSS in Node with
 * Strategy A (attribute + tag fallback) and nth-of-type CSS fallback so locators are never empty.
 * Per-method try/catch returns [] on error; per-page failure is caught in orchestrator (skip page, continue).
 */

import { type Browser, type Page } from "puppeteer";

function escapeXPath(s: string): string {
  return s.replace(/"/g, '""');
}
function escapeCss(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function xpathForFormField(
  tag: string,
  attrs: {
    id?: string | null;
    dataTestid?: string | null;
    name?: string | null;
    formId?: string | null;
    formName?: string | null;
    ariaLabel?: string | null;
    type?: string | null;
  }
): string {
  const t = (tag || "input").toLowerCase();
  const id = attrs.id?.trim();
  if (id) return `//*[@id="${escapeXPath(id)}"]`;
  const testId = attrs.dataTestid;
  if (testId) return `//*[@data-testid="${escapeXPath(testId)}"]`;
  const name = attrs.name;
  const formId = attrs.formId?.trim();
  const formName = attrs.formName;
  const type = attrs.type;
  if (name) {
    if (formId) return `//form[@id="${escapeXPath(formId)}"]//${t}[@name="${escapeXPath(name)}"]`;
    if (formName) return `//form[@name="${escapeXPath(formName)}"]//${t}[@name="${escapeXPath(name)}"]`;
    if (type) return `//${t}[@name="${escapeXPath(name)}" and @type="${escapeXPath(type)}"]`;
    return `//form//${t}[@name="${escapeXPath(name)}"]`;
  }
  const aria = attrs.ariaLabel;
  if (aria) return `//${t}[@aria-label="${escapeXPath(aria)}"]`;
  if (type) return `//${t}[@type="${escapeXPath(type)}"]`;
  return `//${t}`;
}

function xpathForAction(
  tag: string,
  attrs: {
    id?: string | null;
    dataTestid?: string | null;
    ariaLabel?: string | null;
    visibleText?: string | null;
    href?: string | null;
    type?: string | null;
    name?: string | null;
  }
): string {
  const t = (tag || "button").toLowerCase();
  const id = attrs.id?.trim();
  if (id) return `//*[@id="${escapeXPath(id)}"]`;
  const testId = attrs.dataTestid;
  if (testId) return `//*[@data-testid="${escapeXPath(testId)}"]`;
  const aria = attrs.ariaLabel;
  if (aria) return `//${t}[@aria-label="${escapeXPath(aria)}"]`;
  const text = attrs.visibleText?.trim();
  if (text && text.length > 0 && text.length <= 50 && !text.includes('"'))
    return `//${t}[text()="${escapeXPath(text)}"]`;
  const href = attrs.href?.trim();
  if (t === "a" && href && href !== "#" && !href.startsWith("javascript:"))
    return `//a[@href="${escapeXPath(href)}"]`;
  const type = attrs.type;
  if (type) return `//${t}[@type="${escapeXPath(type)}"]`;
  const name = attrs.name;
  if (name) return `//${t}[@name="${escapeXPath(name)}"]`;
  return `//${t}`;
}

function cssForFormField(
  tag: string,
  attrs: {
    dataTestid?: string | null;
    ariaLabel?: string | null;
    name?: string | null;
    id?: string | null;
    formId?: string | null;
    sameTagIndexInForm?: number;
  }
): string {
  const t = (tag || "input").toLowerCase();
  const testId = attrs.dataTestid;
  if (testId) return `[data-testid="${escapeCss(testId)}"]`;
  const aria = attrs.ariaLabel;
  if (aria) return `${t}[aria-label="${escapeCss(aria)}"]`;
  const name = attrs.name;
  if (name) {
    const formId = attrs.formId?.trim();
    if (formId && /^[a-zA-Z][\w-]*$/.test(formId))
      return `#${formId} ${t}[name="${escapeCss(name)}"]`;
    return `${t}[name="${escapeCss(name)}"]`;
  }
  const id = attrs.id?.trim();
  if (id && /^[a-zA-Z][\w-]*$/.test(id)) return `#${id}`;
  const n = attrs.sameTagIndexInForm ?? 1;
  const formId = attrs.formId?.trim();
  if (formId && /^[a-zA-Z][\w-]*$/.test(formId)) return `#${formId} ${t}:nth-of-type(${n})`;
  return `${t}:nth-of-type(${n})`;
}

function cssForAction(
  tag: string,
  attrs: {
    dataTestid?: string | null;
    ariaLabel?: string | null;
    name?: string | null;
    id?: string | null;
    sameTagIndexInParent?: number;
  }
): string {
  const t = (tag || "button").toLowerCase();
  const testId = attrs.dataTestid;
  if (testId) return `[data-testid="${escapeCss(testId)}"]`;
  const aria = attrs.ariaLabel;
  if (aria) return `${t}[aria-label="${escapeCss(aria)}"]`;
  const name = attrs.name;
  if (name) return `${t}[name="${escapeCss(name)}"]`;
  const id = attrs.id?.trim();
  if (id && /^[a-zA-Z][\w-]*$/.test(id)) return `#${id}`;
  const n = attrs.sameTagIndexInParent ?? 1;
  return `${t}:nth-of-type(${n})`;
}

export interface FormFieldDescriptor {
  tag: string;
  name?: string;
  type?: string;
  id?: string;
  dataTestid?: string;
  ariaLabel?: string;
  required?: boolean;
  labelText?: string;
  placeholder?: string;
  formId?: string;
  formName?: string;
  sameTagIndexInForm?: number;
  pattern?: string;
  min?: string;
  max?: string;
}

export interface FormDescriptor {
  name?: string;
  action?: string;
  method?: string;
  formIndex: number;
  formId?: string;
  formName?: string;
  fields: FormFieldDescriptor[];
}

export interface ActionDescriptor {
  tag: string;
  type: string;
  visibleText?: string;
  id?: string;
  dataTestid?: string;
  ariaLabel?: string;
  name?: string;
  href?: string;
  sameTagIndexInParent?: number;
}

export interface DomContract {
  pageMeta: {
    title: string;
    h1?: string;
    url: string;
  };
  forms: Array<{
    name?: string;
    action?: string;
    method?: string;
    formIndex: number;
    fields: Array<{
      name?: string;
      type?: string;
      required?: boolean;
      label?: string;
      placeholder?: string;
      selector: string;
      xpath: string;
      pattern?: string;
      min?: string;
      max?: string;
    }>;
  }>;
  actions: Array<{
    name?: string;
    type: string;
    visibleText?: string;
    selector: string;
    xpath: string;
  }>;
}

/** In-browser extraction: forms and actions with try/catch per method; returns [] on error. */
function getExtractionScript(): string {
  return `
    (function() {
      var pageMeta = { title: (document.title || ''), url: window.location.href };
      try {
        var h1 = document.querySelector('h1');
        pageMeta.h1 = h1 ? h1.textContent.trim().slice(0, 300) : undefined;
      } catch (e) { pageMeta.h1 = undefined; }

      var forms = [];
      try {
        document.querySelectorAll('form').forEach(function(form, formIndex) {
          var formId = form.id || undefined;
          var formName = form.getAttribute('name') || undefined;
          var fields = [];
          var tagCounts = {};
          form.querySelectorAll('input, select, textarea').forEach(function(el) {
            var tag = el.tagName.toLowerCase();
            tagCounts[tag] = (tagCounts[tag] || 0) + 1;
            var sameTagIndexInForm = tagCounts[tag];
            var label = el.id && document.querySelector('label[for="' + el.id.replace(/"/g, '\\\\"') + '"]');
            fields.push({
              tag: tag,
              name: el.name || undefined,
              type: (el.type || el.getAttribute('type')) || undefined,
              id: el.id || undefined,
              dataTestid: el.getAttribute('data-testid') || undefined,
              ariaLabel: el.getAttribute('aria-label') || undefined,
              required: el.required || !!el.getAttribute('required'),
              labelText: label ? label.textContent.trim().slice(0, 200) : undefined,
              placeholder: el.getAttribute('placeholder') || undefined,
              formId: formId,
              formName: formName,
              sameTagIndexInForm: sameTagIndexInForm,
              pattern: el.getAttribute('pattern') || undefined,
              min: el.getAttribute('min') || undefined,
              max: el.getAttribute('max') || undefined
            });
          });
          forms.push({
            name: form.getAttribute('name') || undefined,
            action: form.action || undefined,
            method: (form.method || 'GET').toUpperCase(),
            formIndex: formIndex,
            formId: formId,
            formName: formName,
            fields: fields
          });
        });
      } catch (e) { forms = []; }

      // Standalone inputs pass: capture fillable inputs that are NOT inside any <form> element.
      // This handles WordPress widgets, SPA login forms, and other patterns where inputs
      // exist without a wrapping <form> tag.
      try {
        var SKIP_TYPES = { submit: 1, button: 1, reset: 1, hidden: 1, image: 1 };
        var standaloneFields = [];
        var tagCounts2 = {};
        document.querySelectorAll('input, select, textarea').forEach(function(el) {
          if (el.closest('form')) return; // already captured above
          var type = (el.type || el.getAttribute('type') || 'text').toLowerCase();
          if (SKIP_TYPES[type]) return;
          var tag = el.tagName.toLowerCase();
          tagCounts2[tag] = (tagCounts2[tag] || 0) + 1;
          var label = el.id && document.querySelector('label[for="' + el.id.replace(/"/g, '\\\\"') + '"]');
          standaloneFields.push({
            tag: tag,
            name: el.name || undefined,
            type: type,
            id: el.id || undefined,
            dataTestid: el.getAttribute('data-testid') || undefined,
            ariaLabel: el.getAttribute('aria-label') || undefined,
            required: el.required || !!el.getAttribute('required'),
            labelText: label ? label.textContent.trim().slice(0, 200) : undefined,
            placeholder: el.getAttribute('placeholder') || undefined,
            sameTagIndexInForm: tagCounts2[tag],
            pattern: el.getAttribute('pattern') || undefined,
            min: el.getAttribute('min') || undefined,
            max: el.getAttribute('max') || undefined
          });
        });
        if (standaloneFields.length > 0) {
          forms.push({
            name: 'Standalone Fields',
            action: undefined,
            method: 'POST',
            formIndex: forms.length,
            formId: undefined,
            formName: undefined,
            fields: standaloneFields
          });
        }
      } catch (e) {}

      var actions = [];
      try {
        var actionSelectors = 'button, [role="button"], a[href], input[type="submit"], input[type="button"]';
        document.querySelectorAll(actionSelectors).forEach(function(el) {
          var tag = el.tagName.toLowerCase();
          var visibleText = (el.textContent || '').trim().slice(0, 100);
          var typeAttr = el.getAttribute('type');
          var actionType = 'other';
          if (tag === 'a' && el.getAttribute('href')) actionType = 'navigate';
          else if (typeAttr === 'submit') actionType = 'submit';
          else if (visibleText.toLowerCase().indexOf('modal') >= 0 || el.getAttribute('data-toggle') === 'modal') actionType = 'open_modal';
          var parent = el.parentElement;
          var sameTagIndexInParent = 1;
          if (parent) {
            var siblings = parent.querySelectorAll(':scope > ' + tag);
            for (var i = 0; i < siblings.length; i++) { if (siblings[i] === el) { sameTagIndexInParent = i + 1; break; } }
          }
          actions.push({
            tag: tag,
            type: actionType,
            visibleText: visibleText || undefined,
            id: el.id || undefined,
            dataTestid: el.getAttribute('data-testid') || undefined,
            ariaLabel: el.getAttribute('aria-label') || undefined,
            name: el.getAttribute('name') || undefined,
            href: el.getAttribute('href') || undefined,
            sameTagIndexInParent: sameTagIndexInParent
          });
        });
      } catch (e) { actions = []; }

      return { pageMeta: pageMeta, forms: forms, actions: actions };
    })();
  `;
}

export async function extractDomContract(page: Page, pageUrl: string): Promise<DomContract> {
  const raw = await page.evaluate(getExtractionScript());

  // Also scan sub-frames (iframes) — many sites embed login/contact forms in iframes.
  // Frames are processed in parallel; failures in individual frames are silently skipped.
  const frames = page.frames().filter((f) => f !== page.mainFrame());
  if (frames.length > 0) {
    const iframeResults = await Promise.allSettled(
      frames.map((frame) => frame.evaluate(getExtractionScript()).catch(() => null))
    );
    let iframeFormOffset = (raw.forms || []).length;
    for (const result of iframeResults) {
      if (result.status !== "fulfilled" || !result.value) continue;
      const iraw = result.value as { forms?: any[]; actions?: any[] };
      if (iraw.forms?.length) {
        // Re-index formIndex to avoid collisions with main-frame forms
        const reindexed = iraw.forms.map((f: any) => ({ ...f, formIndex: iframeFormOffset++ }));
        (raw.forms as any[]).push(...reindexed);
      }
      if (iraw.actions?.length) {
        (raw.actions as any[]).push(...iraw.actions);
      }
    }
  }

  const pageMeta = { ...(raw.pageMeta || {}), url: pageUrl };

  const forms = (raw.forms || []).map((f: any) => ({
    name: f.name,
    action: f.action,
    method: f.method || "GET",
    formIndex: f.formIndex ?? 0,
    fields: (f.fields || []).map((field: FormFieldDescriptor) => {
      const xpath = xpathForFormField(field.tag, {
        id: field.id,
        dataTestid: field.dataTestid,
        name: field.name,
        formId: f.formId,
        formName: f.formName,
        ariaLabel: field.ariaLabel,
        type: field.type,
      });
      const selector = cssForFormField(field.tag, {
        dataTestid: field.dataTestid,
        ariaLabel: field.ariaLabel,
        name: field.name,
        id: field.id,
        formId: f.formId,
        sameTagIndexInForm: field.sameTagIndexInForm,
      });
      return {
        name: field.name,
        type: field.type,
        required: field.required,
        label: field.labelText,
        placeholder: field.placeholder,
        selector,
        xpath,
        pattern: field.pattern,
        min: field.min,
        max: field.max,
      };
    }),
  }));

  const actions = (raw.actions || []).map((a: any) => {
    const xpath = xpathForAction(a.tag, {
      id: a.id,
      dataTestid: a.dataTestid,
      ariaLabel: a.ariaLabel,
      visibleText: a.visibleText,
      href: a.href,
      type: a.type === "submit" ? "submit" : undefined,
      name: a.name,
    });
    const selector = cssForAction(a.tag, {
      dataTestid: a.dataTestid,
      ariaLabel: a.ariaLabel,
      name: a.name,
      id: a.id,
      sameTagIndexInParent: a.sameTagIndexInParent,
    });
    return {
      name: a.name,
      type: a.type || "other",
      visibleText: a.visibleText,
      selector,
      xpath,
    };
  });

  return { pageMeta, forms, actions };
}

const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

export async function extractDomContractFromUrl(
  browser: Browser,
  url: string,
  auth?: { authUrl?: string; username?: string; password?: string },
  domExtractionTimeoutMs: number = 30 * 1000
): Promise<DomContract> {
  const page = await browser.newPage();
  try {
    await page.setDefaultTimeout(domExtractionTimeoutMs);
    await page.setUserAgent(DEFAULT_USER_AGENT);
    await page.setViewport({ width: 1280, height: 720 });
    await page.setExtraHTTPHeaders({ "Accept-Language": "en-US,en;q=0.9" });
    if (auth?.authUrl && auth.username && auth.password) {
      await page.goto(auth.authUrl, { waitUntil: "domcontentloaded", timeout: 15000 }).catch(() => {});
      await page.type('input[type="text"], input[name="username"], input[type="email"]', auth.username, { delay: 50 });
      await page.type('input[type="password"], input[name="password"]', auth.password, { delay: 50 });
      await page.click('button[type="submit"], input[type="submit"], [type="submit"]').catch(() => {});
      await page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 10000 }).catch(() => {});
    }
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: Math.min(domExtractionTimeoutMs, 120000) });
    await page.waitForSelector("body", { timeout: 10000 }).catch(() => {});
    return await extractDomContract(page, url);
  } finally {
    await page.close();
  }
}
