import { DOMStructure } from './enhanced-crawler';
import pLimit from 'p-limit';
import pRetry from 'p-retry';
import { llm } from '../llm-config';

// Route all LLM calls through the hosting-aware unified facade. On AWS this
// dispatches to Bedrock Converse; on Azure it keeps using Azure OpenAI. The
// `openai.chat.completions.create(...)` call shape below is preserved so the
// rest of this file is unchanged. `response_format` is honored by Azure OpenAI
// and silently ignored by Bedrock — the JSON-fence fallback parser further
// down catches non-pure-JSON Bedrock output.
const openai = {
  chat: {
    completions: {
      create: (params: any) => llm.selected.chat.completions.create(params),
    },
  },
} as any;

export interface DOMTestCase {
  testId: string;
  pageUrl: string;
  pageTitle: string;
  category: 'workflow' | 'functional' | 'negative' | 'edge_case' | 'text_validation';
  name: string;
  priority: 'P1' | 'P2' | 'P3';
  steps: Array<{
    step_number: number;
    action: string;
    expected_behavior: string;
  }>;
}

export interface PageTestSuite {
  pageUrl: string;
  pageTitle: string;
  testCases: DOMTestCase[];
  generatedAt: string;
}

const SYSTEM_PROMPT = `You are an expert QA engineer specialized in generating FUNCTIONAL test cases from DOM analysis.

Your goal is to create meaningful, actionable test cases that test REAL USER WORKFLOWS and BUSINESS FUNCTIONALITY, not just verify element existence.

Generate test cases in these categories:
1. WORKFLOW: Multi-step user journeys (e.g., "Complete insurance quote request", "User registration flow", "Add item to cart and checkout")
2. FUNCTIONAL: Core feature tests (form submissions actually work, search returns results, filters apply correctly)
3. NEGATIVE: Error handling and edge cases (invalid inputs, network failures, boundary conditions)
4. EDGE_CASE: Unusual scenarios (empty states, maximum values, special characters, concurrent actions)
5. TEXT_VALIDATION: Critical content verification (error messages display correctly, success confirmations appear)

IMPORTANT GUIDELINES:
- Each test case must have 3-7 detailed steps that a real tester can follow
- Steps should describe ACTIONS the user takes and EXPECTED OUTCOMES
- Focus on testing BEHAVIOR, not just element presence
- Consider the page's PURPOSE based on its forms, buttons, and content
- For forms: test valid submission, validation errors, required fields
- For navigation: test that links go to correct destinations
- For interactive elements: test that clicking produces expected results

AVOID generating shallow tests like "Verify button exists" or "Check heading is present".
Instead create tests like "Submit contact form with valid data and verify success message".`;

