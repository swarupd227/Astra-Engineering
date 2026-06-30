/**
 * Website type classifier for autonomous testing.
 * Analyses discovered pages and DOM contracts to determine the type of website,
 * then recommends standard workflows to test.
 *
 * Classification is stored back into crawl_runs.config so subsequent steps
 * (test case generation, Playwright script generation) can use the context.
 */

import { db } from "../../db";
import { crawlRuns, automatedTestPages, pageDomVersions } from "@shared/schema";
import { eq, desc } from "drizzle-orm";
import { getSelectedLLM } from "../../llm-config";

export type WebsiteType =
  | "ecommerce"
  | "banking"
  | "crm"
  | "hrms"
  | "saas-dashboard"
  | "cms"
  | "booking"
  | "healthcare"
  | "education"
  | "social"
  | "generic";

export interface WorkflowStep {
  action: string;
  expectedResult: string;
}

export interface StandardWorkflow {
  name: string;
  description: string;
  steps: WorkflowStep[];
}

export interface ClassificationResult {
  websiteType: WebsiteType;
  confidence: "high" | "medium" | "low";
  detectedSignals: string[];
  standardWorkflows: StandardWorkflow[];
}

const STANDARD_WORKFLOWS: Record<WebsiteType, StandardWorkflow[]> = {
  ecommerce: [
    {
      name: "Browse and add to cart",
      description: "User browses products, views details, and adds to cart",
      steps: [
        { action: "Navigate to homepage", expectedResult: "Product listings visible" },
        { action: "Click on a product", expectedResult: "Product detail page loads" },
        { action: "Click Add to Cart", expectedResult: "Item added to cart, cart count updates" },
        { action: "Navigate to cart", expectedResult: "Cart displays added item" },
      ],
    },
    {
      name: "Checkout flow",
      description: "User completes a purchase",
      steps: [
        { action: "Navigate to cart", expectedResult: "Cart is visible" },
        { action: "Click Checkout", expectedResult: "Checkout form appears" },
        { action: "Fill shipping details", expectedResult: "Form accepts input" },
        { action: "Submit order", expectedResult: "Order confirmation page shown" },
      ],
    },
    {
      name: "Search for product",
      description: "User searches and filters products",
      steps: [
        { action: "Enter search term in search bar", expectedResult: "Search results appear" },
        { action: "Apply a filter", expectedResult: "Results narrow down" },
      ],
    },
  ],
  banking: [
    {
      name: "View account balance",
      description: "User logs in and checks balance",
      steps: [
        { action: "Log in with credentials", expectedResult: "Dashboard loads with account summary" },
        { action: "Navigate to accounts", expectedResult: "Account list with balances shown" },
        { action: "Click on an account", expectedResult: "Transaction history displayed" },
      ],
    },
    {
      name: "Fund transfer",
      description: "User transfers money between accounts",
      steps: [
        { action: "Navigate to Transfer section", expectedResult: "Transfer form visible" },
        { action: "Fill transfer amount and destination", expectedResult: "Form accepts valid input" },
        { action: "Submit transfer", expectedResult: "Confirmation screen shown" },
      ],
    },
  ],
  crm: [
    {
      name: "Create contact",
      description: "User creates a new CRM contact",
      steps: [
        { action: "Navigate to Contacts", expectedResult: "Contact list loads" },
        { action: "Click New Contact", expectedResult: "Create contact form opens" },
        { action: "Fill contact details", expectedResult: "Fields accept input" },
        { action: "Save contact", expectedResult: "Contact saved and appears in list" },
      ],
    },
    {
      name: "Search and update contact",
      description: "User finds and edits a contact",
      steps: [
        { action: "Search for a contact by name", expectedResult: "Matching contact appears" },
        { action: "Open the contact", expectedResult: "Contact details page loads" },
        { action: "Edit and save a field", expectedResult: "Changes persist" },
      ],
    },
  ],
  hrms: [
    {
      name: "Employee onboarding",
      description: "HR creates and sets up a new employee",
      steps: [
        { action: "Navigate to Employees", expectedResult: "Employee list loads" },
        { action: "Click Add Employee", expectedResult: "Employee form opens" },
        { action: "Fill employee information", expectedResult: "Form accepts input" },
        { action: "Save employee", expectedResult: "New employee appears in list" },
      ],
    },
    {
      name: "Leave request",
      description: "Employee applies for leave",
      steps: [
        { action: "Navigate to Leave section", expectedResult: "Leave request form visible" },
        { action: "Fill leave dates and reason", expectedResult: "Form accepts input" },
        { action: "Submit leave request", expectedResult: "Request submitted for approval" },
      ],
    },
  ],
  "saas-dashboard": [
    {
      name: "Create and manage resource",
      description: "User creates, views, edits, and deletes a resource",
      steps: [
        { action: "Navigate to main resource list", expectedResult: "Resource list loads" },
        { action: "Click Create / New button", expectedResult: "Creation form opens" },
        { action: "Fill required fields and save", expectedResult: "Resource created" },
        { action: "Edit the resource", expectedResult: "Edit form opens with existing data" },
        { action: "Save changes", expectedResult: "Updated data persists" },
      ],
    },
    {
      name: "Dashboard navigation",
      description: "User navigates through all main sections",
      steps: [
        { action: "Click each main navigation item", expectedResult: "Corresponding section loads" },
        { action: "Verify key metrics/widgets load", expectedResult: "Data is displayed" },
      ],
    },
  ],
  cms: [
    {
      name: "Publish content",
      description: "Editor creates and publishes a content item",
      steps: [
        { action: "Navigate to Content section", expectedResult: "Content list loads" },
        { action: "Click New / Add Content", expectedResult: "Content editor opens" },
        { action: "Fill title and body", expectedResult: "Editor accepts input" },
        { action: "Click Publish", expectedResult: "Content is published" },
      ],
    },
  ],
  booking: [
    {
      name: "Make a booking",
      description: "User searches availability and books",
      steps: [
        { action: "Search for available dates", expectedResult: "Availability calendar shown" },
        { action: "Select a slot/option", expectedResult: "Booking details form appears" },
        { action: "Fill personal details", expectedResult: "Form accepts input" },
        { action: "Confirm booking", expectedResult: "Booking confirmation shown" },
      ],
    },
  ],
  healthcare: [
    {
      name: "Patient registration",
      description: "Register a new patient",
      steps: [
        { action: "Navigate to Patient section", expectedResult: "Patient list loads" },
        { action: "Click Register New Patient", expectedResult: "Registration form opens" },
        { action: "Fill patient details", expectedResult: "Form accepts input" },
        { action: "Submit registration", expectedResult: "Patient record created" },
      ],
    },
  ],
  education: [
    {
      name: "Enroll in course",
      description: "Student browses and enrolls in a course",
      steps: [
        { action: "Browse course catalog", expectedResult: "Course list loads" },
        { action: "Click on a course", expectedResult: "Course detail page loads" },
        { action: "Click Enroll", expectedResult: "Enrollment confirmed" },
      ],
    },
  ],
  social: [
    {
      name: "Create and interact with post",
      description: "User creates a post and interacts",
      steps: [
        { action: "Click Create Post", expectedResult: "Post editor opens" },
        { action: "Write post content and submit", expectedResult: "Post appears in feed" },
        { action: "Like a post", expectedResult: "Like count updates" },
      ],
    },
  ],
  generic: [
    {
      name: "Page load verification",
      description: "Verify all discovered pages load correctly",
      steps: [
        { action: "Navigate to each page", expectedResult: "Page loads without errors" },
        { action: "Verify page title is present", expectedResult: "Title is not empty" },
      ],
    },
    {
      name: "Form submission",
      description: "Fill and submit all discovered forms",
      steps: [
        { action: "Navigate to page with form", expectedResult: "Form is visible" },
        { action: "Fill all form fields with test data", expectedResult: "Fields accept input" },
        { action: "Submit form", expectedResult: "Form submits without error" },
      ],
    },
  ],
};

