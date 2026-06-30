/**
 * Test case generation from discovered pages and DOM contracts.
 * Uses LLM (Anthropic/Azure OpenAI) when available, with rule-based fallback.
 */

import { db } from "../../db";
import {
  automatedTestPages,
  pageDomVersions,
  automatedTestCases,
  crawlRuns,
} from "@shared/schema";
import { eq, desc } from "drizzle-orm";
import { generateTestCasesWithLLM } from "./llm-autonomous";
import { parseRequirementsInput, scenariosToTestCaseInserts, type RequirementsFormat } from "./input-parser";
import type { WebsiteType, StandardWorkflow } from "./website-classifier";

interface DomContractForm {
  name?: string;
  action?: string;
  method?: string;
  formIndex: number;
  fields?: Array<{
    name?: string;
    type?: string;
    required?: boolean;
    label?: string;
    selector: string;
    xpath: string;
  }>;
}

interface DomContractAction {
  name?: string;
  type: string;
  visibleText?: string;
  selector: string;
  xpath: string;
}

interface DomContractJson {
  pageMeta?: { title?: string; url?: string; h1?: string };
  forms?: DomContractForm[];
  actions?: DomContractAction[];
}

export interface GeneratedTestCase {
  id: string;
  crawlRunId: string;
  pageId: string | null;
  caseCode: string;
  title: string;
  testType: string;
  steps: Array<{ action: string; expectedResult: string }>;
}

function padCaseCode(n: number): string {
  return `TC-${String(n).padStart(4, "0")}`;
}

/** Normalise any case code the LLM may produce to TC-NNNN format. */
function normaliseCaseCode(raw: string | undefined | null, fallback: number): string {
  if (!raw) return padCaseCode(fallback);
  // Already TC-NNNN
  const m = raw.match(/(\d+)$/);
  if (m) return `TC-${m[1].padStart(4, "0")}`;
  return padCaseCode(fallback);
}

export interface RequirementsInput {
  format: RequirementsFormat;
  content: string;
}

