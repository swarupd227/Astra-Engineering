/**
 * Bitbucket Cloud Pipelines + repository file API (api.bitbucket.org/2.0).
 */

export interface BitbucketCiConfig {
  workspace: string;
  repositorySlug: string;
  username: string;
  appPassword: string;
}

export interface BitbucketPipelineRun {
  uuid: string;
  build_number?: number | null;
  state?: { name?: string; type?: string; result?: { name?: string } };
  created_on?: string;
  completed_on?: string | null;
  target?: {
    ref_type?: string;
    ref_name?: string;
    selector?: { type?: string; pattern?: string };
    commit?: { hash?: string };
    type?: string;
  };
  links?: { html?: { href?: string } };
}

export interface BitbucketWorkspaceRepo {
  slug: string;
  name?: string;
  full_name?: string;
  projectKey?: string;
  projectName?: string;
}

function basicAuthHeader(username: string, appPassword: string) {
  return `Basic ${Buffer.from(`${username}:${appPassword}`).toString("base64")}`;
}

function repoPath(workspace: string, slug: string) {
  return `/repositories/${encodeURIComponent(workspace)}/${encodeURIComponent(slug)}`;
}

export function mapBitbucketPipelineStatus(p: BitbucketPipelineRun): string {
  const stateName = (p.state?.name || "").toUpperCase();
  const resultName = (p.state?.result?.name || "").toUpperCase();
  if (stateName === "COMPLETED" && resultName === "SUCCESSFUL") return "success";
  if (stateName === "COMPLETED" && (resultName === "FAILED" || resultName === "ERROR")) return "failed";
  if (stateName === "COMPLETED" && resultName === "STOPPED") return "canceled";
  if (stateName === "IN_PROGRESS" || stateName === "PAUSED") return "running";
  if (stateName === "PENDING") return "pending";
  return (p.state?.name || "unknown").toLowerCase();
}

/**
 * Workspace-level repository discovery helper for cases where repository slug is not
 * explicitly stored in project tool config.
 */