/** Rule-based signals for fast classification without LLM. */
function classifyBySignals(
  pages: Array<{ url: string; title?: string | null; routePattern: string; formCount: number }>,
  domSummaries: Array<{ forms: string[]; actions: string[]; headings: string[] }>
): { type: WebsiteType; signals: string[] } {
  const allText = [
    ...pages.map((p) => `${p.url} ${p.title ?? ""} ${p.routePattern}`),
    ...domSummaries.flatMap((d) => [...d.forms, ...d.actions, ...d.headings]),
  ]
    .join(" ")
    .toLowerCase();

  const signals: string[] = [];

  if (/cart|checkout|product|shop|order|buy|price|add to cart/i.test(allText)) {
    signals.push("cart/checkout found", "product pages detected");
    return { type: "ecommerce", signals };
  }
  if (/transfer|balance|account.*number|iban|swift|transaction|bank|loan|deposit|withdraw/i.test(allText)) {
    signals.push("banking terms detected");
    return { type: "banking", signals };
  }
  if (/patient|diagnosis|prescription|clinical|ehr|medical record|appointment/i.test(allText)) {
    signals.push("healthcare terms detected");
    return { type: "healthcare", signals };
  }
  if (/employee|payroll|leave|attendance|hr|onboard|recruitment|salary/i.test(allText)) {
    signals.push("HR/employee terms detected");
    return { type: "hrms", signals };
  }
  if (/contact|lead|opportunity|pipeline|crm|deal|prospect/i.test(allText)) {
    signals.push("CRM terms detected");
    return { type: "crm", signals };
  }
  if (/course|enroll|lesson|student|assignment|grade|curriculum/i.test(allText)) {
    signals.push("education terms detected");
    return { type: "education", signals };
  }
  if (/reservation|booking|availability|check.in|check.out|slot/i.test(allText)) {
    signals.push("booking/reservation terms detected");
    return { type: "booking", signals };
  }
  if (/post|feed|follow|like|comment|profile|friend|share/i.test(allText)) {
    signals.push("social features detected");
    return { type: "social", signals };
  }
  if (/publish|content|article|blog|post|editor|draft|cms/i.test(allText)) {
    signals.push("CMS/publishing terms detected");
    return { type: "cms", signals };
  }
  if (/dashboard|analytics|settings|workspace|billing|subscription|plan|integration/i.test(allText)) {
    signals.push("SaaS dashboard patterns detected");
    return { type: "saas-dashboard", signals };
  }

  signals.push("no strong domain signals detected");
  return { type: "generic", signals };
}

