/**
 * GitHub Actions + repository file API (api.github.com).
 */

export interface GithubActionsConfig {
  owner: string;
  repository: string;
  token: string;
}

export interface GithubWorkflowRun {
  id: number;
  name?: string;
  status?: string;
  conclusion?: string | null;
  created_at?: string;
  updated_at?: string;
  run_started_at?: string;
  html_url?: string;
  head_branch?: string;
  workflow_id?: number;
}

export interface GithubWorkflowJob {
  id: number;
  name?: string;
  status?: string;
  conclusion?: string | null;
  started_at?: string;
  completed_at?: string;
  html_url?: string;
  run_id?: number;
}

export interface GithubWorkflow {
  id: number;
  name?: string;
  path?: string;
  state?: string;
}

export interface GithubDeployment {
  id: number;
  environment?: string;
  created_at?: string;
  updated_at?: string;
  statuses_url?: string;
  repository_url?: string;
  ref?: string;
  task?: string;
  original_environment?: string;
}

export interface GithubDeploymentStatus {
  id: number;
  state?: string;
  created_at?: string;
  updated_at?: string;
  environment?: string;
  description?: string;
  target_url?: string;
}

function repoPath(owner: string, repository: string) {
  return `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}`;
}

export function mapGithubRunStatus(run: GithubWorkflowRun): string {
  const status = String(run.status || "").toLowerCase();
  const conclusion = String(run.conclusion || "").toLowerCase();
  if (status === "completed") {
    if (conclusion === "success") return "success";
    if (conclusion === "failure" || conclusion === "timed_out" || conclusion === "action_required") return "failed";
    if (conclusion === "cancelled" || conclusion === "skipped") return "canceled";
    return "completed";
  }
  if (status === "in_progress" || status === "queued" || status === "requested" || status === "waiting") return "running";
  if (status === "pending") return "pending";
  return status || "unknown";
}

export class GithubActionsService {
  private readonly owner: string;
  private readonly repository: string;
  private readonly token: string;

  constructor(config: GithubActionsConfig) {
    this.owner = config.owner;
    this.repository = config.repository;
    this.token = config.token;
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`https://api.github.com${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        ...(init?.headers || {}),
      },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`GitHub API ${res.status}: ${text.slice(0, 400)}`);
    }
    if (res.status === 204) return null as T;
    return (await res.json()) as T;
  }

  async getRepository(): Promise<{ default_branch?: string }> {
    return this.request<{ default_branch?: string }>(repoPath(this.owner, this.repository));
  }

  async listBranches(perPage = 100): Promise<Array<{ name: string }>> {
    const data = await this.request<Array<{ name?: string }>>(
      `${repoPath(this.owner, this.repository)}/branches?per_page=${perPage}`,
    );
    return (data || []).map((b) => ({ name: String(b.name || "") })).filter((b) => !!b.name);
  }

  async listWorkflowRuns(perPage = 50): Promise<GithubWorkflowRun[]> {
    const data = await this.request<{ workflow_runs?: GithubWorkflowRun[] }>(
      `${repoPath(this.owner, this.repository)}/actions/runs?per_page=${perPage}`,
    );
    return data.workflow_runs || [];
  }

  async listDeployments(perPage = 100): Promise<GithubDeployment[]> {
    return this.request<GithubDeployment[]>(
      `${repoPath(this.owner, this.repository)}/deployments?per_page=${perPage}`,
    );
  }

  async listDeploymentStatuses(deploymentId: number, perPage = 20): Promise<GithubDeploymentStatus[]> {
    return this.request<GithubDeploymentStatus[]>(
      `${repoPath(this.owner, this.repository)}/deployments/${deploymentId}/statuses?per_page=${perPage}`,
    );
  }

  async getWorkflowRun(runId: number): Promise<GithubWorkflowRun> {
    return this.request<GithubWorkflowRun>(`${repoPath(this.owner, this.repository)}/actions/runs/${runId}`);
  }

  async listWorkflowJobs(runId: number, perPage = 100): Promise<GithubWorkflowJob[]> {
    const data = await this.request<{ jobs?: GithubWorkflowJob[] }>(
      `${repoPath(this.owner, this.repository)}/actions/runs/${runId}/jobs?per_page=${perPage}`,
    );
    return data.jobs || [];
  }

  async listWorkflows(perPage = 100): Promise<GithubWorkflow[]> {
    const data = await this.request<{ workflows?: GithubWorkflow[] }>(
      `${repoPath(this.owner, this.repository)}/actions/workflows?per_page=${perPage}`,
    );
    return data.workflows || [];
  }

  async dispatchWorkflow(workflowId: number, ref: string, inputs?: Record<string, string>): Promise<void> {
    await this.request(
      `${repoPath(this.owner, this.repository)}/actions/workflows/${workflowId}/dispatches`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ref,
          ...(inputs && Object.keys(inputs).length > 0 ? { inputs } : {}),
        }),
      },
    );
  }

  async getFileContent(ref: string, path: string): Promise<string> {
    const normalized = path.replace(/^\/+/, "");
    const data = await this.request<{ content?: string; encoding?: string }>(
      `${repoPath(this.owner, this.repository)}/contents/${encodeURIComponent(normalized)}?ref=${encodeURIComponent(ref)}`,
    );
    const content = String(data.content || "");
    const encoding = String(data.encoding || "").toLowerCase();
    if (!content) return "";
    return encoding === "base64" ? Buffer.from(content, "base64").toString("utf8") : content;
  }

  async tryGetFileContent(ref: string, path: string): Promise<string | null> {
    try {
      return await this.getFileContent(ref, path);
    } catch (e) {
      if (e instanceof Error && e.message.includes("GitHub API 404")) return null;
      throw e;
    }
  }

  async listRepoYamlFiles(ref: string): Promise<string[]> {
    const branch = encodeURIComponent(ref);
    const tree = await this.request<{ tree?: Array<{ path?: string; type?: string }> }>(
      `${repoPath(this.owner, this.repository)}/git/trees/${branch}?recursive=1`,
    );
    const names = new Set<string>([".github/workflows/ci.yml", ".github/workflows/main.yml"]);
    (tree.tree || []).forEach((entry) => {
      if (entry.type !== "blob") return;
      const p = String(entry.path || "");
      const lower = p.toLowerCase();
      if (lower.endsWith(".yml") || lower.endsWith(".yaml")) names.add(p);
    });
    return Array.from(names).sort();
  }

  async upsertFile(ref: string, path: string, content: string, message: string): Promise<void> {
    const normalized = path.replace(/^\/+/, "");
    let sha: string | undefined;
    try {
      const current = await this.request<{ sha?: string }>(
        `${repoPath(this.owner, this.repository)}/contents/${encodeURIComponent(normalized)}?ref=${encodeURIComponent(ref)}`,
      );
      sha = current.sha;
    } catch {
      sha = undefined;
    }
    await this.request(
      `${repoPath(this.owner, this.repository)}/contents/${encodeURIComponent(normalized)}`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message,
          content: Buffer.from(content, "utf8").toString("base64"),
          branch: ref,
          ...(sha ? { sha } : {}),
        }),
      },
    );
  }
}

