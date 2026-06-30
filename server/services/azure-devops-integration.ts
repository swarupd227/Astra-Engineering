import { AzureDevOpsService, type AzureConfig } from "../azure-devops-service";
import type { GeneratedFile } from "./dev-agent";
import { randomUUID } from 'crypto';

export interface RepoCreationResult {
  success: boolean;
  repositoryUrl?: string;
  repositoryId?: string;
  error?: string;
  actualRepositoryName?: string; // Return the actual name used
}

export class AzureDevOpsIntegration {
  private config: AzureConfig;

  constructor(config: { organization: string; projectId: string; personalAccessToken: string }) {
    this.config = {
      organization: config.organization,
      project: config.projectId, 
      pat: config.personalAccessToken
    };
  }

  async createRepositoryWithFiles(
    projectName: string,
    files: GeneratedFile[],
    repositoryName?: string
  ): Promise<RepoCreationResult> {
    try {
      // Generate a more unique repository name
      const baseRepoName = repositoryName || projectName || 'generated-code';
      const uniqueRepoName = await this.generateUniqueRepositoryName(baseRepoName);
      
      console.log(`[AzureDevOps] Creating repository: ${uniqueRepoName}`);

      // Create a new repository using REST API directly
      const repository = await this.createRepository(uniqueRepoName);
      
      if (!repository.success) {
        return {
          success: false,
          error: repository.error || "Failed to create repository"
        };
      }

      console.log(`[AzureDevOps] Repository created: ${repository.repositoryId}`);
      console.log(`[AzureDevOps] Repository URL: ${repository.repositoryUrl}`);

      // Commit all files in a single commit using pushMultipleFiles method
      const azureService = new AzureDevOpsService(this.config);
      
      try {
        console.log(`[AzureDevOps] Attempting to push ${files.length} files to repository ${repository.repositoryId}`);
        console.log(`[AzureDevOps] Files to push:`, files.map(f => f.path));
        
        const commitResult = await azureService.pushMultipleFiles({
          repositoryId: repository.repositoryId, // Use ID instead of name for reliability
          branchName: "main",
          files: files.map(file => ({ path: file.path, content: file.content })),
          commitMessage: `Initial commit: Add ${files.length} generated files`,
          authorName: "DevX Code Generator"
        });
        
        console.log(`[AzureDevOps] Successfully committed ${files.length} files in commit: ${commitResult.commitId}`);
        console.log(`[AzureDevOps] Commit URL: ${commitResult.url}`);
      } catch (error) {
        console.error(`[AzureDevOps] CRITICAL: Failed to commit files to repository:`, error);
        
        // Extract more detailed error information
        let errorDetails = error instanceof Error ? error.message : String(error);
        if (error instanceof Error && error.message.includes('Bad Request')) {
          errorDetails += '. This might be due to: 1) Invalid file paths, 2) Branch creation issues on new repository, 3) File content encoding problems, or 4) Repository permissions.';
        }
        
        throw new Error(`Failed to commit files to repository: ${errorDetails}`);
      }

      console.log(`[AzureDevOps] Files committed successfully to repository: ${repository.repositoryUrl}`);

      return {
        success: true,
        repositoryUrl: repository.repositoryUrl,
        repositoryId: repository.repositoryId,
        actualRepositoryName: uniqueRepoName
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error("[AzureDevOps] Error creating repository with files:", error);
      
      // Check if it's a repository name conflict error
      if (errorMsg.includes('already exists') || errorMsg.includes('TF400948')) {
        return {
          success: false,
          error: `Repository name conflict: ${errorMsg}. Please try again with a different name or wait a moment.`
        };
      }
      
      return {
        success: false,
        error: errorMsg
      };
    }
  }

  /**
   * Generate a unique repository name to avoid conflicts
   */
  private async generateUniqueRepositoryName(baseName: string): Promise<string> {
    // Clean the base name: remove invalid characters and ensure it's not too long
    const cleanBaseName = baseName
      .replace(/[^a-zA-Z0-9-_]/g, '-')  // Replace invalid chars with hyphens
      .replace(/^-+|-+$/g, '')          // Remove leading/trailing hyphens
      .replace(/-+/g, '-')              // Collapse multiple hyphens
      .substring(0, 30);                // Limit length

    // Generate a unique identifier
    const timestamp = Date.now();
    const shortUuid = randomUUID().split('-')[0]; // First 8 chars of UUID
    
    // Create the unique name
    const uniqueName = `${cleanBaseName}-${timestamp}-${shortUuid}`;
    
    console.log(`[AzureDevOps] Generated unique repository name: ${uniqueName}`);
    
    return uniqueName;
  }

  /**
   * Check if a repository with the given name already exists
   */
  private async repositoryExists(name: string): Promise<boolean> {
    try {
      const url = `https://dev.azure.com/${this.config.organization}/${this.config.project}/_apis/git/repositories/${encodeURIComponent(name)}?api-version=7.0`;
      
      const authHeader = `Basic ${Buffer.from(`:${this.config.pat}`).toString('base64')}`;
      
      const response = await fetch(url, {
        method: "GET",
        headers: {
          "Authorization": authHeader
        }
      });

      // If we get a 200, the repository exists
      // If we get a 404, the repository doesn't exist
      // Any other status is an error
      return response.status === 200;
      
    } catch (error) {
      console.error(`[AzureDevOps] Error checking if repository exists:`, error);
      // If we can't check, assume it might exist to be safe
      return true;
    }
  }

  private async createRepository(name: string): Promise<{
    success: boolean;
    repositoryId?: string;
    repositoryUrl?: string;
    error?: string;
  }> {
    try {
      // Create repository using Azure DevOps REST API
      const url = `https://dev.azure.com/${this.config.organization}/${this.config.project}/_apis/git/repositories?api-version=7.0`;
      
      console.log(`[AzureDevOps] Creating repository: ${name}`);
      console.log(`[AzureDevOps] Request URL: ${url}`);
      console.log(`[AzureDevOps] Organization: ${this.config.organization}`);
      console.log(`[AzureDevOps] Project: ${this.config.project}`);
      console.log(`[AzureDevOps] PAT token length: ${this.config.pat ? this.config.pat.length : 'undefined'} chars`);
      
      const authHeader = `Basic ${Buffer.from(`:${this.config.pat}`).toString('base64')}`;
      console.log(`[AzureDevOps] Auth header length: ${authHeader.length}`);
      
      const requestBody = {
        name: name,
        project: {
          id: this.config.project
        }
      };
      
      console.log(`[AzureDevOps] Request body:`, JSON.stringify(requestBody, null, 2));
      
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": authHeader
        },
        body: JSON.stringify(requestBody)
      });
      
      console.log(`[AzureDevOps] Response status: ${response.status} ${response.statusText}`);
      console.log(`[AzureDevOps] Response headers:`, Object.fromEntries(response.headers.entries()));

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[AzureDevOps] Repository creation failed:`);
        console.error(`[AzureDevOps] Status: ${response.status} ${response.statusText}`);
        console.error(`[AzureDevOps] Error body:`, errorText);
        
        // Parse the error if it's JSON
        let parsedError = errorText;
        try {
          const errorJson = JSON.parse(errorText);
          parsedError = JSON.stringify(errorJson, null, 2);
          console.error(`[AzureDevOps] Parsed error:`, errorJson);
        } catch (e) {
          console.error(`[AzureDevOps] Error body is not JSON:`, errorText);
        }
        
        throw new Error(`HTTP ${response.status}: ${errorText}`);
      }

      const result = await response.json();
      console.log(`[AzureDevOps] Repository created successfully:`, result);

      return {
        success: true,
        repositoryId: result.id,
        repositoryUrl: result.webUrl || result.remoteUrl
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }
}