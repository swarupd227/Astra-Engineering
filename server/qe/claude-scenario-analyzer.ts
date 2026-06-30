import { qeAnthropicClient as anthropic } from './ai-client.js';
import pRetry from "p-retry";

export interface InsuranceScenario {
  id: string;
  title: string;
  description: string;
  businessValue: string;
  category: "workflow" | "text_validation" | "functional" | "negative" | "edge_case";
  priority: "P0" | "P1" | "P2" | "P3";
  userStory: string;
  acceptanceCriteria: string[];
  relatedElements: string[];
}

function isRateLimitError(error: any): boolean {
  if (!error) return false;
  const errorMsg = error.message || error.toString();
  return (
    errorMsg.includes("rate_limit") ||
    errorMsg.includes("429") ||
    errorMsg.toLowerCase().includes("rate limit")
  );
}

export async function analyzeInsuranceScenarios(
  pages: any[],
  domain: string = "insurance",
  productDescription: string = ""
): Promise<InsuranceScenario[]> {
  console.log(`[${domain.charAt(0).toUpperCase() + domain.slice(1)} Expert] Analyzing ${pages.length} pages for ${domain} scenarios...`);

  // Include ALL elements - don't truncate. This is critical for relevance.
  const pagesData = pages.map(page => ({
    url: page.url,
    title: page.title,
    buttons: page.buttons || [],
    inputs: page.inputs || [],
    links: (page.links || []).slice(0, 30), // Only limit links as they can be excessive
    forms: page.forms || [],
  }));

  const productContext = productDescription ? `\n\nPRODUCT CONTEXT:\n${productDescription}\n` : "";

  const prompt = `You are an expert QA Engineer analyzing a web application to create test scenarios.${productContext}

CRAWLED PAGES DATA (ACTUAL UI ELEMENTS FROM THE WEBSITE):
${JSON.stringify(pagesData, null, 2)}

CRITICAL INSTRUCTIONS:
You MUST create test scenarios ONLY for elements that ACTUALLY EXIST in the crawled data above.
DO NOT invent or assume any UI elements, buttons, forms, or features that are not explicitly listed.
Every scenario MUST reference specific buttons, inputs, or links from the crawled data.

TASK:
Analyze the ACTUAL UI elements from the crawled pages and create test scenarios for what EXISTS on this website.

For each scenario:
1. Look at the actual buttons, inputs, forms, and links in the data
2. Create a scenario that tests those SPECIFIC elements
3. Use the EXACT text/labels from the crawled data (e.g., if there's a button with text "Get Started", use that exact text)

SCENARIO CATEGORIES:
- "workflow": Multi-step user journeys using actual navigation/buttons found on the site
- "functional": Testing specific features/buttons that exist on the pages
- "text_validation": Validating actual input fields and forms found in the data
- "negative": Error handling for the actual forms/inputs present
- "edge_case": Boundary testing for actual input fields

For each scenario, provide:
- id: Unique identifier (SCENARIO-001, SCENARIO-002, etc.)
- title: Scenario name referencing ACTUAL page elements
- description: What this tests, mentioning SPECIFIC elements from the crawled data
- businessValue: Why testing this matters
- category: One of: "workflow", "text_validation", "functional", "negative", "edge_case"
- priority: "P0" (critical), "P1" (high), "P2" (medium), "P3" (low)
- userStory: As a [role], I want to [specific action from page], so that [benefit]
- acceptanceCriteria: Array of criteria referencing ACTUAL UI elements
- relatedElements: Array of EXACT button text, input labels, link text from the crawled data
- sourceUrl: The URL where these elements were found

STRICT RULES:
1. ONLY use elements that appear in the CRAWLED PAGES DATA above
2. If a button says "Sign Up", use "Sign Up" exactly - don't change it to "Register"
3. DO NOT generate generic industry scenarios - only test what's on THIS website
4. Every relatedElements entry MUST be copied exactly from the crawled data
5. Generate 8-15 focused scenarios (quality over quantity)
6. No emoji

OUTPUT FORMAT:
Return a valid JSON array of scenario objects.

Return ONLY the JSON array, no markdown formatting.`;

  return await pRetry(
    async () => {
      try {
        console.log('[Insurance Expert] Sending streaming analysis request to Claude API...');
        
        // Use streaming to avoid timeout issues with long operations
        let responseText = '';
        const stream = await anthropic.messages.stream({
          model: "claude-sonnet-4-5",
          max_tokens: 16384,
          temperature: 0.5,
          messages: [{ role: "user", content: prompt }],
        });
        
        // Collect all streamed text
        for await (const event of stream) {
          if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
            responseText += event.delta.text;
          }
        }
        
        console.log('[Insurance Expert] Received complete response from Claude API');
        responseText = responseText.trim();
        console.log(`[Insurance Expert] Response length: ${responseText.length} characters`);
        responseText = responseText.replace(/```json\n?/g, "").replace(/```\n?/g, "");

        let scenarios;
        try {
          console.log('[Insurance Expert] Parsing JSON response...');
          scenarios = JSON.parse(responseText);
          console.log('[Insurance Expert] Successfully parsed JSON');
        } catch (parseError) {
          console.error("[Insurance Expert] JSON parse error:", parseError);
          console.error("[Insurance Expert] Response text:", responseText.substring(0, 500));
          throw new Error("Failed to parse Claude response as JSON");
        }

        if (!Array.isArray(scenarios)) {
          console.log('[Insurance Expert] Response is not an array, searching for array in object...');
          if (scenarios && typeof scenarios === "object") {
            const possibleArrayKeys = ["scenarios", "testScenarios", "insuranceScenarios"];
            for (const key of possibleArrayKeys) {
              if (Array.isArray(scenarios[key])) {
                console.log(`[Insurance Expert] Found array at key: ${key}`);
                scenarios = scenarios[key];
                break;
              }
            }
          }
          if (!Array.isArray(scenarios)) {
            console.error('[Insurance Expert] No array found in response');
            throw new Error("Claude response is not an array and no array found in object");
          }
        }

        console.log(`[Insurance Expert] Processing ${scenarios.length} scenarios...`);
        const processedScenarios = scenarios.map((sc: any, index: number) => ({
          id: sc.id || `SCENARIO-${String(index + 1).padStart(3, "0")}`,
          title: sc.title || "Untitled Scenario",
          description: sc.description || "",
          businessValue: sc.businessValue || "",
          category: sc.category || "functional",
          priority: sc.priority || "P2",
          userStory: sc.userStory || "",
          acceptanceCriteria: Array.isArray(sc.acceptanceCriteria) ? sc.acceptanceCriteria : [],
          relatedElements: Array.isArray(sc.relatedElements) ? sc.relatedElements : [],
        }));

        console.log(`[Insurance Expert] Successfully processed ${processedScenarios.length} scenarios`);
        return processedScenarios;
      } catch (error: any) {
        console.error('[Insurance Expert] Error in analysis:', error);
        if (isRateLimitError(error)) {
          console.log('[Insurance Expert] Rate limit error detected, will retry');
          throw error;
        }
        console.log('[Insurance Expert] Non-retryable error, aborting');
        const abortError: any = new Error("Non-retryable error");
        abortError.name = "AbortError";
        throw abortError;
      }
    },
    {
      retries: 3,
      minTimeout: 2000,
      maxTimeout: 5000,
      onFailedAttempt: (error: any) => {
        console.log(
          `[Insurance Expert] Attempt ${error.attemptNumber} failed. ${error.retriesLeft} retries left. Error: ${error.message || 'Unknown error'}`
        );
      },
    }
  );
}
