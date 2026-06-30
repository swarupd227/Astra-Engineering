/**
 * Playwright Test Script Generator Service
 * Generates TypeScript Playwright automation scripts from manual test cases
 */

import { anthropic, azureOpenAI, hasAnthropic, hasBedrock } from "../llm-config";
import {
  PLAYWRIGHT_SYSTEM_PROMPT,
  getPlaywrightUserPrompt,
} from "../prompts/prompt_playwright_generator";
import { NEW_API_MODEL_SUBSTRINGS } from "../llm-config-constants";

const useAnthropic = hasAnthropic || hasBedrock;

export interface PlaywrightScriptResult {
  storyId: string;
  storyTitle: string;
  scriptContent: string;
  fileName: string;
}

export class PlaywrightGenerator {
  /**
   * Generate Playwright scripts for multiple user stories
   */
  async generatePlaywrightScripts(
    userStories: any[]
  ): Promise<PlaywrightScriptResult[]> {
    if (userStories.length === 0) {
      console.warn("[PlaywrightGenerator] No user stories provided");
      return [];
    }

    console.log(`[PlaywrightGenerator] Processing ${userStories.length} stories in parallel`);
    
    // Process all stories in parallel
    const storyPromises = userStories.map(async (story, index) => {
      try {
        return await this.processBatch([story]);
      } catch (error: any) {
        console.error(`[PlaywrightGenerator] Story ${story.id} failed:`, error.message);
        return [{
          storyId: story.id,
          storyTitle: story.title,
          scriptContent: `// ERROR: Failed to generate test for this story\n// Story: ${story.title}\n// Error: ${error.message}\n\n// This is a placeholder - manual test creation needed`,
          fileName: `${this.sanitizeFileName(story.title)}-error.spec.ts`,
        }];
      }
    });

    const results = await Promise.all(storyPromises);
    const allScripts = results.flat();
    
    console.log(`[PlaywrightGenerator] Generated ${allScripts.length} scripts for ${userStories.length} stories`);
    
    return allScripts;
  }

