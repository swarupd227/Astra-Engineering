interface GitLabRequestOptions {
  method?: "GET" | "POST" | "PUT";
  body?: Record<string, any>;
}

function formatGitLabErrorMessage(value: unknown): string {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(formatGitLabErrorMessage).filter(Boolean).join(", ");
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    return entries
      .map(([key, item]) => {
        const formatted = formatGitLabErrorMessage(item);
        return formatted ? `${key}: ${formatted}` : "";
      })
      .filter(Boolean)
      .join("; ");
  }
  return String(value);
}

export interface GitLabGroup {
  id: number;
  name: string;
  full_path: string;
}

export interface GitLabProject {
  id: number;
  name: string;
  path_with_namespace: string;
  default_branch?: string | null;
}

export interface GitLabPipeline {
  id: number;
  status: string;
  ref: string;
  created_at?: string;
  updated_at?: string;
  web_url?: string;
}

export interface GitLabDeployment {
  id: number;
  status: string;
  created_at?: string;
  updated_at?: string;
  ref?: string;
  environment?: { name?: string };
  deployable?: { id?: number; name?: string; status?: string };
}

export class GitLabService {
  private readonly token: string;
  private readonly baseUrl: string;

  constructor(token: string, baseUrl = "https://gitlab.com/api/v4") {
    if (!token?.trim()) {
      throw new Error("GitLab token is required.");
    }
    this.token = token.trim();
    this.baseUrl = baseUrl.replace(/\/$/, "");
  }

  private buildProjectRef(projectIdOrPath: string): string {
    const value = (projectIdOrPath || "").trim();
    if (!value) {
      throw new Error("GitLab project reference is required.");
    }
    return /^\d+$/.test(value) ? value : encodeURIComponent(value);
  }

