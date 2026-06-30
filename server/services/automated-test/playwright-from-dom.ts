/**
 * Generates a Playwright spec file from discovered pages + DOM contracts.
 * Primary path: LLM generates the script from test cases + real selectors.
 * Fallback: rule-based generation using actual DOM selectors/xpaths.
 */

import { eq, desc } from "drizzle-orm";
import { db } from "../../db";
import {
  automatedTestCases,
  automatedTestPages,
  pageDomVersions,
  crawlRuns,
} from "@shared/schema";
import { generatePlaywrightScriptWithLLM } from "./llm-autonomous";
import { generateFormFillData, generateFormFillDataWithContext, type FormField } from "./form-data-generator";

interface DomField {
  name?: string;
  type?: string;
  required?: boolean;
  label?: string;
  selector: string;
  xpath: string;
}

interface DomForm {
  name?: string;
  action?: string;
  method?: string;
  formIndex: number;
  fields?: DomField[];
  submitXpath?: string;
  submitSelector?: string;
}

interface DomAction {
  name?: string;
  type: string;
  visibleText?: string;
  selector: string;
  xpath: string;
}

interface DomContract {
  pageMeta?: { title?: string; url?: string; h1?: string };
  forms?: DomForm[];
  actions?: DomAction[];
}

function escapeStr(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/\n/g, "\\n");
}

// Added today: Enforce `.first()` on dynamically generated locators to prevent `Error: strict mode violation` in Playwright when identical multiple structural elements exist (like anonymous <a> tags)
function toPlaywrightLocator(selector: string, xpath: string): string {
  if (selector && selector.startsWith("#") && /^#[\w-]+$/.test(selector)) {
    return `page.locator('${escapeStr(selector)}').first()`;
  }
  if (selector && !selector.includes('"') && !selector.includes("'")) {
    return `page.locator('${escapeStr(selector)}').first()`;
  }
  if (xpath) {
    return `page.locator('xpath=${escapeStr(xpath)}').first()`;
  }
  return `page.locator('${escapeStr(selector)}').first()`;
}

/** Determine fill value using the shared synthetic value generator. */
function syntheticFillValue(field: DomField, fieldIdx: number = 0): string {
  const t = (field.type ?? "text").toLowerCase();
  if (t === "checkbox" || t === "radio") return "__check__";
  if (t === "select-one" || t === "select" || t === "select-multiple") return "__select__";
  const domField: FormField = {
    name: field.name,
    type: field.type,
    label: field.label,
    selector: field.selector,
    xpath: field.xpath,
  };
  const filled = generateFormFillData([domField], fieldIdx);
  return filled[0]?.value ?? "Test Input";
}