function buildDOMPrompt(dom: DOMStructure): string {
  const parts: string[] = [];
  
  parts.push(`PAGE URL: ${dom.url}`);
  parts.push(`PAGE TITLE: ${dom.title}`);
  
  if (dom.meta.description) {
    parts.push(`META DESCRIPTION: ${dom.meta.description}`);
  }
  
  parts.push(`\nHEADINGS:`);
  if (dom.headings.h1.length > 0) parts.push(`  H1: ${dom.headings.h1.join(', ')}`);
  if (dom.headings.h2.length > 0) parts.push(`  H2: ${dom.headings.h2.slice(0, 5).join(', ')}`);
  
  if (dom.navigation.navLinks.length > 0) {
    parts.push(`\nNAVIGATION LINKS (${dom.navigation.navLinks.length} total):`);
    dom.navigation.navLinks.slice(0, 10).forEach(link => {
      parts.push(`  - "${link.text}" -> ${link.href}`);
    });
  }
  
  if (dom.forms.length > 0) {
    parts.push(`\nFORMS (${dom.forms.length}):`);
    dom.forms.forEach((form, i) => {
      parts.push(`  Form ${i + 1}: ${form.method} ${form.action || '(no action)'}`);
      parts.push(`    Fields: ${form.fields.map(f => `${f.label || f.name || f.type}${f.required ? '*' : ''}`).join(', ')}`);
      if (form.submitButton) parts.push(`    Submit: "${form.submitButton}"`);
    });
  }
  
  if (dom.interactiveElements.buttons.length > 0) {
    parts.push(`\nBUTTONS (${dom.interactiveElements.buttons.length}):`);
    dom.interactiveElements.buttons.slice(0, 15).forEach(btn => {
      parts.push(`  - "${btn.text}" (${btn.type})`);
    });
  }
  
  if (dom.interactiveElements.inputs.length > 0) {
    parts.push(`\nINPUTS (${dom.interactiveElements.inputs.length}):`);
    dom.interactiveElements.inputs.slice(0, 15).forEach(input => {
      const label = input.label || input.placeholder || input.name || 'unlabeled';
      parts.push(`  - ${input.type}: "${label}"${input.required ? ' (required)' : ''}`);
    });
  }
  
  if (dom.interactiveElements.selects.length > 0) {
    parts.push(`\nDROPDOWNS (${dom.interactiveElements.selects.length}):`);
    dom.interactiveElements.selects.forEach(sel => {
      parts.push(`  - "${sel.label || sel.name}": ${sel.options.slice(0, 5).join(', ')}${sel.options.length > 5 ? '...' : ''}`);
    });
  }
  
  const internalLinks = dom.interactiveElements.links.filter(l => !l.isExternal);
  const externalLinks = dom.interactiveElements.links.filter(l => l.isExternal);
  
  parts.push(`\nLINKS: ${internalLinks.length} internal, ${externalLinks.length} external`);
  
  if (dom.media.images.length > 0) {
    const withAlt = dom.media.images.filter(i => i.hasAlt).length;
    parts.push(`\nIMAGES: ${dom.media.images.length} total (${withAlt} with alt text)`);
  }
  
  if (dom.tables.length > 0) {
    parts.push(`\nTABLES (${dom.tables.length}):`);
    dom.tables.forEach((table, i) => {
      parts.push(`  Table ${i + 1}: ${table.headers.join(', ')} (${table.rowCount} rows)`);
    });
  }
  
  if (dom.modals.length > 0) {
    parts.push(`\nMODALS/DIALOGS: ${dom.modals.length}`);
  }
  
  parts.push(`\nACCESSIBILITY:`);
  parts.push(`  Skip link: ${dom.accessibility.hasSkipLink ? 'Yes' : 'No'}`);
  parts.push(`  Main landmark: ${dom.accessibility.hasMainLandmark ? 'Yes' : 'No'}`);
  parts.push(`  Nav landmark: ${dom.accessibility.hasNavLandmark ? 'Yes' : 'No'}`);
  if (dom.accessibility.imagesWithoutAlt > 0) {
    parts.push(`  Images without alt: ${dom.accessibility.imagesWithoutAlt}`);
  }
  if (dom.accessibility.buttonsWithoutLabel > 0) {
    parts.push(`  Buttons without label: ${dom.accessibility.buttonsWithoutLabel}`);
  }
  
  return parts.join('\n');
}

export class DOMTestGenerator {
  private testCounter = 0;
  private limit = pLimit(3);

