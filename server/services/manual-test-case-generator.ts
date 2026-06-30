/**
 * Manual Test Case Generator Service
 * Generates manual test cases from user stories using LLM
 */

import { anthropic, azureOpenAI, hasAnthropic, hasBedrock } from "../llm-config";
import {
  MANUAL_TEST_CASE_SYSTEM_PROMPT,
  getManualTestCaseUserPrompt,
} from "../prompts/prompt_manual_test_cases";
import {
  EXTENDED_TEST_CASES_SYSTEM_PROMPT,
  getPerformanceTestCasesPrompt,
  getSecurityTestCasesPrompt,
  getUsabilityTestCasesPrompt,
  getReliabilityTestCasesPrompt,
} from "../prompts/prompt_manual_test_cases_extended";
import { NEW_API_MODEL_SUBSTRINGS } from "../llm-config-constants";

const useAnthropic = hasAnthropic || hasBedrock;

export interface ManualTestCase {
  id: string;
  title: string;
  type: "happy-path" | "edge-case" | "error-case" | "boundary";
  priority: "High" | "Medium" | "Low";
  preconditions: string[];
  steps: Array<{
    step: number;
    action: string;
    expectedResult: string;
  }>;
  postconditions: string[];
  estimatedTime: string;
}

export interface TestCaseResult {
  storyId: string;
  storyTitle: string;
  testCases: ManualTestCase[];
  // Core test case categories
  functional?: any[];
  negative?: any[];
  edgeCases?: any[];
  accessibility?: any[];
  // Extended test case categories
  performance?: any[];
  security?: any[];
  usability?: any[];
  reliability?: any[];
}

export class ManualTestCaseGenerator {
  /**
   * Generate manual test cases for multiple user stories
   */
  async generateTestCasesForStories(
    userStories: any[],
    testCaseTypes?: { 
      functional: boolean; 
      negative: boolean; 
      edgeCases: boolean; 
      accessibility: boolean;
      performance?: boolean;
      security?: boolean;
      usability?: boolean;
      reliability?: boolean;
    }
  ): Promise<TestCaseResult[]> {
    if (userStories.length === 0) {
      return [];
    }

    // Limit to 2 stories at a time to prevent response truncation
    const maxStoriesPerBatch = 2;
    if (userStories.length > maxStoriesPerBatch) {
      const allResults: TestCaseResult[] = [];
      for (let i = 0; i < userStories.length; i += maxStoriesPerBatch) {
        const batch = userStories.slice(i, i + maxStoriesPerBatch);
        try {
          const batchResults = await this.processBatch(batch, testCaseTypes);
          allResults.push(...batchResults);
        } catch (error) {
          console.error(`[ManualTestCaseGenerator] Batch ${Math.floor(i/maxStoriesPerBatch) + 1} failed:`, error);
        }
      }
      return allResults;
    }
    return await this.processBatch(userStories, testCaseTypes);
  }

