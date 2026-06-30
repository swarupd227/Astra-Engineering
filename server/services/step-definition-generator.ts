/**
 * Step Definition Generator Service (LLM-Powered)
 * Generates framework-specific step definitions using LLM with parallel processing
 */

import { anthropic, azureOpenAI, hasAnthropic, hasBedrock } from "../llm-config";
import {
  STEP_DEFINITION_PLAYWRIGHT_SYSTEM_PROMPT,
  getStepDefinitionPlaywrightUserPrompt,
} from "../prompts/prompt_step_definition_playwright";
import {
  STEP_DEFINITION_SELENIUM_SYSTEM_PROMPT,
  getStepDefinitionSeleniumUserPrompt,
} from "../prompts/prompt_step_definition_selenium";
import { NEW_API_MODEL_SUBSTRINGS } from "../llm-config-constants";

const useAnthropic = hasAnthropic || hasBedrock;

export interface FeatureFile {
  filename: string;
  content: string;
  category: string;
}

export interface StepDefinitionFile {
  filename: string;
  content: string;
  category: string;
  framework: string;
}

type TestFramework = 'playwright' | 'selenium';

export class StepDefinitionGenerator {
  private framework: TestFramework;

  constructor(framework: TestFramework = 'playwright') {
    this.framework = framework;
    console.log(`[StepDefinitionGenerator] Initialized with framework: ${framework}`);
  }

  /**
   * Generate step definition files from feature files using LLM (PARALLEL)
   */
  async generateStepDefinitions(
    featureFiles: FeatureFile[],
    userStory: any
  ): Promise<StepDefinitionFile[]> {
    console.log(`[StepDefinitionGenerator] Starting LLM-based ${this.framework} step definition generation`);
    console.log(`[StepDefinitionGenerator] Feature files count: ${featureFiles.length}`);

    // Generate all step definitions in parallel
    const stepDefPromises = featureFiles.map((featureFile) =>
      this.generateSingleStepDefinition(featureFile, userStory)
    );

    const stepDefFiles = await Promise.all(stepDefPromises);

    console.log(`[StepDefinitionGenerator] ✅ Successfully generated ${stepDefFiles.length} step definition files`);
    return stepDefFiles;
  }

  /**
   * Generate a single step definition file using LLM
   */
  private async generateSingleStepDefinition(
    featureFile: FeatureFile,
    userStory: any
  ): Promise<StepDefinitionFile> {
    console.log(`[StepDefinitionGenerator] 🚀 Generating ${featureFile.category} step definitions (${this.framework})`);

    try {
      const systemPrompt = this.getSystemPrompt();
      const userPrompt = this.getUserPrompt(featureFile, userStory);

      let response: string;

      if (useAnthropic && anthropic) {
        console.log(`[StepDefinitionGenerator] Using Anthropic Claude for ${featureFile.category}`);
        const startTime = Date.now();

        const message = await anthropic.chat.completions.create({
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
          temperature: 0.1,
          max_tokens: 15500, // Allow up to 15500 tokens, but prompt instructs to finish within 15000
        });

        const duration = ((Date.now() - startTime) / 1000).toFixed(2);
        console.log(`[StepDefinitionGenerator] ⏱️ ${featureFile.category} completed in ${duration}s`);

        response = message.choices[0]?.message?.content || "";
        
        // Check if response was truncated
        const finishReason = message.choices[0]?.finish_reason;
        if (finishReason === 'length' || finishReason === 'max_tokens') {
          console.error(`[StepDefinitionGenerator] ⚠️ Response truncated for ${featureFile.category} - max_tokens limit reached`);
          console.error(`[StepDefinitionGenerator] Response length: ${response.length} chars`);
          throw new Error(`Step definition generation truncated due to length. Generated code is incomplete.`);
        } else {
          console.log(`[StepDefinitionGenerator] Finish reason: ${finishReason}`);
        }
      } else if (azureOpenAI) {
        console.log(`[StepDefinitionGenerator] Using Azure OpenAI for ${featureFile.category}`);
        const startTime = Date.now();

        const deployment = process.env.AZURE_OPENAI_DEPLOYMENT || "gpt-4-turbo";
        const d = deployment.toLowerCase();
        const isNewModel = NEW_API_MODEL_SUBSTRINGS.some((m) => d.includes(m));

        const payload: any = {
          model: deployment,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
        };

        if (isNewModel) {
          payload.max_completion_tokens = 16000;
          payload.temperature = 1;
        } else {
          payload.max_tokens = 16000;
          payload.temperature = 0.1;
        }

        const message = await azureOpenAI.chat.completions.create(payload);

        const duration = ((Date.now() - startTime) / 1000).toFixed(2);
        console.log(`[StepDefinitionGenerator] ⏱️ ${featureFile.category} completed in ${duration}s`);

        response = message.choices[0]?.message?.content || "";
        
        // Check if response was truncated
        const finishReason = message.choices[0]?.finish_reason;
        if (finishReason === 'length' || finishReason === 'max_tokens') {
          console.error(`[StepDefinitionGenerator] ⚠️ Response truncated for ${featureFile.category} - max_tokens limit reached`);
          console.error(`[StepDefinitionGenerator] Response length: ${response.length} chars`);
          throw new Error(`Step definition generation truncated due to length. Generated code is incomplete.`);
        } else {
          console.log(`[StepDefinitionGenerator] Finish reason: ${finishReason}`);
        }
    } else {
        throw new Error("No LLM provider configured");
      }

      // Clean response (remove markdown blocks if present)
      response = this.cleanStepDefinitionContent(response);

      console.log(`[StepDefinitionGenerator] ✅ ${featureFile.category} step definitions generated (${response.length} chars)`);

      // Generate filename
      const filename = this.generateFilename(featureFile);
    
    return {
      filename,
        content: response,
        category: featureFile.category,
        framework: this.framework,
      };
    } catch (error: any) {
      console.error(`[StepDefinitionGenerator] ❌ Failed to generate ${featureFile.category} step definitions:`, error.message);
      throw new Error(`Failed to generate ${featureFile.category} step definitions: ${error.message}`);
    }
  }

