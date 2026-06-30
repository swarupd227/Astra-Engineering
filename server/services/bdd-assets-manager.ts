/**
 * BDD Assets Manager Service
 * Handles file organization, Git push (GitHub or ADO), and ZIP export for BDD test assets
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import archiver from 'archiver';
import { Octokit } from '@octokit/rest';
import type { IGitStorage } from './git-storage-interface';
import { buildStoryArtifactsPath, sanitizePathName, type GitStorageProvider } from '../constants/repo-paths';

interface FileStructure {
  filename: string;
  content: string;
  category: string;
  type: 'feature' | 'stepDefinition';
}

interface FolderStructure {
  rootFolder: string;
  features: {
    [category: string]: Array<{ filename: string; content: string }>;
  };
  stepDefinitions: {
    [category: string]: Array<{ filename: string; content: string }>;
  };
}

export class BDDAssetsManager {
  /**
   * Organize BDD assets into proper folder structure
   * Updated to use flat structure (no category subfolders)
   */
  organizeBDDAssets(
    featureFiles: Array<{ filename: string; content: string; category: string }>,
    stepDefFiles: Array<{ filename: string; content: string; category: string }>,
    userStory: { id: string; title: string },
    organization?: string,
    projectName?: string,
    provider?: GitStorageProvider
  ): FolderStructure {
    const rootFolderName = this.generateRootFolderName(userStory, organization, projectName, provider);
    
    const structure: FolderStructure = {
      rootFolder: rootFolderName,
      features: { 'all': [] }, // Flat structure - all features in one folder
      stepDefinitions: { 'all': [] } // Flat structure - all step defs in one folder
    };

    // Add all feature files to single 'all' category (flat)
    featureFiles.forEach(file => {
      structure.features['all'].push({
        filename: file.filename,
        content: file.content
      });
    });

    // Add all step definition files to single 'all' category (flat)
    stepDefFiles.forEach(file => {
      structure.stepDefinitions['all'].push({
        filename: file.filename,
        content: file.content
      });
    });

    return structure;
  }

  /**
   * Create folder structure in local temp directory
   * PRODUCTION-SAFE: Uses async operations and unique folder names
   * Updated to use flat structure (no category subfolders)
   */
  async createLocalFolderStructure(structure: FolderStructure): Promise<string> {
    // Add unique ID to prevent race conditions when multiple users generate for same story
    const uniqueId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const tempDir = path.join(os.tmpdir(), 'devx-bdd-assets', `${structure.rootFolder}-${uniqueId}`);
    
    // Clean existing directory (if any) - use async
    try {
      await fs.promises.rm(tempDir, { recursive: true, force: true });
    } catch (err) {
      // Ignore if doesn't exist
    }
    
    // Create root directory - async
    await fs.promises.mkdir(tempDir, { recursive: true });

    // Create features folder (flat - all files directly in features/)
    const featuresDir = path.join(tempDir, 'features');
    await fs.promises.mkdir(featuresDir, { recursive: true });

    // Write all feature files directly to features/ folder
    for (const [category, files] of Object.entries(structure.features)) {
      for (const file of files) {
        const filePath = path.join(featuresDir, file.filename);
        await fs.promises.writeFile(filePath, file.content, 'utf8');
      }
    }

    // Create step-definitions folder (flat - all files directly in step-definitions/)
    const stepDefsDir = path.join(tempDir, 'step-definitions');
    await fs.promises.mkdir(stepDefsDir, { recursive: true });

    // Write all step definition files directly to step-definitions/ folder
    for (const [category, files] of Object.entries(structure.stepDefinitions)) {
      for (const file of files) {
        const filePath = path.join(stepDefsDir, file.filename);
        await fs.promises.writeFile(filePath, file.content, 'utf8');
      }
    }

    // Create README.md
    const readmeContent = this.generateReadme(structure);
    await fs.promises.writeFile(path.join(tempDir, 'README.md'), readmeContent, 'utf8');

    return tempDir;
  }

  /**
   * Create ZIP archive of BDD assets
   */
  async createZipArchive(localPath: string, outputFilename: string): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      const archive = archiver('zip', {
        zlib: { level: 9 } // Maximum compression
      });

      archive.on('data', (chunk: Buffer) => {
        chunks.push(chunk);
      });

      archive.on('end', () => {
        const buffer = Buffer.concat(chunks);
        resolve(buffer);
      });

      archive.on('error', (err: Error) => {
        reject(err);
      });

      // Add all files from the directory
      archive.directory(localPath, false);
      archive.finalize();
    });
  }

  /**
   * Push BDD assets to GitHub repository
   */
  async pushToGitHub(
    structure: FolderStructure,
    githubConfig: {
      token: string;
      owner: string;
      repo: string;
      branch?: string;
      basePath?: string;
    }
  ): Promise<{ success: boolean; commitSha?: string; error?: string }> {
    try {
      const octokit = new Octokit({ auth: githubConfig.token });
      const branch = githubConfig.branch || 'main';
      
      // Note: rootFolder already contains full path (AutomationScript/...) 
      // so we don't need basePath prefix to match manual test cases location

      // Get the latest commit SHA for the branch
      const { data: refData } = await octokit.git.getRef({
        owner: githubConfig.owner,
        repo: githubConfig.repo,
        ref: `heads/${branch}`
      });
      const latestCommitSha = refData.object.sha;

      // Get the tree SHA from the latest commit
      const { data: commitData } = await octokit.git.getCommit({
        owner: githubConfig.owner,
        repo: githubConfig.repo,
        commit_sha: latestCommitSha
      });
      const baseTreeSha = commitData.tree.sha;

      // Create blobs and tree
      const tree: Array<{ path: string; mode: '100644'; type: 'blob'; sha: string }> = [];

      // Add feature files (flat structure - all in features/ folder)
      // Path: AutomationScript/{projectFolder}/{story}/features/file.feature
      for (const [category, files] of Object.entries(structure.features)) {
        for (const file of files) {
          const { data: blobData } = await octokit.git.createBlob({
            owner: githubConfig.owner,
            repo: githubConfig.repo,
            content: Buffer.from(file.content).toString('base64'),
            encoding: 'base64'
          });

          tree.push({
            path: `${structure.rootFolder}/features/${file.filename}`,
            mode: '100644',
            type: 'blob',
            sha: blobData.sha
          });
        }
      }

      // Add step definition files (flat structure - all in step-definitions/ folder)
      // Path: AutomationScript/{projectFolder}/{story}/step-definitions/file.ts
      for (const [category, files] of Object.entries(structure.stepDefinitions)) {
        for (const file of files) {
          const { data: blobData } = await octokit.git.createBlob({
            owner: githubConfig.owner,
            repo: githubConfig.repo,
            content: Buffer.from(file.content).toString('base64'),
            encoding: 'base64'
          });

          tree.push({
            path: `${structure.rootFolder}/step-definitions/${file.filename}`,
            mode: '100644',
            type: 'blob',
            sha: blobData.sha
          });
        }
      }

      // Add README.md
      // Path: AutomationScript/{projectFolder}/{story}/README.md
      const readmeContent = this.generateReadme(structure);
      const { data: readmeBlobData } = await octokit.git.createBlob({
        owner: githubConfig.owner,
        repo: githubConfig.repo,
        content: Buffer.from(readmeContent).toString('base64'),
        encoding: 'base64'
      });

      tree.push({
        path: `${structure.rootFolder}/README.md`,
        mode: '100644',
        type: 'blob',
        sha: readmeBlobData.sha
      });

      // Create new tree
      const { data: treeData } = await octokit.git.createTree({
        owner: githubConfig.owner,
        repo: githubConfig.repo,
        tree,
        base_tree: baseTreeSha
      });

      // Create commit
      const { data: newCommit } = await octokit.git.createCommit({
        owner: githubConfig.owner,
        repo: githubConfig.repo,
        message: `Add BDD test assets for ${structure.rootFolder}`,
        tree: treeData.sha,
        parents: [latestCommitSha]
      });

      // Update reference
      await octokit.git.updateRef({
        owner: githubConfig.owner,
        repo: githubConfig.repo,
        ref: `heads/${branch}`,
        sha: newCommit.sha
      });

      return {
        success: true,
        commitSha: newCommit.sha
      };
    } catch (error) {
      console.error('[BDDAssetsManager] GitHub push failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Generate root folder name from user story.
   * Structure: AutomationScript -> {org}-{project} -> User Story.
   */
  private generateRootFolderName(
    userStory: { id: string; title: string },
    organization?: string,
    projectName?: string,
    _provider?: GitStorageProvider
  ): string {
    const org = sanitizePathName(organization || 'unknown-org');
    const proj = sanitizePathName(projectName || 'default-project');
    const storyName = sanitizePathName(userStory.title || `story-${userStory.id}`);
    const projectFolder = `${org}-${proj}`;
    return buildStoryArtifactsPath(projectFolder, storyName);
  }

  /**
   * Check if test artifacts exist in GitHub for a user story
   * Returns true if the folder exists in GitHub
   * Checks the same location where manual test cases are saved
   */
  async checkArtifactsExistInGitHub(
    userStory: { id: string; title: string },
    organization: string,
    projectName: string,
    githubConfig: {
      token: string;
      owner: string;
      repo: string;
      branch: string;
      basePath: string;
    }
  ): Promise<boolean> {
    try {
      const octokit = new Octokit({ auth: githubConfig.token });
      const { branch } = githubConfig;
      
      // Generate the expected folder path (includes full path: AutomationScript/...)
      const folderPath = this.generateRootFolderName(userStory, organization, projectName);
      
      // Try to get contents of the folder
      // If it exists, GitHub will return the contents
      // If it doesn't exist, it will throw an error
      const { data } = await octokit.repos.getContent({
        owner: githubConfig.owner,
        repo: githubConfig.repo,
        path: folderPath,
        ref: branch
      });
      
      // If we got data, the folder exists
      return Array.isArray(data) && data.length > 0;
    } catch (error: any) {
      // 404 means the folder doesn't exist
      if (error.status === 404) {
        return false;
      }
      
      // For other errors, log and return false
      console.error(`[BDDAssetsManager] Error checking GitHub for story ${userStory.id}:`, error.message);
      return false;
    }
  }

  /**
   * Check multiple user stories for existing artifacts in GitHub
   * Returns a map of user story IDs to boolean (exists or not)
   */
  async checkMultipleStoriesInGitHub(
    userStories: Array<{ id: string; title: string }>,
    organization: string,
    projectName: string,
    githubConfig: {
      token: string;
      owner: string;
      repo: string;
      branch: string;
      basePath: string;
    }
  ): Promise<Record<string, boolean>> {
    const results: Record<string, boolean> = {};

    // Check all stories in parallel for better performance
    const checks = userStories.map(async (story) => {
      const exists = await this.checkArtifactsExistInGitHub(story, organization, projectName, githubConfig);
      results[story.id] = exists;
    });

    await Promise.all(checks);

    return results;
  }

  /**
   * Push BDD assets to any Git storage (GitHub or ADO) via IGitStorage.
   */
  async pushToStorage(
    structure: FolderStructure,
    storage: IGitStorage
  ): Promise<{ success: boolean; commitSha?: string; error?: string }> {
    const files: Array<{ path: string; content: string }> = [];

    for (const [, fileList] of Object.entries(structure.features)) {
      for (const file of fileList) {
        files.push({
          path: `${structure.rootFolder}/features/${file.filename}`,
          content: file.content,
        });
      }
    }
    for (const [, fileList] of Object.entries(structure.stepDefinitions)) {
      for (const file of fileList) {
        files.push({
          path: `${structure.rootFolder}/step-definitions/${file.filename}`,
          content: file.content,
        });
      }
    }
    const readmeContent = this.generateReadme(structure);
    files.push({
      path: `${structure.rootFolder}/README.md`,
      content: readmeContent,
    });

    try {
      const results = await storage.pushMultipleFiles(
        files,
        '',
        `Add BDD test assets for ${structure.rootFolder}`
      );
      const allOk = results.every((r) => r.status === 'success');
      return allOk
        ? { success: true }
        : { success: false, error: 'One or more files failed to push' };
    } catch (error) {
      console.error('[BDDAssetsManager] pushToStorage failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Check if test artifacts exist for multiple user stories using any Git storage.
   */
  async checkGeneratedInStorage(
    userStories: Array<{ id: string; title: string }>,
    organization: string,
    projectName: string,
    storage: IGitStorage
  ): Promise<Record<string, boolean>> {
    const results: Record<string, boolean> = {};
    const provider = storage.provider;
    const checks = userStories.map(async (story) => {
      const folderPath = this.generateRootFolderName(story, organization, projectName, provider);
      const exists = await storage.pathExists(folderPath);
      results[story.id] = exists;
    });
    await Promise.all(checks);
    return results;
  }

  /**
   * Generate README.md content
   */
  private generateReadme(structure: FolderStructure): string {
    const featureCategories = Object.keys(structure.features);
    const stepDefCategories = Object.keys(structure.stepDefinitions);
    
    let readme = `# BDD Test Assets\n\n`;
    readme += `## 📁 Folder Structure\n\n`;
    readme += `\`\`\`\n`;
    readme += `${structure.rootFolder}/\n`;
    readme += `├── features/\n`;
    
    featureCategories.forEach((category, idx) => {
      const isLast = idx === featureCategories.length - 1;
      const files = structure.features[category];
      readme += `│   ${isLast ? '└' : '├'}── ${category}/\n`;
      files.forEach((file, fileIdx) => {
        const isLastFile = fileIdx === files.length - 1;
        readme += `│   ${isLast ? ' ' : '│'}   ${isLastFile ? '└' : '├'}── ${file.filename}\n`;
      });
    });
    
    readme += `├── step-definitions/\n`;
    
    stepDefCategories.forEach((category, idx) => {
      const isLast = idx === stepDefCategories.length - 1;
      const files = structure.stepDefinitions[category];
      readme += `│   ${isLast ? '└' : '├'}── ${category}/\n`;
      files.forEach((file, fileIdx) => {
        const isLastFile = fileIdx === files.length - 1;
        readme += `│   ${isLast ? ' ' : '│'}   ${isLastFile ? '└' : '├'}── ${file.filename}\n`;
      });
    });
    
    readme += `└── README.md\n`;
    readme += `\`\`\`\n\n`;
    
    readme += `## 🧪 Test Categories\n\n`;
    
    featureCategories.forEach(category => {
      const files = structure.features[category];
      readme += `### ${this.capitalize(category)}\n`;
      readme += `- **Feature files**: ${files.length}\n`;
      readme += `- **Location**: \`features/${category}/\`\n`;
      readme += `- **Step definitions**: \`step-definitions/${category}/\`\n\n`;
    });
    
    readme += `## 🚀 Running Tests\n\n`;
    readme += `### Prerequisites\n`;
    readme += `\`\`\`bash\n`;
    readme += `npm install\n`;
    readme += `\`\`\`\n\n`;
    
    readme += `### Run All Tests\n`;
    readme += `\`\`\`bash\n`;
    readme += `npm run test:bdd\n`;
    readme += `\`\`\`\n\n`;
    
    readme += `### Run Specific Category\n`;
    readme += `\`\`\`bash\n`;
    featureCategories.forEach(category => {
      readme += `npm run test:${category}\n`;
    });
    readme += `\`\`\`\n\n`;
    
    readme += `## 📝 Generated by DevX 2.0\n`;
    readme += `This test suite was automatically generated by the DevX AI-powered testing platform.\n`;
    
    return readme;
  }

  /**
   * Capitalize first letter
   */
  private capitalize(str: string): string {
    return str.charAt(0).toUpperCase() + str.slice(1).replace(/-/g, ' ');
  }

  /**
   * Clean up temporary files
   * PRODUCTION-SAFE: Uses async operations with proper error handling
   */
  async cleanup(localPath: string): Promise<void> {
    try {
      await fs.promises.rm(localPath, { recursive: true, force: true });
    } catch (error) {
      // Don't throw - cleanup failures shouldn't break the response
      console.error('[BDDAssetsManager] Cleanup failed:', error);
    }
  }
}

export default BDDAssetsManager;
