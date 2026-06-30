import { ai } from "../ai-client";
import type { UserStory } from "../../shared/schema";

export interface GeneratedFile {
  path: string;
  content: string;
}

export interface DevAgentResponse {
  files: GeneratedFile[];
}

export class DevAgent {
  constructor() {}

  async generateCode(userStory: UserStory, techStack: string, llmProvider: string = "azure-openai"): Promise<DevAgentResponse> {
    const prompt = this.buildPrompt(userStory, techStack);
    
    try {
      console.log(`[DevAgent] Sending prompt to LLM (${llmProvider})...`);
      
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
          console.warn("[DevAgent] Gemini support not yet implemented, falling back to Azure OpenAI");
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
            content: `You are a senior software developer. Generate code files for the given user story and tech stack.

CRITICAL INSTRUCTIONS:
1. You MUST respond with ONLY valid JSON, no other text, explanations, or markdown formatting
2. Do not use code blocks or any formatting - just raw JSON
3. The response must be parseable by JSON.parse()

Required JSON format:
{
  "files": [
    {
      "path": "src/components/LoginForm.tsx",
      "content": "import React from 'react';\\n\\nconst LoginForm = () => {\\n  return <div>Login Form</div>;\\n};\\n\\nexport default LoginForm;"
    }
  ]
}

Generate 2-4 essential files including:
- Main component/module
- Types/interfaces if needed
- Basic styles if applicable
- Simple test file

Use proper escaping for strings and newlines in the JSON content.`
          },
          {
            role: "user",
            content: prompt
          }
        ],
        temperature: 0.2,
        max_tokens: 3000,
      });

      const content = response.choices[0]?.message?.content?.trim();
      if (!content) {
        throw new Error("No content received from LLM");
      }

      console.log("[DevAgent] Raw LLM response length:", content.length);
      console.log("[DevAgent] First 200 chars of response:", content.substring(0, 200));

      // Clean up the response - remove any markdown formatting or extra text
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
      let parsedResponse: DevAgentResponse;
      try {
        parsedResponse = JSON.parse(cleanContent);
      } catch (parseError) {
        console.error("[DevAgent] Failed to parse LLM response as JSON. Raw content:", content);
        console.error("[DevAgent] Cleaned content:", cleanContent);
        console.error("[DevAgent] Parse error:", parseError);
        
        // Try to create a fallback response
        return this.createFallbackResponse(userStory, techStack);
      }

      // Validate the response structure
      if (!parsedResponse.files || !Array.isArray(parsedResponse.files)) {
        console.error("[DevAgent] Invalid response structure - no files arra y:", parsedResponse);
        return this.createFallbackResponse(userStory, techStack);
      }

      // Validate each file
      for (const file of parsedResponse.files) {
        if (!file.path || typeof file.content !== 'string') {
          console.error("[DevAgent] Invalid file structure:", file);
          return this.createFallbackResponse(userStory, techStack);
        }
      }

      console.log("[DevAgent] Successfully parsed response with", parsedResponse.files.length, "files");
      return parsedResponse;
    } catch (error) {
      console.error("[DevAgent] Error generating code:", error);
      throw error;
    }
  }

  private createFallbackResponse(userStory: UserStory, techStack: string): DevAgentResponse {
    console.log("[DevAgent] Creating fallback response for:", userStory.title);
    
    const componentName = userStory.title.replace(/[^a-zA-Z0-9]/g, '');
    const isReact = techStack.toLowerCase().includes('react');
    const isNode = techStack.toLowerCase().includes('node');
    
    const files: GeneratedFile[] = [];
    
    if (isReact) {
      // React component
      files.push({
        path: `src/components/${componentName}.tsx`,
        content: `import React, { useState } from 'react';

interface ${componentName}Props {
  // Define props here
}

const ${componentName}: React.FC<${componentName}Props> = () => {
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async () => {
    setIsLoading(true);
    try {
      // Implementation for: ${userStory.title}
      console.log('${userStory.description}');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="${componentName.toLowerCase()}">
      <h2>${userStory.title}</h2>
      <p>${userStory.description}</p>
      <button onClick={handleSubmit} disabled={isLoading}>
        {isLoading ? 'Loading...' : 'Submit'}
      </button>
    </div>
  );
};

export default ${componentName};
`
      });
      
      // CSS file
      files.push({
        path: `src/components/${componentName}.module.css`,
        content: `.${componentName.toLowerCase()} {
  padding: 1rem;
  border: 1px solid #ddd;
  border-radius: 8px;
  margin: 1rem 0;
}

.${componentName.toLowerCase()} h2 {
  color: #333;
  margin-bottom: 0.5rem;
}

.${componentName.toLowerCase()} button {
  background-color: #007bff;
  color: white;
  border: none;
  padding: 0.5rem 1rem;
  border-radius: 4px;
  cursor: pointer;
}

.${componentName.toLowerCase()} button:hover {
  background-color: #0056b3;
}

.${componentName.toLowerCase()} button:disabled {
  background-color: #ccc;
  cursor: not-allowed;
}
`
      });
    }
    
    if (isNode) {
      // Node.js service
      files.push({
        path: `src/services/${componentName}Service.ts`,
        content: `export interface ${componentName}Data {
  id?: string;
  // Add other properties based on requirements
}

export class ${componentName}Service {
  async process(data: ${componentName}Data): Promise<${componentName}Data> {
    try {
      // Implementation for: ${userStory.title}
      console.log('Processing:', data);
      
      // Business logic here
      return { ...data, id: Date.now().toString() };
    } catch (error) {
      console.error('Error in ${componentName}Service:', error);
      throw new Error('Failed to process ${componentName.toLowerCase()}');
    }
  }

  async validate(data: ${componentName}Data): Promise<boolean> {
    // Validation logic for: ${userStory.description}
    return data !== null && data !== undefined;
  }
}

export default new ${componentName}Service();
`
      });
    }

    return { files };
  }

  private buildPrompt(userStory: UserStory, techStack: string): string {
    // Handle acceptanceCriteria as array of strings (from frontend)
    const acceptanceCriteria = Array.isArray(userStory.acceptanceCriteria)
      ? userStory.acceptanceCriteria.map((criteria, idx) => `${idx + 1}. ${criteria}`).join('\n')
      : 'No specific criteria provided';

    return `Generate code files for this user story using ${techStack}:

**User Story:**
Title: ${userStory.title}
Description: ${userStory.description}

**Acceptance Criteria:**
${acceptanceCriteria}

**Tech Stack:** ${techStack}

**Requirements:**
- Generate 2-4 essential files for this user story
- Use TypeScript for type safety where applicable
- Include proper imports and exports
- Follow modern coding patterns and best practices
- Create clean, maintainable, and functional code
- Focus on the core functionality described in the user story

Please generate the implementation files needed for this feature.`;
  }
}