  /**
   * Process a batch of user stories with enhanced logging, error handling, and token optimization
   */
  private async processBatch(
    userStories: any[],
    testCaseTypes?: { 
      functional: boolean; 
      negative: boolean; 
      edgeCases: boolean; 
      accessibility: boolean;
      performance?: boolean;
      security?: boolean;
      usability?: boolean;
      reliability?: boolean;
    }
  ): Promise<TestCaseResult[]> {
    const batchStartTime = Date.now();
    console.log(`[ManualTestCaseGenerator] 🚀 Starting batch processing for ${userStories.length} user stories`);
    
    // Log the stories being processed
    userStories.forEach((story, index) => {
      console.log(`[ManualTestCaseGenerator] 📋 Story ${index + 1}: "${story.title}" (ID: ${story.id})`);
    });

    // Log selected test case types
    const selectedTypes = testCaseTypes || { functional: true, negative: true, edgeCases: true, accessibility: true };
    const enabledTypes = Object.entries(selectedTypes).filter(([key, value]) => value).map(([key, value]) => key);
    const coreTypes = enabledTypes.filter(t => ['functional', 'negative', 'edgeCases', 'accessibility'].includes(t));
    const extendedTypes = enabledTypes.filter(t => ['performance', 'security', 'usability', 'reliability'].includes(t));
    console.log(`[ManualTestCaseGenerator] 📝 Generating test case types: Core[${coreTypes.join(", ")}] Extended[${extendedTypes.join(", ")}]`);

    try {
      // Determine if we need extended test cases
      const needsExtendedTypes = testCaseTypes && (
        testCaseTypes.performance || testCaseTypes.security || 
        testCaseTypes.usability || testCaseTypes.reliability
      );
      
      let systemPrompt: string;
      let userPrompt: string;
      
      if (needsExtendedTypes) {
        // For extended types, use extended system prompt and generate custom prompt
        systemPrompt = EXTENDED_TEST_CASES_SYSTEM_PROMPT;
        userPrompt = this.generateExtendedPrompt(userStories[0], testCaseTypes);
      } else {
        // For core types only, use original system
        systemPrompt = MANUAL_TEST_CASE_SYSTEM_PROMPT;
        userPrompt = getManualTestCaseUserPrompt(userStories, testCaseTypes);
      }

      // Token optimization - estimate token usage and optimize if needed
      const estimatedTokens = this.estimateTokenCount(systemPrompt + userPrompt);
      console.log(`[ManualTestCaseGenerator] 📏 Estimated input tokens: ${estimatedTokens}`);

      // If estimated tokens are too high, optimize the prompt
      if (estimatedTokens > 12000) { // Leave room for output tokens
        console.warn(`[ManualTestCaseGenerator] ⚠️  High token count detected (${estimatedTokens}), optimizing prompt...`);
        userPrompt = this.optimizePromptForTokens(userStories, testCaseTypes, estimatedTokens);
        const newEstimate = this.estimateTokenCount(systemPrompt + userPrompt);
        console.log(`[ManualTestCaseGenerator] 🔧 Optimized prompt, new estimate: ${newEstimate} tokens`);
      }

      console.log(`[ManualTestCaseGenerator] 📏 Final prompt sizes - System: ${systemPrompt.length} chars, User: ${userPrompt.length} chars`);

      let response: string;
      let modelInfo: string;
      let finishReason: string | undefined;
      const llmStartTime = Date.now();

      if (useAnthropic && anthropic) {
        console.log(`[ManualTestCaseGenerator] 🤖 Using Anthropic/Bedrock LLM`);
        modelInfo = "Anthropic/Bedrock";
        
        const message = await anthropic.chat.completions.create({
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
          temperature: 0.1,
          max_tokens: 16000,
        });

        response = message.choices[0]?.message?.content || "";
        finishReason = message.choices[0]?.finish_reason;
        
      } else if (azureOpenAI) {
        const deployment = process.env.AZURE_OPENAI_DEPLOYMENT || "gpt-4-turbo";
        const d = deployment.toLowerCase();
        const isNewModel = NEW_API_MODEL_SUBSTRINGS.some((m) => d.includes(m));
        
        console.log(`[ManualTestCaseGenerator] 🤖 Using Azure OpenAI deployment: ${deployment}, New model: ${isNewModel}`);
        modelInfo = `Azure OpenAI ${deployment}`;

        // Dynamic token allocation based on input size
        const inputTokenEstimate = this.estimateTokenCount(systemPrompt + userPrompt);
        const maxOutputTokens = Math.min(16000, Math.max(4000, 20000 - inputTokenEstimate));
        
        console.log(`[ManualTestCaseGenerator] 🎛️  Dynamic token allocation - Input: ~${inputTokenEstimate}, Output: ${maxOutputTokens}`);

        const payload: any = {
          model: deployment,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
        };

        if (isNewModel) {
          payload.max_completion_tokens = maxOutputTokens;
          payload.temperature = 0.1; // Use consistent temperature
        } else {
          payload.max_tokens = maxOutputTokens;
          payload.temperature = 0.1;
        }

        const message = await azureOpenAI.chat.completions.create(payload);

        response = message.choices[0]?.message?.content || "";
        finishReason = message.choices[0]?.finish_reason;
        
      } else {
        const errorMsg = "No LLM provider configured (neither Anthropic nor Azure OpenAI available)";
        console.error(`[ManualTestCaseGenerator] ❌ ${errorMsg}`);
        throw new Error(errorMsg);
      }

      const llmDuration = Date.now() - llmStartTime;
      console.log(`[ManualTestCaseGenerator] ⏱️  LLM call completed in ${llmDuration}ms using ${modelInfo}`);
      console.log(`[ManualTestCaseGenerator] 📊 Response length: ${response.length} characters`);
      console.log(`[ManualTestCaseGenerator] 🏁 Finish reason: ${finishReason || 'not provided'}`);
      
      // Enhanced truncation handling
      if (finishReason === 'length') {
        console.error(`[ManualTestCaseGenerator] ❌ Response was truncated due to token limits!`);
        console.error(`[ManualTestCaseGenerator] 💡 Input tokens: ~${this.estimateTokenCount(systemPrompt + userPrompt)}, Response chars: ${response.length}`);
        
        // If we get truncation with optimized prompt, it's a serious issue
        if (estimatedTokens > 12000) {
          throw new Error(
            `Response truncated even after prompt optimization. ` +
            `This user story may be too complex. ` +
            `Try generating fewer test case types or splitting the story into smaller parts.`
          );
        } else {
          console.warn(`[ManualTestCaseGenerator] ⚠️  Continuing with truncated response - parsing may fail`);
        }
      }

      // Check for empty response
      if (!response || response.trim().length === 0) {
        const errorMsg = `Empty response from ${modelInfo} - check model configuration`;
        console.error(`[ManualTestCaseGenerator] ❌ ${errorMsg}`);
        throw new Error(errorMsg);
      }

      // Parse the response
      const parseStartTime = Date.now();
      let testCases: TestCaseResult[] = [];
      
      try {
        testCases = this.parseWithFallbacks(response);
        const parseDuration = Date.now() - parseStartTime;
        console.log(`[ManualTestCaseGenerator] ✅ Parsing completed in ${parseDuration}ms, ${testCases.length} results`);
      } catch (parseError: any) {
        console.error(`[ManualTestCaseGenerator] ❌ JSON parsing failed:`, parseError.message);
        console.error(`[ManualTestCaseGenerator] 📄 Raw response preview:`, response.substring(0, 1000));
        
        // If parsing fails on a truncated response, provide better error message
        if (finishReason === 'length') {
          throw new Error(
            `JSON parsing failed on truncated response. ` +
            `The AI response was cut off due to token limits. ` +
            `Try generating fewer test case types or simplifying the user story.`
          );
        } else {
          throw new Error(`JSON parsing failed: ${parseError.message}. This may indicate malformed AI output.`);
        }
      }
      
      // Normalize and validate results
      const normalizeStartTime = Date.now();
      testCases = testCases.map((tc, index) => {
        console.log(`[ManualTestCaseGenerator] 🔍 Processing result ${index + 1}: "${tc.storyTitle}"`);

        // Use Record<string, any> for dynamic field access
        const coreFields = ["functional", "negative", "edgeCases", "accessibility"];
        const extendedFields = ["performance", "security", "usability", "reliability"];
        const allFields = [...coreFields, ...extendedFields];
        const tcRecord = tc as Record<string, any>;
        const normalized: any = {
          storyId: tcRecord.storyId || "unknown",
          storyTitle: tcRecord.storyTitle || "Unknown Story",
        };
        for (const field of allFields) {
          if (!Array.isArray(tcRecord[field])) {
            normalized[field] = [];
            // Only warn for core fields or selected extended fields
            const isRequiredField = coreFields.includes(field) || (testCaseTypes && (testCaseTypes as any)[field]);
            if (isRequiredField) {
              console.warn(`[ManualTestCaseGenerator] ⚠️  LLM output missing field '${field}' for story '${tcRecord.storyTitle || tcRecord.storyId}'. Added empty array.`);
            }
          } else {
            normalized[field] = tcRecord[field];
          }
        }

        const counts: any = {
          functional: normalized.functional.length,
          negative: normalized.negative.length,
          edgeCases: normalized.edgeCases.length,
          accessibility: normalized.accessibility.length
        };
        // Include extended counts if they exist
        if (normalized.performance?.length > 0) counts.performance = normalized.performance.length;
        if (normalized.security?.length > 0) counts.security = normalized.security.length;
        if (normalized.usability?.length > 0) counts.usability = normalized.usability.length;
        if (normalized.reliability?.length > 0) counts.reliability = normalized.reliability.length;
        console.log(`[ManualTestCaseGenerator] 📊 Test case counts for "${tcRecord.storyTitle}":`, counts);

        // If specific categories were requested, ensure unselected ones are empty
        if (testCaseTypes) {
          // Core types
          if (!testCaseTypes.functional) {
            normalized.functional = [];
            console.log(`[ManualTestCaseGenerator] 🚫 Cleared functional tests (not requested)`);
          }
          if (!testCaseTypes.negative) {
            normalized.negative = [];
            console.log(`[ManualTestCaseGenerator] 🚫 Cleared negative tests (not requested)`);
          }
          if (!testCaseTypes.edgeCases) {
            normalized.edgeCases = [];
            console.log(`[ManualTestCaseGenerator] 🚫 Cleared edge case tests (not requested)`);
          }
          if (!testCaseTypes.accessibility) {
            normalized.accessibility = [];
            console.log(`[ManualTestCaseGenerator] 🚫 Cleared accessibility tests (not requested)`);
          }
          // Extended types
          if (!testCaseTypes.performance) {
            normalized.performance = [];
            console.log(`[ManualTestCaseGenerator] 🚫 Cleared performance tests (not requested)`);
          }
          if (!testCaseTypes.security) {
            normalized.security = [];
            console.log(`[ManualTestCaseGenerator] 🚫 Cleared security tests (not requested)`);
          }
          if (!testCaseTypes.usability) {
            normalized.usability = [];
            console.log(`[ManualTestCaseGenerator] 🚫 Cleared usability tests (not requested)`);
          }
          if (!testCaseTypes.reliability) {
            normalized.reliability = [];
            console.log(`[ManualTestCaseGenerator] 🚫 Cleared reliability tests (not requested)`);
          }
        }

        // Post-processing: Generate minimal test cases for empty requested categories
        const requestedCategories = testCaseTypes || { functional: true, negative: true, edgeCases: true, accessibility: true };
        const emptyRequestedCategories = [];
        
        for (const [category, isRequested] of Object.entries(requestedCategories)) {
          if (isRequested && Array.isArray(normalized[category]) && normalized[category].length === 0) {
            emptyRequestedCategories.push(category);
          }
        }
        
        if (emptyRequestedCategories.length > 0) {
          console.warn(`[ManualTestCaseGenerator] 🛠️  Generating fallback test cases for empty categories: ${emptyRequestedCategories.join(', ')}`);
          
          emptyRequestedCategories.forEach((category) => {
            const fallbackTestCase = this.createFallbackTestCase(category, tcRecord.storyTitle || "User Story");
            normalized[category] = [fallbackTestCase];
            console.log(`[ManualTestCaseGenerator] ✅ Added fallback ${category} test case`);
          });
        }

        return normalized;
      });
      
      const normalizeDuration = Date.now() - normalizeStartTime;
      console.log(`[ManualTestCaseGenerator] 🔧 Normalization completed in ${normalizeDuration}ms`);
      
      const totalDuration = Date.now() - batchStartTime;
      console.log(`[ManualTestCaseGenerator] ✅ Batch processing completed successfully in ${totalDuration}ms`);
      console.log(`[ManualTestCaseGenerator] 📈 Final summary: ${testCases.length} stories processed, ${enabledTypes.length} test types generated`);
      
      return testCases;
      
    } catch (error: any) {
      const totalDuration = Date.now() - batchStartTime;
      console.error(`[ManualTestCaseGenerator] ❌ Batch processing failed after ${totalDuration}ms:`, error.message);
      
      // Log detailed error context
      if (error.message.includes("No LLM provider")) {
        console.error(`[ManualTestCaseGenerator] 💡 Configuration issue - check LLM provider setup in environment variables`);
      } else if (error.message.includes("JSON parsing")) {
        console.error(`[ManualTestCaseGenerator] 💡 Parsing issue - likely due to malformed AI response or truncation`);
      } else if (error.message.includes("Empty response")) {
        console.error(`[ManualTestCaseGenerator] 💡 Empty response - check model availability and configuration`);
      } else if (error.message.includes("truncated")) {
        console.error(`[ManualTestCaseGenerator] 💡 Token limit issue - try reducing prompt complexity or generating fewer test types`);
      }
      
      throw new Error(`Failed to generate manual test cases: ${error.message}`);
    }
  }

