/**
 * Automation Storage Service
 * Orchestrates generation and storage of test cases and Playwright scripts to Git (GitHub or ADO)
 */

import type { IGitStorage } from "./git-storage-interface";
import { GitHubGitStorage } from "./github-git-storage";
import { buildStoryArtifactsPath, sanitizePathName as sanitizePathNameRepo, AUTOMATION_SCRIPT_FOLDER } from "../constants/repo-paths";
import ManualTestCaseGenerator, {
  TestCaseResult,
} from "./manual-test-case-generator";
import PlaywrightGenerator, {
  PlaywrightScriptResult,
} from "./playwright-generator";

export class AutomationStorageService {
  private storage: IGitStorage;
  private testCaseGenerator: ManualTestCaseGenerator;
  private playwrightGenerator: PlaywrightGenerator;

  constructor(storage?: IGitStorage) {
    this.storage = storage ?? new GitHubGitStorage();
    this.testCaseGenerator = new ManualTestCaseGenerator();
    this.playwrightGenerator = new PlaywrightGenerator();
  }

  /**
   * Generate and push all test cases and scripts for a feature
   */
  async generateAndPushFeatureTests(params: {
    projectId: string;
    projectName?: string;
    organization?: string;
    epicId: string;
    epicName?: string;
    featureId: string;
    featureName: string;
    userStories: any[];
    jobId?: string;
  }): Promise<{
    success: boolean;
    testCases: TestCaseResult[];
    playwrightScripts: PlaywrightScriptResult[];
    gitHubUrls: string[];
    errors?: string[];
  }> {
    const errors: string[] = [];
    const gitHubUrls: string[] = [];

    try {
      console.log(
        `[AutomationStorageService] Generating tests for feature: ${params.featureName}`
      );

      // Base path in GitHub - UNIFIED structure matching generateTestsForSingleStory
      const organization = this.sanitizeFileName(params.organization || 'unknown-org');
      const projectName = this.sanitizeFileName(params.projectName || `project-${params.projectId}`);
      
      // Use organization-projectName as directory structure  
      const directoryName = `${organization}-${projectName}`;
      
      // Structure: AutomationScript -> project folder -> Feature
      const featureName = this.sanitizeFileName(params.featureName || `feature-${params.featureId}`);
      const basePath = `${AUTOMATION_SCRIPT_FOLDER}/${directoryName}/${featureName}`;

      console.log(`[AutomationStorageService] Using directory structure: ${basePath}`);

      // Step 1: Generate manual test cases
      console.log("[AutomationStorageService] Generating manual test cases...");
      let testCases: TestCaseResult[] = [];
      try {
        testCases =
          await this.testCaseGenerator.generateTestCasesForStories(
            params.userStories
          );
      } catch (err: any) {
        errors.push(`Manual test case generation failed: ${err.message}`);
        console.error("[AutomationStorageService] Error in manual test case generation:", err);
      }

      // Step 2: Generate Playwright scripts
      console.log("[AutomationStorageService] Generating Playwright scripts...");
      let playwrightScripts: PlaywrightScriptResult[] = [];
      try {
        // Add manual test cases to user stories for Playwright generation context
        const enrichedStories = params.userStories.map((story, idx) => ({
          ...story,
          manualTestCases: testCases[idx]?.testCases || [],
        }));

        playwrightScripts =
          await this.playwrightGenerator.generatePlaywrightScripts(
            enrichedStories
          );
      } catch (err: any) {
        errors.push(`Playwright script generation failed: ${err.message}`);
        console.error("[AutomationStorageService] Error in Playwright generation:", err);
      }

      // Step 3: Push files to GitHub
      console.log("[AutomationStorageService] Pushing files to GitHub...");
      await this.pushTestFilesToGitHub({
        basePath,
        testCases,
        playwrightScripts,
        gitHubUrls,
      });

      // Step 4: Push configuration files (AutomationScript -> project folder)
      await this.pushProjectConfigurationFiles(`${AUTOMATION_SCRIPT_FOLDER}/${directoryName}`);

      console.log(
        `[AutomationStorageService] Successfully generated and pushed tests for ${params.featureName}`
      );

      return {
        success: errors.length === 0,
        testCases,
        playwrightScripts,
        gitHubUrls,
        errors: errors.length > 0 ? errors : undefined,
      };
    } catch (error: any) {
      console.error(
        "[AutomationStorageService] Fatal error:",
        error.message
      );
      throw new Error(
        `Failed to generate and push automation tests: ${error.message}`
      );
    }
  }