export async function generateTestCasesForCrawlRun(
  crawlRunId: string,
  useLLM: boolean = true,
  testFocus: string = "all",
  requirementsInput?: RequirementsInput
): Promise<GeneratedTestCase[]> {
  const pages = await db
    .select()
    .from(automatedTestPages)
    .where(eq(automatedTestPages.crawlRunId, crawlRunId))
    .orderBy(automatedTestPages.depth, automatedTestPages.createdAt);

  // --- Requirements-driven path: parse BRD / user stories / Gherkin ---
  if (requirementsInput?.content?.trim()) {
    try {
      const parsed = await parseRequirementsInput(requirementsInput.content, requirementsInput.format);
      if (parsed.scenarios.length > 0) {
        const firstPageId = pages[0]?.id ?? null;
        const reqCases = scenariosToTestCaseInserts(parsed.scenarios, crawlRunId, firstPageId, 1);

        // If we also have DOM, generate DOM-based cases starting after the req cases
        let domCases: typeof reqCases = [];
        if (pages.length > 0 && useLLM) {
          const pageRefs = await Promise.all(
            pages.map(async (p, pageIndex) => {
              const [v] = await db
                .select({ domContract: pageDomVersions.domContract })
                .from(pageDomVersions)
                .where(eq(pageDomVersions.pageId, p.id))
                .orderBy(desc(pageDomVersions.extractedAt))
                .limit(1);
              const contract = (v?.domContract ?? {}) as DomContractJson;
              return {
                pageId: p.id,
                pageIndex,
                url: p.sampleUrl ?? "",
                title: p.title ?? null,
                routePattern: p.routePattern ?? "",
                domSummary: {
                  pageMeta: contract.pageMeta,
                  forms: (contract.forms ?? []).map((f) => ({
                    name: f.name,
                    fieldCount: f.fields?.length,
                    method: f.method,
                  })),
                  actions: (contract.actions ?? [])
                    .sort((a, b) => {
                      const aIsBtn = a.type === "button" || a.type === "submit";
                      const bIsBtn = b.type === "button" || b.type === "submit";
                      if (aIsBtn && !bIsBtn) return -1;
                      if (!aIsBtn && bIsBtn) return 1;
                      return (b.visibleText?.length ?? 0) - (a.visibleText?.length ?? 0);
                    })
                    .slice(0, 50)
                    .map((a) => ({
                      type: a.type ?? "other",
                      visibleText: a.visibleText,
                    })),
                },
              };
            })
          );
          const llmCases = await generateTestCasesWithLLM(pageRefs, testFocus, parsed.rawSummary);
          if (llmCases && llmCases.length > 0) {
            const pageIdByRef = new Map<string, string>();
            pages.forEach((p, i) => {
              pageIdByRef.set(String(i), p.id);
              pageIdByRef.set(p.id, p.id);
            });
            domCases = llmCases.map((tc, idx) => {
              const pageIdRef = tc.pageIdRef != null ? String(tc.pageIdRef) : "0";
              const pageId = pageIdByRef.get(pageIdRef) ?? pages[0]?.id ?? null;
              return {
                crawlRunId,
                pageId,
                caseCode: padCaseCode(reqCases.length + 1 + idx),
                title: tc.title,
                testType: tc.testType ?? "ui",
                steps: tc.steps ?? [],
              };
            });
          }
        }

        const allCases = [...reqCases, ...domCases];
        await db.delete(automatedTestCases).where(eq(automatedTestCases.crawlRunId, crawlRunId));
        await db.insert(automatedTestCases).values(
          allCases.map((c) => ({
            crawlRunId: c.crawlRunId,
            pageId: c.pageId,
            caseCode: c.caseCode,
            title: c.title,
            testType: c.testType,
            steps: c.steps,
          }))
        );
        const ids = await db
          .select({ id: automatedTestCases.id, caseCode: automatedTestCases.caseCode, title: automatedTestCases.title, testType: automatedTestCases.testType, steps: automatedTestCases.steps, pageId: automatedTestCases.pageId })
          .from(automatedTestCases)
          .where(eq(automatedTestCases.crawlRunId, crawlRunId))
          .orderBy(automatedTestCases.createdAt);
        return ids.map((r) => ({
          id: r.id,
          crawlRunId,
          pageId: r.pageId,
          caseCode: r.caseCode ?? "",
          title: r.title ?? "",
          testType: r.testType ?? "ui",
          steps: (r.steps as Array<{ action: string; expectedResult: string }>) ?? [],
        }));
      }
    } catch (e) {
      console.warn("[test-case-generator] Requirements parsing failed, falling through to DOM path:", (e as Error)?.message);
    }
  }

  if (useLLM && pages.length > 0) {
    // Load website classification context from crawl config
    const [runRow] = await db
      .select({ config: crawlRuns.config })
      .from(crawlRuns)
      .where(eq(crawlRuns.id, crawlRunId))
      .limit(1);
    const crawlConfig = (runRow?.config as Record<string, unknown> | null) ?? {};
    const websiteType = (crawlConfig.websiteType as WebsiteType | undefined) ?? "generic";
    const websiteClassification = crawlConfig.websiteClassification as { confidence: string; signals: string[] } | undefined;

    const pageRefs = await Promise.all(
      pages.map(async (p, pageIndex) => {
        const [v] = await db
          .select({ domContract: pageDomVersions.domContract })
          .from(pageDomVersions)
          .where(eq(pageDomVersions.pageId, p.id))
          .orderBy(desc(pageDomVersions.extractedAt))
          .limit(1);
        const contract = (v?.domContract ?? {}) as DomContractJson;
        return {
          pageId: p.id,
          pageIndex,
          url: p.sampleUrl ?? "",
          title: p.title ?? null,
          routePattern: p.routePattern ?? "",
          domSummary: {
            pageMeta: contract.pageMeta,
            forms: (contract.forms ?? []).map((f) => ({
              name: f.name,
              fieldCount: f.fields?.length,
              method: f.method,
            })),
            actions: (contract.actions ?? [])
              .sort((a, b) => {
                const aIsBtn = a.type === "button" || a.type === "submit";
                const bIsBtn = b.type === "button" || b.type === "submit";
                if (aIsBtn && !bIsBtn) return -1;
                if (!aIsBtn && bIsBtn) return 1;
                return (b.visibleText?.length ?? 0) - (a.visibleText?.length ?? 0);
              })
              .slice(0, 50)
              .map((a) => ({
                type: a.type ?? "other",
                visibleText: a.visibleText,
              })),
          },
        };
      })
    );

    // Build website context string for LLM
    const websiteContext = websiteType !== "generic"
      ? `Website type: ${websiteType}. Detected signals: ${(websiteClassification?.signals ?? []).join(", ")}. Generate test cases that reflect standard ${websiteType} workflows.`
      : undefined;

    const llmCases = await generateTestCasesWithLLM(pageRefs, testFocus, websiteContext);
    if (llmCases && llmCases.length > 0) {
      const pageIdByRef = new Map<string, string>();
      pages.forEach((p, i) => {
        pageIdByRef.set(String(i), p.id);
        pageIdByRef.set(p.id, p.id);
      });
      const casesToInsert = llmCases.map((tc, idx) => {
        const pageIdRef = tc.pageIdRef != null ? String(tc.pageIdRef) : "0";
        const pageId = pageIdByRef.get(pageIdRef) ?? pages[0]?.id ?? null;
        return {
          crawlRunId,
          pageId,
          caseCode: normaliseCaseCode(tc.caseCode, idx + 1),
          title: tc.title,
          testType: tc.testType ?? "ui",
          steps: tc.steps ?? [],
        };
      });
      await db.delete(automatedTestCases).where(eq(automatedTestCases.crawlRunId, crawlRunId));
      await db.insert(automatedTestCases).values(
        casesToInsert.map((c) => ({
          crawlRunId: c.crawlRunId,
          pageId: c.pageId,
          caseCode: c.caseCode,
          title: c.title,
          testType: c.testType,
          steps: c.steps,
        }))
      );
      const ids = await db
        .select({ id: automatedTestCases.id, caseCode: automatedTestCases.caseCode, title: automatedTestCases.title, testType: automatedTestCases.testType, steps: automatedTestCases.steps, pageId: automatedTestCases.pageId })
        .from(automatedTestCases)
        .where(eq(automatedTestCases.crawlRunId, crawlRunId))
        .orderBy(automatedTestCases.createdAt);
      return ids.map((r) => ({
        id: r.id,
        crawlRunId,
        pageId: r.pageId,
        caseCode: r.caseCode ?? "",
        title: r.title ?? "",
        testType: r.testType ?? "ui",
        steps: (r.steps as Array<{ action: string; expectedResult: string }>) ?? [],
      }));
    }
  }

  // Look up crawl mode so we can apply per-page test limits.
  // quick  → 3 tests per page total (page-load + up to 2 actions)
  // complete → no per-page cap (all forms + all actions)
  const [runRow] = await db
    .select({ config: crawlRuns.config })
    .from(crawlRuns)
    .where(eq(crawlRuns.id, crawlRunId))
    .limit(1);
  const crawlMode = (runRow?.config as Record<string, unknown> | null)?.mode ?? "complete";
  const MAX_CASES_PER_PAGE = crawlMode === "quick" ? 3 : Infinity;

  const casesToInsert: Array<{
    crawlRunId: string;
    pageId: string | null;
    caseCode: string;
    title: string;
    testType: string;
    steps: Array<{ action: string; expectedResult: string }>;
  }> = [];
  let caseIndex = 1;

  for (const page of pages) {
    const [version] = await db
      .select()
      .from(pageDomVersions)
      .where(eq(pageDomVersions.pageId, page.id))
      .orderBy(desc(pageDomVersions.extractedAt))
      .limit(1);

    const contract = (version?.domContract ?? {}) as DomContractJson;
    const pageTitle = contract.pageMeta?.title || page.title || page.routePattern || "Page";
    let casesThisPage = 0;

    // 1. Page-load test — always included, counts toward the per-page budget (unless exclusively checking forms/buttons)
    if (testFocus === "all" || testFocus === "navigation") {
      casesToInsert.push({
        crawlRunId,
        pageId: page.id,
        caseCode: padCaseCode(caseIndex++),
        title: `${pageTitle} loads successfully`,
        testType: "ui",
        steps: [
          { action: `Navigate to ${page.sampleUrl}`, expectedResult: "Page loads and body is visible" },
        ],
      });
      casesThisPage++;
    }

    // 2. Form submit tests (one per form with at least one field)
    if (testFocus === "all" || testFocus === "forms") {
      const forms = contract.forms ?? [];
      for (const form of forms) {
        if (casesThisPage >= MAX_CASES_PER_PAGE) break;
        const fieldCount = form.fields?.length ?? 0;
        const formLabel = form.name || `Form ${form.formIndex + 1}`;
        casesToInsert.push({
          crawlRunId,
          pageId: page.id,
          caseCode: padCaseCode(caseIndex++),
          title: `Submit ${formLabel} (${fieldCount} field(s))`,
          testType: "form_submit",
          steps: [
            { action: `Navigate to page`, expectedResult: "Page loads" },
            { action: `Fill required fields in ${formLabel}`, expectedResult: "Fields accept input" },
            { action: `Submit ${formLabel}`, expectedResult: "Form submits without error" },
          ],
        });
        casesThisPage++;
      }
    }

    // 3. Action tests — buttons prioritised over nav links (nav links are already
    // covered by the page-load tests of other discovered pages).
    if (casesThisPage < MAX_CASES_PER_PAGE && (testFocus === "all" || testFocus === "navigation" || testFocus === "buttons")) {
      const allActions = contract.actions ?? [];
      const buttons = allActions.filter((a) => a.type === "button" || a.type === "submit");
      const links = allActions.filter((a) => a.type !== "button" && a.type !== "submit");
      const remaining = MAX_CASES_PER_PAGE - casesThisPage;
      
      // Added today: Isolate prioritised actions strictly based on the testFocus selection
      let prioritised = [];
      if (testFocus === "buttons") prioritised = buttons;
      else if (testFocus === "navigation") prioritised = links;
      else prioritised = [...buttons, ...links];
      
      prioritised = prioritised.slice(0, remaining);

      for (const action of prioritised) {
        const label = action.visibleText?.trim().slice(0, 50) || action.type || "element";
        casesToInsert.push({
          crawlRunId,
          pageId: page.id,
          caseCode: padCaseCode(caseIndex++),
          title: `Action: ${label}`,
          testType: "action",
          steps: [
            { action: `Navigate to page`, expectedResult: "Page loads" },
            { action: `Click "${label}"`, expectedResult: "Element is clickable and responds" },
          ],
        });
        casesThisPage++;
      }
    }
  }

  if (casesToInsert.length === 0) {
    return [];
  }

  await db.delete(automatedTestCases).where(eq(automatedTestCases.crawlRunId, crawlRunId));

  await db.insert(automatedTestCases).values(
    casesToInsert.map((c) => ({
      crawlRunId: c.crawlRunId,
      pageId: c.pageId,
      caseCode: c.caseCode,
      title: c.title,
      testType: c.testType,
      steps: c.steps,
    }))
  );

  const ids = await db
    .select({ id: automatedTestCases.id, caseCode: automatedTestCases.caseCode, title: automatedTestCases.title, testType: automatedTestCases.testType, steps: automatedTestCases.steps, pageId: automatedTestCases.pageId })
    .from(automatedTestCases)
    .where(eq(automatedTestCases.crawlRunId, crawlRunId))
    .orderBy(automatedTestCases.createdAt);

  return ids.map((r) => ({
    id: r.id,
    crawlRunId,
    pageId: r.pageId,
    caseCode: r.caseCode ?? "",
    title: r.title ?? "",
    testType: r.testType ?? "ui",
    steps: (r.steps as Array<{ action: string; expectedResult: string }>) ?? [],
  }));
}