  /**
   * Get system prompt based on framework
   */
  private getSystemPrompt(): string {
    if (this.framework === 'playwright') {
      return STEP_DEFINITION_PLAYWRIGHT_SYSTEM_PROMPT;
    } else if (this.framework === 'selenium') {
      return STEP_DEFINITION_SELENIUM_SYSTEM_PROMPT;
    } else {
      throw new Error(`Unsupported framework: ${this.framework}`);
    }
  }

  /**
   * Get user prompt based on framework
   */
  private getUserPrompt(featureFile: FeatureFile, userStory: any): string {
    if (this.framework === 'playwright') {
      return getStepDefinitionPlaywrightUserPrompt(
        featureFile.content,
        featureFile.category,
        userStory
      );
    } else if (this.framework === 'selenium') {
      return getStepDefinitionSeleniumUserPrompt(
        featureFile.content,
        featureFile.category,
        userStory
      );
    } else {
      throw new Error(`Unsupported framework: ${this.framework}`);
    }
  }

  /**
   * Clean step definition content (remove markdown blocks, extra whitespace)
   */
  private cleanStepDefinitionContent(content: string): string {
    // Remove markdown code blocks if present
    content = content.replace(/```typescript\n?/gi, '').replace(/```java\n?/gi, '').replace(/```\n?/g, '');
    
    // Remove any leading/trailing whitespace
    content = content.trim();
    
    // Framework-specific validation
    if (this.framework === 'playwright') {
      if (!content.includes('import') || !content.includes('Given') || !content.includes('When') || !content.includes('Then')) {
        console.warn('[StepDefinitionGenerator] ⚠️ Playwright content may be incomplete');
      }
    } else if (this.framework === 'selenium') {
      if (!content.startsWith('package') || !content.includes('@Given') || !content.includes('@When') || !content.includes('@Then')) {
        console.warn('[StepDefinitionGenerator] ⚠️ Selenium content may be incomplete');
      }
    }
    
    return content;
  }

  /**
   * Generate filename for step definition file
   */
  private generateFilename(featureFile: FeatureFile): string {
    const categorySlug = featureFile.category.toLowerCase().replace(/\s+/g, '-');
    
    if (this.framework === 'playwright') {
      return `${categorySlug}-steps.ts`;
    } else if (this.framework === 'selenium') {
      return `${this.capitalize(featureFile.category.replace(/\s+/g, ''))}StepDefinitions.java`;
    } else {
      return `${categorySlug}-steps.txt`;
    }
  }

  /**
   * Capitalize first letter
   */
  private capitalize(str: string): string {
    return str.charAt(0).toUpperCase() + str.slice(1);
  }
}