  /**
   * Process a batch of user stories for Playwright generation
   */
  private async processBatch(userStories: any[]): Promise<PlaywrightScriptResult[]> {
    try {
      const systemPrompt = PLAYWRIGHT_SYSTEM_PROMPT;
      const userPrompt = getPlaywrightUserPrompt(userStories);

      console.log(
        `[PlaywrightGenerator] Generating scripts for ${userStories.length} user stories (prompt length: ${userPrompt.length} chars)`
      );

      let response;

      if (useAnthropic && anthropic) {
        console.log(
          "[PlaywrightGenerator] Using Anthropic for Playwright generation"
        );
        const message = await anthropic.chat.completions.create({
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
          temperature: 0.3,
          max_tokens: 8192, // Explicitly set high limit to prevent JSON truncation
        });

        response = message.choices[0]?.message?.content || "";
      } else if (azureOpenAI) {
        console.log(
          "[PlaywrightGenerator] Using Azure OpenAI for Playwright generation"
        );
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
          payload.max_completion_tokens = 8192; // Explicitly set high limit to prevent JSON truncation
          payload.temperature = 1;
        } else {
          payload.max_tokens = 8192;
          payload.temperature = 0.3;
        }

        const message = await azureOpenAI.chat.completions.create(payload);

        response = message.choices[0]?.message?.content || "";
      } else {
        throw new Error("No LLM provider configured");
      }

      // Parse response and create script files
      const scripts = this.parsePlaywrightResponse(response, userStories);

      console.log(
        `[PlaywrightGenerator] Generated ${scripts.length} Playwright scripts`
      );
      return scripts;
    } catch (error: any) {
      console.error(
        "[PlaywrightGenerator] Error generating scripts:",
        error.message
      );
      throw new Error(`Failed to generate Playwright scripts: ${error.message}`);
    }
  }

  /**
   * Parse Playwright generation response with enhanced error handling
   */
  private parsePlaywrightResponse(
    response: string,
    userStories: any[]
  ): PlaywrightScriptResult[] {
    const scripts: PlaywrightScriptResult[] = [];

    try {
      // Clean response by removing markdown formatting if present at start/end
      let cleanResponse = response.trim();
      
      // Remove 'json' prefix if present (common LLM response format)
      if (cleanResponse.toLowerCase().startsWith('json\n')) {
        cleanResponse = cleanResponse.substring(5).trim();
      } else if (cleanResponse.toLowerCase().startsWith('json')) {
        cleanResponse = cleanResponse.substring(4).trim();
      }
      
      // Remove leading/trailing markdown if entire response is wrapped
      if (cleanResponse.startsWith('```typescript') && cleanResponse.endsWith('```')) {
        cleanResponse = cleanResponse
          .replace(/^```typescript\s*/, '')
          .replace(/\s*```$/, '');
      } else if (cleanResponse.startsWith('```json') && cleanResponse.endsWith('```')) {
        cleanResponse = cleanResponse
          .replace(/^```json\s*/, '')
          .replace(/\s*```$/, '');
      } else if (cleanResponse.startsWith('```') && cleanResponse.endsWith('```')) {
        cleanResponse = cleanResponse
          .replace(/^```\s*/, '')
          .replace(/\s*```$/, '');
      }

      // Strategy 1: Try to parse as JSON first (if it's JSON response format)
      if (cleanResponse.startsWith('{') || cleanResponse.startsWith('[')) {
        console.log("[PlaywrightGenerator] Attempting Strategy 1: JSON parsing");
        try {
          const jsonResponse = this.safeParseJSON(cleanResponse);
          console.log("[PlaywrightGenerator] JSON parsed successfully, keys:", Object.keys(jsonResponse));
          
          // Handle different JSON response structures
          let playwrightTests = [];
          if (jsonResponse.playwrightTests && Array.isArray(jsonResponse.playwrightTests)) {
            playwrightTests = jsonResponse.playwrightTests;
            console.log(`[PlaywrightGenerator] Found playwrightTests array with ${playwrightTests.length} items`);
          } else if (Array.isArray(jsonResponse)) {
            playwrightTests = jsonResponse;
            console.log(`[PlaywrightGenerator] Using direct array with ${playwrightTests.length} items`);
          } else {
            console.log("[PlaywrightGenerator] No playwrightTests array found in JSON structure");
          }
          
          // Convert JSON to script results
          for (const test of playwrightTests) {
            if (test.testCode || test.scriptContent) {
              const storyId = test.storyId || userStories[scripts.length]?.id || 'unknown';
              const storyTitle = test.storyTitle || userStories[scripts.length]?.title || 'Unknown Story';
              const scriptContent = test.testCode || test.scriptContent;
              
              scripts.push({
                storyId,
                storyTitle,
                scriptContent: this.ensurePlaywrightSetup(scriptContent),
                fileName: `${this.sanitizeFileName(test.testFile?.replace('.spec.ts', '') || storyTitle)}.spec.ts`,
              });
            }
          }
          
          if (scripts.length > 0) {
            return scripts;
          }
        } catch (jsonError: any) {
          console.error("[PlaywrightGenerator] JSON parsing failed:", jsonError.message);
          // JSON parsing failed, try alternative strategies
        }
      }

      // Strategy 2: Extract TypeScript code blocks
      const codeBlocks = response.match(/```typescript\n([\s\S]*?)```/g) || [];

      if (codeBlocks.length > 0) {
        console.log(`[PlaywrightGenerator] Found ${codeBlocks.length} code blocks`);
        
        // If we have multiple code blocks, assign to stories
        codeBlocks.forEach((block, index) => {
          const code = block
            .replace(/```typescript\n/, "")
            .replace(/```$/, "")
            .trim();
          const story = userStories[index];

          if (story && code) {
            scripts.push({
              storyId: story.id,
              storyTitle: story.title,
              scriptContent: this.ensurePlaywrightSetup(code),
              fileName: `${story.id}.spec.ts`,
            });
          }
        });
      } else {
        console.log("[PlaywrightGenerator] No code blocks found, checking if response is JSON");
        
        // Strategy 3: Check if cleanResponse is JSON and extract testCode
        if (cleanResponse.startsWith('{') || cleanResponse.startsWith('[')) {
          try {
            const jsonResponse = JSON.parse(cleanResponse);
            
            // Handle different JSON response structures
            let playwrightTests = [];
            if (jsonResponse.playwrightTests && Array.isArray(jsonResponse.playwrightTests)) {
              playwrightTests = jsonResponse.playwrightTests;
            } else if (Array.isArray(jsonResponse)) {
              playwrightTests = jsonResponse;
            }
            
            // Convert JSON to script results
            for (const test of playwrightTests) {
              if (test.testCode || test.scriptContent) {
                const storyId = test.storyId || userStories[scripts.length]?.id || 'unknown';
                const storyTitle = test.storyTitle || userStories[scripts.length]?.title || 'Unknown Story';
                const scriptContent = test.testCode || test.scriptContent;
                
                scripts.push({
                  storyId,
                  storyTitle,
                  scriptContent: this.ensurePlaywrightSetup(scriptContent),
                  fileName: `${this.sanitizeFileName(test.testFile?.replace('.spec.ts', '') || storyTitle)}.spec.ts`,
                });
              }
            }
            
            if (scripts.length > 0) {
              return scripts;
            }
          } catch (jsonError) {
            // Fallback to error handling
          }
        }
        
        // Strategy 4: Use cleaned entire response (only if it contains test code, not JSON)
        if (cleanResponse && cleanResponse.includes('test(') && !cleanResponse.startsWith('{') && !cleanResponse.startsWith('[')) {
          const mainStory = userStories[0];
          scripts.push({
            storyId: mainStory.id,
            storyTitle: mainStory.title,
            scriptContent: this.ensurePlaywrightSetup(cleanResponse),
            fileName: "automated-e2e-tests.spec.ts",
          });
        } else {
          console.warn("[PlaywrightGenerator] Response doesn't contain valid Playwright test code");
          
          // Strategy 5: Generate a basic test template if response is invalid
          const mainStory = userStories[0];
          const fallbackScript = `test('${mainStory.title}', async ({ page }) => {
  // TODO: Implement test steps for: ${mainStory.title}
  // Response parsing failed - please review and implement manually
  await page.goto('/');
  await expect(page).toHaveTitle(/.*/)
});`;
          
          scripts.push({
            storyId: mainStory.id,
            storyTitle: mainStory.title,
            scriptContent: this.ensurePlaywrightSetup(fallbackScript),
            fileName: `${this.sanitizeFileName(mainStory.title || mainStory.id)}.spec.ts`,
          });
        }
      }

      console.log(`[PlaywrightGenerator] Generated ${scripts.length} Playwright scripts`);
      return scripts;
      
    } catch (error) {
      console.error("[PlaywrightGenerator] Error parsing response:", error);
      console.error("[PlaywrightGenerator] Response length:", response.length);
      console.error("[PlaywrightGenerator] First 300 chars:", response.substring(0, 300));
      
      // Fallback: Create basic test for first story
      const mainStory = userStories[0];
      const fallbackScript = `test('${mainStory.title}', async ({ page }) => {
  // Error occurred during response parsing - manual implementation required
  await page.goto('/');
  await expect(page).toHaveTitle(/.*/)
});`;
      
      return [{
        storyId: mainStory.id,
        storyTitle: mainStory.title,
        scriptContent: this.ensurePlaywrightSetup(fallbackScript),
        fileName: `${this.sanitizeFileName(mainStory.title || mainStory.id)}.spec.ts`,
      }];
    }
  }

  /**
   * Add necessary imports and configuration to Playwright script
   */
  ensurePlaywrightSetup(scriptContent: string): string {
    // Add imports if not present
    const hasImports = scriptContent.includes("import");
    if (!hasImports) {
      scriptContent = `import { test, expect } from '@playwright/test';\n\n${scriptContent}`;
    }

    return scriptContent;
  }

  /**
   * Generate Playwright configuration file
   */
  generatePlaywrightConfig(): string {
    return `import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [
    ['html', { outputFolder: 'playwright-report' }],
    ['json', { outputFile: 'test-results.json' }],
    ['junit', { outputFile: 'junit-results.xml' }],
  ],
  use: {
    baseURL: process.env.BASE_URL || 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
    },
  ],

  webServer: {
    command: 'npm run start',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
  },
});`;
  }

  /**
   * Generate package.json for Playwright
   */
  generatePackageJson(): string {
    const packageJson = {
      name: "automation-scripts",
      version: "1.0.0",
      description: "Playwright automation scripts for DevX",
      scripts: {
        test: "playwright test",
        "test:headed": "playwright test --headed",
        "test:debug": "playwright test --debug",
        "test:ui": "playwright test --ui",
      },
      dependencies: {
        "@playwright/test": "^1.40.0",
      },
      devDependencies: {
        typescript: "^5.3.3",
        "@types/node": "^20.10.0",
      },
    };

    return JSON.stringify(packageJson, null, 2);
  }

  /**
   * Generate .env.example for Playwright
   */
  generateEnvExample(): string {
    return `# Playwright Test Configuration

# Base URL for the application
BASE_URL=http://localhost:3000

# Browser configuration
BROWSER=chromium

# Parallel workers
WORKERS=4

# Headless mode
HEADLESS=true

# Screenshot on failure
SCREENSHOT_ON_FAILURE=true

# Video recording
VIDEO_RECORDING=retain-on-failure

# Trace recording
TRACE=on-first-retry

# Test timeout (ms)
TIMEOUT=30000

# Navigation timeout (ms)
NAVIGATION_TIMEOUT=30000

# Retry failed tests
RETRIES=2

# Test report output
REPORT_FORMAT=html`;
  }

  /**
   * Generate README for Playwright tests
   */
  generateReadme(): string {
    return `# Automation Test Scripts

This directory contains Playwright test automation scripts generated from DevX user stories.

## Directory Structure

\`\`\`
AutomationScript/
├── [projectId]/
│   ├── [epicId]/
│   │   ├── [featureId]/
│   │   │   ├── [storyId].spec.ts    # Playwright test for specific user story
│   │   │   └── fixtures.ts           # Test data and fixtures
│   │   └── feature.spec.ts          # Feature-level tests
│   └── epic.spec.ts                 # Epic-level tests
├── playwright.config.ts
├── package.json
└── .env.example
\`\`\`

## Setup

1. Install dependencies:
   \`\`\`bash
   npm install
   \`\`\`

2. Copy \`.env.example\` to \`.env\` and configure:
   \`\`\`bash
   cp .env.example .env
   \`\`\`

3. Update \`BASE_URL\` in \`.env\` to your application URL

## Running Tests

### Run all tests
\`\`\`bash
npm test
\`\`\`

### Run tests in headed mode (see browser)
\`\`\`bash
npm run test:headed
\`\`\`

### Run tests in debug mode
\`\`\`bash
npm run test:debug
\`\`\`

### Run tests in UI mode
\`\`\`bash
npm run test:ui
\`\`\`

### Run specific test file
\`\`\`bash
npx playwright test tests/story-001.spec.ts
\`\`\`

### Run tests matching pattern
\`\`\`bash
npx playwright test -g "login"
\`\`\`

## Test Reports

After running tests, view reports:

### HTML Report
\`\`\`bash
npx playwright show-report
\`\`\`

### JSON Report
Test results are also available in \`test-results.json\`

## CI/CD Integration

Set the \`CI\` environment variable to enable:
- Headless mode
- Single worker
- Retry on failure
- Full trace/video recording

Example GitHub Actions:
\`\`\`yaml
- name: Run Playwright tests
  env:
    CI: true
  run: npm test
\`\`\`

## Troubleshooting

### Tests timing out
- Increase \`TIMEOUT\` in \`.env\`
- Check if application server is running on \`BASE_URL\`
- Verify network connectivity

### Browser not found
\`\`\`bash
npx playwright install
\`\`\`

### Permission denied errors
\`\`\`bash
chmod +x node_modules/.bin/playwright
\`\`\`

## Documentation

- [Playwright Documentation](https://playwright.dev)
- [Assertion Reference](https://playwright.dev/docs/api/class-locatorassertions)
- [Configuration Reference](https://playwright.dev/docs/test-configuration)

## Contributing

When adding new test cases:
1. Follow the existing file structure
2. Add meaningful test descriptions
3. Use descriptive variable names
4. Include comments for complex logic
5. Update this README with new test categories
`;
  }

  /**
   * Sanitize filename to be filesystem-compatible
   */
  private sanitizeFileName(name: string): string {
    return name
      .replace(/[^a-zA-Z0-9\s\-_]/g, '') // Remove special characters
      .replace(/\s+/g, '-') // Replace spaces with hyphens
      .toLowerCase() // Convert to lowercase
      .replace(/-+/g, '-') // Remove multiple consecutive hyphens
      .replace(/^-|-$/g, ''); // Remove leading/trailing hyphens
  }

  /**
   * Safely parse JSON with multiple repair strategies
   */
  private safeParseJSON(jsonString: string): any {
    // Strategy 1: Direct parse
    try {
      return JSON.parse(jsonString);
    } catch (firstError: any) {
      console.log("[PlaywrightGenerator] Direct JSON parse failed, trying repairs...");
    }

    // Strategy 2: Try to find and extract just the testCode value if JSON is malformed
    // Look for testCode pattern and extract the string value
    const testCodeMatch = jsonString.match(/"testCode"\s*:\s*"((?:[^"\\]|\\.)*)"/s);
    if (testCodeMatch) {
      try {
        // Try to manually construct a minimal JSON with just the extracted code
        const testCode = testCodeMatch[1]
          .replace(/\\n/g, '\n')
          .replace(/\\t/g, '\t')
          .replace(/\\"/g, '"')
          .replace(/\\\\/g, '\\');
        
        return {
          playwrightTests: [{
            testCode: testCode
          }]
        };
      } catch (extractError) {
        console.error("[PlaywrightGenerator] Failed to extract testCode:", extractError);
      }
    }

    // Strategy 3: Try truncation repair - find last complete object
    try {
      // Find the last occurrence of a closing brace or bracket
      let cleanString = jsonString.trim();
      
      // Try to find where the JSON might have been truncated
      const lastBrace = cleanString.lastIndexOf('}');
      const lastBracket = cleanString.lastIndexOf(']');
      const cutPoint = Math.max(lastBrace, lastBracket);
      
      if (cutPoint > 0 && cutPoint < cleanString.length - 1) {
        // Try parsing up to the last valid closing character
        const repairedString = cleanString.substring(0, cutPoint + 1);
        return JSON.parse(repairedString);
      }
    } catch (truncError) {
      console.error("[PlaywrightGenerator] Truncation repair failed:", truncError);
    }

    // Strategy 4: Last resort - throw original error
    throw new Error("Failed to parse JSON with all repair strategies");
  }
}

export default PlaywrightGenerator;