  /**
   * Estimate token count for prompt optimization (rough estimate: 1 token ≈ 4 characters)
   */
  private estimateTokenCount(text: string): number {
    return Math.ceil(text.length / 4);
  }

  /**
   * Generate prompts for extended test case types (performance, security, usability, reliability)
   */
  private generateExtendedPrompt(userStory: any, testCaseTypes: any): string {
    const prompts = [];
    const acceptanceCriteria = Array.isArray(userStory.acceptanceCriteria) 
      ? userStory.acceptanceCriteria.map((c: any) => typeof c === 'object' ? (c.title || c.description || JSON.stringify(c)) : c)
      : userStory.acceptanceCriteria ? [userStory.acceptanceCriteria] : [];

    if (testCaseTypes.performance) {
      prompts.push(getPerformanceTestCasesPrompt(userStory, acceptanceCriteria));
    }
    if (testCaseTypes.security) {
      prompts.push(getSecurityTestCasesPrompt(userStory, acceptanceCriteria));
    }
    if (testCaseTypes.usability) {
      prompts.push(getUsabilityTestCasesPrompt(userStory, acceptanceCriteria));
    }
    if (testCaseTypes.reliability) {
      prompts.push(getReliabilityTestCasesPrompt(userStory, acceptanceCriteria));
    }

    // Combine all prompts with clear section headers
    const combinedPrompt = prompts.map((prompt, index) => {
      const section = index === 0 ? '' : '\n\n---\n\n';
      return section + prompt;
    }).join('');

    return combinedPrompt;
  }