/**
 * Classify the website type for a crawl run.
 * Stores the result in crawl_runs.config and returns the classification.
 */
export async function classifyWebsite(crawlRunId: string): Promise<ClassificationResult> {
  const pages = await db
    .select({
      id: automatedTestPages.id,
      url: automatedTestPages.sampleUrl,
      title: automatedTestPages.title,
      routePattern: automatedTestPages.routePattern,
      formCount: automatedTestPages.formCount,
    })
    .from(automatedTestPages)
    .where(eq(automatedTestPages.crawlRunId, crawlRunId))
    .limit(30);

  if (pages.length === 0) {
    return {
      websiteType: "generic",
      confidence: "low",
      detectedSignals: ["no pages discovered"],
      standardWorkflows: STANDARD_WORKFLOWS["generic"],
    };
  }

  // Gather DOM summaries for signal extraction
  const domSummaries: Array<{ forms: string[]; actions: string[]; headings: string[] }> = [];
  for (const page of pages.slice(0, 10)) {
    const [v] = await db
      .select({ domContract: pageDomVersions.domContract })
      .from(pageDomVersions)
      .where(eq(pageDomVersions.pageId, page.id))
      .orderBy(desc(pageDomVersions.extractedAt))
      .limit(1);
    if (v?.domContract) {
      const contract = v.domContract as any;
      domSummaries.push({
        forms: (contract.forms ?? []).map((f: any) => f.name ?? ""),
        actions: (contract.actions ?? []).map((a: any) => a.visibleText ?? ""),
        headings: [contract.pageMeta?.h1 ?? "", contract.pageMeta?.title ?? ""],
      });
    }
  }

  // Rule-based fast classification
  const { type: ruleType, signals } = classifyBySignals(
    pages.map((p) => ({
      url: p.url ?? "",
      title: p.title,
      routePattern: p.routePattern ?? "",
      formCount: p.formCount ?? 0,
    })),
    domSummaries
  );

  let finalType = ruleType;
  let confidence: ClassificationResult["confidence"] = ruleType !== "generic" ? "high" : "low";

  // LLM refinement for uncertain cases
  if (confidence !== "high") {
    const client = getSelectedLLM();
    if (client) {
      try {
        const pageList = pages
          .slice(0, 15)
          .map((p) => `${p.url} — ${p.title ?? p.routePattern}`)
          .join("\n");
        const systemPrompt = `You are a web application analyst. Given a list of page URLs and titles from a website crawl, classify the website type and return a JSON object:
{ "websiteType": "ecommerce|banking|crm|hrms|saas-dashboard|cms|booking|healthcare|education|social|generic", "confidence": "high|medium|low", "signals": ["signal 1", "signal 2"] }
Output only valid JSON. No markdown.`;
        const response = await client.chat.completions.create({
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: `Pages:\n${pageList}\n\nClassify this website.` },
          ],
          temperature: 0.1,
          max_tokens: 256,
        } as any);
        const content = (response as any).choices?.[0]?.message?.content ?? "";
        const raw = content.trim().replace(/^```json?\s*/i, "").replace(/\s*```$/, "");
        const parsed = JSON.parse(raw) as { websiteType?: WebsiteType; confidence?: string; signals?: string[] };
        if (parsed.websiteType) {
          finalType = parsed.websiteType;
          confidence = (parsed.confidence as ClassificationResult["confidence"]) ?? "medium";
          signals.push(...(parsed.signals ?? []));
        }
      } catch (e) {
        console.warn("[website-classifier] LLM classification failed:", (e as Error)?.message);
      }
    }
  }

  const workflows = STANDARD_WORKFLOWS[finalType] ?? STANDARD_WORKFLOWS["generic"];

  // Store classification back in crawl config
  const [runRow] = await db
    .select({ config: crawlRuns.config })
    .from(crawlRuns)
    .where(eq(crawlRuns.id, crawlRunId))
    .limit(1);

  const existingConfig = (runRow?.config as Record<string, unknown> | null) ?? {};
  await db
    .update(crawlRuns)
    .set({ config: { ...existingConfig, websiteType: finalType, websiteClassification: { confidence, signals } } })
    .where(eq(crawlRuns.id, crawlRunId));

  return {
    websiteType: finalType,
    confidence,
    detectedSignals: signals,
    standardWorkflows: workflows,
  };
}