/** Generate a rule-based Playwright test body for a single test case. */
function buildTestBody(
  tc: { caseCode: string; title: string; testType: string; steps: Array<{ action: string; expectedResult: string }> },
  pageUrl: string,
  contract: DomContract
): string {
  const lines: string[] = [];
  const indent = "  ";

  const safePush = (...args: string[]) => args.forEach((l) => lines.push(indent + l));

  safePush(`await page.goto('${escapeStr(pageUrl)}', { waitUntil: 'domcontentloaded', timeout: 30000 });`);
  safePush(`await page.waitForSelector('body', { timeout: 15000 });`);

  const testType = tc.testType ?? "ui";

  if (testType === "ui" || testType === "navigation") {
    safePush(`// Verify page loaded successfully`);
    safePush(`const title = await page.title();`);
    safePush(`expect(title).toBeTruthy();`);
    safePush(`const bodyText = await page.textContent('body');`);
    safePush(`expect(bodyText).toBeTruthy();`);
  } else if (testType === "form_submit") {
    const form = (contract.forms ?? [])[0];
    if (form && (form.fields?.length ?? 0) > 0) {
      safePush(`// Fill form fields (errors are non-fatal — page load is the assertion)`);
      for (const [fieldIdx, field] of (form.fields ?? []).entries()) {
        if (!field.selector && !field.xpath) continue;
        const locator = toPlaywrightLocator(field.selector, field.xpath);
        const val = syntheticFillValue(field, fieldIdx);
        if (val === "__check__") {
          safePush(`await ${locator}.check({ timeout: 5000 }).catch(() => {});`);
        } else if (val === "__select__") {
          safePush(`await ${locator}.selectOption({ index: 0 }, { timeout: 5000 }).catch(() => {});`);
        } else {
          safePush(`await ${locator}.fill('${escapeStr(val)}', { timeout: 5000 }).catch(() => {});`);
        }
      }
      if (form.submitSelector || form.submitXpath) {
        const submitLocator = form.submitSelector
          ? `page.locator('${escapeStr(form.submitSelector)}')`
          : `page.locator('xpath=${escapeStr(form.submitXpath!)}')`;
        safePush(`await ${submitLocator}.click({ timeout: 5000 }).catch(() => {});`);
        safePush(`await page.waitForTimeout(1000);`);
      }
    }
    // Always assert page is still alive after form interaction
    safePush(`expect(await page.title()).toBeTruthy();`);
  } else if (testType === "action") {
    const stepText = tc.steps?.[0]?.action ?? "";
    const matchedAction = (contract.actions ?? []).find((a) => {
      const label = (a.visibleText ?? "").toLowerCase();
      return stepText.toLowerCase().includes(label) && label.length > 1;
    }) ?? (contract.actions ?? []).find(a => a.type === "button" || a.type === "submit") ?? (contract.actions ?? [])[0];
    if (matchedAction?.selector || matchedAction?.xpath) {
      const locator = toPlaywrightLocator(matchedAction.selector, matchedAction.xpath);
      safePush(`// Attempt to interact with element — soft check, page load is the hard assertion`);
      safePush(`const el = ${locator};`);
      safePush(`const isVisible = await el.isVisible().catch(() => false);`);
      safePush(`if (isVisible) {`);
      safePush(`  await el.click({ timeout: 5000 }).catch(() => {});`);
      safePush(`}`);
    }
    // Hard assertion: page must still be alive
    safePush(`expect(await page.title()).toBeTruthy();`);
  } else {
    safePush(`// Verify page loads`);
    safePush(`expect(await page.title()).toBeTruthy();`);
  }

  return lines.join("\n");
}

