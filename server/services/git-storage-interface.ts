/**
 * Git storage abstraction for test artifacts (Manual Test Cases, BDD assets).
 * Implementations: GitHub, GitLab, Bitbucket, and ADO Git (per-project).
 */

export type GitStorageProvider =
  | "github"
  | "ado"
  | "gitlab"
  | "bitbucket";

export interface GitRepositorySummary {
  id: string;
  name: string;
  webUrl?: string;
  defaultBranch?: string;
}

export interface GitBranchSummary {
  name: string;
}

export interface GitCommitSummary {
  id: string;
  message: string;
  authorName?: string;
  authoredAt?: string;
}

export interface ProjectGitConfig {
  projectId: string;
  provider: GitStorageProvider;
  /** GitHub: owner/repo; ADO: not used (org/project from ADO config) */
  repositoryId?: string | null;
  repositoryName?: string | null;
  branch: string;
  basePath?: string;
  /** For ADO: repository ID in Azure DevOps (when provider is 'ado') */
  adoRepositoryId?: string | null;
  adoRepositoryName?: string | null;
}

export interface IGitStorage {
  readonly provider: GitStorageProvider;

  /** Push a single file. Path is relative to repo root (e.g. AutomationScript/org-proj/.../file.json). */
  pushFile(filePath: string, content: string, commitMessage: string): Promise<void>;

  /** Push multiple files under a base path. Each file.path is relative to basePath. */
  pushMultipleFiles(
    files: Array<{ path: string; content: string }>,
    basePath: string,
    commitMessage?: string
  ): Promise<Array<{ path: string; status: "success" | "error" }>>;

  /** Get raw file content. Returns UTF-8 string. Throws if not found. */
  getFileContent(filePath: string): Promise<string>;

  /** List directory contents. Returns empty array if path does not exist or is not a directory. */
  listDirectoryContents(
    dirPath: string
  ): Promise<Array<{ name: string; type: "file" | "dir"; path: string }>>;

  /** Check if a path exists (file or directory). */
  pathExists(path: string): Promise<boolean>;

  /** Optional: base URL for "View in repo" links (e.g. GitHub tree URL or ADO commit URL). */
  getBaseUrl?(): string;

  /** Optional: full URL to view a specific file in the repo (e.g. ADO file view or GitHub blob). */
  getFileUrl?(filePath: string): string;

  /** Optional: list repositories accessible by current credentials. */
  listRepositories?(): Promise<GitRepositorySummary[]>;

  /** Optional: list branches for a repository. */
  listBranches?(repositoryId?: string): Promise<GitBranchSummary[]>;

  /** Optional: list commits for a repository. */
  listCommits?(repositoryId?: string, limit?: number): Promise<GitCommitSummary[]>;
}
