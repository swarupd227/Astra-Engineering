/**
 * Feature File Generator Service (LLM-Powered)
 * Generates Gherkin feature files using LLM with parallel processing
 */

import { anthropic, azureOpenAI, hasAnthropic, hasBedrock } from "../llm-config";
import {
  FEATURE_FILE_SYSTEM_PROMPT,
  getFeatureFileUserPrompt,
} from "../prompts/prompt_feature_file_generation";
import { NEW_API_MODEL_SUBSTRINGS } from "../llm-config-constants";

const useAnthropic = hasAnthropic || hasBedrock;

export interface TestCase {
  id: string;
  title: string;
  category: string;
  priority: string;
  preconditions: string[];
  testCaseSteps?: Array<{
    Steps: number;
    Action: string;
    "Expected Results": string;
  }>;
  steps?: Array<{
    step: number;
    action: string;
    expectedResult: string;
  }>;
  postconditions: string[];
}

export interface FeatureFile {
  filename: string;
  content: string;
  category: string;
}

export class FeatureFileGenerator {
  /**
   * Generate feature files from categorized test cases using LLM (PARALLEL)
   */
  async generateFeatureFiles(
    testCases: {
      // Core test types
      functional?: TestCase[];
      negative?: TestCase[];
      edgeCases?: TestCase[];
      accessibility?: TestCase[];
      // Extended test types
      performance?: TestCase[];
      security?: TestCase[];
      usability?: TestCase[];
      reliability?: TestCase[];
    },
    userStory: any
  ): Promise<FeatureFile[]> {
    const categories: Array<{
      key: 'functional' | 'negative' | 'edgeCases' | 'accessibility' | 'performance' | 'security' | 'usability' | 'reliability';
      name: string;
      tests: TestCase[];
    }> = [];

    if (testCases.functional && testCases.functional.length > 0) {
      categories.push({ key: 'functional', name: 'Functional', tests: testCases.functional });
    }
    if (testCases.negative && testCases.negative.length > 0) {
      categories.push({ key: 'negative', name: 'Negative', tests: testCases.negative });
    }
    if (testCases.edgeCases && testCases.edgeCases.length > 0) {
      categories.push({ key: 'edgeCases', name: 'Edge Cases', tests: testCases.edgeCases });
    }
    if (testCases.accessibility && testCases.accessibility.length > 0) {
      categories.push({ key: 'accessibility', name: 'Accessibility', tests: testCases.accessibility });
    }
    if (testCases.performance && testCases.performance.length > 0) {
      categories.push({ key: 'performance', name: 'Performance', tests: testCases.performance });
    }
    if (testCases.security && testCases.security.length > 0) {
      categories.push({ key: 'security', name: 'Security', tests: testCases.security });
    }
    if (testCases.usability && testCases.usability.length > 0) {
      categories.push({ key: 'usability', name: 'Usability', tests: testCases.usability });
    }
    if (testCases.reliability && testCases.reliability.length > 0) {
      categories.push({ key: 'reliability', name: 'Reliability', tests: testCases.reliability });
    }

    const featureFilePromises = categories.map((category) =>
      this.generateSingleFeatureFile(category.tests, category.key, category.name, userStory)
    );

    return await Promise.all(featureFilePromises);
  }

  /**
   * Generate a single feature file using LLM
   */
  private async generateSingleFeatureFile(
    testCases: TestCase[],
    categoryKey: string,
    categoryName: string,
    userStory: any
  ): Promise<FeatureFile> {
    console.log(`[FeatureFileGenerator] 🚀 Generating ${categoryName} feature file (${testCases.length} test cases)`);

    try {
      const systemPrompt = FEATURE_FILE_SYSTEM_PROMPT;
      const userPrompt = getFeatureFileUserPrompt(testCases, categoryKey as any, userStory);

      let response: string;

      if (useAnthropic && anthropic) {
        console.log(`[FeatureFileGenerator] Using Anthropic Claude for ${categoryName}`);
        const startTime = Date.now();

        const message = await anthropic.chat.completions.create({
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
          temperature: 0.1,
          max_tokens: 4000, // Feature files are concise
        });

        const duration = ((Date.now() - startTime) / 1000).toFixed(2);
        console.log(`[FeatureFileGenerator] ⏱️ ${categoryName} completed in ${duration}s`);

        response = message.choices[0]?.message?.content || "";
      } else if (azureOpenAI) {
        console.log(`[FeatureFileGenerator] Using Azure OpenAI for ${categoryName}`);
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
          payload.max_completion_tokens = 4000;
          payload.temperature = 1;
        } else {
          payload.max_tokens = 4000;
          payload.temperature = 0.1;
        }

        const message = await azureOpenAI.chat.completions.create(payload);

        const duration = ((Date.now() - startTime) / 1000).toFixed(2);
        console.log(`[FeatureFileGenerator] ⏱️ ${categoryName} completed in ${duration}s`);

        response = message.choices[0]?.message?.content || "";
      } else {
        throw new Error("No LLM provider configured");
      }

      // Clean response (remove markdown blocks if present)
      response = this.cleanFeatureFileContent(response);

      console.log(`[FeatureFileGenerator] ✅ ${categoryName} feature file generated (${response.length} chars)`);

      // Generate filename
      const filename = this.generateFilename(userStory, categoryName);

      return {
        filename,
        content: response,
        category: categoryName,
      };
    } catch (error: any) {
      console.error(`[FeatureFileGenerator] ❌ Failed to generate ${categoryName} feature file:`, error.message);
      throw new Error(`Failed to generate ${categoryName} feature file: ${error.message}`);
    }
  }

  /**
   * Clean feature file content (remove markdown blocks, extra whitespace)
   */
  private cleanFeatureFileContent(content: string): string {
    // Remove markdown code blocks if present
    content = content.replace(/```gherkin\n?/gi, '').replace(/```\n?/g, '');
    
    // Remove any leading/trailing whitespace
    content = content.trim();
    
    // Ensure it starts with "Feature:"
    if (!content.startsWith('Feature:') && !content.startsWith('feature:')) {
      console.warn('[FeatureFileGenerator] ⚠️ Content does not start with Feature:');
    }
    
    return content;
  }

  /**
   * Generate filename for feature file
   */
  private generateFilename(userStory: any, categoryName: string): string {
    const storyIdSafe = userStory.id?.toString().replace(/[^a-z0-9]/gi, '_') || 'unknown';
    const categorySlug = categoryName.toLowerCase().replace(/\s+/g, '-');
    return `${storyIdSafe}_${categorySlug}.feature`;
  }
}