  /**
   * Sanitize filename to be GitHub-compatible
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
   * Generate tests for a single user story with BDD files
   */
  async generateTestsForSingleStory(params: {
    projectId: string;
    projectName: string;
    organization: string;
    epic: any;
    feature: any;
    userStory: any;
    testCaseTypes: {
      functional: boolean;
      negative: boolean;
      edgeCases: boolean;
      accessibility: boolean;
    };
    jobId?: string;
  }): Promise<{
    success: boolean;
    testCasesCount: number;
    scriptsCount: number;
    bddFilesCount: number;
    gitHubUrls: string[];
    errors?: string[];
  }> {
    const errors: string[] = [];
    const gitHubUrls: string[] = [];

    try {
      console.log(`[AutomationStorageService] Generating tests for user story: ${params.userStory.title}`);

      // Structure: AutomationScript -> project folder -> User Story
      const storyName = sanitizePathNameRepo(params.userStory.title || `story-${params.userStory.id}`);
      const organization = sanitizePathNameRepo(params.organization);
      const projectName = sanitizePathNameRepo(params.projectName);
      const projectFolder = `${organization}-${projectName}`;
      const basePath = buildStoryArtifactsPath(projectFolder, storyName);

      console.log(`[AutomationStorageService] Using directory structure: ${basePath}`);

      // Step 1: Generate manual test cases based on selected types
      console.log("[AutomationStorageService] Generating manual test cases...");
      let testCases: TestCaseResult[] = [];
      try {
        // Enrich user story with test case type requirements
        const enrichedStory = {
          ...params.userStory,
          testCaseTypes: params.testCaseTypes,
        };

        testCases = await this.testCaseGenerator.generateTestCasesForStories([enrichedStory]);
      } catch (err: any) {
        errors.push(`Manual test case generation failed: ${err.message}`);
        console.error("[AutomationStorageService] Error in manual test case generation:", err);
      }

      // Step 2: Generate BDD feature files and step definitions
      console.log("[AutomationStorageService] Generating BDD files...");
      const bddFiles: Array<{ path: string; content: string }> = [];
      try {
        if (testCases.length > 0) {
          // Generate Gherkin feature file
          const featureFileContent = this.generateBDDFeatureFile(
            params.userStory,
            testCases[0],
            params.feature,
            params.testCaseTypes
          );
          bddFiles.push({
            path: `${storyName}.feature`,
            content: featureFileContent,
          });

          // Generate step definitions file
          const stepDefsContent = this.generateBDDStepDefinitions(
            params.userStory,
            testCases[0]
          );
          bddFiles.push({
            path: `${storyName}.steps.ts`,
            content: stepDefsContent,
          });
        }
      } catch (err: any) {
        errors.push(`BDD file generation failed: ${err.message}`);
        console.error("[AutomationStorageService] Error in BDD generation:", err);
      }

      // Step 3: Generate Playwright scripts
      console.log("[AutomationStorageService] Generating Playwright scripts...");
      let playwrightScripts: PlaywrightScriptResult[] = [];
      try {
        const enrichedStory = {
          ...params.userStory,
          manualTestCases: testCases[0]?.testCases || [],
        };

        playwrightScripts = await this.playwrightGenerator.generatePlaywrightScripts([enrichedStory]);
      } catch (err: any) {
        errors.push(`Playwright script generation failed: ${err.message}`);
        console.error("[AutomationStorageService] Error in Playwright generation:", err);
      }

      // Step 4: Push all files to GitHub
      console.log("[AutomationStorageService] Pushing files to GitHub...");
      const filesToPush: Array<{ path: string; content: string }> = [];

      // Add manual test cases
      if (testCases.length > 0) {
        const markdownContent = this.testCaseGenerator.formatAsMarkdown(testCases);
        filesToPush.push({
          path: "manual-test-cases.md",
          content: markdownContent,
        });

        const jsonContent = this.testCaseGenerator.formatAsJSON(testCases);
        filesToPush.push({
          path: "manual-test-cases.json",
          content: jsonContent,
        });
      }

      // Add BDD files
      filesToPush.push(...bddFiles);

      // Add Playwright scripts
      if (playwrightScripts.length > 0) {
        for (const script of playwrightScripts) {
          let scriptContent = script.scriptContent;
          
          // The scriptContent should already be pure TypeScript code from the parser
          // No need to extract from JSON again as parsePlaywrightResponse already did this
          // Just ensure it has proper Playwright setup
          const enrichedContent = this.playwrightGenerator.ensurePlaywrightSetup(scriptContent);
          const sanitizedFileName = this.sanitizeFileName(script.fileName.replace('.spec.ts', '')) + '.spec.ts';
          
          filesToPush.push({
            path: sanitizedFileName,
            content: enrichedContent,
          });
        }
      }

      // Push all files
      const results = await this.storage.pushMultipleFiles(filesToPush, basePath);

      // Collect successful URLs
      const baseUrl = this.storage.getBaseUrl?.() ?? "";
      for (const result of results) {
        if (result.status === "success") {
          const pathSegment = basePath ? `${basePath}/${result.path}` : result.path;
          gitHubUrls.push(baseUrl ? `${baseUrl.replace(/\/$/, "")}/${pathSegment}` : pathSegment);
        }
      }

      // Step 5: Push project-level configuration files (AutomationScript -> project folder)
      await this.pushProjectConfigurationFiles(`${AUTOMATION_SCRIPT_FOLDER}/${projectFolder}`);

      console.log(`[AutomationStorageService] Successfully generated tests for user story: ${params.userStory.title}`);

      return {
        success: errors.length === 0,
        testCasesCount: testCases.reduce((sum, tc) => sum + tc.testCases.length, 0),
        scriptsCount: playwrightScripts.length,
        bddFilesCount: bddFiles.length,
        gitHubUrls,
        errors: errors.length > 0 ? errors : undefined,
      };
    } catch (error: any) {
      console.error("[AutomationStorageService] Fatal error:", error.message);
      throw new Error(`Failed to generate tests for user story: ${error.message}`);
    }
  }

