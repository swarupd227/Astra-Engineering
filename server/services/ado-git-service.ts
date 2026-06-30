/**
 * ADO Git implementation of IGitStorage.
 * Wraps AzureDevOpsService to push/list/get files in an ADO project's Git repo.
 */

import { AzureDevOpsService } from "../azure-devops-service";
import type { AzureConfig } from "../azure-devops-service";
import type { IGitStorage, GitStorageProvider } from "./git-storage-interface";

export interface AdoGitStorageConfig {
  organization: string;
  project: string;
  pat: string;
  repositoryId?: string;
  repositoryName?: string;
  branch: string;
  authorName?: string;
}

export class AdoGitStorage implements IGitStorage {
  readonly provider: GitStorageProvider = "ado";
  private ado: AzureDevOpsService;
  private config: AdoGitStorageConfig;
  private repoId: string | null = null;

  constructor(config: AdoGitStorageConfig) {
    this.config = config;
    const azureConfig: AzureConfig = {
      organization: config.organization,
      project: config.project,
      pat: config.pat,
    };
    this.ado = new AzureDevOpsService(azureConfig);
  }

  private async ensureRepository(): Promise<string> {
    if (this.repoId) return this.repoId;
    const repos = await this.ado.getRepositories(this.config.project);
    if (repos.length === 0) throw new Error("No Git repositories found in this project");
    const repo = this.config.repositoryId
      ? repos.find((r: any) => r.id === this.config.repositoryId)
      : this.config.repositoryName
        ? repos.find((r: any) => r.name === this.config.repositoryName)
        : repos[0];
    if (!repo) throw new Error("Configured repository not found in project");
    const repoId = repo.id;
    this.repoId = repoId;
    return repoId;
  }

  async pushFile(filePath: string, content: string, commitMessage: string): Promise<void> {
    const normalizedPath = filePath.startsWith("/") ? filePath.slice(1) : filePath;
    const results = await this.pushMultipleFiles(
      [{ path: normalizedPath, content }],
      "",
      commitMessage
    );
    if (results[0]?.status === "error") throw new Error(`Failed to push file: ${normalizedPath}`);
  }

  async pushMultipleFiles(
    files: Array<{ path: string; content: string }>,
    basePath: string,
    commitMessage?: string
  ): Promise<Array<{ path: string; status: "success" | "error" }>> {
    const repoId = await this.ensureRepository();
    const fullFiles = files.map((f) => ({
      path: basePath ? `${basePath.replace(/\/$/, "")}/${f.path}` : f.path,
      content: f.content,
    }));
    try {
      await this.ado.pushMultipleFiles({
        repositoryId: repoId,
        branchName: this.config.branch,
        files: fullFiles,
        commitMessage: commitMessage || "Add test artifacts",
        authorName: this.config.authorName || "Astra Platform",
      });
      return fullFiles.map((f) => ({ path: f.path, status: "success" as const }));
    } catch (err) {
      return fullFiles.map((f) => ({ path: f.path, status: "error" as const }));
    }
  }

  async getFileContent(filePath: string): Promise<string> {
    const repoId = await this.ensureRepository();
    const normalizedPath = filePath.startsWith("/") ? filePath : `/${filePath}`;
    return this.ado.getFileContent(repoId, normalizedPath, this.config.branch);
  }

  async listDirectoryContents(
    dirPath: string
  ): Promise<Array<{ name: string; type: "file" | "dir"; path: string }>> {
    const repoId = await this.ensureRepository();
    const normalizedPath = dirPath.startsWith("/") ? dirPath : `/${dirPath}`;
    return this.ado.listDirectoryContents(repoId, normalizedPath, this.config.branch);
  }

  async pathExists(path: string): Promise<boolean> {
    const normalizedPath = path.startsWith("/") ? path : `/${path}`;
    try {
      await this.listDirectoryContents(normalizedPath);
      return true;
    } catch {
      try {
        await this.getFileContent(path);
        return true;
      } catch {
        return false;
      }
    }
  }

  getBaseUrl(): string {
    const org = encodeURIComponent(this.config.organization);
    const project = encodeURIComponent(this.config.project);
    return `https://dev.azure.com/${org}/${project}/_git`;
  }

  /** URL to view a file in ADO (repo is resolved after first push). */
  getFileUrl(filePath: string): string {
    if (!this.repoId) return this.getBaseUrl();
    const path = filePath.startsWith("/") ? filePath : `/${filePath}`;
    const org = encodeURIComponent(this.config.organization);
    const project = encodeURIComponent(this.config.project);
    const branch = encodeURIComponent(this.config.branch);
    return `https://dev.azure.com/${org}/${project}/_git/${encodeURIComponent(this.repoId)}?path=${encodeURIComponent(path)}&version=GB${branch}`;
  }
}