  /**
   * Optimize prompt for token limits by reducing unnecessary content
   */
  private optimizePromptForTokens(
    userStories: any[],
    testCaseTypes?: { 
      functional: boolean; 
      negative: boolean; 
      edgeCases: boolean; 
      accessibility: boolean;
      performance?: boolean;
      security?: boolean;
      usability?: boolean;
      reliability?: boolean;
    },
    currentTokens?: number
  ): string {
    console.log(`[ManualTestCaseGenerator] 🛠️  Optimizing prompt for token limits...`);
    
    // Create simplified stories with reduced verbosity
    const simplifiedStories = userStories.map(story => {
      let storyText = `Story ID: ${story.id}\nTitle: ${story.title}`;
      
      // Include description but truncate if very long
      const description = story.description || "No description provided";
      if (description.length > 300) {
        storyText += `\nDescription: ${description.substring(0, 300)}...`;
        console.log(`[ManualTestCaseGenerator] ✂️  Truncated description for story ${story.id}`);
      } else {
        storyText += `\nDescription: ${description}`;
      }

      // Include only essential traceability info
      if (story.brdTitle) {
        storyText += `\nSource BRD: ${story.brdTitle}`;
      }
      if (story.requirementName) {
        storyText += `\nRequirement: ${story.requirementName}`;
      }

      // Simplify acceptance criteria
      if (story.acceptanceCriteria) {
        const criteria = Array.isArray(story.acceptanceCriteria) 
          ? story.acceptanceCriteria.slice(0, 5) // Limit to first 5 criteria
          : [story.acceptanceCriteria];
        storyText += `\nKey Acceptance Criteria: ${criteria.map((c: any, i: number) => `${i+1}. ${typeof c === 'object' ? (c.title || c.description || JSON.stringify(c).substring(0, 100)) : c}`).join('; ')}`;
      }

      // Skip detailed test cases to save tokens
      if (story.testcases || story.testCases) {
        storyText += `\n[Test cases available - will generate based on above context]`;
      }

      return storyText;
    });

    // Create optimized prompt with focused instructions
    const selectedCategories = testCaseTypes || { functional: true, negative: true, edgeCases: true, accessibility: true };
    const coreTypes = ['functional', 'negative', 'edgeCases', 'accessibility'].filter(t => (selectedCategories as any)[t]);
    const extendedTypes = ['performance', 'security', 'usability', 'reliability'].filter(t => (selectedCategories as any)[t]);
    const allEnabledTypes = [...coreTypes, ...extendedTypes];
    
    const optimizedPrompt = `## User Stories for Test Case Generation:

${simplifiedStories.join('\n\n---\n\n')}

## Task: Generate ${allEnabledTypes.join(', ')} test cases for the above stories.

Requirements:
- Generate 3-5 test cases per selected category per story
- Use JSON format: [{"storyId":"...","storyTitle":"...",${coreTypes.map(t => `"${t}":[...]`).join(',')},${extendedTypes.map(t => `"${t}":[...]`).join(',')}}]
- Each test case: {"id":"TC-XXX-001","title":"...","category":"...","priority":"High/Medium/Low","preconditions":[...],"steps":[{"step":1,"action":"...","expectedResult":"..."}],"postconditions":[...],"estimatedTime":"..."}
- Return only valid JSON array, no markdown blocks`;

    const newTokenEstimate = this.estimateTokenCount(optimizedPrompt);
    console.log(`[ManualTestCaseGenerator] ✅ Prompt optimized: ${currentTokens} -> ${newTokenEstimate} tokens`);
    
    return optimizedPrompt;
  }