  /**
   * Generate BDD Feature file (Gherkin syntax)
   */
  private generateBDDFeatureFile(
    userStory: any,
    testCaseResult: TestCaseResult,
    feature: any,
    testCaseTypes: any
  ): string {
    const featureTitle = feature.title || 'Feature';
    const storyTitle = userStory.title || 'User Story';
    
    let content = `Feature: ${featureTitle}\n\n`;
    content += `  Background:\n`;
    content += `    Given the application is accessible\n`;
    content += `    And the user is on the appropriate page\n\n`;

    // Group test cases by type
    const functionalTests = testCaseTypes.functional ? testCaseResult.testCases.filter((tc: any) => tc.type === 'happy-path') : [];
    const negativeTests = testCaseTypes.negative ? testCaseResult.testCases.filter((tc: any) => tc.type === 'error-case') : [];
    const edgeCaseTests = testCaseTypes.edgeCases ? testCaseResult.testCases.filter((tc: any) => tc.type === 'edge-case' || tc.type === 'boundary') : [];
    
    // Functional Test Scenarios
    if (functionalTests.length > 0) {
      content += `  # Functional Test Scenarios\n`;
      for (const tc of functionalTests) {
        content += `  Scenario: ${tc.title}\n`;
        if (tc.preconditions && tc.preconditions.length > 0) {
          for (const pre of tc.preconditions) {
            content += `    Given ${pre}\n`;
          }
        }
        for (const step of tc.steps) {
          const keyword = step.step === 1 ? 'When' : 'And';
          content += `    ${keyword} ${step.action}\n`;
          content += `    Then ${step.expectedResult}\n`;
        }
        content += `\n`;
      }
    }

    // Negative Test Scenarios
    if (negativeTests.length > 0) {
      content += `  # Negative Test Scenarios\n`;
      for (const tc of negativeTests) {
        content += `  Scenario: ${tc.title}\n`;
        if (tc.preconditions && tc.preconditions.length > 0) {
          for (const pre of tc.preconditions) {
            content += `    Given ${pre}\n`;
          }
        }
        for (const step of tc.steps) {
          const keyword = step.step === 1 ? 'When' : 'And';
          content += `    ${keyword} ${step.action}\n`;
          content += `    Then ${step.expectedResult}\n`;
        }
        content += `\n`;
      }
    }

    // Edge Case Scenarios
    if (edgeCaseTests.length > 0) {
      content += `  # Edge Case Test Scenarios\n`;
      for (const tc of edgeCaseTests) {
        content += `  Scenario: ${tc.title}\n`;
        if (tc.preconditions && tc.preconditions.length > 0) {
          for (const pre of tc.preconditions) {
            content += `    Given ${pre}\n`;
          }
        }
        for (const step of tc.steps) {
          const keyword = step.step === 1 ? 'When' : 'And';
          content += `    ${keyword} ${step.action}\n`;
          content += `    Then ${step.expectedResult}\n`;
        }
        content += `\n`;
      }
    }

    // Accessibility Tests (if requested)
    if (testCaseTypes.accessibility) {
      content += `  # Accessibility Test Scenarios\n`;
      content += `  Scenario: Keyboard Navigation\n`;
      content += `    When the user navigates using keyboard only\n`;
      content += `    Then all interactive elements should be accessible via keyboard\n`;
      content += `    And focus indicators should be clearly visible\n\n`;
      
      content += `  Scenario: Screen Reader Compatibility\n`;
      content += `    When the user accesses the page with a screen reader\n`;
      content += `    Then all content should be properly announced\n`;
      content += `    And ARIA labels should be present for all interactive elements\n\n`;
      
      content += `  Scenario: Color Contrast\n`;
      content += `    Then all text should meet WCAG AA color contrast standards\n`;
      content += `    And important information should not rely solely on color\n\n`;
    }

    return content;
  }

