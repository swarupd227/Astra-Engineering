import type {
  GitBranchSummary,
  GitCommitSummary,
  GitRepositorySummary,
  GitStorageProvider,
  IGitStorage,
} from "./git-storage-interface";

interface GitLabGitStorageConfig {
  baseUrl: string;
  token: string;
  projectId: string;
  branch?: string;
}

type GitLabTreeItem = {
  id: string;
  name: string;
  type: "blob" | "tree";
  path: string;
};

async function readGitLabError(response: Response): Promise<string> {
  const text = await response.text().catch(() => "");
  if (!text) return `HTTP ${response.status}`;
  try {
    const payload = JSON.parse(text);
    const message = payload?.message || payload?.error || text;
    return typeof message === "string"
      ? `${response.status}: ${message}`
      : `${response.status}: ${JSON.stringify(message)}`;
  } catch {
    return `${response.status}: ${text.slice(0, 300)}`;
  }
}

export class GitLabGitStorage implements IGitStorage {
  readonly provider: GitStorageProvider = "gitlab";
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly projectId: string;
  private readonly branch: string;

  constructor(config: GitLabGitStorageConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, "");
    this.token = config.token;
    this.projectId = config.projectId;
    this.branch = config.branch || "main";
  }

  private get projectPath() {
    return encodeURIComponent(this.projectId);
  }

  private async request(path: string, init?: RequestInit): Promise<Response> {
    const response = await fetch(`${this.baseUrl}/api/v4${path}`, {
      ...init,
      headers: {
        "PRIVATE-TOKEN": this.token,
        ...(init?.headers || {}),
      },
    });
    return response;
  }

  async pushFile(filePath: string, content: string, commitMessage: string): Promise<void> {
    const results = await this.pushMultipleFiles(
      [{ path: filePath, content }],
      "",
      commitMessage,
    );
    if (results[0]?.status === "error") {
      throw new Error(`Failed to push file ${filePath} to GitLab repository`);
    }
  }

  async pushMultipleFiles(
    files: Array<{ path: string; content: string }>,
    basePath: string,
    commitMessage?: string,
  ): Promise<Array<{ path: string; status: "success" | "error" }>> {
    const normalizedBase = basePath.replace(/^\/+|\/+$/g, "");
    const normalizedFiles = files.map((file) => ({
      path: [normalizedBase, file.path.replace(/^\/+/, "")].filter(Boolean).join("/"),
      content: file.content,
    }));

    if (normalizedFiles.length === 0) return [];

    const actions: Array<{
      action: "create" | "update";
      file_path: string;
      content: string;
    }> = [];

    for (const file of normalizedFiles) {
      const fullPath = file.path;
      const encodedPath = encodeURIComponent(fullPath);
      const existing = await this.request(
        `/projects/${this.projectPath}/repository/files/${encodedPath}?ref=${encodeURIComponent(this.branch)}`,
      );

      if (existing.ok) {
        actions.push({
          action: "update",
          file_path: fullPath,
          content: file.content,
        });
        continue;
      }

      if (existing.status === 404) {
        actions.push({
          action: "create",
          file_path: fullPath,
          content: file.content,
        });
        continue;
      }

      throw new Error(
        `Failed to inspect GitLab file "${fullPath}" before commit: ${await readGitLabError(existing)}`,
      );
    }

    const response = await this.request(
      `/projects/${this.projectPath}/repository/commits`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          branch: this.branch,
          commit_message: commitMessage || "Update artifacts",
          actions,
        }),
      },
    );

    if (!response.ok) {
      throw new Error(`Failed to create GitLab commit: ${await readGitLabError(response)}`);
    }

    return normalizedFiles.map((file) => ({ path: file.path, status: "success" }));
  }

  async getFileContent(filePath: string): Promise<string> {
    const normalizedPath = filePath.replace(/^\/+/, "");
    const encodedPath = encodeURIComponent(normalizedPath);
    const response = await this.request(
      `/projects/${this.projectPath}/repository/files/${encodedPath}/raw?ref=${encodeURIComponent(this.branch)}`,
    );
    if (!response.ok) {
      throw new Error(`GitLab file not found: ${normalizedPath}`);
    }
    return response.text();
  }

  async listDirectoryContents(
    dirPath: string,
  ): Promise<Array<{ name: string; type: "file" | "dir"; path: string }>> {
    const normalizedPath = dirPath.replace(/^\/+/, "");
    const query = normalizedPath ? `&path=${encodeURIComponent(normalizedPath)}` : "";
    const response = await this.request(
      `/projects/${this.projectPath}/repository/tree?ref=${encodeURIComponent(this.branch)}${query}`,
    );
    if (!response.ok) return [];
    const items = (await response.json()) as GitLabTreeItem[];
    return items.map((item) => ({
      name: item.name,
      type: item.type === "tree" ? "dir" : "file",
      path: item.path,
    }));
  }

  async pathExists(path: string): Promise<boolean> {
    const normalizedPath = path.replace(/^\/+/, "");
    try {
      const entries = await this.listDirectoryContents(normalizedPath);
      if (entries.length > 0) return true;
      await this.getFileContent(normalizedPath);
      return true;
    } catch {
      return false;
    }
  }

  async listRepositories(): Promise<GitRepositorySummary[]> {
    const response = await this.request("/projects?membership=true&per_page=100");
    if (!response.ok) return [];
    const data = (await response.json()) as Array<{
      id: number;
      name: string;
      web_url?: string;
      default_branch?: string;
    }>;
    return data.map((repo) => ({
      id: String(repo.id),
      name: repo.name,
      webUrl: repo.web_url,
      defaultBranch: repo.default_branch || undefined,
    }));
  }

  async listBranches(repositoryId?: string): Promise<GitBranchSummary[]> {
    const repoId = encodeURIComponent(repositoryId || this.projectId);
    const response = await this.request(`/projects/${repoId}/repository/branches?per_page=100`);
    if (!response.ok) return [];
    const data = (await response.json()) as Array<{ name: string }>;
    return data.map((branch) => ({ name: branch.name }));
  }

  async listCommits(repositoryId?: string, limit = 50): Promise<GitCommitSummary[]> {
    const repoId = encodeURIComponent(repositoryId || this.projectId);
    const response = await this.request(
      `/projects/${repoId}/repository/commits?per_page=${Math.max(1, limit)}`,
    );
    if (!response.ok) return [];
    const data = (await response.json()) as Array<{
      id: string;
      title: string;
      author_name?: string;
      authored_date?: string;
    }>;
    return data.map((commit) => ({
      id: commit.id,
      message: commit.title,
      authorName: commit.author_name,
      authoredAt: commit.authored_date,
    }));
  }
}
