/**
 * LLM prompt for generating autonomous test cases from discovered pages and DOM contracts.
 */

export const AUTONOMOUS_TEST_CASES_SYSTEM_PROMPT = `You are an expert QA engineer. Given a list of discovered web pages with their DOM structure (forms, fields, buttons, links), generate structured test cases for automated UI testing.

Output ONLY valid JSON with this exact structure (no markdown, no code blocks):
{
  "testCases": [
    {
      "caseCode": "TC-0001",
      "title": "Short descriptive title",
      "testType": "ui | form_submit | navigation | action",
      "pageIdRef": "page index or id used in input (0-based)",
      "steps": [
        { "action": "What to do", "expectedResult": "What should happen" }
      ]
    }
  ]
}

Rules:
- Assign caseCode in order: TC-0001, TC-0002, TC-0003, ...
- testType: use "ui" for page load/smoke, "form_submit" for form submission, "navigation" for links, "action" for buttons/CTAs
- Include one "ui" test per page (e.g. "Page title loads successfully")
- Include one test per form (form_submit) and one per key button/link (action/navigation) when they add value
- steps: array of { action, expectedResult }; keep 1-4 steps per test; keep each string on one line and under 200 characters (no raw line breaks inside JSON strings)
- pageIdRef: must match the page identifier you received (e.g. page index 0, 1, 2)
- Base titles and steps on the actual page title, form names, and button/link labels from the input
- Do not invent elements that are not in the provided DOM summary`;

export function getAutonomousTestCasesUserPrompt(
  pages: Array<{
    pageId: string;
    pageIndex: number;
    url: string;
    title?: string | null;
    routePattern: string;
    domSummary: {
      pageMeta?: { title?: string; h1?: string };
      forms?: Array<{ name?: string; fieldCount?: number; method?: string }>;
      actions?: Array<{ type: string; visibleText?: string }>;
    };
  }>,
  testFocus: string = "all",
  requirementsContext?: string
): string {
  const blocks = pages.map(
    (p, i) => `
Page ${i} (pageId: ${p.pageId}):
  URL: ${p.url}
  Title: ${p.title ?? "(none)"}
  Route: ${p.routePattern}
  DOM:
    - Forms: ${(p.domSummary.forms ?? []).map((f) => `${f.name || "unnamed"} (${f.fieldCount ?? 0} fields, ${f.method ?? "GET"})`).join("; ") || "none"}
    - Actions/buttons/links: ${(p.domSummary.actions ?? []).map((a) => `"${(a.visibleText || a.type || "").slice(0, 60)}" (${a.type})`).join("; ") || "none"}
`
  );
  // Added today: Dynamically inject strict explicit limits to ensure LLMs avoid generating out-of-scope interactions
  let focusInstruction = "Generate test cases covering all types of interactions (page loads, forms, buttons, links).";
  if (testFocus === "forms") {
    focusInstruction = "Focus strictly on form validations and submissions. Ignore generic navigation and unrelated buttons.";
  } else if (testFocus === "navigation") {
    focusInstruction = "Focus directly on navigation links and application routing. Ignore forms and unrelated buttons.";
  } else if (testFocus === "buttons") {
    focusInstruction = "Focus directly on button clicks and CTA functionality. Ignore forms and navigation links.";
  }

  const requirementsSection = requirementsContext
    ? `\nRequirements context (use this to guide and prioritize test case generation):\n${requirementsContext}\n`
    : "";

  return `${focusInstruction}
${requirementsSection}
Generate test cases for the following discovered pages. Use the exact pageId values for pageIdRef so we can map back.

${blocks.join("\n")}

Return ONLY the JSON object with a "testCases" array. No other text.`;
}
