/**
 * Object Repository builder for autonomous testing.
 * Maps semantic names to actual selectors/xpaths extracted from DOM contracts.
 *
 * Provides a named object map that makes Playwright scripts readable and maintainable:
 *   "Login Button" → { selector: "#login-btn", xpath: "//button[@id='login-btn']" }
 *
 * Naming strategy:
 *   1. Use label/visibleText when available
 *   2. Use field name/type for form fields
 *   3. LLM-assisted naming for unlabeled elements when available
 */

import { db } from "../../db";
import { automatedTestPages, pageDomVersions } from "@shared/schema";
import { eq, desc } from "drizzle-orm";
import { getSelectedLLM } from "../../llm-config";

export interface ObjectRepoEntry {
  name: string;
  type: "input" | "button" | "link" | "select" | "textarea" | "other";
  selector: string;
  xpath: string;
  pageUrl: string;
  pageTitle?: string;
  formName?: string;
}

export interface ObjectRepository {
  crawlRunId: string;
  objects: ObjectRepoEntry[];
  generatedAt: string;
}

function toObjectName(raw: string, prefix?: string): string {
  const cleaned = raw.trim().slice(0, 60);
  if (!cleaned) return prefix ?? "Unknown Element";
  return cleaned
    .replace(/[^a-zA-Z0-9 _-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function fieldType(inputType?: string): ObjectRepoEntry["type"] {
  const t = (inputType ?? "text").toLowerCase();
  if (t === "select-one" || t === "select" || t === "select-multiple") return "select";
  if (t === "textarea") return "textarea";
  if (t === "submit" || t === "button" || t === "reset") return "button";
  return "input";
}

/**
 * Build an object repository from all DOM contracts for a crawl run.
 */
export async function buildObjectRepository(crawlRunId: string): Promise<ObjectRepository> {
  const pages = await db
    .select()
    .from(automatedTestPages)
    .where(eq(automatedTestPages.crawlRunId, crawlRunId))
    .limit(50);

  const objects: ObjectRepoEntry[] = [];
  const seenSelectors = new Set<string>();

  for (const page of pages) {
    const [v] = await db
      .select({ domContract: pageDomVersions.domContract })
      .from(pageDomVersions)
      .where(eq(pageDomVersions.pageId, page.id))
      .orderBy(desc(pageDomVersions.extractedAt))
      .limit(1);

    if (!v?.domContract) continue;
    const contract = v.domContract as any;
    const pageUrl = page.sampleUrl ?? "";
    const pageTitle = page.title ?? page.routePattern ?? "";

    // Form fields
    for (const form of contract.forms ?? []) {
      const formName = form.name ? String(form.name) : `Form ${form.formIndex + 1}`;
      for (const field of form.fields ?? []) {
        const selector = String(field.selector ?? "");
        const xpath = String(field.xpath ?? "");
        if (!selector && !xpath) continue;
        const key = selector || xpath;
        if (seenSelectors.has(key)) continue;
        seenSelectors.add(key);

        const rawName = field.label ?? field.name ?? field.type ?? "field";
        const name = toObjectName(`${formName} - ${rawName}`);

        objects.push({
          name,
          type: fieldType(field.type),
          selector,
          xpath,
          pageUrl,
          pageTitle,
          formName,
        });
      }
    }

    // Actions (buttons, links)
    for (const action of contract.actions ?? []) {
      const selector = String(action.selector ?? "");
      const xpath = String(action.xpath ?? "");
      if (!selector && !xpath) continue;
      const key = selector || xpath;
      if (seenSelectors.has(key)) continue;
      seenSelectors.add(key);

      const rawName = action.visibleText ?? action.name ?? action.type ?? "element";
      const name = toObjectName(rawName);
      const type: ObjectRepoEntry["type"] = action.type === "link" ? "link" : "button";

      objects.push({
        name,
        type,
        selector,
        xpath,
        pageUrl,
        pageTitle,
      });
    }
  }

  // LLM-assisted naming pass for elements that have generic names
  const unnamed = objects.filter(
    (o) => o.name.length < 4 || /^(button|input|link|element|field|\w+ \d+)$/i.test(o.name)
  );

  if (unnamed.length > 0) {
    const client = getSelectedLLM();
    if (client) {
      try {
        const toRename = unnamed.slice(0, 30);
        const systemPrompt = `You are a QA automation expert. Given a list of UI elements (selector, xpath, page context), suggest short, meaningful names for each. Return ONLY valid JSON array:
[{ "index": 0, "name": "Descriptive Name" }, ...]
Names should be human-readable, like "Submit Login Button", "Email Input Field", "Forgot Password Link". Max 6 words. No markdown.`;
        const userPrompt = JSON.stringify(
          toRename.map((o, i) => ({
            index: i,
            selector: o.selector,
            pageTitle: o.pageTitle,
            currentName: o.name,
          }))
        );
        const response = await client.chat.completions.create({
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
          temperature: 0.2,
          max_tokens: 1024,
        } as any);
        const content = (response as any).choices?.[0]?.message?.content ?? "";
        const raw = content.trim().replace(/^```json?\s*/i, "").replace(/\s*```$/, "");
        const parsed = JSON.parse(raw) as Array<{ index: number; name: string }>;
        for (const { index, name } of parsed) {
          if (toRename[index] && name?.trim()) {
            toRename[index].name = name.trim();
          }
        }
      } catch (e) {
        console.warn("[object-repository] LLM naming failed:", (e as Error)?.message);
      }
    }
  }

  return {
    crawlRunId,
    objects,
    generatedAt: new Date().toISOString(),
  };
}
