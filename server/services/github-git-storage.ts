/**
 * GitHub implementation of IGitStorage (env-based fallback).
 * Wraps GitHubService for when project_git_config uses provider "github" or when no config exists.
 */

import GitHubService from "./github-service";
import type { IGitStorage, GitStorageProvider } from "./git-storage-interface";

export class GitHubGitStorage implements IGitStorage {
  readonly provider: GitStorageProvider = "github";
  private github: GitHubService;
  private owner: string;
  private repo: string;
  private branch: string;

  constructor(config?: { owner?: string; repo?: string; branch?: string; token?: string }) {
    this.github = new GitHubService(config);
    this.owner = config?.owner || process.env.GITHUB_OWNER || "";
    this.repo = config?.repo || process.env.GITHUB_REPO || "";
    this.branch = config?.branch || process.env.GITHUB_BRANCH || "main";
  }

  async pushFile(filePath: string, content: string, commitMessage: string): Promise<void> {
    const normalizedPath = filePath.startsWith("/") ? filePath.slice(1) : filePath;
    await this.github.pushFile(normalizedPath, content, commitMessage);
  }

  async pushMultipleFiles(
    files: Array<{ path: string; content: string }>,
    basePath: string,
    _commitMessage?: string
  ): Promise<Array<{ path: string; status: "success" | "error" }>> {
    const normalizedPath = basePath.startsWith("/") ? basePath.slice(1) : basePath;
    const results = await this.github.pushMultipleFiles(files, normalizedPath);
    return results.map((r: any) => ({
      path: r.path,
      status: r.status === "success" ? "success" : "error",
    }));
  }

  async getFileContent(filePath: string): Promise<string> {
    const normalizedPath = filePath.startsWith("/") ? filePath.slice(1) : filePath;
    return this.github.getFileContent(normalizedPath);
  }

  async listDirectoryContents(
    dirPath: string
  ): Promise<Array<{ name: string; type: "file" | "dir"; path: string }>> {
    const normalizedPath = dirPath.startsWith("/") ? dirPath.slice(1) : dirPath;
    return this.github.listDirectoryContents(normalizedPath);
  }

  async pathExists(path: string): Promise<boolean> {
    const normalizedPath = path.startsWith("/") ? path.slice(1) : path;
    try {
      await this.github.listDirectoryContents(normalizedPath);
      return true;
    } catch {
      try {
        await this.github.getFileContent(normalizedPath);
        return true;
      } catch {
        return false;
      }
    }
  }

  getBaseUrl(): string {
    return `https://github.com/${this.owner}/${this.repo}/tree/${this.branch}`;
  }

  getFileUrl(filePath: string): string {
    const path = filePath.startsWith("/") ? filePath.slice(1) : filePath;
    return `https://github.com/${this.owner}/${this.repo}/blob/${this.branch}/${encodeURIComponent(path)}`;
  }
}
