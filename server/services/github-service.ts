/**
 * GitHub Service for pushing automation scripts to repository
 * Handles authentication, file creation, and commits to GitHub
 */

import { Octokit } from "octokit";

export class GitHubService {
  private octokit: Octokit | null = null;
  private owner: string = "";
  private repo: string = "";
  private branch: string = "";
  private initialized: boolean = false;

  constructor(config?: { owner?: string; repo?: string; branch?: string; token?: string }) {
    if (config) {
      this.initializeWithConfig(config);
    }
  }

  /**
   * Initialize with specific configuration
   */
  private initializeWithConfig(config: { owner?: string; repo?: string; branch?: string; token?: string }) {
    const token = config.token || process.env.GITHUB_TOKEN;
    const owner = config.owner || process.env.GITHUB_OWNER;
    const repo = config.repo || process.env.GITHUB_REPO;
    const branch = config.branch || process.env.GITHUB_BRANCH || "main";

    console.log(`[GitHubService] Initializing with: ${owner}/${repo} on branch [${branch}]`);

    if (!token || !owner || !repo) {
      throw new Error("Missing GitHub configuration (owner, repo, or token).");
    }

    this.octokit = new Octokit({ 
      auth: token,
      log: {
        debug: () => {},
        info: () => {},
        warn: console.warn,
        error: console.error
      }
    });
    this.owner = owner;
    this.repo = repo;
    this.branch = branch;
    this.initialized = true;
  }

  /**
   * Initialize GitHub configuration
   */
  private initialize() {
    if (this.initialized) {
      return;
    }

    const token = process.env.GITHUB_TOKEN;
    const owner = process.env.GITHUB_OWNER;
    const repo = process.env.GITHUB_REPO;
    const branch = process.env.GITHUB_BRANCH || "main";

    if (!token || !owner || !repo) {
      const missing = [];
      if (!token) missing.push("GITHUB_TOKEN");
      if (!owner) missing.push("GITHUB_OWNER");
      if (!repo) missing.push("GITHUB_REPO");
      
      throw new Error(
        `Missing GitHub configuration: ${missing.join(", ")}. Please set these environment variables in your .env file and restart the server.`
      );
    }

    this.octokit = new Octokit({ 
      auth: token,
      log: {
        debug: () => {},
        info: () => {},
        warn: console.warn,
        error: console.error
      }
    });
    this.owner = owner;
    this.repo = repo;
    this.branch = branch;
    this.initialized = true;
  }

  /**
   * Ensure GitHub service is initialized before use
   */
  private ensureInitialized() {
    if (!this.initialized) {
      this.initialize();
    }
  }

  /**
   * Push a file to GitHub
   */
  async pushFile(
    filePath: string,
    content: string,
    commitMessage: string
  ): Promise<any> {
    this.ensureInitialized();
    console.log(`[GitHub] Pushing to repo: ${this.owner}/${this.repo} on branch [${this.branch}]`);
    
    try {
      // Check if file exists
      let sha: string | undefined;
      try {
        const response = await this.octokit!.rest.repos.getContent({
          owner: this.owner,
          repo: this.repo,
          path: filePath,
          ref: this.branch,
        });
        
        if (Array.isArray(response.data)) {
          sha = undefined;
        } else {
          sha = response.data.sha;
        }
      } catch (err: any) {
        if (err.status !== 404) {
          console.warn(`[GitHub] Error checking ${filePath}:`, err.message);
        }
      }

      // Create or update file
      const response = await this.octokit!.rest.repos.createOrUpdateFileContents(
        {
          owner: this.owner,
          repo: this.repo,
          path: filePath,
          message: commitMessage,
          content: Buffer.from(content).toString("base64"),
          branch: this.branch,
          ...(sha && { sha }),
        }
      );

      return response.data;
    } catch (error: any) {
      console.error(`[GitHub] Error pushing file ${filePath}:`, error.message);
      throw new Error(`Failed to push file to GitHub: ${error.message}`);
    }
  }

  /**
   * Create directory structure by pushing files with folder paths
   */
  async ensureDirectoryStructure(dirPath: string): Promise<void> {
    try {
      // Create a .gitkeep file to ensure folder exists
      const gitkeepPath = `${dirPath}/.gitkeep`;
      await this.pushFile(gitkeepPath, "", `Create ${dirPath} directory`);
    } catch (error) {
      // Silent failure for directory creation
    }
  }