  async generateTestCasesForPage(
    dom: DOMStructure,
    options?: { domain?: string; productContext?: string }
  ): Promise<DOMTestCase[]> {
    const domPrompt = buildDOMPrompt(dom);
    
    const contextInfo = options?.domain || options?.productContext
      ? `\n\nCONTEXT:\nDomain: ${options.domain || 'General'}\nProduct: ${options.productContext || 'Web Application'}`
      : '';

    const userPrompt = `Analyze this page's DOM structure and generate MEANINGFUL FUNCTIONAL test cases.

${domPrompt}${contextInfo}

Based on the page elements above, generate test cases that:
- Test REAL USER WORKFLOWS (not just "element exists" checks)
- Cover form submissions, button actions, and navigation flows
- Include negative scenarios (what happens with invalid data?)
- Consider the business purpose of the page

Generate test cases in this exact JSON format:
{
  "testCases": [
    {
      "category": "workflow|functional|negative|edge_case|text_validation",
      "name": "Descriptive test case name",
      "priority": "P1|P2|P3",
      "steps": [
        { "step_number": 1, "action": "What the user does", "expected_behavior": "What should happen" }
      ]
    }
  ]
}

Generate 5-12 meaningful functional test cases. Focus on testing BEHAVIOR, not element presence.`;

    try {
      const response = await pRetry(
        async () => {
          const completion = await openai.chat.completions.create({
            model: 'gpt-4o',
            messages: [
              { role: 'system', content: SYSTEM_PROMPT },
              { role: 'user', content: userPrompt }
            ],
            temperature: 0.3,
            max_tokens: 4000,
            response_format: { type: 'json_object' }
          });

          return completion;
        },
        {
          retries: 3,
          minTimeout: 2000,
          maxTimeout: 10000,
          onFailedAttempt: (error) => {
            console.log(`[DOMTestGenerator] Attempt ${error.attemptNumber} failed. Retrying...`);
          }
        }
      );

      const content = response.choices[0]?.message?.content;
      if (!content) {
        console.error('[DOMTestGenerator] Empty response from LLM');
        return [];
      }

      // Bedrock ignores `response_format: { type: 'json_object' }`, so the
      // model often wraps the JSON in ```json ... ``` fences. Strip those (and
      // any leading prose) before parsing so Autonomous Testing doesn't
      // silently fall back to rule-based output on AWS.
      let jsonStr = content.trim();
      if (jsonStr.includes('```json')) {
        jsonStr = jsonStr.split('```json')[1].split('```')[0].trim();
      } else if (jsonStr.includes('```')) {
        jsonStr = jsonStr.split('```')[1].split('```')[0].trim();
      } else if (!jsonStr.startsWith('{') && !jsonStr.startsWith('[')) {
        // Drop any prose preamble before the first JSON object/array
        const objMatch = jsonStr.match(/\{[\s\S]*\}/);
        if (objMatch) jsonStr = objMatch[0];
      }

      const parsed = JSON.parse(jsonStr);
      const testCases: DOMTestCase[] = (parsed.testCases || []).map((tc: any) => ({
        testId: this.generateTestId(),
        pageUrl: dom.url,
        pageTitle: dom.title,
        category: tc.category || 'functional',
        name: tc.name,
        priority: tc.priority || 'P2',
        steps: tc.steps || [],
      }));

      console.log(`[DOMTestGenerator] Generated ${testCases.length} test cases for ${dom.url}`);
      return testCases;
    } catch (error: any) {
      console.error(`[DOMTestGenerator] Failed to generate tests for ${dom.url}:`, error.message);
      return this.generateFallbackTests(dom);
    }
  }

  async generateTestsForAllPages(
    domStructures: DOMStructure[],
    onProgress?: (current: number, total: number, pageUrl: string) => void,
    options?: { domain?: string; productContext?: string }
  ): Promise<PageTestSuite[]> {
    const results: PageTestSuite[] = [];
    const total = domStructures.length;

    const tasks = domStructures.map((dom, index) =>
      this.limit(async () => {
        onProgress?.(index + 1, total, dom.url);
        
        const testCases = await this.generateTestCasesForPage(dom, options);
        
        const suite: PageTestSuite = {
          pageUrl: dom.url,
          pageTitle: dom.title,
          testCases,
          generatedAt: new Date().toISOString(),
        };
        
        results.push(suite);
        return suite;
      })
    );

    await Promise.all(tasks);

    results.sort((a, b) => a.pageUrl.localeCompare(b.pageUrl));

    console.log(`[DOMTestGenerator] Generated test suites for ${results.length} pages`);
    return results;
  }