  /**
   * Enhanced JSON parsing with comprehensive fallbacks and detailed logging
   */
  private parseWithFallbacks(response: string): TestCaseResult[] {
    console.log(`[ManualTestCaseGenerator] 🔍 Starting response parsing, length: ${response.length} characters`);
    
    // Check for completely empty response
    if (!response || response.trim().length === 0) {
      console.error("[ManualTestCaseGenerator] ❌ Empty response received from LLM");
      throw new Error("Empty response from LLM - check model configuration and token limits");
    }

    try {
      let cleaned = response.trim();
      console.log(`[ManualTestCaseGenerator] 📝 Original response preview: ${cleaned.substring(0, 200)}${cleaned.length > 200 ? '...' : ''}`);
      
      // Remove markdown code blocks
      const originalLength = cleaned.length;
      cleaned = cleaned.replace(/^```json\s*/gi, '').replace(/\s*```$/gi, '');
      cleaned = cleaned.replace(/^```\s*/gi, '').replace(/\s*```$/gi, '');
      
      if (cleaned.length !== originalLength) {
        console.log(`[ManualTestCaseGenerator] 📝 Removed markdown blocks, new length: ${cleaned.length}`);
      }

      // Find JSON boundaries
      const jsonStart = cleaned.indexOf('[');
      const jsonEnd = cleaned.lastIndexOf(']');
      
      if (jsonStart === -1 || jsonEnd === -1 || jsonEnd <= jsonStart) {
        console.error("[ManualTestCaseGenerator] ❌ No valid JSON array boundaries found");
        console.error("[ManualTestCaseGenerator] 🔍 Response content:", cleaned.substring(0, 500));
        throw new Error("Invalid JSON structure - no array boundaries found in response");
      }

      console.log(`[ManualTestCaseGenerator] 📍 Found JSON boundaries: start=${jsonStart}, end=${jsonEnd}`);
      cleaned = cleaned.substring(jsonStart, jsonEnd + 1);
      console.log(`[ManualTestCaseGenerator] ✂️  Extracted JSON length: ${cleaned.length} characters`);
      
      // First attempt: direct parsing
      try {
        const parsed = JSON.parse(cleaned);
        const result = Array.isArray(parsed) ? parsed : [parsed];
        console.log(`[ManualTestCaseGenerator] ✅ Direct parsing successful, ${result.length} test case result(s)`);
        
        // Validate structure
        const validationResult = this.validateParsedResults(result);
        if (!validationResult.isValid) {
          console.warn(`[ManualTestCaseGenerator] ⚠️  Validation warning: ${validationResult.warning}`);
        }
        
        return result;
      } catch (directError: any) {
        console.log(`[ManualTestCaseGenerator] 🔄 Direct parsing failed: ${directError.message}, attempting repair`);
        
        // Second attempt: JSON repair
        try {
          const repaired = this.repairJSON(cleaned);
          console.log(`[ManualTestCaseGenerator] 🛠️  JSON repaired, length change: ${cleaned.length} -> ${repaired.length}`);
          
          const parsed = JSON.parse(repaired);
          const result = Array.isArray(parsed) ? parsed : [parsed];
          console.log(`[ManualTestCaseGenerator] ✅ Repair parsing successful, ${result.length} test case result(s)`);
          
          // Validate structure
          const validationResult = this.validateParsedResults(result);
          if (!validationResult.isValid) {
            console.warn(`[ManualTestCaseGenerator] ⚠️  Validation warning: ${validationResult.warning}`);
          }
          
          return result;
        } catch (repairError: any) {
          console.error(`[ManualTestCaseGenerator] ❌ JSON repair also failed: ${repairError.message}`);
          
          // Third attempt: fallback to manual structure creation
          return this.createFallbackStructure(response);
        }
      }
      
    } catch (error: any) {
      console.error(`[ManualTestCaseGenerator] ❌ Complete parsing failure:`, error.message);
      console.error(`[ManualTestCaseGenerator] 📄 Full response dump:`, response);
      throw new Error(`JSON parsing failed completely: ${error.message}`);
    }
  }