export async function listBitbucketWorkspaceRepositories(
  username: string,
  appPassword: string,
  workspace: string,
  options?: {
    pagelen?: number;
    projectKey?: string;
    search?: string;
  },
): Promise<BitbucketWorkspaceRepo[]> {
  const pagelen = Math.min(100, Math.max(1, Number(options?.pagelen || 100)));
  const query = new URLSearchParams({ pagelen: String(pagelen) });
  const qFilters: string[] = [];
  const projectKey = String(options?.projectKey || "").trim();
  const search = String(options?.search || "").trim();
  if (projectKey) qFilters.push(`project.key="${projectKey.replace(/"/g, '\\"')}"`);
  if (search) qFilters.push(`(name~"${search.replace(/"/g, '\\"')}" OR slug~"${search.replace(/"/g, '\\"')}")`);
  if (qFilters.length) query.set("q", qFilters.join(" AND "));

  const res = await fetch(
    `https://api.bitbucket.org/2.0/repositories/${encodeURIComponent(workspace)}?${query.toString()}`,
    {
      headers: {
        Authorization: basicAuthHeader(username, appPassword),
        Accept: "application/json",
      },
    },
  );
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Bitbucket repo discovery ${res.status}: ${text.slice(0, 300)}`);
  }
  const data = (await res.json()) as {
    values?: Array<{
      slug?: string;
      name?: string;
      full_name?: string;
      project?: { key?: string; name?: string };
    }>;
  };
  return (data.values || [])
    .map((r) => ({
      slug: String(r.slug || "").trim(),
      name: r.name ? String(r.name).trim() : undefined,
      full_name: r.full_name ? String(r.full_name).trim() : undefined,
      projectKey: r.project?.key ? String(r.project.key).trim() : undefined,
      projectName: r.project?.name ? String(r.project.name).trim() : undefined,
    }))
    .filter((r) => !!r.slug);
}

export class BitbucketCiService {
  private readonly workspace: string;
  private readonly repositorySlug: string;
  private readonly username: string;
  private readonly appPassword: string;

  constructor(config: BitbucketCiConfig) {
    this.workspace = config.workspace;
    this.repositorySlug = config.repositorySlug;
    this.username = config.username;
    this.appPassword = config.appPassword;
  }

  private async requestJson<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`https://api.bitbucket.org/2.0${path}`, {
      ...init,
      headers: {
        Authorization: basicAuthHeader(this.username, this.appPassword),
        Accept: "application/json",
        ...(init?.headers || {}),
      },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Bitbucket API ${res.status}: ${text.slice(0, 400)}`);
    }
    return (await res.json()) as T;
  }

  async listBranches(pagelen = 100): Promise<Array<{ name: string }>> {
    const data = await this.requestJson<{ values?: Array<{ name?: string }> }>(
      `${repoPath(this.workspace, this.repositorySlug)}/refs/branches?pagelen=${pagelen}`,
    );
    return (data.values || []).map((b) => ({ name: String(b.name || "") })).filter((b) => !!b.name);
  }

  async listPipelines(pagelen = 50): Promise<BitbucketPipelineRun[]> {
    const data = await this.requestJson<{ values?: BitbucketPipelineRun[] }>(
      `${repoPath(this.workspace, this.repositorySlug)}/pipelines/?pagelen=${pagelen}&sort=-created_on`,
    );
    return data.values || [];
  }

  async getPipeline(uuid: string): Promise<BitbucketPipelineRun> {
    const id = uuid.startsWith("{") ? uuid : `{${uuid.replace(/[{}]/g, "")}}`;
    return this.requestJson<BitbucketPipelineRun>(
      `${repoPath(this.workspace, this.repositorySlug)}/pipelines/${encodeURIComponent(id)}`,
    );
  }

  async listPipelineSteps(uuid: string): Promise<
    Array<{
      uuid?: string;
      name?: string;
      state?: { name?: string; result?: { name?: string } };
      started_on?: string;
      completed_on?: string;
      links?: { html?: { href?: string } };
    }>
  > {
    const id = uuid.startsWith("{") ? uuid : `{${uuid.replace(/[{}]/g, "")}}`;
    const data = await this.requestJson<{
      values?: Array<{
        uuid?: string;
        name?: string;
        state?: { name?: string; result?: { name?: string } };
        started_on?: string;
        completed_on?: string;
        links?: { html?: { href?: string } };
      }>;
    }>(`${repoPath(this.workspace, this.repositorySlug)}/pipelines/${encodeURIComponent(id)}/steps/?pagelen=100`);
    return data.values || [];
  }

  async getFileContent(branch: string, filePath: string): Promise<string> {
    const normalizedPath = filePath.replace(/^\/+/, "");
    const res = await fetch(
      `https://api.bitbucket.org/2.0${repoPath(this.workspace, this.repositorySlug)}/src/${encodeURIComponent(branch)}/${normalizedPath}`,
      {
        headers: { Authorization: basicAuthHeader(this.username, this.appPassword) },
      },
    );
    if (res.status === 404) {
      throw new Error("FILE_NOT_FOUND");
    }
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Bitbucket file read ${res.status}: ${text.slice(0, 200)}`);
    }
    return res.text();
  }

  async tryGetFileContent(branch: string, filePath: string): Promise<string | null> {
    try {
      return await this.getFileContent(branch, filePath);
    } catch (e) {
      if (e instanceof Error && e.message === "FILE_NOT_FOUND") return null;
      throw e;
    }
  }

  async commitFileToBranch(branch: string, filePath: string, content: string, message: string): Promise<void> {
    const normalizedPath = filePath.replace(/^\/+/, "");
    const formData = new FormData();
    formData.append("message", message);
    formData.append("branch", branch);
    formData.append(normalizedPath, content);
    const res = await fetch(`https://api.bitbucket.org/2.0${repoPath(this.workspace, this.repositorySlug)}/src`, {
      method: "POST",
      headers: { Authorization: basicAuthHeader(this.username, this.appPassword) },
      body: formData,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Bitbucket commit failed ${res.status}: ${text.slice(0, 400)}`);
    }
  }

  async listRootSrcNodes(branch: string): Promise<Array<{ path: string; type: string }>> {
    const res = await fetch(
      `https://api.bitbucket.org/2.0${repoPath(this.workspace, this.repositorySlug)}/src/${encodeURIComponent(branch)}/`,
      { headers: { Authorization: basicAuthHeader(this.username, this.appPassword), Accept: "application/json" } },
    );
    if (!res.ok) return [];
    const data = (await res.json()) as {
      values?: Array<{ path: string; type: "commit_file" | "commit_directory" }>;
    };
    return (data.values || []).map((n) => ({ path: n.path, type: n.type }));
  }

  /**
   * Trigger a pipeline for a branch. Omit customPattern for the default branch pipeline.
   */
  async triggerPipeline(branch: string, customPattern?: string | null): Promise<BitbucketPipelineRun> {
    const body: Record<string, unknown> = {
      target: {
        type: "pipeline_ref_target",
        ref_type: "branch",
        ref_name: branch.trim(),
      },
    };
    const pattern = typeof customPattern === "string" ? customPattern.trim() : "";
    if (pattern) {
      (body.target as Record<string, unknown>).selector = { type: "custom", pattern };
    }
    return this.requestJson<BitbucketPipelineRun>(`${repoPath(this.workspace, this.repositorySlug)}/pipelines/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }
}

export function bitbucketNumericId(p: BitbucketPipelineRun): number {
  if (typeof p.build_number === "number" && Number.isFinite(p.build_number) && p.build_number > 0) {
    return p.build_number;
  }
  const hex = (p.uuid || "").replace(/[{}-]/g, "").slice(0, 8);
  const n = parseInt(hex, 16);
  return Number.isFinite(n) && n > 0 ? n : 1;
}
