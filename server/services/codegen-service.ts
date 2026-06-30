import { DevAgent, type GeneratedFile } from "./dev-agent";
import { QAAgent } from "./qa-agent";
import { ProjectStructureGenerator } from "./project-structure-generator";
import type { UserStory } from "../../shared/schema";

export interface CodeGenResult {
  success: boolean;
  files: GeneratedFile[];
  errors?: string[];
}

export interface CodeGenSession {
  id: string;
  techStack: string;
  userStories: UserStory[];
  allFiles: GeneratedFile[];
  processedStories: number;
  errors: string[];
  status: "running" | "completed" | "failed";
}

export class CodeGenService {
  private devAgent: DevAgent;
  private qaAgent: QAAgent;
  private projectStructureGenerator: ProjectStructureGenerator;
  private sessions: Map<string, CodeGenSession> = new Map();

  constructor() {
    this.devAgent = new DevAgent();
    this.qaAgent = new QAAgent();
    this.projectStructureGenerator = new ProjectStructureGenerator();
  }

  async generateCode(userStories: UserStory[], techStack: string, llmProvider: string = "azure-openai"): Promise<CodeGenResult> {
    console.log(`[CodeGen] Starting generation for ${userStories.length} user stories with tech stack: ${techStack}, LLM provider: ${llmProvider}`);
    
    const allFiles: GeneratedFile[] = [];
    const errors: string[] = [];
    
    // First, generate project boilerplate files
    console.log(`[CodeGen] Generating project structure and boilerplate files`);
    try {
      const boilerplateFiles = this.projectStructureGenerator.generateProjectStructure(techStack);
      allFiles.push(...boilerplateFiles);
      console.log(`[CodeGen] Generated ${boilerplateFiles.length} boilerplate files`);
    } catch (error) {
      const errorMsg = `Failed to generate project structure: ${error instanceof Error ? error.message : String(error)}`;
      console.error(`[CodeGen] ${errorMsg}`);
      errors.push(errorMsg);
    }
    
    // Then, process each user story
    for (let i = 0; i < userStories.length; i++) {
      const userStory = userStories[i];
      console.log(`[CodeGen] Processing story ${i + 1}/${userStories.length}: ${userStory.title}`);
      
      try {
        const result = await this.processUserStory(userStory, techStack, llmProvider);
        allFiles.push(...result.files);
        if (result.errors) {
          errors.push(...result.errors);
        }
      } catch (error) {
        const errorMsg = `Failed to process user story "${userStory.title}": ${error instanceof Error ? error.message : String(error)}`;
        console.error(`[CodeGen] ${errorMsg}`);
        errors.push(errorMsg);
      }
    }

    console.log(`[CodeGen] Completed generation: ${allFiles.length} files generated, ${errors.length} errors`);
    
    return {
      success: errors.length === 0,
      files: allFiles,
      errors: errors.length > 0 ? errors : undefined
    };
  }

  // Generate project boilerplate files only
  generateProjectBoilerplate(techStack: string): GeneratedFile[] {
    console.log(`[CodeGen] Generating project structure for tech stack: ${techStack}`);
    try {
      const boilerplateFiles = this.projectStructureGenerator.generateProjectStructure(techStack);
      console.log(`[CodeGen] Generated ${boilerplateFiles.length} boilerplate files`);
      return boilerplateFiles;
    } catch (error) {
      console.error(`[CodeGen] Failed to generate project structure: ${error instanceof Error ? error.message : String(error)}`);
      return [];
    }
  }

  // Generate code for a single user story (used by progressive endpoint)
  async generateForSingleStory(userStory: UserStory, techStack: string, llmProvider: string = "azure-openai"): Promise<CodeGenResult> {
    console.log(`[CodeGen] Processing single story: ${userStory.title}`);
    return this.processUserStory(userStory, techStack, llmProvider);
  }

  private async processUserStory(userStory: UserStory, techStack: string, llmProvider: string = "azure-openai", maxRetries: number = 2): Promise<CodeGenResult> {
    let lastError: string | undefined;
    
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        console.log(`[CodeGen] Dev Agent generating code for "${userStory.title}" (attempt ${attempt + 1}/${maxRetries + 1}) with LLM: ${llmProvider}`);
        
        // Generate code with Dev Agent
        const devResult = await this.devAgent.generateCode(userStory, techStack, llmProvider);
        
        console.log(`[CodeGen] QA Agent validating ${devResult.files.length} files`);
        
        // Validate code with QA Agent
        const qaResult = await this.qaAgent.validateCode(devResult.files, llmProvider);
        
        if (qaResult.status === "PASS") {
          console.log(`[CodeGen] QA validation passed for "${userStory.title}"`);
          return {
            success: true,
            files: devResult.files
          };
        } else {
          lastError = `QA validation failed: ${qaResult.issues.join(", ")}`;
          console.log(`[CodeGen] QA validation failed for "${userStory.title}": ${lastError}`);
          
          if (attempt === maxRetries) {
            // Last attempt, return with errors
            return {
              success: false,
              files: devResult.files, // Include files even if validation failed
              errors: [lastError]
            };
          }
          // Continue to next attempt
        }
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
        console.error(`[CodeGen] Error in attempt ${attempt + 1} for "${userStory.title}":`, error);
        
        if (attempt === maxRetries) {
          return {
            success: false,
            files: [],
            errors: [lastError]
          };
        }
        // Continue to next attempt
      }
    }

    return {
      success: false,
      files: [],
      errors: [lastError || "Unknown error occurred"]
    };
  }
}