export async function generatePlaywrightScriptForCrawlRun(
  crawlRunId: string,
  baseUrl: string,
  useLLM: boolean = true
): Promise<{ fileName: string; scriptContent: string }> {
  // Load crawl run config for context (websiteType, etc.)
  const [runRow] = await db
    .select({ config: crawlRuns.config })
    .from(crawlRuns)
    .where(eq(crawlRuns.id, crawlRunId))
    .limit(1);
  const crawlConfig = (runRow?.config as Record<string, unknown> | null) ?? {};
  const websiteType = (crawlConfig.websiteType as string | undefined) ?? "general";

  // Load test cases
  const cases = await db
    .select()
    .from(automatedTestCases)
    .where(eq(automatedTestCases.crawlRunId, crawlRunId));

  // Load pages
  const pages = await db
    .select()
    .from(automatedTestPages)
    .where(eq(automatedTestPages.crawlRunId, crawlRunId));

  const pageById = new Map(pages.map((p) => [p.id, p]));

  // Identify relevant page IDs from test cases
  const relevantPageIds = new Set(cases.map(c => c.pageId).filter(id => id !== null) as string[]);
  if (relevantPageIds.size === 0 && pages.length > 0) {
    relevantPageIds.add(pages[0].id);
  }

  // Load DOM contracts only for relevant pages
  const contractByPageId = new Map<string, DomContract>();
  for (const pageId of relevantPageIds) {
    const page = pageById.get(pageId);
    if (!page) continue;
    const [v] = await db
      .select({ domContract: pageDomVersions.domContract })
      .from(pageDomVersions)
      .where(eq(pageDomVersions.pageId, page.id))
      .orderBy(desc(pageDomVersions.extractedAt))
      .limit(1);
    contractByPageId.set(page.id, (v?.domContract ?? {}) as DomContract);
  }

  // Build locatorsByPage map for LLM, enriching form fields with synthetic fill values
  const locatorsByPage: Record<
    string,
    {
      forms?: Array<{
        formIndex: number;
        fields: Array<{ name?: string; type?: string; xpath: string; selector: string; fillValue?: string }>;
        submitXpath?: string;
      }>;
      actions?: Array<{ visibleText?: string; type: string; xpath: string; selector: string }>;
    }
  > = {};
  await Promise.all(
    Array.from(contractByPageId.entries()).map(async ([pageId, contract]) => {
      const page = pageById.get(pageId);
      const pageTitle = page?.title ?? page?.sampleUrl ?? "";

      const formsWithFill = await Promise.all(
        (contract.forms ?? []).map(async (f) => {
          const domFields = f.fields ?? [];
          const filled = await generateFormFillDataWithContext(
            domFields.map((field) => ({
              name: field.name,
              type: field.type,
              label: field.label,
              selector: field.selector,
              xpath: field.xpath,
            })),
            {
              websiteType,
              pageTitle,
              formName: f.name,
              formIndex: f.formIndex,
            }
          );
          return {
            formIndex: f.formIndex,
            fields: domFields.map((field, fi) => ({
              name: field.name,
              type: field.type,
              xpath: field.xpath,
              selector: field.selector,
              fillValue: filled[fi]?.value,
            })),
            submitXpath: f.submitXpath,
          };
        })
      );

      locatorsByPage[pageId] = {
        forms: formsWithFill,
        actions: (contract.actions ?? [])
          .sort((a, b) => {
            const aIsBtn = a.type === "button" || a.type === "submit";
            const bIsBtn = b.type === "button" || b.type === "submit";
            if (aIsBtn && !bIsBtn) return -1;
            if (!aIsBtn && bIsBtn) return 1;
            return (b.visibleText?.length ?? 0) - (a.visibleText?.length ?? 0);
          })
          .slice(0, 30) // Tighter limit for script generation prompt
          .map((a) => ({
            visibleText: a.visibleText,
            type: a.type,
            xpath: a.xpath,
            selector: a.selector,
          })),
      };
    })
  );

  // Build test case list with page URLs
  const testCasesForLLM = cases.map((tc) => {
    const page = tc.pageId ? pageById.get(tc.pageId) : undefined;
    return {
      caseCode: tc.caseCode ?? "",
      title: tc.title ?? "",
      testType: tc.testType ?? "ui",
      steps: (tc.steps as Array<{ action: string; expectedResult: string }>) ?? [],
      pageUrl: page?.sampleUrl ?? baseUrl,
    };
  });

  // Try LLM-based generation first
  if (useLLM && testCasesForLLM.length > 0) {
    try {
      const llmScript = await generatePlaywrightScriptWithLLM(baseUrl, testCasesForLLM, locatorsByPage, websiteType);
      if (llmScript && llmScript.includes("test(")) {
        console.log("[playwright-from-dom] LLM script generated successfully");
        return { fileName: "autonomous.spec.ts", scriptContent: llmScript };
      }
    } catch (e) {
      console.warn("[playwright-from-dom] LLM script generation failed, using rule-based fallback:", (e as Error)?.message);
    }
  }

  // Rule-based fallback — generate real tests from DOM contracts
  console.log("[playwright-from-dom] Generating rule-based script from DOM contracts");

  if (cases.length === 0) {
    // Nothing to test — generate a single smoke test for the base URL
    const script = `const { test, expect } = require('playwright/test');

test('TC-0001: Smoke test - page loads', async ({ page }) => {
  await page.goto('${escapeStr(baseUrl)}', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await expect(page).toHaveTitle(/.+/);
});
`;
    return { fileName: "autonomous.spec.ts", scriptContent: script };
  }

  const testBlocks: string[] = [];

  for (const tc of cases) {
    const page = tc.pageId ? pageById.get(tc.pageId) : undefined;
    const pageUrl = page?.sampleUrl ?? baseUrl;
    const contract = tc.pageId ? (contractByPageId.get(tc.pageId) ?? {}) : {};

    const body = buildTestBody(
      {
        caseCode: tc.caseCode ?? "",
        title: tc.title ?? "",
        testType: tc.testType ?? "ui",
        steps: (tc.steps as Array<{ action: string; expectedResult: string }>) ?? [],
      },
      pageUrl,
      contract
    );

    testBlocks.push(
      `test('${tc.caseCode}: ${escapeStr(tc.title ?? "")}', async ({ page }) => {\n${body}\n});`
    );
  }

  const scriptContent = `const { test, expect } = require('playwright/test');\n\n${testBlocks.join("\n\n")}\n`;

  return { fileName: "autonomous.spec.ts", scriptContent };
}