  /**
   * Generate BDD Step Definitions file
   */
  private generateBDDStepDefinitions(
    userStory: any,
    testCaseResult: TestCaseResult
  ): string {
    let content = `import { Given, When, Then } from '@cucumber/cucumber';\n`;
    content += `import { expect } from '@playwright/test';\n\n`;
    
    content += `// Background Steps\n`;
    content += `Given('the application is accessible', async function() {\n`;
    content += `  // Navigate to application URL\n`;
    content += `  await this.page.goto(process.env.BASE_URL || 'http://localhost:3000');\n`;
    content += `});\n\n`;
    
    content += `Given('the user is on the appropriate page', async function() {\n`;
    content += `  // Verify user is on the correct page\n`;
    content += `  await expect(this.page).toHaveURL(/.+/);\n`;
    content += `});\n\n`;
    
    // Generate step definitions for common actions
    const allSteps = testCaseResult.testCases.flatMap((tc: any) => tc.steps);
    const uniqueActions = new Set<string>();
    
    for (const step of allSteps) {
      if (step.action && !uniqueActions.has(step.action)) {
        uniqueActions.add(step.action);
        const stepDef = this.generateStepDefinition(step.action, step.expectedResult);
        content += stepDef + '\n\n';
      }
    }
    
    return content;
  }

  /**
   * Generate individual step definition
   */
  private generateStepDefinition(action: string, expectedResult: string): string {
    // Convert action to step definition pattern
    const pattern = action
      .replace(/the user /gi, '')
      .replace(/clicks? /gi, 'clicks ')
      .replace(/enters? /gi, 'enters ')
      .trim();
    
    let stepDef = `When('the user ${pattern}', async function() {\n`;
    stepDef += `  // TODO: Implement step: ${action}\n`;
    stepDef += `  // Expected: ${expectedResult}\n`;
    stepDef += `  throw new Error('Step not implemented yet');\n`;
    stepDef += `});\n`;
    
    return stepDef;
  }

  /**
   * Generate unique Job ID for test generation runs
   */
  private generateJobId(): string {
    // Generate short unique ID using timestamp + random
    const timestamp = Date.now().toString(36); // Base36 timestamp
    const randomPart = Math.random().toString(36).substring(2, 8); // 6 char random
    return `${timestamp}-${randomPart}`.toUpperCase();
  }

