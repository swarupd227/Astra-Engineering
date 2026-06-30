import type {
  GitBranchSummary,
  GitCommitSummary,
  GitRepositorySummary,
  GitStorageProvider,
  IGitStorage,
} from "./git-storage-interface";

interface BitbucketGitStorageConfig {
  workspace: string;
  username: string;
  appPassword: string;
  repositorySlug: string;
  branch?: string;
}

export class BitbucketGitStorage implements IGitStorage {
  readonly provider: GitStorageProvider = "bitbucket";
  private readonly workspace: string;
  private readonly username: string;
  private readonly appPassword: string;
  private readonly repositorySlug: string;
  private readonly branch: string;

  constructor(config: BitbucketGitStorageConfig) {
    this.workspace = config.workspace;
    this.username = config.username;
    this.appPassword = config.appPassword;
    this.repositorySlug = config.repositorySlug;
    this.branch = config.branch || "main";
  }

  private authHeader() {
    return `Basic ${Buffer.from(`${this.username}:${this.appPassword}`).toString("base64")}`;
  }

  private repoSlug(repositoryId?: string) {
    return repositoryId || this.repositorySlug;
  }

  private async request(path: string, init?: RequestInit): Promise<Response> {
    return fetch(`https://api.bitbucket.org/2.0${path}`, {
      ...init,
      headers: {
        Authorization: this.authHeader(),
        ...(init?.headers || {}),
      },
    });
  }

  async pushFile(filePath: string, content: string, commitMessage: string): Promise<void> {
    const results = await this.pushMultipleFiles(
      [{ path: filePath, content }],
      "",
      commitMessage,
    );
    if (results[0]?.status === "error") {
      throw new Error(`Failed to push file ${filePath} to Bitbucket repository`);
    }
  }

  async pushMultipleFiles(
    files: Array<{ path: string; content: string }>,
    basePath: string,
    commitMessage?: string,
  ): Promise<Array<{ path: string; status: "success" | "error" }>> {
    const formData = new FormData();
    formData.append("message", commitMessage || "Update artifacts");
    formData.append("branch", this.branch);

    const normalizedBase = basePath.replace(/^\/+|\/+$/g, "");
    const fullFiles = files.map((file) => ({
      path: [normalizedBase, file.path].filter(Boolean).join("/"),
      content: file.content,
    }));

    for (const file of fullFiles) {
      formData.append(file.path, file.content);
    }

    const response = await this.request(
      `/repositories/${encodeURIComponent(this.workspace)}/${encodeURIComponent(this.repositorySlug)}/src`,
      { method: "POST", body: formData },
    );
    return fullFiles.map((file) => ({
      path: file.path,
      status: response.ok ? "success" : "error",
    }));
  }

  async getFileContent(filePath: string): Promise<string> {
    const normalizedPath = filePath.replace(/^\/+/, "");
    const response = await this.request(
      `/repositories/${encodeURIComponent(this.workspace)}/${encodeURIComponent(this.repositorySlug)}/src/${encodeURIComponent(this.branch)}/${normalizedPath}`,
    );
    if (!response.ok) {
      throw new Error(`Bitbucket file not found: ${normalizedPath}`);
    }
    return response.text();
  }

  async listDirectoryContents(
    dirPath: string,
  ): Promise<Array<{ name: string; type: "file" | "dir"; path: string }>> {
    const normalizedPath = dirPath.replace(/^\/+/, "");
    const pathPart = normalizedPath ? `/${normalizedPath}` : "";
    const response = await this.request(
      `/repositories/${encodeURIComponent(this.workspace)}/${encodeURIComponent(this.repositorySlug)}/src/${encodeURIComponent(this.branch)}${pathPart}`,
    );
    if (!response.ok) return [];
    const data = (await response.json()) as {
      values?: Array<{
        path: string;
        type: "commit_file" | "commit_directory";
      }>;
    };
    return (data.values || []).map((item) => {
      const parts = item.path.split("/");
      return {
        name: parts[parts.length - 1],
        type: item.type === "commit_directory" ? "dir" : "file",
        path: item.path,
      };
    });
  }

  async pathExists(path: string): Promise<boolean> {
    const normalizedPath = path.replace(/^\/+/, "");
    try {
      await this.getFileContent(normalizedPath);
      return true;
    } catch {
      try {
        const entries = await this.listDirectoryContents(normalizedPath);
        return entries.length > 0;
      } catch {
        return false;
      }
    }
  }

  async listRepositories(): Promise<GitRepositorySummary[]> {
    const response = await this.request(
      `/repositories/${encodeURIComponent(this.workspace)}?pagelen=100`,
    );
    if (!response.ok) return [];
    const data = (await response.json()) as {
      values?: Array<{
        slug: string;
        name: string;
        links?: { html?: { href?: string } };
        mainbranch?: { name?: string };
      }>;
    };
    return (data.values || []).map((repo) => ({
      id: repo.slug,
      name: repo.name,
      webUrl: repo.links?.html?.href,
      defaultBranch: repo.mainbranch?.name,
    }));
  }

  async listBranches(repositoryId?: string): Promise<GitBranchSummary[]> {
    const slug = this.repoSlug(repositoryId);
    const response = await this.request(
      `/repositories/${encodeURIComponent(this.workspace)}/${encodeURIComponent(slug)}/refs/branches?pagelen=100`,
    );
    if (!response.ok) return [];
    const data = (await response.json()) as {
      values?: Array<{ name: string }>;
    };
    return (data.values || []).map((branch) => ({ name: branch.name }));
  }

  async listCommits(repositoryId?: string, limit = 50): Promise<GitCommitSummary[]> {
    const slug = this.repoSlug(repositoryId);
    const response = await this.request(
      `/repositories/${encodeURIComponent(this.workspace)}/${encodeURIComponent(slug)}/commits?pagelen=${Math.max(1, limit)}`,
    );
    if (!response.ok) return [];
    const data = (await response.json()) as {
      values?: Array<{
        hash: string;
        message: string;
        date?: string;
        author?: { user?: { display_name?: string }; raw?: string };
      }>;
    };
    return (data.values || []).map((commit) => ({
      id: commit.hash,
      message: commit.message,
      authorName: commit.author?.user?.display_name || commit.author?.raw,
      authoredAt: commit.date,
    }));
  }
}