  private generateFallbackTests(dom: DOMStructure): DOMTestCase[] {
    const tests: DOMTestCase[] = [];

    tests.push({
      testId: this.generateTestId(),
      pageUrl: dom.url,
      pageTitle: dom.title,
      category: 'functional',
      name: `${dom.title || 'Page'} - Page Load and Navigation`,
      priority: 'P1',
      steps: [
        { step_number: 1, action: `Navigate to ${dom.url}`, expected_behavior: 'Page loads without errors within 3 seconds' },
        { step_number: 2, action: 'Verify page responds to user interaction', expected_behavior: 'Page is interactive and not frozen' },
        { step_number: 3, action: 'Check browser back/forward navigation', expected_behavior: 'Navigation history works correctly' },
      ]
    });

    if (dom.forms.length > 0) {
      dom.forms.slice(0, 2).forEach((form, i) => {
        const requiredFields = form.fields.filter(f => f.required);
        tests.push({
          testId: this.generateTestId(),
          pageUrl: dom.url,
          pageTitle: dom.title,
          category: 'workflow',
          name: `${dom.title || 'Page'} - Complete Form ${i + 1} Submission`,
          priority: 'P1',
          steps: [
            { step_number: 1, action: 'Navigate to page and locate form', expected_behavior: 'Form is visible and accessible' },
            { step_number: 2, action: `Fill in all required fields: ${requiredFields.map(f => f.label || f.name || f.type).join(', ') || 'form fields'}`, expected_behavior: 'Fields accept valid input' },
            { step_number: 3, action: `Click "${form.submitButton || 'Submit'}" button`, expected_behavior: 'Form submits successfully' },
            { step_number: 4, action: 'Observe response', expected_behavior: 'Success message appears or page navigates appropriately' },
          ]
        });

        tests.push({
          testId: this.generateTestId(),
          pageUrl: dom.url,
          pageTitle: dom.title,
          category: 'negative',
          name: `${dom.title || 'Page'} - Form ${i + 1} Validation Errors`,
          priority: 'P2',
          steps: [
            { step_number: 1, action: 'Navigate to page and locate form', expected_behavior: 'Form is visible' },
            { step_number: 2, action: 'Leave required fields empty and click submit', expected_behavior: 'Form does not submit' },
            { step_number: 3, action: 'Check for error messages', expected_behavior: 'Clear validation error messages appear for empty required fields' },
            { step_number: 4, action: 'Enter invalid data (e.g., invalid email format)', expected_behavior: 'Appropriate validation error is shown' },
          ]
        });
      });
    }

    if (dom.interactiveElements.buttons.length > 0) {
      const primaryButtons = dom.interactiveElements.buttons.slice(0, 3);
      tests.push({
        testId: this.generateTestId(),
        pageUrl: dom.url,
        pageTitle: dom.title,
        category: 'functional',
        name: `${dom.title || 'Page'} - Primary Button Actions`,
        priority: 'P1',
        steps: [
          { step_number: 1, action: 'Navigate to page', expected_behavior: 'Page loads with buttons visible' },
          { step_number: 2, action: `Click on "${primaryButtons[0]?.text || 'primary button'}"`, expected_behavior: 'Button triggers expected action (form submit, navigation, or modal)' },
          { step_number: 3, action: 'Verify the result of the action', expected_behavior: 'Expected outcome occurs (page change, data update, or feedback shown)' },
        ]
      });
    }

    if (dom.navigation.navLinks.length > 0) {
      tests.push({
        testId: this.generateTestId(),
        pageUrl: dom.url,
        pageTitle: dom.title,
        category: 'workflow',
        name: `${dom.title || 'Page'} - Navigation Flow`,
        priority: 'P2',
        steps: [
          { step_number: 1, action: 'Navigate to page', expected_behavior: 'Page loads with navigation visible' },
          { step_number: 2, action: `Click on "${dom.navigation.navLinks[0]?.text || 'navigation link'}"`, expected_behavior: 'Navigates to correct destination' },
          { step_number: 3, action: 'Verify destination page loads', expected_behavior: 'Target page content appears' },
          { step_number: 4, action: 'Use browser back button', expected_behavior: 'Returns to original page' },
        ]
      });
    }

    return tests;
  }

  private generateTestId(): string {
    this.testCounter++;
    return `DOM-TC-${String(this.testCounter).padStart(4, '0')}`;
  }

  reset(): void {
    this.testCounter = 0;
  }
}

export const domTestGenerator = new DOMTestGenerator();