  /**
   * Push test files to GitHub
   */
  private async pushTestFilesToGitHub(params: {
    basePath: string;
    testCases: TestCaseResult[];
    playwrightScripts: PlaywrightScriptResult[];
    gitHubUrls: string[];
  }): Promise<void> {
    const filesToPush: Array<{ path: string; content: string }> = [];

    // Add manual test cases as Markdown
    if (params.testCases.length > 0) {
      const markdownContent =
        this.testCaseGenerator.formatAsMarkdown(params.testCases);
      filesToPush.push({
        path: "manual-test-cases.md",
        content: markdownContent,
      });

      // Also save as JSON for machine readability
      const jsonContent = this.testCaseGenerator.formatAsJSON(params.testCases);
      filesToPush.push({
        path: "manual-test-cases.json",
        content: jsonContent,
      });
    }

    // Add Playwright scripts - store only script content, not JSON wrapper
    if (params.playwrightScripts.length > 0) {
      for (const script of params.playwrightScripts) {
        // Extract only the actual TypeScript code from the script
        let scriptContent = script.scriptContent;
        
        console.log(`[AutomationStorageService] Processing script: ${script.fileName}`);
        console.log(`[AutomationStorageService] Original content type: ${typeof scriptContent}, starts with: ${scriptContent.substring(0, 50)}...`);
        
        // If it's JSON wrapped, extract the testCode
        try {
          // Clean the script content first - remove 'json' prefix if present
          let cleanContent = scriptContent.trim();
          if (cleanContent.toLowerCase().startsWith('json\n')) {
            cleanContent = cleanContent.substring(5).trim();
          } else if (cleanContent.toLowerCase().startsWith('json')) {
            cleanContent = cleanContent.substring(4).trim();
          }
          
          const parsed = JSON.parse(cleanContent);
          if (parsed.testCode) {
            scriptContent = parsed.testCode;
            console.log(`[AutomationStorageService] Extracted testCode from JSON`);
          } else if (parsed.playwrightTests && Array.isArray(parsed.playwrightTests) && parsed.playwrightTests[0]?.testCode) {
            scriptContent = parsed.playwrightTests[0].testCode;
            console.log(`[AutomationStorageService] Extracted testCode from playwrightTests array`);
          } else {
            console.log(`[AutomationStorageService] JSON parsed but no testCode found, using original`);
          }
        } catch {
          // Not JSON, use as-is
          console.log(`[AutomationStorageService] Content is not JSON, using as-is`);
        }
        
        // Ensure proper Playwright setup
        const enrichedContent = this.playwrightGenerator.ensurePlaywrightSetup(scriptContent);
        
        // Use descriptive filename based on story title
        const sanitizedFileName = this.sanitizeFileName(script.fileName.replace('.spec.ts', '')) + '.spec.ts';
        
        filesToPush.push({
          path: sanitizedFileName,
          content: enrichedContent,
        });
      }
    }

    // Push all files
    const results = await this.storage.pushMultipleFiles(
      filesToPush,
      params.basePath
    );

    const baseUrl = this.storage.getBaseUrl?.();
    for (const result of results) {
      if (result.status === "success") {
        const pathSegment = `${params.basePath}/${result.path}`;
        const url = baseUrl
          ? `${baseUrl.replace(/\/tree\//, "/blob/")}/${pathSegment}`
          : pathSegment;
        params.gitHubUrls.push(url);
      }
    }
  }

  /**
   * Push project-level configuration files
   */
  private async pushProjectConfigurationFiles(projectBasePath: string): Promise<void> {
    try {
      // Check if config files already exist
      const configPath = `${projectBasePath}/playwright.config.ts`;
      try {
        await this.storage.getFileContent(configPath);
        return;
      } catch (err: any) {
        // Files don't exist, proceed to create them
      }

      const configFiles = [
        {
          path: "playwright.config.ts",
          content: this.playwrightGenerator.generatePlaywrightConfig(),
        },
        {
          path: "package.json",
          content: this.playwrightGenerator.generatePackageJson(),
        },
        {
          path: ".env.example",
          content: this.playwrightGenerator.generateEnvExample(),
        },
        {
          path: "README.md",
          content: this.playwrightGenerator.generateReadme(),
        },
      ];

      await this.storage.pushMultipleFiles(
        configFiles,
        projectBasePath
      );

      // Configuration files pushed successfully
    } catch (error: any) {
      console.warn(
        "[AutomationStorageService] Warning pushing config files:",
        error.message
      );
      // Non-fatal error - continue even if config files fail
    }
  }

  /**
   * Get test case summary for display
   */
  getSummary(
    testCases: TestCaseResult[],
    scripts: PlaywrightScriptResult[]
  ): {
    totalStories: number;
    totalTestCases: number;
    totalScripts: number;
    storiesWithTests: number;
  } {
    return {
      totalStories: testCases.length + scripts.length,
      totalTestCases: testCases.reduce((sum, r) => sum + r.testCases.length, 0),
      totalScripts: scripts.length,
      storiesWithTests: testCases.filter((r) => r.testCases.length > 0).length,
    };
  }

