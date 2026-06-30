/**
 * Extended Test Case Generator Service
 * Generates Performance, Security, Usability, and Reliability test cases using LLM
 * Uses batched parallel processing for efficiency
 */

import { anthropic, azureOpenAI, hasAnthropic } from "../llm-config";
import {
  EXTENDED_TEST_CASES_SYSTEM_PROMPT,
  getPerformanceTestCasesPrompt,
  getSecurityTestCasesPrompt,
  getUsabilityTestCasesPrompt,
  getReliabilityTestCasesPrompt,
} from "../prompts/prompt_manual_test_cases_extended";
import { NEW_API_MODEL_SUBSTRINGS } from "../llm-config-constants";

const useAnthropic = hasAnthropic;

export interface ExtendedTestCase {
  id: string;
  title: string;
  category: 'performance' | 'security' | 'usability' | 'reliability';
  subCategory?: string;
  priority: 'Critical' | 'High' | 'Medium' | 'Low';
  description: string;
  preconditions: string[];
  steps: Array<{
    step: number;
    action: string;
    expectedResult: string;
  }>;
  postconditions: string[];
  testData?: string;
  toolsRequired?: string[];
  estimatedTime?: string;
  automationFeasibility?: 'High' | 'Medium' | 'Low';
  riskScore?: number;
  complianceTag?: string;
}

export interface ExtendedTestCasesByCategory {
  performance?: ExtendedTestCase[];
  security?: ExtendedTestCase[];
  usability?: ExtendedTestCase[];
  reliability?: ExtendedTestCase[];
}

export class ExtendedTestCaseGenerator {
  /**
   * Generate extended test cases for a user story with selected types
   * Uses parallel processing for efficiency (max 4 parallel LLM calls)
   */
  async generateExtendedTestCases(
    userStory: any,
    selectedTypes: {
      performance: boolean;
      security: boolean;
      usability: boolean;
      reliability: boolean;
    }
  ): Promise<ExtendedTestCasesByCategory> {
    const categories: Array<{ key: keyof ExtendedTestCasesByCategory; name: string }> = [];

    if (selectedTypes.performance) {
      categories.push({ key: 'performance', name: 'Performance & Load' });
    }
    if (selectedTypes.security) {
      categories.push({ key: 'security', name: 'Security & Vulnerability' });
    }
    if (selectedTypes.usability) {
      categories.push({ key: 'usability', name: 'Usability' });
    }
    if (selectedTypes.reliability) {
      categories.push({ key: 'reliability', name: 'Reliability & Resiliency' });
    }

    if (categories.length === 0) {
      return {};
    }

    // Generate all selected types in parallel
    const promises = categories.map((category) =>
      this.generateSingleCategory(userStory, category.key, category.name)
    );

    const results = await Promise.allSettled(promises);

    const testCasesByCategory: ExtendedTestCasesByCategory = {};

    results.forEach((result, index) => {
      const category = categories[index];
      if (result.status === 'fulfilled' && result.value && result.value.length > 0) {
        testCasesByCategory[category.key] = result.value;
      } else {
        console.error(`[ExtendedTestCaseGenerator] ${category.name} failed:`, 
          result.status === 'rejected' ? result.reason?.message : 'No test cases generated');
        testCasesByCategory[category.key] = [];
      }
    });

    return testCasesByCategory;
  }

  /**
   * Generate test cases for a single category
   */
  private async generateSingleCategory(
    userStory: any,
    category: keyof ExtendedTestCasesByCategory,
    categoryName: string
  ): Promise<ExtendedTestCase[]> {
    try {
      const systemPrompt = EXTENDED_TEST_CASES_SYSTEM_PROMPT;
      const userPrompt = this.getUserPrompt(category, userStory);

      let response: string;

      if (useAnthropic && anthropic) {
        const message = await anthropic.chat.completions.create({
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
          temperature: 0.1,
          max_tokens: 16000,
        });

        response = message.choices[0]?.message?.content || "";

        if (message.choices[0]?.finish_reason === 'length') {
          console.warn(`[ExtendedTestCaseGenerator] ${categoryName} response truncated`);
        }
      } else if (azureOpenAI) {
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

        response = message.choices[0]?.message?.content || "";

        if (message.choices[0]?.finish_reason === 'length') {
          console.warn(`[ExtendedTestCaseGenerator] ${categoryName} response truncated`);
        }
      } else {
        throw new Error("No LLM provider configured");
      }

      return this.parseResponse(response, category);
    } catch (error: any) {
      console.error(`[ExtendedTestCaseGenerator] Failed to generate ${categoryName}:`, error.message);
      throw error;
    }
  }

  /**
   * Get the appropriate user prompt based on category
   */
  private getUserPrompt(category: keyof ExtendedTestCasesByCategory, userStory: any): string {
    const acceptanceCriteria = Array.isArray(userStory.acceptanceCriteria)
      ? userStory.acceptanceCriteria
      : [];

    switch (category) {
      case 'performance':
        return getPerformanceTestCasesPrompt(userStory, acceptanceCriteria);
      case 'security':
        return getSecurityTestCasesPrompt(userStory, acceptanceCriteria);
      case 'usability':
        return getUsabilityTestCasesPrompt(userStory, acceptanceCriteria);
      case 'reliability':
        return getReliabilityTestCasesPrompt(userStory, acceptanceCriteria);
      default:
        throw new Error(`Unknown category: ${category}`);
    }
  }

  /**
   * Parse LLM response and extract test cases
   */
  private parseResponse(response: string, category: keyof ExtendedTestCasesByCategory): ExtendedTestCase[] {
    try {
      let cleanedResponse = response.trim()
        .replace(/```json\n?/gi, '')
        .replace(/```\n?/g, '')
        .trim();

      const parsed = JSON.parse(cleanedResponse);

      if (!parsed.testCases || !Array.isArray(parsed.testCases)) {
        console.error('[ExtendedTestCaseGenerator] Invalid response structure');
        return [];
      }

      const testCases: ExtendedTestCase[] = parsed.testCases.map((tc: any, index: number) => {
        if (!tc.id) tc.id = `${category.toUpperCase()}-${String(index + 1).padStart(3, '0')}`;
        if (!tc.title) tc.title = 'Untitled Test Case';
        if (!tc.category) tc.category = category;
        if (!tc.priority) tc.priority = 'Medium';
        if (!tc.description) tc.description = '';
        if (!Array.isArray(tc.preconditions)) tc.preconditions = [];
        if (!Array.isArray(tc.postconditions)) tc.postconditions = [];

        let stepsArray = tc.steps || tc.testCaseSteps || [];
        if (Array.isArray(stepsArray)) {
          tc.steps = stepsArray.map((step: any, stepIndex: number) => ({
            step: step.step || step.Steps || stepIndex + 1,
            action: step.action || step.Action || '',
            expectedResult: step.expectedResult || step['Expected Results'] || step.expected || '',
          }));
        } else {
          tc.steps = [];
        }
        
        delete tc.testCaseSteps;
        return tc as ExtendedTestCase;
      });

      return testCases;
    } catch (error: any) {
      console.error('[ExtendedTestCaseGenerator] Parse error:', error.message);
      return [];
    }
  }
}
