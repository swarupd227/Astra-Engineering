import { qeAnthropicClient as anthropic } from './ai-client.js';
import pRetry from "p-retry";
import pLimit from "p-limit";
import type { PageInfo } from "./playwright-service";
import type { WorkflowStep } from "@shared/qe-schema";

const limit = pLimit(3);

function isRateLimitError(error: any): boolean {
  if (!error) return false;
  const errorMsg = error.message || error.toString();
  return (
    errorMsg.includes("rate_limit") ||
    errorMsg.includes("429") ||
    errorMsg.toLowerCase().includes("rate limit")
  );
}

export interface DiscoveredWorkflow {
  id: string;
  name: string;
  type: 'form_submission' | 'navigation_path' | 'cta_flow' | 'user_interaction';
  entryPoint: string;
  steps: WorkflowStep[];
  confidence: number;
  description?: string;
}

export async function analyzeWorkflowsWithClaude(
  pages: PageInfo[]
): Promise<DiscoveredWorkflow[]> {
  const pagesData = pages.map(page => ({
    url: page.url,
    title: page.title,
    h1: page.h1,
    forms: page.forms.length,
    buttons: page.buttons.map(b => ({
      text: b.text,
      selector: b.selector,
    })),
    inputs: page.inputs.map(i => ({
      type: i.type,
      name: i.name,
      placeholder: i.placeholder,
      displayLabel: i.displayLabel,
    })),
    links: page.links.slice(0, 10),
  }));

  const prompt = `You are an expert QA automation engineer analyzing a website's structure to discover user workflows and interactions.

CRAWLED PAGES DATA:
${JSON.stringify(pagesData, null, 2)}

TASK:
Analyze the crawled pages and identify distinct user workflows. A workflow is a sequence of user interactions that achieves a specific goal.

WORKFLOW TYPES TO IDENTIFY:
1. form_submission: User fills out and submits a form
2. navigation_path: User navigates through multiple pages to reach content
3. cta_flow: User clicks call-to-action buttons to perform actions
4. user_interaction: Other meaningful user interactions (search, filtering, etc.)

FOR EACH WORKFLOW, PROVIDE:
1. Unique ID (workflow-1, workflow-2, etc.)
2. Descriptive name (e.g., "Contact Form Submission", "Product Search Flow")
3. Type (form_submission, navigation_path, cta_flow, user_interaction)
4. Entry point URL
5. Steps array with:
   - action: "navigate", "fill", "click", "select", "type"
   - description: Human-readable description of the action
   - selector: CSS selector for the element (if applicable)
   - expectedOutcome: What should happen after this step
6. Confidence score (0.0 to 1.0) based on how clear the workflow is
7. Description: Brief explanation of what this workflow accomplishes

ANALYSIS GUIDELINES:
- Identify 5-15 workflows depending on site complexity
- Prioritize workflows with forms, buttons, and interactive elements
- Ensure workflows are realistic user journeys
- Include sufficient detail for test automation
- Confidence should be lower for ambiguous workflows

OUTPUT FORMAT:
Return a valid JSON array of workflow objects. Each workflow must have:
{
  "id": "workflow-1",
  "name": "Clear Workflow Name",
  "type": "form_submission|navigation_path|cta_flow|user_interaction",
  "entryPoint": "https://example.com/page",
  "steps": [
    {
      "action": "navigate|fill|click|select|type",
      "description": "User-friendly description",
      "selector": "CSS selector (optional)",
      "expectedOutcome": "Expected result"
    }
  ],
  "confidence": 0.85,
  "description": "What this workflow achieves"
}

Return ONLY the JSON array, no markdown formatting.`;

  return await pRetry(
    async () => {
      try {
        const message = await anthropic.messages.create({
          model: "claude-sonnet-4-5",
          max_tokens: 8192,
          temperature: 0.5,
          messages: [{ role: "user", content: prompt }],
        });

        const content = message.content[0];
        if (content.type !== "text") {
          throw new Error("Unexpected response type from Claude");
        }

        let responseText = content.text.trim();
        responseText = responseText.replace(/```json\n?/g, "").replace(/```\n?/g, "");
        
        const workflows = JSON.parse(responseText);
        
        if (!Array.isArray(workflows)) {
          throw new Error("Claude response is not an array");
        }

        return workflows.map((wf: any, index: number) => ({
          id: wf.id || `workflow-${index + 1}`,
          name: wf.name || "Unnamed Workflow",
          type: wf.type || "user_interaction",
          entryPoint: wf.entryPoint || pages[0]?.url || "",
          steps: wf.steps || [],
          confidence: wf.confidence || 0.5,
          description: wf.description || "",
        }));
      } catch (error: any) {
        if (isRateLimitError(error)) {
          throw error;
        }
        const abortError: any = new Error("Non-retryable error");
        abortError.name = "AbortError";
        throw abortError;
      }
    },
    {
      retries: 3,
      minTimeout: 2000,
      maxTimeout: 5000,
      onFailedAttempt: (error) => {
        console.log(
          `Claude workflow analysis attempt ${error.attemptNumber} failed. ${error.retriesLeft} retries left.`
        );
      },
    }
  );
}