  /**
   * Fetch generated test cases and Playwright scripts for preview
   */
  async fetchGeneratedContentForPreview(params: {
    projectId: string;
    epicId: string;
    featureId: string;
    jobId?: string;
    organization?: string;
    projectName?: string;
  }): Promise<{
    success: boolean;
    manualTestCases?: string;
    playwrightScripts?: string;
    githubLinks?: Record<string, string>;
    error?: string;
  }> {
    try {
      const { projectId, epicId, featureId, jobId, organization, projectName } = params;
      
      // Use the same path construction logic as generation
      const sanitizedOrganization = this.sanitizeFileName(organization || 'unknown-org');
      const sanitizedProjectName = this.sanitizeFileName(projectName || `project-${projectId}`);
      const sanitizedEpicId = this.sanitizeFileName(epicId || `epic-${epicId}`);
      const sanitizedFeatureId = this.sanitizeFileName(featureId || `feature-${featureId}`);
      
      // Match generation: AutomationScript -> project folder -> epic -> feature
      const directoryName = `${sanitizedOrganization}-${sanitizedProjectName}`;
      const basePath = `${AUTOMATION_SCRIPT_FOLDER}/${directoryName}/${sanitizedEpicId}/${sanitizedFeatureId}`;
      
      console.log(`[AutomationStorageService] Preview using path: ${basePath}`);
      
      const manualTestCasesPath = `${basePath}/manual-test-cases.md`;
      const playwrightScriptsPath = `${basePath}/PlaywrightScripts.js`;

      let manualTestCases: string | undefined;
      let playwrightScripts: string | undefined;
      const githubLinks: Record<string, string> = {};

      // Try to fetch manual test cases
      try {
        manualTestCases = await this.storage.getFileContent(manualTestCasesPath);
        const base = this.storage.getBaseUrl?.() ?? "";
        githubLinks['Manual Test Cases'] = base ? `${base.replace(/\/tree\//, "/blob/")}/${manualTestCasesPath}` : manualTestCasesPath;
      } catch (error: any) {
        console.warn(`[AutomationStorageService] Manual test cases not found at ${manualTestCasesPath}:`, error.message);
      }

      // Try to fetch Playwright scripts
      try {
        playwrightScripts = await this.storage.getFileContent(playwrightScriptsPath);
        const base = this.storage.getBaseUrl?.() ?? "";
        githubLinks['Playwright Scripts'] = base ? `${base.replace(/\/tree\//, "/blob/")}/${playwrightScriptsPath}` : playwrightScriptsPath;
      } catch (error: any) {
        console.warn(`[AutomationStorageService] Playwright scripts not found at ${playwrightScriptsPath}:`, error.message);
      }

      // Return error if no content found
      if (!manualTestCases && !playwrightScripts) {
        return {
          success: false,
          error: 'No generated test cases or scripts found. Please generate test cases first.',
        };
      }

      return {
        success: true,
        manualTestCases,
        playwrightScripts,
        githubLinks,
      };
    } catch (error: any) {
      console.error('[AutomationStorageService] Error fetching generated content:', error);
      return {
        success: false,
        error: `Failed to fetch generated content: ${error.message}`,
      };
    }
  }

  /**
   * Get preview content by job ID - searches all generated content for a job
   */
  async getPreviewContentByJob(params: {
    projectId: string;
    jobId: string;
  }): Promise<{
    manualTestCases?: string;
    playwrightScripts?: string;
    githubLinks?: Record<string, string>;
  }> {
    try {
      const { projectId, jobId } = params;
      console.log(`[AutomationStorageService] Searching for content in job: ${jobId}, project: ${projectId}`);

      // The generation creates files at: AutomationScript/{projectName}/{jobId}/{epicName}/{featureName}/
      // We need to search using GitHub's content API to find any files under this job
      
      let combinedManualTestCases = '';
      let combinedPlaywrightScripts = '';
      const githubLinks: Record<string, string> = {};
      let foundAnyContent = false;

      // Try to find files by searching the job directory pattern
      // Since we don't know the exact epic/feature names, we'll search common patterns
      const searchPaths = [
        `${AUTOMATION_SCRIPT_FOLDER}/${projectId}/${jobId}`,
        `${AUTOMATION_SCRIPT_FOLDER}/${projectId.toLowerCase()}/${jobId}`,
        `${AUTOMATION_SCRIPT_FOLDER}/${projectId.replace(/[^a-zA-Z0-9]/g, '-')}/${jobId}`,
      ];

      for (const basePath of searchPaths) {
        try {
          console.log(`[AutomationStorageService] Searching in path: ${basePath}`);
          
          // Try some common file patterns within the job directory structure
          const filePatterns = [
            // Direct in base path (if structure is flat)
            `${basePath}/ManualTestCases.md`,
            `${basePath}/PlaywrightScripts.js`,
            // Common nested patterns (epic/feature directories)
            `${basePath}/epic-1/feature-1/ManualTestCases.md`,
            `${basePath}/epic-1/feature-1/PlaywrightScripts.js`,
            // Try with some variations
            `${basePath}/epic1/feature1/ManualTestCases.md`,
            `${basePath}/epic1/feature1/PlaywrightScripts.js`,
          ];

          // Search for manual test cases
          for (const filePath of filePatterns.filter(p => p.includes('ManualTestCases'))) {
            try {
              const content = await this.storage.getFileContent(filePath);
              if (content && content.trim()) {
                combinedManualTestCases += `\n\n## From ${filePath}\n\n${content}`;
                githubLinks[`Manual Test Cases`] = 
                  `https://github.com/${process.env.GITHUB_OWNER}/${process.env.GITHUB_REPO}/blob/${process.env.GITHUB_BRANCH || 'main'}/${filePath}`;
                foundAnyContent = true;
                console.log(`[AutomationStorageService] ✅ Found manual test cases at ${filePath}`);
                break; // Found one, that's enough for now
              }
            } catch (error: any) {
              // File doesn't exist, continue searching
              if (error.status !== 404) {
                console.warn(`[AutomationStorageService] Error accessing ${filePath}:`, error.message);
              }
            }
          }

          // Search for Playwright scripts
          for (const filePath of filePatterns.filter(p => p.includes('PlaywrightScripts'))) {
            try {
              const content = await this.storage.getFileContent(filePath);
              if (content && content.trim()) {
                combinedPlaywrightScripts += `\n\n## From ${filePath}\n\n${content}`;
                githubLinks[`Playwright Scripts`] = 
                  `https://github.com/${process.env.GITHUB_OWNER}/${process.env.GITHUB_REPO}/blob/${process.env.GITHUB_BRANCH || 'main'}/${filePath}`;
                foundAnyContent = true;
                console.log(`[AutomationStorageService] ✅ Found Playwright scripts at ${filePath}`);
                break; // Found one, that's enough for now
              }
            } catch (error: any) {
              // File doesn't exist, continue searching
              if (error.status !== 404) {
                console.warn(`[AutomationStorageService] Error accessing ${filePath}:`, error.message);
              }
            }
          }

          // If we found content in this path, no need to try other paths
          if (foundAnyContent) {
            break;
          }
        } catch (error: any) {
          console.warn(`[AutomationStorageService] Error searching in ${basePath}:`, error.message);
          continue;
        }
      }

      if (!foundAnyContent) {
        throw new Error(
          `No generated test cases found for job "${jobId}" in project "${projectId}". ` +
          `Please ensure test cases have been generated first. Searched paths: ${searchPaths.join(', ')}`
        );
      }

      return {
        manualTestCases: combinedManualTestCases.trim() || undefined,
        playwrightScripts: combinedPlaywrightScripts.trim() || undefined,
        githubLinks,
      };
    } catch (error: any) {
      console.error(`[AutomationStorageService] Error searching for content:`, error.message);
      throw error;
    }
  }