  /**
   * Push multiple files (batch operation)
   */
  async pushMultipleFiles(
    files: Array<{ path: string; content: string }>,
    basePath: string
  ): Promise<any[]> {
    const results = [];
    const normalizedBase = basePath.trim().replace(/\/+$/, ""); // Remove trailing slashes
    
    for (const file of files) {
      try {
        const normalizedFile = file.path.replace(/^\/+/, ""); // Remove leading slashes
        
        // Avoid duplicate folder prefix if file path already starts with basePath
        let fullPath = normalizedFile;
        if (normalizedBase && !normalizedFile.startsWith(normalizedBase)) {
          fullPath = `${normalizedBase}/${normalizedFile}`;
        }
        
        const result = await this.pushFile(
          fullPath,
          file.content,
          `Add test automation: ${file.path}`
        );
        results.push({ path: file.path, status: "success", result });
      } catch (error) {
        results.push({ path: file.path, status: "error", error });
      }
    }
    return results;
  }

  /**
   * Create a pull request for test automation scripts
   */
  async createPullRequest(
    title: string,
    description: string,
    sourceBranch: string,
    targetBranch: string = "main"
  ): Promise<any> {
    this.ensureInitialized();
    
    try {
      const response = await this.octokit!.rest.pulls.create({
        owner: this.owner,
        repo: this.repo,
        title: title,
        body: description,
        head: sourceBranch,
        base: targetBranch,
      });

      return response.data;
    } catch (error: any) {
      console.error(`[GitHub] Error creating PR:`, error.message);
      throw new Error(`Failed to create pull request: ${error.message}`);
    }
  }

  /**
   * List directory contents from repository
   */
  async listDirectoryContents(dirPath: string): Promise<Array<{ name: string; type: 'file' | 'dir'; path: string }>> {
    this.ensureInitialized();
    
    try {
      const response = await this.octokit!.rest.repos.getContent({
        owner: this.owner,
        repo: this.repo,
        path: dirPath,
        ref: this.branch,
      });

      if (!Array.isArray(response.data)) {
        // Single file, not a directory
        return [];
      }

      return response.data.map((item: any) => ({
        name: item.name,
        type: item.type === 'dir' ? 'dir' : 'file',
        path: item.path
      }));
    } catch (error: any) {
      if (error.status === 404) {
        return [];
      }
      console.error(`[GitHub] Error listing ${dirPath}:`, error.message);
      throw new Error(`Failed to list directory from GitHub: ${error.message}`);
    }
  }

  /**
   * Get file content from repository
   */
  async getFileContent(filePath: string): Promise<string> {
    this.ensureInitialized();
    
    try {
      const response = await this.octokit!.rest.repos.getContent({
        owner: this.owner,
        repo: this.repo,
        path: filePath,
        ref: this.branch,
      });

      const content = (response.data as any).content;
      return Buffer.from(content, "base64").toString("utf-8");
    } catch (error: any) {
      if (error.status === 404) {
        // File doesn't exist - this is normal when checking if files exist
        throw error;
      }
      console.error(`[GitHub] Error reading ${filePath}:`, error.message);
      throw new Error(`Failed to read file from GitHub: ${error.message}`);
    }
  }

  /**
   * Delete a file from repository
   */
  async deleteFile(filePath: string, commitMessage: string): Promise<any> {
    this.ensureInitialized();
    
    try {
      const response = await this.octokit!.rest.repos.getContent({
        owner: this.owner,
        repo: this.repo,
        path: filePath,
        ref: this.branch,
      });

      const sha = (response.data as any).sha;

      const deleteResponse = await this.octokit!.rest.repos.deleteFile({
        owner: this.owner,
        repo: this.repo,
        path: filePath,
        message: commitMessage,
        sha: sha,
        branch: this.branch,
      });

      return deleteResponse.data;
    } catch (error: any) {
      console.error(`[GitHub] Error deleting file ${filePath}:`, error.message);
      throw new Error(`Failed to delete file from GitHub: ${error.message}`);
    }
  }

  /**
   * Get repository info
   */
  async getRepoInfo(): Promise<any> {
    this.ensureInitialized();
    
    try {
      const response = await this.octokit!.rest.repos.get({
        owner: this.owner,
        repo: this.repo,
      });

      return response.data;
    } catch (error: any) {
      console.error(`[GitHub] Error getting repo info:`, error.message);
      throw new Error(`Failed to get repository info: ${error.message}`);
    }
  }
}

export default GitHubService;