  private async request<T>(
    path: string,
    options: GitLabRequestOptions = {}
  ): Promise<T> {
    const method = options.method ?? "GET";
    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        "PRIVATE-TOKEN": this.token,
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
    });

    if (!response.ok) {
      let message = `GitLab API request failed (${response.status})`;
      try {
        const data = await response.json();
        message =
          formatGitLabErrorMessage(data?.message || data?.error || data?.errors || data) ||
          message;
      } catch {
        // no-op
      }
      throw Object.assign(new Error(message), { status: response.status });
    }

    if (response.status === 204) {
      return null as T;
    }

    return (await response.json()) as T;
  }

  async getGroups(): Promise<GitLabGroup[]> {
    return this.request<GitLabGroup[]>(
      "/groups?membership=true&per_page=100&order_by=name&sort=asc"
    );
  }

  async getGroupProjects(groupId: string): Promise<GitLabProject[]> {
    const normalizedGroupId = encodeURIComponent(groupId);
    return this.request<GitLabProject[]>(
      `/groups/${normalizedGroupId}/projects?include_subgroups=true&simple=true&per_page=100&order_by=name&sort=asc`
    );
  }

  async getProject(projectIdOrPath: string): Promise<GitLabProject> {
    const ref = this.buildProjectRef(projectIdOrPath);
    return this.request<GitLabProject>(`/projects/${ref}`);
  }

  async getBranches(projectIdOrPath: string): Promise<Array<{ name: string }>> {
    const ref = this.buildProjectRef(projectIdOrPath);
    return this.request<Array<{ name: string }>>(
      `/projects/${ref}/repository/branches?per_page=100`
    );
  }

  async getPipelines(projectIdOrPath: string): Promise<GitLabPipeline[]> {
    const ref = this.buildProjectRef(projectIdOrPath);
    return this.request<GitLabPipeline[]>(
      `/projects/${ref}/pipelines?per_page=100&order_by=updated_at&sort=desc`
    );
  }

  async getPipeline(projectIdOrPath: string, pipelineId: number): Promise<GitLabPipeline> {
    const ref = this.buildProjectRef(projectIdOrPath);
    return this.request<GitLabPipeline>(`/projects/${ref}/pipelines/${pipelineId}`);
  }

  /** Validate CI/CD YAML using GitLab CI Lint API. */
  async lintCiConfig(
    projectIdOrPath: string,
    content: string
  ): Promise<{ valid?: boolean; status?: string; errors?: unknown[]; warnings?: unknown[]; merged_yaml?: string }> {
    const projectRef = this.buildProjectRef(projectIdOrPath);
    return this.request(`/projects/${projectRef}/ci/lint`, {
      method: "POST",
      body: { content: content ?? "" },
    });
  }

  /** Return file raw text or null if missing (404). */
  async tryGetRawFile(projectIdOrPath: string, filePath: string, branch: string): Promise<string | null> {
    try {
      return await this.getFileContent(projectIdOrPath, filePath, branch);
    } catch {
      return null;
    }
  }

  /** Create a new pipeline run for the given branch/tag with optional variables. */
  async createPipeline(
    projectIdOrPath: string,
    ref: string,
    variables?: Array<{ key: string; value: string }>
  ): Promise<GitLabPipeline> {
    const projectRef = this.buildProjectRef(projectIdOrPath);
    const cleanVariables = Array.isArray(variables)
      ? variables
          .map((v) => ({
            key: String(v?.key || "").trim(),
            value: String(v?.value || ""),
          }))
          .filter((v) => !!v.key)
      : [];
    return this.request<GitLabPipeline>(`/projects/${projectRef}/pipeline`, {
      method: "POST",
      body: {
        ref: ref.trim(),
        ...(cleanVariables.length > 0 ? { variables: cleanVariables } : {}),
      },
    });
  }

  async getPipelineJobs(projectIdOrPath: string, pipelineId: number): Promise<any[]> {
    const ref = this.buildProjectRef(projectIdOrPath);
    return this.request<any[]>(
      `/projects/${ref}/pipelines/${pipelineId}/jobs?per_page=100`
    );
  }

  async getDeployments(projectIdOrPath: string): Promise<GitLabDeployment[]> {
    const ref = this.buildProjectRef(projectIdOrPath);
    return this.request<GitLabDeployment[]>(
      `/projects/${ref}/deployments?per_page=100&order_by=updated_at&sort=desc`
    );
  }

  async getFileContent(projectIdOrPath: string, filePath: string, branch: string): Promise<string> {
    const ref = this.buildProjectRef(projectIdOrPath);
    const encodedPath = encodeURIComponent(filePath.replace(/^\/+/, ""));
    const response = await fetch(
      `${this.baseUrl}/projects/${ref}/repository/files/${encodedPath}/raw?ref=${encodeURIComponent(branch)}`,
      {
        headers: {
          "PRIVATE-TOKEN": this.token,
        },
      }
    );

    if (!response.ok) {
      throw Object.assign(new Error(`Unable to read GitLab file ${filePath} (${response.status})`), { status: response.status });
    }
    return response.text();
  }

  async listDirectoryContents(
    projectIdOrPath: string,
    dirPath: string,
    branch: string
  ): Promise<Array<{ name: string; type: "file" | "dir"; path: string }>> {
    const ref = this.buildProjectRef(projectIdOrPath);
    const cleanPath = dirPath.replace(/^\/+/, "");
    const pathParam = cleanPath ? `&path=${encodeURIComponent(cleanPath)}` : "";
    const nodes = await this.request<Array<{ name: string; type: string; path: string }>>(
      `/projects/${ref}/repository/tree?ref=${encodeURIComponent(branch)}${pathParam}&per_page=100`
    );
    return nodes.map((node) => ({
      name: node.name,
      type: node.type === "tree" ? "dir" : "file",
      path: node.path,
    }));
  }

  async upsertFile(
    projectIdOrPath: string,
    filePath: string,
    content: string,
    branch: string,
    commitMessage: string
  ): Promise<void> {
    const ref = this.buildProjectRef(projectIdOrPath);
    const cleanPath = filePath.replace(/^\/+/, "");
    const encodedPath = encodeURIComponent(cleanPath);
    const body = {
      branch,
      content,
      commit_message: commitMessage,
      encoding: "text",
    };

    const exists = await this.pathExists(projectIdOrPath, cleanPath, branch);
    const method = exists ? "PUT" : "POST";
    await this.request(`/projects/${ref}/repository/files/${encodedPath}`, {
      method,
      body,
    });
  }

  async pathExists(projectIdOrPath: string, path: string, branch: string): Promise<boolean> {
    const ref = this.buildProjectRef(projectIdOrPath);
    const cleanPath = path.replace(/^\/+/, "");
    const encodedPath = encodeURIComponent(cleanPath);
    const response = await fetch(
      `${this.baseUrl}/projects/${ref}/repository/files/${encodedPath}?ref=${encodeURIComponent(branch)}`,
      {
        headers: {
          "PRIVATE-TOKEN": this.token,
        },
      }
    );
    if (response.ok) {
      return true;
    }
    if (response.status !== 404) {
      return false;
    }

    try {
      const entries = await this.listDirectoryContents(projectIdOrPath, cleanPath, branch);
      return entries.length > 0;
    } catch {
      return false;
    }
  }
}

export default GitLabService;