  /**
   * Get preview content by organization + project name - searches all generated content
   */
  async getPreviewContentByOrgProject(params: {
    organization: string;
    projectName: string;
    directoryName?: string;
  }): Promise<{
    fileTree?: Array<{
      type: 'directory' | 'file';
      name: string;
      path: string;
      children?: Array<any>;
    }>;
    githubLinks?: Record<string, string>;
    message?: string;
  }> {
    try {
      const { organization, projectName, directoryName } = params;
      
      // Structure: AutomationScript -> project folder
      const projectFolder = directoryName || organization;
      console.log(`[AutomationStorageService] Browsing directory: ${projectFolder}`);
      const basePath = `${AUTOMATION_SCRIPT_FOLDER}/${projectFolder}`;
      
      // First, verify the base directory exists
      let pathExists = false;
      try {
        await this.storage.getFileContent(`${basePath}/README.md`);
        pathExists = true;
        console.log(`[AutomationStorageService] ✅ Found base directory: ${basePath}`);
      } catch (error: any) {
        console.log(`[AutomationStorageService] ❌ Base directory not accessible: ${basePath}`);
      }

      if (!pathExists) {
        return {
          message: `No test case files found for project ${projectFolder}. Please generate test cases first.`,
          fileTree: [],
          githubLinks: {}
        };
      }

      // Browse the directory structure
      const fileTree = await this.browseDirectory(basePath);
      
      // Create GitHub repository links
      const githubLinks: Record<string, string> = {
        'View Repository': `https://github.com/${process.env.GITHUB_OWNER}/${process.env.GITHUB_REPO}/tree/${process.env.GITHUB_BRANCH || 'main'}/${basePath}`,
        'Browse Files': `https://github.com/${process.env.GITHUB_OWNER}/${process.env.GITHUB_REPO}/tree/${process.env.GITHUB_BRANCH || 'main'}/${basePath}`
      };

      return {
        fileTree,
        githubLinks,
        message: fileTree.length === 0 ? 'Directory exists but no files found.' : undefined
      };

    } catch (error: any) {
      console.error(`[AutomationStorageService] Error browsing directory:`, error.message);
      return {
        message: `Error accessing directory: ${error.message}`,
        fileTree: [],
        githubLinks: {}
      };
    }
  }