  /**
   * Validate parsed results structure and content
   */
  private validateParsedResults(results: TestCaseResult[]): { isValid: boolean; warning?: string } {
    if (!Array.isArray(results) || results.length === 0) {
      return { isValid: false, warning: "No test case results found" };
    }

    const firstResult = results[0];

    // Check required fields (structure only)
    if (!firstResult.storyId || !firstResult.storyTitle) {
      return { isValid: false, warning: "Missing required fields (storyId, storyTitle)" };
    }
    // Check that all required arrays exist (do not require non-empty)
    const requiredFields = ["functional", "negative", "edgeCases", "accessibility"];
    const firstResultRecord = firstResult as Record<string, any>;
    for (const field of requiredFields) {
      if (!Array.isArray(firstResultRecord[field])) {
        return { isValid: false, warning: `Missing or invalid field: ${field}` };
      }
    }
    // Do not fail if all arrays are empty; allow job to complete
    return { isValid: true };
  }

  /**
   * Create fallback structure when parsing fails completely
   */
  private createFallbackStructure(originalResponse: string): TestCaseResult[] {
    console.log(`[ManualTestCaseGenerator] 🆘 Creating fallback structure due to parse failure`);
    
    // Try to extract basic info from response
    const storyIdMatch = originalResponse.match(/"storyId"\s*:\s*"([^"]+)"/);
    const storyTitleMatch = originalResponse.match(/"storyTitle"\s*:\s*"([^"]+)"/);
    
    const fallbackResult: TestCaseResult = {
      storyId: storyIdMatch ? storyIdMatch[1] : "unknown",
      storyTitle: storyTitleMatch ? storyTitleMatch[1] : "Parsing failed - manual review required",
      testCases: [],
      functional: [],
      negative: [],
      edgeCases: [],
      accessibility: []
    };

    console.warn(`[ManualTestCaseGenerator] ⚠️  Returning fallback structure - manual review required`);
    return [fallbackResult];
  }

  /**
   * Enhanced JSON repair with better error handling and logging
   */
  private repairJSON(json: string): string {
    console.log(`[ManualTestCaseGenerator] 🛠️  Starting JSON repair, input length: ${json.length}`);
    let repaired = json;
    
    // Step 1: Truncate at last complete bracket
    const lastBracket = repaired.lastIndexOf(']');
    if (lastBracket > 0 && lastBracket < repaired.length - 1) {
      const truncated = repaired.substring(lastBracket + 1);
      console.log(`[ManualTestCaseGenerator] ✂️  Truncated ${truncated.length} characters after last bracket`);
      repaired = repaired.substring(0, lastBracket + 1);
    }
    
    // Step 2: Ensure array boundaries
    if (!repaired.startsWith('[')) {
      console.log(`[ManualTestCaseGenerator] 🔧 Adding opening bracket`);
      repaired = '[' + repaired;
    }
    if (!repaired.endsWith(']')) {
      console.log(`[ManualTestCaseGenerator] 🔧 Adding closing bracket`);
      repaired = repaired + ']';
    }
    
    // Step 3: Fix trailing commas
    const trailingCommasBefore = (repaired.match(/,(\s*[}\]])/g) || []).length;
    repaired = repaired.replace(/,(\s*[}\]])/g, '$1');
    if (trailingCommasBefore > 0) {
      console.log(`[ManualTestCaseGenerator] 🔧 Fixed ${trailingCommasBefore} trailing commas`);
    }
    
    // Step 4: Fix missing commas between objects/arrays
    const fixes = [
      { pattern: /}\s*{/g, replacement: '},{', name: 'object-object' },
      { pattern: /]\s*{/g, replacement: '],{', name: 'array-object' },
      { pattern: /}\s*\[/g, replacement: '},[', name: 'object-array' },
      { pattern: /]\s*\[/g, replacement: '],[', name: 'array-array' }
    ];
    
    fixes.forEach(fix => {
      const beforeCount = (repaired.match(fix.pattern) || []).length;
      repaired = repaired.replace(fix.pattern, fix.replacement);
      if (beforeCount > 0) {
        console.log(`[ManualTestCaseGenerator] 🔧 Fixed ${beforeCount} missing commas (${fix.name})`);
      }
    });
    
    // Step 5: Fix string content issues
    const stringFixResult = this.fixStringContent(repaired);
    repaired = stringFixResult.fixed;
    if (stringFixResult.changes > 0) {
      console.log(`[ManualTestCaseGenerator] 🔧 Fixed ${stringFixResult.changes} string content issues`);
    }
    
    // Step 6: Balance braces and brackets
    const balanceResult = this.balanceBrackets(repaired);
    repaired = balanceResult.balanced;
    if (balanceResult.changes > 0) {
      console.log(`[ManualTestCaseGenerator] 🔧 Balanced ${balanceResult.changes} bracket/brace mismatches`);
    }
    
    // Step 7: Remove control characters
    const controlCharsBefore = repaired.length;
    repaired = repaired.replace(/[\x00-\x08\x0B-\x0C\x0E-\x1F\x7F-\x9F]/g, '');
    const controlCharsRemoved = controlCharsBefore - repaired.length;
    if (controlCharsRemoved > 0) {
      console.log(`[ManualTestCaseGenerator] 🔧 Removed ${controlCharsRemoved} control characters`);
    }
    
    console.log(`[ManualTestCaseGenerator] ✅ JSON repair complete, final length: ${repaired.length}`);
    return repaired;
  }

  /**
   * Fix string content issues (newlines, tabs, etc.)
   */
  private fixStringContent(json: string): { fixed: string; changes: number } {
    let inString = false;
    let fixed = '';
    let changes = 0;
    
    for (let i = 0; i < json.length; i++) {
      const char = json[i];
      const prevChar = i > 0 ? json[i - 1] : '';
      
      // Toggle string state when we find an unescaped quote
      if (char === '"' && prevChar !== '\\') {
        inString = !inString;
      }
      
      // If we're inside a string, fix unescaped special characters
      if (inString) {
        if (char === '\n') {
          fixed += '\\n';
          changes++;
          continue;
        }
        if (char === '\t') {
          fixed += '\\t';
          changes++;
          continue;
        }
        if (char === '\r') {
          changes++;
          continue; // Skip carriage returns
        }
      }
      
      fixed += char;
    }
    
    return { fixed, changes };
  }

  /**
   * Balance brackets and braces
   */
  private balanceBrackets(json: string): { balanced: string; changes: number } {
    const openBraces = (json.match(/{/g) || []).length;
    const closeBraces = (json.match(/}/g) || []).length;
    const openBrackets = (json.match(/\[/g) || []).length;
    const closeBrackets = (json.match(/\]/g) || []).length;
    
    let balanced = json;
    let changes = 0;
    
    if (openBraces > closeBraces) {
      const missing = openBraces - closeBraces;
      balanced = balanced.substring(0, balanced.length - 1) + '}'.repeat(missing) + ']';
      changes += missing;
    }
    
    if (openBrackets > closeBrackets) {
      const missing = openBrackets - closeBrackets;
      balanced = balanced + ']'.repeat(missing);
      changes += missing;
    }
    
    return { balanced, changes };
  }

  /**
   * Create a minimal fallback test case for empty categories
   */
  private createFallbackTestCase(category: string, storyTitle: string): any {
    const categoryConfig: any = {
      functional: {
        title: `Verify core functionality for ${storyTitle}`,
        action: "Execute the main user workflow",
        expectedResult: "All expected features work correctly",
        preconditions: ["System is available", "User is authenticated"]
      },
      negative: {
        title: `Test error handling for ${storyTitle}`,
        action: "Provide invalid input or simulate error condition",
        expectedResult: "Appropriate error message is displayed",
        preconditions: ["System is available", "Test data prepared"]
      },
      edgeCases: {
        title: `Test boundary conditions for ${storyTitle}`,
        action: "Test with minimum, maximum, and boundary values",
        expectedResult: "System handles edge cases gracefully",
        preconditions: ["System is available", "Boundary test data ready"]
      },
      accessibility: {
        title: `Verify accessibility compliance for ${storyTitle}`,
        action: "Navigate using keyboard only and test screen reader",
        expectedResult: "All elements are accessible via keyboard and screen reader",
        preconditions: ["System is available", "Screen reader software running"]
      },
      performance: {
        title: `Verify performance requirements for ${storyTitle}`,
        action: "Execute workflow under expected load conditions",
        expectedResult: "Response times meet performance criteria (< 2 seconds)",
        preconditions: ["System is available", "Load testing tools configured"]
      },
      security: {
        title: `Verify security controls for ${storyTitle}`,
        action: "Attempt unauthorized access and input validation bypass",
        expectedResult: "Security controls prevent unauthorized access",
        preconditions: ["System is available", "Test user accounts prepared"]
      },
      usability: {
        title: `Verify usability compliance for ${storyTitle}`,
        action: "Navigate interface following common user patterns",
        expectedResult: "Interface is intuitive and follows usability guidelines",
        preconditions: ["System is available", "Test scenarios defined"]
      },
      reliability: {
        title: `Verify system reliability for ${storyTitle}`,
        action: "Execute repeated operations and simulate failure conditions",
        expectedResult: "System remains stable and recovers gracefully from failures",
        preconditions: ["System is available", "Monitoring tools configured"]
      }
    };
    const config = categoryConfig[category] || categoryConfig.functional;
    
    // Generate appropriate test case ID prefix based on category
    const idPrefixes: any = {
      functional: 'FUNC',
      negative: 'NEG',
      edgeCases: 'EDGE',
      accessibility: 'A11Y',
      performance: 'PERF',
      security: 'SEC',
      usability: 'UX',
      reliability: 'REL'
    };
    const prefix = idPrefixes[category] || 'TEST';
    
    return {
      id: `TC-${prefix}-FALLBACK-001`,
      title: config.title,
      category: category.charAt(0).toUpperCase() + category.slice(1),
      priority: "Medium",
      preconditions: config.preconditions,
      steps: [
        { 
          step: 1, 
          action: config.action, 
          expectedResult: config.expectedResult 
        }
      ],
      postconditions: ["System remains stable", "No data corruption"],
      estimatedTime: "3-5 minutes"
    };
  }



  /**
   * Format test cases as Markdown
   */
  formatAsMarkdown(testCaseResults: TestCaseResult[]): string {
    let markdown = "# Manual Test Cases\n\n";

    for (const result of testCaseResults) {
      markdown += `## Story: ${result.storyTitle}\n`;
      markdown += `**Story ID:** ${result.storyId}\n\n`;

      for (const tc of result.testCases) {
        markdown += `### Test Case: ${tc.title}\n`;
        markdown += `- **ID:** ${tc.id}\n`;
        markdown += `- **Type:** ${tc.type}\n`;
        markdown += `- **Priority:** ${tc.priority}\n`;
        markdown += `- **Estimated Time:** ${tc.estimatedTime}\n\n`;

        markdown += "**Preconditions:**\n";
        for (const pre of tc.preconditions) {
          markdown += `- ${pre}\n`;
        }
        markdown += "\n";

        markdown += "**Steps:**\n";
        markdown += "| Step | Action | Expected Result |\n";
        markdown += "|------|--------|------------------|\n";
        for (const step of tc.steps) {
          markdown += `| ${step.step} | ${step.action} | ${step.expectedResult} |\n`;
        }
        markdown += "\n";

        markdown += "**Postconditions:**\n";
        for (const post of tc.postconditions) {
          markdown += `- ${post}\n`;
        }
        markdown += "\n---\n\n";
      }
    }

    return markdown;
  }

  /**
   * Format test cases as JSON
   */
  formatAsJSON(testCaseResults: TestCaseResult[]): string {
    return JSON.stringify(testCaseResults, null, 2);
  }
}

export default ManualTestCaseGenerator;
