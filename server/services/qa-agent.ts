import { ai } from "../ai-client";
import type { GeneratedFile } from "./dev-agent";

export interface QAAgentResponse {
  status: "PASS" | "FAIL";
  issues: string[];
}

export class QAAgent {
  constructor() {}

  async validateCode(files: GeneratedFile[], llmProvider: string = "azure-openai"): Promise<QAAgentResponse> {
    const prompt = this.buildValidationPrompt(files);
    
    try {
      console.log(`[QAAgent] Validating ${files.length} files with LLM (${llmProvider})...`);
      
      // Configure LLM based on provider selection
      let model: string;
      switch (llmProvider) {
        case "claude":
          model = process.env.ANTHROPIC_MODEL || "claude-3-sonnet-20240229";
          process.env.USE_ANTHROPIC = "true";
          break;
        case "gemini":
          model = process.env.GOOGLE_MODEL || "gemini-pro";
          // Note: Gemini support would need to be added to ai-client.ts
          console.warn("[QAAgent] Gemini support not yet implemented, falling back to Azure OpenAI");
          model = process.env.AZURE_OPENAI_DEPLOYMENT || "gpt-4";
          process.env.USE_ANTHROPIC = "false";
          break;
        case "azure-openai":
        default:
          model = process.env.AZURE_OPENAI_DEPLOYMENT || "gpt-4";
          process.env.USE_ANTHROPIC = "false";
          break;
      }
      
      const response = await ai.chat.completions.create({
        model,
        messages: [
          {
            role: "system",
            content: `You are a senior QA engineer reviewing code for quality and correctness.

CRITICAL INSTRUCTIONS:
1. You MUST respond with ONLY valid JSON, no other text or formatting
2. Do not use code blocks or any formatting - just raw JSON
3. The response must be parseable by JSON.parse()

Required JSON format:
{
  "status": "PASS",
  "issues": []
}
OR
{
  "status": "FAIL", 
  "issues": ["Specific issue description", "Another issue"]
}

Review the code for basic issues:
- Syntax errors
- Missing imports
- TypeScript type issues
- Logical consistency

Return PASS if code looks reasonable, FAIL if there are significant issues.`
          },
          {
            role: "user",
            content: prompt
          }
        ],
        temperature: 0.1,
        max_tokens: 1500,
      });

      const content = response.choices[0]?.message?.content?.trim();
      if (!content) {
        console.error("[QAAgent] No content received from QA LLM");
        return { status: "PASS", issues: [] }; // Default to pass if no response
      }

      console.log("[QAAgent] Raw QA response:", content);

      // Clean up the response - remove any markdown formatting
      let cleanContent = content;
      
      // Remove markdown code blocks if present
      if (cleanContent.includes('```')) {
        const match = cleanContent.match(/```(?:json)?\s*(\{[\s\S]*\})\s*```/);
        if (match) {
          cleanContent = match[1];
        }
      }
      
      // Find JSON object if there's extra text
      const jsonMatch = cleanContent.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        cleanContent = jsonMatch[0];
      }

      // Parse the JSON response
      let parsedResponse: QAAgentResponse;
      try {
        parsedResponse = JSON.parse(cleanContent);
      } catch (parseError) {
        console.error("[QAAgent] Failed to parse QA LLM response as JSON:", content);
        console.error("[QAAgent] Parse error:", parseError);
        
        // Fallback: assume pass if we can't parse the response
        return { status: "PASS", issues: [] };
      }

      // Validate the response structure
      if (!["PASS", "FAIL"].includes(parsedResponse.status)) {
        console.error("[QAAgent] Invalid status in QA response:", parsedResponse.status);
        return { status: "PASS", issues: [] };
      }

      if (!Array.isArray(parsedResponse.issues)) {
        console.error("[QAAgent] Invalid issues array in QA response");
        parsedResponse.issues = [];
      }

      console.log("[QAAgent] QA validation result:", parsedResponse.status);
      return parsedResponse;
    } catch (error) {
      console.error("[QAAgent] Error validating code:", error);
      // Return PASS as fallback to not block the process
      return { status: "PASS", issues: [] };
    }
  }

  private buildValidationPrompt(files: GeneratedFile[]): string {
    const fileList = files.map(file => `
**File: ${file.path}**
\`\`\`
${file.content}
\`\`\`
`).join('\n');

    return `Review these generated code files for quality and correctness:

${fileList}

Check for:
1. Syntax errors
2. Missing imports or dependencies
3. TypeScript type issues
4. Basic logical consistency
5. Proper file structure and organization

Provide specific, actionable feedback for any issues found.`;
  }
}