  /**
   * Browse a directory and return its file/folder structure
   */
  private async browseDirectory(dirPath: string): Promise<Array<{
    type: 'directory' | 'file';
    name: string;
    path: string;
    children?: Array<any>;
  }>> {
    const knownDirectories = [
      'real-time-scheduling-conflict-detection-and-alert-system/conflict-detection-engine',
      'employee-schedule-management-system/schedule-management-and-reporting', 
      'schedule-change-approval-workflow/notification-and-reporting',
      'epic-1/feature-1',
      'epic-2/feature-2', 
      'epic-3/feature-3',
      'user-management/login-feature',
      'user-management/registration-feature',
      'authentication/login',
      'authentication/logout', 
      'authentication/registration',
      'dashboard/overview',
      'dashboard/reports',
      'dashboard/settings',
      'profile/edit',
      'profile/view',
      'profile/settings',
      'admin/users',
      'admin/settings',
      'admin/reports'
    ];

    const fileTree: Array<{
      type: 'directory' | 'file';
      name: string;
      path: string;
      children?: Array<any>;
    }> = [];

    // Check each known directory for files
    for (const subDir of knownDirectories) {
      const fullDirPath = `${dirPath}/${subDir}`;
      const files = await this.getFilesInDirectory(fullDirPath);
      
      if (files.length > 0) {
        // Parse the directory structure
        const pathParts = subDir.split('/');
        let currentLevel = fileTree;
        let currentPath = dirPath;
        
        // Build nested directory structure
        for (let i = 0; i < pathParts.length; i++) {
          const part = pathParts[i];
          currentPath += `/${part}`;
          
          let existingDir = currentLevel.find(item => item.name === part && item.type === 'directory');
          
          if (!existingDir) {
            existingDir = {
              type: 'directory',
              name: part,
              path: currentPath,
              children: []
            };
            currentLevel.push(existingDir);
          }
          
          currentLevel = existingDir.children!;
        }
        
        // Add files to the deepest directory level
        currentLevel.push(...files);
      }
    }

    return fileTree;
  }

  /**
   * Get all files in a specific directory
   */
  private async getFilesInDirectory(dirPath: string): Promise<Array<{
    type: 'file';
    name: string;
    path: string;
  }>> {
    const commonFiles = [
      'manual-test-cases.md',
      'ManualTestCases.md', 
      'manual-test-cases.json',
      'PlaywrightScripts.js',
      'approval-workflow-reports.spec.ts',
      'feature.spec.ts'
    ];

    const files: Array<{
      type: 'file';
      name: string;
      path: string;
    }> = [];

    for (const fileName of commonFiles) {
      try {
        const filePath = `${dirPath}/${fileName}`;
        await this.storage.getFileContent(filePath);
        
        files.push({
          type: 'file',
          name: fileName,
          path: filePath
        });
        
        console.log(`[AutomationStorageService] ✅ Found file: ${filePath}`);
      } catch (error: any) {
        // File doesn't exist, continue
      }
    }

    return files;
  }

  /**
   * Get directory contents for hierarchical browsing
   */
  async getDirectoryContents(params: {
    projectId: string;
    dirPath?: string; // Optional - if not provided, list under Project folder -> AutomationScript
  }): Promise<{
    success: boolean;
    items?: Array<{ name: string; type: 'file' | 'dir'; path: string; fullPath: string }>;
    error?: string;
    message?: string;
  }> {
    try {
      // Default: AutomationScript -> project folder (projectId can be org-project identifier)
      const basePath = params.dirPath || `${AUTOMATION_SCRIPT_FOLDER}/${params.projectId}`;
      
      console.log(`[AutomationStorageService] Listing contents of: ${basePath}`);
      
      const items = await this.storage.listDirectoryContents(basePath);
      
      if (items.length === 0) {
        return {
          success: true,
          items: [],
          message: `No items found in ${basePath}`
        };
      }

      // Map items with full paths
      const mappedItems = items.map(item => ({
        name: item.name,
        type: item.type,
        path: item.name, // Relative name for display
        fullPath: item.path // Full path for API calls
      }));

      console.log(`[AutomationStorageService] Found ${mappedItems.length} items in ${basePath}`);
      return {
        success: true,
        items: mappedItems
      };
    } catch (error: any) {
      console.error(`[AutomationStorageService] Error listing directory:`, error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Get content of a specific file for preview
   */
  async getFileContent(filePath: string): Promise<{
    success: boolean;
    content?: string;
    error?: string;
  }> {
    try {
      const content = await this.storage.getFileContent(filePath);
      return {
        success: true,
        content
      };
    } catch (error: any) {
      console.error(`[AutomationStorageService] Error getting file content for ${filePath}:`, error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }
}

export default AutomationStorageService;
